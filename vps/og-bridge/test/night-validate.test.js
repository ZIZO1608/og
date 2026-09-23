// Night mode's request, checked before it is sent (night-validate.js) — the
// same rules as 035's erp.request_submit — and the enrolment helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldDigits, line, block, phoneDigits, buildRequest, newOp, whole } from '../src/night-validate.js';
import { nightProblem, mergeNightUsers, otpUri } from '../src/enrol.js';

const ok = (over = {}) => ({
  lines: [{ sku: 'OG-050-42', qty: 1 }], customerId: null, name: 'Nour Haddad', phone: '0933 123 456',
  method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery', note: 'Call after 6', ...over
});

test('Arabic-Indic and Persian digits fold to ASCII; nothing else moves', () => {
  assert.equal(foldDigits('٠٩٣٣ ١٢٣ ٤٥٦'), '0933 123 456');
  assert.equal(foldDigits('۰۹۳۳'), '0933');
  assert.equal(foldDigits('+963 abc'), '+963 abc');
  assert.equal(phoneDigits('+٩٦٣ (933) 12-34'), '9639331234');
});

test('line and block tidy text exactly as 035\'s req_line and req_block do', () => {
  assert.equal(line('  Nour\tHaddad  '), 'Nour Haddad');
  assert.equal(line('a\nb'), 'a b');
  assert.equal(block('a\r\n\n\n\nb\u0007c'), 'a\n\nbc');
  assert.equal(block('\n  x  \n'), 'x');
});

test('a good request comes back in the SQL\'s shape', () => {
  const r = buildRequest(ok({ customerId: 81 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.request, {
    v: 1, customer: { name: 'Nour Haddad', phone: '0933 123 456', id: 81 },
    items: [{ sku: 'OG-050-42', qty: 1 }],
    delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery' },
    note: 'Call after 6'
  });
});

test('a pickup carries no city and no address; an empty note is null', () => {
  const r = buildRequest(ok({ method: 'pickup', city: '', address: '', note: '  ' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.request.delivery, { method: 'pickup' });
  assert.equal(r.request.note, null);
});

test('an Arabic phone keypad number is accepted, folded', () => {
  const r = buildRequest(ok({ phone: '٠٩٣٣١٢٣٤٥٦' }));
  assert.equal(r.request.customer.phone, '0933123456');
});

test('every refusal lands under its own field', () => {
  const cases = [
    [{ name: 'N' }, 'name', 'bad_name'], [{ name: 'N'.repeat(81) }, 'name', 'bad_name'],
    [{ phone: '123456' }, 'phone', 'bad_phone'], [{ phone: '1234567890123456' }, 'phone', 'bad_phone'],
    [{ phone: 'x'.repeat(41) + '0933123456' }, 'phone', 'bad_phone'],
    [{ lines: [] }, 'items', 'empty'],
    [{ lines: [{ sku: 'A1', qty: 1 }, { sku: 'A1', qty: 1 }] }, 'items', 'bad_items'],
    [{ lines: [{ sku: 'A1', qty: 21 }] }, 'items', 'bad_items'],
    [{ lines: [{ sku: 'A1', qty: 0 }] }, 'items', 'bad_items'],
    [{ lines: [{ sku: 'bad sku', qty: 1 }] }, 'items', 'bad_items'],
    [{ lines: Array.from({ length: 21 }, (_, i) => ({ sku: 'S' + i, qty: 1 })) }, 'items', 'bad_items'],
    [{ lines: [{ sku: 'A', qty: 20 }, { sku: 'B', qty: 20 }, { sku: 'C', qty: 20 }, { sku: 'D', qty: 1 }] }, 'items', 'bad_items'],
    [{ method: 'driver' }, 'method', 'bad_delivery'], [{ method: '' }, 'method', 'bad_delivery'],
    [{ city: 'A' }, 'city', 'bad_city'], [{ address: 'xy' }, 'address', 'bad_address'],
    [{ address: 'x'.repeat(301) }, 'address', 'bad_address'],
    [{ note: 'x'.repeat(501) }, 'note', 'bad_note'],
    [{ customerId: 'abc' }, 'name', 'bad_customer'], [{ customerId: -4 }, 'name', 'bad_customer']
  ];
  for (const [over, field, code] of cases) {
    const r = buildRequest(ok(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.errors[field], code, JSON.stringify(over) + ' → ' + JSON.stringify(r.errors));
  }
});

test('whole() takes a whole number in range, Arabic digits too', () => {
  assert.equal(whole('3', 1, 20), 3);
  assert.equal(whole('٣', 1, 20), 3);
  assert.equal(whole('0', 1, 20), null);
  assert.equal(whole('21', 1, 20), null);
  assert.equal(whole('2.5', 1, 20), null);
  assert.equal(whole('', 1, 20), null);
});

test('an op is what 035 accepts: 16–64 of [A-Za-z0-9_-], and never repeats', () => {
  const a = newOp(), b = newOp();
  assert.match(a, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(a, b);
});

test('enrolment: a line is refused for a bad name, role or password', () => {
  assert.equal(nightProblem({ user: 'sara', role: 'staff', password: 'a-long-enough-one' }), null);
  assert.ok(nightProblem({ user: 'Sara Z', role: 'staff', password: 'a-long-enough-one' }));
  assert.ok(nightProblem({ user: 'sara', role: 'boss', password: 'a-long-enough-one' }));
  assert.ok(nightProblem({ user: 'sara', role: 'staff', password: 'short' }));
  assert.ok(nightProblem({ user: 'sara', role: 'staff', password: '123456789012345' }));
});

test('enrolment: a new person is added to the list, the same username replaced', () => {
  const old = JSON.stringify([{ user: 'abode', role: 'owner', scrypt: 'x', totpSecret: 'y' },
                              { user: 'sara', role: 'staff', scrypt: 'old', totpSecret: 'old' }]);
  const merged = mergeNightUsers(old, { user: 'sara', role: 'manager', scrypt: 'new', totpSecret: 'new' });
  assert.deepEqual(merged.map((u) => [u.user, u.role, u.scrypt]), [['abode', 'owner', 'x'], ['sara', 'manager', 'new']]);
  assert.equal(mergeNightUsers('not json', { user: 'a1' }).length, 1);
  assert.match(otpUri('OG Night', 'sara', 'ABC'), /^otpauth:\/\/totp\/OG%20Night%3Asara\?secret=ABC&issuer=OG%20Night/);
});
