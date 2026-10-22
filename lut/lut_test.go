package lut

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Real LUTs extracted from the install ($LUTSTUDIO_LUTS: a folder of 0x….texture.main / .gpu files; game-derived,
// never committed); tests using them skip without it.
var extracted = os.Getenv("LUTSTUDIO_LUTS")

func TestSchemaCoversEveryChannelOnce(t *testing.T) {
	for name, s := range map[string]struct {
		fields []Field
		width  int
	}{"material": {Material, MaterialWidth}, "pattern": {Pattern, PatternWidth}, "cape": {Cape, CapeWidth}} {
		seen := map[Leaf]string{}
		for _, f := range s.fields {
			if f.Kind == Recipe && len(f.Sub) != len(f.Leaves) {
				t.Errorf("%s %s: %d names for %d leaves", name, f.Path(), len(f.Sub), len(f.Leaves))
			}
			for _, lf := range f.Leaves {
				if prev, dup := seen[lf]; dup {
					t.Errorf("%s: column %d channel %d in both %s and %s", name, lf.Col, lf.Ch, prev, f.Path())
				}
				seen[lf] = f.Path()
			}
		}
		if len(seen) != s.width*4 {
			t.Errorf("%s: %d of %d channels named", name, len(seen), s.width*4)
		}
	}
}

func luts(t *testing.T) []string {
	fs, _ := filepath.Glob(filepath.Join(extracted, "0x*.texture.main"))
	if len(fs) == 0 {
		t.Skip("no extracted LUT textures (" + extracted + ")")
	}
	return fs
}

// Every vanilla LUT: decode -> document -> JSON -> document -> encode gives the game's own header and mip-0 bytes.
func TestRoundTripVanilla(t *testing.T) {
	n := 0
	for _, f := range luts(t) {
		main, _ := os.ReadFile(f)
		gpu, _ := os.ReadFile(strings.TrimSuffix(f, ".main") + ".gpu")
		tex, err := Decode(main, gpu)
		if err != nil {
			continue // not a LUT (other textures share the folder)
		}
		kind, err := KindOf(tex)
		if err != nil {
			continue
		}
		name := strings.TrimSuffix(filepath.Base(f), ".texture.main")
		doc := &Document{LUT: name, Kind: kind, Tex: tex}
		js, err := doc.MarshalJSON()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var back Document
		if err := json.Unmarshal(js, &back); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, js)
		}
		if !back.Tex.Equal(tex) {
			t.Fatalf("%s: texels changed in the JSON round trip", name)
		}
		m2, g2 := back.Tex.Encode()
		if !bytes.Equal(m2, main) {
			t.Fatalf("%s: header differs from the game's\nours %x\ngame %x", name, m2, main)
		}
		if len(g2) != len(gpu) || !bytes.Equal(g2[:tex.Width*tex.Height*8], gpu[:tex.Width*tex.Height*8]) {
			t.Fatalf("%s: GPU data differs (len %d vs %d)", name, len(g2), len(gpu))
		}
		n++
	}
	t.Logf("%d LUTs round-tripped", n)
	if n < 300 {
		t.Errorf("only %d LUTs found", n)
	}
}

func TestParseErrorsAreSpecific(t *testing.T) {
	tex := New(MaterialWidth, 1)
	doc := &Document{LUT: "0x0000000000000001", Kind: "material", Tex: tex}
	js, _ := doc.MarshalJSON()
	broken := strings.Replace(string(js), `"roughness": 0,`, `"roughnes": 0,`, 1)
	broken = strings.Replace(broken, `"color": [0, 0, 0]`, `"color": "#ff8000"`, 1)
	var back Document
	err := json.Unmarshal([]byte(broken), &back)
	if err == nil {
		t.Fatal("typo accepted")
	}
	msg := err.Error()
	for _, want := range []string{"secondary.roughness: missing", "secondary.roughnes: unknown field"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error lacks %q:\n%s", want, msg)
		}
	}
}

func TestHexColor(t *testing.T) {
	v, err := parseHex("#ff8000")
	if err != nil || v[0] != 1 || v[2] != 0 || v[1] < 0.5 || v[1] > 0.51 {
		t.Fatalf("%v %v", v, err)
	}
}

func TestNumShortest(t *testing.T) {
	for _, c := range []struct {
		in   float32
		want string
	}{{0.5, "0.5"}, {Round(0.1), "0.1"}, {Round(0.1992), "0.1992"}, {4, "4"}, {-1, "-1"}, {Round(381.5), "381.5"}} {
		if got := Num(c.in); got != c.want {
			t.Errorf("Num(%v) = %s, want %s", c.in, got, c.want)
		}
	}
}

// A hd2-lut/1 document (old field names) reads back to the same texels.
func TestMigrateV1(t *testing.T) {
	tex := New(MaterialWidth, 2)
	for i := range tex.Px {
		tex.Px[i] = float32(i % 4) // whole numbers: valid for every field, layers and modes included
	}
	js, _ := (&Document{LUT: "0x0000000000000001", Kind: "material", Tex: tex}).MarshalJSON()
	old := string(js)
	for _, r := range [][2]string{{`"hd2-lut/2"`, `"hd2-lut/1"`}, {`"roughness_vary"`, `"smoothness_vary"`},
		{`"roughness_weight"`, `"smoothness_weight"`}, {`"roughness"`, `"smoothness"`}, {`"fuzz"`, `"sheen"`},
		{`"rim"`, `"fuzz"`}, {`"metal"`, `"clean"`}} {
		old = strings.ReplaceAll(old, r[0], r[1])
	}
	var back Document
	if err := json.Unmarshal([]byte(old), &back); err != nil {
		t.Fatal(err)
	}
	if !back.Tex.Equal(tex) {
		t.Fatal("v1 migration changed texels")
	}
}

// Mods ship LUTs as R32G32B32A32_FLOAT too; Decode reads them (as halves) like the game's RGBA16F ones.
func TestDecodeFloat32(t *testing.T) {
	src := New(MaterialWidth, 2)
	for i := range src.Px {
		src.Px[i] = Round(float32(i%97) / 31)
	}
	main, gpu16 := src.Encode()
	// the same texture as RGBA32F: DXGI format 2 in the DX10 header, 16 bytes per texel
	main32 := append([]byte{}, main...)
	binary.LittleEndian.PutUint32(main32[headerOffset+128:], dxgiRGBA32Float)
	gpu32 := make([]byte, len(src.Px)*4)
	for i, v := range src.Px {
		binary.LittleEndian.PutUint32(gpu32[4*i:], math.Float32bits(v))
	}
	for name, c := range map[string]struct{ main, gpu []byte }{"f16": {main, gpu16}, "f32": {main32, gpu32}} {
		got, err := Decode(c.main, c.gpu)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !got.Equal(src) {
			t.Fatalf("%s: decoded texture differs", name)
		}
	}
	bad := append([]byte{}, main...)
	binary.LittleEndian.PutUint32(bad[headerOffset+128:], 71) // BC1
	if _, err := Decode(bad, gpu16); err == nil {
		t.Fatal("BC1 accepted as a LUT")
	}
	if _, err := Decode(main32, gpu32[:100]); err == nil {
		t.Fatal("short RGBA32F data accepted")
	}
}

// Whole-number fields keep fractional values (the game compares them as floats; mods use paint.mode 0.1).
func TestIntFieldsKeepFractions(t *testing.T) {
	src := New(MaterialWidth, 1)
	src.Px[3] = Round(0.1) // col 0 .a = paint.mode
	d := &Document{LUT: "0x0000000000000001", Kind: "material", Tex: src}
	b, err := d.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var back Document
	if err := back.UnmarshalJSON(b); err != nil {
		t.Fatalf("fractional mode refused: %v", err)
	}
	if back.Tex.Px[3] != Round(0.1) {
		t.Fatalf("mode read back as %v", back.Tex.Px[3])
	}
}

func TestKindOf(t *testing.T) {
	for w, want := range map[int]string{MaterialWidth: "material", 3: "pattern", 16: "cape"} {
		h := 8
		if w == 3 {
			h = 1
		}
		if k, err := KindOf(New(w, h)); err != nil || k != want {
			t.Errorf("width %d: %q %v, want %q", w, k, err, want)
		}
	}
	if _, err := KindOf(New(7, 7)); err == nil {
		t.Error("7x7 accepted as a LUT")
	}
}

func TestBuildMark(t *testing.T) {
	van := New(MaterialWidth, 3)
	for i := range van.Px {
		van.Px[i] = Round(float32(i%7) / 8)
	}
	m := Marked(van)
	if !HasMark(m) || HasMark(van) {
		t.Fatal("mark not found / found on the original")
	}
	for i, v := range m.Px { // only col 20 r, g, b change
		if col, ch := (i/4)%MaterialWidth, i%4; (col != 20 || ch == 3) && v != van.Px[i] {
			t.Fatalf("texel %d channel %d changed", col, ch)
		}
	}
	// the values survive the half-float encoding of the build
	main, gpu := m.Encode()
	back, err := Decode(main, gpu)
	if err != nil || !HasMark(back) {
		t.Fatalf("mark lost in the encoding: %v", err)
	}
	if !Unmark(back, van) || !back.Equal(van) || HasMark(back) {
		t.Fatal("unmark didn't restore the game's values")
	}
	if c := New(CapeWidth, 4); Marked(c) != c || HasMark(c) {
		t.Fatal("a cape LUT was marked")
	}
}

// a mod's broken or unusual LUTs: an absurd header size is refused before allocating; NaN and infinite values come
// in finite (the document stays valid JSON); more than 8 zones read back
func TestDecodeMalformed(t *testing.T) {
	big := New(MaterialWidth, 12)
	big.Px[0] = float32(math.Inf(1))
	big.Px[1] = float32(math.NaN())
	main, gpu := big.Encode()
	back, err := Decode(main, gpu)
	if err != nil || back.Px[0] != 65504 || back.Px[1] != 0 {
		t.Fatalf("decode: %v %v %v", err, back.Px[0], back.Px[1])
	}
	d := &Document{LUT: "0x00000000000000aa", Kind: "material", Tex: back}
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var d2 Document
	if err := json.Unmarshal(b, &d2); err != nil || d2.Tex.Height != 12 {
		t.Fatalf("12 zones round trip: %v", err)
	}
	bad := append([]byte(nil), main...)
	binary.LittleEndian.PutUint32(bad[headerOffset+12:], 0xFFFFFFFF)
	binary.LittleEndian.PutUint32(bad[headerOffset+16:], 0xFFFFFFFF)
	if _, err := Decode(bad, gpu); err == nil {
		t.Fatal("an absurd size decoded")
	}
}

// an edit past the half-float range is kept finite (Inf would make the document unreadable JSON); a mod's LUT with
// more zones than 64 reads back
func TestOutOfRangeAndManyZones(t *testing.T) {
	if Round(1e5) != 65504 || Round(-1e5) != -65504 {
		t.Fatalf("Round: %v %v", Round(1e5), Round(-1e5))
	}
	tex := New(MaterialWidth, 100)
	tex.Px[0] = Round(1e5)
	b, err := json.Marshal(&Document{LUT: "0x00000000000000aa", Kind: "material", Tex: tex})
	if err != nil {
		t.Fatal(err)
	}
	var d Document
	if err := json.Unmarshal(b, &d); err != nil || d.Tex.Height != 100 || d.Tex.Px[0] != 65504 {
		t.Fatalf("100 zones, a clamped value: %v", err)
	}
}
