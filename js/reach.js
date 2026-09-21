/* ==========================================================================
   OG SYSTEM — can this device reach the shop right now?          [reach.js]
   --------------------------------------------------------------------------
   Night shift 04. One fact, kept by one module: is the till answering THIS
   device. js/api.js reports the outcome of every request here, and the write
   queue (js/writequeue.js) listens — when the answer turns back to yes, what
   waited on this device is sent.

   WHAT COUNTS AS "NOT REACHED": the request never arrived anywhere (the
   phone's wifi dropped for thirty seconds at the back of the warehouse), or
   the VPS proxy answered for a till it could not reach (its own
   `shop_unreachable`, or a bare 502/504). ANY other answer — a 200, a 403, a
   409 refusal — means the till heard us, and that is "up".

   While down it asks /api/health every few seconds, backing off to thirty,
   and says "up" the moment that lands. It never polls while up: the app's
   own requests are the heartbeat.
   ========================================================================== */

var Reach = (function () {
  var state = 'up';
  var listeners = [];
  var timer = null;
  var wait = 3000;
  var started = false;

  function set(next) {
    if (next === state) return;
    state = next;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* one listener must not stop the rest */ }
    }
    if (state === 'down') schedule();
    else { if (timer) clearTimeout(timer); timer = null; wait = 3000; }
  }

  function schedule() {
    if (timer || state === 'up') return;
    timer = setTimeout(function () {
      timer = null;
      probe();
    }, wait);
    wait = Math.min(30000, Math.round(wait * 1.6));
  }

  function probe() {
    if (typeof fetch !== 'function') return;
    fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { report(res.status, null); if (state === 'down') schedule(); })
      .catch(function () { report(0, null); schedule(); });
  }

  /* status: the HTTP status, 0 when nothing arrived. code: the answer's own
     `code` when it had one. */
  function report(status, code) {
    if (!started) return;
    var down = status === 0 || code === 'shop_unreachable' ||
               ((status === 502 || status === 504) && !code);
    set(down ? 'down' : 'up');
  }

  return {
    start: function () { started = true; },
    report: report,
    state: function () { return state; },
    up: function () { return state === 'up'; },
    on: function (fn) { listeners.push(fn); },
    /* Ask now, rather than on the timer — the Retry button. */
    check: probe
  };
})();
