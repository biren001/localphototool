# v84 — hit an exact KB limit on a PDF without losing the words

Date: 2026-10-04. Page: `/compress-pdf-to-100kb/`. Engine:
`localphototool/assets/js/pdftarget.js`.

## Why this page

`_dev/audit-pdf-competitors.cjs` (14 PDF vendors, sitemap + intent count)
showed that split / rotate / protect / unlock / sign / to-word / pdf-to-jpg are
everyone's — not a gap. The gap is a *query shape*, found by SERP reversal on
"compress pdf to 100kb online free no upload": the top five are all
low-authority browser tools (compresspdfto100kb.com, textify.tools,
resizepdf.in, kisspdf.net, scanpilot.ai) and **every one of them takes the same
route** — render each page to a canvas, encode the page as one JPEG, rebuild the
PDF out of pictures. Which is exactly the route that destroys the text.

So the page had to be built on a measured contrast, not on that claim. Three
independent measurements back it:

1. `_dev/measure-pdf-target.cjs` — can this site's route hit a target at all
2. `_dev/verify-pdf-target.py` — read the result back with **pypdf**, a parser
   that knows nothing about our code, and check the words are still there
3. `_dev/measure-raster-route.py` — reproduce the *canvas* route on the same
   fixtures with pypdfium2 + Pillow, at the same limit, and read it back too

## Measurement 1 — the target search works (shipped module, metadata kept)

Run `NODE_PATH=<workspace node_modules> node _dev/measure-pdf-target.cjs`.
Search = `pdftarget.shrinkToFit`: walk quality 90→8, stop at the first that
fits; only if quality cannot get there, step down the edge ladder
1600/1200/1000/800/640/480 and take the widest rung that still fits.
`dropMetadata: false` on every row, matching the page's default.

Every row is measured **twice, once per JPEG encoder**, because the site's
encoder prefers its WASM module whenever that module has downloaded and a module
is a download. That is not a footnote — it is the reason the page prints two
families of numbers. See the last section of this file.

| fixture | in | target | native (first run) | q | edge | wasm | q | edge |
|---|---|---|---|---|---|---|---|---|
| photos.pdf | 1,689,943 | 100 KB | **70,401** | 0.15 | 800 | **76,677** | 0.15 | 1000 |
| photos.pdf | 1,689,943 | 200 KB | **197,939** | 0.30 | 1200 | **144,763** | 0.15 | 1600 |
| photos.pdf | 1,689,943 | 500 KB | **491,351** | 0.30 | 0 | **423,414** | 0.30 | 0 |
| mixed.pdf | 299,733 | 100 KB | **89,559** | 0.30 | 0 | **100,684** | 0.45 | 0 |
| mixed.pdf | 299,733 | 200 KB | **174,091** | 0.75 | 0 | **161,235** | 0.75 | 0 |
| mixed.pdf | 299,733 | 500 KB | **283,032** | 0.90 | 0 | **381,077** | 0.90 | 0 |
| text-only.pdf | 11,381 | any | **11,381** (returned) | — | — | 11,381 | — | — |

Every figure above is inside its limit. Note that **no codec wins every time**:
on the four photos at 500 KB the first run is the smaller file, on the two-page
document at 500 KB the module is, and at 100 KB on the two-page document the
module buys a *higher* quality (45 against 30). The page says so rather than
quoting one figure as if every visitor would see it.

Fixtures: three A4 documents from the browser's own print-to-PDF, in
`_dev/out/pdf/`. mixed.pdf = one photograph + 3,001 characters of body text on
two pages.

## Measurement 2 — pypdf reads the words back

Run `python _dev/verify-pdf-target.py` (managed venv — `pypdf` is not in the
system Python). Every target file: opens, keeps its page count, and is inside
its limit.

| file | chars in | chars out |
|---|---|---|
| mixed.pdf 100 KB | 3,001 | **3,001** |
| text-only.pdf 100 KB | 746 | **746** |
| photos.pdf 100 KB | 31 | 31 |

The check that matters: a 100 KB target on a document that is *mostly words*
lands inside the limit with the words intact — which is the thing the canvas
route cannot do.

## Measurement 3 — the other route, reproduced here

Run `python _dev/measure-raster-route.py`. pypdfium2 renders each page, PIL
JPEG-encodes it, a hand-written PDF puts the JPEGs back as full pages with no
text operators at all. Then pypdf extracts:

| same fixture, same 100 KB limit | this route | canvas route |
|---|---|---|
| two pages, one photo, 3,001 chars | 89,559 B — 3,001 readable | 84,252 B — **0** readable |
| one page, no photos, 746 chars | 11,381 B (original handed back) — 746 readable | 79,348 B — **0** readable |

The picture route *did* fit, both times. It got there by spending the text. The
page says exactly that, and says the canvas column is our own reproduction of
the technique rather than a teardown of any vendor's build (the vendors are
quoted separately, from their own copy).

## Honest boundaries (all on the page)

- 100 KB = 102,400 bytes, and the tool compares against that, not 100,000.
  The page prints both figures.
- A document with no encodable images is handed back byte for byte;
  text-only.pdf is 11,381 B and stays 11,381 B at every target.
- `/Encrypt` documents are refused, not guessed at.
- `/ObjStm` / awkward images (alpha, one-bit masks) are counted and reported,
  not silently dropped.
- Only `DCTDecode` image streams are rewritten; fonts, content streams and the
  page tree are copied through.
- When a target is unreachable the tool reports the floor it reached instead of
  handing back something over the limit.

## Not tested — do not claim these

- No side-by-side against the five ranking tools on identical inputs; the
  comparison is our reproduction of the technique plus their own copy.
- No PSNR / visual-difference measurement between quality rungs; the argument
  is about text survival, not about which JPEG looks better.
- No mobile memory profiling — the four-photo fixture at 100 KB is ~10 encodes
  in a browser tab, untested on a phone.
- The 100 KB numbers are reproducible in shape, not byte-identical: quality
  ladders land on the same rung, the encoder leaves a few dozen bytes of
  slack. The page does not quote a guaranteed byte count.
- Probe harness (`_dev/probe-pdftarget.cjs`) runs with `dropMetadata: true`,
  so its figures are ~10% lower than the table above. Do not mix them.
- The page quotes the **native (first-run)** figures and names the WASM ones
  beside them. A live run on this page prints whichever encoder the session
  happens to have, and the result card says which one, so the two can never be
  confused with each other.
- The WASM row means "the module had downloaded". Inside one compressed call the
  engine still uses native for the *first* image of a multi-image document when
  the module arrives mid-run, so a row like `photos 100 KB wasm` is "every image
  after the first". Single-image fixtures (mixed.pdf) are clean either way.
- `_dev/.tmp/*.cjs` probes from this afternoon are throwaway differential
  scripts (diff-target / seq-target / iso-target). Nothing in `_dev/.tmp` ships.

## Bugs found on the way (all fixed, all worth remembering)

- **v1 of pdftarget counted anything it had measured as the answer**, so a
  100 KB request on the photo fixture returned 196,661 B and reported success.
  "Found" is now strictly `bytes <= limit`.
- **The quality sweep was reversed**, so the search returned the *smallest*
  quality that fit — the photo fixture came back at q=0.08 even at a 200 KB
  limit where q=0.45 was reachable and twice as sharp.
- **The measurement script carried its own copy of the search** (a second
  binary search over quality). v83 already burned us on this in
  `measure-merge.cjs`; the harness now loads `assets/js/pdftarget.js` and calls
  the function the page calls.
- **sw.js precached `assets/css/style.css?v=240af0b?v=ef78fa7`** — a doubled
  query string, so it never matched the `?v=<commit>` the pages request and
  every precached CSS/JS URL 404'd at install time. Fixed to single `?v=`.
- **`var run = document.getElementById('ptRun')` collided with
  `function run(quiet)`** in the same scope: one binding, so the hoisted
  function replaced the button and the click listener was attached to the
  function. The button looked live and did nothing. Renamed to `runBtn`.
- **The page and the measurement script disagreed for an afternoon (89,559 vs
  100,684 on the same fixture, same target, same module).** Both were right,
  because they ran under different encoder states: `engine.encodeCanvas` uses
  the WASM module only when the module has already loaded (engine.js, the note
  above line 320: a pending CDN fetch must never delay the first compression).
  A new visitor is native, a visitor who came from a page that preloads the
  codec is wasm, and the search lands on a different quality rung as a result.
  Fixed by threading `allowWasm` from the caller through `pdftarget` into
  `pdfcompress` into `encodeCanvas`, so both states are measured on purpose and
  the page prints both. **Any measurement that compares sizes across
  re-encodes has to pin the codec first**, or the numbers move under it.
