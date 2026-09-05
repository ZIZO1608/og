/* ==========================================================================
   OG SYSTEM — thermal product labels (Xprinter XP-235B, TSPL)
   --------------------------------------------------------------------------
   THE product label. Every "Print labels" in the app — the Print-labels
   screen, the Products row and drawer, the scan result, the warehouse form
   after a save, a bulk selection, the shelf map's reprint — ends in this
   module's preview, drawn from the server's layout of a label_templates
   row. There used to be a second browser-side "Label Studio" with its own
   templates and the SKU text in the bars, and a third 60x40 layout; both
   are gone, so the same shoe gets the same sticker whichever door it is
   printed from.

   Two ways out of the preview, chosen per machine (lastChoice.output):

     station  the server builds TSPL and queues it for the label printer —
              the print agent (agent/print-agent.js) on the laptop the USB
              printer is plugged into, or a direct LAN socket;
     browser  the very same layout, at true millimetres, through this
              computer's own print dialog — the part of the old studio worth
              keeping, and the only path that works on a machine with no
              agent and no LAN printer. Recorded in label_print_log as
              'printed' (see printViaBrowser).

   TSPL is generated on the SERVER — it resolves each variant's real name,
   size, and code itself, never trusting what a browser sends. The one
   exception is Arabic text, which TSPL's native TEXT command cannot shape:
   when a name is Arabic, THIS module rasterizes just that text run to a
   1-bit bitmap (reusing ESCPOS.packBitmap from the receipt feature) and
   sends it along; the server splices it into the TSPL it is otherwise
   building entirely on its own.
   ========================================================================== */

var Labels = (function () {

  var DOTS_PER_MM = 8;
  /* CSS pixels per millimetre: a CSS pixel is 1/96 inch by definition, so
     this is exact rather than a calibration — the same constant
     js/labels60.js uses to put a 60 mm label on screen at 60 mm. */
  var MM_PX = 96 / 25.4;

  /* Per MACHINE, like the sidebar rail: the warehouse laptop has the USB
     printer and the office prints through Windows. `output` is which of the
     two ways out of the preview this machine uses — 'station' hands the
     server-built TSPL to the label printer's queue, 'browser' prints the
     very same layout at true millimetres through this computer's own print
     dialog. `paper` only matters to the browser path: one sticker per page
     on a roll, or flowing across an A4 sticker sheet. */
  /* `barcodeType` defaults to the shop's own label code, not 'auto'. Auto
     puts an EAN-13 on a sticker wide enough for one and the label code on
     one that is not, so the same shoe carried different bars on a 30 mm
     roll and a 40 mm roll — both scanned, and both looked wrong side by
     side. The label code is six digits in Code 128 C: the same bars on every
     template, and at 6 dots a bar on the 60x40 roll the most scannable
     thing the printer can put down. Auto and always-EAN stay as chips. */
  var lastChoice = { station: null, preset: null, barcodeType: 'code128', output: null, paper: 'roll' };
  try {
    var saved = JSON.parse(localStorage.getItem('og_label_choice') || 'null');
    if (saved) lastChoice = saved;
  } catch (e) { /* ignore a corrupt/blocked localStorage */ }
  if (!lastChoice.barcodeType) lastChoice.barcodeType = 'code128';
  if (lastChoice.paper !== 'sheet') lastChoice.paper = 'roll';

  function remember(station, preset, barcodeType, output, paper) {
    lastChoice = {
      station: station || lastChoice.station,
      preset: preset || lastChoice.preset,
      barcodeType: barcodeType || lastChoice.barcodeType || 'code128',
      output: output || lastChoice.output || null,
      paper: paper || lastChoice.paper || 'roll'
    };
    try { localStorage.setItem('og_label_choice', JSON.stringify(lastChoice)); } catch (e) { /* private mode etc. */ }
  }

  /* Which way out of the preview this machine takes when nobody has chosen
     yet. A transport of 'tcp' with no address is a label printer the server
     cannot reach — the state this shop was in, with ten failed jobs in the
     queue and nothing on screen to say why — so the first print goes through
     the dialog that can actually put ink on paper. Once a station has been
     picked here, that choice sticks. */
  function outputChoice() {
    if (lastChoice.output === 'station' || lastChoice.output === 'browser') return lastChoice.output;
    if (typeof Auth === 'undefined') return 'browser';
    var cfg = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    if (cfg.LABEL_TRANSPORT === 'tcp' && !cfg.LABEL_PRINTER_HOST) return 'browser';
    return 'station';
  }

  var ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  function isArabic(s) { return ARABIC_RE.test(String(s || '')); }

  function opId() { return 'lbl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10); }

  /* ------------------------------------------------------------- symbology
     Mirrors server/lib/labels.js's barcodeFor/computeBarcodeWidth exactly —
     duplicated on purpose, same reasoning as Codes.ean13Check already being
     duplicated between js/codes.js and server/lib/catalogue.js. Needed only
     for the DEMO-mode preview, which has no server to ask. */
  var EAN13_MODULES = 11 + 95 + 7;
  function code128ModuleCount(digits) {
    var s = String(digits), pairs = Math.floor(s.length / 2), odd = s.length % 2 === 1;
    var symbols = 1 + pairs + (odd ? 2 : 0) + 1 + 1;
    return (symbols - 1) * 11 + 13;
  }
  function barcodeFor(variant, presetObj, barcodeType) {
    var barcode = variant.barcode || '';
    var validEan = /^\d{13}$/.test(barcode) && Codes.ean13Valid(barcode);
    var forced = barcodeType === 'ean13' || barcodeType === 'code128';
    var tryEan = barcodeType === 'ean13' || (!forced && presetObj.allowEan && validEan);
    if (tryEan && validEan) return { symbology: 'ean13', content: barcode, fallbackReason: null };
    var reason = barcodeType === 'code128'
      ? null
      : !presetObj.allowEan
        ? presetObj.widthMm + 'mm is narrower than the 40mm EAN-13 needs'
        : 'no valid EAN-13 on this variant';
    return { symbology: 'code128', content: variant.labelCode, fallbackReason: reason };
  }
  function computeBarcodeWidthDemo(symbology, content, presetObj) {
    var modules = symbology === 'ean13' ? EAN13_MODULES : code128ModuleCount(content);
    var usableDots = (presetObj.widthMm - 2 * 2.5) * DOTS_PER_MM;
    var narrowDots = Math.max(2, Math.floor(usableDots / modules));
    return { narrowDots: narrowDots, widthDots: narrowDots * modules };
  }
  /* Demo mode has no server to ask for a template, so it still renders from
     the old fixed 4-preset shape (demoPresets() below) — but the OUTPUT is
     now the same generic `fields` array the live path produces, so
     labelPreviewHTML/buildArabicBitmaps only need to know one shape. */
  function demoLayout(variant, presetObj, barcodeType) {
    var widthDots = presetObj.widthMm * DOTS_PER_MM, heightDots = presetObj.heightMm * DOTS_PER_MM;
    var marginDots = Math.round(2.5 * DOTS_PER_MM);
    var bc = barcodeFor(variant, presetObj, barcodeType);
    var bcWidth = computeBarcodeWidthDemo(bc.symbology, bc.content, presetObj);
    var barcodeHeightDots = presetObj.barcodeHeightMm * DOTS_PER_MM;
    var logo = presetObj.logo === 'omit' ? null : { xDots: marginDots, yDots: 4, wDots: 40, hDots: 40 };
    var textLeft = presetObj.logo === 'left-of-text' ? marginDots + 46 : marginDots;
    var y = (logo && presetObj.logo !== 'left-of-text') ? logo.yDots + logo.hDots + 4 : 6;
    var nameHeightDots = presetObj.nameLines * 22;
    var nameArabic = isArabic(variant.name);
    var nameYDots = y;
    y += nameHeightDots + 4;
    var variantYDots = y;
    y += 30;
    var barcodeY = Math.max(y, heightDots - barcodeHeightDots - 26);

    var fields = [];
    if (logo) fields.push({ kind: 'logo', type: 'image', xDots: logo.xDots, yDots: logo.yDots, wDots: logo.wDots, hDots: logo.hDots });
    fields.push({
      kind: 'name', type: nameArabic ? 'bitmap' : 'text', arabic: nameArabic,
      xDots: textLeft, yDots: nameYDots, wDots: widthDots - textLeft - marginDots, hDots: nameHeightDots,
      text: variant.name
    });
    fields.push({ kind: 'variant', type: 'text', xDots: textLeft, yDots: variantYDots, text: String(variant.size) });
    fields.push({
      kind: 'barcode', type: 'barcode',
      xDots: Math.max(marginDots, Math.round((widthDots - bcWidth.widthDots) / 2)), yDots: barcodeY,
      wDots: bcWidth.widthDots, hDots: barcodeHeightDots,
      symbology: bc.symbology, content: bc.content, fallbackReason: bc.fallbackReason
    });
    return { widthDots: widthDots, heightDots: heightDots, fields: fields };
  }

  function demoPresets() {
    return [
      { key: '30x30', widthMm: 30, heightMm: 30, gapMm: 2, logo: 'small-top', nameLines: 2, barcodeHeightMm: 12, allowEan: false },
      { key: '30x20', widthMm: 30, heightMm: 20, gapMm: 2, logo: 'omit', nameLines: 1, barcodeHeightMm: 9, allowEan: false },
      { key: '40x30', widthMm: 40, heightMm: 30, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 13, allowEan: true },
      { key: '50x30', widthMm: 50, heightMm: 30, gapMm: 2, logo: 'left-of-text', nameLines: 2, barcodeHeightMm: 13, allowEan: true },
      /* Mirrors the '60x40' row seeded in server/migrations/011_label_templates.sql
         (proportions only — this demo shape is for the offline/no-server
         preview, the live print always renders from that DB template). */
      { key: '60x40', widthMm: 60, heightMm: 40, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 14, allowEan: true }
    ];
  }
  function demoPreset(key) {
    var p = demoPresets().filter(function (x) { return x.key === key; })[0];
    return p || demoPresets()[0];
  }

  /* ------------------------------------------------------------- preview
     Live mode asks the server for the SAME layout object the TSPL builder
     will use, so preview cannot drift from what prints. Demo mode computes
     the same shape locally — there is no server to ask. */
  function renderPreview(lines, presetKey, barcodeType) {
    if (typeof Auth === 'undefined') {
      var presetObj = demoPreset(presetKey);
      var out = lines.map(function (l) {
        var v = DB.variantBySku(l.sku || l.variantId);
        if (!v) return null;
        return { sku: v.sku, qty: l.qty, name: v.name || (DB.product(v.productId) || {}).name || v.sku, size: v.size, layout: demoLayout({ name: v.name || (DB.product(v.productId) || {}).name || v.sku, size: v.size, barcode: v.barcode, labelCode: v.labelCode }, presetObj, barcodeType) };
      }).filter(Boolean);
      return Promise.resolve({ preset: presetObj, lines: out });
    }
    return API.post('/api/labels/preview', { lines: lines, preset: presetKey, barcodeType: barcodeType });
  }

  /* One DOM box per field, generic over kind — logo/barcode render their
     real content, text/bitmap fields just show the relevant string (a DOM
     preview gets real Arabic shaping from the browser natively, so bitmap
     fields don't need a canvas here — only the actual print does). */
  function fieldPreviewHTML(f, line) {
    var mm = function (dots) { return (dots / DOTS_PER_MM) + 'mm'; };
    var style = 'left:' + mm(f.xDots) + ';top:' + mm(f.yDots);
    if (f.wDots != null) style += ';width:' + mm(f.wDots);
    if (f.hDots != null) style += ';height:' + mm(f.hDots);

    if (f.type === 'image') {
      return '<img class="lbl-logo" style="' + style + '" src="assets/logo.svg" alt="">';
    }
    if (f.type === 'barcode') {
      /* Drawn at the printer's own bar width — `narrowDots` per module, the
         number the TSPL BARCODE command is given — and the bar height the
         slot reserved, so the preview and the browser print carry bars of
         exactly the width the label printer would lay down. It used to be
         the SVG's default module squeezed into the box with width:100%,
         which drew a 51 mm barcode 30 mm wide and hid the quiet zones
         inside it.

         The SVG generators put a quiet zone either side of the bars; the
         server's box is the bars alone (its slots are inset for the quiet
         zone already), so the drawing is pulled left by that much and the
         quiet zone falls in the margin, where it is on the printed label. */
      var mod = ((f.narrowDots || 2) / DOTS_PER_MM) * MM_PX;
      var barH = ((f.hDots || 80) / DOTS_PER_MM) * MM_PX;
      var quiet = f.symbology === 'ean13' ? 11 : 10;
      var opts = { module: mod, height: barH, text: f.showHri !== false };
      var svg = f.symbology === 'ean13' ? Codes.ean13SVG(f.content, opts) : Codes.code128SVG(f.content, opts);
      return '<div class="lbl-barcode" style="' + style + '">' +
        '<div class="lbl-bars" style="margin-left:-' + (quiet * mod) + 'px">' + svg + '</div>' +
        (f.fallbackReason ? '<small class="lbl-fallback">' + t('lbl_fallback') + '</small>' : '') +
        '</div>';
    }

    var raw = f.type === 'bitmap'
      ? (f.kind === 'name' ? line.name : f.kind === 'variant' ? String(line.size) : ((typeof CONFIG !== 'undefined' && CONFIG.SHOP_NAME) || ''))
      : f.text;
    /* overflow:hidden on a bitmap field so the preview clips at exactly the
       box the bitmap will be rasterized into — an Arabic field skips the
       ellipsis truncation Latin text gets and is instead clipped by canvas
       height when printed, so the preview has to clip the same way. */
    return '<div class="lbl-' + f.kind + '" style="' + style + (f.type === 'bitmap' ? ';overflow:hidden' : '') + '"' +
      (f.arabic ? ' dir="rtl"' : '') + '>' + esc(raw || '') + '</div>';
  }

  /* One sticker, at the millimetres it will be on the roll. This is the
     preview AND the thing the browser path prints — the same boxes from the
     same server layout, so what is approved on screen is what comes out of
     either printer. */
  function stickerHTML(line, presetObj) {
    var boxes = (line.layout.fields || []).map(function (f) { return fieldPreviewHTML(f, line); }).join('');
    return '<div class="lbl-sticker" style="width:' + presetObj.widthMm + 'mm;height:' + presetObj.heightMm + 'mm">' + boxes + '</div>';
  }

  function labelPreviewHTML(line, presetObj) {
    return '<div class="lbl-line">' + stickerHTML(line, presetObj) +
      '<label class="lbl-line-qty"><span>' + t('lbl_qty') + '</span>' +
        '<input class="inp num" type="number" min="0" max="99" value="' + line.qty +
          '" data-change="lbl-line-qty" data-sku="' + esc(line.sku) + '"></label>' +
      '</div>';
  }

  /* The sheet the browser path prints: every sticker repeated by its qty, in
     the order of the batch. Hidden on screen (the preview above is the one
     with the qty boxes) and the only thing visible under @media print. */
  function printSheetHTML(preview) {
    var out = '';
    preview.lines.forEach(function (l) {
      var one = stickerHTML(l, preview.preset);
      for (var i = 0; i < (Number(l.qty) || 0); i++) out += one;
    });
    return '<div class="lbl-print-sheet' + (lastChoice.paper === 'sheet' ? ' lbl-a4' : '') + '" id="lblPrintSheet">' + out + '</div>';
  }

  /* --------------------------------------------------------- Arabic bitmap
     One offscreen canvas per Arabic field, sized to the exact dot box the
     server's layout reserved, drawn at 1 canvas px = 1 printer dot so no
     scaling step can blur it, then packed with the SAME function the
     receipt feature uses (ESCPOS.packBitmap) — same polarity (ESC/POS,
     1=black); the server inverts it exactly once before embedding. */
  function rasterizeArabic(text, widthDots, heightDots, maxLines) {
    maxLines = maxLines || 2;
    var c = document.createElement('canvas');
    c.width = Math.ceil(widthDots / 8) * 8;   // ESCPOS.packBitmap requires a multiple of 8
    c.height = Math.max(8, heightDots);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    var lineH = Math.floor(c.height / maxLines);
    var fontPx = Math.max(8, Math.floor(lineH * 0.72));
    ctx.font = fontPx + "px 'Montserrat','Segoe UI',Tahoma,sans-serif";

    /* Greedy word wrap by real measured width — the same approach proven
       correct for Arabic shaping in js/receipt.js's wrapText, so a label's
       name box actually uses its 1-2 reserved lines instead of drawing one
       line and letting anything past the canvas edge fall off silently. */
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width > c.width - 4 && cur) {
        lines.push(cur);
        cur = words[i];
        if (lines.length === maxLines) break;
      } else {
        cur = next;
      }
    }
    if (lines.length < maxLines && cur) lines.push(cur);

    var consumed = lines.join(' ').split(/\s+/).length;
    if (lines.length === maxLines && consumed < words.length) {
      var last = lines[maxLines - 1];
      while (ctx.measureText(last + '…').width > c.width - 4 && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last + '…';
    }

    lines.forEach(function (line, i) { ctx.fillText(line, c.width - 2, i * lineH + 2); });

    var bmp = ESCPOS.packBitmap(c);
    return { bytesPerRow: bmp.bytesPerRow, height: bmp.height, dataB64: bytesToB64(bmp.data) };
  }
  function bytesToB64(u8) {
    var bin = '';
    for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  /* Only fields whose resolved text is actually Arabic get a bitmap — per
     FIELD detection, exactly as specified, not per-label. Keyed by the
     field's `kind` (name/variant/header/...) so the server can splice each
     one into the right spot — see arabicBitmaps[sku][kind] in
     server/lib/labels.js's buildLabelBytes. */
  function buildArabicBitmaps(previewData) {
    var out = {};
    previewData.lines.forEach(function (l) {
      var bitmaps = {};
      (l.layout.fields || []).forEach(function (f) {
        if (f.type !== 'bitmap') return;
        var raw = f.kind === 'name' ? l.name
          : f.kind === 'variant' ? String(l.size)
          : (typeof CONFIG !== 'undefined' && CONFIG.SHOP_NAME) || '';
        var maxLines = f.kind === 'name' ? 2 : 1;
        bitmaps[f.kind] = rasterizeArabic(raw, f.wDots, f.hDots, maxLines);
      });
      if (Object.keys(bitmaps).length) out[l.sku] = bitmaps;
    });
    return out;
  }

  /* ------------------------------------------------------------- printing */

  /* The preview the open modal was drawn from — the browser path prints
     exactly this, so nothing is recomputed between approving and printing. */
  var lastPreview = null;

  /* Through this computer's own print dialog: the same server layout at true
     millimetres, one sticker per page on a roll. Recorded AFTER the dialog
     closes and recorded as 'printed', not 'done': window.print() returns
     whether Print or Cancel was pressed and nothing can tell them apart, so
     "sent to the printer" is the most the log can honestly claim — the same
     rule js/labels60.js applies to the shelf labels. */
  function printViaBrowser(lines, presetKey) {
    var preview = lastPreview;
    var fresh = (preview && preview.preset && preview.preset.key === presetKey)
      ? Promise.resolve(preview)
      : renderPreview(lines, presetKey, lastChoice.barcodeType);
    return fresh.then(function (pv) {
      var host = document.querySelector('.modal-body');
      if (!host) throw new Error('no preview open');
      var old = document.getElementById('lblPrintSheet');
      if (old) old.parentNode.removeChild(old);
      host.insertAdjacentHTML('beforeend', printSheetHTML(pv));

      if (typeof setRollPageSize === 'function') {
        setRollPageSize(lastChoice.paper === 'sheet' ? null : { w: pv.preset.widthMm, h: pv.preset.heightMm });
      }
      document.body.classList.add('printing-labels');
      try { window.print(); } finally { document.body.classList.remove('printing-labels'); }

      var items = pv.lines.map(function (l) { return { subjectType: 'variant', subjectId: l.sku, qty: l.qty }; });
      var n = items.reduce(function (a, it) { return a + (Number(it.qty) || 0); }, 0);
      return API.post('/api/labels/record', { preset: presetKey, station: 'browser', items: items })
        .then(function (res) { return { labelCount: n, batchId: res.batchId, browser: true }; })
        .catch(function (err) {
          /* The paper has already come out. A missing audit row must not
             read as a failed print. */
          toast(t('lbl_title'), t('l60_not_logged') + ' — ' + API.friendly(err), 'warn', 6000);
          return { labelCount: n, browser: true, unlogged: true };
        });
    });
  }

  function doPrint(lines, presetKey, station, barcodeType) {
    if (typeof Auth === 'undefined') {
      toast(t('lbl_title'), t('lbl_demo_only'), 'info', 5000);
      return Promise.resolve(null);
    }
    presetKey = presetKey || lastChoice.preset;
    barcodeType = barcodeType || lastChoice.barcodeType || 'code128';

    if (outputChoice() === 'browser') {
      remember(null, presetKey, barcodeType);
      return printViaBrowser(lines, presetKey).then(function (res) {
        if (!res.unlogged) toast(t('lbl_title'), t('lbl_sent_browser').replace('{n}', res.labelCount), 'ok', 5000);
        return res;
      }).catch(function (err) {
        toast(t('lbl_title'), typeof API !== 'undefined' ? API.friendly(err) : err.message, 'err', 6000);
        throw err;
      });
    }

    if (!station) {
      toast(t('lbl_title'), t('lbl_pick_station'), 'err', 4000);
      return Promise.resolve(null);
    }
    remember(station, presetKey, barcodeType);
    return renderPreview(lines, presetKey, barcodeType).then(function (preview) {
      var arabicBitmaps = buildArabicBitmaps(preview);
      return API.post('/api/labels/print', {
        lines: lines, preset: presetKey, station: station, barcodeType: barcodeType,
        opId: opId(), arabicBitmaps: arabicBitmaps
      });
    }).then(function (res) {
      toast(t('lbl_title'), t('lbl_queued').replace('{n}', res.labelCount).replace('{station}', station), 'ok', 5000);
      if (typeof OG !== 'undefined') OG.labelQueue = undefined;
      return res;
    }).catch(function (err) {
      toast(t('lbl_title'), API.friendly(err), 'err', 6000);
      throw err;
    });
  }

  function stationOptions() {
    var raw = (typeof CONFIG !== 'undefined' && CONFIG.LABEL_STATIONS) || 'warehouse-laptop,till-1';
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  /* The template chips: GET /api/labels/templates, fetched at boot into
     CONFIG.LABEL_TEMPLATES — the same `label_templates` rows the server
     renders from and the mirror carries. `config.label.presets` was a second
     list of the same thing that nothing kept in step; it is only the backstop
     now, for a session that booted before the route answered. */
  function presetOptions() {
    if (typeof Auth === 'undefined') return demoPresets();
    var cfg = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    if (cfg.LABEL_TEMPLATES && cfg.LABEL_TEMPLATES.length) return cfg.LABEL_TEMPLATES;
    return cfg.LABEL_PRESETS || demoPresets();
  }
  function currentPreset() {
    var pk = lastChoice.preset || (typeof CONFIG !== 'undefined' && CONFIG.LABEL_DEFAULT_PRESET) || '30x30';
    return presetOptions().filter(function (p) { return p.key === pk; })[0] || presetOptions()[0] || demoPreset(pk);
  }
  /* A template's name in the language on screen, falling back to its key —
     the chips used to show '30x30' and 'retail-price-tag' verbatim. */
  function presetLabel(p) {
    if (typeof OG !== 'undefined' && OG.lang === 'ar' && p.nameAr) return p.nameAr;
    return p.name || p.key;
  }

  /* The batch modal's working copy of {sku, qty} — mutated by the qty
     inputs and by a scan while the modal is open, then re-rendered by
     re-calling openPreviewModal rather than patching the DOM by hand. Only
     one batch modal is ever open at a time, so one module-level slot is
     enough. */
  var activeLines = null;

  function pickerHTML(lines) {
    var st = lastChoice.station || stationOptions()[0];
    var pk = lastChoice.preset || (typeof CONFIG !== 'undefined' && CONFIG.LABEL_DEFAULT_PRESET) || '30x30';
    var bt = lastChoice.barcodeType || 'code128';
    var out = outputChoice();
    var total = lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
    var curPreset = presetOptions().filter(function (p) { return p.key === pk; })[0] || {};

    var h = '<div class="lbl-picker no-print">';
    h += '<div class="lbl-batch-total"><b>' + total + '</b> ' + t('lbl_batch_total') +
      ' <span class="muted">· ' + t('lbl_same_everywhere') + '</span></div>';

    /* Where the labels come out. The station chips only appear for the
       printer's queue; the paper chips only for the dialog. */
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_output') + '</span>' +
      '<button class="chip ' + (out === 'station' ? 'on' : '') + '" data-act="label-output" data-k="station">' + t('lbl_out_station') + '</button>' +
      '<button class="chip ' + (out === 'browser' ? 'on' : '') + '" data-act="label-output" data-k="browser">' + t('lbl_out_browser') + '</button>' +
      '</div>';
    if (out === 'station') {
      h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_station') + '</span>';
      stationOptions().forEach(function (s) {
        h += '<button class="chip ' + (s === st ? 'on' : '') + '" data-act="label-station" data-k="' + esc(s) + '">' + esc(s) + '</button>';
      });
      h += '</div>';
    } else {
      h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('hw_mode') + '</span>' +
        '<button class="chip ' + (lastChoice.paper !== 'sheet' ? 'on' : '') + '" data-act="label-paper" data-k="roll">' + t('hw_roll') + '</button>' +
        '<button class="chip ' + (lastChoice.paper === 'sheet' ? 'on' : '') + '" data-act="label-paper" data-k="sheet">' + t('hw_sheet') + '</button>' +
        '</div>';
    }
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_preset') + '</span>';
    presetOptions().forEach(function (p) {
      h += '<button class="chip ' + (p.key === pk ? 'on' : '') + '" data-act="label-preset" data-k="' + esc(p.key) + '" title="' +
        esc(p.widthMm + ' × ' + p.heightMm + ' mm') + '">' + esc(presetLabel(p)) + '</button>';
    });
    h += '</div>';
    if (curPreset.hasBarcode !== false) {
      h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_barcode_type') + '</span>';
      [
        { k: 'auto', label: t('lbl_bt_auto') },
        { k: 'ean13', label: t('lbl_bt_ean13'), disabled: curPreset.allowEan === false },
        { k: 'code128', label: t('lbl_bt_code128') }
      ].forEach(function (b) {
        h += b.disabled
          ? '<button class="chip" disabled title="' + esc(t('lbl_bt_ean_disabled')) + '">' + b.label + '</button>'
          : '<button class="chip ' + (b.k === bt ? 'on' : '') + '" data-act="label-barcode-type" data-k="' + b.k + '">' + b.label + '</button>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function openPreviewModal(lines, presetKey, station, barcodeType) {
    presetKey = presetKey || lastChoice.preset || (typeof CONFIG !== 'undefined' && CONFIG.LABEL_DEFAULT_PRESET) || '30x30';
    station = station || lastChoice.station || stationOptions()[0];
    barcodeType = barcodeType || lastChoice.barcodeType || 'code128';
    remember(station, presetKey, barcodeType);
    lines = lines.filter(function (l) { return (Number(l.qty) || 0) > 0; });
    if (!lines.length) { if (typeof closeModal === 'function') closeModal(); return; }

    renderPreview(lines, presetKey, barcodeType).then(function (preview) {
      var body = pickerHTML(lines) +
        '<div class="lbl-preview-host no-print">' +
        preview.lines.map(function (l) { return labelPreviewHTML(l, preview.preset); }).join('') +
        '</div>';

      var out = outputChoice();
      openModal({
        title: t('lbl_preview_title'),
        size: 'wide',
        body: body,
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="print-labels" data-lines=\'' + esc(JSON.stringify(lines)).replace(/'/g, '&#39;') +
              '\'>' + (out === 'browser' ? t('print') : t('lbl_print_now')) + '</button>',
        onClose: function () { lastPreview = null; activeLines = null; }
      });
      /* Set AFTER openModal: opening closes whatever was open first, and
         that runs the previous modal's onClose above — which would wipe a
         batch assigned any earlier. */
      activeLines = lines;
      lastPreview = preview;
    }).catch(function (err) {
      toast(t('lbl_title'), typeof API !== 'undefined' ? API.friendly(err) : err.message, 'err', 6000);
    });
  }

  /* ------------------------------------------------------------- register */
  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['preview-labels'] = function (el) {
      var lines;
      try { lines = JSON.parse(el.getAttribute('data-lines') || '[]'); } catch (e) { lines = []; }
      if (!lines.length) {
        var sku = el.getAttribute('data-variant-sku');
        if (sku) {
          var host = el.closest('tr') || el.parentNode;
          var qtyInp = host ? host.querySelector('.lbl-qty-inp') : null;
          var qty = qtyInp ? Math.max(1, parseInt(qtyInp.value, 10) || 1) : 1;
          lines = [{ sku: sku, qty: qty }];
        }
      }
      if (!lines.length) return;
      openPreviewModal(lines, el.getAttribute('data-preset'), el.getAttribute('data-station'));
    };

    ACTIONS['print-labels'] = function (el) {
      var lines = activeLines;
      if (!lines) { try { lines = JSON.parse(el.getAttribute('data-lines') || '[]'); } catch (e) { lines = []; } }
      if (!lines || !lines.length) return;
      if (typeof allow === 'function' && !allow('label.print')) {
        toast(t('lbl_title'), t('no_access'), 'err');
        return;
      }
      doPrint(lines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType).then(function (res) {
        if (res) { activeLines = null; if (typeof closeModal === 'function') closeModal(); }
      });
    };

    /* Inside the batch modal these re-open it with the new choice so the
       preview reflects it immediately; the Settings card's station/preset
       chips (no open batch) just remember the choice and re-render the page. */
    ACTIONS['label-station'] = function (el) {
      remember(el.getAttribute('data-k'), null, null);
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };
    ACTIONS['label-preset'] = function (el) {
      remember(null, el.getAttribute('data-k'), null);
      /* Switching to a preset too narrow for EAN-13 while "Always EAN-13"
         was selected would leave an invalid choice stranded behind a chip
         that just vanished — downgrade back to Auto instead. */
      var np = presetOptions().filter(function (p) { return p.key === lastChoice.preset; })[0];
      if (np && np.allowEan === false && lastChoice.barcodeType === 'ean13') remember(null, null, 'code128');
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };
    ACTIONS['label-barcode-type'] = function (el) {
      remember(null, null, el.getAttribute('data-k'));
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };
    ACTIONS['label-output'] = function (el) {
      remember(null, null, null, el.getAttribute('data-k'));
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };
    ACTIONS['label-paper'] = function (el) {
      remember(null, null, null, null, el.getAttribute('data-k'));
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };

    ACTIONS['label-calibrate'] = function (el) {
      if (typeof Auth === 'undefined') return;
      var station = lastChoice.station || stationOptions()[0];
      API.post('/api/labels/calibrate', { station: station, opId: opId() })
        .then(function () { toast(t('lbl_title'), t('lbl_calibrate_sent'), 'ok', 4000); })
        .catch(function (err) { toast(t('lbl_title'), API.friendly(err), 'err', 5000); });
    };

    ACTIONS['label-cancel-job'] = function (el) {
      API.post('/api/labels/' + el.getAttribute('data-id') + '/cancel', {})
        .then(function () {
          if (typeof OG !== 'undefined') OG.labelQueue = undefined;
          if (typeof render === 'function') render();
        })
        .catch(function (err) { toast(t('lbl_title'), API.friendly(err), 'err', 4000); });
    };

    /* Editing a line's qty re-opens the modal with the updated list — the
       preview and the barcode/EAN choice depend on the layout, which is
       cheapest to just recompute rather than patch by hand. A row emptied
       to 0 drops out of the batch entirely. */
    if (typeof CHANGES !== 'undefined') {
      CHANGES['lbl-line-qty'] = function (el) {
        if (!activeLines) return;
        var sku = el.getAttribute('data-sku');
        var qty = Math.max(0, parseInt(el.value, 10) || 0);
        var next = activeLines.map(function (l) { return l.sku === sku ? { sku: sku, qty: qty } : l; });
        openPreviewModal(next, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      };
    }

    /* A scanner in wedge mode types fast and ends with Enter, and fires
       globally regardless of what has focus — a bare qty <input> would
       otherwise just eat the scan as if someone had typed it by hand. So
       while the batch modal is open, a scan is resolved to a variant and
       increments that row instead of ever reaching a focused field: nobody
       both scans a box and clicks into a qty field at the same instant, so
       there is no real ambiguity to resolve. */
    if (typeof Wedge !== 'undefined' && Wedge.onScan) {
      Wedge.onScan(function (code) {
        if (!activeLines || !document.querySelector('.lbl-picker')) return;
        var v = (typeof DB !== 'undefined' && DB.variantByLabelCode && DB.variantByLabelCode(code)) ||
                (typeof DB !== 'undefined' && DB.variantByBarcode && DB.variantByBarcode(code)) ||
                (typeof DB !== 'undefined' && DB.variantBySku && DB.variantBySku(code));
        if (!v) return;
        var found = false;
        var next = activeLines.map(function (l) {
          if (l.sku === v.sku) { found = true; return { sku: l.sku, qty: l.qty + 1 }; }
          return l;
        });
        if (!found) next.push({ sku: v.sku, qty: 1 });
        openPreviewModal(next, lastChoice.preset, lastChoice.station, lastChoice.barcodeType);
      });
    }
  }

  return {
    register: register,
    renderPreview: renderPreview,
    doPrint: doPrint,
    openPreviewModal: openPreviewModal,
    lastChoice: function () { return lastChoice; },
    outputChoice: outputChoice,
    stationOptions: stationOptions,
    presetOptions: presetOptions,
    currentPreset: currentPreset,
    presetLabel: presetLabel
  };
})();
