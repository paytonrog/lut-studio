// Planet lighting's ground (planets/planets.json, app.js planetEnv): a tile of the planet's ground for the showcase's
// floor, from the game's terrain textures of its main layers (the install's, /api/tex), each scaled to its layer's
// graded albedo, mixed in soft patches, and its snow where it has some. Out: 512 x 512 RGBA, sRGB-encoded albedo.

const N = 512;
const lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

// the layers that cover the open ground (not roads, shores, water, pebble paths), rock last
export function groundLayers(p) {
  const open = l => !/road|shore|water|pebble|bogs/i.test(l.name), rock = l => /rock/i.test(l.name);
  const pick = p.ground.filter(l => open(l) && !rock(l)).slice(0, 3);
  const r = p.ground.find(rock);
  return r ? [...pick, r] : pick.length ? pick : p.ground.slice(0, 3);
}

// a texture of the install as linear RGB at N x N (null: not an RGBA image)
async function texLinear(hash) {
  try {
    const b = new Uint8Array(await (await fetch('/api/tex?hash=' + hash)).arrayBuffer()), dv = new DataView(b.buffer);
    const w = dv.getUint32(4, true), h = dv.getUint32(8, true), fmt = dv.getUint32(16, true);
    if (fmt !== 0 || b.length < 20 + w * h * 4) return null;
    const out = new Float32Array(N * N * 3), T = new Float32Array(256).map((_, i) => lin(i / 255));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = 20 + ((Math.floor(y * h / N) * w + Math.floor(x * w / N)) * 4), o = (y * N + x) * 3;
      out[o] = T[b[i]]; out[o + 1] = T[b[i + 1]]; out[o + 2] = T[b[i + 2]];
    }
    return out;
  } catch { return null; }
}

// soft, tiling patches: 0..1 (sums of waves whole over the tile)
function patches(seed) {
  const f = new Float32Array(N * N), w = [];
  for (let k = 0; k < 6; k++) w.push([1 + ((seed * 7 + k * 3) % 4), 1 + ((seed * 5 + k * 2) % 3), (seed * 1.7 + k * 2.3) % 6.283]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [a, b, ph] of w) v += Math.sin(6.283 * (a * x + b * y) / N + ph) + Math.sin(6.283 * (b * x - a * y) / N + ph * 1.3);
    f[y * N + x] = 0.5 + v / 14;
  }
  return f;
}

export async function groundTile(p) {
  const layers = groundLayers(p);
  const texs = await Promise.all(layers.map(l => texLinear(l.texture)));
  const out = new Uint8ClampedArray(N * N * 4), masks = layers.map((_, i) => patches(i + 1));
  const snow = p.snow ? patches(9) : null;
  const scale = texs.map((t, i) => {
    if (!t) return null;
    const m = [0, 0, 0];
    for (let j = 0; j < t.length; j += 3) for (let k = 0; k < 3; k++) m[k] += t[j + k];
    return m.map((v, k) => layers[i].albedo[k] / Math.max(v / (N * N), 1e-4));
  });
  const meanL = layers.reduce((t, l) => t + 0.2126 * l.albedo[0] + 0.7152 * l.albedo[1] + 0.0722 * l.albedo[2], 0) / Math.max(layers.length, 1);
  for (let j = 0; j < N * N; j++) {
    const c = [0, 0, 0]; let ws = 0;
    layers.forEach((l, i) => {
      const w = Math.pow(masks[i][j], 6) * (i === layers.length - 1 && /rock/i.test(l.name) ? 0.5 : 1);
      for (let k = 0; k < 3; k++) c[k] += w * (texs[i] ? texs[i][j * 3 + k] * scale[i][k] : l.albedo[k]);
      ws += w;
    });
    for (let k = 0; k < 3; k++) c[k] /= Math.max(ws, 1e-6);
    if (snow) {   // (its edge broken up by the ground's own detail: snow lies in the hollows first)
      const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / Math.max(meanL, 1e-4) - 1;
      const s = Math.min(1, Math.max(0, (snow[j] - 0.45 - 0.35 * l) * 4));
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - s) + p.snow[k] * s;
    }
    out[j * 4] = enc(c[0]); out[j * 4 + 1] = enc(c[1]); out[j * 4 + 2] = enc(c[2]); out[j * 4 + 3] = 255;
  }
  return { w: N, h: N, px: out };
}
