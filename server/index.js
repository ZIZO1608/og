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
import { createServer as createTlsServer } from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadEnv } from './lib/env.js';
import * as DB from './lib/db.js';
import * as Auth from './lib/auth.js';
import * as Cat from './lib/catalogue.js';
import * as Stock from './lib/stock.js';
import * as Shelves from './lib/shelves.js';
import * as Sales from './lib/sales.js';
import * as Customers from './lib/customers.js';
import * as Loyalty from './lib/loyalty.js';
import * as Wants from './lib/wants.js';
import * as PermCheck from './lib/permcheck.js';
import * as Cap from './lib/capped.js';
import * as Deliveries from './lib/deliveries.js';
import * as Partner from './lib/partner.js';
import * as Purchasing from './lib/purchasing.js';
import * as Alerts from './lib/alerts.js';
import * as Dashboard from './lib/dashboard.js';
import * as Reports from './lib/reports.js';
import * as Money from './lib/money.js';
import * as Counts from './lib/counts.js';
import * as Receipt from './lib/receipt.js';
import * as Printing from './lib/printing.js';
import * as Labels from './lib/labels.js';
import * as SyncWorker from './lib/sync-worker.js';
import * as Telegram from './lib/telegram.js';
import * as Live from './lib/live.js';
import * as TLS from './lib/tls.js';
import { lanAddresses } from './lib/net.js';
import { timingSafeEqual } from 'node:crypto';
import {
  readJson, sendOk, sendError, sendErrorDetail, sendJson, parseCookies,
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
/* '1' forces it; otherwise it turns itself on the moment this process is
   actually serving HTTPS, which is the only thing the flag is really about.
   A Secure cookie is still accepted over http://localhost by every browser,
   so the till on this machine is unaffected either way. */
let SECURE    = process.env.OG_SECURE === '1';
let SECURE_SERVER = null;
const HTTPS_PORT = Number(process.env.OG_HTTPS_PORT || 8443);
const HTTPS_OFF  = process.env.OG_HTTPS === '0';
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
  /* Which server, and how the other devices reach it. The login screen
     prints it, because two laptops each running their own copy are two
     shops, and nothing else on screen would ever say so. */
  const shop = DB.get().prepare("SELECT value FROM config WHERE key = 'shop.name'").get();
  /* Full URLs, scheme and all: the login screen prints these verbatim, and
     "10.10.99.9:8443" without the https in front is a page that will not
     load. */
  const scheme = SECURE_SERVER ? 'https' : 'http';
  const port = SECURE_SERVER ? HTTPS_PORT : PORT;
  sendOk(ctx.res, {
    warehouses: row.n, time: DB.nowIso(),
    shop: shop ? shop.value : null,
    https: !!SECURE_SERVER,
    lan: lanAddresses().filter((n) => !n.note).map((n) => `${scheme}://${n.address}:${port}`)
  });
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

/* "Online now" reuses sessions.last_seen, which already ticks forward on
   every authenticated request (Auth.userForToken) — no new tracking, just
   exposing what the sliding-expiry mechanism already keeps. One row per
   user (their most recent live session), never the raw token. A user with
   no live session at all is simply absent from the list rather than sent
   as "offline" — keeps the payload proportional to who's actually signed
   in, and matches the "absent means nothing to report" shape used
   elsewhere (e.g. scrubCost). */
const PRESENCE_ONLINE_MS = 5 * 60 * 1000;

router.add('GET /api/staff/presence', requirePerm('staff.read', (ctx) => {
  const now = Date.now();
  const rows = DB.get().prepare(
    `SELECT u.id, u.username, u.name, u.role, MAX(s.last_seen) AS last_seen
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > ?
     GROUP BY u.id
     ORDER BY last_seen DESC`
  ).all(DB.nowIso());
  sendOk(ctx.res, {
    staff: rows.map((r) => ({
      id: r.id, username: r.username, name: r.name, role: r.role,
      lastSeen: r.last_seen,
      online: (now - new Date(r.last_seen).getTime()) < PRESENCE_ONLINE_MS
    }))
  });
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
   that shop.* itself doesn't already have a writer for, plus customer.* for
   the Settings card that owns the at-risk window. Restricted to that
   allowlist rather than any config key — this route exists for those
   Settings cards, not as a general "edit the config table" backdoor.

   loyalty.* opened in Stage D, and only then: it stayed shut for two stages
   because the loyalty fold wrote to CONFIG in memory and nothing else, so
   opening the keys first would have let half a change persist — the earn
   rate saved, the tiers not. The fold saves properly now. */
const CONFIG_WRITABLE = /^receipt\.|^customer\.|^loyalty\.|^shop\.(branch_name|phone)$|^label\.(default_preset|transport|printer_host|printer_port|stations|density|speed|gap_mm|logo_asset|code_source|max_batch|lease_minutes|calibrate_cmd)$/;

/* ---- the Sync button in the topbar --------------------------------------
   The mirror already runs on a timer, but somebody who has just finished a
   stock count wants to know it is up NOW rather than within ten minutes.

   config.write, so it is a manager thing: this reaches out to the internet
   and rewrites the mirror, which is not something a cashier should be able
   to set off from the till. It waits for the real verdict rather than
   answering "started" — a button that always says success teaches people to
   stop believing it. */
router.add('POST /api/sync/push', requirePerm('config.write', async (ctx) => {
  const r = await SyncWorker.runNow();
  if (r.ok) return sendOk(ctx.res, { seconds: r.seconds, behind: r.behind, pushed: r.pushed });

  /* 409 for "already running" — the request was fine, the moment was not.
     503 for anything else, since the failure is the mirror being out of
     reach rather than the caller doing something wrong. */
  const status = r.reason === 'busy' ? 409 : 503;
  return sendError(ctx.res, status, r.reason, r.message);
}));

/* What the mirror is doing right now — mode, rows waiting, last push, the
   reason it is stuck. The Settings fold draws it; the same object rides on
   the live channel after every push so the fold repaints without polling.
   config.write like the button: it names the machine the mirror belongs to. */
router.add('GET /api/sync/status', requirePerm('config.write', (ctx) => {
  return sendOk(ctx.res, { status: SyncWorker.status() });
}));

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
  const cap = Cap.withCap(Stock.recent(limit), limit,
                          'SELECT COUNT(*) AS n FROM stock_movements');
  sendOk(ctx.res, {
    movements: cap.rows, movementsTotal: cap.total, movementsCapped: cap.capped
  });
}));

/* --- shelves ----------------------------------------------------------------
   Where things physically are. Reading the layout is `stock.read`; changing it
   and putting stock away are `stock.move` — the existing warehouse pair, so
   there is no new permission, no migration seeding one, and no fifth place for
   the boundary to go stale. The people who know where the pillar is are the
   people who move the boxes.

   `/api/sections` and `/api/shelves` deliberately sit at the top level rather
   than under `/api/stock/`, where `GET /api/stock/:sku` (registered above)
   would swallow them: router.match returns the FIRST route whose pattern fits,
   so `GET /api/stock/shelves` would answer as sku='shelves' with a cheerful
   200 and an empty result. `POST /api/stock/assign-shelf` is safe because
   every other POST under /api/stock/ is a literal path. */

router.add('GET /api/sections', requirePerm('stock.read', (ctx) => {
  const wh = ctx.url.searchParams.get('wh') || null;
  sendOk(ctx.res, {
    sections: Shelves.list({ whId: wh }),
    /* The rooms the racks hang in (026). Sent with the racks rather than
       behind a second route, because the map needs both in one breath. */
    rooms: Shelves.rooms({ whId: wh }),
    /* What arrived and has not been put away. Only answerable for one
       warehouse at a time, because "not put away" is a fact about a room. */
    unshelved: wh ? Shelves.unshelved(wh) : null,
    /* The standard rack, in centimetres (036). The map draws every rack from
       these and from each rack's own `size`, so the browser owns no number
       the server has not got. */
    geometry: Shelves.GEOMETRY,
    limits: { rack: Shelves.RACK_LIMITS, room_max_cm: Shelves.MAX_ROOM_CM, bay_min_cm: Shelves.BAY_MIN }
  });
}));

router.add('POST /api/sections', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ section: Shelves.createSection({
    whId: b.whId, key: b.key, name: b.name,
    sortIndex: b.sortIndex, gridOrigin: b.gridOrigin,
    roomId: b.roomId, wall: b.wall, wallPos: b.wallPos, wallCm: b.wallCm,
    bayCm: b.bayCm, levelCm: b.levelCm, depthCm: b.depthCm, userId: ctx.user.id
  }) }));
}));

router.add('PATCH /api/sections/:id', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ section: Shelves.updateSection(Number(ctx.params.id), {
    name: b.name, sortIndex: b.sortIndex, gridOrigin: b.gridOrigin,
    roomId: b.roomId, wall: b.wall, wallPos: b.wallPos, wallCm: b.wallCm,
    bayCm: b.bayCm, levelCm: b.levelCm, depthCm: b.depthCm
  }, ctx.user.id) }));
}));

/* Rooms: the walls the racks hang on. Same permission pair, same reasoning —
   the person who knows which wall the rack is against is the person who
   moves the boxes. */
router.add('POST /api/rooms', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ room: Shelves.createRoom({
    whId: b.whId, name: b.name, sortIndex: b.sortIndex,
    widthCm: b.widthCm, depthCm: b.depthCm, heightCm: b.heightCm, userId: ctx.user.id
  }) }));
}));

router.add('PATCH /api/rooms/:id', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ room: Shelves.updateRoom(Number(ctx.params.id), {
    name: b.name, sortIndex: b.sortIndex,
    widthCm: b.widthCm, depthCm: b.depthCm, heightCm: b.heightCm
  }, ctx.user.id) }));
}));

router.add('DELETE /api/rooms/:id', requirePerm('stock.move', (ctx) => {
  shelfOp(ctx, () => Shelves.deleteRoom(Number(ctx.params.id), ctx.user.id));
}));

router.add('DELETE /api/sections/:id', requirePerm('stock.move', (ctx) => {
  shelfOp(ctx, () => Shelves.deleteSection(Number(ctx.params.id), ctx.user.id));
}));

/* Lay a room out. Idempotent on code and it never deletes, because the shop is
   inventing this layout for the first time and will run it more than once. */
router.add('POST /api/sections/:id/grid', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.seedGrid(Number(ctx.params.id), {
    rows: b.rows, cols: b.cols, capacity: b.capacity
  }, ctx.user.id));
}));

router.add('POST /api/sections/:id/rows', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.editRows(Number(ctx.params.id), {
    action: b.action, row: b.row, cols: b.cols
  }, ctx.user.id));
}));

router.add('POST /api/sections/:id/cols', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.editCols(Number(ctx.params.id), {
    action: b.action, col: b.col
  }, ctx.user.id));
}));

router.add('POST /api/shelves', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ shelf: Shelves.createShelf({
    sectionId: Number(b.sectionId), rowLabel: b.rowLabel,
    colIndex: b.colIndex, capacity: b.capacity, userId: ctx.user.id
  }) }));
}));

/* Rename, set capacity, set the assignment. Renaming a code or reassigning a
   shelf that still has stock on it changes nothing and returns the numbers
   first; `force` is how the manager says yes to what it just showed him. */
router.add('PATCH /api/shelves/:id', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.updateShelf(Number(ctx.params.id), {
    code: b.code, capacity: b.capacity,
    productId: b.productId, sizeFrom: b.sizeFrom, sizeTo: b.sizeTo
  }, { force: b.force === true, userId: ctx.user.id }));
}));

router.add('DELETE /api/shelves/:id', requirePerm('stock.move', (ctx) => {
  shelfOp(ctx, () => Shelves.deleteShelf(Number(ctx.params.id), ctx.user.id));
}));

/* The guard the whole feature exists for: a pair put down in the wrong place
   is refused as it is put down, and told where it actually goes. */
router.add('POST /api/stock/assign-shelf', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.assignStock({
    sku: b.sku, whId: b.whId,
    shelfId: b.shelfId == null ? null : Number(b.shelfId),
    userId: ctx.user.id
  }));
}));

/* --- customers --------------------------------------------------------------
   `customer.*` is in FORBIDDEN for the partner role in lib/auth.js, so Yalla
   Wear cannot be granted these however the tick boxes are set. They are a
   different company; the shop's customer list is not theirs to hold. */

/* ctx.user goes in, because the driver rule lives in the query — see
   driverScope() in server/lib/customers.js. A route that decided this for
   itself would be a rule in two places, and the second copy is the one that
   gets forgotten. */
router.add('GET /api/customers', requirePerm('customer.read', (ctx) => {
  sendOk(ctx.res, {
    customers: Customers.list(ctx.user, {
      includeArchived: Auth.can(ctx.user, 'customer.write')
    })
  });
}));

/* The invoices WITH their lines now, so scrubCost below is load-bearing for
   the first time: unit_cost sits inside each nested `items` array, and that
   call is what keeps it from a cashier. `limit` is a query parameter, capped
   inside historyFor. */
router.add('GET /api/customers/:id/history', requirePerm('customer.read', (ctx) => {
  /* A driver has customer.read so he can see who he is delivering to. What
     somebody bought over the years is not part of that, so this route is
     closed to him entirely — and closed with 404, so it cannot be used to
     probe which customers exist. */
  if (ctx.user.role === 'delivery') {
    return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  }
  const c = Customers.byId(Number(ctx.params.id), ctx.user);
  if (!c) return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  const limit = Number(ctx.url.searchParams.get('limit')) || 200;
  const hist = Cap.withCap(Customers.historyFor(c.id, limit), limit,
    'SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?', c.id);
  sendOk(ctx.res, {
    sales: hist.rows.map(s => scrubCost(s, ctx.user)),
    /* The timeline badges how many events it drew, and sizeDrift compares
       "recent" against "older" — both read as facts about this person's whole
       history. At 200 invoices they would silently become facts about the
       last 200. See server/lib/capped.js. */
    salesTotal: hist.total,
    salesCapped: hist.capped,
    /* One request builds the whole timeline. Left out entirely for an account
       without delivery.read — an empty array would say "no parcels", which is
       a different claim from "not yours to see". */
    deliveries: Auth.can(ctx.user, 'delivery.read') ? Customers.deliveriesFor(c.id) : null,
    /* Stamp redemptions ride along for the same reason: one request, one
       stream. Empty when the shop does not run stamps. */
    redemptions: Loyalty.stampsOn(Loyalty.rules().mode) ? Loyalty.redemptionsFor(c.id) : [],
    /* What they asked for and we did not have. */
    wants: Wants.forCustomer(c.id),
    /* Their open debts, each with what it was worth THEN and what it is worth
       NOW. customer.read, not money.read: a cashier who may take the payment
       has to be able to see what is owed, and Stage A already decided the
       totals reach her. This is the same fact at invoice grain. */
    debts: Money.debtsForCustomer(c.id),
    /* Print jobs, but only the ones a customer_id actually proves — never a
       name match. Nothing is shown rather than something possibly wrong. */
    jobs: Auth.can(ctx.user, 'print.read') ? Partner.jobsForCustomer(c.id) : null
  });
}));

/* 200, even when the phone is already taken — the customer WAS created, and a
   status that says otherwise invites a retry that creates a second one. The
   warning rides beside the customer instead:

     { ok: true, customer: {…}, warning: { code, message, existing } }

   `warning` is null when there is nothing to say. */
router.add('POST /api/customers', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const r = Customers.create(b, ctx.user.id);
    sendOk(ctx.res, { customer: r.customer, warning: r.warning });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('PATCH /api/customers/:id', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const r = Customers.update(Number(ctx.params.id), b, ctx.user.id);
    sendOk(ctx.res, { customer: r.customer, warning: r.warning });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* ---- merging two records that are one person ------------------------------
   staff.write, so it is the manager's. A merge repoints somebody's whole
   history and cannot be undone with a button; it is not a thing to leave on
   the till. */
router.add('POST /api/customers/:id/merge', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Customers.merge(Number(ctx.params.id), Number(b.loseId), ctx.user.id));
  } catch (e) {
    const status = e.code === 'not_found' ? 404
                 : ['same_customer', 'archived', 'already_merged'].includes(e.code) ? 409 : 400;
    sendError(ctx.res, status, e.code || 'invalid', e.message);
  }
}));

/* ---- attaching a customer to a sale after the fact -----------------------
   `sell`, not `sale.void`: this is the cashier finishing the sale she is
   still standing in, and the commonest moment for it is the customer saying
   "I'm on your list" while she is at payment.

   How long after is decided on the SERVER, from the shift the sale was posted
   into — see Sales.attachCustomer. `void` is what lifts the limit, because
   somebody who may unwind a sale entirely may certainly relabel one. (The
   permission is `void`, not `sale.void` — that is the name in
   role_permissions, and getting it wrong here silently left the manager with
   no way past the shift rule at all.) */
router.add('POST /api/sales/:id/customer', requirePerm('sell', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Sales.attachCustomer(ctx.params.id, Number(b.customerId), {
      userId: ctx.user.id,
      opId: typeof b.opId === 'string' ? b.opId : null,
      canBackdate: Auth.can(ctx.user, 'void')
    }));
  } catch (e) {
    const status = e.code === 'not_found' ? 404
                 : e.code === 'too_late' ? 403
                 : ['already_attached', 'voided', 'archived', 'unknown_customer'].includes(e.code) ? 409
                 : 400;
    sendError(ctx.res, status, e.code || 'invalid', e.message);
  }
}));

/* ---- the wants list ------------------------------------------------------
   Recorded by the act of looking, never typed: the till posts here when a
   size is looked up while it is out of stock and a customer is attached.
   `sell` because that is who is standing at the counter when it happens. */
router.add('POST /api/wants', requirePerm('sell', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { want: Wants.record({
      customerId: Number(b.customerId),
      sku: typeof b.sku === 'string' ? b.sku : null,
      productId: b.productId == null ? null : Number(b.productId),
      size: b.size == null ? null : String(b.size),
      source: b.source, userId: ctx.user.id
    }) });
  } catch (e) {
    sendError(ctx.res, 400, e.code || 'invalid', e.message);
  }
}));

router.add('POST /api/wants/:id/close', requirePerm('sell', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { want: Wants.close(Number(ctx.params.id), {
      note: typeof b.note === 'string' ? b.note : null, userId: ctx.user.id
    }) });
  } catch (e) {
    sendError(ctx.res, e.code === 'not_found' ? 404 : 400, e.code || 'invalid', e.message);
  }
}));

/* Who is waiting for a size that just landed. product.read, because the
   question belongs to the shipment rather than to the customer list. */
router.add('GET /api/wants', requirePerm('product.read', (ctx) => {
  if (ctx.user.role === 'delivery') {
    return sendOk(ctx.res, { wants: [], wantsTotal: 0, wantsCapped: false });
  }
  const sku = ctx.url.searchParams.get('sku');
  const product = ctx.url.searchParams.get('product');
  const rows = Wants.open({ sku, productId: product });

  /* The wants tab badges this list's length. At 200 open wants the badge
     would have said 200 and meant "at least 200" — see server/lib/capped.js
     for the three times that shape has already shipped. The COUNT repeats the
     same WHERE the reader uses, or the total would be of a different set. */
  const where = ['w.closed_at IS NULL', 'c.archived = 0'];
  const args = [];
  if (sku) { where.push('w.variant_sku = ?'); args.push(sku); }
  if (product) { where.push('w.product_id = ?'); args.push(Number(product)); }
  const cap = Cap.withCap(rows, 200,
    `SELECT COUNT(*) AS n FROM wants w JOIN customers c ON c.id = w.customer_id
      WHERE ${where.join(' AND ')}`, ...args);

  sendOk(ctx.res, { wants: cap.rows, wantsTotal: cap.total, wantsCapped: cap.capped });
}));

/* ---- the stamp card ------------------------------------------------------
   Reading it is customer.read: a cashier has to be able to answer "how many
   have I got" across the counter. Cashing one in is customer.write, because
   it is the shop giving something away.

   There is no "how many stamps" write anywhere, and there cannot be — the
   count is derived from sale_items (server/lib/loyalty.js). */
router.add('GET /api/customers/:id/card', requirePerm('customer.read', (ctx) => {
  if (ctx.user.role === 'delivery') {
    return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  }
  const c = Customers.byId(Number(ctx.params.id), ctx.user);
  if (!c) return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  sendOk(ctx.res, {
    card: Loyalty.cardFor(c.id),
    redemptions: Loyalty.redemptionsFor(c.id),
    rules: Loyalty.rules()
  });
}));

router.add('POST /api/customers/:id/redeem', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Loyalty.redeem(Number(ctx.params.id), {
      note: typeof b.note === 'string' ? b.note : null,
      stamps: b.stamps == null ? null : Number(b.stamps),
      userId: ctx.user.id,
      opId: typeof b.opId === 'string' ? b.opId : null
    }));
  } catch (e) {
    if (e.code === 'not_enough_stamps') {
      return sendErrorDetail(ctx.res, 409, 'not_enough_stamps', e.message,
        { available: e.available, required: e.required });
    }
    if (e.code === 'stamps_off') {
      return sendError(ctx.res, 409, 'stamps_off', e.message);
    }
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
      txnRef: typeof b.txnRef === 'string' ? b.txnRef : null,
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
    /* All four of these carry a NUMBER the till has to show — how many are
       left, the ceiling, the balance, the room. They used to hand it to
       sendError's fifth argument, which is HTTP headers, so none of it ever
       reached the browser and the cashier got a bare sentence. sendErrorDetail
       puts it in the body, where js/api.js already reads it as err.detail. */
    if (e.code === 'insufficient_stock') {
      return sendErrorDetail(ctx.res, 409, 'insufficient_stock',
        `Only ${e.available} of ${e.sku} left — the other till may have just sold it.`,
        { available: e.available, sku: e.sku });
    }
    /* 403, not 400: the sale is well-formed, the person is not allowed to
       make it. The till tells them to fetch a manager rather than showing
       them a validation error about their own basket. */
    if (e.code === 'discount_too_big') {
      return sendErrorDetail(ctx.res, 403, 'discount_too_big', e.message,
        { maxPct: e.maxPct, ceiling: e.ceiling });
    }
    /* 409, not 400: the basket is fine and so is the request. The world
       moved — someone spent those points, or the balance was corrected —
       which is the same shape of answer as insufficient_stock and wants the
       same response at the till: reload and try again. */
    if (e.code === 'not_enough_points') {
      return sendErrorDetail(ctx.res, 409, 'not_enough_points', e.message,
        { available: e.available });
    }
    if (e.code === 'points_exceed_total') {
      return sendErrorDetail(ctx.res, 409, 'points_exceed_total', e.message,
        { room: e.room });
    }
    /* Both refusals, both about credit. 409 rather than 400: the basket is
       fine and the request is well-formed — the shop has decided this person
       does not get credit, or there is nobody to owe it. */
    if (e.code === 'credit_needs_customer' || e.code === 'no_credit') {
      return sendError(ctx.res, 409, e.code, e.message);
    }
    if (e.code === 'unknown_customer') {
      return sendError(ctx.res, 409, 'unknown_customer', e.message);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* The 200 here is load-bearing — a till does not hold the shop's history —
   but the browser SUMS this array for the dashboard's revenue, the monthly
   chart and a shift's takings. So the truncation travels with it: `total` is
   how many sales actually exist, `capped` says the number on screen is a
   window rather than the shop. See server/lib/capped.js. */
router.add('GET /api/sales', requirePerm('sell', (ctx) => {
  const limit = Math.min(200, Number(ctx.url.searchParams.get('limit')) || 50);
  const cap = Cap.withCap(Sales.recent(limit), limit,
                          'SELECT COUNT(*) AS n FROM sales');
  sendOk(ctx.res, {
    sales: cap.rows.map(s => scrubCost(s, ctx.user)),
    salesTotal: cap.total,
    salesCapped: cap.capped
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
      opId: typeof b.opId === 'string' ? b.opId : null,
      /* Whitelisted rather than passed through: this lands in print_log and
         is read back as an audit trail, so it takes one of two known values
         and never whatever a client felt like sending. */
      kind: b.kind === 'gift' ? 'gift' : 'sale'
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
  const limit = Number(ctx.url.searchParams.get('limit')) || 100;
  const status = ctx.url.searchParams.get('status') || null;
  const rows = Deliveries.list(ctx.user, { status, limit });

  /* whoCell on the board counts a customer's FAILED deliveries across this
     array (Stage E), so a failure older than the window reads as a clean
     record. The count repeats the reader's own scoping — a driver's board is
     his run, and a total over the whole table would be a number about
     somebody else's work. */
  const where = [];
  const args = [];
  if (ctx.user.role === 'delivery') { where.push('driver_id = ?'); args.push(ctx.user.id); }
  if (status) { where.push('status = ?'); args.push(status); }
  const cap = Cap.withCap(rows, limit,
    `SELECT COUNT(*) AS n FROM deliveries${where.length ? ' WHERE ' + where.join(' AND ') : ''}`,
    ...args);

  sendOk(ctx.res, {
    deliveries: cap.rows,
    deliveriesTotal: cap.total,
    deliveriesCapped: cap.capped,
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

/* ----------------------------------------------------------------- money
   The drawer: shifts, expenses, and customers paying down what they owe.
   money.write is labelled "Record expenses and debts" in the permission
   table — it has existed since the beginning and nothing used it until now. */

router.add('GET /api/money', requirePerm('money.read', (ctx) => {
  sendOk(ctx.res, Money.all());
}));

function moneyFail(res, e) {
  const status = e.code === 'not_found' ? 404
               : ['already_open', 'already_closed', 'already_settled',
                  'overpaid', 'voided', 'bad_status'].includes(e.code) ? 409
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

/* Whose name goes on the drawer is the account opening it, not a dropdown.
   "Who was on the till" is an accountability record, and a picker lets
   anybody put somebody else's name on a short count. Naming another person
   takes staff.write. */
router.add('POST /api/shifts', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  const other = b.userId && Number(b.userId) !== ctx.user.id;
  if (other && !Auth.can(ctx.user, 'staff.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'You cannot open a shift for someone else.');
  }
  try {
    const who = other
      ? Auth.findById(Number(b.userId))
      : ctx.user;
    sendOk(ctx.res, {
      shift: Money.openShift({
        float: Number(b.float) || 0, whId: b.whId || null,
        userId: who ? who.id : ctx.user.id,
        userName: who ? who.name : ctx.user.name
      })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/shifts/:id/close', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { shift: Money.closeShift(ctx.params.id, Number(b.counted), ctx.user.id) });
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/expenses', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      expense: Money.addExpense({
        category: b.category, amount: Number(b.amount), method: b.method,
        note: b.note || null, at: b.at || null, currency: b.currency || null,
        userId: ctx.user.id
      })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

/* Money in, and the one direction that cannot be corrected by doing it
   again — so it carries an opId, exactly like a sale. */
/* `debt.collect`, not money.write — and that is the whole point of the new
   permission. A cashier takes the cash when a customer settles up; it is in
   her drawer, in her shift, and a till that cannot record it makes her count
   come up over at closing with nothing to explain it. She still does not get
   money.read, so the shop's money screen stays shut.

   The three guards are already inside Money.payDebt and are not restated
   here: an opId through applied_ops so a retry cannot take the money twice,
   the balance recomputed INSIDE the transaction rather than trusted from the
   browser, and Sales.void refusing a sale with payments against it. Money in
   is the one direction that cannot be corrected by doing it again. */
router.add('POST /api/debt-payments', requirePerm('debt.collect', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      payment: Money.payDebt({
        saleId: b.saleId, amount: Number(b.amount), method: b.method,
        note: b.note || null, currency: b.currency || null,
        opId: typeof b.opId === 'string' ? b.opId : null,
        userId: ctx.user.id
      })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

/* ---------------------------------------------------------- stock counts */

router.add('GET /api/stock-counts', requirePerm('stock.read', (ctx) => {
  sendOk(ctx.res, { stockCounts: Counts.list({}) });
}));

router.add('POST /api/stock-counts', requirePerm('stock.count', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      count: Counts.start({ whId: b.whId, scope: b.scope || 'all',
                            userId: ctx.user.id, userName: ctx.user.name })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('PUT /api/stock-counts/:id/lines', requirePerm('stock.count', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      count: Counts.setLines(ctx.params.id, Array.isArray(b.lines) ? b.lines : [], ctx.user.id)
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/stock-counts/:id/post', requirePerm('stock.count', async (ctx) => {
  try { sendOk(ctx.res, { count: Counts.post(ctx.params.id, ctx.user.id) }); }
  catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/stock-counts/:id/cancel', requirePerm('stock.count', async (ctx) => {
  try { sendOk(ctx.res, { count: Counts.cancel(ctx.params.id, ctx.user.id) }); }
  catch (e) { moneyFail(ctx.res, e); }
}));

/* ---------------------------------------------- suppliers and the payroll
   Their own routes, on their own gates. They used to arrive only bundled
   inside /api/partner, which is gated on print.read — so revoking that from
   a manager silently emptied the supplier list and the payroll, with no
   error to explain it. One list, one permission, one place. */
router.add('GET /api/suppliers', requirePerm('money.read', (ctx) => {
  sendOk(ctx.res, { suppliers: Partner.suppliers() });
}));

router.add('GET /api/employees', requirePerm('staff.read', (ctx) => {
  sendOk(ctx.res, { employees: Partner.employees() });
}));

/* ------------------------------------------------------------------ bell
   Computed, never stored: an alert is a fact about the state right now, and
   a stored alert is a fact about a state that has moved on.

   Which alerts a person gets depends on what they may see — supplier debt is
   money.read, payroll is staff.read — so this is per account rather than one
   list filtered in the browser. */
/* `fullCards` is NOT a second copy of the bell — it is the complete id list
   behind the capped one.

   The bell names five and summarises the rest, because a bell is read by
   glancing and sixty rows buries the stock warnings underneath it. But the
   Customers screen's "Card full" filter has to show all twelve, or the chip
   says twelve and the list shows five. So: alerts capped for reading, ids
   complete for filtering, both computed from the same Loyalty.fullCards call
   the alerts already make. Ids only — no names, no counts — because this is
   an index, not a payload. */
router.add('GET /api/notifications', (ctx) => {
  const stampsOn = Loyalty.stampsOn(Loyalty.rules().mode);
  sendOk(ctx.res, {
    notifications: Alerts.list(ctx.user).rows,
    fullCards: (stampsOn && ctx.user.role !== 'delivery' && Auth.can(ctx.user, 'customer.read'))
      ? Loyalty.fullCards().map((f) => f.customerId)
      : []
  });
});

/* ------------------------------------------------------------- dashboard
   Every figure on the home screens, computed in SQL over EVERY sale — not
   summed in the browser from the last two hundred. See lib/dashboard.js for
   the three rules. The window comes from the browser as two ISO instants,
   because the day is the till's to define and not this server's.

   Any-of on the four permissions that unlock at least one block; the partner
   holds none of them and the browser never asks on their behalf. What comes
   back is shaped by what the account may see, block by block, and is NOT
   passed through scrubCost whole — COST_KEYS deletes a key literally named
   `margin`, which is the profit.read block. Only the two sale lists carry
   line items, and only those are scrubbed. */
router.add('GET /api/dashboard',
  requirePerm(['sell', 'stock.read', 'money.read', 'customer.read'], (ctx) => {
    const q = ctx.url.searchParams;
    const range = Dashboard.parseRange(q.get('from'), q.get('to'), q.get('tz'));
    if (range.error) return sendError(ctx.res, 400, 'bad_range', range.error);

    const out = Dashboard.build(ctx.user, range);
    const scrubSale = (s) => ({
      ...scrubCost(s, ctx.user),
      items: (s.items || []).map((i) => scrubCost(i, ctx.user))
    });
    if (out.latest) out.latest = out.latest.map(scrubSale);
    if (out.me) out.me.latest = out.me.latest.map(scrubSale);
    sendOk(ctx.res, out);
  }));

/* ------------------------------------------------------------- the reports
   Everything on the Reports screen, computed in SQL over EVERY sale — the
   same job GET /api/dashboard does for the home screens, and added for the
   same reason: the browser was summing it out of the last two hundred
   invoices, adding dollars to lira as it went.

   `report.read` opens the screen; each block inside is gated on its own
   permission (profit.read, cost.read, money.read, staff.read) and is ABSENT
   rather than nulled for an account that may not see it — see the header of
   server/lib/reports.js.

   NOT passed through scrubCost whole, for the same reason the dashboard is
   not: COST_KEYS deletes a key literally named `margin`, which would blank
   the profit block for a manager holding profit.read but not cost.read. There
   are no sale line items in this payload, so there is nothing to scrub — the
   cost figures that are here were withheld at the query, not at the door. */
router.add('GET /api/reports', requirePerm('report.read', (ctx) => {
  const q = ctx.url.searchParams;
  const range = Reports.parseRange(q.get('from'), q.get('to'), q.get('tz'));
  if (range.error) return sendError(ctx.res, 400, 'bad_range', range.error);
  sendOk(ctx.res, Reports.build(ctx.user, range));
}));

/* One alert by key, or everything currently showing when no key is named.
   Keyed on what the alert is ABOUT, so counting down from "due in 3 days" to
   "due in 2 days" does not make a read alert come back unread. */
router.add('POST /api/notifications/read', async (ctx) => {
  const b = await readJson(ctx.req);
  sendOk(ctx.res, Alerts.markRead(ctx.user, b.key || null));
});

/* -------------------------------------------------------- purchase orders */

router.add('GET /api/purchase-orders', requirePerm('stock.read', (ctx) => {
  sendOk(ctx.res, {
    purchaseOrders: Purchasing.list({
      status: ctx.url.searchParams.get('status') || null,
      limit: Number(ctx.url.searchParams.get('limit')) || 100
    }).map((o) => ({
      ...scrubCost(o, ctx.user),
      lines: o.lines.map((l) => scrubCost(l, ctx.user))
    }))
  });
}));

function poFail(res, e) {
  const status = e.code === 'not_found' ? 404 : e.code === 'bad_status' ? 409 : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

/* What the shop pays a supplier is cost, so raising an order needs cost.read
   as well as the permission to move stock — a line carries a unit cost, and
   somebody who may not see cost cannot meaningfully write one. */
router.add('POST /api/purchase-orders', requirePerm('cost.read', async (ctx) => {
  if (!Auth.can(ctx.user, 'stock.move')) {
    return sendError(ctx.res, 403, 'forbidden', 'Your account does not have access to this.');
  }
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { po: Purchasing.create({ ...b, userId: ctx.user.id }) }); }
  catch (e) { poFail(ctx.res, e); }
}));

router.add('POST /api/purchase-orders/:id/send', requirePerm('stock.move', async (ctx) => {
  try { sendOk(ctx.res, { po: Purchasing.send(ctx.params.id, ctx.user.id) }); }
  catch (e) { poFail(ctx.res, e); }
}));

/* Receiving books stock, so it is the stock permission that gates it — not
   the one that let somebody raise the order in the first place. */
router.add('POST /api/purchase-orders/:id/receive', requirePerm('stock.move', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      po: Purchasing.receive(ctx.params.id,
                             Array.isArray(b.received) ? b.received : null,
                             ctx.user.id)
    });
  } catch (e) { poFail(ctx.res, e); }
}));

router.add('POST /api/purchase-orders/:id/cancel', requirePerm('stock.move', async (ctx) => {
  try { sendOk(ctx.res, { po: Purchasing.cancel(ctx.params.id, ctx.user.id) }); }
  catch (e) { poFail(ctx.res, e); }
}));

/* ---------------------------------------------------------------- partner
   The print jobs, the line to Yalla Wear, and the money between the two
   companies.

   Two audiences read these routes and they are not the same people: the shop
   sees everything, and the partner is another company who must see their own
   work and nothing else. That is why the read is split by role rather than by
   what the request asks for — the same reason a driver's deliveries are
   scoped in SQL and not by a query parameter. */

/* Everything the portal draws, in one read, so the board and the finance page
   cannot end up disagreeing about the same job. */
router.add('GET /api/partner', requirePerm(['print.read', 'partner.jobs'], (ctx) => {
  const bundle = Partner.all();
  const partner = ctx.user.role === 'partner';
  /* The production report is cut in the caller's day, like the dashboard:
     the browser sends its offset in minutes. Payout figures ride along for
     the partner (their own money) and for staff who may see cost. */
  const tz = Number(ctx.url.searchParams.get('tz')) || 0;
  const stats = Partner.stats(tz, { money: partner || Auth.can(ctx.user, 'cost.read') });

  /* Yalla Wear is a supplier, not staff. Their own jobs and the thread
     attached to them — never what the shop charges the customer on top,
     which is the shop's margin and none of their business.

     `customer` and `phone` are stripped for the same reason, and it took
     until Stage E to notice: the strip list held `price` alone, so every job
     carried the shop's customer NAME AND PHONE NUMBER to another company, on
     every poll. FORBIDDEN in lib/auth.js already says a partner can never
     hold customer.* — this route was handing over the same data by a
     different door.

     What they need to print a shirt is the design, the sizes and the names
     that go ON the shirts (print_name, per line). Who ordered it is the
     shop's business, and `customer_id` (Stage E) is stripped with the rest. */
  if (partner) {
    const mine = new Set(bundle.jobs.map((j) => j.id));
    return sendOk(ctx.res, {
      jobs: bundle.jobs.map(({ price, customer, phone, customer_id, ...rest }) => rest),
      invoices: bundle.invoices,
      messages: bundle.messages.filter((m) => !m.job_id || mine.has(m.job_id)),
      /* The shop's verdict on their work is theirs to read; who on the
         shop's staff wrote it is not. */
      reviews: bundle.reviews.map(({ user_id, ...rest }) => rest),
      stats,
      clubs: bundle.clubs,
      suppliers: [], employees: [], waMessages: []
    });
  }

  /* One route, but the things it carries are not all gated the same way.
     print.read gets somebody the board; it does not get them the payroll,
     what the shop owes its suppliers, or the printer's price. Each of
     those is left out entirely rather than sent and hidden, because the
     response is the boundary and the browser is only decoration. */
  sendOk(ctx.res, {
    jobs: bundle.jobs.map((j) => ({
      ...scrubCost(j, ctx.user),
      lines: j.lines ? j.lines.map((l) => scrubCost(l, ctx.user)) : null
    })),
    invoices: bundle.invoices,
    messages: bundle.messages,
    reviews: bundle.reviews,
    stats,
    clubs: bundle.clubs,
    waMessages: bundle.waMessages
    /* suppliers and employees are NOT here. They have their own routes on
       their own permissions — carried in this bundle they were gated on
       print.read, so revoking that from a manager emptied the payroll and
       the supplier balances silently. Two paths that can disagree is one
       path too many. */
  });
}));

/* One place to turn a thrown reason into a status, so a refusal reads the
   same however it was reached. */
const PARTNER_CONFLICTS = new Set([
  'names_missing', 'not_accepted', 'not_pending', 'already_sent', 'already_accepted',
  'own_side', 'not_done', 'not_linked'
]);
function partnerFail(res, e) {
  const status = e.code === 'not_found' ? 404
               : PARTNER_CONFLICTS.has(e.code) ? 409
               : e.code === 'not_configured' ? 503
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

/* Something for the other company was just queued; ask the Telegram line to
   look now rather than on its next tick, so a phone buzzes within a second
   of the tap. Fire-and-forget — the queue is drained on a timer regardless. */
const side = (ctx) => (ctx.user.role === 'partner' ? 'yalla' : 'og');
function bump() {
  Telegram.nudge();
  Live.notify('all');
}

/* The live channel. One long GET per open tab; lib/live.js writes a one-line
   "change" event whenever bump() runs, and the browser refetches through the
   ordinary gated routes. Which side a tab is on comes from the account.
   config.write too: the mirror's status rides on this channel, and a manager
   who cannot see print jobs still owns the Settings fold that draws it. The
   event carries no shop data either way. */
router.add('GET /api/live', requirePerm(['print.read', 'partner.jobs', 'config.write'], (ctx) => {
  Live.subscribe(ctx.res, side(ctx), ctx.user.id);
}));

/* ---- the website ----------------------------------------------------------
   The e-commerce intake. No session: a bearer key from server/.env
   (OG_WEB_API_KEY), checked in the request pipeline before these run. The
   website raises a job exactly the way the till does — source 'web',
   sent to Yalla Wear in the same transaction when every shirt is named —
   and reads back where it is and what the shop thought of it. It never
   receives the printer's price. */
function webPrices() {
  const d = DB.get();
  const num = (k, fb) => Number((d.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value) || fb;
  return { price: num('print.unit_price', 950), cost: num('print.partner_unit_cost', 460) };
}

router.add('POST /api/ext/print-jobs', async (ctx) => {
  const b = await readJson(ctx.req);
  const ref = b.reference ? 'web:' + String(b.reference).slice(0, 80) : null;
  try {
    const d = DB.get();
    if (ref) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(ref);
      if (seen) return sendOk(ctx.res, JSON.parse(seen.result));
    }
    const px = webPrices();
    const lines = Array.isArray(b.lines) ? b.lines.map((l) => ({
      clubCode: l.clubCode ?? null, printName: l.printName ?? l.name ?? null,
      number: l.number ?? null, size: l.size ?? null, qty: Number(l.qty) || 1,
      unitCost: px.cost
    })) : [];
    const kind = lines.length ? 'kit' : 'bulk';
    const qty = kind === 'kit' ? lines.reduce((a, l) => a + l.qty, 0) : (Number(b.qty) || 0);
    const job = Partner.create({
      customer: b.customer, phone: b.phone ?? null, design: b.design, kind, qty,
      priority: b.priority === 'urgent' ? 'urgent' : 'normal',
      deadline: b.deadline ?? null,
      price: Number.isFinite(Number(b.price)) ? Math.round(Number(b.price)) : qty * px.price,
      cost: kind === 'bulk' ? qty * px.cost : null,
      currency: b.currency === 'USD' ? 'USD' : 'SYP',
      lines, source: 'web', autoSend: true, userId: null
    });
    const out = { job: webJob(job) };
    if (ref) {
      d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?,?,?,?,?)')
        .run(ref, new Date().toISOString(), null, 'web_job', JSON.stringify(out));
    }
    bump();
    sendOk(ctx.res, out);
  } catch (e) { partnerFail(ctx.res, e); }
});

router.add('GET /api/ext/print-jobs/:id', (ctx) => {
  const j = Partner.job(ctx.params.id);
  if (!j || j.source !== 'web') return sendError(ctx.res, 404, 'not_found', 'No such job.');
  sendOk(ctx.res, { job: webJob(j) });
});

/* What the website may know: where the job is and the shop's verdict —
   never what the printer charges. */
function webJob(j) {
  const r = Partner.review(j.id);
  return {
    id: j.id, source: j.source, stage: j.stage, order_state: j.order_state,
    order_note: j.order_note, promised_at: j.order_promised_at, deadline: j.deadline,
    qty: j.qty, tbc: j.tbc, price: j.price, currency: j.currency,
    created_at: j.created_at, updated_at: j.updated_at,
    history: (j.history || []).map((h) => ({ stage: h.stage, at: h.at })),
    review: r ? { rating: r.rating, feedback: r.feedback, at: r.at } : null
  };
}

/* The small poll. Has anything moved for the side asking? Cheap enough to ask
   every half minute from every open tab. */
router.add('GET /api/partner/pulse', requirePerm(['print.read', 'partner.jobs'], (ctx) => {
  sendOk(ctx.res, { ...Partner.pulse(side(ctx)), presence: Live.presence() });
}));

/* Two doors into the same room. A manager raises a job by hand on
   print.write. A CASHIER raises one at the till on `sell` alone — the
   customer is standing there with the shirt — but only that way: it must
   name the sale it came from, and the sale must be theirs. Gated on
   print.write alone, a cashier's sale went through and the print job behind
   it was refused with a 403 the customer never saw. */
router.add('POST /api/print-jobs', requirePerm(['print.write', 'sell'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const canWrite = Auth.can(ctx.user, 'print.write');
    if (!canWrite) {
      const sale = b.saleId ? DB.get().prepare('SELECT id, cashier_id FROM sales WHERE id = ?').get(String(b.saleId)) : null;
      if (!sale || Number(sale.cashier_id) !== Number(ctx.user.id)) {
        return sendError(ctx.res, 403, 'forbidden',
          'A print job can only be raised at the till, on a sale you rang up.');
      }
    }
    const job = Partner.create({
      ...b, userId: ctx.user.id,
      source: (b.source === 'till' || !canWrite) ? 'till' : 'manual',
      autoSend: !!b.autoSend
    });
    bump();
    sendOk(ctx.res, { job });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* What the shop thought of the finished shirts. The shop's move only, and
   only once the job is done — refused otherwise, in lib/partner.js. */
router.add('POST /api/print-jobs/:id/review', requirePerm('print.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const job = Partner.reviewJob(ctx.params.id, {
      rating: b.rating, feedback: b.feedback ?? null, userId: ctx.user.id
    });
    bump();
    sendOk(ctx.res, { job });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* Linking an old job to a customer BY HAND. Migration 032 backfilled only
   where a sale_id proved it and left the rest for a person — this is the route
   that person needs. Without it the migration was an instruction to nobody. */
router.add('PATCH /api/print-jobs/:id/customer', requirePerm('print.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const cid = (b.customerId === null || b.customerId === undefined || b.customerId === '')
      ? null : Number(b.customerId);
    sendOk(ctx.res, { job: Partner.setJobCustomer(ctx.params.id, cid, ctx.user.id) });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* Which side moved it is decided here, from the account. A partner request
   claiming to be the shop would put the wrong name on the message that the
   move posts, and that message is the record of who said what. */
router.add('PATCH /api/print-jobs/:id/stage', requirePerm(['print.write', 'partner.jobs'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const job = Partner.setStage(ctx.params.id, b.stage, side(ctx), ctx.user.id);
    bump();
    sendOk(ctx.res, { job });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* Placing the order is the shop's move; answering it is the printer's. Each
   is gated on the permission only that side has. */
router.add('POST /api/print-jobs/:id/order', requirePerm('print.write', async (ctx) => {
  try {
    const job = Partner.sendOrder(ctx.params.id, ctx.user.id);
    bump();
    sendOk(ctx.res, { job });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* Writing the names onto a kit sheet. Both sides do it — the shop as the
   customer rings them in, the printer as it corrects a spelling off the
   artwork — so it takes the same any-of gate the board does. */
router.add('PATCH /api/print-jobs/:id/lines',
  requirePerm(['print.write', 'partner.jobs'], async (ctx) => {
    const b = await readJson(ctx.req);
    try {
      const job = Partner.setLines(ctx.params.id,
                                   Array.isArray(b.lines) ? b.lines : [],
                                   ctx.user.id, side(ctx));
      bump();
      sendOk(ctx.res, { job });
    } catch (e) { partnerFail(ctx.res, e); }
  }));

router.add('POST /api/print-jobs/:id/respond', requirePerm('partner.respond', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const job = Partner.respondToOrder(ctx.params.id, !!b.accept, {
      promisedAt: b.promisedAt || null, note: b.note || null, userId: ctx.user.id
    });
    bump();
    sendOk(ctx.res, { job });
  } catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/messages', requirePerm(['print.read', 'partner.jobs'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const message = Partner.postMessage({
      jobId: b.jobId || null, invoiceId: b.invoiceId || null,
      from: side(ctx), kind: b.kind || 'note', reason: b.reason || null,
      text: b.text, userId: ctx.user.id
    });
    bump();
    sendOk(ctx.res, { message });
  } catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/messages/read', requirePerm(['print.read', 'partner.jobs'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Partner.markRead({
      side: side(ctx), jobId: b.jobId || null, invoiceId: b.invoiceId || null,
      kind: b.kind || null, userId: ctx.user.id
    }));
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* The printer's bill. Yalla Wear issues it from their portal on partner.invoice;
   partner.write lets a manager raise one on their behalf from inside the
   portal view. Gated on partner.write alone, the real partner account — which
   holds none of the shop's permissions — could never send an invoice at all. */
router.add('POST /api/partner-invoices', requirePerm(['partner.write', 'partner.invoice'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const invoice = Partner.createInvoice({ ...b, userId: ctx.user.id });
    bump();
    sendOk(ctx.res, { invoice });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* A payment is a handshake between the two companies. Either side may record
   one — the shop when it hands cash over (money.write: somebody who schedules
   print jobs is not thereby somebody who can say a supplier was paid), the
   printer when cash reaches it (partner.invoice). Which side is decided from
   the account, never the body. */
router.add('POST /api/partner-invoices/:id/payments', requirePerm(['money.write', 'partner.invoice'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const invoice = Partner.recordPayment({
      invoiceId: ctx.params.id, amount: Number(b.amount),
      method: b.method, at: b.at || null, side: side(ctx),
      userId: ctx.user.id, opId: b.opId || null
    });
    bump();
    sendOk(ctx.res, { invoice });
  } catch (e) { partnerFail(ctx.res, e); }
}));

/* The other half: the side that did NOT record the payment says it happened.
   lib/partner.js refuses a side confirming its own. */
router.add('POST /api/partner-invoices/:id/payments/:pid/confirm',
  requirePerm(['money.write', 'partner.invoice'], async (ctx) => {
    try {
      const invoice = Partner.confirmPayment({
        invoiceId: ctx.params.id, paymentId: ctx.params.pid, side: side(ctx), userId: ctx.user.id
      });
      bump();
      sendOk(ctx.res, { invoice });
    } catch (e) { partnerFail(ctx.res, e); }
  }));

/* ---- the Telegram line ---------------------------------------------------
   Each side links its own bot to its own chat and sees only its own half.
   The audience is the account's, never the body's: a partner asking for the
   shop's link code gets their own. */
const tgSide = (ctx) => (ctx.user.role === 'partner' ? 'yalla' : 'og');
const tgGate = ['config.write', 'partner.jobs'];

router.add('GET /api/telegram/status', requirePerm(tgGate, (ctx) => {
  const s = Telegram.status();
  const mine = tgSide(ctx);
  sendOk(ctx.res, { side: mine, ...s[mine], running: s.running,
                    /* The manager may also see whether the partner's line is up. */
                    other: mine === 'og' ? { linked: s.yalla.linked, configured: s.yalla.configured } : undefined });
}));

router.add('POST /api/telegram/link', requirePerm(tgGate, (ctx) => {
  try { sendOk(ctx.res, Telegram.linkCode(tgSide(ctx))); }
  catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/telegram/unlink', requirePerm(tgGate, (ctx) => {
  try { sendOk(ctx.res, Telegram.unlink(tgSide(ctx))); }
  catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/telegram/test', requirePerm(tgGate, async (ctx) => {
  try { sendOk(ctx.res, await Telegram.sendTest(tgSide(ctx))); }
  catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/suppliers', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { supplier: Partner.saveSupplier(b, ctx.user.id) }); }
  catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/employees', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { employee: Partner.saveEmployee(b, ctx.user.id) }); }
  catch (e) { partnerFail(ctx.res, e); }
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

/* Everything one product label needs, per size, including which shelf each
   size BELONGS on — resolved on the server so the size-range rules exist in
   exactly one place. */
router.add('GET /api/labels/product/:id', requirePerm('label.print', (ctx) => {
  const wh = ctx.url.searchParams.get('wh') || 'store';
  shelfOp(ctx, () => Shelves.labelRowsFor(Number(ctx.params.id), wh));
}));

/* The 60x40 shelf and product labels are laid out in HTML and printed by the
   browser's own dialog — the only path Arabic survives. They still have to
   land in the audit log, or nothing can answer "was this shelf's label ever
   printed", which is what phase 1's reassign warning counts. */
router.add('POST /api/labels/record', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Labels.record({
      preset: b.preset, station: b.station, items: b.items, userId: ctx.user.id
    }));
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

/* Run a shelf change, turning a refusal into the status it deserves and
   carrying the numbers the screen has to draw.

   THE FIFTH ARGUMENT OF sendError IS HEADERS, NOT BODY. A shelf refusal has to
   say where the pair actually belongs — which shelf, which room, which size
   range — and passing that to sendError would put it in the HTTP headers where
   nothing reads it. So this builds the body itself with sendJson, in the same
   `{ ok:false, code, error }` shape every other failure uses, plus whatever the
   lib attached to the error. Anything not on the list is a bug rather than a
   rule somebody broke, so it comes back 400 'invalid' like every other lib
   throw — an unmapped code would otherwise surface as a 500 with a stack. */
const SHELF_STATUS = {
  not_found:         404,
  /* Refusals: the request was well formed and the shop said no. */
  no_stock:          409,
  wrong_warehouse:   409,
  wrong_shelf:       409,
  wrong_size:        409,
  shelf_occupied:    409,
  section_not_empty: 409,
  room_not_empty:    409,
  wall_overlap:      409,
  wall_short:        409,
  room_too_small:    409,
  no_letters_left:   409,
  duplicate_key:     409,
  duplicate_code:    409,
  confirm_required:  409,
  /* Malformed: the request could not have worked whatever the shop looked like. */
  bad_request:       400,
  bad_key:           400,
  bad_wall:          400,
  bad_code:          400,
  bad_range:         400,
  no_rows:           400,
  no_columns:        400,
  too_many_rows:     400,
  too_many_cols:     400
};

function shelfOp(ctx, fn) {
  try {
    sendOk(ctx.res, fn());
  } catch (e) {
    const status = SHELF_STATUS[e.code];
    if (!status) return sendError(ctx.res, 400, 'invalid', e.message);
    /* Spreading an Error yields only what was deliberately attached to it —
       `message` and `stack` are own but not enumerable — so no stack reaches
       the browser. */
    const extra = { ...e };
    delete extra.code;
    sendJson(ctx.res, status, { ok: false, code: e.code, error: e.message, ...extra });
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
  /* A print job's cost is what the OTHER company charges to make it. It is
     the shop's margin on every shirt, and a cashier who can schedule a job
     has no business seeing it. */
  'cost',
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

/* One permission, or a list meaning any one of them.

   The list is for the routes both companies use. Yalla Wear holds none of
   the shop's permissions — they are not staff — so a board gated on
   print.read alone locked the partner out of their own work. */
function requirePerm(perm, handler) {
  const any = Array.isArray(perm) ? perm : [perm];
  return (ctx) => {
    if (!any.some((p) => Auth.can(ctx.user, p))) {
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

async function handle(req, res) {
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

        /* The website's door. A bearer key from server/.env instead of a
           session; compared in constant time. With no key configured the
           door does not exist, which is the state on a shop that has no
           website yet. */
        if (path.startsWith('/api/ext/')) {
          const want = process.env.OG_WEB_API_KEY || '';
          if (!want) return sendError(res, 503, 'not_configured', 'OG_WEB_API_KEY is not set on this server.');
          const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          const a = Buffer.from(got), b = Buffer.from(want);
          if (!got || a.length !== b.length || !timingSafeEqual(a, b)) {
            return sendError(res, 401, 'bad_key', 'The API key is missing or wrong.');
          }
          return await hit.handler({ req, res, url, params: hit.params, user: null, token: null });
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
}

export function createApp() { return createServer(handle); }

/* The plain-HTTP listener once HTTPS is up.

   It sends a BROWSER to the secure address and leaves everything else alone.
   Redirecting the API as well would have been tidier and wrong: the print
   agent, the website's bearer-key calls and every script on this machine
   speak http to localhost, and a redirect to a self-signed origin fails
   certificate validation in Node with a message about nothing they did. So:
   page requests move, machines carry on. */
function httpHandler(req, res) {
  const wantsPage = (req.method === 'GET' || req.method === 'HEAD') &&
    String(req.headers.accept || '').includes('text/html');
  const p = String(req.url || '/');
  if (!wantsPage || p.startsWith('/api/') || p.startsWith('/i/')) return handle(req, res);

  const host = String(req.headers.host || 'localhost').split(':')[0];
  res.writeHead(302, {
    Location: `https://${host}:${HTTPS_PORT}${p}`,
    'Cache-Control': 'no-store'
  });
  res.end();
}

/* Only start listening when run directly, so the tests can import createApp
   without a stray server binding a port. */
const runDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (runDirectly) {
  /* Before anything else, and it STOPS the shop opening — unlike preflight and
     the hardware check, which deliberately never do.

     Those two report a shop that can still sell shoes: a till that cannot
     print is a till. This one reports a guard that is not guarding. A
     permission name that does not exist makes Auth.can return false for
     everybody, silently, so the code reads like a check and is not one — and
     the direction it usually fails is open. That is not a thing to carry on
     past with a warning. */
  try {
    const { checked, dynamic } = PermCheck.assertPermissionNames();
    if (dynamic) {
      console.log(`\n  \x1b[2m${checked} permission names checked; ${dynamic} passed as a ` +
                  'variable and cannot be.\x1b[0m');
    }
  } catch (e) {
    console.error('\n\x1b[31m  PERMISSION NAMES\x1b[0m\n');
    console.error('  ' + e.message.split('\n').join('\n  ') + '\n');
    process.exit(1);
  }

  DB.open(DB_FILE);

  /* Expired sessions and stale login attempts, cleared hourly. unref() so this
     timer never holds the process open on shutdown. */
  setInterval(() => {
    try { Auth.sweep(); } catch (e) { console.error('sweep failed:', e.message); }
  }, 60 * 60 * 1000).unref();

  /* HTTPS when a certificate has been made, which is what every device
     other than this one needs before the browser will allow notifications,
     the camera scanner or installing the app. lib/tls.js says why it is
     self-signed and what that costs. */
  const creds = HTTPS_OFF ? null : TLS.load();
  if (creds) {
    SECURE = true;
    SECURE_SERVER = createTlsServer(creds, handle);
    SECURE_SERVER.listen(HTTPS_PORT);
    SECURE_SERVER.on('error', (e) => {
      console.log(`  HTTPS could not start on ${HTTPS_PORT} — ${e.message}`);
      SECURE_SERVER = null;
    });
  }

  const server = createServer(SECURE_SERVER ? httpHandler : handle);
  server.listen(PORT, () => {
    const n = DB.get().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    console.log('');
    console.log('  OG SYSTEM server');
    if (SECURE_SERVER) {
      console.log(`    listening : https://localhost:${HTTPS_PORT}`);
      console.log(`    plain http: :${PORT} — browsers are sent to the address above`);
    } else {
      console.log(`    listening : http://localhost:${PORT}`);
    }

    /* The address a phone or a second laptop must type. Printed rather than
       left for someone to dig out of ipconfig, because "open it on your
       phone" is how this gets tested every single day. */
    for (const net of lanAddresses()) {
      /* The secure one when there is one — this is the line somebody types
         into a second laptop, and handing them the plain-HTTP address is
         handing them a browser with the notifications switched off. */
      const url = SECURE_SERVER ? `https://${net.address}:${HTTPS_PORT}`
                                : `http://${net.address}:${PORT}`;
      console.log(`    on wifi   : ${url}` + (net.note ? `   (${net.note})` : ''));
    }

    console.log(`    database  : ${DB_FILE}`);
    console.log(`    app files : ${STATIC}`);
    console.log(`    accounts  : ${n}`);
    if (n === 0) {
      console.log('');
      console.log('    No accounts yet. Create the first manager with:');
      console.log('      npm run createuser');
    }

    /* The test accounts are gone, but three of them had rung up real sales,
       so their rows survive — disabled, with their passwords replaced by
       random bytes — because deleting them would have taken the invoices
       that name them. Only an ACTIVE one is worth shouting about: that
       means somebody switched it back on, and its old password was
       published in git history. */
    const demo = DB.get().prepare(
      `SELECT username FROM users
        WHERE active = 1
          AND username IN ('hussam','lubna','maher','talal','yalla')`
    ).all().map(r => r.username);

    if (demo.length) {
      console.log('');
      console.log(`    ${SECURE ? '*** WARNING ***  ' : ''}A RETIRED TEST ACCOUNT IS ACTIVE AGAIN: ${demo.join(', ')}`);
      console.log('    Its old password is in this repository' + "'" + 's history.');
      console.log('    Give it a new one, or set active = 0 in Settings.');
    }

    /* Same reasoning, and the more expensive one to miss: a seeded price is a
       price a cashier can charge a real customer. Counted rather than assumed,
       so the line disappears the moment the rows actually go. */
    const seeded = DB.get().prepare(
      `SELECT (SELECT COUNT(*) FROM products  WHERE demo = 1 AND hidden = 0) AS p,
              (SELECT COUNT(*) FROM customers WHERE demo = 1 AND archived = 0) AS c`
    ).get();

    if (seeded.p || seeded.c) {
      console.log('');
      console.log(`    ${SECURE ? '*** WARNING ***  ' : ''}DEMO CATALOGUE IS LOADED: ` +
                  `${seeded.p} product(s), ${seeded.c} customer(s).`);
      console.log('    Invented goods at invented prices — the till will sell them.');
      console.log('    Hide or delete them in Products before the shop opens.');
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
    /* The certificate: is it still valid, and does it still name the
       address this machine answers on? An IP that moved is a browser that
       refuses to connect at all, which reads as "the system is down". */
    if (SECURE_SERVER) {
      const missing = TLS.uncovered(lanAddresses().filter((x) => !x.note).map((x) => x.address));
      const left = TLS.daysLeft();
      if (missing.length) {
        console.log('');
        console.log(`    THIS MACHINE'S ADDRESS HAS CHANGED: ${missing.join(', ')}`);
        console.log('    The certificate does not name it, so other devices cannot');
        console.log('    open it. Run:  npm run cert   and restart.');
      }
      if (left !== null && left < 30) {
        console.log('');
        console.log(`    The certificate expires in ${left} days — npm run cert`);
      }
    } else if (!HTTPS_OFF) {
      console.log('');
      console.log('    No certificate, so this is plain HTTP. Other devices then');
      console.log('    get no notifications, no camera scanner and cannot install');
      console.log('    the app — browsers only allow those over HTTPS. Run:');
      console.log('      npm run cert');
    }

    if (!ORIGINS.length) {
      console.log('');
      console.log('    OG_ORIGINS is not set — any site your browser visits can');
      console.log('    send writes here while you are logged in. Fine on a shop');
      console.log('    network you control. Set it before reaching this from');
      console.log('    outside the shop, e.g.');
      console.log('      OG_ORIGINS=http://og-shop:8090');
    }

    /* Started here rather than at import, so the mirror can only ever begin
       once the till is actually listening. It pushes a couple of seconds
       after every commit and prints one line per push — see
       lib/sync-worker.js for why a failed mirror must never disturb a sale. */
    console.log('');
    SyncWorker.start();

    /* The Telegram line, same shape: drains the partner_events outbox on a
       timer and long-polls each bot for a link code. Off with no token. */
    Telegram.start();

    console.log('');
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('\n  shutting down');
      if (SECURE_SERVER) { try { SECURE_SERVER.close(); } catch (e) { /* already down */ } }
      server.close(() => { DB.close(); process.exit(0); });
      /* If a connection refuses to drain, do not hang forever. */
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
