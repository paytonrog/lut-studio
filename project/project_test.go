package project

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lutstudio/lut"
)

// material returns a valid 23 x zones material LUT document filled with v.
func material(hash string, zones int, v float32) *lut.Document {
	t := lut.New(lut.MaterialWidth, zones)
	for i := range t.Px {
		t.Px[i] = lut.Round(v)
	}
	return &lut.Document{LUT: hash, Kind: "material", Tex: t}
}

func TestCreateLoadSave(t *testing.T) {
	dir := t.TempDir()
	p, err := Create(dir, "My Mod")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Variants) != 1 || p.Variants[0].Folder != "default" || p.GUID == "" {
		t.Fatalf("new project: %+v", p)
	}
	if _, err := Create(dir, "again"); err == nil {
		t.Fatal("Create over an existing project should fail")
	}
	p.Kit = "FS-37 Ravager"
	p.Description = "desc"
	if err := p.Save(); err != nil {
		t.Fatal(err)
	}
	q, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if q.Name != "My Mod" || q.Kit != "FS-37 Ravager" || q.Description != "desc" || q.GUID != p.GUID || q.Dir != dir {
		t.Fatalf("reloaded: %+v", q)
	}
	if _, err := q.Variant("nope"); err == nil || !strings.Contains(err.Error(), "default") {
		t.Fatalf("missing variant error: %v", err)
	}
}

func TestLoadRejects(t *testing.T) {
	if _, err := Load(t.TempDir()); err == nil {
		t.Fatal("an empty folder is not a project")
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, FileName), []byte(`{"format":"something-else/9"}`), 0o644)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "format") {
		t.Fatalf("wrong format: %v", err)
	}
}

func TestFolder(t *testing.T) {
	for in, want := range map[string]string{
		"Default": "default", "Red & Black!": "red-black", "  ": "variant", "Chrome Visor": "chrome-visor",
		"AR-23 Liberator: Desert": "ar-23-liberator-desert",
	} {
		if got := Folder(in); got != want {
			t.Errorf("Folder(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNewGUIDFormat(t *testing.T) {
	g := NewGUID()
	if len(g) != 36 || g[14] != '4' || strings.Count(g, "-") != 4 || g == NewGUID() {
		t.Fatalf("GUID %q", g)
	}
}

// Docs reads every document of a variant, reports broken and duplicate ones as problems (not errors), and re-reads
// a file after it changed (the parse cache is keyed by time and size).
func TestDocsProblemsAndCache(t *testing.T) {
	p, err := Create(t.TempDir(), "Docs")
	if err != nil {
		t.Fatal(err)
	}
	v := p.Variants[0]
	if err := WriteDoc(p.DocPath(v, "0x00000000000000aa"), material("0x00000000000000aa", 8, 0.25)); err != nil {
		t.Fatal(err)
	}
	if err := WriteDoc(p.DocPath(v, "0x00000000000000bb"), material("0x00000000000000bb", 4, 0.5)); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(p.DocPath(v, "0x00000000000000cc"), []byte(`{"broken": true`), 0o644)
	// the same LUT under a second file name
	b, _ := os.ReadFile(p.DocPath(v, "0x00000000000000aa"))
	os.WriteFile(filepath.Join(p.VariantDir(v), "copy.lut.json"), b, 0o644)

	docs, problems, err := p.Docs(v)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 || len(problems) != 2 {
		t.Fatalf("%d docs, problems %q", len(docs), problems)
	}
	if docs[0].Tex.Px[0] != 0.25 {
		t.Fatalf("first doc px %v", docs[0].Tex.Px[0])
	}
	// changing the file is seen on the next read
	time.Sleep(20 * time.Millisecond)
	if err := WriteDoc(p.DocPath(v, "0x00000000000000aa"), material("0x00000000000000aa", 8, 0.75)); err != nil {
		t.Fatal(err)
	}
	docs, _, _ = p.Docs(v)
	if docs[0].Tex.Px[0] != 0.75 {
		t.Fatalf("after rewrite: %v (stale cache)", docs[0].Tex.Px[0])
	}
	// callers get copies: changing a returned document doesn't change the next read
	docs[0].Note = "changed by a caller"
	again, _, _ := p.Docs(v)
	if again[0].Note == "changed by a caller" {
		t.Fatal("Docs returned a shared document")
	}
}

// folder names never a Windows device name (Windows can't make or open those folders)
func TestFolderReserved(t *testing.T) {
	for in, want := range map[string]string{"Con": "con-1", "NUL": "nul-1", "Aux": "aux-1", "Com1": "com1-1", "LPT9": "lpt9-1", "Console": "console", "Com10": "com10", "Prn!": "prn-1"} {
		if got := Folder(in); got != want {
			t.Errorf("Folder(%q) = %q, want %q", in, got, want)
		}
	}
}
