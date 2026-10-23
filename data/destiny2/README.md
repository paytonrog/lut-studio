# Destiny 2 shaders (reference data)

`shaders.json.gz`: every Destiny 2 shader's armor, weapon, ship and sparrow dyes, as Bungie's public API publishes them, taken once
(see `manifest_version` in the file) for LUT Studio's Destiny 2 looks (Metro Shift, Bitterpearl, Gilded Frost...). It
is reference data for making presets by hand or with a script; the app doesn't read it. Destiny 2 and its content
are Bungie's.

`iridescence.json`: Destiny 2's iridescence lookup (the texture a dye's iridescence id picks a row of), as each row's
mean linear color, from `Iridescence Lookup.png` in TiredHobgoblin's Destiny-Collada-Generator (`Resources/`).

`tools/d2preset.py` turns a shader into a LUT Studio preset: each dye region shaded as the community's template shader
(Destiny-Collada-Generator `Resources/template.shader`) does it, on Destiny 2 gear measured from Bungie's CDN (four
armors' dyed areas: the gear's own diffuse 0.164 linear under the dye, its gloss 0.39, its wear mask 0.59), then fit
to the nearest Helldivers 2 paint color and metalness. Its regions go to LUT Studio's roles by how much of an armor
each covers (measured: Destiny 2's plate 1 39%, suit 1 26%, plate 2 17%, suit 2 7%, cloth 1 6.5%, cloth 2 5% of 60
armor pieces' surface, by the dye slot in each vertex: the low 3 bits of its normal's w, 0-5 = plate, cloth, suit,
each primary then secondary; Helldivers 2's cloth role, mostly the undersuit, about half of an armor): the plates on
primary and secondary, the suit on the undersuit, the accent (suit 2 or cloth 2, the more saturated) on the trim, and
the cloth regions on capes (a preset's own capes looks). Weapons take the shader's weapon dyes the same way (measured
on 40 Destiny 2 weapons: weapon 1 45% / 24%, weapon 2 16% / 11%, weapon 3 3% / 2%; Helldivers 2's weapons: primary
45%, secondary 27%, hardware 22%, trim 5%): weapon 1 on primary and secondary, weapon 2's primary on the metal parts,
the accent on the trim. Each dye's detail normal map becomes the nearest Helldivers 2 detail tile
(`detail_map.json`: by bump spread, fineness, direction and regularity of the two textures; tiles 14 and 21 read as
crumpled foil on armor, so the surfaces matched to them go by what they are instead: carbon fiber to HD2's carbon fiber
tile 8, plastic and glitter clean, cloth a fine weave and so on, `SURFACE_RULES` in tools/d2preset.py), at a third of
its bump, repeated 4 times (picked on armor), its worn color goes to the
wear colors, and a dye's emissive color (when it is a color of its own) to the glow role. Vehicles take the sparrow
dyes (measured on 30 sparrows: upper 59% / 11%, lower 24% / 1%, engine 5% / 1%; Helldivers 2's vehicles: primary 66%,
trim 13%, secondary 12%, hardware 4%): the upper on primary, the lower on secondary, the accent on trim, the engine's
metal on the metal parts. An even iridescence id (its colors change with the view) also gets Helldivers 2's own
iridescence film, at the step fitted to its lookup row (`iridescence.json` film). The presets are marked bySize: on an
item whose secondary zones cover more of it than its primary ones (some weapons and exosuits; no armor), the shader's
primary and secondary looks swap (`/api/theme/sizes`, the server deciding it per item as Apply does). Every shader with armor dyes is a preset: `python -I tools/d2preset.py --module=server/web/d2presets.js
--taken=Watermelon` writes them all (693; a name another theme has gets " (Destiny 2)") with their color family for
the picker's groups (by the armor's primary color), and theme.js adds them.

## Where it comes from

- `GET https://www.bungie.net/Platform/Destiny2/Manifest/` (no key needed for it)
- `DestinyInventoryItemDefinition`: the shader items (item sub type 20, category 41), their names, descriptions,
  icons, and `translationBlock.customDyes` (`{channelHash, dyeHash}` per dye channel)
- `mobileGearAssetDataBases` (a zipped SQLite file, table `DestinyGearAssetsDefinition`: the item hash as a signed
  32-bit id, its gear file names) and `mobileGearCDN.Gear` (`/common/destiny2_content/geometry/gear/<file>.js`): each
  shader's gear JSON, whose `custom_dyes` hold the values below (a dye's `investment_hash` is the item's `dyeHash`)

Shaders without gear data in Bungie's files are listed under `missing`.

Each shader's `season` (its number; `season_name` from Bungie's DestinySeasonDefinition, season 1 unnamed there: the
Red War) comes from Destiny Item Manager's d2-additional-info (MIT; `output/seasons.json` by item, else
`output/watermark-to-season.json` by the item's icon watermark); 19 shaders have none. The preset picker groups the
Destiny 2 shaders by it (or by color).

## The data

```
{ about, source, manifest_version, channels, count, missing: [names],
  shaders: [ { hash, name, description, icon, tier, flavor, season, season_name,
               dyes: { armor_plate | armor_cloth | armor_suit | weapon_1..3 | ship_upper | ship_decals | ship_lower | sparrow_upper | sparrow_engine | sparrow_lower:
                       { cloth, slot_type_index, textures: { diffuse, normal, primary_diffuse, secondary_diffuse },
                         material_properties: { ... } } } } ] }
```

The channel names follow the community's tools (lowlines' destiny-tgx-loader, TiredHobgoblin's
Destiny-Collada-Generator): the channel's index 0 is the armor's plates, 1 its cloth (`cloth: true`), 2 its suit;
4-6 the weapon's three, 7-9 the ship's (upper, decals, lower), 10-12 the sparrow's (upper, engine, lower). (Ghosts are
left out.)

Each dye has a primary and a secondary version of most values (`primary_*`, `secondary_*`: the two dye areas of the
plates, cloth or suit), all four-component:

| value | what it is (as the community's shaders read it; not documented by Bungie) |
| --- | --- |
| `*_albedo_tint` | the color (rgb, linear), overlaid on the gear's own diffuse |
| `*_worn_albedo_tint` | the worn areas' color |
| `*_wear_remap` | `clamp(v * y + x, z, z + w)` over the wear mask: 1 the color, 0 the worn color |
| `*_material_params` | detail diffuse blend, detail normal blend, detail roughness blend, metalness |
| `*_worn_material_parameters` | the same for worn areas |
| `*_roughness_remap`, `*_worn_roughness_remap` | `clamp(gloss * y + x, z, z + w)`, roughness = 1 - that |
| `*_material_advanced_params` | iridescence (a row of the iridescence lookup, -1 off), fuzz (cloth sheen), transmission, ? |
| `*_emissive_tint_color_and_intensity_bias` | glow color (rgb) and an intensity value (its encoding is unknown) |
| `detail_diffuse_transform`, `detail_normal_transform` | the detail tile's scale (x, y) and offset |
| `specular_properties`, `lobe_pbr_params`, `tint_pbr_params`, `emissive_pbr_params`, `subsurface_scattering_*` | unknown |

The `textures` are the detail tiles' file names on the same CDN
(`/common/destiny2_content/geometry/platform/mobile/textures/<name>`), not included.

Made by `python -I tools/d2shaders.py <work folder>` (a one-time download of about 220 MB into that folder, the gear
files fetched one at a time); run it again for a newer manifest.
