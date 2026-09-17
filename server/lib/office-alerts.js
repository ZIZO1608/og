/* ==========================================================================
   OG SYSTEM — the office hears when an order moves            [office-alerts.js]
   --------------------------------------------------------------------------
   The delivery office's order alerts, on the shop's Telegram bot. They were a
   Web Push bell on the Deliveries board (048), and that bell could not survive
   Phase C: a browser registers a service worker only on an origin it trusts,
   and a LAN-only shop has a self-signed certificate, so the bell could never
   have been offered anywhere but the till. Telegram is outbound-only, needs no
   certificate and no inbound port, and the shop's bot is already running — so
   this adds no listener on either token. It writes rows; the drain that has
   always sent them sends these too.

   WHAT IS NEWS IS STILL DECIDED IN ONE PLACE. lib/tracking.js reads the
   customer's own list of events (Receipt.events) against push_seen and calls
   orderMoved() with what is new — before it asks whether any customer is
   following, because an order nobody is watching is still news to the office.
   So the office and the customer's phone can never disagree about what
   happened, and a restart repeats nothing.

   NINE KINDS, one row per batch. A driver marking a parcel delivered with the
   cash writes two events a moment apart; the office is told the bigger one and
   "+1 more", the same rule the customer's notification follows.

   NO CUSTOMER NAME, EVER. A Telegram chat is a room whose membership nobody in
   this system controls, and a phone left on a counter is readable by whoever
   picks it up. The order number is enough to open it.

   THE SHOP'S HOURS. The shop is open 13:00 to 23:00 (alerts.quiet_from /
   alerts.quiet_to, on shop.tz_minutes). Anything not in alerts.urgent is held
   until the shop opens rather than buzzing somebody at three in the morning
   about a thing nobody can act on until the door opens — which is how people
   learn to mute the bot. Only a cancelled order is urgent by default: it may
   be packed and about to leave. A held order row that a stronger one overtakes
   before morning is superseded, so 13:00 brings "delivered", not "out", then
   "delivered".

   WHO HEARS IT is the drain's business (telegram.js officeWants): an account
   that cannot work the delivery office never does, whatever is ticked, and the
   person whose own button made the news is skipped (partner_events.skip_users).

   Nothing here throws into a route: a Telegram alert is not a reason for a
   payment to fail. Every export catches, logs, and answers 0.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as Partner from './partner.js';
import * as Telegram from './telegram.js';

/* THE NINE ARE NAMED ONCE, in telegram.js's KIND_GROUPS.office — the list the
   picker draws from, the presets are measured against and the drain routes by.
   A second copy here is how a kind ends up routed and never queued, or queued
   and never routed. The seven that follow an order along its road are WEIGHT's
   keys below; the other two (a review, a driver's cash) have no road.
   Re-exported rather than copied into a const: a const here is read while
   telegram.js may still be loading, when a module imports telegram.js first. */
export { OFFICE_KINDS } from './telegram.js';

/* WHICH LEADS when several land at once. A cancellation outranks everything —
   the parcel must not leave. An arrival or a failure closes the order. */
const WEIGHT = { dl_cancelled: 7, dl_failed: 6, dl_delivered: 6, dl_out: 5, dl_back: 4, dl_new: 3, dl_paid: 2 };

const DEFAULT_CLOCK = { from: 23, to: 13, tz: 180, urgent: ['dl_cancelled'] };

/* An event key from Receipt.events, as the kind of alert it is. */
export function kindForKey(key) {
  const k = String(key || '');
  if (k === 'placed') return 'dl_new';
  if (k === 'void') return 'dl_cancelled';
  if (k.startsWith('pay:')) return 'dl_paid';
  if (k.startsWith('out:')) return 'dl_out';
  if (k.startsWith('ret:')) return 'dl_back';
  if (k.startsWith('closed:delivered:')) return 'dl_delivered';
  if (k.startsWith('closed:failed:')) return 'dl_failed';
  return null;
}

/* ---------------------------------------------------------------- the clock */

function cfg(d, key) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r ? r.value : null;
}

/* A whole hour of the day or the default. '' is not 0: Number('') is, and a
   blank box would otherwise mean midnight. */
function hourOr(v, dflt) {
  if (v == null || String(v).trim() === '') return dflt;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : dflt;
}

export function readClock(d = get()) {
  const tzRaw = cfg(d, 'shop.tz_minutes');
  const tz = tzRaw == null || String(tzRaw).trim() === '' ? DEFAULT_CLOCK.tz : Number(tzRaw);
  let urgent = DEFAULT_CLOCK.urgent.slice();
  const raw = cfg(d, 'alerts.urgent');
  if (raw != null) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) urgent = v.filter((k) => Telegram.OFFICE_KINDS.includes(k));
    } catch { /* unreadable: the default stands */ }
  }
  return {
    tz: Number.isFinite(tz) ? tz : DEFAULT_CLOCK.tz,
    from: hourOr(cfg(d, 'alerts.quiet_from'), DEFAULT_CLOCK.from),
    to: hourOr(cfg(d, 'alerts.quiet_to'), DEFAULT_CLOCK.to),
    urgent
  };
}

/* When a row written now may go out: null while the shop is open, else the
   instant the shop next opens. Quiet runs from `from` up to `to` and may wrap
   midnight (23 → 13). Equal hours mean never quiet. A Date shifted by the
   shop's offset has UTC fields that ARE shop-local — the trick reminders.js
   and Partner.stats already use. */
export function holdUntil(nowMs, tzMin, from, to) {
  const f = Number(from), t = Number(to), tz = Number(tzMin) || 0;
  if (!Number.isInteger(f) || !Number.isInteger(t) || f === t) return null;
  const local = nowMs + tz * 60000;
  const h = new Date(local).getUTCHours();
  const quiet = f < t ? (h >= f && h < t) : (h >= f || h < t);
  if (!quiet) return null;
  const day = new Date(local);
  let open = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t);
  if (open <= local) open += 24 * 3600 * 1000;
  return new Date(open - tz * 60000).toISOString();
}

/* ---------------------------------------------------------------- the words */

/* Minor units by the currency's own exponent: 15430 USD is 154.30, never 154. */
function money(d, minor, code) {
  const r = d.prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  const exp = r ? Number(r.minor_exp) || 0 : 0;
  const n = (Number(minor) || 0) / Math.pow(10, exp);
  return n.toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp }) + ' ' + code;
}

/* ---------------------------------------------------------------- the queue */

/* One row into the outbox, or none.

   THE ROW IS WRITTEN EVEN WHEN NO CHAT IS SUBSCRIBED TO THE KIND, and that is
   the opposite of what a reminder does. A reminder asks canReach() first
   because its row is the ledger saying the thing was said — queue one nobody
   wants, let drain() mark it sent, and that evening's close is spent for ever.
   An order alert is news about an event that has already happened and whose key
   can never come round again (push_seen), so there is no occasion to spend:
   the row is queued, drain() marks it sent with "no chat on this side is
   subscribed to dl_out" written into it, and the shop has a record of a thing
   that happened and was heard by nobody. Until somebody ticks the order alerts
   for a chat — which, on this database, nobody has — that is every one of them,
   and the Telegram card says so rather than the event vanishing silently.

   canQueue() is still asked, because a shop with no bot or no linked chat is
   different: drain() skips such a row without bumping its attempts, so it would
   never be marked sent and would show as a backlog for ever. */
export function queueAlert({ kind, saleId = null, refType = 'order', refId, args, dedupe,
                             skipUsers = [], userId = null, nowMs = Date.now() }) {
  if (!Telegram.OFFICE_KINDS.includes(kind)) throw new Error('not an office alert: ' + kind);
  if (!Telegram.canQueue('og')) return 0;
  const d = get();
  const clock = readClock(d);
  const urgent = clock.urgent.includes(kind);
  const hold = urgent ? null : holdUntil(nowMs, clock.tz, clock.from, clock.to);

  /* OVERNIGHT, ONE ROW PER ORDER. A held order row is still news only until a
     stronger one about the same order arrives: the office opening at 13:00
     wants "delivered", not "out" and then "delivered". A weaker one arriving
     after a stronger is dropped for the same reason — unless it is urgent,
     which goes out now whatever is waiting. */
  /* ALREADY SAID. The INSERT below is OR IGNORE on `dedupe`, so a repeat writes
     nothing — but the supersede runs FIRST and would stand a held row down for
     a row that then never appears. One indexed read keeps the two halves from
     disagreeing. */
  if (dedupe && d.prepare('SELECT 1 FROM partner_events WHERE dedupe = ?').get(dedupe)) return 0;

  const w = WEIGHT[kind];
  if (saleId != null && w) {
    const now = new Date(nowMs).toISOString();
    /* A ROW THAT IS WAITING FOR THE SHOP TO OPEN — AND NOTHING ELSE.
       `next_try_at` in the future describes two other things as well: a row
       that FAILED to send and is backing off (telegram.js sets attempts and
       next_try_at together, sent_at untouched), and one every subscribed chat
       has muted. Only the insert leaves `attempts = 0` with no `error`, so
       those two columns are the whole of the difference — and without them a
       bot unreachable for a minute would silently eat the next event on that
       order, or stamp "superseded" on a row that was seconds from going out.
       A muted row cannot be a dl_ row today (mutedNow tests the rem_ prefix),
       but it costs nothing to be right about it here. */
    const held = d.prepare(
      `SELECT id, kind, args_json FROM partner_events
        WHERE audience = 'og' AND channel = 'telegram' AND sent_at IS NULL
          AND ref_id = ? AND next_try_at > ? AND attempts = 0 AND error IS NULL`
    ).all(String(saleId), now).filter((r) => WEIGHT[r.kind]);

    const read = (r) => { try { return JSON.parse(r.args_json) || {}; } catch { return {}; } };
    const bigger = held.filter((r) => WEIGHT[r.kind] > w);

    if (!urgent && bigger.length) {
      /* THE BIGGER NEWS STAYS, BUT IT LEARNS WHAT JUST HAPPENED. Dropping this
         row and walking away is what would make the morning lie: an order
         placed at 11:00 and paid at 11:30 would be read out at 13:00 as "New
         order — still to pay 450,000", because the held row's money was frozen
         when it was queued and nothing ever told it otherwise. So the money
         is refreshed from this event and the count goes up by one. */
      const patch = d.prepare('UPDATE partner_events SET args_json = ? WHERE id = ?');
      for (const r of bigger) {
        const a = read(r);
        a.more = (Number(a.more) || 0) + 1;
        if (args && args.left) a.left = args.left; else delete a.left;
        patch.run(JSON.stringify(a), r.id);
      }
      return 0;
    }

    /* This row is the bigger news, so the held ones stand down — and it counts
       them, or the one sentence that survives would hide how much happened. */
    const drop = d.prepare('UPDATE partner_events SET sent_at = ?, error = ? WHERE id = ?');
    let extra = 0;
    for (const r of held) {
      extra += (Number(read(r).more) || 0) + 1;
      drop.run(now, 'superseded overnight', r.id);
    }
    if (extra) args = { ...args, more: (Number(args && args.more) || 0) + extra };
  }

  const wrote = Partner.queueEvent(d, {
    kind, refType, refId: String(refId), audience: 'og', args, dedupe,
    userId, skipUsers: skipUsers && skipUsers.length ? skipUsers : null, nextTryAt: hold
  });
  /* A row that may go out NOW should not sit for the five-second tick — every
     partner route nudges the drain for exactly this reason. A HELD row is left
     alone: waiting is the whole point of it. */
  if (wrote && !hold) { try { Telegram.nudge(); } catch { /* the tick will find it */ } }
  return wrote;
}

function safely(what, fn) {
  try { return fn(); }
  catch (e) { console.error(`[${nowIso()}] office alert (${what}) —`, e.message); return 0; }
}

/* An order moved. `fresh` is what lib/tracking.js found new on it (Receipt
   events not yet in push_seen), `actors` the accounts whose buttons did it,
   `due` what Receipt.moneyOf says is still owed. */
export function orderMoved(sale, fresh, actors, due) {
  return safely('order ' + (sale && sale.id), () => {
    if (!sale || !sale.order || !Array.isArray(fresh)) return 0;
    const rows = fresh.map((r) => ({ ...r, kind: kindForKey(r.key) })).filter((r) => r.kind);
    if (!rows.length) return 0;
    const lead = rows.reduce((best, r) => (WEIGHT[r.kind] >= WEIGHT[best.kind] ? r : best), rows[0]);
    const d = get();
    const o = sale.order;

    const a = { id: sale.id, method: o.method || null, company: o.company_name || null, more: rows.length - 1 };
    if (due && due.left) a.left = money(d, due.left, sale.currency);
    if (lead.kind === 'dl_paid') {
      const p = ((sale.track && sale.track.payments) || []).find((x) => 'pay:' + x.id === lead.key);
      if (p) { a.amount = money(d, p.amount_order, sale.currency); a.refund = p.kind === 'refund'; }
    }

    const ids = [...(actors || [])].map(Number).filter(Number.isInteger);
    return queueAlert({
      kind: lead.kind, saleId: sale.id, refId: sale.id, args: a,
      dedupe: `dl:${sale.id}:${lead.key}`,
      skipUsers: ids,
      /* The signature names the person only when there was exactly one. */
      userId: ids.length === 1 ? ids[0] : null
    });
  });
}

/* A customer reviewed their delivery. The stars and the words, never the name. */
export function reviewed(sale, out) {
  return safely('review ' + (sale && sale.id), () => {
    if (!sale || !out || !out.review) return 0;
    /* A RE-SAVE THAT CHANGED NOTHING IS NOT NEWS. `updated_at` moves on every
       submit, so it alone would send "Review changed" to the office each time
       somebody opened the form and pressed the button again. */
    if (!out.first && out.same) return 0;
    const r = out.review;
    const words = String(r.comment || '');
    return queueAlert({
      kind: 'dl_review', refId: sale.id,
      args: {
        id: sale.id,
        stars: Math.max(0, Math.min(5, Number(r.rating) || 0)),
        words: words.slice(0, 140) + (words.length > 140 ? '…' : ''),
        edited: !out.first
      },
      /* An edit is a new row: the review changed, and that is worth saying. */
      dedupe: `dl:${sale.id}:review:${r.updatedAt || r.at || nowIso()}`
    });
  });
}

/* A driver's cash reached the counter — from one order's Hand in, or the Cash
   back tab's whole pile. MONEY MOVING BETWEEN PEOPLE: the person who needs to
   know is the one not standing at the counter, which is why it is on the
   manager's preset alone and never on a role's by default. */
export function handedIn(out, user) {
  return safely('hand-in', () => {
    if (!out || out.replayed || !out.took || !Object.keys(out.took).length) return 0;
    const d = get();
    const ids = Array.isArray(out.driverIds) ? out.driverIds
      : (out.driverId != null ? [out.driverId] : []);
    const driverId = out.driverId != null ? Number(out.driverId)
      : (ids.length ? Number(ids[0]) : null);
    /* A NAME ONLY WHEN ONE PERSON'S CASH IS IN THE PILE. `received_by` on a
       payment is whoever RECORDED it — an office clerk as easily as the
       driver — so a pile that is not one driver's gets no name rather than
       the first of several on other people's money. The template drops the
       clause when there is no name. */
    const who = driverId != null && ids.length <= 1
      ? d.prepare('SELECT name FROM users WHERE id = ?').get(driverId) : null;
    const amounts = Object.keys(out.took).sort().map((c) => money(d, out.took[c], c)).join(' + ');
    const orders = Array.isArray(out.orders) ? out.orders.length : (out.saleId ? 1 : 0);
    return queueAlert({
      kind: 'dl_handin', refType: 'handin', refId: driverId != null ? driverId : (out.saleId || 'cash'),
      args: { amounts, driver: who ? who.name : null, orders, noShift: !!out.noShift },
      dedupe: `dl:handin:${out.at || nowIso()}:${driverId != null ? driverId : out.saleId}`,
      skipUsers: user && Number.isInteger(user.id) ? [user.id] : [],
      userId: user ? user.id : null
    });
  });
}
