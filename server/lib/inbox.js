/* ==========================================================================
   OG SYSTEM — what the public tracking page left for the shop     [inbox.js]
   --------------------------------------------------------------------------
   og-track (a separate project, on Railway) answers the tracking link while
   this laptop is shut. A customer's review and "Notify me" cannot reach
   SQLite from there, so it queues them in Supabase (inbox.items, og-track's
   sql/002_inbox.sql) and this file collects them whenever the mirror is live:
   lib/sync-worker.js calls collect() after the boot run and every minute.

   Rules this file keeps:

   1. THE SHOP'S OWN CODE DECIDES. Every item goes through exactly the call
      the POS's own route makes — Reviews.submit, Tracking.followOrder and
      unfollowOrder — with the sale looked up here from the sale id the inbox
      took from the token. Nothing is trusted because og-track or the
      database checked it first. Kind 'tg' (og-track's sql/004) is the shop's
      Telegram bot answered on Railway: a chat linking itself or muting its
      reminders, applied by Telegram.relay() exactly as the long poll would.
   2. ONLY THE LAPTOP THAT OWNS THE MIRROR COLLECTS. track.inbox_take and
      track.inbox_done refuse any lineage id but the one in sync_state, so a
      development copy holding the service key collects nothing.
   3. APPLIED ONCE. What was decided is recorded in inbox_applied (migration
      050) before it is reported, so a report lost to a dropped line is sent
      again on the next pass, not applied again. tx() cannot nest and
      Reviews.submit opens its own, so the record follows that commit rather
      than sharing it: a crash in that instant applies one item twice — the
      same review again, or a follow that is already there, which greets
      nobody a second time (Tracking.followOrder).
   4. A REFUSAL IS AN ANSWER, A FAILURE IS NOT. The POS's own refusals carry a
      code and a 4xx status (not_delivered, voided, bad_subscription …) and
      are reported as rejected with that code. Anything else — a locked
      database, a bug — leaves the item pending for the next pass.
   5. NEVER THROWS. The mirror and the till do not wait for this.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as SB from './supabase.js';
import * as Receipt from './receipt.js';
import * as Reviews from './reviews.js';
import * as Tracking from './tracking.js';
import * as Live from './live.js';
import * as Telegram from './telegram.js';

const BATCH = 50;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const refusal = (e) =>
  !!e && typeof e.code === 'string' && Number.isInteger(e.status) && e.status >= 400 && e.status < 500;

/* One item through the shop's own code: { outcome, code }, or null when it
   must stay pending. */
async function apply(item) {
  const p = item.payload && typeof item.payload === 'object' ? item.payload : {};
  if (p.v !== 1) return { outcome: 'rejected', code: 'unsupported' };
  if (item.kind === 'tg') {
    try {
      return await Telegram.relay(p, { createdAt: item.created_at });
    } catch (e) {
      console.error(`[${nowIso()}] inbox item ${item.id} (tg) left pending — ${e && e.message}`);
      return null;
    }
  }
  try {
    const sale = Receipt.bySaleId(item.sale_id);
    if (!sale) return { outcome: 'rejected', code: 'not_found' };
    if (item.kind === 'review') {
      /* What POST /i/<token>/review does after the same call. */
      const out = Reviews.submit(sale, p);
      try { Live.notify('og', { reviews: true }); } catch { /* the Reviews page catches up on load */ }
      Tracking.reviewed(sale, out);
    } else if (item.kind === 'push' && p.action === 'follow') {
      Tracking.followOrder(sale, p);
    } else if (item.kind === 'push' && p.action === 'unfollow') {
      Tracking.unfollowOrder(sale, p);
    } else {
      return { outcome: 'rejected', code: 'unsupported' };
    }
    return { outcome: 'applied', code: null };
  } catch (e) {
    if (refusal(e)) return { outcome: 'rejected', code: e.code.slice(0, 60) };
    console.error(`[${nowIso()}] inbox item ${item.id} (${item.kind}) left pending — ${e && e.message}`);
    return null;
  }
}

async function pass(lineage) {
  const took = await SB.rpc('inbox_take', { p_lineage: lineage, p_limit: BATCH }, { schema: 'track' });
  if (!took || took.ok !== true) return { skipped: (took && took.code) || 'bad_answer' };

  const d = get();
  const recorded = d.prepare('SELECT outcome, code FROM inbox_applied WHERE item_id = ? AND revision = ?');
  const record = d.prepare(
    `INSERT OR IGNORE INTO inbox_applied (item_id, revision, kind, sale_id, outcome, code, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const items = Array.isArray(took.items) ? took.items : [];
  const count = { taken: items.length, applied: 0, rejected: 0, pending: 0, reported: 0, unreported: null };
  const report = [];

  for (const item of items) {
    const id = Number(item && item.id);
    const revision = Number(item && item.revision);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(revision)) { count.pending++; continue; }
    let out = recorded.get(id, revision);
    if (!out) {
      out = await apply(item);
      if (!out) { count.pending++; continue; }
      /* Already applied, so it is reported whether or not the record lands:
         reporting it now is what stops the next pass applying it again. */
      try {
        record.run(id, revision, String(item.kind || ''), item.sale_id == null ? null : String(item.sale_id),
                   out.outcome, out.code, nowIso());
      } catch (e) {
        console.error(`[${nowIso()}] inbox item ${id} applied but not recorded — ${e.message}`);
      }
      count[out.outcome]++;
    }
    report.push({ id, revision, outcome: out.outcome, code: out.code || null });
  }

  if (report.length) {
    let done = null;
    try {
      done = await SB.rpc('inbox_done', { p_lineage: lineage, p_items: report }, { schema: 'track' });
    } catch (e) {
      /* Recorded, so the next pass reports it without applying it again. */
      count.unreported = e.message;
    }
    if (done && done.ok === true) {
      count.reported = report.length;
      /* Bookkeeping only: a mark that does not land is a report sent twice. */
      try {
        const mark = d.prepare('UPDATE inbox_applied SET reported_at = ? WHERE item_id = ? AND revision = ?');
        const at = nowIso();
        for (const r of report) mark.run(at, r.id, r.revision);
      } catch { /* the next pass reports them again, harmlessly */ }
    } else if (done) {
      count.unreported = done.code || 'bad_answer';
    }
  }

  /* Housekeeping that must never cost a pass its answer. */
  try {
    d.prepare('DELETE FROM inbox_applied WHERE applied_at < ?').run(new Date(Date.now() - KEEP_MS).toISOString());
  } catch { /* the next pass */ }
  return count;
}

/* One pass over what is waiting. { taken, applied, rejected, pending,
   reported, unreported }, { skipped: reason } (not_owner: this laptop does
   not own the mirror), or { error } when Supabase could not be asked. */
export async function collect({ lineage } = {}) {
  if (!lineage) return { skipped: 'no_lineage' };
  try {
    return await pass(lineage);
  } catch (e) {
    return { error: String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300) };
  }
}
