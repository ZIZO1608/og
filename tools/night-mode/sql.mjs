#!/usr/bin/env node
/* ==========================================================================
   035 in a real Postgres.                         node tools/night-mode/sql.mjs
   --------------------------------------------------------------------------
   PGlite (OG_PGLITE, see lib.mjs) holding the mirror's schema 001 → 035 with
   the three Supabase roles. Checks: the file runs twice; og_vps can submit
   ONLY inside a READ WRITE transaction and is still SELECT-only on every
   table; each function has exactly one caller; every refusal code; the
   payload is built from the mirror; the laptop's take / mark follow the
   lineage and never reverse a decision; the guard at the end of 035 fails
   the file when og_vps has been given a write.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mirrorDb, seedMirror, asRole, check, done, SUPA } from './lib.mjs';

const LIN = 'lin-night-0001';
const db = await mirrorDb();
check('001 → 035 apply, and 030 / 031 / 035 run a second time without an error', true);
await seedMirror(db, { lineage: LIN });

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };
let opN = 0;
const op = () => 'op-test-' + String(++opN).padStart(12, '0');
const good = (over = {}) => ({
  v: 1,
  customer: { name: 'Nour Haddad', phone: '0933 123 456', id: 81 },
  items: [{ sku: 'OG-050-42', qty: 1 }],
  delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery' },
  note: 'Call after 6',
  ...over
});

/* og_vps submitting, as og-bridge does: BEGIN READ WRITE … COMMIT. */
async function submit(user, opId, request) {
  return asRole(db, 'og_vps', async () => {
    await db.exec('BEGIN READ WRITE');
    const r = await one('SELECT erp.request_submit($1, $2, $3::jsonb) AS r', [user, opId, JSON.stringify(request)]);
    await db.exec('COMMIT');
    return r.r;
  });
}
const svc = (sql, params) => asRole(db, 'service_role', () => one(sql, params), { readOnly: false });

/* ---- the read-only default is respected -------------------------------- */
{
  const e = await asRole(db, 'og_vps', async () => {
    try { await db.query('SELECT erp.request_submit($1, $2, $3::jsonb)', ['sara', op(), JSON.stringify(good())]); return null; }
    catch (err) { return err.message; }
  });
  check('og_vps cannot submit inside its read-only default transaction', e && /read-only/i.test(e), String(e));
}

/* ---- a good one --------------------------------------------------------- */
const op1 = op();
const r1 = await submit('sara', op1, good({
  customer: { name: '  Nour\tHaddad  ', phone: '0933 123 456', id: 81 },
  items: [{ sku: 'OG-050-42', qty: 1, name: 'LIES', size: '99' }, { sku: 'OG-051-C2-42', qty: 2 }]
}));
check('BEGIN READ WRITE: a good request is accepted with an N- ref', r1.ok === true && /^N-\d{4,}$/.test(r1.ref) && r1.state === 'waiting', JSON.stringify(r1));
const row1 = await one('SELECT * FROM inbox.requests WHERE ref = $1', [r1.ref]);
check('the row is waiting, by the night user, source night', row1 && row1.state === 'waiting' && row1.by_user === 'sara' && row1.source === 'night');
check('the phone digits are stored for the cap', row1.phone_digits === '0933123456', row1.phone_digits);
check('the name is tidied (tab → space, trimmed)', row1.payload.customer.name === 'Nour Haddad', row1.payload.customer.name);
const l0 = row1.payload.items[0], l1 = row1.payload.items[1];
check('item names and sizes come from the mirror, not the caller', l0.name === 'Samba OG' && l0.size === '42', JSON.stringify(l0));
check('a one-colour product carries no colour', !('colour' in l0), JSON.stringify(l0));
check('a two-colour product carries its colour in both languages', l1.colour === 'Black' && l1.colourAr === 'أسود', JSON.stringify(l1));
check('the customer id hint is kept', row1.payload.customer.id === 81);
check('delivery method, city and address are kept', row1.payload.delivery.method === 'delivery' && row1.payload.delivery.city === 'Aleppo');

/* ---- replay and op ------------------------------------------------------ */
const again = await submit('sara', op1, good());
check('the same op from the same user is the same request (replayed)', again.ok && again.ref === r1.ref && again.replayed === true, JSON.stringify(again));
check('…and still one row', (await one('SELECT count(*)::int AS n FROM inbox.requests WHERE op = $1', [op1])).n === 1);
const stolen = await submit('karim', op1, good());
check('the same op from another user is refused op_taken', stolen.code === 'op_taken', JSON.stringify(stolen));

/* ---- every refusal ------------------------------------------------------ */
const cases = [
  ['bad_user', () => submit('A B', op(), good())],
  ['bad_user', () => submit('x', op(), good())],
  ['bad_op', () => submit('sara', 'short', good())],
  ['unsupported', () => submit('sara', op(), { ...good(), v: 2 })],
  ['too_big', () => submit('sara', op(), { ...good(), note: 'x'.repeat(9000) })],
  ['bad_name', () => submit('sara', op(), good({ customer: { name: 'N', phone: '0933123456' } }))],
  ['bad_name', () => submit('sara', op(), good({ customer: { name: 'N'.repeat(81), phone: '0933123456' } }))],
  ['bad_name', () => submit('sara', op(), good({ customer: { phone: '0933123456' } }))],
  ['bad_phone', () => submit('sara', op(), good({ customer: { name: 'Nour', phone: '123456' } }))],
  ['bad_phone', () => submit('sara', op(), good({ customer: { name: 'Nour', phone: '1234567890123456' } }))],
  ['bad_phone', () => submit('sara', op(), good({ customer: { name: 'Nour', phone: 'call 0933 123 456 and ask for the reception desk' } }))],
  ['bad_customer', () => submit('sara', op(), good({ customer: { name: 'Nour', phone: '0933123456', id: 'x' } }))],
  ['bad_customer', () => submit('sara', op(), good({ customer: { name: 'Nour', phone: '0933123456', id: -3 } }))],
  ['bad_items', () => submit('sara', op(), good({ items: [] }))],
  ['bad_items', () => submit('sara', op(), good({ items: Array.from({ length: 21 }, (_, i) => ({ sku: 'OG-X-' + i, qty: 1 })) }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG-050-42', qty: 1 }, { sku: 'OG-050-42', qty: 1 }] }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG-050-42', qty: 0 }] }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG-050-42', qty: 21 }] }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG-050-42', qty: 1.5 }] }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG-050-42', qty: 20 }, { sku: 'OG-050-43', qty: 20 }, { sku: 'OG-051-42', qty: 20 }, { sku: 'OG-051-C2-42', qty: 1 }] }))],
  ['bad_items', () => submit('sara', op(), good({ items: [{ sku: 'OG 050', qty: 1 }] }))],
  ['unknown_sku', () => submit('sara', op(), good({ items: [{ sku: 'OG-999-42', qty: 1 }] }))],
  ['unknown_sku', () => submit('sara', op(), good({ items: [{ sku: 'OG-052-40', qty: 1 }] }))],
  ['bad_delivery', () => submit('sara', op(), good({ delivery: { method: 'teleport' } }))],
  ['bad_delivery', () => submit('sara', op(), good({ delivery: { method: 'driver', city: 'Aleppo', address: 'xxx' } }))],
  ['bad_delivery', () => submit('sara', op(), good({ delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo', country: 'syria' } }))],
  ['bad_city', () => submit('sara', op(), good({ delivery: { method: 'delivery', address: 'New Aleppo' } }))],
  ['bad_address', () => submit('sara', op(), good({ delivery: { method: 'delivery', city: 'Aleppo', address: 'x' } }))],
  ['bad_address', () => submit('sara', op(), good({ delivery: { method: 'delivery', city: 'Aleppo', address: 'x'.repeat(301) } }))],
  ['bad_note', () => submit('sara', op(), good({ note: 'x'.repeat(501) }))],
  ['bad_note', () => submit('sara', op(), good({ note: 12 }))]
];
for (const [code, run] of cases) {
  const r = await run();
  check(`refused ${code}${r.field ? ' (' + r.field + ')' : ''}`, r.ok === false && r.code === code, JSON.stringify(r));
}
const unknown = await submit('sara', op(), good({ items: [{ sku: 'OG-999-42', qty: 1 }] }));
check('unknown_sku names the SKU', unknown.sku === 'OG-999-42');

const pick = await submit('sara', op(), good({ customer: { name: 'Rami', phone: '0944555666' }, delivery: { method: 'pickup', city: 'IGNORED', address: 'IGNORED' } }));
const pickRow = await one('SELECT payload FROM inbox.requests WHERE ref = $1', [pick.ref]);
check('a pickup keeps no city or address', pick.ok && !pickRow.payload.delivery.city && !pickRow.payload.delivery.address, JSON.stringify(pickRow && pickRow.payload.delivery));

const ctl = await submit('sara', op(), good({ customer: { name: 'Lina', phone: '٠٩٣٣٠٠٠٠٠٠' } }));
check('og-bridge folds Arabic digits; the SQL counts only ASCII ones', ctl.code === 'bad_phone', JSON.stringify(ctl));
const noteT = await submit('sara', op(), good({ customer: { name: 'Lina', phone: '0933 000 001' }, note: 'a\r\n\n\n\nb\u0007c' }));
check('a note is tidied: \\r dropped, blank lines collapsed, controls dropped',
  (await one('SELECT payload->>\'note\' AS n FROM inbox.requests WHERE ref = $1', [noteT.ref])).n === 'a\n\nbc');

/* ---- the caps ----------------------------------------------------------- */
for (let i = 0; i < 5; i++) await submit('sara', op(), good({ customer: { name: 'Same phone', phone: '0999 111 222' } }));
const sixth = await submit('sara', op(), good({ customer: { name: 'Same phone', phone: '0999 111 222' } }));
check('a sixth undecided request for one phone is refused too_many_phone', sixth.code === 'too_many_phone', JSON.stringify(sixth));
for (let i = 0; i < 30; i++) await submit('busy', op(), good({ customer: { name: 'Customer ' + i, phone: '0911 000 ' + String(100 + i) } }));
const thirty1 = await submit('busy', op(), good({ customer: { name: 'One more', phone: '0911 999 999' } }));
check('a 31st request from one night user in an hour is refused too_many_user', thirty1.code === 'too_many_user', JSON.stringify(thirty1));
await db.query(`INSERT INTO inbox.requests (ref, source, op, payload, phone_digits, by_user)
                SELECT 'W-' || g, 'web', 'fill-' || lpad(g::text, 12, '0'), '{"v":1}', '0000000', null
                  FROM generate_series(1, 1000) g`);
const full = await submit('sara', op(), good({ customer: { name: 'Late', phone: '0922 000 000' } }));
check('with 1,000 undecided in all, a new one is refused full', full.code === 'full', JSON.stringify(full));
await db.query(`DELETE FROM inbox.requests WHERE ref LIKE 'W-%'`);

/* ---- og_vps is still SELECT-only, and cannot reach the table ------------ */
const writes = await one(`
  SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema')
     AND has_table_privilege('og_vps', c.oid, p.priv)`);
check('og_vps holds no INSERT, UPDATE, DELETE or TRUNCATE on any relation', writes.n === 0, 'n=' + writes.n);
const sel = await one(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege('og_vps', c.oid, 'SELECT')`);
check('og_vps still reads the mirror tables (SELECT granted by 030)', sel.n > 40, 'n=' + sel.n);
check('og_vps cannot SELECT inbox.requests', await asRole(db, 'og_vps', () => refused(() => db.query('SELECT * FROM inbox.requests'))));
check('og_vps cannot INSERT into inbox.requests, even READ WRITE', await asRole(db, 'og_vps', async () => {
  await db.exec('BEGIN READ WRITE');
  return refused(() => db.query(`INSERT INTO inbox.requests (ref, source, op, payload, phone_digits) VALUES ('X-1','night','o','{}','1')`));
}));
check('og_vps cannot write a shop table, even READ WRITE', await asRole(db, 'og_vps', async () => {
  await db.exec('BEGIN READ WRITE');
  return refused(() => db.query(`UPDATE public.stock SET qty = 99 WHERE sku = 'OG-050-42'`));
}));
check('og_vps cannot call requests_take', await asRole(db, 'og_vps', () => refused(() => db.query('SELECT public.requests_take($1, 10)', [LIN]))));
check('og_vps cannot call requests_mark', await asRole(db, 'og_vps', async () => {
  await db.exec('BEGIN READ WRITE');
  return refused(() => db.query('SELECT public.requests_mark($1, $2::jsonb)', [LIN, '[]']));
}));
check('og_vps cannot call the private helpers', await asRole(db, 'og_vps', () => refused(() => db.query("SELECT inbox.req_owner('x')"))));
for (const role of ['anon', 'authenticated', 'service_role']) {
  check(`${role} cannot submit`, await asRole(db, role, async () => {
    await db.exec('BEGIN READ WRITE');
    return refused(() => db.query('SELECT erp.request_submit($1, $2, $3::jsonb)', ['sara', op(), JSON.stringify(good())]));
  }, { readOnly: false }));
  check(`${role} cannot list`, await asRole(db, role, () => refused(() => db.query('SELECT erp.requests_list(NULL, 10)')), { readOnly: false }));
}
for (const role of ['anon', 'authenticated']) {
  check(`${role} cannot take`, await asRole(db, role, () => refused(() => db.query('SELECT public.requests_take($1, 10)', [LIN])), { readOnly: false }));
  check(`${role} cannot mark`, await asRole(db, role, () => refused(() => db.query('SELECT public.requests_mark($1, $2::jsonb)', [LIN, '[]'])), { readOnly: false }));
}

/* ---- the list ----------------------------------------------------------- */
const mine = await asRole(db, 'og_vps', () => one('SELECT erp.requests_list($1, 100) AS r', ['sara']));
const all = await asRole(db, 'og_vps', () => one('SELECT erp.requests_list(NULL, 100) AS r'));
check('requests_list works inside the read-only default', mine.r.ok === true && Array.isArray(mine.r.items));
check('a user\'s list holds only their own', mine.r.items.length > 0 && mine.r.items.every((x) => x.byUser === 'sara'));
check('NULL lists everybody\'s', all.r.items.some((x) => x.byUser === 'busy') && all.r.items.some((x) => x.byUser === 'sara'));
const total = (await one('SELECT count(*)::int AS n FROM inbox.requests')).n;
check('the list is newest first, every request', all.r.items.length === Math.min(total, 100) && all.r.items[0].ref > all.r.items[1].ref, total);
const capped = await asRole(db, 'og_vps', () => one('SELECT erp.requests_list(NULL, 5) AS r'));
check('the list takes a limit', capped.r.items.length === 5);

/* ---- the laptop: take, mark, the lineage, finality ---------------------- */
const wrong = await svc('SELECT public.requests_take($1, 10) AS r', ['another-laptop']);
check('take refuses a lineage that does not own the mirror', wrong.r.code === 'not_owner');
const t1 = await svc('SELECT public.requests_take($1, 50) AS r', [LIN]);
check('take returns waiting requests, oldest first, at most 50', t1.r.ok && t1.r.items[0].ref === r1.ref && t1.r.items.length === Math.min(total, 50), t1.r.items.length);
const t1s = await svc('SELECT public.requests_take($1, 3) AS r', [LIN]);
check('take takes a limit', t1s.r.items.length === 3);
check('take carries the payload and who asked', t1.r.items[0].payload.items.length === 2 && t1.r.items[0].byUser === 'sara');
const m1 = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'received', revision: 1 }])]);
check('mark received', m1.r.ok && m1.r.items[0].state === 'received');
const t2 = await svc('SELECT public.requests_take($1, 50) AS r', [LIN]);
check('a request taken at its revision is not taken again by the same laptop', !t2.r.items.some((x) => x.ref === r1.ref));
await db.query(`UPDATE sync_state SET note = 'lin-new-laptop OTHER' WHERE id = 'lineage'`);
const t3 = await svc('SELECT public.requests_take($1, 50) AS r', ['lin-new-laptop']);
check('after the shop moves laptops, an undecided request is taken again by the new owner', t3.r.items.some((x) => x.ref === r1.ref));
const old = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'rejected', code: 'other' }])]);
check('the old laptop can no longer mark (not_owner)', old.r.code === 'not_owner');
await db.query(`UPDATE sync_state SET note = '${LIN} NIGHT-TEST' WHERE id = 'lineage'`);

const acc = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'accepted', saleId: 'INV-2105' }])]);
check('mark accepted with the invoice', acc.r.items[0].state === 'accepted' && acc.r.items[0].saleId === 'INV-2105', JSON.stringify(acc.r));
const flip = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'rejected', code: 'out_of_stock' }])]);
check('an accepted request cannot become rejected (answers accepted)', flip.r.marked === 0 && flip.r.items[0].state === 'accepted');
const other = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'accepted', saleId: 'INV-9999' }])]);
check('an accepted request never changes its invoice', other.r.items[0].saleId === 'INV-2105');
const back = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: r1.ref, state: 'received', revision: 1 }])]);
check('received never undoes a decision', back.r.items[0].state === 'accepted');
const t4 = await svc('SELECT public.requests_take($1, 50) AS r', [LIN]);
check('a decided request is never taken again', !t4.r.items.some((x) => x.ref === r1.ref));

const rj = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: pick.ref, state: 'rejected', code: 'Out Of Stock!', note: 'none\r\nleft' }])]);
check('a malformed reason code becomes other; the note is tidied', rj.r.items[0].state === 'rejected' && rj.r.items[0].code === 'other', JSON.stringify(rj.r));
const rj2 = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: pick.ref, state: 'accepted', saleId: 'INV-1' }])]);
check('a rejected request cannot become accepted', rj2.r.items[0].state === 'rejected');
const listed = (await asRole(db, 'og_vps', () => one('SELECT erp.requests_list($1, 100) AS r', ['sara']))).r.items;
const la = listed.find((x) => x.ref === r1.ref), lr = listed.find((x) => x.ref === pick.ref);
check('the night list shows accepted with the invoice', la && la.state === 'accepted' && la.saleId === 'INV-2105');
check('the night list shows rejected with the reason', lr && lr.state === 'rejected' && lr.code === 'other' && lr.note === 'none\nleft', JSON.stringify(lr));
const unknownRef = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify([{ ref: 'N-9999999', state: 'rejected' }])]);
check('an unknown ref is answered with no state, not an error', unknownRef.r.ok && unknownRef.r.items[0].state === null);
const tooMany = await svc('SELECT public.requests_mark($1, $2::jsonb) AS r', [LIN, JSON.stringify(Array.from({ length: 51 }, () => ({})))]);
check('more than 50 items in one mark is refused', tooMany.r.code === 'bad_items');

/* ---- the guard fails the file when og_vps has been given a write -------- */
await db.exec('GRANT INSERT ON public.customers TO og_vps');
let guard = null;
try { await db.exec(readFileSync(join(SUPA, '035_night_requests.sql'), 'utf8')); } catch (e) { guard = e.message; }
check('035\'s guard refuses to finish when og_vps can write', guard && /og_vps can write/.test(guard), String(guard));
await db.exec('REVOKE INSERT ON public.customers FROM og_vps');
await db.exec(readFileSync(join(SUPA, '035_night_requests.sql'), 'utf8'));
check('…and finishes again once the write is taken away', true);

done('night-mode sql');
