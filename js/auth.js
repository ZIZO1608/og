/* ==========================================================================
   OG SYSTEM — signing in
   --------------------------------------------------------------------------
   Replaces js/gate.js, which was a passcode written inside a file the browser
   downloads. It said so in its own comment. This checks with the server, where
   the browser cannot reach the answer.

   Keeps the same shape as the old gate — `Auth.guard(boot)` holds the app back
   until someone is allowed in — so app.js needed a one-line change rather than
   a rewrite.

   Two ways in:

     1. valid session     the cookie is still good. Straight through.
     2. everything else   the login screen.

   And one way to be refused: no server. There used to be a third way in —
   generated data with a DEMO banner over it, so the app opened from a
   file:// double-click or a static host. That is gone. Every number on
   screen now comes from the shop's own database or the screen says why it
   cannot. Nothing is invented to fill a page.

   Who is signed in, and what they may do, lives in Auth.user() and
   Auth.can(). The server decides both; these are a copy for drawing the UI.
   Hiding a button is a courtesy, not a boundary — every permission is checked
   again on the server, because anyone can edit what runs in their own browser.
   ========================================================================== */

var Auth = (function () {

  var user = null;             /* the signed-in person, or null */
  var releaseApp = null;       /* app.js boot(), held until we let it run */
  var started = false;         /* has the app already been released once */

  /* ------------------------------------------------------------------ state */

  function current() { return user; }

  function can(perm) {
    return !!(user && user.permissions && user.permissions.indexOf(perm) > -1);
  }

  function is(role) { return !!user && user.role === role; }

  /* Re-read the signed-in user, so a permission change takes effect without
     making anyone sign out and back in. Never rejects — a failed refresh
     should leave the app working on what it already knew, not break the
     screen that asked. */
  function refresh() {
    if (!API.live) return Promise.resolve(user);
    return API.get('/api/auth/me')
      .then(function (d) { user = d.user; return user; })
      .catch(function () { return user; });
  }

  /* ----------------------------------------------------------------- screen */

  function loginScreen() {
    var el = document.createElement('div');
    el.className = 'gate';
    /* Labels sit above the fields rather than living as placeholders. A
       placeholder disappears the moment someone starts typing, which is
       exactly when a tired cashier looks up to check which box they are in —
       and it is the reason password managers mis-fill login forms. */
    el.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-mark"><img src="assets/logo.svg" alt="OG"></div>' +
        '<h1>OG SYSTEM</h1>' +
        '<p>Sneakers &amp; Streetwear — retail operations</p>' +
        '<form id="lgForm" autocomplete="on">' +
          '<label class="gate-field"><span>Username</span>' +
            '<input id="lgUser" type="text" aria-label="Username" ' +
              'autocomplete="username" spellcheck="false" autocapitalize="none"></label>' +
          '<label class="gate-field"><span>Password</span>' +
            '<span class="gate-pw">' +
              '<input id="lgPass" type="password" aria-label="Password" ' +
                'autocomplete="current-password">' +
              /* A shop keyboard is often the wrong layout, and the password is
                 typed one-handed over a counter. Being able to see what was
                 actually typed turns a second failed attempt into none. */
              '<button type="button" id="lgEye" class="gate-eye" ' +
                'aria-label="Show password" title="Show password">' +
                '<svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
                  '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/>' +
                  '<circle cx="12" cy="12" r="2.6"/>' +
                  '<path class="eye-slash" d="M4 20L20 4"/></svg></button>' +
            '</span></label>' +
          '<button type="submit" id="lgGo">Sign in</button>' +
        '</form>' +
        '<small id="lgErr"></small>' +
        '<button type="button" id="lgHint" class="gate-link">Forgotten your password?</button>' +
        '<span class="gate-note" id="lgNote"></span>' +
      '</div>';
    return el;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function OG_LANG_AR() {
    try { return (localStorage.getItem('og.lang') || '').indexOf('ar') === 0; } catch (e) { return false; }
  }

  function shake(el) {
    var card = el.querySelector('.gate-card');
    card.classList.remove('shake');
    void card.offsetWidth;                      /* restart the animation */
    card.classList.add('shake');
  }

  function show(el, msg, kind) {
    var err = el.querySelector('#lgErr');
    err.textContent = msg || '';
    err.className = kind === 'ok' ? 'lg-ok' : '';
  }

  /* ------------------------------------------------------------------ login */

  function mount() {
    document.documentElement.classList.add('gated');
    var el = loginScreen();
    document.body.appendChild(el);

    var uEl = el.querySelector('#lgUser');
    var pEl = el.querySelector('#lgPass');
    var go = el.querySelector('#lgGo');
    var note = el.querySelector('#lgNote');

    setTimeout(function () { uEl.focus(); }, 60);

    /* Reveal the password. Focus is put back in the field afterwards so the
       cursor does not end up parked on the button mid-typing. */
    var eye = el.querySelector('#lgEye');
    eye.addEventListener('click', function () {
      var hidden = pEl.type === 'password';
      pEl.type = hidden ? 'text' : 'password';
      eye.classList.toggle('on', hidden);
      eye.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      eye.setAttribute('title', hidden ? 'Hide password' : 'Show password');
      pEl.focus();
    });

    /* Say up front if the server cannot be reached, rather than letting
       someone type a correct password and be told it is wrong. */
    API.ping().then(function (verdict) {
      if (verdict !== 'up') {
        note.textContent = 'Cannot reach the server';
        note.className = 'gate-note gate-warn';
        return;
      }
      /* WHICH server. Two laptops each running their own copy are two
         shops that will never see each other's orders, and nothing on the
         screen said so. The address every other device must open is the
         one line that stops that. */
      API.get('/api/health').then(function (h) {
        var here = location.host;
        var lan = (h && h.lan || []).filter(function (u) { return u.indexOf(here) < 0; });
        note.innerHTML = '<b>' + (h && h.shop ? esc(h.shop) : 'OG SYSTEM') + '</b> · ' +
          (OG_LANG_AR() ? 'متصل بهذا الخادم' : 'connected to this server') + ': <span dir="ltr">' + esc(here) + '</span>' +
          (lan.length
            ? '<br>' + (OG_LANG_AR() ? 'على الأجهزة الأخرى افتح' : 'on other devices open') +
              ' <span dir="ltr"><b>' + esc(lan[0]) + '</b></span>'
            : '');
        note.className = 'gate-note gate-ok';
      }).catch(function () { /* the login still works without the line */ });
    });

    el.querySelector('#lgForm').addEventListener('submit', function (e) {
      e.preventDefault();

      var username = uEl.value.trim();
      var password = pEl.value;
      if (!username || !password) {
        show(el, 'Type your username and password.');
        return;
      }

      go.disabled = true;
      go.textContent = 'Signing in…';
      show(el, '');

      API.post('/api/auth/login', { username: username, password: password })
        .then(function (data) {
          user = data.user;
          dismiss(el);

          /* A password reset by a manager lands here. Let them in, but say so
             plainly — otherwise they carry on using a password someone else
             chose and knows. */
          if (user.mustChange) {
            setTimeout(function () {
              if (typeof toast === 'function') {
                toast('Your password was reset. Change it in Settings.', 'warn');
              }
            }, 800);
          }
        })
        .catch(function (err) {
          go.disabled = false;
          go.textContent = 'Sign in';
          pEl.select();
          show(el, API.friendly(err));
          shake(el);
        });
    });

    /* The hint. It exists because it was asked for, and it is a real weakness:
       a hint good enough to jog your memory is often good enough for a
       colleague to guess, and these accounts reach the money screens. The
       server throttles this exactly like a failed login so it cannot be used
       to harvest every hint in the building. */
    el.querySelector('#lgHint').addEventListener('click', function () {
      var username = uEl.value.trim();
      if (!username) {
        show(el, 'Type your username first.');
        uEl.focus();
        return;
      }
      API.post('/api/auth/hint', { username: username })
        .then(function (data) {
          show(el, data.hint
            ? 'Hint: ' + data.hint
            : 'No hint was set. Ask a manager to reset your password.', 'ok');
        })
        .catch(function (err) { show(el, API.friendly(err)); });
    });
  }

  function dismiss(el) {
    document.documentElement.classList.remove('gated');
    el.classList.add('gate-out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);

    /* boot() must run exactly once. A session that expires and is signed back
       into would otherwise build the whole app a second time on top of the
       first, and every delegated listener would fire twice. */
    if (!started) {
      started = true;
      if (releaseApp) releaseApp();
    } else {
      if (typeof refreshAll === 'function') refreshAll();
    }
  }

  /* --------------------------------------------------------------- sign out */

  function logout() {
    return API.post('/api/auth/logout')
      .catch(function () { /* going anyway; a failed logout must not trap anyone */ })
      .then(function () {
        user = null;
        /* Reload rather than tearing the app down by hand. Everything in
           memory belonged to the person who just left, and the surest way to
           be certain none of it is still on screen is to start again. */
        location.reload();
      });
  }

  /* Called by api.js when the server rejects a request as unauthenticated —
     a session that expired, or an account switched off mid-shift. */
  function lostSession() {
    if (!user) return;                          /* already on the login screen */
    user = null;
    if (document.querySelector('.gate')) return;
    mount();
    setTimeout(function () {
      var el = document.querySelector('.gate');
      if (el) show(el, 'Your session ended. Please sign in again.');
    }, 50);
  }

  /* ------------------------------------------------------------------ guard */

  function guard(release) {
    releaseApp = release;
    API.onLostSession(lostSession);

    /* Opened from disk. There is no server to ask and never will be, so
       there is nothing to show either — the app needs the shop's database
       to say anything true. */
    if (!API.live) return stop(release);

    /* Served over http — but that alone does not mean a backend exists. A
       static host answers for index.html and 404s every /api call, so ask
       before deciding which world we are in. */
    API.ping().then(function (verdict) {
      if (verdict === 'up') {

        /* Real deployment. Is the cookie still good? A reload should not make
           a cashier type their password again mid-queue. */
        return API.get('/api/auth/me')
          .then(function (data) {
            user = data.user;
            started = true;
            release();
          })
          .catch(function () { mount(); });
      }

      /* Something served this page but has no API, or nothing answered at
         all. Either way there is no shop behind this page, and there is
         nothing honest to show.

         This is the case the DEMO banner was never really enough for. Falling
         back to generated data handed a cashier a till that looked completely
         normal and threw every sale away — and a banner is a thing you stop
         seeing by the second day. */
      stop(release);
    });
  }

  /* No app at all: the reason, and how to fix it. An empty screen would be
     read as "the shop has no stock" rather than "this machine cannot reach
     the server", and those call for very different next actions. */
  function stop(release) {
    var e = new Error('The shop server is not answering.');
    e.code = 'offline';
    if (typeof Shop !== 'undefined' && Shop.fail) return Shop.fail(e);

    /* shop.js is the one that draws it properly. If even that is missing,
       say it in plain text rather than leaving a white page. */
    document.body.innerHTML =
      '<div style="max-width:32rem;margin:20vh auto;padding:0 1.5rem;' +
      'font:400 15px/1.6 Montserrat,system-ui,sans-serif;color:#E7E7EA">' +
      '<h1 style="font-size:1.25rem;margin:0 0 .5rem">The shop server is not answering</h1>' +
      '<p style="margin:0;color:#9A9AA2">Start it with <code>cd server &amp;&amp; npm start</code>, ' +
      'or double-click <code>start-og-system.bat</code>, then reload this page.</p></div>';
  }

  return {
    guard: guard,
    user: current,
    can: can,
    is: is,
    refresh: refresh,
    logout: logout
  };
})();
