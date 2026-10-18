// Package atomicfile writes a file whole or not at all: the data goes to a temporary file beside it, which then
// replaces it (a crash or a kill mid-write leaves the old file, never a cut-off one).
package atomicfile

import (
	"os"
	"path/filepath"
)

// WriteFile is os.WriteFile, atomic.
func WriteFile(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, perm)
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}
