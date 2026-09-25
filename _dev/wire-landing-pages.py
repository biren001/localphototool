#!/usr/bin/env python3
"""Wire the long-tail landing pages into the rest of the site.

A new page is only real once five other places know about it: the sitemap, the
service worker's precache list, llms.txt, the footer of every page, and the
package manifest. Miss one and the page either is never crawled, never works
offline, or silently vanishes from the next upload.

Every step is idempotent, so this can be re-run after regenerating pages.

Run: python _dev/wire-landing-pages.py
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SITE = os.path.join(ROOT, "localphototool")
ORIGIN = "https://localphototool.com"

PAGES = [
    ("compress-to-100kb/", "Compress to 100 KB", "0.8", "weekly"),
    ("png-to-jpg/", "PNG to JPG", "0.8", "weekly"),
    ("jpg-to-webp/", "JPG to WebP", "0.8", "weekly"),
]

# Depth-aware: index.html sits at the root, everything else one level down.
FOOTER_PAGES = [
    ("index.html", ""),
    ("compress/index.html", "../"),
    ("heic-to-jpg/index.html", "../"),
    ("about/index.html", "../"),
    ("privacy/index.html", "../"),
    ("terms/index.html", "../"),
    ("share/index.html", "../"),
    ("compress-to-100kb/index.html", "../"),
    ("png-to-jpg/index.html", "../"),
    ("jpg-to-webp/index.html", "../"),
]

LAST_MOD = "2026-09-20"


def read(rel):
    return open(os.path.join(SITE, rel), encoding="utf-8").read()


def write(rel, text):
    path = os.path.join(SITE, rel)
    if os.path.exists(path) and open(path, encoding="utf-8").read() == text:
        return False
    open(path, "w", encoding="utf-8", newline="\n").write(text)
    return True


def sitemap():
    text = read("sitemap.xml")
    for slug, _label, prio, freq in PAGES:
        url = ORIGIN + "/" + slug
        if url in text:
            continue
        block = (
            "  <url>\n"
            "    <loc>%s</loc>\n"
            "    <lastmod>%s</lastmod>\n"
            "    <changefreq>%s</changefreq>\n"
            "    <priority>%s</priority>\n"
            "  </url>\n" % (url, LAST_MOD, freq, prio)
        )
        text = text.replace("</urlset>", block + "</urlset>")
    return write("sitemap.xml", text)


def llms():
    text = read("llms.txt")
    lines = [
        "- [Compress an image to under 100 KB](%s/compress-to-100kb/): target-size mode, for upload forms with a hard KB limit." % ORIGIN,
        "- [PNG to JPG](%s/png-to-jpg/): converts PNG files to JPG in the browser, in batches." % ORIGIN,
        "- [JPG to WebP](%s/jpg-to-webp/): converts JPG to WebP, typically 25–50%% smaller at the same visual quality." % ORIGIN,
    ]
    for line in lines:
        if line.split("](")[1].split(")")[0] in text:
            continue
        text = text.replace("## Good questions", line + "\n\n## Good questions")
    return write("llms.txt", text)


def service_worker():
    text = read("sw.js")
    for slug, _l, _p, _f in PAGES:
        entry = "  '%s',\n" % slug
        if entry in text:
            continue
        text = text.replace("  'share/',\n", entry + "  'share/',\n")
    return write("sw.js", text)


def footers():
    changed = False
    for rel, prefix in FOOTER_PAGES:
        text = read(rel)
        # Two existing links pointed at /compress/ because no dedicated page
        # existed. Now there is one, they should go to it.
        text = text.replace(
            '<li><a href="%scompress/">Convert to WebP</a></li>' % prefix,
            '<li><a href="%sjpg-to-webp/">JPG to WebP</a></li>' % prefix,
        )
        text = text.replace(
            '<li><a href="%scompress/">Hit a target size</a></li>' % prefix,
            '<li><a href="%scompress-to-100kb/">Compress to 100 KB</a></li>' % prefix,
        )
        additions = [
            ('<li><a href="%scompress-to-100kb/">Compress to 100 KB</a></li>' % prefix,
             '<li><a href="%sheic-to-jpg/">HEIC to JPG</a></li>' % prefix),
            ('<li><a href="%spng-to-jpg/">PNG to JPG</a></li>' % prefix,
             '<li><a href="%sheic-to-jpg/">HEIC to JPG</a></li>' % prefix),
        ]
        for block, anchor in additions:
            if block in text or anchor not in text:
                continue
            text = text.replace(anchor, anchor + "\n          " + block)
        # "PNG optimizer" stays on /compress/ — it is not a format conversion.
        if write(rel, text):
            changed = True
    return changed


def main():
    steps = [
        ("sitemap.xml", sitemap),
        ("llms.txt", llms),
        ("sw.js", service_worker),
        ("page footers", footers),
    ]
    for name, fn in steps:
        print("  %-16s %s" % (name, "updated" if fn() else "already current"))


if __name__ == "__main__":
    main()
