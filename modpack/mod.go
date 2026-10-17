package modpack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"sort"
	"strings"
	"time"
)

// Variant is one color scheme: a folder with its own patch. Variants are SubOptions in the manifest, so the user
// picks exactly one (two variants of the same LUT cannot both win anyway).
type Variant struct {
	Name, Description string
	Folder            string // folder name inside the zip
	Image             []byte // PNG shown for this choice in the manager (optional)
	Resources         []Resource
}

type Mod struct {
	Name, Description, GUID string
	Icon                    []byte // PNG
	Variants                []Variant
	// the choice between several variants (one option, the variants its sub-options): its name and description
	// ("Color scheme" / "Pick one." when empty) and picture (PNG; the icon when nil)
	OptionName, OptionDescription string
	OptionImage                   []byte
	// Options: the mod as several options, each switched on by itself (when set, Variants is not used)
	Options []Option
}

// Option is one part of the mod players switch on by itself: one patch (Resources, no Choices) or a pick-one choice
// between Choices (sub-options), each with its own patch.
type Option struct {
	Name, Description string
	Folder            string // folder in the zip
	Image             []byte // PNG (nil: the icon)
	Resources         []Resource
	Choices           []Variant
}

// MaxFolder: the longest folder name in the zip (HD2 Arsenal's mod builder allows 29 characters).
const MaxFolder = 29

// folders: each variant's folder in the zip: its own, cut to MaxFolder characters and made unique
func (m Mod) folders() []string {
	out := make([]string, len(m.Variants))
	used := map[string]bool{}
	for i, v := range m.Variants {
		f := v.Folder
		if len(f) > MaxFolder {
			f = strings.TrimRight(f[:MaxFolder], "-")
		}
		base := f
		for n := 2; used[f]; n++ {
			suffix := fmt.Sprintf("-%d", n)
			f = base
			if len(f)+len(suffix) > MaxFolder {
				f = f[:MaxFolder-len(suffix)]
			}
			f += suffix
		}
		used[f] = true
		out[i] = f
	}
	return out
}

type manifestOption struct {
	Name        string           `json:"Name"`
	Description string           `json:"Description"`
	Include     []string         `json:"Include,omitempty"`
	Image       string           `json:"Image,omitempty"`
	SubOptions  []manifestOption `json:"SubOptions,omitempty"`
}

type manifest struct {
	Version     int              `json:"Version"`
	Guid        string           `json:"Guid"`
	Name        string           `json:"Name"`
	Description string           `json:"Description"`
	IconPath    string           `json:"IconPath"`
	Options     []manifestOption `json:"Options"`
}

const (
	iconPath   = "icon.png"
	optionPath = "images/option.choice.png" // (no variant folder has a dot: no clash with images/<folder>.png)
)

// optionFolders: each option's folder and its choices' folders ("<option>/<choice>"), each name cut to MaxFolder and
// unique among its siblings
func (m Mod) optionFolders() ([]string, [][]string) {
	cut := func(names []string) []string { return Mod{Variants: variantsNamed(names)}.folders() }
	var names []string
	for _, o := range m.Options {
		names = append(names, o.Folder)
	}
	opt := cut(names)
	subs := make([][]string, len(m.Options))
	for i, o := range m.Options {
		var cn []string
		for _, c := range o.Choices {
			cn = append(cn, c.Folder)
		}
		for _, f := range cut(cn) {
			subs[i] = append(subs[i], opt[i]+"/"+f)
		}
	}
	return opt, subs
}

func variantsNamed(folders []string) []Variant {
	vs := make([]Variant, len(folders))
	for i, f := range folders {
		vs[i].Folder = f
	}
	return vs
}

// imageName: a picture's file in the zip for a folder path ("armor/red" -> images/armor-red.png)
func imageName(folder string) string {
	return "images/" + strings.ReplaceAll(folder, "/", "-") + ".png"
}

func (m Mod) manifest() manifest {
	mf := manifest{Version: 1, Guid: m.GUID, Name: m.Name, Description: m.Description, IconPath: iconPath}
	if len(m.Options) > 0 {
		opt, subs := m.optionFolders()
		for i, o := range m.Options {
			mo := manifestOption{Name: o.Name, Description: o.Description, Image: iconPath}
			if o.Image != nil {
				mo.Image = imageName(opt[i])
			}
			if len(o.Choices) == 0 {
				mo.Include = []string{opt[i]}
			}
			for j, c := range o.Choices {
				img := iconPath
				if c.Image != nil {
					img = imageName(subs[i][j])
				}
				mo.SubOptions = append(mo.SubOptions, manifestOption{Name: c.Name, Description: c.Description, Include: []string{subs[i][j]}, Image: img})
			}
			mf.Options = append(mf.Options, mo)
		}
		return mf
	}
	folders := m.folders()
	if len(m.Variants) == 1 { // one option: the mod itself (its picture: the variant's, else the icon)
		v, img := m.Variants[0], iconPath
		if v.Image != nil {
			img = "images/" + folders[0] + ".png"
		}
		mf.Options = []manifestOption{{Name: m.Name, Description: m.Description, Include: []string{folders[0]}, Image: img}}
		return mf
	}
	opt := manifestOption{Name: m.OptionName, Description: m.OptionDescription, Image: iconPath}
	if opt.Name == "" {
		opt.Name = "Color scheme"
	}
	if opt.Description == "" {
		opt.Description = "Pick one."
	}
	if m.OptionImage != nil {
		opt.Image = optionPath
	}
	for i, v := range m.Variants {
		img := iconPath
		if v.Image != nil {
			img = "images/" + folders[i] + ".png"
		}
		opt.SubOptions = append(opt.SubOptions, manifestOption{Name: v.Name, Description: v.Description,
			Include: []string{folders[i]}, Image: img})
	}
	mf.Options = []manifestOption{opt}
	return mf
}

// Zip builds the importable mod: manifest.json, icon.png, images/, and per variant
// <folder>/9ba626afa44a3aa3.patch_0 (+ .gpu_resources, .stream). Deterministic (fixed timestamps, sorted).
func (m Mod) Zip() ([]byte, error) {
	if len(m.Options) > 0 {
		return m.zipOptions()
	}
	if len(m.Variants) == 0 {
		return nil, fmt.Errorf("no variants")
	}
	files := map[string][]byte{}
	seen := map[string]bool{}
	folders := m.folders()
	for i, v := range m.Variants {
		if v.Folder == "" || seen[v.Folder] {
			return nil, fmt.Errorf("variant %q: empty or duplicate folder %q", v.Name, v.Folder)
		}
		seen[v.Folder] = true
		v.Folder = folders[i] // (in the zip)
		if len(v.Resources) == 0 {
			return nil, fmt.Errorf("variant %q has no LUTs", v.Name)
		}
		a := WriteArchive(v.Resources)
		if err := Verify(a, v.Resources); err != nil {
			return nil, fmt.Errorf("variant %q: %w", v.Name, err)
		}
		p := v.Folder + "/" + BootArchive + ".patch_0"
		files[p], files[p+".gpu_resources"], files[p+".stream"] = a.TOC, a.GPU, a.Stream
		if v.Image != nil {
			files["images/"+v.Folder+".png"] = v.Image
		}
	}
	if m.OptionImage != nil && len(m.Variants) > 1 {
		files[optionPath] = m.OptionImage
	}
	return m.write(files)
}

// write zips files with the manifest and the icon (deterministic: fixed timestamps, sorted).
func (m Mod) write(files map[string][]byte) ([]byte, error) {
	mf, err := json.MarshalIndent(m.manifest(), "", "  ")
	if err != nil {
		return nil, err
	}
	files["manifest.json"] = append(mf, '\n')
	files[iconPath] = m.Icon
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for _, n := range names {
		w, err := z.CreateHeader(&zip.FileHeader{Name: n, Method: zip.Deflate,
			Modified: time.Date(1980, 1, 1, 0, 0, 0, 0, time.Local)})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(files[n]); err != nil {
			return nil, err
		}
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Swatch draws a placeholder icon from color rows: one column per LUT, one band per zone (left: paint color,
// right: secondary color). Used until the preview renderer exists or when the project has no icon.
// cols[i][zone] = {paint rgb, secondary rgb} in sRGB 0-1.
func Swatch(cols [][][2][3]float32, size int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	bg := color.RGBA{24, 26, 30, 255}
	for i := range img.Pix {
		img.Pix[i] = []byte{bg.R, bg.G, bg.B, bg.A}[i%4]
	}
	to8 := func(v float32) uint8 { return uint8(math.Round(float64(min(max(v, 0), 1)) * 255)) }
	pad := size / 16
	n := max(1, len(cols))
	cw := (size - pad*(n+1)) / n
	for i, zones := range cols {
		x0 := pad + i*(cw+pad)
		zh := (size - 2*pad) / max(1, len(zones))
		for z, c := range zones {
			y0 := pad + z*zh
			for y := y0; y < y0+zh-max(1, size/128); y++ {
				for x := x0; x < x0+cw; x++ {
					k := c[0]
					if x >= x0+cw*2/3 {
						k = c[1]
					}
					img.SetRGBA(x, y, color.RGBA{to8(k[0]), to8(k[1]), to8(k[2]), 255})
				}
			}
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

// zipOptions: the zip of a mod with Options: per option its patch (a switch) or its choices' patches, and pictures
func (m Mod) zipOptions() ([]byte, error) {
	files := map[string][]byte{}
	opt, subs := m.optionFolders()
	patch := func(folder, what string, res []Resource) error {
		if len(res) == 0 {
			return fmt.Errorf("%s has no LUTs", what)
		}
		a := WriteArchive(res)
		if err := Verify(a, res); err != nil {
			return fmt.Errorf("%s: %w", what, err)
		}
		p := folder + "/" + BootArchive + ".patch_0"
		files[p], files[p+".gpu_resources"], files[p+".stream"] = a.TOC, a.GPU, a.Stream
		return nil
	}
	for i, o := range m.Options {
		if o.Image != nil {
			files[imageName(opt[i])] = o.Image
		}
		if len(o.Choices) == 0 {
			if err := patch(opt[i], fmt.Sprintf("option %q", o.Name), o.Resources); err != nil {
				return nil, err
			}
			continue
		}
		for j, c := range o.Choices {
			if err := patch(subs[i][j], fmt.Sprintf("option %q, %q", o.Name, c.Name), c.Resources); err != nil {
				return nil, err
			}
			if c.Image != nil {
				files[imageName(subs[i][j])] = c.Image
			}
		}
	}
	return m.write(files)
}
