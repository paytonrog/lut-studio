// The planet scene (planet lighting's scenery): a stripped-down stand-in for a planet's map around what is shown:
// gentle hills of the planet's ground (flat where the model stands), and its big props as its map stamps place them,
// by how much of the view each takes (planets.json: scenery): the game's own meshes of its rocks, moss and roots in
// their graded albedo, the rocks' surface the biome's rock texture (the game binds each rock's own as the map loads);
// its trees the game's SpeedTree meshes (bark, leaf cards cut out by their atlas), their textures' detail in their
// graded albedo (one that doesn't load: a trunk and a crown); near the model, the small scatter of its ground cover
// (grass, moss, heather, ferns: tufts of blades; small rocks) in the albedo of its plants, by their coverage. Lit by
// the planet's sun and sky as the model is, fogged toward the sky, exposed and written as the model is (shaped for
// the planet's grading). Not the game's terrain (that is generated as a mission loads) nor its layout.

import { texLinear } from './planet.js';

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNrm; layout(location = 2) in vec3 aCol; layout(location = 3) in vec2 aUv;
uniform mat4 uVP; uniform mat4 uM;
out vec3 vP; out vec3 vN; out vec3 vCol; out vec2 vUv;
void main() { vP = (uM * vec4(aPos, 1.0)).xyz; vN = transpose(inverse(mat3(uM))) * aNrm; vCol = aCol; vUv = aUv; gl_Position = uVP * vec4(vP, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vP; in vec3 vN; in vec3 vCol; in vec2 vUv; out vec4 o;
uniform sampler2D uPartTex; uniform float uCutoff;   // (uMode 4: a tree part; its texture: detail in r, cut-out in a)
// uMode: 0 a prop (its albedo x the rock detail), 1 the terrain, 2 plants (their vertex albedo), 3 small rocks (vertex
// albedo x the rock detail)
uniform vec3 uAlb; uniform int uMode; uniform sampler2D uGroundTex; uniform sampler2D uRockTex; uniform int uRockOn;
uniform vec3 uSunDir, uSunCol, uZen, uHor, uGnd, uEye; uniform float uExposure, uFogDist; uniform int uGradeOn;
uniform float uFloorY; uniform vec4 uFoot; uniform vec2 uCast;
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float h3(vec3 p) { return fract(sin(dot(floor(p), vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 f = fract(p), u = f * f * (3.0 - 2.0 * f); vec3 i = floor(p);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), u.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), u.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), u.x), u.y), u.z); }
float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * t); }
void main() {
  vec3 N = normalize(vN);
  if (uMode == 4 && !gl_FrontFacing) N = -N;   // (leaf cards: two-sided)
  vec3 alb; float sh = 0.0, occ = 1.0;
  if (uMode == 1) {
    alb = s2l(texture(uGroundTex, vP.xz / 4.0).rgb);
    vec2 q = (vP.xz - uFoot.xy) / uFoot.zw; float contact = 1.0 - smoothstep(0.6, 1.4, length(q));
    float r = max(uFoot.z, uFoot.w);
    sh = max(contact * 0.75, (1.0 - smoothstep(0.35 * r, 1.1 * r, segDist(vP.xz, uFoot.xy, uFoot.xy + uCast))) * 0.8);
    occ = 1.0 - 0.45 * contact;
  } else if (uMode == 4) {
    vec4 t = texture(uPartTex, vUv);
    // (the mips average the cut-out away: its alpha raised with the level, so far leaves stay leafy)
    vec2 dx = dFdx(vUv * vec2(textureSize(uPartTex, 0))), dy = dFdy(vUv * vec2(textureSize(uPartTex, 0)));
    float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    if (t.a * (1.0 + 0.3 * lod) < uCutoff) discard;
    alb = uAlb * t.r * 2.0;
    occ = 0.6 + 0.4 * clamp((vP.y - uFloorY) / 12.0, 0.0, 1.0);
  } else if (uMode == 2) {
    alb = vCol * (0.65 + 0.3 * n3(vP * 3.0));   // (a clump shades itself)
    occ = 0.55 + 0.45 * clamp((vP.y - uFloorY) * 2.0, 0.0, 1.0);   // (darker toward the roots)
  } else {
    vec3 a = uMode == 3 ? vCol : uAlb;
    if (uRockOn == 1) {   // the rock detail, mapped from the three axes (mean 1: the prop's albedo kept)
      vec3 w = pow(abs(N), vec3(4.0)); w /= w.x + w.y + w.z;
      vec3 t = texture(uRockTex, vP.zy * 0.22).rgb * w.x + texture(uRockTex, vP.xz * 0.22).rgb * w.y + texture(uRockTex, vP.xy * 0.22).rgb * w.z;
      alb = a * t * 2.0;
    } else alb = a * (0.75 + 0.5 * (n3(vP * 0.6) * 0.6 + n3(vP * 2.3) * 0.4));
    occ = 0.65 + 0.35 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0);   // (undersides darker)
  }
  vec3 sky = mix(uGnd, mix(uHor, uZen, 0.6), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = alb * (uSunCol * max(dot(N, normalize(uSunDir)), 0.0) / 3.14159 * (1.0 - sh) + sky * occ) * uExposure;
  float d = length(vP - uEye);
  col = mix(col, uHor * uExposure * 0.6, smoothstep(0.25 * uFogDist, uFogDist, d));
  if (uGradeOn == 1) col = clamp((log2(max(col, vec3(1e-6)) / 0.18) + 12.0) / 18.5, 0.0, 1.0);
  else col = l2s(clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0));
  o = vec4(col, 1.0);
}`;

// a seeded random (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// the hills: flat within 12 m of the center, rising to amp by 45 m (sums of turned waves; seeded per planet)
function hillsFn(id, amp) {
  const r = rng(hashStr(id)), w = Array.from({ length: 5 }, (_, i) => {
    const a = r() * 6.283, f = 0.012 * (1 + i * 0.9) * (0.8 + 0.4 * r());
    return [Math.cos(a) * f, Math.sin(a) * f, r() * 6.283, 1 / (1 + i)];
  });
  const tot = w.reduce((s, x) => s + x[3], 0);
  return (x, z) => {
    let v = 0; for (const [a, b, ph, k] of w) v += k * Math.sin(a * x + b * z + ph);
    const rr = Math.hypot(x, z), t = Math.min(1, Math.max(0, (rr - 12) / 33));
    return amp * (0.5 + 0.5 * v / tot) * t * t * (3 - 2 * t);
  };
}

function mesh(gl, pos, nrm, idx, col = null, uv = null) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  for (const [loc, data, n] of [[0, pos, 3], [1, nrm, 3], [2, col ?? new Float32Array(pos.length), 3], [3, uv ?? new Float32Array(pos.length / 3 * 2), 2]]) {
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  }
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, n: idx.length };
}

function terrainMesh(gl, h) {
  const n = 129, S = 240, pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3), idx = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * S, z = (j / (n - 1) - 0.5) * S, e = 0.5, o = (j * n + i) * 3;
    pos.set([x, h(x, z), z], o);
    const dx = (h(x + e, z) - h(x - e, z)) / (2 * e), dz = (h(x, z + e) - h(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    nrm.set([-dx / l, 1 / l, -dz / l], o);
  }
  let k = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k); k += 6; }
  return mesh(gl, pos, nrm, idx);
}

// a unit sphere (subdivided octahedron) and a unit cylinder (radius 1, 0..1 high), for the simplified trees
function sphereMesh(gl) {
  let v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let s = 0; s < 3; s++) {
    const cache = new Map(), mid = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!cache.has(k)) { const m = v[a].map((x, i) => (x + v[b][i]) / 2), l = Math.hypot(...m); v.push(m.map(x => x / l)); cache.set(k, v.length - 1); } return cache.get(k); };
    f = f.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]; });
  }
  const r = rng(7), pos = new Float32Array(v.flatMap(p => { const k = 0.85 + 0.3 * r(); return p.map(x => x * k); }));   // (lumpy)
  return mesh(gl, pos, new Float32Array(v.flat()), new Uint32Array(f.flat()));
}
function cylinderMesh(gl) {
  const s = 8, pos = [], nrm = [], idx = [];
  for (let i = 0; i <= s; i++) { const a = i / s * 6.283, c = Math.cos(a), d = Math.sin(a); pos.push(c, 0, d, c * 0.6, 1, d * 0.6); nrm.push(c, 0, d, c, 0, d); }
  for (let i = 0; i < s; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  return mesh(gl, new Float32Array(pos), new Float32Array(nrm), new Uint32Array(idx));
}

// the small scatter near the model (within 22 m, none under it): plant tufts (a few blades leaning out) and small
// half-buried rocks, each in one of the ground cover's albedos by its coverage; two merged meshes
function scatterMeshes(gl, p, h, r) {
  const fol = p.foliage ?? [], plants = fol.filter(f => f.kind === 'plant'), rocks = fol.filter(f => f.kind === 'rock');
  const pick = list => { const t = list.reduce((s, f) => s + f.weight, 0) * r(); let a = 0; for (const f of list) if ((a += f.weight) >= t) return f; return list[0]; };
  const out = {};
  for (const [kind, list] of [['plants', plants], ['rocks', rocks]]) {
    if (!list.length) continue;
    const cover = list.reduce((s, f) => s + f.weight, 0), n = Math.round(Math.min(kind === 'plants' ? 2200 : 300, Math.max(40, (kind === 'plants' ? 5000 : 2000) * cover)));
    const pos = [], nrm = [], col = [], idx = [];
    for (let i = 0; i < n; i++) {
      const rr = Math.sqrt(1.6 * 1.6 + (22 * 22 - 1.6 * 1.6) * r()), a = r() * 6.283, x = Math.sin(a) * rr, z = Math.cos(a) * rr, y = h(x, z);
      const f = pick(list), tone = 0.88 + 0.24 * r(), c = f.albedo.map(v => v * tone), base = pos.length / 3;
      if (kind === 'plants') {
        const hh = 0.15 + 0.4 * r() * r(), blades = 8 + Math.floor(r() * 7), wd = 0.018 + 0.016 * r();
        for (let b = 0; b < blades; b++) {
          const ang = r() * 6.283, lean = 0.2 + 0.5 * r(), dx = Math.sin(ang), dz = Math.cos(ang), px = -dz * wd, pz = dx * wd, bh = hh * (0.5 + 0.5 * r());
          const v0 = pos.length / 3, ox = x + dx * 0.04 * r(), oz = z + dz * 0.04 * r();
          pos.push(ox - px, y, oz - pz, ox + px, y, oz + pz, ox + dx * lean * bh, y + bh, oz + dz * lean * bh);
          for (let k = 0; k < 3; k++) { nrm.push(dx * 0.35, 0.94, dz * 0.35); col.push(...c); }
          idx.push(v0, v0 + 1, v0 + 2);
        }
      } else {
        const s = 0.08 + 0.3 * r() * r(), segs = 9;
        pos.push(x, y + s * 0.32, z); nrm.push(0, 1, 0); col.push(...c);
        for (let k = 0; k < segs; k++) {
          const a2 = k / segs * 6.283, m = 0.8 + 0.4 * r(), nx = Math.cos(a2), nz = Math.sin(a2);
          pos.push(x + nx * s * m, y - s * 0.05, z + nz * s * m); nrm.push(nx * 0.45, 0.9, nz * 0.45); col.push(...c);
          idx.push(base, base + 1 + k, base + 1 + (k + 1) % segs);
        }
      }
    }
    out[kind] = mesh(gl, new Float32Array(pos), new Float32Array(nrm), new Uint32Array(idx), new Float32Array(col));
  }
  return out;
}

// a texture of the install as a tree part's: its brightness over its mean (on its opaque texels) halved into r, its
// alpha (the cut-out) in a; at most 512 across (null: not an RGBA image)
const partTexCache = new Map();
function partTexture(gl, hash) {
  if (!partTexCache.has(hash)) partTexCache.set(hash, (async () => {
    const b = new Uint8Array(await (await fetch('/api/tex?hash=' + hash)).arrayBuffer()), dv = new DataView(b.buffer);
    const w = dv.getUint32(4, true), h = dv.getUint32(8, true), fmt = dv.getUint32(16, true);
    if (fmt !== 0 || b.length < 20 + w * h * 4) return null;
    const N = Math.min(512, w), M = Math.max(1, Math.round(N * h / w)), px = new Uint8Array(N * M * 4), lum = new Float32Array(N * M);
    let sum = 0, cnt = 0;
    for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
      const i = 20 + (Math.floor(y * h / M) * w + Math.floor(x * w / N)) * 4, j = y * N + x;
      const l = (b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722) / 255;
      lum[j] = l * l; px[j * 4 + 3] = b[i + 3];
      if (b[i + 3] > 128) { sum += lum[j]; cnt++; }
    }
    const mean = Math.max(sum / Math.max(cnt, 1), 1e-4);
    for (let j = 0; j < N * M; j++) px[j * 4] = px[j * 4 + 1] = px[j * 4 + 2] = Math.min(255, Math.round(127.5 * lum[j] / mean));
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, M, 0, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  })().catch(() => null));
  return partTexCache.get(hash);
}
// a SpeedTree (its GLB from /api/speedtree): one part per material {mesh, bark, tex, cutoff}
async function treeParts(gl, glb) {
  const { json, read, readIdx } = glb, out = [];
  for (const prim of json.meshes[0].primitives) {
    const ex = json.materials?.[prim.material]?.extras ?? {};
    if (ex.part === 'billboard') continue;
    const P = read(prim.attributes.POSITION).data, Nn = read(prim.attributes.NORMAL).data, U = read(prim.attributes.TEXCOORD_0).data;
    const idx = prim.indices !== undefined ? readIdx(prim.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    out.push({ mesh: mesh(gl, P, Nn, idx, null, U), bark: ex.part !== 'leaf', tex: ex.albedo ? await partTexture(gl, ex.albedo) : null,
      cutoff: ex.alpha_test ? ex.alpha_cutoff ?? 0.5 : -1 });
  }
  return out;
}

// a unit's meshes as one (its first level of detail; no shadow / collision meshes), standing on y = 0
async function unitMesh(gl, glb) {
  const { json, read, readIdx } = glb, pos = [], nrm = [], idx = [];
  const nodes = json.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined && !/shadow|collision|physic|occluder|_lod[1-9]|lod_?[1-9]/i.test(n.name ?? ''));
  const world = worldOf(json);
  for (const [node, ni] of nodes) for (const prim of json.meshes[node.mesh].primitives) {
    if (prim.attributes.POSITION === undefined || prim.attributes.NORMAL === undefined || (prim.mode ?? 4) !== 4) continue;
    const P = read(prim.attributes.POSITION).data, Nn = read(prim.attributes.NORMAL).data, m = world[ni], base = pos.length / 3;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], a = Nn[v * 3], b = Nn[v * 3 + 1], c = Nn[v * 3 + 2];
      pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / l, ny / l, nz / l);
    }
    const I = prim.indices !== undefined ? readIdx(prim.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    for (const i of I) idx.push(base + i);
  }
  if (!idx.length) return null;
  let lo = Infinity; for (let i = 1; i < pos.length; i += 3) lo = Math.min(lo, pos[i]);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= lo;
  return mesh(gl, new Float32Array(pos), new Float32Array(nrm), new Uint32Array(idx));
}
function worldOf(json) {
  const local = json.nodes.map(n => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  });
  const parent = []; json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => (parent[c] = i)));
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
  const out = [], get = i => out[i] ?? (out[i] = parent[i] === undefined ? local[i] : mul(get(parent[i]), local[i]));
  json.nodes.forEach((_, i) => get(i));
  return out;
}
// a model matrix: turned by yaw, scaled (sx, sy, sz), at (x, y, z)
const model = (x, y, z, yaw, sx, sy, sz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]; };

// the scene of planet p: loads its meshes (fetchUnit(hash) -> a parsed GLB), places its props; draw() each frame
export async function buildScenery(R, p, fetchUnit, fetchTree) {
  const gl = R.gl, prog = R.program(VERT, FRAG), h = hillsFn(p.id, p.hills ?? 3);
  const terrain = terrainMesh(gl, h), sphere = sphereMesh(gl), cyl = cylinderMesh(gl);
  const scatter = scatterMeshes(gl, p, h, rng(hashStr(p.id) ^ 0x51ed));
  // the rock detail: the biome's rock texture over its own mean (1 = the prop's albedo), halved into 0..1
  let rockTex = null;
  if (p.rockTex) {
    const t = await texLinear(p.rockTex).catch(() => null);
    if (t) {
      const N = Math.round(Math.sqrt(t.length / 3)), m = [0, 0, 0];
      for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) m[k] += t[i + k];
      const px = new Uint8Array(N * N * 4), lum = (m[0] + m[1] + m[2]) / (3 * N * N);
      for (let i = 0, j = 0; i < t.length; i += 3, j += 4) {
        const l = (t[i] + t[i + 1] + t[i + 2]) / 3 / Math.max(lum, 1e-4);     // (its brightness only: the prop keeps its hue)
        px[j] = px[j + 1] = px[j + 2] = Math.min(255, Math.round(127.5 * l)); px[j + 3] = 255;
      }
      rockTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rockTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
  }
  const items = (p.scenery ?? []).filter(s => s.tree || s.unit);
  const meshes = new Map(), trees = new Map();
  await Promise.all([...items.filter(s => s.unit).map(async s => {
    try { const m = await unitMesh(gl, await fetchUnit(s.unit)); if (m) meshes.set(s.unit, m); } catch (e) { console.warn('scenery', s.unit, e); }
  }), ...items.filter(s => s.tree && s.path).map(async s => {
    try { const t = await treeParts(gl, await fetchTree(s.path)); if (t.length) trees.set(s.path, t); } catch (e) { console.warn('scenery tree', s.path, e); }
  })]);
  // placement: a ring around the center (none within 10 m, nor in front of the default camera: the -z side), the
  // big ones farther out, no two overlapping much; each prop by its weight over its size (the big ones fewer)
  const ok = items.filter(s => s.tree || meshes.has(s.unit)), r = rng(hashStr(p.id) ^ 0x9e37), placed = [], draws = [];
  const pick = () => { const ws = ok.map(s => s.weight / Math.sqrt(Math.max(s.w, 2))), t = ws.reduce((a, b) => a + b, 0) * r(); let acc = 0; for (let i = 0; i < ok.length; i++) if ((acc += ws[i]) >= t) return ok[i]; return ok[0]; };
  for (let n = 0; n < 220 && placed.length < 60 && ok.length; n++) {
    const s = pick(), k = 0.75 + 0.4 * r(), w = s.w * k, rmin = 10 + w * 0.45, rr = rmin + (110 - rmin) * Math.pow(r(), 0.8), a = r() * 6.283;
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    if (z < 0 && Math.abs(x) < -z * 0.8 + 6 && rr < 45) continue;
    if (placed.some(q => Math.hypot(q.x - x, q.z - z) < (q.w + w) * 0.35)) continue;
    placed.push({ x, z, w });
    const y = h(x, z), yaw = r() * 6.283;
    if (s.tree && trees.has(s.path)) {
      for (const part of trees.get(s.path)) draws.push({ m: part.mesh, alb: part.bark ? s.bark : s.leaf, M: model(x, y - 0.3, z, yaw, k, k, k), tree: part });
    } else if (s.tree) {
      const palm = s.tree === 'palm', hh = s.h * k;
      draws.push({ m: cyl, alb: s.bark, M: model(x, y - 0.3, z, yaw, palm ? 0.012 * w + 0.12 : 0.03 * w + 0.15, palm ? 0.92 * hh : 0.55 * hh, palm ? 0.012 * w + 0.12 : 0.03 * w + 0.15) });
      draws.push({ m: sphere, alb: s.leaf, M: palm ? model(x, y + 0.9 * hh, z, yaw, 0.45 * w, 0.1 * hh, 0.45 * w) : model(x, y + 0.66 * hh, z, yaw, 0.45 * w, 0.36 * hh, 0.45 * w) });
    } else {
      draws.push({ m: meshes.get(s.unit), alb: s.albedo, M: model(x, y - 0.12 * s.h * k, z, yaw, k, k, k) });
    }
  }
  return {
    props: placed.length,
    // in the renderer's frame (render.js draw): its view, eye, sun (toward it) and color, the environment, the
    // ground's shadow terms (groundParams) and the ground tile texture
    draw(vp, eye, sd, sunCol, e, gp, groundTex) {
      const u = prog.u;
      gl.useProgram(prog.p);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uSunDir, sd); gl.uniform3fv(u.uSunCol, sunCol);
      gl.uniform3fv(u.uZen, e.zenith); gl.uniform3fv(u.uHor, e.horizon); gl.uniform3fv(u.uGnd, e.ground); gl.uniform3fv(u.uEye, eye);
      gl.uniform1f(u.uExposure, e.exposure); gl.uniform1f(u.uFogDist, e.fogDist ?? 40); gl.uniform1i(u.uGradeOn, R.gradeOn ? 1 : 0);
      gl.uniform1f(u.uFloorY, gp.floorY); gl.uniform4fv(u.uFoot, gp.foot); gl.uniform2fv(u.uCast, gp.cast);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, groundTex); gl.uniform1i(u.uGroundTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rockTex ?? groundTex); gl.uniform1i(u.uRockTex, 1); gl.uniform1i(u.uRockOn, rockTex ? 1 : 0);
      const lift = M => { const o = M.slice(); o[13] += gp.floorY; return o; };
      gl.uniform1i(u.uMode, 1); gl.uniformMatrix4fv(u.uM, false, model(0, gp.floorY, 0, 0, 1, 1, 1));
      gl.bindVertexArray(terrain.vao); gl.drawElements(gl.TRIANGLES, terrain.n, gl.UNSIGNED_INT, 0);
      for (const [k, mode] of [['plants', 2], ['rocks', 3]]) if (scatter[k]) {
        gl.uniform1i(u.uMode, mode); gl.bindVertexArray(scatter[k].vao); gl.drawElements(gl.TRIANGLES, scatter[k].n, gl.UNSIGNED_INT, 0);
      }
      gl.uniform1i(u.uMode, 0);
      gl.activeTexture(gl.TEXTURE2); gl.uniform1i(u.uPartTex, 2);
      for (const d of draws) {
        if (d.tree) {
          gl.uniform1i(u.uMode, d.tree.tex ? 4 : 0); gl.uniform1f(u.uCutoff, d.tree.cutoff);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, d.tree.tex ?? groundTex);
        } else gl.uniform1i(u.uMode, 0);
        gl.uniform3fv(u.uAlb, d.alb); gl.uniformMatrix4fv(u.uM, false, lift(d.M));
        gl.bindVertexArray(d.m.vao); gl.drawElements(gl.TRIANGLES, d.m.n, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
    },
  };
}
