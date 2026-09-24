/* The exchange-rate feed (lib/fxfeed.js) against a throwaway database and a
   faked fetch: the two answer shapes, the side and the divisor, a row written
   only when the rate moved, the jump guard holding and a person overriding
   it, watching-only, a feed still loading, no key, and the allow-list's
   refusals. No network, no server, no real file touched. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-fxfeed-${process.pid}-${Date.now()}.db`);
process.env.OG_FX_KEY = 'sk_test';
process.env.OG_FX_URL = 'https://feed.test/exchange-rates';

let DB, Fx, Cat, configRefusal;
const calls = [];
let answer = () => ({ status: 200, body: {} });
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), key: opts && opts.headers && opts.headers['x-api-key'] });
    const a = answer();
    if (a.throw) throw a.throw;
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Fx = await import('../lib/fxfeed.js');
  ({ configRefusal } = await import('../lib/config-writable.js'));
  DB.open(file);
});

after(() => {
  globalThis.fetch = realFetch;
  try { DB.close(); } catch { /* already */ }
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(file + suffix); } catch { /* gone */ } }
});

const live = (buy, sell) => ({ status: 200, body: { success: true, status: 'success', last_updated: '2026-09-24 21:50:15', data: { USD: { buy, sell } } } });
const rows = () => DB.get().prepare("SELECT rate, set_by FROM fx_rates WHERE base = 'USD' AND quote = 'SYP' ORDER BY id DESC").all();
const cfg = (k) => { const r = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(k); return r ? r.value : null; };
const setCfg = (k, v) => DB.get().prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-09-24T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));

test('reads both answer shapes, and knows a loading feed from a broken one', () => {
  assert.equal(Fx.readAnswer({ success: true, status: 'loading' }).error, 'loading');
  assert.deepEqual(Fx.readAnswer({ success: true, currency: 'USD', buy: 14850, sell: 14800, timestamp: 'T' }), { buy: 14850, sell: 14800, feedAt: 'T' });
  assert.deepEqual(Fx.readAnswer(live(13675, 13750).body), { buy: 13675, sell: 13750, feedAt: '2026-09-24 21:50:15' });
  assert.equal(Fx.readAnswer({ error: 'مفتاح API مطلوب', error_en: 'API key required' }).error, 'refused');
  assert.equal(Fx.readAnswer({ success: true, status: 'success', data: { EUR: { buy: 1, sell: 2 } } }).error, 'bad_answer');
  assert.equal(Fx.readAnswer(null).error, 'bad_answer');
});

test('the side and the divisor make a whole-lira rate', () => {
  const raw = { buy: 13675, sell: 13750 };
  assert.equal(Fx.rateFor(raw, { side: 'sell', scale: 100 }), 138);
  assert.equal(Fx.rateFor(raw, { side: 'buy', scale: 100 }), 137);
  assert.equal(Fx.rateFor(raw, { side: 'mid', scale: 100 }), 137);
  assert.equal(Fx.rateFor(raw, { side: 'sell', scale: 1 }), 13750);
  assert.equal(Fx.rateFor({ buy: 1, sell: 1 }, { side: 'sell', scale: 1000 }), null);
});

test('a moved rate is written once, an unmoved one not at all', async () => {
  const before = rows().length;
  const start = Cat.currentRate('USD', 'SYP');
  answer = () => live(13675, 13750);
  let s = await Fx.check();
  assert.equal(s.error, null);
  assert.equal(s.candidate, 138);
  assert.equal(s.current, 138, 'the shop is on the feed’s rate now');
  assert.equal(rows().length, before + 1);
  assert.equal(rows()[0].rate, 138);
  assert.equal(rows()[0].set_by, null, 'the feed signs nothing');
  assert.equal(calls.at(-1).key, 'sk_test');
  assert.equal(calls.at(-1).url, 'https://feed.test/exchange-rates');
  assert.equal(JSON.parse(cfg('fx.feed_last')).rate, 138);
  assert.notEqual(start, 138);
  const logged = DB.get().prepare("SELECT COUNT(*) AS n FROM change_log WHERE tbl = 'fx_rates'").get().n;
  assert.ok(logged >= 1, 'the row is logged, so the mirror carries it');

  s = await Fx.check();
  assert.equal(s.candidate, 138);
  assert.equal(rows().length, before + 1, 'same rate, no second row');
});

test('a jump past the guard is HELD until a person says so', async () => {
  const before = rows().length;
  answer = () => live(27400, 27500);
  let s = await Fx.check();
  assert.equal(s.candidate, 275);
  assert.deepEqual({ rate: s.held.rate, current: s.held.current }, { rate: 275, current: 138 });
  assert.ok(s.held.pct > 20);
  assert.equal(rows().length, before, 'nothing written');
  assert.equal(Cat.currentRate('USD', 'SYP'), 138);

  s = await Fx.check({ force: true });
  assert.equal(s.held, null);
  assert.equal(rows().length, before + 1);
  assert.equal(Cat.currentRate('USD', 'SYP'), 275);
  assert.equal(JSON.parse(cfg('fx.feed_last')).rate, 275);
});

test('switched off, it watches and offers but writes nothing', async () => {
  setCfg('fx.feed_on', '0');
  const before = rows().length;
  answer = () => live(26900, 27000);
  const s = await Fx.check();
  assert.equal(s.on, false);
  assert.equal(s.candidate, 270);
  assert.equal(s.current, 275);
  assert.equal(rows().length, before);
  /* the press still works while off — it is a person's decision */
  await Fx.check({ force: true });
  assert.equal(Cat.currentRate('USD', 'SYP'), 270);
  setCfg('fx.feed_on', '1');
});

test('the divisor and the side are read from config', async () => {
  setCfg('fx.feed_side', 'buy');
  answer = () => live(26900, 27000);
  let s = await Fx.check();
  assert.equal(s.side, 'buy');
  assert.equal(s.candidate, 269);
  setCfg('fx.feed_side', 'sell');
  setCfg('fx.feed_scale', '1');
  s = await Fx.check();
  assert.equal(s.candidate, 27000);
  assert.ok(s.held, 'a hundredfold rate is exactly what the guard is for');
  setCfg('fx.feed_scale', '100');
});

test('a loading feed, an unreachable one and a refused key are codes, not rows', async () => {
  const before = rows().length;
  answer = () => ({ status: 200, body: { success: true, status: 'loading', message: 'Initializing data...' } });
  assert.equal((await Fx.check()).error, 'loading');
  answer = () => ({ throw: Object.assign(new Error('boom'), { name: 'TimeoutError' }) });
  assert.equal((await Fx.check()).error, 'unreachable');
  answer = () => ({ status: 401, body: { error: 'مفتاح API مطلوب', error_en: 'API key required' } });
  assert.equal((await Fx.check()).error, 'refused');
  answer = () => ({ status: 200, body: { success: true, status: 'success', data: {} } });
  assert.equal((await Fx.check()).error, 'bad_answer');
  assert.equal(rows().length, before);
  /* and the last good reading is kept for the card */
  assert.equal((await Fx.check()).raw.sell, 27000);
});

test('no key: never asks, says so', async () => {
  const n = calls.length;
  delete process.env.OG_FX_KEY;
  const s = await Fx.check();
  assert.equal(s.error, 'not_configured');
  assert.equal(s.configured, false);
  assert.equal(calls.length, n);
  process.env.OG_FX_KEY = 'sk_test';
});

test('the allow-list takes the five switches and refuses the feed’s own record', () => {
  assert.equal(configRefusal({ 'fx.feed_on': '0' }), null);
  assert.equal(configRefusal({ 'fx.feed_side': 'buy' }), null);
  assert.equal(configRefusal({ 'fx.feed_minutes': '15', 'fx.feed_scale': '100', 'fx.feed_max_jump_pct': '20' }), null);
  assert.match(configRefusal({ 'fx.feed_side': 'other' }), /sell, buy or mid/);
  assert.match(configRefusal({ 'fx.feed_on': 'yes' }), /1 or 0/);
  assert.match(configRefusal({ 'fx.feed_minutes': '0' }), /between 1 and 1440/);
  assert.match(configRefusal({ 'fx.feed_last': '{}' }), /cannot be changed here/);
});
