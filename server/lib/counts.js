/* ============================================================================
   STOCK COUNTS                                                    [counts.js]
   ----------------------------------------------------------------------------
   The count SESSION — who walked the shelves, when, what the sheet said and
   what it disagreed with. The adjustments themselves already reached the
   server through the ordinary stock endpoint; what was lost on every refresh
   was the record of the count itself.

   WHY POSTING IS ONE TRANSACTION
   ------------------------------
   The browser used to fire one request per line, each its own transaction.
   Server-backed, the naive version is worse than the old one: mark the
   session posted, then apply the adjustments, and a retry re-applies every
   adjustment — stock silently doubled. So the whole sheet lands in one
   transaction or none of it does, and a posted sheet refuses to post again.

   That also closes a race the old way had: a sale landing between two of
   those parallel adjustments made the second one correct against a figure
   that had already moved.
   ========================================================================== */

import * as DB from './db.js';
import * as Stock from './stock.js';

const nowIso = () => new Date().toISOString();
const fail = (msg, code) => Object.assign(new Error(msg), { code });

function nextId(d) {
  const top = d.prepare(
    "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS m FROM stock_counts WHERE id GLOB 'CNT-[0-9]*'"
  ).get().m;
  return 'CNT-' + String((top || 0) + 1).padStart(4, '0');
}

function shape(c, lines) {
  return {
    ...c,
    lines,
    /* Derived, never stored: a header and its lines cannot disagree. */
    pieces: lines.reduce((a, l) => a + l.counted, 0),
    counted: lines.length,
    /* Only meaningful once posted, when system_qty was frozen. */
    variance: lines.reduce(
      (a, l) => a + (l.system_qty == null ? 0 : l.counted - l.system_qty), 0)
  };
}

export function list({ limit = 40 } = {}) {
  const d = DB.get();
  const heads = d.prepare('SELECT * FROM stock_counts ORDER BY started_at DESC LIMIT ?').all(limit);
  if (!heads.length) return [];
  const lines = d.prepare('SELECT * FROM stock_count_lines ORDER BY id').all();
  return heads.map((c) => shape(c, lines.filter((l) => l.count_id === c.id)));
}

export function get(id) {
  const d = DB.get();
  const c = d.prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
  if (!c) return null;
  return shape(c, d.prepare('SELECT * FROM stock_count_lines WHERE count_id = ? ORDER BY id').all(id));
}

export function start({ whId, scope = 'all', userId = null, userName = null }) {
  if (!whId) throw fail('a count needs a place to count', 'bad_request');
  return DB.tx(() => {
    const d = DB.get();
    const id = nextId(d);
    d.prepare(
      `INSERT INTO stock_counts (id, wh_id, scope, status, started_at, user_id, user_name)
       VALUES (?,?,?,'open',?,?,?)`
    ).run(id, whId, scope, nowIso(), userId, userName);
    DB.logChange('stock_counts', id, 'insert', userId, null);
    return get(id);
  });
}

/* The sheet as it stands. Sent in batches while somebody walks the shelves,
   so a closed laptop does not lose an hour of counting. Counting the same
   shelf twice overwrites rather than appending a second opinion. */
export function setLines(id, lines = [], userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const c = d.prepare('SELECT status FROM stock_counts WHERE id = ?').get(id);
    if (!c) throw fail('no such count', 'not_found');
    if (c.status !== 'open') throw fail('that count is already ' + c.status, 'bad_status');

    const up = d.prepare(
      `INSERT INTO stock_count_lines (count_id, sku, counted) VALUES (?,?,?)
       ON CONFLICT (count_id, sku) DO UPDATE SET counted = excluded.counted`
    );
    const drop = d.prepare('DELETE FROM stock_count_lines WHERE count_id = ? AND sku = ?');
    for (const l of lines) {
      if (!l.sku) continue;
      /* A cleared box means "I have not counted this", not "there are none".
         Storing it as zero would post a write-off of everything on the shelf. */
      if (l.counted === null || l.counted === '' || l.counted === undefined) {
        drop.run(id, l.sku);
      } else {
        up.run(id, l.sku, Math.max(0, Math.round(Number(l.counted) || 0)));
      }
    }
    DB.logChange('stock_counts', id, 'update', userId, null);
    return get(id);
  });
}

export function post(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const c = d.prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
    if (!c) throw fail('no such count', 'not_found');
    if (c.status !== 'open') throw fail('that count is already ' + c.status, 'bad_status');

    const lines = d.prepare('SELECT * FROM stock_count_lines WHERE count_id = ?').all(id);
    if (!lines.length) throw fail('nothing was counted', 'bad_request');

    const live = d.prepare('SELECT COALESCE(qty, 0) AS q FROM stock WHERE sku = ? AND wh_id = ?');
    const stamp = d.prepare('UPDATE stock_count_lines SET system_qty = ? WHERE id = ?');

    for (const l of lines) {
      /* The live figure read INSIDE this transaction, not the one the browser
         had when the shelf was walked. Between the two a sale may have gone
         through, and correcting against a stale number would undo it. */
      const now = (live.get(l.sku, c.wh_id) || { q: 0 }).q;
      stamp.run(now, l.id);
      const delta = l.counted - now;
      if (!delta) continue;

      /* Stock.apply, not Stock.count: the latter opens its own transaction
         and DB.tx refuses to nest — deliberately, because SQLite has no
         nested transactions and half a posted count is worse than none. */
      Stock.apply(d, {
        sku: l.sku, whId: c.wh_id, delta, type: 'count',
        note: 'Count ' + id, userId, refType: 'count', refId: id
      });
    }

    d.prepare("UPDATE stock_counts SET status = 'posted', posted_at = ? WHERE id = ?")
      .run(nowIso(), id);
    DB.logChange('stock_counts', id, 'update', userId, null);
    return get(id);
  });
}

export function cancel(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const c = d.prepare('SELECT status FROM stock_counts WHERE id = ?').get(id);
    if (!c) throw fail('no such count', 'not_found');
    if (c.status === 'posted') throw fail('that count was already posted', 'bad_status');
    d.prepare("UPDATE stock_counts SET status = 'cancelled' WHERE id = ?").run(id);
    DB.logChange('stock_counts', id, 'update', userId, null);
    return get(id);
  });
}
