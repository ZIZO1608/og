/* ============================================================================
   THE BELL                                                       [alerts.js]
   ----------------------------------------------------------------------------
   What the shop needs to know right now, computed from what the shop actually
   has. Nothing here is stored as a row: an alert is a fact about the current
   state, and a stored alert is a fact about a state that has moved on.

   These were five hardcoded lines naming a product this shop had never
   stocked. Then they were derived in the browser — better, but every till
   worked it out separately from whatever that account was allowed to see, so
   two people looking at the same shop saw different bells and neither was
   authoritative.

   TWO THINGS THIS GETS RIGHT THAT THE BROWSER COULD NOT
   -----------------------------------------------------
   1. Permissions. Supplier debt is money.read, payroll is staff.read. Derived
      in the browser these were filtered only because the data had already
      been withheld — which is true today and is not a rule anyone stated.
      Here it is stated.

   2. Read state that survives. Keyed on WHAT the alert is about, never on the
      words: "due in 3 days" becomes "due in 2 days" tomorrow, and a text key
      makes an alert somebody read come back unread every morning. Stored per
      user, so reading it on the till marks it read in the office too.
   ========================================================================== */

import * as DB from './db.js';
import * as Auth from './auth.js';

const nowIso = () => new Date().toISOString();

/* Whole days from now until `iso`. Negative means it has already passed. */
function daysUntil(iso) {
  if (!iso) return null;
  const then = new Date(iso); then.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((then - today) / 86400000);
}

/* Ordered by what it costs to ignore: a sale being lost right now, then a
   promise already broken, then money, then what is merely coming. */
export function list(user) {
  const d = DB.get();
  const out = [];
  const can = (p) => Auth.can(user, p);

  const low = Number(
    (d.prepare("SELECT value FROM config WHERE key = 'stock.critical'").get() || {}).value
  ) || 2;

  /* Out of stock, not merely low — somebody is at the counter holding it. */
  if (can('stock.read') || can('product.read')) {
    d.prepare(
      `SELECT v.sku, v.size, p.name
         FROM variants v
         JOIN products p ON p.id = v.product_id
        WHERE p.hidden = 0
          AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) = 0
        ORDER BY p.name, v.size
        LIMIT 3`
    ).all().forEach((r) => {
      out.push({ key: 'stock:' + r.sku, icon: '!', tone: 'red', view: 'products',
                 text: `${r.name} — size ${r.size} out of stock` });
    });
  }

  if (can('print.read')) {
    d.prepare(
      `SELECT id, deadline FROM print_jobs
        WHERE stage <> 'done' AND deadline IS NOT NULL AND deadline < ?
        ORDER BY deadline ASC LIMIT 3`
    ).all(nowIso()).forEach((r) => {
      const late = -daysUntil(r.deadline);
      out.push({ key: 'job:' + r.id, icon: '!', tone: 'red', view: 'print',
                 text: `Print job #${r.id} is ${late} ${late === 1 ? 'day' : 'days'} overdue` });
    });
  }

  /* What the shop owes. Money, so it is money.read — not something a cashier
     who can see the stock screen is thereby entitled to. */
  if (can('money.read')) {
    d.prepare(
      `SELECT id, name, outstanding, currency, due_date FROM suppliers
        WHERE archived = 0 AND outstanding > 0 AND due_date IS NOT NULL
        ORDER BY due_date ASC LIMIT 3`
    ).all().forEach((r) => {
      const left = daysUntil(r.due_date);
      if (left === null || left > 30) return;
      out.push({
        key: 'supplier:' + r.id, icon: '$', tone: left < 0 ? 'red' : 'amber', view: 'reports',
        text: `${r.name} — ${r.outstanding.toLocaleString('en-US')} ${r.currency}` +
              (left < 0 ? ` overdue by ${-left} days` : ` due in ${left} days`)
      });
    });
  }

  if (can('stock.read')) {
    const crit = d.prepare(
      `SELECT COUNT(*) AS n FROM variants v
        JOIN products p ON p.id = v.product_id
       WHERE p.hidden = 0
         AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) BETWEEN 1 AND ?`
    ).get(low).n;
    if (crit) {
      out.push({ key: 'critical', icon: '~', tone: 'amber', view: 'warehouse',
                 text: `${crit} ${crit === 1 ? 'SKU is' : 'SKUs are'} down to critical stock` });
    }
  }

  if (can('staff.read')) {
    const soonest = d.prepare(
      `SELECT next_payment FROM employees
        WHERE archived = 0 AND next_payment IS NOT NULL
        ORDER BY next_payment ASC LIMIT 1`
    ).get();
    if (soonest) {
      const who = d.prepare(
        'SELECT COUNT(*) AS n FROM employees WHERE archived = 0 AND next_payment = ?'
      ).get(soonest.next_payment).n;
      const run = daysUntil(soonest.next_payment);
      out.push({
        key: 'payroll', icon: 'P', tone: 'grey', view: 'reports',
        text: `Payroll for ${who} ${who === 1 ? 'employee' : 'employees'}` +
              (run <= 0 ? ' is due now' : ` runs in ${run} days`)
      });
    }
  }

  /* A PO that was sent and never arrived is a hole in the stock everyone is
     planning around. Only worth saying once it is genuinely late. */
  if (can('stock.read')) {
    d.prepare(
      `SELECT id, supplier_name, sent_at FROM purchase_orders
        WHERE status = 'sent' AND sent_at IS NOT NULL
        ORDER BY sent_at ASC LIMIT 2`
    ).all().forEach((r) => {
      const waiting = -daysUntil(r.sent_at);
      if (waiting < 14) return;
      out.push({ key: 'po:' + r.id, icon: '~', tone: 'amber', view: 'warehouse',
                 text: `${r.id}${r.supplier_name ? ' — ' + r.supplier_name : ''} ` +
                       `still not received after ${waiting} days` });
    });
  }

  const seen = new Set(
    d.prepare('SELECT key FROM notification_reads WHERE user_id = ?').all(user.id).map((r) => r.key)
  );
  return out.slice(0, 8).map((n) => Object.assign({ read: seen.has(n.key) }, n));
}

/* One alert, or every one currently showing when nothing is named. */
export function markRead(user, key) {
  return DB.tx(() => {
    const d = DB.get();
    const keys = key ? [key] : list(user).map((n) => n.key);
    const ins = d.prepare(
      'INSERT OR IGNORE INTO notification_reads (user_id, key, read_at) VALUES (?,?,?)'
    );
    let n = 0;
    for (const k of keys) n += ins.run(user.id, k, nowIso()).changes;

    /* Anything that is no longer alerting is dropped, so this cannot grow
       forever as stock comes and goes over the years. */
    const live = new Set(list(user).map((x) => x.key));
    const stale = d.prepare('SELECT key FROM notification_reads WHERE user_id = ?')
      .all(user.id).map((r) => r.key).filter((k) => !live.has(k));
    const del = d.prepare('DELETE FROM notification_reads WHERE user_id = ? AND key = ?');
    for (const k of stale) del.run(user.id, k);

    return { marked: n, pruned: stale.length };
  });
}
