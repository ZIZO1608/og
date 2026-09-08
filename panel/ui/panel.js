/* ==========================================================================
   OG SYSTEM — control panel  ·  the window's script
   --------------------------------------------------------------------------
   One EventSource in, one POST out. Everything on screen is drawn from the
   state the panel process pushes, so the window holds no opinion of its own
   about whether the shop is running — a window that guesses is a window that
   says "running" over a server that died thirty seconds ago.

   Same conventions as the shop: one delegated listener, jobs drawn from a
   table rather than written out by hand.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = window.OG_KEY;
  var state = { server: 'stopped', ready: null, mirror: null, job: null, swCache: null };
  var JOBS = {};

  var $ = function (id) { return document.getElementById(id); };
  var out = $('out');

  /* ------------------------------------------------------------- the line */

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
    JOBS = d.jobs;
    state = d.state;
    out.textContent = '';
    d.lines.forEach(addLine);
    drawTools();
    draw();
    stick();
  });

  es.addEventListener('state', function (e) { state = JSON.parse(e.data); draw(); });
  es.addEventListener('line', function (e) { addLine(JSON.parse(e.data)); stick(); });
  es.addEventListener('clear', function () { out.textContent = ''; });

  es.onerror = function () {
    /* The browser reconnects by itself. Only say so if it stays down — a
       blink on every panel restart would train people to ignore it. */
    $('sub').textContent = 'Reconnecting to the panel...';
  };

  /* ------------------------------------------------------------- terminal */

  function addLine(l) {
    var el = document.createElement('span');
    el.className = 'l ' + (l.stream === 'out' ? '' : l.stream);
    el.textContent = l.text;
    out.appendChild(el);
    /* Same ring as the panel process holds, or a day-long session ends up
       with a hundred thousand spans in the document. */
    while (out.childNodes.length > 3000) out.removeChild(out.firstChild);
  }

  function stick() {
    if (!$('follow').checked) return;
    out.scrollTop = out.scrollHeight;
  }

  /* ----------------------------------------------------------- the drawing */

  var LAMP = {
    stopped:  { cls: '',     text: 'Closed' },
    starting: { cls: 'busy', text: 'Starting...' },
    running:  { cls: 'on',   text: 'Open' },
    stopping: { cls: 'busy', text: 'Stopping...' }
  };

  function draw() {
    var s = state.server;
    var lamp = LAMP[s] || LAMP.stopped;
    $('lamp').className = 'lamp ' + lamp.cls;
    $('lampText').textContent = lamp.text;

    var r = state.ready;
    $('sub').textContent = r && r.shop
      ? r.shop + (r.accounts != null ? '  ·  ' + r.accounts + ' account' + (r.accounts === 1 ? '' : 's') : '')
      : 'Control panel';

    var busy = !!state.job;
    $('bStart').disabled = s !== 'stopped' || busy;
    $('bStop').disabled = s === 'stopped' || s === 'stopping';
    $('bRestart').disabled = s === 'starting' || s === 'stopping' || busy;
    $('bSync').disabled = s !== 'running' || busy;
    $('bPush').disabled = busy;

    $('swLine').textContent = state.swCache
      ? 'Service worker cache: ' + state.swCache
      : '';

    $('running').hidden = !busy;
    if (busy) $('running').textContent = state.job.label + ' running';

    drawUrls();
    drawMirror();
    drawTools();
  }

  /* THE ADDRESSES. The reason this block exists at all: the old window
     printed them as text and somebody had to retype an IP by hand. */
  function drawUrls() {
    var r = state.ready;
    var host = $('urls');
    $('urlBlock').hidden = !(r && (r.https || r.http));
    if ($('urlBlock').hidden) { host.innerHTML = ''; return; }

    var rows = [];
    if (r.https) rows.push([r.https, 'this computer']);
    if (r.http && !r.https) rows.push([r.http, 'this computer']);
    (r.lan || []).forEach(function (u) { rows.push([u, 'on the wifi']); });
    /* The plain port stays reachable and machines use it, so it is worth
       showing — but under its own label, so nobody sends a phone there and
       then wonders why the camera scanner will not open. */
    if (r.https && r.http) rows.push([r.http, 'plain, no padlock']);

    host.innerHTML = '';
    rows.forEach(function (row) {
      var b = document.createElement('button');
      b.className = 'url';
      b.setAttribute('data-url', row[0]);
      b.innerHTML = '<span class="go">&#8599;</span>' +
                    '<span class="txt"></span>' +
                    '<span class="tag"></span>';
      b.querySelector('.txt').textContent = row[0];
      b.querySelector('.tag').textContent = row[1];
      host.appendChild(b);
    });
  }

  /* The mirror, in the words the shop's own Settings fold uses. */
  var MODE = {
    off:      ['',     'Off'],
    starting: ['warn', 'Starting'],
    live:     ['ok',   'Live'],
    offline:  ['warn', 'Offline'],
    refused:  ['bad',  'Refused']
  };

  function drawMirror() {
    var host = $('mirror');
    var m = state.mirror;

    if (!m) {
      host.innerHTML = '<p class="hint">' +
        (state.server === 'running' ? 'No word from the mirror yet.' : 'Waiting for the shop to start.') +
        '</p>';
      return;
    }

    var mode = MODE[m.mode] || ['', m.mode];
    var bits = [];
    if (m.behind != null) bits.push(m.behind + ' waiting');
    if (m.lastOkAt) bits.push('pushed ' + ago(m.lastOkAt));

    host.innerHTML = '<div class="top">' +
        '<span class="pip ' + mode[0] + '"></span>' +
        '<span class="mode"></span>' +
        '<span class="num"></span>' +
      '</div>';
    host.querySelector('.mode').textContent = mode[1];
    host.querySelector('.num').textContent = bits.join('  ·  ');

    /* Why it is stuck, when it is — the one thing the old launcher printed
       once at 8am and then never again. */
    var why = m.refusedBy ? 'The cloud copy belongs to ' + m.refusedBy
            : m.lastError ? m.lastError
            : m.mode === 'off' ? 'No Supabase in server/.env, so nothing is mirrored.'
            : '';
    if (why) {
      var p = document.createElement('p');
      p.className = 'why' + (m.mode === 'refused' || m.lastError ? ' bad' : '');
      p.textContent = why;
      host.appendChild(p);
    }
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return Math.round(s) + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  /* The tool buttons draw themselves from the panel's own job table, so a job
     added in panel/jobs.js appears here without this file being touched. */
  var SHOWN = ['backup', 'preflight', 'hardware', 'hardwareInstall', 'certTrust', 'cert',
               'mirrorCheck', 'mirrorDrift', 'mirrorSync', 'mirrorReconcile',
               'claim', 'restore', 'createuser'];

  function drawTools() {
    var host = $('toolList');
    if (!Object.keys(JOBS).length) return;
    var busy = !!state.job;
    var open = state.server !== 'stopped';

    host.innerHTML = '';
    SHOWN.forEach(function (name) {
      var j = JOBS[name];
      if (!j) return;
      var b = document.createElement('button');
      b.className = 'tool' + (j.danger ? ' danger' : '') + (j.while === 'shut' ? ' shut' : '');
      b.setAttribute('data-job', name);
      b.disabled = busy || (j.while === 'shut' && open);
      var t = document.createElement('b'); t.textContent = j.label;
      var s = document.createElement('small'); s.textContent = j.blurb;
      b.appendChild(t); b.appendChild(s);
      host.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ the asking */

  function closeAsk() { $('ask').hidden = true; $('ask').innerHTML = ''; }

  /* A typed word, not an "are you sure". Three of these jobs can lose a day
     of work, and a dialog you dismiss by reflex is not a decision. */
  function askDanger(name, job) {
    var box = document.createElement('div');
    box.className = 'box';
    box.innerHTML =
      '<h3></h3><p></p>' +
      '<div class="grid"><label>Type <span class="word"></span> to confirm</label>' +
      '<input class="in" id="askWord" autocomplete="off" spellcheck="false"></div>' +
      '<div class="foot"><button class="btn" data-ask="no">Cancel</button>' +
      '<button class="btn doit" data-ask="yes" disabled>Run it</button></div>';
    box.querySelector('h3').textContent = job.label;
    box.querySelector('p').textContent = job.blurb;
    box.querySelector('.word').textContent = job.danger;

    var host = $('ask');
    host.innerHTML = '';
    host.appendChild(box);
    host.hidden = false;

    var input = box.querySelector('#askWord');
    var go = box.querySelector('[data-ask="yes"]');
    input.focus();
    input.addEventListener('input', function () {
      go.disabled = input.value.trim().toUpperCase() !== job.danger;
    });
    go.addEventListener('click', function () {
      if (go.disabled) return;
      closeAsk();
      send('job', { name: name });
    });
  }

  function askAccount(name, job) {
    var box = document.createElement('div');
    box.className = 'box';
    box.innerHTML =
      '<h3></h3><p></p>' +
      '<div class="grid">' +
        '<label>Username</label><input class="in" id="aUser" autocomplete="off" spellcheck="false">' +
        '<label>Full name</label><input class="in" id="aName" autocomplete="off">' +
        '<label>Role</label><input class="in" id="aRole" value="cashier" autocomplete="off" spellcheck="false">' +
        '<label>Password</label><input class="in" id="aPass" type="password" autocomplete="new-password">' +
      '</div>' +
      '<div class="foot"><button class="btn" data-ask="no">Cancel</button>' +
      '<button class="btn go" data-ask="yes">Create</button></div>';
    box.querySelector('h3').textContent = job.label;
    box.querySelector('p').textContent = job.blurb;

    var host = $('ask');
    host.innerHTML = '';
    host.appendChild(box);
    host.hidden = false;
    box.querySelector('#aUser').focus();

    box.querySelector('[data-ask="yes"]').addEventListener('click', function () {
      /* `name` on the wire is the JOB's name, so the person's goes as
         fullName — one collision here would have created an account called
         "createuser". */
      var username = box.querySelector('#aUser').value.trim();
      var password = box.querySelector('#aPass').value;
      if (!username || !password) return;
      closeAsk();
      send('job', {
        name: name,
        username: username,
        fullName: box.querySelector('#aName').value.trim(),
        role: box.querySelector('#aRole').value.trim() || 'cashier',
        password: password
      });
    });
  }

  /* --------------------------------------------------------- one listener */

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-do],[data-job],[data-url],[data-ask]') : null;
    if (!el) return;

    if (el.hasAttribute('data-ask')) { if (el.getAttribute('data-ask') === 'no') closeAsk(); return; }
    if (el.hasAttribute('data-url')) return void send('open', { url: el.getAttribute('data-url') });

    var act = el.getAttribute('data-do');
    if (act) {
      if (act === 'quit' && !confirm('Close the panel and the shop with it?')) return;
      return void send(act);
    }

    var name = el.getAttribute('data-job');
    var job = JOBS[name];
    if (!job || el.disabled) return;
    if (job.danger) return askDanger(name, job);
    if (job.needs === 'account') return askAccount(name, job);
    if (job.needs === 'message') {
      var msg = $('msg').value.trim();
      if (!msg) { $('msg').focus(); return; }
      $('msg').value = '';
      return void send('job', { name: name, message: msg });
    }
    send('job', { name: name });
  });

  /* Enter in the message box publishes — the box exists for one button. */
  $('msg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !$('bPush').disabled) $('bPush').click();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('ask').hidden) closeAsk();
  });

  /* "pushed 12s ago" is a lie thirty seconds later if nothing repaints. */
  setInterval(function () { if (state.mirror) drawMirror(); }, 10000);
})();
