/* ==========================================================================
   OG SYSTEM — the loading screen
   --------------------------------------------------------------------------
   What is on screen between the page opening and the first paint. It used to
   be the mark and a lime bar sweeping forever, which said "loading" and
   nothing else. This one says WHAT is loading: every part of the system —
   the catalogue, the customers, the sales, the drawer, the print jobs, the
   cloud copy — waits in a dim halo around the mark and docks into orbit the
   moment its real request lands, with the real number it came back with.

   Nothing here is a timer pretending to be progress. `step()` is called by
   Shop.load as each of its requests resolves; the only theatre is a short
   minimum gap between docks, because fifteen answers landing inside one
   frame is a flash, not a sequence.

   Exposes one global, `Splash`, like every other module. Talks to no
   server: the values it shows are handed to it by the one file that may.
   ========================================================================== */

var Splash = (function () {
  'use strict';

  /* Every request Shop.load makes, in the order they dock, with the icon
     each one wears and how to read a number out of its answer. `mirror` is
     not one of Shop's requests — it is the last tick, asked after the shop
     is in hand, and it is the one that names the cloud copy. */
  var MODULES = [
    { id: 'config',         icon: 'gear',      read: function (v) { return v && v.warehouses ? count(v.warehouses.length, 'warehouse') : null; } },
    { id: 'catalogue',      icon: 'shoe',      read: function (v) { return v && v.products ? count(v.products.length, 'product') : null; } },
    { id: 'customers',      icon: 'people',    read: function (v) { return v && v.customers ? count(v.customers.length, 'customer') : null; } },
    { id: 'sales',          icon: 'receipt',   read: function (v) { return v && v.sales ? count(v.salesTotal || v.sales.length, 'invoice') : null; } },
    { id: 'movements',      icon: 'boxes',     read: function (v) { return v && v.movements ? count(v.movementsTotal || v.movements.length, 'movement') : null; } },
    { id: 'partner',        icon: 'shirt',     read: function (v) { return v && v.jobs ? count(v.jobs.length, 'job') : null; } },
    { id: 'purchase',       icon: 'clipboard', read: function (v) { return v && v.purchaseOrders ? count(v.purchaseOrders.length, 'order') : null; } },
    { id: 'money',          icon: 'cash',      read: function (v) { return v ? word(v.currentShift ? 'sp_shift_open' : 'sp_shift_closed') : null; } },
    { id: 'counts',         icon: 'check',     read: function (v) { return v && v.stockCounts ? count(v.stockCounts.length, 'count') : null; } },
    { id: 'suppliers',      icon: 'truck',     read: function (v) { return v && v.suppliers ? count(v.suppliers.length, 'supplier') : null; } },
    { id: 'employees',      icon: 'badge',     read: function (v) { return v && v.employees ? count(v.employees.length, 'employee') : null; } },
    { id: 'alerts',         icon: 'bell',      read: function (v) { return v && v.notifications ? count(v.notifications.length, 'alert') : null; } },
    { id: 'dashboard',      icon: 'chart',     read: function (v) { return v ? word('sp_computed') : null; } },
    { id: 'reports',        icon: 'bars',      read: function (v) { return v ? word('sp_computed') : null; } },
    { id: 'labelTemplates', icon: 'tag',       read: function (v) { return v && v.templates ? count(v.templates.length, 'template') : null; } },
    { id: 'mirror',         icon: 'cloud',     read: readMirror }
  ];

  /* Hand-drawn, one stroke weight, so they read at 18px on the till's
     screen. Fill none, stroke currentColor — the CSS colours them. */
  var ICONS = {
    gear:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    shoe:      '<path d="M2.5 16.5h19v-1.8a2 2 0 0 0-1.4-1.9l-4.5-1.5a3.5 3.5 0 0 1-1.7-1.3L12 7.5H8.5l-1.2 3.4H4.5a2 2 0 0 0-2 2z"/><path d="M2.5 16.5V18h19v-1.5"/><path d="M9 10.9l1.6 1.4M11 9.5l1.6 1.4"/>',
    people:    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6 6 0 0 1 3.5 5.5"/>',
    receipt:   '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    boxes:     '<path d="M3 9.5l9-4.5 9 4.5-9 4.5z"/><path d="M3 9.5V17l9 4.5 9-4.5V9.5"/><path d="M12 14v7.5"/>',
    shirt:     '<path d="M8.5 4L12 5.5 15.5 4l4.5 3-2 3-2-1v11H8V9l-2 1-2-3z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4"/><path d="M9 11h6M9 15h4"/>',
    cash:      '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    check:     '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.5 1.5 3-3"/><path d="M3.5 12l1.5 1.5 3-3"/><path d="M3.5 17.5l1.5 1.5 3-3"/>',
    truck:     '<path d="M2.5 6h11v10h-11z"/><path d="M13.5 9.5h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    badge:     '<rect x="5" y="3.5" width="14" height="17" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17a4 4 0 0 1 8 0"/>',
    bell:      '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    chart:     '<path d="M3 20h18"/><path d="M4 15l5-5 4 3 7-7"/><path d="M16 6h4v4"/>',
    bars:      '<path d="M5 20v-8M10 20V6M15 20v-10M20 20V4"/>',
    tag:       '<path d="M3 12l9-9h9v9l-9 9z"/><circle cx="16.5" cy="7.5" r="1.3"/>',
    cloud:     '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18z"/><path d="M9.5 14.5l2 2 3.5-4"/>'
  };

  /* Choreography, in milliseconds. GAP is the least time between two docks;
     FLOOR is the least time the finished sequence is on screen from begin()
     — a fast machine would otherwise be done in the time it takes to look
     up. Both are zero under prefers-reduced-motion. */
  var GAP = 95, FLOOR = 1500, OUTRO = 700, FADE = 320, WATCHDOG = 30000;
  /* Where a chip waits, as a multiple of the orbit radius. */
  var HALO = 1.28;

  var root = null, stage = null, chips = {}, order = [], arc = null, capName = null, capN = null,
      counter = null, queue = [], draining = false, done = 0, total = 0, t0 = 0, watchdog = null,
      finished = false, reduced = false, R = 0, dirSign = 1;

  /* ------------------------------------------------------------- words */

  /* The app's language, or the one the login gate reads (`og.lang`) — the
     same check js/auth.js makes, because the two screens sit on top of each
     other and must agree. */
  function isAr() {
    if (typeof OG !== 'undefined' && OG.lang === 'ar') return true;
    try { return (localStorage.getItem('og.lang') || '').indexOf('ar') === 0; } catch (e) { return false; }
  }
  function tx(key) {
    if (typeof I18N === 'undefined') return key;
    var d = (isAr() && I18N.ar) || I18N.en || {};
    return d[key] || (I18N.en && I18N.en[key]) || key;
  }
  function nf(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* A count is a number and a noun: "214 products". The noun has a singular
     key so "1 products" never reaches the screen. */
  function count(n, unit) {
    n = Number(n) || 0;
    return { n: n, text: tx(n === 1 ? 'sp_u_' + unit + '_1' : 'sp_u_' + unit) };
  }
  function word(key) { return { text: tx(key) }; }

  function readMirror(s) {
    if (!s) return null;
    if (!s.configured || s.mode === 'off') return word('sp_mirror_off');
    if (s.mode === 'refused' || (s.failures > 0 && s.lastError)) return word('sp_mirror_attention');
    if (s.behind > 0) return count(s.behind, 'row_waiting');
    return word('sp_mirror_ok');
  }

  /* ------------------------------------------------------------ layout */

  /* The orbit's radius comes from the shorter side of the viewport so the
     ring fits a phone held upright and a till's small monitor alike. */
  function layout() {
    if (!stage) return;
    var w = window.innerWidth, h = window.innerHeight;
    var side = Math.min(w, h - 140);
    var chip = side < 420 ? 34 : 40;
    /* The stage box holds the HALO (1.28 R), not just the orbit, so a
       waiting chip at the bottom never sits on the caption. */
    R = Math.max(100, Math.min(168, Math.floor((side / 2 - chip / 2) / 1.28)));
    var d = Math.ceil(R * 2 * HALO + chip);
    stage.style.setProperty('--sp-chip', chip + 'px');
    stage.style.width = d + 'px';
    stage.style.height = d + 'px';
    /* The orbit hairline and the sweep are sized to the orbit itself. */
    var guide = stage.querySelector('.sp-guide'), sweep = stage.querySelector('.sp-sweep');
    if (guide) guide.style.inset = (d / 2 - R) + 'px';
    if (sweep) sweep.style.inset = (d / 2 - R - chip * 0.7) + 'px';

    var n = order.length;
    order.forEach(function (id, i) {
      var a = (-90 + dirSign * i * (360 / n)) * Math.PI / 180;
      var cx = Math.cos(a), cy = Math.sin(a);
      var el = chips[id];
      el.style.setProperty('--x',  (cx * R).toFixed(1) + 'px');
      el.style.setProperty('--y',  (cy * R).toFixed(1) + 'px');
      el.style.setProperty('--x1', (cx * R * HALO).toFixed(1) + 'px');
      el.style.setProperty('--y1', (cy * R * HALO).toFixed(1) + 'px');
      el.style.setProperty('--x0', (cx * R * 1.7).toFixed(1) + 'px');
      el.style.setProperty('--y0', (cy * R * 1.7).toFixed(1) + 'px');
    });
  }

  function build(names) {
    var ar = isAr();
    dirSign = ar ? -1 : 1;
    reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    /* The order the chips sit in is the order of Shop's requests plus the
       mirror last; a request this build does not know gets a plain chip
       rather than being left out of the count. */
    var known = {};
    MODULES.forEach(function (m) { known[m.id] = m; });
    order = (names || []).slice();
    if (order.indexOf('mirror') < 0) order.push('mirror');
    total = order.length;

    root = document.createElement('div');
    root.id = 'bootSplash';
    root.className = 'boot-splash' + (reduced ? ' sp-reduced' : '');
    root.setAttribute('dir', ar ? 'rtl' : 'ltr');
    root.setAttribute('aria-hidden', 'true');

    var html =
      '<div class="sp-wrap">' +
        '<div class="sp-stage">' +
          '<div class="sp-sweep"></div>' +
          '<div class="sp-guide"></div>' +
          '<div class="sp-center">' +
            '<svg class="sp-ring" viewBox="0 0 128 128" aria-hidden="true">' +
              '<circle class="sp-track" cx="64" cy="64" r="60"/>' +
              '<circle class="sp-arc" cx="64" cy="64" r="60"/>' +
            '</svg>' +
            '<div class="sp-mark"><img src="assets/logo.svg" alt=""></div>' +
          '</div>';
    order.forEach(function (id, i) {
      var m = known[id] || { icon: 'boxes' };
      html += '<div class="sp-chip" data-sp="' + esc(id) + '" style="--dl:' + (-(i * 0.37)).toFixed(2) + 's;--dd:' + (i * 0.018).toFixed(3) + 's">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[m.icon] || ICONS.boxes) + '</svg>' +
              '</div>';
    });
    html +=
        '</div>' +
        '<div class="sp-cap">' +
          '<div class="sp-cap-name"></div>' +
          '<div class="sp-cap-n"></div>' +
        '</div>' +
        '<div class="sp-foot">' +
          '<span class="sp-brand">OG SYSTEM</span>' +
          '<span class="sp-sep"></span>' +
          '<span class="sp-count" dir="ltr"></span>' +
        '</div>' +
      '</div>';
    root.innerHTML = html;
    document.body.appendChild(root);

    stage = root.querySelector('.sp-stage');
    arc = root.querySelector('.sp-arc');
    capName = root.querySelector('.sp-cap-name');
    capN = root.querySelector('.sp-cap-n');
    counter = root.querySelector('.sp-count');
    chips = {};
    Array.prototype.forEach.call(root.querySelectorAll('.sp-chip'), function (el) {
      chips[el.getAttribute('data-sp')] = el;
    });

    layout();
    window.addEventListener('resize', layout);

    /* Two frames, so the chips' start positions are painted before the
       transition to the halo begins — otherwise they simply appear there. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (stage) stage.classList.add('sp-live'); });
    });
  }

  /* ------------------------------------------------------------- paint */

  function setArc(frac) {
    if (!arc) return;
    var c = 2 * Math.PI * 60;
    arc.style.strokeDashoffset = (c * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1);
  }

  function caption(name, n) {
    if (!capName) return;
    capName.textContent = name;
    capN.innerHTML = n;
    /* Restart the swap animation on both lines. */
    [capName, capN].forEach(function (el) {
      el.classList.remove('sp-swap');
      void el.offsetWidth;
      el.classList.add('sp-swap');
    });
  }

  function paintCount() {
    if (counter) counter.textContent = done + ' / ' + total;
  }

  function dock(item) {
    var el = chips[item.id];
    var m = null;
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === item.id) m = MODULES[i];
    /* A bundle the account was never allowed to ask for (Shop marks it
       `notAsked`) docks quiet: no number, because there is no truth to show. */
    var v = item.value && item.value.notAsked ? null : item.value;
    var r = null;
    try { r = m && m.read ? m.read(v) : null; } catch (e) { r = null; }

    if (el) {
      el.classList.add('on');
      if (!r) el.classList.add('sp-none');
    }
    done = Math.min(total, done + 1);
    setArc(done / total);
    paintCount();

    var line;
    if (!r) line = '<span class="sp-dash">—</span>';
    else if (typeof r.n === 'number') line = '<b dir="ltr">' + nf(r.n) + '</b> ' + esc(r.text);
    else line = esc(r.text);
    caption(tx('sp_m_' + item.id), line);
  }

  function drain() {
    if (draining) return;
    if (!queue.length) return;
    draining = true;
    var item = queue.shift();
    dock(item);
    setTimeout(function () {
      draining = false;
      if (queue.length) drain();
      else if (finished) outro();
    }, reduced ? 0 : GAP);
  }

  /* ------------------------------------------------------------- outro */

  /* The pieces pull into the mark, the mark answers with one lime pulse,
     and the shell — already drawn underneath — is what is left. */
  function outro() {
    if (!root || !stage) return;
    var wait = reduced ? 0 : Math.max(0, FLOOR - (Date.now() - t0));
    setTimeout(function () {
      if (!root) return;
      setArc(1);
      caption(tx('sp_ready'), '');
      stage.classList.add('sp-done');
      root.classList.add('sp-ending');
      setTimeout(function () {
        if (!root) return;
        root.classList.add('out');
        setTimeout(remove, FADE);
      }, reduced ? 0 : OUTRO);
    }, wait);
  }

  function remove() {
    window.removeEventListener('resize', layout);
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = stage = arc = capName = capN = counter = null;
    chips = {}; queue = []; draining = false; finished = false;
  }

  /* --------------------------------------------------------------- api */

  return {
    /* Mount, with the names of the requests that will dock. Safe to call
       twice; the second call is ignored. */
    show: function (names) {
      if (root || !document.body) return;
      build(names);
      caption(tx('sp_loading'), '');
      paintCount();
      setArc(0);
    },

    /* The shop is being asked now. Called after sign-in, because the gate
       may have held things up for minutes — the floor counts from here. */
    begin: function () {
      if (!root) return;
      t0 = Date.now();
      done = 0; queue = []; draining = false; finished = false;
      Object.keys(chips).forEach(function (id) { chips[id].classList.remove('on', 'sp-none'); });
      setArc(0);
      paintCount();
      caption(tx('sp_loading'), '');
      /* A boot that never calls done() must not be a black screen forever. */
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(function () {
        if (!root) return;
        if (typeof console !== 'undefined') console.warn('[splash] boot did not finish; taking the splash down');
        finished = true; outro();
      }, WATCHDOG);
    },

    /* One request landed. `value` is its answer, read for the number. */
    step: function (name, value) {
      if (!root || !chips[name]) return;
      queue.push({ id: name, value: value });
      drain();
    },

    /* The shell is drawn. Plays out whatever is still queued, then leaves. */
    done: function () {
      if (!root) return;
      finished = true;
      if (!draining && !queue.length) outro();
    },

    /* Straight down, no outro — for the fail screen, which replaces the body. */
    hide: remove,

    names: function () { return MODULES.map(function (m) { return m.id; }); }
  };
})();
