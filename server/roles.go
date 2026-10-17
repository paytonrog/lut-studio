package server

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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

// ThemeGroups: the kit types themes cover, by their group (the item menu's: home.go); a kit's own group:
// ThemeGroupOf (the Super Destroyer's props split in two)
var ThemeGroups = map[string]string{"Armor": "Armor", "Helmet": "Helmets", "Cape": "Capes", game.BackpackType: "Backpacks",
	game.WeaponType: "Weapons", game.VehicleType: "Vehicles", game.ThrowableType: "Equipment", game.GearType: "Equipment",
	game.AttachmentType: "Equipment", game.StratagemType: "Stratagems", game.CraftType: "Eagle & craft",
	game.SEAFType: "SEAF", game.ShipType: "Super Destroyer", game.CrewType: "Ship crew"}

// shipShowpieces: the Super Destroyer's props that make up the ship itself and its hangar showpieces (its body and
// hub, the support cannons, the Eagle's ordnance on display, the emblems, the cryo pods; by unit path); the rest of
// the ship's props (terminals, screens, lamps, floors, walls, cranes...) are the "Ship interior" group
var shipShowpieces = regexp.MustCompile(`/(se_destroyer|eagle_weapons/|helldiver_emblem|cryo_)`)

// ThemeGroupOf: the theme group a kit belongs to ("": none)
func ThemeGroupOf(k game.Kit) string {
	g := ThemeGroups[k.Type]
	if k.Type == game.ShipType {
		unitPath := ""
		if len(k.Units) > 0 {
			unitPath = k.Units[0].Name
		}
		// (a unit with no known path, named by a clue: by its kit name)
		if !shipShowpieces.MatchString(unitPath) && !regexp.MustCompile(`(?i)SE Destroyer|Eagle|Emblem|Cryo`).MatchString(k.Name) {
			return "Ship interior"
		}
	}
	return g
}

// exclusiveGroups: groups whose items share materials with other things in the game (a cryo pod's frozen Helldiver
// wears B-01 armor; generic metals): a LUT of theirs is themed only when no item of another group uses it (the Super
// Destroyer's Eagle ordnance shares the Eagle & craft group's LUTs: allowed) and at most maxSharedMaterials of the
// game's materials bind it
var exclusiveGroups = map[string][]string{"SEAF": nil, "Super Destroyer": {"Eagle & craft"}, "Ship interior": {"Eagle & craft"}, "Ship crew": nil}

const maxSharedMaterials = 12

// roleItems: the items themes cover, in /api/kits order (named kits only)
func (s *Server) roleItems(idx *game.Index) []roleItem {
	order := map[string]int{"Armor": 0, "Helmets": 1, "Capes": 2, "Backpacks": 3, "Weapons": 4, "Vehicles": 5,
		"Equipment": 6, "Stratagems": 7, "Eagle & craft": 8, "SEAF": 9, "Super Destroyer": 10, "Ship interior": 11, "Ship crew": 12}
	// the groups each LUT's items are in (any item: a theme group, else its type), and how many materials bind it
	lutGroups := map[string]map[string]bool{}
	for _, k := range idx.Kits {
		g := ThemeGroupOf(k)
		if g == "" {
			g = "type:" + k.Type
		}
		for _, p := range k.Pieces {
			if p.MaterialLUT != "" {
				if lutGroups[p.MaterialLUT] == nil {
					lutGroups[p.MaterialLUT] = map[string]bool{}
				}
				lutGroups[p.MaterialLUT][g] = true
			}
		}
	}
	var mats map[uint64]int
	if gm := s.game(); gm != nil {
		mats = gm.LUTMaterials(idx)
	}
	shared := func(g, h string) bool {
		allowed, ok := exclusiveGroups[g]
		if !ok {
			return false
		}
		for o := range lutGroups[h] {
			if o != g && !slices.Contains(allowed, o) {
				return true
			}
		}
		v, _ := lut.ParseHash(h)
		return mats[v] > maxSharedMaterials
	}
	var out []roleItem
	done := map[string]bool{}
	for _, k := range idx.Kits {
		g := ThemeGroupOf(k)
		if g == "" || unnamedKit(k.Name) {
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
			if p.MaterialLUT == "" || seen[l] || shared(g, p.MaterialLUT) {
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
