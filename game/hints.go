package game

import (
	"bytes"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/xypwn/filediver/stingray"
	pkg "github.com/xypwn/filediver/stingray/package"
	"github.com/xypwn/filediver/stingray/unit"
	"github.com/xypwn/filediver/stingray/unit/material"
)

// Units with no known path (gear.go's "Unit 0x…") get a category and a name from what is known around them, the
// best clue first:
//  1. a known path of one of their materials or textures (content/…, not art_shared): "World: Habs Fence 01 (unit
//     0dae)";
//  2. named kits sharing one of their LUTs (the same colors): "Automaton: like Berserker (unit 141f)";
//  3. named units loaded with them (a package of fewer than 60 units): "Automaton: with Cyborg Gunship (unit 2d62)";
//  4. a known package holding them: "Ship: in Ship (unit 055a)".
// A unit with none stays "Unit 0x…". The names are guesses from the data, so they say "like", "with" and "in".

type unitClues struct {
	g        *Game
	inPkg    map[uint64][]uint64 // unit -> packages holding it
	pkgUnits map[uint64]int      // package -> units in it
	pkgNamed map[uint64][]string // package -> its units' known paths
	lutKits  map[string][]Kit    // LUT -> the kits (not gear.go's unnamed ones) using it
}

func (g *Game) newUnitClues(kits []Kit) *unitClues {
	c := &unitClues{g: g, inPkg: map[uint64][]uint64{}, pkgUnits: map[uint64]int{}, pkgNamed: map[uint64][]string{},
		lutKits: map[string][]Kit{}}
	for _, k := range kits {
		for _, p := range k.Pieces {
			for _, h := range []string{p.MaterialLUT, p.CapeLUT} {
				if h != "" {
					c.lutKits[h] = append(c.lutKits[h], k)
				}
			}
		}
	}
	unitT, pkgT := stingray.Sum("unit"), stingray.Sum("package")
	for id := range g.data.Files {
		if id.Type != pkgT {
			continue
		}
		b, err := g.data.Read(id, stingray.DataMain)
		if err != nil {
			continue
		}
		p, err := pkg.LoadPackage(bytes.NewReader(b))
		if err != nil {
			continue
		}
		for _, it := range p.Items {
			if it.Type != unitT {
				continue
			}
			c.inPkg[it.Name.Value] = append(c.inPkg[it.Name.Value], id.Name.Value)
			c.pkgUnits[id.Name.Value]++
			if n, ok := knownTable[it.Name.Value]; ok && strings.HasPrefix(n, "content/") {
				c.pkgNamed[id.Name.Value] = append(c.pkgNamed[id.Name.Value], n)
			}
		}
	}
	return c
}

// matPaths: the known content paths of a unit's materials, then of their textures
func (c *unitClues) matPaths(u stingray.Hash) (mats, texs []string) {
	b, err := c.g.data.Read(stingray.NewFileID(u, stingray.Sum("unit")), stingray.DataMain)
	if err != nil {
		return
	}
	info, err := unit.LoadInfo(bytes.NewReader(b))
	if err != nil {
		return
	}
	useful := func(n string) bool {
		return strings.HasPrefix(n, "content/") && !strings.HasPrefix(n, "content/art_shared/")
	}
	for _, mh := range info.Materials {
		if n, ok := knownTable[mh.Value]; ok && useful(n) {
			mats = append(mats, n)
		}
		mb, err := c.g.data.Read(stingray.NewFileID(mh, stingray.Sum("material")), stingray.DataMain)
		if err != nil {
			continue
		}
		m, err := material.LoadMain(bytes.NewReader(mb))
		if err != nil {
			continue
		}
		for _, th := range m.Textures {
			if n, ok := knownTable[th.Value]; ok && useful(n) {
				texs = append(texs, n)
			}
		}
	}
	sort.Strings(mats)
	sort.Strings(texs)
	return
}

// assetName: what a material or texture path names: a material's own name ("m_habs_fence_01" -> habs_fence_01),
// a texture's folder above textures/ ("…/flag/textures/melee_flag_nac" -> flag)
func assetName(p string) string {
	dir, base := path.Dir(p), path.Base(p)
	if path.Base(dir) == "textures" || path.Base(dir) == "materials" || path.Base(dir) == "material" {
		if strings.Contains(p, "/materials/") || strings.Contains(p, "/material/") {
			return strings.TrimSuffix(strings.TrimPrefix(base, "m_"), "_variation")
		}
		return path.Base(path.Dir(dir))
	}
	return strings.TrimPrefix(base, "m_")
}

// kitTypeAsGear: the gear.go type for a unit sharing a kit's LUT
func kitTypeAsGear(t string) string {
	for _, gt := range GearTypes {
		if t == gt {
			return t
		}
	}
	if t == VehicleType {
		return CraftType
	}
	return GearType
}

// bareKitName: a kit's name without its type and model count ("Automaton: Conscript (2 models)" -> Conscript)
func bareKitName(n string) string {
	if i := strings.Index(n, ": "); i >= 0 {
		n = n[i+2:]
	}
	if i := strings.Index(n, " (") + 1; i > 0 && strings.HasSuffix(n, ")") {
		n = n[:i-1]
	}
	return n
}

func mostCommon(xs []string) string {
	n := map[string]int{}
	best := ""
	for _, x := range xs {
		n[x]++
		if n[x] > n[best] || n[x] == n[best] && x < best {
			best = x
		}
	}
	return best
}

var genericNodes = map[string]bool{"rig": true, "shadow_mesh": true, "collision": true, "game_mesh": true, "skeleton": true,
	"root": true, "boss": true, "debris": true, "rubble": true, "navigation": true, "group1": true, "game": true, "body": true,
	"shadow": true, "light": true, "interact": true, "debris_collision": true, "rubble_collision": true, "fwd_align": true,
	"destruction_volume": true, "attachments": true, "default": true}

// armorSlot: a Helldiver armor piece's material slot (m_torso_armor, m_helmet, m_shoulders, m_leg_armor…)
var armorSlot = regexp.MustCompile(`^m_(torso|helmet|shoulder|leg|arm|glove|kit|hips|undergarment)`)

// armorName: an armor piece's mesh group ("grp_torso_female" -> torso_female)
var armorName = regexp.MustCompile(`^(torso|helmet|shoulder|legs|arm)`)

// seenUnits: unnamed units identified by looking at them (LUT Studio renders, 2026-10-15; the user's identifications
// below), the category and name their data doesn't make certain
var seenUnits = map[uint64][2]string{
	0x0e8c6a2fe8d85cd4: {WorldType, "City Car"},
	0x08886d27a6f6db8c: {WorldType, "Lieutenant Corpse"},
	0x0447667044acd568: {WorldType, "SE Flag"},
	0x92b70eddfa065a49: {WorldType, "Finned Shell"},
	0x1d74e46dbcf7beb7: {WorldType, "Debris"},
	0x21526aa0da7249e2: {WorldType, "Automaton Crate"},
	0xe6caddc3ed05dd7e: {GearType, "Shotgun Shell"},
	0x439f9e65c18567da: {CraftType, "Tank Autocannon Turret"},
	0x3e5ecd9a2d8fc913: {ShipType, "Platform With Ladder"},
	0x37f954a7b8b05d3e: {ArmorPieceType, "Standard Medium"}, // a shoulder / thigh pad with a pouch
	0x8372619b2702d743: {AutomatonType, "Assault Walker Variant"},
	// identified by the user (2026-10-15)
	0x570bec16942f8892: {WorldType, "Tutorial Floor Tarp Thing"},
	0x1ccc1838cf7137c4: {ShipType, "Ship Handle Bolt Thing"},
	0x0592c677e2d87ea1: {ShipType, "Generic Terminal"},
	0x75d43e05a1081cc6: {ShipType, "Generic Terminal"},
	0x9673130f90ccc719: {ObjectiveType, "Cyborg Cooling Structure Chunk"},
	0xda3c547d0e0e442f: {WorldType, "Requisition Slips"},
	0x2d3bc1683a54298d: {ObjectiveType, "Secondary Objective Pickup"},
	0x8a25a08b7d4a2653: {ObjectiveType, "Cyborg Objective Data Chip"},
	0xa188cbb5913fbd63: {AttachmentType, "Laser Focusing Attachment"},
	0xe77739ec751b1919: {ObjectiveType, "TCS Button"},
	0x0f3f333c23700d53: {ObjectiveType, "Cy Fleet Ship"},
	0x01f3396cf2f5ba28: {WorldType, "Democracy Space Station (DSS)"}, // ~11 km, seen in space
}

var meshSuffix = regexp.MustCompile(`(?i)(_shadow)?(_lod\d+)?$`)

// ownName: the unit's own name, as its scene calls it: the first named node under the root ("seaf_radio_backpack"),
// else its most common mesh group ("g_adrenaline_shot_LOD1", "grp_torso_female"), else a material slot
// ("m_leg_armor"); armor: its bones cull body parts ("torso_culling") and a material slot is an armor one
// (m_torso_armor…): a Helldiver armor piece
func (c *unitClues) ownName(u stingray.Hash) (name string, armor bool) {
	b, err := c.g.data.Read(stingray.NewFileID(u, stingray.Sum("unit")), stingray.DataMain)
	if err != nil {
		return "", false
	}
	info, err := unit.LoadInfo(bytes.NewReader(b))
	if err != nil {
		return "", false
	}
	var groups []string
	for _, bn := range info.Bones {
		n, ok := thinName(bn.NameHash.Value)
		if !ok {
			continue
		}
		armor = armor || strings.HasSuffix(n, "_culling")
		if name == "" && bn.ParentIndex == 1 && !genericNodes[n] && !strings.HasPrefix(n, "chunk_") &&
			!strings.HasPrefix(n, "navigation") && !strings.HasPrefix(n, "c_") {
			name = n
		}
		for _, pre := range []string{"grp_", "g_"} {
			if g := meshSuffix.ReplaceAllString(strings.TrimPrefix(n, pre), ""); strings.HasPrefix(n, pre) && !genericNodes[g] &&
				!strings.HasPrefix(g, "rubble") && !strings.HasPrefix(g, "debris") && !strings.HasPrefix(g, "navigation") {
				groups = append(groups, g)
			}
		}
	}
	if name == "" && len(groups) > 0 {
		name = mostCommon(groups)
	}
	slotArmor := false
	for s := range info.Materials {
		if n, ok := thinName(s.Value); ok && armorSlot.MatchString(n) {
			slotArmor = true
		}
	}
	armor = armor && (slotArmor || armorName.MatchString(name))
	if name == "" {
		var slots []string
		for s := range info.Materials {
			if n, ok := thinName(s.Value); ok && strings.HasPrefix(n, "m_") && n != "m_shadow" && n != "m_collision" &&
				n != "m_character_shadow" && !genericNodes[strings.TrimPrefix(n, "m_")] {
				slots = append(slots, strings.TrimPrefix(n, "m_"))
			}
		}
		sort.Strings(slots)
		if len(slots) > 0 {
			name = slots[0]
		}
	}
	return name, armor
}

// name: the category and name of an unnamed unit group (its units, its pieces), ok false for no clue. Its own
// name (ownName) names it; the clues below give the category (an armor piece: ArmorPieceType), and the name when
// it has none.
func (c *unitClues) name(units []stingray.Hash, pieces []Piece) (typ, name string, ok bool) {
	tag := fmt.Sprintf(" (unit %04x)", units[0].Value>>48)
	if v, ok := seenUnits[units[0].Value]; ok {
		return v[0], v[1] + tag, true
	}
	own, armor := c.ownName(units[0])
	typ, name, ok = c.clue(units, pieces, tag)
	if armor {
		typ, ok = ArmorPieceType, true
	}
	if own != "" {
		if !ok {
			typ = WorldType
		}
		if t, hit := ownNameType(own); hit {
			typ = t
		}
		name, ok = gearPretty(own)+tag, true
	}
	if !ok {
		return "", "", false
	}
	weak := strings.HasPrefix(name, "like ") || strings.HasPrefix(name, "with ") || strings.HasPrefix(name, "in ")
	if own == "" && !armor && weak { // only clues 2-4: unidentified until someone tells what it is (seenUnits)
		typ = UnitType
	}
	return typ, name, true
}

// ownNameType: a category its own name makes certain ("seaf_…": SEAF; "…objective…": Objective)
func ownNameType(n string) (string, bool) {
	switch {
	case strings.HasPrefix(n, "seaf_"):
		return SEAFType, true
	case strings.Contains(n, "objective") || strings.Contains(n, "intel_harddrive") || strings.Contains(n, "spawner_jammer"):
		return ObjectiveType, true
	}
	return "", false
}

// clue: the category and name from what is around the unit (1-4 above)
func (c *unitClues) clue(units []stingray.Hash, pieces []Piece, tag string) (typ, name string, ok bool) {
	// 1. its materials' / textures' paths
	var mats, texs []string
	for _, u := range units {
		m, t := c.matPaths(u)
		mats, texs = append(mats, m...), append(texs, t...)
	}
	if p := append(mats, texs...); len(p) > 0 {
		best := p[0]
		return gearType(best), gearPretty(assetName(best)) + tag, true
	}
	// 2. kits of the same LUTs
	var like []Kit
	for _, p := range pieces {
		for _, h := range []string{p.MaterialLUT, p.CapeLUT} {
			like = append(like, c.lutKits[h]...)
		}
	}
	if len(like) > 0 { // the kit most of its LUTs share (by id: the same pick whatever the language)
		var ids, types []string
		name := map[string]string{}
		for _, k := range like {
			ids, types = append(ids, k.ID), append(types, kitTypeAsGear(k.Type))
			name[k.ID] = bareKitName(k.Name)
		}
		return mostCommon(types), "like " + name[mostCommon(ids)] + tag, true
	}
	// 3. named units loaded with it, 4. its known packages
	var sibs, pkgs []string
	for _, u := range units {
		for _, p := range c.inPkg[u.Value] {
			if c.pkgUnits[p] < 60 {
				sibs = append(sibs, c.pkgNamed[p]...)
			}
			if n, ok := knownTable[p]; ok {
				pkgs = append(pkgs, n)
			}
		}
	}
	if len(sibs) > 0 {
		var dirs, types []string
		for _, s := range sibs {
			dirs, types = append(dirs, path.Base(path.Dir(s))), append(types, gearType(s))
		}
		return mostCommon(types), "with " + gearPretty(mostCommon(dirs)) + tag, true
	}
	if len(pkgs) > 0 {
		p := mostCommon(pkgs)
		t := WorldType
		switch b := path.Base(p); {
		case b == "ship" || strings.HasPrefix(b, "ship_"):
			t = ShipType
		case strings.Contains(b, "cyborg") || strings.HasPrefix(b, "cy_"):
			t = AutomatonType
		case strings.Contains(b, "illuminate"):
			t = IlluminateType
		}
		return t, "in " + gearPretty(path.Base(p)) + tag, true
	}
	return "", "", false
}

// gearPretty: a path word as a name ("habs_fence_01" -> "Habs Fence 01")
func gearPretty(s string) string {
	return strings.TrimSpace(gearWords.Replace(title(strings.ReplaceAll(strings.TrimPrefix(s, "cha_"), "_", " ")) + " "))
}
