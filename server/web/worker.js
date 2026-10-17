// LUT Studio's API in the browser: the Go program (web_js.go, built to lutstudio.wasm) in this worker, with the file
// system of gofs.js. The page (bridge.js) sends {type: 'req'} for its /api requests and {type: 'game'} to mount the
// picked Helldivers 2 folder.
importScripts('gofs.js', 'wasm_exec.js');

let goReady;
self.lutstudioReady = version => goReady(version);
const started = (async () => {
  await gofs.init();
  const go = new Go();
  const ready = new Promise(r => { goReady = r; });
  const { instance } = await WebAssembly.instantiateStreaming(fetch('lutstudio.wasm'), go.importObject);
  go.run(instance).then(() => postMessage({ type: 'exit' }));
  const version = await ready;
  postMessage({ type: 'ready', version });
})().catch(e => postMessage({ type: 'fatal', error: String(e?.stack ?? e) }));

onmessage = async ({ data: m }) => {
  try {
    await started;
    if (m.type === 'req') {
      const r = await lutstudioRequest(m.method, m.url, m.ctype, m.body ?? null);
      postMessage({ type: 'res', id: m.id, status: r.status, headers: r.headers, body: r.body }, [r.body.buffer]);
    } else if (m.type === 'projects') {
      const copied = await gofs.mountProjects(m.handle, m.copy);
      await lutstudioSetProjectsDir(m.handle ? '/projects' : '');
      postMessage({ type: 'res', id: m.id, error: '', copied });
    } else if (m.type === 'game') {
      await gofs.mountGame(m.source);
      postMessage({ type: 'res', id: m.id, error: await lutstudioOpenGame() });
    }
  } catch (e) {
    postMessage({ type: 'res', id: m.id, error: String(e?.message ?? e) });
  }
};
