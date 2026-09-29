// originAllowed() with OG_ORIGINS set (lib/http.js, 29 Sep 2026).
//
// The shop's computer offers itself at its own addresses when the main server
// cannot be reached, and those addresses change with the network it is on. So
// an origin that is one of THIS machine's own IP addresses — and is the very
// address the request was sent to — is always ours. Everything else still has
// to be on the list: another site, a name (DNS rebinding controls names), an
// own address sent to a different Host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { originAllowed, ownOrigin } from '../lib/http.js';

const LIST = ['https://shop.ogsports1.com'];
const req = (origin, host) => ({ headers: { origin, host } });
const myIp = (() => {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
  }
  return null;
})();

test('the listed origin still passes, and no Origin header is still a machine', () => {
  assert.equal(originAllowed(req('https://shop.ogsports1.com', 'shop.ogsports1.com'), LIST), true);
  assert.equal(originAllowed(req(undefined, 'anything'), LIST), true);
});

test('localhost and 127.0.0.1 on the address the request went to pass without being listed', () => {
  assert.equal(originAllowed(req('https://localhost:8443', 'localhost:8443'), LIST), true);
  assert.equal(originAllowed(req('https://127.0.0.1:8443', '127.0.0.1:8443'), LIST), true);
  assert.equal(originAllowed(req('http://localhost:8090', 'localhost:8090'), LIST), true);
});

test("this machine's own Wi-Fi address passes when the request was sent to it", { skip: !myIp && 'no IPv4 card' }, () => {
  assert.equal(ownOrigin(`https://${myIp}:8443`, `${myIp}:8443`), true);
  assert.equal(originAllowed(req(`https://${myIp}:8443`, `${myIp}:8443`), LIST), true);
});

test('everything else is still refused', () => {
  // another site
  assert.equal(originAllowed(req('https://evil.example', 'localhost:8443'), LIST), false);
  // an own address, but the request went somewhere else (a different port is a different origin)
  assert.equal(originAllowed(req('https://localhost:8443', 'localhost:9999'), LIST), false);
  assert.equal(originAllowed(req('https://127.0.0.1:8443', 'shop.ogsports1.com'), LIST), false);
  // a NAME matching the Host header is exactly what DNS rebinding produces: never "own"
  assert.equal(originAllowed(req('https://rebind.example:8443', 'rebind.example:8443'), LIST), false);
  // an IP that is not one of this machine's cards
  assert.equal(originAllowed(req('https://203.0.113.9:8443', '203.0.113.9:8443'), LIST), false);
  // not http(s), and junk
  assert.equal(ownOrigin('file:///x', ''), false);
  assert.equal(ownOrigin('null', 'localhost'), false);
});

test('with no list the old rule stands: the origin must be the address the request went to', () => {
  assert.equal(originAllowed(req('https://10.10.99.9:8443', '10.10.99.9:8443'), []), true);
  assert.equal(originAllowed(req('https://evil.example', '10.10.99.9:8443'), []), false);
});
