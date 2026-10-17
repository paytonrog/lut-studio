package texenc

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"math"
	"testing"

	"github.com/xypwn/filediver/dds"
)

// a gradient with a soft-edged disc (color and alpha change across blocks)
func testImage(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := float64(x-w/2), float64(y-h/2)
			a := 255 - min(255, int(math.Hypot(dx, dy)*255/float64(w/2)))
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 255 / w), uint8(y * 255 / h), 200, uint8(max(0, a))})
		}
	}
	return img
}

// main data like the game's textures: 0xC0 bytes, then a DDS header (DX10) of the size, mip count and format
func testMain(w, h, mips, dxgi int) []byte {
	m := make([]byte, headerOffset+148)
	d := m[headerOffset:]
	copy(d, "DDS ")
	le := binary.LittleEndian
	le.PutUint32(d[4:], 124)
	le.PutUint32(d[8:], 0x1|0x2|0x4|0x1000|0x20000)
	le.PutUint32(d[12:], uint32(h))
	le.PutUint32(d[16:], uint32(w))
	le.PutUint32(d[28:], uint32(mips))
	le.PutUint32(d[76:], 32)
	le.PutUint32(d[80:], 0x4)
	copy(d[84:], "DX10")
	le.PutUint32(d[108:], 0x1000|0x400000)
	le.PutUint32(d[128:], uint32(dxgi))
	le.PutUint32(d[132:], 3)
	le.PutUint32(d[140:], 1)
	return m
}

// In each format (RGBA8, BC3, BC7) the encoded texture decodes (filediver's DDS reader) close to the source image,
// and Replace keeps both layouts the game uses.
func TestReplace(t *testing.T) {
	const w, h, mips = 256, 256, 7
	img := testImage(w, h)
	for _, f := range []struct {
		dxgi       int
		mean, maxd float64
	}{{dxgiRGBA8, 0, 0}, {dxgiBC3, 3, 40}, {dxgiBC7, 2, 24}} {
		main := testMain(w, h, mips, f.dxgi)
		chain := MipChain(img, mips, f.dxgi, false)
		// the whole chain in the GPU part, or in the stream part with the last two mips also in the GPU part
		tail := levelSize(f.dxgi, 8, 8) + levelSize(f.dxgi, 4, 4)
		for _, c := range []struct {
			name        string
			stream, gpu []byte
		}{{"gpu", nil, chain}, {"stream", chain, chain[len(chain)-tail:]}} {
			_, s, g, err := Replace(main, c.stream, c.gpu, img, false)
			if err != nil {
				t.Fatalf("%d %s: %v", f.dxgi, c.name, err)
			}
			if len(s) != len(c.stream) || len(g) != len(c.gpu) {
				t.Fatalf("%d %s: sizes %d/%d, want %d/%d", f.dxgi, c.name, len(s), len(g), len(c.stream), len(c.gpu))
			}
		}
		tex, err := dds.Decode(bytes.NewReader(append(main[headerOffset:], chain...)), false)
		if err != nil {
			t.Fatalf("%d: %v", f.dxgi, err)
		}
		got := ToNRGBA(tex.Image)
		var maxd, sum float64
		for i := range img.Pix {
			d := math.Abs(float64(img.Pix[i]) - float64(got.Pix[i]))
			if img.Pix[i|3] == 0 && i&3 != 3 {
				continue // color under zero alpha is free
			}
			maxd, sum = max(maxd, d), sum+d
		}
		if mean := sum / float64(len(img.Pix)); mean > f.mean || maxd > f.maxd {
			t.Errorf("format %d: decoded differs from the source: mean %.2f max %.0f", f.dxgi, mean, maxd)
		} else {
			t.Logf("format %d: mean %.2f max %.0f", f.dxgi, mean, maxd)
		}
	}
	// a texture of another format is refused
	other := testMain(w, h, mips, 71)
	if _, _, _, err := Replace(other, nil, MipChain(img, mips, dxgiBC3, false), img, false); err == nil {
		t.Error("a BC1 texture was accepted")
	}
}

// straight mips average alpha and color alike; weighted mips keep color under low alpha
func TestHalve(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{200, 0, 0, 255})
	img.SetNRGBA(1, 0, color.NRGBA{0, 0, 0, 0})
	img.SetNRGBA(0, 1, color.NRGBA{0, 0, 0, 0})
	img.SetNRGBA(1, 1, color.NRGBA{0, 0, 0, 0})
	if p := halve(img, true).Pix; p[0] != 50 || p[3] != 64 {
		t.Errorf("straight: %v", p)
	}
	if p := halve(img, false).Pix; p[0] != 200 || p[3] != 64 {
		t.Errorf("weighted: %v", p)
	}
}

// One-channel formats (pattern masks): R8 exact, BC4 close; filediver decodes both as gray.
func TestOneChannel(t *testing.T) {
	const w, h, mips = 128, 128, 6
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := uint8(min(255, int(math.Hypot(float64(x-64), float64(y-64))*3)))
			img.SetNRGBA(x, y, color.NRGBA{v, v, v, 255})
		}
	}
	for _, f := range []struct {
		dxgi int
		maxd float64
	}{{dxgiR8, 0}, {dxgiBC4, 12}} {
		main := testMain(w, h, mips, f.dxgi)
		chain := MipChain(img, mips, f.dxgi, true)
		if _, _, _, err := Replace(main, nil, chain, img, true); err != nil {
			t.Fatalf("%d: %v", f.dxgi, err)
		}
		tex, err := dds.Decode(bytes.NewReader(append(main[headerOffset:], chain...)), false)
		if err != nil {
			t.Fatalf("%d: %v", f.dxgi, err)
		}
		got := ToNRGBA(tex.Image)
		var maxd float64
		for i := 0; i < len(img.Pix); i += 4 {
			maxd = max(maxd, math.Abs(float64(img.Pix[i])-float64(got.Pix[i])))
		}
		if maxd > f.maxd {
			t.Errorf("format %d: max difference %.0f", f.dxgi, maxd)
		}
	}
}
