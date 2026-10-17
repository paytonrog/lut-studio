// pkgprobe: dev tool (not shipped). For each name: the resource types the install has under it; for a package, the
// units (and entities) it lists. Reads the install only.
//
//	go run ./tools/pkgprobe packages/generated/loadout/combat_walker_lumberer ...
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"

	"github.com/xypwn/filediver/app"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	pkg "github.com/xypwn/filediver/stingray/package"
	stingray_strings "github.com/xypwn/filediver/stingray/strings"

	"lutstudio/game"
)

func main() {
	dir, _ := game.Detect()
	a, err := app.OpenGameDir(context.Background(), dir, hashes.ParseHashes(hashes.Hashes),
		hashes.ParseHashes(hashes.ThinHashes), stingray_strings.LanguageFriendlyNameToHash["English (US)"], nil)
	if err != nil {
		panic(err)
	}
	for _, name := range os.Args[1:] {
		h := stingray.Sum(name)
		for id := range a.DataDir.Files {
			if id.Name != h {
				continue
			}
			fmt.Println(name, "->", a.LookupHash(id.Type))
			if id.Type != stingray.Sum("package") {
				continue
			}
			b, err := a.DataDir.Read(id, stingray.DataMain)
			if err != nil {
				fmt.Println("  ", err)
				continue
			}
			p, err := pkg.LoadPackage(bytes.NewReader(b))
			if err != nil {
				fmt.Println("  ", err)
				continue
			}
			for _, it := range p.Items {
				t := a.LookupHash(it.Type)
				if t == "unit" || t == "entity" {
					fmt.Println("   ", t, a.LookupHash(it.Name))
				}
			}
		}
	}
}
