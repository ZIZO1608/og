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
   it goes the way js/labels.js's browser output goes: real millimetres in
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
     same test server/lib/labels.js uses to decide a field needs the bitmap
     path. Here it only chooses a direction and a font. */
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
     setRollPageSize() does for the product labels. */
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

  /* ================================================= THE SHELF LABELS SECTION
     The owner (17 Oct 2026): the Print labels screen in two halves — product
     labels, and shelf labels — and every shelf label printable from there.

     Before this the only way to a shelf label was one rack at a time, from
     the shelf map or a dialog with a from/to range. Here every rack in the
     shop is drawn as the grid it is (levels × bays), a bay is pressed to
     choose it, a rack's tick takes the whole rack, and one Print sends them
     all, in the order somebody walks them: rack by rack, A1 A2 … B1 B2.
     The label beside the racks is the real one at its real size — the bay
     last pressed — because a preview of a sticker is the sticker.

     It paints #slRoot itself and never calls render(): a repaint of the whole
     screen would take the scroll and lose the rack the hand is on. It loads
     from after() only when it holds nothing or what it holds is a minute old
     (fix 06), and the selection is module state (SL.sel), so a reload of the
     racks keeps what was chosen. GET /api/sections needs stock.read; an
     account without it is not offered this half at all. */

  var SL = { loaded: false, busy: false, failed: null, at: 0, secs: [], rooms: [],
             sel: {}, show: 'all', wh: 'all', focus: null };
  var SL_FRESH_MS = 60 * 1000;

  function slAllowed() { return allow('stock.read'); }

  function slLoad() {
    if (SL.busy) return;
    SL.busy = true;
    Shop.sections().then(function (res) {
      SL.secs = (res.sections || []).filter(function (s) { return s.shelves && s.shelves.length; });
      SL.rooms = res.rooms || [];
      SL.loaded = true; SL.failed = null; SL.at = Date.now();
      /* A shelf deleted since it was chosen leaves the selection. */
      var live = {};
      SL.secs.forEach(function (s) { s.shelves.forEach(function (sh) { live[sh.id] = true; }); });
      Object.keys(SL.sel).forEach(function (id) { if (!live[id]) delete SL.sel[id]; });
      if (SL.focus == null || !live[SL.focus]) {
        var first = SL.secs[0] && SL.secs[0].shelves.slice().sort(gridOrder)[0];
        SL.focus = first ? first.id : null;
      }
    }).catch(function (err) {
      SL.failed = API.friendly(err); SL.loaded = true;
    }).then(function () { SL.busy = false; slPaint(); });
  }

  function slAfter() {
    if (!slAllowed() || slMode() !== 'shelves') return;
    if (!SL.loaded || Date.now() - SL.at > SL_FRESH_MS) slLoad();
  }

  /* Which half of the Print labels screen is showing, per machine — the
     office prints shelf labels, the back room prints shoes. */
  function slMode() {
    var m = null;
    try { m = localStorage.getItem('og.lb.mode'); } catch (e) {}
    return m === 'shelves' && slAllowed() ? 'shelves' : 'products';
  }
  function slSetMode(m) { try { localStorage.setItem('og.lb.mode', m); } catch (e) {} }

  function roomName(id) {
    var r = SL.rooms.filter(function (x) { return x.id === id; })[0];
    return r ? r.name : '';
  }

  function slFilled(sh) { return sh.product_id != null || (sh.qty || 0) > 0; }
  function slShown(sh) {
    return SL.show === 'filled' ? slFilled(sh) : SL.show === 'empty' ? !slFilled(sh) : true;
  }
  function slSecs() {
    return SL.secs.filter(function (s) { return SL.wh === 'all' || s.wh_id === SL.wh; });
  }
  function slFind(id) {
    for (var i = 0; i < SL.secs.length; i++) {
      for (var j = 0; j < SL.secs[i].shelves.length; j++) {
        if (SL.secs[i].shelves[j].id === id) return { sec: SL.secs[i], sh: SL.secs[i].shelves[j] };
      }
    }
    return null;
  }
  /* What will print, in walking order: rack by rack as listed, then A1 A2 … */
  function slChosen() {
    var out = [];
    SL.secs.forEach(function (sec) {
      sec.shelves.slice().sort(gridOrder).forEach(function (sh) {
        if (SL.sel[sh.id]) out.push({ sec: sec, sh: sh });
      });
    });
    return out;
  }
  function slCount() { return Object.keys(SL.sel).length; }

  /* The figure on each half's tile. */
  function slTotals() {
    var bays = 0;
    SL.secs.forEach(function (s) { bays += s.shelves.length; });
    return { bays: bays, racks: SL.secs.length };
  }

  /* The switch at the top of the Print labels screen: two big tiles. */
  function modeTiles(productSizes) {
    if (!slAllowed()) return '';
    var m = slMode();
    var tot = slTotals();
    var tile = function (id, icon, title, sub, figure) {
      var on = m === id;
      return '<button type="button" class="lbm-tile' + (on ? ' on' : '') + '" data-act="lb-mode" data-mode="' + id +
        '" aria-pressed="' + on + '">' +
        '<span class="lbm-ico" aria-hidden="true">' + icon + '</span>' +
        '<span class="lbm-txt"><b>' + title + '</b><small>' + sub + '</small></span>' +
        '<span class="lbm-fig">' + figure + '</span></button>';
    };
    var tagIcon = '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>';
    var rackIcon = '<svg viewBox="0 0 24 24"><path d="M4 3v18M20 3v18M4 8h16M4 13h16M4 18h16"/></svg>';
    return '<div class="lbm" role="tablist">' +
      tile('products', tagIcon, t('lb_mode_products'), t('lb_mode_products_sub'),
        '<bdi>' + nf(productSizes) + '</bdi>') +
      tile('shelves', rackIcon, t('lb_mode_shelves'), t('lb_mode_shelves_sub'),
        SL.loaded && !SL.failed ? '<bdi>' + nf(tot.bays) + '</bdi>' : '<i class="lbm-dots"></i>') +
    '</div>';
  }

  function shelfView() {
    return '<div id="slRoot">' + slBody() + '</div>';
  }

  function slPaint() {
    var el = document.getElementById('slRoot');
    if (!el) return;
    var keep = document.activeElement && document.activeElement.getAttribute &&
      document.activeElement.getAttribute('data-id');
    el.innerHTML = slBody();
    /* The figure on the tile follows the load. */
    var fig = document.querySelector('.lbm-tile[data-mode="shelves"] .lbm-fig');
    if (fig && SL.loaded && !SL.failed) fig.innerHTML = '<bdi>' + nf(slTotals().bays) + '</bdi>';
    if (keep) {
      var back = el.querySelector('[data-act="sl-cell"][data-id="' + keep + '"]');
      if (back) back.focus();
    }
  }

  function slBody() {
    if (!SL.loaded) {
      return '<div class="sl-skel" aria-busy="true"><i></i><i></i><i></i></div>' +
        '<span class="sr-only" role="status">' + t('sl_loading') + '</span>';
    }
    if (SL.failed) {
      return '<div class="card"><div class="cart-empty"><b>' + esc(SL.failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="sl-reload">' + t('retry') + '</button></div></div>';
    }
    if (!SL.secs.length) {
      return '<div class="card"><div class="cart-empty"><b>' + t('sl_none_title') + '</b><span>' + t('sl_none_sub') + '</span>' +
        (navAllowed('shelfmap') ? '<button class="btn btn-primary mt" data-act="sl-map">' + t('sl_open_map') + '</button>' : '') +
        '</div></div>';
    }

    var secs = slSecs();
    var whs = [];
    SL.secs.forEach(function (s) { if (whs.indexOf(s.wh_id) < 0) whs.push(s.wh_id); });
    var n = slCount();

    /* The tools: what to show, where, and choosing in bulk. */
    var chip = function (id, key) {
      return '<button type="button" class="chip' + (SL.show === id ? ' on' : '') + '" data-act="sl-show" data-show="' + id + '">' +
        t(key) + '</button>';
    };
    var h = '<div class="sl-tools">' +
      '<div class="chip-row">' + chip('all', 'sl_show_all') + chip('filled', 'sl_show_filled') + chip('empty', 'sl_show_empty') + '</div>' +
      (whs.length > 1
        ? '<select class="inp sl-wh" data-change="sl-wh"><option value="all">' + t('all_warehouses') + '</option>' +
            whs.map(function (w) {
              return '<option value="' + esc(w) + '"' + (SL.wh === w ? ' selected' : '') + '>' + esc(DB.whName(w, OG.lang === 'ar')) + '</option>';
            }).join('') + '</select>'
        : '') +
      '<span class="sl-tools-sp"></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sl-all">' + t('sl_pick_all') + '</button>' +
      (n ? '<button type="button" class="btn btn-ghost btn-sm" data-act="sl-clear">' + t('sl_clear') + '</button>' : '') +
    '</div>';

    var racks = secs.map(slRack).join('');
    if (!racks) racks = '<div class="card"><div class="cart-empty"><b>' + t('sl_shown_none') + '</b></div></div>';

    var foc = SL.focus != null ? slFind(SL.focus) : null;
    var preview = '<aside class="card sl-prev">' +
      '<div class="sl-prev-h"><span class="wo-k">' + t('sl_preview') + '</span>' +
        (foc ? '<b class="sl-prev-code"><bdi dir="ltr">' + esc(foc.sh.full_code || (foc.sec.key + '-' + foc.sh.code)) + '</bdi></b>' : '') + '</div>' +
      '<div class="sl-prev-sticker">' + (foc ? shelfLabelHTML(foc.sec, foc.sh) : '<div class="muted">' + t('sl_preview_hint') + '</div>') + '</div>' +
      '<div class="muted small sl-prev-how">' + t('sl_how') + '</div>' +
      '<button type="button" class="btn btn-primary btn-block sl-print" data-act="sl-print"' + (n ? '' : ' disabled') + '>' +
        '<span>' + (n ? t('sl_print').replace('{n}', '<bdi>' + nf(n) + '</bdi>') : t('sl_print_none')) + '</span></button>' +
    '</aside>';

    return h + '<div class="sl-main"><div class="sl-racks">' + racks + '</div>' + preview + '</div>' +
      /* On a phone the print button rides at the bottom of the screen. */
      '<div class="sl-bar' + (n ? ' on' : '') + '"><span>' + t('sl_selected').replace('{n}', '<bdi>' + nf(n) + '</bdi>') + '</span>' +
        '<button type="button" class="btn btn-primary" data-act="sl-print"' + (n ? '' : ' disabled') + '><span>' +
          t('sl_print').replace('{n}', '<bdi>' + nf(n) + '</bdi>') + '</span></button></div>';
  }

  /* One rack, drawn as what it is: its levels down, its bays across. A bay
     that does not exist (a door where B4 would be) is a gap, so the drawing
     keeps the rack's own shape. */
  function slRack(sec) {
    var shown = sec.shelves.filter(slShown);
    if (!shown.length) return '';
    var all = shown.every(function (sh) { return SL.sel[sh.id]; });
    var some = !all && shown.some(function (sh) { return SL.sel[sh.id]; });
    var filled = sec.shelves.filter(slFilled).length;
    var at = {};
    sec.shelves.forEach(function (sh) { at[sh.row_label + '|' + sh.col_index] = sh; });
    var cols = sec.cols || [];
    /* The top level is drawn at the top, as the rack stands. */
    var rows = (sec.rows || []).slice().reverse();

    var grid = '<div class="sl-grid" style="grid-template-columns:28px repeat(' + cols.length + ',minmax(44px,1fr))">' +
      rows.map(function (r) {
        return '<span class="sl-rowlab">' + esc(r) + '</span>' + cols.map(function (c) {
          var sh = at[r + '|' + c];
          if (!sh) return '<span class="sl-gap" aria-hidden="true"></span>';
          var vis = slShown(sh);
          var on = !!SL.sel[sh.id];
          var tip = (sh.full_code || (sec.key + '-' + sh.code)) + (sh.product_name ? ' · ' + sh.product_name : '') +
            (sh.qty ? ' · ' + sh.qty : '');
          return '<button type="button" class="sl-cell' + (on ? ' on' : '') + (slFilled(sh) ? ' filled' : '') +
            (vis ? '' : ' dim') + (SL.focus === sh.id ? ' focus' : '') + '" data-act="sl-cell" data-id="' + sh.id +
            '" aria-pressed="' + on + '" title="' + esc(tip) + '"' + (vis ? '' : ' disabled') + '>' +
            '<bdi dir="ltr">' + esc(sh.code) + '</bdi>' + (slFilled(sh) ? '<i aria-hidden="true"></i>' : '') + '</button>';
        }).join('');
      }).join('') + '</div>';

    var room = roomName(sec.room_id);
    var meta = [room, SL.wh === 'all' && slMultiWh() ? DB.whName(sec.wh_id, OG.lang === 'ar') : '']
      .filter(Boolean).map(esc).join(' · ');
    return '<section class="card sl-rack' + (all ? ' all' : some ? ' some' : '') + '">' +
      '<header class="sl-rack-h">' +
        '<span class="sl-key"><bdi dir="ltr">' + esc(sec.key) + '</bdi></span>' +
        '<span class="sl-rack-t"><b>' + esc(sec.name) + '</b><small>' +
          (meta ? meta + ' · ' : '') +
          t('sl_rack_meta').replace('{n}', '<bdi>' + nf(sec.shelves.length) + '</bdi>').replace('{f}', '<bdi>' + nf(filled) + '</bdi>') +
        '</small></span>' +
        '<button type="button" class="sl-tick' + (all ? ' on' : some ? ' some' : '') + '" data-act="sl-rack" data-sec="' + sec.id +
          '" aria-pressed="' + all + '"><span class="sl-tick-box" aria-hidden="true"></span><span>' + t('sl_rack_all') + '</span></button>' +
      '</header>' + grid + '</section>';
  }

  function slMultiWh() {
    var w = {};
    SL.secs.forEach(function (s) { w[s.wh_id] = 1; });
    return Object.keys(w).length > 1;
  }

  /* Print what was chosen: the same preview, the same true-size sheet, the
     same print window and the same log row as the one-rack dialog. */
  function slPrint() {
    var list = slChosen();
    if (!list.length) return;
    var racks = {};
    list.forEach(function (x) { racks[x.sec.id] = 1; });
    state = {
      kind: 'batch',
      items: list.map(function (x) { return shelfLabelHTML(x.sec, x.sh); }),
      record: list.map(function (x) { return { subjectType: 'shelf', subjectId: String(x.sh.id), qty: 1 }; })
    };
    var noCode = list.some(function (x) { return x.sec.wh_code == null; });
    previewModal(t('l60_shelf_title'),
      '<div class="sl-batch"><b>' + t('sl_batch').replace('{n}', '<bdi>' + nf(list.length) + '</bdi>')
        .replace('{r}', '<bdi>' + nf(Object.keys(racks).length) + '</bdi>') + '</b>' +
        '<span class="muted">' + t('sl_how') + '</span></div>' +
      (noCode ? '<div class="partner-note note-danger">' + t('l60_wh_unnumbered') + '</div>' : ''));
  }

  /* --------------------------------------------------------------- wiring */

  function register() {
    ACTIONS['l60-print'] = doPrint;

    ACTIONS['lb-mode'] = function (el) {
      var m = el.getAttribute('data-mode') === 'shelves' ? 'shelves' : 'products';
      if (m === slMode()) return;
      slSetMode(m);
      render();
    };
    ACTIONS['sl-reload'] = function () { SL.failed = null; SL.loaded = false; slPaint(); slLoad(); };
    ACTIONS['sl-map'] = function () { go('shelfmap'); };
    ACTIONS['sl-show'] = function (el) { SL.show = el.getAttribute('data-show') || 'all'; slPaint(); };
    ACTIONS['sl-cell'] = function (el) {
      var id = +el.getAttribute('data-id');
      if (SL.sel[id]) delete SL.sel[id]; else SL.sel[id] = true;
      SL.focus = id;
      slPaint();
    };
    ACTIONS['sl-rack'] = function (el) {
      var sec = SL.secs.filter(function (s) { return s.id === +el.getAttribute('data-sec'); })[0];
      if (!sec) return;
      var shown = sec.shelves.filter(slShown);
      var all = shown.every(function (sh) { return SL.sel[sh.id]; });
      shown.forEach(function (sh) { if (all) delete SL.sel[sh.id]; else SL.sel[sh.id] = true; });
      if (!all && shown[0]) SL.focus = shown.slice().sort(gridOrder)[0].id;
      slPaint();
    };
    ACTIONS['sl-all'] = function () {
      slSecs().forEach(function (sec) { sec.shelves.filter(slShown).forEach(function (sh) { SL.sel[sh.id] = true; }); });
      slPaint();
    };
    ACTIONS['sl-clear'] = function () { SL.sel = {}; slPaint(); };
    ACTIONS['sl-print'] = slPrint;
    CHANGES['sl-wh'] = function (el) { SL.wh = el.value || 'all'; slPaint(); };

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
    /* The Print labels screen's two halves (17 Oct 2026). */
    modeTiles: modeTiles,
    mode: slMode,
    shelfView: shelfView,
    shelfAfter: slAfter,
    /* Exposed for the calibration/ruler check and because phase 3's scan
       handler has to parse exactly what this writes. */
    shelfPayload: shelfPayload,
    barcodeWidthMm: barcodeWidthMm,
    PRESETS: { shelf: SHELF_PRESET }
  };
})();
