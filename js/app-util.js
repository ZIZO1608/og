/* ==========================================================================
   OG SYSTEM — application shell  ·  3/17: FORMATTING + FEEDBACK
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 905-1211). Loads after
   app-i18n.js.
   ========================================================================== */

/* --------------------------------------------------------------- PEOPLE
   Two partners at Yalla Wear, and their names are Zaven Yalla and Zohrab
   Yalla — so the initials both read "ZY" and an avatar alone cannot tell
   them apart. Colour can. The hue is derived from the account id (stable
   across a rename, and the same on both companies' screens), spun by the
   golden angle so neighbouring ids land far apart rather than in the same
   corner of the wheel. Kept off the two colours this app has already spent:
   lime is the shop's primary action and mint is the partner's brand.

   Deterministic on purpose — a colour that changed on reload would be
   decoration; this one is identity. */
function personHue(id) {
  var n = Number(id);
  if (!isFinite(n)) {
    n = 0;
    String(id || '').split('').forEach(function (ch, i) { n += ch.charCodeAt(0) * (i + 1); });
  }
  return Math.round((n * 137.508) % 360);
}

function personTint(id) {
  var h = personHue(id);
  return { fg: 'hsl(' + h + ' 72% 76%)', bg: 'hsl(' + h + ' 62% 30% / .38)', dot: 'hsl(' + h + ' 70% 62%)' };
}

/* The first name OF A GIVEN NAME, for anywhere a sentence reads better than
   a record: "Zaven accepted" rather than "Zaven Yalla accepted".

   NOT called firstName. js/app-dashboard.js already owns that name for a
   different job — the SIGNED-IN person's first name, taking no argument —
   and it loads after this file, so the two silently became one function:
   every name in the presence pill and the thread came out as whoever was
   looking ("Test" printed beside Zaven's own face, with his name still in
   the tooltip). The same shape of bug as the .pos class the movement log
   once shared with the till, and just as invisible on screen. */
function personFirst(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/* TWO LETTERS OF THE FIRST NAME, not the usual first-plus-last initials.
   Yalla Wear is Zaven Yalla and Zohrab Yalla, so initialsOf() gives "ZY"
   for both of them — the one thing a face must never do. "Za" and "Zo"
   tell them apart at any size, and the colour underneath does the rest.
   initialsOf() below keeps first-plus-last: it names an ACCOUNT in its own menu, where
   there is only ever one person and the surname is worth having. */
function personFace(name) {
  var f = personFirst(name);
  return f ? (f.charAt(0).toUpperCase() + f.charAt(1).toLowerCase()) : '?';
}

/* Initials for the avatar block. .split(' ') on a name with a double space
   yields an empty string whose [0] is undefined, and 'undefined' is what used
   to be printed in the circle. */
function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean)
    .slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '—';
}

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
  var a = Math.abs(v);
  /* The sign before the dollar sign: "-$112.50", never "$-112.50". */
  return (v < 0 ? '-' : '') + '$' + (a === Math.round(a) ? nf(a) : a.toFixed(2));
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

/* Just the clock. The movement log shows the date on one line and the time
   under it, and fmtDateTime's full string would wrap the column. Same ص/م
   rule as below, for the same reason. */
function fmtTimeOnly(d) {
  if (d === null || d === undefined || d === '') return '';
  d = new Date(d);
  if (isNaN(d.getTime())) return '';
  var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  var ar = OG.lang === 'ar';
  var suffix = ar ? (hh < 12 ? ' ص' : ' م') : (hh < 12 ? ' am' : ' pm');
  var h12 = hh % 12 === 0 ? 12 : hh % 12;
  return h12 + ':' + mm + suffix;
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

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* WHERE THE CARET WAS, across a repaint (24 Sep 2026). A redraw replaces the
   box somebody is in with a new one, and the new one has no focus. focusKey
   names the focused control inside `root` by what it IS — its id, or its tag
   and data-* attributes, which every control here carries for the delegated
   handlers — and refocus finds the new one by that name and puts the focus
   and the caret back, without scrolling. Nothing focused inside `root`, or a
   control with nothing to be known by: null, and nothing is done. */
function focusKey(root) {
  var el = document.activeElement;
  if (!el || !root || el === root || !root.contains(el) || typeof CSS === 'undefined' || !CSS.escape) return null;
  var sel = el.id ? '#' + CSS.escape(el.id) : '';
  if (!sel) {
    var bits = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0) bits.push('[' + a.name + '="' + CSS.escape(a.value) + '"]');
    }
    if (!bits.length) return null;
    sel = el.tagName.toLowerCase() + bits.join('');
  }
  var key = { sel: sel, s: null, e: null };
  try { key.s = el.selectionStart; key.e = el.selectionEnd; } catch (e) { /* not a text box */ }
  return key;
}

function refocus(root, key) {
  if (!root || !key) return;
  var el = null;
  try { el = root.querySelector(key.sel); } catch (e) { return; }
  if (!el || el.disabled) return;
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  if (key.s !== null && key.s !== undefined) {
    try { el.setSelectionRange(key.s, key.e); } catch (e) { /* not a text box */ }
  }
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

/* A picture pasted or dropped onto the Add-product form. Since 066 a
   product's photos belong to its colours, so it goes into the first colour's
   first empty slot — the model photo, then the product photo, then an extra. */
function takeProductImage(file) {
  if (file) Photos.takeFirstEmpty(file);
}

/* The picture to the bucket, and the row to match. One place for the three
   toasts - sending, saved, did not land - so the Add-product form and the
   drawer cannot describe the same failure two ways. `then` runs after the
   catalogue has been reloaded with the new address, so whatever is on screen
   can redraw with the picture in it. */
/* A PRINT JOB’S DESIGN, through the same three outcomes and the same stale-
   server diagnosis. Written as a wrapper rather than a copy because the
   interesting part of this function is the error handling, and that is the
   half a second copy always ends up missing. */
function uploadJobDesign(id, dataUrl, then) {
  return uploadImageThrough(function () { return Shop.setJobImage(id, dataUrl); }, then);
}

function uploadImageThrough(send, then) {
  toast(t('image'), t('img_uploading'), null, 2500);
  return send().then(function () {
    return Shop.reload();
  }).then(function () {
    render();
    if (then) then();
    toast(t('image'), t('img_saved'), 'ok', 2500);
  }).catch(function (err) {
    /* "No such endpoint" from a route that plainly exists means one thing:
       this server was started before the code that added it, and Node reads a
       module once. Saying that is worth more than repeating the 404 - it was
       the first thing this feature did in the shop, and the message it gave
       sent somebody looking for a bug that was not there. */
    if (err && (err.code === 'not_found' || err.status === 404)) {
      toast(t('image'), t('img_stale_server'), 'err', 10000);
      return;
    }
    /* Otherwise the server's own reason, which names Supabase or the network
       rather than "error". */
    toast(t('image'), t('img_fail') + ' ' + API.friendly(err), 'err', 8000);
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
   bulk Undo. The container is pointer-events:none so the gaps between toasts
   stay click-through; each toast re-enables them on itself, because there is
   now something to press on every one of them. */
function toast(title, msg, kind, ms, action) {
  var host = document.getElementById('toasts');
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<div style="flex:1"><b>' + esc(title) + '</b>' +
                 (msg ? '<small>' + esc(msg) + '</small>' : '') + '</div>' +
                 (action ? '<button class="toast-act" ' + action.attrs + '>' + esc(action.label) + '</button>' : '') +
                 '<button class="toast-x" data-act="toast-x" aria-label="' + esc(t('close')) + '">&times;</button>';
  host.appendChild(el);
  bindToastGestures(host);
  el._t = setTimeout(function () { dismissToast(el); }, ms || 3000);
}

/* One way out for all four of them — the ×, a swipe, the timer, and a second
   dismissal arriving on a toast already on its way off. `dir` is +1/-1 when a
   hand threw it, so it leaves in the direction it was thrown rather than
   snapping back to the middle to fade. */
function dismissToast(el, dir) {
  if (!el || el._gone) return;
  el._gone = true;
  if (el._t) clearTimeout(el._t);
  if (dir) {
    el.style.transition = 'transform .18s ease, opacity .18s ease';
    el.style.transform = 'translateX(' + (dir * 115) + '%)';
    el.style.opacity = '0';
  } else {
    el.classList.add('out');
  }
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
}

/* One listener set on the host, bound the first time a toast exists — a toast
   lives three seconds and there may be four of them at once, so per-element
   handlers would be bound and thrown away all day.
   Only the OUTWARD direction dismisses: the toast sits against the inline-end
   edge, so it leaves the way it came in — right in English, left in Arabic.
   Dragging the other way rubber-bands, which is what tells a hand "not that
   way" without putting a word on screen. */
var toastBound = false;
function bindToastGestures(host) {
  if (toastBound) return;
  toastBound = true;

  var el = null, x0 = 0, y0 = 0, d = 0, live = false;
  function outward() { return document.body.classList.contains('rtl') ? -1 : 1; }

  host.addEventListener('pointerdown', function (e) {
    var hit = e.target.closest ? e.target.closest('.toast') : null;
    /* A press on Undo or on the × is a press on that button, never a swipe. */
    if (!hit || hit._gone || e.target.closest('button')) return;
    el = hit; x0 = e.clientX; y0 = e.clientY; d = 0; live = false;
    el.style.transition = 'none';
  });

  host.addEventListener('pointermove', function (e) {
    if (!el) return;
    var mx = e.clientX - x0, my = e.clientY - y0;
    if (!live) {
      /* Six pixels, and horizontal has to beat vertical — the same threshold
         the shelf map uses, so a tap is still a tap and the page still scrolls. */
      if (Math.abs(mx) < 6 || Math.abs(mx) <= Math.abs(my)) return;
      live = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }
    d = mx * outward();
    if (d < 0) d /= 4;
    el.style.transform = 'translateX(' + (d * outward()) + 'px)';
    el.style.opacity = String(Math.max(.25, 1 - Math.max(0, d) / 220));
  });

  function release() {
    if (!el) return;
    var me = el, went = live && d > Math.max(56, me.offsetWidth * .28);
    el = null; live = false;
    if (went) { dismissToast(me, outward()); return; }
    me.style.transition = 'transform .16s ease, opacity .16s ease';
    me.style.transform = '';
    me.style.opacity = '';
  }
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
}

/* `sheet: true` makes it rise from the bottom edge instead of sitting in the
   middle — the phone idiom, and thumb-reachable. Everything else is identical,
   so no caller has to know which shape it will take. */
function openModal(o) {
  closeModal();
  var root = document.getElementById('modal-root');
  /* FIX 05 — ON A PHONE IT IS A SHEET, WHATEVER THE CALLER SAID.
     A dialog in the middle of a phone screen puts its Save under the eye and
     out of reach of the thumb, and the keyboard covers it the moment a field
     takes focus. Three callers remembered to pass `sheet: window.innerWidth
     < 720` and about forty did not, so it was decided per dialog by whoever
     wrote it. It is decided here now, once: a phone gets a sheet, a desk
     gets a dialog, and `sheet: false` is still honoured for the rare thing
     that must not rise (nothing does today). */
  var sheet = o.sheet === false ? false
            : (o.sheet === true || (window.innerWidth || 1024) <= 720);
  root.innerHTML =
    '<div class="modal-backdrop' + (sheet ? ' as-sheet' : '') + '" data-act="modal-backdrop">' +
      '<div class="modal ' + (o.size || '') + (sheet ? ' sheet' : '') + '">' +
        /* The grab handle. It is what says "this can be pulled down", and it
           is the thing the pull is bound to. */
        (sheet ? '<div class="sheet-grab" aria-hidden="true"><span></span></div>' : '') +
        (o.title ? '<div class="modal-head"><h3>' + o.title + '</h3>' +
          '<button class="x" data-act="modal-close" aria-label="Close">&times;</button></div>' : '') +
        '<div class="modal-body">' + o.body + '</div>' +
        (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  if (sheet) bindSheetPull(root.querySelector('.modal.sheet'));
  /* BEFORE onOpen, and after closeModal() above has already cleared it — this
     function opens by clearing first, so the flag has to be re-raised here or
     it is only ever set by the drawer. */
  syncOverlay();
  if (o.onOpen) o.onOpen(root);
  /* Any money box in the dialog gets the currency symbol drawn inside it.
     Here rather than in each of the eighteen dialogs, for the reason the
     sheet decision above is here. (fix 05) */
  if (typeof Cashbook !== 'undefined' && Cashbook.paintMoney) {
    try { Cashbook.paintMoney(root); } catch (e) {}
  }
  /* …and every field in it gets the right phone keyboard. (fix 05) */
  if (typeof hintInputs === 'function') { try { hintInputs(root); } catch (e) {} }
  /* Held on the module, not on the DOM, because closeModal() wipes innerHTML
     and there are four ways out of a modal — the ×, the backdrop, Escape, and
     another modal opening on top. A teardown that only runs on one of them is
     a teardown that does not run. */
  modalOnClose = o.onClose || null;
}

var modalOnClose = null;

/* FIX 05 — PULL IT DOWN TO CLOSE IT.
   Bound to the grab handle and the head only, never the body: a sheet full
   of fields has to be scrollable, and a pull that starts on a list is a
   scroll. Below the threshold it springs back, so a half-pull is not a lost
   dialog; past it the sheet goes the way it came. */
function bindSheetPull(sheet) {
  if (!sheet) return;
  var grip = sheet.querySelector('.sheet-grab');
  var head = sheet.querySelector('.modal-head');
  var y0 = 0, dy = 0, live = false, on = null;

  function start(e) {
    if (e.target && e.target.closest && e.target.closest('button, input, select, textarea, a')) return;
    on = e.currentTarget; y0 = e.clientY; dy = 0; live = false;
    sheet.style.transition = 'none';
  }
  function move(e) {
    if (!on) return;
    dy = e.clientY - y0;
    if (!live) {
      if (dy < 8) return;          /* downward, and past the slop */
      live = true;
      try { on.setPointerCapture(e.pointerId); } catch (err) {}
    }
    sheet.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
  }
  function end() {
    if (!on) return;
    var went = live && dy > Math.max(90, sheet.offsetHeight * 0.22);
    on = null; live = false;
    sheet.style.transition = 'transform .18s cubic-bezier(.4,0,.2,1)';
    if (went) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(function () { closeModal(); }, 170);
      return;
    }
    sheet.style.transform = '';
  }
  [grip, head].forEach(function (el) {
    if (!el) return;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
}

function closeModal() {
  var fn = modalOnClose;
  modalOnClose = null;
  if (fn) { try { fn(); } catch (e) { console.warn('modal onClose', e); } }
  document.getElementById('modal-root').innerHTML = '';
  syncOverlay();
}
function modalOpen() { return !!document.getElementById('modal-root').firstChild; }

/* ------------------------------------------------------- SOMETHING IS OVER
   `body[data-overlay]` says a dialog or a drawer is on screen, and the
   floating furniture gets out of its way (see the rule in
   css/bulk-gate-responsive.css).

   IT IS READ OFF THE DOM, NEVER COUNTED. There are four ways out of a modal —
   the ×, the backdrop, Escape, and another modal opening on top — and a
   counter that one of them forgets leaves the flag stuck on for the rest of
   the session, with the phone's whole navigation hidden. Asking the two roots
   whether they hold anything cannot drift.

   What it fixes: the phone tab bar is z-index 340 and a modal's backdrop is
   200, so the bar sat ON TOP of every dialog — tappable. You could open Take
   payment, tap Products, and end up on another screen with the dialog still
   mounted over it. A bottom sheet was worse: it rises to the bottom edge, so
   its Save button was behind the bar. The partner portal had already met this
   and raised its own sheets to 360; OG's side never did. */
function syncOverlay() {
  var on = !!document.getElementById('modal-root').firstChild ||
           !!document.getElementById('drawer-root').firstChild;
  if (on) document.body.setAttribute('data-overlay', '1');
  else document.body.removeAttribute('data-overlay');

  /* FIX 05 — the back gesture. A sheet is a place to the person holding the
     phone, so Back should shut it rather than leave the screen. While one is
     open a marker entry sits on the history stack (same url, so no route
     change); closing it any other way takes the marker back off. This rides
     on syncOverlay for the reason the flag above does — there are four ways
     out of a modal and a counter that one of them forgets stays wrong for
     the rest of the session. */
  if (typeof Layers === 'undefined') return;
  if (on) Layers.mark(); else Layers.afterClose();
}

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
  syncOverlay();
  if (o.onOpen) o.onOpen(root);
}

function closeDrawer() { document.getElementById('drawer-root').innerHTML = ''; syncOverlay(); }

/* ------------------------------------------------------------ EXPORT SPECS
   Money leaves as a raw number in the active currency so Excel can sum it —
   the unit goes in the column heading instead of into every cell. */

function exCur() { return OG.currency === 'USD' ? 'USD' : 'SYP'; }
function exMoney(v) {
  return Math.round(OG.currency === 'USD' ? (Number(v) || 0) / CONFIG.EXCHANGE_RATE : (Number(v) || 0));
}
function exCol(label) { return label + ' (' + exCur() + ')'; }
