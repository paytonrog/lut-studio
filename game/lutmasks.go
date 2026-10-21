package game

import (
	"bytes"
	"strings"

	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit"
	"github.com/xypwn/filediver/stingray/unit/material"
)

// NettingBase: the armor shader's netting variant (game build 25988413: the Mimetic armors' scrim), which cuts holes
// where layer 1 of its ID mask has alpha above 0.5 and takes no zone from that channel (render.js NETTING_BASE).
// (The pixel shader samples the mask as .wxyz: its first component, the hole test, is the texel's alpha.)
var NettingBase = stingray.Hash{Value: 0x8e7efcdf45ac19cf}

// HoleMask: ID mask m is a netting material's (layer 1's alpha: holes), for a mask MasksOfLUT has listed.
func (g *Game) HoleMask(m uint64) bool {
	g.maskMu.Lock()
	defer g.maskMu.Unlock()
	return g.holes[m]
}

// MasksOfLUT: the ID masks (id_masks_array) of the parts that wear material LUT lut (0x hash): every material with a
// mask on the units of the kit pieces using the LUT (the preview draws a piece's whole unit with the piece's LUT).
// Cached per LUT.
func (g *Game) MasksOfLUT(idx *Index, lut string) []uint64 {
	g.maskMu.Lock()
	defer g.maskMu.Unlock()
	if m, ok := g.lutMasks[lut]; ok {
		return m
	}
	if g.lutUnits == nil {
		g.lutUnits = map[string][]uint64{}
		seen := map[[2]string]bool{}
		for _, k := range idx.Kits {
			for _, p := range k.Pieces {
				if p.MaterialLUT == "" || seen[[2]string{p.MaterialLUT, p.Unit}] {
					continue
				}
				seen[[2]string{p.MaterialLUT, p.Unit}] = true
				if u, ok := parseHex(p.Unit); ok && u != 0 {
					g.lutUnits[p.MaterialLUT] = append(g.lutUnits[p.MaterialLUT], u)
				}
			}
		}
		g.lutMasks = map[string][]uint64{}
		g.holes = map[uint64]bool{}
	}
	maskSlot := stingray.Sum("id_masks_array").Thin()
	var out []uint64
	have := map[uint64]bool{}
	for _, u := range g.lutUnits[lut] {
		b, err := g.data.Read(stingray.NewFileID(stingray.Hash{Value: u}, stingray.Sum("unit")), stingray.DataMain)
		if err != nil {
			continue
		}
		info, err := unit.LoadInfo(bytes.NewReader(b))
		if err != nil {
			continue
		}
		for _, mh := range info.Materials {
			mb, err := g.data.Read(stingray.NewFileID(mh, stingray.Sum("material")), stingray.DataMain)
			if err != nil {
				continue
			}
			m, err := material.LoadMain(bytes.NewReader(mb))
			if err != nil {
				continue
			}
			if h := m.Textures[maskSlot].Value; h != 0 && !have[h] {
				have[h] = true
				out = append(out, h)
				if m.BaseMaterial == NettingBase {
					g.holes[h] = true
				}
			}
		}
	}
	g.lutMasks[lut] = out
	return out
}

func parseHex(s string) (uint64, bool) {
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	if s == "" || len(s) > 16 {
		return 0, false
	}
	var v uint64
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
			v = v<<4 | uint64(c-'0')
		case c >= 'a' && c <= 'f':
			v = v<<4 | uint64(c-'a'+10)
		default:
			return 0, false
		}
	}
	return v, true
}
