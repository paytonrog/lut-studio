// strscan: dev tool (not shipped). Lists resources of given types whose data contains a text (case-insensitive),
// with a little context. Reads the install only.
//
//	go run ./tools/strscan <text> [type,type,...]
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"

	"lutstudio/game"
)

func main() {
	needle := bytes.ToLower([]byte(os.Args[1]))
	types := "lua,xaml,config,entity,strings,state_machine,package"
	if len(os.Args) > 2 {
		types = os.Args[2]
	}
	dir, _ := game.Detect()
	data, err := stingray.OpenDataDir(context.Background(), filepath.Join(dir, "data"), nil)
	if err != nil {
		panic(err)
	}
	names := map[uint64]string{}
	for _, n := range hashes.ParseHashes(hashes.Hashes) {
		names[stingray.Sum(n).Value] = n
	}
	want := map[stingray.Hash]string{}
	for _, t := range strings.Split(types, ",") {
		want[stingray.Sum(t)] = t
	}
	for id := range data.Files {
		t, ok := want[id.Type]
		if !ok {
			continue
		}
		b, err := data.Read(id, stingray.DataMain)
		if err != nil {
			continue
		}
		i := bytes.Index(bytes.ToLower(b), needle)
		if i < 0 {
			continue
		}
		lo, hi := max(0, i-60), min(len(b), i+100)
		ctx := strings.Map(func(r rune) rune {
			if r < 32 || r > 126 {
				return '.'
			}
			return r
		}, string(b[lo:hi]))
		n := names[id.Name.Value]
		if n == "" {
			n = fmt.Sprintf("0x%016x", id.Name.Value)
		}
		fmt.Printf("%s.%s: ...%s...\n", n, t, ctx)
	}
}
