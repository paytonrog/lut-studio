package server

import (
	"math"
	"slices"
)

// Decals in a theme: a decal sheet's artwork recolored in the theme's colors (its shapes, alpha, stay: and a
// vehicle's embossed plates with them). The sheet's colors are in the LUTs' space (sRGB 0-1: the shaders mix them
// into the LUT color before converting), so a look's column 0 color goes in as it is. web/decaltheme.js does the same
// for the previews.

// DecalModes: how a theme recolors decals: "one" (all in the light color, the artwork's shading kept a little),
// "two" (light parts in the light color, dark parts in the dark one, blended across: text on a plate stays readable)
var DecalModes = []string{"one", "two"}

// recolorDecals recolors RGBA8 pixels in place (every pixel: a transparent one's color still shows at the edges of
// the filtered and mipmapped sheet).
func recolorDecals(px []byte, mode string, light, dark [3]float32) {
	for i := 0; i+3 < len(px); i += 4 {
		l := (0.299*float32(px[i]) + 0.587*float32(px[i+1]) + 0.114*float32(px[i+2])) / 255
		var c [3]float32
		if mode == "two" {
			w := smooth(0.3, 0.6, l)
			for k := range c {
				c[k] = dark[k]*(1-w) + light[k]*w
			}
		} else {
			sh := min(max(0.75+0.5*(l-0.5), 0.5), 1.1)
			for k := range c {
				c[k] = light[k] * sh
			}
		}
		for k := range c {
			px[i+k] = byte(min(max(c[k], 0), 1)*255 + 0.5)
		}
	}
}

func smooth(a, b, x float32) float32 {
	t := min(max((x-a)/(b-a), 0), 1)
	return t * t * (3 - 2*t)
}

// decalContrast: how far apart two colors look (OKLab distance, lightness counted twice: readability is mostly
// lightness). Gold on gold 0, yellow on white 0.25, gold on white 0.39, white on grey 0.68, gold on dark purple 1.0.
func decalContrast(a, b [3]float32) float64 {
	x, y := oklab(a), oklab(b)
	dl, da, db := 2*(x[0]-y[0]), x[1]-y[1], x[2]-y[2]
	return math.Sqrt(dl*dl + da*da + db*db)
}

// minDecalContrast: colors at least this far apart read as apart (gold on white doesn't)
const minDecalContrast = 0.45

func oklab(c [3]float32) [3]float64 {
	lin := func(v float32) float64 {
		x := math.Min(math.Max(float64(v), 0), 1)
		if x <= 0.04045 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	r, g, b := lin(c[0]), lin(c[1]), lin(c[2])
	l := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
	m := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
	s := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
	return [3]float64{0.2104542553*l + 0.7936177850*m - 0.0040720468*s, 1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
		0.0259040371*l + 0.7827717662*m - 0.8086757660*s}
}

// decalShade, decalTint: a color taken toward black / white (a decal's own color when none of the theme's reads)
func decalShade(c [3]float32) [3]float32 { return [3]float32{c[0] * 0.2, c[1] * 0.2, c[2] * 0.2} }
func decalTint(c [3]float32) [3]float32 {
	return [3]float32{c[0] + (1-c[0])*0.8, c[1] + (1-c[1])*0.8, c[2] + (1-c[2])*0.8}
}

// decalInks: a decal sheet's light and dark colors, from the looks of the LUTs drawing it (the first one's first). A
// decal's artwork reads by its light parts against its dark ones (an emblem on its own dark disk) and by its outline
// on what it's drawn on (surfaces: their primary look). The light color: the trim look's, else the looks' secondary
// or primary, else the trim taken toward black or white; the dark one: the secondary's, else the primary's, else the
// light one taken toward black or white, the first that reads on the light one. The first light color whose pair reads
// apart and on every surface (the light or the dark color on it) is taken; none: the pair that comes closest. ok: the
// looks have a color. web/decaltheme.js decalInks is the same.
func decalInks(surfaces [][3]float32, looks []map[string][]float32) (light, dark [3]float32, ok bool) {
	colorOf := func(l map[string][]float32, role string) ([3]float32, bool) {
		if row := l[role]; len(row) >= 3 {
			return [3]float32{row[0], row[1], row[2]}, true
		}
		return [3]float32{}, false
	}
	of := func(roles ...string) (cs [][3]float32) {
		for _, l := range looks {
			for _, r := range roles {
				if c, has := colorOf(l, r); has {
					cs = append(cs, c)
				}
			}
		}
		return cs
	}
	lights := append(of("trim"), of("secondary", "primary")...)
	if len(lights) == 0 {
		return light, dark, false
	}
	lights = append(lights, decalShade(lights[0]), decalTint(lights[0]))
	darksOf := func(light [3]float32) [3]float32 {
		cs := append(of("secondary", "primary"), decalShade(light), decalTint(light))
		best, bestC := cs[0], -1.0
		for _, c := range cs {
			if d := decalContrast(c, light); d >= minDecalContrast {
				return c
			} else if d > bestC {
				best, bestC = c, d
			}
		}
		return best
	}
	bestScore := -1.0
	for _, l := range lights {
		d := darksOf(l)
		score := decalContrast(l, d)
		for _, s := range surfaces {
			score = math.Min(score, math.Max(decalContrast(l, s), decalContrast(d, s)))
		}
		if score >= minDecalContrast {
			return l, d, true
		}
		if score > bestScore {
			light, dark, bestScore = l, d, score
		}
	}
	return light, dark, true
}

// sheetInks: decalInks for a sheet drawn with these themed LUTs (each item group's looks, swapped as Apply does),
// drawn on their primary look. web/decaltheme.js sheetInks gathers the same from the pieces on screen.
func sheetInks(luts []string, looks map[string][]float32, groupLooks map[string]map[string][]float32,
	lutGroup map[string]string, swapped map[string]bool) (light, dark [3]float32, ok bool) {
	slices.Sort(luts)
	var surfaces [][3]float32
	var all []map[string][]float32
	for _, hs := range luts {
		l := lookFor(looks, groupLooks, lutGroup[hs], swapped[hs])
		all = append(all, l)
		if row := l["primary"]; len(row) >= 3 {
			surfaces = append(surfaces, [3]float32{row[0], row[1], row[2]})
		}
	}
	if len(all) == 0 {
		all = append(all, looks)
	}
	return decalInks(surfaces, all)
}
