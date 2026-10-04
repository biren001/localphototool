"""measure-raster-route — put the *other* route on the scale, on the same file.

"compress PDF to 100 KB" is dominated by tools that do one thing: draw each page
on a canvas, re-encode the whole page as a single JPEG, and rebuild the PDF out
of pictures. That route is easy to describe and hard to argue with from the
outside — so instead of quoting their marketing copy, this reproduces the route
here on the same fixtures, with the same 100 KB limit, and reads the result
back with pypdf.

What it does for each fixture:

  1. render every page to a bitmap with pypdfium2 at a given scale
  2. JPEG-encode the bitmap at a given quality
  3. assemble a two-image-page PDF by hand (catalog / pages / page / content
     stream / DCTDecode image xobject) — no text operators are written at all,
     which is precisely what the canvas route produces
  4. shrink scale and quality until the whole file is inside the limit
  5. extract the text back out with pypdf and count characters

Then prints, for each fixture, what the picture route bought in bytes and what
it cost in words, next to the "images only" number measured by
measure-pdf-target.cjs for the same fixture and the same limit.

The point is not to name a competitor. It is to show that the limit is not the
hard part — losing the words is, and the words are optional on the picture route
and not on this one.

Run: python _dev/measure-raster-route.py
"""
import datetime
import io
import json
import os
import sys

from PIL import Image
from pypdf import PdfReader
from pypdfium2 import PdfDocument

WS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(WS, "_dev", "out", "pdf")
OUT = os.path.join(WS, "_dev", "out", "raster")
REPORT = os.path.join(WS, "_dev", "measured", "pdf-raster-route.json")

LIMIT = 100 * 1024
SCALES = [1.5, 1.25, 1.0, 0.75, 0.5]
QUALITIES = [0.9, 0.7, 0.5, 0.35, 0.2, 0.1]

FIXTURES = ["mixed.pdf", "text-only.pdf"]


def render_images(path, scale):
    """Each page as an RGB PIL image at `scale` of its own size."""
    doc = PdfDocument(path)
    images = []
    for i in range(len(doc)):
        img = doc[i].render(scale=scale).to_pil().convert("RGB")
        images.append(img)
    doc.close()
    return images


def jpegs(images, quality):
    data = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=int(quality * 100))
        data.append(buf.getvalue())
    return data


def build_pdf(images, blobs):
    """A hand written PDF: one page per JPEG, drawn to fill the page.

    No font, no text operator, no content stream beyond `q ... cm /Im Do Q`.
    This is the smallest honest representation of "the page is now a picture":
    whatever words were in the original exist only as lit pixels now.
    """
    page_ids = [3 + i * 3 for i in range(len(images))]      # obj 1 catalog, 2 pages
    content_ids = [p + 1 for p in page_ids]
    image_ids = [p + 2 for p in page_ids]

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>"
        % (b" ".join(b"%d 0 R" % p for p in page_ids), len(images))
    ]
    for i, img in enumerate(images):
        w, h = img.size
        pid, cid, iid = page_ids[i], content_ids[i], image_ids[i]
        objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
                    b"/Resources << /XObject << /Im %d 0 R >> >> /Contents %d 0 R >>"
                    % (w, h, iid, cid))
        objs.append(b"q %d 0 0 %d 0 0 cm /Im Do Q" % (w, h))
        objs.append(b"<< /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
                    b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >> stream\r\n%s\nendstream"
                    % (int(w), int(h), len(blobs[i]), blobs[i]))

    out = io.BytesIO()
    header = b"%PDF-1.4\n"
    out.write(header)
    pos = len(header)
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(pos)                    # offsets[i] points at object i
        chunk = b"%d 0 obj\n" % i + body + b"\nendobj\n"
        out.write(chunk)
        pos += len(chunk)

    maxobj = len(objs)
    out.write(b"xref\n0 %d\n" % (maxobj + 1))
    out.write(b"0000000000 65535 f \n")
    for i in range(1, maxobj + 1):
        out.write(b"%010d 00000 n \n" % offsets[i])
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n"
              % (maxobj + 1))
    out.write(b"%d\n" % pos)
    out.write(b"%%EOF\n")
    return out.getvalue()


def extract_chars(path):
    try:
        reader = PdfReader(path)
    except Exception:
        return None
    n = 0
    for page in reader.pages:
        try:
            n += len(page.extract_text() or "")
        except Exception:
            pass
    return n


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    lines = []
    lines.append("fixture           route            bytes   limit   chars in   chars out   inside limit")
    lines.append("-" * 96)

    for name in FIXTURES:
        src = os.path.join(FIX, name)
        base_text = extract_chars(src)

        best = None
        for scale in SCALES:
            images = render_images(src, scale)
            for q in QUALITIES:
                blobs = jpegs(images, q)
                pdf = build_pdf(images, blobs)
                if pdf is None:
                    continue
                ok = len(pdf) <= LIMIT
                if not best and ok:
                    best = {"scale": scale, "quality": q, "bytes": len(pdf)}
                    break
                if best is None and q == QUALITIES[-1] and scale == SCALES[-1]:
                    best = {"scale": scale, "quality": q, "bytes": len(pdf)}
            if best:
                break

        if best is None:
            lines.append("  %-16s  picture  could not fit 100 KB at all" % name)
            rows.append({"fixture": name, "route": "picture", "charsIn": base_text,
                         "charsOut": 0, "bytes": None, "passed": False})
            continue

        images = render_images(src, best["scale"])
        blobs = jpegs(images, best["quality"])
        pdf = build_pdf(images, blobs)
        dest = os.path.join(OUT, name.replace(".pdf", "-picture-100kb.pdf"))
        with open(dest, "wb") as fh:
            fh.write(pdf)
        chars = extract_chars(dest) or 0
        rows.append({"fixture": name, "route": "picture", "scale": best["scale"],
                     "quality": best["quality"], "bytes": len(pdf), "passed": len(pdf) <= LIMIT,
                     "charsIn": base_text, "charsOut": chars})
        lines.append("  %-16s  picture  %8d %7d %10d %11d   %s"
                     % (name, len(pdf), LIMIT, base_text, chars,
                        "yes" if len(pdf) <= LIMIT else "no"))
        lines.append("        -> scale=%.2f quality=%.2f  (this is what a canvas + JPEG page rebuild gives you)"
                     % (best["scale"], best["quality"]))

    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump({"generatedAt": datetime.datetime.now().isoformat(),
                   "limit": LIMIT, "rows": rows}, fh, indent=2)

    lines.append("-" * 96)
    lines.append("same fixture, same 100 KB limit, this site's route is measured by "
                 "_dev/measure-pdf-target.cjs (see _dev/measured/pdf-target.json)")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
