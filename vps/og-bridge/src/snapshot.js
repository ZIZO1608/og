/* ==========================================================================
   /snapshot — the owner's read-only view of the cloud copy.     [snapshot.js]
   --------------------------------------------------------------------------
     GET  /snapshot             the page (or the sign-in, or "the shop is
                                online — open it" while the mode is live)
     GET  /snapshot/data.json   the same figures as JSON; 401 without a session
     POST /snapshot/login       password + authenticator code (snapshot-auth.js)
     POST /snapshot/logout

   The figures are snapshot-figures.js over the rows snapshot-queries.js reads
   as og_vps — the same code the parity test runs against the till's own
   answers. Rows are cached for 30 s: a page that is reloaded ten times while
   somebody waits for the shop to come back is one query, not ten.
   ========================================================================== */
import { makeAuth, parseUsers, COOKIE } from './snapshot-auth.js';
import { figures, dayWindow } from './snapshot-figures.js';
import { loginPage, livePage, snapshotPage } from './snapshot-page.js';

const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/* ---- whose address is this: the nginx proxy's word, only from its network */
function inNet(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const n = (a) => a.split('.').reduce((x, o) => (x << 8) + (Number(o) & 255), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (n(ip) & mask) === (n(base) & mask);
}
export function visitorIp(req, proxyNets) {
  const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const nets = String(proxyNets || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (nets.some((c) => inNet(peer, c))) {
    const h = String(req.headers['x-og-client-ip'] || '').trim();
    if (h) return h;
  }
  return peer || null;
}

function readForm(req, limit = 4096) {
  return new Promise((ok, bad) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { bad(new Error('too_large')); req.destroy(); } });
    req.on('end', () => ok(Object.fromEntries(new URLSearchParams(body))));
    req.on('error', bad);
  });
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const langOf = (url, form) => {
  const l = (form && form.lang) || url.searchParams.get('lang');
  return l === 'en' ? 'en' : 'ar';
};

export function snapshotRoutes({ config, mirror, road, log = () => {}, now = () => Date.now(), auth: authIn }) {
  const auth = authIn || makeAuth({ users: parseUsers(config.snapshotUsers), now });
  let cache = null;

  async function rowsFor(window) {
    if (cache && cache.day === window.day && now() - cache.at < 30000) return cache.rows;
    const rows = await mirror.rows(window);
    cache = { day: window.day, at: now(), rows };
    return rows;
  }

  function page(res, status, html, extra = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', ...extra
    });
    res.end(html);
  }
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  }
  /* A cross-site form can make a browser POST here; SameSite=Strict keeps the
     cookie off it, and this keeps the request itself off. The pages send
     Referrer-Policy: same-origin, NOT no-referrer: under no-referrer Chrome
     sends `Origin: null` on the page's OWN form, and this check refused the
     owner's every sign-in (found by the browser suite, p4-page). */
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === String(req.headers.host || ''); } catch { return false; }
  };

  async function build() {
    const window = dayWindow(now(), config.shopTz);
    const rows = await rowsFor(window);
    return figures(rows, { window, now: now(), tz: config.shopTz });
  }

  return {
    async handle(req, res, url) {
      const user = auth.session(cookies(req)[COOKIE]);
      const p = url.pathname.replace(/\/+$/, '') || '/snapshot';

      if (p === '/snapshot/login' && req.method === 'POST') {
        if (!sameOrigin(req)) return page(res, 403, 'Refused.');
        const form = await readForm(req).catch(() => ({}));
        const lang = langOf(url, form);
        const r = await auth.login({ user: form.user, password: form.password, code: form.code, ip: visitorIp(req, config.proxyNets) });
        if (!r.ok) {
          log(`[snapshot] refused ${r.reason} for "${String(form.user || '').slice(0, 32)}" from ${visitorIp(req, config.proxyNets)}`);
          return page(res, r.reason === 'throttled' ? 429 : 401, loginPage(lang, { error: r.reason }));
        }
        log(`[snapshot] ${r.user} signed in from ${visitorIp(req, config.proxyNets)}`);
        res.writeHead(303, { Location: '/snapshot?lang=' + lang, 'Set-Cookie': auth.cookie(r.token), 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (p === '/snapshot/logout' && req.method === 'POST') {
        if (!sameOrigin(req)) return page(res, 403, 'Refused.');
        const form = await readForm(req).catch(() => ({}));
        auth.logout(cookies(req)[COOKIE]);
        res.writeHead(303, { Location: '/snapshot?lang=' + langOf(url, form), 'Set-Cookie': auth.clearCookie(), 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (p === '/snapshot/data.json' && req.method === 'GET') {
        if (!user) return json(res, 401, { ok: false, code: 'unauthenticated' });
        const s = road.state;
        if (s.mode === 'live') return json(res, 200, { ok: true, mode: 'live', beatAt: s.beatAt });
        return json(res, 200, { ok: true, mode: s.mode, beatAt: s.beatAt, ageMs: s.ageMs, figures: await build() });
      }
      if (p === '/snapshot' && req.method === 'GET') {
        const lang = langOf(url);
        if (!user) return page(res, 200, loginPage(lang));
        const s = road.state;
        if (s.mode === 'live') return page(res, 200, livePage(lang));
        return page(res, 200, snapshotPage(lang, await build(), s, { tz: config.shopTz, now: now() }));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found.\n');
    }
  };
}
