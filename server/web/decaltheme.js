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

// a decal's light parts at least this light, its dark parts at most this dark (OKLab lightness; decaltheme.go's)
export const DECAL_LIGHT_MIN = 0.72, DECAL_DARK_MAX = 0.32;
export function oklab(c) {
  const lin = v => { const x = Math.min(Math.max(v, 0), 1); return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const gam = x => { x = Math.min(Math.max(x, 0), 1); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
// c at OKLab lightness L, its hue kept (less colorful near white or black)
export function withLightness(c, L) { const o = oklab(c), k = Math.min(1, 4 * Math.min(L, 1 - L)); return fromOklab([L, o[1] * k, o[2] * k]); }

// a decal sheet's {light, dark} colors (server/decaltheme.go decalInks), from the looks of the LUTs drawing it, keeping
// its artwork's light and dark: light, the trim's color lifted past DECAL_LIGHT_MIN if it isn't that light; dark, the
// secondary's if it's dark enough, else the darkest of the looks' colors that is, else the secondary (or the trim)
// lowered past DECAL_DARK_MAX. null: no colors.
export function decalInks(looksList) {
  const of = (...roles) => looksList.flatMap(l => roles.map(r => (l[r]?.length >= 3 ? l[r].slice(0, 3) : null))).filter(Boolean);
  const all = of('trim', 'primary', 'secondary');
  if (!all.length) return null;
  const base = of('trim')[0] ?? all[0], sec = of('secondary')[0];
  const light = oklab(base)[0] < DECAL_LIGHT_MIN ? withLightness(base, 0.8) : base;
  let dark;
  if (sec && oklab(sec)[0] <= DECAL_DARK_MAX) dark = sec;
  else {
    for (const c of all) if (oklab(c)[0] <= DECAL_DARK_MAX && (!dark || oklab(c)[0] < oklab(dark)[0])) dark = c;
    dark ??= withLightness(sec ?? base, DECAL_DARK_MAX * 0.7);
  }
  return { light, dark };
}

// each sheet's {light, dark} for the pieces shown (server/decaltheme.go sheetInks): the looks of the themed LUTs
// drawing it (looksAt(lut): its group's, swapped as Apply does; null: not themed). A sheet no themed LUT draws isn't
// in it (Apply leaves it). A Map.
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
    const all = [...luts.keys()].sort().map(h => luts.get(h));
    const ink = all.length && decalInks(all);
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

// a camo's four colors (game: the game's, [[r, g, b] x 4]) in shades of paint: paint's lightness moved as far as each
// game color is from their mean (spread to at least 0.1), paint's hue (server/decaltheme.go camoShades)
export function camoShades(paint, game) {
  const ls = game.map(c => oklab(c)[0]), mean = ls.reduce((a, b) => a + b, 0) / ls.length;
  const dev = Math.max(...ls.map(l => Math.abs(l - mean))), k = dev > 0 && dev < 0.1 ? 0.1 / dev : 1, lp = oklab(paint)[0];
  return ls.map(l => withLightness(paint, Math.min(Math.max(lp + (l - mean) * k, 0.05), 0.97)));
}
// a cape's gradient color in primary's hue at the game color's lightness (server/decaltheme.go fadeColor)
export const fadeColor = (primary, game) => withLightness(primary.slice(0, 3), oklab(game)[0]);
// a look on a cloth row the game gives camo, the look without: the game's camo in shades of the look's paint (Apply's
// copyColors); game: the game's row
export function tonalCamo(px, base, look, game) {
  if (look[21 * 4 + 3] !== -1 || !game || game[base + 21 * 4 + 3] === -1) return;
  const cs = camoShades(look.slice(0, 3), [0, 1, 2, 3].map(i => Array.from(game.slice(base + (16 + i) * 4, base + (16 + i) * 4 + 3))));
  cs.forEach((c, i) => { for (let k = 0; k < 3; k++) px[base + (16 + i) * 4 + k] = c[k]; });
}
// a cape design row: its gradient color (column 3) from fade's hue, the game's lightness (Apply's trimZones)
export function capeFade(px, base, fade, game) {
  if (!fade || fade.length < 3 || !game) return;
  const c = fadeColor(fade, Array.from(game.slice(base + 12, base + 15)));
  for (let k = 0; k < 3; k++) px[base + 12 + k] = c[k];
}
// a cape's looks (group: the LUT's item group; trim: the theme's): its glow panels (cloth with a faint glow, not
// lights) in the trim, whatever glow the theme has (server/theme_core.go lookFor)
export const withCapeGlow = (L, group, trim) => (group === 'Capes' && (L.trim ?? trim) ? { ...L, glow: L.trim ?? trim } : L);

// a glass zone's color (game: the game's; a visor, a lens) in look's hue at the game's lightness and colorfulness;
// a gray look: smoked glass (server/decaltheme.go glassTint)
export function glassTint(look, game) {
  const g = oklab(game), l = oklab(look.slice(0, 3)), lc = Math.hypot(l[1], l[2]), gc = Math.hypot(g[1], g[2]);
  if (lc < 0.02) return fromOklab([g[0], 0, 0]);
  return fromOklab([g[0], l[1] * gc / lc, l[2] * gc / lc]);
}
// the color glass takes in a theme: the most colorful of its trim, secondary and primary looks' (null: none)
export function glassLook(looks) {
  let best = null, bc = -1;
  for (const r of ['trim', 'secondary', 'primary']) {
    const row = looks?.[r];
    if (row?.length >= 3) { const o = oklab(row.slice(0, 3)), c = Math.hypot(o[1], o[2]); if (c > bc) { best = row.slice(0, 3); bc = c; } }
  }
  return best;
}
// a zone the roles keep that is glass in the game (a full clearcoat: a visor, a lens): tinted as Apply does (themeZones)
export function tintGlass(px, base, looks, game) {
  if (!game || Math.round(game[base + 3]) !== 3 || game[base + 10 * 4 + 2] < 0.9) return false;   // (glass: mode 3, fully coated)
  const c = glassLook(looks);
  if (!c) return false;
  const t = glassTint(c, Array.from(game.slice(base, base + 3)));
  for (let k = 0; k < 3; k++) px[base + k] = t[k];
  return true;
}
