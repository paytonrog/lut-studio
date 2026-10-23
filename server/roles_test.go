package server

import (
	"encoding/json"
	"fmt"
	"testing"

	"lutstudio/game"
	"lutstudio/lut"
)

func TestRoles(t *testing.T) {
	if len(BuiltinRoles()) > 0 {
		for h, r := range BuiltinRoles() {
			if err := checkRoles(h, r); err != nil {
				t.Errorf("built-in roles.json: %v", err)
			}
		}
	}
	c, _ := setup(t)
	if code, _ := c.do("PUT", "/api/roles", map[string][]string{"0x00000000000000aa": {"primary", "shiny"}}); code != 400 {
		t.Errorf("an unknown role: %d, want 400", code)
	}
	if code, _ := c.do("PUT", "/api/roles", map[string][]string{"aa": {"primary"}}); code != 400 {
		t.Errorf("not a hash: %d, want 400", code)
	}
	c.json("PUT", "/api/roles", map[string][]string{"0x00000000000000aa": {"primary", "trim", "cloth"}, "0x00000000000000bb": {"unused"}}, nil)
	c.json("PUT", "/api/roles", map[string]any{"0x00000000000000bb": nil}, nil)
	var got struct {
		Names []string            `json:"names"`
		Mine  map[string][]string `json:"mine"`
	}
	c.json("GET", "/api/roles", nil, &got)
	if len(got.Names) != len(Roles) || len(got.Mine) != 1 || len(got.Mine["0x00000000000000aa"]) != 3 || got.Mine["0x00000000000000aa"][2] != "cloth" {
		t.Fatalf("roles: %+v", got)
	}
	code, b := c.do("GET", "/api/roles/export", nil)
	var f RoleFile
	if code != 200 || json.Unmarshal(b, &f) != nil || f.Version != 1 || f.Roles["0x00000000000000aa"][0] != "primary" {
		t.Fatalf("export: %d %s", code, b)
	}
}

// the build mark's channels (column 20 r, g, b) are hidden from the editor and keep the project's values on save
func TestMarkChannelsKept(t *testing.T) {
	c, dir := setup(t)
	var schema struct {
		Material []struct {
			Group, Key string
			Hidden     bool
		}
	}
	c.json("GET", "/api/schema", nil, &schema)
	hidden := 0
	for _, f := range schema.Material {
		if f.Hidden {
			hidden++
			if f.Key != "col20_rgb" {
				t.Errorf("hidden: %s.%s", f.Group, f.Key)
			}
		}
	}
	if hidden != 1 {
		t.Fatalf("%d hidden material fields, want 1", hidden)
	}
	c.json("POST", "/api/open", map[string]string{"Path": dir}, nil)
	var doc struct{ Px []float32 }
	c.json("GET", "/api/doc?variant=default&lut=0x00000000000000aa", nil, &doc)
	mark, color := 20*4, 0 // zone 0: column 20 r, column 0 r
	was := doc.Px[mark]
	doc.Px[mark], doc.Px[color] = 9, 0.5
	c.json("PUT", "/api/doc?variant=default&lut=0x00000000000000aa", map[string]any{"px": doc.Px}, nil)
	c.json("GET", "/api/doc?variant=default&lut=0x00000000000000aa", nil, &doc)
	if doc.Px[mark] != was || doc.Px[color] != 0.5 {
		t.Fatalf("after save: mark channel %v (was %v), color %v", doc.Px[mark], was, doc.Px[color])
	}
}

func TestSuggestRoles(t *testing.T) {
	// zones: 0 big gray, 1 smaller blue, 2 cloth, 3 glowing, 4 metal, 5 unused
	van := lut.New(lut.MaterialWidth, 6)
	for z, c := range [][3]float32{{0.5, 0.5, 0.5}, {0.1, 0.2, 0.8}, {0.3, 0.3, 0.3}, {1, 1, 1}, {0.6, 0.6, 0.6}, {1, 0, 1}} {
		for ch := 0; ch < 3; ch++ {
			van.Set(0, z, ch, c[ch])
		}
	}
	van.Set(0, 2, 3, 1)
	van.Set(13, 3, 0, 0.1)
	van.Set(6, 4, 3, 1)
	got := suggestRoles(van, []float64{0.5, 0.2, 0.1, 0.05, 0.15, 0})
	want := []string{"primary", "secondary", "cloth", "glow", "hardware", "unused"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("with coverage: %v, want %v", got, want)
	}
	// without a mask: nothing unused, the first painted zone primary, the other painted zones trim
	got = suggestRoles(van, nil)
	want = []string{"primary", "trim", "cloth", "glow", "hardware", "trim"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("without coverage: %v, want %v", got, want)
	}
}

// an item's roles are decided across its parts: its main color is primary on every part (CE-35 Trench Engineer: its
// orange is the biggest zone of its legs and a smaller one of its torso), specks unused, an undersuit's paint in
// the armor's colors their roles
func TestSuggestItem(t *testing.T) {
	mk := func(colors ...[3]float32) *lut.Texture {
		tx := lut.New(lut.MaterialWidth, len(colors))
		for z, c := range colors {
			for ch := 0; ch < 3; ch++ {
				tx.Set(0, z, ch, c[ch])
			}
		}
		return tx
	}
	orange, dark, beige := [3]float32{0.78, 0.36, 0.02}, [3]float32{0.2, 0.2, 0.2}, [3]float32{0.69, 0.66, 0.61}
	legs := mk(orange, dark, [3]float32{0.1, 0.5, 0.1}, dark)
	torso := mk(beige, orange, dark, dark)
	under := mk(dark, orange, [3]float32{0.1, 0.5, 0.1})
	got := suggestItem([]itemLUT{
		{"legs", legs, []float64{0.6, 0.3, 0.0005, 0}, false, 0, false},
		{"torso", torso, []float64{0.2, 0.3, 0.1, 0.1}, false, 0, false},
		{"under", under, []float64{0.8, 0.1, 0.1}, true, 0, false},
	})
	want := map[string][]string{
		"legs":  {"primary", "secondary", "unused", "secondary"}, // (a speck unused; a pixel-less copy of a used zone its role)
		"torso": {"trim", "primary", "secondary", "secondary"},
		"under": {"secondary", "primary", "trim"}, // (paint in the armor's colors takes their roles; its own color trim)
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("suggestItem:\n got %v\nwant %v", got, want)
	}

	// metal plates as big as the paint are the armor's look (primary); a big third color far from both main colors is
	// trim, a big one near one joins it; undersuit paint matching a joined color takes its role
	white, steel, olive, mid := [3]float32{0.8, 0.8, 0.8}, [3]float32{0.82, 0.83, 0.83}, [3]float32{0.32, 0.31, 0.27}, [3]float32{0.28, 0.28, 0.28}
	plates := mk(white, dark, steel, orange, mid)
	plates.Set(6, 0, 3, 1) // metal
	plates.Set(6, 2, 3, 1)
	more := mk(dark, olive)
	suit := mk(olive)
	got = suggestItem([]itemLUT{
		{"plates", plates, []float64{0.6, 0.2, 0.02, 0.3, 0.03}, false, 0, false},
		{"more", more, []float64{0.3, 0.2}, false, 0, false},
		{"suit", suit, []float64{0.9}, true, 0, false},
	})
	want = map[string][]string{
		"plates": {"primary", "secondary", "primary", "trim", "secondary"},
		"more":   {"secondary", "secondary"},
		"suit":   {"secondary"},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("suggestItem, metal and far colors:\n got %v\nwant %v", got, want)
	}

	// weighed by surface: a magazine all in one color (100% of its small LUT) doesn't outweigh the receiver's color
	body, mag := mk(dark, orange), mk(orange)
	got = suggestItem([]itemLUT{
		{"body", body, []float64{0.7, 0.3}, false, 0.5, false},
		{"mag", mag, []float64{1}, false, 0.05, false},
	})
	want = map[string][]string{"body": {"primary", "secondary"}, "mag": {"secondary"}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("suggestItem, by surface:\n got %v\nwant %v", got, want)
	}
}

// the review's items: helmets, capes, backpacks and weapons each a group; backpacks and weapons listed by name
func TestRoleItems(t *testing.T) {
	s := &Server{}
	idx := &game.Index{Kits: []game.Kit{
		{ID: "0x01", Name: "Guard Dog", Type: game.BackpackType, Pieces: []game.Piece{{Unit: "0x1", Slot: "m_body", MaterialLUT: "0x00000000000000b1"}}},
		{ID: "0x02", Name: "Liberator", Type: game.WeaponType, Pieces: []game.Piece{{Unit: "0x2", Slot: "m_gun", MaterialLUT: "0x00000000000000c1"}}},
		{ID: "0x03", Name: "Recon", Type: "Helmet", Pieces: []game.Piece{{Unit: "0x3", Slot: "helmet", MaterialLUT: "0x00000000000000d1"}}},
	}}
	got := map[string]string{}
	for _, it := range s.roleItems(idx) {
		got[it.Group] = it.Value
	}
	if got["Backpacks"] != idx.Key(idx.Kits[0]) || got["Weapons"] != idx.Key(idx.Kits[1]) || got["Helmets"] != "kit:0x03" {
		t.Errorf("roleItems groups: %v", got)
	}
}

// a helmet's LUTs come with its armor set's (same name key): its colors are decided with the armor's
func TestSetLUTs(t *testing.T) {
	s := &Server{idx: &game.Index{Kits: []game.Kit{
		{ID: "0x10", Name: "B-01 Tactical", Type: "Armor", Pieces: []game.Piece{
			{Unit: "0x1", Slot: "torso", MaterialLUT: "0x00000000000000a1"}, {Unit: "0x2", Slot: "legs", MaterialLUT: "0x00000000000000a2"}}},
		{ID: "0x11", Name: "B-01 Tactical", Type: "Helmet", Pieces: []game.Piece{{Unit: "0x3", Slot: "helmet", MaterialLUT: "0x00000000000000b1"}}},
		{ID: "0x12", Name: "CE-35 Trench Engineer", Type: "Armor", Pieces: []game.Piece{{Unit: "0x4", Slot: "torso", MaterialLUT: "0x00000000000000c1"}}},
	}}}
	if got := fmt.Sprint(s.setLUTs([]string{"0x00000000000000b1"})); got != "[0x00000000000000a1 0x00000000000000a2]" {
		t.Errorf("helmet's set: %s", got)
	}
	if got := s.setLUTs([]string{"0x00000000000000a1"}); got != nil {
		t.Errorf("an armor has no set context: %v", got)
	}
}

// an undersuit's metal matching the armor's gold trim follows it (DP-40's gold piping); other undersuit metal stays
// hardware
func TestSuggestItemUndersuitMetal(t *testing.T) {
	mk := func(colors ...[3]float32) *lut.Texture {
		tx := lut.New(lut.MaterialWidth, len(colors))
		for z, c := range colors {
			for ch := 0; ch < 3; ch++ {
				tx.Set(0, z, ch, c[ch])
			}
		}
		return tx
	}
	dark, orange := [3]float32{0.2, 0.2, 0.2}, [3]float32{0.78, 0.36, 0.02}
	gold, steel := [3]float32{0.87, 0.67, 0.31}, [3]float32{0.82, 0.83, 0.83}
	armor, suit := mk(dark, orange, gold), mk(gold, steel)
	armor.Set(6, 2, 3, 1)
	suit.Set(6, 0, 3, 1)
	suit.Set(6, 1, 3, 1)
	got := suggestItem([]itemLUT{
		{"armor", armor, []float64{0.45, 0.25, 0.3}, false, 1, false},
		{"suit", suit, []float64{0.1, 0.1}, true, 1, false},
	})
	if got["suit"][0] != got["armor"][2] || got["suit"][0] == "hardware" || got["suit"][1] != "hardware" {
		t.Errorf("undersuit metal: armor %v, suit %v", got["armor"], got["suit"])
	}
}

// a helmet with its set: colors matching the armor's main colors take their roles, its own color stays its own
func TestWithSet(t *testing.T) {
	mk := func(colors ...[3]float32) *lut.Texture {
		tx := lut.New(lut.MaterialWidth, len(colors))
		for z, c := range colors {
			for ch := 0; ch < 3; ch++ {
				tx.Set(0, z, ch, c[ch])
			}
		}
		return tx
	}
	orange, dark, white := [3]float32{0.78, 0.36, 0.02}, [3]float32{0.2, 0.2, 0.2}, [3]float32{0.9, 0.9, 0.88}
	armor := itemLUT{"armor", mk(orange, dark), []float64{0.6, 0.4}, false, 1, false}
	// CE-35-like: the helmet's dark is its biggest color, the armor's orange is the set's primary
	got := withSet([]itemLUT{{"helmet", mk(dark, orange), []float64{0.6, 0.4}, false, 0.2, false}}, []itemLUT{armor})
	if fmt.Sprint(got["helmet"]) != "[secondary primary]" {
		t.Errorf("helmet in the set's colors: %v", got["helmet"])
	}
	// B-01-like: a white helmet, a color the armor lacks, stays primary
	got = withSet([]itemLUT{{"helmet", mk(white, dark), []float64{0.7, 0.3}, false, 0.2, false}}, []itemLUT{armor})
	if got["helmet"][0] != "primary" {
		t.Errorf("helmet's own color: %v", got["helmet"])
	}
}

// glass (coated, never patterned, a full clearcoat: a helmet's visor) is kept by the roles (a theme tints it), even
// as big metal; a fully coated composite (the Yellow Jacket skins' gloss) is paint
func TestSuggestGlass(t *testing.T) {
	tx := lut.New(lut.MaterialWidth, 2)
	for ch := 0; ch < 3; ch++ {
		tx.Set(0, 0, ch, 0.4)
		tx.Set(0, 1, ch, 0.7)
	}
	tx.Set(0, 1, 3, 3)  // coated, never patterned
	tx.Set(6, 1, 3, 1)  // metal
	tx.Set(10, 1, 2, 1) // full clearcoat
	got := suggestItem([]itemLUT{{"helmet", tx, []float64{0.6, 0.4}, false, 1, false}})
	if fmt.Sprint(got["helmet"]) != "[primary keep]" {
		t.Errorf("visor: %v", got["helmet"])
	}
	tx.Set(0, 1, 3, 4) // composite
	tx.Set(6, 1, 3, 0)
	got = suggestItem([]itemLUT{{"tank", tx, []float64{0.3, 0.7}, false, 1, false}})
	if got["tank"][1] == "keep" {
		t.Errorf("coated composite kept: %v", got["tank"])
	}
}

// a cape's cloth zones are its design's colors: grouped like paint (its main fabric primary, panels secondary)
func TestSuggestCape(t *testing.T) {
	tx := lut.New(lut.MaterialWidth, 3)
	for z, c := range [][3]float32{{0.2, 0.2, 0.2}, {0.8, 0.5, 0.1}, {0.2, 0.2, 0.2}} {
		for ch := 0; ch < 3; ch++ {
			tx.Set(0, z, ch, c[ch])
		}
		tx.Set(0, z, 3, 1) // cloth
	}
	got := suggestItem([]itemLUT{{"cape", tx, []float64{0.5, 0.2, 0.3}, false, 1, true}})
	if fmt.Sprint(got["cape"]) != "[primary secondary primary]" {
		t.Errorf("cape: %v", got["cape"])
	}
	got = suggestItem([]itemLUT{{"suit", tx, []float64{0.5, 0.2, 0.3}, false, 1, false}})
	if fmt.Sprint(got["suit"]) != "[cloth cloth cloth]" {
		t.Errorf("not a cape: %v", got["suit"])
	}
}

// a cloth zone given a paint role takes the look's colors only, keeping its own finish (mode, roughness…)
func TestCopyColors(t *testing.T) {
	cur, look := make([]float32, lut.MaterialWidth*4), make([]float32, lut.MaterialWidth*4)
	for i := range look {
		look[i] = 0.5
	}
	cur[3], cur[40] = 1, 0.9 // mode cloth; a roughness value
	look[21*4+3] = -1        // no camo
	copyColors(cur, look, nil)
	if cur[0] != lut.Round(0.5) || cur[2*4] != lut.Round(0.5) || cur[3] != 1 || cur[40] != 0.9 || cur[16*4] != 0 {
		t.Errorf("copyColors: %v", cur[:24])
	}
}

// focusItems: the items with a LUT in focus, and every earlier item sharing a LUT with one taken (and theirs in turn);
// not later items, not unwanted ones
func TestFocusItems(t *testing.T) {
	item := func(luts ...string) roleItem {
		it := roleItem{Group: "Armor"}
		for _, l := range luts {
			it.LUTs = append(it.LUTs, roleLUT{LUT: l})
		}
		return it
	}
	all := []roleItem{
		item("a", "b"), // 0: shares b with 2, which shares c with 3 (in focus): taken
		item("x"),      // 1: shares nothing: not taken
		item("b", "c"), // 2: shares c with 3: taken
		item("c", "d"), // 3: d in focus: taken
		item("d", "e"), // 4: d in focus: taken
		item("e"),      // 5: shares e with 4, but later: not taken
		{Group: "Capes", LUTs: []roleLUT{{LUT: "c"}}}, // 6: not wanted
	}
	want := func(it roleItem) bool { return it.Group == "Armor" }
	need := focusItems(all, want, map[string]bool{"d": true})
	for i, exp := range []bool{true, false, true, true, true, false, false} {
		if need(i) != exp {
			t.Errorf("item %d: %v, want %v", i, need(i), exp)
		}
	}
	if all := focusItems(all, want, nil); !all(1) || !all(5) {
		t.Error("no focus: every item")
	}
}
