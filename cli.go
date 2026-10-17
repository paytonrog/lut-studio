//go:build !js

package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

// main: the command line (lutstudio <command> …), a developer tool: LUT Studio itself is the website (web_js.go).
func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	gameDir := fs.String("game", "", "Helldivers 2 install folder")
	variant := fs.String("variant", "", "variant folder")
	from := fs.String("from", "", "variant folder to copy")
	out := fs.String("o", "", "output zip")
	// flags may follow positional arguments
	var pos []string
	for len(args) > 0 {
		fs.Parse(args)
		args = fs.Args()
		if len(args) > 0 {
			pos = append(pos, args[0])
			args = args[1:]
		}
	}
	env := &env{out: os.Stdout, gameDir: *gameDir}
	var err error
	switch cmd {
	case "index":
		err = env.cmdIndex()
	case "find":
		err = need(pos, 1, func() error { return env.cmdFind(strings.Join(pos, " ")) })
	case "new":
		err = need(pos, 2, func() error { return env.cmdNew(pos[0], strings.Join(pos[1:], " ")) })
	case "pull":
		err = need(pos, 2, func() error { return env.cmdPull(pos[0], strings.Join(pos[1:], " "), *variant) })
	case "variant":
		err = need(pos, 2, func() error { return env.cmdVariant(pos[0], strings.Join(pos[1:], " "), *from) })
	case "check":
		err = need(pos, 1, func() error { _, e := env.check(pos[0], true); return e })
	case "version":
		fmt.Println("LUT Studio", version)
	case "build":
		err = need(pos, 1, func() error { return env.cmdBuild(pos[0], *out) })
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		err = fmt.Errorf("unknown command %q\n\n%s", cmd, usage)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
