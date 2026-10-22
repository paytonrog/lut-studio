// Package lut reads and writes HD2 material / pattern LUT textures and maps their texels to named fields.
//
// Format: a Stingray texture whose main data is a 0xC0-byte block
// (u32 0, u32 0, u32 0xFFFFFFFF, zero mip table: the texture does not stream) followed by a 148-byte DDS header with
// the DX10 extension, DXGI_FORMAT_R16G16B16A16_FLOAT. Pixels (the whole mip chain) are the GPU data. The header is
// the same for every LUT of a size, so Encode builds it instead of copying game bytes. The shader reads only mip 0
// (integer texel loads), so the lower mips are plain box filters (the game's own differ slightly; never read).
package lut

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/x448/float16"
)

const (
	dxgiRGBA16Float = 10
	dxgiRGBA32Float = 2
	headerOffset    = 0xC0
	ddsHeaderSize   = 148
	MainSize        = headerOffset + ddsHeaderSize // 340
)

// ddsTemplate is the DDS header every LUT carries (NVTT-written); width, height and mip count are filled in.
var ddsTemplate = [ddsHeaderSize]byte{
	'D', 'D', 'S', ' ', 0x7c, 0, 0, 0, 0x07, 0x10, 0x02, 0, // magic, size 124, flags 0x21007
	// +12 height, +16 width, +20 pitch, +24 depth, +28 mip count: filled in
	// reserved1 (+32): "UVER" 0 "NVTT" version 0x00020100 (as the game's files)
	60: 'U', 'V', 'E', 'R', 0, 0, 0, 0, 'N', 'V', 'T', 'T', 0x00, 0x01, 0x02, 0x00,
	// pixel format: size 32, DDPF_FOURCC, "DX10"
	76: 0x20, 0, 0, 0, 0x04, 0, 0, 0, 'D', 'X', '1', '0',
	// caps 0x401008 (texture, mipmap, complex)
	108: 0x08, 0x10, 0x40, 0,
	// DX10: format 10, TEXTURE2D, misc 0, array size 1, misc2 0
	128: dxgiRGBA16Float, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
}

// Texture is a LUT's mip 0: Width x Height texels of 4 channels, row-major, as float32 (exactly representable
// half floats).
type Texture struct {
	Width, Height int
	Px            []float32
}

func New(w, h int) *Texture { return &Texture{Width: w, Height: h, Px: make([]float32, w*h*4)} }

// At returns channel ch of texel (x, y).
func (t *Texture) At(x, y, ch int) float32 { return t.Px[(y*t.Width+x)*4+ch] }

// Set stores v rounded to half precision.
func (t *Texture) Set(x, y, ch int, v float32) { t.Px[(y*t.Width+x)*4+ch] = Round(v) }

// Round returns v as the game will store it (nearest half float).
func Round(v float32) float32 {
	return float16.Fromfloat32(max(-65504, min(65504, v))).Float32() // (past the half range it would be Inf, which JSON can't hold)
}

func mipCount(w, h int) int {
	n := 1
	for m := max(w, h); m > 1; m >>= 1 {
		n++
	}
	return n
}

// Decode reads a LUT texture resource (main and GPU data).
func Decode(main, gpu []byte) (*Texture, error) {
	if len(main) < MainSize || string(main[headerOffset:headerOffset+4]) != "DDS " {
		return nil, fmt.Errorf("not a texture resource (main data %d bytes)", len(main))
	}
	dds := main[headerOffset:]
	h := int(binary.LittleEndian.Uint32(dds[12:]))
	w := int(binary.LittleEndian.Uint32(dds[16:]))
	if w < 1 || h < 1 || w > 4096 || h > 4096 || w*h > 1<<20 { // (before allocating: a broken mod's header)
		return nil, fmt.Errorf("%d x %d is not a LUT size", w, h)
	}
	t := New(w, h)
	switch f := binary.LittleEndian.Uint32(dds[128:]); f {
	case dxgiRGBA16Float: // the game's LUTs
		if len(gpu) < w*h*8 {
			return nil, fmt.Errorf("GPU data %d bytes, %dx%d needs %d", len(gpu), w, h, w*h*8)
		}
		for i := range t.Px {
			t.Px[i] = float16.Frombits(binary.LittleEndian.Uint16(gpu[2*i:])).Float32()
		}
	case dxgiRGBA32Float: // some mods' LUTs (exported as 32-bit floats; the game reads them too): kept as halves
		if len(gpu) < w*h*16 {
			return nil, fmt.Errorf("GPU data %d bytes, %dx%d needs %d", len(gpu), w, h, w*h*16)
		}
		for i := range t.Px {
			t.Px[i] = Round(math.Float32frombits(binary.LittleEndian.Uint32(gpu[4*i:])))
		}
	default:
		return nil, fmt.Errorf("DXGI format %d, a LUT is %d (R16G16B16A16_FLOAT) or %d (R32G32B32A32_FLOAT)", f, dxgiRGBA16Float, dxgiRGBA32Float)
	}
	for i, v := range t.Px { // values JSON can't hold (a mod's NaN, or a float past the half range): finite
		switch {
		case math.IsNaN(float64(v)):
			t.Px[i] = 0
		case math.IsInf(float64(v), 1):
			t.Px[i] = 65504
		case math.IsInf(float64(v), -1):
			t.Px[i] = -65504
		}
	}
	return t, nil
}

// Encode writes the texture resource: main data (header) and GPU data (mip chain).
func (t *Texture) Encode() (main, gpu []byte) {
	main = make([]byte, MainSize)
	binary.LittleEndian.PutUint32(main[8:], 0xFFFFFFFF)
	dds := main[headerOffset:]
	copy(dds, ddsTemplate[:])
	n := mipCount(t.Width, t.Height)
	binary.LittleEndian.PutUint32(dds[12:], uint32(t.Height))
	binary.LittleEndian.PutUint32(dds[16:], uint32(t.Width))
	binary.LittleEndian.PutUint32(dds[28:], uint32(n))

	level, w, h := t.Px, t.Width, t.Height
	for i := 0; i < n; i++ {
		for _, v := range level {
			gpu = binary.LittleEndian.AppendUint16(gpu, float16.Fromfloat32(v).Bits())
		}
		level, w, h = halve(level, w, h)
	}
	return main, gpu
}

// halve box-filters one mip level (odd sizes: the last column / row is averaged with what exists).
func halve(px []float32, w, h int) ([]float32, int, int) {
	nw, nh := max(1, w/2), max(1, h/2)
	out := make([]float32, nw*nh*4)
	for y := 0; y < nh; y++ {
		for x := 0; x < nw; x++ {
			for c := 0; c < 4; c++ {
				var s float64
				k := 0
				for dy := 0; dy < 2; dy++ {
					for dx := 0; dx < 2; dx++ {
						sx, sy := 2*x+dx, 2*y+dy
						if sx < w && sy < h {
							s += float64(px[(sy*w+sx)*4+c])
							k++
						}
					}
				}
				out[(y*nw+x)*4+c] = float32(s / float64(k))
			}
		}
	}
	return out, nw, nh
}

// Equal reports whether two textures have the same size and texels (bitwise; NaN never appears in real LUTs).
func (t *Texture) Equal(o *Texture) bool {
	if t.Width != o.Width || t.Height != o.Height {
		return false
	}
	for i, v := range t.Px {
		if math.Float32bits(v) != math.Float32bits(o.Px[i]) {
			return false
		}
	}
	return true
}
