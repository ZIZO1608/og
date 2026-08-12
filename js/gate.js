/* ==========================================================================
   OG SYSTEM — passcode gate
   --------------------------------------------------------------------------
   BE CLEAR ABOUT WHAT THIS IS. It stops casual visitors and search crawlers
   from wandering into an unreleased client demo. It is NOT security: this
   file is downloadable, the passcode is in it, and on a free GitHub Pages
   account the repository is public anyway. Anyone determined gets in.

   It is the right level for "a demo of someone's business that should not be
   on the open web", and the wrong level for anything real. When this becomes
   a product the gate is replaced by a server-side login.

   Skipped entirely on file:// so double-clicking index.html stays instant.
   ========================================================================== */

var Gate = (function () {

  var PASSCODE = 'OG2026';                 // change before sharing the link
  var KEY = 'og_gate_ok';
  var ENABLED = location.protocol.indexOf('http') === 0;

  function unlocked() {
    if (!ENABLED) return true;
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function remember() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function screen() {
    var el = document.createElement('div');
    el.className = 'gate';
    el.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-mark"><img src="assets/logo.svg" alt="OG"></div>' +
        '<h1>OG SYSTEM</h1>' +
        '<p>Sneakers &amp; Streetwear — retail operations</p>' +
        '<form id="gateForm" autocomplete="off">' +
          '<input id="gateInput" type="password" inputmode="text" placeholder="Passcode" ' +
            'aria-label="Passcode" autocomplete="off" spellcheck="false">' +
          '<button type="submit">Enter</button>' +
        '</form>' +
        '<small id="gateErr"></small>' +
        '<span class="gate-note">Private demo · not for distribution</span>' +
      '</div>';
    return el;
  }

  /* Hold the app back until the code is right. Everything downstream — boot(),
     the service worker, the deep-link router — runs only after release(). */
  function guard(release) {
    if (unlocked()) { release(); return; }

    document.documentElement.classList.add('gated');
    var el = screen();
    document.body.appendChild(el);

    var input = el.querySelector('#gateInput');
    var err = el.querySelector('#gateErr');
    setTimeout(function () { input.focus(); }, 60);

    el.querySelector('#gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (input.value.trim().toUpperCase() === PASSCODE) {
        remember();
        document.documentElement.classList.remove('gated');
        el.classList.add('gate-out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
        release();
      } else {
        err.textContent = 'Wrong passcode';
        el.querySelector('.gate-card').classList.remove('shake');
        void el.offsetWidth;                       // restart the animation
        el.querySelector('.gate-card').classList.add('shake');
        input.select();
      }
    });
  }

  return { guard: guard, unlocked: unlocked, enabled: ENABLED };
})();
