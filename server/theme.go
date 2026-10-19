package server

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"image"
	"image/png"
	"lutstudio/atomicfile"
	"maps"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/project"
	"lutstudio/texenc"
)

// Themes: one look (a whole zone row) per role, applied to every zone of that role on many items at once (zone
// roles: roles.go). A zone the theme wrote is rewritten when the theme is applied again; a zone changed by hand since
// (neither the game's row nor the row the theme last wrote there) is kept unless the user asks to overwrite it. What
// the theme last wrote is kept per variant in the project's theme.json (a hash per zone).

// ---- role suggestions (the Roles panel and themes): unused where the parts' ID masks have no pixel of the zone,
// cloth (paint mode 1), glow, hardware (metal), then the painted zones by area: the biggest primary (and zones of its
// color), the next big one secondary (and its color), the rest trim

// suggestRoles: the suggested role of each zone of material LUT van (the game's values); cov: each zone's share of
// the parts (nil: unknown)
func suggestRoles(van *lut.Texture, cov []float64) []string {
	at := func(z, col, ch int) float64 { return float64(van.At(col, z, ch)) }
	roles := make([]string, van.Height)
	var painted []int
	for z := 0; z < van.Height; z++ {
		switch mode := math.Round(at(z, 0, 3)); {
		case cov != nil && z < len(cov) && cov[z] == 0:
			roles[z] = "unused"
		case mode == 1:
			roles[z] = "cloth"
		case at(z, 10, 2) >= 0.9: // (full clearcoat: glass, visors and lenses)
			roles[z] = "keep"
		case at(z, 13, 0) > 0.005:
			roles[z] = "glow"
		case at(z, 6, 3) > 0.5:
			roles[z] = "hardware"
		default:
			painted = append(painted, z)
		}
	}
	if len(painted) == 0 {
		return roles
	}
	area := func(z int) float64 {
		if cov == nil || z >= len(cov) {
			return 0
		}
		return cov[z]
	}
	near := func(a, b int) bool {
		d := 0.0
		for ch := 0; ch < 3; ch++ {
			d += (at(a, 0, ch) - at(b, 0, ch)) * (at(a, 0, ch) - at(b, 0, ch))
		}
		return math.Sqrt(d) < 0.03
	}
	order := append([]int(nil), painted...)
	sort.SliceStable(order, func(i, j int) bool { return area(order[i]) > area(order[j]) })
	p := order[0]
	for _, z := range order {
		if near(z, p) {
			roles[z] = "primary"
		}
	}
	if cov != nil {
		for _, z := range order {
			if roles[z] == "" && area(z) >= 0.25*area(p) {
				for _, z2 := range order {
					if roles[z2] == "" && near(z2, z) {
						roles[z2] = "secondary"
					}
				}
				break
			}
		}
	}
	for _, z := range order {
		if roles[z] == "" {
			roles[z] = "trim"
		}
	}
	return roles
}

// itemLUT: one material LUT of an item, for suggestItem: the game's values, the zones' coverage (nil: unknown),
// whether it is an undersuit's, and its parts' surface area (game.Surface; 0: unknown)
type itemLUT struct {
	h     string
	van   *lut.Texture
	cov   []float64
	under bool
	area  float64
	cape  bool // (a cape's: its cloth zones are its design's colors, grouped like paint)
}

// suggestItem: the suggested roles of an item's LUTs, decided for the item as a whole (one armor's orange is primary
// on every one of its parts, not only where it happens to be the biggest zone):
//   - unused: a zone with (almost) no pixel of the parts' ID masks (under 0.1%: stray pixels); cloth (paint mode 1),
//     glow, hardware (metal) from the game's values; keep for glass (full clearcoat: visors, lenses);
//   - the painted zones of the item's armor parts grouped by the game's color (within 0.05 sRGB), weighted by the
//     surface they cover: their share of their LUT's parts times those parts' area (a weapon's magazine is a fraction
//     of its receiver; a LUT of unknown area counts as the item's median); a metal color weighing at least 35% of the biggest painted one is paint too (B-22 Model
//     Citizen's chrome-white plates, A-9 Helljumper's metal camo plates: the armor's look, not its bolts);
//   - the biggest group primary, the next secondary (when at least 15% of the primary's weight), another group with
//     the nearer of those two colors when it is a shade of it (within 0.16) or big (a quarter of the primary's
//     weight) and not far from it (within 0.3), the rest (a color of its own: accents, a third main color) trim;
//   - an undersuit's paint: the role of the armor's color it is a shade of (plates on the undersuit, prosthetic
//     limbs), else trim (boot soles, buckles…); its metal: the role of the armor's painted color it matches (gold
//     piping matching gold trim), else hardware.
//
// Without coverage the item can't be weighed: each LUT on its own (suggestRoles).
func suggestItem(luts []itemLUT) map[string][]string {
	out := map[string][]string{}
	type pz struct {
		h      string
		z      int
		c      [3]float64
		weight float64
	}
	var painted, metal, underPaint, underMetal []pz
	var areas []float64
	for _, L := range luts {
		if L.cov != nil && L.area > 0 {
			areas = append(areas, L.area)
		}
	}
	median := 1.0
	if len(areas) > 0 {
		sort.Float64s(areas)
		median = areas[len(areas)/2]
	}
	for _, L := range luts {
		size := L.area
		if size <= 0 {
			size = median
		}
		if L.cov == nil {
			out[L.h] = suggestRoles(L.van, nil)
			continue
		}
		at := func(z, col, ch int) float64 { return float64(L.van.At(col, z, ch)) }
		roles := make([]string, L.van.Height)
		for z := range roles {
			c := 0.0
			if z < len(L.cov) {
				c = L.cov[z]
			}
			switch mode := math.Round(at(z, 0, 3)); {
			case c < 0.001:
				roles[z] = "unused"
			case mode == 1 && !L.cape:
				roles[z] = "cloth"
			case at(z, 10, 2) >= 0.9: // (full clearcoat: glass, a helmet's visor, lenses: a theme leaves it)
				roles[z] = "keep"
			case at(z, 13, 0) > 0.005:
				roles[z] = "glow"
			case at(z, 6, 3) > 0.5 && !(L.cape && mode == 1): // (a cape's metallic cloth, gold thread: its design's colors)
				roles[z] = "hardware"
				if L.under {
					underMetal = append(underMetal, pz{L.h, z, [3]float64{at(z, 0, 0), at(z, 0, 1), at(z, 0, 2)}, c * size})
				} else {
					metal = append(metal, pz{L.h, z, [3]float64{at(z, 0, 0), at(z, 0, 1), at(z, 0, 2)}, c * size})
				}
			case L.under: // (an undersuit's paint: decided once the armor's colors are known, below)
				underPaint = append(underPaint, pz{L.h, z, [3]float64{at(z, 0, 0), at(z, 0, 1), at(z, 0, 2)}, c * size})
			default:
				painted = append(painted, pz{L.h, z, [3]float64{at(z, 0, 0), at(z, 0, 1), at(z, 0, 2)}, c * size})
			}
		}
		out[L.h] = roles
	}
	dist := func(a, b [3]float64) float64 {
		return math.Sqrt((a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]) + (a[2]-b[2])*(a[2]-b[2]))
	}
	type group struct {
		c      [3]float64
		weight float64
		zones  []pz
	}
	// zones' color groups, heaviest first
	groupsOf := func(zs []pz) []*group {
		sort.SliceStable(zs, func(i, j int) bool { return zs[i].weight > zs[j].weight })
		var groups []*group
		for _, p := range zs {
			var g *group
			for _, x := range groups {
				if dist(x.c, p.c) < 0.05 {
					g = x
					break
				}
			}
			if g == nil {
				g = &group{c: p.c}
				groups = append(groups, g)
			}
			g.weight += p.weight
			g.zones = append(g.zones, p)
		}
		sort.SliceStable(groups, func(i, j int) bool { return groups[i].weight > groups[j].weight })
		return groups
	}
	groups := groupsOf(painted)
	// metal as big as the paint is the armor's look: painted with the rest
	if top := 0.0; len(metal) > 0 {
		if len(groups) > 0 {
			top = groups[0].weight
		}
		n := len(painted)
		for _, g := range groupsOf(metal) {
			if g.weight >= 0.35*top && g.weight > 0 {
				painted = append(painted, g.zones...)
			}
		}
		if len(painted) > n {
			groups = groupsOf(painted)
		}
	}
	for i, g := range groups {
		role := "trim"
		switch {
		case i == 0:
			role = "primary"
		case i == 1 && g.weight >= 0.15*groups[0].weight:
			role = "secondary"
		case i >= 2:
			// another color: with the nearer of the two main colors when it is a shade of it, or big and not far
			// from it; a color of its own (accents, a third main color) trim
			near, d := "primary", dist(g.c, groups[0].c)
			if len(groups) > 1 && groups[1].weight >= 0.15*groups[0].weight && dist(g.c, groups[1].c) < d {
				near, d = "secondary", dist(g.c, groups[1].c)
			}
			if d < 0.16 || (g.weight >= 0.25*groups[0].weight && d < 0.3) {
				role = near
			}
		}
		for _, p := range g.zones {
			out[p.h][p.z] = role
		}
	}
	// an undersuit's paint in a color of the armor's primary or secondary zones (a shade of one, within 0.16: plates
	// on the undersuit, SA-12 Servo-Assisted's prosthetic limbs, AC-2 Obedient's trousers) takes that role; paint of
	// its own (boot soles, buckles) trim
	for _, p := range underPaint {
		role, best := "trim", 0.16
		for _, g := range groups {
			for _, q := range g.zones {
				if r := out[q.h][q.z]; (r == "primary" || r == "secondary") && dist(p.c, q.c) < best {
					best, role = dist(p.c, q.c), r
				}
			}
		}
		out[p.h][p.z] = role
	}
	// an undersuit's metal in the color of an armor zone that a theme paints (DP-40 Hero of the Federation's gold
	// piping, its armor's gold accents trim) takes that zone's role; other metal stays hardware
	for _, p := range underMetal {
		role, best := "hardware", 0.16
		for _, g := range groups {
			for _, q := range g.zones {
				if r := out[q.h][q.z]; (r == "primary" || r == "secondary" || r == "trim") && dist(p.c, q.c) < best {
					best, role = dist(p.c, q.c), r
				}
			}
		}
		out[p.h][p.z] = role
	}
	// a zone the masks show no pixel of but with the same values as a used zone of its LUT takes that zone's role (CM-21
	// Trench Paramedic's pouches: drawn, yet missing from the masks read; a role on a truly unused row is harmless)
	for _, L := range luts {
		if L.cov == nil {
			continue
		}
		roles := out[L.h]
		for z := range roles {
			if roles[z] != "unused" {
				continue
			}
			for y := range roles {
				if roles[y] != "unused" && sameRow(L.van, z, y) {
					roles[z] = roles[y]
					break
				}
			}
		}
	}
	return out
}

// sameRow: zones z and y of t have the same values (within 0.002)
func sameRow(t *lut.Texture, z, y int) bool {
	for col := 0; col < t.Width; col++ {
		for ch := 0; ch < 4; ch++ {
			if math.Abs(float64(t.At(col, z, ch)-t.At(col, y, ch))) > 0.002 {
				return false
			}
		}
	}
	return true
}

// coverage: each zone's share of the parts wearing LUT h, from their ID masks (the variant's edited ones where it has
// them); nil: no mask known
func (s *Server) coverage(p *project.Project, v *project.Variant, h string, rows int) []float64 {
	g, idx, a := s.game(), s.index(), s.assetsOf()
	if g == nil || idx == nil || a == nil {
		return nil
	}
	masks := g.MasksOfLUT(idx, h)
	// (only the masks of the primitives wearing h when known: a weapon unit's other materials have their own)
	if sf, ok := a.Surface(idx, h); ok && len(sf.Masks) > 0 {
		masks = masks[:0:0]
		for _, m := range sf.Masks {
			if x, err := lut.ParseHash(m); err == nil {
				masks = append(masks, x)
			}
		}
	}
	if len(masks) == 0 {
		return nil
	}
	count := make([]float64, rows)
	total := 0.0
	for _, m := range masks {
		w, hh, layers, px := 0, 0, 0, []byte(nil)
		if p != nil && v != nil {
			if b, err := os.ReadFile(SheetPath(p, *v, m, "mask")); err == nil {
				if img, err := png.Decode(bytes.NewReader(b)); err == nil {
					if main, _, err := g.ReadTexture(m); err == nil {
						if in, err := texenc.ReadInfo(main); err == nil && img.Bounds().Dy() == in.Height*max(1, in.Layers) {
							n := texenc.ToNRGBA(img)
							w, hh, layers, px = in.Width, in.Height, max(1, in.Layers), n.Pix
						}
					}
				}
			}
		}
		if px == nil {
			blob, err := a.TextureBlob(m)
			if err != nil || len(blob) < 20 || binary.LittleEndian.Uint32(blob[16:]) != 0 {
				continue
			}
			w, hh, layers = int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:])), max(1, int(binary.LittleEndian.Uint32(blob[12:])))
			px = blob[20:]
		}
		n := w * hh
		if len(px) < n*layers*4 {
			continue
		}
		for i := 0; i < n; i++ {
			z := -1
			for l := 0; l < layers; l++ {
				for c := 0; c < 4; c++ {
					if px[(l*n+i)*4+c] >= 127 {
						z = l*4 + c
						break
					}
				}
			}
			if z < 0 {
				continue
			}
			total++
			if z < rows {
				count[z]++
			}
		}
	}
	if total == 0 {
		return nil
	}
	for z := range count {
		count[z] /= total
	}
	return count
}

// rolesOf: LUT h's zone roles (the user's, else the built-in ones, else suggested) and where they come from
func (s *Server) rolesOf(p *project.Project, v *project.Variant, h string, van *lut.Texture, mine, builtin, suggested map[string][]string) ([]string, string, []float64) {
	fit := func(r []string) []string {
		out := make([]string, van.Height)
		for z := range out {
			out[z] = "keep"
			if z < len(r) {
				out[z] = r[z]
			}
		}
		return out
	}
	if r, ok := mine[h]; ok {
		return fit(r), "mine", nil
	}
	if r, ok := builtin[h]; ok {
		return fit(r), "built-in", nil
	}
	if r, ok := suggested[h]; ok { // (decided for its item: suggestItem)
		return fit(r), "suggested", nil
	}
	cov := s.coverage(p, v, h, van.Height)
	return suggestRoles(van, cov), "suggested", cov
}

// withSet: the roles of an item's LUTs ls with its set's LUTs ctx (a helmet's armor) weighing in: a zone takes the
// role it has with the set when that is primary or secondary (the set's main colors: CE-35's orange primary on its
// helmet too), else the role it has on its own (B-01 Tactical's white helmet, a color its armor lacks, stays primary)
func withSet(ls, ctx []itemLUT) map[string][]string {
	own := suggestItem(ls)
	if len(ctx) == 0 {
		return own
	}
	set := suggestItem(append(append([]itemLUT(nil), ls...), ctx...))
	for h, r := range own {
		for z := range r {
			if z < len(set[h]) && (set[h][z] == "primary" || set[h][z] == "secondary") && (r[z] == "primary" || r[z] == "secondary" || r[z] == "trim") {
				r[z] = set[h][z]
			}
		}
	}
	return own
}

// setLUTs: when hs are a helmet's LUTs, the material LUTs of its armor set (an armor and its helmet share a name
// key) that hs lack: a helmet's colors are decided together with its armor's, so the set's primary color is primary
// on the helmet too (the armor weighs in, its roles are not reported)
func (s *Server) setLUTs(hs []string) []string {
	idx := s.index()
	if idx == nil || len(hs) == 0 {
		return nil
	}
	in := map[string]bool{}
	for _, h := range hs {
		in[h] = true
	}
	keys := map[string]bool{}
	for _, k := range idx.Kits {
		if k.Type != "Helmet" {
			continue
		}
		for _, p := range k.Pieces {
			if in[p.MaterialLUT] {
				keys[idx.Key(k)] = true
			}
		}
	}
	var out []string
	seen := map[string]bool{}
	for _, k := range idx.Kits {
		if k.Type != "Armor" || !keys[idx.Key(k)] {
			continue
		}
		for _, p := range k.Pieces {
			if h := p.MaterialLUT; h != "" && !in[h] && !seen[h] {
				seen[h] = true
				out = append(out, h)
			}
		}
	}
	return out
}

// itemLUTs: the material LUTs hs read for suggestItem (the game's values, coverage, undersuit or not)
func (s *Server) itemLUTs(p *project.Project, v *project.Variant, hs []string) []itemLUT {
	parts := map[string][]game.Part{}
	if idx := s.index(); idx != nil {
		parts = idx.Parts()
	}
	var out []itemLUT
	for _, h := range hs {
		x, err := lut.ParseHash(h)
		if err != nil {
			continue
		}
		van, err := s.game().ReadLUT(x)
		if err != nil || van.Width != lut.MaterialWidth {
			continue
		}
		hs := lut.HashString(x)
		under := len(parts[hs]) > 0
		for _, pt := range parts[hs] {
			if pt.Type != "undergarment" {
				under = false
			}
		}
		area := 0.0
		if a := s.assetsOf(); a != nil {
			if sf, ok := a.Surface(s.index(), hs); ok {
				area = sf.Area
			}
		}
		cape := false // (worn as a cape: other uses, a prop showing it, don't change what its zones are)
		for _, pt := range parts[hs] {
			if pt.Type == "cape" {
				cape = true
			}
		}
		cov := s.coverage(p, v, hs, van.Height)
		if cape { // (its ID mask, when its material has one, is not where its zones are)
			// (a cape has no ID masks: its zones come from its design. Rows 0 front, 1-3 the R / G / B panels,
			// 4 back: the front and back are most of the cloth, the panels a stripe each)
			cov = make([]float64, van.Height)
			for z, w := range []float64{0.3, 0.13, 0.13, 0.13, 0.3} {
				if z < len(cov) {
					cov[z] = w
				}
			}
		}
		out = append(out, itemLUT{hs, van, cov, under, area, cape})
	}
	return out
}

// GET /api/roles/suggest?variant=&luts=h1,h2: per LUT, the suggested roles and the zones' coverage
func (s *Server) suggestRolesAPI(w http.ResponseWriter, r *http.Request) {
	p, _ := s.project()
	var v *project.Variant
	if p != nil {
		if pv, err := p.Variant(r.URL.Query().Get("variant")); err == nil {
			v = &pv
		}
	}
	// (the LUTs asked for together are one item: what's on screen, decided as a whole; a helmet with its armor set)
	hs := strings.Split(r.URL.Query().Get("luts"), ",")
	ls := s.itemLUTs(p, v, hs)
	roles := withSet(ls, s.itemLUTs(p, v, s.setLUTs(hs)))
	out := map[string]any{}
	for _, L := range ls {
		out[L.h] = map[string]any{"roles": roles[L.h], "coverage": L.cov, "area": L.area}
	}
	writeJSON(w, out)
}

// ---- applying a theme

type themeState struct {
	Written map[string]map[string][]string `json:"written"` // variant folder -> LUT -> per zone: hash of the row the theme wrote ("" none)
}

func themePath(p *project.Project) string { return filepath.Join(p.Dir, "theme.json") }

// CopyVariant copies variant src's files into the new variant nv's folder: its LUTs and its edited textures (decal
// sheets, cape designs, masks: decals.go). Returns how many files.
func CopyVariant(p *project.Project, src, nv project.Variant) (int, error) {
	if err := os.MkdirAll(p.VariantDir(nv), 0o755); err != nil {
		return 0, err
	}
	files := project.ListFiles(p.VariantDir(src), "", ".lut.json")
	for _, td := range TextureDirs {
		more := project.ListFiles(filepath.Join(p.VariantDir(src), td.Dir), "0x", ".png")
		files = append(files, more...)
	}
	for _, f := range files {
		rel, _ := filepath.Rel(p.VariantDir(src), f)
		dst := filepath.Join(p.VariantDir(nv), rel)
		b, err := os.ReadFile(f)
		if err == nil {
			err = os.MkdirAll(filepath.Dir(dst), 0o755)
		}
		if err == nil {
			err = os.WriteFile(dst, b, 0o644)
		}
		if err != nil {
			return 0, err
		}
	}
	return len(files), nil
}

// CopyThemeRecord: a new variant copied from another starts with that variant's theme record (its LUTs are copies)
func CopyThemeRecord(p *project.Project, from, to string) {
	var st themeState
	b, err := os.ReadFile(themePath(p))
	if err != nil || json.Unmarshal(b, &st) != nil || st.Written[from] == nil {
		return
	}
	st.Written[to] = st.Written[from]
	if b, err := json.MarshalIndent(st, "", " "); err == nil {
		os.WriteFile(themePath(p), b, 0o644)
	}
}

// copyColors: a look's colors into a material row: paint, secondary, wear and heavy wear colors, and its camo when it
// has one (colors, pattern, size, where the paint shows through)
func copyColors(cur, look []float32) {
	set := func(col, ch int) {
		if i := col*4 + ch; i < len(cur) && i < len(look) && !lut.MarkChannel(lut.MaterialWidth, i) {
			cur[i] = lut.Round(look[i])
		}
	}
	for _, col := range []int{0, 2, 5, 6} {
		for ch := 0; ch < 3; ch++ {
			set(col, ch)
		}
	}
	if len(look) > 21*4+3 && look[21*4+3] != -1 {
		for col := 16; col <= 19; col++ {
			for ch := 0; ch < 3; ch++ {
				set(col, ch)
			}
		}
		for col := 17; col <= 20; col++ {
			set(col, 3)
		}
		for ch := 0; ch < 4; ch++ {
			set(21, ch)
		}
	}
}

func rowHash(px []float32) string {
	h := fnv.New64a()
	for _, v := range px {
		binary.Write(h, binary.LittleEndian, math.Float32bits(v))
	}
	return fmt.Sprintf("%016x", h.Sum64())
}

// POST /api/theme {Variant, Looks: {role: row (23 x 4 values)}, Groups: ["Armor", "Helmets", "Capes", "Backpacks", "Weapons"],
// OnlyInMod: only LUTs already in the project, Overwrite: also zones changed by hand, Items: only these items (their
// /api/kits values; Groups then unused)}: the looks on every zone of their role, on every material LUT of the items
// in Groups (added to the project, every variant, as the game has them, when not in it yet), in that variant. The
// files it writes are kept as they were before: POST /api/theme/undo puts them back.
func (s *Server) applyTheme(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Variant string
		Looks   map[string][]float32
		Groups  []string
		Items   []string
		// GroupLooks: an item group's own looks (e.g. "Capes"), for the LUTs of that group's items, over Looks
		GroupLooks map[string]map[string][]float32
		// BySize: on an item whose secondary zones cover more of it than its primary ones, the two looks swapped (the
		// theme's main look on what's biggest)
		BySize    bool
		OnlyInMod bool
		Overwrite bool
		Decals    string // "", "one", "two" (DecalModes): the items' decal sheets recolored too
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	if in.Decals != "" && !slices.Contains(DecalModes, in.Decals) {
		fail(w, 400, fmt.Errorf("unknown decal mode %q", in.Decals))
		return
	}
	all := []map[string][]float32{in.Looks}
	for _, gl := range in.GroupLooks {
		all = append(all, gl)
	}
	for _, looks := range all {
		for role, row := range looks {
			if err := checkRoles("0x0000000000000000", []string{role}); err != nil {
				fail(w, 400, err)
				return
			}
			if len(row) != lut.MaterialWidth*4 {
				fail(w, 400, fmt.Errorf("the %s look has %d values, a zone has %d", role, len(row), lut.MaterialWidth*4))
				return
			}
		}
	}
	idx := s.index()
	p, err := s.project()
	if err != nil || idx == nil {
		fail(w, 409, fmt.Errorf("no project or no game"))
		return
	}
	v, err := p.Variant(in.Variant)
	if err != nil {
		fail(w, 400, err)
		return
	}
	// the LUTs: of every item in the groups (or those already in the project)
	want := map[string]bool{}
	for _, g := range in.Groups {
		want[g] = true
	}
	// the items themed: those named (Items), else every item of the groups
	wantItem := func(it roleItem) bool {
		if len(in.Items) > 0 {
			return slices.Contains(in.Items, it.Value)
		}
		return want[it.Group]
	}
	wantKit := func(k game.Kit) bool {
		if len(in.Items) > 0 {
			return slices.Contains(in.Items, itemValue(idx, k))
		}
		return want[ThemeGroupOf(k)]
	}
	var luts []string
	seen := map[string]bool{}
	lutGroup := map[string]string{} // (a LUT's group: its first item's)
	items := 0
	for _, it := range s.roleItems(idx) {
		if !wantItem(it) {
			continue
		}
		for _, l := range it.LUTs {
			if _, ok := lutGroup[l.LUT]; !ok {
				lutGroup[l.LUT] = it.Group
			}
		}
		n := 0
		for _, l := range it.LUTs {
			if seen[l.LUT] {
				continue
			}
			if in.OnlyInMod {
				if _, err := os.Stat(p.DocPath(v, l.LUT)); err != nil {
					continue
				}
			}
			seen[l.LUT] = true
			luts = append(luts, l.LUT)
			n++
		}
		if n > 0 {
			items++
		}
	}
	mine, builtin, users := myRoles(), BuiltinRoles(), idx.Users()
	// suggestions decided per item (a LUT several items share: its first item's)
	suggested := map[string][]string{}
	for _, it := range s.roleItems(idx) {
		if !wantItem(it) {
			continue
		}
		var hs []string
		for _, l := range it.LUTs {
			if seen[l.LUT] && suggested[l.LUT] == nil && mine[l.LUT] == nil && builtin[l.LUT] == nil {
				hs = append(hs, l.LUT)
			}
		}
		if len(hs) == 0 {
			continue
		}
		for h, r := range withSet(s.itemLUTs(p, &v, hs), s.itemLUTs(p, &v, s.setLUTs(hs))) {
			if suggested[h] == nil && slices.Contains(hs, h) { // (the set's armor only weighs in)
				suggested[h] = r
			}
		}
	}
	swapped := map[string]bool{}
	if in.BySize {
		swapped = s.sizeSwaps(p, &v, func(it roleItem) bool { return wantItem(it) }, func(h string) bool { return seen[h] }, mine, builtin, suggested)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if q, err := s.project(); err == nil { // (read again under the lock: a variant added meanwhile gets the LUTs added)
		p = q
	}
	var st themeState
	if b, err := os.ReadFile(themePath(p)); err == nil {
		json.Unmarshal(b, &st)
	}
	if st.Written == nil {
		st.Written = map[string]map[string][]string{}
	}
	if st.Written[v.Folder] == nil {
		st.Written[v.Folder] = map[string][]string{}
	}
	written := st.Written[v.Folder]
	// the files as they were, for an undo (a theme that fails partway: what it wrote can be undone too)
	jr := &fileJournal{}
	s.themeID++
	id := s.themeID
	s.themes = append(s.themes, themeUndo{id, jr})
	if len(s.themes) > maxThemeUndo {
		s.themes = s.themes[len(s.themes)-maxThemeUndo:]
	}
	jr.keep(themePath(p))
	// (what was written is recorded however this ends: a failure partway leaves its writes known as the theme's, not
	// taken for hand edits by the next apply)
	recorded := false
	defer func() {
		if !recorded {
			b, _ := json.MarshalIndent(st, "", " ")
			atomicfile.WriteFile(themePath(p), b, 0o644)
		}
	}()
	added, zones, kept, changedLUTs := 0, 0, 0, 0
	patternOutside := 0
	byRole := map[string]int{}
	for _, hs := range luts {
		h, _ := lut.ParseHash(hs)
		van, err := s.game().ReadLUT(h)
		if err != nil || van.Width != lut.MaterialWidth {
			continue
		}
		roles, _, _ := s.rolesOf(p, &v, hs, van, mine, builtin, suggested)
		// not in the project yet: added to every variant with the game's values (as + Item does)
		n, err := s.addLUT(p, h, van, users, jr)
		if err != nil {
			fail(w, 500, err)
			return
		}
		added += min(n, 1)
		d, err := readDoc(p.DocPath(v, hs))
		if err != nil {
			continue
		}
		wr := slices.Clone(written[hs]) // (a copy: recorded only once the doc is written)
		for len(wr) < d.Tex.Height {
			wr = append(wr, "")
		}
		row := func(t *lut.Texture, z int) []float32 { return t.Px[z*t.Width*4 : (z+1)*t.Width*4] }
		changed := false
		looks := in.Looks
		if gl, ok := in.GroupLooks[lutGroup[hs]]; ok {
			looks = gl
		}
		if swapped[hs] {
			sw := maps.Clone(looks)
			sw["primary"], sw["secondary"] = looks["secondary"], looks["primary"]
			for _, r := range []string{"primary", "secondary"} {
				if sw[r] == nil {
					delete(sw, r)
				}
			}
			looks = sw
		}
		for z := 0; z < d.Tex.Height && z < len(roles); z++ {
			look, ok := looks[roles[z]]
			if !ok || roles[z] == "keep" || roles[z] == "unused" {
				continue
			}
			cur := row(d.Tex, z)
			game := z < van.Height && rowHash(cur) == rowHash(row(van, z))
			if !in.Overwrite && !game && rowHash(cur) != wr[z] {
				kept++ // changed by hand since
				continue
			}
			if z < van.Height && math.Round(float64(van.At(0, z, 3))) == 1 && roles[z] != "cloth" {
				// cloth in the game with a paint role (a cape's panels, padded armor): the look's colors only, the
				// zone keeps its cloth finish
				copyColors(cur, look)
			} else {
				for i, x := range look {
					if !lut.MarkChannel(lut.MaterialWidth, i) {
						cur[i] = lut.Round(x)
					}
				}
			}
			wr[z] = rowHash(cur)
			zones++
			byRole[roles[z]]++
			changed = true
		}
		if changed {
			jr.keep(p.DocPath(v, hs))
			if err := project.WriteDoc(p.DocPath(v, hs), d); err != nil {
				fail(w, 500, err)
				return
			}
		}
		written[hs] = wr
		if changed {
			changedLUTs++
		}
	}
	// the trim look's color (column 0's RGB in every LUT kind, as the material's paint.color) also goes to:
	//   - capes: their design LUT's trim lines (gradients and emblems stay as the game made them);
	//   - patterns: every patterned row of the items' pattern LUTs (FS-23 Battle Master's yellow stripes, camo:
	//     one color per zone over its paint; a row with mask layer -1 has no pattern and is left alone)
	trimRows := func(hashes map[string]bool, width int, patterned func(t *lut.Texture, z int) bool, group string) bool {
		trim := in.Looks["trim"]
		if gl, ok := in.GroupLooks[group]; ok && len(gl["trim"]) >= 3 {
			trim = gl["trim"]
		}
		var order []string
		for hs := range hashes {
			order = append(order, hs)
		}
		sort.Strings(order)
		for _, hs := range order {
			h, err := lut.ParseHash(hs)
			if err != nil {
				continue
			}
			if in.OnlyInMod {
				if _, err := os.Stat(p.DocPath(v, hs)); err != nil {
					continue
				}
			}
			van, err := s.game().ReadLUT(h)
			if err != nil || van.Width != width {
				continue
			}
			n, err := s.addLUT(p, h, van, users, jr)
			if err != nil {
				fail(w, 500, err)
				return false
			}
			added += min(n, 1)
			d, err := readDoc(p.DocPath(v, hs))
			if err != nil {
				continue
			}
			wr := slices.Clone(written[hs]) // (a copy: recorded only once the doc is written)
			for len(wr) < d.Tex.Height {
				wr = append(wr, "")
			}
			changed := false
			for z := 0; z < d.Tex.Height; z++ {
				if patterned != nil && (z >= van.Height || !patterned(van, z)) {
					continue
				}
				cur := d.Tex.Px[z*d.Tex.Width*4 : (z+1)*d.Tex.Width*4]
				game := z < van.Height && rowHash(cur) == rowHash(van.Px[z*van.Width*4:(z+1)*van.Width*4])
				if !in.Overwrite && !game && rowHash(cur) != wr[z] {
					kept++
					continue
				}
				for ch := 0; ch < 3; ch++ {
					cur[ch] = lut.Round(trim[ch])
				}
				wr[z] = rowHash(cur)
				zones++
				byRole["trim"]++
				changed = true
			}
			if changed {
				jr.keep(p.DocPath(v, hs))
				if err := project.WriteDoc(p.DocPath(v, hs), d); err != nil {
					fail(w, 500, err)
					return false
				}
			}
			written[hs] = wr
			if changed {
				changedLUTs++
			}
		}
		return true
	}
	if trim, ok := in.Looks["trim"]; ok && len(trim) >= 3 {
		capeLUTs, patterns := map[string]bool{}, map[string]bool{}
		for _, k := range idx.Kits {
			if !wantKit(k) {
				continue
			}
			for _, pc := range k.Pieces {
				if pc.CapeLUT != "" && k.Type == "Cape" {
					capeLUTs[pc.CapeLUT] = true
				}
				if pc.PatternLUT != "" && seen[pc.MaterialLUT] {
					patterns[pc.PatternLUT] = true
				}
			}
		}
		// (a pattern LUT is shared: the items outside the groups themed that wear one of these, counted for the message)
		for _, k := range idx.Kits {
			if wantKit(k) {
				continue
			}
			for _, pc := range k.Pieces {
				if patterns[pc.PatternLUT] {
					patternOutside++
					break
				}
			}
		}
		if !trimRows(capeLUTs, lut.CapeWidth, nil, "Capes") {
			return
		}
		if !trimRows(patterns, lut.PatternWidth, func(t *lut.Texture, z int) bool { return t.At(0, z, 3) != -1 }, "") {
			return
		}
	}
	// decals: every decal sheet drawn with the themed LUTs, recolored from the game's artwork in the trim look's color
	// (light parts) and the secondary's (dark parts); a sheet edited by hand since is kept (unless Overwrite)
	decalSheets, outside := 0, 0
	if in.Decals != "" {
		color := func(roles ...string) ([3]float32, bool) {
			for _, r := range roles {
				if l := in.Looks[r]; len(l) >= 3 {
					return [3]float32{l[0], l[1], l[2]}, true
				}
			}
			return [3]float32{}, false
		}
		light, ok := color("trim", "primary", "secondary")
		dark, okd := color("secondary", "primary")
		if !okd {
			dark = [3]float32{light[0] * 0.35, light[1] * 0.35, light[2] * 0.35}
		}
		byLUT := s.game().DecalSheetsByLUT(idx)
		set := map[uint64]bool{}
		for hs := range seen {
			if h, err := lut.ParseHash(hs); err == nil {
				for _, sh := range byLUT[h] {
					set[sh] = true
				}
			}
		}
		var order []uint64
		for sh := range set {
			order = append(order, sh)
		}
		slices.Sort(order)
		for _, sh := range order {
			if !ok {
				break
			}
			blob, err := s.assetsOf().TextureBlob(sh)
			if err != nil || len(blob) < 20 || binary.LittleEndian.Uint32(blob[16:]) != 0 {
				continue // (not an RGBA image)
			}
			tw, th := int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:]))
			if tw*th <= 16*16 || len(blob) < 20+tw*th*4 {
				delete(set, sh) // a dummy (the 1 x 1 "no decal" sheet): nothing to recolor
				continue
			}
			file, key := SheetPath(p, v, sh, "sheet"), "sheet:"+lut.HashString(sh)
			if cur, err := os.ReadFile(file); err == nil && !in.Overwrite && (len(written[key]) == 0 || fmt.Sprintf("%x", sha1.Sum(cur)) != written[key][0]) {
				kept++ // edited by hand (the Decals editor) since
				continue
			}
			img := image.NewNRGBA(image.Rect(0, 0, tw, th))
			copy(img.Pix, blob[20:20+tw*th*4])
			recolorDecals(img.Pix, in.Decals, light, dark)
			var buf bytes.Buffer
			if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, img); err != nil {
				fail(w, 500, err)
				return
			}
			os.MkdirAll(filepath.Dir(file), 0o755)
			jr.keep(file)
			if err := os.WriteFile(file, buf.Bytes(), 0o644); err != nil {
				fail(w, 500, err)
				return
			}
			written[key] = []string{fmt.Sprintf("%x", sha1.Sum(buf.Bytes()))}
			decalSheets++
		}
		// the items outside the themed groups whose decals come from a recolored sheet (they show the theme's too)
		for _, k := range idx.Kits {
			if wantKit(k) {
				continue
			}
			hit := false
			for _, pc := range k.Pieces {
				if h, err := lut.ParseHash(pc.DecalSheet); err == nil && set[h] {
					hit = true
				}
				if l, err := lut.ParseHash(pc.MaterialLUT); err == nil {
					for _, sh := range byLUT[l] {
						hit = hit || set[sh]
					}
				}
			}
			if hit {
				outside++
			}
		}
	}
	b, _ := json.MarshalIndent(st, "", " ")
	recorded = true
	if err := atomicfile.WriteFile(themePath(p), b, 0o644); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]any{"undo": id, "items": items, "luts": len(luts), "changed": changedLUTs, "added": added, "zones": zones, "kept": kept, "roles": byRole,
		"decal_sheets": decalSheets, "decal_outside": outside, "pattern_outside": patternOutside})
}

// addLUT: LUT h (the game's values: van) in every variant of p that doesn't have it yet; how many variants got it.
// users: the index's Users (for the note); jr: the files written are kept in it (nil: not kept)
func (s *Server) addLUT(p *project.Project, h uint64, van *lut.Texture, users map[string][]string, jr *fileJournal) (int, error) {
	kind, err := lut.KindOf(van)
	if err != nil {
		return 0, err
	}
	hs := lut.HashString(h)
	note := ""
	if u := users[hs]; len(u) > 0 {
		note = "Used by " + strings.Join(u, ", ")
		if len(u) > 6 {
			note = fmt.Sprintf("Used by %s and %d more", strings.Join(u[:6], ", "), len(u)-6)
		}
	}
	added := 0
	for _, v := range p.Variants {
		path := p.DocPath(v, hs)
		if _, err := os.Stat(path); err == nil {
			continue
		}
		t := &lut.Texture{Width: van.Width, Height: van.Height, Px: append([]float32(nil), van.Px...)}
		jr.keep(path)
		if err := project.WriteDoc(path, &lut.Document{LUT: hs, Kind: kind, Note: note, Tex: t}); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// sizeSwaps: per item (wanted), whether its secondary zones cover more of it than its primary ones (each LUT's zone
// shares by its surface area, over the item's LUTs that count); for its LUTs (a LUT several items share: its first
// item's): a bySize theme swaps the two looks there
func (s *Server) sizeSwaps(p *project.Project, v *project.Variant, want func(roleItem) bool, counts func(string) bool, mine, builtin, suggested map[string][]string) map[string]bool {
	out := map[string]bool{}
	idx := s.index()
	if idx == nil {
		return out
	}
	for _, it := range s.roleItems(idx) {
		if !want(it) {
			continue
		}
		var hs []string
		for _, l := range it.LUTs {
			if _, done := out[l.LUT]; counts(l.LUT) && !done && !slices.Contains(hs, l.LUT) {
				hs = append(hs, l.LUT)
			}
		}
		if len(hs) == 0 {
			continue
		}
		prim, sec := 0.0, 0.0
		for _, L := range s.itemLUTs(p, v, hs) {
			roles, _, _ := s.rolesOf(p, v, L.h, L.van, mine, builtin, suggested)
			w := L.area
			if w <= 0 {
				w = 1
			}
			for z, c := range L.cov {
				if z < len(roles) && roles[z] == "primary" {
					prim += c * w
				} else if z < len(roles) && roles[z] == "secondary" {
					sec += c * w
				}
			}
		}
		for _, h := range hs {
			out[h] = sec > prim
		}
	}
	return out
}

// GET /api/theme/sizes?variant=&luts=h1,h2: for each of these LUTs, whether a bySize theme swaps its primary and
// secondary looks (sizeSwaps: as Apply decides it, by the item the LUT is of)
func (s *Server) themeSizes(w http.ResponseWriter, r *http.Request) {
	p, _ := s.project()
	var v *project.Variant
	if p != nil {
		if pv, err := p.Variant(r.URL.Query().Get("variant")); err == nil {
			v = &pv
		}
	}
	hs := strings.Split(r.URL.Query().Get("luts"), ",")
	idx := s.index()
	items := map[string]bool{} // (the items these LUTs are of: their first)
	if idx != nil {
		seen := map[string]bool{}
		for _, it := range s.roleItems(idx) {
			for _, l := range it.LUTs {
				if slices.Contains(hs, l.LUT) && !seen[l.LUT] {
					seen[l.LUT] = true
					items[it.Value] = true
				}
			}
		}
	}
	sw := s.sizeSwaps(p, v, func(it roleItem) bool { return items[it.Value] }, func(string) bool { return true }, myRoles(), BuiltinRoles(), map[string][]string{})
	out := map[string]bool{}
	for _, h := range hs {
		out[h] = sw[h]
	}
	writeJSON(w, out)
}

// fileJournal: files as they were before a change (nil: it didn't exist), each kept the first time it's written
type fileJournal struct {
	order []string
	was   map[string][]byte
}

func (j *fileJournal) keep(path string) {
	if j == nil {
		return
	}
	if j.was == nil {
		j.was = map[string][]byte{}
	}
	if _, ok := j.was[path]; ok {
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		b = nil
	}
	j.was[path] = b
	j.order = append(j.order, path)
}

// restore puts every file back as it was (one that didn't exist: removed); the first error, after trying them all
func (j *fileJournal) restore() error {
	var first error
	for i := len(j.order) - 1; i >= 0; i-- {
		path := j.order[i]
		var err error
		if b := j.was[path]; b == nil {
			if err = os.Remove(path); errors.Is(err, os.ErrNotExist) {
				err = nil
			}
		} else {
			err = atomicfile.WriteFile(path, b, 0o644)
		}
		if err != nil && first == nil {
			first = err
		}
	}
	return first
}

// themeUndo: a theme applied (its id, as /api/theme answered) and its files as they were before it
type themeUndo struct {
	id int
	jr *fileJournal
}

// maxThemeUndo: how many themes back can be undone
const maxThemeUndo = 8

// POST /api/theme/undo {ID (0: the last one)}: the last theme applied (since the program started) undone: its files
// back as they were before it. Only the last one can be: an earlier one (409) once the later ones are undone; 409
// too when there's none (or it's too far back)
func (s *Server) undoTheme(w http.ResponseWriter, r *http.Request) {
	var in struct{ ID int }
	decode(r, &in) // (no body: the last one)
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.themes) == 0 || (in.ID != 0 && !slices.ContainsFunc(s.themes, func(t themeUndo) bool { return t.id == in.ID })) {
		fail(w, 409, fmt.Errorf("that theme can't be undone any more (only the last %d applied since LUT Studio started can)", maxThemeUndo))
		return
	}
	last := s.themes[len(s.themes)-1]
	if in.ID != 0 && in.ID != last.id {
		fail(w, 409, fmt.Errorf("a theme applied after it (maybe in another variant) has to be undone first"))
		return
	}
	s.themes = s.themes[:len(s.themes)-1]
	jr := last.jr
	if err := jr.restore(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]any{"files": len(jr.order)})
}
