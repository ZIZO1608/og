/* ==========================================================================
   PULSE — the line to Yalla Wear, live                                [Pulse]
   --------------------------------------------------------------------------
   Nothing in this app used to push. A new order, an acceptance, a stage
   move, an invoice — each was only ever seen on the next full reload, which
   on a partner's phone means "when they think to look".

   Two transports, one behaviour:

   1. LIVE — an EventSource on /api/live. The server writes a one-line
      "change" event the moment anything on the line moves, and this asks
      the real routes for what changed. The event itself carries nothing:
      the routes apply the real permission gates, the push does not.

   2. THE POLL — every 45 s while the tab is visible, as the backstop for a
      dropped line or a browser without EventSource. Coming back to a hidden
      tab asks straight away.

   Whichever fires, the rules are the same:

   - NEVER a blind render(). Half the screens hold typed-but-unsaved values.
     The screen is redrawn only when it is one of the two that show this
     data AND nothing is open on top of it. Otherwise the bells update and a
     toast says what arrived; the person taps when ready.
   - Every new line from the OTHER company is announced: a toast, a short
     chime, and — when the tab is hidden or another app is on top — a
     browser notification, so a phone in a pocket still buzzes.
   ========================================================================== */

var Pulse = (function () {

  var POLL_MS = 45 * 1000;
  var timer = null;
  var last = null;              // the stamp we last acted on
  var inflight = false;
  var again = false;            // a change arrived while one was being applied
  var es = null;                // the EventSource
  var live = false;
  var announced = 0;            // highest message id already announced
  var audio = null;

  function side() { return (typeof OG !== 'undefined' && OG.print.partner) ? 'yalla' : 'og'; }
  function me() { return side() === 'og' ? 'readOg' : 'readYl'; }

  function canAsk() {
    return typeof Shop !== 'undefined' && Shop.live() &&
           (typeof Auth === 'undefined' || (Auth.can('print.read') || Auth.can('partner.jobs')));
  }

  /* Whether a repaint would step on somebody. */
  function safeToRedraw() {
    if (typeof modalOpen === 'function' && modalOpen()) return false;
    var drawer = document.getElementById('drawer-root');
    if (drawer && drawer.firstChild) return false;
    return OG.print.partner || OG.view === 'print';
  }

  /* ---- announcing ------------------------------------------------------- */

  function msgId(m) { return Number(String(m.id).replace(/^M/, '')) || 0; }

  function fresh() {
    var f = me(), mine = side();
    return DB.jobMessages.filter(function (m) {
      return !m[f] && m.from !== mine && msgId(m) > announced;
    }).sort(function (a, b) { return msgId(a) - msgId(b); });
  }

  function chime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      if (audio.state === 'suspended') audio.resume();
      var now = audio.currentTime;
      [[880, 0], [1174.7, 0.12]].forEach(function (p) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = p[0];
        g.gain.setValueAtTime(0.0001, now + p[1]);
        g.gain.exponentialRampToValueAtTime(0.18, now + p[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p[1] + 0.35);
        o.connect(g); g.connect(audio.destination);
        o.start(now + p[1]); o.stop(now + p[1] + 0.4);
      });
    } catch (e) { /* no sound is not an error */ }
  }

  function who(m) { return m.from === 'og' ? CONFIG.SHOP_NAME.toUpperCase() : 'YALLA WEAR'; }
  function kindOf(m) { return t('yl_msg_' + String(m.kind).replace(/-/g, '_')); }

  function browserNotify(m) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    try {
      var n = new Notification(who(m) + ' · ' + (m.jobId || m.invoiceId), {
        body: kindOf(m) + ' — ' + String(m.text).slice(0, 120),
        tag: 'og-msg-' + m.id, icon: 'assets/icon-192.png', lang: OG.lang
      });
      n.onclick = function () { window.focus(); n.close(); openFor(m); };
    } catch (e) { /* a browser that refuses is fine */ }
  }

  function openFor(m) {
    if (side() === 'og') {
      if (m.invoiceId) {
        OG.pr = OG.pr || {}; OG.pr.tab = 'invoices';
        go('print', function () { openPartnerInvoice(m.invoiceId); });
      } else {
        go('print', function () { openJobDrawer(m.jobId); });
      }
    } else if (m.invoiceId) {
      YALLA.go('invoices', m.invoiceId);
    } else {
      YALLA.go('queue', m.jobId);
    }
  }

  function announce() {
    var list = fresh();
    if (!list.length) return;
    list.forEach(function (m) { if (msgId(m) > announced) announced = msgId(m); });
    /* Three toasts at most; the rest are on the bubble. */
    list.slice(-3).forEach(function (m, i) {
      setTimeout(function () {
        toast(who(m) + ' · ' + (m.jobId || m.invoiceId),
              kindOf(m) + ' — ' + String(m.text).slice(0, 90), 'ok', 6000);
      }, i * 350);
    });
    chime();
    browserNotify(list[list.length - 1]);
  }

  /* ---- fetching --------------------------------------------------------- */

  function apply() {
    var alerts = (side() === 'og' && typeof Auth !== 'undefined')
      ? API.get('/api/notifications').catch(function () { return null; })
      : Promise.resolve(null);

    return Promise.all([Shop.partnerBundle(), alerts]).then(function (r) {
      /* Only the two things that changed. DB.hydrate is the whole-shop
         load — handed a payload with no catalogue in it, it would empty the
         catalogue — so the partner bundle goes through its own hydrator and
         the alert list is refilled in place. */
      if (r[0] && typeof hydratePartner === 'function') hydratePartner(r[0]);
      if (r[1] && r[1].notifications) {
        DB.notifications.length = 0;
        r[1].notifications.forEach(function (n) { DB.notifications.push(n); });
        DB.fullCards.length = 0;
        (r[1].fullCards || []).forEach(function (id) { DB.fullCards.push(Number(id)); });
      }

      if (typeof Notify !== 'undefined') Notify.refresh();
      if (safeToRedraw()) {
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof render === 'function') render();
      } else if (typeof renderTopbar === 'function') {
        /* The badges live in the topbar; it holds no unsaved state. */
        renderTopbar();
      }
      paintLive();
      announce();
    });
  }

  function tick() {
    if (!canAsk()) return;
    if (document.visibilityState !== 'visible' && !live) return;
    if (inflight) { again = true; return; }
    inflight = true;
    Shop.pulse().then(function (p) {
      var stamp = p.stamp + '|' + p.unread + '|' + p.pending;
      if (last === null) {
        /* First look: nothing to announce yet, but remember what is
           already on the thread so only what arrives from now on is. */
        last = stamp;
        DB.jobMessages.forEach(function (m) { if (msgId(m) > announced) announced = msgId(m); });
        return null;
      }
      if (stamp === last) return null;
      last = stamp;
      return apply();
    }).catch(function () {
      /* A missed beat is not news. */
    }).then(function () {
      inflight = false;
      if (again) { again = false; tick(); }
    });
  }

  /* ---- the live line ---------------------------------------------------- */

  function paintLive() {
    document.querySelectorAll('.live-dot').forEach(function (el) {
      el.classList.toggle('on', live);
      el.title = live ? t('live_on') : t('live_off');
    });
  }

  function connect() {
    if (es || !window.EventSource || !canAsk()) return;
    try {
      es = new EventSource('/api/live');
    } catch (e) { es = null; return; }
    es.addEventListener('hello', function () { live = true; paintLive(); });
    es.addEventListener('change', function () { tick(); });
    es.onerror = function () {
      /* The browser reconnects by itself (retry: 3000). Until it does, the
         dot goes grey and the poll carries on. */
      live = false; paintLive();
    };
  }

  function askPermissionOnce() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    document.addEventListener('click', function () {
      try { Notification.requestPermission(); } catch (e) { /* older API */ }
    }, { once: true });
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
    askPermissionOnce();
    connect();
    tick();
  }

  return {
    start: start, tick: tick,
    isLive: function () { return live; },
    settle: function () { last = null; }
  };
})();
