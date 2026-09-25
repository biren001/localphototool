#!/usr/bin/env python3
"""Regenerate every FAQPage entity from the questions actually shown on the page.

The visible <details class="faq__item"> list is the single source of truth.
Hand-editing the JSON-LD alongside it drifted twice: the schema kept older
wording ("Is there a file size or count limit?") after the visible copy had been
rewritten ("Does compressing reduce image quality?"). Search engines and AI
assistants read the schema, not the rendering, so drift means quoting a question
the page no longer asks.

Run after editing any FAQ:
    python _dev/sync-faq-schema.py
"""

import html as htmlmod
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "..", "localphototool")

PAGES = ["index.html", "compress/index.html", "heic-to-jpg/index.html"]

DETAILS_RE = re.compile(
    r'<details class="faq__item"[^>]*>\s*<summary>([\s\S]*?)</summary>\s*'
    r'<div class="faq__body">([\s\S]*?)</div>\s*</details>',
    re.M,
)
LD_RE = re.compile(r'(<script type="application/ld\+json">)([\s\S]*?)(</script>)', re.M)


def text_of(fragment):
    """Visible text of a markup fragment, collapsed to one line."""
    plain = re.sub(r"<[^>]+>", "", fragment)
    plain = htmlmod.unescape(plain)
    return re.sub(r"\s+", " ", plain).strip()


def find_faq_nodes(node, path=()):
    """Yield (container, key) for every FAQPage object inside nested JSON."""
    if isinstance(node, list):
        for i, item in enumerate(node):
            for found in find_faq_nodes(item, path + (i,)):
                yield found
    elif isinstance(node, dict):
        if node.get("@type") == "FAQPage":
            yield node
        for key, value in node.items():
            for found in find_faq_nodes(value, path + (key,)):
                yield found


def sync(rel):
    full = os.path.join(SITE, rel)
    src = open(full, encoding="utf-8").read()

    items = DETAILS_RE.findall(src)
    if not items:
        print("  %-24s no visible FAQ, skipped" % rel)
        return 0

    blocks = LD_RE.findall(src)
    if not blocks:
        print("  %-24s NO JSON-LD BLOCK" % rel)
        return 1

    replaced = 0
    out = src
    for open_tag, body, close_tag in blocks:
        try:
            data = json.loads(body)
        except ValueError as exc:
            print("  %-24s unparseable JSON-LD: %s" % (rel, exc))
            return 1
        nodes = list(find_faq_nodes(data))
        if not nodes:
            continue
        for node in nodes:
            before = [q.get("name") for q in node.get("mainEntity", [])]
            node["mainEntity"] = [
                {
                    "@type": "Question",
                    "name": text_of(q),
                    "acceptedAnswer": {"@type": "Answer", "text": text_of(a)},
                }
                for q, a in items
            ]
            after = [q["name"] for q in node["mainEntity"]]
            if before != after:
                print("  %-24s %d questions synced" % (rel, len(after)))
                for name in after:
                    if name not in before:
                        print("        + %s" % name[:70])
                for name in before:
                    if name not in after:
                        print("        - %s" % name[:70])
        new_body = "\n" + json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        out = out.replace(open_tag + body + close_tag, open_tag + new_body + close_tag, 1)
        replaced += 1

    if not replaced:
        print("  %-24s visible FAQ but no FAQPage entity" % rel)
        return 1

    if out != src:
        open(full, "w", encoding="utf-8", newline="\n").write(out)
    return 0


def main():
    rc = 0
    for rel in PAGES:
        rc |= sync(rel)
    print("\ndone" if rc == 0 else "\nFAILED")
    return rc


if __name__ == "__main__":
    sys.exit(main())
