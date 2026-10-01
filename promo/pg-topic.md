# Privacy Guides — ready-to-paste tool suggestion

**Owner:** `promo/pg-topic.md`. Nothing else holds this text.
**Target:** `discuss.privacyguides.net` → category **Site Development (id 7)**.
**Paste as:** New Topic → Site Development → Title → paste the block below.
**Title format follows the house pattern** (`Tool Name (Qualifier)`):
`Halocard (Virtual Credit Cards)`, `Proton Authenticator`, `Immich Photo Manager (Self-Hosted)`,
`Delta Chat (Email Client)` — verified against the live forum on 2026-09-30.

**Before pasting, check the account state** — the owner account `biren001` was
auto-frozen by the forum's own anti-spam bot on 2026-09-26 (a first post carrying an
external link is exactly that pattern). It was still reporting `profile_hidden: true`
when re-checked on 2026-09-30, so: **do not re-post if a topic is already sitting in the
review queue**, and do not open a second account. See `promo/outreach-targets.md` §6.

The format below is modelled on a real maintainer post in the same category
(`Halocard (Virtual Credit Cards)`), which leads with affiliation, then "what it is /
what it solves / what it does not solve / how we handle data". Privacy Guides asks for
disclosed affiliation, a stated threat model, plainly stated limits, and why this over the
alternatives. Every claim here is already made on the live site; nothing is added for the
pitch.

```pgpaste
Title: LocalPhotoTool (Browser-Only Image Tools)

I maintain LocalPhotoTool (https://localphototool.com/), a static site of browser-only
image tools: compress, convert, resize, watermark, EXIF viewer, metadata editor, batch
rename, and GPS/metadata removal. Disclosure up front: I wrote it, and I would like it
listed under Photo Management and Data and Metadata Redaction.

What it is: a static site with no server-side image code in the repository. JPEG, PNG,
WebP, AVIF and HEIC/HEIF are decoded and re-encoded in the page with WebAssembly builds
of MozJPEG, libheif and an AVIF encoder. Decoding, resizing and writing all happen on the
device, so there is no upload endpoint to delete files from. It installs as a PWA and
keeps working with the network blocked after load.

I do not think "no upload" is a privacy property by itself, so I measured what the
alternatives actually do instead of reading their policies: a single JPEG with a unique
marker string in its EXIF, loaded into each compressor while fetch, XMLHttpRequest and
sendBeacon were patched from inside the page, then checking whether that marker appeared
in any outbound request body. Nine compressors, two sent the whole file (TinyPNG posted
all 341,529 bytes; iLoveIMG posted to an upload endpoint). Six sent nothing large enough
to contain it. Nothing here is inferred from a privacy policy. Method, scripts and raw
per-site JSON: https://localphototool.com/image-compressor-upload-test/

What problems it solves:
- You need an image small enough for a form, a marketplace or an email, and you do not
  want the original to sit on a third-party server in the meantime.
- You want GPS and camera metadata gone. The GPS remover and the metadata editor rewrite
  only the metadata containers and leave the pixel bytes byte-for-byte identical, which
  is a different thing from the usual "re-encode at 90% quality" strip.
- You are on iPhone and need HEIC to become a format other tools accept.
- You have more than one file and do not want forty downloads.

What it does not solve, stated plainly:
- It is not lossless by default. Auto mode targets roughly 40 dB PSNR and picks the
  lowest quality that still clears that floor; dropping below it is possible if you
  choose a target size instead. PNG output is lossless.
- It is not "unlimited size". The ceiling is device memory, roughly 80 megapixels, and
  iOS Safari fails well before that. Very large HEIC files from recent phones can fail
  on older phones.
- libheif handles standard HEIF. Exotic HEIF variants can fail, and the page says so
  rather than hiding it.
- ZIP export is withheld on iOS on purpose, because the Files app will not unpack an
  archive into the photo library.
- It has no sync, no collaboration, no account, no history of past edits. Nothing there
  remembers you.
- It cannot tell you whether a compromised browser is sending data. Nothing client-side
  can.

Who it is for and who it is not: it is for someone who has one concrete task — make this
file smaller, change this format, strip this GPS — and would rather not spend the
assumption that the file left the machine. It is not for someone who wants a full image
editor; Photopea, Squoosh and the desktop apps do that better, and I would send those
people there. It is also not for someone who needs a byte-exact identical file out.

Alternatives in the same slot, and why I think this one is different:
- Squoosh is the closest in architecture and still excellent, but it historically has no
  HEIC input and no exact-target KB mode; this covers HEIC and has one.
- TinyPNG and iLoveIMG are the tools most people reach for. Both upload the file; the
  measurement above is the reason I stopped using them rather than a policy page.
- The metadata removers I found reason from their own privacy statements. This one has
  no server to send the file to, and says so in the codebase rather than in a promise.

Data handling, since this is the part that matters here: the site sets no cookies and
loads no third-party analytics, fonts or scripts. The only server-side component is an
aggregate daily-unique visit counter that stores a salted hash and nothing else — no IP,
no user agent, nothing per file. It does not know which files you opened. Source is
public and MIT: https://github.com/biren001/localphototool

Honest caveat on track record: the domain is about two weeks old and has very little
external linking so far. If Privacy Guides prefers tools with a longer history, a
polite no here is the right answer and I will not resubmit; this is a submission for
comment, not a demand.
```

## Why the copy is shaped this way

| Section | Answers their stated bar (`/about/criteria/`) |
| --- | --- |
| Affiliation first line | Disclosed affiliation — the thing every forum moderation rejects for its absence |
| "Do not think no-upload is a property by itself" | Their bar is rigour, not adjectives; conceding the limit buys the measurement credibility |
| What it does not solve | Their listing criteria want limits stated plainly |
| Who it is not for / send them elsewhere | The self-critical tone that separates a maintainer from a marketer |
| Alternatives with measurements | Why-us-over-the-alternatives, with the competing tools named and not attacked |

## Do not

- Do not split the post into several topics to "increase exposure". One topic, one link.
- Do not paste it twice, and do not chase moderators.
- Do not edit the post after posting to add more links; edit only to answer a question.
- Do not open a second account. Multi-account plus the same link is a ban, not a hold.

## Re-check after posting (I run these)

```
node _dev/.tmp/probe-pg.cjs    # account card, search for localphototool, category latest
```

Cadence: 12 h, then 48 h. A held topic publishes once a moderator looks at it; nothing to
do while it is held beyond waiting.
