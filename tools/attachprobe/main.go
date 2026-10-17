// attachprobe: dev tool (not shipped). How weapon customization items (attachments) are organized: the settings
// files, their items per slot, and a weapon's component fields. Reads the install only.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/xypwn/filediver/app"
	datalib "github.com/xypwn/filediver/datalibrary"
	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"
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
	get := func(id stingray.FileID, typ stingray.DataType) ([]byte, bool, error) {
		b, err := a.DataDir.Read(id, typ)
		if err == stingray.ErrFileDataTypeNotExist {
			return nil, false, nil
		}
		return b, err == nil, err
	}
	settings, err := datalib.ParseWeaponCustomizationSettings(get, a.LanguageMap)
	if err != nil {
		panic(err)
	}
	fmt.Println(len(settings), "settings")
	for i, s := range settings {
		if len(s.Items) == 0 {
			continue
		}
		fmt.Printf("settings %d: %d items, first slots %v\n", i, len(s.Items), s.Items[0].Slots)
		for j, it := range s.Items {
			if j < 4 {
				fmt.Printf("   %-32q debug %-40q slots %v add %s\n", it.NameCased, it.DebugName, it.Slots, a.LookupHash(it.AddPath))
			}
		}
	}
	// every attachment item id (optics, magazine, muzzle, underbarrel) with its slot and debug name, for searching
	f, _ := os.Create(os.Args[1])
	for _, s := range settings {
		for _, it := range s.Items {
			if len(it.Slots) > 0 {
				fmt.Fprintf(f, "%08x %v %s\n", it.ID.Value, it.Slots[0], it.DebugName)
			}
		}
	}
	f.Close()
	comps, _ := datalib.ParseWeaponCustomizationComponents(get, a.LanguageMap)
	lib := stingray.Sum("content/fac_helldivers/equipment/primary_weapons/assault_rifle/assault_rifle")
	w := comps[lib]
	fmt.Printf("Liberator slots %v\n defaults:", w.CustomizationSlots)
	for _, d := range w.DefaultCustomizations {
		fmt.Printf(" %v=%08x", d.Slot, d.Customization.Value)
	}
	fmt.Println()
}
