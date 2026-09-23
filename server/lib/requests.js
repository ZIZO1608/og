/* ==========================================================================
   OG SYSTEM — "Waiting for the shop": night requests          [requests.js]
   --------------------------------------------------------------------------
   While the laptop was off or out of reach, staff at /night (og-bridge) left
   REQUESTS in the cloud (035, inbox.requests): a customer, some sizes,
   delivery or pickup. This file brings them here and lets a PERSON decide.

   1. COLLECTED WITH THE INBOX. Inbox.collect() calls collect() every minute
      the mirror is live (and when og-bridge says the road came back). It
      takes what is waiting (requests_take), keeps a copy in shop_requests
      (061, local-only), and tells the cloud "received" — which is what night
      mode shows as "the shop has it". OG_NIGHT_REQUESTS=0 switches it off.
   2. NOTHING IS APPLIED BY ITSELF. accept() makes the order through
      Orders.create — the function POST /api/orders calls — so the stock is
      checked in its transaction, the lines are priced from the product
      table, and the invoice number is the shop's own. reject() records a
      reason. Both are a person pressing a button (routes: delivery.desk).
   3. APPLIED ONCE, three ways: a decision needs the row to be waiting; the
      order carries opId 'req:<ref>' (applied_ops answers a retried accept
      with the first order); and its delivery note starts with the MARKER
      "[req N-0042]" — deliveries.note is mirrored, so on a laptop that took
      the baton a request re-taken from the cloud is recognised as already
      an order, here and in collect(), and never becomes a second one.
   4. THE DECISION GOES BACK. requests_mark after every decision and on every
      collect, until the cloud answers with the same state (reported_at). A
      decision in the cloud is final (035); if the cloud holds a different
      one, that is said loudly and not retried for ever.
   5. collect() NEVER THROWS. The mirror and the till do not wait for this.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as SB from './supabase.js';
import * as Orders from './orders.js';
import * as Customers from './customers.js';
import * as Auth from './auth.js';
import * as Live from './live.js';
import * as Lineage from './lineage.js';
import { normPhone } from './text.js';
import * as Shape from './request-shape.js';

const TAKE = 20;
const MARK = 50;
const DECIDED_SHOWN = 30;

const fail = (message, code, status, extra) => Object.assign(new Error(message), { code, status }, extra || {});
const short = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300);
const defaultRpc = (fn, args) => SB.rpc(fn, args);

/* ------------------------------------------------------------ the marker */

/* A non-voided order already made from this request, on this laptop or on
   the one before it (the marker travels in the mirror with the delivery). */
function markedSale(d, ref) {
  const m = Shape.marker(ref);
  const r = d.prepare(
    `SELECT d.sale_id AS id FROM deliveries d JOIN sales s ON s.id = d.sale_id
      WHERE s.voided = 0 AND substr(d.note, 1, ?) = ?
      ORDER BY s.at LIMIT 1`
  ).get(m.length, m);
  return r ? r.id : null;
}

/* ------------------------------------------------------------ collecting */

function store(d, it) {
  const have = d.prepare('SELECT state, revision FROM shop_requests WHERE ref = ?').get(it.ref);
  if (have) {
    /* A newer revision of something nobody has decided yet (the website may
       add a transfer photo later) replaces the copy; a decision is never
       reopened by the cloud. */
    if (have.state === 'waiting' && it.revision > have.revision) {
      d.prepare('UPDATE shop_requests SET payload = ?, revision = ?, reported_at = NULL WHERE ref = ?')
       .run(JSON.stringify(it.payload), it.revision, it.ref);
    }
    return false;
  }
  const at = nowIso();
  const sale = markedSale(d, it.ref);
  d.prepare(
    `INSERT OR IGNORE INTO shop_requests
       (ref, source, revision, payload, by_user, asked_at, received_at, state, sale_id, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(it.ref, it.source, it.revision, JSON.stringify(it.payload), it.byUser, it.askedAt || at, at,
        sale ? 'accepted' : 'waiting', sale, sale ? at : null);
  return true;
}

/* Tell the cloud what this laptop holds, and note what it confirmed. */
async function report(lineage, rpc, extra = []) {
  const d = get();
  const pending = d.prepare(
    `SELECT * FROM shop_requests WHERE reported_at IS NULL
      ORDER BY CASE state WHEN 'waiting' THEN 1 ELSE 0 END, coalesce(decided_at, received_at) LIMIT ?`
  ).all(MARK);
  const byRef = new Map(pending.map((r) => [r.ref, r]));
  for (const r of extra) if (!byRef.has(r.ref) && byRef.size < MARK) byRef.set(r.ref, r);
  const rows = [...byRef.values()];
  if (!rows.length) return { reported: 0, conflicts: 0 };

  const done = await rpc('requests_mark', { p_lineage: lineage, p_items: rows.map(Shape.markFor) });
  if (!done || done.ok !== true) return { reported: 0, conflicts: 0, unreported: (done && done.code) || 'bad_answer' };

  let reported = 0, conflicts = 0;
  const at = nowIso();
  const seen = d.prepare('UPDATE shop_requests SET reported_at = ? WHERE ref = ?');
  for (const a of Array.isArray(done.items) ? done.items : []) {
    const row = byRef.get(a && a.ref);
    if (!row) continue;
    const want = Shape.cloudState(row);
    if (a.state === want && (want !== 'accepted' || a.saleId === row.sale_id)) {
      seen.run(at, row.ref); reported++;
    } else if (a.state === null || a.state === undefined) {
      /* The cloud has no such request any more: nothing left to tell it. */
      seen.run(at, row.ref);
    } else if (a.state === 'waiting') {
      /* Not taken yet — the next pass says it again. */
    } else if (row.state === 'waiting' && (a.state === 'accepted' || a.state === 'rejected')) {
      /* Decided in the cloud by a laptop that owned the mirror before this
         one. The cloud's decision is final: this copy follows it, and no
         order is made here. */
      d.prepare(
        `UPDATE shop_requests SET state = ?, sale_id = ?, code = ?, decided_at = coalesce(decided_at, ?), reported_at = ?
          WHERE ref = ? AND state = 'waiting'`
      ).run(a.state, a.saleId || null, a.code || null, at, at, row.ref);
      conflicts++;
      console.error(`[${at}] request ${row.ref} was already ${a.state} in the cloud${a.saleId ? ' (' + a.saleId + ')' : ''} — following it`);
    } else {
      /* Two different final decisions. The cloud keeps its own (035), this
         laptop keeps its own, and a person has to look. Said once. */
      seen.run(at, row.ref); conflicts++;
      console.error(`[${at}] request ${row.ref}: this laptop says ${row.state}${row.sale_id ? ' ' + row.sale_id : ''}, ` +
                    `the cloud says ${a.state}${a.saleId ? ' ' + a.saleId : ''} — look at both before doing anything`);
    }
  }
  return { reported, conflicts };
}

async function pass(lineage, rpc) {
  const took = await rpc('requests_take', { p_lineage: lineage, p_limit: TAKE });
  if (!took || took.ok !== true) return { skipped: (took && took.code) || 'bad_answer' };

  const d = get();
  const items = Array.isArray(took.items) ? took.items : [];
  const count = { taken: items.length, stored: 0, unreadable: 0, reported: 0, conflicts: 0 };
  const received = [];
  for (const raw of items) {
    const it = Shape.fromCloud(raw);
    if (!it) { count.unreadable++; continue; }
    try {
      if (store(d, it)) count.stored++;
    } catch (e) {
      console.error(`[${nowIso()}] request ${it.ref} not stored — ${short(e)}`);
      continue;
    }
    const row = d.prepare('SELECT * FROM shop_requests WHERE ref = ?').get(it.ref);
    if (row) received.push(row);
  }
  if (count.stored) {
    try { Live.notify('og', { requests: true }); } catch { /* the screen catches up on load */ }
  }
  try {
    const r = await report(lineage, rpc, received);
    count.reported = r.reported;
    count.conflicts = r.conflicts;
    if (r.unreported) count.unreported = r.unreported;
  } catch (e) {
    /* Stored; the next pass reports it. */
    count.unreported = short(e);
  }
  return count;
}

let busy = false;

/* One pass: { taken, stored, unreadable, reported, conflicts[, unreported] },
   { skipped }, or { error }. */
export async function collect({ lineage, rpc = defaultRpc } = {}) {
  if (process.env.OG_NIGHT_REQUESTS === '0') return { skipped: 'off' };
  if (!lineage) return { skipped: 'no_lineage' };
  if (busy) return { skipped: 'busy' };
  busy = true;
  try {
    return await pass(lineage, rpc);
  } catch (e) {
    return { error: short(e) };
  } finally {
    busy = false;
    if (owed) flushSoon({ rpc: owed });
  }
}

/* After a decision: tell the cloud now rather than at the next minute.
   Best effort, never in the way of the answer the person is waiting for.
   ONE REPORT AT A TIME, AND NONE DROPPED: a decision made while a report is
   already on the wire (two accepts pressed in a row) is OWED, and goes out
   the moment that one lands — skipping it left the second and third
   decisions waiting a whole minute for the next pass (found by roundtrip). */
let owed = null;
export function flushSoon({ rpc = defaultRpc } = {}) {
  if (process.env.OG_NIGHT_REQUESTS === '0') return;
  if (rpc === defaultRpc && !SB.isConfigured()) return;
  if (busy) { owed = rpc; return; }
  owed = null;
  busy = true;
  setImmediate(async () => {
    try {
      const lineage = Lineage.localId({ create: false });
      if (lineage) await report(lineage, rpc);
    } catch (e) {
      console.error(`[${nowIso()}] a decision was not reported yet (the next pass will) — ${short(e)}`);
    } finally {
      busy = false;
      if (owed) flushSoon({ rpc: owed });
    }
  });
}

/* --------------------------------------------------------- the customer */

/* The request's customer, found here: the hinted one while its phone still
   matches, else whoever holds that phone. Never an archived or merged-away
   record. null when nobody here is that person. */
function findCustomer(d, c) {
  const want = normPhone(c && c.phone);
  const hint = Number(c && c.id);
  if (want && Number.isSafeInteger(hint) && hint > 0) {
    const r = d.prepare('SELECT id, name, phone, archived, merged_into FROM customers WHERE id = ?').get(hint);
    if (r && !r.archived && !r.merged_into && normPhone(r.phone) === want) return { id: r.id, name: r.name, phone: r.phone, by: 'hint' };
  }
  if (!want) return null;
  const rows = d.prepare(
    `SELECT id, name, phone FROM customers
      WHERE archived = 0 AND merged_into IS NULL AND phone IS NOT NULL AND phone <> ''
      ORDER BY id`
  ).all();
  for (const r of rows) if (normPhone(r.phone) === want) return { id: r.id, name: r.name, phone: r.phone, by: 'phone' };
  return null;
}

function customerFor(d, payload, user, source) {
  const c = payload.customer || {};
  const found = findCustomer(d, c);
  if (found) return found.id;
  if (!Auth.can(user, 'customer.write')) {
    throw fail('this is a new customer, and your account cannot add customers — ask somebody who can', 'needs_customer_write', 403);
  }
  const dl = payload.delivery || {};
  const made = Customers.create({
    name: c.name, phone: c.phone, city: dl.city || null, address: dl.address || null,
    source: source === 'web' ? 'web' : 'night'
  }, user.id);
  return made.customer.id;
}

/* ------------------------------------------------------------ the lines */

function lineInfo(d, sku) {
  return d.prepare(
    `SELECT v.sku, v.size, p.id, p.name, p.currency, p.selling_price AS price, p.hidden,
            c.name_en AS colour, c.name_ar AS colour_ar,
            (SELECT count(*) FROM product_colours c2 WHERE c2.product_id = p.id) AS colours
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_colours c ON c.id = v.colour_id
      WHERE v.sku = ?`
  ).get(sku);
}

function unknownSkus(d, payload) {
  return Shape.items(payload).filter((i) => {
    const v = lineInfo(d, i.sku);
    return !v || v.hidden;
  }).map((i) => i.sku);
}

/* ---------------------------------------------------------------- shape */

function shape(d, row, s, packFrom, base) {
  const p = Shape.parsePayload(row.payload) || {};
  const c = p.customer || {};
  const dl = p.delivery || {};
  const match = findCustomer(d, c);
  const stockOf = d.prepare('SELECT wh_id, qty FROM stock WHERE sku = ?');
  const asked = new Map((Array.isArray(p.items) ? p.items : []).map((i) => [i && i.sku, i || {}]));
  const lines = Shape.items(p).map((i) => {
    const a = asked.get(i.sku) || {};
    const v = lineInfo(d, i.sku);
    const known = !!v && !v.hidden;
    const byWh = {};
    let total = 0;
    if (v) for (const st of stockOf.all(i.sku)) { byWh[st.wh_id] = st.qty; total += st.qty; }
    const multi = known && v.colours > 1;
    return {
      sku: i.sku, qty: i.qty,
      askedName: a.name || null, askedSize: a.size || null, askedColour: a.colour || null, askedColourAr: a.colourAr || null,
      known,
      name: known ? v.name : null, size: known ? v.size : null,
      colour: multi ? v.colour : null, colourAr: multi ? v.colour_ar : null,
      price: known ? v.price : null, currency: known ? v.currency : null,
      stock: { total, byWh },
      short: (byWh[packFrom] || 0) < i.qty
    };
  });
  let fee = null;
  if (dl.method !== 'pickup' && dl.city) {
    const country = Shape.countryFor(dl.country, s.countries);
    const f = country ? Orders.feeFor(s, { country, city: dl.city, method: 'driver' }, base) : null;
    if (f) fee = { fee: f.fee, feeMode: f.feeMode, currency: base };
  }
  const who = row.decided_by ? d.prepare('SELECT name FROM users WHERE id = ?').get(row.decided_by) : null;
  return {
    ref: row.ref, source: row.source, byUser: row.by_user, askedAt: row.asked_at, receivedAt: row.received_at,
    state: row.state, code: row.code, reason: row.reason, saleId: row.sale_id,
    decidedAt: row.decided_at, decidedByName: who ? who.name : null, reported: !!row.reported_at,
    customer: { name: c.name || '', phone: c.phone || '', hintId: Number(c.id) || null,
                match: match ? { id: match.id, name: match.name, phone: match.phone } : null,
                matchBy: match ? match.by : null },
    delivery: { method: dl.method || 'pickup', city: dl.city || null, address: dl.address || null, country: dl.country || null },
    note: p.note || null,
    lines, packFrom, fee
  };
}

function context(d) {
  const s = Orders.settings(d);
  const base = (d.prepare("SELECT value FROM config WHERE key = 'shop.base_currency'").get() || {}).value || 'SYP';
  return { s, packFrom: s.wh || 'store', base };
}

export function list() {
  const d = get();
  const { s, packFrom, base } = context(d);
  const waiting = d.prepare("SELECT * FROM shop_requests WHERE state = 'waiting' ORDER BY asked_at, ref").all();
  const decided = d.prepare(
    "SELECT * FROM shop_requests WHERE state <> 'waiting' ORDER BY coalesce(decided_at, received_at) DESC, ref DESC LIMIT ?"
  ).all(DECIDED_SHOWN);
  return {
    waiting: waiting.map((r) => shape(d, r, s, packFrom, base)),
    decided: decided.map((r) => shape(d, r, s, packFrom, base)),
    count: waiting.length
  };
}

export function one(ref) {
  const d = get();
  const row = d.prepare('SELECT * FROM shop_requests WHERE ref = ?').get(String(ref));
  if (!row) return null;
  const { s, packFrom, base } = context(d);
  return shape(d, row, s, packFrom, base);
}

/* The row, only while it is waiting: 404, or 409 with what it became. */
function waitingRow(d, ref) {
  const row = d.prepare('SELECT * FROM shop_requests WHERE ref = ?').get(String(ref));
  if (!row) throw fail('no such request', 'not_found', 404);
  if (row.state !== 'waiting') {
    throw fail(`${row.ref} was already ${row.state}${row.sale_id ? ' — ' + row.sale_id : ''}`, 'decided', 409,
               { state: row.state, saleId: row.sale_id });
  }
  return row;
}

/* ------------------------------------------------------------ decisions */

export function markAccepted(ref, saleId, userId) {
  const r = get().prepare(
    `UPDATE shop_requests SET state = 'accepted', sale_id = ?, decided_by = ?, decided_at = ?, reported_at = NULL
      WHERE ref = ? AND state = 'waiting'`
  ).run(saleId, userId ?? null, nowIso(), String(ref));
  if (r.changes) { try { Live.notify('og', { requests: true }); } catch { /* ignore */ } flushSoon(); }
  return r.changes > 0;
}

/* Accept: the request becomes an order through Orders.create. Returns
   { saleId, out } — out is Orders.create's answer, or null when the order
   already existed (the marker) and nothing new was made. */
export function accept(ref, body, user) {
  const d = get();
  const row = waitingRow(d, ref);
  const payload = Shape.parsePayload(row.payload);
  if (!payload) throw fail('this request cannot be read', 'unreadable', 409);
  const chk = Shape.checkAccept(body, payload);

  /* Made into an order already — on this laptop after a crash, or on the one
     that owned the shop before. Take it as accepted; make nothing. */
  const already = markedSale(d, row.ref);
  if (already) {
    markAccepted(row.ref, already, user.id);
    return { saleId: already, out: null };
  }

  const unknown = unknownSkus(d, payload);
  if (unknown.length) {
    throw fail(`no longer sold here: ${unknown.join(', ')}`, 'unknown_sku', 409, { skus: unknown });
  }
  const customerId = customerFor(d, payload, user, row.source);
  const { s, packFrom } = context(d);
  const out = Orders.create(Shape.orderBody({
    ref: row.ref, source: row.source, payload, customerId, method: chk.method, fee: chk.fee, feeMode: chk.feeMode,
    whId: chk.whId, packFrom, countries: s.countries, userId: user.id
  }));
  markAccepted(row.ref, out.sale.id, user.id);
  return { saleId: out.sale.id, out };
}

export function reject(ref, body, user) {
  const d = get();
  const row = waitingRow(d, ref);
  const chk = Shape.checkReject(body);
  const r = d.prepare(
    `UPDATE shop_requests SET state = 'rejected', code = ?, reason = ?, decided_by = ?, decided_at = ?, reported_at = NULL
      WHERE ref = ? AND state = 'waiting'`
  ).run(chk.code, chk.note, user.id, nowIso(), row.ref);
  if (!r.changes) waitingRow(d, ref);
  try { Live.notify('og', { requests: true }); } catch { /* ignore */ }
  flushSoon();
  return one(row.ref);
}

/* "Open in the order desk": the customer found or made, and the desk's draft.
   The desk's own Save makes the order (POST /api/orders with requestRef). */
export function prepare(ref, user) {
  const d = get();
  const row = waitingRow(d, ref);
  const payload = Shape.parsePayload(row.payload);
  if (!payload) throw fail('this request cannot be read', 'unreadable', 409);
  const already = markedSale(d, row.ref);
  if (already) {
    markAccepted(row.ref, already, user.id);
    throw fail(`${row.ref} is already an order — ${already}`, 'decided', 409, { state: 'accepted', saleId: already });
  }
  const unknown = unknownSkus(d, payload);
  if (unknown.length) throw fail(`no longer sold here: ${unknown.join(', ')}`, 'unknown_sku', 409, { skus: unknown });
  const customerId = customerFor(d, payload, user, row.source);
  const { s } = context(d);
  const dl = payload.delivery || {};
  const method = Shape.defaultMethod(payload);
  return {
    ref: row.ref,
    lines: Shape.items(payload),
    customerId,
    method,
    dest: {
      country: Shape.countryFor(dl.country, s.countries),
      city: dl.city || '', address: dl.address || '',
      phone: (payload.customer && payload.customer.phone) || ''
    },
    note: payload.note || ''
  };
}

/* The order desk is about to save an order for this request: it must still be
   waiting, and not already an order. Returns the marker for the note. */
export function forOrder(ref) {
  const d = get();
  const row = waitingRow(d, ref);
  const already = markedSale(d, row.ref);
  if (already) {
    throw fail(`${row.ref} is already an order — ${already}`, 'decided', 409, { state: 'accepted', saleId: already });
  }
  return Shape.marker(row.ref);
}

/* For the bell: how many are waiting, and the newest. */
export function waiting() {
  const d = get();
  const n = d.prepare("SELECT count(*) AS n FROM shop_requests WHERE state = 'waiting'").get().n;
  const newest = n ? d.prepare("SELECT ref FROM shop_requests WHERE state = 'waiting' ORDER BY asked_at DESC, ref DESC LIMIT 1").get().ref : null;
  return { n, newest };
}

/* Has this opId already made something? (A retried desk Save for a request
   that its first Save already made into an order.) */
export function appliedOp(opId) {
  return !!get().prepare('SELECT 1 FROM applied_ops WHERE op_id = ?').get(String(opId));
}
