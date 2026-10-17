package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/xypwn/filediver/dds"

	"lutstudio/game"
	"lutstudio/texenc"
)

// An edited decal sheet or cape design becomes the game texture it replaces: textures with all mips in the GPU data
// and with the mips in the stream data (the smallest also in the GPU data), in RGBA8, BC3 and BC7, re-encoded from
// their own pixels, keep the original's header and part sizes and decode close to the original.
func TestSheetResource(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := game.Open(gameDir)
	if err != nil {
		t.Fatal(err)
	}
	a := game.NewAssets(g, t.TempDir())
	for _, c := range []struct {
		h        uint64
		straight bool
	}{
		{0x7ac0a9ca7c966370, false}, {0xe31836670db264a4, false}, // decal sheets: BC3, both layouts
		{0x047378238557e9bc, true}, {0x0f26a0dd67fa1992, true}, // cape designs: RGBA8, both layouts
		{0x2d5e1c6d425d141b, true}, {0x33fbd2ee3cabe704, true}, //   BC7, BC3
	} {
		h := c.h
		blob, err := a.TextureBlob(h)
		if err != nil {
			t.Fatal(err)
		}
		w, hh := int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:]))
		orig := &image.NRGBA{Pix: blob[20 : 20+w*hh*4], Stride: w * 4, Rect: image.Rect(0, 0, w, hh)}
		file := filepath.Join(t.TempDir(), "0x"+hex16(h)+".png")
		var b bytes.Buffer
		png.Encode(&b, orig)
		os.WriteFile(file, b.Bytes(), 0o644)
		res, err := sheetResource(g, nil, file, c.straight)
		if err != nil {
			t.Fatalf("%016x: %v", h, err)
		}
		main, stream, gpu, _ := g.ReadTextureParts(h)
		if !bytes.Equal(res.Main, main) || len(res.Stream) != len(stream) || len(res.GPU) != len(gpu) {
			t.Fatalf("%016x: layout %d/%d/%d, the game's %d/%d/%d", h, len(res.Main), len(res.Stream), len(res.GPU), len(main), len(stream), len(gpu))
		}
		chain := res.GPU
		if len(res.Stream) > len(chain) {
			chain = res.Stream
		}
		tex, err := dds.Decode(bytes.NewReader(append(append([]byte(nil), res.Main[0xC0:]...), chain...)), false)
		if err != nil {
			t.Fatal(err)
		}
		got := texenc.ToNRGBA(tex.Image)
		var sum float64
		for i := range orig.Pix {
			sum += math.Abs(float64(orig.Pix[i]) - float64(got.Pix[i]))
		}
		if mean := sum / float64(len(orig.Pix)); mean > 2 {
			t.Errorf("%016x: re-encoded sheet differs from the game's by %.2f on average", h, mean)
		}
	}
}

func hex16(h uint64) string {
	const digits = "0123456789abcdef"
	var b [16]byte
	for i := 15; i >= 0; i-- {
		b[i] = digits[h&15]
		h >>= 4
	}
	return string(b[:])
}

// A placeholder design (the 4 x 4 half-float one three capes share) replaced by a 512 x 512 design becomes a 512 x
// 512 RGBA8 texture under the placeholder's name, with the header of a game design of that size, and decodes back.
func TestPlaceholderDesign(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(t.TempDir(), "cache"))
	e := &env{out: io.Discard, gameDir: gameDir}
	idx, err := e.index()
	if err != nil {
		t.Fatal(err)
	}
	g, _ := e.game()
	const placeholder = 0xd1114c147542963a
	img := image.NewNRGBA(image.Rect(0, 0, 512, 512))
	for y := 0; y < 512; y++ {
		for x := 0; x < 512; x++ {
			r := uint8(0)
			if x > 256 {
				r = 255
			}
			copy(img.Pix[img.PixOffset(x, y):], []byte{r, 0, 0, 255})
		}
	}
	file := filepath.Join(t.TempDir(), "0x"+hex16(placeholder)+".png")
	var b bytes.Buffer
	png.Encode(&b, img)
	os.WriteFile(file, b.Bytes(), 0o644)
	res, err := sheetResource(g, idx, file, true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Name != placeholder || len(res.Stream) != 0 || len(res.GPU) != 1398100 {
		t.Fatalf("resource %016x: stream %d, gpu %d", res.Name, len(res.Stream), len(res.GPU))
	}
	in, _ := texenc.ReadInfo(res.Main)
	if in.Width != 512 || in.Height != 512 || in.DXGI != 28 || in.Mips != 10 {
		t.Fatalf("header: %+v", in)
	}
	tex, err := dds.Decode(bytes.NewReader(append(append([]byte(nil), res.Main[0xC0:]...), res.GPU...)), false)
	if err != nil {
		t.Fatal(err)
	}
	got := texenc.ToNRGBA(tex.Image)
	if !bytes.Equal(got.Pix, img.Pix) {
		t.Error("the new design doesn't decode to its pixels")
	}
}

// An ID mask with two layers (a texture array) re-encoded from its own pixels (layers stacked top to bottom, as
// the editor saves them) keeps the game's header and layout, and both layers decode back exactly (RGBA8).
func TestMaskArray(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := game.Open(gameDir)
	if err != nil {
		t.Fatal(err)
	}
	const mask = 0x0e4cc8767cd6067a // 256 x 256, 2 layers
	a := game.NewAssets(g, t.TempDir())
	blob, err := a.TextureBlob(mask)
	if err != nil {
		t.Fatal(err)
	}
	w, h, layers := int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:])), int(binary.LittleEndian.Uint32(blob[12:]))
	if layers != 2 {
		t.Skipf("mask has %d layers in this install", layers)
	}
	stacked := &image.NRGBA{Pix: blob[20 : 20+w*h*4*layers], Stride: w * 4, Rect: image.Rect(0, 0, w, h*layers)}
	file := filepath.Join(t.TempDir(), "0x"+hex16(mask)+".png")
	var b bytes.Buffer
	png.Encode(&b, stacked)
	os.WriteFile(file, b.Bytes(), 0o644)
	res, err := sheetResource(g, nil, file, true)
	if err != nil {
		t.Fatal(err)
	}
	main, stream, gpu, _ := g.ReadTextureParts(mask)
	if !bytes.Equal(res.Main, main) || len(res.Stream) != len(stream) || len(res.GPU) != len(gpu) {
		t.Fatalf("layout %d/%d/%d, the game's %d/%d/%d", len(res.Main), len(res.Stream), len(res.GPU), len(main), len(stream), len(gpu))
	}
	tex, err := dds.Decode(bytes.NewReader(append(append([]byte(nil), res.Main[0xC0:]...), res.GPU...)), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(tex.Images) != 2 {
		t.Fatalf("%d layers decoded", len(tex.Images))
	}
	for l, im := range tex.Images {
		got := texenc.ToNRGBA(im.MipMaps[0].Image)
		if !bytes.Equal(got.Pix, stacked.Pix[l*w*h*4:(l+1)*w*h*4]) {
			t.Errorf("layer %d doesn't decode to its pixels", l)
		}
	}
}
