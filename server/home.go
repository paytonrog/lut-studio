package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"lutstudio/atomicfile"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"lutstudio/appcfg"
	"lutstudio/game"
	"lutstudio/modpack"
	"lutstudio/project"
)

// ---------- start page: recent projects, new project, game folder

type recentInfo struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Recent bool   `json:"recent"` // in the recent list (the 12 last opened); else found in the projects folder
}

// projectList: the recent projects, then every other project in the projects folder (its subfolders holding a
// project file), most recently changed first, so none drops off the start page when the recent list is full.
func projectList(c appcfg.Config) []recentInfo {
	var out []recentInfo
	seen := map[string]bool{}
	key := func(d string) string {
		if a, err := filepath.Abs(d); err == nil {
			d = a
		}
		return strings.ToLower(filepath.Clean(d))
	}
	for _, d := range c.Recent {
		// a project copied into the projects folder (the website: from the browser's storage into a folder on disk)
		// is listed once, from the folder
		// (the same folder name and the same GUID: a copy; another project that only has the same folder name is listed)
		ri := recentInfo{Path: d, Name: filepath.Base(d), Recent: true}
		p, err := project.Load(d)
		if err == nil {
			ri.Name, ri.OK = p.Name, true
		}
		if dup := filepath.Join(c.ProjectsFolder(), filepath.Base(d)); key(dup) != key(d) {
			if q, err := project.Load(dup); err == nil && (p == nil || q.GUID == p.GUID) {
				continue
			}
		}
		seen[key(d)] = true
		out = append(out, ri)
	}
	type found struct {
		ri  recentInfo
		mod int64
	}
	var more []found
	ents, _ := os.ReadDir(c.ProjectsFolder())
	for _, e := range ents {
		d := filepath.Join(c.ProjectsFolder(), e.Name())
		st, err := os.Stat(filepath.Join(d, project.FileName))
		if !e.IsDir() || err != nil || seen[key(d)] {
			continue
		}
		ri := recentInfo{Path: d, Name: e.Name()}
		if p, err := project.Load(d); err == nil {
			ri.Name, ri.OK = p.Name, true
		}
		more = append(more, found{ri, st.ModTime().UnixNano()})
	}
	sort.Slice(more, func(i, j int) bool { return more[i].mod > more[j].mod })
	for _, f := range more {
		out = append(out, f.ri)
	}
	return out
}

// projectNamed: the folder of the listed project (projectList) named name, ignoring case and outer spaces; "" none
func projectNamed(c appcfg.Config, name string) string {
	want := strings.ToLower(strings.TrimSpace(name))
	for _, ri := range projectList(c) {
		if ri.OK && strings.ToLower(strings.TrimSpace(ri.Name)) == want {
			return ri.Path
		}
	}
	return ""
}

// uniqueName: name, else "name 2", "name 3"…: the first no listed project has
func uniqueName(c appcfg.Config, name string) string {
	out := name
	for i := 2; projectNamed(c, out) != ""; i++ {
		out = fmt.Sprintf("%s %d", name, i)
	}
	return out
}

// freeDir: base, else base-2, base-3…: the first that doesn't exist (a folder left without a project file is never
// written into)
func freeDir(base string) string {
	dir := base
	for i := 2; ; i++ {
		if _, err := os.Stat(dir); err != nil {
			return dir
		}
		dir = fmt.Sprintf("%s-%d", base, i)
	}
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	c := appcfg.Load()
	recent := projectList(c)
	s.st.RLock()
	gameDir, gameOK, gameErr := "", s.g != nil, s.gameErr
	if s.g != nil {
		gameDir = s.g.Dir
	}
	s.st.RUnlock()
	s.noticeMu.Lock()
	notices := append([]Notice{}, s.notices...)
	s.noticeMu.Unlock()
	writeJSON(w, map[string]any{"version": s.Version, "project": s.curDir(), "recent": recent,
		"projects_dir": c.ProjectsFolder(), "game_dir": gameDir, "game_ok": gameOK, "game_error": gameErr,
		"notices": notices})
}

// Notice is a message for the start page (an app update, an item list update, an item list older than the game).
type Notice struct {
	Kind string `json:"kind"` // update, info, warn
	Text string `json:"text"`
	URL  string `json:"url,omitempty"`
}

// SetNotices replaces the start page's notices.
func (s *Server) SetNotices(n []Notice) {
	s.noticeMu.Lock()
	defer s.noticeMu.Unlock()
	s.notices = n
}

func decode(r *http.Request, v any) error { return decodeMax(r, v, 1<<20) }

// decodeMax: decode with a body of up to max bytes (a theme's LUTLooks: a look per LUT, a few MB)
func decodeMax(r *http.Request, v any, max int64) error {
	return json.NewDecoder(io.LimitReader(r.Body, max)).Decode(v)
}

func (s *Server) open(w http.ResponseWriter, r *http.Request) {
	var in struct{ Path string }
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.Path) == "" {
		fail(w, 400, fmt.Errorf("give a project folder"))
		return
	}
	dir := strings.Trim(strings.TrimSpace(in.Path), `"`)
	if filepath.Base(dir) == project.FileName { // pasted the project file itself
		dir = filepath.Dir(dir)
	}
	if err := s.SetProject(dir); err != nil {
		fail(w, 404, err)
		return
	}
	writeJSON(w, map[string]string{"project": dir})
}

func (s *Server) gameDir(w http.ResponseWriter, r *http.Request) {
	var in struct{ Path string }
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	dir := filepath.Clean(strings.Trim(strings.TrimSpace(in.Path), `"`)) // (a trailing separator: the same folder)
	if strings.EqualFold(filepath.Base(dir), "data") {
		dir = filepath.Dir(dir)
	}
	g, idx, a, err := s.OpenGame(dir)
	if err != nil {
		fail(w, 400, err)
		return
	}
	s.SetGame(g, idx, a, nil)
	appcfg.Update(func(c *appcfg.Config) { c.GameDir = dir })
	writeJSON(w, map[string]string{"game_dir": g.Dir})
}

// gearGroups: the menu group of each kit type of game/gear.go
var gearGroups = map[string]string{game.AttachmentType: "Equipment", game.GearType: "Equipment", game.ThrowableType: "Equipment",
	game.StratagemType: "Stratagems", game.CraftType: "Eagle & craft", game.CrewType: "Ship crew", game.AutomatonType: "Automatons",
	game.IlluminateType: "Illuminate", game.ObjectiveType: "Objectives", game.ShipType: "Super Destroyer", game.WorldType: "World props",
	game.ArmorPieceType: "Armor pieces", game.UnitType: "Unidentified"}

// kits lists every item, by category (Group): Armor, Helmets, Capes, Vehicles, Weapons, Backpacks, Equipment
// (throwables, gear, attachments no weapon offers), Stratagems, SEAF, Eagle & craft, Ship crew, Automatons, Illuminate, Objectives, Super Destroyer, World
// props, Unnamed, Unnamed units.
// An armor and a helmet are separate choices ("kit:<id>"); an armor names its set's helmet (Helmet: an armor and a
// helmet of one name, the game's armor set) and the key of both together (Set), so a project or the preview can take
// the armor alone or with that helmet. Capes are one choice per cape (several share a name: each gets its model and
// id in the label); the other items by their key.
func (s *Server) kits(w http.ResponseWriter, r *http.Request) {
	idx := s.index()
	if idx == nil {
		fail(w, 503, fmt.Errorf("no kit index"))
		return
	}
	type choice struct {
		Group  string `json:"group"`
		Label  string `json:"label"`
		Value  string `json:"value"` // "kit:<id>" for one kit, or a key (a name)
		Name   string `json:"name"`
		Type   string `json:"type"`
		Set    string `json:"set,omitempty"`    // armor: its armor and helmet together (a key)
		Helmet string `json:"helmet,omitempty"` // armor: its set's helmet ("kit:<id>")
	}
	unnamed := unnamedKit
	// the helmet of each name key (an armor set: an armor and a helmet sharing a name)
	setHelmet := map[string]string{}
	for _, k := range idx.Kits {
		if key := idx.Key(k); k.Type == "Helmet" && !strings.HasPrefix(key, "kit:") {
			setHelmet[key] = "kit:" + k.ID
		}
	}
	// an unnamed kit's label starts with the named kit of the same models ("SC-34 Infiltrator model · 2eec8681 (…)";
	// "… parts" when it has most but not all of them), and it is listed with its kind (beside that kit, by label)
	same := idx.SameModel(func(k game.Kit) bool { return !unnamed(k.Name) })
	var out []choice
	done := map[string]bool{}
	for _, k := range idx.Kits {
		key := idx.Key(k)
		c := choice{Label: s.kitLabel(k), Value: key, Name: k.Name, Type: k.Type}
		switch k.Type {
		case "Armor":
			c.Group, c.Value = "Armor", "kit:"+k.ID
			if h, ok := setHelmet[key]; ok {
				c.Set, c.Helmet = key, h
			}
		case "Helmet":
			c.Group, c.Value = "Helmets", "kit:"+k.ID
		case "Cape":
			c.Group, c.Value = "Capes", "kit:"+k.ID
		case game.VehicleType:
			c.Group = "Vehicles"
		case game.WeaponType:
			c.Group = "Weapons"
		case game.BackpackType:
			c.Group = "Backpacks"
		case game.SEAFType:
			c.Group = "SEAF"
		default:
			c.Group = "Armor"
			if g, ok := gearGroups[k.Type]; ok {
				c.Group = g
			}
		}
		if done[c.Value] {
			continue
		}
		done[c.Value] = true
		if unnamed(k.Name) { // in its own category when the label can say what it is, else Unnamed
			m, ok := same[k.ID]
			if !ok {
				c.Group = "Unnamed"
			}
			if ok {
				what := " parts" // most of its models
				if m.All {
					what = " model"
				}
				if m.Colors {
					what += " and colors"
				}
				c.Label = m.Name + what + " · " + c.Label
			}
		}
		out = append(out, c)
	}
	order := map[string]int{}
	for i, g := range []string{"Armor", "Helmets", "Capes", "Vehicles", "Weapons", "Backpacks", "Equipment", "Stratagems", "SEAF", "Eagle & craft", "Ship crew", "Automatons", "Illuminate", "Objectives", "Super Destroyer",
		"World props", "Armor pieces", "Unnamed", "Unidentified"} {
		order[g] = i
	}
	sort.SliceStable(out, func(i, j int) bool {
		if order[out[i].Group] != order[out[j].Group] {
			return order[out[i].Group] < order[out[j].Group]
		}
		return naturalLess(strings.ToLower(out[i].Label), strings.ToLower(out[j].Label))
	})
	writeJSON(w, out)
}

func (s *Server) newProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, What, Folder string
	}
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.What) == "" {
		fail(w, 400, fmt.Errorf("pick an armor, cape, vehicle or weapon (or give a 0x LUT hash)"))
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = strings.TrimPrefix(strings.TrimSpace(in.What), "kit:") + " Recolor"
	}
	dir := strings.TrimSpace(in.Folder)
	if dir == "" {
		c := appcfg.Load()
		if at := projectNamed(c, name); at != "" {
			fail(w, 409, fmt.Errorf("a project named %q exists already (%s): pick another name", name, at))
			return
		}
		dir = freeDir(filepath.Join(c.ProjectsFolder(), project.Folder(name)))
	}
	if _, err := os.Stat(filepath.Join(dir, project.FileName)); err == nil {
		fail(w, 409, fmt.Errorf("%s already has a project", dir))
		return
	}
	if err := s.NewProject(dir, name, strings.TrimSpace(in.What)); err != nil {
		fail(w, 400, err)
		return
	}
	if err := s.SetProject(dir); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"project": dir})
}

// ---------- the user's looks (zone presets), shared by all projects: "LUT Studio looks.json" in the projects folder
// (on disk: Documents\LUT Studio, or the folder chosen; on the website, the folder on disk the user chose, else the
// browser's storage). Earlier versions kept them in %APPDATA%\LUTStudio\presets.json: read while the new file isn't there.
// Each look: {name, kind (material, cape, pattern), category, row (the zone's raw values), saved (RFC 3339)}.

const looksFile = "LUT Studio looks.json"

func presetsPath() string    { return filepath.Join(appcfg.Load().ProjectsFolder(), looksFile) }
func oldPresetsPath() string { return filepath.Join(appcfg.Dir(), "presets.json") }

func (s *Server) getPresets(w http.ResponseWriter, r *http.Request) {
	b, err := os.ReadFile(presetsPath())
	if err != nil {
		b, err = os.ReadFile(oldPresetsPath())
	}
	if err != nil {
		b = []byte("[]")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

var presetsMu sync.Mutex // (one looks save at a time: two windows saving at once can't mix their files)

func (s *Server) putPresets(w http.ResponseWriter, r *http.Request) {
	var v []json.RawMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(&v); err != nil { // (a big looks library: up to 16 MB)
		fail(w, 400, err)
		return
	}
	if v == nil { // (null: not a list, the file isn't overwritten with it)
		fail(w, 400, fmt.Errorf("give a list of looks"))
		return
	}
	b, _ := json.MarshalIndent(v, "", " ")
	presetsMu.Lock()
	defer presetsMu.Unlock()
	os.MkdirAll(filepath.Dir(presetsPath()), 0o755)
	if err := atomicfile.WriteFile(presetsPath(), b, 0o644); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, "ok")
}

// where the looks are kept: {path, browser (true: only in the browser's storage, the website with no folder on disk)}
func (s *Server) presetsWhere(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"path": presetsPath(), "browser": runtime.GOOS == "js" && appcfg.Load().ProjectsDir == ""})
}

// download sends the project's built mod zip to the browser as a file download.
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	name := project.Folder(p.Name) + ".zip"
	path := filepath.Join(p.Dir, "dist", name)
	if _, err := os.Stat(path); err != nil {
		fail(w, 404, fmt.Errorf("no built mod yet (Build mod first)"))
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	http.ServeFile(w, r, path)
}

// ---------- project settings, save as, export / import (a project is a folder; these move it around)

// putProject changes the project's name and description (shown in the mod manager), and the name and description
// of the choice between its variants (when given).
func (s *Server) putProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Description         string
		Option, OptionDescription *string
	}
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.Name) == "" {
		fail(w, 400, fmt.Errorf("the project needs a name"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	p.Name, p.Description = strings.TrimSpace(in.Name), strings.TrimSpace(in.Description)
	if in.Option != nil {
		p.Option = strings.TrimSpace(*in.Option)
	}
	if in.OptionDescription != nil {
		p.OptionDescription = strings.TrimSpace(*in.OptionDescription)
	}
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, p)
}

// saveAs copies the open project to a new folder under a new name and GUID (a separate mod), then opens it.
func (s *Server) saveAs(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name string }
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.Name) == "" {
		fail(w, 400, fmt.Errorf("give the copy a name"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	name := strings.TrimSpace(in.Name)
	c := appcfg.Load()
	if at := projectNamed(c, name); at != "" {
		fail(w, 409, fmt.Errorf("a project named %q exists already (%s): pick another name", name, at))
		return
	}
	dst := freeDir(filepath.Join(c.ProjectsFolder(), project.Folder(name)))
	if err := copyTree(src.Dir, dst, func(rel string) bool {
		first := strings.SplitN(filepath.ToSlash(rel), "/", 2)[0] // (the dist and trash folders, not dist*.png)
		return first != "dist" && first != TrashDir
	}); err != nil {
		fail(w, 500, err)
		return
	}
	p, err := project.Load(dst)
	if err != nil {
		fail(w, 500, err)
		return
	}
	p.Name, p.GUID = name, project.NewGUID()
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	err = s.SetProject(dst) // (it takes no s.mu)
	if err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"project": dst})
}

func copyTree(src, dst string, keep func(rel string) bool) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		if rel != "." && !keep(filepath.ToSlash(rel)) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
}

// exportProject sends the whole project (settings, variants, images; not dist/) as one .lutproj file (a zip).
func (s *Server) exportProject(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock() // (its files as one save left them, not halfway through a theme or an update)
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	err = filepath.WalkDir(p.Dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(p.Dir, path)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == "dist" || rel == TrashDir {
				return filepath.SkipDir
			}
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		f, err := zw.CreateHeader(&zip.FileHeader{Name: rel, Method: zip.Deflate, Modified: time.Now()})
		if err != nil {
			return err
		}
		_, err = f.Write(b)
		return err
	})
	if err == nil {
		err = zw.Close()
	}
	if err != nil {
		fail(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", project.Folder(p.Name)+".lutproj"))
	w.Write(buf.Bytes())
}

// importProject unpacks an uploaded .lutproj into the projects folder and opens it.
func (s *Server) importProject(w http.ResponseWriter, r *http.Request) {
	most := int64(1 << 30) // (as big as an export can be; in the browser 512 MB: more runs out of memory)
	if runtime.GOOS == "js" {
		most = 512 << 20
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, most+1))
	if err != nil {
		fail(w, 400, err)
		return
	}
	if int64(len(b)) > most {
		fail(w, 413, fmt.Errorf("the project file is over %d MB", most>>20))
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		fail(w, 400, fmt.Errorf("not a .lutproj file: %w", err))
		return
	}
	var cfg *zip.File
	for _, f := range zr.File {
		if f.Name == project.FileName {
			cfg = f
		}
	}
	if cfg == nil {
		fail(w, 400, fmt.Errorf("not a LUT Studio project (no %s inside)", project.FileName))
		return
	}
	rc, err := cfg.Open()
	if err != nil {
		fail(w, 400, fmt.Errorf("%s: %v", project.FileName, err))
		return
	}
	var p project.Project
	err = json.NewDecoder(rc).Decode(&p)
	rc.Close()
	if err != nil || p.Name == "" {
		fail(w, 400, fmt.Errorf("%s: %v", project.FileName, err))
		return
	}
	if p.Format != project.FormatID { // (checked before anything is written: no folder left behind for a file that won't open)
		fail(w, 400, fmt.Errorf("%s: format %q, expected %q", project.FileName, p.Format, project.FormatID))
		return
	}
	if err := p.CheckPaths(); err != nil { // (nothing is written for a project naming files outside itself)
		fail(w, 400, fmt.Errorf("%s: %v", project.FileName, err))
		return
	}
	c := appcfg.Load()
	newName := uniqueName(c, p.Name) // (another project has its name: "name 2")
	dst := freeDir(filepath.Join(c.ProjectsFolder(), project.Folder(newName)))
	ok := false
	defer func() {
		if !ok { // (a folder of its own, new: no half-imported project left on the start page)
			os.RemoveAll(dst)
		}
	}()
	for _, f := range zr.File {
		clean := filepath.Clean(filepath.FromSlash(f.Name))
		if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) || f.FileInfo().IsDir() {
			continue // nothing outside the project folder
		}
		out := filepath.Join(dst, clean)
		os.MkdirAll(filepath.Dir(out), 0o755)
		rc, err := f.Open()
		if err != nil {
			fail(w, 400, err)
			return
		}
		data, err := io.ReadAll(io.LimitReader(rc, 32<<20+1))
		rc.Close()
		if err == nil && len(data) > 32<<20 {
			err = fmt.Errorf("%s: larger than 32 MB", f.Name)
		}
		if err == nil {
			err = os.WriteFile(out, data, 0o644)
		}
		if err != nil {
			fail(w, 500, err)
			return
		}
	}
	if newName != p.Name {
		if q, err := project.Load(dst); err == nil {
			q.Name = newName
			if err := q.Save(); err != nil {
				fail(w, 500, err)
				return
			}
		}
	}
	if err := s.SetProject(dst); err != nil {
		fail(w, 400, err)
		return
	}
	ok = true
	writeJSON(w, map[string]string{"project": dst})
}

// unnamedKit: a kit without a name shows its id hash (6-8 hex digits).
func unnamedKit(n string) bool {
	return len(n) >= 6 && len(n) <= 8 && strings.Trim(strings.ToLower(n), "0123456789abcdef") == ""
}

// importMod makes a project from an existing mod (a mod .zip or .7z, or loose patch files as HD2SDK-CommunityEdition
// writes them), sent as multipart "files", and opens it.
func (s *Server) importMod(w http.ResponseWriter, r *http.Request) {
	if s.ImportMod == nil || s.index() == nil {
		fail(w, 503, fmt.Errorf("the game isn't open"))
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		fail(w, 400, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	// a zip or 7z is read in place (only its LUTs: texture mods' .gpu_resources run to hundreds of MB); loose patch files
	// are read whole (their .gpu_resources up to 1 GB)
	loose, name := modpack.Files{}, ""
	src := modpack.Merged{}
	for _, fh := range r.MultipartForm.File["files"] {
		f, err := fh.Open()
		if err != nil {
			fail(w, 400, err)
			return
		}
		defer f.Close()
		if ext := strings.ToLower(filepath.Ext(fh.Filename)); ext == ".zip" || ext == ".7z" {
			var z modpack.Source
			if ext == ".zip" {
				z, err = modpack.OpenZip(f, fh.Size)
			} else {
				z, err = modpack.OpenSevenZip(f, fh.Size)
			}
			if err != nil {
				fail(w, 400, fmt.Errorf("%s: %w", fh.Filename, err))
				return
			}
			src = append(src, z)
			name = strings.TrimSuffix(fh.Filename, filepath.Ext(fh.Filename))
			continue
		}
		b, err := io.ReadAll(io.LimitReader(f, 1<<30))
		if err != nil {
			fail(w, 400, err)
			return
		}
		loose[filepath.Base(fh.Filename)] = b
	}
	if len(loose) > 0 {
		src = append(src, loose)
	}
	if name == "" {
		name = "Imported mod"
	}
	var opts modpack.Options
	if s.ModOptions != nil {
		opts = s.ModOptions()
	}
	im, err := modpack.ReadModWith(src, name, opts)
	if err != nil {
		fail(w, 400, err)
		return
	}
	c := appcfg.Load()
	im.Name = uniqueName(c, im.Name) // (another project has its name: "name 2")
	dir := freeDir(filepath.Join(c.ProjectsFolder(), project.Folder(im.Name)))
	report, err := s.ImportMod(dir, im)
	if err != nil {
		fail(w, 422, err)
		return
	}
	if err := s.SetProject(dir); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"report": report})
}
