package game

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/xypwn/filediver/dds"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit/texture"
)

// Environment is a lighting setup of the game the preview can use: baked reflection cubes (pre-blurred specular
// with a mip chain, optionally a diffuse irradiance cube) of a level of the game. Research:
// Only 19 cubemaps exist in the install; planets are otherwise lit
// at run time (procedural sky), so desert_day is the only planet with a bake.
type Environment struct {
	Name     string `json:"name"`
	Specular string `json:"specular"`          // texture hash, cube with mips (rough reflections = lower mips)
	Diffuse  string `json:"diffuse,omitempty"` // texture hash, irradiance cube ("" = the specular cube's last mip)
	Sun      bool   `json:"sun"`               // the bake leaves out the sun: add the analytic sun light
}

var environments = []struct {
	name, specular, diffuse string
	sun                     bool
}{
	// the Armory menu: the renderer's 3D UI pass (its shaders read the ship hub's probe bake; the light rig, ambient and
	// tone curve: app.js GAME_ENV_LOOK)
	{"Armory (menu)", "content/levels/ship_hub-cubemaps/reflection_probe_specular_bake", "content/levels/ship_hub-cubemaps/reflection_probe_diffuse_bake", false},
	// the warbond showroom levels' probe (packages/content/warbond: showroom_probe_override): the reward previews' studio
	{"Warbond reward showroom", "content/levels/ship_hub-cubemaps/reflection_cube_specular_showroom", "", false},
	// the ship_hub level's own shading environment (its customization chamber)
	{"Ship customization chamber", "content/levels/ship_hub-cubemaps/reflection_cube_specular", "content/levels/ship_hub-cubemaps/reflection_cube_irradiance", false},
	{"Super Destroyer hub", "content/levels/ship_hub-cubemaps/reflection_probe_specular_bake", "content/levels/ship_hub-cubemaps/reflection_probe_diffuse_bake", false},
	{"Super Destroyer interior", "content/env_ship/lighting/specular_cubemap_state0_array", "", false},
	{"Desert planet (day)", "content/levels/lighting/desert/desert_day-cubemaps/reflection_probe_specular_bake", "content/levels/lighting/desert/desert_day-cubemaps/reflection_probe_diffuse_bake", true},
	{"Space", "0xa366b7b400189fe0", "", false}, // unnamed nebula cube (256, 6 mips)
}

func texHash(path string) stingray.Hash {
	if h, err := stingray.ParseHash(path); err == nil && len(path) == 18 {
		return h
	}
	return stingray.Sum(path)
}

// Environments lists the game environments whose cubes this install has.
func (g *Game) Environments() []Environment {
	out := []Environment{}
	for _, e := range environments {
		spec := stingray.NewFileID(texHash(e.specular), TextureType)
		if _, ok := g.data.Files[spec]; !ok {
			continue
		}
		env := Environment{Name: e.name, Specular: fmt.Sprintf("0x%016x", spec.Name.Value), Sun: e.sun}
		if e.diffuse != "" {
			if d := stingray.NewFileID(texHash(e.diffuse), TextureType); g.has(d) {
				env.Diffuse = fmt.Sprintf("0x%016x", d.Name.Value)
			}
		}
		out = append(out, env)
	}
	return out
}

// CubeBlob decodes every face and mip of a cube texture to the preview's wire format: "LSCB", u32 size, u32 mips,
// u32 format (0 RGBA8, 2 RGBA16F), then mip after mip, each 6 faces (+X -X +Y -Y +Z -Z) of texels. Half floats
// keep their raw bits (HDR: filediver's image mapping of them clips at 1).
func (a *Assets) CubeBlob(name uint64) ([]byte, error) {
	file := filepath.Join(a.cache, "tex", fmt.Sprintf("%016x.lscb", name))
	if b, err := os.ReadFile(file); err == nil {
		return b, nil
	}
	id := stingray.NewFileID(stingray.Hash{Value: name}, TextureType)
	var rs []io.Reader
	for typ := range stingray.NumDataType {
		b, err := a.g.data.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("cube %016x: %w", name, err)
		}
		rs = append(rs, bytes.NewReader(b))
	}
	r := io.MultiReader(rs...)
	if _, err := texture.DecodeInfo(r); err != nil {
		return nil, fmt.Errorf("cube %016x: %w", name, err)
	}
	tex, err := dds.Decode(r, true)
	if err != nil {
		return nil, fmt.Errorf("cube %016x: %w", name, err)
	}
	if len(tex.Images) != 6 {
		return nil, fmt.Errorf("cube %016x: %d faces, want 6", name, len(tex.Images))
	}
	format := 0
	if x := tex.Info.DXT10Header; x != nil && x.DXGIFormat == dds.DXGIFormatR16G16B16A16Float {
		format = 2
	} else if x == nil || x.DXGIFormat != dds.DXGIFormatR8G8B8A8UNorm {
		return nil, fmt.Errorf("cube %016x: unsupported format", name)
	}
	mips := len(tex.Images[0].MipMaps)
	out := bytes.NewBuffer([]byte("LSCB"))
	for _, v := range []int{tex.Images[0].MipMaps[0].Width, mips, format} {
		out.Write(binary.LittleEndian.AppendUint32(nil, uint32(v)))
	}
	for m := 0; m < mips; m++ {
		for _, face := range tex.Images {
			mm := face.MipMaps[m]
			want := mm.Width * mm.Height * 4 * (1 + format/2)
			if len(mm.Raw) != want {
				return nil, fmt.Errorf("cube %016x: mip %d has %d bytes, want %d", name, m, len(mm.Raw), want)
			}
			out.Write(mm.Raw)
		}
	}
	os.MkdirAll(filepath.Dir(file), 0o755)
	writeCache(file, out.Bytes())
	return out.Bytes(), nil
}

func (g *Game) has(id stingray.FileID) bool { _, ok := g.data.Files[id]; return ok }
