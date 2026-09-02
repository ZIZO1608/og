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
import * as Sync from './sync-worker.js';
import * as Loyalty from './loyalty.js';

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
export function list(user) {
  const d = DB.get();
  const out = [];
  const can = (p) => Auth.can(user, p);

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
        key: 'mirror:' + (s.lastOkAt || 'boot'), icon: '!', tone: 'red', view: 'settings',
        text: `Supabase mirror has failed ${s.failures} times in a row` +
              (s.lastError ? ` — ${s.lastError.slice(0, 140)}` : '')
      });
    }
  }

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
         hide it when a thirteenth card fills. Keyed on its text it would come
         back unread every time somebody bought a pair, which is the mistake
         this file's header exists to record. */
      const NAMED = 5;

      /* The summary must SURVIVE the overall cap at the bottom of this
         function, and reserving its slot here is the only way.

         This bell has always ended in `out.slice(0, MAX_ROWS)`. Pushing five
         names and a summary into a list that was already six long meant the
         summary was the row that got cut — leaving four names and no hint
         that eight more people were waiting. That is the silent undercount
         this cap was added to prevent, arriving by a different door. Found by
         the test, not by reading. */
      const room = Math.max(0, MAX_ROWS - out.length);
      if (room > 0) {
        const needSummary = full.length > Math.min(NAMED, room);
        const nameCount = Math.max(0, Math.min(NAMED, full.length,
                                               needSummary ? room - 1 : room));

        for (const f of full.slice(0, nameCount)) {
          out.push({
            key: 'stamps:' + f.customerId, icon: '★', tone: 'amber',
            view: 'customers',
            text: `${f.name} has a full card — ${f.stamps} of ${f.required}` +
                  (f.cardsOwed > 1 ? ` (${f.cardsOwed} rewards owed)` : '')
          });
        }

        const rest = full.length - nameCount;
        if (rest > 0) {
          /* Keyed on the TOTAL, so a thirteenth full card makes a summary
             somebody has already read come back unread — which is the point
             of it. Keyed on its text it would return every time anybody
             bought a pair. */
          out.push({
            key: 'stamps:more:' + full.length, icon: '★', tone: 'amber',
            view: 'customers',
            text: nameCount
              ? `${rest} more ${rest === 1 ? 'customer has' : 'customers have'} ` +
                `a full card — ${full.length} in total`
              : `${rest} ${rest === 1 ? 'customer has' : 'customers have'} a full card`
          });
        }
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
  return out.slice(0, MAX_ROWS).map((n) => Object.assign({ read: seen.has(n.key) }, n));
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
