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

  function lang() { return (typeof OG !== 'undefined' && OG.lang) || 'en'; }
  function words() {
    var ar = lang() === 'ar';
    var at = info && info.copyAt ? clockOf(info.copyAt) : null;
    if (ar) {
      return at
        ? 'نسخة احتياطية للقراءة فقط · البيانات من الساعة ' + at + ' · التغييرات بتصير على السيرفر الرئيسي'
        : 'نسخة احتياطية للقراءة فقط · لسا ما وصلت نسخة من السيرفر الرئيسي';
    }
    return at
      ? 'Standby copy, read only · data as of ' + at + ' · changes are made on the main server'
      : 'Standby copy, read only · no copy has arrived from the main server yet';
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
    /* The time is its own bidi run, or Arabic drags it to the far end. */
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span dir="auto"></span>';
    el.lastChild.textContent = words();
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
