// matdump: dev tool (not shipped). Writes the main and GPU data of materials (by hash) to a folder, for shader
// analysis tools. Reads the install only.
//
//	go run ./tools/matdump <outdir> 0x... [0x...]
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/xypwn/filediver/stingray"

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
	out := os.Args[1]
	os.MkdirAll(out, 0o755)
	for _, a := range os.Args[2:] {
		h, err := stingray.ParseHash(a)
		if err != nil {
			panic(err)
		}
		id := stingray.FileID{Name: h, Type: stingray.Sum("material")}
		for typ, ext := range map[stingray.DataType]string{stingray.DataMain: "main", stingray.DataGPU: "gpu"} {
			b, err := data.Read(id, typ)
			if err != nil {
				fmt.Println(a, ext, err)
				continue
			}
			os.WriteFile(filepath.Join(out, fmt.Sprintf("%016x.%s", h.Value, ext)), b, 0o644)
			fmt.Println(a, ext, len(b))
		}
	}
}
