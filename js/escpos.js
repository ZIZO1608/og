/* ==========================================================================
   OG SYSTEM — canvas to ESC/POS
   --------------------------------------------------------------------------
   Turns a rendered receipt canvas into the bytes a raw TCP:9100 thermal
   printer understands. Nothing here knows what a receipt looks like — that
   is js/receipt.js's job — this file only thresholds pixels and packs them.

   ESC/POS TEXT MODE IS NOT USED ANYWHERE IN THIS APP. It cannot shape Arabic,
   cannot use Montserrat, and dithers a logo badly. Every receipt is drawn on
   a <canvas> in the browser — the browser's own text engine does the hard
   part — and this module's only job is turning that canvas into a raster
   image the printer can burn dot-for-dot.

     ESCPOS.build(canvas, opts)         -> Uint8Array, one full copy:
                                            init, image (banded), feed, cut
     ESCPOS.buildJob(canvases, opts)    -> Uint8Array, every copy's full
                                            sequence back to back — one
                                            socket write prints all of them
     ESCPOS.toBase64(bytes)             -> string, for the POST body
   ========================================================================== */

var ESCPOS = (function () {

  /* A few hundred rows per raster block, per the printer's own limits —
     some chokes on one giant image. Printed sequentially, the paper advance
     built into GS v 0 stitches the bands back into one continuous picture;
     nothing here has to track where one band ended. */
  var BAND_ROWS = 256;

  /* Below this luma, a pixel burns.
     ------------------------------------------------------------------------
     128 is the neutral midpoint and it is the WRONG default for a thermal
     head, which is what this comment used to get backwards: it claimed
     anti-aliased text was fine because its edge pixels "land on whichever
     side of 128 they're closer to". True, and beside the point. At 203 dpi a
     small letter is nothing BUT edge pixels — a stem under one dot wide has
     no solid core to land on either side of anything. Half its pixels come
     out grey-150 and are discarded as white paper, and the line prints faint
     and broken while looking perfect on screen. That was live on the shop's
     XP-T80A for every line under 18px.

     A thermal dot also bleeds slightly on contact, so a bitmap that is
     deliberately heavier than neutral is what prints correctly. How much
     heavier depends on the roll, the head's age and the printer's own density
     setting, so the caller passes it: receipt.ink in config, surfaced in
     Settings as Normal / Dark / Darker. This constant stays at 128 as the
     module's own default so nothing that doesn't ask changes behaviour. */
  var BURN_LUMA = 128;

  /* ------------------------------------------------------------- threshold */

  /* 1 canvas px = 1 printer dot, packed 8 horizontal pixels per byte, MSB
     first — exactly what GS v 0 expects. Width must already be a multiple
     of 8; the receipt is drawn at 576px so this always holds. */
  function packBitmap(canvas, burnLuma) {
    var w = canvas.width, h = canvas.height;
    if (w % 8 !== 0) throw new Error('ESCPOS: canvas width must be a multiple of 8, got ' + w);
    var cut = burnLuma || BURN_LUMA;

    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h).data;
    var bytesPerRow = w / 8;
    var out = new Uint8Array(bytesPerRow * h);

    for (var y = 0; y < h; y++) {
      var rowBase = y * w;
      var outRowBase = y * bytesPerRow;
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byte = 0;
        for (var bit = 0; bit < 8; bit++) {
          var x = bx * 8 + bit;
          var i = (rowBase + x) * 4;
          var luma = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
          if (luma < cut) byte |= (1 << (7 - bit));
        }
        out[outRowBase + bx] = byte;
      }
    }

    return { bytesPerRow: bytesPerRow, height: h, data: out };
  }

  /* --------------------------------------------------------------- ESC/POS */

  function initCmd() { return new Uint8Array([0x1B, 0x40]); }               // ESC @

  function rasterCmd(bytesPerRow, rows, slice) {                            // GS v 0
    var head = new Uint8Array([
      0x1D, 0x76, 0x30, 0x00,
      bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
      rows & 0xFF, (rows >> 8) & 0xFF
    ]);
    var out = new Uint8Array(head.length + slice.length);
    out.set(head, 0);
    out.set(slice, head.length);
    return out;
  }

  function feedCmd(lines) { return new Uint8Array([0x1B, 0x64, lines & 0xFF]); }  // ESC d n

  /* GS V 66 = feed & partial cut, GS V 65 = feed & full cut — the paired
     "feed then cut" variants, not the bare immediate-cut codes, so the paper
     clears the cutter before the blade fires. */
  function cutCmd(mode) {
    return new Uint8Array([0x1D, 0x56, mode === 'full' ? 0x41 : 0x42, 0x00]);
  }

  function concatAll(chunks) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    return out;
  }

  /* One full copy: init, the picture in bands, a trailing feed so the footer
     clears the tear bar, then the cut. */
  function build(canvas, opts) {
    opts = opts || {};
    var bmp = packBitmap(canvas, opts.burnLuma);
    var chunks = [initCmd()];

    for (var y = 0; y < bmp.height; y += BAND_ROWS) {
      var rows = Math.min(BAND_ROWS, bmp.height - y);
      var start = y * bmp.bytesPerRow;
      chunks.push(rasterCmd(bmp.bytesPerRow, rows, bmp.data.subarray(start, start + rows * bmp.bytesPerRow)));
    }

    chunks.push(feedCmd(opts.feed === undefined ? 4 : opts.feed));
    chunks.push(cutCmd(opts.cutMode));
    return concatAll(chunks);
  }

  /* Every copy's full sequence, one after another. Sent as one socket write
     so two copies cannot land as two separate connections racing a flaky
     LAN — see server/lib/printer.js. */
  function buildJob(canvases, opts) {
    var chunks = [];
    for (var i = 0; i < canvases.length; i++) chunks.push(build(canvases[i], opts));
    return concatAll(chunks);
  }

  function toBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  return {
    packBitmap: packBitmap,
    build: build,
    buildJob: buildJob,
    toBase64: toBase64
  };
})();
