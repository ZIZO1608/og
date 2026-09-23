/* ==========================================================================
   /night — night mode: the shop, read from the cloud copy.        [night.js]
   --------------------------------------------------------------------------
   When the laptop is off or out of reach, shop.ogsports1.com/night keeps
   answering. Read from the mirror as og_vps (night-queries.js):

     GET  /night                      sign in, or home (today's numbers for
                                      the owner and the manager only)
     GET  /night/stock?q=             products and sizes, per place, "as of"
     GET  /night/customers?q=         a lookup, never a list to scroll
     GET  /night/customers/:id        one customer and their recent orders
     GET  /night/orders?status=       the last orders and where each one is
     GET  /night/request              the request being written
     GET  /night/requests[?all=1]     what became of the requests

   And ONE write, a request (035's erp.request_submit through mirror.submit):

     POST /night/request/add | /line | /customer | /save | /clear   the draft
     POST /night/request                                            send it

   The draft lives in this process's memory beside the session, with the
   idempotency key it will be sent under — a form sent twice on a slow line is
   one request. Nothing here touches the shop's data: a request WAITS until a
   person on the laptop accepts it (server/lib/requests.js).

   Every POST is checked twice: the Origin is this host (a cross-site form
   gets nothing — SameSite=Strict keeps the cookie off it as well), and the
   form carries the session's own token. Sign-in is snapshot-auth.js's door
   with night's own accounts (OG_NIGHT_USERS), cookie and path.
   ========================================================================== */
import { makeAuth, parseUsers } from './snapshot-auth.js';
import { visitorIp } from './snapshot.js';
import { figures, dayWindow } from './snapshot-figures.js';
import * as Q from './night-queries.js';
import * as P from './night-page.js';
import { buildRequest, newOp, whole, foldDigits } from './night-validate.js';

export const ROLES = ['owner', 'manager', 'staff'];
/* Today's numbers, and everybody's requests. */
const SEES_ALL = new Set(['owner', 'manager']);
const COOKIE = 'og_night';
const LANG_COOKIE = 'og_night_lang';

/* A refusal from the SQL → the field of the form it belongs under. */
const FIELD = {
  bad_name: 'name', bad_customer: 'name', bad_phone: 'phone', too_many_phone: 'phone',
  bad_items: 'items', unknown_sku: 'items', empty: 'items',
  bad_delivery: 'method', bad_city: 'city', bad_address: 'address', bad_note: 'note'
};

function readForm(req, limit = 16384) {
  return new Promise((ok, bad) => {
    let body = '';
    req.setEncoding('utf8');
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
const sameOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host || ''); } catch { return false; }
};
const exps = (rows) => Object.fromEntries((rows || []).map((c) => [c.code, Number(c.minor_exp)]));

export function nightRoutes({ config, mirror, road, log = () => {}, now = () => Date.now(), auth: authIn }) {
  const auth = authIn || makeAuth({ users: parseUsers(config.nightUsers, { roles: ROLES }), now,
                                    cookieName: COOKIE, path: '/night' });
  const tz = config.shopTz || 'Asia/Damascus';
  const submitOn = String(config.nightSubmit || 'on').toLowerCase() !== 'off';
  const perHour = Math.max(1, Number(config.nightMaxPerHour) || 20);
  const drafts = new Map();          /* session token → draft */
  const recent = new Map();          /* user → [ms of each request sent] */
  let slow = { at: 0 };              /* currencies and places: they hardly move */
  let today = { at: 0, day: null, f: null };

  const fresh = () => ({ lines: [], customer: null, method: '', city: '', address: '', note: '', op: newOp() });
  function draftOf(token) {
    if (!drafts.has(token)) drafts.set(token, fresh());
    if (drafts.size > 500) for (const t of [...drafts.keys()]) if (!auth.who(t)) drafts.delete(t);
    return drafts.get(token);
  }
  const pieces = (d) => (d ? d.lines.reduce((n, l) => n + l.qty, 0) : 0);

  async function lookup() {
    if (now() - slow.at < 5 * 60 * 1000) return slow;
    const [cur, wh] = await Promise.all([mirror.query(Q.CURRENCIES), mirror.query(Q.WAREHOUSES)]);
    slow = { at: now(), exps: exps(cur), warehouses: wh };
    return slow;
  }
  async function todayFigures() {
    const window = dayWindow(now(), tz);
    if (today.f && today.day === window.day && now() - today.at < 30000) return today.f;
    const f = figures(await mirror.rows(window), { window, now: now(), tz });
    today = { at: now(), day: window.day, f };
    return f;
  }

  function langOf(req, url, form) {
    const asked = (form && form.lang) || url.searchParams.get('lang');
    if (asked === 'en' || asked === 'ar') return { lang: asked, set: asked !== cookies(req)[LANG_COOKIE] };
    return { lang: cookies(req)[LANG_COOKIE] === 'en' ? 'en' : 'ar', set: false };
  }
  const langCookie = (lang) => `${LANG_COOKIE}=${lang}; Secure; SameSite=Strict; Path=/night; Max-Age=31536000`;

  function page(res, status, html, extra = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': P.CSP,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', ...extra
    });
    res.end(html);
  }
  function go(res, location, extra = {}) {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...extra });
    res.end();
  }
  const refused = (res) => { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Refused.\n'); };

  /* ------------------------------------------------------------- the draft */

  function saveTyped(d, form) {
    const cust = d.customer || {};
    d.customer = { id: cust.id || null, name: String(form.name ?? cust.name ?? '').slice(0, 200),
                   phone: foldDigits(String(form.phone ?? cust.phone ?? '')).slice(0, 80) };
    if (form.method === 'pickup' || form.method === 'delivery') d.method = form.method;
    if (form.city !== undefined) d.city = String(form.city).slice(0, 200);
    if (form.address !== undefined) d.address = String(form.address).slice(0, 1000);
    if (form.note !== undefined) d.note = String(form.note).slice(0, 2000);
  }

  async function skuInfo(skus) {
    if (!skus.length) return {};
    const rows = await mirror.query(Q.SKU_ROWS, [skus]);
    return Object.fromEntries(rows.map((r) => [r.sku, { name: r.name, size: r.size, colour: r.colour,
                                                       colourAr: r.colour_ar, qty: Number(r.qty || 0) }]));
  }

  async function showRequest(res, ctx, d, { errors = {}, message = null, status = 200 } = {}) {
    const info = await skuInfo(d.lines.map((l) => l.sku));
    return page(res, status, P.requestPage({ ...ctx, draftCount: pieces(d) }, { draft: d, info, errors, submitOn, message }));
  }

  async function submit(req, res, ctx, token, form) {
    const W = P.WORDS[ctx.lang];
    const d = draftOf(token);
    saveTyped(d, form);
    if (!submitOn) return showRequest(res, ctx, d, { message: P.esc(W.err.off), status: 403 });
    const built = buildRequest({ lines: d.lines, customerId: d.customer && d.customer.id, name: d.customer.name,
                                 phone: d.customer.phone, method: d.method, city: d.city, address: d.address, note: d.note });
    if (!built.ok) return showRequest(res, ctx, d, { errors: built.errors, status: 422 });

    const user = ctx.who.user.toLowerCase();
    const hour = (recent.get(user) || []).filter((t) => t > now() - 3600000);
    recent.set(user, hour);
    if (hour.length >= perHour) return showRequest(res, ctx, d, { message: P.esc(W.err.rate), status: 429 });

    let r;
    try {
      r = await mirror.submit(user, d.op, built.request);
    } catch (e) {
      /* The op is kept: if it landed after all, sending again answers it. */
      log(`[night] submit failed for ${user}: ${e.message}`);
      return showRequest(res, ctx, d, { message: P.esc(W.err.down), status: 503 });
    }
    if (!r || r.ok !== true) {
      const code = (r && r.code) || 'unsupported';
      log(`[night] ${user}'s request refused: ${code}`);
      if (code === 'op_taken' || code === 'bad_op') d.op = newOp();
      const field = FIELD[code];
      if (field) return showRequest(res, ctx, d, { errors: { [field]: code, sku: r && r.sku }, status: 422 });
      return showRequest(res, ctx, d, { message: P.esc(W.err[code] || W.err.unsupported), status: 422 });
    }
    if (!r.replayed) hour.push(now());
    log(`[night] ${user} sent ${r.ref}${r.replayed ? ' (again)' : ''}`);
    drafts.set(token, fresh());
    return go(res, '/night/requests?sent=' + encodeURIComponent(r.ref));
  }

  /* ---------------------------------------------------------------- pages */

  async function handleSigned(req, res, url, p, token, who, lang) {
    const ctx = { lang, road: road.state, tz, now: now(), who, csrf: who.csrf };
    const W = P.WORDS[lang];

    if (req.method === 'POST') {
      if (!sameOrigin(req)) return refused(res);
      const form = await readForm(req).catch(() => null);
      if (!form || !auth.formOk(token, form.t)) {
        log(`[night] a form without its session's token (${p}) from ${visitorIp(req, config.proxyNets)}`);
        return page(res, 403, P.messagePage({ ...ctx, draftCount: 0 }, 'form'));
      }
      if (form.lang === 'en' || form.lang === 'ar') ctx.lang = form.lang;

      if (p === '/night/logout') {
        auth.logout(token);
        drafts.delete(token);
        return go(res, '/night', { 'Set-Cookie': auth.clearCookie() });
      }
      if (p === '/night/request') return submit(req, res, ctx, token, form);

      const d = draftOf(token);
      if (p === '/night/request/add') {
        const sku = String(form.sku || '');
        const qty = whole(form.qty, 1, 20) || 1;
        if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sku)) {
          const line = d.lines.find((l) => l.sku === sku);
          if (line) line.qty = Math.min(20, line.qty + qty);
          else if (d.lines.length < 20) d.lines.push({ sku, qty });
        }
        const q = String(form.q || '').slice(0, 80);
        return go(res, '/night/stock?added=1' + (q ? '&q=' + encodeURIComponent(q) : ''));
      }
      if (p === '/night/request/line') {
        const i = d.lines.findIndex((l) => l.sku === String(form.sku || ''));
        if (i > -1) {
          if (form.do === 'remove') d.lines.splice(i, 1);
          else d.lines[i].qty = whole(form.qty, 1, 20) || d.lines[i].qty;
        }
        return go(res, '/night/request');
      }
      if (p === '/night/request/customer') {
        const id = whole(form.id, 1, 1e12);
        if (!id) { if (d.customer) d.customer.id = null; return go(res, '/night/request'); }
        const [c] = await mirror.query(Q.CUSTOMER, [id]);
        if (c) {
          d.customer = { id: Number(c.id), name: c.name || '', phone: c.phone || '' };
          if (!d.city && c.city) d.city = c.city;
          if (!d.address && c.address) d.address = c.address;
        }
        return go(res, '/night/request');
      }
      if (p === '/night/request/save') {
        saveTyped(d, form);
        const next = url.searchParams.get('next');
        if (next === 'forget') { d.customer.id = null; return go(res, '/night/request'); }
        return go(res, next === 'customers' ? '/night/customers' : next === 'stock' ? '/night/stock' : '/night/request');
      }
      if (p === '/night/request/clear') {
        drafts.set(token, fresh());
        return go(res, '/night/request');
      }
      return page(res, 404, P.messagePage({ ...ctx, draftCount: pieces(d) }, 'lost'));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return refused(res);
    const d = drafts.get(token);
    ctx.draftCount = pieces(d);

    if (p === '/night') {
      const seesAll = SEES_ALL.has(who.role);
      const [list, figs, look] = await Promise.all([
        mirror.requestsList(seesAll ? null : who.user.toLowerCase(), 100),
        seesAll ? todayFigures() : Promise.resolve(null),
        lookup()
      ]);
      const waiting = ((list && list.items) || []).filter((r) => r.state === 'waiting' || r.state === 'received').length;
      return page(res, 200, P.homePage(ctx, { today: figs, waiting, exps: look.exps }));
    }
    if (p === '/night/stock') {
      const q = String(url.searchParams.get('q') || '').slice(0, 80);
      const look = await lookup();
      const s = Q.stockSearch(foldDigits(q));
      const ids = (await mirror.query(s.sql, s.params)).map((r) => Number(r.id));
      const rows = ids.length ? await mirror.query(Q.STOCK_ROWS, [ids]) : [];
      const inDraft = new Map((d ? d.lines : []).map((l) => [l.sku, l.qty]));
      const added = url.searchParams.get('added') ? W.added : null;
      return page(res, 200, P.stockPage(ctx, { q, products: P.groupStock(rows, ids), warehouses: look.warehouses,
                                                exps: look.exps, draft: inDraft, added }));
    }
    if (p === '/night/customers') {
      const q = foldDigits(String(url.searchParams.get('q') || '')).slice(0, 60);
      let rows = [];
      if (q.trim().length >= 2) {
        const s = Q.customerSearch(q);
        rows = await mirror.query(s.sql, s.params);
      }
      return page(res, 200, P.customersPage(ctx, { q, rows }));
    }
    const cm = /^\/night\/customers\/(\d{1,12})$/.exec(p);
    if (cm) {
      const [c] = await mirror.query(Q.CUSTOMER, [Number(cm[1])]);
      if (!c) return page(res, 404, P.customersPage(ctx, { q: '', rows: [] }));
      const [orders, look] = await Promise.all([mirror.query(Q.CUSTOMER_ORDERS, [Number(cm[1])]), lookup()]);
      const items = await itemsOf(orders.map((o) => o.id));
      return page(res, 200, P.customerPage(ctx, { c, orders, items, exps: look.exps }));
    }
    if (p === '/night/orders') {
      const status = String(url.searchParams.get('status') || '');
      const s = Q.recentOrders(status);
      const [rows, look] = await Promise.all([mirror.query(s.sql, s.params), lookup()]);
      const items = await itemsOf(rows.map((o) => o.id));
      return page(res, 200, P.ordersPage(ctx, { status: Q.ORDER_STATUSES.includes(status) ? status : '', rows, items, exps: look.exps }));
    }
    if (p === '/night/request') {
      return showRequest(res, ctx, d || draftOf(token));
    }
    if (p === '/night/requests') {
      const seesAll = SEES_ALL.has(who.role);
      const scope = seesAll && url.searchParams.get('all') ? 'all' : 'mine';
      const list = await mirror.requestsList(scope === 'all' ? null : who.user.toLowerCase(), 50);
      const sent = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(url.searchParams.get('sent') || '') ? url.searchParams.get('sent') : null;
      return page(res, 200, P.requestsPage(ctx, { items: (list && list.items) || [], scope, canAll: seesAll, sent }));
    }
    return page(res, 404, P.messagePage(ctx, 'lost'));
  }

  async function itemsOf(ids) {
    if (!ids.length) return {};
    const out = {};
    for (const r of await mirror.query(Q.ITEMS_OF, [ids])) (out[r.sale_id] = out[r.sale_id] || []).push(r);
    return out;
  }

  return {
    auth,
    async handle(req, res, url) {
      const p = url.pathname.replace(/\/+$/, '') || '/night';
      const token = cookies(req)[COOKIE];
      const who = auth.who(token);

      if (p === '/night/login' && req.method === 'POST') {
        if (!sameOrigin(req)) return refused(res);
        const form = await readForm(req).catch(() => ({}));
        const { lang } = langOf(req, url, form);
        const ip = visitorIp(req, config.proxyNets);
        const r = await auth.login({ user: form.user, password: form.password, code: form.code, ip });
        if (!r.ok) {
          log(`[night] refused ${r.reason} for "${String(form.user || '').slice(0, 32)}" from ${ip}`);
          return page(res, r.reason === 'throttled' ? 429 : 401,
                      P.signinPage(lang, { error: r.reason, road: road.state, tz, now: now() }));
        }
        log(`[night] ${r.user} (${r.role}) signed in from ${ip}`);
        return go(res, '/night', { 'Set-Cookie': [auth.cookie(r.token), langCookie(lang)] });
      }

      const { lang, set } = langOf(req, url, null);
      const extra = set ? { 'Set-Cookie': langCookie(lang) } : {};
      if (!who) {
        if (req.method === 'GET' && p === '/night') {
          return page(res, 200, P.signinPage(lang, { road: road.state, tz, now: now() }), extra);
        }
        return go(res, '/night', extra);
      }
      try {
        if (set && req.method === 'GET') {
          /* The language is a cookie from here on: send it with this page. */
          const orig = res.writeHead.bind(res);
          res.writeHead = (status, headers = {}) => orig(status, { ...headers, ...extra });
        }
        return await handleSigned(req, res, url, p, token, who, lang);
      } catch (e) {
        log('[night] ' + (e && e.stack || e));
        if (res.headersSent) return res.end();
        return page(res, 503, P.downPage({ lang, road: road.state, tz, now: now(), who, csrf: who.csrf }));
      }
    }
  };
}
