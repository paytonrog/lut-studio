package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/x448/float16"
	"github.com/xypwn/filediver/app"
	"github.com/xypwn/filediver/dds"
	"github.com/xypwn/filediver/stingray"
	"github.com/xypwn/filediver/stingray/unit/texture"
)

// cubePNG writes mip 0 of a cube texture as a horizontal strip of its 6 faces (+X -X +Y -Y +Z -Z), tonemapped,
// to outDir, for looking at what a probe shows.
func cubePNG(a *app.App, name stingray.Hash, outDir string) error {
	id := stingray.FileID{Name: name, Type: stingray.Sum("texture")}
	var rs []io.Reader
	for typ := range stingray.NumDataType {
		if b, err := a.DataDir.Read(id, typ); err == nil {
			rs = append(rs, bytes.NewReader(b))
		}
	}
	r := io.MultiReader(rs...)
	if _, err := texture.DecodeInfo(r); err != nil {
		return err
	}
	tex, err := dds.Decode(r, false)
	if err != nil {
		return err
	}
	w, h := tex.Images[0].MipMaps[0].Width, tex.Images[0].MipMaps[0].Height
	out := image.NewNRGBA(image.Rect(0, 0, w*len(tex.Images), h))
	var maxV float64
	for fi, im := range tex.Images {
		src := im.MipMaps[0].Image
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				var c [3]float64
				switch src.(type) {
				case *image.NRGBA64: // half floats: from the raw bytes (filediver's 0..1 mapping wraps values above 1)
					o := (y*w + x) * 8
					for k := 0; k < 3; k++ {
						c[k] = float64(float16.Frombits(binary.LittleEndian.Uint16(im.MipMaps[0].Raw[o+2*k:])).Float32())
					}
				default:
					rr, gg, bb, _ := src.At(x, y).RGBA()
					c = [3]float64{float64(rr) / 65535, float64(gg) / 65535, float64(bb) / 65535}
				}
				for k := range c {
					maxV = math.Max(maxV, c[k])
					c[k] = math.Pow(c[k]/(1+c[k])*2, 1/2.2) // Reinhard x2, gamma
				}
				out.Set(fi*w+x, y, color.NRGBA{uint8(math.Min(c[0], 1) * 255), uint8(math.Min(c[1], 1) * 255), uint8(math.Min(c[2], 1) * 255), 255})
			}
		}
	}
	n := strings.NewReplacer("/", "_", ":", "_").Replace(a.LookupHash(name))
	f, err := os.Create(filepath.Join(outDir, n+".png"))
	if err != nil {
		return err
	}
	defer f.Close()
	fmt.Printf("  %s: %d faces %dx%d, %T, max %.3f\n", n, len(tex.Images), w, h, tex.Images[0].MipMaps[0].Image, maxV)
	return png.Encode(f, out)
}
