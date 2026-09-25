#!/usr/bin/env python3
"""Generate the long-tail tool landing pages from /compress/.

Each page is the compressor with a different default and its own copy. They are
generated rather than hand-copied because the shared regions have to stay
byte-identical: the last hand-copy left `href="./"` in the shared header, which
pointed at two different pages depending on which one you were reading.

Regenerating is idempotent — running it twice produces identical bytes.

    python _dev/build-landing-pages.py
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SITE = os.path.join(ROOT, "localphototool")
BASE = os.path.join(SITE, "compress", "index.html")
ORIGIN = "https://localphototool.com"

src = open(BASE, encoding="utf-8").read()


def slice_between(text, start, end, label):
    a = text.index(start)
    b = text.index(end, a)
    return text[a:b], text[b:]


HEAD = src[: src.index("<body>")]
SKIP = '<a class="skip-link" href="#tool">Skip to the compressor</a>'
HEADER, _ = slice_between(src, '<header class="site-header">', "</header>", "header")
HEADER += "</header>\n"
TOOL, _ = slice_between(src, '<section class="tool" id="tool">', "  <!-- SEO content -->", "tool")
AFTER = src[src.index("</main>") :]


def faq_html(items):
    out = ['      <div class="faq mt-4">']
    for i, (q, a) in enumerate(items):
        open_attr = " open" if i == 0 else ""
        out.append('        <details class="faq__item"%s>' % open_attr)
        out.append("          <summary>%s</summary>" % q)
        out.append('          <div class="faq__body"><p>%s</p></div>' % a)
        out.append("        </details>")
    out.append("      </div>")
    return "\n".join(out)


def seo_html(body, faq):
    return (
        '  <!-- SEO content -->\n'
        '  <section class="section section--subtle">\n'
        '    <div class="container prose">\n'
        + body
        + '\n      <h2>Frequently asked questions</h2>\n'
        + faq_html(faq)
        + "\n    </div>\n  </section>\n\n</main>\n"
    )


def hero_html(crumb, h1, lead, badges):
    # Concatenated rather than %-formatted: a badge such as "25–50% smaller
    # than JPG" carries a literal percent sign, which a format string would
    # try to consume as a conversion.
    rows = "\n".join('        <li class="badge">' + b + "</li>" for b in badges[1:])
    return (
        '<main id="main">\n'
        '  <section class="hero hero--compact">\n'
        '    <div class="container">\n'
        '      <nav aria-label="Breadcrumb" style="margin-bottom:0.9rem">\n'
        '        <span class="muted" style="font-size:0.8rem"><a href="../">Home</a>'
        ' <span aria-hidden="true">&rsaquo;</span> <a href="../compress/">Compress</a>'
        ' <span aria-hidden="true">&rsaquo;</span> ' + crumb + "</span>\n"
        "      </nav>\n"
        "      <h1>" + h1 + "</h1>\n"
        '      <p class="hero__lead" style="max-width:660px">' + lead + "</p>\n"
        '      <ul class="trust-row mt-4">\n'
        '        <li class="badge badge--success">\n'
        '          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
        ' stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6.5v5c0 4.5 3.2 8.4 8 9.5'
        ' 4.8-1.1 8-5 8-9.5v-5L12 3Z"/></svg>\n'
        "          " + badges[0] + "\n"
        "        </li>\n"
        + rows
        + "\n      </ul>\n"
        '      <p class="hero__share" style="max-width:660px">\n'
        '        <a href="../share/">On a phone? Scan this QR code to open the tool there &rarr;</a>\n'
        "      </p>\n"
        "    </div>\n"
        "  </section>\n\n"
    )


def json_ld(slug, title, description, faq):
    url = ORIGIN + "/" + slug + "/"
    page_id = url + "#page"
    graph = [
        {
            "@type": "WebApplication",
            "@id": ORIGIN + "/#app",
            "name": "LocalPhotoTool",
            "url": ORIGIN + "/",
            "applicationCategory": "MultimediaApplication",
            "operatingSystem": "Any modern web browser",
            "browserRequirements": "Requires JavaScript",
            "description": "Client-side image compression and conversion for JPEG, PNG, WebP and AVIF. Files are processed locally in the browser and are never uploaded.",
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            "isAccessibleForFree": True,
        },
        {
            "@type": "WebPage",
            "@id": page_id,
            "url": url,
            "name": title,
            "description": description,
            "inLanguage": "en",
            "isPartOf": {"@id": ORIGIN + "/#website"},
            "about": {"@id": ORIGIN + "/#org"},
            "breadcrumb": {"@id": url + "#breadcrumb"},
        },
        {
            "@type": "BreadcrumbList",
            "@id": url + "#breadcrumb",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": ORIGIN + "/"},
                {"@type": "ListItem", "position": 2, "name": "Compress", "item": ORIGIN + "/compress/"},
                {"@type": "ListItem", "position": 3, "name": title, "item": url},
            ],
        },
        {
            "@type": "FAQPage",
            "@id": url + "#faq",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": q,
                    "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)},
                }
                for q, a in faq
            ],
        },
        {
            "@type": "Organization",
            "@id": ORIGIN + "/#org",
            "name": "LocalPhotoTool",
            "url": ORIGIN + "/",
            "logo": ORIGIN + "/favicon.svg",
            "email": "hello@localphototool.com",
        },
        {
            "@type": "WebSite",
            "@id": ORIGIN + "/#website",
            "url": ORIGIN + "/",
            "name": "LocalPhotoTool",
            "inLanguage": "en",
            "publisher": {"@id": ORIGIN + "/#org"},
        },
    ]
    return (
        '<script type="application/ld+json">\n'
        + json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)
        + "\n</script>"
    )


# --------------------------------------------------------------------------
# Page specs
# --------------------------------------------------------------------------

SPECS = [
    {
        "slug": "compress-without-uploading",
        "crumb": "Compress without uploading",
        "title": "Compress Images Without Uploading — Verifiable in Browser",
        "description": "Compress images without uploading them. Runs entirely in your browser — open the network panel and confirm nothing leaves your device. No account, no analytics.",
        "h1": "A private image compressor you can verify",
        "lead": "Most image compressors ask you to take their word for it. This one invites you to check: open your browser's network panel and watch what leaves your device while a photo is being compressed. Nothing does — the file is decoded, resampled and re-encoded on your own hardware, and there is no upload endpoint to send it to.",
        "badges": ["Nothing is uploaded", "Verifiable in DevTools", "No analytics scripts", "Unlimited &amp; free"],
        "defaults": {"format": "jpeg"},
        "body": """      <h2>“No upload” is a claim, not a guarantee</h2>
      <p>A great many online compressors describe themselves as private. The words are on the page; the architecture behind them is not. Server-side compression is simply easier to build: the same code runs for everyone, batches are trivial, and file limits are easy to enforce. The cost is invisible to you — your photograph is copied onto someone else's machine, processed there, and hopefully deleted afterwards.</p>
      <p>You cannot tell which kind you are using by looking at it. Both kinds show a drop zone, a quality slider and a download button. The difference is entirely in what happens underneath, which is why the promise is worth testing rather than trusting.</p>

      <h2>Verify it yourself in ten seconds</h2>
      <p>This method works on any image tool, including this one. It takes one photo and a browser you already have.</p>
      <ol>
        <li>Open the page and press <kbd>F12</kbd> (on macOS, <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>I</kbd>) to open developer tools.</li>
        <li>Switch to the <strong>Network</strong> tab, tick <em>Preserve log</em>, then clear the list.</li>
        <li>Drop in a photo, compress it, and download the result.</li>
        <li>Read the request list that appeared.</li>
      </ol>
      <p><strong>What you will see:</strong> the page's own HTML, CSS and JavaScript, plus a WebAssembly codec fetched on demand when you pick a format that needs one. Those are pieces of the program — they are code, not your picture.</p>
      <p><strong>What you will not see:</strong> any request carrying your image. No upload, no POST, no multipart form. If a tool that advertises privacy shows a request containing your file at this step, then its privacy was marketing copy.</p>

      <h2>What actually happens to your file</h2>
      <p>Locally, the sequence is short: the browser decodes the image into raw pixels, optionally resamples it if you asked for a smaller size, re-encodes it in the format you chose, and hands you a download from memory. At no point does the data cross a network boundary, because there is nothing on the other end to cross it to.</p>
      <p>One useful side effect: re-encoding copies pixels and nothing else, so <strong>EXIF metadata — including the GPS coordinates most phones write into every photo — is dropped</strong>. You do not have to remember to strip it; it simply does not survive the trip.</p>

      <h2>When this actually matters</h2>
      <ul>
        <li><strong>Identity documents.</strong> Passport scans, national ID cards, visa photos. These are the files you would least want sitting in a stranger's storage bucket.</li>
        <li><strong>Medical images.</strong> X-rays, scans and clinical photographs carry some of the most sensitive data a person has.</li>
        <li><strong>Work under an NDA.</strong> Unreleased product renders, client artwork, internal documents.</li>
        <li><strong>Ordinary family photos.</strong> Faces, homes, school uniforms and embedded location data — plenty of people would rather those never left their laptop.</li>
      </ul>
      <p>For a picture headed to a public website, a server-based compressor is perfectly adequate. The distinction only bites when the image is one that should not be seen by anyone else.</p>

      <h2>What this site does collect</h2>
      <p>Being precise matters more than being flattering, so here is the whole of it. There is one self-hosted, anonymous counter: your browser keeps a random identifier, hashes it, and sends that hash to our own <code>/api/count</code> endpoint at most once a day. It carries no filename, no image content and no IP-derived profile, and it exists only so the footer can show that anyone is here at all.</p>
      <p>There is no Google Analytics and no third-party analytics script of any kind — nothing that would let an advertising network learn that you visited. If you would rather not be counted either, disconnect from the internet after the page loads: the compressor keeps working, because it was already downloaded.</p>

      <h2>If you need a specific target instead</h2>
      <p>Sometimes the requirement is not privacy but a hard number — a portal that rejects anything above 100 KB. The <a href="../compress-to-100kb/">compress to 100 KB</a> page does that with the same no-upload guarantee, and the <a href="../compress/">main compressor</a> switches between target size, fixed quality and full auto. iPhone photos in HEIC format go through <a href="../heic-to-jpg/">HEIC to JPG</a>.</p>""",
        "faq": [
            (
                "How can I be sure my image is really not uploaded?",
                "Open developer tools, switch to the Network tab and clear it before compressing. You will see the page's own assets and, on demand, a WebAssembly codec — but no request that carries your file. That observation is the proof; there is no upload endpoint for it to go to.",
            ),
            (
                "Does the compressor work without an internet connection?",
                "Yes. Once the page has loaded, the tool and its codecs are cached by the service worker, so you can go offline and keep compressing. For files that must not travel at all, this is the most private mode available.",
            ),
            (
                "What does the visitor counter send?",
                "A hash of a random identifier kept in your own browser, to our own endpoint, at most once per day. No filename, no image content, no third-party analytics. The count is used only to decide whether to show a number in the footer.",
            ),
            (
                "Is browser-based compression lower quality than server-based?",
                "No. It is the same encoders — libjpeg, libwebp, libaom — compiled to WebAssembly and run on your own CPU. The output is byte-for-byte what a server running the same library would produce; only the location of the work has changed.",
            ),
            (
                "Do I need an account, and are there limits?",
                "No account, no sign-up, no watermark, no daily cap and no file-count limit. The ceiling is your device's memory, since your machine is doing the work.",
            ),
            (
                "What happens to the EXIF data in my photos?",
                "It is removed. Re-encoding copies pixel data only, so camera settings, timestamps and GPS coordinates do not survive. If you need to preserve location data deliberately, this tool is not the right one for that photo.",
            ),
        ],
    },
    {
        "slug": "compress-to-100kb",
        "crumb": "Compress to 100 KB",
        "title": "Compress an Image to Under 100 KB — Free, No Upload",
        "description": "Shrink a photo or screenshot to under 100 KB in your browser. Set the budget once and the engine finds the highest quality that still fits. No uploads, no account, no limits.",
        "h1": "Compress an image to under 100 KB",
        "lead": "Application forms, visa portals, job sites and email attachments all draw the line somewhere, and 100 KB is where it usually lands. Set the budget once and the engine searches for the highest quality that still fits — lowering the resolution only if no quality setting can get there.",
        "badges": ["Nothing is uploaded", "Budget: 100 KB", "JPEG · WebP · AVIF", "Unlimited &amp; free"],
        "defaults": {"mode": "target", "targetKB": 100},
        "body": """      <h2>Why 100 KB is the limit you keep hitting</h2>
      <p>It is not an arbitrary number. Scanning software stores every application as a database row, and the image column is sized generously enough for a passport photo and no more. The limits people actually run into look like this:</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>Where</th><th>Typical limit</th><th>Usual format rule</th></tr>
          </thead>
          <tbody>
            <tr><td>Visa and government application portals</td><td>50 KB – 300 KB</td><td>JPG almost always</td></tr>
            <tr><td>Job applications and ATS uploads</td><td>100 KB – 500 KB</td><td>JPG or PNG</td></tr>
            <tr><td>University and scholarship forms</td><td>100 KB – 200 KB</td><td>JPG</td></tr>
            <tr><td>Passport and ID photo services</td><td>30 KB – 100 KB</td><td>JPG, fixed dimensions</td></tr>
            <tr><td>Email attachments</td><td>~25 MB total, but 100 KB keeps replies light</td><td>Anything</td></tr>
            <tr><td>Marketplace and classified listings</td><td>200 KB – 1 MB</td><td>JPG or WebP</td></tr>
          </tbody>
        </table>
      </div>
      <p>The frustrating part is that the form rarely tells you <em>how</em> to get there. Guessing at a quality slider and re-uploading five times is the normal workflow. It does not have to be.</p>

      <h2>How the target-size search works</h2>
      <p>The compressor does not apply a preset and hope. It runs a search.</p>

      <h3>It searches quality first</h3>
      <p>Starting from a high setting, it encodes the image, weighs the result, and halves the distance to the target — up to seven passes. Because the relationship between quality and file size is monotonic but not linear, a binary search converges on the largest file that still lands under your budget in a handful of attempts rather than a dozen.</p>

      <h3>It only reduces the resolution if it has to</h3>
      <p>Dimensions are sacred. Most tools jump straight to resizing, which is what makes a 100 KB photo look like it was taken through a window. Here the pixel size is touched only when <em>no</em> quality setting can reach the budget — and then in gentle steps, so you keep as much of the original frame as the limit allows.</p>

      <h3>It never hands back a file that is over budget</h3>
      <p>If the last pass overshoots, it keeps searching downwards. The number you see in the results panel is the real byte count of the file you are about to download, not an estimate.</p>

      <h2>Getting the most out of a tight limit</h2>
      <ul>
        <li><strong>Crop before you compress.</strong> Removing the empty sky around a subject removes detail the encoder no longer has to spend bits on. This buys more quality per kilobyte than any setting.</li>
        <li><strong>Do not send a photograph as PNG.</strong> A photo in PNG is routinely five to ten times larger than the same picture in JPG. If the form accepts JPG, use it.</li>
        <li><strong>Use WebP or AVIF when the form allows it.</strong> Where JPG needs 100 KB, WebP often needs around 70 KB for the same look, and AVIF less again — which means more of your original detail survives inside the budget.</li>
        <li><strong>Check whether the form also caps dimensions.</strong> Many ask for exactly 300 × 400 or similar. Compress first, then resize, or you may compress twice.</li>
      </ul>

      <h2>Other budgets in one place</h2>
      <p>The same control works for any number. Type <code>50</code>, <code>100</code>, <code>200</code>, <code>500</code> or <code>2000</code> into the target field — it is kilobytes, and it is the only setting you need to change. On the <a href="../compress/">main compressor</a> you can switch between target size, a fixed quality, and full auto.</p>""",
        "faq": [
            (
                "Can I compress an image to exactly 100 KB?",
                "Yes — pick Target size and enter <code>100</code>. The engine binary-searches encoder quality until the output fits under 100 KB, and reports the real byte count of the finished file rather than an estimate.",
            ),
            (
                "What if my photo cannot fit in 100 KB at full size?",
                "Then the engine reduces the pixel dimensions in steps until it fits. A very detailed 12-megapixel photograph will usually need some downscaling to reach 100 KB; a 1–2 megapixel image typically reaches the budget on quality alone and keeps every pixel.",
            ),
            (
                "Does compressing to 100 KB destroy the quality?",
                "It costs quality, and there is no way around that — 100 KB is a hard budget. What this tool does is spend the budget well: it finds the highest quality that fits instead of applying a fixed preset that might have come in at 40 KB and thrown away detail you were entitled to keep.",
            ),
            (
                "Can I do this on my phone?",
                "Yes. The page is touch-first and the compressor runs on any modern mobile browser, so you can shrink a photo to 100 KB straight from an iPhone or Android photo library without installing anything.",
            ),
            (
                "Is there a limit on how many images I can shrink?",
                "No. There is no file-count limit, no daily cap and no watermark. The only practical ceiling is your device's memory, because every image is processed on your own hardware rather than on a server that would have to meter it.",
            ),
            (
                "Are my images uploaded to a server?",
                "No. This is a static site with no upload endpoint. Your images are decoded, resampled and re-encoded inside your own browser, so they cannot leave your device even by accident.",
            ),
        ],
    },
    {
        "slug": "png-to-jpg",
        "crumb": "PNG to JPG",
        "title": "PNG to JPG Converter — Batch, Free, Runs in Your Browser",
        "description": "Convert PNG files to JPG without uploading them. Keep quality where it matters, flatten transparency onto white when you need to, and convert a whole folder at once. No account, no limits.",
        "h1": "Convert PNG to JPG without uploading anything",
        "lead": "PNG is excellent for screenshots and logos and wasteful for photographs. Drop a PNG in and get a JPG back — one file or a whole folder, converted on your own device in a couple of seconds.",
        "badges": ["Nothing is uploaded", "Batch conversion", "Transparency flattened", "Unlimited &amp; free"],
        "defaults": {"format": "jpeg"},
        "body": """      <h2>Why PNG files are so much larger</h2>
      <p>PNG is lossless by design. Every pixel is stored so that it can be recovered exactly, which is what you want for a screenshot with crisp text and what you emphatically do not need for a photograph of a dog. A picture that weighs 400 KB as a JPG can easily weigh 3 MB as a PNG, and almost all of that extra weight is information nobody will ever notice.</p>
      <p>Two more things inflate PNG: it stores an alpha channel whether or not anything uses it, and it does not take advantage of the way human vision is less sensitive to colour detail than to brightness. JPG discards exactly that colour detail, which is where most of the saving comes from.</p>

      <h2>What changes when you convert</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th></th><th>PNG</th><th>JPG</th></tr>
          </thead>
          <tbody>
            <tr><td>Compression</td><td>Lossless</td><td>Lossy, tuned per image here</td></tr>
            <tr><td>Transparency</td><td>Full alpha channel</td><td>None — flattened onto white</td></tr>
            <tr><td>Photographs</td><td>Very large</td><td>Roughly 5–10× smaller</td></tr>
            <tr><td>Text and line art</td><td>Crisp edges</td><td>Soft halos around edges</td></tr>
            <tr><td>Re-saving repeatedly</td><td>No degradation</td><td>Each save costs a little</td></tr>
          </tbody>
        </table>
      </div>
      <p>The transparency row is the one that bites people. JPG has no alpha channel, so a transparent PNG background becomes solid white. If you need the transparency to survive, convert to <a href="../jpg-to-webp/">WebP</a> instead — it keeps alpha <em>and</em> beats JPG on size.</p>

      <h2>When you should keep PNG instead</h2>
      <ul>
        <li><strong>Screenshots with text.</strong> JPG smears the edges of small type. A screenshot in PNG stays sharp and often compresses beautifully.</li>
        <li><strong>Logos, icons and flat illustrations.</strong> Hard edges and a handful of colours are exactly what PNG's palette mode is for — a good quantizer will beat a lossy JPG on both size and sharpness.</li>
        <li><strong>Anything with transparency you intend to keep.</strong></li>
        <li><strong>An intermediate step in an editing workflow.</strong> If you will open the file again, keep it lossless; export to JPG only at the very end.</li>
      </ul>
      <p>This tool respects that distinction. In Auto mode it measures the image and keeps it in PNG when PNG is genuinely the better answer — it will hand you back the original rather than a bigger file.</p>

      <h2>Converting a whole folder</h2>
      <p>Select every PNG you want in the file picker, or drag a multi-selection onto the page. Files are processed in parallel background workers, and <strong>Download all</strong> packages the finished JPGs into a single ZIP. On a phone the same results can be handed to the system share sheet so they land directly in your photo library — we deliberately do not send a ZIP to iOS, because the Files app will not unpack it into your camera roll.</p>""",
        "faq": [
            (
                "Will I lose transparency when converting PNG to JPG?",
                "Yes. JPG cannot store an alpha channel, so transparent areas are flattened onto white. If you need the transparency preserved, convert to WebP instead — it keeps alpha and produces smaller files than JPG.",
            ),
            (
                "Is converting PNG to JPG lossy?",
                "Yes, JPG is a lossy format. Auto mode holds measured fidelity above roughly 40 dB PSNR, which is past the point where differences are visible at normal viewing sizes. Keep your PNG as the master copy and convert only the version you need to share or upload.",
            ),
            (
                "Can I convert many PNG files at once?",
                "Yes. Select as many as you like and they convert in parallel. On desktop you can take everything as one ZIP archive; on an iPhone the finished files go to the system share sheet so they land in your photo library.",
            ),
            (
                "Why did my file come back unchanged?",
                "If re-encoding would have produced a larger file than the original, the original is kept and the row is labelled \"already optimal\". A screenshot that is already a well-optimised PNG is a common case — there is genuinely nothing left to remove.",
            ),
            (
                "Is my PNG uploaded anywhere?",
                "No. The conversion runs in your browser using the Canvas API and Web Workers. There is no upload endpoint on this site, so your files never leave your device.",
            ),
        ],
    },
    {
        "slug": "jpg-to-webp",
        "crumb": "JPG to WebP",
        "title": "JPG to WebP Converter — Smaller Files, Same Picture",
        "description": "Convert JPG to WebP in your browser and cut file size by roughly a quarter to a half with no visible difference. Batch conversion, transparency preserved, nothing uploaded.",
        "h1": "Convert JPG to WebP in your browser",
        "lead": "WebP holds the same picture as a JPG in meaningfully fewer bytes, every current browser can display it, and unlike JPG it keeps transparency. Convert one file or a whole folder, on your own device.",
        "badges": ["Nothing is uploaded", "24–54% smaller in Auto mode", "Keeps transparency", "Unlimited &amp; free"],
        "defaults": {"format": "webp"},
        "body": """      <h2>What WebP does better than JPG</h2>
      <p>WebP is a modern format from the same era as AVIF, built on the video codec work that produced VP8 and VP9. Two comparisons get quoted for it and they disagree, so here are both, measured on our own encoders. Running a 2400×1600 camera JPEG through Auto mode — where the engine finds the lowest quality that still clears a ~40 dB fidelity floor — the saving was 24–54%. Measured the other way round, at equal 40 dB fidelity, WebP came out roughly <em>level</em> with MozJPEG: the lead WebP is usually credited with shows up in perceptual metrics and at lower quality settings, not in PSNR against a strong JPEG encoder. On graphics with flat colour the picture is less ambiguous, because JPG smudges hard edges and WebP does not.</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th></th><th>JPG</th><th>WebP</th></tr>
          </thead>
          <tbody>
            <tr><td>Photograph, Auto mode</td><td>Baseline</td><td>24–54% smaller (measured)</td></tr>
            <tr><td>Photograph at matched 40 dB fidelity</td><td>Baseline</td><td>About level (measured)</td></tr>
            <tr><td>Flat-colour graphics</td><td>Baseline</td><td>Clearly smaller</td></tr>
            <tr><td>Transparency</td><td>Not supported</td><td>Supported, with alpha</td></tr>
            <tr><td>Animation</td><td>No</td><td>Yes</td></tr>
            <tr><td>Browser support</td><td>Universal</td><td>Every current browser</td></tr>
            <tr><td>Older editors and some upload forms</td><td>Always accepted</td><td>Occasionally rejected</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Where WebP is not the answer</h2>
      <p>Be honest about the trade-off. WebP is the wrong choice when the file has to open in software you do not control: a client's legacy CMS, a print workflow, a government upload form that whitelists <code>.jpg</code> by extension. It is also pointless if you will re-edit the image repeatedly — every lossy save costs something, so keep a master and export WebP at the end.</p>
      <p>And if you want the smallest file that current browsers can read, <a href="../compress/">AVIF</a> usually beats WebP by a further 20–30%, at the cost of noticeably slower encoding.</p>

      <h2>How the conversion is done here</h2>
      <p>Your JPG is decoded once, and encoded once to WebP — this is not a re-compression of an already-compressed file, which is what quietly destroys quality in naive converters. In Auto mode the engine measures the image first and chooses the lowest quality that still clears a perceptual fidelity floor, so a smooth sky does not get the same treatment as a hedge full of leaves.</p>
      <p>Because everything runs locally, the page never needs to see your image on a server. The optional WebP encoder is a WebAssembly module fetched from a public CDN on first use; if that CDN is unreachable the browser's own WebP encoder takes over, and the conversion still works.</p>

      <h2>Batch conversion</h2>
      <p>Drop a whole folder in and the files convert in parallel background workers. On desktop, <strong>Download all</strong> gives you a single ZIP; on an iPhone the results can be handed to the share sheet so they go straight into your photo library.</p>""",
        "faq": [
            (
                "Is WebP supported everywhere now?",
                "In browsers, effectively yes — Chrome, Firefox, Safari and Edge have all supported WebP for years, as has iOS since 14. Support in older desktop editors, some print workflows and a minority of upload forms is still patchy, so check what the destination accepts.",
            ),
            (
                "How much smaller is WebP than JPG?",
                "It depends which comparison you mean, so here are both from our own measurements. In Auto mode the saving against the original JPG was 24–54%, because the engine picks the lowest quality that still clears a ~40 dB fidelity floor. At <em>matched</em> 40 dB fidelity WebP came out roughly level with MozJPEG — the commonly quoted 25–50% compares WebP against a baseline JPEG encoder rather than MozJPEG, which is what this tool uses. On flat-colour graphics the saving is larger either way, because WebP handles hard edges far better than JPG does.",
            ),
            (
                "Does WebP keep transparency?",
                "Yes. WebP stores a full alpha channel, so a transparent PNG converted to WebP keeps its transparency — something JPG cannot do at all, since it flattens transparent areas onto white.",
            ),
            (
                "Is converting JPG to WebP lossy?",
                "Yes, both formats are lossy. The image is decoded once from your original and encoded once at high fidelity, so you pay for one generation of loss rather than two. Keep your original JPG as the master and convert the copy you publish.",
            ),
            (
                "Are my images uploaded to a server?",
                "No. There is no upload endpoint on this site. The conversion happens in your browser tab, and the only network requests are for the site's own files and the optional WebP encoder module.",
            ),
        ],
    },
]


def build(spec):
    url = ORIGIN + "/" + spec["slug"] + "/"
    head = HEAD

    if "data-compressor-defaults" in head:
        head = re.sub(r' data-compressor-defaults=\'[^\']*\'', "", head)
    head = head.replace(
        '<html lang="en" data-theme="light">',
        '<html lang="en" data-theme="light" data-compressor-defaults=\'%s\'>'
        % json.dumps(spec["defaults"], separators=(",", ":")),
    )

    head = re.sub(r"<title>.*?</title>", "<title>%s</title>" % spec["title"], head, flags=re.S)
    head = re.sub(
        r'<meta name="description" content="[^"]*">',
        '<meta name="description" content="%s">' % spec["description"],
        head,
    )
    head = re.sub(r'<link rel="canonical" href="[^"]*">', '<link rel="canonical" href="%s">' % url, head)
    head = re.sub(r'<meta property="og:url" content="[^"]*">', '<meta property="og:url" content="%s">' % url, head)
    head = re.sub(r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="%s">' % spec["title"], head)
    head = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        '<meta property="og:description" content="%s">' % spec["description"],
        head,
    )
    head = re.sub(r'<meta name="twitter:title" content="[^"]*">', '<meta name="twitter:title" content="%s">' % spec["title"], head)
    head = re.sub(
        r'<meta name="twitter:description" content="[^"]*">',
        '<meta name="twitter:description" content="%s">' % spec["description"],
        head,
    )
    head = re.sub(
        r'<script type="application/ld\+json">.*?</script>',
        lambda m: json_ld(spec["slug"], spec["title"], spec["description"], spec["faq"]),
        head,
        count=1,
        flags=re.S,
    )

    header = HEADER.replace(' href="../compress/" aria-current="page"', ' href="../compress/"')
    header = header.replace(
        '<a class="nav__link" href="../heic-to-jpg/">HEIC to JPG</a>',
        '<a class="nav__link" href="../heic-to-jpg/">HEIC to JPG</a>',
    )

    page = (
        head
        + "<body>\n"
        + SKIP
        + "\n\n"
        + header
        + "\n"
        + hero_html(spec["crumb"], spec["h1"], spec["lead"], spec["badges"])
        + TOOL
        + seo_html(spec["body"], spec["faq"])
        + AFTER
    )
    return page


def write(path, text):
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old == text:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8", newline="\n").write(text)
    return True


def main():
    changed = []
    for spec in SPECS:
        out = os.path.join(SITE, spec["slug"], "index.html")
        if write(out, build(spec)):
            changed.append(spec["slug"])
            print("  wrote  /%s/" % spec["slug"])
        else:
            print("  same   /%s/" % spec["slug"])
    print("\n%d page(s) changed" % len(changed))


if __name__ == "__main__":
    main()
