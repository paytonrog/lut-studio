// The decal sheet editor: the emblems / numbers / markings atlas a model's decals are cut from. Select an area
// (drag; snapped to a grid, or free), place an image in it: it stays a layer to move (drag), scale (corner handle,
// wheel) and rotate until applied; erase an area; undo / redo; the model shows the edit as you go, and can highlight
// the selected area. Saved per variant as the whole sheet (PUT /api/sheet, server/decals.go); the build writes it as
// the game's texture. Sheets are shared by several items: every item using one changes.

import { $, esc, openSide, closeSide, drawWire, fetchRaw, lstx, pngBlob, straightPixels, saveFile, pickFile, throttled } from './texedit.js';

// R: the renderer (its pieces' decal sheets, previewTexture, refreshDecals); variant: the variant folder; only: one
// sheet hash
export async function decalDialog(R, variant, only = null) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const hashes = only ? [only] : [...new Set(R.pieces.map(p => p.decalHash).filter(Boolean))];
  if (!hashes.length) return;
  const q = h => `/api/sheet?hash=${h}&variant=${encodeURIComponent(variant)}`;
  const close = openSide(`<h3>Decals</h3>
    <p class="hint">The decal sheet holds the emblems, numbers and markings the model shows. Select an area (drag), then
      place your image in it: move it (drag), scale it (corner or mouse wheel) and turn it, then <b>Apply</b>. The
      model shows your edit as you go. Saved for this variant (${esc(variant)}); the mod replaces the sheet for
      everything that uses it, as sheets are shared by several items.</p>
    <div class="row">${hashes.length > 1 ? `<label>Sheet <select id="dsSheet">${hashes.map((h, i) => `<option value="${h}">${i + 1}: ${h}</option>`).join('')}</select></label>` : ''}
      <label>Grid <select id="dsGrid"><option value="0">none</option><option>2</option><option selected>4</option><option>8</option><option>16</option></select></label>
      <label>Zoom <select id="dsZoom"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
      <label class="check"><input type="checkbox" id="dsWire"> model layout</label>
      <label class="check"><input type="checkbox" id="dsMark"> highlight the area on the model</label></div>
    <div class="row"><button id="dsImage">Place an image…</button>
      <label class="check"><input type="checkbox" id="dsClear" checked> clear the area first</label>
      <button id="dsErase">Erase area</button>
      <button id="dsUndo" title="Ctrl+Z">Undo</button><button id="dsRedo" title="Ctrl+Y">Redo</button></div>
    <div class="row" id="dsLayer" hidden><label>Turn <input type="range" id="dsRot" min="-180" max="180" step="1" value="0"></label>
      <label>Size <input type="range" id="dsSize" min="-4" max="2" step="0.01" value="0"></label>
      <button id="dsFlip">Flip</button><button id="dsApply" class="primary">Apply</button><button id="dsCancel">Cancel</button></div>
    <div id="dsScroll"><canvas id="dsView" width="512" height="512"></canvas></div>
    <div class="row"><button id="dsSave" class="primary" disabled>Save</button><button id="dsReset">Back to the game's sheet</button>
      <button id="dsExport">Export PNG</button><button id="dsImport">Import PNG…</button></div>
    <p class="hint" id="dsInfo"></p>`, async () => {
    if ((dirty || layer) && !confirm('Close without saving your changes to this sheet?')) return false;
    await R.refreshDecals(hash);
  }, null, 'decals');
  close.isDirty = () => dirty || !!layer;   // (unsaved changes: the tab's close asks first)
  const view = $('dsView'), vg = view.getContext('2d');
  // the sheet: its pixels (RGBA8, straight alpha) are what is edited and saved, never a canvas' (a 2D canvas keeps
  // them premultiplied: the colors under low alpha would be lost, fringes in the game's filtering); shown: a canvas
  // of them, only to draw the view
  let hash = hashes[0], W = 0, H = 0, px = null, sel = null, drag = null, dirty = false, layer = null;
  const shown = document.createElement('canvas');
  const undos = [], redos = [];
  const info = t => { $('dsInfo').textContent = t; };
  const k = () => view.width / W;                       // sheet px -> view px (the view has the sheet's shape)
  const fit = () => { view.width = 512 * +$('dsZoom').value; view.height = Math.max(1, Math.round(view.width * H / W)); };
  const reshow = () => { shown.width = W; shown.height = H; shown.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0); };

  // ---- drawing
  const layerBox = () => {                              // the layer's corners in sheet px
    const w = layer.img.width * layer.s / 2, h = layer.img.height * layer.s / 2, a = layer.rot * Math.PI / 180;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [layer.cx + x * Math.cos(a) - y * Math.sin(a), layer.cy + x * Math.sin(a) + y * Math.cos(a)]);
  };
  const drawLayer = (g, kk) => {
    g.save();
    g.translate(layer.cx * kk, layer.cy * kk);
    g.rotate(layer.rot * Math.PI / 180);
    g.scale(layer.s * kk * (layer.flip ? -1 : 1), layer.s * kk);
    g.imageSmoothingQuality = 'high';
    g.drawImage(layer.img, -layer.img.width / 2, -layer.img.height / 2);
    g.restore();
  };
  const draw = () => {
    const s = view.width, sh = view.height;
    vg.clearRect(0, 0, s, sh);
    if (!px) return;
    vg.drawImage(shown, 0, 0, s, sh);
    if (layer) {
      if ($('dsClear').checked && sel) vg.clearRect(sel.x * k(), sel.y * k(), sel.w * k(), sel.h * k());
      drawLayer(vg, k());
    }
    const n = +$('dsGrid').value;
    vg.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 1; i < n; i++) {
      vg.beginPath();
      vg.moveTo(i * s / n, 0); vg.lineTo(i * s / n, sh);
      vg.moveTo(0, i * sh / n); vg.lineTo(s, i * sh / n);
      vg.stroke();
    }
    if ($('dsWire').checked) { vg.save(); vg.scale(1, sh / s); drawWire(vg, R.pieces.filter(p => p.decalHash === hash && p.kind !== 'cape'), 'uv2', s); vg.restore(); }
    if (sel) {
      vg.strokeStyle = '#f2c14e'; vg.lineWidth = 2;
      vg.strokeRect(sel.x * k(), sel.y * k(), sel.w * k(), sel.h * k());
      vg.lineWidth = 1;
    }
    if (layer) {
      const c = layerBox().map(([x, y]) => [x * k(), y * k()]);
      vg.strokeStyle = '#7fd4ff'; vg.setLineDash([5, 4]);
      vg.beginPath(); c.forEach(([x, y], i) => (i ? vg.lineTo(x, y) : vg.moveTo(x, y))); vg.closePath(); vg.stroke();
      vg.setLineDash([]); vg.fillStyle = '#7fd4ff';
      vg.fillRect(c[2][0] - 5, c[2][1] - 5, 10, 10);  // the scale handle
    }
  };

  // ---- the model: the sheet with the unapplied layer (and the highlighted area), shown before saving
  // a rectangle of the sheet (whole pixels, inside it), or null when empty
  const clip = r => {
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
    return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
  };
  const fill = (dst, r, rgba) => {
    if (!(r = clip(r))) return;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) dst.set(rgba, (y * W + x) * 4);
  };
  const layerRect = () => {
    const pts = layerBox(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return clip({ x: Math.min(...xs) - 2, y: Math.min(...ys) - 2, w: Math.max(...xs) - Math.min(...xs) + 4, h: Math.max(...ys) - Math.min(...ys) + 4 });
  };
  // the layer drawn over dst (straight alpha, "over"): where it is transparent the sheet's pixels stay exactly
  const putLayer = dst => {
    const r = layerRect();
    if (!r) return;
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(-r.x, -r.y); drawLayer(g, 1);
    const src = g.getImageData(0, 0, r.w, r.h).data;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const s = (y * r.w + x) * 4, la = src[s + 3] / 255;
      if (!la) continue;
      const d = ((r.y + y) * W + r.x + x) * 4, da = dst[d + 3] / 255, oa = la + da * (1 - la);
      for (let ch = 0; ch < 3; ch++) dst[d + ch] = (src[s + ch] * la + dst[d + ch] * da * (1 - la)) / oa;
      dst[d + 3] = oa * 255;
    }
  };
  const composed = () => {
    const out = px.slice();
    if (layer) { if ($('dsClear').checked && sel) fill(out, sel, [0, 0, 0, 0]); putLayer(out); }
    return out;
  };
  const preview = throttled(() => {
    if (!px) return;
    const out = composed();
    if ($('dsMark').checked && sel) fill(out, sel, [255, 0, 255, 255]);
    R.previewTexture(hash, W, H, new Uint8Array(out.buffer));
  });

  // ---- undo: the changed rectangle before and after
  // undo: the changed rectangle's pixels before
  const take = r => {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) out.set(px.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
    return out;
  };
  const give = (r, data) => { for (let y = 0; y < r.h; y++) px.set(data.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * W + r.x) * 4); };
  const record = r => {
    if (!(r = clip(r))) return;
    undos.push({ r, data: take(r) });
    if (undos.length > 40) undos.shift();
    redos.length = 0;
  };
  const step = (from, to) => {
    const u = from.pop();
    if (!u) return;
    to.push({ r: u.r, data: take(u.r) });
    give(u.r, u.data);
    changed();
  };
  const changed = () => { dirty = true; $('dsSave').disabled = false; reshow(); draw(); preview(); };
  $('modal').addEventListener('texundo', () => step(undos, redos), { signal: close.signal });
  $('modal').addEventListener('texredo', () => step(redos, undos), { signal: close.signal });
  $('dsUndo').onclick = () => step(undos, redos);
  $('dsRedo').onclick = () => step(redos, undos);

  let loadGen = 0;   // (a newer load wins: an older one's pixels never land under the newer hash)
  const load = async () => {
    const gen = ++loadGen;
    info('Loading the sheet…'); sel = null; layer = null; dirty = false; undos.length = redos.length = 0;
    $('dsSave').disabled = true; $('dsLayer').hidden = true;
    let t;
    try { t = await fetchRaw(hash, variant); } catch (e) { if (gen === loadGen) info(e.message); return; }
    if (gen !== loadGen) return;
    W = t.w; H = t.h * t.layers; px = t.px;
    fit(); reshow();
    info(`${W} × ${H} · ${t.edited ? 'edited in this variant' : "the game's sheet"}`);
    draw();
  };

  // ---- pointer: select an area, or move / scale the layer
  const at = e => {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  };
  const snapSel = (x0, y0, x1, y1) => {
    let ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const n = +$('dsGrid').value;
    if (n) {
      const cx = W / n, cy = H / n;
      ax = Math.floor(ax / cx) * cx; bx = Math.ceil(Math.max(bx, ax + 1) / cx) * cx;
      ay = Math.floor(ay / cy) * cy; by = Math.ceil(Math.max(by, ay + 1) / cy) * cy;
    }
    return { x: Math.round(ax), y: Math.round(ay), w: Math.max(1, Math.round(bx - ax)), h: Math.max(1, Math.round(by - ay)) };
  };
  const inside = ([x, y]) => {                          // a point inside the layer's (turned) box
    const a = -layer.rot * Math.PI / 180, dx = x - layer.cx, dy = y - layer.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= layer.img.width * layer.s / 2 && Math.abs(ly) <= layer.img.height * layer.s / 2;
  };
  const sizeSlider = () => { $('dsSize').value = Math.log2(layer.s / layer.s0); };
  view.onpointerdown = e => {
    if (!px) return;
    const p = at(e);
    view.setPointerCapture(e.pointerId);
    if (layer) {
      const h = layerBox()[2];
      if (Math.hypot(p[0] - h[0], p[1] - h[1]) < 10 / k()) drag = { kind: 'scale', d0: Math.hypot(p[0] - layer.cx, p[1] - layer.cy), s0: layer.s };
      else if (inside(p)) drag = { kind: 'move', p, c0: [layer.cx, layer.cy] };
      return;
    }
    drag = { kind: 'select', p }; sel = snapSel(...p, ...p); draw();
  };
  view.onpointermove = e => {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === 'select') sel = snapSel(...drag.p, ...p);
    else if (drag.kind === 'move') { layer.cx = drag.c0[0] + p[0] - drag.p[0]; layer.cy = drag.c0[1] + p[1] - drag.p[1]; }
    else { layer.s = Math.max(0.01, drag.s0 * Math.hypot(p[0] - layer.cx, p[1] - layer.cy) / Math.max(1, drag.d0)); sizeSlider(); }
    draw();
  };
  view.onpointerup = () => {
    if (drag?.kind === 'select' && sel) info(`Area ${sel.w} × ${sel.h} at ${sel.x}, ${sel.y}`);
    if (drag) preview();
    drag = null;
  };
  view.onwheel = e => {
    if (!layer) return;
    e.preventDefault();
    layer.s = Math.max(0.01, layer.s * Math.pow(1.1, -Math.sign(e.deltaY)));
    sizeSlider(); draw(); preview();
  };
  $('dsGrid').onchange = draw;
  $('dsWire').onchange = draw;
  $('dsMark').onchange = preview;
  $('dsClear').onchange = () => { draw(); preview(); };
  $('dsZoom').onchange = () => { if (px) fit(); draw(); };
  if ($('dsSheet')) $('dsSheet').onchange = async () => {
    if ((dirty || layer) && !confirm('Discard the unsaved changes to this sheet?')) { $('dsSheet').value = hash; return; }
    await R.refreshDecals(hash);
    hash = $('dsSheet').value;
    await load();
  };

  // ---- the layer
  $('dsImage').onclick = async () => {
    if (!sel) return info('Select an area first (drag on the sheet).');
    const f = await pickFile('image/*');
    if (!f) return;
    const img = await createImageBitmap(f).catch(() => null);
    if (!img) return info('That file is not an image.');
    const s = Math.min(sel.w / img.width, sel.h / img.height);
    layer = { img, cx: sel.x + sel.w / 2, cy: sel.y + sel.h / 2, s, s0: s, rot: 0, flip: false };
    $('dsRot').value = 0; $('dsSize').value = 0; $('dsLayer').hidden = false;
    info('Drag the image to move it, its corner (or the mouse wheel) to scale it; Apply when it sits right.');
    draw(); preview();
  };
  $('dsRot').oninput = () => { if (layer) { layer.rot = +$('dsRot').value; draw(); preview(); } };
  $('dsSize').oninput = () => { if (layer) { layer.s = layer.s0 * Math.pow(2, +$('dsSize').value); draw(); preview(); } };
  $('dsFlip').onclick = () => { if (layer) { layer.flip = !layer.flip; draw(); preview(); } };
  $('dsCancel').onclick = () => { layer = null; $('dsLayer').hidden = true; draw(); preview(); };
  $('dsApply').onclick = () => {
    if (!layer) return;
    let r = layerRect() ?? sel;
    const clear = $('dsClear').checked && sel;
    if (clear && r) { const x = Math.min(r.x, sel.x), y = Math.min(r.y, sel.y); r = { x, y, w: Math.max(r.x + r.w, sel.x + sel.w) - x, h: Math.max(r.y + r.h, sel.y + sel.h) - y }; }
    if (r) record(r);
    if (clear) fill(px, sel, [0, 0, 0, 0]);
    putLayer(px);
    layer = null; $('dsLayer').hidden = true;
    changed();
  };
  $('dsErase').onclick = () => {
    if (!sel) return info('Select an area first.');
    record(sel);
    fill(px, sel, [0, 0, 0, 0]);
    changed();
  };

  // ---- files
  $('dsExport').onclick = async () => px && saveFile(await pngBlob(W, H, px), `decal-sheet-${hash}.png`);
  $('dsImport').onclick = async () => {
    const f = await pickFile('image/png,image/*');
    if (!f || !px) return;
    const img = await straightPixels(f);   // (its pixels as they are: an exported sheet comes back exactly)
    if (!img) return info('That file is not an image.');
    let pixels = img.px;
    if (img.w !== W || img.h !== H) {
      if (!confirm(`The image is ${img.w} × ${img.h}, the sheet ${W} × ${H}: stretch it to fit?`)) return;
      const bmp = await createImageBitmap(f);   // (resampled anyway: through a canvas)
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, W, H);
      pixels = g.getImageData(0, 0, W, H).data;
    }
    record({ x: 0, y: 0, w: W, h: H });
    px.set(pixels);
    changed();
  };

  // ---- saving
  $('dsSave').onclick = async () => {
    if (layer) $('dsApply').onclick();
    info('Saving…');
    const body = lstx(W, H, px);   // (the pixels as they are: no canvas)
    dirty = false;   // (an edit made while it saves sets it again: not taken for saved)
    const r = await fetch(q(hash), { method: 'PUT', body });
    if (!r.ok) { dirty = true; return info(await r.text()); }
    $('dsSave').disabled = !dirty;
    await R.refreshDecals(hash);
    if ($('dsMark').checked) preview();
    info('Saved: the next build includes it.');
  };
  $('dsReset').onclick = async () => {
    if (!confirm("Go back to the game's sheet for this variant? Your changes to it are deleted.")) return;
    await fetch(q(hash), { method: 'DELETE' });
    await R.refreshDecals(hash);
    await load();
  };
  await load();
  return close;
}
