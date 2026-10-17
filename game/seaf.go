package game

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"github.com/xypwn/filediver/stingray"

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
	sort.Slice(kits, func(i, j int) bool { return kits[i].Name < kits[j].Name })
	return kits
}
