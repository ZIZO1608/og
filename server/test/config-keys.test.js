// cd server && npm test
//
// THE CONFIG KEYS THE BROWSER WRITES ARE KEYS THE SERVER ACCEPTS.
//
// Settings → Save changes sent shop.name, shop.address and shop.city through
// PUT /api/config, and the server's allow-list had never held them: the whole
// save was refused, the exchange rate chained after it never went out, and the
// page reloaded the old values over what had been typed (found 15 Sep 2026).
//
// This reads the browser's own source for every key it sends through that
// route and checks each against CONFIG_WRITABLE — the list the route itself
// uses — so a key added on one side and not the other goes red here instead of
// in a toast at the till. No server, no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_WRITABLE, configRefusal } from '../lib/config-writable.js';

const JS = resolve(dirname(fileURLToPath(import.meta.url)), '../../js');
const KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/* The text of the object literal whose `{` is at `open`, braces counted and
   quoted strings skipped, so `(el || {}).value` inside it does not end it. */
function objectAt(src, open) {
  let depth = 0, quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
}

/* Every key a browser file writes through PUT /api/config: the keys of an
   `updates` object literal, `updates['x'] = …`, and saveConfig('x', …), whose
   key may be a prefix with a variable after it ('reminders.' + k). */
function browserKeys() {
  const found = [];
  for (const f of readdirSync(JS).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(JS, f), 'utf8');
    if (!src.includes("'/api/config'")) continue;
    const add = (key, index, prefix = false) => found.push({ key, prefix, at: `js/${f}:${lineOf(src, index)}` });

    for (const m of src.matchAll(/updates\s*[=:]\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const body = objectAt(src, open);
      for (const k of body.matchAll(/'([^']+)'\s*:/g)) {
        if (KEY.test(k[1])) add(k[1], open + k.index);
      }
    }
    for (const m of src.matchAll(/updates\['([^']+)'\]\s*=/g)) add(m[1], m.index);
    /* saveSetting() joined saveConfig() in night shift 03: the same route and
       the same debounce, with a "Saved" beside the box instead of a toast. A
       writer the reader does not know about is a key nobody is checking. */
    for (const m of src.matchAll(/save(?:Config|Setting)\(\s*'([^']+)'\s*(\+)?/g)) add(m[1], m.index, !!m[2]);
  }
  return found;
}

test('the reader finds the keys it is meant to find (a check that cannot go red is not a check)', () => {
  const keys = new Set(browserKeys().map((k) => k.key));
  for (const k of ['shop.name', 'shop.address', 'shop.city', 'loyalty.points_per_1000', 'receipt.transport',
                   'receipt.printer_share', 'label.transport', 'customer.at_risk_days', 'shop.tz_minutes',
                   'loyalty.mode', 'reminders.']) {
    assert.ok(keys.has(k), `expected the browser to write ${k}; the reader no longer sees it`);
  }
  assert.ok(keys.size >= 25, `only ${keys.size} keys found — the reader has lost track of the browser`);
});

test('every config key the browser writes through PUT /api/config is on the server\'s allow-list', () => {
  const refused = browserKeys()
    .filter((k) => !CONFIG_WRITABLE.test(k.prefix ? k.key + 'day_close' : k.key))
    .map((k) => `${k.key}${k.prefix ? '…' : ''}  (${k.at})`);
  assert.deepEqual(refused, [], 'the browser sends keys the server refuses:\n  ' + refused.join('\n  '));
});

test('keys with a route of their own, or no business being written here, stay refused', () => {
  for (const k of ['telegram.og_chats', 'telegram.yalla_chats', 'telegram.og_chat_id', 'pay.accounts', 'pay.methods',
                   'push.public_key', 'delivery.companies', 'delivery.prices', 'sale.max_discount_pct',
                   'shop.name_ar', 'shop', 'label.printer_host_extra']) {
    assert.equal(CONFIG_WRITABLE.test(k), false, `${k} must not be writable through PUT /api/config`);
  }
});

/* The four the page-level "Save changes" used to send together. That button
   is gone — every box on the shop card saves itself now — but they still
   arrive as one batch whenever two change inside one debounce, and they must
   still be accepted together. */
test('what the shop card sends is accepted whole', () => {
  assert.equal(configRefusal({
    'loyalty.points_per_1000': '100', 'loyalty.point_value': '0.5',
    'shop.name': 'OG Sports', 'shop.address': 'Aleppo, Syria', 'shop.city': 'Aleppo', 'shop.phone': '0956 442 118'
  }), null);
});

test('one refused key refuses the batch, and says which', () => {
  assert.equal(configRefusal({ 'shop.name': 'OG Sports', 'pay.accounts': '[]' }), 'pay.accounts cannot be changed here.');
});

test('the shop may not be left without a name', () => {
  assert.equal(configRefusal({ 'shop.name': '' }), 'The shop needs a name.');
  assert.equal(configRefusal({ 'shop.name': '   ' }), 'The shop needs a name.');
  assert.equal(configRefusal({ 'shop.address': '' }), null);
});
