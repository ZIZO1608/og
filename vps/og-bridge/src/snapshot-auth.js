/* ==========================================================================
   The snapshot's own door — og-bridge's, not the till's.  [snapshot-auth.js]
   --------------------------------------------------------------------------
   The page shows costs and profit, it is on the internet, and exactly when it
   matters the till is unreachable — so it cannot ask the till who somebody
   is. Its own accounts (OG_SNAPSHOT_USERS), and two factors:

     PASSWORD  scrypt with the till's own parameters (N=32768, r=8, keylen 64,
               server/lib/auth.js), stored as scrypt$N$r$p$salt$hash.
     CODE      TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 s, one step either
               side for a phone clock that is a little out. A code is spent
               once — the same six digits cannot be replayed in its window.

   THROTTLE: five failures in fifteen minutes, counted per username AND per
   address; either one refuses. An attempt is counted the moment it starts
   and taken back if it succeeds, so guesses sent in parallel cannot all slip
   in while the first is still being hashed. An unknown username is hashed against dummy
   bytes exactly like a known one, the way the till's login does it, so the
   time taken says nothing about who has an account.

   SESSIONS live in memory, 12 hours. A restart signs the owner out; that is
   the price of keeping no session table anywhere.

   NIGHT MODE (night.js) uses the same door with its own cookie, its own path
   and its own accounts (OG_NIGHT_USERS), each carrying a ROLE — owner,
   manager or staff. A session also keeps a form token, so every POST a page
   sends can be checked against the session that drew it. /snapshot's
   defaults are unchanged.

   node:crypto only.
   ========================================================================== */
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEYLEN = 64;
const scryptAsync = (pw, salt, opts) => new Promise((ok, bad) =>
  scrypt(pw, salt, KEYLEN, opts, (e, k) => (e ? bad(e) : ok(k))));

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(plain), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(stored || ''));
  if (!m) return null;
  const hash = Buffer.from(m[5], 'base64');
  if (hash.length !== KEYLEN) return null;
  return { N: +m[1], r: +m[2], p: +m[3], salt: Buffer.from(m[4], 'base64'), hash };
}

const DUMMY = { ...SCRYPT, salt: randomBytes(16), hash: Buffer.alloc(KEYLEN) };

export async function verifyPassword(plain, stored) {
  const h = parseHash(stored);
  const use = h || DUMMY;
  const got = await scryptAsync(String(plain), use.salt, { N: use.N, r: use.r, p: use.p, maxmem: SCRYPT.maxmem });
  return !!h && timingSafeEqual(got, h.hash);
}

/* ------------------------------------------------------------------- TOTP */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/* RFC 4226 HOTP: the 6-digit code for one counter. */
export function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1e6).padStart(6, '0');
}

export const STEP_S = 30;

/* The step a code matches within ±window, or null. */
export function totpStep(secretB32, code, nowMs, window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  if (!key.length) return null;
  const step = Math.floor(nowMs / 1000 / STEP_S);
  for (let d = -window; d <= window; d++) {
    if (timingSafeEqual(Buffer.from(hotp(key, step + d)), Buffer.from(c))) return step + d;
  }
  return null;
}

export function newTotpSecret() { return base32Encode(randomBytes(20)); }

/* ----------------------------------------------------------------- the door */

export const COOKIE = 'og_snap';
export const SESSION_MS = 12 * 60 * 60 * 1000;

/* `roles`, when given, is the list a line's role must be one of (night mode);
   a line without one of them is dropped rather than let in with no role. */
export function parseUsers(json, { roles = null } = {}) {
  let list;
  try { list = JSON.parse(json || '[]'); } catch { list = []; }
  const out = new Map();
  for (const u of Array.isArray(list) ? list : []) {
    if (u && typeof u.user === 'string' && u.user && parseHash(u.scrypt) && base32Decode(u.totpSecret).length >= 10) {
      if (roles && !roles.includes(u.role)) continue;
      out.set(u.user.toLowerCase(), { user: u.user, scrypt: u.scrypt, totpSecret: u.totpSecret, role: roles ? u.role : null });
    }
  }
  return out;
}

export function makeAuth({ users, now = () => Date.now(), max = 5, windowMs = 15 * 60 * 1000,
                           cookieName = COOKIE, path = '/snapshot', sessionMs = SESSION_MS }) {
  const fails = new Map();       /* key -> [ms, ...] */
  const lastStep = new Map();    /* user -> last TOTP step accepted */
  const sessions = new Map();    /* token -> { user, role, csrf, exp } */

  const recent = (key) => {
    const since = now() - windowMs;
    const list = (fails.get(key) || []).filter((t) => t > since);
    if (list.length) fails.set(key, list); else fails.delete(key);
    return list.length;
  };
  const fail = (key, at = now()) => { const l = fails.get(key) || []; l.push(at); fails.set(key, l); };
  const unfail = (key, at) => {
    const l = fails.get(key);
    const i = l ? l.indexOf(at) : -1;
    if (i > -1) l.splice(i, 1);
    if (l && !l.length) fails.delete(key);
  };
  /* A door on the internet is asked by strangers with invented names from
     invented addresses; what they leave behind must not grow for ever. */
  const tidy = () => {
    if (fails.size > 5000) for (const k of [...fails.keys()]) recent(k);
    if (sessions.size > 500) for (const [t, s] of sessions) if (s.exp <= now()) sessions.delete(t);
  };

  return {
    async login({ user, password, code, ip }) {
      tidy();
      const name = String(user || '').trim().toLowerCase().slice(0, 64);
      const ipKey = 'ip:' + (ip || '?');
      const uKey = 'u:' + name;
      if (recent(uKey) >= max || recent(ipKey) >= max) return { ok: false, reason: 'throttled' };
      /* COUNTED BEFORE THE HASH, taken back on success. scrypt takes a tenth
         of a second, and counted only after it, fifty guesses sent at once
         all passed the check above before the first one was counted
         (security review). */
      const at = now();
      fail(uKey, at); fail(ipKey, at);
      const u = users.get(name) || null;
      /* Hash whether or not the name exists. */
      const pwOk = await verifyPassword(String(password || ''), u ? u.scrypt : null);
      const step = u ? totpStep(u.totpSecret, code, now()) : null;
      const fresh = step !== null && step > (lastStep.get(name) ?? -Infinity);
      if (!u || !pwOk || !fresh) return { ok: false, reason: 'bad' };
      unfail(uKey, at); unfail(ipKey, at);
      lastStep.set(name, step);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { user: u.user, role: u.role || null, csrf: randomBytes(24).toString('hex'), exp: now() + sessionMs });
      return { ok: true, token, user: u.user, role: u.role || null };
    },
    session(token) {
      const s = this.who(token);
      return s ? s.user : null;
    },
    /* The whole session — { user, role, csrf } — or null. */
    who(token) {
      if (!token || typeof token !== 'string') return null;
      const s = sessions.get(token);
      if (!s) return null;
      if (s.exp <= now()) { sessions.delete(token); return null; }
      return { user: s.user, role: s.role, csrf: s.csrf };
    },
    /* Does a form's token belong to this session? Constant time. */
    formOk(token, sent) {
      const s = this.who(token);
      if (!s || typeof sent !== 'string' || !sent) return false;
      const a = Buffer.from(sent), b = Buffer.from(s.csrf);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    logout(token) { sessions.delete(token); },
    cookie(token) {
      return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=${sessionMs / 1000}`;
    },
    clearCookie() { return `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=0`; }
  };
}
