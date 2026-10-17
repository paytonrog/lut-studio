// Theme everything like this: the item on screen gives one look per role (a whole zone row: its zone of that role,
// the biggest one by default), and every zone of that role on every chosen item gets it (POST /api/theme, theme.go).
// Items not in the mod yet are added (every variant, as the game has them); the theme goes into the current variant.
// Zones changed by hand since the last theme are kept unless overwriting is asked for. Roles: roles.js / roles.go.

import { $, esc, openSide, closeSide } from './texedit.js';
import { ROLE_INFO } from './roles.js';

const GROUPS = ['Armor', 'Helmets', 'Capes', 'Backpacks', 'Weapons', 'Vehicles', 'Equipment', 'Stratagems', 'Eagle & craft'];
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
const unhexc = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// a preset's look of a role over a row on screen: its color (paint, secondary, wear), its fields, its camo
function presetRow(row, L) {
  let out = row.slice();
  const c = unhexc(L.c);
  for (const [col, f] of [[0, 1], [2, 0.8], [5, 0.9], [6, 0.9]]) for (let k = 0; k < 3; k++) out[col * 4 + k] = c[k] * f;
  for (const [col, ch, v] of L.set ?? []) out[col * 4 + ch] = v;
  if (L.camo) out = withCamo(out, { ...L.camo, colors: L.camo.colors.map(unhexc) });
  else if (out[21 * 4 + 3] !== -1) for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) out[(16 + j) * 4 + k] = c[k] * [1, 0.55, 1.25, 0.3][j];
  return out;
}
// a look on a zone, as the server applies it (theme.go): a zone that is cloth in the game but has another role takes
// the look's colors only (paint, secondary, wear, camo), keeping its cloth finish
function putLook(px, l, z, look, role) {
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
      <button id="thPreview" title="Show the theme on the item on screen, without changing anything">Preview on screen</button></div>
    <p class="hint">Each role's look comes from a zone of the item on screen (all its settings, not only the color);
      a role can also get a camo pattern over it.
      Every zone of that role on the items you choose gets it, in this variant (${esc(app.variant)}). Items not in
      the mod yet are added. Zones you changed by hand since the last theme are kept.</p>
    ${unconfirmed ? `<p class="warn">${unconfirmed} LUT(s) on screen have guessed roles only (not reviewed yet): a look may land on the wrong zone there; check the result.</p>` : ''}
    <div id="thPalette"></div>
    <div class="row"><label class="check" title="Metal parts (barrels, bolts, buckles: the hardware role) take this color and keep their metal finish; off: they keep the game's metal"><input type="checkbox" id="thMetal"> paint metal parts</label>
      <input type="color" id="thMetalColor" value="#2a2a2a" title="the metal parts' color"></div>
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
  function unpreview() {
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
    $('thPreview').textContent = 'End preview';
    info('Preview: the theme on the item on screen (nothing saved). Apply theme to keep it.');
  }
  $('thPreview').onclick = () => (previewing ? (unpreview(), info('')) : preview());

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
        body: JSON.stringify({ Variant: app.variant, Looks: looks, Groups: groups(), OnlyInMod: $('thOnly').checked, Overwrite: $('thOverwrite').checked }) });
      app.track('theme applied', { groups: groups(), roles: Object.keys(looks), preset: $('thPreset').value || null, camo: Object.keys(camo), paint_metal: $('thMetal').checked, items: r.items, luts: r.luts, zones: r.zones, kept: r.kept, added: r.added, only_in_mod: $('thOnly').checked });
      await app.refresh();
      info(`Themed ${r.zones} zone(s) in ${r.changed} LUT(s) of ${r.items} item(s)` + (r.added ? `; ${r.added} LUT(s) added to the mod` : '') +
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
