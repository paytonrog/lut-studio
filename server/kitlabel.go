package server

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"lutstudio/game"
	"lutstudio/lut"
)

// kitLabel names a kit for the dropdowns. Same-named kits (B-01 Tactical: 9 armors, 15 helmets) are told apart by
// their main color (zone 0 of the torso's armor LUT, or the helmet's) and id; capes by their model and id.
func (s *Server) kitLabel(k game.Kit) string {
	idx := s.index()
	if idx == nil || !strings.HasPrefix(idx.Key(k), "kit:") {
		return k.Name
	}
	what := ""
	switch k.Type {
	case "Helmet":
		what = "helmet, "
	case "Cape":
		what = "standard cape, "
		for _, p := range k.Pieces {
			if p.Unit == game.ShockTrooperCape {
				what = "shock-trooper cape, "
			}
		}
		return fmt.Sprintf("%s (%s%s)", k.Name, what, k.ID)
	}
	// numbered in the game's order: the versions differ in colors, models or both, so a color alone doesn't name them
	n, of := 0, 0
	for _, x := range idx.Kits {
		if x.Name == k.Name && x.Type == k.Type {
			of++
			if x.ID == k.ID {
				n = of
			}
		}
	}
	what = fmt.Sprintf("version %d of %d, %s", n, of, what)
	if c := s.kitColor(k); c != "" {
		what += c + ", "
	}
	return fmt.Sprintf("%s (%s%s)", k.Name, what, k.ID)
}

// kitColor: a rough color name of the kit's main paint ("" = unknown), cached.
func (s *Server) kitColor(k game.Kit) string {
	s.colorMu.Lock()
	defer s.colorMu.Unlock()
	if c, ok := s.colors[k.ID]; ok {
		return c
	}
	pick := ""
	for _, pref := range []func(p game.Piece) bool{
		func(p game.Piece) bool { return p.Slot == "torso" && p.PieceType == "armor" },
		func(p game.Piece) bool { return p.PieceType == "armor" },
		func(p game.Piece) bool { return true },
	} {
		for _, p := range k.Pieces {
			if pick == "" && p.MaterialLUT != "" && pref(p) {
				pick = p.MaterialLUT
			}
		}
	}
	c := ""
	if h, err := lut.ParseHash(pick); err == nil && s.game() != nil {
		if t, err := s.game().ReadLUT(h); err == nil && t.Width == lut.MaterialWidth {
			// the first zones' colors ("gray / olive"): zone 0 alone is gray on most color versions
			var names []string
			for z := 0; z < min(3, t.Height); z++ {
				if n := colorName(t.At(0, z, 0), t.At(0, z, 1), t.At(0, z, 2)); !slices.Contains(names, n) {
					names = append(names, n)
				}
			}
			c = strings.Join(names, " / ")
		}
	}
	if s.colors == nil {
		s.colors = map[string]string{}
	}
	s.colors[k.ID] = c
	return c
}

// colorName: a coarse name of a linear RGB color (for telling kits apart, not exact).
func colorName(r, g, b float32) string {
	srgb := func(v float32) float64 { return math.Pow(math.Max(0, math.Min(1, float64(v))), 1/2.2) }
	R, G, B := srgb(r), srgb(g), srgb(b)
	mx, mn := math.Max(R, math.Max(G, B)), math.Min(R, math.Min(G, B))
	l, d := (mx+mn)/2, mx-mn
	if d < 0.08 || (l > 0 && d/(1-math.Abs(2*l-1)+1e-9) < 0.12) {
		switch {
		case l < 0.18:
			return "black"
		case l < 0.42:
			return "dark gray"
		case l < 0.7:
			return "gray"
		}
		return "white"
	}
	var hue float64
	switch mx {
	case R:
		hue = math.Mod((G-B)/d, 6)
	case G:
		hue = (B-R)/d + 2
	default:
		hue = (R-G)/d + 4
	}
	hue = math.Mod(hue*60+360, 360)
	name := ""
	switch {
	case hue < 15 || hue >= 345:
		name = "red"
	case hue < 40:
		name = "orange"
		if l < 0.45 {
			name = "brown"
		} else if d < 0.3 {
			name = "tan"
		}
	case hue < 65:
		name = "yellow"
		if l < 0.45 {
			name = "olive"
		} else if d < 0.3 {
			name = "tan"
		}
	case hue < 160:
		name = "green"
		if hue < 100 && l < 0.45 {
			name = "olive"
		}
	case hue < 200:
		name = "teal"
	case hue < 255:
		name = "blue"
	case hue < 290:
		name = "purple"
	default:
		name = "pink"
	}
	if l < 0.25 && name != "brown" && name != "olive" {
		name = "dark " + name
	} else if l > 0.75 {
		name = "light " + name
	}
	return name
}

// naturalLess compares with digit runs as numbers ("version 2" before "version 10").
func naturalLess(a, b string) bool {
	for a != "" && b != "" {
		da, db := digits(a), digits(b)
		if da > 0 && db > 0 {
			na, nb := strings.TrimLeft(a[:da], "0"), strings.TrimLeft(b[:db], "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			a, b = a[da:], b[db:]
			continue
		}
		if a[0] != b[0] {
			return a[0] < b[0]
		}
		a, b = a[1:], b[1:]
	}
	return len(a) < len(b)
}

func digits(s string) int {
	n := 0
	for n < len(s) && s[n] >= '0' && s[n] <= '9' {
		n++
	}
	return n
}
