/* ==========================================================================
   OG SYSTEM — control panel  ·  the window
   --------------------------------------------------------------------------
   One EventSource in, one POST out. This file holds NO opinion of its own
   about the shop: every frame replaces the state and the screen is redrawn
   from it, so the window can be closed, reopened or dropped off the wifi and
   what it shows is still whatever the panel process actually knows.

   Three screens, one variable. The window opens on SHOP every single time —
   the last screen is deliberately NOT remembered, because the one morning
   somebody opened the log out of curiosity would otherwise become every
   morning after it, and a terminal at eight in the morning is the thing this
   whole screen exists to stop happening.

   The words come from ui/i18n.js, never from the server. Steps, notices and
   refusals all arrive as a CODE and its values; the sentence is written here,
   in the language this machine is set to. That is server/lib/alerts.js's rule
   and it is why the same shop reads correctly in Arabic.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = window.OG_KEY;
  var t = PI18N.t;

  var state = {
    server: 'stopped', ready: null, mirror: null, job: null,
    swCache: null, stale: false, steps: [], who: null
  };
  var JOBS = {};
  var view = 'shop';
  var booted = false;      // has a first paint happened
  var live = true;         // is the stream connected
  var outroPlayed = false; // the shop coming up is a moment; a reconnect is not
  var fading = false;      // the step list is on its way out
  var copiedUrl = null;

  function $(id) { return document.getElementById(id); }
  var out = $('out');

  /* ------------------------------------------------------------ the line */

  function send(action, args) {
    return fetch('/act?k=' + KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OG-Key': KEY },
      body: JSON.stringify({ action: action, args: args || {} })
    }).catch(function () { /* the panel process is gone; the stream says so */ });
  }

  var es = new EventSource('/events?k=' + KEY);

  es.addEventListener('hello', function (e) {
    var d = JSON.parse(e.data);
    JOBS = d.jobs || {};
    state = d.state;
    live = true;
    /* A reconnect replays the whole ring, so the pane is emptied first rather
       than printed twice. */
    out.textContent = '';
    (d.lines || []).forEach(addLine);
    /* Arriving at a shop that is ALREADY open is not a boot. The finish is
       something that happens when the shop comes up under this window's eye;
       on a reconnect there is nothing to animate and nothing to celebrate. */
    if (state.server === 'running') { outroPlayed = true; fading = false; }
    booted = true;
    draw();
    stick();
  });

  es.addEventListener('state', function (e) { state = JSON.parse(e.data); draw(); });

  es.addEventListener('steps', function (e) {
    state.steps = JSON.parse(e.data);
    /* A fresh sequence. The finish becomes a thing that can happen again, and
       a list that was fading out stops fading and starts over. */
    outroPlayed = false;
    fading = false;
    draw();
  });

  es.addEventListener('step', function (e) {
    var row = JSON.parse(e.data), i;
    for (i = 0; i < state.steps.length; i++) {
      if (state.steps[i].id === row.id) { state.steps[i] = row; break; }
    }
    draw();
  });

  es.addEventListener('line', function (e) { addLine(JSON.parse(e.data)); stick(); });
  es.addEventListener('clear', function () { out.textContent = ''; });

  es.addEventListener('job', function (e) {
    var d = JSON.parse(e.data);
    state.job = { name: d.name, label: d.label, step: d.step, of: d.of };
    draw();
  });

  es.addEventListener('done', function (e) {
    var d = JSON.parse(e.data);
    var label = d.label || d.name;
    if (d.code) toast('err', t('jobStopped', { label: label }), t('showLog'), function () { go('log'); });
    else toast('ok', t('jobDone', { label: label }));
  });

  /* A REFUSAL HAS TO REACH SOMEBODY WHO IS NOT READING THE LOG. POST /act
     answers before the action runs, so until the panel began pushing these
     the only trace of "that button did nothing, and here is why" was a red
     line in a pane this window no longer opens on. */
  es.addEventListener('refused', function (e) {
    var d = JSON.parse(e.data);
    toast('warn', t('r_' + d.code, d));
  });

  es.onerror = function () { live = false; if (booted) paintBar(); };
  es.onopen = function () { live = true; if (booted) paintBar(); };

  /* -------------------------------------------------------- the terminal */

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function addLine(l) {
    var el = document.createElement('span');
    el.className = 'l ' + (l.stream === 'out' ? '' : l.stream);
    /* The clock has been arriving on every frame since this pipe was written
       and was thrown away every time. A log is only ever read after the fact,
       and then WHEN a line happened is half of what it says. */
    if (l.at) {
      var d = new Date(l.at);
      var ts = document.createElement('span');
      ts.className = 't';
      ts.textContent = two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '  ';
      el.appendChild(ts);
    }
    el.appendChild(document.createTextNode(l.text));
    out.appendChild(el);
    while (out.childNodes.length > 3000) out.removeChild(out.firstChild);
  }

  function stick() {
    if (!$('follow').checked) return;
    out.scrollTop = out.scrollHeight;
  }

  /* --------------------------------------------------------- the plumbing */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* EVERY NUMBER, ADDRESS AND CODE IS ISOLATED. Arabic bidi otherwise drags a
     leading digit or a sign to the far end of the line: "1 USD = 130 SYP"
     comes out "USD = 130 SYP 1", and "+2" comes out "2+". The shop learned
     that twice — in Settings and again in the movement log — and this is the
     one helper that stops it being learned a third time. */
  function ltr(s) { return '<span dir="ltr">' + esc(s) + '</span>'; }

  /* A sentence built from a template, where the VALUES are already HTML.
     The template is escaped first; {name} survives that untouched, so a
     placeholder can be filled with an isolated number without the sentence
     around it being able to inject anything. */
  function tHtml(key, parts) {
    return esc(t(key)).replace(/\{(\w+)\}/g, function (m, k) {
      return parts && parts[k] !== undefined && parts[k] !== null ? parts[k] : '';
    });
  }

  function clock(ms) {
    var d = new Date(ms);
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function ago(iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    return Math.round(s / 3600) + 'h';
  }

  function listOf(v) {
    var a = Object.prototype.toString.call(v) === '[object Array]' ? v : [v];
    return a.join(PI18N.isRTL() ? '، ' : ', ');
  }

  /* ----------------------------------------------------------- the icons */

  /* Drawn here rather than pulled from a set, for the same reason the server
     has no dependencies: one more thing to install is one more thing that can
     be missing on the shop's laptop. */
  var ICONS = {
    tick:  '<path d="m4 12.5 5 5L20 6.5"/>',
    warn:  '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
    cross: '<path d="M17 7 7 17"/><path d="m7 7 10 10"/>',
    dash:  '<path d="M6 12h12"/>',
    dot:   '<circle cx="12" cy="12" r="3.2"/>',
    spin:  '<path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5"/>',
    arrow: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
    info:  '<circle cx="12" cy="12" r="9.5"/><path d="M12 11.5v5"/><path d="M12 8h.01"/>'
  };

  /* An arrow is a glyph that POINTS somewhere, so it turns with the language;
     a tick and a cross mean the same thing in both. Marked here rather than
     mirrored by selector, so a future icon inside a button does not get
     flipped for being in the wrong place. */
  function svg(name) {
    return '<svg viewBox="0 0 24 24"' + (name === 'arrow' ? ' class="ic-dir"' : '') + '>' + ICONS[name] + '</svg>';
  }

  /* ============================================================== the paint */

  function draw() {
    if (!booted) return;
    paintBar();
    if (view === 'shop') paintShop();
    if (view === 'tools') paintTools();
    if (view === 'log') paintLog();
    paintWho();
  }

  var LAMP = {
    stopped: ['', 'lampShut'],
    starting: ['busy', 'lampOpening'],
    running: ['on', 'lampOpen'],
    stopping: ['busy', 'lampClosing']
  };

  function paintBar() {
    var s = state.server;
    var l = LAMP[s] || LAMP.stopped;
    var cls = l[0], key = l[1];
    /* A shop that stopped because something went wrong is not the same lamp
       as a shop somebody closed on purpose, and that difference is most of
       the point of this screen. */
    if (s === 'stopped' && foreign()) { cls = 'on'; key = 'lampOpen'; }
    else if (s === 'stopped' && failedStep()) { cls = 'bad'; key = died() ? 'lampDied' : 'lampFailed'; }
    if (!live) { cls = 'busy'; key = 'lampWaiting'; }

    $('lamp').className = 'lamp ' + cls;
    $('lampText').textContent = t(key);

    $('bLang').textContent = t('lang');
    $('bLang').title = t('langTip');
    $('bTools').title = t('toolsTip');
    $('tBack').textContent = t('back');
    $('lBack').textContent = t('back');
    $('tTitle').textContent = t('tools');
    $('lTitle').textContent = t('log');
    $('lFollow').textContent = t('follow');
    $('lClear').textContent = t('clear');
    $('lQuit').textContent = t('quit');
    $('bShowLog').textContent = t('showLog');
  }

  function foreign() { return !!(state.ready && state.ready.foreign); }
  function isRunning() { return state.server === 'running' || foreign(); }

  function failedStep() {
    for (var i = 0; i < state.steps.length; i++) if (state.steps[i].state === 'fail') return state.steps[i];
    return null;
  }

  /* A shop that opened and then fell over is NOT a shop that failed to open,
     and the two want different next actions from whoever is standing there.
     `server_died` is the panel saying "it was answering a moment ago". */
  function died() {
    var f = failedStep();
    return !!(f && f.detail && f.detail.code === 'server_died');
  }

  /* ------------------------------------------------------------- the shop */

  function paintShop() {
    var running = isRunning();
    var fail = failedStep();
    var title, sub;

    if (state.server === 'starting') { title = t('shopOpening'); sub = ''; }
    else if (state.server === 'stopping') { title = t('shopClosing'); sub = ''; }
    else if (foreign()) { title = t('shopElsewhere'); sub = esc(t('shopElsewhereSub')); }
    else if (running) { title = t('shopOpen'); sub = shopSub(); }
    else if (fail) { title = t(died() ? 'itDied' : 'itFailed'); sub = stepWhy(fail); }
    else { title = t('shopShut'); sub = ''; }

    $('hTitle').textContent = title;
    $('hSub').innerHTML = sub;

    paintRing(running);
    paintActs(running, fail);
    paintSteps(running);
    paintVerdict(running);
    paintAddrs(running);
    paintNotices(running);
    paintCloud(running);
  }

  function shopSub() {
    var r = state.ready || {};
    var bits = [];
    if (r.shop) bits.push(esc(r.shop));
    if (r.accounts === 0) bits.push(esc(t('noAccountsYet')));
    else if (r.accounts === 1) bits.push(esc(t('accounts1')));
    else if (r.accounts > 1) bits.push(tHtml('accountsN', { n: ltr(r.accounts) }));
    return bits.join('  ·  ');
  }

  /* The ring is the count of steps that have actually finished. It is real,
     not a timer: a step that takes forty seconds leaves the ring exactly
     where it is, which is honest, and is also the useful thing to show —
     that IS what is happening. */
  function paintRing(running) {
    var total = state.steps.length || 1;
    var done = 0, i;
    for (i = 0; i < state.steps.length; i++) {
      var st = state.steps[i].state;
      if (st === 'ok' || st === 'warn' || st === 'fail' || st === 'skip') done++;
    }
    var frac = running ? 1 : done / total;
    var C = 339;
    $('arc').style.strokeDashoffset = String(Math.round(C - C * frac));

    var stage = $('stage');
    if (running && !outroPlayed) {
      outroPlayed = true;
      stage.classList.add('done');
      window.setTimeout(function () { stage.classList.remove('done'); }, 1300);
    }
    if (!running) stage.classList.remove('done');
  }

  function paintActs(running, fail) {
    if (state.server === 'starting' || state.server === 'stopping') { $('acts').innerHTML = ''; return; }
    var h = '';
    if (running) {
      /* The lime button is what somebody actually came here to do at eight in
         the morning. Closing the till is not, so it is quiet, and it is
         nowhere near the thumb. */
      h += '<button class="btn btn-primary btn-lg" data-do="openshop">' + esc(t('openBrowser')) + svg('arrow') + '</button>';
      h += '<button class="quiet" data-do="askstop"' + (foreign() ? ' disabled' : '') + '>' + esc(t('stopShop')) + '</button>';
    } else if (fail) {
      /* No second "Show the technical log" here: the foot of this screen
         already carries one, a few lines below, and offering the same door
         twice in one column reads as two different doors. */
      h += '<button class="btn btn-primary btn-lg" data-do="start">' + esc(t('tryAgain')) + '</button>';
    } else {
      h += '<button class="btn btn-primary btn-lg" data-do="start">' + esc(t('startShop')) + '</button>';
    }
    $('acts').innerHTML = h;
  }

  var STEP_ICON = { ok: 'tick', warn: 'warn', fail: 'cross', skip: 'dash', run: 'spin', wait: 'dot' };

  function paintSteps(running) {
    var box = $('steps');
    /* The list IS the boot. Once the shop is open it has said everything it
       had to say, and anything amber on it has already become a notice card
       below — so it leaves, rather than sitting there for the rest of the day
       as an inventory of a moment that has passed. It leaves by fading, not
       by vanishing: something that disappears under the eye reads as a fault. */
    var want = !running && state.steps.length > 0 &&
      (state.server === 'starting' || !!failedStep());

    if (!want && running && !box.hidden && !fading) {
      fading = true;
      box.classList.add('gone');
      window.setTimeout(function () {
        if (!fading) return;
        fading = false;
        box.hidden = true;
        box.classList.remove('gone');
      }, 500);
      return;
    }
    if (fading) return;

    box.hidden = !want;
    box.classList.remove('gone');
    if (!want) return;

    var h = '', i;
    for (i = 0; i < state.steps.length; i++) {
      var s = state.steps[i];
      h += '<div class="step ' + s.state + '">' +
        '<span class="ic">' + svg(STEP_ICON[s.state] || 'dot') + '</span>' +
        '<span>' + esc(t('st_' + s.id)) + '</span>' +
        '<span class="why">' + stepWhy(s) + '</span>' +
        '</div>';
    }
    box.innerHTML = h;
  }

  /* A step's sentence, written here from its code. Nothing ever arrives
     already composed, which is what lets the same step read in Arabic. */
  function stepWhy(s) {
    if (!s || !s.detail) return '';
    var d = s.detail, c = d.code;
    if (c === 'checked_at') return tHtml('d_checked_at', { time: ltr(clock(d.at)) });
    if (c === 'port_held') return tHtml('d_port_held', { port: ltr(d.port) });
    if (c === 'preflight_exit' || c === 'printers_exit') return tHtml('d_' + c, { exit: ltr(d.exit) });
    if (c === 'server_died') {
      return d.signal ? tHtml('d_server_signal', { signal: ltr(d.signal) })
        : tHtml('d_server_died', { exit: ltr(d.exit == null ? '?' : d.exit) });
    }
    if (c === 'server_spawn') return tHtml('d_server_spawn', { why: esc(d.why || '') });
    if (c === 'cloud_refused') return tHtml('d_cloud_refused', { by: esc(d.by || '?') });
    if (c === 'cloud_live') {
      if (d.pulled) return esc(t('d_cloud_pulled'));
      if (d.behind) return tHtml('d_cloud_live_behind', { n: ltr(d.behind) });
      return esc(t('d_cloud_live'));
    }
    if (c === 'open_here' || c === 'open_foreign') return esc(d.shop || '');
    return esc(t('d_' + c));
  }

  function paintVerdict(running) {
    var box = $('verdict');
    /* A SHOP THIS WINDOW DID NOT OPEN HAS NOT BEEN CHECKED BY IT. None of the
       morning checks ran, and a foreign shop's ready line carries no notices,
       so "Everything is ready" here would be a clean bill of health signed on
       no evidence at all — which is the one thing this screen must never do.
       The headline already says whose shop it is; that is enough. */
    if (!running || foreign()) { box.hidden = true; return; }
    var list = allNotices();
    var bad = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].level !== 'info') bad++;

    box.hidden = false;
    if (!bad) {
      box.className = 'verdict ok';
      box.innerHTML = svg('tick') + '<span>' + esc(t('allWell')) + '</span>';
    } else {
      box.className = 'verdict warn';
      box.innerHTML = svg('warn') + '<span>' +
        (bad === 1 ? esc(t('someWarn1')) : tHtml('someWarn', { n: ltr(bad) })) + '</span>';
    }
  }

  /* ---------------------------------------------------------- the address */

  function paintAddrs(running) {
    var box = $('addrs');
    if (!running || !state.ready) { box.hidden = true; return; }
    var r = state.ready;
    var here = r.https || r.http;
    var lan = (r.lan || [])[0] || null;

    /* WHEN THERE IS A PUBLIC ADDRESS, IT IS THE ONLY ONE WORTH PRINTING.
       A shop reachable through the tunnel is reachable the same way from the
       counter, the office and the owner's phone at home, so the two local
       addresses stop being two useful facts and become a decision nobody
       should have to make. One address, one code, and the same one everybody
       is told.

       The local address stays as a HINT rather than a row, and it is not
       decoration: the tunnel needs the internet, the till does not. On a
       morning when the line is down, that dim line is the entire difference
       between a shop that opens and a panel that offers an address which
       times out. It is deliberately not given a Copy button — it is the
       answer to a bad day, not the address anyone should be handing out. */
    if (r.public) {
      var ph = '<div class="card">';
      ph += '<h3>' + esc(t('fromAnywhere')) + '</h3>';
      ph += addrRow(r.public);
      if (here) ph += '<p class="hint addr-hint">' + esc(t('localFallback')) + ': ' + ltr(here) + '</p>';
      ph += '</div>';

      var pqr = qrFor(r.public);
      box.className = 'addrs' + (pqr ? '' : ' solo');
      box.innerHTML = ph + pqr;
      box.hidden = false;
      return;
    }

    var h = '<div class="card">';
    h += '<h3>' + esc(t('onThisComputer')) + '</h3>';
    if (here) h += addrRow(here);
    /* The plain-HTTP address belongs HERE and nowhere else. `ready.http` is
       always http://localhost — this machine's own — so printing it under "on
       a phone" was offering a second device an address that resolves to
       itself. Both lines were true; the heading over the second one was not. */
    if (r.https && r.http) h += '<p class="hint addr-hint">' + esc(t('plainNoPadlock')) + ': ' + ltr(r.http) + '</p>';

    h += '<h3 style="margin-top:15px">' + esc(t('onAPhone')) + '</h3>';
    if (lan) h += addrRow(lan);
    else h += '<p class="hint">' + esc(t('noWifi')) + '</p>';
    h += '</div>';

    /* THE CODE IS FOR THE WIFI ADDRESS, NEVER localhost. A phone pointed at a
       QR of https://localhost:8443 opens the phone's own machine and finds
       nothing there, which reads as the shop being broken. With no wifi
       address there is nothing a phone could reach at all, and the card says
       so rather than drawing a code that cannot work. */
    var qr = lan ? qrFor(lan) : '';
    box.className = 'addrs' + (qr ? '' : ' solo');
    box.innerHTML = h + qr;
    box.hidden = false;
  }

  function addrRow(url) {
    return '<div class="addr">' +
      '<span class="url" dir="ltr">' + esc(url) + '</span>' +
      '<button class="cp' + (copiedUrl === url ? ' done' : '') + '" data-copy="' + esc(url) + '">' +
        esc(copiedUrl === url ? t('copied') : t('copy')) + '</button>' +
      '<button class="go" data-url="' + esc(url) + '" aria-label="' + esc(t('openBrowser')) + '">' + svg('arrow') + '</button>' +
      '</div>';
  }

  function qrFor(url) {
    if (typeof Codes === 'undefined' || !Codes.qrSVG) return '';
    var s;
    try {
      /* The default quiet zone (4 modules) is kept. The standard asks for it
         and the white card round the code is not a substitute — a code that
         will not scan is a bug, and the six pixels it would save are not. */
      s = Codes.qrSVG(url, {
        size: 118, dark: '#0A0A0B', light: '#FAFAFA', style: 'rounded',
        logo: '/ui/icon.png', logoRatio: 0.2
      });
    } catch (e) { return ''; }
    if (!s) return '';
    return '<div class="qrcard"><div class="paper">' + s + '</div>' +
      '<span class="cap">' + esc(t('pointCamera')) + '</span></div>';
  }

  /* ---------------------------------------------------------- the notices */

  var FIXES = {
    no_accounts: 'createuser',
    cert_address: 'cert',
    cert_expiring: 'cert',
    no_cert: 'cert',
    padlock_untrusted: 'certTrust',
    printers_person: 'hardware',
    preflight_exit: 'preflight'
  };

  var FIX_LABEL = {
    no_accounts: 'n_newAccount',
    cert_address: 'n_makeCert', cert_expiring: 'n_makeCert', no_cert: 'n_makeCert'
  };

  /* The server's own standing conditions, plus the two kinds this window is
     the only thing that knows: a step that went amber during the boot, and a
     shop running older code than the disk has. The step LIST disappears once
     the shop is open, so anything on it worth keeping has to survive here or
     it is lost the moment the shop opens. */
  function allNotices() {
    var list = [], i;
    var r = state.ready || {};

    if (state.stale) list.push({ code: 'stale', level: 'warn', args: {}, fix: 'refresh' });

    for (i = 0; i < state.steps.length; i++) {
      var s = state.steps[i];
      if (s.state !== 'warn' || !s.detail) continue;
      var c = s.detail.code;
      if (c === 'padlock_untrusted') list.push({ code: 'padlock_untrusted', level: 'warn', args: {} });
      else if (c === 'printers_person' || c === 'printers_exit') list.push({ code: 'printers_person', level: 'warn', args: {} });
      else if (c === 'preflight_exit') list.push({ code: 'preflight_exit', level: 'warn', args: {} });
    }

    var nts = r.notices || [];
    for (i = 0; i < nts.length; i++) {
      list.push({ code: nts[i].code, level: nts[i].level, args: nts[i].args || {} });
    }

    for (i = 0; i < list.length; i++) {
      if (list[i].fix === undefined) list[i].fix = FIXES[list[i].code] || null;
    }
    return list;
  }

  function paintNotices(running) {
    var box = $('notices');
    if (!running) { box.hidden = true; return; }
    var list = allNotices();
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }

    var h = '', i;
    for (i = 0; i < list.length; i++) {
      var n = list[i];
      var args = fmtArgs(n.args);
      h += '<div class="notice ' + (n.level === 'info' ? 'info' : '') + '">' +
        '<span class="ic">' + svg(n.level === 'info' ? 'info' : 'warn') + '</span>' +
        '<span><b>' + tHtml('n_' + n.code, args) + '</b>' +
        '<small>' + tHtml('n_' + n.code + '_b', args) + '</small></span>' +
        '<span class="act">' + (n.fix ? fixButton(n) : '') + '</span>' +
        '</div>';
    }
    box.innerHTML = h;
    box.hidden = false;
  }

  /* Values going into a sentence: lists join with the right comma for the
     language, and anything with digits keeps its own direction. */
  function fmtArgs(a) {
    var o = {}, k;
    for (k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      var v = a[k];
      if (Object.prototype.toString.call(v) === '[object Array]') o[k] = ltr(listOf(v));
      else if (typeof v === 'number') o[k] = ltr(v);
      else o[k] = esc(v);
    }
    return o;
  }

  function fixButton(n) {
    if (n.fix === 'refresh') {
      return '<button class="btn btn-sm btn-hot" data-do="refresh">' + esc(t('n_restartNow')) + '</button>';
    }
    if (!JOBS[n.fix]) return '';
    var label = t(FIX_LABEL[n.code] || 'n_fix');
    return '<button class="btn btn-sm btn-ghost" data-job="' + esc(n.fix) + '"' +
      (state.job ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }

  /* ------------------------------------------------------------ the cloud */

  var MODE = {
    off: ['', 'cloudOff'], starting: ['warn', 'cloudStarting'], live: ['ok', 'cloudLive'],
    offline: ['warn', 'cloudOffline'], refused: ['bad', 'cloudRefused']
  };

  function paintCloud(running) {
    var box = $('cloudline');
    var m = state.mirror;
    if (!running || !m) { box.hidden = true; return; }
    var mo = MODE[m.mode] || MODE.off;
    var h = '<span class="pip"></span><span class="what">' + esc(t('cloud')) + '</span>';

    if (!m.configured) h += '<span>' + esc(t('cloudNone')) + '</span>';
    else if (m.mode === 'refused') h += '<span>' + esc(t('cloudBelongs', { by: m.refusedBy || '?' })) + '</span>';
    else {
      var bits = [];
      if (m.behind) bits.push(tHtml('cloudWaiting', { n: ltr(m.behind) }));
      else bits.push(esc(t(mo[1])));
      if (m.lastOkAt) bits.push(tHtml('cloudPushed', { ago: ltr(ago(m.lastOkAt)) }));
      h += '<span>' + bits.join('  ·  ') + '</span>';
    }

    h += '<span class="spacer"></span>';
    if (m.mode === 'refused' && JOBS.takeShop) {
      h += '<button class="btn btn-sm btn-hot" data-job="takeShop">' + esc(JOBS.takeShop.label) + '</button>';
    } else if (m.configured && m.mode !== 'off') {
      h += '<button class="btn btn-sm btn-ghost" data-do="sync"' + (state.job ? ' disabled' : '') + '>' + esc(t('syncNow')) + '</button>';
    }

    box.className = 'cloudline ' + mo[0];
    box.innerHTML = h;
    box.hidden = false;
  }

  /* ============================================================== the tools */

  var GROUPS = ['shop', 'cloud', 'machine', 'dev'];

  function paintTools() {
    var h = '', gi, name;
    var open = state.server !== 'stopped';

    for (gi = 0; gi < GROUPS.length; gi++) {
      var g = GROUPS[gi];
      var rows = '';

      /* The panel's own two. They are not jobs, but somebody looking for
         "restart the shop" does not care which process happens to do it. */
      if (g === 'shop') {
        rows += toolRow(t('restartShop'), t('restartBlurb'),
          { act: 'restart', off: state.server === 'starting' || state.server === 'stopping' || !!state.job });
        rows += toolRow(t('hardRefresh'), t('hardRefreshBlurb'), { act: 'refresh', off: !!state.job });
      }

      for (name in JOBS) {
        if (!Object.prototype.hasOwnProperty.call(JOBS, name)) continue;
        var j = JOBS[name];
        if ((j.group || 'shop') !== g) continue;
        if (j.needs === 'message') continue;   /* it has its own row, with a box */

        /* The real rule, the one runJob enforces: a job that closes the shop
           AROUND itself is not blocked by the shop being open. The window
           used to grey those out — it was never sent `aroundShop` — so the
           mirror card had to draw its own un-greyed copy of the button to get
           round a restriction that did not exist. */
        var blocked = j.while === 'shut' && open && !j.aroundShop;
        var tags = '';
        if (j.while === 'shut' && !j.aroundShop) tags += '<span class="tag-pill">' + esc(t('needsShut')) + '</span>';
        if (j.aroundShop) tags += '<span class="tag-pill warn">' + esc(t('closesShop')) + '</span>';
        if (j.danger) tags += '<span class="tag-pill warn">' + ltr(j.danger) + '</span>';

        rows += toolRow(j.label, j.blurb,
          { job: name, off: blocked || !!state.job, danger: !!j.danger, tags: tags, key: name });
      }

      /* Publish keeps its message box: a commit nobody can read a year later
         is barely a commit. */
      if (g === 'dev' && JOBS.push) {
        rows += '<div class="pubrow">' +
          '<input class="in" id="msg" autocomplete="off" placeholder="' + esc(t('fMessage')) + '">' +
          '<button class="btn" data-job="push"' + (state.job ? ' disabled' : '') + '>' + esc(JOBS.push.label) + '</button>' +
          '</div>';
      }

      if (!rows) continue;
      h += '<section><h3 class="gh">' + esc(t('g_' + g)) + '</h3><div class="glist">' + rows + '</div></section>';
    }
    $('groups').innerHTML = h;
  }

  function toolRow(label, blurb, o) {
    var busy = !!(state.job && o.key && state.job.name === o.key);
    var right = o.tags || '';
    if (busy) {
      right = '<span class="tag-pill hot">' +
        (state.job.of ? tHtml('stepOf', { step: ltr(state.job.step), of: ltr(state.job.of) }) : esc(t('running'))) +
        '</span>';
    }
    return '<button class="tool' + (o.danger ? ' danger' : '') + (busy ? ' busy' : '') + '"' +
      (o.job ? ' data-job="' + esc(o.job) + '"' : ' data-do="' + esc(o.act) + '"') +
      (o.off && !busy ? ' disabled' : '') + '>' +
      '<span><b>' + esc(label) + '</b><small>' + esc(blurb) + '</small></span>' +
      '<span class="tags">' + right + '</span>' +
      '</button>';
  }

  /* ================================================================ the log */

  function paintLog() {
    $('lSw').innerHTML = state.swCache ? esc(t('sw')) + ': ' + ltr(state.swCache) : '';
  }

  /* ============================================================ the screens */

  function go(next) {
    view = next;
    $('scShop').hidden = next !== 'shop';
    $('scTools').hidden = next !== 'tools';
    $('scLog').hidden = next !== 'log';
    draw();
    if (next === 'log') stick();
  }

  /* ============================================================= the toasts */

  function toast(kind, text, actLabel, onAct) {
    var el = document.createElement('div');
    el.className = 'toast ' + kind;
    var b = document.createElement('b');
    b.textContent = text;
    el.appendChild(b);
    if (actLabel) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-ghost';
      btn.style.marginTop = '8px';
      btn.textContent = actLabel;
      btn.addEventListener('click', function () { onAct(); el.remove(); });
      el.appendChild(btn);
    }
    $('toasts').appendChild(el);
    window.setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      window.setTimeout(function () { el.remove(); }, 260);
    }, actLabel ? 9000 : 4500);
  }

  /* ============================================================== the asks */

  var lastFocus = null;

  function closeAsk() {
    $('ask').hidden = true;
    $('ask').innerHTML = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
    lastFocus = null;
  }

  function openAsk(html, after) {
    lastFocus = document.activeElement;
    var ask = $('ask');
    ask.innerHTML = '<div class="box">' + html + '</div>';
    ask.hidden = false;
    var box = ask.firstChild;
    if (after) after(box);
    var first = box.querySelector('input, select') || box.querySelector('button');
    if (first) first.focus();
  }

  /* THE TYPED WORD. Three of these can lose a day's work, and the word is all
     that stands between a mis-click and that. Enter submits now, which it
     never did: a dialog that will not take the key everybody presses is a
     dialog people learn to distrust. */
  function askDanger(name, job) {
    openAsk(
      '<h3>' + esc(job.label) + '</h3>' +
      '<p>' + esc(job.blurb) + '</p>' +
      '<div class="field">' +
      '<label>' + tHtml('typeToConfirm', { word: '<span class="word" dir="ltr">' + esc(job.danger) + '</span>' }) + '</label>' +
      '<input class="in" id="askWord" dir="ltr" autocomplete="off" spellcheck="false">' +
      '</div>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-danger doit" disabled>' + esc(t('runIt')) + '</button>' +
      '</div>',
      function (box) {
        var input = box.querySelector('#askWord');
        var goBtn = box.querySelector('.doit');
        function check() { goBtn.disabled = input.value.trim().toUpperCase() !== job.danger; }
        input.addEventListener('input', check);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !goBtn.disabled) { e.preventDefault(); goBtn.click(); }
        });
        goBtn.addEventListener('click', function () { closeAsk(); send('job', { name: name }); });
      }
    );
  }

  var ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner'];
  var ROLE_KEY = {
    manager: 'roleManager', cashier: 'roleCashier', warehouse: 'roleWarehouse',
    delivery: 'roleDelivery', partner: 'rolePartner'
  };

  function askAccount(name, job) {
    var opts = '', i;
    for (i = 0; i < ROLES.length; i++) {
      opts += '<option value="' + ROLES[i] + '"' + (ROLES[i] === 'cashier' ? ' selected' : '') + '>' +
        esc(t(ROLE_KEY[ROLES[i]])) + '</option>';
    }
    openAsk(
      '<h3>' + esc(t('newAccount')) + '</h3>' +
      '<p>' + esc(job.blurb) + '</p>' +
      '<div class="field"><label>' + esc(t('fUser')) + '</label><input class="in" id="aUser" dir="ltr" autocomplete="off"></div>' +
      '<div class="field"><label>' + esc(t('fName')) + '</label><input class="in" id="aName" autocomplete="off"></div>' +
      '<div class="field"><label>' + esc(t('fRole')) + '</label><select class="in" id="aRole">' + opts + '</select></div>' +
      '<div class="field"><label>' + esc(t('fPass')) + '</label><input class="in" id="aPass" type="password" dir="ltr" autocomplete="new-password"></div>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-primary doit">' + esc(t('create')) + '</button>' +
      '</div>',
      function (box) {
        function submit() {
          var u = box.querySelector('#aUser').value.trim();
          var p = box.querySelector('#aPass').value;
          if (!u) return void box.querySelector('#aUser').focus();
          if (!p) return void box.querySelector('#aPass').focus();
          closeAsk();
          send('job', {
            name: name, username: u,
            fullName: box.querySelector('#aName').value.trim() || u,
            role: box.querySelector('#aRole').value || 'cashier',
            password: p
          });
        }
        box.querySelector('.doit').addEventListener('click', submit);
        box.querySelector('#aPass').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
      }
    );
  }

  /* CLOSING THE TILL UNDER SOMEBODY'S HANDS IS A LOST SALE, NOT A RESTART.
     The panel cannot know this on its own — it holds a process, not a
     session — so it asks the shop, and the answer arrives up the pipe a
     moment later. The dialog opens at once and fills the names in when they
     come, rather than making anybody wait on a round trip.

     What it claims is exactly what it knows: who has the shop OPEN. Whether
     one of them is halfway through a sale is not something this server can
     answer, and the sentence does not pretend it is. */
  function askStop() {
    state.who = null;
    send('who');
    openAsk(
      '<h3>' + esc(t('stopTitle')) + '</h3>' +
      '<p id="whoLine">' + esc(t('stopBodyAsking')) + '</p>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-danger doit">' + esc(t('stopGo')) + '</button>' +
      '</div>',
      function (box) {
        box.querySelector('.doit').addEventListener('click', function () { closeAsk(); send('stop'); });
      }
    );
  }

  function paintWho() {
    var line = document.getElementById('whoLine');
    if (!line) return;
    var w = state.who;
    if (!w) return;
    var names = [], i;
    for (i = 0; i < (w.people || []).length; i++) if (w.people[i].name) names.push(w.people[i].name);
    if (!names.length) { line.textContent = t('stopBodyNobody'); return; }
    line.textContent = names.length === 1
      ? t('stopBodyWho', { who: names[0] })
      : t('stopBodyWho2', { who: listOf(names) });
  }

  function askQuit() {
    openAsk(
      '<h3>' + esc(t('quitTitle')) + '</h3>' +
      '<p>' + esc(t('quitBody')) + '</p>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-danger doit">' + esc(t('quitGo')) + '</button>' +
      '</div>',
      function (box) {
        box.querySelector('.doit').addEventListener('click', function () { closeAsk(); send('quit'); });
      }
    );
  }

  /* ============================================================== the clicks */

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-do],[data-job],[data-url],[data-ask],[data-go],[data-copy]') : null;
    if (!el) return;

    if (el.hasAttribute('data-ask')) {
      if (el.getAttribute('data-ask') === 'no') closeAsk();
      return;
    }

    if (el.hasAttribute('data-copy')) {
      var u = el.getAttribute('data-copy');
      try {
        navigator.clipboard.writeText(u).then(function () { copiedUrl = u; draw(); });
      } catch (err) { /* no clipboard here; the address is on screen anyway */ }
      return;
    }

    if (el.hasAttribute('data-url')) return void send('open', { url: el.getAttribute('data-url') });

    if (el.hasAttribute('data-go')) {
      var g = el.getAttribute('data-go');
      if (g === 'lang') return void setLang(PI18N.lang() === 'ar' ? 'en' : 'ar');
      return void go(g);
    }

    var act = el.getAttribute('data-do');
    if (act) {
      if (el.disabled) return;
      if (act === 'quit') return askQuit();
      if (act === 'askstop') return askStop();
      if (act === 'openshop') {
        var r = state.ready || {};
        return void send('open', { url: r.https || r.http });
      }
      return void send(act);
    }

    var name = el.getAttribute('data-job');
    var job = JOBS[name];
    if (!job || el.disabled) return;
    if (job.danger) return askDanger(name, job);
    if (job.needs === 'account') return askAccount(name, job);
    if (job.needs === 'message') {
      var box = $('msg');
      var msg = box ? box.value.trim() : '';
      if (!msg) { if (box) box.focus(); return; }
      box.value = '';
      return void send('job', { name: name, message: msg });
    }
    send('job', { name: name });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('ask').hidden) return closeAsk();
      if (view !== 'shop') return go('shop');
    }
    /* A modal that lets Tab wander behind it is a modal only in appearance. */
    if (e.key === 'Tab' && !$('ask').hidden) {
      var f = $('ask').querySelectorAll('input, select, button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  $('follow').addEventListener('change', stick);

  /* ============================================================ the language */

  function setLang(next) {
    PI18N.setLang(next);
    applyLang();
    draw();
  }

  function applyLang() {
    var rtl = PI18N.isRTL();
    document.documentElement.lang = rtl ? 'ar' : 'en';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.body.classList.toggle('rtl', rtl);
  }

  /* ================================================================== boot */

  applyLang();
  go('shop');

  /* "43s ago" is only true for a second. Repainted on a timer rather than
     recomputed every frame, because the mirror can sit perfectly still for an
     hour and nothing else would ever redraw that line. */
  window.setInterval(function () {
    if (view === 'shop' && isRunning()) paintCloud(true);
  }, 10000);
})();
