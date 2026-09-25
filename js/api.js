/* ==========================================================================
   OG SYSTEM — talking to the server
   --------------------------------------------------------------------------
   The original brief said "no fetch, no backend, all state in memory". That
   is no longer true: there is a server now, and this is the only file in the
   frontend allowed to reach it. Everything else goes through DB.*.

   ONE MODE. A real server, or nothing.

   There used to be a second: opened from a file:// double-click, API.live
   false, running on generated data with a banner over it. That is gone.
   Every number on screen now comes from the shop's own database, and when
   the server cannot be reached the app says so instead of inventing a shop.

   Nothing here throws a bare string. Every failure comes back as an ApiError
   with a `code`, because the caller nearly always needs to tell "you are
   logged out" from "the shop's internet dropped" from "that is not allowed" —
   and those want three different messages at a till.
   ========================================================================== */

var API = (function () {

  /* A page opened from disk has no origin to call. Checking the protocol is
     more honest than trying a request and waiting for it to fail. */
  var LIVE = location.protocol.indexOf('http') === 0;

  var BASE = '';               /* same origin — the server serves the app too */
  var TIMEOUT_MS = 15000;

  /* Called when the server says the session is gone. Set by auth.js so a
     session expiring mid-shift puts the login screen up instead of leaving
     the cashier clicking buttons that silently do nothing. */
  var onLostSession = null;

  function ApiError(code, message, status, detail) {
    var e = new Error(message || code);
    e.name = 'ApiError';
    e.code = code;
    e.status = status || 0;
    e.detail = detail || null;
    return e;
  }

  /* Human wording for the failures a person at a till will actually hit.
     Anything not listed falls back to the server's own message, which is
     already written for a person rather than a log file. */
  var MESSAGES = {
    offline:        'No connection to the server. Check the wifi.',
    timeout:        'The server is not answering. Try again.',
    unauthenticated:'You have been signed out. Please sign in again.',
    forbidden:      'Your account does not have access to this.',
    server_error:   'Something went wrong on the server.'
  };

  /* A code with an `err_<code>` string in the app's own table is said in the
     screen's language; everything else as before. */
  function friendly(err) {
    if (err && err.code && typeof I18N !== 'undefined' && typeof OG !== 'undefined') {
      var table = I18N[OG.lang] || I18N.en;
      if (table && table['err_' + err.code]) return table['err_' + err.code];
    }
    return MESSAGES[err.code] || err.message || 'Something went wrong.';
  }

  function request(method, path, body) {
    if (!LIVE) {
      return Promise.reject(
        ApiError('no_server', 'Opened from a file, so there is no server.', 0));
    }

    /* AbortController rather than racing a timer: a request left hanging
       holds a connection open, and on a phone that is a flat battery. */
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    var opts = {
      method: method,
      /* The session cookie is httpOnly, so JavaScript cannot read or attach
         it. `same-origin` tells the browser to send it for us. */
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined
    };

    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    return fetch(BASE + path, opts)
      .then(function (res) {
        if (timer) clearTimeout(timer);

        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }

          /* Night shift 04: every answer says whether the till was reached
             (js/reach.js). The VPS proxy's own shop_unreachable is NOT the
             till speaking. */
          if (typeof Reach !== 'undefined') Reach.report(res.status, data && data.code);

          if (res.ok) return data;

          var code = (data && data.code) || 'server_error';
          var msg = (data && data.error) || ('HTTP ' + res.status);

          /* A dead session is not an error the caller should have to handle
             everywhere. Tell auth.js once and let it put the login up. */
          if (res.status === 401 && onLostSession) {
            try { onLostSession(); } catch (e) { /* never let this mask the real error */ }
          }

          throw ApiError(code, msg, res.status, data);
        });
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'ApiError') throw err;

        /* fetch rejects for exactly two reasons worth separating: we aborted
           it, or the network never carried it. Both look identical to the
           caller otherwise, and they need different advice. */
        if (typeof Reach !== 'undefined') Reach.report(0, null);
        if (err && err.name === 'AbortError') {
          throw ApiError('timeout', MESSAGES.timeout, 0);
        }
        throw ApiError('offline', MESSAGES.offline, 0);
      });
  }

  /* WRITES GO THROUGH THE QUEUE'S DOOR (night shift 04, js/writequeue.js).
     A write that is not on its list is handed straight back to request() and
     behaves exactly as it always did; one that is on it may answer
     { ok: true, queued: true } — saved on this device, sent by itself. */
  function write(method, path, body) {
    if (typeof WriteQueue !== 'undefined' && WriteQueue.allowed(method, path)) {
      return WriteQueue.send(method, path, body);
    }
    return request(method, path, body);
  }

  if (typeof Reach !== 'undefined') Reach.start();
  if (typeof WriteQueue !== 'undefined') {
    WriteQueue.start({
      currentUser: function () { return typeof Auth !== 'undefined' && Auth.user ? Auth.user() : null; },
      transport: request,
      onSent: function (n) {
        if (typeof toast === 'function' && typeof t === 'function') toast(t('wq_title'), t(n === 1 ? 'wq_sent_1' : 'wq_sent_n').replace('{n}', n), 'ok');
        if (typeof Deliveries !== 'undefined' && Deliveries.load) Deliveries.load();
      }
    });
  }

  return {
    live: LIVE,

    get:   function (path) { return request('GET', path); },
    post:  function (path, body) { return write('POST', path, body || {}); },
    put:   function (path, body) { return write('PUT', path, body || {}); },
    /* Editing one field of a product or a customer is a partial update, and
       the routes are written as PATCH because that is what they do. A PUT
       here would say "replace the whole row", which is the request that
       blanks a phone number by leaving it out. */
    patch: function (path, body) { return write('PATCH', path, body || {}); },
    del:   function (path) { return write('DELETE', path); },

    friendly: friendly,

    onLostSession: function (fn) { onLostSession = fn; },

    /* What kind of world is this? Three answers, not two — and the third one
       is the whole point.

         'up'    the server answered. A real deployment.
         'none'  something answered, but not a backend — a static host, or
                 a page opened from file://, with no API behind it. There is
                 no server here and there never was.
         'down'  nothing carried the request at all. Either the wifi went, or
                 the shop's server is off.

       The two call for different next actions: 'none' means this address
       was never the shop, 'down' means the shop's server has stopped
       answering while the shop believes it is selling. Telling them apart
       is what lets the app say which.

       Never rejects — a probe that throws is one more thing to wrap. */
    ping: function () {
      if (!LIVE) return Promise.resolve('none');
      return request('GET', '/api/health')
        .then(function () { return 'up'; })
        .catch(function (err) {
          /* 'road' (night shift 04): the VPS proxy in front of
             shop.ogsports1.com answered, but the till behind it did not —
             the laptop is fine, the shop's internet is not. nginx says so
             with its own code; a bare 502/504 on a public name is read the
             same way, in case an older proxy is still in front. */
          if (err && err.code === 'shop_unreachable') return 'road';
          if (err && (err.status === 502 || err.status === 504) && API.publicHost()) return 'road';
          /* An HTTP status means SOMETHING is serving this origin and it has
             no /api. Status 0 means the request never arrived anywhere. */
          return (err && err.status > 0) ? 'none' : 'down';
        });
    },

    /* Is this page on a public name (shop.ogsports1.com) rather than the
       shop's own wifi address, localhost or a .local name?
       The two patterns had lost their backslashes on the way in (a shell
       heredoc eats them), so /^d+.d+.d+.d+$/ matched no address at all and
       the shop's own 10.10.99.9 counted as a public name. */
    publicHost: function () {
      var h = String(location.hostname || '').toLowerCase();
      if (!h || h === 'localhost' || /\.local$/.test(h) || h.indexOf('.') < 0) return false;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.indexOf(':') >= 0) return false;
      return true;
    }
  };
})();
