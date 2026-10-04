# Shrinking a PDF without uploading it — what was measured, and what was not

`promo` note for v80. It exists so the numbers on `/compress-pdf/` can be re-run by
someone who has not read this repository, and so an outreach mail can quote a figure
without guessing at one.

## What the page does

Only the images inside a PDF are re-encoded. A PDF from Word, Google Docs, Keynote, a
scanner or a browser print has already compressed its text once; the bytes that are left
sit in the pictures. So the tool walks the object table, finds the image objects stored as
a plain JPEG, decodes and re-encodes each one at the quality you picked, and writes the
document back out with the page tree, the fonts, the content streams and every other
object copied through untouched.

Because a swapped-in stream moves the offset of every object after it, the file's
cross-reference table is rebuilt from the offsets actually written, not from the old ones.
That is why the text stays selectable and the file still opens: the table is exactly what
a viewer uses to find each object.

## The fixtures and the numbers

Three A4 documents, printed to PDF by the same browser, then run through the tool at
quality 60 with no downscaling — which is what the form on the page defaults to.

| Document | Before | After | Change |
| --- | --- | --- | --- |
| Four photographs, four pages (images = 99.3% of the file) | 1,689,943 | 761,064 | −55.0% |
| One photograph with body text around it | 299,733 | 135,558 | −54.8% |
| Text only, no pictures at all | 11,381 | 11,381 | unchanged |
| The four photos capped at a 1000 px edge | 1,689,943 | 242,999 | −85.6% |
| The four photos capped at 1600 px / 640 px | 1,689,943 | 449,206 / 134,226 | −73.4% / −92.1% |

Per-image figures, the fixtures and the method are kept in
`_dev/measured/pdf-recompression.json`; no re-run needs to re-invent them.

## How to re-run it

```
node _dev/test-pdfcompress.cjs     # 39 checks: parsing, xref rebuild, refusal paths
python _dev/verify-pdf.py          # 29 checks: pypdfium2 renders, pypdf reads, PIL measures pixel error
node _dev/e2e-v80.cjs              # 38 checks: the page itself runs the fixtures
```

`verify-pdf.py` is deliberately independent of our own parser — it renders with
pypdfium2, reads structure with pypdf and computes the mean absolute error with PIL, so a
bug in the hand-written xref rebuild cannot validate itself.

## What the tool will not do, on purpose

These are stated on the page rather than hidden, because each one is a case where a
clever rewrite would produce a file that does not open:

- **Encrypted or password-protected PDFs are refused.** The stream lengths and offsets are
  no longer readable in plain text, so any change would yield a document that will not open.
- **Text-only documents are handed back byte for byte.** There is nothing to take bytes
  from. The tool says so instead of shipping something bigger and calling it compression.
- **Images with an alpha channel attached (`/SMask`), one-bit masks (`/ImageMask`) and
  objects packed into compressed object streams (`/ObjStm`) are counted and left alone**,
  not guessed at.

## Where this differs from the competitors

Most PDF compressors asked of their pages upload the document to a server, re-encode on a
backend and hand back a link. This one has no upload step at all: the file is read with the
browser's own file reader and every step happens on the device. The practical difference is
what happens at 06:00 on a train, and what happens to a document you would rather not put
on someone else's disk.

## Not yet measured / not claimed

- No comparison has been run against TinyPNG, iLoveIMG or any other site's PDF tool; none
  of the numbers on this page rests on one.
- Documents scanned with a lossless encoder inside the PDF (e.g. `/FlateDecode` images)
  are not re-encoded yet — only `DCTDecode` images are.
- The optional WASM codecs the image engine can pull from a public CDN were not reachable
  from the machine these numbers were taken on, so every figure above comes from the
  browser's own JPEG encoder. A faster codec would change the bytes, not the method.
