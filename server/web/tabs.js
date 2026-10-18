// The sidebars' tabs. Each sidebar (#left, #right) has a tab strip: its own pane first (Parts on the left, Zone on the
// right), then the editors' tabs (Theme, Mod page, Showcase, Decals, Cape design, Masks, Roles). An editor's tab can sit
// in either sidebar: dragged to a place in either strip, or right-clicked to the other one; where they are is kept in
// this browser. One editor is open at a time: its panel (#sidePanel, or the showcase's #scSide) takes the place of the
// pane of the sidebar its tab is in.

const $ = id => document.getElementById(id);
const HOME = { left: 'partsTab', right: 'zoneTab' };
const PANE = { left: 'partsPane', right: 'zonePane' };
// the editors' tabs, in order, and their sidebar until moved
const TABS = [['themeBtn', 'left'], ['modPageBtn', 'left'], ['decals', 'left'], ['design', 'left'], ['masksBtn', 'left'],
  ['rolesBtn', 'left'], ['showcaseBtn', 'right']];
const KEY = 'lutstudio.tabs';

// where the tabs are: { left: [ids], right: [ids] } (a tab not in it: in its own sidebar, at the end)
function layout() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { }
  const out = { left: [], right: [] }, seen = new Set();
  for (const side of ['left', 'right'])
    for (const id of Array.isArray(saved?.[side]) ? saved[side] : [])
      if (TABS.some(([t]) => t === id) && !seen.has(id)) { out[side].push(id); seen.add(id); }
  for (const [id, side] of TABS) if (!seen.has(id)) out[side].push(id);
  return out;
}
function keep() {
  const out = {};
  for (const side of ['left', 'right']) out[side] = [...strip(side).children].map(b => b.id).filter(id => id !== HOME[side]);
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { }
}
const strip = side => $(side + 'Tabs');

// the sidebar a tab is in ('left' / 'right')
export function sideOf(id) { return $(id)?.closest('aside')?.id === 'right' ? 'right' : 'left'; }

// the tabs as on screen: tab (an editor's) on in its sidebar, the other sidebar on its own pane; none: both panes
export function tabsOn(tab) {
  const side = tab ? sideOf(tab) : null;
  for (const s of ['left', 'right'])
    for (const b of strip(s).children) b.classList.toggle('on', s === side ? b.id === tab : b.id === HOME[s]);
}

// an editor's panel into the sidebar of its tab, in place of that sidebar's pane (null: the panes back)
export function dock(panel, tab) {
  const side = tab ? sideOf(tab) : 'left';
  for (const s of ['left', 'right']) $(PANE[s]).hidden = !!panel && s === side;
  if (panel) $(side).append(panel);
  document.body.classList.toggle('sideOpen', !!panel && panel.id === 'sidePanel' && side === 'left');
  document.body.classList.toggle('sideOpenR', !!panel && panel.id === 'sidePanel' && side === 'right');
  document.body.classList.toggle('scLeft', !!panel && panel.id === 'scSide' && side === 'left');
}

// a tab moved: to before `before` (null: the end) in that sidebar's strip; an open editor's panel follows it
function move(id, side, before) {
  const b = $(id);
  if (!b || b === before) return;
  strip(side).insertBefore(b, before ?? null);
  keep();
  if (b.classList.contains('on')) {
    const panel = [$('sidePanel'), $('scSide')].find(p => !p.hidden);
    if (panel) { dock(panel, id); tabsOn(id); }
  }
}

// once at startup: the tabs placed as kept; dragging, right-click, a click on an open tab does nothing
export function setupTabs() {
  const at = layout();
  for (const side of ['left', 'right']) for (const id of at[side]) if ($(id)) strip(side).append($(id));
  for (const [id] of TABS) {
    const b = $(id);
    if (!b) continue;
    b.draggable = true;
    b.title = (b.title ? b.title + '. ' : '') + 'Drag the tab to move it (to either sidebar); right-click: to the other sidebar';
    b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-lutstudio-tab', id); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging'); });
    b.addEventListener('dragend', () => { b.classList.remove('dragging'); document.querySelectorAll('.dropBefore, .dropEnd').forEach(x => x.classList.remove('dropBefore', 'dropEnd')); });
    b.addEventListener('contextmenu', e => { e.preventDefault(); move(id, sideOf(id) === 'left' ? 'right' : 'left', null); });
  }
  for (const side of ['left', 'right']) {
    const s = strip(side);
    // the tab the drop goes before: the first one whose middle is right of the pointer (on its row)
    const target = e => [...s.children].find(c => c.id !== HOME[side] && !c.hidden && !c.classList.contains('dragging')
      && (() => { const r = c.getBoundingClientRect(); return e.clientY < r.bottom && (e.clientY < r.top || e.clientX < r.left + r.width / 2); })()) ?? null;
    s.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-lutstudio-tab')) return;
      e.preventDefault();
      document.querySelectorAll('.dropBefore, .dropEnd').forEach(x => x.classList.remove('dropBefore', 'dropEnd'));
      const t = target(e);
      (t ?? s).classList.add(t ? 'dropBefore' : 'dropEnd');
    });
    s.addEventListener('dragleave', e => {
      if (s.contains(e.relatedTarget)) return;
      s.querySelectorAll('.dropBefore').forEach(x => x.classList.remove('dropBefore'));
      s.classList.remove('dropEnd');
    });
    s.addEventListener('drop', e => {
      const id = e.dataTransfer.getData('text/x-lutstudio-tab');
      if (!id) return;
      e.preventDefault();
      move(id, side, target(e));
    });
    // a tab already on: nothing (its panel is open; a pane already shown)
    s.addEventListener('click', e => { const b = e.target.closest('button'); if (b?.classList.contains('on')) e.stopImmediatePropagation(); }, true);
  }
}
