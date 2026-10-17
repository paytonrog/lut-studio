package game

import (
	"bytes"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"

	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	pkg "github.com/xypwn/filediver/stingray/package"
	"github.com/xypwn/filediver/stingray/unit"
	"github.com/xypwn/filediver/stingray/unit/material"

	"lutstudio/lut"
)

// Vehicles, hellpods and the Pelican are skinned through the unit customization table: per collection (vehicle
// type) a list of skins; per skin, per
// material of the unit, the LUTs to set. Each collection + skin is one kit of type "Vehicle"; its pieces are the
// skin's material overrides (Slot = the material's name in the unit; Skin = the glTF material variant filediver
// exports for it, which the preview uses to pick each mesh's material).

const VehicleType = "Vehicle"

// vehicleUnit: the body unit a collection skins. filediver maps the Maelstrom tank to the Bastion's unit (the
// Maelstrom is tank_storm); the Emancipator / Breakthrough / Lumberer bodies it names don't exist as units: every
// exosuit is the Patriot's body (combat_walker) with other arms (their loadout packages say so).
func vehicleUnit(c datalib.UnitCustomizationCollectionType, g *Game) (stingray.Hash, error) {
	if c == datalib.CollectionTankMaelstrom {
		if h := stingray.Sum("content/fac_helldivers/vehicles/tank_storm/tank_storm"); g.isUnit(h) {
			return h, nil
		}
	}
	h, err := c.Unit()
	if err == nil && !g.isUnit(h) && strings.HasPrefix(c.String(), "CollectionCombatWalker") {
		h = stingray.Sum("content/fac_helldivers/vehicles/combat_walker/combat_walker")
	}
	return h, err
}

func (g *Game) isUnit(h stingray.Hash) bool {
	_, ok := g.data.Files[stingray.NewFileID(h, stingray.Sum("unit"))]
	return ok
}

// loadoutPackage: the package that loads a collection's vehicle with its parts (arms, guns, racks).
var loadoutPackage = map[datalib.UnitCustomizationCollectionType]string{
	datalib.CollectionCombatWalker: "combat_walker", datalib.CollectionCombatWalkerEmancipator: "combat_walker_obsidian",
	datalib.CollectionCombatWalkerLumberer: "combat_walker_lumberer", datalib.CollectionCombatWalkerBreacher: "combat_walker_breacher",
	datalib.CollectionFRV: "frv", datalib.CollectionFRVFlamer: "frv_flamer", datalib.CollectionFRVSupply: "frv_supply",
	datalib.CollectionTankBastion: "tank", datalib.CollectionTankMaelstrom: "tank_storm",
}

// packageUnits: the units a package lists.
func (g *Game) packageUnits(name string) []stingray.Hash {
	return g.packageUnitsByHash(stingray.Sum(name))
}

func (g *Game) packageUnitsByHash(h stingray.Hash) []stingray.Hash {
	if h.Value == 0 {
		return nil
	}
	b, err := g.data.Read(stingray.NewFileID(h, stingray.Sum("package")), stingray.DataMain)
	if err != nil {
		return nil
	}
	p, err := pkg.LoadPackage(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	var out []stingray.Hash
	for _, it := range p.Items {
		if it.Type == stingray.Sum("unit") {
			out = append(out, it.Name)
		}
	}
	return out
}

// unitSlots: a unit's material slot names (thin hashes), cached.
func (g *Game) unitSlots(h stingray.Hash) map[uint32]bool {
	g.slotMu.Lock()
	defer g.slotMu.Unlock()
	if m, ok := g.slots[h]; ok {
		return m
	}
	m := map[uint32]bool{}
	if b, err := g.data.Read(stingray.NewFileID(h, stingray.Sum("unit")), stingray.DataMain); err == nil {
		if info, err := unit.LoadInfo(bytes.NewReader(b)); err == nil {
			for slot := range info.Materials {
				m[slot.Value] = true
			}
		}
	}
	if g.slots == nil {
		g.slots = map[stingray.Hash]map[uint32]bool{}
	}
	g.slots[h] = m
	return m
}

// vehicleParts: the units shown with a vehicle (its body first, then the loadout's parts under vehicles/ or hellpod/;
// projectiles, casings and magazines left out) and the extra units that only hold an overridden material
// (hellpod rack: ammo box, expandable cover; Pelican: its turret), searched among all named hellpod / vehicle units.
func (g *Game) vehicleParts(c datalib.UnitCustomizationCollectionType, body stingray.Hash) []stingray.Hash {
	parts := []stingray.Hash{body}
	for _, u := range g.packageUnits("packages/generated/loadout/" + loadoutPackage[c]) {
		name, ok := knownName(u)
		if u == body || !ok || !(strings.Contains(name, "/vehicles/") || strings.Contains(name, "/hellpod/")) ||
			strings.HasSuffix(name, "_missile") {
			continue
		}
		parts = append(parts, u)
	}
	return parts
}

// slotUnit: the unit holding material slot s: one of parts first (the nth such part for the nth override of the
// same slot: two exosuit arms both call their material m_weapon), else any named hellpod / vehicle unit.
func (g *Game) slotUnit(s uint32, parts []stingray.Hash, nth int) (stingray.Hash, bool) {
	var hits []stingray.Hash
	for _, u := range parts {
		if g.unitSlots(u)[s] {
			hits = append(hits, u)
		}
	}
	if len(hits) > 0 {
		return hits[min(nth, len(hits)-1)], true
	}
	for _, u := range g.vehicleUnitPool() {
		if g.unitSlots(u)[s] {
			return u, true
		}
	}
	return stingray.Hash{}, false
}

// vehicleUnitPool: every named unit under fac_helldivers/vehicles or fac_helldivers/hellpod in the install.
func (g *Game) vehicleUnitPool() []stingray.Hash {
	g.poolOnce.Do(func() {
		for _, n := range hashes.ParseHashes(hashes.Hashes) {
			if strings.HasPrefix(n, "content/fac_helldivers/vehicles/") || strings.HasPrefix(n, "content/fac_helldivers/hellpod/") {
				if h := stingray.Sum(n); g.isUnit(h) {
					g.pool = append(g.pool, h)
				}
			}
		}
	})
	return g.pool
}

// knownName: the path of a hash from filediver's name list, else LUT Studio's own names for units it identified.
func knownName(h stingray.Hash) (string, bool) {
	knownOnce.Do(func() {
		knownTable = map[uint64]string{}
		for _, n := range hashes.ParseHashes(hashes.Hashes) {
			knownTable[stingray.Sum(n).Value] = n
		}
		for h, n := range ownNames {
			if _, ok := knownTable[h]; !ok {
				knownTable[h] = n
			}
		}
	})
	n, ok := knownTable[h.Value]
	return n, ok
}

// ownNames: units the name list doesn't have, named by LUT Studio (not the game's paths; what they are was found
// from their meshes and packages): the Bastion's cannon turret (packages/generated/loadout/tank, meshes
// g_tank_cannon_01 turret_whole / turret_damaged; mounts on the tank's attach_tank_gun).
var ownNames = map[uint64]string{
	0x1fa1f596769225c2: "content/fac_helldivers/vehicles/tank/armaments/tank_cannon/tank_cannon",
}

var (
	knownOnce  sync.Once
	knownTable map[uint64]string
)

// ownThinNames: 32-bit names the name list lacks (they hash to what the units hold): the Bastion cannon's LOD meshes.
// filediver leaves a unit's LODs out of its export only when it knows their names; unnamed, the cannon's four LODs
// were drawn over its full-detail mesh.
var ownThinNames = []string{"g_tank_cannon_01_LOD1", "g_tank_cannon_01_LOD2", "g_tank_cannon_01_LOD3", "g_tank_cannon_01_LOD4"}

// thinHashNames: filediver's 32-bit name list with LUT Studio's own names.
func thinHashNames() []string { return append(hashes.ParseHashes(hashes.ThinHashes), ownThinNames...) }

func (g *Game) vehicleKits(languageMap map[uint32]string) ([]Kit, error) {
	get := func(id stingray.FileID, typ stingray.DataType) ([]byte, bool, error) {
		b, err := g.data.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			return nil, false, nil
		}
		return b, err == nil, err
	}
	settings, err := datalib.ParseUnitCustomizationSettings(get, languageMap)
	if err != nil {
		return nil, err
	}
	thin := func(h stingray.ThinHash) string {
		if s, ok := thinName(h.Value); ok {
			return s
		}
		return fmt.Sprintf("0x%08x", h.Value)
	}
	var kits []Kit
	for _, c := range settings {
		unit, err := vehicleUnit(c.CollectionType, g)
		if err != nil {
			continue
		}
		vehicle := vehicleName(c.ObjectName)
		if vehicle == "Shuttle" {
			vehicle = "Pelican (Shuttle)" // the game's name for it in play
		}
		parts := g.vehicleParts(c.CollectionType, unit)
		for _, s := range c.Skins {
			skin := titleName(s.Name)
			k := Kit{ID: fmt.Sprintf("0x%08x.%d", s.ID.Value, c.CollectionType), Name: vehicle + ": " + skin, Type: VehicleType}
			units := append([]stingray.Hash{}, parts...)
			seen := map[uint32]int{} // overrides per slot so far
			add := func(o datalib.UnitCustomizationMaterialOverrides, mounted bool) {
				if o.MaterialLut.Value == 0 && o.PatternLut.Value == 0 {
					return
				}
				u := unit
				defer func() { seen[o.MaterialID.Value]++ }()
				if su, ok := g.slotUnit(o.MaterialID.Value, parts, seen[o.MaterialID.Value]); ok {
					u = su
					if !slices.Contains(units, su) {
						units = append(units, su)
					}
				}
				k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(u.Value), Slot: thin(o.MaterialID), PieceType: "vehicle",
					Body: "any", MaterialLUT: hashOrEmpty(o.MaterialLut), PatternLUT: hashOrEmpty(o.PatternLut),
					DecalSheet: hashOrEmpty(o.DecalSheet), Skin: skin, Mounted: mounted})
			}
			for _, o := range s.Customization.MaterialsTexturesOverrides {
				add(o, false)
			}
			for _, o := range s.Customization.MountedWeaponTextureOverrides {
				add(o, true)
			}
			// filediver's "unknown" lists also carry LUTs (the Lumberer's skins: one each)
			for _, o := range append(append([]datalib.UnitCustomizationMaterialOverrides{}, s.Customization.UnknownTextureOverrides...),
				s.Customization.UnknownTextureOverrides2...) {
				add(o, true)
			}
			// a skin with no overrides (STANDARD: the default look) is the parts' own materials' LUTs
			if len(k.Pieces) == 0 {
				for _, u := range parts {
					for _, d := range g.unitDefaultLUTs(u) {
						k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(u.Value), Slot: thin(stingray.ThinHash{Value: d.slot}),
							PieceType: "vehicle", Body: "any", MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern),
							Skin: skin, Mounted: u != unit})
					}
				}
			}
			for _, u := range units {
				name, _ := knownName(u)
				k.Units = append(k.Units, KitUnit{Unit: lut.HashString(u.Value), Name: name})
			}
			if len(k.Pieces) > 0 {
				kits = append(kits, k)
			}
		}
	}
	return kits, nil
}

type defaultLUT struct {
	slot         uint32
	lut, pattern stingray.Hash
	cape         capeTextures // a cape-shader material (the melee flag's cloth): its cape LUT and textures
}

type capeTextures struct{ lut, gradient, decalSheet, scalarFields, baseData stingray.Hash }

// unitDefaultLUTs: per material slot of a unit, the LUTs its material binds (its look without a skin).
func (g *Game) unitDefaultLUTs(u stingray.Hash) []defaultLUT {
	b, err := g.data.Read(stingray.NewFileID(u, stingray.Sum("unit")), stingray.DataMain)
	if err != nil {
		return nil
	}
	info, err := unit.LoadInfo(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	lutSlot, patSlot := stingray.Sum("material_lut").Thin(), stingray.Sum("pattern_lut").Thin()
	var out []defaultLUT
	for slot, mh := range info.Materials {
		mb, err := g.data.Read(stingray.NewFileID(mh, stingray.Sum("material")), stingray.DataMain)
		if err != nil {
			continue
		}
		m, err := material.LoadMain(bytes.NewReader(mb))
		if err != nil || m.Textures[lutSlot].Value == 0 {
			continue
		}
		tex := func(n string) stingray.Hash { return m.Textures[stingray.Sum(n).Thin()] }
		out = append(out, defaultLUT{slot.Value, m.Textures[lutSlot], m.Textures[patSlot], capeTextures{tex("cape_lut"),
			tex("cape_gradient"), tex("decal_sheet"), tex("cape_scalar_fields"), tex("base_data")}})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].slot < out[j].slot })
	return out
}

// dummyPatternMask: the 1x1 black pattern_masks_array most materials bind; a pattern LUT draws nothing on them.
const dummyPatternMask = 0xf37a4e756300ab32

// PatternDrawn reports whether a pattern LUT can show on a piece: one of its unit's LUT materials (the slot's own,
// when the slot names one) binds a real pattern_masks_array. Every vehicle skin binds the dummy, so the pattern LUTs
// they name (e.g. True Blue's beige 0x4cac10858d877485, whose pattern shows only on armor) are left out of a project.
func (g *Game) PatternDrawn(unitHash, slot string) bool {
	uh, err := lut.ParseHash(unitHash)
	if err != nil {
		return true
	}
	b, err := g.data.Read(stingray.NewFileID(stingray.Hash{Value: uh}, stingray.Sum("unit")), stingray.DataMain)
	if err != nil {
		return true // can't tell: keep it
	}
	info, err := unit.LoadInfo(bytes.NewReader(b))
	if err != nil {
		return true
	}
	lutSlot, maskSlot := stingray.Sum("material_lut").Thin(), stingray.Sum("pattern_masks_array").Thin()
	masks := map[bool][]uint64{} // by "the slot is this material"
	for s, mh := range info.Materials {
		mb, err := g.data.Read(stingray.NewFileID(mh, stingray.Sum("material")), stingray.DataMain)
		if err != nil {
			continue
		}
		m, err := material.LoadMain(bytes.NewReader(mb))
		if err != nil || m.Textures[lutSlot].Value == 0 {
			continue
		}
		name, _ := thinName(s.Value)
		own := slot != "" && (name == slot || fmt.Sprintf("0x%08x", s.Value) == slot)
		masks[own] = append(masks[own], m.Textures[maskSlot].Value)
	}
	list := masks[true]
	if len(list) == 0 {
		list = masks[false]
	}
	for _, v := range list {
		if v != 0 && v != dummyPatternMask {
			return true
		}
	}
	return len(list) == 0
}

// dropUndrawnPatterns clears the pattern LUT of every piece that has no pattern mask to draw it with (PatternDrawn),
// so the LUT is neither pulled into a project nor listed as used by that kit: True Blue's beige pattern LUT is
// "used by" the armors whose stripes it colors, not by the vehicle skins that only name it.
func (g *Game) dropUndrawnPatterns(idx *Index) {
	drawn := map[[2]string]bool{}
	for ki := range idx.Kits {
		for pi := range idx.Kits[ki].Pieces {
			p := &idx.Kits[ki].Pieces[pi]
			if p.PatternLUT == "" {
				continue
			}
			key := [2]string{p.Unit, p.Slot}
			d, ok := drawn[key]
			if !ok {
				d = g.PatternDrawn(p.Unit, p.Slot)
				drawn[key] = d
			}
			if !d {
				p.PatternLUT = ""
			}
		}
	}
}

// thinNames: names of known 32-bit hashes (filediver's list and LUT Studio's), for material slot names; built on
// first use.
var (
	thinOnce  sync.Once
	thinTable map[uint32]string
)

func thinName(v uint32) (string, bool) {
	thinOnce.Do(func() {
		thinTable = map[uint32]string{}
		for _, s := range thinHashNames() {
			thinTable[stingray.Sum(s).Thin().Value] = s
		}
	})
	s, ok := thinTable[v]
	return s, ok
}

// hasMeshes: unit h has geometry (some units only list materials: placeholders)
func (g *Game) hasMeshes(h stingray.Hash) bool {
	b, err := g.data.Read(stingray.NewFileID(h, stingray.Sum("unit")), stingray.DataMain)
	if err != nil {
		return false
	}
	info, err := unit.LoadInfo(bytes.NewReader(b))
	return err == nil && len(info.MeshInfos) > 0
}
