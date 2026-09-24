/* ==========================================================================
   OG SYSTEM — HTTP plumbing
   --------------------------------------------------------------------------
   Node's built-in http module, no framework. Express would be one dependency
   and about forty transitive ones; what it provides beyond this file is
   routing sugar and body parsing, both of which are short enough to read here.

   This server also serves the frontend. That is a deliberate simplification:
   one origin means no CORS to configure, session cookies simply work, and
   deployment is one process instead of two.
   ========================================================================== */

import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

/* -------------------------------------------------------------------- body */

const MAX_BODY = 1024 * 1024;   // 1 MB. Nothing this API accepts is close.

/* Read and parse a JSON body. Rejects anything oversized as it streams rather
   than after buffering it, so a large upload cannot exhaust memory before the
   limit is noticed. */
/* `max` is for the one route that carries a product photo at website size
   (066): a 1600 px JPEG as a data URL is most of a megabyte on its own, plus
   its small copy. Everything else keeps the megabyte. */
export function readJson(req, { max = MAX_BODY } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    let refused = false;
    req.on('data', (c) => {
      if (refused) return;                       /* drained, not kept */
      size += c.length;
      if (size > max) {
        /* SAY SO, THEN HANG UP (audit 06). This used to destroy the socket on
           the spot, so the sender got a connection reset — which the app
           reports as "offline" — instead of the 413 this promise carries.
           The rest of the upload is read and thrown away, nothing of it is
           kept in memory, and the socket is cut a moment after the answer
           has had time to leave. */
        refused = true;
        chunks.length = 0;
        reject(Object.assign(new Error('That is too much to send at once.'), { status: 413, code: 'too_large' }));
        setTimeout(() => { try { req.destroy(); } catch { /* gone */ } }, 1500).unref();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (refused) return;
      if (!chunks.length) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reject(Object.assign(new Error('That request could not be read.'), { status: 400, code: 'bad_json' }));
      }
      /* EVERY ROUTE READS A JSON OBJECT, AND THE WIRE CAN SEND ANYTHING (audit
         06). `null`, `[]`, `"text"` and `123` are all valid JSON, and a
         handler that does `const { name } = await readJson(req)` dies on the
         first one: sixty-odd routes answered a hand-sent `null` with a 500.
         Refused here, once, rather than remembered in a hundred handlers. */
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(Object.assign(new Error('That request could not be read.'), { status: 400, code: 'bad_json' }));
      }
      resolve(parsed);
    });

    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------- responses */

/* PASSWORD MATERIAL NEVER LEAVES OVER HTTP (night shift 01). A readable
   password lives only in users.pw_box and is read only by the developer panel,
   over its own pipe. Every JSON answer is checked for the column names that
   carry password material; one that has them is refused rather than sent,
   whatever route built it — a SELECT * somewhere next year included. */
const SECRET_KEYS = /"(pw_box|pw_enc|pw_hash|pw_salt)"\s*:/;
export function sendJson(res, status, body, headers = {}) {
  let text = JSON.stringify(body);
  if (SECRET_KEYS.test(text)) {
    console.error('  [http] refused to send an answer carrying password material');
    status = 500;
    text = JSON.stringify({ ok: false, code: 'server_error', error: 'Something went wrong on the server.' });
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...headers
  });
  res.end(text);
}

/* One shape for every failure, so the client never has to guess. `code` is for
   code to branch on; `error` is for a person to read. */
/* WHAT THE DATABASE SAID IS NOT FOR THE PERSON ASKING (audit 06). About a
   hundred handlers end in `sendError(res, e.status || 400, e.code || 'invalid',
   e.message)`, which is right for the shop's own refusals ("Only 2 left") and
   wrong for anything the runtime threw: a hand-sent `true` where a name
   belonged came back as "Provided value cannot be bound to SQLite parameter 1"
   with code ERR_INVALID_ARG_TYPE, and a bad id as "FOREIGN KEY constraint
   failed". That names the engine and the schema to whoever is probing. One
   place, so no handler has to remember: a message or a code that is the
   runtime's is replaced, and the original goes to the operator's log. */
const INTERNAL = /sqlite|constraint failed|cannot be bound|no such (table|column)|syntax error|near "|Cannot read propert|is not a function|is not iterable|is not defined|of undefined|of null|Unexpected token|node:|\.js:\d|[A-Z]:\\/i;
const RUNTIME_CODE = /^(ERR_|SQLITE_|E[A-Z]{3,}$)/;
export function sendError(res, status, code, message, headers = {}) {
  let c = code, m = message;
  if (RUNTIME_CODE.test(String(c || '')) || INTERNAL.test(String(m || ''))) {
    console.error(`[${new Date().toISOString()}] refused without detail (${status} ${c}): ${m}`);
    c = status >= 500 ? 'server_error' : 'invalid';
    m = status >= 500 ? 'Something went wrong on the server.' : 'That request was not understood.';
  }
  sendJson(res, status, { ok: false, code: c, error: m }, headers);
}

/* A failure that carries the number the caller needs to act on: how many are
   actually left, what the discount ceiling is, how many points they have.

   It exists because sendError's fifth argument is HTTP HEADERS, and four
   routes spent a long time passing `{ maxPct: 10 }` there — so the shape was
   right, the destination was not, and a cashier told her discount was too big
   was never told what the limit was. js/api.js hands the whole parsed body to
   the caller as `err.detail`, so these land as `err.detail.maxPct`.

   Deliberately a separate function rather than a fifth-argument change:
   the 405 handler passes a real `Allow` header, so that argument still means
   headers and has to keep meaning headers. */
export function sendErrorDetail(res, status, code, message, detail = {}) {
  sendJson(res, status, { ok: false, code, error: message, ...detail });
}

export function sendOk(res, body = {}, headers = {}) {
  sendJson(res, 200, { ok: true, ...body }, headers);
}

/* ----------------------------------------------------------------- cookies */

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* -------------------------------------------------------------------- CSRF
   Session cookies are sent by the browser on cross-site form posts too, so a
   malicious page could make the till issue a refund while a manager is logged
   in. SameSite=Lax blocks most of it; this closes the rest by requiring that
   state-changing requests come from our own origin.

   Requests with no Origin header are allowed: that is a same-origin GET, or a
   non-browser client like curl or the test suite, neither of which is the
   attack this defends against. */
export function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (allowedOrigins && allowedOrigins.length) return allowedOrigins.includes(origin);
  /* NO LIST IS NOT "EVERY ORIGIN" ANY MORE (audit 06). OG_ORIGINS ships blank
     and the shop runs with it blank, so this check did nothing at all on the
     one install that matters — a blank list allowed everything. With no list,
     the only origin that may change state is THE ONE THE REQUEST WAS SENT TO:
     the Origin header's host must be the Host header. That is every real use —
     the till on localhost, a phone on the Wi-Fi address, the https port — and
     needs no configuration, while a page on any other site is refused however
     it got the browser to send the request. A machine (the print agent, a
     script, the website's server) sends no Origin and was already let through
     above. OG_ORIGINS is still the way to name an origin that differs from the
     host, such as a public hostname in front of a proxy. */
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); }
  catch { return false; }
}

/* -------------------------------------------------------- security headers */

/* WHAT THE PAGE MAY LOAD, AND WHERE IT MAY SEND (audit 06). There was no
   Content-Security-Policy at all. This one is written to break nothing, so it
   is honest about what it cannot do: the app has an inline script in
   index.html, a handful of inline handlers and style attributes everywhere,
   so script-src and style-src keep 'unsafe-inline' and an INJECTED inline
   script is not stopped here — escaping is what stops that (js/app-util.js
   esc(), and openModal's title since this audit). What it does stop:

     - a script, frame or object loaded from anywhere but this server
     - connect-src 'self': a page that has been tricked cannot fetch() or
       beacon the customer list to somebody else's server — the API, the live
       channel and the service worker are all same-origin
     - <base> and <form action> pointed elsewhere
     - being framed (frame-ancestors, beside X-Frame-Options for old browsers)

   img-src takes https: because product photographs live in the public
   Supabase bucket, and data:/blob: because the till draws receipts and QR
   codes into canvases. media-src blob: is the camera scanner's preview.
   The same value is exported for the customer's tracking page (index.js). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

/* The camera is the barcode scanner's, on this origin only. Nothing here asks
   for a microphone, a location or a payment sheet, so nothing embedded or
   injected may either. */
export const PERMISSIONS = 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()';

function securityHeaders() {
  return {
    /* Stops a browser from guessing that a .txt is really JavaScript. */
    'X-Content-Type-Options': 'nosniff',
    /* The app is not meant to be embedded anywhere; framing it is how
       clickjacking works. */
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
    'Permissions-Policy': PERMISSIONS
  };
}

/* ------------------------------------------------------------ static files */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8'
};

/* Serve a file from `root`, or return false if there is nothing to serve.
   Returning false rather than 404-ing lets the caller fall through to the API
   router and decide what a miss means. */
/* ---------------------------------------------------- what may be served

   OG_STATIC is the PROJECT ROOT, because that is where index.html lives — and
   `server/`, `.git/`, `docs/` and every build script live inside it too.
   Serving that directory wholesale meant `GET /server/data/og.db` handed the
   entire database — password hashes, live session tokens, every customer's
   name and phone number — to anyone who asked, with no login. `/.git/config`
   gave up the whole repository alongside it.

   The traversal guard below was never the problem: nothing had to escape the
   root, because everything worth stealing was already inside it.

   So this is an allow-list, not a block-list. A block-list needs updating
   every time somebody adds a folder, and the day it is forgotten is the day
   the database is public again. Deny by default is the same rule the API
   router already follows for endpoints. */
const ALLOW_DIRS = new Set(['css', 'js', 'assets']);
const ALLOW_FILES = new Set([
  'index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'favicon.ico'
]);

function servable(rel) {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  return parts.length === 1 ? ALLOW_FILES.has(parts[0]) : ALLOW_DIRS.has(parts[0]);
}

export function serveStatic(req, res, root, urlPath) {
  /* Path traversal guard. Decode first -- %2e%2e%2f is the same attack
     wearing a hat -- then normalise and confirm the result is still inside
     root. Checking for '..' in the raw string is the version that gets bypassed. */
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return false;
  }

  if (rel === '/' || rel === '') rel = '/index.html';

  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return false;

  /* Checked on the NORMALISED path, not the raw request, so `/js/../server/…`
     is judged by where it actually lands rather than by how it was spelled. */
  if (!servable(full.slice(root.length).split(sep).join('/'))) return false;

  /* Test harnesses and the screenshot rig must never be reachable on a real
     server, the same rule the deploy build enforces. */
  const base = full.split(sep).pop();
  if (base.startsWith('_')) return false;

  if (!existsSync(full)) return false;
  let st;
  try { st = statSync(full); } catch { return false; }
  if (!st.isFile()) return false;

  const type = TYPES[extname(full).toLowerCase()] || 'application/octet-stream';

  /* EVERYTHING revalidates, and an ETag is what makes that cheap.

     This used to hand js/, css/ and assets/ `public, max-age=3600` with no
     ETag and no Last-Modified — an hour in which the browser would not even
     ASK, and could not have revalidated if it wanted to. Edit a file, reload,
     and get the old one back, with nothing on screen to say why. The panel's
     Hard refresh cannot work through that, and neither could anybody's F5.

     `no-cache` does not mean "do not store". It means "store it, but ask
     before using it". The answer here is a 304 with no body, on a LAN, in
     about a millisecond — and offline is the service worker's job anyway,
     which is a cache this header has no say over.

     The tag is mtime and size, not a hash of the bytes: a hash means reading
     every file twice on every request to save a browser from re-fetching one
     it already has. */
  const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', ...securityHeaders() });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
    ETag: etag,
    ...securityHeaders()
  });

  createReadStream(full).pipe(res);
  return true;
}

/* ------------------------------------------------------------------ router
   Routes are declared as 'METHOD /path' with optional :params. Small enough
   to be obvious, and it keeps the endpoint list readable in one place. */
export function makeRouter() {
  const routes = [];

  function add(spec, handler) {
    const [method, path] = spec.split(' ');
    const names = [];
    const pattern = path
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([A-Za-z_]\w*)/g, (_, n) => { names.push(n); return '([^/]+)'; });
    routes.push({ method, re: new RegExp(`^${pattern}$`), names, handler });
  }

  function match(method, path) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }

  /* Which methods a path would accept, so a wrong verb gives 405 with a
     correct Allow header instead of a confusing 404. */
  function methodsFor(path) {
    return routes.filter(r => r.re.test(path)).map(r => r.method);
  }

  return { add, match, methodsFor };
}
