/* A product's description and "goes well with" (migration 070, contract
   v1.5), and telling the website the catalogue changed (lib/sitenotify.js) —
   against a throwaway database and a faked fetch. What is cleaned and what is
   refused on the way in; what the website's answer carries; a deleted
   product leaving every list; the website address's rules; and the call:
   sent once for a change, not at all for no change, retried on a 500 and
   not on a 401, never following a redirect. No network, no server, no real
   file touched — OG_ENV_FILE points at nothing, so the real .env is never
   read. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-webextras-${process.pid}-${Date.now()}.db`);
process.env.OG_ENV_FILE = join(tmpdir(), `og-webextras-none-${process.pid}.env`);
process.env.OG_WEB_API_KEY = 'website-key-for-the-test';

let DB, Cat, Photos, Notify, configRefusal, siteUrlProblem;
const calls = [];
let answer = () => ({ status: 200, body: { ok: true, refreshedAt: '2026-09-29T10:00:00.000Z' } });
const realFetch = globalThis.fetch;
const ids = {};

before(async () => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.authorization, redirect: opts.redirect, body: JSON.parse(opts.body) });
    const a = answer();
    if (a.throw) throw a.throw;
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Photos = await import('../lib/photos.js');
  Notify = await import('../lib/sitenotify.js');
  ({ configRefusal, siteUrlProblem } = await import('../lib/config-writable.js'));
  DB.open(file);
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 135 });
  const make = (name, qty = 1, published = true) => {
    const r = Cat.createWithVariants({ name, type: 'sneakers', currency: 'USD', sellingPrice: 3000,
      colours: [{ nameEn: 'Black', nameAr: 'أسود', sizes: [{ size: '42', qty }] }] });
    if (published) {
      for (const kind of ['model', 'product']) {
        Photos.add({ productId: r.productId, colourId: r.colours[0].id, kind,
          url: `https://img.test/${r.productId}/${kind}.jpg`, thumbUrl: `https://img.test/${r.productId}/${kind}-s.jpg` });
      }
    }
    return r.productId;
  };
  ids.hoodie = make('Hoodie');
  ids.pants = make('Pants');
  ids.cap = make('Cap');
  ids.hidden = make('Old tee');
  Cat.update(ids.hidden, { hidden: 1 });
  ids.spare = make('Spare', 0, false);   // no stock movement, no photos: deletable
  for (let i = 0; i < 12; i++) ids['x' + i] = make('Extra ' + i, 0, false);
});

after(() => {
  globalThis.fetch = realFetch;
  Notify._reset();
  try { DB.close(); } catch { /* already */ }
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(file + suffix); } catch { /* gone */ } }
});

const row = (id) => ({ ...DB.get().prepare('SELECT description_en, description_ar, pairs_with FROM products WHERE id = ?').get(id) });
const web = (id) => Cat.webList().find((p) => p.id === id);
const setCfg = (k, v) => DB.get().prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-09-29T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));

test('a description is plain text: line breaks kept, ends trimmed, empty is none', () => {
  assert.equal(Cat.cleanDescription('  Soft cotton.\r\nBrushed inside.  '), 'Soft cotton.\nBrushed inside.');
  assert.equal(Cat.cleanDescription('a\u0000b\u0007c\td'), 'abc\td');
  assert.equal(Cat.cleanDescription('   '), null);
  assert.equal(Cat.cleanDescription(null), null);
  assert.equal(Cat.cleanDescription('ب'.repeat(1500)).length, 1500);
  assert.throws(() => Cat.cleanDescription('x'.repeat(1501)), (e) => e.code === 'description_too_long');
});

test('the website gets {en, ar}, either may be null, and null when there is none', () => {
  assert.equal(web(ids.hoodie).description, null);
  Cat.update(ids.hoodie, { description_en: 'Soft cotton hoodie.\nBrushed inside.', description_ar: '' });
  assert.deepEqual(row(ids.hoodie), { description_en: 'Soft cotton hoodie.\nBrushed inside.', description_ar: null, pairs_with: null });
  assert.deepEqual(web(ids.hoodie).description, { en: 'Soft cotton hoodie.\nBrushed inside.', ar: null });
  Cat.update(ids.hoodie, { description_ar: 'هودي قطن ناعم من جوّا.' });
  assert.deepEqual(web(ids.hoodie).description, { en: 'Soft cotton hoodie.\nBrushed inside.', ar: 'هودي قطن ناعم من جوّا.' });
  Cat.update(ids.hoodie, { description_en: null, description_ar: '  ' });
  assert.equal(web(ids.hoodie).description, null);
});

test('goes well with: the owner\'s order, each once, only products, never itself, at most 12', () => {
  Cat.update(ids.hoodie, { pairs_with: [ids.pants, ids.cap, ids.pants, ids.hidden] });
  assert.equal(row(ids.hoodie).pairs_with, JSON.stringify([ids.pants, ids.cap, ids.hidden]));
  // an archived product may stay on the list; the website skips it
  assert.deepEqual(web(ids.hoodie).pairsWith, [ids.pants, ids.cap, ids.hidden]);
  assert.deepEqual(web(ids.pants).pairsWith, []);
  assert.throws(() => Cat.update(ids.hoodie, { pairs_with: [ids.hoodie] }), (e) => e.code === 'pair_self');
  assert.throws(() => Cat.update(ids.hoodie, { pairs_with: [999999] }), (e) => e.code === 'bad_pair');
  assert.throws(() => Cat.update(ids.hoodie, { pairs_with: ['abc'] }), (e) => e.code === 'bad_pairs');
  assert.throws(() => Cat.update(ids.hoodie, { pairs_with: { a: 1 } }), (e) => e.code === 'bad_pairs');
  const thirteen = [ids.pants, ...Array.from({ length: 12 }, (_, i) => ids['x' + i])];
  assert.throws(() => Cat.update(ids.hoodie, { pairs_with: thirteen }), (e) => e.code === 'too_many_pairs');
  Cat.update(ids.hoodie, { pairs_with: thirteen.slice(0, 12) });
  assert.equal(web(ids.hoodie).pairsWith.length, 12);
  Cat.update(ids.hoodie, { pairs_with: [] });
  assert.equal(row(ids.hoodie).pairs_with, null);
  assert.deepEqual(web(ids.hoodie).pairsWith, []);
});

test('an unreadable stored list is an empty one, and a missing product is skipped', () => {
  assert.deepEqual(Cat.pairsOf('not json'), []);
  assert.deepEqual(Cat.pairsOf('{"a":1}'), []);
  assert.deepEqual(Cat.pairsOf('[-1, 0, 1.5, "7", true, null, 3, 3]'), [3]);
  assert.deepEqual(Cat.pairsOf(JSON.stringify([ids.pants, 999999]), new Set([ids.pants])), [ids.pants]);
});

test('deleting a product takes it off every list that named it, logged', () => {
  Cat.update(ids.hoodie, { pairs_with: [ids.spare, ids.pants] });
  Cat.update(ids.cap, { pairs_with: [ids.spare] });
  const before = DB.get().prepare("SELECT COUNT(*) AS n FROM change_log WHERE tbl = 'products' AND note LIKE 'goes well with%'").get().n;
  Cat.remove(ids.spare, null);
  assert.equal(row(ids.hoodie).pairs_with, JSON.stringify([ids.pants]));
  assert.equal(row(ids.cap).pairs_with, null);
  const afterN = DB.get().prepare("SELECT COUNT(*) AS n FROM change_log WHERE tbl = 'products' AND note LIKE 'goes well with%'").get().n;
  assert.equal(afterN - before, 2);
});

test('the website address: an https name and nothing after it', () => {
  assert.equal(siteUrlProblem(''), null);
  assert.equal(siteUrlProblem('https://ogsports1.com'), null);
  assert.equal(siteUrlProblem('https://www.ogsports1.com/'), null);
  for (const bad of ['http://ogsports1.com', 'https://ogsports1.com/shop', 'https://ogsports1.com?x=1',
                     'https://user:pw@ogsports1.com', 'https://152.239.114.129', 'https://localhost', 'https://og.local', 'ogsports1.com']) {
    assert.ok(siteUrlProblem(bad), bad);
  }
  assert.ok(configRefusal({ 'web.site_url': 'http://ogsports1.com' }));
  assert.equal(configRefusal({ 'web.site_url': 'https://ogsports1.com' }), null);
  process.env.OG_WEB_SITE_TEST_HOST = '127.0.0.1:9312';
  assert.equal(siteUrlProblem('http://127.0.0.1:9312'), null);
  assert.ok(siteUrlProblem('http://127.0.0.1:9313'));
  delete process.env.OG_WEB_SITE_TEST_HOST;
});

test('no address or no key: nothing is sent', async () => {
  Notify._reset();
  calls.length = 0;
  let r = await Notify._runOnce();
  assert.equal(r.code, 'no_site');
  setCfg('web.site_url', 'https://ogsports.test');
  const k = process.env.OG_WEB_API_KEY;
  delete process.env.OG_WEB_API_KEY;
  r = await Notify._runOnce();
  assert.equal(r.code, 'no_key');
  process.env.OG_WEB_API_KEY = k;
  assert.equal(calls.length, 0);
});

test('a change is told once, with the key, and no change is not told at all', async () => {
  Notify._reset();
  calls.length = 0;
  let r = await Notify._runOnce();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ogsports.test/api/og/catalog-changed');
  assert.equal(calls[0].auth, 'Bearer website-key-for-the-test');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].body.reason, 'catalog_changed');

  r = await Notify._runOnce();
  assert.equal(r.unchanged, true);
  assert.equal(calls.length, 1, 'nothing shown moved, so nothing is sent');

  // a stock movement that leaves the size in stock changes nothing shown
  DB.get().prepare("UPDATE stock SET qty = qty + 5 WHERE sku IN (SELECT sku FROM variants WHERE product_id = ?)").run(ids.pants);
  r = await Notify._runOnce();
  assert.equal(r.unchanged, true);
  assert.equal(calls.length, 1);

  Cat.update(ids.pants, { description_en: 'Wide leg.' });
  r = await Notify._runOnce();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { reason: 'product_saved', productIds: [ids.pants] });

  // selling the last pair is a change; so is a new rate
  DB.get().prepare("UPDATE stock SET qty = 0 WHERE sku IN (SELECT sku FROM variants WHERE product_id = ?)").run(ids.cap);
  await Notify._runOnce();
  assert.deepEqual(calls[2].body, { reason: 'product_saved', productIds: [ids.cap] });
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 140 });
  await Notify._runOnce();
  assert.deepEqual(calls[3].body, { reason: 'rate_changed', productIds: [] });
});

test('a server error is tried again later; a wrong key, a missing door and a redirect are not', async () => {
  Notify._reset();
  calls.length = 0;
  answer = () => ({ status: 503, body: null });
  let r = await Notify._runOnce();
  assert.equal(r.code, 'site_error');
  let s = Notify.status();
  assert.equal(s.attempts, 1);
  assert.ok(s.pending && s.nextTryAt, 'a retry is armed');
  assert.equal(Notify._told(), null, 'not recorded as told');

  answer = () => ({ throw: new TypeError('fetch failed') });
  Notify._reset();
  r = await Notify._runOnce();
  assert.equal(r.code, 'unreachable');
  assert.ok(Notify.status().pending);

  for (const [status, code] of [[401, 'bad_key'], [403, 'bad_key'], [404, 'not_found'], [301, 'redirect'], [400, 'refused']]) {
    Notify._reset();
    answer = () => ({ status, body: null });
    r = await Notify._runOnce();
    assert.equal(r.code, code, String(status));
    s = Notify.status();
    assert.equal(s.pending, false, `${status} is not retried`);
    assert.equal(s.lastError, code);
  }
  Notify._reset();
});

test('"Tell the website now" is sent even when nothing changed, and is never retried by itself', async () => {
  Notify._reset();
  calls.length = 0;
  answer = () => ({ status: 200, body: { ok: true, refreshedAt: 'T' } });
  await Notify._runOnce();
  let r = await Notify.sendNow();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.reason, 'test');
  assert.equal(Notify.status().refreshedAt, 'T');
  answer = () => ({ status: 500, body: null });
  r = await Notify.sendNow();
  assert.equal(r.code, 'site_error');
  assert.equal(Notify.status().pending, false);
  Notify._reset();
});

test('a commit to a catalogue table arms the quiet timer; other tables do not', () => {
  Notify._reset();
  Notify.start(() => {});
  try {
    DB.tx(() => { DB.logChange('customers', 1, 'update', null); });
    assert.equal(Notify.status().pending, false);
    Cat.update(ids.cap, { description_en: 'A cap.' });
    assert.equal(Notify.status().pending, true);
  } finally {
    Notify.stop();
    Notify._reset();
  }
});
