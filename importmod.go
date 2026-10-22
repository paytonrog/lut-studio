package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/xypwn/filediver/dds"

	"lutstudio/game"
	"lutstudio/lut"
	"lutstudio/modpack"
	"lutstudio/project"
	"lutstudio/server"
	"lutstudio/texenc"
)

// importMod makes a project in dir from an existing mod's LUTs (modpack.ReadMod): one variant per option of the
// mod, based on the item that uses most of its LUTs (its other LUTs come in with the game's values, as for a new
// project). Every variant gets the same LUTs (the game's values where an option doesn't change one). Every LUT the
// game has comes in, also those of materials no listed item uses (editable in the LUT list, shown on no model); the
// mod's own LUTs (for models it adds) can't be. The mod's decal sheets and cape designs (read when ModOptions asks
// for them) come in as the variants' edited textures. Returns a short report.
func (e *env) importMod(dir string, im *modpack.Imported) (string, error) {
	idx, err := e.index()
	if err != nil {
		return "", err
	}
	g, err := e.game()
	if err != nil {
		return "", err
	}
	// the mod's LUTs the game has (items' and other materials'); left out: LUTs the game doesn't have (the mod's own,
	// for models it adds or replaces, or ones an update removed from a mod made for an older game)
	parts := idx.Parts()
	all, other, own := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, v := range im.Variants {
		for h := range v.LUTs {
			switch hs := lut.HashString(h); {
			case len(parts[hs]) > 0:
				all[hs] = true
			case !g.HasTexture(h):
				own[hs] = true
			default:
				all[hs], other[hs] = true, true
			}
		}
	}
	textures := 0
	for _, v := range im.Variants {
		textures += len(v.Textures)
	}
	leftOut := func() string {
		if len(own) == 0 {
			return ""
		}
		return fmt.Sprintf("%d LUT(s) this game build doesn't have: the mod may be made for an older version of the game "+
			"(an update removed or renamed them), or they are the mod's own, for models it adds (nothing to show them on)", len(own))
	}
	if len(all) == 0 && textures == 0 {
		if len(own) > 0 {
			return "", fmt.Errorf("none of this mod's LUTs is in this game build: %s", leftOut())
		}
		return "", fmt.Errorf("no LUT edits found in this mod (%d other files: meshes, textures or other data LUT Studio doesn't edit)", im.Skipped)
	}
	// the armor using most of the mod's LUTs (named kits first)
	count := map[string]int{}
	for h := range all {
		seen := map[string]bool{}
		for _, p := range parts[h] {
			if !seen[p.Key] {
				seen[p.Key] = true
				count[p.Key]++
			}
		}
	}
	var keys []string
	for k := range count {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if count[keys[i]] != count[keys[j]] {
			return count[keys[i]] > count[keys[j]]
		}
		return keys[i] < keys[j]
	})
	// every variant holds every LUT of the mod: refuse what would be far too big to edit (a mis-read overhaul wrote
	// 374 x 660 files once)
	if n := len(im.Variants) * len(all); n > 20000 {
		return "", fmt.Errorf("this mod would need %d variants x %d LUTs = %d LUT files; too big to import", len(im.Variants), len(all), n)
	}
	_, existed := os.Stat(dir)
	p, err := project.Create(dir, im.Name)
	if err != nil {
		return "", err
	}
	if im.GUID != "" { // (the mod's own identity: a rebuild replaces the installed mod)
		p.GUID = im.GUID
	}
	// a failed import leaves no half-made project in the list (only a folder this import made is removed)
	ok := false
	defer func() {
		if !ok && existed != nil {
			os.RemoveAll(dir)
		}
	}()
	p.Description = im.Description
	// variants: the mod's options
	used := map[string]bool{}
	for i, v := range im.Variants {
		name := v.Name
		if len(im.Variants) == 1 || name == "" {
			name = "Default"
		}
		folder := project.Folder(name)
		for n := 2; used[folder]; n++ {
			folder = fmt.Sprintf("%s-%d", project.Folder(name), n)
		}
		used[folder] = true
		pv := project.Variant{Name: name, Folder: folder, Description: v.Description}
		if i == 0 {
			if from, to := p.VariantDir(p.Variants[0]), p.VariantDir(pv); from != to {
				if err := os.Rename(from, to); err != nil {
					return "", err
				}
			}
			p.Variants[0] = pv
		} else {
			if err := os.MkdirAll(p.VariantDir(pv), 0o755); err != nil {
				return "", err
			}
			p.Variants = append(p.Variants, pv)
		}
	}
	// the mod page: the choice's name and description (unless the defaults), the pictures as PNGs
	if len(p.Variants) > 1 {
		if im.OptionName != "Color scheme" {
			p.Option = im.OptionName
		}
		if im.OptionDescription != "Pick one." {
			p.OptionDescription = im.OptionDescription
		}
	}
	pictures := 0
	keep := func(b []byte, rel string) string {
		if b == nil || writePicture(filepath.Join(p.Dir, filepath.FromSlash(rel)), b) != nil {
			return ""
		}
		pictures++
		return rel
	}
	p.Icon = keep(im.Icon, "icon.png")
	if len(p.Variants) > 1 && !bytes.Equal(im.OptionImage, im.Icon) { // (the icon stands in for none)
		p.OptionImage = keep(im.OptionImage, "images/option.choice.png")
	}
	{ // (one variant's picture too: the build shows it for the option)
		for i := range p.Variants {
			if b := im.Variants[i].Image; b != nil && !bytes.Equal(b, im.Icon) { // (the icon stands in for none)
				p.Variants[i].Image = keep(b, "images/"+p.Variants[i].Folder+".png")
			}
		}
	}
	// several options (an overhaul, a LUT Studio mod with options): the same options in the project, each with its
	// parts that came in and the variants that are its choices (by name; a switch: the first variant)
	modTextures := map[uint64]bool{}
	for _, v := range im.Variants {
		for h := range v.Textures {
			modTextures[h] = true
		}
	}
	usedIDs := map[string]bool{}
	for _, lo := range im.Layout {
		o := project.Option{Name: lo.Name, Description: lo.Description}
		for _, h := range lo.Parts {
			if hs := lut.HashString(h); all[hs] || modTextures[h] {
				o.Parts = append(o.Parts, hs)
			}
		}
		for _, c := range lo.Choices {
			for i, v := range im.Variants {
				if v.Name == c && !slices.Contains(o.Variants, p.Variants[i].Folder) {
					o.Variants = append(o.Variants, p.Variants[i].Folder)
				}
			}
		}
		if len(o.Variants) == 0 {
			o.Variants = []string{p.Variants[0].Folder}
		}
		if len(o.Parts) == 0 { // only the mod's own LUTs (for its models) or none
			continue
		}
		o.ID = project.Folder(o.Name)
		for n, base := 2, o.ID; usedIDs[o.ID]; n++ {
			o.ID = fmt.Sprintf("%s-%d", base, n)
		}
		usedIDs[o.ID] = true
		if !bytes.Equal(lo.Image, im.Icon) { // (the icon stands in for none)
			o.Image = keep(lo.Image, project.OptionImage(o.ID, ""))
		}
		for i, v := range im.Variants {
			if b := lo.ChoiceImage[v.Name]; b != nil && !bytes.Equal(b, im.Icon) && slices.Contains(o.Variants, p.Variants[i].Folder) {
				if rel := keep(b, project.OptionImage(o.ID, p.Variants[i].Folder)); rel != "" {
					if o.Images == nil {
						o.Images = map[string]string{}
					}
					o.Images[p.Variants[i].Folder] = rel
				}
			}
		}
		p.Options = append(p.Options, o)
	}
	if err := p.Save(); err != nil {
		return "", err
	}
	base := ""
	if len(keys) > 0 && count[keys[0]]*2 >= len(all) { // a mod mostly about one armor: its other LUTs too
		base = keys[0]
		items, _, err := e.target(base)
		if err != nil {
			return "", err
		}
		for _, pv := range p.Variants {
			if err := e.pullInto(p, pv, items); err != nil {
				return "", err
			}
		}
	}
	users := idx.Users()
	changed, differ := 0, map[string]bool{} // edits that differ from the game's, and their LUTs
	vanillas := map[uint64]*lut.Texture{}
	vanilla := func(h uint64) (*lut.Texture, error) {
		if t, ok := vanillas[h]; ok {
			return t, nil
		}
		t, err := g.ReadLUT(h)
		if err == nil {
			vanillas[h] = t
		}
		return t, err
	}
	marked := 0
	for i, pv := range p.Variants {
		docs, _, _ := p.Docs(pv)
		labels := map[string][]string{}
		for _, d := range docs {
			labels[d.LUT] = d.Labels
		}
		for hs := range all {
			h, _ := lut.ParseHash(hs)
			t := im.Variants[i].LUTs[h]
			if t != nil { // a mod LUT Studio built: its build mark out (lut/mark.go), the game's values back
				van, _ := vanilla(h)
				if lut.Unmark(t, van) {
					marked++
				}
			}
			if t == nil { // this option leaves it as the game has it
				if _, ok := labels[hs]; ok {
					continue
				}
				if t, err = g.ReadLUT(h); err != nil {
					return "", err
				}
			} else if van, err := vanilla(h); err != nil || !van.Equal(t) {
				changed++
				differ[hs] = true
			}
			kind, err := lut.KindOf(t)
			if err != nil {
				return "", fmt.Errorf("%s: %w", hs, err)
			}
			note := ""
			if u := users[hs]; len(u) > 0 {
				note = "Used by " + strings.Join(u, ", ")
				if len(u) > 6 {
					note = fmt.Sprintf("Used by %s and %d more", strings.Join(u[:6], ", "), len(u)-6)
				}
			}
			d := &lut.Document{LUT: hs, Kind: kind, Note: note, Labels: labels[hs], Tex: t}
			if err := project.WriteDoc(p.DocPath(pv, hs), d); err != nil {
				return "", err
			}
		}
	}
	// the mod's decal sheets and cape designs: each variant's, as the editors keep them (server/decals.go)
	sheets, designs := g.EditableTextures(idx)
	masks, patterns := g.EditableMasks(idx)
	nMasks, nPatterns := map[uint64]bool{}, map[uint64]bool{}
	nSheets, nDesigns := map[uint64]bool{}, map[uint64]bool{}
	var texNotes []string
	for i, pv := range p.Variants {
		for h, raw := range im.Variants[i].Textures {
			design := designs[h] && !sheets[h]
			kind := "sheet"
			switch {
			case design:
				kind = "design"
			case masks[h] && !sheets[h]:
				kind = "mask"
			case patterns[h] && !sheets[h]:
				kind = "pattern"
			}
			if err := importTexture(g, server.SheetPath(p, pv, h, kind), h, raw); err != nil {
				if note := fmt.Sprintf("%s: %v", lut.HashString(h), err); !slices.Contains(texNotes, note) {
					texNotes = append(texNotes, note)
				}
				continue
			}
			switch kind {
			case "design":
				nDesigns[h] = true
			case "mask":
				nMasks[h] = true
			case "pattern":
				nPatterns[h] = true
			default:
				nSheets[h] = true
			}
		}
	}
	rep := fmt.Sprintf("Imported %q: %d variant(s), %d LUT(s) changed by the mod (%d edits in all)", im.Name, len(p.Variants), len(differ), changed)
	if marked > 0 {
		rep += ", made with LUT Studio"
	}
	if same := len(all) - len(differ); same > 0 {
		rep += fmt.Sprintf(", %d more the same as the game's", same)
	}
	if base != "" {
		rep += ", based on " + base
	}
	if pictures > 0 {
		rep += fmt.Sprintf(", %d picture(s)", pictures)
	}
	if len(p.Options) > 0 {
		rep += fmt.Sprintf(", %d option(s) (Mod page)", len(p.Options))
	}
	if len(nSheets)+len(nDesigns) > 0 {
		rep += fmt.Sprintf(", %d decal sheet(s) and %d cape design(s)", len(nSheets), len(nDesigns))
	}
	if len(nMasks)+len(nPatterns) > 0 {
		rep += fmt.Sprintf(", %d ID mask(s) and %d pattern mask(s)", len(nMasks), len(nPatterns))
	}
	if len(other) > 0 {
		rep += fmt.Sprintf(". %d of the LUTs belong to game materials no listed item uses: they're in the LUT list to edit (Show all), but no model shows them", len(other))
	}
	if len(texNotes) > 0 {
		rep += ". Textures that didn't come in: " + strings.Join(texNotes, "; ")
	}
	if im.Skipped > 0 {
		rep += fmt.Sprintf(". %d other file(s) in the mod (meshes, textures...) are not LUTs and were left out", im.Skipped)
	}
	if s := leftOut(); s != "" {
		rep += ". Left out: " + s
	}
	if len(im.Notes) > 0 {
		rep += ". Notes: " + strings.Join(im.Notes, "; ")
	}
	ok = true
	return rep + ".", nil
}

// importTexture writes a mod's version of texture h (a decal sheet or cape design) as the editors' PNG at file, at
// the game texture's size
func importTexture(g *game.Game, file string, h uint64, raw modpack.RawTexture) error {
	if len(raw.Main) < 0xC0+128 {
		return fmt.Errorf("no texture header")
	}
	chain := raw.GPU
	if len(raw.Stream) > len(chain) {
		chain = raw.Stream
	}
	data := append(append([]byte(nil), raw.Main[0xC0:]...), chain...)
	// an sRGB format read as its UNORM twin (the decoder knows those; the bytes are the same, the build writes the
	// game's format)
	if len(data) >= 132 && string(data[84:88]) == "DX10" {
		srgb := map[uint32]uint32{29: 28, 72: 71, 75: 74, 78: 77, 99: 98, 91: 87}
		if u, ok := srgb[binary.LittleEndian.Uint32(data[128:])]; ok {
			binary.LittleEndian.PutUint32(data[128:], u)
		}
	}
	tex, err := dds.Decode(bytes.NewReader(data), false)
	if err != nil {
		return fmt.Errorf("can't decode the mod's texture: %w", err)
	}
	img := texenc.ToNRGBA(tex.Image)
	if len(tex.Images) > 1 { // a texture array (an ID mask): its layers stacked top to bottom
		w, h := img.Bounds().Dx(), img.Bounds().Dy()
		st := image.NewNRGBA(image.Rect(0, 0, w, h*len(tex.Images)))
		for l, im := range tex.Images {
			draw.Draw(st, image.Rect(0, l*h, w, (l+1)*h), im.MipMaps[0].Image, im.MipMaps[0].Image.Bounds().Min, draw.Src)
		}
		img = st
	}
	main, _, err := g.ReadTexture(h)
	if err != nil {
		return err
	}
	in, err := texenc.ReadInfo(main)
	if err != nil {
		return err
	}
	// a new design for a placeholder (the editors made it NewDesignSize square, the build wrote it so): kept as is
	b := img.Bounds()
	newDesign := strings.Contains(filepath.ToSlash(file), "/designs/") && server.Placeholder(in) &&
		b.Dx() == server.NewDesignSize && b.Dy() == server.NewDesignSize
	if !newDesign && !texenc.Supported(in.DXGI) {
		return fmt.Errorf("the game's texture format (%d) can't be written", in.DXGI)
	}
	if !newDesign && (b.Dx() != in.Width || b.Dy() != in.Height*in.Layers) {
		img = texenc.Resize(img, in.Width, in.Height*in.Layers)
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, out.Bytes(), 0o644)
}

// writePicture saves an image of a mod (PNG, JPEG or GIF) as PNG
func writePicture(file string, b []byte) error {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return err
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, out.Bytes(), 0o644)
}
