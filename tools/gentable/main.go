// gentable: maintainer tool (not shipped). Writes LUT Studio's item table (game/table.go) from the install: decrypts
// the game's data-library tables (data/game/generated_*.dl_bin, libsodium sealed boxes) with the key pair, builds the
// table, and records it in data/latest.json. Run it after each game update, check, commit, push: apps pick it up.
//
//	go run ./tools/gentable [-key <file>] [-o data/table.json.gz]
//
// The key file (64 bytes: public key, secret key) is the maintainer's, outside this repo: never commit it. Default:
// $LUTSTUDIO_DLBIN_KEY. -embedded builds from filediver's
// embedded tables instead (no key; for comparison).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	stingray_strings "github.com/xypwn/filediver/stingray/strings"

	"lutstudio/game"
)

func main() {
	keyFile := flag.String("key", "", "key file (default $LUTSTUDIO_DLBIN_KEY)")
	out := flag.String("o", "data/table.json.gz", "table file")
	embedded := flag.Bool("embedded", false, "use filediver's embedded tables (no decryption)")
	pass := flag.String("pass", "", "(internal) markers: write the table with name markers to -tmp")
	tmp := flag.String("tmp", "", "(internal)")
	flag.Parse()

	dir, err := game.Detect()
	check(err)
	if !*embedded {
		check(game.LoadDecryptedTables(dir, *keyFile))
	}
	g, err := game.Open(dir)
	check(err)
	english := stingray_strings.LoadLanguageMap(g.DataDir(), stingray_strings.LanguageFriendlyNameToHash["English (US)"])

	if *pass == "markers" { // (a process of its own: some data-library parsers cache their first result's names)
		t, err := g.BuildTable(game.MarkerMap(english))
		check(err)
		b, _ := json.Marshal(t)
		check(os.WriteFile(*tmp, b, 0o644))
		return
	}

	real, err := g.BuildTable(english)
	check(err)
	tf, err := os.CreateTemp("", "gentable-*.json")
	check(err)
	tf.Close()
	defer os.Remove(tf.Name())
	args := append([]string{"-pass", "markers", "-tmp", tf.Name()}, passThrough(*keyFile, *embedded)...)
	cmd := exec.Command(os.Args[0], args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	check(cmd.Run())
	b, err := os.ReadFile(tf.Name())
	check(err)
	var tmpl game.Table
	check(json.Unmarshal(b, &tmpl))
	literal, err := game.MergeNames(real, &tmpl, english)
	check(err)
	real.Generated = time.Now().UTC().Format(time.RFC3339)
	if real.GameBuild == "" {
		check(fmt.Errorf("the install's Steam build id is unknown (no appmanifest_553850.acf next to steamapps/common)"))
	}
	check(game.WriteTable(*out, real))

	// data/latest.json: what apps compare against (the table, and the newest app version, kept as it is)
	raw, err := os.ReadFile(*out)
	check(err)
	sum := sha256.Sum256(raw)
	latestPath := filepath.Join(filepath.Dir(*out), "latest.json")
	latest := map[string]any{}
	if b, err := os.ReadFile(latestPath); err == nil {
		json.Unmarshal(b, &latest)
	}
	latest["table"] = map[string]any{"format": real.Format, "game_build": real.GameBuild, "generated": real.Generated,
		"file": filepath.ToSlash(filepath.Base(*out)), "sha256": hex.EncodeToString(sum[:]), "bytes": len(raw)}
	lb, _ := json.MarshalIndent(latest, "", "  ")
	check(os.WriteFile(latestPath, append(lb, '\n'), 0o644))

	fmt.Printf("%s: game build %s, %d kits, %d weapons, %d items, %.0f KB; %d names kept literal (not from the string tables): %s\n",
		*out, real.GameBuild, len(real.Kits), len(real.Weapons), len(real.Items), float64(len(raw))/1024, len(literal), sample(literal))
}

func passThrough(key string, embedded bool) []string {
	var a []string
	if key != "" {
		a = append(a, "-key", key)
	}
	if embedded {
		a = append(a, "-embedded")
	}
	return a
}

func sample(s []string) string {
	seen := map[string]bool{}
	var u []string
	for _, x := range s {
		if !seen[x] && len(u) < 6 {
			seen[x] = true
			u = append(u, x)
		}
	}
	return strings.Join(u, "; ")
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "gentable:", err)
		os.Exit(1)
	}
}
