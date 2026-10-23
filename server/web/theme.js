// Theme everything like this: the item on screen gives one look per role (a whole zone row: its zone of that role,
// the biggest one by default), and every zone of that role on every chosen item gets it (POST /api/theme, theme.go).
// Items not in the mod yet are added (every variant, as the game has them); the theme goes into the current variant.
// Zones changed by hand since the last theme are kept unless overwriting is asked for. Roles: roles.js / roles.go.

import { $, esc, openSide, closeSide } from './texedit.js';
import { D2_PRESETS } from './d2presets.js';
import { ROLE_INFO } from './roles.js';
import { sheetInks, previewDecals, unpreviewDecals, tonalCamo, capeFade } from './decaltheme.js';

const GROUPS = ['Armor', 'Helmets', 'Capes', 'Backpacks', 'Weapons', 'Vehicles', 'Equipment', 'Stratagems', 'Eagle & craft',
  'SEAF', 'Super Destroyer', 'Ship interior', 'Ship crew'];
const DEFAULT_GROUPS = ['Armor', 'Helmets', 'Capes', 'Backpacks'];   // (ticked when the item on screen is none of them)
const at = (l, z, col, ch) => (z * l.w + col) * 4 + ch;
// camo on a role's look (the material LUT's camo fields, lut/schema.go): layer (col 21 .a), colors 1-4 (cols 16-19
// RGB), contrast / offset / tiling (col 21 r g b), where the paint shows through (cols 17-20 .a; 0: camo everywhere)
const CAMO = [['', 'no camo'], ['0', 'camo: fine speckle'], ['1', 'camo: mottled'], ['3', 'camo: woodland'], ['4', 'camo: tiger stripes']];
const W = 23;   // material LUT width
function withCamo(row, c) {
  const out = row.slice(), set = (col, ch, v) => { out[col * 4 + ch] = v; };
  set(21, 3, +c.layer);
  c.colors.forEach((rgb, i) => rgb.forEach((v, ch) => set(16 + i, ch, v)));
  set(21, 0, 216.6); set(21, 1, -1); set(21, 2, c.tiling);   // (the stock camo armors' contrast and offset)
  for (const col of [17, 18, 19, 20]) set(col, 3, 0);
  return out;
}

// Ready-made themes: per role a color (paint; secondary, wear colors as shades of it), field values over the role's
// look on screen ([column, channel, value]: metal, shine, glow, iridescence, cloth sheen) and an optional camo
const CLEAN = [[4, 0, 0], [4, 1, 0], [4, 2, 0], [4, 3, 0], [1, 3, -3]];   // (no wear: worn-paint recipe off)
export const PRESETS = {
  'Orange Tiger': {
    primary: { c: '#e8731c', camo: { layer: '4', colors: ['#e8731c', '#0f0f0f', '#b04a0d', '#0d0d0d'], tiling: 1.7 } },
    secondary: { c: '#161616' }, trim: { c: '#e6dcc8' }, cloth: { c: '#2a2a2a' },
  },
  'Desert': { primary: { c: '#b89c6c' }, secondary: { c: '#5c4834' }, trim: { c: '#6e7c3c' }, cloth: { c: '#7a6a52' } },
  'Oil Slick': {
    primary: { c: '#0a0a0f', set: [...CLEAN, [6, 3, 0.35], [10, 0, 0.16], [8, 3, 0.7], [13, 2, 0.15], [13, 3, 1], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, 1.8]] },
    secondary: { c: '#121318', set: [...CLEAN, [6, 3, 0.2], [10, 0, 0.3], [13, 2, 0.6], [13, 3, 0.4], [14, 3, 1], [15, 3, 1.1]] },
    trim: { c: '#3b3e44', set: [...CLEAN, [6, 3, 1], [10, 0, 0.28]] },
    cloth: { c: '#0e0e12', set: [[12, 0, 0.28], [12, 1, 0.12], [12, 2, 0.4], [12, 3, 0.35]] },
    hardware: { c: '#2b2d31', set: [[6, 3, 1], [10, 0, 0.25]] },
  },
  'Neon Circuit': {
    primary: { c: '#0b0b0d', set: [...CLEAN, [6, 3, -1], [10, 0, 0.72], [8, 3, 0.4]] },
    secondary: { c: '#17191d', set: [...CLEAN, [6, 3, -1], [10, 0, 0.55]] },
    trim: { c: '#00e8ff', set: [...CLEAN, [6, 3, -1], [10, 0, 0.3], [13, 0, 0.13]] },
    glow: { c: '#00e8ff', set: [[13, 0, 0.13]] },
    cloth: { c: '#0a0a0c', set: [[12, 0, 0], [12, 1, 0.5], [12, 2, 0.6], [12, 3, 0.35]] },
    hardware: { c: '#1b1c1f', set: [[6, 3, 1], [10, 0, 0.35]] },
  },
  'Gilded Emperor': {
    primary: { c: '#6a0a12', set: [...CLEAN, [6, 3, -1], [10, 0, 0.3], [8, 3, 0.6]] },
    secondary: { c: '#0d0c0c', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4]] },
    trim: { c: '#d9a93c', set: [...CLEAN, [6, 3, 1], [10, 0, 0.22]] },
    cloth: { c: '#100f0f', set: [[12, 0, 0.3], [12, 1, 0.24], [12, 2, 0.1], [12, 3, 0.15]] },
    hardware: { c: '#cfa13a', set: [[6, 3, 1], [10, 0, 0.2]] },
  },
  'Volcanic': {
    primary: { c: '#110e0d', set: [...CLEAN, [6, 3, -1], [10, 0, 0.85], [8, 3, 0.3]] },
    secondary: { c: '#c8300a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.6], [13, 0, 0.015]],
      camo: { layer: '4', colors: ['#d8340a', '#120706', '#ff5a10', '#0b0403'], tiling: 1.4 } },
    trim: { c: '#ff6a10', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4], [13, 0, 0.12]] },
    glow: { c: '#ff6a10', set: [[13, 0, 0.12]] },
    cloth: { c: '#151110', set: [[12, 0, 0.6], [12, 1, 0.16], [12, 2, 0.02], [12, 3, 0.3]] },
    hardware: { c: '#2a2421', set: [[6, 3, 1], [10, 0, 0.45]] },
  },
  'Chrome Legion': {
    primary: { c: '#e6e9ee', set: [...CLEAN, [6, 3, 1], [10, 0, 0.02], [8, 3, 1]] },
    secondary: { c: '#0c0c0e', set: [...CLEAN, [6, 3, -1], [10, 0, 0.35]] },
    trim: { c: '#d4a73a', set: [...CLEAN, [6, 3, 1], [10, 0, 0.2]] },
    cloth: { c: '#141416', set: [[12, 0, 0.5], [12, 1, 0.5], [12, 2, 0.55], [12, 3, 0.3]] },
    hardware: { c: '#c9ccd1', set: [[6, 3, 1], [10, 0, 0.05]] },
  },
  'Synthwave': {
    primary: { c: '#ff2bb4', set: [...CLEAN, [6, 3, -1], [10, 0, 0.35]] },
    secondary: { c: '#2a0a4a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4]] },
    trim: { c: '#00f0ff', set: [...CLEAN, [6, 3, -1], [10, 0, 0.3], [13, 0, 0.13]] },
    glow: { c: '#00f0ff', set: [[13, 0, 0.13]] },
    cloth: { c: '#3a0c5c', set: [[12, 0, 1], [12, 1, 0.17], [12, 2, 0.7], [12, 3, 0.3]],
      camo: { layer: '1', colors: ['#3a0c5c', '#ff2bb4', '#1a0530', '#8a1fd0'], tiling: 1.2 } },
    hardware: { c: '#2a2a33', set: [[6, 3, 1], [10, 0, 0.3]] },
  },
  'Abyssal': {
    primary: { c: '#0b1a2e', set: [...CLEAN, [6, 3, -1], [10, 0, 0.35]],
      camo: { layer: '1', colors: ['#0b1a2e', '#05101e', '#12304a', '#020812'], tiling: 1.4 } },
    secondary: { c: '#06101c', set: [...CLEAN, [6, 3, -1], [10, 0, 0.5]] },
    trim: { c: '#00ffc8', set: [...CLEAN, [6, 3, -1], [10, 0, 0.3], [13, 0, 0.12]] },
    glow: { c: '#00ffc8', set: [[13, 0, 0.12]] },
    cloth: { c: '#07121e', set: [[12, 0, 0], [12, 1, 0.45], [12, 2, 0.4], [12, 3, 0.3]] },
    hardware: { c: '#1a2630', set: [[6, 3, 0.6], [10, 0, 0.2], [13, 2, 0.5], [13, 3, 0.6], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, 1.2]] },
  },
  'Ghost': {
    primary: { c: '#b9c4cc', set: [...CLEAN, [6, 3, -1], [10, 0, 0.85]] },
    secondary: { c: '#4a5560', set: [...CLEAN, [6, 3, -1], [10, 0, 0.8]] },
    trim: { c: '#9fe8ff', set: [...CLEAN, [6, 3, -1], [10, 0, 0.5], [13, 0, 0.13]] },
    glow: { c: '#9fe8ff', set: [[13, 0, 0.13]] },
    cloth: { c: '#3c464f', set: [[12, 0, 0.8], [12, 1, 0.9], [12, 2, 1], [12, 3, 0.4]] },
    hardware: { c: '#9aa3aa', set: [[6, 3, 1], [10, 0, 0.6]] },
  },
  'Carbon & Copper': {
    primary: { c: '#1a1a1c', set: [...CLEAN, [6, 3, -1], [10, 0, 0.2], [8, 3, 0.8]],
      camo: { layer: '0', colors: ['#1a1a1c', '#0c0c0d', '#2a2a2d', '#070708'], tiling: 2.5 } },
    secondary: { c: '#0e0e10', set: [...CLEAN, [6, 3, -1], [10, 0, 0.5]] },
    trim: { c: '#b8693a', set: [...CLEAN, [6, 3, 1], [10, 0, 0.25]] },
    cloth: { c: '#151517', set: [[12, 0, 0.35], [12, 1, 0.2], [12, 2, 0.12], [12, 3, 0.2]] },
    hardware: { c: '#b8693a', set: [[6, 3, 1], [10, 0, 0.25]] },
  },
  'Bio-Hazard': {
    primary: { c: '#7cff1a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.5]],
      camo: { layer: '4', colors: ['#7cff1a', '#0a0a0a', '#4fb810', '#080808'], tiling: 1.6 } },
    secondary: { c: '#0e0f0d', set: [...CLEAN, [6, 3, -1], [10, 0, 0.7]] },
    trim: { c: '#9dff2a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4], [13, 0, 0.12]] },
    glow: { c: '#9dff2a', set: [[13, 0, 0.12]] },
    cloth: { c: '#141812', set: [[12, 0, 0.3], [12, 1, 0.6], [12, 2, 0.1], [12, 3, 0.3]] },
    hardware: { c: '#2a2e26', set: [[6, 3, 1], [10, 0, 0.45]] },
  },
  'Royal Navy': {
    primary: { c: '#13254a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.25], [8, 3, 0.6]] },
    secondary: { c: '#e8e6df', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4]] },
    trim: { c: '#d9a93c', set: [...CLEAN, [6, 3, 1], [10, 0, 0.22]] },
    cloth: { c: '#0f1a33', set: [[12, 0, 0.25], [12, 1, 0.3], [12, 2, 0.5], [12, 3, 0.2]] },
    hardware: { c: '#cfa13a', set: [[6, 3, 1], [10, 0, 0.2]] },
  },
  'Blood Moon': {
    primary: { c: '#8a0a16', set: [...CLEAN, [6, 3, -1], [10, 0, 0.18], [8, 3, 0.7], [13, 2, 0.05], [13, 3, 0.3], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, 0.6]] },
    secondary: { c: '#0a0707', set: [...CLEAN, [6, 3, -1], [10, 0, 0.5]] },
    trim: { c: '#ff1a1a', set: [...CLEAN, [6, 3, -1], [10, 0, 0.3], [13, 0, 0.12]] },
    glow: { c: '#ff1a1a', set: [[13, 0, 0.12]] },
    cloth: { c: '#0e0606', set: [[12, 0, 0.6], [12, 1, 0.05], [12, 2, 0.05], [12, 3, 0.3]] },
    hardware: { c: '#2a1a1a', set: [[6, 3, 1], [10, 0, 0.35]] },
  },
  'Arctic Phantom': {
    primary: { c: '#e8eef2', set: [...CLEAN, [6, 3, -1], [10, 0, 0.7]],
      camo: { layer: '1', colors: ['#e8eef2', '#b8c8d4', '#ffffff', '#8fa4b4'], tiling: 1.3 } },
    secondary: { c: '#5a6a78', set: [...CLEAN, [6, 3, -1], [10, 0, 0.6]] },
    trim: { c: '#7fd8ff', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4], [13, 0, 0.1]] },
    glow: { c: '#7fd8ff', set: [[13, 0, 0.1]] },
    cloth: { c: '#c8d2da', set: [[12, 0, 0.8], [12, 1, 0.9], [12, 2, 1], [12, 3, 0.35]] },
    hardware: { c: '#c8d4dc', set: [[6, 3, 1], [10, 0, 0.55]] },
  },
  'Zebra Prism': {
    primary: { c: '#f2f2f2', set: [...CLEAN, [6, 3, -1], [10, 0, 0.4]],
      camo: { layer: '4', colors: ['#f2f2f2', '#0a0a0a', '#dcdcdc', '#050505'], tiling: 1.6 } },
    secondary: { c: '#08080b', set: [...CLEAN, [6, 3, 0.35], [10, 0, 0.15], [13, 2, 0.3], [13, 3, 1], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, 1.8]] },
    trim: { c: '#d0d0d0', set: [...CLEAN, [6, 3, 1], [10, 0, 0.2]] },
    cloth: { c: '#0c0c0e', set: [[12, 0, 0.3], [12, 1, 0.3], [12, 2, 0.35], [12, 3, 0.3]] },
    hardware: { c: '#2b2d31', set: [[6, 3, 1], [10, 0, 0.25]] },
  },
};
// ---- more presets, from a few finishes: T(primary, secondary, trim, cloth, options)
export const FIN = {
  matte: [[6, 3, -1], [10, 0, 0.78]], satin: [[6, 3, -1], [10, 0, 0.45]], gloss: [[6, 3, -1], [10, 0, 0.18], [8, 3, 0.65]],
  plastic: [[6, 3, -1], [10, 0, 0.25], [8, 3, 0.6]], rough: [[6, 3, -1], [10, 0, 0.95], [8, 3, 0.2]],
  metal: [[6, 3, 1], [10, 0, 0.25]], mirror: [[6, 3, 1], [10, 0, 0.03], [8, 3, 1]], brushed: [[6, 3, 1], [10, 0, 0.45]],
};
export const IRID = (t, s, str) => [[13, 2, t], [13, 3, s], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, str]];
export const CM = (layer, colors, tiling = 1.5) => ({ layer: String(layer), colors, tiling });
// o: pf / sf / tf (finishes), pc / sc / cc (camos), px / sx (extra fields), glow (trim and lights glow in this color),
// gv (its strength), hw / hwf (metal parts' color and finish), fuzz (cloth sheen color), cape / weapon: [p, s, t, cl,
// o] the capes' / weapons' / vehicles' own looks (the preset's capes / weapons / vehicles key: GROUP_LOOKS; other
// items take the rest), bySize: on an item whose secondary covers more of it than its primary, the two swapped,
// light / lv: the glow role's color and strength alone (the trim keeps its look)
export function T(p, s, t, cl, o = {}) {
  const glow = o.glow ? [[13, 0, o.gv ?? 0.12]] : [];
  const out = {
    primary: { c: p, set: [...CLEAN, ...(o.pf ?? FIN.satin), ...(o.px ?? [])], camo: o.pc },
    secondary: { c: s, set: [...CLEAN, ...(o.sf ?? FIN.satin), ...(o.sx ?? [])], camo: o.sc },
    trim: { c: o.glow ?? t, set: [...CLEAN, ...(o.tf ?? FIN.satin), ...glow] },
    cloth: { c: cl, set: o.fuzz ? [[12, 0, o.fuzz[0]], [12, 1, o.fuzz[1]], [12, 2, o.fuzz[2]], [12, 3, 0.3]] : [], camo: o.cc },
  };
  if (o.glow) out.glow = { c: o.glow, set: glow };
  if (o.hw) out.hardware = { c: o.hw, set: o.hwf ?? FIN.metal };
  if (o.light) out.glow = { c: o.light, set: [[13, 0, o.lv ?? 0.1]] };   // (the glow role only: lights, screens, visors)
  if (o.cape) out.capes = T(...o.cape);
  if (o.weapon) out.weapons = T(...o.weapon);
  if (o.vehicle) out.vehicles = T(...o.vehicle);
  if (o.bySize) out.bySize = true;   // (the main look on what's biggest per item: swapLooks)
  return out;
}
// the item groups a preset can have looks of its own for, and the preset's key of them
export const GROUP_LOOKS = { Capes: 'capes', Weapons: 'weapons', Vehicles: 'vehicles' };
// the primary and secondary looks swapped (a bySize preset on an item whose secondary covers more of it than its
// primary: /api/theme/sizes says which)
export function swapLooks(looks) {
  if (!looks) return looks;
  const out = { ...looks };
  [out.primary, out.secondary] = [looks.secondary, looks.primary];
  for (const r of ['primary', 'secondary']) if (!out[r]) delete out[r];
  return out;
}
// a preset's looks for an item group (its own for that group when it has them), without the groups' keys
export const looksOf = (P, group = '') => {
  const rest = { ...(P ?? {}) };
  for (const k of Object.values(GROUP_LOOKS)) delete rest[k];
  delete rest.bySize;
  const own = P?.[GROUP_LOOKS[group]];
  return own ? { ...rest, ...own } : rest;
};
Object.assign(PRESETS, {
  // showoff
  'Liquid Gold': T('#e0b04a', '#0c0b0a', '#141210', '#16130f', { pf: FIN.mirror, tf: FIN.gloss, hw: '#e0b04a', hwf: FIN.mirror, fuzz: [0.5, 0.4, 0.15] }),
  'Prism Knight': T('#eef0f2', '#0a0a0d', '#ffffff', '#1a1a1e', { pf: FIN.gloss, sf: [[6, 3, 0.3], [10, 0, 0.15]], sx: IRID(0.3, 1, 1.8), glow: '#f4f8ff', gv: 0.1, hw: '#c9ccd1', hwf: FIN.mirror }),
  'Hologram': T('#1a5ab4', '#0a2a5a', '#38e8ff', '#0a1a3a', { pf: FIN.gloss, glow: '#38e8ff', gv: 0.13, hw: '#1a2a40', fuzz: [0.1, 0.6, 0.8] }),
  'Nebula': T('#2a0d4a', '#120626', '#f4f0ff', '#1a0a30', { pc: CM(1, ['#2a0d4a', '#d03aa8', '#1a3aa8', '#0a0418'], 1.1), glow: '#f4f0ff', gv: 0.1, fuzz: [0.6, 0.3, 0.9] }),
  'Molten Chrome': T('#d0d4da', '#121214', '#ff6a10', '#141210', { pf: FIN.mirror, glow: '#ff6a10', gv: 0.13, hw: '#d0d4da', hwf: FIN.mirror }),
  'Aurora': T('#0e3a34', '#06100f', '#7dffb0', '#0a1a1a', { pf: [[6, 3, 0.3], [10, 0, 0.12], [8, 3, 0.8]], px: IRID(0.55, 1, 2), glow: '#7dffb0', gv: 0.1, fuzz: [0.3, 0.8, 0.6] }),
  'Black Diamond': T('#08080a', '#0c0c10', '#c9ccd1', '#0a0a0c', { pf: [[6, 3, 0.4], [10, 0, 0.08], [8, 3, 0.9]], px: IRID(0.4, 1, 1.4), sf: [[6, 3, 0.2], [10, 0, 0.2]], sx: IRID(0.2, 0.6, 1), tf: FIN.mirror, hw: '#c9ccd1', hwf: FIN.mirror }),
  'Ember Lord': T('#3a3230', '#0c0b0b', '#ff4a14', '#1e1614', { pf: FIN.matte, glow: '#ff4a14', gv: 0.15, hw: '#cfa13a', fuzz: [0.6, 0.15, 0.05] }),
  'Cyber Samurai': T('#a00a14', '#0c0c0d', '#d9a93c', '#e8e4dc', { pf: FIN.gloss, tf: FIN.metal, hw: '#d9a93c' }),
  'Overcharge': T('#0a4aff', '#e8f0ff', '#ffffff', '#0a1a40', { pf: FIN.gloss, glow: '#d8f0ff', gv: 0.13, hw: '#c9ccd1', hwf: FIN.mirror }),
  // classic camo
  'Woodland': T('#4a5a2e', '#2e2a1e', '#1e1e1a', '#4a4a32', { pc: CM(3, ['#4a5a2e', '#2e3a1a', '#5c4a30', '#16160f']), pf: FIN.matte, cc: CM(3, ['#4a4a32', '#2e3a1a', '#5c4a30', '#16160f']) }),
  'Desert Storm': T('#c2a878', '#6a5034', '#3a3026', '#b09a70', { pc: CM(1, ['#c2a878', '#a8865a', '#d8c49a', '#6a5034']), pf: FIN.matte, cc: CM(1, ['#b09a70', '#8e7250', '#c8b48a', '#5a4430']) }),
  'Urban Digital': T('#8a8e92', '#2e3034', '#e8e8e8', '#6a6e72', { pc: CM(0, ['#8a8e92', '#3a3c40', '#c8cacc', '#1e2024'], 2.2), pf: FIN.matte, cc: CM(0, ['#6a6e72', '#2e3034', '#a8aaae', '#16181a'], 2.2) }),
  'Tiger Stripe': T('#4a5a30', '#2a2418', '#141410', '#3e4a2a', { pc: CM(4, ['#4a5a30', '#141410', '#6a5232', '#0c0c0a'], 1.4), pf: FIN.matte, cc: CM(4, ['#3e4a2a', '#141410', '#5a4630', '#0c0c0a'], 1.4) }),
  'Snow Camo': T('#e8eaec', '#b8bcc0', '#1a1a1c', '#d8dadc', { pc: CM(1, ['#e8eaec', '#c4c8cc', '#ffffff', '#9aa0a6']), pf: FIN.matte, cc: CM(1, ['#d8dadc', '#b4b8bc', '#f4f4f4', '#8a9096']) }),
  'Night Woodland': T('#141a26', '#0c0e12', '#2a3a2a', '#12161e', { pc: CM(3, ['#141a26', '#0a0c12', '#1e2a22', '#05060a']), pf: FIN.matte, cc: CM(3, ['#12161e', '#0a0c12', '#1a2620', '#05060a']) }),
  'Flecktarn': T('#5a6440', '#2e3020', '#1a1a14', '#4e5838', { pc: CM(0, ['#5a6440', '#2e3a1e', '#6a5236', '#121210'], 1.8), pf: FIN.matte, cc: CM(0, ['#4e5838', '#2e3a1e', '#5e4a32', '#121210'], 1.8) }),
  'Jungle': T('#2a4a1e', '#1a1e14', '#8a7a52', '#9a8a62', { pc: CM(4, ['#2a4a1e', '#0e1a0a', '#3e6a24', '#0a0e08'], 1.3), pf: FIN.matte }),
  'Red Dirt': T('#8a3a1e', '#4a2416', '#1e1612', '#7a3e24', { pc: CM(1, ['#8a3a1e', '#5a2612', '#a8582e', '#2e1810']), pf: FIN.rough, cc: CM(1, ['#7a3e24', '#4a2416', '#94542e', '#2a1610']) }),
  'Marsh': T('#5a5a32', '#3a3420', '#22261a', '#4a3e2a', { pc: CM(3, ['#5a5a32', '#3a4a26', '#4a3e2a', '#1e2216']), pf: FIN.matte }),
  // faction and lore
  'Super Earth Standard': T('#e8b81a', '#121212', '#e8e4dc', '#2a2a2a', { pf: FIN.satin }),
  'Automaton Slayer': T('#5a5e66', '#16181b', '#ff2a1a', '#1a1b1d', { pf: FIN.satin, sc: CM(1, ['#16181b', '#5a1a14', '#2a2c30', '#0a0a0b']), glow: '#ff2a1a', gv: 0.12, hw: '#2a2c30' }),
  'Bug Stomper': T('#f2c214', '#121212', '#121212', '#2a2618', { pc: CM(4, ['#f2c214', '#0e0e0e', '#d8a810', '#0a0a0a'], 1.2), pf: FIN.satin }),
  'Squid Hunter': T('#2a1050', '#0e0818', '#20f0d0', '#140a24', { pf: FIN.gloss, glow: '#20f0d0', gv: 0.12, fuzz: [0.1, 0.7, 0.6] }),
  'Ministry of Truth': T('#eceae4', '#b0101a', '#0e0e0e', '#1a1a1a', { pf: FIN.satin, sf: FIN.gloss }),
  'Democracy Officer': T('#1a3a8a', '#e8e4dc', '#d9a93c', '#14244a', { pf: FIN.gloss, tf: FIN.metal, hw: '#cfa13a' }),
  'Penal Battalion': T('#e8640e', '#e8640e', '#101010', '#2a2a2a', { pf: FIN.rough, sc: CM(4, ['#e8640e', '#101010', '#c85410', '#0a0a0a'], 1.8) }),
  'Medic Corps': T('#f0f0ee', '#c8c8c6', '#d0101a', '#e0e0de', { pf: FIN.gloss, tf: FIN.gloss }),
  // flat colors
  'Matte Black': T('#141414', '#0c0c0c', '#262626', '#121212', { pf: FIN.matte, sf: FIN.matte, tf: FIN.matte, hw: '#1a1a1a', hwf: FIN.brushed }),
  'Arctic White': T('#f0f2f4', '#dcdfe2', '#6a6e72', '#e4e6e8', { pf: FIN.satin }),
  'Olive Drab': T('#4e5430', '#3a3e24', '#2a2c1c', '#4a4e30', { pf: FIN.matte, sf: FIN.matte }),
  'Navy and Steel': T('#16264a', '#8a9098', '#c8ccd2', '#121c34', { pf: FIN.satin, sf: FIN.brushed, tf: FIN.metal, hw: '#8a9098' }),
  'Sand Monotone': T('#c8b48c', '#b4a07a', '#8a7856', '#bca884', { pf: FIN.matte, sf: FIN.matte }),
  'Safety Orange': T('#ff6a0e', '#121212', '#121212', '#2a2a2a', { pf: FIN.gloss }),
  'Hunter Green and Tan': T('#1e3a24', '#c2ac80', '#3a2e1e', '#1a2e1e', { pf: FIN.satin }),
  'Gunmetal': T('#3a3c40', '#2a2c30', '#5a5e64', '#202224', { pf: FIN.brushed, sf: FIN.brushed, tf: FIN.metal, hw: '#4a4e54', hwf: FIN.brushed }),
  'Crimson and Black': T('#a00e1a', '#0e0e0e', '#1a1a1a', '#121212', { pf: FIN.gloss, sf: FIN.satin }),
  'Pastel Mint': T('#a8e8cc', '#f4f8f6', '#ffffff', '#8ad4b4', { pf: FIN.plastic }),
  // weird
  'Toy Soldier': T('#4a6a2a', '#4a6a2a', '#3a5420', '#4a6a2a', { pf: FIN.plastic, sf: FIN.plastic, tf: FIN.plastic, hw: '#4a6a2a', hwf: FIN.plastic }),
  'Candy Cane': T('#f4f4f2', '#d0101a', '#d0101a', '#f4f4f2', { pc: CM(4, ['#f4f4f2', '#d0101a', '#f4f4f2', '#b00e16'], 1.2), pf: FIN.gloss, sf: FIN.gloss }),
  'Watermelon': T('#2a8a2a', '#ff5a7a', '#0e0e0e', '#1a5a1a', { pf: FIN.gloss, sc: CM(0, ['#ff5a7a', '#0e0e0e', '#ff7a94', '#ff5a7a'], 2.6) }),
  'Bubblegum': T('#ffa8d0', '#a8d8ff', '#ffffff', '#ff8ac0', { pf: FIN.plastic, sf: FIN.plastic }),
  'Clown Car': T('#e0141e', '#1a3ae0', '#ffd814', '#1aa82a', { pf: FIN.plastic, sf: FIN.plastic, tf: FIN.plastic }),
  'Zombie': T('#6a7a5a', '#3a3e30', '#8a0e0e', '#4a4e3a', { pc: CM(1, ['#6a7a5a', '#4a5a3a', '#8a8a6a', '#2a2e22']), pf: FIN.rough, cc: CM(1, ['#4a4e3a', '#6a0e0e', '#5a5e48', '#2a2e22']) }),
  // (no camo; brown through and through, worn and filthy as far as the wear goes: brown rust over every edge and
  // chip and most of the paint, brown-black grime packed in every hollow, the grimiest surface texture at full bump,
  // shine only in greasy blotches)
  'Turd': (() => {
    const filth = (rust, heavy, crud) => [[21, 3, -1], [6, 3, -1], [0, 3, 0],
      [1, 0, 0], [1, 1, 2.2], [22, 0, 2.5],                                                // grime texture, deep bumps
      [4, 0, 9], [4, 1, 7], [4, 2, 10], [4, 3, 4], [1, 3, 1], [5, 3, 3],                  // worn everywhere it can be
      [6, 0, rust[0]], [6, 1, rust[1]], [6, 2, rust[2]], [5, 0, heavy[0]], [5, 1, heavy[1]], [5, 2, heavy[2]],
      [3, 0, 6], [3, 1, 4], [3, 2, -8], [3, 3, 10], [1, 2, 1.2], [2, 3, 2.5],             // grime caked on
      [2, 0, crud[0]], [2, 1, crud[1]], [2, 2, crud[2]], [22, 1, 0.9], [22, 2, 1],
      [10, 0, 0.62], [9, 0, 1.2], [9, 1, -0.9], [9, 2, 0.3], [9, 3, 0.8], [8, 3, 0.4], [8, 0, 0.3], [10, 2, 0]];
    const R = [0.36, 0.23, 0.12], H = [0.25, 0.15, 0.07], C = [0.14, 0.09, 0.05];   // (rust, the worst of it, grime: browns)
    return {
      primary: { c: '#5c3a1d', set: filth(R, H, C) },
      secondary: { c: '#4a2f17', set: filth(R, H, C) },
      trim: { c: '#3e2813', set: filth(R, H, C) },
      cloth: { c: '#4e331a', set: [[21, 3, -1], [12, 0, 0.26], [12, 1, 0.17], [12, 2, 0.08], [12, 3, 0.1], [1, 0, 0], [1, 1, 1.8], [22, 0, 2.5],
        [3, 0, 6], [3, 1, 4], [3, 3, 10], [1, 2, 1.2], [2, 0, C[0]], [2, 1, C[1]], [2, 2, C[2]], [10, 0, 0.9]] },
      hardware: { c: '#4a2e17', set: [[6, 3, -1], [10, 0, 0.7], [4, 0, 9], [4, 2, 10], [1, 3, 1], [6, 0, R[0]], [6, 1, R[1]], [6, 2, R[2]],
        [5, 0, H[0]], [5, 1, H[1]], [5, 2, H[2]], [1, 0, 0], [1, 1, 2], [22, 0, 2.5]] },
    };
  })(),
  // (one shade of pink on everything, glowing as hard as it can while it stays pink (stronger turns white; the
  // glow needs a smooth surface: roughness 0, no
  // highlights), no wear, camo or bumps: a pink hole where a Helldiver was)
  'Pink Void': (() => {
    const P = '#ff2bd6', flat = [...CLEAN, [21, 3, -1], [6, 3, -1], [0, 3, 0], [1, 1, 0], [22, 0, 0], [10, 0, 0], [9, 0, 0], [9, 1, 0], [9, 2, 0],
      [9, 3, 0], [8, 3, 0], [8, 0, 0], [8, 1, 0], [8, 2, 0], [10, 2, 0], [13, 0, 0.006], [14, 3, 0], [15, 3, 0],
      [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [1, 2, -2], [7, 0, 0], [7, 1, 0], [7, 2, 0], [7, 3, 0]];
    return { primary: { c: P, set: flat }, secondary: { c: P, set: flat }, trim: { c: P, set: flat }, glow: { c: P, set: flat },
      cloth: { c: P, set: [...flat, [12, 0, 1], [12, 1, 0.17], [12, 2, 0.84], [12, 3, 0], [13, 1, 0]] }, hardware: { c: P, set: flat } };
  })(),
  'Banana': T('#ffe01a', '#ffe01a', '#4a3010', '#f0d014', { pc: CM(0, ['#ffe01a', '#4a3010', '#f4d414', '#ffe01a'], 2.4), pf: FIN.plastic }),
  'Barbie Corps': T('#ff2a9a', '#f8f4f6', '#e0b04a', '#ff5ab4', { pf: FIN.gloss, tf: FIN.mirror, hw: '#e0b04a' }),
  'Rubber Duck': T('#ffd400', '#ffd400', '#ff7a00', '#ffd400', { pf: FIN.plastic, sf: FIN.plastic, tf: FIN.plastic }),
  'Cardboard': T('#a8865a', '#8e7048', '#141414', '#9a7c50', { pf: FIN.rough, sf: FIN.rough, tf: FIN.matte, hw: '#a8865a', hwf: FIN.rough }),
  'Vaporwave': T('#c8a0ff', '#80f0e8', '#ff7ac8', '#a880e0', { pc: CM(1, ['#c8a0ff', '#80f0e8', '#e8b0ff', '#a080e0'], 1.1), pf: FIN.plastic, glow: '#ff7ac8', gv: 0.1 }),
  'Inverse Helldiver': T('#1a1a1a', '#e8b81a', '#121212', '#e8b81a', { pf: FIN.satin, sf: FIN.satin }),
});


// the picker's categories of LUT Studio's own themes (the Destiny 2 shaders: by color family, the planet biomes their own)
const OWN_CATEGORIES = [
  ["Showpieces", ["Orange Tiger", "Desert", "Oil Slick", "Neon Circuit", "Gilded Emperor", "Volcanic", "Chrome Legion", "Synthwave", "Abyssal", "Ghost", "Carbon & Copper", "Bio-Hazard", "Royal Navy", "Blood Moon", "Arctic Phantom", "Liquid Gold", "Prism Knight", "Hologram", "Nebula", "Molten Chrome", "Aurora", "Black Diamond", "Ember Lord", "Cyber Samurai", "Zebra Prism", "Overcharge"]],
  ["Camo", ["Woodland", "Desert Storm", "Urban Digital", "Tiger Stripe", "Snow Camo", "Night Woodland", "Flecktarn", "Jungle", "Red Dirt", "Marsh"]],
  ["Faction and lore", ["Super Earth Standard", "Automaton Slayer", "Bug Stomper", "Squid Hunter", "Ministry of Truth", "Democracy Officer", "Penal Battalion", "Medic Corps"]],
  ["Flat colors", ["Matte Black", "Arctic White", "Olive Drab", "Navy and Steel", "Sand Monotone", "Safety Orange", "Hunter Green and Tan", "Gunmetal", "Crimson and Black", "Pastel Mint"]],
  ["Silly", ["Toy Soldier", "Candy Cane", "Watermelon", "Bubblegum", "Clown Car", "Zombie", "Turd", "Pink Void", "Banana", "Barbie Corps", "Rubber Duck", "Cardboard", "Vaporwave", "Inverse Helldiver"]],
];
export const CATEGORY_OF = {};   // preset -> its category
for (const [c, ns] of OWN_CATEGORIES) for (const n of ns) CATEGORY_OF[n] = c;
// Destiny 2's shaders (d2presets.js, made by tools/d2preset.py from Bungie's dye values: data/destiny2)
export const SEASON_OF = {};   // a Destiny 2 shader -> [its season (0: not known), the season's name]
for (const [n, family, season, seasonName, a] of D2_PRESETS) { PRESETS[n] = T(...a); CATEGORY_OF[n] = 'Destiny 2 · ' + family; SEASON_OF[n] = [season, seasonName]; }

// planet biomes: field camouflage for each of the game's planet biomes (as the SEAF swap theirs per planet), its colors
// the game's own albedos of the biome's ground (its terrain layers and the plants scattered on them by how much they
// cover, its big props: trees, palms, boulders, rock formations; its snow; graded as the game grades them), so that under the planet's light the armor and the ground take
// it alike (Light: Planets shows them so): primary the ground's main tone, secondary its second, trim a dark of it,
// cloth near the primary; as the game's own camo armors have it, the plates in the field color and the camo on the cloth
// (the fabric: under-suit, sleeves, cape), in those colors and the pattern of the biome's cover (woodland in forest,
// tiger stripes in jungle and swamp, mottled on open ground, speckle on bare rock); matte, no glow (it gives a soldier
// away). Names: the biomes' own (the wiki's)
Object.assign(PRESETS, {
  'Biome: Plains': T('#464e49', '#474d30', '#2d281e', '#414843', { pf: FIN.matte, cc: CM(3, ['#464e49', '#403a2b', '#7d7d7c', '#474d30']) }),
  'Biome: Ionic Crimson': T('#6d6967', '#504a47', '#3a160b', '#65615f', { pf: FIN.matte, cc: CM(1, ['#6d6967', '#541f0f', '#81807f', '#504a47']) }),
  'Biome: Scorched Moor': T('#756a61', '#4f4848', '#2d2925', '#6c6259', { pf: FIN.matte, cc: CM(1, ['#756a61', '#403a36', '#595353', '#4f4848']) }),
  'Biome: Tundra': T('#5c6262', '#6e550b', '#3f2b24', '#555a5a', { pf: FIN.matte, cc: CM(3, ['#5c6262', '#5a3d34', '#6e550b', '#50441f']) }),
  'Biome: Volcanic Jungle': T('#585341', '#614c21', '#443517', '#514c3c', { pf: FIN.matte, cc: CM(4, ['#585341', '#614c21', '#9c958a', '#686c0d'], 1.3) }),
  'Biome: Ionic Jungle': T('#48525b', '#2f363c', '#21262a', '#434b54', { pf: FIN.matte, cc: CM(4, ['#48525b', '#2f363c', '#4d4c3d', '#283f32'], 1.3) }),
  'Biome: Ethereal Jungle': T('#635e63', '#959699', '#36352b', '#5b575b', { pf: FIN.matte, cc: CM(4, ['#635e63', '#4d4c3d', '#b1a8aa', '#959699'], 1.3) }),
  'Biome: Deadlands': T('#686765', '#5b5a57', '#2f2e2e', '#605e5d', { pf: FIN.matte, cc: CM(3, ['#686765', '#434142', '#5b5a57', '#4d4a4a']) }),
  'Biome: Supercolony': T('#595444', '#696a12', '#3c2c13', '#524d3e', { pf: FIN.rough, cc: CM(1, ['#595444', '#563e1b', '#9b948b', '#696a12']) }),
  'Biome: Desert Dunes': T('#9a6943', '#c59661', '#54342d', '#8e613e', { pf: FIN.matte, cc: CM(1, ['#9a6943', '#784a41', '#c59661', '#8b5844']) }),
  'Biome: Desert Cliffs': T('#8b4f39', '#69564e', '#342d2b', '#804935', { pf: FIN.matte, cc: CM(1, ['#8b4f39', '#4b413d', '#69564e', '#62443e']) }),
  'Biome: Acidic Badlands': T('#b8a15a', '#a88a5c', '#69533a', '#a99453', { pf: FIN.matte, cc: CM(1, ['#b8a15a', '#957754', '#928e97', '#a88a5c']) }),
  'Biome: Rocky Canyons': T('#565151', '#605e5f', '#3c3939', '#4f4a4b', { pf: FIN.matte, cc: CM(1, ['#565151', '#704b42', '#605e5f', '#4d5d5e']) }),
  'Biome: Moon': T('#7d7e80', '#969694', '#4c4240', '#737475', { pf: FIN.matte, cc: CM(0, ['#7d7e80', '#6c5f5b', '#969694', '#787878'], 2.2) }),
  'Biome: Desert Oasis': T('#aa8c6c', '#ddb797', '#5a523d', '#9c8164', { pf: FIN.matte, cc: CM(1, ['#aa8c6c', '#817557', '#ddb797', '#cbaa91']) }),
  'Biome: Bleak Oasis': T('#73706e', '#3e3b38', '#2b2927', '#6a6765', { pf: FIN.matte, cc: CM(1, ['#73706e', '#3e3b38', '#585857', '#464542']) }),
  'Biome: Icy Glaciers': T('#dbdbdb', '#8a96a0', '#3e4650', '#cacaca', { pf: FIN.matte, cc: CM(1, ['#dbdbdb', '#657178', '#f0f2f4', '#8a96a0']) }),
  'Biome: Boneyard': T('#8e98a2', '#484a4a', '#2c2e30', '#848c94', { pf: FIN.matte, cc: CM(1, ['#8e98a2', '#484a4a', '#c8daeb', '#5e6266']) }),
  'Biome: Cyberstan Megafactory': T('#5e6064', '#424646', '#2a2c2e', '#56585c', { pf: FIN.matte, cc: CM(1, ['#5e6064', '#424646', '#a8b8c8', '#533b3a']) }),
  'Biome: Basic Swamp': T('#453e2e', '#53523a', '#312b20', '#40392a', { pf: FIN.matte, cc: CM(4, ['#453e2e', '#43491f', '#5f594b', '#53523a'], 1.3) }),
  'Biome: Haunted Swamp': T('#635843', '#504e41', '#38362d', '#5b513e', { pf: FIN.matte, cc: CM(4, ['#635843', '#504e41', '#7b7567', '#6a6761'], 1.3) }),
  'Biome: Deciduous Forest': T('#524f36', '#5a5e1c', '#393726', '#4b4832', { pf: FIN.matte, cc: CM(3, ['#524f36', '#5a5e1c', '#7b7666', '#6a6762']) }),
  'Biome: Autumn Forest': T('#664d31', '#6b635a', '#473622', '#5e472d', { pf: FIN.matte, cc: CM(3, ['#664d31', '#6f4d02', '#7d636c', '#6b635a']) }),
  'Biome: Crimson Forest': T('#5b100f', '#797778', '#400b0a', '#540f0e', { pf: FIN.matte, cc: CM(1, ['#5b100f', '#534342', '#797778', '#686562']) }),
  'Biome: Coniferous (unreleased)': T('#4f4532', '#6f664b', '#2c2a0b', '#483f2e', { pf: FIN.matte, cc: CM(3, ['#4f4532', '#3f3d0f', '#6f664b', '#545819']) }),
  'Biome: Hive World': T('#a99e8f', '#a58e6c', '#50433b', '#9b9284', { pf: FIN.rough, cc: CM(1, ['#a99e8f', '#726054', '#a4a29e', '#a58e6c']) }),
  'Biome: Magma Desert': T('#353331', '#504d4b', '#1f1b0f', '#31302e', { pf: FIN.rough, cc: CM(1, ['#353331', '#1f1b0f', '#504d4b', '#46403c']) }),
  'Biome: Void Source Forest': T('#514938', '#474f22', '#393327', '#4b4333', { pf: FIN.matte, cc: CM(3, ['#514938', '#474f22', '#878475', '#5e542f']) }),
  'Biome: Super Earth Metropolis': T('#6a6a66', '#3a3c3e', '#1a1c1e', '#5a5a56', { pf: FIN.matte, cc: CM(1, ['#6a6a66', '#3a3c3e', '#8e8c86', '#222426']) }),
});
// planet biomes, city: the mega cities on a biome's planets (the game's *_city resource overrides: Super Earth's city,
// its trees and bushes swapped for the biome's), each lit by its planet (Light: Planets, "<biome> City"); primary the
// city's big props (its buildings' and rubble's albedo, the same in every biome), secondary the biome's ground (its
// snow on the arctic ones), trim the streets' oil-dark asphalt, cloth near the primary; the urban digital pattern on
// the cloth in the city's and the ground's colors; matte
const CITY = (ground, rubble = '#72706a') => T('#888483', ground, '#1d1c21', '#7a7774', { pf: FIN.matte, cc: CM(0, ['#888483', ground, rubble, '#2a2928'], 2.2) });
Object.assign(PRESETS, {
  'Biome: Desert Dunes City': CITY('#ba8b57'),
  'Biome: Desert Cliffs City': CITY('#8b4c36'),
  'Biome: Acidic Badlands City': CITY('#b8a15a'),
  'Biome: Rocky Canyons City': CITY('#5f5351', '#a29f98'),
  'Biome: Moon City': CITY('#949392', '#5a5856'),
  'Biome: Icy Glaciers City': CITY('#dbdbdb', '#4e5256'),
  'Biome: Boneyard City': CITY('#c8daeb', '#4b4c4c'),
  'Biome: Cyberstan Megafactory City': CITY('#c8daeb', '#6e6251'),
});

// planet biomes, showcase: each biome's look turned up for show, the counterpart of its field camo (its signature color
// bright, gloss and metal, the glow of its light: lava, auroras, fireflies, spores, lightning). Where a theme above is
// that look already it is the base (Magma Desert: Volcanic); each tuned to its planet's light (onPlanet)
const SC = ' (showcase)';
// onPlanet: a look with its colors swapped ({old hex: new hex}: each solved back through its planet's exposure and
// grading to show there as picked, its hue kept; never darker), the look it was made from left as it is
// glow: its glow made that much stronger (a dark look lit by its glow: the planet's exposure dims the plates around it)
function onPlanet(look, swap, glow = 1) {
  return JSON.parse(JSON.stringify(look), (k, v) => {
    if (typeof v === 'string' && swap[v.toLowerCase()]) return swap[v.toLowerCase()];
    if (Array.isArray(v) && v.length === 3 && v[0] === 13 && v[1] === 0) return [13, 0, Math.min(0.15, v[2] * glow)];   // (the glow's top)
    return v;
  });
}
Object.assign(PRESETS, {
  ['Biome: Plains' + SC]: onPlanet(T('#4a6a34', '#3a4048', '#d8e8ff', '#2e3a28', { pf: FIN.satin, cc: CM(3, ['#4a6a34', '#2e4022', '#7a7466', '#1a1e16']), glow: '#d8e8ff', gv: 0.07, hw: '#8a9098', hwf: FIN.brushed }), {'#4a6a34': '#4f7138', '#3a4048': '#3d454f', '#d8e8ff': '#dceded', '#2e3a28': '#323e2b', '#2e4022': '#324525', '#7a7466': '#827c6d', '#1a1e16': '#1c2118', '#8a9098': '#909aa7'}),
  ['Biome: Ionic Crimson' + SC]: onPlanet(PRESETS['Blood Moon'], {'#8a0a16': '#980c19', '#0a0707': '#130f0f', '#ff1a1a': '#ed0b0b', '#0e0606': '#180d0d', '#2a1a1a': '#3a2525'}, 1.6),
  ['Biome: Scorched Moor' + SC]: onPlanet(PRESETS['Ember Lord'], {'#3a3230': '#473e3b', '#0c0b0b': '#0e0d0d', '#ff4a14': '#ed4e0b', '#1e1614': '#211816', '#cfa13a': '#dcab3e'}, 1.5),
  ['Biome: Tundra' + SC]: onPlanet(T('#b0662a', '#3a4446', '#e8c040', '#3e4a3a', { pf: FIN.satin, cc: CM(3, ['#3e4a3a', '#b0662a', '#7a2a1e', '#1e2220']), tf: FIN.metal, hw: '#a07040', hwf: FIN.brushed }), {'#b0662a': '#cd640b', '#3a4446': '#3e494b', '#e8c040': '#edca0b', '#3e4a3a': '#434f3e', '#7a2a1e': '#822d21', '#1e2220': '#212523', '#a07040': '#b57413'}),
  ['Biome: Volcanic Jungle' + SC]: onPlanet(T('#5a9a34', '#1a2a12', '#ff8a2a', '#24361a', { pf: FIN.satin, pc: CM(4, ['#3e6a2a', '#1a2a12', '#5a8a34', '#0c120a'], 1.3), glow: '#ff8a2a', gv: 0.07 }), {'#3e6a2a': '#477831', '#1a2a12': '#25391a', '#5a8a34': '#619438', '#0c120a': '#0b150b', '#ff8a2a': '#eda60b', '#24361a': '#314724'}, 1.8),
  ['Biome: Ionic Jungle' + SC]: onPlanet(PRESETS['Abyssal'], {'#0b1a2e': '#0d1c32', '#05101e': '#0b1222', '#12304a': '#14344f', '#020812': '#0b0b19', '#06101c': '#0b1220', '#00ffc8': '#0bedc2', '#07121e': '#0b1421', '#1a2630': '#1c2934'}, 1.6),
  ['Biome: Ethereal Jungle' + SC]: onPlanet(PRESETS['Nebula'], {'#2a0d4a': '#572391', '#d03aa8': '#ed7aed', '#1a3aa8': '#356aed', '#0a0418': '#1f113a', '#120626': '#2e1754', '#f4f0ff': '#ededed', '#1a0a30': '#3e1f67'}),
  ['Biome: Deadlands' + SC]: onPlanet(T('#8a8a86', '#2e2e2e', '#b48aff', '#4a4a4a', { pf: FIN.satin, pc: CM(1, ['#8a8a86', '#5a5a58', '#a8a8a4', '#2e2e2e']), glow: '#b48aff', gv: 0.08 }), {'#8a8a86': '#93938f', '#5a5a58': '#60605e', '#a8a8a4': '#b3b3af', '#2e2e2e': '#404040', '#b48aff': '#cb83ed', '#4a4a4a': '#555555'}, 1.8),
  ['Biome: Supercolony' + SC]: onPlanet(T('#c8a030', '#2a2214', '#f0d040', '#3a3020', { pf: FIN.satin, pc: CM(1, ['#c8a030', '#6a5a2a', '#e0c050', '#2a2214']), glow: '#f0d040', gv: 0.08 }), {'#c8a030': '#edbe3b', '#6a5a2a': '#8a7639', '#e0c050': '#eded40', '#2a2214': '#423623', '#f0d040': '#eded0b', '#3a3020': '#574932'}, 1.4),
  ['Biome: Desert Dunes' + SC]: onPlanet(T('#e0b060', '#3a2010', '#fff0c0', '#5a3a22', { pf: FIN.gloss, cc: CM(1, ['#d8a868', '#a86a3a', '#f0d0a0', '#5a3a22']), glow: '#fff0c0', gv: 0.06, hw: '#d8a83c', hwf: FIN.mirror }), {'#e0b060': '#edda0b', '#3a2010': '#6f4226', '#fff0c0': '#ededed', '#5a3a22': '#8b5c39', '#d8a868': '#edc966', '#a86a3a': '#d1854a', '#f0d0a0': '#ededed', '#d8a83c': '#edc91b'}),
  ['Biome: Desert Cliffs' + SC]: onPlanet(T('#c8501a', '#2a120a', '#ffb050', '#3a1a0e', { pf: FIN.gloss, cc: CM(1, ['#c8501a', '#7a2a0e', '#e87a2a', '#2a120a']), glow: '#ffb050', gv: 0.06, hw: '#b87333' }), {'#c8501a': '#df4d0b', '#2a120a': '#3c1c12', '#ffb050': '#edb00b', '#3a1a0e': '#472113', '#7a2a0e': '#822d10', '#e87a2a': '#ed690b', '#b87333': '#cc770b'}),
  ['Biome: Acidic Badlands' + SC]: onPlanet(PRESETS['Bio-Hazard'], {'#7cff1a': '#27ed0b', '#0a0a0a': '#1f1f1f', '#4fb810': '#69ed18', '#080808': '#1b1b1b', '#0e0f0d': '#272925', '#9dff2a': '#96ed0b', '#141812': '#323a2e', '#2a2e26': '#555c4e'}, 1.5),
  ['Biome: Rocky Canyons' + SC]: onPlanet(T('#b8693a', '#1e1a18', '#e8a070', '#2a2220', { pf: FIN.brushed, cc: CM(1, ['#9a4e2e', '#5a2a1a', '#6a6a50', '#1e1a18']), tf: FIN.metal, hw: '#b87333', hwf: FIN.brushed }), {'#b8693a': '#d7650b', '#1e1a18': '#211c1a', '#e8a070': '#ed9f0b', '#2a2220': '#2d2523', '#9a4e2e': '#a7522c', '#5a2a1a': '#602d1c', '#6a6a50': '#717156', '#b87333': '#d7720b'}),
  ['Biome: Moon' + SC]: onPlanet(T('#b4b8bc', '#2a2e34', '#e8f0ff', '#3a3e44', { pf: FIN.brushed, cc: CM(0, ['#8e9298', '#5a5e66', '#c8ccd0', '#2a2e34'], 2.2), glow: '#e8f0ff', gv: 0.06, hw: '#c9ccd1', hwf: FIN.mirror }), {'#b4b8bc': '#cfd5db', '#2a2e34': '#474e57', '#e8f0ff': '#ededed', '#3a3e44': '#595e67', '#8e9298': '#a4a9b0', '#5a5e66': '#757a85', '#c8ccd0': '#ededed', '#c9ccd1': '#ededed'}),
  ['Biome: Desert Oasis' + SC]: onPlanet(T('#d0b47a', '#3e6a2e', '#2ab0c8', '#5a4a30', { pf: FIN.satin, cc: CM(1, ['#d0b47a', '#3e6a2e', '#e4cc96', '#8a6a44']), glow: '#2ab0c8', gv: 0.06, hw: '#d8a83c', hwf: FIN.brushed }), {'#d0b47a': '#ededce', '#3e6a2e': '#81d363', '#2ab0c8': '#0beded', '#5a4a30': '#b69867', '#e4cc96': '#ededed', '#8a6a44': '#edc985', '#d8a83c': '#eded0b'}),
  ['Biome: Bleak Oasis' + SC]: onPlanet(T('#5a6278', '#1a1c24', '#a8b8ff', '#2e3240', { pf: FIN.satin, cc: CM(1, ['#5a6278', '#2e3240', '#8a94b0', '#14161d']), glow: '#a8b8ff', gv: 0.08, hw: '#9aa3b4', hwf: FIN.brushed }), {'#5a6278': '#5b698c', '#1a1c24': '#202433', '#a8b8ff': '#a5c2ed', '#2e3240': '#32384d', '#8a94b0': '#8c9eca', '#14161d': '#1a1e2b', '#9aa3b4': '#9eaeca'}),
  ['Biome: Icy Glaciers' + SC]: onPlanet(PRESETS['Arctic Phantom'], {'#e8eef2': '#ededed', '#b8c8d4': '#ededed', '#ffffff': '#ededed', '#8fa4b4': '#ededed', '#5a6a78': '#a3bed5', '#7fd8ff': '#e5eded', '#c8d2da': '#ededed', '#c8d4dc': '#ededed'}),
  ['Biome: Boneyard' + SC]: onPlanet(T('#d8d0c0', '#2a2c30', '#c06a2a', '#3a3c40', { pf: FIN.satin, cc: CM(1, ['#2a2c30', '#d8d0c0', '#4a4e54', '#6e4a22']), hw: '#8a9098', hwf: FIN.brushed }), {'#d8d0c0': '#ededed', '#2a2c30': '#5b5f66', '#c06a2a': '#edb30b', '#3a3c40': '#70737a', '#4a4e54': '#818891', '#6e4a22': '#bb8140', '#8a9098': '#c8d1dc'}),
  ['Biome: Cyberstan Megafactory' + SC]: onPlanet(PRESETS['Automaton Slayer'], {'#5a5e66': '#9298a5', '#16181b': '#363a3f', '#5a1a14': '#b63e32', '#2a2c30': '#5b5f66', '#0a0a0b': '#1f1f21', '#ff2a1a': '#ed400b', '#1a1b1d': '#3e3f43'}, 1.6),
  ['Biome: Basic Swamp' + SC]: onPlanet(T('#4a5a2e', '#2a2414', '#d8ff6a', '#3a3420', { pf: FIN.satin, cc: CM(4, ['#4a5a2e', '#2a2414', '#6e7a3a', '#141208'], 1.3), glow: '#d8ff6a', gv: 0.08 }), {'#4a5a2e': '#4f6032', '#2a2414': '#2d2716', '#d8ff6a': '#eded0b', '#3a3420': '#3e3823', '#6e7a3a': '#75823d', '#141208': '#16140b'}, 1.6),
  ['Biome: Haunted Swamp' + SC]: onPlanet(PRESETS['Ghost'], {'#b9c4cc': '#bfd2df', '#4a5560': '#4f5b67', '#9fe8ff': '#9aeded', '#3c464f': '#404b55', '#9aa3aa': '#a3aeb7'}, 1.5),
  ['Biome: Deciduous Forest' + SC]: onPlanet(T('#5a8a3a', '#4a3a24', '#e8c84a', '#2e4a20', { pf: FIN.satin, cc: CM(3, ['#5a8a3a', '#2e4a20', '#8aa850', '#1a2410']), tf: FIN.gloss, hw: '#c8a050', hwf: FIN.brushed }), {'#5a8a3a': '#5a952d', '#4a3a24': '#4f3e27', '#e8c84a': '#edd40b', '#2e4a20': '#324f23', '#8aa850': '#8bb60b', '#1a2410': '#1c2712', '#c8a050': '#e2a80b'}),
  ['Biome: Autumn Forest' + SC]: onPlanet(T('#c8582a', '#3a1e10', '#e8a830', '#7a2a14', { pf: FIN.satin, cc: CM(3, ['#c8582a', '#7a2a14', '#e8a830', '#2a140a']), tf: FIN.metal, hw: '#e8a830', hwf: FIN.brushed }), {'#c8582a': '#ed3c0b', '#3a1e10': '#3e2112', '#e8a830': '#edab0b', '#7a2a14': '#8e200b', '#2a140a': '#2d160b'}),
  ['Biome: Crimson Forest' + SC]: onPlanet(T('#9e1f2a', '#5a5460', '#e0d0e8', '#4a1018', { pf: FIN.satin, cc: CM(3, ['#9e1f2a', '#4a1018', '#c8bccc', '#2a1a1e']), tf: FIN.gloss, hw: '#c8bccc', hwf: FIN.brushed }), {'#9e1f2a': '#c70b0b', '#5a5460': '#63586c', '#e0d0e8': '#eddaed', '#4a1018': '#4f121a', '#c8bccc': '#dac6e0', '#2a1a1e': '#2d1c21'}),
  ['Biome: Coniferous (unreleased)' + SC]: onPlanet(T('#2e4a34', '#e8ecee', '#c8a050', '#1a2a1e', { pf: FIN.satin, cc: CM(3, ['#2e4a34', '#1a2a1e', '#4a3a2a', '#e8ecee']), tf: FIN.metal, hw: '#c8a050', hwf: FIN.brushed }), {'#2e4a34': '#324f38', '#e8ecee': '#ededed', '#c8a050': '#e0a80b', '#1a2a1e': '#1c2d21', '#4a3a2a': '#4f3e2d'}),
  ['Biome: Hive World' + SC]: onPlanet(PRESETS['Bug Stomper'], {'#f2c214': '#edcb0b', '#0e0e0e': '#181818', '#d8a810': '#edb00b', '#0a0a0a': '#141414', '#121212': '#1c1c1c', '#2a2618': '#312d1d'}),
  ['Biome: Magma Desert' + SC]: onPlanet(PRESETS['Volcanic'], {'#110e0d': '#161312', '#c8300a': '#eb0b0b', '#d8340a': '#ed0b0b', '#120706': '#1e0e0d', '#ff5a10': '#ed0b0b', '#0b0403': '#160b0b', '#ff6a10': '#ed3d0b', '#151110': '#191513', '#2a2421': '#2d2724'}, 1.4),
  ['Biome: Void Source Forest' + SC]: onPlanet(PRESETS['Hologram'], {'#1a5ab4': '#20b6ed', '#0a2a5a': '#1f5cb6', '#38e8ff': '#76eded', '#0a1a3a': '#1f3e7a', '#1a2a40': '#3e5c85'}),
  ['Biome: Super Earth Metropolis' + SC]: onPlanet(PRESETS['Super Earth Standard'], {'#e8b81a': '#edc00b', '#121212': '#151515', '#e8e4dc': '#edede5', '#2a2a2a': '#2d2d2d'}),
});

// the presets as <option>s: the themes, then the planet biomes' camo and their showcase looks, each in a group of its
// own (shown without "Biome: ")
const CATEGORY_ORDER = ['Showpieces', 'Camo', 'Faction and lore', 'Flat colors', 'Silly',
  ...['Reds', 'Oranges and golds', 'Yellows', 'Greens', 'Teals', 'Blues', 'Purples', 'Pinks', 'Whites', 'Grays', 'Blacks'].map(f => 'Destiny 2 · ' + f)];
// how the picker groups the Destiny 2 shaders: 'season' (by the season they came in) or 'color' (by their main
// color); kept in this browser
export function d2Grouping(set) {
  try { if (set) localStorage.setItem('lutstudio.d2By', set); return localStorage.getItem('lutstudio.d2By') === 'color' ? 'color' : 'season'; } catch { return set ?? 'season'; }
}
const seasonLabel = ([n, name]) => (n ? `Destiny 2 · Season ${n}${name ? ': ' + name : ''}` : 'Destiny 2 · season not known');
export function presetOptions(value = n => n, by = d2Grouping()) {
  const all = Object.keys(PRESETS), biome = n => n.startsWith('Biome: '), show = n => n.endsWith(' (showcase)');
  const opt = (n, label = n) => `<option value="${esc(value(n))}">${esc(label)}</option>`;
  const seasons = [...new Set(Object.values(SEASON_OF).map(s => s[0]))].sort((a, b) => (a || 99) - (b || 99))
    .map(n => seasonLabel(Object.values(SEASON_OF).find(s => s[0] === n)));
  const order = by === 'season' ? [...CATEGORY_ORDER.filter(c => !c.startsWith('Destiny 2')), ...seasons] : CATEGORY_ORDER;
  const groups = new Map(order.map(c => [c, []]));
  for (const n of all.filter(n => !biome(n))) {
    const c = by === 'season' && SEASON_OF[n] ? seasonLabel(SEASON_OF[n]) : CATEGORY_OF[n] ?? 'More themes';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(n);
  }
  const sorted = ns => ns.sort((x, y) => x.localeCompare(y));
  return [...groups].filter(([, ns]) => ns.length).map(([c, ns]) => `<optgroup label="${esc(c)} (${ns.length})">${sorted(ns).map(n => opt(n)).join('')}</optgroup>`).join('') +
    `<optgroup label="Planet biomes">${all.filter(n => biome(n) && !show(n)).map(n => opt(n, n.slice(7))).join('')}</optgroup>
    <optgroup label="Planet biomes: showcase">${all.filter(n => biome(n) && show(n)).map(n => opt(n, n.slice(7))).join('')}</optgroup>`;
}
// a search box over a preset <select>: the options whose names don't have the words typed hidden (and their groups,
// when empty); the select's first option (no preset) always shown
export function presetSearch(input, select) {
  input.oninput = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const g of select.querySelectorAll('optgroup')) {
      let any = false;
      for (const o of g.querySelectorAll('option')) {
        const hit = !words.length || words.every(w => (o.textContent + ' ' + g.label).toLowerCase().includes(w));
        o.hidden = !hit; any ||= hit;
      }
      g.hidden = !any;
    }
  };
}
const unhexc = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// a preset's look of a role over a row on screen: its color (paint, secondary, wear), its fields, its camo
// role: trim, hardware or glow get no camo unless the look brings one (a zone's own camo in a light trim or metal
// color reads as white blotches, e.g. on the A-9 Helljumper's camo hips and legs)
export function presetRow(row, L, role = '') {
  let out = row.slice();
  const c = unhexc(L.c);
  for (const [col, f] of [[0, 1], [2, 0.8], [5, 0.9], [6, 0.9]]) for (let k = 0; k < 3; k++) out[col * 4 + k] = c[k] * f;
  for (const [col, ch, v] of L.set ?? []) out[col * 4 + ch] = v;
  if (L.camo) out = withCamo(out, { ...L.camo, colors: L.camo.colors.map(unhexc) });
  else if (/^(trim|hardware|glow)$/.test(role)) out[21 * 4 + 3] = -1;
  else if (out[21 * 4 + 3] !== -1) for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) out[(16 + j) * 4 + k] = c[k] * [1, 0.55, 1.25, 0.3][j];
  return out;
}
// a preset as the showcase scene takes it (scene.js render): its colors (for the scene's light) and its looks over
// each item's own zones (as the Theme panel's preview: each role's look over the item's biggest zone of that role,
// else its primary's); metal: the metal parts' color (paint metal parts), or null
export function presetTheme(name, metal = null) {
  const P = PRESETS[name], colors = [], walk = (v, role) => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) colors.push([role, v]);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, role ?? k);
  };
  walk(P, null);
  return { name: name.replace(/^Biome: /, ''), colors, bySize: !!P.bySize, looksFor: (zs, rowOf, group = '') => {   // (group: an item's, its own looks)
    const biggest = n => zs.filter(x => x.role === n && x.w === W).sort((a, b) => b.cov - a.cov)[0];
    const any = biggest('primary') ?? biggest('secondary') ?? zs.find(x => x.w === W && x.role !== 'unused');
    const looks = {};
    for (const [n, L] of Object.entries(looksOf(P, group))) {
      const x = n === 'hardware' ? biggest('hardware') : biggest(n) ?? any;
      if (x) looks[n] = presetRow(rowOf(x), n === 'hardware' && metal ? { ...L, c: metal } : L, n);
    }
    if (metal && !P.hardware) {
      const x = biggest('hardware');
      if (x) { const row = rowOf(x), c = unhexc(metal); for (const col of [0, 5, 6]) for (let k = 0; k < 3; k++) row[col * 4 + k] = c[k]; looks.hardware = row; }
    }
    return looks;
  } };
}
// a look on a zone, as the server applies it (theme.go): a zone that is cloth in the game but has another role takes
// the look's colors only (paint, secondary, wear, camo), keeping its cloth finish
export function putLook(px, l, z, look, role) {
  const base = z * l.w * 4, cloth = Math.round((l.vanilla ?? px)[base + 3]) === 1 && role !== 'cloth';   // (the game's mode, as Apply decides)
  // (column 20's r, g, b: the build mark's, which a theme never writes: lut/mark.go)
  if (!cloth) { for (let i = 0; i < look.length && i < l.w * 4; i++) if (i >> 2 !== 20 || (i & 3) === 3) px[base + i] = look[i]; return; }
  for (const col of [0, 2, 5, 6]) for (let k = 0; k < 3; k++) px[base + col * 4 + k] = look[col * 4 + k];
  if (look[21 * 4 + 3] !== -1) for (let col = 16; col <= 21; col++) for (let k = 0; k < 4; k++) if ((col !== 16 || k < 3) && (col !== 20 || k === 3)) px[base + col * 4 + k] = look[col * 4 + k];
  else tonalCamo(px, base, look, l.vanilla);
}

// app: { R, api, variant, lut(hash), lutLabel(hash), showItem(value), current() -> item values on screen, saveAll(),
// projectLuts() -> the LUTs in the project (Set),
// refresh() (the project and the variant again), status(msg), track(event, props) }
// opts.item: open on "Recolor this item" (applied to the item on screen only; the panel's other mode: every item of
// the kinds ticked). A "lutstudio:recolor" event on document switches an open panel to it.
export async function themeDialog(app, opts = {}) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const R = app.R;
  await app.saveAll();
  // (the first time: the game's materials are scanned for the LUTs items share, some seconds; the editor starts it
  // in the background after a project opens, so it's usually done by now)
  let said = false;
  const slow = setTimeout(() => { said = true; app.status('Opening the theme panel… (the first time: the game materials are read, a few seconds)'); }, 300);
  const data = await app.api('/api/roles').finally(() => clearTimeout(slow));
  if (said) app.status('');   // (only its own message: a save failure's stays)
  const names = data.names.filter(n => n !== 'keep' && n !== 'unused');
  // the LUTs on screen, the roles of their zones (saved, else suggested) and each zone's share: read again when the
  // item on screen changes (screenZones)
  let onScreen = [], zones = [];   // zones: {lut, z, role, cov}
  let zonesGen = 0;   // (items switched quickly: only the last one's answers are taken)
  const screenZones = async () => {
    const gen = ++zonesGen;
    const on = [...new Set(R.pieces.map(p => p.info.lut))].filter(h => app.lut(h)?.kind === 'material');
    let sug = {};
    try { sug = await app.api(`/api/roles/suggest?variant=${encodeURIComponent(app.variant)}&luts=${on.join(',')}`); } catch { }
    if (gen !== zonesGen) return;
    const zs = [];
    for (const h of on) {
      const l = app.lut(h), roles = data.mine[h] ?? data.builtin[h] ?? sug[h]?.roles ?? [];
      for (let z = 0; z < l.h; z++) zs.push({ lut: h, z, role: roles[z] ?? 'keep', cov: sug[h]?.coverage?.[z] ?? 0 });
    }
    onScreen = on; zones = zs;
  };
  await screenZones();
  // LUTs whose roles are only suggested: not in roles.json, not yours, not of a reviewed group's item (armor, weapons);
  // named by the kind of item they're on
  const reviewed = new Set(data.reviewed ?? []), groupOf = new Map();
  for (const it of data.items ?? []) for (const l of it.luts) if (!groupOf.has(l.lut)) groupOf.set(l.lut, it.group);
  const guessed = onScreen.filter(h => !data.mine[h] && !data.builtin[h] && !reviewed.has(h));
  const guessedOn = [...new Set(guessed.map(h => groupOf.get(h) ?? 'other'))].map(g => g.toLowerCase()).join(', ');
  // the source zone of each role: the biggest of that role on screen
  const pick = {}, camo = {};   // camo[role]: {layer, colors: 4 x rgb, tiling}
  for (const n of names) pick[n] = zones.filter(x => x.role === n).sort((a, b) => b.cov - a.cov)[0] ?? null;
  const shownGroups = new Set((data.items ?? []).filter(it => app.current().includes(it.value)).map(it => it.group));
  if (!(await closeSide())) return;   // (a panel opened while this one loaded)
  const close = openSide(`<h3 id="thTitle">Theme everything like this</h3>
    <div class="row"><input type="search" id="thSearch" placeholder="Search presets (name or group: red, camo, Destiny 2…)" title="Shows only the presets whose name or group has these words" style="flex:1;min-width:0">
      <select id="thD2By" title="How the Destiny 2 shaders are grouped in the list"><option value="season">Destiny 2 by season</option><option value="color">Destiny 2 by color</option></select></div>
    <div class="row"><label>Preset <select id="thPreset" title="A ready-made theme: each role's look from it (over the item's own zones); or your own, from the zones below">
      <option value="">(my own: the zones below)</option>${presetOptions()}</select></label>
      <button id="thPreview" title="Show the theme on the item on screen, without changing anything">Preview on screen</button>
      <button id="thShow" title="Showcase mode with these looks: key art, live in the viewport (three Helldivers with their weapons, gear and vehicles); move the camera, tune the look, save a 4K image (nothing in the mod changes)">Showcase</button></div>

    <p class="hint">Each role's look comes from a zone of the item on screen (all its settings, not only the color);
      a role can also get a camo pattern over it.
      Every zone of that role on the items you choose gets it, in this variant (${esc(app.variant)}). Items not in
      the mod yet are added. Zones you changed by hand since the last theme are kept.</p>
    ${guessed.length ? `<p class="warn">The zone roles of ${guessed.length === 1 ? 'one LUT' : guessed.length + ' LUTs'} on screen (${esc(guessedOn)}) are suggested only, not reviewed yet: a look may land on the wrong zone there; check the result.</p>` : ''}
    <div id="thPalette"></div>
    <div class="row"><label class="check" title="Metal parts (barrels, bolts, buckles: the hardware role) take this color and keep their metal finish; off: they keep the game's metal"><input type="checkbox" id="thMetal"> paint metal parts</label>
      <input type="color" id="thMetalColor" value="#2a2a2a" title="the metal parts' color"></div>
    <div class="row"><label class="check" title="Recolor the decals too (emblems, markings, stencils) in the theme's colors: their decal sheets, which other items may share"><input type="checkbox" id="thDecals"> also theme decals</label>
      <select id="thDecalMode" title="How decals take the theme's colors"><option value="two">light parts trim, dark parts secondary</option><option value="one">all in the trim color</option></select></div>
    <p class="hint" id="thDecalNote" hidden>A decal sheet is shared: every item drawing from a recolored sheet shows its decals in the theme's colors, items you didn't theme too. Each recolored sheet adds about 5 MB to the mod.</p>
    <h3>Apply to</h3>
    <div class="row"><label class="check" title="Only the armor, helmet and cape (or the item) on screen"><input type="radio" name="thTarget" value="item" ${opts.item ? 'checked' : ''}> the item on screen</label>
      <label class="check" title="Every item of the kinds ticked below"><input type="radio" name="thTarget" value="groups" ${opts.item ? '' : 'checked'}> every item of these kinds:</label></div>
    <div class="row" id="thGroups">${GROUPS.map(g => `<label class="check"><input type="checkbox" class="thGroup" value="${g}" ${shownGroups.has(g) || (!shownGroups.size && DEFAULT_GROUPS.includes(g)) ? 'checked' : ''}> ${g}</label>`).join('')}</div>
    <label class="check" id="thHeldRow" hidden title="The weapon the Helldiver holds is themed too (the same switch as Weapons)"><input type="checkbox" id="thHeld"> and the weapon in hand</label>
    <label class="check"><input type="checkbox" id="thOnly"> only items already in this mod</label>
    <label class="check"><input type="checkbox" id="thOverwrite"> also overwrite zones I changed by hand</label>
    <p class="hint" id="thCount"></p>
    <div class="row"><button id="thApply" class="primary">Apply theme</button>
      <button id="thUndo" hidden title="Put every file the last theme changed back as it was before it (zones, added LUTs, decal sheets)">Undo theme</button></div>
    <p class="hint" id="thInfo"></p>
    <div class="row" id="thReview" hidden><button id="thPrev">◂ Previous</button><button id="thNext">Next ▸</button><span class="hint" id="thAt"></span></div>`, () => {
    R.highlight = { lut: null, zone: -1, piece: -1 };
    unpreview();
  }, null, 'themeBtn');
  const info = t => { $('thInfo').textContent = t; };
  presetSearch($('thSearch'), $('thPreset'));
  $('thD2By').value = d2Grouping();
  $('thD2By').onchange = () => {   // (the list again in the other grouping: the preset picked and the search kept)
    const v = $('thPreset').value;
    $('thPreset').innerHTML = '<option value="">(my own: the zones below)</option>' + presetOptions(n => n, d2Grouping($('thD2By').value));
    $('thPreset').value = v;
    $('thSearch').oninput();
  };

  const zoneName = x => `${app.lutLabel(x.lut)} · ${app.lut(x.lut).labels?.[x.z] || 'zone ' + x.z}`;
  const color = x => { const l = app.lut(x.lut), a = l.edited ?? l.vanilla; return [0, 1, 2].map(ch => a[at(l, x.z, 0, ch)]); };
  const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const palette = () => {
    const base = lookRows({ tinted: false }).looks ?? {};
    $('thPalette').innerHTML = names.map(n => {
      const of = zones.filter(x => x.role === n);
      const cur = pick[n], has = !!base[n];
      const now = tint[n] ?? (has ? hex(base[n].slice(0, 3)) : '#808080');
      return `<div class="item rlZone"><input type="color" class="thTint" data-tint="${n}" value="${now}" ${has ? '' : 'disabled'}
          title="${has ? `This role's color (${tint[n] ? 'your own: ↺ goes back to the look\'s' : 'the look\'s: pick another to recolor it'})` : 'No look for this role: pick its zone or a preset'}">
        ${tint[n] ? `<button class="thUntint" data-untint="${n}" title="Back to the look's own color">↺</button>` : ''}
        <span class="swatch" title="${esc(ROLE_INFO[n]?.tip ?? '')}" style="background:${hex(ROLE_INFO[n]?.color ?? [0.5, 0.5, 0.5])};width:8px"></span>
        <span class="grow">${n}</span><select data-r="${n}"><option value="">(not changed)</option>
        ${of.map((x, i) => `<option value="${i}" ${x === cur ? 'selected' : ''}>${esc(zoneName(x))}</option>`).join('')}</select>
        <select data-camo="${n}" title="Camo over this role's look on every item (the pattern, then its four colors and size)" ${cur ? '' : 'disabled'}>
          ${CAMO.map(([v, t]) => `<option value="${v}" ${(camo[n]?.layer ?? '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${camo[n] && cur ? `<div class="row thCamo" data-cr="${n}">${camo[n].colors.map((c, i) => `<input type="color" data-ci="${i}" value="${hex(c)}" title="camo color ${i + 1}${i ? '' : ' (background)'}">`).join('')}
          <label class="hint">size <input type="range" data-ct min="0.3" max="3" step="0.05" value="${camo[n].tiling}" title="pattern size: left big blobs, right fine"></label></div>` : ''}`;
    }).join('');
    document.querySelectorAll('#thPalette input[data-tint]').forEach(inp => {
      inp.oninput = () => { tint[inp.dataset.tint] = inp.value; if (previewing) preview(); };
      inp.onchange = () => palette();   // (its ↺ shown)
    });
    document.querySelectorAll('#thPalette button[data-untint]').forEach(b => (b.onclick = () => { delete tint[b.dataset.untint]; palette(); if (previewing) preview(); }));
    document.querySelectorAll('#thPalette select[data-camo]').forEach(sel => {
      const n = sel.dataset.camo;
      sel.onchange = () => {
        if (sel.value === '') delete camo[n];
        else {
          // colors: the look's own color, then darker and lighter shades of it (change them below)
          const c = pick[n] ? color(pick[n]) : [0.4, 0.4, 0.4], sh = f => c.map(v => Math.min(1, v * f));
          camo[n] = { layer: sel.value, colors: camo[n]?.colors ?? [c, sh(0.55), sh(1.35), sh(0.3)], tiling: camo[n]?.tiling ?? 1.7 };
          camo[n].layer = sel.value;
        }
        palette();
      };
    });
    const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    document.querySelectorAll('#thPalette .thCamo').forEach(row => {
      const n = row.dataset.cr;
      row.querySelectorAll('input[type=color]').forEach(inp => (inp.oninput = () => { camo[n].colors[+inp.dataset.ci] = unhex(inp.value); }));
      row.querySelector('input[data-ct]').oninput = e => { camo[n].tiling = +e.target.value; };
    });
    document.querySelectorAll('#thPalette select[data-r]').forEach(sel => {
      const n = sel.dataset.r, of = zones.filter(x => x.role === n);
      sel.onchange = () => { pick[n] = sel.value === '' ? null : of[+sel.value]; palette(); };
      sel.onmouseenter = () => { const x = pick[n]; if (x) R.highlight = { lut: R.pieces.find(p => p.info.lut === x.lut)?.lutKeys.edited, zone: x.z, piece: -1 }; };
      sel.onmouseleave = () => { R.highlight = { lut: null, zone: -1, piece: -1 }; };
    });
  };
  const itemMode = () => document.querySelector('input[name=thTarget]:checked')?.value === 'item';
  const groups = () => [...document.querySelectorAll('.thGroup:checked')].map(c => c.value);
  // the weapon in hand: themed when Weapons is on (the item on screen: "and the weapon in hand", the same switch)
  const weaponsOn = () => groups().includes('Weapons');
  const targets = () => (data.items ?? []).filter(it => itemMode()
    ? app.current().includes(it.value) || (weaponsOn() && it.value === app.held?.())
    : groups().includes(it.group));
  // what Apply themes, as POST /api/theme takes it (the preview asks the server for the same: /api/theme/preview)
  const applyTargets = () => ({ Groups: groups(), Items: itemMode() ? targets().map(it => it.value) : [], OnlyInMod: $('thOnly').checked });
  // what Apply will do, said before it's done: the items and LUTs, those added to the mod, hand edits, decals
  const count = () => {
    const item = itemMode();
    $('thGroups').classList.toggle('off', item);
    $('thTitle').textContent = item ? 'Recolor this item' : 'Theme everything like this';
    $('thApply').textContent = item ? 'Recolor this item' : 'Apply theme';
    const inMod = app.projectLuts();
    const its = targets().filter(it => !$('thOnly').checked || it.luts.some(x => inMod.has(x.lut)));
    const luts = new Set(its.flatMap(it => it.luts.map(x => x.lut))), added = [...luts].filter(h => !inMod.has(h)).length;
    const what = item ? `the item on screen (${luts.size} LUT${luts.size === 1 ? '' : 's'})` : `${its.length} item${its.length === 1 ? '' : 's'} (${luts.size} LUTs)`;
    $('thCount').textContent = !its.length ? 'Nothing to apply it to: tick a kind of item.' : `Applies to ${what} in the ${app.variant} variant` +
      (added ? `; ${added} LUT${added === 1 ? ' is' : 's are'} not in the mod yet and get${added === 1 ? 's' : ''} added (to every variant)` : '') +
      `; zones you changed by hand are ${$('thOverwrite').checked ? 'overwritten' : 'kept'}` +
      ($('thDecals').checked ? '; their decal sheets are recolored (shared with other items)' : '') + '. Undo theme puts it all back.';
  };
  document.querySelectorAll('.thGroup, input[name=thTarget], #thOverwrite').forEach(c => c.addEventListener('change', count));
  // "and the weapon in hand" (the item on screen) is the Weapons box: either one sets both; the preview follows
  const weaponsBox = document.querySelector('.thGroup[value=Weapons]');
  const syncHeld = () => { $('thHeld').checked = weaponsBox.checked; $('thHeldRow').hidden = !itemMode() || !app.held?.(); };
  $('thHeld').onchange = () => { weaponsBox.checked = $('thHeld').checked; count(); if (previewing) preview(); };
  weaponsBox.addEventListener('change', () => { syncHeld(); if (previewing) preview(); });
  document.querySelectorAll('input[name=thTarget]').forEach(c => c.addEventListener('change', () => { syncHeld(); if (previewing) preview(); }));
  syncHeld();
  $('thOnly').onchange = () => { count(); if (previewing) preview(); };
  // (the kinds ticked: what Apply themes, so what the preview shows; Weapons has its own listener above)
  document.querySelectorAll('.thGroup:not([value=Weapons])').forEach(c => c.addEventListener('change', () => { if (previewing) preview(); }));
  document.addEventListener('lutstudio:recolor', () => { document.querySelector('input[name=thTarget][value=item]').checked = true; count(); }, { signal: close.signal });

  const rowOf = x => { const l = app.lut(x.lut), a = l.edited ?? l.vanilla; return Array.from(a.slice(x.z * l.w * 4, (x.z + 1) * l.w * 4)); };
  // the looks per role: the preset's (over the role's zone on screen, else the primary's, else any material zone) or
  // the zones picked; metal parts when asked
  const tint = {};   // role -> its own color (hex), over the look's
  const lookRows = ({ tinted = true } = {}) => {
    const looks = {}, P = PRESETS[$('thPreset').value];
    const groupLooks = {};   // (a preset with looks of its own for an item group: theirs, by group)
    if (P) {
      const any = pick.primary ?? pick.secondary ?? zones.find(z => app.lut(z.lut)?.w === W && z.role !== 'unused');
      const rows = L => { const out = {}; for (const [n, x0] of Object.entries(L)) { const x = n === 'hardware' ? null : pick[n] ?? any; if (x && app.lut(x.lut).w === W) out[n] = presetRow(rowOf(x), x0, n); } return out; };
      Object.assign(looks, rows(looksOf(P)));
      for (const [g, k] of Object.entries(GROUP_LOOKS)) if (P[k]) groupLooks[g] = rows(looksOf(P, g));
    } else for (const [n, x] of Object.entries(pick)) {
      if (!x) continue;
      looks[n] = rowOf(x);
      if (camo[n] && app.lut(x.lut).w === W) looks[n] = withCamo(looks[n], camo[n]);
    }
    if ($('thMetal').checked) {
      // metal parts: the hardware look (its zone on screen, else any metal zone) in the chosen color
      const x = pick.hardware ?? zones.find(z => z.role === 'hardware');
      if (!x && !P?.hardware) return { error: 'No metal part on screen to take the metal look from: show an item with metal parts.' };
      // (none on screen with a preset: its metal from the first item shown with metal parts; the tints still apply)
      if (x && P?.hardware) looks.hardware = presetRow(rowOf(x), { ...P.hardware, c: $('thMetalColor').value }, 'hardware');
      else if (x) {
        const row = rowOf(x);
        const c = unhexc($('thMetalColor').value);
        for (const col of [0, 5, 6]) for (let k = 0; k < 3; k++) row[col * 4 + k] = c[k];   // (paint and wear colors)
        looks.hardware = row;
      }
    }
    // a role recolored: the look's paint color is the one picked (its finish, wear and camo stay)
    if (tinted) for (const L of [looks, ...Object.values(groupLooks)]) for (const [n, h] of Object.entries(tint)) if (L?.[n]) { const c = unhexc(h); for (let k = 0; k < 3; k++) L[n][k] = c[k]; }
    for (const L of Object.values(groupLooks)) if (looks.hardware && !L.hardware) L.hardware = looks.hardware;
    return { looks, groupLooks };
  };
  $('thPreset').onchange = () => {
    const P = PRESETS[$('thPreset').value];
    if (P?.hardware) { $('thMetal').checked = true; $('thMetalColor').value = P.hardware.c; }
    else if (P) $('thMetal').checked = false;
    palette();   // (the roles' colors: the preset's)
    if (previewing) preview();
  };
  // ---- the theme on the item on screen, without saving: its LUTs in the looks (shown under keys of their own)
  let previewing = null;   // piece -> its LUT keys before
  let decalShown = [];   // (the decal sheets shown recolored)
  let previewSeq = 0;
  function unpreview() {
    previewSeq++;   // (a preview still asking the server: dropped)
    unpreviewDecals(R, decalShown); decalShown = [];
    if (!previewing) return;
    for (const [p, keys] of previewing) Object.assign(p.lutKeys, keys);
    previewing = null;
    if ($('thPreview')) $('thPreview').textContent = 'Preview on screen';
  }
  async function preview() {
    unpreview();
    const { looks, groupLooks, error } = lookRows();
    const P = PRESETS[$('thPreset').value];
    if (error) return info(error);
    if (!Object.keys(looks).length) return info('Pick a preset or at least one role\'s look.');
    const seq = ++previewSeq;   // (a newer preview, or decals unticked meanwhile: these sheets put back)
    // what Apply does to the LUTs on screen, as the server decides it for Apply: which it themes (the kinds ticked,
    // the weapon in hand only with Weapons), each zone's role (an armor, its helmet and cape each an item of its own),
    // the bySize swaps, the patterns and capes whose trim rows take the trim color
    const t = applyTargets(), luts = [...new Set(R.pieces.flatMap(p => [p.info.lut, p.info.pattern, p.info.cape]).filter(Boolean))];
    let plan;
    try {
      plan = await app.api(`/api/theme/preview?variant=${encodeURIComponent(app.variant)}&groups=${encodeURIComponent(JSON.stringify(t.Groups))}` +
        `&items=${encodeURIComponent(JSON.stringify(t.Items))}&only=${t.OnlyInMod ? 1 : 0}&size=${P?.bySize ? 1 : 0}&luts=${luts.join(',')}`);
    } catch (e) { return info(e.message); }
    if (seq !== previewSeq) return;   // (another preview, or the preview ended, meanwhile)
    const looksAt = h => {
      const L = groupLooks?.[groupOf.get(h)] ?? looks;
      return P?.bySize && plan.materials[h]?.swap ? swapLooks(L) : L;
    };
    previewing = new Map(R.pieces.map(p => [p, { ...p.lutKeys }]));
    for (const [h, m] of Object.entries(plan.materials)) {
      const l = app.lut(h);
      if (!l || l.w !== W) continue;
      const px = (l.edited ?? l.vanilla).slice();
      for (let z = 0; z < l.h; z++) { const n = m.roles[z], look = looksAt(h)[n]; if (look && n !== 'keep' && n !== 'unused') putLook(px, l, z, look, n); }
      R.setLut('pv:' + h, l.w, l.h, px);
    }
    // the trim color, as Apply's: the theme's on the patterned rows (of the game's LUT) of patterns, the capes' own
    // (else the theme's) on every row of cape designs; none without a trim look
    const trimOf = { pattern: looks.trim, cape: groupLooks?.Capes?.trim ?? looks.trim };
    const capePrimary = groupLooks?.Capes?.primary ?? looks.primary;   // (a cape design's gradient: as Apply)
    const trimmed = { pattern: new Set(plan.patterns), cape: new Set(plan.capes) };
    for (const key of ['pattern', 'cape']) {
      const trim = trimOf[key];
      if (!looks.trim || !trim) { trimmed[key].clear(); continue; }
      for (const h of trimmed[key]) {
        const l = app.lut(h);
        if (!l) { trimmed[key].delete(h); continue; }
        const px = (l.edited ?? l.vanilla).slice();
        for (let z = 0; z < l.h; z++) if (key === 'cape' || l.vanilla[z * l.w * 4 + 3] !== -1) for (let k = 0; k < 3; k++) px[z * l.w * 4 + k] = trim[k];
        if (key === 'cape') for (let z = 0; z < l.h; z++) capeFade(px, z * l.w * 4, capePrimary, l.vanilla);
        R.setLut('pv' + key + ':' + h, l.w, l.h, px);
      }
    }
    for (const p of R.pieces) {
      if (plan.materials[p.info.lut] && app.lut(p.info.lut)?.w === W) p.lutKeys.edited = 'pv:' + p.info.lut;
      for (const key of ['pattern', 'cape']) if (trimmed[key].has(p.info[key])) p.lutKeys[key] = 'pv' + key + ':' + p.info[key];
    }
    // decals: the sheets on screen recolored as Apply does: in colors that read on what each is drawn on
    if ($('thDecals').checked) previewDecals(R, $('thDecalMode').value, sheetInks(R.pieces, h => (plan.materials[h] ? looksAt(h) : null))).then(h => { if (previewing && seq === previewSeq && $('thDecals').checked) decalShown = h; else unpreviewDecals(R, h); });
    $('thPreview').textContent = 'End preview';
    info('Preview: the theme on the item on screen (nothing saved). Apply theme to keep it.');
  }
  const decalsChanged = () => { $('thDecalNote').hidden = !$('thDecals').checked; count(); if (previewing) preview(); };
  $('thDecals').onchange = decalsChanged;
  $('thDecalMode').onchange = decalsChanged;
  $('thPreview').onclick = () => (previewing ? (unpreview(), info('')) : preview());
  // another item on screen (an armor, helmet or cape picked while the panel is open): its zones read, the preview on it
  document.addEventListener('lutstudio:pieces', async () => {
    const was = !!previewing;
    previewing = null; decalShown = [];   // (the old pieces are gone with their keys)
    await screenZones();
    if (was) preview();
  }, { signal: close.signal });

  // ---- the Showcase with these looks (showcaseui.js)
  // the looks per item of the scene: a preset's over each item's own zones (as the dev tool), or the looks here on all
  const showTheme = () => {
    const name = $('thPreset').value, decals = $('thDecals').checked ? $('thDecalMode').value : '';
    if (PRESETS[name]) return { ...presetTheme(name, $('thMetal').checked ? $('thMetalColor').value : null), decals };
    const { looks, error } = lookRows();
    if (error) return { error };
    if (!Object.keys(looks).length) return { error: "Pick a preset or at least one role's look." };
    return { name: 'My theme', decals, looksFor: () => looks, colors: Object.entries(looks).map(([n, row]) => [n, hex(row.slice(0, 3))]) };
  };
  // the Showcase mode (showcaseui.js) with these looks: the panel closes, the right sidebar takes its options
  $('thShow').onclick = async () => {
    const theme = showTheme();
    if (theme.error) return info(theme.error);
    unpreview();
    if (await closeSide()) app.openShowcase({ theme });
  };

  let applying = false;   // (a second click while the first saves: one theme, one undo step)
  $('thApply').onclick = async () => {
    if (applying) return;
    applying = true;
    try { await applyTheme(); } finally { applying = false; }
  };
  const applyTheme = async () => {
    if (!(await app.saveAll())) return;   // (edits made while the panel is open: saved before the theme reloads the LUTs)
    const { looks, groupLooks, error } = lookRows();
    if (error) return info(error);
    unpreview();
    if (!Object.keys(looks).length) return info('Pick a preset or at least one role\'s look.');
    if (!itemMode() && !groups().length) return info('Pick what to apply it to.');
    const its = targets();
    if (!its.length) return info('Nothing on screen to recolor.');
    if (!$('thOnly').checked && its.length > 20 && !confirm(`Theme ${its.length} items? Those not in the mod yet are added to it (every variant).`)) return;
    $('thApply').disabled = true;
    info('Applying… (the first time reads every item\'s masks: a little while)');
    try {
      const r = await app.api('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variant: app.variant, Looks: looks, GroupLooks: groupLooks ?? {}, BySize: !!PRESETS[$('thPreset').value]?.bySize, ...applyTargets(), Overwrite: $('thOverwrite').checked,
          Decals: $('thDecals').checked ? $('thDecalMode').value : '' }) });
      app.track('theme applied', { item_only: itemMode(), tinted: Object.keys(tint), groups: groups(), roles: Object.keys(looks), preset: $('thPreset').value || null, camo: Object.keys(camo), paint_metal: $('thMetal').checked, decals: $('thDecals').checked ? $('thDecalMode').value : null, decal_sheets: r.decal_sheets, items: r.items, luts: r.luts, zones: r.zones, kept: r.kept, added: r.added, only_in_mod: $('thOnly').checked });
      await app.refresh();
      if (r.decal_sheets) await R.refreshDecals();
      info(`Themed ${r.zones} zone(s) in ${r.changed} LUT(s) of ${r.items} item(s)` + (r.added ? `; ${r.added} LUT(s) added to the mod` : '') +
        (r.decal_sheets ? `; recolored ${r.decal_sheets} decal sheet(s)` + (r.decal_outside ? ` (also drawn on ${r.decal_outside} item(s) outside the groups themed)` : '') : '') +
        (r.pattern_outside ? `; the pattern trims are shared with ${r.pattern_outside} item(s) outside the groups themed (they change too)` : '') +
        (r.kept ? `; kept ${r.kept} zone(s) you changed by hand (tick "also overwrite" to replace them)` : '') + (itemMode() ? '.' : '. Step through them below.'));
      const inMod = app.projectLuts();
      review = targets().filter(it => !$('thOnly').checked || it.luts.some(x => inMod.has(x.lut))); ri = -1;
      $('thReview').hidden = !review.length || itemMode();
      if (r.undo) { app.pushTheme?.(r.undo); lastUndo = r.undo; }
      $('thUndo').hidden = false;
      count();
    } catch (e) { info(e.message); }
    $('thApply').disabled = false;
  };
  // ---- undo: the files the last theme changed put back (theme.go undoTheme)
  let lastUndo = null;   // (the id of the theme applied here: app.undoTheme undoes it, as Ctrl+Z does)
  $('thUndo').onclick = async () => {
    $('thUndo').disabled = true;
    if (await app.undoTheme(lastUndo)) { info('Undone: every file back as it was before the theme.'); $('thUndo').hidden = true; $('thReview').hidden = true; lastUndo = null; }
    else info('The theme could not be undone: see the status line.');
    $('thUndo').disabled = false;
    count();
  };
  document.addEventListener('lutstudio:themeundone', () => { $('thUndo').hidden = true; $('thReview').hidden = true; }, { signal: close.signal });
  // ---- stepping through the themed items
  let review = [], ri = -1;
  const step = async d => {
    if (!review.length) return;
    ri = (ri + d + review.length) % review.length;
    $('thAt').textContent = `${ri + 1} / ${review.length}: ${review[ri].label}`;
    await app.showItem(review[ri].value);
  };
  $('thPrev').onclick = () => step(-1);
  $('thNext').onclick = () => step(1);
  palette();
  count();
  return close;
}
