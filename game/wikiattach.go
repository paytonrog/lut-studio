package game

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
)

// The attachments each weapon offers in the game, and the weapon level that unlocks each: the game gets these from
// its backend (progression packages), not from the install, so they
// come from the community wiki instead: wikiattach.json, written by tools/wikiattach from the Helldivers Wiki
// (helldivers.wiki.gg, "Module:Weapon Attach/data weapons.json"). That file is the wiki contributors' work, CC
// BY-NC-SA 4.0: credited in the app and the release notices, and not to be used commercially.

//go:embed wikiattach.json
var wikiAttachJSON []byte

// WikiAttach is wikiattach.json.
type WikiAttach struct {
	Source   string                    `json:"source"`
	Revision int64                     `json:"revision"`
	Edited   string                    `json:"edited"`
	License  string                    `json:"license"`
	Weapons  map[string]map[string]int `json:"weapons"` // wikiKey -> attachment name (upper case) -> unlock level
}

var (
	wikiOnce sync.Once
	wiki     WikiAttach
)

// WikiAttachments: the embedded wiki table.
func WikiAttachments() *WikiAttach {
	wikiOnce.Do(func() { _ = json.Unmarshal(wikiAttachJSON, &wiki) })
	return &wiki
}

// wikiKey: the wiki's key for a weapon, its name without the designation, upper case ("AR-23 Liberator" ->
// "LIBERATOR", "SMG/FLAM-34 Stoker" -> "STOKER", "SG-225SP Breaker Spray&Pray" -> "BREAKER SPRAY&PRAY").
func wikiKey(name string) string {
	f := strings.Fields(name)
	if len(f) > 1 && strings.ContainsAny(f[0], "0123456789") {
		f = f[1:]
	}
	return strings.ToUpper(strings.Join(f, " "))
}

// wikiList: a weapon's attachments (name -> unlock level), nil if the wiki doesn't list the weapon.
func wikiList(weapon string) map[string]int {
	if weapon == "" {
		return nil
	}
	return WikiAttachments().Weapons[wikiKey(weapon)]
}

// wikiName: an item name as the wiki writes it (upper case, single spaces).
func wikiName(s string) string { return strings.ToUpper(strings.Join(strings.Fields(s), " ")) }

// wikiAlias: wiki names of items the game's string tables name differently (or not at all, wikiName(title(debug
// name)) then): wiki -> wikiName of the game item.
var wikiAlias = map[string]string{
	"FLASHLIGHT VERTICAL FOREGRIP": "VERTICAL GRIP FLASHLIGHT", // internal "Vertical Grip Flashlight", no English name
	"TRIPLE LENS":                  "LASER. BLASTER STANDARD",  // the LAS-12 Sai's lenses (its default: Triple Lens)
	"FOCUS LENS":                   "LASER. BLASTER FOCUS",
}
