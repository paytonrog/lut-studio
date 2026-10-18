// The Changes tab: every zone of this variant that differs from the game, by material (its kind of piece and parts),
// with what changed in it (the field groups: paint, wear, camo...); a click goes to that zone, ↺ puts it back as the
// game has it. Drawn again as you edit ("lutstudio:edited" on document).
import { $, esc, openSide, closeSide } from './texedit.js';

// app: { luts() -> Map hash -> {w, h, kind, edited, vanilla, labels, pull}, schema(kind), describe(hash) -> {badge, parts, cls},
// variant(), select(hash, zone), reset(hash, zone), hex(v) }
export async function changesPanel(app) {
  if (!(await closeSide())) return;
  const close = openSide(`<h3>Changes</h3>
    <p class="hint">Every zone of the <b id="chVariant"></b> variant that differs from the game, and what changed in it.
      Click one to edit it; ↺ puts it back as the game has it.</p>
    <p class="hint" id="chCount"></p>
    <div id="chList" class="list"></div>`, null, null, 'changesBtn');
  const draw = () => {
    if (!$('chList')) return;
    $('chVariant').textContent = app.variant();
    let zones = 0, luts = 0;
    const groups = [];
    for (const [hash, l] of app.luts()) {
      if (!l.edited || !l.vanilla || l.pull) continue;
      const fields = (app.schema(l.kind) ?? []).filter(f => !f.hidden);
      const rows = [];
      for (let z = 0; z < (l.kind === 'pattern' ? 1 : l.h); z++) {
        const at = (c, ch) => (z * l.w + c) * 4 + ch;
        const what = [...new Set(fields.filter(f => f.leaves.some(([c, ch]) => l.edited[at(c, ch)] !== l.vanilla[at(c, ch)])).map(f => f.group))];
        if (!what.length) continue;
        rows.push({ z, what, was: [0, 1, 2].map(ch => l.vanilla[at(0, ch)]), now: [0, 1, 2].map(ch => l.edited[at(0, ch)]) });
      }
      if (!rows.length) continue;
      luts++; zones += rows.length;
      groups.push({ hash, l, rows, d: app.describe(hash) });
    }
    $('chCount').textContent = zones ? `${zones} zone${zones === 1 ? '' : 's'} changed in ${luts} material${luts === 1 ? '' : 's'}.` : 'Nothing changed yet in this variant: it is as the game has it.';
    const sw = c => `background:#${c.map(app.hex).join('')}`;
    $('chList').innerHTML = groups.map(g => `<div class="chGroup"><div class="lutName"><span class="badge ${g.d.cls}">${esc(g.d.badge)}</span>${esc(g.d.parts)}</div>
      ${g.rows.map(r => `<div class="item chZone" data-h="${g.hash}" data-z="${r.z}" tabindex="0" role="button" title="Edit this zone">
        ${g.l.kind === 'material' ? `<span class="swatch" style="${sw(r.was)}" title="as the game has it"></span>→<span class="swatch" style="${sw(r.now)}" title="now"></span>` : ''}
        <span class="grow">${esc(g.l.labels?.[r.z] || (g.l.kind === 'pattern' ? 'pattern' : 'zone ' + r.z))}<span class="sub"> ${esc(r.what.join(', '))}</span></span>
        <button class="chReset" title="Put this zone back as the game has it">↺</button></div>`).join('')}</div>`).join('');
    $('chList').querySelectorAll('.chZone').forEach(it => {
      const h = it.dataset.h, z = +it.dataset.z;
      it.onclick = e => { if (!e.target.closest('.chReset')) app.select(h, z); };
      it.onkeydown = e => { if (e.key === 'Enter') app.select(h, z); };
      it.querySelector('.chReset').onclick = () => app.reset(h, z);
    });
  };
  let pending = false;
  const later = () => { if (!pending) { pending = true; setTimeout(() => { pending = false; draw(); }, 250); } };
  document.addEventListener('lutstudio:edited', later, { signal: close.signal });
  draw();
}
