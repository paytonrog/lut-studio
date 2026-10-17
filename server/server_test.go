package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"lutstudio/appcfg"
	"lutstudio/lut"
	"lutstudio/project"
)

// The API without a game install: everything about projects works on files alone. Settings go to a scratch
// folder ($LUTSTUDIO_CONFIG_DIR), never the user's.

type client struct {
	t  *testing.T
	ts *httptest.Server
}

func (c client) do(method, path string, body any) (int, []byte) {
	c.t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		r = bytes.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		r = bytes.NewReader(j)
	}
	req, _ := http.NewRequest(method, c.ts.URL+path, r)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

// json does a request that must succeed and decodes the answer.
func (c client) json(method, path string, body any, v any) {
	c.t.Helper()
	code, out := c.do(method, path, body)
	if code != 200 {
		c.t.Fatalf("%s %s: %d %s", method, path, code, out)
	}
	if v != nil {
		if err := json.Unmarshal(out, v); err != nil {
			c.t.Fatalf("%s %s: %v (%s)", method, path, err, out)
		}
	}
}

func setup(t *testing.T) (client, string) {
	cfg := t.TempDir()
	t.Setenv("LUTSTUDIO_CONFIG_DIR", cfg)
	appcfg.Update(func(c *appcfg.Config) { c.ProjectsDir = filepath.Join(cfg, "projects") })
	dir := filepath.Join(t.TempDir(), "mod")
	p, err := project.Create(dir, "Test Mod")
	if err != nil {
		t.Fatal(err)
	}
	for i, h := range []string{"0x00000000000000aa", "0x00000000000000bb"} {
		tex := lut.New(lut.MaterialWidth, 8)
		for k := range tex.Px {
			tex.Px[k] = lut.Round(float32(i+1) / 4)
		}
		if err := project.WriteDoc(p.DocPath(p.Variants[0], h), &lut.Document{LUT: h, Kind: "material", Tex: tex}); err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{Version: "test"}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return client{t, ts}, dir
}

func TestGuards(t *testing.T) {
	c, _ := setup(t)
	if code, _ := c.do("GET", "/api/kits", nil); code != 503 {
		t.Errorf("kits without a game: %d, want 503", code)
	}
	if code, _ := c.do("GET", "/api/state", nil); code != 409 {
		t.Errorf("state without a project: %d, want 409", code)
	}
	if code, _ := c.do("POST", "/api/importmod", []byte{}); code != 503 {
		t.Errorf("importmod without a game: %d, want 503", code)
	}
	if code, _ := c.do("POST", "/api/open", map[string]string{"Path": t.TempDir()}); code == 200 {
		t.Error("opened a folder that is no project")
	}
}

func TestProjectWorkflow(t *testing.T) {
	c, dir := setup(t)
	var home map[string]any
	c.json("GET", "/api/home", nil, &home)
	if home["version"] != "test" || home["game_ok"] != false || home["project"] != "" {
		t.Fatalf("home: %v", home)
	}
	c.json("POST", "/api/open", map[string]string{"Path": dir}, nil)
	c.json("GET", "/api/home", nil, &home)
	if rec := home["recent"].([]any); len(rec) != 1 {
		t.Fatalf("recent after open: %v", rec)
	}

	var st struct {
		Project  project.Project `json:"project"`
		Variants []struct {
			Folder string `json:"folder"`
			LUTs   []struct {
				LUT  string `json:"lut"`
				Kind string `json:"kind"`
			} `json:"luts"`
		} `json:"variants"`
	}
	c.json("GET", "/api/state", nil, &st)
	if st.Project.Name != "Test Mod" || len(st.Variants) != 1 || len(st.Variants[0].LUTs) != 2 {
		t.Fatalf("state: %+v", st)
	}

	// a document edit: written, read back rounded to half precision; a wrong size is refused
	var doc struct {
		Px     []float32 `json:"px"`
		Labels []string  `json:"labels"`
	}
	c.json("GET", "/api/doc?variant=default&lut=0x00000000000000aa", nil, &doc)
	if len(doc.Px) != 23*8*4 || doc.Px[0] != 0.25 {
		t.Fatalf("doc: %d px, first %v", len(doc.Px), doc.Px[0])
	}
	doc.Px[0] = 0.123456
	c.json("PUT", "/api/doc?variant=default&lut=0x00000000000000aa", map[string]any{"px": doc.Px, "labels": []string{"visor"}}, nil)
	c.json("GET", "/api/doc?variant=default&lut=0x00000000000000aa", nil, &doc)
	if doc.Px[0] != lut.Round(0.123456) || len(doc.Labels) == 0 || doc.Labels[0] != "visor" {
		t.Fatalf("after edit: %v %v", doc.Px[0], doc.Labels)
	}
	if code, _ := c.do("PUT", "/api/doc?variant=default&lut=0x00000000000000aa", map[string]any{"px": []float32{1, 2, 3}}); code == 200 {
		t.Error("a document of the wrong size was accepted")
	}
	if code, _ := c.do("GET", "/api/doc?variant=nope&lut=0x00000000000000aa", nil); code == 200 {
		t.Error("unknown variant accepted")
	}

	// a second variant copies the first; renaming the project
	c.json("POST", "/api/variant", map[string]string{"Name": "Night", "From": "default"}, nil)
	c.json("PUT", "/api/project", map[string]string{"Name": "Renamed", "Description": "new"}, nil)
	c.json("GET", "/api/state", nil, &st)
	if st.Project.Name != "Renamed" || len(st.Variants) != 2 || len(st.Variants[1].LUTs) != 2 {
		t.Fatalf("after variant + rename: %+v", st)
	}
	c.json("GET", "/api/doc?variant=night&lut=0x00000000000000aa", nil, &doc)
	if doc.Px[0] != lut.Round(0.123456) {
		t.Fatal("the new variant didn't copy the edit")
	}

	// the mod page: the choice named, a variant renamed and described, pictures set and reset, the variants
	// reordered, one deleted into .trash (the last one stays)
	c.json("PUT", "/api/project", map[string]string{"Name": "Renamed", "Description": "new", "Option": "Armor color", "OptionDescription": "Pick"}, nil)
	c.json("PUT", "/api/variant", map[string]string{"Folder": "night", "Name": "Night Ops", "Description": "dark"}, nil)
	png := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("\x89PNG test"))
	for _, target := range []string{"icon", "option", "night"} {
		c.json("POST", "/api/image", map[string]any{"Target": target, "PNG": png}, nil)
		if code, b := c.do("GET", "/api/image?target="+target, nil); code != 200 || string(b) != "\x89PNG test" {
			t.Fatalf("picture %s: %d %q", target, code, b)
		}
	}
	c.json("DELETE", "/api/image?target=option", nil, nil)
	if code, _ := c.do("GET", "/api/image?target=option", nil); code != 404 {
		t.Errorf("reset picture still served: %d", code)
	}
	c.json("POST", "/api/variants/order", map[string][]string{"Folders": {"night", "default"}}, nil)
	c.json("GET", "/api/state", nil, &st)
	if st.Project.Option != "Armor color" || st.Project.OptionDescription != "Pick" || st.Variants[0].Folder != "night" ||
		st.Project.Variants[0].Name != "Night Ops" || st.Project.Variants[0].Description != "dark" || st.Project.Variants[0].Image == "" {
		t.Fatalf("after the mod page edits: %+v", st.Project)
	}
	c.json("POST", "/api/variant", map[string]string{"Name": "Spare", "From": "default"}, nil)
	c.json("DELETE", "/api/variant?folder=spare", nil, nil)
	if trash, _ := filepath.Glob(filepath.Join(dir, TrashDir, "spare-*", "*.lut.json")); len(trash) != 2 {
		t.Errorf("deleted variant not in .trash: %v", trash)
	}
	c.json("DELETE", "/api/variant?folder=default", nil, nil)
	if code, _ := c.do("DELETE", "/api/variant?folder=night", nil); code == 200 {
		t.Error("the last variant was deleted")
	}

	// export and import: a new project with the same documents, opened
	code, zip := c.do("GET", "/api/export", nil)
	if code != 200 || len(zip) < 100 {
		t.Fatalf("export: %d, %d bytes", code, len(zip))
	}
	c.json("POST", "/api/import", zip, nil)
	c.json("GET", "/api/home", nil, &home)
	if home["project"] == dir {
		t.Fatal("import didn't open the imported copy")
	}
	c.json("GET", "/api/doc?variant=night&lut=0x00000000000000aa", nil, &doc)
	if doc.Px[0] != lut.Round(0.123456) {
		t.Fatal("imported copy lost the edit")
	}
}

func TestSchemaAndPresets(t *testing.T) {
	c, _ := setup(t)
	var schema map[string]any
	c.json("GET", "/api/schema", nil, &schema)
	for _, k := range []string{"material", "pattern", "cape"} {
		if schema[k] == nil {
			t.Errorf("schema lacks %s", k)
		}
	}
	look := []map[string]any{{"name": "Mine", "kind": "material", "row": []float32{1, 2, 3}}}
	c.json("PUT", "/api/presets", look, nil)
	var back []map[string]any
	c.json("GET", "/api/presets", nil, &back)
	if len(back) != 1 || back[0]["name"] != "Mine" {
		t.Fatalf("presets: %v", back)
	}
	// kept beside the projects ("LUT Studio looks.json"), said by /api/presets/where
	var where struct{ Path string }
	c.json("GET", "/api/presets/where", nil, &where)
	if filepath.Base(where.Path) != "LUT Studio looks.json" {
		t.Errorf("looks kept at %q", where.Path)
	}
	if _, err := os.Stat(where.Path); err != nil {
		t.Errorf("looks file: %v", err)
	}
}

// looks saved before they moved beside the projects (%APPDATA%\LUTStudio\presets.json) are read until the new file is
// written
func TestPresetsFromOldPlace(t *testing.T) {
	c, _ := setup(t) // (a fresh projects folder: no looks file there yet)
	if err := os.MkdirAll(filepath.Dir(oldPresetsPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldPresetsPath(), []byte(`[{"name":"Old","kind":"material","row":[1]}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	var back []map[string]any
	c.json("GET", "/api/presets", nil, &back)
	if len(back) != 1 || back[0]["name"] != "Old" {
		t.Fatalf("old looks: %v", back)
	}
}

func TestLabelHelpers(t *testing.T) {
	if !naturalLess("version 2 of 9", "version 10 of 15") || naturalLess("b", "a") || !naturalLess("a", "ab") {
		t.Error("naturalLess")
	}
	for in, want := range map[[3]float32]string{
		{0, 0, 0}: "black", {1, 1, 1}: "white", {0.3, 0.3, 0.3}: "gray",
		{0.8, 0.02, 0.02}: "red", {0.02, 0.05, 0.6}: "blue", {0.05, 0.4, 0.05}: "green",
	} {
		if got := colorName(in[0], in[1], in[2]); got != want && got != "dark "+want && got != "light "+want {
			t.Errorf("colorName(%v) = %q, want %q", in, got, want)
		}
	}
	for n, want := range map[string]bool{"6344ad57": true, "9a7c0da": true, "A-9 Helljumper": false, "Drape": false, "abc": false} {
		if unnamedKit(n) != want {
			t.Errorf("unnamedKit(%q) != %v", n, want)
		}
	}
}

// TestSchemaDump writes /api/schema to $LUTSTUDIO_SCHEMA_OUT (for the JavaScript tests: tools/test.py).
func TestSchemaDump(t *testing.T) {
	out := os.Getenv("LUTSTUDIO_SCHEMA_OUT")
	if out == "" {
		t.Skip("LUTSTUDIO_SCHEMA_OUT not set")
	}
	c, _ := setup(t)
	code, b := c.do("GET", "/api/schema", nil)
	if code != 200 {
		t.Fatal(code)
	}
	if err := os.WriteFile(out, b, 0o644); err != nil {
		t.Fatal(err)
	}
}
