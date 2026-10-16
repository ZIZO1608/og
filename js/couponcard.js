/* ==========================================================================
   OG SYSTEM — the coupon's picture                          [couponcard.js]
   --------------------------------------------------------------------------
   One branded picture of a coupon code: the OG mark, what it takes off in
   both languages, a QR that opens the coupon's page (GET /c/<code>), and the
   code itself. The owner prints these and leaves them around the city —
   whoever finds one gets the discount — so the picture is a TICKET with
   notches, readable from a metre away, and says everything without the
   page.

   Used in two places, which is why it is its own file:
     - the coupons page (js/coupons.js): Download picture, and a whole batch
       as one zip;
     - the coupon's public page (lib/coupon-page.js): Save image, for the
       person who just scanned a sticker.

   Needs js/codes.js (the one QR encoder) and the fonts in
   assets/fonts/fonts.css. Never throws: every failure is a rejected promise
   the caller turns into words.

     CouponCard.draw(c)      -> Promise<canvas>
     CouponCard.blob(c)      -> Promise<Blob>   (image/png)
     CouponCard.save(c)      -> Promise          share sheet on a phone, a download elsewhere
     CouponCard.fileName(c)  -> 'og-coupon-OG-7K2QX.png'

   `c` is { code, kind, percent, amount, expiresAt, single, url } — `amount`
   in USD cents, `url` the page the QR opens.
   ========================================================================== */
var CouponCard = (function () {
  'use strict';

  var W = 1080, H = 1350;
  var LIME = '#C6FF00', INK = '#0A0A0B', CARD = '#141416';
  var LOGO = '/assets/logo.svg';

  var logoImg = null;
  function logo() {
    if (logoImg) return logoImg;
    logoImg = new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = LOGO;
    });
    return logoImg;
  }

  function fonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('700 60px Montserrat'),
      document.fonts.load('600 60px Montserrat'),
      document.fonts.load('700 60px Cairo', 'خصم')
    ]).catch(function () {});
  }

  function usd(cents) {
    var n = Number(cents) || 0;
    return '$' + (n / 100).toFixed(n % 100 ? 2 : 0);
  }
  function valueEn(c) { return (c.kind === 'percent' ? c.percent + '%' : usd(c.amount)) + ' OFF'; }
  /* The figure is its own left-to-right run (U+2066 … U+2069), or the
     percent sign lands on the wrong side of it: '%20 خصم'. */
  function valueAr(c) { return 'خصم \u2066' + (c.kind === 'percent' ? c.percent + '%' : usd(c.amount)) + '\u2069'; }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* The biggest size of `font` (a template with {s}) that keeps `text`
     inside `max` pixels. */
  function fit(ctx, text, font, start, max, min) {
    var s = start;
    for (; s > (min || 20); s -= 4) {
      ctx.font = font.replace('{s}', s);
      if (ctx.measureText(text).width <= max) break;
    }
    return s;
  }

  function spaced(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
  }

  function ar(ctx) { ctx.direction = 'rtl'; spaced(ctx, 0); }
  function ltr(ctx) { ctx.direction = 'ltr'; }

  function dateText(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
  }

  function drawQr(ctx, text, x, y, side, mark) {
    var qr = Codes.qrMatrix(text, { ecc: 'H' }) || Codes.qrMatrix(text);
    if (!qr) return false;
    var quiet = 2;
    var total = qr.size + quiet * 2;
    var cell = side / total;
    ctx.fillStyle = INK;
    var n = qr.size, m = qr.modules;
    function finder(r, c) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); }
    /* Round dots, square-ish eyes: the shop's QR look (js/codes.js qrSVG). */
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!m[r][c] || finder(r, c)) continue;
        var px = x + (c + quiet) * cell, py = y + (r + quiet) * cell;
        rr(ctx, px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.3);
        ctx.fill();
      }
    }
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var ex = x + (p[1] + quiet) * cell, ey = y + (p[0] + quiet) * cell;
      /* Softened, never so much that a corner module goes white: a street
         sticker is read in bad light, through a scratched phone lens. The
         harness reads every module back (coupons/qr-ui). */
      ctx.fillStyle = INK; rr(ctx, ex, ey, cell * 7, cell * 7, cell * 1.2); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; rr(ctx, ex + cell, ey + cell, cell * 5, cell * 5, cell * 0.9); ctx.fill();
      ctx.fillStyle = INK; rr(ctx, ex + cell * 2, ey + cell * 2, cell * 3, cell * 3, cell * 0.6); ctx.fill();
    });
    /* The mark in the middle — level H carries 30% damage, the mark is ~5%. */
    if (mark) {
      var lw = side * 0.22, lx = x + (side - lw) / 2, ly = y + (side - lw) / 2;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, lx - cell, ly - cell, lw + cell * 2, lw + cell * 2, cell * 1.6); ctx.fill();
      ctx.save(); rr(ctx, lx, ly, lw, lw, lw * 0.18); ctx.clip();
      ctx.drawImage(mark, lx, ly, lw, lw);
      ctx.restore();
    }
    return true;
  }

  function draw(c) {
    if (typeof Codes === 'undefined') return Promise.reject(new Error('no_codes'));
    return Promise.all([fonts(), logo()]).then(function (got) {
      var mark = got[1];
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      if (!ctx) throw new Error('no_canvas');

      /* The ground, lit lime from one corner. */
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      var g = ctx.createRadialGradient(W * 0.88, 90, 10, W * 0.88, 90, 760);
      g.addColorStop(0, 'rgba(198,255,0,0.28)'); g.addColorStop(1, 'rgba(198,255,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var g2 = ctx.createRadialGradient(80, H - 60, 10, 80, H - 60, 620);
      g2.addColorStop(0, 'rgba(198,255,0,0.12)'); g2.addColorStop(1, 'rgba(198,255,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

      /* The ticket, with a notch either side where it tears. */
      var TX = 60, TY = 60, TW = W - 120, TH = H - 120, TEAR = 1000;
      var layer = document.createElement('canvas');
      layer.width = W; layer.height = H;
      var lc = layer.getContext('2d');
      lc.fillStyle = CARD; rr(lc, TX, TY, TW, TH, 48); lc.fill();
      lc.strokeStyle = 'rgba(255,255,255,0.09)'; lc.lineWidth = 2; rr(lc, TX, TY, TW, TH, 48); lc.stroke();
      lc.globalCompositeOperation = 'destination-out';
      [TX, TX + TW].forEach(function (cx) { lc.beginPath(); lc.arc(cx, TEAR, 36, 0, Math.PI * 2); lc.fill(); });
      ctx.drawImage(layer, 0, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 3; ctx.setLineDash([14, 14]);
      ctx.beginPath(); ctx.moveTo(TX + 56, TEAR); ctx.lineTo(TX + TW - 56, TEAR); ctx.stroke();
      ctx.restore();

      /* The mark and the name. */
      ltr(ctx);
      if (mark) {
        ctx.save(); rr(ctx, 116, 112, 84, 84, 18); ctx.clip(); ctx.drawImage(mark, 116, 112, 84, 84); ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; rr(ctx, 116, 112, 84, 84, 18); ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '700 38px Montserrat'; spaced(ctx, 6);
      ctx.fillText('OG SPORTS', 222, 142);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '600 22px Montserrat'; spaced(ctx, 3);
      ctx.fillText('ALEPPO', 224, 178);

      /* SCAN ME, as a lime pill. */
      spaced(ctx, 3); ctx.font = '700 26px Montserrat';
      var pill = 'SCAN ME', pw = ctx.measureText(pill).width + 52;
      ctx.fillStyle = LIME; rr(ctx, W - 116 - pw, 120, pw, 64, 32); ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText(pill, W - 116 - pw / 2, 153);

      /* What it takes off — the hero, in both languages. */
      spaced(ctx, -2);
      var en = valueEn(c);
      var s = fit(ctx, en, '700 {s}px Montserrat', 150, TW - 140, 60);
      ctx.font = '700 ' + s + 'px Montserrat';
      ctx.fillStyle = LIME; ctx.textAlign = 'center';
      ctx.fillText(en, W / 2, 284);
      ar(ctx); ctx.font = '700 58px Cairo, Tahoma, sans-serif'; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(valueAr(c), W / 2, 392);
      ltr(ctx);

      /* The QR on a white card. */
      var QS = 452, QX = (W - QS) / 2, QY = 462;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, QX - 22, QY - 22, QS + 44, QS + 44, 40); ctx.fill();
      drawQr(ctx, c.url, QX, QY, QS, mark);

      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '600 26px Montserrat'; spaced(ctx, 2);
      ctx.fillText('SCAN TO CLAIM', W / 2, 970);

      /* Below the tear: the code itself, for somebody with no camera. */
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '600 22px Montserrat'; spaced(ctx, 6);
      ctx.fillText('YOUR CODE', W / 2, 1062);
      spaced(ctx, 8);
      var cs = fit(ctx, c.code, '700 {s}px Montserrat', 84, TW - 160, 40);
      ctx.font = '700 ' + cs + 'px Montserrat'; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(c.code, W / 2, 1132);

      /* One line in each language: the street rule, or when it ends. */
      var lineEn, lineAr;
      if (c.single) { lineEn = 'FIRST TO USE IT WINS'; lineAr = 'أول واحد بيستعملو بيربح'; }
      else if (c.expiresAt) { lineEn = 'VALID UNTIL ' + dateText(c.expiresAt).toUpperCase(); lineAr = 'لفترة محدودة'; }
      else { lineEn = 'ONLINE & IN STORE'; lineAr = 'عالموقع وبالمحل'; }
      spaced(ctx, 3); ctx.font = '700 24px Montserrat'; ctx.fillStyle = LIME;
      ctx.fillText(lineEn, W / 2, 1196);
      ar(ctx); ctx.font = '700 30px Cairo, Tahoma, sans-serif'; ctx.fillStyle = '#FFFFFF';
      ctx.fillText(lineAr, W / 2, 1240);
      return cv;
    });
  }

  function blob(c) {
    return draw(c).then(function (cv) {
      return new Promise(function (resolve, reject) {
        if (cv.toBlob) cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('no_png')); }, 'image/png');
        else reject(new Error('no_png'));
      });
    });
  }

  function fileName(c) {
    return 'og-coupon-' + String(c.code || 'code').replace(/[^A-Za-z0-9-]/g, '') + '.png';
  }

  function download(name, b) {
    var url = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* On a phone the share sheet IS "save to photos"; elsewhere a download. */
  function save(c) {
    return blob(c).then(function (b) {
      var name = fileName(c);
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse && typeof File !== 'undefined' && navigator.canShare) {
        var f = new File([b], name, { type: 'image/png' });
        if (navigator.canShare({ files: [f] })) {
          return navigator.share({ files: [f] }).then(function () { return 'shared'; }, function (e) {
            /* Cancelled is an answer, not a failure. */
            if (e && e.name === 'AbortError') return 'cancelled';
            download(name, b); return 'downloaded';
          });
        }
      }
      download(name, b);
      return 'downloaded';
    });
  }

  return { draw: draw, blob: blob, save: save, fileName: fileName, download: download,
           valueEn: valueEn, valueAr: valueAr };
})();
