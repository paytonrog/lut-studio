package server

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"lutstudio/lut"
	"lutstudio/project"
	"lutstudio/texenc"
)

// Textures a project replaces, per variant, each the whole image at the texture's size: decal sheets
// (variants/<folder>/textures/<0x hash>.png: artwork), cape designs (variants/<folder>/designs/<0x hash>.png: zone
// and cut-out distance fields, whose mips average every channel alike) and ID masks (variants/<folder>/masks/<0x
// hash>.png: zone distance fields, a texture array's layers stacked top to bottom) and pattern masks
// (variants/<folder>/patterns/<0x hash>.png: where a part's pattern shows, the same kind of field). The build encodes them in the game
// texture's own format and layout (texenc); the preview's /api/tex serves them in place of the game's
// (?variant=<folder>).

// TextureDirs: the folders of a variant's replaced textures (by kind: the ?kind= of /api/sheet), and whether
// their mips are straight averages.
var TextureDirs = []struct {
	Kind, Dir string
	Straight  bool
	What      string
}{{"sheet", "textures", false, "decal sheet"}, {"design", "designs", true, "cape design"}, {"mask", "masks", true, "ID mask"}, {"pattern", "patterns", true, "pattern mask"}}

// NewDesignSize: the size of a new design replacing a placeholder (the size of most capes' designs).
const NewDesignSize = 512

// Placeholder reports whether a cape design texture is a placeholder (at most 16 x 16 pixels, e.g. the 4 x 4
// half-float design three capes share): it is replaced by a NewDesignSize design rather than edited.
func Placeholder(in texenc.Info) bool { return in.Width*in.Height <= 16*16 }

// SheetPath is the file of a variant's edited version of texture h of a kind ("sheet", "design", "mask"; unknown:
// "sheet").
func SheetPath(p *project.Project, v project.Variant, h uint64, kind string) string {
	dir := TextureDirs[0].Dir
	for _, td := range TextureDirs {
		if td.Kind == kind {
			dir = td.Dir
		}
	}
	return filepath.Join(p.VariantDir(v), dir, lut.HashString(h)+".png")
}

// sheetFile: the file for ?variant= and ?kind=sheet|design|mask
func (s *Server) sheetFile(r *http.Request, h uint64) (string, error) {
	p, err := s.project()
	if err != nil {
		return "", err
	}
	folder := r.URL.Query().Get("variant")
	for _, v := range p.Variants {
		if v.Folder == folder {
			return SheetPath(p, v, h, r.URL.Query().Get("kind")), nil
		}
	}
	return "", fmt.Errorf("no variant %q", folder)
}

// lstx is a texture in the preview's wire format (RGBA8; layers > 1: img holds them stacked top to bottom).
func lstx(img *image.NRGBA, layers int) []byte {
	b := img.Bounds()
	out := []byte("LSTX")
	for _, v := range []int{b.Dx(), b.Dy() / layers, layers, 0} {
		out = binary.LittleEndian.AppendUint32(out, uint32(v))
	}
	return append(out, img.Pix...)
}

// editedTex: the variant's edited version of texture h for /api/tex, if any
func (s *Server) editedTex(r *http.Request, h uint64) []byte {
	if r.URL.Query().Get("variant") == "" {
		return nil
	}
	p, err := s.project()
	if err != nil {
		return nil
	}
	var b []byte
	for _, v := range p.Variants {
		if v.Folder != r.URL.Query().Get("variant") {
			continue
		}
		for _, td := range TextureDirs {
			if b, err = os.ReadFile(SheetPath(p, v, h, td.Kind)); err == nil {
				break
			}
		}
	}
	if b == nil {
		return nil
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	layers := 1 // a texture array (an ID mask): its layers, stacked in the image
	if main, _, err := s.game().ReadTexture(h); err == nil {
		if in, err := texenc.ReadInfo(main); err == nil && in.Layers > 1 && img.Bounds().Dy() == in.Height*in.Layers {
			layers = in.Layers
		}
	}
	return lstx(texenc.ToNRGBA(img), layers)
}

// GET /api/sheet?hash=&variant=&kind=: the sheet as PNG (the variant's edited one, else the game's), with
// X-Edited: 1|0
func (s *Server) sheetGet(w http.ResponseWriter, r *http.Request) {
	h, err := hashParam(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	f, err := s.sheetFile(r, h)
	if err != nil {
		fail(w, 400, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	if b, err := os.ReadFile(f); err == nil {
		w.Header().Set("X-Edited", "1")
		w.Write(b)
		return
	}
	blob, err := s.assetsOf().TextureBlob(h)
	if err != nil || len(blob) < 20 || binary.LittleEndian.Uint32(blob[16:]) != 0 {
		fail(w, 404, fmt.Errorf("texture %s: no RGBA image", lut.HashString(h)))
		return
	}
	tw, th := int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:]))
	if tw <= 0 || th <= 0 || tw > 1<<14 || th > 1<<16 || len(blob) < 20+tw*th*4 { // (a cut-short cache file)
		fail(w, 404, fmt.Errorf("texture %s: incomplete image data", lut.HashString(h)))
		return
	}
	img := &image.NRGBA{Pix: blob[20 : 20+tw*th*4], Stride: tw * 4, Rect: image.Rect(0, 0, tw, th)}
	var out bytes.Buffer
	png.Encode(&out, img)
	w.Header().Set("X-Edited", "0")
	w.Write(out.Bytes())
}

// PUT /api/sheet?hash=&variant=&kind= (PNG, or raw RGBA8 as LSTX): the variant's edited texture; it must be the game texture's size, and
// in a format the build can write (texenc.Supported)
func (s *Server) sheetPut(w http.ResponseWriter, r *http.Request) {
	h, err := hashParam(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	f, err := s.sheetFile(r, h)
	if err != nil {
		fail(w, 400, err)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 128<<20))
	if err != nil {
		fail(w, 400, err)
		return
	}
	var img image.Image
	if bytes.HasPrefix(b, []byte("LSTX")) && len(b) >= 20 { // raw RGBA8 (the editors: colors under zero alpha kept)
		tw, th := int(binary.LittleEndian.Uint32(b[4:])), int(binary.LittleEndian.Uint32(b[8:]))
		if tw <= 0 || th <= 0 || tw > 1<<14 || th > 1<<16 || len(b) != 20+tw*th*4 {
			fail(w, 400, fmt.Errorf("bad LSTX body"))
			return
		}
		img = &image.NRGBA{Pix: b[20:], Stride: tw * 4, Rect: image.Rect(0, 0, tw, th)}
		var out bytes.Buffer
		png.Encode(&out, img)
		b = out.Bytes()
	} else if img, err = png.Decode(bytes.NewReader(b)); err != nil {
		fail(w, 400, fmt.Errorf("not a PNG: %w", err))
		return
	}
	main, _, err := s.game().ReadTexture(h)
	if err != nil {
		fail(w, 404, err)
		return
	}
	in, err := texenc.ReadInfo(main)
	if err != nil {
		fail(w, 422, err)
		return
	}
	// a cape whose design is a placeholder (a few pixels: one zone everywhere) gets a whole new design of its own
	// size (Placeholder; the build writes it as a texture of that size, main.go sheetResource)
	if r.URL.Query().Get("kind") == "design" && Placeholder(in) {
		if bb := img.Bounds(); bb.Dx() != NewDesignSize || bb.Dy() != NewDesignSize {
			fail(w, 400, fmt.Errorf("a new design is %d x %d", NewDesignSize, NewDesignSize))
			return
		}
	} else if !texenc.Supported(in.DXGI) {
		fail(w, 422, fmt.Errorf("this texture's format (%d) can't be replaced yet (RGBA8, BC3 and BC7 can)", in.DXGI))
		return
	} else if bb := img.Bounds(); bb.Dx() != in.Width || bb.Dy() != in.Height*in.Layers { // (an array: layers stacked)
		fail(w, 400, fmt.Errorf("the image is %dx%d, the texture %dx%d (%d layer(s))", bb.Dx(), bb.Dy(), in.Width, in.Height, in.Layers))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
		fail(w, 500, err)
		return
	}
	if err := os.WriteFile(f, b, 0o644); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"saved": strconv.Itoa(len(b))})
}

// DELETE /api/sheet?hash=&variant=&kind=: back to the game's sheet
func (s *Server) sheetDelete(w http.ResponseWriter, r *http.Request) {
	h, err := hashParam(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	f, err := s.sheetFile(r, h)
	if err != nil {
		fail(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
		fail(w, 500, err)
		return
	}
	writeJSON(w, "ok")
}
