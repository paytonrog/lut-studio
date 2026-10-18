"""Build the LUT Studio website: dist/web/, a static site (index.html; in a folder named after the build: the
editor's files, the Go program as WebAssembly, Go's wasm_exec.js, THIRD-PARTY-NOTICES.txt). Host it on any static host; for local testing: node tools/webserve.mjs.

    python -I tools/web.py

Built with -tags noembed: filediver's decrypted copies of the game's data-library tables (generated_*.dl_bin) are
left out; LUT Studio reads its items from its own table (data/table.json.gz). The script checks the build settings
for the tag, and writes the license notices of everything linked into lutstudio.wasm.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'web'
WEB = ROOT / 'server' / 'web'
SKIP = set()   # files of server/web/ that stay out of the site
DIRS = {'planets'}   # folders of server/web/ that go in the site (planet lighting data)


def run(cmd, **kw):
    print('>', ' '.join(map(str, cmd)))
    return subprocess.run([str(c) for c in cmd], check=True, text=True, capture_output=True, cwd=ROOT, **kw).stdout


def notices(wasm):
    """The license notices of every module linked into wasm, plus Go itself and the wiki's attachment lists."""
    modcache = Path(run(['go', 'env', 'GOMODCACHE']).strip())
    goroot = Path(run(['go', 'env', 'GOROOT']).strip())
    env = dict(os.environ, GOOS='js', GOARCH='wasm')
    # (go version -m can't read wasm: the same build's packages and modules, from go list)
    emb = run(['go', 'list', '-tags', 'noembed', '-f', '{{.EmbedFiles}}', 'github.com/xypwn/filediver/datalibrary'], env=env)
    if emb.strip() not in ('', '[]'):
        raise SystemExit(f"filediver's datalibrary embeds {emb.strip()} with -tags noembed: the data-library tables")
    out = ['LUT Studio includes the following third-party software.\n']
    # the modules linked into the build, and what each was replaced with (filediver is built from LUT Studio's fork)
    listed = run(['go', 'list', '-tags', 'noembed', '-deps', '-f',
                  '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}}{{with .Replace}} {{.Path}} {{.Version}}{{end}}{{end}}{{end}}',
                  '.'], env=env)
    deps = sorted({tuple((line.split() + ['', '', '', ''])[:4]) for line in listed.splitlines() if line.strip()})
    missing = []
    for mod, ver, rmod, rver in [('golang.org/go', 'stdlib', '', '')] + deps:
        title = f'{mod} {ver}'
        if mod == 'golang.org/go':
            d = goroot
        elif rmod.startswith(('.', '/')) or re.match(r'^[A-Za-z]:', rmod):   # a local checkout (development)
            d = (ROOT / rmod).resolve()
            title = f'{mod}, built from a local checkout of {rmod}'
        else:
            m, v = (rmod, rver) if rmod else (mod, ver)
            esc = re.sub(r'[A-Z]', lambda x: '!' + x.group(0).lower(), m)
            d = modcache / f'{esc}@{v}'
            if rmod:
                title = f'{mod}, built from the fork {rmod} {rver}'
        lic = next((p for p in sorted(d.glob('*')) if re.match(r'(?i)(licen[cs]e|copying)(\.(md|txt))?$', p.name)), None)
        if not lic:
            missing.append(mod)
            continue
        out.append(f'\n{"=" * 78}\n{title}\n{"=" * 78}\n\n' + lic.read_text(encoding='utf-8', errors='replace'))
    if missing:
        raise SystemExit(f'no license file found for: {missing}')
    # the per-weapon attachment lists (game/wikiattach.json) are the Helldivers Wiki's: credit and license
    wa = json.loads((ROOT / 'game' / 'wikiattach.json').read_text(encoding='utf-8'))
    out.append(f'\n{"=" * 78}\nWeapon attachment lists (which attachments each weapon offers, unlock levels)\n{"=" * 78}\n\n'
               f'From the Helldivers Wiki (https://helldivers.wiki.gg), page {wa["source"]}\n'
               f'(revision {wa["revision"]}, {wa["edited"]}): the unlock levels, embedded in LUT Studio (costs left out).\n'
               f'By {wa["license"]}.\n'
               'Non-commercial use only; adaptations of this data must be shared under the same license.\n')
    return ''.join(out), len(deps) + 1


def build_version():
    """The version: "v" and the number of commits of the checked-out branch (CI checks out the whole history), plus
    the 13 releases before the history was restarted (2026-10-16)."""
    try:
        return 'v' + str(13 + int(run(['git', 'rev-list', '--count', 'HEAD']).strip()))
    except (subprocess.CalledProcessError, FileNotFoundError):
        return 'dev'


def main():
    """dist/web/index.html, and every other file in dist/web/<version>-<hash>/ (the page's <base>): a deploy never
    mixes files of two builds from the browser's cache (GitHub Pages lets them be cached for 10 minutes)."""
    if OUT.is_dir():
        shutil.rmtree(OUT)   # (a fixed path under the repo)
    stage = OUT / '_stage'
    stage.mkdir(parents=True)
    wasm = stage / 'lutstudio.wasm'
    version = build_version()
    run(['go', 'build', '-trimpath', '-tags', 'noembed', '-ldflags', f'-s -w -X main.version={version}', '-o', wasm, '.'],
        env=dict(os.environ, GOOS='js', GOARCH='wasm'))
    goroot = Path(run(['go', 'env', 'GOROOT']).strip())
    shutil.copy(goroot / 'lib' / 'wasm' / 'wasm_exec.js', stage)
    for f in WEB.iterdir():
        if f.is_file() and f.name not in SKIP and f.name != 'index.html':
            shutil.copy(f, stage)
        elif f.is_dir() and f.name in DIRS:
            shutil.copytree(f, stage / f.name)
    text, n = notices(wasm)
    (stage / 'THIRD-PARTY-NOTICES.txt').write_text(text, encoding='utf-8')
    h = hashlib.sha256()
    for f in sorted(p for p in stage.rglob('*') if p.is_file()):
        h.update(f.relative_to(stage).as_posix().encode() + f.read_bytes())
    folder = f'{version}-{h.hexdigest()[:10]}'
    stage.rename(OUT / folder)
    page = (WEB / 'index.html').read_text(encoding='utf-8')
    page = page.replace('<head>', f'<head>\n<base href="{folder}/">', 1)
    (OUT / 'index.html').write_text(page, encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')   # (GitHub Pages: serve the files as they are)
    size = (OUT / folder / 'lutstudio.wasm').stat().st_size
    print(f'built {OUT.relative_to(ROOT)} ({folder}: lutstudio.wasm {size / 1e6:.1f} MB; '
          f'{n} licenses; no data-library tables: -tags noembed)')


if __name__ == '__main__':
    sys.exit(main())
