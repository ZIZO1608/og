/* ==========================================================================
   OG SYSTEM — the standby copy, and working through an outage [js/standby.js]
   --------------------------------------------------------------------------
   The server says what it is on /api/health (server/lib/standby.js): the
   MAIN server, or a STANDBY — the shop laptop, keeping a copy of it. This
   file draws what that means, on both sides.

   ON THE LAPTOP, one strip across the top of every screen, from the login
   gate onwards, in four moods:
     following  a read-only copy "as of 14:05", with the way back to the domain
     offline    the main server is silent: the till works HERE, and the strip
                counts what is waiting for the internet (lib/outbox.js)
     sending    the line is back: the list is going up, counted down
     back       all sent — "back to shop.ogsports1.com"
   and, for somebody who may void a sale, what the main server REFUSED, in a
   list, each one put away by hand once it has been dealt with.

   ON THE MAIN SERVER (the domain), the other half of the changeover: the
   page remembers where the shop laptop answers (health's `standbys`, signed
   in only) and, after twenty seconds with no answer at all — the patience
   rule — covers itself with "Continue on the shop laptop". Nothing is drawn
   when no shop laptop has ever been seen: today, with the laptop as the
   main server, this half does nothing at all.
   ========================================================================== */
var Standby = (function () {
  var info = null;        // the standby block of /api/health, on a laptop; null on the main server
  var timer = null, every = 0;
  var downSince = null;   // the main server's side: the first unanswered ask
  var cover = false, waited = false;
  var failedBoot = false; // Shop.fail drew its card: the offer is in it, and an answer means reload
  var inFlight = false;   // one /api/health at a time: 15 s requests on a 5 s interval stacked up three deep
  var RELOADS = 'og.sb.reloads';
  var LS = 'og.standby.where';
  var PATIENCE_MS = 20000;

  function can(p) { return typeof Auth !== 'undefined' && Auth.can && Auth.can(p); }

  /* A sentence with {x} slots, each filled as its own isolated run — a time
     or a count dropped into Arabic is otherwise dragged to the far end. */
  function words(el, key, vals) {
    el.textContent = '';
    String(t(key)).split(/(\{\w+\})/).forEach(function (part) {
      var m = /^\{(\w+)\}$/.exec(part);
      if (!m) { if (part) el.appendChild(document.createTextNode(part)); return; }
      var b = document.createElement('bdi');
      b.setAttribute('dir', 'ltr');
      b.textContent = vals && vals[m[1]] != null ? String(vals[m[1]]) : '';
      el.appendChild(b);
    });
    return el;
  }
  function clockOf(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = p(d.getHours()) + ':' + p(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString() + ' ' + hm;
  }
  function hostOf(url) { try { return new URL(url).host; } catch (e) { return url || ''; } }
  function recent(iso, ms) { var t0 = Date.parse(iso || ''); return isFinite(t0) && Date.now() - t0 < ms; }

  /* ---------------------------------------------------------- the laptop */

  function mood() {
    if (!info) return null;
    if (info.mode === 'offline') return 'offline';
    if (info.mode === 'sending' || info.mode === 'closing') return 'sending';
    if (recent(info.backAt, 10 * 60000)) return 'back';
    return 'following';
  }

  function paint() {
    var el = document.getElementById('standbyStrip');
    var m = mood();
    if (!m) { if (el) el.remove(); document.body.classList.remove('is-standby'); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'standbyStrip';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    document.body.classList.add('is-standby');
    el.className = 'standby-strip is-' + m + (m === 'following' && info.reachable === false ? ' is-cut' : '');
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="sb-words"></span>';
    var w = el.querySelector('.sb-words');

    if (m === 'offline') {
      words(w, info.waiting ? 'sb_off_n' : 'sb_off_0', { n: info.waiting });
      if (info.numbersLeft != null && info.numbersLeft <= 10) {
        w.appendChild(document.createTextNode(' · '));
        w.appendChild(words(document.createElement('span'), 'sb_numbers', { n: info.numbersLeft }));
      }
    } else if (m === 'sending') {
      words(w, 'sb_sending', { n: info.waiting });
    } else if (m === 'back') {
      words(w, 'sb_back', {});
    } else {
      var at = info.copyAt ? clockOf(info.copyAt) : null;
      words(w, at ? 'sb_strip_at' : 'sb_strip_none', { at: at });
    }

    /* The way back to the domain, whenever the line is up. */
    if ((m === 'following' || m === 'back') && info.home && info.reachable !== false) {
      var a = document.createElement('a');
      a.className = 'sb-go';
      a.href = info.home;
      /* ONE span: the link is a flex box, and loose words and a number
         beside each other become flex items with their spaces collapsed
         ("Back toshop…"). */
      a.appendChild(words(document.createElement('span'), 'sb_home', { host: hostOf(info.home) }));
      el.appendChild(a);
    }
    /* What the main server refused, for somebody who can deal with it. */
    if (info.attention > 0 && (can('config.write') || can('void'))) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-need';
      b.setAttribute('data-act', 'sb-outbox');
      b.appendChild(words(document.createElement('span'), 'sb_attention', { n: info.attention }));
      el.appendChild(b);
    }
  }

  /* ------------------------------------------------ the list for a person */

  var KIND = { sale: 'ob_k_sale', 'void': 'ob_k_void', attach: 'ob_k_attach', cust_new: 'ob_k_cust_new',
               cust_edit: 'ob_k_cust_edit', redeem: 'ob_k_redeem', want: 'ob_k_want' };

  function openList() {
    API.get('/api/standby/outbox').then(function (r) {
      var rows = (r && r.entries) || [];
      var body = '<p class="ob-intro">' + esc(t('ob_intro')) + '</p>' +
        (rows.length ? rows.map(function (e) {
          var what = t(KIND[e.kind] || 'ob_k_sale') + (e.ref ? ' · <bdi dir="ltr">' + esc(e.ref) + '</bdi>' : '');
          var lines = (e.lines || []).map(function (l) {
            return '<bdi dir="ltr">' + esc(l.sku) + ' × ' + esc(l.qty) + '</bdi>';
          }).join(' · ');
          return '<div class="ob-row">' +
            '<div class="ob-main">' +
              '<div class="ob-what">' + what + '</div>' +
              '<div class="ob-state">' + esc(t('ob_s_' + e.state)) + '</div>' +
              (lines ? '<div class="ob-lines">' + lines + '</div>' : '') +
              '<div class="ob-meta"><bdi>' + esc(e.who || '') + '</bdi> · <bdi dir="ltr">' + esc(clockOf(e.at) || '') + '</bdi></div>' +
              (e.error ? '<div class="ob-why">' + esc(e.error) + '</div>' : '') +
            '</div>' +
            '<button type="button" class="btn" data-act="sb-dismiss" data-uuid="' + esc(e.uuid) + '">' + esc(t('ob_put_away')) + '</button>' +
          '</div>';
        }).join('') : '<div class="cart-empty"><b>' + esc(t('ob_none')) + '</b></div>');
      openModal({ title: esc(t('ob_title')), body: body });
    }).catch(function (err) {
      if (typeof toast === 'function') toast(t('ob_title'), API.friendly(err), 'err');
    });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['sb-outbox'] = function () { openList(); };
    ACTIONS['sb-dismiss'] = function (el) {
      el.disabled = true;
      API.post('/api/standby/outbox/dismiss', { uuid: el.getAttribute('data-uuid') }).then(function () {
        check();
        openList();
      }).catch(function (err) {
        el.disabled = false;
        if (typeof toast === 'function') toast(t('ob_title'), API.friendly(err), 'err');
      });
    };
  }

  /* ------------------------------------------- the main server's side */

  function remembered() {
    try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; }
  }
  function remember(list) {
    try {
      var urls = [];
      (list || []).forEach(function (s) { (s.urls || []).forEach(function (u) { if (urls.indexOf(u) < 0) urls.push(u); }); });
      if (urls.length) localStorage.setItem(LS, JSON.stringify(urls));
      else localStorage.removeItem(LS);
    } catch (e) { /* storage refused: the cover simply is not offered */ }
  }

  function isLocal(u) {
    try { var h = new URL(u).hostname; return h === 'localhost' || h === '127.0.0.1'; } catch (e) { return false; }
  }
  function phone() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  }
  /* Where to go instead, in the order to offer it (29 Sep 2026). On a
     computer, THIS computer first: the shop's own PC is both the till and the
     standby, so for it "continue here" is the answer. On a phone, the Wi-Fi
     address only; localhost on a phone is the phone. The page's own origin
     is never offered: a link to the page that just failed is no way out. */
  function offers() {
    var urls = remembered() || [];
    var local = [], wifi = [];
    /* A page that is itself on localhost has just found OG System not
       running HERE; another localhost address is no way out of that. */
    var hereLocal = isLocal(location.href);
    for (var i = 0; i < urls.length; i++) {
      var o;
      try { o = new URL(urls[i]).origin; } catch (e) { continue; }
      if (o === location.origin) continue;
      (isLocal(urls[i]) ? local : wifi).push(urls[i]);
    }
    return phone() || hereLocal ? wifi : local.concat(wifi);
  }
  function offerHtml(list) {
    if (!list.length) return '';
    return '<a class="btn btn-primary sb-cta" href="' + esc(list[0]) + '">' + esc(t(isLocal(list[0]) ? 'cv_go_here' : 'cv_go')) + '</a>' +
      (list.length > 1 ? '<div class="sb-alt">' + list.slice(1).map(function (u) {
        return '<a href="' + esc(u) + '">' + (isLocal(u) ? esc(t('cv_go_here')) : '<bdi dir="ltr">' + esc(hostOf(u)) + '</bdi>') + '</a>';
      }).join(' · ') + '</div>' : '');
  }

  /* A page that never booted and then hears the main server answer: reload,
     so it boots. At most three times in five minutes: a server that answers
     its health line and then fails the boot again must not turn the page into
     a machine that reloads itself for ever. */
  function reloadOnce() {
    var now = Date.now(), list = [];
    try { list = JSON.parse(sessionStorage.getItem(RELOADS) || '[]').filter(function (x) { return now - x < 300000; }); } catch (e) { list = []; }
    if (list.length >= 3) return false;
    list.push(now);
    try { sessionStorage.setItem(RELOADS, JSON.stringify(list)); } catch (e) { /* reload anyway */ }
    location.reload();
    return true;
  }

  /* The first time this page hears the server, ask the service worker to
     fetch any file its offline copy is missing (sw.js, 'top-up'): the page
     is served FROM that copy when the server cannot be reached, and one
     missing script is a blank screen at exactly that moment. Once per page,
     before anybody signs in, so a till left on the login gate heals too. */
  var toppedUp = false;
  function topUp() {
    if (toppedUp) return;
    toppedUp = true;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'top-up' });
      }
    } catch (e) { /* no worker: nothing to top up */ }
  }

  function paintCover() {
    var el = document.getElementById('sbCover');
    var list = offers();
    if (!cover || waited || failedBoot || !list.length) { if (el) el.remove(); return; }
    var secs = downSince ? Math.round((Date.now() - downSince) / 1000) : 0;
    if (!el) {
      el = document.createElement('div');
      el.id = 'sbCover';
      el.className = 'sb-cover';
      el.setAttribute('role', 'alertdialog');
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="sb-card">' +
        '<div class="sb-ring" aria-hidden="true"></div>' +
        '<h2>' + esc(t('cv_title')) + '</h2>' +
        '<p>' + esc(t('cv_body')) + '</p>' +
        '<p class="sb-since"></p>' +
        offerHtml(list) +
        '<button type="button" class="btn btn-ghost" data-sb="wait">' + esc(t('cv_wait')) + '</button>' +
      '</div>';
    words(el.querySelector('.sb-since'), 'cv_since', { n: secs });
  }

  /* ------------------------------------------------------------ asking */

  function schedule(ms) {
    if (every === ms && timer) return;
    if (timer) window.clearInterval(timer);
    every = ms;
    timer = window.setInterval(check, ms);
  }

  function check() {
    if (inFlight || typeof API === 'undefined' || !API.get) return;
    inFlight = true;
    /* then(ok, fail), not then().catch(): a throw while drawing the good news
       (a toast into a page Shop.fail had emptied) used to land in the catch,
       which counted it as the server being down again, so the page never
       came back by itself. */
    API.get('/api/health').then(function (h) {
      inFlight = false;
      topUp();
      if (failedBoot) {
        if (reloadOnce()) return;
        var line = document.querySelector('.sb-recheck');
        if (line) line.textContent = t('cv_back');
        failedBoot = false;
      }
      var wasDown = !!downSince;
      downSince = null; waited = false;
      if (cover) {
        cover = false;
        paintCover();
        if (wasDown && typeof toast === 'function') { try { toast(t('cv_back'), '', 'ok'); } catch (e) { /* no toast box on this page */ } }
      }
      info = h && h.role === 'standby' ? (h.standby || {}) : null;
      if (!info && h && h.standbys) remember(h.standbys);
      paint();
      /* Every three seconds while something is moving on the laptop; every
         ten on the main server once a shop laptop is known (the patience
         rule needs a pulse); every minute otherwise. */
      var m = mood();
      schedule(m && (m !== 'following' || info.reachable === false) ? 3000
        : m ? 30000
        : (remembered() ? 10000 : 60000));
    }, function (err) {
      inFlight = false;
      /* An HTTP answer of any kind means the server is there, except the
         proxy's own 503 shop_unreachable: nginx answered, the main server
         behind it did not. */
      if (err && err.status && err.code !== 'shop_unreachable') return;
      if (failedBoot) { schedule(5000); return; }
      if (info) return;                       /* the laptop itself: Shop.fail says so */
      if (!downSince) downSince = Date.now();
      if (Date.now() - downSince >= PATIENCE_MS) cover = true;
      paintCover();
      schedule(remembered() ? 5000 : 60000);
    });
  }

  return {
    /* From start(), before the sign-in and before boot(): the cover has to
       work on a page that never managed to boot, which is exactly the page
       it is for — so its buttons are wired here, not in boot(). */
    watch: function () {
      register();
      /* data-sb, not data-act: data-act is dispatched by bindGlobal(), which
         only runs once boot() succeeds, and the cover is FOR the page that
         did not boot. "Keep waiting here" was a dead button there. */
      document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sb]') : null;
        if (!el) return;
        if (el.getAttribute('data-sb') === 'wait') { waited = true; paintCover(); }
      });
      check();
      if (!timer) schedule(60000);
    },
    /* Shop.fail's card, when the main server could not be reached at all:
       the way to the shop's own computer goes IN the card (a failed boot is
       already the verdict, no twenty seconds of patience on top), and the
       page keeps asking by itself and opens the moment the server answers. */
    onFail: function (card) {
      failedBoot = true;
      cover = false;
      paintCover();
      if (card && !card.querySelector('.sb-fail-offer')) {
        var list = offers();
        var box = document.createElement('div');
        box.className = 'sb-fail-offer';
        box.innerHTML = (list.length ? '<p>' + esc(t('cv_body')) + '</p>' + offerHtml(list) : '') +
          '<p class="sb-recheck" role="status">' + esc(t('cv_rechecking')) + '</p>';
        var again = card.querySelector('button');
        if (again) card.insertBefore(box, again); else card.appendChild(box);
        if (again && list.length) again.classList.remove('btn-primary');
      }
      schedule(5000);
    },
    /* Is this a standby, as far as the last answer said. */
    on: function () { return !!info; },
    repaint: function () { paint(); paintCover(); },
    check: check
  };
})();
