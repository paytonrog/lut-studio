package appcfg

import (
	"fmt"
	"path/filepath"
	"testing"
)

// Settings live in $LUTSTUDIO_CONFIG_DIR when set (so tests never touch the user's), and the recent list is
// newest first, without duplicates, at most 12.
func TestRecentAndDirs(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LUTSTUDIO_CONFIG_DIR", dir)
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(dir, "cache"))
	if Dir() != dir || CacheDir() != filepath.Join(dir, "cache") {
		t.Fatalf("Dir %q CacheDir %q", Dir(), CacheDir())
	}
	if c := Load(); len(c.Recent) != 0 {
		t.Fatalf("fresh config: %+v", c)
	}
	for i := 0; i < 14; i++ {
		AddRecent(filepath.Join(dir, fmt.Sprint("p", i)))
	}
	AddRecent(filepath.Join(dir, "p5"))
	c := Load()
	if len(c.Recent) != 12 || filepath.Base(c.Recent[0]) != "p5" || filepath.Base(c.Recent[1]) != "p13" {
		t.Fatalf("recent: %v", c.Recent)
	}
	seen := map[string]bool{}
	for _, r := range c.Recent {
		if seen[r] {
			t.Fatalf("duplicate %s", r)
		}
		seen[r] = true
	}
	Update(func(c *Config) { c.ProjectsDir = filepath.Join(dir, "projects") })
	if Load().ProjectsFolder() != filepath.Join(dir, "projects") {
		t.Fatal("ProjectsDir not used")
	}
}
