/* ==========================================================================
   OG SYSTEM — the customer's page, its one script        [track-page-client.js]
   --------------------------------------------------------------------------
   Inlined at the bottom of every /i/<token> page by lib/receipt.js. The page
   is complete without it; this only ADDS:

   1. LIVE. An EventSource on /i/<token>/live that carries no data — only
      "this order moved" — and a refetch of the page's own public HTML, whose
      [data-live] regions are swapped in place. Never a JSON feed: the page is
      the one shape of this data a stranger may see, and a second shape is a
      second thing to keep scrubbed. No stream (an old browser, a proxy, the
      server's cap) falls back to asking every 45 seconds.
   2. RELATIVE TIMES beside the absolute ones the server wrote.
   3. NOTIFY ME. Web Push through /i/sw.js; the states a customer can actually
      be in are each said in words — on, off, blocked, an iPhone that has to
      add the page to its home screen first, a browser that cannot.

   ES5 on purpose, and no template literals: this string sits inside a
   template literal in Node, and it runs on whatever phone the link reaches.
   ========================================================================== */

export const CLIENT = String.raw`(function () {
  'use strict';
  var d = document;
  var C;
  try { C = JSON.parse(d.getElementById('tpData').textContent); } catch (e) { return; }
  var L = C.t || {};
  function $(id) { return d.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fill(s, v) {
    v = v || {};
    return String(s || '').replace(/\{(\w+)\}/g, function (m, k) {
      return k === 'shop' ? (C.shop || '') : (v[k] != null ? String(v[k]) : m);
    });
  }

  /* ------------------------------------------------------ which phone
     Asked of the user agent only to choose WORDS — where Share is, whether
     this browser can add to the Home Screen at all. What the page can do is
     always asked of the browser itself (supported(), below). */
  var UA = navigator.userAgent || '';
  function isIpad() { return /iPad/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isIos() { return /iPhone|iPod/.test(UA) || isIpad(); }
  function isHome() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  /* iOS 16.4 is the first that pushes to a Home Screen page: 1604. */
  function iosVersion() {
    var m = /OS (\d+)[_.](\d+)/.exec(UA) || /Version\/(\d+)\.(\d+)/.exec(UA);
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  }
  /* An app's own browser (Instagram, Facebook, TikTok, Google) has no Add to
     Home Screen at all; the page has to be opened in Safari first. */
  function inAppBrowser() { return /FBAN|FBAV|FB_IAB|Instagram|Snapchat|musical_ly|BytedanceWebview|TikTok|Line\/|GSA\//.test(UA); }
  function shareKind() {
    if (/CriOS|EdgiOS/.test(UA)) return 'bar';
    if (/FxiOS|OPiOS/.test(UA)) return 'menu';
    return isIpad() ? 'pad' : 'safari';
  }
  /* On a Home Screen iPhone with notifications on, the phone's own banner
     drops in from the top for every change; the page's banner would be a
     second one under it. */
  var nativeTop = false;

  /* ------------------------------------------------------------ times */
  var rtf = null;
  try { rtf = new Intl.RelativeTimeFormat(C.lang === 'ar' ? 'ar-u-nu-latn' : 'en', { numeric: 'auto' }); } catch (e) {}
  function rel(iso) {
    var t = Date.parse(iso);
    if (!rtf || isNaN(t)) return '';
    var s = Math.round((t - Date.now()) / 1000), a = Math.abs(s);
    if (a < 45) return L.justNow || '';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 604800) return rtf.format(Math.round(s / 86400), 'day');
    return '';
  }
  function times() {
    var els = d.querySelectorAll('.rel[data-at]');
    for (var i = 0; i < els.length; i++) els[i].textContent = rel(els[i].getAttribute('data-at'));
  }
  times();
  setInterval(times, 30000);

  /* --------------------------------------------------- sound + banner
     A browser plays no sound until the person has touched the page, so the
     audio is unlocked by the first tap, key or touch, and a chime before that
     is silently skipped rather than an error. The choice to mute is per
     device. Two sine notes a sixth apart, soft attack, half a second — a
     "ding" that reads as news, not as an alarm. */
  var SKEY = 'og.track.sound';
  var soundOn = true;
  try { soundOn = localStorage.getItem(SKEY) !== 'off'; } catch (e) {}
  var actx = null;
  function unlock() {
    if (actx) { if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} } return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { actx = new AC(); } catch (e) { actx = null; }
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) { d.addEventListener(ev, unlock, true); });
  /* A phone refuses to vibrate for a page nobody has touched, and says so in
     the console every time it is asked — so it is only asked after a tap. */
  function buzz(pattern) {
    try {
      var ua = navigator.userActivation;
      if (!navigator.vibrate || (ua && !ua.hasBeenActive) || (!ua && !actx)) return;
      navigator.vibrate(pattern);
    } catch (e) {}
  }
  function chime() {
    if (!soundOn || !actx) return;
    try {
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime + 0.03;
      [[880, 0], [1318.5, 0.15]].forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.6);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t0 + n[1]);
        o.stop(t0 + n[1] + 0.65);
      });
    } catch (e) {}
  }

  var bannerT = null;
  function hideBanner() {
    var el = $('tpBanner');
    if (!el || el.hidden) return;
    el.className = 'banner is-out';
    setTimeout(function () { el.hidden = true; el.className = 'banner'; }, 360);
  }
  function banner(msg, fromLive) {
    var el = $('tpBanner');
    if (!el || !msg) return;
    if (fromLive && nativeTop) return;
    el.querySelector('.b-txt b').textContent = (C.shop ? C.shop + ' · ' : '') + (L.bannerTitle || '');
    el.querySelector('.b-txt span').textContent = msg;
    el.querySelector('.b-now').textContent = L.justNow || '';
    el.className = 'banner';
    el.hidden = true;
    void el.offsetWidth;
    el.hidden = false;
    chime();
    buzz([90, 60, 120]);
    clearTimeout(bannerT);
    bannerT = setTimeout(hideBanner, 6500);
  }
  if ($('tpBanner')) {
    $('tpBanner').addEventListener('click', function () {
      hideBanner();
      var tl = $('tpTime');
      if (tl && tl.scrollIntoView) tl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  var sbtn = $('tpSound');
  function paintSound() {
    if (!sbtn) return;
    var icons = C.icons || {};
    sbtn.hidden = false;
    sbtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    sbtn.title = soundOn ? (L.sOn || '') : (L.sOff || '');
    sbtn.setAttribute('aria-label', sbtn.title);
    sbtn.innerHTML = soundOn ? (icons.vol || '') : (icons.mute || '');
  }
  if (sbtn && C.live) {
    paintSound();
    sbtn.addEventListener('click', function () {
      soundOn = !soundOn;
      try { localStorage.setItem(SKEY, soundOn ? 'on' : 'off'); } catch (e) {}
      paintSound();
      if (soundOn) { unlock(); chime(); }
    });
  }

  /* ------------------------------------------------------------- live */
  var pill = $('tpLive');
  function live(state) {
    if (!pill) return;
    pill.hidden = false;
    pill.setAttribute('data-state', state);
    pill.querySelector('span').textContent = L[state] || '';
  }
  /* Live cards are swapped; kept cards (the review, which may hold typing)
     never are — but one appearing or going away is a different page. */
  function regionIds(root) {
    var out = [], els = root.querySelectorAll('[data-live],[data-keep]');
    for (var i = 0; i < els.length; i++) out.push(els[i].id + (els[i].hasAttribute('data-keep') ? ':keep' : ''));
    return out.join(',');
  }
  function eventKeys() {
    var out = {}, els = d.querySelectorAll('[data-key]');
    for (var i = 0; i < els.length; i++) out[els[i].getAttribute('data-key')] = 1;
    return out;
  }

  var busy = false, again = false;
  function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    var x = new XMLHttpRequest();
    x.open('GET', location.pathname + location.search, true);
    x.onload = function () {
      busy = false;
      if (x.status === 200) apply(x.responseText);
      if (again) { again = false; refresh(); }
    };
    x.onerror = function () { busy = false; };
    x.send();
  }

  function apply(html) {
    var fresh;
    try { fresh = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return; }
    if (!fresh || !fresh.getElementById('tpHero')) return;
    /* A card that appeared or went away (a cancelled order loses its money
       card) is a different page, not a changed one. */
    if (regionIds(fresh) !== regionIds(d)) { location.reload(); return; }

    var before = eventKeys();
    var els = d.querySelectorAll('[data-live]');
    for (var i = 0; i < els.length; i++) {
      var n = fresh.getElementById(els[i].id);
      if (!n) continue;
      els[i].className = n.className;
      els[i].innerHTML = n.innerHTML;
    }
    d.title = fresh.title;
    times();

    var rows = d.querySelectorAll('[data-key]'), first = null;
    for (var j = 0; j < rows.length; j++) {
      if (before[rows[j].getAttribute('data-key')]) continue;
      rows[j].className += ' is-new';
      if (!first) first = rows[j];
    }
    if (first) {
      var b = first.querySelector('b');
      banner(b ? b.textContent : (L.updated || ''), true);
    }
  }

  var es = null, poll = null, hellos = 0;
  function startPoll() {
    live('poll');
    if (!poll) poll = setInterval(refresh, 45000);
  }
  function connect() {
    if (!C.live) return;
    if (!window.EventSource) { startPoll(); return; }
    live('wait');
    es = new EventSource(C.base + '/live');
    es.addEventListener('hello', function () {
      live('on');
      /* Back after a drop: catch up on whatever moved while it was away. */
      if (hellos++ > 0) refresh();
    });
    es.addEventListener('change', refresh);
    es.onerror = function () {
      if (es && es.readyState === 2) { es = null; startPoll(); return; }
      live(navigator.onLine === false ? 'offline' : 'wait');
    };
  }
  connect();
  if (C.live) {
    d.addEventListener('visibilitychange', function () { if (!d.hidden) refresh(); });
    window.addEventListener('online', refresh);
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.og === 'push') refresh();
      });
    }
  }

  /* ----------------------------------------------------------- review
     Stars, tags, words, permission, send. The server decides everything that
     matters (lib/reviews.js); this only collects and posts, then reloads so
     the thank-you card is the server's own. */
  var rv = $('tpReview');
  if (rv) {
    rv.hidden = false;
    var form = $('tpRvForm');
    var word = $('tpRvWord');
    var rvText = $('tpRvText');
    var WORDS = [];
    try { WORDS = JSON.parse(word.getAttribute('data-words')) || []; } catch (e) {}
    var paintStars = function (n, pop) {
      form.setAttribute('data-rating', String(n));
      var stars = form.querySelectorAll('[data-rv-star]');
      for (var i = 0; i < stars.length; i++) {
        stars[i].className = 'rv-star' + (i < n ? ' on' : '') + (i < n && pop ? ' pop' : '');
      }
      word.textContent = n ? (WORDS[n - 1] || '') : (word.getAttribute('data-pick') || '');
      $('tpRvSend').disabled = !n;
    };
    rv.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-rv-star],[data-rv-tag],[data-rv-edit]') : null;
      if (!t) return;
      if (t.hasAttribute('data-rv-star')) {
        paintStars(Number(t.getAttribute('data-rv-star')), true);
        buzz(12);
      } else if (t.hasAttribute('data-rv-tag')) {
        var on = !/(^|\s)on(\s|$)/.test(t.className);
        t.className = 'rv-tag' + (on ? ' on' : '');
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
      } else {
        var shown = $('tpRvShown');
        if (shown) shown.hidden = true;
        form.hidden = false;
      }
    });
    if (rvText && $('tpRvCount')) {
      rvText.addEventListener('input', function () { $('tpRvCount').textContent = rvText.value.length + '/600'; });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Number(form.getAttribute('data-rating')) || 0;
      if (!n) { banner(L.rvPickFirst); return; }
      var tags = [], chips = form.querySelectorAll('[data-rv-tag]');
      for (var i = 0; i < chips.length; i++) {
        if (/(^|\s)on(\s|$)/.test(chips[i].className)) tags.push(chips[i].getAttribute('data-rv-tag'));
      }
      var btn = $('tpRvSend'), label = btn.querySelector('span'), was = label.textContent;
      btn.disabled = true;
      label.textContent = L.rvSending || was;
      var fail = function () { btn.disabled = false; label.textContent = was; banner(L.rvErr); };
      var x = new XMLHttpRequest();
      x.open('POST', C.base + '/review', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) { fail(); return; }
        try { sessionStorage.setItem('og.rv.sent', '1'); } catch (y) {}
        location.reload();
      };
      x.onerror = fail;
      x.send(JSON.stringify({
        rating: n, tags: tags, comment: rvText ? rvText.value : '',
        allowWeb: !!($('tpRvAllow') && $('tpRvAllow').checked), lang: C.lang
      }));
    });
    var justSent = false;
    try { justSent = !!sessionStorage.getItem('og.rv.sent'); sessionStorage.removeItem('og.rv.sent'); } catch (e) {}
    if (justSent) {
      rv.className += ' is-sent';
      chime();
      setTimeout(function () { rv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
    } else if (location.hash === '#review') {
      setTimeout(function () { rv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 400);
    }
  }

  /* ------------------------------------------------------- notify me */
  var card = $('tpNotify');
  if (!card || !C.push || !C.key) return;
  var ICON = C.icons || {};

  function supported() {
    return !!(window.isSecureContext !== false && 'serviceWorker' in navigator &&
      'PushManager' in window && 'Notification' in window);
  }

  function head(icon, title, sub) {
    return '<div class="n-head"><span class="n-ico">' + (icon || '') + '</span><div>' +
      '<p class="n-t">' + esc(title) + '</p><p class="n-s">' + esc(sub) + '</p></div></div>';
  }

  /* What a notification from this shop looks like arriving on a phone: the
     mark, the shop, one line, "now" — dropping in from the top. */
  function toast() {
    return '<div class="g-note"><img src="/assets/logo.svg" alt=""><div><b>' + esc(C.shop || '') + '</b><span>' +
      esc(L.pvMsg) + '</span></div><em>' + esc(L.justNow) + '</em></div>';
  }
  function demo() {
    return '<div class="g-demo" aria-hidden="true"><div class="g-ph"><i class="g-isl"></i>' + toast() +
      '<span class="g-clock" dir="ltr">9:41</span></div></div>';
  }
  function whereShare() {
    var k = shareKind();
    return k === 'bar' ? L.g1Bar : k === 'menu' ? L.g1Menu : k === 'pad' ? L.g1Pad : L.g1Safari;
  }
  function steps() {
    var row = function (n, icon, title, sub) {
      return '<li><span class="g-n">' + n + '</span><div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div>' +
        '<span class="g-k">' + (icon || '') + '</span></li>';
    };
    return '<ol class="g-steps">' + row(1, ICON.share, L.g1, whereShare()) + row(2, ICON.plus, L.g2, L.g2s) +
      row(3, ICON.bell, L.g3, fill(L.g3s)) + '</ol>';
  }

  /* Chrome and Edge on Android and on a laptop offer the install themselves;
     the page only has to ask at the right moment — a tap on this button. */
  var installEvt = null, cur = 'off';
  function installBtn() {
    return installEvt ? '<button type="button" class="btn btn-g" data-tp="install">' + (ICON.plus || '') +
      '<span>' + esc(L.inst) + '</span></button>' : '';
  }

  function paint(state) {
    var h;
    cur = state;
    if (state === 'on') {
      nativeTop = isIos() && isHome();
      h = head(ICON.check, L.nOnT, L.nOnS) + '<button type="button" class="btn btn-g" data-tp="off">' + esc(L.nOff) + '</button>' + installBtn();
    } else if (state === 'busy') {
      h = head(ICON.bell, L.nOffT, L.nOffS) + '<button type="button" class="btn btn-p" disabled><i class="spin"></i><span>' + esc(L.nBusy) + '</span></button>';
    } else if (state === 'blocked') {
      h = head(ICON.bellOff, L.nBlockedT, L.nBlockedS);
    } else if (state === 'ios') {
      h = head(ICON.phone, L.gT, L.gS) + demo() + steps() +
        (shareKind() === 'safari' ? '<p class="g-tip">' + (ICON.compass || '') + '<span>' + esc(L.gWa) + '</span></p>' : '') +
        '<button type="button" class="btn btn-p" data-tp="guide">' + (ICON.phone || '') + '<span>' + esc(L.gShow) + '</span></button>';
    } else if (state === 'inapp') {
      h = head(ICON.compass, L.gInT, L.gInS) +
        '<button type="button" class="btn btn-p" data-tp="copy">' + (ICON.copy || '') + '<span>' + esc(L.gCopy) + '</span></button>';
    } else if (state === 'old') {
      h = head(ICON.bellOff, L.gOldT, L.gOldS);
    } else if (state === 'ready') {
      /* Just opened from the Home Screen: the part that was hard is done. */
      h = head(ICON.check, L.rdT, L.rdS) + demo() +
        '<button type="button" class="btn btn-p" data-tp="on">' + (ICON.bell || '') + '<span>' + esc(L.nOn) + '</span></button>';
    } else if (state === 'nosup') {
      h = head(ICON.bellOff, L.nNoT, L.nNoS) + installBtn();
    } else {
      nativeTop = false;
      h = head(ICON.bell, L.nOffT, state === 'err' ? L.nErr : L.nOffS) +
        '<button type="button" class="btn btn-p" data-tp="on">' + (ICON.bell || '') + '<span>' + esc(L.nOn) + '</span></button>' + installBtn();
    }
    card.innerHTML = h;
    card.setAttribute('data-state', state);
    card.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvt = e;
    if (cur !== 'busy') paint(cur);
  });
  window.addEventListener('appinstalled', function () {
    installEvt = null;
    if (cur !== 'busy') paint(cur);
  });
  function install() {
    var ev = installEvt;
    if (!ev) return;
    installEvt = null;
    try { ev.prompt(); } catch (e) {}
    var after = function () { if (cur !== 'busy') paint(cur); };
    if (ev.userChoice && ev.userChoice.then) ev.userChoice.then(after, after); else after();
  }

  function copyLink(btn) {
    var url = location.href.split('#')[0];
    var done = function () {
      btn.innerHTML = (ICON.check || '') + '<span>' + esc(L.gCopied) + '</span>';
      buzz(15);
    };
    var legacy = function () {
      var ta = d.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      d.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, url.length); d.execCommand('copy'); } catch (e) {}
      d.body.removeChild(ta);
      done();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, legacy); return; }
    } catch (e) {}
    legacy();
  }

  /* ---- the walk-through: three slides, the phone drawn at each tap */
  var sheet = null, gi = 0, opener = null;
  function art(i) {
    var page = '<div class="m-page"><i class="l"></i><i></i><i class="s"></i><i></i><i class="s"></i><i></i></div>';
    if (i === 0) {
      return '<div class="m-ph"><i class="m-isl"></i>' + page +
        '<div class="m-bar"><div class="m-url" dir="ltr">' + esc(location.host) + '</div><div class="m-tools">' +
        '<span><i></i></span><span><i></i></span><span class="hot">' + (ICON.share || '') + '</span><span><i></i></span><span><i></i></span>' +
        '</div></div></div>';
    }
    if (i === 1) {
      return '<div class="m-ph"><i class="m-isl"></i>' + page + '<div class="m-dim"></div><div class="m-sheet">' +
        '<div class="m-apps"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="m-row"><i></i>' + (ICON.copy || '') + '</div>' +
        '<div class="m-row"><i></i>' + (ICON.share || '') + '</div>' +
        '<div class="m-row hot"><span>' + esc(L.homeRow) + '</span>' + (ICON.plus || '') + '</div>' +
        '</div></div>';
    }
    var apps = '';
    for (var n = 0; n < 11; n++) {
      apps += n === 5 ? '<span class="m-app"><img src="/assets/logo.svg" alt=""></span>' : '<i></i>';
    }
    return '<div class="m-ph"><i class="m-isl"></i><div class="m-home"><div class="m-grid">' + apps + '</div></div>' + toast() + '</div>';
  }
  function paintGuide() {
    var T = [[L.g1, whereShare()], [L.g2, L.g2s], [L.g3, fill(L.g3s)]];
    var dots = '';
    for (var i = 0; i < 3; i++) dots += '<i class="' + (i === gi ? 'on' : '') + '"></i>';
    sheet.querySelector('.sh-in').innerHTML =
      '<div class="sh-stage" aria-hidden="true">' + art(gi) + '</div>' +
      '<p class="sh-k">' + esc(fill(L.gStep, { n: gi + 1, of: 3 })) + '</p>' +
      '<h3 class="sh-h" id="tpGuideH">' + esc(T[gi][0]) + '</h3>' +
      '<p class="sh-p">' + esc(T[gi][1]) + '</p>' +
      (gi === 0 && shareKind() === 'safari' ? '<p class="sh-here">' + (ICON.down || '') + '<span>' + esc(L.gHere) + '</span></p>' : '') +
      '<div class="sh-dots">' + dots + '</div>' +
      '<div class="sh-nav">' + (gi ? '<button type="button" class="btn btn-g" data-g="back">' + esc(L.gBack) + '</button>' : '') +
      '<button type="button" class="btn btn-p" data-g="next">' + esc(gi >= 2 ? L.gDone : L.gNext) + '</button></div>';
  }
  function closeGuide() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (opener && opener.focus) { try { opener.focus(); } catch (e) {} }
  }
  function openGuide(from) {
    opener = from || null;
    gi = 0;
    if (!sheet) {
      sheet = d.createElement('div');
      sheet.className = 'sheet';
      sheet.id = 'tpGuide';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-labelledby', 'tpGuideH');
      sheet.innerHTML = '<div class="sh-box"><i class="sh-grab"></i>' +
        '<button type="button" class="sh-x" data-g="x" aria-label="' + esc(L.gClose) + '">' + (ICON.x || '') + '</button>' +
        '<div class="sh-in"></div></div>';
      d.body.appendChild(sheet);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) { closeGuide(); return; }
        var b = e.target && e.target.closest ? e.target.closest('[data-g]') : null;
        if (!b) return;
        var a = b.getAttribute('data-g');
        if (a === 'x') closeGuide();
        else if (a === 'back') { if (gi > 0) { gi--; paintGuide(); } }
        else if (gi >= 2) closeGuide();
        else { gi++; paintGuide(); }
      });
      /* A swipe turns the page — towards the reading direction. */
      var x0 = null, y0 = null;
      sheet.addEventListener('touchstart', function (e) {
        var p = e.touches && e.touches[0];
        x0 = p ? p.clientX : null;
        y0 = p ? p.clientY : null;
      });
      /* Claimed while the finger moves sideways, or the browser takes the
         swipe as Back and the order page goes with it. */
      sheet.addEventListener('touchmove', function (e) {
        var p = e.touches && e.touches[0];
        if (x0 === null || !p || !e.cancelable) return;
        if (Math.abs(p.clientX - x0) > Math.abs(p.clientY - y0)) e.preventDefault();
      }, { passive: false });
      sheet.addEventListener('touchend', function (e) {
        if (x0 === null || !e.changedTouches || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) < 50) return;
        var forward = C.lang === 'ar' ? dx > 0 : dx < 0;
        if (forward && gi < 2) gi++;
        else if (!forward && gi > 0) gi--;
        else return;
        paintGuide();
      });
      d.addEventListener('keydown', function (e) {
        if (sheet && !sheet.hidden && (e.key === 'Escape' || e.keyCode === 27)) closeGuide();
      });
    }
    sheet.hidden = false;
    paintGuide();
    var nb = sheet.querySelector('[data-g=next]');
    if (nb && nb.focus) { try { nb.focus({ preventScroll: true }); } catch (e) { nb.focus(); } }
  }

  function bytes(b64) {
    var pad = new Array((4 - b64.length % 4) % 4 + 1).join('=');
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  /* A subscription made with a key this server no longer holds (a laptop
     restored from the cloud minted a new one) can never be delivered to. */
  function sameKey(sub) {
    try {
      var k = sub.options && sub.options.applicationServerKey;
      if (!k) return true;
      var a = new Uint8Array(k), b = bytes(C.key);
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    } catch (e) { return true; }
  }

  function send(action, sub) {
    return new Promise(function (resolve, reject) {
      var s = sub && sub.toJSON ? sub.toJSON() : {};
      var x = new XMLHttpRequest();
      x.open('POST', C.base + '/push', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(j); else reject(j);
      };
      x.onerror = function () { reject(null); };
      x.send(JSON.stringify({ action: action, endpoint: s.endpoint, keys: s.keys, lang: C.lang }));
    });
  }

  function registration() {
    return navigator.serviceWorker.register('/i/sw.js', { scope: '/i/' }).then(function (reg) {
      if (reg.active) return reg;
      return new Promise(function (resolve) {
        var w = reg.installing || reg.waiting;
        if (!w) { resolve(reg); return; }
        w.addEventListener('statechange', function () { if (w.state === 'activated') resolve(reg); });
      });
    });
  }

  function ask() {
    return new Promise(function (resolve) {
      var r = Notification.requestPermission(function (p) { resolve(p); });
      if (r && r.then) r.then(resolve);
    });
  }

  function turnOn() {
    paint('busy');
    ask().then(function (p) {
      if (p !== 'granted') { paint(p === 'denied' ? 'blocked' : 'off'); throw 'stop'; }
      return registration();
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && !sameKey(sub)) return sub.unsubscribe().then(function () { return null; });
        return sub;
      }).then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(C.key) });
      });
    }).then(function (sub) {
      return send('follow', sub);
    }).then(function (r) {
      paint(r && r.on ? 'on' : 'err');
    })['catch'](function (e) {
      if (e !== 'stop') paint('err');
    });
  }

  function turnOff() {
    paint('busy');
    navigator.serviceWorker.getRegistration('/i/').then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      return sub ? send('unfollow', sub) : null;
    }).then(function () { paint('off'); })['catch'](function () { paint('off'); });
  }

  card.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tp]') : null;
    if (!t) return;
    var a = t.getAttribute('data-tp');
    if (a === 'on') turnOn();
    else if (a === 'off') turnOff();
    else if (a === 'guide') openGuide(t);
    else if (a === 'copy') copyLink(t);
    else if (a === 'install') install();
  });

  if (!supported()) {
    var old = iosVersion() > 0 && iosVersion() < 1604;
    if (!isIos()) paint('nosup');
    else if (isHome()) paint(old ? 'old' : 'nosup');
    else paint(inAppBrowser() ? 'inapp' : old ? 'old' : 'ios');
    return;
  }
  if (Notification.permission === 'denied') { paint('blocked'); return; }
  paint(isIos() && isHome() && Notification.permission === 'default' ? 'ready' : 'off');
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.getRegistration('/i/').then(function (reg) {
    return reg ? reg.pushManager.getSubscription() : null;
  }).then(function (sub) {
    if (!sub) return null;
    return send('state', sub).then(function (r) { if (r && r.on) paint('on'); });
  })['catch'](function () {});
})();`;
