package server

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
