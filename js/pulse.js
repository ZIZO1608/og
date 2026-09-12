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
  var presence = null;          // { og, yalla, people: { og: [], yalla: [] } }

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

  /* The server's automatic lines start with their own English label
     ('Order sent — P-1035 · 1 pcs'); beside the localised kind that read
     twice. The label goes, the facts stay. */
  function body(m) {
    return String(m.text).replace(/^[A-Za-z][^—]{1,28} — /, '').slice(0, 90);
  }

  function announce(list) {
    if (!list || !list.length) return;
    /* Three toasts at most; the rest are on the bubble. */
    list.slice(-3).forEach(function (m, i) {
      setTimeout(function () {
        toast(who(m) + ' · ' + (m.jobId || m.invoiceId) + ' · ' + kindOf(m),
              body(m), 'ok', 6000);
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

      /* WHAT IS NEW IS DECIDED HERE, before anything draws.

         Two screens mark messages read as part of rendering themselves —
         the job drawer and the Reviews page — so by the time the paint was
         finished there was nothing left that counted as unread, and the
         toast for the line that had just arrived never fired. The list is
         taken first and announced last. */
      var news = fresh();
      news.forEach(function (m) { if (msgId(m) > announced) announced = msgId(m); });

      if (typeof Notify !== 'undefined') Notify.refresh();
      if (safeToRedraw()) {
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof render === 'function') render();
      } else {
        /* Something is open on top. The shell around it holds no unsaved
           state, so the badges, the sidebar counts and the phone tabs still
           move — and a thread that is open gets its new lines in place. */
        if (typeof renderTopbar === 'function') renderTopbar();
        if (typeof renderSidebar === 'function') renderSidebar();
        refreshOpenThreads();
      }
      paintLive();
      announce(news);
    });
  }

  function tick() {
    if (!canAsk()) return;
    if (document.visibilityState !== 'visible' && !live) return;
    if (inflight) { again = true; return; }
    inflight = true;
    Shop.pulse().then(function (p) {
      if (p.presence) { presence = p.presence; paintLive(); }
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

  /* A drawer showing a job thread is redrawn from the fresh messages, and
     the reader is marked as having read them — they are looking right at
     it. */
  function refreshOpenThreads() {
    if (typeof YALLA === 'undefined' || !YALLA.threadCard) return;
    document.querySelectorAll('[data-thread-job]').forEach(function (host) {
      var id = host.getAttribute('data-thread-job'), s = host.getAttribute('data-thread-side');
      host.innerHTML = YALLA.threadCard(id, s);
      DB.markRead(s, { jobId: id });
      var box = host.querySelector('.yl-thread');
      if (box && box.lastElementChild) box.lastElementChild.scrollIntoView({ block: 'nearest' });
    });
    if (typeof Notify !== 'undefined') Notify.refresh();
  }

  /* ---- the live line ---------------------------------------------------- */

  function paintLive() {
    document.querySelectorAll('.live-dot').forEach(function (el) {
      el.classList.toggle('on', live);
      el.title = live ? t('live_on') : t('live_off');
    });
    document.querySelectorAll('.live-txt').forEach(function (el) { el.textContent = presenceText(); });
    document.querySelectorAll('.live-faces').forEach(function (el) { el.innerHTML = facesHtml(); });
    document.querySelectorAll('.live-who').forEach(function (el) {
      el.classList.toggle('other-on', otherOnline());
    });
    /* An open panel is a live thing, not a snapshot: somebody watching it to
       see whether the other partner has come back must not have to shut it
       and open it again. */
    var pop = document.getElementById('whoPop');
    if (pop && pop.parentNode) pop.outerHTML = whoPanelHtml();
  }

  function otherOnline() {
    if (!presence) return false;
    return (side() === 'og' ? presence.yalla : presence.og) > 0;
  }

  function otherSide() { return side() === 'og' ? 'yalla' : 'og'; }
  function sideName(s) {
    if (typeof CONFIG === 'undefined') return s === 'yalla' ? 'Yalla Wear' : 'OG';
    return s === 'yalla' ? (CONFIG.PRINT_PARTNER || 'Yalla Wear') : CONFIG.SHOP_NAME;
  }

  /* Who is on the line, per side, from the last event the server sent. */
  function peopleOn(s) {
    return (presence && presence.people && presence.people[s]) || [];
  }

  /* personFace lives in app-util.js, beside the colour it is drawn in. */
  function face(name) { return personFace(name); }

  /* "Zaven · online" while one of them is reading, "Zaven + Zohrab" while
     both are. The company name is the fallback for a connection with no
     name behind it, and for nobody at all. */
  function presenceText() {
    if (!live) return t('live_off');
    var them = peopleOn(otherSide());
    if (!them.length) return sideName(otherSide()) + ' · ' + t('live_other_off');

    var names = them.map(function (p) { return personFirst(p.name) || sideName(otherSide()); });
    if (names.length === 1) return names[0] + ' · ' + t('live_other_on');
    if (names.length === 2) return names[0] + ' + ' + names[1];
    return names[0] + ' +' + (names.length - 1);
  }

  /* The faces inside the pill, newest company first. Drawn only for the
     OTHER side: a row of your own colleagues tells you nothing you did not
     know, and the pill has a phone's width to live in. */
  function facesHtml() {
    return peopleOn(otherSide()).slice(0, 3).map(function (p) {
      var c = personTint(p.id == null ? p.name : p.id);
      return '<span class="who-face" title="' + esc(p.name || '') + '" ' +
        'style="color:' + c.fg + ';background:' + c.bg + '">' + esc(face(p.name)) + '</span>';
    }).join('');
  }

  /* ---- the who panel ----------------------------------------------------
     Everyone this browser has a name for, both companies, with the ones
     who are reading right now lit. The roster is the people the partner
     payload already named (DB.people — whoever wrote, sent, moved or paid
     for anything) plus anyone connected this second, so somebody who has
     signed in but not yet touched a job still appears the moment they do
     connect. It is not the staff list and cannot become one: nothing here
     is a login, a role or an account anybody could reach. */
  function roster() {
    var out = { og: {}, yalla: {} };
    var add = function (s, p, on) {
      if (!p) return;
      var key = String(p.id == null ? 'n:' + p.name : p.id);
      var row = out[s][key] || (out[s][key] = { id: p.id, name: p.name, online: false });
      if (p.name && !row.name) row.name = p.name;
      if (on) row.online = true;
    };

    if (typeof DB !== 'undefined' && DB.people) {
      Object.keys(DB.people).forEach(function (k) {
        var p = DB.people[k];
        if (p && (p.side === 'og' || p.side === 'yalla')) add(p.side, p, false);
      });
    }
    ['og', 'yalla'].forEach(function (s) {
      peopleOn(s).forEach(function (p) { add(s, p, true); });
    });

    var list = function (s) {
      return Object.keys(out[s]).map(function (k) { return out[s][k]; })
        .sort(function (a, b) {
          if (a.online !== b.online) return a.online ? -1 : 1;
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
    };
    return { og: list('og'), yalla: list('yalla') };
  }

  function whoPanelHtml() {
    var r = roster();
    var mine = side();
    var order = [otherSide(), mine];   /* the other company first: it is the question */

    var h = '<div class="who-pop" id="whoPop">' +
      '<div class="who-head"><b>' + t('who_title') + '</b>' +
        '<span class="who-line' + (live ? ' on' : '') + '">' + t(live ? 'live_on' : 'live_off') + '</span></div>';

    order.forEach(function (s) {
      var rows = r[s];
      h += '<div class="who-side"><div class="who-co">' + esc(sideName(s)) +
        (s === mine ? ' <span class="who-you">' + t('who_you') + '</span>' : '') + '</div>';

      if (!rows.length) {
        h += '<div class="who-none">' + t('who_nobody') + '</div></div>';
        return;
      }
      rows.forEach(function (p) {
        var c = personTint(p.id == null ? p.name : p.id);
        h += '<div class="who-row' + (p.online ? ' on' : '') + '">' +
          '<span class="who-face" style="color:' + c.fg + ';background:' + c.bg + '">' + esc(face(p.name)) + '</span>' +
          '<span class="who-name">' + esc(p.name || '—') + '</span>' +
          '<span class="who-state">' +
            (p.online ? '<i class="who-dot" style="background:' + c.dot + '"></i>' + t('who_online')
                      : t('who_offline')) +
          '</span></div>';
      });
      h += '</div>';
    });

    return h + '</div>';
  }

  function takePresence(ev) {
    try {
      var d = JSON.parse(ev.data || '{}');
      if (d && d.presence) { presence = d.presence; paintLive(); }
    } catch (e) { /* a line with no data */ }
  }

  /* The line is also how the Supabase mirror reports itself, so a manager
     who holds config.write and nothing on the print side still connects. */
  function canConnect() {
    if (canAsk()) return true;
    if (typeof Shop === 'undefined' || !Shop.live() || typeof Auth === 'undefined') return false;
    /* config.write for the mirror's own status line; delivery.read since the
       board became live — a driver and the office both need the line, and
       neither of them can read a print job. */
    return Auth.can('config.write') || Auth.can('delivery.read');
  }

  /* HARD REFRESH, from the control panel's button.

     A plain location.reload() is not enough and never was. The service worker
     is cache-first with ignoreSearch (see sw.js), so it answers for js/ and
     css/ out of its own store and the network is never asked — no query
     string defeats that, and neither does F5. So: throw the caches away,
     take the update to the worker itself if the panel bumped its name, and
     only then reload. The reload is left until last on purpose; a page that
     reloads before its caches are gone comes straight back on the old files.

     It arrives only on tabs holding /api/live, which is the manager's and the
     developer's. That is deliberate — a till reloading itself under a
     cashier's hands mid-sale is a bug, not a feature. */
  function hardRefresh() {
    var done = function () { location.reload(); };
    var jobs = [];

    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.update(); }));
      }));
    }

    if (!jobs.length) return done();
    /* Never let a refusing cache API strand the page on the old build — the
       reload is the point and it happens either way. */
    Promise.all(jobs).then(done, done);
    setTimeout(done, 2500);
  }

  function connect() {
    if (es || !window.EventSource || !canConnect()) return;
    try {
      es = new EventSource('/api/live');
    } catch (e) { es = null; return; }
    es.addEventListener('hello', function (ev) { live = true; takePresence(ev); paintLive(); });
    es.addEventListener('change', function (ev) {
      takePresence(ev);
      /* Somebody arriving or leaving is not a data change — nothing to
         refetch. Neither is the mirror saying where it is up to: that
         goes to its own painter. Everything else is. */
      var d = {};
      try { d = JSON.parse(ev.data || '{}'); } catch (e) { /* ignore */ }
      if (d.mirror) { if (typeof MirrorUI !== 'undefined') MirrorUI.paint(d.mirror); return; }
      if (d.reload) { hardRefresh(); return; }
      /* A parcel moved. The board is a screen two people watch at once — the
         office scanning a sheet and whoever is answering the phone — and a
         parcel that left five minutes ago still showing as waiting is how it
         gets handed to two carriers. Only the board refetches, and only while
         it is the screen on show: this event carries no data, and the reload
         goes through the same gated route as any other read. */
      if (d.deliveries) {
        var onBoard = OG.view === 'deliveries' ||
                      (OG.view === 'dashboard' && roleOf() === 'delivery');
        if (typeof Deliveries !== 'undefined' && onBoard && !modalOpen()) {
          Deliveries.load();
          if (typeof Road !== 'undefined' && roleOf() !== 'delivery') Road.load(true);
        }
        return;
      }
      if (!d.who && canAsk()) tick();
    });
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
    presenceText: presenceText,
    facesHtml: facesHtml,
    whoPanelHtml: whoPanelHtml,
    peopleOn: peopleOn,
    settle: function () { last = null; }
  };
})();
