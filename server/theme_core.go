package server

// The theme's core, shared by POST /api/theme (theme.go: applyTheme, with the project's files, the undo journal and
// theme.json) and ThemePlan (in memory, for batches: many themes over the same items without a project): which LUTs a
// theme reaches and each zone's role (themeTargets), and the edit of one LUT (themeZones, trimZones). Both paths run
// the same code, so a theme made in memory is the one Apply makes.

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"os"
	"slices"
	"sort"
	"strings"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/project"
)

// themeTargetSet: what a theme over groups (or named items) reaches
type themeTargetSet struct {
	luts      []string          // the material LUTs, in the order Apply themes them
	seen      map[string]bool   // (the same, as a set)
	lutGroup  map[string]string // a LUT's group: its first item's
	items     int               // items with at least one LUT themed
	wantKit   func(game.Kit) bool
	mine      map[string][]string
	builtin   map[string][]string
	users     map[string][]string
	suggested map[string][]string // roles decided per item (a LUT several items share: its first item's)
	swapped   map[string]bool     // bySize: the LUTs whose primary and secondary looks swap
}

// themeTargets: the LUTs of every item in the groups (or the items named), their roles' sources, and (bySize) the
// swaps. p, v: the project and variant (onlyInMod: only LUTs already in it; edited masks count in the coverage); nil
// for a theme in memory.
// focus (nil: every LUT): only these LUTs' roles and swaps are needed (the preview's, on screen): the suggestions and
// size swaps are decided only for the items that bear on them, with the same results (focusItems).
func (s *Server) themeTargets(idx *game.Index, p *project.Project, v *project.Variant, groups, items []string, onlyInMod, bySize bool, focus map[string]bool) *themeTargetSet {
	want := map[string]bool{}
	for _, g := range groups {
		want[g] = true
	}
	// the items themed: those named (Items), else every item of the groups
	wantItem := func(it roleItem) bool {
		if len(items) > 0 {
			return slices.Contains(items, it.Value)
		}
		return want[it.Group]
	}
	wantKit := func(k game.Kit) bool {
		if len(items) > 0 {
			return slices.Contains(items, itemValue(idx, k))
		}
		return want[ThemeGroupOf(k)]
	}
	tg := &themeTargetSet{seen: map[string]bool{}, lutGroup: map[string]string{}, wantKit: wantKit}
	for _, it := range s.roleItems(idx) {
		if !wantItem(it) {
			continue
		}
		for _, l := range it.LUTs {
			if _, ok := tg.lutGroup[l.LUT]; !ok {
				tg.lutGroup[l.LUT] = it.Group
			}
		}
		n := 0
		for _, l := range it.LUTs {
			if tg.seen[l.LUT] {
				continue
			}
			if onlyInMod && p != nil && v != nil {
				if _, err := os.Stat(p.DocPath(*v, l.LUT)); err != nil {
					continue
				}
			}
			tg.seen[l.LUT] = true
			tg.luts = append(tg.luts, l.LUT)
			n++
		}
		if n > 0 {
			tg.items++
		}
	}
	tg.mine, tg.builtin, tg.users = myRoles(), BuiltinRoles(), idx.Users()
	needed := focusItems(s.roleItems(idx), wantItem, focus)
	tg.suggested = map[string][]string{}
	for i, it := range s.roleItems(idx) {
		if !wantItem(it) || !needed(i) {
			continue
		}
		var hs []string
		for _, l := range it.LUTs {
			if tg.seen[l.LUT] && tg.suggested[l.LUT] == nil && tg.mine[l.LUT] == nil && tg.builtin[l.LUT] == nil {
				hs = append(hs, l.LUT)
			}
		}
		if len(hs) == 0 {
			continue
		}
		for h, r := range withSet(s.itemLUTs(p, v, hs), s.itemLUTs(p, v, s.setLUTs(hs))) {
			if tg.suggested[h] == nil && slices.Contains(hs, h) { // (the set's armor only weighs in)
				tg.suggested[h] = r
			}
		}
	}
	tg.swapped = map[string]bool{}
	if bySize {
		tg.swapped = s.sizeSwaps(p, v, func(i int, it roleItem) bool { return wantItem(it) && needed(i) }, func(h string) bool { return tg.seen[h] }, tg.mine, tg.builtin, tg.suggested)
	}
	return tg
}

// focusItems: which of the items (by index; want: those themed) bear on the roles and size swaps of the LUTs in focus
// (nil: all). An item's suggestions and swap are decided over its LUTs less those an earlier item already decided, so
// they depend on the earlier items it shares a LUT with, and on theirs in turn: the items with a LUT in focus and,
// repeatedly, every earlier item sharing a LUT with one taken. Deciding only those gives the focus LUTs the results
// deciding them all gives.
func focusItems(all []roleItem, want func(roleItem) bool, focus map[string]bool) func(int) bool {
	if focus == nil {
		return func(int) bool { return true }
	}
	in := make([]bool, len(all))
	shares := func(a, b roleItem) bool {
		for _, x := range a.LUTs {
			for _, y := range b.LUTs {
				if x.LUT == y.LUT {
					return true
				}
			}
		}
		return false
	}
	for i, it := range all {
		for _, l := range it.LUTs {
			if want(it) && focus[l.LUT] {
				in[i] = true
			}
		}
	}
	for grew := true; grew; {
		grew = false
		for i := range all {
			if in[i] || !want(all[i]) {
				continue
			}
			for j := i + 1; j < len(all); j++ {
				if in[j] && shares(all[i], all[j]) {
					in[i], grew = true, true
					break
				}
			}
		}
	}
	return func(i int) bool { return in[i] }
}

// trimTargets: the cape design LUTs of the capes themed and the pattern LUTs of the items themed (the trim look's
// color goes to their trim rows), and how many items outside the theme share one of those pattern LUTs
func (tg *themeTargetSet) trimTargets(idx *game.Index) (capeLUTs, patterns map[string]bool, outside int) {
	capeLUTs, patterns = map[string]bool{}, map[string]bool{}
	for _, k := range idx.Kits {
		if !tg.wantKit(k) {
			continue
		}
		for _, pc := range k.Pieces {
			if pc.CapeLUT != "" && k.Type == "Cape" {
				capeLUTs[pc.CapeLUT] = true
			}
			if pc.PatternLUT != "" && tg.seen[pc.MaterialLUT] {
				patterns[pc.PatternLUT] = true
			}
		}
	}
	// (a pattern LUT is shared: the items outside the groups themed that wear one of these, counted for the message)
	for _, k := range idx.Kits {
		if tg.wantKit(k) {
			continue
		}
		for _, pc := range k.Pieces {
			if patterns[pc.PatternLUT] {
				outside++
				break
			}
		}
	}
	return capeLUTs, patterns, outside
}

// lookFor: the looks a LUT gets: its group's own when the theme has them, primary and secondary swapped for a bySize
// swap; a cape's glow panels the trim
func lookFor(looks map[string][]float32, groupLooks map[string]map[string][]float32, group string, swap bool) map[string][]float32 {
	trim := looks["trim"]
	if gl, ok := groupLooks[group]; ok {
		looks = gl
		if gl["trim"] != nil {
			trim = gl["trim"]
		}
	}
	// a cape's glow zones are cloth panels with a faint glow (Rightful Occupier's, Tyranny's Bane's cyan), not lights:
	// they take the trim's colors, whatever glow the theme has (a cloth zone keeps its finish and glow: copyColors)
	if group == "Capes" && trim != nil {
		looks = maps.Clone(looks)
		looks["glow"] = trim
	}
	if swap {
		sw := maps.Clone(looks)
		sw["primary"], sw["secondary"] = looks["secondary"], looks["primary"]
		for _, r := range []string{"primary", "secondary"} {
			if sw[r] == nil {
				delete(sw, r)
			}
		}
		looks = sw
	}
	return looks
}

// lutLookFor: lookFor with LUT hs's own looks (lutLooks[hs]: as they go on it, its item's, each role's look over that
// item's own zones and swapped as its item decides, as the showcase scene draws it) in place of the theme's, when it
// has them (only a cape's glow added: not swapped again)
func lutLookFor(looks map[string][]float32, groupLooks map[string]map[string][]float32, lutLooks map[string]map[string][]float32, hs, group string, swap bool) map[string][]float32 {
	if ll, ok := lutLooks[hs]; ok {
		return lookFor(ll, nil, group, false)
	}
	return lookFor(looks, groupLooks, group, swap)
}

// themeZones: the looks over every zone of d with a role that has one (van: the game's LUT; wr: per zone the hash of
// the row the theme last wrote, "" none; a zone changed by hand since is kept unless overwrite). Returns wr (grown to
// d's height), whether d changed, zones themed, zones kept. byRole (nil: not counted): zones themed per role.
func themeZones(d *lut.Document, van *lut.Texture, roles []string, looks map[string][]float32, wr []string, overwrite bool, byRole map[string]int) ([]string, bool, int, int) {
	for len(wr) < d.Tex.Height {
		wr = append(wr, "")
	}
	row := func(t *lut.Texture, z int) []float32 { return t.Px[z*t.Width*4 : (z+1)*t.Width*4] }
	changed, zones, kept := false, 0, 0
	glass, hasGlass := glassLook(looks)
	for z := 0; z < d.Tex.Height && z < len(roles); z++ {
		look, ok := looks[roles[z]]
		// glass the roles keep (a visor, a lens): tinted in the theme's most colorful hue, as dark as the game's
		tint := roles[z] == "keep" && hasGlass && z < van.Height && isGlass(row(van, z))
		if !tint && (!ok || roles[z] == "keep" || roles[z] == "unused") {
			continue
		}
		cur := row(d.Tex, z)
		game := z < van.Height && rowHash(cur) == rowHash(row(van, z))
		if !overwrite && !game && rowHash(cur) != wr[z] {
			kept++ // changed by hand since
			continue
		}
		if tint {
			g := row(van, z)
			c := glassTint(glass, [3]float32{g[0], g[1], g[2]})
			for ch := 0; ch < 3; ch++ {
				cur[ch] = lut.Round(c[ch])
			}
			wr[z] = rowHash(cur)
			zones++
			if byRole != nil {
				byRole["glass"]++
			}
			changed = true
			continue
		}
		if z < van.Height && math.Round(float64(van.At(0, z, 3))) == 1 && roles[z] != "cloth" {
			// cloth in the game with a paint role (a cape's panels, padded armor): the look's colors only, the
			// zone keeps its cloth finish
			copyColors(cur, look, row(van, z))
		} else {
			for i, x := range look {
				if !lut.MarkChannel(lut.MaterialWidth, i) {
					cur[i] = lut.Round(x)
				}
			}
		}
		wr[z] = rowHash(cur)
		zones++
		if byRole != nil {
			byRole[roles[z]]++
		}
		changed = true
	}
	return wr, changed, zones, kept
}

// patternedRow: a pattern LUT's row that draws a pattern (mask layer -1: none)
func patternedRow(t *lut.Texture, z int) bool { return t.At(0, z, 3) != -1 }

// trimZones: the trim color in the rows of d (patterned: only the rows it accepts on van, the game's LUT; nil: every
// row); fade (a cape design's): its gradient color in fade's hue at the game's lightness (fadeColor: a dark fade
// stays dark), its strength and reach kept. wr and overwrite as themeZones. Returns wr, whether d changed, rows
// themed, rows kept.
func trimZones(d *lut.Document, van *lut.Texture, patterned func(*lut.Texture, int) bool, trim, fade []float32, wr []string, overwrite bool) ([]string, bool, int, int) {
	for len(wr) < d.Tex.Height {
		wr = append(wr, "")
	}
	changed, zones, kept := false, 0, 0
	for z := 0; z < d.Tex.Height; z++ {
		if patterned != nil && (z >= van.Height || !patterned(van, z)) {
			continue
		}
		cur := d.Tex.Px[z*d.Tex.Width*4 : (z+1)*d.Tex.Width*4]
		game := z < van.Height && rowHash(cur) == rowHash(van.Px[z*van.Width*4:(z+1)*van.Width*4])
		if !overwrite && !game && rowHash(cur) != wr[z] {
			kept++
			continue
		}
		for ch := 0; ch < 3; ch++ {
			cur[ch] = lut.Round(trim[ch])
		}
		if len(fade) >= 3 && z < van.Height && van.Width > 3 {
			g := van.Px[z*van.Width*4+3*4:]
			c := fadeColor([3]float32{fade[0], fade[1], fade[2]}, [3]float32{g[0], g[1], g[2]})
			for ch := 0; ch < 3; ch++ {
				cur[3*4+ch] = lut.Round(c[ch])
			}
		}
		wr[z] = rowHash(cur)
		zones++
		changed = true
	}
	return wr, changed, zones, kept
}

// gameDoc: LUT h with the game's values (van), as Apply adds it to a project (addLUT)
func gameDoc(h uint64, van *lut.Texture, users map[string][]string) (*lut.Document, error) {
	kind, err := lut.KindOf(van)
	if err != nil {
		return nil, err
	}
	hs := lut.HashString(h)
	note := ""
	if u := users[hs]; len(u) > 0 {
		note = "Used by " + strings.Join(u, ", ")
		if len(u) > 6 {
			note = fmt.Sprintf("Used by %s and %d more", strings.Join(u[:6], ", "), len(u)-6)
		}
	}
	t := &lut.Texture{Width: van.Width, Height: van.Height, Px: append([]float32(nil), van.Px...)}
	return &lut.Document{LUT: hs, Kind: kind, Note: note, Tex: t}, nil
}

// roundTrip: d as a project file holds it (written and read back: what a build reads), in memory
func roundTrip(d *lut.Document) (*lut.Document, error) {
	b, err := d.MarshalJSON()
	if err != nil {
		return nil, err
	}
	out := &lut.Document{}
	if err := json.Unmarshal(b, out); err != nil {
		return nil, err
	}
	return out, nil
}

func cloneDoc(d *lut.Document) *lut.Document {
	c := *d
	c.Tex = &lut.Texture{Width: d.Tex.Width, Height: d.Tex.Height, Px: append([]float32(nil), d.Tex.Px...)}
	c.Labels = slices.Clone(d.Labels)
	return &c
}

// ---- themes in memory

// ThemePlan: a theme's targets over item groups, worked out once (LUTs, zone roles, bySize swaps, trim rows), for
// themes in memory: many themes over the same items as Apply would make them in a new project's variant, without a
// project (lsbatch: LUT Studio's Destiny 2 shaders, 693 themes). Decal sheets are not part of it.
type ThemePlan struct {
	mats, capes, patterns []planLUT
	swapped               map[string]bool
}

type planLUT struct {
	hash  string
	van   *lut.Texture
	base  *lut.Document // the game's values as a new project's file holds them
	roles []string
	group string
}

// ThemeLooks: one theme's looks, as POST /api/theme takes them
type ThemeLooks struct {
	Looks      map[string][]float32
	GroupLooks map[string]map[string][]float32
	LUTLooks   map[string]map[string][]float32
	BySize     bool
}

// PlanTheme: the plan of a theme over the item groups (as Apply with Groups, no Items, every LUT, Overwrite).
func (s *Server) PlanTheme(groups []string) (*ThemePlan, error) {
	idx, g := s.index(), s.game()
	if idx == nil || g == nil {
		return nil, fmt.Errorf("no game")
	}
	tg := s.themeTargets(idx, nil, nil, groups, nil, false, true, nil)
	pl := &ThemePlan{swapped: tg.swapped}
	add := func(list *[]planLUT, hs string, width int, roles bool) error {
		h, err := lut.ParseHash(hs)
		if err != nil {
			return nil
		}
		van, err := g.ReadLUT(h)
		if err != nil || van.Width != width {
			return nil
		}
		d, err := gameDoc(h, van, tg.users)
		if err != nil {
			return err
		}
		if d, err = roundTrip(d); err != nil {
			return err
		}
		L := planLUT{hash: hs, van: van, base: d, group: tg.lutGroup[hs]}
		if roles {
			L.roles, _, _ = s.rolesOf(nil, nil, hs, van, tg.mine, tg.builtin, tg.suggested)
		}
		*list = append(*list, L)
		return nil
	}
	for _, hs := range tg.luts {
		if err := add(&pl.mats, hs, lut.MaterialWidth, true); err != nil {
			return nil, err
		}
	}
	capeLUTs, patterns, _ := tg.trimTargets(idx)
	for _, set := range []struct {
		hashes map[string]bool
		list   *[]planLUT
		width  int
	}{{capeLUTs, &pl.capes, lut.CapeWidth}, {patterns, &pl.patterns, lut.PatternWidth}} {
		order := make([]string, 0, len(set.hashes))
		for hs := range set.hashes {
			order = append(order, hs)
		}
		sort.Strings(order)
		for _, hs := range order {
			if err := add(set.list, hs, set.width, false); err != nil {
				return nil, err
			}
		}
	}
	return pl, nil
}

// Size: how many material, cape and pattern LUTs the plan reaches
func (pl *ThemePlan) Size() (mats, capes, patterns int) {
	return len(pl.mats), len(pl.capes), len(pl.patterns)
}

// Vanilla: the game's LUT of hash hs in the plan (nil: not in it)
func (pl *ThemePlan) Vanilla(hs string) *lut.Texture {
	for _, list := range [][]planLUT{pl.mats, pl.capes, pl.patterns} {
		for _, L := range list {
			if L.hash == hs {
				return L.van
			}
		}
	}
	return nil
}

// PlanLUT: one LUT of a plan, exported (for themes made outside LUT Studio from the same plan: Destiny Shaders' in-game
// generator): Base is the LUT as a new project's file holds it (the game's values, round-tripped), Van the game's
// LUT, Roles its zones' roles (material LUTs), Group the item group it is themed with, Swap whether a bySize theme
// swaps its primary and secondary looks.
type PlanLUT struct {
	Hash, Kind, Group string
	Width, Height     int
	Base, Van         []float32
	Roles             []string `json:",omitempty"`
	Swap              bool     `json:",omitempty"`
}

// PlanExport: a plan's LUTs in the order Apply themes them (materials, then cape designs, then pattern LUTs; trim rows
// only when the theme has a trim look)
type PlanExport struct {
	Materials, Capes, Patterns []PlanLUT
}

// Export: the plan as data
func (pl *ThemePlan) Export() PlanExport {
	conv := func(list []planLUT) []PlanLUT {
		out := make([]PlanLUT, 0, len(list))
		for _, L := range list {
			out = append(out, PlanLUT{Hash: L.hash, Kind: L.base.Kind, Group: L.group, Width: L.base.Tex.Width,
				Height: L.base.Tex.Height, Base: slices.Clone(L.base.Tex.Px), Van: slices.Clone(L.van.Px),
				Roles: slices.Clone(L.roles), Swap: pl.swapped[L.hash]})
		}
		return out
	}
	return PlanExport{Materials: conv(pl.mats), Capes: conv(pl.capes), Patterns: conv(pl.patterns)}
}

// Apply: the theme's LUT documents that it changes, as a build reads them from a new project's variant the theme was
// applied to (each with its game LUT, for the build's comparison).
func (pl *ThemePlan) Apply(t ThemeLooks) ([]*lut.Document, []*lut.Texture, error) {
	var docs []*lut.Document
	var vans []*lut.Texture
	keep := func(L planLUT, d *lut.Document) error {
		nd, err := roundTrip(d)
		if err != nil {
			return err
		}
		docs, vans = append(docs, nd), append(vans, L.van)
		return nil
	}
	for _, L := range pl.mats {
		d := cloneDoc(L.base)
		looks := lutLookFor(t.Looks, t.GroupLooks, t.LUTLooks, L.hash, L.group, t.BySize && pl.swapped[L.hash])
		if _, changed, _, _ := themeZones(d, L.van, L.roles, looks, nil, true, nil); changed {
			if err := keep(L, d); err != nil {
				return nil, nil, err
			}
		}
	}
	if trim, ok := t.Looks["trim"]; ok && len(trim) >= 3 {
		for _, set := range []struct {
			list      []planLUT
			patterned func(*lut.Texture, int) bool
			group     string
		}{{pl.capes, nil, "Capes"}, {pl.patterns, patternedRow, ""}} {
			tr := t.Looks["trim"]
			if gl, ok := t.GroupLooks[set.group]; ok && len(gl["trim"]) >= 3 {
				tr = gl["trim"]
			}
			var fade []float32 // (capes: their gradient in the capes' primary, else the theme's: as Apply)
			if set.group == "Capes" {
				fade = t.Looks["primary"]
				if gl, ok := t.GroupLooks["Capes"]; ok && len(gl["primary"]) >= 3 {
					fade = gl["primary"]
				}
			}
			for _, L := range set.list {
				d := cloneDoc(L.base)
				if _, changed, _, _ := trimZones(d, L.van, set.patterned, tr, fade, nil, true); changed {
					if err := keep(L, d); err != nil {
						return nil, nil, err
					}
				}
			}
		}
	}
	return docs, vans, nil
}
