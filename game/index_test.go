package game

import (
	"slices"
	"testing"
)

// a small index: an armor + helmet pair, two same-named armors (color versions), a cape, a vehicle sharing a LUT
func testIndex() *Index {
	return &Index{Kits: []Kit{
		{ID: "0x01", Name: "Ravager", Type: "Armor", Pieces: []Piece{{Slot: "torso", PieceType: "armor", Body: "slim", MaterialLUT: "0xa1", PatternLUT: "0xoff"}}},
		{ID: "0x02", Name: "Ravager", Type: "Helmet", Pieces: []Piece{{Slot: "helmet", PieceType: "armor", Body: "any", MaterialLUT: "0xa2"}}},
		{ID: "0x03", Name: "Tactical", Type: "Armor", Pieces: []Piece{{Slot: "torso", PieceType: "undergarment", Body: "any", MaterialLUT: "0xb1", PatternLUT: "0xoff"}}},
		{ID: "0x04", Name: "Tactical", Type: "Armor", Pieces: []Piece{{Slot: "torso", PieceType: "undergarment", Body: "any", MaterialLUT: "0xb2"}}},
		{ID: "0x05", Name: "Drape", Type: "Cape", Pieces: []Piece{{Slot: "cape", PieceType: "armor", Body: "any", MaterialLUT: "0xc1", CapeLUT: "0xc2"}}},
		{ID: "0x06.7", Name: "FRV: Mustard", Type: VehicleType, Pieces: []Piece{{Slot: "m_frv_body", PieceType: "vehicle", Body: "any", MaterialLUT: "0xa1"}}},
	}}
}

func TestKeys(t *testing.T) {
	idx := testIndex()
	want := map[string]string{"0x01": "Ravager", "0x02": "Ravager", "0x03": "kit:0x03", "0x04": "kit:0x04", "0x05": "Drape", "0x06.7": "FRV: Mustard"}
	for _, k := range idx.Kits {
		if got := idx.Key(k); got != want[k.ID] {
			t.Errorf("Key(%s %s) = %q, want %q", k.Name, k.Type, got, want[k.ID])
		}
	}
	// a name key gives the armor and its helmet, never the same-named color versions
	if ks := idx.ByKey("Ravager"); len(ks) != 2 {
		t.Errorf("ByKey(Ravager): %d kits", len(ks))
	}
	if ks := idx.ByKey("Tactical"); len(ks) != 0 {
		t.Errorf("ByKey(Tactical) should be empty (two versions, picked by id): %v", ks)
	}
	if ks := idx.ByKey("kit:0x04"); len(ks) != 1 || ks[0].ID != "0x04" {
		t.Errorf("ByKey(kit:0x04): %v", ks)
	}
	if ks := idx.ByKey("kit:0x99"); ks != nil {
		t.Errorf("unknown id: %v", ks)
	}
	if k, ok := idx.ByID("0x05"); !ok || k.Name != "Drape" {
		t.Errorf("ByID: %v %v", k, ok)
	}
}

func TestPartsAndUsers(t *testing.T) {
	idx := testIndex()
	parts := idx.Parts()
	// 0xa1 is the Ravager's torso and the FRV's body: two users, with their piece kinds
	var kinds []string
	for _, p := range parts["0xa1"] {
		kinds = append(kinds, p.Key+"/"+p.Type)
	}
	slices.Sort(kinds)
	if !slices.Equal(kinds, []string{"FRV: Mustard/vehicle", "Ravager/armor"}) {
		t.Errorf("parts of 0xa1: %v", kinds)
	}
	if ps := parts["0xc2"]; len(ps) != 1 || ps[0].Type != "cape_trim" {
		t.Errorf("cape LUT part: %+v", ps)
	}
	if ps := parts["0xc1"]; len(ps) != 1 || ps[0].Type != "cape" {
		t.Errorf("cape material part: %+v", ps)
	}
	if ps := parts["0xoff"]; len(ps) != 2 || ps[0].Type != "pattern" {
		t.Errorf("pattern parts: %+v", ps)
	}
	if u := idx.Users()["0xa1"]; len(u) != 2 {
		t.Errorf("users of 0xa1: %v", u)
	}
}

func TestFind(t *testing.T) {
	idx := testIndex()
	if ks := idx.Find("ravager"); len(ks) != 2 {
		t.Errorf("exact (case-insensitive): %d", len(ks))
	}
	if ks := idx.Find("tact"); len(ks) != 2 {
		t.Errorf("substring: %d", len(ks))
	}
	if ks := idx.Find("nothing like it"); len(ks) != 0 {
		t.Errorf("no match: %d", len(ks))
	}
}
