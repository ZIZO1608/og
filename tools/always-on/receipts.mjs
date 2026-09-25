#!/usr/bin/env node
/* ==========================================================================
   A receipt from a server that is not the shop's laptop, printed in the shop.
                                            node tools/always-on/receipts.mjs

   A real OG server (server/index.js) on a throwaway data folder with
   receipt.transport = 'agent', a real sale, and the REAL print agent
   (agent/print-agent.js) with a config of its own whose "printer" is a file
   on disk — `copy /b` to a file is the same bytes the spooler would get. So
   the check is exact: the bytes the till sent are the bytes that came out.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}

const TMP = mkdtempSync(join(tmpdir(), 'og-receipts-'));
const ENV = join(TMP, 'empty.env');
writeFileSync(ENV, '');
const DATA = join(TMP, 'data');
const env = { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: DATA };

/* ---- the shop: an owner, a shoe, a sale, and receipts through the agent -- */
const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import * as Cat from './lib/catalogue.js';
  import * as Sales from './lib/sales.js';
  import { dbFile } from './lib/env.js';
  const d = DB.open(dbFile());
  const u = await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  const uid = d.prepare("SELECT id FROM users WHERE username = 'owner1'").get().id;
  Cat.createWithVariants({ name: 'Test Shoe', type: 'sneakers', currency: 'USD', costPrice: 7700, sellingPrice: 34600,   /* 067: prices are dollars (cents) */
    sizes: [{ size: '42', qty: 5 }], whId: 'store', userId: uid });
  const sku = d.prepare('SELECT sku FROM variants LIMIT 1').get().sku;
  Sales.record({ lines: [{ sku, qty: 1 }], whId: 'store', payment: 'cash', userId: uid, opId: 'seed-sale-1' });
  for (const [k, v] of [['receipt.transport', 'agent'], ['receipt.station', 'shop-test']]) {
    d.prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v, new Date().toISOString());
  }
  DB.close();
`], { cwd: SERVER, env, stdio: 'inherit' });
check('a shop with an owner, a shoe and one sale is set up', await new Promise((ok) => seed.on('exit', (c) => ok(c === 0))));
const probe = new DatabaseSync(join(DATA, 'og.db'), { readOnly: true });
const SALE = probe.prepare('SELECT id FROM sales LIMIT 1').get().id;
probe.close();

const PORT = await freePort();
const procs = {};
let serverOut = '', agentOut = '';
procs.server = spawn(process.execPath, ['index.js'], {
  cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: { ...env, OG_PORT: String(PORT), OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0', FORCE_COLOR: '0' }
});
procs.server.stdout.on('data', (b) => { serverOut += b; });
procs.server.stderr.on('data', (b) => { serverOut += b; });

function http(method, path, { body, cookie } = {}) {
  return new Promise((ok) => {
    const h = {};
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET') h.Origin = `http://127.0.0.1:${PORT}`;
    const r = request({ host: '127.0.0.1', port: PORT, method, path, headers: h }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* not json */ } ok({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', (e) => ok({ status: 0, error: e.message }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
const db = () => new DatabaseSync(join(DATA, 'og.db'), { readOnly: true });

try {
  check('the server starts', await until(async () => (await http('GET', '/api/health')).status === 200, 20000), serverOut.slice(-300));
  const login = await http('POST', '/api/auth/login', { body: { username: 'owner1', password: 'correct-horse-9' } });
  const cookie = [].concat(login.headers['set-cookie'] || []).find((c) => c.startsWith('og_session=')).split(';')[0];

  /* 1 — with no agent connected, the receipt waits and the till is told */
  const BYTES = Buffer.from('\x1b@receipt for ' + SALE + '\n\x1dV\x42\x00');
  const p1 = await http('POST', '/api/print', { cookie, body: { saleId: SALE, bytes: BYTES.toString('base64'), copies: 2, kind: 'sale', opId: 'op-print-1' } });
  check('printing with receipt.transport = agent answers queued, not printed', p1.status === 200 && p1.json.queued === true && p1.json.jobId > 0, JSON.stringify(p1.json));
  check('…and tells the till no agent is connected', p1.json.agentHere === false);
  const again = await http('POST', '/api/print', { cookie, body: { saleId: SALE, bytes: BYTES.toString('base64'), copies: 2, kind: 'sale', opId: 'op-print-1' } });
  check('the same press sent twice is the same job (opId)', again.json.jobId === p1.json.jobId && again.json.replayed === true, JSON.stringify(again.json));
  let d = db();
  check('one job is waiting for station "shop-test"', d.prepare("SELECT COUNT(*) n FROM receipt_jobs WHERE station = 'shop-test' AND status = 'pending'").get().n === 1);
  check('nothing is in the print history yet — queued proves nothing', d.prepare('SELECT COUNT(*) n FROM print_log').get().n === 0);
  d.close();

  /* 2 — the real agent, printing into a file */
  const OUTFILE = join(TMP, 'printed.bin');
  const CFG = join(TMP, 'agent-config.json');
  writeFileSync(CFG, JSON.stringify({ serverUrl: `http://127.0.0.1:${PORT}`, username: 'owner1', password: 'correct-horse-9',
    receiptShare: OUTFILE, receiptStation: 'shop-test' }));
  procs.agent = spawn(process.execPath, [join(ROOT, 'agent', 'print-agent.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, OG_AGENT_CONFIG: CFG }
  });
  procs.agent.stdout.on('data', (b) => { agentOut += b; });
  procs.agent.stderr.on('data', (b) => { agentOut += b; });
  check('the agent prints the waiting receipt', await until(() => existsSync(OUTFILE), 15000), agentOut.slice(-400));
  check('…byte for byte what the till sent', existsSync(OUTFILE) && readFileSync(OUTFILE).equals(BYTES));
  check('…and reports it: the job is done', await until(() => { const x = db(); const s = x.prepare('SELECT status FROM receipt_jobs WHERE id = ?').get(p1.json.jobId).status; x.close(); return s === 'done'; }, 5000));
  d = db();
  const log = d.prepare('SELECT * FROM print_log').all();
  d.close();
  check('the print history now says sent, for that sale, by that person', log.length === 1 && log[0].status === 'sent' && log[0].sale_id === SALE && log[0].copies === 2, JSON.stringify(log));
  check('the agent did not start a label loop it has no printer for', !/labels —/.test(agentOut) && /receipts — station "shop-test"/.test(agentOut));

  /* 3 — with the agent connected, the till is told it is */
  rmSync(OUTFILE, { force: true });
  const p2 = await http('POST', '/api/print', { cookie, body: { saleId: SALE, bytes: BYTES.toString('base64'), copies: 1, kind: 'gift', opId: 'op-print-2' } });
  check('with the agent listening, the till is told it is there', p2.json.queued && p2.json.agentHere === true, JSON.stringify(p2.json));
  check('…and the gift slip comes out too', await until(() => existsSync(OUTFILE), 10000));

  /* 4 — a receipt nobody printed in time is dropped, not printed late */
  procs.agent.kill();
  await sleep(500);
  rmSync(OUTFILE, { force: true });
  const p3 = await http('POST', '/api/print', { cookie, body: { saleId: SALE, bytes: BYTES.toString('base64'), copies: 1, kind: 'sale', opId: 'op-print-3' } });
  /* Age it past the 10 minutes, as a dropped line would. */
  const w = new DatabaseSync(join(DATA, 'og.db'));
  w.exec('PRAGMA busy_timeout = 5000');
  w.prepare('UPDATE receipt_jobs SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 11 * 60000).toISOString(), p3.json.jobId);
  w.close();
  procs.agent = spawn(process.execPath, [join(ROOT, 'agent', 'print-agent.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, OG_AGENT_CONFIG: CFG }
  });
  check('an agent coming back after 11 minutes does NOT print the stale receipt',
    await until(() => { const x = db(); const s = x.prepare('SELECT status FROM receipt_jobs WHERE id = ?').get(p3.json.jobId).status; x.close(); return s === 'expired'; }, 10000)
      && (await sleep(1500), !existsSync(OUTFILE)));
  d = db();
  const last = d.prepare('SELECT status, error FROM print_log ORDER BY id DESC LIMIT 1').get();
  d.close();
  check('…and the print history says why it did not come out', last && last.status === 'failed' && /not printed within 10 minutes/.test(last.error || ''), JSON.stringify(last));

  /* 5 — the laptop's own checks know about the agent (read-only, no paper) */
  const run = (script, args, cfgFile) => new Promise((ok) => {
    let out = '';
    const p = spawn(process.execPath, [join('scripts', script), ...args], {
      cwd: SERVER, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, FORCE_COLOR: '0', OG_AGENT_CONFIG: cfgFile }
    });
    p.stdout.on('data', (b) => { out += b; }); p.stderr.on('data', (b) => { out += b; });
    p.on('exit', (code) => ok({ code, out: out.replace(/\x1b\[[0-9;]*m/g, '') }));
  });
  const QCFG = join(TMP, 'agent-queue.json');
  writeFileSync(QCFG, JSON.stringify({ serverUrl: 'http://127.0.0.1:1', username: 'x', password: 'x',
    receiptShare: '\\\\localhost\\OGRECEIPT_TEST_NOPE', receiptStation: 'shop-test' }));
  const dry = await run('test-print.js', ['--dry', '--receipt'], QCFG);
  check('test-print in agent mode aims at the agent\'s receipt queue', /would go to \\\\localhost\\OGRECEIPT_TEST_NOPE/.test(dry.out), dry.out.slice(-300));
  const noq = await run('test-print.js', ['--dry', '--receipt'], join(TMP, 'no-such-config.json'));
  check('…and with no agent here it says so, rather than aiming at a host nobody set', /this computer's agent has no receipt queue/.test(noq.out) && !/would go to/.test(noq.out), noq.out.slice(-300));
  const hw = await run('hardware.js', ['--json'], QCFG);
  const hwJson = (() => { try { return JSON.parse((/OG_HW_JSON (.*)/.exec(hw.out) || [])[1]); } catch { return null; } })();
  /* 'fix' where a receipt printer is plugged in here (it offers to make the
     queue — without --install it changes nothing), 'person' where none is. */
  check('hardware checks the agent\'s receipt queue: missing, so to fix or for a person',
    hwJson && (hwJson.receipt === 'fix' || hwJson.receipt === 'person') && /OGRECEIPT_TEST_NOPE/.test(hw.out), hw.out.slice(-500));
  check('…and does not complain about a label share this agent never had', !/printerShare ""/.test(hw.out));
  const hwNone = await run('hardware.js', ['--json'], join(TMP, 'no-such-config.json'));
  check('with no agent on this computer, hardware says receipts wait for one elsewhere',
    /Receipts wait for the shop's print agent, and this computer is not one/.test(hwNone.out), hwNone.out.slice(-400));

  /* 6 — the doors */
  check('the agent\'s door needs a signed-in account', (await http('GET', '/api/receipts/next?station=shop-test')).status === 401);
  const done = await http('POST', `/api/receipts/${p1.json.jobId}/done`, { cookie, body: { claimToken: 'not-the-token' } });
  check('a completion with the wrong claim token changes nothing', done.status === 200 && done.json.stale === true);
} finally {
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\nreceipts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
