// Zone roles: what each zone of a material LUT is on its item (primary, secondary, trim, cloth, hardware, glow, keep,
// unused), so one look per role can theme many items alike. Keyed by LUT: a LUT several items share is confirmed
// once for all of them. Built-in roles ship with LUT Studio (server/roles.json); the user's own confirmations come on
// top (/api/roles) and export as a new roles.json. Zones without a confirmed role get the server's suggestion
// (/api/roles/suggest, theme.go: unused where the parts' ID masks have no pixel of the zone, cloth, glow, hardware,
// then the painted zones by area).

import { $, esc, openSide, closeSide } from './texedit.js';

export const ROLE_INFO = {
  primary: { color: [0.88, 0.69, 0.25], tip: 'the main plates or panels' },
  secondary: { color: [0.23, 0.56, 0.85], tip: 'the second color areas' },
  trim: { color: [0.88, 0.31, 0.31], tip: 'edges, stripes, accents, small painted details' },
  cloth: { color: [0.42, 0.66, 0.31], tip: 'fabric: undersuit, straps, pouches' },
  hardware: { color: [0.7, 0.7, 0.74], tip: 'bare metal: buckles, rivets, a weapon\'s metal parts' },
  glow: { color: [1, 0.25, 1], tip: 'lights, lenses, glowing parts' },
  keep: { color: [0.54, 0.43, 0.82], tip: 'a theme leaves it as it is (skin, a logo, something to keep)' },
  unused: { color: [0.08, 0.08, 0.08], tip: 'a row the part never shows (no pixel of its ID mask)' },
};

const at = (l, z, col, ch) => (z * l.w + col) * 4 + ch;

// LUT px with every zone painted its role's color (flat paint: no metal, glow, camo or wear tint) for the role view
export function roleViewLut(l, base, roles, fields) {
  const px = base.slice();
  const leaves = path => fields.find(f => `${f.group}.${f.key}` === path)?.leaves ?? [];
  for (let z = 0; z < l.h; z++) {
    const c = ROLE_INFO[roles[z]]?.color ?? [0.5, 0.5, 0.5];
    for (const path of ['paint.color', 'secondary.color', 'wear.color', 'wear.heavy_color'])
      leaves(path).forEach(([col, ch], i) => { px[at(l, z, col, ch)] = c[i]; });
    for (const path of ['metal.mask', 'metal.offset', 'glow.emissive', 'iridescence.strength'])
      leaves(path).forEach(([col, ch]) => { px[at(l, z, col, ch)] = path === 'metal.offset' ? -1 : 0; });
    leaves('camo.layer').forEach(([col, ch]) => { px[at(l, z, col, ch)] = -1; });
  }
  return px;
}

// The Roles panel. app: { R, api, variant, body, lut(hash) -> {w, h, kind, vanilla, edited, labels}, fields
// (the material schema), lutLabel(hash), showItem(value), current() -> the item values on screen, setPick(handler |
// null): a click on the model gives {lut, zone}, editedKey(hash), status(msg) }
export async function rolesDialog(app) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const R = app.R;
  let data = await app.api('/api/roles');
  const names = data.names;
  let brush = 'primary', group = 'Armor';
  const work = new Map();      // lut -> {roles, from: 'mine' | 'built-in' | 'suggested', dirty, coverage}
  const close = openSide(`<h3>Zone roles</h3>
    <p class="hint">What each zone is on its item, so a theme can give every item the same look per role. Click a zone
      on the model to give it the selected role. Confirmed roles are kept for every project and every item sharing the
      LUT; unconfirmed zones show a suggestion.</p>
    <div class="row" id="rlBrush"></div>
    <label class="check"><input type="checkbox" id="rlView" checked> show roles on the model</label>
    <div id="rlLuts"></div>
    <div class="row"><button id="rlConfirm" class="primary">Confirm this item</button><button id="rlNext">Next unconfirmed ▸</button>
      <select id="rlGroup" title="What to review: armor (its undersuit hidden), undersuits on their own (each one is shared by many armors), helmets, capes, backpacks, weapons"><option>Armor</option><option>Undersuits</option><option>Helmets</option><option>Capes</option><option>Backpacks</option><option>Weapons</option><option>Vehicles</option><option>Equipment</option><option>Stratagems</option><option>Eagle &amp; craft</option><option>SEAF</option><option>Super Destroyer</option><option>Ship interior</option><option>Ship crew</option></select></div>
    <p class="hint" id="rlProgress"></p>
    <div class="row"><button id="rlExport" title="The built-in roles with yours on top, as a roles.json to ship with LUT Studio">Export roles.json</button>
      <button id="rlForget" title="Your roles of the LUTs on screen go back to the built-in ones (or suggestions)">Forget mine here</button></div>
    <p class="hint" id="rlInfo"></p>`, async () => {
    if ([...work.values()].some(w => w.dirty) && !confirm('Close without confirming the changed roles?')) return false;
    app.setPick(null);
    window.removeEventListener('keydown', keys);
    document.removeEventListener('lutstudio:pieces', refresh);
    setView(false);
    R.pieceFilter = null;
  }, null, 'rolesBtn');
  const info = t => { $('rlInfo').textContent = t; };

  // the review's view: the Armor group without the undersuit, the Undersuits group the undersuit only
  const UNDER = 'undergarment';
  const shown = p => group === 'Undersuits' ? p.info.type === UNDER : group === 'Armor' ? p.info.type !== UNDER : true;
  const applyFilter = () => { R.pieceFilter = group === 'Armor' || group === 'Undersuits' ? shown : null; };
  const onScreen = () => [...new Set(R.pieces.filter(shown).map(p => p.info.lut))].filter(h => app.lut(h)?.kind === 'material');
  const saved = h => data.mine[h] ? ['mine', data.mine[h]] : data.builtin[h] ? ['built-in', data.builtin[h]] : null;
  const confirmedLut = h => !!(data.mine[h] || data.builtin[h]);

  // the LUTs on screen: saved roles, else the suggestions (from their parts' ID masks; also each zone's share)
  const prepare = async () => {
    const todo = onScreen().filter(h => !work.has(h));
    if (!todo.length) return;
    let sug = {};
    try { sug = await app.api(`/api/roles/suggest?variant=${encodeURIComponent(app.variant)}&luts=${todo.join(',')}`); } catch (e) { info(e.message); }
    for (const h of todo) {
      const l = app.lut(h), s = saved(h), g = sug[h] ?? { roles: Array(l.h).fill('keep'), coverage: null };
      const roles = s ? [...s[1]] : [...g.roles];
      while (roles.length < l.h) roles.push('keep');
      work.set(h, { roles: roles.slice(0, l.h), from: s ? s[0] : 'suggested', dirty: false, coverage: g.coverage, suggested: g.roles });
    }
  };

  // ---- the role view: each LUT on screen drawn in its roles' colors (patterns off)
  let viewOn = false;
  const setView = on => {
    viewOn = on;
    for (const p of R.pieces) {
      const h = p.info.lut, w = work.get(h), l = app.lut(h);
      if (on && w && l) {
        R.setLut('r:' + h, l.w, l.h, roleViewLut(l, l.edited ?? l.vanilla, w.roles, app.fields));
        p.lutKeys.edited = 'r:' + h;
        if (p.lutKeys.pattern) { p.rolePattern = p.lutKeys.pattern; p.lutKeys.pattern = null; }
      } else {
        p.lutKeys.edited = app.editedKey(h);
        if (p.rolePattern) { p.lutKeys.pattern = p.rolePattern; p.rolePattern = null; }
      }
    }
  };

  const brushButtons = () => {
    $('rlBrush').innerHTML = names.map((n, i) => `<button class="dzTool${n === brush ? ' on' : ''}" data-r="${n}" title="${esc(ROLE_INFO[n]?.tip ?? '')} (key ${i + 1})">
      <span class="swatch" style="background:${hexOf(ROLE_INFO[n]?.color)}"></span>${n}</button>`).join('');
    document.querySelectorAll('#rlBrush .dzTool').forEach(b => (b.onclick = () => { brush = b.dataset.r; brushButtons(); }));
  };
  const keys = e => {
    if ($('sidePanel').hidden || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const i = +e.key - 1;
    if (i >= 0 && i < names.length) { brush = names[i]; brushButtons(); }
  };
  window.addEventListener('keydown', keys);

  const setRole = (h, z, r) => {
    const w = work.get(h);
    if (!w || w.roles[z] === r) return;
    w.roles[z] = r; w.dirty = true;
    if (viewOn) setView(true);
    list();
  };

  const list = () => {
    const box = $('rlLuts');
    box.innerHTML = '';
    for (const h of onScreen()) {
      const w = work.get(h), l = app.lut(h);
      if (!w) continue;
      const sec = document.createElement('div');
      sec.className = 'rlLut';
      const state = w.dirty ? 'changed, not confirmed' : w.from === 'suggested' ? 'suggested' : w.from === 'mine' ? 'confirmed (yours)' : 'confirmed (built in)';
      sec.innerHTML = `<div class="lutName"><b>${esc(app.lutLabel(h))}</b> <span class="hint">${h} · ${state}</span></div>`;
      for (let z = 0; z < l.h; z++) {
        const a = l.edited ?? l.vanilla, c = [0, 1, 2].map(ch => a[at(l, z, 0, ch)]);
        const cov = w.coverage ? ` · ${(w.coverage[z] * 100).toFixed(w.coverage[z] < 0.01 && w.coverage[z] > 0 ? 1 : 0)}%` : '';
        const row = document.createElement('div');
        row.className = 'item rlZone' + (w.roles[z] === 'unused' ? ' dim' : '');
        row.innerHTML = `<span class="swatch" style="background:${hexOf(c)}"></span><span class="grow">${esc(l.labels?.[z] || `zone ${z}`)}<span class="hint">${cov}</span></span>
          <select>${names.map(n => `<option ${n === w.roles[z] ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <span class="hint">${w.from === 'suggested' || w.roles[z] !== w.suggested[z] ? '' : '✓'}</span>`;
        const sel = row.querySelector('select');
        sel.onchange = () => setRole(h, z, sel.value);
        row.onmouseenter = () => { R.highlight = { lut: R.pieces.find(p => p.info.lut === h)?.lutKeys.edited, zone: z, piece: -1 }; };
        row.onmouseleave = () => { R.highlight = { lut: null, zone: -1, piece: -1 }; };
        sec.appendChild(row);
      }
      box.appendChild(sec);
    }
    if (!box.children.length) box.innerHTML = '<p class="hint">No material LUT on screen.</p>';
    progress();
  };

  // ---- the items to review
  // the items to review: undersuits are the armors' undergarment LUTs (an armor's own list leaves them out)
  const items = () => group === 'Undersuits'
    ? (data.items ?? []).filter(it => it.group === 'Armor').map(it => ({ ...it, luts: it.luts.filter(x => x.type === UNDER) })).filter(it => it.luts.length)
    : (data.items ?? []).filter(it => it.group === group).map(it => group === 'Armor' ? { ...it, luts: it.luts.filter(x => x.type !== UNDER) } : it);
  const itemDone = it => it.luts.filter(x => x.body === 'any' || x.body === app.body()).every(x => confirmedLut(x.lut));
  const progress = () => {
    const all = items(), done = all.filter(itemDone).length;
    const nl = Object.keys({ ...data.builtin, ...data.mine }).length;
    $('rlProgress').textContent = `${group}: ${done} of ${all.length} items confirmed · ${nl} LUTs have roles (${Object.keys(data.mine).length} yours)`;
  };

  $('rlConfirm').onclick = async () => {
    const body = {};
    for (const h of onScreen()) if (work.get(h)) body[h] = work.get(h).roles;
    if (!Object.keys(body).length) return info('Nothing to confirm.');
    try { await app.api('/api/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { return info(e.message); }
    for (const [h, r] of Object.entries(body)) { data.mine[h] = [...r]; Object.assign(work.get(h), { from: 'mine', dirty: false }); }
    document.dispatchEvent(new Event('lutstudio:roles'));   // (the zone list's roles read again)
    list();
    info(`Confirmed ${Object.keys(body).length} LUT(s).`);
  };
  $('rlNext').onclick = async () => {
    if ([...work.values()].some(w => w.dirty) && !confirm('Leave this item without confirming the changed roles?')) return;
    const all = items(), shown = app.current(), cur = all.findIndex(it => shown.includes(it.value));
    const next = [...all.slice(cur + 1), ...all.slice(0, cur + 1)].find(it => !itemDone(it));
    if (!next) return info(`Every item in ${group} is confirmed.`);
    work.clear();
    info(`Loading ${next.label}…`);
    await app.showItem(next.value);
  };
  $('rlGroup').onchange = async () => { group = $('rlGroup').value; applyFilter(); await refresh(); };
  $('rlExport').onclick = async () => {
    await window.lutstudioWeb.download('/api/roles/export', 'roles.json');
    info('Exported: put it in server/roles.json to ship it.');
  };
  $('rlForget').onclick = async () => {
    const body = {};
    for (const h of onScreen()) if (data.mine[h]) body[h] = null;
    if (!Object.keys(body).length) return info('None of your roles is on screen.');
    if (!confirm(`Forget your roles of ${Object.keys(body).length} LUT(s)?`)) return;
    await app.api('/api/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const h of Object.keys(body)) { delete data.mine[h]; work.delete(h); }
    document.dispatchEvent(new Event('lutstudio:roles'));
    await refresh();
  };
  $('rlView').onchange = () => setView($('rlView').checked);

  // a click on the model: the selected role for that zone
  app.setPick(hit => {
    if (!work.has(hit.lut)) return info('That part has no material LUT with roles.');
    setRole(hit.lut, hit.zone, brush);
    info(`${app.lutLabel(hit.lut)} · ${app.lut(hit.lut).labels?.[hit.zone] || 'zone ' + hit.zone}: ${brush}`);
  });
  // another item shown (Next, the pickers): its LUTs
  const refresh = async () => {
    await prepare();
    setView($('rlView').checked);
    list();
  };
  document.addEventListener('lutstudio:pieces', refresh);
  const group0 = (data.items ?? []).find(it => app.current().includes(it.value))?.group;
  if (group0) { group = group0; $('rlGroup').value = group; }
  applyFilter();
  brushButtons();
  await refresh();
  return close;
}

const hexOf = c => '#' + (c ?? [0.5, 0.5, 0.5]).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
