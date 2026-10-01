/* -------------------------------------------------------------------------
   xmpmeta.js — lossless metadata surgery for LocalPhotoTool.com

   Complements the re-encoding tools: stripping and injecting metadata here
   rewrites container segments only. Pixels are copied byte-for-byte, so the
   image quality never changes and nothing is re-compressed.

     LPTMeta.strip(blob, opts)        -> Promise<Blob>      // remove EXIF/XMP
                                                            // (+ ICC on request)
     LPTMeta.injectXmp(blob, fields)  -> Promise<Blob|null> // JPEG/PNG only;
                                                            // null when the
                                                            // container cannot
                                                            // take XMP losslessly
     LPTMeta.buildXmp(fields)         -> string
     LPTMeta.kindOf(blob)             -> Promise<'jpeg'|'png'|'webp'|'other'>
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  function kindOf(blob) {
    return blob.slice(0, 16).arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpeg';
      if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
      if (u8.length >= 12 &&
        u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
        u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'webp';
      return 'other';
    });
  }

  var XMP_NS = 'http://ns.adobe.com/xap/1.0/\u0000';

  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildXmp(f) {
    f = f || {};
    var alt = function (tag, v) {
      if (!v) return '';
      return '   <' + tag + '><rdf:Alt><rdf:li xml:lang="x-default">' +
        xmlEscape(v) + '</rdf:li></rdf:Alt></' + tag + '>\n';
    };
    var out = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
      ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '  <rdf:Description rdf:about=""\n' +
      '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
      '    xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n';
    if (f.title) out += alt('dc:title', f.title);
    if (f.creator) {
      out += '   <dc:creator><rdf:Seq><rdf:li>' + xmlEscape(f.creator) +
        '</rdf:li></rdf:Seq></dc:creator>\n';
    }
    out += alt('dc:description', f.description);
    out += alt('dc:rights', f.copyright);
    var keywords = String(f.keywords || '').split(',')
      .map(function (k) { return k.trim(); }).filter(Boolean);
    if (keywords.length) {
      out += '   <dc:subject><rdf:Bag>\n' + keywords.map(function (k) {
        return '    <rdf:li>' + xmlEscape(k) + '</rdf:li>\n';
      }).join('') + '   </rdf:Bag></dc:subject>\n';
    }
    if (f.software) out += '   <xmp:CreatorTool>' + xmlEscape(f.software) + '</xmp:CreatorTool>\n';
    out += '  </rdf:Description>\n' +
      ' </rdf:RDF>\n' +
      '</x:xmpmeta>\n<?xpacket end="w"?>';
    return out;
  }

  /* ---------------- JPEG ---------------- */

  /* Marker walk: copy every segment except the ones we drop. Entropy-coded
     data after SOS is copied wholesale to EOF. */
  function stripJpeg(u8, opts) {
    var parts = [u8.subarray(0, 2)];          // SOI
    var p = 2;
    while (p + 1 < u8.length) {
      if (u8[p] !== 0xFF) { p++; continue; }
      var marker = u8[p + 1];
      if (marker === 0xFF) { p++; continue; } // fill bytes
      if (marker === 0xD9 || marker === 0xDA) { // EOI or SOS: copy to EOF
        parts.push(u8.subarray(p));
        p = u8.length;
        break;
      }
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        parts.push(u8.subarray(p, p + 2));    // standalone markers
        p += 2;
        continue;
      }
      if (p + 4 > u8.length) { parts.push(u8.subarray(p)); break; }
      var len = (u8[p + 2] << 8) | u8[p + 3];
      if (p + 2 + len > u8.length) { parts.push(u8.subarray(p)); break; }
      var drop = false;
      if (marker === 0xE1) {                  // APP1: EXIF or XMP
        var head = '';
        for (var i = p + 4; i < Math.min(p + 4 + 29, p + 2 + len); i++) head += String.fromCharCode(u8[i]);
        if (head.indexOf('Exif\u0000\u0000') === 0 ||
          head.indexOf('http://ns.adobe.com/xap/1.0/\u0000') === 0) drop = true;
      } else if (marker === 0xE2 && opts && opts.dropIcc) { // APP2: ICC
        var icc = '';
        for (var j = p + 4; j < Math.min(p + 4 + 12, p + 2 + len); j++) icc += String.fromCharCode(u8[j]);
        if (icc.indexOf('ICC_PROFILE\u0000') === 0) drop = true;
      }
      if (!drop) parts.push(u8.subarray(p, p + 2 + len));
      p += 2 + len;
    }
    if (p < u8.length) parts.push(u8.subarray(p));
    return new Blob(parts, { type: 'image/jpeg' });
  }

  function injectXmpJpeg(u8, xmp) {
    /* UTF-8, not charCodeAt: users type ©, é and CJK into these fields. */
    var payload = new TextEncoder().encode(XMP_NS + xmp);
    var seg = new Uint8Array(4 + payload.length);
    seg[0] = 0xFF; seg[1] = 0xE1;
    var segLen = payload.length + 2;
    seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;
    seg.set(payload, 4);
    /* Right after SOI, before every other segment. */
    return new Blob([u8.subarray(0, 2), seg, u8.subarray(2)], { type: 'image/jpeg' });
  }

  /* ---------------- PNG ---------------- */

  function chunkType(u8, p) {
    return String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
  }

  function stripPng(u8, opts) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var parts = [u8.subarray(0, 8)];
    var p = 8;
    while (p + 12 <= u8.length) {
      var len = dv.getUint32(p);
      var total = 12 + len;
      if (p + total > u8.length) { parts.push(u8.subarray(p)); break; }
      var type = chunkType(u8, p);
      var drop = type === 'eXIf' || type === 'tEXt' || type === 'iTXt' || type === 'zTXt';
      if (!drop && type === 'iCCP' && opts && opts.dropIcc) drop = true;
      if (!drop) parts.push(u8.subarray(p, p + total));
      p += total;
    }
    return new Blob(parts, { type: 'image/png' });
  }

  function injectXmpPng(u8, xmp, crc32) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var enc = new TextEncoder();
    var data = enc.encode('XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000' + xmp);
    var chunk = new Uint8Array(12 + data.length);
    var cdv = new DataView(chunk.buffer);
    cdv.setUint32(0, data.length);
    chunk[4] = 0x69; chunk[5] = 0x54; chunk[6] = 0x58; chunk[7] = 0x74; // iTXt
    chunk.set(data, 8);
    cdv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    /* Right after IHDR. */
    var ihdrLen = dv.getUint32(8);
    var cut = 8 + 12 + ihdrLen;
    return new Blob([u8.subarray(0, cut), chunk, u8.subarray(cut)], { type: 'image/png' });
  }

  /* ---------------- WebP ---------------- */

  function stripWebp(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var parts = [];
    var p = 12;
    while (p + 8 <= u8.length) {
      var fourcc = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      var len = dv.getUint32(p + 4, true);
      var total = 8 + len + (len & 1); /* chunks are padded to even sizes */
      if (p + total > u8.length) break;
      if (fourcc !== 'EXIF' && fourcc !== 'XMP ') parts.push(u8.subarray(p, p + total));
      p += total;
    }
    if (p < u8.length) parts.push(u8.subarray(p));
    var size = 4; /* 'WEBP' fourcc */
    parts.forEach(function (b) { size += b.length; });
    var out = new Uint8Array(8 + size);
    out.set(u8.subarray(0, 4), 0);            // 'RIFF'
    new DataView(out.buffer).setUint32(4, size, true);
    out.set(u8.subarray(8, 12), 8);           // 'WEBP'
    var off = 12;
    parts.forEach(function (b) { out.set(b, off); off += b.length; });
    return new Blob([out], { type: 'image/webp' });
  }

  /* ---------------- Public API ---------------- */

  function u8Of(blob) {
    return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function strip(blob, opts) {
    return kindOf(blob).then(function (kind) {
      if (kind === 'jpeg') return u8Of(blob).then(function (u8) { return stripJpeg(u8, opts); });
      if (kind === 'png') return u8Of(blob).then(function (u8) { return stripPng(u8, opts); });
      if (kind === 'webp') return u8Of(blob).then(function (u8) { return stripWebp(u8); });
      return blob; /* unknown container: leave untouched */
    });
  }

  /* Returns null when the container cannot take XMP losslessly. The caller
     then keeps the stripped blob instead. */
  function injectXmp(blob, fields, crc32) {
    if (!crc32) crc32 = (window.LPT && window.LPT.zip && window.LPT.zip.crc32) || null;
    var hasFields = Object.keys(fields || {}).some(function (k) { return String(fields[k] || '').trim(); });
    if (!hasFields) return Promise.resolve(blob);
    var xmp = buildXmp(fields);
    return kindOf(blob).then(function (kind) {
      if (kind === 'jpeg') {
        return strip(blob).then(function (clean) {
          return u8Of(clean).then(function (u8) { return injectXmpJpeg(u8, xmp); });
        });
      }
      if (kind === 'png') {
        if (!crc32) return null;
        return u8Of(blob).then(function (u8) { return injectXmpPng(u8, xmp, crc32); });
      }
      return null; /* webp and unknown */
    });
  }

  window.LPTMeta = {
    strip: strip,
    injectXmp: injectXmp,
    buildXmp: buildXmp,
    kindOf: kindOf
  };
})();
