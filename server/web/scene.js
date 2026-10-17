// The showcase scene: a theme as key art. Three Helldivers in the Armory's warbond poses holding their weapons, the
// small gear at their feet, an exosuit, an FRV and a beacon behind, in the game's Armory menu lighting with a rim
// light in the theme's color; drawn in layers (behind, the squad, in front) and item by item, then composited on a 2D
// canvas: a glowing disc behind the squad, the back hazed, floor reflections and contact shadows, a glow around the
// squad, embers, bloom, the tone and grain, a vignette and the theme's name. Used by the Theme panel's Showcase image
// and by tools/themescene.mjs (window.lutstudio.scene).
//
// buildScene(app, opts) shows each item in the editor one by one, keeps its pieces and places them (on the ground,
// at its spot, turned; Helldivers posed, weapons in their hands); scene.render(theme, size) draws a theme on it;
// scene.dispose() puts the editor back as it was. app: { R, api, kits() (the item list), poses(), clip(hash),
// showItem(value), statusText(), setEnv(name) -> previous, snapshot() -> state, restore(state) }.
import { poseSkeleton, M4 } from './render.js';

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
// the camera (fov: vertical, of a 16:9 frame)
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
  await sleep(800);
  const baseExposure = R.env.exposure;
  let n = 0;
  return {
    notes, items,
    // a theme drawn on the scene: { title, line (the small one over it), looksFor(zones, rowOf) -> {role: LUT row},
    // colors: [[role, hex]] } at
    // size [w, h] (16:9). Returns a canvas.
    async render(theme, size = [3840, 2160]) {
      say('Theming…');
      await themeItems(app, items, theme, 'sc' + n++ + ':');
      const pal = palette(theme.colors);
      const lin = hexRGB(pal.accent).map(c => Math.pow(c / 255, 2.2)), top = Math.max(...lin, 1e-3), I = RIM * (0.35 + 0.65 * pal.sat);
      R.rim = [{ on: true, az: 200, el: 22, color: lin.map(c => c / top), intensity: I }, { on: true, az: 160, el: 22, color: lin.map(c => c / top), intensity: I }];
      const c = { ...CAM, ...opts.cam };
      R.cam.yaw = Math.PI; R.cam.pitch = c.pitch; R.cam.fov = c.fov; R.cam.shiftX = 0; R.cam.target = [...c.target]; R.cam.dist = c.dist;
      await sleep(300);   // (the LUTs uploaded)
      say('Drawing…');
      const out = compose(R, items, pal, theme.title ?? '', theme.line ?? 'LUT Studio theme', size, baseExposure);
      R.env.exposure = baseExposure;
      return out;
    },
    async dispose() {
      R.rim = rim; R.env.exposure = baseExposure;
      Object.assign(R.cam, cam); R.pose = pose;
      R.pieces = items.flatMap(s => s.pieces);   // (freed by the next load)
      await app.setEnv(prevEnv);
      await app.restore(state);
    },
  };
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

// the tone: a gentle S-curve, then the midtones lifted (as tools/themescene.mjs had it from ImageMagick:
// -sigmoidal-contrast 1.8x40%, then a 50% grey soft-lit over it), 8-bit in, 8-bit out
const TONE = Uint8Array.from([0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 125, 127, 129, 131, 133, 135, 137, 139, 141, 144, 146, 148, 150, 152, 154, 156, 158, 161, 163, 165, 167, 169, 171, 173, 175, 178, 180, 182, 184, 186, 188, 190, 193, 195, 197, 199, 201, 203, 206, 208, 210, 212, 214, 216, 218, 221, 223, 225, 227, 229, 231, 233, 236, 238, 240, 242, 244, 246, 248, 251, 253]);
const tone = v => (v < TONE.length ? TONE[v] : 255);
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// some of the scene's items alone (no sky: transparent around them) at w x h -> a 2D canvas
function shot(R, items, want, w, h) {
  const cv = R.gl.canvas, keep = [cv.width, cv.height, R.noSky, R.pieces];
  cv.width = w; cv.height = h; R.noSky = true;
  R.pieces = items.filter(s => want.includes(s.n)).flatMap(s => s.pieces);
  R.draw(0);
  const out = canvas(w, h);
  out.getContext('2d').drawImage(cv, 0, 0);
  [cv.width, cv.height, R.noSky, R.pieces] = keep;
  return out;
}
// an item's outline: its box and its footprint (the span of its lowest rows), or null
function extent(px, w, h) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  let f0 = w, f1 = -1;
  for (let y = Math.max(y0, y1 - Math.max(2, Math.round((y1 - y0) * 0.04))); y <= y1; y++) for (let x = x0; x <= x1; x++) if (px[(y * w + x) * 4 + 3] > 24) { f0 = Math.min(f0, x); f1 = Math.max(f1, x); }
  return { x0, x1, y0, y1, f0, f1 };
}
// a disc blurred by sigma, as a radial gradient (alpha: its strength)
function softDisc(ctx, x, y, r, sigma, color, alpha) {
  const [cr, cg, cb] = hexRGB(color), far = r + 3 * sigma, g = ctx.createRadialGradient(0, 0, 0, 0, 0, far);
  const erfc = z => { const t = 1 / (1 + 0.5 * Math.abs(z)), e = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return z >= 0 ? e : 2 - e; };
  for (let i = 0; i <= 16; i++) { const d = far * i / 16, a = alpha * 0.5 * erfc((d - r) / (sigma * Math.SQRT2)); g.addColorStop(i / 16, `rgba(${cr},${cg},${cb},${Math.max(0, Math.min(1, a)).toFixed(4)})`); }
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = g; ctx.fillRect(-far, -far, 2 * far, 2 * far); ctx.restore();
}

// the composite (see the top), at size [W, H]
function compose(R, items, pal, title, line, [W, H], baseExposure) {
  const s = W / 2560, accent = pal.accent, k = pal.k, [ar, ag, ab] = hexRGB(accent);
  const inLayer = L => items.filter(it => it.layer === L).map(it => it.n);
  const hw = Math.round(W / 2), hh = Math.round(H / 2);   // (items alone, for reflections and shadows: half size)
  // exposure: lowered while the squad's lit parts clip after the tone (a white or pastel theme washes out to flat white)
  let exp = baseExposure;
  for (let i = 0; i < 4; i++) {
    R.env.exposure = exp;
    const px = shot(R, items, inLayer('squad'), hw, hh).getContext('2d').getImageData(0, 0, hw, hh).data;
    const hist = new Uint32Array(256); let on = 0;
    for (let j = 0; j < px.length; j += 4) if (px[j + 3] > 200) { on++; hist[tone(Math.max(px[j], px[j + 1], px[j + 2]))]++; }
    let p70 = 0; for (let v = 0, n = 0; v < 256; v++) { n += hist[v]; if (n >= on * 0.7) { p70 = v; break; } }
    if (!on || p70 < 236) break;
    exp *= 0.7;
  }
  const layer = {};
  for (const L of ['back', 'squad', 'front']) layer[L] = shot(R, items, inLayer(L), W, H);
  // each item: its reflection on the floor (mirrored at its lowest row, fading) and its contact shadow
  const refl = { back: new ImageData(hw, hh), fore: new ImageData(hw, hh) }, shadows = [];
  let floor = 0;
  for (const it of items) {
    const px = shot(R, items, [it.n], hw, hh).getContext('2d').getImageData(0, 0, hw, hh).data, e = extent(px, hw, hh);
    if (!e) continue;
    if (it.layer === 'squad') floor = Math.max(floor, e.y1 * 2);
    const out = (it.layer === 'back' ? refl.back : refl.fore).data, D = Math.round((e.y1 - e.y0) * 0.45), strength = it.layer === 'back' ? 0.18 : 0.3;
    for (let r = 1; r <= D && e.y1 + r < hh; r++) {
      const src = e.y1 - r; if (src < 0) break;
      const fade = strength * Math.pow(1 - r / D, 1.6);
      for (let x = e.x0; x <= e.x1; x++) {
        const si = (src * hw + x) * 4, di = ((e.y1 + r) * hw + x) * 4, a = px[si + 3] / 255 * fade;
        if (a <= 0) continue;
        const da = out[di + 3] / 255, oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) out[di + c] = Math.round((px[si + c] * a + out[di + c] * da * (1 - a)) / oa);
        out[di + 3] = Math.round(255 * oa);
      }
    }
    const rx = Math.max(10, (e.f1 - e.f0) / 2 * 1.25) * 2;
    shadows.push([(e.f0 + e.f1), e.y1 * 2, rx, rx * 0.16 + 6 * s]);
  }
  floor ||= Math.round(H * 0.8);
  const reflCanvas = d => { const c = canvas(hw, hh); c.getContext('2d').putImageData(d, 0, 0); return c; };
  const out = canvas(W, H), ctx = out.getContext('2d');
  const over = (img, blur = 0, alpha = 1, op = 'source-over') => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op; if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(img, 0, 0, W, H); ctx.restore();
  };
  ctx.fillStyle = '#060709'; ctx.fillRect(0, 0, W, H);
  // the light behind: a wide soft glow, a brighter core, a hot center; a faint pool of light on the floor
  const cx = W / 2, cy = H * 0.4;
  softDisc(ctx, cx, cy, H * 0.55, 160 * s, accent, 0.32 * k);
  softDisc(ctx, cx, cy, H * 0.3, 70 * s, accent, 0.8 * k);
  softDisc(ctx, cx, cy, H * 0.15, 80 * s, '#ffffff', 0.45 * k * k);
  { // (an ellipse blurred alike both ways: drawn small, blurred, scaled up)
    const q = 4, c = canvas(W / q, H / q), g = c.getContext('2d');
    g.filter = `blur(${60 * s / q}px)`; g.fillStyle = accent; g.globalAlpha = 0.35;
    g.beginPath(); g.ellipse(cx / q, floor / q, W * 0.42 / q, H * 0.07 / q, 0, 0, Math.PI * 2); g.fill();
    ctx.drawImage(c, 0, 0, W, H);
  }
  // embers: big soft bokeh, later small sharp sparks, rising in the light (the same for a title every time)
  const rand = rng([...title].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
  const sparks = [], bokeh = [];
  for (let i = 0; i < 140; i++) {
    const x = rand() * W, y = Math.pow(rand(), 0.8) * floor, r = (0.8 + rand() * 2.6) * s, a = 0.25 + rand() * 0.7;
    sparks.push([x, y, r, a, rand() < 0.3 ? '#fff0dc' : '#' + [ar, ag, ab].map(c => Math.min(255, Math.round(c * 1.25 + 30)).toString(16).padStart(2, '0')).join('')]);
  }
  for (let i = 0; i < 26; i++) bokeh.push([rand() * W, rand() * floor * 0.9, (10 + rand() * 34) * s, 0.05 + rand() * 0.12]);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const [x, y, r, a] of bokeh) softDisc(ctx, x, y, r, 8 * s, accent, a);
  ctx.restore();
  // the back: its reflection, then it, hazed into the light and a little soft; fog over its feet
  over(reflCanvas(refl.back), 4 * s);
  { const c = canvas(W, H), g = c.getContext('2d'); g.drawImage(layer.back, 0, 0); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.12; g.fillStyle = accent; g.fillRect(0, 0, W, H); over(c, 1.6 * s); }
  {
    const top = floor - H * 0.12, bot = floor + H * 0.03, sg = 70 * s, g = ctx.createLinearGradient(0, top - 2 * sg, 0, bot + 2 * sg);
    const span = bot - top + 4 * sg;
    for (let i = 0; i <= 12; i++) {
      const y = top - 2 * sg + span * i / 12, inside = Math.min(1, Math.max(0, (Math.min(y - top, bot - y) / sg + 1) / 2));
      g.addColorStop(i / 12, `rgba(${ar},${ag},${ab},${(0.16 * inside).toFixed(4)})`);
    }
    ctx.fillStyle = g; ctx.fillRect(0, top - 2 * sg, W, span);
  }
  // contact shadows, the squad's and the gear's reflections, a glow around the squad (the light bleeding past it)
  { const c = canvas(W, H), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.85)'; for (const [x, y, rx, ry] of shadows) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); } over(c, 10 * s); }
  over(reflCanvas(refl.fore), 3 * s);
  {
    const q = 4, c = canvas(W / q, H / q), g = c.getContext('2d');
    g.filter = `blur(${28 * s / q}px)`; g.drawImage(layer.squad, 0, 0, W / q, H / q); g.filter = 'none';
    g.globalCompositeOperation = 'source-in'; g.fillStyle = accent; g.fillRect(0, 0, W / q, H / q);
    over(c, 0, 0.45 * k, 'screen');
  }
  over(layer.squad); over(layer.front);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.filter = `blur(${0.7 * s}px)`;
  for (const [x, y, r, a, c] of sparks) { ctx.globalAlpha = a; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // bloom: the bright parts (70-100%), blurred, at 45%, screened (small: a quarter size)
  {
    const q = 4, w = W / q, h = H / q, c = canvas(w, h), g = c.getContext('2d');
    g.drawImage(out, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) for (let c2 = 0; c2 < 3; c2++) p[i + c2] = Math.max(0, (p[i + c2] - 178.5) / 76.5) * 255 * 0.45;
    g.putImageData(d, 0, 0);
    const b = canvas(w, h), bg = b.getContext('2d'); bg.filter = `blur(${22 * s / q}px)`; bg.drawImage(c, 0, 0);
    over(b, 0, 1, 'screen');
  }
  // the tone, grain, the vignette (to 20% at the sides: a circle of half the width)
  {
    const d = ctx.getImageData(0, 0, W, H), p = d.data, r0 = W / 2, grain = rng(7);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const v = 1 - 0.8 * Math.min(1, Math.hypot(x - W / 2, y - H / 2) / r0);
      const n = (grain() + grain() + grain() - 1.5) * 2;   // (about a unit normal)
      for (let c = 0; c < 3; c++) { const t = tone(p[i + c]); p[i + c] = Math.max(0, Math.min(255, (t + n * (1 + 0.014 * t)) * v)); }
    }
    ctx.putImageData(d, 0, 0);
  }
  // the title (the theme's name), glowing, and a small line over it; either may be empty
  if (title || line) {
    const font = (px) => `bold ${px}px "Agency FB", "Bahnschrift Condensed", "Bahnschrift", "Arial Narrow", sans-serif`;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const y = H - H * 0.035 - 6 * s;
    ctx.font = font(Math.round(110 * s)); ctx.letterSpacing = `${Math.round(22 * s)}px`;
    ctx.shadowColor = accent; ctx.shadowBlur = 28 * s; ctx.fillStyle = '#f4f1ea';
    if (title) { ctx.fillText(title.toUpperCase(), W / 2, y); ctx.fillText(title.toUpperCase(), W / 2, y); }
    ctx.shadowBlur = 0; ctx.font = font(Math.round(28 * s)); ctx.letterSpacing = `${Math.round(10 * s)}px`; ctx.fillStyle = pal.text;
    if (line) ctx.fillText(line.toUpperCase(), W / 2, title ? y - 122 * s : y);
    ctx.restore();
  }
  return out;
}
