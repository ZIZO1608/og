/* ==========================================================================
   OG SYSTEM — what the shop laptop did while the internet was down [outbox.js]
   --------------------------------------------------------------------------
   Online first, phase 3, wave 1: the till. When the main server stops
   answering, the laptop (a standby, lib/standby.js) takes the till's writes
   itself — and writes down each one, here, as the request it was: "POST
   /api/sales, these lines, cash, by Lubna, at 14:02, and it became INV-2140".
   When the line has been back for a minute the list is sent, oldest first,
   to the main server's own routes (POST /api/copy/replay), and only once
   every entry has an answer does the laptop take a fresh copy.

   THIS IS NOT A SYNC. Nothing is merged. The main server applies each
   request with its own rules, as if the till had sent it late — which is
   exactly what happened.

   A FILE OF ITS OWN (outbox.db, beside og.db). og.db is replaced whole at
   every swap; the list of what has not reached the main server must be the
   one thing a swap cannot touch.

   What may be taken offline is the table below and nothing else — wave 1 is
   the till. Everything else answers "this needs the internet" in words.
   ========================================================================== */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './env.js';

/* The till's writes. `ref` names where a customer id lives in the request,
   so a customer ADDED offline can be pointed at the id the main server gave
   them (see batch()). */
export const KINDS = [
  { kind: 'sale',      method: 'POST',  re: /^\/api\/sales$/,                        ref: 'body' },
  { kind: 'void',      method: 'POST',  re: /^\/api\/sales\/([^/]+)\/void$/ },
  { kind: 'attach',    method: 'POST',  re: /^\/api\/sales\/([^/]+)\/customer$/,     ref: 'body' },
  { kind: 'cust_new',  method: 'POST',  re: /^\/api\/customers$/ },
  { kind: 'cust_edit', method: 'PATCH', re: /^\/api\/customers\/(\d+)$/,             ref: 'path' },
  { kind: 'redeem',    method: 'POST',  re: /^\/api\/customers\/(\d+)\/redeem$/,     ref: 'path' },
  { kind: 'want',      method: 'POST',  re: /^\/api\/wants$/,                        ref: 'body' }
];

export function kindOf(method, path) {
  return KINDS.find((k) => k.method === method && k.re.test(path)) || null;
}

let db = null;
function open() {
  if (db) return db;
  db = new DatabaseSync(join(dataDir(), 'outbox.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS entries (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid       TEXT NOT NULL UNIQUE,
      kind       TEXT NOT NULL,
      method     TEXT NOT NULL,
      path       TEXT NOT NULL,
      body       TEXT NOT NULL,
      user_id    INTEGER,
      user_name  TEXT,
      at         TEXT NOT NULL,
      shift_id   TEXT,
      local_ref  TEXT,            -- the sale's number, or the customer's id here
      state      TEXT NOT NULL,   -- open · ready · sent · refused · unsure · blocked · dismissed
      code       TEXT,
      error      TEXT,
      remote     TEXT,            -- what the main server answered, for a sent one
      tries      INTEGER NOT NULL DEFAULT 0,
      sent_at    TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_state ON entries (state, seq);
    CREATE TABLE IF NOT EXISTS idmap (
      kind   TEXT NOT NULL,
      local  TEXT NOT NULL,
      remote TEXT NOT NULL,
      PRIMARY KEY (kind, local)
    );
  `);
  return db;
}

export function close() { if (db) { try { db.close(); } catch { /* closed */ } db = null; } }

/* Before the write runs: the request as it was, in state `open`. Written
   FIRST so a crash in the middle leaves a trace (recover()). */
export function begin({ kind, method, path, body, user, at }) {
  const uuid = randomUUID();
  open().prepare(
    `INSERT INTO entries (uuid, kind, method, path, body, user_id, user_name, at, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(uuid, kind, method, path, JSON.stringify(body ?? {}), user ? user.id : null,
        user ? (user.name || user.username || null) : null, at, new Date().toISOString());
  return uuid;
}

/* After it: kept as `ready` when the laptop accepted it, deleted when it
   refused it — a refused sale happened nowhere, and has nothing to replay. */
export function finish(uuid, { ok, localRef = null, shiftId = null }) {
  const d = open();
  if (ok) {
    d.prepare("UPDATE entries SET state = 'ready', local_ref = ?, shift_id = ? WHERE uuid = ? AND state = 'open'")
      .run(localRef == null ? null : String(localRef), shiftId, uuid);
  } else {
    d.prepare("DELETE FROM entries WHERE uuid = ? AND state = 'open'").run(uuid);
  }
}

/* At start: an entry still `open` was being written when the process died.
   A sale carries the till's opId, and the local applied_ops says whether it
   landed; anything else cannot be known, and a person is asked. */
export function recover(appliedResult) {
  const d = open();
  let ready = 0, unsure = 0;
  for (const e of d.prepare("SELECT uuid, body FROM entries WHERE state = 'open'").all()) {
    let body = {};
    try { body = JSON.parse(e.body); } catch { /* unreadable */ }
    const res = body && typeof body.opId === 'string' ? appliedResult(body.opId) : null;
    if (res) {
      d.prepare("UPDATE entries SET state = 'ready', local_ref = ? WHERE uuid = ?").run(res.id ?? null, e.uuid);
      ready++;
    } else {
      d.prepare("UPDATE entries SET state = 'unsure', code = 'interrupted', error = ? WHERE uuid = ?")
        .run('The laptop stopped while this was being saved. Check it by hand.', e.uuid);
      unsure++;
    }
  }
  return { ready, unsure };
}

export function counts() {
  const d = open();
  const n = (w) => d.prepare(`SELECT COUNT(*) AS n FROM entries WHERE ${w}`).get().n;
  return {
    waiting: n("state IN ('open','ready')"),
    sales: n("state IN ('open','ready') AND kind = 'sale'"),
    attention: n("state IN ('refused','unsure','blocked')"),
    sent: n("state = 'sent'")
  };
}

/* The copy may not be replaced while this is true: there is work in og.db
   that has not reached the main server. */
export function holdsCopy() {
  return open().prepare("SELECT 1 FROM entries WHERE state IN ('open','ready') LIMIT 1").get() != null;
}

/* The ids of customers ADDED here while offline. They mean nothing on the
   main server until it has made those customers and said what their ids are. */
function localCustomers(d) {
  return new Map(d.prepare("SELECT local_ref, state FROM entries WHERE kind = 'cust_new' AND local_ref IS NOT NULL")
    .all().map((r) => [String(r.local_ref), r.state]));
}

/* The next entries to send, oldest first, with every reference to a customer
   added offline turned into the main server's id. An entry whose customer
   has not been made there yet ENDS the batch (it goes in the next one, once
   the answer has given the id); one whose customer was refused is BLOCKED —
   sending it anyway would credit the points to whoever happens to have that
   id on the main server. */
export function batch(max = 20) {
  const d = open();
  const created = localCustomers(d);
  const mapped = new Map(d.prepare("SELECT local, remote FROM idmap WHERE kind = 'customer'").all()
    .map((r) => [String(r.local), String(r.remote)]));
  const out = [];
  for (const e of d.prepare("SELECT * FROM entries WHERE state = 'ready' ORDER BY seq LIMIT ?").all(max)) {
    const k = KINDS.find((x) => x.kind === e.kind);
    let body = {};
    try { body = JSON.parse(e.body); } catch { body = {}; }
    let path = e.path;
    let refId = null;
    if (k && k.ref === 'body' && body.customerId != null && body.customerId !== '') refId = String(body.customerId);
    if (k && k.ref === 'path') refId = String((k.re.exec(path) || [])[1] || '');

    if (refId && created.has(refId)) {
      const remote = mapped.get(refId);
      if (!remote) {
        const st = created.get(refId);
        if (st === 'ready' || st === 'open') break;          // made in this round — next batch
        d.prepare("UPDATE entries SET state = 'blocked', code = 'customer_not_sent', error = ? WHERE uuid = ?")
          .run('The customer this belongs to was added offline and could not be sent.', e.uuid);
        continue;
      }
      if (k.ref === 'body') body.customerId = Number(remote);
      else path = path.replace(k.re, (m, id) => m.replace('/' + id, '/' + remote));
    }
    out.push({
      uuid: e.uuid, kind: e.kind, method: e.method, path, body,
      userId: e.user_id, at: e.at, localRef: e.local_ref, shiftId: e.shift_id
    });
  }
  return out;
}

export function markSent(uuid, answer) {
  const d = open();
  const e = d.prepare('SELECT kind, local_ref FROM entries WHERE uuid = ?').get(uuid);
  d.prepare("UPDATE entries SET state = 'sent', remote = ?, sent_at = ?, tries = tries + 1 WHERE uuid = ?")
    .run(JSON.stringify(answer ?? null).slice(0, 4000), new Date().toISOString(), uuid);
  if (e && e.kind === 'cust_new' && e.local_ref && answer && answer.customer && answer.customer.id != null) {
    d.prepare('INSERT OR REPLACE INTO idmap (kind, local, remote) VALUES (?, ?, ?)')
      .run('customer', String(e.local_ref), String(answer.customer.id));
  }
}

export function markRefused(uuid, code, message) {
  open().prepare("UPDATE entries SET state = 'refused', code = ?, error = ?, tries = tries + 1 WHERE uuid = ?")
    .run(String(code || 'refused').slice(0, 60), String(message || '').slice(0, 300), uuid);
}

/* After a fresh copy is in place: what was sent is in it now, and the local
   ids the map translated no longer exist. What needs a person stays. */
export function afterSwap() {
  const d = open();
  d.prepare("DELETE FROM entries WHERE state = 'sent'").run();
  d.prepare('DELETE FROM idmap').run();
}

/* For the person: every entry that did not make it, newest first. */
export function attention() {
  return open().prepare(
    `SELECT uuid, kind, path, body, user_name, at, local_ref, state, code, error
       FROM entries WHERE state IN ('refused','unsure','blocked') ORDER BY seq DESC LIMIT 100`
  ).all().map((r) => {
    let body = {};
    try { body = JSON.parse(r.body); } catch { body = {}; }
    return {
      uuid: r.uuid, kind: r.kind, at: r.at, who: r.user_name, ref: r.local_ref,
      state: r.state, code: r.code, error: r.error,
      lines: Array.isArray(body.lines) ? body.lines.map((l) => ({ sku: l.sku, qty: l.qty })) : undefined,
      payment: body.payment
    };
  });
}

export function dismiss(uuid) {
  return open().prepare(
    "UPDATE entries SET state = 'dismissed' WHERE uuid = ? AND state IN ('refused','unsure','blocked')"
  ).run(String(uuid || '')).changes > 0;
}
