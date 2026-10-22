package server

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"sort"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/project"
)

// After a game update. A project keeps the game's values of each of its LUTs as they were when the LUT came in
// (project.GameValuesPath) and the game it last saw (Project.Game: the install's CacheKey, its Steam build or, on the
// website, its data folder). When the game is another one, the LUTs whose game values changed since are listed (the
// project's state: game_update); POST /api/gameupdate takes the game's new values where a variant still has the old
// ones (its own edits stay), or keeps the project as it is. Either way the project is then on the new game.

// lutChange: one LUT of the project the update changed
type lutChange struct {
	LUT     string   `json:"lut"`
	Users   []string `json:"users,omitempty"`
	Changed int      `json:"changed"`        // values the update changed
	Edited  int      `json:"edited"`         // of those, values a variant changed itself (kept either way)
	Size    string   `json:"size,omitempty"` // the LUT's size changed ("23x8 -> 23x9"): nothing is taken, check it
	Gone    bool     `json:"gone,omitempty"` // the game no longer has the LUT
}

type gameUpdate struct {
	From string      `json:"from"` // Project.Game
	To   string      `json:"to"`   // the install's
	LUTs []lutChange `json:"luts"`
}

// gameSource: a game to check a project against: its key (game.Game.CacheKey) and its LUTs
type gameSource struct {
	key  string
	read func(h uint64) (*lut.Texture, error)
}

func sourceOf(g *game.Game) gameSource { return gameSource{g.CacheKey(), g.ReadLUT} }

// projectLUTs: every variant's documents, by LUT
type projectLUTs map[string][]variantDoc

type variantDoc struct {
	v project.Variant
	d *lut.Document
}

func readProjectLUTs(p *project.Project) (projectLUTs, error) {
	out := projectLUTs{}
	for _, v := range p.Variants {
		docs, _, err := p.Docs(v)
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			out[d.LUT] = append(out[d.LUT], variantDoc{v, d})
		}
	}
	return out, nil
}

func (pl projectLUTs) sorted() []string {
	var hs []string
	for h := range pl {
		hs = append(hs, h)
	}
	sort.Strings(hs)
	return hs
}

// gameValuesOf: the game's values kept in p, by LUT (a broken file counts as none: it is written again)
func gameValuesOf(p *project.Project) (map[string]*lut.Texture, error) {
	docs, _, err := p.GameValues()
	if err != nil {
		return nil, err
	}
	out := map[string]*lut.Texture{}
	for _, d := range docs {
		out[d.LUT] = d.Tex
	}
	return out, nil
}

func writeGameValues(p *project.Project, hash string, t *lut.Texture) error {
	kind, err := lut.KindOf(t)
	if err != nil {
		return nil // (not a LUT a project holds)
	}
	if err := os.MkdirAll(p.GameValuesDir(), 0o755); err != nil {
		return err
	}
	return project.WriteDoc(p.GameValuesPath(hash), &lut.Document{LUT: hash, Kind: kind, Note: "the game's values", Tex: t})
}

func sameValue(a, b float32) bool { return math.Float32bits(a) == math.Float32bits(b) }

// checkGame: the LUTs of p whose game values changed since they came in, when p last saw another game than gs (nil:
// none). LUTs without kept game values get the game's values now; a project that never saw a game, or whose LUTs
// the update left alone, is recorded as on this one. Under s.mu.
func checkGame(p *project.Project, gs gameSource) (*gameUpdate, error) {
	if gs.key == "" {
		return nil, nil
	}
	pl, err := readProjectLUTs(p)
	if err != nil {
		return nil, err
	}
	old, err := gameValuesOf(p)
	if err != nil {
		return nil, err
	}
	up := &gameUpdate{From: p.Game, To: gs.key}
	for _, h := range pl.sorted() {
		hv, _ := lut.ParseHash(h)
		o := old[h]
		if o == nil { // (came in since the last check, or a project from before game values were kept)
			if t, err := gs.read(hv); err == nil {
				if err := writeGameValues(p, h, t); err != nil {
					return nil, err
				}
			}
			continue
		}
		if p.Game == gs.key || p.Game == "" {
			continue
		}
		t, err := gs.read(hv)
		if err != nil {
			up.LUTs = append(up.LUTs, lutChange{LUT: h, Gone: true})
			continue
		}
		if t.Equal(o) {
			continue
		}
		c := lutChange{LUT: h}
		if t.Width != o.Width || t.Height != o.Height {
			c.Size = fmt.Sprintf("%dx%d -> %dx%d", o.Width, o.Height, t.Width, t.Height)
			up.LUTs = append(up.LUTs, c)
			continue
		}
		for i := range t.Px {
			if sameValue(t.Px[i], o.Px[i]) {
				continue
			}
			c.Changed++
			for _, vd := range pl[h] {
				if vd.d.Tex.Width == o.Width && vd.d.Tex.Height == o.Height && !sameValue(vd.d.Tex.Px[i], o.Px[i]) {
					c.Edited++
					break
				}
			}
		}
		up.LUTs = append(up.LUTs, c)
	}
	if len(up.LUTs) > 0 {
		return up, nil
	}
	if p.Game != gs.key {
		p.Game = gs.key
		return nil, p.Save()
	}
	return nil, nil
}

// applyGameUpdate moves p onto game gs: with take, every value the update changed that a variant still has as the
// game had it becomes the game's new value (LUTs whose size changed are left as they are); the kept game values
// become gs's. Returns how many values were taken. Under s.mu.
func applyGameUpdate(p *project.Project, gs gameSource, take bool) (int, error) {
	pl, err := readProjectLUTs(p)
	if err != nil {
		return 0, err
	}
	old, err := gameValuesOf(p)
	if err != nil {
		return 0, err
	}
	taken := 0
	for _, h := range pl.sorted() {
		hv, _ := lut.ParseHash(h)
		t, err := gs.read(hv)
		if err != nil { // (gone from the game: the project keeps its values and the old game's)
			continue
		}
		o := old[h]
		if o != nil && t.Equal(o) {
			continue
		}
		if take && o != nil && t.Width == o.Width && t.Height == o.Height {
			for _, vd := range pl[h] {
				if vd.d.Tex.Width != t.Width || vd.d.Tex.Height != t.Height {
					continue
				}
				var nt *lut.Texture // (the parsed texture is shared: changed on a copy)
				for i := range t.Px {
					if !sameValue(t.Px[i], o.Px[i]) && sameValue(vd.d.Tex.Px[i], o.Px[i]) {
						if nt == nil {
							nt = &lut.Texture{Width: t.Width, Height: t.Height, Px: append([]float32(nil), vd.d.Tex.Px...)}
						}
						nt.Px[i] = t.Px[i]
						taken++
					}
				}
				if nt != nil {
					d := *vd.d
					d.Tex = nt
					if err := project.WriteDoc(p.DocPath(vd.v, h), &d); err != nil {
						return taken, err
					}
				}
			}
		}
		if err := writeGameValues(p, h, t); err != nil {
			return taken, err
		}
	}
	p.Game = gs.key
	return taken, p.Save()
}

// gameUpdateOf: the open project's changes from a game update (nil without a game or when there are none)
func (s *Server) gameUpdateOf() (*gameUpdate, error) {
	g := s.game()
	if g == nil {
		return nil, nil
	}
	s.mu.Lock()
	p, err := s.project() // (read under the lock: checkGame may save it)
	var up *gameUpdate
	if err == nil {
		up, err = checkGame(p, sourceOf(g))
	}
	s.mu.Unlock()
	if up != nil && s.index() != nil {
		users := s.index().Users()
		for i := range up.LUTs {
			up.LUTs[i].Users = users[up.LUTs[i].LUT]
		}
	}
	return up, err
}

// postGameUpdate: {take: true} takes the game's new values where the project has the old ones, {take: false} keeps
// the project as it is; either way it is on this game afterwards.
func (s *Server) postGameUpdate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Take bool `json:"take"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	s.mu.Lock()
	p, err := s.project()
	n := 0
	if err == nil {
		n, err = applyGameUpdate(p, sourceOf(s.game()), in.Take)
	}
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]int{"taken": n})
}
