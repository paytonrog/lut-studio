package server

import "testing"

// recolorDecals: alpha kept; "two": light parts take the light color, dark parts the dark one; "one": the light
// color, the artwork's shading a little
func TestRecolorDecals(t *testing.T) {
	px := []byte{255, 255, 255, 200, 0, 0, 0, 255, 128, 128, 128, 0}
	two := append([]byte(nil), px...)
	recolorDecals(two, "two", [3]float32{1, 0.5, 0}, [3]float32{0, 0, 1})
	if two[0] != 255 || two[1] != 128 || two[2] != 0 || two[3] != 200 {
		t.Errorf("white -> light: %v", two[:4])
	}
	if two[4] != 0 || two[5] != 0 || two[6] != 255 || two[7] != 255 {
		t.Errorf("black -> dark: %v", two[4:8])
	}
	if two[11] != 0 {
		t.Errorf("alpha changed: %d", two[11])
	}
	one := append([]byte(nil), px...)
	recolorDecals(one, "one", [3]float32{0.8, 0.8, 0.8}, [3]float32{})
	if !(one[0] > one[4] && one[4] > 0 && one[3] == 200) {
		t.Errorf("one color, shading kept: %v", one)
	}
}

// decalInks: the trim color where it reads on what the decal is drawn on; else another of the theme's colors, else
// the trim color darkened or lightened; the dark color apart from the light one
func TestDecalInks(t *testing.T) {
	row := func(r, g, b float32) []float32 { return []float32{r, g, b, 1} }
	gold, white, purple := row(0.85, 0.65, 0.25), row(0.92, 0.92, 0.9), row(0.18, 0.08, 0.3)
	c3 := func(r []float32) [3]float32 { return [3]float32{r[0], r[1], r[2]} }
	// gold on a dark purple cape: the gold
	light, dark, ok := decalInks([][3]float32{c3(purple)}, []map[string][]float32{{"trim": gold, "primary": white, "secondary": purple}})
	if !ok || light != c3(gold) {
		t.Errorf("gold on purple: %v", light)
	}
	if decalContrast(light, dark) < minDecalContrast {
		t.Errorf("dark too close to light: %v %v", light, dark)
	}
	// gold on a gold cape whose cloth is white too (Precursor Vex Chrome): neither, a dark gold
	light, dark, _ = decalInks([][3]float32{c3(gold), c3(white)}, []map[string][]float32{{"trim": gold, "primary": white, "secondary": gold}})
	for _, s := range [][]float32{gold, white} {
		if max(decalContrast(light, c3(s)), decalContrast(dark, c3(s))) < minDecalContrast {
			t.Errorf("on gold and white: %v / %v doesn't read on %v", light, dark, s)
		}
	}
	if decalContrast(light, dark) < minDecalContrast {
		t.Errorf("dark too close to light: %v %v", light, dark)
	}
	// nothing known underneath: the trim color, as before
	if light, _, _ = decalInks(nil, []map[string][]float32{{"trim": gold, "secondary": purple}}); light != c3(gold) {
		t.Errorf("no surfaces: %v", light)
	}
	if _, _, ok = decalInks(nil, []map[string][]float32{{}}); ok {
		t.Error("no colors: ok")
	}
}
