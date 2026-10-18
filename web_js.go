//go:build js && wasm

package main

// The website: LUT Studio runs in the browser. This is its API, in a Web Worker (web/worker.js): the worker's file
// system (web/gofs.js) mounts the Helldivers 2 folder the user picked at /game (read-only) and the browser's
// private storage at /home (projects, settings, the model cache); the page's /api requests arrive through
// lutstudioRequest and are answered by the same handlers (server.Server) the exe served over HTTP.

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"syscall/js"
	"time"

	"lutstudio/appcfg"
	"lutstudio/game"
)

// webGameDir: where web/gofs.js mounts the picked install folder (the one holding data/)
const webGameDir = "/game"

func main() {
	os.Setenv("HOME", "/home")
	os.Setenv("LUTSTUDIO_CONFIG_DIR", "/home/config")
	os.Setenv("LUTSTUDIO_CACHE_DIR", "/home/cache")
	os.Setenv("TMPDIR", "/home/tmp") // (temporary files, e.g. a big mod upload's: where the browser's file system allows)
	os.MkdirAll("/home/tmp", 0o755)
	e := &env{out: os.Stdout, gameDir: webGameDir}
	// the install's file index, kept between page loads (game/datadircache.go)
	game.DataDirCache = "/home/cache/index"
	// the loading bar (bridge.js): how far opening the install is, at most every 100 ms
	var last time.Time
	game.OpenProgress = func(done, total int) {
		if done < total && time.Since(last) < 100*time.Millisecond {
			return
		}
		last = time.Now()
		js.Global().Call("postMessage", map[string]any{"type": "progress", "done": done, "total": total})
	}
	srv, _ := e.newServer()
	h := srv.Handler()
	promise := js.Global().Get("Promise")

	// lutstudioRequest(method, url, contentType, body Uint8Array | null) -> Promise<{status, headers, body}>
	js.Global().Set("lutstudioRequest", js.FuncOf(func(_ js.Value, args []js.Value) any {
		method, url, ctype, jsBody := args[0].String(), args[1].String(), args[2].String(), args[3]
		var body []byte
		if !jsBody.IsNull() && !jsBody.IsUndefined() {
			body = make([]byte, jsBody.Get("length").Int())
			js.CopyBytesToGo(body, jsBody)
		}
		// (the executor holds the request body: freed once it has run, else every body stays in memory)
		var exec js.Func
		exec = js.FuncOf(func(_ js.Value, pr []js.Value) any {
			defer exec.Release()
			resolve := pr[0]
			go func() {
				req := httptest.NewRequest(method, url, bytes.NewReader(body))
				if ctype != "" {
					req.Header.Set("Content-Type", ctype)
				}
				rec := httptest.NewRecorder()
				// a panic in a handler answers 500 (as net/http's server would) instead of ending the whole program
				func() {
					defer func() {
						if v := recover(); v != nil {
							rec = httptest.NewRecorder()
							rec.WriteHeader(500)
							fmt.Fprintf(rec, "internal error: %v", v)
						}
					}()
					h.ServeHTTP(rec, req)
				}()
				resolve.Invoke(response(rec.Result()))
			}()
			return nil
		})
		return promise.New(exec)
	}))

	// lutstudioOpenGame() -> Promise<error string | "">: (re)open the install mounted at /game
	js.Global().Set("lutstudioOpenGame", js.FuncOf(func(_ js.Value, _ []js.Value) any {
		return promise.New(js.FuncOf(func(_ js.Value, pr []js.Value) any {
			resolve := pr[0]
			go func() {
				g, idx, assets, err := srv.OpenGame(webGameDir)
				srv.SetGame(g, idx, assets, err)
				if err != nil {
					resolve.Invoke(err.Error())
					return
				}
				srv.SetNotices(staleNotices(g))
				resolve.Invoke("")
			}()
			return nil
		}))
	}))

	// lutstudioSetProjectsDir(path): where new projects go and which folder the start page lists ("" = the browser's
	// storage, /home/Documents/LUT Studio; "/projects" = the folder on disk the user chose, web/gofs.js)
	// -> Promise (the settings file is written in a goroutine: file calls can't block a JS callback)
	js.Global().Set("lutstudioSetProjectsDir", js.FuncOf(func(_ js.Value, args []js.Value) any {
		dir := args[0].String()
		return promise.New(js.FuncOf(func(_ js.Value, pr []js.Value) any {
			go func() {
				appcfg.Update(func(c *appcfg.Config) { c.ProjectsDir = dir })
				pr[0].Invoke()
			}()
			return nil
		}))
	}))

	js.Global().Call("lutstudioReady", version)
	select {}
}

// response: an HTTP response as {status, headers: {name: value}, body: Uint8Array}
func response(r *http.Response) js.Value {
	b, _ := io.ReadAll(r.Body)
	headers := map[string]any{}
	for k := range r.Header {
		headers[k] = r.Header.Get(k)
	}
	u8 := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(u8, b)
	return js.ValueOf(map[string]any{"status": r.StatusCode, "headers": headers, "body": u8})
}
