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
  scrypt, randomBytes, timingSafeEqual, createHash
} from 'node:crypto';
import { promisify } from 'node:util';
import { get, nowIso } from './db.js';

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

export const ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner'];

/* --------------------------------------------------------------- permissions
   One table, read top to bottom, rather than `if (role === 'manager')` sprayed
   through the routes. Anything not listed is denied: a new endpoint is locked
   until someone deliberately opens it, which is the right default.

   The rule that matters commercially: a cashier must not see cost or profit.
   They handle customers and they handle cash, and margin is not theirs to
   know. `partner` is Yalla Wear — remote, outside the company, and must never
   reach a customer name, a phone number, or what OG charged for the job. */
const PERMISSIONS = {
  manager: [
    'sell', 'refund', 'void',
    'stock.read', 'stock.move', 'stock.count',
    'product.read', 'product.write',
    'customer.read', 'customer.write',
    'cost.read', 'profit.read',
    'money.read', 'money.write',
    'staff.read', 'staff.write',
    'print.read', 'print.write',
    'partner.read', 'partner.write',
    'config.write', 'report.read'
  ],
  cashier: [
    'sell', 'refund',
    'stock.read',
    'product.read',
    'customer.read', 'customer.write',
    'print.read'
    /* deliberately absent: cost.read, profit.read, money.*, staff.* */
  ],
  warehouse: [
    'stock.read', 'stock.move', 'stock.count',
    'product.read', 'product.write',
    'print.read'
  ],
  delivery: [
    'stock.read',
    'product.read',
    'customer.read',
    'print.read'
  ],
  partner: [
    /* Yalla Wear. Their own jobs, nothing else. Enforced here on the server;
       DB.partnerView in the browser is a convenience, not a boundary. */
    'partner.jobs', 'partner.respond', 'partner.invoice'
  ]
};

export function can(user, perm) {
  if (!user || !user.active) return false;
  const list = PERMISSIONS[user.role];
  return Array.isArray(list) && list.includes(perm);
}

export function permissionsFor(role) {
  return (PERMISSIONS[role] || []).slice();
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

  return Number(info.lastInsertRowid);
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
    permissions: permissionsFor(u.role)
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

export function recordAttempt(username, ip, ok) {
  get().prepare(
    'INSERT INTO login_attempts (username, ip, ok, at) VALUES (?, ?, ?, ?)'
  ).run(username, ip ?? null, ok ? 1 : 0, nowIso());
}

/* Returns { ok, user, reason }. Never reveals whether the username exists:
   "wrong username or password" for both cases, because the difference is a
   free list of who works here. */
export async function login(username, password, ip, userAgent) {
  if (recentFailures(username) >= MAX_FAILS) {
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
  destroyAllSessions(targetUserId);
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

/* Stable, non-reversible id for a token, for logging. Writing a live session
   token into a log file turns the log into a set of working keys. */
export function tokenFingerprint(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}
