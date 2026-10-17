package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"

	"lutstudio/game"
)

// Every armory pose turns its bones smoothly: no rotation jumps more than 90 deg between two 30 fps samples (Armory
// idle 1's left foot spun ~160 deg at 6 s while a key stored negated was sampled the long way)
func TestPosesSmooth(t *testing.T) {
	gameDir := os.Getenv("LUTSTUDIO_GAME")
	if gameDir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	t.Setenv("LUTSTUDIO_CACHE_DIR", filepath.Join(t.TempDir(), "cache"))
	e := &env{out: io.Discard, gameDir: gameDir}
	g, err := e.game()
	if err != nil {
		t.Fatal(err)
	}
	a := game.NewAssets(g, t.TempDir())
	poses, err := a.Poses()
	if err != nil || len(poses) == 0 {
		t.Fatalf("poses: %v (%d)", err, len(poses))
	}
	for _, p := range poses {
		var h uint64
		if _, err := fmt.Sscanf(p.Animation, "0x%x", &h); err != nil {
			t.Fatal(err)
		}
		b, err := a.AnimationJSON(h)
		if err != nil {
			t.Fatal(err)
		}
		var c game.Clip
		if err := json.Unmarshal(b, &c); err != nil {
			t.Fatal(err)
		}
		for _, tr := range c.Tracks {
			for i := 1; i < len(tr.R); i++ {
				q0, q1 := tr.R[i-1], tr.R[i]
				d := math.Abs(float64(q0[0]*q1[0]+q0[1]*q1[1]+q0[2]*q1[2]+q0[3]*q1[3])) /
					math.Sqrt(float64((q0[0]*q0[0]+q0[1]*q0[1]+q0[2]*q0[2]+q0[3]*q0[3])*(q1[0]*q1[0]+q1[1]*q1[1]+q1[2]*q1[2]+q1[3]*q1[3])))
				if ang := 2 * math.Acos(math.Min(1, d)) * 180 / math.Pi; ang > 90 {
					t.Errorf("%s: %s turns %.0f deg at %.2f s", p.Name, tr.Bone, ang, tr.RT[i])
					break
				}
			}
		}
	}
}
