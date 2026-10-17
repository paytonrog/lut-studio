package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/project"
	"lutstudio/server"
)

// A theme on the real install (LUTSTUDIO_GAME, read-only): every helmet's LUTs get the primary and cloth looks on
// their suggested zones; applied again with other looks, a zone changed by hand in between is kept; with overwrite it
// isn't.
func TestTheme(t *testing.T) {
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
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(scratch, "themed")
	p, err := project.Create(dir, "Themed")
	if err != nil {
		t.Fatal(err)
	}
	srv := &server.Server{Version: "test"}
	srv.SetGame(g, idx, game.NewAssets(g, filepath.Join(scratch, "assets")), nil)
	if err := srv.SetProject(dir); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	look := func(v float32) []float32 {
		row := make([]float32, lut.MaterialWidth*4)
		for i := range row {
			row[i] = v
		}
		return row
	}
	apply := func(primary float32, overwrite bool) map[string]any {
		body, _ := json.Marshal(map[string]any{"Variant": p.Variants[0].Folder, "Groups": []string{"Helmets"}, "Overwrite": overwrite,
			"Looks": map[string][]float32{"primary": look(primary), "cloth": look(0.25)}})
		r, err := http.Post(ts.URL+"/api/theme", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode != 200 {
			t.Fatalf("theme: %d %s", r.StatusCode, b)
		}
		var out map[string]any
		json.Unmarshal(b, &out)
		return out
	}
	first := apply(0.75, false)
	t.Logf("first theme: %v", first)
	if first["items"].(float64) < 50 || first["added"].(float64) < 50 || first["zones"].(float64) < 100 || first["kept"].(float64) != 0 {
		t.Fatalf("first theme: %v", first)
	}
	// a themed primary zone: the look, except the build mark's channels
	docs, _, err := p.Docs(p.Variants[0])
	if err != nil {
		t.Fatal(err)
	}
	var hand *lut.Document
	handZone := -1
	for _, d := range docs {
		for z := 0; z < d.Tex.Height && hand == nil; z++ {
			if d.Tex.At(0, z, 0) == lut.Round(0.75) {
				hand, handZone = d, z
			}
		}
	}
	if hand == nil {
		t.Fatal("no zone has the primary look")
	}
	for i := 0; i < lut.MaterialWidth*4; i++ {
		v := hand.Tex.Px[handZone*lut.MaterialWidth*4+i]
		if lut.MarkChannel(lut.MaterialWidth, i) == (v == lut.Round(0.75)) {
			t.Fatalf("themed zone, value %d: %v", i, v)
		}
	}
	// the suggestions come from the parts' ID masks (each zone's share known) for nearly every helmet LUT
	var hs []string
	for _, d := range docs {
		hs = append(hs, d.LUT)
	}
	r, err := http.Get(ts.URL + "/api/roles/suggest?variant=" + p.Variants[0].Folder + "&luts=" + strings.Join(hs, ","))
	if err != nil {
		t.Fatal(err)
	}
	var sug map[string]struct {
		Roles    []string
		Coverage []float64
	}
	json.NewDecoder(r.Body).Decode(&sug)
	r.Body.Close()
	withMask, unused := 0, 0
	for _, x := range sug {
		if x.Coverage != nil {
			withMask++
		}
		for _, role := range x.Roles {
			if role == "unused" {
				unused++
			}
		}
	}
	t.Logf("suggestions: %d LUTs, %d with their masks, %d unused zones", len(sug), withMask, unused)
	if len(sug) != len(hs) || withMask < len(hs)*9/10 || unused == 0 {
		t.Fatalf("suggestions: %d of %d LUTs, %d with masks, %d unused zones", len(sug), len(hs), withMask, unused)
	}
	// changed by hand, then themed again: that zone is kept, the others take the new look
	hand.Tex.Set(0, handZone, 0, 0.1)
	if err := project.WriteDoc(p.DocPath(p.Variants[0], hand.LUT), hand); err != nil {
		t.Fatal(err)
	}
	second := apply(0.5, false)
	if second["kept"].(float64) != 1 || second["added"].(float64) != 0 || second["zones"].(float64) != first["zones"].(float64)-1 {
		t.Fatalf("second theme: %v (first %v)", second, first)
	}
	reread := func() *lut.Document {
		docs, _, _ := p.Docs(p.Variants[0])
		for _, d := range docs {
			if d.LUT == hand.LUT {
				return d
			}
		}
		return nil
	}
	if d := reread(); d.Tex.At(0, handZone, 0) != lut.Round(0.1) {
		t.Fatalf("the hand edit was overwritten: %v", d.Tex.At(0, handZone, 0))
	}
	third := apply(0.5, true)
	if third["kept"].(float64) != 0 || reread().Tex.At(0, handZone, 0) != lut.Round(0.5) {
		t.Fatalf("overwrite: %v", third)
	}
}

// Capes on the real install: the trim look's color goes to every cape design LUT's trim lines (column 0's RGB), the
// rest of the design (gradient, decals) stays as the game made it.
func TestThemeCapeTrim(t *testing.T) {
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
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(scratch, "capes")
	p, err := project.Create(dir, "Capes")
	if err != nil {
		t.Fatal(err)
	}
	srv := &server.Server{Version: "test"}
	srv.SetGame(g, idx, game.NewAssets(g, filepath.Join(scratch, "assets")), nil)
	if err := srv.SetProject(dir); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	trim := make([]float32, lut.MaterialWidth*4)
	for i := range trim {
		trim[i] = 0.6
	}
	body, _ := json.Marshal(map[string]any{"Variant": p.Variants[0].Folder, "Groups": []string{"Capes"}, "Looks": map[string][]float32{"trim": trim}})
	r, err := http.Post(ts.URL+"/api/theme", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatalf("theme: %d %s", r.StatusCode, b)
	}
	docs, _, err := p.Docs(p.Variants[0])
	if err != nil {
		t.Fatal(err)
	}
	capes := 0
	for _, d := range docs {
		if d.Tex.Width != lut.CapeWidth {
			continue
		}
		capes++
		h, _ := lut.ParseHash(d.LUT)
		van, err := g.ReadLUT(h)
		if err != nil {
			t.Fatal(err)
		}
		for z := 0; z < d.Tex.Height; z++ {
			for i := 0; i < lut.CapeWidth*4; i++ {
				got, want := d.Tex.Px[z*lut.CapeWidth*4+i], van.Px[z*lut.CapeWidth*4+i]
				if i < 3 {
					want = lut.Round(0.6)
				}
				if got != want && !lut.MarkChannel(lut.CapeWidth, i) {
					t.Fatalf("cape %s zone %d value %d: %v, want %v", d.LUT, z, i, got, want)
				}
			}
		}
	}
	t.Logf("%s; %d cape design LUTs", b, capes)
	if capes < 50 {
		t.Fatalf("only %d cape design LUTs themed", capes)
	}
}

// Decals on the real install: a capes theme with decals recolors the capes' decal sheets (light parts in the trim
// look's color, dark ones in the secondary's), their alpha as the game's; a sheet's pixels are the game's size.
func TestThemeDecals(t *testing.T) {
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
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(scratch, "capes")
	p, err := project.Create(dir, "Capes")
	if err != nil {
		t.Fatal(err)
	}
	assets := game.NewAssets(g, filepath.Join(scratch, "assets"))
	srv := &server.Server{Version: "test"}
	srv.SetGame(g, idx, assets, nil)
	if err := srv.SetProject(dir); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	look := func(v float32) []float32 {
		r := make([]float32, lut.MaterialWidth*4)
		for i := range r {
			r[i] = v
		}
		return r
	}
	body, _ := json.Marshal(map[string]any{"Variant": p.Variants[0].Folder, "Groups": []string{"Capes"}, "Decals": "two",
		"Looks": map[string][]float32{"trim": look(0.9), "secondary": look(0.1)}})
	r, err := http.Post(ts.URL+"/api/theme", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var res struct {
		DecalSheets  int `json:"decal_sheets"`
		DecalOutside int `json:"decal_outside"`
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 || json.Unmarshal(b, &res) != nil {
		t.Fatalf("theme: %d %s", r.StatusCode, b)
	}
	files, _ := filepath.Glob(filepath.Join(p.VariantDir(p.Variants[0]), "textures", "*.png"))
	t.Logf("%s; %d sheet file(s)", b, len(files))
	if res.DecalSheets < 4 || len(files) != res.DecalSheets {
		t.Fatalf("%d decal sheets recolored, %d files (the capes have 6 real sheets)", res.DecalSheets, len(files))
	}
	for _, f := range files[:1] {
		h, _ := lut.ParseHash(strings.TrimSuffix(filepath.Base(f), ".png"))
		blob, err := assets.TextureBlob(h)
		if err != nil {
			t.Fatal(err)
		}
		fh, _ := os.Open(f)
		img, err := png.Decode(fh)
		fh.Close()
		if err != nil {
			t.Fatal(err)
		}
		n := img.(*image.NRGBA)
		for i := 0; i < len(n.Pix); i += 4 * 997 {
			if n.Pix[i+3] != blob[20+i+3] {
				t.Fatalf("%s: alpha at %d is %d, the game's %d", f, i/4, n.Pix[i+3], blob[20+i+3])
			}
			if c := n.Pix[i]; c != n.Pix[i+1] || c < 25 || c > 230 {
				t.Fatalf("%s: color at %d: %v, not between the two looks' grays", f, i/4, n.Pix[i:i+4])
			}
		}
	}
}

// The cape design three capes share (Foesmasher, Drape of Glory, Tyranny's Bane: a 4 x 4 half-float placeholder)
// opens in the design editor: /api/sheet serves it as an 8-bit PNG (then the editor offers a new design).
func TestFloatPlaceholderDesign(t *testing.T) {
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
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(scratch, "cape")
	p, err := project.Create(dir, "Cape")
	if err != nil {
		t.Fatal(err)
	}
	srv := &server.Server{Version: "test"}
	srv.SetGame(g, idx, game.NewAssets(g, filepath.Join(scratch, "assets")), nil)
	if err := srv.SetProject(dir); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	r, err := http.Get(ts.URL + "/api/sheet?hash=0xd1114c147542963a&kind=design&variant=" + p.Variants[0].Folder)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		b, _ := io.ReadAll(r.Body)
		t.Fatalf("design: %d %s", r.StatusCode, b)
	}
	img, err := png.Decode(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 4 || b.Dy() != 4 {
		t.Fatalf("design %v, want 4 x 4", b)
	}
}

// Patterns on the real install: the trim look's color goes to every patterned row of the armor's pattern LUTs (column
// 0's RGB); rows without a pattern (mask layer -1) and the rest of each row stay as the game made them.
func TestThemePatterns(t *testing.T) {
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
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(scratch, "patterns")
	p, err := project.Create(dir, "Patterns")
	if err != nil {
		t.Fatal(err)
	}
	srv := &server.Server{Version: "test"}
	srv.SetGame(g, idx, game.NewAssets(g, filepath.Join(scratch, "assets")), nil)
	if err := srv.SetProject(dir); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	trim := make([]float32, lut.MaterialWidth*4)
	for i := range trim {
		trim[i] = 0.6
	}
	body, _ := json.Marshal(map[string]any{"Variant": p.Variants[0].Folder, "Groups": []string{"Armor"}, "Looks": map[string][]float32{"trim": trim}})
	r, err := http.Post(ts.URL+"/api/theme", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatalf("theme: %d %s", r.StatusCode, b)
	}
	docs, _, err := p.Docs(p.Variants[0])
	if err != nil {
		t.Fatal(err)
	}
	pats := 0
	for _, d := range docs {
		if d.Tex.Width != lut.PatternWidth {
			continue
		}
		pats++
		h, _ := lut.ParseHash(d.LUT)
		van, err := g.ReadLUT(h)
		if err != nil {
			t.Fatal(err)
		}
		for z := 0; z < d.Tex.Height; z++ {
			for i := 0; i < lut.PatternWidth*4; i++ {
				got, want := d.Tex.Px[z*lut.PatternWidth*4+i], van.Px[z*lut.PatternWidth*4+i]
				if i < 3 && van.At(0, z, 3) != -1 {
					want = lut.Round(0.6)
				}
				if got != want && !lut.MarkChannel(lut.PatternWidth, i) {
					t.Fatalf("cape %s zone %d value %d: %v, want %v", d.LUT, z, i, got, want)
				}
			}
		}
	}
	t.Logf("%s; %d pattern LUTs", b, pats)
	if pats < 10 {
		t.Fatalf("only %d pattern LUTs themed", pats)
	}
}
