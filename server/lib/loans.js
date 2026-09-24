/* ==========================================================================
   OG SYSTEM — invoice numbers lent in advance                     [loans.js]
   --------------------------------------------------------------------------
   The owner's choice for selling offline (24 Sep 2026): real invoice numbers,
   lent to the shop laptop by the main server BEFORE the line drops, so the
   receipt printed at the counter while the internet is down carries the
   number that sale keeps for ever. Migration 065 says why a lent number and
   not a second numbering.

   Three rules, one per machine:

     the lender (the main server) lends a fresh block whenever the laptop
       holds fewer than LEND_MIN unused numbers — at the copy door, inside the
       snapshot the laptop is about to receive (topUp);
     the lender's own numbering steps over every lent block (skipLent);
     the borrower (the laptop, offline) sells on the lowest unused number of
       its own blocks and on nothing else (nextLent) — no number means no
       offline sale, said in words, never a number made up locally.

   A lent number is USED when a sale with that id exists. Nothing else is
   stored: which numbers are used is read off `sales`, on both machines, the
   same way nextInvoiceId has always read its own.
   ========================================================================== */
import { get, nowIso } from './db.js';

const PREFIX = 'INV';
/* Top up below this many unused numbers; lend this many at a time. An hour
   offline at a busy counter is thirty or forty sales. */
const LEND_MIN = () => Math.max(1, Number(process.env.OG_LEND_MIN) || 50);
const LEND_BLOCK = () => Math.max(1, Number(process.env.OG_LEND_BLOCK) || 150);

export const validHolder = (h) => typeof h === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(h);

const invNo = (id) => {
  const m = /^INV-(\d+)$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
};

/* The highest number used inside [lo, hi], or null. */
function usedTop(d, lo, hi) {
  const r = d.prepare(
    `SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM sales
      WHERE id LIKE 'INV-%' AND CAST(SUBSTR(id, 5) AS INTEGER) BETWEEN ? AND ?`
  ).get(lo, hi);
  return r && r.n != null ? Number(r.n) : null;
}

function blocksOf(d, holder) {
  return d.prepare('SELECT lo, hi, lent_at FROM id_loans WHERE prefix = ? AND holder = ? ORDER BY lo')
    .all(PREFIX, holder);
}

/* Numbers still free in a holder's blocks. Used numbers are taken from the
   top, so everything above the highest used one is free. */
export function unused(d, holder) {
  let n = 0;
  for (const b of blocksOf(d, holder)) {
    const top = usedTop(d, b.lo, b.hi);
    n += b.hi - (top == null ? b.lo - 1 : top);
  }
  return n;
}

/* The LENDER. Called inside a transaction by the copy door. */
export function topUp(d, holder) {
  if (!validHolder(holder)) return { lent: null, unused: 0 };
  const have = unused(d, holder);
  if (have >= LEND_MIN()) return { lent: null, unused: have };
  const maxSale = d.prepare(
    `SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM sales WHERE id LIKE 'INV-%'`).get().n || 2100;
  const maxLent = d.prepare('SELECT MAX(hi) AS n FROM id_loans WHERE prefix = ?').get(PREFIX).n || 0;
  const lo = Math.max(Number(maxSale), Number(maxLent)) + 1;
  const hi = lo + LEND_BLOCK() - 1;
  d.prepare('INSERT INTO id_loans (prefix, lo, hi, holder, lent_at) VALUES (?, ?, ?, ?, ?)')
    .run(PREFIX, lo, hi, holder, nowIso());
  return { lent: { lo, hi }, unused: have + (hi - lo + 1) };
}

/* The lender's own next number, stepping over every lent block. `n` is what
   MAX+1 would have given. */
export function skipLent(d, n) {
  for (let guard = 0; guard < 1000; guard++) {
    const b = d.prepare('SELECT hi FROM id_loans WHERE prefix = ? AND ? BETWEEN lo AND hi').get(PREFIX, n);
    if (!b) return n;
    n = Number(b.hi) + 1;
  }
  return n;
}

/* The BORROWER, offline: the lowest free number in its own blocks, or null. */
export function nextLent(d, holder) {
  for (const b of blocksOf(d, holder)) {
    const top = usedTop(d, b.lo, b.hi);
    const next = top == null ? b.lo : top + 1;
    if (next <= b.hi) return next;
  }
  return null;
}

/* The LENDER again, taking a replayed sale: is this number really one it lent
   to this holder, and still unused? Returns the loan, or throws with a code. */
export function checkLent(d, holder, id) {
  const n = invNo(id);
  const b = n == null ? null
    : d.prepare('SELECT lo, hi, holder, lent_at FROM id_loans WHERE prefix = ? AND ? BETWEEN lo AND hi').get(PREFIX, n);
  if (!b || b.holder !== holder) {
    const e = new Error(`${id} was not lent to ${holder}.`);
    e.code = 'bad_lent_id';
    throw e;
  }
  if (d.prepare('SELECT 1 FROM sales WHERE id = ?').get(id)) {
    const e = new Error(`${id} is already a sale here.`);
    e.code = 'lent_taken';
    throw e;
  }
  return b;
}

/* What a standby says it is, recorded by the copy door. */
export function noteStandby(d, holder, urls) {
  if (!validHolder(holder)) return;
  const clean = (Array.isArray(urls) ? urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\/[\w.:[\]-]+\/?$/.test(u)).slice(0, 6);
  d.prepare(
    `INSERT INTO standby_seen (holder, urls, seen_at) VALUES (?, ?, ?)
     ON CONFLICT(holder) DO UPDATE SET urls = excluded.urls, seen_at = excluded.seen_at`
  ).run(holder, JSON.stringify(clean), nowIso());
}

/* For the domain's page: where the shop laptop answers, seen in the last
   week. A laptop not heard from in a week is not a place to send anybody. */
export function standbys(d = get()) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  return d.prepare('SELECT holder, urls, seen_at FROM standby_seen WHERE seen_at >= ? ORDER BY seen_at DESC')
    .all(since)
    .map((r) => {
      let urls = [];
      try { urls = JSON.parse(r.urls || '[]'); } catch { urls = []; }
      return { name: r.holder, urls, seenAt: r.seen_at };
    });
}
