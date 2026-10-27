/* ==========================================================================
   OFFERS — a sale made once on its own page and true everywhere   (076)
   --------------------------------------------------------------------------
   The owner asked (27 Oct 2026) for a page where a sale is put on one
   product, a few, a category, a brand or the whole shop, which the website
   shows for marketing and the till and the order desk charge by themselves.

   THREE RULES:

   1. THE RULE IS ONE FILE. js/offermath.js decides what an offer does to a
      price and to a basket; this module reads it from globalThis, the till
      reads it from window. The cloud's web.offer_of() (043) is the third copy,
      for the website's badge only. KEEP IN STEP.

   2. THE PRICE IS PRICED WHERE THE SALE IS WRITTEN. Sales.record asks
      priceLines() inside its own transaction, with the pieces already sold
      under each flash offer counted in that transaction, so two tills cannot
      both sell the last discounted pair.

   3. AN OFFER IS NOT A DISCOUNT. It lowers the line's own unit_price;
      list_price and offer_id say what it was and why. The 10% ceiling, the
      over-cap alert and a return all keep meaning what they meant.
   ========================================================================== */

import '../../js/offermath.js';
import { get, nowIso, tx, logChange } from './db.js';
import * as Live from './live.js';

const M = globalThis.OfferMath;
export { M as math };

const KINDS = ['pct', 'off', 'price', 'bxgy'];
const TARGET_KINDS = ['product', 'category', 'brand'];
const MAX_TARGETS = 300;

function fail(message, code, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

const iso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

function parseTargets(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/* The shape everything outside this file reads — the till, the page, the
   website. Never the note's author or anything about money already made. */
export function publicRow(o) {
  return {
    id: o.id, nameEn: o.name_en, nameAr: o.name_ar, note: o.note || '',
    kind: o.kind, pct: o.pct, amount: o.amount, buyQty: o.buy_qty, getQty: o.get_qty,
    scope: o.scope, targets: parseTargets(o.targets),
    startsAt: o.starts_at, endsAt: o.ends_at, maxUnits: o.max_units,
    stackCoupons: !!o.stack_coupons, active: !!o.active, coverUrl: o.cover_url || null,
    createdAt: o.created_at, updatedAt: o.updated_at
  };
}

/* ------------------------------------------------------------ the check */

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

function cleanTargets(d, list) {
  if (!Array.isArray(list)) throw fail('targets must be a list', 'offer_bad_targets');
  if (list.length > MAX_TARGETS) throw fail(`at most ${MAX_TARGETS} things in one offer`, 'offer_too_many_targets');
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const kind = t && t.kind;
    if (!TARGET_KINDS.includes(kind)) throw fail('a target is a product, a category or a brand', 'offer_bad_targets');
    let ref = String(t.ref ?? '').trim();
    if (!ref) throw fail('a target needs a name', 'offer_bad_targets');
    if (kind === 'product') {
      const id = Number(ref);
      if (!Number.isInteger(id) || !d.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) {
        throw fail(`there is no product ${ref}`, 'offer_bad_product', 400, { ref });
      }
      ref = String(id);
    }
    if (kind === 'category' && !d.prepare('SELECT 1 FROM categories WHERE id = ?').get(ref)) {
      throw fail(`there is no category ${ref}`, 'offer_bad_category', 400, { ref });
    }
    if (kind === 'brand') ref = ref.slice(0, 60);
    const exclude = !!t.exclude;
    const k = kind + ':' + ref.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind, ref, exclude });
  }
  return out;
}

/* b is the page's body; `was` the row being edited (or null). Returns the
   columns to write. Every refusal names the box that causes it. */
function clean(d, b, was) {
  const pick = (k, col) => (k in b ? b[k] : was ? was[col] : undefined);

  const nameEn = String(pick('nameEn', 'name_en') ?? '').trim().slice(0, 80);
  const nameAr = String(pick('nameAr', 'name_ar') ?? '').trim().slice(0, 80);
  if (!nameEn || !nameAr) throw fail('give the offer a name in both languages', 'offer_name');

  const kind = pick('kind', 'kind');
  if (!KINDS.includes(kind)) throw fail('choose what the offer does', 'offer_bad_kind');

  let pct = int(pick('pct', 'pct'));
  let amount = int(pick('amount', 'amount'));
  let buyQty = int(pick('buyQty', 'buy_qty'));
  let getQty = int(pick('getQty', 'get_qty'));
  if (kind === 'pct') {
    if (!(pct >= 1 && pct <= 90)) throw fail('the percentage is from 1 to 90', 'offer_bad_pct');
    amount = null; buyQty = null; getQty = null;
  } else if (kind === 'off' || kind === 'price') {
    if (!(amount > 0 && amount <= 10_000_000)) throw fail('write the amount in dollars', 'offer_bad_amount');
    pct = null; buyQty = null; getQty = null;
  } else {
    if (!(buyQty >= 1 && buyQty <= 20) || !(getQty >= 1 && getQty <= 20)) {
      throw fail('buy and get are whole numbers from 1 to 20', 'offer_bad_bxgy');
    }
    if (pct === null || pct === undefined) pct = 100;
    if (!(pct >= 1 && pct <= 100)) throw fail('the free piece is 1 to 100% off', 'offer_bad_pct');
    amount = null;
  }

  const scope = pick('scope', 'scope') === 'all' ? 'all' : 'pick';
  const targets = 'targets' in b ? cleanTargets(d, b.targets) : parseTargets(was ? was.targets : '[]');
  if (scope === 'pick' && !targets.some((t) => !t.exclude)) {
    throw fail('choose what the offer is on', 'offer_no_targets');
  }

  const startsAt = 'startsAt' in b ? iso(b.startsAt) : was ? was.starts_at : null;
  const endsAt = 'endsAt' in b ? iso(b.endsAt) : was ? was.ends_at : null;
  if (!startsAt) throw fail('say when it starts', 'offer_bad_start');
  if (endsAt === undefined) throw fail('that end date is not a date', 'offer_bad_end');
  if (endsAt && endsAt <= startsAt) throw fail('it has to end after it starts', 'offer_end_before_start');

  let maxUnits = int(pick('maxUnits', 'max_units'));
  if (maxUnits === 0) maxUnits = null;
  if (maxUnits !== null && !(maxUnits > 0 && maxUnits <= 100_000)) throw fail('the piece limit is a whole number', 'offer_bad_max');

  const note = String(pick('note', 'note') ?? '').trim().slice(0, 300) || null;
  const stack = pick('stackCoupons', 'stack_coupons') ? 1 : 0;
  const active = (('active' in b) ? b.active : was ? was.active : 1) ? 1 : 0;

  return {
    name_en: nameEn, name_ar: nameAr, note, kind, pct, amount, buy_qty: buyQty, get_qty: getQty,
    scope, targets: JSON.stringify(targets), starts_at: startsAt, ends_at: endsAt,
    max_units: maxUnits, stack_coupons: stack, active
  };
}

/* ------------------------------------------------------------- writing */

const COLS = ['name_en', 'name_ar', 'note', 'kind', 'pct', 'amount', 'buy_qty', 'get_qty',
  'scope', 'targets', 'starts_at', 'ends_at', 'max_units', 'stack_coupons', 'active'];

export function create(b, userId) {
  const out = tx((d) => {
    const row = clean(d, b || {}, null);
    const at = nowIso();
    const r = d.prepare(
      `INSERT INTO offers (${COLS.join(', ')}, created_at, created_by, updated_at)
       VALUES (${COLS.map(() => '?').join(', ')}, ?, ?, ?)`
    ).run(...COLS.map((c) => row[c]), at, userId ?? null, at);
    const id = Number(r.lastInsertRowid);
    logChange('offers', id, 'insert', userId, null);
    return byId(id, d);
  });
  changed();
  return out;
}

export function update(id, b, userId) {
  const out = tx((d) => {
    const was = d.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id));
    if (!was) throw fail('no such offer', 'not_found', 404);
    const row = clean(d, b || {}, was);
    /* What has been sold under it is history: the deal itself may not change
       once a piece went out at it, only its dates, its limit, its name and
       whether it is on. A different deal is a new offer. */
    const used = soldOf(d, was.id);
    if (used > 0) {
      for (const c of ['kind', 'pct', 'amount', 'buy_qty', 'get_qty']) {
        if ((row[c] ?? null) !== (was[c] ?? null)) {
          throw fail('pieces were already sold at this deal — make a new offer to change it', 'offer_used', 409, { sold: used });
        }
      }
    }
    d.prepare(
      `UPDATE offers SET ${COLS.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`
    ).run(...COLS.map((c) => row[c]), nowIso(), was.id);
    logChange('offers', was.id, 'update', userId, null);
    return byId(was.id, d);
  });
  changed();
  return out;
}

export function setCover(id, url, userId) {
  const out = tx((d) => {
    const was = d.prepare('SELECT id, cover_url FROM offers WHERE id = ?').get(Number(id));
    if (!was) throw fail('no such offer', 'not_found', 404);
    d.prepare('UPDATE offers SET cover_url = ?, updated_at = ? WHERE id = ?').run(url || null, nowIso(), was.id);
    logChange('offers', was.id, 'update', userId, null);
    return { offer: byId(was.id, d), previous: was.cover_url || null };
  });
  changed();
  return out;
}

/* Gone for good only when nothing was ever sold under it; otherwise the
   answer is "switch it off", and it is said. */
export function remove(id, userId) {
  const out = tx((d) => {
    const was = d.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id));
    if (!was) throw fail('no such offer', 'not_found', 404);
    if (soldOf(d, was.id, true) > 0) {
      throw fail('pieces were sold at this offer — switch it off instead', 'offer_used', 409);
    }
    d.prepare('DELETE FROM offers WHERE id = ?').run(was.id);
    logChange('offers', was.id, 'delete', userId, null);
    return { id: was.id, coverUrl: was.cover_url || null };
  });
  changed();
  return out;
}

/* ------------------------------------------------------------- reading */

/* Pieces sold under an offer, on sales that still stand (a void gives them
   back, like a coupon's use). `any` counts voided sales too — for "has this
   ever been used". */
export function soldOf(d, offerId, any = false) {
  return d.prepare(
    `SELECT COALESCE(SUM(i.qty), 0) AS n FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.offer_id = ? ${any ? '' : 'AND s.voided = 0'}`
  ).get(offerId).n;
}

export function soldMap(d = get()) {
  const out = {};
  for (const r of d.prepare(
    `SELECT i.offer_id AS id, SUM(i.qty) AS n FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.offer_id IS NOT NULL AND s.voided = 0 GROUP BY i.offer_id`).all()) out[r.id] = r.n;
  return out;
}

export function byId(id, d = get()) {
  const o = d.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id));
  return o ? publicRow(o) : null;
}

/* Every offer the till may need: switched on and not over (an offer that
   starts tomorrow is sent too, so a till left open overnight starts it by
   itself at midnight). With what is already sold under each. */
export function live(d = get()) {
  const now = nowIso();
  const rows = d.prepare(
    `SELECT * FROM offers WHERE active = 1 AND (ends_at IS NULL OR ends_at > ?)
      ORDER BY starts_at, id`).all(now);
  return { offers: rows.map(publicRow), sold: soldMap(d), at: now };
}

/* The products an offer covers, by id — for the page's count and the
   scoreboard. Small shop: every product, filtered by the one rule. */
function productsOf(d, o) {
  const all = d.prepare('SELECT id, type, brand FROM products WHERE hidden = 0').all();
  return all.filter((p) => M.covers(o, p)).map((p) => p.id);
}

/* The page: every offer, newest first, with its numbers. Money per currency,
   never added together. */
export function list() {
  const d = get();
  const rows = d.prepare('SELECT * FROM offers ORDER BY created_at DESC, id DESC').all();
  const sold = soldMap(d);
  const money = {};
  for (const r of d.prepare(
    `SELECT i.offer_id AS id, s.currency,
            SUM(i.qty * i.unit_price) AS taken,
            SUM(i.qty * (COALESCE(i.list_price, i.unit_price) - i.unit_price)) AS saved,
            COUNT(DISTINCT s.id) AS sales
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.offer_id IS NOT NULL AND s.voided = 0
      GROUP BY i.offer_id, s.currency`).all()) {
    const m = (money[r.id] ??= { taken: {}, saved: {}, sales: 0 });
    m.taken[r.currency] = r.taken;
    m.saved[r.currency] = r.saved;
    m.sales += r.sales;
  }
  const now = Date.now();
  return rows.map((r) => {
    const o = publicRow(r);
    return {
      ...o,
      status: M.status(o, now, sold),
      sold: sold[o.id] || 0,
      left: o.maxUnits ? Math.max(0, o.maxUnits - (sold[o.id] || 0)) : null,
      products: productsOf(d, o).length,
      money: money[o.id] || { taken: {}, saved: {}, sales: 0 }
    };
  });
}

/* ----------------------------------------------------------- the basket */

/* Sales.record's half. `rows` are the basket as the SERVER read it:
   [{ productId, type, brand, list, currency, qty }]. Returns the segments
   per line (js/offermath.js) — read inside the sale's transaction, so the
   flash counts are the ones this sale will be written against. */
export function priceLines(d, rows, at = nowIso()) {
  const now = Date.parse(at);
  const offers = d.prepare(
    `SELECT * FROM offers WHERE active = 1 AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`
  ).all(at, at).map(publicRow);
  if (!offers.length) return { lines: null, byId: {} };
  const byId = {};
  for (const o of offers) byId[o.id] = o;
  return { lines: M.priceBasket(rows, offers, now, soldMap(d)), byId };
}

/* ----------------------------------------------------------- scoreboard */

/* How the offer is doing: pieces, money, and the same number of days just
   before it started on the same products — so "did it work" has an answer.
   Per currency, never added. Days are the shop's (shop.tz_minutes). */
export function score(id) {
  const d = get();
  const r = d.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id));
  if (!r) throw fail('no such offer', 'not_found', 404);
  const o = publicRow(r);
  const start = Date.parse(o.startsAt);
  const end = Math.min(Date.now(), o.endsAt ? Date.parse(o.endsAt) : Infinity);
  const ran = Math.max(0, end - start);
  const ids = productsOf(d, o);
  const empty = { pieces: 0, sales: 0, money: {} };
  const window = (from, to) => {
    if (!ids.length || to <= from) return { ...empty, money: {} };
    const marks = ids.map(() => '?').join(',');
    const rows = d.prepare(
      `SELECT s.currency, SUM(i.qty) AS pieces, SUM(i.qty * i.unit_price) AS money,
              COUNT(DISTINCT s.id) AS sales
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ? AND i.product_id IN (${marks})
        GROUP BY s.currency`).all(new Date(from).toISOString(), new Date(to).toISOString(), ...ids);
    const out = { pieces: 0, sales: 0, money: {} };
    for (const x of rows) { out.pieces += x.pieces; out.sales += x.sales; out.money[x.currency] = x.money; }
    return out;
  };
  const during = window(start, end);
  const before = window(start - ran, start);

  /* Day by day while it ran, for the little bar row on the card. */
  const tz = Number(d.prepare("SELECT value FROM config WHERE key = 'shop.tz_minutes'").get()?.value ?? 180);
  const days = [];
  if (ids.length && ran > 0) {
    const marks = ids.map(() => '?').join(',');
    const rows = d.prepare(
      `SELECT substr(datetime(s.at, ? || ' minutes'), 1, 10) AS day, SUM(i.qty) AS pieces
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ? AND i.product_id IN (${marks})
        GROUP BY day ORDER BY day`).all(String(tz), new Date(start).toISOString(), new Date(end).toISOString(), ...ids);
    for (const x of rows) days.push({ day: x.day, pieces: x.pieces });
  }

  const top = d.prepare(
    `SELECT i.product_id AS id, MAX(i.name) AS name, SUM(i.qty) AS pieces
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.offer_id = ? AND s.voided = 0
      GROUP BY i.product_id ORDER BY pieces DESC LIMIT 5`).all(o.id);

  return { offer: o, products: ids.length, ranMs: ran, during, before, days, top,
    offerPieces: soldOf(d, o.id) };
}

/* ---------------------------------------------------------- suggestions */

/* Stock that is not moving: no sale in `days`, pieces on the shelf, the
   money in it at cost. The page offers to make an offer of them in one tap.
   Same rule as stockwatch's dead_stock, with more rows and the details the
   page draws. */
export function suggest({ days = 60, limit = 40 } = {}) {
  const d = get();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = d.prepare(
    `SELECT p.id, p.name, p.brand, p.type, p.currency, p.selling_price, p.cost_price, p.image_url,
            SUM(COALESCE(st.qty, 0)) AS pieces,
            SUM(COALESCE(st.qty, 0) * COALESCE(p.cost_price, 0)) AS capital,
            (SELECT MAX(s.at) FROM sale_items si JOIN sales s ON s.id = si.sale_id
              WHERE si.product_id = p.id AND s.voided = 0) AS last_sold
       FROM products p
       JOIN variants v ON v.product_id = p.id
       LEFT JOIN stock st ON st.sku = v.sku
      WHERE p.hidden = 0 AND p.demo = 0
        AND NOT EXISTS (
            SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE si.product_id = p.id AND s.voided = 0 AND s.at >= ?)
      GROUP BY p.id
     HAVING pieces > 0
      ORDER BY capital DESC, pieces DESC
      LIMIT ?`).all(since, Math.min(200, Math.max(1, limit)));
  const now = Date.now();
  const lv = live(d);
  return {
    days,
    rows: rows.map((r) => ({
      id: r.id, name: r.name, brand: r.brand, type: r.type, currency: r.currency,
      price: r.selling_price, capital: r.capital, pieces: r.pieces,
      imageUrl: r.image_url || null, lastSold: r.last_sold,
      /* Already on an offer that is live or coming: said, not suggested twice. */
      inOffer: lv.offers.some((o) => M.status(o, now, lv.sold) !== 'off' && M.covers(o, r)) || false
    }))
  };
}

/* -------------------------------------------------------------- website */

/* The `offer` on a product the website shows (KEEP IN STEP with
   web.offer_of() in supabase/043_offers.sql): the best live unit offer with
   its price in both currencies, or a buy-X-get-Y the product is in. Null for
   none. `fx` is Cat.webRate(); `prices` the same two-currency builder. */
export function webOffer(p, fx, prices, state) {
  const now = Date.now();
  const b = M.bestFor(state.offers, { id: p.id, type: p.type, brand: p.brand },
    p.selling_price, p.currency, now, state.sold);
  if (!b) return null;
  const o = b.offer;
  return {
    id: o.id, kind: o.kind,
    name: { en: o.nameEn, ar: o.nameAr },
    pct: o.kind === 'pct' || o.kind === 'bxgy' ? o.pct : null,
    buy: o.kind === 'bxgy' ? o.buyQty : null,
    get: o.kind === 'bxgy' ? o.getQty : null,
    prices: b.price === null ? null : prices({ currency: p.currency, selling_price: b.price }, fx),
    /* Whole per cent off, for the badge ("−25%"). */
    off: b.price === null || !b.list ? null : Math.round((b.list - b.price) * 100 / b.list),
    endsAt: o.endsAt, left: o.maxUnits ? b.left : null,
    stackCoupons: o.stackCoupons
  };
}

/* What webOffer reads, fetched once per catalogue answer. */
export function webState(d = get()) {
  const now = nowIso();
  const offers = d.prepare(
    `SELECT * FROM offers WHERE active = 1 AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`
  ).all(now, now).map(publicRow);
  return { offers, sold: offers.length ? soldMap(d) : {} };
}

/* The website's offers page: live and coming offers, with the product ids
   each one covers among the published ones. */
export function webList(publishedIds) {
  const d = get();
  const now = nowIso();
  const rows = d.prepare(
    `SELECT * FROM offers WHERE active = 1 AND (ends_at IS NULL OR ends_at > ?) ORDER BY starts_at, id`).all(now);
  const sold = soldMap(d);
  const prods = d.prepare(
    'SELECT id, type, brand FROM products WHERE hidden = 0 AND on_web = 1 AND demo = 0').all()
    .filter((p) => !publishedIds || publishedIds.has(p.id));
  const t = Date.now();
  return rows.map(publicRow).map((o) => ({
    id: o.id, kind: o.kind, name: { en: o.nameEn, ar: o.nameAr },
    pct: o.pct, amount: o.amount, buy: o.buyQty, get: o.getQty,
    status: M.status(o, t, sold), startsAt: o.startsAt, endsAt: o.endsAt,
    maxUnits: o.maxUnits, left: o.maxUnits ? Math.max(0, o.maxUnits - (sold[o.id] || 0)) : null,
    stackCoupons: o.stackCoupons, coverUrl: o.coverUrl,
    productIds: prods.filter((p) => M.covers(o, p)).map((p) => p.id)
  })).filter((o) => o.status === 'live' || o.status === 'scheduled' || o.status === 'soldout');
}

/* ------------------------------------------------------------ the clock */

/* An offer starts and ends by the clock, with nobody pressing anything. A
   tick every 20 s notices when the set of live offers moved, and tells every
   open till (so the prices on screen follow) and the website. */
let sig = null;
let timer = null;
let onMove = null;

function liveSig() {
  const d = get();
  const now = Date.now();
  const sold = soldMap(d);
  return d.prepare('SELECT * FROM offers WHERE active = 1').all().map(publicRow)
    .map((o) => o.id + ':' + M.status(o, now, sold)).join(',');
}

function changed() {
  try { Live.notify('og', { offers: true }); } catch { /* no live line in a script */ }
  try { sig = liveSig(); } catch { /* table not there yet */ }
  if (onMove) { try { onMove(); } catch { /* the website hears on its own timer too */ } }
}

export function start({ moved } = {}) {
  onMove = moved || null;
  try { sig = liveSig(); } catch { sig = null; }
  if (timer) return;
  timer = setInterval(() => {
    let next;
    try { next = liveSig(); } catch { return; }
    if (next !== sig) { sig = next; changed(); }
  }, 20_000);
  if (timer.unref) timer.unref();
}

export function stop() { if (timer) { clearInterval(timer); timer = null; } }

/* A sale went through: a flash offer may have just sold out. */
export function afterSale() {
  try {
    const next = liveSig();
    if (next !== sig) { sig = next; changed(); }
  } catch { /* nothing to say */ }
}
