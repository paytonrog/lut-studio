"""cityscenes.py: the mega-city scenes of Light: Planets (server/web/planets/planets.json), one per biome whose planets
the game gives a city resource override (sandy_shared_city, glacier_base_city, glacier_coldrocky_city): the biome's own
light, weathers, grading (`grade`: its planets/<id>.png), ground, snow and ground cover, with Super Earth's city as the
big props (its buildings and rubble; the *_city overrides swap only the city's trees and bushes for the biome's).
Run again after planets.json changes: the scenes ("<biome>_city") are replaced, the rest kept.

    python -I tools/cityscenes.py
"""
import copy
import json
from pathlib import Path

PLANETS = Path(__file__).resolve().parents[1] / 'server/web/planets/planets.json'
# biome -> its mega cities' look (theme.js 'Biome: <name> City', on the scene "<name> City")
CITIES = ['sandy_base', 'sandy_spiky', 'sandy_acid', 'sandy_mineral', 'sandy_moon',
          'arctic_glacier_base', 'arctic_glacier_coldrocky', 'arctic_cyberstan']


def main():
    data = json.loads(PLANETS.read_text(encoding='utf-8'))
    planets = [p for p in data['planets'] if not p['id'].endswith('_city')]
    by_id = {p['id']: p for p in planets}
    city = by_id['superearth']
    for biome in CITIES:
        p = copy.deepcopy(by_id[biome])
        p['id'] = biome + '_city'
        p['name'] = by_id[biome]['name'] + ' City'
        p['grade'] = biome
        p['scenery'] = copy.deepcopy(city['scenery'])
        p['hills'] = city.get('hills', 3)
        planets.append(p)
    data['planets'] = planets   # ('size': the grading LUTs' edge, kept)
    with open(PLANETS, 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(json.dumps(data, indent=1))
    print(f'{len(CITIES)} city scenes, {len(planets)} planets')


if __name__ == '__main__':
    main()
