package lut

// A LUT as a file of its own, for other tools: a .dds (DXGI R16G16B16A16_FLOAT, the game's own format: exact) or an
// OpenEXR .exr (half-float R, G, B, A channels, uncompressed: exact too). Reading takes what tools write back: DDS in
// R16G16B16A16 / R32G32B32A32 float (a DX10 header or the legacy D3DFMT 113 / 116), EXR scanline images with half or
// float channels, uncompressed, RLE, ZIPS or ZIP.

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"

	"github.com/x448/float16"
)

// FileDDS: the texture as a .dds file (mip 0 only; DX10 header, R16G16B16A16_FLOAT).
func (t *Texture) FileDDS() []byte {
	h := ddsTemplate
	binary.LittleEndian.PutUint32(h[8:], 0x1007) // caps, height, width, pixel format (no mip count)
	binary.LittleEndian.PutUint32(h[12:], uint32(t.Height))
	binary.LittleEndian.PutUint32(h[16:], uint32(t.Width))
	binary.LittleEndian.PutUint32(h[28:], 1)
	binary.LittleEndian.PutUint32(h[108:], 0x1000) // DDSCAPS_TEXTURE
	out := append([]byte(nil), h[:]...)
	for _, v := range t.Px {
		out = binary.LittleEndian.AppendUint16(out, float16.Fromfloat32(v).Bits())
	}
	return out
}

// FileEXR: the texture as an OpenEXR file (scanline, uncompressed, half-float A, B, G, R channels).
func (t *Texture) FileEXR() []byte {
	var hdr bytes.Buffer
	attr := func(name, typ string, v []byte) {
		hdr.WriteString(name + "\x00" + typ + "\x00")
		binary.Write(&hdr, binary.LittleEndian, int32(len(v)))
		hdr.Write(v)
	}
	le := func(vs ...any) []byte {
		var b bytes.Buffer
		for _, v := range vs {
			binary.Write(&b, binary.LittleEndian, v)
		}
		return b.Bytes()
	}
	var ch bytes.Buffer
	for _, c := range []string{"A", "B", "G", "R"} { // (channels in name order)
		ch.WriteString(c + "\x00")
		ch.Write(le(int32(1), uint8(0), [3]uint8{}, int32(1), int32(1))) // HALF, linear 0, reserved, x / y sampling 1
	}
	ch.WriteByte(0)
	box := le(int32(0), int32(0), int32(t.Width-1), int32(t.Height-1))
	attr("channels", "chlist", ch.Bytes())
	attr("compression", "compression", []byte{0})
	attr("dataWindow", "box2i", box)
	attr("displayWindow", "box2i", box)
	attr("lineOrder", "lineOrder", []byte{0})
	attr("pixelAspectRatio", "float", le(float32(1)))
	attr("screenWindowCenter", "v2f", le(float32(0), float32(0)))
	attr("screenWindowWidth", "float", le(float32(1)))
	hdr.WriteByte(0)

	out := le(uint32(20000630), uint32(2)) // magic, version 2 (single-part scanline)
	out = append(out, hdr.Bytes()...)
	lineSize := t.Width * 4 * 2
	start := len(out) + 8*t.Height
	for y := 0; y < t.Height; y++ {
		out = binary.LittleEndian.AppendUint64(out, uint64(start+y*(8+lineSize)))
	}
	for y := 0; y < t.Height; y++ {
		out = binary.LittleEndian.AppendUint32(out, uint32(y))
		out = binary.LittleEndian.AppendUint32(out, uint32(lineSize))
		for _, c := range []int{3, 2, 1, 0} {
			for x := 0; x < t.Width; x++ {
				out = binary.LittleEndian.AppendUint16(out, float16.Fromfloat32(t.At(x, y, c)).Bits())
			}
		}
	}
	return out
}

// ReadFile reads a LUT from a .dds or .exr file (by its magic), its values rounded to half floats as the game keeps
// them.
func ReadFile(b []byte) (*Texture, error) {
	var t *Texture
	var err error
	switch {
	case len(b) >= 4 && string(b[:4]) == "DDS ":
		t, err = readDDS(b)
	case len(b) >= 4 && binary.LittleEndian.Uint32(b) == 20000630:
		t, err = readEXR(b)
	default:
		return nil, fmt.Errorf("not a .dds or .exr file")
	}
	if err != nil {
		return nil, err
	}
	for i, v := range t.Px {
		switch {
		case math.IsNaN(float64(v)):
			t.Px[i] = 0
		default:
			t.Px[i] = Round(float32(math.Max(-65504, math.Min(65504, float64(v)))))
		}
	}
	return t, nil
}

func readDDS(b []byte) (*Texture, error) {
	if len(b) < 128 {
		return nil, fmt.Errorf("the .dds file is cut short")
	}
	h, w := int(binary.LittleEndian.Uint32(b[12:])), int(binary.LittleEndian.Uint32(b[16:]))
	if w < 1 || h < 1 || w > 4096 || h > 4096 || w*h > 1<<20 {
		return nil, fmt.Errorf("%d x %d is not a LUT size", w, h)
	}
	data, half := 128, true
	switch fourCC := string(b[84:88]); {
	case fourCC == "DX10":
		if len(b) < 148 {
			return nil, fmt.Errorf("the .dds file is cut short")
		}
		data = 148
		switch f := binary.LittleEndian.Uint32(b[128:]); f {
		case dxgiRGBA16Float:
		case dxgiRGBA32Float:
			half = false
		default:
			return nil, fmt.Errorf("the .dds is DXGI format %d: a LUT is R16G16B16A16_FLOAT (%d) or R32G32B32A32_FLOAT (%d)", f, dxgiRGBA16Float, dxgiRGBA32Float)
		}
	case binary.LittleEndian.Uint32(b[84:]) == 113: // D3DFMT_A16B16G16R16F
	case binary.LittleEndian.Uint32(b[84:]) == 116: // D3DFMT_A32B32G32R32F
		half = false
	default:
		return nil, fmt.Errorf("the .dds isn't RGBA half or float (save it as R16G16B16A16_FLOAT)")
	}
	t := New(w, h)
	size := 2
	if !half {
		size = 4
	}
	if len(b) < data+w*h*4*size {
		return nil, fmt.Errorf("the .dds file is cut short (%d x %d needs %d bytes of pixels)", w, h, w*h*4*size)
	}
	for i := range t.Px {
		if half {
			t.Px[i] = float16.Frombits(binary.LittleEndian.Uint16(b[data+2*i:])).Float32()
		} else {
			t.Px[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[data+4*i:]))
		}
	}
	return t, nil
}

type exrChannel struct {
	name string
	typ  int32 // 0 uint, 1 half, 2 float
}

func readEXR(b []byte) (*Texture, error) {
	if len(b) < 8 {
		return nil, fmt.Errorf("the .exr file is cut short")
	}
	if v := binary.LittleEndian.Uint32(b[4:]); v&0xff != 2 || v&0x200 != 0 || v&0x1000 != 0 || v&0x800 != 0 {
		return nil, fmt.Errorf("only single-part scanline .exr files are read (save it without tiles, layers or deep data)")
	}
	p := 8
	cstr := func() (string, error) {
		i := bytes.IndexByte(b[p:], 0)
		if i < 0 {
			return "", fmt.Errorf("the .exr header is cut short")
		}
		s := string(b[p : p+i])
		p += i + 1
		return s, nil
	}
	var chans []exrChannel
	comp, x0, y0, x1, y1 := -1, 0, 0, -1, -1
	for {
		name, err := cstr()
		if err != nil {
			return nil, err
		}
		if name == "" {
			break
		}
		if _, err := cstr(); err != nil {
			return nil, err
		}
		if p+4 > len(b) {
			return nil, fmt.Errorf("the .exr header is cut short")
		}
		n := int(binary.LittleEndian.Uint32(b[p:]))
		p += 4
		if n < 0 || p+n > len(b) {
			return nil, fmt.Errorf("the .exr header is cut short")
		}
		v := b[p : p+n]
		p += n
		switch name {
		case "channels":
			for q := 0; q < len(v) && v[q] != 0; {
				i := bytes.IndexByte(v[q:], 0)
				if i < 0 || q+i+17 > len(v) {
					return nil, fmt.Errorf("the .exr channel list is broken")
				}
				c := exrChannel{name: string(v[q : q+i]), typ: int32(binary.LittleEndian.Uint32(v[q+i+1:]))}
				if xs, ys := binary.LittleEndian.Uint32(v[q+i+9:]), binary.LittleEndian.Uint32(v[q+i+13:]); xs != 1 || ys != 1 {
					return nil, fmt.Errorf("the .exr channel %s is subsampled", c.name)
				}
				chans = append(chans, c)
				q += i + 17
			}
		case "compression":
			if len(v) > 0 {
				comp = int(v[0])
			}
		case "dataWindow":
			if len(v) >= 16 {
				x0, y0 = int(int32(binary.LittleEndian.Uint32(v))), int(int32(binary.LittleEndian.Uint32(v[4:])))
				x1, y1 = int(int32(binary.LittleEndian.Uint32(v[8:]))), int(int32(binary.LittleEndian.Uint32(v[12:])))
			}
		}
	}
	w, h := x1-x0+1, y1-y0+1
	if w < 1 || h < 1 || w > 4096 || h > 4096 || w*h > 1<<20 {
		return nil, fmt.Errorf("%d x %d is not a LUT size", w, h)
	}
	lines := map[int]int{0: 1, 1: 1, 2: 1, 3: 16}[comp]
	if lines == 0 {
		return nil, fmt.Errorf("the .exr's compression (%d) isn't read: save it uncompressed, RLE, ZIP or ZIPS", comp)
	}
	// R, G, B, A: by the channel's last name part (a layer's "layer.R" too)
	want := map[string]int{"R": 0, "G": 1, "B": 2, "A": 3}
	found := [4]bool{}
	for _, c := range chans {
		if i, ok := want[c.name[strings.LastIndex(c.name, ".")+1:]]; ok {
			found[i] = true
		}
	}
	if slices.Contains(found[:], false) {
		return nil, fmt.Errorf("the .exr needs R, G, B and A channels (a LUT uses all four)")
	}
	t := New(w, h)
	blocks := (h + lines - 1) / lines
	if p+8*blocks > len(b) {
		return nil, fmt.Errorf("the .exr file is cut short")
	}
	for k := 0; k < blocks; k++ {
		off := int(binary.LittleEndian.Uint64(b[p+8*k:]))
		if off < 0 || off+8 > len(b) {
			return nil, fmt.Errorf("the .exr file is cut short")
		}
		y := int(int32(binary.LittleEndian.Uint32(b[off:]))) - y0
		n := int(binary.LittleEndian.Uint32(b[off+4:]))
		if n < 0 || off+8+n > len(b) {
			return nil, fmt.Errorf("the .exr file is cut short")
		}
		rows := min(lines, h-y)
		if y < 0 || rows < 1 {
			return nil, fmt.Errorf("the .exr has a block outside its image")
		}
		size := 0
		for _, c := range chans {
			size += w * map[int32]int{0: 4, 1: 2, 2: 4}[c.typ]
		}
		size *= rows
		data, err := exrUnpack(comp, b[off+8:off+8+n], size)
		if err != nil {
			return nil, err
		}
		q := 0
		for r := 0; r < rows; r++ {
			for _, c := range chans {
				i, ok := want[c.name[strings.LastIndex(c.name, ".")+1:]]
				for x := 0; x < w; x++ {
					var v float32
					switch c.typ {
					case 1:
						v = float16.Frombits(binary.LittleEndian.Uint16(data[q:])).Float32()
						q += 2
					case 2:
						v = math.Float32frombits(binary.LittleEndian.Uint32(data[q:]))
						q += 4
					default:
						v = float32(binary.LittleEndian.Uint32(data[q:]))
						q += 4
					}
					if ok {
						t.Px[((y+r)*w+x)*4+i] = v
					}
				}
			}
		}
	}
	return t, nil
}

// exrUnpack: a block's pixel bytes (size of them) from its compressed data
func exrUnpack(comp int, in []byte, size int) ([]byte, error) {
	if comp == 0 || len(in) == size { // (uncompressed, or a block compression didn't shrink: stored as it is)
		if len(in) < size {
			return nil, fmt.Errorf("the .exr file is cut short")
		}
		return in, nil
	}
	var t []byte
	switch comp {
	case 1: // RLE
		for i := 0; i < len(in); {
			n := int(int8(in[i]))
			i++
			if n < 0 {
				if i-n > len(in) {
					return nil, fmt.Errorf("the .exr's RLE data is broken")
				}
				t = append(t, in[i:i-n]...)
				i -= n
			} else {
				if i >= len(in) {
					return nil, fmt.Errorf("the .exr's RLE data is broken")
				}
				for k := 0; k <= n; k++ {
					t = append(t, in[i])
				}
				i++
			}
		}
	default: // ZIPS, ZIP
		r, err := zlib.NewReader(bytes.NewReader(in))
		if err != nil {
			return nil, fmt.Errorf("the .exr's ZIP data: %v", err)
		}
		t, err = io.ReadAll(io.LimitReader(r, int64(size)+1))
		if err != nil {
			return nil, fmt.Errorf("the .exr's ZIP data: %v", err)
		}
	}
	if len(t) != size {
		return nil, fmt.Errorf("the .exr's block holds %d bytes, its pixels %d", len(t), size)
	}
	// the predictor, then the two halves interleaved back
	for i := 1; i < len(t); i++ {
		t[i] = byte(int(t[i-1]) + int(t[i]) - 128)
	}
	out := make([]byte, size)
	half := (size + 1) / 2
	for i := 0; i < size; i++ {
		if i%2 == 0 {
			out[i] = t[i/2]
		} else {
			out[i] = t[half+i/2]
		}
	}
	return out, nil
}
