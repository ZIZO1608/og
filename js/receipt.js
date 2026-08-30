/* ==========================================================================
   OG SYSTEM — the 80mm thermal receipt
   --------------------------------------------------------------------------
   This is the paper that goes in the bag with the shoes, not a debug dump.
   Everything is drawn on a 576px-wide <canvas> — 72mm at 203dpi, 1 canvas
   pixel = 1 printer dot — because ESC/POS text mode cannot shape Arabic,
   cannot use Montserrat, and dithers a logo badly, and the server has no
   image library by design. The browser's own text engine does the hard
   part; js/escpos.js turns the finished canvas into printer bytes.

   The same canvas is also the file:// / static-host fallback: no server
   means no LAN socket, so that path calls window.print() on the canvas
   instead — see printLocal() below.

     Receipt.autoPrint(sale)      fire-and-forget, called right after a sale
                                   completes in js/pos.js
     Receipt.printSale(id)        manual "Print receipt" / reprint button
     Receipt.preview(id)          on-screen canvas at ~72mm, no printing
     Receipt.register()           wires the data-act handlers into ACTIONS,
                                   same shape as Deliveries.register()
   ========================================================================== */

var Receipt = (function () {

  var W = 576;                    // 72mm at 203dpi — never scaled after draw
  var PAD = 24;                   // ~3mm margin each side
  var CW = W - PAD * 2;           // content width
  var FONT = "'Montserrat', 'Segoe UI', Tahoma, sans-serif";
  /* Arabic has no glyphs in the vendored Montserrat subset (Latin/Cyrillic/
     Vietnamese only) — the same stack app-wide RTL text already uses in
     css/style.css, so Arabic silently falls back to Segoe UI/Tahoma there
     too. Using the identical stack here means the receipt matches what the
     rest of the app already renders, not a second, untested font choice. */

  var MINOR_EXP = { USD: 2, SYP: 0 };   // fixed for this shop — see CLAUDE.md

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

  function fontsReady() {
    return (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
      ? document.fonts.ready
      : Promise.resolve();
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

  /* USD is prefixed ("$12"), SYP is suffixed ("12,500 SYP" / "12,500 ل.س") —
     the same convention app.js's money() already uses on every other screen
     in this system, so a cashier reading the till and the receipt side by
     side sees the same shape of number. */
  function fmtMoney(wholeUnits, code, ar) {
    if (code === 'USD') return '$' + western(wholeUnits);
    return western(wholeUnits) + ' ' + currencySuffix(code, ar);
  }

  function two(n) { return String(n).padStart(2, '0'); }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(), h12 = h % 12 || 12;
    return {
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

  function setFont(ctx, size, weight) {
    ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + FONT;
  }

  function textAt(ctx, text, x, y, opts) {
    opts = opts || {};
    ctx.save();
    setFont(ctx, opts.size || 20, opts.weight);
    ctx.direction = opts.dir || 'ltr';
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = opts.color || '#000';
    ctx.fillText(String(text == null ? '' : text), x, y);
    ctx.restore();
  }

  /* ONE VERTICAL CONVENTION, and this is it: every y in this module is the
     TOP of the block about to be drawn, and every draw helper returns the top
     of the next one. Nothing takes or returns a text baseline.

     It used to be split. textAt/centerText took a BASELINE while rowLR,
     labelRow and drawItems took a TOP, so composing them was only safe if
     you remembered which kind each one was — and the failure is silent and
     ugly: the next line's cap-height reaches back up into the block above
     it. Every "a bare Npx gap let X creep into Y" comment in this file is
     one of those collisions found on paper and patched with a magic number.
     Two of them were still live: the QR caption printed through the
     Instagram line, and a COD receipt's English "Amount to collect" printed
     through the Arabic line above it.

     Baseline sits one em below the top, matching what rowLR/labelRow already
     do, so a line occupies [y, y + lineHeight) and its glyphs cannot escape
     upward into whatever was drawn before it. */
  function lineHeight(size) { return Math.round(size * 1.42); }

  function centerText(ctx, text, y, opts) {
    opts = opts || {};
    var size = opts.size || 20;
    textAt(ctx, text, W / 2, y + size, {
      size: size, weight: opts.weight, dir: opts.dir, align: 'center', color: opts.color
    });
    return y + (opts.lineHeight || lineHeight(size));
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
    return y + (gap === undefined ? 20 : gap);
  }

  function solidRule(ctx, y, weight) {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = weight || 3;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.restore();
    return y + 14;
  }

  /* Greedy word wrap using real canvas metrics, so a 70mm-too-long product
     name breaks where the printed line actually would, not where a
     character count guesses it might. */
  function wrapText(ctx, text, maxWidth, size, weight) {
    setFont(ctx, size, weight);
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

  /* A meta/customer row: Arabic label, a smaller English label directly
     beneath it, both right-aligned — and the value opposite, on the left,
     vertically centred against the two-line label block. Matches how
     receiptHtml()'s CSS-flex rows already read in a dir="rtl" container:
     label side first (right), value side second (left). */
  function labelRow(ctx, y, ar, en, value, opts) {
    opts = opts || {};
    var arSize = opts.size || 22, enSize = Math.round(arSize * 0.68);
    var arH = Math.round(arSize * 1.3), enH = Math.round(enSize * 1.35);
    textAt(ctx, ar, W - PAD, y + arSize, { size: arSize, weight: '600', dir: 'rtl', align: 'right' });
    textAt(ctx, en, W - PAD, y + arH + enSize - 2, { size: enSize, dir: 'ltr', align: 'right', color: '#000' });
    var blockH = arH + enH;
    textAt(ctx, value, PAD, y + Math.round(blockH / 2) + Math.round((opts.valueSize || arSize) * 0.36),
      { size: opts.valueSize || arSize, weight: opts.valueWeight || '700', dir: 'ltr', align: 'left' });
    return y + blockH + (opts.gap === undefined ? 10 : opts.gap);
  }

  /* A single two-column row: right side (near the RTL reading start) and
     left side (the amount) — item detail lines and totals both use it. */
  function rowLR(ctx, y, right, left, opts) {
    opts = opts || {};
    var size = opts.size || 20;
    textAt(ctx, right, W - PAD, y + size, { size: size, weight: opts.weight, dir: opts.dir || 'rtl', align: 'right' });
    textAt(ctx, left, PAD, y + size, { size: opts.leftSize || size, weight: opts.leftWeight || opts.weight, dir: 'ltr', align: 'left' });
    return y + Math.round(size * 1.5);
  }

  /* A small square mark immediately left of a line of text, the pair centered
     together as one block — used for the Instagram/Telegram rows. y is the
     TOP of the row (see centerText); the icon is taller than the text, so the
     row's height is the icon's and the text is centred against it rather than
     the other way round. */
  function iconTextRow(ctx, y, iconImg, text, size) {
    size = size || 15;
    setFont(ctx, size);
    var textW = ctx.measureText(String(text || '')).width;
    var iconSize = Math.round(size * 1.7), gap = 8;
    var hasIcon = !!iconImg;
    var rowH = hasIcon ? iconSize : lineHeight(size);
    var totalW = (hasIcon ? iconSize + gap : 0) + textW;
    var x0 = Math.round((W - totalW) / 2);
    if (hasIcon) ctx.drawImage(iconImg, x0, y, iconSize, iconSize);
    /* Baseline that centres the text's x-height against the icon box. */
    var baseline = y + Math.round((rowH + size * 0.72) / 2);
    textAt(ctx, text, x0 + (hasIcon ? iconSize + gap : 0), baseline,
      { size: size, dir: 'ltr', align: 'left' });
    return y + rowH + 6;
  }

  /* ------------------------------------------------------ codes: barcode */

  function drawBarcode(ctx, y, text) {
    if (typeof Codes === 'undefined' || !Codes.code128) return y;
    var mods = Codes.code128(text);
    if (!mods) return y;

    var quiet = 10, total = quiet * 2 + mods.length;
    var modPx = Math.max(2, Math.floor(CW / total));
    var drawW = modPx * total;
    var x0 = Math.round((W - drawW) / 2);
    var barH = 72;

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

    /* A plain gap now. It used to be 26 because centerText took a baseline and
       most of it was swallowed reaching back up for the glyphs; with the top
       convention the number simply starts 10px under the bars. */
    y += barH + 10;
    /* Scanners fail sometimes, eyes don't — the number stays underneath in
       Western digits, always LTR regardless of the receipt's own direction. */
    y = centerText(ctx, text, y, { size: 20, dir: 'ltr' });
    return y + 8;
  }

  /* ------------------------------------------------------------ sections */

  function drawLogo(ctx, y, logoImg) {
    if (!logoImg) return y + 8;
    var maxW = 180;
    var w = Math.min(maxW, logoImg.naturalWidth || maxW);
    var h = w * (logoImg.naturalHeight || w) / (logoImg.naturalWidth || w);
    ctx.drawImage(logoImg, Math.round((W - w) / 2), y, w, h);
    /* Same story as drawShopBand: 28 was baseline compensation for the 30px
       header line, not breathing room. 14 is the breathing room. */
    return y + h + 14;
  }

  /* Shop copy only: a solid black band right under the logo so the two
     copies can never be confused at a glance, on the customer's side of
     the counter or in a drawer full of them. */
  function drawShopBand(ctx, y) {
    var h = 40;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(PAD, y, CW, h);
    ctx.restore();
    textAt(ctx, both('rc2_shop_copy'), W / 2, y + 27,
      { size: 20, weight: '700', dir: 'rtl', align: 'center', color: '#fff' });
    /* Was 34 to clear the 30px header's cap-height back up from its baseline;
       the header now starts at the y it is given, so this is just the gap. */
    return y + h + 16;
  }

  function drawHeader(ctx, y, R) {
    /* No street address here on purpose — the customer holding this paper
       is standing in the shop; the address line stopped being useful the
       moment it printed. What replaces it, further down, is how to find
       the shop again: the contact block (drawContact) with Instagram,
       Telegram and the maps link. shop.address itself is untouched and
       still used elsewhere (customer-facing delivery slips, etc.) — only
       this one printed line goes away. */
    y = centerText(ctx, (R.shop.name || 'OG SPORTS').toUpperCase(), y, { size: 30, weight: '800' });
    if (R.shop.branch) y = centerText(ctx, R.shop.branch, y, { size: 18, dir: 'rtl' });
    if (R.shop.phone) y = centerText(ctx, R.shop.phone, y, { size: 18, dir: 'ltr' });
    return y + 4;
  }

  function drawMeta(ctx, y, R) {
    var dt = fmtDateTime(R.at);
    var inv = L('rc2_invoice'), dtl = L('rc2_datetime'), csh = L('rc2_cashier');
    y = labelRow(ctx, y, inv.ar, inv.en, R.id, { size: 22 });
    y = labelRow(ctx, y, dtl.ar, dtl.en, dt.en, { size: 20 });
    if (R.cashierName) y = labelRow(ctx, y, csh.ar, csh.en, R.cashierName, { size: 20 });
    return y;
  }

  function drawCustomer(ctx, y, R) {
    var c = R.customer;
    if (!c) return y;
    var cust = L('rc2_customer'), ph = L('rc2_phone'), bal = L('rc2_points_balance');
    y = labelRow(ctx, y, cust.ar, cust.en, c.name, { size: 22 });
    if (c.phone) y = labelRow(ctx, y, ph.ar, ph.en, c.phone, { size: 20 });
    if (R.showLoyalty) {
      y = labelRow(ctx, y, bal.ar, bal.en, western(c.loyaltyPoints), { size: 20 });
    }
    return y;
  }

  function drawItems(ctx, y, R) {
    R.items.forEach(function (it) {
      var lines = wrapText(ctx, it.name, CW, 22, '600');
      lines.forEach(function (ln) {
        textAt(ctx, ln, W - PAD, y + 22, { size: 22, weight: '600', dir: 'rtl', align: 'right' });
        y += 30;
      });
      if (it.size) {
        textAt(ctx, L('rc2_size').ar + ' ' + it.size, W - PAD - 20, y + 17, { size: 17, dir: 'rtl', align: 'right' });
        y += 24;
      }
      y = rowLR(ctx, y,
        it.qty + ' × ' + western(it.unitPrice),
        western(it.qty * it.unitPrice),
        { size: 19 });
      if (it.lineDiscount) {
        y = rowLR(ctx, y - 4, both('rc2_line_discount'), '− ' + western(it.lineDiscount), { size: 16 });
      }
      y += 6;
    });
    return y;
  }

  function drawTotals(ctx, y, R) {
    y = rowLR(ctx, y, both('rc2_subtotal'), fmtMoney(R.subtotal, R.currency, true), { size: 19 });
    if (R.discount) {
      y = rowLR(ctx, y, both('rc2_discount'), '− ' + fmtMoney(R.discount, R.currency, true), { size: 19 });
    }
    if (R.pointsValue) {
      y = rowLR(ctx, y, both('rc2_points_used'), '− ' + fmtMoney(R.pointsValue, R.currency, true), { size: 19 });
    }
    y = solidRule(ctx, y + 4);
    y = rowLR(ctx, y, both('rc2_total'), fmtMoney(R.total, R.currency, true),
      { size: 32, weight: '800', leftWeight: '800' });

    if (R.secondCurrency) {
      /* Latin currency code here, not the Arabic ل.س suffix fmtMoney would
         otherwise add — a single mixed-script line is one more thing to get
         the bidi ordering wrong for a secondary detail line, and "SYP" reads
         fine either direction. The primary total above already carries the
         Arabic suffix. */
      y = centerText(ctx, '≈ $' + western(R.secondCurrency.amount) +
        '  ·  1$ = ' + western(R.fxRate) + ' SYP',
        y + 2, { size: 16, dir: 'ltr' });
    }
    return y + 6;
  }

  function drawPayment(ctx, y, R) {
    var lbl = payLabel(R.payment);
    y = rowLR(ctx, y, both('rc2_payment'), lbl.ar + ' · ' + lbl.en, { size: 19, leftSize: 17 });

    /* The transfer reference, printed under the method it belongs to — the
       line somebody reads back over the phone weeks later. rowLR already
       draws the value column LTR, which is what these latin-digit references
       need on an otherwise Arabic receipt. */
    if (R.txnRef) {
      y = rowLR(ctx, y, both('txn_ref'), String(R.txnRef), { size: 18, leftSize: 15 });
    }

    if (R.toCollect) {
      y = dashRule(ctx, y + 6, 14);
      y = rowLR(ctx, y, L('rc2_to_collect').ar, fmtMoney(R.toCollect, R.currency, true),
        { size: 24, weight: '800', leftWeight: '800' });
      y = centerText(ctx, L('rc2_to_collect').en, y, { size: 16, dir: 'ltr' });
    }

    if (R.pointsEarned && R.showLoyalty) {
      y = rowLR(ctx, y, both('rc2_points_earned'), '+' + western(R.pointsEarned), { size: 18 });
    }
    return y + 6;
  }

  function drawCodes(ctx, y, R) {
    y = dashRule(ctx, y);
    if (R.showBarcode) {
      y = drawBarcode(ctx, y, R.id);
      y = centerText(ctx, both('rc2_scan_exchange'), y, { size: 13, dir: 'rtl' });
    }
    return y;
  }

  /* Instagram, Telegram, the maps link — printed here, not in the header,
     because the customer is standing in the shop when this comes off the
     printer: the street address stopped being useful the moment it did,
     but "find us again" and "reach us online" stay useful long after they
     leave. Icons are optional-safe (icon load failure just draws the text
     alone, same graceful-degrade shape drawLogo already uses for the shop
     logo) so a slow/broken asset load never blocks a receipt printing. */
  function drawContact(ctx, y, R, igImg, tgImg) {
    if (!R.instagram && !R.telegram && !R.mapsUrl) return y;
    if (R.instagram) y = iconTextRow(ctx, y, igImg, shortUrl(R.instagram), 15);
    if (R.telegram) y = iconTextRow(ctx, y, tgImg, shortUrl(R.telegram), 15);
    if (R.mapsUrl) y = centerText(ctx, shortUrl(R.mapsUrl), y, { size: 13, dir: 'ltr' });
    return y + 6;
  }

  function drawPolicy(ctx, y, R) {
    if (!R.policyAr && !R.policyEn) return y;
    y = dashRule(ctx, y);
    if (R.policyAr) {
      wrapText(ctx, R.policyAr, CW, 17).forEach(function (ln) {
        y = centerText(ctx, ln, y, { size: 17, dir: 'rtl' });
      });
    }
    if (R.policyEn) {
      wrapText(ctx, R.policyEn, CW, 14).forEach(function (ln) {
        y = centerText(ctx, ln, y, { size: 14, dir: 'ltr' });
      });
    }
    return y + 4;
  }

  function drawFooter(ctx, y, R) {
    if (R.footerAr) y = centerText(ctx, R.footerAr, y, { size: 20, weight: '600', dir: 'rtl' });
    if (R.footerEn) y = centerText(ctx, R.footerEn, y, { size: 15, dir: 'ltr' });
    return y;
  }

  /* --------------------------------------------------------------- draw */

  function draw(R, copyLabel) {
    return Promise.all([loadLogo(), fontsReady(), loadInstagramMark(), loadTelegramMark()]).then(function (res) {
      var logoImg = res[0], igImg = res[2], tgImg = res[3];

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

      var y = 24;
      y = drawLogo(ctx, y, logoImg);
      if (copyLabel === 'shop') y = drawShopBand(ctx, y);
      y = drawHeader(ctx, y, R);
      y = dashRule(ctx, y);
      y = drawMeta(ctx, y, R);
      if (R.customer) { y = dashRule(ctx, y); y = drawCustomer(ctx, y, R); }
      y = dashRule(ctx, y);
      y = drawItems(ctx, y, R);
      y = dashRule(ctx, y);
      y = drawTotals(ctx, y, R);
      y = drawPayment(ctx, y, R);
      y = drawCodes(ctx, y, R);
      y = drawContact(ctx, y, R, igImg, tgImg);
      y = drawPolicy(ctx, y, R);
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
      showBarcode: !!CONFIG.RECEIPT_SHOW_BARCODE,
      showLoyalty: !!CONFIG.RECEIPT_SHOW_LOYALTY,
      instagram: CONFIG.RECEIPT_INSTAGRAM, telegram: CONFIG.RECEIPT_TELEGRAM,
      mapsUrl: CONFIG.RECEIPT_MAPS_URL
    };
  }

  /* From GET /api/sales/:id/receipt — amounts are minor units, straight off
     the sales row. */
  function fromServer(payload) {
    var exp = MINOR_EXP[payload.currency] || 0;
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
        return { name: it.name, size: it.size, qty: it.qty, unitPrice: it.unit_price / div };
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
      showBarcode: payload.receipt.show_barcode === '1',
      showLoyalty: payload.receipt.show_loyalty === '1'
    };
  }

  /* From js/data.js's local sale object — demo mode, or the shape pos.js
     builds right after a real sale, whole units already. */
  function fromLocal(sale) {
    var cust = sale.customerId ? DB.customer(sale.customerId) : null;
    var cfg = receiptCfgFromConfig();
    var second = null;
    if (CONFIG.BASE_CURRENCY === 'SYP' && sale.fxRate) {
      second = { code: 'USD', amount: sale.total / sale.fxRate };
    }
    return {
      id: sale.id, at: sale.date, cashierName: sale.cashier,
      customer: cust ? { name: cust.name, phone: cust.phone, loyaltyPoints: cust.loyaltyPoints } : null,
      items: sale.items.map(function (it) {
        return { name: it.name, size: it.size, qty: it.qty, unitPrice: it.unitPrice };
      }),
      currency: CONFIG.BASE_CURRENCY, subtotal: sale.subtotal, discount: sale.discount,
      pointsValue: sale.pointsUsed ? sale.pointsUsed * CONFIG.LOYALTY_POINT_VALUE : 0,
      total: sale.total, fxRate: sale.fxRate, secondCurrency: second,
      payment: sale.payment, txnRef: sale.txnRef || null,
      toCollect: sale.payment === 'cod' ? sale.total : 0,
      pointsEarned: Math.round(sale.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000),
      shop: {
        name: CONFIG.SHOP_NAME, branch: CONFIG.SHOP_BRANCH,
        address: CONFIG.SHOP_ADDRESS, phone: CONFIG.SHOP_PHONE
      },
      instagram: cfg.instagram, telegram: cfg.telegram, mapsUrl: cfg.mapsUrl,
      footerAr: cfg.footerAr, footerEn: cfg.footerEn,
      policyAr: cfg.policyAr, policyEn: cfg.policyEn,
      showBarcode: cfg.showBarcode, showLoyalty: cfg.showLoyalty
    };
  }

  /* ---------------------------------------------------------------- data */

  function fetchData(saleId) {
    if (typeof Auth !== 'undefined') {
      return API.get('/api/sales/' + encodeURIComponent(saleId) + '/receipt')
        .then(function (res) { return fromServer(res.receipt); });
    }
    var local = DB.sale(saleId);
    if (!local) return Promise.reject(new Error('No such sale.'));
    return Promise.resolve(fromLocal(local));
  }

  /* --------------------------------------------------------------- print */

  function printLocal(canvas) {
    /* No server, no LAN socket — the same canvas prints through the OS
       dialog instead, sized to the same 80mm roll so what was previewed is
       what comes out. */
    var win = window.open('', '_blank');
    if (!win) { window.print(); return; }
    var mmH = canvas.height / 8;   // 8 dots/mm at 203dpi
    win.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      (typeof t === 'function' ? t('rc_title') : 'Receipt') +
      '</title><style>@page{size:80mm auto;margin:0}' +
      'body{margin:0}img{width:80mm;display:block}</style></head><body>' +
      '<img src="' + canvas.toDataURL('image/png') + '"></body></html>'
    );
    win.document.close();
    win.onload = function () { win.focus(); win.print(); };
  }

  /* One opId per PRINT ATTEMPT, not per click. A failed attempt keeps its
     opId so pressing the same "try again" button retries the same attempt —
     the exact case applied_ops exists for: if the first try's bytes actually
     reached the printer and only the HTTP response was lost, the retry
     replays "already sent" instead of burning a second receipt. Success (or
     a deliberate later reprint) clears the slot, so that one gets its own
     fresh opId and genuinely prints again. */
  var pendingOpId = {};

  function sendToPrinter(bytesB64, saleId, copies) {
    var opId = pendingOpId[saleId] ||
      (pendingOpId[saleId] = 'pr-' + saleId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

    return API.post('/api/print', { saleId: saleId, bytes: bytesB64, copies: copies, opId: opId })
      .then(function (res) { delete pendingOpId[saleId]; return res; });
  }

  /* Builds both copies, and either mails them to the LAN printer in one
     socket write or falls back to the browser print dialog when there is
     no server to reach. */
  function printJob(saleId, opts) {
    opts = opts || {};
    return fetchData(saleId).then(function (R) {
      return Promise.all([draw(R, 'customer'), draw(R, 'shop')]).then(function (copies) {
        if (typeof Auth === 'undefined') {
          printLocal(copies[0].canvas);
          return { local: true };
        }
        var bytes = ESCPOS.buildJob([copies[0].canvas, copies[1].canvas], { cutMode: CONFIG.RECEIPT_CUT_MODE });
        return sendToPrinter(ESCPOS.toBase64(bytes), saleId, 2);
      });
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
    if (typeof Auth === 'undefined') return;
    if (!CONFIG.RECEIPT_AUTO_PRINT) return;
    if (typeof allow === 'function' && !allow('sale.reprint')) return;

    if (CONFIG.RECEIPT_CONFIRM_PRINT) { approve(sale.id); return; }

    printJob(sale.id).catch(function (err) {
      if (typeof toast === 'function') {
        toast(typeof t === 'function' ? t('rc_title') : 'Receipt',
          (typeof API !== 'undefined' ? API.friendly(err) : err.message) +
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
    printJob(saleId).then(function (res) {
      if (typeof toast === 'function' && !res.local) {
        toast(t('print_receipt'), t('print_sent'), 'ok', 3000);
      }
    }).catch(function (err) {
      if (typeof toast === 'function') {
        toast(t('print_receipt'), typeof API !== 'undefined' ? API.friendly(err) : err.message, 'err', 7000);
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
        toast(t('rc_title'), typeof API !== 'undefined' ? API.friendly(err) : err.message, 'err', 6000);
      }
    });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['print-receipt'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id) printSale(id);
    };

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

    ACTIONS['preview-receipt'] = function (el) {
      var id = el.getAttribute('data-id');
      if (!id || typeof openModal !== 'function') return;
      preview(id).then(function (res) {
        res.canvas.style.width = '72mm';
        res.canvas.style.maxWidth = '100%';
        res.canvas.style.display = 'block';
        res.canvas.style.margin = '0 auto';
        openModal({
          title: (typeof t === 'function' ? t('rc_title') : 'Receipt') + ' — ' + id,
          body: '<div id="rcPreviewHost" style="background:#fff;padding:12px"></div>',
          foot: '<button class="btn btn-primary" data-act="modal-close">' +
                (typeof t === 'function' ? t('close') : 'Close') + '</button>',
          /* The canvas carries real pixel data, not markup, so it is
             attached to the live DOM after openModal builds it rather than
             serialised into the body string. */
          onOpen: function () {
            var host = document.getElementById('rcPreviewHost');
            if (host) host.appendChild(res.canvas);
          }
        });
      }).catch(function (err) {
        if (typeof toast === 'function') {
          toast(t('rc_title'), typeof API !== 'undefined' ? API.friendly(err) : err.message, 'err', 6000);
        }
      });
    };
  }

  return {
    autoPrint: autoPrint,
    printSale: printSale,
    preview: preview,
    approve: approve,
    register: register,
    /* Exposed for testing/preview screens that already have normalised data. */
    draw: draw,
    fromServer: fromServer,
    fromLocal: fromLocal
  };
})();
