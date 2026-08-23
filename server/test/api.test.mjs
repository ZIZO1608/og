/* ==========================================================================
   The API, over real HTTP
   --------------------------------------------------------------------------
   auth.test.mjs checks the logic directly. This drives the actual server the
   way a browser does — real sockets, real cookies, real status codes — because
   the interesting failures live in the wiring, not the functions.
   ========================================================================== */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';
import { createApp } from '../index.js';

let server, base;

before(async () => {
  DB.open(':memory:');
  await Auth.createUser({
    username: 'boss', name: 'Zaven', role: 'manager',
    password: 'manager-pass-1', hint: 'the shop year'
  });
  await Auth.createUser({
    username: 'till1', name: 'Lubna', role: 'cashier',
    password: 'cashier-pass-1'
  });

  server = createApp();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  DB.close();
});

/* A tiny client that remembers its cookie, like a browser would. */
function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json, e.g. static file */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
}

async function signedIn(username, password) {
  const call = client();
  const r = await call('POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200, `login failed for ${username}: ${r.text}`);
  return call;
}

/* ------------------------------------------------------------------ health */

describe('health', () => {
  test('reports ok and actually touches the database', async () => {
    const r = await client()('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.warehouses, 2);
  });
});

/* ------------------------------------------------------------------- login */

describe('login endpoint', () => {
  test('good credentials set an httpOnly session cookie', async () => {
    const r = await client()('POST', '/api/auth/login',
      { username: 'boss', password: 'manager-pass-1' });

    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'manager');

    const c = r.headers.get('set-cookie');
    assert.match(c, /og_session=/);
    assert.match(c, /HttpOnly/i, 'without HttpOnly a script can steal the session');
    assert.match(c, /SameSite=Lax/i);
  });

  test('the response never contains the hash, salt or hint', async () => {
    const r = await client()('POST', '/api/auth/login',
      { username: 'boss', password: 'manager-pass-1' });
    assert.doesNotMatch(r.text, /pw_hash|pw_salt|pw_hint/);
  });

  test('a real user with a bad password is indistinguishable from an unknown user', async () => {
    /* The property that matters is not the wording -- "Wrong username or
       password" is correct precisely because it names both ambiguously. It is
       that the two cases are ANSWERED IDENTICALLY. Any difference in status,
       code or message turns the login form into a staff directory. */
    const real    = await client()('POST', '/api/auth/login',
      { username: 'boss', password: 'definitely-not-it' });
    const unknown = await client()('POST', '/api/auth/login',
      { username: 'no-such-person', password: 'definitely-not-it' });

    assert.equal(real.status, 401);
    assert.equal(real.status, unknown.status);
    assert.equal(real.body.code, unknown.body.code);
    assert.equal(real.body.error, unknown.body.error);
  });

  test('a missing body is a 400, not a crash', async () => {
    const r = await client()('POST', '/api/auth/login', {});
    assert.equal(r.status, 400);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    assert.equal(res.status, 400);
  });
});

/* --------------------------------------------------------------- protection */

describe('authentication is required', () => {
  test('an unauthenticated call is refused', async () => {
    const r = await client()('GET', '/api/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'unauthenticated');
  });

  test('a forged cookie does not work', async () => {
    const res = await fetch(base + '/api/auth/me', {
      headers: { Cookie: 'og_session=' + 'a'.repeat(64) }
    });
    assert.equal(res.status, 401);
  });

  test('a signed-in user can read themselves', async () => {
    const call = await signedIn('boss', 'manager-pass-1');
    const r = await call('GET', '/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.username, 'boss');
  });

  test('logging out invalidates the cookie', async () => {
    const call = await signedIn('boss', 'manager-pass-1');
    assert.equal((await call('POST', '/api/auth/logout')).status, 200);
    /* The client keeps sending the now-cleared cookie; the server must refuse. */
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
  });
});

/* -------------------------------------------------------------- permissions */

describe('role boundaries are enforced by the server', () => {
  test('a cashier cannot list staff', async () => {
    const call = await signedIn('till1', 'cashier-pass-1');
    const r = await call('GET', '/api/users');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'forbidden');
  });

  test('a cashier cannot create accounts', async () => {
    const call = await signedIn('till1', 'cashier-pass-1');
    const r = await call('POST', '/api/users', {
      username: 'sneaky', name: 'Sneaky', role: 'manager', password: 'let-me-in-now'
    });
    assert.equal(r.status, 403);
    assert.equal(
      DB.get().prepare('SELECT COUNT(*) AS n FROM users WHERE username=?').get('sneaky').n,
      0, 'the account must not have been created'
    );
  });

  test('a manager can list and create', async () => {
    const call = await signedIn('boss', 'manager-pass-1');

    const list = await call('GET', '/api/users');
    assert.equal(list.status, 200);
    assert.ok(list.body.users.length >= 2);
    assert.doesNotMatch(list.text, /pw_hash|pw_salt/);

    const made = await call('POST', '/api/users', {
      username: 'store1', name: 'Maher', role: 'warehouse', password: 'warehouse-pass-1'
    });
    assert.equal(made.status, 200);
    assert.equal(made.body.user.role, 'warehouse');
  });

  test('a bogus role is rejected', async () => {
    const call = await signedIn('boss', 'manager-pass-1');
    const r = await call('POST', '/api/users', {
      username: 'root9', name: 'Root', role: 'superuser', password: 'a-real-password'
    });
    assert.equal(r.status, 400);
  });

  test('a manager cannot switch off their own account', async () => {
    const call = await signedIn('boss', 'manager-pass-1');
    const me = await call('GET', '/api/auth/me');
    const r = await call('POST', `/api/users/${me.body.user.id}/active`, { active: false });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'self_lockout');
  });
});

/* ------------------------------------------------------- password endpoints */

describe('password changes', () => {
  test('the current password must be proved', async () => {
    const call = await signedIn('till1', 'cashier-pass-1');
    const r = await call('POST', '/api/auth/password',
      { current: 'wrong-one', next: 'something-else-1' });
    assert.equal(r.status, 403,
      'an unattended till would otherwise be a permanent takeover');
  });

  test('a successful change forces re-login', async () => {
    await Auth.createUser({
      username: 'temp1', name: 'Temp', role: 'cashier', password: 'first-password-1'
    });
    const call = await signedIn('temp1', 'first-password-1');

    const r = await call('POST', '/api/auth/password',
      { current: 'first-password-1', next: 'second-password-1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.reauth, true);
    assert.equal((await call('GET', '/api/auth/me')).status, 401);

    const back = await signedIn('temp1', 'second-password-1');
    assert.equal((await back('GET', '/api/auth/me')).status, 200);
  });

  test('a weak new password is refused', async () => {
    const call = await signedIn('till1', 'cashier-pass-1');
    const r = await call('POST', '/api/auth/password',
      { current: 'cashier-pass-1', next: '123' });
    assert.equal(r.status, 400);
  });
});

/* --------------------------------------------------------------------- misc */

describe('router and errors', () => {
  test('an unknown endpoint is 404 json, not html', async () => {
    const r = await client()('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'not_found');
  });

  test('the wrong method gives 405 and says what to use', async () => {
    const r = await client()('GET', '/api/auth/login');
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow'), /POST/);
  });

  test('security headers are present', async () => {
    const r = await client()('GET', '/api/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });
});

/* -------------------------------------------------------------- static files */

describe('serving the app', () => {
  test('index.html is served at the root', async () => {
    const r = await client()('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.text, /<!doctype html>/i);
  });

  test('application files are reachable', async () => {
    assert.equal((await client()('GET', '/js/data.js')).status, 200);
    assert.equal((await client()('GET', '/css/style.css')).status, 200);
  });

  test('test harnesses are NOT reachable', async () => {
    /* Same rule the deploy build enforces: nothing underscore-prefixed ships. */
    for (const f of ['/_selftest.html', '/_mobile.html', '/_shot.html']) {
      assert.equal((await client()('GET', f)).status, 404, `${f} must not be served`);
    }
  });

  test('path traversal cannot escape the app folder', async () => {
    for (const attack of [
      '/../server/data/og.db',
      '/../../Windows/win.ini',
      '/%2e%2e%2fserver%2findex.js',
      '/..%2f..%2fetc%2fpasswd'
    ]) {
      const r = await client()('GET', attack);
      assert.notEqual(r.status, 200, `${attack} must not be served`);
    }
  });

  test('the service worker is served uncached', async () => {
    const r = await client()('GET', '/sw.js');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /no-cache/);
  });
});
