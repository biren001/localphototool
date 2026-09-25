# LocalPhotoTool — distribution kit

The site is live and shareable. **As of 2026-09-24 it is also being indexed:**
Google Search Console reports **8 of the 13 sitemap URLs indexed**, with the
remaining 5 split between two rows that mean two different things — see §4 for
how to read them. A brand-new domain reaching 8 indexed pages within 24 hours
of submitting a sitemap is faster than the 1–2 weeks this file used to predict,
and it settles the question the earlier sections were built around: **discovery
and indexing are working, and they are no longer what to spend time on.** What
remains is authority, and authority means links. That is what this file is
for now.

§4 is ordered for a **mainland-China connection**, and the reachability column
is measured, not assumed. Re-measured 2026-09-23: **all 16 channels answer**,
including Hacker News, Reddit, Product Hunt, AlternativeTo and Medium, which
had no route when this table was first written. A 403 means reachable but
bot-protected — that blocks a script, not a person in a browser. Re-run
`node _dev/check-reachability.cjs` before trusting any cell here.

Everything in a `copy` block below is **machine-checked** against its
platform's character limit:

```
node _dev/check-listing-copy.cjs
```

Edit the copy in this file, re-run the checker, paste the block. Nothing else
holds a copy of these strings.

Two other commands this plan depends on:

```
node _dev/check-reachability.cjs    # which channels answer from here
node _dev/indexnow-submit.cjs       # push all 13 sitemap URLs to Bing/Yandex
```

---

## 1. The one sentence

Every listing must agree on this, because repetition across independent sources
is what makes a tool feel real to both readers and search engines.

> **LocalPhotoTool is a free image compressor that runs entirely in your
> browser — there is no upload endpoint, so your photos cannot leave your
> device even by accident.**

Two supporting facts, measured by our own scripts (`_dev/measured/`):

- A straight-from-camera JPEG shrinks **24–54%** in Auto mode as WebP,
  **41–68%** as AVIF, while staying above a ~40 dB fidelity floor.
- At equal measured fidelity (40 dB), **AVIF needs ~26% fewer bytes than
  MozJPEG**; WebP lands about level with it.

## 2. Claims we do **not** make

This is the guardrail list. Every item here was either measured false or is
unverifiable, and publishing it would undo the trust the rest of the site buys.

| Don't say | Why |
| --- | --- |
| "Up to 90% smaller" | Only true for PNG screenshots (70–96%). Not a photo claim. |
| "WebP is 25–50% smaller than JPEG" | Measured false at equal PSNR: WebP came out **24% larger** than MozJPEG. That figure compares against *baseline* JPEG with SSIM. |
| "Unlimited file size" | Real limit is device memory, roughly 80 megapixels. |
| "Compresses every HEIC" | libheif handles standard HEIF; exotic variants can fail. |
| "Lossless compression" | Default Auto mode is lossy with a perceptual floor. PNG *output* is lossless. |
| "Faster than TinyPNG" | Never benchmarked against them. Don't. |
| Any user count / testimonial | We have ~40 visitors and no quotes. Inventing either ends the project's credibility. |

---

## 3. Copy blocks

### Tagline — 60 character limit (Product Hunt, directories)

```copy name=tagline limit=60
Compress images in your browser — nothing is uploaded
```

### Short description — 160 character limit (meta, directories, AlternativeTo)

```copy name=short limit=160
Free image compressor that runs in your browser. Nothing is uploaded — HEIC, JPEG, PNG, WebP and AVIF are processed on your own device, in batches.
```

### Medium description — 300 character limit (directory listings, GitHub PRs)

```copy name=medium limit=300
LocalPhotoTool compresses and converts images without uploading them. There is no upload endpoint: decoding and re-encoding run in your browser via WebAssembly codecs (MozJPEG, libheif for HEIC, AVIF). Free, no account, no watermark, no file limit, exact-KB target mode, works offline.
```

### Long description — 700 character limit (About fields, launch posts)

```copy name=long limit=700
Most image compressors upload your photos to a server and send them back. LocalPhotoTool has no server to upload to: decoding and re-encoding run in your browser via WebAssembly builds of MozJPEG, libheif (iPhone HEIC) and AVIF, so a file cannot leave your device even by accident.

Auto mode measures each image and picks the lowest quality that still clears a ~40 dB fidelity floor, rather than applying one preset to everything. Measured: a camera JPEG shrinks 24–54% as WebP and 41–68% as AVIF; an already-optimised photo comes back unchanged rather than larger.

Free, no account, no watermark, no file limit; EXIF and GPS stripped; batch and ZIP export.
```

### Show HN title — 80 character limit

```copy name=hn-title limit=80
Show HN: LocalPhotoTool – an image compressor that never uploads your files
```

### Show HN body — 1200 character limit (the first comment)

```copy name=hn-body limit=1200 refutes
I built this because I wanted a compressor I could verify was not sending my photos anywhere. Most say "your files are deleted after an hour", which is a promise, not a property. This one has no upload endpoint in the codebase, so it is a property — the WASM decoders and encoders (MozJPEG, libheif for HEIC, AVIF) run in the browser.

Two things surprised me while measuring it:

- The widely repeated "WebP is 25-50% smaller than JPEG" did not hold up. At equal PSNR, WebP came out about 24% larger than MozJPEG. That figure is against baseline JPEG encoders, not an optimised one.
- Auto mode needed the same encoder as the final write. My first version probed quality through the browser canvas; no browser encodes AVIF natively, so the canvas silently substituted another format, the probe "passed", and the result was 33 dB when the page promised 40.

Happy to answer questions about the WASM setup or the fidelity measurement.
```

### X / Twitter post — 280 character limit

```copy name=x-post limit=280
Most image compressors upload your photos. This one has no upload endpoint at all — MozJPEG, libheif and AVIF run in your browser via WASM.

Free, no account, no watermark, HEIC included. Works offline once installed.
```

### Reddit — r/SideProject

```copy name=reddit-sideproject-title limit=300
I built a free image compressor where your files never leave your browser
```

```copy name=reddit-sideproject-body limit=2000 refutes
I kept using online compressors and kept not being sure what happened to the files afterwards. "Deleted after an hour" is a policy, not a guarantee, and I could not check it.

So I built one where the upload step does not exist. Decoding, resizing and re-encoding all run client-side with WebAssembly codecs — MozJPEG for JPEG, libheif for iPhone HEIC, plus WebP and AVIF encoders. EXIF and GPS get stripped, which is a nice side effect: phone photos carry the coordinates where you took them.

A few things I got wrong and fixed, in case anyone is building something similar:

1. Auto quality used to probe with the browser's native canvas. No browser encodes AVIF natively, so the canvas silently swapped formats, the probe "passed", and the binary search settled on a quality that produced a 33 dB file while the page promised ~40 dB. The probe now uses the same encoder as the final write.
2. I published "WebP is 25-50% smaller than JPEG" for a while. When I actually measured it at equal PSNR against MozJPEG, WebP came out about 24% *larger*. That figure compares against baseline JPEG encoders. I rewrote the page.
3. The mobile version deliberately withholds ZIP export on iOS, because the Files app does not unpack archives into the photo library. Downloading 40 files one by one is annoying; handing someone a ZIP they cannot open is worse.

It is free with no account and no file limit. Feedback on the fidelity numbers is especially welcome — those are the part I care most about being right.
```

### Reddit — r/InternetIsBeautiful

```copy name=reddit-iib-title limit=300
Compress and convert images entirely inside your browser, with no upload step
```

### Reddit — r/privacy

```copy name=reddit-privacy-title limit=300
A free image compressor with no upload endpoint, so photos stay on your device
```

```copy name=reddit-privacy-body limit=2000
Something I wanted to exist and could not find: an image tool where "we do not store your files" is a property of the architecture rather than a promise in a privacy policy.

LocalPhotoTool has no upload endpoint. I mean that literally — there is no server-side image code in the codebase. Decoding and re-encoding run in the browser through WebAssembly (MozJPEG, libheif for HEIC, AVIF). If you block all network requests after the page loads, it still works.

On the personal-data side, since this is r/privacy:

- EXIF and GPS are stripped from the output, and camera orientation is applied to the pixels first so portrait photos stay upright. Removing metadata without applying the orientation flag gives you sideways photos.
- The site sets no cookies and loads no third-party analytics or fonts. The only server component is an aggregate daily-unique visit counter that stores a salted hash and nothing else — no IP, no user agent, no per-file data.
- The one thing it does not do: it cannot verify you are not running it on a compromised machine. Nothing client-side can.
```

### dev.to article — 4000 character limit

The dev audience wants the build story and the two measurement corrections,
not a launch announcement. This is the one block that is long enough to carry
the numbers table, so it is also the most quotable source for anyone writing
about the tool later.

```copy name=devto-post limit=4000 refutes
I built an image compressor that cannot upload your photos

Every image compressor I tried makes the same promise: "your files are deleted after an hour." That is a policy, not a property. I could not verify it, and I was compressing photos I would rather not have on someone else's server.

So I built one where the upload step does not exist. There is no server-side image code at all — decoding, resizing and re-encoding run in the browser through WebAssembly builds of MozJPEG, libheif for iPhone HEIC, and an AVIF encoder. If you block every network request after the page loads, it still works.

"Your files are deleted after an hour" is a promise. This is a property: there is no endpoint in the codebase to delete files from.

## Two bugs I shipped before I measured anything

1. Auto mode used to probe quality through the browser's native canvas. No browser encodes AVIF natively, so the canvas silently substituted another format, my probe reported a lossless pass, and the binary search settled on a quality that produced a 33 dB file while the page promised about 40 dB. The fix is not subtle: the probe has to use the same encoder as the final write.

2. I published "WebP is 25-50% smaller than JPEG" for a while. When I measured it at equal PSNR against MozJPEG, WebP came out about 24% *larger*. That figure is not invented — it compares against baseline JPEG encoders, not an optimised one. I rewrote the page rather than keep the nicer-sounding number.

## What it actually does, measured

Rather than copy figures from a comparison table, I built a small corpus of camera photos and measured each case:

- Camera JPEG to WebP, Auto mode: 24-54% smaller
- Camera JPEG to AVIF, Auto mode: 41-68% smaller
- An already-optimised photo: returned unchanged rather than re-compressed larger

Auto mode aims at a 40 dB PSNR floor. That floor is the reason an already-optimised photo comes back unchanged: there is no quality left to give without dropping below it, and re-encoding to hit a number would make the file worse.

EXIF and GPS are stripped, with camera orientation applied to the pixels first — removing metadata without applying the orientation flag hands you sideways photos. Batch processing, ZIP export on desktop (deliberately withheld on iOS, because the Files app will not unpack an archive into the photo library), and installable as a PWA.

## The honest limits

- Not "unlimited file size". The real ceiling is device memory, roughly 80 megapixels.
- Not "every HEIC". libheif handles standard HEIF; exotic variants can fail.
- Default Auto mode is lossy. PNG output is lossless.

Free, no account, no watermark, no file-count limit. If you want to argue with my numbers, the measurement scripts are in the repo.

Live: https://localphototool.com
```

### Indie Hackers post — 1200 character limit

Shorter and blunter than the dev.to piece. Indie Hackers rewards admitting
what is going badly, so the last line names distribution as the unsolved part
rather than pretending launch went well.

```copy name=ih-post limit=1200 refutes
I kept using online image compressors and kept not knowing what happened to my photos afterwards. "Deleted after an hour" is a policy I cannot verify.

So I built LocalPhotoTool: there is no upload endpoint. Decoding and re-encoding run in the browser via WebAssembly (MozJPEG, libheif for iPhone HEIC, AVIF). Block all network requests after page load and it still works.

Two things I got wrong by not measuring:

- Auto mode probed quality through the browser canvas. No browser encodes AVIF natively, the canvas silently swapped format, the probe passed, and output came out at 33 dB while the page promised 40. The probe now uses the same encoder as the final write.
- I published "WebP is 25-50% smaller than JPEG". At equal PSNR against MozJPEG it measured 24% larger. That figure is against baseline encoders.

Measured on my own corpus: a camera JPEG shrinks 24-54% as WebP and 41-68% as AVIF, and an already-optimised photo is returned unchanged instead of being re-compressed larger.

Free, no account, no file limit. Traffic is still tiny — distribution is the hard part here, not the build.
```

### Pull request description — awesome-privacy

Written for awesome-privacy, the only list left that is open to us. Keep the
disclosure line: it is the difference between a listing and undisclosed
self-promotion.

The target is `## Photo Editing and Management` → `#### Web`, **not** the
`### Images` heading sitting under `## Cloaking`. That one is cloaking tools —
Fawkes, ImageScrubber — and a compressor does not belong in it; an earlier
revision of this file said it did, from matching the heading name alone. `#### Web`
holds one entry today, miniPaint, and its description makes the same promise ours
does. The same section's Android list already carries a compressor (ImagePipe:
"reduces image size and removes exif-tags"), so the fit is established, not
argued.

```copy name=pr-body limit=1000
Adds LocalPhotoTool to the Web subsection of Photo Editing and Management.

Why it belongs here: it compresses and converts JPEG, PNG, WebP, HEIC and AVIF in the browser without uploading anything. Decoding and re-encoding run locally through WebAssembly builds of MozJPEG, libheif and an AVIF encoder, so there is no upload endpoint in the codebase at all — not a policy of deleting files after an interval, but no server to send them to. It replaces the hosted compressors people reach for by default (TinyPNG, iLoveIMG, Squoosh), handles HEIC input, which most browser-only tools do not, and strips EXIF and GPS data from the result.

It meets the three listing requirements: it has a privacy policy, the site sets no cookies and loads no third-party scripts, and the source is public under MIT. It is a static site, so it is self-hostable.

Full disclosure: I maintain it. Happy to change the wording or move it to another section.
```

### The line to add — awesome-privacy, `#### Web` under `## Photo Editing and Management`

One line, on the line immediately after `miniPaint`. The list's own rule is one
sentence saying what the tool does and what it replaces, with the licence and
whether it is self-hostable. `pr-lint` needs a ` - ` before the description, and
its lychee link check hard-fails on 404/410 and on dead domains, so both URLs
have to answer — `localphototool.com` and the repository do.

```copy name=awesome-privacy-entry limit=400
- [LocalPhotoTool](https://localphototool.com) - Compresses and converts JPEG, PNG, WebP, HEIC and AVIF in your browser with nothing uploaded, stripping EXIF and GPS from the result ([source](https://github.com/biren001/localphototool), MIT, self-hostable).
```

### GitHub repository README

The README of the public repo is the Tier 1 channel: its link to the live site
is what lets Google learn the domain exists without a Search Console account.
No platform limit applies — the `limit` here is our own ceiling so it cannot
grow into documentation. `README.md` at the repository root is generated from
this block and checked against it, so edit the copy here, not there.

```copy name=github-readme limit=4000
# LocalPhotoTool

**Compress images in your browser — nothing is uploaded**

Free image compressor that runs in your browser. Nothing is uploaded — HEIC, JPEG, PNG, WebP and AVIF are processed on your own device, in batches.

**Live: https://localphototool.com**

## Why this one is different

Most image compressors upload your photos to a server and send them back. LocalPhotoTool has no server to upload to: decoding and re-encoding run in your browser via WebAssembly builds of MozJPEG, libheif (iPhone HEIC) and AVIF, so a file cannot leave your device even by accident.

"Your files are deleted after an hour" is a promise. This is a property — there is no upload endpoint in the codebase to delete files from.

## What it does

- Compresses JPEG, PNG, WebP and AVIF, and converts between them
- Reads iPhone HEIC files, decoded locally rather than through a CDN build
- **Auto mode** measures each image and picks the lowest quality that still clears a ~40 dB fidelity floor, instead of applying one preset to everything
- Can target an exact size, e.g. get a photo under 100 KB
- Batch processing with ZIP export on desktop; the mobile version withholds ZIP on iOS on purpose, because the Files app does not unpack archives into the photo library
- EXIF and GPS stripped, with camera orientation applied to the pixels first so portrait photos stay upright
- Installable as a PWA and works offline
- Free, no account, no watermark, no file-count limit

## Measured, not claimed

The figures on the site are reproducible from the measurement scripts, not copied from a comparison table:

| Case | Result |
| --- | --- |
| Camera JPEG to WebP, Auto mode | 24–54% smaller |
| Camera JPEG to AVIF, Auto mode | 41–68% smaller |
| An already-optimised photo | returned unchanged rather than re-compressed larger |

Auto mode aims at ~40 dB PSNR. That floor is why an already-optimised photo comes back unchanged: there is no quality left to give without dropping below it.

The corpus behind those numbers is not in this repository — seven camera photos, 7.6 MB, and not mine to redistribute. Put your own photos in `_dev/corpus/` and the same scripts will measure them the same way.

## Privacy

- No upload endpoint, no cookies, no third-party analytics or fonts
- The only server-side component is an aggregate daily-unique visit counter that stores a salted hash and nothing else — no IP, no user agent, no per-file data
- Blocking all network requests after the page loads still leaves the tool working
```

---

## 4. Channel playbook

Ordered by return per unit of effort. Do them top to bottom; do not skip to the
bottom of the list because the top ones need a bit of writing.

### Tier 1 — do these first

**Read the reachability column first.** It is measured from a mainland-China
connection (`node _dev/check-reachability.cjs`), and it reorders this list —
which is why Google Search Console now sits at the top instead of near the
bottom: it was unreachable when this table was first written, and it is not
anymore. Re-run that script before trusting any cell marked "likely".

| Channel | What it needs | Why it is first | From mainland China |
| --- | --- | --- | --- |
| **GitHub** | A public repo + README with the live URL | **Already done** (2026-09-22). Google discovers a brand-new host by following a link from a page it already crawls, and github.com is re-crawled continuously; dev.to and Indie Hackers work the same way. Search Console is what tells Google to come look — this is the other half, the link it follows once it does. **Measured 2026-09-23: GitHub puts `rel="nofollow"` on both the README link and the About website link, so this is discovery only — it passes no ranking signal. Every awesome-list PR is a GitHub link and so is worth exactly the same: discovery, not authority.** | ✅ reachable |
| **IndexNow** | The key file at the site root (already generated) | One unauthenticated POST pushes all 13 URLs into Bing, Yandex, Seznam and Naver at once — no account, no dashboard. `node _dev/indexnow-submit.cjs` does it. This is the only *submission* channel available without a VPN, because Google's equivalent (the sitemap ping endpoint) was retired in June 2023 and now 404s. | ✅ reachable |
| **Bing Webmaster Tools** | Microsoft account — **no DNS record needed** | Bing's index is what feeds Copilot, ChatGPT search and Yahoo, which is most of the "AI recommends a tool" surface. **Done 2026-09-24.** The property was already registered — the dashboard opens with `localphototool.com/` in the site picker — and the sitemap turns out to have been submitted and read already: status `Success`, 13 URLs. So the "pick *Import from Google Search Console*" step an earlier revision of this row described was never missing: **Import lives in the add-a-site wizard and disappears once the site is registered**, which is precisely why it could not be found. All 13 URLs were then resubmitted through the URL-submission API (quota is 100/day and 700/month, so 13 is free). | ✅ done |
| **Bing inbound-link count** (the number to move) | `node _dev/bing-webmaster.cjs urlinfo` | **All 13 pages report `AnchorCount: 0`.** Not "few links" — Bing has seen *no* inbound link to any page, a week after discovery. This is the measured form of "the site has no authority yet", and it is the one number this whole file exists to change. Read it against what is *not* on the suspect list: the pages are not near-duplicates (20.9% max), not thin (1100–2516 words), all declare canonicals, and the sitemap reads fine. | re-check after each submission |
| **Bing Webmaster API key** | <https://www.bing.com/webmasters> → **Settings (gear, top right) → API Access → generate** | **Configured 2026-09-24** at `_dev/.tmp/bing-api-key.txt` (gitignored; the script prints only a 4-character fingerprint, never the value). Worth it even though the dashboard works: it turned the Bing side from a black box into the only channel that reports per-URL crawl state, and it is what surfaced the 4-of-13 crawl gap and the zero inbound links above. Commands: `sites` (confirms registration), `sitemap-list` / `sitemap-submit`, `quota`, `urls --apply` (all 13 URLs, dry run by default), `urlinfo` (per-URL crawl state), `crawl`, `stats`, `query-stats`, and `raw <Method> k=v` as an escape hatch. The key is **per-user, not per-site** — `sites` lists every property on the account, not just this one. Note that **Microsoft's guidance as of Nov 2025 is that IndexNow is the preferred real-time channel**, which we already push to; the API is for reading results, not a replacement. | ✅ done |
| **dev.to** and **Indie Hackers** | An account | Both give a followed link on a domain Google re-crawls daily, plus an English dev audience that actually needs this tool. dev.to post: the build story + the two measurement corrections in §2. | ✅ reachable |
| **Google Search Console** | Google account — the DNS TXT was already in Cloudflare, so no verification step was needed | **Done 2026-09-23, and reporting 2026-09-24.** Sitemap read: 13 URLs discovered. Request Indexing submitted for the 8 priority URLs. This is the only channel that pushes to Google at all, and the only one where you can *ask* for a crawl instead of waiting to be found. **First index count arrived the next day: 8 indexed, 5 not** — so the old note that this takes 1–2 weeks was wrong for a domain this small, and there is nothing left to fix on the pages themselves. See the reading guide below before treating any of the remaining 5 as a problem. | ✅ done |
| **Show HN** | HN account (aged is better), `hn-title` + `hn-body` | One front-page hit beats 50 directory listings. Post Tue–Thu, 8–10am ET. | ✅ reachable (re-measured 2026-09-23; was ❌ before) |
| **r/SideProject**, **r/InternetIsBeautiful**, **r/privacy** | Reddit account with some history | The copy above is calibrated for it: build story + what went wrong. | ✅ reachable (403 to a script, fine in a browser) |

**Measured 2026-09-23: dev.to withholds `noindex, nofollow` until a post has
traction.** Every article we sampled from `dev.to/api/articles/latest` carried
both tags — 6/6, with tags and without alike — while every article from
`?top=7` was clean, 8/8, down to one that was 23.8 hours old with 27 reactions,
and two old posts were clean too. So it is not the tag list and not a penalty
on the account; it is dev.to's own gate, and it lifts once the post is picked
up. Two consequences for planning. A dev.to post is worth nothing to search
while `noindex` is on it, so do not spend a Search Console request on its URL
until that clears. And **tags are still mandatory**: a post with an empty
`tag_list` cannot appear in the tag feeds, and the tag feeds are the only way it
would ever get the traction that lifts the gate. Check both with
`dev.to/api/articles?username=<name>` (`tag_list`) and by reading the
`<meta name="robots">` tags on the post itself.

**How to read the 5 "Not indexed" rows — measured 2026-09-24, do not "fix" them.**
Search Console sorts not-indexed URLs by reason, and two of those reasons look
like faults when they are not:

- *Page with redirect* (2 rows). Google lists the URL variants it met — `www.`,
  `http://`, no trailing slash, `index.html` — separately from the canonical
  form. `_dev/check-canonical-urls.cjs` re-checked every variant of all 13
  pages: the canonical form answers **200**, every variant answers **301/308**
  pointing back at it, and all 13 pages carry a `<link rel=canonical>`. Nothing
  is wrong; Google is recording that canonicalisation holds. This is also why
  8 indexed + 3 crawled adds to 11 rather than 13 — the missing two are here.
- *Crawled - currently not indexed* (3 rows: `/compress-photos-for-email/`,
  `/png-to-jpg/`, `/share/`). Google fetched the page, read it, and chose not to
  keep it yet. The tempting explanations were tested and both failed: the pages
  are **not** near-duplicates (`_dev/audit-duplication.cjs` compares only the
  `<main>` region, highest similarity **20.9%**), and thin internal linking is
  **not** the cause either — `/heic-to-jpg/` has zero body internal links and
  was indexed anyway. What separates the indexed pages from these is query
  competition: the ones that went in are the low-competition long tails
  (`compress-to-50kb`), and `png-to-jpg` is a red-ocean term. That is an
  authority problem, and **editing the page does not solve it.** Links do.

So: do not rewrite those three pages, do not add internal links for their sake,
and do not resubmit them repeatedly. Spend the time on the link channels below.

### Tier 2 — directory listings

Each of these is a one-time 5-minute form. They are weak individually and
compound in aggregate, because tools directories are themselves well indexed.
**Verify the URL is still alive before submitting** — this category churns.

URLs checked 2026-09-23 by fetch, then re-checked in a real browser — which
changed two of them. **A 200 is not a working page**: DevHunt's `/submit`
answers 200 and renders a 404 page, and SaaSHub's `/submit` answers 200 and is
only a pitch page. Judging these by status code is what put a dead URL on this
list, so the status column now says what the page does, not what it returns.
A 403 is Cloudflare refusing a script and says nothing about a browser.

**Every one of these wants an account first**, except Tiny Startups, where an
email address is the whole registration. None of it can be automated end to end;
the login is the part that needs a person.
`promo/directory-submission-pack.html` (generated by
`node _dev/gen-directory-pack.cjs`) carries the entry URL and every field value
with a copy button, so an account plus a few pastes is all that is left.

**Read the `rel` attribute, not the pitch.** Every directory here advertises a
"do-follow backlink", and on the free tier that is usually false — the dofollow
is the paid tier. Tiny Startups is the clear case, and it is worth walking
through because the mistake is easy to make twice.

| Directory | Submit at | Notes |
| --- | --- | --- |
| **Tiny Startups** | <https://www.tinystartups.com/submit> — a five-step wizard, and **no account is needed**: the email typed in step 2 creates one. Every field, with paste-ready copy, is in the section below. | **The free listing's link is `nofollow`. The dofollow is a $69 upgrade — do not buy it** (see below). Measured 2026-09-24 on 30 listings sampled evenly across their 1,117-URL sitemap: **28 carry `rel="nofollow noopener"`** on the outbound link to the startup's own site, **2 carry no nofollow**, and that minority is the paid tier. Their own copy agrees — every startup keeps "a DR 71 backlink", while "a do-follow backlink" sits in the *optional upgrades* list. Getting it free costs a **public post on X naming @ratheejaisal, kept up 24 hours**, with the listing URL and tracking code pasted back for verification. |
| **SaaSHub** | <https://www.saashub.com/submit> — **a pitch page, not a form**; register, then *Submit Product* in the nav | Link quality is genuinely mixed: 11 of 26 outbound links on a sampled category page were dofollow, but the product placements on that same page were `nofollow sponsored`. Free and syndicates onward, so worth the five minutes, but not a ranking win. |
| **DevHunt** | <https://devhunt.org/login> — **`/submit` is a 404 page answering 200**; the nav's *Submit your Dev Tool* points at `/login` | Dev-tool audience, which fits. Sign in with GitHub, then the form. |
| **OpenAlternative** | <https://openalternative.co/submit> — **redirects to sign-in** | Log in first, then the form appears. |
| **Uneed** | <https://www.uneed.best/> — 200 | `/submit` is a 404; the entry point is a button on the home page. |
| **MicroLaunch** | <https://microlaunch.net/> — 200 | `/submit` now redirects to `/premium` — check whether a free tier still exists before spending time. |
| **Product Hunt** | <https://www.producthunt.com/posts/new> — 403 to a script | Optionally a full launch — needs a gallery (see §5) and a 12:01am PT start. A listing alone still earns a lasting link. |
| **AlternativeTo** | 403 to a script (path not confirmed) | List as an alternative to TinyPNG, iLoveIMG, Squoosh, Compressor.io: register the app, then add it to each. |
| **Launching Next**, **Peerlist Launchpad**, **LibHunt**, **Slant** | 403 to a script | Reach each from its own home page. Slant and LibHunt want an answer on their "best image compressor" question, not a listing. |
| **awesome-privacy** | <https://github.com/pluja/awesome-privacy> — PR touching `README.md`, section **`## Photo Editing and Management` → `#### Web`** (not `## Cloaking` → `### Images`) | **The only one of the three that is open to us.** Its stated requirements are a privacy policy, no tracking on the project site, and open source — all three of which we meet — and it says nothing about who may open the PR. One line: `- [Name](url) - one sentence`, saying what it does and what it replaces, with the licence and whether it is self-hostable. Shipped as `awesome-privacy-entry`. **PR [#1135](https://github.com/pluja/awesome-privacy/pull/1135) opened 2026-09-24** — one file, one added line, authored by `biren001`. **nofollow** — discovery only, and PRs are reviewed in monthly batches. |
| ~~free-for-dev~~ | — | **Do not submit.** Two independent blocks. The list excludes "generic developer 'toolbox' sites - format converters, calculators etc" by name, which is exactly what `png-to-jpg` and `jpg-to-webp` are. And its template requires ticking "Large Language Models and other AI tick this box" alongside "This is not a generic browser based developer toolbox, **I agree to be banned from this list if it is**" — one box describes us and the other would not be true. |
| ~~awesome-selfhosted~~ | — | **Do not submit, and do not let a tool submit it either.** `awesome-selfhosted-data/CONTRIBUTING.md` carries a block addressed to AI agents forbidding exactly this: do not open a PR on behalf of a user, do not write an entry a person will then submit as their own, and do not tick the "The submission was done by a human, not a machine/LLM" box, because "an agent cannot make it truthfully". It does permit explaining the rules to the person, which is what this row is. |

### Why the $69 does not get bought

Tiny Startups is not selling a listing. It is selling the link, and its product
list says so out loud:

| Upgrade | Price | Their description |
| --- | --- | --- |
| Instant listing + DR 71+ do-follow backlink | $69 | "its backlink **switches to do-follow**" |
| SEO Optimised Review | $99 | a positive review published on their reviews page |
| Top Picks placement — 30 days | $99 | |
| Newsletter Feature | $199 | |
| 4× DR 20-60 Partner Backlinks | $199 | four links, priced per link |
| Newsletter Sponsorship | $300 | |

The $69 line is explicit that the free listing already exists and the money only
changes one attribute, and the $199 line is a link bundle named as one. Google's
spam policies name *"buying or selling links that pass PageRank"* as link spam;
a dofollow link whose price is the entire product is the plainest instance of it.
That is a manual-action risk carried by a domain that is two weeks old and has 8
of 13 pages indexed — the one failure that would undo everything else in this
file. There is no reading of this where $69 buys more than it risks.

The free listing does still exist, and it still works. Take it or leave it on
those terms: a `nofollow` link on an indexed page, worth discovery and a little
referral traffic — the same class as dev.to and SaaSHub, not the ranking win
this file previously claimed for it.

### Tiny Startups — the X verification screen

Being straight about the trade, because the screen does not offer a third door:

- **Post on X**, naming `@ratheejaisal`, containing
  `https://www.tinystartups.com/startup/localphototool?c=ndqy` (the `?c=` code is
  the tracking token — strip it and verification fails). The post must stay
  visible **24 hours**, then its URL is pasted back.
- **Or pay $69**, which skips the post. Covered above; the answer is no.

There is no free path that avoids the post, and the post is not a link — it is
the price of entry into a funnel the operator then re-sells. If the account or
the network is not already there, skipping Tiny Startups entirely costs nothing
that SaaSHub does not already provide.

### Back to the awesome-lists

That leaves one PR worth opening, and it is open: **#1135**, on 2026-09-24, one
added line, submitted by `biren001` rather than from a tool account. An earlier
revision of this file called the token route closed, reasoning that a single
nofollow line did not justify a credential. What changed is the size of the
credential, not the size of the prize: a classic token scoped to `public_repo`
and nothing else, revocable from one page, is a fair price for a line inside a
list of 19.8k stars.

`pr-lint` was read before the PR was opened rather than discovered from a
failure. Three jobs, and only the first can hard-fail:

- **link-check** — lychee, hard-fails on 404/410 and dead domains. Both our URLs answer.
- **format-lint** — warns if a new entry has no ` - ` description separator. Ours has one.
- **openness-check** — warns if an added repo is gone, archived, unlicensed, or
  carries no real source. Ours is public, MIT, not archived.

None of the three inspects who submitted the request, and the repository has no
`CONTRIBUTING.md` at all. That is the whole reason it is the one list of these
three that a tool may submit to — and it is why the other two rows above are
struck through instead of attempted.

### Tiny Startups — what the wizard actually asks (measured 2026-09-24)

`/submit` is a five-step wizard, not a form, and it reads your site for you.
Walked with a real browser; these are the fields it renders, in order.

| Step | Asks for | What happens |
| --- | --- | --- |
| 1 of 5 | Your startup's URL | Type `localphototool.com`. It then fetches the site and pre-fills the next step — nothing to upload. |
| 2 of 5 | Name, Tagline, **Feature 1–3**, a longer description (optional), **your email**, logo, cover | Will not advance until the three features and an email are filled. Trying gets you "Three things, so the listing can say what makes it different." |
| 3 of 5 | Revenue | |
| 4 of 5 | About you | |
| 5 of 5 | Upgrades | Paid extras. |

Three things that change how this one is done:

- **There is no signup.** The email field reads "No signup needed — we make your
  account with this so your launch has a home." So there is no Google or GitHub
  login step, and this is the only entry on this list where the account is made
  for you rather than by you. An earlier revision of the row above said "sign up
  — Google or GitHub, both one click", which was wrong.
- **Every listing is hand-approved** — their own footer says so. This is a
  submission and a wait, not an instant backlink.
- **The screen after step 5 will not let a listing go live by itself.** It says
  "your listing is saved and goes live the moment you verify it" and then asks
  for a public post on X naming `@ratheejaisal`, carrying
  `https://www.tinystartups.com/startup/localphototool?c=ndqy` — tracking code
  included, or verification fails — held up for **24 hours** with the post URL
  pasted back. $69 skips the post; see the section above for why it is not worth
  paying. There is no third option, so the real question is whether an X account
  is already lying around, not whether the listing is free.
- **The auto-filled tagline used to carry a retired claim, and that is why it was
  worth fixing.** It is read from our homepage `<meta name="description">`, which
  said "up to 90%" — the figure this file's own guard bans, because it holds for
  PNG screenshots and not for photographs. That was not a theory: the wizard
  filled its tagline field from that tag and handed the retired sentence back to
  be published, which is the one place a claim cannot be corrected afterwards.
  **Fixed 2026-09-24** (site `sw.js` v16), and the guard now scans the site files
  as well as this kit, so it cannot come back. If a wizard still pre-fills the old
  wording, the deploy has not propagated yet — paste the tagline below.

Auto-filled and already correct: **Name** `LocalPhotoTool`, and the **cover**,
pulled from `og-cover.jpg` (1200×630). The **logo** slot comes up empty — upload
`localphototool/icon-512.png` from the site source, which is 512×512.

```copy name=ts-tagline limit=200
A browser image compressor that never uploads your files. Shrink JPG, PNG, WebP, HEIC and AVIF, hit an exact KB target, and get EXIF and GPS stripped on the way out. Free, no account.
```

```copy name=ts-feature-1 limit=40
Nothing ever leaves your device
```

```copy name=ts-feature-2 limit=40
Compress to an exact KB target
```

```copy name=ts-feature-3 limit=40
HEIC and AVIF in-browser
```

```copy name=ts-long limit=500
For anyone who needs a smaller image without handing it to a stranger's server: portfolios, marketplace limits, metered data. Replaces TinyPNG, iLoveIMG and Squoosh. Decoding and re-encoding run in WebAssembly builds of MozJPEG, libheif and an AVIF encoder in the page — the codebase has no upload endpoint, so there is no server to send them to. Set a target size and it finds the quality that fits. EXIF and GPS are stripped. I built it because every "free" compressor asked for the photo first.
```

The homepage `<meta name="description">` carried "up to 90%" and was the only
place on the site that did — `grep -rn "up to 90%" localphototool` returned that
single line. It was never visible body copy, which is why it survived so long,
but it is what search results and every auto-filling directory show. **Replaced
2026-09-24** with the same facts said correctly, and at the same length (151
characters), so nothing about the snippet's behaviour changes:

> Free image compressor that runs entirely in your browser. Shrink JPG, PNG,
> WebP, HEIC and AVIF, hit an exact KB target, strip EXIF and GPS. No uploads.

Every claim in it is already made and guarded elsewhere on the site. The reason
this is worth a deploy rather than a note: **the kit was guarded and the site was
not**, so the ban on the retired figure covered the copy we write and missed the
copy that machines read. `check-listing-copy.cjs` now scans
`localphototool/**/*.{html,txt}` for the same banned claims, judging a refutation
on the sentence around the match rather than the whole file, and it self-tests
against a planted claim so a silent no-op cannot pass as a check.

### Tier 3 — answer distribution (slow, durable)

Find the questions people already ask and answer them properly. This ranks in
search and gets cited by AI assistants, which is where a lot of "how do I
compress an image without uploading it" traffic now starts.

- Quora: "How do I compress an image without uploading it?", "How do I open HEIC on Windows?"
- Reddit, in existing threads: r/photography, r/webdev, r/apple on HEIC pain.
  **Answer the question first.** Link only if it genuinely helps, and disclose
  that you built it. Undisclosed self-promotion gets removed and burns the account.
  Reddit answers from here now — 403 to a script, fine in a browser, re-measured
  2026-09-23. This half of Tier 3 no longer waits on a VPN.
- YouTube/X comments on HEIC and privacy-related videos. Same rule.

### Do not do

- Buy backlinks or use link exchanges. Tiny Startups' $69 tier is one of these
  and is the most tempting, because it is dressed as a directory fee.
- Post the same text to many subreddits at once. Rewrite per subreddit or skip it.
- Post to r/photography or r/webdev without reading their self-promotion rules
  (r/webdev confines it to Showoff Saturday).
- Repeat-submit to HN. One shot; if it dies, that is the answer.

---

## 5. Assets

| Asset | Path | Used for |
| --- | --- | --- |
| Square logo 512×512 | `localphototool/icon-512.png` | Every directory form. |
| Social cover 1200×630 | `localphototool/og-cover.jpg` | Link previews everywhere. |
| Desktop screenshot 1440×900 | `promo/screenshot-compress-desktop.png` | Product Hunt gallery, directory listings. |
| Mobile screenshot 390×844 | `promo/screenshot-home-mobile.png` | Product Hunt gallery. |
| Share posters | `localphototool/share/poster-{cn,en}.png` | Not for directories — those are for personal shares. |
| dev.to cover 1000×420 | `promo/devto-cover.jpg` | dev.to crops every cover to 1000:420, so the 1200×630 OG card loses its headline to the crop. This is a re-layout at that ratio, not a resize. |

Regenerate the screenshots with:

```
node _dev/shot-promo.cjs
node _dev/gen-devto-cover.cjs    # promo/devto-cover.jpg, 1000x420 @2x
```

The cover is fed one of two ways depending on which editor you picked in
Settings → UX. The **rich + markdown** editor has an "Add cover image" button
that accepts a local file and re-hosts it on `dev-to-uploads.s3.amazonaws.com`
— prefer that route, it has no third-party dependency at all. The **basic
markdown** editor has no cover button and only accepts a URL in frontmatter
(`cover_image:`), so there the image has to already be online: paste
`https://raw.githubusercontent.com/biren001/localphototool/main/promo/devto-cover.jpg`.
Supporting that second route is the only reason these assets live in a public
repo at all.

---

## 6. Tracking

Fill this in as you go. A channel you cannot remember submitting is a channel
you will double-submit.

| Channel | Date | Status | Result (referrals after 7 days) |
| --- | --- | --- | --- |
| IndexNow submission (`node _dev/indexnow-submit.cjs`) | 2026-09-22, re-pushed **2026-09-24** | done — 202 accepted twice, 13 URLs each time (Bing, Yandex, Seznam, Naver). Day two: accepted with "key was already verified", so the second push costs nothing |  || 
| GitHub repo + README link | 2026-09-22 | live — github.com/biren001/localphototool (public, MIT, **150 files** as of 2026-09-24; `node _dev/verify-push.cjs` re-checks the count and the commit hash) | |
| Bing Webmaster — site registered + sitemap read | pre-existing, confirmed 2026-09-24 | done — sitemap status `Success`, 13 URLs. The site was already registered, which is why the dashboard shows it and why *Import from GSC* was nowhere to be found | |
| Bing Webmaster — URL submission API | 2026-09-24 | done — 13 URLs submitted. `urlinfo` had first shown only 4 pages crawled and no record at all of the other 9, so this targeted the gap rather than the whole site | |
| Bing — per-URL crawl state | 2026-09-24 | measured — **4 of 13 crawled** (`/`, `/compress/`, `/heic-to-jpg/`, `/about/`, all 19–23 Sep), and **0 inbound anchors on every page**. Re-read with `node _dev/bing-webmaster.cjs urlinfo` | |
| Yandex Webmaster | | | |
| dev.to post | 2026-09-23 | live — <https://dev.to/biren001/i-built-an-image-compressor-that-cannot-upload-your-photos-4d45>. **Tags still empty** and dev.to still holds it at `noindex, nofollow` — re-checked 2026-09-24 with `check-devto-post.mjs`, 0 tags and both directives unchanged. While either is true the post passes nothing, so it is queued rather than counted (see §4 note) | |
| Indie Hackers post | | | |
| Google Search Console — sitemap submitted | 2026-09-23 | done — status 成功, 13 URLs discovered (= sitemap count) | |
| Google Search Console — Request Indexing | 2026-09-23 | done — 8 priority URLs, rest left to natural crawl | |
| Google Search Console — **first index report** | 2026-09-24 | **8 indexed / 5 not.** Not-indexed = redirect variants ×2 (canonicalisation working, no action) + crawled-not-indexed ×3 (`/compress-photos-for-email/`, `/png-to-jpg/`, `/share/` — authority, not page quality; see §4) | |
| Show HN | | | |
| r/SideProject | | | |
| r/InternetIsBeautiful | | | |
| AlternativeTo | | | |
| Product Hunt | | | |
| free-for.dev PR | | | |
| awesome-privacy PR **#1135** | 2026-09-24 | **open** — <https://github.com/pluja/awesome-privacy/pull/1135>, 1 file / +1 line, inserted after `miniPaint` under `#### Web`. Authored by `biren001`; `pr-lint`'s three jobs were read in advance (lychee link check, format lint, openness check) and all three are satisfied. CI sits queued until a maintainer approves the workflow run, which is normal for a first PR from a fork. Merged in monthly batches | |
| Tiny Startups — wizard submitted (free tier) | 2026-09-24 | **saved, not live.** Steps 1–5 completed; the email in step 2 created the account, so no signup was needed. It now sits on the X verification screen: a public post naming `@ratheejaisal`, carrying `tinystartups.com/startup/localphototool?c=ndqy`, held up 24 hours, then the post URL pasted back | |
| Tiny Startups — link `rel` measured | 2026-09-24 | **28 of 30 listings carry `rel="nofollow noopener"`** on the outbound link to the startup's own site; the 2 clean ones are the $69 tier. The free listing therefore passes no weight, and the "$69 instant listing … switches your backlink to do-follow" line confirms the link *is* the product. Do not buy it (see §4) | |
| Tiny Startups — $69 upgrade | — | **declined on policy**, not on price: a dofollow link purchased specifically to pass PageRank is link spam under Google's spam policies, and this is that case in plain text | |
| Homepage meta description — retired claim removed | 2026-09-24 | **done in source, not yet live.** `localphototool/index.html`, `sw.js` v16. Waits on the next package upload. Guard widened the same day: `check-listing-copy.cjs` now scans `localphototool/**/*.{html,txt}` too (19 files), **37/37**, and the new check was reverse-verified by planting the claim back in and requiring a failure that named the file | |
| | | | |

Read the visitor counter at `https://localphototool.com/stats/`. It reports
cumulative unique visitors, today, and the last 7 days. Your own visits are
excluded, so what you see is other people.
