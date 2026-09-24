/* ==========================================================================
   OG SYSTEM — "this is the standby copy"                    [js/standby.js]
   --------------------------------------------------------------------------
   The server says what it is on /api/health (server/lib/standby.js): the
   MAIN server, or a STANDBY — a read-only copy of it, refreshed every few
   minutes. A copy that looks exactly like the shop is the one thing that must
   never happen: somebody would ring up a sale on it and be told "no" with no
   idea why. So on a standby every screen carries one strip across the top,
   from the login gate onwards: whose copy, as of when, and that nothing can
   be changed here.

   Asked at boot and every minute. Nothing is drawn on the main server, and a
   server too old to say (no `role`) is taken as the main one.
   ========================================================================== */
var Standby = (function () {
  var info = null;   // null on the main server, { copyAt, reachable } on a standby
  var timer = null;

  /* The words are sb_strip_* in js/app-i18n-extra.js; the time is slotted in
     as its own isolated run, or Arabic drags "14:05" to the far end. */
  function paintWords(el) {
    var at = info && info.copyAt ? clockOf(info.copyAt) : null;
    var parts = t(at ? 'sb_strip_at' : 'sb_strip_none').split('{at}');
    el.textContent = '';
    el.appendChild(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      var b = document.createElement('bdi');
      b.setAttribute('dir', 'ltr');
      b.textContent = at;
      el.appendChild(b);
      el.appendChild(document.createTextNode(parts[1]));
    }
  }
  function clockOf(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var today = new Date();
    var hm = p(d.getHours()) + ':' + p(d.getMinutes());
    return d.toDateString() === today.toDateString() ? hm : d.toLocaleDateString() + ' ' + hm;
  }

  function paint() {
    var el = document.getElementById('standbyStrip');
    if (!info) { if (el) el.remove(); document.body.classList.remove('is-standby'); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'standbyStrip';
      el.className = 'standby-strip';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    document.body.classList.add('is-standby');
    el.className = 'standby-strip' + (info.reachable === false ? ' is-cut' : '');
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span></span>';
    paintWords(el.lastChild);
  }

  function check() {
    if (typeof API === 'undefined' || !API.get) return;
    API.get('/api/health').then(function (h) {
      info = h && h.role === 'standby' ? (h.standby || {}) : null;
      paint();
    }).catch(function () { /* the server itself is unreachable: Shop.fail says so */ });
  }

  return {
    watch: function () {
      check();
      if (!timer) timer = window.setInterval(check, 60000);
    },
    /* Is this a standby, as far as the last answer said. */
    on: function () { return !!info; },
    repaint: paint
  };
})();
