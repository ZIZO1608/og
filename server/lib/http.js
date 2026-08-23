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
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('body is not valid JSON'), { status: 400 }));
      }
    });

    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------- responses */

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
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
export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { ok: false, code, error: message }, headers);
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
  if (!allowedOrigins || !allowedOrigins.length) return true;
  return allowedOrigins.includes(origin);
}

/* -------------------------------------------------------- security headers */

function securityHeaders() {
  return {
    /* Stops a browser from guessing that a .txt is really JavaScript. */
    'X-Content-Type-Options': 'nosniff',
    /* The app is not meant to be embedded anywhere; framing it is how
       clickjacking works. */
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
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

  /* Test harnesses and the screenshot rig must never be reachable on a real
     server, the same rule the deploy build enforces. */
  const base = full.split(sep).pop();
  if (base.startsWith('_')) return false;

  if (!existsSync(full)) return false;
  let st;
  try { st = statSync(full); } catch { return false; }
  if (!st.isFile()) return false;

  const type = TYPES[extname(full).toLowerCase()] || 'application/octet-stream';

  /* index.html and the service worker must never be cached by the browser, or
     a new deploy is invisible until someone clears their history. Everything
     else is content-addressed enough by the sw cache name to be safe. */
  const noCache = base === 'index.html' || base === 'sw.js';

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
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
