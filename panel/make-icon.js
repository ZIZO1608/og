/* ==========================================================================
   OG SYSTEM — panel\og.ico from the PWA icon
   --------------------------------------------------------------------------
   The repo has no .ico and should not gain a second copy of the mark that
   somebody has to remember to update. assets/icon-512.png is already the
   app's icon everywhere else, so the .ico is built from it.

   An ICO is a six-byte header, a sixteen-byte directory entry per image, and
   then the images. Since Windows Vista an entry may be a PNG file byte for
   byte rather than a DIB, which is the whole reason this is twenty lines and
   not an image library: the PNG is copied in unchanged.

   Zero dependencies, like everything else here. Run it from panel\build-exe.ps1
   or by hand: node panel/make-icon.js
   ========================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SOURCES = [
  /* Largest first is not required, but it is what every other tool writes and
     it keeps the file readable in a hex dump. */
  { file: join(ROOT, 'assets', 'icon-512.png'), px: 256 },
  { file: join(ROOT, 'assets', 'icon-192.png'), px: 192 }
];

const images = [];
for (const s of SOURCES) {
  try { images.push({ px: s.px, bytes: readFileSync(s.file) }); }
  catch (e) { console.log('  skipped ' + s.file + ' — ' + e.message); }
}

if (!images.length) {
  console.error('  No source PNG found in assets/. Nothing written.');
  process.exit(1);
}

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

const out = join(HERE, 'og.ico');
writeFileSync(out, Buffer.concat([head, dir, ...images.map((i) => i.bytes)]));
console.log('  panel\\og.ico  —  ' + images.map((i) => i.px + 'px').join(', '));
