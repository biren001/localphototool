"""Rebuild localphototool-deploy.zip from the localphototool/ folder.

The zip must have the site's files at its top level (index.html first) so that
Cloudflare Pages drag-and-drop sees a ready-to-serve project, and it must
include _worker.js, which is what powers /api/count.

    python _dev/package-zip.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "localphototool")
OUT = os.path.join(ROOT, "localphototool-deploy.zip")

SKIP_DIRS = {"__pycache__", ".git", ".workbuddy", "_dev"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}

entries = []
for base, dirs, files in os.walk(SITE):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        if f in SKIP_FILES:
            continue
        full = os.path.join(base, f)
        rel = os.path.relpath(full, SITE).replace("\\", "/")
        entries.append((rel, full))

# index.html first, then dot/underscore config files, then everything else
def sort_key(item):
    rel = item[0]
    if rel == "index.html":
        return (0, rel)
    if rel.startswith("_"):
        return (1, rel)
    return (2, rel)

entries.sort(key=sort_key)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel, full in entries:
        z.write(full, rel)

size = os.path.getsize(OUT)
print("wrote %s" % OUT)
print("%d files, %.1f KB" % (len(entries), size / 1024))
for rel, _ in entries:
    print("   ", rel)

must = {
    "index.html", "_worker.js", "_headers", "og-cover.jpg",
    "assets/js/stats.js", "assets/js/pwa.js", "assets/js/chime.js", "assets/js/share.js",
    "compress/index.html", "heic-to-jpg/index.html", "sitemap.xml",
    "compress-to-100kb/index.html", "png-to-jpg/index.html", "jpg-to-webp/index.html",
    "compress-without-uploading/index.html",
    # GEO: machine-readable entry point for AI assistants.
    "llms.txt", "robots.txt",
    # The HEIC decoder is self-hosted on purpose: the CDN builds either break
    # under our CSP (heic2any uses new Function) or are three times the size.
    "assets/vendor/libheif-bundle.mjs",
    "stats/index.html", "share/index.html", "share/qr-code-1024.png",
    "share/poster-cn.png", "share/poster-en.png",
    "share/poster-cn-preview.webp", "share/poster-en-preview.webp",
    "sw.js", "offline.html", "site.webmanifest",
    "icon-192.png", "icon-512.png", "maskable-512.png",
}
missing = must - {rel for rel, _ in entries}
if missing:
    raise SystemExit("MISSING from package: %s" % ", ".join(sorted(missing)))
print("all required files present")
