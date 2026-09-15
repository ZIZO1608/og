/* ==========================================================================
   OG SYSTEM — what customers thought of their delivery          [reviews.js]
   --------------------------------------------------------------------------
   Written by the customer on their own tracking page once the order has
   arrived (POST /i/<token>/review), read by the office on the Reviews page
   (GET /api/reviews), and — only when BOTH the customer allowed it and the
   shop switched it on — handed to the website (GET /api/ext/reviews).
   Migration 049 says why it is two switches.

   Rules this file keeps:

   1. ONLY AN ORDER THAT ARRIVED. A review of a parcel still on the road is a
      complaint about waiting, and a cancelled order has nothing to review.
   2. THE WEBSITE GETS A NAME, A CITY, STARS AND WORDS. Never the invoice
      number (a stable opaque id is derived instead), the phone, the address,
      the driver or the price — the same instinct as the tracking page's
      SELECT, for a page that is even more public.
   3. EDITING TAKES IT OFF THE WEBSITE. The shop approved what it read.
   4. Every write is logged (`order_reviews` is a cursor-shape mirrored table),
      or it lives on this laptop and nowhere else.
   ========================================================================== */

import { createHash } from 'node:crypto';
import { get, tx, nowIso, logChange } from './db.js';
import { withCap } from './capped.js';

/* The quick tags, in the order the form draws them. The WORDS travel with the
   ids so the tracking page and the website print the same thing; the app has
   its own copy in js/app-i18n-extra.js (rv_tag_*) — keep the ids in step. */
export const TAGS = ['fast', 'driver', 'packed', 'described', 'quality', 'again'];
export const TAG_WORDS = {
  fast:      { ar: 'توصيل سريع',   en: 'Fast delivery' },
  driver:    { ar: 'سائق لطيف',    en: 'Friendly driver' },
  packed:    { ar: 'تغليف ممتاز',  en: 'Well packed' },
  described: { ar: 'مطابق للوصف',  en: 'As described' },
  quality:   { ar: 'جودة ممتازة',  en: 'Great quality' },
  again:     { ar: 'سأطلب مجدداً', en: 'Would order again' }
};
const MAX_COMMENT = 600;

function fail(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

/* "Nour Zahra" → "Nour Z.", "محمد أحمد" → "محمد أ.". The name a public page
   may print about a private person. */
export function publicName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  return w.length > 1 ? `${w[0]} ${w[w.length - 1].charAt(0)}.` : w[0];
}

function tagsOf(raw) {
  try { return (JSON.parse(raw || '[]') || []).filter((t) => TAGS.includes(t)); } catch { return []; }
}

function shape(r) {
  if (!r) return null;
  return {
    saleId: r.sale_id, rating: r.rating, tags: tagsOf(r.tags), comment: r.comment || '',
    allowWeb: !!r.allow_web, onWeb: !!(r.allow_web && r.on_web),
    showName: r.show_name || null, city: r.city || null, method: r.method || null, lang: r.lang || 'ar',
    at: r.at, updatedAt: r.updated_at, webAt: r.web_at || null, webBy: r.web_by || null
  };
}

export function forSale(saleId) {
  return shape(get().prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(String(saleId)));
}

export function canReview(sale) {
  return !!(sale && sale.order && !sale.voided && sale.order.status === 'delivered');
}

/* The customer's own form. `sale` comes from the token, never from the body. */
export function submit(sale, body = {}) {
  if (!canReview(sale)) throw fail('this order cannot be reviewed until it has arrived', 'not_delivered', 409);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail('a rating is one to five stars', 'bad_rating');
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map(String))].filter((t) => TAGS.includes(t));
  const comment = String(body.comment ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_COMMENT) || null;
  const allowWeb = body.allowWeb === true ? 1 : 0;
  const lang = body.lang === 'en' ? 'en' : 'ar';

  return tx((d) => {
    const old = d.prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(sale.id);
    const at = nowIso();
    const same = !!old && old.rating === rating && (old.comment || null) === comment &&
      JSON.stringify(tagsOf(old.tags)) === JSON.stringify(tags);
    /* Rule 3. Still on only if it was on, the customer still allows it, and
       nothing the shop read has changed. */
    const onWeb = old && old.on_web && allowWeb && same ? 1 : 0;

    d.prepare(
      `INSERT INTO order_reviews
         (sale_id, rating, tags, comment, allow_web, on_web, show_name, city, method, lang, at, updated_at, web_by, web_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(sale_id) DO UPDATE SET
         rating = excluded.rating, tags = excluded.tags, comment = excluded.comment,
         allow_web = excluded.allow_web, on_web = excluded.on_web, lang = excluded.lang,
         updated_at = excluded.updated_at, web_by = excluded.web_by, web_at = excluded.web_at`
    ).run(
      sale.id, rating, JSON.stringify(tags), comment, allowWeb, onWeb,
      old ? old.show_name : publicName(sale.customer_name),
      old ? old.city : (sale.order.city || null),
      old ? old.method : (sale.order.method || null),
      lang, old ? old.at : at, at,
      onWeb ? old.web_by : null, onWeb ? old.web_at : null
    );
    logChange('order_reviews', sale.id, old ? 'update' : 'insert', null,
      old ? 'the customer changed their review' : 'the customer reviewed the delivery');

    return {
      review: shape(d.prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(sale.id)),
      first: !old,
      /* Nothing the shop would read is different. `updated_at` moves anyway, so
         a caller that cannot see this would announce an edit that never
         happened — see office-alerts.js. */
      same: !!old && same,
      unpublished: !!(old && old.on_web && !onWeb)
    };
  });
}

/* ---------------------------------------------------------- the office */

export function list({ stars = '', show = '', q = '', limit = 200 } = {}) {
  const where = [], args = [];
  if (stars === 'low') where.push('r.rating <= 2');
  else if (/^[1-5]$/.test(String(stars))) { where.push('r.rating = ?'); args.push(Number(stars)); }
  if (show === 'comment') where.push("COALESCE(TRIM(r.comment), '') <> ''");
  if (show === 'allowed') where.push('r.allow_web = 1');
  if (show === 'web') where.push('r.allow_web = 1 AND r.on_web = 1');
  const text = String(q || '').trim();
  if (text) {
    where.push('(s.id LIKE ? OR s.customer_name LIKE ? OR r.comment LIKE ? OR r.city LIKE ?)');
    const like = `%${text}%`;
    args.push(like, like, like, like);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.max(1, Math.min(500, Number(limit) || 200));
  const from = `FROM order_reviews r
                JOIN sales s ON s.id = r.sale_id
                LEFT JOIN deliveries dl ON dl.sale_id = r.sale_id`;

  const rows = get().prepare(
    `SELECT r.*, s.customer_name, s.customer_id, s.voided,
            dl.company_name, dl.driver_id, du.name AS driver_name, wu.name AS web_by_name
       ${from}
       LEFT JOIN users du ON du.id = dl.driver_id
       LEFT JOIN users wu ON wu.id = r.web_by
       ${w}
      ORDER BY r.updated_at DESC
      LIMIT ?`
  ).all(...args, lim).map((r) => ({
    ...shape(r),
    customerName: r.customer_name || null, customerId: r.customer_id || null, voided: !!r.voided,
    companyName: r.company_name || null, driverId: r.driver_id || null, driverName: r.driver_name || null,
    webByName: r.web_by_name || null
  }));

  return withCap(rows, lim, `SELECT COUNT(*) AS n ${from} ${w}`, ...args);
}

/* For the whole shop, never for the filtered list — the tiles rule. */
export function summary() {
  const d = get();
  const all = d.prepare(
    `SELECT COUNT(*) AS n, AVG(rating) AS avg, COALESCE(SUM(allow_web), 0) AS allowed,
            COALESCE(SUM(CASE WHEN allow_web = 1 AND on_web = 1 THEN 1 ELSE 0 END), 0) AS web,
            COALESCE(SUM(CASE WHEN COALESCE(TRIM(comment), '') <> '' THEN 1 ELSE 0 END), 0) AS worded
       FROM order_reviews`
  ).get();
  const distribution = [0, 0, 0, 0, 0];
  for (const r of d.prepare('SELECT rating, COUNT(*) AS n FROM order_reviews GROUP BY rating').all()) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating - 1] = r.n;
  }
  const tags = Object.fromEntries(TAGS.map((t) => [t, 0]));
  for (const r of d.prepare('SELECT tags FROM order_reviews').all()) {
    for (const t of tagsOf(r.tags)) tags[t]++;
  }
  /* How many could have been reviewed: the share that were is worth knowing. */
  const delivered = d.prepare(
    `SELECT COUNT(*) AS n FROM deliveries dl JOIN sales s ON s.id = dl.sale_id
      WHERE s.payment = 'order' AND s.voided = 0 AND dl.status = 'delivered'`
  ).get().n;
  return {
    count: all.n,
    average: all.n ? Math.round(all.avg * 10) / 10 : null,
    distribution, tags, allowed: all.allowed, onWeb: all.web, worded: all.worded, delivered
  };
}

export function setWeb(saleId, on, user) {
  return tx((d) => {
    const r = d.prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(String(saleId));
    if (!r) throw fail('no such review', 'not_found', 404);
    if (on && !r.allow_web) {
      throw fail('the customer did not allow this review on the website', 'no_permission', 409);
    }
    const at = nowIso();
    d.prepare('UPDATE order_reviews SET on_web = ?, web_by = ?, web_at = ? WHERE sale_id = ?')
      .run(on ? 1 : 0, on ? user.id : null, on ? at : null, r.sale_id);
    logChange('order_reviews', r.sale_id, 'update', user.id, on ? 'shown on the website' : 'taken off the website');
    return shape(d.prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(r.sale_id));
  });
}

/* ------------------------------------------------------------ the website */

export function webList({ limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const pub = `FROM order_reviews r JOIN sales s ON s.id = r.sale_id
               WHERE r.allow_web = 1 AND r.on_web = 1 AND s.voided = 0`;
  const rows = get().prepare(
    `SELECT r.sale_id, r.rating, r.tags, r.comment, r.show_name, r.city, r.lang, r.at, r.web_at
       ${pub} ORDER BY COALESCE(r.web_at, r.at) DESC LIMIT ?`
  ).all(lim);
  const stats = get().prepare(`SELECT COUNT(*) AS n, AVG(r.rating) AS avg ${pub}`).get();
  return {
    reviews: rows.map((r) => ({
      /* Stable across calls and restores, but not the invoice number. */
      id: createHash('sha256').update('og-review:' + r.sale_id).digest('hex').slice(0, 16),
      rating: r.rating,
      tags: tagsOf(r.tags).map((t) => ({ id: t, ar: TAG_WORDS[t].ar, en: TAG_WORDS[t].en })),
      comment: r.comment || '',
      name: r.show_name || null,
      city: r.city || null,
      lang: r.lang || 'ar',
      at: r.at
    })),
    count: stats.n,
    average: stats.n ? Math.round(stats.avg * 10) / 10 : null
  };
}
