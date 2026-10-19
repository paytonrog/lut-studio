// Package server is LUT Studio's API: the editor and start page in web/ (a static site) ask it for the install's
// items, models and textures and the project's LUTs, and save through it. On the website it runs in a Web Worker
// (web_js.go); it reads the install and writes only inside the project folder (plus the settings and presets).
package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"lutstudio/appcfg"
	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/modpack"
	"lutstudio/project"
)

type Server struct {
	Version string
	// Build builds the mod zip of the project in dir, reporting to w; returns the zip path.
	Build func(dir string, w io.Writer) (string, error)
	// NewProject creates a project in dir with the LUTs of a kit name or a 0x LUT hash.
	NewProject func(dir, name, what string) error
	// ImportMod creates a project in dir from an existing mod's LUTs (and its decal sheets and cape designs);
	// returns a report.
	ImportMod func(dir string, im *modpack.Imported) (string, error)
	// ModOptions: how a mod is read for ImportMod (the textures to take besides LUTs); nil: LUTs only
	ModOptions func() modpack.Options
	// Pull adds the LUTs of a kit name or "kit:<id>" to every variant of the project in dir, labeled as by
	// NewProject.
	Pull func(dir, what string) error
	// OpenGame opens an install folder ("" = the saved one, else detect through Steam).
	OpenGame func(dir string) (*game.Game, *game.Index, *game.Assets, error)

	noticeMu sync.Mutex
	notices  []Notice

	mu sync.Mutex // project file writes

	themes  []themeUndo // the themes applied lately, the last one last: their files as they were before (POST /api/theme/undo), under mu
	themeID int

	colorMu sync.Mutex
	colors  map[string]string // kit id -> color name (kitLabel)

	st      sync.RWMutex // the state below
	dir     string       // open project ("" = start page)
	g       *game.Game
	assets  *game.Assets
	idx     *game.Index
	gameErr string
}

// SetGame installs an opened install (or the error that kept it from opening).
func (s *Server) SetGame(g *game.Game, idx *game.Index, a *game.Assets, err error) {
	s.st.Lock()
	defer s.st.Unlock()
	s.g, s.idx, s.assets, s.gameErr = g, idx, a, ""
	if err != nil {
		s.gameErr = err.Error()
	}
}

// SetProject opens a project folder ("" closes it).
func (s *Server) SetProject(dir string) error {
	if dir != "" {
		if _, err := project.Load(dir); err != nil {
			return err
		}
		appcfg.AddRecent(dir)
	}
	s.st.Lock()
	s.dir = dir
	s.st.Unlock()
	return nil
}

func (s *Server) curDir() string         { s.st.RLock(); defer s.st.RUnlock(); return s.dir }
func (s *Server) game() *game.Game       { s.st.RLock(); defer s.st.RUnlock(); return s.g }
func (s *Server) index() *game.Index     { s.st.RLock(); defer s.st.RUnlock(); return s.idx }
func (s *Server) assetsOf() *game.Assets { s.st.RLock(); defer s.st.RUnlock(); return s.assets }

// needs guards an API route: a game install and / or an open project must be there.
func (s *Server) needs(gameNeeded, projectNeeded bool, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gameNeeded && s.game() == nil {
			fail(w, 503, fmt.Errorf("the Helldivers 2 folder is not set"))
			return
		}
		if projectNeeded && s.curDir() == "" {
			fail(w, 409, fmt.Errorf("no project is open"))
			return
		}
		h(w, r)
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/home", s.home)
	mux.HandleFunc("POST /api/open", s.open)
	mux.HandleFunc("POST /api/close", func(w http.ResponseWriter, r *http.Request) { s.SetProject(""); writeJSON(w, "ok") })
	mux.HandleFunc("POST /api/gamedir", s.gameDir)
	mux.HandleFunc("GET /api/kits", s.needs(true, false, s.kits))
	mux.HandleFunc("POST /api/new", s.needs(true, false, s.newProject))
	mux.HandleFunc("GET /api/presets", s.getPresets)
	mux.HandleFunc("PUT /api/presets", s.putPresets)
	mux.HandleFunc("GET /api/presets/where", s.presetsWhere)
	mux.HandleFunc("GET /api/roles", s.getRoles)
	mux.HandleFunc("PUT /api/roles", s.putRoles)
	mux.HandleFunc("GET /api/roles/export", s.exportRoles)
	mux.HandleFunc("GET /api/roles/suggest", s.needs(true, false, s.suggestRolesAPI))
	mux.HandleFunc("POST /api/theme", s.needs(true, true, s.applyTheme))
	mux.HandleFunc("POST /api/theme/undo", s.needs(true, false, s.undoTheme))
	mux.HandleFunc("GET /api/theme/sizes", s.needs(true, false, s.themeSizes))
	mux.HandleFunc("POST /api/lut/file", s.lutFile)
	mux.HandleFunc("POST /api/lut/read", s.lutRead)
	mux.HandleFunc("GET /api/state", s.needs(false, true, s.state))
	mux.HandleFunc("GET /api/schema", s.schema)
	mux.HandleFunc("GET /api/doc", s.needs(false, true, s.getDoc))
	mux.HandleFunc("PUT /api/doc", s.needs(false, true, s.putDoc))
	mux.HandleFunc("GET /api/vanilla", s.needs(true, false, s.vanilla))
	mux.HandleFunc("GET /api/variantdata", s.needs(true, true, s.variantData))
	mux.HandleFunc("GET /api/kit", s.needs(true, false, s.kit))
	// a weapon kit's attachment slots and the attachments each can show (?id=<kit id>: "w<entity>[.<scheme>]"; all=1:
	// every attachment that fits, not only the weapon's own list), with the credit for the lists (the wiki's)
	mux.HandleFunc("GET /api/attachments", s.needs(true, false, func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Query().Get("id"), "kit:")
		var ent uint64
		if _, err := fmt.Sscanf(id, "w%16x", &ent); err != nil {
			fail(w, 400, fmt.Errorf("not a weapon kit: %q", id))
			return
		}
		slots, err := s.game().WeaponOptions(ent, r.URL.Query().Get("all") == "1")
		if err != nil {
			fail(w, 404, err)
			return
		}
		wa := game.WikiAttachments()
		writeJSON(w, map[string]any{"slots": slots, "source": wa.Source, "license": wa.License, "edited": wa.Edited})
	}))
	mux.HandleFunc("GET /api/unit", s.needs(true, false, s.unit))
	mux.HandleFunc("GET /api/tex", s.needs(true, false, s.tex))
	// a SpeedTree tree as glTF binary (?hash=<resource path or 0x hash>; game.SpeedTreeGLB)
	mux.HandleFunc("GET /api/speedtree", s.needs(true, false, s.speedTree))
	mux.HandleFunc("GET /api/sheet", s.needs(true, true, s.sheetGet))
	mux.HandleFunc("PUT /api/sheet", s.needs(true, true, s.sheetPut))
	mux.HandleFunc("DELETE /api/sheet", s.needs(true, true, s.sheetDelete))
	// the game's baked lighting environments (reflection cubes), and one cube's faces and mips
	mux.HandleFunc("GET /api/envs", s.needs(true, false, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.game().Environments())
	}))
	mux.HandleFunc("GET /api/cube", s.needs(true, false, func(w http.ResponseWriter, r *http.Request) {
		h, err := hashParam(r)
		if err != nil {
			fail(w, 400, err)
			return
		}
		b, err := s.assetsOf().CubeBlob(h)
		if err != nil {
			fail(w, 404, err)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.Write(b)
	}))
	mux.HandleFunc("GET /api/poses", s.needs(true, false, func(w http.ResponseWriter, r *http.Request) {
		p, err := s.assetsOf().Poses()
		if err != nil {
			fail(w, 500, err)
			return
		}
		writeJSON(w, p)
	}))
	mux.HandleFunc("GET /api/anim", s.needs(true, false, func(w http.ResponseWriter, r *http.Request) {
		h, err := hashParam(r)
		if err != nil {
			fail(w, 400, err)
			return
		}
		b, err := s.assetsOf().AnimationJSON(h)
		if err != nil {
			fail(w, notFoundOr500(err), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	}))
	mux.HandleFunc("POST /api/variant", s.needs(false, true, s.newVariant))
	mux.HandleFunc("POST /api/pull", s.needs(true, true, s.pull))
	mux.HandleFunc("POST /api/image", s.needs(false, true, s.image))
	mux.HandleFunc("GET /api/image", s.needs(false, true, s.getImage))
	mux.HandleFunc("DELETE /api/image", s.needs(false, true, s.deleteImage))
	mux.HandleFunc("PUT /api/variant", s.needs(false, true, s.putVariant))
	mux.HandleFunc("DELETE /api/variant", s.needs(false, true, s.deleteVariant))
	mux.HandleFunc("POST /api/variants/order", s.needs(false, true, s.orderVariants))
	mux.HandleFunc("PUT /api/options", s.needs(false, true, s.putOptions))
	mux.HandleFunc("GET /api/texusers", s.needs(true, false, s.texUsers))
	mux.HandleFunc("POST /api/build", s.needs(true, true, s.build))
	mux.HandleFunc("GET /api/download", s.needs(false, true, s.download))
	mux.HandleFunc("PUT /api/project", s.needs(false, true, s.putProject))
	mux.HandleFunc("POST /api/saveas", s.needs(false, true, s.saveAs))
	mux.HandleFunc("GET /api/export", s.needs(false, true, s.exportProject))
	mux.HandleFunc("POST /api/import", s.importProject)
	mux.HandleFunc("POST /api/importmod", s.importMod)
	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, err error) {
	http.Error(w, err.Error(), code)
}

func (s *Server) project() (*project.Project, error) { return project.Load(s.curDir()) }

type lutInfo struct {
	LUT  string `json:"lut"`
	Kind string `json:"kind"`
	Note string `json:"note"`
}

type variantInfo struct {
	project.Variant
	LUTs     []lutInfo     `json:"luts"`
	Textures []textureInfo `json:"textures,omitempty"` // its edited decal sheets and cape designs (decals.go)
	Problems []string      `json:"problems,omitempty"`
}

type textureInfo struct {
	Hash string `json:"hash"`
	Kind string `json:"kind"` // "decal sheet" | "cape design"
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	users, parts := map[string][]string{}, map[string][]game.Part{}
	if s.index() != nil {
		users, parts = s.index().Users(), s.index().Parts()
	}
	out := struct {
		Project  *project.Project       `json:"project"`
		Variants []variantInfo          `json:"variants"`
		Kits     []string               `json:"kits"`   // kit keys (game.Index.Key), the project's own first
		Labels   map[string]string      `json:"labels"` // kit key -> name for the dropdown
		Users    map[string][]string    `json:"users"`
		Parts    map[string][]game.Part `json:"parts"` // per LUT of the project: every use (kit, slot, kind of piece)
	}{Project: p, Users: map[string][]string{}, Parts: map[string][]game.Part{}, Labels: map[string]string{}}
	kits := map[string]map[string]bool{} // kit name -> the project's LUTs it uses
	for _, v := range p.Variants {
		docs, probs, err := p.Docs(v)
		if err != nil {
			fail(w, 500, err)
			return
		}
		vi := variantInfo{Variant: v, Problems: probs}
		for _, td := range TextureDirs {
			files := project.ListFiles(filepath.Join(p.VariantDir(v), td.Dir), "0x", ".png")
			for _, f := range files {
				vi.Textures = append(vi.Textures, textureInfo{strings.TrimSuffix(filepath.Base(f), ".png"), td.What})
			}
		}
		for _, d := range docs {
			vi.LUTs = append(vi.LUTs, lutInfo{d.LUT, d.Kind, d.Note})
			out.Users[d.LUT] = users[d.LUT]
			out.Parts[d.LUT] = parts[d.LUT]
			for _, pt := range parts[d.LUT] {
				if kits[pt.Key] == nil {
					kits[pt.Key] = map[string]bool{}
				}
				kits[pt.Key][d.LUT] = true
			}
		}
		out.Variants = append(out.Variants, vi)
	}
	for k := range kits {
		out.Kits = append(out.Kits, k)
		out.Labels[k] = k
		if ks := s.index().ByKey(k); len(ks) > 0 {
			out.Labels[k] = s.kitLabel(ks[0])
		}
	}
	// the project's own armor first (the editor opens the first): the kit using the most of its LUTs, named kits
	// before unnamed ones (other kits share some LUTs: A-9 Helljumper's with A-35 Recon and 6344ad57)
	own := p.Kit // the kit the project was made from: "kit:<id>" from the item menu, here as its key (its name)
	if idx := s.index(); idx != nil {
		if ks := idx.ByKey(own); len(ks) > 0 {
			own = idx.Key(ks[0])
		}
	}
	sort.Slice(out.Kits, func(i, j int) bool {
		a, b := out.Kits[i], out.Kits[j]
		if own != "" && (a == own) != (b == own) {
			return a == own
		}
		if len(kits[a]) != len(kits[b]) {
			return len(kits[a]) > len(kits[b])
		}
		if unnamedKit(a) != unnamedKit(b) {
			return !unnamedKit(a)
		}
		return a < b
	})
	writeJSON(w, out)
}

type fieldJSON struct {
	Group  string   `json:"group"`
	Key    string   `json:"key"`
	Kind   string   `json:"kind"`
	Leaves [][2]int `json:"leaves"`
	Sub    []string `json:"sub,omitempty"`
	Min    float64  `json:"min"`
	Max    float64  `json:"max"`
	Int    bool     `json:"int,omitempty"`
	Doc    string   `json:"doc"`
	Hidden bool     `json:"hidden,omitempty"` // not offered for editing
}

func fieldsJSON(fs []lut.Field) []fieldJSON {
	var out []fieldJSON
	for _, f := range fs {
		fj := fieldJSON{Group: f.Group, Key: f.Key, Kind: [...]string{"scalar", "color", "recipe"}[f.Kind], Sub: f.Sub,
			Min: f.Min, Max: f.Max, Int: f.Int, Doc: f.Doc, Hidden: f.Hidden}
		for _, l := range f.Leaves {
			fj.Leaves = append(fj.Leaves, [2]int{l.Col, l.Ch})
		}
		out = append(out, fj)
	}
	return out
}

func (s *Server) schema(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"groups": lut.Groups, "material": fieldsJSON(lut.Material), "pattern": fieldsJSON(lut.Pattern), "cape": fieldsJSON(lut.Cape)})
}

// texJSON is a LUT for the browser: texels as floats (already rounded to half precision).
type texJSON struct {
	LUT    string    `json:"lut"`
	Kind   string    `json:"kind"`
	Note   string    `json:"note,omitempty"`
	Labels []string  `json:"labels,omitempty"`
	W      int       `json:"w"`
	H      int       `json:"h"`
	Px     []float32 `json:"px"`
}

func (s *Server) docPath(r *http.Request) (*project.Project, project.Variant, string, error) {
	p, err := s.project()
	if err != nil {
		return nil, project.Variant{}, "", err
	}
	v, err := p.Variant(r.URL.Query().Get("variant"))
	if err != nil {
		return nil, v, "", err
	}
	h, err := lut.ParseHash(r.URL.Query().Get("lut"))
	if err != nil {
		return nil, v, "", err
	}
	return p, v, p.DocPath(v, lut.HashString(h)), nil
}

func readDoc(path string) (*lut.Document, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	d := &lut.Document{}
	if err := json.Unmarshal(b, d); err != nil {
		return nil, fmt.Errorf("%s:\n%w", filepath.Base(path), err)
	}
	return d, nil
}

func docJSON(d *lut.Document) texJSON {
	return texJSON{LUT: d.LUT, Kind: d.Kind, Note: d.Note, Labels: d.Labels, W: d.Tex.Width, H: d.Tex.Height, Px: d.Tex.Px}
}

// variantData: every LUT of a variant, its document and the game's values, in one answer (an overhaul has 800 LUTs;
// one request each took 24 s to open)
func (s *Server) variantData(w http.ResponseWriter, r *http.Request) {
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	v, err := p.Variant(r.URL.Query().Get("variant"))
	if err != nil {
		fail(w, 400, err)
		return
	}
	docs, _, err := p.Docs(v)
	if err != nil {
		fail(w, 500, err)
		return
	}
	out := struct {
		Docs    map[string]texJSON `json:"docs"`
		Vanilla map[string]texJSON `json:"vanilla"`
	}{map[string]texJSON{}, map[string]texJSON{}}
	for _, d := range docs {
		out.Docs[d.LUT] = docJSON(d)
		if h, err := lut.ParseHash(d.LUT); err == nil {
			if t, err := s.game().ReadLUT(h); err == nil {
				kind, _ := lut.KindOf(t)
				out.Vanilla[d.LUT] = texJSON{LUT: d.LUT, Kind: kind, W: t.Width, H: t.Height, Px: t.Px}
			}
		}
	}
	writeJSON(w, out)
}

func (s *Server) getDoc(w http.ResponseWriter, r *http.Request) {
	_, _, path, err := s.docPath(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	d, err := readDoc(path)
	if err != nil {
		fail(w, 422, err)
		return
	}
	writeJSON(w, docJSON(d))
}

func (s *Server) putDoc(w http.ResponseWriter, r *http.Request) {
	_, _, path, err := s.docPath(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	var in struct {
		Labels []string  `json:"labels"`
		Px     []float32 `json:"px"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := readDoc(path) // keeps kind, note, size
	if err != nil {
		fail(w, 422, err)
		return
	}
	if len(in.Px) != len(d.Tex.Px) {
		fail(w, 400, fmt.Errorf("%d values for a %dx%d LUT", len(in.Px), d.Tex.Width, d.Tex.Height))
		return
	}
	for i, v := range in.Px {
		if !lut.MarkChannel(d.Tex.Width, i) { // (the build mark's channels keep what the project has: the game's values)
			d.Tex.Px[i] = lut.Round(v)
		}
	}
	if in.Labels != nil {
		d.Labels = in.Labels
	}
	if err := project.WriteDoc(path, d); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, docJSON(d))
}

func (s *Server) vanilla(w http.ResponseWriter, r *http.Request) {
	h, err := lut.ParseHash(r.URL.Query().Get("lut"))
	if err != nil {
		fail(w, 400, err)
		return
	}
	t, err := s.game().ReadLUT(h)
	if err != nil {
		fail(w, 404, err)
		return
	}
	kind, _ := lut.KindOf(t)
	writeJSON(w, texJSON{LUT: lut.HashString(h), Kind: kind, W: t.Width, H: t.Height, Px: t.Px})
}

func (s *Server) kit(w http.ResponseWriter, r *http.Request) {
	if s.index() == nil {
		fail(w, 503, fmt.Errorf("no kit index"))
		return
	}
	type piece struct {
		game.Piece
		KitType  string         `json:"kit_type"`
		KitID    string         `json:"kit_id"`
		KitUnits []game.KitUnit `json:"kit_units,omitempty"` // vehicles: every unit to show
	}
	var out []piece
	key := r.URL.Query().Get("name") // a kit key: a name, or "kit:<id>"
	if id := r.URL.Query().Get("id"); id != "" {
		key = "kit:" + id
	}
	for _, k := range s.index().ByKey(key) {
		for _, p := range k.Pieces {
			out = append(out, piece{p, k.Type, k.ID, k.Units})
		}
	}
	writeJSON(w, out)
}

func hashParam(r *http.Request) (uint64, error) { return lut.ParseHash(r.URL.Query().Get("hash")) }

func (s *Server) unit(w http.ResponseWriter, r *http.Request) {
	h, err := hashParam(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	b, err := s.assetsOf().UnitGLB(h)
	if err != nil {
		fail(w, notFoundOr500(err), err)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Write(b)
}

func (s *Server) speedTree(w http.ResponseWriter, r *http.Request) {
	h, err := game.ResourceHash(r.URL.Query().Get("hash"))
	if err != nil {
		fail(w, 400, err)
		return
	}
	if !s.game().HasSpeedTree(h) {
		fail(w, 404, fmt.Errorf("the game has no SpeedTree tree %s", lut.HashString(h)))
		return
	}
	b, err := s.assetsOf().SpeedTreeGLB(h)
	if err != nil {
		fail(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "model/gltf-binary")
	w.Write(b)
}

func (s *Server) tex(w http.ResponseWriter, r *http.Request) {
	var h uint64
	var err error
	switch r.URL.Query().Get("hash") {
	case "detail":
		h = game.DetailTilerArray
	case "brdf":
		h = game.IBLBRDFLut
	case "specbrdf":
		h = game.IBLSpecularBRDFLut
	default:
		if h, err = hashParam(r); err != nil {
			fail(w, 400, err)
			return
		}
	}
	b := s.editedTex(r, h) // (a project variant's edited decal sheet or cape design, decals.go)
	if b != nil {
		w.Header().Set("X-Edited", "1")
	} else {
		if b, err = s.assetsOf().TextureBlob(h); err != nil {
			fail(w, 404, err)
			return
		}
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.Write(b)
}

func (s *Server) newVariant(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, From string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || strings.TrimSpace(in.Name) == "" {
		fail(w, 400, fmt.Errorf("variant needs a name"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	src, err := p.Variant(in.From)
	if err != nil {
		fail(w, 400, err)
		return
	}
	nv := project.Variant{Name: strings.TrimSpace(in.Name), Folder: project.Folder(in.Name)}
	folder, err := FreeVariantFolder(p, nv.Name)
	if err != nil {
		fail(w, 409, err)
		return
	}
	nv.Folder = folder
	if _, err := CopyVariant(p, src, nv); err != nil {
		fail(w, 500, err)
		return
	}
	p.Variants = append(p.Variants, nv)
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	CopyThemeRecord(p, src.Folder, nv.Folder) // (the copy's themed zones stay themed, not "changed by hand")
	writeJSON(w, nv)
}

// pull adds a vanilla LUT to every variant that lacks it.
func (s *Server) pull(w http.ResponseWriter, r *http.Request) {
	var in struct{ LUT string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, 400, err)
		return
	}
	// a whole kit: a kit key (a name or "kit:<id>"): another armor added to the project, a worn cape
	if !strings.HasPrefix(strings.ToLower(in.LUT), "0x") && s.Pull != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		p, err := s.project()
		if err != nil {
			fail(w, 500, err)
			return
		}
		if err := s.Pull(p.Dir, in.LUT); err != nil {
			fail(w, 422, err)
			return
		}
		writeJSON(w, map[string]int{"added": 1})
		return
	}
	h, err := lut.ParseHash(in.LUT)
	if err != nil {
		fail(w, 400, err)
		return
	}
	t, err := s.game().ReadLUT(h)
	if err != nil {
		fail(w, 404, err)
		return
	}
	kind, err := lut.KindOf(t)
	if err != nil {
		fail(w, 422, err)
		return
	}
	note := ""
	if s.index() != nil {
		if u := s.index().Users()[lut.HashString(h)]; len(u) > 0 {
			note = "Used by " + strings.Join(u, ", ")
			if len(u) > 6 {
				note = fmt.Sprintf("Used by %s and %d more", strings.Join(u[:6], ", "), len(u)-6)
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	added := 0
	for _, v := range p.Variants {
		path := p.DocPath(v, lut.HashString(h))
		if _, err := os.Stat(path); err == nil {
			continue
		}
		d := &lut.Document{LUT: lut.HashString(h), Kind: kind, Note: note, Tex: t}
		if err := project.WriteDoc(path, d); err != nil {
			fail(w, 500, err)
			return
		}
		added++
	}
	writeJSON(w, map[string]int{"added": added})
}

// image stores a PNG rendered by the editor as the mod icon ("icon") or a variant's image (variant folder).
func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Target, PNG string // PNG: data URL or base64
		Auto        bool   // rendered automatically at build time (re-rendered at every build)
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&in); err != nil {
		fail(w, 400, err)
		return
	}
	data, err := base64.StdEncoding.DecodeString(in.PNG[strings.IndexByte(in.PNG, ',')+1:])
	if err != nil || !bytes.HasPrefix(data, []byte("\x89PNG")) {
		fail(w, 400, fmt.Errorf("not a PNG"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	ref, err := imageRef(p, in.Target) // (modpage.go: the icon, the choice's picture, a variant's, an option's)
	if err != nil {
		fail(w, 400, err)
		return
	}
	rel := ref.rel
	ref.set(rel)
	if ref.auto != nil {
		*ref.auto = in.Auto
	}
	os.MkdirAll(filepath.Dir(filepath.Join(p.Dir, rel)), 0o755)
	if err := os.WriteFile(filepath.Join(p.Dir, rel), data, 0o644); err != nil {
		fail(w, 500, err)
		return
	}
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"path": rel})
}

func (s *Server) build(w http.ResponseWriter, r *http.Request) {
	var log bytes.Buffer
	// (the project's files as a whole: no save or theme write halfway through while it reads them; released however
	// the build ends, a panic too)
	path, err := func() (string, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.Build(s.curDir(), &log) }()
	out := map[string]any{"ok": err == nil, "log": log.String(), "path": path}
	if err != nil {
		out["error"] = err.Error()
	}
	writeJSON(w, out)
}

// FreeVariantFolder: the folder for a new variant named name: its own (project.Folder), numbered when another
// variant's name makes the same one ("Красный" and "Синий" are both "variant": variant, variant-2); an error when a
// variant has that name already
func FreeVariantFolder(p *project.Project, name string) (string, error) {
	for _, v := range p.Variants {
		if strings.EqualFold(strings.TrimSpace(v.Name), strings.TrimSpace(name)) {
			return "", fmt.Errorf("a variant is named %q already", v.Name)
		}
	}
	base := project.Folder(name)
	for i := 1; ; i++ {
		f := base
		if i > 1 {
			f = fmt.Sprintf("%s-%d", base, i)
		}
		if _, err := p.Variant(f); err != nil {
			return f, nil
		}
	}
}

// notFoundOr500: 404 for something the game doesn't have, else 500
func notFoundOr500(err error) int {
	if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no such") {
		return 404
	}
	return 500
}
