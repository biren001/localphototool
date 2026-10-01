/* -------------------------------------------------------------------------
   exif.js — read-only metadata inspector for LocalPhotoTool.com

   Parses EXIF (JPEG APP1 / PNG eXIf / WebP EXIF chunk), plus XMP / IPTC /
   ICC presence flags and PNG text chunks — entirely in the browser, no
   network, no library. Exposes LPTExif.parse(file) -> Promise<report>:

     {
       kind: 'jpeg' | 'png' | 'webp' | 'heic' | 'gif' | 'unknown',
       gps:  { lat, lon, alt?, dms } | null,
       tags: [{ group, label, value }],
       flags:{ exif, xmp, iptc, icc, thumbnail, pngText },
       note: string | null   // set when the container carries no parser here
     }

   Every read is bounds-checked; a malformed file yields a partial report,
   never a throw to the caller.
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  /* Byte budget for header scanning. EXIF/XMP/IPTC/ICC live in segments at
     the head of the file; 2 MB covers every camera file we have seen while
     never touching the pixel payload. */
  var SCAN_BYTES = 2 * 1024 * 1024;

  /* ------------------------------------------------------------------ */
  /* TIFF / IFD core                                                     */
  /* ------------------------------------------------------------------ */

  var TAG_GROUPS = {
    ifd0: 'Camera & image',
    exif: 'Taken & exposure',
    gps: 'GPS location',
    lens: 'Lens & ownership'
  };

  var IFD0_TAGS = {
    0x010F: ['Make', 'ifd0'],
    0x0110: ['Model', 'ifd0'],
    0x0131: ['Software', 'ifd0'],
    0x0132: ['Modify date', 'ifd0'],
    0x013B: ['Artist', 'lens'],
    0x8298: ['Copyright', 'lens'],
    0x010E: ['Description', 'ifd0'],
    0x9C9C: ['XP comment', 'ifd0']
  };

  var EXIF_TAGS = {
    0x9003: ['Date taken', 'exif'],
    0x9004: ['Digitized', 'exif'],
    0x9011: ['Offset time (taken)', 'exif'],
    0x8827: ['ISO', 'exif'],
    0x829A: ['Exposure', 'exif'],
    0x829D: ['Aperture', 'exif'],
    0x920A: ['Focal length', 'exif'],
    0xA405: ['Focal length (35 mm)', 'exif'],
    0x9209: ['Flash', 'exif'],
    0xA402: ['Exposure mode', 'exif'],
    0xA403: ['White balance', 'exif'],
    0x9207: ['Metering', 'exif'],
    0xA434: ['Lens model', 'lens'],
    0xA433: ['Lens make', 'lens'],
    0xA430: ['Camera owner', 'lens'],
    0xA431: ['Body serial', 'lens'],
    0x9286: ['User comment', 'exif']
  };

  var FLASH_BITS = { 0: 'Off', 1: 'On' };

  function fmtExposure(v) {
    if (!(v > 0)) return null;
    return v >= 1 ? v.toFixed(1) + ' s' : '1/' + Math.round(1 / v) + ' s';
  }
  function fmtRational(num, den) {
    if (!den) return null;
    return num / den;
  }

  /* Read one IFD. dv = DataView of the TIFF block, tiffStart = offset of
     "II*\0"/"MM\0*" inside that block. Returns entries and child offsets. */
  function readIFD(dv, tiffStart, ifdOffset, little, out) {
    var base = tiffStart + ifdOffset;
    if (base + 2 > dv.byteLength) return null;
    var count = dv.getUint16(base, little);
    if (count > 512) return null; // sanity: never a real IFD
    var entries = [];
    var i, tag, type, n, valOff;
    for (i = 0; i < count; i++) {
      var e = base + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      tag = dv.getUint16(e, little);
      type = dv.getUint16(e + 2, little);
      n = dv.getUint32(e + 4, little);
      valOff = e + 8;
      var sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      var unit = sizes[type] || 1;
      var total = unit * n;
      if (total > 4) valOff = tiffStart + dv.getUint32(e + 8, little);
      if (valOff < 0 || valOff + total > dv.byteLength) continue;
      entries.push({ tag: tag, type: type, n: n, off: valOff });
    }
    var nextPos = base + 2 + count * 12;
    var next = (nextPos + 4 <= dv.byteLength) ? dv.getUint32(nextPos, little) : 0;
    return { entries: entries, next: next };
  }

  function readValue(dv, ent, little) {
    var i, v = [];
    switch (ent.type) {
      case 2: { // ASCII
        var s = '';
        for (i = 0; i < ent.n; i++) {
          var c = dv.getUint8(ent.off + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 1: case 7: { // BYTE / UNDEFINED
        for (i = 0; i < Math.min(ent.n, 256); i++) v.push(dv.getUint8(ent.off + i));
        return v;
      }
      case 3: { // SHORT
        for (i = 0; i < Math.min(ent.n, 128); i++) v.push(dv.getUint16(ent.off + i * 2, little));
        return v;
      }
      case 4: { // LONG
        for (i = 0; i < Math.min(ent.n, 128); i++) v.push(dv.getUint32(ent.off + i * 4, little));
        return v;
      }
      case 5: case 10: { // (S)RATIONAL
        var signed = ent.type === 10;
        for (i = 0; i < Math.min(ent.n, 64); i++) {
          var num = signed ? dv.getInt32(ent.off + i * 8, little) : dv.getUint32(ent.off + i * 8, little);
          var den = signed ? dv.getInt32(ent.off + i * 8 + 4, little) : dv.getUint32(ent.off + i * 8 + 4, little);
          v.push([num, den]);
        }
        return v;
      }
      case 9: return [dv.getInt32(ent.off, little)];
      default: return null;
    }
  }

  function firstStr(v) { return typeof v === 'string' ? v : null; }
  function firstNum(v) {
    if (Array.isArray(v)) {
      var f = v[0];
      if (typeof f === 'number') return f;
      if (Array.isArray(f) && f[1]) return f[0] / f[1];
      return null;
    }
    return typeof v === 'number' ? v : null;
  }

  /* Parse a TIFF block (starting at "II*\0" or "MM\0*") into report parts. */
  function parseTiff(dv, tiffStart, report) {
    if (tiffStart + 8 > dv.byteLength) return;
    var bom = dv.getUint16(tiffStart, false);
    var little;
    if (bom === 0x4949) little = true;       // "II"
    else if (bom === 0x4D4D) little = false; // "MM"
    else return;
    if (dv.getUint16(tiffStart + 2, little) !== 42) return;

    var ifd0 = readIFD(dv, tiffStart, dv.getUint32(tiffStart + 4, little), little);
    if (!ifd0) return;

    var exifOffset = null, gpsOffset = null;
    var i, ent, val;

    for (i = 0; i < ifd0.entries.length; i++) {
      ent = ifd0.entries[i];
      if (ent.tag === 0x8769) exifOffset = dv.getUint32(ent.off, little);
      else if (ent.tag === 0x8825) gpsOffset = dv.getUint32(ent.off, little);
      else if (ent.tag === 0x0112) {
        val = readValue(dv, ent, little);
        var o = firstNum(val);
        if (o) report.orientation = o;   // 1..8; >1 means pixel data lies on its side
      } else {
        var def = IFD0_TAGS[ent.tag];
        if (!def) continue;
        val = readValue(dv, ent, little);
        var s = typeof val === 'string' ? val : null;
        if (s) report.tags.push({ group: def[1], label: def[0], value: s });
      }
    }

    if (exifOffset) {
      var exif = readIFD(dv, tiffStart, exifOffset, little);
      if (exif) {
        var nums = {};
        for (i = 0; i < exif.entries.length; i++) {
          ent = exif.entries[i];
          var edef = EXIF_TAGS[ent.tag];
          if (!edef) continue;
          val = readValue(dv, ent, little);
          if (typeof val === 'string' && val) {
            report.tags.push({ group: edef[1], label: edef[0], value: val });
          } else {
            var n = firstNum(val);
            if (n !== null && n !== undefined) nums[ent.tag] = n;
            if (ent.tag === 0x9286 && Array.isArray(val)) {
              // UNDEFINED UserComment: strip the 8-byte charset prefix
              var bytes = val;
              var text = '';
              for (var b = 8; b < bytes.length; b++) {
                if (bytes[b] === 0) break;
                text += String.fromCharCode(bytes[b]);
              }
              if (text.trim()) report.tags.push({ group: edef[1], label: edef[0], value: text.trim() });
            }
          }
        }
        if (nums[0x829A]) {
          var exp = fmtExposure(nums[0x829A]);
          if (exp) report.tags.push({ group: 'exif', label: 'Exposure', value: exp });
        }
        if (nums[0x829D] !== undefined && nums[0x829D] > 0) {
          report.tags.push({ group: 'exif', label: 'Aperture', value: 'f/' + (+nums[0x829D].toFixed(1)) });
        }
        if (nums[0x8827]) report.tags.push({ group: 'exif', label: 'ISO', value: String(nums[0x8827]) });
        if (nums[0x920A]) report.tags.push({ group: 'exif', label: 'Focal length', value: Math.round(nums[0x920A] * 10) / 10 + ' mm' });
        if (nums[0xA405]) report.tags.push({ group: 'exif', label: 'Focal length (35 mm)', value: nums[0xA405] + ' mm' });
        if (nums[0x9209] !== undefined) {
          var f = nums[0x9209];
          report.tags.push({ group: 'exif', label: 'Flash', value: FLASH_BITS[f & 1] || ('code ' + f) });
        }
        if (nums[0xA402] !== undefined) report.tags.push({ group: 'exif', label: 'Exposure mode', value: ['Auto', 'Manual', 'Auto bracket'][nums[0xA402]] || ('code ' + nums[0xA402]) });
        if (nums[0xA403] !== undefined) report.tags.push({ group: 'exif', label: 'White balance', value: nums[0xA403] ? 'Manual' : 'Auto' });
        if (nums[0x9207] !== undefined) report.tags.push({ group: 'exif', label: 'Metering', value: ['Unknown', 'Average', 'Centre-weighted', 'Spot', 'Multi-spot', 'Pattern', 'Partial'][nums[0x9207]] || ('code ' + nums[0x9207]) });
      }
    }

    if (gpsOffset) {
      var gps = readIFD(dv, tiffStart, gpsOffset, little);
      if (gps) {
        var g = {};
        for (i = 0; i < gps.entries.length; i++) {
          ent = gps.entries[i];
          val = readValue(dv, ent, little);
          if (ent.tag === 0x0001 || ent.tag === 0x0003) g[ent.tag] = firstStr(val);
          else if (ent.tag === 0x0002 || ent.tag === 0x0004 || ent.tag === 0x0006 || ent.tag === 0x0007) g[ent.tag] = val;
          else if (ent.tag === 0x0005) g.refAlt = firstNum(val);
          else if (ent.tag === 0x001D) g.date = firstStr(val);
        }
        function dms(arr) {
          if (!Array.isArray(arr) || arr.length < 3) return null;
          var d = fmtRational(arr[0][0], arr[0][1]);
          var m = fmtRational(arr[1][0], arr[1][1]);
          var s = fmtRational(arr[2][0], arr[2][1]);
          if (d === null || m === null || s === null) return null;
          return d + m / 60 + s / 3600;
        }
        var lat = dms(g[0x0002]), lon = dms(g[0x0004]);
        if (lat !== null && lon !== null) {
          if (g[0x0001] === 'S') lat = -lat;
          if (g[0x0003] === 'W') lon = -lon;
          var dmsStr =
            Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' +
            Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W');
          report.gps = {
            lat: +lat.toFixed(6),
            lon: +lon.toFixed(6),
            dms: dmsStr
          };
          report.tags.push({ group: 'gps', label: 'Coordinates', value: dmsStr });
          if (g[0x0006]) {
            var alt = fmtRational(g[0x0006][0] && g[0x0006][0][0], g[0x0006][0] && g[0x0006][0][1]);
            if (alt !== null) {
              report.gps.alt = Math.round(alt);
              report.tags.push({ group: 'gps', label: 'Altitude', value: Math.round(alt) + ' m' + (g.refAlt ? ' (below sea level)' : '') });
            }
          }
          if (g.date) report.tags.push({ group: 'gps', label: 'GPS date', value: g.date });
          if (g[0x0007] && Array.isArray(g[0x0007])) {
            var h = fmtRational(g[0x0007][0][0], g[0x0007][0][1]);
            var mi = fmtRational(g[0x0007][1][0], g[0x0007][1][1]);
            var se = fmtRational(g[0x0007][2][0], g[0x0007][2][1]);
            if (h !== null && mi !== null && se !== null) {
              var hh = String(Math.floor(h)).padStart(2, '0');
              var mm = String(Math.floor(mi)).padStart(2, '0');
              var ss = String(Math.floor(se)).padStart(2, '0');
              report.tags.push({ group: 'gps', label: 'GPS time (UTC)', value: hh + ':' + mm + ':' + ss });
            }
          }
        }
      }
    }

    /* IFD1 = embedded thumbnail. Its presence is itself worth disclosing. */
    if (ifd0.next) {
      var ifd1 = readIFD(dv, tiffStart, ifd0.next, little);
      if (ifd1) {
        for (i = 0; i < ifd1.entries.length; i++) {
          if (ifd1.entries[i].tag === 0x0201) { report.flags.thumbnail = true; break; }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Container walkers                                                   */
  /* ------------------------------------------------------------------ */

  function parseJpeg(u8, report) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xFF) { p++; continue; }
      var marker = u8[p + 1];
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { p += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break; // start of scan / end
      var len = dv.getUint16(p + 2);
      if (len < 2 || p + 2 + len > u8.length) break;
      var seg = u8.subarray(p + 4, p + 2 + len);
      if (marker === 0xE1) {
        if (seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66 && seg[4] === 0 && seg[5] === 0) {
          report.flags.exif = true;
          parseTiff(new DataView(seg.buffer, seg.byteOffset + 6, seg.byteLength - 6), 0, report);
        } else if (seg.length > 29 && String.fromCharCode.apply(null, seg.subarray(0, 28)).indexOf('http://ns.adobe.com/xap/') === 0) {
          report.flags.xmp = true;
        }
      } else if (marker === 0xED) {
        report.flags.iptc = true; // Photoshop IRB — almost always carries IPTC
      } else if (marker === 0xE2 && seg.length > 12 && String.fromCharCode.apply(null, seg.subarray(0, 11)) === 'ICC_PROFILE') {
        report.flags.icc = true;
      }
      p += 2 + len;
    }
  }

  function parsePng(u8, report) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = 8; // signature
    while (p + 12 <= u8.length) {
      var len = dv.getUint32(p);
      var type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (type === 'eXIf') {
        report.flags.exif = true;
        parseTiff(new DataView(u8.buffer, u8.byteOffset + p + 8, len), 0, report);
      } else if (type === 'tEXt') {
        report.flags.pngText = true;
        var z = u8.indexOf(0, p + 8);
        if (z > p + 8 && z < p + 8 + len) {
          var key = String.fromCharCode.apply(null, u8.subarray(p + 8, z));
          var text = String.fromCharCode.apply(null, u8.subarray(z + 1, Math.min(p + 8 + len, z + 201)));
          report.tags.push({ group: 'ifd0', label: 'PNG text: ' + key, value: text });
        }
      } else if (type === 'iTXt') {
        report.flags.pngText = true;
        var z2 = u8.indexOf(0, p + 8);
        if (z2 > p + 8 && z2 < p + 8 + len) {
          var key2 = String.fromCharCode.apply(null, u8.subarray(p + 8, z2));
          report.tags.push({ group: 'ifd0', label: 'PNG text: ' + key2, value: '(international text chunk present)' });
        }
      } else if (type === 'IDAT' || type === 'IEND') {
        break; // pixel data begins; nothing interesting after
      }
      p += 12 + len;
      if (len > u8.length) break;
    }
  }

  function parseWebp(u8, report) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = 12; // RIFF header + 'WEBP'
    while (p + 8 <= u8.length) {
      var fourcc = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      var len = dv.getUint32(p + 4, true);
      if (fourcc === 'EXIF') {
        report.flags.exif = true;
        var skip = (u8[p + 8] === 0x45 && u8[p + 9] === 0x78) ? 6 : 0; // "Exif\0\0" prefix
        parseTiff(new DataView(u8.buffer, u8.byteOffset + p + 8 + skip, len - skip), 0, report);
      } else if (fourcc === 'XMP ') {
        report.flags.xmp = true;
      } else if (fourcc === 'ICCP') {
        report.flags.icc = true;
      }
      p += 8 + len + (len & 1);
    }
  }

  function detectKind(u8) {
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpeg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
    if (u8[0] === 0x52 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'webp';
    if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
      var brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
      if (/^(heic|heix|hevc|hevx|mif1|msf1|heif)/.test(brand)) return 'heic';
      return 'unknown';
    }
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'gif';
    return 'unknown';
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  function parse(file) {
    return file.slice(0, SCAN_BYTES).arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      var report = {
        kind: detectKind(u8),
        gps: null,
        orientation: null,
        tags: [],
        flags: { exif: false, xmp: false, iptc: false, icc: false, thumbnail: false, pngText: false },
        note: null
      };
      try {
        if (report.kind === 'jpeg') parseJpeg(u8, report);
        else if (report.kind === 'png') parsePng(u8, report);
        else if (report.kind === 'webp') parseWebp(u8, report);
        else if (report.kind === 'heic') report.note = 'HEIC container detected. iPhone HEIC files usually carry the same EXIF (including GPS) inside — run them through the HEIC to JPG converter and inspect the result, or check in the Photos app.';
        else report.note = 'Container not inspected. Treat unknown files as carrying metadata until proven otherwise.';
      } catch (e) {
        report.note = 'Part of this file was unreadable — the listing below may be incomplete.';
      }
      /* De-duplicate labels, keep first occurrence, preserve GPS first */
      var seen = {};
      report.tags = report.tags.filter(function (t) {
        var k = t.group + '|' + t.label;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      return report;
    });
  }

  window.LPTExif = { parse: parse };
})();
