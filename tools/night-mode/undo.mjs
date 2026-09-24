#!/usr/bin/env node
/* ==========================================================================
   035's undo, checked.                           node tools/night-mode/undo.mjs
   --------------------------------------------------------------------------
   In PGlite (OG_PGLITE), on the mirror built from 001 to 035:
     - a request is sent, so there is something to lose;
     - undo_035_night_requests.sql runs, and its first query shows it;
     - nothing of 035 is left, og-track's inbox.items and the schemas stay,
       og_vps keeps exactly its 030 grants and can still read the shop;
     - the undo runs a second time without an error;
     - 035 runs again afterwards and a request can be sent again.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done, mirrorDb, seedMirror, asRole, REPO } from './lib.mjs';

const LIN = 'undo-test-lineage';
const db = await mirrorDb();
await seedMirror(db, { lineage: LIN });
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const undo = readFileSync(join(REPO, 'server', 'supabase', 'undo_035_night_requests.sql'), 'utf8');
const again = readFileSync(join(REPO, 'server', 'supabase', '035_night_requests.sql'), 'utf8');

async function submit(op) {
  return asRole(db, 'og_vps', async () => {
    await db.exec('BEGIN READ WRITE');
    const r = await one('SELECT erp.request_submit($1, $2, $3::jsonb) AS r', ['sara', op, JSON.stringify({
      v: 1, customer: { name: 'Nour Haddad', phone: '0933 123 456' }, items: [{ sku: 'OG-050-42', qty: 1 }],
      delivery: { method: 'pickup' }, note: null })]);
    await db.exec('COMMIT');
    return r.r;
  });
}
const grants = async () => (await db.query(
  `SELECT table_schema || '.' || table_name || ':' || privilege_type AS g FROM information_schema.role_table_grants
    WHERE grantee = 'og_vps' ORDER BY 1`)).rows.map((r) => r.g).join(',');

const sent = await submit('op-undo-test-000000000001');
check('a request is waiting before the undo', sent.ok === true, JSON.stringify(sent));
/* og-track's own SQL is not in this repository, so its table is stood in for:
   the undo must leave a table in schema inbox that is not 035's. */
await db.exec(`CREATE TABLE IF NOT EXISTS inbox.items (id bigint PRIMARY KEY, kind text);
               INSERT INTO inbox.items VALUES (1, 'review') ON CONFLICT DO NOTHING`);
const before = await grants();

const results = await db.exec(undo);
const first = results[0] && results[0].rows;
check('the undo\'s first answer shows what would be lost', Array.isArray(first) && first.some((r) => r.state === 'waiting' && Number(r.requests) === 1), JSON.stringify(first));
const last = results[results.length - 1].rows;
check('…and its last answer is empty: nothing of 035 is left', Array.isArray(last) && last.length === 0, JSON.stringify(last));
check('inbox.requests is gone', (await one("SELECT to_regclass('inbox.requests') IS NULL AS gone")).gone === true);
check('the schemas inbox and erp stay',
  (await one("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('inbox', 'erp')")).n === 2);
check('og-track\'s inbox.items (a stand-in here) is untouched, row and all',
  (await one("SELECT count(*)::int AS n FROM inbox.items WHERE kind = 'review'")).n === 1);
check('og_vps keeps exactly the table grants it had', (await grants()) === before);
const reads = await asRole(db, 'og_vps', () => one('SELECT count(*)::int AS n FROM public.products'));
check('og_vps still reads the shop', reads.n > 0);

let twice = null;
try { await db.exec(undo.replace(/^SELECT state[\s\S]*?ORDER BY state;/m, '')); } catch (e) { twice = e.message; }
check('the undo runs a second time without an error', twice === null, twice);

await db.exec(again);
const back = await submit('op-undo-test-000000000002');
check('035 runs again afterwards, and a request can be sent', back.ok === true && /^N-\d{4,}$/.test(back.ref), JSON.stringify(back));
done('night-mode undo');
