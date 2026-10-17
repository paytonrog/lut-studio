// Theme everything like this: the item on screen gives one look per role (a whole zone row: its zone of that role,
// the biggest one by default), and every zone of that role on every chosen item gets it (POST /api/theme, theme.go).
// Items not in the mod yet are added (every variant, as the game has them); the theme goes into the current variant.
// Zones changed by hand since the last theme are kept unless overwriting is asked for. Roles: roles.js / roles.go.

import { $, esc, openSide, closeSide } from './texedit.js';
import { ROLE_INFO } from './roles.js';
import { decalColors, previewDecals, unpreviewDecals } from './decaltheme.js';

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
const FIN = {
  matte: [[6, 3, -1], [10, 0, 0.78]], satin: [[6, 3, -1], [10, 0, 0.45]], gloss: [[6, 3, -1], [10, 0, 0.18], [8, 3, 0.65]],
  plastic: [[6, 3, -1], [10, 0, 0.25], [8, 3, 0.6]], rough: [[6, 3, -1], [10, 0, 0.95], [8, 3, 0.2]],
  metal: [[6, 3, 1], [10, 0, 0.25]], mirror: [[6, 3, 1], [10, 0, 0.03], [8, 3, 1]], brushed: [[6, 3, 1], [10, 0, 0.45]],
};
const IRID = (t, s, str) => [[13, 2, t], [13, 3, s], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, str]];
const CM = (layer, colors, tiling = 1.5) => ({ layer: String(layer), colors, tiling });
// o: pf / sf / tf (finishes), pc / sc / cc (camos), px / sx (extra fields), glow (trim and lights glow in this color),
// gv (its strength), hw / hwf (metal parts' color and finish), fuzz (cloth sheen color)
function T(p, s, t, cl, o = {}) {
  const glow = o.glow ? [[13, 0, o.gv ?? 0.12]] : [];
  const out = {
    primary: { c: p, set: [...CLEAN, ...(o.pf ?? FIN.satin), ...(o.px ?? [])], camo: o.pc },
    secondary: { c: s, set: [...CLEAN, ...(o.sf ?? FIN.satin), ...(o.sx ?? [])], camo: o.sc },
    trim: { c: o.glow ?? t, set: [...CLEAN, ...(o.tf ?? FIN.satin), ...glow] },
    cloth: { c: cl, set: o.fuzz ? [[12, 0, o.fuzz[0]], [12, 1, o.fuzz[1]], [12, 2, o.fuzz[2]], [12, 3, 0.3]] : [], camo: o.cc },
  };
  if (o.glow) out.glow = { c: o.glow, set: glow };
  if (o.hw) out.hardware = { c: o.hw, set: o.hwf ?? FIN.metal };
  return out;
}
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
  'Banana': T('#ffe01a', '#ffe01a', '#4a3010', '#f0d014', { pc: CM(0, ['#ffe01a', '#4a3010', '#f4d414', '#ffe01a'], 2.4), pf: FIN.plastic }),
  'Barbie Corps': T('#ff2a9a', '#f8f4f6', '#e0b04a', '#ff5ab4', { pf: FIN.gloss, tf: FIN.mirror, hw: '#e0b04a' }),
  'Rubber Duck': T('#ffd400', '#ffd400', '#ff7a00', '#ffd400', { pf: FIN.plastic, sf: FIN.plastic, tf: FIN.plastic }),
  'Cardboard': T('#a8865a', '#8e7048', '#141414', '#9a7c50', { pf: FIN.rough, sf: FIN.rough, tf: FIN.matte, hw: '#a8865a', hwf: FIN.rough }),
  'Vaporwave': T('#c8a0ff', '#80f0e8', '#ff7ac8', '#a880e0', { pc: CM(1, ['#c8a0ff', '#80f0e8', '#e8b0ff', '#a080e0'], 1.1), pf: FIN.plastic, glow: '#ff7ac8', gv: 0.1 }),
  'Inverse Helldiver': T('#1a1a1a', '#e8b81a', '#121212', '#e8b81a', { pf: FIN.satin, sf: FIN.satin }),
});

// inspired by the shaders players rate highest in another game
Object.assign(PRESETS, {
  'Superblack': T('#060606', '#0b0b0c', '#141416', '#070707', { pf: [[6, 3, -1], [10, 0, 0.12], [8, 3, 0.8]], sf: FIN.gloss, tf: FIN.gloss, hw: '#0a0a0a', hwf: [[6, 3, 1], [10, 0, 0.15]] }),
  'Bitterpearl': T('#eeece6', '#d8d6d0', '#c9ccd1', '#e4e2dc', { pf: [[6, 3, 0.15], [10, 0, 0.2], [8, 3, 0.7]], hw: '#d0d3d8', hwf: FIN.mirror }),
  "Calus's Selected": T('#f2efe8', '#4a1a7a', '#d9a93c', '#3a1460', { pf: FIN.gloss, tf: FIN.metal, hw: '#d9a93c' }),
  'Goldleaf': T('#d8a83c', '#f0ede4', '#b88a2c', '#e8e2d4', { pf: FIN.mirror, hw: '#d8a83c' }),
  'Bergusian Night': T('#3a1a6a', '#1a0a30', '#a070ff', '#24103e', { pc: CM(1, ['#3a1a6a', '#6a2aa8', '#1a0a30', '#9050d8'], 1.0), pf: FIN.gloss }),
  'Carbon Blood': T('#8a0a12', '#0c0c0d', '#1a1a1c', '#101011', { pf: FIN.gloss, sc: CM(0, ['#0c0c0d', '#1a1a1c', '#141416', '#060606'], 2.6) }),
  'Regal Daring': T('#f0ede6', '#c8a03a', '#b0141e', '#e6e2da', { pf: FIN.gloss, sf: FIN.metal, hw: '#c8a03a' }),
  'Ego Malign': T('#e8e2d0', '#14204a', '#0a0e1e', '#101a3a', { pf: FIN.satin, glow: '#f4ecd4', gv: 0.06 }),
  'Rustberry': T('#e8ded6', '#b0563a', '#6a2a1e', '#d8ccc2', { pf: [[6, 3, 0.15], [10, 0, 0.25]], sf: FIN.brushed }),
  'Amethyst Veil': T('#121016', '#3a1660', '#7a3ac8', '#0e0c12', { pf: FIN.gloss, sf: FIN.gloss, tf: FIN.metal, hw: '#3a1660' }),
  'Erebos Glance': T('#16161a', '#2c2c30', '#ff7a14', '#121214', { pf: FIN.satin, tf: FIN.gloss }),
  'Abyssinian Gold': T('#5a4632', '#3a3430', '#a8863a', '#4a3e30', { pf: FIN.matte, sf: FIN.matte, tf: FIN.brushed, hw: '#8a7040', hwf: FIN.brushed }),
  'Refurbished Black Armory': T('#0a0b0a', '#0c0a10', '#2a2c2a', '#0a0a0c', { pf: [[6, 3, 0.4], [10, 0, 0.15]], px: IRID(0.6, 0.5, 1.6), sf: [[6, 3, 0.3], [10, 0, 0.2]], sx: IRID(0.85, 0.4, 1.4), hw: '#1a1c1a' }),
  'Gilded Frost': T('#8a7a4a', '#5a5e64', '#1a2a5a', '#3a4048', { pf: FIN.brushed, tf: FIN.gloss }),
  'Gambit Jadestone': T('#2a3a24', '#1a2418', '#4aff6a', '#1e2a1a', { pc: CM(1, ['#2a3a24', '#1e2a1a', '#3a4a2e', '#141c10'], 1.2), pf: FIN.matte, glow: '#4aff6a', gv: 0.12 }),
  'House of Meyrin': T('#8a1018', '#c8a03a', '#e8c050', '#4a0a0e', { pf: FIN.gloss, sf: FIN.metal, tf: FIN.mirror, hw: '#c8a03a' }),
  'Bloody Tooth': T('#0e0e10', '#b8bcc2', '#b0101a', '#141416', { pf: FIN.gloss, sf: FIN.mirror, hw: '#b8bcc2' }),
  'Midnight Exigent': T('#14224a', '#2a2c32', '#ffd21a', '#121a30', { glow: '#ffd21a', gv: 0.08 }),
  'Oiled Gunmetal': T('#14181a', '#0e1210', '#3aff9a', '#101414', { pf: [[6, 3, 0.6], [10, 0, 0.12]], px: IRID(0.45, 0.8, 1.6), glow: '#3aff9a', gv: 0.1, hw: '#2a2e30' }),
  'Monochromatic': T('#f2f2f2', '#0c0c0c', '#0c0c0c', '#f2f2f2', { pf: FIN.gloss, sf: FIN.gloss }),
});

const unhexc = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// a preset's look of a role over a row on screen: its color (paint, secondary, wear), its fields, its camo
export function presetRow(row, L) {
  let out = row.slice();
  const c = unhexc(L.c);
  for (const [col, f] of [[0, 1], [2, 0.8], [5, 0.9], [6, 0.9]]) for (let k = 0; k < 3; k++) out[col * 4 + k] = c[k] * f;
  for (const [col, ch, v] of L.set ?? []) out[col * 4 + ch] = v;
  if (L.camo) out = withCamo(out, { ...L.camo, colors: L.camo.colors.map(unhexc) });
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
  return { name, colors, looksFor: (zs, rowOf) => {
    const biggest = n => zs.filter(x => x.role === n && x.w === W).sort((a, b) => b.cov - a.cov)[0];
    const any = biggest('primary') ?? biggest('secondary') ?? zs.find(x => x.w === W && x.role !== 'unused');
    const looks = {};
    for (const [n, L] of Object.entries(P)) {
      const x = n === 'hardware' ? biggest('hardware') : biggest(n) ?? any;
      if (x) looks[n] = presetRow(rowOf(x), n === 'hardware' && metal ? { ...L, c: metal } : L);
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
  const base = z * l.w * 4, cloth = Math.round(px[base + 3]) === 1 && role !== 'cloth';
  if (!cloth) { for (let i = 0; i < look.length && i < l.w * 4; i++) px[base + i] = look[i]; return; }
  for (const col of [0, 2, 5, 6]) for (let k = 0; k < 3; k++) px[base + col * 4 + k] = look[col * 4 + k];
  if (look[21 * 4 + 3] !== -1) for (let col = 16; col <= 21; col++) for (let k = 0; k < 4; k++) if (col !== 16 || k < 3) px[base + col * 4 + k] = look[col * 4 + k];
}

// app: { R, api, variant, lut(hash), lutLabel(hash), showItem(value), current() -> item values on screen, saveAll(),
// projectLuts() -> the LUTs in the project (Set),
// refresh() (the project and the variant again), status(msg), track(event, props) }
export async function themeDialog(app) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const R = app.R;
  await app.saveAll();
  const data = await app.api('/api/roles');
  const names = data.names.filter(n => n !== 'keep' && n !== 'unused');
  const onScreen = [...new Set(R.pieces.map(p => p.info.lut))].filter(h => app.lut(h)?.kind === 'material');
  // the roles of the LUTs on screen (saved, else suggested) and each zone's share
  let sug = {};
  try { sug = await app.api(`/api/roles/suggest?variant=${encodeURIComponent(app.variant)}&luts=${onScreen.join(',')}`); } catch { }
  const zones = [];   // {lut, z, role, cov}
  for (const h of onScreen) {
    const l = app.lut(h), roles = data.mine[h] ?? data.builtin[h] ?? sug[h]?.roles ?? [];
    for (let z = 0; z < l.h; z++) zones.push({ lut: h, z, role: roles[z] ?? 'keep', cov: sug[h]?.coverage?.[z] ?? 0 });
  }
  const unconfirmed = onScreen.filter(h => !data.mine[h] && !data.builtin[h]).length;
  // the source zone of each role: the biggest of that role on screen
  const pick = {}, camo = {};   // camo[role]: {layer, colors: 4 x rgb, tiling}
  for (const n of names) pick[n] = zones.filter(x => x.role === n).sort((a, b) => b.cov - a.cov)[0] ?? null;
  const shownGroups = new Set((data.items ?? []).filter(it => app.current().includes(it.value)).map(it => it.group));
  const close = openSide(`<h3>Theme everything like this</h3>
    <div class="row"><label>Preset <select id="thPreset" title="A ready-made theme: each role's look from it (over the item's own zones); or your own, from the zones below">
      <option value="">(my own: the zones below)</option>${Object.keys(PRESETS).map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      <button id="thPreview" title="Show the theme on the item on screen, without changing anything">Preview on screen</button>
      <button id="thShow" title="Showcase mode with these looks: key art, live in the viewport (three Helldivers with their weapons, gear and vehicles); move the camera, tune the look, save a 4K image (nothing in the mod changes)">Showcase</button></div>

    <p class="hint">Each role's look comes from a zone of the item on screen (all its settings, not only the color);
      a role can also get a camo pattern over it.
      Every zone of that role on the items you choose gets it, in this variant (${esc(app.variant)}). Items not in
      the mod yet are added. Zones you changed by hand since the last theme are kept.</p>
    ${unconfirmed ? `<p class="warn">${unconfirmed} LUT(s) on screen have guessed roles only (not reviewed yet): a look may land on the wrong zone there; check the result.</p>` : ''}
    <div id="thPalette"></div>
    <div class="row"><label class="check" title="Metal parts (barrels, bolts, buckles: the hardware role) take this color and keep their metal finish; off: they keep the game's metal"><input type="checkbox" id="thMetal"> paint metal parts</label>
      <input type="color" id="thMetalColor" value="#2a2a2a" title="the metal parts' color"></div>
    <div class="row"><label class="check" title="Recolor the decals too (emblems, markings, stencils) in the theme's colors: their decal sheets, which other items may share"><input type="checkbox" id="thDecals"> also theme decals</label>
      <select id="thDecalMode" title="How decals take the theme's colors"><option value="two">light parts trim, dark parts secondary</option><option value="one">all in the trim color</option></select></div>
    <p class="hint" id="thDecalNote" hidden>A decal sheet is shared: every item drawing from a recolored sheet shows its decals in the theme's colors, items you didn't theme too. Each recolored sheet adds about 5 MB to the mod.</p>
    <h3>Apply to</h3>
    <div class="row">${GROUPS.map(g => `<label class="check"><input type="checkbox" class="thGroup" value="${g}" ${shownGroups.has(g) || (!shownGroups.size && DEFAULT_GROUPS.includes(g)) ? 'checked' : ''}> ${g}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" id="thOnly"> only items already in this mod</label>
    <label class="check"><input type="checkbox" id="thOverwrite"> also overwrite zones I changed by hand</label>
    <p class="hint" id="thCount"></p>
    <div class="row"><button id="thApply" class="primary">Apply theme</button></div>
    <p class="hint" id="thInfo"></p>
    <div class="row" id="thReview" hidden><button id="thPrev">◂ Previous</button><button id="thNext">Next ▸</button><span class="hint" id="thAt"></span></div>`, () => {
    R.highlight = { lut: null, zone: -1, piece: -1 };
    unpreview();
  });
  const info = t => { $('thInfo').textContent = t; };

  const zoneName = x => `${app.lutLabel(x.lut)} · ${app.lut(x.lut).labels?.[x.z] || 'zone ' + x.z}`;
  const color = x => { const l = app.lut(x.lut), a = l.edited ?? l.vanilla; return [0, 1, 2].map(ch => a[at(l, x.z, 0, ch)]); };
  const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const palette = () => {
    $('thPalette').innerHTML = names.map(n => {
      const of = zones.filter(x => x.role === n);
      const cur = pick[n];
      return `<div class="item rlZone"><span class="swatch" style="background:${cur ? hex(color(cur)) : 'transparent'}"></span>
        <span class="swatch" title="${esc(ROLE_INFO[n]?.tip ?? '')}" style="background:${hex(ROLE_INFO[n]?.color ?? [0.5, 0.5, 0.5])};width:8px"></span>
        <span class="grow">${n}</span><select data-r="${n}"><option value="">(not changed)</option>
        ${of.map((x, i) => `<option value="${i}" ${x === cur ? 'selected' : ''}>${esc(zoneName(x))}</option>`).join('')}</select>
        <select data-camo="${n}" title="Camo over this role's look on every item (the pattern, then its four colors and size)" ${cur ? '' : 'disabled'}>
          ${CAMO.map(([v, t]) => `<option value="${v}" ${(camo[n]?.layer ?? '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${camo[n] && cur ? `<div class="row thCamo" data-cr="${n}">${camo[n].colors.map((c, i) => `<input type="color" data-ci="${i}" value="${hex(c)}" title="camo color ${i + 1}${i ? '' : ' (background)'}">`).join('')}
          <label class="hint">size <input type="range" data-ct min="0.3" max="3" step="0.05" value="${camo[n].tiling}" title="pattern size: left big blobs, right fine"></label></div>` : ''}`;
    }).join('');
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
  const groups = () => [...document.querySelectorAll('.thGroup:checked')].map(c => c.value);
  const targets = () => (data.items ?? []).filter(it => groups().includes(it.group));
  const count = () => {
    const its = targets(), luts = new Set(its.flatMap(it => it.luts.map(x => x.lut)));
    $('thCount').textContent = $('thOnly').checked ? `${groups().join(', ') || 'nothing'}: the items already in this mod`
      : `${its.length} items, ${luts.size} LUTs`;
  };
  document.querySelectorAll('.thGroup').forEach(c => (c.onchange = count));
  $('thOnly').onchange = count;

  const rowOf = x => { const l = app.lut(x.lut), a = l.edited ?? l.vanilla; return Array.from(a.slice(x.z * l.w * 4, (x.z + 1) * l.w * 4)); };
  // the looks per role: the preset's (over the role's zone on screen, else the primary's, else any material zone) or
  // the zones picked; metal parts when asked
  const lookRows = () => {
    const looks = {}, P = PRESETS[$('thPreset').value];
    if (P) {
      const any = pick.primary ?? pick.secondary ?? zones.find(z => app.lut(z.lut)?.w === W && z.role !== 'unused');
      for (const [n, L] of Object.entries(P)) {
        const x = n === 'hardware' ? null : pick[n] ?? any;
        if (x && app.lut(x.lut).w === W) looks[n] = presetRow(rowOf(x), L);
      }
    } else for (const [n, x] of Object.entries(pick)) {
      if (!x) continue;
      looks[n] = rowOf(x);
      if (camo[n] && app.lut(x.lut).w === W) looks[n] = withCamo(looks[n], camo[n]);
    }
    if ($('thMetal').checked) {
      // metal parts: the hardware look (its zone on screen, else any metal zone) in the chosen color
      const x = pick.hardware ?? zones.find(z => z.role === 'hardware');
      if (!x && P?.hardware) return { looks };   // (a preset's metal: from the first item shown with metal parts)
      if (!x) return { error: 'No metal part on screen to take the metal look from: show an item with metal parts.' };
      const row = rowOf(x);
      if (P?.hardware) looks.hardware = presetRow(row, { ...P.hardware, c: $('thMetalColor').value });
      else {
        const c = unhexc($('thMetalColor').value);
        for (const col of [0, 5, 6]) for (let k = 0; k < 3; k++) row[col * 4 + k] = c[k];   // (paint and wear colors)
        looks.hardware = row;
      }
    }
    return { looks };
  };
  $('thPreset').onchange = () => {
    const P = PRESETS[$('thPreset').value];
    if (P?.hardware) { $('thMetal').checked = true; $('thMetalColor').value = P.hardware.c; }
    else if (P) $('thMetal').checked = false;
    if (previewing) preview();
  };
  // ---- the theme on the item on screen, without saving: its LUTs in the looks (shown under keys of their own)
  let previewing = null;   // piece -> its LUT keys before
  let decalShown = [];   // (the decal sheets shown recolored)
  function unpreview() {
    unpreviewDecals(R, decalShown); decalShown = [];
    if (!previewing) return;
    for (const [p, keys] of previewing) Object.assign(p.lutKeys, keys);
    previewing = null;
    if ($('thPreview')) $('thPreview').textContent = 'Preview on screen';
  }
  function preview() {
    unpreview();
    const { looks, error } = lookRows();
    if (error) return info(error);
    if (!Object.keys(looks).length) return info('Pick a preset or at least one role\'s look.');
    previewing = new Map(R.pieces.map(p => [p, { ...p.lutKeys }]));
    const roleOf = {};
    for (const x of zones) (roleOf[x.lut] ??= [])[x.z] = x.role;
    for (const h of onScreen) {
      const l = app.lut(h), px = (l.edited ?? l.vanilla).slice();
      for (let z = 0; z < l.h; z++) { const n = roleOf[h]?.[z], look = looks[n]; if (look && l.w === W) putLook(px, l, z, look, n); }
      R.setLut('pv:' + h, l.w, l.h, px);
    }
    const trim = looks.trim;
    for (const p of R.pieces) {
      if (onScreen.includes(p.info.lut)) p.lutKeys.edited = 'pv:' + p.info.lut;
      // patterns and capes' trim lines: the trim look's color
      for (const [key, h, rows] of [['pattern', p.info.pattern, true], ['cape', p.info.cape, false]]) {
        const l = h && app.lut(h);
        if (!trim || !l) continue;
        const px = (l.edited ?? l.vanilla).slice();
        for (let z = 0; z < l.h; z++) if (!rows || px[z * l.w * 4 + 3] !== -1) for (let k = 0; k < 3; k++) px[z * l.w * 4 + k] = trim[k];
        R.setLut('pv' + key + ':' + h, l.w, l.h, px);
        p.lutKeys[key] = 'pv' + key + ':' + h;
      }
    }
    // decals: the sheets on screen recolored in the theme's colors
    const dc = $('thDecals').checked && decalColors(looks);
    if (dc) previewDecals(R, R.pieces, $('thDecalMode').value, dc).then(h => { if (previewing) decalShown = h; else unpreviewDecals(R, h); });
    $('thPreview').textContent = 'End preview';
    info('Preview: the theme on the item on screen (nothing saved). Apply theme to keep it.');
  }
  const decalsChanged = () => { $('thDecalNote').hidden = !$('thDecals').checked; if (previewing) preview(); };
  $('thDecals').onchange = decalsChanged;
  $('thDecalMode').onchange = decalsChanged;
  $('thPreview').onclick = () => (previewing ? (unpreview(), info('')) : preview());

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

  $('thApply').onclick = async () => {
    await app.saveAll();   // (edits made while the panel is open: saved before the theme reloads the LUTs)
    const { looks, error } = lookRows();
    if (error) return info(error);
    unpreview();
    if (!Object.keys(looks).length) return info('Pick a preset or at least one role\'s look.');
    if (!groups().length) return info('Pick what to apply it to.');
    const its = targets();
    if (!$('thOnly').checked && its.length > 20 && !confirm(`Theme ${its.length} items? Those not in the mod yet are added to it (every variant).`)) return;
    $('thApply').disabled = true;
    info('Applying… (the first time reads every item\'s masks: a little while)');
    try {
      const r = await app.api('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Variant: app.variant, Looks: looks, Groups: groups(), OnlyInMod: $('thOnly').checked, Overwrite: $('thOverwrite').checked,
          Decals: $('thDecals').checked ? $('thDecalMode').value : '' }) });
      app.track('theme applied', { groups: groups(), roles: Object.keys(looks), preset: $('thPreset').value || null, camo: Object.keys(camo), paint_metal: $('thMetal').checked, decals: $('thDecals').checked ? $('thDecalMode').value : null, decal_sheets: r.decal_sheets, items: r.items, luts: r.luts, zones: r.zones, kept: r.kept, added: r.added, only_in_mod: $('thOnly').checked });
      await app.refresh();
      if (r.decal_sheets) await R.refreshDecals();
      info(`Themed ${r.zones} zone(s) in ${r.changed} LUT(s) of ${r.items} item(s)` + (r.added ? `; ${r.added} LUT(s) added to the mod` : '') +
        (r.decal_sheets ? `; recolored ${r.decal_sheets} decal sheet(s)` + (r.decal_outside ? ` (also drawn on ${r.decal_outside} item(s) outside the groups themed)` : '') : '') +
        (r.kept ? `; kept ${r.kept} zone(s) you changed by hand (tick "also overwrite" to replace them)` : '') + '. Step through them below.');
      const inMod = app.projectLuts();
      review = targets().filter(it => !$('thOnly').checked || it.luts.some(x => inMod.has(x.lut))); ri = -1;
      $('thReview').hidden = !review.length;
    } catch (e) { info(e.message); }
    $('thApply').disabled = false;
  };
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
