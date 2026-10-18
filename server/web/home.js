// Start page: your projects, a new project from an item, import a project or a mod, and the game folder (picked in
// the browser: bridge.js).
import { track, flush, analyticsAvailable, analyticsOn, setAnalytics } from './analytics.js';

const $ = id => document.getElementById(id);
// where Steam installs the game by default (the start page offers it to copy into the folder window)
const STEAM_HD2 = String.raw`C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = async (url, body, raw = false) => {
  const r = await fetch(url, { method: 'POST', headers: raw ? {} : { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// notices from the update check (an app update, an item list update, an item list older than the game); the check
// finishes after the page loads, so they are asked for again a little later
function renderNotices(list) {
  const box = $('notices');
  if (!box) return;
  box.innerHTML = (list ?? []).map(n => `<div class="notice ${esc(n.kind)}">${esc(n.text)}
    ${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener">Download</a>` : ''}
    ${n.kind === 'info' ? ' <a href="#" class="reloadLink">Reload</a>' : ''}</div>`).join('');
  box.querySelectorAll('.reloadLink').forEach(a => a.onclick = e => { e.preventDefault(); location.reload(); });
}

// where the projects are: a folder on disk (Chrome / Edge), or the browser's storage
function projectsNote(p) {
  switch (p?.state) {
    case 'folder': return `<p class="hint">Projects folder: <b>${esc(p.name)}</b> · <a href="#" id="projChoose">Change…</a></p>`;
    case 'prompt': return `<p class="hint"><button id="projReconnect" class="primary">Allow access to your projects folder
      (${esc(p.name)})</button> The browser asks again on a new visit.</p>`;
    case 'browser': return `<p class="warn">Your projects are kept in this browser: clearing the site's data deletes them.
      <button id="projChoose" class="primary">Keep them in a folder on disk…</button> (e.g. Documents\\LUT Studio; the
      projects here are copied into it)</p>`;
    case 'unsupported': return `<p class="hint">Projects are kept in this browser (it can't save to a folder on disk):
      export the ones you want to keep (Project… → Export .lutproj). Chrome and Edge can keep them in a folder.</p>`;
  }
  return '';
}

export function showHome(info) {
  document.body.classList.add('at-home');
  const box = $('home');
  box.hidden = false;
  box.innerHTML = `
  <div class="homeCard">
    <h1>LUT Studio <span class="hint">${esc(info.version)}</span></h1>
    <div id="notices"></div>
    <p class="hint">Recolor Helldivers 2 armor, capes, vehicles and weapons by editing their material LUTs, see it live,
      and build a mod for HD2Arsenal.
      Your game install is only read, never changed.</p>
    <section id="gameBox" ${info.game_ok ? 'hidden' : ''}>
      <h2>Helldivers 2 folder</h2>
      ${window.lutstudioWeb?.supported ? `
      <p class="hint">LUT Studio reads the game's files from your install, in this browser only: the game is never
        changed. Choose the <b>Helldivers 2</b> folder once per visit. Your browser asks whether to "upload" its
        files: they never leave your computer, LUT Studio only reads them here.</p>
      <p class="hint">Steam installs it here by default:</p>
      <div class="row"><code id="gamePath">${esc(STEAM_HD2)}</code><button id="gamePathCopy">Copy</button></div>
      <p class="hint">In the folder window, paste the copied path into the address bar at the top, press Enter, then
        <b>Select Folder</b>. Installed on another drive (e.g. <code>D:\\SteamLibrary\\steamapps\\common\\Helldivers 2</code>)?
        In Steam: right-click Helldivers 2 → <b>Manage</b> → <b>Browse local files</b>, and copy the path from that
        window's address bar.</p>
      ${info.picked ? `<p class="err">${esc(info.game_error || 'That folder is not the Helldivers 2 install.')}</p>` : ''}
      <div class="row"><button id="gamePick" class="primary">Choose the Helldivers 2 folder…</button></div>`
      : `<p class="err">LUT Studio needs Chrome, Edge or Firefox on a computer: it reads your game folder in the
        browser, which this browser can't do.</p>`}
    </section>
    <div class="cols">
      <section>
        <h2>Your projects</h2>
        <div id="projBox">${projectsNote(info.projects)}</div>
        ${info.game_ok ? '' : '<p class="hint">Choose the Helldivers 2 folder first: projects open once LUT Studio can read the game.</p>'}
        <input type="search" id="projFilter" placeholder="Filter projects…" hidden>
        <div id="recent" class="list"></div>
        <div class="row"><label class="btnlike${info.game_ok ? '' : ' disabled'}">Import .lutproj… <input type="file" id="importFile" accept=".lutproj" hidden ${info.game_ok ? '' : 'disabled'}></label>
          <label class="btnlike${info.game_ok ? '' : ' disabled'}" title="Turn a recolor mod into a project: its LUTs (any item), decal sheets and cape designs. A mod .zip or .7z (HD2 Mod Manager / HD2Arsenal, as downloaded), or the patch files of a mod (e.g. made with the HD2 SDK): select the .patch_0 together with its .gpu_resources and .stream">Import a mod… <input type="file" id="importMod" multiple hidden ${info.game_ok ? '' : 'disabled'}></label></div>
      </section>
      <section>
        <h2>New project</h2>
        <label class="stack">Category <select id="catPick" ${info.game_ok ? '' : 'disabled'}></select></label>
        <label class="stack">Item <input type="search" id="kitFilter" placeholder="Filter by name…" ${info.game_ok ? '' : 'disabled'}>
          <select id="kitPick" size="8" ${info.game_ok ? '' : 'disabled'}><option value="">${info.game_ok ? 'Loading…' : 'Choose the Helldivers 2 folder first'}</option></select></label>
        <label class="check" id="withHelmetRow" hidden title="Start the project with this armor's own helmet too (add or change helmets any time)"><input type="checkbox" id="withHelmet" checked> <span id="withHelmetText">with its matching helmet</span></label>
        <label class="stack">Project name <input type="text" id="newName" placeholder="e.g. Black Ravager"></label>
        <p class="err" id="nameTaken" hidden></p>
        <button id="newBtn" class="primary" disabled>Create</button>
        <p class="hint">Every change is saved as you work. Projects can be exported (Project… → Export .lutproj) to
          share or back up.</p>
      </section>
    </div>
    <p id="homeStatus" class="hint"></p>
    ${analyticsAvailable() ? `<p class="hint"><label class="check" title="Anonymous usage events: what you build and edit (mod and item names, which settings, which editors), the browser and your country. Never your game files, your projects or folder names. No cookies."><input type="checkbox" id="usageData" ${analyticsOn() ? 'checked' : ''}> Send anonymous usage data</label>
      (what you build and edit, your country; never your files) to help improve LUT Studio</p>` : ''}
    <p class="hint">Enjoying LUT Studio? <a href="https://ko-fi.com/paytonrogers" target="_blank" rel="noopener">Support it on Ko-fi</a></p>
    <p class="hint">Free and open source (<a href="https://github.com/paytonrog/lut-studio/blob/main/LICENSE" target="_blank" rel="noopener">AGPL-3.0</a>): <a href="https://github.com/paytonrog/lut-studio" target="_blank" rel="noopener">source</a> ·
      <a href="THIRD-PARTY-NOTICES.txt" target="_blank">third-party licenses</a> · weapon attachment lists from the
      <a href="https://helldivers.wiki.gg" target="_blank" rel="noopener">Helldivers Wiki</a> (CC BY-NC-SA 4.0).</p>
  </div>`;
  renderNotices(info.notices);
  for (const ms of [3000, 12000]) setTimeout(() => fetch('/api/home').then(r => r.json()).then(h => renderNotices(h.notices)).catch(() => {}), ms);
  const status = (m, bad) => { const s = $('homeStatus'); s.textContent = m; s.classList.toggle('err', !!bad); };
  // open the project the API just opened: remembered for this tab (the API restarts with the page), then reload
  const open = async () => {
    try { const h = await (await fetch('/api/home')).json(); if (h.project) sessionStorage.setItem('lutstudio.project', h.project); } catch { }
    await flush();
    location.reload();
  };
  const recent = $('recent');
  if (!info.recent?.length) recent.innerHTML = '<div class="empty">No projects yet: create one on the right.</div>';
  // every project: the recently opened ones first, then the rest of the projects folder (a filter once there are many)
  if ((info.recent ?? []).length > 12) {
    $('projFilter').hidden = false;
    $('projFilter').oninput = () => {
      const q = $('projFilter').value.trim().toLowerCase();
      for (const it of recent.children) it.hidden = !!q && !it.textContent.toLowerCase().includes(q);
    };
  }
  for (const r of info.recent ?? []) {
    const it = document.createElement('div');
    it.className = 'item' + (r.ok ? '' : ' missing') + (info.game_ok ? '' : ' disabled');   // (a project opens once the game is read)
    it.innerHTML = `<div class="grow"><div>${esc(r.name)}</div><div class="sub">${esc(r.path)}${r.ok ? '' : ' · not found'}</div></div>`;
    if (r.ok && info.game_ok) it.onclick = async () => { try { await post('/api/open', { Path: r.path }); open(); } catch (e) { status(e.message, true); } };
    if (r.ok && info.game_ok) {   // (reachable with the keyboard: Tab, then Enter or Space)
      it.tabIndex = 0; it.setAttribute('role', 'button');
      it.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.click(); } };
    }
    recent.appendChild(it);
  }
  $('importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await post('/api/import', await f.arrayBuffer(), true); track('project imported', {}, true); open(); } catch (err) { status(err.message, true); }
    e.target.value = '';   // (the same file can be picked again)
  };
  $('importMod').onchange = async e => {
    const fd = new FormData();
    for (const f of e.target.files) fd.append('files', f, f.name);
    if (!fd.has('files')) return;
    status('Reading the mod…');
    try {
      const r = await fetch('/api/importmod', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const { report } = await r.json();
      try { sessionStorage.setItem('lutstudio.importReport', report); } catch { }
      track('mod imported', { files: [...e.target.files].map(f => f.name).slice(0, 5), report: String(report).slice(0, 500),
        made_with_lutstudio: /made with LUT Studio/.test(report) }, true);
      open();
    } catch (err) { status(err.message, true); track('mod import failed', { error: String(err.message).slice(0, 300) }); }
    e.target.value = '';
  };
  // the game folder: chosen once per visit (a folder file input; the API keeps it while the page is open)
  if ($('projChoose')) $('projChoose').onclick = async e => {
    e.preventDefault();
    try {
      const n = await window.lutstudioWeb.chooseProjects();
      if (n) try { sessionStorage.setItem('lutstudio.homeStatus', `Copied ${n} project(s) from the browser into the folder.`); } catch { }
      location.reload();
    } catch (err) { if (err.name !== 'AbortError') status(err.message, true); }
  };
  if ($('projReconnect')) $('projReconnect').onclick = async () => {
    if (await window.lutstudioWeb.reconnectProjects()) location.reload();
    else status('Access to the projects folder was not allowed.', true);
  };
  try { const m = sessionStorage.getItem('lutstudio.homeStatus'); if (m) { sessionStorage.removeItem('lutstudio.homeStatus'); status(m); } } catch { }
  const useGame = async how => {
    status('Reading the game folder… (the first time takes a little while)');
    try {
      const err = await how();
      if (err) { track('game connect failed', { error: String(err).slice(0, 300) }); info.picked = true; info.game_error = err; return showHome(info); }
      track('game connected', {}, true);
      await flush();
      location.reload();
    } catch (e) { if (e.name !== 'AbortError') status(e.message, true); else status(''); }
  };
  if ($('gamePick')) $('gamePick').onclick = () => useGame(() => window.lutstudioWeb.pickGameFiles());
  if ($('gamePathCopy')) $('gamePathCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(STEAM_HD2); status('Copied: paste it into the address bar of the folder window.'); }
    catch { status('Select the path and copy it (Ctrl+C).'); }
  };
  // the new project: a category (/api/kits groups: Armor, Helmets, Capes, Vehicles, Weapons, … World props, Unnamed
  // units), then an item of
  // it (filtered by name); an armor can start with its set's helmet
  let autoName = '', kits = [];
  const fillItems = () => {
    const sel = $('kitPick'), cat = $('catPick').value, q = $('kitFilter').value.trim().toLowerCase();
    sel.innerHTML = '';
    for (const k of kits.filter(k => k.group === cat && (!q || k.label.toLowerCase().includes(q)))) {
      const o = new Option(k.label, k.value); o.dataset.name = k.name; o.dataset.set = k.set ?? ''; sel.add(o);
    }
    pick();
  };
  // a name another project has (case and outer spaces aside) can't be used again
  const taken = () => {
    const n = $('newName').value.trim().toLowerCase();
    const r = n && (info.recent ?? []).find(r => r.ok && r.name.trim().toLowerCase() === n);
    $('nameTaken').hidden = !r;
    if (r) $('nameTaken').textContent = `A project named "${r.name}" exists already: pick another name.`;
    return !!r;
  };
  const pick = () => {
    const o = $('kitPick').selectedOptions[0];
    $('newBtn').disabled = !o?.value;
    $('withHelmetRow').hidden = !o?.dataset.set;
    if (o?.dataset.set) $('withHelmetText').textContent = `with its matching helmet (${o.dataset.name})`;
    if (o?.value && (!$('newName').value || $('newName').value === autoName)) {
      autoName = o.dataset.name + ' Recolor';
      for (let i = 2; (info.recent ?? []).some(r => r.ok && r.name.trim().toLowerCase() === autoName.toLowerCase()); i++) autoName = `${o.dataset.name} Recolor ${i}`;
      $('newName').value = autoName;
    }
    if (taken()) $('newBtn').disabled = true;
  };
  (async () => {
    if (!info.game_ok) return;
    const r = await fetch('/api/kits');
    kits = r.ok ? await r.json() : [];
    const cats = [...new Set(kits.map(k => k.group))];
    $('catPick').innerHTML = '';
    for (const c of cats) $('catPick').add(new Option(`${c} (${kits.filter(k => k.group === c).length})`, c));
    fillItems();
  })();
  if ($('usageData')) $('usageData').onchange = e => setAnalytics(e.target.checked);
  $('catPick').onchange = () => { $('kitFilter').value = ''; fillItems(); };
  $('kitFilter').oninput = fillItems;
  $('kitPick').onchange = pick;
  $('newName').oninput = pick;
  $('newBtn').onclick = async () => {
    const o = $('kitPick').selectedOptions[0];
    if (!o) return;
    const what = o.dataset.set && $('withHelmet').checked ? o.dataset.set : o.value;   // the armor with its helmet
    status('Creating the project (reading the LUTs from the game)…');
    $('newBtn').disabled = true;   // (a second click: no second project)
    try {
      await post('/api/new', { Name: $('newName').value, What: what });
      track('project created', { item: o.text, category: $('catPick').value, with_helmet: what !== o.value, name: $('newName').value }, true);
      open();
    } catch (e) { status(e.message, true); $('newBtn').disabled = false; }
  };
}
