// Pure helpers of the editor (no DOM, no state): tested with node (tools/test.py, server/web/*.test.mjs).

export const SLOT_ORDER = ['helmet', 'torso', 'shoulder', 'arm', 'hips', 'leg', 'cape'];
// parts -> "torso (stocky), arms, legs": left + right merge, a body is named where only one body type uses it
export function slotList(parts) {
  const bodies = new Map();
  for (const p of parts) { if (!bodies.has(p.slot)) bodies.set(p.slot, new Set()); bodies.get(p.slot).add(p.body); }
  const only = slot => { const b = bodies.get(slot); return b && b.size === 1 && !b.has('any') ? [...b][0] : ''; };
  const out = [];
  for (const s of SLOT_ORDER) {
    const l = bodies.has('left_' + s), r = bodies.has('right_' + s);
    let name = '', body = '';
    if (l && r) { name = s + 's'; body = only('left_' + s) === only('right_' + s) ? only('left_' + s) : ''; }
    else if (l || r) { name = (l ? 'left ' : 'right ') + s; body = only((l ? 'left_' : 'right_') + s); }
    else if (bodies.has(s)) { name = s; body = only(s); }
    if (name) out.push(body ? `${name} (${body})` : name);
  }
  for (const slot of bodies.keys())   // other slot names (vehicle materials: m_frv_body -> frv body)
    if (!SLOT_ORDER.some(s => slot === s || slot.endsWith('_' + s))) out.push(slot.replace(/^m_/, '').replace(/_/g, ' '));
  return out.join(', ');
}
// Where a vehicle part goes on the body (mount nodes of the body unit); null = modeled in place.
export function vehicleMount(path) {
  const n = path.split('/').pop() ?? '';
  if (/_left$/.test(n)) return ['attach_turret_l'];
  if (/_right$/.test(n)) return ['attach_turret_r'];
  if (/^combat_walker_(turret|flamethrower|flak_cannon)$/.test(n)) return ['attach_turret_r'];   // (side: L)
  if (/^combat_walker_(missle_launcher|anti_tank_cannon|shield)$/.test(n)) return ['attach_turret_l'];
  if (n === 'tank_storm_maingun' || n === 'tank_cannon') return ['attach_tank_gun'];   // Maelstrom / Bastion main gun
  if (n === 'tank_storm_smoke') return ['attach_smoke'];
  if (n === 'tank_storm_silo') return ['attach_silo_left', 'attach_silo_right'];
  if (/shuttle_gunship_turret/.test(n)) return ['attach_front_turret'];
  // FRV: the gunner's weapon, or the Supply FRV's rack in its place (its crates hang below its origin, its post
  // reaching into the bed); the Incinerator's fuel tank in the boot
  if (n === 'frv_mg' || n === 'frv_flamethrower' || n === 'frv_supply_rack') return ['gun_mount'];
  if (n === 'frv_flamer_fuel_tank') return ['attach_boot'];
  return null;
}

