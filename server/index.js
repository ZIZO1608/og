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
import { readFileSync } from 'node:fs';
import { dbFile } from './lib/env.js';
import { createServer as createTlsServer } from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadEnv } from './lib/env.js';
import * as DB from './lib/db.js';
import * as Auth from './lib/auth.js';
import * as Cat from './lib/catalogue.js';
import * as Categories from './lib/categories.js';
import * as People from './lib/people.js';
import * as Safeers from './lib/safeers.js';
import * as Stock from './lib/stock.js';
import * as Shelves from './lib/shelves.js';
import * as Sales from './lib/sales.js';
import * as Customers from './lib/customers.js';
import * as Loyalty from './lib/loyalty.js';
import * as Wants from './lib/wants.js';
import * as PermCheck from './lib/permcheck.js';
import * as Cap from './lib/capped.js';
import * as Deliveries from './lib/deliveries.js';
import * as Orders from './lib/orders.js';
import * as Partner from './lib/partner.js';
import * as Purchasing from './lib/purchasing.js';
import * as Alerts from './lib/alerts.js';
import * as Dashboard from './lib/dashboard.js';
import * as Reports from './lib/reports.js';
import * as Money from './lib/money.js';
import * as Cash from './lib/cashbook.js';
import * as DayClose from './lib/dayclose.js';
import * as Payables from './lib/payables.js';
import * as Statement from './lib/statement.js';
import * as Counts from './lib/counts.js';
import * as Receipt from './lib/receipt.js';
import * as Printing from './lib/printing.js';
import * as Labels from './lib/labels.js';
import * as SyncWorker from './lib/sync-worker.js';
import * as Telegram from './lib/telegram.js';
import * as Reminders from './lib/reminders.js';
import * as BackupSchedule from './lib/backup-schedule.js';
import * as Live from './lib/live.js';
import * as Tracking from './lib/tracking.js';
import * as Office from './lib/office-alerts.js';
import * as Push from './lib/webpush.js';
import * as Reviews from './lib/reviews.js';
import * as WebOrders from './lib/weborders.js';
import * as WebCheckout from './lib/webcheckout.js';
import * as TLS from './lib/tls.js';
import * as PanelLink from './lib/panel-link.js';
import * as Storage from './lib/storage.js';
import * as Photos from './lib/photos.js';
import * as SB from './lib/supabase.js';
import { CONFIG_WRITABLE, configRefusal } from './lib/config-writable.js';
import { lanAddresses, extraSans } from './lib/net.js';
import * as Fwd from './lib/proxy.js';
import * as Standby from './lib/standby.js';
import * as ReceiptQueue from './lib/receipt-queue.js';
import * as Loans from './lib/loans.js';
import * as Outbox from './lib/outbox.js';
import * as FxFeed from './lib/fxfeed.js';
import * as Scope from './lib/scope.js';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import {
  readJson, sendOk, sendError, sendErrorDetail, sendJson, parseCookies, CSP,
  serveStatic, makeRouter, originAllowed
} from './lib/http.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Before anything reads process.env. server/.env is optional — with no file
   the server starts exactly as it always did — but when one exists its
   values must be in place before the constants below are computed. Real
   environment variables still win over the file. */
loadEnv();

const PORT    = Number(process.env.OG_PORT || 8090);
const DB_FILE = dbFile();
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

/* A STANDBY takes no writes (lib/standby.js) — only these, so somebody can
   sign in to read it. Everything else that is not a GET answers 503
   standby_read_only; the app says it in the person's language. */
const STANDBY_OK = new Set([
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/hint',
  /* Local effects only: a slip out of this laptop's own printer (its print
     log goes with the next copy), and a person putting away an entry of the
     outbox that could not be sent (lib/outbox.js, a file of its own). */
  'POST /api/print',
  'POST /api/standby/outbox/dismiss'
]);

/* THE COPY DOOR (lib/standby.js). The whole database, for the standby to
   follow — behind OG_COPY_KEY, never for a visitor the public proxy carried,
   and never from a standby (a copy of a copy is a second place for the truth
   to go stale). The handler runs in the pipeline below, before any session.

   Before the snapshot, the laptop asking is LENT invoice numbers if it is
   short of them (lib/loans.js), and its own addresses are noted for the
   domain's page — so the loan travels inside the very copy it is handed. */
router.add('GET /api/copy/db', (ctx) => {
  const who = String(ctx.req.headers['x-og-standby-id'] || '');
  if (Loans.validHolder(who)) {
    try {
      DB.tx((d) => {
        Loans.topUp(d, who);
        Loans.noteStandby(d, who, String(ctx.req.headers['x-og-standby-urls'] || '').split(',').map((s) => s.trim()).filter(Boolean));
      });
    } catch (e) {
      /* A copy without a fresh loan is still a copy; the laptop sells on
         what it already holds. */
      console.error('  [copy] could not lend numbers to ' + who + ': ' + e.message);
    }
  }
  return Standby.sendCopy(ctx.res);
});

/* THE REPLAY (online first, phase 3). What the shop laptop did while the
   internet was down, sent back as the requests the till made (lib/outbox.js),
   each one run through THIS server's own route — the same handler, the same
   permission of the same person, the same rules — inside a scope that says
   when it really happened, which lent number it printed and which shift the
   till saw (lib/scope.js). Nothing here merges rows.

   Every entry is answered once: its uuid is an applied op, so a batch whose
   answer was lost on the way back is answered again rather than applied
   again. */
const REPLAY_WINDOW_MS = 14 * 86400000;
router.add('POST /api/copy/replay', async (ctx) => {
  const b = await readJson(ctx.req);
  const holder = String(b.holder || '');
  if (!Loans.validHolder(holder)) return sendError(ctx.res, 400, 'bad_holder', 'No such laptop.');
  const entries = Array.isArray(b.entries) ? b.entries.slice(0, 50) : [];
  const results = [];
  for (const e of entries) results.push(await replayOne(holder, e || {}));
  sendOk(ctx.res, { results });
});

async function replayOne(holder, e) {
  const uuid = String(e.uuid || '');
  if (!/^[0-9a-f-]{36}$/.test(uuid)) return { uuid, status: 400, body: { ok: false, code: 'bad_entry', error: 'No entry id.' } };
  const opId = 'rp:' + uuid;
  const seen = DB.get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
  if (seen) {
    let body = null;
    try { body = JSON.parse(seen.result); } catch { body = null; }
    return { uuid, status: 200, body, replayed: true };
  }
  const method = String(e.method || '');
  const path = String(e.path || '');
  const kind = Outbox.kindOf(method, path);
  const hit = kind ? router.match(method, path) : null;
  if (!kind || !hit) return { uuid, status: 400, body: { ok: false, code: 'not_replayable', error: 'That cannot be sent from the laptop.' } };
  const user = Auth.findById(Number(e.userId));
  if (!user) return { uuid, status: 409, body: { ok: false, code: 'unknown_user', error: 'The person who did this has no account here.' } };

  /* The real time, within reason: not in the future, not older than a
     fortnight. A laptop's clock is a laptop's clock. */
  const now = Date.now();
  const t = Date.parse(e.at);
  const at = new Date(Number.isFinite(t) ? Math.min(now, Math.max(t, now - REPLAY_WINDOW_MS)) : now).toISOString();

  const text = JSON.stringify(e.body && typeof e.body === 'object' ? e.body : {});
  const req = Readable.from([Buffer.from(text)]);
  req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) };
  req.method = method;
  req.url = path;
  req.socket = { remoteAddress: 'replay:' + holder };
  const res = captureRes();

  try {
    await Scope.run({
      at, holder, allowShort: true,
      shiftId: typeof e.shiftId === 'string' ? e.shiftId : null,
      lentInvoice: kind.kind === 'sale' && typeof e.localRef === 'string' && /^INV-\d+$/.test(e.localRef) ? e.localRef : null
    }, () => hit.handler({ req, res, url: new URL(path, 'http://replay'), params: hit.params, user, token: null }));
  } catch (err) {
    return { uuid, status: 500, body: { ok: false, code: 'server_error', error: err.message } };
  }
  let body = null;
  try { body = JSON.parse(res.text || 'null'); } catch { body = null; }
  if (res.status >= 200 && res.status < 300) {
    try {
      DB.get().prepare('INSERT OR IGNORE INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, ?, ?)')
        .run(opId, new Date().toISOString(), user.id, 'replay', JSON.stringify(body));
    } catch { /* the route's own opId still guards a sale */ }
  }
  return { uuid, status: res.status || 500, body };
}

/* A response that is only listened to — the replay's, whose answer goes back
   to the laptop inside the batch rather than onto a socket. */
function captureRes() {
  return {
    status: 0, text: '', headersSent: false,
    writeHead(s) { this.status = s; this.headersSent = true; return this; },
    setHeader() {}, getHeader() { return undefined; }, write(c) { this.text += String(c); return true; },
    end(c) { if (c !== undefined) this.text += String(c); }, on() { return this; }
  };
}

/* THE LAPTOP ITSELF, OFFLINE. One of the till's writes (lib/outbox.js KINDS),
   taken here because the main server is silent: written down BEFORE it runs,
   run through the ordinary route on the numbers the main server lent this
   laptop, then kept for the replay — or crossed off, when the route refused
   it and so nothing happened. */
async function offlineWrite(kind, { req, res, url, hit, user, token }) {
  const body = await readJson(req);
  const at = new Date().toISOString();
  const uuid = Outbox.begin({ kind: kind.kind, method: req.method, path: url.pathname, body, user, at });
  const text = JSON.stringify(body);
  const again = Readable.from([Buffer.from(text)]);
  again.headers = req.headers; again.method = req.method; again.url = req.url; again.socket = req.socket;

  /* Watch what the route answers, and still answer the till. */
  let status = 0, out = '';
  const writeHead = res.writeHead.bind(res), end = res.end.bind(res);
  res.writeHead = (s, ...rest) => { status = s; return writeHead(s, ...rest); };
  res.end = (c, ...rest) => { if (c !== undefined && typeof c !== 'function') out += String(c); return end(c, ...rest); };

  let ok = false, localRef = null, shiftId = null;
  try {
    await Scope.run({ at, offlineHolder: Standby.holder() },
      () => hit.handler({ req: again, res, url, params: hit.params, user, token }));
    ok = status >= 200 && status < 300;
    if (ok) {
      let j = null;
      try { j = JSON.parse(out); } catch { j = null; }
      if (kind.kind === 'sale' && j && j.sale) {
        localRef = j.sale.id;
        const row = DB.get().prepare('SELECT shift_id FROM sales WHERE id = ?').get(j.sale.id);
        shiftId = row ? row.shift_id : null;
      }
      if (kind.kind === 'cust_new' && j && j.customer) localRef = j.customer.id;
    }
  } finally {
    Outbox.finish(uuid, { ok, localRef, shiftId });
  }
}

/* Anything not in here requires a valid session. Denying by default means a
   new endpoint is locked until someone deliberately opens it. */
const PUBLIC = new Set([
  'POST /api/auth/login',
  'POST /api/auth/hint',
  'GET /api/health'
]);

/* WHICH BRANCH, AND WHEN DID THIS PROCESS START. Read once, from .git/HEAD —
   no dependency, no child process, and it is the only thing on this machine
   that knows which branch the files on disk came from. A detached HEAD has
   no ref name, so the short sha is the answer instead. Best-effort: a clone
   with no .git (the published site) simply has no branch to report. */
let BUILD = null;
function buildInfo() {
  if (BUILD) return BUILD;
  let branch = null;
  try {
    const head = readFileSync(new URL('../.git/HEAD', import.meta.url), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    branch = m ? m[1] : head.slice(0, 7);
  } catch { /* no .git, or no permission: the branch is simply unknown */ }
  BUILD = { branch, started: DB.nowIso() };
  return BUILD;
}

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
    lan: lanAddresses().filter((n) => !n.note).map((n) => `${scheme}://${n.address}:${port}`),
    /* THE MAIN SERVER, OR ITS STANDBY COPY (lib/standby.js). Public on
       purpose: the app draws "a read-only copy, as of 14:05" from it before
       anybody has signed in, and a time is not a secret. */
    role: Standby.role(),
    /* Offline or not, how much is waiting, and where to go back to: the
       strip on every screen of the laptop reads it (js/standby.js). Counts
       and times only — what the waiting sales ARE is behind a sign-in
       (GET /api/standby/outbox). */
    standby: Standby.isStandby() ? (() => {
      const s = Standby.status();
      return {
        copyAt: s.copyAt, reachable: s.reachable, mode: s.mode, offlineSince: s.offlineSince,
        backAt: s.backAt, sentLast: s.sentLast, waiting: s.waiting, waitingSales: s.waitingSales,
        attention: s.attention, numbersLeft: s.numbersLeft, home: s.home
      };
    })() : undefined,
    /* ON THE MAIN SERVER: where the shop laptop answers, for the page to
       offer when this server stops answering ("continue on the shop's own
       server"). The shop's own staff only — a stranger, and the print partner
       (another company), are not told the shop's internal addresses. */
    standbys: (!Standby.isStandby() && ctx.user && ctx.user.role !== 'partner') ? Loans.standbys() : undefined,
    /* WHICH BUILD IS THIS. Only for a caller who is already signed in — the
       route is in PUBLIC so the login screen can read it, and the payload a
       STRANGER on the wifi gets must not grow a branch name. `user` is
       resolved before the PUBLIC check, so a signed-in browser has it here.
       The developer's label in Settings prints it beside the service
       worker's cache name: between them they answer "which code is this
       laptop actually running", which cost fix 05 its first hour. */
    build: ctx.user ? buildInfo() : undefined
  });
});

/* --- the laptop's outbox (lib/outbox.js) ------------------------------------
   What the laptop did offline that the main server REFUSED, or that cannot be
   known to have happened (the laptop stopped mid-save). Money may have
   changed hands for any of them, so a person with the authority to void a
   sale reads them and puts each away once it is dealt with. Only on a
   standby; 404 anywhere else, like a path that does not exist. */
router.add('GET /api/standby/outbox', requirePerm(['config.write', 'void'], (ctx) => {
  if (!Standby.isStandby()) return sendError(ctx.res, 404, 'not_found', 'No such endpoint.');
  sendOk(ctx.res, { entries: Outbox.attention(), counts: Outbox.counts() });
}));

router.add('POST /api/standby/outbox/dismiss', requirePerm(['config.write', 'void'], async (ctx) => {
  if (!Standby.isStandby()) return sendError(ctx.res, 404, 'not_found', 'No such endpoint.');
  const b = await readJson(ctx.req);
  if (!Outbox.dismiss(b.uuid)) return sendError(ctx.res, 404, 'not_found', 'Nothing to put away.');
  sendOk(ctx.res, { counts: Outbox.counts() });
}));

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
  if (Auth.recentFailures('hint:' + username) >= 8) {
    return sendError(ctx.res, 429, 'too_many_attempts', 'Too many attempts.');
  }
  /* ITS OWN COUNTER (audit 06). This used to record a failed LOGIN against
     the username, so nine requests to this PUBLIC route — no password, no
     session — locked anybody out of the shop for fifteen minutes: the owner
     at 8 am, by anyone on the wifi. The hint door is still throttled exactly
     as hard, but under its own name, so asking for a hint can never spend a
     login attempt. */
  Auth.recordAttempt('hint:' + username, clientIp(ctx.req), false);
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
  ).all().filter((u) => !Auth.isHiddenUser(u));
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
  /* The owner's and the developer's rows are the access holders' to change. */
  if (['owner', 'developer'].includes(ctx.params.role) && !Auth.can(ctx.user, 'access.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'Only the owner or a developer can change this role.');
  }
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

/* --- Safeers (060) -------------------------------------------------------------
   The delivery team. The team page (safeer.read) carries earned and cash only
   with money.read — left out, not zeroed. Errands: the office reads and moves
   all of them (safeer.write to change), a safeer his own (role delivery,
   scoped in the SQL, somebody else's is 404). Parcels are moved on the
   deliveries routes, as the board moves them. */
function safeerFail(res, e) {
  sendError(res, e.status || (e.code === 'not_found' ? 404 : 400), e.code || 'invalid', e.message);
}
const safeerMine = (ctx) => (ctx.user.role === 'delivery' ? ctx.user.id : null);
router.add('GET /api/safeers', requirePerm('safeer.read', (ctx) => {
  const tz = Number(ctx.url.searchParams.get('tz')) || 180;
  sendOk(ctx.res, {
    ...Safeers.team({ money: Auth.can(ctx.user, 'money.read'), tz }),
    areas: Safeers.areas()
  });
}));
router.add('PUT /api/safeers/settings', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, Safeers.saveSettings({ rate: b.rate, areas: b.areas }, ctx.user.id)); }
  catch (e) { safeerFail(ctx.res, e); }
}));
router.add('POST /api/safeers', requirePerm('safeer.write', async (ctx) => {
  if (!Auth.can(ctx.user, 'staff.write') && !Auth.can(ctx.user, 'access.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'Adding a login needs the staff permission.');
  }
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, await People.add({ name: b.name, username: b.username, role: 'delivery', phone: b.phone || null })); }
  catch (e) { safeerFail(ctx.res, e); }
}));
router.add('POST /api/safeers/:id/active', requirePerm('safeer.write', async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Safeers.isSafeer(id)) return sendError(ctx.res, 404, 'not_found', 'No such safeer.');
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { user: People.setActive(id, !!b.active, ctx.user.id) }); }
  catch (e) { safeerFail(ctx.res, e); }
}));
router.add('POST /api/safeers/:id/phone', requirePerm('safeer.write', async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Safeers.isSafeer(id)) return sendError(ctx.res, 404, 'not_found', 'No such safeer.');
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { user: People.setPhone(id, b.phone) }); } catch (e) { safeerFail(ctx.res, e); }
}));
router.add('POST /api/safeers/:id/password', requirePerm('safeer.write', async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Safeers.isSafeer(id)) return sendError(ctx.res, 404, 'not_found', 'No such safeer.');
  try { sendOk(ctx.res, await People.newPassword(id)); } catch (e) { safeerFail(ctx.res, e); }
}));
router.add('GET /api/errands', requirePerm(['safeer.read', 'delivery.read'], (ctx) => {
  const p = ctx.url.searchParams;
  const mine = safeerMine(ctx);
  if (mine === null && !Auth.can(ctx.user, 'safeer.read')) return sendError(ctx.res, 403, 'forbidden', 'Your account does not have access to this.');
  /* the areas ride along: a safeer's phone cannot read the team page, and a
     task that says "furqan" instead of الفرقان is a task read wrong */
  sendOk(ctx.res, { errands: Safeers.list({ mine, safeer: p.get('safeer'), status: p.get('status'), since: p.get('since') }),
                    areas: Safeers.areas() });
}));
router.add('GET /api/errands/:id', requirePerm(['safeer.read', 'delivery.read'], (ctx) => {
  const mine = safeerMine(ctx);
  if (mine === null && !Auth.can(ctx.user, 'safeer.read')) return sendError(ctx.res, 403, 'forbidden', 'Your account does not have access to this.');
  const e = Safeers.byId(Number(ctx.params.id), mine);
  if (!e) return sendError(ctx.res, 404, 'not_found', 'No such errand.');
  sendOk(ctx.res, { errand: e });
}));
router.add('POST /api/errands', requirePerm('safeer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const errand = Safeers.create(b || {}, ctx.user.id);
    Live.notify('og', { deliveries: true });
    sendOk(ctx.res, { errand });
  } catch (e) { safeerFail(ctx.res, e); }
}));
router.add('PATCH /api/errands/:id', requirePerm(['safeer.write', 'delivery.write'], async (ctx) => {
  const b = await readJson(ctx.req);
  const mine = safeerMine(ctx);
  if (mine === null && !Auth.can(ctx.user, 'safeer.write')) return sendError(ctx.res, 403, 'forbidden', 'Your account does not have access to this.');
  try {
    /* a safeer moves his own forward and changes nothing else */
    const body = mine !== null ? { status: b.status, reason: b.reason } : b;
    const errand = Safeers.update(Number(ctx.params.id), body || {}, ctx.user, { mine });
    Live.notify('og', { deliveries: true });
    sendOk(ctx.res, { errand });
  } catch (e) { safeerFail(ctx.res, e); }
}));

/* --- access, per person (059) ------------------------------------------------
   The owner's panel: who can sign in, and what each of them may do on top of
   (or below) their role. access.write only — pinned to the owner and the
   developer. A password is in a response exactly twice: when a person is
   added and when theirs is reset, and never again (the developer panel reads
   the sealed box over its own pipe, never over HTTP). */
function accessFail(res, e) {
  sendError(res, e.status || (e.code ? 400 : 500), e.code || 'invalid', e.message);
}
router.add('GET /api/access', requirePerm('access.write', (ctx) => {
  sendOk(ctx.res, {
    people: People.list().map(People.shape),
    roles: Auth.ROLES,
    groups: [...new Set(Auth.ALL_PERMISSIONS.map((p) => p.group))]
  });
}));
router.add('GET /api/access/:id', requirePerm('access.write', (ctx) => {
  try { sendOk(ctx.res, Auth.userAccess(Number(ctx.params.id))); } catch (e) { accessFail(ctx.res, e); }
}));
router.add('PUT /api/access/:id/perm', requirePerm('access.write', async (ctx) => {
  const b = await readJson(ctx.req);
  const allowed = b.allowed === true ? true : b.allowed === false ? false : null;
  try { sendOk(ctx.res, Auth.setUserPermission(Number(ctx.params.id), String(b.perm || ''), allowed, ctx.user.id)); }
  catch (e) { accessFail(ctx.res, e); }
}));
router.add('POST /api/access/:id/reset', requirePerm('access.write', (ctx) => {
  try { sendOk(ctx.res, Auth.resetUserPermissions(Number(ctx.params.id))); } catch (e) { accessFail(ctx.res, e); }
}));
router.add('POST /api/access/people', requirePerm('access.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, await People.add({ name: b.name, username: b.username, role: b.role, phone: b.phone })); }
  catch (e) { accessFail(ctx.res, e); }
}));
router.add('POST /api/access/:id/active', requirePerm('access.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { user: People.setActive(Number(ctx.params.id), !!b.active, ctx.user.id) }); }
  catch (e) { accessFail(ctx.res, e); }
}));
router.add('POST /api/access/:id/password', requirePerm('access.write', async (ctx) => {
  try { sendOk(ctx.res, await People.newPassword(Number(ctx.params.id), { mustChange: false })); }
  catch (e) { accessFail(ctx.res, e); }
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

  /* THE LINKED-CHAT LISTS ARE NOT SETTINGS, they are a list of people's phone
     numbers by another name — chat ids, titles, who added them, and now whose
     account each belongs to. This route has no permission gate at all, so
     until now every signed-in account read both sides' lists, Yalla Wear
     included: another company holding the shop's staff group ids.

     Stripped here rather than moved out of `config`, because config is
     mirrored whole and that is the whole reason the links survive a restore
     onto another laptop. GET /api/telegram/status is the way to read them, and
     it scopes to the caller. */
  if (!Auth.can(ctx.user, 'config.write')) {
    delete config['telegram.og_chats'];
    delete config['telegram.yalla_chats'];
    delete config['telegram.og_chat_id'];
    delete config['telegram.yalla_chat_id'];
    delete config['telegram.og_chat_title'];
    delete config['telegram.yalla_chat_title'];
    /* The shop's own transfer accounts: the numbers a customer is told to pay
       into. The delivery office reads them through /api/orders/bootstrap,
       which asks for delivery.desk rather than handing them to every login. */
    delete config['pay.accounts'];
  }
  /* Couriers, the shipping price list and where orders are packed are the
     shop's business, not Yalla Wear's — the same reason delivery.* is
     FORBIDDEN to that role. */
  if (ctx.user && ctx.user.role === 'partner') {
    for (const k of Object.keys(config)) if (k.startsWith('delivery.')) delete config[k];
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
  /* A rate far from the current one must be CONFIRMED, by the feed's own
     limit (fx.feed_max_jump_pct, 20 %). The box used to save as it was
     typed, and on 24 Sep the live shop's rate went 1 → 138 → 15 → 150 → 138
     in a minute; since 067 every lira price is derived from it and every
     open till re-prices on it. `confirm: true` is the person saying yes. */
  const asked = Number(b.rate);
  let was = null;
  try { was = Cat.currentRate(b.base ?? 'USD', b.quote ?? 'SYP'); } catch { /* a first rate: nothing to compare */ }
  const limit = FxFeed.settings().jumpPct;
  if (was > 0 && asked > 0 && b.confirm !== true && limit > 0 &&
      Math.abs(asked - was) / was * 100 > limit) {
    return sendErrorDetail(ctx.res, 409, 'rate_jump',
      `${asked} is more than ${limit}% away from the current rate ${was} — confirm it`, { was, asked, limit });
  }
  let set;
  try {
    set = Cat.setRate({
      base: b.base ?? 'USD', quote: b.quote ?? 'SYP',
      rate: Number(b.rate), userId: ctx.user.id
    });
  } catch (e) {
    return sendError(ctx.res, 400, 'invalid', e.message);
  }
  sendOk(ctx.res, set);
  /* 067 — every price is dollars and the lira follows the rate, so every
     open tab must hear a rate typed by hand exactly as it hears the feed's:
     the till re-prices its basket on it (DB.reprice). The same event. */
  if (set.base === 'USD') Live.notify('og', { fx: { rate: set.rate, at: set.at, from: 'typed' } });
}));

/* The live exchange-rate feed (lib/fxfeed.js). Status for the Settings card;
   "check now" asks the feed and applies by the card's own rules; "apply" is
   the one press that overrides the jump guard, so it carries the person's id
   onto the fx_rates row. All three are config.write, like the box itself. */
router.add('GET /api/fx/feed', requirePerm('config.write', (ctx) => {
  sendOk(ctx.res, FxFeed.status());
}));
router.add('POST /api/fx/feed/check', requirePerm('config.write', async (ctx) => {
  sendOk(ctx.res, await FxFeed.check({ userId: ctx.user.id }));
}));
router.add('POST /api/fx/feed/apply', requirePerm('config.write', async (ctx) => {
  sendOk(ctx.res, await FxFeed.check({ force: true, userId: ctx.user.id }));
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
   rate saved, the tiers not. The fold saves properly now.

   reminders.* and shop.tz_minutes opened with 041. A reminder switch is a
   plain value with no side effect, unlike Telegram's link code, which mints
   in-memory state and therefore earned a route of its own. Note what this
   does NOT open: the partner writes reminders.yl_* through
   PUT /api/reminders/config, whose allow-list is narrower than this one. */
/* The list itself is CONFIG_WRITABLE in lib/config-writable.js, with the
   Save changes bug it was moved there to fix (shop.name, shop.address and
   shop.city were never on it), and a test holds it to the browser's keys. */

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

  const refused = configRefusal(updates);
  if (refused) return sendError(ctx.res, 400, 'invalid', refused);

  const at = DB.nowIso();
  DB.tx((d) => {
    const stmt = d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const k of keys) stmt.run(k, String(updates[k]), at);
  });
  /* A feed switch changed (how often, which side, the divisor, on/off): ask
     the feed again in a moment rather than on a timer that may be 24 h out. */
  if (keys.some((k) => k.startsWith('fx.feed_'))) { try { FxFeed.soon(); } catch (e) { /* the feed is off */ } }

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
  sendOk(ctx.res, { products: products.map(p => scrubCost(p, ctx.user)), categories: Categories.list() });
}));

/* --- categories (057) ------------------------------------------------------
   Anyone signed in reads them (the till's filter, the partner's nothing — a
   category name is not a secret). Only config.write changes them. Never
   deleted: PATCH { active: false } switches one off. */
function catFail(res, e) {
  const status = e.status || (e.code ? 400 : 500);
  sendError(res, status, e.code || 'invalid', e.message);
}
router.add('GET /api/categories', (ctx) => {
  if (!ctx.user) return sendError(ctx.res, 401, 'unauthenticated', 'Sign in first.');
  sendOk(ctx.res, { categories: Categories.list() });
});
router.add('POST /api/categories', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { category: Categories.create(b || {}) }); } catch (e) { catFail(ctx.res, e); }
}));
router.add('PATCH /api/categories/:id', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { category: Categories.update(ctx.params.id, b || {}) }); } catch (e) { catFail(ctx.res, e); }
}));

router.add('POST /api/products', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.createWithVariants({ ...b, userId: ctx.user.id }));
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

router.add('PATCH /api/products/:id', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { product: Cat.update(Number(ctx.params.id), b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

/* Delete a product for good. Refused with a reason the moment it would cost
   the shop history — Cat.remove says which. `product.write` is the same
   permission archiving needs; the guard is what it can and cannot remove,
   not who is asking. */
router.add('DELETE /api/products/:id', requirePerm('product.write', (ctx) => {
  try {
    const r = Cat.remove(Number(ctx.params.id), ctx.user.id);
    /* Its photos' files, after the commit — housekeeping; the rows are gone. */
    for (const f of r.files || []) Storage.removeObject(Storage.pathOfUrl(f)).catch(() => {});
    const { files, ...answer } = r;
    sendOk(ctx.res, answer);
  } catch (e) {
    if (e.code === 'not_found') return sendError(ctx.res, 404, 'not_found', e.message);
    if (e.code === 'has_history') return sendErrorDetail(ctx.res, 409, 'has_history', e.message, e.detail);
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* 066 — A COLOUR'S PHOTOGRAPHS. The model wearing it, the product on its
   own, and extras (lib/photos.js says why each is what it is). The browser
   sends each photo TWICE, already shrunk: `full` for the website (at most
   1600 px) and `thumb` for the till (at most 480 px). Both go into the
   public bucket, and the row holds the two addresses.

   The order matters and is the whole of the error handling:
   1. the checks (a real colour of this product, a slot, room for an extra)
      run BEFORE anything is uploaded, so a refusal leaves no orphan file;
   2. the two files go up;
   3. the row is written — and if that refuses (the answer changed in the
      meantime) the two files just uploaded are taken down again;
   4. the files of a photo this one REPLACED are taken down last. A remove
      that fails is not an error: the row is what the shop reads.
   503 not_configured is the honest answer on a server with no Supabase —
   the product is saved either way, only the photo has nowhere to go. */
const PHOTO_BODY = 4 * 1024 * 1024;

function photoError(ctx, e) {
  if (e.code === 'not_found') return sendError(ctx.res, 404, 'not_found', e.message);
  if (['bad_image', 'too_large', 'bad_kind', 'bad_colour'].includes(e.code)) return sendError(ctx.res, e.status === 413 ? 413 : 400, e.code, e.message);
  if (e.code === 'too_many') return sendError(ctx.res, 409, e.code, e.message);
  if (e.code === 'bad_json') return sendError(ctx.res, 400, e.code, e.message);
  if (e.code === 'not_ready') return sendError(ctx.res, 503, e.code, e.message);
  /* Unreachable, refused, a bucket that could not be made: the shop keeps
     selling and the person is told the photo did not land. */
  sendError(ctx.res, 503, 'storage_failed', e.message);
}

const dropFiles = (list) => { for (const f of list) if (f) Storage.removeObject(Storage.pathOfUrl(f)).catch(() => {}); };

async function putPhoto(userId, { productId, colourId, kind, full, thumb, width, height }) {
  Photos.assertCanAdd({ productId, colourId, kind });
  if (!SB.isConfigured()) {
    const e = new Error('Photos need Supabase, which is not set up on this server.'); e.code = 'not_configured'; throw e;
  }
  const big = Storage.decodeDataUrl(full);
  const small = thumb ? Storage.decodeDataUrl(thumb) : null;
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const url = await Storage.putObject(Storage.pathForPhoto(productId, colourId, stamp, 'l', big.ext), big.bytes, big.type);
  let thumbUrl = url;
  if (small) {
    try { thumbUrl = await Storage.putObject(Storage.pathForPhoto(productId, colourId, stamp, 's', small.ext), small.bytes, small.type); }
    catch (e) { dropFiles([url]); throw e; }
  }
  let r;
  try {
    r = Photos.add({ productId, colourId, kind, url, thumbUrl, width: Number(width), height: Number(height), userId });
  } catch (e) { dropFiles([url, thumbUrl === url ? null : thumbUrl]); throw e; }
  dropFiles(r.previous.filter((f) => f !== url && f !== thumbUrl));
  return r.photo;
}

router.add('POST /api/products/:id/photos', requirePerm('product.write', async (ctx) => {
  try {
    const b = await readJson(ctx.req, { max: PHOTO_BODY });
    const productId = Number(ctx.params.id);
    const photo = await putPhoto(ctx.user.id, {
      productId, colourId: Number(b.colourId) || Cat.firstColourId(productId), kind: String(b.kind || ''),
      full: b.full, thumb: b.thumb, width: b.width, height: b.height
    });
    sendOk(ctx.res, { photo });
  } catch (e) {
    if (e.code === 'not_configured') return sendError(ctx.res, 503, 'not_configured', e.message);
    photoError(ctx, e);
  }
}));

/* Into another slot (`kind` — "these two are the wrong way round" is one
   press), or an extra one place along (`move`: -1 or 1). No files move. */
router.add('PATCH /api/photos/:id', requirePerm('product.write', async (ctx) => {
  try {
    const b = await readJson(ctx.req);
    const id = Number(ctx.params.id);
    const photo = b.kind !== undefined ? Photos.setKind(id, String(b.kind), ctx.user.id)
      : Photos.move(id, Number(b.move) < 0 ? -1 : 1, ctx.user.id);
    sendOk(ctx.res, { photo });
  } catch (e) { photoError(ctx, e); }
}));

router.add('DELETE /api/photos/:id', requirePerm('product.write', (ctx) => {
  try {
    const r = Photos.remove(Number(ctx.params.id), ctx.user.id);
    dropFiles(r.previous);
    sendOk(ctx.res, { id: r.id, productId: r.productId });
  } catch (e) { photoError(ctx, e); }
}));

/* THE ONE-PICTURE ROUTES, KEPT FOR A TAB STILL RUNNING YESTERDAY'S CODE.
   Before 066 a product and a colour each had one picture. A browser that has
   not reloaded yet still sends `{ dataUrl }` here, so it lands where a
   picture of the shoe belongs — the PRODUCT photo of that colour (the
   product's first colour when no colour is named) — and `{ clear: true }`
   takes that photo off. The one small file stands in for both sizes. */
async function legacyPicture(ctx, productId, colourId) {
  const b = await readJson(ctx.req);
  if (b && b.clear) {
    const held = Photos.ofProduct(productId).find((x) => x.colourId === colourId && x.kind === 'product');
    if (held) dropFiles(Photos.remove(held.id, ctx.user.id).previous);
    return sendOk(ctx.res, { imageUrl: null });
  }
  const photo = await putPhoto(ctx.user.id, { productId, colourId, kind: 'product', full: b && b.dataUrl });
  sendOk(ctx.res, { imageUrl: photo.thumbUrl });
}

router.add('POST /api/products/:id/image', requirePerm('product.write', async (ctx) => {
  try {
    const productId = Number(ctx.params.id);
    const colourId = Cat.firstColourId(productId);
    if (!colourId) return sendError(ctx.res, 404, 'not_found', `No product with id ${productId}.`);
    await legacyPicture(ctx, productId, colourId);
  } catch (e) {
    if (e.code === 'not_configured') return sendError(ctx.res, 503, 'not_configured', e.message);
    photoError(ctx, e);
  }
}));

/* A size on one of a product's colours (058). Its opening stock, if any, is
   a "received" movement into `whId` — the same thing the new-product form
   books — and its printed codes are the ones that size already has on the
   product's other colours. */
router.add('POST /api/products/:id/variants', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.addVariant({
      productId: Number(ctx.params.id), size: b.size, colourId: b.colourId,
      qty: b.qty, whId: b.whId || 'store', shelf: b.shelf, userId: ctx.user.id
    }));
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

/* A new colour on a product that exists, with its sizes and their stock. */
router.add('POST /api/products/:id/colours', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cat.addColour({
      productId: Number(ctx.params.id), nameEn: b.nameEn, nameAr: b.nameAr, hex: b.hex,
      sizes: Array.isArray(b.sizes) ? b.sizes : [], whId: b.whId || 'store', userId: ctx.user.id
    }));
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

router.add('PATCH /api/colours/:id', requirePerm('product.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { colour: Cat.updateColour(Number(ctx.params.id), b || {}, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

/* A colour's one picture, from before 066 — see legacyPicture above. */
router.add('POST /api/colours/:id/image', requirePerm('product.write', async (ctx) => {
  try {
    const c = Cat.colourById(Number(ctx.params.id));
    if (!c) return sendError(ctx.res, 404, 'not_found', 'No such colour.');
    await legacyPicture(ctx, c.productId, c.id);
  } catch (e) {
    if (e.code === 'not_configured') return sendError(ctx.res, 503, 'not_configured', e.message);
    photoError(ctx, e);
  }
}));

/* --- stock ------------------------------------------------------------------ */

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

/* The whole shop's movement log — the warehouse's Moves tab. */
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
   is `config.write` (Stage C, below); putting stock away is `stock.move`.

   `/api/sections` and `/api/shelves` deliberately sit at the top level rather
   than under `/api/stock/`: router.match returns the FIRST route whose pattern
   fits, so a `GET /api/stock/:param` route added later would swallow them and
   answer `GET /api/stock/shelves` with a cheerful 200 and an empty result.
   `POST /api/stock/assign-shelf` is safe because every other POST under
   /api/stock/ is a literal path. */

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
    limits: { rack: Shelves.RACK_LIMITS, room_max_cm: Shelves.MAX_ROOM_CM, bay_min_cm: Shelves.BAY_MIN,
              /* 051: the narrowest aisle a free-standing rack may leave, and
                 the turns it may take — the drag previews both */
              aisle_min_cm: Shelves.aisleMin(), rotations: Shelves.ROTATIONS }
  });
}));

/* RESHAPING THE ROOM IS THE MANAGER'S (Stage C). Every route that adds, moves,
   resizes or removes a room, a rack, a level, a bay or a shelf is config.write
   — the same gate the browser's layout editor has always been drawn behind.
   They were stock.move, so anybody allowed to put a pair away could send the
   request by hand and reshape the room in the middle of a stock count. Editing
   a shelf — its code, capacity and what it is for — is config.write too;
   putting stock away (POST /api/stock/assign-shelf) stays stock.move. */
router.add('POST /api/sections', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ section: Shelves.createSection({
    whId: b.whId, key: b.key, name: b.name,
    sortIndex: b.sortIndex, gridOrigin: b.gridOrigin,
    roomId: b.roomId, wall: b.wall, wallPos: b.wallPos, wallCm: b.wallCm,
    placement: b.placement, xCm: b.xCm, yCm: b.yCm, rotDeg: b.rotDeg,
    bayCm: b.bayCm, levelCm: b.levelCm, depthCm: b.depthCm,
    /* a rack placed from inside the room brings its grid in the same breath */
    rows: b.rows, cols: b.cols, userId: ctx.user.id
  }) }));
}));

router.add('PATCH /api/sections/:id', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ section: Shelves.updateSection(Number(ctx.params.id), {
    name: b.name, sortIndex: b.sortIndex, gridOrigin: b.gridOrigin,
    roomId: b.roomId, wall: b.wall, wallPos: b.wallPos, wallCm: b.wallCm,
    placement: b.placement, xCm: b.xCm, yCm: b.yCm, rotDeg: b.rotDeg,
    bayCm: b.bayCm, levelCm: b.levelCm, depthCm: b.depthCm
  }, ctx.user.id) }));
}));

/* Rooms: the walls the racks hang on. The manager's, like the racks. */
router.add('POST /api/rooms', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ room: Shelves.createRoom({
    whId: b.whId, name: b.name, sortIndex: b.sortIndex,
    widthCm: b.widthCm, depthCm: b.depthCm, heightCm: b.heightCm, userId: ctx.user.id
  }) }));
}));

router.add('PATCH /api/rooms/:id', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ room: Shelves.updateRoom(Number(ctx.params.id), {
    name: b.name, sortIndex: b.sortIndex,
    widthCm: b.widthCm, depthCm: b.depthCm, heightCm: b.heightCm
  }, ctx.user.id) }));
}));

router.add('DELETE /api/rooms/:id', requirePerm('config.write', (ctx) => {
  shelfOp(ctx, () => Shelves.deleteRoom(Number(ctx.params.id), ctx.user.id));
}));

router.add('DELETE /api/sections/:id', requirePerm('config.write', (ctx) => {
  shelfOp(ctx, () => Shelves.deleteSection(Number(ctx.params.id), ctx.user.id));
}));

/* Lay a room out. Idempotent on code and it never deletes, because the shop is
   inventing this layout for the first time and will run it more than once. */
router.add('POST /api/sections/:id/grid', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.seedGrid(Number(ctx.params.id), {
    rows: b.rows, cols: b.cols, capacity: b.capacity
  }, ctx.user.id));
}));

/* `count` adds that many at once and `last` takes the last that many away —
   what a handle dragged in the room lets go of, in one transaction. */
router.add('POST /api/sections/:id/rows', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.editRows(Number(ctx.params.id), {
    action: b.action, row: b.row, cols: b.cols, count: b.count, last: b.last
  }, ctx.user.id));
}));

router.add('POST /api/sections/:id/cols', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.editCols(Number(ctx.params.id), {
    action: b.action, col: b.col, count: b.count, last: b.last
  }, ctx.user.id));
}));

router.add('POST /api/shelves', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => ({ shelf: Shelves.createShelf({
    sectionId: Number(b.sectionId), rowLabel: b.rowLabel,
    colIndex: b.colIndex, capacity: b.capacity, userId: ctx.user.id
  }) }));
}));

/* Rename, set capacity, set the assignment. Renaming a code or reassigning a
   shelf that still has stock on it changes nothing and returns the numbers
   first; `force` is how the manager says yes to what it just showed him.
   config.write, like the rest of the layout: a code change strands printed
   shelf labels, and the browser draws this form only for config.write. */
router.add('PATCH /api/shelves/:id', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  shelfOp(ctx, () => Shelves.updateShelf(Number(ctx.params.id), {
    code: b.code, capacity: b.capacity,
    productId: b.productId, sizeFrom: b.sizeFrom, sizeTo: b.sizeTo
  }, { force: b.force === true, userId: ctx.user.id }));
}));

router.add('DELETE /api/shelves/:id', requirePerm('config.write', (ctx) => {
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
    /* Selling offline (lib/loans.js): the laptop has no lent numbers left,
       or a replayed sale names a number this server never lent. */
    if (e.code === 'no_offline_numbers' || e.code === 'bad_lent_id' || e.code === 'lent_taken') {
      return sendError(ctx.res, 409, e.code, e.message);
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

/* Voiding is a manager's job, not a cashier's. A cashier who can void their
   own sale can take the cash and leave no trace, which is the commonest way
   money walks out of a shop. */
router.add('POST /api/sales/:id/void', requirePerm('void', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const result = Sales.voidSale(ctx.params.id, { reason: b.reason, userId: ctx.user.id });
    /* A cancelled order says so on the customer's page. Not an order: a no-op. */
    Tracking.moved(ctx.params.id, ctx.user.id);
    sendOk(ctx.res, { result });
  } catch (e) {
    /* Both are the world, not the request: money has been taken against the
       sale, or the order has already left the shop. */
    if (e.code === 'has_payments' || e.code === 'on_road') {
      return sendError(ctx.res, 409, e.code, e.message);
    }
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
  const p = ctx.url.searchParams;

  /* Every filter is answered by the database — status, how it travels, who
     owes what, a search — so "owes money" is every order that owes money and
     not the ones that happened to be in the last hundred. whoCell on the
     board counts a customer's FAILED deliveries across this array (Stage E),
     which is why the truncation travels with it. A driver's scope is applied
     inside Deliveries.board, by role, whatever the query asks for. */
  const cap = Deliveries.board(ctx.user, {
    status: p.get('status') || null,
    method: p.get('method') || null,
    money: p.get('money') || null,
    q: p.get('q') || null,
    since: p.get('since') || null,
    limit: Number(p.get('limit')) || 100
  });

  sendOk(ctx.res, {
    deliveries: cap.rows,
    deliveriesTotal: cap.total,
    deliveriesCapped: cap.capped,
    /* The board's tiles: the whole shop, whatever the filters say. Not for a
       driver — his phone is his own run, and a count of everybody else's
       parcels is a number about somebody else's work. */
    summary: ctx.user.role === 'delivery' ? null : Deliveries.summary(),
    /* His own day when he is a driver, so the phone can show a running
       count without a second request. */
    day: ctx.user.role === 'delivery' ? Deliveries.driverDay(ctx.user.id) : null
  });
}));

/* --- the delivery office ----------------------------------------------------
   Orders taken by phone, Instagram and WhatsApp. lib/orders.js holds the
   rules; these routes read the body and map the refusals. */

/* 409 when the request is fine and the world is not — the stock just sold,
   the order is already paid, a parcel cannot leave yet; 400 when the request
   itself is wrong. The amounts ride in the body, where js/api.js reads them
   as err.detail. */
function orderFail(res, e) {
  if (e.code === 'insufficient_stock') {
    return sendErrorDetail(res, 409, 'insufficient_stock',
      `Only ${e.available} of ${e.sku} left — the other till may have just sold it.`,
      { available: e.available, sku: e.sku });
  }
  if (e.code === 'discount_too_big') {
    return sendErrorDetail(res, 403, 'discount_too_big', e.message,
      { maxPct: e.maxPct, ceiling: e.ceiling });
  }
  if (['overpaid', 'plan_full_unpaid', 'unpaid_before_send'].includes(e.code)) {
    return sendErrorDetail(res, 409, e.code, e.message,
      { remaining: e.remaining ?? null, currency: e.currency ?? null });
  }
  if (e.code === 'bad_settings') {
    return sendErrorDetail(res, 400, 'bad_settings', e.message, { path: e.path ?? null });
  }
  /* lib/weborders.js carries its own status. */
  if (['test_order', 'web_rejected', 'web_accepted', 'bad_code'].includes(e.code) && e.status) {
    return sendError(res, e.status, e.code, e.message);
  }
  /* A sheet that cannot go names every parcel holding it up, so the person at
     the counter takes those off the pile rather than guessing. */
  if (e.code === 'handover_blocked') {
    return sendErrorDetail(res, 409, e.code, e.message, { blocked: e.blocked || [] });
  }
  if (['refund_too_big', 'no_credit', 'too_many'].includes(e.code)) {
    return sendErrorDetail(res, 409, e.code, e.message,
      { held: e.held ?? null, have: e.have ?? null, left: e.left ?? null,
        currency: e.currency ?? null });
  }
  const status = e.code === 'not_found' ? 404
               : e.code === 'forbidden' ? 403
               : ['voided', 'already_settled', 'nothing_pending', 'bad_status',
                  'unknown_customer', 'no_rate', 'on_another_sheet', 'empty',
                  'not_on_order'].includes(e.code) ? 409
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

router.add('GET /api/orders/bootstrap', requirePerm(['delivery.desk', 'delivery.read'], (ctx) => {
  sendOk(ctx.res, Orders.bootstrap({
    withAccounts: Auth.can(ctx.user, 'delivery.desk') || Auth.can(ctx.user, 'config.write'),
    withDrivers: Auth.can(ctx.user, 'delivery.write')
  }));
}));

/* Note what is NOT taken from the body, exactly as at the till: prices. The
   office sends what was scanned; the server prices it. The fee is the one
   number typed here, and the row says so (fee_source 'manual'). */
router.add('POST /api/orders', requirePerm('delivery.desk', async (ctx) => {
  const b = await readJson(ctx.req);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  /* A website order being accepted (js/weborders.js → the desk, filled in).
     Its opId is fixed to the order's own ref, never the desk's, so two people
     pressing Accept on one website order make ONE order: the second Save
     replays the first. A rejected or test order is refused before anything
     is written. */
  const webRef = str(b.webRef);
  try {
    if (webRef) WebOrders.forAccept(webRef);
    const out = Orders.create({
      lines: Array.isArray(b.lines) ? b.lines : [],
      whId: str(b.whId),
      customerId: b.customerId ? Number(b.customerId) : null,
      currency: str(b.currency),
      discount: Number(b.discount) || 0,
      channel: webRef ? 'web' : str(b.channel),
      note: str(b.note),
      dest: b.dest && typeof b.dest === 'object' ? b.dest : {},
      method: b.method,
      companyId: str(b.companyId),
      driverId: b.driverId ? Number(b.driverId) : null,
      trackingNo: str(b.trackingNo),
      feeMode: str(b.feeMode),
      fee: b.fee === undefined || b.fee === null || b.fee === '' ? null : Number(b.fee),
      plan: b.plan,
      payments: Array.isArray(b.payments) ? b.payments : [],
      userId: ctx.user.id,
      /* Read from the caller's role, never from the request. */
      unlimitedDiscount: Auth.can(ctx.user, 'discount.unlimited'),
      opId: webRef ? WebOrders.opIdFor(webRef) : str(b.opId)
    });
    Live.notify('og', { deliveries: true });
    if (!out.replayed) Tracking.moved(out.sale.id, ctx.user.id);
    /* The order is written; now the website hears it was accepted. A failure
       here is only bookkeeping — the Save replays on the same opId. */
    if (webRef) {
      try {
        WebOrders.accepted(webRef, out.sale.id, ctx.user.id);
        Live.notify('og', { web: true });
        SyncWorker.webSoon();
      } catch (e) { console.error(`[${new Date().toISOString()}] web order ${webRef} accepted as ${out.sale.id} but not marked — ${e.message}`); }
    }
    sendOk(ctx.res, {
      sale: scrubCost(out.sale, ctx.user),
      order: Deliveries.bySale(out.sale.id, ctx.user),
      money: out.money,
      replayed: !!out.replayed
    });
  } catch (e) { orderFail(ctx.res, e); }
}));

/* ---- the website's orders (lib/weborders.js) -------------------------------
   A queue the office works through: collected from the cloud every minute,
   confirmed by a phone call, then Accepted through the order desk above (its
   Save carries webRef) or Rejected here with a reason the website shows the
   customer. delivery.web throughout (062 — the cashier's too); Accepting is the
   desk's Save and so still delivery.desk. The customer match only with
   customer.read, and never a cost. */
router.add('GET /api/web-orders', requirePerm('delivery.web', (ctx) => {
  const sp = new URL(ctx.req.url, 'http://x').searchParams;
  sendOk(ctx.res, WebOrders.list({
    state: sp.get('state') || 'new',
    limit: sp.get('limit'),
    seesCustomers: Auth.can(ctx.user, 'customer.read')
  }));
}));

/* The photo of the transfer receipt the customer uploaded. It shows somebody
   else's bank details, so never cached. */
router.add('GET /api/web-orders/:ref/proof', requirePerm('delivery.web', (ctx) => {
  const p = WebOrders.proofPath(ctx.params.ref);
  if (!p) return sendError(ctx.res, 404, 'not_found', 'No photo for this order.');
  const type = p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end(readFileSync(p));
}));

/* Who the order is for, found by phone or made from what the website sent —
   only now, when a person has said the order is real. */
router.add('POST /api/web-orders/:ref/customer', requirePerm('delivery.web', (ctx) => {
  if (!Auth.can(ctx.user, 'customer.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'Adding a customer needs permission to edit customers.');
  }
  try {
    WebOrders.forAccept(ctx.params.ref);
    sendOk(ctx.res, WebOrders.customerFor(ctx.params.ref, ctx.user.id));
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('POST /api/web-orders/:ref/reject', requirePerm('delivery.web', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = WebOrders.reject(ctx.params.ref, { code: b.code, note: b.note, userId: ctx.user.id });
    Live.notify('og', { web: true });
    SyncWorker.webSoon();
    sendOk(ctx.res, out);
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('GET /api/orders/by-sale/:id', requirePerm(['delivery.read', 'delivery.desk'], (ctx) => {
  const order = Deliveries.bySale(ctx.params.id, ctx.user);
  if (!order) return sendError(ctx.res, 404, 'not_found', 'No such order.');
  sendOk(ctx.res, { order });
}));

router.add('POST /api/orders/:id/payments', requirePerm(['delivery.desk', 'debt.collect'], async (ctx) => {
  const b = await readJson(ctx.req);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  try {
    const out = Orders.pay(ctx.params.id, {
      amount: Number(b.amount), currency: str(b.currency), method: b.method,
      txnRef: str(b.txnRef), stage: str(b.stage), note: str(b.note), opId: str(b.opId)
    }, ctx.user);
    Live.notify('og', { deliveries: true });
    Tracking.moved(ctx.params.id, ctx.user.id);
    sendOk(ctx.res, { ...out, order: Deliveries.bySale(ctx.params.id, ctx.user) });
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('GET /api/orders/last-destination/:id', requirePerm('delivery.desk', (ctx) => {
  sendOk(ctx.res, { dest: Orders.lastDestination(Number(ctx.params.id)) });
}));

/* ------------------------------------------------------------ the handover
   One sheet, many parcels, one signature.

   THE SHEET BELONGS TO THE OFFICE. Every write here is `delivery.desk` and
   nothing else — the owner's decision, and a correction: these were also
   open to `delivery.write`, which a DRIVER holds, so on his own phone he
   could open a sheet in anybody's name, scan any parcel in the shop onto it,
   and send it out. Reading stays wider, because the checklist a driver works
   through during the day IS the sheet the office built for him. */


router.add('GET /api/handovers', requirePerm(['delivery.desk', 'delivery.write', 'delivery.read'], (ctx) => {
  const u = new URL(ctx.req.url, 'http://x');
  sendOk(ctx.res, {
    handovers: Orders.handoverList({
      status: u.searchParams.get('status'),
      limit: Number(u.searchParams.get('limit')) || 20
    })
  });
}));

router.add('GET /api/handovers/:id', requirePerm(['delivery.desk', 'delivery.write', 'delivery.read'], (ctx) => {
  const h = Orders.handover(ctx.params.id);
  if (!h) return sendError(ctx.res, 404, 'not_found', 'No such handover.');
  sendOk(ctx.res, { handover: h });
}));

router.add('POST /api/handovers', requirePerm('delivery.desk', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      handover: Orders.openHandover({
        kind: b.kind,
        driverId: b.driverId ? Number(b.driverId) : null,
        companyId: typeof b.companyId === 'string' && b.companyId ? b.companyId : null,
        userId: ctx.user.id, userName: ctx.user.name
      })
    });
  } catch (e) { orderFail(ctx.res, e); }
}));

/* The scan. The body carries an invoice id; which parcel that is, is the
   server's answer. */
router.add('POST /api/handovers/:id/lines', requirePerm('delivery.desk', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { handover: Orders.addToHandover(ctx.params.id, String(b.saleId || ''), ctx.user) });
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('DELETE /api/handovers/:id/lines/:delivery', requirePerm('delivery.desk', (ctx) => {
  try {
    sendOk(ctx.res, {
      handover: Orders.removeFromHandover(ctx.params.id, Number(ctx.params.delivery), ctx.user)
    });
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('POST /api/handovers/:id/hand', requirePerm('delivery.desk', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = Orders.handOver(ctx.params.id, ctx.user, typeof b.opId === 'string' ? b.opId : null);
    Live.notify('og', { deliveries: true });
    Tracking.moved(Tracking.salesOnHandover(ctx.params.id), ctx.user.id);
    sendOk(ctx.res, out);
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('POST /api/handovers/:id/cancel', requirePerm('delivery.desk', (ctx) => {
  try { sendOk(ctx.res, { handover: Orders.cancelHandover(ctx.params.id, ctx.user) }); }
  catch (e) { orderFail(ctx.res, e); }
}));

/* ------------------------------------------------------ delivery reviews
   The Reviews page. Reading is the delivery office's; putting a review on the
   public website is a manager's decision (config.write), and the server
   refuses it for a review the customer did not allow (lib/reviews.js). The
   summary is the whole shop's, never the filtered list's. */
router.add('GET /api/reviews', requirePerm('delivery.desk', (ctx) => {
  const sp = new URL(ctx.req.url, 'http://x').searchParams;
  const out = Reviews.list({
    stars: sp.get('stars') || '', show: sp.get('show') || '', q: sp.get('q') || '', limit: sp.get('limit')
  });
  sendOk(ctx.res, { ...out, summary: Reviews.summary(), tags: Reviews.TAGS });
}));

router.add('PATCH /api/reviews/:id', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const review = Reviews.setWeb(ctx.params.id, b.onWeb === true, ctx.user);
    Live.notify('og', { reviews: true });
    sendOk(ctx.res, { review });
  } catch (e) {
    sendError(ctx.res, e.status || 400, e.code || 'invalid', e.message);
  }
}));

/* The office's order alerts are on Telegram now (lib/office-alerts.js, 052);
   the Deliveries board's Web Push bell and its three /api/push routes are gone.
   A browser left subscribed gets 404 from nothing — it has no route to call. */

/* ------------------------------------------------------- the driver's cash */
router.add('GET /api/driver-cash', requirePerm(['delivery.desk', 'money.read', 'debt.collect'], (ctx) => {
  const u = new URL(ctx.req.url, 'http://x');
  const asked = Number(u.searchParams.get('driverId')) || null;
  /* A driver may only ever ask about his own pockets. */
  const who = ctx.user.role === 'delivery' ? ctx.user.id : asked;
  sendOk(ctx.res, Orders.driverCash(who));
}));

router.add('POST /api/driver-cash/handin', requirePerm(['delivery.desk', 'debt.collect'], async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = Orders.handInFor(Number(b.driverId), {
      saleIds: Array.isArray(b.saleIds) ? b.saleIds : null,
      opId: typeof b.opId === 'string' ? b.opId : null
    }, ctx.user);
    Live.notify('og', { deliveries: true });
    Office.handedIn(out, ctx.user);
    sendOk(ctx.res, out);
  } catch (e) { orderFail(ctx.res, e); }
}));

/* ------------------------------------------------------------- the returns */
router.add('GET /api/orders/:id/returns', requirePerm(['delivery.desk', 'delivery.read'], (ctx) => {
  sendOk(ctx.res, {
    lines: Orders.returnable(ctx.params.id),
    returns: Orders.returnsFor(ctx.params.id)
  });
}));

router.add('POST /api/orders/:id/returns', requirePerm('delivery.desk', async (ctx) => {
  const b = await readJson(ctx.req);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  try {
    const out = Orders.takeBack(ctx.params.id, {
      outcome: b.outcome,
      lines: Array.isArray(b.lines) ? b.lines : [],
      whId: str(b.whId), reason: str(b.reason), note: str(b.note),
      amount: b.amount === undefined || b.amount === null || b.amount === '' ? null : Number(b.amount),
      currency: str(b.currency), method: str(b.method) || 'cash', txnRef: str(b.txnRef),
      opId: str(b.opId)
    }, ctx.user);
    Live.notify('og', { deliveries: true });
    Tracking.moved(ctx.params.id, ctx.user.id);
    sendOk(ctx.res, { ...out, order: Deliveries.bySale(ctx.params.id, ctx.user) });
  } catch (e) { orderFail(ctx.res, e); }
}));

router.add('PUT /api/delivery/settings', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { settings: Orders.saveSettings(b) }); }
  catch (e) { orderFail(ctx.res, e); }
}));

/* WHAT THE WEBSITE'S CHECKOUT SHOWS, read back from the cloud with the
   website's own key (lib/webcheckout.js, server/supabase/031). The same
   question the website asks, so "Live on the website ✓" is a fact about the
   website and not about this laptop. config.write: the answer carries the
   shop's transfer accounts. POST pushes what is waiting first — the check
   straight after a Save. */
router.add('GET /api/web-checkout', requirePerm('config.write', async (ctx) => {
  sendOk(ctx.res, await WebCheckout.report());
}));

router.add('POST /api/web-checkout/check', requirePerm('config.write', async (ctx) => {
  sendOk(ctx.res, await WebCheckout.report({ push: true }));
}));

/* A WhatsApp message the office opened for a customer. wa.me cannot say
   whether it was sent — the person presses send in WhatsApp — so this records
   that it was OPENED, from which order, by whom. wa_messages has had a table
   and a writer (Partner.logWhatsApp) since 015 and nothing had ever called it. */
router.add('POST /api/wa-messages', requirePerm(['delivery.desk', 'customer.write'], async (ctx) => {
  const b = await readJson(ctx.req);
  const phone = typeof b.phone === 'string' ? b.phone.replace(/\D/g, '').slice(0, 20) : '';
  const body = typeof b.body === 'string' ? b.body.slice(0, 4000) : '';
  if (!phone || !body) {
    return sendError(ctx.res, 400, 'invalid', 'A WhatsApp record needs a number and the message.');
  }
  Partner.logWhatsApp({
    phone, body,
    kind: typeof b.kind === 'string' ? b.kind.slice(0, 40) : null,
    refType: typeof b.refType === 'string' ? b.refType.slice(0, 20) : null,
    refId: typeof b.refId === 'string' ? b.refId.slice(0, 40) : null,
    userId: ctx.user.id
  });
  sendOk(ctx.res, {});
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
                  'overpaid', 'voided', 'bad_status', 'already_voided', 'place_used',
                  'take_too_much'].includes(e.code) ? 409
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

/* ------------------------------------------------------------ the cash book
   Where every lira and dollar is (053, lib/cashbook.js). Reading is the money
   screen's permission; every write here says where the SHOP's money went and
   none of them is a sale, so they are money.move — the manager's. Each carries
   an opId: a Move tapped twice on a stalled connection must move once. */

router.add('GET /api/cash/book', requirePerm('money.read', (ctx) => {
  const u = new URL(ctx.req.url, 'http://x');
  const q = (k) => u.searchParams.get(k) || null;
  sendOk(ctx.res, Cash.book({
    place: q('place'), kind: q('kind'), from: q('from'), to: q('to'),
    limit: Number(q('limit')) || 200
  }));
}));

const cashStr = (v) => (typeof v === 'string' && v ? v : null);

router.add('POST /api/cash/transfer', requirePerm('money.move', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cash.transfer({
      from: cashStr(b.from), to: cashStr(b.to), currency: cashStr(b.currency),
      amount: Number(b.amount), fee: Number(b.fee) || 0, note: cashStr(b.note),
      opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/cash/exchange', requirePerm('money.move', async (ctx) => {
  const b = await readJson(ctx.req);
  const side = (v) => ({ currency: cashStr(v && v.currency), amount: Number(v && v.amount) });
  try {
    const out = Cash.exchange({
      place: cashStr(b.place), toPlace: cashStr(b.toPlace), give: side(b.give), get: side(b.get),
      /* Setting the shop's rate is a Settings decision, so it takes that
         permission too — money.move alone records the exchange. */
      setRate: !!b.setRate && Auth.can(ctx.user, 'config.write'),
      note: cashStr(b.note), opId: cashStr(b.opId), userId: ctx.user.id
    });
    sendOk(ctx.res, out);
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/cash/owner', requirePerm('money.move', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cash.ownerMove({
      direction: b.direction, place: cashStr(b.place) || 'owner', currency: cashStr(b.currency),
      amount: Number(b.amount), note: cashStr(b.note), opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/cash/check', requirePerm('money.move', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Cash.check({
      place: cashStr(b.place), currency: cashStr(b.currency), counted: b.counted,
      note: cashStr(b.note), opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { moneyFail(ctx.res, e); }
}));

/* ------------------------------------------------------- closing the day
   (054, lib/dayclose.js). THE COUNT IS BLIND ON THE SERVER, not only on the
   screen: an account that may count but not confirm is never sent what the
   book expects, or the difference — in the answer to its own count, or in
   the list. A hidden figure in the browser is one devtools away. */
const seesDrawer = (user) => Auth.can(user, 'money.move');
const shapeClose = (c, user) => (!c ? null : seesDrawer(user) ? c : DayClose.blind(c));

router.add('GET /api/day-close', requirePerm(['money.count', 'money.move'], (ctx) => {
  sendOk(ctx.res, {
    open: shapeClose(DayClose.open(), ctx.user),
    /* The history is the owner's: it is a list of how short people were. */
    recent: seesDrawer(ctx.user) ? DayClose.recent({ limit: 30 }) : [],
    day: DayClose.dayKey(DB.get())
  });
}));

router.add('POST /api/day-close/count', requirePerm('money.count', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = DayClose.count({
      counted: b.counted && typeof b.counted === 'object' ? b.counted : {},
      note: cashStr(b.note), opId: cashStr(b.opId),
      userId: ctx.user.id, userName: ctx.user.name
    });
    sendOk(ctx.res, { close: shapeClose(out.close, ctx.user), recount: !!out.recount, replayed: !!out.replayed });
  } catch (e) {
    if (e.code === 'count_all') {
      return sendErrorDetail(ctx.res, 400, e.code, e.message, { missing: e.missing || [] });
    }
    moneyFail(ctx.res, e);
  }
}));

router.add('POST /api/day-close/:id/confirm', requirePerm('money.move', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    const out = DayClose.confirm(ctx.params.id, {
      taken: b.taken && typeof b.taken === 'object' ? b.taken : {},
      ownerNote: cashStr(b.ownerNote), opId: cashStr(b.opId),
      userId: ctx.user.id, userName: ctx.user.name
    });
    sendOk(ctx.res, { close: out.close, replayed: !!out.replayed });
  } catch (e) { moneyFail(ctx.res, e); }
}));

router.add('POST /api/day-close/:id/cancel', requirePerm('money.move', (ctx) => {
  try { sendOk(ctx.res, { close: DayClose.cancel(ctx.params.id, { userId: ctx.user.id }) }); }
  catch (e) { moneyFail(ctx.res, e); }
}));

/* The owner's own places — a safe, a bank. Settings, so config.write. */
router.add('PUT /api/cash/places', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { places: Cash.savePlaces(b.places) });
  } catch (e) { moneyFail(ctx.res, e); }
}));

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
        place: typeof b.place === 'string' && b.place ? b.place : null,
        note: b.note || null, at: b.at || null, currency: b.currency || null,
        userId: ctx.user.id
      })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));

/* A wrong expense, undone as a row in the cash book — never deleted. */
router.add('POST /api/expenses/:id/void', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      expense: Money.voidExpense(ctx.params.id, {
        reason: typeof b.reason === 'string' ? b.reason : null, userId: ctx.user.id
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
/* 055: through lib/payables.js — what is owed comes with the ledger's own
   sums, and a pay day is derived from what has actually been paid. */
router.add('GET /api/suppliers', requirePerm('money.read', (ctx) => {
  sendOk(ctx.res, { suppliers: Payables.suppliers() });
}));

router.add('GET /api/employees', requirePerm('staff.read', (ctx) => {
  sendOk(ctx.res, { employees: Payables.employees() });
}));

/* ---------------------------------------------- paying suppliers and staff
   Every payment moves money out of a cash-book place, so it carries an opId
   and the permission that says money may be moved. */
function payFail(res, e) {
  if (e.code === 'more_than_owed') {
    return sendErrorDetail(res, 409, e.code, e.message, { left: e.left ?? null, currency: e.currency ?? null });
  }
  const status = e.code === 'not_found' ? 404
               : ['already_voided', 'already_opened', 'currency_locked'].includes(e.code) ? 409
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}

router.add('GET /api/suppliers/:id/ledger', requirePerm('money.read', (ctx) => {
  const s = Payables.supplier(Number(ctx.params.id));
  if (!s) return sendError(ctx.res, 404, 'not_found', 'No such supplier.');
  sendOk(ctx.res, { supplier: s, ledger: Payables.ledger(s.id, { limit: 300 }) });
}));

router.add('POST /api/suppliers/:id/payments', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Payables.paySupplier({
      supplierId: Number(ctx.params.id), amount: Number(b.amount), currency: cashStr(b.currency),
      place: cashStr(b.place), note: cashStr(b.note), opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { payFail(ctx.res, e); }
}));

router.add('POST /api/suppliers/:id/ledger', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Payables.adjustSupplier({
      supplierId: Number(ctx.params.id), kind: cashStr(b.kind), amount: Number(b.amount),
      note: cashStr(b.note), opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { payFail(ctx.res, e); }
}));

router.add('POST /api/supplier-ledger/:id/void', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Payables.voidSupplierPayment(Number(ctx.params.id), {
      reason: cashStr(b.reason), userId: ctx.user.id
    }));
  } catch (e) { payFail(ctx.res, e); }
}));

router.add('GET /api/payroll', requirePerm('staff.read', (ctx) => {
  const u = new URL(ctx.req.url, 'http://x');
  try { sendOk(ctx.res, Payables.payroll({ month: u.searchParams.get('month') || null })); }
  catch (e) { payFail(ctx.res, e); }
}));

/* staff.write for the payroll, and money.write as well when the entry moves
   money — an advance or a salary leaves a cash-book place. */
router.add('POST /api/payroll', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  if (Payables.MOVES_MONEY(b.kind) && !Auth.can(ctx.user, 'money.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'Paying a salary needs the right to record money.');
  }
  try {
    sendOk(ctx.res, Payables.payStaff({
      employeeId: Number(b.employeeId), month: cashStr(b.month), kind: cashStr(b.kind),
      amount: Number(b.amount), place: cashStr(b.place), note: cashStr(b.note),
      opId: cashStr(b.opId), userId: ctx.user.id
    }));
  } catch (e) { payFail(ctx.res, e); }
}));

router.add('POST /api/payroll/:id/void', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  if (!Auth.can(ctx.user, 'money.write')) {
    return sendError(ctx.res, 403, 'forbidden', 'Undoing a payment needs the right to record money.');
  }
  try {
    sendOk(ctx.res, Payables.voidStaffPayment(Number(ctx.params.id), {
      reason: cashStr(b.reason), userId: ctx.user.id
    }));
  } catch (e) { payFail(ctx.res, e); }
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

/* The month's statement (lib/statement.js): profit and loss on profit.read,
   and the cash flow beside it only for an account that may see where the
   money is. The month is the shop's; `tz` is minutes east of UTC. */
router.add('GET /api/statement', requirePerm('profit.read', (ctx) => {
  const q = ctx.url.searchParams;
  try {
    sendOk(ctx.res, Statement.build({
      month: q.get('month') || null, tz: q.get('tz'),
      withCash: Auth.can(ctx.user, 'money.read')
    }));
  } catch (e) {
    if (e.code === 'bad_range') return sendError(ctx.res, 400, 'bad_range', e.message);
    throw e;
  }
}));

/* One alert by key, or everything currently showing when no key is named.
   Keyed on what the alert is ABOUT, so counting down from "due in 3 days" to
   "due in 2 days" does not make a read alert come back unread. */
router.add('POST /api/notifications/read', async (ctx) => {
  const b = await readJson(ctx.req);
  /* a key is a short string; anything else marks nothing rather than reaching SQLite as an object */
  sendOk(ctx.res, Alerts.markRead(ctx.user, typeof b.key === 'string' ? b.key.slice(0, 200) : null));
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
      reviews: bundle.reviews,
      /* Who wrote, sent, accepted or moved each thing — both ways, by the
         owner's decision. It is a name and nothing else (never a username,
         never a role, never an account anyone could sign in as), and only
         for the people these very rows already point at. A conversation
         between two companies reads as people or it reads as two logos. */
      people: bundle.people,
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
    /* The same names the partner branch carries: who wrote, sent, accepted,
       moved or paid for each row. Yalla Wear is two partners, so the shop
       asking "which of them accepted this" is the whole point of it. */
    people: bundle.people,
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
  'invoice_exists', 'already_invoiced', 'job_not_done', 'mixed_currency',
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

/* THE SHELF MAP IS LIVE (Stage C). Not one more line at the end of every
   route: a pair reaches a shelf, or leaves one, through the put-away scan,
   a sale, a transfer, a count, a delivery, a return — and a route that forgot
   to say so would be a room quietly showing yesterday's boxes. Every one of
   those already logs the table it wrote, so the commit hook is the one place
   that cannot be missed. A flag and nothing else goes out, to the shop's side
   only: `layout` when a room, a rack or a shelf changed, `stock` when only
   what is on them did. It is a hint — the browser compares what it fetches
   and decides for itself. A burst of writes is one event. */
{
  const LAYOUT = new Set(['rooms', 'sections', 'shelves']);
  let timer = null, kind = null;
  DB.onCommit((tables) => {
    let hit = null;
    for (const t of tables) {
      if (LAYOUT.has(t)) { hit = 'layout'; break; }
      if (t === 'stock') hit = 'stock';
    }
    if (!hit) return;
    if (hit === 'layout' || !kind) kind = hit;
    if (timer) return;
    timer = setTimeout(() => {
      const k = kind;
      timer = null; kind = null;
      Live.notify('og', { shelves: k });
    }, 250);
    if (timer.unref) timer.unref();
  });
}

/* The live channel. One long GET per open tab; lib/live.js writes a one-line
   "change" event whenever bump() runs, and the browser refetches through the
   ordinary gated routes. Which side a tab is on comes from the account.
   config.write too: the mirror's status rides on this channel, and a manager
   who cannot see print jobs still owns the Settings fold that draws it. The
   event carries no shop data either way.

   delivery.read and delivery.desk since 046: the board is a screen two people
   watch at once — the office scanning a sheet and whoever is answering the
   phone — and a parcel that left five minutes ago showing as waiting is how
   the same parcel gets handed to two carriers. The event still carries
   nothing but a flag; the board refetches through its own gated route. */
/* stock.read since Stage C: the shelf map is live, and the person putting
   stock away in the back room holds neither a print nor a delivery
   permission. The event carries a flag and nothing else — the map refetches
   through GET /api/sections, which is stock.read already. */
router.add('GET /api/live', requirePerm(['print.read', 'partner.jobs', 'config.write', 'delivery.read', 'delivery.desk', 'delivery.web', 'stock.read'], (ctx) => {
  /* The name rides along so the other company's screen can say who is
     here. Yalla Wear is two people and the shop wants the one who is
     actually reading, not the company. */
  Live.subscribe(ctx.res, side(ctx), ctx.user.id, ctx.user.name);
}));

/* ---- the website ----------------------------------------------------------
   The e-commerce intake. No session: a bearer key from server/.env
   (OG_WEB_API_KEY), checked in the request pipeline before these run. The
   website raises a job exactly the way the till does — source 'web',
   sent to Yalla Wear in the same transaction when every shirt is named —
   and reads back where it is and what the shop thought of it. It never
   receives the printer's price.

   SUPERSEDED for the website by its orders (lib/weborders.js): a print job
   now travels inside the order, so the office sees the whole order in one
   place. Kept for anything already calling it. The price is
   Partner.webPrices(), the one copy both doors read. */
const webPrices = () => Partner.webPrices();

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
      clubCode: Partner.clubCodeFor(l.clubCode), printName: l.printName ?? l.name ?? null,
      number: l.number ?? null, size: l.size ?? null, qty: Number(l.qty) || 1,
      unitCost: px.cost
    })) : [];
    const kind = lines.length ? 'kit' : 'bulk';
    const qty = kind === 'kit' ? lines.reduce((a, l) => a + l.qty, 0) : (Number(b.qty) || 0);
    const job = Partner.create({
      customer: b.customer, phone: b.phone ?? null, design: b.design, kind, qty,
      priority: b.priority === 'urgent' ? 'urgent' : 'normal',
      deadline: b.deadline ?? null,
      price: Number.isFinite(Number(b.price)) ? Math.round(Number(b.price)) : (px.price == null ? 0 : qty * px.price),
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

/* ---- the website's catalogue -------------------------------------------
   Behind the same bearer key as the print-job door above (the /api/ext/
   prefix is gated in the request pipeline, so there is no session and
   ctx.user is null). Cat.webList decides what a public page may know —
   `hidden = 0 AND on_web = 1 AND demo = 0`, no cost, no stock counts.

   The list is the whole published catalogue in one answer, deliberately:
   see the note on webRow for why there is no incremental feed. */
/* The delivery reviews the website may show: the customer allowed it AND the
   shop switched it on. A first name and initial, a city, stars, tags in both
   languages and the words — never the invoice number, phone or address.
   ?limit= up to 200. */
router.add('GET /api/ext/reviews', (ctx) => {
  const sp = new URL(ctx.req.url, 'http://x').searchParams;
  sendOk(ctx.res, { ...Reviews.webList({ limit: sp.get('limit') }), generatedAt: new Date().toISOString() });
});

router.add('GET /api/ext/products', (ctx) => {
  const products = Cat.webList();
  sendOk(ctx.res, { products, count: products.length, rate: Cat.webRate(), generatedAt: new Date().toISOString() });
});

router.add('GET /api/ext/products/:id', (ctx) => {
  const p = Cat.webById(Number(ctx.params.id));
  if (!p) return sendError(ctx.res, 404, 'not_found', 'No such product.');
  sendOk(ctx.res, { product: p });
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
/* THE DESIGN PICTURE. Same shape as POST /api/products/:id/image and for the
   same reasons: the browser shrinks the photograph before it is sent, the
   bytes go to a public bucket, the row holds the address, and a replace writes
   a NEW path because the CDN goes on answering for a deleted one.

   The shop attaches it — it is the shop taking the order — so print.write,
   not the partner gate. Yalla Wear SEE it, in the payload and in the picture
   their bot now sends with a new order. */
router.add('POST /api/print-jobs/:id/image', requirePerm('print.write', async (ctx) => {
  const id = String(ctx.params.id);
  const b = await readJson(ctx.req);
  try {
    if (b && b.clear) {
      const r = Partner.setDesignImage(id, null, ctx.user.id);
      if (r.previous) Storage.removeObject(Storage.pathOfUrl(r.previous)).catch(() => {});
      bump();
      return sendOk(ctx.res, { imageUrl: null, job: r.job });
    }
    if (!SB.isConfigured()) {
      return sendError(ctx.res, 503, 'not_configured',
        'Pictures need Supabase, which is not set up on this server.');
    }
    const pic = Storage.decodeDataUrl(b && b.dataUrl);
    const url = await Storage.putObject(Storage.pathForJob(id, pic.ext), pic.bytes, pic.type);
    const r = Partner.setDesignImage(id, url, ctx.user.id);
    if (r.previous && r.previous !== url) Storage.removeObject(Storage.pathOfUrl(r.previous)).catch(() => {});
    /* So the portal on the other side sees it without a refresh. */
    bump();
    sendOk(ctx.res, { imageUrl: url, job: r.job });
  } catch (e) {
    if (e.code === 'not_found') return sendError(ctx.res, 404, 'not_found', e.message);
    if (e.code === 'bad_image' || e.code === 'too_large') return sendError(ctx.res, 400, e.code, e.message);
    sendError(ctx.res, 503, 'storage_failed', e.message);
  }
}));

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
      /* Which of the shop's places the money came out of (053). Read only
         for the shop's side; Yalla Wear's record moves nothing here. */
      place: side(ctx) === 'og' && typeof b.place === 'string' && b.place ? b.place : null,
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
    const b = await readJson(ctx.req);
    try {
      const invoice = Partner.confirmPayment({
        invoiceId: ctx.params.id, paymentId: ctx.params.pid, side: side(ctx),
        place: side(ctx) === 'og' && typeof b.place === 'string' && b.place ? b.place : null,
        userId: ctx.user.id
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

/* LINKING YOUR OWN PHONE IS ACCOUNT SELF-SERVICE, like changing your own
   password: no permission, any signed-in account, scoped to the caller. What
   makes it safe is not this gate — it is that a linked chat answers a command
   only as far as the account behind it may (see telegram-commands.js). Before
   that, Connect would have been a way past requirePerm to the day's takings.

   Managing OTHER people's chats stays on config.write throughout. */
const tgManages = (ctx) => Auth.can(ctx.user, 'config.write');
const tgMine = (ctx, chat) => Number(chat.person) === Number(ctx.user.id) ||
                              Number(chat.userId) === Number(ctx.user.id);

router.add('GET /api/telegram/status', (ctx) => {
  const s = Telegram.status();
  const mine = tgSide(ctx);
  const half = s[mine] || {};
  /* ONLY YOUR OWN ROW unless you run the shop. A cashier looking at this card
     has one question — is my phone connected — and no business reading the
     titles of the owner's groups or who added them. */
  const all = half.chats || [];
  const chats = tgManages(ctx) ? all : all.filter((c) => tgMine(ctx, c));
  sendOk(ctx.res, { side: mine, ...half, chats,
                    linked: chats.length > 0,
                    chatTitle: (chats[0] || {}).title || null,
                    manages: tgManages(ctx),
                    meId: ctx.user.id,
                    running: s.running,
                    /* The kinds a chat can be subscribed to, and how they group.
                       Forwarded explicitly: this route answers with ONE side's
                       object, and these live above it — leaving them out is what
                       drew a picker with no boxes in it. */
                    /* THE OFFICE GROUP IS THE SHOP'S OWN, and Yalla Wear's card
                       must not offer it: they are a different company, their
                       chats are on the other side, and an order alert is never
                       queued for that audience. Drawing nine boxes that can
                       never do anything would be a picker that lies — and it
                       would hand another company the list of what the shop's
                       delivery office says to itself. */
                    groups: mine === 'og' ? s.groups
                      : Object.fromEntries(Object.entries(s.groups).filter(([g]) => g !== 'office')),
                    allKinds: mine === 'og' ? s.allKinds
                      : s.allKinds.filter((k) => !Office.OFFICE_KINDS.includes(k)),
                    defaultRules: s.defaultRules,
                    kindPerm: s.kindPerm, presets: s.presets,
                    /* The office's order alerts, for the grid that decides who
                       hears them: the kinds, which go out at any hour, the
                       shop's hours, and which roles may work the desk at all
                       (a role that cannot hears none, whatever is ticked). */
                    office: mine === 'og' && tgManages(ctx) ? (() => {
                      const c = Office.readClock();
                      const rolePerms = {};
                      for (const r of ['owner', 'developer', 'manager', 'cashier', 'warehouse', 'delivery']) {
                        rolePerms[r] = Auth.permissionsFor(r).includes('delivery.desk');
                      }
                      return { kinds: Office.OFFICE_KINDS, urgent: c.urgent,
                               quietFrom: c.from, quietTo: c.to, tz: c.tz, rolePerms };
                    })() : undefined,
                    /* The manager may also see whether the partner's line is up. */
                    other: mine === 'og' && tgManages(ctx)
                      ? { linked: s.yalla.linked, configured: s.yalla.configured } : undefined });
});

router.add('POST /api/telegram/link', (ctx) => {
  /* Who pressed Connect rides with the code, so the chat it links carries the
     name of the person who added it — and, for a private chat, belongs to
     them. The code is minted per account, so two people linking at once do
     not end up sharing one. */
  try {
    sendOk(ctx.res, Telegram.linkCode(tgSide(ctx),
      ctx.user.name || ctx.user.username || null, ctx.user.id));
  } catch (e) { partnerFail(ctx.res, e); }
});

/* WHAT ONE CHAT IS SENT. Every message used to go to every linked chat, which
   was right when a side had one phone on it. Now each carries its own list of
   kinds: the warehouse phone hears about stock, the owner's hears the day's
   takings, and nobody has to read past four notifications to find theirs.

   `rules: null` means everything — what every chat linked before this was,
   so nothing already working changed. An empty array means nothing, which is
   a real and different answer.

   WHO MAY WRITE IT is narrower than who may link a phone. A cashier connecting
   her own phone must not be able to tick the day's takings onto it — that
   would be the escalation the split gate exists to avoid — so choosing what a
   chat receives stays with whoever runs the shop, and everybody else's phone
   follows their role's preset.

   `rules: undefined` (the key absent) means "go back to the role's default";
   null means everything; an array means exactly that. */
router.add('PUT /api/telegram/chat', requirePerm(tgGate, async (ctx) => {
  const b = await readJson(ctx.req);
  if (!b || !b.chatId) return sendError(ctx.res, 400, 'invalid', 'Which chat?');
  const rules = b.preset === 'role'
    ? undefined
    : (b.rules === null || b.rules === undefined
        ? null
        : (Array.isArray(b.rules) ? b.rules.map(String) : []));
  try { sendOk(ctx.res, Telegram.setChatRules(tgSide(ctx), b.chatId, rules)); }
  catch (e) { partnerFail(ctx.res, e); }
}));

/* `chatId` in the body disconnects that one chat; without it, all of them —
   and THAT form is the manager's alone, because "stop sending anywhere" is
   not something one person should be able to do to everybody else's phone. */
router.add('POST /api/telegram/unlink', async (ctx) => {
  const b = await readJson(ctx.req);
  const side = tgSide(ctx);
  if (!b || !b.chatId) {
    if (!Auth.can(ctx.user, 'config.write')) {
      return sendError(ctx.res, 403, 'forbidden', 'Only a manager can disconnect every chat.');
    }
    try { return sendOk(ctx.res, Telegram.unlink(side)); }
    catch (e) { return partnerFail(ctx.res, e); }
  }
  const chat = (Telegram.status()[side].chats || [])
    .find((c) => String(c.id) === String(b.chatId));
  /* Somebody else's chat answers "not linked", not "forbidden" — the same rule
     the deliveries follow: a person must not learn that a chat exists by being
     told they may not touch it. */
  if (!chat || (!tgManages(ctx) && !tgMine(ctx, chat))) {
    return sendError(ctx.res, 404, 'not_found', 'That chat is not linked.');
  }
  try { sendOk(ctx.res, Telegram.unlink(side, b.chatId)); }
  catch (e) { partnerFail(ctx.res, e); }
});

/* Test ONE chat. It used to message every chat on the side, which was right
   while only a manager could press it and wrong the moment anybody can: a
   cashier checking her own phone would buzz the owner and every staff group. */
router.add('POST /api/telegram/test', async (ctx) => {
  const b = await readJson(ctx.req).catch(() => null);
  const side = tgSide(ctx);
  const all = Telegram.status()[side].chats || [];
  const mine = all.filter((c) => tgMine(ctx, c));
  const wanted = b && b.chatId
    ? all.find((c) => String(c.id) === String(b.chatId))
    : (mine[0] || (tgManages(ctx) ? all[0] : null));
  if (!wanted || (!tgManages(ctx) && !tgMine(ctx, wanted))) {
    return sendError(ctx.res, 404, 'not_found', 'That chat is not linked.');
  }
  try { sendOk(ctx.res, await Telegram.sendTest(side, wanted.id)); }
  catch (e) { partnerFail(ctx.res, e); }
});

/* ---- the reminders -------------------------------------------------------
   Status and the preview are the manager's. `preview` is the important one:
   it evaluates every rule and returns what WOULD be queued, rendered, without
   writing a row — the only honest way to look at a nine-o'clock digest at two
   in the afternoon, and the only way to try this on a real shop without a
   phone buzzing. `at` moves the clock for exactly that. */
router.add('GET /api/reminders/status', requirePerm('config.write', (ctx) => {
  sendOk(ctx.res, { status: Reminders.status() });
}));

router.add('POST /api/reminders/preview', requirePerm('config.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, Reminders.runNow({ at: (b && b.at) || null, dry: true })); }
  catch (e) { partnerFail(ctx.res, e); }
}));

router.add('POST /api/reminders/run', requirePerm('config.write', (ctx) => {
  try { sendOk(ctx.res, Reminders.runNow({})); }
  catch (e) { partnerFail(ctx.res, e); }
}));

/* Yalla Wear turning their own bot up or down.

   A ROUTE OF ITS OWN because the allow-list is narrower than the permission.
   They hold partner.jobs, not config.write, and PUT /api/config would be the
   whole config table; here the key must be one of their own five switches —
   never an hour, never reminders.enabled, and never yalla_paused, which is
   OG's override on them and would be no override at all if the paused side
   could unpause itself.

   The switch itself stays ONE KEY WITH TWO WRITERS rather than two keys that
   could disagree: OG's manager writes the same reminders.yl_* through
   PUT /api/config, and the pause is ANDed with it in the scheduler. */
const YL_SWITCH = /^reminders\.yl_[a-z_]+$/;
router.add('PUT /api/reminders/config', requirePerm(['config.write', 'partner.jobs'], async (ctx) => {
  const b = await readJson(ctx.req);
  const updates = b && b.updates && typeof b.updates === 'object' ? b.updates : {};
  const keys = Object.keys(updates);
  if (!keys.length) return sendError(ctx.res, 400, 'invalid', 'Nothing to save.');

  /* The audience is the account's role, never the body's — the same rule the
     Telegram routes are built on. */
  const partner = ctx.user.role === 'partner';
  for (const k of keys) {
    const ok = partner ? YL_SWITCH.test(k) : CONFIG_WRITABLE.test(k) && k.startsWith('reminders.');
    if (!ok) return sendError(ctx.res, 400, 'invalid', `${k} cannot be changed here.`);
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
  sendOk(ctx.res, { config, status: Reminders.status() });
}));

/* 055: the editors. What the ledger keeps (outstanding, what was bought,
   when it was last paid) and the derived pay date are not writable here. */
router.add('POST /api/suppliers', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { supplier: Payables.saveSupplier(b, ctx.user.id) }); }
  catch (e) { payFail(ctx.res, e); }
}));

router.add('POST /api/employees', requirePerm('staff.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, { employee: Payables.saveEmployee(b, ctx.user.id) }); }
  catch (e) { payFail(ctx.res, e); }
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
    const delivery = Deliveries.update(Number(ctx.params.id), {
      status: b.status,
      collected: b.collected,
      reason: b.reason,
      driverId: b.driverId === undefined ? undefined : (b.driverId ? Number(b.driverId) : null),
      /* Handing it to a transport office, a courier or a shipment abroad. */
      companyId: b.companyId === undefined ? undefined
        : (typeof b.companyId === 'string' && b.companyId ? b.companyId : null),
      trackingNo: b.trackingNo === undefined ? undefined : String(b.trackingNo || ''),
      /* "The cash is in my hand" — honoured only for somebody marking a
         driver's run; lib/deliveries.js ignores it from the driver. */
      handedIn: b.handedIn === true,
      address: b.address,
      phone: b.phone
    }, ctx.user);
    /* The board is a screen two people watch at once. */
    Live.notify('og', { deliveries: true });
    /* And the customer's page is a third, with a phone in a pocket behind it. */
    Tracking.moved(Tracking.saleOfDelivery(ctx.params.id), ctx.user.id);
    sendOk(ctx.res, { delivery });
  } catch (e) {
    /* The office's map: a parcel that cannot leave yet is a 409 carrying what
       is still owed, not a bare 400. */
    orderFail(ctx.res, e);
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

/* The one list the browser's template chips are drawn from — the same rows
   the renderer reads and the mirror carries, not the config blob that used
   to stand in for them. See Labels.templateSummaries. */
router.add('GET /api/labels/templates', requirePerm('label.print', (ctx) => {
  sendOk(ctx.res, { templates: Labels.templateSummaries() });
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

/* THE RECEIPT AGENT'S THREE DOORS (lib/receipt-queue.js, migration 064) —
   the label agent's shape, for receipts queued when receipt.transport is
   'agent'. Gated on sale.reprint, the till's own printing permission: a
   receipt carries the sale and the customer's name, which is more than a
   label does. The long-poll, like /api/labels/next, is for the agent only. */
router.add('GET /api/receipts/next', requirePerm('sale.reprint', async (ctx) => {
  const station = ctx.url.searchParams.get('station');
  if (!station) return sendError(ctx.res, 400, 'invalid', 'station is required');
  sendOk(ctx.res, { job: await ReceiptQueue.next({ station }) });
}));

router.add('POST /api/receipts/:id/done', requirePerm('sale.reprint', async (ctx) => {
  const b = await readJson(ctx.req);
  sendOk(ctx.res, ReceiptQueue.complete(Number(ctx.params.id), String(b.claimToken || ''), 'done', null));
}));

router.add('POST /api/receipts/:id/failed', requirePerm('sale.reprint', async (ctx) => {
  const b = await readJson(ctx.req);
  sendOk(ctx.res, ReceiptQueue.complete(Number(ctx.params.id), String(b.claimToken || ''), 'failed',
    String(b.error || 'unknown error').slice(0, 500)));
}));

router.add('GET /api/receipts/:id', requirePerm('sale.reprint', (ctx) => {
  const j = ReceiptQueue.jobState(Number(ctx.params.id));
  if (!j) return sendError(ctx.res, 404, 'not_found', 'No such print job.');
  sendOk(ctx.res, { job: j, agent: ReceiptQueue.agent() });
}));

router.add('POST /api/labels/:id/done', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, Labels.complete(Number(ctx.params.id), String(b.claimToken || ''), 'done', null)); }
  catch (e) { sendError(ctx.res, e.status || 409, e.code || 'not_claimed', e.message); }
}));

router.add('POST /api/labels/:id/failed', requirePerm('label.print', async (ctx) => {
  const b = await readJson(ctx.req);
  try { sendOk(ctx.res, Labels.complete(Number(ctx.params.id), String(b.claimToken || ''), 'failed', String(b.error || 'unknown error').slice(0, 500))); }
  catch (e) { sendError(ctx.res, e.status || 409, e.code || 'not_claimed', e.message); }
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
  /* 051's refusals were never added here, so on a real server every one of
     them came back as a bare 400 'invalid' with only the English sentence —
     the aisle and the neighbour's name never reached the Arabic screen. The
     harness stubbed the answer and could not see it. */
  rack_overlap:      409,
  aisle_narrow:      409,
  outside_room:      409,
  free_unmeasured:   409,
  /* Stage C: a level through the ceiling, and a ceiling lowered onto racks */
  rack_too_tall:     409,
  room_too_low:      409,
  no_letters_left:   409,
  duplicate_key:     409,
  duplicate_code:    409,
  confirm_required:  409,
  /* Malformed: the request could not have worked whatever the shop looked like. */
  bad_request:       400,
  bad_key:           400,
  bad_wall:          400,
  bad_placement:     400,
  bad_rotation:      400,
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

/* Who is on the other end: lib/proxy.js. A forwarded address is believed only
   from OG_PROXY_ADDR's own socket (night shift 04) — OG_TRUST_PROXY believed
   the first X-Forwarded-For entry from anybody. */
const clientIp = Fwd.clientIp;

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

        /* The copy door: the other server, over the private road, with the
           key. A visitor the public proxy carried is told there is no such
           thing — the same 404 an unknown path gets. */
        if (path.startsWith('/api/copy/')) {
          if (Fwd.forwardedVisitor(req) || Standby.isStandby()) {
            return sendError(res, 404, 'not_found', 'No such endpoint.');
          }
          const k = Standby.copyKeyCheck(req);
          if (k === 'not_configured') return sendError(res, 503, 'not_configured', 'OG_COPY_KEY is not set on this server.');
          if (k !== 'ok') return sendError(res, 401, 'bad_key', 'The copy key is missing or wrong.');
          return await hit.handler({ req, res, url, params: hit.params, user: null, token: null });
        }

        /* A STANDBY IS READ-ONLY. Refused here, before any handler, so no
           route — today's or one added next year — can write to a copy that
           the next swap throws away. */
        /* …EXCEPT WHILE THE MAIN SERVER IS SILENT. Then the till's own writes
           (lib/outbox.js KINDS, wave 1) are taken here and kept for the
           replay; anything else says it needs the internet, in words. */
        let offline = null;
        if (Standby.isStandby() && req.method !== 'GET' && req.method !== 'HEAD' && !STANDBY_OK.has(key)) {
          offline = Standby.takesWrites() ? Outbox.kindOf(req.method, path) : null;
          if (!offline) {
            return sendError(res, 503, Standby.takesWrites() ? 'needs_internet' : 'standby_read_only',
              Standby.readOnlyMessage());
          }
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

        if (offline) return await offlineWrite(offline, { req, res, url, hit, user, token });
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
      /* --- the tracking page's live parts ---------------------------------
         Four doors under the same token and nothing else: the page's own
         service worker (scoped to /i/ so it can never touch the app), a
         data-less "your order moved" stream, the manifest that lets an iPhone
         keep the page on its home screen (Apple's only way to allow a push),
         and follow / unfollow / "am I following". Every one resolves the sale
         from the token alone, and only an ORDER has any of them — a till
         receipt has nothing that moves. lib/tracking.js says why. */
      if (path === '/i/sw.js' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Service-Worker-Allowed': '/i/',
          'X-Content-Type-Options': 'nosniff'
        });
        return res.end(req.method === 'HEAD' ? undefined : Tracking.WORKER);
      }
      const part = /^\/i\/([0-9a-f]{32})\/(live|push|review|manifest\.webmanifest)$/.exec(path);
      /* A customer's review or Notify me, sent to a STANDBY, would land in a
         copy the next swap throws away: it belongs to the main server. */
      if (part && Standby.isStandby() && req.method === 'POST') {
        return sendError(res, 503, 'standby_read_only', Standby.readOnlyMessage());
      }
      if (part) {
        const sale = Receipt.byToken(part[1]);
        if (!sale || !sale.order) return sendError(res, 404, 'not_found', 'Not found.');
        if (part[2] === 'live' && req.method === 'GET') {
          if (!Live.subscribeTrack(res, sale.id)) {
            return sendError(res, 429, 'busy', 'Too many pages are open on this order.');
          }
          return;
        }
        if (part[2] === 'manifest.webmanifest' && req.method === 'GET') {
          const body = JSON.stringify(Tracking.manifest(sale, part[1], url.searchParams.get('lang')));
          res.writeHead(200, {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff'
          });
          return res.end(body);
        }
        if (part[2] === 'push' && req.method === 'POST') {
          if (!originAllowed(req, ORIGINS)) return sendError(res, 403, 'bad_origin', 'Request rejected.');
          const b = await readJson(req);
          try {
            const out = b.action === 'follow' ? Tracking.followOrder(sale, b)
              : b.action === 'unfollow' ? Tracking.unfollowOrder(sale, b)
              : Tracking.followingOrder(sale, b);
            return sendOk(res, out);
          } catch (e) {
            return sendError(res, e.status || 400, e.code || 'invalid', e.message);
          }
        }
        /* The customer's review of a delivery that arrived (lib/reviews.js).
           The sale is the token's; one review per order, editable by whoever
           holds the link — the same person the link was sent to. */
        if (part[2] === 'review' && req.method === 'POST') {
          if (!originAllowed(req, ORIGINS)) return sendError(res, 403, 'bad_origin', 'Request rejected.');
          const b = await readJson(req);
          try {
            const out = Reviews.submit(sale, b);
            Live.notify('og', { reviews: true });
            Tracking.reviewed(sale, out);
            return sendOk(res, { review: out.review, first: out.first });
          } catch (e) {
            return sendError(res, e.status || 400, e.code || 'invalid', e.message);
          }
        }
        return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
      }

      if (path.startsWith('/i/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const inv = /^\/i\/([0-9a-f]{32})$/.exec(path);
        const sale = inv ? Receipt.byToken(inv[1]) : null;
        /* Arabic unless ?lang=en asks otherwise — the shop's own language,
           and the language of the WhatsApp message that hands out the link.
           The switch is a plain link on the page: it carries no JavaScript
           by design, and `dir`/`lang` belong on <html>, where no CSS toggle
           can put them. */
        const body = sale
          ? Receipt.render(sale, url.searchParams.get('lang'), {
              /* Only an order that can still move offers "Notify me". A key
                 that cannot be read (a half-migrated database) just leaves the
                 button off; the page itself must never fail over it. */
              vapidKey: sale.order && !sale.voided ? (() => { try { return Push.publicKey(); } catch { return null; } })() : null
            })
          : Receipt.notFound(url.searchParams.get('lang'));
        res.writeHead(sale ? 200 : 404, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          /* The one page a stranger opens. Same policy as the app (lib/http.js):
             its script and its styles are inline, its live line and its push
             subscription go to this origin and nowhere else. */
          'Content-Security-Policy': CSP,
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
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
        /* the body reader names its own refusals (too_large, bad_json) so the
           app can say them in the person's language */
        sendError(res, status, status >= 500 ? 'server_error' : (err.code && /^[a-z_]+$/.test(err.code) ? err.code : 'bad_request'),
          status >= 500 ? 'Something went wrong on the server.' : err.message,
          status === 413 ? { Connection: 'close' } : {});
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

  /* ALREADY SECURE, ARRIVING THROUGH A PROXY. A reverse proxy that terminates
     TLS itself and forwards to plain http on this port has carried the
     request over HTTPS for its whole public life, and redirecting it to
     <public host>:8443 sends the visitor to a port the proxy does not carry.
     The proxy's header is believed only from the proxy's own socket
     (OG_PROXY_ADDR, lib/proxy.js) — never from whoever sends it. The proxy
     in deploy/shop-proxy/ talks https to :8443 and never lands here; this is
     for the fallback routes (the SSH reverse tunnel) that forward to http. */
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (Fwd.viaProxy(req) && fwd === 'https') return handle(req, res);

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

  /* ONE SHOP LAPTOP (audit 06). Nothing is pulled from the cloud at boot any
     more: a server that starts, starts on its own database, always. The
     mirror is pushed to by the one machine that owns it (lib/lineage.js) and
     read back only by the deliberate disaster restore
     (npm run supabase:restore -- --wipe; the panel's Restore job), which
     runs with the shop closed. OG_PULL_AT_BOOT is no longer read. */

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
    /* ONE LIST, TWO READERS.
       -----------------------------------------------------------------
       Everything from here down is a STANDING CONDITION — something true
       about this shop right now that nothing else would ever mention. They
       were eight separate blocks of console.log, which meant the only way to
       learn any of them was to read a terminal, in English, while it scrolled.
       The launcher now draws them as cards a shopkeeper can act on, and it
       draws them in Arabic, so they have to arrive as DATA.

       So each one is collected once, carrying both its code and the exact
       lines it has always printed, and then read twice: the loop below prints
       them in the same order and the same words as before, and the panel gets
       {code, level, args} with the sentences left off — the launcher writes
       its own, from its own dictionary, which is how the same notice can read
       correctly in two languages.

       Two copies of a fact drift; mirror-lag.js is the file in this repo that
       exists because of it. Hence one list. Adding a notice means one entry
       here and two strings in panel/ui/i18n.js — never a ninth console.log. */
    const notices = [];
    const note = (code, level, args, lines) => notices.push({ code, level, args, lines });

    /* The banner already shouts on a secure server; kept exactly as it was so
       the printed text does not move. */
    const WARN = SECURE ? '*** WARNING ***  ' : '';

    if (n === 0) note('no_accounts', 'warn', {}, [
      '',
      '    No accounts yet. Create the first manager with:',
      '      npm run createuser'
    ]);

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

    if (demo.length) note('retired_account', 'warn', { users: demo }, [
      '',
      `    ${WARN}A RETIRED TEST ACCOUNT IS ACTIVE AGAIN: ${demo.join(', ')}`,
      '    Its old password is in this repository' + "'" + 's history.',
      '    Give it a new one, or set active = 0 in Settings.'
    ]);

    /* Same reasoning, and the more expensive one to miss: a seeded price is a
       price a cashier can charge a real customer. Counted rather than assumed,
       so the line disappears the moment the rows actually go. */
    const seeded = DB.get().prepare(
      `SELECT (SELECT COUNT(*) FROM products  WHERE demo = 1 AND hidden = 0) AS p,
              (SELECT COUNT(*) FROM customers WHERE demo = 1 AND archived = 0) AS c`
    ).get();

    if (seeded.p || seeded.c) note('demo_catalogue', 'warn', { products: seeded.p, customers: seeded.c }, [
      '',
      `    ${WARN}DEMO CATALOGUE IS LOADED: ` +
        `${seeded.p} product(s), ${seeded.c} customer(s).`,
      '    Invented goods at invented prices — the till will sell them.',
      '    Hide or delete them in Products before the shop opens.'
    ]);

    if (!SECURE) note('cookies_insecure', 'info', {}, [
      '',
      '    OG_SECURE is not set — cookies are being sent without',
      '    the Secure flag. Fine locally, wrong behind HTTPS.'
    ]);

    /* The CSRF check passes everything when the list is empty — see
       originAllowed() in lib/http.js. That is deliberate for a shop network
       nobody else is on, but it is exactly the setting people forget on the
       day they first reach the till from outside, which is also the day it
       starts to matter. Say so while the address is still on screen. */
    /* The certificate: is it still valid, and does it still name the
       address this machine answers on? An IP that moved is a browser that
       refuses to connect at all, which reads as "the system is down". */
    if (SECURE_SERVER) {
      /* Every address somebody may type (night shift 04): the cards net.js
         reports, every https IP origin OG_ORIGINS lists (the phones' address
         — 10.10.99.9 was missing and nothing said so, because the check read
         net.js alone), and the tunnel's own end, which the VPS proxy pins. */
      const wanted = new Set(lanAddresses().filter((x) => !x.note).map((x) => x.address));
      for (const o of ORIGINS) {
        try { const u = new URL(o); if (u.protocol === 'https:' && isIP(u.hostname)) wanted.add(u.hostname); } catch { /* not a URL */ }
      }
      if (Fwd.tunnelAddr()) wanted.add(Fwd.tunnelAddr());
      /* and every IP OG_CERT_EXTRA_SANS promised the certificate would carry */
      for (const ip of extraSans().ip) wanted.add(ip);
      wanted.delete('127.0.0.1');
      const missing = TLS.uncovered([...wanted]);
      const left = TLS.daysLeft();
      if (missing.length) note('cert_address', 'warn', { addresses: missing }, [
        '',
        `    THIS MACHINE'S ADDRESS HAS CHANGED: ${missing.join(', ')}`,
        '    The certificate does not name it, so other devices cannot',
        '    open it. Run:  npm run cert   and restart.'
      ]);
      if (left !== null && left < 30) note('cert_expiring', 'warn', { days: left }, [
        '',
        `    The certificate expires in ${left} days — npm run cert`
      ]);
    } else if (!HTTPS_OFF) note('no_cert', 'info', {}, [
      '',
      '    No certificate, so this is plain HTTP. Other devices then',
      '    get no notifications, no camera scanner and cannot install',
      '    the app — browsers only allow those over HTTPS. Run:',
      '      npm run cert'
    ]);

    if (!ORIGINS.length) note('no_origins', 'info', {}, [
      '',
      '    OG_ORIGINS is not set — any site your browser visits can',
      '    send writes here while you are logged in. Fine on a shop',
      '    network you control. Set it before reaching this from',
      '    outside the shop, e.g.',
      '      OG_ORIGINS=http://og-shop:8090'
    ]);

    /* Night shift 04: OG_TRUST_PROXY believed the first X-Forwarded-For
       entry from ANY connection. It is read by nothing now; a laptop that
       still has it set is told what replaced it, so nobody goes looking for
       why "trusting the proxy" stopped doing anything. */
    /* A STANDBY says so first, in the words that matter: whose copy, and that
       it takes no writes (lib/standby.js). */
    if (Standby.isStandby()) note('standby', 'info', { upstream: process.env.OG_UPSTREAM || '' }, [
      '',
      '    STANDBY: a read-only copy of ' + (process.env.OG_UPSTREAM || '(OG_UPSTREAM is not set)') + ',',
      '    refreshed every ' + (Number(process.env.OG_STANDBY_MINUTES) || 5) + ' minutes. Writes are refused, and the',
      '    workers (Telegram, reminders, the cloud mirror, backups) stay with the main server.'
    ]);
    if (Standby.isStandby() && !process.env.OG_COPY_KEY) note('standby_no_key', 'warn', {}, [
      '',
      '    OG_COPY_KEY is not set, so this standby cannot fetch a copy.'
    ]);

    if (process.env.OG_TRUST_PROXY) note('trust_proxy_retired', 'info', {}, [
      '',
      '    OG_TRUST_PROXY is set and is IGNORED. A forwarded address is now',
      '    believed only from the proxy itself: set OG_PROXY_ADDR to the',
      '    VPS\'s tunnel address and delete the OG_TRUST_PROXY line.'
    ]);

    /* THE PUBLIC NAME. With a proxy configured, browsers arrive at the till
       carrying Origin: https://<public name>, and a list without it refuses
       every write they make ("Request rejected") while reads work — which
       looks like a broken shop, not a missing setting. */
    if (Fwd.proxyAddr()) {
      const publicNames = ORIGINS.filter((o) => {
        try {
          const u = new URL(o);
          return u.protocol === 'https:' && !isIP(u.hostname) && u.hostname.includes('.') &&
            !u.hostname.endsWith('.local');
        } catch { return false; }
      });
      if (!publicNames.length) note('proxy_no_origin', 'warn', { proxy: Fwd.proxyAddr() }, [
        '',
        `    OG_PROXY_ADDR is set (${Fwd.proxyAddr()}) but OG_ORIGINS names no public`,
        '    address, so every write from outside is refused. Add, e.g.',
        '      OG_ORIGINS=https://shop.ogsports1.com,…'
      ]);
    }

    /* Reader one: the terminal, in the order and the words it has always
       used. Reader two is the ready line further down. */
    for (const nt of notices) for (const line of nt.lines) console.log(line);

    /* Started here rather than at import, so the mirror can only ever begin
       once the till is actually listening. It pushes a couple of seconds
       after every commit and prints one line per push — see
       lib/sync-worker.js for why a failed mirror must never disturb a sale. */
    console.log('');
    /* A STANDBY RUNS NONE OF THE WORKERS. Each of them — the mirror, the
       bots, the reminders, the backups, the push key — belongs to exactly one
       server, and two of any one of them is everything twice or nothing at
       all (the mirror's lineage guard exists because it happened). It runs
       only its own loop: fetch, check, swap. */
    if (Standby.isStandby()) {
      /* Its own https Wi-Fi addresses, told to the main server with every
         copy fetch, so the domain's page can offer them when the line drops. */
      Standby.start(console.log, {
        localUrls: () => {
          const scheme = SECURE_SERVER ? 'https' : 'http';
          const port = SECURE_SERVER ? HTTPS_PORT : PORT;
          return lanAddresses().filter((n) => !n.note).map((n) => `${scheme}://${n.address}:${port}`);
        }
      });
    } else {
      SyncWorker.start();

      /* The Telegram line, same shape: drains the partner_events outbox on a
         timer and long-polls each bot for a link code. Off with no token. */
      Telegram.start();

      /* And the other half of it: the standing conditions nothing else would
         ever mention, queued into the same outbox on a one-minute tick. After
         Telegram.start() because it queues into what that drains, and inside
         this callback for the reason SyncWorker is — nothing may begin before
         the till is answering. */
      Reminders.start();
      /* A verified copy every day the shop is open, without anybody pressing
         anything (audit 06) — lib/backup-schedule.js says why. */
      BackupSchedule.start();
      /* The dollar rate from the live feed, on a timer — one main server, or
         two would write the same row twice. Off without OG_FX_KEY. */
      FxFeed.start(console.log);
      /* Who a push service writes to when something is wrong with our pushes:
         the shop's own https address when it has one. */
      try { Push.setContact(Orders.publicBase()); } catch { /* the default stands */ }
      /* og-track's page subscribes browsers with this laptop's public key, which
         it reads from the mirror's config. Published at every boot, and only
         when it differs: after a disaster restore the config that came back
         carries the DEAD laptop's key, and this replaces it with this machine's
         own before anything mirrors it. */
      try {
        if (Push.publishKey()) console.log('  Web Push: public key published to config push.public_key');
      } catch (e) {
        console.log(`  Web Push: could not publish the public key — ${e.message}`);
      }
    }

    /* The panel is watching a pipe, not this window. Everything it needs to
       stop saying "starting…" and start drawing the shop: the addresses to
       make clickable, whether the padlock is real, and how many people can
       actually sign in. Same numbers as the banner above, so the panel can
       never disagree with the window. */
    PanelLink.tell('ready', {
      http: `http://localhost:${PORT}`,
      https: SECURE_SERVER ? `https://localhost:${HTTPS_PORT}` : null,
      lan: lanAddresses().filter((a) => !a.note)
        .map((a) => (SECURE_SERVER ? `https://${a.address}:${HTTPS_PORT}` : `http://${a.address}:${PORT}`)),
      secure: !!SECURE_SERVER,
      accounts: n,
      shop: (() => {
        try {
          const r = DB.get().prepare("SELECT value FROM config WHERE key = 'shop.name'").get();
          return r ? r.value : null;
        } catch (e) { return null; }
      })(),
      db: DB_FILE,
      pid: process.pid,
      /* The sentences are left behind on purpose. The panel writes its own,
         in the language the person reading it chose; shipping the English
         here as well would be the same fact in two places, which is the
         thing the list above exists to avoid. */
      notices: notices.map((nt) => ({ code: nt.code, level: nt.level, args: nt.args }))
    });

    console.log('');
  });

  /* One shutdown, three ways in: Ctrl-C in a terminal, a SIGTERM from
     whatever supervises this, and the panel's Stop button. Guarded because
     pressing Stop twice meant two server.close() callbacks racing DB.close(),
     and the second one closes a database the first already shut. */
  let stopping = false;
  function shutdown(why) {
    if (stopping) return;
    stopping = true;
    console.log(`\n  shutting down${why ? ' \u2014 ' + why : ''}`);
    PanelLink.tell('stopping');
    /* Stopped by name rather than left to unref(). None of these hold the
       process open, so this is not a hang fix: it is that the panel's Stop
       otherwise leaves a 25-second getUpdates long-poll and a live mirror push
       racing the five-second hard exit below — and a reminder queued DURING a
       shutdown is a message about a shop that is closing. */
    try { Reminders.stop(); } catch (e) { /* already down */ }
    try { BackupSchedule.stop(); } catch (e) { /* already down */ }
    try { Telegram.stop(); } catch (e) { /* already down */ }
    try { FxFeed.stop(); } catch (e) { /* already down */ }
    try { SyncWorker.stop(); } catch (e) { /* already down */ }
    try { Standby.stop(); } catch (e) { /* not a standby */ }
    if (SECURE_SERVER) { try { SECURE_SERVER.close(); } catch (e) { /* already down */ } }
    server.close(() => { DB.close(); process.exit(0); });
    /* If a connection refuses to drain, do not hang forever. The live SSE
       streams are exactly that: a response that never ends on its own. */
    setTimeout(() => process.exit(0), 5000).unref();
  }

  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));

  /* THE CONTROL PANEL. None of this exists unless the process was spawned
     with an IPC channel — lib/panel-link.js says why the conversation is a
     pipe and not another route. */
  PanelLink.onAsk((type, m) => {
    if (type === 'stop') { shutdown('the control panel'); return; }

    /* HARD REFRESH. The panel has already bumped the service worker's cache
       name; this is the half that reaches a browser ALREADY OPEN, instead of
       somebody being told to press Ctrl-Shift-R. It goes to the tabs on
       /api/live — the manager's and the developer's, deliberately not a
       cashier halfway through a sale. */
    if (type === 'reload') {
      Live.notify('all', { reload: true });
      console.log('  [panel] told the open tabs to reload');
      return;
    }

    /* FULL REFRESH, the moment before the shop closes: the open tabs cover
       themselves with "Updating…" rather than showing a failing page while
       it is down, and reload when they reach the fresh server (js/pulse.js). */
    if (type === 'refreshing') {
      Live.notify('all', { refreshing: true });
      console.log('  [panel] told the open tabs a full refresh is coming');
      return;
    }

    /* The panel's Sync now, without a session. The same run POST
       /api/sync/push makes; the worker's own lock stops the two overlapping. */
    if (type === 'sync') {
      SyncWorker.runNow('full')
        .then(() => console.log('  [panel] sync finished'))
        .catch((e) => console.log('  [panel] sync failed: ' + e.message));
      return;
    }

    /* WHO HAS THE SHOP OPEN. The panel asks this before it closes the till,
       because it supervises a PROCESS and has no idea whether anybody is
       standing at one — and stopping the server under a cashier's hands is a
       lost sale, not a restart.

       Live.presence() is what the topbar pill already reads, so this adds no
       query: the accounts holding /api/live open, deduplicated per person, so
       one person with a phone and a laptop counts once. It answers "Lubna has
       the shop open" and deliberately not "Lubna is mid-sale" — that is a
       thing this server does not know, and the panel's wording says only what
       is in this object. */
    /* THE DEVELOPER PANEL'S "NEW PASSWORD". The one way a password crosses
       out of this process is up this pipe, to the panel that started it —
       never over HTTP (lib/http.js refuses that). */
    if (type === 'resetpw') {
      People.newPassword(Number(m.id)).then((r) => {
        PanelLink.tell('secret', { reqId: m.reqId, id: Number(m.id), password: r.password });
      }, (e) => {
        PanelLink.tell('secret', { reqId: m.reqId, id: Number(m.id), error: e.code || 'failed' });
      });
      return;
    }

    if (type === 'who') {
      const p = Live.presence();
      PanelLink.tell('who', {
        who: { people: p.people.og, tabs: p.tabs.og, at: new Date().toISOString() }
      });
      return;
    }
  });
}
