// GLSL port of the HD2 armor G-buffer pixel shader, lit in the same pass by a port of the game's deferred lighting.
// SAME MATH AS THE GAME: zone selection, mask recipes, detail / camo / pattern / clearcoat inputs, color, roughness,
// specular, metalness, glow, iridescence (quantized), cloth fuzz / rim, normals (surface gradients in screen-derivative
// UV0 / UV1 frames), the world effects (dirt, mud / snow, blood, bug gunk, frost, burn glow, scorch, wetness) and the
// subsurface they add; the sun + environment lighting of those G-buffer values (LIGHTING).
// LUT STUDIO'S OWN: the light setup (presets, key light, side lights, exposure), the shadow map (sunShadow), the tone
// curve (an ACES fit: the game's output transform is ACES with a tone curve made at run time); not reproduced: SSAO,
// screen-space reflections, fog, clouds, bloom, clustered local lights; c_snow colors (placeholders).
// CAPES (#define CAPE, CAPE_FRAG): the cape shader ps_5_0_71c9bd01a687:
// zones from the design texture (cape_scalar_fields) with its cut-out, two-sided cloth, trim lines, gradient, up to
// four decals from the decal sheet, cape-specific world-effect inputs, the tear edge; no pattern, no glow.
// VEHICLES (uVehicle = 1): the vehicle shader ps_5_0_9451e8f73930 of base 0x43865ef50d88395e: the armor math
// without clearcoat, glow / burn glow and composite detail, plus the decal sheet's relief and the vehicle damage.

export const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=3) in vec2 aUv0;
layout(location=4) in vec2 aUv1;
layout(location=6) in vec2 aUv2;   // capes: decal space (TEXCOORD_2)
layout(location=7) in vec4 aJoints; // skinning: joint indices, weights (poses / animations)
layout(location=8) in vec4 aWeights;
uniform mat4 uViewProj;
uniform int uSkinned;
uniform highp sampler2D uJointTex; // 4 texels (columns) per joint matrix, row 0
uniform vec3 uShift;
uniform mat3 uRot; uniform int uRotOn;   // a piece's turn (scenes of several items: with uShift, its place)
uniform int uMirror;   // drawn upside down under the floor (y = 0): the showcase's floor reflection
out vec3 vPos; out vec3 vNrm; out vec2 vUv0; out vec2 vUv1; out vec2 vUv2;
mat4 jointMat(float j) {
  int x = int(j + 0.5) * 4;
  return mat4(texelFetch(uJointTex, ivec2(x, 0), 0), texelFetch(uJointTex, ivec2(x + 1, 0), 0),
              texelFetch(uJointTex, ivec2(x + 2, 0), 0), texelFetch(uJointTex, ivec2(x + 3, 0), 0));
}
void main() {
  vec3 p = aPos, n = aNrm;
  if (uSkinned == 1) {
    mat4 S = aWeights.x * jointMat(aJoints.x) + aWeights.y * jointMat(aJoints.y)
           + aWeights.z * jointMat(aJoints.z) + aWeights.w * jointMat(aJoints.w);
    p = (S * vec4(aPos, 1.0)).xyz;
    n = mat3(S) * aNrm;
  }
  if (uRotOn == 1) { p = uRot * p; n = uRot * n; }
  p += uShift;
  if (uMirror == 1) { p.y = -p.y; n.y = -n.y; }
  vPos = p; vNrm = n; vUv0 = aUv0; vUv1 = aUv1; vUv2 = aUv2;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

// The game's deferred lighting for the G-buffer this shader writes: the sun + environment pass of the lighting
// library (shader 0xa49cc6981c77352d, ps_5_0_b372570da1f7; lit:N = its line N), lighting class 0 (every armor,
// cape and vehicle pixel). SAME MATH AS THE GAME (checked against the compiled shader): the G-buffer decode, metal
// under a clearcoat, wetness, multi-bounce occlusion, specular antialiasing, Disney diffuse, GGX with the sun as a
// disk (representative point, energy normalization), cloth sheen, clearcoat, iridescence, subsurface, the diffuse /
// specular cubes with their dominant directions and the specular BRDF table. Not reproduced: SSAO, screen-space
// reflections, clouds, fog, clustered local lights; shadows are LUT Studio's own (shadowFactor in FRAG).
// Shared with the accuracy check page, which feeds it decoded G-buffer texels.
export const LIGHTING = `
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 sat(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 sat(vec3 x) { return clamp(x, 0.0, 1.0); }
float ss(float x) { return x * x * (3.0 - 2.0 * x); }
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon; uniform vec3 uGround;
// the game's baked lighting (an environment's reflection cube): uEnvCube 1; its irradiance cube: uEnvDiffCube 1
uniform int uEnvCube; uniform samplerCube uEnvSpec; uniform float uEnvMips; uniform float uEnvScale;
uniform int uEnvDiffCube; uniform float uEnvRot; uniform vec3 uSH[9];
// the lighting's tables in one RGBA16F array of 256 x 256 layers (render.js, to stay within 16 samplers):
// 0 ibl_specular_brdf_lut (split-sum: x N.V, y roughness^2), 1 ibl_brdf_lut (thin-film rainbow: x thickness, y N.V;
// 64 x 64 at texel 1, edges repeated), 2-7 the irradiance cube's faces (16 x 16 at texel 1, bordered by the
// neighbor faces' texels, corners the mean of three: the GPU's seamless cube filtering)
uniform highp sampler2DArray uLuts;
vec2 specBrdf(float nv, float r2) { return texture(uLuts, vec3(nv, r2, 0.0)).xy; }
vec3 film(float t, float nv) { return texture(uLuts, vec3((1.0 + 64.0 * vec2(t, nv)) / 256.0, 1.0)).rgb; }
vec3 irradiance(vec3 d) {          // d in the cube's space; face and coordinates as D3D / GL pick them
  vec3 a = abs(d);
  float f, sc, tc, ma;
  if (a.x >= a.y && a.x >= a.z) { f = d.x > 0.0 ? 0.0 : 1.0; sc = d.x > 0.0 ? -d.z : d.z; tc = -d.y; ma = a.x; }
  else if (a.y >= a.z) { f = d.y > 0.0 ? 2.0 : 3.0; sc = d.x; tc = d.y > 0.0 ? d.z : -d.z; ma = a.y; }
  else { f = d.z > 0.0 ? 4.0 : 5.0; sc = d.z > 0.0 ? d.x : -d.x; tc = -d.y; ma = a.z; }
  vec2 st = (vec2(sc, tc) / ma + 1.0) * 0.5;
  return texture(uLuts, vec3((1.0 + 16.0 * st) / 256.0, 2.0 + f)).rgb;
}
vec3 cubeDir(vec3 v) {             // viewer space (Y up) -> the game's (Z up), turned by uEnvRot about up
  float c = cos(uEnvRot), s = sin(uEnvRot);
  v = vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  return vec3(v.x, -v.z, v.y);
}
vec3 shEval(vec3 n) {              // irradiance / pi from 9 SH coefficients (viewer space, turned like cubeDir)
  float c = cos(uEnvRot), s = sin(uEnvRot);
  n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vec3 r = uSH[0] * 0.282095 + uSH[1] * 0.488603 * n.y + uSH[2] * 0.488603 * n.z + uSH[3] * 0.488603 * n.x
    + uSH[4] * 1.092548 * n.x * n.y + uSH[5] * 1.092548 * n.y * n.z + uSH[6] * 0.315392 * (3.0 * n.z * n.z - 1.0)
    + uSH[7] * 1.092548 * n.x * n.z + uSH[8] * 0.546274 * (n.x * n.x - n.y * n.y);
  return max(r, vec3(0.0)) * uEnvScale;
}
vec3 sky(vec3 d) {
  float h = d.y;
  vec3 s = mix(uSkyHorizon, uSkyZenith, pow(sat(h), 0.6));
  return h >= 0.0 ? s : mix(uSkyHorizon, uGround, sat(-h * 4.0));
}
// global_specular_map: mip = roughness * (mips - 1) (lit:1071-1075); the presets: rough reflections fade to the
// hemisphere average
vec3 envSpec(vec3 r, float rough) {
  if (uEnvCube == 1) return textureLod(uEnvSpec, cubeDir(r), sat(rough) * (uEnvMips - 1.0)).rgb * uEnvScale;
  vec3 avg = mix(uGround, mix(uSkyHorizon, uSkyZenith, 0.5), sat(r.y * 0.5 + 0.5));
  return mix(sky(r), avg, sat(rough * 1.4));
}
// global_diffuse_map (the bake's irradiance cube; without one, SH of the specular cube)
vec3 envDiffuse(vec3 n) {
  if (uEnvDiffCube == 1) return irradiance(cubeDir(n)) * uEnvScale;
  if (uEnvCube == 1) return shEval(n);
  return mix(uGround, mix(uSkyHorizon, uSkyZenith, 0.6), sat(n.y * 0.5 + 0.5));
}

// one G-buffer pixel pair as the lighting decodes it (lit:484-531): both checkerboard parities, which the game
// rebuilds from the 4 neighbors (exact on flat regions)
struct Surf {
  vec3 albedo;          // gbuffer0.rgb^2 (even pixels)
  vec3 ssCol;           // subsurface color: gbuffer0.rgb^2 of the odd pixels (sss > 0)
  vec3 N, Ncc;          // normal; clearcoat normal (the odd pixels' gbuffer1 when cc > 0, else N)
  float rough, ccRough; // gbuffer3.x even / odd (clearcoat: both >= 0.045)
  float spec, wet;      // gbuffer3.y even / odd
  float cc, fuzz;       // gbuffer2.x: sat(2x - 1.003922), sat(1 - 2x)
  float metal, sss;     // gbuffer2.y: sat(2y - 1), sat(0.996078 - 2y)
  float so;             // specular occlusion: sqrt((gbuffer3.z byte & 63) / 63)
  float diffusion;      // subsurface diffusion: max(((gbuffer3.w byte >> 2) / 63)^1.5, 0.5)
  float iriAmount, iriThick;   // gbuffer0.a byte: (b & 31) / 31, ((b >> 5) / 7)^2
};
// per pixel, set by gamePrep
vec3 gD, gF0, gF0m, gMb, gRefl;
float gFz, gR, gRc, gNoV, gNoVa, gE5, gSs;
// multi-bounce occlusion (lit:809-819)
vec3 multiBounce(float x, vec3 a) {
  return sat(x * ((x * (2.0404 * a - 0.3324) + (0.6417 - 4.7951 * a)) * x + (2.7552 * a + 0.6903)));
}
void gamePrep(Surf s, vec3 V) {
  vec3 a = s.albedo;
  float f0 = 0.08 * s.spec;
  if (s.cc > 0.0) {                                    // metal under a clearcoat (lit:576-608)
    float nv = max(dot(s.Ncc, V), 1e-4);
    float p = (0.5 * nv + 0.5) * nv - 1.0, q = sat(1.25 - 1.25 * s.rough);
    vec3 A = a * 1.111111;
    vec3 C = A * (1.0 + 0.85 * (nv - 1.0) * (1.0 - (A - 0.78 * (A * A - A)))) * (p * q + 1.0);
    float x5 = pow5(1.0 - nv), Fc = x5 + 0.04 * (1.0 - x5);
    a = mix(a * (1.0 - s.cc * Fc), 0.9 * C, s.cc * s.metal);
    f0 *= 1.0 + s.cc * p * q;
  }
  vec3 F0 = mix(vec3(f0), a, s.metal);                 // lit:616-619
  vec3 d = sat(a * (1.0 - s.metal));
  float r = s.rough, rc = s.ccRough, fz = s.fuzz;
  if (s.wet > 0.0) {                                   // wet: darker rough non-metal, glossier, no sheen (lit:782-807)
    float k = 0.25 * (1.0 - s.cc) * r * (1.0 - s.metal) * min(s.wet * 2.857143, 1.0);
    d += k * (d * d - d);
    float g = sat(1.25 * (s.wet - 0.2));
    fz -= g * fz;
    float r0 = r;
    r += (1.0 - s.cc) * r0 * g * (0.05 + 0.5 * r0 * r0 - r0);
    rc += rc * g * (0.05 + 0.5 * rc * rc - rc);
  }
  // occlusion: the G-buffer's specular occlusion (no SSAO here, so min / product with it = itself; lit:806-822)
  gMb = multiBounce(s.so, d);
  gSs = ss(s.so);
  gF0m = max(F0, vec3(0.01));
  vec3 nx = dFdx(s.N), ny = dFdy(s.N);                 // specular antialiasing (lit:825-835)
  float rr = min(1.0, r * r + min(0.04, 0.15 * (dot(nx, nx) + dot(ny, ny))));
  gR = rr > 0.0 ? sqrt(rr) : 0.0;
  gNoV = dot(s.N, V);
  gNoVa = min(abs(gNoV) * 0.99999 + 1e-5, 1.0);
  gRefl = 2.0 * gNoV * s.N - V;
  gE5 = pow5(1.0 - gNoVa);
  gD = d; gFz = fz; gRc = rc;
  // F0 for the environment and the lights: cloth takes its color (lit:874-876); iridescence (lit:1046-1059)
  vec3 F = mix(gF0m, sqrt(d), fz);
  if (s.iriAmount > 0.0) {
    F = mix(gF0m, gF0m * film(s.iriThick, gNoVa) / (F * (1.0 - gE5) + gE5) * sat(1.0 - dot(d, vec3(0.3, 0.59, 0.11))),
            s.iriAmount);
  }
  gF0 = F;
}
// the environment: diffuse cube in the diffuse dominant direction with Disney diffuse (L = -N), specular cube in
// the specular dominant direction with the BRDF table, cloth table, clearcoat layer; subsurface from behind
void gameEnv(Surf s, vec3 V, inout vec3 dif, inout vec3 spe, inout vec3 sub) {
  vec3 H = normalize(V - s.N);                         // lit:878-905
  float LoH = min(abs(dot(H, V)), 1.0), fd = 1.0 + (2.0 * LoH * LoH * gR - 0.5) * gE5;
  float w = max(((1.02341 * gR - 1.51174) * gNoVa + 0.755868 - 0.511705 * gR) * gR, 0.0);   // lit:908-914
  dif += (uUiAmbient > 0.0 ? envSpec(mix(s.N, V, w), 1.0) * uUiAmbient : envDiffuse(mix(s.N, V, w))) * gMb * gD * fd;
  float lf = 0.206887 * log2(39.4115 - 39.0029 * gR);  // lit:1060-1075
  vec3 dir = mix(s.N, gRefl, sat(pow(1.0 - gNoVa, 10.8649) * (1.0 - lf) + lf));
  vec3 rad = envSpec(dir, mix(gR, 1.0, gFz));
  vec2 ab = specBrdf(gNoVa, gR * gR);                  // lit:1109-1112
  vec3 Fs = gF0 * (ab.y - ab.x) + ab.x;
  if (gFz > 0.0) {                                     // cloth (lit:1113-1127)
    float u = 0.9 * gNoVa + 0.1, x = 1.0 - gNoVa, v = min(x * (1.09 * x + 0.92), 1.0);
    u *= u;
    u = ss(u) * 0.29 + 0.079; v = ss(v) * 0.62 + 0.14;
    Fs = mix(Fs, gF0 * mix(u, v, gR), gFz);
  }
  vec3 e = rad * Fs * gSs;
  if (s.cc > 0.0) {                                    // the base normal's reflection, clearcoat roughness (lit:1129-1140)
    float Fc = s.cc * (0.04 * (1.0 - gE5) + gE5);
    e = e * (1.0 - Fc) + Fc * envSpec(gRefl, gRc);
  }
  spe += e * uSpecScale;
  sub += (uUiAmbient > 0.0 ? envSpec(-s.N, 1.0) * uUiAmbient : envDiffuse(-s.N)) * pow(s.ssCol, 2.0 - gMb) * s.sss;   // lit:1275-1300
}
// a directional light: toL toward it, size the disk's radius at distance 1000 (lightsource_angular_size); shadow
// 0..1 and trans, the subsurface's (the game's shadow filter returns both; lit:1328-1340, 1611-1756, 2021-2054)
void gameLight(Surf s, vec3 V, vec3 toL, vec3 col, float size, float shadow, float trans,
               inout vec3 dif, inout vec3 spe, inout vec3 sub) {
  vec3 L0 = 1000.0 * toL, cp = gRefl * dot(L0, gRefl) - L0;   // the disk's point closest to the reflection
  float cd = length(cp), f = cd > 0.0 ? sat(size / cd) : (size > 0.0 ? 1.0 : 0.0);
  vec3 Lu = L0 + cp * f;
  float l2 = dot(Lu, Lu);
  vec3 L = l2 > 0.0 ? Lu * inversesqrt(l2) : vec3(0.0, -1.0, 0.0);
  float NoL = dot(s.N, L), NoLs = sat(NoL);
  float lit = NoLs * shadow, sh = s.sss * trans;
  if (lit <= 0.0 && sh <= 0.0) return;
  float VoL = dot(V, L), iH = inversesqrt(2.0 + 2.0 * VoL), NoH = (gNoV + NoL) * iH;
  if (lit > 0.0) {
    float a = gR * gR, a2 = a * a, sinA = sat((l2 > 0.0 ? inversesqrt(l2) : 1.0) * size * (1.0 - a));
    vec3 micro = sat(2.0 * gMb * gMb + abs(NoL) - 1.0);          // micro-shadowing (lit:1633-1635)
    float sp = sat(NoL / sqrt(1.0001 - gSs)); sp *= sp;          // lit:1636-1640
    float NoHs = sat(NoH), VoH = sat(iH * VoL + iH);
    float E = sinA > 0.0 ? a2 / max(a2 + 0.25 * sinA * (3.0 * a + sinA) / (VoH + 0.001), 0.0) : 1.0;   // energy
    float dn = (NoHs * a2 - NoHs) * NoHs + 1.0, k = 0.5 * a;
    float DV = a2 / max(3.141593 * dn * dn, 0.0) * 0.25 / ((NoLs * (1.0 - k) + k) * (gNoVa * (1.0 - k) + k));
    if (gFz > 0.0) {                                   // cloth: Charlie sheen, Neubelt visibility (lit:1667-1683)
      float Dc = (2.0 + 1.0 / gR) * pow(1.0 - NoHs * NoHs, 0.5 / gR) * 0.159155;
      DV = mix(DV, Dc / (4.0 * (gNoVa + NoLs - NoLs * gNoVa)), gFz);
    }
    float x5 = pow5(1.0 - VoH);
    if (s.cc > 0.0) {                                  // clearcoat lobe (lit:1684-1721)
      float Fc = s.cc * (0.04 * (1.0 - x5) + x5), NoVc = dot(s.Ncc, V);
      float NoHc = sat(iH * (dot(L, s.Ncc) + NoVc)), ac = gRc * gRc, kc = 0.5 * ac, ac2 = ac * ac;
      float dc = (NoHc * ac2 - NoHc) * NoHc + 1.0;
      float Vc = 0.25 / ((NoLs * (1.0 - kc) + kc) * (min(abs(NoVc) * 0.99999 + 1e-5, 1.0) * (1.0 - kc) + kc));
      spe += Vc * min(ac2 / max(3.141593 * dc * dc, 0.0), 1e10) * Fc * 0.31831 * sp * E * lit * col;
      DV *= 1.0 - Fc * 0.31831;
    }
    spe += E * DV * sp * lit * col * (gF0 * (1.0 - x5) + x5);
    float fd = 2.0 * VoH * VoH * gR - 0.5;             // Disney diffuse (lit:1741-1755)
    dif += gD * (1.0 + fd * gE5) * (1.0 + fd * pow5(1.0 - NoLs)) * 0.31831 * col * lit * micro;
  }
  if (sh > 0.0) {                                      // subsurface: transmission + wrap (lit:2022-2052)
    float b = VoL < 0.0 ? pow(sat(-VoL), 1.0 + 0.5 * gNoV) : 0.0, dd = s.diffusion, d4 = dd * dd * dd * dd;
    float dn = (b * d4 - b) * b + 1.0;
    float wrap = pow(sat(NoH * dd + 0.56419 * (1.01 - dd)), 2.0 * (2.0 - dd));
    sub += (gSs * wrap + dd / max(3.141593 * dn * dn, 0.0)) * pow(s.ssCol, 2.0 - gMb * sh) * sh * s.sss * col;
  }
}
`;

export const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2DShadow;
in vec3 vPos; in vec3 vNrm; in vec2 vUv0; in vec2 vUv1; in vec2 vUv2;
out vec4 outColor;
#ifdef CAPE
uniform sampler2D uCapeLut;        // cape LUT, RGBA32F, 16 x zones
uniform int uCapeRows;
uniform sampler2DArray uScalar;    // cape_scalar_fields: RGB zone masks, A silhouette
uniform sampler2DArray uTear;      // cape_tear .r
uniform sampler2DArray uGradient;  // cape_gradient .r: ~1 at the collar, 0 at the hem
uniform float uTearAmount, uHeightMult, uHeightBase;
#else
uniform int uHasDecal;             // armor base 0xf5eb (hellpod, vehicles, 148 armors): the decal sheet over UV2
uniform vec2 uDecalSize;           // decal_size_x / _y (texels)
uniform vec4 uDecalPal;            // use_decal_rgb_channels, decal_channel_selection, decal_lut_id, -
uniform vec2 uDecalLutSize;        // decal_lut_size_x / _y
uniform vec4 uDecalRelief;         // vehicles: decal_scalarfield_end.xy, decal_normal_offset, decal_normal_intentity
uniform vec3 uDecalAlpha;          // vehicles: decal_alpha_offset, decal_alpha_sharpness, underlying_normal_behind_decal_opacity
uniform vec2 uDecalOff;            // decal_id_offset_x / _y (texels per decal number)
uniform float uDecalId;            // the per-instance decal number (idata +0.x)
uniform float uDamage;             // vehicles: the per-instance vehicle_damage (idata +11.x; the game: 1 - health / max)
uniform int uDamageMask;           // vehicles: damage_mask_selector, one bit per zone
uniform float uDamageTile;         // vehicles: vehicle_damage_data_tile
uniform sampler2DArray uDamageTex; // vehicles: vehicle_damage_data (.rg normal, .b amount, .a edge amount)
#endif
uniform sampler2DArray uDecalSheet;// emblem atlas (clamped): capes' decals; armor base 0xf5eb's decal sheet

uniform sampler2D uLut;            // material LUT, RGBA32F, 23 x zones, texelFetch only
uniform int uLutRows;
uniform sampler2D uPatLut;         // pattern LUT 3 x 1
uniform int uHasPatLut;
uniform sampler2DArray uIdMasks;   uniform int uIdLayers;
uniform sampler2DArray uBaseData;
uniform sampler2DArray uPatMasks;  uniform int uPatLayers;
uniform sampler2DArray uDetail;    // customization_detail_tiler_array, 26 layers
uniform sampler2DArray uCamo;      // customization_camo_tiler_array, 5 layers
uniform sampler2DArray uComposite; // 2 layers
uniform sampler2DArray uWDirt;     // weathering_dirt     .rg normal .b frost tint .a dirt pattern / burn phase
uniform sampler2DArray uWSpecial;  // weathering_special  .rg normal .g snow pattern .b frost bias .a special pattern
uniform sampler2DArray uWSplat;    // blood_splatter_tiler (layer 0: .rg normal .b color mask .a stain mask) and
uniform float uBugLayer;           // bug_splatter_tiler (same layout; layer uBugLayer, 0 when it is the same texture)
uniform float uDetailMult;         // detail_tile_factor_mult
uniform vec2 uRnd;                 // per-instance random detail offset

// world effects
uniform vec3 uWpos[4]; uniform vec3 uWneg[4];      // weights +axis / -axis: 0 blood, 1 gunk, 2 dirt, 3 special
uniform int uCase;                                // weathering_special_case: 0 none, 1 mud, 2 snow
uniform float uFrost;
uniform vec3 uBsw;                                // burn glow, scorch / snow melt, global wetness
uniform vec4 uHww;                                // wet line, wet amount, wash line, wash amount
uniform float uMatWet;                            // material_wetness
uniform float uTile, uBloodScale, uGunkScale, uGunkMin, uBloodNFade, uGunkNFade, uBGNInt;
uniform vec3 uBloodColor, uGunkColor;
uniform vec3 uSnowBase, uSnowFuzz; uniform float uSnowSpec;

uniform vec3 uSnowSss; uniform vec3 uSnowSssP;    // snow_subsurface_color; _intensity, _wrap, _diffusion

uniform vec3 uCamPos;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize;   // uSunSize: lightsource_angular_size
uniform vec3 uRimDir[2]; uniform vec3 uRimColor[2];   // the side lights (cool left, warm right, as in the armory); color 0 = off
// local lights of a game light rig (a level's spots / omni lights): position, spot axis, color x intensity
// (0 = off), (falloff start, falloff end, cos of the cone's half angle (-1: omni), 0)
uniform vec3 uLPos[6]; uniform vec3 uLDir[6]; uniform vec3 uLColor[6]; uniform vec4 uLRange[6];
// the Armory menu's 3D UI pass: 4 directional lights (toward the light; color 0 = off),
// ambient from the specular cube's last mip x uUiAmbient (0: the usual diffuse cube), reflections x uSpecScale, and
// the tone curve x(ax+b) / (x(cx+d)+e) of uTone (a-d) and uToneE (default: the ACES fit)
uniform vec3 uDLDir[4]; uniform vec3 uDLColor[4]; uniform float uUiAmbient; uniform float uSpecScale;
uniform vec4 uTone; uniform float uToneE;
uniform int uRawOut;   // 1: the tone curve's output is the sRGB value (the 3D UI pass writes it as is; no encode)
uniform float uExposure; uniform float uEmissiveScale;
// a planet's look (planet lighting, uGradeOn): the exposed scene color written shaped, log2(x / 0.18) + 12 over 18.5,
// for a pass after (GRADE_FRAG; the showcase's composite) to grade with the planet's 3D LUT (no sampler here: this
// shader has the 16 a GPU must give)
uniform int uGradeOn;
vec3 shaped(vec3 c) { return clamp((log2(max(c, vec3(1e-6)) / 0.18) + 12.0) / 18.5, 0.0, 1.0); }
${LIGHTING}
// sun shadows: LUT Studio's own shadow map (orthographic along the sun over the scene, render.js), not the game's
// cascades: 3x3 bilinear PCF (the game's footprint: 4 gathers at +-1 texel / 9, lit:1360-1438) with a normal offset.
// y: the subsurface's transmission term, 1 (the game's value outside its cascades; its in-cascade thickness test is
// not reproduced)
// Several lights (the Armory menu's 4, every one casting a shadow as in the game): one map each, tiles of one texture
// (uShadowTile: offset xy, scale); uShadowOn: how many (0: none; map 0: the sun's)
uniform int uShadowOn; uniform mat4 uShadowMat[4]; uniform vec3 uShadowTile[4]; uniform float uShadowTexel[4];
uniform int uShadowSoft;   // 1: the Armory menu's wider filter (9 bilinear taps 2 texels apart, tent weights: ~7 x 7)
uniform highp sampler2DShadow uShadowMap;
float shadowAt(int i, vec3 p, vec3 n, vec3 L) {
  if (i >= uShadowOn) return 1.0;
  float nl = dot(n, L);
  vec4 q = uShadowMat[i] * vec4(p + n * uShadowTexel[i] * (1.5 - abs(nl)), 1.0);
  vec3 c = q.xyz * 0.5 + 0.5;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadowMap, 0));
  vec3 tl = uShadowTile[i];
  vec2 lo = tl.xy + ts, hi = tl.xy + tl.z - ts;   // (taps stay inside the tile)
  float z = c.z - 0.001, s = 0.0, wsum = 0.0, spread = uShadowSoft == 1 ? 2.0 : 1.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      float w = uShadowSoft == 1 ? float((2 - abs(x)) * (2 - abs(y))) : 1.0;
      s += w * texture(uShadowMap, vec3(clamp(tl.xy + c.xy * tl.z + vec2(x, y) * ts * spread, lo, hi), z));
      wsum += w;
    }
  return s / wsum;
}
vec2 sunShadow(vec3 p, vec3 n) { return vec2(shadowAt(0, p, n, normalize(uSunDir)), 1.0); }
uniform int uFlashlight;
uniform int uVehicle;              // 1: the vehicle / weapon shader family (no clearcoat)
uniform int uDebug;                // 0 final, see DEBUG_VIEWS in render.js
uniform int uPick;                 // 1: write zone / piece ids for picking; 2: write UV0
uniform float uPieceId;
uniform int uHighlightZone;        // -1 none
uniform float uTime;
uniform int uObjTest;                // accuracy check: object normal = vNrm, height = 0 (the harness defaults)

int zone;
#ifdef CAPE
// capes: rows past the end of a LUT read zero
vec4 L(int c) { return zone < uLutRows ? texelFetch(uLut, ivec2(c, zone), 0) : vec4(0.0); }
vec4 C(int c) { return zone < uCapeRows ? texelFetch(uCapeLut, ivec2(c, zone), 0) : vec4(0.0); }
#else
vec4 L(int c) { return texelFetch(uLut, ivec2(c, zone), 0); }
#endif

// mask recipe: k sharpens the detail weights on edges (col.b > 0) or hollows (col.b < 0)
float recipe4(vec4 col, vec4 src, float bias, float cav) {
  float k = 4.0 * max(0.0, cav * col.b);
  return sat(bias + dot(vec4(col.r * (1.0 + k), col.g * (1.0 + k), col.b, col.a), src));
}
float recipe3(vec4 col, vec3 src, float bias, float cav) {
  float k = 4.0 * max(0.0, cav * col.b);
  return sat(bias + dot(vec3(col.r * (1.0 + k), col.g * (1.0 + k), col.b), src));
}
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// normals: texture convention n2 and surface gradient
vec2 n2(vec4 t) { return vec2(1.0 - 2.0 * t.r, 2.0 * t.g - 1.0); }
vec3 grad(vec2 n, vec3 T, vec3 B) {
  float z2 = 1.0 - n.x * n.x - n.y * n.y;
  vec2 s = -n * inversesqrt(max(z2, 6.1e-5 * max(n.x * n.x, n.y * n.y)));
  return T * s.x + B * s.y;
}
// The game's frame (ps:222-272): T = normalized s * (dpx_t * dv/dy - dpy_t * dv/dx) with dp*_t the screen derivatives
// projected onto the surface and s the sign of the UV determinant; B = sigma * s * cross(N, T), sigma the screen
// orientation. -dFdy: D3D pixel rows grow downward (the result is the same either way, kept for clarity).
void uvFrame(vec2 uv, vec3 p, vec3 n, out vec3 T, out vec3 B) {
  vec3 dpx = dFdx(p), dpy = -dFdy(p);
  vec2 dux = dFdx(uv), duy = -dFdy(uv);
  vec3 tx = dpx - n * dot(dpx, n), ty = dpy - n * dot(dpy, n);
  float sigma = dot(dpy, cross(n, dpx)) < 0.0 ? -1.0 : 1.0;
  float det = dux.x * duy.y - dux.y * duy.x;
  float s = det < 0.0 ? -1.0 : 1.0;
  T = s * (tx * duy.y - ty * dux.y);
  if (abs(det) > 0.0) T = normalize(T);
  B = sigma * s * cross(n, T);
}

vec3 zoneColor(int z) {
  vec3 p[8] = vec3[8](vec3(.9,.3,.3), vec3(.3,.8,.3), vec3(.3,.5,.95), vec3(.95,.85,.25),
                      vec3(.85,.35,.9), vec3(.3,.9,.9), vec3(.95,.6,.25), vec3(.75,.75,.75));
  return p[z & 7];
}

void main() {
#ifdef CAPE
  // ---- cape 4.1 / 4.2: cut-out, faces, zone and ramp t from the design texture
  vec4 Sf = texture(uScalar, vec3(vUv0, 0.0));
  float tearV = texture(uTear, vec3(vUv0, 0.0)).r;
  if (min(0.51 * (1.0 + uTearAmount * (tearV - 1.0)), Sf.a) < 0.5) discard;
  bool front = gl_FrontFacing;
  zone = front ? 0 : 4;
  float tR = 0.0;
  for (int ch = 0; ch < 3; ch++) {
    if (!front && ch > 0) break;
    if (Sf[ch] >= 0.496) { zone = ch + 1; tR = sat((Sf[ch] - 0.496) * 1.984127); break; }
  }
#else
  // ---- 4.1 zone (row) selection: later mask layers override, first channel >= 0.496 within a layer
  zone = 0;
  for (int layer = 0; layer < 4; layer++) {
    if (layer >= uIdLayers) break;
    vec4 m = texture(uIdMasks, vec3(vUv0, float(layer)));
    if (m.r >= 0.496) zone = layer * 4;
    else if (m.g >= 0.496) zone = layer * 4 + 1;
    else if (m.b >= 0.496) zone = layer * 4 + 2;
    else if (m.a >= 0.496) zone = layer * 4 + 3;
  }
  zone = min(zone, uLutRows - 1);
#endif
  if (uPick == 1) { outColor = vec4(float(zone) / 255.0, uPieceId / 255.0, 0.0, 1.0); return; }
  if (uPick == 2) {                    // the UV0 under the pointer (the mask editor paints there), 16 bits per axis
    vec2 q = fract(vUv0), hi = floor(q * 255.0), lo = floor(fract(q * 255.0) * 255.0);
    outColor = vec4(hi.x, lo.x, hi.y, lo.y) / 255.0; return;
  }

  vec4 L0 = L(0), L1 = L(1), L2 = L(2), L3 = L(3), L4 = L(4), L5 = L(5), L6 = L(6), L7 = L(7), L8 = L(8),
       L9 = L(9), L10 = L(10), L11 = L(11), L12 = L(12), L13 = L(13), L14 = L(14), L15 = L(15), L16 = L(16),
       L17 = L(17), L18 = L(18), L19 = L(19), L20 = L(20), L21 = L(21), L22 = L(22);

  // ---- frames
#ifdef CAPE
  vec3 Ng = normalize(front ? vNrm : -vNrm);                            // two-sided cloth
#else
  vec3 Ng = normalize(vNrm);
#endif
  vec3 T0, B0, T1, B1;
  uvFrame(vUv0, vPos, Ng, T0, B0);
  uvFrame(vUv1, vPos, Ng, T1, B1);

  // ---- 4.2 inputs
  vec4 bd = texture(uBaseData, vec3(vUv0, 0.0));
  float cav = bd.a - 0.5;
#ifdef CAPE
  // cape 4.3: trim lines (bands on the ramp t) and their optional relief
  vec4 C0 = C(0), C1 = C(1), C2 = C(2), C3 = C(3), C6 = C(6), C9 = C(9);
  float e1 = 1.0 + C1.w * (sat(C1.y * (abs(tR - C1.x) - C1.z)) - 1.0);
  float e2 = 1.0 + C2.w * (sat(C2.y * (abs(tR - C2.x) - C2.z)) - 1.0);
  float M = e1 * e2;
  float dd = C1.x - C2.x, mid = C1.x + 0.5 * (C2.x - C1.x);
  float a1 = dd != 0.0 ? (abs(tR - mid) - 0.33 * dd) * (1.5 / dd) : 0.0;   // guard: the game's NaN saturates to 0
  float a2 = dd != 0.0 ? abs(tR - mid) * (1.5 / dd) : 0.0;
  float relief = (1.0 - sat(a1)) * C0.w * (0.2 + 0.8 * sat(a2) * sat(a2)) * (C1.w * e1 * e1 + C2.w * e2 * e2);
  float p1 = 1.0 + C1.w * (sat(abs(tR - C1.x) * 0.33 * C1.y) - 1.0);
  float p2 = 1.0 + C2.w * (sat(abs(tR - C2.x) * 0.33 * C2.y) - 1.0);
  float uu = sat((0.33 - p1 * p2) * 3.0); uu *= uu;
  relief += C0.w * 0.15 * uu * uu * (1.0 - uu * uu);
  cav = clamp(cav + relief, -0.5, 0.5);
  float gTex = texture(uGradient, vec3(vUv0, 0.0)).r;
#endif
  float edge = sat(cav), hollow = sat(-cav);
  float occl = 0.4 * (1.0 - bd.b);
  float mode = L0.a;

  // ---- 4.3 detail texture
  float dB = 0.0, dA = 0.0;
  vec2 detailN = vec2(0.0);
  vec2 uvD = vUv1 * (L22.r * uDetailMult) + uRnd;
  if (mode <= 3.0) {
    vec4 D = texture(uDetail, vec3(uvD, float(uint(max(L1.r, 0.0)) % 26u)));
    dB = D.b - 0.5; dA = D.a - 0.5; detailN = n2(D);
  }
  float ccAmt = 0.0, ccRough = 0.0;
  vec2 ccDetailN = vec2(0.0);
  if (mode >= 2.0 && L10.b > 0.0) {
    vec4 D2 = texture(uDetail, vec3(uvD, float(uint(max(L10.g, 0.0)) % 26u)));
    ccDetailN = n2(D2) * L10.a;
    ccRough = L11.a + dot(L11.rgb, vec3(D2.b - 0.5, D2.a - 0.5, edge));
    ccAmt = L10.b;
  }
  if (mode == 4.0 && uVehicle == 0) {                                  // (vehicles: no composite, no detail: ps:347)
    float layer = float(min(uint(max(L1.r, 0.0)) % 26u, 1u));
    vec4 Cm = texture(uComposite, vec3(vUv1 * L22.r * uDetailMult * 4.0, layer));
    dB = Cm.b - 0.5; dA = 0.0; detailN = n2(Cm);
  }

  // ---- 4.4 / 4.5 masks ("rough" is roughness, mask7 is metalness)
  float a3 = sat(dA + 0.5);
  vec4 S4 = vec4(dB, dA, cav, occl);
  vec4 S3 = vec4(dB, dA, cav, occl * (a3 + (1.0 - a3) * occl));
  vec3 S3v = vec3(dB, dA, cav);
  vec4 S9 = vec4(dB, dA, edge, hollow);
  float mask3 = recipe4(L3, S3, L1.b, cav);
  float mask4 = recipe4(L4, S4, L1.a, cav);
  float metal = recipe4(L7, S4, L6.a, cav);
  float spec = recipe3(L8, S3v, L8.a, cav);
  float rough = recipe4(L9, S9, L10.r, cav);
  float m14 = recipe3(L14, S3v, L14.a, cav);
  float m15 = recipe3(L15, S3v, L15.a, cav);
  float iriB = sat(L13.b), iriA = sat(L13.a);                           // (mov_sat: armor ps:518, vehicle ps:476)
  float G = 0.0;                                                        // cape gradient amount (0 on armor)
#ifdef CAPE
  // cape 4.5: gradient; it also scales the wear and secondary masks
  float gg = C3.a >= 0.0 ? gTex : 1.0 - gTex;
  G = abs(C3.a) * sat(C6.w * (gg - C6.z));
  mask4 = sat(mask4 + mask4 * G * (C9.z - 1.0));
  mask3 = sat(mask3 + mask3 * G * (C9.w - 1.0));
#endif

  // ---- 4.6 normal as surface gradients
  float nStr = mix(mix(1.0, L2.a, mask3), L5.a, mask4);
  vec3 gradBase = grad(n2(bd), T0, B0);
  // the strength scales the gradient, after the texture normal's z is rebuilt (cape ps:532-546, armor ps:429-441,
  // vehicle ps:399-416)
  vec3 gradN = gradBase + grad(detailN, T1, B1) * L1.g * nStr;
  vec3 gradCC = gradBase + grad(ccDetailN, T1, B1);

  // ---- 4.7 color
  vec3 c = L0.rgb;
#ifdef CAPE
  c = mix(L0.rgb, C3.rgb, G);
#endif
  float noCamo = 1.0, camoAmt = 0.0;
  if (L21.a >= 0.0) {                                                   // camo (capes: tiling x detail_tile_factor_mult)
    vec4 Tc = texture(uCamo, vec3(vUv1 * L21.b * uDetailMult, clamp(floor(L21.a + 0.5), 0.0, 4.0)));
    vec3 t = sat((Tc.rgb - 0.5) * L21.r + L21.g);
    vec3 camo = mix(L16.rgb, L17.rgb, t.r);
    camo = mix(camo, L18.rgb, t.g);
    camo = mix(camo, L19.rgb, t.b);
    if (mode == 1.0) { c = camo; noCamo = 1.0; camoAmt = 1.0; }
    else {
      float k = 4.0 * max(0.0, cav * L19.a);
      float cov = sat(dot(vec3(L17.a * (1.0 + k), L18.a * (1.0 + k), L19.a), vec3(dB, dA, cav)) - L20.a);
      c = mix(camo, c, cov);
      camoAmt = 1.0 - cov; noCamo = cov;
      metal = max(0.0, metal - camoAmt);
      rough = mix(rough, L16.a, L22.a * camoAmt);
      m14 *= cov;
    }
  }
  float patAmt = 0.0, keep = 1.0;
#ifdef CAPE
  // cape 4.6: decals (front only; 2-4 need decal 1, 4 needs 3); decal i = cape LUT cols (4,5,6), (7,8,9), ...
  if (front && abs(C6.y) > 0.001) {
    for (int di = 0; di < 4; di++) {
      vec4 Cr = C(4 + 3 * di), Cx = C(5 + 3 * di), Co = C(6 + 3 * di);
      if (di > 0 && abs(Co.y) < 0.001) { if (di == 2) break; continue; }
      if (di == 3 && abs(C(12).y) < 0.001) break;
      float sn = sin(Cx.z), cs = cos(Cx.z);
      vec2 corner = Cr.xy - 0.5 * Cr.zw;
      vec2 qd = (vUv2 - corner) / max(Cr.zw, vec2(1e-4));
      vec2 off = (qd - 0.5) * Cr.zw;
      vec2 lxy = vec2(off.x * cs + off.y * sn, -off.x * sn + off.y * cs) / max(Cr.zw, vec2(1e-4));
      if (!(abs(lxy.x) < 0.5 && abs(lxy.y) < 0.5)) continue;
      vec2 pp = (2.0 * qd - 1.0) * Cr.zw;
      vec2 rp = vec2(pp.x * cs + pp.y * sn, -pp.x * sn + pp.y * cs);
      vec2 pq = Cx.w < 0.0 ? vec2(-rp.y, rp.x) : rp;
      pq /= max(abs(Cx.w), 1e-4);
      if (Co.y < 0.0) pq.x = -pq.x;
      vec2 dxy = Cx.xy + pq;
      if (!(abs(dxy.x * 0.5) < 0.5 && abs(dxy.y * 0.5) < 0.5)) continue;
      vec4 Dc = texture(uDecalSheet, vec3(dxy * 0.5 + 0.5, 0.0));
      float pf = Co.x;
      float a = abs(Co.y) * sat(Dc.a - mask4 * (1.0 - pf));
      float kd = pf * a;
      keep *= (1.0 - Dc.a * kd) * (1.0 - Dc.a * kd);
      c = mix(c, Dc.rgb, a);
      metal *= 1.0 - a * pf;
      rough = mix(rough, 0.4, pf * sat(a - mask3 * (1.0 - pf)));
      spec = mix(spec, 0.5, a);
      m15 = mix(m15, 0.1, kd); m14 = mix(m14, 0.5, kd); iriB = mix(iriB, 0.0, kd); iriA = mix(iriA, 1.0, kd);
      gradN *= 1.0 - pf * pf * a;
    }
  }
#else
  if (mode != 3.0 && uHasPatLut == 1) {                                // pattern
    vec4 P0 = texelFetch(uPatLut, ivec2(0, 0), 0);
    if (P0.a != -1.0) {
      vec4 P1 = texelFetch(uPatLut, ivec2(1, 0), 0), P2 = texelFetch(uPatLut, ivec2(2, 0), 0);
      int layer = int(uint(max(P0.a, 0.0)) % uint(max(uPatLayers, 1)));
      float pm = recipe3(P1, S3v, P1.a, cav);
      float m = sat((texture(uPatMasks, vec3(vUv0, float(layer))).r - 0.5) * 100.0);
      patAmt = m * pm;
      if (patAmt > 0.0) {
        c = mix(c, P0.rgb, patAmt);
        if (mode != 1.0) {
          metal *= min(1.0, 1.0 + mask4 - patAmt * patAmt);
          rough = mix(rough, P2.a, max(0.0, patAmt - mask4) / (2.0 - rough));
          m14 *= 1.0 - patAmt;
          spec = mix(spec, 0.5, patAmt);
        }
        ccAmt *= 1.0 - patAmt;
        if (mode == 4.0 && uVehicle == 0) gradN = mix(gradN, gradCC, patAmt);
      }
    }
  }
  // decal sheet (armor base 0xf5eb): sampled at UV2 inside (0, 1); inside the first decal cell (uv * size <
  // decal_size) the per-instance decal number moves it by number * (decal_id_offset_x, -decal_id_offset_y) texels
  // (armor 0xf5eb ps:649-663, vehicle ps:585-600); palette mode recolors one sheet channel
  if (uHasDecal == 1 && all(greaterThan(vUv2, vec2(0.0))) && all(lessThan(vUv2, vec2(1.0)))) {
    vec4 D = texture(uDecalSheet, vec3(vUv2, 0.0));
    vec2 ts = vec2(textureSize(uDecalSheet, 0).xy);
    bool cell0 = all(lessThan(vUv2 * ts, max(uDecalSize, vec2(1.0))));
    if (cell0) D = texture(uDecalSheet, vec3((vUv2 * ts + max(floor(uDecalId + 0.5), 0.0) * vec2(uDecalOff.x, -uDecalOff.y)) / ts, 0.0));
    // the palette only inside the first decal cell (armor 0xf5eb ps:680-685, vehicle ps:617-622)
    if (uDecalPal.x > 0.5 && cell0) {
      float s = D[int(clamp(uDecalPal.y, 0.0, 2.0))];
      vec2 lsz = uDecalLutSize;
      if (lsz.x > 1.0 || lsz.y > 1.0) lsz /= ts;
      lsz = min(max(1.0 / ts, lsz), vec2(1.0));
      vec2 org = 1.0 - lsz, cell = lsz * vec2(1.0 / 6.0, 1.0 / 3.0);
      float col = clamp(floor(uDecalPal.z + 0.5), 0.0, 5.0);
      float row = s < 1.0 / 3.0 ? 2.0 : (s < 2.0 / 3.0 ? 0.0 : 1.0);
      D.rgb = texture(uDecalSheet, vec3(org + (vec2(col, row) + 0.5) * cell, 0.0)).rgb;
    }
    // vehicles (ps:646-696): in the scalar-field corner (u < end.x, 1 - v < end.y) the sheet's alpha is a height
    // field: its central differences bump the normal (UV0 frame), its sharpened alpha is the decal's coverage
    if (uVehicle == 1 && vUv2.x < uDecalRelief.x && 1.0 - vUv2.y < uDecalRelief.y) {
      float no = max(1.0 - uDecalRelief.z, 0.001);
      vec2 hs = 0.5 / ts;
      #define HGT(o) sat((texture(uDecalSheet, vec3(vUv2 + (o), 0.0)).a - uDecalRelief.z) / no)
      vec2 g = vec2(HGT(vec2(hs.x, 0.0)) - HGT(vec2(-hs.x, 0.0)), HGT(vec2(0.0, hs.y)) - HGT(vec2(0.0, -hs.y))) * uDecalRelief.w;
      #undef HGT
      D.a = sat((D.a - uDecalAlpha.x) / no * uDecalAlpha.y);
      float k = 1.0 + D.a * (uDecalAlpha.z - 1.0);
      gradN = gradN * k + (1.0 - uDecalAlpha.z) * D.a * (gradBase - gradN * k) + grad(g, T0, B0);
    }
    float a = sat(D.a - mask4);                                        // wear erases it
    c = mix(c, D.rgb, a);
    metal *= 1.0 - a;
    m14 *= 1.0 - a;
    rough += max(0.0, a - mask3) * (0.4 - rough);
  }
#endif
  // cloth: fuzz amount, fuzz color (from the color before the secondary blend), rim, spec-occlusion term
  float fuzzW = 0.0, fuzzA = 0.0, clothQ = 1.0;
  vec3 fuzzCol = vec3(0.0);
  if (mode == 1.0) {
    fuzzW = sat(L13.g) * (1.0 - mask3 * keep);
    fuzzCol = mix(L12.rgb, sqrt(max(c, 0.0)), sat(L13.r));
    fuzzA = keep * L12.a;
    clothQ = mix(1.0 - fuzzW * rough, 1.0, sat(dot(c, vec3(0.3, 0.59, 0.11))));
  }
  vec3 sec = L2.rgb;
  float m3 = mask3, m4 = mask4;
#ifdef CAPE
  c = mix(C0.rgb, c, M);                                                // trim color where the lines are
  float Mw = 0.5 + 0.5 * M;                                             // lines also halve secondary and wear
  m3 = mask3 * keep * Mw; m4 = mask4 * Mw;
  sec = mix(L2.rgb, sat(L2.rgb + C3.rgb - c), G);                       // the gradient shifts the secondary color
#endif
  c = mix(c, sec, m3);                                                  // secondary color
  rough = mix(rough, L22.g, L22.b * m3);
  c = mix(c, L6.rgb, m4 * noCamo * keep);                               // wear
  c = mix(c, L5.rgb, m4 * m4 * noCamo * keep);                          // heavy wear
  vec3 albedo = srgbToLinear(sat(c));
  float metal0 = metal;

  // ---- directional weights, height lines (bind-pose object space: Z up = our Y)
  vec3 wp3 = uWpos[3], wn3 = uWneg[3];
#ifdef CAPE
  // capes: a normal made from UV0.y and the face side, height from UV0.y, special Z weights scaled
  float sY = 1.0 - sat((vUv0.y + 0.15) / 1.15); sY *= sY;
  vec3 objN = (front ? 1.0 : -1.0) * normalize(vec3(0.0, 1.0 - sY, sY));
  float h = (1.0 - vUv0.y) * uHeightMult + uHeightBase;
  wp3.z = sat(0.9 * wp3.z); wn3.z = sat(1.9 * wn3.z);
#else
  vec3 objN = uObjTest == 1 ? vNrm : vec3(vNrm.x, -vNrm.z, vNrm.y);
  float h = uObjTest == 1 ? 0.0 : vPos.y;
#endif
  vec3 nP = sat(objN), nN = sat(-objN);
  vec4 w = vec4(sat(dot(uWpos[0], nP) + dot(uWneg[0], nN)), sat(dot(uWpos[1], nP) + dot(uWneg[1], nN)),
                sat(dot(uWpos[2], nP) + dot(uWneg[2], nN)), sat(dot(wp3, nP) + dot(wn3, nN)));
  float hWet = sat(sat(10.0 * (h - uHww.x)) + 1.0 - uHww.y);
  float hWash = sat(sat(10.0 * (h - uHww.z)) + 1.0 - uHww.w);
  vec4 ww = w * hWash;                                                  // blood, gunk, dirt, special
  float kz = wn3.z;
  float Dw = ww.w + 0.95 * min(0.85, kz * sat(1.25 * kz - h));

  // ---- weathering textures
  vec2 Tw = vUv1 * uTile;
  vec4 Dt = texture(uWDirt, vec3(Tw * 0.66, 0.0));
  vec4 Sx = texture(uWSpecial, vec3(Tw * 0.33, 0.0));
  vec4 Bt = texture(uWSplat, vec3(vUv1 * uBloodScale * uTile, 0.0));
  vec4 Gt = texture(uWSplat, vec3(vUv1 * uGunkScale * uTile + 0.5, uBugLayer));

  // ---- exposure, burn glow / LUT emissive, scorch mask
  float E = (1.0 - occl) * min(1.0, 4.0 * edge * (1.0 - metal0) + (mode == 1.0 ? 0.25 : 0.0));
  vec3 emis = vec3(0.0);
#ifdef CAPE
  if (false) {                                                          // capes: no glow, no burn glow
#else
  if (uBsw.x * hWet > 0.0) {
#endif
    float a = 2.0 * fract(0.1 * uTime + Sx.a + vUv1.x * uTile) - 1.0;
    float b = 2.0 * fract(0.173 * uTime + Dt.a + vUv1.y * uTile) - 1.0;
    float flick = max(0.0, 1.0 - 2.0 * abs(ss(abs(a)) - ss(abs(b))));
    float g = uBsw.x * ss(sat(E * E * flick));
    emis = 64.0 * hWet * g * vec3(0.439 + 0.561 * g * g, 0.059 + 0.686 * g * g, 0.376 * g * g);
  } else {
    emis = mode != 1.0 ? albedo * sat(1.0 - rough) * L13.r * 1000.0 : vec3(0.0);
  }
  if (uVehicle == 1) emis = vec3(0.0);                                  // the vehicle shader writes no o5: no glow at all
  float S = ss(min(1.0, E * E + abs(Dt.a - 0.5) + abs(Sx.a - 0.5) + 2.0 * edge));

  // ---- special weathering (mud / snow) and dirt masks
  float dirt = sat(sat(2.0 * (ww.z + Dt.a - 1.0)) - 4.0 * cav * ww.z);
  float SP = 0.0;
  if (uCase != 0) {
    if (uCase == 2) {
      float q = sat((Dw - 0.1) / 0.9);
      float s0 = sat(ss(q) - 0.5);
      s0 += 0.7 * Dw * (1.0 - s0);
      s0 += 0.2 * sat(Dw + 0.65);
      SP = sat(sat(Sx.g + s0 - 1.0) - 4.0 * cav * s0) * sat(1.0 - uHww.y);
    } else {
      SP = sat(sat(8.0 * (Dw + Sx.a - 1.0)) - 4.0 * cav * Dw);
    }
    dirt = min(1.0, dirt + SP * min(abs(float(uCase) - 2.0), 1.0));
  }

#ifndef CAPE
  // ---- vehicle damage (ps:862-911): zones on in damage_mask_selector take the per-instance damage; above 0.5 the
  // worn spots (dirt / special patterns away from edges) darken and roughen, and vehicle_damage_data adds dents
  // (a UV1-frame bump) and bare gray metal (smooth, metallic)
  if (uVehicle == 1) {
    float Dm = ((uDamageMask >> zone) & 1) != 0 ? sat(uDamage) : 0.0;
    if (Dm > 0.0) {
      float burnt = min(0.75, sat(5.0 * (sat(0.5 * Sx.b + Dt.a - 5.0 * edge) - 0.5) * sat(2.0 * uDamage - 1.0))) * Dm;
      albedo = mix(albedo, albedo * (0.3 + 0.7 * sat(2.0 * (Dt.b - 0.5))), burnt);
      spec *= 1.0 - burnt;
      rough = mix(rough, 0.8, burnt);
      vec4 Q = texture(uDamageTex, vec3(vUv1 * uDamageTile, 0.0)) - 0.5;
      float bare = sat(2.0 * (sat(4.0 * edge * Q.a) + Q.b) * Dm);
      gradN += 12.0 * Dm * grad(Q.rg, T1, B1);
      float b2 = min(2.0 * bare, 1.0);
      metal0 = mix(metal0, 1.0, b2);
      rough = mix(rough, 0.15, b2);
      albedo = mix(albedo, vec3(0.5), bare);
    }
  }
#endif

  // ---- dirt
  albedo *= (1.0 - dirt);
  fuzzW *= (1.0 - dirt);
  float K0 = metal0 * (1.0 - dirt * dirt * dirt);
  m14 *= (1.0 - dirt); ccAmt *= (1.0 - dirt);
  rough = mix(rough, 1.0, dirt);
  gradN += dirt * grad(n2(Dt), T1, B1);

  // ---- scorch
  float m15w = m15;
  if (uBsw.y > 0.0) {
    albedo *= 1.0 - min(1.0, 2.0 * S) * vec3(0.769, 0.847, 0.882);
    albedo *= 1.0 - S * vec3(0.902, 0.890, 0.871);
    albedo = mix(albedo, vec3(0.098, 0.110, 0.129), (0.5 * S) * (0.5 * S));
    float t = min(1.0, S + edge);
    iriB = mix(iriB, 0.10, t); iriA = mix(iriA, 0.35, t); m14 = mix(m14, 1.0, t); m15w = mix(m15w, 1.0, t);
    gradN += 4.0 * S * (grad(n2(Dt), T1, B1) + grad(n2(Sx), T1, B1)) * (1.0 - K0);
    rough += S * (1.0 - 0.5 * K0);
  }

  // ---- blood and bug gunk
  float f = fuzzW;
  float bm = sat(ww.x * Bt.a * (8.0 - 6.0 * f) - (4.0 - 3.0 * f));
  float gm = sat(Gt.a * min(1.0, max(ww.y, uGunkMin)) * (8.0 - 6.0 * f) - (4.0 - 3.0 * f));
  float cover = sat(Bt.a * bm + Gt.a * gm);
  float fuzzC = fuzzW * (1.0 - cover);
  fuzzCol *= (1.0 - cover); fuzzA *= (1.0 - cover);
  m14 *= (1.0 - cover);
  rough = mix(rough, 0.1, cover); spec = mix(spec, 0.5, cover);
  float dk = 1.0 - 0.96 * K0;
  vec3 bloodC = pow(abs(uBloodColor), vec3(2.2)), gunkC = pow(abs(uGunkColor), vec3(2.2));
  albedo = mix(albedo, albedo * vec3(0.6, 0.016, 0.016) * dk, sat(Bt.a * bm * (1.0 + K0)));
  albedo = mix(albedo, bloodC, sat(Bt.b * bm));
  albedo = mix(albedo, albedo * dk * vec3(0.816, 0.835, 0.267), sat(Gt.a * gm * (1.0 + K0)));
  albedo = mix(albedo, gunkC, sat(Gt.b * gm));
  float K = K0 * (1.0 - sat(8.0 * (Bt.a * bm + Gt.a * gm) - 3.0));
  float wetB = cover, nf = 1.0;
  float c2 = sat(clothQ + Bt.b * bm + Gt.b * gm);
  // subsurface: blood / gunk (cross-coupled colors, literal; ps:929-933, 967-969), frost and snow below
  vec3 ssCol = sat(0.75 * (Gt.a * gm * bloodC + Bt.a * bm * gunkC));
  float ssInt = 0.025 * sat(Bt.b * bm + Gt.b * gm), ssWrap = 0.5, ssDiff = 0.6;

  // ---- frost
  if (uFrost >= 0.001) {
    float fr = min(uFrost, 0.41);
    vec4 fc = vec4(0.616, 0.75, 0.82, 0.25) + Dt.b * vec4(0.384, 0.25, 0.18, 0.25);
    float x = sat(Dt.a - 2.0 * cav + 0.5 * Sx.b);
    float fm = (max(0.0, x - (1.0 - fr)) + 0.1) * fr;
    nf = 2.0 * fm;
    gradN += 4.0 * fm * (grad(n2(Dt), T1, B1) + grad(n2(Sx), T1, B1)) * (1.0 - K);
    albedo = mix(albedo, fc.rgb, fm); spec = mix(spec, 1.0, fm); rough = mix(rough, 0.1, fm);
    ssCol = mix(ssCol, fc.rgb, fm); ssInt = mix(ssInt, fc.g, fm);
    ssWrap = 0.5 + fm * fc.a; ssDiff = 0.6 + fm * (0.15 + 0.25 * Dt.b);
    wetB = cover * fm;
  }

  // ---- snow and wetness
  float melt = uBsw.y, wet, Mn, snowAmt = 0.0;
  if (uCase == 2) {
    wet = wetB * (1.0 - SP) + Dw * (1.0 - abs(2.0 * melt - 1.0));
    float SN = SP * (1.0 - melt) * (1.0 - melt);
    K *= (1.0 - SN); nf = 1.0 - 2.0 * SN;
    float SNv = SN * (1.0 - cover);
    albedo = mix(albedo, uSnowBase, SNv);
    fuzzCol = mix(fuzzCol, uSnowFuzz, SNv); fuzzA = mix(fuzzA, 1.0, SNv);
    spec = mix(spec, uSnowSpec, SNv); rough = mix(rough, 0.75, SNv);
    ssCol = mix(ssCol, uSnowSss, SNv); ssInt = mix(ssInt, uSnowSssP.x, SNv);
    ssWrap = mix(ssWrap, uSnowSssP.y, SNv); ssDiff = mix(ssDiff, uSnowSssP.z, SNv);
    Mn = SNv; snowAmt = SNv;
  } else {
    wet = SP * sat(1.0 - melt - S * melt) + wetB;
    Mn = SP; snowAmt = SP;
  }
  wet = sat(wet + (1.0 - hWet) + uBsw.z);
  gradN = mix(gradN, gradBase + grad(n2(Sx), T1, B1), Mn);
  wet = sat(wet + uMatWet);

  // ---- blood / gunk normal
  vec2 v = vec2(1.0 - Gt.r - Bt.r, Gt.g + Bt.g - 1.0) * nf * uBGNInt;
  float wN = sat(Bt.a * bm * uBloodNFade + Gt.a * gm * uGunkNFade) * pow(1.0 - fuzzC, 20.0);
  gradN = mix(gradN, grad(v, T1, B1), wN);

#ifdef CAPE
  // cape 4.8: the tear edge (paler, rougher torn cloth; tear_amount is 0 on stock materials)
  float tx = sat((abs(uTearAmount * (tearV - 1.0) - 0.001) - 0.005) * 8.0);
  float tf = pow(1.0 - tx, 4.0);
  albedo = sat(mix(sqrt(max(albedo, 0.0)), albedo, tf)); rough = sat(mix(0.8, rough, tf));
#endif
  // ---- final layers
  albedo = sat(albedo);
  float Kf = max(K, 0.0);
  float fuzzO = Kf > 0.0 ? 0.0 : fuzzC;
  float ccO = fuzzO > 0.0 || uVehicle == 1 ? 0.0 : ccAmt;
  float cc = ccO > 0.01 ? ccO : 0.0;
  vec3 N = normalize(Ng + gradN);
  vec3 Ncc = normalize(Ng + gradCC);
  vec3 V = normalize(uCamPos - vPos);
  float NoV = max(dot(N, V), 1e-4);
  vec3 albedo0 = albedo;                                                // (vehicles' subsurface color: no rim)
  albedo = mix(albedo, sat(fuzzCol), sat(fuzzA) * (1.0 - NoV));          // cloth rim baked into the color
  float so = (1.0 - occl) * mix(1.0, c2, abs(dot(Ng, V)));              // specular occlusion
  float roughOut = 0.045 + 0.955 * sat(rough);
  float ccRoughOut = 0.045 + 0.955 * sat(ccRough);
  // subsurface amount (ps:1075-1089; vehicles: the intensity itself, vehicle ps:1148-1151): odd pixels carry ssCol
  // (vehicles: the color before the rim, vehicle ps:1173-1176)
  float wv = sat(ssWrap);
  float ssA = sat(ssInt) * (uVehicle == 1 ? 1.0 : pow(abs(mix(NoV, 1.0 - NoV, wv)), 1.0 + 2.0 * abs(wv - 0.5)) - abs(wv - 0.5) + 0.5);
  if (Kf > 0.0 || ssA <= 0.01) ssA = 0.0;
  if (uVehicle == 1) ssCol = albedo0;

  // iridescence, quantized like the G-buffer byte (5 bit amount, 3 bit thickness)
  float iriAmount = floor(min(1.0, m15w * m14) * 31.0 + 0.5) / 31.0;
  float th = iriB + (1.0 - iriB) * iriA * min(1.0, m14);
  float iriT = floor(sat(th * th) * 7.0 + 0.5) / 7.0;
  iriT *= iriT;

  // ---- raw G-buffer values (debug output: the accuracy check against the game's own shader)
  if (uDebug >= 40) {
    float iriT3 = floor(sat(th * th) * 7.0 + 0.5) / 7.0;
    if (uDebug == 40) outColor = vec4(albedo, roughOut);
    else if (uDebug == 41) outColor = vec4(N, sat(spec));
    else if (uDebug == 42) outColor = vec4(Kf, iriAmount, iriT3, cc);
    else if (uDebug == 43) outColor = vec4(pow(sat(emis / 128.0), vec3(0.8)), fuzzO);
    else if (uDebug == 45) outColor = vec4(wet, dirt, cover, SP);
    else if (uDebug == 47) outColor = vec4(sat(0.5 - 0.5 * fuzzO + 0.5 * cc), sat(0.5 - 0.5 * ssA + 0.5 * Kf),
                                           floor(63.0 * pow(abs(ssDiff), 0.75) + 0.5) * 4.0 / 255.0, ssA);   // o2.xy, o3.w
    else if (uDebug == 48) outColor = vec4(ssA > 0.0 ? sat(ssCol) : albedo, so);   // odd pixels' albedo
#ifdef CAPE
    else if (uDebug == 46) outColor = vec4(Sf.rgb, Sf.a);
#endif
    else outColor = vec4(float(zone), mask3, mask4, metal0);
    return;
  }

  // ---- debug views
  if (uDebug != 0) {
    vec3 d = vec3(0.0);
    if (uDebug == 1) d = linearToSrgb(albedo);
    else if (uDebug == 2) d = zoneColor(zone) * (0.55 + 0.45 * max(dot(N, normalize(vec3(.4, .8, .5))), 0.0));
    else if (uDebug == 3) d = vec3(mask3);
    else if (uDebug == 4) d = vec3(mask4);
    else if (uDebug == 5) d = vec3(mask4 * mask4);
    else if (uDebug == 6) d = vec3(Kf);
    else if (uDebug == 7) d = vec3(camoAmt);
    else if (uDebug == 8) d = vec3(sat(rough));
    else if (uDebug == 9) d = vec3(spec);
    else if (uDebug == 10) d = N * 0.5 + 0.5;
    else if (uDebug == 11) d = vec3(iriAmount);
    else if (uDebug == 12) d = pow(sat(emis / 128.0), vec3(0.8));
    else if (uDebug == 13) d = vec3(dB + 0.5, dA + 0.5, 0.5);
    else if (uDebug == 14) d = vec3(edge, hollow, 0.0);
    else if (uDebug == 15) d = vec3(1.0 - occl / 0.4);
    else if (uDebug == 16) d = vec3(cc);
    else if (uDebug == 17) d = vec3(patAmt);
    else if (uDebug == 18) d = vec3(dirt);
    else if (uDebug == 19) d = vec3(wet);
    else if (uDebug == 20) d = vec3(Bt.a * bm, Gt.a * gm, 0.0);
    else if (uDebug == 21) d = vec3(snowAmt);
    else if (uDebug == 22) d = vec3(fuzzO);
    if (uHighlightZone >= 0 && zone == uHighlightZone) d = mix(d, vec3(1.0, 0.85, 0.2), 0.35 + 0.15 * sin(uTime * 6.0));
    outColor = vec4(d, 1.0);
    return;
  }

  // ---- lighting: the game's (LIGHTING), fed what its G-buffer would hold (gbuffer2 halves and the gbuffer3.zw
  // bytes quantized as the lighting decodes them; ps:1129-1156)
  float o2x = floor(sat(0.5 - 0.5 * fuzzO + 0.5 * cc) * 255.0 + 0.5) / 255.0;
  float o2y = floor(sat(0.5 - 0.5 * ssA + 0.5 * Kf) * 255.0 + 0.5) / 255.0;
  Surf sf;
  sf.albedo = albedo; sf.ssCol = ssA > 0.0 ? sat(ssCol) : albedo; sf.N = N;
  sf.cc = sat(2.0 * o2x - 1.003922); sf.fuzz = sat(1.0 - 2.0 * o2x);
  sf.metal = sat(2.0 * o2y - 1.0); sf.sss = sat(0.996078 - 2.0 * o2y);
  sf.Ncc = sf.cc > 0.0 ? Ncc : N;
  sf.rough = roughOut; sf.ccRough = sf.cc > 0.0 ? ccRoughOut : roughOut;
  sf.spec = sat(spec); sf.wet = wet;
  sf.so = sqrt(floor(63.0 * so * so + 0.5) / 63.0);
  sf.diffusion = max(pow(floor(63.0 * pow(abs(ssDiff), 0.75) + 0.5) / 63.0, 1.5), 0.5);
  sf.iriAmount = iriAmount; sf.iriThick = iriT;
  gamePrep(sf, V);
  vec3 dif = vec3(0.0), spe = vec3(0.0), sub = vec3(0.0);
  gameEnv(sf, V, dif, spe, sub);
  // the sun (or the environment's key light) with LUT Studio's shadow map; the flashlight and the side lights
  // are LUT Studio's own, lit the same way (no disk, no shadow)
  vec2 sh = sunShadow(vPos, Ng);
  gameLight(sf, V, normalize(uSunDir), uSunColor, uSunSize, sh.x, sh.y, dif, spe, sub);
  if (uFlashlight == 1) {
    vec3 toL = uCamPos + vec3(0.25, 0.1, 0.0) - vPos;
    float dist = length(toL);
    gameLight(sf, V, toL / dist, vec3(1.0, 0.95, 0.85) * 6.0 / (1.0 + dist * dist * 0.15), 0.0, 1.0, 1.0, dif, spe, sub);
  }
  for (int i = 0; i < 2; i++)
    if (uRimColor[i] != vec3(0.0)) gameLight(sf, V, normalize(uRimDir[i]), uRimColor[i], 0.0, 1.0, 1.0, dif, spe, sub);
  // a game light rig's local lights: the lighting shader's distance falloff and window (gb ps lit:2150-2290; its N.L
  // term is gameLight's), and a soft cone (the game's angular profile texture isn't known)
  for (int i = 0; i < 6; i++) {
    if (uLColor[i] == vec3(0.0)) continue;
    vec3 toL = uLPos[i] - vPos;
    float d = length(toL), S = uLRange[i].x, E = uLRange[i].y;
    vec3 L = toL / max(d, 1e-4);
    float att = (S + 1.0) / (d * d + 0.1 * E + 1.0);
    float w = 1.0 - min(pow(max(d - S, 0.0) / max(E - S, 1e-4), 4.0), 1.0);
    att *= w * w;
    if (uLRange[i].z > -1.0) att *= smoothstep(uLRange[i].z, mix(uLRange[i].z, 1.0, 0.35), dot(-L, normalize(uLDir[i])));
    if (att > 0.0) gameLight(sf, V, L, uLColor[i] * att, 0.0, 1.0, 1.0, dif, spe, sub);
  }
  for (int i = 0; i < 4; i++)   // the Armory menu's other lights (the sun's shading, a 0.5 disk), each with its shadow
    if (uDLColor[i] != vec3(0.0)) {
      vec3 L = normalize(uDLDir[i]);
      gameLight(sf, V, L, uDLColor[i], 0.5, shadowAt(i + 1, vPos, Ng, L), 1.0, dif, spe, sub);
    }
  vec3 col = dif + spe + sub + emis * uEmissiveScale;

  col *= uExposure;
  if (uGradeOn == 1) col = shaped(col);
  else {
    col = (col * (uTone.x * col + uTone.y)) / (col * (uTone.z * col + uTone.w) + uToneE);  // (default: the ACES fit)
    col = uRawOut == 1 ? sat(col) : linearToSrgb(sat(col));
  }
  if (uHighlightZone >= 0 && zone == uHighlightZone) col = mix(col, vec3(1.0, 0.85, 0.2), 0.25 + 0.15 * sin(uTime * 6.0));
  outColor = vec4(col, 1.0);
}`;

// the cape variant of the same shader
export const CAPE_FRAG = FRAG.replace('#version 300 es', '#version 300 es\n#define CAPE 1');

// the sun's shadow map: depth only (capes leave out their cut-out, as the color pass does)
export const SHADOW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv0;
#ifdef CAPE
uniform sampler2DArray uScalar; uniform sampler2DArray uTear; uniform float uTearAmount;
#endif
void main() {
#ifdef CAPE
  float a = texture(uScalar, vec3(vUv0, 0.0)).a, t = texture(uTear, vec3(vUv0, 0.0)).r;
  if (min(0.51 * (1.0 + uTearAmount * (t - 1.0)), a) < 0.5) discard;
#endif
}`;
export const SHADOW_CAPE_FRAG = SHADOW_FRAG.replace('#version 300 es', '#version 300 es\n#define CAPE 1');

// background: sky gradient matching the environment

export const BG_VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 vNdc;
void main() { vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.999, 1.0); }`;

export const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vNdc; out vec4 o;
uniform mat4 uInvViewProj; uniform vec3 uCamPos;
uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon; uniform vec3 uGround; uniform float uExposure;
uniform int uEnvCube; uniform samplerCube uEnvSpec; uniform float uEnvScale; uniform float uEnvRot; uniform float uBgLod;
// a planet's look (planet lighting, uGradeOn): the exposed scene color written shaped, log2(x / 0.18) + 12 over 18.5,
// for a pass after (GRADE_FRAG; the showcase's composite) to grade with the planet's 3D LUT (no sampler here: this
// shader has the 16 a GPU must give)
uniform int uGradeOn;
vec3 shaped(vec3 c) { return clamp((log2(max(c, vec3(1e-6)) / 0.18) + 12.0) / 18.5, 0.0, 1.0); }
// planet lighting's ground (uPlanetGround): the planet's ground tile (sRGB albedo, 4 m) at the model's feet (uFloorY),
// lit as the model is (uSunE: the sun on a level surface, uSkyUp: the sky's), a soft contact shadow under the model
// (uFoot: center xz, radii) and its cast shadow away from the sun (uCast: xz offset of the shadow's far end)
uniform int uPlanetGround; uniform sampler2D uGroundTex; uniform vec3 uSunE; uniform vec3 uSkyUp; uniform float uFloorY;
uniform vec4 uFoot; uniform vec2 uCast; uniform float uFogDist;
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * t); }
uniform vec2 uBackdrop;   // > 0: a dimmed grey backdrop, sRGB uBackdrop.x at the left edge to .y at the right (the
                          // Armory menu's blurred, darkened scene), the cube's brightness only varying it a little
vec3 cubeDir(vec3 v) {
  float c = cos(uEnvRot), s = sin(uEnvRot);
  v = vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  return vec3(v.x, -v.z, v.y);
}
vec3 linearToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCamPos);
  float h = d.y;
  vec3 s = h >= 0.0 ? mix(uSkyHorizon, uSkyZenith, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uSkyHorizon, uGround, clamp(-h * 4.0, 0.0, 1.0));
  vec3 col = s * uExposure * 0.6;
  if (uEnvCube == 1) col = textureLod(uEnvSpec, cubeDir(d), uBgLod).rgb * uEnvScale * uExposure;
  if (uPlanetGround == 1 && d.y < -1e-4 && uCamPos.y > uFloorY) {
    float t = (uFloorY - uCamPos.y) / d.y; vec3 P = uCamPos + d * t;
    vec2 q = (P.xz - uFoot.xy) / uFoot.zw;
    float contact = 1.0 - smoothstep(0.6, 1.4, length(q));
    float r = max(uFoot.z, uFoot.w);
    float castSh = (1.0 - smoothstep(0.35 * r, 1.1 * r, segDist(P.xz, uFoot.xy, uFoot.xy + uCast))) * 0.8;
    float sh = max(contact * 0.75, castSh);
    vec3 alb = s2l(texture(uGroundTex, P.xz / 4.0).rgb);
    vec3 g = alb * (uSunE * (1.0 - sh) + uSkyUp * (1.0 - 0.45 * contact)) * uExposure;
    col = mix(g, col, smoothstep(0.25 * uFogDist, uFogDist, t));
  }
  vec3 sr = uGradeOn == 1 ? shaped(col)
    : linearToSrgb(clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0));
  if (uBackdrop.x > 0.0) sr = vec3(mix(uBackdrop.x, uBackdrop.y, clamp(vNdc.x * 0.5 + 0.5, 0.0, 1.0)) * (0.7 + 0.6 * dot(sr, vec3(0.2126, 0.7152, 0.0722))));
  o = vec4(sr, 1.0);
}`;

// planet lighting's grading: the frame drawn shaped (uGradeOn) through the planet's 3D LUT (planets/<id>.png: its day
// grading and the game's SDR output) onto the canvas
export const GRADE_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vNdc; out vec4 o;
uniform sampler2D uSrc; uniform sampler3D uGrade;
void main() {
  vec4 c = texture(uSrc, vNdc * 0.5 + 0.5);
  o = vec4(texture(uGrade, c.rgb * (32.0 / 33.0) + 0.5 / 33.0).rgb, 1.0);
}`;
