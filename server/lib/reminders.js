/* ==========================================================================
   THE REMINDERS                                                [reminders.js]
   --------------------------------------------------------------------------
   The two bots only ever spoke when something CHANGED: an order placed, a
   stage moved, a payment recorded. Nothing chased anybody, because THE
   ABSENCE OF A RESPONSE IS NOT AN EVENT. An order could sit `pending` at
   Yalla Wear for three days and neither side heard a word; the shop could
   close with the shift left open and the only record was a bell in a browser
   nobody had open at nine at night.

   This is the other half. A one-minute tick runs the rule table below against
   the shop's current state and, for every condition that is TRUE and HAS NOT
   BEEN SAID BEFORE, queues a row into partner_events — the outbox
   lib/telegram.js already drains with retries, backoff, fan-out to every
   linked chat and 403-drops-the-chat. Nothing about sending is reimplemented
   here; the second copy of that is the one that gets the 403 handling wrong.

   THIS FILE DECIDES WHAT AND WHEN. IT NEVER WRITES A SENTENCE.
   The words are TEMPLATES in telegram.js, Arabic then English, the same split
   alerts.js makes: a row is a kind and its values. Nothing in `args` is
   formatted — money is minor units with its currency beside it, days are
   integers — so the same reminder reads correctly in either language.

   "HAS NOT BEEN SAID BEFORE" IS A UNIQUE INDEX, NOT A VARIABLE
   ------------------------------------------------------------
       rem:<ruleId>:<ref>:<occasion>

   written into partner_events.dedupe, with a partial UNIQUE index over it
   (migration 041). THE ROW THAT WAS SENT IS THE RECORD THAT IT WAS SAID, so
   there is nothing in memory to lose: a restart, a laptop taking the baton, a
   dev copy pointed at the same file — none of them can double-send.

   The occasion is what makes a standing condition tellable at all:
     · a shop-local DAY KEY          — the nightly close, the morning digest
     · a STEP off an instant the row already carries — '6h' since
       order_sent_at, 'd2' since a deadline. Better than a bucket, because a
       server that was off at hour four fires LATE AND ONCE rather than
       skipping or repeating.
     · a calendar BUCKET             — only where there is no start instant to
       measure from. Stock has no "went to zero at" column.

   Repeating and once-only are the same mechanism: a once-only rule declares
   one occasion, a nagging one declares several. Every repeating rule has a
   CAP, because a reminder nobody acts on stops being read.

   WHAT IT WILL NOT DO
   -------------------
   · It never inserts through anything but Partner.queueEvent. That is the
     door where PARTNER_STRIP deletes the customer's name and the shop's price
     for a Yalla-bound message; a local INSERT here would be a second door,
     and the first reminder that leaked a margin onto another company's phone
     would look exactly like a working feature.
   · It never opens a transaction to decide. Candidates are pre-filtered with
     an indexed read and DB.tx is opened only if something survives — a tx
     fires the commit hook, and sync-worker.js schedules a mirror push on it,
     so a tick that opened one every minute would wake the mirror every minute
     for nothing.
   · It never speaks during quiet hours, and it never delays a real event to
     do so: the suppression is here, at the insert, not in drain(). An order
     accepted at two in the morning is news that goes out at two in the
     morning.
   · It never queues for a side that has no bot or no linked chat. Those rows
     would sit in the table and all arrive the day somebody links a phone —
     February's "the shift is still open" delivered in March.

   THE COLD START. partner_events is deliberately not mirrored, so a laptop
   that takes the baton begins with an empty ledger and will re-say everything
   still true. BURST bounds that to a trickle, and restating the standing
   conditions once on a new machine is a catch-up rather than a bug.
   ========================================================================== */

import * as DB from './db.js';
import * as Telegram from './telegram.js';
import * as Partner from './partner.js';
import * as Alerts from './alerts.js';
import * as Dashboard from './dashboard.js';
import * as Money from './money.js';
import * as Wants from './wants.js';
import * as Stockwatch from './stockwatch.js';
import * as Customers from './customers.js';

const TICK_MS = 60 * 1000;
/* Boot is the busiest second the machine has — the same reason the mirror
   waits before its first run. Nothing here is urgent to the minute. */
const FIRST_RUN_MS = 60 * 1000;
const PRUNE_MS = 6 * 60 * 60 * 1000;
/* Rows kept after sending. Longer than the longest cadence in the table (the
   30-day wants bucket), because pruning a row IS forgetting it was said. */
const PRUNE_DAYS = 120;
/* New rows per audience per tick. The cap that turns a cold start into a
   trickle instead of thirty messages at once. */
const BURST = 6;

const SIDES = ['og', 'yalla'];

let timer = null;
let pruneTimer = null;
const state = {
  on: false, busy: false, runs: 0, lastRunAt: null, lastError: null,
  queued: 0, skipped: {}, byRule: {}
};

/* --------------------------------------------------------------- config */

const cfg = (k) => {
  const r = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(k);
  return r ? r.value : null;
};
const num = (k, fb) => {
  const v = Number(cfg(k));
  return Number.isFinite(v) ? v : fb;
};
/* A switch is on unless it is explicitly '0'. A key that does not exist yet —
   a rule added after this shop's database was seeded — is ON, because a rule
   worth writing is worth hearing, and turning it off is one tap. */
const on = (k) => cfg(k) !== '0';

/* Minor units as a person reads them. USD carries two decimal places and SYP
   none, and the two are NEVER added — a day that took both took both, and one
   number covering the pair would be a made-up conversion at today's rate. */
const fmt = (n, cur) => {
  const v = Number(n) || 0;
  return (cur === 'USD' ? (v / 100).toFixed(2) : Math.round(v).toLocaleString('en-US')) +
         ' ' + (cur || 'SYP');
};
const moneyPair = (m) => [
  m && m.syp ? fmt(m.syp, 'SYP') : null,
  m && m.usd ? fmt(m.usd, 'USD') : null
].filter(Boolean).join(' + ') || fmt(0, 'SYP');

/* --------------------------------------------------------------- the clock

   THE FIRST SERVER-SIDE NOTION OF THE SHOP'S DAY. Everywhere else in this
   codebase the day belongs to the browser: the dashboard and the reports are
   handed two instants and a zone, because the server is UTC and Aleppo is
   not. A scheduler has no browser to ask, so `shop.tz_minutes` is its own
   source of truth (180 — Syria is UTC+3 and has had no DST since 2022).

   A Date shifted by the offset has UTC FIELDS THAT ARE SHOP-LOCAL, which is
   the whole trick and the one Partner.stats already uses. */
const tzMinutes = () => {
  const v = num('shop.tz_minutes', 180);
  return Number.isInteger(v) && Math.abs(v) <= 840 ? v : 180;
};
const shopNow = (ms, tz) => new Date(ms + tz * 60000);
const dayKeyOf = (ms, tz) => shopNow(ms, tz).toISOString().slice(0, 10);
const hourOf = (ms, tz) => shopNow(ms, tz).getUTCHours();
/* Whole days since the epoch, in the shop's zone. What a bucket counts. */
const dayNum = (ms, tz) => Math.floor((ms + tz * 60000) / 86400000);

/* The same for a stored value, which may be a full instant or a bare date.
   A bare date is a calendar day somebody typed and means that day locally —
   parsing it as UTC midnight would make it the day before in Aleppo. */
function dayNumOf(iso, tz) {
  if (!iso) return null;
  const s = String(iso);
  if (s.length === 10) return Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : dayNum(t, tz);
}

const hoursSince = (iso, ms) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : (ms - t) / 3600000;
};

/* The local instants bounding a shop day, as UTC ISO — what `sales.at`
   compares against, half-open the way every other range in this codebase is. */
function dayRange(dayKey, tz) {
  const from = new Date(Date.parse(dayKey + 'T00:00:00Z') - tz * 60000).toISOString();
  const to = new Date(Date.parse(dayKey + 'T00:00:00Z') + 86400000 - tz * 60000).toISOString();
  return { from, to };
}

/* WHICH OCCASION OF A RUNNING CONDITION WE ARE IN.

   `steps` are hours, in order. Below the first, nothing is said — a message
   that arrived ninety seconds ago is not neglected. Past the last, `daily`
   switches to one a day keyed on the day number (never sooner than 24h in,
   so the last step and the first daily line are not an hour apart), and
   `capDays` is where it stops talking altogether. No steps at all means
   daily from the first minute — which is what "late" means. */
function elapsedOccasion(elapsedH, { steps = [], daily = false, capDays = null } = {}) {
  if (elapsedH == null || elapsedH < 0) return null;
  if (capDays != null && elapsedH > capDays * 24) return null;
  const passed = steps.filter((s) => elapsedH >= s);
  const dailyFrom = steps.length ? Math.max(steps[steps.length - 1], 24) : 0;
  if (daily && elapsedH >= dailyFrom) return 'd' + Math.floor(elapsedH / 24);
  return passed.length ? passed[passed.length - 1] + 'h' : null;
}

const round1 = (n) => Math.round(n);

/* ------------------------------------------------------------ shared reads

   Two rules on two different bots ask the same question about an unanswered
   order — one to tell the shop, one to nudge the printer. One query. */
function pendingOrders(ms) {
  return DB.get().prepare(
    `SELECT j.id, j.order_sent_at, j.deadline, j.priority, ${Partner.PIECES_SQL} AS qty
       FROM print_jobs j
      WHERE j.order_state = 'pending' AND j.order_sent_at IS NOT NULL
      ORDER BY j.order_sent_at ASC LIMIT 20`
  ).all().map((r) => ({ ...r, elapsedH: hoursSince(r.order_sent_at, ms) }));
}

/* Accepted work still on the press, with the date it is judged against.
   COALESCE(order_promised_at, deadline) is THEIR OWN PROMISE FIRST — the same
   ladder Partner.stats scores their on-time percentage on. Nagging another
   company against a number they are not measured on is how a bot gets muted. */
/* WHAT THE PRINTER'S WEEK WAS WORTH — jobs FINISHED in the window, by their
   own `done` stamp rather than by when they were raised, because that is the
   work they did. Pieces and payout come from the same CASE the production
   report scores them on (Partner.PIECES_SQL and the lines, since a kit job
   never stores its own cost), so the bot and the Earnings screen cannot
   disagree about what they are owed.

   MONEY IS A PAIR. Some jobs are priced in dollars and some in lira, and one
   number covering both would be a conversion nobody asked for. On time is
   measured against their OWN promise first — COALESCE(order_promised_at,
   deadline) — the same ladder Partner.stats uses, because nagging or praising
   somebody against a number they are not measured on is worthless either
   way. */
function weekForPartner(fromIso, toIso) {
  const rows = DB.get().prepare(
    `SELECT j.id, j.currency,
            ${Partner.PIECES_SQL} AS pieces,
            CASE WHEN j.kind = 'kit'
                 THEN (SELECT COALESCE(SUM(l.unit_cost * l.qty), 0)
                         FROM print_job_lines l WHERE l.job_id = j.id)
                 ELSE COALESCE(j.cost, 0) END AS payout,
            (SELECT MAX(st.at) FROM print_job_stages st
              WHERE st.job_id = j.id AND st.stage = 'done') AS done_at,
            COALESCE(j.order_promised_at, j.deadline) AS due
       FROM print_jobs j
      WHERE j.stage = 'done'
        AND EXISTS (SELECT 1 FROM print_job_stages st
                     WHERE st.job_id = j.id AND st.stage = 'done'
                       AND st.at >= ? AND st.at < ?)`
  ).all(fromIso, toIso);

  const payout = { syp: 0, usd: 0 };
  let pieces = 0, onTimeN = 0, judged = 0;
  for (const r of rows) {
    pieces += Number(r.pieces) || 0;
    const cur = r.currency === 'USD' ? 'usd' : 'syp';
    payout[cur] += Number(r.payout) || 0;
    if (r.due && r.done_at) {
      judged++;
      /* A bare YYYY-MM-DD due date means the end of that day, not its first
         moment — the same trap job_late documents. */
      const end = String(r.due).length === 10 ? r.due + 'T23:59:59.999Z' : r.due;
      if (Date.parse(r.done_at) <= Date.parse(end)) onTimeN++;
    }
  }
  return { jobs: rows.length, pieces, payout,
           onTime: judged ? Math.round((onTimeN / judged) * 100) : null };
}

function acceptedOpen() {
  return DB.get().prepare(
    `SELECT j.id, j.stage, j.order_responded_at,
            COALESCE(j.order_promised_at, j.deadline) AS due,
            ${Partner.PIECES_SQL} AS qty,
            (SELECT COUNT(*) FROM print_job_lines l
              WHERE l.job_id = j.id AND l.print_name IS NULL) AS tbc
       FROM print_jobs j
      WHERE j.stage <> 'done' AND j.order_state = 'accepted'
      ORDER BY due IS NULL, due ASC LIMIT 50`
  ).all();
}

/* A payment one side recorded and the other has not confirmed. `side` is who
   is being asked to confirm, so the filter is on who recorded it. */
function unconfirmedPayments(recordedBy, ms) {
  return DB.get().prepare(
    `SELECT p.id, p.invoice_id, p.amount, p.at, i.currency
       FROM partner_invoice_payments p
       JOIN partner_invoices i ON i.id = p.invoice_id
      WHERE p.confirmed_at IS NULL AND p.recorded_by_side = ?
      ORDER BY p.at ASC LIMIT 20`
  ).all(recordedBy).map((r) => ({ ...r, elapsedH: hoursSince(r.at, ms) }));
}

/* ============================================================== the rules

   One entry per reminder. `run(ctx)` returns candidates:

     { refType, refId, occasion, args }

   and the scheduler turns each into `rem:<id>:<refId>:<occasion>`, drops the
   ones already said, and queues what is left through Partner.queueEvent.

   `id` is also the config key (`reminders.<id>`) AND the id the Settings fold
   uses, so a rule added here needs one row in REMINDER_RULES and two i18n
   keys and nothing else.
   ========================================================================= */

const RULES = [
  /* ---- the shop's day ---------------------------------------------------- */
  {
    /* THE OWNER'S MORNING. Yalla Wear have had a digest since the day this
       file was written and the shop has had none — so the one person who most
       needs to know what the day looks like was the one nobody told.

       Four sections, each dropped when it is empty, and the whole thing silent
       on a morning with nothing in any of them. A digest of four zeroes is how
       a daily message stops being read, which is the same rule day_close and
       yl_digest already follow.

       It reports YESTERDAY's money, deliberately: at nine in the morning today
       has no takings and saying "0 today" would be true and useless. */
    id: 'og_digest', audience: 'og', kind: 'rem_og_digest', refType: 'day',
    run: (c) => {
      if (c.hour < num('reminders.og_digest_hour', 9)) return [];
      const args = { day: c.dayKey };

      const yest = dayKeyOf(c.ms - 86400000, c.tz);
      const y = dayRange(yest, c.tz);
      const t = Dashboard.takingsIn(y.from, y.to);
      const open = Money.currentShift();
      const s = open ? Money.shift(open.id) : null;
      if (t.count) {
        args.money = { text: moneyPair(t.takings), count: t.count,
                       drawer: s ? fmt(s.expected, s.currency) : null };
      }

      const late = Alerts.jobsLateCount({ basis: 'deadline' });
      const due = DB.get().prepare(
        `SELECT COUNT(*) AS n FROM print_jobs
          WHERE stage <> 'done' AND deadline IS NOT NULL AND SUBSTR(deadline,1,10) = ?`
      ).get(c.dayKey).n;
      const pending = DB.get().prepare(
        "SELECT COUNT(*) AS n FROM print_jobs WHERE order_state = 'pending'"
      ).get().n;
      if (due || late || pending) args.work = { due, late, pending };

      const out = Alerts.stockOutCount();
      const floor = Stockwatch.floorEmptyCount();
      const reorder = Stockwatch.reorderDue({ limit: 20 }).length;
      if (out || floor || reorder) args.shelves = { out, floor, reorder };

      const quiet = Customers.quietList({ limit: 1 }).total;
      const wants = Wants.backInStock({ limit: 20 }).length;
      if (quiet || wants) args.people = { quiet, wants };

      /* Nothing to say about any of the four. */
      if (!args.money && !args.work && !args.shelves && !args.people) return [];
      return [{ refId: c.dayKey, occasion: '', args }];
    }
  },
  {
    id: 'day_close', audience: 'og', kind: 'rem_day_close', refType: 'day',
    run: (c) => {
      if (c.hour < num('reminders.day_close_hour', 21)) return [];
      const { from, to } = dayRange(c.dayKey, c.tz);
      const t = Dashboard.takingsIn(from, to);
      const open = Money.currentShift();
      /* A DAY THE SHOP DID NOT OPEN IS NOT A DAY TO REPORT. No invoices and
         no shift opened means Friday, or a holiday, and "Sales: 0 SYP, 0
         invoices" every one of those evenings is how a nightly message stops
         being read. Zero takings on a day somebody DID open the drawer is a
         real and worrying fact, and still goes out. */
      const opened = DB.get().prepare(
        'SELECT COUNT(*) AS n FROM shifts WHERE opened_at >= ? AND opened_at < ?'
      ).get(from, to).n;
      if (!t.count && !opened) return [];
      /* `expected` only means anything against an open drawer. A shift closed
         earlier has been counted and signed off, and its variance is the
         cash_variance rule's business, not this one's. */
      const s = open ? Money.shift(open.id) : null;
      return [{
        refId: c.dayKey, occasion: '',
        args: {
          day: c.dayKey, syp: t.takings.syp, usd: t.takings.usd, invoices: t.count,
          expected: s ? s.expected : null, currency: s ? s.currency : null,
          shift: s ? s.id : null, shiftOpen: !!s
        }
      }];
    }
  },
  {
    id: 'shift_open', audience: 'og', kind: 'rem_shift_open', refType: 'shift',
    run: (c) => {
      const s = Money.currentShift();
      if (!s) return [];
      /* Two ways in, and the second is the one that matters. From the set
         hour, because the shop is closing. But ALSO at any hour once the
         drawer has been open since an EARLIER shop day — that is not a late
         evening, that is a shift somebody forgot, and it must not depend on
         the server having been awake for one particular hour of the night. */
      const stale = dayKeyOf(Date.parse(s.opened_at), c.tz) !== c.dayKey;
      if (!stale && c.hour < num('reminders.shift_open_hour', 22)) return [];
      const h = hoursSince(s.opened_at, c.ms);
      /* ADDRESSED TO WHOEVER OPENED IT. The person who can close the drawer is
         the person standing next to it; telling only the owner at ten at night
         is telling the one person who cannot act. `person` goes in the args so
         the sentence names them — one rendered text that reads correctly to
         both the cashier and the owner, who also hears it. */
      return [{ refId: s.id, occasion: c.dayKey, toUser: s.user_id || null,
                args: { id: s.id, hours: round1(h), by: s.user_name || null,
                        person: s.user_name || null } }];
    }
  },
  {
    id: 'cash_variance', audience: 'og', kind: 'rem_cash_variance', refType: 'shift',
    run: (c) => {
      const min = num('reminders.variance_min', 1000);
      const last = DB.get().prepare(
        'SELECT id, closed_at, user_id, user_name FROM shifts ' +
        'WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1'
      ).get();
      if (!last) return [];
      /* Only a shift closed in the last two days. Without this a laptop
         starting with an empty ledger would announce a variance from March. */
      const age = hoursSince(last.closed_at, c.ms);
      if (age == null || age > 48) return [];
      const s = Money.shift(last.id);
      if (!s || s.diff == null || Math.abs(s.diff) < min) return [];
      /* The person who counted the box is the one who can say what happened to
         it, so they are told as well as the owner — and the money guard means
         this only reaches their phone if somebody deliberately allowed it. */
      return [{ refId: s.id, occasion: '', toUser: last.user_id || null,
                args: { id: s.id, diff: s.diff, counted: s.counted,
                        expected: s.expected, currency: s.currency,
                        person: last.user_name || null } }];
    }
  },

  /* ---- stock -------------------------------------------------------------
     ONE message, not one per size. A shop can easily have forty sizes at
     zero, and forty messages is not a longer list, it is a different object —
     the same argument the bell's cap rests on. The top row is named and the
     rest are counted, keyed on that top SKU: restock it and the next tick's
     top row is a different SKU, which is a different key, which is the next
     message. Nothing else says it again for a week. */
  {
    id: 'stock_out', audience: 'og', kind: 'rem_stock_out', refType: 'sku',
    run: (c) => {
      const rows = Alerts.stockOut({ limit: 1 });
      if (!rows.length) return [];
      const total = Alerts.stockOutCount();
      return [{ refId: rows[0].sku, occasion: c.bucket(num('reminders.stock_repeat_days', 7)),
                args: { name: rows[0].name, size: rows[0].size, n: total } }];
    }
  },
  {
    id: 'stock_critical', audience: 'og', kind: 'rem_stock_critical', refType: 'stock',
    run: (c) => {
      const low = Alerts.criticalLevel();
      const n = Alerts.criticalCount(low);
      if (!n) return [];
      return [{ refId: 'critical', occasion: c.bucket(num('reminders.stock_repeat_days', 7)),
                args: { n, low } }];
    }
  },
  /* EMPTY ON THE FLOOR, FULL IN THE BACK. Ranked above the buying questions
     on purpose: this one has a customer standing in the shop attached to it,
     and it is fixed by walking twenty metres rather than by a purchase order.
     A two-day bucket because the answer changes as fast as the shelf does. */
  {
    id: 'floor_empty', audience: 'og', kind: 'rem_floor_empty', refType: 'sku',
    run: (c) => {
      const rows = Stockwatch.floorEmpty({ limit: 1 });
      if (!rows.length) return [];
      return [{ refId: rows[0].sku, occasion: c.bucket(2),
                args: { name: rows[0].name, size: rows[0].size,
                        back: rows[0].back, n: Stockwatch.floorEmptyCount() } }];
    }
  },
  {
    id: 'reorder_due', audience: 'og', kind: 'rem_reorder_due', refType: 'sku',
    run: (c) => {
      const rows = Stockwatch.reorderDue({ limit: 3, coverWeeks: num('reminders.cover_weeks', 2) });
      if (!rows.length) return [];
      return [{ refId: rows[0].sku, occasion: c.bucket(num('reminders.stock_repeat_days', 7)),
                args: { name: rows[0].name, size: rows[0].size,
                        have: rows[0].have, cover: rows[0].cover, n: rows.length } }];
    }
  },
  /* A judgement rather than a fact, so it ships OFF and is keyed on the
     product: fix one broken run and the next tick names a different product,
     which is a different key, which is the next message. */
  {
    id: 'size_run_broken', audience: 'og', kind: 'rem_size_run_broken', refType: 'product',
    run: (c) => {
      const rows = Stockwatch.brokenRuns({ limit: 1 });
      if (!rows.length) return [];
      const r = rows[0];
      return [{ refId: String(r.id), occasion: c.bucket(num('reminders.stock_repeat_days', 7)),
                args: { name: r.name, gone: r.gone, left: r.left, pieces: r.pieces } }];
    }
  },
  /* THE MOST EXPENSIVE QUERY IN THE TABLE, and the least urgent thing in the
     shop — so it is gated on ONE HOUR before the query runs, not filtered
     afterwards. Every other rule here is an indexed, LIMITed read; this is a
     scan, and a scan on a sixty-second tick is a different kind of object. */
  {
    id: 'dead_stock', audience: 'og', kind: 'rem_dead_stock', refType: 'product',
    run: (c) => {
      if (c.hour !== num('reminders.og_digest_hour', 9)) return [];
      const days = num('reminders.dead_days', 90);
      const d = Stockwatch.deadStock({ limit: 1, days });
      if (!d.rows.length) return [];
      const r = d.rows[0];
      return [{ refId: String(r.id), occasion: c.bucket(30),
                args: { name: r.name, pieces: r.pieces, capital: r.capital,
                        currency: r.currency, days, n: d.n, allPieces: d.pieces } }];
    }
  },
  {
    id: 'po_late', audience: 'og', kind: 'rem_po_late', refType: 'po',
    run: (c) => Alerts.poLate({ limit: 3 }).map((r) => {
      const days = Math.floor((c.ms - Date.parse(r.sent_at)) / 86400000);
      /* Once a week from the second week, and it gives up after six. An order
         nobody has chased in six weeks is not going to be chased by a bot. */
      if (days < 14 || days > 42) return null;
      return { refId: r.id, occasion: 'w' + Math.floor(days / 7),
               args: { id: r.id, name: r.supplier_name || null, days } };
    }).filter(Boolean)
  },
  /* ---- the runs ----------------------------------------------------------
     A delivery goes out and somebody forgets to mark it. Nothing in the system
     notices, and at the end of the day the board says three runs are still on
     the road when two are long since delivered. */
  {
    id: 'run_out_long', audience: 'og', kind: 'rem_run_out_long', refType: 'delivery',
    run: (c) => {
      /* A RUN AND A SHIPMENT ARE NOT THE SAME CLOCK. Our own driver is back
         within the afternoon, so four hours unmarked is worth a word. A
         parcel handed to a transport office for Damascus, or a courier for
         Amman, is DAYS on the road by design — nagging about it after four
         hours is how a bot gets muted, taking the useful half with it. */
      const runCut  = new Date(c.ms - num('reminders.run_hours', 4) * 3600000).toISOString();
      const shipCut = new Date(c.ms - num('reminders.ship_days', 5) * 86400000).toISOString();
      const rows = DB.get().prepare(
        `SELECT d.id, d.out_at, d.method, d.city, d.company_name, u.name AS driver,
                CASE WHEN d.method IN ('office','courier','abroad') THEN 1 ELSE 0 END AS ship
           FROM deliveries d
           LEFT JOIN users u ON u.id = d.driver_id
           JOIN sales s ON s.id = d.sale_id
          WHERE d.status = 'out' AND d.out_at IS NOT NULL AND s.voided = 0
            AND ((d.method IN ('office','courier','abroad') AND d.out_at <= ?)
              OR ((d.method IS NULL OR d.method NOT IN ('office','courier','abroad'))
                   AND d.out_at <= ?))
          ORDER BY d.out_at LIMIT 3`
      ).all(shipCut, runCut);
      if (!rows.length) return [];
      const r = rows[0];
      const h = hoursSince(r.out_at, c.ms);
      /* Steps then daily, capped at three days: a run nobody has marked in
         three days is a conversation, not a notification. A shipment is
         already days old when it first qualifies, so it steps straight to
         the daily cadence. */
      const occ = r.ship
        ? elapsedOccasion(h, { steps: [num('reminders.ship_days', 5) * 24], daily: true, capDays: 3 })
        : elapsedOccasion(h, { steps: [num('reminders.run_hours', 4), 12], daily: true, capDays: 3 });
      if (!occ) return [];
      return [{ refId: String(r.id), occasion: occ,
                args: { id: r.id, hours: round1(h), days: Math.floor(h / 24),
                        ship: !!r.ship, where: r.company_name || r.city || null,
                        driver: r.driver || null, n: rows.length } }];
    }
  },
  /* ADDRESSED TO THE DRIVER. The money is his to hand in and nobody else can
     do it for him; the owner hears it too, which is the point of addressing
     rather than redirecting. Once a day, at closing time. */
  {
    id: 'driver_cash', audience: 'og', kind: 'rem_driver_cash', refType: 'user',
    run: (c) => {
      if (c.hour < num('reminders.day_close_hour', 21)) return [];
      /* PER CURRENCY, never one number. A driver carrying 400,000 lira and
         $60 is carrying two things, and adding them at today's rate would
         make the sentence disagree with the notes in his hand.

         Two sources, because there are two kinds of door cash. 046's order
         payments carry a hand-in stamp, so "still in his pocket" is a fact
         the database holds. A till COD delivery never had one — it is the old
         path, kept here so those drivers are not silently dropped — and the
         best that can be said of it is that it was collected today. */
      const rows = DB.get().prepare(
        `SELECT id, name, currency, SUM(amount) AS amount, SUM(n) AS n FROM (
           SELECT p.received_by AS id, u.name AS name, p.currency AS currency,
                  SUM(p.amount) AS amount, COUNT(*) AS n
             FROM order_payments p JOIN users u ON u.id = p.received_by
            WHERE p.kind = 'in' AND p.drawer = 1 AND p.handed_in_at IS NULL
              AND p.received_by IS NOT NULL
            GROUP BY p.received_by, p.currency
           UNION ALL
           SELECT d.driver_id AS id, u.name AS name, d.currency AS currency,
                  SUM(d.collected) AS amount, COUNT(*) AS n
             FROM deliveries d
             JOIN users u ON u.id = d.driver_id
             JOIN sales s ON s.id = d.sale_id
            WHERE d.status = 'delivered' AND d.collected > 0 AND s.payment = 'cod'
              AND SUBSTR(d.assigned_at, 1, 10) = ?
            GROUP BY d.driver_id, d.currency
         ) GROUP BY id, name, currency HAVING amount > 0`
      ).all(c.dayKey);
      return rows.map((r) => ({
        refId: String(r.id),
        /* The currency is in the key: both messages have to go out, and one
           key for two of them drops the second before the insert. */
        occasion: `${c.dayKey}:${r.currency}`, toUser: r.id,
        args: { person: r.name || null, amount: r.amount, n: r.n,
                currency: r.currency || cfg('shop.base_currency') || 'SYP' }
      }));
    }
  },

  /* ---- the regulars ------------------------------------------------------
     Quiet is already computed per customer on the server — the median gap
     between their own purchases times their own multiplier — so this asks the
     question the bell asks and never a second version of it. */
  {
    id: 'customer_quiet', audience: 'og', kind: 'rem_customer_quiet', refType: 'cust',
    run: (c) => {
      /* A scan, like dead_stock: gated on the hour before it runs. */
      if (c.hour !== num('reminders.og_digest_hour', 9)) return [];
      const q = Customers.quietList({ limit: 5 });
      if (!q.rows.length) return [];
      return [{ refId: 'quiet', occasion: c.bucket(num('reminders.quiet_repeat_days', 7)),
                args: { names: q.rows.map((r) => r.name), n: q.total } }];
    }
  },

  {
    id: 'wants_back', audience: 'og', kind: 'rem_wants_back', refType: 'wants',
    run: (c) => Wants.backInStock({ limit: 3 }).map((r) => ({
      refId: r.sku, occasion: c.bucket(30),
      args: { name: r.name, size: r.size, n: r.n }
    }))
  },

  /* ---- print and partner, told to the shop ------------------------------- */
  {
    id: 'order_no_answer', audience: 'og', kind: 'rem_order_no_answer', refType: 'job',
    run: (c) => {
      const first = num('reminders.order_wait_hours', 4);
      return pendingOrders(c.ms).map((j) => {
        /* The shop hears three times and then stops: after a day of silence
           the answer is a telephone call, not a fourth notification. Yalla
           Wear's own bot goes on asking — that side has something to do. */
        const occ = elapsedOccasion(j.elapsedH, { steps: [first, 12, 24] });
        if (!occ) return null;
        return { refId: j.id, occasion: occ,
                 args: { id: j.id, hours: round1(j.elapsedH), qty: j.qty } };
      }).filter(Boolean);
    }
  },
  {
    id: 'job_late', audience: 'og', kind: 'rem_job_late', refType: 'job',
    run: (c) => Alerts.jobsLate({ limit: 3 }).map((r) => {
      const dn = dayNumOf(r.due, c.tz);
      if (dn == null) return null;
      /* CALENDAR DAYS LATE, not hours since the instant — and the occasion is
         the same number the message says. Keyed on hours they disagreed
         across midnight: the row said "1 day past" under a key that had
         already gone out saying "0 days past".

         And not below one. The bell counts a job late from the first moment
         of its own due date, because a bare 'YYYY-MM-DD' deadline compares as
         text against a full instant — which is right for a badge that means
         "look at this today" and wrong for a sentence that says the shop
         broke a promise. A job due today is not late. */
      const days = dayNum(c.ms, c.tz) - dn;
      if (days < 1 || days > 14) return null;
      return { refId: r.id, occasion: 'd' + days, args: { id: r.id, days, stage: r.stage } };
    }).filter(Boolean)
  },
  {
    id: 'partner_unread', audience: 'og', kind: 'rem_partner_unread', refType: 'msg',
    run: (c) => {
      const hrs = num('reminders.unread_hours', 3);
      const older = new Date(c.ms - hrs * 3600000).toISOString();
      const rows = Alerts.unreadFromYalla({ limit: 1, olderThanIso: older, oldestFirst: true });
      if (!rows.length) return [];
      const m = rows[0];
      /* Keyed on the OLDEST unread line and nothing else, so it is said once
         per neglected message: read it and the key changes with the backlog,
         read them all and there is nothing to key on. */
      return [{ refId: String(m.id), occasion: '',
                args: { n: Alerts.unreadFromYallaCount({ olderThanIso: older }),
                        hours: round1(hoursSince(m.at, c.ms)),
                        text: String(m.body || '').slice(0, 90) } }];
    }
  },
  {
    id: 'job_stuck', audience: 'og', kind: 'rem_job_stuck', refType: 'job',
    run: (c) => {
      const stuck = num('reminders.delivery_stuck_hours', 48);
      return DB.get().prepare(
        `SELECT j.id,
                (SELECT MAX(t.at) FROM print_job_stages t
                  WHERE t.job_id = j.id AND t.stage = 'delivery') AS since
           FROM print_jobs j WHERE j.stage = 'delivery' LIMIT 20`
      ).all().map((r) => {
        const h = hoursSince(r.since, c.ms);
        const occ = elapsedOccasion(h, { steps: [stuck], daily: true, capDays: 7 });
        if (!occ) return null;
        return { refId: r.id, occasion: occ, args: { id: r.id, hours: round1(h) } };
      }).filter(Boolean);
    }
  },
  {
    id: 'pay_wait', audience: 'og', kind: 'rem_pay_wait', refType: 'invoice',
    run: (c) => {
      const first = num('reminders.pay_confirm_hours', 24);
      return unconfirmedPayments('yalla', c.ms).map((p) => {
        const occ = elapsedOccasion(p.elapsedH, { steps: [first, 72] });
        if (!occ) return null;
        /* ref_id stays the INVOICE — that is what a phase-2 lookup asks for —
           and the payment id rides in the occasion, so two payments on one
           invoice cannot share a key. */
        return { refId: p.invoice_id, occasion: 'p' + p.id + ':' + occ,
                 args: { invoiceId: p.invoice_id, amount: p.amount,
                         currency: p.currency, hours: round1(p.elapsedH) } };
      }).filter(Boolean);
    }
  },

  /* ---- Yalla Wear's own bot ---------------------------------------------- */
  {
    id: 'yl_order_waiting', audience: 'yalla', kind: 'rem_yl_order_waiting', refType: 'job',
    run: (c) => pendingOrders(c.ms).map((j) => {
      /* Twice in the first evening, then once a day for a week. This is the
         one rule that genuinely nags, because an unanswered order is the one
         state where the shop can do nothing at all until they move. */
      const occ = elapsedOccasion(j.elapsedH, { steps: [2, 6, 12], daily: true, capDays: 7 });
      if (!occ) return null;
      return { refId: j.id, occasion: occ,
               args: { id: j.id, hours: round1(j.elapsedH), qty: j.qty,
                       deadline: j.deadline, priority: j.priority } };
    }).filter(Boolean)
  },
  {
    id: 'yl_due', audience: 'yalla', kind: 'rem_yl_due', refType: 'job',
    run: (c) => {
      const today = dayNum(c.ms, c.tz);
      return acceptedOpen().map((j) => {
        const dn = dayNumOf(j.due, c.tz);
        if (dn == null) return null;
        const days = dn - today;
        if (days > 2) return null;                       /* not yet worth saying */
        if (days < -14) return null;                     /* said enough */
        return { refId: j.id, occasion: days < 0 ? 'late' + -days : 'd' + days,
                 args: { id: j.id, qty: j.qty, due: j.due, days } };
      }).filter(Boolean);
    }
  },
  {
    id: 'yl_blocked', audience: 'yalla', kind: 'rem_yl_blocked', refType: 'job',
    run: (c) => acceptedOpen().map((j) => {
      if (!j.tbc) return null;
      const occ = elapsedOccasion(hoursSince(j.order_responded_at, c.ms),
                                  { steps: [4], daily: true, capDays: 7 });
      if (!occ) return null;
      return { refId: j.id, occasion: occ, args: { id: j.id, tbc: j.tbc, qty: j.qty } };
    }).filter(Boolean)
  },
  {
    id: 'yl_digest', audience: 'yalla', kind: 'rem_yl_digest', refType: 'day',
    run: (c) => {
      if (c.hour < num('reminders.yl_digest_hour', 9)) return [];
      const s = Partner.stats(c.tz, { money: false });
      const today = dayNum(c.ms, c.tz);
      let dueToday = 0, overdue = 0;
      for (const j of acceptedOpen()) {
        const dn = dayNumOf(j.due, c.tz);
        if (dn == null) continue;
        if (dn === today) dueToday++;
        else if (dn < today) overdue++;
      }
      const pending = pendingOrders(c.ms).length;
      /* "Good morning, you have nothing to do" is not worth a notification,
         and a digest that arrives every morning regardless is one people
         swipe away without reading — which is the state the useful ones then
         arrive into. Silence on a quiet week is the feature. */
      if (!s.open.jobs && !dueToday && !overdue && !pending) return [];
      return [{ refId: c.dayKey, occasion: '',
                args: { day: c.dayKey, jobs: s.open.jobs, pieces: s.open.pieces,
                        dueToday, overdue, pending } }];
    }
  },
  {
    /* TONIGHT, WHAT IS DUE TOMORROW. yl_digest is a morning list, and by the
       morning the day it is describing has started — a printer decides what
       goes on the press first the evening before. Different hour, different
       question, so it is a different rule rather than a longer digest.

       Keyed on the day it is ABOUT, not the day it is sent, so a server that
       was off at seven says it at eight and never twice. */
    id: 'yl_due_tomorrow', audience: 'yalla', kind: 'rem_yl_due_tomorrow', refType: 'day',
    run: (c) => {
      if (c.hour < num('reminders.yl_evening_hour', 19)) return [];
      const target = dayNum(c.ms, c.tz) + 1;
      const rows = acceptedOpen().filter((j) => dayNumOf(j.due, c.tz) === target);
      if (!rows.length) return [];
      const pieces = rows.reduce((a, j) => a + (Number(j.qty) || 0), 0);
      const tomorrow = dayKeyOf(c.ms + 86400000, c.tz);
      return [{ refId: tomorrow, occasion: '',
                args: { day: tomorrow, jobs: rows.length, pieces,
                        ids: rows.slice(0, 5).map((j) => j.id) } }];
    }
  },
  {
    /* MONDAY MORNING, WHAT LAST WEEK WAS WORTH. They have an Earnings screen
       and nobody opens a screen to be told they did well. This is the one
       message in the table that is not a nudge about something wrong, which
       is most of why it is worth sending: a bot that only ever complains gets
       muted, and the mute is side-wide.

       Money IS included here, and it is theirs — what OG owes the printer for
       their own work, which their portal already shows them. It is not the
       shop's takings, and PARTNER_STRIP has taken the customer price out. */
    id: 'yl_week', audience: 'yalla', kind: 'rem_yl_week', refType: 'day',
    run: (c) => {
      const shop = new Date(c.ms + c.tz * 60000);
      if (shop.getUTCDay() !== num('reminders.yl_week_day', 1)) return [];
      if (c.hour < num('reminders.yl_digest_hour', 9)) return [];
      const from = new Date(c.ms - 7 * 86400000).toISOString();
      const to = new Date(c.ms).toISOString();
      const w = weekForPartner(from, to);
      /* A week with nothing printed is a week not worth a summary. */
      if (!w.jobs) return [];
      return [{ refId: c.dayKey, occasion: '',
                args: { jobs: w.jobs, pieces: w.pieces, onTime: w.onTime,
                        money: moneyPair(w.payout) } }];
    }
  },
  {
    id: 'yl_pay_wait', audience: 'yalla', kind: 'rem_yl_pay_wait', refType: 'invoice',
    run: (c) => {
      const first = num('reminders.pay_confirm_hours', 24);
      return unconfirmedPayments('og', c.ms).map((p) => {
        const occ = elapsedOccasion(p.elapsedH, { steps: [first, 72] });
        if (!occ) return null;
        return { refId: p.invoice_id, occasion: 'p' + p.id + ':' + occ,
                 args: { invoiceId: p.invoice_id, amount: p.amount,
                         currency: p.currency, hours: round1(p.elapsedH) } };
      }).filter(Boolean);
    }
  }
];

export const RULE_IDS = RULES.map((r) => r.id);

/* ------------------------------------------------------------------ the tick */

/* THE ADDRESSEE IS PART OF THE KEY, AND ONLY WHEN THERE IS ONE.

   Without it a rule keyed on something two people share — driver_cash on the
   day key, say — makes ONE key for three drivers, and the second and third are
   dropped before the insert, at the `seen` check, so even INSERT OR IGNORE
   never reports it. Nobody would be told, and the count would say three.

   Appended only when the row is addressed, because adding it unconditionally
   would change the key of every row already in the table and re-say every
   standing condition once on upgrade. */
const dedupeKey = (ruleId, refId, occasion, toUser) =>
  ['rem', ruleId, String(refId), occasion, toUser == null ? null : 'u' + toUser]
    .filter((s) => s !== '' && s != null).join(':');

/* Is this side allowed to hear anything at all right now, and if not, why?
   The reasons are ordered by how permanent they are, so the panel and the
   Settings fold report the thing a person can actually act on. */
function blockedReason(side, c) {
  if (!on('reminders.enabled')) return 'off';
  if (side === 'yalla' && cfg('reminders.yalla_paused') === '1') return 'paused';
  const until = cfg('reminders.muted_until_' + side);
  if (until && Date.parse(until) > c.ms) return 'muted';
  if (!Telegram.canReach(side)) return 'no_chat';
  /* Quiet hours wrap midnight: 23 → 8 is "from eleven at night until eight".
     A reminder suppressed here KEEPS ITS KEY and lands on the first tick
     after eight, unchanged — it is not lost, only held. */
  const from = num('reminders.quiet_from', 23);
  const to = num('reminders.quiet_to', 8);
  const q = from === to ? false
    : from < to ? (c.hour >= from && c.hour < to)
                : (c.hour >= from || c.hour < to);
  return q ? 'quiet' : null;
}

/* Evaluate everything. `dry` computes and returns without writing a row —
   which is what POST /api/reminders/preview is, and the only honest way to
   look at a night's reminders at two in the afternoon. */
export function evaluate({ at = null, dry = false } = {}) {
  const tz = tzMinutes();
  const ms = at ? Date.parse(at) : Date.now();
  if (Number.isNaN(ms)) {
    throw Object.assign(new Error('at must be an ISO instant'), { code: 'bad_request' });
  }
  const c = {
    ms, tz, dayKey: dayKeyOf(ms, tz), hour: hourOf(ms, tz),
    bucket: (days) => 'b' + Math.floor(dayNum(ms, tz) / Math.max(1, days))
  };

  const seen = DB.get().prepare('SELECT 1 AS x FROM partner_events WHERE dedupe = ?');
  const skipped = {};
  const byRule = {};
  const perSide = { og: [], yalla: [] };

  for (const side of SIDES) skipped[side] = blockedReason(side, c);

  for (const rule of RULES) {
    const info = { fired: 0, queued: 0, error: null };
    byRule[rule.id] = info;
    if (!on('reminders.' + rule.id)) { info.off = true; continue; }
    /* A blocked side still EVALUATES in a dry run — the preview must work on
       a shop with no bot linked yet, which is every shop before it has one. */
    if (skipped[rule.audience] && !dry) continue;

    let rows = [];
    try {
      rows = rule.run(c) || [];
    } catch (e) {
      /* One broken query must not take the tick down with it, and the failure
         has to land where somebody sees it rather than in a console line. */
      info.error = e.message;
      continue;
    }
    info.fired = rows.length;

    for (const r of rows) {
      /* ADDRESSED ONLY IF THERE IS SOMEBODY TO ADDRESS. A rule naming a person
         who has not linked a phone falls back to the whole side rather than
         being aimed at nobody: a standing fact about the shop must not vanish
         because one cashier never set up Telegram. The name stays in the
         sentence either way, so whoever runs the shop still learns whose
         shift it is. */
      const toUser = (r.toUser != null && Telegram.canAddress(rule.audience, r.toUser))
        ? Number(r.toUser) : null;

      /* Nobody subscribes to this kind — do not queue it. Left to drain() the
         row would be marked sent with "no chat is subscribed", and the row IS
         the ledger, so the occasion would be spent before anybody could ask
         for it. Skipped here, the key survives and lands the day somebody
         ticks the box. Not applied to a dry run: the preview must show what
         WOULD fire on a shop that has not linked a phone yet. */
      if (!dry && !Telegram.canReach(rule.audience, { kind: rule.kind, toUser })) continue;

      const key = dedupeKey(rule.id, r.refId, r.occasion, toUser);
      if (seen.get(key)) continue;
      perSide[rule.audience].push({
        rule: rule.id, kind: rule.kind, refType: rule.refType, refId: String(r.refId),
        audience: rule.audience, args: r.args, dedupe: key, toUser,
        /* The preview shows the MESSAGE, not the rule's name. Nobody can judge
           "yl_due fired"; everybody can judge the sentence it would send. And
           once a message can be addressed, WHO it is for is half of what the
           preview is for. */
        toName: toUser != null ? (r.args && r.args.person) || null : null,
        text: dry ? Telegram.renderFor(rule.kind, r.args) : undefined
      });
      info.queued++;
    }
  }

  /* Most severe first, then oldest — so a burst-capped tick spends its six on
     the things that cost most to ignore, exactly as the bell is ordered. */
  const order = new Map(RULES.map((r, i) => [r.id, i]));
  const out = [];
  for (const side of SIDES) {
    perSide[side].sort((a, b) => order.get(a.rule) - order.get(b.rule));
    out.push(...perSide[side].slice(0, BURST));
  }
  return { at: new Date(ms).toISOString(), tz, dayKey: c.dayKey, hour: c.hour,
           skipped, byRule, rows: out };
}

/* One pass. Returns what it queued — the same shape `dry` returns, so the
   preview and the button answer alike. */
export function runNow({ at = null, dry = false } = {}) {
  const r = evaluate({ at, dry });
  if (dry || !r.rows.length) return r;

  DB.tx((d) => {
    for (const row of r.rows) {
      Partner.queueEvent(d, {
        kind: row.kind, refType: row.refType, refId: row.refId,
        audience: row.audience, args: row.args, dedupe: row.dedupe,
        toUser: row.toUser == null ? null : row.toUser
      });
    }
  });
  state.queued += r.rows.length;
  /* Buzz now rather than within five seconds — somebody is standing at a
     till at nine at night wondering whether this thing works. */
  Telegram.nudge();
  return r;
}

function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const r = runNow({});
    state.runs++;
    state.lastRunAt = r.at;
    state.lastError = null;
    state.skipped = r.skipped;
    state.byRule = r.byRule;
  } catch (e) {
    state.lastError = e.message;
  } finally {
    state.busy = false;
  }
}

/* Forgetting that something was said. Everything sent long enough ago that no
   live rule could still be keyed on it — the longest cadence in the table is
   the 30-day wants bucket, so 120 days is four times over. */
function prune() {
  try {
    const cutoff = new Date(Date.now() - PRUNE_DAYS * 86400000).toISOString();
    DB.tx((d) => {
      d.prepare('DELETE FROM partner_events WHERE dedupe IS NOT NULL AND sent_at IS NOT NULL AND at < ?')
        .run(cutoff);
    });
  } catch (e) {
    state.lastError = e.message;
  }
}

/* --------------------------------------------------------------- lifecycle */

export function start() {
  if (timer) return;
  if (!on('reminders.enabled')) {
    console.log('  Reminders: off (reminders.enabled = 0).');
    return;
  }
  if (!SIDES.some((s) => Telegram.canReach(s))) {
    /* Said, not hidden. The scheduler still starts — a chat linked this
       afternoon must not need a restart to be heard from. */
    console.log('  Reminders: on, but no bot chat is linked yet — nothing will be queued until one is.');
  } else {
    console.log('  Reminders: on — checking every minute, ' + tzMinutes() / 60 + 'h from UTC.');
  }
  state.on = true;
  timer = setTimeout(function first() {
    tick();
    timer = setInterval(tick, TICK_MS);
    timer.unref();
  }, FIRST_RUN_MS);
  timer.unref();
  pruneTimer = setInterval(prune, PRUNE_MS);
  pruneTimer.unref();
}

export function stop() {
  if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
  if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
  state.on = false;
}

/* When the next daily reminder is due, in the shop's own clock — the one
   number that tells somebody at a glance whether the time zone is right. */
function nextDaily() {
  const tz = tzMinutes();
  const now = Date.now();
  const out = {};
  /* Every rule that fires once a day at an hour. A daily rule left out of this
     list cannot tell anybody when it next fires, which is the one number that
     proves the time zone is right. */
  for (const [id, key, dflt] of [['og_digest', 'reminders.og_digest_hour', 9],
                                 ['day_close', 'reminders.day_close_hour', 21],
                                 ['yl_digest', 'reminders.yl_digest_hour', 9]]) {
    const h = num(key, dflt);
    const local = shopNow(now, tz);
    const fired = local.getUTCHours() >= h;
    const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
                                 local.getUTCDate() + (fired ? 1 : 0), h) - tz * 60000);
    out[id] = { hour: h, at: at.toISOString(), on: on('reminders.' + id) };
  }
  return out;
}

export function status() {
  return {
    on: state.on, running: !!timer, busy: state.busy, runs: state.runs,
    lastRunAt: state.lastRunAt, lastError: state.lastError, queued: state.queued,
    skipped: state.skipped, byRule: state.byRule,
    tz: tzMinutes(), shopNow: shopNow(Date.now(), tzMinutes()).toISOString().slice(0, 16),
    dayKey: dayKeyOf(Date.now(), tzMinutes()),
    enabled: on('reminders.enabled'),
    yallaPaused: cfg('reminders.yalla_paused') === '1',
    rules: RULES.map((r) => ({ id: r.id, audience: r.audience, on: on('reminders.' + r.id) })),
    nextDaily: nextDaily()
  };
}
