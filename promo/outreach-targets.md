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


## 6. Submission log — what was sent, and what is publicly visible

**Operator submitted all three on 2026-09-26.** Verified from outside the same day, 16:30 (UTC+8):

| # | channel | sent | publicly visible 2026-09-26 | next check |
|---|---|---|---|---|
| A0 | `discuss.privacyguides.net` — new topic in Site Development | 2026-09-26 | **NO topic found** — see below | 2026-09-27, then 2026-09-29 |
| A2 | Bluesky DM → `@louislazaris.com` | 2026-09-26 | DMs are private; his newest post is 2026-09-24 (#688), nothing about us — expected | watch his feed; issues land roughly weekly |
| A3 | `nouploadtools.com/submit` | 2026-09-26 | not listed yet (their directory is JS-rendered, unverifiable from outside) | 2026-09-30 |

### A0 — why no public topic yet (and why that is probably fine)

Checked four ways, with a control so that "not found" actually means something:

1. forum-wide newest topics **by creation date** → newest is `2026-09-26 06:40 UTC`
   ("Security for local AI and tools like Nono"); nothing from the operator
2. `/c/site-development/7/l/latest.json?order=created` → newest is **2026-09-25**; no tool
   submission today
3. full-text search for `localphototool` → **0 topics, 0 posts** — *control: `Superbacked` and
   `AgeKey`, both posted 2026-09-25, are both returned by the same endpoint, so search works*
4. advanced search `after:2026-09-25 #site-development` → nothing from 09-26

Two possible readings — and one rule:

- **Most likely: it is in the moderation queue.** A brand-new account whose *first post* contains an
  external link is exactly the shape Discourse holds for review on a privacy-focused instance.
  **Held is not rejected**; it normally publishes once a moderator looks at it.
- Or the post never went through (form error, lost session, wrong category).

> **Do not re-post.** A duplicate submission is the thing that actually gets you flagged as spam.
> Verify from the account first: log in → avatar → **Activity → Topics**, or look for an
> "awaiting approval" banner on the topic. If it is queued, do nothing and wait.

### A0 — RESOLVED 2026-09-26 16:50: the account was frozen pending review (NOT rejected)

The operator posted the notice the forum sent. Reading it exactly:

> **账户暂时冻结** — 隐私指南 官方机器人, 1 hour before the screenshot
> "这是来自 Privacy Guides Community 的自动消息，通知您的**帐户已作为预防措施暂时冻结**。
> 请继续浏览，但您暂时无法回复或创建话题，**直到工作人员审核您最近的帖子**。"

Independently confirmed from outside:

- `/t/account-temporarily-onhold/41027.json` → **404** — it is a **private message**, which is exactly
  why it never appeared in any public list (my earlier check was right, not broken)
- `/u/biren001.json` → 200 with `profile_hidden: true` (normal for a frozen/suspended account)
- `localphototool` still returns **0** public results; Site Development newest is still 2026-09-25

**Reading:** this is the standard anti-spam path, not an editorial judgement. **A brand-new account
whose first post contains an external link is precisely the shape their automated hold catches.**
The account is frozen while a human reviews the *content*.

**Rules for the operator while it is frozen — all three are mandatory:**

1. **Do not re-post, and do not open a second account.** Multi-account + same link = spam verdict,
   and that is a real ban instead of a 1–3 day hold.
2. **Do not chase the moderators** (no email, no PM to admins, no second submission). The queue is
   human and small; chasing is what turns "pending" into "rejected".
3. **Just wait.** Human review of a flagged first post normally takes **1–3 working days**; today is
   Saturday, so realistically Monday–Wednesday. Check once on 2026-09-29, not daily.

**What the reviewer will judge:** the *content*. Our post was written to their own bar — disclosed
affiliation, stated limits, reproducible measurements instead of adjectives. That is the material a
PG moderator actually wants. The hold is about *form* (new account + link); the review is about
*substance*.

**Honest probability, stated plainly:** approval is plausible but **not** the safe bet. If it is
rejected, the likely reason is *"no track record yet"* — PG recommends tools that have been around
and been used. A rejection costs the site nothing; it only means this channel is closed for now and
must be retried later, after the site has some history elsewhere.
### Honest expectations for each channel

- **A0 — the only channel that can yield a *followed* link, and the hardest.** Privacy Guides
  recommends tools with a track record; we have none (no external links, no community history).
  A polite *"not established enough yet"* is a normal outcome here and is **not** a failure to fix —
  it is a statement about where the site is, not about the pitch.
- **A2 — no reply expected.** He does not answer most submissions; the tool either shows up in a
  future issue or it does not. Do not chase.
- **A3 — discovery only, zero link weight.** Their list URLs go through an internal `/go/` hop which
  is robots-blocked, so crawlers never follow it. Fine because it is free; never pay for it.

### The real lesson from this round

Three submissions, zero observable feedback within hours **is the normal state of cold outreach** —
and it is also the reason a three-target list is too thin to move `AnchorCount` off 0. The bottleneck
is not the quality of any single pitch; it is the **number of neutral curators we have found**
relative to the number that will say yes. Waiting is not a plan: keep the target list growing in
parallel with the waiting.

---

## 7. Pool expansion, evening of 2026-09-26 — six measured rounds

Same week, after the three submissions went out and the Privacy Guides account was put on hold.
Purpose: grow the list while waiting, and re-check the two channels the roadmap had ruled out on an
**assumption** rather than a measurement.

Instruments: `_dev/.tmp/editorial-recon{6,7,8,9,10,11}.cjs` (raw output kept as the matching
`-out.txt`). Round 6 = tally outbound `rel` on candidate pages; round 7 = dump each seed's internal
link map to find the real sub-page after guessed URLs 404'd; rounds 8-11 = the follow-ups below.

### ⚠️ Reading a rel tally correctly

**Only `nofollow`, `sponsored` and `ugc` block link equity. `noopener` and `noreferrer` do not.**
Earlier tables in this file list `noopener` as its own bucket, which invites the misreading that a
`rel="noopener"` link is not followed. It is followed. Rounds 6-11 count equity-blocking links
explicitly (`blocking: n / total`) so the number cannot be misread again.

### ✅ NEW — Hacker News passes weight. The roadmap's "HN is nofollow" is WRONG.

| what was measured | result |
|---|---|
| `news.ycombinator.com` front page, story links | **32 external anchors, 0 blocking** — every one `(no rel)` |
| one **permanent** item page (`/item?id=49855315`, the page that does not scroll away) | **4/4 external, 0 blocking** — the submitted story link (`gultsch.de`) carries no `rel` |

→ A submitted story's **item page keeps a followed link to the submitted URL**. `roadmap-2026-09-26.md`
lists HN under "P3 — do not touch, nofollow"; **that line is refuted and has been corrected**. HN is
authority without a `nofollow` tax — the highest-value target measured so far that does not require
being *recommended* by anyone.

Caveats that are not link attributes and still apply: it needs an account with some history, and the
story has to be worth reading on its own. §0③ already says the genre that works is
*"I measured what nine image compressors send over the network"*, **not** `Show HN: my tool`.

### ✅ CLOSED — Web Tools Weekly issue pages are followed (this was the last unmeasured item)

`outreach-targets.md` §4 listed *"`rel` tally for a Web Tools Weekly issue page (decides A2's value)"*
as unmeasured. Measured on `webtoolsweekly.com/archives/issue-688/`:

- **49 external anchors, 49 with no `rel`, 0 blocking**
- the per-tool links are exactly the pattern we would appear in (`mini-lit`, `Vuzeno`, `Kibo UI`,
  `Retune`, … — each one plain and followed)
- every issue is in the permanent archive at `/archive` (50 issues listed), so a mention keeps
  linking long after the issue is sent

→ **A2 is confirmed as a real followed link if it lands.** He is a genuine curator: tools only,
no competing product, no affiliate separation problem to worry about. Nothing to do but wait for
the DM already sent.

### ⚠️ CLOSED with a caveat — GitHub READMEs, and therefore every awesome-list PR, are nofollow

| sample | external anchors | blocking |
|---|---|---|
| `Lissy93/awesome-privacy` rendered README (round 9) | 1354 | **947 nofollow** (the rest are `github.com` self-links, which GitHub exempts) |
| `sindresorhus/awesome` (round 10) | 10 | **10 / 10 nofollow** |
| `vinta/awesome-python` (round 10) | 55 | **55 / 55 nofollow** |

→ Confirms what `distribution-kit.md` already documents for the repo's own README link: **GitHub
links are discovery, not authority.** Consequence for us: the **open PR to `awesome-privacy` #1135
cannot become the first backlink** — it is still worth having (it is free, and it is how a crawler
gets pointed at the host), but do not count it in the `AnchorCount` budget. Budget that has to come
from an independent site that writes about us.

### ❌ Rejected after measurement — recorded so nobody re-treads them

| target | measurement | verdict |
|---|---|---|
| `ssd.eff.org` — EFF Surveillance Self-Defense | `/module-categories/tool-guides` → 200, but **5 outbound anchors total and all of them go to `eff.org` / `supporters.eff.org`**. Their tool guides link inward, not out to tools. | **Not a link route.** Also out of scope editorially — they cover Signal/Tor/password managers, not image compression |
| `techlore.tech` | The site has **no tool-resources page any more** (nav = about, contact, friends, podcasts, blog, videos). `/friends` is an **affiliate** page: 62 `noopener` + 5 `noreferrer`, 0 nofollow | Not a directory. Dropped |
| `thenewoil.org` | Homepage returns **1 internal link only** (JS-rendered), and `/sitemap.xml` is **404** | **Unmeasurable from outside, and unfindable by a crawler** unless something links deeper. Drop |
| `localfirstweb.dev` | Homepage *links to* `/directory`, but `/directory`, `/directory/`, `/apps` and the `www.` variant all return **404 to a plain fetch** (its nav is 49 external anchors, 22 with no `rel`) | **Unmeasured, not negative.** The local-first angle is genuinely aligned (no server, works offline) — worth one more try in a browser, where the route may be client-side |
| `kinsta.com/blog/image-optimization/` | 200, but **0 anchors parsed** — returns a bot wall / JS shell to a plain fetch | Unmeasured; needs a browser |

### What this round changes

1. **HN moves up.** It is the only measured-followed channel that does not depend on a curator
   saying yes. It does depend on having something worth reading, which §0③ says we already have.
2. **The open awesome-privacy PR is not the first backlink.** Re-budget the expectation.
3. **A2 is now known to be worth waiting for**, not a shot in the dark.
4. **Two of the four new candidate classes were dead on arrival** (EFF, Techlore) and two are still
   open only because they need a real browser (localfirstweb, Kinsta). The honest read: expanding
   the pool by guessing at *privacy* sites is nearly exhausted — the remaining leverage is in
   **adjacent audiences** (local-first, web performance) and in **HN**.

