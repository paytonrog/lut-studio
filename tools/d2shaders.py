"""Destiny 2 shaders reference (data/destiny2/shaders.json.gz): every shader's armor, weapon, ship and sparrow dyes, from Bungie's
public API (no key needed). Downloads into a work folder of its own (about 220 MB: the item definitions, the gear
asset database, one gear file per shader, fetched one at a time), then writes the reference file. A one-time
reference for making Destiny 2 looks; the app doesn't read it. See data/destiny2/README.md.

    python -I tools/d2shaders.py <work folder> [out=data/destiny2/shaders.json.gz]
"""
import ctypes
import gzip
import io
import json
import os
import sqlite3
import sys
import time
import urllib.request
import zipfile

BNET = 'https://www.bungie.net'
# dye channels by their index (the community's names: lowlines' destiny-tgx-loader, Destiny-Collada-Generator);
# ghosts (13-15) left out
NAMES = {0: 'armor_plate', 1: 'armor_cloth', 2: 'armor_suit', 4: 'weapon_1', 5: 'weapon_2', 6: 'weapon_3',
         7: 'ship_upper', 8: 'ship_decals', 9: 'ship_lower', 10: 'sparrow_upper', 11: 'sparrow_engine', 12: 'sparrow_lower'}


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2)


def cached(path, url):
    if not os.path.exists(path):
        open(path, 'wb').write(get(url))
    return path


def is_shader(it):
    return it.get('itemSubType') == 20 or 41 in (it.get('itemCategoryHashes') or [])


def rounded(v):
    if isinstance(v, float):
        return float(f'{v:.6g}')
    if isinstance(v, list):
        return [rounded(x) for x in v]
    if isinstance(v, dict):
        return {k: rounded(x) for k, x in v.items()}
    return v


def main():
    work = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'data', 'destiny2', 'shaders.json.gz')
    os.makedirs(os.path.join(work, 'gear'), exist_ok=True)
    man = json.loads(open(cached(os.path.join(work, 'manifest.json'), BNET + '/Platform/Destiny2/Manifest/'), 'rb').read())['Response']
    paths = man['jsonWorldComponentContentPaths']['en']
    items = json.loads(open(cached(os.path.join(work, 'items.json'), BNET + paths['DestinyInventoryItemDefinition']), 'rb').read())
    chans = json.loads(open(cached(os.path.join(work, 'channels.json'), BNET + paths['DestinyArtDyeChannelDefinition']), 'rb').read())
    raw = open(cached(os.path.join(work, 'asset.content'), BNET + man['mobileGearAssetDataBases'][-1]['path']), 'rb').read()
    if raw[:2] == b'PK':
        z = zipfile.ZipFile(io.BytesIO(raw))
        raw = z.read(z.namelist()[0])
    db_path = os.path.join(work, 'asset.sqlite')
    open(db_path, 'wb').write(raw)
    db = sqlite3.connect(db_path)
    chan_name = {int(h): NAMES.get(c['index']) for h, c in chans.items()}
    # each shader's season: Destiny Item Manager's d2-additional-info (MIT: an item's season, else its icon watermark's),
    # the seasons' names from Bungie's DestinySeasonDefinition (season 1, unnamed there: the Red War)
    D2AI = 'https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/'
    item_season = json.loads(open(cached(os.path.join(work, 'd2ai_seasons.json'), D2AI + 'seasons.json'), 'rb').read())
    mark_season = json.loads(open(cached(os.path.join(work, 'd2ai_watermark-to-season.json'), D2AI + 'watermark-to-season.json'), 'rb').read())
    season_defs = json.loads(open(cached(os.path.join(work, 'seasons.json'), BNET + paths['DestinySeasonDefinition']), 'rb').read())
    season_name = {v['seasonNumber']: v['displayProperties']['name'] or ('Red War' if v['seasonNumber'] == 1 else '')
                   for v in season_defs.values() if v.get('seasonNumber') is not None}

    shaders, missing = [], []
    for h, it in sorted(items.items(), key=lambda kv: kv[1]['displayProperties']['name']):
        if not is_shader(it):
            continue
        dp = it['displayProperties']
        row = db.execute('select json from DestinyGearAssetsDefinition where id=?', (ctypes.c_int32(int(h)).value,)).fetchone()
        gear_files = json.loads(row[0]).get('gear', []) if row else []
        if not gear_files:
            missing.append(dp['name'])
            continue
        f = os.path.join(work, 'gear', h + '.json')
        if not os.path.exists(f):
            open(f, 'wb').write(get(BNET + man['mobileGearCDN']['Gear'] + '/' + gear_files[0]))
            time.sleep(0.15)   # (one at a time, gently)
        g = json.loads(open(f, 'rb').read())
        tb = it.get('translationBlock', {})
        chan_of = {c['dyeHash']: c['channelHash'] for c in tb.get('customDyes', []) + tb.get('defaultDyes', [])}
        dyes = {}
        for dy in g.get('custom_dyes', []):
            name = chan_name.get(chan_of.get(dy['investment_hash']))
            if name:
                dyes[name] = {'cloth': dy.get('cloth', False), 'slot_type_index': dy.get('slot_type_index'),
                              'textures': {k: v.get('name') if isinstance(v, dict) else v for k, v in (dy.get('textures') or {}).items()},
                              'material_properties': rounded(dy.get('material_properties', {}))}
        if not dyes:
            missing.append(dp['name'])
            continue
        season = item_season.get(h) or mark_season.get(it.get('iconWatermark') or '') or mark_season.get(it.get('iconWatermarkShelved') or '')
        shaders.append({'hash': int(h), 'name': dp['name'], 'description': dp.get('description', ''), 'icon': dp.get('icon', ''),
                        'tier': it.get('inventory', {}).get('tierTypeName', ''), 'flavor': it.get('flavorText', ''),
                        'season': season, 'season_name': season_name.get(season, '') if season else '', 'dyes': dyes})

    doc = {
        'about': "Destiny 2 shaders: each shader's armor and weapon dyes as Bungie's public API publishes them (the item "
                 "definitions and the mobile gear asset files), taken once for LUT Studio's Destiny 2 looks. Reference "
                 "data, not used by the app at run time. Destiny 2 and its content are Bungie's.",
        'source': BNET + '/Platform/Destiny2/Manifest/ (DestinyInventoryItemDefinition, mobileGearAssetDataBases, mobileGearCDN.Gear)',
        'manifest_version': man['version'],
        'channels': 'armor_plate (channel index 0), armor_cloth (1), armor_suit (2), weapon_1..3 (4..6), ship_upper / decals / lower (7..9), sparrow_upper / engine / lower (10..12): community names',
        'count': len(shaders), 'missing': missing, 'shaders': shaders,
    }
    b = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as f, gzip.GzipFile(fileobj=f, mode='wb', compresslevel=9, mtime=0) as z:   # (the same bytes each time)
        z.write(b)
    print(f'{len(shaders)} shaders, {len(missing)} without dye data: {len(b) // 1024} KB of JSON, {os.path.getsize(out) // 1024} KB gzipped -> {out}')


if __name__ == '__main__':
    main()
