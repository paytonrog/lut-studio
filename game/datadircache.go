package game

import (
	"bytes"
	"context"
	"encoding/gob"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xypwn/filediver/stingray"
)

// The install's file index (stingray.DataDir), kept in a cache folder: the website opens the install again on every
// page load, and reading the archives' index (bundles.nxa and every bundle's chunk table: thousands of small reads)
// is most of that. The cached index is used while bundles.nxa's size and time and the data folder's file count are
// the same (a game update changes them); any other change just reads the install again.

// DataDirCache, when set, is the folder that keeps the index (the website: its private storage).
var DataDirCache string

type dataDirCache struct {
	Archives             map[stingray.Hash][]stingray.FileID
	Files                map[stingray.FileID][]stingray.FileInfo
	IsSlimEdition        bool
	DSAA                 *stingray.DSAA
	ArchiveDSAAIndices   map[stingray.Hash][stingray.NumDataType]int
	Bundles              []stingray.NXABundleInfo
	SingleArchiveBundles map[stingray.Hash]map[int]*stingray.DSARStructure // (gob can't encode the nil entries)
}

func dataDirKey(dir string) (string, error) {
	st, err := os.Stat(filepath.Join(dir, "bundles.nxa"))
	if err != nil {
		return "", err
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d-%d-%d", st.Size(), st.ModTime().Unix(), len(ents)), nil
}

// openDataDir opens the install's data folder, through the cache when DataDirCache is set.
func openDataDir(dir string, progress func(done, total int)) (*stingray.DataDir, error) {
	if DataDirCache == "" {
		return stingray.OpenDataDir(context.Background(), dir, progress)
	}
	key, err := dataDirKey(dir)
	if err != nil { // (a fat-edition install has no bundles.nxa: no cache)
		return stingray.OpenDataDir(context.Background(), dir, progress)
	}
	file := filepath.Join(DataDirCache, "datadir-"+key+".gob")
	if b, err := os.ReadFile(file); err == nil {
		var c dataDirCache
		if gob.NewDecoder(bytes.NewReader(b)).Decode(&c) == nil {
			dd := &stingray.DataDir{Path: dir, Archives: c.Archives, Files: c.Files, IsSlimEdition: c.IsSlimEdition,
				DSAA: c.DSAA, ArchiveDSAAIndices: c.ArchiveDSAAIndices, Bundles: c.Bundles,
				SingleArchiveBundles: map[stingray.Hash][stingray.NumDataType]*stingray.DSARStructure{}}
			for h, m := range c.SingleArchiveBundles {
				var a [stingray.NumDataType]*stingray.DSARStructure
				for i, s := range m {
					if i >= 0 && i < len(a) {
						a[i] = s
					}
				}
				dd.SingleArchiveBundles[h] = a
			}
			return dd, nil
		}
	}
	dd, err := stingray.OpenDataDir(context.Background(), dir, progress)
	if err != nil {
		return nil, err
	}
	c := dataDirCache{Archives: dd.Archives, Files: dd.Files, IsSlimEdition: dd.IsSlimEdition, DSAA: dd.DSAA,
		ArchiveDSAAIndices: dd.ArchiveDSAAIndices, Bundles: dd.Bundles,
		SingleArchiveBundles: map[stingray.Hash]map[int]*stingray.DSARStructure{}}
	for h, a := range dd.SingleArchiveBundles {
		m := map[int]*stingray.DSARStructure{}
		for i, s := range a {
			if s != nil {
				m[i] = s
			}
		}
		c.SingleArchiveBundles[h] = m
	}
	var b bytes.Buffer
	if err := gob.NewEncoder(&b).Encode(c); err == nil && os.MkdirAll(DataDirCache, 0o755) == nil {
		// the older indexes (an earlier game build) go
		if ents, err := os.ReadDir(DataDirCache); err == nil {
			for _, e := range ents {
				if n := e.Name(); strings.HasPrefix(n, "datadir-") && strings.HasSuffix(n, ".gob") {
					os.Remove(filepath.Join(DataDirCache, n))
				}
			}
		}
		if os.WriteFile(file+".tmp", b.Bytes(), 0o644) == nil {
			os.Rename(file+".tmp", file)
		}
	}
	return dd, nil
}
