package lut

// Named fields for every texel channel of the armor LUTs. Source: the decoded armor shader. Format hd2-lut/2
// (2026-10-14): "smoothness" fields are roughness and "clean" is metal; hd2-lut/1 files migrate on load.
// Each channel belongs to exactly one field (lut_test checks it), so a document <-> texture round trip is lossless, unused channels included.

// Leaf is one texel channel: column (x), channel (0 r, 1 g, 2 b, 3 a). Material LUTs: one row per zone.
type Leaf struct{ Col, Ch int }

type Kind int

const (
	Scalar Kind = iota // one number
	Color              // [r, g, b], sRGB 0-1 (also written as "#rrggbb")
	Recipe             // an object of named weights (a mask recipe, )
)

type Field struct {
	Group, Key string
	Kind       Kind
	Leaves     []Leaf
	Sub        []string // Recipe: one name per leaf
	Min, Max   float64  // useful range for an editor (the shader accepts any half float)
	Int        bool     // whole numbers (layers, modes)
	Doc        string
	Hidden     bool // not offered for editing (the build mark's channels: lut/mark.go)
}

func (f Field) Path() string { return f.Group + "." + f.Key }

func l(col, ch int) []Leaf { return []Leaf{{col, ch}} }
func rgb(col int) []Leaf   { return []Leaf{{col, 0}, {col, 1}, {col, 2}} }
func rgba(col int) []Leaf  { return []Leaf{{col, 0}, {col, 1}, {col, 2}, {col, 3}} }

var (
	recipeOcc  = []string{"grunge_b", "grunge_a", "edge", "occlusion"} // source S4 / S3: .a weights occlusion
	recipeOff  = []string{"grunge_b", "grunge_a", "edge", "offset"}    // source S3v: .a is the offset
	recipeVary = []string{"grunge_b", "grunge_a", "edge"}              // weights only (the offset is its own field)
)

// Groups in document order.
var Groups = []string{"paint", "detail", "secondary", "wear", "metal", "shine", "clearcoat", "cloth", "glow",
	"iridescence", "camo", "pattern", "trim", "gradient", "decal1", "decal2", "decal3", "decal4", "unused"}

// Material is the 23-column material LUT (one row per zone).
var Material = []Field{
	{Group: "paint", Key: "color", Kind: Color, Leaves: rgb(0), Max: 1, Doc: "Main paint color of the zone (sRGB, as a color picker shows it)."},
	{Group: "paint", Key: "mode", Leaves: l(0, 3), Max: 4, Int: true, Doc: "Material kind: 0 standard, 1 cloth (fuzz; no glow / clearcoat), 2 coated (clearcoat), 3 coated, never patterned, 4 composite surface."},

	{Group: "detail", Key: "layer", Leaves: l(1, 0), Max: 25, Int: true, Doc: "Repeating surface texture (detail tiler layer 0-25: grime, scratches, weave, dents...). 26+ wraps to 0."},
	{Group: "detail", Key: "bump", Leaves: l(1, 1), Max: 3, Doc: "How strongly the surface texture's bumps show: 0 flat, 0.3 subtle, 1 full, 2-3 exaggerated."},
	{Group: "detail", Key: "tiling", Leaves: l(22, 0), Max: 8, Doc: "Repeats of the surface texture: 1 large features, 3 normal, 6+ fine. 0 = off."},

	{Group: "secondary", Key: "color", Kind: Color, Leaves: rgb(2), Max: 1, Doc: "Second paint color, where the secondary mask is on."},
	{Group: "secondary", Key: "mask", Kind: Recipe, Leaves: rgba(3), Sub: recipeOcc, Min: -32, Max: 32, Doc: "Where the secondary color goes: weights of grunge B / grunge A / edges (+) or hollows (-) / tucked-in areas. Small = soft, ±5..32 = crisp. All 0 = nowhere."},
	{Group: "secondary", Key: "mask_offset", Leaves: l(1, 2), Min: -2, Max: 2, Doc: "Grows (+) or shrinks (-) the whole secondary area."},
	{Group: "secondary", Key: "bump", Leaves: l(2, 3), Max: 5, Doc: "Bump multiplier inside the secondary area (1 = unchanged)."},
	{Group: "secondary", Key: "roughness", Leaves: l(22, 1), Max: 1, Doc: "Roughness of the secondary area, 0 glossy - 1 matte (used with roughness_weight)."},
	{Group: "secondary", Key: "roughness_weight", Leaves: l(22, 2), Max: 1, Doc: "How much the secondary area uses its own roughness: 0 not at all, 1 fully."},

	{Group: "wear", Key: "color", Kind: Color, Leaves: rgb(6), Max: 1, Doc: "Color of worn areas (primer, scuffed paint). Hidden under camo."},
	{Group: "wear", Key: "heavy_color", Kind: Color, Leaves: rgb(5), Max: 1, Doc: "Color of the most worn spots (wear mask squared), e.g. bare metal. Hidden under camo."},
	{Group: "wear", Key: "mask", Kind: Recipe, Leaves: rgba(4), Sub: recipeOcc, Min: -32, Max: 32, Doc: "Where paint is worn: edge 2-10 = worn raised edges; grunge weights add chipping. All 0 = no wear."},
	{Group: "wear", Key: "mask_offset", Leaves: l(1, 3), Min: -3, Max: 1, Doc: "+ more worn everywhere, - wear only on the strongest edges."},
	{Group: "wear", Key: "bump", Leaves: l(5, 3), Max: 5, Doc: "Bump multiplier inside worn areas (1 = unchanged)."},

	{Group: "metal", Key: "mask", Kind: Recipe, Leaves: rgba(7), Sub: recipeOcc, Min: -32, Max: 32, Doc: "Where the zone is bare metal: reflections take the paint color, no diffuse (e.g. edge + = metallic raised edges). Dirt, blood, gunk and snow remove it. All 0 = not metal."},
	{Group: "metal", Key: "offset", Leaves: l(6, 3), Min: -1, Max: 1, Doc: "Makes the whole zone more (+) or less (-) metallic. With an all-zero mask: 0 not metal, 1 fully metal."},

	{Group: "shine", Key: "roughness", Leaves: l(10, 0), Max: 1, Doc: "Roughness: 0 mirror-like, 0.4 satin, 0.6 semi-matte, 0.9 very matte (typical cloth)."},
	{Group: "shine", Key: "roughness_vary", Kind: Recipe, Leaves: rgba(9), Sub: []string{"grunge_b", "grunge_a", "edge", "hollow"}, Min: -2, Max: 2, Doc: "Varies roughness with the surface texture, raised edges only, hollows only (+ rougher, - glossier). 0 = uniform."},
	{Group: "shine", Key: "specular", Leaves: l(8, 3), Max: 1, Doc: "Highlight strength: 0.5 normal (paint, plastic, metal), 0 none, 1 maximum."},
	{Group: "shine", Key: "specular_vary", Kind: Recipe, Leaves: rgb(8), Sub: recipeVary, Min: -0.5, Max: 0.5, Doc: "Varies the highlight with the surface texture / edges. Keep small; 0 = uniform."},

	{Group: "clearcoat", Key: "amount", Leaves: l(10, 2), Max: 1, Doc: "Clear lacquer coat on top: 0 off, 0.4-0.6 light, 1 full. Needs paint.mode 2, 3 or 4."},
	{Group: "clearcoat", Key: "detail_layer", Leaves: l(10, 1), Max: 25, Int: true, Doc: "Surface texture giving the lacquer its bumps (0-25)."},
	{Group: "clearcoat", Key: "bump", Leaves: l(10, 3), Max: 3, Doc: "Bumpiness of the lacquer (0 = glass-smooth)."},
	{Group: "clearcoat", Key: "roughness", Kind: Recipe, Leaves: rgba(11), Sub: []string{"grunge_b", "grunge_a", "edge", "base"}, Min: -2, Max: 2, Doc: "Lacquer roughness: base 0 glossy - 1 matte, varied by its texture and edges. Read only with clearcoat on."},

	{Group: "cloth", Key: "fuzz_color", Kind: Color, Leaves: rgb(12), Max: 1, Doc: "Cloth (mode 1): color of the grazing-angle rim and of the cloth's reflections (moved toward the base color by glow.emissive)."},
	{Group: "cloth", Key: "rim", Leaves: l(12, 3), Max: 1, Doc: "Cloth: how strongly the outline / grazing angles take the fuzz color (baked into the color). 0.2 typical."},
	{Group: "cloth", Key: "fuzz", Leaves: l(13, 1), Max: 1, Doc: "Cloth: reflection sheen - reflections take the fuzz color and are fully blurred. Off inside the secondary area, under metal and when wet."},

	{Group: "glow", Key: "emissive", Leaves: l(13, 0), Max: 0.15, Doc: "Glow in the zone's own color: 0 off, 0.01 faint, 0.1 strong, ~0.13 maximum; weaker on dark or rough zones; replaced by the burn glow while burning. Cloth (mode 1): how far the fuzz color moves toward the base color instead."},

	{Group: "iridescence", Key: "thickness", Leaves: l(13, 2), Max: 1, Doc: "Oil-slick color: position in the thin-film rainbow (8 steps)."},
	{Group: "iridescence", Key: "thickness_shift", Leaves: l(13, 3), Max: 1, Doc: "Shifts the color further inside the iridescence mask."},
	{Group: "iridescence", Key: "mask", Kind: Recipe, Leaves: rgba(14), Sub: recipeOff, Min: -2, Max: 2, Doc: "Where the oil-slick sheen appears (offset alone = flat 0-1 level)."},
	{Group: "iridescence", Key: "strength", Kind: Recipe, Leaves: rgba(15), Sub: recipeOff, Min: -2, Max: 2, Doc: "How strong it is (multiplied with mask). Shows only on dark base colors."},

	{Group: "camo", Key: "layer", Leaves: l(21, 3), Min: -1, Max: 4, Int: true, Doc: "Camo pattern: -1 none, 0 fine speckle, 1 mottled, 3 woodland, 4 tiger stripes (2 = debug arrows)."},
	{Group: "camo", Key: "color1", Kind: Color, Leaves: rgb(16), Max: 1, Doc: "Camo background color."},
	{Group: "camo", Key: "color2", Kind: Color, Leaves: rgb(17), Max: 1, Doc: "First set of blobs."},
	{Group: "camo", Key: "color3", Kind: Color, Leaves: rgb(18), Max: 1, Doc: "Second set of blobs (over color2)."},
	{Group: "camo", Key: "color4", Kind: Color, Leaves: rgb(19), Max: 1, Doc: "Third set of blobs (over the others)."},
	{Group: "camo", Key: "contrast", Leaves: l(21, 0), Max: 400, Doc: "Blob edge sharpness: 2-10 soft, 200-400 crisp (the game's)."},
	{Group: "camo", Key: "offset", Leaves: l(21, 1), Min: -4, Max: 1, Doc: "Grows (+) / shrinks (-) the blobs (divided by contrast)."},
	{Group: "camo", Key: "tiling", Leaves: l(21, 2), Max: 2, Doc: "Pattern size: 0.1 huge blobs, 1.5 fine."},
	{Group: "camo", Key: "keep", Kind: Recipe, Leaves: []Leaf{{17, 3}, {18, 3}, {19, 3}, {20, 3}}, Sub: []string{"grunge_b", "grunge_a", "edge", "threshold"}, Min: -4, Max: 4, Doc: "Where the original paint shows through the camo (all 0 = camo everywhere; edge + = camo worn off edges)."},
	{Group: "camo", Key: "roughness", Leaves: l(16, 3), Max: 1, Doc: "Roughness of camo-painted areas (used with roughness_weight)."},
	{Group: "camo", Key: "roughness_weight", Leaves: l(22, 3), Max: 1, Doc: "How much camo areas use the camo roughness."},

	{Group: "unused", Key: "col20_rgb", Kind: Recipe, Leaves: rgb(20), Sub: []string{"r", "g", "b"}, Doc: "Not read by any game shader; LUT Studio's build mark (kept at the game's values in projects).", Hidden: true},
}

// Pattern is the 3 x 1 pattern LUT.
var Pattern = []Field{
	{Group: "pattern", Key: "color", Kind: Color, Leaves: rgb(0), Max: 1, Doc: "Pattern color (sRGB)."},
	{Group: "pattern", Key: "mask_layer", Leaves: l(0, 3), Min: -1, Max: 3, Int: true, Doc: "Pattern mask layer; exactly -1 = no pattern."},
	{Group: "pattern", Key: "mask", Kind: Recipe, Leaves: rgba(1), Sub: recipeOff, Min: -32, Max: 32, Doc: "Pattern strength recipe inside the painted pattern mask."},
	{Group: "pattern", Key: "roughness", Leaves: l(2, 3), Max: 1, Doc: "Roughness inside the pattern."},
	{Group: "unused", Key: "texel2_rgb", Kind: Recipe, Leaves: rgb(2), Sub: []string{"r", "g", "b"}, Doc: "Not read by the armor shader; kept for a lossless round trip."},
}

const (
	MaterialWidth = 23
	PatternWidth  = 3
)
