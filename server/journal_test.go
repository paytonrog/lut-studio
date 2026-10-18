package server

import (
	"os"
	"path/filepath"
	"testing"
)

// a theme's undo: a file it changed back as it was, one it made removed, each kept as it was the first time only
func TestFileJournal(t *testing.T) {
	dir := t.TempDir()
	old, made := filepath.Join(dir, "old.json"), filepath.Join(dir, "sub", "made.json")
	os.WriteFile(old, []byte("before"), 0o644)
	j := &fileJournal{}
	j.keep(old)
	os.WriteFile(old, []byte("theme 1"), 0o644)
	j.keep(old) // (a second write: the first state stays)
	os.WriteFile(old, []byte("theme 2"), 0o644)
	j.keep(made)
	os.MkdirAll(filepath.Dir(made), 0o755)
	os.WriteFile(made, []byte("new"), 0o644)
	if err := j.restore(); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(old); string(b) != "before" {
		t.Errorf("old.json = %q, want %q", b, "before")
	}
	if _, err := os.Stat(made); !os.IsNotExist(err) {
		t.Errorf("made.json still there (%v)", err)
	}
	var none *fileJournal
	none.keep(old) // (no journal: nothing kept, no panic)
}
