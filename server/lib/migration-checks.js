/* ==========================================================================
   OG SYSTEM — checks a migration must pass before it may commit
   --------------------------------------------------------------------------
   A migration that reshapes the catalogue runs on the shop's own laptop the
   first time new code starts there, with nobody watching. SQL alone cannot
   say "the stock came out different for THIS product" and refuse, so a
   migration named here gets a `before` (run inside its transaction, before
   the SQL) and an `after` (after the SQL, before COMMIT). An `after` that
   throws rolls the whole migration back, and the server does not start —
   which is the point: a shop that will not open says so, a shop that opens
   with its stock quietly moved does not.

   `foreignKeysOff` runs the migration the way SQLite's own table-rebuild
   procedure says to: foreign keys off around the transaction, a
   foreign_key_check before COMMIT, and back on. Without it, DROP TABLE on a
   parent performs an implicit DELETE, and `stock` cascades from `variants`.

   Nothing here imports db.js; the database handle is passed in.
   ========================================================================== */

/* Quantity and value (at the product's own cost price) per product, through
   the variants. The one number a colour migration must not change. */
function stockByProduct(d) {
  const rows = d.prepare(
    `SELECT p.id, p.name,
            COALESCE(SUM(s.qty), 0)                AS qty,
            COALESCE(SUM(s.qty), 0) * p.cost_price AS value,
            COUNT(DISTINCT v.sku)                  AS skus
       FROM products p
       LEFT JOIN variants v ON v.product_id = p.id
       LEFT JOIN stock s    ON s.sku = v.sku
      GROUP BY p.id ORDER BY p.id`
  ).all();
  const out = new Map();
  for (const r of rows) out.set(r.id, r);
  return out;
}

export const CHECKS = {
  /* 059 rebuilds users (for the role check) — every account, every session
     and every row that points at one must come through untouched. */
  '059_access.sql': {
    foreignKeysOff: true,
    before(d) {
      return {
        users: d.prepare("SELECT COUNT(*) AS n, group_concat(id || ':' || username || ':' || role || ':' || active, ',') AS k FROM (SELECT * FROM users ORDER BY id)").get(),
        perms: d.prepare('SELECT COUNT(*) AS n FROM role_permissions').get().n,
        sessions: d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
      };
    },
    after(d, snap) {
      const u = d.prepare("SELECT COUNT(*) AS n, group_concat(id || ':' || username || ':' || role || ':' || active, ',') AS k FROM (SELECT * FROM users ORDER BY id)").get();
      if (u.n !== snap.users.n || u.k !== snap.users.k) throw new Error('the accounts changed while rebuilding users — nothing was changed');
      const s = d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
      if (s !== snap.sessions) throw new Error('the sessions changed while rebuilding users — nothing was changed');
      const p = d.prepare('SELECT COUNT(*) AS n FROM role_permissions').get().n;
      if (p < snap.perms) throw new Error('permission rows were lost — nothing was changed');
      const h = d.prepare("SELECT COUNT(*) AS n FROM users WHERE length(pw_hash) <> 64").get().n;
      if (h) throw new Error(h + ' password hash(es) came through damaged — nothing was changed');
    }
  },

  '058_colours.sql': {
    foreignKeysOff: true,
    before(d) {
      return {
        stock: stockByProduct(d),
        movements: d.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n,
        stockRows: d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS q FROM stock').get()
      };
    },
    after(d, snap) {
      const now = stockByProduct(d);
      for (const [id, was] of snap.stock) {
        const is = now.get(id);
        if (!is || is.qty !== was.qty || is.value !== was.value || is.skus !== was.skus) {
          throw new Error(
            `stock changed for product ${id} "${was.name}": ` +
            `${was.qty} pieces / ${was.skus} sizes / value ${was.value} before, ` +
            `${is ? is.qty : 'none'} / ${is ? is.skus : 'none'} / ${is ? is.value : 'none'} after — ` +
            'nothing was changed');
        }
      }
      const m = d.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n;
      if (m !== snap.movements) throw new Error(`the movement log changed (${snap.movements} → ${m}) — nothing was changed`);
      const s = d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS q FROM stock').get();
      if (s.n !== snap.stockRows.n || s.q !== snap.stockRows.q) {
        throw new Error(`the stock table changed (${snap.stockRows.q} → ${s.q} pieces) — nothing was changed`);
      }
      const orphan = d.prepare('SELECT COUNT(*) AS n FROM variants WHERE colour_id IS NULL').get().n;
      if (orphan) throw new Error(`${orphan} size(s) were left without a colour — nothing was changed`);
    }
  }
};
