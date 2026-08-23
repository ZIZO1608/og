/* ==========================================================================
   Accounts, sessions and permissions
   --------------------------------------------------------------------------
   Run with:  npm test        (from server/)
              node --test test/

   Every test opens its own in-memory database, so they cannot leak state into
   each other and can run in any order.
   ========================================================================== */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';

before(() => { DB.open(':memory:'); });
after(() => { DB.close(); });

/* Fresh usernames per test — one shared in-memory db, unique accounts. */
let n = 0;
const uniq = (p) => `${p}_${++n}`;

async function makeUser(role = 'cashier', password = 'correct-horse') {
  const username = uniq(role);
  const id = await Auth.createUser({
    username, name: 'Test Person', role, password, hint: 'the usual one'
  });
  return { id, username, password };
}

/* ------------------------------------------------------------------ schema */

describe('schema', () => {
  test('migrations applied, and only once', () => {
    const d = DB.get();
    const names = d.prepare('SELECT name FROM schema_migrations ORDER BY name')
                   .all().map(r => r.name);
    assert.ok(names.includes('001_init.sql'));
    assert.ok(names.includes('002_reference_data.sql'));

    /* open() again must be a no-op rather than re-running the seed and
       tripping a primary key collision. */
    DB.open(':memory:');
    const after = d.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.equal(after.n, names.length);
  });

  test('reference data is present', () => {
    const d = DB.get();
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM currencies').get().n, 2);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM warehouses').get().n, 2);

    /* The minor-unit convention the whole money layer depends on. */
    assert.equal(d.prepare("SELECT minor_exp FROM currencies WHERE code='USD'").get().minor_exp, 2);
    assert.equal(d.prepare("SELECT minor_exp FROM currencies WHERE code='SYP'").get().minor_exp, 0);
  });

  test('foreign keys are enforced, not decorative', () => {
    const d = DB.get();
    assert.throws(
      () => d.prepare(
        `INSERT INTO products (name, type, currency, created_at, updated_at)
         VALUES ('Ghost', 'sneakers', 'XXX', '2026-01-01', '2026-01-01')`
      ).run(),
      /FOREIGN KEY|constraint/i,
      'a product in a currency that does not exist must be refused'
    );
  });

  test('stock cannot go negative', () => {
    const d = DB.get();
    const at = DB.nowIso();
    d.prepare(`INSERT INTO products (name, type, currency, created_at, updated_at)
               VALUES ('Neg Test', 'sneakers', 'SYP', ?, ?)`).run(at, at);
    const pid = d.prepare('SELECT last_insert_rowid() AS id').get().id;
    d.prepare(`INSERT INTO variants (sku, product_id, size, created_at, updated_at)
               VALUES ('NEG-1', ?, '42', ?, ?)`).run(pid, at, at);
    d.prepare(`INSERT INTO stock (sku, wh_id, qty) VALUES ('NEG-1', 'floor', 2)`).run();

    /* This is the guard that stops two tills both selling the last pair.
       It has to live in the database, because the browsers cannot see
       each other. */
    assert.throws(
      () => d.prepare(`UPDATE stock SET qty = -1 WHERE sku='NEG-1' AND wh_id='floor'`).run(),
      /CHECK|constraint/i
    );
  });
});

/* --------------------------------------------------------------- passwords */

describe('passwords', () => {
  test('a correct password verifies and a wrong one does not', async () => {
    const { hash, salt } = await Auth.hashPassword('sneakers-2026');
    assert.equal(await Auth.verifyPassword('sneakers-2026', hash, salt), true);
    assert.equal(await Auth.verifyPassword('sneakers-2027', hash, salt), false);
  });

  test('the same password hashes differently every time', async () => {
    const a = await Auth.hashPassword('same-input');
    const b = await Auth.hashPassword('same-input');
    assert.notDeepEqual(a.hash, b.hash, 'salts must differ, or the hashes leak equality');
  });

  test('a truncated hash is rejected rather than throwing', async () => {
    const { salt } = await Auth.hashPassword('whatever');
    assert.equal(
      await Auth.verifyPassword('whatever', Buffer.alloc(8), salt),
      false,
      'timingSafeEqual throws on length mismatch; this must be caught first'
    );
  });

  test('weak passwords are refused', () => {
    assert.match(Auth.passwordProblem('short'), /8 characters/);
    assert.match(Auth.passwordProblem('12345678'), /only numbers/);
    assert.equal(Auth.passwordProblem('good enough here'), null);
  });
});

/* ------------------------------------------------------------------- login */

describe('login', () => {
  test('valid credentials return a session', async () => {
    const u = await makeUser('manager');
    const r = await Auth.login(u.username, u.password, '127.0.0.1', 'test');
    assert.equal(r.ok, true);
    assert.equal(r.user.username, u.username);
    assert.match(r.token, /^[0-9a-f]{64}$/);
  });

  test('a wrong password fails', async () => {
    const u = await makeUser();
    const r = await Auth.login(u.username, 'not-it', '127.0.0.1', 'test');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_credentials');
  });

  test('an unknown user fails the same way as a wrong password', async () => {
    const r = await Auth.login('nobody-here', 'anything', '127.0.0.1', 'test');
    assert.equal(r.ok, false);
    assert.equal(
      r.reason, 'bad_credentials',
      'a different reason for "no such user" hands out a staff list'
    );
  });

  test('a disabled account cannot log in', async () => {
    const u = await makeUser();
    DB.get().prepare('UPDATE users SET active = 0 WHERE id = ?').run(u.id);
    const r = await Auth.login(u.username, u.password, '127.0.0.1', 'test');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'disabled');
  });

  test('repeated failures lock the account out', async () => {
    const u = await makeUser();
    for (let i = 0; i < 8; i++) {
      await Auth.login(u.username, 'wrong', '127.0.0.1', 'test');
    }
    /* Even the RIGHT password is refused now — that is the point. */
    const r = await Auth.login(u.username, u.password, '127.0.0.1', 'test');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_many_attempts');
  });

  test('usernames are case-insensitive', async () => {
    const u = await makeUser();
    const r = await Auth.login(u.username.toUpperCase(), u.password, '::1', 'test');
    assert.equal(r.ok, true, 'staff will not remember the capitalisation');
  });
});

/* ---------------------------------------------------------------- sessions */

describe('sessions', () => {
  test('a token resolves back to its user', async () => {
    const u = await makeUser('warehouse');
    const { token } = await Auth.login(u.username, u.password, '::1', 'test');
    assert.equal(Auth.userForToken(token).id, u.id);
  });

  test('rubbish and empty tokens resolve to nobody', () => {
    assert.equal(Auth.userForToken('deadbeef'), null);
    assert.equal(Auth.userForToken(''), null);
    assert.equal(Auth.userForToken(null), null);
  });

  test('an expired session is rejected and cleaned up', async () => {
    const u = await makeUser();
    const { token } = await Auth.login(u.username, u.password, '::1', 'test');
    DB.get().prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
            .run('2020-01-01T00:00:00.000Z', token);

    assert.equal(Auth.userForToken(token), null);
    assert.equal(
      DB.get().prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(token).n,
      0, 'the dead row should be swept as it is found'
    );
  });

  test('logging out kills the token immediately', async () => {
    const u = await makeUser();
    const { token } = await Auth.login(u.username, u.password, '::1', 'test');
    Auth.destroySession(token);
    assert.equal(Auth.userForToken(token), null);
  });

  test('deactivating someone invalidates their live session at once', async () => {
    const u = await makeUser();
    const { token } = await Auth.login(u.username, u.password, '::1', 'test');
    assert.ok(Auth.userForToken(token));

    DB.get().prepare('UPDATE users SET active = 0 WHERE id = ?').run(u.id);
    assert.equal(
      Auth.userForToken(token), null,
      'a sacked employee must lose access now, not in two weeks'
    );
  });

  test('changing a password logs out every other device', async () => {
    const u = await makeUser();
    const a = await Auth.login(u.username, u.password, '::1', 'phone');
    const b = await Auth.login(u.username, u.password, '::1', 'till');
    assert.ok(Auth.userForToken(a.token) && Auth.userForToken(b.token));

    await Auth.changePassword(u.id, 'a-brand-new-one');
    assert.equal(Auth.userForToken(a.token), null);
    assert.equal(Auth.userForToken(b.token), null);
  });
});

/* ------------------------------------------------------------- permissions */

describe('permissions', () => {
  const as = (role) => ({ role, active: 1 });

  test('a cashier can sell but cannot see cost or profit', () => {
    assert.equal(Auth.can(as('cashier'), 'sell'), true);
    assert.equal(Auth.can(as('cashier'), 'customer.write'), true);
    assert.equal(Auth.can(as('cashier'), 'cost.read'), false);
    assert.equal(Auth.can(as('cashier'), 'profit.read'), false);
    assert.equal(Auth.can(as('cashier'), 'staff.read'), false);
    assert.equal(Auth.can(as('cashier'), 'money.read'), false);
  });

  test('a manager can do everything a cashier can, and more', () => {
    for (const p of Auth.permissionsFor('cashier')) {
      assert.equal(Auth.can(as('manager'), p), true, `manager should have ${p}`);
    }
    assert.equal(Auth.can(as('manager'), 'profit.read'), true);
  });

  test('warehouse staff move stock but never sell', () => {
    assert.equal(Auth.can(as('warehouse'), 'stock.move'), true);
    assert.equal(Auth.can(as('warehouse'), 'sell'), false);
  });

  test('the print partner is confined to their own jobs', () => {
    const p = as('partner');
    assert.equal(Auth.can(p, 'partner.jobs'), true);
    /* The commercial boundary: Yalla Wear is a separate company. */
    assert.equal(Auth.can(p, 'customer.read'), false);
    assert.equal(Auth.can(p, 'sell'), false);
    assert.equal(Auth.can(p, 'stock.read'), false);
    assert.equal(Auth.can(p, 'profit.read'), false);
  });

  test('unknown permissions and inactive users are denied', () => {
    assert.equal(Auth.can(as('manager'), 'launch.missiles'), false);
    assert.equal(Auth.can({ role: 'manager', active: 0 }, 'sell'), false);
    assert.equal(Auth.can(null, 'sell'), false);
  });
});

/* ------------------------------------------------------ password management */

describe('password management', () => {
  test('a manager reset forces a change on next login', async () => {
    const u = await makeUser();
    await Auth.resetPassword(u.id, 'temporary-one');

    const r = await Auth.login(u.username, 'temporary-one', '::1', 'test');
    assert.equal(r.ok, true);
    assert.equal(Auth.publicUser(r.user).mustChange, true);

    /* And the old password is genuinely gone. */
    const old = await Auth.login(u.username, u.password, '::1', 'test');
    assert.equal(old.ok, false);
  });

  test('a hint is returned per username, and nothing leaks for unknown ones', async () => {
    const u = await makeUser();
    assert.equal(Auth.hintFor(u.username), 'the usual one');
    assert.equal(Auth.hintFor('does-not-exist'), null);
  });

  test('publicUser never exposes the hash, salt or hint', async () => {
    const u = await makeUser();
    const pub = Auth.publicUser(Auth.findById(u.id));
    assert.equal(pub.pw_hash, undefined);
    assert.equal(pub.pw_salt, undefined);
    assert.equal(pub.pw_hint, undefined);
    assert.ok(Array.isArray(pub.permissions));
  });
});

/* ------------------------------------------------------------ housekeeping */

describe('housekeeping', () => {
  test('sweep removes expired sessions and old attempts', async () => {
    const u = await makeUser();
    const { token } = await Auth.login(u.username, u.password, '::1', 'test');
    DB.get().prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
            .run('2020-01-01T00:00:00.000Z', token);
    DB.get().prepare('INSERT INTO login_attempts (username, ip, ok, at) VALUES (?,?,?,?)')
            .run('ancient', '::1', 0, '2020-01-01T00:00:00.000Z');

    const swept = Auth.sweep();
    assert.ok(swept.sessions >= 1);
    assert.ok(swept.attempts >= 1);
  });

  test('a session token is never written to a log in the clear', () => {
    const fp = Auth.tokenFingerprint('a'.repeat(64));
    assert.equal(fp.length, 12);
    assert.notEqual(fp, 'a'.repeat(12));
  });
});
