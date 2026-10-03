#!/usr/bin/env python3
"""Find pages that show a visible FAQ but never get their FAQPage schema synced.

sync-faq-schema.py only walks its own PAGES list, and that list is maintained by
hand. Any page added later — a KB landing page, a tool page — keeps whatever
hand-written schema it shipped with, which quietly drifts from the questions the
page actually asks. This audit compares the two lists from the other direction:
walk every page in the checkout, and flag the ones where a visible FAQ exists
but the page is missing from sync-faq-schema.py's PAGES.

Run before touching any FAQ:
    python _dev/audit-faq-sync.py
"""

import json
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'localphototool')
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync-faq-schema.py')

DETAILS_RE = re.compile(r'<details class="faq__item"')
LD_RE = re.compile(r'<script type="application/ld\+json">([\s\S]*?)</script>')

src = open(SRC, encoding='utf-8').read()
block = re.search(r'PAGES = \[([\s\S]*?)\]', src)
listed = set(re.findall(r'"([^"]*?index\.html)"', block.group(1)))


def has_faqpage(body):
    for raw in LD_RE.findall(body):
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if node.get('@type') == 'FAQPage':
                    return True
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
    return False


print('sync-faq-schema.py knows %d pages' % len(listed))
print('\npages with a visible FAQ that are NOT in that list:')

missing = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    rel_dir = os.path.relpath(dirpath, ROOT).replace('\\', '/')
    if rel_dir.startswith('assets') or rel_dir.startswith('vendor'):
        continue
    if 'index.html' not in filenames:
        continue
    rel = rel_dir + '/index.html'
    if rel == './index.html':
        rel = 'index.html'
    body = open(os.path.join(dirpath, 'index.html'), encoding='utf-8').read()
    if not DETAILS_RE.search(body):
        continue
    state = 'has FAQPage, stale' if has_faqpage(body) else 'NO FAQPage entity'
    mark = 'MISSING' if rel not in listed else 'ok     '
    if rel not in listed:
        missing.append(rel)
    print('  %s  %-46s %s (%d visible items)' %
          (mark, rel, state, len(DETAILS_RE.findall(body))))

print('\n%d page(s) need adding to PAGES in _dev/sync-faq-schema.py' % len(missing))
for rel in missing:
    print('   ', rel)
