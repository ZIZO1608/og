/* ==========================================================================
   OG SYSTEM — the launcher's mark
   panel\og.ico  ·  panel\ui\icon.png  ·  panel\ui\qr-logo.png
   --------------------------------------------------------------------------
   The shop's OG mark, white on black, read from panel\og-mark.png — the
   artwork the owner handed over on 25 Sep 2026 and asked to see on the .exe
   and in the middle of the launcher's QR codes. Until then this file drew a
   lime O in arithmetic: a good shape at 16px, and not the shop's mark.

   The artwork is READ, not copied. It is decoded here (node:zlib and the PNG
   format's own five row filters), turned into a mask of white ink — anything
   near black is black and anything near white is white, which takes out the
   speckle a photographed or re-saved logo carries — and averaged down to each
   size BY AREA, so every output pixel is exactly the share of it the mark
   covers. Nothing is installed for this.

   HOW TIGHT. The artwork keeps about a fifth of its side as black margin all
   round: right for a picture, wasteful at 16px, where it leaves the mark ten
   pixels wide. So each size crops to the mark itself plus a margin of its own
   (`fillFor` below — the share of the tile the mark's longer side takes):
   generous where there is room, almost none in the tray and the taskbar.
   The small sizes also get their white pushed a little brighter, because a
   stroke thinner than a pixel otherwise averages to a grey that reads as
   dirt on a dark taskbar.

   WHY BOTH FORMATS IN ONE .ICO. Since Vista an icon entry may be a PNG file
   byte for byte, which is how the 256 is written — a 256x256 BMP is 256 KB of
   an .exe that is otherwise 36, for one size Explorer rarely draws. Every
   other size is a plain BMP, because the tray reads this file through
   System.Drawing.Icon on the .NET Framework that ships with Windows, and that
   reader cannot decode a PNG entry at all: asked for one it throws "Requested
   range extends past the end of the array", and at 64 it quietly hands back a
   blank. Measured here, not assumed — the first draft had PNG down to 64 and
   the check found it. The shell is perfectly happy with PNG, so nothing looked
   wrong until something asked in code.

   The one PNG left is a size .NET is never asked for: the launcher's LoadIcon
   takes whatever `new Icon(path)` chooses, which is the system's 32. Keep it
   that way — a PNG entry at or below 48 puts a blank in the tray.

   Run it from panel\build-exe.ps1 or by hand: node panel/make-icon.js
   To change the mark, replace panel\og-mark.png (a white mark on a black
   ground, at least as big as the largest size written here) and run it again.
   ========================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'og-mark.png');

/* --------------------------------------------------------------------------
   The tile
   --------------------------------------------------------------------------
   Every measurement is a fraction of the icon's own side, so one description
   draws every size. The tile is full-bleed: Windows adds its own padding in
   every place it draws this, and padding baked into the picture on top of
   that is what made the shop's older mark small in its own frame.
   -------------------------------------------------------------------------- */

const TILE_R = 0.22;                  // corner radius — Windows 11's own proportion
const INK = [0xFF, 0xFF, 0xFF];       // the mark, as the artwork has it
const GROUND = [0x00, 0x00, 0x00];    // the artwork's black
const HAIRLINE = [0x2E, 0x2E, 0x33];  // one step above --border

/* The mask. Luminance at or under LO is ground, at or over HI is ink, and the
   anti-aliased edge between them is kept in proportion. */
const LO = 0.10;
const HI = 0.90;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Coverage from a signed distance in PIXELS: inside is negative, and the one
   pixel the edge passes through gets the fraction of itself that is inside. */
const cover = (d) => clamp01(0.5 - d);

/* The distance from a point to a rounded square centred on the canvas. */
function roundedRect(x, y, half, r) {
  const qx = Math.abs(x) - (half - r);
  const qy = Math.abs(y) - (half - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/* Source-over, straight alpha. The canvas starts empty, so this is the whole
   compositor. */
function over(dst, i, rgb, a) {
  if (a <= 0) return;
  const da = dst[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) { dst[i + 3] = 0; return; }
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round((rgb[c] * a + dst[i + c] * da * (1 - a)) / oa);
  }
  dst[i + 3] = Math.round(oa * 255);
}

/* --------------------------------------------------------------------------
   Reading the artwork — a PNG decoder for what a logo is saved as
   --------------------------------------------------------------------------
   Eight bits per channel, not interlaced, any of the five colour types
   (grey, RGB, palette, grey+alpha, RGBA), with a palette's transparency if it
   has one. Anything else is refused by name rather than drawn wrong.
   -------------------------------------------------------------------------- */

function decodePng(buf) {
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (SIG.some((b, i) => buf[i] !== b)) throw new Error('og-mark.png is not a PNG file');

  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8) throw new Error('og-mark.png: only 8 bits per channel is read here (this one is ' + depth + ')');
  if (interlace) throw new Error('og-mark.png: save it without interlacing');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error('og-mark.png: unknown colour type ' + type);
  if (type === 3 && !palette) throw new Error('og-mark.png: a palette image with no palette');

  /* Undo the row filters. Each row starts with a byte saying which of five
     predictors it was written against; at 8 bits "left" is one pixel back. */
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * channels;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let p;
      switch (f) {
        case 0: p = 0; break;
        case 1: p = a; break;
        case 2: p = b; break;
        case 3: p = (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error('og-mark.png: unknown row filter ' + f);
      }
      px[row + x] = (raw[src + x] + p) & 0xFF;
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * channels, d = i * 4;
    if (type === 3) {
      const k = px[s];
      rgba[d] = palette[k * 3]; rgba[d + 1] = palette[k * 3 + 1]; rgba[d + 2] = palette[k * 3 + 2];
      rgba[d + 3] = trns && k < trns.length ? trns[k] : 255;
    } else if (type === 0 || type === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s];
      rgba[d + 3] = type === 4 ? px[s + 1] : 255;
    } else {
      rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2];
      rgba[d + 3] = type === 6 ? px[s + 3] : 255;
    }
  }
  return { w, h, rgba };
}

/* The ink mask and where the mark actually is. A transparent pixel is ground:
   the artwork is a white mark, and whatever is behind it is the tile. */
function readMark(file) {
  const { w, h, rgba } = decodePng(readFileSync(file));
  const ink = new Float32Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lum = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
      const v = clamp01((lum - LO) / (HI - LO)) * (rgba[i * 4 + 3] / 255);
      ink[i] = v;
      if (v >= 0.5) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('og-mark.png has no white mark on it to draw');
  return { w, h, ink, box: { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
}

let MARK = null;
const mark = () => (MARK || (MARK = readMark(SOURCE)));

/* Average the mask over one output pixel's square of the artwork, by area.
   A box filter is separable: across the rows first, then down the columns.
   Off the edge of the artwork is ground. Every size written here is at or
   below the artwork's own resolution, so this only ever shrinks. */
function sampleSquare(m, sx, sy, side, px) {
  const s = side / px;
  /* For each output index, the source cells it overlaps and by how much. */
  const spans = (from) => {
    const out = [];
    for (let o = 0; o < px; o++) {
      const a = from + o * s, b = a + s;
      const cells = [];
      for (let k = Math.floor(a); k < Math.ceil(b); k++) {
        const wgt = Math.min(b, k + 1) - Math.max(a, k);
        if (wgt > 0) cells.push(k, wgt);
      }
      out.push(cells);
    }
    return out;
  };
  const cols = spans(sx), rows = spans(sy);

  const across = new Float32Array(m.h * px);
  for (let y = 0; y < m.h; y++) {
    for (let o = 0; o < px; o++) {
      const cells = cols[o];
      let sum = 0;
      for (let j = 0; j < cells.length; j += 2) {
        const k = cells[j];
        if (k >= 0 && k < m.w) sum += m.ink[y * m.w + k] * cells[j + 1];
      }
      across[y * px + o] = sum / s;
    }
  }
  const out = new Float32Array(px * px);
  for (let o = 0; o < px; o++) {
    const cells = rows[o];
    for (let x = 0; x < px; x++) {
      let sum = 0;
      for (let j = 0; j < cells.length; j += 2) {
        const k = cells[j];
        if (k >= 0 && k < m.h) sum += across[k * px + x] * cells[j + 1];
      }
      out[o * px + x] = clamp01(sum / s);
    }
  }
  return out;
}

/* How much of the tile the mark's longer side takes, per size. */
function fillFor(px) {
  if (px <= 16) return 0.94;
  if (px <= 32) return 0.90;
  if (px <= 64) return 0.80;
  return 0.74;
}

/* --------------------------------------------------------------------------
   Drawing one size
   -------------------------------------------------------------------------- */

function render(px, opts = {}) {
  const m = mark();
  const fill = opts.fill || fillFor(px);
  const bw = m.box.x1 - m.box.x0, bh = m.box.y1 - m.box.y0;
  const side = Math.max(bw, bh) / fill;
  const sx = (m.box.x0 + m.box.x1) / 2 - side / 2;
  const sy = (m.box.y0 + m.box.y1) / 2 - side / 2;
  const ink = sampleSquare(m, sx, sy, side, px);

  /* Brighter white where strokes are thinner than a pixel — see the top. */
  const lift = px <= 24 ? 0.75 : px <= 32 ? 0.85 : 1;

  const out = Buffer.alloc(px * px * 4);      // transparent
  const half = px / 2;
  const tileR = TILE_R * px;
  /* A hairline is one device pixel wherever there are enough of them, and a
     little more on the big sizes so it is not lost to a scaler. The QR logo
     sits on white and needs none. */
  const hair = opts.hairline === false ? 0 : Math.max(1, px / 170);

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      const cx = x + 0.5 - half;      // pixel centres, from the middle
      const cy = y + 0.5 - half;

      /* 1 — the tile. */
      const dTile = roundedRect(cx, cy, half, tileR);
      const aTile = cover(dTile);
      if (aTile <= 0) continue;       // outside the tile there is nothing else
      over(out, i, GROUND, aTile);

      /* 2 — the hairline just inside the edge, so the tile has a shape of its
         own against a dark taskbar rather than dissolving into it. */
      if (hair) over(out, i, HAIRLINE, cover(Math.abs(dTile + hair / 2) - hair / 2) * aTile * 0.9);

      /* 3 — the mark. */
      const a = ink[y * px + x];
      if (a > 0) over(out, i, INK, (lift < 1 ? Math.pow(a, lift) : a) * aTile);
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
   PNG — header, one deflate, three chunks
   -------------------------------------------------------------------------- */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(px, rgba) {
  /* Every row carries a leading filter byte; 0 is "none", and at this size the
     deflate does the work a filter would have set up. */
  const stride = px * 4;
  const raw = Buffer.alloc((stride + 1) * px);
  for (let y = 0; y < px; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8;      // bits per channel
  ihdr[9] = 6;      // colour type 6 = truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------------------
   BMP, the way an .ico wants it
   --------------------------------------------------------------------------
   Two things catch everybody once. The header claims DOUBLE the height,
   because the entry is historically two bitmaps stacked — the colours and a
   1-bit mask — and rows run BOTTOM-UP. At 32 bits the alpha channel is what
   actually decides transparency, so the mask is left at zeros, meaning "every
   pixel of this is the icon".
   -------------------------------------------------------------------------- */

function bmp(px, rgba) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);        // header size
  head.writeInt32LE(px, 4);         // width
  head.writeInt32LE(px * 2, 8);     // height, doubled — see above
  head.writeUInt16LE(1, 12);        // planes
  head.writeUInt16LE(32, 14);       // bits per pixel
  head.writeUInt32LE(0, 16);        // BI_RGB, uncompressed

  const xor = Buffer.alloc(px * px * 4);
  for (let y = 0; y < px; y++) {
    const src = (px - 1 - y) * px * 4;
    for (let x = 0; x < px; x++) {
      const s = src + x * 4;
      const d = (y * px + x) * 4;
      xor[d] = rgba[s + 2];         // B
      xor[d + 1] = rgba[s + 1];     // G
      xor[d + 2] = rgba[s];         // R
      xor[d + 3] = rgba[s + 3];     // A
    }
  }

  const maskRow = ((px + 31) >> 5) * 4;   // 1bpp rows are padded to 4 bytes
  const and = Buffer.alloc(maskRow * px);
  head.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([head, xor, and]);
}

/* --------------------------------------------------------------------------
   The files
   -------------------------------------------------------------------------- */

const SIZES = [
  { px: 256, kind: 'png' },   // Explorer's largest, and the .exe's face in a listing
  { px: 64, kind: 'bmp' },    // large icons on a 150% screen
  { px: 48, kind: 'bmp' },    // the desktop
  { px: 32, kind: 'bmp' },    // the tray, alt-tab, title bars — what LoadIcon gets
  { px: 24, kind: 'bmp' },    // the taskbar at 150%
  { px: 16, kind: 'bmp' }     // the taskbar, the size that matters most and is drawn least
];
/* 128 is deliberately absent: it would be 66 KB of BMP, and Windows scaling
   the 256 down to it is indistinguishable from drawing it. */

/* The middle of the launcher's QR codes (QR_LOGO in panel\ui\panel.js). The
   largest code is the full-screen one, 960 CSS px with the logo at 18% of it,
   so 256 keeps the mark sharp there without going past the artwork's own
   size. It sits on the code's white square, so it wants no hairline, and the
   mark fills more of it, because it is small on the code. */
const QR_LOGO_PX = 256;
const QR_LOGO_FILL = 0.80;

function build() {
  const images = SIZES.map((s) => {
    const rgba = render(s.px);
    return { px: s.px, bytes: s.kind === 'png' ? png(s.px, rgba) : bmp(s.px, rgba) };
  });

  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);              // reserved
  head.writeUInt16LE(1, 2);              // 1 = icon
  head.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  /* Offsets are absolute from the start of the file, so the directory has to
     know its own length before any of them can be written. */
  let at = head.length + dir.length;

  images.forEach((img, i) => {
    const o = i * 16;
    /* 256 is written as 0 — a byte cannot hold it, and that is the format's
       own convention rather than a trick. */
    dir[o] = img.px >= 256 ? 0 : img.px;      // width
    dir[o + 1] = img.px >= 256 ? 0 : img.px;  // height
    dir[o + 2] = 0;                           // palette: none, it is truecolour
    dir[o + 3] = 0;                           // reserved
    dir.writeUInt16LE(1, o + 4);              // colour planes
    dir.writeUInt16LE(32, o + 6);             // bits per pixel
    dir.writeUInt32LE(img.bytes.length, o + 8);
    dir.writeUInt32LE(at, o + 12);
    at += img.bytes.length;
  });

  writeFileSync(join(HERE, 'og.ico'), Buffer.concat([head, dir, ...images.map((i) => i.bytes)]));

  /* The same mark as the panel window's favicon. Edge in --app mode takes the
     page's icon for its taskbar button, and with no icon on the page that
     button was the browser's grey globe — the launcher's own window looking
     like a stray tab. It is written beside the window's other files rather
     than into assets\, which belongs to the shop and the phone home screen. */
  writeFileSync(join(HERE, 'ui', 'icon.png'), png(128, render(128)));

  writeFileSync(join(HERE, 'ui', 'qr-logo.png'),
    png(QR_LOGO_PX, render(QR_LOGO_PX, { fill: QR_LOGO_FILL, hairline: false })));

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('  panel\\og.ico         —  ' + SIZES.map((s) => s.px).join(', ') +
              '  (' + kb(at) + ')');
  console.log('  panel\\ui\\icon.png    —  128px, the window\'s favicon');
  console.log('  panel\\ui\\qr-logo.png —  ' + QR_LOGO_PX + 'px, the middle of the QR codes');
}

/* Exported so the mark can be drawn at a size nothing here writes — a contact
   sheet at 16px to check it still reads, which is the only way to judge a
   taskbar icon and cannot be done by looking at the 256.

   The writing is behind the is-this-the-main-module check for exactly that
   reason: a preview script that imports `render` must not silently rewrite the
   icon it was opened to look at. */
export { render, png, bmp, build, decodePng };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
