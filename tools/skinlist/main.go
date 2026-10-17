// skinlist: dev tool (not shipped). Every unit customization setting (vehicle / hellpod / shuttle skins) with its
// category and what each skin overrides. Reads the install only.
package main

import (
	"context"
	"fmt"

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
	ucs, err := datalib.ParseUnitCustomizationSettings(get, a.LanguageMap)
	if err != nil {
		panic(err)
	}
	for _, c := range ucs {
		fmt.Printf("== %v %q skin-name %q category %v parent %v (%d skins)\n", c.CollectionType, c.ObjectName, c.SkinName, c.CategoryType, c.ParentCollectionType, len(c.Skins))
		for _, s := range c.Skins {
			cu := s.Customization
			lut := 0
			for _, l := range [][]datalib.UnitCustomizationMaterialOverrides{cu.MaterialsTexturesOverrides, cu.MountedWeaponTextureOverrides, cu.UnknownTextureOverrides, cu.UnknownTextureOverrides2} {
				for _, o := range l {
					if o.MaterialLut.Value != 0 {
						lut++
					}
				}
			}
			fmt.Printf("   %-40s mat %d mounted %d unk %d unk2 %d (LUTs %d) debug %q\n", s.Name, len(cu.MaterialsTexturesOverrides), len(cu.MountedWeaponTextureOverrides), len(cu.UnknownTextureOverrides), len(cu.UnknownTextureOverrides2), lut, s.DebugName)
		}
	}
}
