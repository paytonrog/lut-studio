// typelib: dev tool (not shipped). Prints types of the game's data library type library (fields, offsets, sizes,
// developer comments): by name, or every type whose name or member names / comments match a word.
//
//	go run ./tools/typelib WeaponCustomizationComponentData          # one type
//	go run ./tools/typelib -grep customiz                             # search
package main

import (
	"flag"
	"fmt"
	"sort"
	"strings"

	datalib "github.com/xypwn/filediver/datalibrary"
)

func main() {
	grep := flag.String("grep", "", "list types whose name, member names or comments contain this (case-insensitive)")
	flag.Parse()
	tl, err := datalib.ParseTypeLib(nil)
	if err != nil {
		panic(err)
	}
	show := func(t datalib.DLTypeDesc) {
		fmt.Printf("%s (size %d)%s\n", t.Name, t.Size, comment(t.Comment))
		for _, m := range t.Members {
			typ := m.TypeID.String()
			if tt, ok := tl.Types[m.TypeID]; ok {
				typ = tt.Name
			}
			fmt.Printf("  +%-5d %-44s %-40s size %-5d%s\n", m.Offset, m.Name, typ, m.Size, comment(m.Comment))
		}
	}
	var names []string
	byName := map[string]datalib.DLTypeDesc{}
	for _, t := range tl.Types {
		names = append(names, t.Name)
		byName[t.Name] = t
	}
	sort.Strings(names)
	if *grep != "" {
		g := strings.ToLower(*grep)
		for _, n := range names {
			t := byName[n]
			hit := strings.Contains(strings.ToLower(n), g)
			for _, m := range t.Members {
				hit = hit || strings.Contains(strings.ToLower(m.Name+" "+m.Comment), g)
			}
			if hit {
				show(t)
			}
		}
		return
	}
	for _, a := range flag.Args() {
		if t, ok := byName[a]; ok {
			show(t)
		} else {
			fmt.Println("no type", a)
		}
	}
}

func comment(c string) string {
	if c == "" {
		return ""
	}
	return "  // " + c
}
