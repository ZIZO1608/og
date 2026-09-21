/* ==========================================================================
   The rows the snapshot is made from — ONE SET OF SQL FOR TWO DATABASES.
   --------------------------------------------------------------------------
   og-bridge runs these against the Supabase mirror (Postgres, as og_vps).
   The parity test runs THE SAME STRINGS against a copy of the till's SQLite
   and compares what snapshot-figures.js makes of them with the till's own
   dashboard, Money and Statement answers. So every statement here is written
   to mean the same thing on both:

     - flags are `NOT x`: a BOOLEAN on the mirror, 0/1 on the till;
       `drawer` is SMALLINT on both, so it is compared to 1;
     - times are compared with ISO strings (text on the till, TIMESTAMPTZ on
       the mirror, which casts the string);
     - sums come back as numbers on the till and as strings from pg — the
       figures module turns every one into a Number itself.

   Each WHERE is lifted from the till's own query for the same figure, and
   the comment says which. Nothing is invented here.
   ========================================================================== */

export const QUERIES = {
  /* dashboard.js takingsRows(): non-voided sales in [from, to). */
  sales: `SELECT id, at, currency, total, payment
            FROM sales
           WHERE NOT voided AND at >= :from AND at < :to`,

  /* statement.js "what came back": each return's own due_minor, in the
     sale's currency, at the return's own time, never for a voided sale. */
  returns: `SELECT r.id, r.at, s.currency, r.due_minor
              FROM order_returns r JOIN sales s ON s.id = r.sale_id
             WHERE NOT s.voided AND r.at >= :from AND r.at < :to`,

  /* cashbook.js snapshot(): the book, per place and currency. */
  balances: `SELECT place, currency, SUM(amount) AS amount, MAX(at) AS last
               FROM money_moves GROUP BY place, currency`,

  /* cashbook.js snapshot(): when each place was last checked. */
  checks: `SELECT place, MAX(at) AS last,
                  SUM(CASE WHEN kind = 'opening' THEN 1 ELSE 0 END) AS openings
             FROM money_moves WHERE kind IN ('opening', 'count_diff') GROUP BY place`,

  /* The settings the rules read: the method list and the owner's own places
     (cashbook.js places()), the base currency, the critical stock level
     (alerts.js criticalLevel()), the shop's name. */
  config: `SELECT key, value FROM config
            WHERE key IN ('pay.methods', 'money.places', 'shop.base_currency',
                          'stock.critical', 'shop.name')`,

  /* Names only — og_vps is granted users(id, name) and nothing else. */
  users: `SELECT id, name FROM users`,

  currencies: `SELECT code, minor_exp FROM currencies`,

  /* dashboard.js out.suppliers. */
  suppliers: `SELECT currency, COUNT(*) AS n, SUM(outstanding) AS total
                FROM suppliers WHERE NOT archived AND outstanding > 0
               GROUP BY currency`,

  /* deliveries.js summary(): parcels waiting and out, for non-voided sales. */
  road: `SELECT d.status, COUNT(*) AS n
           FROM deliveries d JOIN sales s ON s.id = d.sale_id
          WHERE NOT s.voided AND d.status IN ('waiting', 'out')
          GROUP BY d.status`,

  /* deliveries.js summary() cash / orders.js driverCash(): door cash taken
     and not yet handed in. */
  driverCash: `SELECT currency, SUM(amount) AS amount, COUNT(DISTINCT received_by) AS drivers
                 FROM order_payments
                WHERE kind = 'in' AND drawer = 1 AND handed_in_at IS NULL
                GROUP BY currency`,

  /* alerts.js OUT_SQL / criticalCount(): every size of a product still on
     sale, with what is on the shelves everywhere. */
  stock: `SELECT v.sku, v.size, p.name, COALESCE(SUM(st.qty), 0) AS qty
            FROM variants v
            JOIN products p ON p.id = v.product_id
            LEFT JOIN stock st ON st.sku = v.sku
           WHERE NOT p.hidden
           GROUP BY v.sku, v.size, p.name`,

  /* The last twenty sales, voided ones included and marked. */
  lastSales: `SELECT id, at, currency, total, voided, payment, cashier_id
                FROM sales ORDER BY at DESC, id DESC LIMIT 20`,
  lastItems: `SELECT sale_id, name, size, qty FROM sale_items
               WHERE sale_id IN (SELECT id FROM sales ORDER BY at DESC, id DESC LIMIT 20)
               ORDER BY sale_id, id`
};

/* :from / :to → $1 $2 (pg) or ? ? (SQLite), in order of appearance. */
export function bind(sql, window, style) {
  const params = [];
  const out = sql.replace(/:(from|to)\b/g, (_, k) => {
    params.push(window[k]);
    return style === '$' ? '$' + params.length : '?';
  });
  return { sql: out, params };
}
