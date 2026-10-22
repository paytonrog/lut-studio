// Package project is a LUT Studio mod project on disk:
//
//	<dir>/lutstudio.json          name, description, GUID, icon, variants
//	<dir>/variants/<folder>/*.lut.json   one LUT document each (lut.Document)
//	<dir>/gamevalues/*.lut.json          the game's values of each LUT when it came into the project (Game says which game)
//
// Everything is plain text, so projects diff, merge and share well; the build turns them into a mod zip.
package project

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"lutstudio/atomicfile"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"lutstudio/lut"
)

const (
	FileName = "lutstudio.json"
	FormatID = "lutstudio-project/1"
)

type Variant struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Folder      string `json:"folder"`
	Image       string `json:"image,omitempty"`      // PNG, relative to the project (optional)
	ImageAuto   bool   `json:"image_auto,omitempty"` // rendered by the editor at build time (not picked by the user)
}

// Option is one part of the mod that players switch on by itself: some of the project's LUTs and textures (Parts:
// 0x hashes), taken from the variants it offers: one variant makes it a plain switch, several a pick-one choice
// between them (its sub-options). The game replaces a LUT whole, so a part in two options is the later one's when
// both are on.
type Option struct {
	ID          string            `json:"id"` // its folder in the mod (Folder rules)
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Image       string            `json:"image,omitempty"`  // PNG, relative to the project; empty: the icon
	Parts       []string          `json:"parts"`            // LUT and texture hashes
	Variants    []string          `json:"variants"`         // the variant folders offered, in order
	Images      map[string]string `json:"images,omitempty"` // per variant folder: this option's picture of it (empty: the variant's)
}

type Project struct {
	Format      string    `json:"format"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	GUID        string    `json:"guid"` // the mod's identity in the manager: keep it across releases
	Icon        string    `json:"icon,omitempty"`
	IconAuto    bool      `json:"icon_auto,omitempty"` // rendered by the editor at build time
	Kit         string    `json:"kit,omitempty"`       // the kit key it was made from (opened first; shared LUTs make others look equal)
	Variants    []Variant `json:"variants"`
	// the choice between the variants in the mod manager (an option whose sub-options are the variants); empty:
	// "Color scheme" / "Pick one." / the icon
	Option            string `json:"option,omitempty"`
	OptionDescription string `json:"option_description,omitempty"`
	OptionImage       string `json:"option_image,omitempty"` // PNG, relative to the project
	// Options: the mod as several options, each switched on by itself in the mod manager (empty: one choice between
	// the variants, above)
	Options []Option `json:"options,omitempty"`
	// Game: the game the project's LUTs were last checked against (game.Game.CacheKey): after an update, the LUTs whose
	// game values changed since gamevalues/ was written are offered the new ones (server/gameupdate.go)
	Game string `json:"game,omitempty"`

	Dir string `json:"-"`
}

func NewGUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var folderRe = regexp.MustCompile(`[^a-z0-9_-]+`)

// MaxFolder: the longest folder name (HD2 Arsenal's mod builder allows 29 characters).
const MaxFolder = 29

// Folder makes a folder name from a variant name (at most MaxFolder characters).
func Folder(name string) string {
	f := strings.Trim(folderRe.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(f) > MaxFolder {
		f = strings.TrimRight(f[:MaxFolder], "-")
	}
	if f == "" {
		f = "variant"
	}
	if reservedName(f) { // (Windows can't make or open a folder named con, nul, com1…)
		f += "-1"
	}
	return f
}

// reservedName: a name Windows keeps for devices (con, prn, aux, nul, com0-9, lpt0-9)
func reservedName(f string) bool {
	switch f {
	case "con", "prn", "aux", "nul":
		return true
	}
	return len(f) == 4 && (strings.HasPrefix(f, "com") || strings.HasPrefix(f, "lpt")) && f[3] >= '0' && f[3] <= '9'
}

func Create(dir, name string) (*Project, error) {
	if _, err := os.Stat(filepath.Join(dir, FileName)); err == nil {
		return nil, fmt.Errorf("%s already has a project", dir)
	}
	p := &Project{Format: FormatID, Name: name, Description: name + " - color scheme made with LUT Studio.",
		GUID: NewGUID(), Variants: []Variant{{Name: "Default", Folder: "default"}}, Dir: dir}
	if err := os.MkdirAll(p.VariantDir(p.Variants[0]), 0o755); err != nil {
		return nil, err
	}
	return p, p.Save()
}

func Load(dir string) (*Project, error) {
	b, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		return nil, fmt.Errorf("%s: not a LUT Studio project (%w)", dir, err)
	}
	p := &Project{}
	if err := json.Unmarshal(b, p); err != nil {
		return nil, fmt.Errorf("%s: %w", FileName, err)
	}
	if p.Format != FormatID {
		return nil, fmt.Errorf("%s: format %q, expected %q", FileName, p.Format, FormatID)
	}
	if err := p.CheckPaths(); err != nil {
		return nil, fmt.Errorf("%s: %w", FileName, err)
	}
	p.Dir = dir
	return p, nil
}

// CheckPaths: every file the project names stays inside its folder (a shared project can't make the build pack, or
// the editor read or rename, files elsewhere): pictures are relative paths that don't leave it, variant folders
// and option ids single folder names
func (p *Project) CheckPaths() error {
	file := func(what, f string) error {
		if f != "" && !filepath.IsLocal(filepath.FromSlash(f)) {
			return fmt.Errorf("%s %q is outside the project", what, f)
		}
		return nil
	}
	name := func(what, f string) error {
		if !filepath.IsLocal(f) || strings.ContainsAny(f, `/\`) {
			return fmt.Errorf("%s %q is not a folder name", what, f)
		}
		return nil
	}
	errs := []error{file("icon", p.Icon), file("option image", p.OptionImage)}
	if len(p.Variants) == 0 {
		errs = append(errs, fmt.Errorf("no variants (a project has at least one)"))
	}
	for _, v := range p.Variants {
		errs = append(errs, name("variant folder", v.Folder), file("variant image", v.Image))
	}
	for _, o := range p.Options {
		// (an option id is a folder name inside the mod zip, never on disk: "aux" or "con" are fine there)
		if o.ID == "" || o.ID == "." || o.ID == ".." || strings.ContainsAny(o.ID, `/\:`) {
			errs = append(errs, fmt.Errorf("option id %q is not a folder name", o.ID))
		}
		errs = append(errs, file("option image", o.Image))
		for _, f := range o.Images {
			errs = append(errs, file("option picture", f))
		}
	}
	return errors.Join(errs...)
}

func (p *Project) Save() error {
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.WriteFile(filepath.Join(p.Dir, FileName), append(b, '\n'), 0o644)
}

func (p *Project) VariantDir(v Variant) string { return filepath.Join(p.Dir, "variants", v.Folder) }

func (p *Project) Variant(folder string) (Variant, error) {
	for _, v := range p.Variants {
		if v.Folder == folder {
			return v, nil
		}
	}
	return Variant{}, fmt.Errorf("no variant %q (have %s)", folder, p.folders())
}

func (p *Project) folders() string {
	var f []string
	for _, v := range p.Variants {
		f = append(f, v.Folder)
	}
	return strings.Join(f, ", ")
}

// DocPath is where a LUT's document lives in a variant.
func (p *Project) DocPath(v Variant, hash string) string {
	return filepath.Join(p.VariantDir(v), hash+".lut.json")
}

func WriteDoc(path string, d *lut.Document) error {
	b, err := d.MarshalJSON()
	if err != nil {
		return err
	}
	return atomicfile.WriteFile(path, b, 0o644)
}

// GameValuesDir: the game's values of the project's LUTs, one document per LUT (whatever the variants).
func (p *Project) GameValuesDir() string { return filepath.Join(p.Dir, "gamevalues") }

// GameValuesPath is where the game's values of a LUT are kept.
func (p *Project) GameValuesPath(hash string) string {
	return filepath.Join(p.GameValuesDir(), hash+".lut.json")
}

// Docs reads every LUT document of a variant, sorted by file name. Errors name the file.
func (p *Project) Docs(v Variant) ([]*lut.Document, []string, error) { return docsIn(p.VariantDir(v)) }

// GameValues reads the game's values of the project's LUTs (GameValuesPath), as Docs.
func (p *Project) GameValues() ([]*lut.Document, []string, error) { return docsIn(p.GameValuesDir()) }

func docsIn(dir string) ([]*lut.Document, []string, error) {
	files := ListFiles(dir, "", ".lut.json")
	sort.Strings(files)
	// parsed in parallel and cached by file time and size: an overhaul is ~800 LUTs x 14 variants
	parsed := make([]parsedDoc, len(files))
	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				parsed[i] = readCached(files[i])
			}
		}()
	}
	for i := range files {
		next <- i
	}
	close(next)
	wg.Wait()
	var docs []*lut.Document
	var problems []string
	seen := map[string]string{}
	for i, f := range files {
		if parsed[i].ioErr != nil {
			return nil, nil, parsed[i].ioErr
		}
		if parsed[i].err != nil {
			problems = append(problems, fmt.Sprintf("%s:\n  %s", f, strings.ReplaceAll(parsed[i].err.Error(), "\n", "\n  ")))
			continue
		}
		d := new(lut.Document)
		*d = *parsed[i].doc // a copy: callers may change the fields (the texture is shared, read-only)
		h, _ := lut.ParseHash(d.LUT)
		d.LUT = lut.HashString(h)
		if prev, dup := seen[d.LUT]; dup {
			problems = append(problems, fmt.Sprintf("%s: LUT %s is also in %s", f, d.LUT, prev))
			continue
		}
		seen[d.LUT] = f
		docs = append(docs, d)
	}
	return docs, problems, nil
}

type parsedDoc struct {
	doc   *lut.Document
	err   error // the document is invalid
	ioErr error // the file can't be read
}

type cachedDoc struct {
	mod    time.Time
	size   int64
	parsed time.Time // (when it was read: a file still within two seconds of its save then could change unseen)
	parsedDoc
}

var (
	docCacheMu sync.Mutex
	docCache   = map[string]cachedDoc{}
)

// ListFiles: the files of dir whose names start with prefix and end with suffix, as full paths, sorted (a listing,
// not a glob: brackets in the folder's path are just characters)
func ListFiles(dir, prefix, suffix string) []string {
	es, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range es {
		if n := e.Name(); !e.IsDir() && strings.HasPrefix(n, prefix) && strings.HasSuffix(n, suffix) {
			out = append(out, filepath.Join(dir, n))
		}
	}
	sort.Strings(out)
	return out
}

// readCached parses a document file, reusing the last parse while its time and size are unchanged (8: and it is
// more than two seconds old: on file systems with coarse times an edit of the same size could look the same).
func readCached(f string) parsedDoc {
	st, err := os.Stat(f)
	if err != nil {
		return parsedDoc{ioErr: err}
	}
	docCacheMu.Lock()
	c, ok := docCache[f]
	docCacheMu.Unlock()
	if ok && c.mod.Equal(st.ModTime()) && c.size == st.Size() && c.parsed.Sub(st.ModTime()) > 2*time.Second {
		return c.parsedDoc
	}
	b, err := os.ReadFile(f)
	if err != nil {
		return parsedDoc{ioErr: err}
	}
	d := &lut.Document{}
	pd := parsedDoc{doc: d}
	if err := json.Unmarshal(b, d); err != nil {
		pd = parsedDoc{err: err}
	}
	docCacheMu.Lock()
	docCache[f] = cachedDoc{st.ModTime(), st.Size(), time.Now(), pd}
	docCacheMu.Unlock()
	return pd
}
