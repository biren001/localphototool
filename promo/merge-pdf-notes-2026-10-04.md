# Merging several PDFs — what was measured, and what was not

A `promo` note for v83. It exists so the numbers on `/merge-pdf/` can be re-run by
someone who has not read this repository, and so an outreach mail or an answer on a
forum can quote a figure without guessing at one.

## What the page does

A lossless merge copies each document's objects into one numbering space and joins the
pages into a single page tree. That part is what `merge-papers.com`, `digitaltoolpad.com`,
`technosuffice.com`, `pdfguru.online` and `utildaily.com` all advertise, and all five stop
there.

The one that is left open is the step after: **you now have to email the thing, and it is
larger than the documents you dragged in**, because nothing has been re-encoded. So the
page offers the second step — re-encode the pictures inside the merged file once, at the
quality you picked — and claims, with a measurement, that the result comes back smaller
than the parts.

Two things make the join itself safe:

- **Only dictionary text is rewritten.** The raw bytes of each image stream are copied
  verbatim, because a JPEG can legitimately contain the byte sequence `" 0 R"`; rewriting
  that sequence while shifting object numbers corrupts a picture with no error to give it
  away.
- **The cross-reference table is rebuilt from the offsets actually written**, so the text
  stays selectable and the file still opens.

## The fixtures and the numbers

Three A4 documents printed to PDF by the same browser from a seeded random source, merged
and then re-encoded at quality 60 with no downscaling — which is what the form on the page
defaults to.

| Step | Bytes | Note |
| --- | --- | --- |
| `photos.pdf` — four pages of photographs, four images | 1,689,943 | 4 encodable images |
| `mixed.pdf` — a page with a photo and body text around it | 299,733 | 1 encodable image, 2 pages |
| `text-only.pdf` — a page of text, no pictures | 11,381 | nothing to take bytes from |
| **The three parts together** | **2,001,057** | 7 pages, 5 images |
| Merged, losslessly | 2,001,198 | +141 bytes: a new `/Pages` node, a catalog, the page size |
| Merged, then the five pictures re-encoded | **908,204** | 5 replaced, 0 skipped |
| Saving against the parts | 1,092,853 | **54.6% smaller** |
| Two of the three merged, losslessly only | 1,989,869 | 6 pages — the join itself costs nothing |

Per-image figures, the fixtures and the method are kept in `_dev/measured/merge-measurement.json`;
no re-run needs to re-invent them. The merged files are written to `_dev/out/pdf/` so an
independent parser can read them.

**Re-runs land within a few dozen bytes.** Two runs of the same encoder over the same
fixtures came out at 908,204 and 908,211 — the page says so rather than claiming bit
identity.

## How to re-run it

```
NODE_PATH=<workspace node_modules> node _dev/measure-merge.cjs   # the figures above, and a drift check on the page
NODE_PATH=... node _dev/probe-pdfmerge.cjs                       # runs assets/js/pdfmerge.js in a real browser, three ways
python _dev/verify-pdfmerge.py                                   # pypdf reads every page of every result
NODE_PATH=... node _dev/e2e-v83.cjs                              # 21 checks: the page itself merges the fixtures
```

`verify-pdfmerge.py` is deliberately independent of our own parser: pypdf counts the pages,
pulls the text out of each one and sums the image bytes, so a bug in the hand-written xref
rebuild cannot validate itself. That channel caught two real defects before the page was
ever written — a missing `%PDF-` header and a `/Parent` reference printed as `undefined`.

## What the tool will not do, on purpose

- **Encrypted documents are refused, not guessed at.** Their stream lengths and offsets are
  not readable in plain text, so any move would produce a file that will not open. The page
  names the file it could not read and merges the rest.
- **Objects packed into compressed object streams (`/ObjStm`) are opened when the browser
  can inflate them, and counted when it cannot** — never silently dropped.
- **`/SMask`, `/ImageMask` and anything the tool could not read are counted in the result**
  instead of quietly disappearing.
- **A picture-only-safe join never claims a saving it did not take.** The text-only document
  comes back at the same size it went in; the saving simply is not there, and the page says
  so.
- **Document bookmarks across the merged range are not carried over**, which is stated on
  the FAQ rather than omitted.

## Where this differs from the competitors

All five browser mergers we found sell the same sentence: pages copied, nothing re-rendered,
no watermark, unlimited files. That is a real difference from a server upload, but it does
not answer the size question. This page answers both, in one pass, with no upload step —
the file is read with the browser's own file reader and every step happens on the device.

## Not yet measured / not claimed

- **No competitor output was measured on equal footing.** We read what those five pages
  claim; we did not run their merger on these fixtures and weigh the result. Nothing on
  `/merge-pdf/` rests on one.
- **Only `DCTDecode` images are re-encoded**, the same limit `/compress-pdf/` has; lossless
  (`/FlateDecode`) images inside a PDF are counted and left alone.
- **The fixtures are ours**, printed by this browser from a seeded source. Files out of
  Word, a scanner or a heavyweight editor with compressed object streams and incremental
  updates have not been measured end to end.
- **Re-encoding quality was not measured in PSNR on this page.** v79 did that for the second
  pass on plain images; the merge path re-uses that encoder unchanged, so the figures carry
  over, but they were not re-run here.
- **Memory behaviour on a phone** was reasoned about, not measured: five pictures are decoded
  on a canvas, which is a memory job rather than a bandwidth one.
