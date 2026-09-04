/* ==========================================================================
   OG SYSTEM — application shell  ·  3/17: FORMATTING + FEEDBACK
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 905-1211). Loads after
   app-i18n.js.
   ========================================================================== */

/* ------------------------------------------------------------ 3. FORMATTING */

function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

/* "Nike · Sneakers · Black" — but only the parts that exist. A product with
   no brand and no colourway used to print a lone "·" under its name, and
   the size picker's eyebrow read "· Sneakers". Every caller passes strings
   it has ALREADY escaped, so nothing is escaped here. */
function dots() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) {
    var s = arguments[i];
    if (s != null && String(s).trim() !== '') out.push(String(s));
  }
  return out.join(' · ');
}

/* Like nf(), but null and undefined print "—" rather than a confident 0.

   The distinction is real: a delivery driver's customer rows arrive without
   spend, debt, visits or points, because the server never selects them for
   him (driverScope, server/lib/customers.js). nf(null) is "0", which reads as
   "this customer has never bought anything" — a claim nobody made. Zero still
   prints as 0, because a customer who genuinely owes nothing is a fact. */
function nfOrDash(n) {
  return (n === null || n === undefined || n === '') ? '—' : nf(n);
}

/* WHEN YOU CAP, SAY YOU CAPPED.

   One line, drawn under any figure derived from a list the server had to
   truncate. Returns '' when nothing was truncated, so a caller can
   concatenate it unconditionally and it disappears on a small shop.

   This exists because the same mistake has now shipped three times — lira
   added to dollars, select-all reaching past the render cap, the bell's
   summary row cut by an outer slice. Every one was a limit at one layer while
   another layer went on counting the whole set. The limits are right; being
   quiet about them is not.

   `cap` is { shown, total, capped } from DB.cap(kind). */
function cappedNote(cap, what) {
  if (!cap || !cap.capped) return '';
  return '<div class="partner-note mt">' +
    t('cap_window')
      .replace('{a}', nf(cap.shown))
      .replace('{b}', nf(cap.total))
      .replace('{n}', esc(what || t('rows'))) +
    '</div>';
}

/* The same fact as a short inline suffix, for a badge that has no room for a
   sentence: "200+" rather than "200". */
function cappedCount(cap) {
  if (!cap) return '0';
  return nf(cap.shown) + (cap.capped ? '+' : '');
}

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

/* ---- money in ITS OWN currency ------------------------------------------
   A customer's spend and debt are per-currency facts: shown in the currency
   the person actually handed over, never converted and never added together
   (server/lib/customers.js says why at length). SYP arrives in whole lira
   (minor_exp 0), USD in cents. The pair is wrapped in <bdi dir="ltr"> for
   the same reason tel() is — digit runs reorder around the "+" in RTL. */
function moneySypRaw(v) {
  return nf(v) + ' ' + (OG.lang === 'ar' ? 'ل.س' : 'SYP');
}
function moneyUsdRaw(cents) {
  var v = (Number(cents) || 0) / 100;
  return '$' + (v === Math.round(v) ? nf(v) : v.toFixed(2));
}
function moneyPairText(syp, usd, compact) {
  var parts = [];
  if (Number(syp)) {
    parts.push(compact
      ? Charts.compact(Number(syp)) + (OG.lang === 'ar' ? ' ل.س' : ' SYP')
      : moneySypRaw(syp));
  }
  if (Number(usd)) parts.push(moneyUsdRaw(usd));
  return parts.length ? parts.join(' + ') : '—';
}
/* Each half in ITS OWN isolate. One <bdi> around "2K ل.س + $100" is not
   enough in Arabic: the lira sign is an Arabic run, and the bidi algorithm
   then treats the "+ $100" after it as part of that run and draws the
   dollars as "100$". Isolating the halves separately keeps "$100" as
   "$100" whichever script sits beside it. */
function moneyPair(syp, usd, compact) {
  var parts = [];
  if (Number(syp)) {
    parts.push('<bdi dir="ltr">' + (compact
      ? Charts.compact(Number(syp)) + (OG.lang === 'ar' ? ' ل.س' : ' SYP')
      : moneySypRaw(syp)) + '</bdi>');
  }
  if (Number(usd)) parts.push('<bdi dir="ltr">' + moneyUsdRaw(usd) + '</bdi>');
  return parts.length ? parts.join(' + ') : '—';
}

var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_AR = ['كانون٢', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين١', 'تشرين٢', 'كانون١'];

/* "—" for no date at all, same as relDate below. new Date(null) is the
   epoch, so a customer who had never bought used to get "1 Jan 1970"
   printed under "Last purchase" as though it were a fact. */
function fmtDate(d) {
  if (d === null || d === undefined || d === '') return '—';
  d = new Date(d);
  if (isNaN(d.getTime())) return '—';
  var m = OG.lang === 'ar' ? MONTHS_AR[d.getMonth()] : MONTHS_EN[d.getMonth()];
  return d.getDate() + ' ' + m + ' ' + d.getFullYear();
}

function fmtDateTime(d) {
  if (d === null || d === undefined || d === '') return '—';
  d = new Date(d);
  if (isNaN(d.getTime())) return '—';
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

/* "3 days ago" / "in 3 days" / "today" — and "—" for no date at all, which
   is what a customer who has never bought has. It used to say "20700 days
   ago", the epoch dressed up as a purchase. */
function relDate(d) {
  var n = DB.daysSince(d);
  if (n === null) return '—';
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
  /* One decimal while the number is small enough for it to mean something;
     past 100 the tenth is noise ("▼ 100.0%" for a day with no sales yet).
     Ten-thousands read as "×12" rather than a percentage nobody can picture. */
  var a = Math.abs(d), txt;
  if (a >= 1000) txt = '×' + (a / 100 + 1).toFixed(0);
  else if (a >= 100) txt = a.toFixed(0) + '%';
  else txt = a.toFixed(1) + '%';
  return '<div class="delta ' + cls + '">' + arrow + ' ' + txt + ' ' + tail + '</div>';
}

/* Phone numbers, addresses and SKUs are latin runs. In RTL the bidi algorithm
   reorders their space-separated groups ("+963 960 380 435" renders backwards),
   so isolate them with <bdi dir="ltr">. */
function tel(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }

/* A customer's name may be Arabic or Latin and the layout may be either, so
   the two can disagree about which end a name starts at — a Latin name in
   the Arabic layout, or an Arabic name followed by a Latin city, reorders
   around the punctuation. dir="auto" lets the name declare its own direction
   and isolates it from the text around it. Every customer name on screen
   goes through here. */
function nm(s) { return '<bdi dir="auto">' + esc(s) + '</bdi>'; }

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

/* Big square version, for the product drawer. */
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
