// Decals in a theme, on screen: the decal sheets of the pieces shown recolored as the theme's Apply recolors them
// (server/decaltheme.go: the same math), shown with the renderer's previewTexture; undone with refreshDecals.
// mode: "one" (all in the light color, a little of the artwork's shading kept) or "two" (light parts in the light
// color, dark parts in the dark one, blended across). Colors: a LUT row's column 0 (sRGB 0-1, the sheet's space).

export function recolorDecals(px, mode, light, dark) {
  const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i + 3 < px.length; i += 4) {
    const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
    for (let k = 0; k < 3; k++) {
      let c;
      if (mode === 'two') { const w = sm(0.3, 0.6, l); c = dark[k] * (1 - w) + light[k] * w; }
      else c = light[k] * Math.min(Math.max(0.75 + 0.5 * (l - 0.5), 0.5), 1.1);
      px[i + k] = Math.floor(Math.min(Math.max(c, 0), 1) * 255 + 0.5);
    }
  }
  return px;
}

// the light and dark colors of a theme's looks ({role: LUT row}): the trim look's (else the primary's), the
// secondary's (else the light one darkened)
export function decalColors(looks) {
  const c = (...roles) => { for (const r of roles) if (looks[r]?.length >= 3) return looks[r].slice(0, 3); return null; };
  const light = c('trim', 'primary', 'secondary');
  if (!light) return null;
  return { light, dark: c('secondary', 'primary') ?? light.map(v => v * 0.35) };
}

const cache = new Map();   // sheet hash -> {w, h, px} (the game's pixels, RGBA8)
// the game's sheet (RGBA8), or null (not an RGBA image; a dummy)
async function sheetPixels(hash) {
  if (cache.has(hash)) return cache.get(hash);
  let out = null;
  try {
    const b = new Uint8Array(await (await fetch('/api/tex?hash=' + hash)).arrayBuffer()), dv = new DataView(b.buffer);
    const w = dv.getUint32(4, true), h = dv.getUint32(8, true), fmt = dv.getUint32(16, true);
    if (fmt === 0 && w * h > 16 * 16 && b.length >= 20 + w * h * 4) out = { w, h, px: b.slice(20, 20 + w * h * 4) };
  } catch { }
  cache.set(hash, out);
  return out;
}

// pieces' decal sheets shown recolored (the theme's colors {light, dark}, mode); returns the hashes shown (for undo)
let pending = Promise.resolve();   // (sheets going back to the saved ones: done before new ones show)
export async function previewDecals(R, pieces, mode, colors) {
  await pending;
  const hashes = [...new Set(pieces.map(p => p.decalHash).filter(Boolean))], shown = [];
  for (const h of hashes) {
    const s = await sheetPixels(h);
    if (!s) continue;
    R.previewTexture(h, s.w, s.h, recolorDecals(s.px.slice(), mode, colors.light, colors.dark));
    shown.push(h);
  }
  return shown;
}
export function unpreviewDecals(R, hashes) {
  if (hashes?.length) pending = Promise.all([pending, ...hashes.map(h => R.refreshDecals(h))]).catch(() => { });
  return pending;
}
