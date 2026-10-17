package game

import (
	"os"
	"sync"
	"testing"
)

// The install tests share one opened install and one index ($LUTSTUDIO_GAME; building the index takes seconds):
// they only read them.
var (
	installOnce  sync.Once
	installGame  *Game
	installIdx   *Index
	installError error
)

// install: the shared install and its index (the test is skipped without $LUTSTUDIO_GAME)
func install(t *testing.T) (*Game, *Index) {
	t.Helper()
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	installOnce.Do(func() {
		if installGame, installError = Open(dir); installError == nil {
			installIdx, installError = installGame.BuildIndex("")
		}
	})
	if installError != nil {
		t.Fatal(installError)
	}
	return installGame, installIdx
}
