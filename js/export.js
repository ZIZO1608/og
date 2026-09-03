/* ==========================================================================
   OG SYSTEM — branded exports
   --------------------------------------------------------------------------
   Real files, no libraries.

     Export.run(spec)   spec.kind = 'xlsx' | 'pdf'

   XLSX is written by hand: a ZIP built with the store method (no deflate), a
   CRC-32 implementation, and the OOXML parts. Strings go inline so there is no
   sharedStrings table to keep in sync.

   PDF is a light A4 document rendered as HTML and sent through the browser's
   Save-as-PDF. Writing a PDF byte encoder by hand would mean embedding and
   subsetting fonts and hand-shaping Arabic — it would look worse, not better.

   ------------------------------------------------------------------------
   THE COLUMN SPEC, which is what everything below turns on
   ------------------------------------------------------------------------
   A column is `{ label, width, ...type }`, and the type decides how the value
   is written into the sheet AND how it is drawn on the printed page:

       (none)          text
       num: true       a plain number, thousands separated
       int: true       the same, for counts — kept apart so a future change to
                       one does not silently move the other
       money: 'SYP'    a number carrying its currency's own format. SYP is
                       whole lira (minor_exp 0) and USD is dollars-and-cents,
                       and they are NEVER the same column.
       pct: true       a percentage. The VALUE is the percent as a person says
                       it (53.3), and it is divided by 100 on the way in
                       because Excel's % format multiplies by 100 on the way
                       out. Get this wrong and every margin in the file reads
                       5330%.
       date: true      a real date, written as an Excel serial. It used to be
                       written as `fmtDate()` text, which looks identical and
                       cannot be sorted, filtered or subtracted.

   Any cell may be null, which is BLANK — deliberately not zero. A supplier
   billed in dollars has no lira balance, and somebody on the payroll with no
   till login has not sold nothing; a 0 in either column is added up by the
   first person who selects it.

   ------------------------------------------------------------------------
   THE LOGO
   ------------------------------------------------------------------------
   The sheet carries the real mark, not a word in a coloured band. There is no
   PNG in the repo to embed — the mark is assets/logo.svg — so it is drawn
   into a canvas at export time and the PNG bytes are lifted out of the data
   URL. Same-origin and self-contained (both marks are plain paths, no external
   references), so the canvas stays origin-clean and toDataURL works.

   It is cached per mark, so the second export costs nothing, and EVERY failure
   path returns null: no canvas, an image that will not load, a tainted
   context, a browser without Promise. The band then renders exactly as it did
   before, with the word alone. A missing picture must never cost somebody
   their spreadsheet.
   ========================================================================== */

var Export = (function () {

  var THEMES = {
    og:    { ink: '0A0A0B', accent: 'C6FF00', onAccent: '0A0A0B',
             word: 'OG SYSTEM', logo: 'assets/logo.svg', tag: 'Sneakers & Streetwear' },
    yalla: { ink: '302B54', accent: 'B5DCC0', onAccent: '1E1B38',
             word: 'YALLA WEAR', logo: 'assets/yalla-mark.svg', tag: 'Style That Moves You!' }
  };

  function theme(t) { return THEMES[t] || THEMES.og; }

  /* ==================================================================== bytes */

  var TE = window.TextEncoder ? new TextEncoder() : null;
  function utf8(str) {
    if (TE) return TE.encode(str);
    /* Fallback for very old engines — the shop targets Chrome, but cheap. */
    var esc = unescape(encodeURIComponent(str)), out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
    return out;
  }

  /* base64 → bytes, for lifting the PNG out of a canvas data URL. */
  function b64bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* A growing byte buffer.

     This was an ordinary JS array pushed one byte at a time. It worked, and on
     a six-row report nobody would ever notice — but a year of daily rows is a
     megabyte of XML, which is a million single-element pushes into an array
     that reallocates as it goes, and the whole build is synchronous on the
     till's main thread. A doubling Uint8Array does the same job without the
     boxing. */
  function Buf(initial) {
    this.b = new Uint8Array(initial || 8192);
    this.n = 0;
  }
  Buf.prototype.room = function (extra) {
    if (this.n + extra <= this.b.length) return;
    var size = this.b.length;
    while (size < this.n + extra) size *= 2;
    var next = new Uint8Array(size);
    next.set(this.b.subarray(0, this.n));
    this.b = next;
  };
  Buf.prototype.u16 = function (v) {
    this.room(2);
    this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255;
    return this;
  };
  Buf.prototype.u32 = function (v) {
    this.room(4);
    this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255;
    this.b[this.n++] = (v >>> 16) & 255; this.b[this.n++] = (v >>> 24) & 255;
    return this;
  };
  Buf.prototype.raw = function (bytes) {
    this.room(bytes.length);
    this.b.set(bytes, this.n);
    this.n += bytes.length;
    return this;
  };
  Buf.prototype.bytes = function () { return this.b.subarray(0, this.n); };

  function dosTime(d) { return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31); }
  function dosDate(d) { return (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31); }

  /* Minimal ZIP writer, store method. entries = [{name, data:Uint8Array}] */
  function zip(entries) {
    var now = new Date(), tm = dosTime(now), dt = dosDate(now);
    var total = entries.reduce(function (a, e) { return a + e.data.length + e.name.length * 2 + 92; }, 128);
    var out = new Buf(total), central = new Buf(1024), offset = 0;

    entries.forEach(function (e) {
      var nameB = utf8(e.name), crc = crc32(e.data), len = e.data.length;

      out.u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(tm).u16(dt)
         .u32(crc).u32(len).u32(len).u16(nameB.length).u16(0)
         .raw(nameB).raw(e.data);

      central.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(tm).u16(dt)
             .u32(crc).u32(len).u32(len).u16(nameB.length).u16(0).u16(0)
             .u16(0).u16(0).u32(0).u32(offset).raw(nameB);

      offset += 30 + nameB.length + len;
    });

    var cd = central.bytes();
    out.raw(cd);
    out.u32(0x06054b50).u16(0).u16(0).u16(entries.length).u16(entries.length)
       .u32(cd.length).u32(offset).u16(0);

    /* .slice() rather than the subarray: a Blob built over a view into a
       buffer that is about to be garbage is a file that arrives truncated on
       exactly the machines that are short of memory. */
    return new Blob([out.bytes().slice()],
                    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ===================================================================== logo */

  var LOGO_CACHE = {};

  /* The mark, as PNG bytes, or null. Never throws and never rejects. */
  function logoBytes(path) {
    if (LOGO_CACHE[path] !== undefined) return Promise.resolve(LOGO_CACHE[path]);
    if (typeof Promise === 'undefined') return { then: function (f) { f(null); } };

    return new Promise(function (resolve) {
      var settled = false;
      var done = function (v) {
        if (settled) return;
        settled = true;
        LOGO_CACHE[path] = v;
        resolve(v);
      };

      var canvas;
      try {
        canvas = document.createElement('canvas');
        if (!canvas.getContext || !canvas.toDataURL) return done(null);
      } catch (e) { return done(null); }

      var img = new Image();
      /* An SVG with no intrinsic size draws as nothing; both marks carry
         width/height attributes, and this is the belt to that. */
      var timer = setTimeout(function () { done(null); }, 5000);

      img.onload = function () {
        clearTimeout(timer);
        try {
          /* 128px for a mark drawn at 32 — four times, so it stays crisp when
             the sheet is printed or the row is dragged taller. */
          var S = 128;
          canvas.width = S; canvas.height = S;
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, S, S);
          ctx.drawImage(img, 0, 0, S, S);
          var url = canvas.toDataURL('image/png');
          if (!url || url.indexOf('data:image/png;base64,') !== 0) return done(null);
          done(b64bytes(url.slice('data:image/png;base64,'.length)));
        } catch (e) {
          /* A tainted canvas throws here. Nothing to do but go without. */
          done(null);
        }
      };
      img.onerror = function () { clearTimeout(timer); done(null); };
      img.src = path;
    });
  }

  /* ===================================================================== xlsx */

  function xesc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');     // illegal in XML 1.0
  }

  function colName(i) {
    var s = '';
    i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  /* Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters,
     and it rejects the whole workbook rather than cleaning the name up. Titles
     reach this from `t()` and from shop data, so neither is under our control. */
  function sheetName(s) {
    var out = String(s || 'Report').replace(/[:\\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return out.slice(0, 31) || 'Report';
  }

  /* An Excel date serial: days since 1899-12-30. Built from the LOCAL calendar
     date, because a date typed as the 1st in Aleppo is the 28th of the month
     before in UTC, and a payroll sheet that moves everybody's payday back a
     day is a very quiet kind of wrong. */
  function excelDate(v) {
    if (v === null || v === undefined || v === '') return null;
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }

  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /* ---- styles -------------------------------------------------------------
     Indices are referenced by number from sheetXml below, so the two are kept
     side by side and the comments carry the numbers. Fill 0 must be none and
     fill 1 must be gray125 — Excel rejects the file otherwise. */
  var S = {
    text: 0, band: 1, brand: 2, num: 3, totLabel: 4, totNum: 5,
    sub: 6, title: 7, money: 8, usd: 9, pct: 10, date: 11,
    totMoney: 12, totUsd: 13, totPct: 14, totDate: 15,
    kpiLabel: 16, kpiValue: 17, note: 18, meta: 19
  };

  function stylesXml(th, ar) {
    /* Montserrat has no Arabic glyphs at all. Excel would substitute silently
       and inconsistently — one machine's fallback is not another's — so an
       Arabic sheet asks for a face that actually carries the script and is on
       every Windows since 7. */
    var face = ar ? 'Segoe UI' : 'Montserrat';
    var f = function (extra, size, colour) {
      return '<font>' + (extra || '') + '<sz val="' + size + '"/>' +
             '<color rgb="FF' + colour + '"/><name val="' + face + '"/></font>';
    };

    return XML +
    '<styleSheet xmlns="' + NS_MAIN + '">' +
      '<numFmts count="5">' +
        '<numFmt numFmtId="164" formatCode="#,##0"/>' +
        '<numFmt numFmtId="165" formatCode="#,##0&quot; SYP&quot;"/>' +
        '<numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/>' +
        '<numFmt numFmtId="167" formatCode="0.0%"/>' +
        '<numFmt numFmtId="168" formatCode="dd\\ mmm\\ yyyy"/>' +
      '</numFmts>' +
      '<fonts count="7">' +
        f('', 11, '18181B') +                          /* 0 body            */
        f('<b/>', 11, th.accent) +                     /* 1 header on ink   */
        f('<b/>', 18, th.accent) +                     /* 2 brand word      */
        f('<b/>', 11, '18181B') +                      /* 3 bold body       */
        f('', 9, '71717A') +                           /* 4 small muted     */
        f('<b/>', 8, '71717A') +                       /* 5 kpi label       */
        f('<b/>', 15, '18181B') +                      /* 6 kpi value       */
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF' + th.ink + '"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F8"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="3">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top style="medium"><color rgb="FF' + th.ink + '"/></top><bottom/><diagonal/></border>' +
        '<border><left/><right/><top/><bottom style="thick"><color rgb="FF' + th.accent + '"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="20">' +
        /*  0 text        */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        /*  1 band cell   */ '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        /*  2 brand word  */ '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
        /*  3 number      */ '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /*  4 tot label   */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        /*  5 tot number  */ '<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /*  6 subtitle    */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        /*  7 title       */ '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        /*  8 money SYP   */ '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /*  9 money USD   */ '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /* 10 percent     */ '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /* 11 date        */ '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /* 12 tot SYP     */ '<xf numFmtId="165" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /* 13 tot USD     */ '<xf numFmtId="166" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /* 14 tot pct     */ '<xf numFmtId="167" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /* 15 tot date    */ '<xf numFmtId="168" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /* 16 kpi label   */ '<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
        /* 17 kpi value   */ '<xf numFmtId="0" fontId="6" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
        /* 18 note        */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        /* 19 meta line   */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  }

  function cellStr(ref, style, text) {
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
           xesc(text) + '</t></is></c>';
  }
  function cellNum(ref, style, val) {
    var n = Number(val);
    if (!isFinite(n)) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
  }
  function cellBlank(ref, style) { return '<c r="' + ref + '" s="' + style + '"/>'; }

  /* One data cell, from the column's declared type. `totals` swaps in the
     bordered bold variants so the last row cannot drift out of format when a
     column is added. */
  function cellFor(ref, col, v, totals) {
    var st = totals ? {
      text: S.totLabel, num: S.totNum, money: S.totMoney,
      usd: S.totUsd, pct: S.totPct, date: S.totDate
    } : {
      text: S.text, num: S.num, money: S.money,
      usd: S.usd, pct: S.pct, date: S.date
    };

    if (v === null || v === undefined || v === '') return cellBlank(ref, totals ? S.totLabel : S.text);

    if (col.date) {
      var serial = excelDate(v);
      return serial === null ? cellStr(ref, st.text, v) : cellNum(ref, st.date, serial);
    }
    if (col.pct) {
      var p = Number(v);
      /* Divided by 100 because Excel's % format multiplies by 100 to draw it.
         Rounded after the division, or 53.3 lands in the file as
         0.5329999999999999 — which Excel draws correctly but which is what
         anybody looking at the XML, or at a cell set to more decimals, sees.
         Left as text if it is not a number at all, rather than written as 0 —
         which would read as "sold at cost". */
      return isFinite(p) ? cellNum(ref, st.pct, Math.round(p * 1e8) / 1e10)
                         : cellStr(ref, st.text, v);
    }
    if (col.money) {
      var m = Number(v);
      return isFinite(m) ? cellNum(ref, col.money === 'USD' ? st.usd : st.money, m)
                         : cellStr(ref, st.text, v);
    }
    if (col.num || col.int) {
      var n = Number(v);
      return isFinite(n) ? cellNum(ref, st.num, n) : cellStr(ref, st.text, v);
    }
    return cellStr(ref, st.text, v);
  }

  /* The whole sheet, and the row numbers everything else has to agree with. */
  function sheetLayout(spec) {
    var kpis = (spec.kpis || []).filter(Boolean);
    /* 1 band · 2 title · 3 subtitle · 4 generated-line · 5 blank
       then the KPI pair, then a blank, then the header row. */
    var headerRow = kpis.length ? 8 : 6;
    return {
      kpis: kpis,
      kpiLabelRow: kpis.length ? 6 : 0,
      kpiValueRow: kpis.length ? 7 : 0,
      headerRow: headerRow,
      firstDataRow: headerRow + 1,
      lastDataRow: headerRow + (spec.rows || []).length,
      totalsRow: spec.totals ? headerRow + (spec.rows || []).length + 1 : 0
    };
  }

  function sheetXml(spec, th, hasLogo) {
    var cols = spec.columns, n = cols.length;
    var L = sheetLayout(spec);
    var lastCol = colName(Math.max(0, n - 1));
    var body = '', merges = [], i, ci;
    var ar = (typeof OG !== 'undefined' && OG.lang === 'ar');

    /* ---- row 1: the band ----
       The mark is a floating picture anchored over column A, so the word sits
       in B1 and leaves it room. With a single-column sheet there is no B, and
       the word takes A1 back. */
    var wordCell = (n > 1 && hasLogo) ? 1 : 0;
    body += '<row r="1" ht="36" customHeight="1">';
    for (i = 0; i < n; i++) {
      body += (i === wordCell) ? cellStr(colName(i) + '1', S.brand, th.word)
                               : cellBlank(colName(i) + '1', S.band);
    }
    body += '</row>';
    if (n > wordCell + 1) merges.push(colName(wordCell) + '1:' + lastCol + '1');

    /* ---- rows 2-4: what this is, of when, run by whom ---- */
    body += '<row r="2" ht="22" customHeight="1">' + cellStr('A2', S.title, spec.title || '') + '</row>';
    body += '<row r="3">' + cellStr('A3', S.sub, spec.subtitle || '') + '</row>';
    body += '<row r="4">' + cellStr('A4', S.meta, exportStamp()) + '</row>';
    if (n > 1) {
      merges.push('A2:' + lastCol + '2', 'A3:' + lastCol + '3', 'A4:' + lastCol + '4');
    }
    body += '<row r="5"/>';

    /* ---- the KPI band ----
       Dropped from the spreadsheet entirely until now: the same spec drew them
       on the PDF and threw them away here, so the two files told the reader
       different things about the same report. */
    if (L.kpis.length) {
      var wide = Math.min(L.kpis.length, Math.max(1, n));
      body += '<row r="' + L.kpiLabelRow + '" ht="15" customHeight="1">';
      for (i = 0; i < n; i++) {
        body += i < wide ? cellStr(colName(i) + L.kpiLabelRow, S.kpiLabel, L.kpis[i].label)
                         : cellBlank(colName(i) + L.kpiLabelRow, S.kpiLabel);
      }
      body += '</row><row r="' + L.kpiValueRow + '" ht="26" customHeight="1">';
      for (i = 0; i < n; i++) {
        body += i < wide ? cellStr(colName(i) + L.kpiValueRow, S.kpiValue, L.kpis[i].value)
                         : cellBlank(colName(i) + L.kpiValueRow, S.kpiValue);
      }
      body += '</row>';
      /* KPIs past the last column would have nowhere to sit; they are on the
         PDF in full and the sheet takes what fits rather than overflowing into
         cells the header row does not cover. */
    }

    /* ---- the header ---- */
    body += '<row r="' + L.headerRow + '" ht="22" customHeight="1">';
    cols.forEach(function (c, k) { body += cellStr(colName(k) + L.headerRow, S.band, c.label); });
    body += '</row>';

    /* ---- the data ---- */
    var row = L.firstDataRow;
    (spec.rows || []).forEach(function (rw) {
      body += '<row r="' + row + '">';
      cols.forEach(function (c, k) { body += cellFor(colName(k) + row, c, rw[k], false); });
      body += '</row>';
      row++;
    });

    if (spec.totals) {
      body += '<row r="' + L.totalsRow + '">';
      cols.forEach(function (c, k) { body += cellFor(colName(k) + L.totalsRow, c, spec.totals[k], true); });
      body += '</row>';
      row = L.totalsRow + 1;
    }

    /* ---- the footnote ----
       The sentence that says what the figures do NOT include: archived stock,
       or that a debt balance is not filtered by the date range. It travels
       with the file, because the file outlives the screen it was taken from. */
    var lastRow = row;
    if (spec.note) {
      row += 1;
      body += '<row r="' + row + '" ht="46" customHeight="1">' + cellStr('A' + row, S.note, spec.note) + '</row>';
      if (n > 1) merges.push('A' + row + ':' + lastCol + row);
      lastRow = row;
    }

    var colsXml = '<cols>';
    cols.forEach(function (c, k) {
      colsXml += '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' +
                 (c.width || (c.date ? 14 : (c.money ? 18 : (c.pct ? 11 : (c.num || c.int ? 13 : 24))))) +
                 '" customWidth="1"/>';
    });
    colsXml += '</cols>';

    var mergeXml = merges.length
      ? '<mergeCells count="' + merges.length + '">' +
        merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') +
        '</mergeCells>'
      : '';

    /* AutoFilter over the header and the data. Not over the totals row: a
       filter that hides rows while the total stays put is the fastest way to
       make a spreadsheet lie to somebody. */
    var filterXml = (spec.rows || []).length
      ? '<autoFilter ref="A' + L.headerRow + ':' + lastCol + L.lastDataRow + '"/>'
      : '';

    /* Wide reports go landscape. Fit-to-width with no page limit, so a long
       report runs down as many pages as it needs and never across. */
    var landscape = n > 5;

    /* THE ORDER OF THESE ELEMENTS IS FIXED by the schema — sheetPr, dimension,
       sheetViews, sheetFormatPr, cols, sheetData, autoFilter, mergeCells,
       printOptions, pageMargins, pageSetup, headerFooter, drawing — and Excel
       refuses to open a workbook that gets it wrong, with a repair dialog that
       names no element. */
    return XML +
      '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        '<dimension ref="A1:' + lastCol + Math.max(1, lastRow) + '"/>' +
        '<sheetViews><sheetView workbookViewId="0" showGridLines="0"' +
          (ar ? ' rightToLeft="1"' : '') + '>' +
          '<pane ySplit="' + L.headerRow + '" topLeftCell="A' + L.firstDataRow +
            '" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        colsXml +
        '<sheetData>' + body + '</sheetData>' +
        filterXml +
        mergeXml +
        '<printOptions horizontalCentered="1"/>' +
        '<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.55" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="' + (landscape ? 'landscape' : 'portrait') +
          '" fitToWidth="1" fitToHeight="0"/>' +
        '<headerFooter><oddFooter>&amp;L' + xesc(th.word) + '&amp;C' +
          xesc(spec.title || '') + '&amp;RPage &amp;P / &amp;N</oddFooter></headerFooter>' +
        (hasLogo ? '<drawing r:id="rId3"/>' : '') +
      '</worksheet>';
  }

  /* Who ran this, and when. A report with no provenance is a report somebody
     will argue with in six weeks. */
  function exportStamp() {
    var bits = [];
    try { bits.push(t('ex_generated') + ' ' + fmtDateTime(new Date())); }
    catch (e) { bits.push(new Date().toISOString()); }
    try { if (CONFIG.SHOP_NAME) bits.push(CONFIG.SHOP_NAME); } catch (e) {}
    try {
      var me = (typeof Auth !== 'undefined' && Auth.user && Auth.user()) || null;
      if (me && me.name) bits.push(me.name);
    } catch (e) {}
    return bits.join('  ·  ');
  }

  function drawingXml() {
    /* One picture, anchored into A1 with a small inset, 32x32 px. EMU are
       1/9525 of a pixel; the extent on the anchor and on the shape have to
       agree or Excel draws it at a size of its own choosing. */
    var px = function (v) { return Math.round(v * 9525); };
    var size = px(32);
    return XML +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<xdr:oneCellAnchor>' +
          '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>' + px(8) + '</xdr:colOff>' +
            '<xdr:row>0</xdr:row><xdr:rowOff>' + px(8) + '</xdr:rowOff></xdr:from>' +
          '<xdr:ext cx="' + size + '" cy="' + size + '"/>' +
          '<xdr:pic>' +
            '<xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="' + xesc(THEMES.og.word) + '"/>' +
              '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
            '<xdr:blipFill><a:blip xmlns:r="' + NS_REL + '" r:embed="rId1"/>' +
              '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
            '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + size + '" cy="' + size + '"/></a:xfrm>' +
              '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
          '</xdr:pic>' +
          '<xdr:clientData/>' +
        '</xdr:oneCellAnchor>' +
      '</xdr:wsDr>';
  }

  function corePropsXml(spec) {
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var who = '';
    try {
      var me = (typeof Auth !== 'undefined' && Auth.user && Auth.user()) || null;
      who = (me && me.name) || '';
    } catch (e) {}
    var shop = '';
    try { shop = CONFIG.SHOP_NAME || ''; } catch (e) {}
    return XML +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + xesc(spec.title || 'Report') + '</dc:title>' +
        '<dc:subject>' + xesc(spec.subtitle || '') + '</dc:subject>' +
        '<dc:creator>' + xesc(who || shop || 'OG System') + '</dc:creator>' +
        '<cp:lastModifiedBy>' + xesc(who || shop || 'OG System') + '</cp:lastModifiedBy>' +
        '<cp:keywords>' + xesc(shop) + '</cp:keywords>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function appPropsXml() {
    return XML +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>OG System</Application><Company>' +
        xesc((function () { try { return CONFIG.SHOP_NAME || ''; } catch (e) { return ''; } })()) +
        '</Company></Properties>';
  }

  function buildXlsx(spec, logo) {
    var th = theme(spec.theme);
    var ar = (typeof OG !== 'undefined' && OG.lang === 'ar');
    /* A one-column sheet has no B1 for the word to move into, so the picture
       would float on top of it. The word wins: it says which company the file
       came from, and a logo lying across it says nothing at all. */
    var hasLogo = !!(logo && logo.length && spec.columns.length > 1);
    var L = sheetLayout(spec);
    var name = sheetName(spec.sheet || spec.title || 'Report');

    var parts = [
      { name: '[Content_Types].xml', text: XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        (hasLogo ? '<Default Extension="png" ContentType="image/png"/>' : '') +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        (hasLogo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>' },

      { name: '_rels/.rels', text: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="' + NS_REL + '/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>' },

      { name: 'docProps/core.xml', text: corePropsXml(spec) },
      { name: 'docProps/app.xml', text: appPropsXml() },

      { name: 'xl/workbook.xml', text: XML +
        '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<sheets><sheet name="' + xesc(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
        /* Repeat the header row on every printed page. Without it a report
           that runs to four pages has three pages of unlabelled columns —
           which is the state every one of these exports was in. */
        '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' +
          '\'' + xesc(name.replace(/'/g, "''")) + '\'!$' + L.headerRow + ':$' + L.headerRow +
        '</definedName></definedNames>' +
        '</workbook>' },

      { name: 'xl/_rels/workbook.xml.rels', text: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + NS_REL + '/styles" Target="styles.xml"/>' +
        '</Relationships>' },

      { name: 'xl/styles.xml', text: stylesXml(th, ar) },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml(spec, th, hasLogo) }
    ];

    if (hasLogo) {
      parts.push(
        { name: 'xl/worksheets/_rels/sheet1.xml.rels', text: XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId3" Type="' + NS_REL + '/drawing" Target="../drawings/drawing1.xml"/>' +
          '</Relationships>' },
        { name: 'xl/drawings/drawing1.xml', text: drawingXml() },
        { name: 'xl/drawings/_rels/drawing1.xml.rels', text: XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="' + NS_REL + '/image" Target="../media/logo.png"/>' +
          '</Relationships>' }
      );
    }

    var entries = parts.map(function (p) { return { name: p.name, data: utf8(p.text) }; });
    if (hasLogo) entries.push({ name: 'xl/media/logo.png', data: logo });
    return zip(entries);
  }

  /* ====================================================================== pdf */

  /* The chart, in PAPER colours.

     Charts.printSnapshot rebuilds the chart on white with ink gridlines and
     near-black tick labels. What used to happen here was toDataURL() on the
     live canvas — a chart painted for a near-black card, dropped onto a white
     A4 sheet, where the lime series and the #A1A1AA axis labels are the two
     palest things on the page.

     Every fallback below is still here, in order: the paper redraw, then the
     raw canvas (better than nothing), then the CSS-bar markup the offline
     path renders when Chart.js never loaded. */
  function chartMarkup(chartId) {
    if (!chartId) return '';
    var el = document.getElementById(chartId);

    if (el && el.tagName === 'CANVAS') {
      if (typeof Charts !== 'undefined' && Charts.printSnapshot) {
        var paper = Charts.printSnapshot(chartId);
        if (paper) return '<img class="pdf-chart" src="' + paper + '" alt="">';
      }
      try {
        var url = el.toDataURL('image/png');
        if (url && url.length > 200) return '<img class="pdf-chart pdf-chart-raw" src="' + url + '" alt="">';
      } catch (e) { /* tainted — fall through */ }
    }

    var host = el ? el.parentNode : null;
    var fb = host && host.querySelector ? host.querySelector('.chart-fallback') : null;
    if (!fb) fb = document.querySelector('.chart-fallback');
    return fb ? '<div class="pdf-chart-fb">' + fb.innerHTML + '</div>' : '';
  }

  /* One cell, as the reader should see it. The same column spec that decides
     the Excel type decides this, so the two files cannot disagree about what
     a column means — which they did while the PDF branched on `typeof v`. */
  function pdfCell(col, v) {
    if (v === null || v === undefined || v === '') return '';
    if (col.date) {
      var d = new Date(v);
      return esc(isNaN(d.getTime()) ? v : fmtDate(d));
    }
    if (col.pct) return isFinite(Number(v)) ? esc(pct(Number(v), 1)) : esc(v);
    if (col.money) {
      var m = Number(v);
      if (!isFinite(m)) return esc(v);
      return '<bdi dir="ltr">' +
        esc(col.money === 'USD' ? '$' + m.toFixed(2) : nf(m) + ' SYP') + '</bdi>';
    }
    if (col.num || col.int) {
      var n = Number(v);
      return isFinite(n) ? '<bdi dir="ltr">' + esc(nf(n)) + '</bdi>' : esc(v);
    }
    return esc(v);
  }

  function numCls(col) { return (col.num || col.int || col.money || col.pct || col.date) ? ' class="num"' : ''; }

  function buildPdfHtml(spec) {
    var th = theme(spec.theme);
    var ar = (typeof OG !== 'undefined' && OG.lang === 'ar');
    /* The sheet declares its own direction rather than inheriting the app's,
       so a document opened while the UI is in Arabic lays out right-to-left
       on paper too — headers, table and footer together. */
    var h = '<div class="pdf-sheet' + (spec.theme === 'yalla' ? ' pdf-yalla' : '') + '"' +
            ' dir="' + (ar ? 'rtl' : 'ltr') + '">';

    h += '<div class="pdf-head">' +
        '<div class="pdf-brand"><img src="' + th.logo + '" alt=""><div>' +
          '<b>' + th.word + '</b><small>' + th.tag + '</small></div></div>' +
        '<div class="pdf-meta">' + esc(t('ex_generated')) + '<br><b dir="ltr">' + fmtDateTime(new Date()) + '</b>' +
          '<br>' + esc(CONFIG.SHOP_ADDRESS) + '</div>' +
      '</div>';

    h += '<h1 class="pdf-title">' + esc(spec.title || '') + '</h1>';
    if (spec.subtitle) h += '<div class="pdf-sub" dir="auto">' + esc(spec.subtitle) + '</div>';

    var kpis = (spec.kpis || []).filter(Boolean);
    if (kpis.length) {
      h += '<div class="pdf-kpis">';
      kpis.forEach(function (k) {
        h += '<div class="pdf-kpi"><span>' + esc(k.label) + '</span><b dir="auto">' + esc(k.value) + '</b></div>';
      });
      h += '</div>';
    }

    h += chartMarkup(spec.chartId);

    h += '<table class="pdf-tbl"><thead><tr>';
    spec.columns.forEach(function (c) {
      h += '<th' + numCls(c) + '>' + esc(c.label) + '</th>';
    });
    h += '</tr></thead><tbody>';

    var rows = spec.rows || [];
    if (!rows.length) {
      h += '<tr><td class="pdf-none" colspan="' + spec.columns.length + '">' +
           esc(t('rp_empty_range')) + '</td></tr>';
    }
    rows.forEach(function (rw) {
      h += '<tr>';
      spec.columns.forEach(function (c, ci) {
        h += '<td' + numCls(c) + '>' + pdfCell(c, rw[ci]) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody>';

    if (spec.totals) {
      h += '<tfoot><tr>';
      spec.columns.forEach(function (c, ci) {
        h += '<td' + numCls(c) + '>' + pdfCell(c, spec.totals[ci]) + '</td>';
      });
      h += '</tr></tfoot>';
    }
    h += '</table>';

    /* What the figures do NOT include, on the page, in words. */
    if (spec.note) h += '<div class="pdf-note" dir="auto">' + esc(spec.note) + '</div>';

    /* A real QR back into the system, so the printed page is not a dead end.
       A CONFIG.PUBLIC_URL deep link is 45 modules wide including the quiet
       zone; at 96px (~25mm on paper) that is 0.56mm per module, comfortably
       inside what a phone camera resolves. Shrinking this box is the fastest
       way to make every printed report unscannable — measure before you do. */
    var qr = '';
    if (spec.docUrl) {
      var svg = Codes.qrSVG(spec.docUrl, { size: 96, quiet: 2, style: 'square', dark: '#09090B' });
      if (svg) qr = '<div class="pdf-qr">' + svg + '<span>' + esc(t('ex_scan')) + '</span></div>';
    }

    h += '<div class="pdf-foot' + (qr ? ' has-qr' : '') + '">' + qr +
         '<div class="pdf-foot-txt">' + esc(th.word) + ' · ' + esc(CONFIG.SHOP_ADDRESS) + ' · ' +
         esc(t('ex_footer')) + '</div></div>';

    return h + '</div>';
  }

  /* ==================================================================== public */

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* Latin, lower case, no spaces: the file lands in Downloads beside a hundred
     others and the shop is on Windows, where a colon or a slash in a name is
     refused outright and Arabic in a name is a row of boxes in half the file
     dialogs it will pass through. */
  function fileSlug(s) {
    return String(s || 'report').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report';
  }

  function run(spec) {
    if (!spec || !spec.columns) return;

    if (spec.kind === 'xlsx') {
      toast(t('generating'), 'Excel', 'warn', 1200);
      var th = theme(spec.theme);
      var name = 'og-' + fileSlug(spec.name || 'report') + '-' + stamp() + '.xlsx';

      /* The logo is fetched and rasterised before the workbook is built, and
         a failure there resolves to null rather than rejecting — so the file
         is written either way, with the mark or with the word alone. The
         build itself is synchronous and is the only thing inside the try. */
      var write = function (logo) {
        try {
          download(name, buildXlsx(spec, logo));
          toast(t('export_ready'), name, 'ok', 4000);
        } catch (e) {
          console.error('xlsx export failed', e);
          toast(t('export_failed'), e.message, 'err', 5000);
        }
      };

      try {
        logoBytes(th.logo).then(write, function () { write(null); });
      } catch (e) {
        write(null);
      }
      return;
    }

    openModal({
      title: t('ex_pdf_preview') + ' · ' + (spec.title || ''),
      size: 'wide',
      body: buildPdfHtml(spec),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            '<span class="muted small" style="margin-inline-end:auto">' + t('ex_pdf_hint') + '</span>' +
            '<button class="btn btn-primary" data-act="print-doc">' + t('ex_save_pdf') + '</button>'
    });
  }

  return {
    run: run, download: download, buildXlsx: buildXlsx,
    crc32: crc32, zip: zip, utf8: utf8,
    /* Exposed for the export self-check — see _exportcheck.html. */
    sheetName: sheetName, excelDate: excelDate, logoBytes: logoBytes
  };
})();
