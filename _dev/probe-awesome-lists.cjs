/* Work out, before any token exists, exactly where a listing would go in each
   awesome list and what the local line format is.

   These files are public, so this needs no credentials. Doing it now means that
   the moment a valid token turns up, opening the PR is mechanical instead of a
   research project — and it also lets us find out that a repo is a bad fit
   before spending anyone's time on it.

   Usage:  node _dev/probe-awesome-lists.cjs
*/

const REPOS = [
  ['free-for-dev', 'ripienaar/free-for-dev', 'README.md'],
  ['awesome-privacy', 'pluja/awesome-privacy', 'README.md'],
  ['awesome-selfhosted', 'awesome-selfhosted/awesome-selfhosted', 'README.md'],
];

const KEYWORDS = [
  'image compression',
  'image compressor',
  'image optimi',
  'compress image',
  'image process',
  'tinypng',
  'squoosh',
  'image edit',
  'photo',
];

(async () => {
  for (const [name, repo, file] of REPOS) {
    console.log('\n================ ' + name + '  (' + repo + ')');
    for (const branch of ['master', 'main']) {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
      let text;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'localphototool-probe' } });
        if (!r.ok) continue;
        text = await r.text();
      } catch {
        continue;
      }
      console.log(`  fetched ${branch}/${file}: ${text.length} chars, ${text.split('\n').length} lines`);

      const lines = text.split('\n');
      // Section headings, so we can name the category a listing belongs under.
      let current = '(top)';
      const hits = [];
      lines.forEach((ln, i) => {
        const h = /^#{2,3}\s+(.*)/.exec(ln);
        if (h) current = h[1].trim();
        const low = ln.toLowerCase();
        for (const kw of KEYWORDS) {
          if (low.includes(kw)) {
            hits.push({ i, section: current, ln: ln.trim().slice(0, 150) });
            break;
          }
        }
      });

      if (!hits.length) {
        console.log('  no keyword hit — this list may not have a matching category');
      } else {
        console.log(`  ${hits.length} matching lines:`);
        for (const h of hits.slice(0, 12)) {
          console.log(`    L${h.i}  [${h.section}]`);
          console.log(`        ${h.ln}`);
        }
      }

      // Contribution rules decide whether a hand-written line would even be accepted.
      for (const cf of ['CONTRIBUTING.md', '.github/CONTRIBUTING.md']) {
        const r = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${cf}`, {
          headers: { 'User-Agent': 'localphototool-probe' },
        });
        if (r.ok) {
          const c = await r.text();
          console.log(`  ${cf}: present, ${c.length} chars`);
          const ruleHits = c
            .split('\n')
            .filter((l) => /alphabet|order|format|one line|description|pull request|link/i.test(l))
            .slice(0, 6);
          for (const l of ruleHits) console.log(`      ${l.trim().slice(0, 130)}`);
          break;
        }
      }
      break;
    }
  }
})();
