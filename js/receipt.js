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

  function fontsReady() {
    return (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
      ? document.fonts.ready
      : Promise.resolve();
  }

  /* -------------------------------------------------------------- format */

  function western(n) {
    /* toLocaleString('en-US') is already Western-digit and comma-grouped —
       reused from app.js when it has loaded, else the same formula inline
       so this module never hard-depends on load order. */
    return Math.round(Number(n) || 0).toLocaleString('en-US');
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

  function centerText(ctx, text, y, opts) {
    opts = opts || {};
    textAt(ctx, text, W / 2, y, {
      size: opts.size, weight: opts.weight, dir: opts.dir, align: 'center', color: opts.color
    });
    return y + (opts.lineHeight || Math.round((opts.size || 20) * 1.4));
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

    /* centerText's y is a text BASELINE, and a 20px line's cap-height reaches
       back up ~16px from it — a 10px gap after the bars let the human-
       readable number cut into the bottom row of the barcode itself. */
    y += barH + 26;
    /* Scanners fail sometimes, eyes don't — the number stays underneath in
       Western digits, always LTR regardless of the receipt's own direction. */
    y = centerText(ctx, text, y, { size: 20, dir: 'ltr' });
    return y + 8;
  }

  function drawQr(ctx, y, payload, fallback) {
    if (typeof Codes === 'undefined' || !Codes.qrMatrix) return y;
    var qr = Codes.qrMatrix(payload) || Codes.qrMatrix(fallback);
    if (!qr) return y;

    var quiet = 3, total = qr.size + quiet * 2;
    var px = Math.min(240, CW);
    var scale = Math.max(1, Math.floor(px / total));
    var side = scale * total;
    var x0 = Math.round((W - side) / 2);

    ctx.save();
    ctx.fillStyle = '#000';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) ctx.fillRect(x0 + (c + quiet) * scale, y + (r + quiet) * scale, scale, scale);
      }
    }
    ctx.restore();
    return y + side + 14;
  }

  /* ------------------------------------------------------------ sections */

  function drawLogo(ctx, y, logoImg) {
    if (!logoImg) return y + 8;
    var maxW = 180;
    var w = Math.min(maxW, logoImg.naturalWidth || maxW);
    var h = w * (logoImg.naturalHeight || w) / (logoImg.naturalWidth || w);
    ctx.drawImage(logoImg, Math.round((W - w) / 2), y, w, h);
    /* Whatever follows this — the shop-copy band, or the header directly —
       is drawn straight after. The header's first line is a 30px bold
       centerText call, and centerText's y is a BASELINE: its cap-height
       reaches back up ~22px, so a bare 14px gap let "OG SPORTS" creep into
       the logo's own bottom edge (same bug as the barcode/shop-band text). */
    return y + h + 28;
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
    /* The header right after this is a 30px bold line whose cap-height
       reaches back up ~26px from its own baseline — the same clearance
       problem the barcode's human-readable text had against the bars above
       it. A bare 16px gap let "OG SPORTS" creep into the black band. */
    return y + h + 34;
  }

  function drawHeader(ctx, y, R) {
    y = centerText(ctx, (R.shop.name || 'OG SPORTS').toUpperCase(), y, { size: 30, weight: '800' });
    if (R.shop.branch) y = centerText(ctx, R.shop.branch, y, { size: 18, dir: 'rtl' });
    if (R.shop.address) y = centerText(ctx, R.shop.address, y, { size: 18, dir: 'rtl' });
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
    if (R.showBarcode) y = drawBarcode(ctx, y, R.id);
    if (R.showQr) y = drawQr(ctx, y, R.qrPayload, R.id);
    return y;
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
    return Promise.all([loadLogo(), fontsReady()]).then(function (res) {
      var logoImg = res[0];

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
      showQr: !!CONFIG.RECEIPT_SHOW_QR, showBarcode: !!CONFIG.RECEIPT_SHOW_BARCODE,
      showLoyalty: !!CONFIG.RECEIPT_SHOW_LOYALTY
    };
  }

  function qrPayloadFor(id, token) {
    var base = String(CONFIG.PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (token && /^https:\/\//i.test(base) && !/github\.io/i.test(base)) {
      return base + '/i/' + token;
    }
    return (CONFIG.SHOP_NAME || 'OG').toUpperCase() + ' | ' + id;
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
      qrPayload: qrPayloadFor(payload.id, null),
      footerAr: payload.receipt.footer_ar, footerEn: payload.receipt.footer_en,
      policyAr: payload.receipt.policy_ar, policyEn: payload.receipt.policy_en,
      showQr: payload.receipt.show_qr === '1', showBarcode: payload.receipt.show_barcode === '1',
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
      qrPayload: qrPayloadFor(sale.id, sale.publicToken),
      footerAr: cfg.footerAr, footerEn: cfg.footerEn,
      policyAr: cfg.policyAr, policyEn: cfg.policyEn,
      showQr: cfg.showQr, showBarcode: cfg.showBarcode, showLoyalty: cfg.showLoyalty
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

  /* Fire-and-forget, called right after a sale completes. Never makes the
     cashier wait on the printer — same principle as a delivery assignment
     happening after the sale is already committed. */
  function autoPrint(sale) {
    if (typeof Auth === 'undefined') return;
    if (!CONFIG.RECEIPT_AUTO_PRINT) return;
    if (typeof allow === 'function' && !allow('sale.reprint')) return;

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

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['print-receipt'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id) printSale(id);
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
    register: register,
    /* Exposed for testing/preview screens that already have normalised data. */
    draw: draw,
    fromServer: fromServer,
    fromLocal: fromLocal
  };
})();
