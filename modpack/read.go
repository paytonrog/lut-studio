package modpack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"regexp"
	"slices"
	"sort"
	"strings"

	"lutstudio/lut"
)

// ReadMod reads LUT edits out of an existing mod: a mod zip (Helldivers 2 Mod Manager / HD2Arsenal: manifest.json
// v1 or legacy, or no manifest) or loose patch files (as HD2SDK-CommunityEdition writes them: <archive>.patch_N with
// .gpu_resources and .stream). Each option the player can pick is one variant; in each, every texture that decodes
// as a LUT is taken, everything else is only counted (LUT Studio edits LUTs, not meshes or other textures).

// ImportedVariant is one option of the mod: its LUTs, by name hash, and the other textures asked for
// (Options.WantTexture: decal sheets, cape designs), as the mod has them.
type ImportedVariant struct {
	Name        string
	Description string
	Image       []byte // its picture in the manifest (any image format), nil: none
	LUTs        map[uint64]*lut.Texture
	Textures    map[uint64]RawTexture
}

// ImportedOption is one option of a mod with several: its LUTs and textures (Parts), and its choices: the names of
// the variants that are its sub-options (none: a plain switch, the same in every variant), with their descriptions
// and pictures in this option.
type ImportedOption struct {
	Name, Description string
	Image             []byte
	Parts             []uint64
	Choices           []string
	ChoiceDescription map[string]string
	ChoiceImage       map[string][]byte
}

// RawTexture is a texture resource as a patch holds it: its main data (header) and its .stream / .gpu_resources data.
type RawTexture struct{ Main, Stream, GPU []byte }

// Options of ReadModWith.
type Options struct {
	// WantTexture: textures (by name hash) to take whole besides the LUTs; nil: none
	WantTexture func(name uint64) bool
}

// maxTextureBytes: the most data a wanted texture may have (a 2048 x 2048 BC3 with mips is 5.6 MB)
const maxTextureBytes = 64 << 20

// Imported is what ReadMod found.
type Imported struct {
	Name, Description string
	GUID              string // the manifest's Guid ("": none): kept, so a rebuilt mod updates the installed one
	Icon              []byte // the manifest's icon (any image format), nil: none
	// with one option of several sub-options (LUT Studio's own mods): that option, the choice between the variants
	OptionName, OptionDescription string
	OptionImage                   []byte
	Variants                      []ImportedVariant
	// Layout: with several options (an overhaul, LUT Studio's mods with options), each option: what it holds and
	// which variants (by name) are its choices
	Layout  []ImportedOption
	Skipped int      // files in the patches that are not LUTs
	Notes   []string // what was not understood
}

const textureType = 0xcd4238c6a0c69e32 // stingray "texture"

var patchName = regexp.MustCompile(`(?i)^[0-9a-f]{16}\.patch_(\d+)$`)

// ZipFiles unpacks a zip into path -> bytes (forward slashes, at most 512 MB in all).
func ZipFiles(b []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, err
	}
	out, total := map[string][]byte{}, 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, 512<<20-int64(total)+1))
		rc.Close()
		if err != nil {
			return nil, err
		}
		if total += len(data); total > 512<<20 {
			return nil, fmt.Errorf("the zip is larger than 512 MB unpacked")
		}
		out[strings.TrimPrefix(path.Clean(strings.ReplaceAll(f.Name, `\`, "/")), "/")] = data
	}
	return out, nil
}

// ReadMod reads the files of a mod: its LUTs.
func ReadMod(src Source, fallbackName string) (*Imported, error) {
	return ReadModWith(src, fallbackName, Options{})
}

// ReadModWith reads the files of a mod: its LUTs and the textures o asks for.
func ReadModWith(src Source, fallbackName string, o Options) (*Imported, error) {
	files := src.Paths()
	// a zip that wraps everything in one folder: that folder is the mod's root
	root := ""
	if mf := shallowest(files, "manifest.json"); mf != "" {
		root = path.Dir(mf)
	} else if d := commonDir(files); d != "" {
		root = d
	}
	if root == "." {
		root = ""
	}
	rel := map[string]string{} // path in the mod -> path in src
	for _, p := range files {
		if root == "" {
			rel[p] = p
		} else if strings.HasPrefix(p, root+"/") {
			rel[strings.TrimPrefix(p, root+"/")] = p
		}
	}
	// (the mod managers find paths on Windows, where case doesn't matter: a lookup falls back to any case)
	relLower := map[string]string{}
	for k, v := range rel {
		if _, ok := relLower[strings.ToLower(k)]; !ok || k < v { // (two spellings of one path: a fixed pick)
			relLower[strings.ToLower(k)] = v
		}
	}
	find := func(p string) (string, bool) {
		if f, ok := rel[p]; ok {
			return f, true
		}
		f, ok := relLower[strings.ToLower(p)]
		return f, ok
	}
	im := &Imported{Name: fallbackName}
	type option struct {
		name    string
		folders []string
		desc    string // (one option's sub-options: their description and picture)
		image   string
	}
	// a picture the manifest names (a path in the mod), nil when missing
	picture := func(p string) []byte {
		if p == "" {
			return nil
		}
		f, ok := find(strings.TrimPrefix(path.Clean(strings.ReplaceAll(p, `\`, "/")), "/"))
		if !ok {
			return nil
		}
		b, err := readAll(src, f, 16<<20)
		if err != nil {
			return nil
		}
		return b
	}
	var opts []option
	var layered []manifestOption // several options: the manifest's, for Layout
	mp, ok := rel["manifest.json"]
	if !ok { // (Manifest.json, MANIFEST.JSON…: the manager reads them too)
		for k, v := range rel {
			if strings.EqualFold(k, "manifest.json") {
				mp, ok = v, true
				break
			}
		}
	}
	if ok {
		b, err := readAll(src, mp, 4<<20)
		if err != nil {
			return nil, fmt.Errorf("manifest.json: %w", err)
		}
		var raw struct {
			Version     int             `json:"Version"`
			Name        string          `json:"Name"`
			Description string          `json:"Description"`
			Guid        string          `json:"Guid"`
			IconPath    string          `json:"IconPath"`
			Options     json.RawMessage `json:"Options"`
		}
		if err := json.Unmarshal(relaxJSON(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))), &raw); err != nil {
			return nil, fmt.Errorf("manifest.json: %w", err)
		}
		im.GUID = strings.TrimSpace(raw.Guid)
		if raw.Name != "" {
			im.Name = raw.Name
		}
		im.Description = raw.Description
		im.Icon = picture(raw.IconPath)
		if raw.Version >= 1 {
			var v1 []manifestOption
			if len(raw.Options) > 0 {
				if err := json.Unmarshal(raw.Options, &v1); err != nil {
					return nil, fmt.Errorf("manifest.json options: %w", err)
				}
			}
			if len(v1) == 1 { // one option: its sub-options are the color schemes (LUT Studio's own mods)
				o := v1[0]
				if len(o.SubOptions) == 0 {
					opts = append(opts, option{o.Name, o.Include, o.Description, o.Image})
				} else {
					im.OptionName, im.OptionDescription, im.OptionImage = o.Name, o.Description, picture(o.Image)
				}
				for _, s := range o.SubOptions { // a sub-option deploys with its option's own folders
					opts = append(opts, option{s.Name, append(append([]string{}, o.Include...), s.Include...), s.Description, s.Image})
				}
			} else {
				// several options (an overhaul: one per armor, players enable many at once): all of them layered into
				// each variant; the variants are the style names of the sub-options ("Chrome", "Cavalier"): each
				// option takes its sub-option of that name, or its first one
				layered = v1
				var styles []string
				for _, o := range v1 {
					for _, s := range o.SubOptions {
						if len(o.SubOptions) > 1 && !slices.Contains(styles, s.Name) { // (one sub-option: no choice)
							styles = append(styles, s.Name)
						}
					}
				}
				if len(styles) == 0 {
					styles = []string{"Default"}
				}
				for _, st := range styles {
					var folders []string
					for _, o := range v1 {
						folders = append(folders, o.Include...)
						if len(o.SubOptions) == 0 {
							continue
						}
						pick := o.SubOptions[0]
						for _, s := range o.SubOptions {
							if s.Name == st {
								pick = s
							}
						}
						folders = append(folders, pick.Include...)
					}
					opts = append(opts, option{st, folders, "", ""})
				}
				im.Notes = append(im.Notes, fmt.Sprintf("%d options layered into one project; variants by sub-option style (%s)", len(v1), strings.Join(styles, ", ")))
			}
		} else { // legacy: Options lists option folders; none = the patches next to the manifest
			var legacy []string
			if len(raw.Options) > 0 {
				json.Unmarshal(raw.Options, &legacy)
			}
			for _, f := range legacy {
				opts = append(opts, option{f, []string{f}, "", ""})
			}
			if len(legacy) == 0 {
				opts = append(opts, option{"default", []string{"."}, "", ""})
			}
		}
	} else { // no manifest: every folder with patches is an option
		dirs := map[string]bool{}
		for p := range rel {
			if patchName.MatchString(path.Base(p)) {
				dirs[path.Dir(p)] = true
			}
		}
		var ds []string
		for d := range dirs {
			ds = append(ds, d)
		}
		sort.Strings(ds)
		for _, d := range ds {
			name := d
			if d == "." {
				name = "default"
			}
			opts = append(opts, option{name, []string{d}, "", ""})
		}
	}
	if len(opts) == 0 {
		return nil, fmt.Errorf("no patch files found (a mod has <archive>.patch_0 files)")
	}
	// every patch the options use, read once (an overhaul's styles share most folders), in the archive's order
	folderPatches := func(folder string) []string {
		folder = strings.Trim(path.Clean(strings.ReplaceAll(folder, `\`, "/")), "/")
		var patches []string
		for p := range rel {
			if patchName.MatchString(path.Base(p)) && strings.EqualFold(path.Dir(p), folder) {
				patches = append(patches, p)
			}
		}
		sort.Slice(patches, func(i, j int) bool { // later wins (same number: by name, a fixed order)
			if a, b := patchNum(patches[i]), patchNum(patches[j]); a != b {
				return a < b
			}
			return patches[i] < patches[j]
		})
		return patches
	}
	var used []string
	seen := map[string]bool{}
	for _, o := range opts {
		for _, folder := range o.folders {
			for _, p := range folderPatches(folder) {
				if !seen[p] {
					seen[p] = true
					used = append(used, p)
				}
			}
		}
	}
	read := readPatches(src, rel, find, used, o.WantTexture)
	skipped := map[string]bool{}
	for _, o := range opts {
		v := ImportedVariant{Name: o.name, Description: o.desc, Image: picture(o.image), LUTs: map[uint64]*lut.Texture{}, Textures: map[uint64]RawTexture{}}
		for _, folder := range o.folders {
			for _, p := range folderPatches(folder) {
				pr := read[p]
				if pr.err != nil {
					note := fmt.Sprintf("%s: %v", p, pr.err)
					if !slices.Contains(im.Notes, note) {
						im.Notes = append(im.Notes, note)
					}
					continue
				}
				for k := range pr.skipped {
					skipped[k] = true
				}
				for _, h := range pr.order {
					t := pr.luts[h]
					v.LUTs[h] = &lut.Texture{Width: t.Width, Height: t.Height, Px: slices.Clone(t.Px)} // (each variant its own)
				}
				for h, t := range pr.textures {
					v.Textures[h] = t
				}
			}
		}
		im.Variants = append(im.Variants, v)
	}
	im.Skipped = len(skipped)
	for _, mo := range layered {
		io := ImportedOption{Name: mo.Name, Description: mo.Description, Image: picture(mo.Image),
			ChoiceDescription: map[string]string{}, ChoiceImage: map[string][]byte{}}
		folders := append([]string{}, mo.Include...)
		for _, sub := range mo.SubOptions {
			folders = append(folders, sub.Include...)
			if len(mo.SubOptions) > 1 {
				io.Choices = append(io.Choices, sub.Name)
				io.ChoiceDescription[sub.Name] = sub.Description
				io.ChoiceImage[sub.Name] = picture(sub.Image)
			}
		}
		seenPart := map[uint64]bool{}
		for _, folder := range folders {
			for _, p := range folderPatches(folder) {
				pr := read[p]
				if pr == nil || pr.err != nil {
					continue
				}
				for h := range pr.luts {
					seenPart[h] = true
				}
				for h := range pr.textures {
					seenPart[h] = true
				}
			}
		}
		for h := range seenPart {
			io.Parts = append(io.Parts, h)
		}
		slices.Sort(io.Parts)
		im.Layout = append(im.Layout, io)
	}
	return im, nil
}

func patchNum(p string) int {
	var n int
	fmt.Sscan(patchName.FindStringSubmatch(path.Base(p))[1], &n)
	return n
}

// maxLUTBytes: the most texel data a LUT can have (a 23-column RGBA32F LUT of 256 zones with mips is under 200 KB);
// bigger textures (the mod's other textures) are not read at all
const maxLUTBytes = 1 << 20

// patchLUTs is what one patch holds: its LUTs (in table order) and the keys of its other files.
type patchLUTs struct {
	luts     map[uint64]*lut.Texture
	order    []uint64
	textures map[uint64]RawTexture // the wanted textures
	skipped  map[string]bool
	err      error
}

// orderer: a Source that knows its files' order in the archive (reading in that order is fastest: a 7z decompresses
// a solid block from its start).
type orderer interface{ order(p string) int }

// readPatches reads the LUTs of patches (paths in the mod; rel maps them to src paths): their tables first, then
// from their .gpu_resources / .stream only the textures small enough to be LUTs (maxLUTBytes) and the wanted ones
// (want, up to maxTextureBytes), each data file in one pass, all in the archive's order. A texture whose data lies
// outside its files (a damaged or cut-off mod) counts as not a LUT.
func readPatches(src Source, rel map[string]string, find func(string) (string, bool), patches []string, want func(uint64) bool) map[string]*patchLUTs {
	ord := func(p string) int {
		if o, ok := src.(orderer); ok {
			return o.order(p)
		}
		return 0
	}
	sorted := slices.Clone(patches)
	sort.SliceStable(sorted, func(i, j int) bool { return ord(rel[sorted[i]]) < ord(rel[sorted[j]]) })
	out := map[string]*patchLUTs{}
	tocs := map[string][]byte{}
	entries := map[string][]Entry{}
	wanted := map[string][]part{} // data file (src path) -> parts
	wanted1 := func(e Entry) bool {
		return want != nil && e.Type == textureType && want(e.Name) && e.GPUSize <= maxTextureBytes && e.StreamSize <= maxTextureBytes
	}
	isCand := func(e Entry) bool {
		return e.Type == textureType && e.GPUSize <= maxLUTBytes && e.StreamSize <= maxLUTBytes || wanted1(e)
	}
	for _, p := range sorted {
		out[p] = &patchLUTs{luts: map[uint64]*lut.Texture{}, textures: map[uint64]RawTexture{}, skipped: map[string]bool{}}
		toc, err := readAll(src, rel[p], 256<<20)
		if err == nil {
			entries[p], err = ReadTOC(toc)
		}
		if err != nil {
			out[p].err = err
			continue
		}
		tocs[p] = toc
		for _, e := range entries[p] {
			if !isCand(e) {
				continue
			}
			if f, ok := find(p + ".gpu_resources"); ok && e.GPUSize > 0 {
				wanted[f] = append(wanted[f], part{e.GPUOff, e.GPUSize})
			}
			if f, ok := find(p + ".stream"); ok && e.StreamSize > 0 {
				wanted[f] = append(wanted[f], part{e.StreamOff, e.StreamSize})
			}
		}
	}
	var files []string
	for f := range wanted {
		files = append(files, f)
	}
	sort.Slice(files, func(i, j int) bool { return ord(files[i]) < ord(files[j]) })
	data, readErr := map[string]map[part][]byte{}, map[string]error{}
	for _, f := range files {
		d, err := readParts(src, f, wanted[f])
		if err != nil {
			readErr[f] = err
			d = map[part][]byte{}
		}
		data[f] = d
	}
	// a patch whose GPU or stream part can't be read: said as the patch's error (a note), not taken for "no LUTs"
	for _, p := range sorted {
		for _, ext := range []string{".gpu_resources", ".stream"} {
			if f, ok := find(p + ext); ok && readErr[f] != nil && len(wanted[f]) > 0 && out[p] != nil && out[p].err == nil {
				out[p].err = fmt.Errorf("%s can't be read: %w", path.Base(f), readErr[f])
			}
		}
	}
	for _, p := range sorted {
		pr := out[p]
		if pr.err != nil {
			continue
		}
		for _, e := range entries[p] {
			key := fmt.Sprintf("%016x.%016x", e.Name, e.Type)
			if !isCand(e) {
				pr.skipped[key] = true
				continue
			}
			m, ok := span(tocs[p], e.MainOff, e.MainSize)
			gf, _ := find(p + ".gpu_resources")
			sf, _ := find(p + ".stream")
			g, gok := data[gf][part{e.GPUOff, e.GPUSize}]
			st, sok := data[sf][part{e.StreamOff, e.StreamSize}]
			if !ok || !(gok || e.GPUSize == 0) || !(sok || e.StreamSize == 0) {
				pr.skipped[key] = true
				continue
			}
			if wanted1(e) {
				pr.textures[e.Name] = RawTexture{Main: slices.Clone(m), Stream: slices.Clone(st), GPU: slices.Clone(g)}
				continue
			}
			px := g
			if len(px) == 0 { // the SDK reads a texture's pixels from .stream when it has one
				px = st
			}
			t, err := lut.Decode(m, px)
			if err == nil {
				_, err = lut.KindOf(t)
			}
			if err != nil {
				pr.skipped[key] = true
				continue
			}
			if _, dup := pr.luts[e.Name]; !dup {
				pr.order = append(pr.order, e.Name)
			}
			pr.luts[e.Name] = t
		}
	}
	return out
}

// shallowest: the least nested path whose base name is name ("" = none).
func shallowest(files []string, name string) string {
	best := ""
	for _, p := range files {
		if strings.EqualFold(path.Base(p), name) && (best == "" || strings.Count(p, "/") < strings.Count(best, "/")) {
			best = p
		}
	}
	return best
}

// commonDir: the folder all files are in, when they share one top folder ("" = none).
func commonDir(files []string) string {
	top := ""
	for _, p := range files {
		i := strings.Index(p, "/")
		if i < 0 {
			return ""
		}
		if top == "" {
			top = p[:i]
		} else if p[:i] != top {
			return ""
		}
	}
	return top
}

// relaxJSON: a manifest as the mod manager reads it (System.Text.Json with AllowTrailingCommas and comments skipped,
// Helldivers2ModManager Models/ModManifest.cs) turned into strict JSON: comments and trailing commas removed.
func relaxJSON(b []byte) []byte {
	out := make([]byte, 0, len(b))
	inStr, esc := false, false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if inStr {
			out = append(out, c)
			switch {
			case esc:
				esc = false
			case c == '\\':
				esc = true
			case c == '"':
				inStr = false
			}
			continue
		}
		switch {
		case c == '"':
			inStr = true
		case c == '/' && i+1 < len(b) && b[i+1] == '/':
			for i < len(b) && b[i] != '\n' {
				i++
			}
			i--
			continue
		case c == '/' && i+1 < len(b) && b[i+1] == '*':
			end := bytes.Index(b[i+2:], []byte("*/"))
			if end < 0 {
				return out
			}
			i += end + 3
			continue
		case c == ']' || c == '}':
			// drop a comma before it (whitespace between)
			j := len(out) - 1
			for j >= 0 && (out[j] == ' ' || out[j] == '\t' || out[j] == '\r' || out[j] == '\n') {
				j--
			}
			if j >= 0 && out[j] == ',' {
				out = append(out[:j], out[j+1:]...)
			}
		}
		out = append(out, c)
	}
	return out
}
