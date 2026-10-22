package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"lutstudio/lut"
	"lutstudio/project"
)

// The mod page: what the mod manager shows of the mod besides its LUTs: the pictures (the icon, the choice's
// picture, each variant's), the variants' names, descriptions and order. The name, description and the choice's
// name are PUT /api/project.

// TrashDir: where deleted variants go (inside the project; left out of exports and copies).
const TrashDir = ".trash"

// picRef: where a picture's file is noted in the project (get / set the noted path), whether it was rendered at
// build time (auto, when it can be), and the file it gets (rel)
type picRef struct {
	get  func() string
	set  func(string)
	auto *bool
	rel  string
}

func fieldRef(f *string, auto *bool, rel string) picRef {
	return picRef{func() string { return *f }, func(v string) { *f = v }, auto, rel}
}

// imageRef: target's picture: "icon", "option" (the choice between the variants), a variant folder, "opt:<option
// id>" (an option's) or "opt:<option id>:<variant folder>" (an option's picture of one of its variants)
func imageRef(p *project.Project, target string) (picRef, error) {
	switch target {
	case "icon":
		return fieldRef(&p.Icon, &p.IconAuto, "icon.png"), nil
	case "option":
		return fieldRef(&p.OptionImage, nil, "images/option.choice.png"), nil
	}
	if rest, ok := strings.CutPrefix(target, "opt:"); ok {
		id, folder, _ := strings.Cut(rest, ":")
		for i := range p.Options {
			o := &p.Options[i]
			if o.ID != id {
				continue
			}
			if folder == "" {
				return fieldRef(&o.Image, nil, project.OptionImage(id, "")), nil
			}
			if _, err := p.Variant(folder); err != nil {
				return picRef{}, err
			}
			return picRef{func() string { return o.Images[folder] }, func(v string) {
				if o.Images == nil {
					o.Images = map[string]string{}
				}
				if v == "" {
					delete(o.Images, folder)
				} else {
					o.Images[folder] = v
				}
			}, nil, project.OptionImage(id, folder)}, nil
		}
		return picRef{}, fmt.Errorf("no option %q", id)
	}
	for i := range p.Variants {
		if p.Variants[i].Folder == target {
			return fieldRef(&p.Variants[i].Image, &p.Variants[i].ImageAuto, "images/"+target+".png"), nil
		}
	}
	return picRef{}, fmt.Errorf("no picture %q", target)
}

// GET /api/image?target=: the picture (404: none; X-Auto: 1 when rendered at build time)
func (s *Server) getImage(w http.ResponseWriter, r *http.Request) {
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	ref, err := imageRef(p, r.URL.Query().Get("target"))
	if err != nil {
		fail(w, 400, err)
		return
	}
	if ref.get() == "" {
		fail(w, 404, fmt.Errorf("no picture yet"))
		return
	}
	b, err := os.ReadFile(filepath.Join(p.Dir, filepath.FromSlash(ref.get())))
	if err != nil {
		fail(w, 404, err)
		return
	}
	if ref.auto != nil && *ref.auto {
		w.Header().Set("X-Auto", "1")
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

// DELETE /api/image?target=: back to the default (the icon and variant pictures are rendered at the next build; the
// choice shows the icon)
func (s *Server) deleteImage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	ref, err := imageRef(p, r.URL.Query().Get("target"))
	if err != nil {
		fail(w, 400, err)
		return
	}
	ref.set("")
	if ref.auto != nil {
		*ref.auto = false
	}
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, "ok")
}

// PUT /api/variant {Folder, Name, Description}: a variant's name and description (its folder stays)
func (s *Server) putVariant(w http.ResponseWriter, r *http.Request) {
	var in struct{ Folder, Name, Description string }
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.Name) == "" {
		fail(w, 400, fmt.Errorf("the variant needs a name"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	for i := range p.Variants {
		if p.Variants[i].Folder == in.Folder {
			p.Variants[i].Name, p.Variants[i].Description = strings.TrimSpace(in.Name), strings.TrimSpace(in.Description)
			if err := p.Save(); err != nil {
				fail(w, 500, err)
				return
			}
			writeJSON(w, p.Variants[i])
			return
		}
	}
	fail(w, 404, fmt.Errorf("no variant %q", in.Folder))
}

// DELETE /api/variant?folder=: the variant out of the project; its folder moves to .trash/<folder>-<time> (nothing
// is deleted). The last variant stays.
func (s *Server) deleteVariant(w http.ResponseWriter, r *http.Request) {
	folder := r.URL.Query().Get("folder")
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	if len(p.Variants) < 2 {
		fail(w, 400, fmt.Errorf("a mod needs at least one variant"))
		return
	}
	for i, v := range p.Variants {
		if v.Folder != folder {
			continue
		}
		trash := filepath.Join(p.Dir, TrashDir, fmt.Sprintf("%s-%d", v.Folder, time.Now().Unix()))
		if err := os.MkdirAll(filepath.Dir(trash), 0o755); err != nil {
			fail(w, 500, err)
			return
		}
		if err := os.Rename(p.VariantDir(v), trash); err != nil && !os.IsNotExist(err) {
			fail(w, 500, err)
			return
		}
		p.Variants = append(p.Variants[:i], p.Variants[i+1:]...)
		for j := range p.Options { // the options offer it no more (an option left with none: its first variant)
			o := &p.Options[j]
			o.Variants = slices.DeleteFunc(o.Variants, func(f string) bool { return f == folder })
			if len(o.Variants) == 0 {
				o.Variants = []string{p.Variants[0].Folder}
			}
			delete(o.Images, folder)
		}
		if err := p.Save(); err != nil {
			os.Rename(trash, p.VariantDir(v)) // (the project still lists it: its files back)
			fail(w, 500, err)
			return
		}
		writeJSON(w, map[string]string{"trash": trash})
		return
	}
	fail(w, 404, fmt.Errorf("no variant %q", folder))
}

// PUT /api/options {Options}: the mod as several options (an empty list: one choice between the variants). Each
// needs a name and one variant at least (that exist); ids are made folder-safe and unique; pictures already set are
// kept.
func (s *Server) putOptions(w http.ResponseWriter, r *http.Request) {
	var in struct{ Options []project.Option }
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	old := map[string]project.Option{}
	for _, o := range p.Options {
		old[o.ID] = o
	}
	ids := map[string]bool{}
	for i := range in.Options {
		o := &in.Options[i]
		o.Name = strings.TrimSpace(o.Name)
		if o.Name == "" {
			fail(w, 400, fmt.Errorf("option %d needs a name", i+1))
			return
		}
		var vs []string
		for _, f := range o.Variants {
			if _, err := p.Variant(f); err == nil && !slices.Contains(vs, f) {
				vs = append(vs, f)
			}
		}
		if len(vs) == 0 {
			fail(w, 400, fmt.Errorf("option %q needs a variant", o.Name))
			return
		}
		o.Variants = vs
		prev, had := old[o.ID]
		if o.ID == "" || !had {
			o.ID = project.Folder(o.Name)
		}
		base := o.ID
		for n := 2; ids[o.ID]; n++ {
			o.ID = fmt.Sprintf("%s-%d", base, n)
		}
		ids[o.ID] = true
		if had { // the pictures stay with the option
			o.Image, o.Images = prev.Image, prev.Images
		} else {
			o.Image, o.Images = "", nil
		}
		slices.Sort(o.Parts)
		o.Parts = slices.Compact(o.Parts)
	}
	p.Options = in.Options
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, p.Options)
}

// GET /api/texusers?hash=: the items (kit labels) whose pieces use a texture as their decal sheet or cape design
// (the record's; a material's own decal sheet isn't listed)
func (s *Server) texUsers(w http.ResponseWriter, r *http.Request) {
	hv, err := hashParam(r)
	if err != nil {
		fail(w, 400, err)
		return
	}
	h := lut.HashString(hv)
	var out []string
	if idx := s.index(); idx != nil {
		for _, k := range idx.Kits {
			for _, pc := range k.Pieces {
				if pc.DecalScalarFields == h || pc.DecalSheet == h {
					if l := s.kitLabel(k); !slices.Contains(out, l) {
						out = append(out, l)
					}
				}
			}
		}
	}
	writeJSON(w, map[string]any{"users": out})
}

func must[T any](v T, _ error) T { return v }

// POST /api/variants/order {Folders}: the variants in this order (the order the mod manager lists them)
func (s *Server) orderVariants(w http.ResponseWriter, r *http.Request) {
	var in struct{ Folders []string }
	if err := decode(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.project()
	if err != nil {
		fail(w, 500, err)
		return
	}
	if len(in.Folders) != len(p.Variants) {
		fail(w, 400, fmt.Errorf("%d folders for %d variants", len(in.Folders), len(p.Variants)))
		return
	}
	var out []project.Variant
	seen := map[string]bool{}
	for _, f := range in.Folders {
		if seen[f] { // (each variant once: a repeat would drop another from the project)
			fail(w, 400, fmt.Errorf("variant %q listed twice", f))
			return
		}
		seen[f] = true
		found := false
		for _, v := range p.Variants {
			if v.Folder == f {
				out, found = append(out, v), true
			}
		}
		if !found {
			fail(w, 400, fmt.Errorf("no variant %q", f))
			return
		}
	}
	p.Variants = out
	if err := p.Save(); err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, p.Variants)
}
