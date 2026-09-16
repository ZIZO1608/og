/* ==========================================================================
   OG SYSTEM — closing the day                                  [dayclose.js]
   --------------------------------------------------------------------------
   Migration 054 is the shape. The night, in two hands:

     1. THE CASHIER COUNTS. Lira and dollars, typed as counted. She is never
        shown what the book expects — checking against a number you already
        know is not a count — and the route never sends it to her.
     2. THE OWNER CONFIRMS. He sees counted, expected and the difference per
        currency, types what he takes home, and in ONE transaction the
        difference is written to the drawer (count_diff, or the opening if the
        book had not started there) and what he took moves drawer → owner.

   The drawer is continuous: tomorrow starts with whatever he left.

   A RECOUNT REPLACES THE COUNT while the owner has not confirmed — a cashier
   who miscounted counts again, and the figure frozen with it is frozen again.
   A confirmed close is history; a wrong one is corrected with a check or a
   move in the cash book, never by editing the close.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Cash from './cashbook.js';

const fail = (message, code, extra) => Object.assign(new Error(message), { code }, extra || {});

function cfg(d, key) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r ? r.value : null;
}

/* The shop-local day, from shop.tz_minutes — the reminders' clock. */
export function dayKey(d, ms = Date.now()) {
  const v = Number(cfg(d, 'shop.tz_minutes'));
  const tz = Number.isInteger(v) && Math.abs(v) <= 840 ? v : 180;
  return new Date(ms + tz * 60000).toISOString().slice(0, 10);
}

function nextId(d) {
  const top = d.prepare(
    "SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) AS m FROM day_closes WHERE id GLOB 'DC-[0-9]*'"
  ).get().m;
  return 'DC-' + String((top || 0) + 1).padStart(4, '0');
}

function currencies(d) {
  return d.prepare('SELECT code FROM currencies ORDER BY code').all().map((r) => r.code);
}

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

const clean = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/* ----------------------------------------------------------------- reading */

export function byId(id, d = get()) {
  const c = d.prepare('SELECT * FROM day_closes WHERE id = ?').get(id);
  if (!c) return null;
  const lines = d.prepare(
    'SELECT currency, counted, expected, taken FROM day_close_lines WHERE close_id = ? ORDER BY currency'
  ).all(id).map((l) => ({ ...l, diff: l.counted - l.expected, left: l.counted - l.taken }));
  return { ...c, lines };
}

/* The count waiting for the owner, if there is one. */
export function open(d = get()) {
  const c = d.prepare(
    "SELECT id FROM day_closes WHERE status = 'counted' ORDER BY counted_at DESC LIMIT 1"
  ).get();
  return c ? byId(c.id, d) : null;
}

export function recent({ limit = 30 } = {}) {
  const d = get();
  const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 30));
  return d.prepare('SELECT id FROM day_closes ORDER BY counted_at DESC LIMIT ?').all(n)
    .map((r) => byId(r.id, d));
}

/* What a person who only COUNTS may see of a close: that it exists and who
   counted it. Never the expected figure or the difference — the count stays
   blind even on the second attempt. */
export function blind(c) {
  if (!c) return null;
  return {
    id: c.id, day: c.day, status: c.status, counted_at: c.counted_at,
    counted_name: c.counted_name, note: c.note,
    lines: c.lines.map((l) => ({ currency: l.currency, counted: l.counted }))
  };
}

/* ------------------------------------------------------------------ count */

export function count({ counted = {}, note = null, opId = null, userId = null, userName = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;

    const curs = currencies(d);
    const given = {};
    for (const [cur, v] of Object.entries(counted || {})) {
      if (!curs.includes(cur)) throw fail(`unknown currency: ${cur}`, 'bad_currency');
      if (v === null || v === undefined || v === '') continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0) throw fail('a count is zero or more', 'bad_amount');
      given[cur] = n;
    }
    if (!Object.keys(given).length) throw fail('type what is in the drawer', 'bad_amount');

    /* Every currency the drawer holds must be counted, or the owner would
       confirm a night with the dollars missing and nobody would know. */
    const missing = curs.filter((c) => given[c] === undefined && Cash.balanceOf(d, 'drawer', c) !== 0);
    if (missing.length) {
      throw fail(`count the ${missing.join(' and ')} in the drawer too`, 'count_all', { missing });
    }

    const at = nowIso();
    const existing = open(d);
    const id = existing ? existing.id : nextId(d);
    if (existing) {
      d.prepare(
        `UPDATE day_closes SET counted_by = ?, counted_name = ?, counted_at = ?, day = ?,
                note = ?, updated_at = ? WHERE id = ?`
      ).run(userId ?? null, userName ?? null, at, dayKey(d), clean(note, 300), at, id);
      d.prepare('DELETE FROM day_close_lines WHERE close_id = ?').run(id);
    } else {
      d.prepare(
        `INSERT INTO day_closes (id, day, status, counted_by, counted_name, counted_at, note, created_at, updated_at)
         VALUES (?, ?, 'counted', ?, ?, ?, ?, ?, ?)`
      ).run(id, dayKey(d), userId ?? null, userName ?? null, at, clean(note, 300), at, at);
    }

    const ins = d.prepare(
      'INSERT INTO day_close_lines (close_id, currency, counted, expected, taken) VALUES (?, ?, ?, ?, 0)'
    );
    for (const cur of curs) {
      if (given[cur] === undefined) continue;
      /* FROZEN HERE — see 054. */
      ins.run(id, cur, given[cur], Cash.balanceOf(d, 'drawer', cur));
    }
    logChange('day_closes', id, existing ? 'update' : 'insert', userId, existing ? 'recounted' : 'counted');

    return remember(d, opId, userId, 'day_count', { close: byId(id, d), recount: !!existing });
  });
}

/* --------------------------------------------------------------- confirm */

export function confirm(id, { taken = {}, ownerNote = null, opId = null, userId = null, userName = null }) {
  return tx((d) => {
    const seen = replay(d, opId);
    if (seen) return seen;

    const c = byId(id, d);
    if (!c) throw fail('no such day close', 'not_found');
    if (c.status !== 'counted') throw fail(`that close is already ${c.status}`, 'bad_status');

    const at = nowIso();
    for (const l of c.lines) {
      const raw = taken ? taken[l.currency] : undefined;
      const take = raw === undefined || raw === null || raw === '' ? 0 : Math.round(Number(raw));
      if (!Number.isFinite(take) || take < 0) throw fail('what was taken is zero or more', 'bad_amount');
      if (take > l.counted) {
        throw fail(`only ${l.counted} ${l.currency} was counted — more cannot be taken`, 'take_too_much',
                   { currency: l.currency, counted: l.counted });
      }

      /* The count, against the book as it stood when it was made. Written
         even when it matches: "counted on the 16th, exact" is evidence, and it
         is what dates the drawer's last check. The first count of a currency
         the book never started is the drawer's opening, not a shortage. */
      const opened = !!d.prepare(
        "SELECT 1 FROM money_moves WHERE place = 'drawer' AND currency = ? AND kind = 'opening' LIMIT 1"
      ).get(l.currency);
      Cash.apply(d, {
        place: 'drawer', currency: l.currency, amount: l.counted - l.expected,
        kind: opened ? 'count_diff' : 'opening',
        refType: 'day_close', refId: id,
        note: `counted ${l.counted}, book ${l.expected}`, userId, at
      });

      if (take > 0) {
        const out = Cash.apply(d, {
          place: 'drawer', currency: l.currency, amount: -take, kind: 'transfer',
          refType: 'day_close', refId: id, note: 'taken home', userId, at
        });
        Cash.apply(d, {
          place: 'owner', currency: l.currency, amount: take, kind: 'transfer',
          refType: 'day_close', refId: id, note: 'taken home', userId, at, pairId: out
        });
      }
      d.prepare('UPDATE day_close_lines SET taken = ? WHERE close_id = ? AND currency = ?')
        .run(take, id, l.currency);
    }

    d.prepare(
      `UPDATE day_closes SET status = 'closed', confirmed_by = ?, confirmed_name = ?, confirmed_at = ?,
              owner_note = ?, updated_at = ? WHERE id = ?`
    ).run(userId ?? null, userName ?? null, at, clean(ownerNote, 300), at, id);
    logChange('day_closes', id, 'update', userId, 'confirmed');

    return remember(d, opId, userId, 'day_confirm', { close: byId(id, d) });
  });
}

/* A count the owner will not confirm — counted on the wrong day, or by the
   wrong person. Nothing has moved yet, so nothing needs undoing. */
export function cancel(id, { userId = null } = {}) {
  return tx((d) => {
    const c = d.prepare('SELECT status FROM day_closes WHERE id = ?').get(id);
    if (!c) throw fail('no such day close', 'not_found');
    if (c.status !== 'counted') throw fail(`that close is already ${c.status}`, 'bad_status');
    d.prepare("UPDATE day_closes SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), id);
    logChange('day_closes', id, 'update', userId, 'cancelled');
    return byId(id, d);
  });
}
