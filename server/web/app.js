// LUT Studio editor UI. Talks to the API (server.go, in a worker: bridge.js); renders with render.js.
import { SLOT_ORDER, slotList, vehicleMount } from './helpers.js';
import { buildScene, SCENE, holdsWeapon, holdWeapon } from './scene.js';
import { openShowcase } from './showcaseui.js';
import { Renderer, parseGLB, extractPieces, DEBUG_VIEWS, WORLD, decalNumbers, prepareClip, skeletonOf, nodeWorld, transformPrim, mountMatrix } from './render.js';
import { importLooks } from './presets.js';
import { looksPanel } from './looks.js';
import { showHome } from './home.js';
import { decalDialog } from './decals.js';
import { designDialog } from './designs.js';
import { maskDialog } from './masks.js';
import { rolesDialog } from './roles.js';
import { themeDialog } from './theme.js';
import { track, trackErrors } from './analytics.js';
import { modPage } from './modpage.js';
import { closeSide } from './texedit.js';
import { groundTile } from './planet.js';
import { buildScenery } from './planetscene.js';

const $ = id => document.getElementById(id);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url}: ${await r.text()}`);
  return r.headers.get('Content-Type')?.includes('json') ? r.json() : r;
};
const status = (msg, err = false) => { const s = $('status'); s.textContent = msg; s.classList.toggle('err', err); };

// Lighting presets: LUT Studio's own approximations (sky gradient + sun). The game's baked environments
// (/api/envs) are added to the list as "game:<name>".
const ENVS = {
  'Studio': { sun: [1, 0.97, 0.92], sunIntensity: 2.6, sunElev: Math.PI / 4, zenith: [0.55, 0.57, 0.62], horizon: [0.42, 0.43, 0.46], ground: [0.16, 0.16, 0.17], exposure: 1.0 },
  'Armory': { sun: [1, 0.9, 0.78], sunIntensity: 2.8, sunElev: 0.55, zenith: [0.12, 0.16, 0.24], horizon: [0.2, 0.22, 0.27], ground: [0.06, 0.06, 0.07], exposure: 1.25 },
  'Desert noon': { sun: [1, 0.93, 0.8], sunIntensity: 5.0, sunElev: 1.2, zenith: [0.35, 0.55, 0.9], horizon: [0.75, 0.72, 0.65], ground: [0.55, 0.42, 0.28], exposure: 0.8 },
  'Overcast': { sun: [0.9, 0.92, 1], sunIntensity: 0.5, sunElev: 1.1, zenith: [0.75, 0.77, 0.8], horizon: [0.62, 0.63, 0.65], ground: [0.22, 0.23, 0.22], exposure: 1.1 },
  'Snow': { sun: [0.95, 0.97, 1], sunIntensity: 3.2, sunElev: 0.45, zenith: [0.45, 0.58, 0.85], horizon: [0.8, 0.84, 0.9], ground: [0.85, 0.88, 0.92], exposure: 0.85 },
  'Jungle': { sun: [0.95, 1, 0.82], sunIntensity: 2.2, sunElev: 0.9, zenith: [0.3, 0.42, 0.33], horizon: [0.32, 0.4, 0.28], ground: [0.12, 0.17, 0.08], exposure: 1.2 },
  'Sunset backlight': { sun: [1, 0.6, 0.35], sunIntensity: 3.5, sunElev: 0.12, zenith: [0.25, 0.3, 0.5], horizon: [0.9, 0.55, 0.35], ground: [0.12, 0.09, 0.08], exposure: 1.1, sunAz: 180 },
  'Night (flashlight)': { sun: [0.6, 0.7, 1], sunIntensity: 0.15, sunElev: 0.9, zenith: [0.02, 0.03, 0.06], horizon: [0.04, 0.05, 0.08], ground: [0.02, 0.02, 0.025], exposure: 1.4, flashlight: true },
};

// the zone roles review (Roles…): for the one reviewing the built-in roles, not every user: ?review turns it on
// (remembered in this browser), ?review=0 off
const REVIEW = (() => {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has('review')) localStorage.setItem('lutstudio.review', q.get('review') === '0' ? '0' : '1');
    return localStorage.getItem('lutstudio.review') === '1';
  } catch { return q.has('review') && q.get('review') !== '0'; }
})();

const S = {
  schema: null, state: null, variant: null, kit: null, body: 'slim',
  luts: new Map(),       // hash -> {w, h, kind, vanilla, edited|null, labels, note, dirty}
  sel: { lut: null, zone: 0 },
  undo: [], redo: [], lastSnap: 0, saving: null, clip: null, loadGen: 0, varGen: 0,
};
let R;

const editedKey = h => (S.luts.get(h)?.edited ? 'e:' + h : 'v:' + h);
const cell = (l, zone, col, ch) => (zone * l.w + col) * 4 + ch;
const hex = v => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0');
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(1) : +v.toFixed(4)).toString();

async function init() {
  R = new Renderer($('canvas'));
  // for headless checks (tools/headless.mjs) and the theme scene (tools/themescene.mjs: items shown one by one, then
  // drawn together)
  window.lutstudio = { R, S, showItem: k => showItem(k), api: (...a) => api(...a), poses: () => POSE.list, clip: loadClip,
    scene: { buildScene, SCENE, app: () => sceneApp() } };
  [S.schema, S.state] = await Promise.all([api('/api/schema'), api('/api/state')]);
  $('projName').textContent = S.state.project.name;
  const own = document.createElement('optgroup'); own.label = 'LUT Studio presets';
  for (const name of Object.keys(ENVS)) own.append(new Option(name, name));
  $('env').append(own);
  $('env').value = 'Studio';
  await loadGameEnvs();
  await loadPlanets();
  // the default light: the game's Armory menu (as the game shows the armor), else LUT Studio's Studio
  if ([...$('env').options].some(o => o.value === 'game:Armory (menu)')) $('env').value = 'game:Armory (menu)';
  S.lightsInit = true;   // (lightsFor, once the Adjust menu's controls are wired)
  for (const [name, v] of DEBUG_VIEWS) $('debugView').add(new Option(name, v));
  setEnv(); showSunElev();
  fillVariants();
  fillKits();
  S.variant = S.state.variants[0].folder;
  status('Loading shared textures…');
  await R.loadShared();
  await loadVariant(S.variant);
  await loadCharacterMenus();
  // the project's first item: an item of OTHER_TYPES (vehicle, weapon, gear…) on its own, else the Helldiver with the
  // project's armor, helmet and cape
  const first = S.state.kits[0];
  if (!first) status('No kit uses the LUTs of this project (pull LUTs with: lutstudio pull)');
  else if (isOther(first)) { S.mode = 'other'; await loadKit(first); }
  else { initialLook(); await loadCharacter(); }
  wire();
  loop();
}

function fillVariants() {
  const sel = $('variant');
  sel.innerHTML = '';
  for (const v of S.state.variants) sel.add(new Option(v.name, v.folder));
  sel.value = S.variant ?? S.state.variants[0].folder;
}

// Game environments: per environment, the exposure that matches the in-game look about as well as the presets do,
// and the background blur (the cubes are baked probes: sharp at mip 0, a soft backdrop above).
// key: the key light's strength (it comes from the environment's brightest spot, in that spot's color).
// Two other game light rigs: the warbond showroom
// levels' light rig (5 spots, positions from the feet: the game's (x, y, z) as (-x, z, y) here, the front toward -Z;
// spot cones 0.958 rad, falloff start 0; aimed at the chest: the game's axes point within 2-17 deg of it) in a black
// box, and the ship_hub customization chamber's omni light 1.95 m above its center. Exposure: the ship_hub's 4.5; the
// showroom world's isn't in its levels (1.25: the default environment's).
const ARMORY_RIG = {
  showroom: [
    { pos: [3.50, 1.73, -3.27], color: [1, 1, 1], intensity: 60, end: 6.778, cone: 0.9582 },          // key, front-left
    { pos: [-1.91, -0.64, -1.80], color: [1, 0.824, 0.651], intensity: 66.434, end: 4.8, cone: 0.9582 }, // warm fill, low right
    { pos: [-3.25, 1.73, -2.20], color: [1, 1, 1], intensity: 100, end: 6.778, cone: 0.9582 },        // front-right
    { pos: [-3.49, 1.69, 4.38], color: [1, 1, 1], intensity: 1000, end: 6.778, cone: 0.9582 },        // rim, back-right
    { pos: [3.24, 3.77, 3.75], color: [1, 1, 1], intensity: 1000, end: 6.778, cone: 0.9582 },         // rim, back-left, high
  ].map(l => ({ ...l, aim: [0, 1.2, 0] })),
  chamber: [{ pos: [-0.1, 1.95, 0], aim: [0, 0, 0], color: [1, 1, 1], intensity: 10, end: 10, cone: 0 }],
};
// The Armory menu (game.dll's 3D UI light setup, the preset 8 of its 10 slots use; directions toward the light, for
// the camera in front; locked to the camera; colors as the CPU copies them), its ambient (the specular cube's last mip
// x 10), reflections (x 5), no exposure, the ACES fit, and its output taken as the sRGB value (the UI target is
// composited as sRGB without an encode: rawOut).
const ARMORY_MENU = [
  { dir: [-0.7326, 0.6410, -0.2289], color: [9.000, 7.059, 5.859] },     // key, warm, front-left above
  { dir: [0.5488, 0.3293, 0.7683], color: [13.020, 15.686, 20.000] },    // rim, cool, behind on the right
  { dir: [0.3310, 0.7448, -0.5793], color: [2.471, 2.882, 3.500] },      // fill, cool, dim
  { dir: [-0.2400, -0.9600, -0.1440], color: [4.500, 2.647, 1.765] },    // bounce, warm, from below
];
const GAME_ENV_LOOK = {
  // (backdrop: the blurred ship frame behind the menu, measured on a screenshot: a neutral grey, sRGB ~0.26 at the left
  // to ~0.06 at the right)
  'Armory (menu)': { exposure: 1, key: 0, bgBlur: 5, dirLights: ARMORY_MENU, uiAmbient: 10, specScale: 5, rawOut: true, backdropGrad: [0.26, 0.06] },
  'Warbond reward showroom': { exposure: 1.25, bgBlur: 1.5, key: 0, lights: ARMORY_RIG.showroom, backdrop: 'black' },
  'Ship customization chamber': { exposure: 4.5, bgBlur: 0.5, key: 0, lights: ARMORY_RIG.chamber },
  'Super Destroyer hub': { exposure: 1.4, bgBlur: 0.5, key: 2 },
  'Super Destroyer interior': { exposure: 0.8, bgBlur: 0.5, key: 2 },
  'Desert planet (day)': { exposure: 0.7, bgBlur: 0.3, key: 4.5 },
  'Space': { exposure: 2.2, bgBlur: 0, key: 2 },
};
S.gameEnvs = [];
async function loadGameEnvs() {
  try { S.gameEnvs = await api('/api/envs'); } catch (e) { S.gameEnvs = []; }
  if (!S.gameEnvs.length) return;
  const g = document.createElement('optgroup'); g.label = 'From the game';
  for (const e of S.gameEnvs) g.append(new Option(e.name, 'game:' + e.name));
  $('env').append(g);
}

// planet lighting (planets/planets.json, from the game's environment settings): per planet biome its sun's color,
// its auto exposure's target, its ground (the terrain layers' graded albedo, linear; snow) and its day grading with
// the game's SDR output (planets/<id>.png, R.loadGrade). The game exposes the frame to put its mean luminance at the
// target: here the ground's mean, lit by the sun and the sky, is put there; the sky is LUT Studio's (the game's is
// computed at run time), tinted toward the planet's fog
S.planets = [];
const gradeCache = new Map();   // planet id -> promise of {tex, n}
const groundCache = new Map();  // planet id -> promise of its ground tile (planet.js)
const sceneryCache = new Map(); // planet id -> promise of its scene (planetscene.js)
async function loadPlanets() {
  try { S.planets = (await (await fetch('planets/planets.json')).json()).planets; } catch { S.planets = []; }
  if (!S.planets.length) return;
  const g = document.createElement('optgroup'); g.label = 'Planets (the game\'s light)';
  for (const p of S.planets) g.append(new Option(p.name, 'planet:' + p.id));
  $('env').append(g);
}
const lum709 = c => 0.2127 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixN = (a, b, t) => a + (b - a) * t;
// the Weather menu (shown with a planet's light): its weathers, the day default first chosen; a weather sets the
// armor's wetness and snow as the game's weather does (the Mission wear sliders follow)
function fillWeather(p) {
  const sel = $('weather');
  sel.hidden = !p?.weathers?.length;
  if (sel.hidden) return null;
  if (sel.dataset.planet !== p.id) {
    sel.dataset.planet = p.id;
    sel.innerHTML = p.weathers.map((w, i) => `<option value="${i}">${w.label}${w.share ? ' (' + Math.round(w.share * 100) + '%)' : ''}</option>`).join('');
    sel.value = String(Math.max(0, p.weathers.findIndex(w => w.default)));
  }
  return p.weathers[+sel.value] ?? null;
}
function weatherWear(w) {
  for (const [key, v] of [['wet', w?.wet ?? 0], ['snow', w?.snow ?? 0]]) {
    R.world[key] = v;
    const i = document.querySelector(`#worldSliders input[data-key="${key}"]`); if (i) i.value = v;
  }
}
// the ground's mean albedo (linear): its layers, snow (where it has some) counting as much as all of them
function planetGround(p) {
  const L = p.ground.map(l => l.albedo), m = [0, 1, 2].map(k => L.reduce((s, a) => s + a[k], 0) / Math.max(L.length, 1));
  return p.snow ? m.map((v, k) => 0.5 * v + 0.5 * p.snow[k]) : m;
}
// w: one of the planet's weathers (null: its day default): its sun, sky light, fog; thick fog greys the sky toward the
// fog's color and brings the horizon in (fogDist: where the ground has faded into it, m)
function planetEnv(p, w = null) {
  w ??= p.weathers?.find(x => x.default) ?? null;
  const sun = w ? w.sun : p.sun, fog = w ? w.fog : p.fog, ambT = w ? w.ambient : p.ambientTint.map(t => t * (p.ambient ?? 1));
  const amb = 0.55, sunI = 3, elev = Math.PI / 4, thick = Math.min(0.85, (w?.fogDensity ?? 0.5) / 3);
  const horizon = fog.map((c, k) => c * amb * ambT[k]);
  const zenith = fog.map((c, k) => (mixN(0.6 * c + 0.4 * [0.35, 0.5, 0.8][k], c, thick)) * amb * 0.8 * ambT[k]);
  const gnd = planetGround(p);
  // a level surface's light, as the shader lights it (shaders.js: the sun's diffuse over pi, the sky's hemisphere)
  const E = sunI * Math.sin(elev) * lum709(sun) / Math.PI + lum709(zenith.map((z, k) => 0.6 * z + 0.4 * horizon[k]));
  const e = { ...ENVS['Studio'], sun, sunIntensity: sunI, sunElev: elev, zenith, horizon,
    ground: gnd.map(v => v * E), exposure: p.exposureTarget / Math.max(lum709(gnd) * E, 1e-4), planet: p, weather: w, grade: {},
    fogDist: Math.min(150, Math.max(15, 60 / Math.max(w?.fogDensity ?? 0.5, 0.3))) };
  if (!gradeCache.has(p.id)) gradeCache.set(p.id, R.loadGrade('planets/' + p.id + '.png'));
  gradeCache.get(p.id).then(t => { e.grade.tex = t.tex; }).catch(err => status('Planet light: ' + err.message, true));
  if (!groundCache.has(p.id)) groundCache.set(p.id, groundTile(p));
  groundCache.get(p.id).then(t => { e.groundTile = t; }).catch(() => { });
  if (!sceneryCache.has(p.id)) sceneryCache.set(p.id, buildScenery(R, p, async h => parseGLB(await (await api('/api/unit?hash=' + h)).arrayBuffer()),
    async t => parseGLB(await (await api('/api/speedtree?hash=' + encodeURIComponent(t))).arrayBuffer())));
  sceneryCache.get(p.id).then(s => { e.scenery = s; }).catch(err => console.warn('scenery', err));
  // (all of it in place: for a picture taken right after the switch)
  e.ready = Promise.allSettled([gradeCache.get(p.id), groundCache.get(p.id), sceneryCache.get(p.id)]).then(() => new Promise(r => setTimeout(r, 50)));
  return e;
}

// the Adjust menu's lights for a lighting: a planet's: its sun, no side lights; the Armory menu's: the side lights,
// no sun (the menu's own rig is its key)
function lightsFor(v) {
  const set = (sun, rims) => {
    R.sunOn = sun; $('sunOn').checked = sun;
    R.rim.forEach((l, i) => { l.on = rims; $('rim' + i).checked = rims; });
  };
  if (v.startsWith('planet:')) set(true, false);
  else if (v === 'game:Armory (menu)') set(false, true);
}

function setEnv() {
  const v = $('env').value, ge = v.startsWith('game:') ? S.gameEnvs.find(e => 'game:' + e.name === v) : null;
  const pl = v.startsWith('planet:') ? S.planets.find(p => 'planet:' + p.id === v) : null;
  const w = fillWeather(pl);
  const e = pl ? planetEnv(pl, w) : ge ? { ...ENVS['Studio'], sunIntensity: 0, ...GAME_ENV_LOOK[ge.name], game: ge } : { ...ENVS[v] };
  if (pl && R.env?.weather !== w) weatherWear(w);
  const az = e.sunAz ?? +$('sunAz').value;
  if (e.sunAz !== undefined) $('sunAz').value = e.sunAz;
  e.sunAz = az * Math.PI / 180;
  e.exposure *= Math.pow(2, +$('exposure').value);
  if (ge) {                              // the Sun slider turns the environment (and its sun); at its default
    e.envRot = e.sunAz - 145 * Math.PI / 180;   // (180: the sun from the front) as it was matched (35)
    const old = R.env?.game === ge ? R.env.cubeTex : null;
    if (old) placeEnv(e, old);
    else R.loadCube(ge.specular, ge.diffuse ?? '').then(t => { if (R.env === e) placeEnv(e, t); })
      .catch(err => status('Lighting: ' + err.message, true));
  }
  R.env = e;
}
// the cube is loaded: use it, and put the key light where the bake is brightest (turned with the environment)
function placeEnv(e, t) {
  e.cubeTex = t;
  e.sun = t.key.color; e.sunIntensity = e.key ?? 0;
  const [x, y, z] = t.key.dir, c = Math.cos(e.envRot), s = Math.sin(e.envRot);
  const w = [c * x - s * z, y, s * x + c * z];
  e.sunElev = Math.asin(Math.max(-1, Math.min(1, w[1])));
  e.sunAzLight = Math.atan2(w[0], w[2]);
  showSunElev();
}
// the Sun height slider shows the lighting's own sun height until the user moves it
function showSunElev() {
  if (R.sunElevUser === null && R.env?.sunElev !== undefined) $('sunEl').value = Math.round(R.env.sunElev * 180 / Math.PI);
}

// ---------- data
async function loadVanilla(hash) {
  let l = S.luts.get(hash);
  if (l?.vanilla) return l;
  const v = await api('/api/vanilla?lut=' + hash);
  l = l ?? { edited: null, labels: [], note: '', dirty: false };
  Object.assign(l, { w: v.w, h: v.h, kind: v.kind, vanilla: new Float32Array(v.px) });
  S.luts.set(hash, l);
  R.setLut('v:' + hash, l.w, l.h, l.vanilla);
  return l;
}

async function loadVariant(folder) {
  const gen = ++S.varGen;      // (a newer switch wins: an older one's answers are dropped)
  S.variant = folder;
  R.variant = folder;          // the variant's own decal sheets (render.js loadTexture)
  const decals = R.pieces.length ? R.refreshDecals() : null;
  S.undo = []; S.redo = [];
  for (const l of S.luts.values()) { l.edited = null; l.dirty = false; }
  const v = S.state.variants.find(x => x.folder === folder);
  if (v.problems?.length) showModal('Problems in this variant', v.problems.join('\n\n'));
  // every LUT of the variant and its game values in one request (an overhaul has hundreds)
  let all = { docs: {}, vanilla: {} };
  try { all = await api('/api/variantdata?variant=' + encodeURIComponent(folder)); } catch (e) { status(e.message, true); }
  if (gen !== S.varGen) return;
  for (const info of v.luts ?? []) {
    const van = all.vanilla[info.lut], d = all.docs[info.lut];
    let l = S.luts.get(info.lut);
    if (!l?.vanilla && van) {
      l = l ?? { edited: null, labels: [], note: '', dirty: false };
      Object.assign(l, { w: van.w, h: van.h, kind: van.kind, vanilla: new Float32Array(van.px) });
      S.luts.set(info.lut, l);
      R.setLut('v:' + info.lut, l.w, l.h, l.vanilla);
    }
    if (!l) l = await loadVanilla(info.lut).catch(e => (status(e.message, true), null));
    if (gen !== S.varGen) return;
    if (!l || !d) continue;
    Object.assign(l, { edited: new Float32Array(d.px), labels: d.labels ?? [], note: d.note ?? '' });
    R.setLut('e:' + info.lut, l.w, l.h, l.edited);
  }
  for (const p of R.pieces) {
    p.lutKeys.edited = editedKey(p.info.lut);
    if (p.info.cape) p.lutKeys.cape = editedKey(p.info.cape);
    if (p.info.pattern) p.lutKeys.pattern = editedKey(p.info.pattern);
  }
  if (!S.sel.lut || !S.luts.get(S.sel.lut)?.edited) S.sel.lut = v.luts?.[0]?.lut ?? null;
  if (S.sel.lut) S.sel.zone = Math.min(S.sel.zone, (S.luts.get(S.sel.lut)?.h ?? 1) - 1);
  renderLists();
  renderFields();
}

// The Item dropdown. The project's own items: the fewest kits (in /api/state's order, most of the project's LUTs
// first) that together use every LUT of the project. The others only share some LUTs with them, so a change shows on
// them too: listed under "Also changed by this mod", with what they share.
function fillKits() {
  const sel = $('kit'), keep = sel.value || S.kit;
  sel.innerHTML = '';
  const luts = new Set(S.state.variants.flatMap(v => (v.luts ?? []).map(l => l.lut)));
  const uses = k => [...luts].filter(h => (S.state.parts?.[h] ?? []).some(p => p.key === k));
  const own = [], covered = new Set();
  for (const k of S.state.kits) {
    const u = uses(k);
    if (own.length && u.every(h => covered.has(h))) continue;
    own.push(k); u.forEach(h => covered.add(h));
  }
  const g1 = document.createElement('optgroup'); g1.label = own.length > 1 ? 'This mod' : 'This mod\'s item';
  own.forEach(k => g1.append(new Option(kitLabel(k), k)));
  sel.append(g1);
  const others = S.state.kits.filter(k => !own.includes(k));
  // a LUT many armors use (B-01's pattern: 48+) would list them all: those armors are one summary line instead
  const wide = h => new Set((S.state.parts?.[h] ?? []).map(p => p.key)).size > 10;
  const listed = others.filter(k => !uses(k).every(wide)), summed = others.filter(k => uses(k).every(wide));
  if (others.length) {
    const g2 = document.createElement('optgroup'); g2.label = 'Also changed by this mod (shares LUTs)';
    for (const k of listed) {
      const what = [...new Set(uses(k).map(h => describeLut(h, S.luts.get(h)?.kind).badge.toLowerCase()))];
      g2.append(new Option(`${kitLabel(k)}: shares the ${what.join(' + ')}`, k));
    }
    if (summed.length) {
      const what = [...new Set(summed.flatMap(uses).map(h => describeLut(h, S.luts.get(h)?.kind).badge.toLowerCase()))];
      const o = new Option(`… and ${summed.length} more items that share the ${what.join(' + ')} (hover that LUT for the list)`, '');
      o.disabled = true;
      g2.append(o);
    }
    sel.append(g2);
  }
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}

// kit key (a name, or "kit:<id>" for one of several same-named kits) -> its name in the dropdowns
const kitLabel = k => S.state.labels?.[k] ?? k;

const MEDIUM_CAPE = '0x3c33cf10a26cbb3e';   // content/fac_helldivers/capes/medium_cape

// ---------- what the preview shows: the Helldiver (any armor, any helmet, any cape: the three pickers), or one
// item of OTHER_TYPES (vehicle, weapon, backpack, SEAF, gear…). S.look: {armor: kit key | '', helmet: 'match' | 'none' | kit key,
// cape: kit key | ''} (kit keys "kit:<id>" from /api/kits), remembered per project.
const OTHER_TYPES = ['Vehicle', 'Weapon', 'Backpack', 'SEAF', 'Attachment', 'Gear', 'Throwable', 'Stratagem', 'Craft', 'Crew',
  'Automaton', 'Illuminate', 'Objective', 'Ship', 'World', 'Armor piece', 'Unidentified'];
S.look = { armor: '', helmet: 'match', cape: '' };
S.mode = 'char';
// the /api/kits entries of a key: the entry with that value, or (a name key) the entries of that name
const entriesOf = key => {
  const byValue = (S.kitList ?? []).filter(e => e.value === key);
  return byValue.length ? byValue : (S.kitList ?? []).filter(e => e.set === key || (!key.startsWith('kit:') && e.name === key));
};
const isOther = key => entriesOf(key).some(e => OTHER_TYPES.includes(e.type));
const armorEntry = () => (S.kitList ?? []).find(e => e.value === S.look.armor);
// the armor's own helmet: its set's, else (an armor of several versions, B-01 Tactical's 9 with 15 helmets: no one set
// helmet) the first helmet of its name
const ownHelmetOf = a => a?.helmet ?? (a ? (S.kitList ?? []).find(e => e.type === 'Helmet' && e.name === a.name)?.value : undefined);
function saveLook() {
  try { localStorage.setItem('lutstudio.look:' + S.home?.project, JSON.stringify(S.look)); } catch { }
}
function showLook() {
  for (const [id, v] of [['wearArmor', S.look.armor], ['wearHelmet', S.look.helmet], ['wearCape', S.look.cape]]) {
    const sel = $(id);
    if ([...sel.options].some(o => o.value === v)) sel.value = v;
  }
}

// The Armor, Helmet and Cape pickers: the project's own items first, then every one of the game
async function loadCharacterMenus() {
  try { S.kitList = await api('/api/kits'); } catch (e) { console.warn('kits', e); S.kitList = []; }
  S.capeNames = new Set(S.kitList.filter(e => e.type === 'Cape').flatMap(e => [e.value, e.name]));
  const ownKeys = new Set(S.state.kits);
  const fill = (id, type, first) => {
    const sel = $(id);
    sel.innerHTML = '';
    for (const [v, t] of first) sel.add(new Option(t, v));
    const all = S.kitList.filter(e => e.type === type);
    const mine = all.filter(e => ownKeys.has(e.value) || ownKeys.has(e.set) || ownKeys.has(e.name));
    for (const [label, list] of [['This mod', mine], [{ Armor: 'All armor', Helmet: 'All helmets', Cape: 'All capes' }[type], all]]) {
      if (!list.length) continue;
      const g = document.createElement('optgroup'); g.label = label;
      for (const e of list) g.appendChild(new Option(e.label, e.value));
      sel.appendChild(g);
    }
  };
  fill('wearArmor', 'Armor', [['', 'None']]);
  fill('wearHelmet', 'Helmet', [['match', 'Matching'], ['none', 'None']]);
  fill('wearCape', 'Cape', [['', 'None']]);
}

// The look a project opens with: remembered, else its own items (an armor; a helmet of its own unless it's the
// armor's; a cape)
function initialLook() {
  try {
    const v = JSON.parse(localStorage.getItem('lutstudio.look:' + S.home?.project) ?? 'null');
    if (v && typeof v === 'object') { S.look = { armor: v.armor ?? '', helmet: v.helmet ?? 'match', cape: v.cape ?? '' }; return; }
  } catch { }
  const look = { armor: '', helmet: 'match', cape: '' };
  // the kits the project's LUTs belong to (by id: an armor and its helmet share a name), in the project's order
  const luts = new Set(S.state.variants.flatMap(v => (v.luts ?? []).map(l => l.lut)));
  const ids = new Set([...luts].flatMap(h => (S.state.parts?.[h] ?? []).filter(p => S.state.kits.includes(p.key)).map(p => 'kit:' + p.id)));
  // in the project's kit order (its own kit first): kits sharing its LUTs (A-9 Helljumper's with A-35 Recon) come after
  const rank = e => { const i = S.state.kits.findIndex(k => entriesOf(k).some(x => x.value === e.value)); return i < 0 ? 1e9 : i; };
  let armorRank = 1e9, helmetRank = 1e9;
  for (const e of (S.kitList ?? []).filter(e => ids.has(e.value)).sort((a, b) => rank(a) - rank(b))) {
    if (e.type === 'Armor' && !look.armor) { look.armor = e.value; armorRank = rank(e); }
    if (e.type === 'Helmet' && !look.helmetSet) { look.helmetSet = e.value; helmetRank = rank(e); }
    if (e.type === 'Cape' && !look.cape) look.cape = e.value;
  }
  // another helmet than the armor's own: when the armor has none, or the helmet is more the project's than the armor
  const ownHelmet = ownHelmetOf((S.kitList ?? []).find(e => e.value === look.armor));
  if (look.helmetSet && look.helmetSet !== ownHelmet && (!ownHelmet || helmetRank < armorRank)) look.helmet = look.helmetSet;
  delete look.helmetSet;
  S.look = look;
}

// Show an item (the Show menu, a LUT of another item): an item of OTHER_TYPES on its own; an
// armor, helmet or cape on the Helldiver (an armor with its matching helmet; a helmet or cape onto the current armor)
async function showItem(key) {
  if (isOther(key)) { S.mode = 'other'; HELD.pieces = []; HELD.kit = null; $('heldWeapon').hidden = true; return loadKit(key); }
  const es = entriesOf(key);
  const armor = es.find(e => e.type === 'Armor'), helmet = es.find(e => e.type === 'Helmet'), cape = es.find(e => e.type === 'Cape');
  if (armor) { S.look.armor = armor.value; S.look.helmet = 'match'; }
  else if (helmet) S.look.helmet = helmet.value === ownHelmetOf(armorEntry()) ? 'match' : helmet.value;
  if (cape) S.look.cape = cape.value;
  saveLook();
  return loadCharacter();
}
// the editor as scene.js uses it (the showcase scene: items shown one by one, then drawn together), and putting the
// editor back as it was after
function sceneApp() {
  return {
    R, api, kits: () => S.kitList ?? [], poses: () => POSE.list, clip: loadClip,
    // (the scene's items, each on its own: without the editor's held weapon, which the scene gives its Helldivers itself)
    showItem: async k => { S.inScene = true; try { return await showItem(k); } finally { S.inScene = false; } },
    statusText: () => $('status').textContent,
    // a lighting picked (a game one: until its cube map is in), the one before returned
    setEnv: async name => {
      const prev = { env: $('env').value, sunAz: $('sunAz').value, sunElevUser: R.sunElevUser };
      if (typeof name === 'object') { $('sunAz').value = name.sunAz; $('env').value = name.env; setEnv(); R.sunElevUser = name.sunElevUser; showSunElev(); return prev; }
      $('env').value = name; R.sunElevUser = null; setEnv(); showSunElev();
      for (let i = 0; i < 120 && R.env.game && !R.env.cubeTex; i++) await new Promise(r => setTimeout(r, 250));
      return prev;
    },
    snapshot: () => ({ mode: S.mode, kit: S.kit, look: { ...S.look } }),
    restore: async st => {
      if (st.mode === 'other' && st.kit) return loadKit(st.kit);
      S.look = { ...st.look }; saveLook(); return loadCharacter();   // (the held weapon back with it)
    },
  };
}
// the Showcase mode's app (showcaseui.js): the scene's, and analytics, the project's name
function showcaseApp() { return { ...sceneApp(), track, projectName: () => S.state?.project?.name ?? '' }; }
// a pose's animation, loaded once
async function loadClip(hash) {
  if (!POSE.cache.has(hash)) POSE.cache.set(hash, prepareClip(await api('/api/anim?hash=' + hash)));
  return POSE.cache.get(hash);
}
// Redraw what's shown (body type, attachments, pickers changed)
function reload() { return S.mode === 'other' && S.kit ? loadKit(S.kit) : loadCharacter(); }

// The Helldiver: the armor, the helmet (its own: Matching) and the cape of the pickers, on the avatar
async function loadCharacter() {
  S.mode = 'char';
  showLook();
  const a = armorEntry();
  const helmetKey = S.look.helmet === 'match' ? (ownHelmetOf(a) ?? '') : S.look.helmet === 'none' ? '' : S.look.helmet;
  const keys = [S.look.armor, helmetKey, S.look.cape].filter(Boolean);
  // the item shown, as the project knows it (its own key when the armor / helmet / cape is one of its items)
  const own = S.state.kits.find(k => keys.some(x => entriesOf(k).some(e => e.value === x)));
  S.kit = own ?? keys[0] ?? '';
  $('kit').value = own ?? '';   // (blank: an item from All armor, not one of the mod's)
  document.body.classList.remove('vehicle', 'weapon');
  const label = [...new Set(keys.map(k => (S.kitList ?? []).find(e => e.value === k)?.label ?? k))].join(' + ') || 'Nothing';
  const gen = ++S.loadGen;   // (a newer load replaces this one: it stops adding pieces)
  R.clearPieces();
  if (!keys.length) { status('Pick an armor, a helmet or a cape (top bar) to see them.'); renderLists(); renderFields(); return; }
  status(`Loading ${label}… (first time per piece: a few seconds)`);
  const fetchKit = async k => (await api('/api/kit?id=' + encodeURIComponent(k.replace(/^kit:/, ''))))
    .filter(p => p.material_lut && (p.body === 'any' || p.body === S.body));
  let pieces = [];
  for (const [k, part] of [[S.look.armor, 'armor'], [helmetKey, 'helmet'], [S.look.cape, 'cape']]) {
    if (!k) continue;
    try {
      let ps = await fetchKit(k);
      if (part === 'cape') { ps = ps.filter(p => p.cape_lut).slice(0, 1); ps.forEach(p => { p.worn = true; p.capeKey = k; }); }
      ps.forEach(p => { p.wornRef = 'kit:' + p.kit_id; });   // an edit of a piece not in the project pulls its kit's LUTs
      pieces.push(...ps);
    } catch (e) { console.warn(part, e); }
  }
  if (gen !== S.loadGen) return;
  await loadCharPieces(pieces, label, gen);
  HELD.pieces = []; HELD.kit = null;   // (the pieces were cleared: the weapon again, if the pose holds one)
  if (gen === S.loadGen && !S.inScene) updateHeld();
}

async function loadKit(name) {
  S.kit = name;
  $('kit').value = name;
  status(`Loading ${kitLabel(name)}… (first time per piece: a few seconds)`);
  const gen = ++S.loadGen;
  R.clearPieces();
  const pieces = (await api('/api/kit?name=' + encodeURIComponent(name)))
    .filter(p => p.material_lut && (p.body === 'any' || p.body === S.body));
  if (gen !== S.loadGen) return;
  const vehicle = pieces.length > 0 && pieces.every(p => OTHER_TYPES.includes(p.kit_type));
  document.body.classList.toggle('vehicle', vehicle);   // hides the armor-only controls (body, pickers, pose)
  document.body.classList.toggle('weapon', vehicle && pieces.every(p => p.kit_type === 'Weapon'));
  if (vehicle) return loadVehicle(name, pieces, gen);
  return showItem(name);
}

// the Helldiver's pieces: each unit's armor / cape primitives with the kit's LUTs
async function loadCharPieces(pieces, label, gen) {
  let done = 0;
  await Promise.all(pieces.map(async p => {
    try {
      // capes: kits without their own model use the default cape
      const unit = p.cape_lut && /^0x0+$/.test(p.unit) ? MEDIUM_CAPE : p.unit;
      const glb = parseGLB(await (await api('/api/unit?hash=' + unit)).arrayBuffer());
      for (const prim of extractPieces(glb)) {
        if (p.cape_lut && prim.kind !== 'cape') continue;
        const lut = p.material_lut;   // the kit decides (the exported material only has the base's default LUT)
        await loadVanilla(lut);
        const keys = { edited: editedKey(lut), vanilla: 'v:' + lut };
        const info = { lut, slot: p.slot, unit: p.unit, type: p.piece_type };
        if (p.wornRef) info.kitRef = p.wornRef;   // a piece not in the project: an edit pulls its kit's LUTs, labeled
        if (p.cape_lut) {
          await loadVanilla(p.cape_lut);
          Object.assign(keys, { cape: editedKey(p.cape_lut), capeVanilla: 'v:' + p.cape_lut });
          info.cape = p.cape_lut;
          info.capeTex = Object.fromEntries(Object.entries({ scalar: p.decal_scalar_fields, gradient: p.cape_gradient,
            decalSheet: p.decal_sheet, baseData: p.base_data }).filter(([, v]) => v));
        } else {
          // (a pattern LUT that doesn't load leaves the piece without its pattern, not off the model)
          let pat = p.pattern_lut || prim.tex.patternLut;
          if (pat) await loadVanilla(pat).catch(e => { console.warn(p.slot, 'pattern', e); pat = null; });
          keys.pattern = pat ? editedKey(pat) : null;
          info.pattern = pat;
        }
        if (gen !== S.loadGen) return;
        await R.addPiece(prim, keys, info);
      }
    } catch (e) { console.error(e); status(`${p.slot}: ${e.message}`, true); }
    if (gen === S.loadGen) status(`Loading ${label}… ${++done}/${pieces.length}`);
  }));
  if (gen !== S.loadGen) return;
  R.frame();
  status(`${label}: ${R.pieces.length} parts. Drag to orbit, right-drag to pan, wheel to zoom, click to pick a zone.`);
  renderLists();
  renderFields();
  document.dispatchEvent(new Event('lutstudio:pieces'));
}

// A vehicle (exosuit, FRV, tank, hellpod, weapon rack, Pelican) in one skin: its unit, each mesh in the material of
// that skin (filediver exports the skins as glTF material variants); a mesh whose material the skin overrides wears
// the kit's LUT, the others their material's own. Drawn with the vehicle family's shader
// differences (no clearcoat).
async function loadVehicle(name, pieces, gen) {
  let kitUnits = pieces[0].kit_units?.length ? pieces[0].kit_units : [...new Set(pieces.map(p => p.unit))].map(u => ({ unit: u }));
  if (pieces[0].kit_type === 'Weapon') kitUnits = await weaponUnits(pieces[0].kit_id, kitUnits);
  const skin = pieces[0].skin;
  let n = 0, body = null, aside = 0;
  for (const ku of kitUnits) {
    const unit = ku.unit;
    try {
      const glb = parseGLB(await (await api('/api/unit?hash=' + unit)).arrayBuffer());
      // placement: the body as is; parts on their mount nodes, or in place (FRV armaments), others beside it
      let mats = [null];
      if (!body) body = glb;
      else {
        const mounts = ku.mount ? [ku.mount] : vehicleMount(ku.name ?? '');   // weapon attachments name theirs
        if (mounts) mats = mounts.map(m => mountMatrix(body, m, glb)).filter(Boolean);
        else if (!/\/armaments\//.test(ku.name ?? '')) mats = [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.2 + 1.4 * aside++, 0, 0, 1]];
        if (!mats.length) mats = [null];
      }
      for (const m of mats)
      for (const prim of extractPieces(glb, { variant: skin, vehicle: true })) {
        if (m) transformPrim(prim, m);
        const pc = pieces.find(p => p.unit === unit && p.slot === prim.slot);
        const lut = pc?.material_lut || prim.tex.lut;
        if (!lut) continue;
        const pat = pc?.pattern_lut || prim.tex.patternLut;
        // cloth on the cape shader (the melee flag): its cape LUT too (trim / gradient / decals), the material's textures
        const cape = prim.kind === 'cape' ? pc?.cape_lut || prim.tex.capeLut : '';
        try { await loadVanilla(lut); } catch (e) { console.warn(prim.slot, e); continue; }
        if (pat) await loadVanilla(pat).catch(() => null);
        if (cape) await loadVanilla(cape).catch(() => null);
        const keys = { edited: editedKey(lut), vanilla: 'v:' + lut, pattern: pat ? editedKey(pat) : null,
          ...(cape ? { cape: editedKey(cape), capeVanilla: 'v:' + cape } : {}) };
        if (gen !== S.loadGen) return;
        await R.addPiece(prim, keys, { lut, slot: prim.slot, unit, pattern: pat, vehicle: true, ...(cape ? { cape } : {}) });
        n++;
      }
    } catch (e) { console.error(e); status(`${unit}: ${e.message}`, true); }
    status(`Loading ${kitLabel(name)}… ${n} parts`);
  }
  R.frame();
  status(`${kitLabel(name)}: ${R.pieces.length} parts. Drag to orbit, right-drag to pan, wheel to zoom, click to pick a zone.`);
  renderLists();
  renderFields();
  document.dispatchEvent(new Event('lutstudio:pieces'));
}

// ---------- weapon attachments: one menu per slot (/api/attachments); the choice replaces that mount's units.
// The menus offer what the game offers the weapon, with the weapon level that unlocks each (the Helldivers Wiki's
// list); "All" offers every attachment that fits instead.
S.attach = { id: null, slots: [], choice: {}, all: false, credit: null };
async function fetchAttachments() {
  try {
    const r = await api('/api/attachments?id=' + encodeURIComponent(S.attach.id) + (S.attach.all ? '&all=1' : ''));
    S.attach.slots = r.slots ?? [];
    S.attach.credit = r;
  } catch (e) { console.warn('attachments', e); S.attach.slots = []; }
  for (const [slot, pick] of Object.entries(S.attach.choice))   // a choice the new menus lack: back to the default
    if (!S.attach.slots.find(s => s.slot === slot)?.options.some(o => o.id === pick)) delete S.attach.choice[slot];
  fillAttachRow();
}
async function weaponUnits(kitId, kitUnits) {
  const wid = String(kitId).split('.')[0];
  if (S.attach.id !== wid) {                       // another weapon: its slots, the defaults chosen
    S.attach = { id: wid, slots: [], choice: {}, all: S.attach.all, credit: null };
    await fetchAttachments();
  }
  let units = [...kitUnits];
  for (const s of S.attach.slots) {
    const pick = S.attach.choice[s.slot];
    if (pick === undefined) continue;              // the kit's default
    const opt = s.options.find(o => o.id === pick);
    units = units.filter((u, i) => i === 0 || u.mount !== s.mount).concat(opt?.units ?? []);
  }
  return units;
}
function fillAttachRow() {
  const row = $('attachRow');
  row.innerHTML = S.attach.slots.length || S.attach.all ? '<span class="hint">Attachments</span>' : '';
  for (const s of S.attach.slots) {
    const sel = document.createElement('select');
    sel.title = s.listed ? `${s.slot}: what the game offers this weapon, with the weapon level that unlocks each`
      : `${s.slot}: every attachment that fits (the game offers this weapon fewer)`;
    for (const o of s.options) sel.add(new Option(`${s.slot}: ${o.name}${o.level ? ` · lvl ${o.level}` : ''}`, o.id));
    sel.value = S.attach.choice[s.slot] ?? s.default;
    sel.onchange = () => { S.attach.choice[s.slot] = sel.value; reload(); };
    row.append(sel);
  }
  if (!S.attach.slots.length && !S.attach.all) return;
  const all = document.createElement('label');
  all.className = 'hint';
  all.title = 'Offer every attachment that fits this weapon, not only the ones the game offers it';
  all.innerHTML = '<input type="checkbox"> All';
  all.firstChild.checked = S.attach.all;
  all.firstChild.onchange = async e => { S.attach.all = e.target.checked; await fetchAttachments(); reload(); };
  row.append(all);
  const c = S.attach.credit;
  if (c?.source && S.attach.slots.some(s => s.listed)) {   // the lists are the wiki's: credit them (CC BY-NC-SA)
    const a = document.createElement('a');
    a.className = 'hint';
    a.href = c.source;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'list: Helldivers Wiki';
    a.title = `Which attachments each weapon offers and their unlock levels: ${c.license}. Wiki edit of ${String(c.edited).slice(0, 10)}.`;
    row.append(a);
  }
}

// ---------- editing
function selLut() { return S.sel.lut ? S.luts.get(S.sel.lut) : null; }

function snapshot() {
  const l = selLut(); if (!l?.edited) return;
  const now = performance.now();
  if (now - S.lastSnap > 700 || S.undo.at(-1)?.lut !== S.sel.lut) {   // (another LUT: its own step)
    S.undo.push({ lut: S.sel.lut, px: l.edited.slice(), labels: [...l.labels] });
    if (S.undo.length > 200) S.undo.shift();
    S.redo = [];
  }
  S.lastSnap = now;
}

function setCell(zone, col, ch, v) {
  const l = selLut(); if (!l?.edited) return;
  l.edited[cell(l, zone, col, ch)] = v;
}

function changed(l) {
  if (l.pull) adopt(l);
  l.dirty = true;
  R.setLut('e:' + S.sel.lut, l.w, l.h, l.edited);
  scheduleSave();
  refreshMarks();
}

function restore(stack, other) {
  const s = stack.pop(); if (!s) return;
  const l = S.luts.get(s.lut);
  other.push({ lut: s.lut, px: l.edited.slice(), labels: [...l.labels] });
  l.edited.set(s.px); l.labels = s.labels;
  S.sel.lut = s.lut;
  S.sel.zone = Math.min(S.sel.zone, l.h - 1);
  changed(l);
  renderLists(); renderFields();
}

let saveTimer = null;
function scheduleSave() {
  if (!$('autosave').checked) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 800);
}

async function saveAll() {
  if (S.adopting) await S.adopting;
  if (S.saving) await S.saving;
  const work = [...S.luts.entries()].filter(([, l]) => l.dirty && l.edited && !l.pull);
  if (!work.length) return true;
  let failed = 0;
  S.saving = (async () => {
    for (const [hash, l] of work) {
      l.dirty = false;
      try {
        const d = await api(`/api/doc?variant=${S.variant}&lut=${hash}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ px: Array.from(l.edited), labels: l.labels }),
        });
        if (!l.dirty) { l.edited.set(d.px); R.setLut('e:' + hash, l.w, l.h, l.edited); }
      } catch (e) { l.dirty = true; failed++; console.warn('save', hash, e); }
    }
    refreshMarks();
    if (failed) status(`Save failed for ${failed} of ${work.length} LUT(s): they stay unsaved (try Save again)`, true);
    else status(`Saved ${work.length} LUT${work.length > 1 ? 's' : ''} to variants/${S.variant}`);
  })();
  await S.saving;
  S.saving = null;
  return failed === 0;   // (false: something stays unsaved; callers about to reload the LUTs stop)
}

// ---------- lists
function lutChanged(l) { return l.edited && l.edited.some((v, i) => v !== l.vanilla[i]); }
function zoneChanged(l, z) {
  if (!l.edited) return false;
  for (let i = z * l.w * 4; i < (z + 1) * l.w * 4; i++) if (l.edited[i] !== l.vanilla[i]) return true;
  return false;
}

// The SEAF soldier's shoulder badge (its decal sheet): the game's soldier types set decal_id by role
const SEAF_BADGES = { '0xa218d36d94a7ec7b': ['rifleman', 'heavy weapons (MG-43, EAT-17)', 'radio operator', 'medic'] };
function decalRole() {
  const roles = R.pieces.map(p => SEAF_BADGES[p.decalHash]).find(Boolean);
  $('decalNumRole').textContent = roles?.[R.decalId] ? `: ${roles[R.decalId]}` : '';
}

function renderLists() {
  $('decals').hidden = !R.pieces.some(p => p.decalHash);
  $('design').hidden = !R.pieces.some(p => p.scalarHash);
  $('masksBtn').hidden = !R.pieces.some(p => p.idMaskHash || p.patMaskHash);
  $('rolesBtn').hidden = !REVIEW;
  // the Tools menu offers the editors this item has (its buttons stay out of the bar: they don't fit a small window)
  for (const o of $('tools').options) if (o.value) { o.hidden = !!$(o.value)?.hidden; o.disabled = o.hidden; }
  // the decal number (shown with a decal sheet; off when no material on screen moves its first cell) and the
  // damage slider (pieces on the vehicle base material)
  const sheets = R.pieces.filter(p => p.decalSheet && p.kind !== 'cape');
  const nMax = Math.max(0, ...sheets.map(decalNumbers));
  $('decalNumRow').hidden = !sheets.length;
  $('decalNum').max = nMax; $('decalNum').disabled = nMax === 0;
  if (R.decalId > nMax) { R.decalId = nMax; $('decalNum').value = nMax; }
  decalRole();
  if ($('damageRow')) $('damageRow').hidden = !R.pieces.some(p => p.damageTex);
  const v = S.state.variants.find(x => x.folder === S.variant);
  const list = $('lutList');
  list.innerHTML = '';
  // a big project (several armors, an imported overhaul): the armor on screen's LUTs, the rest behind a switch
  const onScreen = h => R.pieces.some(p => p.info.lut === h || p.info.pattern === h || p.info.cape === h);
  const big = (v.luts ?? []).length > 40, hidden = big && !S.showAllLuts ? (v.luts ?? []).filter(i => !onScreen(i.lut) && i.lut !== S.sel.lut).length : 0;
  for (const info of [...(v.luts ?? [])].sort((a, b) => lutOrder(a.lut) - lutOrder(b.lut))) {
    const used = onScreen(info.lut);
    if (hidden && !used && info.lut !== S.sel.lut) continue;
    const l = S.luts.get(info.lut);
    const it = document.createElement('div');
    it.className = 'item' + (info.lut === S.sel.lut ? ' sel' : '');
    it.dataset.lut = info.lut;
    const d = describeLut(info.lut, info.kind);
    it.title = d.tip;
    it.innerHTML = `<span class="dot"></span><div class="grow"><div class="lutName"><span class="badge ${d.cls}">${esc(d.badge)}</span>${esc(d.parts)}</div>
      <div class="sub">${esc(d.shared)}${used ? '' : ' · not on this item'}</div></div>`;
    it.querySelector('.dot').classList.add(l?.dirty ? 'dirty' : l && lutChanged(l) ? 'changed' : 'x');
    it.onclick = () => selectLut(info.lut);
    keyable(it);
    list.appendChild(it);
  }
  if (big) {
    const t = document.createElement('div');
    t.className = 'item more';
    t.textContent = S.showAllLuts ? `Show only this item's LUTs` : `Show all ${(v.luts ?? []).length} LUTs of the mod (${hidden} more)`;
    t.onclick = () => { S.showAllLuts = !S.showAllLuts; renderLists(); };
    list.appendChild(t);
  }
  for (const [hash, l] of S.luts) {      // parts looked at but not changed yet
    if (!l.pull || !l.edited || (v.luts ?? []).some(i => i.lut === hash)) continue;
    const p = R.pieces.find(p => p.info.lut === hash || p.info.cape === hash);
    const name = p?.info.cape === hash ? 'cape trim / gradient / decals' : p?.info.cape ? 'cape' : p?.info.slot ?? hash;
    const it = document.createElement('div');
    it.className = 'item preview' + (hash === S.sel.lut ? ' sel' : '');
    it.innerHTML = `<span class="dot x"></span><div class="grow"><div>${esc(name)}</div>
      <div class="sub">${hash} · not in the project yet: a change adds it</div></div>`;
    it.onclick = () => selectLut(hash);
    keyable(it);
    list.appendChild(it);
  }
  renderZones();
}

// a list row reachable with the keyboard: Tab to it, Enter or Space picks it (as a click)
function keyable(it) {
  it.tabIndex = 0;
  it.setAttribute('role', 'button');
  it.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === it) { e.preventDefault(); it.click(); }
  });
}

// What a LUT is, for the LUT list: the kind of piece (undersuit, armor, accessory...), the parts it covers on its
// kit, and which other kits it also changes. parts: /api/state's uses of the LUT; its own kit is the first of the
// project's kits (the one using most of the project's LUTs) that uses it.
const PIECE_KIND = {
  undergarment: ['Undersuit', 'undersuit', 'the body suit under the armor'],
  armor: ['Armor', 'armor', 'armor plates'],
  accessory: ['Accessory', 'accessory', 'pouches, straps and other add-ons'],
  pattern: ['Pattern', 'pattern', 'painted stripes / emblems'],
  cape: ['Cape', 'cape', "the cape's material"],
  cape_trim: ['Cape trim', 'cape', "the cape's trim lines, gradient and emblems"],
  vehicle: ['Vehicle', 'armor', 'a vehicle part in this skin'],
  weapon: ['Weapon', 'accessory', 'a weapon material (a paint scheme recolors it on every weapon)'],
  backpack: ['Backpack', 'accessory', 'a backpack part (its look in every mission)'],
  seaf: ['SEAF', 'armor', 'a SEAF soldier / equipment / artillery material (used by nothing else)'],
  attachment: ['Attachment', 'accessory', 'a weapon attachment material (on every weapon that mounts it)'],
  gear: ['Gear', 'accessory', 'a weapon or gear material no weapon kit covers'],
  throwable: ['Throwable', 'accessory', 'a grenade / mine / throwable material'],
  stratagem: ['Stratagem', 'armor', 'a stratagem material (sentry, emplacement, Hellbomb, beacon…)'],
  craft: ['Craft', 'armor', 'an Eagle / ordnance / shuttle / oil rig material'],
  crew: ['Crew', 'armor', "a Super Destroyer crew member's material"],
  automaton: ['Automaton', 'armor', 'an Automaton unit / weapon / vehicle material'],
  illuminate: ['Illuminate', 'armor', 'an Illuminate material'],
  objective: ['Objective', 'armor', 'a mission objective material'],
  ship: ['Ship', 'armor', 'a Super Destroyer interior material'],
  world: ['World', 'armor', 'a planet prop / building material'],
  unidentified: ['Unidentified', 'armor', 'a material of a model not identified yet'],
  'armor piece': ['Armor piece', 'armor', 'a Helldiver armor piece no armor set in the game tables uses'],
};
const KIND_ORDER = ['armor', 'undergarment', 'accessory', 'pattern', 'cape', 'cape_trim'];
// sort key of a project LUT: kind of piece, then the first body part
function lutOrder(hash) {
  const parts = S.state.parts?.[hash] ?? [];
  const own = S.state.kits.find(k => parts.some(p => p.key === k)) ?? parts[0]?.key;
  const mine = parts.filter(p => p.key === own);
  const kind = Math.min(...mine.map(p => KIND_ORDER.indexOf(p.type)).filter(i => i >= 0), 99);
  const slot = Math.min(...mine.map(p => SLOT_ORDER.findIndex(s => p.slot.endsWith(s))).filter(i => i >= 0), 99);
  return kind * 100 + slot;
}
function describeLut(hash, kind) {
  const parts = S.state.parts?.[hash] ?? [];
  const kits = [...new Set(parts.map(p => p.key))];
  const own = S.state.kits.find(k => kits.includes(k)) ?? kits[0];
  const mine = parts.filter(p => p.key === own);
  const types = [...new Set(mine.map(p => p.type))];
  const k = types.length === 1 ? PIECE_KIND[types[0]] : null;
  const badge = k ? k[0] : types.length ? types.map(t => PIECE_KIND[t]?.[0] ?? t).join(' + ') : kind === 'pattern' ? 'Pattern' : 'LUT';
  let partsText = mine.length ? slotList(mine) : hash;
  if (own && S.kit && own !== S.kit) partsText += ' · ' + kitLabel(own);   // e.g. a worn cape's LUT
  const others = kits.filter(x => x !== own).map(kitLabel);
  const shared = !own ? hash : others.length === 0 ? `only on ${own === S.kit ? 'this item' : kitLabel(own)}`
    : `also changes ${others.slice(0, 6).join(', ')}${others.length > 6 ? ` and ${others.length - 6} more` : ''}`;
  const tip = [`${hash}`, k ? `${k[0]}: ${k[2]}` : '', own ? `Own item: ${kitLabel(own)}` : '',
    others.length ? `Changing it also recolors: ${others.join(', ')}` : 'Not used by any other item'].filter(Boolean).join('\n');
  return { badge, cls: k ? k[1] : 'mixed', parts: partsText, shared, tip };
}

function renderZones() {
  const zl = $('zoneList');
  zl.innerHTML = '';
  const l = selLut();
  if (!l?.edited) { zl.innerHTML = '<div class="empty">Select a LUT.</div>'; return; }
  const rows = l.kind === 'pattern' ? 1 : l.h;
  for (let z = 0; z < rows; z++) {
    const it = document.createElement('div');
    it.className = 'item' + (z === S.sel.zone ? ' sel' : '');
    const c = [0, 1, 2].map(ch => l.edited[cell(l, z, 0, ch)]);   // (cape LUT: col 0 is the trim color - no swatch)
    it.innerHTML = `<span class="swatch" style="${l.kind === 'cape' ? 'visibility:hidden' : `background:#${c.map(hex).join('')}`}"></span>
      <input class="zoneLabel" value="${esc(l.labels[z] || `zone ${z}`)}"><span class="dot"></span>`;
    it.querySelector('.dot').classList.add(zoneChanged(l, z) ? 'changed' : 'x');
    const inp = it.querySelector('input');
    inp.onchange = () => { snapshot(); l.labels[z] = inp.value; changed(l); renderFields(); };
    it.onclick = e => {
      if (e.target === inp && S.sel.zone === z) return;
      selectZone(z);
      if (e.target === inp) $('zoneList').querySelectorAll('.zoneLabel')[z]?.focus();
    };
    it.onmouseenter = () => { R.highlight = { lut: 'e:' + S.sel.lut, zone: z, piece: -1 }; };
    it.onmouseleave = () => { R.highlight = { lut: null, zone: -1, piece: -1 }; };
    keyable(it);
    zl.appendChild(it);
  }
}

function refreshMarks() {
  const l = selLut();
  document.querySelectorAll('#lutList .item').forEach((it, i) => {
    if (!it.dataset.lut) return;       // a previewed LUT (not in the project yet)
    const ll = S.luts.get(it.dataset.lut), d = it.querySelector('.dot');
    d.className = 'dot ' + (ll?.dirty ? 'dirty' : ll && lutChanged(ll) ? 'changed' : '');
  });
  if (!l?.edited) return;
  document.querySelectorAll('#zoneList .item').forEach((it, z) => {
    it.querySelector('.dot').className = 'dot ' + (zoneChanged(l, z) ? 'changed' : '');
    it.querySelector('.swatch').style.background = '#' + [0, 1, 2].map(ch => hex(l.edited[cell(l, z, 0, ch)])).join('');
  });
  document.querySelectorAll('#fields .field').forEach(f => f.update?.());
}

async function selectLut(hash) {
  S.sel.lut = hash;
  S.sel.zone = Math.min(S.sel.zone, (S.luts.get(hash)?.h ?? 1) - 1);
  const onArmor = R.pieces.some(p => p.info.lut === hash || p.info.pattern === hash || p.info.cape === hash);
  if (!onArmor) {
    const keys = (S.state.parts?.[hash] ?? []).map(p => p.key);
    const kit = S.state.kits.find(k => keys.includes(k));
    if (kit && kit !== S.kit) await showItem(kit);
  }
  renderLists();
  renderFields();
}

function selectZone(z) {
  S.sel.zone = z;
  renderZones();
  renderFields();
}

// ---------- field editor
const GROUP_NOTES = {
  metal: l => (l.edited[cell(l, S.sel.zone, 6, 3)] > 0 || [0, 1, 2, 3].some(ch => l.edited[cell(l, S.sel.zone, 7, ch)] !== 0) ? 'on' : 'off'),
  clearcoat: l => (l.edited[cell(l, S.sel.zone, 0, 3)] >= 2 ? '' : 'needs paint.mode 2-4'),
  cloth: l => (l.edited[cell(l, S.sel.zone, 0, 3)] === 1 ? '' : 'paint.mode 1 only'),
  camo: l => (l.edited[cell(l, S.sel.zone, 21, 3)] >= 0 ? 'on' : 'off (layer -1)'),
};
// the sections of the right panel that are open: the defaults, then whatever the user opens or closes (kept while
// picking zones and LUTs, and in this browser)
const OPEN = (() => {
  try { const v = JSON.parse(localStorage.getItem('lutstudio.open') ?? 'null'); if (Array.isArray(v)) return new Set(v); } catch { }
  return new Set(['paint', 'detail', 'secondary', 'wear', 'shine', 'pattern', 'trim', 'gradient', 'decal1']);
})();

// The right panel for the selected zone. Picking another zone or LUT only changes the values shown: the panel keeps
// its scroll position and the sections the user opened or closed.
function renderFields() {
  const box = $('fields'), head = $('fieldsHead'), panel = $('right'), top = panel.scrollTop;
  try { renderFieldsInto(box, head); } finally { panel.scrollTop = top; }
}
function renderFieldsInto(box, head) {
  box.innerHTML = '';
  const l = selLut();
  if (!l?.edited) { head.innerHTML = '<div class="t">No LUT selected</div>'; return; }
  const z = l.kind === 'pattern' ? 0 : S.sel.zone;
  head.innerHTML = `<div class="t">${l.kind === 'pattern' ? 'Pattern LUT' : esc(l.labels[z] || 'zone ' + z)} <span class="hint">${S.sel.lut}</span></div>
    ${(() => { if (l.pull || !S.state.parts?.[S.sel.lut]) return `<div class="s" title="${esc(l.note || '')}">${esc(l.note || '')}</div>`; const d = describeLut(S.sel.lut, l.kind); return `<div class="s" title="${esc(d.parts + ' · ' + d.shared)}"><span class="badge ${d.cls}">${esc(d.badge)}</span>${esc(d.parts)} · ${esc(d.shared)}</div>`; })()}
    <div class="row" style="margin-top:6px"><button id="zCopy">Copy zone</button><button id="zPaste">Paste zone</button><button id="zReset">Reset zone</button></div>
    <div id="zLooks" class="looks"></div>`;
  // the looks: the built-in ones and yours, in categories (looks.js)
  looksPanel($('zLooks'), {
    S, api, l, z, schema: S.schema[l.kind], status, track, paydex: paydexDialog, rerender: renderFields,
    apply: fn => { snapshot(); S.lastSnap = 0; fn(); changed(l); renderFields(); },
  });
  $('zCopy').onclick = () => { S.clip = l.edited.slice(z * l.w * 4, (z + 1) * l.w * 4); status('Zone copied'); };
  $('zPaste').onclick = () => {
    if (!S.clip || S.clip.length !== l.w * 4) return status('Nothing to paste (copy a zone of a LUT of the same kind)', true);
    snapshot(); S.lastSnap = 0; l.edited.set(S.clip, z * l.w * 4); changed(l); renderFields();
  };
  $('zReset').onclick = () => { snapshot(); S.lastSnap = 0; l.edited.set(l.vanilla.slice(z * l.w * 4, (z + 1) * l.w * 4), z * l.w * 4); changed(l); renderFields(); };
  const fields = S.schema[l.kind].filter(f => !f.hidden);   // (hidden: the build mark's channels)
  const groups = [...new Set(fields.map(f => f.group))];
  for (const g of groups) {
    const det = document.createElement('details');
    det.className = 'group';
    det.open = OPEN.has(g);
    det.addEventListener('toggle', () => {
      if (det.open) OPEN.add(g); else OPEN.delete(g);
      try { localStorage.setItem('lutstudio.open', JSON.stringify([...OPEN])); } catch { }
    });
    const note = GROUP_NOTES[g]?.(l) ?? '';
    det.innerHTML = `<summary>${g}<span class="note">${note}</span></summary>`;
    for (const f of fields.filter(f => f.group === g)) det.appendChild(fieldEditor(l, z, f));
    if (l.kind === 'cape' && g.startsWith('decal')) det.appendChild(emblemButton(l, z, +g.slice(5) - 1));
    box.appendChild(det);
  }
}

// Import Row Presets from Paydex: where the Paydex LUT Editor keeps them, then the file (each becomes a look of the
// LUT kind its row fits, under "Mine")
const PAYDEX_DIR = String.raw`%LOCALAPPDATA%\PaydexLutEditor`;
async function paydexDialog() {
  if (!(await closeSide())) return;
  $('modalBody').innerHTML = `<h3>Import Row Presets from Paydex</h3>
    <p class="hint">The Paydex LUT Editor saves its Row Presets in one file, <b>row_presets.json</b>, in this folder:</p>
    <div class="row"><code id="pdxPath">${esc(PAYDEX_DIR)}</code><button id="pdxCopy">Copy</button></div>
    <p class="hint">(That is <code>C:\\Users\\<i>your name</i>\\AppData\\Local\\PaydexLutEditor</code>. AppData is a hidden folder:
      in the file window that opens next, paste the copied path into the <b>File name</b> box and press Enter to jump
      there, then pick <b>row_presets.json</b>.)</p>
    <p class="hint">Each preset becomes a look of your own (in the <b>Looks</b> list, category <i>Paydex</i>), for the kind of LUT its
      row fits: armor and other materials, capes or patterns.</p>
    <div class="row"><button id="pdxPick" class="primary">Choose row_presets.json…</button></div>
    <p class="hint" id="pdxInfo"></p>`;
  $('modal').hidden = false;
  const info = t => { $('pdxInfo').textContent = t; };
  $('pdxCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(PAYDEX_DIR); info('Copied: paste it into the File name box of the file window.'); }
    catch { info('Select the path above and copy it (Ctrl+C).'); }
  };
  $('pdxPick').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let looks;
      try { looks = importLooks(JSON.parse(await f.text())); } catch (e) { return info('That file is not Paydex Row Presets: ' + e.message); }
      if (!looks.length) return info('No Row Presets found in that file (it should be row_presets.json from the folder above).');
      const names = new Set((S.presets ?? []).map(p => p.name));
      for (const l of looks) { let n = l.name; for (let i = 2; names.has(n); i++) n = `${l.name} (${i})`; l.name = n; names.add(n); }
      S.presets = [...(S.presets ?? []), ...looks];
      await api('/api/presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.presets) });
      renderFields();
      const kinds = [...new Set(looks.map(l => l.kind))].join(', ');
      info(`Imported ${looks.length} Row Preset(s) (${kinds}): find them in the Looks list, in the Paydex category`);
      status(`Imported ${looks.length} Row Preset(s) from Paydex`);
      track('looks imported', { count: looks.length, kinds, from: 'paydex' });
    };
    inp.click();
  };
}

// Emblem picker for a cape decal: shows the cape's decal sheet with a grid; a click points the decal at that cell.
function emblemButton(l, z, di) {
  const row = document.createElement('div');
  row.className = 'row field';
  const b = document.createElement('button');
  b.textContent = 'Pick emblem…';
  b.title = 'Choose this decal\'s emblem from the cape\'s decal sheet';
  row.appendChild(b);
  b.onclick = () => pickEmblem(l, z, di);
  return row;
}

async function pickEmblem(l, z, di) {
  if (!(await closeSide())) return;
  const piece = R.pieces.find(p => p.info.cape === S.sel.lut);
  const sheetHash = piece?.info.capeTex?.decalSheet;
  if (!sheetHash) return status('This cape has no decal sheet of its own', true);
  const r = await fetch(`/api/tex?hash=${sheetHash}&variant=${encodeURIComponent(S.variant)}`);
  if (!r.ok) return status('The decal sheet could not be read: ' + await r.text(), true);
  const buf = await r.arrayBuffer(), dv = new DataView(buf);
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const img = new ImageData(new Uint8ClampedArray(buf, 20, w * h * 4), w, h);
  cv.getContext('2d').putImageData(img, 0, 0);
  $('modalBody').innerHTML = `<h3>Pick an emblem</h3>
    <div class="row">Grid <select id="emGrid"><option>2</option><option selected>4</option><option>8</option><option>16</option></select>
      <span class="hint">click a cell; the decal shows that cell, fitted to its placement on the cape</span></div>
    <div id="emWrap" style="position:relative;display:inline-block;background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/16px 16px"></div>`;
  const view = document.createElement('canvas');
  view.width = view.height = 512;
  view.style.cssText = 'width:512px;height:512px;cursor:crosshair;display:block';
  $('emWrap').appendChild(view);
  const draw = () => {
    const g = view.getContext('2d'), n = +$('emGrid').value;
    g.clearRect(0, 0, 512, 512); g.drawImage(cv, 0, 0, 512, 512);
    g.strokeStyle = 'rgba(242,193,78,.8)'; g.lineWidth = 1;
    for (let i = 1; i < n; i++) { g.beginPath(); g.moveTo(i * 512 / n, 0); g.lineTo(i * 512 / n, 512); g.moveTo(0, i * 512 / n); g.lineTo(512, i * 512 / n); g.stroke(); }
  };
  $('emGrid').onchange = draw;
  draw();
  view.onclick = e => {
    const n = +$('emGrid').value, rc = view.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rc.left) / rc.width * n), cy = Math.floor((e.clientY - rc.top) / rc.height * n);
    const R0 = 4 + 3 * di, X0 = 5 + 3 * di, O0 = 6 + 3 * di;
    const at = (col, ch) => cell(l, z, col, ch);
    snapshot(); S.lastSnap = 0;
    if (l.edited[at(R0, 2)] <= 0 || l.edited[at(R0, 3)] <= 0) {        // a new decal: defaults
      l.edited.set([0.5, 0.3, 0.2, 0.2], at(R0, 0));
      if (Math.abs(l.edited[at(O0, 1)]) < 0.001) { l.edited[at(O0, 0)] = 0.3; l.edited[at(O0, 1)] = 1; }
    }
    const sw = l.edited[at(R0, 2)];
    const keepTurn = l.edited[at(X0, 3)] < 0 ? -1 : 1;
    l.edited[at(X0, 0)] = ((cx + 0.5) / n) * 2 - 1;                      // cell center in -1..1 sheet space
    l.edited[at(X0, 1)] = ((cy + 0.5) / n) * 2 - 1;
    l.edited[at(X0, 3)] = keepTurn * sw * n;                              // the cell fills the decal's width
    if (di > 0 && Math.abs(l.edited[cell(l, z, 6, 1)]) < 0.001) status('Note: decal 1 is off, so this decal does not show (decals 2-4 need decal 1)', true);
    changed(l);
    $('modal').hidden = true;
    renderFields();
  };
  $('modal').hidden = false;
}

function fieldEditor(l, z, f) {
  const el = document.createElement('div');
  el.className = 'field';
  el.innerHTML = `<div class="name"><span class="k">${f.key.replace(/_/g, ' ')}</span><button class="reset" title="Back to the game's value">↺ vanilla</button></div><div class="doc">${esc(f.doc)}</div>`;
  const get = i => l.edited[cell(l, z, f.leaves[i][0], f.leaves[i][1])];
  const van = i => l.vanilla[cell(l, z, f.leaves[i][0], f.leaves[i][1])];
  const set = (i, v) => { setCell(z, f.leaves[i][0], f.leaves[i][1], v); };
  const updaters = [];
  const commit = () => { changed(l); };
  if (f.kind === 'color') {
    const row = document.createElement('div');
    row.className = 'row';
    const pick = document.createElement('input'); pick.type = 'color';
    row.appendChild(pick);
    const nums = [0, 1, 2].map(i => {
      const n = document.createElement('input'); n.type = 'number'; n.step = '0.01';
      n.oninput = () => { if (n.value === '' || isNaN(+n.value)) return; snapshot(); set(i, +n.value); pick.value = '#' + [0, 1, 2].map(k => hex(get(k))).join(''); commit(); };
      row.appendChild(n);
      return n;
    });
    pick.oninput = () => {
      snapshot();
      const h = pick.value.slice(1);
      [0, 1, 2].forEach(i => set(i, parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255));
      nums.forEach((n, i) => (n.value = fmt(get(i))));
      commit();
    };
    updaters.push(() => { pick.value = '#' + [0, 1, 2].map(k => hex(get(k))).join(''); nums.forEach((n, i) => document.activeElement !== n && (n.value = fmt(get(i)))); });
    el.appendChild(row);
  } else {
    const names = f.kind === 'recipe' ? f.sub : [null];
    names.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      if (name) row.innerHTML = `<span class="lab">${name.replace(/_/g, ' ')}</span>`;
      const sl = document.createElement('input'); sl.type = 'range';
      sl.min = f.min; sl.max = f.max || 1; sl.step = f.int ? 1 : ((f.max || 1) - f.min) / 1000;
      const n = document.createElement('input'); n.type = 'number'; n.step = f.int ? 1 : 'any';
      sl.oninput = () => { snapshot(); set(i, +sl.value); n.value = fmt(get(i)); commit(); };
      n.oninput = () => { if (n.value === '' || isNaN(+n.value)) return; snapshot(); set(i, f.int ? Math.round(+n.value) : +n.value); sl.value = get(i); commit(); };
      row.append(sl, n);
      updaters.push(() => { sl.value = get(i); if (document.activeElement !== n) n.value = fmt(get(i)); });
      el.appendChild(row);
    });
  }
  el.querySelector('.reset').onclick = () => { snapshot(); S.lastSnap = 0; f.leaves.forEach((_, i) => set(i, van(i))); commit(); el.update(); };
  el.update = () => {
    updaters.forEach(u => u());
    el.classList.toggle('changed', f.leaves.some((_, i) => get(i) !== van(i)));
  };
  el.update();
  return el;
}

// ---------- view
// ---------- poses (the avatar's armory animations, /api/poses + /api/anim)
const POSE = { list: [], clip: null, playing: false, t0: 0, time: 0, cache: new Map() };
const AVATAR = '0x4d1c334d294dfa97';   // content/fac_helldivers/cha_avatar/avatar_helldiver: the full skeleton
async function loadPoses() {
  try { POSE.list = await api('/api/poses'); } catch (e) { POSE.list = []; }
  try { R.avatarSkel = skeletonOf(parseGLB(await (await api('/api/unit?hash=' + AVATAR)).arrayBuffer()).json); }
  catch (e) { console.warn('avatar skeleton', e); }
  const sel = $('pose');
  sel.innerHTML = '';
  sel.add(new Option('T-pose', ''));
  for (const g of [...new Set(POSE.list.map(p => p.group || 'Armory'))]) {   // Armory, Moves, Emotes
    const og = document.createElement('optgroup'); og.label = g;
    for (const p of POSE.list.filter(p => (p.group || 'Armory') === g)) og.append(new Option(p.name, p.animation));
    sel.append(og);
  }
}
async function setPose(hash, { play = true, time = null, quiet = false } = {}) {
  if (!hash) { POSE.clip = null; R.pose = null; POSE.playing = false; $('poseTime').disabled = true; return; }
  if (!quiet) status('Loading the pose…');
  let clip = POSE.cache.get(hash);
  if (!clip) {
    try { clip = prepareClip(await api('/api/anim?hash=' + hash)); } catch (e) { return status('The pose could not be loaded: ' + e.message, true); }
    POSE.cache.set(hash, clip);
  }
  POSE.clip = clip;
  POSE.time = time ?? 0;
  POSE.playing = play;
  POSE.t0 = performance.now() / 1000 - POSE.time;
  $('poseTime').disabled = false;
  $('poseTime').max = clip.length;
  $('posePlay').textContent = play ? '❚❚' : '▶';
  R.pose = { clip, time: POSE.time };
  if (!quiet) status(`${$('pose').selectedOptions[0]?.text ?? 'Pose'}: ${clip.length.toFixed(1)} s`);
}
function tickPose() {
  if (!POSE.clip) return;
  if (POSE.playing) {
    POSE.time = (performance.now() / 1000 - POSE.t0) % Math.max(POSE.clip.length, 1e-3);
    $('poseTime').value = POSE.time;
  }
  const t = R.pose?.time;
  R.pose = { clip: POSE.clip, time: POSE.time };
  if (HELD.pieces.length && t !== POSE.time) gripHeld();
}

// ---------- the held weapon: with a pose that holds one (the Armory's, the moves), a weapon in the Helldiver's hands,
// placed as the game links it (scene.js holdWeapon: on attach_hand_r, the left arm bent to its IK_left); its pieces
// are pieces as any (pick one to edit its LUTs: an edit pulls the weapon's kit into the project)
const HELD = { kit: null, pieces: [], loading: null };
function fillHeldMenu() {
  const sel = $('heldWeapon');
  if (sel.options.length) return;
  const guns = (S.kitList ?? []).filter(e => e.type === 'Weapon');
  sel.add(new Option('No weapon', ''));
  for (const e of guns) sel.add(new Option(e.label, e.value));
  sel.value = '';   // (none at first)
}
// the held weapon as the pose and the menu say (force: load it again, e.g. another weapon)
async function updateHeld(force = false) {
  fillHeldMenu();
  const name = $('pose').selectedOptions[0]?.text, holds = !!$('pose').value && S.mode === 'char' && holdsWeapon(POSE.list, name);
  $('heldWeapon').hidden = !holds;
  const want = holds ? $('heldWeapon').value : '';
  if (!force && want === HELD.kit && (!want || HELD.pieces.length)) { if (want) gripHeld(); return; }
  dropHeld();
  HELD.kit = want;
  if (!want) return;
  const gen = S.loadGen, before = new Set(R.pieces);
  try {
    const ps = ((await api('/api/kit?name=' + encodeURIComponent(want))) ?? []).filter(p => p.material_lut);
    if (!ps.length || gen !== S.loadGen || HELD.kit !== want) return;
    const kitUnits = await weaponUnits(ps[0].kit_id, ps[0].kit_units?.length ? ps[0].kit_units : [...new Set(ps.map(p => p.unit))].map(u => ({ unit: u })));
    let body = null;
    for (const ku of kitUnits) {
      const glb = parseGLB(await (await api('/api/unit?hash=' + ku.unit)).arrayBuffer());
      let mats = [null];
      if (!body) body = glb;
      else { const mounts = ku.mount ? [ku.mount] : vehicleMount(ku.name ?? ''); mats = mounts ? mounts.map(m => mountMatrix(body, m, glb)).filter(Boolean) : [null]; if (!mats.length) continue; }
      for (const m of mats) for (const prim of extractPieces(glb, { variant: ps[0].skin, vehicle: true })) {
        if (m) transformPrim(prim, m);
        const pc = ps.find(p => p.unit === ku.unit && p.slot === prim.slot), lut = pc?.material_lut || prim.tex.lut;
        if (!lut) continue;
        const pat = pc?.pattern_lut || prim.tex.patternLut;
        try { await loadVanilla(lut); } catch { continue; }
        if (pat) await loadVanilla(pat).catch(() => null);
        if (gen !== S.loadGen || HELD.kit !== want) return dropHeld();
        await R.addPiece(prim, { edited: editedKey(lut), vanilla: 'v:' + lut, pattern: pat ? editedKey(pat) : null },
          { lut, slot: prim.slot, unit: ku.unit, pattern: pat, vehicle: true, held: true, kitRef: 'kit:' + ps[0].kit_id });
      }
    }
  } catch (e) { console.warn('held weapon', e); status('The weapon could not be loaded: ' + e.message, true); }
  HELD.pieces = R.pieces.filter(p => !before.has(p) && p.info?.held);
  gripHeld();
  renderLists();
}
function dropHeld() {
  R.removePieces(p => p.info?.held);
  for (const p of R.pieces) if (p.pose && p.pose.world) delete p.pose;   // (the arm back on the pose)
  HELD.pieces = [];
}
// the weapon on the hands for the pose at this moment (the Helldiver unturned, at the origin)
function gripHeld() {
  if (!HELD.pieces.length || !R.pose) return;
  const h = { n: 0, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], shift: [0, 0, 0], pose: R.pose, pieces: R.pieces.filter(p => !p.info?.held), posed: null };
  holdWeapon(R, h, 0, {}, HELD.pieces);
}

// The Armory menu's cameras (game.dll's per-tab presets: yaw, distance, height; level; 22.5 deg vertical): the
// character turned 20 deg to its right (the cape tab: 160), here the camera turned instead (yaw = pi + 20 deg; checked against an in-game screenshot);
const CAMERAS = {
  'Front ¾': { yaw: Math.PI + 0.5, pitch: 0.15 }, 'Front': { yaw: Math.PI, pitch: 0.05 }, 'Back ¾': { yaw: 0.5, pitch: 0.15 },
  'Back': { yaw: 0, pitch: 0.05 }, 'Side': { yaw: Math.PI * 1.5, pitch: 0.05 }, 'Helmet': { yaw: Math.PI + 0.4, pitch: 0.1, helmet: true },
  'Armory: overview': { yaw: Math.PI + 0.3491, pitch: 0, at: { target: [0, 1.2, 0], dist: 6.5, fov: 0.3927 } },
  'Armory: armor': { yaw: Math.PI + 0.3491, pitch: 0, at: { target: [0, 0.9, 0], dist: 4.8, fov: 0.3927 } },
  'Armory: helmet': { yaw: Math.PI + 0.3491, pitch: 0, at: { target: [0, 1.55, 0], dist: 2.3, fov: 0.3927 } },
  'Armory: cape': { yaw: 0.3491, pitch: 0, at: { target: [0, 0.9, 0], dist: 4.8, fov: 0.3927 } },
};
// between two Armory cameras: a 0.25 s linear glide (the game's tab change: yaw the short way, distance, height)
let camGlide = null;
function glideCamera(to) {
  const from = { yaw: R.cam.yaw, dist: R.cam.dist, target: [...R.cam.target] }, t0 = performance.now();
  const TAU = 2 * Math.PI, dy = ((((to.yaw - from.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;   // (the short way)
  const id = camGlide = {};
  const step = () => {
    if (camGlide !== id) return;
    const f = Math.min(1, (performance.now() - t0) / 250);
    R.cam.yaw = from.yaw + dy * f; R.cam.dist = from.dist + (to.at.dist - from.dist) * f;
    R.cam.target = from.target.map((v, k) => v + (to.at.target[k] - v) * f);
    if (f < 1) requestAnimationFrame(step); else { camGlide = null; R.cam.yaw = to.yaw; }
  };
  step();
}
let camName = null;
function setCamera(name) {
  const c = CAMERAS[name] ?? CAMERAS['Front ¾'], was = CAMERAS[camName];
  camName = name;
  if (c.at && was?.at && R.cam.fov === c.at.fov) { R.cam.pitch = c.pitch; return glideCamera(c); }
  camGlide = null;
  R.frame();
  R.cam.yaw = c.yaw; R.cam.pitch = c.pitch; R.cam.fov = c.at?.fov; R.cam.shiftX = c.at?.shiftX;
  if (c.at) { R.cam.target = [...c.at.target]; R.cam.dist = c.at.dist; }
  if (c.helmet && R.pieces.length) {
    const hi = Math.max(...R.pieces.map(p => p.bounds[1][1]));
    R.cam.target = [R.cam.target[0], hi - 0.13, R.cam.target[2]];
    R.cam.dist = 1.0;
  }
}

let lastT = 0;
function loop() {
  const cv = $('canvas'), dpr = window.devicePixelRatio || 1;
  const now = performance.now() / 1000;
  if ($('turntable').checked && lastT) R.cam.yaw += (now - lastT) * 0.6;
  tickPose();
  lastT = now;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  try { R.draw(performance.now() / 1000); } catch (e) { status(e.message, true); return; }
  requestAnimationFrame(loop);
}

function wire() {
  const cv = $('canvas');
  let drag = null;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  let painting = false;   // the ID mask editor's brush on the model (S.paint): the left button paints
  cv.addEventListener('pointerdown', e => {
    if (S.paint && e.button === 0 && !e.shiftKey) { painting = S.paint.down(e); if (painting) cv.setPointerCapture(e.pointerId); return; }
    drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, moved: false }; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (painting) { S.paint?.move(e); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    const c = R.cam;
    if (drag.b === 2 || drag.shift) {
      const s = c.dist * 0.0015;
      const right = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
      c.target = [c.target[0] - right[0] * dx * s, c.target[1] + dy * s, c.target[2] - right[2] * dx * s];
    } else {
      c.yaw -= dx * 0.008;
      c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch + dy * 0.008));
    }
  });
  cv.addEventListener('pointerup', e => {
    if (painting) { painting = false; S.paint?.up(e); return; }
    if (drag && !drag.moved && drag.b === 0 && !S.paint) pickAt(e);
    drag = null;
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); R.cam.dist *= Math.exp(e.deltaY * 0.001); }, { passive: false });
  cv.addEventListener('dblclick', () => R.frame());
  $('frame').onclick = () => R.frame();
  $('env').onchange = () => { R.sunElevUser = null; lightsFor($('env').value); setEnv(); showSunElev(); };
  $('weather').onchange = () => setEnv();
  $('sceneryOn').onchange = e => { R.sceneryOn = e.target.checked; };
  $('sunAz').oninput = () => { if (R.env.game) setEnv(); else R.env.sunAz = +$('sunAz').value * Math.PI / 180; };
  $('exposure').oninput = setEnv;
  // Mission wear: the sliders fold away (remembered in this browser; folded at first in a short window)
  const wearFold = (v, save) => { $('worldBar').classList.toggle('folded', v); $('worldArrow').textContent = v ? '▸' : '▾';
    if (save) try { localStorage.setItem('lutstudio.wearFolded', v ? '1' : '0'); } catch { } };
  let folded = null;
  try { folded = localStorage.getItem('lutstudio.wearFolded'); } catch { }
  // until the user folds or unfolds it: folded in a short window (also when the window is resized)
  let wearAuto = folded === null;
  wearFold(wearAuto ? innerHeight < 800 : folded === '1', false);
  addEventListener('resize', () => { if (wearAuto) wearFold(innerHeight < 800, false); });
  $('worldToggle').onclick = () => { wearAuto = false; wearFold(!$('worldBar').classList.contains('folded'), true); };
  $('worldToggle').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('worldToggle').click(); } };
  // the sun: on / off, and its height (until another lighting is picked, which sets its own)
  $('sunOn').onchange = () => { R.sunOn = $('sunOn').checked; };
  $('shadowsOn').onchange = () => { R.shadows = $('shadowsOn').checked; };
  $('sunEl').oninput = () => { R.sunElevUser = +$('sunEl').value; };
  // Reset: the Adjust menu as it starts (the sun from the front, 45° up; the lighting's own height until moved)
  $('lightReset').onclick = () => {
    $('exposure').value = 0; $('sunAz').value = 180; $('sunOn').checked = true; $('shadowsOn').checked = true; $('sceneryOn').checked = true;
    Object.assign(R, { sunOn: true, shadows: true, sceneryOn: true, sunElevUser: null });
    R.rim.forEach((l, i) => { Object.assign(l, RIM_DEFAULT[i]); $('rim' + i).checked = l.on; $('rim' + i + 'Az').value = l.az; $('rim' + i + 'El').value = l.el; });
    try { localStorage.removeItem('lutstudio.rim2'); } catch { }
    setEnv(); showSunElev();
  };
  // the side lights: on / off, direction and height, remembered in this browser
  const RIM_DEFAULT = R.rim.map(l => ({ on: l.on, az: l.az, el: l.el }));
  if (S.lightsInit) setTimeout(() => lightsFor($('env').value), 0);
  let rimSaved = null;
  try { rimSaved = JSON.parse(localStorage.getItem('lutstudio.rim2') ?? 'null'); } catch { }
  R.rim.forEach((l, i) => {
    if (rimSaved?.[i]) { l.on = !!rimSaved[i].on; l.az = +rimSaved[i].az || 0; l.el = Number.isFinite(+rimSaved[i].el) ? +rimSaved[i].el : l.el; }
    $('rim' + i).checked = l.on; $('rim' + i + 'Az').value = l.az; $('rim' + i + 'El').value = l.el;
    const set = () => {
      l.on = $('rim' + i).checked; l.az = +$('rim' + i + 'Az').value; l.el = +$('rim' + i + 'El').value;
      try { localStorage.setItem('lutstudio.rim2', JSON.stringify(R.rim.map(x => ({ on: x.on, az: x.az, el: x.el })))); } catch { }
    };
    $('rim' + i).onchange = set; $('rim' + i + 'Az').oninput = set; $('rim' + i + 'El').oninput = set;
  });
  $('debugView').onchange = () => { R.debug = +$('debugView').value; };
  $('split').onchange = () => { R.split = $('split').checked; };
  $('variant').onchange = async () => {
    const to = $('variant').value;
    $('variant').value = S.variant;   // (until the switch can happen)
    if (!(await closeSide())) return;
    if (!(await saveAll())) return;
    $('variant').value = to;
    await loadVariant(to);
  };
  $('kit').onchange = () => { if ($('kit').value) showItem($('kit').value).catch(e => status(e.message, true)); };
  $('body').onchange = () => { S.body = $('body').value; reload(); };
  $('save').onclick = saveAll;
  $('build').onclick = build;
  $('newVariant').onclick = newVariant;
  $('snapIcon').onclick = () => snap('icon');
  $('snapVariant').onclick = () => snap(S.variant);
  $('decals').onclick = () => { track('editor opened', { editor: 'decals' }); decalDialog(R, S.variant); };
  $('decalNum').oninput = () => { R.decalId = Math.max(0, Math.min(+$('decalNum').max, Math.round(+$('decalNum').value || 0))); decalRole(); };
  $('design').onclick = () => (track('editor opened', { editor: 'cape design' }), designDialog(R, S.variant)).catch(e => status('Cape design: ' + e.message, true));
  $('masksBtn').onclick = () => (track('editor opened', { editor: 'masks' }), maskDialog)({
    R, variant: S.variant, startLut: S.sel.lut,
    zoneColors: h => { const l = S.luts.get(h), a = l?.edited ?? l?.vanilla; return a ? Array.from({ length: l.h }, (_, z) => [0, 1, 2].map(ch => a[cell(l, z, 0, ch)])) : []; },
    zoneLabel: (h, z) => S.luts.get(h)?.labels?.[z] || `zone ${z}`,
    lutLabel: h => describeLut(h, S.luts.get(h)?.kind).badge,
    // a pattern LUT: on (texel 0's alpha isn't -1), the mask layer it picks (that alpha) and its color (texel 0)
    patternInfo: h => { const l = S.luts.get(h), a = l?.edited ?? l?.vanilla; return a ? { on: a[3] !== -1, layer: a[3], color: [a[0], a[1], a[2]] } : null; },
    setPaint: hd => { S.paint = hd; $('canvas').classList.toggle('painting', !!hd); },
    pickUV,
  }).catch(e => status('ID masks: ' + e.message, true));
  $('rolesBtn').onclick = () => (track('editor opened', { editor: 'roles' }), rolesDialog)({
    R, api, variant: S.variant, body: () => S.body, lut: h => S.luts.get(h), fields: S.schema.material,
    lutLabel: h => { const d = describeLut(h, S.luts.get(h)?.kind); return `${d.badge}: ${d.parts}`; },
    showItem, editedKey, status,
    current: () => {
      const a = armorEntry(), helmet = S.look.helmet === 'match' ? ownHelmetOf(a) : S.look.helmet;
      return S.mode === 'other' ? [S.kit] : [S.look.armor, helmet, S.look.cape].filter(Boolean);
    },
    setPick: f => { S.onPick = f; },
  }).catch(e => status('Roles: ' + e.message, true));
  // the bar's pop-up panels (Adjust, Snapshot): one open at a time, closed by a click elsewhere or Escape
  const pops = [...document.querySelectorAll('details.pop')];
  pops.forEach(d => d.addEventListener('toggle', () => { if (d.open) pops.forEach(o => { if (o !== d) o.open = false; }); }));
  document.addEventListener('pointerdown', e => pops.forEach(d => { if (d.open && !d.contains(e.target)) d.open = false; }));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') pops.forEach(d => { d.open = false; }); });
  for (const id of ['snapIcon', 'snapVariant']) $(id).addEventListener('click', () => { $('snapPop').open = false; });
  $('tools').onchange = () => { const v = $('tools').value; $('tools').value = ''; if (v) $(v)?.click(); };
  $('themeBtn').onclick = () => {
    track('editor opened', { editor: 'theme' });
    themeDialog({
      R, api, variant: S.variant, lut: h => S.luts.get(h), showItem, saveAll, status, track,
      lutLabel: h => { const d = describeLut(h, S.luts.get(h)?.kind); return `${d.badge}: ${d.parts}`; },
      current: () => {
        const a = armorEntry(), helmet = S.look.helmet === 'match' ? ownHelmetOf(a) : S.look.helmet;
        return S.mode === 'other' ? [S.kit] : [S.look.armor, helmet, S.look.cape].filter(Boolean);
      },
      refresh: async () => { S.state = await api('/api/state'); fillKits(); await loadVariant(S.variant); },
      projectLuts: () => new Set(S.state.variants.flatMap(v => (v.luts ?? []).map(l => l.lut))),
      openShowcase: o => openShowcase(showcaseApp(), o),
    }).catch(e => status('Theme: ' + e.message, true));
  };
  $('showcaseBtn').onclick = () => (track('editor opened', { editor: 'showcase' }), openShowcase(showcaseApp()));
  for (const n of Object.keys(CAMERAS)) $('camera').add(new Option(n, n));
  $('camera').onchange = () => setCamera($('camera').value);
  $('pose').onchange = async () => { await setPose($('pose').value); updateHeld(); };
  $('heldWeapon').onchange = () => updateHeld(true);
  for (const [id, part] of [['wearArmor', 'armor'], ['wearHelmet', 'helmet'], ['wearCape', 'cape']])
    $(id).onchange = () => { S.look[part] = $(id).value; saveLook(); loadCharacter(); };
  $('posePlay').onclick = () => {
    if (!POSE.clip) return;
    POSE.playing = !POSE.playing;
    POSE.t0 = performance.now() / 1000 - POSE.time;
    $('posePlay').textContent = POSE.playing ? '❚❚' : '▶';
  };
  $('poseTime').oninput = () => { POSE.playing = false; POSE.time = +$('poseTime').value; $('posePlay').textContent = '▶'; };
  $('projects').onclick = async () => {
    await saveAll(); await api('/api/close', { method: 'POST' });
    try { sessionStorage.removeItem('lutstudio.project'); } catch { }
    location.reload();
  };
  $('projectBtn').onclick = projectDialog;
  $('modPageBtn').onclick = () => modPage({
    api, shot, state: () => S.state, variant: () => S.variant,
    kitType: id => (S.kitList ?? []).find(e => e.value === 'kit:' + id)?.type,
    useVariant: async f => { await saveAll(); await loadVariant(f); $('variant').value = f; },
    refresh: async () => { S.state = await api('/api/state'); $('projName').textContent = S.state.project.name; fillVariants(); },
  }).catch(e => status(e.message, true));
  $('addArmor').onclick = addArmorDialog;
  $('modalClose').onclick = () => ($('modal').hidden = true);
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveAll(); }
    else if (k === 'z' && !e.shiftKey && !isTyping()) { e.preventDefault(); restore(S.undo, S.redo); }
    else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !isTyping()) { e.preventDefault(); restore(S.redo, S.undo); }
  });
  window.addEventListener('beforeunload', e => { if ([...S.luts.values()].some(l => l.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  buildWorldSliders();
}
// typing text (Ctrl+Z / Ctrl+Y are the field's own): text-like inputs, text areas, editable text; not checkboxes,
// sliders or menus
const isTyping = () => {
  const a = document.activeElement;
  return a?.tagName === 'TEXTAREA' || !!a?.isContentEditable || (a?.tagName === 'INPUT' && ['text', 'number', 'search', 'email', 'password', 'url', ''].includes(a.type));
};

// the part and its UV0 under the pointer (two pick passes: which part, then where on it)
function pickUV(e) {
  const cv = $('canvas'), dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  const at = { x: Math.round((e.clientX - r.left) * dpr), y: Math.round((e.clientY - r.top) * dpr) };
  const hit = R.draw(0, at);
  if (!hit) return null;
  const uv = R.draw(0, { ...at, mode: 2 });
  return { piece: hit.piece, u: uv.u, v: uv.v };
}

function pickAt(e) {
  if (R.post) return;   // (the showcase: nothing to pick)
  const cv = $('canvas'), dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  const hit = R.draw(0, { x: Math.round((e.clientX - r.left) * dpr), y: Math.round((e.clientY - r.top) * dpr) });
  if (!hit) return;
  const p = R.pieces[hit.piece];
  if (!p) return;
  if (S.onPick) return S.onPick({ lut: p.info.lut, zone: hit.zone, piece: hit.piece });   // the Roles panel
  // not in the project: edit its game values right away; the first change adds it (a worn cape: both its LUTs)
  preview(p.info.lut, p.info.kitRef ?? p.info.lut);
  if (p.info.cape) preview(p.info.cape, p.info.kitRef ?? p.info.cape);
  S.sel.lut = p.info.lut;
  S.sel.zone = hit.zone;
  renderLists();
  renderFields();
  R.highlight = { lut: 'e:' + p.info.lut, zone: hit.zone, piece: -1 };
  setTimeout(() => { if (R.highlight.zone === hit.zone) R.highlight = { lut: null, zone: -1, piece: -1 }; }, 900);
}

// A LUT that isn't in the project, shown with its game values to edit. pull: what /api/pull adds once it is changed
// (the LUT, or 'kit:<id>' for a worn cape: both its LUTs, labeled).
function preview(hash, pull) {
  const l = S.luts.get(hash);
  if (!l || l.edited) return;
  Object.assign(l, { edited: l.vanilla.slice(), labels: [], dirty: false, pull });
  R.setLut('e:' + hash, l.w, l.h, l.edited);
  for (const p of R.pieces) {
    p.lutKeys.edited = editedKey(p.info.lut);
    if (p.info.cape) p.lutKeys.cape = editedKey(p.info.cape);
  }
}

// the first change to a previewed LUT: add it (and what shares its pull, a cape's other LUT) to every variant; the
// change itself is saved after (saveAll waits for this)
function adopt(l) {
  const what = l.pull, group = [...S.luts.entries()].filter(([, x]) => x.pull === what);
  group.forEach(([, x]) => { x.pull = null; });
  const prev = S.adopting;
  S.adopting = (async () => {
    await prev;
    try {
      await api('/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LUT: what }) });
      S.state = await api('/api/state');
      for (const [hash, x] of group) {
        try { const d = await api(`/api/doc?variant=${S.variant}&lut=${hash}`); if (!x.labels.length) x.labels = d.labels ?? []; x.note = d.note ?? ''; } catch { }
      }
      await loadMissingDocs();
      fillKits(); renderLists(); renderFields();
      status(`Added ${what.startsWith('kit:') ? 'the cape' : what} to the project (every variant)`);
    } catch (e) {
      group.forEach(([, x]) => { x.pull = what; });
      status('Could not add it to the project: ' + e.message, true);
    }
  })();
}

// the variant's LUTs that came into the project without being edited yet (a kit pulled in with one of its LUTs):
// their documents, so they can be picked and edited at once
async function loadMissingDocs() {
  const v = S.state.variants.find(x => x.folder === S.variant);
  for (const info of v?.luts ?? []) {
    let l = S.luts.get(info.lut);
    if (l?.edited) continue;
    try {
      if (!l?.vanilla) l = await loadVanilla(info.lut);
      const d = await api(`/api/doc?variant=${encodeURIComponent(S.variant)}&lut=${info.lut}`);
      Object.assign(l, { edited: new Float32Array(d.px), labels: d.labels ?? [], note: d.note ?? '' });
      R.setLut('e:' + info.lut, l.w, l.h, l.edited);
    } catch (e) { console.warn('doc', info.lut, e); }
  }
  for (const p of R.pieces) {
    p.lutKeys.edited = editedKey(p.info.lut);
    if (p.info.cape) p.lutKeys.cape = editedKey(p.info.cape);
    if (p.info.pattern) p.lutKeys.pattern = editedKey(p.info.pattern);
  }
}

// hash: the LUT to select afterwards; also: a second LUT, or 'kit:<id>' (pulls the kit's LUTs instead, with labels)
async function pullLut(hash, zone = 0, also = null) {
  await saveAll();
  try {
    const kitRef = also?.startsWith('kit:') ? also : null, alsoLut = kitRef ? null : also;
    await api('/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LUT: kitRef ?? hash }) });
    if (alsoLut) await api('/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LUT: alsoLut }) });
    S.state = await api('/api/state');
    fillKits();
    S.sel = { lut: hash, zone };
    await loadVariant(S.variant);
    S.sel = { lut: hash, zone };
    renderLists(); renderFields();
    status(`Added ${hash} to the project`);
  } catch (e) { status(e.message, true); }
}

async function build() {
  if (S.building) return;
  if (!(await closeSide())) return;
  if (!(await saveAll())) return;
  S.building = true;
  $('modalClose').disabled = true;   // (no editing while the build renders each variant's picture)
  showModal('Building…', 'Rendering the icon and variant pictures…');
  try {
    await autoImages();
    const r = await api('/api/build', { method: 'POST' });
    track('mod built', { ok: !!r.ok, error: r.ok ? '' : String(r.error ?? '').slice(0, 300), ...buildSummary(r) });
    showModal(r.ok ? 'Mod built - downloading' : 'Build failed', (r.log || '') + (r.error ? '\n' + r.error : '') +
      (r.ok ? `\nAlso saved in the project: ${r.path}\nImport the downloaded zip into HD2Arsenal / HD2 Mod Manager.` : ''));
    if (r.ok) {
      await window.lutstudioWeb.download('/api/download', 'mod.zip');
    }
  } catch (e) { showModal('Build failed', e.message); track('mod built', { ok: false, error: String(e.message).slice(0, 300) }); }
  finally { S.building = false; $('modalClose').disabled = false; }
}

// what a build holds, for the usage event: the mod's names, its items, and what was edited (the loaded variant's
// LUTs: which field groups changed, in how many LUTs and zones)
function buildSummary(r) {
  const groups = new Set();
  let luts = 0, zones = 0;
  for (const l of S.luts.values()) {
    if (!l.edited || !l.vanilla || l.pull) continue;
    const fields = (S.schema[l.kind] ?? []).filter(f => !f.hidden);
    let lc = false;
    for (let z = 0; z < l.h; z++) {
      let zc = false;
      for (const f of fields) if (f.leaves.some(([c, ch]) => l.edited[cell(l, z, c, ch)] !== l.vanilla[cell(l, z, c, ch)])) { groups.add(`${l.kind}.${f.group}`); zc = true; }
      if (zc) { zones++; lc = true; }
    }
    if (lc) luts++;
  }
  const st = S.state, vs = st.variants ?? [];
  return {
    mod: st.project.name, variants: vs.map(v => v.name), options: (st.project.options ?? []).map(o => o.name),
    items: st.kits.map(kitLabel).slice(0, 40), item_count: st.kits.length,
    luts_in_mod: (String(r.log ?? '').match(/ changed/g) ?? []).length, luts_changed: luts, zones_changed: zones, groups: [...groups].sort(),
    textures: vs.reduce((n, v) => n + (v.textures?.length ?? 0), 0),
  };
}

// The mod icon and the variant pictures: rendered in a fixed look (studio light from the camera side, front 3/4, clean) unless the user
// picked their own with the snapshot buttons (those stay).
async function renderImage(target, auto) {
  const keep = { cam: { ...R.cam, target: [...R.cam.target] }, env: R.env, world: R.world, debug: R.debug, split: R.split, hl: R.highlight };
  R.world = { ...WORLD }; R.debug = 0; R.split = false; R.highlight = { lut: null, zone: -1, piece: -1 };
  const keepPose = R.pose;
  const idle = POSE.list.find(p => p.name.startsWith('Armory idle'));
  if (idle) {                                         // icons show the armory pose, not the T-pose
    let clip = POSE.cache.get(idle.animation);
    if (!clip) { clip = prepareClip(await api('/api/anim?hash=' + idle.animation)); POSE.cache.set(idle.animation, clip); }
    R.pose = { clip, time: 0 };
  }
  setCamera('Front ¾');
  R.env = { ...ENVS['Studio'], sunAz: R.cam.yaw - 0.7, sunElev: 0.6, exposure: 1.15 };   // key light from the camera side
  // (the image's own lighting: not the view's light switches)
  const lights = { sunOn: R.sunOn, shadows: R.shadows, sunElevUser: R.sunElevUser, rim: R.rim };
  Object.assign(R, { sunOn: true, shadows: true, sunElevUser: null, rim: R.rim.map(l => ({ ...l, on: false })) });
  const cv = $('canvas'), size = Math.min(512, cv.width, cv.height);
  R.draw(0, null, [size, size]);
  Object.assign(R, lights);
  const out = document.createElement('canvas'); out.width = out.height = 512;
  out.getContext('2d').drawImage(cv, 0, cv.height - size, size, size, 0, 0, 512, 512);
  Object.assign(R, { cam: keep.cam, env: keep.env, world: keep.world, debug: keep.debug, split: keep.split, highlight: keep.hl, pose: keepPose });
  return api('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Target: target, PNG: out.toDataURL('image/png'), Auto: auto }) });
}

async function autoImages() {
  const p = S.state.project;
  if (!p.icon || p.icon_auto) await renderImage('icon', true);
  if (S.state.variants.length > 1) {
    const cur = S.variant, undo = S.undo, redo = S.redo;
    try {
      for (const v of S.state.variants) {
        if (v.image && !v.image_auto) continue;
        if (S.variant !== v.folder) await loadVariant(v.folder);
        await renderImage(v.folder, true);
      }
    } finally {   // (back to the variant being edited, also when a picture failed)
      if (S.variant !== cur) { await loadVariant(cur); S.undo = undo; S.redo = redo; }
      $('variant').value = cur;
    }
  }
  S.state = await api('/api/state');
}

// Another item (armor, helmet, cape, vehicle, weapon) in the same mod: its LUTs are added to every variant with the
// game's values, and it becomes one of the mod's own items in the Item menu. LUTs it shares with items already in the
// mod are kept.
async function addArmorDialog() {
  if (!(await closeSide())) return;
  $('modalBody').innerHTML = `<h3>Add an item to this mod</h3>
    <p class="hint">One mod can recolor several armors, helmets, capes, vehicles and weapons. The item's LUTs are added
      to every variant with the game's colors; switch between the mod's items with the Show menu.</p>
    <label class="stack">Category <select id="aaCat"></select></label>
    <label class="stack">Item <input type="search" id="aaFilter" placeholder="Filter by name…">
      <select id="aaPick" size="10"><option value="">Loading…</option></select></label>
    <label class="check" id="aaHelmetRow" hidden title="Add this armor's own helmet too"><input type="checkbox" id="aaHelmet" checked> <span id="aaHelmetText">with its matching helmet</span></label>
    <div class="row"><button id="aaAdd" class="primary" disabled>Add</button></div>`;
  $('modal').hidden = false;
  const sel = $('aaPick');
  const inMod = k => S.state.kits.includes(k.value) || S.state.kits.includes(k.set) || (k.value.startsWith('kit:') && S.state.kits.includes(k.name));
  // the start page's picker: a category, then an item of it (filtered by name); an armor can bring its set's helmet
  let kits = [];
  const fillItems = () => {
    const cat = $('aaCat').value, q = $('aaFilter').value.trim().toLowerCase();
    sel.innerHTML = '';
    for (const k of kits.filter(k => k.group === cat && (!q || k.label.toLowerCase().includes(q)))) {
      const o = new Option(k.label + (inMod(k) ? '  (in this mod)' : ''), k.value);
      o.dataset.name = k.name; o.dataset.label = k.label; o.dataset.set = k.set ?? ''; sel.add(o);
    }
    pick();
  };
  const pick = () => {
    const o = sel.selectedOptions[0];
    $('aaAdd').disabled = !o?.value;
    $('aaHelmetRow').hidden = !o?.dataset.set;
    if (o?.dataset.set) $('aaHelmetText').textContent = `with its matching helmet (${o.dataset.name})`;
  };
  try {
    kits = await api('/api/kits');
    const cats = [...new Set(kits.map(k => k.group))];
    $('aaCat').innerHTML = '';
    for (const c of cats) $('aaCat').add(new Option(`${c} (${kits.filter(k => k.group === c).length})`, c));
    // open on the category of what's shown
    const shown = kits.find(k => k.value === S.kit || k.value === S.look.armor);
    if (shown) $('aaCat').value = shown.group;
    fillItems();
  } catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
  $('aaCat').onchange = () => { $('aaFilter').value = ''; fillItems(); };
  $('aaFilter').oninput = fillItems;
  sel.onchange = pick;
  sel.ondblclick = () => { if (!$('aaAdd').disabled) $('aaAdd').click(); };
  $('aaAdd').onclick = async () => {
    const o = sel.selectedOptions[0];
    if (!o) return;
    const key = o.dataset.set && $('aaHelmet').checked ? o.dataset.set : o.value;   // the armor with its helmet
    const label = o.dataset.label;
    $('aaAdd').disabled = true;
    status(`Adding ${label}…`);
    await saveAll();
    try {
      await api('/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ LUT: key }) });
      S.state = await api('/api/state');
      await loadVariant(S.variant);
      fillKits();
      await loadCharacterMenus();
      $('modal').hidden = true;
      await showItem(o.value);
      status(`Added ${label} to the mod (every variant)`);
    } catch (e) { $('aaAdd').disabled = false; status(e.message, true); }
  };
}

async function projectDialog() {
  if (!(await closeSide())) return;
  const p = S.state.project;
  $('modalBody').innerHTML = `<h3>Project</h3>
    <p class="hint">The mod's name, description, icon, variants and pictures: <a href="#" id="pdModPage">Mod page…</a></p>
    <h3>Copies and sharing</h3>
    <div class="row"><button id="pdSaveAs">Save as a new project…</button><span class="hint">a copy to keep working on; it becomes its own mod</span></div>
    <div class="row"><button id="pdExport">Export .lutproj</button><span class="hint">the whole project in one file, to back up or share</span></div>
    <p class="hint">Saved in ${esc(S.home?.project ?? '')}. Everything you change is written as you work.</p>`;
  $('modal').hidden = false;
  $('pdModPage').onclick = e => { e.preventDefault(); $('modal').hidden = true; $('modPageBtn').click(); };
  $('pdSaveAs').onclick = async () => {
    const name = prompt('Name of the copy:', p.name + ' copy');
    if (!name) return;
    await saveAll();
    try { await api('/api/saveas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: name }) }); location.reload(); }
    catch (e) { status(e.message, true); }
  };
  $('pdExport').onclick = async () => { await saveAll(); await window.lutstudioWeb.download('/api/export', 'project.lutproj'); };
}

async function newVariant() {
  if (!(await closeSide())) return;
  const name = prompt('Name of the new variant (a copy of the current one):');
  if (!name) return;
  if (!(await saveAll())) return;
  try {
    const v = await api('/api/variant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: name, From: S.variant }) });
    S.state = await api('/api/state');
    S.variant = v.folder;
    fillVariants();
    await loadVariant(v.folder);
  } catch (e) { status(e.message, true); }
}

// The view as a 512 x 512 PNG (data URL), cut to a square from its middle; bg: {kind: 'view' | 'none' (transparent)
// | 'color', color}
function shot(bg = { kind: 'view' }) {
  const split = R.split, hl = R.highlight, noSky = R.noSky;
  R.split = false; R.highlight = { lut: null, zone: -1, piece: -1 }; R.noSky = bg.kind !== 'view';
  R.draw(0);
  const cv = $('canvas'), s = Math.min(cv.width, cv.height);
  const out = document.createElement('canvas'); out.width = out.height = 512;
  const g = out.getContext('2d');
  if (bg.kind === 'color') { g.fillStyle = bg.color; g.fillRect(0, 0, 512, 512); }
  g.drawImage(cv, (cv.width - s) / 2, (cv.height - s) / 2, s, s, 0, 0, 512, 512);
  R.split = split; R.highlight = hl; R.noSky = noSky;
  return out.toDataURL('image/png');
}

async function snap(target) {
  try {
    const r = await api('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Target: target, PNG: shot() }) });
    status(`Saved ${r.path} - the next build uses it`);
  } catch (e) { status(e.message, true); }
}

// Mission wear. Blood and gunk show only above ~0.5 (the game's
// threshold); snow replaces mud; scorch is all-or-nothing in the game.
const WORLD_UI = [
  ['dirt', 'Dirt', 'Darkens and roughens (no color); hollows first, edges stay cleaner'],
  ['mud', 'Mud', 'Special weathering, mud mode: wet, adds to dirt'],
  ['blood', 'Blood', 'Shows from ~0.5 (the game\'s threshold), full at ~0.63'],
  ['gunk', 'Bug gunk', 'Shows from ~0.5, like blood'],
  ['wet', 'Wetness', 'Darker and glossier; cloth loses its sheen'],
  ['snow', 'Snow', 'Snow mode (replaces mud); under a planet light, the color of that planet snow (else a neutral white)'],
  ['frost', 'Frost', 'Pale blue-white frost on the grunge pattern'],
  ['burn', 'Burn', 'Animated burn glow on non-metal edges (replaces the LUT glow)'],
];
function buildWorldSliders() {
  const box = $('worldSliders');
  for (const [key, name, tip] of WORLD_UI) {
    const lab = document.createElement('label');
    lab.title = tip;
    lab.innerHTML = `${name} <input type="range" min="0" max="1" step="0.01" value="0" data-key="${key}">`;
    lab.querySelector('input').oninput = e => { R.world[key] = +e.target.value; };
    box.appendChild(lab);
  }
  const dmg = document.createElement('label');
  dmg.id = 'damageRow'; dmg.hidden = !R.pieces.some(p => p.damageTex);   // (renderLists updates it per model)
  dmg.title = 'Vehicle damage (the game: 1 - health / max) on the zones the material marks: dents and bare metal from the start, worn spots darken and roughen past half';
  dmg.innerHTML = 'Damage <input type="range" min="0" max="1" step="0.01" value="0">';
  dmg.querySelector('input').oninput = e => { R.world.damage = +e.target.value; };
  box.appendChild(dmg);
  const sc = document.createElement('label');
  sc.className = 'check';
  sc.title = 'Burnt look: darker, sooty, heat-tinted iridescence (on or off, as in the game)';
  sc.innerHTML = '<input type="checkbox"> Scorch';
  sc.querySelector('input').onchange = e => { R.world.scorch = e.target.checked ? 1 : 0; };
  box.appendChild(sc);
  const reset = document.createElement('button');
  reset.textContent = 'Clean';
  reset.onclick = () => { Object.assign(R.world, WORLD); box.querySelectorAll('input').forEach(i => (i.type === 'range' ? (i.value = 0) : (i.checked = false))); };
  box.appendChild(reset);
  $('worldNote').textContent = 'from the decoded shader; real mission values are not known yet';
}

function showModal(title, text) {
  $('modalBody').innerHTML = `<h3>${esc(title)}</h3><pre>${esc(text)}</pre>`;
  $('modal').hidden = false;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function boot() {
  // ?devgame=1 (tools/webserve.mjs, tests): the install served over HTTP, mounted once per visit
  if (new URLSearchParams(location.search).has('devgame') && !window.lutstudioWeb.mounted) {
    const err = await window.lutstudioWeb.mountGame(await (await fetch('/devgame/list.json')).json());
    if (err) status(err, true);
  }
  // the projects folder on disk (Chrome / Edge), mounted before the projects are listed
  const projects = await window.lutstudioWeb.restoreProjects().catch(() => ({ state: 'browser' }));
  S.home = await api('/api/home');
  S.home.projects = projects;
  window.lutstudioVersion = S.home.version;
  trackErrors(S.home.project ? 'editor' : 'start');
  try {
    if (!sessionStorage.getItem('lutstudio.opened')) {
      sessionStorage.setItem('lutstudio.opened', '1');
      track('site opened', { screen: `${screen.width}x${screen.height}`, game_ok: !!S.home.game_ok, projects: S.home.projects?.state ?? '' });
    }
  } catch { }
  // the project this tab had open (the API restarts with the page): opened again
  let last = null;
  try { last = sessionStorage.getItem('lutstudio.project'); } catch { }
  if (!S.home.project && last && S.home.game_ok) {
    try { await api('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Path: last }) }); S.home = { ...await api('/api/home'), projects }; }
    catch { try { sessionStorage.removeItem('lutstudio.project'); } catch { } }
  }
  if (S.home.project) try { sessionStorage.setItem('lutstudio.project', S.home.project); } catch { }
  if (!S.home.project) return showHome(S.home);
  if (!S.home.game_ok) { showHome(S.home); return; }
  S.presets = await api('/api/presets').catch(() => []);
  await init();
  await loadPoses();
  // the default pose: the Armory's first idle (no weapon in hand until one is picked)
  const idle = [...$('pose').options].find(o => o.text === 'Armory idle 1');
  if (idle && S.mode === 'char') { $('pose').value = idle.value; await setPose(idle.value, { quiet: true }); updateHeld(); }
  setCamera('Front ¾');
  let report = null;       // a mod was just imported (start page): say what came in
  try { report = sessionStorage.getItem('lutstudio.importReport'); sessionStorage.removeItem('lutstudio.importReport'); } catch { }
  if (report) showModal('Mod imported', report);
  document.title = `${S.state.project.name} - LUT Studio`;
}
boot().catch(e => { console.error(e); status(e.message, true); });
