/* ==========================================================================
   OG SYSTEM — a night request, as shapes and rules          [request-shape]
   --------------------------------------------------------------------------
   PURE: no database, no network. What lib/requests.js needs to decide that
   can be decided on paper, so a test can hold it without a shop:

     - the six reasons a request is turned down;
     - the MARKER at the front of an order's delivery note ("[req N-0042] "),
       which is how a request already made into an order is recognised on any
       laptop — deliveries.note is mirrored, sales carry no note of their own;
     - what an Accept, a Reject may say;
     - the order a request becomes: the body Orders.create takes, the same one
       POST /api/orders builds — prices are never in it, the server prices
       every line from the product table.
   ========================================================================== */

export const REASONS = ['out_of_stock', 'no_answer', 'customer_cancelled', 'duplicate', 'wrong_details', 'other'];

/* Accept makes the order in one press only where nothing has to be paid
   first: a pickup at the counter, or our own driver, who collects at the
   door. A transport office, a courier or abroad are paid before sending
   (Orders.create refuses 'receipt' for them), so those go through the order
   desk, which knows how to take a payment. */
export const ACCEPT_METHODS = ['pickup', 'driver'];

export const REF = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;
export const SOURCES = ['night', 'web'];

export const marker = (ref) => `[req ${ref}] `;

const fail = (message, code, status, extra) => Object.assign(new Error(message), { code, status }, extra || {});

export function parsePayload(text) {
  try {
    const p = typeof text === 'string' ? JSON.parse(text) : text;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch { return null; }
}

/* How the request asked to travel → how Accept makes it travel by default. */
export const defaultMethod = (payload) =>
  payload && payload.delivery && payload.delivery.method === 'pickup' ? 'pickup' : 'driver';

/* The items a request asks for: [{ sku, qty }], whole numbers only. */
export function items(payload) {
  const out = [];
  for (const i of (payload && Array.isArray(payload.items) ? payload.items : [])) {
    const qty = Number(i && i.qty);
    if (i && typeof i.sku === 'string' && i.sku && Number.isInteger(qty) && qty > 0) out.push({ sku: i.sku, qty });
  }
  return out;
}

/* body → { method, fee, feeMode, whId }, or a refusal the route can send. */
export function checkAccept(body, payload) {
  const b = body && typeof body === 'object' ? body : {};
  const method = b.method === undefined || b.method === null || b.method === '' ? defaultMethod(payload) : b.method;
  if (!ACCEPT_METHODS.includes(method)) {
    throw fail('a transport office, a courier or abroad is paid before sending — open it in the order desk', 'bad_method', 400);
  }
  let fee = null;
  if (b.fee !== undefined && b.fee !== null && b.fee !== '') {
    fee = Number(b.fee);
    if (!Number.isInteger(fee) || fee < 0) throw fail('the shipping fee is a whole amount, not negative', 'bad_fee', 400);
  }
  const feeMode = ['invoice', 'courier', 'none'].includes(b.feeMode) ? b.feeMode : null;
  const whId = typeof b.whId === 'string' && /^[a-z0-9_-]{1,32}$/i.test(b.whId) ? b.whId : null;
  return { method, fee: method === 'pickup' ? null : fee, feeMode: method === 'pickup' ? null : feeMode, whId };
}

/* body → { code, note }. */
export function checkReject(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!REASONS.includes(b.code)) throw fail('say why: one of ' + REASONS.join(', '), 'bad_code', 400);
  const note = String(b.note == null ? '' : b.note)
    .replace(/\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
  if (note.length > 200) throw fail('the note is 200 characters at most', 'bad_note', 400);
  return { code: b.code, note: note || null };
}

/* The country a parcel goes to: the request's own, else Syria when the shop
   sends there, else the first country it sends to. The desk's rule: the
   country is only ever a question when the parcel leaves the country. */
export function countryFor(asked, countries) {
  const live = (Array.isArray(countries) ? countries : []).filter((c) => c && c.id && c.active !== false);
  const want = String(asked || '').trim().toUpperCase();
  if (want && live.some((c) => c.id === want)) return want;
  if (live.some((c) => c.id === 'SY')) return 'SY';
  return live.length ? live[0].id : null;
}

/* The order a request becomes: exactly the arguments Orders.create takes. */
export function orderBody({ ref, source, payload, customerId, method, fee, feeMode, whId, packFrom, countries, userId }) {
  const d = (payload && payload.delivery) || {};
  const c = (payload && payload.customer) || {};
  const pickup = method === 'pickup';
  return {
    lines: items(payload),
    whId: whId || packFrom || null,
    customerId,
    currency: null,
    discount: 0,
    channel: source === 'web' ? 'web' : 'other',
    note: (marker(ref) + String((payload && payload.note) || '')).trim().slice(0, 500),
    dest: pickup ? {} : {
      country: countryFor(d.country, countries),
      city: String(d.city || '').trim(),
      address: String(d.address || '').trim(),
      phone: String(c.phone || '').trim()
    },
    method,
    companyId: null,
    driverId: null,
    trackingNo: null,
    feeMode: pickup ? null : (feeMode || null),
    fee: pickup ? null : (fee === undefined ? null : fee),
    plan: 'receipt',
    payments: [],
    userId,
    unlimitedDiscount: false,
    opId: 'req:' + ref
  };
}

/* One collected item from requests_take → the row this laptop keeps, or null
   when it is not something this code can read (it stays in the cloud). */
export function fromCloud(item) {
  if (!item || typeof item !== 'object') return null;
  if (!REF.test(String(item.ref || '')) || !SOURCES.includes(item.source)) return null;
  const payload = parsePayload(item.payload);
  if (!payload || payload.v !== 1 || !items(payload).length) return null;
  const revision = Number(item.revision);
  return {
    ref: item.ref, source: item.source, revision: Number.isInteger(revision) && revision > 0 ? revision : 1,
    payload, byUser: typeof item.byUser === 'string' ? item.byUser.slice(0, 64) : null,
    askedAt: typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))
      ? new Date(item.createdAt).toISOString() : null
  };
}

/* What this laptop tells the cloud about one of its rows. */
export function markFor(row) {
  if (row.state === 'accepted') return { ref: row.ref, state: 'accepted', saleId: row.sale_id };
  if (row.state === 'rejected') return { ref: row.ref, state: 'rejected', code: row.code || 'other', note: row.reason || null };
  return { ref: row.ref, state: 'received', revision: row.revision };
}

/* The state the cloud should hold once it has heard this row. */
export const cloudState = (row) => (row.state === 'waiting' ? 'received' : row.state);
