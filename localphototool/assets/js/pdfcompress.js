/* pdfcompress.js — shrink a PDF by re-encoding the images inside it.
   v80 added /compress-pdf/.

   Why it only touches images: a PDF from Word, Google Docs, Keynote, a scanner
   or a browser print already compressed its text once; the bytes that come back
   are almost always the pictures (measured: 99.3% of a four-photo PDF). Text,
   fonts, outlines and the page tree are copied through byte for byte, so the
   output keeps selectable text and stays readable in every conforming viewer.

   How it works, in the order it runs:
     1. walk `N 0 obj … endobj` and read each object's dictionary;
     2. pick the image XObjects that are plain JPEGs with no alpha channel
        (`/Filter /DCTDecode`, no /SMask, no /ImageMask);
     3. decode each with createImageBitmap, re-encode through LPT.engine,
        and swap the stream back in — the dictionary is copied with /Length
        rewritten and the cross-reference table rebuilt from the offsets that
        were actually written, because replacing a stream moves every object
        that follows it.

   Nothing is uploaded, nothing is written to any server. If the file is
   encrypted, or its images live inside compressed object streams that pack many
   objects into one stream, the script says so and hands the file back untouched
   rather than guessing. */
(function (global) {
  'use strict';

  /* ---------- latin1 view of the bytes: lossless both ways ---------- */

  function toLatin1(u8) {
    var s = '';
    var CH = 8192;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return s;
  }

  function fromLatin1(s) {
    var u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
    return u8;
  }

  function padLength(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /* ---------- 1. parse ---------- */

  function parse(u8) {
    var s = toLatin1(u8);
    var objs = [];
    var re = /(\d+)\s+0\s+obj/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var start = m.index;                        // offset of the "N 0 obj" header
      var bodyStart = m.index + m[0].length;
      var endObj = s.indexOf('endobj', bodyStart);
      if (endObj === -1) continue;
      var body = s.slice(bodyStart, endObj);

      var o = {
        num: Number(m[1]),
        header: s.slice(start, bodyStart),
        type: '',
        subtype: '',
        filter: '',
        filters: [],
        indirectLength: false,
        lengthValue: null,
        lengthWidth: 0
      };

      var tm = body.match(/\/Type\s*\/(\w+)/);
      if (tm) o.type = tm[1];
      var sm2 = body.match(/\/Subtype\s*\/(\w+)/);
      if (sm2) o.subtype = sm2[1];

      /* /Filter may be a bare name or a one-element array; both mean "this
         stream is a JPEG", and an array also shows up in the wild. */
      var fm = body.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9+#]+)/);
      if (fm) {
        if (fm[1].charAt(0) === '[') {
          var names = fm[1].slice(1, -1).match(/\/[A-Za-z0-9+#]+/g) || [];
          o.filters = names.map(function (t) { return t.slice(1); });
          o.filter = (o.filters.length === 1 && o.filters[0] === 'DCTDecode') ? 'DCTDecode' : o.filters.join('+');
        } else {
          o.filters = [fm[1].slice(1)];
          o.filter = fm[1].slice(1);
        }
      }

      var lm = body.match(/\/Length\s+(\d+)/);
      if (lm) { o.lengthValue = Number(lm[1]); o.lengthWidth = lm[1].length; }
      else if (/\/Length\s+\d+\s+0\s+R/.test(body)) o.indirectLength = true;

      var sm = body.indexOf('stream');
      if (sm !== -1 && o.lengthValue !== null) {
        var ctor = sm + 6;                        // skip the word "stream"
        if (body[ctor] === '\r') ctor += 1;
        if (body[ctor] === '\n') ctor += 1;
        o.hasStream = true;
        o.dictText = body.slice(0, sm);           // the dictionary alone
        o.eol = body.slice(sm, ctor);             // "stream\r\n" or "stream\n"
        o.dataStart = bodyStart + ctor;           // absolute offset of the data
        o.dataEnd = o.dataStart + o.lengthValue;
        o.dataText = s.slice(o.dataStart, o.dataEnd);

        /* Trust /Length, but never let a stray "endstream" earlier than the
           declared end leave the object truncated. */
        var de = s.indexOf('endstream', o.dataStart);
        if (de !== -1 && de < o.dataEnd) {
          o.dataEnd = de;
          o.dataText = s.slice(o.dataStart, de);
        }
        o.lengthValue = o.dataEnd - o.dataStart;
      } else {
        o.hasStream = false;
        o.dictText = body;
      }
      o.start = start;
      objs.push(o);
    }

    /* Everything before the first `N 0 obj` — usually `%PDF-1.7` plus the
       binary comment — has to be carried over, because every xref offset is a
       distance from the start of the file. */
    return {
      text: s,
      objs: objs,
      preamble: objs.length ? s.slice(0, objs[0].start) : s.slice(0, 1024)
    };
  }

  /* ---------- 2. inspect ---------- */

  function inspect(u8) {
    var p = parse(u8);
    var images = [];
    var imageBytes = 0;
    var metadataBytes = 0;
    var metadataObjects = 0;
    for (var i = 0; i < p.objs.length; i++) {
      var o = p.objs[i];
      if (o.subtype === 'Image') {
        var bytes = o.hasStream ? (o.dataEnd - o.dataStart) : 0;
        imageBytes += bytes;
        images.push({
          num: o.num,
          filter: o.filter,
          bytes: bytes,
          masked: /\/SMask/.test(o.dictText) || /\/ImageMask\s+true/.test(o.dictText),
          imageMask: /\/ImageMask\s+true/.test(o.dictText),
          encodable: o.filter === 'DCTDecode' &&
            !/\/SMask/.test(o.dictText) &&
            !/\/ImageMask\s+true/.test(o.dictText) &&
            !o.indirectLength
        });
      }
      if (o.type === 'Metadata') {
        metadataBytes += o.hasStream ? (o.dataEnd - o.dataStart) : 0;
        metadataObjects++;
      }
    }
    var encodable = images.filter(function (im) { return im.encodable; }).length;
    return {
      size: u8.length,
      objects: p.objs.length,
      pages: p.objs.filter(function (o) { return o.type === 'Page'; }).length,
      images: images,
      imageBytes: imageBytes,
      imageShare: u8.length ? imageBytes / u8.length : 0,
      metadataBytes: metadataBytes,
      metadataObjects: metadataObjects,
      metadataShare: u8.length ? metadataBytes / u8.length : 0,
      objStmCount: p.objs.filter(function (o) { return o.type === 'ObjStm'; }).length,
      encodableImages: encodable,
      skippableImages: images.length - encodable
    };
  }

  /* ---------- 3. rebuild ----------

     Every part is either a latin1 string (length === byte length) or a
     Uint8Array of re-encoded image data, so one accounting pass covers both.
     The xref is built last, which means the offsets read from the pass are
     exactly the offsets the finished file contains. */

  function rebuild(p, edits, dropMetadata) {
    var parts = [];
    var placed = {};                  // num -> byte offset, or -1 when dropped
    var bodyBytes = 0;

    function put(part) {
      parts.push(part);
      bodyBytes += part.length;
    }

    var i, o;
    put(p.preamble);          // "%PDF-1.7" and the binary comment; offsets count from byte 0
    for (i = 0; i < p.objs.length; i++) {
      o = p.objs[i];
      if (dropMetadata && o.type === 'Metadata') { placed[o.num] = -1; continue; }
      placed[o.num] = bodyBytes;
      put(o.header);
      put('\n');
      if (o.hasStream) {
        var edit = edits[o.num];
        var data = edit ? edit.bytes : fromLatin1(o.dataText);
        var dict = o.dictText;
        if (o.lengthWidth) {
          dict = dict.replace(/\/Length\s+\d+/, '/Length ' + padLength(data.length, o.lengthWidth));
        } else if (/\/Length\s+(\d+)\s+0\s+R/.test(dict)) {
          dict = dict.replace(/\/Length\s+\d+\s+0\s+R/, '/Length ' + data.length);
        }
        put(dict);
        put(o.eol);
        put(data);
        put('endstream');
      } else {
        /* The metadata object is gone, so the catalog must not still point at
           it — this is the one cross-reference worth cutting. */
        put(o.dictText.replace(/\/Metadata\s+\d+\s+0\s+R\s*/g, ''));
      }
      put('\nendobj\n');
    }

    var maxNum = 0;
    for (i = 0; i < p.objs.length; i++) maxNum = Math.max(maxNum, p.objs[i].num);
    var rootRef = (p.text.match(/\/Root\s+(\d+)\s+0\s+R/) || [])[1] || '1';

    /* Entry 0 is the free head, so the loop starts at 1 — writing both the
       free line and an entry for object 0 would put one entry too many in
       the table, and the extra line shifts nothing but still lies about the
       count. */
    var xref = 'xref\n0 ' + (maxNum + 1) + '\n0000000000 65535 f \n';
    for (i = 1; i <= maxNum; i++) {
      var off = placed[i];
      xref += (typeof off === 'number' && off >= 0)
        ? ('0000000000' + off).slice(-10) + ' 00000 n \n'
        : '0000000000 65535 f \n';
    }
    /* The value has to be taken before the table is pushed: put() moves
       bodyBytes on, and reading it afterwards points startxref at the trailer
       instead of the xref keyword. */
    var xrefOffset = bodyBytes;
    put(xref);
    put('trailer\n<< /Size ' + (maxNum + 1) + ' /Root ' + rootRef + ' 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    /* Every part goes through put(), xref and trailer included — pushing
       them straight onto the array would leave them out of the length
       accounting, and the copy below would then write past the end and
       silently truncate the file right before the table it was meant to
       finish. bodyBytes is the offset of the xref keyword, so startxref
       is simply that number. */
    var total = 0;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (i = 0; i < parts.length; i++) {
      var pt = parts[i];
      if (typeof pt === 'string') {
        for (var j = 0; j < pt.length; j++) out[at + j] = pt.charCodeAt(j) & 0xff;
        at += pt.length;
      } else {
        out.set(pt, at);
        at += pt.length;
      }
    }
    return out;
  }

  /* ---------- 4. compress ---------- */

  function compress(u8, opts) {
    opts = opts || {};
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.6;
    var maxDim = opts.maxDim || 0;
    var dropMetadata = opts.dropMetadata !== false;
    var p = parse(u8);
    var report = {
      sizeIn: u8.length,
      quality: quality,
      maxDim: maxDim,
      dropMetadata: dropMetadata,
      images: [],
      imagesReplaced: 0,
      imagesSkipped: 0,
      bytesIn: u8.length,
      bytesOut: u8.length,
      encoder: 'native',
      encrypted: false,
      kept: false
    };

    /* encrypted: refuse rather than corrupt */
    if (/\/Encrypt\b/.test(p.text)) {
      report.encrypted = true;
      return Promise.resolve(report);
    }

    var E = global.LPT && global.LPT.engine;
    var edits = {};

    var jobs = [];
    for (var i = 0; i < p.objs.length; i++) {
      var o = p.objs[i];
      if (o.subtype !== 'Image') continue;
      if (o.filter !== 'DCTDecode' || o.indirectLength ||
          /\/SMask/.test(o.dictText) || /\/ImageMask\s+true/.test(o.dictText)) {
        report.imagesSkipped++;
        report.images.push({ num: o.num, filter: o.filter, skipped: true });
        continue;
      }
      jobs.push(o);
    }

    return Promise.all(jobs.map(function (o) {
      var before = o.dataEnd - o.dataStart;
      var raw = fromLatin1(o.dataText);
      return (global.createImageBitmap ?
        global.createImageBitmap(new Blob([raw], { type: 'image/jpeg' })) :
        Promise.reject(new Error('no decoder')))
        .then(function (bmp) {
          var w = bmp.width, h = bmp.height;
          if (maxDim && Math.max(w, h) > maxDim) {
            var k = maxDim / Math.max(w, h);
            w = Math.max(1, Math.round(w * k));
            h = Math.max(1, Math.round(h * k));
          }
          /* drawResized takes all six arguments; with sw/sh/dw/dh undefined it
             draws nothing at all and the re-encode lands on an empty canvas. */
          var canvas = E.createCanvas(w, h);
          if (w === bmp.width && h === bmp.height) {
            canvas.getContext('2d').drawImage(bmp, 0, 0);
          } else {
            E.drawResized(canvas, bmp, bmp.width, bmp.height, w, h);
          }
          return E.encodeCanvas(canvas, 'jpeg', quality, {}).then(function (enc) {
            return await_blob(enc.blob).then(function (u8) {
              edits[o.num] = { bytes: u8, lengthWidth: o.lengthWidth };
              report.images.push({
                num: o.num, before: before, after: u8.length,
                w: bmp.width, h: bmp.height, encoder: enc.encoder || 'native'
              });
              report.imagesReplaced++;
              if (enc.encoder) report.encoder = enc.encoder;
              bmp.close && bmp.close();
            });
          });
        })
        .catch(function (err) {
          report.imagesSkipped++;
          report.images.push({ num: o.num, before: before, skipped: true, reason: String(err && err.message || err) });
        });
    })).then(function () {
      /* Nothing to re-encode: rewriting the xref would only add bytes, so the
         original file goes back exactly as it came in. */
      if (report.imagesReplaced === 0) {
        report.kept = true;
        report.bytesOut = u8.length;
        report.blob = new Blob([u8], { type: 'application/pdf' });
        return report;
      }
      var out = rebuild(p, edits, dropMetadata);
      report.bytesOut = out.length;
      report.blob = new Blob([out], { type: 'application/pdf' });
      if (report.imagesReplaced === 0) report.kept = true;
      return report;
    });
  }

  /* Blob -> Uint8Array without a CDP detour (the devtools protocol drops big
     bodies, which has produced false "nothing was uploaded" readings before). */
  function await_blob(blob) {
    return blob.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  global.LPT = global.LPT || {};
  global.LPT.pdfcompress = {
    inspect: inspect,
    compress: compress,
    _internal: { parse: parse, rebuild: rebuild }
  };
})(typeof self !== 'undefined' ? self : this);
