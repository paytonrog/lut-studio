// idscan: dev tool (not shipped). Searches the install's resources for 32-bit ids (one hex id per line in a file,
// e.g. weapon attachment item ids) and reports resources where several distinct ids sit close together (a list).
// Reads the install only.
//
//	go run ./tools/idscan <ids.txt> [type,type,...]
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/xypwn/filediver/hashes"
	"github.com/xypwn/filediver/stingray"

	"lutstudio/game"
)

func main() {
	ids := map[uint32]bool{}
	f, _ := os.Open(os.Args[1])
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if fs := strings.Fields(sc.Text()); len(fs) > 0 {
			if v, err := strconv.ParseUint(fs[0], 16, 32); err == nil {
				ids[uint32(v)] = true
			}
		}
	}
	types := "entity,lua,config,xaml,package,prefab,state_machine,level,strings,ah_bin,hash_lookup,network_config,render_config,geleta,vector_field,physics,bones,material"
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
	type hit struct {
		res      string
		distinct int
		total    int
	}
	var hits []hit
	for id := range data.Files {
		t, ok := want[id.Type]
		if !ok {
			continue
		}
		for _, dt := range []stingray.DataType{stingray.DataMain, stingray.DataStream, stingray.DataGPU} {
			b, err := data.Read(id, dt)
			if err != nil || len(b) < 4 {
				continue
			}
			// every 4-byte-aligned and unaligned position (some formats pack)
			best, total := 0, 0
			var pos []int
			var vals []uint32
			for o := 0; o+4 <= len(b); o++ {
				v := binary.LittleEndian.Uint32(b[o:])
				if ids[v] {
					pos = append(pos, o)
					vals = append(vals, v)
					total++
				}
			}
			for i := range pos {
				set := map[uint32]bool{}
				for j := i; j < len(pos) && pos[j]-pos[i] < 256; j++ {
					set[vals[j]] = true
				}
				if len(set) > best {
					best = len(set)
				}
			}
			if total > 0 {
				n := names[id.Name.Value]
				if n == "" {
					n = fmt.Sprintf("0x%016x", id.Name.Value)
				}
				hits = append(hits, hit{fmt.Sprintf("%s.%s [%d]", n, t, dt), best, total})
			}
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].distinct > hits[j].distinct })
	for i, h := range hits {
		if i < 40 {
			fmt.Printf("%3d distinct in 256 B, %4d hits  %s\n", h.distinct, h.total, h.res)
		}
	}
	fmt.Println(len(hits), "resources contain at least one id")
}
