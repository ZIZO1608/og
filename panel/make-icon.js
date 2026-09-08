/* ==========================================================================
   OG SYSTEM — the launcher's mark  ·  panel\og.ico + panel\ui\icon.png
   --------------------------------------------------------------------------
   The O, in the shop's lime on the shop's near-black, drawn here rather than
   copied from a picture. It used to repackage assets\icon-512.png, which is
   the brush-drawn OG mark on a black square with black padding around it —
   right on a phone home screen at 192px, and a dark smudge at the 16px the
   Windows taskbar actually asks for. A taskbar icon is a different job from
   an app icon and needs its own drawing, not the same one made smaller.

   Nothing is installed for this. The shapes are circles and a rounded square,
   which have exact distance functions, so a pixel's coverage is arithmetic and
   the edges come out smooth without a single sample being taken twice. PNG is
   node:zlib plus four CRC32s. The BMP is the format's own 1990s layout.

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
   ========================================================================== */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------------------
   The mark
   --------------------------------------------------------------------------
   Every measurement is a fraction of the icon's own side, so one description
   draws all seven sizes. The tile is full-bleed: Windows adds its own padding
   in every place it draws this, and padding baked into the picture on top of
   that is what made the old mark small in its own frame.
   -------------------------------------------------------------------------- */

const TILE_R = 0.22;          // corner radius — Windows 11's own proportion
const RING_MID = 0.2695;      // centre of the stroke, from the middle
const RING_HALF = 0.0586;     // half the stroke's width

/* Under about 32px a stroke this fine is a grey suggestion rather than a lime
   ring: less than two pixels, and the anti-aliasing spends most of it. The
   small sizes get a heavier ring — the same trick a type designer calls a
   hinted weight, and the reason the icon still reads in a crowded taskbar. */
const SMALL_HALF = 0.0700;

const LIME = [0xC6, 0xFF, 0x00];
const TILE_TOP = [0x16, 0x16, 0x1A];    // --card, lifted
const TILE_BOTTOM = [0x0A, 0x0A, 0x0B]; // --app
const HAIRLINE = [0x2E, 0x2E, 0x33];    // one step above --border

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
   compositor: four of these and the icon is drawn. */
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

function render(px) {
  const out = Buffer.alloc(px * px * 4);      // transparent
  const half = px / 2;
  const ringMid = RING_MID * px;
  const ringHalf = (px <= 32 ? SMALL_HALF : RING_HALF) * px;
  const ringOuter = ringMid + ringHalf;
  const tileR = TILE_R * px;

  /* A hairline is one device pixel wherever there are enough of them, and a
     little more on the big sizes so it is not lost to a scaler. */
  const hair = Math.max(1, px / 170);

  /* The lime lifts off the tile at the sizes somebody actually looks at — the
     Start menu, the desktop, a file listing. Below 48 it would be a green haze
     around a ring two pixels wide, so it is simply not drawn. */
  const glow = px >= 48;
  const glowFall = 0.055 * px;

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      const cx = x + 0.5 - half;      // pixel centres, from the middle
      const cy = y + 0.5 - half;

      /* 1 — the tile, a vertical lift from --card to --app. */
      const dTile = roundedRect(cx, cy, half, tileR);
      const aTile = cover(dTile);
      if (aTile <= 0) continue;       // outside the tile there is nothing else
      const t = y / (px - 1 || 1);
      const tile = [
        Math.round(TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t),
        Math.round(TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t),
        Math.round(TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t)
      ];
      over(out, i, tile, aTile);

      /* 2 — the hairline just inside the edge, so the tile has a shape of its
         own against a dark taskbar rather than dissolving into it. */
      const aHair = cover(Math.abs(dTile + hair / 2) - hair / 2) * aTile;
      over(out, i, HAIRLINE, aHair * 0.9);

      /* 3 — the halo, outside the ring only. Inside would fill the counter,
         and a filled counter is not an O any more. */
      const r = Math.hypot(cx, cy);
      if (glow && r > ringOuter) {
        over(out, i, LIME, 0.14 * Math.exp(-(r - ringOuter) / glowFall) * aTile);
      }

      /* 4 — the O. */
      over(out, i, LIME, cover(Math.abs(r - ringMid) - ringHalf) * aTile);
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
   The file
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
     than into assets\, because assets\ is the SHOP's mark and this one is the
     launcher's. */
  writeFileSync(join(HERE, 'ui', 'icon.png'), png(128, render(128)));

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('  panel\\og.ico     —  ' + SIZES.map((s) => s.px).join(', ') +
              '  (' + kb(at) + ')');
  console.log('  panel\\ui\\icon.png —  128px, the window\'s favicon');
}

/* Exported so the mark can be drawn at a size nothing here writes — a contact
   sheet at 16px to check it still reads, which is the only way to judge a
   taskbar icon and cannot be done by looking at the 256.

   The writing is behind the is-this-the-main-module check for exactly that
   reason: a preview script that imports `render` must not silently rewrite the
   icon it was opened to look at. */
export { render, png, bmp, build };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
