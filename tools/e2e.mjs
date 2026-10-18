// End-to-end tests: the website (dist/web, tools/web.py) in headless Chrome, against the game install (read-only,
// served by tools/webserve.mjs and mounted with ?devgame=1, as a picked folder would be).
//   node tools/e2e.mjs [outdir]      (tools/test.py e2e builds the site and runs this)
// A scratch browser profile holds the projects, settings and cache (the site's private storage). Then for an armor, a cape, a vehicle skin, a weapon paint scheme and a backpack: creates the project, opens the
// editor, checks the model loads with no page errors and the LUT list fills, applies a look to a zone (an edit),
// builds the mod with the Build button (icon rendering included), downloads the zip and imports it back as a mod.
// Also checks the start page lists every group, and the texture editors with real mouse / keyboard input: the cape
// design editor (paint, undo / redo, fill, save) on the cape, the decal editor (select, place an image as a layer,
// move / turn it, apply, undo / redo, save) on the vehicle. Screenshots go to outdir. Exit code 0 = all passed.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const [outDir = join(tmpdir(), 'lutstudio-e2e-shots')] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scratch = mkdtempSync(join(tmpdir(), 'lutstudio-e2e-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const site = `${base}/?devgame=1`;
const app = spawn(process.execPath, [fileURLToPath(new URL('./webserve.mjs', import.meta.url)), String(port)],
  { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', d => { appLog += d; }); app.stderr.on('data', d => { appLog += d; });

const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browserPath = browsers.find(existsSync);
if (!browserPath) { console.error('no Chrome or Edge found'); app.kill(); process.exit(2); }
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(browserPath, [`--remote-debugging-port=${cdpPort}`, '--headless=new', '--window-size=1600,950',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
// the API answers inside the page (the worker): requests go through the page's fetch; JSON (or text) comes back
const pageApi = (path, method = 'GET', body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, ${body === undefined ? '' : `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}`} });
  const t = await r.text(); if (!r.ok) throw new Error(${JSON.stringify(path)} + ': ' + r.status + ' ' + t);
  try { return JSON.parse(t); } catch { return t; } })()`);

// --- a tiny CDP client
let ws, id = 0;
const pending = new Map(), errors = [];
let chooser = null;   // the last file dialog the page opened (intercepted)
let dialogAccept = false;   // confirm() dialogs: accepted while set, else dismissed
async function connect() {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(t => t.type === 'page'); } catch { }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
    if (m.method === 'Page.fileChooserOpened') { chooser = m.params; return; }
    if (m.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: dialogAccept }); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url ?? '')) errors.push(m.params.entry.text);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => { });
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
// expressions run in the editor (the frame of the host page; app.html opened alone: the page itself)
async function evaluate(expr) {
  const inApp = `(async () => { const w = document.getElementById('app')?.contentWindow ?? window; return await w.eval(${JSON.stringify(expr)}); })()`;
  const r = await send('Runtime.evaluate', { expression: inApp, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
async function waitFor(expr, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await evaluate(expr); if (v) return v; } catch { }
    await sleep(500);
  }
  return null;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(s.data, 'base64'));
}
async function open(url) { errors.length = 0; await send('Page.navigate', { url }); await sleep(1500); }
// real input: page coordinates of a point of an element in the editor frame (fx, fy: 0..1 of its box)
async function where(sel, fx, fy) {
  const f = await send('Runtime.evaluate', { expression: `JSON.stringify(document.getElementById('app')?.getBoundingClientRect() ?? { left: 0, top: 0 })`, returnByValue: true });
  const fr = JSON.parse(f.result.value), er = JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
  return [fr.left + er.left + er.width * fx, fr.top + er.top + er.height * fy];
}
const mouse = (type, [x, y], buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
async function drag(a, b, steps = 12) {
  await mouse('mousePressed', a);
  for (let s = 1; s <= steps; s++) { await mouse('mouseMoved', [a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]); await sleep(15); }
  await mouse('mouseReleased', b, 0);
}
async function ctrlKey(key, vk) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: vk });
  await sleep(400);
}
// how many pixels of a canvas in the editor are close to a color
const countColor = (sel, [r, g, b]) => evaluate(`(() => { const c = document.querySelector(${JSON.stringify(sel)}), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ${r}) < 12 && Math.abs(d[i + 1] - ${g}) < 12 && Math.abs(d[i + 2] - ${b}) < 12) n++; return n; })()`);
// a small PNG to place on a decal sheet: a yellow disc with a black bar
function testPng(w = 96, h = 64) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    if (Math.abs(y - h / 2) < 4) raw.set([0, 0, 0, 255], o); else if (Math.hypot(x - w / 2, y - h / 2) < h / 2 - 2) raw.set([255, 210, 0, 255], o);
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// the mod page on the open project: two more variants, the choice named, a variant renamed and described, a
// transparent icon snapshot, one variant moved and one deleted (its confirm accepted)
async function modPageChecks(kind) {
  for (const n of ['Crimson', 'Midnight Blue']) await pageApi('/api/variant', 'POST', { Name: n, From: await evaluate(`window.lutstudio.S.variant`) });
  await evaluate(`(async () => { window.lutstudio.S.state = await (await fetch('/api/state')).json(); return 1; })()`);
  await evaluate(`(document.getElementById('modPageBtn').click(), 1)`);
  const rows = await waitFor(`document.querySelectorAll('.mpVariant').length`, 15000);
  const setv = (sel, v) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change')); return 1; })()`);
  await setv('#mpOpt', 'Armor color'); await sleep(400);
  await setv('.mpVariant:nth-child(2) .mpVName', 'Deep Crimson'); await sleep(400);
  await setv('.mpVariant:nth-child(2) .mpVDesc', 'A deep red'); await sleep(400);
  await evaluate(`(() => { const b = document.getElementById('mpBg'); b.value = 'none'; b.dispatchEvent(new Event('change')); document.querySelector('.mpCard[data-target=icon] .mpSnap').click(); return 1; })()`);
  await sleep(1500);
  const alpha = await evaluate(`(async () => { const r = await fetch('/api/image?target=icon'); if (!r.ok) return 'none'; const b = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.drawImage(b, 0, 0); return String(g.getImageData(2, 2, 1, 1).data[3]); })()`);
  await evaluate(`(document.querySelectorAll('.mpVariant')[2].querySelector('.mpUp').click(), 1)`);
  await sleep(1200);
  dialogAccept = true;
  await evaluate(`(document.querySelectorAll('.mpVariant')[0].querySelector('.mpDel').click(), 1)`);
  await sleep(2500);
  dialogAccept = false;
  const st = JSON.parse(await evaluate(`fetch('/api/state').then(r => r.json()).then(s => JSON.stringify({ option: s.project.option, variants: s.variants.map(v => v.name + '|' + (v.description ?? '')) }))`));
  check(`${kind}: mod page: the choice named, a variant renamed and described, transparent icon, reordered, one deleted`,
    rows === 3 && st.option === 'Armor color' && alpha === '0' && st.variants.join(',') === 'Midnight Blue|,Deep Crimson|A deep red' && errors.length === 0,
    `${rows} rows; ${JSON.stringify(st)}; icon corner alpha ${alpha}; ${errors.slice(0, 2).join(' | ')}`);
  // several options: split by item (the armor, the cape + Item added), kept for the build and import that follow
  await evaluate(`(() => { const r = document.querySelector('input[name=mpLayout][value=options]'); r.checked = true; r.dispatchEvent(new Event('change')); return 1; })()`);
  const opts = await waitFor(`(() => { const o = window.lutstudio.S.state.project.options ?? []; return o.length > 1 && JSON.stringify(o.map(x => [x.name, x.variants.length, x.parts.length])); })()`, 15000);
  check(`${kind}: mod page: several options (split by item), each offering every variant`, !!opts && JSON.parse(opts).every(o => o[1] === 2 && o[2] > 0) && errors.length === 0,
    `${opts}; ${errors.slice(0, 2).join(' | ')}`);
  await shot(`${kind}-modpage`);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
}

// the ID mask editor on the open armor: an armor part, a stroke on the flat view, one on the model (the view shows
// it), saved (the variant's mask keeps the game's layers)
async function maskEditor(kind) {
  await evaluate(`(document.getElementById('masksBtn').click(), 1)`);
  const opened = await waitFor(`/layer\\(s\\)/.test(document.getElementById('mkInfo')?.textContent ?? '') && document.getElementById('mkInfo').textContent`, 30000);
  await evaluate(`(() => { const s = document.getElementById('mkPart'); const o = [...s.options].find(o => /^Armor: .*torso/.test(o.text)) ?? [...s.options].find(o => /^Armor/.test(o.text)) ?? s.options[0];
    s.value = o.value; s.dispatchEvent(new Event('change')); return 1; })()`);
  await waitFor(`/layer\\(s\\)/.test(document.getElementById('mkInfo').textContent)`, 30000);
  const zones = await evaluate(`document.querySelectorAll('#mkZones .dzTool').length`);
  await evaluate(`(() => { const z = document.querySelectorAll('#mkZones .dzTool'); z[z.length - 1].click(); return 1; })()`);
  // on the model first: a vertical drag through the middle of the view; it hits the part when the mask turns into a
  // live preview (and Save lights up)
  let onModel = false;
  for (const x of [0.5, 0.55, 0.45, 0.6, 0.4]) {
    await drag(await where('#canvas', x, 0.3), await where('#canvas', x, 0.6), 20);
    await sleep(800);
    onModel = await evaluate(`!document.getElementById('mkSave').disabled`);
    if (onModel) break;
  }
  await drag(await where('#mkView', 0.1, 0.5), await where('#mkView', 0.9, 0.5));
  await sleep(500);
  const before = '', after = onModel ? 'painted' : '';
  await shot(`${kind}-masks`);
  await evaluate(`(document.getElementById('mkSave').click(), 1)`);
  const saved = await waitFor(`/^Saved/.test(document.getElementById('mkInfo').textContent)`, 30000);
  const tex = await evaluate(`(async () => { const s = document.getElementById('mkPart'), h = window.lutstudio.R.pieces.find(p => p.idMaskHash)?.idMaskHash;
    const m = [...new Set(window.lutstudio.R.pieces.map(p => p.idMaskHash).filter(Boolean))][+s.value];
    const r = await fetch('/api/tex?hash=' + m + '&variant=' + encodeURIComponent(window.lutstudio.S.variant)); const dv = new DataView(await r.arrayBuffer());
    return r.headers.get('X-Edited') + ' ' + dv.getUint32(12, true); })()`);
  check(`${kind}: ID masks: ${zones} zones from the LUT, painted on the model and the flat view, saved`,
    !!opened && zones >= 2 && before !== after && !!saved && /^1 [12]$/.test(tex) && errors.length === 0, `${opened}; ${tex}; ${errors.slice(0, 2).join(' | ')}`);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
}

// the Roles panel on the open armor: zones listed with suggestions, the role view on the model, a click on the model
// gives a zone the selected role, Confirm saves the roles of the LUTs on screen, Next shows another item, closing
// restores the model's own LUTs
async function rolesPanel(kind) {
  await evaluate(`(document.getElementById('rolesBtn').click(), 1)`);
  const zones = await waitFor(`document.querySelectorAll('#rlLuts .rlZone').length`, 60000);
  const suggested = await evaluate(`[...document.querySelectorAll('#rlLuts .rlZone select')].map(s => s.value).join(',')`);
  const view = await evaluate(`window.lutstudio.R.pieces.filter(p => p.lutKeys.edited?.startsWith('r:')).length`);
  await evaluate(`(document.querySelector('#rlBrush .dzTool[data-r="keep"]').click(), 1)`);
  const keeps = () => evaluate(`[...document.querySelectorAll('#rlLuts .rlZone select')].filter(s => s.value === 'keep').length`);
  const k0 = await keeps();
  let picked = false;
  for (const [x, y] of [[0.5, 0.45], [0.5, 0.35], [0.52, 0.55], [0.48, 0.3]]) {
    const at = await where('#canvas', x, y);
    await mouse('mousePressed', at); await mouse('mouseReleased', at, 0);
    await sleep(500);
    if (await keeps() > k0) { picked = true; break; }
  }
  await shot(`${kind}-roles`);
  await evaluate(`(document.getElementById('rlConfirm').click(), 1)`);
  const confirmed = await waitFor(`/^Confirmed/.test(document.getElementById('rlInfo').textContent) && document.getElementById('rlInfo').textContent`, 30000);
  const mine = await evaluate(`fetch('/api/roles').then(r => r.json()).then(d => Object.keys(d.mine).length)`);
  const before = await evaluate(`window.lutstudio.R.pieces.map(p => p.info.lut).sort().join()`);
  const look = await evaluate(`JSON.stringify(window.lutstudio.S.look)`);
  await evaluate(`(document.getElementById('rlNext').click(), 1)`);
  const next = await waitFor(`window.lutstudio.R.pieces.length > 0 && window.lutstudio.R.pieces.map(p => p.info.lut).sort().join() !== ${JSON.stringify(before)} && document.querySelectorAll('#rlLuts .rlZone').length`, 120000);
  const progress = await evaluate(`document.getElementById('rlProgress').textContent`);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
  const restored = await evaluate(`window.lutstudio.R.pieces.every(p => !p.lutKeys.edited?.startsWith('r:'))`);
  // back to the project's armor for the checks after this one
  await evaluate(`(() => { const S = window.lutstudio.S; S.look = ${look}; const a = document.getElementById('wearArmor'); a.value = S.look.armor; a.dispatchEvent(new Event('change')); return 1; })()`);
  await waitFor(`window.lutstudio.R.pieces.map(p => p.info.lut).sort().join() === ${JSON.stringify(before)}`, 120000);
  check(`${kind}: roles: ${zones} zones suggested, a zone set on the model, confirmed, the next item shown`,
    zones > 0 && view > 0 && picked && !!confirmed && mine > 0 && !!next && /items confirmed/.test(progress) && restored && errors.length === 0,
    `suggested ${suggested}; view ${view}; picked ${picked}; ${confirmed}; mine ${mine}; next ${next}; ${progress}; restored ${restored}; ${errors.slice(0, 2).join(' | ')}`);
}

// the Theme panel on the open armor: a look per role from the zones on screen, applied to the mod's own items (this
// variant), the model reloads with the themed LUTs, and the review steps to an item
async function themePanel(kind) {
  await evaluate(`(document.getElementById('themeBtn').click(), 1)`);
  const picks = await waitFor(`document.querySelectorAll('#thPalette select[data-r]').length && [...document.querySelectorAll('#thPalette select[data-r]')].filter(s => s.value !== '').length`, 60000);
  const groups = await evaluate(`[...document.querySelectorAll('.thGroup:checked')].map(c => c.value).join(',')`);
  const before = await evaluate(`(() => { const S = window.lutstudio.S; let n = 0; for (const l of S.luts.values()) if (l.edited) n += l.edited.reduce((a, v) => a + v, 0); return n; })()`);
  const look = await evaluate(`JSON.stringify(window.lutstudio.S.look)`), shown = await evaluate(`window.lutstudio.R.pieces.map(p => p.info.lut).sort().join()`);
  await evaluate(`(document.getElementById('thOnly').click(), document.getElementById('thApply').click(), 1)`);
  const done = await waitFor(`/^Themed [0-9]+ zone/.test(document.getElementById('thInfo').textContent) && document.getElementById('thInfo').textContent`, 120000);
  const failed = done ? '' : await evaluate(`document.getElementById('thInfo').textContent`);
  const after = await evaluate(`(() => { const S = window.lutstudio.S; let n = 0; for (const l of S.luts.values()) if (l.edited) n += l.edited.reduce((a, v) => a + v, 0); return n; })()`);
  await shot(`${kind}-theme`);
  await evaluate(`(document.getElementById('thNext').click(), 1)`);
  const at = await waitFor(`/^1 [/]/.test(document.getElementById('thAt').textContent) && document.getElementById('thAt').textContent`, 60000);
  await sleep(1500);
  // the Showcase (a preset on the showcase scene, live in the viewport): its title and line, a 4K export, then exited:
  // the item back on screen
  const reviewed = await evaluate(`window.lutstudio.R.pieces.map(p => p.info.lut).sort().join()`);
  await evaluate(`(() => { const s = document.getElementById('thPreset'); s.value = 'Volcanic'; s.dispatchEvent(new Event('change')); document.getElementById('thShow').click(); return 1; })()`);
  const live = await waitFor(`!!document.getElementById('scSave') && !!window.lutstudio.showcase && !!window.lutstudio.R.post`, 300000);
  await sleep(1500);
  await shot(`${kind}-showcase`);
  const sc = live ? await evaluate(`(() => { const t = document.getElementById('scTitle'), l = document.getElementById('scLine');
    t.value = 'E2E'; t.dispatchEvent(new Event('input')); l.value = ''; l.dispatchEvent(new Event('input'));
    const c = window.lutstudio.showcase.exportCanvas(3840, 2160), p = c.getContext('2d').getImageData(c.width / 2, c.height * 0.4, 1, 1).data;
    return c.width + 'x' + c.height + ' center ' + [...p].slice(0, 3).join(','); })()`) : '';
  // the decals themed too (the scene's decal sheets shown recolored), then back
  const decals = live ? await evaluate(`(async () => {
    const box = document.getElementById('scDecals'); if (!box || box.disabled) return 'no box';
    box.checked = true; box.dispatchEvent(new Event('change'));
    for (let i = 0; i < 300; i++) { const n = window.lutstudio.R.pieces.filter(p => p.decalSheet?.preview).length; if (n) { box.checked = false; box.dispatchEvent(new Event('change')); return 'recolored on ' + n + ' piece(s)'; } await new Promise(r => setTimeout(r, 100)); }
    return 'none'; })()`) : '';
  await evaluate(`(document.getElementById('scExit')?.click(), 1)`);
  const back = await waitFor(`!window.lutstudio.R.post && window.lutstudio.R.pieces.map(p => p.info.lut).sort().join() === ${JSON.stringify(reviewed)}`, 120000);
  check(`${kind}: theme: showcase live in the viewport, its title and line, a 4K export, the item back on screen after`,
    !!live && /^3840x2160 center /.test(sc || '') && !/center 0,0,0$/.test(sc) && !!back && errors.length === 0,
    `live ${!!live}; ${sc || 'no image'}; back ${!!back}; ${errors.length} page error(s): ${JSON.stringify(errors.slice(0, 3))}`);
  check(`${kind}: theme: the showcase's decals in the theme's colors`, /^recolored on [1-9]/.test(decals), decals);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
  await evaluate(`(() => { const S = window.lutstudio.S; S.look = ${look}; const a = document.getElementById('wearArmor'); a.value = S.look.armor; a.dispatchEvent(new Event('change')); return 1; })()`);
  await waitFor(`window.lutstudio.R.pieces.map(p => p.info.lut).sort().join() === ${JSON.stringify(shown)}`, 120000);
  check(`${kind}: theme: ${picks} role looks from the item, applied to the mod's items, reviewed`,
    picks >= 2 && /Armor/.test(groups) && !!done && /zone/.test(done) && after !== before && !!at && errors.length === 0,
    `picks ${picks}; groups ${groups}; ${done || failed}; sum ${before} -> ${after}; ${at}; ${errors.length} page error(s): ${JSON.stringify(errors.slice(0, 3))}`);
}

// the pattern mask on the open armor (the A-35 Recon: its hips' blue thigh band): pattern mode, the hips, the band
// erased on the model, saved
async function patternEditor(kind) {
  await evaluate(`(document.getElementById('masksBtn').click(), 1)`);
  await waitFor(`/layer\\(s\\)/.test(document.getElementById('mkInfo')?.textContent ?? '')`, 30000);
  await evaluate(`(() => { const k = document.getElementById('mkKind'); k.value = 'pattern'; k.dispatchEvent(new Event('change')); return 1; })()`);
  await waitFor(`/pattern on layer/.test(document.getElementById('mkInfo').textContent)`, 30000);
  await evaluate(`(() => { const s = document.getElementById('mkPart'); const o = [...s.options].find(o => /hips/.test(o.text)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } return 1; })()`);
  await waitFor(`/used by: .*hips/.test(document.getElementById('mkInfo').textContent)`, 30000);
  const tools = await evaluate(`[...document.querySelectorAll('#mkZones .dzTool')].map(b => b.textContent.trim()).join(',')`);
  const warned = await evaluate(`!document.getElementById('mkWarn').hidden`);
  // (the strokes land on the hips where the T-pose has them: the editor starts in an idle pose)
  await evaluate(`(() => { const p = document.getElementById('pose'); p.value = ''; p.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(500);
  await evaluate(`(document.querySelector('#mkZones .dzTool[data-z="0"]').click(), document.getElementById('mkSize').value = 40, 1)`);
  let painted = false;
  for (const y of [0.5, 0.53, 0.56, 0.47]) {
    await drag(await where('#canvas', 0.55, y), await where('#canvas', 0.63, y), 16);
    await sleep(600);
    painted = await evaluate(`!document.getElementById('mkSave').disabled`);
    if (painted) break;
  }
  await shot(`${kind}-pattern`);
  await evaluate(`(document.getElementById('mkSave').click(), 1)`);
  const saved = await waitFor(`/^Saved/.test(document.getElementById('mkInfo').textContent)`, 30000);
  check(`${kind}: pattern mask: the hips' pattern (on), painted on the model, saved`, tools === 'no pattern,pattern' && !warned && painted && !!saved && errors.length === 0,
    `${tools}; warned ${warned}; painted ${painted}; ${errors.slice(0, 2).join(' | ')}`);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
}

// the cape design editor on the open cape: a stroke of zone 1, undo / redo, a fill with zone 2, saved
async function designEditor(kind) {
  await evaluate(`(document.getElementById('design').click(), 1)`);
  const opened = await waitFor(`/512 × 512|256 × 256|128 × 128/.test(document.getElementById('dzInfo')?.textContent ?? '') && document.getElementById('dzInfo').textContent`, 30000);
  check(`${kind}: the cape design editor opens beside the model`, !!opened && await evaluate(`!document.getElementById('sidePanel').hidden`), opened || 'not opened');
  const red = () => countColor('#dzView', [224, 64, 64]), green = () => countColor('#dzView', [64, 192, 64]);
  const r0 = await red();
  await drag(await where('#dzView', 0.2, 0.3), await where('#dzView', 0.8, 0.35));
  await sleep(500);
  const r1 = await red();
  await ctrlKey('z', 90);
  const r2 = await red();
  await ctrlKey('y', 89);
  const r3 = await red();
  check(`${kind}: design: a brush stroke paints zone 1, Ctrl+Z / Ctrl+Y undo and redo it`, r1 > r0 + 300 && Math.abs(r2 - r0) < 50 && Math.abs(r3 - r1) < 50, `${r0} -> ${r1}, undo ${r2}, redo ${r3}`);
  await evaluate(`(document.querySelector('.dzTool[data-tool=z2]').click(), document.getElementById('dzFill').click(), 1)`);
  const g0 = await green(), pt = await where('#dzView', 0.5, 0.33);
  await mouse('mousePressed', pt); await mouse('mouseReleased', pt, 0);
  await sleep(800);
  const g1 = await green();
  check(`${kind}: design: fill turns the stroke into zone 2`, g1 > g0 + 300, `${g0} -> ${g1}`);
  await sleep(1000);
  await shot(`${kind}-design`);
  await evaluate(`(document.getElementById('dzSave').click(), 1)`);
  const saved = await waitFor(`/^Saved/.test(document.getElementById('dzInfo').textContent)`, 30000);
  const h = await evaluate(`window.lutstudio.R.pieces.find(p => p.scalarHash)?.scalarHash`);
  const edited = await evaluate(`fetch('/api/tex?hash=${h}&variant=' + encodeURIComponent(window.lutstudio.S.variant)).then(r => r.headers.get('X-Edited'))`);
  check(`${kind}: design saved and shown`, !!saved && edited === '1' && errors.length === 0, `${edited}; ${errors.slice(0, 2).join(' | ')}`);
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
}

// the decal editor on the open model: an area, an image placed as a layer, moved and turned, applied, undo / redo,
// saved
async function decalEditor(kind) {
  await evaluate(`(document.getElementById('decals').click(), 1)`);
  const opened = await waitFor(`/2048 × 2048/.test(document.getElementById('dsInfo')?.textContent ?? '') && document.getElementById('dsInfo').textContent`, 30000);
  check(`${kind}: the decal editor opens`, !!opened, opened || 'not opened');
  await evaluate(`(document.getElementById('dsMark').click(), 1)`);
  await drag(await where('#dsView', 0.30, 0.55), await where('#dsView', 0.45, 0.70));
  const img = join(scratch, 'emblem.png');
  writeFileSync(img, testPng());
  chooser = null;
  await evaluate(`(document.getElementById('dsImage').click(), 1)`);
  for (let i = 0; i < 20 && !chooser; i++) await sleep(200);
  if (chooser) await send('DOM.setFileInputFiles', { files: [img], backendNodeId: chooser.backendNodeId });
  const layer = await waitFor(`!document.getElementById('dsLayer').hidden`, 10000);
  const yellow = () => countColor('#dsView', [255, 210, 0]);
  await drag(await where('#dsView', 0.375, 0.625), await where('#dsView', 0.42, 0.66));
  await evaluate(`(() => { const r = document.getElementById('dsRot'); r.value = 30; r.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(800);
  const y0 = await yellow();
  check(`${kind}: decals: an image placed as a layer, moved and turned`, !!chooser && !!layer && y0 > 200, `chooser ${!!chooser}, layer ${!!layer}, ${y0} px`);
  await shot(`${kind}-decal-layer`);
  await evaluate(`(document.getElementById('dsApply').click(), 1)`);
  await sleep(400);
  const ya = await yellow();
  await ctrlKey('z', 90);
  const yu = await yellow();
  await ctrlKey('y', 89);
  const yr = await yellow();
  check(`${kind}: decals: applied, Ctrl+Z / Ctrl+Y take it off and put it back`, ya > 200 && yu < ya / 10 && Math.abs(yr - ya) < 20, `${ya}, undo ${yu}, redo ${yr}`);
  await evaluate(`(document.getElementById('dsSave').click(), 1)`);
  const saved = await waitFor(`/^Saved/.test(document.getElementById('dsInfo').textContent)`, 60000);
  check(`${kind}: decal sheet saved`, !!saved && errors.length === 0, errors.slice(0, 2).join(' | '));
  await evaluate(`(document.getElementById(document.getElementById('sidePanel')?.hidden === false ? 'sideClose' : 'modalClose').click(), 1)`);   // (a side panel's own Close, else the dialog's)
  await sleep(500);
}
// a new project opened in the editor: created through the page, remembered for the tab, the page reloaded
// the Decal number box (the per-instance decal id: the SEAF soldier's badge moves along its sheet) and, on vehicles,
// the Damage slider: both redraw without page errors; the vehicle's number box is off (its materials move nothing)
async function numberAndDamage(kind, vehicle) {
  errors.length = 0;
  const r = await evaluate(`(async () => { const R = window.lutstudio.R, n = document.getElementById('decalNum'), d = document.querySelector('#damageRow input');
    const draw = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { row: !document.getElementById('decalNumRow').hidden, max: +n.max, off: n.disabled, damage: !document.getElementById('damageRow').hidden };
    for (const v of [1, 3]) { n.value = v; n.dispatchEvent(new Event('input')); await draw(); }
    out.id = R.decalId;
    if (out.damage) for (const v of [0.4, 1]) { d.value = v; d.dispatchEvent(new Event('input')); await draw(); }
    out.dmg = R.world.damage;
    return JSON.stringify(out); })()`);
  const v = JSON.parse(r);
  await shot(`${kind}-number-damage`);
  const ok = vehicle ? v.row && v.off && v.damage && v.dmg === 1 : v.row && !v.off && v.max >= 3 && v.id === 3 && !v.damage;
  check(`${kind}: decal number${vehicle ? ' (off) and damage' : ' 0..' + v.max} redraw without page errors`, ok && errors.length === 0, `${r}; ${errors.slice(0, 2).join(' | ')}`);
  await evaluate(`(() => { const n = document.getElementById('decalNum'); n.value = 0; n.dispatchEvent(new Event('input'));
    const d = document.querySelector('#damageRow input'); d.value = 0; d.dispatchEvent(new Event('input')); return 1; })()`);
}

async function newProject(name, what) {
  const r = await pageApi('/api/new', 'POST', { Name: name, What: what });
  await evaluate(`(sessionStorage.setItem('lutstudio.project', ${JSON.stringify(r.project)}), true)`);
  // the editor's frame reloads (as the app does); the host keeps the worker, the game folder and the project
  errors.length = 0;
  await evaluate(`(setTimeout(() => location.reload(), 0), true)`);
  await sleep(1500);
}

async function main() {
  for (let i = 0; i < 120; i++) { try { await fetch(base + '/'); break; } catch { await sleep(500); } }
  await connect();

  // start page: every category, each with its items; the armor's matching-helmet box
  await open(site);
  const groups = await waitFor(`(() => { const s = document.getElementById('catPick'); return s && s.options.length > 5 && [...s.options].map(o => o.value).join('|'); })()`, 60000);
  for (const g of ['Armor', 'Helmets', 'Capes', 'Vehicles', 'Weapons', 'Backpacks', 'Equipment', 'Stratagems', 'SEAF',
    'Eagle & craft', 'Ship crew', 'Automatons', 'Illuminate', 'Objectives', 'Super Destroyer', 'World props', 'Armor pieces'])
    check(`start page lists ${g}`, !!groups && groups.split('|').includes(g), groups || 'no list');
  const startPick = await evaluate(`(async () => { const c = document.getElementById('catPick'), k = document.getElementById('kitPick');
    c.value = 'SEAF'; c.dispatchEvent(new Event('change')); const seaf = [...k.options].map(o => o.text);
    c.value = 'Armor'; c.dispatchEvent(new Event('change'));
    const f = document.getElementById('kitFilter'); f.value = 'Scorpion'; f.dispatchEvent(new Event('input'));
    k.selectedIndex = 0; k.dispatchEvent(new Event('change'));
    const helmetBox = document.getElementById('withHelmetRow').offsetParent !== null, armor = [...k.options].map(o => o.text);
    c.value = 'Vehicles'; c.dispatchEvent(new Event('change')); k.selectedIndex = 0; k.dispatchEvent(new Event('change'));
    const vehicleBox = document.getElementById('withHelmetRow').offsetParent !== null;
    c.value = 'Helmets'; c.dispatchEvent(new Event('change'));
    const unnamedHelmet = [...k.options].some(o => o.text.startsWith('SC-34 Infiltrator model · '));
    return JSON.stringify({ seaf, armor, helmetBox, vehicleBox, unnamedHelmet }); })()`);
  const sp = JSON.parse(startPick);
  check('start page: SEAF items, armor filter, matching-helmet box (armor only), unnamed helmets with their model', sp.seaf.includes('SEAF Soldier') && sp.armor.some(t => /Scorpion/.test(t)) && sp.helmetBox && !sp.vehicleBox && sp.unnamedHelmet, startPick);
  check('start page without errors', errors.length === 0, errors.join(' | '));
  await shot('start');

  const kits = await pageApi('/api/kits');
  const cape = kits.find(k => k.group === 'Capes' && k.name === 'Wedgeful Tricorn') ?? kits.find(k => k.group === 'Capes');
  const cases = [
    ['armor', 'FS-37 Ravager'],
    ['cape', cape?.value],
    ['pattern', kits.find(k => k.group === 'Armor' && k.name === 'A-35 Recon')?.value],
    ['vehicle', 'Patriot Exosuit: Mustard Exosuit Pattern'],
    ['weapon', 'AR-23 Liberator: Desert paint scheme'],
    ['backpack', 'AX/AR-23 Guard Dog'],
    ['seaf', 'SEAF Soldier'],
    ['throwable', 'Throwable: Frag Grenade'],
    ['stratagem', 'Stratagem: Hellbomb / Hellbomb Prop / Hellbomb Defunct'],
    ['automaton', 'Automaton: Berserker'],
    ['flag', 'CQC-1 One True Flag'],
  ];
  // E2E_ONLY=armor,cape: only those cases (a quicker run while working on one)
  const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean);
  for (const [kind, what] of cases.filter(([k]) => !only.length || only.includes(k))) {
    const name = `e2e ${kind}`;
    try {
      await newProject(name, what);
      const status = await waitFor(`(() => { const t = document.getElementById('status')?.textContent ?? ''; return /: \\d+ parts\\./.test(t) && t; })()`, 180000);
      const parts = +(status?.match(/: (\d+) parts\./)?.[1] ?? 0);
      check(`${kind}: model loads (${what})`, parts > 0, status || 'timed out');
      const luts = await evaluate(`document.querySelectorAll('#lutList .item').length`);
      check(`${kind}: LUT list fills`, luts > 0, `${luts} items`);
      if (kind === 'vehicle') {   // the decal sheet (armor base 0xf5eb): the Patriot's markings, and the decal editor
        const decals = await evaluate(`window.lutstudio.R.pieces.filter(p => p.decalSheet).length`);
        check(`${kind}: decals load (decal sheet on ${decals} parts)`, decals > 0, `${decals} parts with a decal sheet`);
        await decalEditor(kind);
        await numberAndDamage(kind, true);
      }
      if (kind === 'seaf') await numberAndDamage(kind, false);
      if (kind === 'cape') await designEditor(kind);
      if (kind === 'pattern') await patternEditor(kind);
      if (kind === 'flag') {   // the flag's cloth: a cape-shader piece with its cape LUT in the project
        const cloth = await evaluate(`JSON.stringify({ lut: window.lutstudio.S.state.variants[0].luts.some(l => l.lut === '0xb9b8dfa7d968ce98'),
          piece: window.lutstudio.R.pieces.some(p => p.kind === 'cape' && p.info.cape === '0xb9b8dfa7d968ce98') })`);
        check(`${kind}: the flag's cloth (cape LUT) is in the project and on screen`, cloth === '{"lut":true,"piece":true}', cloth);
      }
      check(`${kind}: no page errors while loading`, errors.length === 0, errors.slice(0, 3).join(' | '));
      if (kind === 'armor') {    // a small window: the editor fits it (no page scrolling; the top bar wraps)
        await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 650, deviceScaleFactor: 1, mobile: false });
        await sleep(800);
        const fit = await evaluate(`(() => { const d = document.documentElement; return { sh: d.scrollHeight, h: innerHeight, sw: d.scrollWidth, w: innerWidth, top: document.getElementById('top').offsetHeight, canvas: document.getElementById('canvas').clientHeight }; })()`);
        check(`${kind}: fits a 1000x650 window`, fit.sh <= fit.h && fit.sw <= fit.w && fit.canvas > 150, JSON.stringify(fit));
        await shot(`${kind}-small-window`);
        await send('Emulation.clearDeviceMetricsOverride');
        await sleep(500);
        // the lights: the side lights on by default (the Armory menu's light), switched on and turned both ways; the sun
        // off and on again
        const lights = await evaluate(`(async () => { const R = window.lutstudio.R, ev = (id, v, t) => { const e = document.getElementById(id);
            if (t === 'change') e.checked = v; else e.value = v; e.dispatchEvent(new Event(t)); };
          const r = R.rim.map(l => l.on).join(',');
          for (const i of [0, 1]) ev('rim' + i, true, 'change');
          ev('rim0Az', 90, 'input'); ev('rim0El', 40, 'input');
          ev('sunOn', false, 'change'); await new Promise(r => setTimeout(r, 400)); const sunOff = R.sunOn;
          ev('sunEl', 60, 'input'); ev('sunOn', true, 'change'); await new Promise(r => setTimeout(r, 400));
          const out = r + ' / ' + R.rim.map(l => l.on + '@' + l.az + '/' + l.el).join(',') + ' / sun ' + sunOff + ',' + R.sunOn + '@' + R.sunElevUser;
          for (const i of [0, 1]) ev('rim' + i, false, 'change');
          ev('rim0Az', 250, 'input'); ev('rim0El', 17, 'input'); return out; })()`);
        check(`${kind}: the lights switch and turn`, lights === 'true,true / true@90/40,true@110/17 / sun false,true@60' && errors.length === 0, `${lights}; ${errors.slice(0, 2).join(' | ')}`);
        // the helmet picker: none, another set's helmet, back to the matching one
        const loaded = `/: \\d+ parts\\./.test(document.getElementById('status').textContent)`;
        const helmetParts = async v => {
          await evaluate(`(() => { const s = document.getElementById('wearHelmet'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return 1; })()`);
          await sleep(600);
          await waitFor(loaded, 120000);
          return evaluate(`window.lutstudio.R.pieces.length`);
        };
        const withOwn = await evaluate(`window.lutstudio.R.pieces.length`);
        const without = await helmetParts('none');
        const other = await evaluate(`[...document.getElementById('wearHelmet').options].map(o => o.value).find(v => v.startsWith('kit:'))`);
        const withOther = await helmetParts(other);
        const back = await helmetParts('match');
        check(`${kind}: the helmet picker (none, ${other}, matching)`, without < withOwn && withOther > without && back === withOwn && errors.length === 0,
          `${withOwn} parts with its own helmet, ${without} with none, ${withOther} with ${other}, ${back} back; ${errors.slice(0, 2).join(' | ')}`);
        // the right panel stays put when another zone is picked: its scroll and the sections opened / closed
        const panel = await evaluate(`(async () => { const p = document.getElementById('right'); const d = [...p.querySelectorAll('details.group')];
          d[0].open = !d[0].open; await new Promise(r => setTimeout(r, 100)); p.scrollTop = 200; const before = [p.scrollTop, d[0].open];
          const zones = document.querySelectorAll('#zoneList .item'); zones[Math.min(2, zones.length - 1)].click(); await new Promise(r => setTimeout(r, 300));
          const after = [p.scrollTop, p.querySelectorAll('details.group')[0].open];
          p.querySelectorAll('details.group')[0].open = !after[1]; return JSON.stringify({ before, after }); })()`);
        const pv = JSON.parse(panel);
        check(`${kind}: the right panel keeps its place when another zone is picked`, pv.before[0] === pv.after[0] && pv.before[1] === pv.after[1], panel);
        // + Item: the start page's picker (category, filter, matching-helmet box); a cape is added and shown
        await evaluate(`(document.getElementById('addArmor').click(), 1)`);
        await waitFor(`document.getElementById('aaCat')?.options.length > 5`, 60000);
        const dlg = await evaluate(`(async () => { const c = document.getElementById('aaCat'), f = document.getElementById('aaFilter'), k = document.getElementById('aaPick');
          const set = (el, v, ev) => { el.value = v; el.dispatchEvent(new Event(ev)); };
          set(c, 'Armor', 'change'); set(f, 'scorpion', 'input'); k.selectedIndex = 0; k.dispatchEvent(new Event('change'));
          const shown = id => document.getElementById(id).offsetParent !== null, helmetBox = shown('aaHelmetRow');
          set(c, 'Capes', 'change'); k.selectedIndex = 0; k.dispatchEvent(new Event('change'));
          const cape = k.selectedOptions[0]?.dataset.label, kits = window.lutstudio.S.state.kits.length;
          return JSON.stringify({ helmetBox, cape, capeBox: shown('aaHelmetRow'), kits }); })()`);
        const dv = JSON.parse(dlg);
        await evaluate(`(document.getElementById('aaAdd').click(), 1)`);
        const added = await waitFor(`/^Added /.test(document.getElementById('status').textContent) && window.lutstudio.S.state.kits.length`, 120000);
        check(`${kind}: + Item picks by category and adds ${dv.cape}`, dv.helmetBox && !dv.capeBox && added > dv.kits && errors.length === 0,
          `${dlg}; ${added} kits after; ${errors.slice(0, 2).join(' | ')}`);
        await waitFor(loaded, 120000);
        await modPageChecks(kind);
        await maskEditor(kind);
        await rolesPanel(kind);
        await themePanel(kind);
      }
      if (kind === 'weapon') {   // an attachment change: another optic, reloaded with no errors
        const before = parts;
        const picked = await evaluate(`(() => { const s = [...document.querySelectorAll('#attachRow select')].find(s => s.title.startsWith('Optics'));
          if (!s) return ''; const o = [...s.options].find(o => o.value && o.value !== s.value); s.value = o.value;
          s.dispatchEvent(new Event('change')); return o.text; })()`);
        const after = await waitFor(`(() => { const t = document.getElementById('status').textContent; return /: \\d+ parts\\./.test(t) && t; })()`, 120000);
        check(`${kind}: picking an attachment (${picked})`, !!picked && !!after && errors.length === 0, `${before} parts before; ${after}; ${errors.slice(0, 2).join(' | ')}`);
        await shot(`${kind}-attachment`);
        // the menus: the game's list for the Liberator (6 optics, unlock levels, the wiki credited); All offers more
        const optics = () => evaluate(`[...[...document.querySelectorAll('#attachRow select')].find(s => s.title.startsWith('Optics')).options].map(o => o.text)`);
        const listed = await optics();
        const credit = await evaluate(`!!document.querySelector('#attachRow a[href*="helldivers.wiki.gg"]')`);
        check(`${kind}: the optics menu is the game's list`, listed.length === 6 && listed.includes('Optics: 4x Combat Scope · lvl 21') && credit, listed.join(', '));
        await evaluate(`(() => { const c = document.querySelector('#attachRow input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
        const allOptics = await waitFor(`(() => { const s = [...document.querySelectorAll('#attachRow select')].find(s => s.title.startsWith('Optics')); return s && s.options.length > 6 && s.options.length; })()`, 30000);
        check(`${kind}: "All" offers every optic`, !!allOptics && errors.length === 0, `${allOptics} options; ${errors.slice(0, 2).join(' | ')}`);
        await evaluate(`(() => { const c = document.querySelector('#attachRow input[type=checkbox]'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()`);
        // back to the game's list, and the model reloaded with it (its status would replace a later message)
        await waitFor(`(() => { const s = [...document.querySelectorAll('#attachRow select')].find(s => s.title.startsWith('Optics')); return s && s.options.length === 6; })()`, 30000);
        await sleep(1500);
        await waitFor(`(() => { const t = document.getElementById('status').textContent; return /: \\d+ parts\\./.test(t) && t; })()`, 120000);
      }
      await shot(`${kind}-loaded`);

      // an edit: the first built-in look on the selected zone, then saved
      // (built-in looks exist for material LUTs: select one first; a cape project may open on its trim LUT)
      const applied = await evaluate(`(async () => {
        const looks = () => document.querySelectorAll('#zLooks .lkItem[data-own="0"]').length;
        for (const it of document.querySelectorAll('#lutList .item[data-lut]')) {
          if (looks() > 0) break;
          it.click(); await new Promise(r => setTimeout(r, 300));
        }
        const first = document.querySelector('#zLooks .lkItem[data-own="0"]'); if (!first) return false;
        first.click();
        document.getElementById('save')?.click(); return true; })()`);
      check(`${kind}: a look applies`, applied === true);
      const saved = await waitFor(`/Saved/.test(document.getElementById('status').textContent)`, 30000);
      check(`${kind}: the edit is saved`, !!saved, await evaluate(`document.getElementById('status').textContent`));
      if (kind === 'armor') {   // a look of your own: saved in a category (beside the projects), listed, then deleted
        const own = JSON.parse(await evaluate(`(async () => {
          const wait = async f => { for (let i = 0; i < 50; i++) { const v = f(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } return null; };
          window.confirm = () => true;
          document.getElementById('lkSave').click();
          (await wait(() => document.getElementById('lkName'))).value = 'E2E look';
          document.getElementById('lkCat').value = 'E2E';
          document.getElementById('lkOk').click();
          const item = await wait(() => [...document.querySelectorAll('#zLooks details.lkCat[data-cat="m:E2E"] .lkItem')].find(e => /E2E look/.test(e.textContent)));
          const where = (await wait(() => document.getElementById('lkWhere')?.textContent))?.trim() ?? '';
          const listed = (await (await fetch('/api/presets')).json()).filter(p => p.name === 'E2E look' && p.category === 'E2E').length;
          item?.querySelector('.lkDel')?.click();
          const gone = await wait(() => !(document.querySelector('#zLooks')?.textContent ?? '').includes('E2E look'));
          return JSON.stringify({ item: !!item, swatch: !!item?.querySelector('.swatch:not(.none)'), where, listed, gone: !!gone }); })()`));
        check(`${kind}: a look of your own: saved in a category beside the projects, listed with its swatch, deleted`,
          own.item && own.swatch && own.listed === 1 && own.gone && /looks\.json|browser/.test(own.where) && errors.length === 0, JSON.stringify(own));
      }

      // build with the button (renders icon and variant pictures), then the download
      errors.length = 0;
      await evaluate(`document.getElementById('build').click(), true`);
      const built = await waitFor(`(() => { const m = document.getElementById('modalBody')?.textContent ?? ''; return /Mod built|Build failed/.test(m) && m; })()`, 180000);
      check(`${kind}: build succeeds`, !!built && /Mod built/.test(built), (built || 'timed out').slice(0, 160));
      if (kind === 'armor') check(`${kind}: built with options (the ones that change something)`, /option\(s\)/.test(built ?? ''), (built || '').slice(0, 300));
      await shot(`${kind}-built`);
      // the zip (as the Build button downloads it), then imported back as a mod: both in the page
      const back = JSON.parse(await evaluate(`(async () => {
        const zip = await (await fetch('/api/download')).arrayBuffer(), b = new Uint8Array(zip);
        const fd = new FormData(); fd.append('files', new Blob([zip]), ${JSON.stringify(kind + '.zip')});
        const r = await fetch('/api/importmod', { method: 'POST', body: fd });
        return JSON.stringify({ size: b.length, pk: b[0] === 0x50 && b[1] === 0x4b, report: r.ok ? (await r.json()).report : await r.text() }); })()`));
      check(`${kind}: the mod zip downloads`, back.size > 200 && back.pk, `${back.size} bytes`);
      check(`${kind}: no page errors while building`, errors.length === 0, errors.slice(0, 3).join(' | '));
      check(`${kind}: the built mod imports`, /Imported/.test(back.report ?? '') && (kind !== 'pattern' || /1 pattern mask/.test(back.report)), back.report);
      await pageApi('/api/close', 'POST', {});
      await evaluate(`(sessionStorage.removeItem('lutstudio.project'), true)`);
    } catch (e) {
      check(`${kind}: ${what}`, false, String(e.message ?? e).slice(0, 300));
    }
  }
}

let code = 1;
try {
  await main();
  code = results.every(r => r.ok) ? 0 : 1;
} catch (e) {
  console.error(e);
} finally {
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed; screenshots in ${outDir}`);
  if (failed) console.log('app log (tail):\n' + appLog.split('\n').slice(-20).join('\n'));
  try { ws?.close(); } catch { }
  chrome.kill(); app.kill();
  // the scratch folder (projects, settings, the browser profile: ~250 MB a run) goes too, once they have exited
  await sleep(1500);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { console.log('scratch left:', scratch, e.message); }
  process.exit(code);
}
