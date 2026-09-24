// cd panel && npm test
//
// EVERY WORD THE PANEL CAN DRAW EXISTS IN BOTH LANGUAGES.
//
// A missing Arabic key falls back to English in the middle of a right-to-left
// sentence, which reads as a bug; a missing key in both prints the key itself.
// The lights make that easy to get wrong, because their words are chosen by a
// CODE the panel process sends (lt_<code>, lh_<code>) and never appear as a
// literal anywhere. So the codes are read out of panel/lib/lights.js itself,
// and the literal keys out of the window's own script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..', 'ui');

const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} }, window: {}, console });
vm.runInContext(readFileSync(join(UI, 'i18n.js'), 'utf8'), ctx);
const { en, ar } = ctx.PI18N;
const panelJs = readFileSync(join(UI, 'panel.js'), 'utf8');
const lightsJs = readFileSync(join(HERE, '..', 'lib', 'lights.js'), 'utf8');

test('the two tables hold the same keys', () => {
  const missingAr = Object.keys(en).filter((k) => !(k in ar));
  const missingEn = Object.keys(ar).filter((k) => !(k in en));
  assert.deepEqual(missingAr, [], 'keys with no Arabic');
  assert.deepEqual(missingEn, [], 'keys with no English');
});

test('every code a light can carry has its words, in both languages', () => {
  const codes = [...lightsJs.matchAll(/light\('\w+', '\w+', '(\w+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 30, `only ${codes.length} codes found — the reader has lost track of lights.js`);
  codes.push('tun_ok0');   // the window's own variant, when a reply carried no time
  for (const c of codes) {
    assert.ok(en['lt_' + c], `no English for lt_${c}`);
    assert.ok(ar['lt_' + c], `no Arabic for lt_${c}`);
  }
  for (const id of ['server', 'wifi', 'tunnel', 'cloud', 'public']) {
    assert.ok(en['l_' + id] && ar['l_' + id], `no name for the ${id} light`);
  }
});

test('every help card has a title and a body, in both languages', () => {
  const block = panelJs.slice(panelJs.indexOf('var HELP = {'), panelJs.indexOf('};', panelJs.indexOf('var HELP = {')));
  const keys = [...new Set([...block.matchAll(/:\s*'(\w+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 10);
  for (const k of keys) {
    for (const suffix of ['', '_b']) {
      assert.ok(en['lh_' + k + suffix], `no English for lh_${k}${suffix}`);
      assert.ok(ar['lh_' + k + suffix], `no Arabic for lh_${k}${suffix}`);
    }
  }
  for (const k of ['lh_fix1', 'lh_fix2', 'lh_fix3', 'lh_fix4', 'lh_fix5', 'lh_fix_tip']) assert.ok(en[k] && ar[k], k);
});

test('every literal key the window asks for exists', () => {
  const keys = new Set();
  /* a literal with something added to it ('lt_' + code) is a prefix, and the
     tests above check what can follow it */
  for (const m of panelJs.matchAll(/\b(?:t|tHtml|bi|biStack|biLine)\('([A-Za-z_][\w]*)'(?!\s*\+)/g)) keys.add(m[1]);
  assert.ok(keys.size >= 80, `only ${keys.size} literal keys found`);
  const missing = [...keys].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

test('the words a code prints on paper are the same in both tables’ shape', () => {
  for (const k of ['q_wifi_t', 'q_wifi_s', 'q_pub_t', 'q_pub_s', 'q_how', 'q_rule', 'q_wifi_need', 'q_pub_need']) {
    assert.ok(en[k] && ar[k], k);
    assert.match(ar[k], /[؀-ۿ]/, `${k} is Arabic in the Arabic table`);
  }
  /* The brief's own words, kept as written. */
  assert.equal(en.q_wifi_t, 'In the shop (Wi-Fi)');
  assert.equal(ar.q_wifi_s, 'يشتغل بلا إنترنت');
  assert.equal(en.q_pub_t, 'From anywhere');
  assert.equal(ar.q_pub_t, 'من أي مكان');
});
