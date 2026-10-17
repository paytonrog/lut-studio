package server

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"lutstudio/appcfg"
	"lutstudio/project"
)

// TestProjectList: the start page lists the recent projects, then every other project of the projects folder, so
// none drops off when more than the recent list's 12 exist
func TestProjectList(t *testing.T) {
	root := t.TempDir()
	c := appcfg.Config{ProjectsDir: root}
	for i := 0; i < 15; i++ {
		d := filepath.Join(root, fmt.Sprint("p", i))
		if _, err := project.Create(d, fmt.Sprint("Project ", i)); err != nil {
			t.Fatal(err)
		}
		if i < 12 {
			c.Recent = append(c.Recent, d)
		}
	}
	got := projectList(c)
	if len(got) != 15 {
		t.Fatalf("%d projects listed, want 15", len(got))
	}
	for i, r := range got {
		if !r.OK || r.Recent != (i < 12) {
			t.Errorf("%d: %+v", i, r)
		}
	}
}

// Project names are unique: a new project or a copy named like a listed one (case and outer spaces aside) is
// refused, imports get "name 2"; a new project never writes into a folder that exists (one without a project file
// too); a recent project is hidden as a copy of one in the projects folder only when it is that project (same GUID)
func TestProjectNames(t *testing.T) {
	c, dir := setup(t) // (projects folder: <config>/projects)
	pf := appcfg.Load().ProjectsFolder()
	if _, err := project.Create(filepath.Join(pf, "black-ravager"), "Black Ravager"); err != nil {
		t.Fatal(err)
	}
	c.json("POST", "/api/open", map[string]string{"Path": dir}, nil)
	if code, b := c.do("POST", "/api/saveas", map[string]string{"Name": " black RAVAGER "}); code != 409 {
		t.Errorf("a copy with the same name: %d %s, want 409", code, b)
	}
	if code, b := c.do("POST", "/api/saveas", map[string]string{"Name": "Green Ravager"}); code != 200 {
		t.Errorf("a copy with a new name: %d %s", code, b)
	}
	if got := uniqueName(appcfg.Load(), "Black Ravager"); got != "Black Ravager 2" {
		t.Errorf("uniqueName: %q", got)
	}
	left := filepath.Join(pf, "red-ravager")
	if err := os.MkdirAll(filepath.Join(left, "variants"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := freeDir(left); got != left+"-2" {
		t.Errorf("freeDir: %q, want %q", got, left+"-2")
	}
	// a browser project "foo" in the recent list and another project in the projects folder's "foo": both listed
	other := filepath.Join(t.TempDir(), "foo")
	if _, err := project.Create(other, "Foo (browser)"); err != nil {
		t.Fatal(err)
	}
	if _, err := project.Create(filepath.Join(pf, "foo"), "Foo (folder)"); err != nil {
		t.Fatal(err)
	}
	cfg := appcfg.Load()
	cfg.Recent = []string{other}
	names := map[string]bool{}
	for _, r := range projectList(cfg) {
		names[r.Name] = true
	}
	if !names["Foo (browser)"] || !names["Foo (folder)"] {
		t.Errorf("listed: %v", names)
	}
	// its copy (same GUID) is listed once
	if err := copyTree(other, filepath.Join(pf, "foo-copy"), func(string) bool { return true }); err != nil {
		t.Fatal(err)
	}
	cfg.Recent = []string{filepath.Join(t.TempDir(), "foo-copy")}
	copyTree(other, cfg.Recent[0], func(string) bool { return true })
	n := 0
	for _, r := range projectList(cfg) {
		if r.Name == "Foo (browser)" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("a copy listed %d times", n)
	}
}
