/* ==========================================================================
   Telling the website an order was accepted or rejected   [weborder-site.js]
   --------------------------------------------------------------------------
   The owner (16 Oct 2026): when the shop presses Accept on a website order,
   the order on the website must turn CONFIRMED and the customer must be
   notified — not whenever the website next happens to ask.

   The decision already reaches the cloud (weborders.js → web_orders_mark),
   which is what the website's own order page reads (web_order_status). So
   the call waits for THAT, and only then:

     POST <web.site_url>/api/og/order-changed
     Authorization: Bearer <OG_WEB_API_KEY>
     { event, ref, state, code, saleId, trackUrl, total, decidedAt, message }

   The website reloads that order from web_order_status (the cloud is the
   truth; this call is a nudge with enough in it to word a notification) and
   tells its customer — a push, an email, a banner, whatever it has. The
   contract is docs/website/PROMPT-FOR-AHMAD.md §7a.

   Called from the web-orders pass (sync-worker's minute, and webSoon() 0.4 s
   after a decision), which is one pass at a time and only while the mirror is
   live — so this is single-flight by construction, runs on the one main
   server only, and never on a standby.

   NO CUSTOMER NAME OR PHONE IN THE CALL: the website already has the order
   under its ref; a body that carried them would be a second copy of a
   stranger's details in somebody else's logs.

   Failures back off 30 s → 2 min → 5 min → 15 min → 1 h and then stop, with
   the reason on the card and a "Tell the website again" button that starts
   a fresh round. A wrong key, a 404 (the website has not built the door
   yet) and a redirect are not retried by themselves — waiting changes
   nothing — and a redirect is never followed, because it would carry the key.
   Decisions older than two days are never announced by themselves: a site switched on
   today must not buzz last month's customers.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as Site from './sitenotify.js';
import * as Orders from './orders.js';
import { maybe } from './env.js';

export const PATH = '/api/og/order-changed';
export const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
export const MAX_TRIES = BACKOFF_MS.length;
const FRESH_DAYS = 2;
const BATCH = 10;

/* The reason words, in the website's two languages — the same codes
   REJECT_CODES has and the contract's §7 table words. */
const WHY = {
  no_answer:          ['ما قدرنا نوصلك على الهاتف', 'we could not reach you by phone'],
  out_of_stock:       ['القطعة خلصت من عنا', 'the item is out of stock'],
  customer_cancelled: ['ألغيت الطلب', 'you cancelled the order'],
  unpaid:             ['ما وصلنا الدفع', 'the payment did not reach us'],
  duplicate:          ['الطلب مكرّر', 'the order was a duplicate'],
  test:               ['طلب تجريبي', 'it was a test order'],
  bad_print:          ['الطباعة المطلوبة ما بتنعمل متل ما انكتبت', 'the print could not be made as written'],
  other:              ['تواصل معنا لنعرف السبب', 'please contact us to find out why']
};

/* Not the website's address and key: nothing to tell, and the card says so. */
export function readiness() {
  const keySet = !!maybe('OG_WEB_API_KEY');
  const site = Site.site();
  return { configured: !!(site && keySet), why: !keySet ? 'no_key' : !site ? 'no_site' : null };
}

function minorExp(d, code) {
  const r = d.prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  return r ? Number(r.minor_exp) || 0 : (code === 'USD' ? 2 : 0);
}

function fmt(amount, currency, exp) {
  const v = Number(amount) / Math.pow(10, exp);
  const num = v.toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp });
  return currency === 'USD' ? '$' + num : num + ' ' + currency;
}

/* What the website is told about one row. Exported for the card's preview
   and the tests: one shape, one set of words. */
export function payloadFor(row, d = get()) {
  const shop = (() => {
    const r = d.prepare("SELECT value FROM config WHERE key = 'shop.name'").get();
    return (r && String(r.value || '').trim()) || 'OG Sports';
  })();
  const ref = row.ref;
  if (row.state === 'accepted') {
    const sale = row.sale_id
      ? d.prepare('SELECT id, total, currency, public_token FROM sales WHERE id = ?').get(row.sale_id) : null;
    const base = Orders.publicBase(d);
    const exp = sale ? minorExp(d, sale.currency) : 0;
    const total = sale ? { amount: sale.total, currency: sale.currency, minorExp: exp } : null;
    const money = total ? fmt(total.amount, total.currency, exp) : null;
    /* An isolate round the money, or Arabic drags the $ to the far side. */
    const arMoney = money ? ' · المجموع ⁦' + money + '⁩' : '';
    return {
      event: 'order_changed', ref, state: 'accepted', code: null,
      saleId: row.sale_id || null,
      trackUrl: sale && sale.public_token && base ? `${base}/i/${sale.public_token}` : null,
      total, decidedAt: row.decided_at,
      message: {
        title: { ar: 'تأكّد طلبك ✔', en: 'Your order is confirmed ✔' },
        body: {
          ar: `${shop} قبل طلبك ⁦${ref}⁩${arMoney}. رح نتواصل معك للتوصيل — فيك تتابع طلبك خطوة بخطوة.`,
          en: `${shop} accepted your order ${ref}${money ? ' · total ' + money : ''}. We'll be in touch about delivery — follow it step by step.`
        }
      }
    };
  }
  const why = WHY[row.reject_code] || WHY.other;
  return {
    event: 'order_changed', ref, state: 'rejected', code: row.reject_code || 'other',
    saleId: null, trackUrl: null, total: null, decidedAt: row.decided_at,
    message: {
      title: { ar: 'ما قدرنا نكمّل طلبك', en: 'We could not go ahead with your order' },
      body: {
        ar: `طلبك ⁦${ref}⁩ ما انقبل: ${why[0]}. إذا عندك سؤال، راسلنا.`,
        en: `Your order ${ref} was not accepted: ${why[1]}. Message us if you have a question.`
      }
    }
  };
}

/* One round: every decided order the cloud already has and the website has
   not, oldest first. Answers { sent, failed, skipped? }. */
export async function tell({ now = Date.now() } = {}) {
  const ready = readiness();
  if (!ready.configured) return { sent: 0, failed: 0, skipped: ready.why };
  const d = get();
  const since = new Date(now - FRESH_DAYS * 86400000).toISOString();
  const rows = d.prepare(
    `SELECT * FROM web_orders
      WHERE state IN ('accepted', 'rejected')
        AND cloud_state = state
        AND (site_state IS NULL OR site_state <> state)
        AND site_tries < ?
        AND (site_next_at IS NULL OR site_next_at <= ?)
        AND (decided_at >= ? OR site_next_at IS NOT NULL)
      ORDER BY decided_at LIMIT ?`
  ).all(MAX_TRIES, new Date(now).toISOString(), since, BATCH);
  const out = { sent: 0, failed: 0 };
  if (!rows.length) return out;

  const base = Site.site();
  const secret = maybe('OG_WEB_API_KEY');
  const ok = d.prepare(
    'UPDATE web_orders SET site_state = ?, site_at = ?, site_error = NULL, site_tries = 0, site_next_at = NULL WHERE ref = ? AND state = ?'
  );
  const bad = d.prepare('UPDATE web_orders SET site_error = ?, site_tries = ?, site_next_at = ? WHERE ref = ?');
  for (const row of rows) {
    let r;
    try { r = await Site.post(base, secret, payloadFor(row, d), PATH); }
    catch (e) { r = { ok: false, code: 'failed', retry: true }; }
    if (r.ok) {
      ok.run(row.state, nowIso(), row.ref, row.state);
      out.sent++;
      continue;
    }
    out.failed++;
    const tries = r.retry ? row.site_tries + 1 : MAX_TRIES;
    const next = tries < MAX_TRIES ? new Date(now + BACKOFF_MS[tries - 1]).toISOString() : null;
    bad.run(r.code + (r.status ? ':' + r.status : ''), tries, next, row.ref);
    /* The site is down: the rest of the batch would only fail the same way. */
    if (r.code === 'unreachable' || r.code === 'timeout') break;
  }
  return out;
}

/* "Tell the website again": a fresh round for one order. The pass that
   follows (webSoon) makes the call. */
export function again(ref) {
  const d = get();
  const row = d.prepare('SELECT state FROM web_orders WHERE ref = ?').get(String(ref || ''));
  if (!row) throw Object.assign(new Error('no such website order'), { code: 'not_found', status: 404 });
  if (row.state === 'new') throw Object.assign(new Error('nothing has been decided yet'), { code: 'not_decided', status: 409 });
  /* site_next_at set is also what lets an order older than two days go:
     a person asked for it by name. */
  d.prepare(
    'UPDATE web_orders SET site_state = NULL, site_tries = 0, site_next_at = ?, site_error = NULL WHERE ref = ?'
  ).run(nowIso(), String(ref));
  return { ref, again: true };
}
