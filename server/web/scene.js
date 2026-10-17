// The showcase scene: a theme as key art, live in the viewport. Three Helldivers in the Armory's warbond poses holding
// their weapons, the small gear at their feet, an exosuit, an FRV and a beacon behind, in the game's Armory menu
// lighting with a rim light in the theme's color; showcase.js draws the key-art look around it each frame (the
// backdrop, the floor's reflection and shadows, haze, glow, bloom, the tone, the title). Used by the Theme panel's
// Showcase and by tools/themescene.mjs (window.lutstudio.scene).
//
// buildScene(app, opts) shows each item in the editor one by one, keeps its pieces and places them (on the ground,
// at its spot, turned; Helldivers posed, weapons in their hands), then turns the showcase on. The scene it returns:
// setTheme(theme), setLook(settings), setText(title, line), resetCamera(), exportCanvas(w, h) (the frame as it is
// on screen, at that size), render(theme, size) (a theme, then its export), dispose() (the editor back as it was).
// app: { R, api, kits() (the item list), poses(), clip(hash), showItem(value), statusText(), setEnv(name) ->
// previous, snapshot() -> state, restore(state) }.
import { poseSkeleton, M4 } from './render.js';
import { Showcase, LOOK, tone8 } from './showcase.js';

// The scene: x right (as the camera sees it), z away from the camera (meters); the item's footprint center goes to
// [x, z], its lowest point to the ground (lift: above it); yaw turns it about the vertical, pitch about the camera's
// left-right, roll about its line of sight (radians, in that order: roll, pitch, then yaw). Helldivers: armor (its
// own helmet), a cape, the weapon held (weapon: a Weapons item's name); pose: a pose's name (or a number: an Armory
// idle), at t seconds into it or tf of its length. layer: back (behind the squad: hazed), squad, front.
export const SCENE = [
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
// the camera (fov: vertical, of the 16:9 frame)
export const CAM = { pitch: -0.05, fov: 0.5, target: [0, 0.78, 0.35], dist: 7.0 };
const ENV = 'game:Armory (menu)';
const RIM = 3;                  // the rim lights' strength
const W23 = 23;                 // (a material LUT's width)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const v3 = {
  sub: (a, b) => a.map((x, k) => x - b[k]), add: (a, b) => a.map((x, k) => x + b[k]), mul: (a, s) => a.map(x => x * s),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: a => Math.hypot(...a),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const pos = m => [m[12], m[13], m[14]];
const m3 = m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
const mul3 = (A, B) => { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return o; };
const app3 = (A, v) => [0, 1, 2].map(r => A[r] * v[0] + A[3 + r] * v[1] + A[6 + r] * v[2]);
// the turn taking direction a to direction b, about point c (4 x 4)
function turnTo(a, b, c) {
  const u = v3.mul(a, 1 / v3.len(a)), w = v3.mul(b, 1 / v3.len(b)), ax = v3.cross(u, w), s = v3.len(ax), co = Math.max(-1, Math.min(1, v3.dot(u, w)));
  if (s < 1e-8) return M4.ident();
  const [x, y, z] = v3.mul(ax, 1 / s), t = 1 - co;
  const R = [t * x * x + co, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + co, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + co, 0, 0, 0, 0, 1];
  const T = p => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
  return M4.mul(T(c), M4.mul(R, T(v3.mul(c, -1))));
}

// does a pose hold the weapon? The Armory's (idles, variations, warbond poses) and the moves do; an emote puts it away
export function holdsWeapon(poses, pose) {
  if (typeof pose === 'number') return true;
  const g = poses.find(p => p.name === pose)?.group;
  return g === 'Armory' || g === 'Moves';
}

// opts: { scene (SCENE), cam (over CAM), weapons: [name|null per Helldiver], poses: [pose per Helldiver], progress(msg) }
export async function buildScene(app, opts = {}) {
  const R = app.R, say = opts.progress ?? (() => { });
  let scene = (opts.scene ?? SCENE).map(it => ({ ...it }));
  const divers = scene.filter(it => it.group === 'Armor');
  (opts.weapons ?? []).forEach((w, i) => { if (divers[i] && w !== undefined) divers[i].weapon = w; });
  (opts.poses ?? []).forEach((p, i) => { if (divers[i] && p !== undefined && p !== '') divers[i].pose = p; });
  const poses = app.poses(), notes = [];
  // the held weapons: an item each, after its Helldiver
  const list = [];
  for (const it of scene) {
    list.push(it);
    if (it.group === 'Armor' && it.weapon) {
      if (holdsWeapon(poses, it.pose)) list.push({ group: 'Weapons', name: it.weapon, layer: it.layer, holder: list.length - 1 });
      else notes.push(`${it.name}: ${it.pose} holds no weapon`);
    }
  }
  scene = list;
  const kits = app.kits(), kitIn = (group, name) => kits.find(k => k.group === group && (k.name === name || k.label.startsWith(name)));
  const state = app.snapshot(), cam = { ...R.cam, target: [...R.cam.target] }, pose = R.pose, rim = R.rim.map(l => ({ ...l }));
  const items = [];   // {n, layer, pieces, pose, rot, shift, posed}
  const loaded = async () => { for (let i = 0; i < 240; i++) { if (/parts\./.test(app.statusText())) return; await sleep(250); } };
  for (const [n, it] of scene.entries()) {
    const kit = kitIn(it.group, it.name);
    if (!kit) { notes.push(`not found: ${it.name}`); continue; }
    say(`Loading ${n + 1} / ${scene.length}: ${it.name}`);
    const keys = [kit.value];
    if (it.cape) { const k = kitIn('Capes', it.cape); if (k) keys.push(k.value); else notes.push(`not found: ${it.cape}`); }
    for (const k of keys) { await app.showItem(k); await loaded(); await sleep(400); }
    const ps = R.pieces; R.pieces = [];   // (kept: the next item's load clears nothing of them)
    if (it.holder !== undefined) { const r = holdWeapon(R, items.find(s => s.n === it.holder), n, it, ps); if (r) items.push(r); continue; }
    let pz = null;
    if (it.pose !== undefined) {
      const idles = poses.filter(p => /armory idle/i.test(p.name));
      const p = typeof it.pose === 'string' ? poses.find(p => p.name === it.pose) : idles[it.pose % Math.max(1, idles.length)];
      if (p) { const clip = await app.clip(p.animation); pz = { clip, time: it.tf !== undefined ? it.tf * clip.length : (it.t ?? 0) % Math.max(clip.length, 1e-3) }; }
      else notes.push(`no pose ${it.pose}`);
    }
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
    for (const p of ps) { p.rot = rot; p.shift = shift; p.pose = p.skin && !p.info?.vehicle ? pz : null; }
    items.push({ n, layer: it.layer, pieces: ps, pose: pz, rot, shift });
  }
  R.pieces = items.flatMap(s => s.pieces); R.pose = null;
  const prevEnv = await app.setEnv(ENV);
  await sleep(500);
  const baseExposure = R.env.exposure, sc = new Showcase(R);
  // the glow behind the squad, the pool of light at its feet (world: x is the scene's mirrored)
  const squad = scene.filter(it => it.group === 'Armor');
  const cx = squad.length ? -squad.reduce((a, it) => a + it.at[0], 0) / squad.length : 0, cz = squad.length ? squad.reduce((a, it) => a + it.at[1], 0) / squad.length : 0;
  sc.anchor = [cx, 1.25, cz + 1.4]; sc.floorC = [cx, 0, cz];
  const camera = () => { const c = { ...CAM, ...opts.cam }; Object.assign(R.cam, { yaw: Math.PI, pitch: c.pitch, fov: c.fov, shiftX: 0, target: [...c.target], dist: c.dist }); };
  camera();
  R.post = sc;
  let n = 0, auto = 1, theme = null;
  const rimLight = () => {
    const lin = hexRGB(sc.look.color || sc.accent).map(c => Math.pow(c / 255, 2.2)), top = Math.max(...lin, 1e-3), I = RIM * sc.look.rim * (0.35 + 0.65 * sc.sat);
    R.rim = [{ on: true, az: 200, el: 22, color: lin.map(c => c / top), intensity: I }, { on: true, az: 160, el: 22, color: lin.map(c => c / top), intensity: I }];
  };
  const out = {
    notes, items, showcase: sc,
    // a theme on the scene: { name, looksFor(zones, rowOf) -> {role: LUT row}, colors: [[role, hex]] }: the items'
    // LUTs, the light's color, the exposure (lowered while the squad's lit parts would clip: a white or pastel theme)
    async setTheme(t) {
      theme = t;
      say('Theming…');
      await themeItems(app, items, t, 'sc' + n++ + ':');
      const pal = palette(t.colors);
      sc.accent = pal.accent; sc.text = pal.text; sc.k = pal.k; sc.sat = pal.sat; sc.titleKey = null;
      rimLight();
      await sleep(200);   // (the LUTs uploaded)
      auto = autoExposure(R, items, baseExposure);
      R.env.exposure = baseExposure * auto * sc.look.exposure;
      say('');
    },
    setLook(look) {
      Object.assign(sc.look, look); sc.titleKey = null;
      rimLight();
      R.env.exposure = baseExposure * auto * sc.look.exposure;
    },
    setText(title, line) { sc.title = title ?? ''; sc.line = line ?? ''; },
    resetCamera: camera,
    exportCanvas: (w = 3840, h = 2160) => sc.exportCanvas(w, h),
    async render(t, size = [3840, 2160]) {
      if (t !== theme) await this.setTheme(t);
      if (t.title !== undefined || t.line !== undefined) this.setText(t.title, t.line);
      return sc.exportCanvas(size[0], size[1]);
    },
    async dispose() {
      R.post = null; sc.dispose();
      R.rim = rim; R.env.exposure = baseExposure;
      Object.assign(R.cam, cam); R.pose = pose;
      R.pieces = items.flatMap(s => s.pieces);   // (freed by the next load)
      await app.setEnv(prevEnv);
      await app.restore(state);
    },
  };
  return out;
}
export { LOOK };

// the exposure (a factor) the squad's lit parts stop clipping at after the tone: its 70th percentile below 236
function autoExposure(R, items, base) {
  const want = items.filter(it => it.layer === 'squad').map(it => it.n);
  let f = 1;
  for (let i = 0; i < 4; i++) {
    R.env.exposure = base * f;
    const px = shot(R, items, want, 480, 270).getContext('2d').getImageData(0, 0, 480, 270).data;
    const hist = new Uint32Array(256); let on = 0;
    for (let j = 0; j < px.length; j += 4) if (px[j + 3] > 200) { on++; hist[tone8(Math.max(px[j], px[j + 1], px[j + 2]))]++; }
    let p70 = 0; for (let v = 0, k = 0; v < 256; v++) { k += hist[v]; if (k >= on * 0.7) { p70 = v; break; } }
    if (!on || p70 < 236) break;
    f *= 0.7;
  }
  return f;
}

// a held weapon put in its Helldiver's hands: the weapon's root on the posed avatar's attach_hand_r (as the game links
// it; the pose moves that node, so a weapon propped or slung goes where the pose puts it); then, when the pose holds
// it two-handed (its hand sockets within 40 cm, or the left hand within 30 cm of this weapon's grip), the left arm bent
// (two-bone IK: shoulder, elbow) so attach_hand_l meets the weapon's IK_left, the hand turned as IK_left; the
// Helldiver's pieces take those bones (pose.world). In the avatar's space, then the Helldiver's turn and place.
function holdWeapon(R, h, n, it, ps) {
  const S = R.avatarSkel;
  if (!h || !S) return null;
  const at = nm => S.names.indexOf(nm);
  h.posed ??= poseSkeleton(S, h.pose?.clip ?? null, h.pose?.time ?? 0);
  const posed = h.posed;
  const wp = ps.find(p => p.skin), wsk = wp?.skin.skel, wb = wsk ? poseSkeleton(wsk, null, 0) : null;
  const wnode = nm => { const i = wsk ? wsk.names.indexOf(nm) : -1; return i < 0 ? null : wb[i]; };
  const root = wnode('root') ?? wnode('StingrayEntityRoot') ?? M4.ident();
  const Mw = M4.mul(posed[at('attach_hand_r')], M4.invert(root));
  const rot = mul3(h.rot, m3(Mw)), shift = v3.add(app3(h.rot, pos(Mw)), h.shift);
  for (const p of ps) { p.rot = rot; p.shift = shift; p.pose = null; }
  const item = { n, layer: it.layer, pieces: ps };
  const ikl = wnode('IK_left');
  if (!ikl) return item;
  const goal = M4.mul(Mw, ikl), iS = at('l_shoulder'), iE = at('l_elbow'), iH = at('l_hand'), iA = at('attach_hand_l');
  const miss = v3.len(v3.sub(pos(posed[iA]), pos(goal))), hands = v3.len(v3.sub(pos(posed[iA]), pos(posed[at('attach_hand_r')])));
  if ((miss > 0.3 && hands > 0.4) || miss < 0.01) return item;
  const kids = new Map(); S.parent.forEach((q, i) => { if (q >= 0) (kids.get(q) ?? kids.set(q, []).get(q)).push(i); });
  const under = i => { const o = [i]; for (let k = 0; k < o.length; k++) o.push(...(kids.get(o[k]) ?? [])); return o; };
  const Wd = posed.slice();
  // the hand where it ends: attach_hand_l on IK_left (its turn too), so l_hand = IK_left * inverse(attach_hand_l's local)
  const localA = M4.mul(M4.invert(Wd[iH]), Wd[iA]), handGoal = M4.mul(goal, M4.invert(localA)), T = pos(handGoal);
  const Sp = pos(Wd[iS]), E = pos(Wd[iE]), Hp = pos(Wd[iH]), a = v3.len(v3.sub(E, Sp)), b = v3.len(v3.sub(Hp, E));
  const toT = v3.sub(T, Sp), d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, v3.len(toT))), u = v3.mul(toT, 1 / v3.len(toT));
  let pole = v3.sub(v3.sub(E, Sp), v3.mul(u, v3.dot(v3.sub(E, Sp), u)));
  if (v3.len(pole) < 1e-5) pole = [0, -1, 0];
  pole = v3.mul(pole, 1 / v3.len(pole));
  const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const E2 = v3.add(Sp, v3.mul(v3.add(v3.mul(u, ca), v3.mul(pole, sa)), a));
  const R1 = turnTo(v3.sub(E, Sp), v3.sub(E2, Sp), Sp);
  for (const i of under(iS)) Wd[i] = M4.mul(R1, Wd[i]);
  const R2 = turnTo(v3.sub(pos(Wd[iH]), E2), v3.sub(T, E2), E2);
  for (const i of under(iE)) Wd[i] = M4.mul(R2, Wd[i]);
  const R3 = M4.mul(handGoal, M4.invert(Wd[iH]));   // (the hand turned as the grip, about the wrist; its fingers with it)
  for (const i of under(iH)) Wd[i] = M4.mul(R3, Wd[i]);
  const world = new Map(); S.names.forEach((nm, i) => { if (nm && !world.has(nm)) world.set(nm, Wd[i]); });
  const key = 'held' + h.n + ':' + (h.pose ? h.pose.clip.animation + '@' + h.pose.time.toFixed(4) : 'bind');
  for (const p of h.pieces) if (p.skin && !p.info?.vehicle) p.pose = { ...(h.pose ?? { clip: null, time: 0 }), key, world };
  return item;
}

// each item's LUTs in the theme (its roles: yours, else built-in, else suggested for the item), under keys of their
// own; patterns and capes' trim lines take the trim look's color
async function themeItems(app, items, theme, tag) {
  const { R, api } = app, S = window.lutstudio.S, roles = await api('/api/roles'), done = new Set();
  for (const it of items) for (const p of it.pieces) { p.sceneKeys ??= { ...p.lutKeys }; Object.assign(p.lutKeys, p.sceneKeys); }
  for (const it of items) {
    const luts = [...new Set(it.pieces.map(p => p.info.lut))].filter(h => S.luts.get(h)?.kind === 'material');
    let sug = {};
    try { sug = await api('/api/roles/suggest?variant=' + encodeURIComponent(S.variant) + '&luts=' + luts.join(',')); } catch { }
    const zones = [];
    for (const h of luts) {
      const l = S.luts.get(h), r = roles.mine[h] ?? roles.builtin[h] ?? sug[h]?.roles ?? [];
      for (let z = 0; z < l.h; z++) zones.push({ h, lut: h, z, role: r[z] ?? 'keep', cov: sug[h]?.coverage?.[z] ?? 0, w: l.w });
    }
    const rowOf = x => { const l = S.luts.get(x.h), a = l.edited ?? l.vanilla; return Array.from(a.slice(x.z * l.w * 4, (x.z + 1) * l.w * 4)); };
    const looks = theme.looksFor(zones, rowOf) ?? {};
    for (const h of luts) {
      if (done.has(h)) continue;
      done.add(h);
      const l = S.luts.get(h), px = (l.edited ?? l.vanilla).slice();
      for (const x of zones) if (x.h === h && looks[x.role] && l.w === W23) putLook(px, l, x.z, looks[x.role], x.role);
      R.setLut(tag + h, l.w, l.h, px);
    }
    for (const p of it.pieces) {
      if (luts.includes(p.info.lut)) p.lutKeys.edited = tag + p.info.lut;
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
}
// (theme.js's, without importing it: theme.js imports this module)
function putLook(px, l, z, look, role) {
  const base = z * l.w * 4, cloth = Math.round(px[base + 3]) === 1 && role !== 'cloth';
  if (!cloth) { for (let i = 0; i < look.length && i < l.w * 4; i++) px[base + i] = look[i]; return; }
  for (const col of [0, 2, 5, 6]) for (let k = 0; k < 3; k++) px[base + col * 4 + k] = look[col * 4 + k];
  if (look[21 * 4 + 3] !== -1) for (let col = 16; col <= 21; col++) for (let k = 0; k < 4; k++) if (col !== 16 || k < 3) px[base + col * 4 + k] = look[col * 4 + k];
}

// ---- the light: a theme's most vivid color (a glow or trim first) at full strength (no washed-out or near-black
// light); a theme without a real color: a quiet steel. accent: the light; text: the title's (light enough to read);
// sat: how colored; k: the backlight's strength
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function palette(colors) {
  const hsl = h => {
    const [r, g, b] = hexRGB(h).map(c => c / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const hue = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, s, l];
  };
  const hex = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  };
  let best = null;
  for (const [role, c] of colors ?? []) {
    const [h, s, l] = hsl(c), score = s * (1 - Math.abs(2 * l - 1) * 0.6) * (role === 'glow' ? 1.4 : role === 'trim' ? 1.15 : 1);
    if (!best || score > best.score) best = { h, s, l, score };
  }
  if (!best || best.s < 0.22 || best.score < 0.12) return { accent: '#8a98a8', text: '#b8c4d0', sat: 0, k: 0.7 };
  const s = Math.min(1, best.s * 1.1);
  return { accent: hex(best.h, s, 0.52), text: hex(best.h, s, 0.68), sat: Math.min(1, best.s), k: 1 };
}

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// some of the scene's items alone (no sky: transparent around them) at w x h -> a 2D canvas
function shot(R, items, want, w, h) {
  const cv = R.gl.canvas, keep = [cv.width, cv.height, R.noSky, R.pieces, R.postInner];
  cv.width = w; cv.height = h; R.noSky = true; R.postInner = true;   // (the plain scene: not through the showcase)
  R.pieces = items.filter(s => want.includes(s.n)).flatMap(s => s.pieces);
  R.draw(0);
  const out = canvas(w, h);
  out.getContext('2d').drawImage(cv, 0, 0);
  [cv.width, cv.height, R.noSky, R.pieces, R.postInner] = keep;
  return out;
}
