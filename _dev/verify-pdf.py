"""verify-pdf — judge the v80 PDF output with libraries we did not write.
   _dev/verify-pdf.py  ·  run:  <venv>/python _dev/verify-pdf.py

   test-pdfcompress.cjs proves the rewrite is self-consistent: every xref entry
   lands on the object it claims. That is not the same as being a document a
   viewer will open, so this script opens each pair with pypdfium2 (which
   renders) and pypdf (which walks the structure):

     1. both files open, and report the same page count
     2. the output still renders — a blank page means the image was replaced
        with an empty canvas, the single most likely failure mode
     3. the pixels it renders are close to the input's (mean absolute error)
     4. the text is still there — copying objects through keeps it selectable
     5. the object structure still lists the same number of images

   Exit code is non-zero on any failure. Numbers go to stdout, verdicts too.
"""
import io
import os
import sys

from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader
import pypdfium2 as pdfium

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "pdf")


def render(path, page=0, scale=1.0):
    doc = pdfium.PdfDocument(path)
    n = len(doc)
    pil = doc[page].render(scale=scale).to_pil().convert("RGB")
    doc.close()
    return n, pil


def text_len(path):
    try:
        return len(PdfReader(path).pages[0].extract_text() or "")
    except Exception:
        return -1


def images(reader):
    """count image XObjects the reader can see on the first page"""
    try:
        return len(list(reader.pages[0].images))
    except Exception:
        return -1


def blankness(img):
    st = ImageStat.Stat(img)
    return sum(st.stddev) / 3.0


def mae(a, b):
    diff = ImageChops.difference(a, b)
    st = ImageStat.Stat(diff)
    return sum(st.mean) / 3.0


PASS = FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print("  ok   %s%s" % (name, ("  — " + detail) if detail else ""))
    else:
        FAIL += 1
        print("  FAIL %s  — %s" % (name, detail))


PAIRS = [
    ("photos.pdf", "photos.out.pdf"),
    ("mixed.pdf", "mixed.out.pdf"),
    ("text-only.pdf", "text.out.pdf"),
    ("photos.pdf", "downscale.out.pdf"),
    ("photos.pdf", "keepmeta.out.pdf"),
    (None, "synth.out.pdf"),          # synthetic file, nothing to compare with
    (None, "encrypted.pdf"),          # refused input, must still open
]

print("verify-pdf — pypdfium2 renders, pypdf parses")
print("  looking in: %s" % OUT)
if not os.path.isdir(OUT):
    print("  ...that directory is not there")

print("")

for pair in PAIRS:
    if not pair:
        continue
    src, out = pair
    op = os.path.join(OUT, out)
    if not os.path.exists(op):
        print("  skip %s (not written)" % out)
        continue
    sp = None if src is None else os.path.join(OUT, src)
    if src is None:
        # nothing to compare against: just prove the file opens and renders
        print("[%s] (no baseline)" % out)
        try:
            n, img = render(op)
            check("opens and renders", n > 0, "%d pages" % n)
            check("page is not blank", blankness(img) > 2, "stddev %.1f" % blankness(img))
        except Exception as exc:
            check("opens and renders", False, "%s: %s" % (type(exc).__name__, exc))
        print("")
        continue
    if not (os.path.exists(sp) and os.path.exists(op)):
        print("  skip %s -> %s (not written)" % (src, out))
        continue
    print("[%s -> %s]" % (src, out))

    s_size = os.path.getsize(sp)
    o_size = os.path.getsize(op)

    print("     %d -> %d bytes (%+.1f%%)" % (s_size, o_size, 100.0 * (o_size - s_size) / max(1, s_size)))

    # 1. opens, same page count
    try:
        sn, simg = render(sp)
        on, oimg = render(op)
        check("both open and agree on the page count", sn == on, "%s vs %s" % (sn, on))
    except Exception as exc:
        check("both open and agree on the page count", False, "%s: %s" % (type(exc).__name__, exc))
        continue

    # 2. the output is not a blank page
    ob = blankness(oimg)
    check("output page is not blank", ob > 8, "standard deviation %.1f" % ob)

    # 3. pixels close to the original
    m = mae(simg, oimg)
    check("renders close to the input (mean abs error)", m < 40.0, "%.2f/255" % m)

    # 4. text still there
    st, ot = text_len(sp), text_len(op)
    check("text survives", st >= 0 and ot >= 0 and ot >= st - max(8, st * 0.05), "chars %s -> %s" % (st, ot))

    # 5. same picture count
    try:
        si = len(list(PdfReader(sp).pages[0].images))
        oi = len(list(PdfReader(op).pages[0].images))
        check("same number of images on page 1", si == oi, "%s vs %s" % (si, oi))
    except Exception as exc:
        check("same number of images on page 1", False, str(exc))

    print("")

print("verify-pdf: pass %d / fail %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
