# Outreach send-kit — today's batch (2026-09-26)

> Everything below is **ready to paste**. Nothing needs translating or rewriting.
> Step-by-step instructions for the human doing it: `outreach-do-this-today.md` (Chinese).
> Order is by expected value, and every target here has been **checked for whether it sells a
> competing product** after the orthogonal.info mistake (see bottom).
>
> **Channel facts re-measured 2026-09-26** — see §② for a correction to the previous plan.

---

## ① Privacy Guides — highest value, do this one first

**Why first**: measured, not assumed.

- Their recommended-tool links use `rel="noopener"` with **zero `nofollow`** → **they pass weight** ✅
- They have exactly our categories: **Photo Management**, **Data and Metadata Redaction**
- They take **no affiliate links and no payment for placement** → a recommendation can only be earned
- Open source is their stated preference → our repo is public MIT ✅

**Their rules** (`/about/criteria/`): open source preferred, cross-platform, actively maintained, well documented, and developers must use the **self-submission process** on their community forum — disclosing affiliation, stating the threat model, and explaining what this does better than the alternatives.

**Where exactly** (verified by API, not guessed):
- Forum: <https://discuss.privacyguides.net/> — **use `Log in with GitHub`**; the forum advertises
  `github` among its auth providers, so no new account or email round-trip is needed
- Category: **Site Development** → <https://discuss.privacyguides.net/c/site-development/7>
- It is **one topic per tool**, not a thread. Existing examples follow the pattern
  `Tool Name (Short Qualifier)`: *Proton Authenticator*, *Immich Photo Manager (Self-Hosted)*,
  *Halocard (Virtual Credit Cards)*, *Delta Chat (Email Client)*
- **Post title**: `LocalPhotoTool (Browser-Only Image Tools)`
- **New-account gate**: verified not a blocker — user `defiling9046` registered **2026-09-02** and
  posted the *FUTO Notes* suggestion the **same day**

**Paste this as the body** (the title goes in the separate title field):

```
Hi all — self-submitting a tool I built, following your self-submission process.

Affiliation: I am the developer of LocalPhotoTool. Full disclosure up front.

What it is
----------
A static site of browser-only image tools: compression (JPEG/WebP/AVIF/PNG), HEIC->JPG,
HEIC conversion, target-size compression (e.g. "compress to 500 KB"), EXIF/GPS stripping,
and phone<->computer file transfer. All processing happens in the originating browser
via Canvas/WebAssembly. Source: https://github.com/biren001/localphototool (MIT).

Threat model
------------
Protects against: your photo being transmitted to, stored by, or logged by a third-party
operator, plus the metadata that survives ordinary compression (GPS coordinates, serial
numbers, software timestamps).

Does NOT protect against: a compromised device, a malicious browser extension, or a
screen recorder. Nothing here can help once the bytes are in someone else's runtime.

What it provides
----------------
- Zero bytes uploaded: the page ships no upload endpoint, no analytics, no cookies.
  There is nowhere for the image to go.
- A strict Content-Security-Policy that blocks outbound requests to anything other than
  the codecs the page itself loads — verifiable from the response headers.
- Works offline after first load (service worker); no account, nothing stored server-side.

What it cannot provide
----------------------
Not a pixel editor, no cropping, and the EXIF stripping path strips metadata by
re-encoding, so it is lossy by design (the page says so explicitly rather than burying it).

Why it over the alternatives
----------------------------
The field's interesting property is that most "private" competitors are private by
policy rather than by construction. I published the measurement rather than asking anyone
to take the claim: which tools actually transmit the file, to which endpoints, and how many
bytes — https://localphototool.com/image-compressor-upload-test/ has the reproducible probe
generator, the measurement script and the raw per-site JSON. You can re-run it and get a
different answer; that is the point.

Happy to answer anything, and to hear what would need to change for this to meet your bar.
If it does not belong, no hard feelings.
```

**Why this wording**: it leads with disclosure because their criteria demands it, states limits (their culture punishes overclaiming), and points at a **falsifiable** artifact instead of adjectives.

---

## ② Web Tools Weekly (Louis Lazaris) — CORRECTED channel: Bluesky DM

**⚠️ Correction to the 2026-09-26 plan.** The earlier version said "subscribe and reply to the
newsletter email". That is *a* route he mentions inside issues, but it is **not the one his own
submission page publishes**. Fetched `webtoolsweekly.com/submit` verbatim:

> *"Suggest a Tool — If you've built or know of something that might be useful to front-end
> developers, submit it via X or Bluesky: DMs are open: @LouisLazaris on X / Chats are open:
> @LouisLazaris.com on Bluesky"*

There is **no form and no mailto on that page**. So the two official channels are:

| channel | reachable from mainland China? | verdict |
|---|---|---|
| X DM `@LouisLazaris` | **No** — X is unusable | ❌ |
| **Bluesky chat `@louislazaris.com`** | **Yes — tested 4/4 HTTP 200** | ✅ **use this** |

**Why them anyway**: he is a **pure curator with no competing product** — his business is
newsletters and books, so linking to a tool costs him nothing. ~15,545 subscribers (counted on
his home page, superseding the earlier "~13k"), and he wrote the image-optimization roundup at
Smashing Magazine, so this is squarely his beat. Profile confirmed via the public Bluesky API:
bio reads *"Front-end developer and newsletter curator"* with no tool of his own.

**His hard rule: tools only. No tutorials or articles.**

Step 1 — register Bluesky if needed: <https://bsky.app/> (free, email signup).
Step 2 — open <https://bsky.app/profile/louislazaris.com> → **Chat** → paste:

```
Hi Louis — tool suggestion for Web Tools Weekly (not an article):

LocalPhotoTool (https://localphototool.com) — browser-only image tools:
compress JPEG/WebP/AVIF/PNG, convert HEIC, hit an exact target size
("compress to 500 KB"), strip EXIF/GPS, and phone<->computer file transfer.
Zero bytes uploaded, no account, no analytics, no cookies, works offline.
Open source, MIT: https://github.com/biren001/localphototool

The claim is checkable: https://localphototool.com/image-compressor-upload-test/
— I measured what nine popular compressors actually transmit, and published
the probe generator, script and raw JSON so anyone can re-run it.
```

**Fallback if a brand-new Bluesky account cannot open a chat** (the platform rate-limits fresh
accounts): subscribe at <https://webtoolsweekly.com/> (EmailOctopus form, top of page) and reply
to any issue's email with the same text. **Note this form is behind Google reCAPTCHA — it will not
load without a VPN from mainland China.**

**Point at the tool**, with the measurement page only as what makes the privacy claim checkable.
That respects "tools only" while giving him a reason to pick this over the dozen near-identical
submissions he gets.

**His other newsletters** (`VSCode.Email`, `Tech Productivity`) are not a fit — don't spray.

---

## ③ nouploadtools.com — 2 minutes, discovery only

Already measured: their listing links go through internal `/go/` wrappers that are blocked by their own `robots.txt`, so **crawlers cannot follow through to us — this yields no link equity, only humans finding us**. Do it because it is free and takes two minutes. Never pay them.

**Where**: `/submit` on their site (probed: 200, though the host resets intermittently).

**Paste**:

```
Name: LocalPhotoTool
URL: https://localphototool.com
Category: Privacy-First Image Tools
Description: Browser-only image tools — compression, HEIC conversion, target-size
compression, EXIF/GPS stripping and P2P transfer. Nothing is uploaded: no server-side
processing, no account, no analytics, no cookies. Works offline after the first load.
Source: https://github.com/biren001/localphototool
```

---

## Do NOT send anything to orthogonal.info

See the correction at the top of `outreach-targets.md`. They are a competitor, not a publisher.

---

## Reachability notes (measured 2026-09-26, from the operator's machine in mainland China)

| host | result | notes |
|---|---|---|
| `discuss.privacyguides.net` | intermittent 200 | first batch of 4 probes all `ECONNRESET`, then 2/3, then 200 — **retry, do not conclude "blocked"** |
| `www.privacyguides.org` | intermittent 200 | same pattern |
| `bsky.app` | **4/4 200** | reliable; `public.api.bsky.app` and `bsky.social` also answer |
| `webtoolsweekly.com` | 200 | reliable |
| `nouploadtools.com` | 403 then 000 | Cloudflare bot-filter for non-browser UAs; fine in a real browser |

The all-four-`ECONNRESET` first probe was **the local network path**, not four dead sites —
identical failures hit a host that had answered fine minutes earlier.

---

## After sending

Do not follow up within a week. Record everything in `outreach-targets.md` — who, when, what exactly was sent, and the reply — so we never pitch the same place twice and can tell which scripts actually get answers. That feedback is worth more than any single link.
