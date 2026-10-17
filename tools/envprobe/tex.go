package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"

	"github.com/xypwn/filediver/app"
	"github.com/xypwn/filediver/stingray"
)

// probeTextures reports, for each texture path, whether the install has it and its DDS layout.
func probeTextures(a *app.App, names []string) {
	texType := stingray.Sum("texture")
	for _, n := range names {
		id := stingray.FileID{Name: stingray.Sum(n), Type: texType}
		var rs []io.Reader
		for typ := range stingray.NumDataType {
			b, err := a.DataDir.Read(id, typ)
			if err == nil {
				rs = append(rs, bytes.NewReader(b))
			}
		}
		if len(rs) == 0 {
			fmt.Printf("  %-80s missing\n", n)
			continue
		}
		all, _ := io.ReadAll(io.MultiReader(rs...))
		d := bytes.Index(all, []byte("DDS "))
		if d < 0 || len(all) < d+148 {
			fmt.Printf("  %-80s no DDS header\n", n)
			continue
		}
		u := func(o int) uint32 { return binary.LittleEndian.Uint32(all[d+o:]) }
		f := fmt.Sprintf("fourcc %q", all[d+84:d+88])
		if string(all[d+84:d+88]) == "DX10" {
			f = fmt.Sprintf("dxgi %d, misc %#x, array %d", u(128), u(136), u(140))
		}
		fmt.Printf("  %-80s %dx%d, %d mips, caps2 %#x, %s, %d bytes\n", n, u(16), u(12), u(28), u(112), f, len(all)-d)
	}
}

// scanCubemaps lists every cubemap texture in the install (main data holds the DDS header).
func scanCubemaps(a *app.App) {
	texType := stingray.Sum("texture")
	for id := range a.DataDir.Files {
		if id.Type != texType {
			continue
		}
		b, err := a.DataDir.ReadAtMost(id, stingray.DataMain, 512)
		if err != nil {
			continue
		}
		d := bytes.Index(b, []byte("DDS "))
		if d < 0 || len(b) < d+148 {
			continue
		}
		u := func(o int) uint32 { return binary.LittleEndian.Uint32(b[d+o:]) }
		if u(112)&0x200 == 0 {
			continue
		}
		f := fmt.Sprintf("fourcc %q", b[d+84:d+88])
		if string(b[d+84:d+88]) == "DX10" {
			f = fmt.Sprintf("dxgi %d", u(128))
		}
		fmt.Printf("  cube %-90s %dx%d, %d mips, %s\n", a.LookupHash(id.Name), u(16), u(12), u(28), f)
	}
}

func isCube(a *app.App, id stingray.FileID) bool {
	b, err := a.DataDir.ReadAtMost(id, stingray.DataMain, 512)
	if err != nil {
		return false
	}
	d := bytes.Index(b, []byte("DDS "))
	return d >= 0 && len(b) >= d+148 && binary.LittleEndian.Uint32(b[d+112:])&0x200 != 0
}

var probeNames = []string{
	"content/levels/ship_hub-cubemaps/reflection_cube_irradiance",
	"content/levels/ship_hub-cubemaps/reflection_cube_specular",
	"content/levels/ship_hub-cubemaps/reflection_cube_specular_showroom",
	"content/levels/ship_hub-cubemaps/reflection_probe_bake",
	"content/levels/ship_hub-cubemaps/reflection_probe_diffuse_bake",
	"content/levels/ship_hub-cubemaps/reflection_probe_radiance_bake",
	"content/levels/ship_hub-cubemaps/reflection_probe_specular_bake",
	"content/levels/lighting/desert/desert_day-cubemaps/reflection_probe_diffuse_bake",
	"content/levels/lighting/desert/desert_day-cubemaps/reflection_probe_radiance_bake",
	"content/levels/lighting/desert/desert_day-cubemaps/reflection_probe_specular_bake",
	"content/levels/lighting/editor_testing/reflection_probe_diffuse_bake",
	"content/levels/lighting/editor_testing/reflection_probe_specular_bake",
	"content/levels/main_menu-cubemaps/reflection_probe",
	"content/levels/main_menu-cubemaps/reflection_probe_diffuse",
	"content/levels/main_menu-cubemaps/reflection_probe_specular",
	"content/levels/basic-cubemaps/reflection_probe",
	"content/levels/basic-cubemaps/reflection_probe_diffuse",
	"content/levels/basic-cubemaps/reflection_probe_specular",
	"core/editor_slave/resources/level_resources/reflection_probe_diffuse_bake",
	"core/editor_slave/resources/level_resources/reflection_probe_specular_bake",
	"core/stingray_renderer/environments/midday/skydome",
}
