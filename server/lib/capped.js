/* ==========================================================================
   OG SYSTEM — when you cap, say you capped
   --------------------------------------------------------------------------
   Every list in this system has a limit on it, and that is right: a till does
   not need the shop's whole history in memory to sell a pair of shoes. What
   is not right is a limit that nothing downstream knows about, because the
   thing on the other end goes on counting, summing and badging the truncated
   set as though it were the whole.

   THREE OF THESE HAVE ALREADY SHIPPED AND BEEN FIXED:

     * `total_spent` added lira to dollars (Stage A) — a sum over a set that
       was not the set anybody meant.
     * the 60-card render cap versus Bulk.visibleIds (Stage C) — select-all
       reached 5,000 invisible customers while 60 were drawn.
     * the bell's slice(0, 8) cutting the full-card summary row (Stage F) —
       four names and no hint that eight more people were waiting.

   All three are the same shape: A LIMIT APPLIED AT ONE LAYER WHILE ANOTHER
   LAYER KEEPS COUNTING THE WHOLE SET. The fix is never to lift the limit —
   the limits are load-bearing — it is to make the truncation travel with the
   data, so a screen that shows a number can say what the number is of.

   `count` is a separate query rather than something clever. It runs on the
   same connection, over an indexed column, and a shop with 50,000 sales
   answers COUNT(*) in under a millisecond. Guessing from `rows.length ===
   limit` would be wrong exactly when it mattered: a table holding precisely
   200 rows is not truncated and would claim it was.
   ========================================================================== */

import { get } from './db.js';

/* { rows, shown, total, capped } — the shape every capped reader returns.

   `total` is the number of rows that MATCH, not the number in the table:
   "23 of 4,120 invoices" is a lie if 4,120 counts other people's. */
export function withCap(rows, limit, countSql, ...args) {
  const total = get().prepare(countSql).get(...args).n;
  return {
    rows,
    shown: rows.length,
    total,
    /* Not `rows.length === limit`. A list of exactly 200 out of exactly 200
       is complete, and saying otherwise sends somebody looking for rows that
       are not there. */
    capped: total > rows.length
  };
}

/* For a set already in memory. Same shape, so a caller never has to know
   which kind it is looking at. */
export function capArray(all, limit) {
  const rows = all.slice(0, limit);
  return { rows, shown: rows.length, total: all.length, capped: all.length > rows.length };
}
