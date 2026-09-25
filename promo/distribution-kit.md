# LocalPhotoTool — distribution kit

The site is live and shareable, but **not indexed anywhere yet** — no search
engine has been told about it and nothing links to it. This file is the
execution plan for fixing that. §4 is ordered for a **mainland-China
connection**, where Google, Hacker News and Reddit have no route at all; the
reachability column there is measured, not assumed.

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

### GitHub / awesome-list PR description

```copy name=pr-body limit=1000
Adds LocalPhotoTool under the image compression tools section.

Why it belongs here: every other entry in that section is a hosted service that receives your files over the network, and several of the entries' own descriptions lead with the fact that uploads are deleted after some interval. This one has no upload endpoint — it is a static site whose decoding and encoding run in the browser through WebAssembly builds of MozJPEG, libheif and an AVIF encoder, so the files never cross the network boundary.

It is free with no account, no watermark and no file-count limit, works offline once installed as a PWA, and supports HEIC input, which most browser-only tools do not.

Full disclosure: I maintain it. Happy to adjust the wording or the section if you would rather it sat elsewhere.
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
| **GitHub** | A public repo + README with the live URL | **Already done** (2026-09-22). Google discovers a brand-new host by following a link from a page it already crawls, and github.com is re-crawled continuously; dev.to and Indie Hackers work the same way. Search Console is what tells Google to come look — this is the other half, the link it follows once it does. | ✅ reachable |
| **IndexNow** | The key file at the site root (already generated) | One unauthenticated POST pushes all 13 URLs into Bing, Yandex, Seznam and Naver at once — no account, no dashboard. `node _dev/indexnow-submit.cjs` does it. This is the only *submission* channel available without a VPN, because Google's equivalent (the sitemap ping endpoint) was retired in June 2023 and now 404s. | ✅ reachable |
| **Bing Webmaster Tools** | Microsoft account, DNS TXT record in Cloudflare | 5 minutes, and Bing's index is what feeds Copilot, ChatGPT search and Yahoo — which is most of the "AI recommends a tool" surface. Verify the domain, then submit `sitemap.xml`. | ✅ reachable |
| **dev.to** and **Indie Hackers** | An account | Both give a followed link on a domain Google re-crawls daily, plus an English dev audience that actually needs this tool. dev.to post: the build story + the two measurement corrections in §2. | ✅ reachable |
| **Google Search Console** | Google account, DNS TXT in Cloudflare (or the HTML-file method) | **Do this one first.** It is the only channel that pushes to Google at all, and it is the only one where you can *ask* for a crawl instead of waiting to be found: URL Inspection → Request Indexing works per URL, immediately, and is repeatable. Verification is one-time — after it, the property keeps working without you. | ✅ reachable (was ❌ until 2026-09-23) |
| **Show HN** | HN account (aged is better), `hn-title` + `hn-body` | One front-page hit beats 50 directory listings. Post Tue–Thu, 8–10am ET. | ✅ likely reachable now — was ❌ when Google was; re-measure with `node _dev/check-reachability.cjs` before trusting this |
| **r/SideProject**, **r/InternetIsBeautiful**, **r/privacy** | Reddit account with some history | The copy above is calibrated for it: build story + what went wrong. | ✅ likely reachable now — same caveat as HN |

### Tier 2 — directory listings

Each of these is a one-time 5-minute form. They are weak individually and
compound in aggregate, because tools directories are themselves well indexed.
**Verify the URL is still alive before submitting** — this category churns.

| Directory | Notes |
| --- | --- |
| **AlternativeTo** | List as an alternative to TinyPNG, iLoveIMG, Squoosh, Compressor.io. Register the app, then add it to each. |
| **Product Hunt** | Optionally a full launch — needs a gallery (see §5) and a 12:01am PT start. A listing alone still earns a lasting backlink. |
| **free-for.dev** | A GitHub PR, not a form. Use `pr-body`. |
| **awesome-privacy** / **awesome-web-tools** | GitHub PRs. Read the contribution rules first; some require alphabetical order and a specific line format. |
| **Uneed**, **MicroLaunch**, **DevHunt**, **Tiny Startups**, **Launching Next**, **SaaSHub**, **OpenAlternative**, **Peerlist Launchpad** | Free tiers exist on all of these. The `short` / `medium` blocks are written for their forms. |
| **Slant**, **LibHunt** | Add to the relevant "best image compressor" question. |

### Tier 3 — answer distribution (slow, durable)

Find the questions people already ask and answer them properly. This ranks in
search and gets cited by AI assistants, which is where a lot of "how do I
compress an image without uploading it" traffic now starts.

- Quora: "How do I compress an image without uploading it?", "How do I open HEIC on Windows?"
- Reddit, in existing threads: r/photography, r/webdev, r/apple on HEIC pain.
  **Answer the question first.** Link only if it genuinely helps, and disclose
  that you built it. Undisclosed self-promotion gets removed and burns the account.
  ❌ Reddit is blocked from here — this half of Tier 3 waits for a VPN.
- YouTube/X comments on HEIC and privacy-related videos. Same rule.

### Do not do

- Buy backlinks or use link exchanges.
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

Regenerate the screenshots with:

```
node _dev/shot-promo.cjs
```

---

## 6. Tracking

Fill this in as you go. A channel you cannot remember submitting is a channel
you will double-submit.

| Channel | Date | Status | Result (referrals after 7 days) |
| --- | --- | --- | --- |
| IndexNow submission (`node _dev/indexnow-submit.cjs`) | 2026-09-22 | done — 202 accepted, 13 URLs | | 
| GitHub repo + README link | 2026-09-22 | live — github.com/biren001/localphototool (public, MIT, 136 files) | |
| Bing Webmaster — sitemap submitted | | | |
| Yandex Webmaster | | | |
| dev.to post | | | |
| Indie Hackers post | | | |
| Google Search Console — sitemap submitted | | needs VPN | |
| Show HN | | needs VPN | |
| r/SideProject | | needs VPN | |
| r/InternetIsBeautiful | | needs VPN | |
| AlternativeTo | | | |
| Product Hunt | | | |
| free-for.dev PR | | | |
| | | | |

Read the visitor counter at `https://localphototool.com/stats/`. It reports
cumulative unique visitors, today, and the last 7 days. Your own visits are
excluded, so what you see is other people.
