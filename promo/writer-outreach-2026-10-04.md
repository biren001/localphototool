# Writer outreach — 2026-10-04

**Owner:** `promo/writer-outreach-2026-10-04.md`. The measured numbers it quotes are the
2026-10-04 run in `_dev/measured/upload-behaviour/`.
**Rule this file follows:** no email is sent until the page the writer published has been
measured for how it links out (`node _dev/vet-writer-targets.cjs`). A followed mention is
the only thing that moves `AnchorCount: 0`; an unmeasured target is a guess.

---

## Why this channel and not the others

`promo/distribution-kit.md` Tier 1 already records the state of every other channel: IndexNow,
Bing, Search Console and the GitHub repo are done and pass nothing; awesome-list PRs are `nofollow`
by construction (measured: 1354 anchors / 947 nofollow on `awesome-privacy`);
**Hacker News is the only remaining followed channel that we can reach ourselves** — but the
same file also says the measurement post must wait for an account with history and must not
duplicate the launch post. So HN is not available tonight.

That leaves the one row of that table labelled **"no account required"**: the people who have
already written about image compressors. A writer who already cites these tools and links out
to them can add us the same way, in one sentence, and that link is followed. That is the only
channel left that can move the number this whole strategy is stuck on.

---

## Measured targets

Run `node _dev/vet-writer-targets.cjs` to reproduce the table below.

| target | page | http | external anchors | blocking | reached by |
|---|---|---|---|---|---|
| **vizua.io** | `/research/image-tools-privacy-benchmark-2026` | 200 | **15** | **0 (0%)** | `contato@vizua.io` |
| **orthogonal.info** | `/best-tinypng-alternatives/` | 200 | 8 | 0 (0%) | no mailto on the site — see below |

Only `nofollow` / `sponsored` / `ugc` block equity. `noopener` and `noreferrer` are followed and
are not counted as blockers anywhere in this file.

### ✅ A — `vizua.io`, the one to send tonight

**Why them and not anyone else.** Their benchmark asks the same question this site's measurement
answers, with a named author (Rodrigo Freitas) and a downloadable dataset. Their methodology
states plainly: *"Except for Vizua, this version classifies providers from their own current
documentation rather than packet-level tests."* and *"A future release may add controlled
network captures."* They have declared, on their own page, the exact thing we built.

**Fresh measurement of their outbound links:** 15 external anchors, **0 blocking**, and they
are the kind of tool citations we would want back — `github.com`, `tinypng.com`,
`iloveimg.com`, `compressor.io`, `shortpixel.com`, `compressjpg.io`, `jpegcompressor.com`.
They link out to the tools they discuss. That is the whole reason this target matters.

**Send to:** `contato@vizua.io` (taken from the page itself). Subject line carries the ask, not
the product.

```txt
Subject: the packet-level capture your 2026 benchmark says is future work

Rodrigo,

Your Online Image Tools Privacy Architecture Benchmark classifies the tools from each
provider's own documentation, and notes that a future release may add controlled network
captures. We built one, because we needed the answer for ourselves.

Method: a 341,529-byte JPEG (1600x1200, quality 88, GPS left in the metadata) with a unique
marker in its EXIF. Each compressor is opened in a headless browser, the file is handed to
its file input, and the page's fetch, XMLHttpRequest and sendBeacon are patched from inside
so every outbound request body can be searched for that marker. If the marker is in a
request, bytes from the file left the browser. We record from inside the page rather than
from the debugging protocol, because the protocol drops large and streamed bodies and
under-counted one upload as 1,144 bytes.

Fifteen compressors, 4 October 2026. Exactly two sent the whole file:

  TinyPNG     341,529 bytes to /backend/opt/store, marker matched 3x
  iLoveIMG    341,729 bytes to https://api22.iloveimg.com/v1/upload, marker matched 4x

Seven kept it in the browser: Squoosh, CompressJPEG, ImageCompressor, JPEG Optimizer,
Private Image Compressor, compressimage.net, and the tool I maintain (LocalPhotoTool
disclosed up front - it is one of the seven, not the reason I ran the test).

Six of the fifteen we could not drive under automation and left blank rather than guessed at:
FreeConvert, CompressPNG, iLoveIMG's JPG page, BulkCompressor, imagecompress.com and
resizeimage.net, the last of which no longer resolves.

Disclosure: I maintain LocalPhotoTool (https://localphototool.com/), a browser-only image
toolkit. I am not asking you to write about it. Two of the seven local ones were already
going the way you favour, and the point of publishing the run is that it can be checked:

  method + scripts + raw per-site JSON (MIT):
  https://github.com/biren001/localphototool/tree/main/_dev/measured/upload-behavior

If it is useful to your next version, take the numbers and the raw JSON. If it is wrong, I
would rather hear that than have it cited.

The one thing the packet-level version adds over documentation that we could not measure:
what a server does with a file after it arrives. Nothing here observes that.

- <name>
```

**Do not** attach anything. **Do not** send a second time. **Do not** ask for a link in the
body of the email; the offer is the data, and the link follows if the data is wanted.

### ⚠️ B — `orthogonal.info`, no email route

`/best-tinypng-alternatives/` is a genuine independent dev blog, 8 external anchors, **0
blocking**, and it already recommends browser-only compressors — the closest thing to a
shared point of view among everything searched.

**Blocker:** the site publishes no `mailto:`, has no `/contact/` route (404) and its byline is
the collective "Orthogonal Editorial Team". The article does link out to their own tool, a
Twitter profile, Reddit, LinkedIn and Hacker News from their side, so those are the only
routes that exist. The same short pitch goes there, addressed to whoever runs the account, and
it should start from their own article rather than from ours.

---

## Recorded and rejected — do not re-tread

| target | measurement | verdict |
|---|---|---|
| `compresso.io/blog/best-image-compression-tools-2026` | 200 but **0 external anchors** | Cannot pass any link. Not a target. |
| `wildandfreetools.com/blog/best-free-image-compressors-compared` | 200, 2 external anchors, both to their own `shops.beargrips.com` store | A storefront, not a publication. |
| `nofileupload.com`, `imgmin.pro`, `wikiplus.co` | competitor product blogs that rank themselves against TinyPNG | Pitching them means pitching a rival's product. Never. |
| `smashingmagazine.com/2023/12/powerful-image-optimization-tools/` | **404** — the URL in the old notes no longer resolves | Dropped; would need the article re-found first. |

A wider sweep of "best image compressor" searches returns pages with near-identical structure
four times in five — same table shape, same competitor set, same self-recommendation — and
several of them claim to have already measured what they list. The credible pool on this
question is small, which is worth knowing before spending another evening on it.

---

## After it is sent

```
node _dev/vet-writer-targets.cjs        # re-measure the target's outbound rel
curl -s https://vizua.io/research/image-tools-privacy-benchmark-2026 | grep -c localphototool
node _dev/bing-webmaster.cjs urlinfo    # does an inbound link any longer register?
```

Cadence: one nudge at 14 days, in the same thread, offering nothing new. After that the file
is closed and the target moves to the "no" pile.

---

## Open

- HN measurement post is still blocked on account history, and on not duplicating the launch
  post (`promo/distribution-kit.md`, the "The measurement post" row). It stays blocked.
- `localfirstweb.dev` is still listed as *unmeasured, not negative* — its directory routes
  404 to a plain fetch, which a browser may render client-side. One browser pass would settle
  it and it is the closest remaining local-first venue.
