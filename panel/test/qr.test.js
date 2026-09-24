// cd panel && npm test
//
// THE QR CODES OPEN WHAT THE WORDS UNDER THEM SAY.
//
// The panel draws its codes with js/codes.js, the shop's own encoder (no second
// one was written). This test does not trust that encoder to check itself: it
// carries a small, INDEPENDENT decoder written from ISO/IEC 18004 — format
// bits, the eight masks, the zig-zag walk, block de-interleaving, a
// Reed-Solomon syndrome check over GF(256), byte-mode parsing — and reads every
// code back to its text. It then puts the panel's centre logo over the symbol
// and counts, block by block, how many codewords it can hide, against what
// error-correction level H can repair. A phone that cannot read the code on the
// counter is the one failure nobody would think to test for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrPayloads, shopUrl, publicLink } from '../lib/links.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/* js/codes.js is a browser script declaring `var Codes`; run it as one. */
const ctx = vm.createContext({});
vm.runInContext(readFileSync(join(ROOT, 'js', 'codes.js'), 'utf8'), ctx);
const Codes = ctx.Codes;

/* ------------------------------------------------------ the decoder */

const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
function formatWord(ecl, mask) {
  const data = (EC_BITS[ecl] << 3) | mask;
  let v = data << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data << 10) | v) ^ 0x5412;
}

/* The top-left copy, read in the order the standard (and zxing) reads it. */
function readFormat(m) {
  let v = 0;
  const push = (r, c) => { v = (v << 1) | (m[r][c] ? 1 : 0); };
  for (let c = 0; c <= 5; c++) push(8, c);
  push(8, 7); push(8, 8); push(7, 8);
  for (let r = 5; r >= 0; r--) push(r, 8);
  for (const ecl of 'LMQH') for (let mask = 0; mask < 8; mask++) if (formatWord(ecl, mask) === v) return { ecl, mask };
  return null;
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0
];

const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

/* Which modules are NOT data: finders with their separators and the format
   areas, the timing lines, alignment patterns, version blocks. */
function functionMap(v) {
  const n = v * 4 + 17;
  const f = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) f[r][c] = true;
  };
  mark(0, 0, 9, 9); mark(0, n - 8, 9, 8); mark(n - 8, 0, 8, 9);
  mark(6, 0, 1, n); mark(0, 6, n, 1);
  for (const r of ALIGN[v]) for (const c of ALIGN[v]) {
    if ((r < 9 && c < 9) || (r < 9 && c > n - 10) || (r > n - 10 && c < 9)) continue;
    mark(r - 2, c - 2, 5, 5);
  }
  if (v >= 7) { mark(0, n - 11, 6, 3); mark(n - 11, 0, 3, 6); }
  return f;
}

/* The data modules in reading order, unmasked, each with where it sits. */
function walk(m, f, mask) {
  const n = m.length;
  const bits = [];
  let up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (let d = 0; d < 2; d++) {
        const c = right - d;
        if (f[r][c]) continue;
        bits.push({ r, c, bit: (m[r][c] ? 1 : 0) ^ (MASKS[mask](r, c) ? 1 : 0) });
      }
    }
    up = !up;
  }
  return bits;
}

/* [EC codewords per block, [[blocks, data codewords each], ...]] — ISO 18004 table 9. */
const BLOCKS = {
  1: { L: [7, [[1, 19]]], M: [10, [[1, 16]]], Q: [13, [[1, 13]]], H: [17, [[1, 9]]] },
  2: { L: [10, [[1, 34]]], M: [16, [[1, 28]]], Q: [22, [[1, 22]]], H: [28, [[1, 16]]] },
  3: { L: [15, [[1, 55]]], M: [26, [[1, 44]]], Q: [18, [[2, 17]]], H: [22, [[2, 13]]] },
  4: { L: [20, [[1, 80]]], M: [18, [[2, 32]]], Q: [26, [[2, 24]]], H: [16, [[4, 9]]] },
  5: { L: [26, [[1, 108]]], M: [24, [[2, 43]]], Q: [18, [[2, 15], [2, 16]]], H: [22, [[2, 11], [2, 12]]] },
  6: { L: [18, [[2, 68]]], M: [16, [[4, 27]]], Q: [24, [[4, 19]]], H: [28, [[4, 15]]] },
  7: { L: [20, [[2, 78]]], M: [18, [[4, 31]]], Q: [18, [[2, 14], [4, 15]]], H: [26, [[4, 13], [1, 14]]] },
  8: { L: [24, [[2, 97]]], M: [22, [[2, 38], [2, 39]]], Q: [22, [[4, 18], [2, 19]]], H: [26, [[4, 14], [2, 15]]] },
  9: { L: [30, [[2, 116]]], M: [22, [[3, 36], [2, 37]]], Q: [20, [[4, 16], [4, 17]]], H: [24, [[4, 12], [4, 13]]] },
  10: { L: [18, [[2, 68], [2, 69]]], M: [26, [[4, 43], [1, 44]]], Q: [24, [[6, 19], [2, 20]]], H: [28, [[6, 15], [2, 16]]] }
};
const TOTAL = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };

/* Codeword index -> { block, data }, and the blocks themselves. */
function deinterleave(cw, [ec, groups]) {
  const blocks = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) blocks.push({ len, data: [], ec: [] });
  const owner = [];
  const most = Math.max(...blocks.map((b) => b.len));
  let k = 0;
  for (let i = 0; i < most; i++) blocks.forEach((b, bi) => { if (i < b.len) { owner[k] = bi; b.data.push(cw[k++]); } });
  for (let i = 0; i < ec; i++) blocks.forEach((b, bi) => { owner[k] = bi; b.ec.push(cw[k++]); });
  return { blocks, owner };
}

const EXP = new Array(512);
const LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/* A valid block evaluates to zero at alpha^0 .. alpha^(ec-1). */
function syndromesZero(b) {
  const c = b.data.concat(b.ec);
  for (let s = 0; s < b.ec.length; s++) {
    let acc = 0;
    for (const v of c) acc = gmul(acc, EXP[s]) ^ v;
    if (acc !== 0) return false;
  }
  return true;
}

function decode(qr) {
  const m = qr.modules;
  const n = m.length;
  const v = (n - 17) / 4;
  const fmt = readFormat(m);
  assert.ok(fmt, 'format information reads back');
  const f = functionMap(v);
  const bits = walk(m, f, fmt.mask);
  const spec = BLOCKS[v][fmt.ecl];
  const [ec, groups] = spec;
  assert.equal(groups.reduce((s, [c, l]) => s + c * (l + ec), 0), TOTAL[v], 'the block table adds up');
  assert.ok(bits.length >= TOTAL[v] * 8, 'enough data modules for every codeword');
  const cw = [];
  for (let k = 0; k < TOTAL[v]; k++) {
    let b = 0;
    for (let i = 0; i < 8; i++) b = (b << 1) | bits[k * 8 + i].bit;
    cw.push(b);
  }
  const { blocks, owner } = deinterleave(cw, spec);
  const stream = [];
  for (const b of blocks) stream.push(...b.data);
  const sbits = [];
  for (const b of stream) for (let i = 7; i >= 0; i--) sbits.push((b >> i) & 1);
  let p = 0;
  const take = (k) => { let x = 0; for (let i = 0; i < k; i++) x = (x << 1) | sbits[p++]; return x; };
  const mode = take(4);
  const count = take(v < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(take(8));
  return {
    version: v, ecl: fmt.ecl, mask: fmt.mask, mode, ec, blocks, owner, bits, f,
    text: Buffer.from(bytes).toString('utf8'),
    rsOk: blocks.every(syndromesZero)
  };
}

/* ---------------------------------------------------- what the panel draws */

/* The addresses the Shop screen can put in a code, as the panel builds them. */
const PAYLOADS = [
  shopUrl('10.10.99.9', { secure: true, httpsPort: 8443 }),
  shopUrl('10.10.99.14', { secure: true, httpsPort: 8443 }),
  shopUrl('192.168.1.11', { secure: true, httpsPort: 8443 }),
  shopUrl('172.20.10.2', { secure: false, httpPort: 8090 }),
  publicLink('').url,
  publicLink('https://shop.ogsports1.com/').url,
  'https://shop.a-much-longer-name-for-the-shop.example.com'
];

test('every address the panel can put in a code decodes back to exactly itself', () => {
  for (const text of PAYLOADS) {
    const qr = Codes.qrMatrix(text);
    assert.ok(qr, `${text} fits in a code`);
    const d = decode(qr);
    assert.equal(d.mode, 0b0100, 'byte mode');
    assert.equal(d.text, text);
    assert.equal(d.ecl, 'H', `${text}: error correction H — the headroom the logo spends`);
    assert.equal(d.ecl, qr.ecc);
    assert.equal(d.version, qr.version);
    assert.ok(d.rsOk, `${text}: every Reed-Solomon block checks out`);
  }
});

test('qrPayloads hands the encoder exactly the words printed under the code', () => {
  const p = qrPayloads({ lan: { url: PAYLOADS[0] }, public: { url: PAYLOADS[4] } });
  assert.equal(decode(Codes.qrMatrix(p.wifi)).text, 'https://10.10.99.9:8443');
  assert.equal(decode(Codes.qrMatrix(p.public)).text, 'https://shop.ogsports1.com');
});

test('the decoder is a real check: it goes red on a code for something else', () => {
  const d = decode(Codes.qrMatrix('https://10.10.99.9:8443'));
  assert.notEqual(d.text, 'https://10.10.99.14:8443');
  /* flip one data codeword and the Reed-Solomon check must notice */
  const qr = Codes.qrMatrix('https://10.10.99.9:8443');
  const m = qr.modules.map((row) => row.slice());
  const first = d.bits[0];
  m[first.r][first.c] = m[first.r][first.c] ? 0 : 1;
  assert.equal(decode({ modules: m }).rsOk, false);
});

/* The logo ratios the window asks for — read from the window's own source, so
   a bigger logo added next year is tested at its real size. */
function uiLogoRatios() {
  const src = readFileSync(join(ROOT, 'panel', 'ui', 'panel.js'), 'utf8');
  return [...src.matchAll(/logoRatio:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

test('the centre logo can never hide more than error correction H repairs', () => {
  const ratios = uiLogoRatios();
  assert.ok(ratios.length, 'the window draws its codes with a logo ratio this test can read');
  const quiet = 4;
  for (const ratio of ratios) {
    for (const text of PAYLOADS) {
      const qr = Codes.qrMatrix(text);
      const d = decode(qr);
      const n = qr.size;
      const total = n + quiet * 2;
      /* the logo's white backing square, exactly as js/codes.js draws it */
      const lw = total * Math.min(ratio, 0.26);
      const lo = (total - lw) / 2 - 0.5;
      const hi = lo + lw + 1;
      const hidden = new Map();   // block -> set of codeword indexes
      d.bits.forEach((b, i) => {
        const x0 = b.c + quiet, y0 = b.r + quiet;
        if (x0 + 1 <= lo || x0 >= hi || y0 + 1 <= lo || y0 >= hi) return;
        const k = Math.floor(i / 8);
        if (k >= TOTAL[d.version]) return;   // remainder bits carry nothing
        const blk = d.owner[k];
        if (!hidden.has(blk)) hidden.set(blk, new Set());
        hidden.get(blk).add(k);
      });
      /* finder patterns must stay clear, or nothing is found to read at all */
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const inFinder = (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
        if (!inFinder) continue;
        const x0 = c + quiet, y0 = r + quiet;
        assert.ok(x0 + 1 <= lo || x0 >= hi || y0 + 1 <= lo || y0 >= hi, `${text}: the logo covers a finder`);
      }
      const canFix = Math.floor(d.ec / 2);
      for (const [blk, set] of hidden) {
        assert.ok(set.size <= canFix,
          `${text} at logo ${ratio}: block ${blk} loses ${set.size} codewords, H repairs ${canFix}`);
      }
    }
  }
});

test('the SVG on screen is the matrix that was decoded', () => {
  const text = 'https://10.10.99.9:8443';
  const qr = Codes.qrMatrix(text);
  const svg = Codes.qrSVG(text, { size: 240 });
  assert.match(svg, /shape-rendering="crispEdges"/, 'square modules, drawn crisp');
  const n = qr.size;
  const quiet = 4;
  assert.match(svg, new RegExp('viewBox="0 0 ' + (n + 2 * quiet) + ' ' + (n + 2 * quiet) + '"'), 'a four-module quiet zone');
  const drawn = new Set([...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"\/>/g)].map((m) => (m[2] - quiet) + ',' + (m[1] - quiet)));
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (inFinder(r, c)) continue;
    assert.equal(drawn.has(r + ',' + c), !!qr.modules[r][c], `module ${r},${c}`);
  }
});
