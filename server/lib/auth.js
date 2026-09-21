/* ==========================================================================
   OG SYSTEM — accounts, sessions, permissions
   --------------------------------------------------------------------------
   This replaces js/gate.js, which was a passcode in a downloadable file and
   never pretended otherwise. The difference is that checking now happens on a
   server the browser cannot edit.

   Passwords use scrypt from node:crypto. Argon2id would be the textbook
   answer, but it means a native npm module compiled on the server, and scrypt
   is a memory-hard KDF designed for exactly this, is in the standard library,
   and removes a whole class of deployment failure. The parameters below are
   the cost, not the algorithm choice, and they are set well above the default.
   ========================================================================== */

import {
  scrypt, randomBytes, timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';
import { get, nowIso } from './db.js';
import * as Vault from './credvault.js';

const scryptAsync = promisify(scrypt);

/* N=2^15 with r=8 costs roughly 32 MB and ~100ms per hash on a small VPS.
   That is unnoticeable on a login and brutal for anyone working through a
   stolen database. Raising N later is safe: the parameters are stored beside
   each hash, so old passwords keep verifying. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

const SESSION_DAYS = 14;

/* A cashier standing at a till all day should not be logged out mid-queue, but
   a session left open on a shared machine overnight should die. Sliding
   expiry, refreshed on use. */
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/* Login throttling. Counted per username so someone hammering one account is
   stopped even when they rotate IP addresses. */
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

/* AND per address (night shift 04). Per username alone, one machine could
   try eight passwords on every account in the building, each within its
   limit. Twenty, not eight: a shared till is one address for every cashier,
   and a morning of typos must not lock the counter out. Only meaningful now
   that the address is the real one — lib/proxy.js. */
const MAX_FAILS_IP = 20;

/* 059 — owner and developer hold everything; the rest as before. */
export const ROLES = ['owner', 'developer', 'manager', 'cashier', 'warehouse', 'delivery', 'partner'];

/* --------------------------------------------------------------- permissions
   One table, read top to bottom, rather than `if (role === 'manager')` sprayed
   through the routes. Anything not listed is denied: a new endpoint is locked
   until someone deliberately opens it, which is the right default.

   The rule that matters commercially: a cashier must not see cost or profit.
   They handle customers and they handle cash, and margin is not theirs to
   know. `partner` is Yalla Wear — remote, outside the company, and must never
   reach a customer name, a phone number, or what OG charged for the job. */
/* Every permission the system knows about, in the order the Settings grid
   shows them. Grouped so the screen reads as a sentence about a job rather
   than an alphabetical dump. The label is what a shop owner sees — nobody
   should have to work out what `stock.count` means. */
export const ALL_PERMISSIONS = [
  { perm: 'sell',            group: 'till',      label: 'Sell at the till' },
  { perm: 'refund',          group: 'till',      label: 'Give a refund' },
  { perm: 'void',            group: 'till',      label: 'Cancel a completed sale' },
  { perm: 'sale.reprint',    group: 'till',      label: 'Reprint a past receipt' },

  { perm: 'stock.read',      group: 'stock',     label: 'See stock levels' },
  { perm: 'stock.move',      group: 'stock',     label: 'Receive and move stock' },
  { perm: 'stock.count',     group: 'stock',     label: 'Do a stock count' },
  { perm: 'label.print',     group: 'stock',     label: 'Print product labels' },

  { perm: 'product.read',    group: 'products',  label: 'See products' },
  { perm: 'product.write',   group: 'products',  label: 'Add and edit products' },

  { perm: 'customer.read',   group: 'customers', label: 'See customers' },
  { perm: 'customer.write',  group: 'customers', label: 'Add and edit customers' },

  { perm: 'delivery.read',   group: 'delivery',  label: 'See deliveries' },
  { perm: 'delivery.write',  group: 'delivery',  label: 'Send out and mark delivered' },
  /* The delivery office: a till for orders taken by phone, Instagram and
     WhatsApp. Not folded into delivery.write, which the cashier holds so she
     can tick "send this out" at the till — taking a remote order is a sale
     with a destination and a payment plan, and who does that is the
     manager's decision. */
  { perm: 'delivery.desk',   group: 'delivery',  label: 'Take remote orders at the delivery office' },
  /* 060 — the delivery team page: who is on the road, their errands, their pay. */
  { perm: 'safeer.read',     group: 'delivery',  label: 'See the delivery team (Safeers)' },
  { perm: 'safeer.write',    group: 'delivery',  label: 'Manage Safeers and their tasks' },

  { perm: 'cost.read',       group: 'money',     label: 'See what things cost' },
  { perm: 'profit.read',     group: 'money',     label: 'See profit' },
  { perm: 'money.read',      group: 'money',     label: 'See the money screen' },
  { perm: 'money.write',     group: 'money',     label: 'Record expenses and debts' },
  /* 053 — the cash book. Moving money between places, changing dollars, the
     owner taking money out or putting it in, and checking what a place
     really holds. Not money.write: an expense is a cost somebody paid, and
     this is where the shop's money is — who may say so is a separate call. */
  { perm: 'money.move',      group: 'money',     label: 'Move money between places, change dollars, record the owner taking or adding money' },
  /* 054 — the cashier counts the drawer at night; confirming the count and
     taking the cash is money.move. Counting shows her nothing of what the
     book expects, so it hands over no figure she could not already see. */
  { perm: 'money.count',     group: 'money',     label: 'Count the drawer at closing time' },
  /* Separate from money.read ON PURPOSE. A cashier takes a customer's cash
     when they settle up — the money is in HER drawer, during HER shift, and
     if she cannot record it her count comes up over with no explanation. That
     does not entitle her to the shop's money screen. */
  { perm: 'debt.collect',    group: 'money',     label: 'Take a payment against a debt' },
  { perm: 'discount.unlimited', group: 'money',  label: 'Discount past the limit' },

  { perm: 'print.read',      group: 'print',     label: 'See print jobs' },
  { perm: 'print.write',     group: 'print',     label: 'Create and change print jobs' },
  { perm: 'partner.read',    group: 'print',     label: 'See the partner portal' },
  { perm: 'partner.write',   group: 'print',     label: 'Act on partner orders' },

  { perm: 'staff.read',      group: 'admin',     label: 'See staff accounts' },
  { perm: 'staff.write',     group: 'admin',     label: 'Add and edit staff' },
  { perm: 'report.read',     group: 'admin',     label: 'See reports' },
  { perm: 'config.write',    group: 'admin',     label: 'Change settings' },
  /* 059 — open or close a permission for one person, and manage who can
     sign in. Pinned to the owner and the developer. */
  { perm: 'access.write',    group: 'admin',     label: 'Change what each person may do' },

  { perm: 'partner.jobs',    group: 'partner',   label: 'Yalla Wear: own jobs' },
  { perm: 'partner.respond', group: 'partner',   label: 'Yalla Wear: accept or decline' },
  { perm: 'partner.invoice', group: 'partner',   label: 'Yalla Wear: own invoices' }
];

const PERM_SET = new Set(ALL_PERMISSIONS.map(p => p.perm));

/* --------------------------------------------------- the two hard rules
   Both are enforced here rather than in the Settings screen, because a
   disabled tick box is a suggestion — anyone can send the request by hand. */

/* A manager who removes their own access to Settings or Staff leaves nobody
   able to put it back without opening the database file. */
/* 059: the owner and the developer — the manager is no longer pinned, so the
   owner can close Settings for him. */
const PIN_SET = ['config.write', 'staff.write', 'access.write'];
const PINNED = { owner: PIN_SET, developer: PIN_SET };

/* Yalla Wear is a different company. These can never be granted to them, no
   matter what the grid says. One mis-clicked box should not be able to hand a
   supplier your customer list and your margins.

   `delivery.*` is on the list for the same reason as `customer.*`, and it is
   easy to miss why: a delivery row carries a customer's name, phone number and
   home address. It is the most personal data in the system. */
const FORBIDDEN = {
  partner: (p) =>
    p === 'customer.read' || p === 'customer.write' ||
    p === 'cost.read' || p === 'profit.read' ||
    p.startsWith('money.') || p.startsWith('staff.') ||
    /* Named, not matched. debt.collect deliberately does NOT start with
       'money.' — see 033 — so the startsWith above sails straight past it,
       and a permission that lets somebody take the shop's cash must never be
       one a tick box can hand to another company. */
    p === 'debt.collect' ||
    p.startsWith('delivery.') || p.startsWith('safeer.') || p === 'discount.unlimited' ||
    /* A receipt payload carries the customer's name and phone number, so
       this follows customer.* rather than sitting on its own. */
    p === 'sale.reprint' ||
    /* Label printing drives hardware sitting in the shop, keyed to a
       station name a partner has no business addressing. */
    p === 'label.print'
};

export function isPinned(role, perm) {
  return (PINNED[role] || []).includes(perm);
}

export function isForbidden(role, perm) {
  const rule = FORBIDDEN[role];
  return typeof rule === 'function' && rule(perm);
}

/* ------------------------------------------------------------------- cache
   can() runs on nearly every request, often several times. A query per check
   would be silly. A stale cache would be a security bug, so every write path
   clears it — that is the whole contract of this variable. */
let permCache = null;

let userCache = null;   /* userId → { grant: Set, deny: Set } */

export function invalidatePermissions() { permCache = null; userCache = null; }

function userOverrides() {
  if (userCache) return userCache;
  userCache = new Map();
  let rows = [];
  try { rows = get().prepare('SELECT user_id, perm, allowed FROM user_permissions').all(); }
  catch { rows = []; }   /* a database from before 059 */
  for (const r of rows) {
    let o = userCache.get(r.user_id);
    if (!o) { o = { grant: new Set(), deny: new Set() }; userCache.set(r.user_id, o); }
    (r.allowed ? o.grant : o.deny).add(r.perm);
  }
  return userCache;
}

/* THE ONE PLACE a person's permissions are worked out: the role's set, plus
   what was granted to them, minus what was taken away — then FORBIDDEN and
   PINNED, whatever the rows say. requirePerm, can(), /api/live and the list
   the browser is sent all come through here. */
export function effectiveFor(user) {
  if (!user || !user.active) return new Set();
  const base = permissions()[user.role];
  if (!base) return new Set();
  const out = new Set(base);
  const o = user.id != null ? userOverrides().get(user.id) : null;
  if (o) {
    for (const p of o.grant) if (PERM_SET.has(p) && !isForbidden(user.role, p)) out.add(p);
    for (const p of o.deny) if (!isPinned(user.role, p)) out.delete(p);
  }
  return out;
}

export function permissionsForUser(user) { return [...effectiveFor(user)]; }

/* "Former staff" rows hold history for accounts that were removed; nothing
   lists them and nobody can sign in as one. */
export function isHiddenUser(u) {
  return !!u && /^former-staff/i.test(String(u.username || ''));
}

function permissions() {
  if (permCache) return permCache;

  permCache = {};
  for (const r of ROLES) permCache[r] = new Set();

  for (const row of get().prepare(
    'SELECT role, perm FROM role_permissions WHERE allowed = 1'
  ).all()) {
    if (permCache[row.role]) permCache[row.role].add(row.perm);
  }

  /* Belt and braces. If a row somehow says a partner may read customers —
     hand-edited database, a migration written in a hurry — it is dropped here
     rather than honoured. The boundary should not depend on the data being
     right. */
  for (const role of Object.keys(permCache)) {
    for (const p of [...permCache[role]]) {
      if (isForbidden(role, p)) permCache[role].delete(p);
    }
    for (const p of (PINNED[role] || [])) permCache[role].add(p);
  }

  return permCache;
}

export function can(user, perm) {
  if (!user || !user.active) return false;
  return effectiveFor(user).has(perm);
}

export function permissionsFor(role) {
  const set = permissions()[role];
  return set ? [...set] : [];
}

/* The full grid for the Settings screen: every permission, every role, with
   whether it is on and whether it can be changed. */
export function permissionMatrix() {
  const live = permissions();
  return {
    roles: ROLES,
    permissions: ALL_PERMISSIONS.map(p => ({
      ...p,
      roles: Object.fromEntries(ROLES.map(r => [r, {
        allowed: live[r].has(p.perm),
        locked: isPinned(r, p.perm) || isForbidden(r, p.perm),
        why: isPinned(r, p.perm)
          ? 'The owner and the developer must keep this, or nobody can undo the change.'
          : isForbidden(r, p.perm)
            ? 'Yalla Wear is a separate company and can never be given this.'
            : null
      }]))
    }))
  };
}

/* Save one role's permissions. `granted` is the list that should be on;
   anything else for that role is turned off.

   Returns what was actually applied, which may differ from what was asked —
   the caller should show that rather than assume it took. */
export function setRolePermissions(role, granted, byUserId) {
  if (!ROLES.includes(role)) throw new Error(`unknown role: ${role}`);

  const want = new Set(
    (Array.isArray(granted) ? granted : []).filter(p => PERM_SET.has(p))
  );

  const refused = [];
  for (const p of [...want]) {
    if (isForbidden(role, p)) { want.delete(p); refused.push(p); }
  }
  for (const p of (PINNED[role] || [])) {
    if (!want.has(p)) { want.add(p); refused.push(p); }
  }

  const at = nowIso();
  const stmt = get().prepare(
    `INSERT INTO role_permissions (role, perm, allowed, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (role, perm) DO UPDATE SET
       allowed = excluded.allowed,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  );

  for (const { perm } of ALL_PERMISSIONS) {
    stmt.run(role, perm, want.has(perm) ? 1 : 0, at, byUserId ?? null);
  }

  invalidatePermissions();

  /* Sessions are not dropped. The permission set is read fresh on every
     request, so someone mid-shift simply gains or loses the screen on their
     next click — which is what you want when correcting a mistake, rather
     than throwing the whole shop back to the login page. */
  return { role, granted: [...want].sort(), refused: [...new Set(refused)] };
}

/* ------------------------------------------------------ one person's access
   A switch per permission: on or off for this person, and whether that is
   the role's answer or theirs. Setting a switch back to what the role says
   removes the row, so the table only ever holds real exceptions. */
function accessFail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

export function userAccess(userId) {
  const u = findById(userId);
  if (!u || isHiddenUser(u)) throw accessFail('no such person', 'not_found', 404);
  const roleSet = permissions()[u.role] || new Set();
  const eff = effectiveFor({ ...u, active: 1 });
  const o = userOverrides().get(u.id) || { grant: new Set(), deny: new Set() };
  return {
    user: { id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active },
    permissions: ALL_PERMISSIONS.map((p) => ({
      perm: p.perm, group: p.group, label: p.label,
      allowed: eff.has(p.perm),
      fromRole: roleSet.has(p.perm),
      changed: o.grant.has(p.perm) || o.deny.has(p.perm),
      locked: isPinned(u.role, p.perm) ? 'pinned' : isForbidden(u.role, p.perm) ? 'forbidden' : null
    }))
  };
}

/* allowed: true (grant), false (take away), null (back to the role). */
export function setUserPermission(userId, perm, allowed, byUserId) {
  if (!PERM_SET.has(perm)) throw accessFail(`no permission called ${perm}`, 'bad_perm');
  const u = findById(userId);
  if (!u || isHiddenUser(u)) throw accessFail('no such person', 'not_found', 404);
  if (allowed === true && isForbidden(u.role, perm)) {
    throw accessFail('Yalla Wear is a separate company and can never be given this.', 'forbidden_perm', 409);
  }
  if (allowed === false && isPinned(u.role, perm)) {
    throw accessFail('The owner and the developer must keep this.', 'pinned_perm', 409);
  }
  const roleHas = (permissions()[u.role] || new Set()).has(perm);
  const d = get();
  if (allowed === null || allowed === undefined || allowed === roleHas) {
    d.prepare('DELETE FROM user_permissions WHERE user_id = ? AND perm = ?').run(u.id, perm);
  } else {
    d.prepare(
      `INSERT INTO user_permissions (user_id, perm, allowed, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, perm) DO UPDATE SET
         allowed = excluded.allowed, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(u.id, perm, allowed ? 1 : 0, nowIso(), byUserId ?? null);
  }
  invalidatePermissions();
  return userAccess(u.id);
}

export function resetUserPermissions(userId) {
  const u = findById(userId);
  if (!u || isHiddenUser(u)) throw accessFail('no such person', 'not_found', 404);
  get().prepare('DELETE FROM user_permissions WHERE user_id = ?').run(u.id);
  invalidatePermissions();
  return userAccess(u.id);
}

/* The readable password, sealed (059). Only when the vault is on; a failure
   to seal never stops the password itself being set. */
function boxFor(plain) {
  try { return Vault.isEnabled() ? Vault.seal({ pw: plain }) : null; }
  catch { return null; }
}

/* For the developer panel only — never behind an HTTP route. */
export function openBox(userId) {
  const u = findById(userId);
  if (!u || !u.pw_box) return { ok: false, reason: 'no_box' };
  if (!Vault.isEnabled()) return { ok: false, reason: 'no_key' };
  try { return { ok: true, password: Vault.unseal(u.pw_box).pw }; }
  catch { return { ok: false, reason: 'wrong_key' }; }
}

/* A strong password a person can read aloud: three words-ish chunks and
   digits, 12+ characters, never only numbers. */
export function makePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz', B = 'ABCDEFGHJKMNPQRSTUVWXYZ', N = '23456789';
  const pick = (set, n) => Array.from(randomBytes(n), (x) => set[x % set.length]).join('');
  return pick(B, 1) + pick(A, 4) + '-' + pick(B, 1) + pick(A, 4) + '-' + pick(N, 4);
}

/* ------------------------------------------------------------------ hashing */

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(plain, salt, SCRYPT.keylen, SCRYPT);
  return { hash, salt };
}

export async function verifyPassword(plain, hash, salt) {
  /* A stored hash of the wrong length means a corrupt or truncated row.
     timingSafeEqual throws on a length mismatch, so check before comparing. */
  if (!hash || hash.length !== SCRYPT.keylen) return false;
  const attempt = await scryptAsync(plain, salt, SCRYPT.keylen, SCRYPT);
  return timingSafeEqual(Buffer.from(hash), attempt);
}

/* ------------------------------------------------------------------ accounts */

export async function createUser({ username, name, role, password, hint, phone }) {
  if (!ROLES.includes(role)) throw new Error(`unknown role: ${role}`);
  if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    throw new Error('username must be 3-32 chars, letters/numbers/._- only');
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const { hash, salt } = await hashPassword(password);
  const at = nowIso();

  const info = get().prepare(
    `INSERT INTO users (username, name, role, pw_hash, pw_salt, pw_hint,
                        phone, active, must_change, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(username, name, role, hash, salt, hint ?? null, phone ?? null, at, at);

  const id = Number(info.lastInsertRowid);
  const box = boxFor(password);
  if (box) {
    try { get().prepare('UPDATE users SET pw_box = ? WHERE id = ?').run(box, id); } catch { /* before 059 */ }
  }
  return id;
}

/* Deliberately mild. A shop till is not a bank, and rules so strict that staff
   write the password on the monitor make things worse, not better. The real
   protections are scrypt, the attempt throttle, and sessions that expire. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    return 'password must be at least 8 characters';
  }
  if (pw.length > 200) return 'password is too long';
  if (/^\d+$/.test(pw)) return 'password cannot be only numbers';
  return null;
}

export function findByUsername(username) {
  return get().prepare(
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE'
  ).get(username) ?? null;
}

export function findById(id) {
  return get().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

/* What is safe to send to a browser. Never the hash, never the salt. The hint
   goes only to the person asking for their OWN hint, never in a user list. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    phone: u.phone,
    active: !!u.active,
    mustChange: !!u.must_change,
    permissions: permissionsForUser(u)
  };
}

/* ------------------------------------------------------------------- login */

export function recentFailures(username) {
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const row = get().prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE username = ? COLLATE NOCASE AND ok = 0 AND at > ?`
  ).get(username, since);
  return row ? row.n : 0;
}

/* Failed SIGN-INS from one address. The hint door records its own rows as
   'hint:<name>' failures (audit 06) and is throttled on those by itself;
   counting them here would let a stranger spend the till's attempts by
   asking for hints, the very thing that counter was split out to stop. */
export function recentFailuresFrom(ip) {
  if (!ip) return 0;
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const row = get().prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE ip = ? AND ok = 0 AND at > ? AND username NOT LIKE 'hint:%'`
  ).get(ip, since);
  return row ? row.n : 0;
}

export function recordAttempt(username, ip, ok) {
  get().prepare(
    'INSERT INTO login_attempts (username, ip, ok, at) VALUES (?, ?, ?, ?)'
  ).run(username, ip ?? null, ok ? 1 : 0, nowIso());
}

/* Returns { ok, user, reason }. Never reveals whether the username exists:
   "wrong username or password" for both cases, because the difference is a
   free list of who works here. */
export async function login(username, password, ip, userAgent) {
  if (recentFailures(username) >= MAX_FAILS || recentFailuresFrom(ip) >= MAX_FAILS_IP) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const u = findByUsername(username);

  /* Hash even when the user does not exist. Skipping the work here makes a
     missing username measurably faster to reject, which is enough to
     enumerate accounts over a few hundred requests. */
  const okPw = u
    ? await verifyPassword(password, u.pw_hash, u.pw_salt)
    : await verifyPassword(password, Buffer.alloc(SCRYPT.keylen), randomBytes(16));

  if (!u || !okPw) {
    recordAttempt(username, ip, false);
    return { ok: false, reason: 'bad_credentials' };
  }
  if (!u.active) {
    recordAttempt(username, ip, false);
    return { ok: false, reason: 'disabled' };
  }

  recordAttempt(username, ip, true);
  try { get().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), u.id); } catch { /* before 059 */ }
  const token = createSession(u.id, userAgent);
  return { ok: true, user: u, token };
}

/* ----------------------------------------------------------------- sessions */

export function createSession(userId, userAgent) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  get().prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    token,
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_MS).toISOString(),
    new Date(now).toISOString(),
    userAgent ?? null
  );
  return token;
}

/* Resolve a token to a user, sliding the expiry forward. Returns null for
   anything expired, unknown, or belonging to a disabled account — so
   deactivating someone takes effect on their next request, not in two weeks. */
export function userForToken(token) {
  if (!token) return null;
  const d = get();
  const s = d.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;

  if (new Date(s.expires_at).getTime() < Date.now()) {
    d.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const u = findById(s.user_id);
  if (!u || !u.active) return null;

  const now = Date.now();
  d.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token = ?')
   .run(
     new Date(now).toISOString(),
     new Date(now + SESSION_MS).toISOString(),
     token
   );

  return u;
}

export function destroySession(token) {
  if (token) get().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyAllSessions(userId) {
  get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/* Housekeeping, called on a timer by the server. Expired rows are harmless but
   unbounded, and login_attempts grows fastest of all. */
export function sweep() {
  const d = get();
  const now = nowIso();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const a = d.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const b = d.prepare('DELETE FROM login_attempts WHERE at < ?').run(old);
  return { sessions: a.changes, attempts: b.changes };
}

/* ------------------------------------------------------- password management */

export async function changePassword(userId, newPassword) {
  const problem = passwordProblem(newPassword);
  if (problem) throw new Error(problem);

  const { hash, salt } = await hashPassword(newPassword);
  get().prepare(
    `UPDATE users SET pw_hash = ?, pw_salt = ?, must_change = 0, updated_at = ?
     WHERE id = ?`
  ).run(hash, salt, nowIso(), userId);
  setBox(userId, newPassword);

  /* Every other session for this account dies. If the password was changed
     because it leaked, leaving the thief's session alive defeats the point. */
  destroyAllSessions(userId);
}

/* A manager resets someone's password to a temporary one. This is the safer
   half of the "forgot my password" story — a hint is a clue lying next to the
   money screens, a reset is an action with a person's name on it. */
export async function resetPassword(targetUserId, tempPassword) {
  const problem = passwordProblem(tempPassword);
  if (problem) throw new Error(problem);

  const { hash, salt } = await hashPassword(tempPassword);
  get().prepare(
    `UPDATE users SET pw_hash = ?, pw_salt = ?, must_change = 1, updated_at = ?
     WHERE id = ?`
  ).run(hash, salt, nowIso(), targetUserId);
  setBox(targetUserId, tempPassword);
  destroyAllSessions(targetUserId);
}

/* A password set here is also kept sealed; a password set with the vault off
   leaves no box (and clears an old one, which would now be wrong). */
function setBox(userId, plain) {
  try { get().prepare('UPDATE users SET pw_box = ? WHERE id = ?').run(boxFor(plain), userId); }
  catch { /* before 059 */ }
}

/* The hint, for the login screen. Returned only after a username is typed and
   only for that username — still a weakness, but a contained one. Callers must
   throttle this exactly like a login attempt, or it becomes a way to harvest
   every hint in the building. */
export function hintFor(username) {
  const u = findByUsername(username);
  return u && u.active ? (u.pw_hint ?? null) : null;
}

/* Session cookie name and attributes, in one place so no route can get them
   subtly wrong. httpOnly keeps it away from JavaScript, which is what stops a
   cross-site script from stealing it. */
export const COOKIE = 'og_session';

export function cookieHeader(token, { secure, maxAgeSec }) {
  const bits = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec ?? Math.floor(SESSION_MS / 1000)}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearCookieHeader({ secure }) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}
