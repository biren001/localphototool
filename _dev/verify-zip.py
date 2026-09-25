"""Verify the deploy zip mirrors the site exactly and carries today's fixes.

Two-way diff on purpose: drag-and-drop upload is a whole-package replace, so both
directions matter — a file missing from the zip disappears from the live site.
"""
import hashlib
import os
import re
import zipfile

ZIP = 'localphototool-deploy.zip'
SITE = 'localphototool'

disk = set()
for root, _dirs, files in os.walk(SITE):
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), SITE)
        disk.add(rel.replace(os.sep, '/'))

with zipfile.ZipFile(ZIP) as z:
    names = [n for n in z.namelist() if not n.endswith('/')]
    inzip = set(names)
    print('zip entries:', len(names))
    print('index.html at zip top level:', 'index.html' in inzip)
    print('on disk but NOT in zip:', sorted(disk - inzip) or '(none)')
    print('in zip but NOT on disk:', sorted(inzip - disk) or '(none)')

    sw = z.read('sw.js').decode('utf-8')
    print('zip sw.js VERSION:', re.search(r"var VERSION = '([^']+)'", sw).group(1))
    # The bug that shipped: a comment terminator in the middle of the header.
    print('zip sw.js header comment intact:', 'engine.js).  */' not in sw and 'engine.js).\n' in sw)
    zsw = hashlib.sha256(z.read('sw.js')).hexdigest()

dsw = hashlib.sha256(open(os.path.join(SITE, 'sw.js'), 'rb').read()).hexdigest()
print('sw.js sha256 disk == zip:', dsw == zsw, dsw[:16])

for f in ['assets/js/compressor/engine.js', 'assets/js/compressor/app.js',
          'assets/js/compressor/worker.js']:
    with zipfile.ZipFile(ZIP) as z:
        zsh = hashlib.sha256(z.read(f)).hexdigest()
    dsh = hashlib.sha256(open(os.path.join(SITE, f), 'rb').read()).hexdigest()
    print(f, 'disk == zip:', zsh == dsh)

# The new budgets and the reason map have to be in the packaged engine.
eng = open(os.path.join(SITE, 'assets/js/compressor/engine.js'), encoding='utf-8').read()
print('engine has split budgets:', 'WASM_FETCH_TIMEOUTS' in eng and 'WASM_WARM_TIMEOUTS' in eng)
print('engine avif fetch budget:', re.search(r'WASM_FETCH_TIMEOUTS = \{[^}]*avif: (\d+)', eng).group(1))
print('engine reports reasons:', 'reasons: Object.assign' in eng)
