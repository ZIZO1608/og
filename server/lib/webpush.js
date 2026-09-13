/* ==========================================================================
   OG SYSTEM — Web Push, with nothing but node:crypto              [webpush.js]
   --------------------------------------------------------------------------
   How a phone is woken with the page closed. The browser hands over an
   endpoint at its vendor's push service (Google, Mozilla, Apple, Microsoft)
   and two keys; the message is encrypted to those keys (RFC 8291, aes128gcm)
   and POSTed there, signed with this shop's own key pair (VAPID, RFC 8292).
   The vendor carries it to the device and the service worker shows it.

   ZERO DEPENDENCIES, like the rest of the server. The `web-push` package is
   a thin wrapper around three primitives Node already ships — ECDH on P-256,
   HMAC-SHA-256 and AES-128-GCM — and this server has no npm install.

   Three rules this file keeps:

   1. ONLY A REAL PUSH SERVICE IS EVER CALLED. The endpoint is a URL that a
      stranger's browser sends, to a page with no login in front of it.
      POSTing to whatever arrives would make the till a way to send requests
      into the shop's own network. The host must be a vendor's push service.

   2. A SCRATCH COPY NEVER REACHES A REAL PHONE. A copy of og.db carries the
      customers' real subscriptions — the Telegram-token trap again.
      `OG_PUSH=0` turns sending off. `OG_PUSH_TEST_HOST=127.0.0.1:9311` allows
      exactly that one plain-http receiver and REFUSES every real service, so a
      harness can decrypt what would have been sent.

   3. THE PRIVATE KEY STAYS IN push_keys (migration 048 says why not config
      and not .env). Losing it is not a disaster — subscriptions stop working
      and each browser re-subscribes the next time its page is opened — but
      handing it out would let anybody push in the shop's name.
   ========================================================================== */

import {
  createECDH, createHmac, createCipheriv, randomBytes,
  generateKeyPairSync, createPrivateKey, sign
} from 'node:crypto';
import { get, nowIso } from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

/* ------------------------------------------------------------------- keys */

let cached = null;

/* Minted the first time anything needs it, then read once per process. */
export function keys() {
  if (cached) return cached;
  const d = get();
  let row = d.prepare('SELECT public_key, private_jwk FROM push_keys WHERE id = 1').get();
  if (!row) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' });
    /* The browser wants the public half as an uncompressed point: 0x04 || X || Y. */
    const pub = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
    d.prepare('INSERT OR IGNORE INTO push_keys (id, public_key, private_jwk, created_at) VALUES (1, ?, ?, ?)')
      .run(b64u(pub), JSON.stringify(jwk), nowIso());
    row = d.prepare('SELECT public_key, private_jwk FROM push_keys WHERE id = 1').get();
  }
  cached = {
    publicKey: row.public_key,
    key: createPrivateKey({ key: JSON.parse(row.private_jwk), format: 'jwk' })
  };
  return cached;
}

export function publicKey() { return keys().publicKey; }

/* -------------------------------------------------------------- endpoints */

const SERVICES = [
  /^fcm\.googleapis\.com$/,               // Chrome, Edge and Samsung on Android, Chrome on desktop
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,  // Firefox
  /(^|\.)notify\.windows\.com$/,          // Edge on Windows
  /(^|\.)push\.apple\.com$/               // Safari on a Mac, an iPhone home-screen app
];

export function endpointOk(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.username || u.password) return false;
  const test = String(process.env.OG_PUSH_TEST_HOST || '').trim();
  if (test) return u.protocol === 'http:' && u.host === test;
  return u.protocol === 'https:' && (u.port === '' || u.port === '443') &&
    SERVICES.some((r) => r.test(u.hostname));
}

/* What a browser sent, checked and normalised — or null. The key is also
   tried as a real curve point here, so a malformed one is refused at the door
   rather than failing silently on every push after. */
export function cleanSubscription(body) {
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const k = body && body.keys && typeof body.keys === 'object' ? body.keys : {};
  if (!endpoint || endpoint.length > 1024 || !endpointOk(endpoint)) return null;
  const p = fromB64u(k.p256dh), a = fromB64u(k.auth);
  if (p.length !== 65 || p[0] !== 4 || a.length < 16 || a.length > 64) return null;
  try { const e = createECDH('prime256v1'); e.generateKeys(); e.computeSecret(p); }
  catch { return null; }
  return { endpoint, p256dh: b64u(p), auth: b64u(a) };
}

/* ------------------------------------------------------------- encryption */

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/* HKDF with one output block, which is all either key needs (16 and 12 bytes
   out of a 32-byte block). */
function hkdf(salt, ikm, info, len) {
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
}

/* RFC 8291 §3.4 + RFC 8188: one record, no padding, the whole message. */
export function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(auth, shared, keyInfo, 32);
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  /* 0x02 marks the last (and only) record. */
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;          // 65
  return Buffer.concat([header, asPublic, sealed]);
}

/* ------------------------------------------------------------------ VAPID */

const jwts = new Map();   // audience origin -> { value, until }

/* Who a push service writes to when something is wrong. A real https
   address when the shop has one; OG_PUSH_CONTACT overrides. */
let contactUrl = null;
export function setContact(url) { contactUrl = url || null; }
function contact() {
  const env = String(process.env.OG_PUSH_CONTACT || '').trim();
  if (env) return /^(mailto:|https:\/\/)/i.test(env) ? env : `mailto:${env}`;
  return contactUrl && /^https:\/\//i.test(contactUrl) ? contactUrl : 'mailto:og-system@localhost';
}

function vapid(endpoint) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const hit = jwts.get(aud);
  if (hit && hit.until > now + 600) return hit.value;

  const k = keys();
  const exp = now + 12 * 3600;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp, sub: contact() }));
  /* ieee-p1363: the raw 64-byte r||s a JWT carries, not Node's default DER. */
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key: k.key, dsaEncoding: 'ieee-p1363' });
  const value = `vapid t=${head}.${claims}.${b64u(sig)}, k=${k.publicKey}`;
  jwts.set(aud, { value, until: exp });
  return value;
}

/* ------------------------------------------------------------------- send */

/* { status, text } — or { status: 0, skipped } when nothing was sent.
   Throws only on a network failure, which the caller counts as a miss. */
export async function send(sub, message, { topic = null, ttl = 86400, urgency = 'high' } = {}) {
  if (process.env.OG_PUSH === '0') return { status: 0, skipped: 'off' };
  if (!sub || !endpointOk(sub.endpoint)) return { status: 0, skipped: 'endpoint' };

  const payload = Buffer.from(JSON.stringify(message));
  /* A push service accepts about 4 KB; a sentence about one parcel is a
     few hundred bytes, so anything near this is a bug, not a long message. */
  if (payload.length > 3000) return { status: 0, skipped: 'too_large' };

  const headers = {
    Authorization: vapid(sub.endpoint),
    TTL: String(ttl),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Urgency: urgency
  };
  /* Topic lets the service replace an undelivered older message about the
     same order rather than queue both for a phone that was off. */
  const t = topic ? String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : '';
  if (t) headers.Topic = t;

  const res = await fetch(sub.endpoint, {
    method: 'POST', headers,
    body: encrypt(payload, sub.p256dh, sub.auth),
    signal: AbortSignal.timeout(15000)
  });
  let text = '';
  if (!res.ok) { try { text = (await res.text()).slice(0, 200); } catch { /* nothing to read */ } }
  return { status: res.status, text };
}
