// Showcase mode: the viewport as key art (scene.js builds the scene, showcase.js draws it), its options in the right
// sidebar in place of the LUT fields: what the items show (as in this mod, as the game has them, the Theme panel's
// looks, a preset), the title and the line over it, the scene's items (each Helldiver's armor, cape, weapon and pose;
// the vehicles, stratagem, backpack, sidearm, throwable), the look's sliders, Save 4K PNG. The left lists and the view
// bar hide meanwhile; Exit puts the editor back as it was.
import { $, esc, closeSide } from './texedit.js';
import { buildScene, LOOK } from './scene.js';
import { PRESETS, presetTheme, presetOptions } from './theme.js';

const SLIDERS = [['bg', 'Background', 0, 3], ['glow', 'Glow', 0, 3], ['glowSize', 'Glow size', 0.3, 2.5], ['rim', 'Rim light', 0, 4],
  ['exposure', 'Exposure', 0.3, 2.5], ['reflect', 'Reflections', 0, 3], ['shadow', 'Floor shadows', 0, 2], ['haze', 'Haze', 0, 3],
  ['aura', 'Aura', 0, 3], ['bloom', 'Bloom', 0, 3], ['embers', 'Embers', 0, 4], ['grain', 'Grain', 0, 4], ['vignette', 'Vignette', 0, 1.25],
  ['punch', 'Punch', 0, 1], ['title', 'Text size', 0.4, 2]];
const savedLook = () => { try { return { ...LOOK, ...JSON.parse(localStorage.getItem('lutstudio.showcaseLook') ?? '{}') }; } catch { return { ...LOOK }; } };
const keepLook = look => { try { localStorage.setItem('lutstudio.showcaseLook', JSON.stringify(look)); } catch { } };

let show = null;   // {scene, theme, which}
// the small line over the title, by what the items show
const lineFor = which => (which === 'mod' || which === 'game' ? 'Made with LUT Studio' : 'LUT Studio theme');

// app: scene.js's app (R, api, kits, poses, clip, showItem, statusText, setEnv, snapshot, restore) and track(event,
// props), projectName(). opts.theme: the Theme panel's looks (a theme for scene.setTheme), shown first.
export async function openShowcase(app, opts = {}) {
  if (show) return;
  if (!(await closeSide())) return;   // (an open panel first)
  const side = $('scSide'), mine = show = { panelTheme: opts.theme ?? null }, t0 = performance.now();
  document.body.classList.add('showcase');
  side.hidden = false;
  side.innerHTML = '<section><h2>Showcase</h2><p class="hint" id="scMsg">Building the scene… (the items load one by one)</p></section>';
  // what the items show: as in this mod, as the game has them, the Theme panel's looks, a preset
  const themes = { mod: { name: app.projectName() || 'My mod' }, game: { name: 'Helldivers 2', base: 'vanilla' } };
  if (mine.panelTheme) themes.panel = mine.panelTheme;
  const themeOf = which => themes[which] ?? (PRESETS[which.slice(2)] ? presetTheme(which.slice(2)) : themes.mod);
  mine.which = mine.panelTheme ? 'panel' : 'mod';
  try {
    const scene = await buildScene(app, { progress: m => { if (show === mine && $('scMsg') && m) $('scMsg').textContent = m; } });
    if (show !== mine) { await scene.dispose(); return; }   // (exited while it loaded)
    mine.scene = scene;
    window.lutstudio.showcase = scene;   // (for headless checks: e2e)
    scene.setLook(savedLook());
    mine.theme = themeOf(mine.which);
    scene.setText(mine.theme.name, lineFor(mine.which));
    await scene.setTheme(mine.theme);
    if (show !== mine) return;
    panel(app, themeOf);
    app.track('showcase opened', { show: mine.which, ms: Math.round(performance.now() - t0) });
  } catch (e) {   // (the editor is back as it was: out of showcase mode, the error said)
    console.warn(e);
    if (show === mine) { closeShowcase(); app.status?.('Showcase: ' + e.message, true); }
  }
}

export function closeShowcase() {
  if (!show) return;
  const s = show; show = null; window.lutstudio.showcase = null;
  const side = $('scSide'); side.hidden = true; side.innerHTML = '';
  document.body.classList.remove('showcase');
  s.scene?.dispose().catch(e => console.warn('showcase', e));
}

function panel(app, themeOf) {
  const sc = show.scene, look = sc.showcase.look;
  const opt = (list, cur) => list.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const none = (cur, label) => `<option value="" ${cur ? '' : 'selected'}>${label}</option>`;   // (an empty slot)
  // a slot's place on the floor: X (left / right) and Y (toward / away from the camera), m
  const moveRow = (si, it) => `<div class="row"><span style="width:1.2em">X</span><input type="range" data-move="${si}" data-ax="0" min="-8" max="8" step="0.05" value="${it.at[0]}" style="flex:1" title="Left / right">
      <span style="width:1.2em">Y</span><input type="range" data-move="${si}" data-ax="1" min="-4" max="10" step="0.05" value="${it.at[1]}" style="flex:1" title="Toward (−) / away from (+) the camera"></div>`;
  const poses = sc.poses(), groupOf = { Armory: 'Armory poses (hold the weapon)', Moves: 'Moves', Emotes: 'Emotes (weapon put away)' };
  const poseOpts = cur => Object.entries(groupOf).map(([g, t]) => `<optgroup label="${t}">${opt(poses.filter(p => p.group === g).map(p => p.name), cur)}</optgroup>`).join('');
  const rows = sc.slots.map((it, si) => it.group === 'Armor'
    ? `<div class="row"><b class="grow">${esc(it.label ?? 'Helldiver')}</b></div>
      <div class="row"><select data-slot="${si}" data-f="name" title="Armor (its own helmet); none: no Helldiver here" style="flex:1;min-width:0">${none(it.name, '(none)')}${opt(sc.choices(si), it.name)}</select>
        <select data-slot="${si}" data-f="cape" title="Cape" style="flex:1;min-width:0">${none(it.cape, '(no cape)')}${opt(sc.capes(), it.cape)}</select></div>
      <div class="row"><select data-slot="${si}" data-f="backpack" title="The backpack they wear" style="flex:1;min-width:0">${none(it.backpack, '(no backpack)')}${opt(sc.backpacks(), it.backpack)}</select></div>
      <div class="row"><select data-slot="${si}" data-f="weapon" title="The weapon they hold (when the pose holds one)" style="flex:1;min-width:0"><option value="" ${it.weapon ? '' : 'selected'}>(no weapon)</option>${opt(sc.weapons(), it.weapon)}</select>
        <select data-slot="${si}" data-f="pose" title="Pose (the Armory's hold the weapon; an emote puts it away)" style="flex:1;min-width:0">${poseOpts(it.pose)}</select></div>${moveRow(si, it)}`
    : `<div class="row"><span style="width:6.5em">${esc(it.label ?? it.group)}</span><select data-slot="${si}" data-f="name" title="${esc(it.group)}" style="flex:1;min-width:0">${none(it.name, '(none)')}${opt(sc.choices(si), it.name)}</select></div>${moveRow(si, it)}`).join('');
  $('scSide').innerHTML = `<section><h2>Showcase</h2>
      <p class="hint">Live: orbit, pan and zoom in the viewport (the frame there is the image's). Nothing in the mod changes.</p>
      <div class="row"><label class="grow">Show <select id="scShow" style="max-width:220px">
        <option value="mod">As in this mod (${esc(app.projectName() || 'its edits')})</option>
        <option value="game">As the game has them</option>
        ${show.panelTheme ? `<option value="panel">The Theme panel's looks</option>` : ''}
        ${presetOptions(n => 'p:' + n)}</select></label></div>
      <div class="row"><label class="check" title="The decals (emblems, markings) in the theme's colors too: light parts trim, dark parts secondary"><input type="checkbox" id="scDecals"> theme the decals</label></div>
      <div class="row"><label class="grow">Title <input id="scTitle" value="${esc(show.theme.name)}"></label></div>
      <div class="row"><label class="grow">Line <input id="scLine" value="${esc(lineFor(show.which))}"></label></div>
      <div class="row"><label>Light <input type="color" id="scColor" value="${look.color || sc.showcase.accent}"></label>
        <label class="check"><input type="checkbox" id="scAuto" ${look.color ? '' : 'checked'}> from the scene</label></div>
      <div class="row"><button id="scSave" class="primary">Save 4K PNG</button><button id="scExit">Exit showcase</button></div>
      <p class="hint" id="scMsg">${esc(sc.notes.join('; '))}</p></section>
    <section><h2>Scene</h2>${rows}</section>
    <section><h2>Look</h2>
      ${SLIDERS.map(([k, t, lo, hi]) => `<div class="row"><label class="grow">${t}</label>
        <input type="range" data-sk="${k}" min="${lo}" max="${hi}" step="0.01" value="${look[k]}" style="flex:2">
        <span class="hint" data-sv="${k}" style="width:3em;text-align:right">${(+look[k]).toFixed(2)}</span></div>`).join('')}
      <div class="row"><button id="scCam">Reset camera</button><button id="scReset">Reset look</button></div></section>`;
  $('scShow').value = show.which;
  const decalBox = () => { const off = show.which === 'mod' || show.which === 'game'; $('scDecals').disabled = off; if (off) $('scDecals').checked = false; };
  $('scDecals').checked = !!show.theme.decals; decalBox();
  $('scDecals').onchange = async () => {
    show.theme = { ...show.theme, decals: $('scDecals').checked ? 'two' : '' };
    busy(true); msg('Theming…');
    try { await sc.setTheme(show.theme); msg(''); } catch (e) { msg(e.message); }
    if (show) busy(false);
  };
  const msg = t => { if ($('scMsg')) $('scMsg').textContent = t; };
  const busy = on => document.querySelectorAll('#scSide select, #scSave').forEach(x => (x.disabled = on));
  // what the items show
  $('scShow').onchange = async () => {
    const which = $('scShow').value, t = themeOf(which), title = $('scTitle');
    if (title.value === show.theme.name) title.value = t.name;
    if ($('scLine').value === lineFor(show.which)) $('scLine').value = lineFor(which);
    sc.setText(title.value.trim(), $('scLine').value.trim());
    show.which = which; decalBox();
    show.theme = { ...t, decals: $('scDecals').checked ? (t.decals || 'two') : '' };
    busy(true); msg('Theming…');
    try { await sc.setTheme(show.theme); msg(''); } catch (e) { msg(e.message); }
    if (show) { busy(false); if ($('scAuto').checked) $('scColor').value = sc.showcase.accent; }
  };
  document.querySelectorAll('#scSide input[data-move]').forEach(inp => (inp.oninput = () => {
    const si = +inp.dataset.move, at = [...sc.slots[si].at]; at[+inp.dataset.ax] = +inp.value;
    sc.move(si, at);
  }));
  // a slot's item, cape, weapon or pose: swapped in place (the others wait)
  document.querySelectorAll('#scSide select[data-slot]').forEach(sel => (sel.onchange = async () => {
    busy(true); msg('Loading…');
    const v = sel.value, f = sel.dataset.f, si = +sel.dataset.slot, n0 = sc.notes.length;
    try {
      await sc.swap(si, { [f]: f === 'weapon' && v === '' ? null : v });
      msg(sc.notes.slice(n0).join('; '));
      if ($('scAuto').checked) $('scColor').value = sc.showcase.accent;   // (the light from the scene: it changed)
      app.track('showcase item changed', { slot: sc.slots[si].label, field: f });
    } catch (e) { msg(e.message); }
    if (show) busy(false);
  }));
  const text = () => sc.setText($('scTitle').value.trim(), $('scLine').value.trim());
  $('scTitle').oninput = text; $('scLine').oninput = text;
  const set = patch => { sc.setLook(patch); keepLook(sc.showcase.look); };
  document.querySelectorAll('#scSide input[data-sk]').forEach(r => (r.oninput = () => {
    set({ [r.dataset.sk]: +r.value }); document.querySelector(`#scSide [data-sv="${r.dataset.sk}"]`).textContent = (+r.value).toFixed(2);
  }));
  $('scColor').oninput = () => { $('scAuto').checked = false; set({ color: $('scColor').value }); };
  $('scAuto').onchange = () => { set({ color: $('scAuto').checked ? '' : $('scColor').value }); if ($('scAuto').checked) $('scColor').value = sc.showcase.accent; };
  $('scCam').onclick = () => sc.resetCamera();
  $('scReset').onclick = () => { set({ ...LOOK }); for (const [k] of SLIDERS) { const r = document.querySelector(`#scSide input[data-sk="${k}"]`); r.value = LOOK[k]; document.querySelector(`#scSide [data-sv="${k}"]`).textContent = (+LOOK[k]).toFixed(2); } $('scAuto').checked = true; $('scColor').value = sc.showcase.accent; };
  $('scExit').onclick = closeShowcase;
  $('scSave').onclick = async () => {
    $('scSave').disabled = true; msg('Saving the 4K image…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const c = sc.exportCanvas(3840, 2160), name = ($('scTitle').value.trim() || 'showcase').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lut-studio-${name}-4k.png`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      msg('Saved.');
      app.track('showcase saved', { show: show.which });
    } catch (e) { msg(e.message); }
    if (show) $('scSave').disabled = false;
  };
}
