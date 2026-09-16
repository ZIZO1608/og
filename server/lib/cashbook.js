/* ==========================================================================
   OG SYSTEM — the cash book                                   [cashbook.js]
   --------------------------------------------------------------------------
   Where every lira and dollar is, right now. Migration 053 is the shape; this
   file is the rules.

   PLACES AND MOVES. A place is where money physically is — the drawer, the
   owner's own pocket, a transfer office, a driver who has not handed in. A
   move is one signed row. A balance is the sum of a place's moves in one
   currency, derived every time and stored nowhere.

   EVERY MONEY WRITE THE SYSTEM ALREADY MAKES WRITES ITS MOVE IN THE SAME
   TRANSACTION. A sale, a debt paid, an order payment, a refund, an expense, a
   payment to Yalla Wear — each calls apply() inside the DB.tx it already
   holds, so the money and the reason for it commit together or not at all.
   apply() deliberately opens no transaction of its own, like Stock.apply,
   and for the same reason: DB.tx refuses to nest, and a half-written sale
   is worse than a refused one.

   A NEGATIVE BALANCE IS ALLOWED, AND SAID. Stock refuses to go below zero
   because two tills racing for the last pair must not both win. Money is the
   other way round: a wallet reading -50,000 means something coming IN was not
   recorded, and refusing to pay a supplier out of it would stop the shop
   recording the payment at all. The screen draws it amber and names it.

   NO DATA IS INVENTED. The 20 sales before this table existed have no moves
   and never will: that cash went home weeks ago. The owner's first check of
   each place is an `opening`, and the arithmetic starts true from there.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import { withCap } from './capped.js';

/* Every kind this file writes. A kind outside the list is refused rather than
   stored, because the statement reads kinds and an unknown one would be money
   the profit and loss silently cannot place. */
export const KINDS = new Set([
  'sale', 'sale_void', 'debt_in', 'order_in', 'order_refund',
  'expense', 'expense_void', 'partner_pay',
  'owner_draw', 'owner_in', 'transfer', 'exchange', 'fee',
  'count_diff', 'opening',
  /* 055 — a supplier paid, a salary or an advance paid. */
  'supplier_pay', 'salary'
]);

/* The three a zero is meaningful for — the same list the CHECK in 053 names.
   A check that matched is evidence; a first balance of nothing is a start; a
   void of an expense written before the cash book is the only record that it
   was voided. Every other zero is a mistake. */
const ZERO_OK = new Set(['opening', 'count_diff', 'expense_void']);

/* Payment methods that move no money: a debt, a delivery order (its payments
   move it), and credit the shop is already holding for somebody. */
const NO_MONEY = new Set(['credit', 'order', 'store_credit']);

const fail = (message, code, extra) => Object.assign(new Error(message), { code }, extra || {});

/* ---------------------------------------------------------------- settings */

function cfgJson(d, key, fallback) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  try {
    const v = JSON.parse(r ? r.value : 'null');
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

function methods(d) {
  const list = cfgJson(d, 'pay.methods', []);
  return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string') : [];
}

function extras(d) {
  const list = cfgJson(d, 'money.places', []);
  return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string') : [];
}

/* USD -> code, the direction every rate in this database is stored in. */
export function rateFor(d, code) {
  if (code === 'USD') return 1;
  const r = d.prepare(
    `SELECT rate FROM fx_rates WHERE base = 'USD' AND quote = ?
      ORDER BY set_at DESC, id DESC LIMIT 1`
  ).get(code);
  return r ? r.rate : null;
}

function minorExp(d, code) {
  const r = d.prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  if (!r) throw fail(`unknown currency: ${code}`, 'bad_currency');
  return r.minor_exp;
}

/* ------------------------------------------------------------------ places */

/* Which place a payment method puts its money into, or null for a method
   that moves none. A method the list does not know is null too — the caller
   decides what that means — except the two that put paper in the drawer
   before the list existed. */
export function placeForMethod(d, methodId) {
  if (!methodId || NO_MONEY.has(methodId)) return null;
  const m = methods(d).find((x) => x.id === methodId);
  if (!m) return (methodId === 'cash' || methodId === 'cod') ? 'drawer' : null;
  return m.drawer ? 'drawer' : 'm:' + m.id;
}

/* Door cash sits with whoever received it until it is handed in. */
export function driverPlace(userId) {
  return userId ? 'driver:' + userId : 'drawer';
}

/* Every place this shop has, including ones switched off — a wallet the
   owner stopped using keeps the money still in it until it is moved out. */
export function places(d = get()) {
  const out = [
    { id: 'drawer', kind: 'drawer', active: true },
    { id: 'owner', kind: 'owner', active: true }
  ];
  for (const m of methods(d)) {
    if (m.drawer || NO_MONEY.has(m.id)) continue;
    out.push({
      id: 'm:' + m.id, kind: 'wallet', method: m.id,
      en: m.en || m.id, ar: m.ar || m.en || m.id, active: m.active !== false
    });
  }
  for (const x of extras(d)) {
    out.push({
      id: 'x:' + x.id, kind: 'extra',
      en: x.en || x.ar || x.id, ar: x.ar || x.en || x.id, active: x.active !== false
    });
  }
  for (const u of d.prepare(
    "SELECT id, name, active FROM users WHERE role = 'delivery' ORDER BY name").all()) {
    out.push({ id: 'driver:' + u.id, kind: 'driver', userId: u.id, en: u.name, ar: u.name, active: !!u.active });
  }
  return out;
}

export function place(d, id) {
  const hit = places(d).find((p) => p.id === id);
  if (hit || typeof id !== 'string' || !id.startsWith('driver:')) return hit || null;
  /* Anybody holding door cash, not only the delivery role — see snapshot. */
  const u = d.prepare('SELECT id, name, active FROM users WHERE id = ?').get(Number(id.slice(7)));
  return u ? { id, kind: 'driver', userId: u.id, en: u.name, ar: u.name, active: !!u.active } : null;
}

/* A place a write may name. Refused by name rather than stored, because a
   typo here is money that lands somewhere no screen ever draws. */
export function need(d, id) {
  const p = typeof id === 'string' ? place(d, id) : null;
  if (!p) throw fail(`there is no place called "${id}"`, 'bad_place');
  return p;
}

function needCurrency(d, code) {
  if (typeof code !== 'string' || !d.prepare('SELECT 1 FROM currencies WHERE code = ?').get(code)) {
    throw fail(`unknown currency: ${code}`, 'bad_currency');
  }
  return code;
}

function positive(v, what) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw fail(`${what} has to be more than nothing`, 'bad_amount');
  return n;
}

/* ------------------------------------------------------------------ one move
   Must be called inside a transaction the caller owns. Returns the new id. */
export function apply(d, {
  place: where, currency, amount, kind, refType = null, refId = null,
  note = null, userId = null, pairId = null, at = null, fxRate = null
}) {
  if (!KINDS.has(kind)) throw new Error(`unknown money move: ${kind}`);
  if (typeof where !== 'string' || !where) throw new Error('a money move needs a place');
  if (!Number.isInteger(amount)) throw new Error('a money move is a whole number of minor units');
  if (amount === 0 && !ZERO_OK.has(kind)) throw new Error(`a ${kind} of nothing is not a move`);
  needCurrency(d, currency);

  const rate = fxRate ?? rateFor(d, currency);
  if (!(rate > 0)) throw fail(`no exchange rate for USD/${currency} — set one in Settings`, 'no_rate');

  const now = nowIso();
  /* One format, UTC — the book is sorted and windowed as text, and the
     mirror's column is a timestamp that refuses anything else, which would
     take the whole batch down with it. A caller's date that will not parse
     is now. */
  const when = at ? new Date(at) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toISOString() : now;
  const info = d.prepare(
    `INSERT INTO money_moves
       (at, place, currency, amount, kind, fx_rate, pair_id, ref_type, ref_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(stamp, where, currency, amount, kind, rate, pairId ?? null,
        refType ?? null, refId === null || refId === undefined ? null : String(refId),
        note ? String(note).slice(0, 300) : null, userId ?? null, now);
  const id = Number(info.lastInsertRowid);
  /* Not for the mirror's bookmark — this table is pushed above its highest
     id — but so the commit hook wakes the sync a couple of seconds later
     rather than on the next tick. */
  logChange('money_moves', id, 'insert', userId, `${kind} ${amount} ${currency} @ ${where}`);
  return id;
}

/* Undo every move of `kind` written against a reference, as new rows. Used by
   a void: the sale happened and was reversed, and the book shows both. */
export function reverse(d, { refType, refId, kind, as, note = null, userId = null }) {
  const rows = d.prepare(
    'SELECT * FROM money_moves WHERE ref_type = ? AND ref_id = ? AND kind = ?'
  ).all(refType, String(refId), kind);
  const ids = [];
  for (const r of rows) {
    ids.push(apply(d, {
      place: r.place, currency: r.currency, amount: -r.amount, kind: as,
      refType, refId, note: note || r.note, userId, pairId: r.id, fxRate: r.fx_rate
    }));
  }
  return ids;
}

export function balanceOf(d, where, currency) {
  return d.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS n FROM money_moves WHERE place = ? AND currency = ?'
  ).get(where, currency).n;
}

/* Door cash reached the shop. What the driver was holding moves into the
   drawer; a payment taken before the cash book existed was never recorded as
   his, so it simply arrives. */
export function handInPayment(d, { paymentId, currency, amount, userId, note, at }) {
  const took = d.prepare(
    `SELECT place FROM money_moves
      WHERE kind = 'order_in' AND ref_type = 'order_payment' AND ref_id = ? LIMIT 1`
  ).get(String(paymentId));
  const from = took ? took.place : null;
  if (from === 'drawer') return [];
  if (!from) {
    return [apply(d, {
      place: 'drawer', currency, amount, kind: 'order_in',
      refType: 'order_payment', refId: paymentId, note, userId, at
    })];
  }
  const out = apply(d, {
    place: from, currency, amount: -amount, kind: 'transfer',
    refType: 'order_payment', refId: paymentId, note, userId, at
  });
  const into = apply(d, {
    place: 'drawer', currency, amount, kind: 'transfer',
    refType: 'order_payment', refId: paymentId, note, userId, at, pairId: out
  });
  return [out, into];
}

/* ----------------------------------------------------------------- reading */

/* Every place with its balance in each currency, per currency totals, and
   whether the owner has started the book there yet. One read for the screen. */
export function snapshot(d = get()) {
  const list = places(d);
  const byId = new Map(list.map((p) => [p.id, { ...p, balances: {}, opened: false, lastMove: null, lastCheck: null }]));

  const sums = d.prepare(
    `SELECT place, currency, SUM(amount) AS amount, MAX(at) AS last
       FROM money_moves GROUP BY place, currency`
  ).all();
  for (const r of sums) {
    /* A place the lists no longer name — a payment method renamed at the id,
       a config row removed by hand — still holds what it holds. */
    if (!byId.has(r.place)) {
      /* Door cash taken by somebody who is not a driver — a manager marking a
         run delivered — sits with that person, and is named as them. */
      const who = r.place.startsWith('driver:')
        ? d.prepare('SELECT id, name, active FROM users WHERE id = ?').get(Number(r.place.slice(7)))
        : null;
      byId.set(r.place, who
        ? { id: r.place, kind: 'driver', userId: who.id, en: who.name, ar: who.name, active: !!who.active,
            balances: {}, opened: false, lastMove: null, lastCheck: null }
        : { id: r.place, kind: 'unknown', en: r.place, ar: r.place, active: false,
            balances: {}, opened: false, lastMove: null, lastCheck: null });
    }
    const p = byId.get(r.place);
    p.balances[r.currency] = r.amount;
    if (!p.lastMove || r.last > p.lastMove) p.lastMove = r.last;
  }
  for (const r of d.prepare(
    `SELECT place, MAX(at) AS last, SUM(kind = 'opening') AS openings
       FROM money_moves WHERE kind IN ('opening', 'count_diff') GROUP BY place`).all()) {
    const p = byId.get(r.place);
    if (!p) continue;
    p.lastCheck = r.last;
    p.opened = r.openings > 0;
  }

  const totals = {};
  const out = [];
  for (const p of byId.values()) {
    const has = Object.values(p.balances).some((v) => v !== 0);
    /* A driver who has never held the shop's money is not a place anybody
       needs to see; one who is holding some always is. */
    if (p.kind === 'driver' && !has && !p.lastMove) continue;
    if (p.kind === 'unknown' && !has) continue;
    for (const [c, v] of Object.entries(p.balances)) totals[c] = (totals[c] || 0) + v;
    out.push(p);
  }

  const currencies = d.prepare('SELECT code, minor_exp, symbol, symbol_ar FROM currencies ORDER BY code').all();
  const rates = {};
  for (const c of currencies) rates[c.code] = rateFor(d, c.code);

  return {
    places: out,
    totals,
    currencies,
    rates,
    /* Has the owner told the book what any place holds? Until then every
       balance is "since the book started", and the screen says so. */
    started: out.some((p) => p.opened)
  };
}

/* The moves themselves, newest first, with the other side of a transfer or
   an exchange read back so a row can say "Drawer → With the owner". */
export function book({ place: where = null, kind = null, from = null, to = null, limit = 200 } = {}) {
  const d = get();
  const clauses = [];
  const args = [];
  if (where) { clauses.push('m.place = ?'); args.push(String(where)); }
  if (kind) { clauses.push('m.kind = ?'); args.push(String(kind)); }
  /* Normalised through toISOString, like the dashboard's window: `at` is UTC
     text, and a `+03:00` bound compares wrongly as text. A bound that is not
     a date is ignored rather than thrown on. */
  const iso = (v) => { const t = new Date(v); return isNaN(t.getTime()) ? null : t.toISOString(); };
  if (from && iso(from)) { clauses.push('m.at >= ?'); args.push(iso(from)); }
  if (to && iso(to)) { clauses.push('m.at < ?'); args.push(iso(to)); }
  const whereSql = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const n = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200));

  const rows = d.prepare(
    `SELECT m.*, u.name AS user_name,
            COALESCE(p.place,    q.place)    AS other_place,
            COALESCE(p.currency, q.currency) AS other_currency,
            COALESCE(p.amount,   q.amount)   AS other_amount
       FROM money_moves m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN money_moves p ON p.id = m.pair_id AND p.kind = m.kind
       LEFT JOIN money_moves q ON q.pair_id = m.id AND q.kind = m.kind
       ${whereSql}
      ORDER BY m.at DESC, m.id DESC
      LIMIT ?`
  ).all(...args, n);

  return withCap(rows, n, `SELECT COUNT(*) AS n FROM money_moves m ${whereSql}`, ...args);
}

/* ----------------------------------------------------------- the four acts
   Each its own transaction, each idempotent on the caller's opId: a manager
   taps Move, the wifi stalls, they tap again, and the money must not move
   twice. */

function replay(d, opId) {
  if (!opId) return null;
  const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
  return seen ? { ...JSON.parse(seen.result), replayed: true } : null;
}

function remember(d, opId, userId, kind, out) {
  if (!opId) return out;
  d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, ?, ?)')
    .run(opId, nowIso(), userId ?? null, kind, JSON.stringify(out));
  return out;
}

const cleanNote = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);

/* Money from one place to another, in one currency. A transfer office keeps a
   commission when the owner takes money out, so `fee` is what the office kept:
   it leaves the FROM place as its own row, which is the row the statement
   counts as a cost. */
export function transfer({ from, to, currency, amount, fee = 0, note = null, opId = null, userId = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;

    if (from === to) throw fail('the money is already there', 'same_place');
    need(d, from);
    need(d, to);
    needCurrency(d, currency);
    const a = positive(amount, 'the amount');
    const f = fee === null || fee === undefined || fee === '' || Number(fee) === 0 ? 0 : positive(fee, 'the fee');
    const text = cleanNote(note);

    const out = apply(d, { place: from, currency, amount: -a, kind: 'transfer', refType: 'transfer', note: text, userId });
    const into = apply(d, { place: to, currency, amount: a, kind: 'transfer', refType: 'transfer', note: text, userId, pairId: out });
    const feeId = f ? apply(d, { place: from, currency, amount: -f, kind: 'fee', refType: 'transfer', note: text, userId, pairId: out }) : null;

    return remember(d, opId, userId, 'cash_transfer', {
      moves: [out, into, feeId].filter(Boolean), from, to, currency, amount: a, fee: f,
      balances: { from: balanceOf(d, from, currency), to: balanceOf(d, to, currency) }
    });
  });
}

/* Dollars changed into lira, or back, at the rate the office actually gave.
   Two rows at the same place (or `toPlace`), each freezing THAT rate, so the
   difference from the shop's own rate is a real figure the statement can read
   rather than a guess made later. `setRate` makes the rate got the shop's
   rate, in the same transaction. */
export function exchange({ place: where, toPlace = null, give = {}, get: got = {}, setRate = false,
                           note = null, opId = null, userId = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;

    const into = toPlace || where;
    need(d, where);
    need(d, into);
    needCurrency(d, give.currency);
    needCurrency(d, got.currency);
    if (give.currency === got.currency) throw fail('an exchange changes one currency into another', 'same_currency');
    const ga = positive(give.amount, 'what was handed over');
    const ra = positive(got.amount, 'what came back');

    /* Only USD pairs have a rate in this database. */
    const usdSide = give.currency === 'USD' ? { usd: ga, other: ra, code: got.currency }
                  : got.currency === 'USD' ? { usd: ra, other: ga, code: give.currency } : null;
    if (!usdSide) throw fail('an exchange has dollars on one side', 'bad_currency');
    const implied = (usdSide.other / Math.pow(10, minorExp(d, usdSide.code))) /
                    (usdSide.usd / Math.pow(10, minorExp(d, 'USD')));
    if (!(implied > 0) || !Number.isFinite(implied)) throw fail('that is not a rate', 'bad_amount');

    const official = rateFor(d, usdSide.code);
    const text = cleanNote(note);
    const rateOf = (code) => (code === 'USD' ? 1 : implied);

    const out = apply(d, { place: where, currency: give.currency, amount: -ga, kind: 'exchange',
                           refType: 'exchange', note: text, userId, fxRate: rateOf(give.currency) });
    const back = apply(d, { place: into, currency: got.currency, amount: ra, kind: 'exchange',
                            refType: 'exchange', note: text, userId, fxRate: rateOf(got.currency), pairId: out });

    let rateSet = null;
    if (setRate) {
      const at = nowIso();
      const info = d.prepare(
        'INSERT INTO fx_rates (base, quote, rate, set_at, set_by) VALUES (?, ?, ?, ?, ?)'
      ).run('USD', usdSide.code, implied, at, userId ?? null);
      logChange('fx_rates', info.lastInsertRowid, 'insert', userId, `rate from exchange ${out}`);
      rateSet = { base: 'USD', quote: usdSide.code, rate: implied, at };
    }

    /* A rate half or double the shop's is almost always a figure typed in the
       wrong unit — cents as dollars. Recorded, because the office may really
       have given it, but said. */
    const far = official ? (implied / official < 0.5 || implied / official > 2) : false;

    return remember(d, opId, userId, 'cash_exchange', {
      moves: [out, back], place: where, toPlace: into,
      give: { currency: give.currency, amount: ga }, get: { currency: got.currency, amount: ra },
      rate: implied, official, rateSet, warning: far ? 'rate_far' : null
    });
  });
}

/* The owner taking money out for himself, or putting his own money in. Not a
   cost and not takings: the statement draws both below the line. */
export function ownerMove({ direction, place: where = 'owner', currency, amount, note = null,
                            opId = null, userId = null }) {
  if (direction !== 'draw' && direction !== 'in') throw fail('take out or put in', 'bad_request');
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;
    need(d, where);
    needCurrency(d, currency);
    const a = positive(amount, 'the amount');
    const id = apply(d, {
      place: where, currency, amount: direction === 'draw' ? -a : a,
      kind: direction === 'draw' ? 'owner_draw' : 'owner_in',
      refType: 'owner', note: cleanNote(note), userId
    });
    return remember(d, opId, userId, 'cash_owner', {
      moves: [id], direction, place: where, currency, amount: a, balance: balanceOf(d, where, currency)
    });
  });
}

/* Somebody counted the drawer, or read the balance off the Sham Cash app.
   The difference is written — never the number — so "we were 4,000 short in
   March" stays visible. The first check of a place in a currency is the
   OPENING: the book starting, not a shortage. A check that matches is written
   too, as a zero: "checked on the 16th, exact" is worth having. */
export function check({ place: where, currency, counted, note = null, opId = null, userId = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;
    need(d, where);
    needCurrency(d, currency);
    const c = Math.round(Number(counted));
    if (!Number.isFinite(c) || c < 0) throw fail('type what is actually there — zero or more', 'bad_amount');

    const before = balanceOf(d, where, currency);
    const opened = !!d.prepare(
      "SELECT 1 FROM money_moves WHERE place = ? AND currency = ? AND kind = 'opening' LIMIT 1"
    ).get(where, currency);
    const kind = opened ? 'count_diff' : 'opening';
    const id = apply(d, {
      place: where, currency, amount: c - before, kind,
      refType: 'check', note: cleanNote(note), userId
    });
    return remember(d, opId, userId, 'cash_check', {
      moves: [id], place: where, currency, before, counted: c, diff: c - before, kind
    });
  });
}

/* The owner's own places — a safe, a bank. An id that has ever held money is
   never removed, only switched off, for the reason a payment method is not:
   the book still names it. */
const EXTRA_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function savePlaces(list) {
  if (!Array.isArray(list)) throw fail('the places must be a list', 'bad_request');
  return tx((d) => {
    const seen = new Set();
    const clean = list.map((x, i) => {
      const id = String((x && x.id) || '');
      if (!EXTRA_ID.test(id)) throw fail(`place ${i + 1}: "${id}" cannot be an id`, 'bad_request');
      if (seen.has(id)) throw fail(`${id} is listed twice`, 'bad_request');
      seen.add(id);
      const en = String((x && x.en) || '').trim().slice(0, 40);
      const ar = String((x && x.ar) || '').trim().slice(0, 40);
      if (!en && !ar) throw fail(`place ${i + 1} needs a name`, 'bad_request');
      return { id, en: en || ar, ar: ar || en, active: x.active !== false };
    });
    for (const old of extras(d)) {
      if (seen.has(old.id)) continue;
      const used = d.prepare('SELECT 1 FROM money_moves WHERE place = ? LIMIT 1').get('x:' + old.id);
      if (used) throw fail(`${old.en || old.id} has held money — switch it off instead of removing it`, 'place_used');
    }
    d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('money.places', ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(JSON.stringify(clean), nowIso());
    return clean;
  });
}
