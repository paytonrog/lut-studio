// LUT Studio: make Helldivers 2 armor color mods by editing material LUTs (no model or texture changes).
// The website (web_js.go: the API in the browser) and a command line for development (cli.go). See README.md.
package main

import (
	"bytes"
	"fmt"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"lutstudio/appcfg"
	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/modpack"
	"lutstudio/project"
	"lutstudio/server"
	"lutstudio/texenc"
)

const usage = `LUT Studio command line (development; LUT Studio itself is the website) - reads the install, never
changes it

  lutstudio index                          read the armor kits from the install (cached)
  lutstudio find <text>                    list kits whose name contains <text>, with their LUTs
  lutstudio new <dir> <kit name | 0xLUT>  new mod project with the kit's LUTs (or one LUT)
  lutstudio pull <dir> <kit name | 0xLUT> [--variant folder]   add more LUTs to a project
  lutstudio variant <dir> <name> [--from folder]               copy a variant (another color scheme)
  lutstudio check <dir>                    validate every LUT file; list what changed and what it affects
  lutstudio build <dir> [-o file.zip]      build the mod zip (import it into HD2Arsenal / HD2 Mod Manager)

A kit's pattern LUT (painted stripes / emblems) is included only when it is switched on and the piece has a pattern
mask to draw it with; most kits share the "pattern off" LUT, and vehicle skins have no mask, so those are never
pulled.
Every command takes --game <install folder> when Steam detection fails.
`

// version of LUT Studio (shown on the start page and by "lutstudio version"): "v" and the repo's commit count, set
// by tools/web.py (-ldflags -X main.version=v<count>); "dev" in other builds.
var version = "dev"

func need(pos []string, n int, f func() error) error {
	if len(pos) < n {
		return fmt.Errorf("missing arguments\n\n%s", usage)
	}
	return f()
}

type env struct {
	out      io.Writer // where check / build report (stdout, or the editor's build log)
	gameDir  string
	g        *game.Game
	idx      *game.Index
	tableSrc string // the item table in use: bundled
}

func (e *env) game() (*game.Game, error) {
	if e.g != nil {
		return e.g, nil
	}
	dir := e.gameDir
	if dir == "" {
		dir = appcfg.Load().GameDir
	}
	if dir == "" {
		d, err := game.Detect()
		if err != nil {
			return nil, err
		}
		dir = d
	}
	t := time.Now()
	g, err := game.Open(dir)
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(os.Stderr, "read %s (%.1fs)\n", dir, time.Since(t).Seconds())
	// the items: the item table (update.go); LUTSTUDIO_TABLE=datalib reads the data-library tables instead
	// (development: filediver's embedded copies)
	if os.Getenv("LUTSTUDIO_TABLE") != "datalib" {
		tbl, src := tableFor(g)
		g.UseTable(tbl)
		e.tableSrc = src
	}
	e.g = g
	return g, nil
}

// index returns the kit index: the item table's, names from the install (or the data-library tables').
func (e *env) index() (*game.Index, error) {
	if e.idx != nil {
		return e.idx, nil
	}
	g, err := e.game()
	if err != nil {
		return nil, err
	}
	if g.Table() == nil {
		if e.idx, err = g.BuildIndex(""); err != nil {
			return nil, err
		}
		return e.idx, nil
	}
	e.idx = g.IndexFromTable()
	return e.idx, nil
}

func (e *env) cmdIndex() error {
	idx, err := e.index()
	if err != nil {
		return err
	}
	g, _ := e.game()
	src := "the data-library tables (LUTSTUDIO_TABLE=datalib)"
	if t := g.Table(); t != nil {
		src = fmt.Sprintf("the %s item table (game build %s, generated %s)", e.tableSrc, t.GameBuild, t.Generated)
	}
	fmt.Printf("%d kits, %d LUTs, from %s; the install is game build %s\n", len(idx.Kits), len(idx.Users()), src, g.Build())
	return nil
}

func (e *env) cmdFind(q string) error {
	idx, err := e.index()
	if err != nil {
		return err
	}
	kits := idx.Find(q)
	if len(kits) == 0 {
		return fmt.Errorf("no kit matches %q", q)
	}
	users := idx.Users()
	for _, k := range kits {
		fmt.Printf("%s  [%s]\n", k.Name, k.Type)
		for _, p := range k.Pieces {
			if p.CapeLUT != "" {
				fmt.Printf("  %-14s %-7s material %s  cape %s  gradient %s  decals %s\n", p.Slot, p.Body,
					orDash(p.MaterialLUT), p.CapeLUT, orDash(p.CapeGradient), orDash(p.DecalSheet))
				continue
			}
			if p.MaterialLUT == "" && p.PatternLUT == "" {
				continue
			}
			fmt.Printf("  %-14s %-7s material %s  pattern %s%s\n", p.Slot, p.Body, orDash(p.MaterialLUT),
				orDash(p.PatternLUT), shared(users[p.MaterialLUT], k.Name))
		}
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-                 "
	}
	return s
}

// others: the kits other than kit using a LUT (unique names; users are "kit (slot)").
func others(users []string, kit string) []string {
	var out []string
	seen := map[string]bool{kit: true}
	for _, u := range users {
		name := u
		if i := strings.LastIndex(u, " ("); i >= 0 {
			name = u[:i]
		}
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

// alsoUsed summarizes the other kits using a LUT ("" when none).
func alsoUsed(users []string, kit string) string {
	o := others(users, kit)
	switch {
	case len(o) == 0:
		return ""
	case len(o) > 4:
		return fmt.Sprintf("also used by %d other kits (%s, ...)", len(o), strings.Join(o[:3], ", "))
	}
	return "also used by " + strings.Join(o, ", ")
}

func shared(users []string, kit string) string {
	if a := alsoUsed(users, kit); a != "" {
		return "  (" + a + ")"
	}
	return ""
}

// patternOn reports whether a piece's pattern LUT draws anything: texel 0 alpha is the pattern mask layer, and
// exactly -1 switches the pattern off. Most kits share the "off" LUT
// 0xcf0cc31b981786c9; editing it could never add a pattern and would touch every kit that shares it. (Pieces
// without a pattern mask, every vehicle skin, have no pattern LUT in the index: game.PatternDrawn.)
func (e *env) patternOn(hash string) bool {
	if hash == "" {
		return false
	}
	h, err := lut.ParseHash(hash)
	if err != nil {
		return false
	}
	g, err := e.game()
	if err != nil {
		return false
	}
	t, err := g.ReadLUT(h)
	if err != nil || t.Width != lut.PatternWidth {
		return false
	}
	return t.At(0, 0, 3) != -1
}

// target resolves "<kit name>" or "0x<lut>" to LUTs with a note each.
type pulled struct {
	hash, note string
	cape       bool // a cape's LUT: rows are the cape zones (lut.CapeZoneNames)
}

func (e *env) target(what string) ([]pulled, string, error) {
	if strings.HasPrefix(strings.ToLower(what), "0x") {
		h, err := lut.ParseHash(what)
		if err != nil {
			return nil, "", err
		}
		note := ""
		if idx, err := e.index(); err == nil {
			if u := idx.Users()[lut.HashString(h)]; len(u) > 0 {
				note = "Used by " + strings.Join(u, ", ")
			}
		}
		return []pulled{{hash: lut.HashString(h), note: note}}, lut.HashString(h), nil
	}
	idx, err := e.index()
	if err != nil {
		return nil, "", err
	}
	kits := idx.Find(what)
	if len(kits) > 0 && strings.EqualFold(kits[0].Name, strings.TrimSpace(what)) {
		// an exact name: the kits of that key; same-named color versions (B-01 Tactical) are picked by id
		var dups []string
		for _, k := range kits {
			if idx.Key(k) != k.Name {
				dups = append(dups, fmt.Sprintf("kit:%s (%s)", k.ID, strings.ToLower(k.Type)))
			}
		}
		kits = idx.ByKey(kits[0].Name)
		if len(kits) == 0 {
			return nil, "", fmt.Errorf("%d kits are named %q; pick one: %s", len(dups), what, strings.Join(dups, ", "))
		}
		if len(dups) > 0 {
			fmt.Fprintf(e.out, "note: %d more kits are named %q (pick one with kit:<id>): %s\n", len(dups), what, strings.Join(dups, ", "))
		}
	}
	if id, ok := strings.CutPrefix(what, "kit:"); ok {
		k, found := idx.ByID(id)
		if !found {
			return nil, "", fmt.Errorf("no kit with id %s", id)
		}
		kits = []game.Kit{k}
	}
	names := map[string]bool{}
	var list []string
	for _, k := range kits {
		if !names[k.Name] {
			names[k.Name] = true
			list = append(list, k.Name)
		}
	}
	if len(list) == 0 {
		return nil, "", fmt.Errorf("no kit matches %q (try: lutstudio find <part of the name>)", what)
	}
	if len(list) > 1 {
		return nil, "", fmt.Errorf("%q matches %d kits: %s", what, len(list), strings.Join(list, "; "))
	}
	users := idx.Users()
	var out []pulled
	seen := map[string]bool{}
	for _, k := range kits {
		for _, p := range k.Pieces {
			hs := []string{p.MaterialLUT}
			if e.patternOn(p.PatternLUT) {
				hs = append(hs, p.PatternLUT)
			}
			if p.CapeLUT != "" { // capes: the material LUT plus the cape LUT (trim, gradient, decals)
				hs = append(hs, p.CapeLUT)
			}
			for _, h := range hs {
				if h == "" || seen[h] {
					continue
				}
				seen[h] = true
				note := fmt.Sprintf("%s, %s (%s body)", k.Name, p.Slot, p.Body)
				if p.CapeLUT != "" {
					note = k.Name + ", cape"
					if h == p.CapeLUT {
						note += " trim / gradient / decals"
					}
				}
				if a := alsoUsed(users[h], k.Name); a != "" {
					note += "; " + a
				}
				out = append(out, pulled{hash: h, note: note, cape: p.CapeLUT != ""})
			}
		}
	}
	if len(out) == 0 {
		return nil, "", fmt.Errorf("%s has no LUTs", list[0])
	}
	return out, list[0], nil
}

// checkItems: every LUT of items reads from the install as a LUT (what pullInto needs)
func (e *env) checkItems(items []pulled) error {
	g, err := e.game()
	if err != nil {
		return err
	}
	for _, it := range items {
		h, err := lut.ParseHash(it.hash)
		if err != nil {
			return err
		}
		tex, err := g.ReadLUT(h)
		if err != nil {
			return err
		}
		if _, err := lut.KindOf(tex); err != nil {
			return fmt.Errorf("%s: %w", it.hash, err)
		}
	}
	return nil
}

func (e *env) pullInto(p *project.Project, v project.Variant, items []pulled) error {
	g, err := e.game()
	if err != nil {
		return err
	}
	for _, it := range items {
		path := p.DocPath(v, it.hash)
		if _, err := os.Stat(path); err == nil {
			fmt.Printf("  %s already in %s (kept)\n", it.hash, v.Folder)
			continue
		}
		h, _ := lut.ParseHash(it.hash)
		tex, err := g.ReadLUT(h)
		if err != nil {
			return err
		}
		kind, err := lut.KindOf(tex)
		if err != nil {
			return fmt.Errorf("%s: %w", it.hash, err)
		}
		d := &lut.Document{LUT: it.hash, Kind: kind, Note: it.note, Tex: tex}
		if it.cape {
			for y := 0; y < tex.Height; y++ {
				if y < len(lut.CapeZoneNames) {
					d.Labels = append(d.Labels, lut.CapeZoneNames[y])
				} else {
					d.Labels = append(d.Labels, fmt.Sprintf("zone %d (unused)", y))
				}
			}
		}
		if err := project.WriteDoc(path, d); err != nil {
			return err
		}
		rel, _ := filepath.Rel(p.Dir, path)
		fmt.Printf("  %-9s %s  %s\n", kind, rel, d.Note)
	}
	return nil
}

func (e *env) cmdNew(dir, what string) error {
	items, name, err := e.target(what)
	if err != nil {
		return err
	}
	if err := e.checkItems(items); err != nil { // (before the project exists: a failure leaves nothing behind)
		return err
	}
	p, err := project.Create(dir, name+" Recolor")
	if err != nil {
		return err
	}
	fmt.Printf("new project %s (%q)\n", dir, p.Name)
	if err := e.pullInto(p, p.Variants[0], items); err != nil {
		return err
	}
	fmt.Printf("\nEdit the .lut.json files, then: lutstudio build %s\n", dir)
	return nil
}

func (e *env) cmdPull(dir, what, folder string) error {
	p, err := project.Load(dir)
	if err != nil {
		return err
	}
	v := p.Variants[0]
	if folder != "" {
		if v, err = p.Variant(folder); err != nil {
			return err
		}
	}
	items, _, err := e.target(what)
	if err != nil {
		return err
	}
	return e.pullInto(p, v, items)
}

func (e *env) cmdVariant(dir, name, from string) error {
	p, err := project.Load(dir)
	if err != nil {
		return err
	}
	src := p.Variants[0]
	if from != "" {
		if src, err = p.Variant(from); err != nil {
			return err
		}
	}
	nv := project.Variant{Name: name, Folder: project.Folder(name)}
	if folder, err := server.FreeVariantFolder(p, name); err != nil {
		return err
	} else {
		nv.Folder = folder
	}
	n, err := server.CopyVariant(p, src, nv) // (its LUTs, edited textures and theme record, as the editor's + Variant)
	if err != nil {
		return err
	}
	p.Variants = append(p.Variants, nv)
	if err := p.Save(); err != nil {
		return err
	}
	server.CopyThemeRecord(p, src.Folder, nv.Folder)
	fmt.Printf("variant %q in variants/%s (%d files copied from %s)\n", name, nv.Folder, n, src.Folder)
	return nil
}

// built: per variant, the LUTs that differ from vanilla, encoded.
type built struct {
	variant project.Variant
	docs    []*lut.Document
	res     []modpack.Resource
}

// check validates a project and compares each LUT with the install's vanilla copy (unchanged LUTs are left out of
// the mod, so it conflicts with as few other mods as possible).
func (e *env) check(dir string, verbose bool) ([]built, error) {
	p, err := project.Load(dir)
	if err != nil {
		return nil, err
	}
	g, gerr := e.game()
	if gerr != nil {
		fmt.Fprintf(os.Stderr, "warning: %v\n  -> cannot compare with vanilla: every LUT goes into the mod\n", gerr)
	}
	users := map[string][]string{}
	if idx, err := e.index(); err == nil {
		users = idx.Users()
	}
	var out []built
	var problems []string
	for _, v := range p.Variants {
		docs, probs, err := p.Docs(v)
		if err != nil {
			return nil, err
		}
		problems = append(problems, probs...)
		b := built{variant: v}
		unchanged := 0
		for _, d := range docs {
			h, _ := lut.ParseHash(d.LUT)
			if g != nil {
				van, err := g.ReadLUT(h)
				if err != nil {
					problems = append(problems, fmt.Sprintf("variants/%s: %s is not a LUT in this install: %v", v.Folder, d.LUT, err))
					continue
				}
				if van.Width != d.Tex.Width {
					problems = append(problems, fmt.Sprintf("variants/%s: %s has %d columns, the game's has %d",
						v.Folder, d.LUT, d.Tex.Width, van.Width))
					continue
				}
				if van.Height != d.Tex.Height && verbose { // (mods ship LUTs with more zones; the game reads them)
					fmt.Fprintf(e.out, "  %-12s %s  has %d zones, the game's %d\n", v.Folder, d.LUT, d.Tex.Height, van.Height)
				}
				if van.Equal(d.Tex) {
					unchanged++
					continue
				}
			}
			main, gpu := lut.Marked(d.Tex).Encode() // (the build mark: lut/mark.go)
			b.res = append(b.res, modpack.Resource{Name: h, Type: game.TextureType.Value, Main: main, GPU: gpu})
			b.docs = append(b.docs, d)
			if verbose {
				line := fmt.Sprintf("  %-12s %s  changed", v.Folder, d.LUT)
				if kits := others(users[d.LUT], ""); len(kits) > 0 {
					if len(kits) > 4 {
						line += fmt.Sprintf("  -> recolors %d kits: %s, ... (shared LUT)", len(kits), strings.Join(kits[:3], ", "))
					} else {
						line += "  -> recolors " + strings.Join(kits, ", ")
					}
				}
				fmt.Fprintln(e.out, line)
			}
		}
		if verbose && unchanged > 0 {
			fmt.Fprintf(e.out, "  %-12s %d unchanged LUT(s) left out of the mod\n", v.Folder, unchanged)
		}
		// edited decal sheets and cape designs (server/decals.go): encoded like the game's texture (texenc)
		for _, td := range server.TextureDirs {
			files := project.ListFiles(filepath.Join(p.VariantDir(v), td.Dir), "0x", ".png")
			for _, f := range files {
				idx, _ := e.index()
				res, err := sheetResource(g, idx, f, td.Straight)
				if err != nil {
					problems = append(problems, fmt.Sprintf("variants/%s: %s/%s: %v", v.Folder, td.Dir, filepath.Base(f), err))
					continue
				}
				b.res = append(b.res, res)
				if verbose {
					fmt.Fprintf(e.out, "  %-12s %s  %s replaced\n", v.Folder, strings.TrimSuffix(filepath.Base(f), ".png"), td.What)
				}
			}
		}
		out = append(out, b)
	}
	// a variant that changes nothing (the game's look, or an imported option whose changes were the mod's own files)
	// is left out of the mod; with nothing in any variant there is nothing to build
	var kept []built
	for _, b := range out {
		if len(b.res) > 0 {
			kept = append(kept, b)
		} else if verbose {
			fmt.Fprintf(e.out, "  %-12s nothing differs from the game: left out of the mod\n", b.variant.Folder)
		}
	}
	if len(out) == 0 {
		problems = append(problems, "the project has no variants")
	}
	if len(kept) == 0 && len(problems) == 0 && len(out) > 0 {
		problems = append(problems, fmt.Sprintf("variants/%s: no LUT differs from the game's, nothing to build", out[0].variant.Folder))
	}
	out = kept
	if len(problems) > 0 {
		return nil, fmt.Errorf("%d problem(s):\n%s", len(problems), strings.Join(problems, "\n"))
	}
	if verbose {
		fmt.Fprintln(e.out, "ok")
	}
	return out, nil
}

// sheetResource: an edited texture (variants/<v>/textures|designs|masks/<0x hash>.png) as the game texture it replaces;
// straight: its mips average every channel alike (texenc.MipChain); idx: for a placeholder design replaced (designTemplate)
func sheetResource(g *game.Game, idx *game.Index, file string, straight bool) (modpack.Resource, error) {
	if g == nil {
		return modpack.Resource{}, fmt.Errorf("the game is needed to replace a texture")
	}
	h, err := lut.ParseHash(strings.TrimSuffix(filepath.Base(file), ".png"))
	if err != nil {
		return modpack.Resource{}, err
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return modpack.Resource{}, err
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return modpack.Resource{}, err
	}
	main, stream, gpu, err := g.ReadTextureParts(h)
	if err != nil {
		return modpack.Resource{}, err
	}
	if in, err := texenc.ReadInfo(main); err == nil {
		if b := img.Bounds(); (b.Dx() != in.Width || b.Dy() != in.Height*in.Layers) && server.Placeholder(in) { // a placeholder design replaced (a few pixels: only designs are)
			if main, stream, gpu, err = designTemplate(g, idx, b.Dx(), b.Dy()); err != nil {
				return modpack.Resource{}, err
			}
		}
	}
	main, stream, gpu, err = texenc.Replace(main, stream, gpu, texenc.ToNRGBA(img), straight)
	if err != nil {
		return modpack.Resource{}, err
	}
	return modpack.Resource{Name: h, Type: game.TextureType.Value, Main: main, Stream: stream, GPU: gpu}, nil
}

func swatchOf(docs []*lut.Document) []byte {
	var cols [][][2][3]float32
	for _, d := range docs {
		if d.Kind != "material" {
			continue
		}
		var zones [][2][3]float32
		for y := 0; y < d.Tex.Height; y++ {
			zones = append(zones, [2][3]float32{
				{d.Tex.At(0, y, 0), d.Tex.At(0, y, 1), d.Tex.At(0, y, 2)},
				{d.Tex.At(2, y, 0), d.Tex.At(2, y, 1), d.Tex.At(2, y, 2)}})
		}
		cols = append(cols, zones)
		if len(cols) == 8 {
			break
		}
	}
	return modpack.Swatch(cols, 512)
}

// newServer: the editor's API (server.Server) on e: builds, new projects, pulls, mod imports, the game folder.
// The website runs it in a worker (web_js.go).
func (e *env) newServer() (*server.Server, *sync.Mutex) {
	cacheDir := filepath.Join(appcfg.CacheDir(), "cache")
	var mu sync.Mutex // builds and project creation share e
	srv := &server.Server{Version: version,
		Build: func(dir string, w io.Writer) (string, error) {
			mu.Lock()
			defer mu.Unlock()
			p, err := project.Load(dir)
			if err != nil {
				return "", err
			}
			out := filepath.Join(p.Dir, "dist", project.Folder(p.Name)+".zip")
			prev := e.out
			e.out = w
			defer func() { e.out = prev }()
			return out, e.cmdBuild(dir, out)
		},
		NewProject: func(dir, name, what string) error {
			mu.Lock()
			defer mu.Unlock()
			items, _, err := e.target(what)
			if err != nil {
				return err
			}
			if err := e.checkItems(items); err != nil { // (before the project exists: a failure leaves nothing behind)
				return err
			}
			p, err := project.Create(dir, name)
			if err != nil {
				return err
			}
			if !strings.HasPrefix(strings.ToLower(what), "0x") {
				p.Kit = what
				if err := p.Save(); err != nil {
					return err
				}
			}
			return e.pullInto(p, p.Variants[0], items)
		},
		Pull: func(dir, what string) error {
			mu.Lock()
			defer mu.Unlock()
			items, _, err := e.target(what)
			if err != nil {
				return err
			}
			p, err := project.Load(dir)
			if err != nil {
				return err
			}
			for _, v := range p.Variants {
				if err := e.pullInto(p, v, items); err != nil {
					return err
				}
			}
			return nil
		},
		ImportMod: func(dir string, im *modpack.Imported) (string, error) {
			mu.Lock()
			defer mu.Unlock()
			return e.importMod(dir, im)
		},
		ModOptions: func() modpack.Options { // a mod's decal sheets and cape designs come in too
			mu.Lock()
			defer mu.Unlock()
			g, err := e.game()
			if err != nil {
				return modpack.Options{}
			}
			idx, _ := e.index()
			sheets, designs := g.EditableTextures(idx)
			masks, patterns := g.EditableMasks(idx)
			return modpack.Options{WantTexture: func(h uint64) bool { return sheets[h] || designs[h] || masks[h] || patterns[h] }}
		},
		OpenGame: func(dir string) (*game.Game, *game.Index, *game.Assets, error) {
			mu.Lock()
			defer mu.Unlock()
			oldG, oldIdx, oldDir := e.g, e.idx, e.gameDir
			e.g, e.idx, e.gameDir = nil, nil, dir
			g, err := e.game()
			if err != nil {
				e.g, e.idx, e.gameDir = oldG, oldIdx, oldDir // (a mistyped folder: the game in use stays)
				return nil, nil, nil, err
			}
			idx, err := e.index()
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: no kit index: %v\n", err)
			}
			// models and textures cached per game build (a game update may change them under the same names)
			assets := cacheDir
			if k := g.CacheKey(); k != "" {
				assets = filepath.Join(cacheDir, k)
			}
			return g, idx, game.NewAssets(g, assets), nil
		},
	}
	return srv, &mu
}

func (e *env) cmdBuild(dir, out string) error {
	b, err := e.check(dir, true)
	if err != nil {
		return err
	}
	p, _ := project.Load(dir)
	m := modpack.Mod{Name: p.Name, Description: p.Description, GUID: p.GUID, OptionName: p.Option, OptionDescription: p.OptionDescription}
	if p.OptionImage != "" && len(b) > 1 {
		if m.OptionImage, err = os.ReadFile(filepath.Join(p.Dir, p.OptionImage)); err != nil {
			return fmt.Errorf("option picture: %w", err)
		}
	}
	// the mod managers' limits (HD2 Arsenal's builder): longer names may be cut off in their lists
	for _, w := range nameWarnings(p, len(b) > 1 || len(p.Options) > 0) {
		fmt.Fprintln(e.out, "  note: "+w)
	}
	if p.Icon != "" {
		if m.Icon, err = os.ReadFile(filepath.Join(p.Dir, p.Icon)); err != nil {
			return fmt.Errorf("icon: %w", err)
		}
	} else {
		m.Icon = swatchOf(b[0].docs)
	}
	for _, x := range b {
		v := modpack.Variant{Name: x.variant.Name, Description: x.variant.Description, Folder: x.variant.Folder, Resources: x.res}
		if x.variant.Image != "" {
			if v.Image, err = os.ReadFile(filepath.Join(p.Dir, x.variant.Image)); err != nil {
				return fmt.Errorf("variant %s image: %w", x.variant.Folder, err)
			}
		} else if len(b) > 1 {
			v.Image = swatchOf(x.docs)
		}
		m.Variants = append(m.Variants, v)
	}
	if len(p.Options) > 0 {
		if m.Options, err = e.buildOptions(p, m.Variants); err != nil {
			return err
		}
	}
	z, err := m.Zip()
	if err != nil {
		return err
	}
	if out == "" {
		out = filepath.Join(p.Dir, "dist", project.Folder(p.Name)+".zip")
	}
	os.MkdirAll(filepath.Dir(out), 0o755)
	if err := os.WriteFile(out, z, 0o644); err != nil {
		return err
	}
	what := fmt.Sprintf("%d variant(s)", len(b))
	if len(m.Options) > 0 {
		what = fmt.Sprintf("%d option(s)", len(m.Options))
	}
	fmt.Fprintf(e.out, "built %s (%s, %d bytes) - import it into HD2Arsenal / HD2 Mod Manager\n", out, what, len(z))
	return nil
}

// nameWarnings: names longer than HD2 Arsenal's mod builder allows (mod 120 characters, an option or a variant 60)
func nameWarnings(p *project.Project, choice bool) []string {
	var out []string
	if n := len([]rune(p.Name)); n > 120 {
		out = append(out, fmt.Sprintf("the mod's name is %d characters (mod managers show up to 120)", n))
	}
	if choice {
		if n := len([]rune(p.Option)); n > 60 {
			out = append(out, fmt.Sprintf("the choice's name is %d characters (mod managers show up to 60)", n))
		}
		for _, v := range p.Variants {
			if n := len([]rune(v.Name)); n > 60 {
				out = append(out, fmt.Sprintf("variant %q is %d characters (mod managers show up to 60)", v.Name, n))
			}
		}
		for _, o := range p.Options {
			if n := len([]rune(o.Name)); n > 60 {
				out = append(out, fmt.Sprintf("option %q is %d characters (mod managers show up to 60)", o.Name, n))
			}
		}
	}
	return out
}

// buildOptions: the mod's options (project.Option) from the built variants (vs: their changed LUTs and textures,
// pictures): per option the parts it holds, from each variant it offers; a choice that changes none of its parts is
// left out, and an option left with nothing. Notes in the log: changed parts in no option (left out of the mod),
// parts in several options (the later one's when both are on).
func (e *env) buildOptions(p *project.Project, vs []modpack.Variant) ([]modpack.Option, error) {
	byFolder := map[string]modpack.Variant{}
	changed := map[uint64]bool{}
	for _, v := range vs {
		byFolder[v.Folder] = v
		for _, r := range v.Resources {
			changed[r.Name] = true
		}
	}
	inOption := map[uint64][]string{}
	var out []modpack.Option
	for _, o := range p.Options {
		parts := map[uint64]bool{}
		for _, hs := range o.Parts {
			if h, err := lut.ParseHash(hs); err == nil {
				parts[h] = true
				inOption[h] = append(inOption[h], o.Name)
			}
		}
		pick := func(v modpack.Variant) []modpack.Resource {
			var res []modpack.Resource
			for _, r := range v.Resources {
				if parts[r.Name] {
					res = append(res, r)
				}
			}
			return res
		}
		mo := modpack.Option{Name: o.Name, Description: o.Description, Folder: o.ID}
		if o.Image != "" {
			b, err := os.ReadFile(filepath.Join(p.Dir, o.Image))
			if err != nil {
				return nil, fmt.Errorf("option %q picture: %w", o.Name, err)
			}
			mo.Image = b
		}
		if len(o.Variants) == 1 { // a switch
			mo.Resources = pick(byFolder[o.Variants[0]])
		} else {
			for _, f := range o.Variants {
				v, ok := byFolder[f]
				res := pick(v)
				if !ok || len(res) == 0 {
					fmt.Fprintf(e.out, "  note: option %q: variant %s changes none of its parts: left out of it\n", o.Name, f)
					continue
				}
				c := modpack.Variant{Name: v.Name, Description: v.Description, Folder: f, Image: v.Image, Resources: res}
				if rel := o.Images[f]; rel != "" {
					b, err := os.ReadFile(filepath.Join(p.Dir, rel))
					if err != nil {
						return nil, fmt.Errorf("option %q, variant %s picture: %w", o.Name, f, err)
					}
					c.Image = b
				}
				mo.Choices = append(mo.Choices, c)
			}
		}
		if len(mo.Resources) == 0 && len(mo.Choices) == 0 {
			fmt.Fprintf(e.out, "  note: option %q changes nothing: left out of the mod\n", o.Name)
			continue
		}
		out = append(out, mo)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no option changes anything: nothing to build (Mod page: give the options their parts)")
	}
	left := 0
	for h := range changed {
		switch n := len(inOption[h]); {
		case n == 0:
			left++
		case n > 1:
			fmt.Fprintf(e.out, "  note: %s is in options %s: when both are on, the later one's wins\n", lut.HashString(h), strings.Join(inOption[h], ", "))
		}
	}
	if left > 0 {
		fmt.Fprintf(e.out, "  note: %d changed LUT(s) / texture(s) are in no option: left out of the mod\n", left)
	}
	return out, nil
}

// designTemplate: a game cape design of w x h in RGBA8 with every mip in the GPU part (the layout of most designs),
// whose header a new design of that size takes (a placeholder design replaced: server.Placeholder)
func designTemplate(g *game.Game, idx *game.Index, w, h int) (main, stream, gpu []byte, err error) {
	_, designs := g.EditableTextures(idx)
	var hs []uint64
	for d := range designs {
		hs = append(hs, d)
	}
	slices.Sort(hs) // (the same template every build)
	for _, d := range hs {
		m, s, gp, err := g.ReadTextureParts(d)
		if err != nil || len(s) != 0 {
			continue
		}
		if in, err := texenc.ReadInfo(m); err == nil && in.DXGI == 28 && in.Width == w && in.Height == h && in.Mips > 1 {
			return m, s, gp, nil
		}
	}
	return nil, nil, nil, fmt.Errorf("no game design of %d x %d to take the texture header from", w, h)
}
