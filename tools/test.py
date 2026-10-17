"""LUT Studio's automated tests, in three tiers (see TESTING.md):

  python tools/test.py unit      # no game needed: gofmt, go vet, Go unit tests, JS syntax + unit tests
  python tools/test.py install   # + tests that read the game install (read-only): LUTSTUDIO_GAME or Steam's path
  python tools/test.py e2e       # + the website in headless Chrome (builds dist/web; Chrome / Edge / Chromium)
  python tools/test.py all       # every tier (the default)

Settings, projects and caches of the tests go to scratch folders, never the user's. Exit code 0 = all passed."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STEAM = Path(r'C:\Program Files (x86)\Steam\steamapps\common\Helldivers 2')
TIERS = ['unit', 'install', 'e2e']


def run(name, cmd, env=None, cwd=ROOT):
    print(f'\n== {name}: {" ".join(str(c) for c in cmd)}', flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env)
    ok = r.returncode == 0
    print(f'== {name}: {"ok" if ok else "FAILED"}', flush=True)
    return ok


def game_dir():
    d = os.environ.get('LUTSTUDIO_GAME') or (str(STEAM) if (STEAM / 'data').is_dir() else '')
    return d if d and (Path(d) / 'data').is_dir() else ''


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if want not in TIERS + ['all']:
        sys.exit(__doc__)
    upto = len(TIERS) if want == 'all' else TIERS.index(want) + 1
    scratch = Path(tempfile.mkdtemp(prefix='lutstudio-test-'))
    env = dict(os.environ, LUTSTUDIO_CONFIG_DIR=str(scratch / 'config'), )
    env.pop('LUTSTUDIO_GAME', None)
    results = []

    # --- unit: no game
    fmt = subprocess.run(['gofmt', '-l', '.'], cwd=ROOT, capture_output=True, text=True).stdout.split()
    print(f'\n== gofmt: {"ok" if not fmt else "unformatted: " + " ".join(fmt)}')
    results.append(('gofmt', not fmt))
    results.append(('go vet', run('go vet', ['go', 'vet', './...'], env)))
    results.append(('go test (unit)', run('go test (unit)', ['go', 'test', '-count=1', './...'], env)))
    web = ROOT / 'server' / 'web'
    js_ok = all(subprocess.run(['node', '--check', str(f)]).returncode == 0 for f in sorted(web.glob('*.js')) + sorted(web.glob('*.mjs')))
    print(f'\n== node --check server/web: {"ok" if js_ok else "FAILED"}')
    results.append(('js syntax', js_ok))
    schema = scratch / 'schema.json'
    run('schema for the JS tests', ['go', 'test', '-count=1', './server', '-run', 'TestSchemaDump'],
        dict(env, LUTSTUDIO_SCHEMA_OUT=str(schema)))
    results.append(('js unit', run('js unit', ['node', '--test', 'tools/jstest/web.test.mjs'], dict(env, LUTSTUDIO_SCHEMA=str(schema)))))

    # --- install: read-only tests against the game
    if upto >= 2:
        gd = game_dir()
        if not gd:
            print('\n== install: SKIPPED (no game: set LUTSTUDIO_GAME)')
            results.append(('install (skipped: no game)', True))
        else:
            ienv = dict(env, LUTSTUDIO_GAME=gd, LUTSTUDIO_CACHE_DIR=str(scratch / 'cache'))
            results.append(('go test (install)', run('go test (install)', ['go', 'test', '-count=1', '-timeout', '20m', './...'], ienv)))

    # --- e2e: the app in a browser
    if upto >= 3:
        gd = game_dir()
        if not gd:
            print('\n== e2e: SKIPPED (no game)')
            results.append(('e2e (skipped: no game)', True))
        else:
            # the website as published (tools/web.py: dist/web), the install served to it by tools/webserve.mjs
            if run('build site', [sys.executable, '-I', 'tools/web.py'], env):
                results.append(('e2e', run('e2e', ['node', 'tools/e2e.mjs', scratch / 'screenshots'], dict(env, LUTSTUDIO_GAME=gd))))
            else:
                results.append(('build site', False))

    print('\n== summary')
    for name, ok in results:
        print(f'  {"PASS" if ok else "FAIL"}  {name}')
    failed = [n for n, ok in results if not ok]
    # removes only its own scratch folder: a lutstudio-test-* folder directly inside the system temp folder
    tmp = Path(tempfile.gettempdir()).resolve()
    if not failed and scratch.resolve().parent == tmp and scratch.name.startswith('lutstudio-test-'):
        shutil.rmtree(scratch, ignore_errors=True)
    else:
        print(f'  scratch kept for inspection: {scratch}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
