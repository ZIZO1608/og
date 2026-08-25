/* ==========================================================================
   OG SYSTEM — thermal product labels (Xprinter XP-235B, TSPL)
   --------------------------------------------------------------------------
   A separate system from the existing browser "Label Studio" elsewhere in
   this app (LABEL_SIZES / openLabelSheet / labelHTML / hw-test-label /
   hw-calibrate) — that one prints through the OS print dialog to whatever's
   configured in Windows. This one talks to a USB thermal printer that is
   not on the network, through a small agent process (agent/print-agent.js)
   or, if configured, a direct LAN socket. No shared state, no shared
   action names, no touched code between the two.

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

  var lastChoice = { station: null, preset: null };
  try {
    var saved = JSON.parse(localStorage.getItem('og_label_choice') || 'null');
    if (saved) lastChoice = saved;
  } catch (e) { /* ignore a corrupt/blocked localStorage */ }

  function remember(station, preset) {
    lastChoice = { station: station || lastChoice.station, preset: preset || lastChoice.preset };
    try { localStorage.setItem('og_label_choice', JSON.stringify(lastChoice)); } catch (e) { /* private mode etc. */ }
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
  function barcodeFor(variant, presetObj) {
    var barcode = variant.barcode || '';
    var validEan = /^\d{13}$/.test(barcode) && Codes.ean13Valid(barcode);
    if (presetObj.allowEan && validEan) return { symbology: 'ean13', content: barcode, fallbackReason: null };
    var reason = !presetObj.allowEan
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
  function demoLayout(variant, presetObj) {
    var widthDots = presetObj.widthMm * DOTS_PER_MM, heightDots = presetObj.heightMm * DOTS_PER_MM;
    var marginDots = Math.round(2.5 * DOTS_PER_MM);
    var bc = barcodeFor(variant, presetObj);
    var bcWidth = computeBarcodeWidthDemo(bc.symbology, bc.content, presetObj);
    var barcodeHeightDots = presetObj.barcodeHeightMm * DOTS_PER_MM;
    var logo = presetObj.logo === 'omit' ? null : { xDots: marginDots, yDots: 4, wDots: 40, hDots: 40 };
    var textLeft = presetObj.logo === 'left-of-text' ? marginDots + 46 : marginDots;
    var y = (logo && presetObj.logo !== 'left-of-text') ? logo.yDots + logo.hDots + 4 : 6;
    var nameHeightDots = presetObj.nameLines * 22;
    var name = { xDots: textLeft, yDots: y, widthDots: widthDots - textLeft - marginDots, heightDots: nameHeightDots, maxLines: presetObj.nameLines, arabic: isArabic(variant.name), text: variant.name };
    y += nameHeightDots + 4;
    var variantLine = { xDots: textLeft, yDots: y, text: String(variant.size) };
    y += 30;
    var barcodeY = Math.max(y, heightDots - barcodeHeightDots - 26);
    var barcode = {
      xDots: Math.max(marginDots, Math.round((widthDots - bcWidth.widthDots) / 2)), yDots: barcodeY,
      wDots: bcWidth.widthDots, hDots: barcodeHeightDots, symbology: bc.symbology, content: bc.content, fallbackReason: bc.fallbackReason
    };
    return { widthDots: widthDots, heightDots: heightDots, logo: logo, name: name, variant: variantLine, barcode: barcode };
  }

  function demoPresets() {
    return [
      { key: '30x30', widthMm: 30, heightMm: 30, gapMm: 2, logo: 'small-top', nameLines: 2, barcodeHeightMm: 12, allowEan: false },
      { key: '30x20', widthMm: 30, heightMm: 20, gapMm: 2, logo: 'omit', nameLines: 1, barcodeHeightMm: 9, allowEan: false },
      { key: '40x30', widthMm: 40, heightMm: 30, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 13, allowEan: true },
      { key: '50x30', widthMm: 50, heightMm: 30, gapMm: 2, logo: 'left-of-text', nameLines: 2, barcodeHeightMm: 13, allowEan: true }
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
  function renderPreview(lines, presetKey) {
    if (typeof Auth === 'undefined' || Auth.demoMode()) {
      var presetObj = demoPreset(presetKey);
      var out = lines.map(function (l) {
        var v = DB.variantBySku(l.sku || l.variantId);
        if (!v) return null;
        return { sku: v.sku, qty: l.qty, name: v.name || (DB.product(v.productId) || {}).name || v.sku, size: v.size, layout: demoLayout({ name: v.name || (DB.product(v.productId) || {}).name || v.sku, size: v.size, barcode: v.barcode, labelCode: v.labelCode }, presetObj) };
      }).filter(Boolean);
      return Promise.resolve({ preset: presetObj, lines: out });
    }
    return API.post('/api/labels/preview', { lines: lines, preset: presetKey });
  }

  function labelPreviewHTML(line, presetObj) {
    var L = line.layout;
    var mm = function (dots) { return (dots / DOTS_PER_MM) + 'mm'; };
    var boxes = '';
    if (L.logo) {
      boxes += '<img class="lbl-logo" style="left:' + mm(L.logo.xDots) + ';top:' + mm(L.logo.yDots) +
        ';width:' + mm(L.logo.wDots) + ';height:' + mm(L.logo.hDots) + '" src="assets/logo.svg" alt="">';
    }
    /* height + overflow:hidden so the preview clips at exactly the box the
       bitmap will be rasterized into — an Arabic name skips wrapName's
       ellipsis truncation (only Latin text goes through it) and is instead
       clipped by canvas height when printed, so the preview has to clip
       the same way or it would show text that never comes out on paper. */
    boxes += '<div class="lbl-name" style="left:' + mm(L.name.xDots) + ';top:' + mm(L.name.yDots) +
      ';width:' + mm(L.name.widthDots) + ';height:' + mm(L.name.heightDots) + ';overflow:hidden"' +
      (L.name.arabic ? ' dir="rtl"' : '') + '>' + esc(line.name) + '</div>';
    boxes += '<div class="lbl-variant" style="left:' + mm(L.variant.xDots) + ';top:' + mm(L.variant.yDots) + '">' + esc(line.size) + '</div>';
    boxes += '<div class="lbl-barcode" style="left:' + mm(L.barcode.xDots) + ';top:' + mm(L.barcode.yDots) +
      ';width:' + mm(L.barcode.wDots) + ';height:' + mm(L.barcode.hDots) + '">' +
      (L.barcode.symbology === 'ean13' ? Codes.ean13SVG(L.barcode.content) : Codes.code128SVG(L.barcode.content)) +
      (L.barcode.fallbackReason ? '<small class="lbl-fallback">' + t('lbl_fallback') + '</small>' : '') +
      '</div>';
    var sticker = '<div class="lbl-sticker" style="width:' + presetObj.widthMm + 'mm;height:' + presetObj.heightMm + 'mm">' + boxes + '</div>';
    return '<div class="lbl-line">' + sticker +
      '<label class="lbl-line-qty"><span>' + t('lbl_qty') + '</span>' +
        '<input class="inp num" type="number" min="0" max="99" value="' + line.qty +
          '" data-change="lbl-line-qty" data-sku="' + esc(line.sku) + '"></label>' +
      '</div>';
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

  /* Only the lines whose resolved name is actually Arabic get a bitmap —
     per-string detection, exactly as specified, not per-label. */
  function buildArabicBitmaps(previewData) {
    var out = {};
    previewData.lines.forEach(function (l) {
      if (l.layout.name.arabic) {
        out[l.sku] = { name: rasterizeArabic(l.name, l.layout.name.widthDots, l.layout.name.heightDots, l.layout.name.maxLines) };
      }
    });
    return out;
  }

  /* ------------------------------------------------------------- printing */
  function doPrint(lines, presetKey, station) {
    if (typeof Auth === 'undefined' || Auth.demoMode()) {
      toast(t('lbl_title'), t('lbl_demo_only'), 'info', 5000);
      return Promise.resolve(null);
    }
    if (!station) {
      toast(t('lbl_title'), t('lbl_pick_station'), 'err', 4000);
      return Promise.resolve(null);
    }
    remember(station, presetKey);
    return renderPreview(lines, presetKey).then(function (preview) {
      var arabicBitmaps = buildArabicBitmaps(preview);
      return API.post('/api/labels/print', {
        lines: lines, preset: presetKey, station: station,
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
  function presetOptions() {
    return (typeof Auth === 'undefined' || Auth.demoMode()) ? demoPresets() : ((typeof CONFIG !== 'undefined' && CONFIG.LABEL_PRESETS) || demoPresets());
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
    var total = lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);

    var h = '<div class="lbl-picker">';
    h += '<div class="lbl-batch-total"><b>' + total + '</b> ' + t('lbl_batch_total') + '</div>';
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_station') + '</span>';
    stationOptions().forEach(function (s) {
      h += '<button class="chip ' + (s === st ? 'on' : '') + '" data-act="label-station" data-k="' + esc(s) + '">' + esc(s) + '</button>';
    });
    h += '</div>';
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_preset') + '</span>';
    presetOptions().forEach(function (p) {
      h += '<button class="chip ' + (p.key === pk ? 'on' : '') + '" data-act="label-preset" data-k="' + esc(p.key) + '">' + p.key + '</button>';
    });
    h += '</div></div>';
    return h;
  }

  function openPreviewModal(lines, presetKey, station) {
    presetKey = presetKey || lastChoice.preset || (typeof CONFIG !== 'undefined' && CONFIG.LABEL_DEFAULT_PRESET) || '30x30';
    station = station || lastChoice.station || stationOptions()[0];
    remember(station, presetKey);
    activeLines = lines.filter(function (l) { return (Number(l.qty) || 0) > 0; });
    if (!activeLines.length) { if (typeof closeModal === 'function') closeModal(); return; }
    lines = activeLines;

    renderPreview(lines, presetKey).then(function (preview) {
      var body = pickerHTML(lines) +
        '<div class="lbl-preview-host">' +
        preview.lines.map(function (l) { return labelPreviewHTML(l, preview.preset); }).join('') +
        '</div>';

      openModal({
        title: t('lbl_preview_title'),
        body: body,
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="print-labels" data-lines=\'' + esc(JSON.stringify(lines)).replace(/'/g, '&#39;') +
              '\'>' + t('lbl_print_now') + '</button>'
      });
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
      doPrint(lines, lastChoice.preset, lastChoice.station).then(function (res) {
        if (res) { activeLines = null; if (typeof closeModal === 'function') closeModal(); }
      });
    };

    /* Inside the batch modal these re-open it with the new choice so the
       preview reflects it immediately; the Settings card's station/preset
       chips (no open batch) just remember the choice and re-render the page. */
    ACTIONS['label-station'] = function (el) {
      remember(el.getAttribute('data-k'), null);
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };
    ACTIONS['label-preset'] = function (el) {
      remember(null, el.getAttribute('data-k'));
      if (activeLines && activeLines.length) openPreviewModal(activeLines, lastChoice.preset, lastChoice.station);
      else if (typeof render === 'function' && typeof OG !== 'undefined' && OG.view === 'settings') render();
    };

    ACTIONS['label-calibrate'] = function (el) {
      if (typeof Auth === 'undefined' || Auth.demoMode()) return;
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
        openPreviewModal(next, lastChoice.preset, lastChoice.station);
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
        openPreviewModal(next, lastChoice.preset, lastChoice.station);
      });
    }
  }

  return {
    register: register,
    renderPreview: renderPreview,
    doPrint: doPrint,
    openPreviewModal: openPreviewModal,
    lastChoice: function () { return lastChoice; },
    stationOptions: stationOptions,
    presetOptions: presetOptions
  };
})();
