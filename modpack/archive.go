// Package modpack turns LUTs into a mod: a patch archive, a manifest (Helldivers 2 Mod Manager / HD2Arsenal format,
// its mod_manifest_v1 schema) and a zip ready to import.
package modpack

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sort"
)

// BootArchive is the archive retexture mods patch (the texture mods checked all use it; the mod manager renumbers
// patch_0 to the next free patch_N on deploy).
const BootArchive = "9ba626afa44a3aa3"

// headerStamp: bytes +16..+72 of every content patch that loads in today's game (157 of 160 deployed patches start
// with 0xF4F509CE; this is the most common block verbatim). Zeros there gave a fatal "unexpected file" error
// in game.
var headerStamp = append(mustHex("ce09f5f4000000000c729f9e8872b8bd00a06b0200000000007951"), make([]byte, 29)...)

func mustHex(s string) []byte {
	b := make([]byte, len(s)/2)
	for i := range b {
		fmt.Sscanf(s[2*i:2*i+2], "%02x", &b[i])
	}
	return b
}

type Resource struct {
	Name, Type        uint64
	Main, Stream, GPU []byte
}

type Archive struct{ TOC, Stream, GPU []byte }

func align(n, a int) int { return (n + a - 1) / a * a }

// WriteArchive lays out a patch archive as patches that load in game do: 72-byte header, 32-byte type rows, 80-byte file rows grouped by type, main data 16-aligned,
// stream / GPU data 64-aligned.
func WriteArchive(res []Resource) Archive {
	res = append([]Resource(nil), res...)
	sort.Slice(res, func(i, j int) bool {
		if res[i].Type != res[j].Type {
			return res[i].Type < res[j].Type
		}
		return res[i].Name < res[j].Name
	})
	var types []uint64
	counts := map[uint64]int{}
	for _, r := range res {
		if counts[r.Type] == 0 {
			types = append(types, r.Type)
		}
		counts[r.Type]++
	}
	le := binary.LittleEndian
	toc := le.AppendUint32(nil, 0xF0000011)
	toc = le.AppendUint32(toc, uint32(len(types)))
	toc = le.AppendUint32(toc, uint32(len(res)))
	toc = le.AppendUint32(toc, 0)
	toc = append(toc, headerStamp...)
	for _, t := range types {
		toc = le.AppendUint64(toc, 0)
		toc = le.AppendUint64(toc, t)
		toc = le.AppendUint64(toc, uint64(counts[t]))
		toc = le.AppendUint32(toc, 16)
		toc = le.AppendUint32(toc, 64)
	}
	rows := len(toc)
	toc = append(toc, make([]byte, 80*len(res))...)
	toc = append(toc, make([]byte, align(len(toc), 16)-len(toc))...)
	var gpu, stream []byte
	for i, r := range res {
		mainOff := len(toc)
		toc = append(toc, r.Main...)
		toc = append(toc, make([]byte, align(len(toc), 16)-len(toc))...)
		gOff := align(len(gpu), 64)
		gpu = append(append(gpu, make([]byte, gOff-len(gpu))...), r.GPU...)
		sOff := align(len(stream), 64)
		stream = append(append(stream, make([]byte, sOff-len(stream))...), r.Stream...)
		row := toc[rows+80*i:]
		le.PutUint64(row[0:], r.Name)
		le.PutUint64(row[8:], r.Type)
		le.PutUint64(row[16:], uint64(mainOff))
		le.PutUint64(row[24:], uint64(sOff))
		le.PutUint64(row[32:], uint64(gOff))
		le.PutUint32(row[56:], uint32(len(r.Main)))
		le.PutUint32(row[60:], uint32(len(r.Stream)))
		le.PutUint32(row[64:], uint32(len(r.GPU)))
		le.PutUint32(row[68:], 16)
		le.PutUint32(row[72:], 64)
		le.PutUint32(row[76:], uint32(i))
	}
	return Archive{TOC: toc, Stream: stream, GPU: gpu}
}

// Entry is a file row of a patch archive's table: where its main, stream and GPU data are.
type Entry struct {
	Name, Type                    uint64
	MainOff, StreamOff, GPUOff    uint64
	MainSize, StreamSize, GPUSize uint64
}

// ReadTOC parses a patch archive's table (the .patch_N file itself).
func ReadTOC(toc []byte) ([]Entry, error) {
	le := binary.LittleEndian
	if len(toc) < 72 || le.Uint32(toc) != 0xF0000011 {
		return nil, fmt.Errorf("not a patch archive")
	}
	nt, nf := int(le.Uint32(toc[4:])), int(le.Uint32(toc[8:]))
	base := 72 + 32*nt
	if nt < 0 || nf < 0 || base+80*nf > len(toc) {
		return nil, fmt.Errorf("truncated patch table (%d types, %d files, %d bytes)", nt, nf, len(toc))
	}
	out := make([]Entry, nf)
	for i := range out {
		row := toc[base+80*i:]
		out[i] = Entry{Name: le.Uint64(row), Type: le.Uint64(row[8:]),
			MainOff: le.Uint64(row[16:]), StreamOff: le.Uint64(row[24:]), GPUOff: le.Uint64(row[32:]),
			MainSize: uint64(le.Uint32(row[56:])), StreamSize: uint64(le.Uint32(row[60:])), GPUSize: uint64(le.Uint32(row[64:]))}
	}
	return out, nil
}

// span: data[off:off+n]; ok = false when out of bounds. An empty span is fine anywhere (writers put a zero-size
// file's offset at the aligned end, past the data: the SDK does, and the game loads those).
func span(data []byte, off, n uint64) ([]byte, bool) {
	if n == 0 {
		return nil, true
	}
	if off+n > uint64(len(data)) || off+n < off {
		return nil, false
	}
	return data[off : off+n], true
}

// ReadArchive parses a patch back (for self-checks).
func ReadArchive(a Archive) ([]Resource, error) {
	es, err := ReadTOC(a.TOC)
	if err != nil {
		return nil, err
	}
	var out []Resource
	for i, e := range es {
		m, ok1 := span(a.TOC, e.MainOff, e.MainSize)
		s, ok2 := span(a.Stream, e.StreamOff, e.StreamSize)
		g, ok3 := span(a.GPU, e.GPUOff, e.GPUSize)
		if !ok1 || !ok2 || !ok3 {
			return nil, fmt.Errorf("file %d out of bounds", i)
		}
		out = append(out, Resource{Name: e.Name, Type: e.Type, Main: m, Stream: s, GPU: g})
	}
	return out, nil
}

// Verify checks that the archive reads back to exactly res.
func Verify(a Archive, res []Resource) error {
	back, err := ReadArchive(a)
	if err != nil {
		return err
	}
	got := map[[2]uint64]Resource{}
	for _, r := range back {
		got[[2]uint64{r.Name, r.Type}] = r
	}
	if len(back) != len(res) {
		return fmt.Errorf("%d files written, %d read back", len(res), len(back))
	}
	for _, r := range res {
		b, ok := got[[2]uint64{r.Name, r.Type}]
		if !ok || !bytes.Equal(b.Main, r.Main) || !bytes.Equal(b.GPU, r.GPU) || !bytes.Equal(b.Stream, r.Stream) {
			return fmt.Errorf("%016x does not read back", r.Name)
		}
	}
	return nil
}
