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

   A ROW IS A KIND AND ITS VALUES, NOT A SENTENCE
   ----------------------------------------------
   `{ key, kind, args, icon, tone, view, read }`. The words are written in the
   browser, by `DB.alertText`, from `I18N` — so the same row reads correctly
   in Arabic. This file used to compose English here, which was fine in a
   popover and wrong the day the list became the centre card of an
   Arabic-first dashboard. Nothing in `args` is ever formatted: money is minor
   units with its currency beside it, days are integers, names are names.

   ONE LIST, TWO CAPS
   ------------------
   `list(user, { limit })` — the bell asks for eight, the dashboard for fifty,
   and both come from the same function so they can never disagree. Every
   kind that names rows carries its own LIMIT (three stock-outs, three late
   jobs…) and, when more exist, pushes ONE summary row keyed on the total —
   `stock_out:more:12` — so the badge counts what is really there and reading
   the summary once does not hide it when a thirteenth size runs out.
   ========================================================================== */

import * as DB from './db.js';
import * as Auth from './auth.js';
import * as Sync from './sync-worker.js';
import * as Loyalty from './loyalty.js';
import * as Wants from './wants.js';
import { capArray } from './capped.js';

/* How many rows the bell shows at most. Named, because the stamp block
   below has to reserve a slot inside this budget for its summary row — and
   a literal 8 in two places is one place that gets changed. */
const MAX_ROWS = 8;

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
export function list(user, { limit = MAX_ROWS } = {}) {
  const d = DB.get();
  const out = [];
  const can = (p) => Auth.can(user, p);

  /* The summary row a capped kind leaves behind. Keyed on the TOTAL so that
     one more of the thing makes a read summary come back — that is the point
     of it. `n` is how many are not named above it. */
  const more = (kind, total, shown, icon, tone, view) => {
    if (total > shown) {
      out.push({ key: kind + ':more:' + total, kind: 'more',
                 args: { of: kind, n: total - shown, total }, icon, tone, view });
    }
  };

  const low = Number(
    (d.prepare("SELECT value FROM config WHERE key = 'stock.critical'").get() || {}).value
  ) || 2;

  /* THE MIRROR HAS STOPPED. Computed like everything else here — from the
     sync worker's memory of its last runs, never a stored row — and shown only
     to whoever can act on it. One failed run is a bad connection; three in a
     row is half an hour of sales on this machine and nowhere else, and until
     now the only place that said so was a server window nobody reads. Keyed
     on the last success, so reading it once does not hide the next outage. */
  if (can('config.write')) {
    const s = Sync.status();
    if (s.configured && s.failures >= 3) {
      out.push({
        key: 'mirror:' + (s.lastOkAt || 'boot'), kind: 'mirror',
        args: { n: s.failures, err: s.lastError ? String(s.lastError).slice(0, 140) : null },
        icon: '!', tone: 'red', view: 'settings'
      });
    }
  }

  /* Out of stock, not merely low — somebody is at the counter holding it. */
  if (can('stock.read') || can('product.read')) {
    const OUT_SQL = `FROM variants v
         JOIN products p ON p.id = v.product_id
        WHERE p.hidden = 0
          AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) = 0`;
    const rows = d.prepare(
      `SELECT v.sku, v.size, p.name ${OUT_SQL} ORDER BY p.name, v.size LIMIT 3`
    ).all();
    rows.forEach((r) => {
      out.push({ key: 'stock:' + r.sku, kind: 'stock_out', args: { name: r.name, size: r.size },
                 icon: '!', tone: 'red', view: 'products' });
    });
    if (rows.length === 3) {
      more('stock_out', d.prepare(`SELECT COUNT(*) AS n ${OUT_SQL}`).get().n, rows.length,
           '!', 'red', 'products');
    }
  }

  if (can('print.read')) {
    const rows = d.prepare(
      `SELECT id, deadline FROM print_jobs
        WHERE stage <> 'done' AND deadline IS NOT NULL AND deadline < ?
        ORDER BY deadline ASC LIMIT 3`
    ).all(nowIso());
    rows.forEach((r) => {
      out.push({ key: 'job:' + r.id, kind: 'job_late', args: { id: r.id, days: -daysUntil(r.deadline) },
                 icon: '!', tone: 'red', view: 'print' });
    });
    if (rows.length === 3) {
      more('job_late', d.prepare(
        `SELECT COUNT(*) AS n FROM print_jobs
          WHERE stage <> 'done' AND deadline IS NOT NULL AND deadline < ?`
      ).get(nowIso()).n, rows.length, '!', 'red', 'print');
    }
  }

  /* Somebody asked for a size the shop did not have, and now it does. The
     sale is standing there waiting to be made — which is why it sits above
     money owed. Grouped by SKU: the action is "ring the three people who
     wanted a 42", not three separate rows.

     stock.read OR customer.read, and never a driver. The row names a count, a
     product and a size — no person — and the warehouse account, whose job it
     is to tell the floor a box has landed, does not hold customer.read. */
  if ((can('stock.read') || can('customer.read')) && user.role !== 'delivery') {
    const rows = Wants.backInStock({ limit: 3 });
    rows.forEach((r) => {
      out.push({ key: 'wants:' + r.sku, kind: 'wants_back',
                 args: { n: r.n, name: r.name, size: r.size, sku: r.sku },
                 icon: '↺', tone: 'amber', view: 'warehouse' });
    });
    if (rows.length === 3) {
      more('wants_back', Wants.backInStockCount(), rows.length, '↺', 'amber', 'warehouse');
    }
  }

  /* What the shop owes. Money, so it is money.read — not something a cashier
     who can see the stock screen is thereby entitled to. */
  if (can('money.read')) {
    /* Due within 30 days, in SQL rather than after the LIMIT — the old shape
       took the three soonest and then dropped the far-off ones, so three
       suppliers due next year hid one due tomorrow. */
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
    const DUE_SQL = `FROM suppliers
        WHERE archived = 0 AND outstanding > 0 AND due_date IS NOT NULL AND due_date <= ?`;
    const rows = d.prepare(
      `SELECT id, name, outstanding, currency, due_date ${DUE_SQL} ORDER BY due_date ASC LIMIT 3`
    ).all(horizon.toISOString());
    rows.forEach((r) => {
      const left = daysUntil(r.due_date);
      out.push({
        key: 'supplier:' + r.id, kind: 'supplier_due',
        args: { name: r.name, amount: r.outstanding, currency: r.currency, days: left },
        icon: '$', tone: left < 0 ? 'red' : 'amber', view: 'reports'
      });
    });
    if (rows.length === 3) {
      more('supplier_due', d.prepare(`SELECT COUNT(*) AS n ${DUE_SQL}`).get(horizon.toISOString()).n,
           rows.length, '$', 'amber', 'reports');
    }
  }

  if (can('stock.read')) {
    const crit = d.prepare(
      `SELECT COUNT(*) AS n FROM variants v
        JOIN products p ON p.id = v.product_id
       WHERE p.hidden = 0
         AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) BETWEEN 1 AND ?`
    ).get(low).n;
    if (crit) {
      out.push({ key: 'critical', kind: 'critical', args: { n: crit },
                 icon: '~', tone: 'amber', view: 'warehouse' });
    }
  }

  /* ---- full stamp cards --------------------------------------------------
     "Six people have a full card" is a list somebody can act on in an
     afternoon — ring them, or have the reward ready when they walk in.

     One row per person rather than one summary line, because the action is
     per person and the read state has to be too: the key is `stamps:<id>`,
     what the alert is ABOUT. Keyed on the text it would come back unread
     every time the count changed, which is the mistake the header of this
     file exists to record.

     customer.read, and never for a driver — he holds the permission so his
     board can show names, not so he can be told who is owed a free pair. */
  if (can('customer.read') && user.role !== 'delivery') {
    const r = Loyalty.rules();
    if (Loyalty.stampsOn(r.mode)) {
      const full = Loyalty.fullCards(r);

      /* CAPPED AT FIVE, then one summary row.

         A bell is a list of things to do this morning, and it is read by
         glancing. Sixty named rows is not a longer list, it is a different
         object: the stock warnings and the overdue print jobs are still in
         there, underneath, where nobody scrolls. The cap is here rather than
         in the browser because the bell is computed per account on the server
         and the browser must not have to decide what matters.

         Five named, because five is a morning's work and the sixth is not
         more urgent than the first. The summary row carries the rest and is
         keyed on the COUNT — `stamps:more:12` — so reading it once does not
         hide it when a thirteenth card fills. */
      const NAMED = 5;

      /* The summary must SURVIVE the overall cap at the bottom of this
         function, and reserving its slot here is the only way.

         This bell has always ended in a slice to the limit. Pushing five
         names and a summary into a list that was already six long meant the
         summary was the row that got cut — leaving four names and no hint
         that eight more people were waiting. That is the silent undercount
         this cap was added to prevent, arriving by a different door. Found by
         the test, not by reading. `limit` may be Infinity; Math.min copes. */
      const room = Math.max(0, limit - out.length);
      if (room > 0) {
        const needSummary = full.length > Math.min(NAMED, room);
        const nameCount = Math.max(0, Math.min(NAMED, full.length,
                                               needSummary ? room - 1 : room));

        for (const f of full.slice(0, nameCount)) {
          out.push({
            key: 'stamps:' + f.customerId, kind: 'stamps',
            args: { name: f.name, stamps: f.stamps, required: f.required, owed: f.cardsOwed,
                    customerId: f.customerId },
            icon: '★', tone: 'amber', view: 'customers'
          });
        }
        more('stamps', full.length, nameCount, '★', 'amber', 'customers');
      }
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
      out.push({ key: 'payroll', kind: 'payroll', args: { n: who, days: daysUntil(soonest.next_payment) },
                 icon: 'P', tone: 'grey', view: 'reports' });
    }
  }

  /* A PO that was sent and never arrived is a hole in the stock everyone is
     planning around. Only worth saying once it is genuinely late — and the
     14 days is in the query, so the LIMIT cannot eat the late ones. */
  if (can('stock.read')) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const PO_SQL = `FROM purchase_orders
        WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at <= ?`;
    const rows = d.prepare(
      `SELECT id, supplier_name, sent_at ${PO_SQL} ORDER BY sent_at ASC LIMIT 2`
    ).all(cutoff.toISOString());
    rows.forEach((r) => {
      out.push({ key: 'po:' + r.id, kind: 'po_late',
                 args: { id: r.id, name: r.supplier_name || null, days: -daysUntil(r.sent_at) },
                 icon: '~', tone: 'amber', view: 'warehouse' });
    });
    if (rows.length === 2) {
      more('po_late', d.prepare(`SELECT COUNT(*) AS n ${PO_SQL}`).get(cutoff.toISOString()).n,
           rows.length, '~', 'amber', 'warehouse');
    }
  }

  const seen = new Set(
    d.prepare('SELECT key FROM notification_reads WHERE user_id = ?').all(user.id).map((r) => r.key)
  );
  return capArray(out.map((n) => Object.assign({ read: seen.has(n.key) }, n)), limit);
}

/* One alert, or every one currently showing when nothing is named.

   Both the marking and the pruning use the UNCAPPED list. The bell shows
   eight and the dashboard fifty; pruning against the eight would delete the
   read mark on row twelve the moment anybody read anything, and it would come
   back bold on the dashboard every morning — the exact bug the key design
   exists to prevent, by a different route. */
export function markRead(user, key) {
  return DB.tx(() => {
    const d = DB.get();
    const all = list(user, { limit: Infinity }).rows;
    const keys = key ? [key] : all.map((n) => n.key);
    const ins = d.prepare(
      'INSERT OR IGNORE INTO notification_reads (user_id, key, read_at) VALUES (?,?,?)'
    );
    let n = 0;
    for (const k of keys) n += ins.run(user.id, k, nowIso()).changes;

    /* Anything that is no longer alerting is dropped, so this cannot grow
       forever as stock comes and goes over the years. */
    const live = new Set(all.map((x) => x.key));
    const stale = d.prepare('SELECT key FROM notification_reads WHERE user_id = ?')
      .all(user.id).map((r) => r.key).filter((k) => !live.has(k));
    const del = d.prepare('DELETE FROM notification_reads WHERE user_id = ? AND key = ?');
    for (const k of stale) del.run(user.id, k);

    return { marked: n, pruned: stale.length };
  });
}
