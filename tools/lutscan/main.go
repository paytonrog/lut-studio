// lutscan: dev tool (not shipped). Inventory of everything in the install that uses material LUTs: LUT-shaped
// textures, the materials (and base materials / shaders) that bind them, the units using those materials, and the
// customization tables that swap LUTs (armor kits, vehicle / hellpod / shuttle skins, weapon paint schemes).
// Reads the install only; writes a JSON report.
//
//	go run ./tools/lutscan [-o local/lutscan/report.json]
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/xypwn/filediver/app"
	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/datalibrary/enum"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"
	"github.com/xypwn/filediver/stingray/unit"
	"github.com/xypwn/filediver/stingray/unit/material"

	"lutstudio/game"
)

type texInfo struct {
	W, H, Format uint32
}

type matUse struct {
	Material string `json:"material"`
	Base     string `json:"base"`
	Slot     string `json:"slot"`
}

type report struct {
	LUTTextures   map[string]texInfo             `json:"lut_textures"`    // hash -> shape
	SlotCounts    map[string]int                 `json:"slot_counts"`     // material slot -> materials binding a LUT there
	Bases         map[string]*baseInfo           `json:"bases"`           // base material -> what uses it
	UsedBy        map[string][]string            `json:"used_by"`         // LUT -> "system: who"
	Vehicles      map[string]map[string][]string `json:"vehicles"`        // collection / skin -> material id -> LUTs
	Weapons       map[string][]string            `json:"weapons"`         // weapon entity -> LUTs
	UnitsByPrefix map[string]int                 `json:"units_by_prefix"` // units whose materials bind a LUT, by path
	UnitLUTs      map[string][]string            `json:"unit_luts"`       // named unit -> "material slot=LUT base"
	PaintSchemes  map[string]int                 `json:"paint_schemes"`   // weapon paint scheme -> distinct LUTs
}

type baseInfo struct {
	Name      string         `json:"name"`
	Materials int            `json:"materials"`
	Slots     map[string]int `json:"slots"`
	Units     map[string]int `json:"units_by_prefix"`
	Examples  []string       `json:"examples"`
}

func main() {
	out := flag.String("o", "lutscan-report.json", "report file (game-derived: never commit it)")
	flag.Parse()
	dir, err := game.Detect()
	if err != nil {
		panic(err)
	}
	a, err := app.OpenGameDir(context.Background(), dir, hashes.ParseHashes(hashes.Hashes),
		hashes.ParseHashes(hashes.ThinHashes), stingray_strings.LanguageFriendlyNameToHash["English (US)"], nil)
	if err != nil {
		panic(err)
	}
	h := func(x stingray.Hash) string { return a.LookupHash(x) }
	hs := func(x stingray.Hash) string { return fmt.Sprintf("0x%016x", x.Value) }
	r := report{LUTTextures: map[string]texInfo{}, SlotCounts: map[string]int{}, Bases: map[string]*baseInfo{},
		UsedBy: map[string][]string{}, Vehicles: map[string]map[string][]string{}, Weapons: map[string][]string{},
		UnitsByPrefix: map[string]int{}, UnitLUTs: map[string][]string{}}
	use := func(lut stingray.Hash, who string) {
		if lut.Value == 0 {
			return
		}
		k := hs(lut)
		if l := r.UsedBy[k]; len(l) < 400 && (len(l) == 0 || l[len(l)-1] != who) {
			r.UsedBy[k] = append(l, who)
		}
	}

	// 1. LUT-shaped textures: DX10, half or float RGBA, 23 (material), 16 (cape) or 3 (pattern) wide
	texType, matType, unitType := stingray.Sum("texture"), stingray.Sum("material"), stingray.Sum("unit")
	shapes := map[string]int{}
	for id := range a.DataDir.Files {
		if id.Type != texType {
			continue
		}
		b, err := a.DataDir.ReadAtMost(id, stingray.DataMain, 512)
		if err != nil {
			continue
		}
		d := bytes.Index(b, []byte("DDS "))
		if d < 0 || len(b) < d+148 || string(b[d+84:d+88]) != "DX10" {
			continue
		}
		u := func(o int) uint32 { return binary.LittleEndian.Uint32(b[d+o:]) }
		w, ht, f := u(16), u(12), u(128)
		if (f == 10 || f == 2) && (w == 23 || w == 16 || w == 3) && ht <= 32 {
			r.LUTTextures[hs(id.Name)] = texInfo{w, ht, f}
			shapes[fmt.Sprintf("%dx%d f%d", w, ht, f)]++
		}
	}
	fmt.Println("LUT-shaped textures:", len(r.LUTTextures), shapes)

	// 2. materials binding one
	matsWithLUT := map[stingray.Hash][]matUse{}
	nMat := 0
	for id := range a.DataDir.Files {
		if id.Type != matType {
			continue
		}
		b, err := a.DataDir.Read(id, stingray.DataMain)
		if err != nil {
			continue
		}
		m, err := material.LoadMain(bytes.NewReader(b))
		if err != nil {
			continue
		}
		nMat++
		for slot, tex := range m.Textures {
			if _, ok := r.LUTTextures[hs(tex)]; !ok {
				continue
			}
			mu := matUse{Material: h(id.Name), Base: hs(m.BaseMaterial), Slot: a.LookupThinHash(slot)}
			matsWithLUT[id.Name] = append(matsWithLUT[id.Name], mu)
			r.SlotCounts[mu.Slot]++
			bi := r.Bases[mu.Base]
			if bi == nil {
				bi = &baseInfo{Name: h(m.BaseMaterial), Slots: map[string]int{}, Units: map[string]int{}}
				r.Bases[mu.Base] = bi
			}
			bi.Slots[mu.Slot]++
			use(tex, "material default: "+mu.Material+" ["+mu.Slot+"]")
		}
		if l := matsWithLUT[id.Name]; len(l) > 0 {
			bi := r.Bases[l[0].Base]
			bi.Materials++
			if len(bi.Examples) < 8 {
				bi.Examples = append(bi.Examples, l[0].Material)
			}
		}
	}
	fmt.Printf("materials: %d, binding a LUT: %d, slots %v\n", nMat, len(matsWithLUT), r.SlotCounts)

	// 3. units using those materials, by path prefix
	prefix := func(name string) string {
		if !strings.Contains(name, "/") {
			return "(unnamed)"
		}
		p := strings.Split(name, "/")
		if len(p) > 3 {
			p = p[:3]
		}
		return strings.Join(p, "/")
	}
	for id := range a.DataDir.Files {
		if id.Type != unitType {
			continue
		}
		b, err := a.DataDir.Read(id, stingray.DataMain)
		if err != nil {
			continue
		}
		info, err := unit.LoadInfo(bytes.NewReader(b))
		if err != nil {
			continue
		}
		seen := false
		for _, mh := range info.Materials {
			l := matsWithLUT[mh]
			if len(l) == 0 {
				continue
			}
			if !seen {
				seen = true
				r.UnitsByPrefix[prefix(h(id.Name))]++
			}
			r.Bases[l[0].Base].Units[prefix(h(id.Name))]++
			if un := h(id.Name); strings.Contains(un, "/") {
				for _, mu := range l {
					tex := ""
					if b, err := a.DataDir.Read(stingray.FileID{Name: mh, Type: matType}, stingray.DataMain); err == nil {
						if m, err := material.LoadMain(bytes.NewReader(b)); err == nil {
							for slot, t := range m.Textures {
								if a.LookupThinHash(slot) == mu.Slot {
									tex = hs(t)
								}
							}
						}
					}
					r.UnitLUTs[un] = append(r.UnitLUTs[un], fmt.Sprintf("%s %s=%s base %s", mu.Material, mu.Slot, tex, mu.Base))
				}
			}
		}
	}

	getResource := func(id stingray.FileID, typ stingray.DataType) ([]byte, bool, error) {
		d, err := a.DataDir.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			return nil, false, nil
		}
		return d, err == nil, err
	}

	// 4. vehicle / hellpod / shuttle skins
	ucs, err := datalib.ParseUnitCustomizationSettings(getResource, a.LanguageMap)
	if err != nil {
		fmt.Println("unit customization:", err)
	}
	for _, c := range ucs {
		g := c.GetSkinOverrideGroup()
		for _, sk := range g.Skins {
			key := fmt.Sprintf("%v / %s / %s", c.CollectionType, c.ObjectName, sk.Name)
			m := map[string][]string{}
			for mat, ovs := range sk.Overrides {
				for _, o := range ovs {
					for _, l := range []stingray.Hash{o.MaterialLut, o.PatternLut} {
						if l.Value != 0 {
							m[a.LookupThinHash(mat)] = append(m[a.LookupThinHash(mat)], hs(l))
							use(l, fmt.Sprintf("vehicle skin: %v %s", c.CollectionType, sk.Name))
						}
					}
				}
			}
			r.Vehicles[key] = m
		}
	}
	fmt.Println("unit customization collections/skins:", len(r.Vehicles))

	// 5. weapons: default LUT per customization slot, and per paint-scheme materials
	wcs, err := datalib.ParseWeaponCustomizationComponents(getResource, a.LanguageMap)
	if err != nil {
		fmt.Println("weapon customization:", err)
	}
	for ent, w := range wcs {
		var l []string
		add := func(o datalib.UnitCustomizationMaterialOverrides, what string) {
			for _, x := range []stingray.Hash{o.MaterialLut, o.PatternLut} {
				if x.Value != 0 {
					l = append(l, hs(x))
					use(x, "weapon: "+h(ent)+" ("+what+")")
				}
			}
		}
		for _, o := range w.MaterialOverride.DefaultWeaponSlotMaterial {
			add(o, "default")
		}
		for _, s := range w.MaterialOverride.WeaponSlotMaterialCustomization {
			for _, o := range s.Overrides {
				add(o, fmt.Sprint(s.Slot))
			}
		}
		if len(l) > 0 {
			r.Weapons[h(ent)] = l
		}
	}
	fmt.Println("weapons with LUT overrides:", len(r.Weapons))
	// weapon paint schemes: each scheme is an entity delta (its AddPath) patching every weapon's customization
	// component; the patched MaterialOverride holds the scheme's LUTs (as filediver's unit exporter applies them)
	deltas, err := datalib.ParseEntityDeltas()
	schemes := map[string]map[string]bool{}
	painted := 0
	for ent, w := range wcs {
		if err != nil || !slices.Contains(w.CustomizationSlots[:], enum.WeaponCustomizationSlot_PaintScheme) {
			continue
		}
		data, derr := datalib.GetWeaponCustomizationComponentDataForHash(ent)
		if derr != nil {
			continue
		}
		painted++
		for _, ps := range a.WeaponPaintSchemes {
			delta, ok := deltas[ps.AddPath]
			if !ok || ps.NameUpper == "DEFAULT" {
				continue
			}
			patched, perr := datalib.PatchComponent(datalib.Sum("WeaponCustomizationComponentData"), data, delta)
			if perr != nil {
				continue
			}
			var c datalib.WeaponCustomizationComponent
			if _, perr := binary.Decode(patched, binary.LittleEndian, &c); perr != nil {
				continue
			}
			name := ps.NameCased
			for _, n := range []string{ps.NameUpper, ps.DebugName, fmt.Sprintf("%08x", ps.ID.Value)} {
				if name == "" {
					name = n
				}
			}
			ps.NameCased = name
			if schemes[ps.NameCased] == nil {
				schemes[ps.NameCased] = map[string]bool{}
			}
			add := func(o datalib.UnitCustomizationMaterialOverrides) {
				for _, x := range []stingray.Hash{o.MaterialLut, o.PatternLut} {
					if x.Value != 0 {
						schemes[ps.NameCased][hs(x)] = true
						use(x, "weapon paint scheme: "+ps.NameCased)
					}
				}
			}
			for _, o := range c.MaterialOverride.DefaultWeaponSlotMaterial {
				add(o)
			}
			for _, s := range c.MaterialOverride.WeaponSlotMaterialCustomization {
				for _, o := range s.Overrides {
					add(o)
				}
			}
		}
	}
	r.PaintSchemes = map[string]int{}
	for k, v := range schemes {
		r.PaintSchemes[k] = len(v)
	}
	fmt.Printf("weapons with a paint scheme slot: %d; paint schemes (distinct LUTs): %v\n", painted, r.PaintSchemes)

	// 6. armor kits (LUT Studio's index)
	g, err := game.Open(dir)
	if err == nil {
		if idx, err := g.BuildIndex("English (US)"); err == nil {
			for _, k := range idx.Kits {
				for _, p := range k.Pieces {
					for _, x := range []string{p.MaterialLUT, p.PatternLUT, p.CapeLUT} {
						if x != "" {
							if v, err := stingray.ParseHash(x); err == nil {
								use(v, "armor kit: "+k.Name+" ("+k.Type+")")
							}
						}
					}
				}
			}
		}
	}

	// coverage: each LUT texture by the first system using it
	cover := map[string]int{}
	for k := range r.LUTTextures {
		sys := "unused (no material default, kit, skin or weapon)"
		for _, u := range r.UsedBy[k] {
			s := u[:strings.Index(u, ":")]
			if s != "material default" {
				sys = s
				break
			}
			sys = s
		}
		cover[sys]++
	}
	fmt.Println("LUT textures by first user:", cover)
	var bases []string
	for k := range r.Bases {
		bases = append(bases, k)
	}
	sort.Slice(bases, func(i, j int) bool { return r.Bases[bases[i]].Materials > r.Bases[bases[j]].Materials })
	for _, k := range bases {
		b := r.Bases[k]
		fmt.Printf("base %s %q: %d materials, slots %v, units %v, e.g. %v\n", k, b.Name, b.Materials, b.Slots, b.Units, b.Examples[:min(3, len(b.Examples))])
	}
	fmt.Println("units by prefix:", r.UnitsByPrefix)
	os.MkdirAll(filepath.Dir(*out), 0o755)
	js, _ := json.MarshalIndent(r, "", " ")
	os.WriteFile(*out, js, 0o644)
	fmt.Println("wrote", *out)
}
