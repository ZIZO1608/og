/* ==========================================================================
   OG SYSTEM — receipts that wait for the shop's printer   [receipt-queue.js]
   --------------------------------------------------------------------------
   With receipt.transport = 'agent' (migration 064) the till's rendered bytes
   are queued for a STATION instead of being sent to a printer this server
   can reach — because once the VPS is the main server, it cannot reach a USB
   printer in Aleppo. agent/print-agent.js on the shop's laptop long-polls
   GET /api/receipts/next, prints with `copy /b`, and reports done or failed.

   Claim / lease / complete, as the label queue does it (lib/labels.js says
   why a lease and a claim token rather than a ledger). Two receipt-only
   rules:

     - A receipt is for somebody at the counter. One not printed within
       receipt.agent_expire_minutes (10) is EXPIRED, never printed late.
     - The till is told whether the agent has been heard from. A receipt
       queued for a station whose agent went quiet a minute ago will not come
       out, and the cashier should know that now, not when the customer asks.
   ========================================================================== */
import { randomBytes } from 'node:crypto';
import { get, tx, nowIso } from './db.js';

const LONGPOLL_WAIT_MS = 25000;
const POLL_MS = 400;
/* The agent asks again straight after every answer, so a station not heard
   from for this long has no agent running. */
const QUIET_MS = 60000;

/* station -> last time its agent asked, in this process. In memory on
   purpose: it is a fact about the agent that is connected NOW. */
const heard = new Map();

function cfg(key, fallback) {
  const r = get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r && r.value !== '' ? r.value : fallback;
}
export const station = () => String(cfg('receipt.station', 'shop'));
const expireMinutes = () => Math.max(1, Number(cfg('receipt.agent_expire_minutes', 10)) || 10);
const leaseMinutes = () => Math.max(1, Number(cfg('receipt.agent_lease_minutes', 2)) || 2);

/* { seen, ageMs } for the till's answer and the panel. */
export function agent(st = station()) {
  const at = heard.get(st);
  return at ? { seen: true, ageMs: Date.now() - at, here: Date.now() - at < QUIET_MS } : { seen: false, ageMs: null, here: false };
}

export function enqueue({ saleId, kind, copies, bytesB64, userId }) {
  const info = get().prepare(
    `INSERT INTO receipt_jobs (station, sale_id, kind, copies, bytes_b64, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(station(), saleId || null, kind || 'sale', Number(copies) || 1, bytesB64, nowIso(), userId ?? null);
  return Number(info.lastInsertRowid);
}

function claimOne(st) {
  const now = new Date();
  const nowS = now.toISOString();
  const stale = new Date(now.getTime() - expireMinutes() * 60000).toISOString();
  return tx((d) => {
    /* A lease that ran out goes back to the queue… */
    d.prepare(
      `UPDATE receipt_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL
        WHERE status = 'claimed' AND lease_expires_at < ?`
    ).run(nowS);
    /* …unless the customer has long gone: those are expired, not printed,
       and the print history says so. */
    const gone = d.prepare(
      `SELECT * FROM receipt_jobs WHERE status = 'pending' AND created_at < ?`
    ).all(stale);
    for (const j of gone) {
      d.prepare(`UPDATE receipt_jobs SET status = 'expired', done_at = ? WHERE id = ?`).run(nowS, j.id);
      logPrint(d, j, 'failed', 'not printed within ' + expireMinutes() + ' minutes — the shop\'s print agent was not connected');
    }

    const row = d.prepare(
      `SELECT id FROM receipt_jobs WHERE station = ? AND status = 'pending' ORDER BY id LIMIT 1`
    ).get(st);
    if (!row) return null;
    const token = randomBytes(12).toString('hex');
    const until = new Date(now.getTime() + leaseMinutes() * 60000).toISOString();
    d.prepare(
      `UPDATE receipt_jobs SET status = 'claimed', claim_token = ?, claimed_at = ?, lease_expires_at = ?
        WHERE id = ? AND status = 'pending'`
    ).run(token, nowS, until, row.id);
    return d.prepare('SELECT * FROM receipt_jobs WHERE id = ?').get(row.id);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The agent's long-poll. Every call counts as hearing from its station. */
export async function next({ station: st, waitMs = LONGPOLL_WAIT_MS }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    heard.set(st, Date.now());
    const job = claimOne(st);
    if (job) return { id: job.id, claimToken: job.claim_token, saleId: job.sale_id, kind: job.kind, bytesB64: job.bytes_b64 };
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(POLL_MS, left));
  }
}

/* The print history (print_log, mirrored) is written when the paper did or
   did not come out — not when the job was queued, which proves nothing. */
function logPrint(d, job, status, error) {
  /* print_log.sale_id is a foreign key: a job for a sale that is not (or no
     longer) there is simply not logged, rather than failing the report. */
  if (!job.sale_id || !d.prepare('SELECT 1 FROM sales WHERE id = ?').get(job.sale_id)) return;
  d.prepare(
    `INSERT INTO print_log (sale_id, user_id, copies, kind, status, error, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(job.sale_id, job.created_by ?? null, job.copies || 1, job.kind || 'sale', status, error ?? null, nowIso());
}

/* A stale or wrong-token completion is a no-op, never a corruption of a
   later claim — the WHERE clause is the whole guard. */
export function complete(id, claimToken, outcome, error) {
  return tx((d) => {
    const info = d.prepare(
      `UPDATE receipt_jobs SET status = ?, error = ?, done_at = ?
        WHERE id = ? AND claim_token = ? AND status = 'claimed'`
    ).run(outcome, error ?? null, nowIso(), id, claimToken);
    if (!info.changes) return { ok: false, stale: true };
    logPrint(d, d.prepare('SELECT * FROM receipt_jobs WHERE id = ?').get(id),
      outcome === 'done' ? 'sent' : 'failed', error);
    return { ok: true };
  });
}

/* What became of one job — for a till that wants to say "printed". */
export function jobState(id) {
  const r = get().prepare('SELECT id, status, error, created_at, done_at FROM receipt_jobs WHERE id = ?').get(id);
  return r || null;
}
