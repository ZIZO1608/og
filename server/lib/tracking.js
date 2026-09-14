/* ==========================================================================
   OG SYSTEM — an order moved: tell whoever is watching          [tracking.js]
   --------------------------------------------------------------------------
   One fact, three audiences, all fed from the SAME list of events the
   customer's page draws (Receipt.events), so a notification can never say
   something the page does not:

   1. A tracking page that is OPEN → Live.notifyTrack, a data-less nudge; the
      page refetches its own public HTML. Immediate.
   2. The customer's phone or laptop with the page CLOSED → Web Push to every
      browser following that order.
   3. The office's own browsers → Web Push to every staff subscription whose
      account may still work the desk — EXCEPT the person who made the change,
      who does not need their own phone buzzing about the button they pressed.

   WHAT COUNTS AS NEWS is decided by keys, not by which route ran. Every public
   event carries a stable key (pay:17, out:<stamp>, closed:delivered:<stamp>);
   push_seen remembers the keys already announced per order; only a key not in
   that set is said. So a route that changes nothing a customer can see (a
   driver handing cash in) says nothing, two routes touching one order say it
   once, and a restart does not repeat yesterday's "delivered".

   Everything here runs AFTER the write has committed and never throws into
   the route: a slow push service is not a reason for a payment to fail.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as Receipt from './receipt.js';
import * as Push from './webpush.js';
import * as Live from './live.js';
import * as Auth from './auth.js';

/* An order with no push_seen row yet (it predates this, or nobody has ever
   followed it): only events this recent are news. Long enough for the route
   that just wrote to land inside it, short enough that last week's payment is
   not announced the first time the order moves again. */
const FRESH_MS = 3 * 60 * 1000;
const PER_ORDER = 10;
const TOTAL = 20000;
const GONE_AFTER = 8;

function fail(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
const langOf = (v) => (v === 'en' ? 'en' : 'ar');
const endpointOf = (body) => (body && typeof body.endpoint === 'string' ? body.endpoint.slice(0, 1024) : '');

/* ------------------------------------------------------- which orders moved */

export function saleOfDelivery(id) {
  const r = get().prepare('SELECT sale_id FROM deliveries WHERE id = ?').get(Number(id));
  return r ? r.sale_id : null;
}

export function salesOnHandover(id) {
  return get().prepare(
    `SELECT d.sale_id FROM handover_lines l JOIN deliveries d ON d.id = l.delivery_id
      WHERE l.handover_id = ?`
  ).all(String(id)).map((r) => r.sale_id);
}

/* ------------------------------------------------------------------ moved */

const pending = new Map();   // saleId -> Set of actor user ids
let timer = null;

/* Called by a route after its write. The open pages hear at once; the pushes
   go out a moment later, batched, so a handover of eleven parcels is one pass. */
export function moved(ids, actorId = null) {
  const list = [].concat(ids || []).filter(Boolean).map(String);
  if (!list.length) return;
  try { Live.notifyTrack(list); } catch { /* the page catches up on its next poll */ }
  for (const id of list) {
    if (!pending.has(id)) pending.set(id, new Set());
    if (actorId != null) pending.get(id).add(Number(actorId));
  }
  if (!timer) {
    timer = setTimeout(flush, 700);
    if (timer.unref) timer.unref();
  }
}

async function flush() {
  timer = null;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [id, actors] of batch) {
    try { await announce(id, actors); }
    catch (e) { console.error(`[${nowIso()}] push for ${id} —`, e.message); }
  }
}

function seenKeys(d, saleId, rows) {
  const row = d.prepare('SELECT keys FROM push_seen WHERE sale_id = ?').get(saleId);
  if (row) {
    try { return new Set(JSON.parse(row.keys)); } catch { /* rebuilt below */ }
  }
  const cutoff = Date.now() - FRESH_MS;
  return new Set(rows.filter((r) => !(Date.parse(r.at) >= cutoff)).map((r) => r.key));
}

function remember(d, saleId, rows) {
  d.prepare(
    `INSERT INTO push_seen (sale_id, keys, at) VALUES (?, ?, ?)
     ON CONFLICT(sale_id) DO UPDATE SET keys = excluded.keys, at = excluded.at`
  ).run(saleId, JSON.stringify(rows.map((r) => r.key)), nowIso());
}

async function announce(saleId, actors) {
  const sale = Receipt.bySaleId(saleId);
  if (!sale || !sale.order) return;
  const d = get();

  /* Keys are the same in both languages; English is only the reading. */
  const rows = Receipt.events(sale, 'en');
  const seen = seenKeys(d, sale.id, rows);
  /* Remembered whether or not anybody is listening, so somebody who follows
     the order tomorrow is not told today's news. */
  remember(d, sale.id, rows);

  const fresh = rows.filter((r) => !seen.has(r.key));
  if (!fresh.length) return;
  /* WHICH EVENT LEADS when several land at once. Not simply the last by time:
     a driver marking a parcel delivered with the cash in his hand writes the
     payment a moment AFTER the arrival, and "Payment received · +1 more" was
     what the customer's phone said about their parcel arriving — with the
     review request, which hangs off the arrival, never sent. The biggest
     news leads; the rest is "+N more". */
  const weight = (k) => (k.startsWith('closed:') || k === 'void') ? 5
    : k.startsWith('out:') ? 4 : k.startsWith('ret:') ? 3 : k.startsWith('pay:') ? 2 : 1;
  const lead = fresh.reduce((best, r) => (weight(r.key) >= weight(best.key) ? r : best), fresh[0]);
  const key = lead.key;
  const more = fresh.length - 1;

  const subs = d.prepare(
    `SELECT * FROM push_subscriptions
      WHERE (audience = 'track' AND sale_id = ?) OR audience = 'staff'`
  ).all(sale.id);
  if (!subs.length) return;

  const users = new Map();
  const userOf = (id) => {
    if (!users.has(id)) users.set(id, d.prepare('SELECT id, role, active FROM users WHERE id = ?').get(id) || null);
    return users.get(id);
  };

  const jobs = [];
  for (const s of subs) {
    let msg;
    if (s.audience === 'track') {
      msg = Receipt.pushText(sale, s.lang, key, { audience: 'track', more });
    } else {
      if (actors.has(s.user_id)) continue;
      const u = userOf(s.user_id);
      /* Skipped, not deleted: a permission taken away this morning may be
         given back this afternoon, and the phone should still be on the list. */
      if (!Auth.can(u, 'delivery.desk')) continue;
      msg = Receipt.pushText(sale, s.lang, key, {
        audience: 'staff', more, customer: Auth.can(u, 'customer.read')
      });
    }
    if (msg) jobs.push(deliver(s, msg, 'o' + sale.id));
  }
  await Promise.allSettled(jobs);
}

async function deliver(s, msg, topic) {
  const d = get();
  let out;
  try { out = await Push.send(s, msg, { topic }); }
  catch (e) { out = { status: -1, text: e.message }; }
  if (out.skipped) return out;

  if (out.status >= 200 && out.status < 300) {
    d.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fails = 0 WHERE id = ?').run(nowIso(), s.id);
  } else if (out.status === 404 || out.status === 410) {
    /* The vendor is being definite — the browser unsubscribed or its site
       data was cleared — the way Telegram's 403 is. Every row on that
       endpoint is dead; it may have been following three orders. */
    d.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
  } else {
    d.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?').run(s.id);
    d.prepare('DELETE FROM push_subscriptions WHERE id = ? AND fails >= ?').run(s.id, GONE_AFTER);
    console.error(`[${nowIso()}] push ${out.status} to ${s.audience} #${s.id}${out.text ? ' — ' + out.text : ''}`);
  }
  return out;
}

/* A customer reviewed their delivery: every office device that may work the
   desk hears it. Never throws into the route. */
export async function reviewed(sale, out) {
  try {
    if (!out || !out.review) return;
    const d = get();
    const subs = d.prepare(`SELECT * FROM push_subscriptions WHERE audience = 'staff'`).all();
    const users = new Map();
    const jobs = [];
    for (const s of subs) {
      if (!users.has(s.user_id)) {
        users.set(s.user_id, d.prepare('SELECT id, role, active FROM users WHERE id = ?').get(s.user_id) || null);
      }
      const u = users.get(s.user_id);
      if (!Auth.can(u, 'delivery.desk')) continue;
      const msg = Receipt.reviewText(sale, out.review, s.lang, {
        customer: Auth.can(u, 'customer.read'), edited: !out.first
      });
      if (msg) jobs.push(deliver(s, msg, 'r' + sale.id));
    }
    await Promise.allSettled(jobs);
  } catch (e) {
    console.error(`[${nowIso()}] review push for ${sale && sale.id} —`, e.message);
  }
}

/* --------------------------------------------------------- subscriptions */

function saveSub(d, sub, audience, saleId, userId, lang) {
  if (d.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n >= TOTAL) {
    throw fail('too many subscriptions on this server', 'too_many', 429);
  }
  d.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint = ? AND audience = ? AND COALESCE(sale_id, '') = ?`
  ).run(sub.endpoint, audience, saleId || '');
  if (saleId) {
    /* The newest PER_ORDER - 1 stay; this one makes PER_ORDER. */
    const extra = d.prepare(
      `SELECT id FROM push_subscriptions WHERE audience = 'track' AND sale_id = ?
        ORDER BY id DESC LIMIT -1 OFFSET ?`
    ).all(saleId, PER_ORDER - 1);
    for (const r of extra) d.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(r.id);
  }
  d.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, audience, sale_id, user_id, lang, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sub.endpoint, sub.p256dh, sub.auth, audience, saleId || null, userId || null, lang, nowIso());
  return d.prepare(
    `SELECT * FROM push_subscriptions WHERE endpoint = ? AND audience = ? AND COALESCE(sale_id, '') = ?`
  ).get(sub.endpoint, audience, saleId || '');
}

/* The customer's "Notify me". The sale comes from the token, never the body. */
export function followOrder(sale, body) {
  if (!sale || !sale.order) throw fail('this receipt has no delivery to follow', 'not_an_order', 404);
  if (sale.voided) throw fail('this order was cancelled', 'voided', 409);
  const sub = Push.cleanSubscription(body);
  if (!sub) throw fail('that is not a push subscription this server can use', 'bad_subscription');
  const d = get();
  const lang = langOf(body.lang);
  /* Asked before saving, because saving replaces the row. */
  const already = !!d.prepare(
    `SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND audience = 'track' AND sale_id = ?`
  ).get(sub.endpoint, sale.id);
  const row = saveSub(d, sub, 'track', sale.id, null, lang);
  /* Everything on the page right now is not news to the person looking at it. */
  if (!d.prepare('SELECT 1 FROM push_seen WHERE sale_id = ?').get(sale.id)) {
    remember(d, sale.id, Receipt.events(sale, 'en'));
  }
  /* The first notification arrives at once and says what it is for — the
     proof, on the customer's own phone, that the button worked. Only the
     FIRST time this browser follows this order: a second tap, or og-track's
     inbox (lib/inbox.js) delivering a follow that is already here, would be a
     "notifications are on" at a random hour, which is noise. The row is still
     saved again, so new keys or a new language take effect. */
  if (!already) {
    deliver(row, Receipt.pushText(sale, lang, null, { audience: 'track', hello: true }), 'o' + sale.id)
      .catch(() => {});
  }
  return { on: true };
}

export function unfollowOrder(sale, body) {
  const endpoint = endpointOf(body);
  if (sale && endpoint) {
    get().prepare(
      `DELETE FROM push_subscriptions WHERE endpoint = ? AND audience = 'track' AND sale_id = ?`
    ).run(endpoint, sale.id);
  }
  return { on: false };
}

export function followingOrder(sale, body) {
  const endpoint = endpointOf(body);
  const row = sale && endpoint ? get().prepare(
    `SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND audience = 'track' AND sale_id = ?`
  ).get(endpoint, sale.id) : null;
  return { on: !!row };
}

/* The office's bell. One browser, one person: whoever turned it on last owns
   the alerts on it, so a shared office laptop does not buzz for two accounts. */
export function followShop(user, body) {
  const sub = Push.cleanSubscription(body);
  if (!sub) throw fail('that is not a push subscription this server can use', 'bad_subscription');
  const d = get();
  const lang = langOf(body.lang);
  d.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND audience = 'staff'`).run(sub.endpoint);
  const row = saveSub(d, sub, 'staff', null, user.id, lang);
  deliver(row, Receipt.pushText(null, lang, null, { audience: 'staff', hello: true }), 'staff')
    .catch(() => {});
  return { on: true };
}

export function unfollowShop(user, body) {
  const endpoint = endpointOf(body);
  if (endpoint) {
    get().prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND audience = 'staff'`).run(endpoint);
  }
  return { on: false };
}

export function shopState(user, body) {
  const endpoint = endpointOf(body);
  const row = endpoint ? get().prepare(
    `SELECT user_id FROM push_subscriptions WHERE endpoint = ? AND audience = 'staff'`
  ).get(endpoint) : null;
  return { on: !!row && row.user_id === user.id, key: Push.publicKey(), off: process.env.OG_PUSH === '0' };
}

/* ------------------------------------------------------- the page's pieces */

/* Lets the order be added to an iPhone's home screen, which is the only way
   Apple allows a web page to receive a push at all. */
export function manifest(sale, token, lang) {
  const shop = Receipt.shopName();
  const en = lang === 'en';
  return {
    name: `${shop} · ${sale.id}`,
    short_name: shop,
    start_url: `/i/${token}${en ? '?lang=en' : ''}`,
    scope: '/i/',
    display: 'standalone',
    background_color: '#0A0A0B',
    theme_color: '#0A0A0B',
    lang: en ? 'en' : 'ar',
    dir: en ? 'ltr' : 'rtl',
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  };
}

/* /i/sw.js — the tracking page's own service worker, scoped to /i/ so it can
   never touch the app. It does nothing but show a push and open the page.
   The app's sw.js carries the same two handlers for the office's alerts;
   KEEP THE TWO IN STEP. */
export const WORKER = `/* OG SYSTEM — the tracking page's service worker. Served by server/lib/tracking.js. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var m = {};
  try { m = e.data ? e.data.json() : {}; } catch (x) { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var path = String(m.url || '').split('?')[0];
    var watching = false;
    list.forEach(function (c) {
      try { c.postMessage({ og: 'push', m: m }); } catch (x) {}
      if (path && c.focused && c.visibilityState === 'visible' && c.url.indexOf(path) !== -1) watching = true;
    });
    /* The customer is looking at this very order right now: the page drops
       its own banner with a chime, and a system notification on top of it is
       the same news twice. Apple withdraws push from a site that receives one
       without showing anything, so on Safari it is always shown. */
    var ua = (self.navigator && self.navigator.userAgent) || '';
    var apple = /iPhone|iPad|Macintosh/.test(ua) && !/Chrome|CriOS|Edg|Firefox|FxiOS/.test(ua);
    if (watching && !apple && !m.always) return null;
    return self.registration.showNotification(m.title || 'OG', {
      body: m.body || '',
      icon: m.icon || '/assets/icon-192.png',
      tag: m.tag || undefined,
      renotify: !!m.tag,
      silent: false,
      vibrate: [200, 100, 200, 100, 320],
      requireInteraction: !!m.sticky,
      actions: m.actions || undefined,
      lang: m.lang || undefined,
      dir: m.dir || 'auto',
      timestamp: m.at ? Date.parse(m.at) : Date.now(),
      data: { url: m.url || '/', links: m.links || {} }
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  /* A button on the notification ("Rate it") carries its own address. */
  var url = (e.action && data.links && data.links[e.action]) || data.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(url.split('?')[0]) !== -1 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
`;
