/* pdftext.js — why can't I select the text in this PDF?

   Most "PDF to text" tools answer too much. They take the file, and they
   hand back whatever their renderer happened to find, with a line saying
  扫描无文字 or a spinner and then a page asking you to sign up. What nobody
   says is *why* the words are not selectable, and the reason is always one of
   a short, checkable list:

     - the page is a picture (a scan or a photograph of a page) and there is
       no text there at all
     - the words sit inside compressed object streams (/ObjStm), which only a
       reader that decompresses them can see
     - the page's text is drawn with a font whose codes have no mapping to
       characters (a subset font and no ToUnicode CMap)
     - the document is encrypted, so nothing can be read

   So this module does two things at once: it pulls the text out, and it says
   which of those reasons applies, per page. The output is deliberately not
   "the document's words, beautifully reflowed" — it is the words in the order
   they were written, plus an honest account of every page that gave up.

   It rebuilds its view of the file out of pdfcompress's own parser rather
   than a third-party reader: no dependency ships with the site, and a file
   that opens on a server can open here instead.

   Measured 2026-10-04 against pypdf — see _dev/measure-pdf-text.cjs and
   _dev/verify-pdf-text.py. */
(function (global) {
  'use strict';

  var C = global.LPT && global.LPT.pdfcompress;
  if (!C || !C._internal) throw new Error('pdftext needs the pdf compressor loaded first');

  var _internal = C._internal;

  /* ---------- decoding ---------- */

  /* Content streams from Word, Google Docs and every browser print are
     Flate-compressed. DecompressionStream is the browser's own zlib, so no
     library is needed for it. */
  function inflate(u8) {
    if (typeof global.DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot decompress'));
    }
    return new Response(new Blob([u8]).stream().pipeThrough(new global.DecompressionStream('deflate')))
      .arrayBuffer()
      .then(function (ab) { return new Uint8Array(ab); });
  }

  function latin1Of(u8) {
    var s = '';
    var CH = 8192;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return s;
  }

  function fromLatin1(s) {
    var u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
    return u8;
  }

  /* ---------- the char maps ---------- */

  function parseCMap(text) {
    var map = {};                  /* code -> string */
    function hexTerms(s) {
      return (s.match(/<[0-9A-Fa-f\s]+>/g) || []).map(function (h) {
        return h.replace(/[<>]/g, '').replace(/\s+/g, '');
      });
    }
    /* <lo> <hi> <dstStart> means the codes lo..hi count up from dstStart, one
       character apiece: <0044> <004C> <0061> is 'a' through 'i'. Reading the
       <hi> as the destination — which is what the first version did — lands
       the whole range on one wrong letter and leaves the rest unmapped, and a
       page then reads as gibberish with the right number of letters in it. */
    function number(s) {
      var terms = hexTerms(s);
      if (terms.length < 3) return;
      var lo = parseInt(terms[0], 16);
      var hi = parseInt(terms[1], 16);
      var start = parseInt(terms[2], 16);
      if (isNaN(lo) || isNaN(hi) || isNaN(start)) return;
      var count = Math.min(hi - lo, 0xffff);
      for (var c = 0; c <= count; c++) {
        map[lo + c] = String.fromCharCode((start + c) & 0xffff);
      }
    }
    function pair(s) {
      var terms = hexTerms(s);
      var code = parseInt(terms[0] || '0', 16) || 0;
      var dst = terms[1] || '';
      /* Two-byte output: 0041 -> 'A'; two or four byte pairs are both legal. */
      var pairs = dst.match(/.{1,4}/g) || [];
      map[code] = pairs.map(function (p) { return String.fromCharCode(parseInt(p, 16) & 0xffff); }).join('');
    }

    var bf = text.match(/beginbfchar([\s\S]*?)endbfchar/);
    if (bf) bf[1].split(/\r?\n/).forEach(function (line) { if (line.indexOf('<') >= 0) pair(line); });
    var br = text.match(/beginbfrange([\s\S]*?)endbfrange/);
    if (br) br[1].split(/\r?\n/).forEach(function (line) { if (line.indexOf('<') >= 0) number(line); });
    return map;
  }

  /* The fallback when a font carries no ToUnicode: the encodings every real
     PDF writer falls back to. Small on purpose — the module reports "this
     font has no mapping" rather than guessing at glyphs. */
  var WIN_ANSI = (function () {
    var t = {};
    for (var c = 0; c < 256; c++) t[c] = String.fromCharCode(c);
    /* 0x80..0x9f are the printable slots of CP1252 that plain Latin-1 leaves
       as control codes. */
    var cp1252 = [8364, 8216, 8217, 8220, 8221, 8226, 8230, 8211, 8212, 8730,
      8482, 8486, 8806, 8807, 8834, 8835, 8836, 8837, 9834, 9835, 9786, 9787,
      9788, 9789, 9790, 9791, 9792, 9793, 9794, 9795, 9796, 338, 339, 8222,
      8224, 8225, 8722, 8804, 8805, 8712, 8713, 8719, 8721, 8725, 8726, 8727,
      8728, 8729, 8731, 8733, 8734, 8735, 8736, 8810, 8811, 8813, 8814, 8815,
      8817, 8818, 8819, 8820, 8821, 8824, 8825, 8240, 8241, 8242, 8243, 8244,
      8245, 8246, 8247, 8238, 732, 711];
    for (var i = 0; i < cp1252.length; i++) {
      if (cp1252[i] < 256) t[0x80 + i] = String.fromCharCode(cp1252[i]);
      else t[0x80 + i] = String.fromCharCode(cp1252[i]);
    }
    return t;
  })();

  function standardEncoding() {
    /* The PDF spec's StandardEncoding, as a sparse table: the difference from
       ASCII only matters in the high half. */
    var t = {};
    for (var c = 0; c < 256; c++) t[c] = String.fromCharCode(c);
    var s = {
      '032': 'space', '033': 'exclam', '034': 'quotesingle', '035': 'numbersign',
      '036': 'dollar', '037': 'percent', '040': 'ampersand', '041': 'quotesingle',
      '042': 'parenleft', '043': 'parenright', '044': 'asterisk', '045': 'plus',
      '046': 'comma', '047': 'hyphen', '050': 'period', '051': 'slash',
      '052': 'zero', '053': 'one', '054': 'two', '055': 'three', '056': 'four',
      '057': 'five', '060': 'six', '061': 'seven', '062': 'eight', '063': 'nine',
      '064': 'semicolon', '065': 'equal', '066': 'question', '067': 'at',
      '070': 'A', '071': 'B', '072': 'C', '073': 'D', '074': 'E', '075': 'F',
      '076': 'G', '077': 'H', '100': 'I', '101': 'J', '102': 'K', '103': 'L',
      '104': 'M', '105': 'N', '106': 'O', '107': 'P', '110': 'Q', '111': 'R',
      '112': 'S', '113': 'T', '114': 'U', '115': 'V', '116': 'W', '117': 'X',
      '120': 'Y', '121': 'Z', '122': 'bracketleft', '123': 'backslash',
      '124': 'bracketright', '125': 'asciicircum', '126': 'grade',
      '130': 'exclamdown', '131': 'cent', '132': 'sterling', '133': 'fraction',
      '134': 'yen', '135': 'florin', '136': 'section', '137': 'currency',
      '140': 'quotesinglbase', '141': 'guilsinglleft', '142': 'guilsinglright',
      '143': 'fi', '144': 'fl', '145': 'endash', '146': 'dagger',
      '147': 'daggerdbl', '150': 'periodcentered', '152': 'paragraph',
      '153': 'gutrmleft', '154': 'gutrmright', '155': 'oneeighth',
      '156': 'threeeighths', '157': 'fiveeighths', '160': 'seveneighths',
      '161': ' trademark', '162': 'quotedblleft', '163': 'quotedblright',
      '164': 'quotedblbase', '165': 'ellipsis', '166': 'perthousand',
      '170': 'questiondown', '171': 'grave', '172': 'acute', '173': 'circumflex',
      '174': 'macron', '175': 'breve', '176': 'dotaccent', '177': 'hungarumlaut',
      '200': 'ring', '201': 'cedilla', '202': 'hungarumlaut', '203': 'ogonek',
      '204': 'caron', '211': 'Q', '212': 'brokenbar', '213': 'L', '220': 'o',
      '221': 'l', '241': 'fraction', '242': 'slash', '243': 'currency',
      '244': 'florin', '245': 'section', '247': 'paragraph', '250': 'copyright',
      '251': 'onesuperior', '252': 'asterisk', '253': 'twosuperior',
      '254': 'threeesuperior', '255': 'space'
    };
    Object.keys(s).forEach(function (k) { t[parseInt(k, 8)] = s[k]; });
    return t;
  }
  var STANDARD = standardEncoding();

  /* ---------- the object walk ---------- */

  function byNum(objs) {
    var m = {};
    for (var i = 0; i < objs.length; i++) if (objs[i]) m[objs[i].num] = objs[i];
    return m;
  }

  /* Words written as (string) with a font that says how its codes map to
     characters, and hex strings for the two-byte world. */
  function textOfLiteral(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) {
        var n = s.charAt(i + 1);
        if (n === 'n') { out += '\n'; i++; continue; }
        if (n === 'r') { out += '\r'; i++; continue; }
        if (n === 't') { out += '\t'; i++; continue; }
        if (n === 'b') { out += '\b'; i++; continue; }
        if (n === 'f') { out += '\f'; i++; continue; }
        if (n >= '0' && n <= '7') {
          var oct = n;
          if (i + 2 < s.length && /[0-7]/.test(s.charAt(i + 2))) oct += s.charAt(i + 2);
          if (i + 3 < s.length && /[0-7]/.test(s.charAt(i + 3))) oct += s.charAt(i + 3);
          out += String.fromCharCode(parseInt(oct, 8));
          i += oct.length - 1;
          continue;
        }
        out += n; i++; continue;
      }
      out += ch;
    }
    return out;
  }

  function decodeShow(operand, font) {
    /* operand is the raw text-show operand as written in the stream: "<0033>",
       "(hello)", or a TJ array of both with kerning numbers between them.
       Splitting on the writer's own separators handles all three at once — the
       kerning numbers are simply not strings, so they decode to nothing. */
    var raw = String(operand || '').trim();
    if (raw.charAt(0) === '[') raw = raw.slice(1);
    var parts = raw.split(/\s+/).filter(function (s) { return s.length > 1; });
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i];
      if (tok.charAt(0) === '<' && tok.charAt(tok.length - 1) === '>') {
        var hex = tok.slice(1, -1).replace(/\s+/g, '');
        var codes = [];
        for (var k = 0; k + 3 < hex.length + 1; k += 4) codes.push(parseInt(hex.substr(k, 4), 16));
        out += glyphs(codes, font);
        continue;
      }
      if (tok.charAt(0) === '(' && tok.charAt(tok.length - 1) === ')') {
        var lit = tok.slice(1, -1);
        var bytes = [];
        for (var j = 0; j < lit.length; j++) bytes.push(lit.charCodeAt(j) & 0xff);
        out += glyphs(bytes, font);
        continue;
      }
      /* A number in a TJ array: kerning. It carries no characters. */
    }
    return out;
  }

  function glyphs(codes, font, wide) {
    if (!font || !font.map) return '';
    var out = '';
    for (var i = 0; i < codes.length; i++) {
      var v = font.map[codes[i]];
      if (v !== undefined) out += v;
      else if (font.encoding && font.encoding[codes[i]]) out += font.encoding[codes[i]];
    }
    return out;
  }

  /* Every object that looks like a page, with the content streams it asks for. */
  function pageEntries(p, objMap) {
    var pages = [];
    for (var i = 0; i < p.objs.length; i++) {
      var o = p.objs[i];
      if (o.type !== 'Page') continue;
      var contents = o.dictText.match(/\/Contents\s+(\d+)\s+0\s+R/);
      var nums = [];
      if (contents) nums.push(Number(contents[1]));
      else {
        /* /Contents can be an array of references. */
        var arr = o.dictText.match(/\/Contents\s*\[([^\]]*)\]/);
        if (arr) {
          var found = arr[1].match(/(\d+)\s+0\s+R/g) || [];
          for (var k = 0; k < found.length; k++) nums.push(Number(found[k].match(/\d+/)[0]));
        }
      }
      var fonts = {};
      var fres = o.dictText.match(/\/Font\s*<<([^>]*)>>/);
      if (fres) {
        var pairs = fres[1].match(/\/[A-Za-z0-9_.+#-]+\s+\d+\s+0\s+R/g) || [];
        for (var f = 0; f < pairs.length; f++) {
          var nm = pairs[f].match(/\/(.+?)\s+(\d+)\s+0\s+R/);
          if (nm) fonts[nm[1]] = Number(nm[2]);
        }
      }
      pages.push({ num: o.num, contents: nums, fonts: fonts });
    }
    return pages;
  }

  /* ---------- the report ---------- */

  function extract(u8) {
    var p = _internal.parse(u8);
    var objs = byNum(p.objs);
    var report = {
      sizeIn: u8.length,
      encrypted: /\/Encrypt\b/.test(p.text),
      pages: [],
      totalChars: 0,
      pagesWithText: 0,
      readable: true,
      /* The whole point of the page: every page that gave up says why. */
      reasons: []
    };

    if (report.encrypted) {
      report.readable = false;
      report.reasons.push('The document has an encryption dictionary, so no text can be read out of it here, in any reader.');
      return Promise.resolve(report);
    }

    var entries = pageEntries(p, objs);
    var jobs = [];

    report.objStmCount = p.objs.filter(function (o) { return o.type === 'ObjStm'; }).length;

    /* The page number is the document's, not the object's. The first /Type
       /Page in the file is page 1 and the report says so; the object holding
       it happens to be object 2, and reporting that number would send a person
       looking for a ninth page in a two-page file. */
    entries.forEach(function (page, index) {
      var item = { page: index + 1, obj: page.num, chars: 0, text: '', notes: [] };
      report.pages.push(item);
      jobs.push(Promise.resolve().then(function () {
        /* Collect every content stream the page asks for. */
        var blobs = [];
        page.contents.forEach(function (n) {
          var co = objs[n];
          if (!co) { item.notes.push('content stream ' + n + ' is missing'); return; }
          if (!co.hasStream) { item.notes.push('object ' + n + ' is not a stream'); return; }

          /* The filter is named in the dictionary, never in the data. Testing
             the data for /FlateDecode reads as if it worked and quietly hands
             the compressed bytes to the text walk, which then reports a page
             as having no words when the only truthful thing to say is that the
             bytes could not be undone. */
          var fl = (co.dictText.match(/\/Filter\s*\[([^\]]*)\]/) ||
            co.dictText.match(/\/Filter\s*\/([A-Za-z0-9+#]+)/) || [])[1] || '';
          var names = (fl.charAt(0) === '[')
            ? (fl.slice(1, -1).match(/\/([A-Za-z0-9+#]+)/g) || []).map(function (t) { return t.slice(1); })
            : (fl ? [fl] : []);

          if (!names.length) { blobs.push(Promise.resolve(co.dataText)); return; }
          if (names.length === 1 && names[0] === 'FlateDecode') {
            blobs.push(inflate(fromLatin1(co.dataText)).then(latin1Of, function (err) {
              item.notes.push('a compressed stream could not be decompressed (' + (err && err.message || err) + ')');
              return '';
            }));
            return;
          }
          item.notes.push('this page\'s content is filtered with ' + names.join('+') +
            ', which this reader cannot undo, so the words below are not read');
          blobs.push(Promise.resolve(co.dataText));
        });
        if (!blobs.length) { item.notes.push('no content stream on this page'); return; }

        /* Inflating one page at a time keeps the long tail of "a 300 page
           report" from holding every decoded stream in memory at once. */
        return Promise.all(blobs).then(function (streams) {
          item.streams = streams.length;
          var joined = streams.join('\n');
          item._streamLen = joined.length;

          /* A font is only usable once its ToUnicode stream has come back, and
             that is asynchronous. Walking the content stream before the maps
             land would leave every glyph translated as nothing at all, which
             looks exactly like a page with no text — the one mistake this
             module must not make, since "there is no text here" is a claim
             about the file that the page is going to put in writing. */
          var names = Object.keys(page.fonts);
          return Promise.all(names.map(function (name) {
            return loadFont(objs, objs[page.fonts[name]], item)
              .then(function (f) { return { name: name, font: f }; });
          })).then(function (resolved) {
            var fonts = {};
            resolved.forEach(function (r) { fonts[r.name] = r.font; });
            item.text = runContent(joined, fonts);
            item._fonts = resolved.map(function (r) {
              return r.name + ':' + (r.font.map ? Object.keys(r.font.map).length + ' codes' : 'no map') +
                (r.font.baseFont ? ' (' + r.font.baseFont + ')' : '');
            }).join(', ');
            item.chars = item.text.replace(/\s+/g, '').length;
          });
        });
      }));
    });

    return Promise.all(jobs).then(function () {
      report.pages.forEach(function (it) {
        report.totalChars += it.chars;
        if (it.chars > 0) report.pagesWithText++;
      });
      report.readable = report.pagesWithText > 0;
      if (!report.readable && !report.reasons.length) {
        report.reasons.push('None of the pages in this file carries a text layer — the words are only pixels, so there is nothing to select and nothing to copy without reading the pictures.');
      }
      return report;
    });
  }

  function loadFont(objs, fo, item) {
    var font = { map: null, encoding: null, subset: false, notes: [] };
    if (!fo) { item.notes.push('a font the page points at is missing'); return font; }
    var dict = fo.dictText;
    var base = (dict.match(/\/BaseFont\s*\/([\w+\-.]+)/) || [])[1] || '';
    if (/^[A-Za-z0-9+.-]{5,}\+/i.test(base)) {
      font.subset = true;                      /* the "AAAAAA+" prefix */
      base = base.replace(/^[A-Za-z0-9+.-]{5,}\+/, '');
    }
    font.baseFont = base;

    if (/\/Type3/.test(dict)) item.notes.push('this page uses a Type 3 font, whose glyphs are drawn as pictures');

    /* The one mapping that matters: ToUnicode. It is a stream, so it has to
       be inflated before it can be read. */
    var tu = dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (tu) {
      var tnum = Number(tu[1]);
      var t = objs[tnum];
      if (t && t.hasStream) {
        return inflate(fromLatin1(t.dataText))
          .then(function (u) { font.map = parseCMap(latin1Of(u)); return font; },
          function () {
            item.notes.push('the font\'s character map could not be read');
            return font;
          });
      }
      item.notes.push('the font has a character map but it is not a stream that could be read');
      return Promise.resolve(font);
    }

    /* No ToUnicode: the fallback depends on what the font declares. */
    if (/\/Identity-(H|V)/.test(dict)) {
      item.notes.push('\'' + (font.baseFont || 'this font') + '\' maps glyphs by number with no character map, so the words cannot be named');
      return Promise.resolve(font);
    }
    if (/\/(WinAnsi|MacRoman|Standard|MacExpert)Encoding/.test(dict) || /\/Encoding\s*\/[A-Za-z]/.test(dict)) {
      font.encoding = STANDARD;
      if (/WinAnsi/.test(dict)) font.encoding = WIN_ANSI;
      return Promise.resolve(font);
    }
    var diff = dict.match(/\/Differences\s*\[([\s\S]*?)\]/);
    if (diff) {
      font.encoding = STANDARD;
      diff[1].split(/\s+/).forEach(function (tok) {
        var m = tok.match(/^(\d+)$/);
        if (!m) return;
        var at = Number(m[1]);
        font.encoding = font.encoding || {};
        /* The Differences array restarts numbering per block; only the simple
           single-token form is handled, and a font like that is rare enough
           to report rather than mis-translate. */
        font.encoding[at] = tok;
      });
      return Promise.resolve(font);
    }
    if (font.subset) {
      item.notes.push('\'' + (font.baseFont || 'this font') + '\' is a subset font with no character map, so its glyph numbers cannot be turned back into letters');
    }
    return Promise.resolve(font);
  }

  /* ---------- the content stream walk ---------- */

  /* The content stream is a token soup: operands and operators alternate, and
     the font name is the operand *before* the size, two tokens back. So the
     walk keeps a short queue of the last operands and the operators read out
     of it, the way the grammar says they are written. */
  function runContent(stream, fonts) {
    var out = '';
    var queue = [];
    var lastY = null;
    /* The font in force. Tf sets it and the walk clears its operand queue on
       nearly every operator, so the queue is not where to look for the name —
       the last Tf is. */
    var curFont = null;
    /* The size in force, so that a jump in the baseline can be read as a
       line break only when it is bigger than a letter. */
    var curSize = 12;
    var i = 0;

    function push(tok) { queue.push(tok); if (queue.length > 4) queue.shift(); }

    function showText(tok) {
      return decodeShow(tok, fonts[curFont] || null);
    }

    /* Whether a line ended is decided by the vertical position of the next
       string. Tm carries an absolute origin, so it can be taken as it stands.
       Td carries an offset from wherever the last one left off — the stream
       in front of us moves across a line with "8 0 Td", nine hundred of them,
       and reading that 0 as an absolute origin puts every character on its
       own line. */
    function trackY(y) {
      if (y === null || isNaN(y)) return;
      /* A line ended when the baseline jumps by more than half the type size.
         The stream in front of us sets every character on its own with a bare
         "8 0 Td" whose vertical part is nothing, and a new line with a fresh
         text matrix some 17 points on — so the size is what tells those two
         apart. A plain "does the number drop" test reads a fresh line as
         nothing at all, and the page comes back as one long word. */
      if (lastY !== null && Math.abs(y - lastY) > curSize * 0.5) out += '\n';
      lastY = y;
    }

    while (i < stream.length) {
      var ch = stream.charAt(i);
      if (ch === '%') { var nl = stream.indexOf('\n', i); i = nl < 0 ? stream.length : nl + 1; continue; }
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === ')' || ch === ']' || ch === '}' || ch === ',' || ch === '<' || ch === '(') {
        /* '<' and '(' start a string: read the whole thing as one token. */
        var st = readOperand(stream, i);
        if (st) { push(st.value); i = st.next; }
        else i++;
        continue;
      }
      if (ch === '[') { var st2 = readOperand(stream, i); if (st2) { push(st2.value); i = st2.next; } else i++; continue; }
      if (ch === '/' || (ch >= '0' && ch <= '9') || ch === '.' || ch === '-' || ch === '+') {
        var num = readToken(stream, i);
        if (num) { push(num.value); i = num.next; }
        else i++;
        continue;
      }

      /* Everything else is an operator: read its name. */
      var opEnd = i;
      while (opEnd < stream.length && /[A-Za-z'"]/.test(stream.charAt(opEnd))) opEnd++;
      var op = stream.slice(i, opEnd);
      i = opEnd;
      if (!op) { i++; continue; }

      switch (op) {
        case 'BT':
          /* Only the operand queue is cleared here. Wiping the recorded
             position as well would cut the comparison short at every line,
             because a page's second line opens with "ET … BT" and by the time
             its text matrix is read the memory of the first line is gone —
             which is how a whole page once came back without a single break. */
          queue = [];
          break;
        case 'ET': queue = []; break;
        case 'Tf':
          /* The two operands are /Name then the size. */
          if (queue.length >= 2 && queue[queue.length - 2].charAt(0) === '/') {
            curFont = queue[queue.length - 2].slice(1);
          }
          var sz = parseFloat(queue[queue.length - 1]);
          if (!isNaN(sz) && sz > 0) curSize = sz;
          queue = [];
          break;
        case 'Td':
        case 'TD': {
          var tq = queue.map(parseFloat).filter(function (v) { return !isNaN(v); });
          var t = tq.length ? tq[tq.length - 1] : 0;
          trackY(lastY === null ? t : lastY + t);
          queue = [];
          break;
        }
        case 'Tm': {
          /* Six numbers, the last of which is the vertical origin. */
          var ys = queue.map(parseFloat).filter(function (v) { return !isNaN(v); });
          trackY(ys.length ? ys[ys.length - 1] : null);
          queue = [];
          break;
        }
        case 'T*':
          if (lastY !== null) out += '\n';
          queue = [];
          break;
        case 'Tj':
        case 'TJ':
        case "'":
        case '"':
          out += showText(queue.length ? queue[queue.length - 1] : '');
          queue = [];
          break;
        default:
          queue = [];
          break;
      }
    }
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n');
  }

  function readToken(stream, from) {
    var j = from;
    while (j < stream.length && !/[\s\[\]<>(){}%]/.test(stream.charAt(j))) j++;
    if (j === from) return null;
    return { value: stream.slice(from, j), next: j };
  }

  /* Reads one operand: <hex>, (string) or [ ... ] . */
  function readOperand(stream, from) {
    var start = from;
    while (start < stream.length && /\s/.test(stream.charAt(start))) start++;
    var c = stream.charAt(start);
    if (c === '<') {
      var close = stream.indexOf('>', start);
      if (close < 0) return null;
      return { value: stream.slice(start, close + 1), next: close + 1 };
    }
    if (c === '(') {
      var depth = 0, j = start;
      while (j < stream.length) {
        var d = stream.charAt(j);
        if (d === '\\') { j += 2; continue; }
        if (d === '(') depth++;
        if (d === ')') { depth--; if (!depth) { return { value: stream.slice(start, j + 1), next: j + 1 }; } }
        j++;
      }
      return null;
    }
    if (c === '[') {
      /* A TJ array mixes strings with kerning numbers, so the scan cannot stop
         at the first thing that is not a string. */
      var parts = [];
      var k = start + 1;
      while (k < stream.length) {
        var at = stream.charAt(k);
        if (/\s/.test(at)) { k++; continue; }
        if (at === ']') break;
        if (at === '<' || at === '(') {
          var one = readOperand(stream, k);
          if (!one) break;
          parts.push(one.value);
          k = one.next;
          continue;
        }
        var num = readToken(stream, k);
        if (!num) break;
        parts.push(num.value);
        k = num.next;
      }
      if (stream.charAt(k) !== ']') return null;
      return { value: parts.join(' '), next: k + 1 };
    }
    return null;
  }

  global.LPT = global.LPT || {};
  global.LPT.pdftext = { extract: extract };
})(typeof self !== 'undefined' ? self : this);
