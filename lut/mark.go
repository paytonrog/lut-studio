package lut

import "github.com/x448/float16"

// The build mark: mods LUT Studio builds carry "LSTD" and a format version in column 20's r, g, b of every zone of
// every material LUT, as half floats whose bits spell it ('L''S', 'T''D', '0''1'). No game shader reads those
// three channels (all 157 that bind a material LUT; they read it texel by texel, so mips don't matter either): the
// mark changes nothing in the game. Projects never hold it: the build adds it, the import takes it out.

const markCol = 20

var markBits = [3]uint16{0x4c53, 0x5444, 0x3031}

// MarkVersion is the version the mark spells (its third half: '0”1').
const MarkVersion = 1

func markValue(i int) float32 { return float16.Frombits(markBits[i]).Float32() }

// Marked returns a copy of material LUT t with the build mark (other kinds: t itself).
func Marked(t *Texture) *Texture {
	if t.Width != MaterialWidth {
		return t
	}
	out := &Texture{Width: t.Width, Height: t.Height, Px: append([]float32(nil), t.Px...)}
	for z := 0; z < t.Height; z++ {
		for ch := 0; ch < 3; ch++ {
			out.Px[(z*t.Width+markCol)*4+ch] = markValue(ch)
		}
	}
	return out
}

// HasMark reports whether any zone of t carries the build mark.
func HasMark(t *Texture) bool {
	if t.Width != MaterialWidth {
		return false
	}
	for z := 0; z < t.Height; z++ {
		if zoneMarked(t, z) {
			return true
		}
	}
	return false
}

func zoneMarked(t *Texture, z int) bool {
	for ch := 0; ch < 3; ch++ {
		if float16.Fromfloat32(t.Px[(z*t.Width+markCol)*4+ch]).Bits() != markBits[ch] {
			return false
		}
	}
	return true
}

// MarkChannel reports whether value i (row-major, 4 per texel) of a LUT width wide is one of the mark's channels.
func MarkChannel(width, i int) bool {
	return width == MaterialWidth && (i/4)%width == markCol && i%4 < 3
}

// Unmark puts the game's values (from vanilla, by zone; 0 past its zones or without it) in the mark's channels of
// every zone of t, in place: the build mark comes out, and whatever another tool left there too (projects keep the
// game's values; the editor doesn't offer them). Reports whether t had the mark.
func Unmark(t, vanilla *Texture) bool {
	had := HasMark(t)
	if t.Width != MaterialWidth {
		return false
	}
	for z := 0; z < t.Height; z++ {
		for ch := 0; ch < 3; ch++ {
			v := float32(0)
			if vanilla != nil && vanilla.Width == t.Width && z < vanilla.Height {
				v = vanilla.Px[(z*vanilla.Width+markCol)*4+ch]
			}
			t.Px[(z*t.Width+markCol)*4+ch] = v
		}
	}
	return had
}
