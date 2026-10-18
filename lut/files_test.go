package lut

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"testing"
)

func sampleLUT() *Texture {
	t := New(MaterialWidth, 3)
	for i := range t.Px {
		t.Px[i] = Round(float32(i%97)*0.137 - 3.1)
	}
	return t
}

// a LUT out as .dds and .exr and read back: the same values (both keep half floats exactly)
func TestFileRoundTrip(t *testing.T) {
	src := sampleLUT()
	for name, b := range map[string][]byte{"dds": src.FileDDS(), "exr": src.FileEXR()} {
		got, err := ReadFile(b)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !got.Equal(src) {
			t.Errorf("%s: read back differs", name)
		}
	}
	if _, err := ReadFile([]byte("PNG...")); err == nil {
		t.Error("a non-LUT file was read")
	}
}

// an .exr with ZIP compression (as image tools save it): its 16-line blocks unpacked
func TestReadEXRZip(t *testing.T) {
	src := sampleLUT()
	plain := src.FileEXR()
	// the same file with compression 3 (ZIP): one block, the predictor and interleave applied, then zlib
	i := bytes.Index(plain, []byte("compression\x00compression\x00"))
	b := append([]byte(nil), plain...)
	b[i+len("compression\x00compression\x00")+4] = 3
	hdrEnd := bytes.Index(b, []byte("screenWindowWidth\x00float\x00")) + len("screenWindowWidth\x00float\x00") + 4 + 4 + 1
	var raw []byte
	lineSize := src.Width * 8
	for y := 0; y < src.Height; y++ {
		off := int(binary.LittleEndian.Uint64(plain[hdrEnd+8*y:]))
		raw = append(raw, plain[off+8:off+8+lineSize]...)
	}
	half := (len(raw) + 1) / 2
	t2 := make([]byte, len(raw))
	for k := range raw {
		if k%2 == 0 {
			t2[k/2] = raw[k]
		} else {
			t2[half+k/2] = raw[k]
		}
	}
	for k := len(t2) - 1; k > 0; k-- {
		t2[k] = byte(int(t2[k]) - int(t2[k-1]) + 128)
	}
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write(t2)
	zw.Close()
	out := append([]byte(nil), b[:hdrEnd]...)
	out = binary.LittleEndian.AppendUint64(out, uint64(hdrEnd+8))
	out = binary.LittleEndian.AppendUint32(out, 0)
	out = binary.LittleEndian.AppendUint32(out, uint32(z.Len()))
	out = append(out, z.Bytes()...)
	got, err := ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(src) {
		t.Error("ZIP .exr read back differs")
	}
}
