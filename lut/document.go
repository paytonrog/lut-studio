package lut

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// FormatID tags LUT documents (bump it when field names change).
const FormatID = "hd2-lut/2"

// Document is the editable form of one LUT: the texture plus what only people need (zone labels, a note).
type Document struct {
	LUT    string   // resource name, "0x" + 16 hex digits
	Kind   string   // "material" or "pattern"
	Note   string   // free text (where it came from, what it is for)
	Labels []string // material: one per zone (row); may be empty strings
	Tex    *Texture
}

func schemaFor(kind string) ([]Field, int, error) {
	switch kind {
	case "material":
		return Material, MaterialWidth, nil
	case "pattern":
		return Pattern, PatternWidth, nil
	case "cape":
		return Cape, CapeWidth, nil
	}
	return nil, 0, fmt.Errorf("unknown LUT kind %q (material, pattern or cape)", kind)
}

// KindOf guesses the kind from the texture width.
func KindOf(t *Texture) (string, error) {
	switch {
	case t.Width == MaterialWidth:
		return "material", nil
	case t.Width == PatternWidth && t.Height == 1:
		return "pattern", nil
	case t.Width == CapeWidth:
		return "cape", nil
	}
	return "", fmt.Errorf("%dx%d is not a material LUT (23 wide), pattern LUT (3x1) or cape LUT (16 wide)", t.Width, t.Height)
}

// Num formats a stored value with the fewest digits that read back as the same half float.
func Num(v float32) string {
	if v == float32(math.Trunc(float64(v))) && math.Abs(float64(v)) < 1e6 {
		return strconv.FormatFloat(float64(v), 'f', -1, 32)
	}
	for p := 1; p <= 9; p++ {
		s := strconv.FormatFloat(float64(v), 'g', p, 32)
		f, _ := strconv.ParseFloat(s, 32)
		if Round(float32(f)) == v {
			if strings.Contains(s, "e") { // JSON allows it, but people read these
				s = strconv.FormatFloat(f, 'f', -1, 64)
			}
			return s
		}
	}
	return strconv.FormatFloat(float64(v), 'g', -1, 32)
}

// MarshalJSON writes the document with fields in schema order, colors and recipes on one line.
func (d *Document) MarshalJSON() ([]byte, error) {
	fields, _, err := schemaFor(d.Kind)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	str := func(s string) string { q, _ := json.Marshal(s); return string(q) }
	fmt.Fprintf(&b, "{\n  \"format\": %s,\n  \"kind\": %s,\n  \"lut\": %s,\n", str(FormatID), str(d.Kind), str(d.LUT))
	if d.Note != "" {
		fmt.Fprintf(&b, "  \"note\": %s,\n", str(d.Note))
	}
	writeRow := func(indent string, row int, label *string) {
		b.WriteString("{\n")
		var lines []string
		if label != nil {
			lines = append(lines, fmt.Sprintf("%s  \"label\": %s", indent, str(*label)))
		}
		for _, g := range Groups {
			var parts []string
			for _, f := range fields {
				if f.Group != g {
					continue
				}
				parts = append(parts, fmt.Sprintf("%s    %s: %s", indent, str(f.Key), valueJSON(f, d.Tex, row)))
			}
			if len(parts) > 0 {
				lines = append(lines, fmt.Sprintf("%s  %s: {\n%s\n%s  }", indent, str(g), strings.Join(parts, ",\n"), indent))
			}
		}
		b.WriteString(strings.Join(lines, ",\n"))
		b.WriteString("\n" + indent + "}")
	}
	if d.Kind != "pattern" { // material and cape LUTs: one row per zone
		b.WriteString("  \"zones\": [\n")
		for y := 0; y < d.Tex.Height; y++ {
			label := ""
			if y < len(d.Labels) {
				label = d.Labels[y]
			}
			if label == "" {
				label = fmt.Sprintf("zone %d", y)
			}
			b.WriteString("    ")
			writeRow("    ", y, &label)
			if y < d.Tex.Height-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString("  ]\n}\n")
	} else {
		b.WriteString("  \"texel\": ")
		writeRow("  ", 0, nil)
		b.WriteString("\n}\n")
	}
	return b.Bytes(), nil
}

func valueJSON(f Field, t *Texture, row int) string {
	get := func(i int) string { lf := f.Leaves[i]; return Num(t.At(lf.Col, row, lf.Ch)) }
	switch f.Kind {
	case Color:
		return "[" + get(0) + ", " + get(1) + ", " + get(2) + "]"
	case Recipe:
		parts := make([]string, len(f.Leaves))
		for i := range f.Leaves {
			parts[i] = fmt.Sprintf("%q: %s", f.Sub[i], get(i))
		}
		return "{" + strings.Join(parts, ", ") + "}"
	}
	return get(0)
}

// ParseError lists every problem found, so a modder can fix a file in one go.
type ParseError struct{ Problems []string }

func (e *ParseError) Error() string { return strings.Join(e.Problems, "\n") }

// UnmarshalJSON reads a document. Every field is required (except the "unused" group, default 0); unknown keys are
// errors (they are almost always typos). Colors may be [r, g, b] or "#rrggbb".
func (d *Document) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var pe ParseError
	bad := func(format string, a ...any) { pe.Problems = append(pe.Problems, fmt.Sprintf(format, a...)) }
	var format string
	json.Unmarshal(raw["format"], &format)
	if format != FormatID && format != formatV1 {
		bad("format is %q, expected %q", format, FormatID)
	}
	json.Unmarshal(raw["kind"], &d.Kind)
	json.Unmarshal(raw["lut"], &d.LUT)
	json.Unmarshal(raw["note"], &d.Note)
	if _, err := ParseHash(d.LUT); err != nil {
		bad("lut: %v", err)
	}
	fields, width, err := schemaFor(d.Kind)
	if err != nil {
		bad("kind: %v", err)
		return &pe
	}
	allowed := map[string]bool{"format": true, "kind": true, "lut": true, "note": true}
	var rows []map[string]json.RawMessage
	if d.Kind != "pattern" { // material and cape LUTs: one row per zone
		allowed["zones"] = true
		if err := json.Unmarshal(raw["zones"], &rows); err != nil || len(rows) == 0 || len(rows) > 1024 { // (mods ship LUTs with more zones than the game's 8; modpack reads them up to maxLUTBytes)
			bad("zones: expected a list of 1-1024 zones")
			return &pe
		}
	} else {
		allowed["texel"] = true
		var r map[string]json.RawMessage
		if err := json.Unmarshal(raw["texel"], &r); err != nil {
			bad("texel: expected an object")
			return &pe
		}
		rows = []map[string]json.RawMessage{r}
	}
	if format == formatV1 {
		for _, row := range rows {
			migrateV1(row)
		}
	}
	for k := range raw {
		if !allowed[k] {
			bad("unknown key %q", k)
		}
	}
	d.Tex = New(width, len(rows))
	d.Labels = make([]string, len(rows))
	for y, row := range rows {
		where := "texel"
		if d.Kind != "pattern" { // material and cape LUTs: one row per zone
			where = fmt.Sprintf("zones[%d]", y)
			json.Unmarshal(row["label"], &d.Labels[y])
		}
		groups := map[string]map[string]json.RawMessage{}
		for k, v := range row {
			if k == "label" && d.Kind != "pattern" {
				continue
			}
			var g map[string]json.RawMessage
			if err := json.Unmarshal(v, &g); err != nil {
				bad("%s.%s: expected an object", where, k)
				continue
			}
			groups[k] = g
		}
		known := map[string]map[string]bool{}
		for _, f := range fields {
			if known[f.Group] == nil {
				known[f.Group] = map[string]bool{}
			}
			known[f.Group][f.Key] = true
			v, ok := groups[f.Group][f.Key]
			if !ok {
				if f.Group != "unused" {
					bad("%s.%s: missing", where, f.Path())
				}
				continue
			}
			vals, err := parseValue(f, v)
			if err != nil {
				bad("%s.%s: %v", where, f.Path(), err)
				continue
			}
			for i, lf := range f.Leaves {
				d.Tex.Set(lf.Col, y, lf.Ch, float32(vals[i]))
			}
		}
		for g, kv := range groups {
			if known[g] == nil {
				bad("%s: unknown group %q", where, g)
				continue
			}
			for k := range kv {
				if !known[g][k] {
					bad("%s.%s.%s: unknown field", where, g, k)
				}
			}
		}
	}
	if len(pe.Problems) > 0 {
		sort.Strings(pe.Problems)
		return &pe
	}
	return nil
}

const formatV1 = "hd2-lut/1"

// v1 -> v2 (2026-10-14): the same channels, renamed after the
// world-effects decode showed "smoothness" is roughness and the "clean" mask is metalness.
var v1Renames = []struct{ group, key, newGroup, newKey string }{
	{"shine", "smoothness", "shine", "roughness"},
	{"shine", "smoothness_vary", "shine", "roughness_vary"},
	{"secondary", "smoothness", "secondary", "roughness"},
	{"secondary", "smoothness_weight", "secondary", "roughness_weight"},
	{"clearcoat", "smoothness", "clearcoat", "roughness"},
	{"camo", "smoothness", "camo", "roughness"},
	{"camo", "smoothness_weight", "camo", "roughness_weight"},
	{"pattern", "smoothness", "pattern", "roughness"},
	{"cloth", "fuzz", "cloth", "rim"}, // before sheen -> fuzz
	{"cloth", "sheen", "cloth", "fuzz"},
	{"clean", "mask", "metal", "mask"},
	{"clean", "offset", "metal", "offset"},
}

func migrateV1(row map[string]json.RawMessage) {
	groups := map[string]map[string]json.RawMessage{}
	for g, v := range row {
		var m map[string]json.RawMessage
		if json.Unmarshal(v, &m) == nil {
			groups[g] = m
		}
	}
	for _, r := range v1Renames {
		if v, ok := groups[r.group][r.key]; ok {
			delete(groups[r.group], r.key)
			if groups[r.newGroup] == nil {
				groups[r.newGroup] = map[string]json.RawMessage{}
			}
			groups[r.newGroup][r.newKey] = v
		}
	}
	if len(groups["clean"]) == 0 {
		delete(groups, "clean")
		delete(row, "clean")
	}
	for g, m := range groups {
		b, _ := json.Marshal(m)
		row[g] = b
	}
}

func parseValue(f Field, v json.RawMessage) ([]float64, error) {
	switch f.Kind {
	case Color:
		var s string
		if json.Unmarshal(v, &s) == nil {
			return parseHex(s)
		}
		var a []float64
		if err := json.Unmarshal(v, &a); err != nil || len(a) != 3 {
			return nil, fmt.Errorf("expected [r, g, b] or \"#rrggbb\"")
		}
		return a, nil
	case Recipe:
		var m map[string]float64
		if err := json.Unmarshal(v, &m); err != nil {
			return nil, fmt.Errorf("expected {%s}", strings.Join(f.Sub, ", "))
		}
		out := make([]float64, len(f.Sub))
		for i, k := range f.Sub {
			x, ok := m[k]
			if !ok {
				return nil, fmt.Errorf("missing %q (needs %s)", k, strings.Join(f.Sub, ", "))
			}
			out[i] = x
			delete(m, k)
		}
		for k := range m {
			return nil, fmt.Errorf("unknown weight %q (has %s)", k, strings.Join(f.Sub, ", "))
		}
		return out, nil
	}
	var x float64
	if err := json.Unmarshal(v, &x); err != nil {
		return nil, fmt.Errorf("expected a number")
	}
	// Int fields take any number: the game compares them as floats (paint.mode 0.1 is "not 0..4"), and mods use such
	// values (CHROME - Armors), so they are kept, not refused
	return []float64{x}, nil
}

func parseHex(s string) ([]float64, error) {
	s = strings.TrimPrefix(s, "#")
	if len(s) != 6 {
		return nil, fmt.Errorf("color %q: expected \"#rrggbb\"", s)
	}
	n, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return nil, fmt.Errorf("color %q: %v", s, err)
	}
	return []float64{float64(n>>16&255) / 255, float64(n>>8&255) / 255, float64(n&255) / 255}, nil
}

// ParseHash reads "0x" + hex (or bare hex) as a 64-bit resource name.
func ParseHash(s string) (uint64, error) {
	t := strings.TrimPrefix(strings.ToLower(s), "0x")
	if t == "" || len(t) > 16 {
		return 0, fmt.Errorf("%q is not a resource hash (0x + 16 hex digits)", s)
	}
	return strconv.ParseUint(t, 16, 64)
}

func HashString(h uint64) string { return fmt.Sprintf("0x%016x", h) }
