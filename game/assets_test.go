package game

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/xypwn/filediver/stingray"

	"lutstudio/lut"
)

// Needs the install: LUTSTUDIO_GAME=<install folder> go test ./game -run Assets -v
func TestAssetsFromInstall(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	tmp, _ := os.MkdirTemp("", "lutstudio-assets") // not t.TempDir: filediver keeps the exported glb open
	t.Cleanup(func() { os.RemoveAll(tmp) })        // (best effort: what is still open stays)
	a := NewAssets(g, tmp)
	for _, c := range []struct {
		name   string
		hash   uint64
		layers int
	}{{"detail tiler array", DetailTilerArray, 26}, {"ibl brdf lut", IBLBRDFLut, 1}, {"camo array", 0xf8b2508e99fb9f28, 5}} {
		t0 := time.Now()
		b, err := a.TextureBlob(c.hash)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		w, h, l, f := binary.LittleEndian.Uint32(b[4:]), binary.LittleEndian.Uint32(b[8:]), binary.LittleEndian.Uint32(b[12:]), binary.LittleEndian.Uint32(b[16:])
		t.Logf("%s: %dx%d x%d format %d, %d bytes, %v", c.name, w, h, l, f, len(b), time.Since(t0))
		if int(l) != c.layers {
			t.Errorf("%s: %d layers, want %d", c.name, l, c.layers)
		}
	}
	t0 := time.Now()
	glb, err := a.UnitGLB(0x4d183bbcb8aa9660) // FS-37 Ravager helmet
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("helmet glb %d bytes, %v", len(glb), time.Since(t0))
	// the Bastion's cannon: its full-detail turret and the damaged one only (its LODs, named by LUT Studio, left out)
	glb, err = a.UnitGLB(0x1fa1f596769225c2)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			Name string
			Mesh *int
		}
	}
	n := binary.LittleEndian.Uint32(glb[12:])
	if err := json.Unmarshal(glb[20:20+n], &doc); err != nil {
		t.Fatal(err)
	}
	var meshes []string
	for _, nd := range doc.Nodes {
		if nd.Mesh != nil {
			meshes = append(meshes, nd.Name)
		}
	}
	if len(meshes) != 2 || !slices.Contains(meshes, "g_tank_cannon_01 turret_whole") {
		t.Errorf("Bastion cannon meshes %q", meshes)
	}
}

// Every cape kit's material LUT and cape LUT: texture -> document -> JSON -> texture gives the game's own header and
// mip 0. Needs the install: LUTSTUDIO_GAME=<install folder>.
func TestCapeLUTRoundTrip(t *testing.T) {
	g, idx := install(t)
	seen := map[string]bool{}
	kinds := map[string]int{}
	for _, k := range idx.Kits {
		for _, p := range k.Pieces {
			if p.CapeLUT == "" {
				continue
			}
			for _, hs := range []string{p.MaterialLUT, p.CapeLUT} {
				if hs == "" || seen[hs] {
					continue
				}
				seen[hs] = true
				h, _ := lut.ParseHash(hs)
				main, gpu, err := g.ReadTexture(h)
				if err != nil {
					t.Fatal(err)
				}
				tex, err := lut.Decode(main, gpu)
				if err != nil {
					t.Fatalf("%s (%s): %v", hs, k.Name, err)
				}
				kind, err := lut.KindOf(tex)
				if err != nil {
					t.Fatalf("%s (%s): %v", hs, k.Name, err)
				}
				kinds[kind]++
				js, err := (&lut.Document{LUT: hs, Kind: kind, Tex: tex}).MarshalJSON()
				if err != nil {
					t.Fatal(err)
				}
				var back lut.Document
				if err := json.Unmarshal(js, &back); err != nil {
					t.Fatalf("%s: %v", hs, err)
				}
				m2, g2 := back.Tex.Encode()
				n := tex.Width * tex.Height * 8
				if !bytes.Equal(m2, main) || !bytes.Equal(g2[:n], gpu[:n]) || len(g2) != len(gpu) {
					t.Fatalf("%s (%s, %dx%d): round trip differs from the game's bytes", hs, k.Name, tex.Width, tex.Height)
				}
			}
		}
	}
	t.Logf("cape LUTs round-tripped: %v", kinds)
	if kinds["cape"] < 100 || kinds["material"] < 100 {
		t.Errorf("too few: %v", kinds)
	}
}

// The armory poses of the avatar's state machine, and one decoded clip with named bone tracks.
func TestPoses(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	tmp, _ := os.MkdirTemp("", "lutstudio-anim")
	t.Cleanup(func() { os.RemoveAll(tmp) })
	a := NewAssets(g, tmp)
	poses, err := a.Poses()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range poses {
		t.Logf("%-22s %s loop=%v (%s)", p.Name, p.Animation, p.Loop, p.State)
	}
	if len(poses) < 8 {
		t.Fatalf("%d poses, expected the 8 armory clips", len(poses))
	}
	h, _ := lut.ParseHash(poses[0].Animation)
	b, err := a.AnimationJSON(h)
	if err != nil {
		t.Fatal(err)
	}
	var c Clip
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	named := 0
	for _, tr := range c.Tracks {
		if !strings.HasPrefix(tr.Bone, "0x") {
			named++
		}
	}
	t.Logf("%s: %.2fs, %d tracks (%d named), e.g. %s: %d rotation keys", c.Animation, c.Length, len(c.Tracks), named, c.Tracks[4].Bone, len(c.Tracks[4].R))
	if named < len(c.Tracks)/2 {
		t.Errorf("only %d of %d tracks named", named, len(c.Tracks))
	}
}

// The game's baked lighting environments: every listed cube decodes with all faces and mips, HDR kept.
func TestEnvironments(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	tmp, _ := os.MkdirTemp("", "lutstudio-env")
	t.Cleanup(func() { os.RemoveAll(tmp) })
	a := NewAssets(g, tmp)
	envs := g.Environments()
	if len(envs) < 5 {
		t.Fatalf("%d environments, want 5", len(envs))
	}
	for _, e := range envs {
		for _, hs := range []string{e.Specular, e.Diffuse} {
			if hs == "" {
				continue
			}
			h, _ := lut.ParseHash(hs)
			b, err := a.CubeBlob(h)
			if err != nil {
				t.Fatalf("%s: %v", e.Name, err)
			}
			size, mips := binary.LittleEndian.Uint32(b[4:]), binary.LittleEndian.Uint32(b[8:])
			t.Logf("%s %s: %d px, %d mips, format %d, %d bytes", e.Name, hs, size, mips, binary.LittleEndian.Uint32(b[12:]), len(b))
		}
	}
}

// Vehicles (all 198 skins, Standard included; the Patriot with its two arms) and weapons (default looks and paint
// schemes) in the kit index.
func TestIndexVehiclesWeapons(t *testing.T) {
	_, idx := install(t)
	var vehicles, weapons, schemes int
	for _, k := range idx.Kits {
		switch k.Type {
		case VehicleType:
			vehicles++
			if k.Name == "Patriot Exosuit: Mustard Exosuit Pattern" {
				var names []string
				for _, u := range k.Units {
					names = append(names, u.Name)
				}
				all := strings.Join(names, " ")
				if !strings.Contains(all, "combat_walker_turret") || !strings.Contains(all, "combat_walker_missle_launcher") {
					t.Errorf("Patriot units: %v", names)
				}
			}
		case WeaponType:
			weapons++
			if k.Name == "AR-23 Liberator" { // its default attachments, each on its mount node
				mounts := map[string]bool{}
				for _, u := range k.Units[1:] {
					mounts[u.Mount] = true
				}
				for _, m := range []string{"attach_mag", "attach_muzzle", "attach_optic", "attach_underbarrel"} {
					if !mounts[m] {
						t.Errorf("Liberator: no attachment on %s (units %+v)", m, k.Units)
					}
				}
			}
			if strings.HasSuffix(k.Name, " paint scheme") {
				schemes++
			}
		}
	}
	t.Logf("%d vehicle kits, %d weapon kits (%d paint-scheme kits)", vehicles, weapons, schemes)
	if vehicles != 198 || weapons < 600 || schemes < 500 {
		t.Fatalf("vehicles %d (want 198), weapons %d, schemes %d", vehicles, weapons, schemes)
	}
}

// The attachments a weapon can show: the Liberator's slots, its magazine family, its defaults among the choices.
func TestWeaponOptions(t *testing.T) {
	dir := os.Getenv("LUTSTUDIO_GAME")
	if dir == "" {
		t.Skip("LUTSTUDIO_GAME not set")
	}
	g, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	slots, err := g.WeaponOptions(stingray.Sum("content/fac_helldivers/equipment/primary_weapons/assault_rifle/assault_rifle").Value, true)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]AttachSlot{}
	for _, s := range slots {
		got[s.Slot] = s
		var names []string
		hasDefault := false
		for _, o := range s.Options {
			names = append(names, o.Name)
			hasDefault = hasDefault || o.ID == s.Default
			if o.ID != "" && (len(o.Units) == 0 || o.Units[0].Mount != s.Mount) {
				t.Errorf("%s %s: units %+v", s.Slot, o.Name, o.Units)
			}
		}
		if !hasDefault {
			t.Errorf("%s: default %s not among %v", s.Slot, s.Default, names)
		}
		t.Logf("%s (%s): %d options: %v", s.Slot, s.Mount, len(s.Options), names)
	}
	for _, s := range []string{"Optics", "Magazine", "Muzzle", "Underbarrel"} {
		if len(got[s].Options) < 2 {
			t.Errorf("slot %s: %+v", s, got[s])
		}
	}
	for _, o := range got["Magazine"].Options { // only 5,5x50mm rifle magazines
		if strings.Contains(o.Units[0].Name, "shotgun") || strings.Contains(o.Units[0].Name, "pistol") {
			t.Errorf("Liberator offered %s", o.Units[0].Name)
		}
	}
}
