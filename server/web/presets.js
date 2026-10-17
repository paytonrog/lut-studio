// Zone presets: a look applied to the selected zone. Built-in ones set only the fields they name (colors are left
// alone unless the look is about color, like camo); saved ones (the user's, %APPDATA%\LUTStudio\presets.json)
// store the whole zone row. Field paths and meanings: lut/schema.go.
const R0 = { grunge_b: 0, grunge_a: 0, edge: 0 };
const OCC0 = { ...R0, occlusion: 0 };
const OFF0 = { ...R0, offset: 0 };
const noMetal = { 'metal.mask': OCC0, 'metal.offset': 0 };
const noWear = { 'wear.mask': OCC0, 'wear.mask_offset': -3 };
const noIri = { 'iridescence.mask': OFF0, 'iridescence.strength': OFF0 };
const noCoat = { 'clearcoat.amount': 0 };
const paint = (rough) => ({ 'paint.mode': 0, 'shine.roughness': rough, 'shine.roughness_vary': { ...R0, hollow: 0 },
  'shine.specular': 0.5, 'shine.specular_vary': R0, ...noMetal, ...noCoat });

export const BUILTIN = [
  { name: 'Matte paint', fields: paint(0.75) },
  { name: 'Satin paint', fields: paint(0.45) },
  { name: 'Gloss paint', fields: paint(0.15) },
  { name: 'Lacquered (clearcoat)', fields: { ...paint(0.5), 'paint.mode': 2, 'clearcoat.amount': 0.8, 'clearcoat.bump': 0,
    'clearcoat.roughness': { ...R0, base: 0.05 } } },
  { name: 'Bare metal', fields: { 'paint.mode': 0, 'metal.mask': OCC0, 'metal.offset': 1, 'shine.roughness': 0.3,
    'shine.roughness_vary': { ...R0, hollow: 0 }, ...noWear, ...noCoat } },
  { name: 'Brushed metal', fields: { 'paint.mode': 0, 'metal.mask': OCC0, 'metal.offset': 1, 'shine.roughness': 0.35,
    'shine.roughness_vary': { grunge_b: 0.5, grunge_a: 0, edge: 0, hollow: 0 }, 'detail.layer': 24, 'detail.tiling': 3,
    'detail.bump': 0.3, ...noWear, ...noCoat } },
  { name: 'Worn metal edges', fields: { 'wear.mask': { grunge_b: 0, grunge_a: 0, edge: 8, occlusion: 0 }, 'wear.mask_offset': -1,
    'wear.color': [0.45, 0.45, 0.45], 'wear.heavy_color': [0.7, 0.7, 0.7],
    'metal.mask': { grunge_b: 0, grunge_a: 0, edge: 8, occlusion: 0 }, 'metal.offset': -1 } },
  { name: 'Clean (no wear)', fields: { ...noWear } },
  { name: 'Woodland camo', fields: { 'camo.layer': 3, 'camo.contrast': 250, 'camo.offset': -1, 'camo.tiling': 0.3,
    'camo.keep': { grunge_b: 0, grunge_a: 0, edge: 0, threshold: 0 },
    'camo.color1': [0.24, 0.27, 0.18], 'camo.color2': [0.13, 0.15, 0.1], 'camo.color3': [0.35, 0.32, 0.22], 'camo.color4': [0.08, 0.08, 0.07] } },
  { name: 'Tiger stripes', fields: { 'camo.layer': 4, 'camo.contrast': 250, 'camo.offset': 0, 'camo.tiling': 0.5,
    'camo.keep': { grunge_b: 0, grunge_a: 0, edge: 0, threshold: 0 },
    'camo.color1': [0.6, 0.45, 0.25], 'camo.color2': [0.15, 0.12, 0.08], 'camo.color3': [0.35, 0.28, 0.16], 'camo.color4': [0.05, 0.05, 0.05] } },
  { name: 'No camo', fields: { 'camo.layer': -1 } },
  { name: 'Glow', fields: { 'paint.mode': 0, 'glow.emissive': 0.1, 'shine.roughness': 0.2 } },
  { name: 'Oil-slick sheen (dark colors)', fields: { 'iridescence.thickness': 0.3, 'iridescence.thickness_shift': 0.5,
    'iridescence.mask': { ...R0, offset: 1 }, 'iridescence.strength': { ...R0, offset: 0.8 } } },
  { name: 'No sheen', fields: { ...noIri } },
  { name: 'Fabric', fields: { 'paint.mode': 1, 'shine.roughness': 0.9, 'cloth.fuzz': 0.6, 'cloth.rim': 0.2,
    'cloth.fuzz_color': [0.5, 0.5, 0.5], 'detail.layer': 23, 'detail.tiling': 6, 'detail.bump': 0.5, ...noMetal } },
];

// Applies a preset to zone z of LUT l (l.edited, row-major 4 floats per texel); fields: schema list.
export function applyPreset(preset, l, z, fields) {
  const at = (col, ch) => (z * l.w + col) * 4 + ch;
  if (preset.row) {                                  // a saved zone: the whole row
    if (preset.row.length !== l.w * 4) throw new Error('that preset was saved from a different kind of LUT');
    l.edited.set(preset.row, z * l.w * 4);
    return;
  }
  for (const [path, v] of Object.entries(preset.fields)) {
    const f = fields.find(f => `${f.group}.${f.key}` === path);
    if (!f) continue;                                 // (pattern LUTs have other fields)
    const vals = f.kind === 'recipe' ? f.sub.map(k => v[k] ?? 0) : Array.isArray(v) ? v : [v];
    f.leaves.forEach(([col, ch], i) => { l.edited[at(col, ch)] = vals[i]; });
  }
}

// Looks from a file: LUT Studio's own (an array of {name, kind, row}) or the Paydex LUT Editor's row presets
// ({name: {timestamp, rowData: [{r, g, b, a} per column]}}); the kind from the row's width (23 material, 16 cape,
// 3 pattern: the same raw texel values LUT Studio edits)
export function importLooks(j) {
  const KIND = { 23: 'material', 16: 'cape', 3: 'pattern' };
  if (Array.isArray(j)) return j.filter(p => p && typeof p.name === 'string' && Array.isArray(p.row) && KIND[p.row.length / 4] === p.kind)
    .map(p => ({ name: p.name, kind: p.kind, row: p.row.map(Number) }));
  const out = [];
  for (const [name, p] of Object.entries(j ?? {})) {
    const cols = p?.rowData;
    if (!Array.isArray(cols) || !KIND[cols.length]) continue;
    out.push({ name, kind: KIND[cols.length], row: cols.flatMap(c => [+c.r || 0, +c.g || 0, +c.b || 0, +c.a || 0]) });
  }
  return out;
}
