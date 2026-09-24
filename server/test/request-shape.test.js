// A night request as shapes and rules (lib/request-shape.js) — pure, no shop.
// What turns a request into the body Orders.create takes, and what an
// Accept or a Reject may say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/request-shape.js';

const payload = {
  v: 1,
  customer: { name: 'Nour Haddad', phone: '0933 123 456', id: 81 },
  items: [{ sku: 'OG-050-42', qty: 2, name: 'Samba OG', size: '42' }, { sku: 'OG-051-C2-42', qty: 1 }],
  delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery' },
  note: 'Call after 6'
};
const countries = [{ id: 'SY', active: true }, { id: 'JO', active: true }, { id: 'TR', active: false }];

test('the marker is what a delivery note starts with', () => {
  assert.equal(S.marker('N-0042'), '[req N-0042]');
  /* No trailing space to lose when a note is trimmed, and one ref can never
     be the front of another. */
  assert.equal(S.noteWith('N-0042', null), '[req N-0042]');
  assert.equal(S.noteWith('N-0042', '  '), '[req N-0042]');
  assert.equal(S.noteWith('N-0042', ' Call after 6 '), '[req N-0042] Call after 6');
  assert.ok(!'[req N-00420]'.startsWith(S.marker('N-0042')));
});

test('the order body: our driver, pay on receipt, priced by the server, marked, once', () => {
  const b = S.orderBody({ ref: 'N-0042', source: 'night', payload, customerId: 9, method: 'driver', fee: null,
                          feeMode: null, whId: null, packFrom: 'store', countries, userId: 3 });
  assert.deepEqual(b.lines, [{ sku: 'OG-050-42', qty: 2 }, { sku: 'OG-051-C2-42', qty: 1 }]);
  assert.equal(b.method, 'driver');
  assert.equal(b.plan, 'receipt');
  assert.deepEqual(b.payments, []);
  assert.equal(b.whId, 'store');
  assert.equal(b.customerId, 9);
  assert.equal(b.opId, 'req:N-0042');
  assert.equal(b.channel, 'other');
  assert.equal(b.note, '[req N-0042] Call after 6');
  assert.deepEqual(b.dest, { country: 'SY', city: 'Aleppo', address: 'New Aleppo, near the bakery', phone: '0933 123 456' });
  assert.equal(b.unlimitedDiscount, false);
  assert.equal(b.discount, 0);
  for (const k of ['price', 'unitPrice', 'total']) assert.equal(k in b, false, 'no price in the body: ' + k);
  for (const l of b.lines) assert.deepEqual(Object.keys(l).sort(), ['qty', 'sku']);
});

test('a pickup has no destination and no fee; a website request is channel web', () => {
  const b = S.orderBody({ ref: 'W-1', source: 'web', payload: { ...payload, note: null }, customerId: 1, method: 'pickup',
                          fee: 5000, feeMode: 'invoice', whId: 'floor', packFrom: 'store', countries, userId: 1 });
  assert.deepEqual(b.dest, {});
  assert.equal(b.fee, null);
  assert.equal(b.feeMode, null);
  assert.equal(b.whId, 'floor');
  assert.equal(b.channel, 'web');
  assert.equal(b.note, '[req W-1]');
});

test('the note is cut at 500 with the marker kept at the front', () => {
  const b = S.orderBody({ ref: 'N-0001', source: 'night', payload: { ...payload, note: 'x'.repeat(600) }, customerId: 1,
                          method: 'driver', countries, userId: 1 });
  assert.equal(b.note.length, 500);
  assert.ok(b.note.startsWith('[req N-0001] '));
});

test('the country: the asked one if the shop sends there, else Syria, else the first', () => {
  assert.equal(S.countryFor('jo', countries), 'JO');
  assert.equal(S.countryFor('TR', countries), 'SY', 'an inactive country is not used');
  assert.equal(S.countryFor(null, countries), 'SY');
  assert.equal(S.countryFor(null, [{ id: 'JO' }]), 'JO');
  assert.equal(S.countryFor(null, []), null);
});

test('Accept: pickup and our driver only; the default follows the request', () => {
  assert.equal(S.checkAccept({}, payload).method, 'driver');
  assert.equal(S.checkAccept({}, { ...payload, delivery: { method: 'pickup' } }).method, 'pickup');
  for (const m of ['office', 'courier', 'abroad', 'teleport']) {
    assert.throws(() => S.checkAccept({ method: m }, payload), (e) => e.code === 'bad_method' && e.status === 400);
  }
  assert.equal(S.checkAccept({ method: 'driver', fee: 15000 }, payload).fee, 15000);
  assert.throws(() => S.checkAccept({ method: 'driver', fee: -1 }, payload), (e) => e.code === 'bad_fee');
  assert.throws(() => S.checkAccept({ method: 'driver', fee: 1.5 }, payload), (e) => e.code === 'bad_fee');
  assert.equal(S.checkAccept({ method: 'pickup', fee: 5000 }, payload).fee, null, 'a pickup carries no fee');
  assert.throws(() => S.checkAccept({ method: 'driver' }, { ...payload, delivery: { method: 'pickup' } }),
    (e) => e.code === 'needs_address' && e.status === 400, 'our driver needs an address to go to');
  assert.equal(S.checkAccept({ method: 'driver', whId: 'floor' }, payload).whId, 'floor');
  assert.equal(S.checkAccept({ method: 'driver', whId: "x'; drop" }, payload).whId, null);
});

test('Reject: one of six reasons, a tidy note of 200 at most', () => {
  assert.deepEqual(S.checkReject({ code: 'out_of_stock', note: ' none\r\nleft ' }), { code: 'out_of_stock', note: 'none\nleft' });
  assert.deepEqual(S.checkReject({ code: 'no_answer' }), { code: 'no_answer', note: null });
  assert.throws(() => S.checkReject({ code: 'because' }), (e) => e.code === 'bad_code' && e.status === 400);
  assert.throws(() => S.checkReject({ code: 'other', note: 'x'.repeat(201) }), (e) => e.code === 'bad_note');
  assert.equal(S.REASONS.length, 6);
});

test('what the cloud hands over is checked before it is kept', () => {
  const ok = S.fromCloud({ ref: 'N-0042', source: 'night', revision: 1, payload, byUser: 'sara', createdAt: '2026-09-23T20:00:00Z' });
  assert.equal(ok.ref, 'N-0042');
  assert.equal(ok.askedAt, '2026-09-23T20:00:00.000Z');
  assert.equal(S.fromCloud({ ref: 'bad ref', source: 'night', payload }), null);
  assert.equal(S.fromCloud({ ref: 'N-1', source: 'email', payload }), null);
  assert.equal(S.fromCloud({ ref: 'N-1', source: 'night', payload: { ...payload, v: 2 } }), null);
  assert.equal(S.fromCloud({ ref: 'N-1', source: 'night', payload: { ...payload, items: [] } }), null);
  assert.equal(S.fromCloud({ ref: 'N-1', source: 'night', payload: '{not json' }), null);
});

test('what this laptop tells the cloud, and what the cloud should then hold', () => {
  assert.deepEqual(S.markFor({ ref: 'N-1', state: 'waiting', revision: 2 }), { ref: 'N-1', state: 'received', revision: 2 });
  assert.deepEqual(S.markFor({ ref: 'N-1', state: 'accepted', sale_id: 'INV-9' }), { ref: 'N-1', state: 'accepted', saleId: 'INV-9' });
  assert.deepEqual(S.markFor({ ref: 'N-1', state: 'rejected', code: 'duplicate', reason: null }), { ref: 'N-1', state: 'rejected', code: 'duplicate', note: null });
  assert.equal(S.cloudState({ state: 'waiting' }), 'received');
  assert.equal(S.cloudState({ state: 'accepted' }), 'accepted');
});
