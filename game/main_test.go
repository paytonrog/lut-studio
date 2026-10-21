package game

import (
	"fmt"
	"os"
	"testing"
)

// decrypted: the data-library tables are the install's own (LUTSTUDIO_DLBIN_KEY set), not filediver's embedded copies.
var decrypted bool

// With the install and the maintainer's key, every test of the package reads the install's data-library tables:
// loaded before any test, as some parsers cache their first result.
func TestMain(m *testing.M) {
	if dir := os.Getenv("LUTSTUDIO_GAME"); dir != "" && os.Getenv("LUTSTUDIO_DLBIN_KEY") != "" {
		if err := LoadDecryptedTables(dir, ""); err != nil {
			fmt.Fprintln(os.Stderr, "data-library tables:", err)
			os.Exit(1)
		}
		decrypted = true
	}
	os.Exit(m.Run())
}
