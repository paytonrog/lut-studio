package game

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Name templates: the item table (table.go) carries no names. Where a name comes from the game's string tables it
// holds "⟦id⟧" (the install's string id, decimal), "⟦id|t⟧" (that string title-cased, as LUT Studio shows paint
// schemes and vehicle skins) or "⟦id|v⟧" (a vehicle name: title-cased, "FRV" kept); the app fills them from the
// player's own install. The generator builds the index once with every string replaced by its marker (MarkerMap) and
// keeps a template only when it reproduces the real name.

var markerRe = regexp.MustCompile(`⟦(\d+)(\|[tv])?⟧`)

// vehicleCase: a vehicle's name as LUT Studio shows it, title-cased with its abbreviations kept ("Gunner FRV")
var vehicleCase = strings.NewReplacer("Frv", "FRV", "Td-", "TD-", "Exo-", "EXO-")

// vehicleName: a game string as a vehicle name (title-cased, abbreviations kept); a marker is marked for that.
func vehicleName(s string) string {
	if m := markerRe.FindStringSubmatch(strings.TrimSpace(s)); m != nil && m[0] == strings.TrimSpace(s) {
		return "⟦" + m[1] + "|v⟧"
	}
	return vehicleCase.Replace(title(s))
}

// MarkerMap: a language map whose strings are their own markers (same ids as lang, empty strings kept empty).
func MarkerMap(lang map[uint32]string) map[uint32]string {
	out := make(map[uint32]string, len(lang))
	for id, s := range lang {
		if s == "" {
			out[id] = ""
		} else {
			out[id] = fmt.Sprintf("⟦%d⟧", id)
		}
	}
	return out
}

// titleName: a game string title-cased ("DESERT" -> "Desert"); a marker is marked to be title-cased when filled.
func titleName(s string) string {
	if m := markerRe.FindStringSubmatch(strings.TrimSpace(s)); m != nil && m[0] == strings.TrimSpace(s) {
		return "⟦" + m[1] + "|t⟧"
	}
	return title(s)
}

// ResolveName fills a name template from a language map (a string the map lacks: its id in hex).
func ResolveName(tmpl string, lang map[uint32]string) string {
	if !strings.Contains(tmpl, "⟦") {
		return tmpl
	}
	return markerRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		sm := markerRe.FindStringSubmatch(m)
		id, _ := strconv.ParseUint(sm[1], 10, 32)
		s, ok := lang[uint32(id)]
		if !ok {
			return fmt.Sprintf("0x%08x", id)
		}
		switch sm[2] {
		case "|t":
			return title(s)
		case "|v":
			return vehicleCase.Replace(title(s))
		}
		return s
	})
}
