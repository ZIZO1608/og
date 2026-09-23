// Night mode's door: snapshot-auth.js with night's own accounts, roles,
// cookie, path and form token. /snapshot's defaults must not move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, hotp, base32Decode, base32Encode, makeAuth, parseUsers } from '../src/snapshot-auth.js';

const SECRET = base32Encode(Buffer.from('night-auth-test-secret'));
const T0 = Date.parse('2026-09-23T21:00:00Z');
const codeAt = (ms) => hotp(base32Decode(SECRET), Math.floor(ms / 30000));
const ROLES = ['owner', 'manager', 'staff'];

let HASH;
async function hash() { return HASH || (HASH = await hashPassword('the-night-password')); }

async function door(clock, extra = []) {
  const users = parseUsers(JSON.stringify([
    { user: 'sara', role: 'staff', scrypt: await hash(), totpSecret: SECRET },
    { user: 'abode', role: 'owner', scrypt: await hash(), totpSecret: SECRET },
    ...extra
  ]), { roles: ROLES });
  return makeAuth({ users, now: () => clock.t, cookieName: 'og_night', path: '/night' });
}

test('a line without a valid role is dropped, not let in with none', async () => {
  const users = parseUsers(JSON.stringify([
    { user: 'sara', role: 'staff', scrypt: await hash(), totpSecret: SECRET },
    { user: 'nobody', scrypt: await hash(), totpSecret: SECRET },
    { user: 'boss', role: 'admin', scrypt: await hash(), totpSecret: SECRET }
  ]), { roles: ROLES });
  assert.deepEqual([...users.keys()], ['sara']);
  assert.equal(users.get('sara').role, 'staff');
});

test('the snapshot still reads its list without roles', async () => {
  const users = parseUsers(JSON.stringify([{ user: 'abode', scrypt: await hash(), totpSecret: SECRET }]));
  assert.equal(users.size, 1);
  assert.equal(users.get('abode').role, null);
});

test('signing in gives a session with its role and a form token', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const r = await a.login({ user: 'SARA', password: 'the-night-password', code: codeAt(T0), ip: '1.1.1.1' });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'staff');
  const w = a.who(r.token);
  assert.equal(w.user, 'sara');
  assert.equal(w.role, 'staff');
  assert.match(w.csrf, /^[0-9a-f]{48}$/);
  assert.equal(a.session(r.token), 'sara');
});

test('the cookie is og_night, HttpOnly, Secure, SameSite=Strict, Path=/night, 12 h', async () => {
  const a = await door({ t: T0 });
  const c = a.cookie('tok');
  for (const part of ['og_night=tok', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/night', 'Max-Age=43200']) {
    assert.ok(c.includes(part), part + ' in ' + c);
  }
  assert.ok(a.clearCookie().includes('Max-Age=0') && a.clearCookie().includes('Path=/night'));
});

test('the snapshot\'s cookie is unchanged: og_snap on /snapshot', async () => {
  const a = makeAuth({ users: new Map(), now: () => T0 });
  assert.equal(a.cookie('t'), 'og_snap=t; HttpOnly; Secure; SameSite=Strict; Path=/snapshot; Max-Age=43200');
});

test('a form token is accepted only from its own session', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const s1 = await a.login({ user: 'sara', password: 'the-night-password', code: codeAt(T0), ip: '1.1.1.2' });
  const s2 = await a.login({ user: 'abode', password: 'the-night-password', code: codeAt(T0), ip: '1.1.1.3' });
  const t1 = a.who(s1.token).csrf, t2 = a.who(s2.token).csrf;
  assert.equal(a.formOk(s1.token, t1), true);
  assert.equal(a.formOk(s1.token, t2), false);
  assert.equal(a.formOk(s1.token, ''), false);
  assert.equal(a.formOk(s1.token, undefined), false);
  assert.equal(a.formOk(s1.token, t1 + 'x'), false);
  assert.equal(a.formOk('no-such-session', t1), false);
});

test('a code is spent once, and a wrong code or password is refused', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  assert.equal((await a.login({ user: 'sara', password: 'wrong-password!', code: codeAt(T0), ip: '2.2.2.1' })).ok, false);
  assert.equal((await a.login({ user: 'sara', password: 'the-night-password', code: '000000', ip: '2.2.2.1' })).ok, false);
  assert.equal((await a.login({ user: 'sara', password: 'the-night-password', code: codeAt(T0), ip: '2.2.2.1' })).ok, true);
  assert.equal((await a.login({ user: 'sara', password: 'the-night-password', code: codeAt(T0), ip: '2.2.2.1' })).ok, false);
});

test('five failures per username, or per address, and the door is shut for 15 minutes', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  for (let i = 0; i < 5; i++) await a.login({ user: 'sara', password: 'x', code: '1', ip: '3.3.3.' + i });
  assert.equal((await a.login({ user: 'sara', password: 'the-night-password', code: codeAt(T0), ip: '3.3.3.99' })).reason, 'throttled');
  for (let i = 0; i < 5; i++) await a.login({ user: 'guess' + i, password: 'x', code: '1', ip: '4.4.4.4' });
  assert.equal((await a.login({ user: 'abode', password: 'the-night-password', code: codeAt(T0), ip: '4.4.4.4' })).reason, 'throttled');
  clock.t += 15 * 60 * 1000 + 1;
  assert.equal((await a.login({ user: 'sara', password: 'the-night-password', code: codeAt(clock.t), ip: '3.3.3.99' })).ok, true);
});

test('a session ends after 12 hours; logout ends it at once', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const r = await a.login({ user: 'abode', password: 'the-night-password', code: codeAt(T0), ip: '5.5.5.5' });
  clock.t += 12 * 3600 * 1000 - 1000;
  assert.ok(a.who(r.token));
  clock.t += 2000;
  assert.equal(a.who(r.token), null);
  const r2 = await a.login({ user: 'abode', password: 'the-night-password', code: codeAt(clock.t), ip: '5.5.5.5' });
  a.logout(r2.token);
  assert.equal(a.who(r2.token), null);
});
