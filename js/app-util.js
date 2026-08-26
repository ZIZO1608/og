/* ==========================================================================
   OG SYSTEM — application shell  ·  3/17: FORMATTING + FEEDBACK
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 905-1211). Loads after
   app-i18n.js.
   ========================================================================== */

/* ------------------------------------------------------------ 3. FORMATTING */

function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

function money(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + ' ' + (OG.lang === 'ar' ? 'ل.س' : 'SYP');
}

/* Big stat cards: full separators, currency demoted so long numbers still fit. */
function moneyStat(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + '<span class="cur">' + (OG.lang === 'ar' ? 'ل.س' : 'SYP') + '</span>';
}

function moneyShort(syp) {
  var v = OG.currency === 'USD' ? (Number(syp) || 0) / CONFIG.EXCHANGE_RATE : (Number(syp) || 0);
  return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v);
}

function pct(n, digits) { return (Number(n) || 0).toFixed(digits === undefined ? 1 : digits) + '%'; }

var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_AR = ['كانون٢', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين١', 'تشرين٢', 'كانون١'];

function fmtDate(d) {
  d = new Date(d);
  var m = OG.lang === 'ar' ? MONTHS_AR[d.getMonth()] : MONTHS_EN[d.getMonth()];
  return d.getDate() + ' ' + m + ' ' + d.getFullYear();
}

function fmtDateTime(d) {
  d = new Date(d);
  var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  /* ص / م, not AM / PM. Two Latin letters in the middle of an Arabic line
     read as a missing translation, and this one is printed on the receipt a
     customer walks out holding. */
  var ap = OG.lang === 'ar'
    ? (hh >= 12 ? 'م' : 'ص')
    : (hh >= 12 ? 'PM' : 'AM');
  var h12 = hh % 12 || 12;
  return fmtDate(d) + ' · ' + h12 + ':' + mm + ' ' + ap;
}

/* "3 days ago" / "in 3 days" / "today" */
function relDate(d) {
  var n = DB.daysSince(d);
  if (n === 0) return t('today_word');
  if (n === 1) return t('yesterday');
  if (n > 0) return n + ' ' + t('days_ago');
  return t('in_days') + ' ' + Math.abs(n) + ' ' + t('days');
}

function dateWithRel(d) { return fmtDate(d) + ' <span class="muted">· ' + relDate(d) + '</span>'; }

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function deltaTag(now, before, suffix) {
  var tail = '<span class="muted" style="font-weight:500">' + (suffix || '') + '</span>';
  /* No baseline to divide by — "100%" would be a lie, so say what it is. */
  if (!before) {
    return '<div class="delta ' + (now ? 'up' : 'flat') + '">' +
           (now ? '▲ ' + t('all_new') : '—') + ' ' + tail + '</div>';
  }
  var d = (now - before) / before * 100, cls, arrow;
  if (Math.abs(d) < 0.5) { cls = 'flat'; arrow = '—'; }
  else if (d > 0) { cls = 'up'; arrow = '▲'; }
  else { cls = 'down'; arrow = '▼'; }
  return '<div class="delta ' + cls + '">' + arrow + ' ' + Math.abs(d).toFixed(1) + '% ' + tail + '</div>';
}

/* Phone numbers, addresses and SKUs are latin runs. In RTL the bidi algorithm
   reorders their space-separated groups ("+963 960 380 435" renders backwards),
   so isolate them with <bdi dir="ltr">. */
function tel(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }

/* A product shows a real photo when it has one and its colour block when it
   does not. `image.src` is a data URL held in memory — the original brief said
   no stock photo URLs, and this is not one: it is the shop's own picture, and
   it never leaves the browser. */
function thumb(p, cls) {
  if (p.image && p.image.src) {
    return '<span class="thumb ' + (cls || '') + ' has-img">' +
           '<img src="' + p.image.src + '" alt="' + esc(p.name) + '"></span>';
  }
  return '<span class="thumb ' + (cls || '') + '" style="background:' + p.image.bg + '">' + p.image.initials + '</span>';
}

/* Big square version, for the storefront and the product drawer. */
function thumbBox(p, cls) {
  if (p.image && p.image.src) {
    return '<div class="thumb-box ' + (cls || '') + ' has-img">' +
           '<img src="' + p.image.src + '" alt="' + esc(p.name) + '"></div>';
  }
  return '<div class="thumb-box ' + (cls || '') + '" style="background:' + p.image.bg + '">' +
         p.image.initials + '</div>';
}

/* ------------------------------------------------------------ IMAGE INTAKE
   Reads a picture off the user's machine and turns it into a small data URL.

   The downscale is not cosmetic. A phone photo is 3–6 MB; held raw as a data
   URL it would sit in memory base64-encoded (a third bigger again) and would
   be embedded whole into any export. 420px is more than the largest place the
   image is ever displayed.

   WebP first because it keeps transparency AND compresses well; canvas falls
   back to PNG on its own if the browser will not encode WebP, which we detect
   from the returned prefix rather than assuming. */
var IMG_MAX_PX = 420;
var IMG_MAX_BYTES = 12 * 1024 * 1024;

function readImageFile(file, done) {
  if (!file) { done(null, 'none'); return; }
  if (String(file.type).indexOf('image/') !== 0) { done(null, 'type'); return; }
  if (file.size > IMG_MAX_BYTES) { done(null, 'size'); return; }

  var fr = new FileReader();
  fr.onerror = function () { done(null, 'read'); };
  fr.onload = function () {
    var im = new Image();
    im.onerror = function () { done(null, 'decode'); };
    im.onload = function () {
      var scale = Math.min(1, IMG_MAX_PX / Math.max(im.width, im.height));
      var w = Math.max(1, Math.round(im.width * scale));
      var h = Math.max(1, Math.round(im.height * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, 0, 0, w, h);
      var out;
      try { out = cv.toDataURL('image/webp', 0.85); } catch (e) { out = null; }
      if (!out || out.indexOf('data:image/webp') !== 0) {
        try { out = cv.toDataURL('image/png'); } catch (e2) { out = null; }
      }
      /* If the canvas refused entirely, hand back the original rather than
         losing the user's picture — it is bigger, but it is theirs. */
      done(out || fr.result, null);
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* Everything that can hand us a picture funnels through here, so the toast,
   the validation and the repaint are written once. */
function takeProductImage(file) {
  readImageFile(file, function (src, err) {
    if (err) {
      toast(t('image'), t('up_err_' + err), 'err', 4000);
      return;
    }
    OG.wh.imgSrc = src;
    OG.wh.img = null;
    render();
    toast(t('image'), t('up_ok'), 'ok', 2000);
  });
}

function healthBadge(qty) {
  var h = DB.health(qty);
  return '<span class="badge ' + h + '"><i class="dot ' + h + '"></i>' + t(h) + '</span>';
}

/* ---------------------------------------------------- delivery-style tracker
   The parcel-tracking metaphor the client asked for: circles joined by
   arrows. Shared by the OG print board and the Yalla Wear portal, so both
   sides of the job read identically. `compact` drops labels for card use. */
function stepper(stage, opts) {
  opts = opts || {};
  var stages = DB.printStages;
  var cur = stages.indexOf(stage);
  var h = '<div class="track' + (opts.compact ? ' compact' : '') + (opts.overdue ? ' late' : '') + '">';

  stages.forEach(function (s, i) {
    var state = i < cur ? 'done' : (i === cur ? 'now' : 'next');
    var at = null;
    if (opts.history) {
      var hit = opts.history.filter(function (x) { return x.stage === s; })[0];
      at = hit ? hit.at : null;
    }
    var label = t('print_' + s);

    if (i) h += '<span class="track-arrow" aria-hidden="true"></span>';
    h += '<span class="track-step ' + state + '" title="' + esc(label + (at ? ' · ' + fmtDate(at) : '')) + '">' +
      '<span class="track-node">' + (state === 'done' ? '&#10003;' : (i + 1)) + '</span>' +
      (opts.compact ? '' :
        '<span class="track-label">' + label + '</span>' +
        '<span class="track-time">' +
          (at ? fmtDate(at) : (state === 'now' ? t('yl_now') : '—')) + '</span>') +
    '</span>';
  });

  return h + '</div>';
}

/* ------------------------------------------------------------ QR payloads
   Text by default: it resolves on any phone with no internet, which a URL
   would not. Set CONFIG.QR_MODE = 'url' in js/data.js once the app is
   deployed and every printed code becomes a link that opens the record.

   In url mode these go through deepLink(), not CONFIG.QR_BASE_URL — that
   constant is a placeholder domain, so scanning it would land on nothing.
   deepLink() emits a route the app actually handles. */
function qrForVariant(v) {
  var p = DB.product(v.productId);
  if (CONFIG.QR_MODE === 'url') return deepLink('product', v.productId);
  return CONFIG.SHOP_NAME.toUpperCase() + '\n' + p.name + '\n' +
         t('size') + ' ' + v.size + ' | ' + v.sku + '\n' +
         money(p.sellingPrice) + ' | ' + v.shelf;
}

function qrForSale(sale) {
  if (CONFIG.QR_MODE === 'url') return deepLink('invoice', sale.id);
  return CONFIG.SHOP_NAME.toUpperCase() + ' | ' + sale.id + '\n' +
         money(sale.total) + '\n' + fmtDateTime(sale.date) + '\n' + CONFIG.SHOP_ADDRESS;
}

/* Never let an over-long payload silently render a blank square. */
function qrSafe(text, fallback, opts) {
  var svg = Codes.qrSVG(text, opts);
  return svg || Codes.qrSVG(fallback, opts);
}

/* ------------------------------------------------------------ 4. FEEDBACK */

/* `action` = { label, attrs } renders a button inside the toast — used by the
   bulk Undo. The toast container is pointer-events:none, so a toast carrying
   an action has to re-enable them on itself. */
function toast(title, msg, kind, ms, action) {
  var host = document.getElementById('toasts');
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<div style="flex:1"><b>' + esc(title) + '</b>' +
                 (msg ? '<small>' + esc(msg) + '</small>' : '') + '</div>' +
                 (action ? '<button class="toast-act" ' + action.attrs + '>' + esc(action.label) + '</button>' : '');
  if (action) el.style.pointerEvents = 'auto';
  host.appendChild(el);
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, ms || 3000);
}

/* `sheet: true` makes it rise from the bottom edge instead of sitting in the
   middle — the phone idiom, and thumb-reachable. Everything else is identical,
   so no caller has to know which shape it will take. */
function openModal(o) {
  closeModal();
  var root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop' + (o.sheet ? ' as-sheet' : '') + '" data-act="modal-backdrop">' +
      '<div class="modal ' + (o.size || '') + (o.sheet ? ' sheet' : '') + '">' +
        (o.title ? '<div class="modal-head"><h3>' + o.title + '</h3>' +
          '<button class="x" data-act="modal-close" aria-label="Close">&times;</button></div>' : '') +
        '<div class="modal-body">' + o.body + '</div>' +
        (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  if (o.onOpen) o.onOpen(root);
  /* Held on the module, not on the DOM, because closeModal() wipes innerHTML
     and there are four ways out of a modal — the ×, the backdrop, Escape, and
     another modal opening on top. A teardown that only runs on one of them is
     a teardown that does not run. */
  modalOnClose = o.onClose || null;
}

var modalOnClose = null;

function closeModal() {
  var fn = modalOnClose;
  modalOnClose = null;
  if (fn) { try { fn(); } catch (e) { console.warn('modal onClose', e); } }
  document.getElementById('modal-root').innerHTML = '';
}
function modalOpen() { return !!document.getElementById('modal-root').firstChild; }

function openDrawer(o) {
  closeDrawer();
  var root = document.getElementById('drawer-root');
  root.innerHTML =
    '<div class="drawer-backdrop" data-act="drawer-close"></div>' +
    '<aside class="drawer">' +
      '<div class="drawer-head">' + o.head +
        '<button class="x" data-act="drawer-close" style="margin-inline-start:auto;border:0;background:none;font-size:22px;line-height:1;color:var(--muted-foreground)">&times;</button>' +
      '</div>' +
      '<div class="drawer-body">' + o.body + '</div>' +
    '</aside>';
  if (o.onOpen) o.onOpen(root);
}

function closeDrawer() { document.getElementById('drawer-root').innerHTML = ''; }

/* ------------------------------------------------------------ EXPORT SPECS
   Money leaves as a raw number in the active currency so Excel can sum it —
   the unit goes in the column heading instead of into every cell. */

function exCur() { return OG.currency === 'USD' ? 'USD' : 'SYP'; }
function exMoney(v) {
  return Math.round(OG.currency === 'USD' ? (Number(v) || 0) / CONFIG.EXCHANGE_RATE : (Number(v) || 0));
}
function exCol(label) { return label + ' (' + exCur() + ')'; }
