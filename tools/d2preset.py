"""Destiny 2 shader -> LUT Studio preset (server/web/theme.js T(...) form), from data/destiny2/shaders.json.gz.

    python -I tools/d2preset.py [--map=ACFE] [--extra] "Metro Shift" "Calus's Selected" ...

The mapping (D2's armor dyes: plate, suit, cloth, each a primary and a secondary, as letters A B plate, C D suit, E F
cloth; see data/destiny2/README.md), from how much of an armor each covers (measured: D2's plate 1 39%, suit 1 26%,
plate 2 17%, suit 2 7%, cloth 1 6.5%, cloth 2 5%; HD2's cloth, mostly the undersuit, 54%, primary 23%, secondary 15%,
trim 4%):
  primary <- plate 1 (A)    secondary <- plate 2 (B)    cloth <- suit 1 (C: HD2's cloth is the undersuit)
  trim    <- the accent: the more saturated of suit 2 (D) and cloth 2 (F)
  capes   <- D2's cloth: cloth 1 (E) primary and cloth, cloth 2 (F) secondary, the same trim
  metal parts <- plate 2 when it is metal
Each region as the community's D2 template shader (Destiny-Collada-Generator template.shader) shades it, on the D2
gear measured from Bungie's CDN (region()): wear, the dye over the gear's own diffuse and the detail tile, roughness
from the gear's gloss through the dye's remaps, iridescence (its lookup row: data/destiny2/iridescence.json); then the
HD2 paint color and metalness nearest D2's diffuse and reflection. Colors written as sRGB hex. Glow and wear are left out (D2's emissive intensity isn't known; presets are clean).
"""
import gzip
import json
import os
import re
import sys

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'destiny2', 'shaders.json.gz')


def srgb(c):
    out = []
    for v in c[:3]:
        v = max(0.0, min(1.0, v))
        out.append(12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055)
    return '#' + ''.join(f'{round(x * 255):02x}' for x in out)


# The measured D2 gear (four armors' dyed areas, their gbit textures from Bungie's CDN): the gear's own diffuse
# 0.164 (linear) under the dye, its gloss 0.39, its wear mask 0.59; the detail tiles' 0.17 (their gloss 0.5)
GEAR_DIFFUSE, GEAR_GLOSS, GEAR_WEAR, DETAIL, DETAIL_GLOSS = 0.164, 0.39, 0.59, 0.17, 0.5
_IRID = json.load(open(os.path.join(os.path.dirname(DATA), 'iridescence.json')))
IRID_ROWS, IRID_FILM = _IRID['rows'], _IRID['film']


def remap(v, r):
    x, y, z, w = r
    return max(z, min(z + w, v * y + x))


def blend(base, b, f):   # (the template's Overlay / HardLight: b * sat(4 base) + sat(base - 0.25), by f)
    return base + ((b * min(1, 4 * base) + max(0, base - 0.25)) - base) * f


def region(mp, k):
    """A dye region as the D2 template shades it (wear, the gear's diffuse and detail, roughness, iridescence), then
    the HD2 paint color and metalness whose diffuse and reflection come closest to D2's: {hex, metal, rough}. Cloth
    (mp['_part'] armor_cloth) without its iridescence: D2's view-dependent sheen on cloth baked into a fixed paint
    tinted it (New Age Black Armory's charcoal cloth olive green on every cape)."""
    p = lambda n: mp[f'{k}_{n}']
    wear = remap(GEAR_WEAR, p('wear_remap'))
    lerp = lambda a, b, t: a + (b - a) * t
    color = [lerp(a, b, wear) for a, b in zip(p('worn_albedo_tint')[:3], p('albedo_tint')[:3])]
    mat, worn = p('material_params'), p('worn_material_parameters')
    metal = lerp(worn[3], mat[3], wear)
    dblend = lerp(worn[0], mat[0], wear)
    rblend = lerp(worn[2], mat[2], wear)
    # diffuse: the dye over the gear's own diffuse, the detail tile hard-lit over it
    diffuse = [min(1, c * min(1, 4 * GEAR_DIFFUSE) + max(0, GEAR_DIFFUSE - 0.25)) for c in color]
    diffuse = [c + ((c * min(1, 4 * DETAIL) + max(0, DETAIL - 0.25)) - c) * dblend for c in diffuse]
    # roughness: the gear's gloss with the detail's overlaid, remapped (worn and not), 1 - that
    g = blend(GEAR_GLOSS, DETAIL_GLOSS, rblend)
    gloss = lerp(remap(g, p('worn_roughness_remap')), remap(g, p('roughness_remap')), wear)
    rough = 1 - gloss * (0.86 if gloss > 0 else 1)   # (the template: gloss x 0.86 unless 0)
    # D2's diffuse and reflection (F0)
    D = [c * (1 - metal) for c in diffuse]
    F = [0.04 + (c - 0.04) * metal for c in diffuse]
    rid = -1 if mp.get('_part') == 'armor_cloth' else int(p('material_advanced_params')[0])
    film = None
    if 0 <= rid < len(IRID_ROWS):
        st = 1 - (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2])   # (the raw (linear) dye's luminance)
        row = IRID_ROWS[rid]
        if rid % 2:   # odd: the reflection takes the row's color
            F = [lerp(f, r, st) for f, r in zip(F, row)]
        else:         # even: the color is the row's, metal, no reflection of its own
            m2 = lerp(metal, 1, st)
            D = [lerp(c, r, st) * (1 - m2) for c, r in zip(diffuse, row)]
            F = [0.0, 0.0, 0.0]
            # (its colors change with the view: HD2's own thin film, at the step fitted to the row, where it fits)
            k_, err = IRID_FILM[rid]
            if err < 1.5:
                film = (round((k_ / 7) ** 0.5, 3), round(st, 2))
    # HD2: diffuse (1 - m) P, reflection 0.04 (1 - m) + m P: the m and P nearest both
    best = None
    for i in range(101):
        m = i / 100
        den = (1 - m) ** 2 + m * m
        P = [max(0, min(1, ((1 - m) * d + m * (f - 0.04 * (1 - m))) / den)) if den else d for d, f in zip(D, F)]
        err = sum(((1 - m) * q - d) ** 2 + (0.04 * (1 - m) + m * q - f) ** 2 for q, d, f in zip(P, D, F))
        if best is None or err < best[0]:
            best = (err, m, P)
    _, m, P = best
    # the worn areas' color, shaded the same way (no iridescence): HD2's wear colors (shown only when wear is on)
    worn_d = [min(1, c * min(1, 4 * GEAR_DIFFUSE)) for c in p('worn_albedo_tint')[:3]]
    return {'hex': srgb(P), 'metal': round(m, 2), 'rough': round(min(1, max(0.03, rough)), 2), 'worn': worn_d, 'film': film}


DETAIL_MAP = json.load(open(os.path.join(os.path.dirname(DATA), 'detail_map.json')))['map']
# HD2 tiles 14 and 21 read as crumpled / crushed foil on armor whatever the dye; the nearest-tile match sent dozens of
# unlike D2 surfaces there (carbon fiber, plastic, glitter, cloth...). Those surfaces go by what they are instead (the
# first rule matching the D2 texture's name), and carbon fiber to HD2's own carbon fiber (8) wherever it was matched.
FOIL = {14, 21}
SURFACE_RULES = [
    (r'carbon|kevlar', 8),                                              # carbon fiber
    (r'sparkle|discoball', 19),                                         # glitter: HD2 has none, clean
    (r'plastic', 20),                                                   # plain plastic: clean
    (r'chainmail', 12),                                                 # chainmail knit
    (r'studded|_hex_', 23),                                             # hex studs
    (r'mokume|coins', 2),                                               # layered metal: Damascus grain
    (r'leather', 17),                                                   # leather: pebbled, as D2's other leathers
    (r'wave|water_foam', 24),                                           # flag and fabric waves: flow lines
    (r'cloth|fabric|gauze|burlap|techweave|shoe_mesh', 13),             # fabric: fine weave
    (r'lattice|clockwork|ada_pattern|plating|veil_pattern_metal', 22),  # tech patterns: panel lines
    (r'geopattern|crosshatch|tendril|veil_pattern|ice_runes', 16),      # suit prints: fine grid weave
    (r'rock|crystal|lava|fractal|glass|splatter|oil|mosaic|sandstone|prism|perlin|glutt|worms|paint', 3),  # coarse grain
]
# the tiles Helldivers 2's own armor, helmets and capes use (each on 90+ of its armors, about 95% of their zones: 19, 1,
# 16, 13, 3, 0), and its carbon fiber (8); the others (streaks, grime, rust, studs, near-black plates) go to the nearest
# of these by what the D2 surfaces matched to them were: grain and scuffs fine scratched metal (1), paint clean (19),
# cloth and knit the fine weave (13), netting, scales and panel lines the fine grid (16), rubber, leather and grunge
# coarse grain (3)
TILES = {0, 1, 3, 8, 13, 16, 19}
TILE_REMAP = {2: 1, 4: 1, 5: 1, 7: 1, 25: 1, 6: 19, 9: 19, 14: 19, 21: 19, 10: 13, 12: 13, 15: 13, 18: 16, 22: 16, 23: 16,
              11: 3, 17: 3, 20: 3, 24: 3}
# carbon fiber's own dark gloss blacks out a plate at the bump the other tiles take: at most the game's (0.01 on armor)
CARBON_BUMP = 0.02
# every surface as picked on armor (the Detail Layer Picker): a third of the matched bump, repeated 4 times
FAINT, TILING = 0.3, 4


def surface(name, layer):
    """The HD2 detail tile for D2 detail normal map `name` (matched to `layer`): by SURFACE_RULES for the foil tiles
    and carbon fiber, else the match; a foil surface no rule names is clean (19); one of TILES (TILE_REMAP)."""
    for pat, to in SURFACE_RULES:
        if re.search(pat, name, re.I) and (layer in FOIL or to == 8):
            return TILE_REMAP.get(to, to)
    return 19 if layer in FOIL else TILE_REMAP.get(layer, layer)


def finish(mp, k):
    r = region(mp, k)
    f = [[6, 3, r['metal'] if r['metal'] >= 0.05 else -1], [10, 0, r['rough']]]
    if r['rough'] < 0.3:
        f.append([8, 3, round(0.9 - r['rough'], 2)])   # (a glossy coat: its highlight)
    # the surface: the D2 dye's detail normal map as the nearest HD2 detail tile (data/destiny2/detail_map.json; the foil
    # tiles by surface()), its bump by D2's normal blend, faint, repeated TILING times
    name = (mp.get('_tex') or {}).get('normal') or ''
    dm = DETAIL_MAP.get(name)
    if dm:
        wear = remap(GEAR_WEAR, mp[f'{k}_wear_remap'])
        nb = mp[f'{k}_worn_material_parameters'][1] + (mp[f'{k}_material_params'][1] - mp[f'{k}_worn_material_parameters'][1]) * wear
        tile = surface(name, dm['layer'])
        bump = round(FAINT * min(1.5, max(0.15, dm['bump'] * max(nb, 0.3))), 3)
        f += [[1, 0, tile], [1, 1, min(bump, CARBON_BUMP) if tile == 8 else bump], [22, 0, TILING]]
    if r.get('film'):   # (HD2's iridescence: the thin film's step, its mask all over, its strength D2's)
        th, st = r['film']
        f += [[13, 2, th], [13, 3, 0], [14, 0, 0], [14, 1, 0], [14, 2, 0], [14, 3, 1], [15, 0, 0], [15, 1, 0], [15, 2, 0], [15, 3, st]]
    # the worn colors (HD2's wear and heavy wear: worn paint, then its most worn spots darker)
    wh = srgb(r['worn'])
    w = [round(int(wh[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]   # (as the LUT keeps colors: sRGB)
    f += [[6, i, w[i]] for i in range(3)] + [[5, i, round(w[i] * 0.6, 3)] for i in range(3)]
    return f, r['metal']


def fmt(v):
    return json.dumps(v, separators=(', ', ': '))


def preset(s, mapping=None):
    p, sc, t, cl, o = args(s, mapping)
    name = json.dumps(s['name']) if "'" in s['name'] else f"'{s['name']}'"   # (as theme.js writes them)
    return (f"  {name}: T('{p}', '{sc}', '{t}', '{cl}', {{ {', '.join(f'{k}: {fmt(v)}' for k, v in o.items())} }}),"
            "   // (Bungie's dye values: data/destiny2)")


# the six dye regions by letter (as --map names them): A B the plate's primary / secondary, C D the suit's, E F the cloth's
REGIONS = {'A': ('armor_plate', 'primary'), 'B': ('armor_plate', 'secondary'), 'C': ('armor_suit', 'primary'),
           'D': ('armor_suit', 'secondary'), 'E': ('armor_cloth', 'primary'), 'F': ('armor_cloth', 'secondary')}


# T(...)'s arguments for the shader: [primary, secondary, trim, cloth, options]. mapping: four region letters for
# primary, secondary, trim, cloth (e.g. ACFE); none: the default (by how much of an armor each covers, measured on
# Destiny 2's and Helldivers 2's armors): A primary, B secondary, C cloth (HD2's cloth is the undersuit: D2's suit),
# the trim the accent (the more saturated of D and F). Capes: D2's cloth (E primary and cloth, F secondary, the same
# trim). The metal parts: B when it is metal (unless it is a paint)
def args(s, mapping=None):
    d = {k: {**v['material_properties'], '_tex': v.get('textures') or {}, '_part': k} for k, v in s['dyes'].items()}
    reg = lambda c: (d[REGIONS[c][0]], REGIONS[c][1])
    def sat(c):
        h = region(*reg(c))['hex']
        v = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return max(v) - min(v)
    accent = 'D' if sat('D') > sat('F') else 'F'
    plate = d['armor_plate']
    hf, hmetal = finish(plate, 'secondary')

    def look(m):
        looks = [(region(*reg(c))['hex'], finish(*reg(c))[0]) for c in m]
        cmp, cside = reg(m[3])
        fz = cmp[f'{cside}_material_advanced_params'][1]
        o = {'pf': looks[0][1], 'sf': looks[1][1], 'tf': looks[2][1]}
        if hmetal >= 0.5 and 'B' not in m[:3]:
            o.update(hw=region(plate, 'secondary')['hex'], hwf=hf)
        if fz > 0:
            o['fuzz'] = [round(min(1, v ** (1 / 2.2) * (0.6 + fz)), 2) for v in cmp[f'{cside}_albedo_tint'][:3]]
        return [looks[0][0], looks[1][0], looks[2][0], looks[3][0], o]

    if mapping:
        return look(mapping.upper())
    out = look('AB' + accent + 'C')
    if hmetal >= 0.5:   # (the plate's metal on the metal parts too)
        out[4].update(hw=region(plate, 'secondary')['hex'], hwf=hf)
    out[4]['cape'] = look('EF' + accent + 'E')
    light = glow(plate, 'primary')
    if light:
        out[4]['light'] = light
    # weapons: their own dyes (weapon 1 / 2 / 3, each primary and secondary), by how much of a weapon each covers
    # (measured: D2 weapon 1 45% / 24%, weapon 2 16% / 11%, weapon 3 3% / 2%; HD2's weapons: primary 45%, secondary
    # 27%, hardware 22%, trim 5%): weapon 1 the primary and secondary, weapon 2's primary the metal parts, the trim the
    # accent (the most saturated of weapon 2's secondary and weapon 3's)
    if all(f'weapon_{i}' in d for i in (1, 2, 3)):
        wr = lambda i, side: (d[f'weapon_{i}'], side)
        acc = max([wr(2, 'secondary'), wr(3, 'primary'), wr(3, 'secondary')],
                  key=lambda x: (lambda h: max(int(h[j:j + 2], 16) for j in (1, 3, 5)) - min(int(h[j:j + 2], 16) for j in (1, 3, 5)))(region(*x)['hex']))
        regs = [wr(1, 'primary'), wr(1, 'secondary'), acc, wr(1, 'secondary')]
        wl = [(region(*x)['hex'], finish(*x)[0]) for x in regs]
        hw = wr(2, 'primary')
        wo = {'pf': wl[0][1], 'sf': wl[1][1], 'tf': wl[2][1], 'hw': region(*hw)['hex'], 'hwf': finish(*hw)[0]}
        wlight = glow(d['weapon_1'], 'primary')
        if wlight:
            wo['light'] = wlight
        out[4]['weapon'] = [wl[0][0], wl[1][0], wl[2][0], wl[3][0], wo]
    # vehicles: the sparrow dyes (upper, engine, lower: measured on 30 sparrows, upper 59% / 11%, lower 24% / 1%, engine
    # 5% / 1%; HD2's vehicles: primary 66%, trim 13%, secondary 12%, hardware 4%): the upper the primary, the lower the
    # secondary, the accent (the more saturated of the upper's secondary and the engine) the trim, the engine's metal
    # the metal parts
    if all(f'sparrow_{n}' in d for n in ('upper', 'engine', 'lower')):
        vr = lambda n, side: (d[f'sparrow_{n}'], side)
        hue = lambda x: (lambda h: max(int(h[j:j + 2], 16) for j in (1, 3, 5)) - min(int(h[j:j + 2], 16) for j in (1, 3, 5)))(region(*x)['hex'])
        acc = max([vr('upper', 'secondary'), vr('engine', 'primary')], key=hue)
        regs = [vr('upper', 'primary'), vr('lower', 'primary'), acc, vr('lower', 'secondary')]
        vl = [(region(*x)['hex'], finish(*x)[0]) for x in regs]
        vo = {'pf': vl[0][1], 'sf': vl[1][1], 'tf': vl[2][1]}
        eng = max([vr('engine', 'primary'), vr('engine', 'secondary')], key=lambda x: region(*x)['metal'])
        if region(*eng)['metal'] >= 0.5:
            vo.update(hw=region(*eng)['hex'], hwf=finish(*eng)[0])
        out[4]['vehicle'] = [vl[0][0], vl[1][0], vl[2][0], vl[3][0], vo]
    out[4]['bySize'] = True   # (each item: the main look on what's biggest on it)
    return out


# the glow (HD2's glow role: lights, screens, visors) in the dye's emissive color when it is a color of its own (D2
# lights the gear's emissive parts with it; its intensity's encoding isn't known: a moderate glow); else none
def glow(mp, k):
    c = mp[f'{k}_emissive_tint_color_and_intensity_bias'][:3]
    if max(c) <= 0.05:
        return None
    n = [v / max(c) for v in c]
    h = srgb(n)
    v = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return h if max(v) - min(v) >= 0.35 else None

# a preset's color family, for the picker's groups: by its armor's primary color (gray-ish: by lightness)
def family(hexc):
    import colorsys
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s_ = colorsys.rgb_to_hls(r, g, b)
    if max(r, g, b) - min(r, g, b) < 0.09:
        return 'Whites' if l > 0.6 else 'Grays' if l > 0.22 else 'Blacks'
    h *= 360
    for top, name in [(15, 'Reds'), (45, 'Oranges and golds'), (70, 'Yellows'), (165, 'Greens'), (200, 'Teals'), (255, 'Blues'),
                      (295, 'Purples'), (340, 'Pinks'), (361, 'Reds')]:
        if h < top:
            return name


# every shader with armor dyes (named, the first of a name; a name of a LUT Studio theme of its own: "(Destiny 2)")
# as the module server/web/d2presets.js
def module(path, taken=()):
    rows, seen = [], set()
    for s in json.load(gzip.open(DATA))['shaders']:
        n = s['name'].strip()
        if not n or n in seen or not all(k in s['dyes'] for k in ('armor_plate', 'armor_suit', 'armor_cloth')):
            continue
        seen.add(n)
        a = args(s)
        rows.append([n + (' (Destiny 2)' if n in taken else ''), family(a[0]), s.get('season') or 0, s.get('season_name') or '', a])
    rows.sort(key=lambda r: r[0].lower())
    head = ('// Destiny 2' + chr(39) + 's shaders as presets: [name, color family, season, its name, T(...) arguments], made by tools/d2preset.py '
            '--module from' + chr(10) + '// Bungie' + chr(39) + 's dye values (data/destiny2); theme.js adds them to PRESETS. '
            'Generated: edit the tool, not this file.' + chr(10))
    with open(path, 'w', encoding='utf-8', newline=chr(10)) as f:
        f.write(head + 'export const D2_PRESETS = [' + chr(10))
        for r in rows:
            f.write(json.dumps(r, separators=(',', ':')) + ',' + chr(10))
        f.write('];' + chr(10))
    return len(rows)


if __name__ == '__main__':
    # --module=path [taken name|...]: every shader as server/web/d2presets.js (names taken by other themes get " (Destiny 2)")
    mod = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--module=')), None)
    if mod:
        taken = next((a.split('=', 1)[1].split('|') for a in sys.argv if a.startswith('--taken=')), [])
        print(module(mod, set(taken)), 'presets ->', mod)
        sys.exit(0)
    # --extra: the presets as tools/themescene.mjs --extra wants them ([{name, args}], JSON) instead of theme.js lines
    by = {s['name'].lower(): s for s in json.load(gzip.open(DATA))['shaders']}
    # --map=ACFE: the regions for primary, secondary, trim, cloth (see REGIONS)
    mapping = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--map=')), None)
    names = [n for n in sys.argv[1:] if not n.startswith('--')]
    if '--extra' in sys.argv:
        print(json.dumps([{'name': by[n.lower()]['name'], 'args': args(by[n.lower()], mapping)} for n in names if n.lower() in by]))
        for n in names:
            if n.lower() not in by:
                print(f'no shader named {n}', file=sys.stderr)
    else:
        for n in names:
            print(preset(by[n.lower()], mapping) if n.lower() in by else f'// no shader named {n}')
