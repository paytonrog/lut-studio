// The decal sheet editor: the emblems / numbers / markings atlas a model's decals are cut from. Select an area
// (drag; snapped to a grid, or free), place an image in it: it stays a layer to move (drag), scale (corner handle,
// wheel) and rotate until applied; erase an area; undo / redo; the model shows the edit as you go, and can highlight
// the selected area. Saved per variant as the whole sheet (PUT /api/sheet, server/decals.go); the build writes it as
// the game's texture. Sheets are shared by several items: every item using one changes.

import { $, esc, openSide, closeSide, drawWire, saveFile, pickFile, throttled } from './texedit.js';

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
    if (dirty && !confirm('Close without saving your changes to this sheet?')) return false;
    await R.refreshDecals(hash);
  });
  const view = $('dsView'), vg = view.getContext('2d');
  let hash = hashes[0], full = null, sel = null, drag = null, dirty = false, layer = null;
  const undos = [], redos = [];
  const info = t => { $('dsInfo').textContent = t; };
  const size = () => +view.width;                       // the view's pixels (512 x zoom)
  const k = () => size() / full.width;                  // sheet px -> view px

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
    const s = size();
    vg.clearRect(0, 0, s, s);
    if (!full) return;
    vg.drawImage(full, 0, 0, s, s);
    if (layer) {
      if ($('dsClear').checked && sel) vg.clearRect(sel.x * k(), sel.y * k(), sel.w * k(), sel.h * k());
      drawLayer(vg, k());
    }
    const n = +$('dsGrid').value;
    vg.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 1; i < n; i++) {
      vg.beginPath();
      vg.moveTo(i * s / n, 0); vg.lineTo(i * s / n, s);
      vg.moveTo(0, i * s / n); vg.lineTo(s, i * s / n);
      vg.stroke();
    }
    if ($('dsWire').checked) drawWire(vg, R.pieces.filter(p => p.decalHash === hash && p.kind !== 'cape'), 'uv2', s);
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
  const composed = () => {
    const c = document.createElement('canvas'); c.width = full.width; c.height = full.height;
    const g = c.getContext('2d');
    g.drawImage(full, 0, 0);
    if (layer) { if ($('dsClear').checked && sel) g.clearRect(sel.x, sel.y, sel.w, sel.h); drawLayer(g, 1); }
    return c;
  };
  const preview = throttled(() => {
    if (!full) return;
    const c = composed(), g = c.getContext('2d');
    if ($('dsMark').checked && sel) { g.fillStyle = '#ff00ff'; g.fillRect(sel.x, sel.y, sel.w, sel.h); }
    R.previewTexture(hash, c.width, c.height, new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer));
  });

  // ---- undo: the changed rectangle before and after
  const fg = () => full.getContext('2d', { willReadFrequently: true });
  const record = r => {
    r = { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), w: 0, h: 0, x1: Math.min(full.width, Math.ceil(r.x + r.w)), y1: Math.min(full.height, Math.ceil(r.y + r.h)) };
    r.w = Math.max(1, r.x1 - r.x); r.h = Math.max(1, r.y1 - r.y);
    undos.push({ r, data: fg().getImageData(r.x, r.y, r.w, r.h) });
    if (undos.length > 40) undos.shift();
    redos.length = 0;
  };
  const step = (from, to) => {
    const u = from.pop();
    if (!u) return;
    to.push({ r: u.r, data: fg().getImageData(u.r.x, u.r.y, u.r.w, u.r.h) });
    fg().putImageData(u.data, u.r.x, u.r.y);
    changed();
  };
  const changed = () => { dirty = true; $('dsSave').disabled = false; draw(); preview(); };
  $('modal').addEventListener('texundo', () => step(undos, redos), { signal: close.signal });
  $('modal').addEventListener('texredo', () => step(redos, undos), { signal: close.signal });
  $('dsUndo').onclick = () => step(undos, redos);
  $('dsRedo').onclick = () => step(redos, undos);

  const load = async () => {
    info('Loading the sheet…'); sel = null; layer = null; dirty = false; undos.length = redos.length = 0;
    $('dsSave').disabled = true; $('dsLayer').hidden = true;
    const r = await fetch(q(hash));
    if (!r.ok) { info(await r.text()); return; }
    const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    full = document.createElement('canvas'); full.width = bmp.width; full.height = bmp.height;
    fg().drawImage(bmp, 0, 0);
    const edited = r.headers.get('X-Edited') === '1';
    info(`${bmp.width} × ${bmp.height} · ${edited ? 'edited in this variant' : "the game's sheet"}`);
    draw();
  };

  // ---- pointer: select an area, or move / scale the layer
  const at = e => {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * full.width, (e.clientY - r.top) / r.height * full.height];
  };
  const snapSel = (x0, y0, x1, y1) => {
    let ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const n = +$('dsGrid').value;
    if (n) {
      const cx = full.width / n, cy = full.height / n;
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
    if (!full) return;
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
  $('dsZoom').onchange = () => { view.width = view.height = 512 * +$('dsZoom').value; draw(); };
  if ($('dsSheet')) $('dsSheet').onchange = async () => {
    if (dirty && !confirm('Discard the unsaved changes to this sheet?')) { $('dsSheet').value = hash; return; }
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
    const pts = layerBox(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let r = { x: Math.min(...xs) - 2, y: Math.min(...ys) - 2, w: Math.max(...xs) - Math.min(...xs) + 4, h: Math.max(...ys) - Math.min(...ys) + 4 };
    const clear = $('dsClear').checked && sel;
    if (clear) { const x = Math.min(r.x, sel.x), y = Math.min(r.y, sel.y); r = { x, y, w: Math.max(r.x + r.w, sel.x + sel.w) - x, h: Math.max(r.y + r.h, sel.y + sel.h) - y }; }
    record(r);
    if (clear) fg().clearRect(sel.x, sel.y, sel.w, sel.h);
    drawLayer(fg(), 1);
    layer = null; $('dsLayer').hidden = true;
    changed();
  };
  $('dsErase').onclick = () => {
    if (!sel) return info('Select an area first.');
    record(sel);
    fg().clearRect(sel.x, sel.y, sel.w, sel.h);
    changed();
  };

  // ---- files
  $('dsExport').onclick = () => full && full.toBlob(b => saveFile(b, `decal-sheet-${hash}.png`), 'image/png');
  $('dsImport').onclick = async () => {
    const f = await pickFile('image/png,image/*');
    if (!f || !full) return;
    const img = await createImageBitmap(f, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => null);
    if (!img) return info('That file is not an image.');
    if ((img.width !== full.width || img.height !== full.height) &&
      !confirm(`The image is ${img.width} × ${img.height}, the sheet ${full.width} × ${full.height}: stretch it to fit?`)) return;
    record({ x: 0, y: 0, w: full.width, h: full.height });
    fg().clearRect(0, 0, full.width, full.height);
    fg().drawImage(img, 0, 0, full.width, full.height);
    changed();
  };

  // ---- saving
  $('dsSave').onclick = async () => {
    if (layer) $('dsApply').onclick();
    info('Saving…');
    const png = await new Promise(r => full.toBlob(r, 'image/png'));
    const r = await fetch(q(hash), { method: 'PUT', body: png });
    if (!r.ok) return info(await r.text());
    dirty = false; $('dsSave').disabled = true;
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
