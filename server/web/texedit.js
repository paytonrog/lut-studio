// What the texture editors (decals.js: decal sheets, designs.js: cape designs) share: the side panel they open in
// (the model stays in view and live), an undo stack, the model's UV outline, raw texture transfer and file helpers.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Open the modal as a panel on the left (no backdrop: the model can be turned while editing). onClose() runs when
// it is closed; returning false keeps it open. Returns close(); close.signal ends with the panel (pass it to the
// panel's own listeners: { signal: close.signal }). Open another panel or dialog only after closeSide().
let current = null;   // the open panel's close()
// isDirty(): the panel has unsaved changes (the tab's close asks first: sideDirty)
export function openSide(html, onClose, isDirty = null) {
  const modal = $('modal'), btn = $('modalClose'), prev = current ? null : btn.onclick, ac = new AbortController();
  $('modalBody').innerHTML = html;
  modal.classList.add('side');
  modal.hidden = false;
  const close = async (force = false) => {
    if (!force && (await onClose?.()) === false) return false;
    modal.classList.remove('side');
    modal.hidden = true;
    btn.onclick = prev;
    window.removeEventListener('keydown', keys, true);
    ac.abort();
    if (current === close) current = null;
    return true;
  };
  close.signal = ac.signal;
  close.isDirty = isDirty;
  current = close;
  btn.onclick = () => close();
  // Ctrl+Z / Ctrl+Y in the panel undo its edits, not the LUT edits behind it
  const keys = e => {
    if (!(e.ctrlKey || e.metaKey) || modal.hidden) return;
    const k = e.key.toLowerCase();
    const undo = k === 'z' && !e.shiftKey, redo = k === 'y' || (k === 'z' && e.shiftKey);
    if (!undo && !redo) return;
    e.preventDefault(); e.stopImmediatePropagation();
    modal.dispatchEvent(new CustomEvent(undo ? 'texundo' : 'texredo'));
  };
  window.addEventListener('keydown', keys, true);
  return close;
}

// Close the open side panel, if any, as its Close button does (its own cleanup, its "unsaved changes?" question);
// false: it stays open (the user kept it)
export async function closeSide() {
  return current ? (await current()) !== false : true;
}
// the open side panel has unsaved changes
export function sideDirty() { return !!current?.isDirty?.(); }

// An undo stack of states (whatever take() returns; put(state) restores one), at most limit deep.
export class History {
  constructor(take, put, limit = 30) { Object.assign(this, { take, put, limit, undos: [], redos: [] }); }
  push() { this.undos.push(this.take()); if (this.undos.length > this.limit) this.undos.shift(); this.redos = []; }
  undo() { if (!this.undos.length) return false; this.redos.push(this.take()); this.put(this.undos.pop()); return true; }
  redo() { if (!this.redos.length) return false; this.undos.push(this.take()); this.put(this.redos.pop()); return true; }
  clear() { this.undos = []; this.redos = []; }
}

// The model's triangles in a texture's UV space (which: 'uv0' | 'uv2'), drawn on a canvas context of size s
export function drawWire(g, pieces, which, s, color = 'rgba(120,220,255,0.18)') {
  g.save();
  g.strokeStyle = color; g.lineWidth = 0.6;
  g.beginPath();
  for (const p of pieces) {
    const uv = p.uvWire?.[which];
    if (!uv) continue;
    const idx = p.uvWire.idx;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
      g.moveTo(uv[a] * s, uv[a + 1] * s); g.lineTo(uv[b] * s, uv[b + 1] * s); g.lineTo(uv[c] * s, uv[c + 1] * s); g.closePath();
    }
  }
  g.stroke();
  g.restore();
}

// A texture as raw RGBA8 ({w, h, layers, px}): the variant's edited version when it has one (/api/tex, LSTX), else the game's
// (a float texture's values clamped to 0..1)
export async function fetchRaw(hash, variant) {
  const r = await fetch(`/api/tex?hash=${hash}&variant=${encodeURIComponent(variant)}`);
  if (!r.ok) throw new Error(await r.text());
  const buf = await r.arrayBuffer(), dv = new DataView(buf);
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true), layers = Math.max(1, dv.getUint32(12, true));
  const edited = r.headers.get('X-Edited') === '1', n = w * h * 4 * layers;   // (an array: its layers one after another)
  if (dv.getUint32(16, true) === 1) {
    const f = new Float32Array(buf, 20, n);
    return { w, h, layers, px: Uint8ClampedArray.from(f, v => Math.round(v * 255)), edited };
  }
  return { w, h, layers, px: new Uint8ClampedArray(buf, 20, n).slice(), edited };
}

// the items using a texture as their decal sheet or cape design (names; /api/texusers)
export async function texUsers(hash) {
  try { return (await (await fetch('/api/texusers?hash=' + hash)).json()).users ?? []; } catch { return []; }
}

// raw RGBA8 as the LSTX body /api/sheet takes (no canvas: colors under zero alpha survive)
export function lstx(w, h, px) {
  const out = new Uint8Array(20 + px.length), dv = new DataView(out.buffer);
  out.set([76, 83, 84, 88]);
  dv.setUint32(4, w, true); dv.setUint32(8, h, true); dv.setUint32(12, 1, true); dv.setUint32(16, 0, true);
  out.set(px, 20);
  return out;
}

export function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ask for a file (accept: input accept list)
export function pickFile(accept) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files[0] ?? null);
    i.click();
  });
}

// run f at most once per animation frame, the last call wins
export function throttled(f) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; f(); });
  };
}

// squared distance of every pixel to the nearest pixel where feature[i] (Felzenszwalb & Huttenlocher)
export function edt(feature, w, h) {
  const INF = 1e20, n = Math.max(w, h);
  const out = new Float32Array(w * h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = feature[y * w + x] ? 0 : INF;
    pass(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}
