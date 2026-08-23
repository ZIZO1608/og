/* ==========================================================================
   OG SYSTEM — signing in
   --------------------------------------------------------------------------
   Replaces js/gate.js, which was a passcode written inside a file the browser
   downloads. It said so in its own comment. This checks with the server, where
   the browser cannot reach the answer.

   Keeps the same shape as the old gate — `Auth.guard(boot)` holds the app back
   until someone is allowed in — so app.js needed a one-line change rather than
   a rewrite.

   Three ways in, decided in this order:

     1. file://           no server exists. Straight through to the demo data,
                          no login, nothing saved. Double-clicking index.html
                          still works, which is how the system gets shown to
                          people.
     2. valid session     the cookie is still good. Straight through.
     3. everything else   the login screen.

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

  /* Demo mode: no server, so no accounts. Everything is permitted because
     nothing is real and nothing is saved. */
  function demoMode() { return !API.live; }

  /* ----------------------------------------------------------------- screen */

  function loginScreen() {
    var el = document.createElement('div');
    el.className = 'gate';
    el.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-mark"><img src="assets/logo.svg" alt="OG"></div>' +
        '<h1>OG SYSTEM</h1>' +
        '<p>Sneakers &amp; Streetwear — retail operations</p>' +
        '<form id="lgForm" autocomplete="on">' +
          '<input id="lgUser" type="text" placeholder="Username" aria-label="Username" ' +
            'autocomplete="username" spellcheck="false" autocapitalize="none">' +
          '<input id="lgPass" type="password" placeholder="Password" aria-label="Password" ' +
            'autocomplete="current-password">' +
          '<button type="submit" id="lgGo">Sign in</button>' +
        '</form>' +
        '<small id="lgErr"></small>' +
        '<button type="button" id="lgHint" class="gate-link">Forgotten your password?</button>' +
        '<span class="gate-note" id="lgNote"></span>' +
      '</div>';
    return el;
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

    /* Say up front if the server cannot be reached, rather than letting
       someone type a correct password and be told it is wrong. */
    API.ping().then(function (up) {
      if (!up) {
        note.textContent = 'Cannot reach the server';
        note.className = 'gate-note gate-warn';
      }
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

    /* No server: demo data, no login, nothing saved. */
    if (demoMode()) {
      started = true;
      release();
      return;
    }

    /* Ask whether the cookie is still good. A reload should not make a cashier
       type their password again. */
    API.get('/api/auth/me')
      .then(function (data) {
        user = data.user;
        started = true;
        release();
      })
      .catch(function () {
        mount();
      });
  }

  return {
    guard: guard,
    user: current,
    can: can,
    is: is,
    demoMode: demoMode,
    logout: logout
  };
})();
