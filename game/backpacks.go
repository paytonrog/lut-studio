package game

import (
	"fmt"
	"path"
	"sort"
	"strings"

	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/stingray"

	"lutstudio/lut"
)

// Backpacks: a backpack's look is its materials' own LUTs (no skins or
// paint schemes). One kit per named backpack unit under equipment/backpacks/ (names from the encyclopedia entry),
// type "Backpack": the named unit plus the unnamed units of its folder (the Maxigun's hose, the Guard Dog's drone and
// gun) and, for a Guard Dog, its gun from drone_weapons/ and the generic drone body when its folder has none. The
// shader family is the weapons' (no clearcoat) for most.

const BackpackType = "Backpack"

const backpackDir = "content/fac_helldivers/equipment/backpacks/"

func (g *Game) backpackKits(languageMap map[uint32]string) []Kit {
	enc, _ := datalib.ParseEncyclopediaEntryComponents()
	knownName(stingray.Hash{}) // (fills knownTable)
	type unitInfo struct {
		path, name string
		h          stingray.Hash
	}
	byFolder := map[string][]unitInfo{}
	for _, p := range knownTable {
		if !strings.HasPrefix(p, backpackDir) {
			continue
		}
		h := stingray.Sum(p)
		if !g.isUnit(h) {
			continue
		}
		name := ""
		if e, ok := enc[h]; ok {
			name = strings.TrimSpace(languageMap[e.Prefix] + " " + languageMap[e.LocName])
		}
		byFolder[path.Dir(p)] = append(byFolder[path.Dir(p)], unitInfo{p, name, h})
	}
	thin := func(v uint32) string {
		if s, ok := thinName(v); ok {
			return s
		}
		return fmt.Sprintf("0x%08x", v)
	}
	var kits []Kit
	for folder, us := range byFolder {
		sort.Slice(us, func(i, j int) bool { return us[i].path < us[j].path })
		var unnamed []unitInfo
		names := map[string][]unitInfo{}
		for _, u := range us {
			if u.name == "" {
				unnamed = append(unnamed, u)
			} else {
				names[u.name] = append(names[u.name], u)
			}
		}
		for name, named := range names {
			// the main unit: the folder's own name, else one named *_backpack, else the first
			main := named[0]
			for _, u := range named {
				if strings.HasSuffix(u.path, "_backpack") {
					main = u
				}
			}
			for _, u := range named {
				if path.Base(u.path) == path.Base(folder) {
					main = u
				}
			}
			units := []unitInfo{main}
			for _, u := range append(named, unnamed...) {
				if u.path != main.path {
					units = append(units, u)
				}
			}
			if strings.HasPrefix(name, "AX/") { // a Guard Dog: its gun, and the drone body when its folder has none
				base := strings.TrimSuffix(path.Base(folder), "_backpack")
				gun := backpackDir + "drone_weapons/" + base + "/" + base
				hasDrone := false
				for _, u := range units {
					hasDrone = hasDrone || path.Base(u.path) == base
				}
				if g.isUnit(stingray.Sum(gun)) && !hasDrone {
					units = append(units, unitInfo{path: gun, h: stingray.Sum(gun)})
				}
				if body := backpackDir + "drone_generic/drone_generic"; !hasDrone && g.isUnit(stingray.Sum(body)) {
					units = append(units, unitInfo{path: body, h: stingray.Sum(body)})
				}
			}
			k := Kit{ID: fmt.Sprintf("b%016x", main.h.Value), Name: name, Type: BackpackType}
			for _, u := range units {
				k.Units = append(k.Units, KitUnit{Unit: lut.HashString(u.h.Value), Name: u.path})
				for _, d := range g.unitDefaultLUTs(u.h) {
					k.Pieces = append(k.Pieces, Piece{Unit: lut.HashString(u.h.Value), Slot: thin(d.slot), PieceType: "backpack",
						Body: "any", MaterialLUT: hashOrEmpty(d.lut), PatternLUT: hashOrEmpty(d.pattern)})
				}
			}
			if len(k.Pieces) > 0 && len(g.unitDefaultLUTs(main.h)) > 0 {
				kits = append(kits, k)
			}
		}
	}
	sort.Slice(kits, func(i, j int) bool { return kits[i].ID < kits[j].ID })
	return kits
}
