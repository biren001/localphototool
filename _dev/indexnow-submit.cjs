/* Push every URL in sitemap.xml to IndexNow.

   Why this exists: Google's sitemap *ping* endpoint was retired in June 2023 and
   now 404s, so the only way to hand Google a sitemap is Search Console — which
   needs an account and, from mainland China, a VPN. IndexNow is the same idea
   done right: one unauthenticated POST, no account, and it reaches Bing, Yandex,
   Seznam and Naver at once. Bing's index is what feeds Copilot, ChatGPT search
   and Yahoo, so it is the reachable half of the discovery problem.

   Usage:
     node _dev/indexnow-submit.cjs            submit
     node _dev/indexnow-submit.cjs --dry      print the payload, send nothing

   Requires the key file to already be LIVE on the site (it is how the engines
   verify you own the host). The script refuses to submit otherwise: a
   submission whose key cannot be fetched is a failed verification, and
   repeating those is the quickest way to get a host ignored by the engines. */
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'localphototool');
const HOST = 'localphototool.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const UA = 'Mozilla/5.0 (compatible; LocalPhotoTool-IndexNow/1.0; +https://' + HOST + '/)';

/* The key lives in the site root as <key>.txt and nowhere else, so it is read
   from disk rather than copied into this file: one source of truth, and
   re-running the generator cannot silently invalidate a deployed key. */
function findKey() {
  const files = fs.readdirSync(SITE).filter(function (f) {
    return /\.txt$/.test(f) && /^[0-9a-f]{32}$/.test(f.replace(/\.txt$/, ''));
  });
  if (files.length === 0) throw new Error('no <32-hex>.txt key file in ' + SITE);
  if (files.length > 1) throw new Error('more than one key file: ' + files.join(', ')
    + ' — the engines accept either, but pick one so keyLocation is unambiguous');
  const file = files[0];
  return { key: file.replace(/\.txt$/, ''), file: file };
}

/* URLs come from the sitemap, never from a hand-kept list: a URL that is live
   but missing here is a page the engines never hear about, and a typed list is
   how that happens without anyone noticing. */
function sitemapUrls() {
  const xml = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(function (m) { return m[1]; });
  if (urls.length === 0) throw new Error('sitemap.xml has no <loc> entries — is it packaged?');
  return urls;
}

async function fetchWithRetry(url, opts, tries) {
  tries = tries || 3;
  let last = null;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fetch(url, Object.assign({ redirect: 'follow' }, opts));
    } catch (e) {
      last = e;
      if (i < tries) await new Promise((r) => setTimeout(r, 700 * i));
    }
  }
  throw last || new Error('fetch failed');
}

async function main() {
  const { key, file } = findKey();
  const keyLocation = 'https://' + HOST + '/' + file;
  const urlList = sitemapUrls();
  const payload = { host: HOST, key: key, keyLocation: keyLocation, urlList: urlList };

  console.log('key file      ' + file);
  console.log('keyLocation   ' + keyLocation);
  console.log('urls          ' + urlList.length + ' (derived from sitemap.xml)');
  urlList.forEach(function (u) { console.log('                ' + u); });

  if (process.argv.indexOf('--dry') !== -1) {
    console.log('\n--dry: payload not sent.\n' + JSON.stringify(payload, null, 2));
    return 0;
  }

  /* The gate. Without this the first run against an undeployed key produces a
     403 that looks like a bug in the script, and the temptation is to retry. */
  console.log('\nverifying the key file is live before submitting...');
  let live;
  try {
    live = await fetchWithRetry(keyLocation + '?cb=' + Date.now(), {
      headers: { 'user-agent': UA, 'cache-control': 'no-cache' }
    });
  } catch (e) {
    console.log('  CANNOT REACH ' + keyLocation + ' — ' + e.message);
    console.log('  Most likely the site is not up from here, or the key file has not');
    console.log('  been deployed yet. Nothing was submitted.');
    return 2;
  }
  const liveBody = (await live.text()).trim();
  if (live.status !== 200) {
    console.log('  key file is NOT live: HTTP ' + live.status + ' for ' + keyLocation);
    console.log('  Upload localphototool-deploy.zip first — the key file ships inside it.');
    console.log('  Nothing was submitted.');
    return 2;
  }
  if (liveBody.indexOf(key) === -1) {
    console.log('  the live file does not contain the key.');
    console.log('    expected: ' + key);
    console.log('    got     : ' + liveBody.slice(0, 120));
    console.log('  Nothing was submitted.');
    return 2;
  }
  console.log('  ok — ' + keyLocation + ' serves the key.');

  const res = await fetchWithRetry(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': UA },
    body: JSON.stringify(payload)
  });
  const text = (await res.text()).slice(0, 300);

  /* The endpoint explains failures in the status code alone, and 200 vs 202 is
     the difference between "key already known" and "key queued for
     verification" — worth spelling out, because a bare number invites a retry
     that fixes nothing. */
  const meaning = {
    200: 'accepted — the key was already verified',
    202: 'accepted — the key is queued for verification',
    400: 'bad request — the payload shape is wrong',
    403: 'forbidden — the key file was not found at keyLocation',
    422: 'the URLs do not belong to host, or the key does not match the one in the file',
    429: 'rate limited — too many submissions; wait before retrying'
  };
  console.log('\nPOST ' + ENDPOINT);
  console.log('  HTTP ' + res.status + ' — ' + (meaning[res.status] || 'unexpected status'));
  if (text) console.log('  body: ' + text);

  if (res.status === 200 || res.status === 202) {
    console.log('\n' + urlList.length + ' URLs submitted to Bing, Yandex, Seznam and Naver.');
    console.log('Bing indexes on its own schedule after this; expect days, not minutes.');
    return 0;
  }
  return 1;
}

main().then(function (code) { process.exit(code); }).catch(function (e) {
  console.log('failed: ' + ((e && e.message) || e));
  process.exit(1);
});
