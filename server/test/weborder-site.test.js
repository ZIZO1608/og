/* Telling the website a website order was accepted or rejected (migration
   075, lib/weborder-site.js, contract v1.8 §7a) — against a throwaway
   database and a faked fetch. Nothing is said until the cloud has the
   decision; then one call with the key, both languages, no customer details;
   said once; backed off on a 500, stopped on a 401, never for a decision
   days old unless a person asks; the card's journey fields. No network, no
   server, no real file — OG_ENV_FILE points at nothing. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-wosite-${process.pid}-${Date.now()}.db`);
process.env.OG_ENV_FILE = join(tmpdir(), `og-wosite-none-${process.pid}.env`);
process.env.OG_WEB_API_KEY = 'website-key-for-the-test';

let DB, Site, WebOrders;
const calls = [];
let answer = () => ({ status: 200, body: { ok: true } });
const realFetch = globalThis.fetch;
const SITE = 'https://og-site.test';

const now = Date.now();
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString();

function addRow(ref, { state = 'accepted', cloud = state, decided = iso(60000), code = null, sale = null, payload = {} } = {}) {
  DB.get().prepare(
    `INSERT INTO web_orders (ref, revision, state, payload, placed_at, received_at, updated_at,
                             sale_id, reject_code, decided_at, cloud_state, cloud_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ref, state, JSON.stringify({ customer: { name: 'Nour Haddad', phone: '0933111222' }, ...payload }),
    iso(3600000), iso(3600000), iso(), sale, code, decided, cloud, cloud ? iso(30000) : null);
}
const row = (ref) => DB.get().prepare('SELECT * FROM web_orders WHERE ref = ?').get(ref);
const setCfg = (k, v) => DB.get().prepare(
  'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run(k, v, new Date().toISOString());

before(async () => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.authorization, redirect: opts.redirect, body: JSON.parse(opts.body) });
    const a = answer();
    if (a.throw) throw a.throw;
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  DB = await import('../lib/db.js');
  Site = await import('../lib/weborder-site.js');
  WebOrders = await import('../lib/weborders.js');
  DB.open(file);
  setCfg('shop.name', 'OG Sports');
  setCfg('receipt.public_url', 'https://track.og.test');
});

after(() => {
  globalThis.fetch = realFetch;
  try { DB.close(); } catch { /* already */ }
  for (const f of [file, file + '-wal', file + '-shm']) rmSync(f, { force: true });
});

test('no website address: nothing is called, and the screen is told why', async () => {
  addRow('W-1001');
  const out = await Site.tell({ now });
  assert.equal(out.skipped, 'no_site');
  assert.equal(calls.length, 0);
  assert.deepEqual(Site.readiness(), { configured: false, why: 'no_site' });
  setCfg('web.site_url', SITE);
  assert.deepEqual(Site.readiness(), { configured: true, why: null });
});

test('an accepted order the cloud has: one call, the key, both languages, no customer details', async () => {
  calls.length = 0;
  const out = await Site.tell({ now });
  assert.equal(out.sent, 1);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, SITE + '/api/og/order-changed');
  assert.equal(c.auth, 'Bearer website-key-for-the-test');
  assert.equal(c.redirect, 'manual');
  assert.equal(c.body.event, 'order_changed');
  assert.equal(c.body.ref, 'W-1001');
  assert.equal(c.body.state, 'accepted');
  assert.ok(c.body.message.title.ar && c.body.message.title.en);
  assert.match(c.body.message.body.en, /W-1001/);
  assert.match(c.body.message.body.ar, /W-1001/);
  const text = JSON.stringify(c.body);
  assert.ok(!text.includes('Nour') && !text.includes('0933111222'), 'no name or phone leaves');
  const r = row('W-1001');
  assert.equal(r.site_state, 'accepted');
  assert.ok(r.site_at);
});

test('said once', async () => {
  calls.length = 0;
  await Site.tell({ now });
  assert.equal(calls.length, 0);
});

test('not before the cloud has the decision', async () => {
  calls.length = 0;
  addRow('W-1002', { cloud: null });
  await Site.tell({ now });
  assert.equal(calls.length, 0);
  DB.get().prepare("UPDATE web_orders SET cloud_state = 'accepted' WHERE ref = 'W-1002'").run();
  await Site.tell({ now });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.ref, 'W-1002');
});

test('a rejection carries its code and the reason in both languages', async () => {
  calls.length = 0;
  addRow('W-1003', { state: 'rejected', code: 'out_of_stock' });
  await Site.tell({ now });
  assert.equal(calls.length, 1);
  const b = calls[0].body;
  assert.equal(b.state, 'rejected');
  assert.equal(b.code, 'out_of_stock');
  assert.equal(b.trackUrl, null);
  assert.match(b.message.body.en, /out of stock/);
  assert.match(b.message.body.ar, /خلصت/);
});

test('a 500 backs off, and the next try waits for its time', async () => {
  calls.length = 0;
  addRow('W-1004');
  answer = () => ({ status: 500, body: {} });
  const out = await Site.tell({ now });
  assert.equal(out.failed, 1);
  let r = row('W-1004');
  assert.equal(r.site_state, null);
  assert.equal(r.site_tries, 1);
  assert.equal(r.site_error, 'site_error:500');
  assert.ok(r.site_next_at > iso());
  calls.length = 0;
  await Site.tell({ now });
  assert.equal(calls.length, 0, 'not before its time');
  answer = () => ({ status: 200, body: { ok: true } });
  await Site.tell({ now: now + 31 * 1000 });
  assert.equal(calls.length, 1);
  r = row('W-1004');
  assert.equal(r.site_state, 'accepted');
  assert.equal(r.site_error, null);
  assert.equal(r.site_tries, 0);
});

test('a wrong key is not retried by itself; "tell again" starts a fresh round', async () => {
  calls.length = 0;
  addRow('W-1005');
  answer = () => ({ status: 401, body: {} });
  await Site.tell({ now });
  assert.equal(row('W-1005').site_tries, Site.MAX_TRIES);
  calls.length = 0;
  await Site.tell({ now: now + 2 * 3600 * 1000 });
  assert.equal(calls.length, 0, 'gave up');
  answer = () => ({ status: 200, body: { ok: true } });
  Site.again('W-1005');
  await Site.tell({ now: Date.now() + 1000 });
  assert.equal(calls.length, 1);
  assert.equal(row('W-1005').site_state, 'accepted');
});

test('a decision days old is never announced by itself, only when asked', async () => {
  calls.length = 0;
  addRow('W-1006', { decided: iso(5 * 86400000) });
  await Site.tell({ now });
  assert.equal(calls.length, 0);
  Site.again('W-1006');
  await Site.tell({ now: Date.now() + 1000 });
  assert.equal(calls.length, 1);
  assert.throws(() => Site.again('NOPE-1'), (e) => e.code === 'not_found');
});

test('a website that cannot be reached stops the batch', async () => {
  calls.length = 0;
  addRow('W-1007'); addRow('W-1008');
  answer = () => ({ throw: Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }) });
  const out = await Site.tell({ now });
  assert.equal(calls.length, 1);
  assert.equal(out.failed, 1);
  assert.equal(row('W-1007').site_error, 'unreachable');
  assert.equal(row('W-1008').site_tries, 0, 'the second was not tried into a dead line');
  answer = () => ({ status: 200, body: { ok: true } });
});

test('an accepted order with a sale carries its total and tracking link', () => {
  const d = DB.get();
  const p = Site.payloadFor({ ref: 'W-2000', state: 'accepted', sale_id: null, decided_at: iso() }, d);
  assert.equal(p.total, null);
  assert.equal(p.trackUrl, null);
  /* A sale row, as Orders writes it, would give total and token: the shape
     is checked against a stand-in rather than the whole sale machinery. */
  const fake = { prepare: (sql) => ({
    get: () => /FROM sales/.test(sql) ? { id: 'INV-3001', total: 4500, currency: 'USD', public_token: 'a'.repeat(32) }
      : /currencies/.test(sql) ? { minor_exp: 2 }
      : /shop\.name/.test(sql) ? { value: 'OG Sports' }
      : /config/.test(sql) ? { value: 'https://track.og.test' } : null
  }) };
  const q = Site.payloadFor({ ref: 'W-2001', state: 'accepted', sale_id: 'INV-3001', decided_at: iso() }, fake);
  assert.deepEqual(q.total, { amount: 4500, currency: 'USD', minorExp: 2 });
  assert.equal(q.trackUrl, 'https://track.og.test/i/' + 'a'.repeat(32));
  assert.match(q.message.body.en, /\$45\.00/);
  assert.match(q.message.body.ar, /⁦\$45\.00⁩/, 'the money is isolated in Arabic');
});

test('the card is handed the journey', () => {
  const out = WebOrders.list({ state: 'accepted' });
  assert.deepEqual(out.site, { configured: true, why: null });
  const told = out.orders.find((o) => o.ref === 'W-1001');
  assert.equal(told.cloudHas, true);
  assert.equal(told.siteState, 'accepted');
  assert.ok(told.notice && told.notice.title.ar);
  const dead = out.orders.find((o) => o.ref === 'W-1007');
  assert.equal(dead.siteState, null);
  assert.equal(dead.siteError, 'unreachable');
  assert.equal(dead.siteGaveUp, false);
});
