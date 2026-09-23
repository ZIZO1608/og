/* ==========================================================================
   A night request, checked before it is sent.            [night-validate.js]
   --------------------------------------------------------------------------
   PURE — nothing here does I/O. The SAME rules as erp.request_submit
   (server/supabase/035_night_requests.sql), restated so the form can say
   what is wrong under the field that is wrong, before a slow line carries it
   anywhere. THE SQL IS THE ONE THAT DECIDES: a request this file passes can
   still be refused there (an unknown size, a cap), and the page says so.

   One thing happens only here: digits typed on an Arabic phone keypad
   (٠-٩, and the Persian ۰-۹) are folded to 0-9, because the SQL counts ASCII
   digits and a phone number typed in Arabic is still a phone number.
   ========================================================================== */
import { randomBytes } from 'node:crypto';

export const LIMITS = {
  lines: 20, qty: 20, pieces: 60,
  name: [2, 80], phoneRaw: 40, phoneDigits: [7, 15],
  city: [2, 80], address: [3, 300], note: 500
};
export const METHODS = ['pickup', 'delivery'];
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/* ٠-٩ (U+0660…) and ۰-۹ (U+06F0…) → 0-9. */
export function foldDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}

/* inbox.req_line: every control character a space, runs of spaces one, trimmed. */
export function line(s) {
  // eslint-disable-next-line no-control-regex
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/* inbox.req_block: \r gone, other controls but the newline gone, at most one
   blank line in a row, trimmed. */
export function block(s) {
  return String(s == null ? '' : s)
    .replace(/\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \n]+|[ \n]+$/g, '');
}

export const phoneDigits = (s) => foldDigits(s).replace(/[^0-9]/g, '');

/* A fresh idempotency key for a draft: what erp.request_submit calls p_op. */
export function newOp() { return randomBytes(18).toString('base64url'); }

/* A whole number in [lo, hi] from a form value, or null. */
export function whole(v, lo, hi) {
  const s = foldDigits(String(v == null ? '' : v)).trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
}

/* The draft (lines, customer id) and what the form sent → the request the
   SQL takes, or every field that is wrong: { ok, request } | { ok:false, errors }. */
export function buildRequest({ lines = [], customerId = null, name, phone, method, city, address, note }) {
  const errors = {};

  const nm = line(name);
  if (nm.length < LIMITS.name[0] || nm.length > LIMITS.name[1]) errors.name = 'bad_name';

  const ph = line(foldDigits(phone));
  const dg = phoneDigits(ph);
  if (!ph || ph.length > LIMITS.phoneRaw || dg.length < LIMITS.phoneDigits[0] || dg.length > LIMITS.phoneDigits[1]) {
    errors.phone = 'bad_phone';
  }

  const items = [];
  let pieces = 0;
  const seen = new Set();
  for (const l of Array.isArray(lines) ? lines : []) {
    const qty = Number(l && l.qty);
    if (!l || !SKU.test(String(l.sku || '')) || seen.has(l.sku) || !Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty) {
      errors.items = 'bad_items';
      break;
    }
    seen.add(l.sku);
    pieces += qty;
    items.push({ sku: l.sku, qty });
  }
  if (!items.length && !errors.items) errors.items = 'empty';
  if (items.length > LIMITS.lines || pieces > LIMITS.pieces) errors.items = 'bad_items';

  const m = METHODS.includes(method) ? method : null;
  if (!m) errors.method = 'bad_delivery';
  let ct = null, ad = null;
  if (m === 'delivery') {
    ct = line(city);
    if (ct.length < LIMITS.city[0] || ct.length > LIMITS.city[1]) errors.city = 'bad_city';
    ad = block(address);
    if (ad.length < LIMITS.address[0] || ad.length > LIMITS.address[1]) errors.address = 'bad_address';
  }

  const nt = block(note);
  if (nt.length > LIMITS.note) errors.note = 'bad_note';

  const cid = customerId === null || customerId === undefined || customerId === '' ? null : Number(customerId);
  if (cid !== null && !(Number.isSafeInteger(cid) && cid > 0 && cid < 1e12)) errors.name = errors.name || 'bad_customer';

  if (Object.keys(errors).length) return { ok: false, errors };
  const customer = { name: nm, phone: ph };
  if (cid !== null) customer.id = cid;
  const delivery = m === 'delivery' ? { method: m, city: ct, address: ad } : { method: m };
  return { ok: true, request: { v: 1, customer, items, delivery, note: nt || null } };
}
