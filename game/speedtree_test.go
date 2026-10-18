package game

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"testing"

	"github.com/qmuntal/gltf"
	"github.com/qmuntal/gltf/modeler"
)

// TestSpeedTrees: trees export as glTF binary (full-detail LOD, a primitive per part, Y-up meters), their albedo
// textures decode through TextureBlob (/api/tex), the leaf atlases have cut-out alpha their cards' UVs land on.
func TestSpeedTrees(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	a := NewAssets(g, t.TempDir())
	for _, c := range []struct {
		path      string
		minHeight float32
		parts     map[string]bool
	}{
		{"content/env_shared_forest/assets/speedtrees/forest/forest_tree_03", 25, map[string]bool{"bark": true, "leaf": true}},
		{"content/env_shared/assets/speedtrees/neutral_palm_tree_01", 25, map[string]bool{"bark": true, "leaf": true}},
		{"content/planet_forest_swamp/assets/speedtrees/swamp_wet_tree_set_03", 25, map[string]bool{"bark": true, "leaf": true}},
		{"content/planet_forest_primordial/assets/speedtrees/grassland_alien_tree_set_02_03", 15, map[string]bool{"bark": true, "leaf": true}},
	} {
		h, _ := ResourceHash(c.path)
		if !g.HasSpeedTree(h) {
			t.Errorf("%s: not in the install", c.path)
			continue
		}
		b, err := a.SpeedTreeGLB(h)
		if err != nil {
			t.Errorf("%s: %v", c.path, err)
			continue
		}
		doc := new(gltf.Document)
		if err := gltf.NewDecoder(bytes.NewReader(b)).Decode(doc); err != nil {
			t.Errorf("%s: %v", c.path, err)
			continue
		}
		lo, hi := [3]float32{math.MaxFloat32, math.MaxFloat32, math.MaxFloat32}, [3]float32{-math.MaxFloat32, -math.MaxFloat32, -math.MaxFloat32}
		seen := map[string]bool{}
		for _, p := range doc.Meshes[0].Primitives {
			pa := doc.Accessors[p.Attributes[gltf.POSITION]]
			for i := range 3 {
				lo[i], hi[i] = min(lo[i], pa.Min[i]), max(hi[i], pa.Max[i])
			}
			m := doc.Materials[*p.Material]
			ex := m.Extras.(map[string]any)
			part, _ := ex["part"].(string)
			seen[part] = true
			tris := doc.Accessors[*p.Indices].Count / 3
			albedo, _ := ex["albedo"].(string)
			line := ""
			if albedo == "" {
				t.Errorf("%s %s: no albedo texture", c.path, m.Name)
			} else if hv, err := ResourceHash(albedo); err != nil {
				t.Errorf("%s %s: albedo %q: %v", c.path, m.Name, albedo, err)
			} else if tb, err := a.TextureBlob(hv); err != nil {
				t.Errorf("%s %s: albedo %s: %v", c.path, m.Name, albedo, err)
			} else {
				w, ht, f := binary.LittleEndian.Uint32(tb[4:]), binary.LittleEndian.Uint32(tb[8:]), binary.LittleEndian.Uint32(tb[16:])
				cutoff, _ := ex["alpha_cutoff"].(float64)
				cut, texels := 0, 0
				if f == FormatRGBA8 {
					for i := 20 + 3; i < 20+int(w*ht)*4; i += 4 {
						if float64(tb[i])/255 < cutoff {
							cut++
						}
						texels++
					}
				}
				line = fmt.Sprintf(" albedo %s %dx%d format %d, %.0f%% cut out", albedo, w, ht, f, 100*float64(cut)/float64(max(texels, 1)))
				// the cards' UVs land on the atlas' opaque texels (V is the texture's row, top first: no flip)
				if part == "leaf" && f == FormatRGBA8 {
					uv, err := modeler.ReadTextureCoord(doc, doc.Accessors[p.Attributes[gltf.TEXCOORD_0]], nil)
					if err != nil {
						t.Fatal(err)
					}
					ix, err := modeler.ReadIndices(doc, doc.Accessors[*p.Indices], nil)
					if err != nil {
						t.Fatal(err)
					}
					alpha := func(u, v float32) float64 {
						x := min(max(int(u*float32(w)), 0), int(w)-1)
						y := min(max(int(v*float32(ht)), 0), int(ht)-1)
						return float64(tb[20+(y*int(w)+x)*4+3]) / 255
					}
					// points spread over each triangle (barycentric grid), opaque as read and with V flipped
					asIs, flipped, n := 0, 0, 0
					for i := 0; i+2 < len(ix); i += 3 {
						p0, p1, p2 := uv[ix[i]], uv[ix[i+1]], uv[ix[i+2]]
						for bi := 1; bi < 6; bi++ {
							for bj := 1; bi+bj < 6; bj++ {
								b0, b1 := float32(bi)/6, float32(bj)/6
								b2 := 1 - b0 - b1
								u, v := b0*p0[0]+b1*p1[0]+b2*p2[0], b0*p0[1]+b1*p1[1]+b2*p2[1]
								if alpha(u, v) >= cutoff {
									asIs++
								}
								if alpha(u, 1-v) >= cutoff {
									flipped++
								}
								n++
							}
						}
					}
					line += fmt.Sprintf(", cards opaque %.0f%% (V flipped: %.0f%%)", 100*float64(asIs)/float64(n), 100*float64(flipped)/float64(n))
					// (an atlas mostly opaque, like the alien tree's with its pods, reads opaque either way)
					if cut*10 >= texels*6 && asIs <= flipped {
						t.Errorf("%s %s: the leaf cards' UVs land on the atlas' cut-out texels", c.path, m.Name)
					}
				}
			}
			t.Logf("%s: %s (%s): %d vertices, %d triangles, alpha test %v, two-sided %v;%s", c.path, m.Name, part,
				pa.Count, tris, ex["alpha_test"], ex["two_sided"], line)
		}
		height := hi[1] - lo[1]
		t.Logf("%s: %d bytes, %d primitives, bounds %.1f..%.1f x %.1f..%.1f y %.1f..%.1f z: %.1f m tall", c.path, len(b),
			len(doc.Meshes[0].Primitives), lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], height)
		if height < c.minHeight || height > 80 || lo[1] > 1 {
			t.Errorf("%s: %.1f m tall from %.1f m: not a tree standing at the origin, Y up", c.path, height, lo[1])
		}
		for p := range c.parts {
			if !seen[p] {
				t.Errorf("%s: no %s part (parts: %v)", c.path, p, seen)
			}
		}
	}
	if _, err := a.SpeedTreeGLB(0x1234); err == nil {
		t.Error("a tree that isn't there exported")
	}
}
