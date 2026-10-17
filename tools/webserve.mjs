// Local server for the website (dev / tests): serves dist/web/ and, for automated tests that can't pick a folder,
// the Helldivers 2 install read-only at /devgame/ (Range requests; /devgame/list.json lists data/'s files). Open
// http://127.0.0.1:<port>/?devgame=1 to mount it instead of picking the folder. Not part of the site.
//   node tools/webserve.mjs [port] [install folder]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web');
const port = +(process.argv[2] ?? 8790);
const install = process.argv[3] ?? process.env.LUTSTUDIO_GAME ?? 'C:/Program Files (x86)/Steam/steamapps/common/Helldivers 2';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const head = { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (range) {
      const start = +range[1], end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  try { handle(req, res); }   // (a bad URL or a missing install answers an error, not ends the server)
  catch (e) { if (!res.headersSent) res.writeHead(e instanceof URIError ? 400 : 404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`LUT Studio (web) on http://127.0.0.1:${port}/`));

function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/devgame/list.json') {
    const data = path.join(install, 'data');
    const files = fs.readdirSync(data, { withFileTypes: true }).filter(d => d.isFile())
      .map(d => ['data/' + d.name, fs.statSync(path.join(data, d.name)).size]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ base: '/devgame/', files }));
  }
  if (u.pathname.startsWith('/devgame/')) {
    const rel = decodeURIComponent(u.pathname.slice('/devgame/'.length));
    if (rel.includes('..')) { res.writeHead(400); return res.end(); }
    return sendFile(req, res, path.join(install, rel));
  }
  const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
  if (rel.includes('..')) { res.writeHead(400); return res.end(); }
  sendFile(req, res, path.join(root, rel));
}
