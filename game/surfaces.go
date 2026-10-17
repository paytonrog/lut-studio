package game

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/qmuntal/gltf"
	"github.com/qmuntal/gltf/modeler"

	"lutstudio/lut"
)

// Surfaces: how big the parts that wear a material LUT are, for weighing an item's colors by what the eye sees (a
// weapon's magazine, all one color, is 100% of its LUT's coverage, as the receiver is of its own: by area it is a
// fraction of it). Per LUT: the bind-pose surface area of the primitives the preview draws with it (a Helldiver
// piece's whole unit, its cape cloth for a cape; a weapon's or vehicle's primitives of the piece's material slot),
// the mean over the kits wearing it (per kit the mean over its bodies), and those primitives' ID masks (a weapon
// unit's other materials have masks of their own). Shipped precomputed (surfaces.json, tools/surfaces); a LUT the
// table lacks is computed from the units' glTF exports.
type Surface struct {
	Area  float64  `json:"area"`
	Masks []string `json:"masks,omitempty"`
}

//go:embed surfaces.json
var surfacesJSON []byte

var builtinSurfaces = sync.OnceValue(func() map[string]Surface {
	var f struct {
		Surfaces map[string]Surface `json:"surfaces"`
	}
	json.Unmarshal(surfacesJSON, &f)
	if f.Surfaces == nil {
		f.Surfaces = map[string]Surface{}
	}
	return f.Surfaces
})

// BuiltinSurface: LUT lut's surface from the shipped table
func BuiltinSurface(lut string) (Surface, bool) {
	s, ok := builtinSurfaces()[lut]
	return s, ok
}

// charType: the kinds drawn as a Helldiver's pieces (a piece is its whole unit); the rest are drawn per material slot
func charType(t string) bool { return t == "Armor" || t == "Helmet" || t == "Cape" }

// surfPrim: a primitive of a unit's export the preview draws on the armor or cape shader
type surfPrim struct {
	slot   string
	cape   bool
	hidden bool // (vehicles: a part the game hides at first)
	area   float64
	mask   string
}

// unitPrims: the armor / cape primitives of a unit's glTF export, with their surface area (cached per unit)
func (a *Assets) unitPrims(unit uint64) ([]surfPrim, error) {
	a.surfMu.Lock()
	if p, ok := a.prims[unit]; ok {
		a.surfMu.Unlock()
		return p, nil
	}
	a.surfMu.Unlock()
	b, err := a.UnitGLB(unit)
	if err != nil {
		return nil, err
	}
	p, err := primsOfGLB(b)
	if err != nil {
		return nil, err
	}
	a.surfMu.Lock()
	if a.prims == nil {
		a.prims = map[uint64][]surfPrim{}
	}
	a.prims[unit] = p
	a.surfMu.Unlock()
	return p, nil
}

// primsOfGLB: as the preview's extractPieces picks them (render.js): materials with ID masks (the armor shader) or
// cape fields; capes only their full-detail cloth (not the _lod / _simple / _partial / _backpack meshes); primitives
// with a second UV set. Skinned meshes as stored (bind pose), others placed by their node.
func primsOfGLB(b []byte) ([]surfPrim, error) {
	doc := new(gltf.Document)
	if err := gltf.NewDecoder(bytes.NewReader(b)).Decode(doc); err != nil {
		return nil, err
	}
	world := nodeWorlds(doc)
	texName := func(ex map[string]any, key string) string {
		f, ok := ex[key].(float64)
		if !ok || int(f) < 0 || int(f) >= len(doc.Textures) || doc.Textures[int(f)].Source == nil {
			return ""
		}
		n := doc.Images[*doc.Textures[int(f)].Source].Name
		if strings.Trim(strings.TrimPrefix(n, "0x"), "0") == "" {
			return ""
		}
		return n
	}
	var out []surfPrim
	for ni, node := range doc.Nodes {
		if node.Mesh == nil {
			continue
		}
		hidden := strings.Contains(node.Name, "_destroyed")
		if ex, ok := node.Extras.(map[string]any); ok {
			if h, ok := ex["default_hidden"]; ok {
				hidden = h == true || h == float64(1)
			}
		}
		for _, prim := range doc.Meshes[*node.Mesh].Primitives {
			if prim.Material == nil {
				continue
			}
			mat := doc.Materials[*prim.Material]
			ex, _ := mat.Extras.(map[string]any)
			if ex == nil {
				continue
			}
			_, capeA := ex["cape_scalar_fields"]
			_, capeB := ex["cape_lut"]
			cape := capeA || capeB
			if _, ok := ex["id_masks_array"]; !cape && !ok {
				continue
			}
			if cape && (strings.Contains(node.Name, "_lod") || strings.Contains(node.Name, "_simple") ||
				strings.Contains(node.Name, "_partial") || strings.Contains(node.Name, "_backpack")) {
				continue
			}
			pi, ok := prim.Attributes[gltf.POSITION]
			if !ok {
				continue
			}
			if _, ok := prim.Attributes[gltf.TEXCOORD_1]; !ok {
				continue
			}
			pos, err := modeler.ReadPosition(doc, doc.Accessors[pi], nil)
			if err != nil {
				continue
			}
			var idx []uint32
			if prim.Indices != nil {
				if idx, err = modeler.ReadIndices(doc, doc.Accessors[*prim.Indices], nil); err != nil {
					continue
				}
			} else {
				for i := range pos {
					idx = append(idx, uint32(i))
				}
			}
			m := world[ni]
			if node.Skin != nil {
				m = identity
			}
			out = append(out, surfPrim{slot: materialSlot(mat.Name), cape: cape, hidden: hidden, area: meshArea(pos, idx, m),
				mask: texName(ex, "id_masks_array")})
		}
	}
	return out, nil
}

// materialSlot: the material slot a glTF material of filediver's fills (render.js materialSlot): its name is
// "<slot> <material>", a skin's variant "<skin> <slot>", a slot without a known name a 32-bit hash
func materialSlot(name string) string {
	var hashes []string
	for _, t := range strings.Fields(name) {
		if !strings.HasPrefix(t, "0x") {
			return t
		}
		if len(t) == 10 {
			hashes = append(hashes, t)
		}
	}
	if len(hashes) > 0 {
		return hashes[len(hashes)-1]
	}
	return ""
}

var identity = [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}

// nodeWorlds: every node's world matrix (column-major)
func nodeWorlds(doc *gltf.Document) [][16]float64 {
	local := make([][16]float64, len(doc.Nodes))
	parent := make([]int, len(doc.Nodes))
	for i := range parent {
		parent[i] = -1
	}
	for i, n := range doc.Nodes {
		for _, c := range n.Children {
			parent[c] = i
		}
		if n.Matrix != gltf.DefaultMatrix && n.Matrix != [16]float32{} {
			for k, v := range n.Matrix {
				local[i][k] = float64(v)
			}
			continue
		}
		t32, r32, s32 := n.TranslationOrDefault(), n.RotationOrDefault(), n.ScaleOrDefault()
		t := [3]float64{float64(t32[0]), float64(t32[1]), float64(t32[2])}
		s := [3]float64{float64(s32[0]), float64(s32[1]), float64(s32[2])}
		x, y, z, w := float64(r32[0]), float64(r32[1]), float64(r32[2]), float64(r32[3])
		local[i] = [16]float64{
			(1 - 2*(y*y+z*z)) * s[0], 2 * (x*y + z*w) * s[0], 2 * (x*z - y*w) * s[0], 0,
			2 * (x*y - z*w) * s[1], (1 - 2*(x*x+z*z)) * s[1], 2 * (y*z + x*w) * s[1], 0,
			2 * (x*z + y*w) * s[2], 2 * (y*z - x*w) * s[2], (1 - 2*(x*x+y*y)) * s[2], 0,
			t[0], t[1], t[2], 1}
	}
	world := make([][16]float64, len(doc.Nodes))
	done := make([]bool, len(doc.Nodes))
	var get func(i int) [16]float64
	get = func(i int) [16]float64 {
		if done[i] {
			return world[i]
		}
		done[i] = true // (a cycle, in a broken file, ends here)
		world[i] = local[i]
		if parent[i] >= 0 {
			world[i] = mul4(get(parent[i]), local[i])
		}
		return world[i]
	}
	for i := range doc.Nodes {
		get(i)
	}
	return world
}

func mul4(a, b [16]float64) [16]float64 {
	var o [16]float64
	for c := 0; c < 4; c++ {
		for r := 0; r < 4; r++ {
			for k := 0; k < 4; k++ {
				o[c*4+r] += a[k*4+r] * b[c*4+k]
			}
		}
	}
	return o
}

// meshArea: the surface area of a triangle list, its positions placed by m
func meshArea(pos [][3]float32, idx []uint32, m [16]float64) float64 {
	at := func(i uint32) [3]float64 {
		p := pos[i]
		x, y, z := float64(p[0]), float64(p[1]), float64(p[2])
		return [3]float64{m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]}
	}
	area := 0.0
	for t := 0; t+2 < len(idx); t += 3 {
		if int(idx[t]) >= len(pos) || int(idx[t+1]) >= len(pos) || int(idx[t+2]) >= len(pos) {
			continue
		}
		a, b, c := at(idx[t]), at(idx[t+1]), at(idx[t+2])
		u := [3]float64{b[0] - a[0], b[1] - a[1], b[2] - a[2]}
		v := [3]float64{c[0] - a[0], c[1] - a[1], c[2] - a[2]}
		cx, cy, cz := u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]
		area += math.Sqrt(cx*cx+cy*cy+cz*cz) / 2
	}
	return area
}

// LUTSurfaces: the surfaces of the LUTs in only (all when nil), from the units' glTF exports (each unit exported
// once, cached as the preview's)
func (a *Assets) LUTSurfaces(idx *Index, only map[string]bool) map[string]Surface {
	type acc struct {
		sum   float64
		kits  int
		masks map[string]bool
	}
	res := map[string]*acc{}
	for _, k := range idx.Kits {
		char := charType(k.Type)
		// per LUT, per body: the area of the primitives its pieces draw ("any" counts for every body)
		byBody := map[string]map[string]float64{}
		seen := map[string]bool{}
		for _, p := range k.Pieces {
			h := p.MaterialLUT
			if h == "" || (only != nil && !only[h]) {
				continue
			}
			key := h + " " + p.Unit + " " + p.Slot + " " + p.Body
			if seen[key] {
				continue
			}
			seen[key] = true
			u, err := lut.ParseHash(p.Unit)
			if err != nil || u == 0 {
				continue
			}
			prims, err := a.unitPrims(u)
			if err != nil {
				continue
			}
			area := 0.0
			for _, pr := range prims {
				switch {
				case char && p.Slot == "cape" && !pr.cape, char && p.Slot != "cape" && pr.cape:
					continue
				case !char && (pr.hidden || pr.slot != p.Slot):
					continue
				}
				area += pr.area
				if pr.mask != "" {
					if res[h] == nil {
						res[h] = &acc{masks: map[string]bool{}}
					}
					res[h].masks[pr.mask] = true
				}
			}
			if area == 0 {
				continue
			}
			if byBody[h] == nil {
				byBody[h] = map[string]float64{}
			}
			byBody[h][p.Body] += area
		}
		for h, bodies := range byBody {
			anyA := bodies["any"]
			sum, n := 0.0, 0
			for b, v := range bodies {
				if b != "any" {
					sum += v + anyA
					n++
				}
			}
			if n == 0 {
				sum, n = anyA, 1
			}
			if res[h] == nil {
				res[h] = &acc{masks: map[string]bool{}}
			}
			res[h].sum += sum / float64(n)
			res[h].kits++
		}
	}
	out := map[string]Surface{}
	for h, r := range res {
		if r.kits == 0 {
			continue
		}
		s := Surface{Area: r.sum / float64(r.kits)}
		for m := range r.masks {
			s.Masks = append(s.Masks, m)
		}
		sort.Strings(s.Masks)
		out[h] = s
	}
	return out
}

// Surface: LUT lut's surface, from the shipped table, else computed (once per LUT)
func (a *Assets) Surface(idx *Index, lut string) (Surface, bool) {
	if s, ok := BuiltinSurface(lut); ok {
		return s, true
	}
	a.surfMu.Lock()
	s, ok := a.surfs[lut]
	a.surfMu.Unlock()
	if ok {
		return s, s.Area > 0
	}
	if idx != nil {
		s = a.LUTSurfaces(idx, map[string]bool{lut: true})[lut]
	}
	a.surfMu.Lock()
	if a.surfs == nil {
		a.surfs = map[string]Surface{}
	}
	a.surfs[lut] = s
	a.surfMu.Unlock()
	return s, s.Area > 0
}
