/* ==========================================================================
   OG SYSTEM — a write that waits out a Wi-Fi drop            [writequeue.js]
   --------------------------------------------------------------------------
   Night shift 04. The till itself cannot lose the shop — the server is on it.
   A phone on the shop wifi can: the warehouse at the back, the office tablet,
   thirty seconds of nothing. A write pressed in that moment should wait on
   the device and go by itself, EXACTLY ONCE.

   ONLY WHAT IS ON THE LIST WAITS. Everything else behaves exactly as it did:
   it fails, and the screen says so. A route is on the list only when ALL of
   these hold (the owner's rule, decision 6 of the night shift):
     1. it records something that ALREADY HAPPENED, not a decision made now;
     2. it carries an opId through applied_ops, so a replay lands once;
     3. it moves no money between places;
     4. it is not a sale, a price, a login, staff or permissions.
   The table of every warehouse and delivery write, and why each is on or off,
   is in CLAUDE.md under night shift 04. Today exactly one route passes.

   HOW IT WAITS
   - Tried on the network first. Only "the request never arrived" (or the
     VPS proxy's shop_unreachable, or a timeout — the server may or may not
     have it, which is exactly what the opId is for) puts it on the list.
   - Kept in localStorage with WHO pressed it. Only that person's items are
     sent, and only while that person is signed in on this device: somebody
     else signing in here does not send the first person's writes.
   - Sent in the order pressed, one at a time. A write that the server
     REFUSES (a 409 with its code) is kept, red, with that code, and the rest
     go on. A 401 pauses the whole queue until the same person signs in again.
   - Two tabs: one sends. navigator.locks where the page is a secure context,
     a lease in localStorage where it is not (http on the shop wifi) — and the
     opId behind both, so even a crashed tab's half-sent write lands once.
   ========================================================================== */

var WriteQueue = (function () {
  var KEY = 'og.wq';
  var LEASE = 'og.wq.lease';
  var TAB = Math.random().toString(36).slice(2) + Date.now().toString(36);

  /* THE ALLOW-LIST. Add a route here only after checking all four rules on
     the server's own code, and add its row to the table in CLAUDE.md. */
  var ALLOW = [
    /* The carrier signed the sheet and took the bags: a fact. opId through
       applied_ops in Orders.handOver; it freezes what they collect and moves
       no money; not a sale, price, login or staff write. */
    { method: 'POST', re: /^\/api\/handovers\/[^/]+\/hand$/, kind: 'hand' }
  ];

  var cfg = { currentUser: function () { return null; }, transport: null, onSent: null };
  var started = false, paused = false, draining = false;
  var listeners = [];

  function now() { return Date.now(); }
  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  /* Every change to the stored list, one at a time across tabs where the
     browser can promise it. */
  function mutate(fn) {
    var run = function () { var list = read(); var out = fn(list); write(list); return out; };
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('og-wq-store', function () { return run(); });
    }
    return Promise.resolve(run());
  }

  function rule(method, path) {
    var p = String(path || '').split('?')[0];
    for (var i = 0; i < ALLOW.length; i++) {
      if (ALLOW[i].method === method && ALLOW[i].re.test(p)) return ALLOW[i];
    }
    return null;
  }
  function uid() {
    var u = cfg.currentUser && cfg.currentUser();
    return u && u.id != null ? u.id : null;
  }
  function mine(list) { var me = uid(); return list.filter(function (x) { return me !== null && x.userId === me; }); }

  /* The request never arrived, or the proxy could not reach the till, or it
     timed out without an answer. Anything else is the server speaking. */
  function road(err) {
    if (!err) return false;
    if (err.code === 'shop_unreachable' || err.code === 'offline' || err.code === 'timeout') return true;
    return err.status === 502 || err.status === 504 || err.status === 0;
  }

  function emit() {
    var list = mine(read());
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](list); } catch (e) { /* */ } }
  }

  function enqueue(method, path, body, kind) {
    var item = { id: 'wq-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
                 userId: uid(), method: method, path: path, body: body === undefined ? null : body,
                 kind: kind, at: new Date().toISOString(), state: 'wait', code: null, message: null, tries: 0 };
    return mutate(function (list) { list.push(item); return item; }).then(function (it) { emit(); return it; });
  }

  /* ---------------------------------------------------------------- sending */

  function lease(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('og-wq-drain', { ifAvailable: true }, function (lock) {
        return lock ? fn() : null;
      });
    }
    var l = null;
    try { l = JSON.parse(localStorage.getItem(LEASE) || 'null'); } catch (e) { l = null; }
    if (l && l.tab !== TAB && l.until > now()) return Promise.resolve(null);
    var hold = function () { try { localStorage.setItem(LEASE, JSON.stringify({ tab: TAB, until: now() + 15000 })); } catch (e) { /* */ } };
    hold();
    var beat = setInterval(hold, 5000);
    return Promise.resolve(fn()).then(function (r) {
      clearInterval(beat);
      try { localStorage.removeItem(LEASE); } catch (e) { /* */ }
      return r;
    }, function (e) { clearInterval(beat); throw e; });
  }

  function drain() {
    if (!started || paused || draining || uid() === null) return Promise.resolve(0);
    if (typeof Reach !== 'undefined' && !Reach.up()) return Promise.resolve(0);
    if (!mine(read()).some(function (x) { return x.state === 'wait'; })) return Promise.resolve(0);
    draining = true;
    var sent = 0;
    return Promise.resolve(lease(function () {
      function next() {
        if (paused) return Promise.resolve();
        var item = mine(read()).filter(function (x) { return x.state === 'wait'; })[0];
        if (!item) return Promise.resolve();
        return cfg.transport(item.method, item.path, item.body).then(function () {
          sent++;
          return mutate(function (list) {
            var i = list.findIndex(function (x) { return x.id === item.id; });
            if (i > -1) list.splice(i, 1);
          }).then(function () { emit(); return next(); });
        }, function (err) {
          if (road(err)) return mutate(function (list) {
            var x = list.find(function (y) { return y.id === item.id; });
            if (x) x.tries++;
          }).then(emit);                                 /* stop; Reach brings us back */
          if (err && err.status === 401) { paused = true; emit(); return; }
          return mutate(function (list) {
            var x = list.find(function (y) { return y.id === item.id; });
            if (x) { x.state = 'refused'; x.code = (err && err.code) || 'refused'; x.message = (err && err.message) || null; x.tries++; }
          }).then(function () { emit(); return next(); });   /* the rest go on */
        });
      }
      return next();
    })).then(function () {
      draining = false;
      if (sent && cfg.onSent) { try { cfg.onSent(sent); } catch (e) { /* */ } }
      return sent;
    }, function (e) { draining = false; throw e; });
  }

  return {
    start: function (opts) {
      opts = opts || {};
      if (opts.currentUser) cfg.currentUser = opts.currentUser;
      if (opts.transport) cfg.transport = opts.transport;
      if (opts.onSent) cfg.onSent = opts.onSent;
      if (started) return;
      started = true;
      if (typeof Reach !== 'undefined') Reach.on(function (s) { if (s === 'up') drain(); });
      /* Another tab changed the list: repaint what this tab shows of it. */
      window.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });
      /* A backstop for a list that is waiting while nothing else happens. */
      setInterval(function () { drain(); }, 30000);
      setTimeout(drain, 1500);
    },

    allowed: function (method, path) { return !!rule(method, path); },

    /* The one door js/api.js sends an allowed write through. Resolves with
       the server's answer, or with { ok: true, queued: true } when it waits. */
    send: function (method, path, body) {
      var r = rule(method, path);
      if (!r || uid() === null || !cfg.transport) return cfg.transport(method, path, body);
      var me = uid();
      var behind = mine(read()).some(function (x) { return x.state === 'wait'; });
      /* Something of this person's is already waiting: go behind it, in order. */
      if (behind) return enqueue(method, path, body, r.kind).then(function () { drain(); return { ok: true, queued: true }; });
      return cfg.transport(method, path, body).catch(function (err) {
        if (!road(err) || uid() !== me) throw err;
        return enqueue(method, path, body, r.kind).then(function () { return { ok: true, queued: true }; });
      });
    },

    /* After signing in: this person's list may go again. */
    resume: function () { paused = false; emit(); return drain(); },
    drain: drain,
    list: function () { return mine(read()); },
    paused: function () { return paused; },
    on: function (fn) { listeners.push(fn); },
    retry: function (id) {
      return mutate(function (list) {
        var x = list.find(function (y) { return y.id === id; });
        if (x) { x.state = 'wait'; x.code = null; x.message = null; }
      }).then(function () { emit(); paused = false; if (typeof Reach !== 'undefined' && !Reach.up()) Reach.check(); return drain(); });
    },
    dismiss: function (id) {
      return mutate(function (list) {
        var i = list.findIndex(function (y) { return y.id === id && y.userId === uid(); });
        if (i > -1) list.splice(i, 1);
      }).then(emit);
    }
  };
})();
