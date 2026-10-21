package game

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	datalib "github.com/xypwn/filediver/datalibrary"
	"golang.org/x/crypto/nacl/box"
)

// LoadDecryptedTables decrypts the data-library tables of the install in dir (data/game/generated_*.dl_bin,
// libsodium sealed boxes) with the key pair in keyFile (64 bytes: public key, secret key; empty:
// $LUTSTUDIO_DLBIN_KEY) and hands them to filediver's datalibrary in place of its embedded copies, which are those of
// whichever game build filediver last took them from. Call it before anything reads the tables (some parsers cache
// their first result). Maintainer only: the key stays outside this repo, the app never needs it (it reads the item
// table).
func LoadDecryptedTables(dir, keyFile string) error {
	if keyFile == "" {
		keyFile = os.Getenv("LUTSTUDIO_DLBIN_KEY")
	}
	k, err := os.ReadFile(keyFile)
	if err != nil {
		return fmt.Errorf("key: %w (see tools/gentable)", err)
	}
	if len(k) != 64 {
		return fmt.Errorf("key %s: %d bytes, want 64 (public key, secret key)", keyFile, len(k))
	}
	var pk, sk [32]byte
	copy(pk[:], k[:32])
	copy(sk[:], k[32:])
	tables := map[string][]byte{}
	for _, name := range datalib.TableNames() {
		ct, err := os.ReadFile(filepath.Join(dir, "data", "game", name))
		if err != nil {
			return err
		}
		pt, ok := box.OpenAnonymous(nil, ct, &pk, &sk)
		if !ok {
			if strings.HasPrefix(string(ct), "LDLD") || strings.HasSuffix(name, ".dl_typelib") && len(ct) > 0 && !looksSealed(ct) {
				pt = ct // not encrypted
			} else {
				return fmt.Errorf("%s: does not open with this key (a new key, or not a sealed box)", name)
			}
		}
		tables[name] = pt
	}
	return datalib.LoadTables(tables)
}

// looksSealed: a sealed box is at least its 48 bytes of overhead (we can't tell more without the key).
func looksSealed(b []byte) bool { return len(b) >= 48 && !strings.HasPrefix(string(b), "LDLD") }
