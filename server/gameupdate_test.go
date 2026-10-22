package server

import (
	"fmt"
	"path/filepath"
	"testing"

	"lutstudio/lut"
	"lutstudio/project"
)

// A game update: the project keeps the game's values of its LUTs; after an update the LUTs it changed are listed, and
// taking the new values changes only what a variant still had as the old game had it.
func TestGameUpdate(t *testing.T) {
	p, err := project.Create(filepath.Join(t.TempDir(), "mod"), "Update")
	if err != nil {
		t.Fatal(err)
	}
	const a, b, gone = "0x00000000000000aa", "0x00000000000000bb", "0x00000000000000cc"
	tex := func(v float32) *lut.Texture {
		x := lut.New(lut.MaterialWidth, 2)
		for i := range x.Px {
			x.Px[i] = lut.Round(v)
		}
		return x
	}
	v1 := map[string]*lut.Texture{a: tex(0.25), b: tex(0.5), gone: tex(0.75)}
	src := func(key string, m map[string]*lut.Texture) gameSource {
		return gameSource{key, func(h uint64) (*lut.Texture, error) {
			if t := m[lut.HashString(h)]; t != nil {
				return t, nil
			}
			return nil, fmt.Errorf("no LUT %x", h)
		}}
	}
	for _, h := range []string{a, b, gone} {
		d := &lut.Document{LUT: h, Kind: "material", Tex: v1[h]}
		if h == a { // two values edited: one the update changes (kept), one it doesn't
			d.Tex = tex(0.25)
			d.Tex.Px[0], d.Tex.Px[4] = 1, 1
		}
		if err := project.WriteDoc(p.DocPath(p.Variants[0], h), d); err != nil {
			t.Fatal(err)
		}
	}
	// first look: the game's values kept, the project on game 1, nothing to say
	if up, err := checkGame(p, src("build-1", v1)); err != nil || up != nil {
		t.Fatalf("first check: %+v %v", up, err)
	}
	if p.Game != "build-1" {
		t.Fatalf("game %q", p.Game)
	}
	// game 2 changes a's first two texels and nothing of b; cc is gone
	a2 := tex(0.25)
	a2.Px[0], a2.Px[1] = 0.125, 0.125
	v2 := map[string]*lut.Texture{a: a2, b: v1[b]}
	up, err := checkGame(p, src("build-2", v2))
	if err != nil || up == nil || len(up.LUTs) != 2 {
		t.Fatalf("after the update: %+v %v", up, err)
	}
	if c := up.LUTs[0]; c.LUT != a || c.Changed != 2 || c.Edited != 1 {
		t.Fatalf("a: %+v", c)
	}
	if c := up.LUTs[1]; c.LUT != gone || !c.Gone {
		t.Fatalf("gone: %+v", c)
	}
	n, err := applyGameUpdate(p, src("build-2", v2), true)
	if err != nil || n != 1 {
		t.Fatalf("take: %d %v", n, err)
	}
	docs, _, _ := p.Docs(p.Variants[0])
	got := docs[0].Tex.Px
	if got[0] != 1 || got[1] != 0.125 || got[4] != 1 || got[2] != 0.25 {
		t.Fatalf("a after taking: %v", got[:8])
	}
	if p, _ = project.Load(p.Dir); p.Game != "build-2" {
		t.Fatalf("game after taking %q", p.Game)
	}
	if up, err := checkGame(p, src("build-2", v2)); err != nil || up != nil {
		t.Fatalf("after taking: %+v %v", up, err)
	}
	// game 3 changes b; keeping the project's values leaves b as it is, on game 3
	b3 := tex(0.625)
	v3 := map[string]*lut.Texture{a: a2, b: b3}
	if n, err := applyGameUpdate(p, src("build-3", v3), false); err != nil || n != 0 {
		t.Fatalf("keep: %d %v", n, err)
	}
	docs, _, _ = p.Docs(p.Variants[0])
	if docs[1].Tex.Px[0] != 0.5 {
		t.Fatalf("b after keeping: %v", docs[1].Tex.Px[0])
	}
	if up, err := checkGame(p, src("build-3", v3)); err != nil || up != nil {
		t.Fatalf("after keeping: %+v %v", up, err)
	}
}
