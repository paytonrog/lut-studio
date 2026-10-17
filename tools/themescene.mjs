// Theme scene: renders theme presets on a key-art scene: three Helldivers (armor, helmet, cape, the weapon they hold) in
// the Armory's warbond poses, gear at their feet, an exosuit, an FRV and a beacon behind, in the
// game's Armory menu lighting with a rim light in the theme's accent color. Each item is shown in the editor one by one,
// kept, and placed (on the ground, at its spot, turned); then each preset is applied per item as the Theme panel's
// preview does (theme.js presetRow / putLook), and the scene is captured in layers (behind, the squad, in front) and
// item by item, and composited: a glowing disc behind the squad, the back layer hazed, floor reflections and contact
// shadows, a glow around the squad, embers, bloom, grain, a vignette and the theme's name.
// Dev tool, not shipped.
//   node tools/webserve.mjs 8790          (in another terminal; serves dist/web with the install at ?devgame=1)
//   node tools/themescene.mjs <out dir> [preset…] [--no-title] [--weapons=A,B,C] [--pose=P,Q,R] [--scene=file.json]
//     (no preset: every one; "game": the items as the game has them. --weapons / --pose: the Helldivers' weapons and
//     poses, in the scene's order; "none" or "-": no weapon, "" keeps the scene's. --poses lists the poses there are.)
// A Helldiver holds the weapon when the pose does (the Armory's poses and the moves; an emote puts it away): the
// weapon's root on the right hand's attach_hand_r (as the game links it; the pose moves that node, so a weapon
// propped or slung goes where the pose puts it), the left hand reached to the weapon's IK_left by a two-bone IK when
// the pose holds it two-handed.
// Writes <preset>.png (2560 x 1440) per preset. Needs Chrome or Edge, and ImageMagick (magick) on the PATH.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [outDir, ...wanted] = args;
if (!outDir) { console.error('usage: node tools/themescene.mjs <out dir> [preset…] [--no-title] [--weapons=A,B,C] [--pose=P,Q,R] [--scene=file.json] | x --poses'); process.exit(2); }
const site = 'http://127.0.0.1:8790/?devgame=1';
const TITLE = !process.argv.includes('--no-title');
const W = 2560, H = 1440;   // (the output)
const RIM = 3;              // the rim lights' strength

// The scene: x right (as the camera sees it), z away from the camera (meters); the item's footprint center goes to [x, z], its lowest point
// to the ground (lift: above it); yaw turns it about the vertical, pitch about the camera's left-right, roll about its line of sight
// (radians, in that order: roll, pitch, then yaw). Helldivers: armor (its own helmet), a cape, the weapon held (weapon: a Weapons
// item's name); pose: a pose's name (or a number: an Armory idle), at t seconds into it or tf of its length. layer: back
// (behind the squad: hazed), squad, front (in front of it).
let SCENE = [
  // the squad: the leader in front, two flanking a step behind; the camera low
  { group: 'Armor', name: 'TR-117 Alpha Commander', cape: 'Eye of the Clandestine', weapon: 'AR-23 Liberator', at: [0, -0.55], yaw: 0, pose: 'I-102 Draconaught pose', tf: 0.5, layer: 'squad' },
  { group: 'Armor', name: 'CE-35 Trench Engineer', cape: 'Bastion of Integrity', weapon: 'SG-225 Breaker', at: [-1.3, 0.55], yaw: -0.95, pose: 'GS-17 Frontier Marshal pose', tf: 0.5, layer: 'squad' },
  { group: 'Armor', name: 'SC-34 Infiltrator', cape: 'Badge of Order', weapon: 'AC-8 Autocannon', at: [1.05, 0.6], yaw: -0.45, pose: 'PH-9 Predator pose', tf: 0.15, layer: 'squad' },
  // the big gear behind, cut by the frame
  { group: 'Vehicles', name: 'Patriot Exosuit: Standard Exosuit Pattern', at: [-3.35, 2.6], yaw: -0.6, layer: 'back' },
  { group: 'Vehicles', name: 'Gunner FRV: Standard Vehicle Pattern', at: [4.1, 3.0], yaw: 1.0, layer: 'back' },
  { group: 'Stratagems', name: 'Stratagem: SOS Beacon', at: [-2.25, 4.6], yaw: 0.3, layer: 'back' },
  // the small gear at the squad's feet
  { group: 'Backpacks', name: 'LIFT-850 Jump Pack', at: [1.65, -1.05], yaw: 0.7, layer: 'front' },
  { group: 'Weapons', name: 'P-2 Peacemaker', at: [-0.8, -0.95], yaw: -1.9, layer: 'front' },
  { group: 'Equipment', name: 'Throwable: Frag Grenade', at: [0.45, -1.05], yaw: 0, layer: 'front' },
];
let CAM = { pitch: -0.05, fov: 0.55, target: [0, 0.82, 0.35], dist: 7.0 };
// --scene=<file.json>: another scene ({ items: [...], cam: {...} }; trying layouts and poses)
const sceneArg = process.argv.find(a => a.startsWith('--scene='));
if (sceneArg) { const j = JSON.parse(readFileSync(sceneArg.slice(8), 'utf8')); SCENE = j.items ?? SCENE; CAM = { ...CAM, ...j.cam }; }
// --weapons= / --pose=: the Helldivers' (in the scene's order)
const listArg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3).split(',').map(s => s.trim());
const divers = SCENE.filter(it => it.group === 'Armor');
listArg('weapons')?.forEach((w, i) => { if (divers[i] && w !== '') divers[i].weapon = /^(none|-)$/i.test(w) ? null : w; });
listArg('pose')?.forEach((q, i) => { if (divers[i] && q !== '') { divers[i].pose = /^\d+$/.test(q) ? +q : q; } });

const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = browsers.find(b => existsSync(b));
if (!browser) { console.error('no Chrome or Edge found'); process.exit(1); }
const port = 9300 + Math.floor(Math.random() * 500);
const profile = join(tmpdir(), 'lutstudio-themescene');   // the browser profile (its projects live there), kept for the next run
mkdirSync(profile, { recursive: true });
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--window-size=2900,1800',
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
const loaded = `/parts\\./.test(document.getElementById('status').textContent)`;
const select = async (elId, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(elId)}); if (!e) return 0; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change')); return 1; })()`);

await send('Page.navigate', { url: site });
await waitFor(`fetch('/api/kits').then(r => r.ok)`, 120000);   // (the game folder mounts)
const kits = await ev(`fetch('/api/kits').then(r => r.json())`);
const kitIn = (group, name) => kits.find(k => k.group === group && (k.name === name || k.label.startsWith(name)));
// a project to show the items in (the first armor's)
const first = kitIn('Armor', SCENE.find(s => s.group === 'Armor').name);
await ev(`(async () => { const r = await (await fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: 'theme scene ' + Date.now(), What: ${JSON.stringify(first.value)} }) })).json();
  sessionStorage.setItem('lutstudio.project', r.project); setTimeout(() => location.reload(), 0); return 1; })()`);
await sleep(3000);
await waitFor(`window.lutstudio?.R?.pieces?.length > 0 && ${loaded}`);
await sleep(2000);
await waitFor(`window.lutstudio.poses().length > 0`, 60000);
const poseList = JSON.parse(await ev(`JSON.stringify(window.lutstudio.poses().map(p => ({ name: p.name, group: p.group })))`));
if (process.argv.includes('--poses')) {   // (the poses there are, to pick from; * : holds the weapon)
  for (const p of poseList) console.log(`${holds(p.name) ? '*' : ' '} ${p.group}: ${p.name}`);
  ws.close(); proc.kill(); process.exit(0);
}
// does a pose hold the weapon? The Armory's (idles, variations, warbond poses) and the moves do; an emote puts it away
function holds(pose) {
  if (typeof pose === 'number') return true;
  const g = poseList.find(p => p.name === pose)?.group;
  return g === 'Armory' || g === 'Moves';
}
// the held weapons: an item each, after its Helldiver (holder: the Helldiver's index)
{
  const out = [];
  for (const it of SCENE) {
    out.push(it);
    if (it.group === 'Armor' && it.weapon) {
      if (holds(it.pose)) out.push({ group: 'Weapons', name: it.weapon, layer: it.layer, holder: out.length - 1 });
      else console.log(`(${it.name}: ${it.pose} holds no weapon)`);
    }
  }
  SCENE = out;
}

// ---- in the page: a held weapon put in its Helldiver's hands (holdWeapon(it, pieces)). The weapon's root goes on the
// posed avatar's attach_hand_r; then, when the left hand is near the weapon's IK_left (the pose holds it with both
// hands), the left arm is bent (two-bone IK: shoulder, elbow) so attach_hand_l meets IK_left, its hand turned as
// IK_left; the Helldiver's pieces take those bones (pose.world). All in the avatar's space, then the Helldiver's turn
// and place.
await ev(`(async () => {
  const { poseSkeleton, M4 } = await import('./render.js');
  const v3 = { sub: (a, b) => a.map((x, k) => x - b[k]), add: (a, b) => a.map((x, k) => x + b[k]), mul: (a, s) => a.map(x => x * s),
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: a => Math.hypot(...a),
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
  const pos = m => [m[12], m[13], m[14]];
  // the turn taking direction a to direction b, about point c (a 4 x 4)
  const turn = (a, b, c) => {
    const u = v3.mul(a, 1 / v3.len(a)), w = v3.mul(b, 1 / v3.len(b)), ax = v3.cross(u, w), s = v3.len(ax), co = Math.max(-1, Math.min(1, v3.dot(u, w)));
    if (s < 1e-8) return M4.ident();
    const [x, y, z] = v3.mul(ax, 1 / s), t = 1 - co;
    const R = [t * x * x + co, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + co, t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + co, 0, 0, 0, 0, 1];
    const T = (p) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
    return M4.mul(T(c), M4.mul(R, T(v3.mul(c, -1))));
  };
  const m3 = m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const mul3 = (A, B) => { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return o; };
  const app3 = (A, v) => [0, 1, 2].map(r => A[r] * v[0] + A[3 + r] * v[1] + A[6 + r] * v[2]);
  window.holdWeapon = async (it, ps) => {
    const R = window.lutstudio.R, S = R.avatarSkel, h = window.sceneItems.find(s => s.n === it.holder);
    if (!h || !S) return { error: 'no holder' };
    const at = n => S.names.indexOf(n);
    h.posed ??= poseSkeleton(S, h.pose?.clip ?? null, h.pose?.time ?? 0);
    const posed = h.posed;
    // the weapon's root (its skeleton's bind; a weapon without one: its own space) and its left grip
    const wp = ps.find(p => p.skin), wsk = wp?.skin.skel, wb = wsk ? poseSkeleton(wsk, null, 0) : null;
    const wnode = n => { const i = wsk ? wsk.names.indexOf(n) : -1; return i < 0 ? null : wb[i]; };
    const root = wnode('root') ?? wnode('StingrayEntityRoot') ?? M4.ident();
    const Mw = M4.mul(posed[at('attach_hand_r')], M4.invert(root));
    const rot = mul3(h.rot, m3(Mw)), shift = v3.add(app3(h.rot, pos(Mw)), h.shift);
    for (const p of ps) { p.rot = rot; p.shift = shift; p.pose = null; p.sceneItem = it.n; }
    window.sceneItems.push({ n: it.n, layer: it.layer, pieces: ps });
    // the left hand on the weapon, when the pose holds it two-handed: its hand sockets within 40 cm of each other (the
    // pose's own grip, made for a rifle), or the left hand within 30 cm of this weapon's grip; a long weapon's grip
    // further out the arm reaches for
    const ikl = wnode('IK_left'), out = { grip: null, ik: false };
    if (!ikl) return out;
    const goal = M4.mul(Mw, ikl), iS = at('l_shoulder'), iE = at('l_elbow'), iH = at('l_hand'), iA = at('attach_hand_l');
    const miss = v3.len(v3.sub(pos(posed[iA]), pos(goal)));
    out.grip = +(miss * 100).toFixed(1);
    const hands = v3.len(v3.sub(pos(posed[iA]), pos(posed[at('attach_hand_r')])));
    out.hands = +(hands * 100).toFixed(1);
    if ((miss > 0.3 && hands > 0.4) || miss < 0.01) return out;
    const kids = new Map(); S.parent.forEach((q, i) => { if (q >= 0) (kids.get(q) ?? kids.set(q, []).get(q)).push(i); });
    const under = i => { const o = [i]; for (let k = 0; k < o.length; k++) o.push(...(kids.get(o[k]) ?? [])); return o; };
    const W = posed.slice();
    // the hand where it ends: attach_hand_l on IK_left (its turn too), so l_hand = IK_left * inverse(attach_hand_l's local)
    const localA = M4.mul(M4.invert(W[iH]), W[iA]), handGoal = M4.mul(goal, M4.invert(localA)), T = pos(handGoal);
    const Sp = pos(W[iS]), E = pos(W[iE]), Hp = pos(W[iH]), a = v3.len(v3.sub(E, Sp)), b = v3.len(v3.sub(Hp, E));
    const toT = v3.sub(T, Sp), d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, v3.len(toT))), u = v3.mul(toT, 1 / v3.len(toT));
    let pole = v3.sub(v3.sub(E, Sp), v3.mul(u, v3.dot(v3.sub(E, Sp), u)));
    if (v3.len(pole) < 1e-5) pole = [0, -1, 0];
    pole = v3.mul(pole, 1 / v3.len(pole));
    const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    const E2 = v3.add(Sp, v3.mul(v3.add(v3.mul(u, ca), v3.mul(pole, sa)), a));
    const R1 = turn(v3.sub(E, Sp), v3.sub(E2, Sp), Sp);
    for (const i of under(iS)) W[i] = M4.mul(R1, W[i]);
    const H1 = pos(W[iH]), R2 = turn(v3.sub(H1, E2), v3.sub(T, E2), E2);
    for (const i of under(iE)) W[i] = M4.mul(R2, W[i]);
    // the hand turned as the grip (about the wrist), its fingers with it
    const R3 = M4.mul(handGoal, M4.invert(W[iH]));
    for (const i of under(iH)) W[i] = M4.mul(R3, W[i]);
    const world = new Map(); S.names.forEach((nm, i) => { if (nm && !world.has(nm)) world.set(nm, W[i]); });
    const key = 'held' + h.n + ':' + (h.pose ? h.pose.clip.animation + '@' + h.pose.time.toFixed(4) : 'bind');
    for (const p of h.pieces) if (p.skin && !p.info?.vehicle) p.pose = { ...(h.pose ?? { clip: null, time: 0 }), key, world };
    out.ik = true; out.after = +(v3.len(v3.sub(pos(W[iA]), pos(goal))) * 100).toFixed(1);
    return out;
  };
  return 1; })()`);

// ---- each item shown, then kept aside (its pieces, placed and turned; Helldivers posed)
await ev(`(() => { window.sceneItems = []; return 1; })()`);
for (const [n, it] of SCENE.entries()) {
  const kit = kitIn(it.group, it.name);
  if (!kit) { console.log('not found:', it.name); continue; }
  const keys = [kit.value];
  for (const [group, name] of [['Capes', it.cape]]) {   // (a backpack shown replaces the armor: it stands on its own)
    if (!name) continue;
    const k = kitIn(group, name);
    if (k) keys.push(k.value); else console.log('not found:', name);
  }
  for (const k of keys) {
    await ev(`(async () => { document.getElementById('status').textContent = ''; await window.lutstudio.showItem(${JSON.stringify(k)}); return 1; })()`);
    if (!await waitFor(loaded, 120000)) console.log('slow:', it.name);
    await sleep(1500);
  }
  const res = await ev(`(async () => {
    const L = window.lutstudio, R = L.R, it = { ...${JSON.stringify(it)}, n: ${n} };
    const ps = R.pieces; R.pieces = [];   // (kept: the next item's load clears nothing of them)
    let pose = null;
    if (it.pose !== undefined) {
      // (a number: an Armory idle; a name: that pose; t: seconds into it, or tf: a fraction of it)
      const idles = L.poses().filter(p => /armory idle/i.test(p.name));
      const p = typeof it.pose === 'string' ? L.poses().find(p => p.name === it.pose) : idles[it.pose % Math.max(1, idles.length)];
      if (p) { const clip = await L.clip(p.animation); pose = { clip, time: it.tf !== undefined ? it.tf * clip.length : (it.t ?? 0) % Math.max(clip.length, 1e-3) }; }
      else console.log('no pose ' + it.pose);
    }
    if (it.holder !== undefined) return JSON.stringify(await holdWeapon(it, ps));
    // the turn: roll, pitch, then yaw (the camera looks along +z: its right is -x, so yaw and roll are mirrored)
    const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    const a = -(it.yaw ?? 0), b = it.pitch ?? 0, g = -(it.roll ?? 0);
    const Ry = [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
    const Rx = [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
    const Rz = [[Math.cos(g), -Math.sin(g), 0], [Math.sin(g), Math.cos(g), 0], [0, 0, 1]];
    const M = mul(Ry, mul(Rx, Rz)), rot = [0, 1, 2].flatMap(c => [M[0][c], M[1][c], M[2][c]]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of ps) {
      const [a, b] = p.bounds;
      for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) for (let k = 0; k < 3; k++) {
        const v = M[k][0] * x + M[k][1] * y + M[k][2] * z;
        lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
      }
    }
    const shift = [-it.at[0] - (lo[0] + hi[0]) / 2, -lo[1] + (it.lift ?? 0), it.at[1] - (lo[2] + hi[2]) / 2];
    for (const p of ps) { p.rot = rot; p.shift = shift; p.pose = p.skin && !p.info?.vehicle ? pose : null; p.sceneItem = ${n}; }
    window.sceneItems.push({ n: ${n}, layer: it.layer, pieces: ps, pose, rot, shift });
    return JSON.stringify({ parts: ps.length, size: hi.map((v, k) => +(v - lo[k]).toFixed(2)), pose: pose ? pose.clip.animation : null });
  })()`);
  console.log('ok', it.name, res);
}

// all together; the lighting, the camera
await ev(`(() => { const R = window.lutstudio.R; R.pieces = window.sceneItems.flatMap(s => s.pieces); R.pose = null; return R.pieces.length; })()`).then(n => console.log('pieces', n));
await select('env', 'game:Armory (menu)');
await sleep(6000);
await ev(`(() => {
  const R = window.lutstudio.R, c = ${JSON.stringify(CAM)}; R.frame();
  R.cam.yaw = Math.PI; R.cam.pitch = c.pitch; R.cam.fov = c.fov; R.cam.shiftX = 0; R.cam.target = c.target; R.cam.dist = c.dist;
  for (const id of ['status']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  return 1; })()`);
const baseExposure = await ev(`window.lutstudio.R.env.exposure`);
await sleep(2000);

// ---- captures: some of the scene's items alone on a transparent background (no sky), cropped to 16:9 at W x H
const capture = async (file, items) => {
  const url = await ev(`(() => { const R = window.lutstudio.R, cv = document.getElementById('canvas'), keep = [R.noSky, R.pieces], want = new Set(${JSON.stringify(items)});
    R.noSky = true; R.pieces = window.sceneItems.filter(s => want.has(s.n)).flatMap(s => s.pieces); R.draw(0);
    const d = cv.toDataURL('image/png'); [R.noSky, R.pieces] = keep; return d; })()`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', file]).toString().split(' ').map(Number);
  const ch = Math.round(w * 9 / 16);
  execFileSync('magick', [file, '-gravity', 'center', '-crop', `${w}x${ch}+0+${Math.round((h - ch) * 0.1)}`, '+repage', '-resize', `${W}x${H}!`, file]);
};
const rgba = file => execFileSync('magick', [file, '-depth', '8', 'rgba:-'], { maxBuffer: W * H * 4 + 1024 });
const writeRGBA = (file, buf) => execFileSync('magick', ['-size', `${W}x${H}`, '-depth', '8', 'rgba:-', file], { input: buf });
// an item's outline on the image: its box, and its footprint (the span of its lowest rows)
const extent = px => {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  let f0 = W, f1 = -1;
  for (let y = Math.max(y0, y1 - Math.max(4, Math.round((y1 - y0) * 0.04))); y <= y1; y++) for (let x = x0; x <= x1; x++) if (px[(y * W + x) * 4 + 3] > 24) { f0 = Math.min(f0, x); f1 = Math.max(f1, x); }
  return { x0, x1, y0, y1, f0, f1 };
};
// a seeded random (the same embers for a preset every run)
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// the scene's light from a theme's colors: its most vivid one (a glow or trim first), at full strength (no washed-out
// or near-black light); a theme without a real color: a quiet steel. accent: the light; text: the title's (light
// enough to read); sat: how colored; k: the backlight's strength
const palette = colors => {
  const hsl = h => { const [r, g, b] = hexRGB(h).map(c => c / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const hue = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, s, l]; };
  const hex = (h, s, l) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join(''); };
  let best = null;
  for (const [role, c] of colors) {
    const [h, s, l] = hsl(c), score = s * (1 - Math.abs(2 * l - 1) * 0.6) * (role === 'glow' ? 1.4 : role === 'trim' ? 1.15 : 1);
    if (!best || score > best.score) best = { h, s, l, score };
  }
  if (!best || best.s < 0.22 || best.score < 0.12) return { accent: '#8a98a8', text: '#b8c4d0', sat: 0, k: 0.7 };
  const s = Math.min(1, best.s * 1.1);
  return { accent: hex(best.h, s, 0.52), text: hex(best.h, s, 0.68), sat: Math.min(1, best.s), k: 1 };
};
const inLayer = L => SCENE.map((it, n) => it.layer === L ? n : -1).filter(n => n >= 0);

const compose = async (name, file, pal) => {
  const accent = pal.accent, k = pal.k;
  const dir = join(outDir, 'work'); mkdirSync(dir, { recursive: true });
  const f = n => join(dir, n + '.png');
  // exposure: lowered while the squad's lit parts clip (a white or pastel theme washes out to flat white)
  let exp = baseExposure;
  for (let i = 0; i < 4; i++) {
    await ev(`(() => { window.lutstudio.R.env.exposure = ${exp}; return 1; })()`);
    await capture(f('squad'), inLayer('squad'));
    // (measured after the grade's lift: what clips in the end)
    const px = rgba(f('squad')), lit = execFileSync('magick', [f('squad'), '-alpha', 'off', '(', '-size', `${W}x${H}`, 'xc:gray50', ')', '-compose', 'soft-light', '-composite', '-depth', '8', 'rgb:-'], { maxBuffer: W * H * 3 + 1024 });
    // (its overall brightness, the 70th percentile: a glow clips on any theme, a white suit clips everywhere)
    const hist = new Array(256).fill(0); let on = 0;
    for (let j = 0, q = 0; j < px.length; j += 4, q += 3) if (px[j + 3] > 200) { on++; hist[Math.max(lit[q], lit[q + 1], lit[q + 2])]++; }
    let p70 = 0; for (let v = 0, n = 0; v < 256; v++) { n += hist[v]; if (n >= on * 0.7) { p70 = v; break; } }
    if (!on || p70 < 236) break;
    exp *= 0.7;
  }
  if (exp !== baseExposure) console.log(`  exposure ${exp.toFixed(2)}`);
  for (const L of ['back', 'front']) await capture(f(L), inLayer(L));
  // each item: its outline, its reflection on the floor (mirrored at its lowest row, fading), its contact shadow
  const refl = { back: Buffer.alloc(W * H * 4), fore: Buffer.alloc(W * H * 4) }, shadows = [];
  let floor = 0;
  for (const [n, it] of SCENE.entries()) {
    await capture(f('item'), [n]);
    const px = rgba(f('item')), e = extent(px);
    if (!e) continue;
    if (it.layer === 'squad') floor = Math.max(floor, e.y1);
    const out = it.layer === 'back' ? refl.back : refl.fore, D = Math.round((e.y1 - e.y0) * 0.45), strength = it.layer === 'back' ? 0.18 : 0.3;
    for (let r = 1; r <= D && e.y1 + r < H; r++) {
      const src = e.y1 - r; if (src < 0) break;
      const fade = strength * Math.pow(1 - r / D, 1.6);
      for (let x = e.x0; x <= e.x1; x++) {
        const si = (src * W + x) * 4, di = ((e.y1 + r) * W + x) * 4, a = px[si + 3] / 255 * fade;
        if (a <= 0) continue;
        for (let k = 0; k < 3; k++) out[di + k] = Math.round(px[si + k] * a + out[di + k] * (1 - a));   // (premultiplied)
        out[di + 3] = Math.round(255 * (a + out[di + 3] / 255 * (1 - a)));
      }
    }
    const cx = (e.f0 + e.f1) / 2, rx = Math.max(20, (e.f1 - e.f0) / 2 * 1.25);
    shadows.push(`ellipse ${cx.toFixed(0)},${e.y1} ${rx.toFixed(0)},${(rx * 0.16 + 6).toFixed(0)} 0,360`);
  }
  for (const b of Object.values(refl)) for (let i = 0; i < b.length; i += 4) { const a = b[i + 3]; if (a) for (let k = 0; k < 3; k++) b[i + k] = Math.min(255, Math.round(b[i + k] * 255 / a)); }
  writeRGBA(f('reflback'), refl.back); writeRGBA(f('reflfore'), refl.fore);
  floor ||= Math.round(H * 0.8);
  const [ar, ag, ab] = hexRGB(accent), rand = rng([...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
  // embers: small sharp sparks and big soft bokeh, rising in the light
  const sparks = [], bokeh = [];
  for (let i = 0; i < 140; i++) {
    const x = rand() * W, y = Math.pow(rand(), 0.8) * floor, r = 0.8 + rand() * 2.6, a = (0.25 + rand() * 0.7).toFixed(2);
    const hot = rand() < 0.3 ? [255, 240, 220] : [ar, ag, ab].map(c => Math.min(255, Math.round(c * 1.25 + 30)));
    sparks.push('-fill', `rgba(${hot.join(',')},${a})`, '-draw', `circle ${x.toFixed(0)},${y.toFixed(0)} ${(x + r).toFixed(1)},${y.toFixed(0)}`);
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * W, y = rand() * floor * 0.9, r = 10 + rand() * 34, a = (0.05 + rand() * 0.12).toFixed(2);
    bokeh.push('-fill', `rgba(${ar},${ag},${ab},${a})`, '-draw', `circle ${x.toFixed(0)},${y.toFixed(0)} ${(x + r).toFixed(0)},${y.toFixed(0)}`);
  }
  const cx = W / 2, cy = H * 0.4;
  const layer = (...ops) => ['(', '-size', `${W}x${H}`, 'xc:none', ...ops, ')'];
  const glow = (...ops) => ['(', '-size', `${W}x${H}`, 'xc:black', ...ops, ')', '-compose', 'screen', '-composite', '-compose', 'over'];
  execFileSync('magick', ['-size', `${W}x${H}`, 'xc:#060709',
    // the light behind: a wide soft glow, a brighter core, a hot center; a faint pool of light on the floor
    ...layer('-fill', accent, '-draw', `circle ${cx},${cy} ${cx},${cy + H * 0.55}`, '-channel', 'A', '-evaluate', 'multiply', (0.32 * k).toFixed(3), '+channel', '-blur', '0x160'), '-composite',
    ...layer('-fill', accent, '-draw', `circle ${cx},${cy} ${cx},${cy + H * 0.3}`, '-channel', 'A', '-evaluate', 'multiply', (0.8 * k).toFixed(3), '+channel', '-blur', '0x70'), '-composite',
    ...layer('-fill', '#ffffff', '-draw', `circle ${cx},${cy} ${cx},${cy + H * 0.15}`, '-channel', 'A', '-evaluate', 'multiply', (0.45 * k * k).toFixed(3), '+channel', '-blur', '0x80'), '-composite',
    ...layer('-fill', accent, '-draw', `ellipse ${cx},${floor} ${W * 0.42},${H * 0.07} 0,360`, '-channel', 'A', '-evaluate', 'multiply', '0.35', '+channel', '-blur', '0x60'), '-composite',
    ...glow(...bokeh, '-blur', '0x8'),
    // the back: its reflection, then it, hazed into the light and a little soft; fog over its feet
    '(', f('reflback'), '-blur', '0x4', ')', '-composite',
    '(', f('back'), '-channel', 'RGB', '-fill', accent, '-colorize', '12%', '+channel', '-modulate', '100', '-blur', '0x1.6', ')', '-composite',
    ...layer('-fill', accent, '-draw', `rectangle 0,${Math.round(floor - H * 0.12)} ${W},${Math.round(floor + H * 0.03)}`, '-channel', 'A', '-evaluate', 'multiply', '0.16', '+channel', '-blur', '0x70'), '-composite',
    // contact shadows, the squad's and the gear's reflections, a glow around the squad (the light bleeding past it)
    ...layer('-fill', 'rgba(0,0,0,0.85)', ...shadows.flatMap(d => ['-draw', d]), '-blur', '0x10'), '-composite',
    '(', f('reflfore'), '-blur', '0x3', ')', '-composite',
    '(', f('squad'), '-alpha', 'extract', '-blur', '0x28', '-evaluate', 'multiply', (0.45 * k).toFixed(3), '(', '-size', `${W}x${H}`, `xc:${accent}`, ')', '-compose', 'multiply', '-composite', ')', '-compose', 'screen', '-composite', '-compose', 'over',
    f('squad'), '-composite', f('front'), '-composite',
    ...glow(...sparks, '-blur', '0x0.7'),
    f('base')]);
  // bloom (the bright parts, blurred, added), a gentle S-curve, grain, a vignette, the title
  execFileSync('magick', [f('base'),
    '(', '+clone', '-level', '78%,100%', '-blur', '0x22', '-evaluate', 'multiply', '0.45', ')', '-compose', 'screen', '-composite', '-compose', 'over',
    '-sigmoidal-contrast', '1.8x40%',
    // the grade: a noisy grey soft-lit over it (ImageMagick's soft light lifts the midtones a lot, and adds grain)
    '(', '-size', `${W}x${H}`, 'xc:gray50', '-attenuate', '0.35', '+noise', 'Gaussian', '-colorspace', 'gray', ')', '-compose', 'soft-light', '-composite', '-compose', 'over',
    '(', '-size', `${W}x${H}`, 'radial-gradient:none-#000000', '-channel', 'A', '-evaluate', 'multiply', '0.8', '+channel', ')', '-gravity', 'center', '-composite',
    ...(TITLE ? titleOps(name, pal.text) : []),
    file]);
};
// the theme's name at the bottom, glowing, and a small line over it
const titleOps = (name, accent) => {
  const font = 'C:/Windows/Fonts/AGENCYB.TTF', y = Math.round(H * 0.035);
  const text = (fill, size, kern, dy, s, blur) => ['(', '-size', `${W}x${H}`, 'xc:none', '-font', font, '-pointsize', String(size), '-kerning', String(kern),
    '-fill', fill, '-gravity', 'south', '-annotate', `+0+${dy}`, s, ...(blur ? ['-blur', blur] : []), ')', '-gravity', 'center', '-composite'];
  return [...text(accent, 110, 22, y, name.toUpperCase(), '0x14'), ...text('#f4f1ea', 110, 22, y, name.toUpperCase()),
    ...text(accent, 28, 10, y + 122, 'LUT STUDIO THEME')];
};

// ---- each preset applied per item (its roles: built-in, else suggested for the item), then captured
const presets = wanted.length ? wanted : JSON.parse(await ev(`import('./theme.js').then(m => JSON.stringify(Object.keys(m.PRESETS)))`));
mkdirSync(outDir, { recursive: true });
for (const name of presets) {
  const ok = await ev(`(async () => {
    const { R, S, api } = window.lutstudio, { PRESETS, presetRow, putLook } = await import('./theme.js');
    const P = PRESETS[${JSON.stringify(name)}], W = 23, tag = 'ts${presets.indexOf(name)}:';
    const roles = await api('/api/roles');
    for (const it of window.sceneItems) for (const p of it.pieces) { p.sceneKeys ??= { ...p.lutKeys }; Object.assign(p.lutKeys, p.sceneKeys); }
    if (!P) return ${JSON.stringify(name)} === 'game' ? 'game' : 'no such preset';
    const done = new Set();
    for (const it of window.sceneItems) {
      const luts = [...new Set(it.pieces.map(p => p.info.lut))].filter(h => S.luts.get(h)?.kind === 'material');
      let sug = {};
      try { sug = await api('/api/roles/suggest?variant=' + encodeURIComponent(S.variant) + '&luts=' + luts.join(',')); } catch { }
      const zones = [];
      for (const h of luts) { const l = S.luts.get(h), r = roles.mine[h] ?? roles.builtin[h] ?? sug[h]?.roles ?? [];
        for (let z = 0; z < l.h; z++) zones.push({ h, z, role: r[z] ?? 'keep', cov: sug[h]?.coverage?.[z] ?? 0 }); }
      const rowOf = x => { const l = S.luts.get(x.h), a = l.edited ?? l.vanilla; return Array.from(a.slice(x.z * l.w * 4, (x.z + 1) * l.w * 4)); };
      const biggest = n => zones.filter(x => x.role === n && S.luts.get(x.h).w === W).sort((a, b) => b.cov - a.cov)[0];
      const any = biggest('primary') ?? biggest('secondary') ?? zones.find(x => S.luts.get(x.h).w === W && x.role !== 'unused');
      const looks = {};
      for (const [n, L] of Object.entries(P)) { const x = n === 'hardware' ? biggest('hardware') : biggest(n) ?? any; if (x) looks[n] = presetRow(rowOf(x), L); }
      for (const h of luts) {
        if (done.has(h)) continue;
        done.add(h);
        const l = S.luts.get(h), px = (l.edited ?? l.vanilla).slice();
        for (const x of zones) if (x.h === h && looks[x.role] && l.w === W) putLook(px, l, x.z, looks[x.role], x.role);
        R.setLut(tag + h, l.w, l.h, px);
      }
      for (const p of it.pieces) {
        if (luts.includes(p.info.lut)) p.lutKeys.edited = tag + p.info.lut;
        // patterns and capes' trim lines: the trim look's color
        const trim = looks.trim;
        for (const [key, h, rows] of [['pattern', p.info.pattern, true], ['cape', p.info.cape, false]]) {
          const l = h && S.luts.get(h);
          if (!trim || !l) continue;
          const px = (l.edited ?? l.vanilla).slice();
          for (let z = 0; z < l.h; z++) if (!rows || px[z * l.w * 4 + 3] !== -1) for (let k = 0; k < 3; k++) px[z * l.w * 4 + k] = trim[k];
          R.setLut(tag + key + ':' + h, l.w, l.h, px);
          p.lutKeys[key] = tag + key + ':' + h;
        }
      }
    }
    return 'ok'; })()`);
  if (ok !== 'ok' && ok !== 'game') { console.log(name, ok); continue; }
  // the theme's colors (role, hex), for its light
  const colors = JSON.parse(await ev(`import('./theme.js').then(m => { const out = [], walk = (v, role) => {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out.push([role, v]);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, role ?? k);
    }; walk(m.PRESETS[${JSON.stringify(name)}] ?? {}, null); return JSON.stringify(out); })`));
  const pal = palette(colors);
  // the rim light: two lights from behind, in the accent color (weaker for a washed-out one)
  const lin = hexRGB(pal.accent).map(c => Math.pow(c / 255, 2.2)), top = Math.max(...lin, 1e-3);
  await ev(`(() => { const R = window.lutstudio.R, c = ${JSON.stringify(lin.map(c => c / top))};
    R.rim = [{ on: true, az: 200, el: 22, color: c, intensity: ${(RIM * (0.35 + 0.65 * pal.sat)).toFixed(2)} }, { on: true, az: 160, el: 22, color: c, intensity: ${(RIM * (0.35 + 0.65 * pal.sat)).toFixed(2)} }]; return 1; })()`);
  await sleep(2500);
  await compose(name, join(outDir, name.replace(/[^A-Za-z0-9]+/g, '_') + '.png'), pal);
  console.log('rendered', name);
}
ws.close(); proc.kill();
await sleep(500);
process.exit(0);
