/* ==========================================================================
   OG SYSTEM — Safeers (السفراء): the delivery team              [safeers.js]
   --------------------------------------------------------------------------
   Migration 060. The people are users with the `delivery` role. Their tasks
   are PARCELS (the deliveries table, moved by lib/deliveries.js exactly as
   the board moves them) and ERRANDS (here). Their pay is derived: every
   delivered parcel and every done errand is one, times config safeer.rate.
   The cash on them is lib/orders.js driverCash(), not a second copy.

   Earned and cash are money: the caller decides whether this account may
   see them (money.read) and they are left OUT otherwise, not zeroed.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Orders from './orders.js';

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

function cfg(key, fallback) {
  const r = get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}

export function rate() {
  const r = cfg('safeer.rate', null);
  if (!r || !(Number(r.amount) >= 0) || !r.currency) return null;
  return { amount: Math.round(Number(r.amount)), currency: String(r.currency) };
}
export function areas() {
  const a = cfg('safeer.areas', []);
  return Array.isArray(a) ? a : [];
}

export function saveSettings({ rate: r, areas: a }, userId) {
  const at = nowIso();
  const d = get();
  const put = d.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  if (r !== undefined) {
    if (r === null) put.run('safeer.rate', 'null', at);
    else {
      const amount = Math.round(Number(r.amount));
      if (!(amount >= 0)) throw fail('the rate must be a number, not below zero', 'bad_rate');
      const cur = d.prepare('SELECT code FROM currencies WHERE code = ?').get(String(r.currency || ''));
      if (!cur) throw fail('unknown currency', 'bad_currency');
      put.run('safeer.rate', JSON.stringify({ amount, currency: cur.code }), at);
    }
  }
  if (a !== undefined) {
    if (!Array.isArray(a)) throw fail('areas must be a list', 'bad_areas');
    const seen = new Set();
    const clean = a.map((x, i) => {
      const en = String(x.en ?? '').trim(), ar = String(x.ar ?? '').trim();
      if (!en && !ar) throw fail(`area ${i + 1} needs a name`, 'bad_areas');
      let id = String(x.id || en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('area-' + (i + 1)));
      while (seen.has(id)) id += '-2';
      seen.add(id);
      return { id, en: en || ar, ar: ar || en, active: x.active !== false };
    });
    put.run('safeer.areas', JSON.stringify(clean), at);
  }
  return { rate: rate(), areas: areas() };
}

/* ---------------------------------------------------------------- the team */

function shopDay(tz) {
  const off = Number(tz) || 180;
  const now = new Date(Date.now() + off * 60000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - off * 60000);
  const dow = (now.getUTCDay() + 1) % 7;          /* Saturday = 0 */
  const week = new Date(day.getTime() - dow * 86400000);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - off * 60000);
  return { day: day.toISOString(), week: week.toISOString(), month: month.toISOString() };
}

function doneSince(d, userId, since) {
  const p = d.prepare(
    "SELECT COUNT(*) AS n FROM deliveries WHERE driver_id = ? AND status = 'delivered' AND closed_at >= ?"
  ).get(userId, since).n;
  const e = d.prepare(
    "SELECT COUNT(*) AS n FROM errands WHERE safeer_id = ? AND status = 'done' AND closed_at >= ?"
  ).get(userId, since).n;
  return p + e;
}

export function team({ money = false, tz = 180 } = {}) {
  const d = get();
  const when = shopDay(tz);
  const r = rate();
  const people = d.prepare(
    `SELECT id, username, name, phone, active, last_login_at FROM users
      WHERE role = 'delivery' AND username NOT LIKE 'former-staff%'
      ORDER BY active DESC, name`
  ).all();
  const cash = money ? Orders.driverCash().totals : [];
  return {
    rate: money ? r : undefined,
    people: people.map((u) => {
      const parcelsOpen = d.prepare(
        "SELECT COUNT(*) AS n, SUM(status = 'out') AS out FROM deliveries WHERE driver_id = ? AND status IN ('waiting','out')"
      ).get(u.id);
      const errandsOpen = d.prepare(
        "SELECT COUNT(*) AS n, SUM(status = 'out') AS out FROM errands WHERE safeer_id = ? AND status IN ('waiting','out')"
      ).get(u.id);
      const today = doneSince(d, u.id, when.day);
      const week = doneSince(d, u.id, when.week);
      const month = doneSince(d, u.id, when.month);
      const row = {
        id: u.id, username: u.username, name: u.name, phone: u.phone || null, active: !!u.active,
        lastLoginAt: u.last_login_at || null,
        busy: (parcelsOpen.out || 0) + (errandsOpen.out || 0) > 0,
        open: parcelsOpen.n + errandsOpen.n,
        done: { today, week, month }
      };
      if (money) {
        row.earned = r ? { currency: r.currency, today: today * r.amount, week: week * r.amount, month: month * r.amount } : null;
        row.cash = cash.filter((c) => c.driverId === u.id).map((c) => ({ currency: c.currency, amount: c.amount, parcels: c.parcels }));
      }
      return row;
    })
  };
}

export function isSafeer(id) {
  const u = get().prepare("SELECT id, role, active FROM users WHERE id = ?").get(id);
  return !!u && u.role === 'delivery';
}

/* ----------------------------------------------------------------- errands */

const KINDS = new Set(['stock_run', 'supplier_pickup', 'bank', 'other']);

function shape(r) {
  return {
    id: r.id, title: r.title, kind: r.kind, from: r.from_place, area: r.to_area, notes: r.notes,
    dueDate: r.due_date, saleId: r.sale_id, safeerId: r.safeer_id, safeerName: r.safeer_name || null,
    assignedBy: r.assigned_by, status: r.status, failReason: r.fail_reason,
    createdAt: r.created_at, outAt: r.out_at, closedAt: r.closed_at
  };
}

/* A safeer sees his own, in the SQL; `mine` is his id or null. */
export function list({ mine = null, safeer = null, status = null, since = null, limit = 200 } = {}) {
  const where = [], args = [];
  if (mine !== null) { where.push('e.safeer_id = ?'); args.push(mine); }
  else if (safeer) { where.push('e.safeer_id = ?'); args.push(Number(safeer)); }
  if (status === 'open') where.push("e.status IN ('waiting','out')");
  else if (status) { where.push('e.status = ?'); args.push(String(status)); }
  if (since) { where.push("(e.status IN ('waiting','out') OR e.closed_at >= ?)"); args.push(String(since)); }
  const rows = get().prepare(
    `SELECT e.*, u.name AS safeer_name FROM errands e LEFT JOIN users u ON u.id = e.safeer_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE e.status WHEN 'out' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, e.created_at DESC
      LIMIT ?`
  ).all(...args, Math.min(500, Number(limit) || 200));
  return rows.map(shape);
}

export function byId(id, mine = null) {
  const r = get().prepare(
    `SELECT e.*, u.name AS safeer_name FROM errands e LEFT JOIN users u ON u.id = e.safeer_id
      WHERE e.id = ?${mine !== null ? ' AND e.safeer_id = ?' : ''}`
  ).get(...(mine !== null ? [id, mine] : [id]));
  return r ? shape(r) : null;
}

function cleanDue(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) throw fail('the due date is not a date', 'bad_due');
  return s;
}

export function create({ title, kind = 'other', from = null, area = null, notes = null, dueDate = null,
                         saleId = null, safeerId = null }, userId) {
  const t = String(title ?? '').trim();
  if (!t) throw fail('an errand needs a title', 'title_required');
  if (!KINDS.has(kind)) throw fail('unknown kind of errand', 'bad_kind');
  const due = cleanDue(dueDate);
  return tx((d) => {
    if (safeerId && !isSafeer(safeerId)) throw fail('no such safeer', 'bad_safeer');
    if (saleId && !d.prepare('SELECT 1 FROM sales WHERE id = ?').get(String(saleId))) throw fail('no such order', 'bad_sale');
    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO errands (title, kind, from_place, to_area, notes, due_date, sale_id, safeer_id,
                            assigned_by, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`
    ).run(t.slice(0, 120), kind, from ? String(from).slice(0, 80) : null, area ? String(area).slice(0, 80) : null,
          notes ? String(notes).slice(0, 500) : null, due, saleId ? String(saleId) : null,
          safeerId ? Number(safeerId) : null, safeerId ? userId : null, at, at);
    const id = Number(info.lastInsertRowid);
    logChange('errands', id, 'insert', userId, null);
    return byId(id);
  });
}

const NEXT = { waiting: ['out', 'failed'], out: ['done', 'failed'], done: [], failed: [] };

/* The manager edits and assigns; the safeer moves his own forward. */
export function update(id, body, user, { mine = null } = {}) {
  return tx((d) => {
    const cur = d.prepare(`SELECT * FROM errands WHERE id = ?${mine !== null ? ' AND safeer_id = ?' : ''}`)
      .get(...(mine !== null ? [id, mine] : [id]));
    if (!cur) throw fail('no such errand', 'not_found', 404);
    const at = nowIso();
    const sets = [], args = [];
    if (mine === null) {
      if (body.title !== undefined) { const t = String(body.title).trim(); if (!t) throw fail('an errand needs a title', 'title_required'); sets.push('title = ?'); args.push(t.slice(0, 120)); }
      if (body.kind !== undefined) { if (!KINDS.has(body.kind)) throw fail('unknown kind of errand', 'bad_kind'); sets.push('kind = ?'); args.push(body.kind); }
      if (body.from !== undefined) { sets.push('from_place = ?'); args.push(body.from || null); }
      if (body.area !== undefined) { sets.push('to_area = ?'); args.push(body.area || null); }
      if (body.notes !== undefined) { sets.push('notes = ?'); args.push(body.notes || null); }
      if (body.dueDate !== undefined) { sets.push('due_date = ?'); args.push(cleanDue(body.dueDate)); }
      if (body.safeerId !== undefined) {
        if (cur.status !== 'waiting') throw fail('it has already left — it cannot be given to someone else now', 'bad_status', 409);
        if (body.safeerId && !isSafeer(body.safeerId)) throw fail('no such safeer', 'bad_safeer');
        sets.push('safeer_id = ?', 'assigned_by = ?'); args.push(body.safeerId || null, body.safeerId ? user.id : null);
      }
    }
    if (body.status !== undefined && body.status !== cur.status) {
      const to = String(body.status);
      if (!NEXT[cur.status] || !NEXT[cur.status].includes(to)) {
        throw fail(`an errand that is ${cur.status} cannot become ${to}`, 'bad_status', 409);
      }
      if (to === 'out' && !(cur.safeer_id || body.safeerId)) throw fail('nobody has been given this errand yet', 'no_safeer', 409);
      if (to === 'failed') {
        const why = String(body.reason ?? '').trim();
        if (!why) throw fail('say why it failed', 'reason_required');
        sets.push('fail_reason = ?'); args.push(why.slice(0, 200));
      }
      sets.push('status = ?'); args.push(to);
      if (to === 'out') { sets.push('out_at = ?'); args.push(at); }
      if (to === 'done' || to === 'failed') { sets.push('closed_at = ?'); args.push(at); }
    }
    if (!sets.length) return byId(id);
    sets.push('updated_at = ?'); args.push(at);
    d.prepare(`UPDATE errands SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    logChange('errands', id, 'update', user.id, null);
    return byId(id);
  });
}
