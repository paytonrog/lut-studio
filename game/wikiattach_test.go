package game

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/xypwn/filediver/stingray"
)

// The embedded wiki table and the name / caliber parsing the matching uses (no install needed).
func TestWikiTable(t *testing.T) {
	wa := WikiAttachments()
	if len(wa.Weapons) < 40 || wa.License == "" || !strings.Contains(wa.License, "BY-NC-SA") || wa.Source == "" {
		t.Fatalf("wikiattach.json: %d weapons, license %q, source %q", len(wa.Weapons), wa.License, wa.Source)
	}
	lib := wikiList("AR-23 Liberator")
	if lib["DRUM MAGAZINE"] != 24 || lib["2X TUBE RED DOT"] != 1 || lib["COMPENSATOR"] != 22 {
		t.Errorf("Liberator: %v", lib)
	}
	for in, want := range map[string]string{"AR-23 Liberator": "LIBERATOR", "SMG/FLAM-34 Stoker": "STOKER",
		"SG-225SP Breaker Spray&Pray": "BREAKER SPRAY&PRAY", "AR/GL-21 One-Two": "ONE-TWO", "R-63CS Diligence Counter Sniper": "DILIGENCE COUNTER SNIPER"} {
		if got := wikiKey(in); got != want {
			t.Errorf("wikiKey(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string][2]string{"Rifle 5,5x50mm. Drum": {"Rifle 5,5x50mm", "5"}, "5.5mm. Naked": {"5.5mm", "5"},
		"5mm. Muzzle brake Custom Karbin": {"5mm", "5"}, "SHOTGUN 12g. Drum Light": {"SHOTGUN 12g", "12g"}, "12mm. Compensator": {"12mm", "12"},
		"Laser Heatsink (Blaster). Standard": {"Laser Heatsink (Blaster)", ""}, "TUBE REDDOT 1,5x": {"", ""}, "RIFLE 9x70mm. Extended": {"RIFLE 9x70mm", "9"}} {
		if f := family(in); f != want[0] || caliber(f) != want[1] {
			t.Errorf("%q: family %q caliber %q, want %v", in, f, caliber(f), want)
		}
	}
}

// Every weapon the wiki lists: found in the game, every listed attachment matched to an item, the default among
// the choices; the Liberator's menus as the game shows them (checked in game), and the weapon-specific twins.
func TestWeaponOptionsWiki(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.weaponTables(); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	menus := map[string]map[string]string{} // weapon -> slot -> "name lvl, ..." (internal names in brackets)
	for ent := range g.weaponComps {
		name := g.weaponNames[ent]
		listed := wikiList(name)
		if listed == nil {
			continue
		}
		if _, ok := g.weaponUnit(ent); !ok {
			continue
		}
		found[wikiKey(name)] = true
		slots, err := g.WeaponOptions(ent.Value, false)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		menus[name] = map[string]string{}
		for _, s := range slots {
			var list []string
			hasDefault := false
			for _, o := range s.Options {
				hasDefault = hasDefault || o.ID == s.Default
				got[wikiName(o.Name)] = true
				dbg := ""
				if it, ok := g.weaponItemMap[parseID(o.ID)]; ok {
					dbg = " [" + strings.TrimSpace(it.DebugName) + "]"
				}
				list = append(list, fmt.Sprintf("%s %d%s", o.Name, o.Level, dbg))
				if o.ID != "" && (len(o.Units) == 0 || o.Units[0].Mount != s.Mount) {
					t.Errorf("%s %s %s: units %+v", name, s.Slot, o.Name, o.Units)
				}
			}
			if !s.Listed || !hasDefault {
				t.Errorf("%s %s: listed %v, default %s not among %v", name, s.Slot, s.Listed, s.Default, list)
			}
			menus[name][s.Slot] = strings.Join(list, ", ")
		}
		for n := range listed {
			if !strings.HasPrefix(n, "NO ") && !got[n] {
				t.Errorf("%s: %s (wiki) not offered", name, n)
			}
		}
	}
	for k := range WikiAttachments().Weapons {
		if !found[k] {
			t.Errorf("wiki weapon %s: no weapon of that name in the game", k)
		}
	}
	want := map[string]string{
		"Optics":      "2x Tube Red Dot 1 [TUBE REDDOT 2x], Reflex Sight 4 [REFLEX SIGHT], Holographic Sight 8 [HOLOGRAPHIC SIGHT], Reflex Sight Mk2 11 [REFLEX SIGHT MKII], Iron Sight 18 [Iron Sights], 4x Combat Scope 21 [COMBAT SCOPE 4x]",
		"Magazine":    "Extended Magazine 1 [Rifle 5,5x50mm. Extended], Short Magazine 14 [Rifle 5,5x50mm. Standard], Drum Magazine 24 [Rifle 5,5x50mm. Drum]",
		"Muzzle":      "Standard 1 [No Muzzle], Flash Hider 3 [5,5mm. Flash Hider], Muzzle Brake 12 [5,5mm. Muzzle break], Compensator 22 [5,5mm. Compensator]",
		"Underbarrel": "Laser Sight w/ Flashlight 1 [Laser Sight Flashlight], None 1, Vertical Foregrip 2 [Vertical Grip], Angled Foregrip 6 [Angled Foregrip], Flashlight Vertical Foregrip 16 [Vertical Grip Flashlight], Laser Sight Angled Foregrip 23 [Angled Foregrip With Laser]",
	}
	for s, w := range want {
		if got := menus["AR-23 Liberator"][s]; got != w {
			t.Errorf("Liberator %s:\n got  %s\n want %s", s, got, w)
		}
	}
	for weapon, sub := range map[string][]string{
		"AR-23A Liberator Carbine":        {"[Rifle 5,5x50mm. Drum Carbine]", "[Rifle 5,5x50mm. Standard Fastreload]", "[5mm. Muzzle brake Custom Karbin]"},
		"AR-23P Liberator Penetrator":     {"[5,5mm. Muzzle brake Custom Penetrator]"},
		"SMG-72 Pummeler":                 {"[SMG 12x25mm. Drum Pummeler]"},
		"SG-8 Punisher":                   {"Duckbill 22 [10g. Duckbill]"},
		"LAS-12 Sai":                      {"Triple Lens 1 [Laser. Blaster Standard]", "[Laser Heatsink (Blaster). Improved Heatcapacity]"},
		"SMG/FLAM-34 Stoker":              {"[8mm. Compensator]"},
		"R-63CS Diligence Counter Sniper": {"[9mm. Flash Hider]"},
	} {
		all := fmt.Sprint(menus[weapon])
		for _, s := range sub {
			if !strings.Contains(all, s) {
				t.Errorf("%s: no %s in %s", weapon, s, all)
			}
		}
	}
	// a weapon variant shows its own model from a sibling folder (SG-8S Slugger), else its base model (SG-20 Halt)
	if u, ok := g.weaponUnit(stingray.Hash{Value: 0x4f749e2ee26f532d}); !ok || u != stingray.Sum("content/fac_helldivers/equipment/primary_weapons/pump_shotgun_slug/pump_shotgun_slug") {
		t.Errorf("Slugger unit %v %v", u, ok)
	}
	halt := stingray.Sum("content/fac_helldivers/equipment/primary_weapons/pump_shotgun_02/pump_shotgun_stun")
	if u, ok := g.weaponUnit(halt); !ok || u != stingray.Sum("content/fac_helldivers/equipment/primary_weapons/pump_shotgun_02/pump_shotgun_02") {
		t.Errorf("Halt unit %v %v", u, ok)
	}
}

// Backpacks: one kit per named backpack, its parts together (the Maxigun's hose, the Guard Dog's drone and gun).
func TestBackpackKits(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := g.BuildIndex("English (US)")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Kit{}
	for _, k := range idx.Kits {
		if k.Type == BackpackType {
			got[k.Name] = k
			var us []string
			for _, u := range k.Units {
				us = append(us, u.Name[strings.LastIndex(u.Name, "/")+1:])
			}
			t.Logf("%-36s %s: %d pieces, units %v", k.Name, k.ID, len(k.Pieces), us)
		}
	}
	if len(got) < 20 {
		t.Fatalf("%d backpacks", len(got))
	}
	jp := got["LIFT-850 Jump Pack"]
	if !slices.ContainsFunc(jp.Pieces, func(p Piece) bool { return p.MaterialLUT == "0xad8c301591e69c42" }) {
		t.Errorf("jump pack pieces %+v", jp.Pieces)
	}
	if len(got["Maxigun Backpack"].Units) != 2 || len(got["AX/AR-23 Guard Dog"].Units) < 3 || len(got["AX/FLAM-75 Hot Dog"].Units) != 3 {
		t.Errorf("maxigun %v, guard dog %v, hot dog %v", got["Maxigun Backpack"].Units, got["AX/AR-23 Guard Dog"].Units, got["AX/FLAM-75 Hot Dog"].Units)
	}
}

// SEAF items and the Bastion's cannon are in the index (from the data-library tables and the install).
func TestSEAFAndBastion(t *testing.T) {
	_, idx := install(t)
	seaf, cannon := map[string]bool{}, 0
	for _, k := range idx.Kits {
		if k.Type == SEAFType {
			seaf[k.Name] = true
		}
		for _, u := range k.Units {
			if strings.HasSuffix(u.Name, "/tank_cannon") && strings.HasPrefix(k.Name, "Bastion") {
				cannon++
			}
		}
		// the cannon's piece names its slot by hash, as the preview reads the slot of the cannon's material
		for _, p := range k.Pieces {
			if p.Unit == "0x1fa1f596769225c2" && p.Slot != "0xba24ab63" {
				t.Errorf("%s: cannon piece slot %q", k.Name, p.Slot)
			}
		}
	}
	if !seaf["SEAF Soldier"] || !seaf["SEAF Cargo Backpack"] || !seaf["SEAF Artillery Shell: Napalm"] {
		t.Errorf("SEAF kits %v", seaf)
	}
	if cannon == 0 {
		t.Error("no Bastion kit shows the cannon")
	}
	t.Logf("%d SEAF kits, %d Bastion kits with the cannon", len(seaf), cannon)
}

// TestPatternDrawn: True Blue's shared pattern LUT (0x4cac10858d877485, beige) has no mask to draw with on any
// vehicle skin, so the index lists only the armors and helmets whose stripes it colors (the AF-91 Field Chemist
// helmet among them) as its users.
func TestPatternDrawn(t *testing.T) {
	g, idx := install(t)
	hellpod := false
	for _, k := range idx.Kits {
		if k.Type == VehicleType && strings.HasPrefix(k.Name, "Hellpod: True Blue") {
			hellpod = true
			if g.PatternDrawn(k.Pieces[0].Unit, k.Pieces[0].Slot) {
				t.Errorf("%s: pattern drawn on a vehicle", k.Name)
			}
		}
	}
	users := idx.Users()["0x4cac10858d877485"]
	af91 := false
	for _, u := range users {
		af91 = af91 || strings.HasPrefix(u, "AF-91 Field Chemist")
		for _, k := range idx.Kits {
			if k.Type == VehicleType && strings.HasPrefix(u, k.Name+" (") {
				t.Errorf("listed as a user: %s", u)
			}
		}
	}
	if !hellpod || !af91 {
		t.Errorf("True Blue hellpod found: %v; users: %v", hellpod, users)
	}
}

// TestGearKits: every other unit with LUTs no other kit has (throwables, attachments, stratagems, gear, craft, the
// crew, Automatons, objectives, props, unnamed units), each a kit of its own; most unnamed units get a category and
// a name from clues (hints.go); the CQC-1 One True Flag has its cloth (a cape LUT)
func TestGearKits(t *testing.T) {
	_, idx := install(t)
	want := map[string]bool{"Throwable: Frag Grenade": false, "Throwable: Throwing Knife": false, "Stratagem: Hellbomb / Hellbomb Prop / Hellbomb Defunct": false,
		"Stratagem: Turret / Turret Prop": false, "Gear: Chemgun": false,
		"Craft: Eagle Bomb": false, "Crew: Bridge Personnel (8 models)": false, "Automaton: Berserker": false}
	byType, clued, cloth := map[string]int{}, 0, false
	for _, k := range idx.Kits {
		if strings.Contains(k.Name, " (unit ") {
			clued++
		}
		if k.Name == "CQC-1 One True Flag" {
			for _, p := range k.Pieces {
				cloth = cloth || p.CapeLUT == "0xb9b8dfa7d968ce98"
			}
		}
		switch k.Type {
		case ThrowableType, AttachmentType, StratagemType, GearType, CraftType, CrewType, AutomatonType, IlluminateType,
			ObjectiveType, ShipType, WorldType, ArmorPieceType, UnitType:
			byType[k.Type]++
			if len(k.Pieces) == 0 {
				t.Errorf("%s: no pieces", k.Name)
			}
			if _, ok := want[k.Name]; ok {
				want[k.Name] = true
			}
		}
	}
	for n, ok := range want {
		if !ok {
			t.Errorf("no kit %q", n)
		}
	}
	if byType[ThrowableType] < 20 || byType[StratagemType] < 10 || byType[AttachmentType] > 3 || byType[GearType] < 4 ||
		byType[AutomatonType] < 30 || byType[WorldType] < 50 || clued < 60 || byType[UnitType] > 30 || byType[ArmorPieceType] < 10 || !cloth {
		t.Errorf("kits by type: %v; %d unnamed units named from clues; the flag's cloth: %v", byType, clued, cloth)
	}
}

// TestSameModel: kits the game doesn't name, matched to the named kit of their models: the six unnamed recolors of
// the SC-34 Infiltrator and SC-30 Trailblazer Scout helmets; an unnamed GS-17 Frontier Marshal (its colors too)
func TestSameModel(t *testing.T) {
	_, idx := install(t)
	hex := func(n string) bool {
		n = strings.ToLower(n)
		return len(n) >= 6 && len(n) <= 8 && strings.Trim(n, "0123456789abcdef") == ""
	}
	same := idx.SameModel(func(k Kit) bool { return !hex(k.Name) })
	for id, want := range map[string]string{"0x5c1a87d2": "SC-34 Infiltrator", "0x9b5bc520": "SC-30 Trailblazer Scout",
		"0x1348e7c7": "GS-17 Frontier Marshal"} {
		if got := same[id]; got.Name != want || !got.All {
			t.Errorf("%s: %+v, want all of %s's models", id, got, want)
		}
	}
	if !same["0x1348e7c7"].Colors {
		t.Errorf("0x1348e7c7: not GS-17 Frontier Marshal's colors")
	}
}

// TestWeaponParts: weapons show their own models (SG-8S Slugger, SMG-72 Pummeler: in a sibling folder) and the
// gear of their folder (CQC-42's machete sheath); attachments a weapon offers (the muzzles) are no kit of their own
func TestWeaponParts(t *testing.T) {
	_, idx := install(t)
	want := map[string]string{"SG-8S Slugger": "/pump_shotgun_slug/pump_shotgun_slug", "SMG-72 Pummeler": "/personal_defense_weapon_pepper/",
		"CQC-42": "/machete/machete_sheath"}
	found := map[string]bool{}
	for _, k := range idx.Kits {
		if strings.Contains(k.Name, "Muzzle") && k.Type == AttachmentType {
			t.Errorf("%s: an attachment weapons offer is its own kit", k.Name)
		}
		if w, ok := want[k.Name]; ok {
			for _, u := range k.Units {
				found[k.Name] = found[k.Name] || strings.Contains(u.Name, w)
			}
		}
	}
	for n := range want {
		if !found[n] {
			t.Errorf("%s: no unit %s", n, want[n])
		}
	}
}
