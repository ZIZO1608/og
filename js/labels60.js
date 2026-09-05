/* ==========================================================================
   OG SYSTEM — 60 x 40 mm thermal labels                       [labels60.js]
   --------------------------------------------------------------------------
   The SHELF label — the room name in Arabic, the grid code big enough to
   read from the far end of an aisle, what the shelf is FOR, and a barcode.
   It is about a rack, not a shoe, which is why it is not a row in
   label_templates: there is no sku, size or price to resolve. (The product
   label that used to share this file is now the 60x40 template, printed
   through js/labels.js like every other product label.)

   WHY THIS PRINTS THROUGH THE BROWSER AND NOT THROUGH js/labels.js.
   The other label system builds TSPL bytes on the server and sends them to a
   print agent. TSPL text commands are written as ASCII, so Arabic cannot go
   through them at all — the workaround there is to rasterise every Arabic run
   to a 1-bit bitmap in the browser and splice it in, keyed `bitmaps[sku][kind]`.
   A shelf label is one long Arabic room name and has no sku to key on. So
   these two go the way the Label Studio already goes: real millimetres in
   HTML, `@page` written with the numbers in it, and the operating system's own
   print dialog. Nothing about Arabic is special on that path — the browser
   shapes it, as it does on screen.

   EVERYTHING HERE IS BLACK OR WHITE. Thermal has no grey: every dot is burned
   or it is not, and a grey that the driver dithers comes off the roll as
   speckle. No shadows, no opacity, no anti-aliased images, no colour.

   THE NUMBERS, once, so nothing below has to guess:
     203 dpi = 8 dots/mm. A 60 x 40 label is exactly 480 x 320 dots.
     3 mm safe margin all round — the roll drifts as it feeds — leaving
     54 x 34 mm of content.
     Narrow bar = 3 dots = 0.375 mm. Two dots is unreliable; three scans.
   ========================================================================== */

var Labels60 = (function () {

  var W_MM = 60, H_MM = 40;
  var MARGIN_MM = 3;
  var MODULE_MM = 3 / 8;          /* 3 dots at 8 dots/mm */
  var BAR_MM = 9;                 /* bar height */
  var QUIET_MODULES = 10;         /* Codes.code128SVG adds this each side */

  /* CSS pixels per millimetre. A CSS pixel is 1/96 inch by definition and a
     millimetre is 25.4/96 of one, so this conversion is exact rather than a
     calibration — an SVG handed a width in these units prints at the
     millimetre it was derived from. */
  var MM_PX = 96 / 25.4;

  /* The preset name a shelf label records itself under in label_print_log.
     server/lib/labels.js holds the same string. The product label that used
     to live beside it here ('product-60x40') is gone: product labels come
     from the server's templates now, whichever door they are printed from,
     and the 60x40 template carries the shelf code this one used to. */
  var SHELF_PRESET = 'shelf-60x40';

  /* Arabic, Arabic Supplement, Extended-A and both Presentation Forms — the
     same test js/labels.js uses to decide a field needs the bitmap path. Here
     it only chooses a direction and a font. */
  var ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  function isArabic(s) { return ARABIC_RE.test(String(s || '')); }

  /* A text run that may be Arabic or Latin, marked so the browser lays it out
     the right way round. Font follows the script: Montserrat has no Arabic
     glyphs at all, and Cairo is vendored at weight 700 because lighter
     weights lose the dots on their letters at 203 dpi. */
  function run(text, cls) {
    var ar = isArabic(text);
    return '<div class="' + cls + (ar ? ' ar' : ' lat') + '" dir="' + (ar ? 'rtl' : 'ltr') + '">' +
           esc(text) + '</div>';
  }

  var state = null;

  /* ------------------------------------------------------------- barcodes */

  /* 'SH' + a two-digit warehouse + the room letter + the shelf code: SH01MA3.

     The warehouse and the room ride inside the payload so that opening a
     second warehouse, or a second room, does not mean reprinting every label
     already stuck to a rack. The 'SH' prefix is what lets a scan handler know
     instantly that a shelf was scanned and not a shoe.

     THE SEPARATORS ARE GONE ON PURPOSE, and this is the one place the shape
     differs from the way it was first sketched ('SH-1-M-A3'). At the mandated
     3 dots per narrow bar, Code 128 costs 11 modules per character: 'SH-1-M-A3'
     is 50.3 mm of bars, which fits, but 'SH-1-M-A12' — an ordinary shelf in a
     room more than nine columns wide — is 54.4 mm and does not, once a 3 mm
     margin and a 10-module quiet zone are honoured. Dropping three hyphens
     buys 12.4 mm and makes even 'SH99ZZ99' fit with 6.9 mm of white each side.
     Padding the warehouse to two digits keeps it unambiguous to parse:
     SH, two digits, one room letter, one row letter, then the column. */
  function shelfPayload(whCode, sectionKey, code) {
    if (whCode == null || whCode === '') return null;
    var n = Number(whCode);
    if (!isFinite(n) || n < 1 || n > 99) return null;
    return 'SH' + (n < 10 ? '0' + n : String(n)) + sectionKey + code;
  }

  /* Width of the finished symbol INCLUDING both quiet zones, in millimetres.
     Needed before drawing, so a payload that cannot fit is caught rather than
     silently printed running off the edge of the label. */
  function barcodeWidthMm(payload) {
    var mods = Codes.code128(payload);
    if (!mods) return null;
    return (mods.length + QUIET_MODULES * 2) * MODULE_MM;
  }

  /* The bars themselves, without the human-readable line — that is drawn
     separately below so it can be a real millimetre size in a real font
     rather than whatever the SVG generator picks. */
  function barcodeHTML(payload) {
    var svg = Codes.code128SVG(payload, {
      module: MODULE_MM * MM_PX,
      height: BAR_MM * MM_PX,
      text: false
    });
    /* code128SVG returns '' for anything Code Set B cannot express, and the
       failure is otherwise completely silent — an empty space where the
       barcode should be. Everything built here is A-Z and 0-9, so this cannot
       fire; it is here because a label that quietly loses its barcode is
       exactly the sort of thing nobody notices until a scanner is held to it. */
    if (!svg) return '<div class="l60-bc-bad">' + esc(t('l60_no_barcode')) + '</div>';
    return '<div class="l60-bc">' + svg + '</div>' +
           '<div class="l60-hri">' + esc(payload) + '</div>';
  }

  /* --------------------------------------------------------- the two labels */

  function shelfLabelHTML(sec, sh) {
    var payload = shelfPayload(sec.wh_code, sec.key, sh.code);
    var body =
      run(sec.name, 'l60-room') +
      '<div class="l60-code">' + esc(sh.code) + '</div>' +
      '<div class="l60-rule"></div>' +
      /* Blank when the shelf is not assigned to anything. A shelf with no
         product is a real and permanent state — it accepts whatever is put on
         it — and printing "unassigned" or a dash on a sticker that will be
         read for years is filler. The line keeps its height so every label in
         a batch is the same shape. */
      (sh.product_name ? run(sh.product_name, 'l60-for') : '<div class="l60-for"></div>');

    return label(body, payload);
  }

  /* One sticker. `.l60` is exactly 60 x 40 mm on screen and on paper — the
     preview is the label, not a picture of one. */
  function label(body, payload) {
    return '<div class="l60">' +
             '<div class="l60-in">' + body +
               (payload ? barcodeHTML(payload)
                        : '<div class="l60-bc-bad">' + esc(t('l60_no_wh_code')) + '</div>') +
             '</div>' +
           '</div>';
  }

  /* ------------------------------------------------------------- the sheet */

  function sheetHTML(items) {
    return '<div class="l60-sheet" id="l60Sheet">' + items.join('') + '</div>';
  }

  /* Shelves in the order somebody walks them: down the rows, along the
     columns — A1, A2, A3, B1, B2. Coming off the roll in any other order
     means sorting a pile of stickers by hand before leaving the office. */
  function gridOrder(a, b) {
    if (a.row_label !== b.row_label) return a.row_label < b.row_label ? -1 : 1;
    return a.col_index - b.col_index;
  }

  /* ------------------------------------------------------------- printing */

  /* `@page { size: … }` is the one property that cannot be driven by a class
     or a variable — the browser reads it from the stylesheet at print time —
     so the rule is written with the numbers in it, exactly the way
     setRollPageSize() does for the Label Studio. */
  function doPrint() {
    if (!state || !state.items.length) return;
    setRollPageSize({ w: W_MM, h: H_MM });
    window.print();

    /* Recorded AFTER the dialog closes, and recorded as 'printed' rather than
       'done'. window.print() returns whether the user pressed Print or Cancel
       and there is no callback that distinguishes them, so this is the most
       the shop can honestly claim: a label was sent to the printer. The other
       path's 'done' means a print agent came back and said it wrote bytes. */
    API.post('/api/labels/record', {
      preset: SHELF_PRESET,
      station: 'browser',
      items: state.record
    }).catch(function (err) {
      /* The paper has already come out. Failing to write the audit row must
         not look like a failed print. */
      toast(t('l60_not_logged') + ' — ' + API.friendly(err));
    });
  }

  /* --------------------------------------------------------------- modals */

  function previewModal(title, controls, footExtra) {
    openModal({
      title: title,
      size: 'wide',
      body: '<div class="l60-controls no-print">' + controls + '</div>' +
            '<div class="l60-head no-print">' +
              t('l60_true_size').replace('{n}', String(state.items.length)) +
            '</div>' +
            sheetHTML(state.items),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            (footExtra || '') +
            '<button class="btn btn-primary" data-act="l60-print"' +
              (state.items.length ? '' : ' disabled') + '>' +
              t('l60_print').replace('{n}', String(state.items.length)) + '</button>',
      onClose: function () { state = null; }
    });
  }

  /* Repaint in place rather than reopening: a modal that closes and reopens
     loses the scroll position of a forty-label sheet. */
  function repaint() {
    var body = document.querySelector('.modal-body');
    var sheet = document.getElementById('l60Sheet');
    if (!body || !sheet) return;
    sheet.outerHTML = sheetHTML(state.items);
    var head = body.querySelector('.l60-head');
    if (head) head.innerHTML = t('l60_true_size').replace('{n}', String(state.items.length));
    var btn = document.querySelector('[data-act="l60-print"]');
    if (btn) {
      btn.innerHTML = t('l60_print').replace('{n}', String(state.items.length));
      if (state.items.length) btn.removeAttribute('disabled');
      else btn.setAttribute('disabled', 'disabled');
    }
  }

  /* ------------------------------------------------------- shelf labels */

  /* `opts` preselects — {sectionId, code} — so the map's per-shelf print
     button opens on exactly that shelf instead of a whole-room batch. The
     from/to selects stay live, so widening back out is one change. */
  function openShelfLabels(whId, opts) {
    var wh = whId || DB.defaultWh;
    Shop.sections(wh).then(function (res) {
      var secs = (res.sections || []).filter(function (s) { return s.shelves.length; });
      if (!secs.length) {
        toast(t('l60_no_shelves'));
        return;
      }
      var secId = secs[0].id;
      if (opts && opts.sectionId && secs.some(function (s) { return s.id === opts.sectionId; })) {
        secId = opts.sectionId;
      }
      state = {
        kind: 'shelf', wh: wh, sections: secs,
        sectionId: secId,
        from: (opts && opts.code) || '', to: (opts && opts.code) || '',
        items: [], record: []
      };
      buildShelfItems();
      previewModal(t('l60_shelf_title'), shelfControls());
    }).catch(function (err) { toast(API.friendly(err)); });
  }

  function currentSection() {
    for (var i = 0; i < state.sections.length; i++) {
      if (state.sections[i].id === state.sectionId) return state.sections[i];
    }
    return state.sections[0];
  }

  function buildShelfItems() {
    var sec = currentSection();
    var list = sec.shelves.slice().sort(gridOrder);

    /* An inclusive range in walking order, so "A3 to B7" means the shelves
       you pass between them rather than a filter on the letters. */
    if (state.from) {
      var i = indexOfCode(list, state.from);
      if (i > -1) list = list.slice(i);
    }
    if (state.to) {
      var j = indexOfCode(list, state.to);
      if (j > -1) list = list.slice(0, j + 1);
    }

    state.items = list.map(function (sh) { return shelfLabelHTML(sec, sh); });
    state.record = list.map(function (sh) {
      return { subjectType: 'shelf', subjectId: String(sh.id), qty: 1 };
    });
    state.warnNoCode = sec.wh_code == null;
  }

  function indexOfCode(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return i;
    return -1;
  }

  function shelfControls() {
    var sec = currentSection();
    var list = sec.shelves.slice().sort(gridOrder);

    var h = '<label class="field"><span>' + t('l60_room') + '</span>' +
            '<select class="inp" data-change="l60-section">';
    state.sections.forEach(function (s) {
      h += '<option value="' + s.id + '"' + (s.id === state.sectionId ? ' selected' : '') + '>' +
           esc(s.key + ' · ' + s.name) + '</option>';
    });
    h += '</select></label>';

    h += range('l60-from', t('l60_from'), state.from, list);
    h += range('l60-to', t('l60_to'), state.to, list);

    if (state.warnNoCode) {
      h += '<div class="partner-note note-danger">' + t('l60_wh_unnumbered') + '</div>';
    }
    return h;
  }

  function range(name, lab, val, list) {
    var h = '<label class="field"><span>' + lab + '</span>' +
            '<select class="inp" data-change="' + name + '">' +
            '<option value="">' + t('l60_all') + '</option>';
    list.forEach(function (sh) {
      h += '<option value="' + esc(sh.code) + '"' + (val === sh.code ? ' selected' : '') + '>' +
           esc(sh.code) + '</option>';
    });
    return h + '</select></label>';
  }

  /* --------------------------------------------------------------- wiring */

  function register() {
    ACTIONS['l60-shelf-labels'] = function (el) {
      openShelfLabels(el.getAttribute('data-wh') || null);
    };
    ACTIONS['l60-print'] = doPrint;

    CHANGES['l60-section'] = function (el) {
      state.sectionId = +el.value; state.from = ''; state.to = '';
      buildShelfItems();
      var c = document.querySelector('.l60-controls');
      if (c) c.innerHTML = shelfControls();
      repaint();
    };
    CHANGES['l60-from'] = function (el) { state.from = el.value; buildShelfItems(); repaint(); };
    CHANGES['l60-to'] = function (el) { state.to = el.value; buildShelfItems(); repaint(); };
  }

  return {
    register: register,
    openShelfLabels: openShelfLabels,
    /* Exposed for the calibration/ruler check and because phase 3's scan
       handler has to parse exactly what this writes. */
    shelfPayload: shelfPayload,
    barcodeWidthMm: barcodeWidthMm,
    PRESETS: { shelf: SHELF_PRESET }
  };
})();
