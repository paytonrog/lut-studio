package lut

// Cape is the 16-column cape LUT (one row per cape zone: 0 front, 1 R panel, 2 G panel, 3 B panel, 4 back).
// Source: the decoded cape shader. The cape's colors and cloth look
// are its material LUT (the armor format, Material above); this table adds trim lines, a vertical gradient and up
// to four decals cut out of the cape's decal sheet.
var Cape = []Field{
	{Group: "trim", Key: "color", Kind: Color, Leaves: rgb(0), Max: 1, Doc: "Color of the trim lines (sRGB)."},
	{Group: "trim", Key: "relief", Leaves: l(0, 3), Max: 1, Doc: "Raises the lines as stitched relief (affects wear and dirt that follow edges). 0 on every stock cape."},
	{Group: "trim", Key: "line_a", Kind: Recipe, Leaves: rgba(1), Sub: []string{"position", "sharpness", "half_width", "strength"}, Max: 50,
		Doc: "First trim line, following the inside of this panel's painted edge: position 0 (on the edge) - 0.3 (inside), sharpness 1 (blurry) - 45 (crisp), half width 0 - 0.05, strength 0 (off) - 1. Only on the R / G / B panels."},
	{Group: "trim", Key: "line_b", Kind: Recipe, Leaves: rgba(2), Sub: []string{"position", "sharpness", "half_width", "strength"}, Max: 50,
		Doc: "Second trim line, same settings as line A."},

	{Group: "gradient", Key: "color", Kind: Color, Leaves: rgb(3), Max: 1, Doc: "Color that fades in from the top (or the hem). Also shifts the secondary color."},
	{Group: "gradient", Key: "strength", Leaves: l(3, 3), Min: -1, Max: 1, Doc: "How much of the gradient color shows: + fades in toward the top, - toward the hem, 0 off."},
	{Group: "gradient", Key: "start", Leaves: l(6, 2), Max: 1, Doc: "Where the fade starts (0 hem ... 1 collar, of the shared gradient texture)."},
	{Group: "gradient", Key: "fade", Leaves: l(6, 3), Max: 10, Doc: "How quickly it fades in: 1 long soft fade, 4 short, 100 a hard edge. 0 disables the gradient."},
	{Group: "gradient", Key: "wear_inside", Leaves: l(9, 2), Max: 6, Doc: "Inside the gradient, multiplies the wear: 1 unchanged, 0 no wear, 3 triple."},
	{Group: "gradient", Key: "secondary_inside", Leaves: l(9, 3), Max: 6, Doc: "Inside the gradient, multiplies the secondary-color area: 1 unchanged, 0 none."},
}

func init() {
	// decals 1-4: placement (rectangle on the cape), emblem (which part of the decal sheet), paint factor, opacity
	for i, cols := range [][3]int{{4, 5, 6}, {7, 8, 9}, {10, 11, 12}, {13, 14, 15}} {
		g := "decal" + string(rune('1'+i))
		chain := ""
		switch i {
		case 0:
			chain = " Opacity 0 here switches off all four decals."
		case 3:
			chain = " Needs decal 3 to be on."
		default:
			chain = " Needs decal 1 to be on."
		}
		Cape = append(Cape,
			Field{Group: g, Key: "opacity", Leaves: l(cols[2], 1), Min: -1, Max: 1, Doc: "0 off, 1 fully visible; negative mirrors the emblem. Front of the cape only." + chain},
			Field{Group: g, Key: "placement", Kind: Recipe, Leaves: rgba(cols[0]), Sub: []string{"x", "y", "width", "height"}, Max: 1,
				Doc: "Where the emblem sits on the cape: center x (0.5 = middle), y (0.2 - 0.8 from the top), width and height (0.04 - 0.3)."},
			Field{Group: g, Key: "emblem", Kind: Recipe, Leaves: rgba(cols[1]), Sub: []string{"sheet_x", "sheet_y", "rotation", "scale"}, Min: -3.1416, Max: 3.1416,
				Doc: "Which part of the decal sheet: center -1..1 (cells of a 4 x 4 sheet at ±0.25 / ±0.75), rotation on the cape in radians, scale (bigger = a smaller piece of the sheet; negative turns the sheet 90°)."},
			Field{Group: g, Key: "patch", Leaves: l(cols[2], 0), Max: 1, Doc: "0 printed into the cloth (keeps the sheen, wears off), 1 a stiff patch (flat, roughness 0.4, never worn)."},
		)
	}
	Cape = append(Cape,
		Field{Group: "unused", Key: "col12_zw", Kind: Recipe, Leaves: []Leaf{{12, 2}, {12, 3}}, Sub: []string{"z", "w"}, Doc: "Not read by the cape shader; kept for a lossless round trip."},
		Field{Group: "unused", Key: "col15_zw", Kind: Recipe, Leaves: []Leaf{{15, 2}, {15, 3}}, Sub: []string{"z", "w"}, Doc: "Not read by the cape shader; kept for a lossless round trip."},
	)
}

const CapeWidth = 16

// CapeZoneNames are the default labels of a cape LUT's / cape material LUT's rows.
var CapeZoneNames = []string{"front", "R panel", "G panel", "B panel", "back"}
