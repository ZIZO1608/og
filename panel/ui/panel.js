/* ==========================================================================
   OG SYSTEM — control panel  ·  the window
   --------------------------------------------------------------------------
   One EventSource in, one POST out. This file holds NO opinion of its own
   about the shop: every frame replaces the state and the screen is redrawn
   from it, so the window can be closed, reopened or dropped off the wifi and
   what it shows is still whatever the panel process actually knows.

   Two screens. The window opens on SHOP every single time, and for anybody
   without a developer's sign-in it is the only screen there is: open the
   shop, start or stop it, restart it, test the printers, the language, and
   the list of what the shop leans on. Everything else — every tool, the
   terminal, the accounts — is the DEVELOPER screen, behind a sign-in the
   panel process checks for itself (night shift 01). A button hidden here is
   a courtesy; the panel refuses the action whatever this page draws.

   The words come from ui/i18n.js, never from the server. Steps, notices,
   connections and refusals all arrive as a CODE and its values; the sentence
   is written here, in the language this machine is set to. That is
   server/lib/alerts.js's rule and it is why the same shop reads correctly in
   Arabic.

   NO PASSWORD PASSES THROUGH THIS FILE EXCEPT ON ITS WAY TO THE SCREEN. A
   revealed password lives in one variable for thirty seconds, is drawn into
   one row, and is never logged, toasted or put in a URL.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = window.OG_KEY;
  var t = PI18N.t;

  var state = {
    server: 'stopped', ready: null, mirror: null, job: null,
    swCache: null, stale: false, steps: [], who: null,
    dev: null, connections: [], connChecking: false
  };
  var JOBS = {};
  var view = 'shop';
  var devTab = 'tools';
  var booted = false;      // has a first paint happened
  var live = true;         // is the stream connected
  var outroPlayed = false; // the shop coming up is a moment; a reconnect is not
  var fading = false;      // the step list is on its way out
  var copiedUrl = null;
  var printerTest = null;  // 'dry' while the no-paper check runs for the Shop screen

  function $(id) { return document.getElementById(id); }
  var out = $('out');

  /* ------------------------------------------------------------ the line */

  function post(action, args) {
    return fetch('/act?k=' + KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OG-Key': KEY },
      body: JSON.stringify({ action: action, args: args || {} })
    });
  }

  function send(action, args) {
    return post(action, args).catch(function () { /* the panel process is gone; the stream says so */ });
  }

  /* An action whose ANSWER matters — the unlock, the accounts, a reveal.
     The answer is the panel's word, never the page's guess. */
  function ask(action, args) {
    return post(action, args)
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, code: 'no_panel' }; });
  }

  var es = new EventSource('/events?k=' + KEY);

  es.addEventListener('hello', function (e) {
    var d = JSON.parse(e.data);
    JOBS = d.jobs || {};
    state = d.state;
    live = true;
    /* A reconnect replays the whole ring, so the pane is emptied first rather
       than printed twice. The ring only arrives for an unlocked window. */
    out.textContent = '';
    (d.lines || []).forEach(addLine);
    /* Arriving at a shop that is ALREADY open is not a boot. The finish is
       something that happens when the shop comes up under this window's eye;
       on a reconnect there is nothing to animate and nothing to celebrate. */
    if (state.server === 'running') { outroPlayed = true; fading = false; }
    if (!devOn() && view === 'dev') go('shop');
    if (!booted && !(state.connections || []).length && !state.connChecking) send('connections');
    booted = true;
    draw();
    paintRefresh();
    stick();
  });

  es.addEventListener('state', function (e) {
    var was = devOn();
    state = JSON.parse(e.data);
    if (was && !devOn()) afterLock(null);
    draw();
    paintRefresh();
  });
  es.addEventListener('refresh', function (e) { state.refresh = JSON.parse(e.data); paintRefresh(); });

  es.addEventListener('steps', function (e) {
    state.steps = JSON.parse(e.data);
    /* A fresh sequence. The finish becomes a thing that can happen again, the
       mark draws itself in again, and a list that was fading out stops fading
       and starts over. */
    outroPlayed = false;
    fading = false;
    drawMarkIn();
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
  es.addEventListener('lines', function (e) {
    out.textContent = '';
    (JSON.parse(e.data).lines || []).forEach(addLine);
    stick();
  });
  es.addEventListener('clear', function () { out.textContent = ''; });

  es.addEventListener('dev', function (e) {
    var d = JSON.parse(e.data);
    if (!d.unlocked) afterLock(d.why);
  });

  es.addEventListener('job', function (e) {
    var d = JSON.parse(e.data);
    state.job = { name: d.name, label: d.label, step: d.step, of: d.of };
    draw();
  });

  es.addEventListener('done', function (e) {
    var d = JSON.parse(e.data);
    var label = d.label || d.name;
    if (d.name === 'testPrintDry' && printerTest === 'dry') {
      printerTest = null;
      if (d.code) toast('warn', t('tpBad'), devOn() ? t('showDetails') : null, function () { openDev('log'); });
      else askRealPrint();
      return;
    }
    if (d.code) {
      toast('err', t('jobStopped', { label: label }),
        devOn() ? t('showDetails') : null, function () { openDev('log'); });
    } else toast('ok', t('jobDone', { label: label }));
  });

  /* A REFUSAL HAS TO REACH SOMEBODY WHO IS NOT READING THE LOG. POST /act
     answers before most actions run, so every "that button did nothing, and
     here is why" is pushed as a code and toasted here. */
  es.addEventListener('refused', function (e) {
    var d = JSON.parse(e.data);
    if (d.name === 'testPrintDry') printerTest = null;
    toast('warn', t('r_' + d.code, d));
  });

  es.onerror = function () { live = false; if (booted) paintBar(); };
  es.onopen = function () { live = true; if (booted) paintBar(); };

  /* -------------------------------------------------------- the terminal */

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function addLine(l) {
    var el = document.createElement('span');
    el.className = 'l ' + (l.stream === 'out' ? '' : l.stream);
    /* A log is only ever read after the fact, and then WHEN a line happened
       is half of what it says. */
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
     comes out "USD = 130 SYP 1", and "+2" comes out "2+". */
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

  function devOn() { return !!state.dev; }

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
    info:  '<circle cx="12" cy="12" r="9.5"/><path d="M12 11.5v5"/><path d="M12 8h.01"/>',
    eye:   '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7"/><path d="M6.6 6.7A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.3-1"/>',
    copy:  '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    again: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>'
  };

  /* An arrow is a glyph that POINTS somewhere, so it turns with the language;
     a tick and a cross mean the same thing in both. */
  function svg(name) {
    return '<svg viewBox="0 0 24 24"' + (name === 'arrow' ? ' class="ic-dir"' : '') + '>' + ICONS[name] + '</svg>';
  }

  /* ============================================================== the paint */

  function draw() {
    if (!booted) return;
    paintBar();
    if (view === 'shop') paintShop();
    if (view === 'dev') paintDev();
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
    if (s === 'stopped' && foreign()) { cls = 'on'; key = 'lampOpen'; }
    else if (s === 'stopped' && failedStep()) { cls = 'bad'; key = died() ? 'lampDied' : 'lampFailed'; }
    if (!live) { cls = 'busy'; key = 'lampWaiting'; }

    $('lamp').className = 'lamp ' + cls;
    $('lampText').textContent = t(key);

    $('bLang').textContent = t('lang');
    $('bLang').title = t('langTip');

    var on = devOn();
    $('devChip').hidden = !on;
    $('bDev').classList.toggle('open', on);
    $('bDev').classList.toggle('here', on && view === 'dev');
    $('bDev').title = on ? t('devOpenTip') : t('devTip');
    $('bDev').setAttribute('aria-label', t('devBtn'));
    if (on) {
      $('devWho').innerHTML = tHtml('devAs', { who: ltr(state.dev.who) });
      $('bLockText').textContent = t('devLock');
    }

    $('dBack').textContent = t('back');
    $('lFollow').textContent = t('follow');
    $('lClear').textContent = t('clear');
    $('lQuit').textContent = t('quit');
  }

  function foreign() { return !!(state.ready && state.ready.foreign); }
  function isRunning() { return state.server === 'running' || foreign(); }

  function failedStep() {
    for (var i = 0; i < state.steps.length; i++) if (state.steps[i].state === 'fail') return state.steps[i];
    return null;
  }

  /* A shop that opened and then fell over is NOT a shop that failed to open,
     and the two want different next actions from whoever is standing there. */
  function died() {
    var f = failedStep();
    return !!(f && f.detail && f.detail.code === 'server_died');
  }

  /* ------------------------------------------------------------- the shop */

  function paintShop() {
    var running = isRunning();
    var fail = failedStep();
    var title, sub;

    if (state.server === 'starting') { title = t('shopOpening'); sub = currentStep(); }
    else if (state.server === 'stopping') { title = t('shopClosing'); sub = ''; }
    else if (foreign()) { title = t('shopElsewhere'); sub = esc(t('shopElsewhereSub')); }
    else if (running) { title = t('shopOpen'); sub = shopSub(); }
    else if (fail) {
      /* ONE SENTENCE: which step, and what it said. The list itself is a
         developer's to read. */
      title = t(died() ? 'itDied' : 'itFailed');
      var why = stepWhy(fail);
      sub = why ? '<span class="cap1">' + why + '</span>' : esc(t('st_' + fail.id));
    }
    else { title = t('shopShut'); sub = ''; }

    $('hTitle').textContent = title;
    $('hSub').innerHTML = sub;

    paintRing(running, fail);
    paintActs(running, fail);
    paintSteps(running);
    paintHandover();
    paintVerdict(running);
    paintAddrs(running);
    paintNotices(running);
    paintCloud(running);
    paintConn($('connShop'), false);
  }

  /* While the shop opens, the line under the headline is the step that is
     running right now — the ring says how far, this says what. */
  function currentStep() {
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].state === 'run') return esc(t('st_' + state.steps[i].id)) + '…';
    }
    return '';
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

  /* THE MARK DRAWS ITSELF IN when the window opens and again with every
     fresh boot sequence. The class is taken off and put back on the next
     frame, which is what restarts a CSS animation. */
  function drawMarkIn() {
    var stage = $('stage');
    stage.classList.remove('drawn');
    void stage.offsetWidth;
    stage.classList.add('drawn');
  }

  /* The ring is the count of steps that have actually finished. It is real,
     not a timer: a step that takes forty seconds leaves the ring exactly
     where it is. A failure stops it on the failing step, in red. */
  function paintRing(running, fail) {
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
    stage.classList.toggle('busy', state.server === 'starting' || state.server === 'stopping');
    stage.classList.toggle('fail', !running && !!fail);
    stage.classList.toggle('lit', running);
    if (running && !outroPlayed) {
      outroPlayed = true;
      stage.classList.add('done');
      window.setTimeout(function () { stage.classList.remove('done'); }, 1300);
    }
    if (!running) stage.classList.remove('done');
  }

  function paintActs(running, fail) {
    if (state.server === 'starting' || state.server === 'stopping') { $('acts').innerHTML = ''; return; }
    var h = '', row = '';
    var busyJob = !!state.job;
    var printBtn = '<button class="chip" data-do="printers"' + (busyJob ? ' disabled' : '') + '>' +
      svg('print') + '<span>' + esc(t('testPrinters')) + '</span></button>';

    if (running) {
      /* The lime button is what somebody actually came here to do at eight in
         the morning. The rest are quiet, and closing the till is last. */
      h += '<button class="btn btn-primary btn-lg" data-do="openshop">' + esc(t('openBrowser')) + svg('arrow') + '</button>';
      row += '<button class="chip" data-do="refresh"' + (busyJob ? ' disabled' : '') + '>' +
        svg('again') + '<span>' + esc(t('restartFull')) + '</span></button>';
      row += printBtn;
      row += '<button class="chip stop" data-do="askstop"' + (foreign() ? ' disabled' : '') + '>' +
        svg('power') + '<span>' + esc(t('stopShop')) + '</span></button>';
    } else if (fail) {
      h += '<button class="btn btn-primary btn-lg" data-do="start">' + esc(t('tryAgain')) + '</button>';
      if (devOn()) {
        row += '<button class="chip" data-do="details">' + svg('info') + '<span>' + esc(t('showDetails')) + '</span></button>';
      }
      row += printBtn;
    } else {
      h += '<button class="btn btn-primary btn-lg" data-do="start">' + esc(t('startShop')) + '</button>';
      row += printBtn;
    }
    $('acts').innerHTML = h + (row ? '<div class="chips">' + row + '</div>' : '');
  }

  var STEP_ICON = { ok: 'tick', warn: 'warn', fail: 'cross', skip: 'dash', run: 'spin', wait: 'dot' };

  function paintSteps(running) {
    var box = $('steps');
    /* The list IS the boot. Once the shop is open it has said everything it
       had to say, so it leaves by fading. After a failure it stays only for a
       developer: everybody else has the one sentence and Try again. */
    var fail = !!failedStep();
    var want = !running && state.steps.length > 0 &&
      (state.server === 'starting' || (fail && devOn()));

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

  /* A step's sentence, written here from its code. */
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

  /* THE HANDOVER, and only when the situation is the handover: the cloud
     copy belongs to the other laptop. Then "Take the shop here" is a
     shopkeeper's button — typed-confirmed with TAKE, and refused by the panel
     in any other situation. */
  function paintHandover() {
    var box = $('handover');
    var m = state.mirror;
    if (!m || m.mode !== 'refused' || !JOBS.takeShop) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="ho-ic">' + svg('warn') + '</div>' +
      '<div class="ho-body"><b>' + esc(t('hoTitle')) + '</b>' +
      '<small>' + tHtml('hoBody', { by: '<bdi>' + esc(m.refusedBy || '?') + '</bdi>' }) + '</small></div>' +
      '<button class="btn btn-sm btn-hot" data-job="takeShop"' + (state.job ? ' disabled' : '') + '>' +
      esc(t('hoGo')) + '</button>';
    box.hidden = false;
  }

  function paintVerdict(running) {
    var box = $('verdict');
    /* A SHOP THIS WINDOW DID NOT OPEN HAS NOT BEEN CHECKED BY IT, so it gets
       no verdict at all rather than a clean bill signed on no evidence. */
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

    var h = '<div class="card">';
    h += '<h3>' + esc(t('onThisComputer')) + '</h3>';
    if (here) h += addrRow(here);
    if (r.https && r.http) h += '<p class="hint addr-hint">' + esc(t('plainNoPadlock')) + ': ' + ltr(r.http) + '</p>';

    h += '<h3 style="margin-top:15px">' + esc(t('onAPhone')) + '</h3>';
    if (lan) h += addrRow(lan);
    else h += '<p class="hint">' + esc(t('noWifi')) + '</p>';
    h += '</div>';

    /* THE CODE IS FOR THE WIFI ADDRESS, NEVER localhost. */
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

  /* A fix is a developer's tool, so the card carries its button only while
     the developer section is open. The Restart is the exception: it is on
     the Shop screen for everybody anyway. */
  function fixButton(n) {
    if (n.fix === 'refresh') {
      return '<button class="btn btn-sm btn-hot" data-do="refresh">' + esc(t('n_restartNow')) + '</button>';
    }
    if (!devOn() || !JOBS[n.fix]) return '';
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
    else if (m.mode === 'refused') h += '<span>' + tHtml('cloudBelongs', { by: '<bdi>' + esc(m.refusedBy || '?') + '</bdi>' }) + '</span>';
    else {
      var bits = [];
      if (m.behind) bits.push(tHtml('cloudWaiting', { n: ltr(m.behind) }));
      else bits.push(esc(t(mo[1])));
      if (m.lastOkAt) bits.push(tHtml('cloudPushed', { ago: ltr(ago(m.lastOkAt)) }));
      h += '<span>' + bits.join('  ·  ') + '</span>';
    }

    h += '<span class="spacer"></span>';
    if (devOn() && m.configured && m.mode !== 'off' && m.mode !== 'refused') {
      h += '<button class="btn btn-sm btn-ghost" data-do="sync"' + (state.job ? ' disabled' : '') + '>' + esc(t('syncNow')) + '</button>';
    }

    box.className = 'cloudline ' + mo[0];
    box.innerHTML = h;
    box.hidden = false;
  }

  /* ======================================================= the connections
     Everything the shop leans on, as the panel last found it. The list is
     for everybody — "the label printer is not set up" is a thing a
     shopkeeper can act on by phoning somebody. The fixes are a developer's. */

  var CONN_ORDER = ['server', 'https', 'receipt', 'label', 'scanner', 'mirror', 'tg_og', 'tg_yalla', 'push', 'internet', 'backup', 'vault'];
  var CONN_ICON = { ok: 'tick', warn: 'warn', bad: 'cross', skip: 'dash' };
  var CONN_FIX = {
    https: { https_none: 'cert', https_address: 'cert', https_expiring: 'cert', https_untrusted: 'certTrust' },
    receipt: { hw_fix: 'hardwareInstall', hw_person: 'hardware', hw_none: 'hardware' },
    label: { hw_fix: 'hardwareInstall', hw_person: 'hardware', hw_none: 'hardware' },
    scanner: { hw_fix: 'hardwareInstall', hw_person: 'hardware' },
    mirror: { mirror_offline: 'mirrorCheck', mirror_live: 'mirrorCheck' },
    backup: { backup_none: 'backup', backup_age: 'backup' }
  };

  function connWords(r) {
    var a = r.args || {};
    var c = r.code;
    if (c === 'mirror_live' && !a.behind) c = 'mirror_live0';
    if (c === 'mirror_denied') {
      return tHtml('cc_mirror_denied', { tables: ltr(listOf(a.tables || [])) }) +
        '<code class="sql" dir="ltr">' + esc(a.sql || '') + '</code>';
    }
    if (c === 'backup_age' && !a.hours) c = 'backup_recent';
    var parts = {};
    var k;
    for (k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      var v = a[k];
      if (k === 'bot') parts[k] = ltr('@' + v);
      else if (k === 'by') parts[k] = '<bdi>' + esc(v) + '</bdi>';
      else if (Object.prototype.toString.call(v) === '[object Array]') parts[k] = ltr(listOf(v));
      else parts[k] = ltr(v == null ? '?' : v);
    }
    return tHtml('cc_' + c, parts);
  }

  function paintConn(box, fixes) {
    if (!box) return;
    var rows = state.connections || [];
    var byId = {}, i;
    for (i = 0; i < rows.length; i++) byId[rows[i].id] = rows[i];
    var checking = !!state.connChecking;
    var bad = 0, warn = 0;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].state === 'bad') bad++;
      else if (rows[i].state === 'warn') warn++;
    }
    var summary = !rows.length ? esc(t('connNever'))
      : bad ? tHtml('connBad', { n: ltr(bad) })
      : warn ? tHtml('connWarn', { n: ltr(warn) })
      : esc(t('connAllOk'));

    var h = '<div class="conn-head"><div><h3>' + esc(t('connTitle')) + '</h3>' +
      '<small class="' + (bad ? 'bad' : warn ? 'warn' : rows.length ? 'ok' : '') + '">' + summary + '</small></div>' +
      '<button class="btn btn-sm btn-ghost" data-conn="all"' + (checking ? ' disabled' : '') + '>' +
      svg('again') + '<span>' + esc(checking ? t('connChecking') : t('connCheckAll')) + '</span></button></div>';

    h += '<ul class="conn-list">';
    for (i = 0; i < CONN_ORDER.length; i++) {
      var id = CONN_ORDER[i];
      var r = byId[id];
      var st = r ? r.state : 'wait';
      var fix = fixes && r && CONN_FIX[id] && CONN_FIX[id][r.code];
      if (fix && !JOBS[fix]) fix = null;
      h += '<li class="cr ' + st + '">' +
        '<span class="ic">' + svg(r ? (CONN_ICON[st] || 'dot') : (checking ? 'spin' : 'dot')) + '</span>' +
        '<span class="nm"><b>' + esc(t('c_' + id)) + '</b>' +
          '<small>' + (r ? connWords(r) : esc(checking ? t('connChecking') : t('connNever'))) + '</small></span>' +
        '<span class="at">' + (r && r.at ? tHtml('connAt', { time: ltr(clock(r.at)) }) : '') + '</span>' +
        '<span class="bt">' +
          (fix ? '<button class="btn btn-sm btn-hot" data-job="' + esc(fix) + '"' + (state.job ? ' disabled' : '') + '>' + esc(t('fix_' + fix)) + '</button>' : '') +
          (r && r.code === 'mirror_denied' && r.args && r.args.sql
            ? '<button class="btn btn-sm btn-ghost" data-copy="' + esc(r.args.sql) + '">' + esc(copiedUrl === r.args.sql ? t('copied') : t('copySql')) + '</button>'
            : '') +
          '<button class="again" data-conn="' + id + '" title="' + esc(t('connCheck')) + '" aria-label="' + esc(t('connCheck')) + '">' + svg('again') + '</button>' +
        '</span>' +
        '</li>';
    }
    h += '</ul>';
    box.innerHTML = h;
    box.classList.toggle('checking', checking);
  }

  /* ======================================================= the developer */

  var DEV_TABS = ['tools', 'log', 'conn', 'acc', 'info'];
  var PANE = { tools: 'pTools', log: 'pLog', conn: 'pConn', acc: 'pAcc', info: 'pInfo' };

  function paintDev() {
    var h = '', i;
    for (i = 0; i < DEV_TABS.length; i++) {
      var k = DEV_TABS[i];
      h += '<button role="tab" class="tab' + (k === devTab ? ' on' : '') + '" data-tab="' + k + '" aria-selected="' + (k === devTab) + '">' +
        esc(t('tab_' + k)) + '</button>';
    }
    $('devTabs').innerHTML = h;
    for (i = 0; i < DEV_TABS.length; i++) $(PANE[DEV_TABS[i]]).hidden = DEV_TABS[i] !== devTab;
    if (devTab === 'tools') paintTools();
    if (devTab === 'log') paintLog();
    if (devTab === 'conn') paintConn($('connDev'), true);
    if (devTab === 'acc') paintAccounts();
    if (devTab === 'info') paintInfo();
  }

  function openDev(tab) {
    if (!devOn()) return askUnlock(tab);
    devTab = tab || devTab;
    if (devTab === 'acc') loadAccounts();
    if (devTab === 'info') loadInfo();
    go('dev');
    if (devTab === 'log') stick();
  }

  /* The lock came down — the button, fifteen quiet minutes, or the window
     closing. Anything a developer was looking at goes with it: the log, a
     revealed password, the account list. */
  function afterLock(why) {
    out.textContent = '';
    hideReveal();
    accounts = null;
    info = null;
    if (view === 'dev') go('shop');
    if (why === 'idle') toast('warn', t('lockedIdle'));
    else if (why === 'button') toast('ok', t('lockedDone'));
  }

  /* Somebody using the developer screens is not idle. The panel counts
     time from the last thing it was asked; a click or a key here is enough
     to say "still here", sent at most twice a minute. */
  var lastPing = 0;
  function stillHere() {
    if (!devOn()) return;
    var now = Date.now();
    if (now - lastPing < 30000) return;
    lastPing = now;
    send('devstate');
  }
  document.addEventListener('pointerdown', stillHere, true);
  document.addEventListener('keydown', stillHere, true);

  function askUnlock(then) {
    openAsk(
      '<h3>' + esc(t('unlockTitle')) + '</h3>' +
      '<p>' + esc(t('unlockBody')) + '</p>' +
      '<div class="field"><label for="uUser">' + esc(t('fUser')) + '</label>' +
        '<input class="in" id="uUser" dir="ltr" autocomplete="off" spellcheck="false" autocapitalize="off"></div>' +
      '<div class="field"><label for="uPass">' + esc(t('fPass')) + '</label>' +
        '<input class="in" id="uPass" type="password" dir="ltr" autocomplete="off"></div>' +
      '<p class="err" id="uErr" role="alert" hidden></p>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-primary doit">' + esc(t('unlockGo')) + '</button>' +
      '</div>',
      function (box) {
        var u = box.querySelector('#uUser');
        var p = box.querySelector('#uPass');
        var go2 = box.querySelector('.doit');
        var err = box.querySelector('#uErr');
        function submit() {
          if (!u.value.trim()) return void u.focus();
          if (!p.value) return void p.focus();
          go2.disabled = true;
          go2.textContent = t('unlocking');
          err.hidden = true;
          ask('unlock', { username: u.value.trim(), password: p.value }).then(function (r) {
            p.value = '';
            if (r && r.ok) {
              closeAsk();
              state.dev = { who: r.who };
              openDev(then || 'tools');
              return;
            }
            go2.disabled = false;
            go2.textContent = t('unlockGo');
            err.textContent = t(r && r.code === 'too_many' ? 'unlockTooMany' : 'unlockRefused');
            err.hidden = false;
            p.focus();
          });
        }
        go2.addEventListener('click', submit);
        p.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        u.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); p.focus(); } });
      }
    );
  }

  /* -------------------------------------------------------------- tools */

  var GROUPS = ['shop', 'cloud', 'machine', 'dev'];

  function paintTools() {
    var h = '', gi, name;
    var open = state.server !== 'stopped';

    for (gi = 0; gi < GROUPS.length; gi++) {
      var g = GROUPS[gi];
      var rows = '';

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

        /* The rule runJob enforces: a job that closes the shop AROUND itself
           is not blocked by the shop being open. */
        var blocked = j.while === 'shut' && open && !j.aroundShop;
        var tags = '';
        if (j.while === 'shut' && !j.aroundShop) tags += '<span class="tag-pill">' + esc(t('needsShut')) + '</span>';
        if (j.aroundShop) tags += '<span class="tag-pill warn">' + esc(t('closesShop')) + '</span>';
        if (j.danger) tags += '<span class="tag-pill warn">' + ltr(j.danger) + '</span>';
        if (j.public) tags += '<span class="tag-pill">' + esc(t('onShopScreen')) + '</span>';

        rows += toolRow(j.label, j.blurb,
          { job: name, off: blocked || !!state.job, danger: !!j.danger, tags: tags, key: name });
      }

      if (g === 'dev' && JOBS.push) {
        rows += '<div class="pubrow">' +
          '<input class="in" id="msg" autocomplete="off" placeholder="' + esc(t('fMessage')) + '">' +
          '<button class="btn" data-job="push"' + (state.job ? ' disabled' : '') + '>' + esc(JOBS.push.label) + '</button>' +
          '</div>';
      }

      if (!rows) continue;
      h += '<section><h3 class="gh">' + esc(t('g_' + g)) + '</h3><div class="glist">' + rows + '</div></section>';
    }
    /* The publish box keeps what was typed across a repaint. */
    var msg = $('msg');
    var kept = msg ? msg.value : '';
    var focused = msg && document.activeElement === msg;
    $('groups').innerHTML = h;
    if (kept && $('msg')) $('msg').value = kept;
    if (focused && $('msg')) $('msg').focus();
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

  /* ---------------------------------------------------------------- log */

  function paintLog() {
    $('lSw').innerHTML = state.swCache ? esc(t('sw')) + ': ' + ltr(state.swCache) : '';
  }

  /* ----------------------------------------------------------- accounts */

  var accounts = null;        // { vault, accounts: [...] } or { error }
  var reveal = null;          // { id, pw, until } — one row at a time
  var revealTimer = null;
  var unreadable = {};        // id -> why, learned from a reveal that failed
  var copiedId = null;
  var REVEAL_MS = 30000;

  var ROLE_KEY = {
    owner: 'roleOwner', developer: 'roleDeveloper',
    manager: 'roleManager', cashier: 'roleCashier', warehouse: 'roleWarehouse',
    delivery: 'roleDelivery', partner: 'rolePartner'
  };

  function loadAccounts() {
    ask('accounts').then(function (r) {
      accounts = r && r.ok ? r : { error: (r && r.code) || 'failed' };
      if (view === 'dev' && devTab === 'acc') paintAccounts();
    });
  }

  function hideReveal() {
    reveal = null;
    copiedId = null;
    if (revealTimer) { window.clearInterval(revealTimer); revealTimer = null; }
  }

  function showReveal(id, pw) {
    hideReveal();
    reveal = { id: id, pw: pw, until: Date.now() + REVEAL_MS };
    revealTimer = window.setInterval(function () {
      if (!reveal) return;
      if (Date.now() >= reveal.until) { hideReveal(); paintAccounts(); return; }
      var el = $('revealLeft');
      if (el) el.innerHTML = tHtml('accHidesIn', { s: ltr(Math.ceil((reveal.until - Date.now()) / 1000)) });
    }, 1000);
  }

  function lastSeen(iso) {
    if (!iso) return esc(t('accNever'));
    var d = new Date(iso);
    if (isNaN(d)) return esc(t('accNever'));
    return ltr(d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()));
  }

  function paintAccounts() {
    var box = $('accBox');
    if (!box) return;
    if (!accounts) { box.innerHTML = '<p class="hint">' + esc(t('loading')) + '</p>'; return; }
    if (accounts.error) {
      box.innerHTML = '<p class="hint">' + esc(t('accLoadFailed')) + '</p>';
      return;
    }
    var h = '<div class="sec-head"><div><h2>' + esc(t('tab_acc')) + '</h2>' +
      '<p class="hint">' + esc(t('accAudit')) + '</p></div>' +
      '<button class="btn btn-sm btn-ghost" data-accload="1">' + svg('again') + '<span>' + esc(t('reload')) + '</span></button></div>';
    if (!accounts.vault) h += '<div class="notice bad"><span class="ic">' + svg('warn') + '</span><span><b>' + esc(t('accNoVault')) + '</b></span><span></span></div>';

    h += '<div class="acc-list" role="table">' +
      '<div class="acc-row acc-th" role="row">' +
        '<span role="columnheader">' + esc(t('accName')) + '</span>' +
        '<span role="columnheader">' + esc(t('fRole')) + '</span>' +
        '<span role="columnheader">' + esc(t('accLast')) + '</span>' +
        '<span role="columnheader">' + esc(t('fPass')) + '</span>' +
      '</div>';
    var list = accounts.accounts || [], i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      var why = unreadable[a.id] || (!accounts.vault ? 'no_key' : !a.boxed ? 'no_box' : null);
      var shown = reveal && reveal.id === a.id;
      var pw;
      if (why && !shown) {
        pw = '<span class="pw-none" title="' + esc(t('acc_why_' + why)) + '">' + esc(t('accUnreadable')) + '</span>' +
          '<button class="btn btn-sm btn-ghost" data-reset="' + a.id + '">' + esc(t('accReset')) + '</button>';
      } else if (shown) {
        pw = '<code class="pw-val" dir="ltr">' + esc(reveal.pw) + '</code>' +
          '<button class="ib" data-hide="1" title="' + esc(t('accHide')) + '" aria-label="' + esc(t('accHide')) + '">' + svg('eyeoff') + '</button>' +
          '<button class="ib' + (copiedId === a.id ? ' done' : '') + '" data-copypw="' + a.id + '" title="' + esc(t('copy')) + '" aria-label="' + esc(t('copy')) + '">' + svg(copiedId === a.id ? 'tick' : 'copy') + '</button>' +
          '<small class="left" id="revealLeft">' + tHtml('accHidesIn', { s: ltr(Math.ceil((reveal.until - Date.now()) / 1000)) }) + '</small>';
      } else {
        pw = '<span class="pw-dots" aria-hidden="true">••••••••••</span>' +
          '<button class="ib" data-reveal="' + a.id + '" title="' + esc(t('accShow')) + '" aria-label="' + esc(t('accShow')) + '">' + svg('eye') + '</button>' +
          '<button class="link sm" data-reset="' + a.id + '">' + esc(t('accReset')) + '</button>';
      }
      h += '<div class="acc-row' + (a.active ? '' : ' off') + (shown ? ' shown' : '') + '" role="row">' +
        '<span class="who" role="cell"><b>' + esc(a.name || a.username) + '</b><small dir="ltr">' + esc(a.username) + '</small></span>' +
        '<span role="cell"><span class="tag-pill' + (a.role === 'developer' || a.role === 'owner' ? ' hot' : '') + '">' + esc(t(ROLE_KEY[a.role] || a.role)) + '</span>' +
          (a.active ? '' : ' <span class="tag-pill warn">' + esc(t('accOff')) + '</span>') + '</span>' +
        '<span role="cell" class="last">' + lastSeen(a.lastLoginAt) + '</span>' +
        '<span role="cell" class="pw">' + pw + '</span>' +
        '</div>';
    }
    h += '</div>';
    box.innerHTML = h;
  }

  function doReveal(id) {
    ask('reveal', { id: id }).then(function (r) {
      if (r && r.ok) { delete unreadable[id]; showReveal(id, r.password); }
      else if (r && r.code === 'unreadable') { hideReveal(); unreadable[id] = r.why || 'no_box'; }
      else if (r && r.code === 'locked') { afterLock(null); return; }
      else toast('warn', t('accFailed'));
      r = null;
      paintAccounts();
    });
  }

  function accountName(id) {
    var list = (accounts && accounts.accounts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name || list[i].username;
    return String(id);
  }

  function askReset(id) {
    var who = accountName(id);
    openAsk(
      '<h3>' + tHtml('accResetTitle', { user: '<bdi>' + esc(who) + '</bdi>' }) + '</h3>' +
      '<p>' + tHtml('accResetBody', { user: '<bdi>' + esc(who) + '</bdi>' }) + '</p>' +
      (isRunning() && !foreign() ? '' : '<p class="err">' + esc(t('accNoShop')) + '</p>') +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-danger doit"' + (isRunning() && !foreign() ? '' : ' disabled') + '>' + esc(t('accResetGo')) + '</button>' +
      '</div>',
      function (box) {
        var b = box.querySelector('.doit');
        b.addEventListener('click', function () {
          b.disabled = true;
          b.textContent = t('working');
          ask('resetpw', { id: id }).then(function (r) {
            if (!r || !r.ok) {
              closeAsk();
              toast('warn', t(r && r.code === 'needs_shop' ? 'accNoShop' : 'accFailed'));
              return;
            }
            var pw = r.password;
            r = null;
            delete unreadable[id];
            hideReveal();
            showNewPassword(who, pw);
            pw = null;
            loadAccounts();
          });
        });
      }
    );
  }

  /* SHOWN ONCE. The new password is in this dialog and nowhere else; the
     dialog empties itself after thirty seconds. */
  function showNewPassword(who, pw) {
    var until = Date.now() + REVEAL_MS;
    var timer = null;
    openAsk(
      '<h3>' + tHtml('accNewPw', { user: '<bdi>' + esc(who) + '</bdi>' }) + '</h3>' +
      '<div class="newpw"><code dir="ltr" id="npVal">' + esc(pw) + '</code>' +
        '<button class="btn btn-sm btn-ghost" id="npCopy">' + svg('copy') + '<span>' + esc(t('copy')) + '</span></button></div>' +
      '<p>' + esc(t('accNewPwNote')) + '</p>' +
      '<p class="hint" id="npLeft"></p>' +
      '<div class="foot2"><button class="btn btn-primary" data-ask="no">' + esc(t('accDone')) + '</button></div>',
      function (box) {
        box.querySelector('#npCopy').addEventListener('click', function (e) {
          var v = box.querySelector('#npVal');
          if (!v) return;
          try {
            navigator.clipboard.writeText(v.textContent).then(function () {
              e.currentTarget && (e.currentTarget.querySelector('span').textContent = t('copied'));
            });
          } catch (err) { /* no clipboard; the password is on screen */ }
        });
        function tick() {
          var left = Math.ceil((until - Date.now()) / 1000);
          var el = box.querySelector('#npLeft');
          if (!el || $('ask').hidden) { window.clearInterval(timer); return; }
          if (left <= 0) { window.clearInterval(timer); closeAsk(); return; }
          el.innerHTML = tHtml('accHidesIn', { s: ltr(left) });
        }
        tick();
        timer = window.setInterval(tick, 1000);
      }
    );
  }

  /* --------------------------------------------------------------- info */

  var info = null;

  function loadInfo() {
    ask('info').then(function (r) {
      info = r && r.ok ? r : { error: true };
      if (view === 'dev' && devTab === 'info') paintInfo();
    });
  }

  function paintInfo() {
    var box = $('infoBox');
    if (!info) { box.innerHTML = '<p class="hint">' + esc(t('loading')) + '</p>'; return; }
    if (info.error) { box.innerHTML = '<p class="hint">' + esc(t('accLoadFailed')) + '</p>'; return; }
    var b = info.baton || {};
    var baton = b.state === 'here' ? esc(t('baton_here')) + (b.lineage ? ' · ' + ltr(b.lineage) : '')
      : b.state === 'elsewhere' ? tHtml('baton_elsewhere', { by: '<bdi>' + esc(b.by || '?') + '</bdi>' })
      : esc(t('baton_' + (b.state || 'unknown')));
    function row(k, v) { return '<div class="kv"><span>' + esc(t(k)) + '</span><span>' + v + '</span></div>'; }
    var logs = (info.logs || []).map(function (p) { return '<code dir="ltr">' + esc(p) + '</code>'; }).join('');
    box.innerHTML = '<div class="sec-head"><div><h2>' + esc(t('tab_info')) + '</h2>' +
      '<p class="hint">' + esc(t('infoSub')) + '</p></div>' +
      '<button class="btn btn-sm btn-ghost" data-infoload="1">' + svg('again') + '<span>' + esc(t('reload')) + '</span></button></div>' +
      '<div class="card kvs">' +
      row('infoBaton', baton) +
      row('infoBranch', info.branch ? ltr(info.branch) : '—') +
      row('infoCache', info.cache ? ltr(info.cache) : '—') +
      row('infoDb', info.database ? '<code dir="ltr">' + esc(info.database) + '</code>' : '—') +
      row('infoLogs', '<span class="paths">' + logs + '</span>') +
      '</div>';
  }

  /* ============================================================ the screens */

  function go(next) {
    if (next === 'dev' && !devOn()) next = 'shop';
    view = next;
    $('scShop').hidden = next !== 'shop';
    $('scDev').hidden = next !== 'dev';
    draw();
    if (next === 'shop' && !state.connections.length && !state.connChecking && booted) send('connections');
  }

  /* ============================================================= the toasts */

  function toast(kind, text, actLabel, onAct) {
    var el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', 'status');
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
    var askEl = $('ask');
    askEl.innerHTML = '<div class="box">' + html + '</div>';
    askEl.hidden = false;
    var box = askEl.firstChild;
    if (after) after(box);
    var first = box.querySelector('input, select') || box.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  /* THE TYPED WORD. The panel checks it too: a hand-sent request carries no
     disabled button. */
  function askDanger(name, job) {
    var body = name === 'takeShop' ? t('hoBody', { by: (state.mirror && state.mirror.refusedBy) || '?' }) : job.blurb;
    openAsk(
      '<h3>' + esc(name === 'takeShop' ? t('hoGo') : job.label) + '</h3>' +
      '<p>' + esc(body) + '</p>' +
      '<div class="field">' +
      '<label for="askWord">' + tHtml('typeToConfirm', { word: '<span class="word" dir="ltr">' + esc(job.danger) + '</span>' }) + '</label>' +
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
        goBtn.addEventListener('click', function () { var w = input.value.trim(); closeAsk(); send('job', { name: name, confirm: w }); });
      }
    );
  }

  var ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner', 'owner', 'developer'];

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
     The dialog opens at once and fills the names in when they come. */
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

  /* THE PRINTERS, IN TWO STEPS. The first sends nothing; only when it passes
     is the person asked whether to spend paper, because a slip that comes out
     at a busy counter nobody expected is its own small problem. */
  function askPrinters() {
    openAsk(
      '<h3>' + esc(t('tpTitle')) + '</h3>' +
      '<p>' + esc(t('tpBody')) + '</p>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-primary doit">' + esc(t('tpCheck')) + '</button>' +
      '</div>',
      function (box) {
        box.querySelector('.doit').addEventListener('click', function () {
          closeAsk();
          printerTest = 'dry';
          toast('ok', t('tpChecking'));
          send('job', { name: 'testPrintDry' });
        });
      }
    );
  }

  function askRealPrint() {
    openAsk(
      '<h3>' + esc(t('tpReadyTitle')) + '</h3>' +
      '<p>' + esc(t('tpReadyBody')) + '</p>' +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('tpNotNow')) + '</button>' +
      '<button class="btn btn-primary doit">' + svg('print') + esc(t('tpPrint')) + '</button>' +
      '</div>',
      function (box) {
        box.querySelector('.doit').addEventListener('click', function () {
          closeAsk();
          send('job', { name: 'testPrint' });
        });
      }
    );
  }

  /* ======================================================= the full refresh */

  var rfSeen = 0;
  var rfTimer = null;
  var RF_IC = {
    wait: '<circle cx="12" cy="12" r="2.5"/>',
    run: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
    ok: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    skip: '<path d="M6 12h12"/>',
    warn: '<path d="M12 7v6M12 16.5v.01"/>',
    fail: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  function paintRefresh() {
    var el = $('refresh');
    var r = state.refresh;
    if (!el) return;
    if (r && r.finished && Date.now() - r.finished > 15000) rfSeen = r.started;
    if (!r || r.started === rfSeen) {
      el.hidden = true;
      if (rfTimer) { window.clearInterval(rfTimer); rfTimer = null; }
      return;
    }
    var done = !!r.finished, ok = done && !!r.ok;
    var steps = r.steps || [];
    var reached = steps.filter(function (s) { return s.state === 'ok' || s.state === 'skip' || s.state === 'warn'; }).length;
    var frac = ok ? 1 : (steps.length ? reached / steps.length : 0);
    var secs = Math.max(0, Math.round(((r.finished || Date.now()) - r.started) / 1000));

    el.className = 'rf' + (done ? (ok ? ' done' : ' fail') : '');
    el.innerHTML = '<div class="box2">' +
      '<div class="rf-ring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="54"/>' +
        '<circle class="fg" cx="60" cy="60" r="54" style="stroke-dashoffset:' + (339.3 * (1 - frac)).toFixed(1) + '"/></svg>' +
        '<i class="orbit"></i><img src="/assets/logo.svg" alt=""></div>' +
      '<h3>' + esc(t(done ? (ok ? 'rfTitleOk' : 'rfTitleFail') : 'rfTitleRun')) + '</h3>' +
      '<p class="sub" id="rfSecs">' + ltr(t('rfElapsed', { s: secs })) + '</p>' +
      '<ol class="rf-steps">' + steps.map(function (s) {
        var detail = s.id === 'files' && s.cache ? ltr(s.cache)
          : s.id === 'answer' && s.ms ? ltr(t('rfElapsed', { s: Math.round(s.ms / 1000) })) : '';
        return '<li class="' + esc(s.state) + '"><span class="ic"><svg viewBox="0 0 24 24">' + (RF_IC[s.state] || RF_IC.wait) + '</svg></span>' +
          '<span>' + esc(t('rf_' + s.id)) + '</span>' + (detail ? '<em>' + detail + '</em>' : '') + '</li>';
      }).join('') + '</ol>' +
      (done && r.code ? '<p class="why">' + esc(t('rf_code_' + r.code)) + '</p>' : '') +
      (done
        ? '<div class="foot2">' +
            (ok || !devOn() ? '' : '<button class="btn btn-ghost" data-rf="log">' + esc(t('showDetails')) + '</button>') +
            '<button class="btn ' + (ok ? 'btn-primary' : 'btn-ghost') + '" data-rf="close">' + esc(t('rfClose')) + '</button>' +
          '</div>'
        : '') +
    '</div>';
    el.hidden = false;

    if (rfTimer) { window.clearInterval(rfTimer); rfTimer = null; }
    if (!done) {
      rfTimer = window.setInterval(function () {
        var s = $('rfSecs');
        if (s && state.refresh) s.innerHTML = ltr(t('rfElapsed', { s: Math.round((Date.now() - state.refresh.started) / 1000) }));
      }, 1000);
    } else if (ok) {
      var started = r.started;
      window.setTimeout(function () {
        if (state.refresh && state.refresh.started === started) { rfSeen = started; paintRefresh(); }
      }, 4500);
    }
  }

  function askRefresh() {
    var running = isRunning();
    if (running) send('who');
    openAsk(
      '<h3>' + esc(t('rfAskTitle')) + '</h3>' +
      '<p>' + esc(t('rfAskBody')) + '</p>' +
      (running ? '<p id="whoLine">' + esc(t('stopBodyAsking')) + '</p>' : '') +
      '<div class="foot2">' +
      '<button class="btn btn-ghost" data-ask="no">' + esc(t('cancel')) + '</button>' +
      '<button class="btn btn-primary doit">' + esc(t('rfGo')) + '</button>' +
      '</div>',
      function (box) {
        box.querySelector('.doit').addEventListener('click', function () { closeAsk(); send('refresh'); });
      }
    );
  }

  $('refresh').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-rf]') : null;
    if (!b) return;
    if (state.refresh) rfSeen = state.refresh.started;
    paintRefresh();
    if (b.getAttribute('data-rf') === 'log') openDev('log');
  });

  /* ============================================================== the clicks */

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest(
      '[data-do],[data-job],[data-url],[data-ask],[data-go],[data-copy],[data-tab],[data-conn],' +
      '[data-reveal],[data-hide],[data-copypw],[data-reset],[data-accload],[data-infoload]') : null;
    if (!el || el.disabled) return;

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
      if (g === 'dev') return void (view === 'dev' ? go('shop') : openDev());
      return void go(g);
    }

    if (el.hasAttribute('data-tab')) return void openDev(el.getAttribute('data-tab'));

    if (el.hasAttribute('data-conn')) {
      var which = el.getAttribute('data-conn');
      if (which === 'all') { state.connChecking = true; draw(); return void send('connections'); }
      el.classList.add('spinning');
      return void send('connections', { only: which });
    }

    if (el.hasAttribute('data-reveal')) return void doReveal(Number(el.getAttribute('data-reveal')));
    if (el.hasAttribute('data-hide')) { hideReveal(); return void paintAccounts(); }
    if (el.hasAttribute('data-copypw')) {
      if (!reveal) return;
      var id = reveal.id;
      try {
        navigator.clipboard.writeText(reveal.pw).then(function () {
          if (reveal && reveal.id === id) { copiedId = id; paintAccounts(); }
        });
      } catch (err) { /* nothing to do */ }
      return;
    }
    if (el.hasAttribute('data-reset')) return void askReset(Number(el.getAttribute('data-reset')));
    if (el.hasAttribute('data-accload')) { accounts = null; paintAccounts(); return void loadAccounts(); }
    if (el.hasAttribute('data-infoload')) { info = null; paintInfo(); return void loadInfo(); }

    var act = el.getAttribute('data-do');
    if (act) {
      if (act === 'quit') return askQuit();
      if (act === 'askstop') return askStop();
      if (act === 'refresh') return askRefresh();
      if (act === 'printers') return askPrinters();
      if (act === 'details') return openDev('log');
      if (act === 'lock') { hideReveal(); return void send('lock'); }
      if (act === 'openshop') {
        var r = state.ready || {};
        return void send('open', { url: r.https || r.http });
      }
      return void send(act);
    }

    var name = el.getAttribute('data-job');
    var job = JOBS[name];
    if (!job) return;
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
      var f = $('ask').querySelectorAll('input, select, button:not([disabled])');
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
  drawMarkIn();
  go('shop');

  /* "43s ago" is only true for a second. */
  window.setInterval(function () {
    if (view === 'shop' && isRunning()) paintCloud(true);
  }, 10000);
})();
