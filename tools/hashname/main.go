// hashname: dev tool. Prints the 64-bit and thin hashes of resource paths / names.
//
//	go run ./tools/hashname content/fac_helldivers/vehicles/frv/frv ...
package main

import (
	"fmt"
	"os"

	"github.com/xypwn/filediver/stingray"
)

func main() {
	for _, a := range os.Args[1:] {
		h := stingray.Sum(a)
		fmt.Printf("0x%016x 0x%08x %s\n", h.Value, h.Thin().Value, a)
	}
}
