// The editor's side of LUT Studio in the browser (app.html): its /api requests go to the host's worker (shell.js:
// the page around this frame, or one of its own when app.html is opened alone) instead of the network.
(() => {
  let shell = null;
  try { if (window.parent !== window) shell = window.parent.lutstudioShell ?? null; } catch { }
  if (!shell) shell = window.lutstudioShell ??= window.createShell();

  const netFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const at = u.pathname.indexOf('/api/');
    if (u.origin !== location.origin || at < 0) return netFetch(input, init);
    const body = ['GET', 'HEAD'].includes(req.method) ? null : new Uint8Array(await req.arrayBuffer());
    const t0 = performance.now(), url = u.pathname.slice(at) + u.search;
    const r = await shell.request(req.method, url, req.headers.get('content-type') ?? '', body);
    const ms = performance.now() - t0;
    if (ms > 500) console.debug(`api ${url}: ${(ms / 1000).toFixed(1)} s`);
    if (r.error) throw new Error(r.error);
    return new Response([204, 304].includes(r.status) ? null : new Uint8Array(r.body), { status: r.status, headers: r.headers });
  };

  // the tab shows the editor's title
  const syncTitle = () => { try { if (window.parent !== window) window.parent.document.title = document.title; } catch { } };
  addEventListener('DOMContentLoaded', () => {
    syncTitle();
    const t = document.querySelector('title');
    if (t) new MutationObserver(syncTitle).observe(t, { childList: true });
  });

  window.lutstudioWeb = {
    ready: shell.ready,
    get mounted() { return shell.mounted; },
    mountGame: source => shell.mountGame(source),
    // the projects folder on disk (Chrome / Edge)
    restoreProjects: () => shell.restoreProjects(),
    async chooseProjects() {
      const h = await window.showDirectoryPicker({ id: 'lutstudio-projects', mode: 'readwrite', startIn: 'documents' });
      return shell.useProjects(h);
    },
    async reconnectProjects() {
      const h = await shell.savedProjects();
      if (!h || await h.requestPermission({ mode: 'readwrite' }) !== 'granted') return false;
      await shell.mountSavedProjects(h);
      return true;
    },
    // the game folder: chosen with a folder file input (every browser; Chrome's folder picker refuses Program Files)
    folderInput: 'webkitdirectory' in document.createElement('input'),
    pickGameFiles() {
      return new Promise((resolve, reject) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.webkitdirectory = true; inp.hidden = true;
        inp.onchange = () => { inp.remove(); inp.files.length ? shell.mountFiles(inp.files).then(resolve, reject) : reject(Object.assign(new Error('none'), { name: 'AbortError' })); };
        inp.oncancel = () => { inp.remove(); reject(Object.assign(new Error('none'), { name: 'AbortError' })); };
        document.body.appendChild(inp); inp.click();
      });
    },
    get supported() { return this.folderInput; },
    // save a response as a download (the mod zip, a project export)
    async download(url, fallbackName) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      const cd = r.headers.get('content-disposition') ?? '';
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? fallbackName;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = decodeURIComponent(name);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    },
  };
})();
