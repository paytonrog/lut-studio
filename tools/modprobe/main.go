// modprobe: dev tool (not shipped). What a mod zip contains, per resource type, and its LUT-shaped textures.
//
//	go run ./tools/modprobe <mod.zip>
package main

import (
	"fmt"
	"os"
	"sort"

	"lutstudio/lut"
	"lutstudio/modpack"
)

func main() {
	b, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	files, err := modpack.ZipFiles(b)
	if err != nil {
		panic(err)
	}
	im, err := modpack.ReadMod(modpack.Files(files), "probe")
	if err != nil {
		panic(err)
	}
	luts := map[uint64]*lut.Texture{}
	for _, v := range im.Variants {
		for h, t := range v.LUTs {
			luts[h] = t
		}
	}
	widths := map[int]int{}
	var hs []string
	for h, t := range luts {
		widths[t.Width]++
		hs = append(hs, lut.HashString(h))
	}
	sort.Strings(hs)
	fmt.Printf("%q: %d options, %d distinct LUT textures (by width %v), %d other resources\n", im.Name, len(im.Variants), len(luts), widths, im.Skipped)
	for i, h := range hs {
		if i < 100000 {
			fmt.Println(" ", h)
		}
	}
	// every resource of every patch: type counts, and texture formats (DXGI) with sizes
	types, fmts := map[string]int{}, map[string]int{}
	for p, toc := range files {
		if len(p) < 8 || p[len(p)-8:] != ".patch_0" {
			continue
		}
		res, err := modpack.ReadArchive(modpack.Archive{TOC: toc, GPU: files[p+".gpu_resources"], Stream: files[p+".stream"]})
		if err != nil {
			continue
		}
		for _, r := range res {
			name := typeNames[r.Type]
			if name == "" {
				name = fmt.Sprintf("%016x", r.Type)
			}
			types[name]++
			if name == "texture" && len(r.Main) >= 0xC0+148 {
				d := r.Main[0xC0:]
				w, h := le32(d[16:]), le32(d[12:])
				fmts[fmt.Sprintf("dxgi %d %dx%d", le32(d[128:]), w, h)]++
			}
		}
	}
	fmt.Println("resource types (all options):", types)
	fmt.Println("texture formats:", fmts)
}

func le32(b []byte) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24
}

var typeNames = map[uint64]string{0xcd4238c6a0c69e32: "texture", 0xeac0b497876adedf: "material", 0xe0a48d0be9a7453f: "unit"}
