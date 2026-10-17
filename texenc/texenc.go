// Package texenc writes a game texture with new pixels: encoded in the original's format (RGBA8, BC3 or BC7) with a
// box-filtered mip chain, laid out like the original texture resource (its header kept; each of its stream / GPU
// parts holds the same slice of the mip chain as before). Used for decal sheets (BC3, 2048 x 2048, 12 mips) and cape
// designs (mostly RGBA8 at 128-512, some BC3 / BC7): either all mips in the GPU part, or all in the stream part with
// the smallest mips repeated in the GPU part.
package texenc

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"

	"encoding/binary"
)

const (
	headerOffset = 0xC0 // the DDS header inside a texture resource's main data
	dxgiRGBA8    = 28
	dxgiR8       = 61 // one channel (pattern masks): the image's R
	dxgiBC4      = 80 // one channel, block-compressed (BC3's alpha block on R)
	dxgiBC3      = 77
	dxgiBC7      = 98
)

// Info is what a texture resource's main data says about its pixels.
type Info struct {
	Width, Height, Mips, DXGI int
	Layers                    int // a texture array's layers (1 for a plain texture)
}

// ReadInfo reads the DDS header of a texture resource's main data.
func ReadInfo(main []byte) (Info, error) {
	if len(main) < headerOffset+148 || string(main[headerOffset:headerOffset+4]) != "DDS " {
		return Info{}, fmt.Errorf("not a texture resource (no DDS header)")
	}
	d := main[headerOffset:]
	le := binary.LittleEndian
	in := Info{Width: int(le.Uint32(d[16:])), Height: int(le.Uint32(d[12:])), Mips: int(le.Uint32(d[28:]))}
	if in.Mips == 0 {
		in.Mips = 1
	}
	in.Layers = 1
	if string(d[84:88]) == "DX10" {
		in.DXGI = int(le.Uint32(d[128:]))
		if n := int(le.Uint32(d[140:])); n > 1 {
			in.Layers = n
		}
	}
	return in, nil
}

// Supported reports whether textures of a DXGI format can be written.
func Supported(dxgi int) bool {
	return dxgi == dxgiRGBA8 || dxgi == dxgiR8 || dxgi == dxgiBC4 || dxgi == dxgiBC3 || dxgi == dxgiBC7
}

// levelSize: the bytes of one w x h mip level in a format
func levelSize(dxgi, w, h int) int {
	switch dxgi {
	case dxgiRGBA8:
		return w * h * 4
	case dxgiR8:
		return w * h
	case dxgiBC4:
		return max(1, (w+3)/4) * max(1, (h+3)/4) * 8
	}
	return max(1, (w+3)/4) * max(1, (h+3)/4) * 16
}

func encodeLevel(dxgi int, img *image.NRGBA) []byte {
	switch dxgi {
	case dxgiRGBA8:
		b := img.Bounds()
		out := make([]byte, 0, b.Dx()*b.Dy()*4)
		for y := b.Min.Y; y < b.Max.Y; y++ {
			o := img.PixOffset(b.Min.X, y)
			out = append(out, img.Pix[o:o+b.Dx()*4]...)
		}
		return out
	case dxgiR8:
		b := img.Bounds()
		out := make([]byte, 0, b.Dx()*b.Dy())
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				out = append(out, img.Pix[img.PixOffset(x, y)])
			}
		}
		return out
	case dxgiBC4:
		return EncodeBC4(img)
	case dxgiBC7:
		return EncodeBC7(img)
	}
	return EncodeBC3(img)
}

// MipChain is the data of img and its mips in a format (n levels, each half the size). straight: the mips average
// every channel alike (data textures: cape designs); else color is weighted by alpha (artwork with cut-outs).
func MipChain(img *image.NRGBA, n, dxgi int, straight bool) []byte {
	var out []byte
	level := img
	for i := 0; i < n; i++ {
		out = append(out, encodeLevel(dxgi, level)...)
		if i < n-1 {
			level = halve(level, straight)
		}
	}
	return out
}

// Replace returns a texture resource with img's pixels in place of the original's (main, stream, gpu): the same
// header and the same layout. img must have the original's size (a texture array: its layers stacked top to
// bottom, each with its own mip chain, layer after layer); the original must be RGBA8, BC3 or BC7 and its stream /
// GPU parts each a slice (prefix or suffix) of its mip chain. straight: see MipChain.
func Replace(main, stream, gpu []byte, img *image.NRGBA, straight bool) (newMain, newStream, newGPU []byte, err error) {
	in, err := ReadInfo(main)
	if err != nil {
		return nil, nil, nil, err
	}
	if !Supported(in.DXGI) {
		return nil, nil, nil, fmt.Errorf("texture format %d: only RGBA8, BC3 and BC7 textures can be replaced", in.DXGI)
	}
	if b := img.Bounds(); b.Dx() != in.Width || b.Dy() != in.Height*in.Layers {
		return nil, nil, nil, fmt.Errorf("image is %dx%d, the texture %dx%d (%d layer(s))", b.Dx(), b.Dy(), in.Width, in.Height, in.Layers)
	}
	chainLen := 0
	for i, w, h := 0, in.Width, in.Height; i < in.Mips; i++ {
		chainLen += levelSize(in.DXGI, w, h)
		w, h = max(1, w/2), max(1, h/2)
	}
	chainLen *= in.Layers
	var chain []byte
	for l := 0; l < in.Layers; l++ {
		layer := img.SubImage(image.Rect(0, l*in.Height, in.Width, (l+1)*in.Height)).(*image.NRGBA)
		chain = append(chain, MipChain(ToNRGBA(layer), in.Mips, in.DXGI, straight)...)
	}
	if len(chain) != chainLen {
		return nil, nil, nil, fmt.Errorf("mip chain %d bytes, expected %d", len(chain), chainLen)
	}
	// where a part sits in the original chain: the whole chain, its start or its end
	slice := func(part []byte, orig []byte) ([]byte, error) {
		switch {
		case len(part) == 0:
			return nil, nil
		case len(part) == chainLen:
			return chain, nil
		case len(orig) == chainLen && bytes.HasSuffix(orig, part):
			return chain[chainLen-len(part):], nil
		case len(orig) == chainLen && bytes.HasPrefix(orig, part):
			return chain[:len(part)], nil
		}
		return nil, fmt.Errorf("texture layout not understood (part of %d bytes, mip chain %d)", len(part), chainLen)
	}
	origChain := gpu
	if len(stream) == chainLen {
		origChain = stream
	}
	if newStream, err = slice(stream, origChain); err != nil {
		return nil, nil, nil, err
	}
	if newGPU, err = slice(gpu, origChain); err != nil {
		return nil, nil, nil, err
	}
	return append([]byte(nil), main...), newStream, newGPU, nil
}

// halve box-filters an image to half its size (at least 1 x 1): color weighted by alpha, or (straight) every
// channel averaged alike
func halve(img *image.NRGBA, straight bool) *image.NRGBA {
	b := img.Bounds()
	w, h := max(1, b.Dx()/2), max(1, b.Dy()/2)
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, bl, a, n, sr, sg, sb int
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					sx, sy := min(2*x+dx, b.Dx()-1), min(2*y+dy, b.Dy()-1)
					o := img.PixOffset(b.Min.X+sx, b.Min.Y+sy)
					p := img.Pix[o : o+4]
					aa := int(p[3])
					r, g, bl, a, n = r+int(p[0])*aa, g+int(p[1])*aa, bl+int(p[2])*aa, a+aa, n+1
					sr, sg, sb = sr+int(p[0]), sg+int(p[1]), sb+int(p[2])
				}
			}
			o := out.PixOffset(x, y)
			switch {
			case straight:
				out.Pix[o], out.Pix[o+1], out.Pix[o+2] = uint8((sr+n/2)/n), uint8((sg+n/2)/n), uint8((sb+n/2)/n)
			case a > 0:
				out.Pix[o], out.Pix[o+1], out.Pix[o+2] = uint8((r+a/2)/a), uint8((g+a/2)/a), uint8((bl+a/2)/a)
			}
			out.Pix[o+3] = uint8((a + n/2) / n)
		}
	}
	return out
}

// Resize scales an image to w x h (bilinear, each channel alike).
func Resize(img *image.NRGBA, w, h int) *image.NRGBA {
	b := img.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	sw, sh := b.Dx(), b.Dy()
	for y := 0; y < h; y++ {
		fy := max(0, min(float64(sh-1), (float64(y)+0.5)*float64(sh)/float64(h)-0.5))
		y0 := int(fy)
		y1, ty := min(y0+1, sh-1), fy-float64(y0)
		for x := 0; x < w; x++ {
			fx := max(0, min(float64(sw-1), (float64(x)+0.5)*float64(sw)/float64(w)-0.5))
			x0 := int(fx)
			x1, tx := min(x0+1, sw-1), fx-float64(x0)
			for c := 0; c < 4; c++ {
				at := func(xx, yy int) float64 { return float64(img.Pix[img.PixOffset(b.Min.X+xx, b.Min.Y+yy)+c]) }
				v := (at(x0, y0)*(1-tx)+at(x1, y0)*tx)*(1-ty) + (at(x0, y1)*(1-tx)+at(x1, y1)*tx)*ty
				out.Pix[out.PixOffset(x, y)+c] = uint8(v + 0.5)
			}
		}
	}
	return out
}

// ToNRGBA converts any image to NRGBA at the origin.
func ToNRGBA(src image.Image) *image.NRGBA {
	if n, ok := src.(*image.NRGBA); ok && n.Bounds().Min == (image.Point{}) {
		return n
	}
	b := src.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), src, b.Min, draw.Src)
	return out
}
