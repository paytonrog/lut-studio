// The cape design editor. A cape's design texture (its piece's decal_scalar_fields, the shader's cape_scalar_fields)
// says where its zones and its cut-out are: R, G, B are zones 1-3 (the first channel >= 0.496 wins; elsewhere zone
// 0), A the cloth (< 0.5: cut out). Each channel is a distance field, 0.5 on the shape's edge, 0.5 + 16.5 x the
// distance in UV units inside (clamped to 0..1): the cape LUT's trim lines are bands of that distance, so they follow
// the shapes. Here the shapes are painted (brush, fill, an imported picture's colors); on each change the edited
// channels' distance fields are rebuilt near the edit (the rest keeps the game's values) and shown on the model.
// Saved per variant as raw RGBA (PUT /api/sheet?kind=design); the build writes the game's texture (texenc).

import { $, esc, openSide, closeSide, History, drawWire, fetchRaw, lstx, saveFile, pickFile, throttled, texUsers, edt } from './texedit.js';

const K = 16.5;                                          // the fields' slope: value per UV unit (measured on the game's)
const NEW_SIZE = 512, PLACEHOLDER = 16 * 16;             // a placeholder design (<= 16 x 16) is replaced by a 512 x 512 one
const ZC = [[128, 128, 128], [224, 64, 64], [64, 192, 64], [64, 96, 224]];   // the editor's zone colors (0-3)
const ZHEX = ZC.map(c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));

// R: the renderer (pieces with scalarHash, previewTexture, refreshDecals); variant: the variant folder
export async function designDialog(R, variant) {
  if (!(await closeSide())) return;   // (the open panel first: its cleanup, its unsaved-changes question)
  const pieces = R.pieces.filter(p => p.scalarHash);
  const hash = pieces[0]?.scalarHash;
  if (!hash) return;
  const q = `/api/sheet?hash=${hash}&variant=${encodeURIComponent(variant)}&kind=design`;
  const tool = (id, label, z) => `<button class="dzTool" data-tool="${id}">${z !== undefined ? `<span class="swatch" style="background:${ZHEX[z]}"></span>` : ''}${label}</button>`;
  const close = openSide(`<h3>Cape design</h3>
    <p class="hint">Where the cape's zones are (their colors, trims and emblems come from the cape's LUTs) and where
      the cloth is cut out. Paint, fill, or import a picture and give each of its colors a zone. The model shows your
      edit as you go; trim lines follow the new shapes. The back of the cape is zone 4, except where zone 1 is.
      Saved for this variant (${esc(variant)}).</p>
    <div class="row">${[0, 1, 2, 3].map(z => tool('z' + z, 'Zone ' + z, z)).join('')}
      ${tool('cut', 'Cut out')}${tool('keep', 'Restore cloth')}</div>
    <div class="row"><label>Brush <input type="range" id="dzSize" min="1" max="64" value="8"></label>
      <label class="check"><input type="checkbox" id="dzFill"> fill an area instead</label>
      <label>Zoom <select id="dzZoom"><option value="1">1×</option><option value="2">2×</option></select></label>
      <label class="check"><input type="checkbox" id="dzWire"> model layout</label>
      <button id="dzUndo" title="Ctrl+Z">Undo</button><button id="dzRedo" title="Ctrl+Y">Redo</button></div>
    <div id="dzPlaceholder" hidden></div>
    <div id="dsScroll"><canvas id="dzView" width="512" height="512"></canvas></div>
    <div id="dzImport" hidden></div>
    <div class="row"><button id="dzSave" class="primary" disabled>Save</button><button id="dzReset">Back to the game's design</button>
      <button id="dzTemplate">Export template</button><button id="dzPicture">Import a picture…</button></div>
    <p class="hint" id="dzInfo"></p>`, async () => {
    if (dirty && !confirm('Close without saving your changes to the design?')) return false;
    await R.refreshDecals(hash);
  }, null, 'design');
  close.isDirty = () => dirty;   // (unsaved changes: the tab's close asks first)
  const info = t => { $('dzInfo').textContent = t; };
  const view = $('dzView'), vg = view.getContext('2d');
  let orig, W, H, N, masks, touched, dirty = false, toolSel = 'z1', stroke = null;

  // ---- the shapes: masks[c][i] (channels R, G, B: zones 1-3; A: cloth), touched[c][i]: changed here
  const load = async () => {
    info('Loading the design…');
    orig = await fetchRaw(hash, variant);
    const users = await texUsers(hash);
    // a placeholder (a few pixels, one zone everywhere): replaced by a whole design, made from its values
    $('dzPlaceholder').hidden = true;
    if (orig.w * orig.h <= PLACEHOLDER) {
      $('dzPlaceholder').hidden = false;
      $('dzPlaceholder').innerHTML = `<p class="warn">This cape has no design of its own: the game gives it a
        ${orig.w} × ${orig.h} placeholder (one zone everywhere)${users.length > 1 ? `, shared by ${esc(users.join(', '))}: a new design shows on all of them` : ''}.</p>
        <div class="row"><button id="dzStart" class="primary">Start a ${NEW_SIZE} × ${NEW_SIZE} design</button></div>`;
      $('dzStart').onclick = () => {
        const avg = [0, 1, 2, 3].map(c => { let s = 0; for (let i = c; i < orig.px.length; i += 4) s += orig.px[i]; return Math.round(s / (orig.px.length / 4)); });
        const px = new Uint8ClampedArray(NEW_SIZE * NEW_SIZE * 4);
        for (let i = 0; i < px.length; i += 4) px.set(avg, i);
        orig = { w: NEW_SIZE, h: NEW_SIZE, px, edited: false };
        $('dzPlaceholder').hidden = true;
        start();
        dirty = true; $('dzSave').disabled = false;
        info(`A new ${NEW_SIZE} × ${NEW_SIZE} design, all as the placeholder was: paint it, then Save.`);
      };
      W = 0; masks = null;
      vg.clearRect(0, 0, view.width, view.height);
      info('');
      return;
    }
    start();
    info(`${W} × ${H} · ${orig.edited ? 'edited in this variant' : "the game's design"}${users.length > 1 ? ` · also on ${users.filter(u => u).length - 1} other item(s): ${users.join(', ')}` : ''}`);
  };
  const start = () => {
    W = orig.w; H = orig.h; N = W * H;
    masks = [0, 1, 2, 3].map(c => { const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = orig.px[i * 4 + c] >= (c < 3 ? 127 : 128) ? 1 : 0; return m; });
    touched = [0, 1, 2, 3].map(() => new Uint8Array(N));
    dirty = false; $('dzSave').disabled = true; hist.clear();
    draw();
  };
  const hist = new History(() => ({ m: masks.map(m => m.slice()), t: touched.map(t => t.slice()) }),
    s => { masks = s.m; touched = s.t; changed(); });
  const zoneAt = i => masks[0][i] ? 1 : masks[1][i] ? 2 : masks[2][i] ? 3 : 0;
  const set = (c, i, v) => { if (masks[c][i] !== v) { masks[c][i] = v; touched[c][i] = 1; } };
  // an action on pixel i: a zone (z0-z3), cut, keep
  const apply = (t, i) => {
    if (t === 'cut') return set(3, i, 0);
    if (t === 'keep') return set(3, i, 1);
    const z = +t[1];
    for (let c = 0; c < 3; c++) if (c < z - 1 || (z === 0 && c < 3)) set(c, i, 0);
    if (z > 0) set(z - 1, i, 1);
  };

  // ---- the view: zones in the editor's colors, cut-out checkered, the model's UV layout
  const draw = () => {
    const img = new ImageData(W, H), d = img.data;
    for (let i = 0; i < N; i++) {
      const c = ZC[zoneAt(i)];
      if (masks[3][i]) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
      else { const x = i % W, y = (i / W) | 0, ch = ((x >> 3) + (y >> 3)) & 1 ? 40 : 60; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = ch; d[i * 4 + 3] = 255; }
    }
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0);
    const s = view.width;
    vg.imageSmoothingEnabled = false;
    vg.drawImage(tmp, 0, 0, s, s);
    if ($('dzWire').checked) drawWire(vg, pieces, 'uv0', s);
  };

  // ---- the texture: rebuilt distance fields near the edits, the game's values elsewhere
  const compose = () => {
    const px = orig.px.slice();
    const reach = Math.ceil(W / (2 * K)) + 2;            // how far a field changes around an edit (px)
    for (let c = 0; c < 4; c++) {
      if (!touched[c].some(v => v)) continue;
      const m = masks[c], notM = m.map(v => 1 - v);
      const dIn = edt(notM, W, H), dOut = edt(m, W, H), near = edt(touched[c], W, H);
      for (let i = 0; i < N; i++) {
        if (near[i] > reach * reach) continue;
        const sd = m[i] ? Math.sqrt(dIn[i]) - 0.5 : 0.5 - Math.sqrt(dOut[i]);
        px[i * 4 + c] = Math.round(Math.min(1, Math.max(0, 0.5 + K * sd / W)) * 255);
      }
    }
    return px;
  };
  const preview = throttled(() => R.previewTexture(hash, W, H, new Uint8Array(compose().buffer)));
  const changed = () => { dirty = true; $('dzSave').disabled = false; draw(); preview(); };
  $('modal').addEventListener('texundo', () => hist.undo(), { signal: close.signal });
  $('modal').addEventListener('texredo', () => hist.redo(), { signal: close.signal });
  $('dzUndo').onclick = () => hist.undo();
  $('dzRedo').onclick = () => hist.redo();

  // ---- tools
  const pickTool = t => { toolSel = t; document.querySelectorAll('.dzTool').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); };
  document.querySelectorAll('.dzTool').forEach(b => (b.onclick = () => pickTool(b.dataset.tool)));
  pickTool('z1');
  const at = e => {
    const r = view.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)];
  };
  const dab = (x, y) => {
    const rad = +$('dzSize').value / 2 * W / 512;
    const r = Math.max(0.5, rad);
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      apply(toolSel, yy * W + xx);
    }
  };
  // the connected area of the same zone and cloth state as (x, y)
  const fill = (x, y) => {
    const i0 = y * W + x, z0 = zoneAt(i0), a0 = masks[3][i0];
    const seen = new Uint8Array(N), stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop();
      apply(toolSel, i);
      const xi = i % W;
      for (const j of [xi > 0 ? i - 1 : -1, xi < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || seen[j]) continue;
        seen[j] = 1;
        // (compared with the state before this fill: apply only changes pixels already visited)
        if (zoneAtBefore(j) === z0 && maskBefore(j) === a0) stack.push(j);
      }
    }
  };
  let before = null;
  const zoneAtBefore = i => before.m[0][i] ? 1 : before.m[1][i] ? 2 : before.m[2][i] ? 3 : 0;
  const maskBefore = i => before.m[3][i];
  view.onpointerdown = e => {
    if (!masks) return;
    const [x, y] = at(e);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    hist.push();
    if ($('dzFill').checked) {
      before = hist.undos[hist.undos.length - 1];
      fill(x, y);
      changed();
      return;
    }
    view.setPointerCapture(e.pointerId);
    stroke = [x, y];
    dab(x, y);
    dirty = true; draw(); preview();
  };
  view.onpointermove = e => {
    if (!stroke) return;
    const [x, y] = at(e), [x0, y0] = stroke;
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0)));
    for (let s = 1; s <= n; s++) dab(x0 + (x - x0) * s / n, y0 + (y - y0) * s / n);
    stroke = [x, y];
    draw(); preview();
  };
  view.onpointerup = () => { if (stroke) { stroke = null; changed(); } };
  $('dzWire').onchange = draw;
  $('dzZoom').onchange = () => { view.width = view.height = 512 * +$('dzZoom').value; draw(); };

  // ---- template and picture
  $('dzTemplate').onclick = () => {
    if (!masks) return info('Start a design first.');
    const c = document.createElement('canvas'); c.width = Math.max(W, 512); c.height = Math.max(H, 512);
    const g = c.getContext('2d'), img = new ImageData(W, H);
    for (let i = 0; i < N; i++) {
      const z = ZC[zoneAt(i)];
      img.data.set([z[0], z[1], z[2], masks[3][i] ? 255 : 0], i * 4);
    }
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, c.width, c.height);
    drawWire(g, pieces, 'uv0', c.width, 'rgba(255,255,255,0.5)');
    c.toBlob(b => saveFile(b, `cape-design-${hash}.png`), 'image/png');
    info(`Template saved: paint over it with these colors (gray zone 0, red 1, green 2, blue 3, transparent cut out; the lines are only a guide), then Import a picture.`);
  };
  $('dzPicture').onclick = async () => {
    if (!masks) return info('Start a design first.');
    const f = await pickFile('image/*');
    if (!f) return;
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) return info('That file is not an image.');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    // its main colors (transparent apart), each given to the nearest zone color, or by how much of the picture it covers
    const counts = new Map();
    for (let i = 0; i < N; i++) {
      const key = px[i * 4 + 3] < 128 ? 'cut' : ((px[i * 4] >> 4) << 8 | (px[i * 4 + 1] >> 4) << 4 | px[i * 4 + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const colors = [...counts.entries()].filter(([k]) => k !== 'cut').sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k]) => [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17]);
    const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    let next = 0;
    const assign = colors.map(col => {
      const z = ZC.findIndex(zc => dist(zc, col) < 40 * 40);
      return z >= 0 ? 'z' + z : 'z' + Math.min(3, next++);
    });
    const opts = sel => [0, 1, 2, 3].map(z => `<option value="z${z}"${sel === 'z' + z ? ' selected' : ''}>zone ${z}</option>`).join('') +
      `<option value="cut"${sel === 'cut' ? ' selected' : ''}>cut out</option><option value="skip"${sel === 'skip' ? ' selected' : ''}>leave as is</option>`;
    const hexOf = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    $('dzImport').hidden = false;
    $('dzImport').innerHTML = `<p class="hint">The picture's colors: give each one a zone (or cut it out). Colors not listed
      go to the nearest one listed.</p>
      ${colors.map((col, i) => `<div class="row"><span class="swatch" style="background:${hexOf(col)}"></span>
        <select data-i="${i}">${opts(assign[i])}</select></div>`).join('')}
      ${counts.has('cut') ? `<div class="row"><span class="swatch" style="background:repeating-conic-gradient(#555 0 25%,#333 0 50%) 0/8px 8px"></span>
        transparent: <select data-i="cut">${opts('cut')}</select></div>` : ''}
      <div class="row"><button id="dzImpApply" class="primary">Apply the picture</button><button id="dzImpCancel">Cancel</button></div>`;
    $('dzImpCancel').onclick = () => { $('dzImport').hidden = true; };
    $('dzImpApply').onclick = () => {
      const pick = i => $('dzImport').querySelector(`select[data-i="${i}"]`)?.value ?? 'skip';
      const choice = colors.map((_, i) => pick(i)), cutChoice = pick('cut');
      hist.push();
      for (let i = 0; i < N; i++) {
        let t;
        if (px[i * 4 + 3] < 128) t = cutChoice;
        else {
          const p = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
          let best = 0;
          for (let k = 1; k < colors.length; k++) if (dist(p, colors[k]) < dist(p, colors[best])) best = k;
          t = choice[best];
        }
        if (t === 'skip') continue;
        if (t !== 'cut') set(3, i, 1);                 // a zone: cloth there
        apply(t, i);
      }
      $('dzImport').hidden = true;
      changed();
    };
  };

  // ---- saving
  $('dzSave').onclick = async () => {
    info('Saving…');
    const body = lstx(W, H, compose());
    dirty = false;   // (an edit made while it saves sets it again)
    const r = await fetch(q, { method: 'PUT', body });
    if (!r.ok) { dirty = true; return info(await r.text()); }
    $('dzSave').disabled = !dirty;
    await R.refreshDecals(hash);
    info('Saved: the next build includes it.');
  };
  $('dzReset').onclick = async () => {
    if (!confirm("Go back to the game's design for this variant? Your changes to it are deleted.")) return;
    await fetch(q, { method: 'DELETE' });
    await R.refreshDecals(hash);
    await load();
  };
  await load().catch(e => info(`This design can't be edited: ${e.message}`));
  return close;
}
