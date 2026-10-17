package main

import (
	_ "embed"
	"fmt"

	"lutstudio/game"
	"lutstudio/server"
)

// The item table (game/table.go): the repo's data/table.json.gz, built into the site. After a game update it is
// regenerated (tools/gentable) and the site deployed again; until then the start page says the list is older than
// the game.

//go:embed data/table.json.gz
var bundledTable []byte

// tableFor: the table to read the install g with (the bundled one) and where it came from.
func tableFor(g *game.Game) (*game.Table, string) {
	t, err := game.ReadTable(bundledTable)
	if err != nil {
		panic("bundled item table: " + err.Error()) // (built from the repo: the tests read it)
	}
	return t, "bundled"
}

// staleNotices: a notice when the item table is for another game build than the install's.
func staleNotices(g *game.Game) []server.Notice {
	t := g.Table()
	if t == nil {
		return nil
	}
	if b := g.Build(); b != "" && t.GameBuild != b {
		return []server.Notice{{Kind: "warn", Text: fmt.Sprintf("LUT Studio's item list is for game build %s, your game is "+
			"build %s: items added by the game update are missing until the list is updated (usually within a day of a "+
			"patch).", t.GameBuild, b)}}
	}
	return nil
}
