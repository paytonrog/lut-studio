// The mask editor: where each zone (row of the part's material LUT) is on a part (its ID mask), and where its pattern
// shows (its pattern mask: the pattern LUT's color, on the R of the layer that LUT picks, >= 0.5). A part's id_masks_array has 1-2
// layers of 4 channels; a channel >= 0.496 puts the pixel in zone layer * 4 + channel (the first such channel of a
// layer; a later layer overrides an earlier one). Each channel is a distance field like a cape design (0.5 on the
// edge, ~16 per UV unit). Paint zones on the model itself (the mask editor's paint mode turns the view's left drag
// into a brush) or on the flat UV view; the edited channels' fields are rebuilt near the edit, the rest keeps the
// game's bytes. A left / right pair of parts shares one mask: both sides change. Saved per variant (PUT
// /api/sheet?kind=mask | pattern, the layers stacked top to bottom); the build writes the game's texture (texenc).

import { $, esc, openSide, closeSide, History, drawWire, fetchRaw, lstx, saveFile, pickFile, throttled, edt } from './texedit.js';

const K = 16.5;                                          // the fields' slope: value per UV unit (as the game's masks)

// app: { R, variant, startLut: the selected LUT, zoneColors(lut) -> [[r, g, b] 0..1 per zone], zoneLabel(lut, z),
// lutLabel(lut), patternInfo(patternLut) -> {on, layer, color} | null, setPaint(handler | null): the view's pointer
// while painting, pickUV(event) -> {piece, u, v} | null }
export async function maskDialog(app) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const R = app.R;
  // the masks on screen, per kind: one entry per mask texture, with the parts (and their LUTs) using it
  const build = (field, kind) => {
    const masks = new Map();
    for (const p of R.pieces) {
      const h = p[field];
      if (!h) continue;
      if (!masks.has(h)) masks.set(h, { hash: h, kind, pieces: [], lut: p.info.lut, pattern: p.info.pattern });
      masks.get(h).pieces.push(p);
    }
    const list = [...masks.values()], seen = {};
    // a mask's name: the kind of its parts' LUT (armor, undersuit…) and the parts ("Armor: left arm, right arm")
    for (const m of list) {
      const slots = [...new Set(m.pieces.map(p => (p.info.slot || p.name || '').replace(/_/g, ' ')))].join(', ') || m.hash;
      let n = `${app.lutLabel?.(m.lut) ?? 'Part'}: ${slots}`;
      seen[n] = (seen[n] ?? 0) + 1;
      m.name = seen[n] > 1 ? `${n} (${seen[n]})` : n;
    }
    return list;
  };
  const lists = { zones: build('idMaskHash', 'zones'), pattern: build('patMaskHash', 'pattern') };
  if (!lists.zones.length && !lists.pattern.length) return;
  let kind = app.startKind === 'pattern' && lists.pattern.length || !lists.zones.length ? 'pattern' : 'zones';
  let list = lists[kind];
  const label = m => m.name;
  let cur = list.find(m => m.lut === app.startLut) ?? list[0];
  const close = openSide(`<h3>Masks</h3>
    <p class="hint">Where each zone of a part is, and where its pattern shows: paint on the model or on the flat view.
      Zone colors are the part's LUT colors, the pattern's its pattern LUT's. A left and right pair of parts share one
      mask, so both sides change. Saved for this variant (${esc(app.variant)}).</p>
    <div class="row"><label>Edit <select id="mkKind"><option value="zones" ${lists.zones.length ? '' : 'disabled'}>zones (ID mask)</option>
      <option value="pattern" ${lists.pattern.length ? '' : 'disabled'}>pattern areas (pattern mask)${lists.pattern.length ? '' : ': no part on screen has one'}</option></select></label>
      <label>Part <select id="mkPart"></select></label></div>
    <p class="warn" id="mkWarn" hidden></p>
    <div class="row" id="mkZones"></div>
    <div class="row"><label>Brush <input type="range" id="mkSize" min="1" max="48" value="6"></label>
      <label class="check"><input type="checkbox" id="mkFill"> fill an area</label>
      <label class="check"><input type="checkbox" id="mkPaint3d" checked> paint on the model</label>
      <label class="check"><input type="checkbox" id="mkWire" checked> model layout</label>
      <button id="mkUndo" title="Ctrl+Z">Undo</button><button id="mkRedo" title="Ctrl+Y">Redo</button></div>
    <p class="hint">On the model: left drag paints (or fills), right drag turns the view, the wheel zooms.</p>
    <div id="dsScroll"><canvas id="mkView" width="512" height="512"></canvas></div>
    <div class="row"><button id="mkSave" class="primary" disabled>Save</button><button id="mkReset">Back to the game's mask</button>
      <button id="mkTemplate">Export picture</button><button id="mkPicture">Import a picture…</button></div>
    <p class="hint" id="mkInfo"></p>`, async () => {
    if (dirty && !confirm('Close without saving your changes to the mask?')) return false;
    app.setPaint(null);
    await R.refreshDecals(cur.hash);
  }, null, 'masksBtn');
  close.isDirty = () => dirty;   // (unsaved changes: the tab's close asks first)
  const info = t => { $('mkInfo').textContent = t; };
  const view = $('mkView'), vg = view.getContext('2d');
  let orig, W, H, L, N, masks2, touched, dirty = false, zoneSel = 0, colors = [], rows = 1, stroke = null, pl = 0;
  const q = () => `/api/sheet?hash=${cur.hash}&variant=${encodeURIComponent(app.variant)}&kind=${kind === 'pattern' ? 'pattern' : 'mask'}`;

  // ---- the zones: masks2[l * 4 + c][i] on / off; touched: changed here
  const zoneAt = i => {
    if (kind === 'pattern') return masks2[pl * 4][i];   // 1: the pattern shows
    let z = 0;
    for (let l = 0; l < L; l++) for (let c = 0; c < 4; c++) if (masks2[l * 4 + c][i]) { z = l * 4 + c; break; }
    return Math.min(z, rows - 1);
  };
  const set = (k, i, v) => { if (masks2[k][i] !== v) { masks2[k][i] = v; touched[k][i] = 1; } };
  // zone z at pixel i: its channel on, the ones before it in its layer off, every later layer off
  const apply = (z, i) => {
    if (kind === 'pattern') return set(pl * 4, i, z);
    const l = z >> 2, c = z & 3;
    set(l * 4 + c, i, 1);
    for (let k = 0; k < c; k++) set(l * 4 + k, i, 0);
    for (let l2 = l + 1; l2 < L; l2++) for (let k = 0; k < 4; k++) set(l2 * 4 + k, i, 0);
  };
  const hist = new History(() => ({ m: masks2.map(m => m.slice()), t: touched.map(t => t.slice()) }), s => { masks2 = s.m; touched = s.t; changed(); });
  const histLimit = () => { hist.limit = Math.max(3, Math.min(30, Math.floor((256 << 20) / Math.max(1, 2 * masks2.length * N)))); };   // (~256 MB of steps)

  const zoneName = z => kind === 'pattern' ? ['no pattern', 'pattern'][z] : app.zoneLabel(cur.lut, z);
  const zoneButtons = () => {
    const n = kind === 'pattern' ? 2 : Math.min(rows, L * 4);
    const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
    $('mkZones').innerHTML = Array.from({ length: n }, (_, z) => `<button class="dzTool${z === zoneSel ? ' on' : ''}" data-z="${z}" title="${esc(zoneName(z))}">
      <span class="swatch" style="background:${hex(colors[z] ?? [0.5, 0.5, 0.5])}"></span>${esc(zoneName(z))}</button>`).join('') +
      (kind === 'zones' && rows > L * 4 ? `<span class="hint">(zones past ${L * 4 - 1} need a third mask layer)</span>` : '');
    document.querySelectorAll('#mkZones .dzTool').forEach(b => (b.onclick = () => { zoneSel = +b.dataset.z; zoneButtons(); }));
  };

  let loadGen = 0;
  const load = async () => {
    const gen = ++loadGen;
    info('Loading the mask…');
    const got = await fetchRaw(cur.hash, app.variant);
    if (gen !== loadGen) return;   // (a newer part or kind picked meanwhile)
    orig = got;
    W = orig.w; H = orig.h; L = orig.layers; N = W * H;
    masks2 = []; touched = [];
    const on = kind === 'pattern' ? 128 : 127;   // (the pattern: R >= 0.5; a zone: a channel >= 0.496)
    for (let l = 0; l < L; l++) for (let c = 0; c < 4; c++) {
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = orig.px[(l * N + i) * 4 + c] >= on ? 1 : 0;
      masks2.push(m); touched.push(new Uint8Array(N));
    }
    $('mkWarn').hidden = true;
    if (kind === 'pattern') {                     // the layer and color the part's pattern LUT gives
      const pi = cur.pattern ? app.patternInfo(cur.pattern) : null;
      pl = pi?.on ? Math.max(0, Math.floor(pi.layer)) % L : 0;
      colors = [[0.35, 0.35, 0.35], pi?.color ?? [1, 0.8, 0.2]]; rows = 2;
      if (!pi?.on) {
        $('mkWarn').hidden = false;
        $('mkWarn').textContent = `The pattern is switched off on this part (its pattern LUT ${cur.pattern ?? '(none)'} is the game's "off" LUT or isn't in the project): changes here won't show until a pattern LUT that's on is used.`;
      }
    } else { colors = app.zoneColors(cur.lut); rows = Math.max(1, colors.length); }
    zoneSel = Math.min(zoneSel, (kind === 'pattern' ? 2 : Math.min(rows, L * 4)) - 1);
    dirty = false; $('mkSave').disabled = true; hist.clear(); histLimit();
    view.width = 512; view.height = Math.round(512 * H / W);
    zoneButtons();
    info(`${W} × ${H}, ${L} layer(s)${kind === 'pattern' ? `, the pattern on layer ${pl}` : ''} · ${orig.edited ? 'edited in this variant' : "the game's mask"} · used by: ${label(cur)}`);
    draw();
  };

  // ---- the flat view: zones in their LUT colors, the parts' UV layout over it
  const draw = () => {
    const img = new ImageData(W, H), d = img.data;
    const cols = colors.map(c => c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)));
    for (let i = 0; i < N; i++) { const c = cols[zoneAt(i)] ?? [128, 128, 128]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0);
    vg.imageSmoothingEnabled = false;
    vg.drawImage(tmp, 0, 0, view.width, view.height);
    if ($('mkWire').checked) drawWire(vg, cur.pieces, 'uv0', view.width, 'rgba(255,255,255,0.25)');
  };

  // ---- the texture: the edited channels' fields rebuilt near the edits
  const compose = () => {
    const px = orig.px.slice(), S = Math.max(W, H), reach = Math.ceil(S / (2 * K)) + 2;
    for (let k = 0; k < L * 4; k++) {
      if (!touched[k].some(v => v)) continue;
      const l = k >> 2, c = k & 3, m = masks2[k];
      const dIn = edt(m.map(v => 1 - v), W, H), dOut = edt(m, W, H), near = edt(touched[k], W, H);
      for (let i = 0; i < N; i++) {
        if (near[i] > reach * reach) continue;
        const sd = m[i] ? Math.sqrt(dIn[i]) - 0.5 : 0.5 - Math.sqrt(dOut[i]);
        px[(l * N + i) * 4 + c] = Math.round(Math.min(1, Math.max(0, 0.5 + K * sd / S)) * 255);
      }
    }
    return px;
  };
  const preview = throttled(() => R.previewTexture(cur.hash, W, H, new Uint8Array(compose().buffer), L));
  const changed = () => { dirty = true; $('mkSave').disabled = false; draw(); preview(); };
  $('modal').addEventListener('texundo', () => hist.undo(), { signal: close.signal });
  $('modal').addEventListener('texredo', () => hist.redo(), { signal: close.signal });
  $('mkUndo').onclick = () => hist.undo();
  $('mkRedo').onclick = () => hist.redo();

  // ---- painting: a dab or a fill at texture pixel (x, y)
  const dab = (x, y) => {
    const r = Math.max(0.5, +$('mkSize').value / 2 * W / 256);
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      apply(zoneSel, yy * W + xx);
    }
  };
  const fill = (x, y) => {              // the connected area (in the texture) of the zone at (x, y)
    const i0 = y * W + x, before = masks2.map(m => m.slice());
    // (a zone as the mask reads it; the pattern: on or off in its layer)
    const zb = kind === 'pattern' ? i => before[pl * 4][i]
      : i => { let z = 0; for (let l = 0; l < L; l++) for (let c = 0; c < 4; c++) if (before[l * 4 + c][i]) { z = l * 4 + c; break; } return z; };   // (later layers override, as the shader reads it)
    const z0 = zb(i0), seen = new Uint8Array(N), stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(), xi = i % W;
      apply(zoneSel, i);
      for (const j of [xi > 0 ? i - 1 : -1, xi < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || seen[j]) continue;
        seen[j] = 1;
        if (zb(j) === z0) stack.push(j);
      }
    }
  };
  const begin = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    hist.push();
    if ($('mkFill').checked) { fill(x, y); changed(); return false; }
    stroke = [x, y]; dab(x, y); dirty = true; draw(); preview();
    return true;
  };
  const extend = (x, y, onModel = false) => {
    const [x0, y0] = stroke, n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0)));
    // (a jump across UV islands on the model: no line between them)
    if (onModel && n > W / 8) { dab(x, y); } else for (let s = 1; s <= n; s++) dab(x0 + (x - x0) * s / n, y0 + (y - y0) * s / n);
    stroke = [x, y]; draw(); preview();
  };
  const end = () => { if (stroke) { stroke = null; changed(); } };
  // the flat view
  const at = e => { const r = view.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)]; };
  view.onpointerdown = e => { if (masks2 && begin(...at(e))) view.setPointerCapture(e.pointerId); };
  view.onpointermove = e => { if (stroke) extend(...at(e)); };
  view.onpointerup = end;
  // on the model: only where a part using this mask is under the pointer
  const onModel = e => {
    const hit = app.pickUV(e);
    if (!hit || R.pieces[hit.piece]?.[kind === 'pattern' ? 'patMaskHash' : 'idMaskHash'] !== cur.hash) return null;
    return [Math.min(W - 1, Math.floor(hit.u * W)), Math.min(H - 1, Math.floor(hit.v * H))];
  };
  const paint3d = {
    down: e => { const p = onModel(e); return p ? begin(...p) : false; },
    move: e => { if (!stroke) return; const p = onModel(e); if (p) extend(...p, true); },
    up: end,
  };
  const paintMode = () => app.setPaint($('mkPaint3d').checked ? paint3d : null);
  $('mkPaint3d').onchange = paintMode;
  $('mkWire').onchange = draw;
  const fillParts = () => { $('mkPart').innerHTML = list.map((m, i) => `<option value="${i}">${esc(label(m))}</option>`).join(''); $('mkPart').value = list.indexOf(cur); };
  $('mkPart').onchange = async () => {
    if (dirty && !confirm('Discard the unsaved changes to this mask?')) { $('mkPart').value = list.indexOf(cur); return; }
    await R.refreshDecals(cur.hash);
    cur = list[+$('mkPart').value];
    await load();
  };
  $('mkKind').onchange = async () => {
    if (dirty && !confirm('Discard the unsaved changes to this mask?')) { $('mkKind').value = kind; return; }
    await R.refreshDecals(cur.hash);
    kind = $('mkKind').value; list = lists[kind]; zoneSel = kind === 'pattern' ? 1 : 0;
    cur = list.find(m => m.lut === app.startLut) ?? list[0];
    fillParts();
    await load();
  };

  // ---- pictures: the zones in their colors (and back)
  $('mkTemplate').onclick = () => {
    if (!masks2) return;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = new ImageData(W, H);
    const cols = colors.map(c => c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)));
    for (let i = 0; i < N; i++) img.data.set([...(cols[zoneAt(i)] ?? [128, 128, 128]), 255], i * 4);
    g.putImageData(img, 0, 0);
    drawWire(g, cur.pieces, 'uv0', W, 'rgba(255,255,255,0.4)');
    c.toBlob(b => saveFile(b, `${kind === 'pattern' ? 'pattern' : 'id'}-mask-${cur.hash}.png`), 'image/png');
    info('Picture saved: paint over it with the zone colors (the lines are only a guide), then import it.');
  };
  $('mkPicture').onclick = async () => {
    if (!masks2) return;
    const f = await pickFile('image/*');
    if (!f) return;
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) return info('That file is not an image.');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data, n = Math.min(rows, L * 4);
    const cols = colors.slice(0, n).map(c => c.map(v => Math.min(1, Math.max(0, v)) * 255));
    hist.push();
    for (let i = 0; i < N; i++) {      // each pixel: the zone of the nearest zone color (transparent: left as is)
      if (px[i * 4 + 3] < 128) continue;
      let best = 0, bd = Infinity;
      cols.forEach((cc, z) => { const dd = (px[i * 4] - cc[0]) ** 2 + (px[i * 4 + 1] - cc[1]) ** 2 + (px[i * 4 + 2] - cc[2]) ** 2; if (dd < bd) { bd = dd; best = z; } });
      if (best !== zoneAt(i)) apply(best, i);
    }
    changed();
    info('Picture applied: each pixel took the zone whose color is nearest.');
  };

  // ---- saving
  $('mkSave').onclick = async () => {
    info('Saving…');
    const body = lstx(W, H * L, compose());
    dirty = false;   // (an edit made while it saves sets it again)
    const r = await fetch(q(), { method: 'PUT', body });
    if (!r.ok) { dirty = true; return info(await r.text()); }
    $('mkSave').disabled = !dirty;
    await R.refreshDecals(cur.hash);
    info('Saved: the next build includes it.');
  };
  $('mkReset').onclick = async () => {
    if (!confirm("Go back to the game's mask for this variant? Your changes to it are deleted.")) return;
    await fetch(q(), { method: 'DELETE' });
    await R.refreshDecals(cur.hash);
    await load();
  };
  $('mkKind').value = kind;
  if (kind === 'pattern') zoneSel = 1;
  fillParts();
  await load().catch(e => info(`This mask can't be edited: ${e.message}`));
  paintMode();
  return close;
}
