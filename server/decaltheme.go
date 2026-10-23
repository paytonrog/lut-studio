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

// decalLightMin, decalDarkMax: a decal's light parts at least this light, its dark parts at most this dark (OKLab
// lightness): its artwork reads as the game drew it (a white emblem on its own black disk), in the theme's hues
const decalLightMin, decalDarkMax = 0.72, 0.32

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

func fromOklab(c [3]float64) [3]float32 {
	l := math.Pow(c[0]+0.3963377774*c[1]+0.2158037573*c[2], 3)
	m := math.Pow(c[0]-0.1055613458*c[1]-0.0638541728*c[2], 3)
	s := math.Pow(c[0]-0.0894841775*c[1]-1.2914855480*c[2], 3)
	gam := func(x float64) float32 {
		x = math.Min(math.Max(x, 0), 1)
		if x <= 0.0031308 {
			return float32(12.92 * x)
		}
		return float32(1.055*math.Pow(x, 1/2.4) - 0.055)
	}
	return [3]float32{gam(4.0767416621*l - 3.3077115913*m + 0.2309699292*s), gam(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
		gam(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s)}
}

// withLightness: c at OKLab lightness L (its hue kept; its chroma less as it nears white or black)
func withLightness(c [3]float32, L float64) [3]float32 {
	o := oklab(c)
	k := math.Min(1, 4*math.Min(L, 1-L)) // (a light or dark color can't be as colorful)
	return fromOklab([3]float64{L, o[1] * k, o[2] * k})
}

// decalInks: a decal sheet's light and dark colors, from the looks of the LUTs drawing it (the first one's first),
// keeping its artwork's light and dark (an emblem on its own disk reads wherever it's drawn): light, the trim look's
// color, lifted past decalLightMin if it isn't that light (its hue kept: the theme's, not a white); dark, the secondary's if it's dark enough (decalDarkMax), else the darkest of the
// looks' colors that is, else the secondary (or the trim) lowered past it. ok: the looks have a color.
// web/decaltheme.js decalInks is the same.
func decalInks(looks []map[string][]float32) (light, dark [3]float32, ok bool) {
	of := func(roles ...string) (cs [][3]float32) {
		for _, l := range looks {
			for _, r := range roles {
				if row := l[r]; len(row) >= 3 {
					cs = append(cs, [3]float32{row[0], row[1], row[2]})
				}
			}
		}
		return cs
	}
	all := of("trim", "primary", "secondary")
	if len(all) == 0 {
		return light, dark, false
	}
	pick := func(first [][3]float32, good func(float64) bool, better func(a, b float64) bool, base [3]float32, L float64) [3]float32 {
		if len(first) > 0 && good(oklab(first[0])[0]) {
			return first[0]
		}
		found, best := false, [3]float32{}
		for _, c := range all {
			if l := oklab(c)[0]; good(l) && (!found || better(l, oklab(best)[0])) {
				found, best = true, c
			}
		}
		if found {
			return best
		}
		return withLightness(base, L)
	}
	trims, secs := of("trim"), of("secondary")
	base := all[0]
	if len(trims) > 0 {
		base = trims[0]
	}
	if light = base; oklab(base)[0] < decalLightMin {
		light = withLightness(base, 0.8)
	}
	dbase := base
	if len(secs) > 0 {
		dbase = secs[0]
	}
	dark = pick(secs, func(l float64) bool { return l <= decalDarkMax }, func(a, b float64) bool { return a < b }, dbase, decalDarkMax*0.7)
	return light, dark, true
}

// sheetInks: decalInks for a sheet drawn with these themed LUTs (each item group's looks, swapped as Apply does).
// web/decaltheme.js sheetInks gathers the same from the pieces on screen.
func sheetInks(luts []string, looks map[string][]float32, groupLooks map[string]map[string][]float32,
	lutGroup map[string]string, swapped map[string]bool) (light, dark [3]float32, ok bool) {
	slices.Sort(luts)
	var all []map[string][]float32
	for _, hs := range luts {
		all = append(all, lookFor(looks, groupLooks, lutGroup[hs], swapped[hs]))
	}
	if len(all) == 0 {
		all = append(all, looks)
	}
	return decalInks(all)
}
