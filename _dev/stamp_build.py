"""Stamp every page with the date it was built and the git commit it came from.

The homepage footer then reads:

    (c) 2026 LocalPhotoTool.com   Updated 29 Sep 2026 . build 314baba   Made for people ...

Two rules make this worth automating rather than typing by hand:

1. The stamp has to change on every deploy, or it says nothing. Left to a human
   it drifts, and a stale date on a privacy site is worse than no date at all.
2. It is written into every page, and every page is in the service worker's
   precache shell -- so whenever the stamp moves, sw.js's VERSION has to move
   with it, or returning visitors keep reading last week's build number out of
   cache. That is exactly the mistake this file exists to prevent.

    python _dev/stamp-build.py          write the stamp, bump sw.js if it moved
    python _dev/stamp-build.py --dry    print what would happen, change nothing

Called automatically at the top of package-zip.py, so packaging always ships a
stamp that matches the zip.
"""
import datetime
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "localphototool")

# Every page ends its footer identically; the stamp goes right after the
# copyright and before the spacer that pushes the slogan to the right edge.
ANCHOR = '<span>&copy; <span data-year>2026</span> LocalPhotoTool.com</span>'
# The opening tag carries a title attribute, so the pattern cannot end at
# 'class="build-stamp"' -- matching only the bare tag would miss every stamp
# already written and try to insert a second one.
STAMP_RE = re.compile(r'<span class="build-stamp"[^>]*>.*?</span>', re.S)
VERSION_RE = re.compile(r"var VERSION = 'v(\d+)';")

# Asset URLs carry ?v=<commit> so a deploy is never eaten by caches that only
# saw the old file. Why this is not paranoia: /assets/* used to ship a 24h
# edge+browser TTL with bare URLs, so for a day after every deploy the pages
# were new but the JS was old (2026-09-30: the watermark live preview drew
# nothing because the cached engine.js predated drawWatermark). Only js/css
# under assets/ is versioned -- transfer/ keeps its own ?v= scheme for
# ./app.js, and the 1.4MB libheif bundle stays bare so it is not re-downloaded
# on every release.
ASSET_REF = re.compile(
    r'((?:src|href)=")((?:\.\./)?assets/(?:js|css)/[^"?]+?\.(?:js|css))(\?v=[0-9A-Za-z_.-]+)?(")')
SHELL_REF = re.compile(
    r"('assets/(?:js|css)/[^'?]+?\.(?:js|css))(\?v=[0-9A-Za-z_.-]+)?(')")

# strftime('%b') is locale-dependent and returns Chinese under a zh-CN Windows
# locale, so the month names are spelled out here instead.
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _git(*args):
    try:
        out = subprocess.run(['git'] + list(args), cwd=ROOT,
                             capture_output=True, text=True, timeout=30)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def build_id():
    """Return (hash, dirty). hash is None when git is unavailable."""
    short = _git('rev-parse', '--short=7', 'HEAD')
    # Run before any file is rewritten, otherwise this script's own edit makes
    # the tree look dirty.
    dirty = bool(_git('status', '--porcelain'))
    return (short or None), dirty


def stamp_html(commit, dirty, today=None):
    today = today or datetime.date.today()
    day = '%d %s %d' % (today.day, MONTHS[today.month - 1], today.year)
    iso = today.isoformat()
    if commit is None:
        inner = 'Updated <time datetime="%s">%s</time>' % (iso, day)
        title = 'Built %s (git unavailable)' % iso
        return ('<span class="build-stamp" title="%s">%s</span>' % (title, inner))
    title = 'Built from git commit %s' % commit
    if dirty:
        title += ' with uncommitted local changes'
    inner = ('Updated <time datetime="%s">%s</time> &middot; build '
             '<code>%s</code>%s' % (iso, day, commit, '+' if dirty else ''))
    return '<span class="build-stamp" title="%s">%s</span>' % (title, inner)


def pages():
    out = [os.path.join(SITE, 'index.html')]
    for name in sorted(os.listdir(SITE)):
        sub = os.path.join(SITE, name, 'index.html')
        if os.path.isfile(sub):
            out.append(sub)
    return out


def version_asset_refs(text, ver, pattern, close_group):
    """Rewrite every asset URL to ...?v=ver, replacing any older ?v=.

    close_group is the index of the closing-quote group: 4 for ASSET_REF,
    3 for SHELL_REF. Group 2 (an older ?v=) is optional and comes back as
    None when the URL was still bare.
    """
    return pattern.sub(
        lambda m: m.group(1) + (m.group(2) or '') + '?v=' + ver +
                  m.group(close_group), text)


def apply_stamp(dry=False, today=None):
    today = today or datetime.date.today()
    commit, dirty = build_id()
    stamp = stamp_html(commit, dirty, today=today)
    asset_ver = commit or today.strftime('d%Y%m%d')

    changed = []
    for path in pages():
        src = open(path, 'r', encoding='utf-8').read()
        if STAMP_RE.search(src):
            new = STAMP_RE.sub(stamp, src, count=1)
        else:
            anchor = ANCHOR + '\n      <span class="sep"></span>'
            if src.count(anchor) != 1:
                raise SystemExit('%s: expected exactly one footer anchor, found %d'
                                 % (path, src.count(anchor)))
            new = src.replace(anchor, ANCHOR + '\n      ' + stamp +
                              '\n      <span class="sep"></span>', 1)
        new = version_asset_refs(new, asset_ver, ASSET_REF, 4)
        if new != src:
            changed.append(os.path.relpath(path, ROOT).replace('\\', '/'))
            if not dry:
                open(path, 'w', encoding='utf-8', newline='').write(new)

    # The SW's precache list must request the exact same versioned URLs the
    # pages ask for, or the precached copies are dead weight for offline use.
    sw = os.path.join(SITE, 'sw.js')
    sw_src = open(sw, 'r', encoding='utf-8').read()
    sw_new = version_asset_refs(sw_src, asset_ver, SHELL_REF, 3)
    shell_changed = sw_new != sw_src
    if shell_changed and not dry:
        open(sw, 'w', encoding='utf-8', newline='').write(sw_new)
    if shell_changed:
        changed.append('localphototool/sw.js (asset refs)')

    bumped = None
    if (changed or shell_changed) and not dry:
        src = sw_new if shell_changed else sw_src
        m = VERSION_RE.search(src)
        if not m:
            raise SystemExit('sw.js: could not find var VERSION')
        bumped = 'v%d' % (int(m.group(1)) + 1)
        open(sw, 'w', encoding='utf-8', newline='').write(
            VERSION_RE.sub("var VERSION = '%s';" % bumped, src, count=1))
    elif changed:
        sw = os.path.join(SITE, 'sw.js')
        m = VERSION_RE.search(open(sw, 'r', encoding='utf-8').read())
        bumped = 'v%d' % (int(m.group(1)) + 1) if m else '?'

    return {'stamp': stamp, 'commit': commit, 'dirty': dirty,
            'changed': changed, 'sw_version': bumped}


def main():
    dry = '--dry' in sys.argv
    r = apply_stamp(dry=dry)
    plain = re.sub(r'<[^>]+>', '', r['stamp']).replace('&middot;', '.')
    print('stamp    %s' % plain)
    print('commit   %s%s' % (r['commit'] or '(none)', ' +uncommitted' if r['dirty'] else ''))
    print('pages    %d changed%s' % (len(r['changed']), ' (dry run)' if dry else ''))
    if r['sw_version']:
        print('sw.js    -> %s%s' % (r['sw_version'], ' (would bump)' if dry else ''))
    if not r['changed']:
        print('nothing to do: the stamp already matches this build')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
