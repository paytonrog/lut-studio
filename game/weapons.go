package game

import (
	"encoding/binary"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/xypwn/filediver/app"
	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/datalibrary/enum"
	"github.com/xypwn/filediver/stingray"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"lutstudio/lut"
)

// Weapons: a weapon's default look is its materials' own LUTs; a
// weapon paint scheme (11, shared by all 56 paintable weapons) is an entity delta that rewrites the weapon's
// WeaponCustomizationComponent.MaterialOverride, whose records set LUTs per material id. Each weapon is one kit of
// type "Weapon" (its default LUTs) and, if it takes paint schemes, one kit per scheme (that scheme's LUTs on it;
// Skin = the glTF material variant filediver exports for the scheme). Weapons use the vehicle / weapon shader
// family (no clearcoat).

const WeaponType = "Weapon"

// weaponUnits: the weapon entities whose unit has another name (filediver's getWeaponEntityHashFromUnitHash,
// reversed): entity -> unit.
var weaponUnits = map[uint64]string{
	0x43cb1033961a2276: "content/fac_helldivers/equipment/primary_weapons/assault_rifle_penetrator/assault_rifle_penetrator",
	0x4c786785c79d44e7: "content/fac_helldivers/equipment/primary_weapons/marksman_rifle_vigilance_counter_sniper/marksman_rifle_vigilance_counter_sniper",
	0x5ebaea70c0d060b9: "content/fac_helldivers/equipment/primary_weapons/assault_shotgun_sprayandpray/assault_shotgun_sprayandpray",
	0xb6aff2195568767f: "content/fac_helldivers/equipment/primary_weapons/jet_rifle_phoenix/jet_rifle_phoenix",
	0xcf5f176e0e322be1: "content/fac_helldivers/equipment/primary_weapons/assault_rifle_explosive/assault_rifle_explosive",
	0xfb3a19078694708a: "content/fac_helldivers/equipment/primary_weapons/plasma_rifle_charge/plasma_rifle_charge",
}

// weaponUnit: the unit a weapon entity shows: its own (the entity's name, or weaponUnits), else its model in a
// sibling folder of its name (SG-8S Slugger: pump_shotgun/pump_shotgun_slug is pump_shotgun_slug/pump_shotgun_slug),
// else, for a hand weapon variant with no model of its own (SG-20 Halt, CQC-30), its folder's base unit
// (pump_shotgun/pump_shotgun). Drone mounts and sentries are left
// out (their folder unit is another model).
func (g *Game) weaponUnit(ent stingray.Hash) (stingray.Hash, bool) {
	unit := ent
	if n, ok := weaponUnits[ent.Value]; ok {
		unit = stingray.Sum(n)
	}
	if g.isUnit(unit) {
		return unit, true
	}
	path, _ := knownName(unit)
	i := strings.LastIndex(path, "/")
	if i < 0 || !strings.HasPrefix(path, "content/fac_helldivers/equipment/") || strings.Contains(path, "/drone_weapons/") {
		return unit, false
	}
	// its own model in a folder of its name (SG-8S Slugger: pump_shotgun/pump_shotgun_slug ->
	// pump_shotgun_slug/pump_shotgun_slug; SMG-72 Pummeler: …_pepper)
	if own := stingray.Sum(path[:strings.LastIndex(path[:i], "/")+1] + path[i+1:] + "/" + path[i+1:]); g.isUnit(own) {
		return own, true
	}
	dir := path[:i]
	base := stingray.Sum(dir + "/" + dir[strings.LastIndex(dir, "/")+1:])
	return base, g.isUnit(base)
}

func (g *Game) weaponKits(languageMap map[uint32]string) ([]Kit, error) {
	get := func(id stingray.FileID, typ stingray.DataType) ([]byte, bool, error) {
		b, err := g.data.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			return nil, false, nil
		}
		return b, err == nil, err
	}
	comps, err := datalib.ParseWeaponCustomizationComponents(get, languageMap)
	if err != nil {
		return nil, err
	}
	enc, _ := datalib.ParseEncyclopediaEntryComponents()
	items := g.weaponItems(get, languageMap)
	schemes, _ := app.LoadPaintSchemes(g.data, languageMap)
	deltas, _ := datalib.ParseEntityDeltas()
	thin := func(h stingray.ThinHash) string {
		if s, ok := thinName(h.Value); ok {
			return s
		}
		return fmt.Sprintf("0x%08x", h.Value)
	}
	var ents []stingray.Hash
	for e := range comps {
		ents = append(ents, e)
	}
	sort.Slice(ents, func(i, j int) bool { return ents[i].Value < ents[j].Value })
	var kits []Kit
	for _, ent := range ents {
		w := comps[ent]
		unit, ok := g.weaponUnit(ent)
		if !ok {
			continue
		}
		path, _ := knownName(unit)
		name := ""
		if e, ok := enc[ent]; ok {
			name = strings.TrimSpace(languageMap[e.Prefix] + " " + languageMap[e.LocName])
		}
		if name == "" {
			name = strings.ReplaceAll(path[strings.LastIndex(path, "/")+1:], "_", " ")
		}
		if name == "" {
			name = fmt.Sprintf("weapon 0x%016x", ent.Value)
		}
		units := append([]KitUnit{{Unit: lut.HashString(unit.Value), Name: path}}, g.weaponAttachments(w, items)...)
		all := []stingray.Hash{unit} // the weapon and its default attachments
		for _, u := range units[1:] {
			h, _ := lut.ParseHash(u.Unit)
			all = append(all, stingray.Hash{Value: h})
		}
		// slotUnit: which of them has a material slot (the weapon first)
		slotUnit := func(slot uint32) (stingray.Hash, bool) {
			for _, u := range all {
				if g.unitSlots(u)[slot] {
					return u, true
				}
			}
			return stingray.Hash{}, false
		}
		// default look: the materials' own LUTs, weapon and attachments
		k := Kit{ID: fmt.Sprintf("w%016x", ent.Value), Name: name, Type: WeaponType, Units: units}
		for _, u := range all {
			for _, d := range g.unitDefaultLUTs(u) {
				k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(u.Value), Slot: thin(stingray.ThinHash{Value: d.slot}),
					PieceType: "weapon", Body: "any", MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern)})
			}
		}
		if len(k.Pieces) == 0 {
			continue
		}
		kits = append(kits, k)
		// paint schemes
		if !slices.Contains(w.CustomizationSlots[:], enum.WeaponCustomizationSlot_PaintScheme) {
			continue
		}
		data, err := datalib.GetWeaponCustomizationComponentDataForHash(ent)
		if err != nil {
			continue
		}
		for _, ps := range schemes {
			delta, ok := deltas[ps.AddPath]
			if !ok || ps.NameUpper == "DEFAULT" {
				continue
			}
			patched, err := datalib.PatchComponent(datalib.Sum("WeaponCustomizationComponentData"), data, delta)
			if err != nil {
				continue
			}
			var c datalib.WeaponCustomizationComponent
			if _, err := binary.Decode(patched, binary.LittleEndian, &c); err != nil {
				continue
			}
			scheme := titleName(ps.NameUpper) // filediver's glTF variant name
			sk := Kit{ID: fmt.Sprintf("w%016x.%08x", ent.Value, ps.ID.Value), Name: name + ": " + scheme + " paint scheme",
				Type: WeaponType, Units: units}
			seen := map[string]bool{}
			add := func(o datalib.UnitCustomizationMaterialOverrides) {
				// (a scheme's records cover every weapon material type: only the ones this weapon or its attachments have)
				if o.MaterialID.Value == 0 || o.MaterialLut.Value == 0 {
					return
				}
				on, ok := slotUnit(o.MaterialID.Value)
				if !ok {
					return
				}
				key := fmt.Sprintf("%08x %016x", o.MaterialID.Value, o.MaterialLut.Value)
				if seen[key] {
					return
				}
				seen[key] = true
				sk.Pieces = append(sk.Pieces, Piece{Unit: lut.HashString(on.Value), Slot: thin(o.MaterialID), PieceType: "weapon",
					Body: "any", MaterialLUT: hashOrEmpty(o.MaterialLut), PatternLUT: hashOrEmpty(o.PatternLut),
					DecalSheet: hashOrEmpty(o.DecalSheet), Skin: scheme})
			}
			for _, o := range c.MaterialOverride.DefaultWeaponSlotMaterial {
				add(o)
			}
			for _, s := range c.MaterialOverride.WeaponSlotMaterialCustomization {
				for _, o := range s.Overrides {
					add(o)
				}
			}
			if len(sk.Pieces) > 0 {
				kits = append(kits, sk)
			}
		}
	}
	return kits, nil
}

// weaponItems: every weapon customization item (attachments, paint schemes...) by id.
func (g *Game) weaponItems(get datalib.GetResourceFunc, languageMap map[uint32]string) map[uint32]datalib.WeaponCustomizableItem {
	out := map[uint32]datalib.WeaponCustomizableItem{}
	settings, err := datalib.ParseWeaponCustomizationSettings(get, languageMap)
	if err != nil {
		return out
	}
	for _, s := range settings {
		for _, it := range s.Items {
			out[it.ID.Value] = it
		}
	}
	return out
}

// attachMount: the weapon unit's node an attachment of a slot mounts on.
var attachMount = map[enum.WeaponCustomizationSlot]string{
	enum.WeaponCustomizationSlot_Optics: "attach_optic", enum.WeaponCustomizationSlot_Magazine: "attach_mag",
	enum.WeaponCustomizationSlot_Muzzle: "attach_muzzle", enum.WeaponCustomizationSlot_Underbarrel: "attach_underbarrel",
}

// weaponAttachments: the units a weapon shows by default, with their mount nodes: its default customization per
// slot (the item's unit, or the units of its package when the item names a package), else the component's own
// optics / magazine / muzzle paths (weapons without customization).
func (g *Game) weaponAttachments(w datalib.WeaponCustomizationComponent, items map[uint32]datalib.WeaponCustomizableItem) []KitUnit {
	var out []KitUnit
	done := map[enum.WeaponCustomizationSlot]bool{}
	add := func(u stingray.Hash, slot enum.WeaponCustomizationSlot) {
		if u.Value == 0 || !g.isUnit(u) {
			return
		}
		for _, x := range out {
			if x.Unit == lut.HashString(u.Value) {
				return
			}
		}
		name, _ := knownName(u)
		out = append(out, KitUnit{Unit: lut.HashString(u.Value), Name: name, Mount: attachMount[slot]})
		done[slot] = true
	}
	for _, d := range w.DefaultCustomizations {
		if _, ok := attachMount[d.Slot]; !ok || d.Customization.Value == 0 {
			continue
		}
		it, ok := items[d.Customization.Value]
		if !ok || it.AddPath.Value == 0 {
			continue
		}
		if g.isUnit(it.AddPath) {
			add(it.AddPath, d.Slot)
			continue
		}
		for _, u := range g.packageUnitsByHash(it.Archive) { // an item naming a package: its units
			add(u, d.Slot)
		}
	}
	for slot, p := range map[enum.WeaponCustomizationSlot]stingray.Hash{enum.WeaponCustomizationSlot_Optics: w.OpticsPath,
		enum.WeaponCustomizationSlot_Magazine: w.MagazinePath, enum.WeaponCustomizationSlot_Muzzle: w.MuzzlePath} {
		if !done[slot] {
			add(p, slot)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Mount < out[j].Mount })
	return out
}

// AttachOption is one attachment a weapon can show in a slot.
type AttachOption struct {
	ID    string    `json:"id"` // item id (0x + 8 hex); "" = nothing in the slot
	Name  string    `json:"name"`
	Level int       `json:"level,omitempty"` // the weapon level that unlocks it in the game (wiki list); 0 = not known
	Units []KitUnit `json:"units"`
}

// AttachSlot is a weapon's attachment slot: its mount node, its choices, and the weapon's default choice. Listed:
// the choices are the ones the game offers this weapon (the wiki's list, wikiattach.go); else every attachment of
// the slot that fits (same magazine family, muzzles of the weapon's caliber).
type AttachSlot struct {
	Slot    string         `json:"slot"`
	Mount   string         `json:"mount"`
	Default string         `json:"default"`
	Listed  bool           `json:"listed"`
	Options []AttachOption `json:"options"`
}

// weaponTables: the weapon components, customization items and weapon names (WeaponOptions' tables), read once:
// from the item table in use, else from the data-library tables.
func (g *Game) weaponTables() error {
	g.weaponOnce.Do(func() {
		if g.table != nil {
			g.weaponComps, g.weaponItemMap, g.weaponNames = g.weaponDataFromTable()
			return
		}
		g.weaponComps, g.weaponItemMap, g.weaponNames, g.weaponErr = g.loadWeaponData(g.english())
	})
	return g.weaponErr
}

// loadWeaponData reads the weapon components, customization items and weapon names from the data-library tables,
// names from lang.
func (g *Game) loadWeaponData(lang map[uint32]string) (map[stingray.Hash]datalib.WeaponCustomizationComponent,
	map[uint32]datalib.WeaponCustomizableItem, map[stingray.Hash]string, error) {
	get := func(id stingray.FileID, typ stingray.DataType) ([]byte, bool, error) {
		b, err := g.data.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			return nil, false, nil
		}
		return b, err == nil, err
	}
	comps, err := datalib.ParseWeaponCustomizationComponents(get, lang)
	if err != nil {
		return nil, nil, nil, err
	}
	items := g.weaponItems(get, lang)
	names := map[stingray.Hash]string{}
	enc, _ := datalib.ParseEncyclopediaEntryComponents()
	for e := range comps {
		if c, ok := enc[e]; ok {
			if n := strings.TrimSpace(lang[c.Prefix] + " " + lang[c.LocName]); n != "" {
				names[e] = n
			}
		}
	}
	return comps, items, names, nil
}

// itemUnits: the units an attachment item shows (its unit, or its package's units when the item names a package).
func (g *Game) itemUnits(it datalib.WeaponCustomizableItem) []KitUnit {
	var hs []stingray.Hash
	if g.isUnit(it.AddPath) {
		hs = []stingray.Hash{it.AddPath}
	} else {
		hs = g.packageUnitsByHash(it.Archive)
	}
	var out []KitUnit
	for _, h := range hs {
		if g.isUnit(h) {
			name, _ := knownName(h)
			out = append(out, KitUnit{Unit: lut.HashString(h.Value), Name: name})
		}
	}
	return out
}

// itemName: an item's in-game name, else its internal name title-cased.
func itemName(it datalib.WeaponCustomizableItem) string {
	if it.NameCased != "" {
		return it.NameCased
	}
	return title(it.DebugName)
}

// family: the part of an item's internal name before ". " ("Rifle 5,5x50mm. Drum" -> "Rifle 5,5x50mm",
// "5.5mm. Naked" -> "5.5mm", "12g. Duckbill" -> "12g"; "" without one).
func family(debug string) string {
	debug = strings.TrimSpace(debug)
	if i := strings.Index(debug, ". "); i > 0 {
		return strings.TrimSpace(debug[:i])
	}
	if strings.HasSuffix(debug, ".") {
		return strings.TrimSuffix(debug, ".")
	}
	return ""
}

// caliber: a family's caliber, its first number's whole part, "g" kept for shotgun gauges ("Rifle 5,5x50mm",
// "5.5mm", "5mm" -> "5"; "SHOTGUN 12g" -> "12g"; "SMG 12x25mm" -> "12"), so muzzles match magazines and ammo.
func caliber(fam string) string {
	for _, f := range strings.Fields(fam) {
		if f[0] < '0' || f[0] > '9' {
			continue
		}
		n := 0
		for n < len(f) && f[n] >= '0' && f[n] <= '9' {
			n++
		}
		if strings.HasPrefix(strings.TrimLeft(f[n:], "0123456789.,"), "g") {
			return f[:n] + "g"
		}
		return f[:n]
	}
	return ""
}

// wordAlias: internal-name spellings -> the word in weapon names
var wordAlias = map[string]string{"karbin": "carbine", "tenderdizer": "tenderizer"}

// words: the lower-case words of a name (3+ letters).
func words(s string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return r < 'a' || r > 'z' }) {
		if a, ok := wordAlias[w]; ok {
			w = a
		}
		if len(w) >= 3 {
			out = append(out, w)
		}
	}
	return out
}

// matchWord: a word is in the context (equal, or the same first 5 letters).
func matchWord(w string, ctx []string) bool {
	for _, c := range ctx {
		if c == w || len(c) >= 5 && len(w) >= 5 && c[:5] == w[:5] {
			return true
		}
	}
	return false
}

func calNum(cal string) int { n, _ := strconv.Atoi(strings.TrimSuffix(cal, "g")); return n }

// muzzleCaliber: a muzzle unit's caliber ("muzzle_8mm_naked" -> 8, mm)
var muzzleCaliber = regexp.MustCompile(`^muzzle_(\d+)(mm|g)_`)

type attachCand struct {
	id    uint32
	it    datalib.WeaponCustomizableItem
	units []KitUnit
}

func (c attachCand) option(level int) AttachOption {
	return AttachOption{ID: fmt.Sprintf("0x%08x", c.id), Name: itemName(c.it), Level: level, Units: c.units}
}

// bestCand: of the same-named items of a slot (a "Muzzle Brake" per caliber and its weapon-specific twins), the one
// this weapon gets: its default item; else the one of its caliber and its default's family ("Rifle 5,5x50mm", not
// "Whisper Rifle 5,5x50mm") whose extra internal-name words ("Custom Penetrator", "Drum Carbine", "Fastreload") are
// in the weapon's name, unit or default items, the plain one otherwise; a tie goes to the one whose extra words are
// in name (the menu's name for it: "4x Combat Scope" is COMBAT SCOPE 4x, not the ION SCOPE 4x of game build
// 25988413). ok = false when every one is of another caliber.
func bestCand(cs []attachCand, def *datalib.WeaponCustomizableItem, wcal string, ctx, name []string) (attachCand, bool) {
	defFam := ""
	if def != nil {
		defFam = family(def.DebugName)
	}
	common := map[string]int{} // words every candidate has
	for _, c := range cs {
		seen := map[string]bool{}
		for _, w := range words(c.it.DebugName) {
			if !seen[w] {
				seen[w] = true
				common[w]++
			}
		}
	}
	best, bestScore, bestHits, ok := cs[0], -1<<30, 0, false
	for _, c := range cs {
		score, hits := 0, 0
		cal := caliber(family(c.it.DebugName))
		switch {
		case def != nil && c.id == def.ID.Value:
			score = 1000
		case cal != "" && wcal != "" && cal != wcal:
			score = -10
		case cal != "" && cal == wcal:
			score = 10
		}
		if score >= 0 {
			ok = true
		}
		if defFam != "" && family(c.it.DebugName) == defFam {
			score += 20
		}
		for _, w := range words(c.it.DebugName) {
			if common[w] == len(cs) {
				continue
			}
			if matchWord(w, ctx) {
				score += 5
			} else {
				score -= 2
			}
			if matchWord(w, name) {
				hits++
			}
		}
		if score > bestScore || score == bestScore && hits > bestHits {
			best, bestScore, bestHits = c, score, hits
		}
	}
	return best, ok
}

// WeaponOptions lists, per attachment slot of a weapon (entity hash), the attachments it can show. For a weapon
// the wiki lists (wikiattach.go), the ones the game offers it, with their unlock levels; with all, or for other
// weapons, every attachment that fits: magazines of the default's family, muzzles of the weapon's caliber, all
// optics and underbarrels (the game's menu offering fewer).
func (g *Game) WeaponOptions(ent uint64, all bool) ([]AttachSlot, error) {
	if err := g.weaponTables(); err != nil {
		return nil, err
	}
	w, ok := g.weaponComps[stingray.Hash{Value: ent}]
	if !ok {
		return nil, fmt.Errorf("no weapon 0x%016x", ent)
	}
	defs := map[enum.WeaponCustomizationSlot]*datalib.WeaponCustomizableItem{}
	for _, d := range w.DefaultCustomizations {
		if it, ok := g.weaponItemMap[d.Customization.Value]; ok && d.Customization.Value != 0 {
			defs[d.Slot] = &it
		}
	}
	// the weapon's caliber: its default magazine's, else its ammo's, else its default muzzle's, else its own bare
	// muzzle's ("muzzle_8mm_naked": the SMG/FLAM-34 Stoker)
	wcal := ""
	for _, sl := range []enum.WeaponCustomizationSlot{enum.WeaponCustomizationSlot_Magazine, enum.WeaponCustomizationSlot_AmmoType,
		enum.WeaponCustomizationSlot_Muzzle} {
		if d := defs[sl]; d != nil && wcal == "" {
			wcal = caliber(family(d.DebugName))
		}
	}
	if p, _ := knownName(w.MuzzlePath); wcal == "" && p != "" {
		if m := muzzleCaliber.FindStringSubmatch(p[strings.LastIndex(p, "/")+1:]); m != nil {
			wcal = m[1] + strings.TrimSuffix(m[2], "mm")
		}
	}
	name := g.weaponNames[stingray.Hash{Value: ent}]
	unit, _ := g.weaponUnit(stingray.Hash{Value: ent})
	upath, _ := knownName(unit)
	ctx := words(name + " " + upath)
	for _, d := range defs {
		ctx = append(ctx, words(d.DebugName)...)
	}
	var listed map[string]int
	if !all {
		listed = wikiList(name)
	}
	// the weapon's own part for a slot (the model a default with no unit of its own means: the bare muzzle)
	ownPath := map[enum.WeaponCustomizationSlot]stingray.Hash{enum.WeaponCustomizationSlot_Optics: w.OpticsPath,
		enum.WeaponCustomizationSlot_Magazine: w.MagazinePath, enum.WeaponCustomizationSlot_Muzzle: w.MuzzlePath}
	var out []AttachSlot
	for _, slot := range []enum.WeaponCustomizationSlot{enum.WeaponCustomizationSlot_Optics, enum.WeaponCustomizationSlot_Magazine,
		enum.WeaponCustomizationSlot_Muzzle, enum.WeaponCustomizationSlot_Underbarrel} {
		def := defs[slot]
		s := AttachSlot{Slot: strings.TrimPrefix(slot.String(), "WeaponCustomizationSlot_"), Mount: attachMount[slot]}
		if def != nil {
			s.Default = fmt.Sprintf("0x%08x", def.ID.Value)
		}
		// a default without a model of its own: the weapon's part (or nothing)
		var standard *AttachOption
		if def != nil && len(g.itemUnits(*def)) == 0 {
			if p := ownPath[slot]; g.isUnit(p) {
				pn, _ := knownName(p)
				standard = &AttachOption{ID: s.Default, Name: "Standard", Units: []KitUnit{{Unit: lut.HashString(p.Value), Name: pn, Mount: s.Mount}}}
			} else {
				s.Default = ""
			}
		}
		var cands []attachCand // every item of the slot with a model
		for id, it := range g.weaponItemMap {
			if len(it.Slots) == 0 || it.Slots[0] != slot || it.AddPath.Value == 0 || def != nil && id == def.ID.Value && standard != nil {
				continue
			}
			u := g.itemUnits(it)
			if len(u) == 0 {
				continue
			}
			for i := range u {
				u[i].Mount = s.Mount
			}
			cands = append(cands, attachCand{id, it, u})
		}
		sort.Slice(cands, func(i, j int) bool { return cands[i].id < cands[j].id })
		if listed != nil {
			s.Options = wikiOptions(slot, listed, cands, standard, def, wcal, ctx)
			s.Listed = true
			if len(s.Options) == 0 {
				continue // the game offers nothing in this slot (the Tenderizer's magazine): its default only
			}
		} else {
			if !slices.Contains(w.CustomizationSlots[:], slot) {
				continue // a default only (the Sickle's "No Muzzle"): nothing to pick
			}
			s.Options = guessOptions(slot, cands, standard, def, wcal)
		}
		// the default is always offered
		if !slices.ContainsFunc(s.Options, func(o AttachOption) bool { return o.ID == s.Default }) {
			switch {
			case standard != nil:
				s.Options = append([]AttachOption{*standard}, s.Options...)
			case s.Default == "":
				s.Options = append([]AttachOption{{Name: "None"}}, s.Options...)
			default:
				for _, c := range cands {
					if c.id == def.ID.Value {
						s.Options = append([]AttachOption{c.option(0)}, s.Options...)
					}
				}
			}
		}
		out = append(out, s)
	}
	return out, nil
}

// wikiOptions: a slot's options from the weapon's wiki list (attachment name -> unlock level), in unlock order.
// "No Optics" / "No Underbarrel" are the empty slot; "No Attachment" / "No Choke" the weapon's bare muzzle (its own
// part, else the bare muzzle of its caliber, else nothing).
func wikiOptions(slot enum.WeaponCustomizationSlot, listed map[string]int, cands []attachCand, standard *AttachOption,
	def *datalib.WeaponCustomizableItem, wcal string, ctx []string) []AttachOption {
	byName := map[string][]attachCand{}
	for _, c := range cands {
		k := wikiName(itemName(c.it))
		byName[k] = append(byName[k], c)
	}
	// a weapon of no known caliber (AR-11 Arbitrator, R-4 Hyena): one caliber for the slot, the one that has most
	// of the listed attachments (the lowest of a tie)
	if wcal == "" && slot == enum.WeaponCustomizationSlot_Muzzle {
		count := map[string]int{}
		for n := range listed {
			if a, ok := wikiAlias[n]; ok {
				n = a
			}
			seen := map[string]bool{}
			for _, c := range byName[n] {
				if cal := caliber(family(c.it.DebugName)); cal != "" && !seen[cal] {
					seen[cal] = true
					count[cal]++
				}
			}
		}
		for cal, k := range count {
			if wcal == "" || k > count[wcal] || k == count[wcal] && calNum(cal) < calNum(wcal) {
				wcal = cal
			}
		}
	}
	var out []AttachOption
	add := func(o AttachOption) {
		for i, x := range out {
			if x.ID == o.ID { // two names for one model ("No Attachment", "No Choke"): the earlier unlock
				out[i].Level = min(x.Level, o.Level)
				return
			}
		}
		out = append(out, o)
	}
	for wn, lvl := range listed {
		n := wn
		if a, ok := wikiAlias[n]; ok {
			n = a
		}
		cs := byName[n]
		nw := words(n)
		option := func(c attachCand) AttachOption {
			o := c.option(lvl)
			if c.it.NameCased == "" { // no English name in the game: the wiki's
				o.Name = title(wn)
			}
			return o
		}
		switch {
		case n == "NO OPTICS" && slot == enum.WeaponCustomizationSlot_Optics,
			n == "NO UNDERBARREL" && slot == enum.WeaponCustomizationSlot_Underbarrel:
			add(AttachOption{Name: "None", Level: lvl})
		case (n == "NO ATTACHMENT" || n == "NO CHOKE") && slot == enum.WeaponCustomizationSlot_Muzzle:
			if def == nil { // the weapon's default: nothing on the muzzle
				add(AttachOption{Name: "None", Level: lvl})
			} else if standard != nil {
				o := *standard
				o.Level = lvl
				add(o)
			} else if c, ok := bestOf(cs, def, wcal, ctx, nw); ok {
				add(option(c))
			} else {
				add(AttachOption{Name: "None", Level: lvl})
			}
		case n == "NO ATTACHMENT" || n == "NO CHOKE":
			// the bare muzzle: nothing in other slots (not an item of that name there, as the AR-23L Liberator
			// Legacy's default grip of game build 25988413)
		case len(cs) > 0:
			c, ok := bestOf(cs, def, wcal, ctx, nw)
			if !ok { // only other calibers' (a gap in the item table): the plainest one
				c, _ = bestOf(cs, def, "", ctx, nw)
			}
			add(option(c))
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Level != out[j].Level {
			return out[i].Level < out[j].Level
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func bestOf(cs []attachCand, def *datalib.WeaponCustomizableItem, wcal string, ctx, name []string) (attachCand, bool) {
	if len(cs) == 0 {
		return attachCand{}, false
	}
	return bestCand(cs, def, wcal, ctx, name)
}

// guessOptions: every attachment of the slot that fits the weapon (no per-weapon list): magazines of the default's
// family, muzzles of the weapon's caliber, all optics and underbarrels, plus None (the empty slot) and Standard (the
// weapon's own part); same-named items told apart by their internal name.
func guessOptions(slot enum.WeaponCustomizationSlot, cands []attachCand, standard *AttachOption, def *datalib.WeaponCustomizableItem,
	wcal string) []AttachOption {
	var out []AttachOption
	if standard != nil {
		out = append(out, *standard)
	}
	if slot != enum.WeaponCustomizationSlot_Magazine {
		out = append(out, AttachOption{Name: "None"})
	}
	fam := ""
	if def != nil && slot == enum.WeaponCustomizationSlot_Magazine {
		fam = family(def.DebugName)
	}
	debug := map[string]string{}
	for _, c := range cands {
		if fam != "" && family(c.it.DebugName) != fam {
			continue
		}
		if cal := caliber(family(c.it.DebugName)); slot == enum.WeaponCustomizationSlot_Muzzle && wcal != "" && cal != "" && cal != wcal {
			continue
		}
		o := c.option(0)
		debug[o.ID] = strings.TrimSpace(c.it.DebugName)
		out = append(out, o)
	}
	count := map[string]int{}
	for _, o := range out {
		count[o.Name]++
	}
	for i, o := range out {
		if count[o.Name] > 1 && debug[o.ID] != "" {
			out[i].Name = o.Name + " (" + debug[o.ID] + ")"
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if (a.ID == "") != (b.ID == "") { // None first
			return a.ID == ""
		}
		return a.Name < b.Name
	})
	return out
}

func title(s string) string { return cases.Title(language.English).String(strings.ToLower(s)) }

func parseID(s string) uint32 {
	var v uint32
	fmt.Sscanf(s, "0x%x", &v)
	return v
}
