/* ==========================================================================
   OG SYSTEM — paying suppliers and staff                        [payables.js]
   --------------------------------------------------------------------------
   Migration 055 is the shape; this file is the rules.

   SUPPLIERS: a ledger and its running total, the stock pattern. Every row of
   supplier_ledger and the change to suppliers.outstanding are written in one
   transaction, always through post() — there is no other way to move what the
   shop owes, which is what makes audit() worth running.

   STAFF: monthly, with advances. A month is owed salary + bonuses −
   deductions; advances and the salary payment count against it. Only money
   that moved goes through the cash book.

   EVERY PAYMENT CARRIES AN opId. Money out is corrected only by another row,
   so a Pay pressed twice on a stalled line must pay once.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Cash from './cashbook.js';
import { withCap } from './capped.js';

const fail = (message, code, extra) => Object.assign(new Error(message), { code }, extra || {});
const clean = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

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

function needCurrency(d, code) {
  if (typeof code !== 'string' || !d.prepare('SELECT 1 FROM currencies WHERE code = ?').get(code)) {
    throw fail(`unknown currency: ${code}`, 'bad_currency');
  }
  return code;
}

function exp(d, code) {
  const r = d.prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  return r ? r.minor_exp : 0;
}

/* `amount` minor units of `from`, as minor units of `to`, through the shop's
   current USD rates — rounded once, at the end. */
export function convert(d, amount, from, to) {
  if (from === to) return amount;
  const rf = Cash.rateFor(d, from);
  const rt = Cash.rateFor(d, to);
  if (!(rf > 0) || !(rt > 0)) throw fail(`no exchange rate between ${from} and ${to} — set one in Settings`, 'no_rate');
  const whole = amount / Math.pow(10, exp(d, from));
  return Math.round(whole * (rt / rf) * Math.pow(10, exp(d, to)));
}

const positive = (v, what) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw fail(`${what} has to be more than nothing`, 'bad_amount');
  return n;
};

/* ============================================================== suppliers */

const SUPPLIER_SELECT =
  `SELECT s.*,
          (SELECT COALESCE(SUM(amount), 0) FROM supplier_ledger l
            WHERE l.supplier_id = s.id AND l.kind = 'purchase') AS purchased,
          (SELECT COALESCE(-SUM(amount), 0) FROM supplier_ledger l
            WHERE l.supplier_id = s.id AND l.kind IN ('payment', 'reversal')) AS paid,
          (SELECT MAX(at) FROM supplier_ledger l
            WHERE l.supplier_id = s.id AND l.kind = 'payment') AS paid_at,
          (SELECT COUNT(*) FROM supplier_ledger l WHERE l.supplier_id = s.id) AS entries
     FROM suppliers s`;

export function suppliers({ includeArchived = false } = {}) {
  return get().prepare(
    `${SUPPLIER_SELECT} ${includeArchived ? '' : 'WHERE s.archived = 0'} ORDER BY s.name COLLATE NOCASE`
  ).all().map(shapeSupplier);
}

function shapeSupplier(s) {
  if (!s) return null;
  return {
    ...s,
    archived: s.archived,
    /* The columns the ledger keeps, restated from the ledger's own sums so a
       screen never reads a stale cache. */
    total_purchased: s.purchased,
    last_payment: s.paid_at || s.last_payment || null
  };
}

export function supplier(id, d = get()) {
  return shapeSupplier(d.prepare(`${SUPPLIER_SELECT} WHERE s.id = ?`).get(id));
}

/* The one way anything a supplier is owed moves. Inside the caller's
   transaction. */
export function post(d, {
  supplierId, kind, amount, paidAmount = null, paidCurrency = null, fxRate = null,
  place = null, reversesId = null, refType = null, refId = null, note = null, userId = null, at = null
}) {
  const s = d.prepare('SELECT id, currency FROM suppliers WHERE id = ?').get(supplierId);
  if (!s) throw fail('no such supplier', 'not_found');
  if (!Number.isInteger(amount) || amount === 0) throw new Error('a ledger row moves a whole, non-zero amount');
  const when = at || nowIso();
  const rate = fxRate ?? Cash.rateFor(d, paidCurrency || s.currency) ?? 0;
  const info = d.prepare(
    `INSERT INTO supplier_ledger
       (supplier_id, at, kind, amount, currency, paid_amount, paid_currency, fx_rate, place,
        reverses_id, ref_type, ref_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(s.id, when, kind, amount, s.currency, paidAmount, paidCurrency, rate, place,
        reversesId, refType, refId == null ? null : String(refId), clean(note, 300), userId ?? null, nowIso());
  const id = Number(info.lastInsertRowid);

  d.prepare(
    `UPDATE suppliers
        SET outstanding = outstanding + ?,
            total_purchased = total_purchased + ?,
            last_payment = CASE WHEN ? = 'payment' THEN ? ELSE last_payment END,
            updated_at = ?
      WHERE id = ?`
  ).run(amount, kind === 'purchase' ? amount : 0, kind, when, nowIso(), s.id);
  logChange('supplier_ledger', id, 'insert', userId, `${kind} ${amount} ${s.currency}`);
  logChange('suppliers', s.id, 'update', userId, null);
  return id;
}

/* Goods arrived on a purchase order. Called by Purchasing.receive inside its
   own transaction, in the ORDER's currency — converted into the supplier's
   here, at this moment's rate. */
export function receivePurchase(d, { supplierId, value, currency, poId, userId }) {
  const s = d.prepare('SELECT id, currency FROM suppliers WHERE id = ?').get(supplierId);
  if (!s || !value) return null;
  const owed = convert(d, value, currency, s.currency);
  if (!owed) return null;
  return post(d, {
    supplierId, kind: 'purchase', amount: owed,
    paidAmount: currency !== s.currency ? value : null,
    paidCurrency: currency !== s.currency ? currency : null,
    refType: 'po', refId: poId, note: `received on ${poId}`, userId
  });
}

/* Money to a supplier, out of a cash-book place, in whatever currency it was
   paid in — the debt comes down in the supplier's own. Paying more than is
   owed is allowed (an advance to a supplier is ordinary) and said. */
export function paySupplier({ supplierId, amount, currency, place, note = null, opId = null, userId = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;
    const s = d.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
    if (!s) throw fail('no such supplier', 'not_found');
    const paid = positive(amount, 'the payment');
    const cur = needCurrency(d, currency || s.currency);
    Cash.need(d, place);
    const drop = convert(d, paid, cur, s.currency);
    if (!drop) throw fail('that amount is too small to count against this supplier', 'bad_amount');

    const id = post(d, {
      supplierId: s.id, kind: 'payment', amount: -drop,
      paidAmount: cur !== s.currency ? paid : null, paidCurrency: cur !== s.currency ? cur : null,
      fxRate: Cash.rateFor(d, cur), place, note, userId
    });
    Cash.apply(d, {
      place, currency: cur, amount: -paid, kind: 'supplier_pay',
      refType: 'supplier_payment', refId: id, note: s.name, userId
    });
    const after = supplier(s.id, d);
    return remember(d, opId, userId, 'supplier_pay', {
      ledgerId: id, supplier: after, paid, currency: cur, drop,
      warning: after.outstanding < 0 ? 'paid_ahead' : null
    });
  });
}

/* What was owed on paper before the system knew, a correction, or goods sent
   back. `amount` is in the supplier's currency: an opening or an adjustment
   is signed as given (+ the shop owes more); a return always lowers it. */
export function adjustSupplier({ supplierId, kind, amount, note = null, opId = null, userId = null }) {
  if (!['opening', 'adjust', 'return'].includes(kind)) throw fail('opening, adjust or return', 'bad_request');
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;
    let n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n === 0) throw fail('an amount other than zero', 'bad_amount');
    if (kind === 'return') n = -Math.abs(n);
    if (kind === 'adjust' && !clean(note, 300)) throw fail('say why the balance is being corrected', 'needs_note');
    if (kind === 'opening') {
      const had = d.prepare("SELECT 1 FROM supplier_ledger WHERE supplier_id = ? AND kind = 'opening'").get(supplierId);
      if (had) throw fail('this supplier already has an opening balance — correct it with an adjustment', 'already_opened');
    }
    const id = post(d, { supplierId, kind, amount: n, note, userId });
    return remember(d, opId, userId, 'supplier_adjust', { ledgerId: id, supplier: supplier(supplierId, d) });
  });
}

/* A payment recorded by mistake: undone by a row naming it, the debt back up
   and the money back in the place it left. */
export function voidSupplierPayment(ledgerId, { reason = null, userId = null } = {}) {
  return tx((d) => {
    const row = d.prepare('SELECT * FROM supplier_ledger WHERE id = ?').get(ledgerId);
    if (!row) throw fail('no such entry', 'not_found');
    if (row.kind !== 'payment') throw fail('only a payment can be undone here', 'bad_request');
    if (d.prepare('SELECT 1 FROM supplier_ledger WHERE reverses_id = ?').get(row.id)) {
      throw fail('that payment is already undone', 'already_voided');
    }
    const id = post(d, {
      supplierId: row.supplier_id, kind: 'reversal', amount: -row.amount,
      paidAmount: row.paid_amount, paidCurrency: row.paid_currency, fxRate: row.fx_rate,
      place: row.place, reversesId: row.id, note: reason || `undoes payment ${row.id}`, userId
    });
    Cash.reverse(d, {
      refType: 'supplier_payment', refId: row.id, kind: 'supplier_pay', as: 'supplier_pay',
      note: reason || 'payment undone', userId
    });
    return { ledgerId: id, supplier: supplier(row.supplier_id, d) };
  });
}

export function ledger(supplierId, { limit = 200 } = {}) {
  const d = get();
  const n = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200));
  const rows = d.prepare(
    `SELECT l.*, u.name AS user_name,
            (SELECT r.id FROM supplier_ledger r WHERE r.reverses_id = l.id) AS reversed_by
       FROM supplier_ledger l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.supplier_id = ?
      ORDER BY l.at DESC, l.id DESC LIMIT ?`
  ).all(supplierId, n);
  return withCap(rows, n, 'SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id = ?', supplierId);
}

/* Does every running total still equal its log? */
export function audit() {
  const rows = get().prepare(
    `SELECT s.id, s.name, s.outstanding AS running,
            COALESCE((SELECT SUM(amount) FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS summed
       FROM suppliers s`
  ).all();
  return { checked: rows.length, drift: rows.filter((r) => r.running !== r.summed) };
}

/* The editor. What the ledger keeps — outstanding, what was bought, when it
   was last paid — is not writable here. A supplier's currency cannot change
   while money is owed in it: the balance would silently change meaning. */
export function saveSupplier(fields = {}, userId = null) {
  return tx((d) => {
    const at = nowIso();
    const name = clean(fields.name, 80);
    const cur = fields.currency !== undefined ? needCurrency(d, fields.currency) : null;
    const due = fields.due_date ? String(fields.due_date).slice(0, 10) : null;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw fail('a due date is YYYY-MM-DD', 'bad_request');

    if (fields.id) {
      const s = d.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(fields.id));
      if (!s) throw fail('no such supplier', 'not_found');
      if (fields.name !== undefined && !name) throw fail('a supplier needs a name', 'bad_request');
      if (cur && cur !== s.currency && s.outstanding !== 0) {
        throw fail(`this supplier is owed ${s.outstanding} ${s.currency} — settle or adjust it to zero before changing the currency`,
                   'currency_locked');
      }
      d.prepare(
        `UPDATE suppliers SET name = ?, contact = ?, category = ?, currency = ?, due_date = ?,
                archived = ?, updated_at = ? WHERE id = ?`
      ).run(name ?? s.name,
            fields.contact !== undefined ? clean(fields.contact, 120) : s.contact,
            fields.category !== undefined ? clean(fields.category, 40) : s.category,
            cur ?? s.currency,
            fields.due_date !== undefined ? due : s.due_date,
            fields.archived !== undefined ? (fields.archived ? 1 : 0) : s.archived,
            at, s.id);
      logChange('suppliers', s.id, 'update', userId, null);
      return supplier(s.id, d);
    }

    if (!name) throw fail('a supplier needs a name', 'bad_request');
    const info = d.prepare(
      `INSERT INTO suppliers (name, contact, category, currency, due_date, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(name, clean(fields.contact, 120), clean(fields.category, 40),
          cur || (d.prepare("SELECT value FROM config WHERE key = 'shop.base_currency'").get() || {}).value || 'SYP',
          due, at, at);
    const id = Number(info.lastInsertRowid);
    logChange('suppliers', id, 'insert', userId, null);
    return supplier(id, d);
  });
}

/* ================================================================== staff */

function shopMonth(d, ms = Date.now()) {
  const v = Number((d.prepare("SELECT value FROM config WHERE key = 'shop.tz_minutes'").get() || {}).value);
  const tz = Number.isInteger(v) && Math.abs(v) <= 840 ? v : 180;
  return new Date(ms + tz * 60000).toISOString().slice(0, 7);
}

function shopToday(d) {
  const v = Number((d.prepare("SELECT value FROM config WHERE key = 'shop.tz_minutes'").get() || {}).value);
  const tz = Number.isInteger(v) && Math.abs(v) <= 840 ? v : 180;
  return new Date(Date.now() + tz * 60000).toISOString().slice(0, 10);
}

function checkMonth(m) {
  if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw fail('a month is YYYY-MM', 'bad_request');
  return m;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/* One person's month: what is owed, what was paid, what is left. Reversals
   cancel what they name. */
export function monthFor(d, e, month) {
  const rows = d.prepare(
    `SELECT p.*, u.name AS user_name,
            (SELECT r.id FROM salary_payments r WHERE r.reverses_id = p.id) AS reversed_by
       FROM salary_payments p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.employee_id = ? AND p.month = ?
      ORDER BY p.at, p.id`
  ).all(e.id, month);
  const live = rows.filter((r) => r.kind !== 'reversal' && !r.reversed_by);
  const sumOf = (k) => live.filter((r) => r.kind === k).reduce((a, r) => a + r.amount, 0);
  const bonus = sumOf('bonus');
  const deduction = sumOf('deduction');
  const advances = sumOf('advance');
  const salaryPaid = sumOf('salary');
  const due = Math.max(0, (e.salary || 0) + bonus - deduction);
  const paid = advances + salaryPaid;
  return { month, due, bonus, deduction, advances, salaryPaid, paid, left: due - paid, rows };
}

/* The next day this person is due to be paid, in the shop's calendar — this
   month's pay day while this month is unpaid (overdue once it has passed),
   next month's once it is settled. */
export function nextPayDay(d, e) {
  if (!e.pay_day || !(e.salary > 0)) return null;
  const today = shopToday(d);
  let ym = today.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const m = monthFor(d, e, ym);
    if (m.left > 0) return { date: `${ym}-${String(e.pay_day).padStart(2, '0')}`, month: ym, left: m.left };
    ym = addMonths(ym, 1);
  }
  return null;
}

export function employees({ includeArchived = false } = {}) {
  const d = get();
  const month = shopMonth(d);
  return d.prepare(
    `SELECT * FROM employees ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`
  ).all().map((e) => {
    const next = nextPayDay(d, e);
    return {
      ...e,
      /* Derived — nothing writes next_payment any more. */
      next_payment: next ? next.date : null,
      this_month: monthFor(d, e, month)
    };
  });
}

export function payroll({ month = null } = {}) {
  const d = get();
  const ym = month ? checkMonth(month) : shopMonth(d);
  const list = d.prepare(
    `SELECT * FROM employees
      WHERE archived = 0
         OR id IN (SELECT employee_id FROM salary_payments WHERE month = ?)
      ORDER BY name COLLATE NOCASE`
  ).all(ym);
  const people = list.map((e) => {
    const next = nextPayDay(d, e);
    return { ...e, next_payment: next ? next.date : null, ...monthFor(d, e, ym) };
  });
  const totals = {};
  for (const p of people) {
    const t = totals[p.currency] || (totals[p.currency] = { due: 0, paid: 0, left: 0 });
    t.due += p.due; t.paid += p.paid; t.left += Math.max(0, p.left);
  }
  return { month: ym, today: shopToday(d), people, totals };
}

/* Money or an adjustment against one person's month. An advance and the
   salary move money out of a place; a bonus or a deduction only changes what
   the month owes. Paying more than the month still owes is refused — add the
   bonus first, so the record says why. */
export function payStaff({ employeeId, month, kind, amount, place = null, note = null, opId = null, userId = null }) {
  if (!['advance', 'salary', 'bonus', 'deduction'].includes(kind)) {
    throw fail('advance, salary, bonus or deduction', 'bad_request');
  }
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;
    const e = d.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employeeId));
    if (!e) throw fail('no such person on the payroll', 'not_found');
    const ym = checkMonth(month || shopMonth(d));
    const n = positive(amount, 'the amount');
    const moves = kind === 'advance' || kind === 'salary';
    if (moves) Cash.need(d, place);

    const before = monthFor(d, e, ym);
    if (moves && n > before.left) {
      throw fail(before.left > 0
        ? `only ${before.left} ${e.currency} is left to pay for ${ym}`
        : `${ym} is already paid in full`, 'more_than_owed', { left: before.left, currency: e.currency });
    }
    if (kind === 'deduction' && n > before.due) {
      throw fail(`a deduction cannot be more than the month owes (${before.due} ${e.currency})`, 'bad_amount');
    }

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO salary_payments
         (employee_id, month, kind, amount, currency, fx_rate, place, at, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, ym, kind, n, e.currency, Cash.rateFor(d, e.currency) ?? 0,
          moves ? place : null, at, clean(note, 300), userId ?? null, at);
    const id = Number(info.lastInsertRowid);
    logChange('salary_payments', id, 'insert', userId, `${kind} ${n} ${e.currency} ${ym}`);

    if (moves) {
      Cash.apply(d, {
        place, currency: e.currency, amount: -n, kind: 'salary',
        refType: 'salary_payment', refId: id, note: `${e.name} · ${ym}`, userId, at
      });
    }
    return remember(d, opId, userId, 'staff_pay', { id, employeeId: e.id, month: monthFor(d, e, ym) });
  });
}

export function voidStaffPayment(id, { reason = null, userId = null } = {}) {
  return tx((d) => {
    const row = d.prepare('SELECT * FROM salary_payments WHERE id = ?').get(Number(id));
    if (!row) throw fail('no such entry', 'not_found');
    if (row.kind === 'reversal') throw fail('an undo cannot be undone — record it again', 'bad_request');
    if (d.prepare('SELECT 1 FROM salary_payments WHERE reverses_id = ?').get(row.id)) {
      throw fail('that entry is already undone', 'already_voided');
    }
    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO salary_payments
         (employee_id, month, kind, amount, currency, fx_rate, place, reverses_id, at, note, user_id, created_at)
       VALUES (?, ?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.employee_id, row.month, row.amount, row.currency, row.fx_rate, row.place, row.id,
          at, clean(reason, 300) || `undoes ${row.kind} ${row.id}`, userId ?? null, at);
    const rid = Number(info.lastInsertRowid);
    logChange('salary_payments', rid, 'insert', userId, `undo ${row.id}`);
    if (row.kind === 'advance' || row.kind === 'salary') {
      Cash.reverse(d, {
        refType: 'salary_payment', refId: row.id, kind: 'salary', as: 'salary',
        note: reason || 'payment undone', userId
      });
    }
    const e = d.prepare('SELECT * FROM employees WHERE id = ?').get(row.employee_id);
    return { id: rid, month: monthFor(d, e, row.month) };
  });
}

/* Moves money, so it is asked of the route by permission too. */
export const MOVES_MONEY = (kind) => kind === 'advance' || kind === 'salary';

export function saveEmployee(fields = {}, userId = null) {
  return tx((d) => {
    const at = nowIso();
    const name = clean(fields.name, 80);
    const cur = fields.currency !== undefined ? needCurrency(d, fields.currency) : null;
    let salary = null;
    if (fields.salary !== undefined) {
      salary = Math.round(Number(fields.salary));
      if (!Number.isFinite(salary) || salary < 0) throw fail('a salary is zero or more', 'bad_amount');
    }
    let payDay;
    if (fields.pay_day !== undefined) {
      payDay = fields.pay_day === null || fields.pay_day === '' ? null : Math.round(Number(fields.pay_day));
      if (payDay !== null && !(payDay >= 1 && payDay <= 28)) throw fail('pay day is 1 to 28', 'bad_request');
    }
    let uid;
    if (fields.user_id !== undefined) {
      uid = fields.user_id === null || fields.user_id === '' ? null : Number(fields.user_id);
      if (uid !== null && !d.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw fail('no such login', 'bad_request');
    }

    if (fields.id) {
      const e = d.prepare('SELECT * FROM employees WHERE id = ?').get(Number(fields.id));
      if (!e) throw fail('no such person on the payroll', 'not_found');
      if (fields.name !== undefined && !name) throw fail('a name is needed', 'bad_request');
      const paidAny = d.prepare('SELECT 1 FROM salary_payments WHERE employee_id = ? LIMIT 1').get(e.id);
      if (cur && cur !== e.currency && paidAny) {
        throw fail('this person has been paid in ' + e.currency + ' — the currency cannot change now', 'currency_locked');
      }
      d.prepare(
        `UPDATE employees SET name = ?, role = ?, currency = ?, salary = ?, pay_day = ?, user_id = ?,
                since = ?, phone = ?, archived = ?, updated_at = ? WHERE id = ?`
      ).run(name ?? e.name,
            fields.role !== undefined ? (clean(fields.role, 40) || e.role) : e.role,
            cur ?? e.currency, salary ?? e.salary,
            payDay !== undefined ? payDay : e.pay_day,
            uid !== undefined ? uid : e.user_id,
            fields.since !== undefined ? clean(fields.since, 10) : e.since,
            fields.phone !== undefined ? clean(fields.phone, 30) : e.phone,
            fields.archived !== undefined ? (fields.archived ? 1 : 0) : e.archived,
            at, e.id);
      logChange('employees', e.id, 'update', userId, null);
      return d.prepare('SELECT * FROM employees WHERE id = ?').get(e.id);
    }

    if (!name) throw fail('a name is needed', 'bad_request');
    const info = d.prepare(
      `INSERT INTO employees (user_id, name, role, currency, salary, pay_day, since, phone, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(uid ?? null, name, clean(fields.role, 40) || 'Staff',
          cur || (d.prepare("SELECT value FROM config WHERE key = 'shop.base_currency'").get() || {}).value || 'SYP',
          salary ?? 0, payDay ?? null, clean(fields.since, 10), clean(fields.phone, 30), at, at);
    const id = Number(info.lastInsertRowid);
    logChange('employees', id, 'insert', userId, null);
    return d.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  });
}

/* The soonest pay day across the payroll, for the bell. */
export function soonestPayDay() {
  const d = get();
  let best = null;
  for (const e of d.prepare('SELECT * FROM employees WHERE archived = 0').all()) {
    const n = nextPayDay(d, e);
    if (!n) continue;
    if (!best || n.date < best.date) best = { ...n, count: 1 };
    else if (n.date === best.date) best.count++;
  }
  return best;
}
