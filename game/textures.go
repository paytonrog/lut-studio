package game

import (
	"bytes"
	"slices"

	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit/material"

	"lutstudio/lut"
)

// EditableTextures: the textures besides LUTs that LUT Studio edits: decal sheets (every material's decal_sheet,
// the capes' piece records) and cape designs (the capes' decal_scalar_fields, materials' cape_scalar_fields). A
// scan of the install's materials (~10,000, a fraction of a second), done once per install.
func (g *Game) EditableTextures(idx *Index) (sheets, designs map[uint64]bool) {
	g.editOnce.Do(func() {
		sheets, designs, masks, patterns := map[uint64]bool{}, map[uint64]bool{}, map[uint64]bool{}, map[uint64]bool{}
		byLUT := map[uint64][]uint64{}
		add := func(l, sheet uint64) {
			if l != 0 && sheet != 0 && !slices.Contains(byLUT[l], sheet) {
				byLUT[l] = append(byLUT[l], sheet)
			}
		}
		maskSlot, patternSlot := stingray.Sum("id_masks_array").Thin(), stingray.Sum("pattern_masks_array").Thin()
		lutSlot := stingray.Sum("material_lut").Thin()
		matType := stingray.Sum("material")
		sheetSlot, designSlot := stingray.Sum("decal_sheet").Thin(), stingray.Sum("cape_scalar_fields").Thin()
		for id := range g.data.Files {
			if id.Type != matType {
				continue
			}
			b, err := g.data.Read(id, stingray.DataMain)
			if err != nil {
				continue
			}
			m, err := material.LoadMain(bytes.NewReader(b))
			if err != nil {
				continue
			}
			if h := m.Textures[sheetSlot].Value; h != 0 {
				sheets[h] = true
				add(m.Textures[lutSlot].Value, h)
			}
			if h := m.Textures[maskSlot].Value; h != 0 {
				masks[h] = true
			}
			if h := m.Textures[patternSlot].Value; h != 0 && h != noPatternMask {
				patterns[h] = true
			}
			if h := m.Textures[designSlot].Value; h != 0 {
				designs[h] = true
			}
		}
		if idx != nil {
			for _, k := range idx.Kits {
				for _, p := range k.Pieces {
					if h, err := lut.ParseHash(p.DecalSheet); err == nil && h != 0 {
						sheets[h] = true
						if l, err := lut.ParseHash(p.MaterialLUT); err == nil {
							add(l, h)
						}
					}
					if h, err := lut.ParseHash(p.DecalScalarFields); err == nil && h != 0 {
						designs[h] = true
					}
				}
			}
		}
		g.editSheets, g.editDesigns, g.editMasks, g.editPatterns = sheets, designs, masks, patterns
		g.sheetsByLUT = byLUT
	})
	return g.editSheets, g.editDesigns
}

// DecalSheetsByLUT: the decal sheets drawn with each material LUT (EditableTextures' scan): the materials binding
// both, and the kits' pieces that bring their own sheet (capes' records, vehicle skins, weapon paint schemes).
func (g *Game) DecalSheetsByLUT(idx *Index) map[uint64][]uint64 {
	g.EditableTextures(idx)
	return g.sheetsByLUT
}

// noPatternMask: the 1 x 1 black pattern_masks_array most materials bind (no pattern can show on them; not editable)
const noPatternMask = 0xf37a4e756300ab32

// EditableMasks: the ID masks and pattern masks of the install's materials (EditableTextures' scan).
func (g *Game) EditableMasks(idx *Index) (masks, patterns map[uint64]bool) {
	g.EditableTextures(idx)
	return g.editMasks, g.editPatterns
}
