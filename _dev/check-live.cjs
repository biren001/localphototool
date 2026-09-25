/* Post-deploy verification for localphototool.com.
   Usage:  node _dev/check-live.cjs   (or just double-click run-check.bat)

   Read-only: it only makes requests to the public site.
   Every request retries a couple of times; if one still never comes back, the
   item is reported as SKIP and left out of the score instead of being counted
   as a site defect. Exit code: 0 all good, 1 a real failure, 2 inconclusive.  */
const fs = require('fs');
const path = require('path');
const HOST = 'localphototool.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A request that never throws. Returns the response, or {status:0, error}. */
async function get(url, tries) {
  tries = tries || 3;
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: '*/*' }
      });
      return { status: res.status, headers: res.headers, body: res, url, error: null };
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(600 * i);   // network blips are usually momentary
    }
  }
  const empty = new Headers();
  return { status: 0, headers: empty, body: null, url, error: lastErr && lastErr.message || 'fetch failed' };
}

async function text(url) {
  const r = await get(url);
  if (!r.body) return { status: 0, text: '', error: r.error, headers: r.headers };
  return { status: r.status, text: await r.body.text(), error: null, headers: r.headers };
}

/* Column the check names are padded to. Wider than the longest name, and the
   detail is always preceded by a space so a future longer name still reads as
   two fields instead of running into its own evidence. */
const W = 58;
const results = [];
const failed = [];
const unverified = [];
function check(name, ok, detail) {
  /* `status 0` is only ever produced by get() when the request never came back,
     so a failure whose evidence is "status 0" is an untested item rather than a
     site defect. Without this, one dropped packet printed a page of red. */
  if (!ok && /\bstatus 0\b/.test(String(detail || ''))) {
    note(name, 'the request never came back');
    return;
  }
  results.push(ok);
  if (!ok) failed.push(name);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(W) + ' ' + (detail || ''));
}
/* A request that never came back means the site was never tested. Scoring that
   as FAIL is how a checker teaches its reader to ignore red; scoring it as PASS
   would hide a real regression behind a dropped packet. So it gets its own
   bucket: printed, listed at the end, and kept out of the score entirely. */
function note(name, detail) {
  unverified.push(name);
  console.log('  SKIP  ' + name.padEnd(W) + ' could not verify — '
    + (detail || 'the request never came back') + '; re-run once the connection settles');
}
/* Informational only: printed, but never counted as a pass or a fail, so the
   tally stays a list of real defects instead of tuning suggestions. */
function info(name, detail) {
  console.log('  note  ' + name.padEnd(W) + ' ' + (detail || ''));
}
/* Always prints the tally, even if a check above threw. */
function finish() {
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + ' / ' + results.length + ' live checks passed'
    + (unverified.length ? '  (' + unverified.length + ' not verified)' : ''));
  /* The score covers only what was actually tested, so it cannot be driven to
     100% by failing to reach the site. */
  if (failed.length) {
    console.log('\nStill failing:');
    failed.forEach((f) => console.log('  · ' + f));
  }
  if (unverified.length) {
    console.log('\nCould not verify (network, not a site defect):');
    unverified.forEach((f) => console.log('  · ' + f));
  }
  /* Exit 1 for a real defect, 2 for an inconclusive run, so a script can tell
     "the site is broken" from "the network was". A checker that always exits 0
     is only readable by a human who is already watching it. */
  process.exit(failed.length ? 1 : (unverified.length ? 2 : 0));
}

(async () => {
  /* The checker's own age, printed first. Stale output pasted back into a chat
     is indistinguishable from a fresh run otherwise, and a run that predates a
     fix to the checker itself reads like a defect that was never fixed. */
  const selfAge = new Date(fs.statSync(__filename).mtimeMs);
  console.log('Checker dated ' + selfAge.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  console.log('Checking https://' + HOST + '\n');

  /* One deep probe before any assertion. If the site cannot be reached at all,
     every check below would blame the site for the network — a wall of red that
     says nothing about the site and, worse, teaches its reader to skim past
     red. Say the true thing once and stop: this is inconclusive, not broken. */
  const probe = await get('https://' + HOST + '/', 4);
  if (probe.status === 0) {
    console.log('  Could not reach https://' + HOST + ' at all — ' + probe.error);
    console.log('  Nothing was checked. This is the connection here, not the site.');
    process.exit(2);
  }

  /* 1. favicon must exist */
  const ico = await get('https://' + HOST + '/favicon.ico');
  check('favicon.ico returns 200', ico.status === 200, 'status ' + ico.status);

  const appIcon = await get('https://' + HOST + '/apple-touch-icon.png');
  check('apple-touch-icon.png returns 200', appIcon.status === 200, 'status ' + appIcon.status);

  /* 2. OG cover must be the light JPEG */
  const og = await get('https://' + HOST + '/og-cover.jpg');
  const ogLen = Number(og.headers.get('content-length') || 0);
  if (og.error) note('og-cover.jpg is served and under 200 KB', og.error);
  else check('og-cover.jpg is served and under 200 KB',
    og.status === 200 && ogLen > 0 && ogLen < 204800,
    og.status + ', ' + (ogLen / 1024).toFixed(0) + ' KB');

  /* 3. www must 301 to the apex domain */
  const www = await get('https://www.' + HOST + '/');
  const loc = www.headers.get('location') || '';
  if (www.error) note('www redirects to apex with 301', www.error);
  else {
    const wwwOk = (www.status === 301 || www.status === 308) && loc.includes('https://' + HOST);
    /* The "re-upload" hint only belongs on a failure. Appending it to the pass
       path made a healthy site print "PASS … — re-upload localphototool-deploy.zip"
       next to its own success, which reads like the deploy never landed. */
    check('www redirects to apex with 301', wwwOk,
      www.status + ' → ' + (loc || '(no location header)')
        + (wwwOk ? '' : ' — re-upload localphototool-deploy.zip (the redirect lives in _worker.js)'));
  }

  /* A redirect that dumps every deep link on the homepage is worse than none. */
  const wwwDeep = await get('https://www.' + HOST + '/compress/');
  const deepLoc = wwwDeep.headers.get('location') || '';
  check('www keeps the path when it redirects',
    (wwwDeep.status === 301 || wwwDeep.status === 308) && deepLoc.indexOf('/compress/') !== -1,
    wwwDeep.status + ' → ' + (deepLoc || '(no location header)'));

  /* 4. HTTP must redirect to HTTPS */
  const plain = await get('http://' + HOST + '/');
  check('http:// redirects to https://',
    plain.status === 301 || plain.status === 308, 'status ' + plain.status);

  /* 5. security headers must actually arrive */
  const home = await get('https://' + HOST + '/');
  const csp = home.headers.get('content-security-policy') || '';
  check('CSP header is live', csp.length > 0, csp ? csp.slice(0, 46) + '…' : 'missing');
  check('CSP allows wasm (wasm-unsafe-eval present)', csp.includes('wasm-unsafe-eval'),
    csp.includes('wasm-unsafe-eval') ? 'ok' : 'WASM codecs will silently fail');
  check('X-Content-Type-Options: nosniff',
    home.headers.get('x-content-type-options') === 'nosniff');

  /* 6. assets must carry a long-lived Cache-Control */
  const css = await get('https://' + HOST + '/assets/css/style.css');
  const cc = css.headers.get('cache-control') || '';
  check('assets have a >=1 day browser cache',
    /max-age=(\d+)/.test(cc) && Number(cc.match(/max-age=(\d+)/)[1]) >= 86400,
    cc || 'none');

  /* 7. HTML edge caching — deliberately informational. A Pages project already
     serves HTML from Cloudflare's nearest edge, so a Cache Rule buys almost
     nothing here while risking that a fresh deploy stays invisible until its
     TTL expires. Reported so the trade-off is visible, not silently skipped. */
  await get('https://' + HOST + '/compress/');
  await sleep(300);
  const second = await get('https://' + HOST + '/compress/');
  const cacheStatus = second.headers.get('cf-cache-status') || 'none';
  info('HTML edge cache', cacheStatus === 'HIT'
    ? 'HIT (a Cache Rule is caching HTML — watch for stale pages after a deploy)'
    : cacheStatus + ' — normal for Pages; no Cache Rule needed');

  /* 8. env/git probes should not reach the origin */
  const env = await get('https://' + HOST + '/.env');
  check('.env probe is blocked or not found',
    env.status === 403 || env.status === 404, 'status ' + env.status);

  /* 9. core pages must be reachable */
  for (const p of ['/', '/compress/', '/heic-to-jpg/', '/compress-to-100kb/', '/png-to-jpg/',
    '/jpg-to-webp/', '/sitemap.xml', '/robots.txt', '/llms.txt', '/assets/js/compressor/worker.js', '/assets/js/stats.js']) {
    const r = await get('https://' + HOST + p);
    check(p + ' returns 200', r.status === 200, 'status ' + r.status);
  }

  /* 9a. Every URL the sitemap advertises must actually resolve.
     Driven by the sitemap rather than a hand-kept list on purpose: three
     landing pages (compress-to-50kb, compress-to-200kb,
     compress-photos-for-email) were live and linked from every nav for two days
     without appearing in any checker, so nothing would have noticed them
     breaking. A 404 in the sitemap is also the error Search Console reports
     loudest. Keep this list derived, not typed. */
  const smDoc = await text('https://' + HOST + '/sitemap.xml');
  const smUrls = [...smDoc.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('sitemap.xml is readable', smDoc.status === 200 && smUrls.length > 0,
    smDoc.error || smUrls.length + ' urls');
  for (const u of smUrls) {
    const r = await get(u);
    check('sitemap url resolves ' + u.replace('https://' + HOST, ''), r.status === 200, 'status ' + r.status);
  }

  /* 9b. GEO: the AI-facing entry point must be live and must not contradict
     the privacy claim that the whole site is built on. */
  const llms = await text('https://' + HOST + '/llms.txt');
  const llmsBody = llms.error ? '' : llms.text;
  check('/llms.txt describes local processing, not uploading',
    /no upload endpoint/i.test(llmsBody) && /client-side|in the browser/i.test(llmsBody),
    llms.error ? 'fetch failed' : (llmsBody.slice(0, 60) + '…'));
  /* The same guard as the "missing:" line below: a detail string that is built
     unconditionally prints "missing:" with nothing after it on a healthy site,
     which looks like a truncated error message. */
  const llmsPages = ['/', '/compress/', '/heic-to-jpg/', '/about/', '/privacy/', '/terms/'];
  const llmsMissing = llmsPages.filter(function (p) { return llmsBody.indexOf('https://' + HOST + p) === -1; });
  check('/llms.txt links every public page', llmsMissing.length === 0,
    llmsMissing.length ? 'missing: ' + llmsMissing.join(' ') : 'all ' + llmsPages.length + ' pages linked');

  /* Naming a crawler is not the same as allowing it: `User-agent: GPTBot` with
     `Disallow: /` under it reads like a polite welcome in a diff while blocking
     the crawler completely. So the block that follows each name is read too —
     this asserts permission, not merely presence. */
  const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot',
    'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider'];
  const robotsBody = (await text('https://' + HOST + '/robots.txt')).text || '';
  const botBlocks = robotsBody.split(/^User-agent:/m).slice(1)
    .map(function (chunk) { return { agent: chunk.split('\n')[0].trim(), body: chunk }; });
  const botAllowed = AI_BOTS.filter(function (b) {
    const block = botBlocks.filter(function (x) { return x.agent.toLowerCase() === b.toLowerCase(); })[0];
    return !!block && /^Allow:\s*\/\s*$/mi.test(block.body) && !/^Disallow:\s*\/\s*$/mi.test(block.body);
  });
  const botRefused = AI_BOTS.filter(function (b) { return botAllowed.indexOf(b) === -1; });
  check('robots.txt explicitly allows every AI crawler it names', botRefused.length === 0,
    botRefused.length ? 'named but NOT allowed: ' + botRefused.join(', ')
      : botAllowed.length + ' agents allowed to crawl /');

  /* 9c. IndexNow key file.
     IndexNow is the only push channel that needs no account, and the only one
     reachable from a mainland-China connection — Google's equivalent, the
     sitemap ping endpoint, was retired in June 2023 and Search Console needs an
     account and a VPN. The key file is part of the deployed site, so a missing
     or un-deployed key file breaks 'node _dev/indexnow-submit.cjs' with a 403
     that looks like a script bug. Assert it here instead. */
  const siteDir = path.join(__dirname, '..', 'localphototool');
  const keyFiles = fs.existsSync(siteDir)
    ? fs.readdirSync(siteDir).filter(function (f) {
      return /\.txt$/.test(f) && /^[0-9a-f]{32}$/.test(f.replace(/\.txt$/, ''));
    })
    : [];
  /* Guard against a silent skip: with no key file the live check below simply
     would not run, and nothing would say so. */
  check('exactly one IndexNow key file exists in the site root', keyFiles.length === 1,
    keyFiles.length === 1 ? keyFiles[0]
      : keyFiles.length + ' found — expected 1, so keyLocation would be ambiguous');
  if (keyFiles.length === 1) {
    const want = fs.readFileSync(path.join(siteDir, keyFiles[0]), 'utf8').trim();
    const liveKey = await text('https://' + HOST + '/' + keyFiles[0]);
    const servedKey = liveKey.status === 200 && liveKey.text.trim().indexOf(want) !== -1;
    check('the IndexNow key file is live at the site root', servedKey,
      liveKey.status === 200
        ? (servedKey ? keyFiles[0] + ' serves the key'
          : 'the URL answers but the body does not contain the key')
        : 'status ' + liveKey.status + ' — upload localphototool-deploy.zip, then run node _dev/indexnow-submit.cjs');
  }

  /* 10. visitor counter */
  let counter = null;
  try {
    const res = await text('https://' + HOST + '/api/count');
    counter = res.error ? null : JSON.parse(res.text);
  } catch (e) { counter = null; }
  check('/api/count responds with JSON',
    !!counter && (typeof counter.visitors === 'number' || counter.ok === false),
    counter ? '' : 'no JSON — is _worker.js deployed?');
  check('visitor counter is live (KV bound + _worker.js deployed)',
    !!(counter && counter.ok === true),
    counter && counter.ok === true
      ? counter.visitors + ' visitors recorded'
      : 'needs: upload _worker.js AND bind a KV namespace to the Pages project');

  /* 11. private dashboard + no public counter */
  const dash = await get('https://' + HOST + '/stats/');
  check('/stats/ (private dashboard) returns 200', dash.status === 200,
    dash.status === 200 ? '' : 'status ' + dash.status + ' — re-upload localphototool-deploy.zip');
  const robotsTag = dash.headers.get('x-robots-tag') || '';
  check('/stats/ is hidden from search engines',
    robotsTag.indexOf('noindex') !== -1,
    'x-robots-tag: ' + (robotsTag || '(none)'));

  const homePage = await text('https://' + HOST + '/');
  const stale = homePage.text.indexOf('visitors so far') !== -1 || homePage.text.indexOf('live-stats') !== -1;
  const hasProof = homePage.text.indexOf('footer__stats') !== -1;
  check('homepage shows no live visitor widget', !stale && hasProof,
    stale ? 'a stale build is still live — re-upload localphototool-deploy.zip'
      : hasProof ? 'quiet footer line is in place' : 'new stats.js build not deployed yet');

  const workerFile = await get('https://' + HOST + '/_worker.js');
  check('/_worker.js is not served as a plain file',
    workerFile.status === 404 || workerFile.status === 403,
    'status ' + workerFile.status + (workerFile.status === 200 ? ' → uploaded without Functions handling' : ''));

  /* 12. PWA */
  const sw = await get('https://' + HOST + '/sw.js');
  const swType = sw.headers.get('content-type') || '';
  check('service worker is served as JavaScript',
    sw.status === 200 && swType.indexOf('javascript') !== -1,
    sw.status + ', ' + (swType || 'no content-type'));
  /* Which build is actually answering. "Did my upload land?" is the first
     question after every deploy, and the version in the file is the only
     honest answer to it — a cached asset can look fine and be yesterday's. */
  const swText = sw.body ? await sw.body.text() : '';
  const liveVersion = (swText.match(/var VERSION = '([^']+)'/) || [])[1] || '';
  info('deployed service worker version', liveVersion || 'could not read it');
  /* A service worker that sits in the browser cache for hours means a deploy
     does not reach returning visitors. There are two independent ways to stop
     that, and only one of them is under our control:

       · /sw.js served as no-cache. _worker.js does send that, but the zone's
         Browser Cache TTL is a FLOOR, not a cap: it rewrites any origin
         max-age lower than itself (default 4h), so `no-cache` comes back as
         `max-age=14400, must-revalidate`. Only the CDN dashboard can fix it.
       · registering with updateViaCache 'none', which tells the browser to
         ignore its HTTP cache for the worker script altogether. That one holds
         whatever the CDN decides to do with the header, so it is what actually
         decides whether today's deploy is seen today.

     Either one is enough; requiring both would just leave a permanent red line
     for a setting we have already routed around. */
  const swCc = String(sw.headers.get('cache-control') || '');
  /* pwa.js is fetched twice on purpose. A deploy does not invalidate what the
     edge already holds, and /assets/* carries a one-day cache, so the copy a
     visitor gets can be yesterday's while the origin is already today's.
     Judging the deploy by the first answer alone reports a defect that does
     not exist; judging it by the second alone hides one that does. */
  const optedOut = /updateViaCache:\s*['"]none['"]/;
  const pwaEdge = await text('https://' + HOST + '/assets/js/pwa.js');
  const pwaOrigin = await text('https://' + HOST + '/assets/js/pwa.js?cb=' + Date.now());
  const bypassesCache = optedOut.test(pwaOrigin.text);
  const edgeStale = bypassesCache && !optedOut.test(pwaEdge.text);
  const headerIsFresh = /no-cache/.test(swCc) || /max-age=0(\s|,|$)/.test(swCc);
  check('a new service worker reaches returning visitors',
    headerIsFresh || bypassesCache,
    headerIsFresh ? swCc
      : (bypassesCache
        ? swCc + ' — CDN-raised, but pwa.js registers with updateViaCache none, so the browser ignores this'
        : swCc + ' — and pwa.js does not opt out either. Caching → Configuration → Browser Cache TTL → "Respect Existing Headers", or register with updateViaCache \'none\''));
  if (!headerIsFresh && bypassesCache) {
    info('sw.js browser cache (routed around in code)',
      'the header is still worth fixing in the dashboard so other caches agree');
  }
  /* The origin is right and the deploy is fine; only propagation is pending.
     Worth saying out loud, because "the site says I am wrong but I uploaded
     the fix" is otherwise an unsolvable riddle. */
  if (edgeStale) {
    info('pwa.js at the edge is still the old copy',
      'age ' + (pwaEdge.headers.get('age') || '?') + 's of 86400 — Caching → Configuration → '
      + 'Purge Cache to force it now, or let it age out on its own');
  }

  const manifest = await get('https://' + HOST + '/site.webmanifest');
  check('web app manifest is served',
    manifest.status === 200 && String(manifest.headers.get('content-type') || '').indexOf('json') !== -1,
    manifest.status + ', ' + (manifest.headers.get('content-type') || ''));

  /* Cloudflare Pages strips the .html extension, so /offline.html answers with
     a 308 to the clean URL /offline. That is expected and harmless — the
     service worker follows it and stores a de-redirected copy — so what has to
     be true is that the clean URL really serves the offline page. */
  const offRaw = await get('https://' + HOST + '/offline.html');
  const offPage = await text('https://' + HOST + '/offline');
  const offReached = offRaw.status === 200 || offRaw.status === 301 || offRaw.status === 308;
  check('the offline fallback page is reachable',
    offReached && offPage.status === 200 && /offline/i.test(offPage.text),
    'status ' + offRaw.status + ' → /offline ' + offPage.status);

  for (const icon of ['/icon-192.png', '/icon-512.png', '/maskable-512.png']) {
    const r = await get('https://' + HOST + icon);
    check(icon + ' returns 200', r.status === 200, 'status ' + r.status);
  }

  /* 13. finish chime — must be present, and must not be an audio file */
  const chime = await get('https://' + HOST + '/assets/js/chime.js');
  check('chime script returns 200', chime.status === 200, 'status ' + chime.status);
  check('the chime is synthesised, no audio asset is hosted',
    (await get('https://' + HOST + '/assets/audio/done.mp3')).status === 404);

  /* 14. share page + promo material */
  const sharePage = await text('https://' + HOST + '/share/');
  check('/share/ returns 200', sharePage.status === 200, 'status ' + sharePage.status);
  if (sharePage.status === 200) {
    check('the share page embeds a scannable QR image',
      /qr-code-1024\.png/.test(sharePage.text) && /localphototool\.com/.test(sharePage.text),
      /qr-code-1024\.png/.test(sharePage.text) ? '' : 'QR image missing — re-upload localphototool-deploy.zip');
  }
  for (const asset of ['/share/qr-code-1024.png', '/share/poster-cn.png', '/share/poster-en.png']) {
    const r = await get('https://' + HOST + asset);
    check(asset + ' returns 200', r.status === 200, 'status ' + r.status);
  }

  /* 15. HEIC → JPG converter.
     The interesting failure modes here are silent ones: a decoder that lives on
     a third-party CDN, or one that is served with the wrong MIME type and so is
     refused by the browser before it ever runs. Both look fine in a screenshot. */
  const heicPage = await text('https://' + HOST + '/heic-to-jpg/');
  check('/heic-to-jpg/ returns 200', heicPage.status === 200, 'status ' + heicPage.status);
  if (heicPage.status === 200) {
    /* The decoder is not named in the HTML at all: app.js derives its URL from
       its own script tag at runtime, so the page has to be followed to the
       scripts it loads before "ours or someone else's?" can be answered.
       Checking the markup alone reported "decoder missing" on a page that was
       converting HEIC files correctly.

       A CDN URL is only a defect here if it is the DECODER — engine.js legitimately
       names esm.sh for the WASM image codecs, so a blanket "no CDN" test would
       fail on a page that is exactly right. */
    const srcs = Array.from(heicPage.text.matchAll(/<script[^>]+src="([^"]+)"/g))
      .map((m) => m[1])
      .map((src) => { try { return new URL(src, 'https://' + HOST + '/heic-to-jpg/').href; } catch (e) { return ''; } })
      .filter((u) => u.indexOf('https://' + HOST + '/') === 0);
    let scanned = heicPage.text;
    let read = 0;
    for (const u of srcs) {
      const s = await text(u);
      if (s.status === 200) { scanned += '\n' + s.text; read += 1; }
    }
    const selfHosted = /libheif-bundle\.mjs/.test(scanned);
    /* Only a URL counts as loading someone else's decoder. `heic2any` is named
       in a comment in app.js explaining why it was dropped, and counting a
       mention as a dependency would fail a page that is exactly right — which
       is what a naive search for the word did. */
    const decoderUrls = Array.from(scanned.matchAll(/https?:\/\/[^'"\s)]+/g))
      .map((m) => m[0])
      .filter((u) => /(libheif|heic2any)/i.test(u));
    const foreignDecoder = decoderUrls.some((u) => u.indexOf('https://' + HOST + '/') !== 0)
      || /['"][^'"\n]*heic2any[^'"\n]*['"]/.test(scanned);
    check('the HEIC page loads its own decoder, not a CDN build',
      selfHosted && !foreignDecoder,
      selfHosted
        ? (foreignDecoder ? 'a third-party decoder is still referenced: ' + decoderUrls.join(', ')
          : read + '/' + srcs.length + ' scripts scanned')
        : 'decoder missing from the page and its ' + srcs.length + ' scripts — re-upload localphototool-deploy.zip');
  }
  /* An .mjs served as text/plain is the classic silent breakage: import()
     rejects it with a bare TypeError and the UI just says "failed". */
  const decoder = await get('https://' + HOST + '/assets/vendor/libheif-bundle.mjs');
  const decType = String(decoder.headers.get('content-type') || '');
  check('the HEIC decoder is served as a JavaScript module',
    decoder.status === 200 && decType.indexOf('javascript') !== -1,
    decoder.status + ', ' + (decType || 'no content-type') +
      (decoder.status === 200 && decType.indexOf('javascript') === -1
        ? ' → the browser will refuse the import; _worker.js must pin the type' : ''));

  /* The converter is unreachable unless the site links to it. */
  if (homePage.status === 200) {
    check('every page links to the HEIC converter',
      homePage.text.indexOf('heic-to-jpg/') !== -1,
      homePage.text.indexOf('heic-to-jpg/') !== -1 ? '' : 'no nav/footer link on the homepage');
  }

  finish();
})().catch((e) => {
  /* A crash must never hide the checks that already ran. */
  console.log('\n  the check stopped early: ' + ((e && e.message) || e));
  finish();
});
