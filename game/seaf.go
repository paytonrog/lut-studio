package game

import (
	"bytes"
	"fmt"
	"path"
	"sort"
	"strings"

	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit/material"

	"lutstudio/lut"
)

// SEAF: the Super Earth Armed Forces' soldier, its cargo and medic
// backpacks, and the SEAF artillery shells. Their looks are their materials' own LUTs (no customization table); the
// soldier's LUT (0x493b5a6a30e49de5) is used by nothing else. The game names none of them, so the kit names are
// LUT Studio's ("SEAF Soldier", "SEAF Artillery Shell: Napalm"). Type "SEAF"; each kit is its unit with its own
// skeleton, shown like a vehicle.

const SEAFType = "SEAF"

var seafDirs = []string{"content/fac_super_earth/cha_seaf/", "content/objectives/obj_common/seaf_artillery/"}

// seafName: LUT Studio's name for a SEAF unit.
func seafName(p string) string {
	base := path.Base(p)
	switch {
	case base == "cha_battlefront_seaf":
		return "SEAF Soldier"
	case strings.HasPrefix(base, "seaf_shell_"):
		return "SEAF Artillery Shell: " + title(strings.ReplaceAll(strings.TrimPrefix(base, "seaf_shell_"), "_", " "))
	}
	return "SEAF " + title(strings.ReplaceAll(base, "_", " "))
}

func (g *Game) seafKits() []Kit {
	knownName(stingray.Hash{}) // (fills knownTable)
	var kits []Kit
	for _, p := range knownTable {
		if !strings.HasPrefix(p, seafDirs[0]) && !strings.HasPrefix(p, seafDirs[1]) {
			continue
		}
		h := stingray.Sum(p)
		if !g.isUnit(h) {
			continue
		}
		k := Kit{ID: fmt.Sprintf("s%016x", h.Value), Name: seafName(p), Type: SEAFType,
			Units: []KitUnit{{Unit: lut.HashString(h.Value), Name: p}}}
		for _, d := range g.unitDefaultLUTs(h) {
			name, ok := thinName(d.slot)
			if !ok {
				name = fmt.Sprintf("0x%08x", d.slot)
			}
			k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(h.Value), Slot: name, PieceType: "seaf", Body: "any",
				MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern)})
		}
		if len(k.Pieces) > 0 {
			kits = append(kits, k)
		}
	}
	kits = append(kits, g.seafCamoKits(kits)...)
	sort.Slice(kits, func(i, j int) bool { return kits[i].Name < kits[j].Name })
	return kits
}

// SEAF camouflage: the SEAF soldiers and their weapons swap a material per planet (their entities'
// MaterialSwapComponent: a "standard" look and "jungle", "desert" and "arctic" ones, each a copy of the material with
// its own material_lut; the game picks one by the planet). Each look of each distinct set (the soldiers', the medics',
// each SEAF weapon's) is a kit: its unit with the swapped slot in that look's LUT, the other slots their own ("SEAF
// Soldier: Jungle camo", "SEAF Medic", "SEAF Rifle: Arctic camo"; the standard soldier is the "SEAF Soldier" kit).
// Needs the data-library tables (the item table is built with them, tools/gentable); without them: none.
var seafLooks = []string{"standard", "jungle", "desert", "arctic"}

// seafCamoNames: a set's name by its unit (weapons: the SEAF's own entities of the Helldivers' ones)
var seafCamoNames = map[string]string{"cha_battlefront_seaf": "SEAF Soldier", "assault_rifle": "SEAF Rifle",
	"personal_defense_weapon": "SEAF Defender", "machinegun": "SEAF Machine Gun"}

func (g *Game) seafCamoKits(have []Kit) []Kit {
	swaps, err := datalib.ParseMaterialSwapComponents()
	if err != nil {
		return nil
	}
	units, err := datalib.ParseUnitComponents()
	if err != nil {
		return nil
	}
	names := map[string]bool{}
	for _, k := range have {
		names[k.Name] = true
	}
	type set struct {
		unit  stingray.Hash
		slot  stingray.ThinHash
		mats  [4]stingray.Hash // per seafLooks
		medic bool
	}
	var sets []set
	for e, c := range swaps {
		if c.CamouflageSwaps[0].CamouflageType == 0 {
			continue
		}
		u, ok := units[e]
		if !ok || !g.isUnit(u.UnitPath) {
			continue
		}
		for _, sl := range c.MaterialSlots {
			var st set
			st.unit, st.slot = u.UnitPath, sl.MaterialSlotName
			n := 0
			for _, sw := range sl.SwapSettings {
				for i, l := range seafLooks {
					if sw.Name == stingray.Sum(l).Thin() && sw.Material.Value != 0 {
						st.mats[i] = sw.Material
						n++
					}
				}
			}
			if n == 0 || st.slot.Value == 0 {
				continue
			}
			for i := 1; i <= 3; i++ {
				st.medic = st.medic || e == stingray.Sum(fmt.Sprintf("content/fac_super_earth/cha_seaf/cha_battlefront_seaf_medic%s", map[int]string{1: "", 2: "_2", 3: "_3"}[i]))
			}
			dup := false
			for _, o := range sets {
				dup = dup || (o.unit == st.unit && o.slot == st.slot && o.mats == st.mats)
			}
			if !dup {
				sets = append(sets, st)
			}
		}
	}
	lutSlot, patSlot := stingray.Sum("material_lut").Thin(), stingray.Sum("pattern_lut").Thin()
	matLUTs := func(h stingray.Hash) (stingray.Hash, stingray.Hash, bool) {
		b, err := g.data.Read(stingray.NewFileID(h, stingray.Sum("material")), stingray.DataMain)
		if err != nil {
			return stingray.Hash{}, stingray.Hash{}, false
		}
		m, err := material.LoadMain(bytes.NewReader(b))
		if err != nil || m.Textures[lutSlot].Value == 0 {
			return stingray.Hash{}, stingray.Hash{}, false
		}
		return m.Textures[lutSlot], m.Textures[patSlot], true
	}
	var kits []Kit
	for _, st := range sets {
		up, _ := knownName(st.unit)
		base := seafCamoNames[path.Base(up)]
		if base == "" {
			base = "SEAF " + title(strings.ReplaceAll(path.Base(up), "_", " "))
		}
		if st.medic {
			base = "SEAF Medic"
		}
		slotName, ok := thinName(st.slot.Value)
		if !ok {
			slotName = fmt.Sprintf("0x%08x", st.slot.Value)
		}
		defaults := g.unitDefaultLUTs(st.unit)
		for i, look := range seafLooks {
			if st.mats[i].Value == 0 {
				continue
			}
			name := base
			if look != "standard" {
				name += ": " + title(look) + " camo"
			}
			if names[name] {
				continue
			}
			l, pat, ok := matLUTs(st.mats[i])
			if !ok {
				continue
			}
			k := Kit{ID: fmt.Sprintf("s%016x.%08x.%s%s", st.unit.Value, st.slot.Value, map[bool]string{true: "medic."}[st.medic], look), Name: name, Type: SEAFType,
				Units: []KitUnit{{Unit: lut.HashString(st.unit.Value), Name: up}}}
			k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(st.unit.Value), Slot: slotName, PieceType: "seaf", Body: "any",
				MaterialLUT: hashOrEmpty(l), PatternLUT: hashOrEmpty(pat)})
			for _, d := range defaults {
				if d.slot == st.slot.Value {
					continue
				}
				n, ok := thinName(d.slot)
				if !ok {
					n = fmt.Sprintf("0x%08x", d.slot)
				}
				k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(st.unit.Value), Slot: n, PieceType: "seaf", Body: "any",
					MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern)})
			}
			names[name] = true
			kits = append(kits, k)
		}
	}
	return kits
}
