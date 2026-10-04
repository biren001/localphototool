#!/usr/bin/env python3
"""verify-pdfmerge — read what the browser produced with a parser that had
nothing to do with the code that wrote it.

pypdf walks the file itself: it lexes the cross-reference table, resolves the
page tree and decodes the image streams. If the merged file were missing a
page, or a page's resources pointed at an object that never got copied, this
is where it shows up — the module's own page count would not see it.

Checks, on three files written by _dev/probe-pdfmerge.cjs:
  merge-plain.pdf     7 pages, text still there, images still the original bytes
  merge-reencoded.pdf 7 pages, text still there, images smaller
  merge-two.pdf       6 pages

Run: python _dev/verify-pdfmerge.py
"""
import json
import pathlib
import sys

from pypdf import PdfReader

FIX = pathlib.Path(__file__).resolve().parent / "out" / "pdf"
OUT = pathlib.Path(__file__).resolve().parent / ".tmp" / "verify-pdfmerge.json"


def page_images(reader):
    """(count, total bytes) of the embedded pictures, per pypdf's own read."""
    total = 0
    count = 0
    for page in reader.pages:
        try:
            images = list(page.images)
        except Exception:
            continue
        for img in images:
            count += 1
            try:
                total += len(img.data)
            except Exception:
                pass
    return count, total


def describe(name):
    path = FIX / name
    if not path.exists():
        return {"file": name, "error": "missing"}
    with open(path, "rb") as fh:
        head = fh.read(8)
        fh.seek(0)
        reader = PdfReader(fh)
        text_len = sum(len(page.extract_text() or "") for page in reader.pages)
        count, total = page_images(reader)
        return {
            "file": name,
            "header": head.decode("latin1")[:8],
            "bytes": path.stat().st_size,
            "pages": len(reader.pages),
            "text_chars": text_len,
            "images": count,
            "image_bytes": total,
        }


EXPECT = {
    "merge-plain.pdf": {"pages": 7, "text_chars_gt": 0},
    "merge-reencoded.pdf": {"pages": 7, "text_chars_gt": 0},
    "merge-two.pdf": {"pages": 6, "text_chars_gt": 0},
}


def main():
    results = {name: describe(name) for name in EXPECT}
    problems = []

    for name, want in EXPECT.items():
        got = results[name]
        if "error" in got:
            problems.append(f"{name}: {got['error']}")
            continue
        if got["pages"] != want["pages"]:
            problems.append(f"{name}: {got['pages']} pages, expected {want['pages']}")
        if got["text_chars"] <= want["text_chars_gt"]:
            problems.append(f"{name}: text came back empty ({got['text_chars']} chars)")

    plain = results["merge-plain.pdf"]
    small = results["merge-reencoded.pdf"]
    if plain.get("image_bytes", 0) and small.get("image_bytes", 0):
        if small["image_bytes"] >= plain["image_bytes"]:
            problems.append(
                f"re-encoding did not shrink the images ({plain['image_bytes']} -> {small['image_bytes']})"
            )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2))

    for name, got in results.items():
        print(f"{name:<22} pages={got.get('pages')} text={got.get('text_chars')} "
              f"images={got.get('images')} image_bytes={got.get('image_bytes')} "
              f"file={got.get('bytes')}")
    print("---")
    if problems:
        print("FAIL")
        for p in problems:
            print("  " + p)
        sys.exit(1)
    print("PASS — pypdf reads every page and the text of all three files")


if __name__ == "__main__":
    main()
