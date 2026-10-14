/* docs/website/og-jersey.js — the live jersey the website draws — must draw
   the shirt the shop draws (js/printkits.js) and refuse what the shop
   refuses (lib/printkits.js checkLine). A second copy of a fact drifts; this
   is the test that says when. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
/* docs/ is left out of the shop's image (.dockerignore), and the image runs
   these tests as part of its build — so without the file there is nothing to
   compare, and the check skips rather than failing the deploy. It still runs
   on every machine that has the repository. */
const JFILE = join(root, 'docs', 'website', 'og-jersey.js');
const HAS = existsSync(JFILE);
const J = HAS ? createRequire(import.meta.url)(JFILE) : null;
const it = (name, fn) => test(name, { skip: HAS ? false : 'docs/ is not in this build' }, fn);
const shop = readFileSync(join(root, 'js', 'printkits.js'), 'utf8');
const lib = readFileSync(join(root, 'server', 'lib', 'printkits.js'), 'utf8');

const literal = (src, name) => {
  const m = new RegExp(`var ${name} = ((?:'[^']*'\\s*\\+?\\s*)+);`).exec(src);
  assert.ok(m, `${name} not found in js/printkits.js`);
  return m[1].split(/'\s*\+\s*'/).join('').replace(/^'|'\s*$/g, '');
};

it('the same shirt, collar and curve as the shop draws', () => {
  assert.equal(J.SHIRT, literal(shop, 'SHIRT'));
  assert.equal(J.COLLAR, literal(shop, 'COLLAR'));
  assert.match(shop, /'M70 ' \+ y \+ ' Q200 ' \+ \(y - 2 \* arc\) \+ ' 330 ' \+ y/);
  assert.equal(J.namePath(130, 20), 'M70 130 Q200 90 330 130');
});

it("the same name rule as the shop's checkLine", () => {
  const m = /export const NAME_RE = (\/.*\/);/.exec(lib);
  assert.ok(m);
  assert.equal(J.NAME_RE.toString(), m[1]);
});

it('the final check answers with the shop\'s codes', () => {
  const p = { maxLetters: 12 };
  const code = (n, x) => (J.check(p, n, x).problems[0] || {}).code || 'ok';
  assert.equal(code('messi', 10), 'ok');
  assert.deepEqual([J.check(p, ' al  said ', '07').name, J.check(p, ' al  said ', '07').number], ['AL SAID', 7]);
  assert.equal(code("o’neil", '9'), 'ok');
  assert.equal(code('', 10), 'print_name_and_number');
  assert.equal(code('MESSI', ''), 'print_name_and_number');
  assert.equal(code('ميسي', 10), 'print_bad_name');
  assert.equal(code('--', 10), 'print_bad_name');
  assert.equal(code('ABCDEFGHIJKLM', 10), 'print_name_too_long');
  assert.equal(code('MESSI', 100), 'print_bad_number');
  assert.equal(code('MESSI', '1.5'), 'print_bad_number');
  assert.equal(code('MESSI', 0), 'ok');
  assert.equal(J.check(p, '', '', 'ar').problems[0].message, 'اكتب اسم ورقم — الطباعة دايماً فيها الاتنين.');
});

it('as the customer types: upper case, leftovers dropped and said, the length held', () => {
  assert.deepEqual(J.cleanName('messi', 12), { value: 'MESSI', dropped: false, cut: false });
  assert.deepEqual(J.cleanName('ميسي 10', 12), { value: '', dropped: true, cut: false });
  assert.deepEqual(J.cleanName(' de  bruyne', 12), { value: 'DE BRUYNE', dropped: false, cut: false });
  assert.deepEqual(J.cleanName('ABCDEFGHIJKLMN', 12), { value: 'ABCDEFGHIJKL', dropped: false, cut: true });
  assert.deepEqual(J.cleanNumber('1a2'), { value: '12', dropped: true });
  assert.deepEqual(J.cleanNumber('١٠'), { value: '10', dropped: false });
  assert.deepEqual(J.cleanNumber('007'), { value: '7', dropped: false });
  assert.equal(J.cleanNumber('123').value, '12');
});
