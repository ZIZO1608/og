/* ==========================================================================
   OG SYSTEM — the 80mm thermal receipt
   --------------------------------------------------------------------------
   This is the paper that goes in the bag with the shoes, not a debug dump.
   Everything is drawn on a 576px-wide <canvas> — 72mm at 203dpi, 1 canvas
   pixel = 1 printer dot — because ESC/POS text mode cannot shape Arabic,
   cannot use Montserrat, and dithers a logo badly, and the server has no
   image library by design. The browser's own text engine does the hard
   part; js/escpos.js turns the finished canvas into printer bytes.

     Receipt.autoPrint(sale)      fire-and-forget, called right after a sale
                                   completes in js/pos.js
     Receipt.printSale(id)        manual "Print receipt" / reprint button
     Receipt.preview(id)          on-screen canvas at ~72mm, no printing
     Receipt.giftReceipt(id)      pick the lines, preview, print the gift slip
     Receipt.printGift(id, lines) straight to the printer, no dialog
     Receipt.register()           wires the data-act handlers into ACTIONS,
                                   same shape as Deliveries.register()
   ========================================================================== */

var Receipt = (function () {

  var W = 576;                    // 72mm at 203dpi — never scaled after draw
  var PAD = 16;                   // 2mm margin each side — the head's 72mm is already inside the roll's edge
  var CW = W - PAD * 2;           // content width
  var FONT = "'Montserrat', 'Cairo', 'Segoe UI', Tahoma, sans-serif";
  /* Montserrat first and it keeps every Latin glyph — its @font-face blocks
     carry unicode-ranges (Latin/Cyrillic/Vietnamese) that exclude Arabic
     entirely, so an Arabic character skips it and lands on Cairo.

     CAIRO IS HERE FOR THE SAME REASON js/labels60.js USES IT, and it took a
     printer to find out. This stack used to end at 'Segoe UI', Tahoma, which
     meant the receipt's Arabic was drawn in whatever the machine happened to
     have, at weight 400. On screen that is invisible; at 203 dpi a weight-400
     Arabic stroke is under one printer dot wide and comes off the paper as a
     grey ghost. assets/fonts/fonts.css says it plainly, written when the
     60x40 labels hit this first: "Lighter weights lose their dots at this
     density."

     Cairo ships at weight 700 only, so ALL Arabic on the receipt is bold.
     That is deliberate, not a side effect. */

  /* NOTHING IS DRAWN BELOW THIS, EVER.
     18 dots at 203dpi is about 2.25mm — roughly 5pt. Below it a letter's stem
     is thinner than a single printer dot, so it renders as a half-lit grey
     pixel and js/escpos.js's threshold then throws it away: the line comes off
     the paper faint and patchy, some pixels of each letter surviving and some
     not. This receipt used to draw at 13, 14, 15, 16 and 17 — 3.7pt to 4.8pt —
     and every one of those lines was unreadable on the XP-T80A while looking
     perfect on screen. Screen pixels are free; printer dots are not. */
  var MIN_SIZE = 18;
  function sz(n) { return Math.max(MIN_SIZE, n || 20); }

  var MINOR_EXP = { USD: 2, SYP: 0 };   // fixed for this shop — see CLAUDE.md

  /* How black a pixel has to be before js/escpos.js burns a dot for it.
     Three named steps rather than a raw number, because the person turning
     this knob is standing at a till holding a receipt that is too faint, not
     reading a luma histogram. 'dark' is the default and the fix: 'normal' is
     the neutral 128 that was printing small text as a grey ghost. */
  var INK = { normal: 128, dark: 168, darker: 195 };
  function burnLuma() {
    return INK[(typeof CONFIG !== 'undefined' && CONFIG.RECEIPT_INK) || 'dark'] || INK.dark;
  }

  /* ------------------------------------------------------------- loading */

  var logoPromise = null;
  function loadLogo() {
    if (logoPromise) return logoPromise;
    logoPromise = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'assets/logo.svg';
    });
    return logoPromise;
  }

  /* The mark in black ink on white paper, cropped to the letters.
     assets/logo.svg is a white OG on a black square, and printed as it comes
     the square was a 22 mm block of solid black — the loudest thing on the
     slip and heat spent on nothing, where a brand's receipt carries its mark
     small, in ink. The ink here is the artwork's brightness (the same reading
     the shelf map's wall makes of it, markCanvas in js/shelfroom.js), and the
     canvas is cropped to where that ink is, so a height asked of drawLogo()
     is the height of the letters rather than of the margin round them.

     Null on any failure — no logo, a canvas that will not read back — and
     drawLogo() then prints the square instead, small. The old logo is a
     better receipt than no logo, and neither is a reason not to print. */
  var markPromise = null;
  function loadMark() {
    if (markPromise) return markPromise;
    markPromise = loadLogo().then(function (img) {
      if (!img) return null;
      try {
        var S = 480;
        var c = document.createElement('canvas');
        c.width = c.height = S;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0, S, S);
        var d = g.getImageData(0, 0, S, S), px = d.data;
        var x0 = S, y0 = S, x1 = -1, y1 = -1;
        for (var y = 0; y < S; y++) {
          for (var x = 0; x < S; x++) {
            var i = (y * S + x) * 4;
            var ink = Math.round((px[i] + px[i + 1] + px[i + 2]) / 3 * px[i + 3] / 255);
            px[i] = px[i + 1] = px[i + 2] = 0;
            px[i + 3] = ink;
            if (ink > 64) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return null;
        g.putImageData(d, 0, 0);
        var out = document.createElement('canvas');
        out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
        out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return out;
      } catch (e) { return null; }
    });
    return markPromise;
  }

  /* Official Instagram/Telegram glyphs, sourced as real SVG (not redrawn
     from memory — a wrong logo reads worse than none), loaded the exact
     same way as the shop's own logo above. Vector stays vector until
     js/escpos.js's packBitmap() thresholds it to pure black/white at print
     time, same as the logo — no separate monochrome-PNG step needed. */
  var igMarkPromise = null;
  function loadInstagramMark() {
    if (igMarkPromise) return igMarkPromise;
    igMarkPromise = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'assets/instagram-mark.svg';
    });
    return igMarkPromise;
  }
  var tgMarkPromise = null;
  function loadTelegramMark() {
    if (tgMarkPromise) return tgMarkPromise;
    tgMarkPromise = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'assets/telegram-mark.svg';
    });
    return tgMarkPromise;
  }

  /* document.fonts.ready only waits for faces the page has already ASKED for,
     and Cairo is font-display:block and untouched until something actually
     renders Arabic. Without the explicit load() below, the first receipt after
     a reload draws its Arabic in the Segoe UI fallback and every later one
     draws it in Cairo — the same sale, printed twice, coming out in two
     different fonts.

     The load is allowed to fail and is swallowed: a missing font must never be
     the reason a sale cannot print. Falling back to Segoe UI is a worse
     receipt; throwing here would be no receipt at all. */
  function fontsReady() {
    if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
    var pre = document.fonts.load
      ? Promise.resolve(document.fonts.load('700 24px Cairo', 'ش'))['catch'](function () {})
      : Promise.resolve();
    return pre.then(function () { return document.fonts.ready; });
  }

  /* -------------------------------------------------------------- format */

  function western(n) {
    /* toLocaleString('en-US') is already Western-digit and comma-grouped —
       reused from app.js when it has loaded, else the same formula inline
       so this module never hard-depends on load order.

       The 'en-US' is not a placeholder and must never be swapped for
       OG.lang or a locale lookup — 'ar' (and several other Arabic
       locales) makes toLocaleString emit Arabic-Indic digits (٠١٢٣...) on
       some engines. Every digit that reaches paper is 0123456789,
       unconditionally, even on a fully Arabic receipt — Arabic in this
       codebase's printed output is for words (labels, sizes, payment
       method) only, never numerals. If this ever needs to "follow the UI
       language," it doesn't: that is the bug this comment exists to
       prevent. */
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  /* "https://www.instagram.com/og_sports_1" -> "instagram.com/og_sports_1".
     A receipt is not a browser — nobody taps this — so the scheme/www is
     dead weight, and every character here is a fraction of a mm of roll. */
  function shortUrl(url) {
    return String(url || '').replace(/^https?:\/\/(www\.)?/i, '');
  }

  function currencySuffix(code, ar) {
    if (code === 'USD') return '$';
    return ar ? 'ل.س' : 'SYP';
  }

  /* A figure in its currency's own decimals: whole lira, dollars AND cents.
     Every money figure used to go through western(), which rounds to the
     whole unit — right for the lira and wrong for the dollar, so a $148.49
     sale printed "$148". Western digits and comma groups, for western()'s
     reason. */
  function num(amount, code) {
    var d = MINOR_EXP[code] || 0;
    return (Number(amount) || 0).toLocaleString('en-US',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* USD is prefixed ("$12.00"), SYP is suffixed ("12,500 SYP" / "12,500 ل.س")
     — the same convention app.js's money() already uses on every other screen
     in this system, so a cashier reading the till and the receipt side by
     side sees the same shape of number. */
  function fmtMoney(amount, code, ar) {
    if (code === 'USD') return '$' + num(amount, code);
    return num(amount, code) + ' ' + currencySuffix(code, ar);
  }

  /* The same figure in its two pieces, for the total, where the unit is set
     smaller than the number the way a price tag does it. */
  function moneyParts(amount, code) {
    return { unit: currencySuffix(code, true), num: num(amount, code) };
  }

  function two(n) { return String(n).padStart(2, '0'); }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(), h12 = h % 12 || 12;
    return {
      time: h12 + ':' + two(d.getMinutes()) + ' ' + (h >= 12 ? 'PM' : 'AM'),
      date: two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear(),
      en: two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear() +
          '  ' + h12 + ':' + two(d.getMinutes()) + ' ' + (h >= 12 ? 'PM' : 'AM'),
      ar: two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear() +
          '  ' + h12 + ':' + two(d.getMinutes()) + ' ' + (h >= 12 ? 'م' : 'ص')
    };
  }

  /* Fixed receipt labels live in I18N.en / I18N.ar, same as every other
     string in the app — read directly rather than through t() because the
     printed slip needs both languages on the page at once, not whichever
     one OG.lang happens to be. */
  function L(key) {
    return {
      ar: (typeof I18N !== 'undefined' && I18N.ar[key]) || key,
      en: (typeof I18N !== 'undefined' && I18N.en[key]) || key
    };
  }
  function both(key) {
    var l = L(key);
    return l.ar + ' · ' + l.en;
  }

  function payLabel(method) {
    return {
      ar: (typeof PAYMENT_LABELS_AR !== 'undefined' && PAYMENT_LABELS_AR[method]) || method,
      en: (typeof PAYMENT_LABELS !== 'undefined' && PAYMENT_LABELS[method]) || method
    };
  }

  /* ---------------------------------------------------------- primitives */

  /* The least room between a label and the figure beside it. */
  var GAP = 16;

  /* Every box of ink the current draw() puts down — each line of text, the
     mark, the icons, the barcode, the rules — kept for the harness, never for
     the paper. _nightshift/receipt/render.mjs reads it through
     Receipt._boxes() and fails any two that overlap and any that leave the
     roll. The box is the INK (measureText's actual bounding box), not the
     line box: two lines that merely sit close are fine, two whose letters
     touch are not. A total printing into its own label is exactly the fault
     this exists to catch, and looking at screenshots never did. */
  var boxes = [];
  function note(t, x0, y0, x1, y1) {
    boxes.push({ t: String(t).slice(0, 48), x0: Math.round(x0), y0: Math.round(y0),
                 x1: Math.round(x1), y1: Math.round(y1) });
  }

  var ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

  function setFont(ctx, size, weight, track) {
    ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + FONT;
    /* Tracking is for Latin capitals and nothing else. Arabic letters JOIN,
       and letter-spacing pulls the joins apart — the app's own rule
       (og-skin.css zeroes it under body.rtl) — so every caller that passes a
       track has checked the string is not Arabic first. Always written, so a
       track set for one line never leaks into the next through this shared
       context. */
    if ('letterSpacing' in ctx) ctx.letterSpacing = (track || 0) + 'px';
  }

  function measure(ctx, text, size, weight, track) {
    ctx.save();
    setFont(ctx, sz(size), weight, track);
    var w = ctx.measureText(String(text == null ? '' : text)).width;
    ctx.restore();
    return w;
  }

  /* y is a BASELINE here and only here — see the vertical convention below.
     Answers the width drawn, so a caller setting two pieces side by side
     does not measure twice. */
  function textAt(ctx, text, x, y, opts) {
    opts = opts || {};
    var size = sz(opts.size);
    var str = String(text == null ? '' : text);
    var align = opts.align || 'left';
    ctx.save();
    setFont(ctx, size, opts.weight, opts.track);
    ctx.direction = opts.dir || 'ltr';
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = opts.color || '#000';
    /* Letter-spacing also follows the LAST letter, so tracked text sits that
       much off its anchor; put it back, half for a centred line. */
    if (opts.track) x += align === 'center' ? opts.track / 2 : align === 'right' ? opts.track : 0;
    var m = ctx.measureText(str);

    /* FAUX-BOLD FOR THE SMALL SIZES, and this is what actually gets them onto
       the paper. Even at the 18px floor a stem is only about one dot wide, so
       it lands as a single half-lit pixel sitting right on js/escpos.js's
       threshold — some survive, some don't, and the line reads as broken.
       Stroking 0.8px around the glyph widens the stem to roughly 1.8 dots,
       which thresholds to two solid ones.

       strokeStyle tracks fillStyle rather than being hardcoded black, so this
       also thickens WHITE text inside a black band (the copy band, the total)
       — the right direction there too, and it pays back the thinning that a
       raised burn threshold would otherwise cost white-on-black.

       Stops at 22 on purpose: bigger stems are already two dots wide, and
       bolding those further closes up the counters of letters like e and a
       into black blobs. */
    if (size < 22) {
      ctx.lineWidth = 0.8;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.strokeText(str, x, y);
    }

    ctx.fillText(str, x, y);
    ctx.restore();
    if (str.trim()) {
      note(str, x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent,
        x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent);
    }
    return m.width;
  }

  /* The largest size from `size` down to `min` at which the text fits maxW —
     `min` itself when nothing does, and the caller then decides what gives. */
  function fitSize(ctx, text, maxW, size, min, weight, track) {
    size = sz(size); min = sz(min);
    for (var s = size; s > min; s--) {
      if (measure(ctx, text, s, weight, track) <= maxW) return s;
    }
    return min;
  }

  /* ONE VERTICAL CONVENTION, and this is it: every y in this module is the
     TOP of the block about to be drawn, and every draw helper returns the top
     of the next one. Only textAt() takes a baseline, and nothing returns one.

     It used to be split. textAt/centerText took a BASELINE while rowLR,
     labelRow and drawItems took a TOP, so composing them was only safe if
     you remembered which kind each one was — and the failure is silent and
     ugly: the next line's cap-height reaches back up into the block above
     it. Two of those were live for a while: the QR caption printed through
     the Instagram line, and a COD receipt's English "Amount to collect"
     printed through the Arabic line above it.

     Baseline sits one em below the top, so a line occupies
     [y, y + lineHeight) and its glyphs cannot escape upward into whatever was
     drawn before it. 1.38 of the size, down from 1.42 when the slip was
     tightened (27 Sep 2026) — Cairo's descenders still clear the next line,
     which the harness measures rather than assumes. */
  function lineHeight(size) { return Math.round(size * 1.38); }

  /* Every helper below clamps with sz() as its FIRST line, and every line
     height and baseline it goes on to compute uses the clamped value. The
     clamp deliberately does not live inside setFont(): hidden there, the
     glyphs would grow while the spacing stayed at the size that was asked for,
     and the next line's cap-height would reach back up into the block above
     it. Clamp once, out in the open, and let the arithmetic follow. */
  function centerText(ctx, text, y, opts) {
    opts = opts || {};
    var size = sz(opts.size);
    textAt(ctx, text, W / 2, y + size, {
      size: size, weight: opts.weight, dir: opts.dir, align: 'center', color: opts.color, track: opts.track
    });
    return y + (opts.lineHeight || lineHeight(size));
  }

  /* Two pieces on one centred line, each drawn in its OWN direction:
     `right` where an Arabic reader starts, `left` after a dot. They cannot
     be one string — a phone number like 0956 442 118 inside a right-to-left
     line is reordered by the bidi algorithm to 118 442 0956, because the
     spaces split it into three numbers. Falls back to two lines when the
     pair is wider than the paper. */
  function centerPair(ctx, y, right, left, opts) {
    opts = opts || {};
    var size = sz(opts.size), dot = '  ·  ';
    if (!right || !left) {
      var one = right || left;
      return one ? centerText(ctx, one, y, { size: size, dir: ARABIC.test(one) ? 'rtl' : 'ltr' }) : y;
    }
    var wr = measure(ctx, right, size), wl = measure(ctx, left, size), wd = measure(ctx, dot, size);
    if (wr + wd + wl > CW) {
      y = centerText(ctx, right, y, { size: size, dir: ARABIC.test(right) ? 'rtl' : 'ltr' });
      return centerText(ctx, left, y, { size: size, dir: ARABIC.test(left) ? 'rtl' : 'ltr' });
    }
    var x0 = Math.round((W - (wr + wd + wl)) / 2), base = y + size;
    textAt(ctx, left, x0, base, { size: size, dir: 'ltr', align: 'left' });
    textAt(ctx, dot, x0 + wl, base, { size: size, dir: 'ltr', align: 'left' });
    textAt(ctx, right, x0 + wl + wd + wr, base, { size: size, dir: 'rtl', align: 'right' });
    return y + lineHeight(size);
  }

  function dashRule(ctx, y, gap) {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.restore();
    note('— rule', PAD, y - 1, W - PAD, y + 1);
    return y + (gap === undefined ? 14 : gap);
  }

  function solidRule(ctx, y, weight, gap) {
    weight = weight || 3;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(PAD, y, CW, weight);
    ctx.restore();
    note('— rule', PAD, y, W - PAD, y + weight);
    return y + weight + (gap === undefined ? 12 : gap);
  }

  /* Greedy word wrap using real canvas metrics, so a 70mm-too-long product
     name breaks where the printed line actually would, not where a
     character count guesses it might. */
  function wrapText(ctx, text, maxWidth, size, weight) {
    setFont(ctx, sz(size), weight);
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width > maxWidth && cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  /* A two-column row: a label on the right, where an Arabic reader starts,
     and its value on the left — every money line, the customer, the cashier.

     NEITHER SIDE MAY RUN INTO THE OTHER, and that is the bug this row used to
     have: both were drawn blind, at full size, from opposite edges, so the
     day a figure grew past what the label left it — a total of 1,254,000
     beside "الإجمالي · TOTAL" — the two printed on top of each other and the
     customer went home holding a smudge where the price should be.

     The VALUE is measured first and keeps its size: it is the figure
     somebody reads. The label gets what is left — it steps down toward the
     18px floor, then wraps, and only if one word of it still cannot fit
     does the value drop onto a line of its own underneath. */
  function rowLR(ctx, y, right, left, opts) {
    opts = opts || {};
    var size = sz(opts.size);
    var leftSize = sz(opts.leftSize || size);
    var weight = opts.weight, leftWeight = opts.leftWeight || opts.weight;
    var dir = opts.dir || 'rtl';
    var hasLeft = left !== undefined && left !== null && String(left) !== '';
    var lw = hasLeft ? measure(ctx, left, leftSize, leftWeight) : 0;
    var room = CW - (hasLeft ? lw + GAP : 0);

    var rs = fitSize(ctx, right, room, size, MIN_SIZE, weight);
    var lines = measure(ctx, right, rs, weight) <= room ? [String(right)] : wrapText(ctx, right, room, rs, weight);
    var stacked = room < CW * 0.3 || lines.some(function (ln) {
      return measure(ctx, ln, rs, weight) > room;
    });

    if (stacked) {
      /* The label takes the width, the value the line under it. */
      wrapText(ctx, right, CW, size, weight).forEach(function (ln) {
        textAt(ctx, ln, W - PAD, y + size, { size: size, weight: weight, dir: dir, align: 'right' });
        y += lineHeight(size);
      });
      var ls = fitSize(ctx, left, CW, leftSize, MIN_SIZE, leftWeight);
      textAt(ctx, left, PAD, y + ls, { size: ls, weight: leftWeight, dir: 'ltr', align: 'left' });
      return y + Math.round(ls * 1.4) + (opts.gap || 0);
    }

    /* Both columns share the first line's baseline, so the row is as tall as
       the bigger of the two. */
    var first = Math.max(rs, leftSize);
    textAt(ctx, lines[0], W - PAD, y + first, { size: rs, weight: weight, dir: dir, align: 'right' });
    if (hasLeft) textAt(ctx, left, PAD, y + first, { size: leftSize, weight: leftWeight, dir: 'ltr', align: 'left' });
    var yy = y + Math.round(first * 1.4);
    for (var i = 1; i < lines.length; i++) {
      textAt(ctx, lines[i], W - PAD, yy + rs, { size: rs, weight: weight, dir: dir, align: 'right' });
      yy += lineHeight(rs);
    }
    return yy + (opts.gap || 0);
  }

  /* ------------------------------------------------------ codes: barcode */

  function drawBarcode(ctx, y, text) {
    if (typeof Codes === 'undefined' || !Codes.code128) return y;
    var mods = Codes.code128(text);
    if (!mods) return y;

    /* Four dots a module at most: an invoice number is short, and bars
       stretched across the whole roll scan no better than bars 45 mm wide —
       they only look like a till from 1995. Never under two dots, which is
       the least a thermal head puts down reliably. */
    var quiet = 10, total = quiet * 2 + mods.length;
    var modPx = Math.max(2, Math.min(4, Math.floor(CW / total)));
    var drawW = modPx * total;
    var x0 = Math.round((W - drawW) / 2);
    var barH = 56;

    ctx.save();
    ctx.fillStyle = '#000';
    var run = 0;
    for (var i = 0; i <= mods.length; i++) {
      if (mods.charAt(i) === '1') { run++; continue; }
      if (run) {
        ctx.fillRect(x0 + (quiet + i - run) * modPx, y, run * modPx, barH);
        run = 0;
      }
    }
    ctx.restore();
    note('barcode', x0 + quiet * modPx, y, x0 + (quiet + mods.length) * modPx, y + barH);
    return y + barH + 8;
  }

  /* ------------------------------------------------------------ sections */

  /* The mark, about 10 mm tall. It was a 180-dot black square — 22 mm of the
     roll before a word was printed, and the heaviest block of heat on it. */
  var MARK_H = 76;
  function drawLogo(ctx, y, markImg, logoImg) {
    var img = markImg || logoImg;
    if (!img) return y + 8;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    /* The square falls back smaller than the mark: all of it is ink. */
    var h = markImg ? MARK_H : 84;
    var w = Math.round(h * iw / ih);
    var x = Math.round((W - w) / 2);
    ctx.drawImage(img, x, y, w, h);
    note('logo', x, y, x + w, y + h);
    return y + h + 12;
  }

  /* A solid black band right under the logo, naming which copy this is, so the kinds can never be
     confused at a glance — on the customer's side of the counter, in a
     drawer full of them, or in a gift bag.

     It says the KIND, so it takes the key rather than being the shop copy's
     private helper: the gift slip is the one where getting this wrong costs
     something real. A cashier who hands over the customer copy thinking it is
     the gift slip has just shown somebody the price of their present. */
  function drawBand(ctx, y, key) {
    var h = 34;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(PAD, y, CW, h);
    ctx.restore();
    textAt(ctx, both(key), W / 2, y + 24,
      { size: 19, weight: '700', dir: 'rtl', align: 'center', color: '#fff' });
    return y + h + 12;
  }

  function drawHeader(ctx, y, R) {
    /* No street address here on purpose — the customer holding this paper
       is standing in the shop; the address line stopped being useful the
       moment it printed. What replaces it, further down, is how to find
       the shop again: the contact block (drawContact) with Instagram,
       Telegram and the maps link. shop.address itself is untouched and
       still used elsewhere (customer-facing delivery slips, etc.) — only
       this one printed line goes away.

       The name is set wide, in capitals — a wordmark rather than a heading —
       unless it is written in Arabic, which is never tracked. Branch and
       phone share one line under it. */
    var name = (R.shop.name || 'OG SPORTS').toUpperCase();
    var ar = ARABIC.test(name), track = ar ? 0 : 6;
    var size = fitSize(ctx, name, CW, 26, 20, '800', track);
    y = centerText(ctx, name, y, { size: size, weight: '800', dir: ar ? 'rtl' : 'ltr', track: track });
    y = centerPair(ctx, y, R.shop.branch, R.shop.phone, { size: 18 });
    return y + 8;
  }

  /* THE DEADLINE AS A DATE, NOT A DURATION. The gift slip's policy sentence
     says "within 7 days of purchase", which is useless to the one person who
     reads it: the recipient does not know when it was bought and should not
     have to add seven days to a date in their head while standing at a
     counter. This is the line that makes the window setting worth having. */
  function exchangeBefore(R) {
    var hours = Number(R.giftExchangeHours);
    if (!isFinite(hours) || hours <= 0) return null;
    var at = new Date(R.at);
    if (isNaN(at.getTime())) return null;
    return fmtDateTime(new Date(at.getTime() + hours * 3600 * 1000)).date;
  }

  /* The invoice, the date and the time SIDE BY SIDE, in boxes — the way a
     brand's receipt sets them — where they used to be three stacked rows of
     two-line labels, 190 dots of roll for three short facts.

     cells are in reading order, the first one on the right. Each label is
     Arabic and English on one line when every box has room for that, and on
     two when any does not — the same for the whole row, so the values line
     up. The boxes are equal while everything fits an equal share, and share
     the width by what they hold when something does not: the gift slip's
     "EXCHANGE BEFORE" is twice the width of "DATE". A value is shrunk to its
     box, never cut and never let out of it. */
  function metaGrid(ctx, y, cells) {
    var n = cells.length, LS = 18, VS = 22, gap = 8, padC = 14;
    var plans = cells.map(function (c) {
      var en = c.en.toUpperCase(), value = String(c.value);
      return {
        ar: c.ar, en: en, value: value,
        wa: measure(ctx, c.ar, LS, '700'), we: measure(ctx, en, LS, '600', 1),
        wv: measure(ctx, value, VS, '700')
      };
    });
    function need(p, two) {
      return Math.max(two ? Math.max(p.wa, p.we) : p.wa + gap + p.we, p.wv) + padC;
    }
    var two = plans.some(function (p) { return need(p, false) > CW / n; });
    var needs = plans.map(function (p) { return need(p, two); });
    var sum = needs.reduce(function (s, v) { return s + v; }, 0);
    var even = needs.every(function (v) { return v <= CW / n; });
    var widths = needs.map(function (v) {
      return even ? CW / n : sum <= CW ? v + (CW - sum) / n : CW * v / sum;
    });

    var labelH = two ? lineHeight(LS) * 2 : lineHeight(LS);
    var top = y + 2;
    var bottom = top + labelH + Math.round(VS * 1.3);
    var right = W - PAD;

    plans.forEach(function (p, i) {
      var w = widths[i], inner = w - padC, cx = right - w / 2;
      var track = p.we <= inner ? 1 : 0;
      var ens = fitSize(ctx, p.en, inner, LS, MIN_SIZE, '600', track);
      var ars = fitSize(ctx, p.ar, inner, LS, MIN_SIZE, '700');
      if (!two) {
        var xr = cx + (p.wa + gap + p.we) / 2;
        textAt(ctx, p.ar, xr, top + LS, { size: LS, weight: '700', dir: 'rtl', align: 'right' });
        textAt(ctx, p.en, xr - p.wa - gap, top + LS, { size: LS, weight: '600', dir: 'ltr', align: 'right', track: 1 });
      } else {
        textAt(ctx, p.ar, cx, top + LS, { size: ars, weight: '700', dir: 'rtl', align: 'center' });
        textAt(ctx, p.en, cx, top + lineHeight(LS) + LS, { size: ens, weight: '600', dir: 'ltr', align: 'center', track: track });
      }
      var vs = fitSize(ctx, p.value, inner, VS, MIN_SIZE, '700');
      textAt(ctx, p.value, cx, top + labelH + VS, { size: vs, weight: '700', dir: 'ltr', align: 'center' });
      if (i) {
        var x = Math.round(right) - 1;
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(x, top, 2, bottom - top);
        ctx.restore();
        note('— divider', x, top, x + 2, bottom);
      }
      right -= w;
    });
    return bottom + 6;
  }

  function cell(key, value) {
    var l = L(key);
    return { ar: l.ar, en: l.en, value: value };
  }

  function drawMeta(ctx, y, R, gift) {
    var dt = fmtDateTime(R.at);
    var cells = [cell('rc2_g_invoice', R.id), cell('rc2_date', dt.date)];
    /* Date only on a gift slip — the minute somebody bought a present is not
       information the person unwrapping it needs. The box the time had says
       when it can be exchanged by instead. */
    if (gift) {
      var by = exchangeBefore(R);
      if (by) cells.push(cell('rc2_exchange_before', by));
    } else {
      cells.push(cell('rc2_time', dt.time));
    }
    y = solidRule(ctx, y, 2, 8);
    y = metaGrid(ctx, y, cells);
    y = solidRule(ctx, y, 2, 10);
    if (!gift && R.cashierName) {
      y = rowLR(ctx, y, both('rc2_cashier'), R.cashierName, { size: 18, leftSize: 19, leftWeight: '700' });
    }
    return y;
  }

  function drawCustomer(ctx, y, R) {
    var c = R.customer;
    if (!c) return y;
    y = rowLR(ctx, y, both('rc2_customer'), c.name, { size: 18, leftSize: 20, leftWeight: '700' });
    if (c.phone) y = rowLR(ctx, y, both('rc2_phone'), c.phone, { size: 18, leftSize: 19 });
    if (R.showLoyalty) {
      y = rowLR(ctx, y, both('rc2_points_balance'), western(c.loyaltyPoints), { size: 18, leftSize: 19 });
    }
    return y;
  }

  /* Two lines an item, where it used to be three or four: the name with the
     line's amount opposite it, then the size, and "2 × 11,990" only when
     there is more than one — for a single piece that figure IS the amount,
     printed twice.

     The name wraps inside what the amount leaves it, so a long one can never
     run under the figure.

     `gift` drops the money — the amount, the unit price, the line discount —
     and keeps the name and the size, the only things the recipient and the
     cashier both need to identify the item being brought back. R.items is
     already the ticked subset by the time it gets here; the filtering happens
     once in draw(), not per drawing function. */
  function drawItems(ctx, y, R, gift) {
    var cur = R.currency, NS = 20, DS = 18;
    R.items.forEach(function (it, idx) {
      if (idx) y += 6;
      var amt = gift ? '' : num(it.qty * it.unitPrice, cur);
      var aw = amt ? measure(ctx, amt, NS, '700') : 0;
      var room = CW - (amt ? aw + GAP : 0);
      wrapText(ctx, it.name, room, NS, '600').forEach(function (ln, i) {
        textAt(ctx, ln, W - PAD, y + NS, { size: NS, weight: '600', dir: 'rtl', align: 'right' });
        if (!i && amt) textAt(ctx, amt, PAD, y + NS, { size: NS, weight: '700', dir: 'ltr', align: 'left' });
        y += lineHeight(NS);
      });

      var size = it.size ? L('rc2_size').ar + ' ' + DB.lineSize(it, true) : '';
      var each = !gift && it.qty > 1 ? it.qty + ' × ' + num(it.unitPrice, cur) : '';
      if (size || each) {
        var sw = size ? measure(ctx, size, DS) : 0, ew = each ? measure(ctx, each, DS) : 0;
        if (sw && ew && sw + GAP + ew > CW) {
          y = rowLR(ctx, y, size, '', { size: DS });
          y = rowLR(ctx, y, each, '', { size: DS, dir: 'ltr' });
        } else {
          if (size) textAt(ctx, size, W - PAD, y + DS, { size: DS, dir: 'rtl', align: 'right' });
          if (each) textAt(ctx, each, W - PAD - (sw ? sw + GAP : 0), y + DS, { size: DS, dir: 'ltr', align: 'right' });
          y += lineHeight(DS);
        }
      }
      if (!gift && it.lineDiscount) {
        y = rowLR(ctx, y, both('rc2_line_discount'), '− ' + num(it.lineDiscount, cur), { size: DS });
      }
    });
    return y + 2;
  }

  /* THE TOTAL — the one line everybody reads twice, so it is the one line on
     the slip printed white on black, the figure big and the unit small the
     way a price tag sets it.

     And it is MEASURED, which is what the old row was not. The figure is
     sized to the room the label leaves it, from 40 down to 26; if even 26
     does not fit, the label takes a line of its own and the figure gets the
     whole band. 950 and 12,540,000 both print whole, and neither can touch
     the word beside it.

     The unit stands on the LEFT of the figure for the lira as for the
     dollar, which is where every other row on the slip puts it: "40,280 ل.س"
     drawn into a left-to-right line comes out with ل.س on the left (the bidi
     algorithm treats the number as part of the Arabic run), and an Arabic
     reader starting from the right reads the figure first either way.

     `outline` is the same box drawn as a frame, black on white — for what a
     delivery order still owes, and what a driver collects at the door: the
     figure somebody acts on, second only to the total. */
  function drawTotalBand(ctx, y, label, amount, code, outline) {
    var padX = 16, padY = outline ? 10 : 12, inner = CW - padX * 2;
    var ink = outline ? '#000' : '#fff';
    var LS = fitSize(ctx, label, inner, 20, MIN_SIZE, '800');
    var labelLines = measure(ctx, label, LS, '800') <= inner ? [label] : wrapText(ctx, label, inner, LS, '800');
    var lw = measure(ctx, labelLines[0], LS, '800');
    var p = moneyParts(amount, code);
    var unitAt = function (s) { return Math.max(MIN_SIZE, Math.round(s * 0.5)); };
    var unitGap = function (s) { return Math.round(s * 0.15); };
    var unitW = function (s) { return measure(ctx, p.unit, unitAt(s), '700') + unitGap(s); };
    var amountW = function (s) { return unitW(s) + measure(ctx, p.num, s, '800'); };

    var MAX = outline ? 32 : 40, MIN = 24, s = MAX, side = inner - lw - GAP * 2;
    while (s > MIN && amountW(s) > side) s--;
    var oneRow = labelLines.length === 1 && amountW(s) <= side;
    if (!oneRow) { s = MAX; while (s > MIN && amountW(s) > inner) s--; }

    /* Heights from the ink: digits rise about 0.74 of the size and a comma
       drops about 0.18; the Arabic label drops further than that. */
    var drop = Math.max(Math.round(s * 0.2), Math.round(LS * 0.5));
    var labelBase = y + padY + LS;
    var base = oneRow ? y + padY + Math.round(s * 0.76)
      : labelBase + lineHeight(LS) * (labelLines.length - 1) + Math.round(LS * 0.5) + 8 + Math.round(s * 0.76);
    var h = base + drop + padY - y;

    ctx.save();
    ctx.fillStyle = '#000';
    if (outline) {
      ctx.fillRect(PAD, y, CW, 3);
      ctx.fillRect(PAD, y + h - 3, CW, 3);
      ctx.fillRect(PAD, y, 3, h);
      ctx.fillRect(W - PAD - 3, y, 3, h);
    } else {
      ctx.fillRect(PAD, y, CW, h);
    }
    ctx.restore();

    var x;
    if (oneRow) {
      textAt(ctx, label, W - PAD - padX, base, { size: LS, weight: '800', dir: 'rtl', align: 'right', color: ink });
      x = PAD + padX;
    } else {
      labelLines.forEach(function (ln, i) {
        textAt(ctx, ln, W / 2, labelBase + lineHeight(LS) * i, { size: LS, weight: '800', dir: 'rtl', align: 'center', color: ink });
      });
      x = Math.round((W - amountW(s)) / 2);
    }
    x += textAt(ctx, p.unit, x, base, { size: unitAt(s), weight: '700', dir: 'ltr', color: ink }) + unitGap(s);
    textAt(ctx, p.num, x, base, { size: s, weight: '800', color: ink });
    return y + h;
  }

  function drawTotals(ctx, y, R) {
    var cur = R.currency;
    var pieces = R.items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0);
    y = rowLR(ctx, y, both('rc2_pieces'), western(pieces), { size: 18 });
    y = rowLR(ctx, y, both('rc2_subtotal'), fmtMoney(R.subtotal, cur, true), { size: 19 });
    if (R.discount) {
      y = rowLR(ctx, y, both('rc2_discount'), '− ' + fmtMoney(R.discount, cur, true), { size: 19 });
    }
    if (R.pointsValue) {
      y = rowLR(ctx, y, both('rc2_points_used'), '− ' + fmtMoney(R.pointsValue, cur, true), { size: 19 });
    }
    /* A delivery order's shipping, when the shop is the one charging it. */
    if (R.order && R.order.feeMode === 'invoice' && R.order.fee) {
      y = rowLR(ctx, y, both('rc2_shipping'), fmtMoney(R.order.fee, cur, true), { size: 19 });
    } else if (R.order && R.order.feeMode === 'courier') {
      y = rowLR(ctx, y, both('rc2_shipping'), both('rc2_ship_courier'), { size: 18, leftSize: 18 });
    }

    y = drawTotalBand(ctx, y + 4, both(R.order ? 'rc2_total_due' : 'rc2_total'),
      R.order ? R.order.due : R.total, cur);

    if (R.secondCurrency) {
      /* Latin currency code here, not the Arabic ل.س suffix fmtMoney would
         otherwise add — a single mixed-script line is one more thing to get
         the bidi ordering wrong for a secondary detail line, and "SYP" reads
         fine either direction. The primary total above already carries the
         Arabic suffix. */
      y = centerText(ctx, '≈ $' + western(R.secondCurrency.amount) +
        '  ·  1$ = ' + western(R.fxRate) + ' SYP',
        y + 8, { size: 18, dir: 'ltr' });
    } else {
      y += 10;
    }
    return y;
  }

  /* A delivery order is not one payment method. It is a list of what has come
     in — each with the transfer reference somebody will read back over the
     phone weeks later — and one line, the largest on the slip, saying what is
     still owed. Every figure was worked out on the server: a remaining
     balance the browser added up itself is a number that can be wrong in the
     customer's hand. */
  function drawOrderMoney(ctx, y, R) {
    var o = R.order;

    o.payments.forEach(function (p) {
      var lbl = (OG.lang === 'ar' ? p.methodAr : p.methodEn) || p.methodEn || p.methodAr || p.method;
      y = rowLR(ctx, y, lbl + (p.txnRef ? ' · ' + p.txnRef : ''),
        (p.kind === 'refund' ? '− ' : '') + fmtMoney(p.amount, p.currency, true),
        { size: 18, leftSize: 18 });
    });
    if (o.payments.length) y = dashRule(ctx, y + 4, 12);

    y = rowLR(ctx, y, both('rc2_paid'), fmtMoney(o.paid, R.currency, true), { size: 19 });
    y = drawTotalBand(ctx, y + 4, both('rc2_remaining'), o.remaining, R.currency, true) + 10;

    var note = !o.remaining ? 'rc2_paid_in_full'
      : (o.method === 'driver' || o.method === 'pickup') ? 'rc2_collect_door'
      : 'rc2_pay_before_ship';
    /* Each language wrapped on its own lines. Wrapped as one "ar · en"
       string, a line break fell mid-sentence and the bidi algorithm then
       carried the English full stop to the front of its own line. */
    var nl = L(note);
    wrapText(ctx, nl.ar, CW, 18).forEach(function (ln) {
      y = centerText(ctx, ln, y, { size: 18, dir: 'rtl' });
    });
    wrapText(ctx, nl.en, CW, 18).forEach(function (ln) {
      y = centerText(ctx, ln, y, { size: 18, dir: 'ltr' });
    });
    return y + 4;
  }

  function drawPayment(ctx, y, R) {
    if (R.order) return drawOrderMoney(ctx, y, R);
    var lbl = payLabel(R.payment);
    y = rowLR(ctx, y, both('rc2_payment'), lbl.ar + ' · ' + lbl.en, { size: 19, leftSize: 19 });

    /* The transfer reference, printed under the method it belongs to — the
       line somebody reads back over the phone weeks later. rowLR already
       draws the value column LTR, which is what these latin-digit references
       need on an otherwise Arabic receipt. */
    if (R.txnRef) {
      y = rowLR(ctx, y, both('txn_ref'), String(R.txnRef), { size: 18, leftSize: 18 });
    }

    if (R.toCollect) {
      y = drawTotalBand(ctx, y + 6, both('rc2_to_collect'), R.toCollect, R.currency, true) + 10;
    }

    if (R.pointsEarned && R.showLoyalty) {
      y = rowLR(ctx, y, both('rc2_points_earned'), '+' + western(R.pointsEarned), { size: 18 });
    }
    return y + 4;
  }

  /* Where the parcel is going, on the copy that travels with it: the person
     who receives it when that is somebody other than the buyer, the phone to
     ring at the door, the place, the address as it was written, and who is
     carrying it. */
  function drawShipTo(ctx, y, R) {
    var o = R.order;
    var ship = L('rc2_ship_to');
    y = centerPair(ctx, y, ship.ar, ship.en.toUpperCase(), { size: 19 });

    /* Typed text takes the direction of what was typed. Forced right-to-left,
       an address written in English printed its commas at the front of the
       line (",Mezzeh"). */
    var dirOf = function (s) { return ARABIC.test(s) ? 'rtl' : 'ltr'; };
    if (o.recipient) y = centerText(ctx, o.recipient, y, { size: 21, weight: '600', dir: dirOf(o.recipient) });
    if (o.phone) y = centerText(ctx, o.phone, y, { size: 19, dir: 'ltr' });

    var place = [o.city, OG.lang === 'ar' ? o.countryAr : o.countryEn].filter(Boolean).join(' · ');
    if (place) y = centerText(ctx, place, y, { size: 19, weight: '600', dir: 'rtl' });

    if (o.address) {
      wrapText(ctx, o.address, CW, 18).forEach(function (ln) {
        y = centerText(ctx, ln, y, { size: 18, dir: dirOf(o.address) });
      });
    }

    var via = L('rc2_m_' + (o.method || 'driver'));
    var viaTxt = (OG.lang === 'ar' ? via.ar : via.en) + (o.company ? ' · ' + o.company : '');
    y = centerText(ctx, viaTxt, y, { size: 18, dir: 'rtl' });
    if (o.trackingNo) y = centerText(ctx, o.trackingNo, y, { size: 18, dir: 'ltr' });
    return y + 4;
  }

  /* The barcode, then ONE line under it: the number on the left — scanners
     fail sometimes, eyes don't, so it stays in Western digits — and what the
     code is for on the right. They were two centred lines. */
  function drawCodes(ctx, y, R) {
    y = dashRule(ctx, y);
    if (!R.showBarcode) return y;
    y = drawBarcode(ctx, y, R.id);
    y = rowLR(ctx, y, both('rc2_scan_exchange'), R.id, { size: 18, leftWeight: '700' });
    return y + 2;
  }

  /* Instagram, Telegram, the maps link — printed here, not in the header,
     because the customer is standing in the shop when this comes off the
     printer: the street address stopped being useful the moment it did,
     but "find us again" and "reach us online" stay useful long after they
     leave.

     Instagram and Telegram share one line when they fit it, each with its
     mark. The marks are optional: a failed load draws the text alone, and a
     slow asset never holds a receipt back. */
  function drawContact(ctx, y, R, igImg, tgImg) {
    var chips = [];
    if (R.instagram) chips.push({ img: igImg, text: shortUrl(R.instagram) });
    if (R.telegram) chips.push({ img: tgImg, text: shortUrl(R.telegram) });
    if (!chips.length && !R.mapsUrl) return y;

    var size = 18, icon = 26, iGap = 7, between = 30;
    chips.forEach(function (c) { c.w = (c.img ? icon + iGap : 0) + measure(ctx, c.text, size); });
    var rows = [];
    var all = chips.reduce(function (s, c) { return s + c.w; }, 0) + between * Math.max(0, chips.length - 1);
    if (chips.length && all <= CW) rows.push(chips);
    else chips.forEach(function (c) { rows.push([c]); });

    rows.forEach(function (row) {
      var tw = row.reduce(function (s, c) { return s + c.w; }, 0) + between * (row.length - 1);
      var x = Math.round((W - tw) / 2);
      var base = y + Math.round((icon + size * 0.72) / 2);
      row.forEach(function (c) {
        if (c.img) {
          ctx.drawImage(c.img, x, y, icon, icon);
          note('icon', x, y, x + icon, y + icon);
        }
        textAt(ctx, c.text, x + (c.img ? icon + iGap : 0), base, { size: size, dir: 'ltr', align: 'left' });
        x += c.w + between;
      });
      y += icon + 8;
    });
    if (R.mapsUrl) y = centerText(ctx, shortUrl(R.mapsUrl), y, { size: 18, dir: 'ltr' });
    return y + 2;
  }

  /* The gift slip gets its OWN sentence, not the ordinary receipt's. Two
     things differ and both matter at the counter: the window is longer (a
     present is bought before it is given), and it has to spell out that an
     exchange is an exchange — no cash back, and the difference is payable on
     something dearer. An ordinary receipt never needs to say that, because
     the customer is holding the price. Falls back to the normal wording if
     the gift text has been emptied, so a blank field is never a slip with no
     policy on it at all. */
  function drawPolicy(ctx, y, R, gift) {
    var ar = gift ? (R.giftPolicyAr || R.policyAr) : R.policyAr;
    var en = gift ? (R.giftPolicyEn || R.policyEn) : R.policyEn;
    if (!ar && !en) return y;
    y = dashRule(ctx, y);
    if (ar) {
      wrapText(ctx, ar, CW, 18).forEach(function (ln) {
        y = centerText(ctx, ln, y, { size: 18, dir: 'rtl' });
      });
    }
    if (en) {
      wrapText(ctx, en, CW, 18).forEach(function (ln) {
        y = centerText(ctx, ln, y, { size: 18, dir: 'ltr' });
      });
    }
    return y + 6;
  }

  /* The sign-off, between two short rules, so the bottom of the slip reads
     as an ending rather than wherever the text ran out. */
  function drawFooter(ctx, y, R) {
    if (!R.footerAr && !R.footerEn) return y;
    y += 4;
    var top = y, len = 44, widest = 0;
    /* Wrapped, like the policy: the footer is typed in Settings and a long
       one used to run straight off both ends of the roll. */
    if (R.footerAr) {
      wrapText(ctx, R.footerAr, CW, 20, '700').forEach(function (ln) {
        widest = Math.max(widest, measure(ctx, ln, 20, '700'));
        y = centerText(ctx, ln, y, { size: 20, weight: '700', dir: 'rtl' });
      });
    }
    if (R.footerEn) {
      wrapText(ctx, R.footerEn, CW, 18).forEach(function (ln) {
        widest = Math.max(widest, measure(ctx, ln, 18));
        y = centerText(ctx, ln, y, { size: 18, dir: 'ltr' });
      });
    }
    /* Two short rules either side of the words, close enough to belong to
       them — and only where the words leave them room. */
    var edge = Math.round((W - widest) / 2) - 14;
    if (edge - len < PAD) return y;
    var mid = Math.round((top + y) / 2);
    [[edge - len, edge], [W - edge, W - edge + len]].forEach(function (seg) {
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(seg[0], mid - 1, seg[1] - seg[0], 2);
      ctx.restore();
    });
    return y;
  }

  /* --------------------------------------------------------------- draw */

  /* copyLabel is 'customer' | 'shop' | 'gift'.

     THE GIFT SLIP IS THE SAME RENDERER, NOT A SECOND ONE. Everything the
     receipt already knows how to do — the logo, the band, the header, the
     barcode, the contact block, the 18px floor, the ink threshold — applies
     unchanged, and the only question each section answers is whether it is
     about money. A separate gift renderer would drift: the day somebody fixes
     a layout bug on the receipt, the gift slip keeps it.

     What a gift slip must never carry: unit price, line discount, subtotal,
     discount, total, the second-currency line, payment method, transfer
     reference, COD amount, loyalty points, and the buyer's name and phone.
     That is the entire point of the piece of paper.

     opts.lines is the ticked subset of R.items, by index. Absent means all.
     The filter happens ONCE, here, so every drawing function below can go on
     trusting R.items the way it always has. */
  function draw(R, copyLabel, opts) {
    opts = opts || {};
    var gift = copyLabel === 'gift';

    if (gift && opts.lines && opts.lines.length) {
      var keep = {};
      opts.lines.forEach(function (i) { keep[i] = 1; });
      R = Object.keys(R).reduce(function (o, k) { o[k] = R[k]; return o; }, {});
      R.items = R.items.filter(function (_, i) { return keep[i]; });
    }

    return Promise.all([loadMark(), fontsReady(), loadInstagramMark(), loadTelegramMark(), loadLogo()]).then(function (res) {
      var markImg = res[0], igImg = res[2], tgImg = res[3], logoImg = res[4];

      /* Height cannot be known before drawing, and resizing a canvas clears
         it — so the layout runs once into a generously tall scratch canvas,
         and the result is cropped into a canvas of exactly the height the
         layout actually used. The FINAL canvas's height is that computed
         number, not a guess; the scratch is just how you grow a canvas. */
      var scratch = document.createElement('canvas');
      scratch.width = W;
      scratch.height = 4000;
      var ctx = scratch.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, scratch.height);
      boxes = [];

      var y = 16;
      y = drawLogo(ctx, y, markImg, logoImg);
      if (copyLabel === 'shop') y = drawBand(ctx, y, 'rc2_shop_copy');
      else if (gift) y = drawBand(ctx, y, 'rc2_gift_copy');
      y = drawHeader(ctx, y, R);
      y = drawMeta(ctx, y, R, gift);
      /* The boxes end on a solid rule; with no cashier line under them the
         next section's dashed rule would print right beneath it, two rules
         doing one job. */
      var ruled = gift || !R.cashierName;
      var sep = function () { if (ruled) ruled = false; else y = dashRule(ctx, y); };
      /* The buyer's name, phone and points balance are skipped on a gift
         slip. It is the buyer's record, not the recipient's, and the points
         balance is a number about somebody else's money. */
      if (R.customer && !gift) { sep(); y = drawCustomer(ctx, y, R); }
      /* A delivery order's destination, on the copy that travels with it.
         Never on a gift slip: that one is for the person opening the box. */
      if (R.order && !gift) { sep(); y = drawShipTo(ctx, y, R); }
      sep();
      y = drawItems(ctx, y, R, gift);
      y = dashRule(ctx, y);
      /* The two money blocks, gone in one place rather than guarded line by
         line inside each of them — nothing in either has a gift meaning. */
      if (!gift) {
        y = drawTotals(ctx, y, R);
        y = drawPayment(ctx, y, R);
      }
      y = drawCodes(ctx, y, R);
      y = drawContact(ctx, y, R, igImg, tgImg);
      y = drawPolicy(ctx, y, R, gift);
      y = drawFooter(ctx, y, R);
      y += 24;   // trailing feed so the footer isn't eaten by the cutter

      var h = Math.ceil(y);
      var out = document.createElement('canvas');
      out.width = W; out.height = h;
      var octx = out.getContext('2d');
      octx.fillStyle = '#fff';
      octx.fillRect(0, 0, W, h);
      octx.drawImage(scratch, 0, 0, W, h, 0, 0, W, h);
      return { canvas: out, height: h };
    });
  }

  /* ------------------------------------------------------------- shaping
     Both server (minor units, snake_case) and demo (whole units, camelCase)
     sales get normalised into the exact same shape draw() consumes, so
     every drawing function above is written once and trusts its input. */

  function receiptCfgFromConfig() {
    return {
      footerAr: CONFIG.RECEIPT_FOOTER_AR, footerEn: CONFIG.RECEIPT_FOOTER_EN,
      policyAr: CONFIG.RECEIPT_POLICY_AR, policyEn: CONFIG.RECEIPT_POLICY_EN,
      giftPolicyAr: CONFIG.RECEIPT_GIFT_POLICY_AR,
      giftPolicyEn: CONFIG.RECEIPT_GIFT_POLICY_EN,
      giftExchangeHours: CONFIG.RECEIPT_GIFT_EXCHANGE_HOURS,
      showBarcode: !!CONFIG.RECEIPT_SHOW_BARCODE,
      showLoyalty: !!CONFIG.RECEIPT_SHOW_LOYALTY,
      instagram: CONFIG.RECEIPT_INSTAGRAM, telegram: CONFIG.RECEIPT_TELEGRAM,
      mapsUrl: CONFIG.RECEIPT_MAPS_URL
    };
  }

  /* From GET /api/sales/:id/receipt — amounts are minor units, straight off
     the sales row. */
  /* The delivery-office block from server/lib/printing.js — minor units in,
     whole units out, like everything else on this slip. Every figure here
     was worked out on the server; nothing on paper is the browser's sum. */
  function orderFromServer(o, div) {
    if (!o) return null;
    return {
      method: o.method || 'driver',
      company: o.company_name || '',
      countryAr: o.country_ar || '', countryEn: o.country_en || '', country: o.country || '',
      city: o.city || '', address: o.address || '', recipient: o.recipient || '', phone: o.phone || '',
      fee: (o.fee || 0) / div, feeMode: o.fee_mode || 'none', plan: o.plan || '',
      status: o.status || '', trackingNo: o.tracking_no || '',
      due: (o.due || 0) / div, paid: (o.paid || 0) / div, remaining: (o.remaining || 0) / div,
      payments: (o.payments || []).map(function (p) {
        var pdiv = Math.pow(10, MINOR_EXP[p.currency] || 0);
        return {
          kind: p.kind, amount: p.amount / pdiv, currency: p.currency,
          amountOrder: p.amount_order / div, methodAr: p.method_ar, methodEn: p.method_en,
          txnRef: p.txn_ref || '', stage: p.stage || ''
        };
      })
    };
  }

  function fromServer(payload) {
    /* An order carries its currency's exponent, so a currency added one day
       prints right without the table above knowing about it. */
    var exp = payload.order && payload.order.minor_exp !== undefined && payload.order.minor_exp !== null
      ? payload.order.minor_exp : (MINOR_EXP[payload.currency] || 0);
    var div = Math.pow(10, exp);
    var cfg = receiptCfgFromConfig();

    var second = null;
    /* Only meaningful when this sale actually settled against a real
       USD/SYP rate — a USD-settled sale stores fx_rate = 1 (base===quote is
       never looked up), so a "second currency" line there would show the
       same number twice under a fabricated rate. See summary notes. */
    if (payload.currency === 'SYP' && payload.fx_base === 'USD' && payload.fx_rate) {
      second = { code: 'USD', amount: (payload.total / div) / payload.fx_rate };
    }

    return {
      id: payload.id, at: payload.at, cashierName: payload.cashier_name,
      customer: payload.customer ? {
        name: payload.customer.name, phone: payload.customer.phone,
        loyaltyPoints: payload.customer.loyalty_points
      } : null,
      items: payload.items.map(function (it) {
        return { name: it.name, size: it.size, qty: it.qty, unitPrice: it.unit_price / div,
                 colour: it.colour || null, colourAr: it.colour_ar || null };
      }),
      currency: payload.currency,
      subtotal: payload.subtotal / div, discount: payload.discount / div,
      pointsValue: 0, total: payload.total / div,
      fxRate: payload.fx_rate, secondCurrency: second,
      payment: payload.payment,
      txnRef: payload.txn_ref || null,
      toCollect: payload.delivery ? payload.delivery.to_collect / div : 0,
      pointsEarned: payload.points_earned || 0,
      shop: {
        name: payload.shop.name, branch: payload.shop.branch_name,
        address: payload.shop.address, phone: payload.shop.phone
      },
      /* payload.receipt.instagram/.telegram/.maps_url arrive here for free —
         server/lib/printing.js's configBlock() already forwards every
         receipt.* config key generically (strips the prefix, keeps the
         rest as the key), so the new migration's rows reach the client
         with no server-side code change. */
      instagram: payload.receipt.instagram, telegram: payload.receipt.telegram,
      mapsUrl: payload.receipt.maps_url,
      footerAr: payload.receipt.footer_ar, footerEn: payload.receipt.footer_en,
      policyAr: payload.receipt.policy_ar, policyEn: payload.receipt.policy_en,
      /* Arrive for free: configBlock() in server/lib/printing.js forwards
         every receipt.* key generically, stripping the prefix. */
      giftPolicyAr: payload.receipt.gift_policy_ar,
      giftPolicyEn: payload.receipt.gift_policy_en,
      giftExchangeHours: Number(payload.receipt.gift_exchange_hours) || 0,
      /* An order's slip always carries its invoice barcode: the delivery
         office and the board find the order again by scanning the slip. */
      showBarcode: payload.receipt.show_barcode === '1' || !!payload.order,
      showLoyalty: payload.receipt.show_loyalty === '1',
      order: orderFromServer(payload.order, div)
    };
  }

  /* ---------------------------------------------------------------- data */

  function fetchData(saleId) {
    return API.get('/api/sales/' + encodeURIComponent(saleId) + '/receipt')
      .then(function (res) { return fromServer(res.receipt); });
  }

  /* --------------------------------------------------------------- print */

  /* One opId per PRINT ATTEMPT, not per click. A failed attempt keeps its
     opId so pressing the same "try again" button retries the same attempt —
     the exact case applied_ops exists for: if the first try's bytes actually
     reached the printer and only the HTTP response was lost, the retry
     replays "already sent" instead of burning a second receipt. Success (or
     a deliberate later reprint) clears the slot, so that one gets its own
     fresh opId and genuinely prints again. */
  var pendingOpId = {};

  /* `kind` rides along so print_log can tell a gift slip from a reprint. A
     slip with no prices on it is exactly the one worth being able to trace
     back to whoever put it on paper. Keyed per kind as well as per sale: a
     failed gift print and a failed receipt print for the same sale are two
     different attempts and must not share a retry slot. */
  function sendToPrinter(bytesB64, saleId, copies, kind) {
    kind = kind || 'sale';
    var slot = kind + ':' + saleId;
    var opId = pendingOpId[slot] ||
      (pendingOpId[slot] = 'pr-' + kind + '-' + saleId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

    return API.post('/api/print', { saleId: saleId, bytes: bytesB64, copies: copies, opId: opId, kind: kind })
      .then(function (res) {
        delete pendingOpId[slot];
        /* Queued for the shop laptop's agent (receipt.transport 'agent'), and
           that agent has not been heard from: say so now, while the customer
           is still at the counter, not when they ask where their receipt is. */
        if (res && res.queued && !res.agentHere && typeof toast === 'function') {
          toast(t('print_receipt'), t('rc_agent_away'), 'warn', 8000);
        }
        return res;
      });
  }

  /* Builds both copies and mails them to the LAN printer in one socket
     write. */
  function printJob(saleId, opts) {
    opts = opts || {};
    return fetchData(saleId).then(function (R) {
      return Promise.all([draw(R, 'customer'), draw(R, 'shop')]).then(function (copies) {
        var bytes = ESCPOS.buildJob([copies[0].canvas, copies[1].canvas],
          { cutMode: CONFIG.RECEIPT_CUT_MODE, burnLuma: burnLuma() });
        return sendToPrinter(ESCPOS.toBase64(bytes), saleId, 2, 'sale');
      });
    });
  }

  /* ONE copy, not two. The shop already has its copy of this sale from when
     it was rung up — a second shop copy with the prices stripped off it would
     be a worse record of the same transaction, filed next to the good one. */
  function printGiftJob(saleId, lines) {
    return fetchData(saleId).then(function (R) {
      return draw(R, 'gift', { lines: lines }).then(function (copy) {
        var bytes = ESCPOS.build(copy.canvas,
          { cutMode: CONFIG.RECEIPT_CUT_MODE, burnLuma: burnLuma() });
        return sendToPrinter(ESCPOS.toBase64(bytes), saleId, 1, 'gift');
      });
    });
  }

  function printGift(saleId, lines) {
    if (typeof allow === 'function' && !allow('sale.reprint')) {
      if (typeof toast === 'function') toast(t('gift_receipt'), t('no_access'), 'err');
      return Promise.resolve();
    }
    if (typeof toast === 'function') toast(t('gift_receipt'), t('printing') + '…', 'ok', 2000);
    return printGiftJob(saleId, lines).then(function () {
      if (typeof toast === 'function') {
        toast(t('gift_receipt'), t('print_sent'), 'ok', 3000);
      }
    })['catch'](function (err) {
      if (typeof toast === 'function') {
        toast(t('gift_receipt'), API.friendly(err), 'err', 7000);
      }
    });
  }

  /* Called right after a sale completes. Two shapes, and the sale is already
     committed either way — nothing below this line can unwind money that is
     already in the drawer.

       confirm_print ON  — show the receipt and print when it is approved.
       confirm_print OFF — straight to the printer, fire-and-forget, never
                           making the cashier wait on a printer that might
                           be off or out of paper.

     The busy-counter case is why OFF still exists: on a Friday afternoon a
     dialog between every sale and its paper is friction with no upside,
     because the cashier is watching the same screen anyway. The approval
     step is for the admin raising an invoice deliberately. */
  function autoPrint(sale) {
    if (!CONFIG.RECEIPT_AUTO_PRINT) return;
    if (typeof allow === 'function' && !allow('sale.reprint')) return;

    if (CONFIG.RECEIPT_CONFIRM_PRINT) { approve(sale.id); return; }

    printJob(sale.id).catch(function (err) {
      if (typeof toast === 'function') {
        toast(typeof t === 'function' ? t('rc_title') : 'Receipt',
          API.friendly(err) +
          (typeof t === 'function' ? ' · ' + t('print_retry') : ' · Retry from the receipt.'),
          'err', 7000);
      }
    });
  }

  /* Manual "Print receipt" / reprint button. */
  function printSale(saleId) {
    if (typeof allow === 'function' && !allow('sale.reprint')) {
      if (typeof toast === 'function') toast(t('print_receipt'), t('no_access'), 'err');
      return;
    }
    if (typeof toast === 'function') toast(t('print_receipt'), t('printing') + '…', 'ok', 2000);
    printJob(saleId).then(function () {
      if (typeof toast === 'function') {
        toast(t('print_receipt'), t('print_sent'), 'ok', 3000);
      }
    }).catch(function (err) {
      if (typeof toast === 'function') {
        toast(t('print_receipt'), API.friendly(err), 'err', 7000);
      }
    });
  }

  /* On-screen preview at native dot resolution, scaled down by CSS to 72mm
     so what is approved on screen is pixel-identical to the paper. */
  function preview(saleId) {
    return fetchData(saleId).then(function (R) { return draw(R, 'customer'); });
  }

  /* ------------------------------------------------------- approve & print

     The paper is the one artefact of a sale that leaves the shop and cannot
     be edited afterwards — a wrong name or a wrong total on it is a customer
     standing at the counter with proof. So the receipt is shown first and
     printed only when somebody says so.

     What is approved is the SAME canvas that gets packed into ESC/POS bytes,
     not an HTML lookalike of it: an approval step that shows a different
     rendering than the one that prints is worse than no approval step, since
     it teaches people the check is meaningful when it is not. */
  function approve(saleId, opts) {
    opts = opts || {};
    if (typeof openModal !== 'function') { printSale(saleId); return; }

    var canPrint = typeof allow !== 'function' || allow('sale.reprint');

    return preview(saleId).then(function (res) {
      res.canvas.style.width = '72mm';
      res.canvas.style.maxWidth = '100%';
      res.canvas.style.display = 'block';
      res.canvas.style.margin = '0 auto';

      openModal({
        title: (typeof t === 'function' ? t('rc_approve_title') : 'Approve receipt') + ' — ' + saleId,
        body: '<div class="muted small" style="margin-bottom:10px">' +
                (typeof t === 'function' ? t('rc_approve_hint') : '') + '</div>' +
              /* .rc-fresh/.rc-paper drive the print-and-tear animation (see
                 css/print-hardware-receipt-newlabels.css). The canvas needs
                 the extra .rc-paper wrapper because ::before/::after do NOT
                 render on a <canvas> — it is a replaced element — and the
                 torn edge and print head are pseudo-elements. .rc-paper is a
                 plain div sized to the paper, so they have something real to
                 hang on. */
              '<div id="rcPreviewHost" style="background:#fff;padding:12px">' +
                '<div class="rc-fresh"><div class="rc-paper"></div></div>' +
              '</div>',
        /* Cancel first, print second: the destructive-ish, irreversible action
           (paper, ink, a customer handed the wrong slip) is never the button
           the thumb lands on by reflex. */
        foot: '<button class="btn btn-ghost" data-act="modal-close">' +
                (typeof t === 'function' ? t('rc_approve_cancel') : 'Not yet') + '</button>' +
              (canPrint
                ? '<button class="btn btn-primary" data-act="receipt-approve-print" data-id="' +
                    saleId + '">' + (typeof t === 'function' ? t('print_receipt') : 'Print') + '</button>'
                : ''),
        onOpen: function () {
          var host = document.getElementById('rcPreviewHost');
          if (!host) return;
          /* Into .rc-paper when it is there, so the animation wraps the
             canvas; straight into the host if the markup ever changes, so a
             missing wrapper costs the animation and never the preview. */
          (host.querySelector('.rc-paper') || host).appendChild(res.canvas);
        }
      });
    }).catch(function (err) {
      if (typeof toast === 'function') {
        toast(t('rc_title'), API.friendly(err), 'err', 6000);
      }
    });
  }

  /* --------------------------------------------------------- gift receipt

     Pick the lines, look at the paper, print it. One dialog rather than a
     picker followed by a preview, because the two questions are really one:
     "is THIS the slip that goes in the bag?" — and the answer changes as soon
     as a tick moves, so the paper has to move with it.

     A SINGLE-LINE SALE SKIPS THE TICKS ENTIRELY. Ticking one box out of one
     asks the cashier nothing and is a click between a customer and their bag.

     The preview redraws on every change rather than being drawn once and
     filtered: what is approved has to be the canvas that gets packed into
     bytes, which is the rule approve() above is built on. The logo, the marks
     and the font promises are all cached by then, so a redraw is a layout
     pass and nothing more. */
  var giftSel = null;

  function giftPickerHtml(R) {
    if (R.items.length < 2) return '';
    var h = '<div class="muted small" style="margin-bottom:10px">' + t('gift_pick_hint') + '</div>';
    R.items.forEach(function (it, i) {
      h += '<label class="check"><input type="checkbox" data-gift-line="' + i + '"' +
        (giftSel[i] ? ' checked' : '') + '><span><b>' + esc(it.name) + '</b>' +
        (it.size ? ' <span class="muted">· ' + esc(DB.lineSize(it)) + '</span>' : '') +
        '</span></label>';
    });
    return h;
  }

  function giftLines() {
    var out = [];
    giftSel.forEach(function (on, i) { if (on) out.push(i); });
    return out;
  }

  /* Redraw the paper for whatever is ticked right now. Guarded by a token so
     a fast run of clicks cannot land an older draw on top of a newer one —
     draw() is async, and canvases returning out of order would show a slip
     that matches neither the ticks nor the print. */
  var giftDrawSeq = 0;
  function giftRepaint(R) {
    var host = document.getElementById('rcGiftPaper');
    if (!host) return;
    var mine = ++giftDrawSeq;
    var lines = giftLines();
    if (!lines.length) { host.innerHTML = ''; return; }
    draw(R, 'gift', { lines: lines }).then(function (res) {
      if (mine !== giftDrawSeq) return;             // a later click already won
      var h2 = document.getElementById('rcGiftPaper');
      if (!h2) return;
      res.canvas.style.width = '72mm';
      res.canvas.style.maxWidth = '100%';
      res.canvas.style.display = 'block';
      res.canvas.style.margin = '0 auto';
      h2.innerHTML = '';
      h2.appendChild(res.canvas);
    });
  }

  function giftReceipt(saleId) {
    if (typeof allow === 'function' && !allow('sale.reprint')) {
      if (typeof toast === 'function') toast(t('gift_receipt'), t('no_access'), 'err');
      return;
    }
    if (typeof openModal !== 'function') { printGift(saleId); return; }

    return fetchData(saleId).then(function (R) {
      giftSel = R.items.map(function () { return true; });

      openModal({
        title: t('gift_pick_title') + ' — ' + saleId,
        body: giftPickerHtml(R) +
              '<div id="rcGiftHost" style="background:#fff;padding:12px;margin-top:10px">' +
                '<div class="rc-fresh"><div class="rc-paper" id="rcGiftPaper"></div></div>' +
              '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' +
                t('rc_approve_cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="gift-print" data-id="' +
                esc(saleId) + '">' + t('print') + '</button>',
        onOpen: function () {
          giftRepaint(R);
          var host = document.getElementById('rcGiftHost');
          var box = host && host.parentNode;
          if (!box) return;
          /* One delegated listener on the dialog, not one per tick — the same
             rule the rest of the app follows, and the list is rebuilt on no
             other event so there is nothing to rebind. */
          box.addEventListener('change', function (e) {
            var el = e.target;
            if (!el || !el.getAttribute) return;
            var i = el.getAttribute('data-gift-line');
            if (i === null) return;
            giftSel[Number(i)] = !!el.checked;
            giftRepaint(R);
          });
        }
      });
    })['catch'](function (err) {
      if (typeof toast === 'function') {
        toast(t('gift_receipt'), API.friendly(err), 'err', 6000);
      }
    });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    /* The approval dialog's own Print button: print, then close — so the
       modal cannot be left open over a receipt that has already been
       printed, which is how somebody prints a second one by accident. */
    ACTIONS['receipt-approve-print'] = function (el) {
      var id = el.getAttribute('data-id');
      if (!id) return;
      if (typeof closeModal === 'function') closeModal();
      printSale(id);
    };

    ACTIONS['approve-receipt'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id) approve(id);
    };

    ACTIONS['gift-receipt'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id) giftReceipt(id);
    };

    /* Close first, then print — same reason as receipt-approve-print: a dialog
       left open over a slip that has already come off the roll is how a second
       one gets printed by accident. Nothing ticked is refused rather than
       printing a slip with no items on it, which is not a thing to put in a
       bag. */
    ACTIONS['gift-print'] = function (el) {
      var id = el.getAttribute('data-id');
      if (!id) return;
      var lines = giftLines();
      if (!lines.length) {
        if (typeof toast === 'function') toast(t('gift_receipt'), t('gift_pick_none'), 'err', 4000);
        return;
      }
      if (typeof closeModal === 'function') closeModal();
      printGift(id, lines);
    };
  }

  return {
    autoPrint: autoPrint,
    printSale: printSale,
    preview: preview,
    approve: approve,
    giftReceipt: giftReceipt,
    printGift: printGift,
    register: register,
    /* Exposed for testing/preview screens that already have normalised data. */
    draw: draw,
    fromServer: fromServer,
    /* The ink boxes of the last draw — _nightshift/receipt/render.mjs only. */
    _boxes: function () { return boxes.slice(); }
  };
})();
