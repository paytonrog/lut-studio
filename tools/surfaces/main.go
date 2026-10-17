// surfaces: maintainer tool (not shipped). Writes LUT Studio's table of material LUT surfaces (game/surfaces.json,
// embedded: how big the parts wearing each LUT are, for weighing an item's colors; game/surfaces.go) from the install:
// the themed kits' units (server.ThemeGroups) exported with filediver (cached), their armor /
// cape primitives measured. Run it after a game update that adds items (LUTs it lacks are measured by the app when
// needed, slower), check, commit.
//
//	go run ./tools/surfaces [-o game/surfaces.json] [-cache <dir>]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"

	"lutstudio/appcfg"
	"lutstudio/game"
	"lutstudio/server"
)

func main() {
	out := flag.String("o", "game/surfaces.json", "table file")
	cache := flag.String("cache", "", "unit export cache (default: LUT Studio's)")
	flag.Parse()

	dir, err := game.Detect()
	check(err)
	g, err := game.Open(dir)
	check(err)
	var idx *game.Index
	if g.Table() != nil {
		idx = g.IndexFromTable()
	} else {
		idx, err = g.BuildIndex("")
		check(err)
	}
	if *cache == "" {
		*cache = filepath.Join(appcfg.CacheDir(), "cache")
		if k := g.CacheKey(); k != "" {
			*cache = filepath.Join(*cache, k)
		}
	}
	// the kinds themes cover (the index's vehicles, enemies and props are not themed: measured by the app if asked)
	kinds := map[string]bool{}
	for t := range server.ThemeGroups {
		kinds[t] = true
	}
	var kits []game.Kit
	for _, k := range idx.Kits {
		if kinds[k.Type] {
			kits = append(kits, k)
		}
	}
	t0 := time.Now()
	s := game.NewAssets(g, *cache).LUTSurfaces(&game.Index{Kits: kits}, nil)
	for h, v := range s {
		v.Area = math.Round(v.Area*1e5) / 1e5 // (m², to 0.1 cm²)
		s[h] = v
	}
	b, err := json.MarshalIndent(map[string]any{"game_build": g.CacheKey(), "surfaces": s}, "", " ")
	check(err)
	check(os.WriteFile(*out, append(b, '\n'), 0o644))
	fmt.Printf("%s: %d LUTs, %.0f KB, %s\n", *out, len(s), float64(len(b))/1024, time.Since(t0).Round(time.Second))
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "surfaces:", err)
		os.Exit(1)
	}
}
