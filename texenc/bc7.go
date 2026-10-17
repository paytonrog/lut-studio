package texenc

import (
	"image"
)

// EncodeBC7 encodes an image as BC7, every block in mode 6: one subset, RGBA endpoints of 7 bits plus a p-bit
// each, 4-bit indices. Endpoints: the block's extremes along its main RGBA axis (as in BC3's color block), each
// with the p-bit that rounds it best. Plenty for smooth data (cape designs) and fine for artwork.
func EncodeBC7(img *image.NRGBA) []byte {
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
			out = append(out, bc7Mode6(&px)...)
		}
	}
	return out
}

var bc7Weights4 = [16]int{0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64}

func bc7Mode6(px *[16][4]uint8) []byte {
	// the main axis: the bounding box's diagonal, each channel's sign from its covariance with the widest channel
	var mean, lo, hi [4]float64
	for c := 0; c < 4; c++ {
		lo[c], hi[c] = 255, 0
	}
	for _, p := range px {
		for c := 0; c < 4; c++ {
			v := float64(p[c])
			mean[c] += v / 16
			lo[c], hi[c] = min(lo[c], v), max(hi[c], v)
		}
	}
	var axis [4]float64
	ref := 0
	for c := 0; c < 4; c++ {
		axis[c] = hi[c] - lo[c]
		if axis[c] > axis[ref] {
			ref = c
		}
	}
	var cov [4]float64
	for _, p := range px {
		for c := 0; c < 4; c++ {
			cov[c] += (float64(p[c]) - mean[c]) * (float64(p[ref]) - mean[ref])
		}
	}
	for c := 0; c < 4; c++ {
		if cov[c] < 0 {
			axis[c] = -axis[c]
		}
	}
	dmin, dmax := 1e18, -1e18
	var e0, e1 [4]float64
	for _, p := range px {
		d := 0.0
		for c := 0; c < 4; c++ {
			d += (float64(p[c]) - mean[c]) * axis[c]
		}
		if d < dmin {
			dmin = d
			for c := 0; c < 4; c++ {
				e0[c] = float64(p[c])
			}
		}
		if d > dmax {
			dmax = d
			for c := 0; c < 4; c++ {
				e1[c] = float64(p[c])
			}
		}
	}
	q0, p0 := quant7p(e0)
	q1, p1 := quant7p(e1)
	ep := func(q [4]int, p int) (o [4]int) {
		for c := 0; c < 4; c++ {
			o[c] = q[c]<<1 | p
		}
		return
	}
	E0, E1 := ep(q0, p0), ep(q1, p1)
	var pal [16][4]int
	for i, w := range bc7Weights4 {
		for c := 0; c < 4; c++ {
			pal[i][c] = ((64-w)*E0[c] + w*E1[c] + 32) >> 6
		}
	}
	var idx [16]int
	for i, p := range px {
		best := 1 << 30
		for k := range pal {
			d := 0
			for c := 0; c < 4; c++ {
				x := int(p[c]) - pal[k][c]
				d += x * x
			}
			if d < best {
				best, idx[i] = d, k
			}
		}
	}
	// the anchor (pixel 0) index has an implicit 0 top bit: swap the endpoints when it would need it
	if idx[0] >= 8 {
		q0, q1, p0, p1 = q1, q0, p1, p0
		for i := range idx {
			idx[i] = 15 - idx[i]
		}
	}
	var w bitWriter
	w.put(1<<6, 7) // mode 6
	for c := 0; c < 4; c++ {
		w.put(q0[c], 7)
		w.put(q1[c], 7)
	}
	w.put(p0, 1)
	w.put(p1, 1)
	w.put(idx[0], 3)
	for i := 1; i < 16; i++ {
		w.put(idx[i], 4)
	}
	return w.b[:]
}

// quant7p: an 8-bit RGBA endpoint as 7 bits per channel plus the shared p-bit that rounds it best
func quant7p(e [4]float64) (q [4]int, p int) {
	bestErr := 1e18
	for pb := 0; pb < 2; pb++ {
		var qq [4]int
		err := 0.0
		for c := 0; c < 4; c++ {
			v := int((e[c]-float64(pb))/2 + 0.5)
			v = min(127, max(0, v))
			qq[c] = v
			d := float64(v<<1|pb) - e[c]
			err += d * d
		}
		if err < bestErr {
			bestErr, q, p = err, qq, pb
		}
	}
	return
}

type bitWriter struct {
	b   [16]byte
	pos int
}

func (w *bitWriter) put(v, n int) {
	for i := 0; i < n; i++ {
		if v>>i&1 != 0 {
			w.b[w.pos>>3] |= 1 << (w.pos & 7)
		}
		w.pos++
	}
}
