package game

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Name templates fill back from a language map (no install needed).
func TestNameTemplates(t *testing.T) {
	lang := map[uint32]string{7: "DESERT", 8: "Mustard Exosuit Pattern", 9: "combat walker frv", 10: ""}
	m := MarkerMap(lang)
	if m[10] != "" || m[7] != "⟦7⟧" {
		t.Fatalf("marker map %v", m)
	}
	for tmpl, want := range map[string]string{
		titleName(m[7]) + " paint scheme": "Desert paint scheme",
		vehicleName(m[9]) + ": " + m[8]:   "Combat Walker FRV: Mustard Exosuit Pattern",
		"⟦99⟧":                            "0x00000063",
		"Pelican (Shuttle): ⟦8⟧":          "Pelican (Shuttle): Mustard Exosuit Pattern",
	} {
		if got := ResolveName(tmpl, lang); got != want {
			t.Errorf("%q -> %q, want %q", tmpl, got, want)
		}
	}
}

// The repo's item table gives the app the same index and the same weapon attachment menus as building them from the
// install's own data-library tables (decrypted, TestMain). Needs the install it was generated from and the key:
// filediver's embedded copies are those of the build it last took them from (25480438's under 25988413).
func TestTableMatchesDataLibrary(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	if !decrypted {
		t.Skip("LUTSTUDIO_DLBIN_KEY not set: the install's data-library tables can't be read")
	}
	raw, err := os.ReadFile("../data/table.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	tbl, err := ReadTable(raw)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if b := ref.Build(); b != tbl.GameBuild {
		t.Skipf("the table is for game build %s, the install is %s", tbl.GameBuild, b)
	}
	want, err := ref.BuildIndex("")
	if err != nil {
		t.Fatal(err)
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	g.UseTable(tbl)
	got := g.IndexFromTable()
	if len(got.Kits) != len(want.Kits) {
		t.Fatalf("%d kits from the table, %d from the data library", len(got.Kits), len(want.Kits))
	}
	for i := range want.Kits {
		if !reflect.DeepEqual(got.Kits[i], want.Kits[i]) {
			a, _ := json.Marshal(got.Kits[i])
			b, _ := json.Marshal(want.Kits[i])
			t.Fatalf("kit %d differs:\n table %s\n datalib %s", i, a, b)
		}
	}
	// every weapon's attachment menus (the game's list and "all")
	n := 0
	for id := range tbl.Weapons {
		ent := parseHash(id).Value
		for _, all := range []bool{false, true} {
			a, errA := g.WeaponOptions(ent, all)
			b, errB := ref.WeaponOptions(ent, all)
			if (errA == nil) != (errB == nil) || !reflect.DeepEqual(a, b) {
				ja, _ := json.Marshal(a)
				jb, _ := json.Marshal(b)
				t.Fatalf("weapon %s (all %v):\n table %s %v\n datalib %s %v", id, all, ja, errA, jb, errB)
			}
			n++
		}
	}
	t.Logf("%d kits, %d weapon menus identical", len(got.Kits), n)
}
