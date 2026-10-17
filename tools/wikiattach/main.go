// wikiattach: dev tool (not shipped). Fetches the community wiki's per-weapon attachment table (which attachments
// each weapon offers and the weapon level that unlocks them; the game's client data has no such list) and writes
// game/wikiattach.json, embedded by LUT Studio.
//
//	go run ./tools/wikiattach [out.json]
//
// Source: the Helldivers Wiki (helldivers.wiki.gg), page "Module:Weapon Attach/data weapons.json", the data behind
// its {{Attachments Table}} template. Wiki content is CC BY-NC-SA 4.0: the output keeps the attribution and license.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	page = "Module:Weapon Attach/data weapons.json"
	api  = "https://helldivers.wiki.gg/api.php"
	ua   = "LUTStudio-dev/wikiattach (Helldivers 2 LUT editor; reads one data page)"
)

type entry struct {
	Lvl  json.RawMessage `json:"lvl"`
	Cost string          `json:"cost"`
}

// Out is game/wikiattach.json: weapon (the wiki's key: the name without its designation, upper case) ->
// attachment name (upper case, as the wiki writes it) -> unlock level.
type Out struct {
	Source   string                    `json:"source"`
	Revision int64                     `json:"revision"`
	Edited   string                    `json:"edited"`
	Fetched  string                    `json:"fetched"`
	License  string                    `json:"license"`
	Weapons  map[string]map[string]int `json:"weapons"`
}

func get(q url.Values, v any) error {
	req, _ := http.NewRequest("GET", api+"?"+q.Encode(), nil)
	req.Header.Set("User-Agent", ua)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if r.StatusCode != 200 {
		return fmt.Errorf("%s: %s", r.Status, b)
	}
	return json.Unmarshal(b, v)
}

func main() {
	out := "game/wikiattach.json"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	// the page's current revision: its text, id and time
	var rev struct {
		Query struct {
			Pages []struct {
				Revisions []struct {
					RevID     int64  `json:"revid"`
					Timestamp string `json:"timestamp"`
					Slots     struct {
						Main struct {
							Content string `json:"content"`
						} `json:"main"`
					} `json:"slots"`
				} `json:"revisions"`
			} `json:"pages"`
		} `json:"query"`
	}
	err := get(url.Values{"action": {"query"}, "prop": {"revisions"}, "titles": {page}, "rvprop": {"ids|timestamp|content"},
		"rvslots": {"main"}, "format": {"json"}, "formatversion": {"2"}}, &rev)
	if err != nil {
		fail(err)
	}
	var text string
	o := Out{Source: "https://helldivers.wiki.gg/wiki/" + strings.ReplaceAll(page, " ", "_"), Fetched: time.Now().UTC().Format(time.RFC3339),
		License: "Helldivers Wiki contributors, CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)",
		Weapons: map[string]map[string]int{}}
	for _, p := range rev.Query.Pages {
		if len(p.Revisions) == 1 {
			text, o.Revision, o.Edited = p.Revisions[0].Slots.Main.Content, p.Revisions[0].RevID, p.Revisions[0].Timestamp
		}
	}
	if text == "" {
		fail(fmt.Errorf("page %q not found", page))
	}
	var data map[string]map[string]entry
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		fail(fmt.Errorf("page text: %w", err))
	}
	n := 0
	for w, items := range data {
		m := map[string]int{}
		for name, e := range items {
			s := strings.Trim(string(e.Lvl), `"`) // a number, sometimes written as a string
			lvl, err := strconv.Atoi(s)
			if err != nil {
				fmt.Fprintf(os.Stderr, "%s / %s: level %s, kept as 0\n", w, name, e.Lvl)
			}
			m[strings.ToUpper(strings.TrimSpace(name))] = lvl
			n++
		}
		o.Weapons[strings.ToUpper(strings.TrimSpace(w))] = m
	}
	b, _ := json.MarshalIndent(o, "", "  ")
	if err := os.WriteFile(out, append(b, '\n'), 0o644); err != nil {
		fail(err)
	}
	var ws []string
	for w := range o.Weapons {
		ws = append(ws, w)
	}
	sort.Strings(ws)
	fmt.Printf("%s: %d weapons, %d attachments (revision %d, %s)\n%s\n", out, len(ws), n, o.Revision, o.Edited, strings.Join(ws, ", "))
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "wikiattach:", err)
	os.Exit(1)
}
