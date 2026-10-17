// Role check: renders items in their game look next to a test recolor by zone role, to check the role mapping (the
// built-in roles, the user's, else the suggestions) item by item. The test colors are ones no stock outfit uses:
// primary electric cyan, secondary hot pink, trim lime, cloth violet (patterns: trim, as a theme does; camo: shades of
// its zone's color); hardware, glow, keep and unused zones keep the game's look. A big part in a normal military color
// after the recolor is metal, a role left alone, or a miss. Dev tool, not shipped.
//   node tools/webserve.mjs 8790          (in another terminal; serves dist/web with the install at ?devgame=1)
//   node tools/rolecheck.mjs <out dir> <group> [name…]
// group: Armor, Helmets, Capes, Backpacks, Weapons, Vehicles, Equipment, Stratagems or "Eagle & craft"; names: those
// items (as listed in the item menu), else every item of the group (weapons: not the paint-scheme variants). Writes one image per item and contact sheets
// (sheet-1.jpg, …; 12 items each). Needs Chrome or Edge, and ImageMagick (magick) on the PATH.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const [outDir, group, ...names] = process.argv.slice(2);
const GROUPS = ['Armor', 'Helmets', 'Capes', 'Backpacks', 'Weapons', 'Vehicles', 'Equipment', 'Stratagems', 'Eagle & craft'];
if (!outDir || !GROUPS.includes(group)) {
  console.error(`usage: node tools/rolecheck.mjs <out dir> <${GROUPS.join('|')}> [name…]`);
  process.exit(2);
}
const site = 'http://127.0.0.1:8790/?devgame=1';
const PALETTE = { primary: '#00e5ff', secondary: '#ff2bd6', trim: '#9dff00', cloth: '#7a2cff' };
const VIEW = { Armor: 'Front ¾', Helmets: 'Helmet', Capes: 'Back', Backpacks: 'Back ¾', Weapons: 'Side' }[group] ?? 'Front ¾';
const CROP = { Armor: '64%x100%+0+0', Helmets: '60%x80%+0+0', Capes: '64%x100%+0+0', Backpacks: '70%x100%+0+0', Weapons: '100%x80%+0+0' }[group] ?? '90%x100%+0+0';

const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = browsers.find(b => existsSync(b));
if (!browser) { console.error('no Chrome or Edge found'); process.exit(1); }
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'lsrc-'));   // the browser profile (its projects live there), removed at the end
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--window-size=2200,1500',
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
const shot = async file => {
  const r = JSON.parse(await ev(`(() => { const f = parent.document.getElementById('app').getBoundingClientRect(), c = document.getElementById('canvas').getBoundingClientRect(); return JSON.stringify({ x: f.left + c.left, y: f.top + c.top, w: c.width, h: c.height }); })()`));
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  execFileSync('magick', [file, '-gravity', 'center', '-crop', CROP, '+repage', file]);
};
const select = async (elId, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(elId)}); if (!e) return 0; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change')); return 1; })()`);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const safe = s => s.replace(/[^A-Za-z0-9_-]+/g, '_');

await send('Page.navigate', { url: site });
await waitFor(`fetch('/api/kits').then(r => r.ok)`, 120000);   // (the game folder mounts)
const kits = (await ev(`fetch('/api/kits').then(r => r.json())`)).filter(k => k.group === group && !/paint scheme$/.test(k.label));
const items = names.length ? names.map(n => kits.find(k => k.name === n) ?? kits.find(k => k.label.startsWith(n)) ?? { missing: n }) : kits;
mkdirSync(outDir, { recursive: true });
const done = [];
for (const kit of items) {
  if (kit.missing) { console.log('not found:', kit.missing); continue; }
  const name = safe(kit.label);
  const dir = join(outDir, name);
  mkdirSync(dir, { recursive: true });
  try {
    await ev(`(async () => { const r = await (await fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: 'rolecheck ' + Date.now(), What: ${JSON.stringify(kit.value)} }) })).json();
      sessionStorage.setItem('lutstudio.project', r.project); setTimeout(() => location.reload(), 0); return 1; })()`);
    await sleep(3000);
    if (!await waitFor(`window.lutstudio?.R?.pieces?.length > 0 && /parts\\./.test(document.getElementById('status').textContent)`)) throw new Error('did not load');
    await sleep(3000);
    if (group === 'Armor') {   // the armor alone (no cape)
      await select('wearCape', '');
      await waitFor(`/parts\\./.test(document.getElementById('status').textContent)`);
      await sleep(3000);
    }
    await select('env', 'Studio');
    await select('camera', VIEW); await sleep(1200);
    await shot(join(dir, 'game.png'));
    const P = Object.fromEntries(Object.entries(PALETTE).map(([r, h]) => [r, hex(h)]));
    await ev(`(async () => {
      const { S, R } = window.lutstudio, P = ${JSON.stringify(P)};
      const luts = [...new Set(R.pieces.map(p => p.info.lut))].filter(h => S.luts.get(h)?.kind === 'material');
      const RR = await (await fetch('/api/roles')).json();
      const sug = await (await fetch('/api/roles/suggest?variant=' + encodeURIComponent(S.variant) + '&luts=' + luts.join(','))).json();
      const leaves = S.schema.material.find(x => x.group === 'paint' && x.key === 'color').leaves;
      for (const h of luts) {
        const l = S.luts.get(h), roles = RR.mine?.[h] ?? RR.builtin?.[h] ?? sug[h]?.roles ?? [];
        const px = (l.edited ?? l.vanilla).slice();
        for (let z = 0; z < l.h; z++) {
          const c = P[roles[z]];
          if (!c) continue;
          const van0 = [0, 1, 2].map(k => px[(z * l.w) * 4 + k]);
          leaves.forEach(([col, ch], k) => { px[(z * l.w + col) * 4 + ch] = c[k]; });
          // the secondary color (col 2) the wear colors (cols 5, 6) and cloth's fuzz color (col 12) follow: the theme color at the game's ratio of the two
          { const lum = o => 0.2126 * px[(z * l.w + o) * 4] + 0.7152 * px[(z * l.w + o) * 4 + 1] + 0.0722 * px[(z * l.w + o) * 4 + 2];
            const g0 = 0.2126 * van0[0] + 0.7152 * van0[1] + 0.0722 * van0[2];
            for (const col of [2, 5, 6, 12]) { const f = g0 > 0.01 ? Math.min(2.5, lum(col) / g0) : 1; for (let k = 0; k < 3; k++) px[(z * l.w + col) * 4 + k] = Math.min(1, c[k] * f); } }
          // camo (layer not -1): shades of the zone's color (other roles' colors in its blobs would read as a wrong role)
          if (Math.round(px[(z * l.w + 21) * 4 + 3]) !== -1) [c, c.map(v => v * 0.55), c.map(v => Math.min(1, v * 1.3)), c.map(v => v * 0.3)].forEach((cc, j) => { for (let k = 0; k < 3; k++) px[(z * l.w + 16 + j) * 4 + k] = cc[k]; });
        }
        R.setLut('rc:' + h, l.w, l.h, px);
        for (const p of R.pieces) if (p.info.lut === h) p.lutKeys.edited = 'rc:' + h;
      }
      // patterns: their patterned rows (mask layer not -1) take the trim color
      for (const pat of new Set(R.pieces.map(p => p.info.pattern).filter(Boolean))) {
        const l = S.luts.get(pat);
        if (!l) continue;
        const px = (l.edited ?? l.vanilla).slice();
        for (let z = 0; z < l.h; z++) if (px[z * l.w * 4 + 3] !== -1) for (let k = 0; k < 3; k++) px[z * l.w * 4 + k] = P.trim[k];
        R.setLut('rcp:' + pat, l.w, l.h, px);
        for (const p of R.pieces) if (p.info.pattern === pat) p.lutKeys.pattern = 'rcp:' + pat;
      }
      return 1; })()`);
    await select('camera', VIEW); await sleep(1200);
    await shot(join(dir, 'test.png'));
    execFileSync('magick', [join(dir, 'game.png'), join(dir, 'test.png'), '-resize', 'x700', '+append', join(outDir, name + '.jpg')]);
    done.push(kit.label);
    console.log('ok', kit.label);
  } catch (e) { console.log('failed', kit.label, e.message); }
}
// contact sheets, 12 items each
const tile = group === 'Weapons' ? ['3x', '900x260+4+4'] : ['4x', '700x520+4+4'];
for (let i = 0; i * 12 < done.length; i++) {
  const page = done.slice(i * 12, i * 12 + 12).flatMap(l => ['-label', l, join(outDir, safe(l) + '.jpg')]);
  execFileSync('magick', ['montage', ...page, '-tile', tile[0], '-geometry', tile[1], '-pointsize', '18', '-background', '#15171b', '-fill', 'white',
    join(outDir, `sheet-${i + 1}.jpg`)]);
}
console.log(`${done.length} of ${items.length} items; sheets in ${outDir}`);
ws.close(); proc.kill();
await sleep(500);
// (only the profile this run made: a folder in the temp directory named lsrc-…)
if (dirname(profile) === tmpdir() && basename(profile).startsWith('lsrc-')) try { rmSync(profile, { recursive: true, force: true }); } catch { }
process.exit(0);
