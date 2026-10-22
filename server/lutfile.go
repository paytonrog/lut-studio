package server

import (
	"fmt"
	"io"
	"net/http"

	"lutstudio/lut"
)

// POST /api/lut/file?format=dds|exr {Width, Height, Px}: a LUT's values as a file for other tools (lut.FileDDS,
// lut.FileEXR: half floats, exact)
func (s *Server) lutFile(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Width, Height int
		Px            []float32
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	if in.Width < 1 || in.Height < 1 || in.Width > 1<<20 || in.Height > 1<<20 || in.Width*in.Height > 1<<20 || len(in.Px) != in.Width*in.Height*4 {
		fail(w, 400, fmt.Errorf("%d values for %d x %d", len(in.Px), in.Width, in.Height))
		return
	}
	t := &lut.Texture{Width: in.Width, Height: in.Height, Px: in.Px}
	var b []byte
	switch r.URL.Query().Get("format") {
	case "dds":
		b = t.FileDDS()
	case "exr":
		b = t.FileEXR()
	default:
		fail(w, 400, fmt.Errorf("format: dds or exr"))
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(b)
}

// POST /api/lut/read (a .dds or .exr file): its values {width, height, px} (lut.ReadFile)
func (s *Server) lutRead(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil {
		fail(w, 400, err)
		return
	}
	t, err := lut.ReadFile(b)
	if err != nil {
		fail(w, 400, err)
		return
	}
	writeJSON(w, map[string]any{"width": t.Width, "height": t.Height, "px": t.Px})
}
