package modpack

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"

	"github.com/bodgit/sevenzip"
)

// Source is the files of a mod, read on demand: a mod's .gpu_resources hold every texture it replaces (hundreds of
// MB for a mesh or texture overhaul), while LUT Studio needs a few KB of LUTs out of them, so files are listed and
// read in parts rather than unpacked whole.
type Source interface {
	Paths() []string                      // every file (forward slashes, no leading slash)
	Size(p string) int64                  // a file's size (-1: no such file)
	Open(p string) (io.ReadCloser, error) // a file's bytes from the start
}

// Files is a Source in memory: path -> bytes (loose files sent to the app; tests).
type Files map[string][]byte

func (f Files) Paths() []string {
	out := make([]string, 0, len(f))
	for p := range f {
		out = append(out, p)
	}
	return out
}

func (f Files) Size(p string) int64 {
	if b, ok := f[p]; ok {
		return int64(len(b))
	}
	return -1
}

func (f Files) Open(p string) (io.ReadCloser, error) {
	b, ok := f[p]
	if !ok {
		return nil, fmt.Errorf("%s: no such file", p)
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

// Zip is a Source reading a zip in place (nothing unpacked up front).
type Zip struct {
	files map[string]*zip.File
	index map[string]int // order in the archive
}

func (z *Zip) order(p string) int { return z.index[p] }

// OpenZip reads a zip's directory (r: the zip file, size its length).
func OpenZip(r io.ReaderAt, size int64) (*Zip, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, err
	}
	z := &Zip{files: map[string]*zip.File{}, index: map[string]int{}}
	for i, f := range zr.File {
		if !f.FileInfo().IsDir() {
			z.files[cleanPath(f.Name)] = f
			z.index[cleanPath(f.Name)] = i
		}
	}
	return z, nil
}

func (z *Zip) Paths() []string {
	out := make([]string, 0, len(z.files))
	for p := range z.files {
		out = append(out, p)
	}
	return out
}

func (z *Zip) Size(p string) int64 {
	if f, ok := z.files[p]; ok {
		return int64(f.UncompressedSize64)
	}
	return -1
}

func (z *Zip) Open(p string) (io.ReadCloser, error) {
	f, ok := z.files[p]
	if !ok {
		return nil, fmt.Errorf("%s: no such file", p)
	}
	return f.Open()
}

// Merged is several Sources as one (a zip plus loose files); a later one's file wins.
type Merged []Source

func (m Merged) order(p string) int {
	if o, ok := m.owner(p).(orderer); ok {
		return o.order(p)
	}
	return 0
}

func (m Merged) owner(p string) Source {
	for i := len(m) - 1; i >= 0; i-- {
		if m[i].Size(p) >= 0 {
			return m[i]
		}
	}
	return nil
}

func (m Merged) Paths() []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range m {
		for _, p := range s.Paths() {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

func (m Merged) Size(p string) int64 {
	if s := m.owner(p); s != nil {
		return s.Size(p)
	}
	return -1
}

func (m Merged) Open(p string) (io.ReadCloser, error) {
	if s := m.owner(p); s != nil {
		return s.Open(p)
	}
	return nil, fmt.Errorf("%s: no such file", p)
}

func cleanPath(p string) string {
	return strings.TrimPrefix(path.Clean(strings.ReplaceAll(p, `\`, "/")), "/")
}

// readAll: a whole (small) file, at most limit bytes.
func readAll(src Source, p string, limit int64) ([]byte, error) {
	if n := src.Size(p); n > limit {
		return nil, fmt.Errorf("%s: %d MB, more than a patch table can be", p, n>>20)
	}
	rc, err := src.Open(p)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, limit))
}

// part is a part of a file: n bytes at off.
type part struct{ off, n uint64 }

// readParts reads parts of a file in one pass from its start (a zip entry can only be read in order), keeping only
// those bytes. A part past the end of the file reads as nil.
func readParts(src Source, p string, parts []part) (map[part][]byte, error) {
	out := map[part][]byte{}
	sorted := append([]part(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].off < sorted[j].off })
	size := src.Size(p)
	var rc io.ReadCloser
	var pos uint64
	defer func() {
		if rc != nil {
			rc.Close()
		}
	}()
	for _, pt := range sorted {
		if _, done := out[pt]; done || pt.n == 0 || size < 0 || pt.off+pt.n < pt.off || pt.off+pt.n > uint64(size) {
			continue
		}
		if rc == nil || pt.off < pos { // (overlapping parts: start over)
			if rc != nil {
				rc.Close()
			}
			var err error
			if rc, err = src.Open(p); err != nil {
				return nil, err
			}
			pos = 0
		}
		if _, err := io.CopyN(io.Discard, rc, int64(pt.off-pos)); err != nil {
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		b := make([]byte, pt.n)
		if _, err := io.ReadFull(rc, b); err != nil {
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		pos = pt.off + pt.n
		out[pt] = b
	}
	return out, nil
}

// SevenZip is a Source reading a .7z in place (mods on Nexus often come as 7z).
type SevenZip struct {
	files map[string]*sevenzip.File
	index map[string]int // order in the archive
}

func (z *SevenZip) order(p string) int { return z.index[p] }

// OpenSevenZip reads a 7z's directory (r: the archive, size its length).
func OpenSevenZip(r io.ReaderAt, size int64) (*SevenZip, error) {
	zr, err := sevenzip.NewReader(r, size)
	if err != nil {
		return nil, err
	}
	z := &SevenZip{files: map[string]*sevenzip.File{}, index: map[string]int{}}
	for i, f := range zr.File {
		if !f.FileInfo().IsDir() {
			z.files[cleanPath(f.Name)] = f
			z.index[cleanPath(f.Name)] = i
		}
	}
	return z, nil
}

func (z *SevenZip) Paths() []string {
	out := make([]string, 0, len(z.files))
	for p := range z.files {
		out = append(out, p)
	}
	return out
}

func (z *SevenZip) Size(p string) int64 {
	if f, ok := z.files[p]; ok {
		return int64(f.UncompressedSize)
	}
	return -1
}

func (z *SevenZip) Open(p string) (io.ReadCloser, error) {
	f, ok := z.files[p]
	if !ok {
		return nil, fmt.Errorf("%s: no such file", p)
	}
	return f.Open()
}
