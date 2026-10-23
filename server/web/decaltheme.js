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

// how far apart two colors look (server/decaltheme.go decalContrast: OKLab distance, lightness counted twice)
export function decalContrast(a, b) {
  const x = oklab(a), y = oklab(b), dl = 2 * (x[0] - y[0]), da = x[1] - y[1], db = x[2] - y[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}
export const MIN_DECAL_CONTRAST = 0.45;
function oklab(c) {
  const lin = v => { const x = Math.min(Math.max(v, 0), 1); return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const shade = c => c.map(v => v * 0.2), tint = c => c.map(v => v + (1 - v) * 0.8);

// a decal sheet's {light, dark} colors (server/decaltheme.go decalInks): from the looks of the LUTs drawing it. The
// light: the trim's, else the looks' secondary or primary, else the trim taken toward black or white; the dark: the
// secondary's, else the primary's, else the light taken toward black or white, the first that reads on the light one;
// the first pair that reads apart and on every surface (its light or dark color on it), else the closest. null: no colors.
export function decalInks(surfaces, looksList) {
  const of = (...roles) => looksList.flatMap(l => roles.map(r => (l[r]?.length >= 3 ? l[r].slice(0, 3) : null))).filter(Boolean);
  const lights = [...of('trim'), ...of('secondary', 'primary')];
  if (!lights.length) return null;
  lights.push(shade(lights[0]), tint(lights[0]));
  const darkOf = light => {
    let best = null, bestC = -1;
    for (const c of [...of('secondary', 'primary'), shade(light), tint(light)]) {
      const d = decalContrast(c, light);
      if (d >= MIN_DECAL_CONTRAST) return c;
      if (d > bestC) { best = c; bestC = d; }
    }
    return best;
  };
  let out = null, bestScore = -1;
  for (const light of lights) {
    const dark = darkOf(light);
    const score = Math.min(decalContrast(light, dark), ...surfaces.map(s => Math.max(decalContrast(light, s), decalContrast(dark, s))));
    if (score >= MIN_DECAL_CONTRAST) return { light, dark };
    if (score > bestScore) { out = { light, dark }; bestScore = score; }
  }
  return out;
}

// each sheet's {light, dark} for the pieces shown (server/decaltheme.go sheetInks): the looks of the themed LUTs
// drawing it (looksAt(lut): its group's, swapped as Apply does; null: not themed), on their primary color. A sheet no
// themed LUT draws isn't in it (Apply leaves it). A Map.
export function sheetInks(pieces, looksAt) {
  const by = new Map();
  for (const p of pieces) {
    if (!p.decalHash) continue;
    const h = p.info?.lut, L = h && looksAt(h);
    if (!by.has(p.decalHash)) by.set(p.decalHash, new Map());
    if (L) by.get(p.decalHash).set(h, L);
  }
  const out = new Map();
  for (const [sheet, luts] of by) {
    const surfaces = [], all = [];
    for (const h of [...luts.keys()].sort()) {
      const L = luts.get(h);
      all.push(L);
      if (L.primary?.length >= 3) surfaces.push(L.primary.slice(0, 3));
    }
    const ink = all.length && decalInks(surfaces, all);
    if (ink) out.set(sheet, ink);
  }
  return out;
}

const cache = new Map();   // sheet hash -> {w, h, px} (the game's pixels, RGBA8)
// the game's sheet (RGBA8), or null (not an RGBA image; a dummy)
async function sheetPixels(hash) {
  if (cache.has(hash)) return cache.get(hash);
  let out = null;
  try {
    const r = await fetch('/api/tex?hash=' + hash);
    if (!r.ok) return null;   // (not kept: asked again next time)
    const b = new Uint8Array(await r.arrayBuffer()), dv = new DataView(b.buffer);
    const w = dv.getUint32(4, true), h = dv.getUint32(8, true), fmt = dv.getUint32(16, true);
    if (fmt === 0 && w * h > 16 * 16 && b.length >= 20 + w * h * 4) out = { w, h, px: b.slice(20, 20 + w * h * 4) };
  } catch { return null; }
  cache.set(hash, out);
  return out;
}

let pending = Promise.resolve();   // (sheets going back to the saved ones: done before new ones show)
// decal sheets shown recolored (inks: sheetInks' Map, sheet -> {light, dark}; mode); returns the hashes shown (for undo)
export async function previewDecals(R, mode, inks) {
  await pending;
  const shown = [];
  for (const [h, colors] of inks) {
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
