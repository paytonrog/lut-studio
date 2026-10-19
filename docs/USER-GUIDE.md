# LUT Studio — user guide

LUT Studio recolors Helldivers 2 armor, helmets, capes, vehicles, weapons and backpacks by editing their
**material LUTs**: the small tables that decide each zone's colors, wear, roughness, metalness, camo, glow and
oil-slick sheen. Models and textures stay the game's own, so a LUT mod is tiny. Every change is visible
immediately, and one click builds a mod zip for HD2Arsenal / HD2 Mod Manager. It's a website: nothing to
install. It works in **Chrome, Edge or Firefox** on a computer (Safari and phones can't read a folder on your disk).

LUT Studio reads your game install in your browser and never changes it; your game files and projects are never
uploaded (the website sends anonymous usage events, see **Usage data** under Troubleshooting). It ships no game files (models, textures, LUTs); its
list of items is a small table of ids whose names come from your install (see **Updates** under Troubleshooting).

## Start

1. Open the LUT Studio website in Chrome or Edge. Your work is saved as you go, in the browser.
2. **Choose the Helldivers 2 folder…** (usually `C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2`),
   once per visit (the start page shows Steam's default folder with a **Copy** button: paste it into the folder window's address bar; on another drive, Steam's **Manage → Browse local files** shows where). The browser asks whether to "upload" the folder's files: they never leave your computer, LUT
   Studio only reads them in the page. The first time takes a little while (a loading bar shows it); later visits are quick.
3. **New project**: pick a **Category** (Armor, Helmets, Capes, Vehicles, Weapons, Backpacks, Equipment,
   Stratagems, SEAF, Eagle & craft, Ship crew, Automatons, Illuminate, Objectives, Super Destroyer,
   World props, Armor pieces, Unidentified), then the
   item (type in the filter box to narrow the list), name the project, **Create**. Each project needs a name of
   its own (the start page says when one is taken; an imported project or mod with a taken name gets "name 2"). An armor can start **with its
   matching helmet** (the box under the list); any other helmet can be added or shown later. Some capes share a
   name; the list shows each one with its cape model.
   **SEAF** soldiers change camouflage by planet: the soldier, the medic and their weapons (the SEAF Rifle, Defender
   and Machine Gun) are listed in each look: standard, **Jungle camo**, **Desert camo** and **Arctic camo** (the
   game picks one per planet; each look is a LUT of its own, so recolor every look you want changed).
   Items past SEAF are everything else in the game with colors of its own. The game doesn't name them, so their
   names come from file paths, or from the model's own name inside its file. **Armor pieces** are Helldiver armor
   parts that no armor set uses. **Unnamed** holds armor, helmets and capes the game has no name for (likely
   unreleased) that match nothing; one that uses another item's models is listed in its own category next to that
   item, its label saying so ("SC-34 Infiltrator model · …"). A model with no name at all is named after the best clue around it:
   "like X" (it shares X's colors), "with X" (it's loaded together with X), "in X" (a game package that holds it).
   Models known only by such a clue are under **Unidentified**.
   Every change is written as you work. In Chrome and Edge, **Keep them in a folder on disk…** on the start page keeps
   your projects in a folder on your disk (e.g. `Documents\LUT Studio`), where they're safe from clearing the
   browser's data; projects already in the browser are copied there. The browser may ask again on a later visit to
   allow access to it (**Allow access to your projects folder**). Without a folder (and in Firefox), projects live in the browser's storage
   for this site: clearing the site's data deletes them, so use **Project… → Export .lutproj** to keep a copy.
4. Next time, pick the project under **Your projects**: the ones you opened last come first, then every other
   project in the projects folder (type in the filter box when the list gets long).
5. **Vehicles and weapons** are in the same list: every exosuit (Patriot, Emancipator, Breakthrough, Lumberer),
   FRV (Gunner, Incinerator, Supply), tank (Bastion, Maelstrom), the Pelican, the hellpod and its weapon rack, in
   each of their skins (Standard is the default look); and every weapon, in its default look and in each paint
   scheme. A vehicle shows with its guns and parts on it (exosuit arms, the FRV's gun, the tanks' main guns, the
   Maelstrom's silos), each in the skin's LUT, which you edit like the body's. Many of these share LUTs: the three FRVs share their body LUTs per skin, the exosuits their body, and a
   weapon paint scheme's LUT recolors that scheme on **every** weapon. The **Materials** list tells you ("also changes …").
   Weapons show with their default attachments (magazine, scope, muzzle, underbarrel); a paint scheme recolors those
   too. The **Attachments** menus (under the view) put another attachment on the preview: the ones the game offers
   that weapon, each with the weapon level that unlocks it ("Drum Magazine · lvl 24"). These lists come from the
   Helldivers Wiki (the link next to the menus). Tick **All** to try every attachment that fits the weapon instead.
   An attachment's LUT is added to the project when you change it, like any other part. Decals show what the game
   shows at **Decal number** 0 (see the view controls below); vehicles have a **Damage** slider under **Mission wear**.
6. **Import a mod…** turns an existing recolor mod into a project you can keep editing: pick its .zip or .7z as
   you downloaded it (HD2 Mod Manager / HD2Arsenal), or its patch files (for a mod made with the HD2 SDK: select the `.patch_0` together with
   its `.gpu_resources` and `.stream`). Each option of the mod becomes a variant. Everything LUT Studio can edit
   comes in: the LUTs of every kind of item (armor, helmets, capes, vehicles, weapons and their attachments,
   backpacks, equipment, stratagems, SEAF…), LUTs of game materials no listed item uses (in the **Materials** list, shown on
   no model), and the mod's decal sheets, cape designs, ID masks and pattern masks (for the **Decals**, **Cape design** and **Masks** editors). The mod's
   identity (its GUID) comes in too, so building it again updates the installed mod instead of adding a second copy.
   Its icon, the variants' descriptions and pictures and the name of the choice come along to the **Mod page** tab.
   A mod with several options keeps them as the project's options (their parts, choices and pictures).
   Left out, and LUT Studio tells you what: models and other textures, and the LUTs of models the mod adds (the game
   has nothing to show them on). An option that only changed such files changes nothing in the project; the build
   leaves it out.
   Overhauls (one option per armor, players switch on many at once) come in as one project with all of them; their
   styles (e.g. Chrome, Cavalier) become the variants. In a big project the **Materials** list shows the item on screen;
   **Show all … LUTs** lists the rest.

Some names belong to several different armors: there are 9 armors and 15 helmets called **B-01 Tactical** (color
and model versions), and a few more like FS-05 Marksman. The list shows each one separately, numbered and with its
main colors, e.g. "B-01 Tactical (version 2 of 9, tan / gray, 0x1d0e3431)".

## How armor LUTs work

- An armor set is several **pieces** (helmet, torso, hips, arms, legs, shoulders), and a slot can be several
  models. Each piece wears one **LUT**; pieces can share a LUT (on the FS-37 Ravager the hips and legs share
  one). Editing a LUT recolors every piece that uses it. The **Materials** list on the left says, for each LUT:
  - what it colors: **Armor** (the armor plates), **Undersuit** (the body suit under the armor), **Accessory**
    (pouches, straps and other add-ons), **Pattern**, **Cape** / **Cape trim**, and on which body parts ("torso
    (stocky)" = only the stocky body's torso);
  - whether other armors use it too: "only on this armor", or "also changes A-35 Recon". Undersuits are
    sometimes shared by related armors. Hover an entry for the full list.
- Weapon attachments (scopes, muzzles, magazines) are recolored on the weapon: pick the attachment in its menu, then
  click it on the model; the first change adds its LUT to the mod. **Equipment** holds grenades, mines, stims and
  other gear that isn't part of a weapon.
- **+ Item** adds another item of any category to the same mod (e.g. a mod
  that recolors 2 or 3 armors): its LUTs are added to every variant with the game's colors. It picks like the
  start page: a category, then an item (type to filter, double-click to add); an armor can bring its matching
  helmet along. Switch between the mod's items with the **Show** menu.
- The **Show** menu at the top shows this mod's items first. An armor, helmet or cape goes on the Helldiver (see
  *Mix and match*); anything else (a vehicle, weapon, grenade, sentry…) is shown on its own. Under *Also changed by this mod* are the items that
  share a LUT with it (pick one to see how your edit looks on it). Items that only share a LUT used very widely
  (some pattern LUTs are on 48+ armors) are summed up in one line.
- A LUT has up to 8 **zones** (rows). A painted mask on each piece decides which pixel belongs to which zone.
  Zone 2 of the helmet LUT has nothing to do with zone 2 of the torso LUT. Click the model to pick a zone, or
  hover a zone in the list to see it highlighted. Give zones names; they are only for you.
- A few armors also have a **pattern LUT**: the color of painted stripes or emblems on some pieces (where they go
  is fixed by the model). LUT Studio adds it to the project only when the armor really has a pattern; it shows
  up as "Pattern LUT" in the list. Vehicle skins name pattern LUTs too but have nowhere to draw them, so they
  are left out (one of them would otherwise also recolor stripes on several armors).
- Some LUTs are shared with other armors. The editor and the build tell you ("recolors: …"). Changing a
  shared LUT recolors those armors too.

## Capes

Pick a cape from the start page's list (under *Capes*). A cape has two tables, both in the **Materials** list:
- **cape**: its material: colors, cloth look, wear, camo (the same fields as armor).
- **cape trim / gradient / decals**: trim lines along the panel edges, a color gradient from the collar or the hem,
  and up to 4 emblems (decals). **Pick emblem…** shows the cape's emblem sheet: choose a grid size and click an
  emblem; then set where it sits (placement), its size, rotation and opacity. Decal 1 must be on for decals 2-4 to
  show; decals appear on the outside of the cape only.

Cape zones are **front**, **R / G / B panel** (the painted panels of that cape's design) and **back** (the inside).
The panel shapes and the cape's outline come from the cape's design image, which LUT Studio can't edit yet.

**Mix and match**: the Helldiver wears what the **Armor**, **Helmet** and **Cape** menus (top bar) say: any armor,
any helmet (**Matching** = the armor's own) and any cape, each also **None**. The mod's own items are listed first.
A helmet-only project shows just the helmet until you pick an armor to put it on. Click any piece and change it:
its LUTs are added to the mod. LUT Studio remembers the combination per project.

**A cape on your armor**: in an armor project, pick a cape with **Cape** (top bar) to see the armor wearing it (it
follows the poses too). Click the cape (or a helmet you picked) and change it: its LUTs are added to the
project, so one mod recolors the armor and that cape or helmet together. Players still choose the cape in game; the mod changes how it looks
whenever it's worn.

## The editor

- **Fields** (right): every setting of the selected zone, grouped:
  - **paint**: main color and the material kind (0 standard, 1 cloth, 2–3 coated, 4 composite).
  - **detail**: the repeating surface texture (scratches, weave, dents…), its bump strength and size.
  - **secondary**, **wear**: a second color and the worn-paint colors, each with a *mask* that decides where
    it goes (weights for two grunge patterns, raised edges (+) / hollows (−), tucked-in areas).
  - **metal**: where the zone is bare metal (reflections take the paint color).
  - **shine**: roughness (0 mirror-like … 1 matte) and highlight strength.
  - **clearcoat** (modes 2–4), **cloth** (mode 1), **glow**, **iridescence** (oil-slick sheen, shows on dark
    colors), **camo** (4 colors on one of the game's camo patterns).
  Each field has a short explanation, a slider over its useful range and a **↺ vanilla** button. A color has its
  picker, its three numbers, a **#rrggbb** box (type or paste a color; `#rgb` works too) and **⌖** (click a zone on
  the model and the color takes that zone's own color; Esc cancels); the colors you used last are under it, one
  click to use again (kept in this browser).
- **The zone a material opens on**: a project opens on the armor's torso plates (else the first material listed),
  and a material on its main zone (its biggest primary zone, by its share of the model); once you pick a zone in a
  material, it opens on that one again.
- **Several zones at once**: Ctrl+click (Cmd on a Mac) zones in the zone list, or on the model, to edit them
  together; Shift+click selects every zone up to the one clicked. The panel says how many you're editing: a change
  to a field, **↺ vanilla**, **Paste zone**, **Reset zone** and a look go to all of them (a look: the settings it
  changes). **Just this one** goes back to one zone. Each zone in the list shows its role (primary, trim, cloth…),
  what a theme or **Recolor this item** gives it.
- **Looks**: under the zone, in categories. The built-in ones (Paint: matte / satin / gloss, lacquer; Metal: bare,
  brushed; Wear; Camo; Effects: glow, oil-slick; Cloth) set only what they're about. **Save look** keeps the zone's
  settings as a look of your own, with a name and a category (a new name adds one; the same name replaces it). One
  click applies a look; yours apply by **Apply**: everything, the finish only (all but the colors) or the colors
  only. ✎ renames a look of yours or moves it to another category, ✕ deletes it. Yours are kept in
  `LUT Studio looks.json` in your projects folder (on the website: in the projects folder on disk you chose on the
  start page; without one, in the browser only, as the panel warns). **Export…** saves them to a file (a backup, or
  to share), **Import…** brings looks in from such a file or from the Paydex LUT Editor's `row_presets.json`
  (**Paydex presets…** says where its file is: `%LOCALAPPDATA%\PaydexLutEditor`); a look you already have is
  skipped, a name taken gets a number, Paydex presets go in the *Paydex* category.
- **Copy / Paste / Reset zone**, **Ctrl+Z / Ctrl+Y** undo / redo, **Ctrl+S** save (autosave is on by default).
  Each variant keeps its own undo history while you work in another one, and a theme applied is one step in it:
  Ctrl+Z undoes the whole theme (as the Theme panel's **Undo theme**; a theme can't be redone, and only the last
  eight applied since LUT Studio started can be undone, the latest first).
- **This material as a file**: **.dds** (R16G16B16A16 float, the game's own format) or **.exr** (OpenEXR, half
  floats) saves the material's LUT as it is now, exactly, for other tools; **Import…** reads one back (a .dds in
  16- or 32-bit float RGBA, an .exr uncompressed, RLE, ZIP or ZIPS, half or float) into this material when it is
  the same size. Ctrl+Z undoes it; LUT Studio's hidden mark channels keep the project's values.
- **Snapshot ▾ → Save image (PNG)** saves the view as it looks now (its light, pose, mission wear and view), at
  twice its size on screen; **Save image, no background** the same without the sky or backdrop (transparent).
- **Moving around**: drag to rotate, right-drag (or Shift+drag) to pan, the mouse wheel to zoom, double-click to
  frame the armor again. **Camera** has fixed views; **Turntable** spins it. **Armory: overview / armor / helmet /
  cape** are the game's Armory screen cameras (its per-tab distances and heights, a narrow 22.5° view, the
  character turned 20° to its right; the cape tab from behind); switching between them glides over 0.25 s, as the
  game's tabs do.
- **Light**: *From the game* uses the game's own lighting captures and lights. **Armory (menu)**, the default, is how the game's
  Armory screen lights the character: its four lights that turn with the camera (a warm key from the front left, a
  strong cool rim from behind, a dim cool fill, a warm bounce from below; each casts a soft shadow when **Shadows** is
  on), the ship's reflections, the dimmed backdrop behind the menu and the screen's
  own output (no exposure; matched against an in-game screenshot). **Warbond reward showroom** is the studio rewards are
  shown in (a black box, its five spot lights) and **Ship customization chamber** the ship's chamber (its light
  above the center, the ship's exposure). Also the **Super Destroyer** hub and interior, a **desert planet** by day and **space**, shown behind the armor
  and in its reflections, and lit with the game's own lighting math (see Accuracy). *Planets* lights the armor as
  a planet biome does by day: its sun's color, the game's auto exposure aimed at the planet's ground, and the
  planet's own color grading and the game's screen output (from the game's environment settings and shaders); in the
  Showcase the squad stands on a patch of the planet's ground (its terrain textures, in their graded colors, with its
  snow), so you can judge a camo against it (in the editor too, under the armor, with soft shadows). Next to it, **Weather** picks one of the planet's weathers (clear, misty, overcast, rainstorm, snowstorm…; the share of missions it is estimated at): its sun, sky light and fog, and it sets Mission wear's **Wetness** and **Snow** as the weather does; armor snow takes the planet's snow color. **Adjust ▾ > Planet scenery** (on by default) puts a simple stand-in for the planet around it: gentle hills of its ground, flat where you stand, and its big props as the game's map pieces place them, by how much of the view each takes: the game's own rocks, rock formations, moss and roots in their colors (their surface from the biome's rock texture), its own trees and palms, and around your feet tufts of its grass, moss and heather and small stones in their colors. It is not the game's terrain (made as a mission loads) or layout. The sky is LUT Studio's (the game's is computed as it runs), tinted
  toward the planet's fog. The other presets are LUT Studio's own light setups (snow, jungle, night…), lit the same way. **Adjust ▾** next to it holds the rest:
  **Exposure**; the **Sun** (in a game environment: a key light at the capture's brightest spot) with **On**, its
  **Direction** around the armor (at first from the front) and **Height** (45° at first; each lighting preset sets its own height until you move it);
  **Shadows**; and LUT Studio's two side lights, **Blue light** and **Yellow light** (cool on the left, warm on the
  right), off at first: tick them on and set each one's direction (0° = from the camera, 90° = right, 180° =
  behind, 270° = left) and height. LUT Studio remembers your side lights. **Reset** puts the whole menu back as it starts.
- **Pose**: the Armory's first idle at first. With a pose that holds a weapon (the Armory's, the moves), a menu beside it picks the weapon in the Helldiver's right hand (none at first; the left hand stays where the pose puts it); click the weapon to edit its LUTs like any piece's. The Armory menu's light turns the side lights on and the sun off; any other light (a planet's, the others) the sun on and the side lights off.
- **Camera** presets, **Frame** and **Turntable**; **View**: the final look, or debug views that show
  each mask on its own (zones, wear, metalness, roughness, dirt, wetness…); **Before | after** splits the screen
  (the game's look on the left: its colors, patterns, masks, decals and cape designs; your edits on the right).
- **Pose**: play one of the game's animations instead of the T-pose: **Armory** (the armory idles and variations,
  and the poses the game shows armor sets in, named after their set, e.g. *A-9 Helljumper pose*), **Moves** (stand,
  walk, jog, sprint, crouch, crouch walk, crawl, downed, swim: played in place) and **Emotes** (by their in-game
  names: Casual Salute, Lockstep, Display of Brawn, Hug, High-Five, the handshakes, Squat, Super Person, Head Tap…;
  synced emotes as their waiting pose; a few the game has no name for stay numbered);
  ▶ / ❚❚ plays or pauses, the slider picks a moment. The mod icon is rendered in the armory idle pose.
- **Mission wear**: dirt, mud, blood, bug gunk, wetness, snow, frost, burn, scorch, with the game's own formulas,
  to check how your colors hold up in a mission. (Blood and gunk only appear above about 0.5, as in the game.)
  Vehicles add **Damage** (the game sets it from the vehicle's health: 0 = undamaged, 1 = destroyed): dents and
  patches of bare gray metal from the start, and past half, darker, rougher worn spots, on the zones the material
  lets take damage. **Clean** sets everything back to 0. Click **Mission wear** to fold the sliders away and give
  the view more room.
- **Decal number** (models with a decal sheet): the game gives each model a number that, on some materials, moves
  the decal to another cell of the sheet. Only the SEAF soldier uses it: the game sets it per soldier type, so the
  left shoulder badge shows the soldier's role: 0 rifleman, 1 heavy weapons (MG-43 and EAT-17), 2 radio operator,
  3 medic (the label next to the box says which). Vehicles and most armor don't use it (their materials move
  nothing), so the box is off there.
- **The right panel** keeps its place when you pick another zone: same scroll position, and the sections you
  opened or closed stay that way.
- **Changes** (a sidebar tab): every zone of this variant that differs from the game, by material, with what changed
  in it (paint, wear, camo…) and its color before → now. Click one to edit it; **↺** puts it back as the game has
  it. It follows your edits as you make them.
- **The sidebars' tabs**: each sidebar has its own pane (**Materials** on the left: the materials (LUTs) and their zones, each zone tagged with its role (primary, trim, cloth…); **Zone** on the
  right: the picked zone's settings) and the editors' tabs: **Theme**, **Mod page**, **Decals**, **Cape design**,
  **Masks** and **Changes** on the left, **Showcase** on the right (only the editors the item on screen has are shown). An editor
  opens in the sidebar its tab is in, in place of that sidebar's pane; the pane's own tab (**Materials** or **Zone**)
  closes it. One editor is open at a time. To put a tab in the other sidebar, drag it there (or to another place in
  the same strip), or right-click it; where the tabs are is kept in this browser.
- **Decals** (models with decals: armor, vehicles, the hellpod…): edits the decal sheet, the picture the
  model's emblems, numbers and markings are cut from. It opens in a sidebar, so you can keep turning the model,
  which shows your edit as you go. Drag to select an area (snapped to the **Grid**, or free with *none*), then
  **Place an image…**: it's fitted into the area and stays movable: drag it, scale it by its corner (or the mouse
  wheel), **Turn** / **Size** / **Flip** it, then **Apply** (the area is cleared first unless you untick it). **Erase
  area** clears it. **Undo** / **Redo** (Ctrl+Z / Ctrl+Y) step through your changes. **model layout** draws where
  the model's decals sit on the sheet; **highlight the area on the model** paints the selected area bright pink on
  the model, to find which part of the sheet shows where. **Zoom** for small emblems. **Export PNG** / **Import
  PNG…** to edit the whole sheet in another program. **Save**: the next build includes it. Each variant has its
  own sheet, and **Back to the game's sheet** undoes it. A sheet is shared by many items: your change shows on every
  one that uses it while the mod is on.
- **Cape design** (capes): where the cape's zones are and where its cloth is cut out (the zones' colors, trim
  lines and emblems are in the cape's LUTs). Pick **Zone 0-3**, **Cut out** or **Restore cloth** and paint with the
  brush, or tick **fill an area instead** and click an area. **Import a picture…** gives each main color of an image
  a zone (or cuts it out); **Export template** saves the design in the editor's colors (gray zone 0, red 1, green 2,
  blue 3, transparent cut out) to paint over elsewhere and import again. The model shows it as you go, and the trim
  lines follow your new shapes. The back of the cape is always zone 4, except where zone 1 is. Each cape has its
  own design, so a change affects only that cape. Undo / redo, save and **Back to the game's design** work as for
  decals. A few capes have no design of their own: the game gives them a tiny placeholder (one zone everywhere),
  shared by several capes. For those, **Start a 512 × 512 design** makes a full design to paint, starting as the
  placeholder looks; the editor lists the capes that share the placeholder, since the new design shows on all of
  them.
- **Masks** (armor, helmets, vehicles, weapons…): **Edit** *zones (ID mask)* or *pattern areas (pattern mask)*. Zones: where each **zone** of a part is: the painted mask that decides
  which row of the part's LUT each spot uses. Pick the **Part** (named by its LUT: "Armor: left arm, right arm", or
  the undersuit under it), pick a zone (the buttons show the zones' LUT colors and names), and paint: on the model
  itself (**paint on the model**: left drag paints, right drag turns the view, the wheel zooms) or on the flat view
  (with the model's layout drawn over it). **fill an area** fills the connected area of one zone. The model shows
  the change as you go. **Export picture** saves the zones in their colors to paint over elsewhere; **Import a
  picture…** gives each pixel the zone of the nearest zone color. Undo / redo, **Save** and **Back to the game's
  mask** as for decals. A left and right pair of parts (arms, shoulders, legs) share one material, so one mask:
  both sides change together. A part has as many zones as its LUT has rows (at most 8: its mask's two layers).
  *Pattern areas*: where a part's pattern shows (the pattern LUT's color, e.g. the A-35 Recon's blue thigh band, on
  its hips): paint **pattern** or **no pattern** the same ways. Only parts that have a pattern mask are listed (most
  parts share the game's empty one, which can't be edited without touching them all); when the part's pattern is
  switched off (its pattern LUT is the game's "off" LUT), the editor says so and nothing shows until it's on.
- **Roles** tab (for reviewing LUT Studio's built-in roles: shown when the site is opened with `?review` at the end of its address, `?review=0` hides it again; the **Armor** group hides the undersuit, **Undersuits** shows only the undersuit, confirmed once for every armor sharing it): what each zone is on its item: **primary** (main plates), **secondary**, **trim** (edges, stripes,
  accents), **cloth**, **hardware** (bare metal), **glow**, **keep** (a theme leaves it as it is: suggested for glass, like visors and lenses) or **unused** (a
  row the part never shows). Themes use them to give many items the same look per role. The model shows each zone in
  its role's color (**show roles on the model**); pick a role (the buttons, or keys 1-8) and click a zone on the
  model, or pick it in the list (hovering a row lights the zone up; the % is its share of the part). Zones without
  a confirmed role show a suggestion: unused where the part's ID mask has no pixel of the zone (unless it is a copy of a used zone), cloth, glow and
  hardware from the game's values; the rest is decided for the whole item (a helmet together with its armor set, so the set's main color is the
  helmet's too): its parts' painted colors, weighed
  by how much of the item they cover (each part's share times the part's size: a weapon's magazine counts for little
  next to its receiver; a big metal color, a third of the main paint or more, counts as paint: chrome plates are the
  armor's look), the biggest primary, the next secondary, a shade of one of those (or a big color not far from it)
  joins it, any other color trim (accents, a third main color). Paint on the undersuit in one of the armor's colors
  (plates sewn on, prosthetic limbs) follows that color; its own bits (soles, buckles) are trim; its
  metal in one of the armor's painted colors (gold piping matching gold trim) follows that color too. **Confirm this item** keeps the roles of every LUT on screen, for all projects and
  for every item sharing those LUTs; **Next unconfirmed ▸** shows the next item of the chosen group (the menu)
  with LUTs left to confirm, and the progress line counts them. LUT Studio ships reviewed roles; yours come on top.
  **Export roles.json** saves the built-in roles with yours on top; **Forget mine here** drops yours on screen.
- **Theme** (a sidebar tab: on the left at first; its panel takes the sidebar while open, the **Materials** tab goes back): pick a **Preset** (109 ready-made themes: classic camos, flat colors, faction colors, showpieces like Oil Slick, Chrome
  Legion and Neon Circuit, some very silly ones (Turd: all brown, rusted and grimed as far as it goes; Pink Void: one glowing pink shade, a pink hole where a Helldiver was), looks after Destiny 2's shaders (Metro Shift, Calus's Selected, Calus's Treasured, Midnight Smith, Crimson Valor, Cerulean Divide, Refurbished Black Armory, Gift of the Nine…; 20 of them made from Bungie's own values for the shader: each of its dye areas shaded as Destiny 2 does it, then matched to the nearest Helldivers 2 material, its plates on the primary and secondary, its suit on the undersuit, its accent on the trim and its cloth on capes, weapons from the shader's own weapon colors (capes and weapons take their own looks), each surface on the Helldivers 2 detail texture nearest the shader's, its worn colors ready for when wear is on, and the glowing parts (lights, visors) in the shader's glow color where it has one), and one field camouflage per planet biome (**Planet biomes**: Plains, Ionic Crimson, Volcanic Jungle, Desert Dunes, Icy Glaciers, Haunted Swamp, Magma Desert… 29 in all, as the SEAF blend in per planet; each in the game's own colors of its planets' ground, plants and rock (their albedo, so they blend under the planet's light): the plates in the field color and the camo, in the pattern of its cover, on the cloth, as the game's own camo armors have it), each with a showcase look beside it (**Planet biomes: showcase**: the biome turned up for show, bright, glossy and glowing; where a theme already is that look it is used, as Volcanic for Magma Desert): each a look per role, with its metal, shine, glow, iridescence and camo) or style one item yourself, then give every armor, helmet, cape, backpack, weapon, vehicle and the rest of your gear the same look per role in one go. Each
  role's look is a whole zone of the item on screen (all its settings, not only the color): by default its biggest
  zone of that role, or pick another one, or **(not changed)** to leave that role alone. The color box in front of a
  role recolors its look (its finish, wear and camo stay; **↺** goes back to the look's own color), so a preset or
  your own zones can be put in any colors. **Apply to** the **item on screen** (the armor, helmet and cape, or
  the item, shown; **Recolor this item…** at the top of the **Materials** tab opens the panel this way: a color per role
  and the whole item is recolored in one go), or **every item of these kinds**: tick what it goes to
  (**Armor**, **Helmets**, **Capes**, **Backpacks**, **Weapons**, **Vehicles**, **Equipment**, **Stratagems**,
  **Eagle & craft**, **SEAF** (the soldier, medic and their weapons in every camo look, their backpacks and shells), **Super Destroyer** (the ship, its support cannons, the Eagle ordnance on display, the emblems, the cryo pods), **Ship interior** (terminals, screens, lamps, floors, walls…) or **Ship crew**; **only items already in this mod** to stay within it). In the last four, a LUT the game shares with something outside the group stays as it is (a cryo pod's frozen Helldiver wears B-01 armor; generic metals) and
  Under the boxes the panel says what Apply will do before it's done: how many items and LUTs, how many of them get
  added to the mod, whether zones you changed by hand are kept or overwritten, and whether decal sheets get recolored.
  **Apply theme**: every zone of those roles on those items gets the look, in the current variant. **Undo theme**
  then puts back every file the last theme changed (zones, the LUTs it added, decal sheets), as they were before it. Items not in the
  mod yet are added to it (every variant, with the game's colors), so a theme can make a whole overhaul. Zones with
  the **keep** or **unused** role are left alone. **Preview on screen** shows the theme on the item on screen without saving anything. **Also theme decals** recolors the decals too (emblems, markings, stencils): their decal sheets, in the
  theme's colors (light parts in the trim look's color and dark parts in the secondary's, or all in the trim color);
  their shapes stay. A decal sheet is shared: every item drawing from it shows the recolored decals, items you
  didn't theme too (Apply says how many), and each recolored sheet adds about 5 MB to the mod. Pattern trims work the same: a
  pattern LUT other items share changes on them too, and Apply says how many. A sheet you edited
  in **Decals** is kept unless *also overwrite* is ticked. **Preview on screen** shows it too. **Showcase** opens Showcase mode (below) with these looks. **Paint metal parts** gives the metal parts (barrels, bolts, buckles: the hardware role) a color of your
  choice while they keep their metal finish; off, they stay as the game made them. A zone that is cloth in the game but has another role (a cape's panels, padded armor) takes only
  the look's colors and keeps its cloth finish. Capes' trim lines (their cape design) and the items' patterns (stripes,
  camo: a pattern LUT's patterned rows) take the trim look's color; capes' gradient and emblems stay as the game made
  them. Applying again (after changing the item on screen) updates every
  themed zone; a zone you changed by hand since is kept, unless **also overwrite zones I changed by hand** is ticked.
  For another color scheme, make a variant, restyle the item, apply again. **◂ Previous / Next ▸** steps through the
  themed items. The roles of every armor, helmet, cape, backpack and weapon were reviewed item by item; on the
  others (vehicles, equipment, stratagems, the rest) roles are suggested from the item's colors and masks and can put
  a look on the wrong zone: the panel says how many LUTs on screen have suggested roles only, and on what kind of item.
- **Variants**: **+ Variant** copies the current color scheme. Players pick one variant in the mod manager.
- **Mod page** tab: everything the mod managers (HD2 Mod Manager, HD2 Arsenal) show of your mod, beside the model:
  - the mod's **name**, **description** and **icon**;
  - with several variants, the **choice** between them (its name, "Color scheme" if you leave it empty, its
    description and its own picture; the icon if none), and each **variant's name, description and picture**, their
    order (↑ ↓) and **Delete…** (the variant moves to the project's `.trash` folder, nothing is erased).
  - Every picture: **Snapshot** (the view as it is now, cut to a square: frame the model first; a variant's
    snapshot shows that variant), **Upload…** (your own image, fitted into a 512 × 512 square) or **Reset** (back
    to the picture the build renders). Snapshots take the view's background, a **transparent** one or **a color**.
  - **Layout**: *one choice between the variants* (players pick one variant: the usual recolor mod), or
    *several options, each switched on by itself*: e.g. the armor's colors (a choice of its variants), the matching
    cape (a switch), a glowing visor (a switch). **Split by item** makes one option per item of the mod (an armor
    and its helmet are separate items) offering every variant; **+ Option** adds an empty one. Each option has:
    a name, a description and a picture (the icon if none); its **parts**, the LUTs (by item) and edited decal
    sheets / cape designs it holds; the **variants it offers**: one makes it a plain switch, several a choice
    players pick one of (with **its pictures of the variants**, else each variant's own picture). The game swaps a
    LUT whole, so a part in two options is the later option's when both are on, and a part in no option is left
    out of the mod; the Mod page warns about both. A variant that changes none of an option's parts is left out of
    that option's choices.
  - **How the mod managers list it** previews the result.
  Names longer than the mod managers show (mod 120 characters, the choice and variants 60) get a note in the build
  log.
- **Body**: slim or stocky; some pieces differ between the two.
- **Project…**: **Save as a new project** (a copy that becomes its own mod), **Export .lutproj** (the whole project in one file, to back up or share). **Import .lutproj** is
  on the start page.

## Showcase

**Showcase** (a sidebar tab, on the right at first, or the Theme panel's button) turns the viewport into key art, live (opened from its tab,
the item on screen is in it: your armor, helmet and cape on the leader, a weapon in the leader's hands, a backpack on
the leader's back, a vehicle or stratagem in its place behind): three Helldivers in
warbond poses holding their weapons (backpacks on when you pick them), two vehicles and a stratagem behind them, in
the Armory menu's light with a glow behind the squad, a glossy floor that reflects them, haze, bloom and
a title. The items load one by one (a few seconds each the first time); then orbit, pan and zoom as ever (the frame in
the viewport is the image's, 16:9). The other sidebar and the bars step aside and the Showcase tab's sidebar holds the options (its own tab,
**Materials** or **Zone**, or **Exit showcase** goes back):

- **Show**: the items as in this mod (its edits, this variant), as the game has them, the Theme panel's looks (when
  opened from there), or any theme preset.
- **Title** (the big line) and **Line** (the small one over it): either can be empty.
- **Light**: the glow's color, from the scene (the theme's, or the squad's own colors) or your own.
- **Scene**: each Helldiver's armor, cape, backpack (none at first; worn as the game wears it), weapon and pose (an
  Armory pose holds the weapon, an emote puts it away), the two vehicles and the stratagem. A change swaps that item
  in place; **(none)** empties any slot. Each has **X** and **Y** sliders to move it on the floor (left / right,
  toward / away from the camera).
- **Look**: sliders for the background, the glow and its size, the rim light, exposure, reflections, floor shadows,
  haze, the aura around the squad, bloom, embers, grain, the vignette, the punch (how much the tone lifts the
  midtones) and the text size (remembered in this browser); **Reset look**, **Reset camera**.
- **Save 4K PNG** saves the frame on screen at 3840 x 2160. Nothing in the mod changes; **Exit showcase** puts the
  editor back as it was.

## Build and install

1. **Build & download mod** renders the mod icon and the variant pictures, builds the zip and downloads it (a
   copy also stays in the project's `dist` folder). A card then shows the mod (its icon, name, variants and how many
   LUTs it changes), the file's name, how to install it and **Download again**; the build log is folded under it
   (open when the build failed, with the error first). To choose the pictures yourself, use the **Mod page** tab (or the
   quick **Snapshot ▾** → *Use as the mod icon* / *Use as this variant's picture*); the build keeps those. A variant that changes nothing is left
   out of the mod. The zip is the mod managers' format (manifest v1): the variants are one option's sub-options,
   or with several options (Mod page), each option is a switch or a choice of sub-options.
2. Import the zip into HD2Arsenal / HD2 Mod Manager and deploy.
3. Only LUTs you changed go into the mod, so it clashes with as few other mods as possible. Two mods that change
   the same LUT can't both win: the one loaded last does.
4. Other players see your colors only if they run the same mod.
5. Every material LUT in the mod carries LUT Studio's mark, in three channels no game shader reads (column 20's
   r, g, b), so it changes nothing in the game. Those channels aren't offered in the editor and always keep the
   game's values in a project. Importing such a mod takes the mark out and says the mod was made with LUT Studio.

## Accuracy

The preview runs a port of the game's own armor shader: zones, colors, masks, roughness, metalness, glow, sheen
and all mission-wear effects match the game's shader to within small rounding differences (checked against the
game's compiled shader); so do vehicles (their own shader, decal relief, decal numbers and damage included).

The **lighting** is a port of the game's own lighting too: how the sun and the environment light a surface
(diffuse light, reflections, metal, clearcoat, cloth sheen, wetness, iridescence, and the light that shines
through blood, gunk, frost and snow) matches the game's compiled lighting shader to within about 0.1 % on 99 % of
the checked samples, and to within 2 % on mirror-like reflections. With the *From the game* environments the
reflections and the ambient light are also the game's own captures (on the Super Destroyer hub and the desert
planet the ambient light is the game's own capture of it; elsewhere LUT Studio works it out from the reflections).

What is still LUT Studio's own, so judge final colors in the armory and check under a few lighting setups:
- the light setup: the presets, the key light of the game environments (placed at the capture's brightest spot),
  the side lights, the flashlight and the exposure;
- the shadows: LUT Studio's own shadow map with soft edges, not the game's shadow cascades and filtering;
- what the game adds from the scene around the armor: ambient occlusion from the screen, screen-space reflections,
  fog, clouds, bloom and lens effects;
- the final tone curve: the game converts the lit image with an ACES output transform whose tone curve it works
  out at run time from the display settings, so LUT Studio uses a close fit of the ACES curve. On the Super
  Destroyer the game applies no color grading (its grading is neutral there).

## Troubleshooting

- **No "Choose the Helldivers 2 folder" button**: use Chrome, Edge or Firefox on a computer.
- **Game folder not accepted**: pick the folder that contains `data` (e.g.
  `C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2`).
- **An armor is missing from the search**: after a game update, new items appear once LUT Studio's item list is
  updated (the site is updated, usually within a day of a patch; the start page says when your list is older than
  your game). Their LUTs can still be edited meanwhile when you know the LUT hash: type `0x…`
  instead of a name.
- **A part that isn't in the project**: click it and edit it; your first change adds its LUT to the project (all
  variants). Looking at it adds nothing.
- **After a game update**: LUT Studio reads the game fresh every time. If an update changed an armor's LUT, its
  project files keep your values; check the result and rebuild.

Files: projects live in your projects folder when you chose one (Chrome, Edge), else in the browser's storage for
the LUT Studio site, like your settings, looks and a cache of the game's item list. Clearing the site's data (or the
browser's) deletes what's in the browser's storage: export the projects you want to keep there
(**Project… → Export .lutproj**) and import them again on the start page.

Usage data: the website sends anonymous usage events to help improve LUT Studio (PostHog): the site opening (browser,
screen size), the game folder connecting or failing, a project created (its item, its name), a mod imported (the
file names and the import report) or built (the mod's, variants' and options' names, its items, which kinds of
settings were changed and how many, success or the error), which editors and looks are used, and page errors. With
each event: the LUT Studio version and the country PostHog finds from the connection. Never your game files, your
projects' contents or folder names. No cookies and no stored id (PostHog counts daily visitors from a hash it
renews). Switch it off with **Send anonymous usage data** at the bottom of the start page. Nothing is sent when you
run LUT Studio on your own computer.
