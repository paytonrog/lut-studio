// unitslots: dev tool (not shipped). Prints a unit's material slots (name or thin hash -> material) and its
// attach nodes, for mapping vehicle skin overrides to units. Reads the install only.
//
//	go run ./tools/unitslots content/fac_helldivers/vehicles/combat_walker_turret/combat_walker_turret ...
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit"

	"lutstudio/game"
)

func main() {
	dir, err := game.Detect()
	if err != nil {
		panic(err)
	}
	data, err := stingray.OpenDataDir(context.Background(), filepath.Join(dir, "data"), nil)
	if err != nil {
		panic(err)
	}
	thin := map[uint32]string{}
	for _, s := range hashes.ParseHashes(hashes.ThinHashes) {
		thin[stingray.Sum(s).Thin().Value] = s
	}
	for _, name := range os.Args[1:] {
		b, err := data.Read(stingray.FileID{Name: stingray.Sum(name), Type: stingray.Sum("unit")}, stingray.DataMain)
		if err != nil {
			fmt.Println(name, err)
			continue
		}
		info, err := unit.LoadInfo(bytes.NewReader(b))
		if err != nil {
			fmt.Println(name, err)
			continue
		}
		fmt.Println(name)
		for slot, mat := range info.Materials {
			n := thin[slot.Value]
			if n == "" {
				n = fmt.Sprintf("0x%08x", slot.Value)
			}
			fmt.Printf("  %-36s 0x%016x\n", n, mat.Value)
		}
	}
}
