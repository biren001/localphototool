/* pdfwriter.js — minimal PDF builder for localphototool /images-to-pdf/.
   Embeds JPEG bytes as-is (DCTDecode) — no re-encoding, no canvas, no DOM.
   One image per page. Page sizes in PDF points (1/72 inch).

   Page modes:
     fit    — each page matches the image's aspect ratio at `dpi` (default 150),
              image fills the page edge to edge.
     a4     — A4 portrait  (595.28 × 841.89 pt), image fitted inside, centered.
     a4l    — A4 landscape, same rule.
     letter — US Letter portrait (612 × 792 pt), same rule.
     letterl— US Letter landscape, same rule.

   Everything is bounds-counted by hand: offsets are computed from the byte
   stream we actually emit, and verified in the unit tests against a
   structural walk. ASCII only in every dictionary value we write.

   Exposes LPT.pdf.build({ images, pageSize, dpi, margin, title }) -> Uint8Array.
*/
(function (global) {
  'use strict';

  var A4 = [595.28, 841.89];
  var LETTER = [612, 792];

  function isJpeg(bytes) {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  function esc(s) {
    return String(s).replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1').slice(0, 120);
  }

  /* Fit box: largest w×h rect inside (pw−2m)×(ph−2m), centered. */
  function fitInside(w, h, pw, ph, m) {
    var aw = pw - 2 * m, ah = ph - 2 * m;
    var s = Math.min(aw / w, ah / h);
    var dw = w * s, dh = h * s;
    return { x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh };
  }

  function pageBox(mode, imgW, imgH, dpi) {
    if (mode === 'fit' || mode === 'fitl') {
      var conv = 72 / (dpi > 10 && dpi < 1200 ? dpi : 150);
      var w = imgW * conv, h = imgH * conv;
      /* Cap a runaway page size at 14400 pt (PDF viewer hard limit). */
      var cap = 14400;
      var s = Math.min(1, cap / Math.max(w, h));
      if (mode === 'fitl' && imgH > imgW) return [0, 0, h * s, w * s];
      return [0, 0, w * s, h * s];
    }
    if (mode === 'a4l') return [0, 0, A4[1], A4[0]];
    if (mode === 'letter') return [0, 0, LETTER[0], LETTER[1]];
    if (mode === 'letterl') return [0, 0, LETTER[1], LETTER[0]];
    return [0, 0, A4[0], A4[1]]; /* a4 */
  }

  /* ---------------------------------------------------------------
     Byte assembler: chunks + running offset, so xref is exact.
     --------------------------------------------------------------- */
  function Asm() {
    this.parts = [];
    this.len = 0;
    this.offsets = {};   /* objNum -> byte offset */
  }
  Asm.prototype.push = function (str) {
    var b = typeof str === 'string' ? asciiBytes(str) : str;
    this.parts.push(b);
    this.len += b.length;
  };
  Asm.prototype.objStart = function (n) { this.offsets[n] = this.len; };
  function asciiBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  Asm.prototype.concat = function () {
    var out = new Uint8Array(this.len), p = 0;
    for (var i = 0; i < this.parts.length; i++) { out.set(this.parts[i], p); p += this.parts[i].length; }
    return out;
  };

  function build(opts) {
    var imgs = opts && opts.images;
    if (!imgs || !imgs.length) throw new Error('no-images');
    var mode = opts.pageSize || 'fit';
    var dpi = Number(opts.dpi) || 150;
    var margin = (mode === 'fit' || mode === 'fitl') ? 0 : (opts.margin === 0 ? 0 : Number(opts.margin) || 24);
    var title = esc(opts.title || 'Images');

    for (var v = 0; v < imgs.length; v++) {
      var b = imgs[v].data instanceof Uint8Array ? imgs[v].data : new Uint8Array(imgs[v].data);
      if (!isJpeg(b)) throw new Error('not-jpeg: image ' + (v + 1));
      if (!(imgs[v].width > 0 && imgs[v].height > 0)) throw new Error('bad-dims: image ' + (v + 1));
    }

    var asm = new Asm();
    var n = imgs.length;
    /* Object numbering: 1 catalog, 2 pages, 3..(2+n) pages, (3+n)..(2+2n) images,
       (3+2n)..(2+3n) contents, 3+3n info. */
    var objPage = function (i) { return 3 + i; };
    var objImg = function (i) { return 3 + n + i; };
    var objContent = function (i) { return 3 + 2 * n + i; };
    var objInfo = 3 + 3 * n;

    asm.push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

    asm.objStart(1);
    asm.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    var kids = [];
    for (var i = 0; i < n; i++) kids.push(objPage(i) + ' 0 R');
    asm.objStart(2);
    asm.push('2 0 obj\n<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>\nendobj\n');

    for (i = 0; i < n; i++) {
      var img = imgs[i];
      var box = pageBox(mode, img.width, img.height, dpi);
      var place = (mode === 'fit' || mode === 'fitl')
        ? { x: 0, y: 0, w: box[2], h: box[3] }
        : fitInside(img.width, img.height, box[2], box[3], margin);

      asm.objStart(objPage(i));
      asm.push(objPage(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R ' +
        '/MediaBox [' + box.join(' ') + '] ' +
        '/Resources << /XObject << /Im' + i + ' ' + objImg(i) + ' 0 R >> >> ' +
        '/Contents ' + objContent(i) + ' 0 R >>\nendobj\n');

      asm.objStart(objImg(i));
      var data = img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data);
      asm.push(objImg(i) + ' 0 obj\n<< /Type /XObject /Subtype /Image ' +
        '/Width ' + img.width + ' /Height ' + img.height + ' ' +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
        '/Length ' + data.length + ' >>\nstream\n');
      asm.push(data);
      asm.push('\nendstream\nendobj\n');

      var cs = 'q ' + place.w.toFixed(2) + ' 0 0 ' + place.h.toFixed(2) +
        ' ' + place.x.toFixed(2) + ' ' + place.y.toFixed(2) + ' cm /Im' + i + ' Do Q';
      asm.objStart(objContent(i));
      asm.push(objContent(i) + ' 0 obj\n<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream\nendobj\n');
    }

    var d = new Date(), pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var stamp = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
    asm.objStart(objInfo);
    asm.push(objInfo + ' 0 obj\n<< /Title (' + esc(title) + ') /Producer (localphototool.com) /CreationDate (' + stamp + ') >>\nendobj\n');

    /* xref — subsection starts at object 0 (the free row) and counts every
       object 1..last, i.e. last+1 rows total. Getting the declared count
       wrong here is invisible to naive readers but breaks strict parsers. */
    var first = 1, last = objInfo;
    var xrefLen = last + 1;
    var xrefOff = asm.len;
    var rows = ['0000000000 65535 f '];
    for (i = first; i <= last; i++) {
      var off = String(asm.offsets[i]);
      while (off.length < 10) off = '0' + off;
      rows.push(off + ' 00000 n ');
    }
    asm.push('xref\n0 ' + xrefLen + '\n' + rows.join('\n') + '\n');
    asm.push('trailer\n<< /Size ' + (last + 1) + ' /Root 1 0 R /Info ' + objInfo + ' 0 R >>\n' +
      'startxref\n' + xrefOff + '\n%%EOF\n');

    return asm.concat();
  }

  global.LPT = global.LPT || {};
  global.LPT.pdf = { build: build, pageBox: pageBox, fitInside: fitInside };
})(typeof window !== 'undefined' ? window : globalThis);
