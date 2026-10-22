// WebGL2 renderer for LUT Studio: armor pieces exported by filediver (glTF binary), drawn with the ported armor
// shader (shaders.js). No external libraries, so the editor works offline.
import { VERT, FRAG, CAPE_FRAG, BG_VERT, BG_FRAG, SHADOW_FRAG, SHADOW_CAPE_FRAG, GRADE_FRAG } from './shaders.js';

// ---------- small matrix helpers (column-major, like WebGL)
export const M4 = {
  ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  },
  ortho(r, near, far) {                  // a square box of half size r looking down -z
    const nf = 1 / (near - far);
    return [1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (far + near) * nf, 1];
  },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  },
  invert(m) {
    const inv = new Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    det = det ? 1 / det : 0;
    return inv.map(v => v * det);
  },
  fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
    const [x, y, z, w] = q;
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
      2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
      2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1];
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- glTF binary
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, len);
    off += 8 + len;
  }
  const read = i => {               // accessor -> array of numbers (normalized ints mapped to 0..1)
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = NCOMP[a.type], esz = T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride || n * esz, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float32Array(a.count * n);
    const view = new DataView(bin.buffer, bin.byteOffset);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const scale = a.normalized ? { 5121: 1 / 255, 5123: 1 / 65535, 5120: 1 / 127, 5122: 1 / 32767 }[a.componentType] : 1;
    for (let e = 0; e < a.count; e++) for (let c = 0; c < n; c++)
      out[e * n + c] = view[get](base + e * stride + c * esz, true) * scale;
    return { data: out, n, count: a.count, type: a.componentType };
  };
  const readIdx = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType];
    const base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return Uint32Array.from(new T(bin.buffer.slice(base, base + a.count * T.BYTES_PER_ELEMENT)));
  };
  return { json, read, readIdx };
}

// The glTF node graph as a skeleton (names, parents, bind TRS) for posing.
export function skeletonOf(json) {
  const n = json.nodes.length, parent = new Array(n).fill(-1);
  json.nodes.forEach((nd, i) => (nd.children || []).forEach(c => (parent[c] = i)));
  return {
    parent, names: json.nodes.map(nd => nd.name ?? ''),
    T: json.nodes.map(nd => nd.translation ?? [0, 0, 0]), R: json.nodes.map(nd => nd.rotation ?? [0, 0, 0, 1]),
    S: json.nodes.map(nd => nd.scale ?? [1, 1, 1]), M: json.nodes.map(nd => nd.matrix ?? null),
    order: topo(parent),
  };
}
function topo(parent) {                               // parents before children
  const out = [], seen = new Set();
  const visit = i => { if (seen.has(i)) return; if (parent[i] >= 0) visit(parent[i]); seen.add(i); out.push(i); };
  parent.forEach((_, i) => visit(i));
  return out;
}

// clip = {length, tracks: [{bone, additive, pt, p, rt, r, st, s}]} from /api/anim; sampled at time t
function sampleTrack(times, vals, t) {
  if (!times || times.length === 0) return null;
  if (t <= times[0]) return vals[0];
  const last = times.length - 1;
  if (t >= times[last]) return vals[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const f = (t - times[lo]) / ((times[hi] - times[lo]) || 1), a = vals[lo], b = vals[hi];
  if (a.length === 4) {                               // quaternion: nlerp along the short way
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = d < 0 ? -1 : 1;
    const q = a.map((v, k) => v * (1 - f) + s * b[k] * f), l = Math.hypot(...q) || 1;
    return q.map(v => v / l);
  }
  return a.map((v, k) => v + (b[k] - v) * f);
}
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];

// world matrices of a skeleton, posed by clip at time t (bones without a track keep their bind transform)
export function poseSkeleton(skel, clip, t) {
  const world = new Array(skel.parent.length);
  for (const i of skel.order) {
    let local;
    const tr = clip?.byBone.get(skel.names[i]);
    if (tr) {
      let T = sampleTrack(tr.pt, tr.p, t) ?? skel.T[i], R = sampleTrack(tr.rt, tr.r, t) ?? skel.R[i], S = sampleTrack(tr.st, tr.s, t) ?? skel.S[i];
      if (tr.additive) { T = T.map((v, k) => v + skel.T[i][k]); R = qmul(skel.R[i], R); }   // as filediver's glTF export
      local = M4.fromTRS(T, R, S);
    } else local = skel.M[i] ? skel.M[i].slice() : M4.fromTRS(skel.T[i], skel.R[i], skel.S[i]);
    world[i] = skel.parent[i] < 0 ? local : M4.mul(world[skel.parent[i]], local);
  }
  return world;
}
// The avatar's bones in a pose (or at rest: clip null): name -> world matrix. A piece is skinned on these, as the
// game skins every piece on the one character skeleton: joint matrix = avatar bone world * the piece's own inverse
// bind. So a piece modeled in another rest pose than the avatar's (the DS-191 Scorpion's undersuit arms: elbow 9 cm,
// hand 26 cm off) still sits on the body. A joint the avatar lacks (capes nest medium_cape / skeleton nodes) follows
// its nearest ancestor that it has, keeping its own offset from it (jointWorld).
export function avatarWorld(avatarSkel, clip, t) {
  const posed = poseSkeleton(avatarSkel, clip, t), out = new Map();
  avatarSkel.names.forEach((n, i) => { if (n && !out.has(n)) out.set(n, posed[i]); });
  return out;
}
export function jointWorld(sk, avatar, node) {
  for (let i = node; i >= 0; i = sk.parent[i]) {
    const a = avatar.get(sk.names[i]);
    if (a) return i === node ? a : M4.mul(M4.mul(a, M4.invert(sk.bind[i])), sk.bind[node]);
  }
  return sk.bind[node];
}

// /api/cube blob -> {size, mips, format, face(mip, face) -> typed array}
function parseCube(buf) {
  const dv = new DataView(buf), size = dv.getUint32(4, true), mips = dv.getUint32(8, true), format = dv.getUint32(12, true);
  const bpp = format === 2 ? 8 : 4, offs = [];
  let o = 16;
  for (let m = 0; m < mips; m++) { const s = Math.max(1, size >> m); for (let f = 0; f < 6; f++) { offs.push(o); o += s * s * bpp; } }
  return {
    size, mips, format,
    face: (m, f) => { const s = Math.max(1, size >> m); return format === 2 ? new Uint16Array(buf, offs[m * 6 + f], s * s * 4) : new Uint8Array(buf, offs[m * 6 + f], s * s * 4); },
  };
}
const H2F = (() => { const t = new Float32Array(65536); for (let h = 0; h < 65536; h++) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
} return t; })();
// texel (x, y) of cube face f (D3D / GL layout) -> direction in the cube's (the game's, Z up) space
function faceDir(f, x, y, s) {
  const u = 2 * (x + 0.5) / s - 1, v = 2 * (y + 0.5) / s - 1;
  return [[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1]][f];
}
// direction (cube space) -> [face, x, y] of the texel it falls into, by the major axis as the GPU picks faces
function texelOf(d, s) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  let f, sc, tc, ma;
  if (ax >= ay && ax >= az) { f = d[0] > 0 ? 0 : 1; sc = d[0] > 0 ? -d[2] : d[2]; tc = -d[1]; ma = ax; }
  else if (ay >= az) { f = d[1] > 0 ? 2 : 3; sc = d[0]; tc = d[1] > 0 ? d[2] : -d[2]; ma = ay; }
  else { f = d[2] > 0 ? 4 : 5; sc = d[2] > 0 ? d[0] : -d[0]; tc = -d[1]; ma = az; }
  const cl = v => Math.min(s - 1, Math.max(0, Math.floor((v / ma + 1) * 0.5 * s)));
  return [f, cl(sc), cl(tc)];
}
// an irradiance cube's mip 0 for the shader's own seamless filtering (shaders.js irradiance): each face (s + 2)^2
// RGBA float, texel (1, 1) = its texel (0, 0); the border holds the neighbor faces' texels a direction just past the
// edge falls into, a corner the mean of the three texels meeting there (as the GPU filters cube seams)
function borderedFaces(c) {
  const s = c.size, b = s + 2, out = new Float32Array(6 * b * b * 4);
  const rgb = (f, x, y) => {
    const px = c.face(0, f), i = (y * s + x) * 4;
    return c.format === 2 ? [H2F[px[i]], H2F[px[i + 1]], H2F[px[i + 2]]] : [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
  };
  const at = (f, x, y) => (x >= 0 && x < s && y >= 0 && y < s ? rgb(f, x, y) : rgb(...texelOf(faceDir(f, x, y, s), s)));
  for (let f = 0; f < 6; f++) for (let y = -1; y <= s; y++) for (let x = -1; x <= s; x++) {
    const xc = Math.min(s - 1, Math.max(0, x)), yc = Math.min(s - 1, Math.max(0, y));
    let v = at(f, x, y);
    if (x !== xc && y !== yc) { const a = at(f, xc, yc), p = at(f, x, yc), q = at(f, xc, y); v = [0, 1, 2].map(k => (a[k] + p[k] + q[k]) / 3); }
    out.set([...v, 1], ((f * b + y + 1) * b + x + 1) * 4);
  }
  return { size: b, data: out };
}
function eachTexel(c, m, fn) {
  const s = Math.max(1, c.size >> m);
  for (let f = 0; f < 6; f++) {
    const px = c.face(m, f);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const rgb = c.format === 2 ? [H2F[px[i]], H2F[px[i + 1]], H2F[px[i + 2]]] : [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
      const d = faceDir(f, x, y, s), l = Math.hypot(d[0], d[1], d[2]);
      const w = 4 / (s * s) / (l * l * l);            // solid angle of the texel
      fn([d[0] / l, d[2] / l, -d[1] / l], rgb, w);       // game (Z up) -> viewer (Y up): (x, z, -y)
    }
  }
}
// 9 SH coefficients (flat vec3 x 9) of the diffuse light / pi; radiance: convolve with the cosine lobe first
function projectSH(c, m, radiance) {
  const sh = new Float32Array(27);
  eachTexel(c, m, (n, rgb, w) => {
    const [x, y, z] = n;
    const b = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
    for (let k = 0; k < 9; k++) for (let ch = 0; ch < 3; ch++) if (isFinite(rgb[ch])) sh[k * 3 + ch] += b[k] * rgb[ch] * w;
  });
  if (radiance) {                      // irradiance / pi = sum A_l / pi * L_lm Y_lm (Ramamoorthi & Hanrahan)
    const A = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4];
    for (let k = 0; k < 9; k++) for (let ch = 0; ch < 3; ch++) sh[k * 3 + ch] *= A[k];
  }
  return sh;
}
// the brightest direction (viewer space) and its color (max channel 1) on a slightly blurred mip, for the key light:
// the probes hold the reflections of the lights, the game adds the lights themselves
function brightest(c) {
  let best = -1, dir = [0, 1, 0], col = [1, 1, 1];
  eachTexel(c, Math.min(c.mips - 1, 3), (n, rgb) => { const l = rgb[0] + rgb[1] + rgb[2]; if (isFinite(l) && l > best) { best = l; dir = n; col = rgb; } });
  const m = Math.max(...col, 1e-6);
  return { dir, color: col.map(v => v / m) };
}

export function prepareClip(clip) {
  clip.byBone = new Map(clip.tracks.map(tr => [tr.bone, tr]));
  // a clip that moves the whole character (walk, sprint, crawl…: the root bone's track travels) plays in place: the
  // root keeps its first horizontal position (its height still moves)
  const root = clip.byBone.get('StingrayEntityRoot');
  if (root?.p?.length > 1) {
    const [x0, , z0] = root.p[0];
    if (root.p.some(([x, , z]) => Math.hypot(x - x0, z - z0) > 0.05)) root.p = root.p.map(([, y]) => [x0, y, z0]);
  }
  return clip;
}

// node world matrices
// world matrix of the first node named name ("" = none)
export function nodeWorld(glb, name) {
  const i = glb.json.nodes.findIndex(n => n.name === name);
  return i < 0 ? null : worldMatrices(glb.json)[i];
}

// Where a part goes on a body: the body's mount node, with the part's own anchor on it. A part's anchor is its
// attach_offset node (weapon attachments: e.g. the bottom of a scope, where it clamps onto the rail), else its entity
// root. Both glbs carry filediver's axis conversion in those nodes, so mount * inverse(anchor) maps the part's
// exported vertices onto the body's (no separate axis fix). null = the body has no such mount.
export function mountMatrix(body, mount, part) {
  const a = nodeWorld(body, mount);
  if (!a) return null;
  const o = nodeWorld(part, 'attach_offset') ?? nodeWorld(part, 'StingrayEntityRoot');
  return o ? M4.mul(a, M4.invert(o)) : a;
}

// moves a prim from extractPieces by matrix m (positions and normals)
// a piece's bounds where it stands: turned by its yaw, moved by its shift (a scene's items)
function placedBounds(p) {
  const [a, b] = p.bounds, s = p.shift ?? [0, 0, 0], m = pieceRot(p);
  if (!m) return [a.map((v, k) => v + s[k]), b.map((v, k) => v + s[k])];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) for (let k = 0; k < 3; k++) {
    const v = m[k] * x + m[3 + k] * y + m[6 + k] * z + s[k];
    lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
  }
  return [lo, hi];
}
// a piece's turn (column-major 3x3): its own (p.rot), else its yaw about the vertical; null: none
function pieceRot(p) {
  if (p.rot) return p.rot;
  const y = p.yaw ?? 0;
  if (!y) return null;
  const c = Math.cos(y), s = Math.sin(y);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
function setRot(gl, u, p) {
  const m = pieceRot(p);
  gl.uniform1i(u.uRotOn, m ? 1 : 0);
  if (m) gl.uniformMatrix3fv(u.uRot, false, m);
}

export function transformPrim(prim, m) {
  const p = prim.pos, n = prim.nrm;
  for (let v = 0; v < p.length; v += 3) {
    const x = p[v], y = p[v + 1], z = p[v + 2];
    p[v] = m[0] * x + m[4] * y + m[8] * z + m[12]; p[v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; p[v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const a = n[v], b = n[v + 1], c = n[v + 2];
    const r = norm([m[0] * a + m[4] * b + m[8] * c, m[1] * a + m[5] * b + m[9] * c, m[2] * a + m[6] * b + m[10] * c]);
    n[v] = r[0]; n[v + 1] = r[1]; n[v + 2] = r[2];
  }
  prim.skin = null;   // placed statically
}

function worldMatrices(json) {
  const n = json.nodes.length, world = new Array(n), parent = new Array(n).fill(-1);
  json.nodes.forEach((nd, i) => (nd.children || []).forEach(c => (parent[c] = i)));
  const local = json.nodes.map(nd => nd.matrix ? nd.matrix.slice() : M4.fromTRS(nd.translation, nd.rotation, nd.scale));
  const get = i => world[i] || (world[i] = parent[i] < 0 ? local[i] : M4.mul(get(parent[i]), local[i]));
  for (let i = 0; i < n; i++) get(i);
  return world;
}

// a material's texture slot as a resource hash, null when unset: a slot the material sets to the zero hash is unset
// too (I-92 Fire Fighter's hips undersuit has pattern_lut 0x0000…: read as a LUT it failed, and the piece with it)
const imageHash = (json, texIdx) => {
  const t = json.textures?.[texIdx];
  const name = t === undefined ? null : json.images[t.source].name;
  return /^0x0+$/.test(name ?? '') ? null : name;
};

// The material slot a glTF material of filediver's fills: its name is "<slot> <material>" ("m_tank 0x2d7e…": the
// material a 64-bit hash), a skin's variant "<skin> <slot>" ("0x1cd5c245 m_tank"). A slot the name list lacks stays
// a 32-bit hash ("0xba24ab63 0x2d7e…", the Bastion's cannon), as the kit's pieces name it.
export function materialSlot(name) {
  const t = (name ?? '').split(' ').filter(Boolean);
  return t.find(s => !s.startsWith('0x')) ?? t.filter(s => /^0x[0-9a-f]{8}$/i.test(s)).pop() ?? '';
}

// Armor primitives of a unit, posed in bind pose (CPU skinning once). Normals are perturbed in the shader with
// screen-derivative UV frames, as the game does, so no vertex tangents are needed.
// opts.variant: a glTF material variant (KHR_materials_variants; filediver exports each vehicle skin as one) whose
// materials are used; opts.vehicle: skip the destroyed-state meshes vehicles carry ("…_destroyed").
export function extractPieces(glb, opts = {}) {
  const { json, read, readIdx } = glb;
  const world = worldMatrices(json);
  const out = [];
  const variants = json.extensions?.KHR_materials_variants?.variants ?? [];
  const vi = opts.variant ? variants.findIndex(v => v.name?.toLowerCase() === opts.variant.toLowerCase()) : -1;
  json.nodes.forEach((node, ni) => {
    if (node.mesh === undefined) return;
    // vehicles: the parts the game hides at first (its visibility masks: the damaged versions of exosuit / tank
    // parts); a part named "…_destroyed" is not one by itself (the FRV's bonnet, doors and seats are, intact, and
    // hidden only when destroyed). Meshes without mask data: by that name, as before.
    if (opts.vehicle && (node.extras?.default_hidden !== undefined ? !!node.extras.default_hidden : /_destroyed/.test(node.name ?? ''))) return;
    const mesh = json.meshes[node.mesh];
    let skinMats = null;
    if (node.skin !== undefined) {
      const skin = json.skins[node.skin];
      const ibm = read(skin.inverseBindMatrices).data;
      skinMats = skin.joints.map((j, k) => M4.mul(world[j], Array.from(ibm.subarray(k * 16, k * 16 + 16))));
    }
    for (const prim of mesh.primitives) {
      let mi = prim.material;
      if (vi >= 0) {
        const m = prim.extensions?.KHR_materials_variants?.mappings?.find(m => m.variants.includes(vi));
        if (m) mi = m.material;
      }
      const mat = json.materials?.[mi];
      const ex = mat?.extras;
      if (!ex) continue;
      const isCape = ex.cape_scalar_fields !== undefined || ex.cape_lut !== undefined;
      if (!isCape && ex.id_masks_array === undefined) continue;   // not the armor shader (the LUT slot may be unset)
      // capes: only the full-detail cloth mesh (not the _lod / _simple / _partial / _backpack variants)
      if (isCape && /_lod|_simple|_partial|_backpack/.test(node.name ?? '')) continue;
      const at = prim.attributes;
      if (at.TEXCOORD_1 === undefined) continue;
      const P = read(at.POSITION).data, Nn = read(at.NORMAL).data, U0 = read(at.TEXCOORD_0).data, U1 = read(at.TEXCOORD_1).data;
      const U2 = at.TEXCOORD_2 !== undefined ? read(at.TEXCOORD_2).data : U1;
      const count = P.length / 3;
      const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
      if (skinMats && at.JOINTS_0 !== undefined) {
        const J = read(at.JOINTS_0).data, W = read(at.WEIGHTS_0).data;
        for (let v = 0; v < count; v++) {
          let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
          for (let k = 0; k < 4; k++) {
            const w = W[v * 4 + k]; if (!w) continue;
            const m = skinMats[J[v * 4 + k]];
            const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
            px += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); pz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
            const a = Nn[v * 3], b = Nn[v * 3 + 1], c = Nn[v * 3 + 2];
            nx += w * (m[0] * a + m[4] * b + m[8] * c); ny += w * (m[1] * a + m[5] * b + m[9] * c); nz += w * (m[2] * a + m[6] * b + m[10] * c);
          }
          pos.set([px, py, pz], v * 3);
          const l = Math.hypot(nx, ny, nz) || 1; nrm.set([nx / l, ny / l, nz / l], v * 3);
        }
      } else {
        const m = world[ni];
        for (let v = 0; v < count; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          pos.set([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]], v * 3);
          const a = Nn[v * 3], b = Nn[v * 3 + 1], c = Nn[v * 3 + 2];
          const n = norm([m[0] * a + m[4] * b + m[8] * c, m[1] * a + m[5] * b + m[9] * c, m[2] * a + m[6] * b + m[10] * c]);
          nrm.set(n, v * 3);
        }
      }
      const idx = prim.indices !== undefined ? readIdx(prim.indices) : Uint32Array.from({ length: count }, (_, i) => i);
      let skin = null;
      if (skinMats && at.JOINTS_0 !== undefined) {
        const sk = json.skins[node.skin];
        skin = { rawPos: P, rawNrm: Nn, joints: read(at.JOINTS_0).data, weights: read(at.WEIGHTS_0).data,
          jointNodes: sk.joints, ibm: read(sk.inverseBindMatrices).data, skel: skeletonOf(json) };
      }
      out.push({ skin,
        name: mat.name, slot: materialSlot(mat.name), pos, nrm, uv0: U0, uv1: U1, uv2: U2, hasUv2: at.TEXCOORD_2 !== undefined, idx, kind: isCape ? 'cape' : 'armor',
        tex: {
          lut: imageHash(json, ex.material_lut), patternLut: imageHash(json, ex.pattern_lut),
          idMasks: imageHash(json, ex.id_masks_array), baseData: imageHash(json, ex.base_data),
          patternMasks: imageHash(json, ex.pattern_masks_array), camo: imageHash(json, ex.customization_camo_tiler_array),
          composite: imageHash(json, ex.composite_array),
          wDirt: imageHash(json, ex.weathering_dirt), wSpecial: imageHash(json, ex.weathering_special),
          wBlood: imageHash(json, ex.blood_splatter_tiler), wBug: imageHash(json, ex.bug_splatter_tiler),
          scalar: imageHash(json, ex.cape_scalar_fields), tear: imageHash(json, ex.cape_tear),
          gradient: imageHash(json, ex.cape_gradient), decalSheet: imageHash(json, ex.decal_sheet), capeLut: imageHash(json, ex.cape_lut),
          damage: imageHash(json, ex.vehicle_damage_data),
        },
        params: ex,
      });
    }
  });
  return out;
}

// ---------- renderer
// the 1 x 1 black pattern_masks_array most parts bind (no pattern can show on them)
const NO_PATTERN_MASK = '0xf37a4e756300ab32';

// the armor shader's netting variant (game build 25988413: the Mimetic armors' scrim): layer 1 of the ID masks cuts
// holes (alpha above 0.5, in every pass) and the part is two-sided (research/version-history/build-25988413-shaders.md
// §6.2 in HD2-Modding-Lab)
export const NETTING_BASE = '0x8e7efcdf45ac19cf';
const holes = p => p.params?.fd_base_material === NETTING_BASE;

export const DEBUG_VIEWS = [
  ['Final', 0], ['Albedo', 1], ['Zones', 2], ['Secondary mask', 3], ['Wear mask', 4], ['Heavy wear (wear²)', 5],
  ['Metalness', 6], ['Camo amount', 7], ['Roughness', 8], ['Specular', 9], ['Normal', 10],
  ['Iridescence amount', 11], ['Glow', 12], ['Detail texture (grunge B/A)', 13], ['Edges / hollows', 14],
  ['Occlusion', 15], ['Clearcoat', 16], ['Pattern', 17], ['Dirt', 18], ['Wetness', 19],
  ['Blood (red) / bug gunk (green)', 20], ['Snow / mud', 21], ['Cloth fuzz', 22],
];

// mission-wear sliders -> the shader's world inputs
// (damage: vehicles' per-instance vehicle_damage, the game's 1 - health / max)
export const WORLD = { dirt: 0, mud: 0, blood: 0, gunk: 0, wet: 0, snow: 0, frost: 0, burn: 0, scorch: 0, damage: 0, cobweb: 0 };

// cobwebs (game build 25988413): the cobweb_tiler every material with cobweb settings binds, and those settings by
// name or, as filediver doesn't know the names, by thin hash
export const COBWEB_TILER = '0x0d371130ba00addb';
const WEB_KEYS = { cobweb_intensity: '0x8aefc6d8', cobweb_color: '0xaa31973b', cobweb_roughness: '0xdf9d64e9',
  cobweb_uv_seed: '0x22aa32ae', cobweb_resolution: '0x1d3c6a38' };
const webParam = (params, k) => params?.[k] ?? params?.[WEB_KEYS[k]];
// the shader's tile offset: uint(object_random + cobweb_uv_seed), its low bits as two floats in [0, 1) (the detail
// tilers' hash; object_random is 0 here, as for uRnd)
function webOffset(seed) {
  const x = Math.trunc(seed) >>> 0, f = new Float32Array(1), i = new Uint32Array(f.buffer);
  const r = k => { i[0] = (k & 0x7fffff) | 0x3f800000; return f[0] - 1; };
  return [r(x), r(x >>> 9)];
}

// the vehicle base material's (0x43865ef50d88395e) vehicle_damage_data, kept by every material on that base
export const VEHICLE_DAMAGE_DATA = '0xd8aa88a9151b4ed8';

// the highest decal number a piece's sheet has room for: the shader moves the first cell by number *
// (decal_id_offset_x, -decal_id_offset_y) texels, so the cells that still start on the sheet. 0: none (the vehicle
// base sets no offsets; the armor base's (0, 100) moves the cell up, off the sheet)
export function decalNumbers(p) {
  const ts = [p.decalSheet?.w ?? 0, p.decalSheet?.h ?? 0];
  const step = [p.params?.decal_id_offset_x?.[0] ?? 0, -(p.params?.decal_id_offset_y?.[0] ?? 0)];
  let n = 0;
  for (let k = 0; k < 2; k++) if (step[k] >= 1 && ts[k] > 0) n = Math.max(n, Math.floor((ts[k] - 1) / step[k]));
  return Math.min(n, 63);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');   // (half-float targets: the planet grading's input without banding)
    this.prog = this.program(VERT, FRAG);
    this.capeProg = this.program(VERT, CAPE_FRAG);
    this.bg = this.program(BG_VERT, BG_FRAG);
    this.gradeProg = this.program(BG_VERT, GRADE_FRAG);
    this.tex = new Map();        // hash -> {tex, layers}
    this.luts = new Map();       // key -> {tex, w, h}
    this.pieces = [];            // drawable primitives
    this.cam = { yaw: Math.PI + 0.5, pitch: 0.15, dist: 2.2, target: [0, 1.2, 0] };
    // the side lights (the armory look: a cool light on the left, a warm one on the right, both a little behind);
    // az in degrees around the model from the camera, set by the Lights controls
    this.rim = [{ on: false, az: 250, el: 17, color: [0.55, 0.72, 1.0], intensity: 4.0 }, { on: false, az: 110, el: 17, color: [1.0, 0.84, 0.5], intensity: 4.0 }];
    this.sunOn = true;           // the Sun box
    this.shadows = true;         // the Shadows box: the sun's shadow map
    this.sunElevUser = null;     // the Sun height slider, degrees (null: the lighting's own)
    this.env = null;
    this.debug = 0;
    this.split = false;          // left half vanilla, right half edited
    this.pose = null;            // {clip, time}: an animation pose (null = bind / T-pose)
    this.highlight = { piece: -1, zone: -1 };
    this.world = { ...WORLD };
    this.blank = this.makeArray(1, 1, 1, new Uint8Array(4), false);
    this.white = this.makeArray(1, 1, 1, new Uint8Array([255, 255, 255, 255]), false);
    this.gray = this.makeArray(1, 1, 1, new Uint8Array([128, 128, 128, 128]), false);
    this.decalId = 0;            // the Decal number control (the game's per-instance decal id)
  }

  program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  // planet lighting's ground under the model (BG_FRAG): its tile (e.groundTile, planet.js, uploaded once per planet),
  // at the lowest point of what is shown, the shadows from the model's footprint and height
  groundUniforms(u, e, sd, sunCol) {
    const gl = this.gl, on = !!(e.groundTile && this.pieces.length && !this.post);
    gl.uniform1i(u.uPlanetGround, on ? 1 : 0);
    this.ensureGroundTex(e);
    this.bindTex(15, gl.TEXTURE_2D, this.groundTex, u.uGroundTex);
    if (!on) return;
    const g = this.groundParams(sd, sunCol);
    gl.uniform1f(u.uFloorY, g.floorY); gl.uniform1f(u.uFogDist, e.fogDist ?? 40);
    gl.uniform4fv(u.uFoot, g.foot); gl.uniform2fv(u.uCast, g.cast);
    gl.uniform3fv(u.uSunE, g.sunE);
    gl.uniform3fv(u.uSkyUp, e.zenith.map((z, k) => 0.6 * z + 0.4 * e.horizon[k]));
  }
  // the ground tile's texture (e.groundTile; a grey texel until it is made)
  ensureGroundTex(e) {
    const gl = this.gl;
    if (!this.groundTex || this.groundTexFor !== e.groundTile) {
      if (!this.groundTex) this.groundTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.groundTex);
      const t = e.groundTile;
      if (t) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(t.px.buffer));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([90, 90, 90, 255]));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.groundTexFor = e.groundTile;
    }
  }
  // the ground under what is shown: its height (the lowest point), the footprint (center xz, half sizes) and the
  // cast shadow's far end (xz offset away from the sun, by the height), the sun on a level surface
  groundParams(sd, sunCol) {
    if (this.post?.floorC) {   // (the Showcase: a soft shadow under the squad only; the items' own come with them)
      const f = this.post.floorC;
      return { floorY: 0, foot: [f[0], f[2], 1.9, 0.9], cast: [0, 0], sunE: sd[1] > 0 ? sunCol.map(c => c * sd[1] / Math.PI) : [0, 0, 0] };
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.pieces) { const [a, b] = placedBounds(p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], b[k]); } }
    if (!this.pieces.length) { lo.fill(0); hi.fill(0); }
    const h = hi[1] - lo[1], horiz = Math.hypot(sd[0], sd[2]), tanE = sd[1] / Math.max(horiz, 1e-3);
    const len = sd[1] > 0.02 ? Math.min(h / tanE, 6) : 0;
    return { floorY: lo[1], foot: [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, Math.max((hi[0] - lo[0]) / 2, 0.15), Math.max((hi[2] - lo[2]) / 2, 0.15)],
      cast: horiz > 1e-3 ? [-sd[0] / horiz * len, -sd[2] / horiz * len] : [0, 0],
      sunE: sd[1] > 0 ? sunCol.map(c => c * sd[1] / Math.PI) : [0, 0, 0] };
  }

  // the multisample count a render target of format F can take (at most 4; 0: none)
  msaaSamples(F) {
    const s = this.gl.getInternalformatParameter(this.gl.RENDERBUFFER, F, this.gl.SAMPLES);
    return Math.min(4, s && s.length ? s[0] : 0);
  }

  // the frame drawn shaped into a target, then graded onto the canvas (size: an export at w x h, left in this.gradeT)
  gradeDraw(time, size) {
    const gl = this.gl, W = size ? size[0] : this.canvas.width, H = size ? size[1] : this.canvas.height;
    let t = this.gradeT;
    if (!t || t.w !== W || t.h !== H) {
      if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteFramebuffer(t.ms); gl.deleteTexture(t.tex); t.rbs.forEach(r => gl.deleteRenderbuffer(r)); }
      const F = this.floatRT ? gl.RGBA16F : gl.RGB10_A2;
      const samples = this.msaaSamples(F);
      t = this.gradeT = { w: W, h: H, fbo: gl.createFramebuffer(), ms: gl.createFramebuffer(), tex: gl.createTexture(), rbs: [gl.createRenderbuffer(), gl.createRenderbuffer()] };
      gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texStorage2D(gl.TEXTURE_2D, 1, F, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);   // (drawn multisampled: the edges as smooth as the canvas's)
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rbs[0]); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, F, W, H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rbs[1]); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.rbs[0]);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.rbs[1]);
    }
    this.target = { fbo: t.ms, w: W, h: H };
    try { this.draw(time); } finally { this.target = null; }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.gradeProg.p);
    this.bindTex(0, gl.TEXTURE_2D, t.tex, this.gradeProg.u.uSrc);
    this.bindTex(1, gl.TEXTURE_3D, this.env.grade.tex, this.gradeProg.u.uGrade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    return null;
  }

  // a planet look's 3D LUT from its strip (planets/<id>.png: n*n x n, x = r + n b, y = g) -> {tex, n}
  async loadGrade(url) {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('no ' + url)); i.src = url; });
    const n = img.height, cv = document.createElement('canvas'); cv.width = img.width; cv.height = n;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const src = cx.getImageData(0, 0, img.width, n).data, px = new Uint8Array(n * n * n * 4);
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const i = (g * img.width + b * n + r) * 4, o = ((b * n + g) * n + r) * 4;
      px[o] = src[i]; px[o + 1] = src[i + 1]; px[o + 2] = src[i + 2]; px[o + 3] = 255;
    }
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    return { tex, n };
  }

  makeArray(w, h, layers, data, mips, float = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (float) gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA16F, w, h, layers, 0, gl.RGBA, gl.FLOAT, data);
    else gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return { tex: t, layers, w, h };
  }

  // LSTX blob from the server -> texture array
  // vanillaTex: a piece's textures as the game has them (not the variant's edits), for the before | after view;
  // null until loaded (started on the first call)
  vanillaTex(p) {
    if (!this.variant) return null;   // (no variant: the textures are the game's already)
    if (p.vanillaTex === undefined) {
      p.vanillaTex = null;
      Promise.all([this.loadTexture(p.idMaskHash, { mips: false }), this.loadTexture(p.patMaskHash, { mips: false }),
        this.loadTexture(p.decalHash, { clamp: true, key: 'clamp:' }), this.loadTexture(p.scalarHash)])
        .then(([idMasks, patMasks, decalSheet, scalar]) => {
          p.vanillaTex = Object.fromEntries(Object.entries({ idMasks, patMasks, decalSheet, scalar }).filter(([, v]) => v));
        }).catch(() => { p.vanillaTex = undefined; });
    }
    return p.vanillaTex;
  }

  // variant: the project variant's own version of the texture when it has one (an edited decal sheet: this.variant)
  async loadTexture(hash, { mips = true, clamp = false, key = '', variant = false } = {}) {
    if (!hash) return null;
    const v = variant ? this.variant ?? '' : '';
    const ck = key + (v ? v + ':' : '') + hash;
    if (this.tex.has(ck)) return this.tex.get(ck);
    const p = (async () => {
      const r = await fetch('/api/tex?hash=' + hash + (v ? '&variant=' + encodeURIComponent(v) : ''));
      if (!r.ok) { console.warn('texture', hash, await r.text()); return null; }
      const buf = await r.arrayBuffer(), dv = new DataView(buf);
      const w = dv.getUint32(4, true), h = dv.getUint32(8, true), layers = dv.getUint32(12, true), fmt = dv.getUint32(16, true);
      const t = fmt === 1 ? this.makeArray(w, h, layers, new Float32Array(buf, 20), false, true)
        : this.makeArray(w, h, layers, new Uint8Array(buf, 20), mips);
      if (clamp) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      return t;
    })();
    this.tex.set(ck, p);
    let t;
    try { t = await p; } catch (e) { this.tex.delete(ck); throw e; }   // (a failed load is tried again next time)
    if (!t) { this.tex.delete(ck); return null; }
    this.tex.set(ck, t);
    return t;
  }

  // a cube of the game's lighting (/api/cube): faces and mips, HDR half floats kept; plus its diffuse light as 9 SH
  // coefficients (from the diffuse cube when the environment has one, else from the specular cube's mips) and the
  // brightest direction (where the sun is).
  async loadCube(spec, diffuse = '') {
    const ck = 'cube:' + spec + ':' + diffuse;
    if (this.tex.has(ck)) return this.tex.get(ck);
    const p = (async () => {
      const get = async h => { const r = await fetch('/api/cube?hash=' + h); if (!r.ok) throw new Error(await r.text()); return parseCube(await r.arrayBuffer()); };
      const [c, d] = await Promise.all([get(spec), diffuse ? get(diffuse) : null]);
      const gl = this.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      const half = c.format === 2;
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, c.mips, half ? gl.RGBA16F : gl.RGBA8, c.size, c.size);
      for (let m = 0; m < c.mips; m++) for (let f = 0; f < 6; f++) {
        const s = Math.max(1, c.size >> m);
        gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, m, 0, 0, s, s, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, c.face(m, f));
      }
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, c.mips > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, c.mips - 1);
      // diffuse: the bake's irradiance cube itself (as the game samples it); without one, SH of the specular cube
      // convolved with the cosine lobe
      const sh = d ? projectSH(d, 0, false) : projectSH(c, Math.min(c.mips - 1, Math.max(0, Math.round(Math.log2(c.size / 32)))), true);
      return { tex, mips: c.mips, sh, key: brightest(c), diff: d && d.size <= 254 ? borderedFaces(d) : null };
    })();
    this.tex.set(ck, p);
    try { const t = await p; this.tex.set(ck, t); return t; }
    catch (e) { this.tex.delete(ck); throw e; }
  }

  async loadShared() {
    const [detail, web] = await Promise.all([this.loadTexture('detail'), this.loadTexture(COBWEB_TILER).catch(() => null), this.loadTables()]);
    this.detail = detail; this.webLayer = -1;
    if (detail && web) {   // the cobweb tiler as one more layer of the detail array (no sampler left for it)
      this.detail = this.withLayer(detail, web);
      this.webLayer = detail.layers;
      for (const [k, t] of [['detail', detail], [COBWEB_TILER, web]]) { this.gl.deleteTexture(t.tex); this.tex.delete(k); }
    }
  }

  // array a with texture b (layer 0, scaled to a's size) as one more layer, mipmapped
  withLayer(a, b) {
    const gl = this.gl, { w, h } = a, n = a.layers + 1, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h, n);
    const rf = gl.createFramebuffer(), df = gl.createFramebuffer();
    for (let l = 0; l < n; l++) {
      const [src, sl] = l < a.layers ? [a, l] : [b, 0];
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rf); gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, src.tex, 0, sl);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, df); gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, l);
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(rf); gl.deleteFramebuffer(df);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, layers: n, w, h };
  }

  // the lighting's tables (shaders.js uLuts): layer 0 ibl_specular_brdf_lut, 1 ibl_brdf_lut (64 x 64 at texel 1,
  // edges repeated, so the shader's bilinear lookups equal the game's clamped ones), 2-7 an environment's
  // irradiance cube (envUniforms)
  async loadTables() {
    const get = async h => {
      const r = await fetch('/api/tex?hash=' + h);
      if (!r.ok) throw new Error('texture ' + h + ': ' + await r.text());
      const buf = await r.arrayBuffer(), dv = new DataView(buf);
      const w = dv.getUint32(4, true), ht = dv.getUint32(8, true);
      const px = dv.getUint32(16, true) === 1 ? new Float32Array(buf, 20, w * ht * 4) : Float32Array.from(new Uint8Array(buf, 20, w * ht * 4), v => v / 255);
      return { w, h: ht, px };
    };
    const [sb, ib] = await Promise.all([get('specbrdf'), get('brdf')]);
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, 256, 256, 8);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, sb.w, sb.h, 1, gl.RGBA, gl.FLOAT, sb.px);
    const n = ib.w + 2, pad = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const sx = Math.min(ib.w - 1, Math.max(0, x - 1)), sy = Math.min(ib.h - 1, Math.max(0, y - 1));
      pad.set(ib.px.subarray((sy * ib.w + sx) * 4, (sy * ib.w + sx) * 4 + 4), (y * n + x) * 4);
    }
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 1, n, n, 1, gl.RGBA, gl.FLOAT, pad);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
    this.tables = { tex, diff: null };
  }

  // blood and bug splatter in one sampler (layer 0, layer 1; the shader has 16): the same texture as nearly always,
  // else both copied into a two-layer array
  splatTexture(blood, bug) {
    if (!bug || !blood || bug === blood) return { tex: blood ?? bug, bugLayer: 0 };
    const gl = this.gl, w = blood.w, h = blood.h, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h, 2);
    const rf = gl.createFramebuffer(), df = gl.createFramebuffer();
    [blood, bug].forEach((src, layer) => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rf); gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, src.tex, 0, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, df); gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, layer);
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(rf); gl.deleteFramebuffer(df);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return { tex: { tex, layers: 2, w, h }, bugLayer: 1 };
  }

  // LUT texels -> float texture (texelFetch only)
  // the LUT textures whose keys start with prefix, freed
  dropLuts(prefix) {
    for (const [k, l] of this.luts) if (k.startsWith(prefix)) { this.gl.deleteTexture(l.tex); this.luts.delete(k); }
  }

  setLut(key, w, h, px) {
    const gl = this.gl;
    let l = this.luts.get(key);
    if (!l || l.w !== w || l.h !== h) {
      if (l) gl.deleteTexture(l.tex);
      l = { tex: gl.createTexture(), w, h };
      gl.bindTexture(gl.TEXTURE_2D, l.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.luts.set(key, l);
    }
    gl.bindTexture(gl.TEXTURE_2D, l.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, px instanceof Float32Array ? px : new Float32Array(px));
  }

  // the pieces pred picks taken off (their buffers freed)
  removePieces(pred) {
    const gl = this.gl, keep = [];
    for (const p of this.pieces) {
      if (!pred(p)) { keep.push(p); continue; }
      gl.deleteVertexArray(p.vao); p.buffers.forEach(b => gl.deleteBuffer(b));
      if (p.skin?.tex) gl.deleteTexture(p.skin.tex);
      if (p.bugLayer === 1 && p.wSplat?.tex) gl.deleteTexture(p.wSplat.tex);
    }
    this.pieces = keep;
  }

  clearPieces() {
    const gl = this.gl;
    for (const p of this.pieces) {
      gl.deleteVertexArray(p.vao); p.buffers.forEach(b => gl.deleteBuffer(b));
      if (p.skin?.tex) gl.deleteTexture(p.skin.tex);   // (the piece's own joint texture)
      if (p.bugLayer === 1 && p.wSplat?.tex) gl.deleteTexture(p.wSplat.tex);   // (its own splat texture)
    }
    this.pieces = [];
    this.epoch = (this.epoch ?? 0) + 1;
  }

  // prim from extractPieces; lut / patternLut: {edited, vanilla} LUT keys; info: anything the UI wants back on pick
  async addPiece(prim, lutKeys, info) {
    const gl = this.gl, epoch = this.epoch;   // (clearPieces during the texture loads below: the piece is dropped)
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [];
    const attr = (loc, data, n) => {
      const b = gl.createBuffer(); buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    if (prim.skin) {
      attr(0, prim.skin.rawPos, 3); attr(1, prim.skin.rawNrm, 3); attr(7, prim.skin.joints, 4); attr(8, prim.skin.weights, 4);
    } else { attr(0, prim.pos, 3); attr(1, prim.nrm, 3); }
    attr(3, prim.uv0, 2); attr(4, prim.uv1, 2); attr(6, prim.uv2 ?? prim.uv1, 2);
    const ib = gl.createBuffer(); buffers.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, prim.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const t = prim.tex;
    const [idMasks, baseData, patMasks, camo, composite, wDirt, wSpecial, wBlood, wBug] = await Promise.all([
      this.loadTexture(t.idMasks, { mips: false, variant: true }), this.loadTexture(t.baseData),
      this.loadTexture(t.patternMasks, { mips: false, variant: true }), this.loadTexture(t.camo), this.loadTexture(t.composite),
      this.loadTexture(t.wDirt), this.loadTexture(t.wSpecial), this.loadTexture(t.wBlood), this.loadTexture(t.wBug)]);
    let cape = {};
    if (prim.kind === 'cape') {                       // kit overrides (info.capeTex) first, else the material's own
      const ct = { ...t, ...(info.capeTex ?? {}) };
      const [scalar, tear, gradient, decalSheet, bd2] = await Promise.all([
        this.loadTexture(ct.scalar, { variant: true }), this.loadTexture(ct.tear), this.loadTexture(ct.gradient),
        this.loadTexture(ct.decalSheet, { clamp: true, key: 'clamp:', variant: true }), ct.baseData !== t.baseData ? this.loadTexture(ct.baseData) : null]);
      cape = { scalar, tear, gradient, decalSheet, ...(bd2 ? { baseData: bd2 } : {}) };
    } else if (t.decalSheet && prim.hasUv2) {         // armor base 0xf5eb's decal sheet (hellpod, vehicles, some armor)
      cape = { decalSheet: await this.loadTexture(t.decalSheet, { clamp: true, key: 'clamp:', variant: true }) };
    }
    // the vehicle base material (damage_mask_selector): its vehicle_damage_data; filediver's glTF leaves that slot
    // out, and every material on that base keeps the base's own texture
    const damageTex = prim.params?.damage_mask_selector !== undefined ? await this.loadTexture(t.damage ?? VEHICLE_DAMAGE_DATA) : null;
    const web = webParam(prim.params, 'cobweb_intensity') !== undefined;   // (the materials with cobwebs)
    let skin = null;
    if (prim.skin) {
      const jt = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, jt);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, prim.skin.jointNodes.length * 4, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      skin = { ...prim.skin, tex: jt, key: null };
    }
    const decalHash = cape.decalSheet ? (prim.kind === 'cape' ? ({ ...t, ...(info.capeTex ?? {}) }).decalSheet : t.decalSheet) : null;
    // a cape's design (zones and cut-out, editable: designs.js) and its UV layout (the editors' outline)
    const scalarHash = prim.kind === 'cape' ? ({ ...t, ...(info.capeTex ?? {}) }).scalar ?? null : null;
    const uvWire = cape.decalSheet || scalarHash || t.idMasks ? { uv0: prim.uv0, uv2: prim.hasUv2 ? prim.uv2 : null, idx: prim.idx } : null;
    const idMaskHash = prim.kind !== 'cape' ? t.idMasks ?? null : null;   // the zones' mask (editable: masks.js)
    // where the pattern shows (editable too; not the 1 x 1 "no pattern" texture most parts share)
    const patMaskHash = prim.kind !== 'cape' && t.patternMasks && t.patternMasks !== NO_PATTERN_MASK ? t.patternMasks : null;
    const splat = this.splatTexture(wBlood, wBug);   // (its own texture when bugLayer is 1: freed with the piece)
    const piece = { decalHash, scalarHash, idMaskHash, patMaskHash, uvWire, vao, buffers, count: prim.idx.length, idMasks, baseData, patMasks, camo, composite, skin, shift: prim.shift ?? [0, 0, 0],
      wDirt, wSpecial, wSplat: splat.tex, bugLayer: splat.bugLayer, damageTex, web, lutKeys, info, kind: prim.kind, ...cape,
      params: prim.params, bounds: bounds(prim.pos) };
    if (epoch !== this.epoch) {
      gl.deleteVertexArray(vao); buffers.forEach(b => gl.deleteBuffer(b));
      if (skin?.tex) gl.deleteTexture(skin.tex);
      if (splat.bugLayer === 1) gl.deleteTexture(splat.tex.tex);   // (its own splat texture)
      return null;
    }
    this.pieces.push(piece);
    return piece;
  }

  // the decal sheets and cape designs of the pieces again (after the variant changed or one was edited): only hash,
  // or all; drops a preview (previewTexture)
  async refreshDecals(hash = null) {
    const dropped = [];   // (the cached ones read again: freed once no piece shows them)
    if (hash) for (const [k, t] of [...this.tex]) if (k.endsWith(hash)) { if (t?.tex) dropped.push(t.tex); this.tex.delete(k); }
    const v = this.variant;   // (a later variant switch wins: an older refresh finishing late doesn't overwrite it)
    const put = (p, key, t) => {
      if (this.variant !== v) return;
      const old = p[key];
      p[key] = t;
      if (old?.preview && old.tex !== t?.tex) dropped.push(old.tex);
    };
    try { await this.refreshPieces(hash, put); } finally {
      const used = new Set(this.pieces.flatMap(p => [p.decalSheet, p.scalar, p.idMasks, p.patMasks].map(t => t?.tex)));
      for (const t of [...this.tex.values()]) used.add(t?.tex);
      for (const t of new Set(dropped)) if (t && !used.has(t)) this.gl.deleteTexture(t);
    }
  }
  async refreshPieces(hash, put) {
    await Promise.all(this.pieces.map(async p => {
      if (p.decalHash && (!hash || p.decalHash === hash)) put(p, 'decalSheet', await this.loadTexture(p.decalHash, { clamp: true, key: 'clamp:', variant: true }));
      if (p.scalarHash && (!hash || p.scalarHash === hash)) put(p, 'scalar', await this.loadTexture(p.scalarHash, { variant: true }));
      if (p.idMaskHash && (!hash || p.idMaskHash === hash)) put(p, 'idMasks', await this.loadTexture(p.idMaskHash, { mips: false, variant: true }));
      if (p.patMaskHash && (!hash || p.patMaskHash === hash)) put(p, 'patMasks', await this.loadTexture(p.patMaskHash, { mips: false, variant: true }));
    }));
  }

  // show unsaved pixels (RGBA8, w x h, layers stacked) as texture hash on the model: a decal sheet, a cape design or
  // an ID mask being edited; refreshDecals(hash) goes back to the saved one
  previewTexture(hash, w, h, pixels, layers = 1) {
    const users = this.pieces.filter(p => p.decalHash === hash || p.scalarHash === hash || p.idMaskHash === hash || p.patMaskHash === hash);
    if (!users.length) return;
    const mask = users.some(p => p.idMaskHash === hash) ? 'idMasks' : users.some(p => p.patMaskHash === hash) ? 'patMasks' : null;
    if (mask) {                                             // (masks are read unfiltered between mips, as loaded)
      const t = this.makeArray(w, h, layers, pixels, false);
      for (const p of users) { if (p[mask]?.preview) this.gl.deleteTexture(p[mask].tex); p[mask] = { ...t, preview: true }; }
      return;
    }
    const clamp = users.some(p => p.decalHash === hash);
    const t = this.makeArray(w, h, 1, pixels, true);
    if (clamp) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    for (const p of users) {
      const old = p.decalHash === hash ? p.decalSheet : p.scalar;
      if (old?.preview) this.gl.deleteTexture(old.tex);
      if (p.decalHash === hash) p.decalSheet = { ...t, preview: true }; else p.scalar = { ...t, preview: true };
    }
  }

  frame() {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.pieces) { const [a, b] = placedBounds(p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], b[k]); } }
    if (!isFinite(lo[0])) return;
    this.cam.target = lo.map((v, k) => (v + hi[k]) / 2);
    // (for the camera's own field of view: an Armory camera's narrow one frames from farther)
    this.cam.dist = Math.max(0.5, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.45 * Math.tan(0.3) / Math.tan((this.cam.fov ?? 0.6) / 2));
  }

  matrices(aspect) {
    const c = this.cam;
    const eye = [c.target[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch),
      c.target[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    const view = M4.lookAt(eye, c.target, [0, 1, 0]);
    // clip planes scale with the view: a fleet ship (780 m) or an 11 km model fits as well as a helmet
    const proj = M4.persp(c.fov ?? 0.6, aspect, Math.max(0.02, c.dist * 0.001), Math.max(this.env?.scenery && this.sceneryOn !== false ? 260 : 100, c.dist * 4));
    if (c.shiftX) proj[8] = -c.shiftX;   // a horizontal lens shift: the target sits shiftX right of center (NDC)
    const vp = M4.mul(proj, view);
    return { eye, vp, inv: M4.invert(vp) };
  }

  // a game environment's cube (env.cubeTex from loadCube) on unit 16, its irradiance cube (into the tables) or SH,
  // and scale; uEnvCube 0 = the presets
  envUniforms(u, e) {
    const gl = this.gl, c = e.cubeTex;
    gl.uniform1i(u.uEnvCube, c ? 1 : 0);
    // always a cube on unit 16: an unbound samplerCube stays on unit 0 with the 2D LUT, and WebGL then refuses to draw
    if (!this.blankCube) {
      this.blankCube = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.blankCube);
      for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    this.bindTex(16, gl.TEXTURE_CUBE_MAP, c ? c.tex : this.blankCube, u.uEnvSpec);
    const diff = c?.diff && this.tables;
    gl.uniform1i(u.uEnvDiffCube, diff ? 1 : 0);
    if (diff && this.tables.diff !== c) {             // the bake's irradiance cube into the tables (layers 2-7)
      const b = c.diff.size;
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tables.tex);
      for (let f = 0; f < 6; f++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 2 + f, b, b, 1, gl.RGBA, gl.FLOAT, c.diff.data.subarray(f * b * b * 4, (f + 1) * b * b * 4));
      this.tables.diff = c;
    }
    // planet lighting: the frame written shaped, graded after (draw's grade pass; the showcase's composite)
    if (u.uGradeOn) gl.uniform1i(u.uGradeOn, this.gradeOn ? 1 : 0);
    if (!c) return;
    gl.uniform1f(u.uEnvMips, c.mips); gl.uniform1f(u.uEnvScale, e.envScale ?? 1); gl.uniform1f(u.uEnvRot, e.envRot ?? 0);
    if (u.uSH) gl.uniform3fv(u.uSH, c.sh);
  }

  // a skinned piece's joint matrices for the current pose (uploaded when the pose changed)
  poseSkin(p) {
    const gl = this.gl;
    const pose = p.pose !== undefined ? p.pose : this.pose;   // (a piece's own pose: a scene's characters)
    // (a pose may bring the avatar's bones already solved: world, a name -> matrix map, under its own key; a scene's
    // Helldiver whose left hand is put on the weapon it holds)
    const key = (this.avatarSkel && !p.info?.vehicle ? 'avatar:' : '') + (pose ? pose.key ?? `${pose.clip.animation}@${pose.time.toFixed(4)}` : 'bind');
    if (p.skin.key === key) return;
    const sk = p.skin.skel;
    if (!sk.bind) sk.bind = poseSkeleton(sk, null, 0);
    let avatar = null;                         // the avatar's bones, posed or at rest (until it loads: the piece's own)
    if (this.avatarSkel && !p.info?.vehicle) { // (armor and capes: vehicles, weapons, backpacks have skeletons of their own)
      this.avatars ??= new Map();
      if (!this.avatars.has(key)) { if (this.avatars.size > 16) this.avatars.clear(); this.avatars.set(key, pose?.world ?? avatarWorld(this.avatarSkel, pose?.clip ?? null, pose?.time ?? 0)); }
      avatar = this.avatars.get(key);
    }
    const world = avatar ? null : poseSkeleton(sk, pose?.clip, pose?.time ?? 0);
    const n = p.skin.jointNodes.length, data = new Float32Array(n * 16);
    for (let k = 0; k < n; k++) {
      const node = p.skin.jointNodes[k], ibm = Array.from(p.skin.ibm.subarray(k * 16, k * 16 + 16));
      data.set(M4.mul(avatar ? jointWorld(sk, avatar, node) : world[node], ibm), k * 16);
    }
    gl.activeTexture(gl.TEXTURE8);                 // (the joints' unit)
    gl.bindTexture(gl.TEXTURE_2D, p.skin.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n * 4, 1, gl.RGBA, gl.FLOAT, data);
    p.skin.key = key;
  }

  // the shadow maps (LUT Studio's own: orthographic depth maps around the scene in one 2048^2 texture; shaders.js
  // shadowAt filters them): toLights, the directions toward the lights that cast shadows: one (the sun) takes the
  // whole texture; several (the Armory menu's 4 lights, as the game: a 2 x 2 grid) a quarter each. Returns the
  // uniforms ({mats, tiles, texels, count}), or null without pieces
  shadowPass(toLights) {
    const gl = this.gl, S = 2048, target = gl.getParameter(gl.FRAMEBUFFER_BINDING);   // (the caller's, restored)
    if (!this.shadow) {
      gl.activeTexture(gl.TEXTURE13);   // (its own unit: not unit 0, which a shadow program's joint sampler reads)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, S, S);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      this.shadow = { tex, fbo, prog: this.program(VERT, SHADOW_FRAG), capeProg: this.program(VERT, SHADOW_CAPE_FRAG) };
    }
    if (!toLights?.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.pieces) { const [a, b] = placedBounds(p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], b[k]); } }
    if (!isFinite(lo[0])) return null;
    const c = lo.map((v, k) => (v + hi[k]) / 2), r = Math.max(1e-3, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.15);
    const n = Math.min(4, toLights.length), grid = n > 1 ? 2 : 1, T = S / grid;
    const out = { mats: new Float32Array(64), tiles: new Float32Array(12), texels: new Float32Array(4), count: n };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
    gl.viewport(0, 0, S, S);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
    for (let i = 0; i < n; i++) {
      const L = norm(toLights[i]), up = Math.abs(L[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
      const mat = M4.mul(M4.ortho(r, r * 0.5, r * 3.5), M4.lookAt(c.map((v, k) => v + L[k] * 2 * r), c, up));
      const tx = i % grid, ty = Math.floor(i / grid);
      gl.viewport(tx * T, ty * T, T, T);
      out.mats.set(mat, i * 16); out.tiles.set([tx / grid, ty / grid, 1 / grid], i * 3); out.texels[i] = 2 * r / T;
      this.shadowDraw(mat);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    return out;
  }
  // the pieces' depth from one light (shadowPass)
  shadowDraw(mat) {
    const gl = this.gl;
    for (const p of this.pieces) {
      if (this.pieceFilter && !this.pieceFilter(p)) continue;
      const pr = p.kind === 'cape' ? this.shadow.capeProg : this.shadow.prog, u = pr.u;
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(u.uViewProj, false, mat);
      gl.uniform3fv(u.uShift, p.shift ?? [0, 0, 0]);
      setRot(gl, u, p);
      if (p.kind === 'cape') {
        this.bindTex(15, gl.TEXTURE_2D_ARRAY, (p.scalar ?? this.white).tex, u.uScalar);
        this.bindTex(1, gl.TEXTURE_2D_ARRAY, (p.tear ?? this.white).tex, u.uTear);
        gl.uniform1f(u.uTearAmount, p.params.tear_amount?.[0] ?? 0);
      } else {
        this.bindTex(2, gl.TEXTURE_2D_ARRAY, (p.idMasks ?? this.blank).tex, u.uIdMasks);
        gl.uniform1i(u.uHoles, holes(p) ? 1 : 0);
      }
      gl.uniform1i(u.uJointTex, 8);   // (unskinned too: the sampler never on unit 0, where the shadow map may sit)
      if (p.skin) { this.poseSkin(p); this.bindTex(8, gl.TEXTURE_2D, p.skin.tex, u.uJointTex); }
      gl.uniform1i(u.uSkinned, p.skin ? 1 : 0);
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  bindTex(unit, target, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    gl.uniform1i(loc, unit);
  }

  // draws the scene; pick: {x, y} in canvas pixels -> returns {piece, zone} or null
  draw(time = 0, pick = null, size = null) {
    // the showcase (showcase.js): its passes draw the scene through here (into its own targets) and finish the frame
    if (!pick && this.post && !this.postInner) return this.post.draw(this, time, size);
    // planet lighting: the frame into a target of its own (shaped), then through the planet's 3D LUT
    // (not for a debug view: its values as they are; nor a cut-out picture: noSky, its background clear)
    this.gradeOn = !!this.env?.grade?.tex && !this.debug && (!this.noSky || this.postInner);
    if (!pick && !this.target && !this.postInner && this.gradeOn) return this.gradeDraw(time, size);
    const gl = this.gl, cv = this.canvas, tg = !pick ? this.target : null;   // (target: {fbo, w, h}, an offscreen one)
    const W = tg ? tg.w : size ? size[0] : cv.width, H = tg ? tg.h : size ? size[1] : cv.height;
    const m = this.matrices(W / H);
    const { vp, inv } = m, eye = this.eyeOverride ?? m.eye;
    const e = this.env;
    const az = e.sunAzLight ?? e.sunAz, elev = this.sunElevUser !== null ? this.sunElevUser * Math.PI / 180 : e.sunElev;
    let sd = [Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)];
    let sunCol = e.sun.map(x => x * e.sunIntensity * (this.sunOn ? 1 : 0));
    // a camera-locked rig (e.dirLights): its directions turned with the camera's yaw; its first light takes the sun's
    // place; every light casts a shadow (as the Armory menu's)
    const ph = this.cam.yaw - Math.PI, cy = Math.cos(ph), sy = Math.sin(ph);
    const dirLights = (e.dirLights ?? []).map(l => ({ dir: [l.dir[0] * cy + l.dir[2] * sy, l.dir[1], -l.dir[0] * sy + l.dir[2] * cy], color: l.color }));
    if (dirLights.length) { sd = norm(dirLights[0].dir); sunCol = dirLights[0].color; }
    // shadows: the sun's; with a rig, every light's (the first is the sun's slot)
    const casters = dirLights.length ? dirLights.slice(0, 4).map(l => l.dir) : [sd];
    const shadow = this.shadowPass(!pick && this.shadows && sunCol.some(x => x > 0) ? casters : null);
    let fbo = null, tex = null, rb = null;
    if (pick) {
      fbo = gl.createFramebuffer(); tex = gl.createTexture(); rb = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    } else if (tg) gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fbo);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    const bd = Array.isArray(e.backdrop) ? e.backdrop : [0, 0, 0];   // (backdrop 'black': the showroom's black box; or a color)
    gl.clearColor(bd[0], bd[1], bd[2], !pick && e.backdrop && !this.noSky ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!pick && !this.noSky && !e.backdrop) {          // sky (noSky: accuracy checks read cut-out pixels as cleared)
      gl.depthMask(false);
      gl.useProgram(this.bg.p);
      const u = this.bg.u;
      gl.uniformMatrix4fv(u.uInvViewProj, false, inv); gl.uniform3fv(u.uCamPos, eye);
      gl.uniform3fv(u.uSkyZenith, e.zenith); gl.uniform3fv(u.uSkyHorizon, e.horizon); gl.uniform3fv(u.uGround, e.ground);
      gl.uniform1f(u.uExposure, e.exposure);
      this.envUniforms(u, e);
      gl.uniform1f(u.uBgLod, e.bgBlur ?? 0);
      gl.uniform2fv(u.uBackdrop, e.backdropGrad ?? [0, 0]);
      this.groundUniforms(u, e, sd, sunCol);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }
    // the planet scene (planetscene.js): its hills and props, before the model (not in a pick or a reflection)
    if (!this.mirror && !(this.noSky && !this.postInner) && this.sceneryOn !== false && e.scenery?.draw && this.pieces.length) {
      this.ensureGroundTex(e);
      if (pick) gl.colorMask(false, false, false, false);
      e.scenery.draw(vp, eye, sd, sunCol, e, this.groundParams(sd, sunCol), this.groundTex);
      if (pick) gl.colorMask(true, true, true, true);
    }
    const setGlobals = (u) => {
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uCamPos, eye);
    gl.uniform3fv(u.uSunDir, sd); gl.uniform3fv(u.uSunColor, sunCol); gl.uniform1f(u.uSunSize, dirLights.length ? 0.5 : e.sunSize ?? 1);
    gl.uniform1i(u.uShadowOn, shadow ? shadow.count : 0); gl.uniform1i(u.uShadowSoft, dirLights.length ? 1 : 0);
    if (shadow) { gl.uniformMatrix4fv(u.uShadowMat, false, shadow.mats); gl.uniform3fv(u.uShadowTile, shadow.tiles); gl.uniform1fv(u.uShadowTexel, shadow.texels); }
    this.bindTex(13, gl.TEXTURE_2D, this.shadow.tex, u.uShadowMap);   // (a shadow sampler needs a depth texture bound)
    gl.uniform3fv(u.uSkyZenith, e.zenith); gl.uniform3fv(u.uSkyHorizon, e.horizon); gl.uniform3fv(u.uGround, e.ground);
    gl.uniform1f(u.uExposure, e.exposure); gl.uniform1f(u.uEmissiveScale, e.emissive ?? 1);
    gl.uniform1i(u.uFlashlight, e.flashlight ? 1 : 0);
    gl.uniform1i(u.uMirror, this.mirror && !pick ? 1 : 0);
    // the side lights: around the model relative to the camera (0 deg = from the camera, 90 = its right, 270 = its
    // left), at their height (el), so they stay on the same side of the screen as the view turns
    const t = this.cam.target, cd = norm([eye[0] - t[0], 0, eye[2] - t[2]]), rd = [cd[2], 0, -cd[0]];
    const rimDir = [], rimCol = [];
    for (let i = 0; i < 2; i++) {   // (the shader's two side lights: one not given is off, not left as it was)
      const l = this.rim[i] ?? { on: false, az: 0, el: 0 };
      const a = l.az * Math.PI / 180, el = l.el * Math.PI / 180;
      rimDir.push(Math.cos(el) * (Math.cos(a) * cd[0] + Math.sin(a) * rd[0]), Math.sin(el), Math.cos(el) * (Math.cos(a) * cd[2] + Math.sin(a) * rd[2]));
      rimCol.push(...(l.on ? l.color.map(x => x * l.intensity) : [0, 0, 0]));
    }
    gl.uniform3fv(u.uRimDir, rimDir); gl.uniform3fv(u.uRimColor, rimCol);
    // a game light rig (e.lights: {pos, aim, color, intensity, start, end, cone (full angle, rad; 0 = omni)}, model
    // space: feet at the origin, the front toward -Z)
    const lp = new Float32Array(18), ld = new Float32Array(18), lc = new Float32Array(18), lr = new Float32Array(24);
    (e.lights ?? []).slice(0, 6).forEach((l, i) => {
      lp.set(l.pos, i * 3);
      ld.set(norm(l.aim.map((v, k) => v - l.pos[k])), i * 3);
      lc.set(l.color.map(c => c * l.intensity * (e.lightScale ?? 1)), i * 3);
      lr.set([l.start ?? 0, l.end, l.cone ? Math.cos(l.cone / 2) : -1, 0], i * 4);
    });
    gl.uniform3fv(u.uLPos, lp); gl.uniform3fv(u.uLDir, ld); gl.uniform3fv(u.uLColor, lc); gl.uniform4fv(u.uLRange, lr);
    // the Armory menu's directional lights (e.dirLights: {dir toward the light, color}, for the camera in front, on -Z):
    // locked to the camera, so turned with its yaw
    const dd = new Float32Array(12), dc = new Float32Array(12);
    dirLights.slice(1, 5).forEach((l, i) => { dd.set(l.dir, i * 3); dc.set(l.color, i * 3); });   // (the first: the sun's slot)
    gl.uniform3fv(u.uDLDir, dd); gl.uniform3fv(u.uDLColor, dc);
    gl.uniform1f(u.uUiAmbient, e.uiAmbient ?? 0); gl.uniform1f(u.uSpecScale, e.specScale ?? 1);
    const tone = e.tone ?? [2.51, 0.03, 2.43, 0.59, 0.14];
    gl.uniform4fv(u.uTone, tone.slice(0, 4)); gl.uniform1f(u.uToneE, tone[4]); gl.uniform1i(u.uRawOut, e.rawOut ? 1 : 0);
    this.envUniforms(u, e);
    gl.uniform1i(u.uDebug, this.debug); gl.uniform1i(u.uPick, pick ? pick.mode ?? 1 : 0);
    gl.uniform1f(u.uTime, time);
    const wd = this.world, raw = this.worldRaw;     // worldRaw: exact shader inputs (accuracy check)
    // all axes for dirt / mud / blood / gunk; snow settles mostly on up-facing (+Z object space) faces
    const sp = wd.snow > 0 ? [0.4 * wd.snow, 0.4 * wd.snow, 1.2 * wd.snow] : [wd.mud, wd.mud, wd.mud];
    const sn = wd.snow > 0 ? [0.4 * wd.snow, 0.4 * wd.snow, 0] : [wd.mud, wd.mud, wd.mud];
    gl.uniform3fv(u.uWpos, raw?.pos ?? [wd.blood, wd.blood, wd.blood, wd.gunk, wd.gunk, wd.gunk, wd.dirt, wd.dirt, wd.dirt, ...sp]);
    gl.uniform3fv(u.uWneg, raw?.neg ?? [wd.blood, wd.blood, wd.blood, wd.gunk, wd.gunk, wd.gunk, wd.dirt, wd.dirt, wd.dirt, ...sn]);
    gl.uniform1i(u.uCase, raw?.case ?? (wd.snow > 0 ? 2 : wd.mud > 0 ? 1 : 0));
    gl.uniform1f(u.uFrost, raw?.frost ?? wd.frost * 0.41);
    gl.uniform3fv(u.uBsw, raw?.bsw ?? [wd.burn, wd.scorch ? 1 : 0, wd.wet]);
    gl.uniform4fv(u.uHww, raw?.hww ?? [-100, 0, -100, 0]);   // no wet / wash lines
    gl.uniform1i(u.uObjTest, raw ? 1 : 0);
    gl.uniform1f(u.uMatWet, 0);
    gl.uniform3fv(u.uSnowBase, raw?.snowBase ?? this.env?.planet?.snow ?? [0.82, 0.85, 0.9]); gl.uniform3fv(u.uSnowFuzz, raw?.snowFuzz ?? [0.9, 0.92, 0.95]); gl.uniform1f(u.uSnowSpec, raw?.snowSpec ?? 0.5);  // c_snow (a planet's: its snow_base_color; else placeholders)
    gl.uniform3fv(u.uSnowSss, raw?.snowSss ?? [0.55, 0.7, 0.85]); gl.uniform3fv(u.uSnowSssP, raw?.snowSssP ?? [0.5, 0.5, 0.5]);
    gl.uniform2f(u.uRnd, 0, 0);
    this.bindTex(5, gl.TEXTURE_2D_ARRAY, this.detail?.tex ?? this.blank.tex, u.uDetail);
    this.bindTex(9, gl.TEXTURE_2D_ARRAY, this.tables?.tex ?? this.blank.tex, u.uLuts);
    };
    const halves = !pick && this.split ? [['vanilla', 0, W >> 1], ['edited', W >> 1, W - (W >> 1)]] : [['edited', 0, W]];
    for (const [which, x0, w] of halves) {
      if (halves.length > 1) { gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, 0, w, H); }
      let cur = null;
      this.pieces.forEach((p, i) => {
        if (this.pieceFilter && !this.pieceFilter(p)) return;   // (pieces left out of the view: the roles review)
        const key = p.lutKeys[which] ?? p.lutKeys.edited;
        // the "before" half: the game's textures too (ID mask, pattern mask, decal sheet, cape design), not the
        // variant's edited ones; loaded when first needed, the edited ones meanwhile
        const tx = which === 'vanilla' ? { ...p, ...(this.vanillaTex(p) ?? {}) } : p;
        const lut = this.luts.get(key);
        if (!lut) return;
        const pr = p.kind === 'cape' ? this.capeProg : this.prog;
        if (pr !== cur) { gl.useProgram(pr.p); setGlobals(pr.u); cur = pr; }
        const u = pr.u;
        if (p.kind === 'cape') {                       // cape LUT and textures
          const ck = p.lutKeys[which === 'vanilla' ? 'capeVanilla' : 'cape'] ?? p.lutKeys.cape;
          const cl = this.luts.get(ck);
          this.bindTex(14, gl.TEXTURE_2D, cl ? cl.tex : lut.tex, u.uCapeLut);
          gl.uniform1i(u.uCapeRows, cl ? cl.h : 0);
          this.bindTex(15, gl.TEXTURE_2D_ARRAY, (tx.scalar ?? this.white).tex, u.uScalar);
          this.bindTex(1, gl.TEXTURE_2D_ARRAY, (p.tear ?? this.white).tex, u.uTear);
          this.bindTex(2, gl.TEXTURE_2D_ARRAY, (p.gradient ?? this.white).tex, u.uGradient);
          this.bindTex(4, gl.TEXTURE_2D_ARRAY, (tx.decalSheet ?? this.blank).tex, u.uDecalSheet);
          const Pc = (k, d) => p.params[k]?.[0] ?? d;
          gl.uniform1f(u.uTearAmount, Pc('tear_amount', 0));
          gl.uniform1f(u.uHeightMult, Pc('cape_height_mult', 1.5)); gl.uniform1f(u.uHeightBase, Pc('cape_height_from_ground', 0.2));
        }
        this.bindTex(0, gl.TEXTURE_2D, lut.tex, u.uLut);
        gl.uniform1i(u.uLutRows, lut.h);
        if (p.kind !== 'cape') {
        const pl = p.lutKeys.pattern && this.luts.get(which === 'vanilla' && p.info?.pattern && this.luts.has('v:' + p.info.pattern)
          ? 'v:' + p.info.pattern : p.lutKeys.pattern);
        this.bindTex(1, gl.TEXTURE_2D, pl ? pl.tex : lut.tex, u.uPatLut);
        gl.uniform1i(u.uHasPatLut, pl ? 1 : 0);
        this.bindTex(2, gl.TEXTURE_2D_ARRAY, (tx.idMasks ?? this.blank).tex, u.uIdMasks);
        gl.uniform1i(u.uIdLayers, p.params.fd_id_mask_layers?.[0] ?? tx.idMasks?.layers ?? 1);
        gl.uniform1i(u.uHoles, holes(p) ? 1 : 0);
        if (u.uVehicle) gl.uniform1i(u.uVehicle, p.info?.vehicle ? 1 : 0);
        this.bindTex(3, gl.TEXTURE_2D_ARRAY, (p.baseData ?? this.white).tex, u.uBaseData);
        this.bindTex(4, gl.TEXTURE_2D_ARRAY, (tx.patMasks ?? this.blank).tex, u.uPatMasks);
        gl.uniform1i(u.uPatLayers, tx.patMasks?.layers ?? 1);
        this.bindTex(15, gl.TEXTURE_2D_ARRAY, (tx.decalSheet ?? this.blank).tex, u.uDecalSheet);
        gl.uniform1i(u.uHasDecal, tx.decalSheet ? 1 : 0);
        {
          const Pd = (k, d) => p.params[k]?.[0] ?? d;
          // settings a material leaves out: the armor base's decal cell (100 x 100); the vehicle base sets none (0)
          const cellDef = p.params.damage_mask_selector !== undefined ? 0 : 100;
          gl.uniform2f(u.uDecalSize, Pd('decal_size_x', cellDef), Pd('decal_size_y', cellDef));
          gl.uniform2f(u.uDecalOff, Pd('decal_id_offset_x', 0), Pd('decal_id_offset_y', cellDef));
          gl.uniform1f(u.uDecalId, this.worldRaw?.decalId ?? this.decalId);
          // vehicle damage: the slider's value on the zones the material's damage_mask_selector names
          gl.uniform1f(u.uDamage, this.worldRaw?.damage ?? this.world.damage ?? 0);
          gl.uniform1i(u.uDamageMask, Math.trunc(Pd('damage_mask_selector', 0)));
          gl.uniform1f(u.uDamageTile, Pd('vehicle_damage_data_tile', 0));
          this.bindTex(17, gl.TEXTURE_2D_ARRAY, (p.damageTex ?? this.gray).tex, u.uDamageTex);
          gl.uniform4f(u.uDecalPal, Pd('use_decal_rgb_channels', 0), Pd('decal_channel_selection', 0), Pd('decal_lut_id', 0), 0);
          gl.uniform2f(u.uDecalLutSize, Pd('decal_lut_size_x', 0), Pd('decal_lut_size_y', 0));
          const se = p.params.decal_scalarfield_end ?? [0, 0];   // vehicles' decal relief (0: off)
          gl.uniform4f(u.uDecalRelief, se[0], se[1], Pd('decal_normal_offset', 0), Pd('decal_normal_intentity', 0));
          gl.uniform3f(u.uDecalAlpha, Pd('decal_alpha_offset', 0), Pd('decal_alpha_sharpness', 1), Pd('underlying_normal_behind_decal_opacity', 1));
        }
        } else this.bindTex(3, gl.TEXTURE_2D_ARRAY, (p.baseData ?? this.white).tex, u.uBaseData);
        this.bindTex(6, gl.TEXTURE_2D_ARRAY, (p.camo ?? this.blank).tex, u.uCamo);
        this.bindTex(7, gl.TEXTURE_2D_ARRAY, (p.composite ?? this.blank).tex, u.uComposite);
        gl.uniform1f(u.uDetailMult, p.params.detail_tile_factor_mult?.[0] ?? 1);
        const P = (k, d) => p.params[k]?.[0] ?? d;
        gl.uniform1f(u.uTile, P('weathering_tile_factor', 8)); gl.uniform1f(u.uBloodScale, P('blood_scale', 0.25));
        gl.uniform1f(u.uGunkScale, P('gunk_scale', 0.3)); gl.uniform1f(u.uGunkMin, P('bug_gunk_minimum', 0));
        gl.uniform1f(u.uBloodNFade, P('blood_normal_fade', 0.5)); gl.uniform1f(u.uGunkNFade, P('gunk_normal_fade', 0.8));
        gl.uniform1f(u.uBGNInt, P('blood_gunk_normal_intensity', 0.7));
        const web = p.web && this.webLayer >= 0 ? (this.worldRaw?.cobweb ?? this.world.cobweb ?? 0) : 0;
        gl.uniform1f(u.uWebInt, web);
        if (web > 0) {
          gl.uniform1f(u.uWebLayer, this.webLayer);
          gl.uniform3fv(u.uWebColor, webParam(p.params, 'cobweb_color') ?? [0.7913, 0.5149, 0]);
          gl.uniform1f(u.uWebRough, webParam(p.params, 'cobweb_roughness')?.[0] ?? 0);
          gl.uniform1f(u.uWebRes, webParam(p.params, 'cobweb_resolution')?.[0] ?? 1);
          gl.uniform2fv(u.uWebOff, webOffset(webParam(p.params, 'cobweb_uv_seed')?.[0] ?? 0));
        }
        gl.uniform3fv(u.uBloodColor, p.params.blood_color ?? [0.251, 0, 0.051]);
        gl.uniform3fv(u.uGunkColor, p.params.special_gunk_color ?? [0.494, 0.337, 0.133]);
        this.bindTex(10, gl.TEXTURE_2D_ARRAY, (p.wDirt ?? this.blank).tex, u.uWDirt);
        this.bindTex(11, gl.TEXTURE_2D_ARRAY, (p.wSpecial ?? this.blank).tex, u.uWSpecial);
        this.bindTex(12, gl.TEXTURE_2D_ARRAY, (p.wSplat ?? this.blank).tex, u.uWSplat);
        gl.uniform1f(u.uBugLayer, p.bugLayer ?? 0);
        gl.uniform1f(u.uPieceId, i);
        gl.uniform3fv(u.uShift, p.shift ?? [0, 0, 0]);
        setRot(gl, u, p);
        if (p.skin) {
          this.poseSkin(p);                            // pose the skeleton, upload joint matrices
          this.bindTex(8, gl.TEXTURE_2D, p.skin.tex, u.uJointTex);
          gl.uniform1i(u.uSkinned, 1);
        } else gl.uniform1i(u.uSkinned, 0);
        gl.uniform1i(u.uHighlightZone, this.highlight.piece === i || this.highlight.lut === p.lutKeys.edited || (p.lutKeys.cape && this.highlight.lut === p.lutKeys.cape) ? this.highlight.zone : -1);
        gl.bindVertexArray(p.vao);
        gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
      });
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    if (pick) {
      const px = new Uint8Array(4);
      gl.readPixels(pick.x, H - 1 - pick.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteRenderbuffer(rb);
      if (pick.mode === 2) return { u: (px[0] * 255 + px[1]) / 65025, v: (px[2] * 255 + px[3]) / 65025 };
      return px[3] ? { piece: px[1] + px[2] * 256, zone: px[0] } : null;
    }
    return null;
  }
}

function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  return [lo, hi];
}
