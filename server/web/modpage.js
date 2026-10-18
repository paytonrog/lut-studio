// The mod page: what HD2 Mod Manager / HD2 Arsenal show of the mod. Its name, description and icon; its layout:
// one choice between the variants (its name, description and picture), or several options, each switched on by
// itself: some of the mod's parts (LUTs, decal sheets, cape designs) from one variant (a switch) or a choice between
// several; each variant's name, description and picture, their order, deleting one. A picture is a snapshot of the view (as framed, with the view's background,
// a transparent one or a color), an uploaded image, or left to the build (it renders the icon and the variant
// pictures in a fixed look). Opens beside the model, so the view can be framed for a snapshot.

import { $, esc, openSide, closeSide, pickFile } from './texedit.js';

// app: { api, state() -> S.state, variant() -> the open variant's folder, useVariant(folder), refresh(), shot(bg) ->
// a 512 x 512 PNG data URL of the view }
export async function modPage(app) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  let bg = { kind: 'view', color: '#1d2129' };
  const close = openSide(`<h3>Mod page</h3>
    <p class="hint">What the mod managers (HD2 Mod Manager, HD2 Arsenal) show: the mod's name, description and icon,
      and with several variants the choice between them, each with its own name, description and picture. A picture
      left empty is rendered when you build.</p>
    <div id="mpBody"></div>`);
  const api = app.api;
  const put = (url, body) => api(url, { method: url.includes('order') ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // a picture: its thumbnail, what it is, and snapshot / upload / reset
  const card = (target, label, fallback) => `<div class="mpCard" data-target="${esc(target)}">
      <div class="mpThumb"><img alt="" hidden><span class="hint mpNone">${esc(fallback)}</span></div>
      <div class="mpCardSide"><b>${esc(label)}</b><span class="hint mpWhat"></span>
        <div class="row"><button class="mpSnap" title="The view as it is now (frame it first)">Snapshot</button>
          <button class="mpUpload">Upload…</button><button class="mpReset">Reset</button></div></div></div>`;
  const loadThumb = async el => {
    const t = el.dataset.target, img = el.querySelector('img'), none = el.querySelector('.mpNone'), what = el.querySelector('.mpWhat');
    const r = await fetch(`/api/image?target=${encodeURIComponent(t)}&n=${Date.now()}`);
    if (r.ok) {
      img.src = URL.createObjectURL(await r.blob()); img.hidden = false; none.hidden = true;
      what.textContent = r.headers.get('X-Auto') === '1' ? 'rendered at the last build (rendered again at the next)' : 'your picture';
    } else {
      img.hidden = true; none.hidden = false;
      what.textContent = t === 'option' || /^opt:[^:]+$/.test(t) ? 'not set: the icon is shown'
        : t.startsWith('opt:') ? "not set: the variant's picture is shown" : 'not set: rendered when you build';
    }
    el.querySelector('.mpReset').disabled = !r.ok;
  };
  const savePNG = async (target, png) => {
    await api('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Target: target, PNG: png }) });
  };
  // an uploaded image, fitted into 512 x 512 (centered, the rest transparent)
  const fitted = async file => {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const k = Math.min(512 / bmp.width, 512 / bmp.height), w = bmp.width * k, h = bmp.height * k;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (512 - w) / 2, (512 - h) / 2, w, h);
    return c.toDataURL('image/png');
  };
  const wireCard = el => {
    const t = el.dataset.target;
    el.querySelector('.mpSnap').onclick = async () => {
      // a variant's picture (its own, or an option's of it) shows that variant
      const folder = t.startsWith('opt:') ? t.split(':')[2] : (t === 'icon' || t === 'option' ? '' : t);
      const switched = folder && folder !== app.variant();
      if (switched && !(await app.useVariant(folder))) return;   // (it couldn't switch: no picture of the wrong variant)
      await savePNG(t, await app.shot(bg));
      if (switched) render(); else { await loadThumb(el); preview(); }   // (the cards say which variant is shown)
    };
    el.querySelector('.mpUpload').onclick = async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      try { await savePNG(t, await fitted(f)); } catch (e) { alert('That file is not an image.'); return; }
      await loadThumb(el); preview();
    };
    el.querySelector('.mpReset').onclick = async () => {
      await api(`/api/image?target=${encodeURIComponent(t)}`, { method: 'DELETE' });
      await loadThumb(el); preview();
    };
    loadThumb(el);
  };

  const render = () => {
    const st = app.state(), p = st.project, vs = st.variants, many = vs.length > 1, opts = p.options ?? [];
    $('mpBody').innerHTML = `
      <h4>The mod</h4>
      <label class="stack">Name <input type="text" id="mpName" maxlength="120" value="${esc(p.name)}"></label>
      <label class="stack">Description <textarea id="mpDesc" rows="3">${esc(p.description)}</textarea></label>
      ${card('icon', 'Icon', 'rendered when you build')}
      <h4>Layout</h4>
      <label class="check"><input type="radio" name="mpLayout" value="simple" ${opts.length ? '' : 'checked'}> one choice between the variants</label>
      <label class="check"><input type="radio" name="mpLayout" value="options" ${opts.length ? 'checked' : ''}> several options, each switched on by itself (e.g. the armor, its cape, a glowing visor)</label>
      ${opts.length ? optionsHTML(st) : ''}
      ${many && !opts.length ? `<h4>The choice between the variants</h4>
        <p class="hint">Players pick one of the variants under this option.</p>
        <label class="stack">Name <input type="text" id="mpOpt" maxlength="60" placeholder="Color scheme" value="${esc(p.option ?? '')}"></label>
        <label class="stack">Description <input type="text" id="mpOptDesc" placeholder="Pick one." value="${esc(p.option_description ?? '')}"></label>
        ${card('option', 'Its picture', 'the icon')}` : ''}
      <h4>${many ? 'Variants' : 'The variant'}</h4>
      ${!many ? `<p class="hint">With one variant the mod managers show the mod itself; its picture (if set) is shown with it, else the icon. Add variants with <b>+ Variant</b> (top bar).</p>` : ''}
      <div id="mpVariants">${vs.map((v, i) => `<div class="mpVariant" data-folder="${esc(v.folder)}">
        ${card(v.folder, v.folder === app.variant() ? 'Picture (shown now)' : 'Picture', 'rendered when you build')}
        <label class="stack">Name <input type="text" class="mpVName" maxlength="60" value="${esc(v.name)}"></label>
        <label class="stack">Description <input type="text" class="mpVDesc" value="${esc(v.description ?? '')}"></label>
        <div class="row"><button class="mpShow">Show it</button>
          ${many ? `<button class="mpUp" ${i === 0 ? 'disabled' : ''} title="Earlier in the list">↑</button><button class="mpDown" ${i === vs.length - 1 ? 'disabled' : ''} title="Later in the list">↓</button>
          <button class="mpDel">Delete…</button>` : ''}</div></div>`).join('')}</div>
      <h4>Snapshots</h4>
      <div class="row"><label>Background <select id="mpBg"><option value="view">the view's</option><option value="none">transparent</option><option value="color">a color</option></select></label>
        <input type="color" id="mpBgColor" value="${bg.color}" ${bg.kind === 'color' ? '' : 'hidden'}></div>
      <p class="hint">A snapshot is the view as it is now, cut to a square: turn and zoom the model first. A variant's
        snapshot shows that variant.</p>
      <h4>How the mod managers list it</h4>
      <div id="mpPreview"></div>`;
    $('mpBg').value = bg.kind;
    $('mpBg').onchange = () => { bg.kind = $('mpBg').value; $('mpBgColor').hidden = bg.kind !== 'color'; };
    $('mpBgColor').oninput = () => { bg.color = $('mpBgColor').value; };
    const saveProject = async () => {
      try {
        const body = { Name: $('mpName').value, Description: $('mpDesc').value };
        if ($('mpOpt')) Object.assign(body, { Option: $('mpOpt').value, OptionDescription: $('mpOptDesc').value });
        await put('/api/project', body);
        await app.refresh(); preview();
      } catch (e) { alert(e.message); }
    };
    for (const id of ['mpName', 'mpDesc', 'mpOpt', 'mpOptDesc']) if ($(id)) $(id).onchange = saveProject;
    document.querySelectorAll('input[name=mpLayout]').forEach(r => (r.onchange = async () => {
      if (r.value === 'options') await saveOptions(splitByItem(app.state()));
      else if (confirm('Back to one choice between the variants? The options (and their pictures) are removed from the mod page.')) await saveOptions([]);
      render();
    }));
    if (opts.length) wireOptions(st);
    document.querySelectorAll('.mpCard').forEach(wireCard);
    document.querySelectorAll('.mpVariant').forEach(row => {
      const f = row.dataset.folder;
      const saveVariant = async () => {
        try { await put('/api/variant', { Folder: f, Name: row.querySelector('.mpVName').value, Description: row.querySelector('.mpVDesc').value }); await app.refresh(); preview(); }
        catch (e) { alert(e.message); }
      };
      row.querySelector('.mpVName').onchange = saveVariant;
      row.querySelector('.mpVDesc').onchange = saveVariant;
      row.querySelector('.mpShow').onclick = async () => { await app.useVariant(f); render(); };
      const move = async d => {
        const order = app.state().variants.map(v => v.folder), i = order.indexOf(f);
        [order[i], order[i + d]] = [order[i + d], order[i]];
        await put('/api/variants/order', { Folders: order });
        await app.refresh(); render();
      };
      if (row.querySelector('.mpUp')) row.querySelector('.mpUp').onclick = () => move(-1);
      if (row.querySelector('.mpDown')) row.querySelector('.mpDown').onclick = () => move(1);
      if (row.querySelector('.mpDel')) row.querySelector('.mpDel').onclick = async () => {
        const v = app.state().variants.find(x => x.folder === f);
        if (!confirm(`Delete the variant "${v.name}"? It's moved to the project's .trash folder, not erased.`)) return;
        try {
          await api(`/api/variant?folder=${encodeURIComponent(f)}`, { method: 'DELETE' });
          await app.refresh();
          if (app.variant() === f || !app.state().variants.some(x => x.folder === app.variant())) await app.useVariant(app.state().variants[0].folder);
          render();
        } catch (e) { alert(e.message); }
      };
    });
    preview();
  };

  // the managers' list: the mod (icon, name, description) and, with several variants, the choice and its variants
  const preview = async () => {
    const st = app.state(), p = st.project, vs = st.variants;
    const src = async t => { const r = await fetch(`/api/image?target=${encodeURIComponent(t)}&n=${Date.now()}`); return r.ok ? URL.createObjectURL(await r.blob()) : ''; };
    const icon = await src('icon');
    const pic = (s, alt) => s ? `<img src="${s}" alt="">` : `<span class="mpNoPic">${esc(alt)}</span>`;
    let html = `<div class="mpMod">${pic(icon, 'icon')}<div><b>${esc(p.name)}</b><div class="hint">${esc(p.description)}</div></div></div>`;
    if (p.options?.length) {
      for (const o of p.options) {
        html += `<div class="mpOptRow">${pic((await src('opt:' + o.id)) || icon, 'picture')}<div><b>☐ ${esc(o.name)}</b><div class="hint">${esc(o.description ?? '')}</div></div></div>`;
        if (o.variants.length > 1) for (const f of o.variants) {
          const v = vs.find(x => x.folder === f);
          if (v) html += `<div class="mpSubRow">${pic((await src('opt:' + o.id + ':' + f)) || (await src(f)) || icon, 'picture')}<div><b>${esc(v.name)}</b><div class="hint">${esc(v.description ?? '')}</div></div></div>`;
        }
      }
    } else if (vs.length > 1) {
      const opt = (await src('option')) || icon;
      html += `<div class="mpOptRow">${pic(opt, 'picture')}<div><b>${esc(p.option || 'Color scheme')}</b><div class="hint">${esc(p.option_description || 'Pick one.')}</div></div></div>`;
      for (const v of vs) html += `<div class="mpSubRow">${pic((await src(v.folder)) || icon, 'picture')}<div><b>${esc(v.name)}</b><div class="hint">${esc(v.description ?? '')}</div></div></div>`;
    }
    if ($('mpPreview')) $('mpPreview').innerHTML = html;
  };
  // ---- options: the parts of the mod, grouped by item (the project's own items first), and its textures
  const partsOf = st => {
    const luts = [...new Map(st.variants.flatMap(v => v.luts ?? []).map(l => [l.lut, l])).values()];
    const texs = [...new Map(st.variants.flatMap(v => v.textures ?? []).map(t => [t.hash, t])).values()];
    // a LUT's item: its first use by one of the project's items; an armor and its helmet share a name (and key), not
    // an id: their kind (armor / helmet) tells them apart
    const owner = h => (st.parts?.[h] ?? []).find(x => st.kits?.includes(x.key));
    const groups = new Map();
    for (const l of luts) {
      const o = owner(l.lut), k = o ? o.key + '|' + o.id : '';
      if (!groups.has(k)) groups.set(k, { key: o?.key ?? '', type: o ? app.kitType?.(o.id) ?? '' : '', items: [] });
      const slots = [...new Set((st.parts?.[l.lut] ?? []).filter(x => o && x.key === o.key && x.id === o.id).map(x => x.slot).filter(Boolean))].slice(0, 4).join(', ');
      groups.get(k).items.push({ hash: l.lut, label: `${l.kind}${slots ? ' · ' + slots : ''}` });
    }
    const typed = new Set([...groups.values()].filter(g => [...groups.values()].some(h => h !== g && h.key === g.key)).map(g => g.key));
    const out = [...groups.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || (st.kits ?? []).indexOf(a[1].key) - (st.kits ?? []).indexOf(b[1].key))
      .map(([k, g]) => ({ key: k, label: !k ? 'On no listed item' : (st.labels?.[g.key] ?? g.key) + (typed.has(g.key) && g.type ? ` (${g.type.toLowerCase()})` : ''), items: g.items }));
    if (texs.length) out.push({ key: '#tex', label: 'Decal sheets and cape designs', items: texs.map(t => ({ hash: t.hash, label: `${t.kind} ${t.hash}` })) });
    return out;
  };
  // one option per item (and one for the textures), each offering every variant
  const splitByItem = st => partsOf(st).map(g => ({ name: g.label.slice(0, 60), description: '', parts: g.items.map(i => i.hash), variants: st.variants.map(v => v.folder) }));
  const saveOptions = async list => {
    try {
      await put('/api/options', { Options: list.map(o => ({ id: o.id ?? '', name: o.name, description: o.description ?? '', parts: o.parts ?? [], variants: o.variants ?? [] })) });
      await app.refresh();
    } catch (e) { alert(e.message); }
  };
  const optionsHTML = st => {
    const opts = st.project.options, groups = partsOf(st);
    const count = new Map();
    for (const o of opts) for (const h of o.parts ?? []) count.set(h, (count.get(h) ?? 0) + 1);
    const all = groups.flatMap(g => g.items.map(i => i.hash));
    const none = all.filter(h => !count.get(h)).length, twice = all.filter(h => count.get(h) > 1).length;
    return `<p class="hint">Each option holds some of the mod's parts, taken from the variants it offers: one variant
        makes it a plain switch, several a choice players pick one of. The game swaps a LUT whole: a part in two
        options is the later one's when both are on.</p>
      ${none ? `<p class="warn">${none} part(s) are in no option: they're left out of the mod.</p>` : ''}
      ${twice ? `<p class="warn">${twice} part(s) are in several options: the later one wins when both are on.</p>` : ''}
      <div class="row"><button id="mpAddOpt">+ Option</button><button id="mpSplit" title="One option per item, each offering every variant">Split by item</button></div>
      ${opts.map((o, i) => `<div class="mpOption" data-i="${i}">
        <label class="stack">Option name <input type="text" class="mpOName" maxlength="60" value="${esc(o.name)}"></label>
        <label class="stack">Description <input type="text" class="mpODesc" value="${esc(o.description ?? '')}"></label>
        ${card('opt:' + o.id, 'Its picture', 'the icon')}
        <details class="mpParts"><summary>Parts: ${(o.parts ?? []).length} of ${all.length}</summary>
          ${groups.map(g => `<div class="mpGroup"><label class="check"><input type="checkbox" class="mpGrp" data-key="${esc(g.key)}"
              ${g.items.every(it => o.parts?.includes(it.hash)) ? 'checked' : ''}> <b>${esc(g.label)}</b> (${g.items.length})</label>
            ${g.items.map(it => `<label class="check mpPart"><input type="checkbox" class="mpPt" data-hash="${it.hash}" ${o.parts?.includes(it.hash) ? 'checked' : ''}>
              ${esc(it.label)} <span class="hint">${it.hash}${count.get(it.hash) > 1 ? ' · in several options' : ''}</span></label>`).join('')}</div>`).join('')}
        </details>
        <div class="mpOVars"><span class="hint">Variants it offers (${o.variants.length > 1 ? 'players pick one' : 'one: a switch'}):</span>
          ${st.variants.map(v => `<label class="check"><input type="checkbox" class="mpOV" data-folder="${esc(v.folder)}" ${o.variants.includes(v.folder) ? 'checked' : ''}> ${esc(v.name)}</label>`).join('')}</div>
        ${o.variants.length > 1 ? `<details><summary>Its pictures of the variants</summary>
          ${o.variants.map(f => card('opt:' + o.id + ':' + f, st.variants.find(v => v.folder === f)?.name ?? f, "the variant's picture")).join('')}</details>` : ''}
        <div class="row"><button class="mpOUp" ${i ? '' : 'disabled'}>↑</button><button class="mpODown" ${i < opts.length - 1 ? '' : 'disabled'}>↓</button>
          <button class="mpODel">Remove option</button></div></div>`).join('')}`;
  };
  const wireOptions = st => {
    const list = () => structuredClone(app.state().project.options ?? []);
    const change = async f => { const l = list(); f(l); await saveOptions(l); render(); };
    $('mpAddOpt').onclick = () => change(l => l.push({ name: 'Option ' + (l.length + 1), parts: [], variants: [app.state().variants[0].folder] }));
    $('mpSplit').onclick = async () => { if (confirm('Replace the options with one per item?')) { await saveOptions(splitByItem(app.state())); render(); } };
    const groups = partsOf(st);
    document.querySelectorAll('.mpOption').forEach(el => {
      const i = +el.dataset.i;
      el.querySelector('.mpOName').onchange = e => change(l => { l[i].name = e.target.value || l[i].name; });
      el.querySelector('.mpODesc').onchange = e => change(l => { l[i].description = e.target.value; });
      el.querySelectorAll('.mpPt').forEach(cb => (cb.onchange = () => change(l => {
        const ps = new Set(l[i].parts ?? []);
        cb.checked ? ps.add(cb.dataset.hash) : ps.delete(cb.dataset.hash);
        l[i].parts = [...ps];
      })));
      el.querySelectorAll('.mpGrp').forEach(cb => (cb.onchange = () => change(l => {
        const ps = new Set(l[i].parts ?? []), g = groups.find(x => x.key === cb.dataset.key);
        for (const it of g.items) cb.checked ? ps.add(it.hash) : ps.delete(it.hash);
        l[i].parts = [...ps];
      })));
      el.querySelectorAll('.mpOV').forEach(cb => (cb.onchange = () => {
        const order = app.state().variants.map(v => v.folder), cur = new Set(list()[i].variants);
        cb.checked ? cur.add(cb.dataset.folder) : cur.delete(cb.dataset.folder);
        if (!cur.size) { cb.checked = true; alert('An option needs one variant at least.'); return; }
        change(l => { l[i].variants = order.filter(f => cur.has(f)); });
      }));
      el.querySelector('.mpOUp').onclick = () => change(l => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; });
      el.querySelector('.mpODown').onclick = () => change(l => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; });
      el.querySelector('.mpODel').onclick = () => { if (confirm(`Remove the option "${list()[i].name}"?`)) change(l => { l.splice(i, 1); }); };
    });
  };

  render();
  return close;
}
