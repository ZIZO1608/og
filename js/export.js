/* ==========================================================================
   OG SYSTEM — branded exports
   --------------------------------------------------------------------------
   Real files, no libraries.

     Export.run(spec)   spec.kind = 'xlsx' | 'pdf'

   XLSX is written by hand: a ZIP built with the store method (no deflate),
   a CRC-32 implementation, and the OOXML parts. Strings go inline so there
   is no sharedStrings table to keep in sync. Branding lives in styles.xml —
   black header band, lime type, Montserrat, real number formats so figures
   arrive in Excel as numbers rather than text.

   PDF is a light A4 document rendered as HTML and sent through the browser's
   Save-as-PDF. Writing a PDF byte encoder by hand would mean embedding and
   subsetting fonts and hand-shaping Arabic — it would look worse, not better.
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
    /* Fallback for very old engines — the demo targets Chrome, but cheap. */
    var esc = unescape(encodeURIComponent(str)), out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
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

  function Buf() { this.a = []; }
  Buf.prototype.u16 = function (v) { this.a.push(v & 255, (v >>> 8) & 255); return this; };
  Buf.prototype.u32 = function (v) { this.a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; };
  Buf.prototype.raw = function (b) { for (var i = 0; i < b.length; i++) this.a.push(b[i]); return this; };
  Buf.prototype.bytes = function () { return new Uint8Array(this.a); };

  function dosTime(d) { return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31); }
  function dosDate(d) { return (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31); }

  /* Minimal ZIP writer, store method. entries = [{name, data:Uint8Array}] */
  function zip(entries) {
    var now = new Date(), tm = dosTime(now), dt = dosDate(now);
    var out = new Buf(), central = new Buf(), offset = 0;

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

    return new Blob([out.bytes()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* Fill 0 must be none and fill 1 must be gray125 — Excel rejects the file
     otherwise. Everything after that is ours. */
  function stylesXml(th) {
    return XML +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>' +
      '<fonts count="5">' +
        '<font><sz val="11"/><color rgb="FF18181B"/><name val="Montserrat"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF' + th.accent + '"/><name val="Montserrat"/></font>' +
        '<font><b/><sz val="18"/><color rgb="FF' + th.accent + '"/><name val="Montserrat"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF18181B"/><name val="Montserrat"/></font>' +
        '<font><sz val="9"/><color rgb="FF71717A"/><name val="Montserrat"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF' + th.ink + '"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top style="medium"><color rgb="FF' + th.ink + '"/></top><bottom/><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="8">' +
        /* 0 default text */
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        /* 1 header band */
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
          '<alignment vertical="center"/></xf>' +
        /* 2 title band */
        '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
          '<alignment vertical="center"/></xf>' +
        /* 3 number */
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        /* 4 totals label */
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        /* 5 totals number */
        '<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        /* 6 subtitle */
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        /* 7 report title */
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  }

  function cellStr(ref, style, text) {
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
           xesc(text) + '</t></is></c>';
  }
  function cellNum(ref, style, val) {
    return '<c r="' + ref + '" s="' + style + '"><v>' + (Number(val) || 0) + '</v></c>';
  }

  function sheetXml(spec, th) {
    var cols = spec.columns, n = cols.length, r, i, row = 1, body = '';
    var lastCol = colName(Math.max(0, n - 1));

    /* 1 branded band, 2 title, 3 subtitle, 4 blank, 5 header, 6+ data */
    body += '<row r="1" ht="30" customHeight="1">' + cellStr('A1', 2, th.word);
    for (i = 1; i < n; i++) body += '<c r="' + colName(i) + '1" s="1"/>';
    body += '</row>';

    body += '<row r="2" ht="20" customHeight="1">' + cellStr('A2', 7, spec.title || '') + '</row>';
    body += '<row r="3">' + cellStr('A3', 6, spec.subtitle || '') + '</row>';
    body += '<row r="4"/>';

    body += '<row r="5" ht="22" customHeight="1">';
    cols.forEach(function (c, ci) { body += cellStr(colName(ci) + '5', 1, c.label); });
    body += '</row>';

    row = 6;
    (spec.rows || []).forEach(function (rw) {
      body += '<row r="' + row + '">';
      cols.forEach(function (c, ci) {
        var ref = colName(ci) + row, v = rw[ci];
        if (v === null || v === undefined || v === '') body += '<c r="' + ref + '" s="0"/>';
        else if (c.num) body += cellNum(ref, 3, v);
        else body += cellStr(ref, 0, v);
      });
      body += '</row>';
      row++;
    });

    if (spec.totals) {
      body += '<row r="' + row + '">';
      cols.forEach(function (c, ci) {
        var ref = colName(ci) + row, v = spec.totals[ci];
        if (v === null || v === undefined || v === '') body += '<c r="' + ref + '" s="4"/>';
        else if (c.num) body += cellNum(ref, 5, v);
        else body += cellStr(ref, 4, v);
      });
      body += '</row>';
    }

    var colsXml = '<cols>';
    cols.forEach(function (c, ci) {
      colsXml += '<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' +
                 (c.width || (c.num ? 16 : 26)) + '" customWidth="1"/>';
    });
    colsXml += '</cols>';

    return XML +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' +
          '<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        colsXml +
        '<sheetData>' + body + '</sheetData>' +
        '<mergeCells count="1"><mergeCell ref="A1:' + lastCol + '1"/></mergeCells>' +
      '</worksheet>';
  }

  function buildXlsx(spec) {
    var th = theme(spec.theme);
    var parts = [
      { name: '[Content_Types].xml', text: XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', text: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', text: XML +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + xesc((spec.sheet || 'Report').slice(0, 28)) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: 'xl/styles.xml', text: stylesXml(th) },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml(spec, th) }
    ];

    return zip(parts.map(function (p) { return { name: p.name, data: utf8(p.text) }; }));
  }

  /* ====================================================================== pdf */

  /* Chart.js canvases hold only vector shapes and text, so they are not
     tainted and lift out cleanly. When the CSS-bar fallback rendered instead
     there is no canvas, so clone that markup and let the light overrides in
     style.css recolour it. */
  function chartMarkup(chartId) {
    if (!chartId) return '';
    var el = document.getElementById(chartId);
    if (el && el.tagName === 'CANVAS') {
      try {
        var url = el.toDataURL('image/png');
        if (url && url.length > 200) return '<img class="pdf-chart" src="' + url + '" alt="">';
      } catch (e) { /* tainted — fall through */ }
    }
    var host = el ? el.parentNode : null;
    var fb = host && host.querySelector ? host.querySelector('.chart-fallback') : null;
    if (!fb) fb = document.querySelector('.chart-fallback');
    return fb ? '<div class="pdf-chart-fb">' + fb.innerHTML + '</div>' : '';
  }

  function buildPdfHtml(spec) {
    var th = theme(spec.theme);
    var h = '<div class="pdf-sheet' + (spec.theme === 'yalla' ? ' pdf-yalla' : '') + '">';

    h += '<div class="pdf-head">' +
        '<div class="pdf-brand"><img src="' + th.logo + '" alt=""><div>' +
          '<b>' + th.word + '</b><small>' + th.tag + '</small></div></div>' +
        '<div class="pdf-meta">' + esc(t('ex_generated')) + '<br><b>' + fmtDateTime(new Date()) + '</b>' +
          '<br>' + esc(CONFIG.SHOP_ADDRESS) + '</div>' +
      '</div>';

    h += '<h1 class="pdf-title">' + esc(spec.title || '') + '</h1>';
    if (spec.subtitle) h += '<div class="pdf-sub">' + esc(spec.subtitle) + '</div>';

    if (spec.kpis && spec.kpis.length) {
      h += '<div class="pdf-kpis">';
      spec.kpis.forEach(function (k) {
        h += '<div class="pdf-kpi"><span>' + esc(k.label) + '</span><b>' + esc(k.value) + '</b></div>';
      });
      h += '</div>';
    }

    h += chartMarkup(spec.chartId);

    h += '<table class="pdf-tbl"><thead><tr>';
    spec.columns.forEach(function (c) {
      h += '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>';
    });
    h += '</tr></thead><tbody>';
    (spec.rows || []).forEach(function (rw) {
      h += '<tr>';
      spec.columns.forEach(function (c, ci) {
        var v = rw[ci];
        h += '<td' + (c.num ? ' class="num"' : '') + '>' +
             esc(c.num && typeof v === 'number' ? nf(v) : (v === null || v === undefined ? '' : v)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody>';
    if (spec.totals) {
      h += '<tfoot><tr>';
      spec.columns.forEach(function (c, ci) {
        var v = spec.totals[ci];
        h += '<td' + (c.num ? ' class="num"' : '') + '>' +
             esc(c.num && typeof v === 'number' ? nf(v) : (v === null || v === undefined ? '' : v)) + '</td>';
      });
      h += '</tr></tfoot>';
    }
    h += '</table>';

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

  function run(spec) {
    if (!spec || !spec.columns) return;

    if (spec.kind === 'xlsx') {
      toast(t('generating'), 'Excel', 'warn', 1000);
      /* let the toast paint before the synchronous build */
      setTimeout(function () {
        try {
          var name = 'og-' + (spec.name || 'report') + '-' + stamp() + '.xlsx';
          download(name, buildXlsx(spec));
          toast(t('export_ready'), name, 'ok', 4000);
        } catch (e) {
          console.error('xlsx export failed', e);
          toast(t('export_failed'), e.message, 'err', 5000);
        }
      }, 60);
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

  return { run: run, download: download, buildXlsx: buildXlsx, crc32: crc32, zip: zip, utf8: utf8 };
})();
