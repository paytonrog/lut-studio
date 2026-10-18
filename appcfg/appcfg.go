// Package appcfg is LUT Studio's per-user settings: the game folder, recent projects and where new projects go.
// Stored in %APPDATA%\LUTStudio\config.json.
package appcfg

import (
	"encoding/json"
	"lutstudio/atomicfile"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

type Config struct {
	GameDir     string   `json:"game_dir,omitempty"`     // empty: detect through Steam
	ProjectsDir string   `json:"projects_dir,omitempty"` // empty: Documents\LUT Studio
	Recent      []string `json:"recent,omitempty"`       // project folders, most recent first
}

var mu sync.Mutex

// Dir is the settings folder: %APPDATA%\LUTStudio, or $LUTSTUDIO_CONFIG_DIR (tests: keeps the user's recent
// projects and looks untouched).
func Dir() string {
	if d := os.Getenv("LUTSTUDIO_CONFIG_DIR"); d != "" {
		return d
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "LUTStudio")
}

// CacheDir is the cache folder: %LOCALAPPDATA%\LUTStudio, or $LUTSTUDIO_CACHE_DIR.
func CacheDir() string {
	if d := os.Getenv("LUTSTUDIO_CACHE_DIR"); d != "" {
		return d
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "LUTStudio")
}

func path() string { return filepath.Join(Dir(), "config.json") }

func Load() Config {
	mu.Lock()
	defer mu.Unlock()
	return load()
}

// (a file that doesn't parse is kept aside as config.json.bad: the next save would otherwise wipe what was in it)
func load() Config {
	var c Config
	if b, err := os.ReadFile(path()); err == nil {
		if json.Unmarshal(b, &c) != nil {
			os.Rename(path(), path()+".bad")
			c = Config{}
		}
	}
	return c
}

func Save(c Config) error {
	mu.Lock()
	defer mu.Unlock()
	return save(c)
}

func save(c Config) error {
	os.MkdirAll(filepath.Dir(path()), 0o755)
	b, _ := json.MarshalIndent(c, "", "  ")
	return atomicfile.WriteFile(path(), append(b, '\n'), 0o644)
}

// Update loads, changes and saves the settings (under one lock: two updates at once both land).
func Update(f func(*Config)) error {
	mu.Lock()
	defer mu.Unlock()
	c := load()
	f(&c)
	return save(c)
}

// AddRecent puts a project folder first in the recent list (at most 12 kept).
func AddRecent(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	return Update(func(c *Config) {
		c.Recent = slices.DeleteFunc(c.Recent, func(s string) bool { return s == abs })
		c.Recent = append([]string{abs}, c.Recent...)
		if len(c.Recent) > 12 {
			c.Recent = c.Recent[:12]
		}
	})
}

// ProjectsFolder is where new projects are created.
func (c Config) ProjectsFolder() string {
	if c.ProjectsDir != "" {
		return c.ProjectsDir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, "Documents", "LUT Studio")
}
