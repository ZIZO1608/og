/* ==========================================================================
   OG SYSTEM — the people who can sign in                          [people.js]
   --------------------------------------------------------------------------
   Night shift 01, E6. Shared by the Access fold's routes and by
   `npm run users:rebuild`, so an account made either way is made the same
   way: through Auth.createUser, hashed, and — with OG_VAULT_KEY set — with
   its readable password sealed in users.pw_box for the developer panel.

   REMOVING AN ACCOUNT WITHOUT BREAKING HISTORY. Thirty-odd tables point at
   users (a sale's cashier, a movement's hand, a delivery's driver). Deleting
   the row would break them, so every reference is re-pointed first to ONE
   hidden, disabled "Former staff" record (username `former-staff`), which no
   list, picker or fold shows and nobody can sign in as. Rows the mirror
   replays from change_log are logged as they move. If a table will not take
   the re-point (a UNIQUE that two people would now share), that one account
   is kept instead, hidden and disabled with a scrambled password, as
   `former-staff-<old username>` — history is never forced.
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import * as DB from './db.js';
import * as Auth from './auth.js';

export const FORMER = 'former-staff';

/* Tables replayed from change_log — a re-pointed row there must be logged,
   or the mirror keeps the old id for ever. Kept here rather than imported
   from mirror.js, which pulls in the whole HTTP client. */
const LOGGED = new Set([
  'products', 'variants', 'stock', 'customers', 'sales', 'deliveries', 'rooms', 'sections', 'shelves',
  'wants', 'product_colours', 'order_payments', 'handovers', 'order_returns', 'customer_credit',
  'order_reviews', 'print_jobs', 'partner_invoices', 'job_messages', 'suppliers', 'employees',
  'purchase_orders', 'shifts', 'stock_counts', 'job_reviews', 'day_closes', 'errands'
]);

/* Rows that are about the person, not a record of what they did: they go
   with the account instead of moving to Former staff. */
const DROP_WITH = new Set(['sessions', 'user_permissions', 'notification_reads', 'login_attempts']);

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

export function list() {
  return DB.get().prepare('SELECT * FROM users ORDER BY active DESC, name').all()
    .filter((u) => !Auth.isHiddenUser(u));
}

export function shape(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone || null,
    active: !!u.active, lastLoginAt: u.last_login_at || null,
    changed: DB.get().prepare('SELECT COUNT(*) AS n FROM user_permissions WHERE user_id = ?').get(u.id).n
  };
}

/* A new person, with a password made here and returned ONCE. */
export async function add({ name, username, role, phone = null }) {
  const n = String(name ?? '').trim();
  if (!n) throw fail('a name is required', 'name_required');
  if (!Auth.ROLES.includes(role)) throw fail(`"${role}" is not a role`, 'bad_role');
  if (Auth.findByUsername(username)) throw fail(`"${username}" is taken`, 'username_taken', 409);
  if (/^former-staff/i.test(String(username || ''))) throw fail('that username is reserved', 'username_taken', 409);
  const password = Auth.makePassword();
  try {
    const id = await Auth.createUser({ username, name: n, role, password, phone });
    return { user: shape(Auth.findById(id)), password };
  } catch (e) {
    throw fail(e.message, 'bad_username');
  }
}

/* A new password, returned ONCE; every session of that account ends. */
export async function newPassword(id, { mustChange = false } = {}) {
  const u = Auth.findById(id);
  if (!u || Auth.isHiddenUser(u)) throw fail('no such person', 'not_found', 404);
  const password = Auth.makePassword();
  await Auth.resetPassword(u.id, password);
  if (!mustChange) DB.get().prepare('UPDATE users SET must_change = 0 WHERE id = ?').run(u.id);
  return { password };
}

function activeAdmins(exceptId) {
  return DB.get().prepare(
    "SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role IN ('owner','developer') AND id <> ?"
  ).get(exceptId).n;
}

export function setActive(id, active, byUserId) {
  const u = Auth.findById(id);
  if (!u || Auth.isHiddenUser(u)) throw fail('no such person', 'not_found', 404);
  if (!active && id === byUserId) throw fail('You cannot switch off your own account.', 'self_lockout');
  if (!active && ['owner', 'developer'].includes(u.role) && u.active && activeAdmins(u.id) === 0) {
    throw fail('This is the last owner or developer who can sign in.', 'last_owner', 409);
  }
  DB.get().prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, DB.nowIso(), id);
  if (!active) Auth.destroyAllSessions(id);
  return shape(Auth.findById(id));
}

/* Every column anywhere that names a user, read from the schema itself so a
   table added next month is covered. */
export function userRefs(d = DB.get()) {
  const out = [];
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    if (name === 'users') continue;
    for (const fk of d.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
      if (fk.table === 'users') out.push({ table: name, col: fk.from });
    }
  }
  return out;
}

function pkOf(d, table) {
  const cols = d.prepare(`PRAGMA table_info("${table}")`).all().filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  return cols.length === 1 ? cols[0].name : null;
}

/* The hidden record everything is re-pointed to. */
export function formerStaff(d = DB.get()) {
  const have = d.prepare('SELECT id FROM users WHERE username = ?').get(FORMER);
  if (have) return have.id;
  const at = DB.nowIso();
  const info = d.prepare(
    `INSERT INTO users (username, name, role, pw_hash, pw_salt, pw_hint, active, must_change, created_at, updated_at)
     VALUES (?, 'Former staff', 'cashier', ?, ?, NULL, 0, 0, ?, ?)`
  ).run(FORMER, randomBytes(64), randomBytes(16), at, at);
  return Number(info.lastInsertRowid);
}

/* Remove accounts, in one transaction. Returns what happened to each. */
export function removeAccounts(ids, byUserId = null) {
  return DB.tx((d) => {
    const formerId = formerStaff(d);
    const refs = userRefs(d);
    const done = [];
    for (const id of ids) {
      const u = d.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
      if (!u || u.id === formerId) continue;
      d.exec('SAVEPOINT rm');
      let moved = 0;
      try {
        for (const { table, col } of refs) {
          if (DROP_WITH.has(table)) { d.prepare(`DELETE FROM "${table}" WHERE "${col}" = ?`).run(u.id); continue; }
          const pk = LOGGED.has(table) ? pkOf(d, table) : null;
          const keys = pk ? d.prepare(`SELECT "${pk}" AS k FROM "${table}" WHERE "${col}" = ?`).all(u.id).map((r) => r.k) : [];
          const r = d.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE "${col}" = ?`).run(formerId, u.id);
          moved += r.changes;
          for (const k of keys) DB.logChange(table, k, 'update', byUserId, `re-pointed from removed account ${u.username}`);
        }
        d.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        d.exec('RELEASE rm');
        done.push({ id: u.id, username: u.username, outcome: 'removed', moved });
      } catch (e) {
        d.exec('ROLLBACK TO rm');
        d.exec('RELEASE rm');
        /* Kept, hidden and unusable, rather than forcing history to move. */
        const keep = `${FORMER}-${u.username}`.slice(0, 32);
        d.prepare(
          `UPDATE users SET username = ?, name = ?, active = 0, pw_hash = ?, pw_salt = ?, pw_hint = NULL,
                            pw_box = NULL, updated_at = ? WHERE id = ?`
        ).run(keep, 'Former staff – ' + u.username, randomBytes(64), randomBytes(16), DB.nowIso(), u.id);
        d.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        d.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(u.id);
        done.push({ id: u.id, username: u.username, outcome: 'kept-hidden', as: keep, why: e.message });
      }
    }
    Auth.invalidatePermissions();
    return { formerId, done };
  });
}

/* The manager's default set (059's header): everything he had, minus money,
   cost, profit, staff, settings and access. */
export const MANAGER_WITHOUT = (p) =>
  p.startsWith('money.') || p.startsWith('staff.') ||
  ['cost.read', 'profit.read', 'config.write', 'access.write'].includes(p);
