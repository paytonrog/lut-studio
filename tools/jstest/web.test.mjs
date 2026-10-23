// Unit tests of the editor's pure code (no browser): node --test tools/jstest/
// Needs LUTSTUDIO_SCHEMA (the /api/schema JSON; tools/test.py writes it) for the preset check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slotList, vehicleMount } from '../../server/web/helpers.js';
import { extractPieces, materialSlot, nodeWorld, transformPrim, skeletonOf, poseSkeleton, avatarWorld, jointWorld, M4 } from '../../server/web/render.js';
import { BUILTIN, applyPreset, importLooks } from '../../server/web/presets.js';
import { recolorDecals, decalInks, decalContrast, MIN_DECAL_CONTRAST, sheetInks } from '../../server/web/decaltheme.js';

test('slotList merges left/right and names single-body parts', () => {
  const p = (slot, body = 'any') => ({ slot, body });
  assert.equal(slotList([p('left_arm'), p('right_arm'), p('torso', 'stocky'), p('hips')]), 'torso (stocky), arms, hips');
  assert.equal(slotList([p('left_leg', 'slim')]), 'left leg (slim)');
  assert.equal(slotList([p('m_frv_body'), p('m_frv_wheels')]), 'frv body, frv wheels');
  assert.equal(slotList([]), '');
});

test('vehicleMount places exosuit arms, tank parts and the Pelican turret', () => {
  const v = 'content/fac_helldivers/vehicles/';
  assert.deepEqual(vehicleMount(v + 'combat_walker_autocannon/combat_walker_autocannon_left'), ['attach_turret_l']);
  assert.deepEqual(vehicleMount(v + 'combat_walker_autocannon/combat_walker_autocannon_right'), ['attach_turret_r']);
  assert.deepEqual(vehicleMount(v + 'combat_walker_turret/combat_walker_turret'), ['attach_turret_r']);
  assert.deepEqual(vehicleMount(v + 'combat_walker_shield/combat_walker_shield'), ['attach_turret_l']);
  assert.deepEqual(vehicleMount(v + 'tank_storm/armaments/tank_storm_silo/tank_storm_silo'), ['attach_silo_left', 'attach_silo_right']);
  assert.deepEqual(vehicleMount(v + 'shuttle_gunship/turrets/shuttle_gunship_turret_hmg'), ['attach_front_turret']);
  assert.deepEqual(vehicleMount(v + 'frv/armaments/frv_mg/frv_mg'), ['gun_mount']);
  assert.deepEqual(vehicleMount(v + 'frv_supply/armaments/frv_supply_rack/frv_supply_rack'), ['gun_mount']);
  assert.deepEqual(vehicleMount(v + 'frv_heavy/armaments/frv_flamer_fuel_tank/frv_flamer_fuel_tank'), ['attach_boot']);
});

// the slot of a material: named, a skin's variant, or a slot only known by its hash (the Bastion's cannon)
test('materialSlot reads named and hashed slots', () => {
  assert.equal(materialSlot('m_tank 0x2d7ef36748bb42f4'), 'm_tank');
  assert.equal(materialSlot('0x1cd5c245 m_tank'), 'm_tank');
  assert.equal(materialSlot('0xba24ab63 0x2d7ef36748bb42f4'), '0xba24ab63');
  assert.equal(materialSlot('0x1cd5c245 0xba24ab63'), '0xba24ab63');
  assert.equal(materialSlot(undefined), '');
});

// a minimal glTF (as parseGLB returns it): one node with a two-variant mesh and a destroyed copy
function fakeGLB() {
  const tri = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 2 };
  const json = {
    images: [{ name: '0x00000000000000a1' }, { name: '0x00000000000000b2' }, { name: '0x0000000000000003' }],
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
    materials: [
      { name: 'm_body 0x1', extras: { material_lut: 0, id_masks_array: 2 } },
      { name: '0xaaaa m_body', extras: { material_lut: 1, id_masks_array: 2 } },
    ],
    meshes: [{ primitives: [{ attributes: tri, material: 0,
      extensions: { KHR_materials_variants: { mappings: [{ material: 0, variants: [0] }, { material: 1, variants: [1] }] } } }] }],
    nodes: [{ name: 'g_body body', mesh: 0, translation: [0, 0, 0] }, { name: 'g_body door_destroyed', mesh: 0 },
      { name: 'attach_turret_l', translation: [1, 2, 3] },
      // with the unit's visibility masks: a damaged part the game hides at first; an intact part named for being
      // hidden once destroyed (the FRV's bonnet)
      { name: 'g_body panel_damaged', mesh: 0, extras: { name: 'panel_damaged', index: 1, default_hidden: 1 } },
      { name: 'g_body bonnet_destroyed', mesh: 0, extras: { name: 'bonnet_destroyed', index: 2, default_hidden: 0 } }],
    scenes: [{ nodes: [0, 1, 2, 3, 4] }],
    extensions: { KHR_materials_variants: { variants: [{ name: 'default' }, { name: 'Mustard Vehicle Pattern' }] } },
  };
  const acc = [new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), new Float32Array(6)];
  return { json, read: i => ({ data: acc[i] }), readIdx: () => new Uint32Array([0, 1, 2]) };
}

test('extractPieces picks the skin variant, names the slot, skips the parts the game hides', () => {
  const g = fakeGLB();
  const all = extractPieces(g);
  assert.equal(all.length, 4);                       // every mesh without the vehicle option
  const def = extractPieces(g, { vehicle: true });
  assert.equal(def.length, 2);                       // body + the intact bonnet (not the destroyed copy, not damaged)
  assert.equal(def[0].slot, 'm_body');
  assert.equal(def[0].tex.lut, '0x00000000000000a1');
  const skin = extractPieces(g, { vehicle: true, variant: 'mustard vehicle pattern' });   // case-insensitive
  assert.equal(skin[0].tex.lut, '0x00000000000000b2');
  assert.equal(skin[0].slot, 'm_body');
  const none = extractPieces(g, { vehicle: true, variant: 'no such skin' });           // falls back to default
  assert.equal(none[0].tex.lut, '0x00000000000000a1');
});

// a slot set to the zero hash is unset (I-92 Fire Fighter's hips undersuit: pattern_lut 0x0000…, which as a LUT to
// load failed and dropped the piece)
test('extractPieces reads a zero-hash texture slot as unset', () => {
  const g = fakeGLB();
  g.json.images.push({ name: '0x0000000000000000' });
  g.json.textures.push({ source: g.json.images.length - 1 });
  g.json.materials[0].extras.pattern_lut = g.json.textures.length - 1;
  const [body] = extractPieces(g, { vehicle: true });
  assert.equal(body.tex.patternLut, null);
  assert.equal(body.tex.lut, '0x00000000000000a1');
  assert.equal(body.tex.idMasks, '0x0000000000000003');   // (a small hash is not the zero one)
});

test('nodeWorld + transformPrim move a part to a mount node', () => {
  const g = fakeGLB();
  const m = nodeWorld(g, 'attach_turret_l');
  assert.deepEqual([m[12], m[13], m[14]], [1, 2, 3]);
  assert.equal(nodeWorld(g, 'missing'), null);
  const prim = extractPieces(g, { vehicle: true })[0];
  transformPrim(prim, m);
  assert.deepEqual(Array.from(prim.pos.slice(0, 3)), [1, 2, 3]);
  assert.equal(prim.skin, null);
});

test('every built-in look names only real LUT fields', { skip: !process.env.LUTSTUDIO_SCHEMA && 'LUTSTUDIO_SCHEMA not set' }, () => {
  const schema = JSON.parse(readFileSync(process.env.LUTSTUDIO_SCHEMA, 'utf8'));
  const fields = schema.material.fields ?? schema.material;
  const paths = new Set(fields.map(f => `${f.group}.${f.key}`));
  for (const p of BUILTIN) {
    for (const path of Object.keys(p.fields)) assert.ok(paths.has(path), `look "${p.name}": unknown field ${path}`);
    const l = { w: 23, edited: new Float32Array(23 * 8 * 4) };
    applyPreset(p, l, 3, fields);                      // writes only inside zone 3
    l.edited.forEach((v, i) => { if (v !== 0) assert.equal(Math.floor(i / (23 * 4)), 3, `look "${p.name}" wrote outside its zone`); });
  }
});

test('a saved look of another LUT kind is refused', () => {
  const l = { w: 23, edited: new Float32Array(23 * 4) };
  assert.throws(() => applyPreset({ row: [1, 2, 3] }, l, 0, []));
  applyPreset({ row: Array(23 * 4).fill(0.5) }, l, 0, []);
  assert.equal(l.edited[0], 0.5);
});

// Skinning on the avatar's skeleton: a piece modeled in another rest pose (the DS-191 Scorpion's undersuit arms)
// takes the avatar's bone matrix for the bones it shares, and a bone the avatar lacks keeps its own offset from
// its nearest shared ancestor.
test('jointWorld puts a piece on the avatar skeleton', () => {
  const nodes = (handX) => ({ nodes: [
    { name: 'root', children: [1] },
    { name: 'elbow', translation: [1, 0, 0], children: [2] },
    { name: 'hand', translation: [handX, 0, 0], children: [3] },
    { name: 'claw', translation: [0, 0.5, 0] },                     // (not in the avatar)
  ] });
  const avatar = skeletonOf({ nodes: nodes(1).nodes.slice(0, 3).map((n, i) => i === 2 ? { name: 'hand', translation: [1, 0, 0] } : n) });
  const piece = skeletonOf(nodes(1.3));                              // its hand 0.3 further out at rest
  piece.bind = poseSkeleton(piece, null, 0);
  const A = avatarWorld(avatar, null, 0);
  const pos = m => [m[12], m[13], m[14]].map(v => Math.round(v * 1000) / 1000);
  assert.deepEqual(pos(jointWorld(piece, A, 2)), [2, 0, 0]);         // the avatar's hand, not the piece's
  assert.deepEqual(pos(jointWorld(piece, A, 3)), [2, 0.5, 0]);       // the claw follows it with its own offset
  assert.ok(M4);
});

test('zone roles: the role view paints each zone in its role color, flat', async () => {
  const { roleViewLut, ROLE_INFO } = await import('../../server/web/roles.js');
  const w = 23, h = 2, v = new Float32Array(w * h * 4).fill(0.5);
  const fields = [{ group: 'paint', key: 'color', leaves: [[0, 0], [0, 1], [0, 2]] }, { group: 'metal', key: 'offset', leaves: [[6, 3]] }];
  const out = roleViewLut({ w, h }, v, ['cloth', 'glow'], fields);
  assert.equal(out[1], Math.fround(ROLE_INFO.cloth.color[1]));
  assert.equal(out[(w + 0) * 4], Math.fround(ROLE_INFO.glow.color[0]));
  assert.equal(out[(6) * 4 + 3], -1);
  assert.equal(v[1], 0.5);   // (a copy)
});

test('looks import: Paydex LUT Editor row presets and LUT Studio looks', () => {
  const px = n => Array.from({ length: n }, (_, i) => ({ r: i, g: 0.5, b: 0.25, a: -1 }));
  const old = { 'Chrome': { timestamp: '2025-01-01', rowData: px(23) }, 'Cape gold': { rowData: px(16) }, 'Stripe': { rowData: px(3) }, 'Odd': { rowData: px(7) } };
  const got = importLooks(old);
  assert.deepEqual(got.map(l => [l.name, l.kind, l.row.length]), [['Chrome', 'material', 92], ['Cape gold', 'cape', 64], ['Stripe', 'pattern', 12]]);
  assert.deepEqual(got[0].row.slice(4, 8), [1, 0.5, 0.25, -1]);
  assert.ok(got.every(l => l.category === 'Paydex'));
  const mine = [{ name: 'Mine', kind: 'material', category: 'Metals', row: Array(92).fill(0.1), saved: '2026-10-17T00:00:00Z' },
    { name: 'Plain', kind: 'material', row: Array(92).fill(0.2) }, { name: 'Bad', kind: 'cape', row: [1, 2] }];
  const back = importLooks(mine);
  assert.deepEqual(back.map(l => [l.name, l.category ?? null, !!l.saved]), [['Mine', 'Metals', true], ['Plain', null, false]]);
});

test('built-in looks: each in a category', () => {
  assert.ok(BUILTIN.length > 0 && BUILTIN.every(p => typeof p.category === 'string' && p.category));
});

// the same cases as server/decaltheme_test.go: the preview recolors decals as the Apply does
test('decals in a theme: recolored as the server does', () => {
  const px = () => new Uint8Array([255, 255, 255, 200, 0, 0, 0, 255, 128, 128, 128, 0]);
  const two = recolorDecals(px(), 'two', [1, 0.5, 0], [0, 0, 1]);
  assert.deepEqual([...two.slice(0, 8)], [255, 128, 0, 200, 0, 0, 255, 255]);
  assert.equal(two[11], 0);
  const one = recolorDecals(px(), 'one', [0.8, 0.8, 0.8], [0, 0, 0]);
  assert.ok(one[0] > one[4] && one[4] > 0 && one[3] === 200);
  // decalInks (server/decaltheme_test.go TestDecalInks): the trim where it reads on what it's drawn on
  const gold = [0.85, 0.65, 0.25, 1], white = [0.92, 0.92, 0.9, 1], purple = [0.18, 0.08, 0.3, 1], c3 = r => r.slice(0, 3);
  let ink = decalInks([c3(purple)], [{ trim: gold, primary: white, secondary: purple }]);
  assert.deepEqual(ink.light, c3(gold));
  assert.ok(decalContrast(ink.light, ink.dark) >= MIN_DECAL_CONTRAST);
  ink = decalInks([c3(gold), c3(white)], [{ trim: gold, primary: white, secondary: gold }]);
  for (const s of [gold, white]) assert.ok(Math.max(decalContrast(ink.light, c3(s)), decalContrast(ink.dark, c3(s))) >= MIN_DECAL_CONTRAST, `reads on ${s}`);
  assert.ok(decalContrast(ink.light, ink.dark) >= MIN_DECAL_CONTRAST);
  assert.deepEqual(decalInks([], [{ trim: gold, secondary: purple }]).light, c3(gold));
  assert.equal(decalInks([], [{}]), null);
  // sheetInks: per sheet, from the themed LUTs drawing it, on their primary; a sheet no themed LUT draws left out
  const looksAt = h => ({ a: { trim: gold, primary: purple, secondary: white }, c: { trim: gold, primary: gold, secondary: white } })[h] ?? null;
  const inks = sheetInks([{ decalHash: 's1', info: { lut: 'a' } }, { decalHash: 's2', info: { lut: 'c' } }, { decalHash: 's3', info: { lut: 'x' } }],
    looksAt);
  assert.deepEqual(inks.get('s1').light, c3(gold));
  assert.ok(decalContrast(inks.get('s2').dark, c3(gold)) >= MIN_DECAL_CONTRAST);
  assert.equal(inks.has('s3'), false);
});

test('pngBlob writes the pixels as they are: colors under zero alpha kept', async () => {
  const { pngBlob } = await import('../../server/web/texedit.js');
  const { inflateSync, crc32 } = await import('node:zlib');
  const w = 3, h = 2, px = new Uint8Array([200, 10, 30, 0, 1, 2, 3, 4, 255, 255, 255, 255, 9, 8, 7, 0, 0, 0, 0, 0, 50, 60, 70, 128]);
  const b = new Uint8Array(await (await pngBlob(w, h, px)).arrayBuffer());
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(b.buffer);
  let p = 8, idat = [];
  while (p < b.length) {
    const n = dv.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    assert.equal(dv.getUint32(p + 8 + n), crc32(b.subarray(p + 4, p + 8 + n)), type + ' crc');
    if (type === 'IHDR') assert.deepEqual([dv.getUint32(p + 8), dv.getUint32(p + 12), b[p + 16], b[p + 17]], [w, h, 8, 6]);
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n));
    p += 12 + n;
  }
  const rows = inflateSync(Buffer.concat(idat));
  const back = [];
  for (let y = 0; y < h; y++) { assert.equal(rows[y * (w * 4 + 1)], 0); back.push(...rows.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))); }
  assert.deepEqual(back, [...px]);
});
