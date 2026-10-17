# Testing LUT Studio

```
python tools/test.py            # everything (unit + install + e2e)
python tools/test.py unit       # no game needed
python tools/test.py install    # + tests that read the game install
python tools/test.py e2e        # + the real app in headless Chrome
```

Exit code 0 = all passed; a summary lists each step. Tests never touch the user's settings, recent projects, looks
or projects: settings go to a scratch folder (`LUTSTUDIO_CONFIG_DIR`), projects to scratch folders, the install is
only read. The install tier uses its own index cache (`LUTSTUDIO_CACHE_DIR`); the e2e tier shares the user's cache of
exported models and textures (derived data, safe to share, and slow to rebuild). On failure the scratch folder is
kept and its path printed.

The game is found through `LUTSTUDIO_GAME` or Steam's default path; without it the install and e2e tiers are skipped
(reported as skipped, not failed). The e2e tier needs Node 22+ and Chrome, Edge or Chromium.

## What each tier covers

**Unit** (`go test ./...` without `LUTSTUDIO_GAME`, `node --test tools/jstest/web.test.mjs`, plus `gofmt`, `go vet`,
`node --check` on every web file):

| Package | Tests |
|---|---|
| `lut` | schema covers every LUT channel once; the build mark (only column 20's r, g, b change, it survives the half-float encoding, unmark restores the game's values, cape LUTs are left alone); parse errors are specific; hex colors; shortest numbers; `hd2-lut/1` migration; R16F and R32F LUT decoding; whole-number fields keep fractions (mods use `paint.mode` 0.1); LUT kinds by size; with `LUTSTUDIO_LUTS` set: 353 vanilla LUTs round-trip byte-exact |
| `modpack` | patch archive round trip; mod zip with variants; every shape of mod zip LUT Studio builds (one variant with or without its picture; several, with pictures, the choice's picture, folder names over 29 characters) passes the mod managers' checks (`TestManifestManagers`: HD2 Mod Manager's v1 manifest reader and path checks, HD2 Arsenal's name limits), including mods with several options (switches and choices), read back with their layout; wanted textures (decal sheets) read whole; reading mods: LUT Studio's zips, loose SDK patch files (pixels from `.stream`), overhauls (options layered, sub-option styles as variants, single sub-options no style), legacy manifests, no manifest, later patch wins |
| `project` | create / load / save (incl. the kit a project was made from); refuses non-projects and other formats; folder names; GUIDs; documents: broken and duplicate files are problems, a changed file is re-read, callers get copies |
| `appcfg` | settings and cache folders follow the overrides; recent list newest first, no duplicates, at most 12; projects folder |
| `game` (index) | kit keys: an armor + helmet share a name key, same-named versions get `kit:<id>`; `ByKey`, `ByID`, `Find`; LUT parts with piece kinds (armor, undersuit, pattern, cape, cape trim, vehicle) and users |
| `server` | guards (no game: 503, no project: 409); the project workflow over HTTP: open, recent list, state, document edit (rounded to half precision, wrong sizes refused), new variant copies, rename, export + import; the mod page's endpoints (pictures, variants renamed, reordered, deleted to `.trash`); schema (the build mark's channels hidden) and saving a LUT keeping them at the project's values; looks; zone roles (suggestions from the game values with and without coverage, colors weighed by their parts' surface; unknown roles and non-hash keys refused, saved, forgotten, exported over the built-in `roles.json`, which must itself be valid); project names unique (a copy named like a listed project refused, imports get "name 2", a new project never writes into an existing folder, a recent project hidden as a copy only when it has the same GUID); label helpers (natural sort, color names, unnamed kits); quitting when the last page closes (and not on a reload, not when off) |
| JS (`tools/jstest`) | part names (`slotList`), vehicle mounts, the mesh loader picking a skin's material variant and skipping destroyed meshes, texture slots set to the zero hash read as unset, material slots named or only hashed, moving parts to mount nodes, every built-in look naming only real LUT fields and writing only its zone, saved looks of another LUT kind refused, the role view's colors, looks imported from the Paydex LUT Editor's row presets (kind from the row width) and LUT Studio's own looks files |

**Install** (`LUTSTUDIO_GAME` set; read-only):

| Test | |
|---|---|
| `game.TestAssetsFromInstall` | unit glb export (the Bastion's cannon without its LODs), textures, the detail array, the BRDF LUT |
| `game.TestCapeLUTRoundTrip` | every cape and cape material LUT encodes byte-exact |
| `game.TestPoses` | the armory poses decode with named bone tracks |
| `game.TestEnvironments` | the game's lighting cubes decode with all mips, HDR kept |
| `game.TestIndexVehiclesWeapons` | 198 vehicle skins (Standard included), the Patriot with both arms, 699 weapon kits, 561 paint-scheme kits |
| `game.TestPatternDrawn` | True Blue's shared beige pattern LUT has no mask on any vehicle skin: its users list only armors and helmets (the AF-91 among them) |
| `game.TestGearKits` | every other unit with LUTs of its own is a kit with pieces: throwables (Frag Grenade, Throwing Knife), attachments (Muzzle, 9 models), stratagems (Hellbomb, Turret), gear (Chemgun), craft (Eagle Bomb), the crew, Automatons (Berserker), world props; 60+ unnamed units named, at most 30 left unnamed, 10+ armor pieces; the CQC-1 One True Flag has its cloth's cape LUT |
| `game.TestSEAFAndBastion` | the SEAF kits (soldier, cargo backpack, artillery shells); the Bastion's skins show its cannon, its piece slot named by hash as the preview reads it |
| `game.TestSameModel` | unnamed kits matched to the named kit of their models: the SC-34 Infiltrator and SC-30 Trailblazer Scout helmet recolors, a GS-17 Frontier Marshal with its colors |
| `server.TestProjectList` | the start page lists 15 projects when the recent list holds 12: the recent ones first, then the rest of the projects folder |
| `game.TestWeaponParts` | the SG-8S Slugger and SMG-72 Pummeler show their own models, CQC-42 its machete sheath; no muzzle is a kit of its own |
| `main.TestEndToEnd` | for an armor, a cape, a vehicle skin and a weapon paint scheme: new project, a fresh project refuses to build, one color edit, `check` finds exactly that LUT, `build` writes the zip, the zip reads back with the edit (material LUTs with the build mark), importing it makes a project holding the edit (mark taken out, the report says made with LUT Studio) |
| `main.TestTheme` | a theme on every helmet (a primary and a cloth look on their roles, the helmets' LUTs added to a new project): nearly every LUT's suggestions come from its parts' ID masks, a themed zone holds the look (the build mark's channels excepted), a zone changed by hand is kept when the theme is applied again with another look, and replaced with overwrite |
| `main.TestThemeCapeTrim` | a theme with a trim look on every cape: each cape design LUT's trim color (column 0's RGB) takes it, the rest of the design keeps the game's values |
| `main.TestThemePatterns` | a theme with a trim look on every armor: each pattern LUT's patterned rows (mask layer not -1) take its color (column 0's RGB), rows without a pattern and the rest keep the game's values |
| `main.TestPosesSmooth` | every pose of the Pose menu (armory, moves, emotes) turns its bones smoothly: no rotation jumps more than 90° between two 30 fps samples |
| `main.TestKitLUTsExist` | every LUT of every vehicle and weapon kit reads from the install |
| `main.TestOptionsRoundTrip` | a mod with options: an armor LUT edited differently in two variants (an "Armor" choice) and a helmet LUT in one (a "Helmet" switch); the zip reads back with both options and their parts, importing it makes a project with the same options and each choice's edit, which builds |
| `main.TestImportTextures` | a cape project with its design (RGBA8) and decal sheet (BC3) edited and an unchanged second variant: the build leaves that variant out, the zip read back with the editable textures asked for holds both, importing it makes a project with both close to the edits |
| `main.TestMaskArray` | a two-layer ID mask (a texture array) re-encoded from its own pixels (layers stacked, as the editor saves them) keeps the game's header and layout, and both layers decode back exactly |
| `main.TestPlaceholderDesign` | a 512 x 512 design for the 4 x 4 placeholder several capes share becomes a 512 x 512 RGBA8 texture under the placeholder's name (with a game design's header of that size) and decodes back exactly |
| `main.TestSheetResource` | edited decal sheets and cape designs re-encode in the game texture's format (RGBA8, BC3, BC7) and layout, decoding close to the original |

**E2E** (`tools/e2e.mjs`: the built app on a random port, headless Chrome over CDP):
The e2e tier builds the app as it is released (`-tags noembed`: no data-library tables, items from the item
table). It also checks that the editor fits a 1000x650 window without page scrolling, and that the side lights
switch and turn, and that **+ Item** picks by category (armor: the matching-helmet box) and adds a cape; it removes
its scratch folder when done. The start page lists every group (armor sets, helmets, capes, vehicles, weapons, attachments, gear, backpacks,
throwables, stratagems, SEAF, Eagle & craft, ship crew, Automatons, Illuminate, objectives, Super Destroyer,
world props, unnamed units) with no page errors; then for an
armor, a cape, a vehicle skin (the Patriot, arms mounted, its decals), a weapon paint scheme (attachment menus: the game's list, then All) a backpack (the Guard Dog, drone and gun included), the SEAF soldier, a throwable (Frag Grenade), a stratagem
(the Hellbomb) an Automaton (the Berserker) and the CQC-1 One True Flag
(its cloth's cape LUT in the project and on screen): the project is created, the
editor loads the model (parts > 0), the LUT list fills, no page errors, a
look applies to a zone and is saved, the **Build** button (icon rendering included) builds the mod, the zip
downloads, and the built mod imports back as a project. The texture editors are driven with real mouse and
keyboard input: on the cape, the cape design editor (a brush stroke, Ctrl+Z / Ctrl+Y, a fill, saved and served to
the preview); on the vehicle, the decal editor (an area, an image placed through the file dialog as a layer, moved and
turned, applied, Ctrl+Z / Ctrl+Y, saved); both are in the built mod. On the A-35 Recon (its own case), the pattern mask editor: the hips' pattern (on), its thigh band erased on the model, saved. On the armor, the ID mask editor: an armor part, a stroke on the flat view and one on the model (the view changes), saved with the mask's layers; then the Roles panel: zones suggested, the role view on the model, a click on the model sets a zone's role, **Confirm** saves the roles, **Next unconfirmed** shows another item, closing restores the model's LUTs; then the Theme panel: looks per role from the zones on screen, applied to the mod's own items, the LUTs reloaded with the theme, the review steps to an item. The **Decal number** box and the **Damage**
slider redraw without page errors (the vehicle: number off, damage on; the SEAF soldier: numbers 0-3, no damage). Screenshots of each step go to the scratch
folder.

## Checking the zone roles by eye

`tools/rolecheck.mjs` renders items in their game look next to a test recolor by role, in colors no stock outfit
uses (primary electric cyan, secondary hot pink, trim lime, cloth violet; patterns and camo too), and pages them into
contact sheets. Run it after changing the role rules or the built-in `server/roles.json`, and for new items after a
game update: a big part left in a normal military color is metal (hardware), a role a theme leaves alone, or a miss.

    node tools/webserve.mjs 8790
    node tools/rolecheck.mjs <out dir> <Armor|Helmets|Capes|Backpacks|Weapons|Vehicles|Equipment|Stratagems|"Eagle & craft"> [name…]

## Not covered (by design or yet)

- Pixel accuracy of the shaders against the game's own compiled shaders: checked with separate tooling that needs
  game-derived reference data (not part of this repo).
- In-game behavior of built mods (by design: tests never launch or touch the game).
- The item table against the game: `TestTableMatchesDataLibrary` (install tier) compares `data/table.json.gz`
  with the index and attachment menus built from the data-library tables of the same install (skipped when the
  table is for another game build). No test goes online.
- Mods from other authors (their files can't be shipped): `tools/modprobe` shows what a downloaded mod contains.
  Checked by hand 2026-10-16: 35 downloaded mods imported and built back into mods: 26 build (weapon packs, Chrome
  armor and arsenal overhauls, HAA, Make It Yellow, vehicles, capes; 8 bring decal sheets or a cape design), one
  ships only copies of the game's LUTs (nothing to build), eight have no LUTs at all (models, gameplay data).

The install tests share one opened, indexed install (`game/install_test.go`: building the index takes seconds);
the e2e tests share one browser profile, so after the first page load the install's index comes from its cache.
