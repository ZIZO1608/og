// cd panel && npm test
//
// WHICH ADDRESS GOES ON THE WI-FI CODE, AND WHAT THE PUBLIC ONE IS.
//
// The shop laptop has had six IPv4 addresses at once (its certificate names
// them: the shop Wi-Fi, a phone hotspot, ZeroTier, PIA and the WireGuard end),
// and exactly one of them is the one a phone on the shop's Wi-Fi can reach.
// A code for the wrong one is a code that opens nothing, taped to the counter.
// No network, no server — panel/lib/links.js is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAddresses, pickAddress, shopUrl, publicLink, qrPayloads, SHOP_NET, DEFAULT_PUBLIC } from '../lib/links.js';

/* The live laptop, as its certificate (21 Sep 2026) and its adapters name it. */
const LIVE_CERT = ['127.0.0.1', '10.132.90.237', '172.20.10.2', '10.102.4.158', '10.8.0.2', '10.10.99.9'];
const NAMES = {
  '10.132.90.237': 'ZeroTier One [8056c2e21c000001]',
  '172.20.10.2': 'Wi-Fi',
  '10.102.4.158': 'Private Internet Access Network Adapter',
  '10.8.0.2': 'og-shop',
  '10.10.99.9': 'Wi-Fi',
  '192.168.1.11': 'Wi-Fi',
  '172.25.160.1': 'vEthernet (WSL)'
};
const addrs = (...a) => a.map((address) => ({ address, note: /vEthernet/.test(NAMES[address] || '') ? NAMES[address] + ' — probably not this one' : '' }));

test('at the shop, the shop Wi-Fi wins, whatever order Windows lists the cards in', () => {
  const r = rankAddresses(addrs('10.132.90.237', '10.102.4.158', '10.8.0.2', '10.10.99.9'),
    { names: NAMES, tunnel: '10.8.0.2', certIps: LIVE_CERT });
  assert.equal(r[0].address, '10.10.99.9');
  assert.equal(r[0].shop, true);
  assert.equal(r[0].covered, true);
  assert.equal(pickAddress(r, null), '10.10.99.9');
  assert.ok(SHOP_NET && '10.10.99.9'.startsWith(SHOP_NET));
});

test('the tunnel’s own end and loopback are never offered — a phone cannot use either', () => {
  const r = rankAddresses(addrs('10.8.0.2', '127.0.0.1', '169.254.3.3', '10.10.99.9'), { names: NAMES, tunnel: '10.8.0.2' });
  assert.deepEqual(r.map((x) => x.address), ['10.10.99.9']);
});

test('away from the shop, the real Wi-Fi beats ZeroTier and the VPN — even when only they are in the certificate', () => {
  const r = rankAddresses(addrs('10.132.90.237', '10.102.4.158', '192.168.1.11'),
    { names: NAMES, tunnel: '10.8.0.2', certIps: LIVE_CERT });
  assert.equal(r[0].address, '192.168.1.11', 'the Wi-Fi card comes first');
  assert.equal(r[0].covered, false, 'and it is honestly reported as not covered');
  assert.equal(r[1].virtual, true);
  assert.equal(r[2].virtual, true);
});

test('on the phone hotspot, the hotspot address is the one', () => {
  const r = rankAddresses(addrs('10.132.90.237', '172.20.10.2', '10.102.4.158', '10.8.0.2'),
    { names: NAMES, tunnel: '10.8.0.2', certIps: LIVE_CERT });
  assert.equal(pickAddress(r, null), '172.20.10.2');
});

test('what net.js already calls "probably not this one" comes last', () => {
  const r = rankAddresses(addrs('172.25.160.1', '192.168.1.11'), { names: NAMES });
  assert.deepEqual(r.map((x) => x.address), ['192.168.1.11', '172.25.160.1']);
  assert.equal(r[1].virtual, true);
});

test('inside one tier, an address the certificate names comes first', () => {
  const names = { '192.168.1.11': 'Wi-Fi', '192.168.50.4': 'Ethernet' };
  const r = rankAddresses(['192.168.1.11', '192.168.50.4'], { names, certIps: ['192.168.50.4'] });
  assert.equal(r[0].address, '192.168.50.4');
  const none = rankAddresses(['192.168.1.11', '192.168.50.4'], { names, certIps: null });
  assert.equal(none[0].address, '192.168.1.11', 'with no certificate to ask, Windows’ order stands');
  assert.equal(none[0].covered, null, 'and "covered" says it does not know');
});

test('a person’s choice holds while the laptop has that address, and waits when it does not', () => {
  const r = rankAddresses(addrs('10.10.99.9', '172.20.10.2'), { names: NAMES });
  assert.equal(pickAddress(r, '172.20.10.2'), '172.20.10.2');
  assert.equal(pickAddress(r, '10.9.9.9'), '10.10.99.9', 'a choice for an address it no longer has falls back');
  assert.equal(pickAddress([], '10.10.99.9'), null);
  assert.equal(pickAddress(null, null), null);
});

test('the address becomes the URL a phone opens — secure whenever the shop serves the padlock', () => {
  assert.equal(shopUrl('10.10.99.9', { secure: true, httpsPort: 8443, httpPort: 8090 }), 'https://10.10.99.9:8443');
  assert.equal(shopUrl('10.10.99.9', { secure: false, httpsPort: 8443, httpPort: 8090 }), 'http://10.10.99.9:8090');
  assert.equal(shopUrl('10.10.99.9', { secure: true, httpsPort: 8491 }), 'https://10.10.99.9:8491');
  assert.equal(shopUrl(null), null);
});

test('the public address is shop.public_url when the server would accept it, the usual domain otherwise', () => {
  assert.deepEqual(publicLink('https://shop.ogsports1.com/'), { url: 'https://shop.ogsports1.com', source: 'config', problem: null });
  assert.deepEqual(publicLink('https://Shop.Example.com'), { url: 'https://shop.example.com', source: 'config', problem: null });
  assert.deepEqual(publicLink(''), { url: DEFAULT_PUBLIC, source: 'default', problem: null });
  assert.deepEqual(publicLink(null), { url: DEFAULT_PUBLIC, source: 'default', problem: null });
  const bad = publicLink('http://shop.ogsports1.com/path');
  assert.equal(bad.url, DEFAULT_PUBLIC);
  assert.equal(bad.source, 'default');
  assert.match(bad.problem, /shop\.public_url/, 'the server’s own sentence, so the two cannot disagree');
  assert.equal(DEFAULT_PUBLIC, 'https://shop.ogsports1.com');
});

test('the codes hold exactly the address printed under them, and never localhost', () => {
  const links = {
    lan: { address: '10.10.99.9', url: 'https://10.10.99.9:8443' },
    public: { url: 'https://shop.ogsports1.com' }
  };
  assert.deepEqual(qrPayloads(links), { wifi: 'https://10.10.99.9:8443', public: 'https://shop.ogsports1.com' });
  assert.deepEqual(qrPayloads({ lan: { url: 'https://localhost:8443' }, public: { url: 'https://shop.ogsports1.com' } }),
    { public: 'https://shop.ogsports1.com' });
  assert.deepEqual(qrPayloads({ lan: null, public: { url: DEFAULT_PUBLIC } }), { public: DEFAULT_PUBLIC });
  assert.deepEqual(qrPayloads(null), {});
});
