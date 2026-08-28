/* ==========================================================================
   OG SYSTEM — server
   --------------------------------------------------------------------------
   Serves the API and the app itself from one origin.

   Run:   node index.js
   Env:   OG_PORT      default 8090
          OG_DB        default ./data/og.db
          OG_STATIC    default ../  (the app folder alongside this one)
          OG_ORIGINS   comma-separated list allowed to make state-changing
                       calls. Leave unset in development; set it in production.
          OG_SECURE    '1' when behind HTTPS, so cookies get the Secure flag.

          All of the above may instead live in server/.env — see
          server/.env.example. Real environment variables override the file.

   Zero npm dependencies. Deployment is: copy the folder, run node.
   ========================================================================== */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadEnv } from './lib/env.js';
import * as DB from './lib/db.js';
import * as Auth from './lib/auth.js';
import * as Cat from './lib/catalogue.js';
import * as Stock from './lib/stock.js';
import * as Sales from './lib/sales.js';
import * as Customers from './lib/customers.js';
import * as Deliveries from './lib/deliveries.js';
import * as Receipt from './lib/receipt.js';
import * as Printing from './lib/printing.js';
import * as Labels from './lib/labels.js';
import {
  readJson, sendOk, sendError, sendJson, parseCookies,
  serveStatic, makeRouter, originAllowed
} from './lib/http.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Before anything reads process.env. server/.env is optional — with no file
   the server starts exactly as it always did — but when one exists its
   values must be in place before the constants below are computed. Real
   environment variables still win over the file. */
loadEnv();

const PORT    = Number(process.env.OG_PORT || 8090);
const DB_FILE = process.env.OG_DB || resolve(HERE, 'data', 'og.db');
const STATIC  = resolve(process.env.OG_STATIC || resolve(HERE, '..'));
const SECURE  = process.env.OG_SECURE === '1';
const ORIGINS = (process.env.OG_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* ------------------------------------------------------------------ routes */

const router = makeRouter();

/* Anything not in here requires a valid session. Denying by default means a
   new endpoint is locked until someone deliberately opens it. */
const PUBLIC = new Set([
  'POST /api/auth/login',
  'POST /api/auth/hint',
  'GET /api/health'
]);

/* --- health ---------------------------------------------------------------- */

router.add('GET /api/health', (ctx) => {
  /* Touches the database rather than just returning 200, so a monitor notices
     a corrupt or missing file instead of reporting a healthy dead server. */
  const row = DB.get().prepare('SELECT COUNT(*) AS n FROM warehouses').get();
  sendOk(ctx.res, { warehouses: row.n, time: DB.nowIso() });
});

/* --- auth ------------------------------------------------------------------ */

router.add('POST /api/auth/login', async (ctx) => {
  const { username, password } = await readJson(ctx.req);

  if (typeof username !== 'string' || typeof password !== 'string') {
    return sendError(ctx.res, 400, 'bad_request', 'username and password are required');
  }

  const r = await Auth.login(username, password, clientIp(ctx.req),
                             ctx.req.headers['user-agent']);

  if (!r.ok) {
    const status = r.reason === 'too_many_attempts' ? 429 : 401;
    const message = {
      bad_credentials:   'Wrong username or password.',
      disabled:          'This account has been switched off. Ask a manager.',
      too_many_attempts: 'Too many attempts. Wait 15 minutes and try again.'
    }[r.reason] || 'Could not sign in.';
    return sendError(ctx.res, status, r.reason, message);
  }

  sendOk(ctx.res,
    { user: Auth.publicUser(r.user) },
    { 'Set-Cookie': Auth.cookieHeader(r.token, { secure: SECURE }) });
});

router.add('POST /api/auth/logout', (ctx) => {
  Auth.destroySession(ctx.token);
  sendOk(ctx.res, {}, { 'Set-Cookie': Auth.clearCookieHeader({ secure: SECURE }) });
});

router.add('GET /api/auth/me', (ctx) => {
  sendOk(ctx.res, { user: Auth.publicUser(ctx.user) });
});

/* The password hint. Throttled exactly like a login, because without that it
   is a way to read every hint in the building one username at a time. */
router.add('POST /api/auth/hint', async (ctx) => {
  const { username } = await readJson(ctx.req);
  if (typeof username !== 'string') {
    return sendError(ctx.res, 400, 'bad_request', 'username is required');
  }
  if (Auth.recentFailures(username) >= 8) {
    return sendError(ctx.res, 429, 'too_many_attempts', 'Too many attempts.');
  }
  Auth.recordAttempt(username, clientIp(ctx.req), false);
  sendOk(ctx.res, { hint: Auth.hintFor(username) });
});

router.add('POST /api/auth/password', async (ctx) => {
  const { current, next } = await readJson(ctx.req);

  /* Changing a password requires proving you know the current one, even
     though a session is already open. Otherwise a till left unlocked for two
     minutes is a permanent account takeover. */
  const ok = await Auth.verifyPassword(String(current ?? ''),
                                       ctx.user.pw_hash, ctx.user.pw_salt);
  if (!ok) return sendError(ctx.res, 403, 'bad_credentials', 'Current password is wrong.');

  try {
    await Auth.changePassword(ctx.user.id, String(next ?? ''));
  } catch (e) {
    return sendError(ctx.res, 400, 'weak_password', e.message);
  }

  /* changePassword drops every session, this one included, so the client must
     sign in again. Saying so explicitly stops it looking like a bug. */
  sendOk(ctx.res, { reauth: true },
         { 'Set-Cookie': Auth.clearCookieHeader({ secure: SECURE }) });
});

/* --- staff ----------------------------------------------------------------- */

router.add('GET /api/users', requirePerm('staff.read', (ctx) => {
  const rows = DB.get().prepare(
    'SELECT * FROM users ORDER BY active DESC, name'
  ).all();
  sendOk(ctx.res, { users: rows.map(Auth.publicUser) });
}));

router.add('POST /api/users', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const id = await Auth.createUser({
      username: b.username, name: b.name, role: b.role,
      password: b.password, hint: b.hint, phone: b.phone
    });
    sendOk(ctx.res, { user: Auth.publicUser(Auth.findById(id)) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('POST /api/users/:id/reset', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  const target = Auth.findById(Number(ctx.params.id));
  if (!target) return sendError(ctx.res, 404, 'not_found', 'No such user.');

  try {
    await Auth.resetPassword(target.id, String(b.password ?? ''));
    sendOk(ctx.res, { mustChange: true });
  } catch (e) {
    sendError(ctx.res, 400, 'weak_password', e.message);
  }
}));

router.add('POST /api/users/:id/active', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  const id = Number(ctx.params.id);

  /* Locking yourself out of the only manager account is unrecoverable without
     shell access to the server. */
  if (id === ctx.user.id && !b.active) {
    return sendError(ctx.res, 400, 'self_lockout', 'You cannot switch off your own account.');
  }

  DB.get().prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?')
          .run(b.active ? 1 : 0, DB.nowIso(), id);
  if (!b.active) Auth.destroyAllSessions(id);

  sendOk(ctx.res, { user: Auth.publicUser(Auth.findById(id)) });
}));

/* --- roles ------------------------------------------------------------------ */

/* Readable by anyone signed in: the app draws its own menu from this, and a
   cashier needs to know what a cashier may do. It exposes no data, only rules. */
router.add('GET /api/roles', (ctx) => {
  sendOk(ctx.res, Auth.permissionMatrix());
});

router.add('PUT /api/roles/:role', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = Auth.setRolePermissions(
      ctx.params.role,
      Array.isArray(b.granted) ? b.granted : [],
      ctx.user.id
    );

    /* `refused` is the honest part. The request may have asked for something
       that cannot be granted — or to drop something a manager must keep — and
       the screen should say so rather than silently showing a tick that did
       not stick. */
    sendOk(ctx.res, { ...out, matrix: Auth.permissionMatrix() });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- reference data -------------------------------------------------------- */

router.add('GET /api/config', (ctx) => {
  /* Everything the app needs before it can draw anything: the two warehouses,
     the currencies and their minor-unit exponents, the live rate, and the
     settings that used to be constants in js/data.js. */
  const d = DB.get();
  const config = {};
  for (const r of d.prepare('SELECT key, value FROM config').all()) {
    config[r.key] = r.value;
  }

  sendOk(ctx.res, {
    warehouses: d.prepare('SELECT * FROM warehouses ORDER BY sort').all(),
    currencies: Cat.currencies(),
    rate: Cat.currentRate('USD', 'SYP'),
    config
  });
});

router.add('POST /api/fx', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.setRate({
      base: b.base ?? 'USD', quote: b.quote ?? 'SYP',
      rate: Number(b.rate), userId: ctx.user.id
    }));
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* Everything under receipt.* (printer address, paper toggles, the printed
   policy text) plus the two shop.* identity fields the receipt header reads
   that shop.* itself doesn't already have a writer for. Restricted to that
   allowlist rather than any config key — this route exists for the receipt
   Settings card, not as a general "edit the config table" backdoor. */
const CONFIG_WRITABLE = /^receipt\.|^shop\.(branch_name|phone)$|^label\.(default_preset|transport|printer_host|printer_port|stations|density|speed|gap_mm|logo_asset|code_source|max_batch|lease_minutes|calibrate_cmd)$/;

router.add('PUT /api/config', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  const updates = b.updates && typeof b.updates === 'object' ? b.updates : {};
  const keys = Object.keys(updates);
  if (!keys.length) return sendError(ctx.res, 400, 'invalid', 'Nothing to save.');

  for (const k of keys) {
    if (!CONFIG_WRITABLE.test(k)) {
      return sendError(ctx.res, 400, 'invalid', `${k} cannot be changed here.`);
    }
  }

  const at = DB.nowIso();
  DB.tx((d) => {
    const stmt = d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const k of keys) stmt.run(k, String(updates[k]), at);
  });

  const config = {};
  for (const r of DB.get().prepare('SELECT key, value FROM config').all()) config[r.key] = r.value;
  sendOk(ctx.res, { config });
}));

/* --- catalogue ------------------------------------------------------------- */

/* The whole catalogue in one call. This is what the browser loads on sign-in
   to fill its in-memory cache, which is what keeps DB.* synchronous and the
   858 frontend tests intact. A shop's catalogue is a few hundred KB. */
router.add('GET /api/catalogue', requirePerm('product.read', (ctx) => {
  const products = Cat.list({ includeHidden: Auth.can(ctx.user, 'product.write') });
  sendOk(ctx.res, { products: products.map(p => scrubCost(p, ctx.user)) });
}));

router.add('GET /api/scan/:code', requirePerm('product.read', (ctx) => {
  const hit = Cat.byBarcode(ctx.params.code);
  if (!hit) return sendError(ctx.res, 404, 'unknown_code', 'Nothing matches that code.');
  sendOk(ctx.res, {
    variant: scrubCost(hit, ctx.user),
    stock: Stock.placesFor(hit.sku)
  });
}));

router.add('POST /api/products', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.createWithVariants({ ...b, userId: ctx.user.id }));
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('PATCH /api/products/:id', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { product: Cat.update(Number(ctx.params.id), b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('POST /api/products/:id/variants', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.addVariant({
      productId: Number(ctx.params.id), size: b.size,
      barcode: b.barcode, shelf: b.shelf, userId: ctx.user.id
    }));
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- stock ------------------------------------------------------------------ */

router.add('GET /api/stock/:sku', requirePerm('stock.read', (ctx) => {
  sendOk(ctx.res, {
    sku: ctx.params.sku,
    places: Stock.placesFor(ctx.params.sku),
    total: Stock.totalFor(ctx.params.sku)
  });
}));

router.add('GET /api/stock/:sku/movements', requirePerm('stock.read', (ctx) => {
  const limit = Math.min(Number(ctx.url.searchParams.get('limit')) || 50, 500);
  sendOk(ctx.res, { movements: Stock.movementsFor(ctx.params.sku, limit) });
}));

router.add('POST /api/stock/receive', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  await stockOp(ctx, () => Stock.receive({
    sku: b.sku, whId: b.whId, qty: Number(b.qty), note: b.note, userId: ctx.user.id
  }));
}));

router.add('POST /api/stock/transfer', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  await stockOp(ctx, () => Stock.transfer({
    sku: b.sku, from: b.from, to: b.to, qty: Number(b.qty),
    note: b.note, userId: ctx.user.id
  }));
}));

router.add('POST /api/stock/writeoff', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  await stockOp(ctx, () => Stock.writeOff({
    sku: b.sku, whId: b.whId, qty: Number(b.qty), note: b.note, userId: ctx.user.id
  }));
}));

router.add('POST /api/stock/count', requirePerm('stock.count', async (ctx) => {
  const b = await readJson(ctx.req);
  await stockOp(ctx, () => Stock.reconcile({
    sku: b.sku, whId: b.whId, counted: Number(b.counted),
    note: b.note, userId: ctx.user.id
  }));
}));

router.add('GET /api/stock', requirePerm('stock.read', (ctx) => {
  const wh = ctx.url.searchParams.get('wh') || 'floor';
  const below = Number(ctx.url.searchParams.get('below')) || 10;
  sendOk(ctx.res, { low: Stock.lowStock(wh, below) });
}));

/* The whole shop's movement log. `movements/:sku` above is the trail for one
   size; this is the warehouse's Moves tab, which shows everything. */
router.add('GET /api/movements', requirePerm('stock.read', (ctx) => {
  const limit = Math.min(Number(ctx.url.searchParams.get('limit')) || 200, 1000);
  sendOk(ctx.res, { movements: Stock.recent(limit) });
}));

/* --- customers --------------------------------------------------------------
   `customer.*` is in FORBIDDEN for the partner role in lib/auth.js, so Yalla
   Wear cannot be granted these however the tick boxes are set. They are a
   different company; the shop's customer list is not theirs to hold. */

router.add('GET /api/customers', requirePerm('customer.read', (ctx) => {
  sendOk(ctx.res, {
    customers: Customers.list({
      includeArchived: Auth.can(ctx.user, 'customer.write')
    })
  });
}));

router.add('GET /api/customers/:id/history', requirePerm('customer.read', (ctx) => {
  const c = Customers.byId(Number(ctx.params.id));
  if (!c) return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  sendOk(ctx.res, { sales: Customers.historyFor(c.id).map(s => scrubCost(s, ctx.user)) });
}));

router.add('POST /api/customers', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { customer: Customers.create(b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('PATCH /api/customers/:id', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { customer: Customers.update(Number(ctx.params.id), b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* A deliberate correction to a balance, by hand. Selling and redeeming move
   points through the sale, never through here — that is why this needs
   `customer.write` and says who did it in the change log. */
router.add('POST /api/customers/:id/points', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Customers.adjustPoints(Number(ctx.params.id), b.delta, {
      reason: b.reason, userId: ctx.user.id
    }));
  } catch (e) {
    if (e.code === 'not_enough_points') {
      return sendError(ctx.res, 409, 'not_enough_points', e.message);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- sales ------------------------------------------------------------------ */

router.add('POST /api/sales', requirePerm('sell', async (ctx) => {
  const b = await readJson(ctx.req);

  /* Note what is NOT taken from the body: prices. The client sends what was
     scanned and how many, and the server prices it from the product table. A
     till that can name its own price is a till that can sell a 450,000 pair
     for 1,000 and leave a receipt that looks perfectly ordinary. */
  try {
    const sale = Sales.record({
      lines: Array.isArray(b.lines) ? b.lines : [],
      whId: b.whId,
      customerId: b.customerId ? Number(b.customerId) : null,
      payment: b.payment,
      discount: Number(b.discount) || 0,
      /* A count of points, not an amount. The server values them from the
         config table — the till knowing what a point is worth is a display
         detail, not an authority. */
      pointsUsed: Number(b.pointsUsed) || 0,
      currency: b.currency,
      note: b.note,
      userId: ctx.user.id,
      /* Read from the caller's role, never from the request. */
      unlimitedDiscount: Auth.can(ctx.user, 'discount.unlimited'),
      /* The till generates this. On a retry after a dropped connection the
         same id comes back and returns the original invoice rather than
         selling everything a second time. */
      opId: typeof b.opId === 'string' ? b.opId : null
    });
    sendOk(ctx.res, { sale: scrubCost(sale, ctx.user) });
  } catch (e) {
    if (e.code === 'insufficient_stock') {
      return sendError(ctx.res, 409, 'insufficient_stock',
        `Only ${e.available} of ${e.sku} left — the other till may have just sold it.`,
        {});
    }
    /* 403, not 400: the sale is well-formed, the person is not allowed to
       make it. The till tells them to fetch a manager rather than showing
       them a validation error about their own basket. */
    if (e.code === 'discount_too_big') {
      return sendError(ctx.res, 403, 'discount_too_big', e.message,
        { maxPct: e.maxPct, ceiling: e.ceiling });
    }
    /* 409, not 400: the basket is fine and so is the request. The world
       moved — someone spent those points, or the balance was corrected —
       which is the same shape of answer as insufficient_stock and wants the
       same response at the till: reload and try again. */
    if (e.code === 'not_enough_points') {
      return sendError(ctx.res, 409, 'not_enough_points', e.message,
        { available: e.available });
    }
    if (e.code === 'points_exceed_total') {
      return sendError(ctx.res, 409, 'points_exceed_total', e.message,
        { room: e.room });
    }
    if (e.code === 'unknown_customer') {
      return sendError(ctx.res, 409, 'unknown_customer', e.message);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('GET /api/sales', requirePerm('sell', (ctx) => {
  const limit = Math.min(200, Number(ctx.url.searchParams.get('limit')) || 50);
  sendOk(ctx.res, {
    sales: Sales.recent(limit).map(s => scrubCost(s, ctx.user))
  });
}));

router.add('GET /api/sales/:id', requirePerm('sell', (ctx) => {
  const s = Sales.byId(ctx.params.id);
  if (!s) return sendError(ctx.res, 404, 'not_found', 'No such invoice.');
  s.items = s.items.map(i => scrubCost(i, ctx.user));
  sendOk(ctx.res, { sale: scrubCost(s, ctx.user) });
}));

/* Voiding is a manager's job, not a cashier's. A cashier who can void their
   own sale can take the cash and leave no trace, which is the commonest way
   money walks out of a shop. */
router.add('POST /api/sales/:id/void', requirePerm('void', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      result: Sales.voidSale(ctx.params.id, { reason: b.reason, userId: ctx.user.id })
    });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- the 80mm thermal receipt -----------------------------------------------
   Both routes need `sale.reprint`, not `sell` — printing the receipt for the
   sale you are actively completing is part of selling, but reading or
   re-sending the bytes for ANY invoice by id is the fraud-relevant action the
   task called out, so it gets its own permission rather than riding on `sell`.
   `sale.reprint` is FORBIDDEN for `partner` in lib/auth.js, and Yalla Wear
   never has `sell` either — a payload carrying a customer's name and phone
   number has no business reaching that role twice over. */

router.add('GET /api/sales/:id/receipt', requirePerm('sale.reprint', (ctx) => {
  const s = Printing.data(ctx.params.id);
  if (!s) return sendError(ctx.res, 404, 'not_found', 'No such invoice.');
  sendOk(ctx.res, { receipt: scrubCost(s, ctx.user) });
}));

router.add('POST /api/print', requirePerm('sale.reprint', async (ctx) => {
  const b = await readJson(ctx.req);
  if (typeof b.bytes !== 'string' || !b.bytes) {
    return sendError(ctx.res, 400, 'invalid', 'No print data was sent.');
  }
  let bytes;
  try {
    bytes = Buffer.from(b.bytes, 'base64');
  } catch {
    return sendError(ctx.res, 400, 'invalid', 'The print data was not valid base64.');
  }

  try {
    const result = await Printing.send({
      saleId: b.saleId,
      userId: ctx.user.id,
      bytes,
      copies: Number(b.copies) || 1,
      opId: typeof b.opId === 'string' ? b.opId : null
    });
    sendOk(ctx.res, result);
  } catch (e) {
    /* A printer that is off, out of paper, or unreachable is not the same
       kind of failure as a bad request — the sale already happened, and the
       till needs to know "try again", not "something is wrong with what you
       sent". 502: the server did its job, the device on the other end did
       not answer. */
    if (e.code === 'no_printer' || e.code === 'printer_unreachable' ||
        e.code === 'printer_timeout' || e.code === 'printer_write_failed') {
      return sendError(ctx.res, 502, e.code, e.message);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- deliveries -------------------------------------------------------------
   A driver is scoped to his own runs inside lib/deliveries.js, by role, not by
   what the request asks for. These routes never take a driver id from the
   caller for reading — there is no query parameter that widens the view. */

router.add('GET /api/deliveries', requirePerm('delivery.read', (ctx) => {
  sendOk(ctx.res, {
    deliveries: Deliveries.list(ctx.user, {
      status: ctx.url.searchParams.get('status') || null,
      limit: Number(ctx.url.searchParams.get('limit')) || 100
    }),
    /* His own day when he is a driver, so the phone can show a running
       count without a second request. */
    day: ctx.user.role === 'delivery' ? Deliveries.driverDay(ctx.user.id) : null
  });
}));

router.add('GET /api/deliveries/:id', requirePerm('delivery.read', (ctx) => {
  const d = Deliveries.byId(Number(ctx.params.id), ctx.user);
  /* Someone else's delivery answers exactly like one that does not exist. A
     driver must not be able to learn that a delivery to that address happened
     by telling a 403 from a 404. */
  if (!d) return sendError(ctx.res, 404, 'not_found', 'No such delivery.');
  sendOk(ctx.res, { delivery: d });
}));

router.add('POST /api/deliveries', requirePerm('delivery.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      delivery: Deliveries.assign({
        saleId: b.saleId,
        driverId: b.driverId ? Number(b.driverId) : null,
        address: b.address,
        phone: b.phone,
        note: b.note,
        byUserId: ctx.user.id,
        opId: typeof b.opId === 'string' ? b.opId : null
      })
    });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('PATCH /api/deliveries/:id', requirePerm('delivery.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      delivery: Deliveries.update(Number(ctx.params.id), {
        status: b.status,
        collected: b.collected,
        reason: b.reason,
        driverId: b.driverId === undefined ? undefined : (b.driverId ? Number(b.driverId) : null),
        address: b.address,
        phone: b.phone
      }, ctx.user)
    });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --- product labels (XP-235B / TSPL) ----------------------------------------
   A separate printer, a separate queue, a separate concern from the 80mm
   thermal receipt above — see server/lib/labels.js's own header for why.

   GET /api/labels/next deliberately holds the response open for up to ~25s
   (Labels.next()'s bounded-wait loop) so the agent doesn't have to busy-poll.
   It must NEVER be called through js/api.js — that module's request() aborts
   every call at a hard 15s (js/api.js:31) — only agent/print-agent.js, over
   raw node:http with no such timeout, calls it. */

router.add('POST /api/labels/print', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  if (!Array.isArray(b.lines) || !b.lines.length) {
    return sendError(ctx.res, 400, 'invalid', 'No lines to print.');
  }
  try {
    const result = Labels.enqueue({
      lines: b.lines, presetKey: b.preset, station: b.station,
      userId: ctx.user.id, opId: typeof b.opId === 'string' ? b.opId : null,
      arabicBitmaps: b.arabicBitmaps || {}, barcodeType: b.barcodeType
    });

    /* Only when a manager has switched the transport to 'tcp' (a USB→LAN
       adapter is on the printer) does the server dispatch here and now,
       rather than leaving the jobs for an agent to poll for. */
    if (!result.replayed) {
      const d = DB.get();
      const transport = d.prepare("SELECT value FROM config WHERE key = 'label.transport'").get()?.value;
      if (transport === 'tcp') {
        const host = d.prepare("SELECT value FROM config WHERE key = 'label.printer_host'").get()?.value;
        const port = Number(d.prepare("SELECT value FROM config WHERE key = 'label.printer_port'").get()?.value) || 9100;
        await Labels.dispatchTcp(result.jobIds, { host, port });
      }
    }

    sendOk(ctx.res, result);
  } catch (e) {
    sendError(ctx.res, e.code === 'batch_too_large' ? 413 : e.code === 'barcode_too_wide' ? 409 : 400, e.code || 'invalid', e.message);
  }
}));

router.add('POST /api/labels/preview', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  if (!Labels.isValidBarcodeType(b.barcodeType)) {
    return sendError(ctx.res, 400, 'invalid', 'Invalid barcodeType.');
  }
  try {
    const tpl = Labels.template(b.preset);
    const lines = (b.lines || []).map((l) => {
      const variant = Labels.resolveVariant(l.sku || l.variantId);
      return {
        sku: variant.sku, qty: l.qty, name: variant.name, size: variant.size,
        layout: Labels.computeLayout(variant, tpl, { barcodeType: b.barcodeType })
      };
    });
    sendOk(ctx.res, { preset: tpl, lines });
  } catch (e) {
    sendError(ctx.res, e.code === 'barcode_too_wide' ? 409 : 400, e.code || 'invalid', e.message);
  }
}));

router.add('GET /api/labels/next', requirePerm('label.print', async (ctx) => {
  const station = ctx.url.searchParams.get('station');
  if (!station) return sendError(ctx.res, 400, 'invalid', 'station is required');
  const job = await Labels.next({ station });
  sendOk(ctx.res, { job });
}));

router.add('POST /api/labels/:id/done', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  sendOk(ctx.res, Labels.complete(Number(ctx.params.id), b.claimToken, 'done', null));
}));

router.add('POST /api/labels/:id/failed', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  sendOk(ctx.res, Labels.complete(Number(ctx.params.id), b.claimToken, 'failed', String(b.error || 'unknown error')));
}));

router.add('POST /api/labels/:id/cancel', requirePerm('label.print', (ctx) => {
  const r = Labels.cancel(Number(ctx.params.id), ctx.user.id);
  if (!r.ok) return sendError(ctx.res, 409, 'not_cancellable', 'Already claimed or resolved.');
  sendOk(ctx.res, r);
}));

router.add('POST /api/labels/calibrate', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const result = Labels.calibrate({ station: b.station, userId: ctx.user.id, opId: typeof b.opId === 'string' ? b.opId : null });
    if (!result.replayed) {
      const d = DB.get();
      const transport = d.prepare("SELECT value FROM config WHERE key = 'label.transport'").get()?.value;
      if (transport === 'tcp') {
        const host = d.prepare("SELECT value FROM config WHERE key = 'label.printer_host'").get()?.value;
        const port = Number(d.prepare("SELECT value FROM config WHERE key = 'label.printer_port'").get()?.value) || 9100;
        await Labels.dispatchTcp([result.jobId], { host, port });
      }
    }
    sendOk(ctx.res, result);
  } catch (e) {
    sendError(ctx.res, 400, e.code || 'invalid', e.message);
  }
}));

router.add('GET /api/labels/queue', requirePerm('label.print', (ctx) => {
  sendOk(ctx.res, { jobs: Labels.queue({ station: ctx.url.searchParams.get('station') || null }) });
}));

/* Attaching a scanned code to a variant is product editing, not label
   printing — reuses product.write rather than a new permission. */
router.add('PATCH /api/variants/:sku', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { variant: Cat.attachCode(ctx.params.sku, { barcode: b.barcode, labelCode: b.labelCode }, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* --------------------------------------------------------------- middleware */

/* Run a stock change, turning "not enough" into a 409 with the real numbers so
   the till can say "only 2 left" instead of "operation failed". */
async function stockOp(ctx, fn) {
  try {
    sendOk(ctx.res, { result: fn() });
  } catch (e) {
    if (e.code === 'insufficient_stock') {
      return sendError(ctx.res, 409, 'insufficient_stock',
        `Only ${e.available} left${e.whId ? ` at ${e.whId}` : ''}.`);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}

/* Remove cost and margin for anyone without `cost.read`.

   The permission table already says a cashier cannot see cost. That promise is
   only real if the numbers never leave the server — hiding a column in the UI
   is not a boundary when the browser can read the response. */
/* Every key that says what something cost us or what we made on it.

   Listed by name rather than matched on a pattern, because a pattern that
   catches `cost_price` also catches `costume` one day and silently deletes a
   product field. The trade is that a NEW cost column has to be added here —
   which is why the list is short, obvious, and sits next to the function that
   uses it rather than three files away. */
const COST_KEYS = [
  'cost_price', 'costPrice',
  'unit_cost', 'unitCost',
  'profit', 'margin'
];

function stripCost(row) {
  const out = { ...row };
  for (const k of COST_KEYS) delete out[k];
  return out;
}

function scrubCost(row, user) {
  if (Auth.can(user, 'cost.read')) return row;

  const out = stripCost(row);

  /* A sale carries its cost in the lines, not the header, so scrubbing only
     the top level would hand a cashier every unit_cost in the basket. */
  if (Array.isArray(out.variants)) out.variants = out.variants.map(stripCost);
  if (Array.isArray(out.items))    out.items    = out.items.map(stripCost);

  return out;
}

function requirePerm(perm, handler) {
  return (ctx) => {
    if (!Auth.can(ctx.user, perm)) {
      return sendError(ctx.res, 403, 'forbidden',
        'Your account does not have access to this.');
    }
    return handler(ctx);
  };
}

function clientIp(req) {
  /* Behind a reverse proxy the socket address is the proxy. Trust the
     forwarded header only when a proxy is actually configured, otherwise a
     client can spoof it and slip the login throttle. */
  const fwd = req.headers['x-forwarded-for'];
  if (fwd && process.env.OG_TRUST_PROXY === '1') {
    return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || null;
}

/* ------------------------------------------------------------------- server */

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    try {
      /* --- API ------------------------------------------------------------ */
      if (path.startsWith('/api/')) {
        const key = `${req.method} ${path}`;

        /* CSRF: a cross-site page can make the browser send its cookie, so
           anything that changes state must come from our own origin. */
        if (req.method !== 'GET' && !originAllowed(req, ORIGINS)) {
          return sendError(res, 403, 'bad_origin', 'Request rejected.');
        }

        const hit = router.match(req.method, path);
        if (!hit) {
          const allowed = router.methodsFor(path);
          if (allowed.length) {
            return sendError(res, 405, 'method_not_allowed',
              `Use ${allowed.join(' or ')}.`, { Allow: allowed.join(', ') });
          }
          return sendError(res, 404, 'not_found', 'No such endpoint.');
        }

        const token = parseCookies(req)[Auth.COOKIE] || null;
        const user = token ? Auth.userForToken(token) : null;

        if (!PUBLIC.has(key) && !user) {
          return sendError(res, 401, 'unauthenticated', 'Please sign in.');
        }

        return await hit.handler({ req, res, url, params: hit.params, user, token });
      }

      /* --- a customer's own receipt ---------------------------------------
         Deliberately not under /api/ and deliberately not behind the session
         check: this is the QR on a paper receipt, opened by a stranger on a
         phone, possibly years later. It returns HTML, not JSON, and it has to
         be intercepted here — the static fallback below hands index.html to
         any extensionless path, so /i/<token> would otherwise silently serve
         the whole signed-in app to the public.

         The token is the only credential, so it is the only thing checked:
         32 hex characters, matched exactly, no lookup by invoice number.

         The whole /i/ prefix is claimed, not just well-formed tokens. A
         mistyped code has to answer "receipt not found" — if only the valid
         shape were caught, /i/INV-2101 would fall through to the static
         handler below and hand a customer the shop's login screen. */
      if (path.startsWith('/i/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const inv = /^\/i\/([0-9a-f]{32})$/.exec(path);
        const sale = inv ? Receipt.byToken(inv[1]) : null;
        const body = sale ? Receipt.render(sale) : Receipt.notFound();
        res.writeHead(sale ? 200 : 404, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          /* A receipt is personal and must not sit in a shared cache, and it
             is not something a search engine should keep a copy of. */
          'Cache-Control': 'private, no-store',
          'X-Robots-Tag': 'noindex, nofollow'
        });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }

      /* --- the app itself -------------------------------------------------- */
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (serveStatic(req, res, STATIC, path)) return;

        /* Unknown path with no file: hand back index.html so a refresh deep in
           the app does not 404. */
        if (!path.includes('.') && serveStatic(req, res, STATIC, '/index.html')) return;
      }

      sendError(res, 404, 'not_found', 'Not found.');

    } catch (err) {
      /* One place where every unhandled failure lands. The client is told
         nothing useful about the internals; the operator gets the stack. */
      const status = err.status || 500;
      if (status >= 500) {
        console.error(`[${DB.nowIso()}] ${req.method} ${path} —`, err);
      }
      if (!res.headersSent) {
        sendError(res, status, status >= 500 ? 'server_error' : 'bad_request',
          status >= 500 ? 'Something went wrong on the server.' : err.message);
      } else {
        res.end();
      }
    }
  });
}

/* Every address on this machine another device could reach it by.

   Virtual adapters — VPN clients, WSL, Hyper-V — hand out addresses that look
   exactly like a home network but are not the one the phone is on, and typing
   one of those is a "the system is broken" phone call. They go last, named, so
   the obvious candidate is the first line printed. */
function lanAddresses() {
  const VIRTUAL = /vpn|virtual|vethernet|hyper-v|wsl|tap|tun|loopback|docker/i;
  const real = [];
  const other = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      /* 169.254.x is what Windows invents when DHCP failed. Nothing can
         reach it, so offering it would only waste someone's time. */
      if (a.address.startsWith('169.254.')) continue;
      if (VIRTUAL.test(name)) other.push({ address: a.address, note: `${name} — probably not this one` });
      else real.push({ address: a.address, note: '' });
    }
  }
  return real.concat(other);
}

/* Only start listening when run directly, so the tests can import createApp
   without a stray server binding a port. */
const runDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (runDirectly) {
  DB.open(DB_FILE);

  /* Expired sessions and stale login attempts, cleared hourly. unref() so this
     timer never holds the process open on shutdown. */
  setInterval(() => {
    try { Auth.sweep(); } catch (e) { console.error('sweep failed:', e.message); }
  }, 60 * 60 * 1000).unref();

  const server = createApp();
  server.listen(PORT, () => {
    const n = DB.get().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    console.log('');
    console.log('  OG SYSTEM server');
    console.log(`    listening : http://localhost:${PORT}`);

    /* The address a phone or a second laptop must type. Printed rather than
       left for someone to dig out of ipconfig, because "open it on your
       phone" is how this gets tested every single day. */
    for (const net of lanAddresses()) {
      console.log(`    on wifi   : http://${net.address}:${PORT}` +
                  (net.note ? `   (${net.note})` : ''));
    }

    console.log(`    database  : ${DB_FILE}`);
    console.log(`    app files : ${STATIC}`);
    console.log(`    accounts  : ${n}`);
    if (n === 0) {
      console.log('');
      console.log('    No accounts yet. Create the first manager with:');
      console.log('      npm run createuser');
    }

    /* Test accounts have their passwords printed in a public file. Say so on
       every single startup while they exist — the failure this guards against
       is nobody remembering they are there on the day the shop goes live. */
    const demo = DB.get().prepare(
      `SELECT username FROM users
        WHERE username IN ('hussam','lubna','maher','talal','yalla')`
    ).all().map(r => r.username);

    if (demo.length) {
      console.log('');
      console.log(`    ${SECURE ? '*** WARNING ***  ' : ''}TEST ACCOUNTS ARE ACTIVE: ${demo.join(', ')}`);
      console.log('    Their password is published in scripts/demo-users.js.');
      console.log('    Remove before real use:  npm run demo-users -- --remove');
    }

    /* Same reasoning, and the more expensive one to miss: a seeded price is a
       price a cashier can charge a real customer. Counted rather than assumed,
       so the line disappears the moment the rows actually go. */
    const seeded = DB.get().prepare(
      `SELECT (SELECT COUNT(*) FROM products  WHERE demo = 1) AS p,
              (SELECT COUNT(*) FROM customers WHERE demo = 1) AS c`
    ).get();

    if (seeded.p || seeded.c) {
      console.log('');
      console.log(`    ${SECURE ? '*** WARNING ***  ' : ''}DEMO CATALOGUE IS LOADED: ` +
                  `${seeded.p} product(s), ${seeded.c} customer(s).`);
      console.log('    Invented goods at invented prices — the till will sell them.');
      console.log('    Remove before real use:  npm run demo-catalogue -- --remove');
    }

    if (!SECURE) {
      console.log('');
      console.log('    OG_SECURE is not set — cookies are being sent without');
      console.log('    the Secure flag. Fine locally, wrong behind HTTPS.');
    }

    /* The CSRF check passes everything when the list is empty — see
       originAllowed() in lib/http.js. That is deliberate for a shop network
       nobody else is on, but it is exactly the setting people forget on the
       day they first reach the till from outside, which is also the day it
       starts to matter. Say so while the address is still on screen. */
    if (!ORIGINS.length) {
      console.log('');
      console.log('    OG_ORIGINS is not set — any site your browser visits can');
      console.log('    send writes here while you are logged in. Fine on a shop');
      console.log('    network you control. Set it before reaching this from');
      console.log('    outside the shop, e.g.');
      console.log('      OG_ORIGINS=http://og-shop:8090');
    }
    console.log('');
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('\n  shutting down');
      server.close(() => { DB.close(); process.exit(0); });
      /* If a connection refuses to drain, do not hang forever. */
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
