/* ==========================================================================
   OG SYSTEM — barcode + QR encoders
   --------------------------------------------------------------------------
   Real, scannable codes. No libraries, no network, works from file://.

     Codes.ean13(digits)        -> 95-module string, or null if invalid
     Codes.ean13Check(digits12) -> the 13th checksum digit
     Codes.ean13SVG(code, opts) -> print-ready SVG barcode
     Codes.qrMatrix(text, opts) -> { size, modules[][], version, ecc }
     Codes.qrSVG(text, opts)    -> branded SVG QR
     Codes.qrCanvas(cv, text)   -> same code painted onto a <canvas>

   QR is byte mode, ECC level H by default (30% recovery — that headroom is
   what lets a logo sit in the middle). Versions 1–10, auto-selected. Falls
   back to level M when a payload will not fit at H.
   ========================================================================== */

var Codes = (function () {

  /* ==================================================================== EAN-13 */

  var EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011',
               '0110001', '0101111', '0111011', '0110111', '0001011'];
  var EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101',
               '0111001', '0000101', '0010001', '0001001', '0010111'];
  var EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100',
               '1001110', '1010000', '1000100', '1001000', '1110100'];
  /* Which of the first six digits use G instead of L — encodes digit 1. */
  var EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
                    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  /* Weights alternate 1,3 from the left across the first twelve digits. */
  function ean13Check(d12) {
    var s = String(d12).replace(/\D/g, '').slice(0, 12);
    if (s.length !== 12) return null;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  }

  function ean13Valid(code) {
    var s = String(code).replace(/\D/g, '');
    return s.length === 13 && ean13Check(s.slice(0, 12)) === +s[12];
  }

  /* 3 guard + 42 left + 5 centre + 42 right + 3 guard = 95 modules. */
  function ean13(code) {
    var s = String(code).replace(/\D/g, '');
    if (s.length !== 13) return null;
    var parity = EAN_PARITY[+s[0]];
    var out = '101';
    for (var i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[+s[i]];
    out += '01010';
    for (i = 7; i <= 12; i++) out += EAN_R[+s[i]];
    return out + '101';
  }

  /* Quiet zones are part of the symbol — without them scanners struggle. */
  function ean13SVG(code, opts) {
    opts = opts || {};
    var mods = ean13(code);
    if (!mods) return '';
    var m = opts.module || 2;          // px per module
    var h = opts.height || 56;         // bar height
    var dark = opts.dark || '#000000';
    var light = opts.light || '#FFFFFF';
    var showText = opts.text !== false;
    var quietL = 11, quietR = 7;
    var totalMods = quietL + 95 + quietR;
    var w = totalMods * m;
    var guardDrop = showText ? m * 5 : 0;
    var textH = showText ? Math.max(9, m * 5) : 0;
    var svgH = h + guardDrop + (showText ? textH + 2 : 0);

    /* Guard bars run longer than data bars, the classic EAN silhouette. */
    function isGuard(i) { return (i < 3) || (i >= 45 && i < 50) || (i >= 92); }

    var bars = '';
    for (var i = 0; i < 95; i++) {
      if (mods[i] !== '1') continue;
      var x = (quietL + i) * m;
      bars += '<rect x="' + x + '" y="0" width="' + m + '" height="' +
              (h + (isGuard(i) ? guardDrop : 0)) + '"/>';
    }

    var txt = '';
    if (showText) {
      var fs = Math.max(8, m * 5);
      var y = h + guardDrop + textH - 1;
      var st = 'font-family="Menlo,Consolas,monospace" font-size="' + fs +
               '" fill="' + dark + '" text-anchor="middle"';
      /* first digit outside the symbol, then 6 under each half */
      txt += '<text x="' + (quietL - 5) * m + '" y="' + y + '" ' + st + '>' + code[0] + '</text>';
      txt += '<text x="' + (quietL + 3 + 21) * m + '" y="' + y + '" ' + st + '>' + code.slice(1, 7) + '</text>';
      txt += '<text x="' + (quietL + 50 + 21) * m + '" y="' + y + '" ' + st + '>' + code.slice(7) + '</text>';
    }

    return '<svg class="bc" xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + svgH +
           '" viewBox="0 0 ' + w + ' ' + svgH + '" shape-rendering="crispEdges">' +
           '<rect width="' + w + '" height="' + svgH + '" fill="' + light + '"/>' +
           '<g fill="' + dark + '">' + bars + '</g>' + txt + '</svg>';
  }

  /* ======================================================== GF(256) for QR RS */

  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) { return (!a || !b) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* g(x) = product of (x + a^i), coefficients highest-degree first */
  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var res = [];
      for (var k = 0; k <= g.length; k++) res[k] = 0;
      for (var j = 0; j < g.length; j++) {
        res[j] ^= g[j];
        res[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = res;
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    var g = genPoly(ecLen), res = data.slice(), i, j;
    for (i = 0; i < ecLen; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      var coef = res[i];
      if (!coef) continue;
      for (j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], coef);
    }
    return res.slice(data.length);
  }

  /* ============================================================== QR tables */

  /* total codewords (data + ecc) per version, index = version */
  var TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

  /* [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] */
  var ECC = {
    M: [null,
      [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
      [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
      [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    H: [null,
      [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
      [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
      [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]]
  };

  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* alignment pattern centres, index = version */
  var ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
               [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  /* remainder bits appended after the codeword stream */
  var REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

  var MAX_VERSION = 10;

  function dataCodewords(v, ecc) {
    var e = ECC[ecc][v];
    return e[1] * e[2] + e[3] * e[4];
  }

  function byteCapacity(v, ecc) {
    var countBits = v < 10 ? 8 : 16;
    return Math.floor((dataCodewords(v, ecc) * 8 - 4 - countBits) / 8);
  }

  function bitLen(n) { var l = 0; while (n) { l++; n >>>= 1; } return l; }

  function formatBits(ecc, mask) {
    var data = (ECC_BITS[ecc] << 3) | mask;
    var d = data << 10;
    while (bitLen(d) - 1 >= 10) d ^= 0x537 << (bitLen(d) - 11);
    return ((data << 10) | d) ^ 0x5412;
  }

  function versionBits(v) {
    var d = v << 12;
    while (bitLen(d) - 1 >= 12) d ^= 0x1F25 << (bitLen(d) - 13);
    return (v << 12) | d;
  }

  /* ============================================================= QR encoding */

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c < 0xD800 || c >= 0xE000) { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      else { /* surrogate pair */
        i++;
        var cp = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF));
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return out;
  }

  function buildCodewords(bytes, v, ecc) {
    var countBits = v < 10 ? 8 : 16;
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }

    push(4, 4);                       // byte mode
    push(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var total = dataCodewords(v, ecc) * 8;
    for (i = 0; i < 4 && bits.length < total; i++) bits.push(0);   // terminator
    while (bits.length % 8) bits.push(0);

    var pad = [0xEC, 0x11], p = 0;
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    while (data.length < dataCodewords(v, ecc)) { data.push(pad[p]); p ^= 1; }

    /* split into blocks, RS each, then interleave both streams */
    var e = ECC[ecc][v], blocks = [], ecBlocks = [], idx = 0, k;
    for (k = 0; k < e[1]; k++) { blocks.push(data.slice(idx, idx + e[2])); idx += e[2]; }
    for (k = 0; k < e[3]; k++) { blocks.push(data.slice(idx, idx + e[4])); idx += e[4]; }
    for (k = 0; k < blocks.length; k++) ecBlocks.push(rsEncode(blocks[k], e[0]));

    var out = [], maxData = Math.max(e[2], e[4]);
    for (i = 0; i < maxData; i++) {
      for (k = 0; k < blocks.length; k++) if (i < blocks[k].length) out.push(blocks[k][i]);
    }
    for (i = 0; i < e[0]; i++) {
      for (k = 0; k < ecBlocks.length; k++) out.push(ecBlocks[k][i]);
    }
    return out;
  }

  function blankMatrix(size) {
    var m = [], r, c;
    for (r = 0; r < size; r++) { m[r] = []; for (c = 0; c < size; c++) m[r][c] = null; }
    return m;
  }

  function placeFunctions(m, v) {
    var size = m.length, r, c, i;

    function finder(top, left) {
      for (r = -1; r <= 7; r++) {
        for (c = -1; c <= 7; c++) {
          var rr = top + r, cc = left + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          m[rr][cc] = on ? 1 : 0;
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (i = 8; i < size - 8; i++) { m[6][i] = (i % 2 === 0) ? 1 : 0; m[i][6] = (i % 2 === 0) ? 1 : 0; }

    var ac = ALIGN[v];
    for (var a = 0; a < ac.length; a++) {
      for (var b = 0; b < ac.length; b++) {
        var ar = ac[a], acol = ac[b];
        /* the three that sit on finder patterns are omitted */
        if ((ar === 6 && acol === 6) || (ar === 6 && acol === size - 7) || (ar === size - 7 && acol === 6)) continue;
        for (r = -2; r <= 2; r++) {
          for (c = -2; c <= 2; c++) {
            m[ar + r][acol + c] = (Math.max(Math.abs(r), Math.abs(c)) !== 1) ? 1 : 0;
          }
        }
      }
    }

    /* reserve format areas (filled later) and the always-dark module */
    for (i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; }
    for (i = 0; i < 8; i++) { m[8][size - 1 - i] = 0; m[size - 1 - i][8] = 0; }
    m[size - 8][8] = 1;

    if (v >= 7) {
      for (i = 0; i < 18; i++) {
        var rr2 = Math.floor(i / 3), cc2 = i % 3;
        m[size - 11 + cc2][rr2] = 0;
        m[rr2][size - 11 + cc2] = 0;
      }
    }
  }

  function placeData(m, cw) {
    var size = m.length, bitIdx = 0, dir = -1, row = size - 1;
    function bit() {
      if (bitIdx >= cw.length * 8) return 0;
      var b = (cw[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return b;
    }
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                     // timing column is never data
      for (;;) {
        for (var i = 0; i < 2; i++) {
          var c = col - i;
          if (m[row][c] === null) m[row][c] = bit();
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.length, score = 0, r, c, i, run, last, dark = 0;

    /* rule 1 — runs of five or more */
    for (r = 0; r < size; r++) {
      run = 1; last = -1;
      for (c = 0; c < size; c++) {
        if (m[r][c] === last) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else { run = 1; last = m[r][c]; }
      }
    }
    for (c = 0; c < size; c++) {
      run = 1; last = -1;
      for (r = 0; r < size; r++) {
        if (m[r][c] === last) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else { run = 1; last = m[r][c]; }
      }
    }

    /* rule 2 — 2x2 blocks of one colour */
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v0 = m[r][c];
        if (v0 === m[r][c + 1] && v0 === m[r + 1][c] && v0 === m[r + 1][c + 1]) score += 3;
      }
    }

    /* rule 3 — finder-like 1:1:3:1:1 sequences */
    var pA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, n) {
      for (i = 0; i + 11 <= n; i++) {
        var okA = true, okB = true;
        for (var k = 0; k < 11; k++) {
          var val = get(i + k);
          if (val !== pA[k]) okA = false;
          if (val !== pB[k]) okB = false;
        }
        if (okA) score += 40;
        if (okB) score += 40;
      }
    }
    for (r = 0; r < size; r++) match((function (rr) { return function (i2) { return m[rr][i2]; }; })(r), size);
    for (c = 0; c < size; c++) match((function (cc) { return function (i2) { return m[i2][cc]; }; })(c), size);

    /* rule 4 — deviation from an even split of dark and light */
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* Exact ISO 18004 positions. Copy 1 runs down column 8 then left along row 8;
     copy 2 runs right along row 8 then down column 8. Getting these transposed
     produces a symbol that looks perfect and decodes as nothing. */
  function applyFormat(m, ecc, mask) {
    var size = m.length, bits = formatBits(ecc, mask), i, b;
    for (i = 0; i < 15; i++) {
      b = (bits >> i) & 1;

      /* copy 1 — around the top-left finder */
      if (i < 6) m[i][8] = b;
      else if (i === 6) m[7][8] = b;
      else if (i === 7) m[8][8] = b;
      else if (i === 8) m[8][7] = b;
      else m[8][14 - i] = b;

      /* copy 2 — row 8 on the right, then column 8 along the bottom */
      if (i < 8) m[8][size - 1 - i] = b;
      else m[size - 15 + i][8] = b;
    }
    m[size - 8][8] = 1;                 // always dark; no format bit lands here
  }

  function applyVersion(m, v) {
    if (v < 7) return;
    var size = m.length, bits = versionBits(v);
    for (var i = 0; i < 18; i++) {
      var b = (bits >> i) & 1, r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = b;
      m[r][size - 11 + c] = b;
    }
  }

  function qrMatrix(text, opts) {
    opts = opts || {};
    var bytes = utf8Bytes(String(text));
    var order = opts.ecc ? [opts.ecc] : ['H', 'M'];
    var v = 0, ecc = null, i, k;

    /* smallest version at the strongest level the payload still fits */
    for (k = 0; k < order.length && !ecc; k++) {
      for (i = 1; i <= MAX_VERSION; i++) {
        if (bytes.length <= byteCapacity(i, order[k])) { v = i; ecc = order[k]; break; }
      }
    }
    if (!ecc) return null;                       // too long — caller decides

    var size = v * 4 + 17;
    var base = blankMatrix(size);
    placeFunctions(base, v);

    /* remember which modules are function patterns before data goes in */
    var reserved = [];
    for (i = 0; i < size; i++) { reserved[i] = []; for (k = 0; k < size; k++) reserved[i][k] = base[i][k] !== null; }

    /* Remainder bits (REMAINDER[v]) need no explicit handling — placeData's
       bit reader returns 0 once the codeword stream is exhausted. */
    var cw = buildCodewords(bytes, v, ecc);
    placeData(base, cw);
    for (i = 0; i < size; i++) for (k = 0; k < size; k++) if (base[i][k] === null) base[i][k] = 0;

    /* try every mask, keep the least penalised */
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var cand = [];
      for (i = 0; i < size; i++) {
        cand[i] = [];
        for (k = 0; k < size; k++) {
          cand[i][k] = reserved[i][k] ? base[i][k] : (base[i][k] ^ (MASKS[mk](i, k) ? 1 : 0));
        }
      }
      applyFormat(cand, ecc, mk);
      applyVersion(cand, v);
      var s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; }
    }

    return { size: size, modules: best, version: v, ecc: ecc, reserved: reserved };
  }

  /* ============================================================ QR rendering */

  /* Rounded data dots and softened finder corners are safe; a centre logo up
     to ~20% of the area is what the H error-correction budget is for. */
  function qrSVG(text, opts) {
    opts = opts || {};
    var qr = qrMatrix(text, opts);
    if (!qr) return '';
    var n = qr.size;
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var total = n + quiet * 2;
    var px = opts.size || 200;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#FFFFFF';
    var rounded = opts.style === 'rounded';
    var m = qr.modules;

    function inFinder(r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    }

    var body = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!m[r][c] || inFinder(r, c)) continue;
        var x = c + quiet, y = r + quiet;
        body += rounded
          ? '<rect x="' + (x + .06) + '" y="' + (y + .06) + '" width=".88" height=".88" rx=".3"/>'
          : '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }

    /* draw the three finders as shapes so they stay clean at small sizes */
    var eyes = '';
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var y = p[0] + quiet, x = p[1] + quiet;
      var ro = rounded ? 2 : 0, ri = rounded ? .9 : 0;
      eyes += '<rect x="' + x + '" y="' + y + '" width="7" height="7" rx="' + ro + '" fill="' + dark + '"/>' +
              '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" rx="' + (ro * .7) + '" fill="' + light + '"/>' +
              '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" rx="' + ri + '" fill="' + dark + '"/>';
    });

    var logo = '';
    if (opts.logo) {
      var ratio = Math.min(opts.logoRatio || 0.22, 0.26);
      var lw = total * ratio;
      var lx = (total - lw) / 2;
      logo = '<rect x="' + (lx - .5) + '" y="' + (lx - .5) + '" width="' + (lw + 1) + '" height="' + (lw + 1) +
             '" rx="' + (rounded ? 1.4 : 0) + '" fill="' + light + '"/>' +
             '<image href="' + opts.logo + '" x="' + lx + '" y="' + lx + '" width="' + lw + '" height="' + lw + '"/>';
    }

    return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
           '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="' + (rounded ? 'auto' : 'crispEdges') + '">' +
           '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
           '<g fill="' + dark + '">' + body + '</g>' + eyes + logo + '</svg>';
  }

  function qrCanvas(canvas, text, opts) {
    if (!canvas || !canvas.getContext) return false;
    opts = opts || {};
    var qr = qrMatrix(text, opts);
    if (!qr) return false;
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var total = qr.size + quiet * 2;
    var px = opts.size || 200;
    var scale = Math.max(1, Math.floor(px / total));
    var side = scale * total;
    canvas.width = side; canvas.height = side;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#FFFFFF';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = opts.dark || '#000000';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return true;
  }


  /* ======================================================== CODE 128
     Why this exists alongside EAN-13: an EAN-13 is thirteen digits from a
     registry. The codes this shop prints on its own shoes are not from a
     registry — the old ones began 621, which is GS1's real country prefix for
     Syria, so an OG code could collide with a genuine Syrian product.

     Code 128 encodes TEXT, so the label carries the SKU itself — OG-001-42.
     Unique by construction, readable by a human, and every scanner reads it.

     Structure of a symbol:
        quiet zone | START | data… | checksum | STOP | quiet zone
     Every character is 11 modules except STOP, which is 13. The checksum is
     mod 103 over the start value plus each value times its 1-based position. */

  /* 107 patterns, indexed by code value 0..106. Each is the widths of
     bar,space,bar,space,bar,space — always summing to 11 (STOP sums to 13). */
  var C128_PAT = [
    '212222','222122','222221','121223','121322','131222','122213','122312',
    '132212','221213','221312','231212','112232','122132','122231','113222',
    '123122','123221','223211','221132','221231','213212','223112','312131',
    '311222','321122','321221','312212','322112','322211','212123','212321',
    '232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121',
    '313121','211331','231131','213113','213311','213131','311123','311321',
    '331121','312113','312311','332111','314111','221411','431111','111224',
    '111422','121124','121421','141122','141221','112214','112412','122114',
    '122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112',
    '421211','212141','214121','412121','111143','111341','131141','114113',
    '114311','411113','411311','113141','114131','311141','411131','211412',
    '211214','211232','2331112'
  ];

  var C128_START_B = 104, C128_START_C = 105, C128_STOP = 106;
  var C128_CODE_B = 100, C128_CODE_C = 99;

  /* Code Set B covers ASCII 32..127; value = charCode - 32. */
  function c128bValue(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 32 && c <= 127) ? c - 32 : -1;
  }

  /* Length of the digit run starting at i. Code Set C packs TWO digits into
     one symbol character, so a long numeric run is worth switching for: an SKU
     like OG-001-42 is mostly digits, and packing them makes the symbol about a
     third narrower — the difference between fitting a 40mm label and not. */
  function c128DigitRun(s, i) {
    var n = 0;
    while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++;
    return n;
  }

  /* Text -> array of code VALUES, picking sets to keep the symbol short.
     Returns null for anything Code Set B cannot express. */
  function code128Values(text) {
    var s = String(text == null ? '' : text);
    if (!s.length) return null;
    for (var k = 0; k < s.length; k++) {
      if (c128bValue(s.charAt(k)) < 0) return null;   /* non-ASCII, refuse */
    }

    var vals = [], i = 0, mode;

    /* Opening in C pays off when the string starts with 4+ digits, or is
       entirely an even-length digit run. Below that the switch costs more
       than it saves. */
    var lead = c128DigitRun(s, 0);
    if (lead >= 4 || (lead === s.length && lead % 2 === 0)) {
      mode = 'C'; vals.push(C128_START_C);
    } else {
      mode = 'B'; vals.push(C128_START_B);
    }

    while (i < s.length) {
      var run = c128DigitRun(s, i);
      if (mode === 'C') {
        /* C emits PAIRS only. An odd digit at the tail, or any non-digit,
           means dropping back to B. */
        if (run >= 2) {
          vals.push(parseInt(s.substr(i, 2), 10));
          i += 2;
        } else {
          vals.push(C128_CODE_B); mode = 'B';
        }
      } else {
        /* Switch up to C only for a run long enough to repay the switch
           character: 6 mid-string, or 4 if it runs evenly to the end. */
        var toEnd = (i + run === s.length);
        if ((run >= 6 && run % 2 === 0) || (toEnd && run >= 4 && run % 2 === 0)) {
          vals.push(C128_CODE_C); mode = 'C';
        } else {
          vals.push(c128bValue(s.charAt(i))); i++;
        }
      }
    }
    return vals;
  }

  /* Mod 103: start value, then each data value weighted by its 1-based index. */
  function code128Check(vals) {
    var sum = vals[0];
    for (var i = 1; i < vals.length; i++) sum += vals[i] * i;
    return sum % 103;
  }

  /* Module string: '1' is a bar, '0' a space. Quiet zones are NOT included —
     the renderer adds them, exactly as ean13() leaves them to ean13SVG(). */
  function code128(text) {
    var vals = code128Values(text);
    if (!vals) return null;
    vals.push(code128Check(vals));
    vals.push(C128_STOP);

    var out = '';
    for (var i = 0; i < vals.length; i++) {
      var pat = C128_PAT[vals[i]];
      var dark = true;
      for (var j = 0; j < pat.length; j++) {
        var n = +pat.charAt(j);
        for (var k = 0; k < n; k++) out += dark ? '1' : '0';
        dark = !dark;
      }
    }
    return out;
  }

  /* Decoder over the SAME table, so the suite can prove a round trip instead
     of eyeballing a picture — the pattern js/scan.js already uses for EAN. */
  function code128Decode(mods) {
    if (!mods || mods.length < 35 || mods.charAt(0) !== '1') return null;

    /* Widths of alternating runs, starting with a bar. */
    var runs = [], cur = mods.charAt(0), n = 0;
    for (var i = 0; i < mods.length; i++) {
      if (mods.charAt(i) === cur) { n++; }
      else { runs.push(n); cur = mods.charAt(i); n = 1; }
    }
    runs.push(n);

    /* Every character is 6 runs; STOP is 7. */
    var vals = [], idx = 0;
    while (idx + 6 <= runs.length) {
      var take = (runs.length - idx === 7) ? 7 : 6;
      var v = C128_PAT.indexOf(runs.slice(idx, idx + take).join(''));
      if (v < 0) return null;
      vals.push(v);
      idx += take;
      if (v === C128_STOP) break;
    }
    if (vals.length < 4 || vals[vals.length - 1] !== C128_STOP) return null;

    vals.pop();                       /* STOP */
    var check = vals.pop();
    if (code128Check(vals) !== check) return null;

    var start = vals.shift();
    if (start !== C128_START_B && start !== C128_START_C) return null;
    var mode = (start === C128_START_C) ? 'C' : 'B';

    /* The switch codes are MODE-DEPENDENT, and reading them blindly is a real
       bug: 99 means "switch to Set C" while in Set B, but inside Set C it is
       the literal digit pair "99". Checking it without regard to mode made the
       code 99 decode to an empty string. Likewise 100 is "switch to Set B"
       only while in C. */
    var out = '';
    for (var q = 0; q < vals.length; q++) {
      var val = vals[q];
      if (mode === 'B' && val === C128_CODE_C) { mode = 'C'; continue; }
      if (mode === 'C' && val === C128_CODE_B) { mode = 'B'; continue; }
      out += (mode === 'C')
        ? ((val < 10 ? '0' : '') + val)
        : String.fromCharCode(val + 32);
    }
    return out;
  }

  /* Same option shape as ean13SVG so the label studio swaps renderers by one
     field. The 10-module quiet zone each side is not decoration: too little
     white space is the single most common reason a home-made barcode will
     not scan. */
  function code128SVG(text, opts) {
    opts = opts || {};
    var mods = code128(text);
    if (!mods) return '';
    var m = opts.module || 2;
    var h = opts.height || 56;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#FFFFFF';
    var showText = opts.text !== false;
    var quiet = 10;
    var w = (quiet + mods.length + quiet) * m;
    var textH = showText ? Math.max(9, m * 5) : 0;
    var svgH = h + (showText ? textH + 2 : 0);

    /* One rect per RUN of bars rather than per module: a 200-module symbol
       becomes ~40 rects instead of 200, which matters on a sheet of a
       hundred labels. */
    var bars = '', run = 0;
    for (var i = 0; i <= mods.length; i++) {
      if (mods.charAt(i) === '1') { run++; continue; }
      if (run) {
        bars += '<rect x="' + ((quiet + i - run) * m) + '" y="0" width="' +
                (run * m) + '" height="' + h + '"/>';
        run = 0;
      }
    }

    var txt = '';
    if (showText) {
      var fs = Math.max(8, m * 4.5);
      txt = '<text x="' + (w / 2) + '" y="' + (h + textH - 1) +
            '" font-family="Menlo,Consolas,monospace" font-size="' + fs +
            '" fill="' + dark + '" text-anchor="middle">' +
            String(text).replace(/[&<>]/g, '') + '</text>';
    }

    return '<svg class="bc bc128" xmlns="http://www.w3.org/2000/svg" width="' + w +
           '" height="' + svgH + '" viewBox="0 0 ' + w + ' ' + svgH +
           '" shape-rendering="crispEdges">' +
           '<rect width="' + w + '" height="' + svgH + '" fill="' + light + '"/>' +
           '<g fill="' + dark + '">' + bars + '</g>' + txt + '</svg>';
  }

  return {
    ean13: ean13,
    ean13Check: ean13Check,
    ean13Valid: ean13Valid,
    ean13SVG: ean13SVG,
    code128: code128,
    code128SVG: code128SVG,
    code128Decode: code128Decode,
    code128Check: code128Check,
    _c128: { PAT: C128_PAT, values: code128Values },
    qrMatrix: qrMatrix,
    qrSVG: qrSVG,
    qrCanvas: qrCanvas,
    byteCapacity: byteCapacity,
    MAX_VERSION: MAX_VERSION,
    /* Spec tables, exposed so the test harness can decode a symbol back
       to its payload rather than just eyeballing the picture — and so
       js/scan.js can READ a barcode using the very tables that wrote it,
       rather than carrying a second copy that could drift. */
    _tables: { ECC: ECC, TOTAL_CW: TOTAL_CW, ALIGN: ALIGN, REMAINDER: REMAINDER, MASKS: MASKS },
    _ean: { L: EAN_L, G: EAN_G, R: EAN_R, PARITY: EAN_PARITY }
  };
})();
