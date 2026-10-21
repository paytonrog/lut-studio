package game

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/x448/float16"
	"github.com/xypwn/filediver/app"
	"github.com/xypwn/filediver/app/appconfig"
	"github.com/xypwn/filediver/dds"
	"github.com/xypwn/filediver/exec"
	"github.com/xypwn/filediver/extractor/material"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"
	"github.com/xypwn/filediver/stingray/unit/texture"
)

// Engine-global textures the armor shader samples that no material binds.
var (
	DetailTilerArray = stingray.Sum("content/art_shared/textures/customization/material_library/detail_tilers/customization_detail_tiler_array").Value
	IBLBRDFLut       = stingray.Sum("core/stingray_renderer/lookup_tables/ibl_brdf_lut").Value
	// the lighting's split-sum table (R16G16_FLOAT, 256 x 256: x N.V, y roughness^2)
	IBLSpecularBRDFLut = stingray.Sum("core/stingray_renderer/lookup_tables/ibl_specular_brdf_lut").Value
)

// Assets serves what the live preview needs, decoded from the install and cached on disk (the cache is the user's
// own derived data, under %LOCALAPPDATA%\LUTStudio\cache).
type Assets struct {
	g     *Game
	cache string

	mu    sync.Mutex
	appMu sync.Mutex // openApp (UnitGLB holds mu, Poses doesn't)
	app   *app.App   // filediver's full app (unit -> glTF export); opened on first use

	fibMu      sync.Mutex
	fibNormals *[256][3]float32 // (speedtree.go: the tree vertices' normal table)

	surfMu sync.Mutex
	prims  map[uint64][]surfPrim // (surfaces.go: a unit's primitives and their areas)
	surfs  map[string]Surface    // (surfaces.go: computed LUT surfaces)
}

// removeTmp removes a temporary export folder (only one this code names: in the cache, ending .tmp)
func removeTmp(dir string) {
	if strings.HasSuffix(dir, ".tmp") && strings.Contains(filepath.ToSlash(dir), "/"+unitCache+"/") {
		os.RemoveAll(dir)
	}
}

// writeCache writes a cache file whole or not at all (a reader never sees it half written: a temporary file, then
// renamed)
func writeCache(file string, b []byte) {
	os.MkdirAll(filepath.Dir(file), 0o755)
	tmp := fmt.Sprintf("%s.%d.tmp", file, time.Now().UnixNano())
	if os.WriteFile(tmp, b, 0o644) == nil && os.Rename(tmp, file) != nil {
		os.Remove(tmp)
	}
}

func NewAssets(g *Game, cacheDir string) *Assets { return &Assets{g: g, cache: cacheDir} }

func (a *Assets) openApp() (*app.App, error) {
	a.appMu.Lock()
	defer a.appMu.Unlock()
	if a.app != nil {
		return a.app, nil
	}
	// on the game's open data folder: no second pass over the install (the exporter needs neither Wwise names nor
	// per-file metadata; in the browser that pass took over a minute)
	ap, err := app.OpenWithDataDir(a.g.data, hashes.ParseHashes(hashes.Hashes),
		thinHashNames(), stingray_strings.LanguageFriendlyNameToHash["English (US)"])
	if err != nil {
		return nil, err
	}
	a.app = ap
	return ap, nil
}

type quietPrinter struct{}

func (quietPrinter) Infof(string, ...any)   {}
func (quietPrinter) Warnf(string, ...any)   {}
func (quietPrinter) Errorf(string, ...any)  {}
func (quietPrinter) Fatalf(string, ...any)  {}
func (quietPrinter) Statusf(string, ...any) {}
func (quietPrinter) NoStatus()              {}

// unitCache: the folder of exported units in the cache; a new name when the export changes, so older exports
// aren't served (units-2: the Bastion cannon without its LODs; units-3: materials name their base material,
// fd_base_material).
const unitCache = "units-3"

// UnitGLB exports an armor piece (unit) as glTF binary with filediver: skinned mesh in bind pose, both UV sets,
// tangents, and the material's parameters and texture slots (names = resource hashes) in material extras.
func (a *Assets) UnitGLB(unit uint64) ([]byte, error) {
	out := filepath.Join(a.cache, unitCache, fmt.Sprintf("%016x", unit))
	// filediver names the file after the unit's known path when it has one (content/.../medium_cape.unit.glb),
	// else after its hash; either way it is the one .glb in this unit's folder
	find := func() string {
		var found string
		filepath.WalkDir(out, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(p, ".glb") && found == "" {
				found = p
			}
			return nil
		})
		return found
	}
	if f := find(); f != "" {
		return os.ReadFile(f)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if f := find(); f != "" {
		return os.ReadFile(f)
	}
	ap, err := a.openApp()
	if err != nil {
		return nil, err
	}
	var cfg appconfig.Config
	cfg.Model.Format = "glb"
	cfg.Material.Format = "glb"
	cfg.Texture.Format = "png"
	material.NameOnlyTextures = true // the editor reads textures itself (/api/tex): materials only name them
	cfg.Unit.ImageFormat = "png"
	cfg.Unit.PngCompression = "fast"
	cfg.Animation.Format = "json"
	id := stingray.NewFileID(stingray.Hash{Value: unit}, stingray.Sum("unit"))
	// exported into a folder of its own, which becomes the unit's folder only when the export succeeded: no reader
	// (find above, without the lock) ever sees a half-written .glb, and a failed export leaves nothing in its place
	tmp := fmt.Sprintf("%s.%d.tmp", out, time.Now().UnixNano())
	if _, err := ap.ExtractFile(context.Background(), id, tmp, cfg, exec.NewRunner(), nil, nil, quietPrinter{},
		func(string, ...any) {}); err != nil {
		removeTmp(tmp)
		return nil, fmt.Errorf("export unit %016x: %w", unit, err)
	}
	if err := os.Rename(tmp, out); err != nil {
		// an older export's folder without a .glb in the way: moved aside, then this export takes its place
		os.Rename(out, fmt.Sprintf("%s.%d.old", out, time.Now().UnixNano()))
		if err := os.Rename(tmp, out); err != nil {
			out = tmp // (still in the way: this export is read from where it is)
		}
	}
	f := find()
	if f == "" {
		return nil, fmt.Errorf("export unit %016x: filediver wrote no .glb", unit)
	}
	return os.ReadFile(f)
}

// Texture formats of the preview wire format.
const (
	FormatRGBA8   = 0
	FormatRGBA32F = 1
)

// TextureBlob decodes mip 0 of every layer of a texture to the preview's wire format:
// "LSTX", u32 width, u32 height, u32 layers, u32 format, then the texels (layer after layer).
func (a *Assets) TextureBlob(name uint64) ([]byte, error) {
	file := filepath.Join(a.cache, "tex", fmt.Sprintf("%016x.lstx", name))
	if b, err := os.ReadFile(file); err == nil {
		return b, nil
	}
	b, err := a.decodeTexture(name)
	if err != nil {
		return nil, err
	}
	writeCache(file, b)
	return b, nil
}

func (a *Assets) decodeTexture(name uint64) ([]byte, error) {
	id := stingray.NewFileID(stingray.Hash{Value: name}, TextureType)
	var rs []io.Reader
	for typ := range stingray.NumDataType {
		b, err := a.g.data.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("texture %016x: %w", name, err)
		}
		rs = append(rs, bytes.NewReader(b))
	}
	r := io.MultiReader(rs...)
	if _, err := texture.DecodeInfo(r); err != nil {
		return nil, fmt.Errorf("texture %016x: %w", name, err)
	}
	tex, err := dds.Decode(r, false)
	if err != nil {
		return nil, fmt.Errorf("texture %016x: %w", name, err)
	}
	first := tex.Images[0].MipMaps[0]
	w, h := first.Width, first.Height
	format := FormatRGBA8
	if _, ok := first.Image.(*image.NRGBA64); ok {
		format = FormatRGBA32F
	}
	head := []byte("LSTX")
	for _, v := range []int{w, h, len(tex.Images), format} {
		head = binary.LittleEndian.AppendUint32(head, uint32(v))
	}
	out := bytes.NewBuffer(head)
	for _, im := range tex.Images {
		switch m := im.MipMaps[0].Image.(type) {
		case *image.NRGBA:
			out.Write(m.Pix)
		case *image.NRGBA64:
			if x := tex.Info.DXT10Header; x != nil && x.DXGIFormat == dds.DXGIFormatR16G16B16A16Float && len(im.MipMaps[0].Raw) == len(m.Pix) {
				// half floats: from the raw bits (filediver's mapping to 0..1 * 65535 wraps values above 1)
				for i := 0; i+1 < len(m.Pix); i += 2 {
					v := float16.Frombits(binary.LittleEndian.Uint16(im.MipMaps[0].Raw[i:])).Float32()
					out.Write(binary.LittleEndian.AppendUint32(nil, math.Float32bits(v)))
				}
				continue
			}
			if x := tex.Info.DXT10Header; x != nil && x.DXGIFormat == dds.DXGIFormatR16G16Float && 2*len(im.MipMaps[0].Raw) == len(m.Pix) {
				// two half floats per texel (the specular BRDF table): exact, as R, G, 0, 1
				raw := im.MipMaps[0].Raw
				for i := 0; i+3 < len(raw); i += 4 {
					for _, v := range []float32{float16.Frombits(binary.LittleEndian.Uint16(raw[i:])).Float32(),
						float16.Frombits(binary.LittleEndian.Uint16(raw[i+2:])).Float32(), 0, 1} {
						out.Write(binary.LittleEndian.AppendUint32(nil, math.Float32bits(v)))
					}
				}
				continue
			}
			// big-endian unorm16
			for i := 0; i+1 < len(m.Pix); i += 2 {
				v := float32(binary.BigEndian.Uint16(m.Pix[i:])) / 65535
				out.Write(binary.LittleEndian.AppendUint32(nil, math.Float32bits(v)))
			}
		case *image.Gray:
			for _, v := range m.Pix {
				out.Write([]byte{v, v, v, 255})
			}
		default:
			return nil, fmt.Errorf("texture %016x: unsupported pixel layout %T", name, m)
		}
	}
	return out.Bytes(), nil
}
