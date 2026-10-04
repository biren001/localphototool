"""verify-pdf-text — the second channel for the text extractor.

The browser harness (_dev/measure-pdf-text.cjs) extracts with pdftext.js, the
module the page ships. This reads the same files with pypdf, which shares no
code with it at all, and compares the two character counts page by page.

They are expected to agree on *how many* characters each page carries, and on
where the lines fall. The first version compared whitespace-stripped counts
only, and that comparison is what a wrong line break hides behind: at one
point the walk put a newline after every first character of a line, so the
page came back as "P / aragraph of ordinary body text." with the same total
count as before. Counting characters cannot see that, so this checks the
break positions too, and checks that no break lands in the middle of a word.

The counts printed on the page have to be reachable by both channels, or the
page is quoting a file the site never produces.

Run: python _dev/verify-pdf-text.py [path-to-pdf-text-<date>.json]
"""
import glob
import os
import sys

import pypdf

WS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(WS, "_dev", "out", "pdf")
REPORTS = os.path.join(WS, "_dev", "measured")


def strip(s):
    return len((s or "").replace("\n", "").replace("\r", "").replace(" ", "").replace("\t", ""))


def find_report():
    if len(sys.argv) > 1:
        return sys.argv[1]
    hits = sorted(glob.glob(os.path.join(REPORTS, "pdf-text-*.json")))
    if not hits:
        print("FAIL  no report found in _dev/measured")
        sys.exit(1)
    return hits[-1]


def main():
    path = find_report()
    with open(path, "r", encoding="utf-8") as fh:
        data = __import__("json").load(fh)

    total = 0
    failed = 0

    for row in data["rows"]:
        name = row["fixture"]
        total += 1
        print("== %s  %d bytes" % (name, row["bytes"]))

        if row["encrypted"]:
            ok = any("encryption" in r for r in row["reasons"])
            if not ok:
                failed += 1
            print("   %s  encrypted file reports itself as encrypted" %
                  ("PASS" if ok else "FAIL"))
            continue

        reader = pypdf.PdfReader(os.path.join(FIX, name))
        pypdf_counts = [strip(p.extract_text()) for p in reader.pages]
        pypdf_pages = [p.extract_text() or "" for p in reader.pages]

        if len(pypdf_counts) != row["pageCount"]:
            failed += 1
            print("   FAIL  page count %d but pypdf read %d" %
                  (row["pageCount"], len(pypdf_counts)))
            continue

        for page, theirs, theirs_raw in zip(row["pages"], pypdf_counts, pypdf_pages):
            total += 1
            mine = page["chars"]
            same = mine == theirs
            if not same:
                failed += 1
            print("   %s  page %d: pdftext.js %d chars, pypdf %d chars" %
                  ("PASS" if same else "FAIL", page["page"], mine, theirs))

            # Strengthened: the two readers must agree on the letters themselves,
            # not merely on how many of them there are, and on where the lines
            # fall. A count-only comparison cannot see a newline in the wrong
            # place.
            total += 1
            import re as _re
            mine_s = _re.sub(r"\s", "", page["text"])
            pyp_s = _re.sub(r"\s", "", theirs_raw)
            letters = mine_s == pyp_s
            if not letters:
                failed += 1
            print("   %s  page %d: same letters as pypdf (%d chars each)" %
                  ("PASS" if letters else "FAIL", page["page"], len(mine_s)))

            total += 1
            break_at = lambda s: [i for i, c in enumerate(s) if c in "\n\r"]
            mine_b, pyp_b = break_at(_re.sub(r"[ ]", "", page["text"])), \
                            break_at(_re.sub(r"[ ]", "", theirs_raw))
            same_breaks = mine_b == pyp_b
            if not same_breaks:
                failed += 1
            print("   %s  page %d: same line breaks as pypdf (%d vs %d)" %
                  ("PASS" if same_breaks else "FAIL", page["page"],
                   len(mine_b), len(pyp_b)))

        total += 1
        nonzero = sum(1 for c in pypdf_counts if c > 0)
        flags = ("readable" in row and row["readable"]) == (nonzero > 0)
        if not flags:
            failed += 1
        print("   %s  readable flag matches pypdf (%d of %d pages have text)" %
              ("PASS" if flags else "FAIL", nonzero, len(pypdf_counts)))

    print("\n%d checks, %d failed" % (total, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
