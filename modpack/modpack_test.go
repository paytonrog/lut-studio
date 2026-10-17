package modpack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"testing"
)

func sample() []Resource {
	return []Resource{
		{Name: 0x6fb52505063d81a9, Type: 0xcd4238c6a0c69e32, Main: bytes.Repeat([]byte{1}, 340), GPU: bytes.Repeat([]byte{2}, 1928)},
		{Name: 0x00d61d272dc49dde, Type: 0xcd4238c6a0c69e32, Main: bytes.Repeat([]byte{3}, 340), GPU: bytes.Repeat([]byte{4}, 32)},
	}
}

func TestArchiveRoundTrip(t *testing.T) {
	res := sample()
	a := WriteArchive(res)
	if err := Verify(a, res); err != nil {
		t.Fatal(err)
	}
	if len(headerStamp) != 56 {
		t.Fatalf("header stamp %d bytes", len(headerStamp))
	}
	// LUTSTUDIO_ARCHIVE_FIXTURE: a patch archive of the same resources known to load in game - see README "Checks".
	if f := os.Getenv("LUTSTUDIO_ARCHIVE_FIXTURE"); f != "" {
		want, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(a.TOC, want) {
			t.Fatalf("TOC differs from the Python writer's (%d vs %d bytes)", len(a.TOC), len(want))
		}
		gpu, _ := os.ReadFile(f + ".gpu_resources")
		if !bytes.Equal(a.GPU, gpu) {
			t.Fatal("GPU data differs from the Python writer's")
		}
	}
}

func readZip(t *testing.T, b []byte) map[string][]byte {
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, f := range z.File {
		r, _ := f.Open()
		out[f.Name], _ = io.ReadAll(r)
	}
	return out
}

func TestZipVariants(t *testing.T) {
	icon := Swatch([][][2][3]float32{{{{1, 0, 0}, {0, 1, 0}}}}, 64)
	m := Mod{Name: "Test", Description: "d", GUID: "00000000-0000-4000-8000-000000000000", Icon: icon,
		Variants: []Variant{{Name: "Red", Folder: "red", Resources: sample(), Image: icon},
			{Name: "Blue", Folder: "blue", Resources: sample()[:1]}}}
	b, err := m.Zip()
	if err != nil {
		t.Fatal(err)
	}
	files := readZip(t, b)
	for _, want := range []string{"manifest.json", "icon.png", "images/red.png", "red/9ba626afa44a3aa3.patch_0",
		"red/9ba626afa44a3aa3.patch_0.gpu_resources", "red/9ba626afa44a3aa3.patch_0.stream", "blue/9ba626afa44a3aa3.patch_0"} {
		if _, ok := files[want]; !ok {
			t.Errorf("zip lacks %s", want)
		}
	}
	var mf manifest
	if err := json.Unmarshal(files["manifest.json"], &mf); err != nil {
		t.Fatal(err)
	}
	if len(mf.Options) != 1 || len(mf.Options[0].SubOptions) != 2 || mf.Options[0].SubOptions[1].Include[0] != "blue" ||
		mf.Options[0].SubOptions[0].Image != "images/red.png" || mf.Options[0].SubOptions[1].Image != "icon.png" {
		t.Errorf("manifest: %s", files["manifest.json"])
	}
	b2, _ := m.Zip()
	if !bytes.Equal(b, b2) {
		t.Error("zip is not deterministic")
	}
	one := m
	one.Variants = m.Variants[:1]
	b3, _ := one.Zip()
	mf = manifest{}
	json.Unmarshal(readZip(t, b3)["manifest.json"], &mf)
	if len(mf.Options) != 1 || mf.Options[0].Include[0] != "red" || mf.Options[0].SubOptions != nil {
		t.Errorf("single-variant manifest: %+v", mf)
	}
}
