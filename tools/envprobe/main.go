// envprobe: dev tool (not shipped). Lists every planet type's shading environment and its variables, to find the
// sky / light / probe data LUT Studio can light the preview with. Reads the install only.
//
//	go run ./tools/envprobe [-game dir] [-all]
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"os"
	"sort"

	"github.com/xypwn/filediver/app"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/entity"
	"github.com/xypwn/filediver/stingray/shading_environment"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"

	"lutstudio/game"
)

func main() {
	gameDir := flag.String("game", "", "install folder")
	cubes := flag.String("cubes", "", "write every cubemap as a PNG strip into this folder")
	all := flag.Bool("all", false, "also list every shading_environment file, not only the planet types'")
	flag.Parse()
	if *gameDir == "" {
		d, err := game.Detect()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		*gameDir = d
	}
	a, err := app.OpenGameDir(context.Background(), *gameDir, hashes.ParseHashes(hashes.Hashes),
		hashes.ParseHashes(hashes.ThinHashes), stingray_strings.LanguageFriendlyNameToHash["English (US)"], nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	seType := stingray.Sum("shading_environment")
	dump := func(h stingray.Hash) {
		b, err := a.DataDir.Read(stingray.FileID{Name: h, Type: seType}, stingray.DataMain)
		if err != nil { // planet environments are entities (components of settings mapped to shader variables)
			dumpEntity(a, h)
			return
		}
		se, err := shading_environment.LoadShadingEnvironment(bytes.NewReader(b))
		if err != nil {
			fmt.Println("   parse:", err)
			return
		}
		fmt.Printf("   material %s, %d variables\n", a.LookupHash(se.Material), len(se.Variables))
		for _, v := range se.Variables {
			d := v.Data
			if hh, ok := d.(stingray.Hash); ok {
				d = a.LookupHash(hh)
			}
			fmt.Printf("     %-10s %-40s %v\n", v.Type, a.LookupThinHash(v.Name), d)
		}
	}
	var types []int
	for t := range a.EnvironmentMap {
		types = append(types, int(t))
	}
	sort.Ints(types)
	for _, t := range types {
		for pt, e := range a.EnvironmentMap {
			if int(pt) != t {
				continue
			}
			fmt.Printf("== %v %q: shading_environment %s, grading day %s / sunset %s / night %s, dirt %v\n", pt, e.DebugName,
				a.LookupHash(e.ShadingEnvironment), a.LookupHash(e.GradingDay), a.LookupHash(e.GradingSunset),
				a.LookupHash(e.GradingNight), e.DirtColor)
			dump(e.ShadingEnvironment)
		}
	}
	typesOf := func(h stingray.Hash) (out []string) {
		for id := range a.DataDir.Files {
			if id.Name == h {
				out = append(out, a.LookupHash(id.Type))
			}
		}
		return
	}
	fmt.Println("== resource types of the planet-type hashes:")
	for _, e := range a.EnvironmentMap {
		for _, h := range []stingray.Hash{e.ShadingEnvironment, e.GradingDay, e.PlanetMaterialId, e.TerrainMaterialPath} {
			fmt.Printf("  %s %s: %v\n", e.DebugName, a.LookupHash(h), typesOf(h))
		}
		break
	}
	counts := map[string]int{}
	for id := range a.DataDir.Files {
		counts[a.LookupHash(id.Type)]++
	}
	fmt.Println("== file types:", counts)
	probeTextures(a, probeNames)
	scanCubemaps(a)
	if *cubes != "" {
		os.MkdirAll(*cubes, 0o755)
		for id := range a.DataDir.Files {
			if id.Type == stingray.Sum("texture") && isCube(a, id) {
				if err := cubePNG(a, id.Name, *cubes); err != nil {
					fmt.Println("  cube png:", err)
				}
			}
		}
	}
	if *all {
		fmt.Println("== every shading_environment:")
		for id := range a.DataDir.Files {
			if id.Type == seType {
				fmt.Println(" ", a.LookupHash(id.Name))
				dump(id.Name)
			}
		}
	}
}

func dumpEntity(a *app.App, h stingray.Hash) {
	b, err := a.DataDir.Read(stingray.FileID{Name: h, Type: stingray.Sum("entity")}, stingray.DataMain)
	if err != nil {
		fmt.Println("   entity read:", err)
		return
	}
	ent, err := entity.LoadEntity(bytes.NewReader(b), a.EntityVarMapping)
	if err != nil {
		fmt.Println("   entity parse:", err)
		return
	}
	for _, info := range ent.Infos {
		for ci, c := range info.Components {
			if c.ComponentHeader == nil || c.ComponentData == nil {
				continue
			}
			var cats []string
			for _, n := range c.CategoryNames {
				cats = append(cats, a.LookupThinHash(n))
			}
			fmt.Printf("   component %d %v\n", ci, cats)
			for i, s := range c.Settings {
				d := s.Data
				if u, ok := d.(uint32); ok && s.Type == entity.SettingType_U32 {
					d = fmt.Sprintf("%d (0x%08x %s)", u, u, a.LookupThinHash(stingray.ThinHash{Value: u}))
				}
				fmt.Printf("     %-44s -> %-40s[%d] %v\n", a.LookupThinHash(c.SettingNames[i]), a.LookupThinHash(s.ShaderName), s.ShaderIndex, d)
			}
		}
	}
}
