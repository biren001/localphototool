# pdf text check — what this page is, and what it refuses to be

v83 answered "how do I put these files together". Nothing on the results page
answers the question that comes before it: *why can't I select the text in
this file?* The five extractors that rank for `extract text from pdf online
free tool` (online-tech-tips, runfreetools, fileconvertfree, webtexttools,
freetextextract) all do the same shape of thing — take the file, hand back a
box of words — and freetextextract says out loud that a page with no text layer
gets "sent to Google's Gemini API for a second attempt". That is a decision
worth naming, and this page names it instead of hiding behind it.

## The gap

Every one of them is an extractor. An extractor answers "give me the words" and
says nothing about why a particular file gives none. A person arrives after
highlighting a line that will not highlight, pasting into something, getting an
empty box. The question underneath is *which of five things is stopping this
file*, and nobody answers it.

So the page answers that, before extracting anything.

## What the page does

`/why-cant-i-select-the-text-in-this-pdf/` opens the file in the tab, reads the
drawing operators on every page, and reports — per page:

- how many characters it carries, and the verbatim words where there are any
- which pages have no text, and the reason each one gives up
- every font on the page, and whether it has a character map
- how many object streams the file packs its objects into
- whether an encryption dictionary is present

Five causes, in the order they show up in real files: the page is a picture
(a scan), the page's own objects are packed into an object stream, the font has
glyphs but no character map, the document is encrypted, the structure did not
survive the file.

## What it deliberately does not do

It does not run OCR. Reading letters back out of a picture is not something a
browser can do without a model measured in megabytes, and shipping one here
would either cost the visitor that download or make a network call with their
document attached — the trade the extractors mostly make, one way or the other.
The page says this in plain words rather than pretending to be a reader it is
not.

It also does not rewrite the file. Once the cause is known, the next move belongs
to whoever made the document, and the tools here are for what you do afterwards:
shrink a PDF without flattening the words, hit an upload limit and keep the
text, put a corrected page back with the rest.

## The measured numbers

Every figure on the page came out of the shipped module and was matched by a
second, independent PDF reader (pypdf) run separately on the same files. Where
the two disagree on line breaks they are expected to: one watches the vertical
position drop, the other has its own idea of where a paragraph ends, and neither
claims to reflow the text.

| file | page 1 | page 2 | note |
| --- | --- | --- | --- |
| mixed.in.pdf | 2,432 | 76 | words around a photograph, then a short paragraph |
| text-only.pdf | 603 | — | text, no pictures |
| photos.in.pdf | 6 | 6 / 6 / 6 | four photographs, a caption each |
| encrypted.pdf | — | — | refused as encrypted, not reported as empty |

`_dev/measure-pdf-text.cjs` produces these; `_dev/verify-pdf-text.py` checks
them and now compares the letters themselves and the line-break positions, not
just the count of characters — a count-only comparison is blind to a newline in
the wrong place, which is exactly the bug this page had.

## Bugs the measurements caught

1. **`/Filter` was tested against the compressed stream, not the dictionary.**
   The filter name is written in the object's dictionary; the data is `78 9C`
   and nothing else. Testing the data never matches, so the compressed bytes
   went straight into the text walk. Every page came back with zero words and
   no note at all — the worst kind of failure, because it reports "this file has
   no text" when the truth was "this file would not open".
2. **`beginbfrange` was read backwards.** `<lo> <hi> <dstStart>` counts up one
   character per code; taking the `<hi>` as the destination filled a single
   entry and produced a line of the same letter.
3. **ToUnicode is asynchronous.** The font object was replaced by the promise
   that fills it, so every glyph translated to nothing — again indistinguishable
   from "no text layer" unless you look.
4. **Line breaks.** `Td` carries an offset, not an origin, so `8 0 Td` was read
   as a drop to y=0 and every line was split after its first character
   ("P / aragraph of ordinary body text."). Fixing that alone took the whole
   page to zero newlines, because the fixtures open every line with `ET … BT`
   and the reset on `BT` had erased the position record. The rule that works:
   a line ends when the baseline moves by more than half the type size, `BT`
   clears only the operand queue, and a fresh line's matrix is compared against
   the line before it even though the text block reopened.

The last one is the honest lesson for this site: a page that counts characters
can be wrong in the way that matters and still look right.

## Status

`_dev/e2e-v85.cjs` — 25/25, including "an encrypted file is reported as
encrypted, not as empty" and "the cards are numbered in document order, not by
PDF object number". Full regression green: test-pages 214/214, audit-nav
36/36, check-listing-copy 42/42, audit-overflow clean, audit-faq-sync with
nothing to add, coverage-check with zero misses across all nine query groups,
and the e2e series v77 240 / v79 44 / v80 38 / v83 21 / v84 25 / v85 25.
