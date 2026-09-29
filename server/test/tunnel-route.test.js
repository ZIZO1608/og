// The hosts-file route (lib/hostsroute.js, scripts/tunnel-route.js).
//
// The hosts file belongs to the whole computer and often holds lines somebody
// else put there (a VPN, an ad blocker, a developer). Every edit here must
// keep those byte for byte, add or remove ONLY our block, and refuse to hide
// somebody else's line for the same name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../lib/hostsroute.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STANDBY = { OG_ROLE: 'standby', OG_UPSTREAM: 'http://10.8.0.1:8090', OG_STANDBY_HOME: 'https://shop.ogsports1.com' };
const WINDOWS_DEFAULT =
  '# Copyright (c) 1993-2009 Microsoft Corp.\r\n#\r\n# localhost name resolution is handled within DNS itself.\r\n' +
  '#\t127.0.0.1       localhost\r\n#\t::1             localhost\r\n';

test('only a standby with a tunnel address and a named home needs the line', () => {
  assert.deepEqual(R.wanted(STANDBY), { need: true, ip: '10.8.0.1', host: 'shop.ogsports1.com' });
  assert.equal(R.wanted({ ...STANDBY, OG_ROLE: 'primary' }).why, 'not_standby');
  assert.equal(R.wanted({}).why, 'not_standby');
  assert.equal(R.wanted({ ...STANDBY, OG_UPSTREAM: 'https://shop.ogsports1.com' }).why, 'upstream_not_ip');
  assert.equal(R.wanted({ ...STANDBY, OG_UPSTREAM: '' }).why, 'no_upstream');
  assert.equal(R.wanted({ ...STANDBY, OG_STANDBY_HOME: 'https://10.8.0.1' }).why, 'home_not_name');
  assert.equal(R.wanted({ ...STANDBY, OG_STANDBY_HOME: 'https://localhost:8443' }).why, 'home_not_name');
  assert.equal(R.wanted({ ...STANDBY, OG_STANDBY_HOME: 'SHOP.OgSports1.com' }).why, 'no_home');
  assert.equal(R.wanted({ ...STANDBY, OG_STANDBY_HOME: 'https://SHOP.OgSports1.com/' }).host, 'shop.ogsports1.com');
});

test('adding keeps every other line and appends one block, in CRLF', () => {
  const out = R.withRoute(WINDOWS_DEFAULT, '10.8.0.1', 'shop.ogsports1.com');
  assert.ok(out.startsWith(WINDOWS_DEFAULT), 'the original text is untouched at the top');
  assert.ok(out.endsWith(R.BEGIN + '\r\n10.8.0.1 shop.ogsports1.com\r\n' + R.END + '\r\n'));
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF');
  assert.equal(R.state(out, '10.8.0.1', 'shop.ogsports1.com').state, 'on');
  // Twice is once.
  assert.equal(R.withRoute(out, '10.8.0.1', 'shop.ogsports1.com'), out);
});

test('a file with no final newline, an empty file and a LF file all come out right', () => {
  const noNl = '127.0.0.1 dev.local';
  const a = R.withRoute(noNl, '10.8.0.1', 'shop.ogsports1.com');
  assert.ok(a.startsWith('127.0.0.1 dev.local\r\n' + R.BEGIN));
  const b = R.withRoute('', '10.8.0.1', 'shop.ogsports1.com');
  assert.equal(b, R.BEGIN + '\r\n10.8.0.1 shop.ogsports1.com\r\n' + R.END + '\r\n');
  const lf = '127.0.0.1 a.local\n127.0.0.1 b.local\n';
  const c = R.withRoute(lf, '10.8.0.1', 'shop.ogsports1.com');
  assert.ok(c.startsWith('127.0.0.1 a.local\r\n127.0.0.1 b.local\r\n' + R.BEGIN));
});

test('removing takes out only our block, and gives back the original', () => {
  const out = R.withRoute(WINDOWS_DEFAULT, '10.8.0.1', 'shop.ogsports1.com');
  assert.equal(R.without(out), WINDOWS_DEFAULT);
  assert.equal(R.state(R.without(out), '10.8.0.1', 'shop.ogsports1.com').state, 'off');
  // Our block in the MIDDLE of somebody's lines.
  const mid = '127.0.0.1 a.local\r\n' + R.BEGIN + '\r\n10.8.0.1 shop.ogsports1.com\r\n' + R.END + '\r\n127.0.0.1 b.local\r\n';
  assert.equal(R.without(mid), '127.0.0.1 a.local\r\n127.0.0.1 b.local\r\n');
  // A block cut in half: the begin marker and its one entry go, nothing else.
  const cut = '127.0.0.1 a.local\r\n' + R.BEGIN + '\r\n10.8.0.1 shop.ogsports1.com\r\n127.0.0.1 b.local\r\n';
  assert.equal(R.without(cut), '127.0.0.1 a.local\r\n127.0.0.1 b.local\r\n');
});

test('a moved tunnel is stale, and re-adding points at the new address', () => {
  const old = R.withRoute(WINDOWS_DEFAULT, '10.8.0.9', 'shop.ogsports1.com');
  assert.deepEqual(R.state(old, '10.8.0.1', 'shop.ogsports1.com'), { state: 'stale', ip: '10.8.0.9' });
  const now = R.withRoute(old, '10.8.0.1', 'shop.ogsports1.com');
  assert.equal(R.state(now, '10.8.0.1', 'shop.ogsports1.com').state, 'on');
  assert.equal((now.match(/og-shop tunnel/g) || []).length, 2, 'one block, not two');
});

test("somebody else's line for the domain is reported, never hidden or edited", () => {
  const theirs = WINDOWS_DEFAULT + '1.2.3.4   shop.ogsports1.com  # testing\r\n';
  const s = R.state(theirs, '10.8.0.1', 'shop.ogsports1.com');
  assert.equal(s.state, 'other');
  assert.equal(s.ip, '1.2.3.4');
  // A commented-out line is not a line.
  assert.equal(R.state(WINDOWS_DEFAULT + '# 1.2.3.4 shop.ogsports1.com\r\n', '10.8.0.1', 'shop.ogsports1.com').state, 'off');
  // A line for another name that merely CONTAINS ours is not ours.
  assert.equal(R.state('10.8.0.1 www.shop.ogsports1.com\r\n', '10.8.0.1', 'shop.ogsports1.com').state, 'off');
  // Removing ours leaves theirs exactly.
  const both = R.withRoute(WINDOWS_DEFAULT, '10.8.0.1', 'shop.ogsports1.com') + '1.2.3.4 shop.ogsports1.com\r\n';
  assert.ok(R.without(both).endsWith('1.2.3.4 shop.ogsports1.com\r\n'));
});

test('the script: --check and --undo on a scratch hosts file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'og-route-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'OG_ROLE=standby\nOG_UPSTREAM=http://10.8.0.1:8090\nOG_STANDBY_HOME=https://shop.ogsports1.com\n');
    const hosts = join(dir, 'hosts');
    const run = (...a) => spawnSync(process.execPath, [join(HERE, '..', 'scripts', 'tunnel-route.js'), ...a],
      { encoding: 'utf8', env: { ...process.env, OG_ENV_FILE: envFile, OG_HOSTS_FILE: hosts, OG_ROLE: '', OG_UPSTREAM: '', OG_STANDBY_HOME: '' } });
    const json = (r) => JSON.parse(/OG_ROUTE_JSON (\{.*\})/.exec(r.stdout)[1]);

    writeFileSync(hosts, WINDOWS_DEFAULT, 'latin1');
    let r = run('--check', '--json');
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.equal(json(r).state, 'off');

    writeFileSync(hosts, R.withRoute(WINDOWS_DEFAULT, '10.8.0.1', 'shop.ogsports1.com'), 'latin1');
    r = run('--check', '--json');
    assert.equal(r.status, 0);
    assert.equal(json(r).state, 'on');

    r = run('--undo');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(hosts, 'latin1'), WINDOWS_DEFAULT, 'undo gives back the file as it was');

    writeFileSync(hosts, WINDOWS_DEFAULT + '1.2.3.4 shop.ogsports1.com\r\n', 'latin1');
    r = run('--check', '--json');
    assert.equal(r.status, 1);
    assert.equal(json(r).state, 'other');

    // Not a standby: nothing needed, nothing touched.
    writeFileSync(envFile, 'OG_ROLE=primary\n');
    writeFileSync(hosts, WINDOWS_DEFAULT, 'latin1');
    r = run('--check', '--json');
    assert.equal(r.status, 0);
    assert.equal(json(r).state, 'na');
    assert.equal(readFileSync(hosts, 'latin1'), WINDOWS_DEFAULT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
