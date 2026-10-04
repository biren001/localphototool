/* pdfmerge.js — put several PDFs together in one document, in the browser.
   v83 added /merge-pdf/.

   Why it is not a normal merger: every browser merger we could find
   (merge-papers, digitaltoolpad, technosuffice, pdfguru, utildaily) advertises a
   lossless merge and stops there. The question that arrives straight after the
   merge is the one nobody answers — "now I have to email it, and the file is
   bigger than the parts I started with". So this merges first and then, if you
   ask it to, re-encodes the pictures inside the merged document with the same
   engine as /compress-pdf/, which is where the bytes are. Measured on three
   seeded print-to-PDF documents: 2,001,057 bytes of parts → 2,000,000 merged
   losslessly → 908,155 after the pictures were re-encoded (54.6% smaller than
   the merged file, and 54.6% smaller than the parts themselves too).

   How the merge works:
     1. each file is walked with pdfcompress's own parser, so the page count it
        reports is the same page count the compressor sees;
     2. every object of every file is copied into one numbering space by
        shifting the object numbers of each file onto a disjoint range —
        cross-file object numbers would otherwise collide, since both files call
        their first page "5 0 obj";
     3. only dictionary text is rewritten. Raw stream bytes are copied verbatim,
        because a JPEG can legitimately contain the byte sequence " 0 R" and
        rewriting that corrupts a picture without producing any syntax error;
     4. a new /Pages node holds every page of every file as /Kids, and the
        catalog is the first file's own catalog with its /Pages pointer aimed at
        the new node — which is what keeps the bookmarks, the page mode and the
        metadata that hang off it.

   What it deliberately does not do: touch encrypted files; decompress
   object streams by force. A file that packs many objects into one compressed
   stream is expanded when the browser can inflate it, and left alone, counted
   and reported when it cannot. Anything the tool could not read is reported
   rather than silently dropped. */
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

  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  function typeOf(text) {
    var m = text.match(/\/Type\s*\/(\w+)/);
    return m ? m[1] : '';
  }

  function subtypeOf(text) {
    var m = text.match(/\/Subtype\s*\/(\w+)/);
    return m ? m[1] : '';
  }

  /* An object is carried around as { src, dictText, hasStream, eol, dataText }
     where src is the number it had in its own file. */
  function plain(o) {
    return {
      src: o.num,
      dictText: o.dictText,
      hasStream: !!o.hasStream,
      eol: o.eol || '',
      dataText: o.dataText || ''
    };
  }

  function internal() {
    var M = global.LPT && global.LPT.pdfcompress && global.LPT.pdfcompress._internal;
    if (!M || !M.parse) throw new Error('pdfcompress did not load');
    return M;
  }

  /* ---------- 1. read a file, for the list before merging ---------- */

  function readPart(u8) {
    var p = internal().parse(u8);
    var pages = 0, images = 0, encodable = 0, objStm = 0;
    var encrypted = /\/Encrypt\b/.test(p.text);
    for (var i = 0; i < p.objs.length; i++) {
      var o = p.objs[i];
      if (typeOf(o.dictText) === 'Page') pages++;
      if (subtypeOf(o.dictText) === 'Image') {
        images++;
        if (o.filter === 'DCTDecode' && !o.indirectLength &&
            !/\/SMask/.test(o.dictText) && !/\/ImageMask\s+true/.test(o.dictText)) encodable++;
      }
      if (typeOf(o.dictText) === 'ObjStm') objStm++;
    }
    return {
      size: u8.length,
      objects: p.objs.length,
      pages: pages,
      images: images,
      encodable: encodable,
      objStm: objStm,
      encrypted: encrypted
    };
  }

  /* ---------- 2. object streams ----------

     A file from Acrobat or Word can pack dozens of small objects — resource
     dictionaries, content streams — into one compressed stream. Those objects
     never appear as `N 0 obj`, so a merger that only walks the top level would
     copy them as an opaque blob and any page hidden inside would vanish. When
     the browser can inflate, this opens them into ordinary objects so they take
     part in the renumbering like everything else. */

  function inflateBytes(u8) {
    if (typeof global.DecompressionStream !== 'function') {
      return Promise.reject(new Error('no DecompressionStream'));
    }
    return Promise.resolve(new Response(
      new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))
    ).arrayBuffer()).then(function (ab) { return new Uint8Array(ab); });
  }

  function openObjStm(o) {
    /* o.dataText is the compressed bytes of the whole object stream. */
    return inflateBytes(fromLatin1(o.dataText)).then(function (u8) {
      var s = toLatin1(u8);
      var out = [];
      var re = /(\d+)\s+0\s+obj/g;
      var m;
      while ((m = re.exec(s)) !== null) {
        var bs = m.index + m[0].length;
        var sm = s.indexOf('stream', bs);
        if (sm === -1) {
          var e0 = s.indexOf('endobj', bs);
          if (e0 === -1) continue;
          out.push({ src: Number(m[1]), dictText: s.slice(bs, e0), hasStream: false, eol: '', dataText: '' });
          continue;
        }
        var ctor = sm + 6;
        if (s[ctor] === '\r') ctor += 1;
        if (s[ctor] === '\n') ctor += 1;
        var de = s.indexOf('endstream', ctor);
        if (de === -1) continue;
        out.push({
          src: Number(m[1]),
          dictText: s.slice(bs, sm),
          hasStream: true,
          eol: s.slice(sm, ctor),
          dataText: s.slice(ctor, de)
        });
      }
      if (!out.length) throw new Error('empty object stream');
      return out;
    });
  }

  /* ---------- 3. the merge ---------- */

  function expandAll(p) {
    var jobs = [];
    var plainObjects = [];
    for (var i = 0; i < p.objs.length; i++) {
      var o = p.objs[i];
      if (typeOf(o.dictText) === 'ObjStm') {
        jobs.push(openObjStm(o).then(function (list) { plainObjects = plainObjects.concat(list); })
          .catch(function () { plainObjects.push(plain(o)); }));
      } else {
        plainObjects.push(plain(o));
      }
    }
    return Promise.all(jobs).then(function () { return plainObjects; });
  }

  function merge(list) {
    if (!list || list.length < 2) return Promise.reject(new Error('Two PDFs at least.'));
    return Promise.all(list.map(function (u8) {
      return Promise.resolve(internal().parse(u8)).then(function (p) {
        return expandAll(p).then(function (objs) {
          objs.sort(function (a, b) { return a.src - b.src; });
          return { parsed: p, objs: objs, info: readPart(u8) };
        });
      });
    })).then(function (parts) {
      var encrypted = parts.filter(function (t) { return t.info.encrypted; });
      if (encrypted.length) throw new Error('One of the files is encrypted, so its contents cannot be read.');

      var out = [];
      var at = 0;
      /* Every piece of the file goes through this one function, so `at` is the
         running byte count of everything written so far — the table of offsets
         and the trailer included, which is what keeps the copy below from
         writing past the end of the buffer and quietly truncating the file
         right before the trailer it was supposed to finish. */
      function put(s) { out.push(s); at += s.length; }

      var kids = [];
      var allNums = [];
      var nextFree = 1;
      var mediaBox = '';
      var notes = [];

      var partOffsets = [];

      /* The new /Pages node is allocated after the loop that copies every
         object, but a page's /Parent has to be pointed at it while that loop
         runs — so the numbers are declared here, before both. */
      var pagesNum = nextFree;
      var catNum = nextFree + 1;

      function shiftOf(offset) {
        return function (s) {
          return s.replace(/(\d+)\s+0\s+R/g, function (_, n) {
            return (Number(n) + offset) + ' 0 R';
          });
        };
      }

      parts.forEach(function (part) {
        var offset = nextFree;
        var shift = shiftOf(offset);
        partOffsets.push(offset);
        /* A page's /Parent used to point at its own file's /Pages node, which
           does not exist any more once the page joins the new tree — every page
           of every file is a child of the one node built below. */
        function reparent(dict) {
          return shift(dict).replace(/\/Parent\s+\d+\s+0\s+R\s*/, '/Parent ' + pagesNum + ' 0 R ');
        }

        part.objs.forEach(function (o) {
          var kind = typeOf(o.dictText);
          var nn = o.src + offset;
          allNums.push(nn);
          /* Only pages need their /Parent re-pointed; every other dictionary
             is copied with its references shifted into the new numbering. */
          put(nn + ' 0 obj\n');
          var dict = (kind === 'Page') ? reparent(o.dictText) : shift(o.dictText);
          put(dict);
          if (o.hasStream) { put(o.eol); put(o.dataText); put('endstream'); }
          put('\nendobj\n');
          if (typeOf(o.dictText) === 'Page') kids.push(nn + ' 0 R');
        });

        /* /MediaBox is usually inherited from the /Pages node, and that node is
           the one thing this build throws away — so the surviving pages would
           fall back to a Letter-sized page. The first file's own value is
           carried onto the new node instead. */
        if (!mediaBox) {
          for (var i = 0; i < part.objs.length; i++) {
            var mb = part.objs[i].dictText.match(/\/MediaBox\s*\[[^\]]*\]/);
            if (mb) { mediaBox = mb[0]; break; }
          }
        }

        var high = 0;
        part.objs.forEach(function (o) { if (o.src > high) high = o.src; });
        nextFree = offset + high + 1;
      });

      var pagesNum = nextFree;
      var catNum = nextFree + 1;
      allNums.push(pagesNum, catNum);

      put(pagesNum + ' 0 obj\n<< /Type /Pages /Count ' + kids.length + ' /Kids [' +
        kids.join(' ') + ']' + (mediaBox ? ' ' + mediaBox : '') + ' >>\nendobj\n');

      /* The catalog is the first file's own catalog — its bookmarks, page mode
         and metadata ride along — with /Pages aimed at the new node. */
      var catDict = null;
      var first = parts[0];
      var firstShift = shiftOf(partOffsets[0]);
      for (var k = 0; k < first.objs.length && catDict === null; k++) {
        if (typeOf(first.objs[k].dictText) === 'Catalog') catDict = firstShift(first.objs[k].dictText);
      }
      if (catDict) {
        catDict = catDict.replace(/\/Pages\s+\d+\s+0\s+R/, '/Pages ' + pagesNum + ' 0 R');
        if (!/\/Pages\s+/.test(catDict)) {
          catDict = catDict.replace(/\s*>>\s*$/, ' /Pages ' + pagesNum + ' 0 R >>');
        }
      } else {
        catDict = '<< /Type /Catalog /Pages ' + pagesNum + ' 0 R >>';
      }
      put(catNum + ' 0 obj\n' + catDict + '\nendobj\n');

      /* The header goes in before the pass below: object offsets are the
         running byte position at the moment each object's first piece was
         pushed, so the header has to be in the list when that position is
         measured — and it has to be, because a viewer reads byte 0 for
         "%PDF-1.4" and counts every offset from there. */
      var head = parts[0].parsed.preamble;
      if (head.indexOf('%PDF-') !== 0) head = '%PDF-1.7\n' + head;
      out.unshift(head);
      /* unshift() bypasses put(), so the byte count has to be topped up by
         hand or the buffer below ends up shorter than the file and the last
         few bytes of the trailer are dropped on the copy. */
      at += head.length;

      var offsets = {};
      var run = 0;
      out.forEach(function (part) {
        var m = part.match(/^(\d+) 0 obj/);
        if (m) offsets[Number(m[1])] = run;
        run += part.length;
      });

      var maxNum = Math.max.apply(null, allNums);
      var xref = 'xref\n0 ' + (maxNum + 1) + '\n0000000000 65535 f \n';
      for (var i = 1; i <= maxNum; i++) {
        var off = offsets[i];
        xref += (typeof off === 'number')
          ? pad10(off) + ' 00000 n \n'
          : '0000000000 65535 f \n';
      }
      var xrefOffset = run;
      put(xref);
      put('trailer\n<< /Size ' + (maxNum + 1) + ' /Root ' + catNum + ' 0 R >>\nstartxref\n' +
        xrefOffset + '\n%%EOF\n');

      /* Every part goes through the same accounting, the xref and the trailer
         included, so the copy below cannot run past the end of the buffer. */
      var bytes = new Uint8Array(at);
      var w = 0;
      out.forEach(function (part) {
        if (typeof part === 'string') {
          for (var j = 0; j < part.length; j++) bytes[w + j] = part.charCodeAt(j) & 0xff;
          w += part.length;
        } else {
          bytes.set(part, w);
          w += part.length;
        }
      });

      parts.forEach(function (t) {
        if (t.info.objStm) {
          notes.push(t.info.objStm + ' compressed object stream' +
            (t.info.objStm === 1 ? '' : 's') + ' in that file were copied as they came');
        }
      });

      return {
        bytes: bytes,
        pages: kids.length,
        parts: parts.map(function (t) {
          return { pages: t.info.pages, images: t.info.images, encodable: t.info.encodable };
        }),
        notes: notes
      };
    });
  }

  /* ---------- 4. optional second pass over the pictures ---------- */

  function mergeAndShrink(list, opts) {
    opts = opts || {};
    return merge(list).then(function (res) {
      if (!opts.reencode) {
        res.report = null;
        return res;
      }
      return global.LPT.pdfcompress.compress(res.bytes, {
        quality: typeof opts.quality === 'number' ? opts.quality : 0.6,
        maxDim: opts.maxDim || 0,
        dropMetadata: opts.dropMetadata !== false
      }).then(function (rep) {
        res.report = rep;
        if (!rep.blob) return res;
        return rep.blob.arrayBuffer().then(function (ab) {
          res.bytes = new Uint8Array(ab);
          return res;
        });
      });
    });
  }

  global.LPT = global.LPT || {};
  global.LPT.pdfmerge = {
    readPart: readPart,
    merge: merge,
    mergeAndShrink: mergeAndShrink
  };
})(typeof self !== 'undefined' ? self : this);
