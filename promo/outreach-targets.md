# Outreach targets — who to actually contact about the upload measurement

> Created 2026-09-25, updated same day with measured link attributes.
> Companion to `distribution-kit.md` (owns the copy) and `_dev/measured/upload-behavior/` (owns the evidence).
> **Rule for this file: every link claim is bound to a specific anchor and says how it was measured.
> "Unmeasured" stays written as unmeasured — never upgraded to a guess.**

---

## 0. Three findings that changed the plan

### ⛔ CORRECTION 2026-09-26 — A1 below is WRONG: orthogonal.info is a competitor
The original Tier A1 ranked orthogonal.info first. **That ranking is void.** Re-checking their
site (not just their About page) found they **ship the competing product**:

- **QuickShrink** — `quickshrink.orthogonal.info`, their own browser-only image compressor
  ("So I built QuickShrink — your images never touch a server"), plus a **QuickShrink CLI 1.0.0**
- **PixelStrip** — their own EXIF remover ("which I built specifically for EXIF removal")
- Their *"5 Image Compressors benchmark"*, *"Batch Compress Online"*, *"Compress Without
  Uploading"* articles all rank **QuickShrink first** — they are funnel pages for their own tool

**Lesson bound into this file: before ranking any target, check whether they Ship A Competing
Product — not only whether their outbound links are followed.** The ① finding below ("the
writer pool is tool vendors") already warned about exactly this class of mistake, and it was
still made, because the earlier check only inspected link attributes and About-page language.

Revised consequence: pitching our benchmark methodology to them hands a rival our auditable
method for free. Expected followed link: **~0**. Do not contact. See `outreach-send-kit.md`.

### ① The topical writer pool is almost entirely tool vendors
Searching the obvious queries returns the *same* article written over and over by
*companies that sell a compressor*: `compressimg.app`, `sammapix.com`, `imgmin.pro`,
`jobbit.uk`, `compresso.io`, `minipx.com`, `nofileupload.com`, `snapcompress.io`,
`wildandfreetools.com`, `keynou.com`, `img2link.online`, `imagesizelab.com`,
`exifinjector.com`, `exifstrip.com`. Each ranks **itself first**. They are not a press we
can pitch — they are the competition, and several already make the same "we don't upload"
claim we do.

### ② Correction — "we measured the network" is no longer exclusively ours
I previously told you competitors only *read privacy policies*. **That is false.**
`orthogonal.info` ran the same class of test and named real endpoints (`api.tinify.com`,
`api3.ilovepdf.com`); `imgmin.pro` and `minipx.com` both instruct readers to open
DevTools → Network and watch. The *idea* is taken. What remains ours is rigour and
auditability:

| the common version | ours |
|---|---|
| "open DevTools and watch the Size column" | a UUID marker written into EXIF; the test is whether **that exact string** appears in an outbound **request body** |
| "the Network tab lights up" | byte counts — all **341,529** bytes posted — and endpoint paths (`/backend/opt/store`, `/v1/upload`) |
| no artifacts; trust the screenshot | **probe generator + measurement script + raw per-site JSON published**, MIT, re-runnable and falsifiable |
| picks a winner | returns **inconclusive** for the one site that wouldn't render under automation |

So the pitch is **"replace an eyeball test with an auditable one"**, not "nobody has looked".

### ③ Hacker News' launch slot for this category is spent
HN already carries near-identical posts: `NullUpload`, `ToolboxNest`, `ResizeImage.dev`,
`ImageConverter.dev`, `Image Scaler` — all "client-side, no upload, Show HN". A sixth adds
nothing. A **"I measured the nine you're already using"** post is a different genre, and is
the one worth making.

---

## ★ The decisive measurement: do editorial links actually pass weight?

This is the number the whole strategy hangs on, so I measured it instead of assuming.
Script: `_dev/.tmp/editorial-recon4.cjs` — fetch the article, then tally the `rel` attribute
on every outbound anchor.

| Target | outbound anchors | `rel` on the links pointing at **tools** | verdict |
|---|---|---|---|
| **orthogonal.info** — *I Benchmarked 5 Image Compressors…* | 12 | `squoosh.app`, `tinypng.com`, `compressor.io`, `developer.mozilla.org`, `github.com` → **`noopener`** (no `nofollow`) | **FOLLOWED** ✅ |
| **wired.com** — *Your Photos Are Probably Giving Away Your Location* | 22 | `exifviewer.pro` → `nofollow noopener`; `exiftool.org` → `nofollow noopener` | **NOFOLLOW** ❌ |
| **smashingmagazine.com** — *Powerful Image Optimization Tools* | 5 | no outbound tool links on the article itself; the 5 outbound are all no-`rel` (= followed) | inconclusive on tools |

**Conclusion — and it inverts the usual instinct: this is site-by-site, not a general rule.**
A mid-size independent blog emits **followed** links to the tools it names; a flagship
publisher emits **`nofollow`** on exactly the same kind of mention. So *"aim for the biggest
name"* is the wrong strategy — the big names are where the value gets thrown away.
`orthogonal.info` also tags its commercial links `nofollow sponsored`, i.e. it deliberately
separates editorial from paid — which is precisely the kind of site that can pass weight.

---

## ★ NEW A0 (2026-09-26) — Privacy Guides `privacyguides.org` — best real target

Replaces orthogonal.info at the top. Checked for the thing we forgot to check last time:
**they sell nothing that competes with us**, they take **no affiliate links**, and they state
that open source is preferred (our repo is public MIT).

- **Measured link behaviour** (fetched `/en/tools/`, tallied every `rel`): recommended-tool
  links use `rel="noopener"` — **zero `nofollow` on the page** → **FOLLOWED** ✅
- **Categories that fit**: **Photo Management**, **Data and Metadata Redaction**
- **Route**: developer **self-submission process** on their community forum
  <https://discuss.privacyguides.net/> — they require disclosed affiliation, an explicit
  threat model, limits stated plainly, and why-us-over-the-alternatives (see `/about/criteria/`)
- **Their bar is high** (security practices, cross-platform, active development, docs) — the
  pitch has to be self-critical, not promotional

**Exact route, verified through the forum's own JSON API 2026-09-26** (not read off a rendered
page):
- one **topic per tool**, not a long thread → category **Site Development** (id 7),
  <https://discuss.privacyguides.net/c/site-development/7>; its pinned "About" post states no
  template, and every tool suggestion in the category is a standalone topic
- existing titles follow `Tool Name (Short Qualifier)` — *Proton Authenticator*,
  *Immich Photo Manager (Self-Hosted)*, *Halocard (Virtual Credit Cards)*,
  *Delta Chat (Email Client)* → ours: `LocalPhotoTool (Browser-Only Image Tools)`
- **no signup friction**: `/site.json` lists auth providers
  `["discourse_id","github","linkedin_oidc","apple","oidc"]` → **GitHub login works**, so the
  operator's existing GitHub account is enough (no new password, no email verification loop)
- **no new-account posting gate**: user `defiling9046` registered **2026-09-02** and posted the
  *FUTO Notes* suggestion **the same day** (trust level 1)

Verdict: slow, demanding, but the one place where a yes actually moves `AnchorCount`.

---

## 1. Tier A — worth actually doing

### A1. Orthogonal (orthogonal.info) — **VOID, see correction at §0**
Independent-leaning tech blog (software / AI / security / privacy) with its own small tool
projects; byline is a shared "Orthogonal Editorial Team".

**Why them — quoted from their About page** (fetched 2026-09-25):
- *"Material claims should trace to primary documentation, specifications, or an observed check."*
- *"Test results, versions, limitations, and uncertainties should be stated rather than replaced with confident marketing language."*
- *"Human-requested topics do not need to promote an Orthogonal product."* ← an open door
- They already wrote the nearest thing to our test, naming `api.tinify.com` and `api3.ilovepdf.com`

**Measured link behaviour**: followed links to the tools it names (table above).

**Channel**: their moderated discussion page `https://orthogonal.info/community/` — their own
stated route for corrections. Frame it as **extending/correcting their benchmark**, never as a pitch.

**What we hand them**: their piece states endpoints; ours adds byte-level proof plus
reproducible artifacts, extended to 9 tools, plus a 30-second recipe their readers can run.

### A2. Web Tools Weekly — Louis Lazaris — **channel CORRECTED 2026-09-26**
Front-end tool newsletter, **15,545 subscribers** (counted on his home page; supersedes the
earlier "~13k"), curated weekly by Louis Lazaris (Toronto), who also authored **"Powerful Image
Optimization Tools"** on Smashing Magazine (2022-07-20).

**⛔ The previous channel note ("reply to the newsletter email") is not his published route.**
Fetched `webtoolsweekly.com/submit` verbatim on 2026-09-26 — the page carries **no form and no
mailto**, and names exactly two channels:

> *"submit it via X or Bluesky: DMs are open: @LouisLazaris on X / Chats are open:
> @LouisLazaris.com on Bluesky"*

| channel | mainland-China reachable | verdict |
|---|---|---|
| X DM `@LouisLazaris` | no | ❌ |
| **Bluesky chat `@louislazaris.com`** | **yes — 4/4 HTTP 200 measured** | ✅ **primary** |
| reply to a newsletter issue email | needs subscription; that form sits behind **Google reCAPTCHA** (VPN required) | backup only |

**Competing product check**: none — his business is newsletters and books (Lazarpress); his
Bluesky bio reads *"Front-end developer and newsletter curator"* with no tool of his own. Linking
to a tool costs him nothing, which makes him a genuinely neutral curator.
**His rule**: **tools only — "No tutorials or articles, please."** Submit the *tool*, and point at
the measurement page only as what makes the claim checkable.
**Link expectation**: still **unmeasured** (no issue page tallied yet).

### A3. nouploadtools.com — a listing, and only a listing
Directory whose *"Privacy-First Image Tools"* category holds **12 listings** (Squoosh,
Photopea, SVGOMG, ImageKB, PicShift…). Exactly our slot.

**Measured** (`_dev/.tmp/outreach-recon.cjs`, raw output kept):
- category page → **200**, `<meta name="robots" content="index, follow">`, and the URL **is in
  their sitemap** (20 URLs) → the page itself can rank.
- **12 / 12** listing links are **relative `/go/<slug>?source=directory` wrappers** with
  `rel="noopener noreferrer"` — no `nofollow`, but **internal**.
- the `/go/` endpoint answers **307**, and `robots.txt` contains **`Disallow: /go/`**.

→ **The weight dead-ends.** A crawler is forbidden to fetch `/go/`, so it cannot follow through
to us. Worth **discovery only**. Submit if free and trivial; never pay; never prioritise.

**Channel**: `/submit` and `/contact` both return **200** (probed).

---

## 2. Tier B — plausible, not yet established

| Target | Why it fits | What's missing |
|---|---|---|
| **EXIF / metadata tool sites** — `exifstrip.com`, `exifinjector.com`, `picshift.app` | **Adjacent, not competing**: their product is metadata, not compression. *"Does your compressor hand over the GPS you just stripped?"* is their traffic question and our data answers it. Linking to us costs them nothing | contact surfaces **unmeasured** (see §4) |
| **David Nield — Wired** | Sits on the EXIF/GPS beat and does link to small browser tools | **Measured: those links are `nofollow`** → do not lead with this |
| **Freedom of the Press Foundation** EXIF guidance | Cited across the literature for newsroom photo handling | institutional; no route established |

---

## 3. Tier C — communities (account-gated, same wall as before)

- **Hacker News** — post as *"I measured what nine image compressors send over the network"*,
  **not** `Show HN: my tool` (see §0③).
- **r/photography** (the GPS angle travels further here than in privacy subs), **r/privacy**, **r/webdev** — still need an account with history.

---

## 4. Not measured, and exactly why

Two of my own scripts produced **false negatives** during this session; both are fixed and both
are worth knowing about:

1. `editorial-recon2.cjs` used `lib.connect(url)` for the h1 path. That is `tls.connect` — it
   opens a socket and never sends an HTTP request, so every fetch "timed out". **The timeout was
   my bug, not a dead site.**
2. `editorial-recon4.cjs` resolved relative `href`s against a placeholder host, so Smashing's
   internal nav was counted as outbound — "202 external" when the true number is 5.
   Fixed by resolving against the real page URL.

After fixing both, the remaining genuinely-unknown item is:
- **contact surfaces for the EXIF-tool sites** — the hosts reset intermittently at TLS
  (`ECONNRESET`), and identical failures hit `nouploadtools.com` minutes after it had answered
  fine, which proves the fault is the local network path rather than the sites.
- `rel` tally for **a Web Tools Weekly issue page** (decides A2's value).

Re-run: `node _dev/.tmp/editorial-recon4.cjs <orthogonal|smashing|wired>`

---

## 5. Order of operations — **revised 2026-09-26** (A1 void, A0 promoted)

1. **Privacy Guides (A0)** — do first. Only target measured to pass followed links *and* verified
   to sell nothing competing. Entry is a single forum topic; GitHub login means no new account.
2. **Web Tools Weekly (A2)** — one **Bluesky** chat message, tool-shaped, matches his published
   submission route exactly.
3. **nouploadtools `/submit` (A3)** — 2 minutes, free. Expect discovery only, never pay.
4. ~~Orthogonal (A1)~~ — **removed**: competitor, see §0.
5. Communities (§3) last, once an account exists.
6. **Before adding any new target: reuse `editorial-recon4.cjs` to tally its outbound `rel`,
   then check whether it ships a competing product.** Link attributes alone already failed us
   once — both checks are mandatory.

### Reachability, measured from the operator's machine (mainland China, 2026-09-26)

| host | result | reading |
|---|---|---|
| `discuss.privacyguides.net` | `ECONNRESET` ×4, then 200, 200, 000, 200 | **intermittent — retry, never call it blocked** |
| `www.privacyguides.org` | 000, 000, 200 | same |
| `bsky.app` | **200 ×4/4** | reliable |
| `public.api.bsky.app` | 200 (returned his profile) | reliable |
| `webtoolsweekly.com` | 200 | reliable |
| `nouploadtools.com/submit` | 403 (Cloudflare, curl UA), then 000 | fine in a real browser |

A first probe returned `ECONNRESET` on **all four** hosts at once — including one that had answered
minutes earlier. That pattern means the local/international path, **not** four dead sites: do not
record a host as unreachable off a single probe.
