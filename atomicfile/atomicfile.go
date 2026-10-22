// Package atomicfile writes a file whole or not at all: the data goes to a temporary file beside it, which then
// replaces it (a crash or a kill mid-write leaves the old file, never a cut-off one).
package atomicfile

import (
	"os"
	"path/filepath"
	"time"
)

// WriteFile is os.WriteFile, atomic. Where the file can't be replaced (Windows, while another request has it open
// for reading) it is tried a few times, then written in place as os.WriteFile does.
func WriteFile(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync() // (on disk before it replaces the file: a power cut after the rename can't leave it empty)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, perm)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	for try := 0; ; try++ {
		if err = os.Rename(tmp, path); err == nil {
			return nil
		}
		if try == 4 {
			break
		}
		time.Sleep(time.Duration(10<<try) * time.Millisecond)
	}
	os.Remove(tmp)
	return os.WriteFile(path, data, perm) // (replacing refused: in place, as before)
}
