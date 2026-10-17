// Headless check of the editor: loads the page in Chrome / Edge, prints console messages and exceptions, runs an
// optional script in the page, saves a screenshot. Dev tool, not shipped.
//   node tools/headless.mjs <url> <out.png> [waitSeconds] [jsToEval] [more steps…]
// More steps run in order after the first script: "wait N" waits N seconds, anything else is evaluated (awaited).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, wait = '20', evalJs = '', ...steps] = process.argv.slice(2);
const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'lshl-'));   // the browser profile, removed at the end
const browser = browsers.find(b => existsSync(b));
if (!browser) { console.error('no Chrome or Edge found'); process.exit(1); }
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--window-size=1600,950',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') console.log(`[console.${m.params.type}]`, m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded') console.log(`[log.${m.params.entry.level}]`, m.params.entry.text, m.params.entry.url ?? '');
};
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url });
await sleep(+wait * 1000);
if (evalJs) {
  const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
  console.log('[eval]', JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r));
  await sleep(1500);
}
for (const step of steps) {
  const w = /^wait (\d+(\.\d+)?)$/.exec(step);
  if (w) { await sleep(+w[1] * 1000); continue; }
  const r = await send('Runtime.evaluate', { expression: step, awaitPromise: true, returnByValue: true });
  console.log('[eval]', JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r));
}
const st = await send('Runtime.evaluate', { expression: "document.getElementById('status').textContent", returnByValue: true });
console.log('[status]', st.result?.value);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
ws.close(); proc.kill();
await sleep(1000);
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { }
process.exit(0);
