package game

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"strings"

	"github.com/qmuntal/gltf"
	"github.com/qmuntal/gltf/modeler"
	"github.com/x448/float16"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/speedtree"
	"github.com/xypwn/filediver/stingray/unit/material"

	"lutstudio/lut"
)

// SpeedTreeType: the game's SpeedTree tree resources (content/.../speedtrees/...).
var SpeedTreeType = stingray.Sum("speedtree")

// the 256 unit vectors the tree vertices' one-byte normals index (16 x 16 RGBA32F texels, x y z in the game's Z-up)
var fibonacciNormalLUT = stingray.Sum("content/art_shared/textures/fibonacci_normal_lut").Value

// ResourceHash reads a resource named by its path ("content/...") or its hash ("0x" + 16 hex digits).
func ResourceHash(s string) (uint64, error) {
	if strings.Contains(s, "/") {
		return stingray.Sum(s).Value, nil
	}
	return lut.ParseHash(s)
}

// HasSpeedTree: the game has a SpeedTree resource of that name.
func (g *Game) HasSpeedTree(name uint64) bool {
	return g.has(stingray.NewFileID(stingray.Hash{Value: name}, SpeedTreeType))
}

func (a *Assets) fibonacciNormals() (*[256][3]float32, error) {
	a.fibMu.Lock()
	defer a.fibMu.Unlock()
	if a.fibNormals != nil {
		return a.fibNormals, nil
	}
	b, err := a.g.data.Read(stingray.NewFileID(stingray.Hash{Value: fibonacciNormalLUT}, TextureType), stingray.DataGPU)
	if err != nil {
		return nil, fmt.Errorf("fibonacci normal table: %w", err)
	}
	if len(b) < 256*16 {
		return nil, fmt.Errorf("fibonacci normal table: %d bytes, want %d", len(b), 256*16)
	}
	var lutN [256][3]float32
	for i := range lutN {
		for c := range 3 {
			lutN[i][c] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*16+c*4:]))
		}
	}
	a.fibNormals = &lutN
	return a.fibNormals, nil
}

// speedTreePart names what a tree material draws from its SpeedTree material name: the trunk and branches ("bark",
// tiling textures), the leaf and frond cards ("leaf", an atlas cut out by the albedo's alpha), or the far LOD's
// impostor ("billboard").
func speedTreePart(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "billboard"):
		return "billboard"
	case strings.Contains(n, "bark"), strings.Contains(n, "trunk"), strings.Contains(n, "stem"):
		return "bark"
	}
	return "leaf"
}

// SpeedTreeGLB exports a SpeedTree tree (the game's speedtree resource) as glTF binary: its full-detail LOD only,
// one primitive per material (POSITION, NORMAL, TEXCOORD_0, indices; Y-up meters, like the unit exports), the
// material's part and texture names (resource hashes, readable by /api/tex) in its extras:
//
//	{"part": "bark"|"leaf"|"billboard", "albedo": "0x...", "normal": "0x...", "srasm": "0x...",
//	 "alpha_test": bool, "alpha_cutoff": float, "two_sided": bool, "material": "0x...", "name": "..."}
//
// albedo is the SpeedTree albedo_opacity texture (tex0: color in RGB, leaf cut-out in A), normal its normal map
// (tex1), srasm its specular / roughness / AO / subsurface / metallic map (tex2). Wind, the LOD morph positions and
// the per-vertex AO are left out.
func (a *Assets) SpeedTreeGLB(name uint64) ([]byte, error) {
	id := stingray.NewFileID(stingray.Hash{Value: name}, SpeedTreeType)
	mainData, err := a.g.data.Read(id, stingray.DataMain)
	if err != nil {
		return nil, fmt.Errorf("speedtree %s: %w", lut.HashString(name), err)
	}
	gpu, err := a.g.data.Read(id, stingray.DataGPU)
	if err != nil {
		return nil, fmt.Errorf("speedtree %s: GPU data: %w", lut.HashString(name), err)
	}
	tree, err := speedtree.LoadSpeedTree(bytes.NewReader(mainData))
	if tree == nil {
		return nil, fmt.Errorf("speedtree %s: %w", lut.HashString(name), err)
	}
	if len(tree.IndexDefinitions) == 0 {
		return nil, fmt.Errorf("speedtree %s: no geometry", lut.HashString(name))
	}
	fib, err := a.fibonacciNormals()
	if err != nil {
		return nil, err
	}

	// the full-detail LOD: the first index set, with its vertex set
	ix := tree.IndexDefinitions[0]
	if int(ix.VertexDef) >= len(tree.VertexDefinitions) || uint64(ix.MeshOffset)+uint64(ix.MeshCount) > uint64(len(tree.MeshDefinitions)) {
		return nil, fmt.Errorf("speedtree %s: LOD 0 names data it doesn't have", lut.HashString(name))
	}
	vd := tree.VertexDefinitions[ix.VertexDef]
	if vd.Stride != 16 && vd.Stride < 20 {
		return nil, fmt.Errorf("speedtree %s: unknown vertex stride %d", lut.HashString(name), vd.Stride)
	}
	if ix.Stride != 2 && ix.Stride != 4 {
		return nil, fmt.Errorf("speedtree %s: unknown index size %d", lut.HashString(name), ix.Stride)
	}
	if uint64(vd.Offset)+uint64(vd.Count)*uint64(vd.Stride) > uint64(len(gpu)) ||
		uint64(ix.Offset)+uint64(ix.Count)*uint64(ix.Stride) > uint64(len(gpu)) {
		return nil, fmt.Errorf("speedtree %s: geometry past the end of its GPU data", lut.HashString(name))
	}
	half := func(o uint32) float32 { return float16.Frombits(binary.LittleEndian.Uint16(gpu[o:])).Float32() }
	// the game's Z-up to glTF's Y-up (filediver's stingray.ToGLTFMatrix: x, z, -y)
	yUp := func(x, y, z float32) [3]float32 { return [3]float32{x, z, -y} }
	type vertex struct {
		pos, normal [3]float32
		uv          [2]float32
		twoSided    bool
	}
	readVertex := func(i uint32) vertex {
		o := vd.Offset + i*vd.Stride
		var v vertex
		v.pos = yUp(half(o), half(o+2), half(o+4))
		if vd.Stride == 16 {
			// position, normal x, uv, normal y z (the billboards)
			v.normal = yUp(half(o+6), half(o+12), half(o+14))
			v.uv = [2]float32{half(o + 8), half(o + 10)}
		} else {
			// position + u, LOD position + v, normal / tangent / AO / two-sided + geometry type, wind
			n := fib[gpu[o+16]]
			v.normal = yUp(n[0], n[1], n[2])
			v.uv = [2]float32{half(o + 6), half(o + 14)}
			v.twoSided = gpu[o+19]&1 != 0
		}
		if l := math.Sqrt(float64(v.normal[0]*v.normal[0] + v.normal[1]*v.normal[1] + v.normal[2]*v.normal[2])); l > 0 {
			for c := range 3 {
				v.normal[c] = float32(float64(v.normal[c]) / l)
			}
		}
		return v
	}
	index := func(i uint32) uint32 {
		o := ix.Offset + i*ix.Stride
		if ix.Stride == 4 {
			return binary.LittleEndian.Uint32(gpu[o:])
		}
		return uint32(binary.LittleEndian.Uint16(gpu[o:]))
	}

	matByIndex := map[uint32]stingray.Hash{}
	for _, m := range tree.StingrayMaterials {
		matByIndex[uint32(m.Index)] = m.Path
	}
	tex0, tex1, tex2 := stingray.Sum("tex0").Thin(), stingray.Sum("tex1").Thin(), stingray.Sum("tex2").Thin()
	opacityThreshold := stingray.Sum("opacity_threshold").Thin()

	doc := gltf.NewDocument()
	doc.Asset.Generator = "LUT Studio"
	mesh := &gltf.Mesh{Name: lut.HashString(name)}
	for m := range ix.MeshCount {
		md := tree.MeshDefinitions[ix.MeshOffset+m]
		if uint64(md.IndexOffset)+uint64(md.IndexCount) > uint64(ix.Count) || md.IndexCount%3 != 0 {
			return nil, fmt.Errorf("speedtree %s: mesh %d's indices out of range", lut.HashString(name), m)
		}
		sdkName := ""
		if int(md.Material) < len(tree.SDKMaterials) {
			sdkName = tree.SDKMaterials[md.Material].Name
		}
		part := speedTreePart(sdkName)

		// this primitive's own vertices (the LOD's vertex set is shared by its materials)
		remap := map[uint32]uint32{}
		var pos, nrm [][3]float32
		var uvs [][2]float32
		indices := make([]uint32, 0, md.IndexCount)
		twoSided := false
		for i := range md.IndexCount {
			vi := index(md.IndexOffset + i)
			if vi >= vd.Count {
				return nil, fmt.Errorf("speedtree %s: vertex %d of %d", lut.HashString(name), vi, vd.Count)
			}
			ni, ok := remap[vi]
			if !ok {
				v := readVertex(vi)
				ni = uint32(len(pos))
				remap[vi] = ni
				pos, nrm, uvs = append(pos, v.pos), append(nrm, v.normal), append(uvs, v.uv)
				twoSided = twoSided || v.twoSided
			}
			indices = append(indices, ni)
		}
		if len(indices) == 0 {
			continue
		}

		extras := map[string]any{"part": part, "name": strings.TrimSuffix(sdkName, "_Mat")}
		alphaTest := part != "bark"
		cutoff := float32(0.5)
		if mh, ok := matByIndex[md.Material]; ok {
			extras["material"] = lut.HashString(mh.Value)
			if mb, err := a.g.data.Read(stingray.NewFileID(mh, stingray.Sum("material")), stingray.DataMain); err == nil {
				if mat, err := material.LoadMain(bytes.NewReader(mb)); err == nil {
					for key, slot := range map[string]stingray.ThinHash{"albedo": tex0, "normal": tex1, "srasm": tex2} {
						if h, ok := mat.Textures[slot]; ok && h.Value != 0 {
							extras[key] = lut.HashString(h.Value)
						}
					}
					if t, ok := mat.Settings[opacityThreshold]; ok && len(t) > 0 && t[0] > 0 {
						cutoff = t[0]
					}
				}
			}
		}
		extras["alpha_test"] = alphaTest
		extras["alpha_cutoff"] = cutoff
		extras["two_sided"] = twoSided || part != "bark"
		gm := &gltf.Material{
			Name:                 strings.TrimSuffix(sdkName, "_Mat"),
			PBRMetallicRoughness: &gltf.PBRMetallicRoughness{BaseColorFactor: &[4]float32{1, 1, 1, 1}, MetallicFactor: gltf.Float(0), RoughnessFactor: gltf.Float(1)},
			DoubleSided:          twoSided || part != "bark",
			Extras:               extras,
		}
		if alphaTest {
			gm.AlphaMode = gltf.AlphaMask
			gm.AlphaCutoff = gltf.Float(cutoff)
		}
		doc.Materials = append(doc.Materials, gm)

		prim := &gltf.Primitive{
			Attributes: gltf.Attribute{
				gltf.POSITION:   modeler.WritePosition(doc, pos),
				gltf.NORMAL:     modeler.WriteNormal(doc, nrm),
				gltf.TEXCOORD_0: modeler.WriteTextureCoord(doc, uvs),
			},
			Material: gltf.Index(uint32(len(doc.Materials) - 1)),
			Mode:     gltf.PrimitiveTriangles,
		}
		if len(pos) <= math.MaxUint16 {
			small := make([]uint16, len(indices))
			for i, v := range indices {
				small[i] = uint16(v)
			}
			prim.Indices = gltf.Index(modeler.WriteIndices(doc, small))
		} else {
			prim.Indices = gltf.Index(modeler.WriteIndices(doc, indices))
		}
		mesh.Primitives = append(mesh.Primitives, prim)
	}
	if len(mesh.Primitives) == 0 {
		return nil, fmt.Errorf("speedtree %s: LOD 0 has no triangles", lut.HashString(name))
	}
	doc.Meshes = []*gltf.Mesh{mesh}
	nodeExtras := map[string]any{"speedtree": lut.HashString(name), "lod_distances": tree.LODDistances}
	doc.Nodes = []*gltf.Node{{Name: lut.HashString(name), Mesh: gltf.Index(0), Extras: nodeExtras}}
	doc.Scenes = []*gltf.Scene{{Nodes: []uint32{0}}}
	doc.Scene = gltf.Index(0)

	var out bytes.Buffer
	enc := gltf.NewEncoder(&out)
	enc.AsBinary = true
	if err := enc.Encode(doc); err != nil {
		return nil, fmt.Errorf("speedtree %s: %w", lut.HashString(name), err)
	}
	return out.Bytes(), nil
}
