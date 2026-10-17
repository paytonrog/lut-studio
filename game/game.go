// Package game reads what LUT Studio needs from the user's own Helldivers 2 install, read-only: vanilla LUT
// textures and the armor kit index. Nothing from the game ships with the tool.
//
// Archives are read with filediver's stingray package; it ignores deployed mod patches (*.patch_N), so a LUT read
// here is always the vanilla one. The armor kit table (which piece uses which LUT) is in the game's data library,
// which is encrypted on disk; filediver carries a decrypted copy, which is used here
// with kit names from the install's own string tables. A kit newer than that copy is missing from the index, but
// its LUTs can still be pulled by hash.
package game

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"lutstudio/lut"

	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/steampath"
	"github.com/xypwn/filediver/stingray"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"
)

var TextureType = stingray.Sum("texture")

type Game struct {
	Dir  string
	data *stingray.DataDir

	slotMu   sync.Mutex
	slots    map[stingray.Hash]map[uint32]bool // unit -> material slot names (vehicles)
	poolOnce sync.Once
	pool     []stingray.Hash

	editOnce                sync.Once // EditableTextures (textures.go)
	editSheets, editDesigns map[uint64]bool
	sheetsByLUT             map[uint64][]uint64 // DecalSheetsByLUT (textures.go)
	lutMaterials            map[uint64]int      // LUTMaterials (textures.go)
	editMasks, editPatterns map[uint64]bool

	maskMu   sync.Mutex // MasksOfLUT (lutmasks.go)
	lutUnits map[string][]uint64
	lutMasks map[string][]uint64

	weaponOnce    sync.Once // WeaponOptions' tables
	weaponComps   map[stingray.Hash]datalib.WeaponCustomizationComponent
	weaponItemMap map[uint32]datalib.WeaponCustomizableItem
	weaponNames   map[stingray.Hash]string // weapon entity -> its in-game name ("AR-23 Liberator")
	weaponErr     error

	table    *Table // the item table in use (table.go); nil: the data-library tables
	langOnce sync.Once
	lang     map[uint32]string // the install's English strings
}

// Detect finds the install through Steam.
func Detect() (string, error) {
	dir, err := steampath.GetAppPath("553850", "Helldivers 2")
	if err != nil {
		return "", fmt.Errorf("Helldivers 2 not found through Steam (pass --game <install folder>): %w", err)
	}
	return dir, nil
}

// Open reads the archive tables of an install (the folder holding data/).
// OpenProgress, when set, hears how far Open is through the install's archives (the website's loading bar).
var OpenProgress func(done, total int)

func Open(dir string) (*Game, error) {
	if _, err := os.Stat(filepath.Join(dir, "data")); err != nil {
		return nil, fmt.Errorf("%s: no data folder (is this the Helldivers 2 install folder?)", dir)
	}
	dd, err := openDataDir(filepath.Join(dir, "data"), OpenProgress)
	if err != nil {
		return nil, err
	}
	return &Game{Dir: dir, data: dd}, nil
}

// HasTexture: the game has a texture of that name (a mod's LUT may be one of its own, for its own models).
func (g *Game) HasTexture(name uint64) bool {
	return g.has(stingray.NewFileID(stingray.Hash{Value: name}, TextureType))
}

// ReadTextureParts returns a texture resource's main, stream and GPU data (stream: nil when it has none).
func (g *Game) ReadTextureParts(name uint64) (main, stream, gpu []byte, err error) {
	id := stingray.NewFileID(stingray.Hash{Value: name}, TextureType)
	if main, err = g.data.Read(id, stingray.DataMain); err != nil {
		return nil, nil, nil, fmt.Errorf("texture %s: %w", lut.HashString(name), err)
	}
	if stream, err = g.data.Read(id, stingray.DataStream); err == stingray.ErrFileDataTypeNotExist {
		stream, err = nil, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	if gpu, err = g.data.Read(id, stingray.DataGPU); err == stingray.ErrFileDataTypeNotExist {
		gpu, err = nil, nil
	}
	return main, stream, gpu, err
}

// ReadTexture returns a texture resource's main and GPU data.
func (g *Game) ReadTexture(name uint64) (main, gpu []byte, err error) {
	id := stingray.NewFileID(stingray.Hash{Value: name}, TextureType)
	if main, err = g.data.Read(id, stingray.DataMain); err != nil {
		return nil, nil, fmt.Errorf("texture %s: %w", lut.HashString(name), err)
	}
	gpu, err = g.data.Read(id, stingray.DataGPU)
	return main, gpu, err
}

// ReadLUT returns a vanilla LUT.
func (g *Game) ReadLUT(name uint64) (*lut.Texture, error) {
	main, gpu, err := g.ReadTexture(name)
	if err != nil {
		return nil, err
	}
	t, err := lut.Decode(main, gpu)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", lut.HashString(name), err)
	}
	return t, nil
}

// Index: armor kits, their pieces and LUTs.
type Index struct {
	Version int   `json:"version"` // IndexVersion when built (older caches are rebuilt)
	Kits    []Kit `json:"kits"`

	dupOnce sync.Once
	dup     map[string]int // name + type -> kits
}

// Key identifies a kit in the editor: its name (an armor and its helmet share it), or "kit:<id>" when other kits of
// the same type have that name (B-01 Tactical: 9 armors and 15 helmets, color versions of the same models).
func (idx *Index) Key(k Kit) string {
	idx.dupOnce.Do(func() {
		idx.dup = map[string]int{}
		for _, x := range idx.Kits {
			idx.dup[x.Name+"\x00"+x.Type]++
		}
	})
	if idx.dup[k.Name+"\x00"+k.Type] > 1 {
		return "kit:" + k.ID
	}
	return k.Name
}

// ByKey returns the kits of a key (name: all kits of that name; "kit:<id>": that kit).
func (idx *Index) ByKey(key string) []Kit {
	if id, ok := strings.CutPrefix(key, "kit:"); ok {
		if k, ok := idx.ByID(id); ok {
			return []Kit{k}
		}
		return nil
	}
	var out []Kit
	for _, k := range idx.Kits {
		if k.Name == key && idx.Key(k) == key { // not the same-named kits that have their own keys
			out = append(out, k)
		}
	}
	return out
}

// KitUnit: a unit shown with a kit (vehicles: body and parts), with its path when known.
type KitUnit struct {
	Unit  string `json:"unit"`
	Name  string `json:"name,omitempty"`
	Mount string `json:"mount,omitempty"` // the node of the kit's first unit it mounts on (weapon attachments)
}

type Kit struct {
	ID     string    `json:"id"` // the kit's thin-hash id, 0x + 8 hex digits (tells same-named kits apart)
	Name   string    `json:"name"`
	Type   string    `json:"type"` // Armor, Helmet, Cape
	Pieces []Piece   `json:"pieces"`
	Units  []KitUnit `json:"units,omitempty"` // vehicles: every unit to show (body first)
}

type Piece struct {
	Unit        string `json:"unit"`
	Slot        string `json:"slot"`
	PieceType   string `json:"piece_type"`
	Body        string `json:"body"`
	MaterialLUT string `json:"material_lut,omitempty"`
	PatternLUT  string `json:"pattern_lut,omitempty"`
	// capes: the cape-specific textures of the piece record
	CapeLUT           string `json:"cape_lut,omitempty"`
	CapeGradient      string `json:"cape_gradient,omitempty"`
	CapeNAC           string `json:"cape_nac,omitempty"`
	DecalScalarFields string `json:"decal_scalar_fields,omitempty"`
	DecalSheet        string `json:"decal_sheet,omitempty"`
	BaseData          string `json:"base_data,omitempty"` // overrides the material's base_data (one cape kit)
	Skin              string `json:"skin,omitempty"`      // vehicles: the skin (glTF material variant name)
	Mounted           bool   `json:"mounted,omitempty"`   // vehicles: an override of a mounted weapon's material
}

func hashOrEmpty(h stingray.Hash) string {
	if h.Value == 0 {
		return ""
	}
	return lut.HashString(h.Value)
}

// BuildIndex lists every armor kit with names in the given language ("English (US)" when empty).
func (g *Game) BuildIndex(language string) (*Index, error) {
	if language == "" {
		language = "English (US)"
	}
	lang, ok := stingray_strings.LanguageFriendlyNameToHash[language]
	if !ok {
		return nil, fmt.Errorf("unknown language %q", language)
	}
	return g.buildIndexWith(stingray_strings.LoadLanguageMap(g.data, lang))
}

// buildIndexWith: BuildIndex with the strings of languageMap (a MarkerMap gives name templates).
func (g *Game) buildIndexWith(languageMap map[uint32]string) (*Index, error) {
	sets, err := datalib.LoadArmorSetArray(languageMap, nil)
	if err != nil {
		return nil, err
	}
	idx := &Index{Version: IndexVersion}
	for _, s := range sets {
		k := Kit{ID: s.Id.String(), Name: s.Name, Type: s.Type.String()}
		for unit, p := range s.UnitMetadata {
			k.Pieces = append(k.Pieces, Piece{
				Unit: lut.HashString(unit.Value), Slot: p.Slot.String(), PieceType: p.Type.String(),
				Body: p.BodyType.String(), MaterialLUT: hashOrEmpty(p.MaterialLut), PatternLUT: hashOrEmpty(p.PatternLut),
				CapeLUT: hashOrEmpty(p.CapeLut), CapeGradient: hashOrEmpty(p.CapeGradient), CapeNAC: hashOrEmpty(p.CapeNac),
				DecalScalarFields: hashOrEmpty(p.DecalScalarFields), DecalSheet: hashOrEmpty(p.DecalSheet),
				BaseData: hashOrEmpty(p.BaseData),
			})
		}
		sort.Slice(k.Pieces, func(i, j int) bool {
			a, b := k.Pieces[i], k.Pieces[j]
			if a.Slot != b.Slot {
				return a.Slot < b.Slot
			}
			if a.Body != b.Body {
				return a.Body < b.Body
			}
			return a.Unit < b.Unit
		})
		idx.Kits = append(idx.Kits, k)
	}
	vk, err := g.vehicleKits(languageMap)
	if err != nil {
		return nil, fmt.Errorf("vehicles: %w", err)
	}
	idx.Kits = append(idx.Kits, vk...)
	wk, err := g.weaponKits(languageMap)
	if err != nil {
		return nil, fmt.Errorf("weapons: %w", err)
	}
	idx.Kits = append(idx.Kits, wk...)
	idx.Kits = append(idx.Kits, g.backpackKits(languageMap)...)
	idx.Kits = append(idx.Kits, g.seafKits()...)
	g.addCloth(idx.Kits)
	idx.Kits = append(idx.Kits, g.gearKits(idx.Kits)...)
	g.dropUndrawnPatterns(idx)
	sort.SliceStable(idx.Kits, func(i, j int) bool { return strings.ToLower(idx.Kits[i].Name) < strings.ToLower(idx.Kits[j].Name) })
	return idx, nil
}

// SameModel: for kits the game doesn't name (named returns false for them), the named kit using the most of their
// models (cape excluded), when one does and it covers at least half of them: "SC-34 Infiltrator" for the six
// unnamed recolors of its helmet. Kits of one name (versions) count as one. All: it has every one of their models;
// colors: it also uses all their material LUTs.
func (idx *Index) SameModel(named func(Kit) bool) map[string]struct {
	Name        string
	All, Colors bool
} {
	type hit = struct {
		Name        string
		All, Colors bool
	}
	byUnit := map[string][]int{}
	for i, k := range idx.Kits {
		if named(k) {
			seen := map[string]bool{}
			for _, p := range k.Pieces {
				if p.Slot != "cape" && !seen[p.Unit] {
					seen[p.Unit] = true
					byUnit[p.Unit] = append(byUnit[p.Unit], i)
				}
			}
		}
	}
	out := map[string]hit{}
	for _, k := range idx.Kits {
		if named(k) {
			continue
		}
		units, luts := map[string]bool{}, map[string]bool{}
		for _, p := range k.Pieces {
			if p.Slot != "cape" {
				units[p.Unit], luts[p.MaterialLUT] = true, true
			}
		}
		count := map[string]int{} // by name: the units any kit of that name has
		for u := range units {
			names := map[string]bool{}
			for _, i := range byUnit[u] {
				names[idx.Kits[i].Name] = true
			}
			for n := range names {
				count[n]++
			}
		}
		best, top, ties := "", 0, 0
		for n, c := range count {
			switch {
			case c > top:
				best, top, ties = n, c, 1
			case c == top:
				ties++
			}
		}
		if best == "" || ties > 1 || 2*top < len(units) { // none, a tie, or under half its models
			continue
		}
		has := map[string]bool{}
		for _, m := range idx.Kits {
			if m.Name == best {
				for _, p := range m.Pieces {
					has[p.MaterialLUT] = true
				}
			}
		}
		colors := true
		for l := range luts {
			colors = colors && has[l]
		}
		out[k.ID] = hit{best, top == len(units), colors}
	}
	return out
}

// Users maps each LUT to the kits that use it ("kit name (slot)").
func (idx *Index) Users() map[string][]string {
	out := map[string][]string{}
	for _, k := range idx.Kits {
		for _, p := range k.Pieces {
			for _, h := range []string{p.MaterialLUT, p.PatternLUT, p.CapeLUT} {
				if h == "" {
					continue
				}
				who := fmt.Sprintf("%s (%s)", k.Name, p.Slot)
				if l := out[h]; len(l) == 0 || l[len(l)-1] != who {
					out[h] = append(out[h], who)
				}
			}
		}
	}
	return out
}

// ShockTrooperCape is content/fac_helldivers/capes/shock_trooper_cape (5 cape kits use it; the rest the medium cape).
var ShockTrooperCape = lut.HashString(stingray.Sum("content/fac_helldivers/capes/shock_trooper_cape").Value)

// ByID returns the kit with that id.
func (idx *Index) ByID(id string) (Kit, bool) {
	for _, k := range idx.Kits {
		if strings.EqualFold(k.ID, id) {
			return k, true
		}
	}
	return Kit{}, false
}

// Find returns the kits named exactly q (an armor and its helmet share a name), else those whose name contains q
// (case-insensitive).
func (idx *Index) Find(q string) []Kit {
	ql := strings.ToLower(strings.TrimSpace(q))
	var exact, part []Kit
	for _, k := range idx.Kits {
		switch n := strings.ToLower(k.Name); {
		case n == ql:
			exact = append(exact, k)
		case strings.Contains(n, ql):
			part = append(part, k)
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return part
}

// Part is one use of a LUT: which kit, which slot and body, and what kind of piece ("undergarment" = the undersuit,
// "armor", "accessory", "cape"; "pattern" for a pattern LUT, "cape_trim" for a cape's trim / gradient / decal LUT).
type Part struct {
	Key  string `json:"key"` // the kit's Key
	Kit  string `json:"kit"`
	ID   string `json:"id"` // the kit's id (an armor and its helmet share a name and key, not an id)
	Slot string `json:"slot"`
	Body string `json:"body"`
	Type string `json:"type"`
}

// Parts maps each LUT to its uses.
func (idx *Index) Parts() map[string][]Part {
	out := map[string][]Part{}
	for _, k := range idx.Kits {
		for _, p := range k.Pieces {
			typ := p.PieceType
			if p.Slot == "cape" {
				typ = "cape"
			}
			for _, u := range []struct{ h, typ string }{{p.MaterialLUT, typ}, {p.PatternLUT, "pattern"}, {p.CapeLUT, "cape_trim"}} {
				if u.h != "" {
					out[u.h] = append(out[u.h], Part{idx.Key(k), k.Name, k.ID, p.Slot, p.Body, u.typ})
				}
			}
		}
	}
	return out
}

// IndexVersion: bump when the index gains data (2: vehicles; 3: Pelican name; 4: vehicle parts; 5: nth arm; 6: standard skins, extra override lists; 7: weapons; 8: weapon slots only; 9: weapon attachments; 10: weapon variants on their base unit; 11: backpacks; 12: SEAF, the Bastion's cannon; 13: no pattern LUT on pieces without a pattern mask; 14: throwables, attachments, stratagems, gear; 15: SEAF camouflage looks, the SEAF medic and weapons).
const IndexVersion = 15

// DataDir: the install's archives (tools).
func (g *Game) DataDir() *stingray.DataDir { return g.data }
