# LUT Studio

**Recolor Helldivers 2 armor, helmets, capes, vehicles and weapons — live, in your browser.**

👉 **https://paytonrog.github.io/lut-studio/**

LUT Studio edits the game's **material LUTs**: the small tables that decide each part's colors, wear, roughness,
metalness, camo and glow. You see every change on the 3D model as you make it, and one click builds a mod you can
install with HD2Arsenal or HD2 Mod Manager. Models and textures stay the game's own, so LUT mods are tiny.

## Getting started

1. Open the site in **Chrome, Edge or Firefox** on a computer.
2. Choose your **Helldivers 2** folder (usually
   `C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2`). Your browser may call this an "upload": the
   game's files never leave your computer — LUT Studio reads them right there in the page and never changes the game.
3. Pick an item, recolor it, and press **Build & download mod**.

The [user guide](docs/USER-GUIDE.md) explains everything else.

## What you can recolor

Armor and helmets (mix any armor, helmet and cape), capes, vehicle skins (exosuits, FRVs, tanks, the Pelican,
hellpods), weapons and their paint schemes, backpacks, grenades and other equipment, stratagem hardware, SEAF gear,
and more. You can also put your own images on decal sheets (emblems, numbers, markings) and repaint where a cape's
zones are and where its cloth is cut out.

## Support

LUT Studio is free. If you enjoy it, you can [support it on Ko-fi](https://ko-fi.com/paytonrogers).

## Credits

- Game files are read with [filediver](https://github.com/xypwn/filediver) (a fork with LUT Studio's changes:
  [paytonrog/filediver](https://github.com/paytonrog/filediver)).
- Weapon attachment lists come from the [Helldivers Wiki](https://helldivers.wiki.gg) (CC BY-NC-SA 4.0).
- Third-party licenses ship with the site (`THIRD-PARTY-NOTICES.txt`, linked from its start page).

## License

LUT Studio is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0): you may use, change
and share it, and anything built from it, including a hosted copy of the site, must publish its source under the
same license. Exception: `game/wikiattach.json` (weapon attachment lists from the Helldivers Wiki) stays under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Third-party code keeps its own licenses.

Helldivers 2 is a trademark of Arrowhead Game Studios and Sony Interactive Entertainment. LUT Studio is a fan project,
not affiliated with them. It ships no game files.

## Development

- Build the site: `python -I tools/web.py` → `dist/web/` (Go → WebAssembly plus the web UI in `server/web/`).
- Run it locally: `node tools/webserve.mjs`, then open http://127.0.0.1:8790/.
- Tests: `python -I tools/test.py` (see [TESTING.md](TESTING.md)).
- Every push to `main` deploys the site with GitHub Pages.
