package modpack

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"

	"lutstudio/lut"
)

func testLUT(v float32) *lut.Texture {
	t := lut.New(lut.MaterialWidth, 8)
	for i := range t.Px {
		t.Px[i] = lut.Round(v)
	}
	return t
}

func res(name uint64, t *lut.Texture) Resource {
	main, gpu := t.Encode()
	return Resource{Name: name, Type: textureType, Main: main, GPU: gpu}
}

// A mod built by Zip (manifest v1, two sub-options) reads back as two variants with their LUTs.
func TestReadModZip(t *testing.T) {
	m := Mod{Name: "Red Ravager", Description: "red", GUID: "00000000-0000-0000-0000-000000000001", Variants: []Variant{
		{Name: "Red", Folder: "red", Resources: []Resource{res(0x05aab6c2788930fa, testLUT(0.5)), {Name: 7, Type: 9, Main: []byte{1}}}},
		{Name: "Blue", Folder: "blue", Resources: []Resource{res(0x05aab6c2788930fa, testLUT(0.25))}},
	}}
	z, err := m.Zip()
	if err != nil {
		t.Fatal(err)
	}
	files, err := ZipFiles(z)
	if err != nil {
		t.Fatal(err)
	}
	im, err := ReadMod(Files(files), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	if im.Name != "Red Ravager" || len(im.Variants) != 2 || im.Skipped != 1 {
		t.Fatalf("got %q, %d variants, %d skipped, notes %v", im.Name, len(im.Variants), im.Skipped, im.Notes)
	}
	for i, want := range []float32{0.5, 0.25} {
		v := im.Variants[i]
		l := v.LUTs[0x05aab6c2788930fa]
		if l == nil || l.Px[0] != want {
			t.Fatalf("variant %q: %v", v.Name, l)
		}
	}
}

// Loose patch files (HD2SDK-CommunityEdition's output, no manifest): one variant; pixels from .stream when the GPU
// data is empty.
func TestReadModLoose(t *testing.T) {
	r := res(0x05aab6c2788930fa, testLUT(0.75))
	r.Stream, r.GPU = r.GPU, nil
	a := WriteArchive([]Resource{r})
	files := map[string][]byte{"9ba626afa44a3aa3.patch_0": a.TOC, "9ba626afa44a3aa3.patch_0.stream": a.Stream,
		"9ba626afa44a3aa3.patch_0.gpu_resources": a.GPU}
	im, err := ReadMod(Files(files), "My Mod")
	if err != nil {
		t.Fatal(err)
	}
	if im.Name != "My Mod" || len(im.Variants) != 1 || im.Variants[0].LUTs[0x05aab6c2788930fa].Px[0] != 0.75 {
		t.Fatalf("%+v", im)
	}
}

// zipped: a mod zip with a manifest and per-folder patches of LUTs (folder -> LUT hash -> value).
func zipped(t *testing.T, manifest string, folders map[string]map[uint64]float32) map[string][]byte {
	t.Helper()
	files := map[string][]byte{"Wrapper/manifest.json": []byte(manifest)}
	for f, luts := range folders {
		var rs []Resource
		for h, v := range luts {
			rs = append(rs, res(h, testLUT(v)))
		}
		a := WriteArchive(rs)
		base := "Wrapper/" + f + "/9ba626afa44a3aa3.patch_0"
		files[base], files[base+".gpu_resources"], files[base+".stream"] = a.TOC, a.GPU, a.Stream
	}
	return files
}

// An overhaul (several options, players enable many): every option layered into each variant; variants are the
// sub-option styles; an option without that style uses its first; a single sub-option names no style.
func TestReadModOverhaul(t *testing.T) {
	manifest := `{"Version":1,"Name":"Overhaul","Description":"d","Options":[
	 {"Name":"Read Me","Include":["Guide"],"SubOptions":[{"Name":"Shared LUTS","Include":["Guide"]}]},
	 {"Name":"Armor A","SubOptions":[{"Name":"Chrome","Include":["A/Chrome"]},{"Name":"Gold","Include":["A/Gold"]}]},
	 {"Name":"Armor B","SubOptions":[{"Name":"Chrome","Include":["B/Chrome"]}]},
	 {"Name":"Decals","Include":["Decals"]}]}`
	files := zipped(t, manifest, map[string]map[uint64]float32{
		"Guide": {1: 0.1}, "A/Chrome": {2: 0.2}, "A/Gold": {2: 0.9}, "B/Chrome": {3: 0.3}, "Decals": {4: 0.4},
	})
	im, err := ReadMod(Files(files), "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(im.Variants) != 2 || im.Variants[0].Name != "Chrome" || im.Variants[1].Name != "Gold" {
		var names []string
		for _, v := range im.Variants {
			names = append(names, v.Name)
		}
		t.Fatalf("variants %v (want Chrome, Gold: Shared LUTS is no style)", names)
	}
	gold := im.Variants[1].LUTs
	if len(gold) != 4 || gold[2].Px[0] != lut.Round(0.9) || gold[3].Px[0] != lut.Round(0.3) || gold[1] == nil || gold[4] == nil {
		t.Fatalf("Gold variant LUTs: %d (A gold, B falls back to its Chrome, Read Me and Decals layered)", len(gold))
	}
	if im.Variants[0].LUTs[2].Px[0] != lut.Round(0.2) {
		t.Fatal("Chrome variant: A's Chrome")
	}
}

// Legacy manifests list option folders; no manifest: each folder with patches is a variant.
func TestReadModLegacyAndBare(t *testing.T) {
	files := zipped(t, `{"Guid":"x","Name":"Legacy","Description":"","Options":["Red","Blue"]}`,
		map[string]map[uint64]float32{"Red": {7: 0.5}, "Blue": {7: 0.25}})
	im, err := ReadMod(Files(files), "x")
	if err != nil || len(im.Variants) != 2 || im.Variants[0].Name != "Red" || im.Variants[1].LUTs[7].Px[0] != 0.25 {
		t.Fatalf("legacy: %v %+v", err, im)
	}
	delete(files, "Wrapper/manifest.json")
	im, err = ReadMod(Files(files), "Bare")
	if err != nil || len(im.Variants) != 2 || im.Name != "Bare" {
		t.Fatalf("no manifest: %v %+v", err, im)
	}
	if _, err := ReadMod(Files{"readme.txt": []byte("hi")}, "x"); err == nil {
		t.Fatal("a zip without patches should be refused")
	}
}

// A later patch of the same folder wins.
func TestReadModPatchOrder(t *testing.T) {
	a0, a1 := WriteArchive([]Resource{res(9, testLUT(0.1))}), WriteArchive([]Resource{res(9, testLUT(0.6))})
	files := map[string][]byte{
		"9ba626afa44a3aa3.patch_0": a0.TOC, "9ba626afa44a3aa3.patch_0.gpu_resources": a0.GPU,
		"9ba626afa44a3aa3.patch_1": a1.TOC, "9ba626afa44a3aa3.patch_1.gpu_resources": a1.GPU,
	}
	im, err := ReadMod(Files(files), "x")
	if err != nil || im.Variants[0].LUTs[9].Px[0] != lut.Round(0.6) {
		t.Fatalf("%v %+v", err, im)
	}
}

// A zip read in place: a texture too big to be a LUT (a mod's other textures, hundreds of MB in texture overhauls)
// is counted, not read; the LUT next to it reads back. A zero-size file whose offset is past the end of the data
// (as the SDK writes them) doesn't spoil the patch.
func TestReadModZipInPlace(t *testing.T) {
	big := Resource{Name: 0x1111, Type: textureType, Main: make([]byte, 340), GPU: make([]byte, maxLUTBytes+1)}
	m := Mod{Name: "Overhaul", GUID: "00000000-0000-0000-0000-000000000002", Variants: []Variant{
		{Name: "Default", Folder: "all", Resources: []Resource{big, res(0x05aab6c2788930fa, testLUT(0.5)), {Name: 0x2222, Type: 9}}},
	}}
	z, err := m.Zip()
	if err != nil {
		t.Fatal(err)
	}
	src, err := OpenZip(bytes.NewReader(z), int64(len(z)))
	if err != nil {
		t.Fatal(err)
	}
	im, err := ReadMod(src, "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(im.Variants) != 1 || im.Variants[0].LUTs[0x05aab6c2788930fa] == nil || im.Skipped != 2 || len(im.Notes) != 0 {
		t.Fatalf("%d variants, %v, %d skipped, notes %v", len(im.Variants), im.Variants, im.Skipped, im.Notes)
	}
}

func TestReadArchiveZeroSizePastEnd(t *testing.T) {
	a := WriteArchive([]Resource{res(0x05aab6c2788930fa, testLUT(0.5)), {Name: 0x2222, Type: 9, Main: []byte{1}}})
	es, err := ReadTOC(a.TOC)
	if err != nil {
		t.Fatal(err)
	}
	// move the empty file's GPU and stream offsets past the end (HD2SDK does: Fireteam Epsilon's patches)
	for i, e := range es {
		if e.GPUSize == 0 {
			row := 72 + 32*int(binary.LittleEndian.Uint32(a.TOC[4:])) + 80*i
			binary.LittleEndian.PutUint64(a.TOC[row+24:], uint64(len(a.Stream))+64)
			binary.LittleEndian.PutUint64(a.TOC[row+32:], uint64(len(a.GPU))+16)
		}
	}
	res, err := ReadArchive(a)
	if err != nil || len(res) != 2 {
		t.Fatalf("%v, %d files", err, len(res))
	}
}

// Manifests as the mod manager accepts them: trailing commas and comments.
func TestRelaxJSON(t *testing.T) {
	in := "{ // a mod\n \"Name\": \"a, ]\", /* x */ \"Options\": [ {\"Include\": [\"f\",],}, ],\n}"
	var v struct {
		Name    string
		Options []struct{ Include []string }
	}
	if err := json.Unmarshal(relaxJSON([]byte(in)), &v); err != nil || v.Name != "a, ]" || len(v.Options) != 1 || v.Options[0].Include[0] != "f" {
		t.Fatalf("%s: %v %+v", relaxJSON([]byte(in)), err, v)
	}
}

// A texture too big to be a LUT (a decal sheet) is only counted, unless Options.WantTexture asks for it: then it
// comes whole (main, stream and GPU data) in its variant's Textures, beside the LUTs.
func TestReadModWantTexture(t *testing.T) {
	const sheet = 0x7ac0a9ca7c966370
	big := Resource{Name: sheet, Type: textureType, Main: bytes.Repeat([]byte{3}, 300), GPU: bytes.Repeat([]byte{7}, 2<<20), Stream: bytes.Repeat([]byte{9}, 3<<20)}
	m := Mod{Name: "Sheet", GUID: "00000000-0000-0000-0000-000000000002", Variants: []Variant{
		{Name: "A", Folder: "a", Resources: []Resource{res(0x05aab6c2788930fa, testLUT(0.5)), big}}}}
	z, err := m.Zip()
	if err != nil {
		t.Fatal(err)
	}
	files, _ := ZipFiles(z)
	im, err := ReadMod(Files(files), "x")
	if err != nil || im.Skipped != 1 || len(im.Variants[0].Textures) != 0 {
		t.Fatalf("plain read: %v, %d skipped, %d textures", err, im.Skipped, len(im.Variants[0].Textures))
	}
	im, err = ReadModWith(Files(files), "x", Options{WantTexture: func(h uint64) bool { return h == sheet }})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := im.Variants[0].Textures[sheet]
	if !ok || !bytes.Equal(got.Main, big.Main) || !bytes.Equal(got.GPU, big.GPU) || !bytes.Equal(got.Stream, big.Stream) || im.Variants[0].LUTs[0x05aab6c2788930fa] == nil || im.Skipped != 0 {
		t.Fatalf("wanted read: texture %v (main %d, gpu %d, stream %d), %d LUTs, %d skipped", ok, len(got.Main), len(got.GPU), len(got.Stream), len(im.Variants[0].LUTs), im.Skipped)
	}
}
