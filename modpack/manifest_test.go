package modpack

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

// managerCheck replays what the mod managers check when they add a mod zip: HD2 Mod Manager's v1 manifest reader
// and path checks (Helldivers2ModManager: V1ModManifest, ModOption, ModSubOption, ModService.CheckPaths) and HD2
// Arsenal's builder limits (folder names 29 characters, option names 60, mod name 120). Returns the problems.
func managerCheck(files map[string][]byte) []string {
	var out []string
	bad := func(f string, a ...any) { out = append(out, fmt.Sprintf(f, a...)) }
	dirExists := func(d string) bool {
		for p := range files {
			if strings.HasPrefix(p, strings.TrimSuffix(d, "/")+"/") {
				return true
			}
		}
		return false
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(files["manifest.json"], &root); err != nil {
		return []string{"manifest.json: " + err.Error()}
	}
	str := func(obj map[string]json.RawMessage, key, where string, required bool) (string, bool) {
		raw, ok := obj[key]
		if !ok {
			if required {
				bad("%s: no %s (required)", where, key)
			}
			return "", false
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			bad("%s: %s is not a string", where, key)
			return "", false
		}
		return s, true
	}
	image := func(path, where string) {
		if strings.TrimSpace(path) == "" {
			bad("%s: empty image path", where)
		} else if files[path] == nil {
			bad("%s: image %q is not in the zip", where, path)
		}
	}
	var version int
	if err := json.Unmarshal(root["Version"], &version); err != nil || version != 1 {
		bad("Version is not 1")
	}
	guid, _ := str(root, "Guid", "manifest", true)
	if !regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString(guid) {
		bad("Guid %q does not parse", guid)
	}
	if name, _ := str(root, "Name", "manifest", true); len([]rune(name)) > 120 || strings.TrimSpace(name) == "" {
		bad("mod name %q: empty or over 120 characters", name)
	}
	str(root, "Description", "manifest", true)
	if icon, ok := str(root, "IconPath", "manifest", false); ok {
		image(icon, "IconPath")
	}
	var opts []map[string]json.RawMessage
	if err := json.Unmarshal(root["Options"], &opts); err != nil || len(opts) == 0 {
		bad("Options: missing or empty")
	}
	includes := func(raw json.RawMessage, where string, required bool) {
		var inc []string
		if raw == nil {
			if required {
				bad("%s: no Include (required)", where)
			}
			return
		}
		if err := json.Unmarshal(raw, &inc); err != nil {
			bad("%s: Include is not a list of strings", where)
			return
		}
		if required && len(inc) == 0 {
			bad("%s: empty Include", where)
		}
		for _, d := range inc {
			if !dirExists(d) {
				bad("%s: Include %q is not a folder in the zip", where, d)
			}
			for _, part := range strings.Split(d, "/") {
				if len(part) > 29 {
					bad("%s: folder %q is over 29 characters", where, part)
				}
			}
		}
	}
	for i, o := range opts {
		where := fmt.Sprintf("option %d", i)
		if name, _ := str(o, "Name", where, true); len([]rune(name)) > 60 {
			bad("%s: name over 60 characters", where)
		}
		str(o, "Description", where, true)
		if img, ok := str(o, "Image", where, false); ok {
			image(img, where)
		}
		includes(o["Include"], where, false)
		if raw, ok := o["SubOptions"]; ok {
			var subs []map[string]json.RawMessage
			if err := json.Unmarshal(raw, &subs); err != nil || len(subs) == 0 {
				bad("%s: SubOptions empty", where)
			}
			for j, so := range subs {
				w := fmt.Sprintf("%s sub-option %d", where, j)
				if name, _ := str(so, "Name", w, true); len([]rune(name)) > 60 {
					bad("%s: name over 60 characters", w)
				}
				str(so, "Description", w, true)
				if img, ok := str(so, "Image", w, false); ok {
					image(img, w)
				}
				includes(so["Include"], w, true)
			}
		} else if o["Include"] == nil {
			bad("%s: neither Include nor SubOptions", where)
		}
	}
	return out
}

// Every shape of mod LUT Studio builds passes the managers' checks: one variant with or without its picture,
// several with and without pictures and a picture for the choice, folder names over 29 characters (two that are
// the same once cut), descriptions left empty.
func TestManifestManagers(t *testing.T) {
	png := []byte("\x89PNG fake")
	lut := []Resource{res(0x05aab6c2788930fa, testLUT(0.5))}
	long := "a-very-long-variant-folder-name-indeed"
	cases := map[string]Mod{
		"one variant": {Name: "One", GUID: "00000000-0000-0000-0000-000000000001", Icon: png,
			Variants: []Variant{{Name: "Default", Folder: "default", Resources: lut}}},
		"one variant with its picture": {Name: "One", Description: "d", GUID: "00000000-0000-0000-0000-000000000002", Icon: png,
			Variants: []Variant{{Name: "Default", Folder: "default", Image: png, Resources: lut}}},
		"variants": {Name: "Many", GUID: "00000000-0000-0000-0000-000000000003", Icon: png, OptionName: "Armor color",
			OptionDescription: "Pick a color", OptionImage: png, Variants: []Variant{
				{Name: "Red", Description: "red", Folder: "red", Image: png, Resources: lut},
				{Name: "Blue", Folder: "blue", Resources: lut},
				{Name: "Long 1", Folder: long + "-1", Image: png, Resources: lut},
				{Name: "Long 2", Folder: long + "-2", Image: png, Resources: lut}}},
	}
	cape := []Resource{res(0x1111111111111111, testLUT(0.25))}
	cases["options"] = Mod{Name: "Opts", GUID: "00000000-0000-0000-0000-000000000004", Icon: png, Options: []Option{
		{Name: "Armor", Description: "the armor", Folder: "armor", Image: png, Choices: []Variant{
			{Name: "Red", Description: "red", Folder: "red", Image: png, Resources: lut},
			{Name: "Blue", Folder: "blue", Resources: []Resource{res(0x05aab6c2788930fa, testLUT(0.75))}}}},
		{Name: "Cape", Description: "", Folder: "a-cape-option-with-a-long-folder-name", Resources: cape}}}
	for name, m := range cases {
		z, err := m.Zip()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		files, err := ZipFiles(z)
		if err != nil {
			t.Fatal(err)
		}
		if probs := managerCheck(files); len(probs) > 0 {
			t.Errorf("%s:\n  %s\n%s", name, strings.Join(probs, "\n  "), files["manifest.json"])
		}
		// and it reads back with all its variants
		im, err := ReadMod(Files(files), "x")
		want := len(m.Variants)
		if len(m.Options) > 0 {
			want = 2 // the styles: Red, Blue
		}
		if err != nil || len(im.Variants) != want {
			t.Errorf("%s: read back %v, %d variants", name, err, len(im.Variants))
			continue
		}
		// options: the layout back (the armor's two choices, the cape a switch), every variant layering both
		if name == "options" {
			l := im.Layout
			if len(l) != 2 || l[0].Name != "Armor" || strings.Join(l[0].Choices, ",") != "Red,Blue" || l[0].ChoiceDescription["Red"] != "red" ||
				l[0].ChoiceImage["Red"] == nil || l[0].Image == nil || len(l[1].Choices) != 0 || len(l[1].Parts) != 1 || l[1].Parts[0] != 0x1111111111111111 {
				t.Errorf("options layout: %+v", l)
			}
			for _, v := range im.Variants {
				if len(v.LUTs) != 2 {
					t.Errorf("options: variant %q has %d LUTs, want the armor's and the cape's", v.Name, len(v.LUTs))
				}
			}
		}
		// with the mod page: the icon, the choice, the variants' descriptions and pictures
		if name == "variants" && (im.Icon == nil || im.OptionName != "Armor color" || im.OptionDescription != "Pick a color" ||
			im.OptionImage == nil || im.Variants[0].Description != "red" || im.Variants[0].Image == nil) {
			t.Errorf("%s: mod page not read back: icon %v, option %q / %q / %v, variant 0 %q / %v", name, im.Icon != nil,
				im.OptionName, im.OptionDescription, im.OptionImage != nil, im.Variants[0].Description, im.Variants[0].Image != nil)
		}
	}
	// the checker itself: a broken manifest is caught
	bad := map[string][]byte{"manifest.json": []byte(`{"Version":1,"Guid":"x","Name":"n","Options":[{"Name":"o","SubOptions":[{"Name":"s","Description":"","Include":["missing"]}]}]}`)}
	if probs := managerCheck(bad); len(probs) < 4 {
		t.Errorf("a broken manifest passed: %v", probs)
	}
}
