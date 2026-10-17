// The showcase look, live in the viewport (scene.js puts the scene in; the Theme panel's Showcase): each frame the
// renderer draws the scene into a target of its own, upside down under the floor for the reflection, and from under
// the floor for the contact shadows; then GPU passes finish the frame as key art: a backdrop (a dark ground, a glowing
// disc in the theme's color behind the squad, soft bokeh), the floor (a pool of light, the reflection fading with
// height, contact shadows, haze), the scene (the far part hazed), a glow around it, sparks, bloom, the tone and grain,
// a vignette and the title. The frame is 16:9 (the exported image's), letterboxed in the viewport; the camera moves
// as ever. exportCanvas(w, h) draws the same frame at that size into a 2D canvas.
import { M4 } from './render.js';

// the look's settings (the Showcase sliders: 1 = the default look; color: the light's, '' = the theme's)
export const LOOK = {
  bg: 1, glow: 1, glowSize: 1, color: '', rim: 1, exposure: 1, reflect: 1, shadow: 1, haze: 1, aura: 1, bloom: 1,
  embers: 1, grain: 1, vignette: 1, punch: 1, title: 1,
};

// the tone: a gentle S-curve, then the midtones lifted (as the key art first had it from ImageMagick:
// -sigmoidal-contrast 1.8x40%, then a 50% grey soft-lit over it), 8-bit in, 8-bit out (255 past the table)
const TONE = [0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 125, 127, 129, 131, 133, 135, 137, 139, 141, 144, 146, 148, 150, 152, 154, 156, 158, 161, 163, 165, 167, 169, 171, 173, 175, 178, 180, 182, 184, 186, 188, 190, 193, 195, 197, 199, 201, 203, 206, 208, 210, 212, 214, 216, 218, 221, 223, 225, 227, 229, 231, 233, 236, 238, 240, 242, 244, 246, 248, 251, 253];
export const tone8 = v => (v < TONE.length ? TONE[v] : 255);

const FS_VERT = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
`;
// a separable gaussian (dir: one texel along x or y)
const BLUR = HEAD + `uniform sampler2D uSrc; uniform vec2 uDir; uniform float uSigma;
void main() {
  float s = max(uSigma, 0.5); int n = int(ceil(s * 3.0)); vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -48; i <= 48; i++) { if (i < -n || i > n) continue; float w = exp(-0.5 * float(i * i) / (s * s));
    acc += texture(uSrc, vUv + uDir * float(i)) * w; wsum += w; }
  o = acc / wsum;
}`;
// the glow's source: the scene's near part (closer than uFocus), as alpha
const GLOWSRC = HEAD + `uniform sampler2D uScene; uniform sampler2D uDepth; uniform vec2 uNF; uniform float uFocus;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
void main() { vec4 c = texture(uScene, vUv); float z = lin(texture(uDepth, vUv).r); o = vec4(c.a * (1.0 - smoothstep(uFocus, uFocus + 1.5, z))); }`;
// bloom's source: the bright part (70-100%) at 45%
const BRIGHT = HEAD + `uniform sampler2D uSrc; uniform float uAmt;
void main() { vec3 c = texture(uSrc, vUv).rgb; o = vec4(max(vec3(0.0), (c - 0.7) / 0.3) * 0.45 * uAmt, 1.0); }`;
// the composite: backdrop, floor, the scene, glow, sparks (before the tone)
const COMP = HEAD + `uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uRefl; uniform sampler2D uReflDepth;
uniform sampler2D uContact; uniform sampler2D uGlow;
uniform mat4 uInv; uniform vec3 uEye; uniform vec2 uNF; uniform float uFocus; uniform vec2 uRes;
uniform vec3 uAccent; uniform float uK; uniform vec2 uDisc; uniform vec3 uFloorC;
uniform mat4 uContactMat; uniform float uContactRange;
uniform float uBg, uGlowAmt, uGlowSize, uReflect, uShadow, uHaze, uAura, uEmbers, uSeed;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
vec3 unproj(vec2 uv, float d) { vec4 p = uInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
// a disc blurred by sigma (both in frame heights): 1 inside, 0 far out
float soft(float d, float r, float s) { return 1.0 - smoothstep(r - 1.6 * s, r + 1.6 * s, d); }
vec3 over(vec3 b, vec3 c, float a) { return mix(b, c, clamp(a, 0.0, 1.0)); }
vec3 screen(vec3 b, vec3 c) { return 1.0 - (1.0 - b) * (1.0 - c); }
// sparks or bokeh on a grid of cells (cell: frame heights); each cell maybe one, at a random spot, size, strength
float dots(vec2 q, float cell, float rmin, float rmax, float chance, float soft_, float seed) {
  vec2 g = floor(q / cell), f = q / cell - g; float a = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(i, j), h = vec2(hash(c + seed), hash(c + seed + 17.3));
    if (hash(c + seed + 5.1) > chance) continue;
    float r = mix(rmin, rmax, hash(c + seed + 9.7)) / cell, d = length(f - vec2(i, j) - h);
    a = max(a, (1.0 - smoothstep(r * (1.0 - soft_), r, d)) * mix(0.25, 1.0, hash(c + seed + 3.3)));
  }
  return a;
}
void main() {
  vec2 px = vUv * uRes; float H = uRes.y; vec2 q = px / H;   // (frame heights)
  vec3 col = vec3(0.0235, 0.0275, 0.0353) * uBg;
  // the light behind: a wide soft glow, a brighter core, a hot center (around the projected anchor)
  float d = length(q - uDisc);
  col = over(col, uAccent * uBg, 0.32 * uK * uGlowAmt * soft(d, 0.55 * uGlowSize, 0.11 * uGlowSize));
  col = over(col, uAccent * uBg, 0.8 * uK * uGlowAmt * soft(d, 0.3 * uGlowSize, 0.05 * uGlowSize));
  col = over(col, vec3(uBg), 0.45 * uK * uK * uGlowAmt * soft(d, 0.15 * uGlowSize, 0.056 * uGlowSize));
  // bokeh, rising in the light
  col = screen(col, uAccent * dots(q, 0.16, 0.007, 0.03, 0.25, 0.6, 1.0) * 0.12 * uEmbers * uBg * smoothstep(0.2, 0.35, q.y));   // (q.y: up from the bottom)
  vec4 sc = texture(uScene, vUv); float depth = texture(uDepth, vUv).r;
  // the floor (y = 0) where no part covers it
  vec3 ray = normalize(unproj(vUv, 1.0) - uEye);
  if (ray.y < -1e-4 && uEye.y > 0.0) {
    float t = -uEye.y / ray.y; vec3 P = uEye + ray * t;
    // a pool of light around the squad, the reflection (fading with the height it mirrors), contact shadows, haze;
    // all fading out with distance into the backdrop (no horizon line)
    vec3 fc = col;
    float pool = 1.0 - smoothstep(0.0, 1.0, length((P.xz - uFloorC.xz) / vec2(4.2, 2.2)));
    fc = over(fc, uAccent * uBg, 0.35 * pool);
    vec4 r = vec4(0.0); float wsum = 0.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 o2 = vec2(i, j) * 2.0 / uRes; float w = exp(-0.35 * float(i * i + j * j));
      r += texture(uRefl, vUv + o2) * w; wsum += w; }
    r /= wsum;
    float rd = texture(uReflDepth, vUv).r;
    if (r.a > 0.0 && rd < 1.0) {
      float h = max(0.0, -unproj(vUv, rd).y);
      float fade = 0.22 * uReflect * pow(max(0.0, 1.0 - h / 1.0), 1.8);
      fc = mix(fc, r.rgb / max(r.a, 1e-3), r.a * fade);
    }
    vec4 cp = uContactMat * vec4(P, 1.0); vec2 cuv = cp.xy / cp.w * 0.5 + 0.5; float occ = 0.0;
    if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
        float hz = texture(uContact, cuv + vec2(i, j) * 0.004).r;
        if (hz < 1.0) occ += exp(-hz * uContactRange / 0.22);
      }
      occ /= 25.0;
    }
    fc *= 1.0 - 0.85 * uShadow * clamp(occ * 1.6, 0.0, 1.0);
    fc = over(fc, uAccent * 0.6 * uBg, 0.16 * uHaze * smoothstep(0.0, 3.0, t));
    col = mix(fc, col, smoothstep(5.0, 16.0, t));
  }
  // a glow around the near parts (the light bleeding past them), under them
  col = screen(col, uAccent * texture(uGlow, vUv).r * 0.45 * uK * uAura);
  // the scene, its far part hazed into the light
  if (sc.a > 0.0) {
    float z = lin(depth), fog = smoothstep(uFocus + 0.5, uFocus + 4.0, z) * uHaze;
    vec3 c = sc.rgb / sc.a;
    c = mix(c, uAccent, 0.12 * fog) * (1.0 - 0.2 * fog);
    col = c * sc.a + col * (1.0 - sc.a);
  }
  // sparks
  float sp = dots(q, 0.055, 0.0006, 0.0025, 0.35, 0.5, 7.0) * smoothstep(0.15, 0.3, q.y);
  col = screen(col, mix(uAccent * 1.25 + 0.12, vec3(1.0, 0.94, 0.86), step(0.7, hash(floor(q / 0.055) + 2.0))) * sp * uEmbers);
  o = vec4(col, 1.0);
}`;
// the finish: bloom, the tone, grain, the vignette, the title
const FINAL = HEAD + `uniform sampler2D uComp; uniform sampler2D uBloom; uniform sampler2D uTone; uniform sampler2D uTitle;
uniform vec2 uRes; uniform float uPunch, uGrain, uVignette, uHasTitle, uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
void main() {
  vec3 c = texture(uComp, vUv).rgb; vec3 b = texture(uBloom, vUv).rgb;
  c = 1.0 - (1.0 - c) * (1.0 - b);
  vec3 t; for (int k = 0; k < 3; k++) t[k] = texelFetch(uTone, ivec2(int(clamp(c[k], 0.0, 1.0) * 255.0 + 0.5), 0), 0).r;
  c = mix(c, t, uPunch);
  float n = (hash(vUv * uRes) + hash(vUv * uRes + 3.1) + hash(vUv * uRes + 7.7) - 1.5) * 2.0;
  c += n * (1.0 + 0.014 * c * 255.0) / 255.0 * uGrain;
  vec2 p = vUv * uRes; float v = 1.0 - 0.8 * uVignette * min(1.0, length(p - uRes * 0.5) / (uRes.x * 0.5));
  c *= v;
  if (uHasTitle > 0.5) { vec4 tt = texture(uTitle, vec2(vUv.x, 1.0 - vUv.y)); c = tt.rgb + c * (1.0 - tt.a); }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Showcase {
  constructor(R) {
    this.R = R;
    const gl = R.gl;
    this.look = { ...LOOK };
    this.accent = '#8a98a8'; this.text = '#b8c4d0'; this.k = 0.7; this.sat = 0;
    this.title = ''; this.line = '';
    this.anchor = [0, 1.3, 1.2];       // the glow's center (world): behind the squad
    this.floorC = [0, 0, 0.2];         // the pool of light's
    this.p = { blur: R.program(FS_VERT, BLUR), glowsrc: R.program(FS_VERT, GLOWSRC), bright: R.program(FS_VERT, BRIGHT),
      comp: R.program(FS_VERT, COMP), final: R.program(FS_VERT, FINAL) };
    this.vao = gl.createVertexArray();
    // the tone table
    this.toneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.toneTex);
    const t = new Uint8Array(256); for (let i = 0; i < 256; i++) t[i] = tone8(i);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, t);
    this.params(gl.TEXTURE_2D, gl.NEAREST);
    this.titleTex = gl.createTexture();
    this.titleKey = null;
    this.size = null;
  }
  params(target, filter) {
    const gl = this.R.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  // a texture target: {fbo, tex, depth?, w, h}
  target(w, h, { depth = false, msaa = 0 } = {}) {
    const gl = this.R.gl, t = { w, h, fbo: gl.createFramebuffer() };
    t.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h); this.params(gl.TEXTURE_2D, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (depth) {
      t.depth = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t.depth);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h); this.params(gl.TEXTURE_2D, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
    }
    if (msaa) {   // (drawn multisampled, then resolved into tex / depth)
      t.ms = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);
      const c = gl.createRenderbuffer(), z = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, z); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, z);
      t.rbs = [c, z];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }
  free(t) {
    if (!t) return;
    const gl = this.R.gl;
    gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); if (t.depth) gl.deleteTexture(t.depth);
    if (t.ms) { gl.deleteFramebuffer(t.ms); t.rbs.forEach(r => gl.deleteRenderbuffer(r)); }
  }
  // the targets for a frame of w x h
  ensure(w, h) {
    if (this.size?.[0] === w && this.size?.[1] === h) return;
    for (const k of ['scene', 'refl', 'comp', 'glowA', 'glowB', 'bloomA', 'bloomB', 'out']) this.free(this[k]);
    const q = 4, qw = Math.max(1, Math.round(w / q)), qh = Math.max(1, Math.round(h / q));
    const samples = Math.min(4, this.R.gl.getParameter(this.R.gl.MAX_SAMPLES));
    this.scene = this.target(w, h, { depth: true, msaa: samples });
    this.refl = this.target(Math.round(w / 2), Math.round(h / 2), { depth: true });
    this.comp = this.target(w, h);
    this.glowA = this.target(qw, qh); this.glowB = this.target(qw, qh);
    this.bloomA = this.target(qw, qh); this.bloomB = this.target(qw, qh);
    this.out = this.target(w, h);
    this.size = [w, h];
    if (!this.contact) {   // (the depth of the parts seen from under the floor: how high they are)
      const gl = this.R.gl, S = 1024, t = { w: S, h: S, fbo: gl.createFramebuffer() };
      t.depth = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t.depth);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, S, S); this.params(gl.TEXTURE_2D, gl.NEAREST);   // (depth: not filterable)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.contact = t;
    }
  }
  // a full-screen pass into target t (null: the frame's place on the canvas, rect)
  pass(prog, t, uniforms, textures, rect = null) {
    const gl = this.R.gl, u = prog.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    if (t) gl.viewport(0, 0, t.w, t.h); else gl.viewport(...rect);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], unit); unit++; }
    for (const [name, v] of Object.entries(uniforms)) {
      if (!u[name]) continue;
      if (typeof v === 'number') gl.uniform1f(u[name], v);
      else if (v.length === 2) gl.uniform2fv(u[name], v);
      else if (v.length === 3) gl.uniform3fv(u[name], v);
      else if (v.length === 16) gl.uniformMatrix4fv(u[name], false, v);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  blur(src, tmp, sigma) {
    this.pass(this.p.blur, tmp, { uDir: [1 / src.w, 0], uSigma: sigma }, { uSrc: src.tex });
    this.pass(this.p.blur, src, { uDir: [0, 1 / src.h], uSigma: sigma }, { uSrc: tmp.tex });
  }
  // the title texture (the title and the line over it, drawn at the frame's size)
  titleTexture(w, h) {
    const key = [w, h, this.title, this.line, this.accent, this.text, this.look.title].join('|');
    if (key === this.titleKey) return !!(this.title || this.line);
    this.titleKey = key;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    drawTitle(c.getContext('2d'), w, h, this.title, this.line, this.accent, this.text, this.look.title);
    const gl = this.R.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.titleTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.params(gl.TEXTURE_2D, gl.LINEAR);
    return !!(this.title || this.line);
  }
  // a frame: into the canvas (letterboxed 16:9), or at size [w, h] into this.out (an export)
  draw(R, time = 0, size = null) {
    const gl = R.gl, cv = R.canvas;
    let rect;
    if (size) rect = [0, 0, size[0], size[1]];
    else {
      const a = 16 / 9; let w = cv.width, h = Math.round(w / a);
      if (h > cv.height) { h = cv.height; w = Math.round(h * a); }
      rect = [Math.round((cv.width - w) / 2), Math.round((cv.height - h) / 2), w, h];
    }
    const [, , W, H] = rect;
    this.ensure(W, H);
    const L = this.look, keep = [R.noSky, R.shadows];
    R.postInner = true; R.noSky = true;
    try {
      // the scene, multisampled, resolved
      R.target = { fbo: this.scene.ms, w: W, h: H };
      R.draw(time);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      // the reflection: the scene upside down under the floor (half size, no shadows)
      if (L.reflect > 0) {
        R.mirror = true; R.shadows = false; R.target = { fbo: this.refl.fbo, w: this.refl.w, h: this.refl.h };
        R.draw(time);
        R.mirror = false; R.shadows = keep[1];
      } else { gl.bindFramebuffer(gl.FRAMEBUFFER, this.refl.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    } finally { R.target = null; R.postInner = false; R.mirror = false; [R.noSky, R.shadows] = keep; }
    // the contact shadows: the parts' heights seen from under the floor
    const { eye, inv } = R.matrices(W / H), c = R.cam;
    const ext = 6, cm = M4.mul(M4.ortho(ext, 0.5, 0.5 + 2.5), M4.lookAt([c.target[0], -0.5, c.target[2]], [c.target[0], 1, c.target[2]], [0, 0, 1]));
    R.shadowPass(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.contact.fbo); gl.viewport(0, 0, this.contact.w, this.contact.h);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    R.shadowDraw(cm);
    const near = Math.max(0.02, c.dist * 0.001), far = Math.max(100, c.dist * 4);
    const focus = Math.hypot(...eye.map((v, k) => v - c.target[k])) + 1.2;
    // the glow's source, blurred (28 px at 2560 wide)
    const s = W / 2560;
    this.pass(this.p.glowsrc, this.glowA, { uNF: [near, far], uFocus: focus }, { uScene: this.scene.tex, uDepth: this.scene.depth });
    this.blur(this.glowA, this.glowB, 28 * s / 4);
    // the glow's center: the anchor on the frame (frame heights from the top-left)
    const vp = M4.mul(M4.persp(c.fov ?? 0.6, W / H, near, far), M4.lookAt(eye, c.target, [0, 1, 0]));
    const a = this.anchor, cl = [0, 1, 2, 3].map(r => vp[r] * a[0] + vp[4 + r] * a[1] + vp[8 + r] * a[2] + vp[12 + r]);
    const disc = [(cl[0] / cl[3] * 0.5 + 0.5) * W / H, (cl[1] / cl[3] * 0.5 + 0.5)];
    const accent = hex01(L.color || this.accent), seed = 0.123;
    this.pass(this.p.comp, this.comp, {
      uInv: inv, uEye: eye, uNF: [near, far], uFocus: focus, uRes: [W, H], uAccent: accent, uK: this.k, uDisc: disc,
      uFloorC: this.floorC, uContactMat: cm, uContactRange: 2.5,
      uBg: L.bg, uGlowAmt: L.glow, uGlowSize: L.glowSize, uReflect: L.reflect, uShadow: L.shadow, uHaze: L.haze, uAura: L.aura,
      uEmbers: L.embers, uSeed: seed,
    }, { uScene: this.scene.tex, uDepth: this.scene.depth, uRefl: this.refl.tex, uReflDepth: this.refl.depth, uContact: this.contact.depth, uGlow: this.glowA.tex });
    // bloom (22 px at 2560 wide)
    this.pass(this.p.bright, this.bloomA, { uAmt: L.bloom }, { uSrc: this.comp.tex });
    this.blur(this.bloomA, this.bloomB, 22 * s / 4);
    const hasTitle = this.titleTexture(W, H) ? 1 : 0;
    if (!size) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.05, 0.055, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    this.pass(this.p.final, size ? this.out : null, { uRes: [W, H], uPunch: L.punch, uGrain: L.grain, uVignette: L.vignette, uHasTitle: hasTitle, uSeed: 0.71 },
      { uComp: this.comp.tex, uBloom: this.bloomA.tex, uTone: this.toneTex, uTitle: this.titleTex }, size ? null : rect);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return null;
  }
  // the frame at w x h -> a 2D canvas
  exportCanvas(w, h) {
    const R = this.R, gl = R.gl;
    this.draw(R, 0, [w, h]);
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), row = w * 4;
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);   // (GL rows: bottom up)
    ctx.putImageData(img, 0, 0);
    this.size = null; for (const k of ['scene', 'refl', 'comp', 'glowA', 'glowB', 'bloomA', 'bloomB', 'out']) { this.free(this[k]); this[k] = null; }
    this.titleKey = null;
    return c;
  }
  dispose() {
    const gl = this.R.gl;
    for (const k of ['scene', 'refl', 'comp', 'glowA', 'glowB', 'bloomA', 'bloomB', 'out']) this.free(this[k]);
    if (this.contact) { gl.deleteFramebuffer(this.contact.fbo); gl.deleteTexture(this.contact.depth); }
    gl.deleteTexture(this.toneTex); gl.deleteTexture(this.titleTex); gl.deleteVertexArray(this.vao);
    for (const p of Object.values(this.p)) gl.deleteProgram(p.p);
  }
}

const hex01 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// the title (the theme's name, glowing) and the small line over it, at the bottom of a w x h frame; size: a scale
export function drawTitle(ctx, w, h, title, line, accent, text, size = 1) {
  if (!title && !line) return;
  const s = w / 2560 * size, font = px => `bold ${px}px "Agency FB", "Bahnschrift Condensed", "Bahnschrift", "Arial Narrow", sans-serif`;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const y = h - h * 0.035 - 6 * s;
  if (title) {
    ctx.font = font(Math.round(110 * s)); ctx.letterSpacing = `${Math.round(22 * s)}px`;
    ctx.shadowColor = accent; ctx.shadowBlur = 28 * s; ctx.fillStyle = '#f4f1ea';
    ctx.fillText(title.toUpperCase(), w / 2, y); ctx.fillText(title.toUpperCase(), w / 2, y);
  }
  if (line) {
    ctx.shadowBlur = 0; ctx.font = font(Math.round(28 * s)); ctx.letterSpacing = `${Math.round(10 * s)}px`; ctx.fillStyle = text;
    ctx.fillText(line.toUpperCase(), w / 2, title ? y - 122 * s : y);
  }
  ctx.restore();
}
