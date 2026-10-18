// Theme scene: renders theme presets as key art, with the editor's own showcase scene (server/web/scene.js, the Theme
// panel's Showcase image): three Helldivers in the Armory's warbond poses holding their weapons, gear at their feet,
// an exosuit, an FRV and a beacon behind, in the Armory menu lighting. The scene is built once in a headless browser,
// then each preset is drawn on it and saved.
// Dev tool, not shipped.
//   node tools/webserve.mjs 8790          (in another terminal; serves dist/web with the install at ?devgame=1)
//   node tools/themescene.mjs <out dir> [preset…] [--no-title] [--line=text] [--size=3840x2160]
//        [--weapons=A,B,C] [--pose=P,Q,R] [--scene=file.json]
//     (no preset: every one; "game": the items as the game has them. --weapons / --pose: the Helldivers' weapons and
//     poses, in the scene's order; "none" or "-": no weapon, "" keeps the scene's. --scene: { items: [...], cam: {...} }
//     in scene.js's SCENE / CAM form. --line: the small line over the title, "" for none.)
//   node tools/themescene.mjs x --poses   (the poses; * : the pose holds a weapon)
// Writes <preset>.png per preset. Needs Chrome or Edge.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [outDir, ...wanted] = args;
if (!outDir) { console.error('usage: node tools/themescene.mjs <out dir> [preset…] [--no-title] [--line=text] [--size=WxH] [--weapons=A,B,C] [--pose=P,Q,R] [--scene=file.json] | x --poses'); process.exit(2); }
const flag = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const site = 'http://127.0.0.1:8790/?devgame=1';
const TITLE = !process.argv.includes('--no-title');
const size = (flag('size') ?? '3840x2160').split('x').map(Number);
const list = name => flag(name)?.split(',').map(s => s.trim());
const opts = {
  weapons: list('weapons')?.map(w => (w === '' ? undefined : /^(none|-)$/i.test(w) ? null : w)),
  poses: list('pose')?.map(q => (q === '' ? undefined : /^\d+$/.test(q) ? +q : q)),
};
// --env=planet:<id>: a planet's lighting (or any Light menu value); --env=planets: each "Biome: X" preset on its own
// planet's (the planet named X)
if (flag('env') && flag('env') !== 'planets') opts.env = flag('env');
if (flag('scene')) { const j = JSON.parse(readFileSync(flag('scene'), 'utf8')); if (j.items) opts.scene = j.items; if (j.cam) opts.cam = j.cam; }

const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = browsers.find(b => existsSync(b));
if (!browser) { console.error('no Chrome or Edge found'); process.exit(1); }
const port = 9300 + Math.floor(Math.random() * 500);
const profile = join(tmpdir(), 'lutstudio-themescene');   // the browser profile (its projects live there), kept for the next run
mkdirSync(profile, { recursive: true });
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--window-size=1920,1200',
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
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
await send('Runtime.enable'); await send('Page.enable');
// evaluated in the editor's frame
const ev = async expr => {
  const inApp = `(async () => { const w = document.getElementById('app')?.contentWindow ?? window; return await w.eval(${JSON.stringify(expr)}); })()`;
  const r = await send('Runtime.evaluate', { expression: inApp, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const waitFor = async (expr, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(expr); if (v) return v; } catch { } await sleep(500); } return null; };
const done = code => { ws.close(); proc.kill(); process.exit(code); };

await send('Page.navigate', { url: site });
await waitFor(`fetch('/api/kits').then(r => r.ok)`, 120000);   // (the game folder mounts)
// a project to show the items in (any armor's)
const armor = (await ev(`fetch('/api/kits').then(r => r.json())`)).find(k => k.group === 'Armor');
await ev(`(async () => { const r = await (await fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: 'theme scene ' + Date.now(), What: ${JSON.stringify(armor.value)} }) })).json();
  sessionStorage.setItem('lutstudio.project', r.project); setTimeout(() => location.reload(), 0); return 1; })()`);
await sleep(3000);
await waitFor(`window.lutstudio?.R?.pieces?.length > 0 && /parts\\./.test(document.getElementById('status').textContent)`);
await waitFor(`window.lutstudio.poses().length > 0`, 60000);
if (process.argv.includes('--poses')) {
  const ps = JSON.parse(await ev(`import('./scene.js').then(m => JSON.stringify(window.lutstudio.poses().map(p => [m.holdsWeapon(window.lutstudio.poses(), p.name), p.group, p.name])))`));
  for (const [h, g, n] of ps) console.log(`${h ? '*' : ' '} ${g}: ${n}`);
  done(0);
}

// ---- the scene, once; then each preset on it
console.log(await ev(`(async () => {
  const L = window.lutstudio;
  window.themeScene = await L.scene.buildScene(L.scene.app(), ${JSON.stringify(opts)});
  return 'scene: ' + window.themeScene.items.length + ' items' + (window.themeScene.notes.length ? ' (' + window.themeScene.notes.join('; ') + ')' : '');
})()`));
const presets = wanted.length ? wanted : JSON.parse(await ev(`import('./theme.js').then(m => JSON.stringify(Object.keys(m.PRESETS)))`));
mkdirSync(outDir, { recursive: true });
for (const name of presets) {
  const t0 = Date.now();
  const url = await ev(`(async () => {
    const { PRESETS, presetTheme } = await import('./theme.js'), name = ${JSON.stringify(name)};
    if (!PRESETS[name] && name !== 'game') return null;
    const theme = PRESETS[name] ? presetTheme(name) : { name, colors: [], looksFor: () => ({}) };
    if (${JSON.stringify(flag('env') === 'planets')}) {
      const pl = window.lutstudio.S.planets.find(p => name.replace(/^Biome: /, '').replace(/ \\(showcase\\)$/, '') === p.name);
      if (pl) await window.themeScene.setEnv('planet:' + pl.id);
    }
    const c = await window.themeScene.render({ ...theme, title: ${TITLE} ? name : '', line: ${JSON.stringify(flag('line') ?? 'LUT Studio theme')} }, ${JSON.stringify(size)});
    return c.toDataURL('image/png');
  })()`);
  if (!url) { console.log(name, ': no such preset'); continue; }
  writeFileSync(join(outDir, name.replace(/[^A-Za-z0-9]+/g, '_') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('rendered', name, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
done(0);
