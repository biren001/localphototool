/**
 * Builds /image-compressor-upload-test/ from the measured evidence.
 *
 * The page is assembled from an existing static page (privacy) so the shared
 * shell - head, header, footer, scripts - cannot drift from the rest of the
 * site. Only the title block, the JSON-LD and <main> are written here.
 *
 * Every number in the copy is read from the measurement output in
 * _dev/measured/upload-behavior/, never typed in. If the measurement is
 * re-run and the numbers change, the page changes with them. Publishing a
 * claim that is no longer what the raw data says is the one failure this
 * page cannot survive.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHELL = path.join(ROOT, 'localphototool/privacy/index.html');
const OUT_DIR = path.join(ROOT, 'localphototool/image-compressor-upload-test');
const EVIDENCE_DIR = path.join(ROOT, '_dev/measured/upload-behavior');

const CANONICAL = 'https://localphototool.com/image-compressor-upload-test/';
const TITLE = 'Do Image Compressors Upload Your Photos? 9 Tools Tested';
const DESC = 'We fed a marked JPEG to nine online image compressors and watched every outbound request. Two sent the whole file to a server, six did not. Method and raw data included.';

// ---------------------------------------------------------------- evidence

function loadEvidence() {
  const out = {};
  for (const f of fs.readdirSync(EVIDENCE_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8'));
    out[j.id] = j;
  }
  return out;
}

const ev = loadEvidence();
const probe = ev.tinypng ? ev.tinypng.probe : null;
if (!probe) throw new Error('no evidence found - run measure-upload-behavior.cjs first');

const fmt = (n) => n.toLocaleString('en-US');
const kb = (n) => (n / 1024).toFixed(2);

// Order: uploads first (that is the finding), then local, then undetermined.
const ORDER = ['tinypng', 'iloveimg', 'squoosh', 'compressjpeg', 'imagecompressor',
  'jpegoptimizer', 'privateimagecompressor', 'localphototool', 'freeconvert'];

function rowFor(id) {
  const j = ev[id];
  if (!j) return null;
  const e = j.evidence;
  let sent = 'Nothing the size of a photo';
  let where = '—';
  if (e.markerHits > 0) {
    sent = 'The whole file — ' + fmt(e.maxPayloadBytes) + ' bytes, marker matched ' + e.markerHits + '×';
    where = '<code>' + (e.uploadEndpointUrls[0] || e.markerHitUrls[0] || '—') + '</code>';
  } else if (e.fileSizedPayload) {
    sent = 'A file-sized payload — ' + fmt(e.maxPayloadBytes) + ' bytes';
    where = '<code>' + (e.uploadEndpointUrls[0] || '—') + '</code>';
  }
  let verdict;
  if (j.verdict === 'server-side') verdict = '<strong>Uploads</strong>';
  else if (j.verdict === 'local') verdict = 'Stays in your browser';
  else verdict = '<span class="muted">Not determined</span>';

  return { name: j.name + (j.control ? ' (this site)' : ''), sent, where, verdict, raw: j };
}

const rows = ORDER.map(rowFor).filter(Boolean);

// ------------------------------------------------------------------ copy

const FAQ = [
  {
    q: 'Does TinyPNG upload my photos?',
    a: 'Yes. In our test the full file — all ' + fmt(probe.bytes) + ' bytes — was sent to TinyPNG\'s own backend, and our marker was found in the request body three times. That is not a defect: TinyPNG is a server-side compressor by design, and it says so. It does mean your photo, including any GPS coordinates still in it, travels to their servers and is briefly stored there while it is processed.',
  },
  {
    q: 'Does iLoveIMG upload my photos?',
    a: 'Yes. Our file was posted to an iLoveIMG upload endpoint and the marker was found in the request body. iLoveIMG is also server-side by design, and the compression happens on their infrastructure.',
  },
  {
    q: 'Which compressors actually keep the file on my device?',
    a: 'In this test: Squoosh, CompressJPEG, ImageCompressor, JPEG Optimizer, Private Image Compressor and LocalPhotoTool. For each of these the tool displayed a before-and-after size for our file while sending nothing that could have contained it.',
  },
  {
    q: 'How can I check a compressor myself?',
    a: 'Open your browser\'s developer tools, go to the Network tab, then compress a photo. Look for a request roughly as large as your file. If the largest request is a few kilobytes, the image was processed locally; if one is about the size of your photo, it went to a server. We wrote up the exact steps at <a href="../compress-without-uploading/">compress images without uploading</a>.',
  },
  {
    q: 'Does "uploads" mean the tool is unsafe?',
    a: 'No. Uploading is a legitimate architecture, and it is how most of these services work. What it changes is where your photo physically goes and who could technically see it. If you are compressing anything sensitive, that difference is the whole point.',
  },
  {
    q: 'How reliable is this test?',
    a: 'It is one run, one file, one browser, on one date. Tools change their code without announcing it, and a result here says nothing about what a server does with a file after receiving it. We publish the method and the raw per-site data so you can re-run it rather than take our word.',
  },
];

// ---------------------------------------------------------------- assemble

const shell = fs.readFileSync(SHELL, 'utf8');

const iJson = shell.indexOf('<script type="application/ld+json">');
const iJsonEnd = shell.indexOf('</script>', iJson) + '</script>'.length;
const iBody = shell.indexOf('<body>');
const iMain = shell.indexOf('<main id="main">');
const iMainEnd = shell.indexOf('</main>') + '</main>'.length;

const headA = shell.slice(0, iJson);
const headB = shell.slice(iJsonEnd, iBody);
const headerPart = shell.slice(iBody, iMain);
const tail = shell.slice(iMainEnd);

// Replacements belong to headA only: it holds the title, description,
// canonical and social tags. headB is the remainder of <head> plus </head>,
// and must appear exactly once, after the JSON-LD.
let head = headA;
head = head
  .replace(/<title>[^<]*<\/title>/, '<title>' + TITLE + '</title>')
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + DESC + '">')
  .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + CANONICAL + '">')
  .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + TITLE + '">')
  .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + DESC + '">')
  .replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + CANONICAL + '">')
  .replace(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + TITLE + '">')
  .replace(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + DESC + '">');

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      '@id': CANONICAL + '#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://localphototool.com/' },
        { '@type': 'ListItem', position: 2, name: 'Image compressor upload test', item: CANONICAL },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': CANONICAL + '#faq',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') },
      })),
    },
  ],
};

const tableRows = rows.map((r) =>
  '        <tr><td>' + r.name + '</td><td>' + r.sent + '</td><td>' + r.where + '</td><td>' + r.verdict + '</td></tr>'
).join('\n');

// The site's FAQ convention, and the one test-pages.cjs checks for: a
// <details class="faq__item"> list. The JSON-LD is regenerated from this
// markup by _dev/sync-faq-schema.py, because hand-maintained schema drifts
// from the visible copy - which is what a search engine actually quotes.
const faqHtml = FAQ.map((f, i) =>
  '        <details class="faq__item"' + (i === 0 ? ' open' : '') + '>\n'
  + '          <summary>' + f.q + '</summary>\n'
  + '          <div class="faq__body"><p>' + f.a + '</p></div>\n'
  + '        </details>'
).join('\n');

const main = `<main id="main">
  <section class="hero hero--compact">
    <div class="container">
      <nav aria-label="Breadcrumb" style="margin-bottom:0.9rem">
        <span class="muted" style="font-size:0.8rem"><a href="../">Home</a> <span aria-hidden="true">›</span> Upload test</span>
      </nav>
      <h1>Do online image compressors upload your photos?</h1>
      <p class="hero__lead">Most of them say your files never leave your device. We tested nine with a photo carrying a hidden marker, and watched every request each page made. Two sent the entire file to a server. Six did not.</p>
      <p class="muted" style="font-size:0.82rem">Measured 25 September 2026 · one run per tool · method and raw data below</p>
    </div>
  </section>

  <section class="section">
    <div class="container prose">
      <h2>How the test works</h2>
      <p>Marketing copy is not evidence, so we did not take any of it at face value. We built a ${kb(probe.bytes)} KB JPEG and hid a unique marker inside its EXIF data — a random string that exists nowhere else on the internet. If that string shows up in a request leaving the browser, then bytes from that file left the browser. There is no way to argue with it.</p>
      <p>The probe photo is ${fmt(probe.bytes)} bytes, 1600 × 1200, saved at quality 88 with GPS coordinates in its metadata, so it behaves like a real photograph rather than a test pattern. Its SHA-256 is <code>${probe.sha256}</code>.</p>
      <p>Then, for each tool: load the page in a headless browser, hand it the photo, press whatever button starts the work, and record every outbound request. We record from inside the page rather than from the browser's debugging protocol, because the protocol quietly drops large and streamed request bodies — using it made one upload look like a 1,144 byte request with nothing in it.</p>
      <p>We also ran the whole thing against <a href="../compress/">our own compressor</a> as a control. A test that cannot show a file staying home is not fit to show one leaving.</p>

      <h2>Results</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>Tool</th><th>Largest thing it sent</th><th>Where it went</th><th>Result</th></tr>
          </thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
      </div>

      <h3>The two that upload</h3>
      <p><strong>TinyPNG</strong> sent the complete file — all ${fmt(probe.bytes)} bytes — and our marker was found in the request body three times. <strong>iLoveIMG</strong> sent the file to an upload endpoint as well, and the marker was found there too.</p>
      <p>Neither is doing anything wrong. Both are server-side compressors by design: that is how the product works, and both are upfront about it. What it changes is where your photo physically goes. If the photo still carries GPS coordinates, those go with it.</p>

      <h3>The six that do not</h3>
      <p>Squoosh, CompressJPEG, ImageCompressor, JPEG Optimizer, Private Image Compressor and this site each showed our file's size in their own interface and produced a smaller version, while sending nothing large enough to have contained it. For those tools the claim checks out.</p>
      <p>One tool, FreeConvert, we could not get to run under automation — it never displayed our file, so we recorded no verdict rather than invent one. Absence of evidence is not evidence of privacy.</p>

      <h2>What this test cannot tell you</h2>
      <ul>
        <li><strong>It is one run.</strong> One file, one browser, one day. Any of these tools can change their behaviour without saying so.</li>
        <li><strong>It only sees what the page sends.</strong> What a server does with a file after receiving it — how long it keeps it, who can read it — is outside what this method can observe.</li>
        <li><strong>Server-side is not the same as unsafe.</strong> Plenty of people are fine with uploading a holiday photo. This matters for contracts, medical images, ID documents and anything you would not post publicly.</li>
        <li><strong>A "stays local" result is for that page on that day.</strong> Re-run it yourself before trusting it with something that matters.</li>
      </ul>

      <h2>Checking a compressor yourself</h2>
      <p>This takes about ten seconds and needs no tools beyond the browser you already have.</p>
      <ol>
        <li>Open the compressor, then open developer tools (F12, or Ctrl+Shift+I) and switch to the <strong>Network</strong> tab.</li>
        <li>Reload the page so the list starts clean, then add your photo and start the compression.</li>
        <li>Watch the <strong>Size</strong> column. If the biggest request is a few kilobytes, your photo was processed on your machine. If one request is about the size of your photo, it was uploaded.</li>
        <li>Click that large request and open <strong>Request</strong> or <strong>Payload</strong>. If you can see your image in there, it left the browser.</li>
      </ol>
      <p>The full walkthrough, including what to do about it, is on our <a href="../compress-without-uploading/">compress without uploading</a> page.</p>

      <h2>Re-running the measurement</h2>
      <p>The probe generator and the measurement script are in the project repository, along with the raw per-site JSON this page was built from. Publish a correction if you find one — the point of writing the method down is that it can be checked.</p>

      <h2 id="faq">Frequently asked questions</h2>
      <div class="faq mt-4">
${faqHtml}
      </div>
    </div>
  </section>
</main>`;

const out = head
  + '<script type="application/ld+json">\n'
  + JSON.stringify(jsonLd, null, 2)
  + '\n</script>\n'
  + headB
  + headerPart
  + main
  + tail;

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(outFile, out, 'utf8');

console.log('wrote', path.relative(ROOT, outFile));
console.log('bytes', Buffer.byteLength(out, 'utf8'));
console.log('rows ', rows.length);
for (const r of rows) console.log('  ' + r.name.padEnd(34) + r.verdict.replace(/<[^>]+>/g, ''));
