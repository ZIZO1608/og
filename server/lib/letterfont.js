/* ==========================================================================
   OG SYSTEM — a print font made from a picture of its letters  [letterfont.js]
   --------------------------------------------------------------------------
   Yalla Wear's way to a club's lettering: a picture of it (a photo, or a
   sheet a picture tool drew), the letters dark on light, in rows. This turns
   that picture into a real TrueType font, so it travels the ordinary road a
   font travels here — WOFF2, the print-fonts bucket, a kit, the website —
   and nothing downstream knows it began as a picture.

     1. THE BROWSER sends the picture as ONE BIT A PIXEL (ink or paper), the
        threshold already chosen there (Otsu, light-on-dark turned round),
        packed most significant bit first, at most MAX_SIDE a side.
     2. readSheet(): the ink is split into pieces (8-connected), specks are
        dropped, pieces stacked in one column are joined (a letter drawn in
        two strokes), the pieces are put into lines top to bottom and read
        left to right, and each is given the next character of the order the
        person says the picture shows (A–Z then 0–9 unless told otherwise).
     3. glyphFor(): each letter's outline is traced off its pixel edges
        (holes come out turned the other way by themselves), the staircase is
        straightened (Ramer–Douglas–Peucker), and the outline is scaled so the
        letters' common height is CAP units, standing on each line's baseline.
     4. ttf(): the font file — the ten tables a browser wants, written by hand.
        A space, and a hyphen, a full stop and an apostrophe when the picture
        has none (a shirt's name may carry all three); lower case points at
        the capitals.

   Pure: no database, no network. lib/printkits.js stores what this makes.
   ========================================================================== */

export const DEFAULT_ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const MAX_SIDE = 2400;
const UPM = 1000;
const CAP = 700;
const SIDE = 40;          // space either side of a letter
const SPACE = 260;        // the width of a space
const MAX_PIECES = 600;

const fail = (message, code = 'bad_picture', status = 400) => Object.assign(new Error(message), { code, status });

/* ------------------------------------------------------------ the picture */

export function unpack({ w, h, bits }) {
  w = Number(w); h = Number(h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > MAX_SIDE || h > MAX_SIDE) {
    throw fail('the picture is not a size this takes');
  }
  const buf = Buffer.from(String(bits || ''), 'base64');
  if (buf.length < Math.ceil((w * h) / 8)) throw fail('the picture did not arrive whole');
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = (buf[i >> 3] >> (7 - (i & 7))) & 1;
  return { w, h, ink };
}

/* The other way round, for the tests and for a caller holding pixels. */
export function pack(w, h, ink) {
  const buf = Buffer.alloc(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (ink[i]) buf[i >> 3] |= 1 << (7 - (i & 7));
  return buf.toString('base64');
}

function pieces(img) {
  const { w, h, ink } = img;
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || label[i] !== -1) continue;
    const id = out.length;
    let sp = 0;
    stack[sp++] = i; label[i] = id;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((!dx && !dy) || nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (ink[q] && label[q] === -1) { label[q] = id; stack[sp++] = q; }
        }
      }
    }
    out.push({ ids: [id], x0, y0, x1, y1, n });
  }
  return { label, out };
}

const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/* The order the person says the picture shows: spaces ignored, letters made
   capitals, only characters a shirt can carry. */
export function orderOf(text) {
  const t = String(text == null || text === '' ? DEFAULT_ORDER : text).replace(/\s+/g, '').toUpperCase();
  const chars = Array.from(t);
  const bad = chars.filter((c) => !/^[\x21-\x7E]$/.test(c));
  if (bad.length) throw fail(`the order has characters a shirt cannot carry: ${[...new Set(bad)].join(' ')}`, 'bad_order');
  if (!chars.length || chars.length > 80) throw fail('say which letters the picture shows, in order', 'bad_order');
  return chars;
}

export function readSheet({ w, h, bits, order }) {
  const img = unpack({ w, h, bits });
  const chars = orderOf(order);
  const { label, out } = pieces(img);
  if (!out.length) throw fail('there is no ink in the picture', 'no_letters');
  if (out.length > MAX_PIECES * 4) throw fail('the picture is too busy — letters on a plain background, please', 'too_busy');

  /* Specks: against the bigger pieces, not the median, which a dusty photo
     drags down. A full stop is a few per cent of a letter and survives. */
  const sizes = out.map((p) => p.n).sort((a, b) => a - b);
  const big = sizes[Math.floor(sizes.length * 0.9)] || sizes[sizes.length - 1];
  let g = out.filter((p) => p.n >= Math.max(6, big * 0.004));
  if (g.length > MAX_PIECES) throw fail('the picture is too busy — letters on a plain background, please', 'too_busy');

  /* Pieces stacked in one column belong to one letter. */
  const mh = median(g.map((p) => p.y1 - p.y0 + 1));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
        const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
        if (ov >= narrow * 0.6 && gap <= mh * 0.35) {
          g[i] = { ids: a.ids.concat(b.ids), x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
                   x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), n: a.n + b.n };
          g.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  /* Lines, top to bottom; a piece belongs to the line its middle falls in. */
  g.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const lines = [];
  for (const p of g) {
    const cy = (p.y0 + p.y1) / 2;
    const line = lines.find((l) => cy >= l.y0 && cy <= l.y1);
    if (line) { line.items.push(p); line.y0 = Math.min(line.y0, p.y0); line.y1 = Math.max(line.y1, p.y1); }
    else lines.push({ y0: p.y0, y1: p.y1, items: [p] });
  }
  lines.sort((a, b) => a.y0 - b.y0);
  for (const l of lines) {
    l.items.sort((a, b) => a.x0 - b.x0);
    const tallest = Math.max(...l.items.map((p) => p.y1 - p.y0 + 1));
    l.tall = l.items.filter((p) => p.y1 - p.y0 + 1 >= tallest * 0.5);
    l.base = median(l.tall.map((p) => p.y1 + 1));
  }
  const capPx = median(lines.flatMap((l) => l.tall.map((p) => p.y1 - p.y0 + 1)));
  if (capPx < 12) throw fail('the letters are too small in the picture — use a bigger picture', 'too_small');

  const glyphs = [];
  lines.forEach((l, li) => l.items.forEach((p) => {
    glyphs.push({ ...p, line: li, base: l.base, char: chars[glyphs.length] ?? null });
  }));
  const got = new Set(glyphs.map((x) => x.char).filter(Boolean));
  return {
    img, label, capPx, glyphs,
    lines: lines.length,
    missing: chars.filter((c, i) => i >= glyphs.length && !got.has(c)),
    extra: Math.max(0, glyphs.length - chars.length),
    doubled: [...new Set(chars.filter((c, i) => chars.indexOf(c) !== i))]
  };
}

/* What the screen is shown: a box and a character per letter found. */
export function summary(sheet) {
  return {
    capPx: sheet.capPx, lines: sheet.lines, missing: sheet.missing, extra: sheet.extra, doubled: sheet.doubled,
    glyphs: sheet.glyphs.map((x) => ({ x: x.x0, y: x.y0, w: x.x1 - x.x0 + 1, h: x.y1 - x.y0 + 1, line: x.line, char: x.char }))
  };
}

/* ---------------------------------------------------------- the outlines */

/* Every pixel side between ink and paper becomes an edge, directed so the
   ink is always on the same hand; edges chained into loops give the outer
   outline one way round and every hole the other — which is what a font's
   fill rule needs, with no "is this a hole" question asked. */
function trace(sheet, gl) {
  const { img, label } = sheet;
  const ids = new Set(gl.ids);
  const cw = gl.x1 - gl.x0 + 1, ch = gl.y1 - gl.y0 + 1;
  const on = (x, y) => x >= 0 && y >= 0 && x < cw && y < ch && ids.has(label[(gl.y0 + y) * img.w + gl.x0 + x]);
  const VW = cw + 1;
  const nxt = [new Int32Array(VW * (ch + 1)).fill(-1), new Int32Array(VW * (ch + 1)).fill(-1)];
  const add = (ax, ay, bx, by) => {
    const a = ay * VW + ax, b = by * VW + bx;
    if (nxt[0][a] === -1) nxt[0][a] = b; else nxt[1][a] = b;
  };
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x + 1, y, x, y);
      if (!on(x - 1, y)) add(x, y, x, y + 1);
      if (!on(x, y + 1)) add(x, y + 1, x + 1, y + 1);
      if (!on(x + 1, y)) add(x + 1, y + 1, x + 1, y);
    }
  }
  const loops = [];
  for (let s = 0; s < nxt[0].length; s++) {
    while (nxt[0][s] !== -1) {
      const pts = [];
      let v = s, px = -1, py = -1;
      for (let guard = 0; guard < 4 * VW * (ch + 1); guard++) {
        const vx = v % VW, vy = (v - vx) / VW;
        pts.push([vx, vy]);
        /* Two ways on (two letters' corners touching): turn the same way
           every time, so loops neither cross nor get lost. */
        let pick = 0;
        if (nxt[1][v] !== -1 && px !== -1) {
          const dx = vx - px, dy = vy - py;
          const b0 = nxt[0][v], ex = (b0 % VW) - vx, ey = ((b0 - (b0 % VW)) / VW) - vy;
          pick = dx * ey - dy * ex > 0 ? 0 : 1;
        }
        const to = nxt[pick][v];
        if (pick === 0) { nxt[0][v] = nxt[1][v]; nxt[1][v] = -1; } else nxt[1][v] = -1;
        px = vx; py = vy; v = to;
        if (v === s) break;
      }
      loops.push(pts);
    }
  }
  return loops;
}

function straighten(pts) {
  /* corners only: a run of pixel edges in one direction is one edge */
  const c = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], d = pts[(i + 1) % n];
    if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) !== 0) c.push(b);
  }
  return c.length >= 3 ? c : pts;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let best = -1, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
    if (d > best) { best = d; at = i; }
  }
  if (best <= eps) return [a, b];
  return rdp(pts.slice(0, at + 1), eps).slice(0, -1).concat(rdp(pts.slice(at), eps));
}

function simplify(loop, eps) {
  const c = straighten(loop);
  if (c.length < 4) return c;
  /* a closed loop: split at the point farthest from the first */
  let far = 0, fd = -1;
  for (let i = 1; i < c.length; i++) {
    const d = Math.hypot(c[i][0] - c[0][0], c[i][1] - c[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const one = rdp(c.slice(0, far + 1), eps);
  const two = rdp(c.slice(far).concat([c[0]]), eps);
  return one.slice(0, -1).concat(two.slice(0, -1));
}

/* A letter in font units: its outlines (each a list of [x, y], clockwise for
   ink, as TrueType wants), its width, its box. */
export function glyphFor(sheet, gl) {
  const s = CAP / sheet.capPx;
  const eps = Math.max(0.55, sheet.capPx / 260);
  const contours = [];
  for (const loop of trace(sheet, gl)) {
    const pts = [];
    for (const [x, y] of simplify(loop, eps)) {
      const p = [Math.round(x * s) + SIDE, Math.round((gl.base - gl.y0 - y) * s)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    /* traced counter-clockwise once the picture's y is turned up: reverse */
    if (pts.length >= 3) contours.push(pts.reverse());
  }
  const width = Math.round((gl.x1 - gl.x0 + 1) * s);
  return { contours, advance: width + 2 * SIDE };
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];   // clockwise, y up

/* The marks a name may carry that a picture often leaves out. */
function standIn(ch) {
  const t = Math.round(CAP * 0.14);
  if (ch === '-') return { contours: [rect(SIDE, Math.round(CAP * 0.38), SIDE + Math.round(CAP * 0.4), Math.round(CAP * 0.38) + t)], advance: Math.round(CAP * 0.4) + 2 * SIDE };
  if (ch === '.') return { contours: [rect(SIDE, 0, SIDE + t + 10, t + 10)], advance: t + 10 + 2 * SIDE };
  if (ch === "'") return { contours: [rect(SIDE, Math.round(CAP * 0.7), SIDE + t, CAP)], advance: t + 2 * SIDE };
  return null;
}

/* ---------------------------------------------------------- the font file */

export function makeFont(sheet, family) {
  const name = String(family || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Picture font';
  const byChar = new Map();
  for (const gl of sheet.glyphs) if (gl.char && !byChar.has(gl.char)) byChar.set(gl.char, glyphFor(sheet, gl));
  if (!byChar.size) throw fail('no letter in the picture was given a character', 'no_letters');
  for (const ch of ['-', '.', "'"]) if (!byChar.has(ch)) byChar.set(ch, standIn(ch));

  /* .notdef is a box with a hole (the hole runs the other way round) */
  const glyphs = [
    { contours: [rect(50, 0, 450, CAP), [[100, 50], [400, 50], [400, CAP - 50], [100, CAP - 50]]], advance: 500, codes: [] },
    { contours: [], advance: SPACE, codes: [0x20] }
  ];
  for (const ch of [...byChar.keys()].sort()) {
    const code = ch.codePointAt(0);
    const codes = [code];
    if (code >= 0x41 && code <= 0x5A && !byChar.has(ch.toLowerCase())) codes.push(code + 0x20);
    glyphs.push({ ...byChar.get(ch), codes });
  }
  return ttf(name, glyphs);
}

const pad4 = (n) => (n + 3) & ~3;

function checksum(buf) {
  let sum = 0;
  const p = Buffer.alloc(pad4(buf.length));
  buf.copy(p);
  for (let i = 0; i < p.length; i += 4) sum = (sum + p.readUInt32BE(i)) >>> 0;
  return sum;
}

function glyphBytes(g) {
  if (!g.contours.length) return { data: Buffer.alloc(0), box: null, points: 0 };
  const all = g.contours.flat();
  const box = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])),
               Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  const n = all.length;
  const b = Buffer.alloc(10 + 2 * g.contours.length + 2 + n + 4 * n);
  let o = 0;
  b.writeInt16BE(g.contours.length, o); o += 2;
  for (const v of box) { b.writeInt16BE(v, o); o += 2; }
  let end = -1;
  for (const c of g.contours) { end += c.length; b.writeUInt16BE(end, o); o += 2; }
  b.writeUInt16BE(0, o); o += 2;                    // no instructions
  for (let i = 0; i < n; i++) b[o++] = 0x01;        // on the curve; x and y as int16
  let px = 0;
  for (const p of all) { b.writeInt16BE(p[0] - px, o); o += 2; px = p[0]; }
  let py = 0;
  for (const p of all) { b.writeInt16BE(p[1] - py, o); o += 2; py = p[1]; }
  return { data: b, box, points: n };
}

function utf16(s) {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
  return b;
}

export function ttf(family, glyphs) {
  const N = glyphs.length;
  const gb = glyphs.map(glyphBytes);
  const boxes = gb.filter((x) => x.box).map((x) => x.box);
  const xMin = Math.min(...boxes.map((b) => b[0])), yMin = Math.min(0, ...boxes.map((b) => b[1]));
  const xMax = Math.max(...boxes.map((b) => b[2])), yMax = Math.max(CAP, ...boxes.map((b) => b[3]));
  const advMax = Math.max(...glyphs.map((g) => g.advance));
  const ascent = Math.max(900, yMax + 50), descent = Math.max(200, -yMin + 50);

  /* glyf + loca (long offsets) */
  const offs = [0];
  const parts = [];
  for (const x of gb) { const d = Buffer.alloc(pad4(x.data.length)); x.data.copy(d); parts.push(d); offs.push(offs[offs.length - 1] + d.length); }
  const glyf = Buffer.concat(parts);
  const loca = Buffer.alloc(4 * (N + 1));
  offs.forEach((v, i) => loca.writeUInt32BE(v, i * 4));

  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0); head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(0, 8);                      // checkSumAdjustment, set last
  head.writeUInt32BE(0x5F0F3CF5, 12);
  head.writeUInt16BE(0x000B, 16); head.writeUInt16BE(UPM, 18);
  const secs = BigInt(Math.floor(Date.now() / 1000) + 2082844800);
  head.writeBigUInt64BE(secs, 20); head.writeBigUInt64BE(secs, 28);
  head.writeInt16BE(xMin, 36); head.writeInt16BE(yMin, 38); head.writeInt16BE(xMax, 40); head.writeInt16BE(yMax, 42);
  head.writeUInt16BE(0, 44); head.writeUInt16BE(8, 46); head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50); head.writeInt16BE(0, 52);

  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0); hhea.writeInt16BE(ascent, 4); hhea.writeInt16BE(-descent, 6); hhea.writeInt16BE(0, 8);
  hhea.writeUInt16BE(advMax, 10);
  const lsbs = gb.map((x) => (x.box ? x.box[0] : 0));
  hhea.writeInt16BE(Math.min(...lsbs), 12);
  hhea.writeInt16BE(Math.min(...glyphs.map((g, i) => (gb[i].box ? g.advance - gb[i].box[2] : 0))), 14);
  hhea.writeInt16BE(xMax, 16); hhea.writeInt16BE(1, 18); hhea.writeInt16BE(0, 20); hhea.writeInt16BE(0, 22);
  hhea.writeInt16BE(0, 32); hhea.writeUInt16BE(N, 34);

  const hmtx = Buffer.alloc(4 * N);
  glyphs.forEach((g, i) => { hmtx.writeUInt16BE(g.advance, i * 4); hmtx.writeInt16BE(lsbs[i], i * 4 + 2); });

  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(N, 4);
  maxp.writeUInt16BE(Math.max(...gb.map((x) => x.points)), 6);
  maxp.writeUInt16BE(Math.max(...glyphs.map((g) => g.contours.length)), 8);
  maxp.writeUInt16BE(2, 14);                     // maxZones

  const codes = [];
  glyphs.forEach((g, gi) => (g.codes || []).forEach((c) => codes.push([c, gi])));
  codes.sort((a, b) => a[0] - b[0]);
  const seg = codes.map(([c, gi]) => ({ start: c, end: c, delta: (gi - c) & 0xFFFF })).concat([{ start: 0xFFFF, end: 0xFFFF, delta: 1 }]);
  const sc = seg.length;
  const sub = Buffer.alloc(16 + 8 * sc);
  const pow = 2 ** Math.floor(Math.log2(sc));
  sub.writeUInt16BE(4, 0); sub.writeUInt16BE(sub.length, 2); sub.writeUInt16BE(0, 4);
  sub.writeUInt16BE(sc * 2, 6); sub.writeUInt16BE(pow * 2, 8); sub.writeUInt16BE(Math.log2(pow), 10); sub.writeUInt16BE(2 * sc - 2 * pow, 12);
  seg.forEach((s, i) => {
    sub.writeUInt16BE(s.end, 14 + 2 * i);
    sub.writeUInt16BE(s.start, 16 + 2 * sc + 2 * i);
    sub.writeUInt16BE(s.delta, 16 + 4 * sc + 2 * i);
    sub.writeUInt16BE(0, 16 + 6 * sc + 2 * i);
  });
  const cmap = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 12]), sub]);

  const ps = (family.replace(/[^A-Za-z0-9]/g, '') || 'PictureFont').slice(0, 50);
  const names = [[1, family], [2, 'Regular'], [3, `${ps}-Regular-OG`], [4, family], [5, 'Version 1.000'], [6, `${ps}-Regular`]];
  const strs = names.map(([, s]) => utf16(s));
  const nameT = Buffer.alloc(6 + 12 * names.length);
  nameT.writeUInt16BE(0, 0); nameT.writeUInt16BE(names.length, 2); nameT.writeUInt16BE(nameT.length, 4);
  let so = 0;
  names.forEach(([id], i) => {
    const o = 6 + 12 * i;
    nameT.writeUInt16BE(3, o); nameT.writeUInt16BE(1, o + 2); nameT.writeUInt16BE(0x409, o + 4);
    nameT.writeUInt16BE(id, o + 6); nameT.writeUInt16BE(strs[i].length, o + 8); nameT.writeUInt16BE(so, o + 10);
    so += strs[i].length;
  });
  const name = Buffer.concat([nameT, ...strs]);

  const os2 = Buffer.alloc(96);
  const avg = Math.round(glyphs.reduce((a, g) => a + g.advance, 0) / N);
  os2.writeUInt16BE(4, 0); os2.writeInt16BE(avg, 2); os2.writeUInt16BE(400, 4); os2.writeUInt16BE(5, 6);
  os2.writeUInt16BE(0, 8);
  [650, 600, 0, 75, 650, 600, 0, 350, 50, 260].forEach((v, i) => os2.writeInt16BE(v, 10 + 2 * i));
  os2.writeUInt32BE(1, 42);                      // Basic Latin
  os2.write('OGSY', 58, 'latin1');
  os2.writeUInt16BE(0x0040, 62);                 // REGULAR
  const cps = codes.map((c) => c[0]).filter((c) => c < 0xFFFF);
  os2.writeUInt16BE(Math.min(...cps), 64); os2.writeUInt16BE(Math.max(...cps), 66);
  os2.writeInt16BE(ascent, 68); os2.writeInt16BE(-descent, 70); os2.writeInt16BE(0, 72);
  os2.writeUInt16BE(ascent, 74); os2.writeUInt16BE(descent, 76);
  os2.writeUInt32BE(1, 78);                      // Latin 1
  os2.writeInt16BE(CAP, 86); os2.writeInt16BE(CAP, 88);
  os2.writeUInt16BE(0, 90); os2.writeUInt16BE(0x20, 92); os2.writeUInt16BE(1, 94);

  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0); post.writeInt16BE(-100, 8); post.writeInt16BE(50, 10);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const nt = tags.length;
  const p2 = 2 ** Math.floor(Math.log2(nt));
  const dir = Buffer.alloc(12 + 16 * nt);
  dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(nt, 4); dir.writeUInt16BE(p2 * 16, 6);
  dir.writeUInt16BE(Math.log2(p2), 8); dir.writeUInt16BE(nt * 16 - p2 * 16, 10);
  let off = dir.length;
  const body = [];
  tags.forEach((tag, i) => {
    const data = tables[tag];
    const o = 12 + 16 * i;
    dir.write(tag, o, 'latin1');
    dir.writeUInt32BE(checksum(data), o + 4); dir.writeUInt32BE(off, o + 8); dir.writeUInt32BE(data.length, o + 12);
    const padded = Buffer.alloc(pad4(data.length)); data.copy(padded);
    body.push(padded); off += padded.length;
  });
  const font = Buffer.concat([dir, ...body]);
  const headAt = font.readUInt32BE(12 + 16 * tags.indexOf('head') + 8);
  font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headAt + 8);
  return font;
}
