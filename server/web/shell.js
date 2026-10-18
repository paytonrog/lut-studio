// LUT Studio's host in the browser: the worker running the Go program (worker.js, WebAssembly) with the game folder
// and the projects. It lives in the top page (index.html), and the editor runs in a frame inside it (app.html,
// bridge.js), so the editor can reload (opening a project, going back to the start page) while the worker, the
// mounted game folder and the open project stay. createShell() is also used by app.html opened on its own.
// (The overlay styles are its own: the host page has none.)
window.createShell = () => {
  const worker = new Worker('worker.js');
  const waiting = new Map();
  let next = 1, readyOk, readyFail, mounted = false;
  const ready = new Promise((ok, no) => { readyOk = ok; readyFail = no; });

  // the loading overlay (over the editor): starting the app, then reading the game folder
  if (!document.getElementById('loadingStyle')) {
    const st = document.createElement('style');
    st.id = 'loadingStyle';
    st.textContent = `#loading { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  background: rgba(10, 11, 14, 0.72); }
#loading .card { min-width: 320px; max-width: 80vw; padding: 18px 22px; border-radius: 8px; background: #1d2026;
  color: #e6e6e6; font: 14px system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); }
#loading .bar { margin-top: 12px; height: 6px; border-radius: 3px; background: #2c313a; overflow: hidden; }
#loading .fill { height: 100%; width: 0; background: #f2c14e; transition: width 0.15s; }
#loading .fill.busy { width: 35%; animation: lsbusy 1.1s ease-in-out infinite; }
@keyframes lsbusy { from { transform: translateX(-100%); } to { transform: translateX(290%); } }`;
    document.head.appendChild(st);
  }
  let box = null;
  const loading = (text, frac) => {
    if (text === null) { box?.remove(); box = null; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'loading';
      box.innerHTML = '<div class="card"><div class="text"></div><div class="bar"><div class="fill"></div></div></div>';
      (document.body ?? document.documentElement).appendChild(box);
    }
    box.querySelector('.text').textContent = text;
    const fill = box.querySelector('.fill');
    fill.classList.toggle('busy', frac == null);
    fill.style.width = frac == null ? '' : `${Math.round(frac * 100)}%`;
  };
  loading('Starting LUT Studio…', null);

  worker.onmessage = ({ data: m }) => {
    if (m.type === 'progress') {
      const f = m.total ? m.done / m.total : 0;
      return loading(f < 1 ? `Reading the Helldivers 2 folder… ${Math.round(f * 100)}%` : 'Reading the item names…', f < 1 ? f : null);
    }
    if (m.type === 'ready') { loading(null); return readyOk(m.version); }
    if (m.type === 'fatal') { console.error(m.error); loading('LUT Studio could not start: ' + m.error, 0); return readyFail(new Error(m.error)); }
    if (m.type === 'exit') { failAll('LUT Studio stopped (reload the page)'); return; }
    if (m.type !== 'res') return;
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (w) w.resolve(m);
  };
  // (the program stopped: the requests waiting get an error answer, the page says so)
  const failAll = why => {
    for (const [id, w] of waiting) { waiting.delete(id); w.resolve({ type: 'res', id, status: 503, headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode(why) }); }
    loading(why, 0);
  };
  worker.onerror = e => { console.error(e); failAll('LUT Studio stopped: ' + (e.message || 'an error') + ' (reload the page)'); };
  const send = (msg, transfer = []) => new Promise(resolve => {
    const id = next++;
    waiting.set(id, { resolve });
    worker.postMessage({ ...msg, id }, transfer);
  });

  // the projects folder on disk (Chrome / Edge), kept between visits (IndexedDB keeps the handle; the browser may ask
  // again for access on a later visit)
  const db = () => new Promise((ok, no) => {
    const r = indexedDB.open('lutstudio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const kv = async (key, value) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction('kv', value === undefined ? 'readonly' : 'readwrite');
      const r = value === undefined ? t.objectStore('kv').get(key) : t.objectStore('kv').put(value, key);
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
  };
  let projects = null;   // {state: 'folder' | 'prompt' | 'browser' | 'unsupported', name}

  const shell = {
    ready,
    get mounted() { return mounted; },
    // an /api request: {status, headers, body: Uint8Array}
    async request(method, url, ctype, body) {
      await ready;
      return send({ type: 'req', method, url, ctype, body }, body ? [body.buffer] : []);
    },
    // mount a game folder ({files: [[path, File]]}, or {base, files} for tests) and
    // open it: '' or the error
    async mountGame(source) {
      await ready;
      loading('Reading the Helldivers 2 folder…', 0);
      try {
        const r = await send({ type: 'game', source });
        mounted = !r.error;
        return r.error ?? '';
      } finally { loading(null); }
    },
    // the projects folder: where it is ('folder': on disk, mounted; 'prompt': on disk, needs a click to allow access
    // again; 'browser': the browser's storage, a folder could be chosen; 'unsupported': this browser can't)
    async restoreProjects() {
      if (projects) return projects;
      if (typeof window.showDirectoryPicker !== 'function') return projects = { state: 'unsupported' };
      const h = await kv('projectsDir').catch(() => null);
      if (!h) return projects = { state: 'browser' };
      if (await h.queryPermission({ mode: 'readwrite' }) !== 'granted') return { state: 'prompt', name: h.name };
      await ready;
      await send({ type: 'projects', handle: h, copy: false });
      return projects = { state: 'folder', name: h.name };
    },
    savedProjects: () => kv('projectsDir').catch(() => null),
    // use a folder on disk for the projects (picked in the editor's frame): remembered; the browser-storage projects
    // are copied into it; returns how many
    async useProjects(h) {
      await ready;
      await kv('projectsDir', h);
      const r = await send({ type: 'projects', handle: h, copy: true });
      projects = { state: 'folder', name: h.name };
      return r.copied ?? 0;
    },
    async mountSavedProjects(h) {
      await ready;
      await send({ type: 'projects', handle: h, copy: false });
      projects = { state: 'folder', name: h.name };
    },
    // the files of a folder chosen with <input webkitdirectory>, as [[path under data/, File]] (the picked folder: the
    // install, or data/ itself); chosen again each visit (Chrome's folder picker, which would remember it, refuses
    // Program Files, Steam's default install location)
    async mountFiles(files) {
      const list = [...files].map(f => [f.webkitRelativePath.split('/').slice(1).join('/'), f]);
      const isData = list.some(([p]) => p === 'bundles.nxa');
      const entries = list.map(([p, f]) => [isData ? 'data/' + p : p, f]).filter(([p]) => p.startsWith('data/'));
      if (!entries.some(([p]) => p === 'data/bundles.nxa')) return 'That folder is not the Helldivers 2 install (it has no data\\bundles.nxa).';
      return this.mountGame({ files: entries });
    },
  };
  return shell;
};

if (window.parent === window && !window.lutstudioShell && document.getElementById('app')) window.lutstudioShell = window.createShell();
