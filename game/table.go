package game

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/datalibrary/enum"
	"github.com/xypwn/filediver/stingray"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"

	"lutstudio/lut"
)

// The item table: everything LUT Studio needs from the game's data-library tables (which are encrypted in the
// install), in LUT Studio's own small format, so the app parses no game tables. tools/gentable writes it from the
// decrypted tables after each game update; the repo's data/table.json.gz is the latest (bundled in the exe, and the
// app looks for a newer one at startup, update.go). It holds hashes, ids and name templates (names.go): no names or
// other text from the game, which come from the player's own install.

// TableFormat: bump when the table changes in a way older apps can't read (they keep their bundled table then).
const TableFormat = 1

type Table struct {
	Format    int                    `json:"format"`
	GameBuild string                 `json:"game_build"` // the Steam build it was generated from
	Generated string                 `json:"generated"`
	Kits      []Kit                  `json:"kits"`    // Name: a name template
	Weapons   map[string]TableWeapon `json:"weapons"` // weapon entity (0x + 16 hex): its customization component
	Items     map[string]TableItem   `json:"items"`   // weapon customization item id (0x + 8 hex)
	// Masks: the visibility masks of the units LUT Studio shows (entity or unit, 0x + 16 hex), which the model export
	// uses to split a vehicle into its whole / damaged / destroyed parts
	Masks map[string]TableMask `json:"masks,omitempty"`
}

// TableMask: a VisibilityMaskComponent, its used entries: [name, index, hidden] and [identifier, 7 mask names].
type TableMask struct {
	Infos [][3]uint32 `json:"infos"`
	Rand  [][8]uint32 `json:"rand,omitempty"`
}

// TableWeapon: the parts of a weapon's WeaponCustomizationComponent the attachment menus use.
type TableWeapon struct {
	Name     string         `json:"name,omitempty"` // template
	Defaults []TableDefault `json:"defaults,omitempty"`
	Slots    []int          `json:"slots,omitempty"`
	Optics   string         `json:"optics,omitempty"`
	Magazine string         `json:"magazine,omitempty"`
	Muzzle   string         `json:"muzzle,omitempty"`
}

type TableDefault struct {
	Slot int    `json:"slot"`
	Item string `json:"item"`
}

// TableItem: a weapon customization item (attachment, paint scheme...).
type TableItem struct {
	Slots   []int  `json:"slots,omitempty"`
	Add     string `json:"add,omitempty"`     // its unit, or the hash naming its package's units
	Archive string `json:"archive,omitempty"` // its package
	Debug   string `json:"debug,omitempty"`   // the internal name (family and caliber: "Rifle 5,5x50mm. Drum")
	Name    string `json:"name,omitempty"`    // template
}

func hexHash(h stingray.Hash) string {
	if h.Value == 0 {
		return ""
	}
	return fmt.Sprintf("0x%016x", h.Value)
}

func parseHash(s string) stingray.Hash {
	v, _ := lut.ParseHash(s)
	return stingray.Hash{Value: v}
}

// BuildTable makes the item table from the data-library tables (the embedded ones, or those given to
// datalib.LoadTables) and the install, with names from lang (a MarkerMap for templates).
func (g *Game) BuildTable(lang map[uint32]string) (*Table, error) {
	idx, err := g.buildIndexWith(lang)
	if err != nil {
		return nil, err
	}
	comps, items, names, err := g.loadWeaponData(lang)
	if err != nil {
		return nil, err
	}
	t := &Table{Format: TableFormat, GameBuild: g.Build(), Kits: idx.Kits, Weapons: map[string]TableWeapon{}, Items: map[string]TableItem{}}
	for ent, w := range comps {
		tw := TableWeapon{Name: names[ent], Optics: hexHash(w.OpticsPath), Magazine: hexHash(w.MagazinePath), Muzzle: hexHash(w.MuzzlePath)}
		for _, d := range w.DefaultCustomizations {
			if d.Customization.Value != 0 {
				tw.Defaults = append(tw.Defaults, TableDefault{int(d.Slot), fmt.Sprintf("0x%08x", d.Customization.Value)})
			}
		}
		for _, s := range w.CustomizationSlots {
			if s != 0 {
				tw.Slots = append(tw.Slots, int(s))
			}
		}
		t.Weapons[fmt.Sprintf("0x%016x", ent.Value)] = tw
	}
	// visibility masks: of every unit a kit or an attachment shows
	if masks, err := datalib.ParseVisibilityMasks(); err == nil {
		t.Masks = map[string]TableMask{}
		units := map[stingray.Hash]bool{}
		for _, k := range idx.Kits {
			for _, u := range k.Units {
				units[parseHash(u.Unit)] = true
			}
			for _, p := range k.Pieces {
				units[parseHash(p.Unit)] = true
			}
		}
		for _, it := range items {
			for _, u := range g.itemUnits(it) {
				units[parseHash(u.Unit)] = true
			}
		}
		for u := range units {
			key := u
			m, ok := masks[key]
			if !ok { // (the export looks the unit up, then the entity some units belong to)
				key = datalib.UnitsToEntities(u)
				m, ok = masks[key]
			}
			if !ok || m.Length() == 0 {
				continue
			}
			var tm TableMask
			for _, mi := range m.MaskInfos[:m.Length()] {
				tm.Infos = append(tm.Infos, [3]uint32{mi.Name.Value, uint32(mi.Index), uint32(mi.StartHidden)})
			}
			for _, r := range m.Randomizations {
				if r.Identifier.Value == 0 {
					continue
				}
				e := [8]uint32{r.Identifier.Value}
				for i, n := range r.MaskIndexNames {
					e[i+1] = n.Value
				}
				tm.Rand = append(tm.Rand, e)
			}
			t.Masks[fmt.Sprintf("0x%016x", key.Value)] = tm
		}
	}
	for id, it := range items {
		ti := TableItem{Add: hexHash(it.AddPath), Archive: hexHash(it.Archive), Debug: it.DebugName, Name: it.NameCased}
		for _, s := range it.Slots {
			ti.Slots = append(ti.Slots, int(s))
		}
		t.Items[fmt.Sprintf("0x%08x", id)] = ti
	}
	return t, nil
}

// MergeNames turns a table built with real names into one with name templates: each name of tmpl (the same table
// built with a MarkerMap) that fills back to the real name (english: the map the real one was built with) replaces
// it; others stay as they are (a name LUT Studio makes up, "Pelican (Shuttle)"). Returns how many stayed literal.
func MergeNames(real, tmpl *Table, english map[uint32]string) (literal []string, err error) {
	key := func(k Kit) string { return k.ID + "\x00" + k.Type }
	byKey := map[string]Kit{}
	for _, k := range tmpl.Kits {
		if _, dup := byKey[key(k)]; dup {
			return nil, fmt.Errorf("two kits %s %s", k.Type, k.ID)
		}
		byKey[key(k)] = k
	}
	pick := func(realName, t string) string {
		if t != "" && ResolveName(t, english) == realName {
			return t
		}
		// "Pelican (Shuttle): <skin>": LUT Studio's own name for the vehicle, the skin's from the string tables
		if rv, rs, ok := strings.Cut(realName, ": "); ok {
			if _, ts, ok := strings.Cut(t, ": "); ok && ResolveName(ts, english) == rs {
				return rv + ": " + ts
			}
		}
		if realName != "" {
			literal = append(literal, realName)
		}
		return realName
	}
	for i, k := range real.Kits {
		real.Kits[i].Name = pick(k.Name, byKey[key(k)].Name)
	}
	for id, w := range real.Weapons {
		w.Name = pick(w.Name, tmpl.Weapons[id].Name)
		real.Weapons[id] = w
	}
	for id, it := range real.Items {
		it.Name = pick(it.Name, tmpl.Items[id].Name)
		real.Items[id] = it
	}
	sort.Strings(literal)
	return literal, nil
}

// WriteTable writes a table, gzipped.
func WriteTable(path string, t *Table) error {
	b, err := json.Marshal(t)
	if err != nil {
		return err
	}
	var z bytes.Buffer
	w, _ := gzip.NewWriterLevel(&z, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return os.WriteFile(path, z.Bytes(), 0o644)
}

// ReadTable reads a gzipped table (refusing a format this app doesn't know).
func ReadTable(b []byte) (*Table, error) {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(r, 256<<20))
	if err != nil {
		return nil, err
	}
	var t Table
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, err
	}
	if t.Format != TableFormat {
		return nil, fmt.Errorf("item table format %d (this app reads %d)", t.Format, TableFormat)
	}
	if len(t.Kits) == 0 {
		return nil, fmt.Errorf("empty item table")
	}
	return &t, nil
}

// UseTable makes the game read its items from a table: the index (Index) and the weapon attachment data; without
// the data-library tables (a -tags noembed build), also the visibility masks the model export uses.
func (g *Game) UseTable(t *Table) {
	g.table = t
	if !datalib.HaveTables() {
		datalib.SetVisibilityMasks(t.visibilityMasks())
	}
}

func (t *Table) visibilityMasks() map[stingray.Hash]datalib.VisibilityMaskComponent {
	out := map[stingray.Hash]datalib.VisibilityMaskComponent{}
	for id, tm := range t.Masks {
		var m datalib.VisibilityMaskComponent
		for i, e := range tm.Infos {
			if i < len(m.MaskInfos) {
				m.MaskInfos[i] = datalib.VisibilityMaskInfo{Name: stingray.ThinHash{Value: e[0]}, Index: uint16(e[1]), StartHidden: uint8(e[2])}
			}
		}
		for i, e := range tm.Rand {
			if i < len(m.Randomizations) {
				m.Randomizations[i].Identifier = stingray.ThinHash{Value: e[0]}
				for k := range m.Randomizations[i].MaskIndexNames {
					m.Randomizations[i].MaskIndexNames[k] = stingray.ThinHash{Value: e[k+1]}
				}
			}
		}
		out[parseHash(id)] = m
	}
	return out
}

// Table: the table in use (nil: the data-library tables).
func (g *Game) Table() *Table { return g.table }

// IndexFromTable: the index of the table in use, names filled from the install (English).
func (g *Game) IndexFromTable() *Index {
	lang := g.english()
	idx := &Index{Version: IndexVersion}
	for _, k := range g.table.Kits {
		// (a gear kit of a unit with no geometry: nothing to show; gearKits leaves them out too)
		if strings.HasPrefix(k.ID, gearIDPrefix) && len(k.Units) == 1 {
			if h, err := lut.ParseHash(k.Units[0].Unit); err == nil && !g.hasMeshes(stingray.Hash{Value: h}) {
				continue
			}
		}
		k.Name = ResolveName(k.Name, lang)
		k.Pieces = append([]Piece(nil), k.Pieces...) // (dropUndrawnPatterns edits them; the table stays as read)
		idx.Kits = append(idx.Kits, k)
	}
	g.dropUndrawnPatterns(idx)
	sort.SliceStable(idx.Kits, func(i, j int) bool { return strings.ToLower(idx.Kits[i].Name) < strings.ToLower(idx.Kits[j].Name) })
	return idx
}

func (g *Game) english() map[uint32]string {
	g.langOnce.Do(func() {
		g.lang = stingray_strings.LoadLanguageMap(g.data, stingray_strings.LanguageFriendlyNameToHash["English (US)"])
	})
	return g.lang
}

// weaponDataFromTable: the weapon components, items and names WeaponOptions uses, from the table in use.
func (g *Game) weaponDataFromTable() (map[stingray.Hash]datalib.WeaponCustomizationComponent, map[uint32]datalib.WeaponCustomizableItem,
	map[stingray.Hash]string) {
	lang := g.english()
	comps := map[stingray.Hash]datalib.WeaponCustomizationComponent{}
	names := map[stingray.Hash]string{}
	for id, tw := range g.table.Weapons {
		ent := parseHash(id)
		var w datalib.WeaponCustomizationComponent
		for i, d := range tw.Defaults {
			if i < len(w.DefaultCustomizations) {
				w.DefaultCustomizations[i].Slot = enum.WeaponCustomizationSlot(d.Slot)
				w.DefaultCustomizations[i].Customization = stingray.ThinHash{Value: uint32(parseHash(d.Item).Value)}
			}
		}
		for i, s := range tw.Slots {
			if i < len(w.CustomizationSlots) {
				w.CustomizationSlots[i] = enum.WeaponCustomizationSlot(s)
			}
		}
		w.OpticsPath, w.MagazinePath, w.MuzzlePath = parseHash(tw.Optics), parseHash(tw.Magazine), parseHash(tw.Muzzle)
		comps[ent] = w
		if tw.Name != "" {
			names[ent] = ResolveName(tw.Name, lang)
		}
	}
	items := map[uint32]datalib.WeaponCustomizableItem{}
	for id, ti := range g.table.Items {
		v := uint32(parseHash(id).Value)
		it := datalib.WeaponCustomizableItem{ID: stingray.ThinHash{Value: v}, AddPath: parseHash(ti.Add), Archive: parseHash(ti.Archive),
			DebugName: ti.Debug, NameCased: ResolveName(ti.Name, lang)}
		for _, s := range ti.Slots {
			it.Slots = append(it.Slots, enum.WeaponCustomizationSlot(s))
		}
		items[v] = it
	}
	return comps, items, names
}

// CacheKey: what derived data (models, textures, animations) is cached under, so a game update doesn't serve old
// copies: "build-<Steam build id>", else (the website: no Steam folder around the install) "data-<the data
// folder's archive size, time and file count>"; "" when neither is known.
func (g *Game) CacheKey() string {
	if b := g.Build(); b != "" {
		return "build-" + b
	}
	if k, err := dataDirKey(filepath.Join(g.Dir, "data")); err == nil {
		return "data-" + k
	}
	return ""
}

var buildIDRe = regexp.MustCompile(`"buildid"\s+"(\d+)"`)

// Build: the install's Steam build id (from steamapps/appmanifest_553850.acf), "" when unknown.
func (g *Game) Build() string {
	// <library>/steamapps/common/Helldivers 2 -> <library>/steamapps/appmanifest_553850.acf
	b, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(filepath.Clean(g.Dir))), "appmanifest_553850.acf"))
	if err != nil {
		return ""
	}
	if m := buildIDRe.FindSubmatch(b); m != nil {
		return string(m[1])
	}
	return ""
}
