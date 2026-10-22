package game

import (
	"fmt"
	"maps"
	"path"
	"slices"
	"sort"
	"strings"

	"github.com/xypwn/filediver/stingray"

	"lutstudio/lut"
)

// Every other unit whose look is its materials' own LUTs, with no customization table: throwables, weapon
// attachments, stratagem hardware, gear no weapon kit covers, the Eagle and other craft, the ship's crew, Automatons, the Illuminate, mission objectives, the Super Destroyer's interior, the
// planets' props, and units with no known path. The game names none of them by unit, so the kit names are LUT
// Studio's, from the unit paths ("Throwable: Frag Grenade"; an unnamed unit: "Unit 0x…"). A unit becomes a kit
// only when one of its material LUTs is used by no other kit (a magazine every weapon kit already shows stays
// out). Units with the same LUTs are one kit, shown with the shortest path's model and named by what their names
// share ("Hellbomb (3 models)" for the Hellbomb, its prop and the defunct one; "Muzzle (9 models)" for every
// muzzle device). Each kit is its unit with its own skeleton, shown like a vehicle.

const (
	ThrowableType   = "Throwable"
	AttachmentType  = "Attachment"
	StratagemType   = "Stratagem"
	GearType        = "Gear"
	CraftType       = "Craft"
	CrewType        = "Crew"
	AutomatonType   = "Automaton"
	IlluminateType  = "Illuminate"
	ObjectiveType   = "Objective"
	ShipType        = "Ship"
	WorldType       = "World"
	UnitType        = "Unidentified" // no name of its own: named by clues ("with Fortifications") until identified
	ArmorPieceType  = "Armor piece"
	equipmentDir    = "content/fac_helldivers/equipment/"
	gearIDPrefix    = "u"
	unnamedUnitName = "Unit "
)

// GearTypes: the kit types of gear.go, in menu order
var GearTypes = []string{AttachmentType, GearType, ThrowableType, StratagemType, CraftType, CrewType, AutomatonType,
	IlluminateType, ObjectiveType, ShipType, WorldType, ArmorPieceType, UnitType}

// gearDirs: the type of a unit path by its folder (the first match)
var gearDirs = []struct{ prefix, typ string }{
	{equipmentDir + "throwables/", ThrowableType},
	{equipmentDir + "attachment/", AttachmentType},
	{equipmentDir, GearType},
	{"content/fac_helldivers/hellpod/", StratagemType},
	{"content/fac_helldivers/vehicles/", CraftType},
	{"content/fac_helldivers/", GearType},
	{"content/fac_super_earth/bridge_personnel/", CrewType},
	{"content/fac_super_earth/", GearType},
	{"content/fac_cyborgs/", AutomatonType},
	{"content/fac_illuminate/", IlluminateType},
	{"content/objectives/", ObjectiveType},
	{"content/env_ship/", ShipType},
	{"content/", WorldType},
}

func gearType(p string) string {
	for _, d := range gearDirs {
		if strings.HasPrefix(p, d.prefix) {
			return d.typ
		}
	}
	return ""
}

var gearWords = strings.NewReplacer("Aa ", "AA ", "Sos ", "SOS ", "Gpmg", "GPMG", "Hmg", "HMG", "Lmg", "LMG", "Smg", "SMG",
	"Pdw", "PDW", "Emp ", "EMP ", "He ", "HE ", "At ", "AT ", "Vfx", "VFX", "Mm ", "mm ", "Se ", "SE ", "Cctv", "CCTV",
	"Icbm", "ICBM", "Sam ", "SAM ", "Tcs ", "TCS ", "Kg ", "kg ")

// gearName: LUT Studio's name for gear units of the same LUTs: up to 3 by their names ("Ammo Box / Flag Rack"),
// more by the words their names start with, else by their common folder ("Bridge Personnel (8 models)")
func gearName(typ string, paths []string) string {
	base := func(p string) string { return strings.TrimPrefix(path.Base(p), "cha_") }
	pretty := func(s string) string {
		return strings.TrimSpace(gearWords.Replace(title(strings.ReplaceAll(s, "_", " ")) + " "))
	}
	if len(paths) <= 3 {
		var names []string
		for _, p := range paths {
			if n := pretty(base(p)); !slices.Contains(names, n) {
				names = append(names, n)
			}
		}
		return typ + ": " + strings.Join(names, " / ")
	}
	words := strings.Split(base(paths[0]), "_")
	dir := path.Dir(paths[0])
	for _, p := range paths[1:] {
		w := strings.Split(base(p), "_")
		n := 0
		for n < len(words) && n < len(w) && words[n] == w[n] {
			n++
		}
		words = words[:n]
		for !strings.HasPrefix(p, dir+"/") && dir != "." && dir != "/" {
			dir = path.Dir(dir)
		}
	}
	n := strings.Join(words, "_")
	if len(n) < 4 { // nothing or too little in common ("xl"): their folder
		n = path.Base(dir)
	}
	return fmt.Sprintf("%s: %s (%d models)", typ, pretty(n), len(paths))
}

// addCloth: a weapon's cape-shader cloth (the CQC-1 One True Flag's flag) as a piece of the weapon kit, its cape
// LUT edited like a cape's; the weapon tables only name the weapon's painted materials.
func (g *Game) addCloth(kits []Kit) {
	for i := range kits {
		k := &kits[i]
		if k.Type != WeaponType {
			continue
		}
		have := map[string]bool{}
		for _, p := range k.Pieces {
			have[p.CapeLUT] = true
		}
		for _, u := range k.Units {
			h, err := lut.ParseHash(u.Unit)
			if err != nil {
				continue
			}
			for _, d := range g.unitDefaultLUTs(stingray.Hash{Value: h}) {
				c := d.cape
				if c.lut.Value == 0 || have[hashOrEmpty(c.lut)] {
					continue
				}
				name, ok := thinName(d.slot)
				if !ok {
					name = fmt.Sprintf("0x%08x", d.slot)
				}
				k.Pieces = append(k.Pieces, Piece{Unit: u.Unit, Slot: name, PieceType: "cape", Body: "any",
					MaterialLUT: hashOrEmpty(d.lut), CapeLUT: hashOrEmpty(c.lut), CapeGradient: hashOrEmpty(c.gradient),
					DecalSheet: hashOrEmpty(c.decalSheet), DecalScalarFields: hashOrEmpty(c.scalarFields),
					BaseData: hashOrEmpty(c.baseData)})
				have[hashOrEmpty(c.lut)] = true
			}
		}
	}
}

func shorterPath(a, b string) bool { return len(a) < len(b) || len(a) == len(b) && a < b }

// gearKits: the units with a material LUT no kit of existing uses: named ones by their folder, then the units of no
// known path (named from clues, hints.go). Attachments a weapon's menus offer are left out (edited on the weapon);
// a gear unit in the folder of a weapon's or backpack's unit is added to those kits instead (existing is changed).
func (g *Game) gearKits(existing []Kit) []Kit {
	knownName(stingray.Hash{}) // (fills knownTable)
	have := map[string]bool{}
	for _, k := range existing {
		for _, p := range k.Pieces {
			have[p.MaterialLUT], have[p.CapeLUT] = true, true
		}
	}
	type group struct {
		kit   Kit
		paths []string // the kit's unit first
	}
	groups := map[string]*group{} // by type + LUT set
	// attachments a weapon's menus offer are edited on that weapon, not on their own
	offered := map[string]bool{}
	// weapons and backpacks by the folders of their units: a gear unit of such a folder (the machete's sheath) is
	// shown and edited with them
	byDir := map[string][]int{}
	for i, k := range existing {
		if k.Type != WeaponType && k.Type != BackpackType {
			continue
		}
		for _, u := range k.Units {
			if u.Name != "" && !strings.Contains(u.Name, "/attachment/") && !slices.Contains(byDir[path.Dir(u.Name)], i) {
				byDir[path.Dir(u.Name)] = append(byDir[path.Dir(u.Name)], i)
			}
		}
		var ent uint64
		if k.Type == WeaponType && strings.HasPrefix(k.ID, "w") {
			fmt.Sscanf(k.ID[1:], "%x", &ent)
			if slots, err := g.WeaponOptions(ent, true); err == nil {
				for _, s := range slots {
					for _, o := range s.Options {
						for _, u := range o.Units {
							offered[u.Unit] = true
						}
					}
				}
			}
		}
	}
	add := func(h stingray.Hash, p, typ string) {
		if offered[lut.HashString(h.Value)] { // (an unnamed one too: the laser focusing attachment)
			return
		}
		if !g.hasMeshes(h) { // (a unit with materials but no geometry, the tank autocannon turret placeholder: nothing to show)
			return
		}
		k := Kit{ID: fmt.Sprintf("%s%016x", gearIDPrefix, h.Value), Type: typ,
			Units: []KitUnit{{Unit: lut.HashString(h.Value), Name: p}}}
		fresh := false
		var luts []string
		for _, d := range g.unitDefaultLUTs(h) {
			name, ok := thinName(d.slot)
			if !ok {
				name = fmt.Sprintf("0x%08x", d.slot)
			}
			pc := Piece{Unit: lut.HashString(h.Value), Slot: name, PieceType: strings.ToLower(typ), Body: "any",
				MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern)}
			if c := d.cape; c.lut.Value != 0 { // cloth (the melee flag): edited like a cape
				pc.CapeLUT, pc.CapeGradient, pc.DecalSheet = hashOrEmpty(c.lut), hashOrEmpty(c.gradient), hashOrEmpty(c.decalSheet)
				pc.DecalScalarFields, pc.BaseData = hashOrEmpty(c.scalarFields), hashOrEmpty(c.baseData)
				luts = append(luts, pc.CapeLUT)
				fresh = fresh || !have[pc.CapeLUT]
			}
			k.Pieces = append(k.Pieces, pc)
			luts = append(luts, pc.MaterialLUT)
			fresh = fresh || (pc.MaterialLUT != "" && !have[pc.MaterialLUT])
		}
		if !fresh {
			return
		}
		if ks := byDir[path.Dir(p)]; len(ks) > 0 && (typ == GearType || typ == AttachmentType) {
			for _, i := range ks {
				existing[i].Units = append(existing[i].Units, KitUnit{Unit: lut.HashString(h.Value), Name: p})
				for _, pc := range k.Pieces {
					pc.PieceType = strings.ToLower(existing[i].Type)
					existing[i].Pieces = append(existing[i].Pieces, pc)
				}
			}
			for _, pc := range k.Pieces {
				have[pc.MaterialLUT], have[pc.CapeLUT] = true, true
			}
			return
		}
		sort.Strings(luts)
		key := typ + " " + strings.Join(luts, ",")
		gr := groups[key]
		if gr == nil {
			gr = &group{}
			groups[key] = gr
		}
		gr.paths = append(gr.paths, p)
		if len(gr.paths) == 1 || shorterPath(p, gr.kit.Units[0].Name) {
			gr.kit = k
		}
	}
	named := map[uint64]bool{}
	// (in a fixed order: a unit joining a kit decides whether a later one with the same LUTs still brings a new one)
	for _, v := range slices.Sorted(maps.Keys(knownTable)) {
		p := knownTable[v]
		typ := gearType(p)
		if typ == "" {
			continue
		}
		h := stingray.Hash{Value: v}
		if !g.isUnit(h) {
			continue
		}
		named[v] = true
		add(h, p, typ)
	}
	unitType := stingray.Sum("unit")
	var rest []uint64
	for id := range g.data.Files {
		if id.Type == unitType && !named[id.Name.Value] {
			if _, ok := knownTable[id.Name.Value]; !ok {
				rest = append(rest, id.Name.Value)
			}
		}
	}
	slices.Sort(rest)
	for _, v := range rest {
		add(stingray.Hash{Value: v}, lut.HashString(v), UnitType)
	}
	// named groups first (their names are clues for the unnamed ones)
	var kits []Kit
	var unnamed []*group
	for _, gr := range groups {
		first := gr.kit.Units[0].Name
		sort.Slice(gr.paths, func(i, j int) bool {
			a, b := gr.paths[i], gr.paths[j]
			return a == first || b != first && shorterPath(a, b)
		})
		if gr.kit.Type == UnitType {
			unnamed = append(unnamed, gr)
			continue
		}
		gr.kit.Name = gearName(gr.kit.Type, gr.paths)
		kits = append(kits, gr.kit)
	}
	if len(unnamed) > 0 {
		clues := g.newUnitClues(append(append([]Kit(nil), existing...), kits...))
		for _, gr := range unnamed {
			var hs []stingray.Hash
			for _, p := range gr.paths {
				var v uint64
				fmt.Sscanf(p, "0x%x", &v)
				hs = append(hs, stingray.Hash{Value: v})
			}
			if typ, name, ok := clues.name(hs, gr.kit.Pieces); ok {
				gr.kit.Type, gr.kit.Name = typ, typ+": "+name
				for i := range gr.kit.Pieces {
					gr.kit.Pieces[i].PieceType = strings.ToLower(typ)
				}
			} else {
				gr.kit.Name = unnamedUnitName + gr.paths[0]
			}
			if len(gr.paths) > 1 {
				gr.kit.Name += fmt.Sprintf(" (%d models)", len(gr.paths))
			}
			kits = append(kits, gr.kit)
		}
	}
	sort.Slice(kits, func(i, j int) bool {
		return kits[i].Name < kits[j].Name || kits[i].Name == kits[j].Name && kits[i].ID < kits[j].ID
	})
	// the same name twice (other LUTs): numbered
	seen := map[string]int{}
	for i := range kits {
		if seen[kits[i].Name]++; seen[kits[i].Name] > 1 {
			kits[i].Name += fmt.Sprintf(" #%d", seen[kits[i].Name])
		}
	}
	return kits
}
