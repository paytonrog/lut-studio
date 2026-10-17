package server

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"

	"lutstudio/appcfg"
	"lutstudio/game"
	"lutstudio/lut"
)

// Zone roles: what each zone (row) of a material LUT is on its item (primary, trim, cloth…), so one look per role can
// theme many items alike. Keyed by LUT, so a LUT several items share is confirmed once for all of them. LUT Studio
// ships a reviewed set (roles.json, built in); a user's own confirmations (%APPDATA%\LUTStudio\roles.json) come on
// top and can be exported as a whole new roles.json.

// Roles: the role names a zone can have.
var Roles = []string{"primary", "secondary", "trim", "cloth", "hardware", "glow", "keep", "unused"}

//go:embed roles.json
var builtinRoles []byte

// RoleFile is roles.json: per LUT (0x hash), the role of each zone.
type RoleFile struct {
	Version int                 `json:"version"`
	Roles   map[string][]string `json:"roles"`
}

func readRoles(b []byte) (map[string][]string, error) {
	var f RoleFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	if f.Roles == nil {
		f.Roles = map[string][]string{}
	}
	return f.Roles, nil
}

// BuiltinRoles: the roles LUT Studio ships.
func BuiltinRoles() map[string][]string {
	r, err := readRoles(builtinRoles)
	if err != nil {
		panic("roles.json: " + err.Error())
	}
	return r
}

func rolesPath() string { return filepath.Join(appcfg.Dir(), "roles.json") }

func myRoles() map[string][]string {
	b, err := os.ReadFile(rolesPath())
	if err != nil {
		return map[string][]string{}
	}
	r, err := readRoles(b)
	if err != nil {
		return map[string][]string{}
	}
	return r
}

// checkRoles: every zone's role is one of Roles
func checkRoles(name string, roles []string) error {
	if h, err := lut.ParseHash(name); err != nil || lut.HashString(h) != name {
		return fmt.Errorf("not a LUT hash: %q", name)
	}
	if len(roles) == 0 || len(roles) > 64 {
		return fmt.Errorf("%s: %d zone roles", name, len(roles))
	}
	for z, r := range roles {
		if !slices.Contains(Roles, r) {
			return fmt.Errorf("%s zone %d: no role %q (roles: %v)", name, z, r, Roles)
		}
	}
	return nil
}

// roleItem: an item to review (armor, helmet, cape, weapon) and its material LUTs (per body type)
type roleItem struct {
	Value string    `json:"value"` // as /api/kits
	Label string    `json:"label"`
	Group string    `json:"group"`
	LUTs  []roleLUT `json:"luts"`
}

type roleLUT struct {
	LUT  string `json:"lut"`
	Body string `json:"body"`
	Type string `json:"type"` // the piece type (armor, undergarment, accessory…)
}

// ThemeGroups: the kit types themes cover, by their group (the item menu's: home.go)
var ThemeGroups = map[string]string{"Armor": "Armor", "Helmet": "Helmets", "Cape": "Capes", game.BackpackType: "Backpacks",
	game.WeaponType: "Weapons", game.VehicleType: "Vehicles", game.ThrowableType: "Equipment", game.GearType: "Equipment",
	game.AttachmentType: "Equipment", game.StratagemType: "Stratagems", game.CraftType: "Eagle & craft"}

// roleItems: the items themes cover, in /api/kits order (named kits only)
func (s *Server) roleItems(idx *game.Index) []roleItem {
	groups := ThemeGroups
	order := map[string]int{"Armor": 0, "Helmets": 1, "Capes": 2, "Backpacks": 3, "Weapons": 4, "Vehicles": 5,
		"Equipment": 6, "Stratagems": 7, "Eagle & craft": 8}
	var out []roleItem
	done := map[string]bool{}
	for _, k := range idx.Kits {
		g, ok := groups[k.Type]
		if !ok || unnamedKit(k.Name) {
			continue
		}
		v := "kit:" + k.ID
		if g != "Armor" && g != "Helmets" && g != "Capes" { // (listed by name, as the item menu does)
			v = idx.Key(k)
		}
		if done[v] {
			continue
		}
		done[v] = true
		it := roleItem{Value: v, Label: s.kitLabel(k), Group: g}
		seen := map[roleLUT]bool{}
		for _, p := range k.Pieces {
			l := roleLUT{p.MaterialLUT, p.Body, p.PieceType}
			if p.MaterialLUT == "" || seen[l] {
				continue
			}
			seen[l] = true
			it.LUTs = append(it.LUTs, l)
		}
		if len(it.LUTs) > 0 {
			out = append(out, it)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if order[out[i].Group] != order[out[j].Group] {
			return order[out[i].Group] < order[out[j].Group]
		}
		return naturalLess(out[i].Label, out[j].Label)
	})
	return out
}

// GET /api/roles: {names, builtin, mine, items}
func (s *Server) getRoles(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"names": Roles, "builtin": BuiltinRoles(), "mine": myRoles()}
	if idx := s.index(); idx != nil {
		out["items"] = s.roleItems(idx)
	}
	writeJSON(w, out)
}

// PUT /api/roles {lut: [role per zone] | null}: the user's roles of those LUTs (null: back to the built-in ones)
func (s *Server) putRoles(w http.ResponseWriter, r *http.Request) {
	var in map[string][]string
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	for h, roles := range in {
		if roles == nil {
			continue
		}
		if err := checkRoles(h, roles); err != nil {
			fail(w, 400, err)
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// (a roles file that exists but doesn't read is not replaced: the confirmations in it would be lost)
	if b, err := os.ReadFile(rolesPath()); err == nil {
		if _, err := readRoles(b); err != nil {
			fail(w, 500, fmt.Errorf("%s doesn't read (%v): fix or remove it first", rolesPath(), err))
			return
		}
	}
	mine := myRoles()
	for h, roles := range in {
		if roles == nil {
			delete(mine, h)
		} else {
			mine[h] = roles
		}
	}
	if err := writeRoleFile(rolesPath(), mine); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]int{"mine": len(mine)})
}

func roleFileBytes(roles map[string][]string) []byte {
	b, _ := json.MarshalIndent(RoleFile{Version: 1, Roles: roles}, "", " ")
	return append(b, '\n')
}

func writeRoleFile(path string, roles map[string][]string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, roleFileBytes(roles), 0o644)
}

// GET /api/roles/export: the built-in roles with the user's on top, as a roles.json to ship
func (s *Server) exportRoles(w http.ResponseWriter, r *http.Request) {
	all := BuiltinRoles()
	for h, roles := range myRoles() {
		all[h] = roles
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="roles.json"`)
	w.Write(roleFileBytes(all))
}
