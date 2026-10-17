package texenc

import (
	"encoding/binary"
	"image"
)

// EncodeBC3 encodes an image as BC3 (DXT5): 4 x 4 blocks, row by row; each block 8 bytes of alpha (two endpoints,
// 3-bit indices) and 8 bytes of color (two RGB565 endpoints, 2-bit indices). Endpoints: the block's extremes along
// its main color axis (the bounding-box diagonal, refined once by least squares), alpha: its min and max.
func EncodeBC3(img *image.NRGBA) []byte {
	b := img.Bounds()
	bw, bh := max(1, (b.Dx()+3)/4), max(1, (b.Dy()+3)/4)
	out := make([]byte, 0, bw*bh*16)
	var px [16][4]uint8
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			for i := 0; i < 16; i++ {
				x, y := min(bx*4+i%4, b.Dx()-1), min(by*4+i/4, b.Dy()-1)
				o := img.PixOffset(b.Min.X+x, b.Min.Y+y)
				copy(px[i][:], img.Pix[o:o+4])
			}
			out = append(out, alphaBlock(&px)...)
			out = append(out, colorBlock(&px)...)
		}
	}
	return out
}

// EncodeBC4 encodes an image's R channel as BC4: per 4 x 4 block BC3's 8-byte alpha block, of R.
func EncodeBC4(img *image.NRGBA) []byte {
	b := img.Bounds()
	bw, bh := max(1, (b.Dx()+3)/4), max(1, (b.Dy()+3)/4)
	out := make([]byte, 0, bw*bh*8)
	var px [16][4]uint8
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			for i := 0; i < 16; i++ {
				x, y := min(bx*4+i%4, b.Dx()-1), min(by*4+i/4, b.Dy()-1)
				px[i][3] = img.Pix[img.PixOffset(b.Min.X+x, b.Min.Y+y)]
			}
			out = append(out, alphaBlock(&px)...)
		}
	}
	return out
}

func alphaBlock(px *[16][4]uint8) []byte {
	lo, hi := uint8(255), uint8(0)
	for _, p := range px {
		lo, hi = min(lo, p[3]), max(hi, p[3])
	}
	out := make([]byte, 8)
	if lo == hi {
		out[0], out[1] = hi, lo // a0 > a1 is false when equal: 6-value mode, every index 0 reads a0
		return out
	}
	out[0], out[1] = hi, lo // a0 > a1: 8 interpolated values
	var pal [8]int
	pal[0], pal[1] = int(hi), int(lo)
	for i := 1; i < 7; i++ {
		pal[i+1] = ((7-i)*int(hi) + i*int(lo)) / 7
	}
	var bits uint64
	for i, p := range px {
		best, bi := 1<<30, 0
		for k, v := range pal {
			if d := abs(int(p[3]) - v); d < best {
				best, bi = d, k
			}
		}
		bits |= uint64(bi) << (3 * i)
	}
	for i := 0; i < 6; i++ {
		out[2+i] = byte(bits >> (8 * i))
	}
	return out
}

func colorBlock(px *[16][4]uint8) []byte {
	// the main axis: from the darkest to the brightest corner of the block's bounding box, then the extremes of the
	// pixels' projections on it
	var mn, mx [3]float64
	for c := 0; c < 3; c++ {
		mn[c], mx[c] = 255, 0
	}
	for _, p := range px {
		for c := 0; c < 3; c++ {
			mn[c], mx[c] = min(mn[c], float64(p[c])), max(mx[c], float64(p[c]))
		}
	}
	axis := [3]float64{mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]}
	// a negative correlation flips the axis' sign per channel (the box diagonal would be wrong for e.g. red vs green)
	var mean [3]float64
	for _, p := range px {
		for c := 0; c < 3; c++ {
			mean[c] += float64(p[c]) / 16
		}
	}
	var cov [3]float64 // covariance with the brightest-range channel
	ref := 0
	for c := 1; c < 3; c++ {
		if axis[c] > axis[ref] {
			ref = c
		}
	}
	for _, p := range px {
		for c := 0; c < 3; c++ {
			cov[c] += (float64(p[c]) - mean[c]) * (float64(p[ref]) - mean[ref])
		}
	}
	for c := 0; c < 3; c++ {
		if cov[c] < 0 {
			axis[c] = -axis[c]
		}
	}
	lo, hi := 1e18, -1e18
	var plo, phi [3]float64
	for _, p := range px {
		d := 0.0
		for c := 0; c < 3; c++ {
			d += (float64(p[c]) - mean[c]) * axis[c]
		}
		if d < lo {
			lo, plo = d, [3]float64{float64(p[0]), float64(p[1]), float64(p[2])}
		}
		if d > hi {
			hi, phi = d, [3]float64{float64(p[0]), float64(p[1]), float64(p[2])}
		}
	}
	c0, c1 := to565(phi), to565(plo)
	if c0 < c1 {
		c0, c1 = c1, c0
	}
	out := make([]byte, 8)
	binary.LittleEndian.PutUint16(out[0:], c0)
	binary.LittleEndian.PutUint16(out[2:], c1)
	if c0 == c1 {
		return out // one color: every index 0
	}
	e0, e1 := from565(c0), from565(c1)
	pal := [4][3]float64{e0, e1}
	for c := 0; c < 3; c++ {
		pal[2][c] = (2*e0[c] + e1[c]) / 3
		pal[3][c] = (e0[c] + 2*e1[c]) / 3
	}
	var bits uint32
	for i, p := range px {
		best, bi := 1e18, 0
		for k, q := range pal {
			d := 0.0
			for c := 0; c < 3; c++ {
				x := float64(p[c]) - q[c]
				d += x * x
			}
			if d < best {
				best, bi = d, k
			}
		}
		bits |= uint32(bi) << (2 * i)
	}
	binary.LittleEndian.PutUint32(out[4:], bits)
	return out
}

func to565(c [3]float64) uint16 {
	r := uint16(min(31, max(0, int(c[0]*31/255+0.5))))
	g := uint16(min(63, max(0, int(c[1]*63/255+0.5))))
	b := uint16(min(31, max(0, int(c[2]*31/255+0.5))))
	return r<<11 | g<<5 | b
}

func from565(v uint16) [3]float64 {
	r, g, b := float64(v>>11&31), float64(v>>5&63), float64(v&31)
	return [3]float64{r * 255 / 31, g * 255 / 63, b * 255 / 31}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
