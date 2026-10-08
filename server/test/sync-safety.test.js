/* Sync safety (8 Oct 2026): the new Supabase key format, the per-machine
   writer check, and the reconcile that no longer deletes without asking.
   A stand-in Supabase on 127.0.0.1 (test/fake-supabase.js), a throwaway
   database and data folder, an empty env file — no network, no real file. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

/* Async on purpose: the stand-in Supabase runs in THIS process, and a
   spawnSync would block the event loop that has to answer the child. */
function run(args, opts) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.stdin.end(opts.input || '');
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
import { fileURLToPath } from 'node:url';
import { startFake } from './fake-supabase.js';

const SERVER = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'og-syncsafe-'));
const envFile = join(dir, 'empty.env');
writeFileSync(envFile, '');
const dbA = join(dir, 'a.db');
const writerA = join(dir, 'data-a', 'mirror-writer.id');
const writerB = join(dir, 'data-b', 'mirror-writer.id');
const SECRET = 'sb_secret_test_0123456789abcdef';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';

let fake, DB, SB, Lineage;

before(async () => {
  fake = await startFake();
  Object.assign(process.env, {
    OG_ENV_FILE: envFile, OG_DATA_DIR: join(dir, 'data-a'), OG_WRITER_FILE: writerA,
    SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: ''
  });
  DB = await import('../lib/db.js');
  SB = await import('../lib/supabase.js');
  Lineage = await import('../lib/lineage.js');
  DB.open(dbA);
});

after(async () => {
  try { DB.close(); } catch { /* already */ }
  await fake.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file */ }
});

/* ---- 1. the key ------------------------------------------------------- */

test('a new sb_secret_ key goes on apikey only; an old JWT on apikey and Bearer', () => {
  assert.deepEqual(SB.keyHeaders(SECRET), { apikey: SECRET });
  assert.deepEqual(SB.keyHeaders(JWT), { apikey: JWT, Authorization: `Bearer ${JWT}` });
  assert.equal(SB.isNewKey('sb_publishable_x'), true);
  assert.equal(SB.isNewKey(JWT), false);
});

/* Each kind in its own process, because supabase.js reads the key once. Both
   PostgREST (a select) and Storage (an upload) go through the stand-in, which
   refuses a new key sent as Bearer the way Supabase does. */
async function headersFrom(env) {
  const code = `
    const SB = await import('./lib/supabase.js');
    const St = await import('./lib/storage.js');
    await SB.select('products', { limit: 1 });
    const p = await SB.ping(); if (!p.ok) throw new Error('ping ' + p.message);
    await St.putObject('t/x.png', Buffer.from('x'), 'image/png');
    console.log('done ' + SB.keyKind());`;
  return await run(['--input-type=module', '-e', code], {
    cwd: SERVER,
    env: { ...process.env, OG_ENV_FILE: envFile, SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', ...env }
  });
}

test('every request a new key makes is accepted: PostgREST and Storage', async () => {
  const from = fake.seen.length;
  const r = await headersFrom({ SUPABASE_SECRET_KEY: SECRET });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /done secret/);
  const mine = fake.seen.slice(from);
  assert.ok(mine.some((s) => s.path.startsWith('/storage/v1/object/')), 'an upload was made');
  assert.ok(mine.length >= 3);
  for (const s of mine) { assert.equal(s.apikey, SECRET); assert.equal(s.auth, null); }
});

test('an old service_role JWT still works, on either variable name', async () => {
  for (const name of ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const from = fake.seen.length;
    const r = await headersFrom({ [name]: JWT });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /done service_role/);
    for (const s of fake.seen.slice(from)) { assert.equal(s.apikey, JWT); assert.equal(s.auth, `Bearer ${JWT}`); }
  }
});

test('SUPABASE_SECRET_KEY wins over an old SUPABASE_SERVICE_ROLE_KEY in the same file', async () => {
  const from = fake.seen.length;
  const r = await headersFrom({ SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: JWT });
  assert.equal(r.status, 0, r.stderr);
  for (const s of fake.seen.slice(from)) assert.equal(s.apikey, SECRET);
});

/* ---- 2. the writer ---------------------------------------------------- */

test('the guard: a first claim, then writerUnset until a writer is recorded', async () => {
  const g1 = await Lineage.guard();
  assert.equal(g1.ok, true);
  assert.equal(g1.claimed, true);
  fake.rows('sync_state').push({ id: 'shop', last_seq: 0, note: 'alive', last_push_at: new Date().toISOString() });
  const g2 = await Lineage.guard();
  assert.equal(g2.ok, true);
  assert.equal(g2.writerUnset, true, 'nothing stops before a writer is recorded');
});

test('claimWriter records this machine: a file in the data folder and a sync_state row', async () => {
  const r = await Lineage.claimWriter();
  assert.equal(r.ok, true);
  assert.ok(existsSync(writerA));
  const row = fake.rows('sync_state').find((x) => x.id === 'writer');
  assert.ok(row && row.note.startsWith(Lineage.localWriter()));
  const again = await Lineage.claimWriter();
  assert.equal(again.already, true);
  const g = await Lineage.guard();
  assert.equal(g.ok, true);
  assert.equal(g.writerUnset, undefined);
});

test('a COPY of the database (same lineage, no writer file) is refused with a clear message', async () => {
  const copy = join(dir, 'copy.db');
  DB.get().exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  DB.close();
  DB.open(copy);
  process.env.OG_WRITER_FILE = writerB;   /* another machine's data folder */
  const g = await Lineage.guard();
  assert.equal(g.ok, false);
  assert.equal(g.notWriter, true);
  assert.equal(g.mine, Lineage.localId({ create: false }), 'the lineage itself still matches');
  const lines = Lineage.refusal(g.other, g);
  assert.ok(lines[0].startsWith('! ' + Lineage.NOT_THE_WRITER));
  assert.match(lines.join('\n'), /Nothing was pushed/);
  /* It cannot quietly take over… */
  const take = await Lineage.claimWriter();
  assert.equal(take.ok, false);
  assert.equal(take.code, 'writer_elsewhere');
  /* …only a person saying the shop has moved can, and then the first is refused. */
  const moved = await Lineage.claimWriter({ replace: true });
  assert.equal(moved.ok, true);
  assert.equal((await Lineage.guard()).ok, true);
  process.env.OG_WRITER_FILE = writerA;
  const old = await Lineage.guard();
  assert.equal(old.notWriter, true);
  /* Put machine A back as the writer for the reconcile test. */
  process.env.OG_WRITER_FILE = writerA;
  DB.close();
  DB.open(dbA);
  assert.equal((await Lineage.claimWriter({ replace: true })).ok, true);
});

test('a different database cannot be recorded as the writer at all', async () => {
  const other = join(dir, 'other.db');
  DB.close();
  DB.open(other);
  process.env.OG_WRITER_FILE = join(dir, 'data-c', 'mirror-writer.id');
  const r = await Lineage.claimWriter({ replace: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_owner');
  assert.equal(existsSync(process.env.OG_WRITER_FILE), false, 'no file made for a refusal');
  DB.close();
  DB.open(dbA);
  process.env.OG_WRITER_FILE = writerA;
});

/* ---- 3. the reconcile ------------------------------------------------- */

async function reconcile(args) {
  DB.close();
  const r = await run(['scripts/supabase-reconcile.js', ...args], {
    cwd: SERVER, input: '',
    env: { ...process.env, OG_DB: dbA, OG_DATA_DIR: join(dir, 'data-a'), OG_WRITER_FILE: writerA, NO_COLOR: '1' }
  });
  DB.open(dbA);
  return r;
}

test('reconcile lists every row it would delete, saves them, and with nobody to ask writes NOTHING', async () => {
  for (let i = 0; i < 30; i++) fake.rows('customers').push({ id: 90000 + i, name: 'stray ' + i });
  const from = fake.seen.length;
  const r = await reconcile([]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const out = r.stdout;
  assert.match(out, /customers.*30 row\(s\)/);
  assert.match(out, /90029/, 'the last id is listed, not cut off at 25');
  assert.match(out, /Nothing was written/);
  const writes = fake.seen.slice(from).filter((s) => s.method !== 'GET' && s.method !== 'HEAD');
  assert.deepEqual(writes, [], 'no upsert, no delete');
  assert.equal(fake.rows('customers').length, 30);
  const files = readdirSync(join(dir, 'data-a', 'backups')).filter((f) => f.startsWith('reconcile-delete-'));
  assert.equal(files.length, 1);
  const saved = JSON.parse(readFileSync(join(dir, 'data-a', 'backups', files[0]), 'utf8'));
  assert.equal(saved.tables.customers.length, 30);
  assert.equal(saved.tables.customers[0].name, 'stray 0', 'the whole row, not only the id');
});

test('reconcile --yes deletes what it listed', async () => {
  const r = await reconcile(['--yes']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fake.rows('customers').length, 0);
  assert.match(r.stdout, /customers — 30 row\(s\) deleted/);
});

test('reconcile from a copy that is not the writer is refused before it reads anything to delete', async () => {
  fake.rows('customers').push({ id: 91000, name: 'keep me' });
  DB.close();
  const r = await run(['scripts/supabase-reconcile.js', '--yes'], {
    cwd: SERVER, input: '',
    env: { ...process.env, OG_DB: dbA, OG_DATA_DIR: join(dir, 'data-a'), OG_WRITER_FILE: writerB, NO_COLOR: '1' }
  });
  DB.open(dbA);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /isn't the machine that writes/);
  assert.equal(fake.rows('customers').length, 1);
});
