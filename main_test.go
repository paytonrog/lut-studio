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
	"strings"
	"testing"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/modpack"
	"lutstudio/project"
	"lutstudio/server"
	"lutstudio/texenc"
)

// The whole loop on the real install (LUTSTUDIO_GAME, read-only): a new project from an armor, a cape, a vehicle
// skin and a weapon paint scheme; one color edited; check finds exactly that LUT changed; build writes the mod zip;
// the zip reads back (modpack.ReadMod) with the edit; importing it makes a project holding the edit. Settings and
// cache go to scratch folders.
func TestEndToEnd(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	scratch := t.TempDir()
	t.Setenv("LUTSTUDIO_CONFIG_DIR", filepath.Join(scratch, "config"))
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(scratch, "cache"))
	e := &env{out: io.Discard, gameDir: gameDir}
	idx, err := e.index()
	if err != nil {
		t.Fatal(err)
	}
	capeKey := ""
	for _, k := range idx.Kits {
		if k.Type == "Cape" {
			capeKey = "kit:" + k.ID
			break
		}
	}
	for _, what := range []string{"FS-37 Ravager", capeKey, "Gunner FRV: Mustard Vehicle Pattern", "AR-23 Liberator: Desert paint scheme"} {
		t.Run(strings.NewReplacer(":", "", " ", "_").Replace(what), func(t *testing.T) {
			dir := filepath.Join(scratch, project.Folder(what))
			if err := e.cmdNew(dir, what); err != nil {
				t.Fatal(err)
			}
			p, err := project.Load(dir)
			if err != nil {
				t.Fatal(err)
			}
			docs, problems, err := p.Docs(p.Variants[0])
			if err != nil || len(problems) > 0 || len(docs) == 0 {
				t.Fatalf("new project: %d docs, problems %v, %v", len(docs), problems, err)
			}
			// nothing changed yet: check refuses to build an empty mod
			if _, err := e.check(dir, false); err == nil || !strings.Contains(err.Error(), "nothing to build") {
				t.Fatalf("fresh project: %v (want: nothing to build)", err)
			}
			// edit: zone 0's main color of the first material LUT
			var d *lut.Document
			for _, x := range docs {
				if x.Kind == "material" {
					d = x
					break
				}
			}
			if d == nil {
				t.Fatal("no material LUT")
			}
			tex := &lut.Texture{Width: d.Tex.Width, Height: d.Tex.Height, Px: append([]float32{}, d.Tex.Px...)}
			tex.Set(0, 0, 0, 0.123)
			tex.Set(0, 0, 1, 0.456)
			d.Tex = tex
			if err := project.WriteDoc(p.DocPath(p.Variants[0], d.LUT), d); err != nil {
				t.Fatal(err)
			}
			b, err := e.check(dir, false)
			if err != nil {
				t.Fatal(err)
			}
			if n := changed(b); n != 1 {
				t.Fatalf("after one edit: %d changed LUTs", n)
			}
			zip := filepath.Join(scratch, project.Folder(what)+".zip")
			if err := e.cmdBuild(dir, zip); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(zip)
			if err != nil {
				t.Fatal(err)
			}
			files, err := modpack.ZipFiles(raw)
			if err != nil {
				t.Fatal(err)
			}
			im, err := modpack.ReadMod(modpack.Files(files), "x")
			if err != nil {
				t.Fatal(err)
			}
			h, _ := lut.ParseHash(d.LUT)
			got := im.Variants[0].LUTs[h]
			if len(im.Variants[0].LUTs) != 1 || got == nil || got.At(0, 0, 0) != lut.Round(0.123) || got.At(0, 0, 1) != lut.Round(0.456) {
				t.Fatalf("mod zip: %d LUTs, edited one %v", len(im.Variants[0].LUTs), got)
			}
			material := got.Width == lut.MaterialWidth
			if lut.HasMark(got) != material { // the build mark: on material LUTs only
				t.Fatalf("mod zip: build mark %v on a %d-wide LUT", lut.HasMark(got), got.Width)
			}
			// import into a new project: the edit is there, the other LUTs of the armor come with the game's values
			idir := filepath.Join(scratch, project.Folder(what)+"-imported")
			rep, err := e.importMod(idir, im)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(rep, "made with LUT Studio") != material {
				t.Errorf("import report: %s", rep)
			}
			ip, err := project.Load(idir)
			if err != nil {
				t.Fatal(err)
			}
			idocs, _, _ := ip.Docs(ip.Variants[0])
			found := false
			for _, x := range idocs {
				if x.LUT == d.LUT {
					found = x.Tex.At(0, 0, 0) == lut.Round(0.123) && !lut.HasMark(x.Tex) && x.Tex.Equal(d.Tex) // (the mark taken out)
				}
			}
			if !found {
				t.Fatalf("imported project (%d LUTs) lacks the edit", len(idocs))
			}
		})
	}
}

func changed(b []built) int {
	n := 0
	for _, x := range b {
		n += len(x.res)
	}
	return n
}

// The vehicle and weapon kits a project can be made from all resolve to LUTs the install has.
func TestKitLUTsExist(t *testing.T) {
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
	missing := 0
	for _, k := range idx.Kits {
		if k.Type != game.VehicleType && k.Type != game.WeaponType {
			continue
		}
		for _, p := range k.Pieces {
			h, _ := lut.ParseHash(p.MaterialLUT)
			if _, err := g.ReadLUT(h); err != nil {
				missing++
				if missing < 5 {
					t.Errorf("%s %s: %v", k.Name, p.Slot, err)
				}
			}
		}
	}
	if missing > 0 {
		t.Fatalf("%d LUTs of vehicle / weapon kits don't read", missing)
	}
}

// A mod's decal sheets and cape designs round-trip: a cape project with its design (RGBA8) and decal sheet (BC3)
// edited, a second variant that changes nothing (left out of the build); the built zip read back with the editable
// textures asked for (as the site's import does) holds both; importing it makes a project with both as the editors'
// PNGs, close to the edits.
func TestImportTextures(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	scratch := t.TempDir()
	t.Setenv("LUTSTUDIO_CONFIG_DIR", filepath.Join(scratch, "config"))
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(scratch, "cache"))
	e := &env{out: io.Discard, gameDir: gameDir}
	idx, err := e.index()
	if err != nil {
		t.Fatal(err)
	}
	g, _ := e.game()
	// a cape with the common cape decal sheet (BC3 2048 x 2048) and an RGBA8 design
	const capeSheet = 0xe31836670db264a4
	var cape game.Kit
	var design, sheet uint64
	for _, k := range idx.Kits {
		if k.Type != "Cape" || cape.ID != "" {
			continue
		}
		for _, pc := range k.Pieces {
			d, err1 := lut.ParseHash(pc.DecalScalarFields)
			s, err2 := lut.ParseHash(pc.DecalSheet)
			if err1 != nil || err2 != nil || s != capeSheet {
				continue
			}
			if main, _, err := g.ReadTexture(d); err == nil {
				if in, err := texenc.ReadInfo(main); err == nil && in.DXGI == 28 && in.Width >= 256 {
					cape, design, sheet = k, d, s
				}
			}
		}
	}
	if cape.ID == "" {
		t.Skip("no cape with the common decal sheet and an RGBA8 design in this install")
	}
	dir := filepath.Join(scratch, "cape")
	if err := e.cmdNew(dir, "kit:"+cape.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.cmdVariant(dir, "Plain", ""); err != nil {
		t.Fatal(err)
	}
	p, _ := project.Load(dir)
	a := game.NewAssets(g, t.TempDir())
	// the edits: the design's top-left quarter cut out, the sheet's top-left 256 x 256 solid red
	edit := func(h uint64, design bool, f func(img *image.NRGBA)) *image.NRGBA {
		blob, err := a.TextureBlob(h)
		if err != nil {
			t.Fatal(err)
		}
		w, hh := int(binary.LittleEndian.Uint32(blob[4:])), int(binary.LittleEndian.Uint32(blob[8:]))
		img := &image.NRGBA{Pix: append([]byte(nil), blob[20:20+w*hh*4]...), Stride: w * 4, Rect: image.Rect(0, 0, w, hh)}
		f(img)
		var b bytes.Buffer
		png.Encode(&b, img)
		file := server.SheetPath(p, p.Variants[0], h, map[bool]string{true: "design", false: "sheet"}[design])
		os.MkdirAll(filepath.Dir(file), 0o755)
		if err := os.WriteFile(file, b.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		return img
	}
	wantDesign := edit(design, true, func(img *image.NRGBA) {
		for y := 0; y < img.Rect.Dy()/2; y++ {
			for x := 0; x < img.Rect.Dx()/2; x++ {
				img.Pix[img.PixOffset(x, y)+3] = 0
			}
		}
	})
	wantSheet := edit(sheet, false, func(img *image.NRGBA) {
		for y := 0; y < 256; y++ {
			for x := 0; x < 256; x++ {
				copy(img.Pix[img.PixOffset(x, y):], []byte{255, 0, 0, 255})
			}
		}
	})
	zip := filepath.Join(scratch, "cape.zip")
	if err := e.cmdBuild(dir, zip); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(zip)
	files, err := modpack.ZipFiles(raw)
	if err != nil {
		t.Fatal(err)
	}
	sheets, designs := g.EditableTextures(idx)
	if !sheets[sheet] || !designs[design] {
		t.Fatalf("editable textures: sheet %v, design %v", sheets[sheet], designs[design])
	}
	im, err := modpack.ReadModWith(modpack.Files(files), "x", modpack.Options{WantTexture: func(h uint64) bool { return sheets[h] || designs[h] }})
	if err != nil {
		t.Fatal(err)
	}
	if len(im.Variants) != 1 || len(im.Variants[0].Textures) != 2 {
		t.Fatalf("mod zip: %d variants (the unchanged one left out), %d textures", len(im.Variants), len(im.Variants[0].Textures))
	}
	idir := filepath.Join(scratch, "imported")
	rep, err := e.importMod(idir, im)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rep, "1 decal sheet(s) and 1 cape design(s)") {
		t.Errorf("report: %s", rep)
	}
	ip, _ := project.Load(idir)
	for _, c := range []struct {
		h      uint64
		design bool
		want   *image.NRGBA
		tol    float64
	}{{design, true, wantDesign, 0.5}, {sheet, false, wantSheet, 4}} {
		b, err := os.ReadFile(server.SheetPath(ip, ip.Variants[0], c.h, map[bool]string{true: "design", false: "sheet"}[c.design]))
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		got := texenc.ToNRGBA(img)
		var sum float64
		for i := range got.Pix {
			sum += math.Abs(float64(got.Pix[i]) - float64(c.want.Pix[i]))
		}
		if mean := sum / float64(len(got.Pix)); mean > c.tol {
			t.Errorf("%016x: imported texture differs from the edit by %.2f on average", c.h, mean)
		}
	}
}

// A mod with options round-trips: two variants, one LUT edited differently in each; the mod as an "Armor" option
// (that LUT, both variants: a choice) and a "Helmet" switch (another LUT, edited in the first variant only); the zip
// reads back with both options and their parts, importing it makes a project with the same options, which builds.
func TestOptionsRoundTrip(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	scratch := t.TempDir()
	t.Setenv("LUTSTUDIO_CONFIG_DIR", filepath.Join(scratch, "config"))
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(scratch, "cache"))
	e := &env{out: io.Discard, gameDir: gameDir}
	dir := filepath.Join(scratch, "opts")
	if err := e.cmdNew(dir, "FS-37 Ravager"); err != nil {
		t.Fatal(err)
	}
	if err := e.cmdVariant(dir, "Night", ""); err != nil {
		t.Fatal(err)
	}
	p, _ := project.Load(dir)
	docs, _, _ := p.Docs(p.Variants[0])
	var mats []*lut.Document
	for _, d := range docs {
		if d.Kind == "material" {
			mats = append(mats, d)
		}
	}
	if len(mats) < 2 {
		t.Fatalf("%d material LUTs", len(mats))
	}
	armor, helmet := mats[0], mats[1]
	set := func(v project.Variant, d *lut.Document, val float32) {
		tex := &lut.Texture{Width: d.Tex.Width, Height: d.Tex.Height, Px: append([]float32{}, d.Tex.Px...)}
		tex.Set(0, 0, 0, val)
		c := *d
		c.Tex = tex
		if err := project.WriteDoc(p.DocPath(v, d.LUT), &c); err != nil {
			t.Fatal(err)
		}
	}
	set(p.Variants[0], armor, 0.9)
	set(p.Variants[1], armor, 0.1)
	set(p.Variants[0], helmet, 0.5)
	p.Options = []project.Option{
		{ID: "armor", Name: "Armor", Parts: []string{armor.LUT}, Variants: []string{p.Variants[0].Folder, p.Variants[1].Folder}},
		{ID: "helmet", Name: "Helmet", Parts: []string{helmet.LUT}, Variants: []string{p.Variants[0].Folder}},
	}
	if err := p.Save(); err != nil {
		t.Fatal(err)
	}
	zip := filepath.Join(scratch, "opts.zip")
	if err := e.cmdBuild(dir, zip); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(zip)
	files, _ := modpack.ZipFiles(raw)
	im, err := modpack.ReadMod(modpack.Files(files), "x")
	if err != nil {
		t.Fatal(err)
	}
	ah, _ := lut.ParseHash(armor.LUT)
	hh, _ := lut.ParseHash(helmet.LUT)
	if l := im.Layout; len(l) != 2 || len(l[0].Choices) != 2 || len(l[1].Choices) != 0 || len(l[0].Parts) != 1 || l[0].Parts[0] != ah || l[1].Parts[0] != hh {
		t.Fatalf("layout: %+v", im.Layout)
	}
	idir := filepath.Join(scratch, "imported")
	if _, err := e.importMod(idir, im); err != nil {
		t.Fatal(err)
	}
	ip, _ := project.Load(idir)
	if len(ip.Options) != 2 || ip.Options[0].Name != "Armor" || len(ip.Options[0].Variants) != 2 || ip.Options[1].Parts[0] != helmet.LUT || len(ip.Options[1].Variants) != 1 {
		t.Fatalf("imported options: %+v", ip.Options)
	}
	// the imported variants hold each choice's edit
	for i, want := range []float32{0.9, 0.1} {
		idocs, _, _ := ip.Docs(ip.Variants[i])
		for _, d := range idocs {
			if d.LUT == armor.LUT && d.Tex.At(0, 0, 0) != lut.Round(want) {
				t.Errorf("variant %d: armor %v, want %v", i, d.Tex.At(0, 0, 0), want)
			}
		}
	}
	if err := e.cmdBuild(idir, filepath.Join(scratch, "again.zip")); err != nil {
		t.Fatalf("the imported project doesn't build: %v", err)
	}
}
