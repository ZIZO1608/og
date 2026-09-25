// cd server && npm test
//
// shop.public_url — the shop's address on the internet — may be written
// through PUT /api/config, and only as a bare https origin.
//
// It was refused outright until the panel polish (24 Sep 2026), although
// docs/go-live.md, deploy/shop-proxy/README.md and docs/vps/TONIGHT.md all told the
// owner to set it. It now goes into a QR code on the counter and into links in
// people's pockets, so the rule is strict: https, a real domain, and nothing
// after the name. The same function is what the launcher reads it with, so the
// two cannot disagree about what counts. No server, no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_WRITABLE, configRefusal, publicUrlProblem } from '../lib/config-writable.js';

test('shop.public_url is on the allow-list, and nothing beside it was opened', () => {
  assert.equal(CONFIG_WRITABLE.test('shop.public_url'), true);
  for (const k of ['shop.public', 'shop.public_url_x', 'shop.public_urls', 'receipt_public_url', 'shop.url']) {
    assert.equal(CONFIG_WRITABLE.test(k), false, `${k} must still be refused`);
  }
});

test('a bare https origin is accepted — with or without the slash a browser adds', () => {
  for (const v of [
    'https://shop.ogsports1.com',
    'https://shop.ogsports1.com/',
    '  https://shop.ogsports1.com  ',
    'https://SHOP.OGSports1.com',
    'https://shop.example.co.uk:8443'
  ]) {
    assert.equal(publicUrlProblem(v), null, `${JSON.stringify(v)} should be accepted`);
    assert.equal(configRefusal({ 'shop.public_url': v }), null);
  }
});

test('empty means "not set", and is allowed — Telegram then carries no link', () => {
  assert.equal(publicUrlProblem(''), null);
  assert.equal(publicUrlProblem('   '), null);
  assert.equal(publicUrlProblem(null), null);
  assert.equal(configRefusal({ 'shop.public_url': '' }), null);
});

test('anything that is not a bare https origin is refused, and says why', () => {
  const refused = [
    'http://shop.ogsports1.com',             // not https
    'shop.ogsports1.com',                    // no scheme
    'https:shop.ogsports1.com',              // the parser forgives this; the rule does not
    'https://shop.ogsports1.com/path',       // a path
    'https://shop.ogsports1.com//',          // a path, however short
    'https://shop.ogsports1.com/?x=1',       // a query
    'https://shop.ogsports1.com?',           // an empty query is still a query
    'https://shop.ogsports1.com/#top',       // a fragment
    'https://user:pw@shop.ogsports1.com',    // credentials
    'https://shop.ogsports1.com:443',        // the default port, spelled out, is not the origin
    'https://shop.ogsports1.com\\evil',      // a backslash, which browsers read as a slash
    'https://shop ogsports1.com',            // a space
    'https://1.2.3',                         // the parser rewrites this to 1.2.0.3, so it is not what was typed
    'javascript:alert(1)',
    'ftp://shop.ogsports1.com',
    'https://'
  ];
  for (const v of refused) {
    const p = publicUrlProblem(v);
    assert.ok(p && /shop\.public_url/.test(p), `${JSON.stringify(v)} should be refused`);
    assert.equal(configRefusal({ 'shop.public_url': v }), p, 'the route refuses with the same sentence');
  }
});

test('an address only this network can open is not a public address', () => {
  for (const v of [
    'https://10.10.99.9:8443',   // the shop wifi
    'https://10.8.0.2',          // the tunnel
    'https://152.239.114.129',   // even a public IP: the certificate names a domain
    'https://[::1]',
    'https://localhost:8443',
    'https://og-till',           // one label: only the VPS knows it
    'https://desktop-tg3h1ns.local'
  ]) {
    const p = publicUrlProblem(v);
    assert.ok(p, `${v} should be refused`);
    assert.doesNotMatch(p, /nothing after the name/, `${v} deserves the specific reason, not the generic one`);
  }
});

test('one bad public address refuses the whole batch, the shop name with it', () => {
  const p = configRefusal({ 'shop.name': 'OG Sports', 'shop.public_url': 'http://shop.ogsports1.com' });
  assert.match(p, /shop\.public_url/);
});
