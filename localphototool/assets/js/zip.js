/* ==========================================================================
   LocalPhotoTool — minimal ZIP writer (zero dependencies)
   Store method only: the payloads are already-compressed images, so DEFLATE
   would cost CPU for ~0% gain. Writes UTF-8 filenames (flag bit 11).
   ========================================================================== */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, seed) {
    var c = (seed === undefined ? 0xffffffff : seed) >>> 0;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var year = d.getFullYear();
    if (year < 1980) year = 1980;
    var time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
    var day = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
    return { time: time & 0xffff, date: day & 0xffff };
  }

  /* ---- Byte helpers ----------------------------------------------------- */
  function Writer(size) {
    this.chunks = [];
    this.length = 0;
    this._buf = new Uint8Array(size);
    this._off = 0;
  }
  Writer.prototype.u16 = function (v) {
    this._buf[this._off++] = v & 0xff;
    this._buf[this._off++] = (v >>> 8) & 0xff;
    return this;
  };
  Writer.prototype.u32 = function (v) {
    this._buf[this._off++] = v & 0xff;
    this._buf[this._off++] = (v >>> 8) & 0xff;
    this._buf[this._off++] = (v >>> 16) & 0xff;
    this._buf[this._off++] = (v >>> 24) & 0xff;
    return this;
  };
  Writer.prototype.bytes = function (b) {
    this.flush();
    this.chunks.push(b);
    this.length += b.length;
    return this;
  };
  Writer.prototype.flush = function () {
    if (this._off > 0) {
      this.chunks.push(this._buf.slice(0, this._off));
      this.length += this._off;
      this._off = 0;
    }
  };
  Writer.prototype.blob = function (type) {
    this.flush();
    return new Blob(this.chunks, { type: type || 'application/zip' });
  };

  /**
   * Build a ZIP archive.
   * @param {Array<{name:string, data:Uint8Array, date?:Date}>} entries
   * @returns {Blob}
   */
  function createZip(entries) {
    var enc = new TextEncoder();
    var parts = [];
    var offset = 0;
    var central = [];

    entries.forEach(function (entry) {
      var nameBytes = enc.encode(sanitize(entry.name));
      var data = entry.data;
      var crc = crc32(data);
      var stamp = dosDateTime(entry.date);

      // Local file header (30 bytes + name)
      var lh = new Writer(30 + nameBytes.length);
      lh.u32(0x04034b50).u16(20).u16(0x0800).u16(0) // method 0 = store
        .u16(stamp.time).u16(stamp.date)
        .u32(crc).u32(data.length).u32(data.length)
        .u16(nameBytes.length).u16(0)
        .bytes(nameBytes);
      parts.push(lh);
      parts.push({ blob: new Blob([data]) });

      central.push({
        nameBytes: nameBytes, crc: crc, size: data.length,
        offset: offset, stamp: stamp
      });
      offset += 30 + nameBytes.length + data.length;
    });

    var centralSize = 0;
    var cw = new Writer(46 + 32);
    central.forEach(function (e) {
      cw.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0)
        .u16(e.stamp.time).u16(e.stamp.date)
        .u32(e.crc).u32(e.size).u32(e.size)
        .u16(e.nameBytes.length).u16(0).u16(0)
        .u16(0).u16(0).u32(0)
        .u32(e.offset)
        .bytes(e.nameBytes);
      centralSize += 46 + e.nameBytes.length;
    });
    parts.push(cw);

    var eocd = new Writer(22);
    eocd.u32(0x06054b50).u16(0).u16(0)
      .u16(central.length).u16(central.length)
      .u32(centralSize).u32(offset).u16(0);
    parts.push(eocd);

    var blobs = parts.map(function (p) {
      return p instanceof Writer ? p.blob() : p.blob;
    });
    return new Blob(blobs, { type: 'application/zip' });
  }

  function sanitize(name) {
    return String(name)
      .replace(/[\\/]+/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/^\.+/, '')
      .trim() || 'image';
  }

  global.LPT = global.LPT || {};
  global.LPT.zip = { create: createZip, crc32: crc32, sanitizeName: sanitize };
})(typeof self !== 'undefined' ? self : this);
