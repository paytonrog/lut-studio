// The zone's looks (the right sidebar): the built-in ones and yours, in categories, one click to apply; yours saved,
// renamed, moved to another category, deleted, exported to a file and imported from one (LUT Studio's, or the Paydex
// LUT Editor's Row Presets). Yours are kept in "LUT Studio looks.json" beside your projects (/api/presets; on the
// website without a projects folder on disk: in the browser only). A saved look is the whole zone; it can be applied
// whole, its finish only (all but the colors) or its colors only.
import { $, esc } from './texedit.js';
import { BUILTIN, applyPreset, importLooks } from './presets.js';

const MINE = 'Mine';   // (a look of yours with no category)
// a material zone's colors: the paint, secondary and wear colors, the camo's four (the rest: its finish)
const COLOR_COLS = [0, 2, 5, 6, 16, 17, 18, 19];
const isColor = (col, ch) => ch < 3 && COLOR_COLS.includes(col);
const hex = v => '#' + [0, 1, 2].map(k => Math.round(Math.min(1, Math.max(0, v[k] ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
let where = null;   // {path, browser}: where yours are kept (asked once)

// ctx: { S, api, l (the LUT), z (the zone), schema (its fields), apply(fn) (fn changes l.edited: undo step, redraw),
// rerender(), status(msg, error), track(event, props), paydex() (the Paydex import panel) }
export function looksPanel(box, ctx) {
  const { S, l, z } = ctx, kind = l.kind;
  const mine = () => (S.presets ?? []).filter(p => p.kind === kind);
  const builtin = kind === 'material' ? BUILTIN : [];
  const open = new Set(JSON.parse(pref('lutstudio.looksOpen', '["Mine"]')));
  const mode = () => (kind === 'material' ? pref('lutstudio.lookMode', 'all') : 'all');
  const groups = (list, own) => {
    const by = new Map();
    for (const p of list) { const c = p.category || (own ? MINE : 'Built-in'); (by.get(c) ?? by.set(c, []).get(c)).push(p); }
    return [...by.entries()].sort((a, b) => (a[0] === MINE ? -1 : b[0] === MINE ? 1 : a[0].localeCompare(b[0])));
  };
  const row = (p, own) => {
    const i = own ? S.presets.indexOf(p) : BUILTIN.indexOf(p);
    const sw = own && p.row ? `<span class="swatch" style="background:${hex(p.row)}" title="its color"></span>` : '<span class="swatch none"></span>';
    return `<div class="item lkItem" data-own="${own ? 1 : 0}" data-i="${i}" title="${own ? 'Apply (the mode above)' : 'Apply: sets only what the look is about'}">
      ${sw}<span class="grow">${esc(p.name)}</span>
      ${own ? `<button class="lkEdit icon" data-i="${i}" title="Rename or move to another category">✎</button><button class="lkDel icon" data-i="${i}" title="Delete this look">✕</button>` : ''}</div>`;
  };
  const cats = () => [...new Set(mine().map(p => p.category).filter(Boolean))].sort();
  const html = () => {
    const own = groups(mine(), true), bi = groups(builtin, false);
    const section = ([c, list], own) => `<details class="lkCat" data-cat="${esc((own ? 'm:' : 'b:') + c)}" ${open.has((own ? 'm:' : 'b:') + c) || (own && open.has(MINE)) ? 'open' : ''}>
      <summary>${esc(c)} <span class="hint">${list.length}</span></summary>${list.map(p => row(p, own)).join('')}</details>`;
    return `<div class="lkHead"><b>Looks</b>
        ${kind === 'material' ? `<label class="hint" title="How a look of yours applies: the whole zone, its finish only (all but the colors), or its colors only">Apply <select id="lkMode">
          <option value="all">everything</option><option value="finish">finish only</option><option value="color">colors only</option></select></label>` : ''}
        <span class="grow"></span><button id="lkSave" title="Save this zone as a look of your own (all projects)">Save look</button></div>
      <div id="lkForm"></div>
      ${own.length ? `<div class="lkGroup"><div class="hint">Yours</div>${own.map(g => section(g, true)).join('')}</div>` : '<p class="hint">No looks of your own yet: Save look keeps this zone\'s settings.</p>'}
      ${bi.length ? `<div class="lkGroup"><div class="hint">Built-in</div>${bi.map(g => section(g, false)).join('')}</div>` : ''}
      <div class="row lkFiles"><button id="lkExport" title="Save your looks to a file (a backup, or to share)">Export…</button>
        <button id="lkImport" title="Bring in looks from a file: LUT Studio's, or the Paydex LUT Editor's row_presets.json">Import…</button>
        <button id="lkPaydex" class="link" title="Where the Paydex LUT Editor keeps its Row Presets">Paydex presets…</button></div>
      <p class="hint" id="lkWhere"></p>`;
  };
  const save = async (list, msg) => {
    const prev = S.presets;
    S.presets = list;
    try { await ctx.api('/api/presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.presets) }); }
    catch (e) { S.presets = prev; ctx.status('The looks were not saved: ' + e.message, true); return false; }
    if (msg) ctx.status(msg);
    return true;
  };
  // the form for a name and a category (saving this zone, or editing a look of yours)
  const form = (title, name, cat, done) => {
    const f = $('lkForm');
    f.innerHTML = `<div class="lkFormBox"><div class="hint">${esc(title)}</div>
      <div class="row"><input id="lkName" placeholder="Name" value="${esc(name)}" style="flex:2;min-width:0">
        <input id="lkCat" placeholder="Category" list="lkCats" value="${esc(cat)}" style="flex:1;min-width:0">
        <datalist id="lkCats">${cats().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="row"><button id="lkOk" class="primary">Save</button><button id="lkCancel">Cancel</button></div></div>`;
    $('lkName').focus(); $('lkName').select();
    const ok = () => { const n = $('lkName').value.trim(); if (n) done(n, $('lkCat').value.trim()); };
    $('lkOk').onclick = ok;
    $('lkCancel').onclick = () => { f.innerHTML = ''; };
    for (const id of ['lkName', 'lkCat']) $(id).onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') f.innerHTML = ''; };
  };
  const render = () => {
    box.innerHTML = html();
    if ($('lkMode')) { $('lkMode').value = mode(); $('lkMode').onchange = () => setPref('lutstudio.lookMode', $('lkMode').value); }
    box.querySelectorAll('details.lkCat').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) open.add(d.dataset.cat); else open.delete(d.dataset.cat);
      open.delete(MINE);
      setPref('lutstudio.looksOpen', JSON.stringify([...open]));
    }));
    // apply
    box.querySelectorAll('.lkItem').forEach(el => (el.onclick = e => {
      if (e.target.closest('button')) return;
      const own = el.dataset.own === '1', p = own ? S.presets[+el.dataset.i] : BUILTIN[+el.dataset.i], m = own ? mode() : 'all';
      if (!p) return;
      try {
        ctx.apply(() => {
          if (!own || !p.row || m === 'all') return applyPreset(p, l, z, ctx.schema);
          if (p.row.length !== l.w * 4) throw new Error('that look was saved from a different kind of LUT');
          for (let col = 0; col < l.w; col++) for (let ch = 0; ch < 4; ch++) if (isColor(col, ch) === (m === 'color')) l.edited[(z * l.w + col) * 4 + ch] = p.row[col * 4 + ch];
        });
      } catch (err) { return ctx.status(err.message, true); }
      const what = m === 'finish' ? ' (its finish)' : m === 'color' ? ' (its colors)' : '';
      ctx.status(`Applied "${p.name}"${what} to ${l.labels[z] || 'zone ' + z} (Ctrl+Z undoes it)`);
      ctx.track('look applied', { look: own ? '(saved look)' : p.name, kind, mode: m, category: own ? (p.category ? 'custom' : 'none') : p.category });
    }));
    // save this zone: a new look, or over one of yours of the same name
    $('lkSave').onclick = () => form('Save this zone as a look', '', pref('lutstudio.lookCat', ''), async (name, cat) => {
      setPref('lutstudio.lookCat', cat);
      const look = { name, kind, category: cat || undefined, row: Array.from(l.edited.slice(z * l.w * 4, (z + 1) * l.w * 4)), saved: new Date().toISOString() };
      const same = S.presets?.findIndex(p => p.kind === kind && p.name === name) ?? -1;
      if (same >= 0 && !confirm(`Replace your look "${name}"?`)) return;
      const list = [...(S.presets ?? [])];
      if (same >= 0) list[same] = look; else list.push(look);
      if (await save(list, `Saved the look "${name}"${cat ? ` in ${cat}` : ''}`)) { open.add('m:' + (cat || MINE)); ctx.track('look saved', { kind, category: !!cat, replaced: same >= 0 }); render(); }
    });
    // rename / move, delete
    box.querySelectorAll('.lkEdit').forEach(b => (b.onclick = () => {
      const p = S.presets[+b.dataset.i];
      form(`"${p.name}"`, p.name, p.category ?? '', async (name, cat) => {
        if (S.presets.some(q => q !== p && q.kind === kind && q.name === name)) return ctx.status(`You already have a look named "${name}"`, true);
        const list = S.presets.map(q => (q === p ? { ...q, name, category: cat || undefined } : q));
        if (await save(list, `Saved "${name}"`)) { open.add('m:' + (cat || MINE)); render(); }
      });
    }));
    box.querySelectorAll('.lkDel').forEach(b => (b.onclick = async () => {
      const p = S.presets[+b.dataset.i];
      if (!confirm(`Delete your look "${p.name}"?`)) return;
      if (await save(S.presets.filter(q => q !== p), `Deleted "${p.name}"`)) render();
    }));
    // files
    $('lkExport').onclick = () => {
      if (!S.presets?.length) return ctx.status('No looks of your own to export yet', true);
      const blob = new Blob([JSON.stringify(S.presets, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'LUT Studio looks.json';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      ctx.status(`Exported ${S.presets.length} look(s)`);
    };
    $('lkImport').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        let looks;
        try { looks = importLooks(JSON.parse(await f.text())); } catch (e) { return ctx.status('That file has no looks: ' + e.message, true); }
        if (!looks.length) return ctx.status('No looks found in that file', true);
        const n = await merge(looks);
        if (n !== null) { ctx.status(`Imported ${n} look(s)`); ctx.track('looks imported', { count: n, from: 'file' }); render(); }
      };
      inp.click();
    };
    $('lkPaydex').onclick = ctx.paydex;
    // where yours are kept
    const say = w => { if ($('lkWhere')) $('lkWhere').innerHTML = w.browser
      ? '<span class="warn">Yours are kept in this browser only.</span> Choose a projects folder on disk (start page) to keep them in a file beside your projects, or Export them.'
      : `Yours are kept in <code>${esc(w.path)}</code>.`; };
    if (where) say(where);
    else ctx.api('/api/presets/where').then(w => { where = w; say(w); }).catch(() => { });
  };
  // looks from a file into yours: one already there (same name, kind and settings) skipped, a name taken numbered
  const merge = async looks => {
    const list = [...(S.presets ?? [])], same = (a, b) => a.kind === b.kind && a.row?.length === b.row?.length && a.row.every((v, i) => Math.abs(v - b.row[i]) < 1e-6);
    let n = 0;
    for (const lk of looks) {
      if (list.some(p => p.name === lk.name && same(p, lk))) continue;
      let name = lk.name;
      for (let i = 2; list.some(p => p.kind === lk.kind && p.name === name); i++) name = `${lk.name} (${i})`;
      list.push({ ...lk, name }); n++;
    }
    return (await save(list)) ? n : null;
  };
  render();
  return { merge };
}
