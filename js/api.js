/* ==========================================================================
   OG SYSTEM — talking to the server
   --------------------------------------------------------------------------
   The original brief said "no fetch, no backend, all state in memory". That
   was right for a demo and is no longer true: there is a server now, and this
   is the only file in the frontend allowed to reach it. Everything else goes
   through DB.*, exactly as before.

   TWO MODES, and the app must work in both.

     file://   — no server can be reached at all. API.live is false, the app
                 runs on the seeded demo data, nothing is saved. This keeps
                 "double-click index.html" working, which is still the fastest
                 way to show someone the system.

     http(s):// — a real server. Log in, load real data, save real sales.

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

  function friendly(err) {
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
        if (err && err.name === 'AbortError') {
          throw ApiError('timeout', MESSAGES.timeout, 0);
        }
        throw ApiError('offline', MESSAGES.offline, 0);
      });
  }

  return {
    live: LIVE,

    get:  function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body || {}); },
    put:  function (path, body) { return request('PUT', path, body || {}); },
    del:  function (path) { return request('DELETE', path); },

    friendly: friendly,

    onLostSession: function (fn) { onLostSession = fn; },

    /* Is the server actually reachable right now? Used before showing the
       login, so "server is down" reads differently from "wrong password".
       Resolves to a boolean and never rejects — a probe that throws is just
       another thing for the caller to wrap. */
    ping: function () {
      if (!LIVE) return Promise.resolve(false);
      return request('GET', '/api/health')
        .then(function () { return true; })
        .catch(function () { return false; });
    }
  };
})();
