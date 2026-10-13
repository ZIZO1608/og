/* A print font made from a picture of its letters (lib/letterfont.js): the
   letters found in order across lines, a letter in two pieces kept as one,
   specks dropped, a hole turned the other way from its outline, the font
   file whole (every checksum, cmap, lower case, the stand-in marks), and
   every refusal. Pictures drawn in memory; no browser, no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as LF from '../lib/letterfont.js';
import * as W2 from '../lib/woff2.js';

/* A white page with black rectangles on it. */
function page(w, h, rects) {
  const ink = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1, hole] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * w + x] = hole ? 0 : 1;
  }
  return { w, h, bits: LF.pack(w, h, ink) };
}

/* Line 1: an O (a ring), an I (a bar), a J in two stacked pieces;
   line 2: an L, a 1 and a speck; letters 100 px tall. */
const SHEET = page(700, 320, [
  [20, 20, 100, 120], [45, 45, 75, 95, true],           // O, its hole
  [140, 20, 170, 120],                                  // I
  [210, 20, 260, 60], [210, 70, 260, 120],              // J in two pieces, one above the other
  [20, 180, 50, 280], [50, 250, 100, 280],              // L
  [140, 180, 170, 280],                                 // 1
  [400, 300, 402, 302]                                  // a speck
]);

const area = (pts) => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

test('the letters are found line by line, left to right, and named in that order', () => {
  const s = LF.readSheet({ ...SHEET, order: 'O I J L 1' });
  const sum = LF.summary(s);
  assert.equal(sum.lines, 2);
  assert.equal(sum.glyphs.length, 5, 'the speck is dropped and J is one letter');
  assert.deepEqual(sum.glyphs.map((g) => g.char), ['O', 'I', 'J', 'L', '1']);
  assert.equal(sum.capPx, 100);
  assert.deepEqual(sum.missing, []);
  assert.equal(sum.extra, 0);
});

test('fewer characters than letters, and more: both said', () => {
  const short = LF.summary(LF.readSheet({ ...SHEET, order: 'OIJ' }));
  assert.equal(short.extra, 2);
  assert.deepEqual(short.glyphs.map((g) => g.char), ['O', 'I', 'J', null, null]);
  const long = LF.summary(LF.readSheet({ ...SHEET, order: 'OIJL1XY' }));
  assert.deepEqual(long.missing, ['X', 'Y']);
  assert.deepEqual(LF.summary(LF.readSheet({ ...SHEET, order: 'OIOL1' })).doubled, ['O']);
});

test('an outline runs clockwise and its hole the other way, standing on the baseline at CAP height', () => {
  const s = LF.readSheet({ ...SHEET, order: 'OIJL1' });
  const o = LF.glyphFor(s, s.glyphs[0]);
  assert.equal(o.contours.length, 2);
  const [outer, hole] = o.contours.slice().sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  assert.ok(area(outer) < 0, 'outer clockwise (y up)');
  assert.ok(area(hole) > 0, 'hole counter-clockwise');
  assert.equal(outer.length, 4, 'a square stays four corners');
  const ys = outer.map((p) => p[1]);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 700);
  assert.equal(LF.glyphFor(s, s.glyphs[2]).contours.length, 2, 'J keeps both pieces');
});

test('the font file is whole: checksums, its name, every character mapped, lower case and the marks', () => {
  const s = LF.readSheet({ ...SHEET, order: 'OIJL1' });
  const font = LF.makeFont(s, 'Club Test');
  assert.equal(W2.sniff(font), 'ttf');
  assert.equal(W2.familyName(font), 'Club Test');
  const { tables } = W2.readSfnt(font);
  assert.deepEqual(tables.map((t) => t.tag).sort(),
    ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
  /* the whole file sums to the magic number */
  let sum = 0;
  const p = Buffer.alloc((font.length + 3) & ~3); font.copy(p);
  for (let i = 0; i < p.length; i += 4) sum = (sum + p.readUInt32BE(i)) >>> 0;
  assert.equal(sum, 0xB1B0AFBA);
  /* cmap format 4: every code a segment of its own */
  const cmap = tables.find((t) => t.tag === 'cmap').data;
  const sub = cmap.subarray(12);
  const sc = sub.readUInt16BE(6) / 2;
  const codes = [];
  for (let i = 0; i < sc; i++) codes.push(sub.readUInt16BE(14 + 2 * i));
  for (const ch of ' -.\'1IJLOijlo') assert.ok(codes.includes(ch.charCodeAt(0)), `maps ${JSON.stringify(ch)}`);
  assert.ok(W2.encode(font).length > 0);
});

test('refusals', () => {
  assert.throws(() => LF.readSheet(page(100, 100, [])), (e) => e.code === 'no_letters');
  assert.throws(() => LF.readSheet({ w: 8, h: 8, bits: '' }), (e) => e.code === 'bad_picture');
  assert.throws(() => LF.readSheet({ w: 100, h: 100, bits: 'AAAA' }), (e) => e.code === 'bad_picture');
  assert.throws(() => LF.readSheet({ ...SHEET, order: 'OIJé' }), (e) => e.code === 'bad_order');
  assert.throws(() => LF.readSheet(page(200, 100, [[10, 10, 15, 18], [30, 10, 35, 18]])), (e) => e.code === 'too_small');
  assert.equal(LF.orderOf('').join(''), LF.DEFAULT_ORDER);
  assert.equal(LF.orderOf(' a b ').join(''), 'AB');
});
