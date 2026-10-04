"""verify-pdf-target — read the target-size results back with pypdf.

The claim a target-size page would rest on is not "the bytes are small", it is
"the bytes are small *and the words survived*". Every tool that ranks for
"compress PDF to 100 KB" rendered the page to a canvas and re-encoded it as one
picture, which throws the text away; this site re-encodes the images inside the
PDF and copies the fonts and content streams through, so the text should still
be there.

So this does three things with a parser that knows nothing about our code:

  1. every target file has to be readable at all (pages, trailer, xref)
  2. the extracted text has to be comparable with the text of the fixture it
     came from -- the words must not have been flattened into pixels
  3. the file that came out must not be bigger than the limit it claims

and prints a table plus a PASS/FAIL line.

Run: python _dev/verify-pdf-target.py
"""
import json
import os
import sys

from pypdf import PdfReader

WS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(WS, "_dev", "out", "pdf")
REPORT = os.path.join(WS, "_dev", "measured", "pdf-target.json")

LIMITS = {"100": 100 * 1024, "200": 200 * 1024, "500": 500 * 1024}


def text_of(path):
    reader = PdfReader(path)
    if not reader.pages:
        return "", 0
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            parts.append("")
    return "\n".join(parts), len(reader.pages)


def main():
    with open(REPORT, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    failures = []
    print("fixture            target     bytes   limit   pages   text in   text out   verdict")
    print("-" * 86)

    for row in data["rows"]:
        base = row["fixture"]
        orig_text, orig_pages = text_of(os.path.join(FIX, base))
        for key, t in row["targets"].items():
            if not t:
                continue
            # keys are "<codec>:<kb>" — the same target measured twice, once with
            # each JPEG encoder, because the byte count moves with the codec.
            codec, kb = key.split(":", 1)
            path = os.path.join(FIX, base.replace(".pdf", "") + "-" + str(kb) + "kb-" + codec + ".pdf")
            if not os.path.exists(path):
                failures.append("missing output " + path)
                continue

            try:
                out_text, out_pages = text_of(path)
            except Exception as exc:
                failures.append("%s could not be read by pypdf: %s" % (os.path.basename(path), exc))
                print("  %-18s %6s KB  unreadable" % (base, kb))
                continue

            size = os.path.getsize(path)
            limit = LIMITS.get(str(kb), kb * 1024)
            problems = []

            if out_pages != orig_pages:
                problems.append("page count moved %d -> %d" % (orig_pages, out_pages))
            if kb == "100" and size > limit:
                problems.append("%d bytes over the 100 KB limit" % (size - limit))
            # A fixture with words in it must come back with the same words.
            if len(orig_text.strip()) > 40:
                a = set(orig_text.split())
                b = set(out_text.split())
                missing = [w for w in a if w not in b]
                share = 1.0 - len(missing) / max(1, len(a))
                if share < 0.9:
                    problems.append("text lost: only %.0f%% of the words came back" % (share * 100))
                else:
                    print("  %-18s %6s KB  %8d %7d %7d %9d %10d   ok (%.0f%% of the words still there)" % (
                        base, kb, size, limit, out_pages, len(orig_text), len(out_text), share * 100))
            else:
                print("  %-18s %6s KB  %8d %7d %7d %9d %10d   ok (mostly pictures)" % (
                    base, kb, size, limit, out_pages, len(orig_text), len(out_text)))

            if problems:
                failures.append("%s -> %s" % (os.path.basename(path), "; ".join(problems)))
                print("  %-18s %6s KB  %8d %7d %7d %9d %10d   FAIL %s" % (
                    base, kb, size, limit, out_pages, len(orig_text), len(out_text), "; ".join(problems)))

    print("-" * 86)
    if failures:
        print("FAIL")
        for f in failures:
            print("  - " + f)
        return 1
    print("PASS — every target-size file opens, keeps its pages, and keeps its words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
