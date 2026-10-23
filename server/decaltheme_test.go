package server

import (
	"math"
	"testing"

	"lutstudio/lut"
)

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

// decalInks: the artwork's light parts light and its dark parts dark, in the trim's hue (lightened) and the
// secondary's (or another of the theme's dark colors; else the secondary darkened)
func TestDecalInks(t *testing.T) {
	row := func(r, g, b float32) []float32 { return []float32{r, g, b, 1} }
	gold, white, purple, red := row(0.85, 0.65, 0.25), row(0.92, 0.92, 0.9), row(0.18, 0.08, 0.3), row(0.5, 0.05, 0.05)
	c3 := func(r []float32) [3]float32 { return [3]float32{r[0], r[1], r[2]} }
	L := func(c [3]float32) float64 { return oklab(c)[0] }
	// gold trim, purple secondary: as they are
	light, dark, ok := decalInks([]map[string][]float32{{"trim": gold, "primary": white, "secondary": purple}})
	if !ok || light != c3(gold) || dark != c3(purple) {
		t.Errorf("gold and purple: %v %v", light, dark)
	}
	// gold trim, white secondary (Precursor Vex Chrome): the dark parts a dark gold
	light, dark, _ = decalInks([]map[string][]float32{{"trim": gold, "primary": white, "secondary": white}})
	if light != c3(gold) || L(dark) > decalDarkMax || dark[0] <= dark[2] {
		t.Errorf("gold and white: %v %v (L %.2f)", light, dark, L(dark))
	}
	// a dark red trim: the light parts a light red (not the white primary), the dark ones the purple
	light, dark, _ = decalInks([]map[string][]float32{{"trim": red, "primary": white, "secondary": purple}})
	if L(light) < decalLightMin || light[0] <= light[2] || dark != c3(purple) {
		t.Errorf("red trim, white primary: %v %v", light, dark)
	}
	light, dark, _ = decalInks([]map[string][]float32{{"trim": red, "primary": red, "secondary": red}})
	if L(light) < decalLightMin || light[0] <= light[2] || L(dark) > decalDarkMax {
		t.Errorf("all red: %v %v", light, dark)
	}
	if _, _, ok = decalInks([]map[string][]float32{{}}); ok {
		t.Error("no colors: ok")
	}
}

// camoShades / copyColors: a look without camo on a row the game gives camo keeps the pattern in shades of the
// look's paint (the hue the paint's, the blobs apart in lightness); fadeColor: a dark fade stays dark, in the hue given
func TestCamoShadesAndFades(t *testing.T) {
	olive := [4][3]float32{{0.1836, 0.1992, 0.1641}, {0.2266, 0.25, 0.2148}, {0.2188, 0.2188, 0.1875}, {0.2969, 0.2969, 0.2188}}
	red := [3]float32{0.7, 0.1, 0.1}
	sh := camoShades(red, olive)
	lo, hi := 1.0, 0.0
	for _, c := range sh {
		if c[0] <= c[1] || c[0] <= c[2] {
			t.Errorf("not red: %v", c)
		}
		lo, hi = min(lo, oklab(c)[0]), max(hi, oklab(c)[0])
	}
	if hi-lo < 0.15 {
		t.Errorf("blobs too close: %.2f", hi-lo)
	}
	row := func() []float32 { return make([]float32, 23*4) }
	game, look, cur := row(), row(), row()
	for i, c := range olive {
		copy(game[(16+i)*4:], c[:])
	}
	game[21*4+3], look[21*4+3] = 3, -1
	copy(look, red[:])
	copy(cur, game)
	copyColors(cur, look, game)
	if cur[21*4+3] != 3 || cur[16*4] <= cur[16*4+1] {
		t.Errorf("camo: layer %v, color1 %v", cur[21*4+3], cur[16*4:16*4+3])
	}
	f := fadeColor([3]float32{0.2, 0.4, 0.9}, [3]float32{0.14, 0.11, 0.05})
	if oklab(f)[0] > 0.45 || f[2] <= f[0] {
		t.Errorf("fade: %v", f)
	}
}

// lookFor: a cape's glow panels take the trim, whatever glow the theme has; elsewhere a glow stays the theme's
func TestCapeGlowTakesTrim(t *testing.T) {
	trim := []float32{0.7, 0.6, 0.4}
	if l := lookFor(map[string][]float32{"trim": trim}, nil, "Capes", false); len(l["glow"]) == 0 || l["glow"][0] != trim[0] {
		t.Errorf("cape glow: %v", l["glow"])
	}
	cyan := []float32{0.25, 1, 1}
	if l := lookFor(map[string][]float32{"trim": trim, "glow": cyan}, nil, "Capes", false); l["glow"][0] != trim[0] {
		t.Errorf("cape glow with a theme glow: %v", l["glow"])
	}
	if l := lookFor(map[string][]float32{"trim": trim}, nil, "Armor", false); l["glow"] != nil {
		t.Errorf("armor glow: %v", l["glow"])
	}
}

// glass: a visor the roles keep takes the most colorful of the theme's trim, secondary and primary in its hue, as dark
// and as tinted as the game's; a gray theme gives smoked glass; a zone that isn't glass stays kept
func TestGlassTint(t *testing.T) {
	red := [3]float32{0.81, 0.25, 0}
	looks := map[string][]float32{"trim": {0.4, 0.4, 0.4}, "secondary": {0.2, 0.2, 0.2}, "primary": {0.8, 0.1, 0.5}}
	c, ok := glassLook(looks)
	if !ok || c[0] != 0.8 {
		t.Errorf("most colorful: %v", c)
	}
	g := glassTint(c, red)
	if math.Abs(oklab(g)[0]-oklab(red)[0]) > 0.02 || g[2] <= g[1] {
		t.Errorf("magenta glass: %v", g)
	}
	if s := glassTint([3]float32{0.5, 0.5, 0.5}, red); math.Abs(float64(s[0]-s[2])) > 0.02 {
		t.Errorf("smoked: %v", s)
	}
	van := &lut.Texture{Width: 23, Height: 2, Px: make([]float32, 23*4*2)}
	copy(van.Px, red[:])
	van.Px[10*4+2] = 1 // (row 0: a visor; row 1 not glass)
	van.Px[23*4] = 0.3
	d := &lut.Document{Tex: &lut.Texture{Width: 23, Height: 2, Px: append([]float32(nil), van.Px...)}}
	_, changed, n, _ := themeZones(d, van, []string{"keep", "keep"}, looks, nil, true, nil)
	if !changed || n != 1 || d.Tex.Px[2] <= d.Tex.Px[1] || d.Tex.Px[23*4] != 0.3 {
		t.Errorf("themeZones glass: changed %v, %d zones, row 0 %v, row 1 %v", changed, n, d.Tex.Px[:3], d.Tex.Px[23*4])
	}
}
