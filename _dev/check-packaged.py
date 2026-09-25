#!/usr/bin/env python
"""Report local site sources that are newer than the deploy zip.

Anything newer than the zip is work that exists on disk but was never packaged,
i.e. a deploy that would silently ship an older build.
"""
import os
import time
import zipfile

ZIP = 'localphototool-deploy.zip'
SRC = 'localphototool'

zip_mtime = os.path.getmtime(ZIP)
print('zip built:', time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(zip_mtime)))
print()

newer = []
for root, dirs, files in os.walk(SRC):
    for f in files:
        p = os.path.join(root, f)
        m = os.path.getmtime(p)
        if m > zip_mtime + 2:
            rel = os.path.relpath(p, SRC).replace(os.sep, '/')
            newer.append((time.strftime('%Y-%m-%d %H:%M', time.localtime(m)), rel))

if newer:
    print('!! site sources newer than the zip (NOT packaged yet):')
    for t, p in sorted(newer, reverse=True):
        print('   ', t, p)
else:
    print('OK  no site source is newer than the zip -> disk fully packaged')

print()
z = zipfile.ZipFile(ZIP)
names = z.namelist()
print('zip entries:', len(names), '| first entry:', names[0])

# Newest mtime inside the zip, as recorded at package time.
# zipfile hands back a 6-tuple, and a year below 1970 is a sign of a malformed
# archive; clamp the year so strftime never raises on it.
newest = max(z.infolist(), key=lambda i: i.date_time)
y, mo, d, h, mi, _ = newest.date_time
print('newest entry in zip:', newest.filename, '%04d-%02d-%02d %02d:%02d' % (max(y, 1980), mo, d, h, mi))

# A top-level index.html is mandatory: Cloudflare Pages treats the zip root as
# the site root, so a nested folder would publish an empty site.
print('top-level index.html present:', 'index.html' in names)
nested = [n for n in names if n.startswith('localphototool/')]
print('wrongly nested entries:', len(nested))
