/* ==========================================================================
   Night mode's test harness — shared pieces.              [tools/night-mode]
   --------------------------------------------------------------------------
   A real Postgres (PGlite, Postgres in WebAssembly) holding the mirror's
   schema as the live project has it: 001 → 031, 033 and 035, in order, with
   Supabase's three roles. Nothing here talks to Supabase, the VPS or the shop.

   PGlite is NOT a dependency of this repository and is never installed by
   these scripts: point OG_PGLITE at an unpacked @electric-sql/pglite folder
   (a copy from an earlier night shift's scratch is enough), or run them from
   somewhere a normal import can resolve it.
   ========================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const SUPA = join(REPO, 'server', 'supabase');

let passed = 0, failed = 0;
export function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
  return !!ok;
}
export function done(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  return { passed, failed };
}

export async function loadPGlite() {
  const dir = process.env.OG_PGLITE;
  try {
    if (dir) return (await import(pathToFileURL(join(dir, 'dist', 'index.js')).href)).PGlite;
    return (await import('@electric-sql/pglite')).PGlite;
  } catch (e) {
    console.error('PGlite not found. Set OG_PGLITE to an unpacked @electric-sql/pglite folder.\n  ' + e.message);
    process.exit(2);
  }
}

/* The mirror's files in the order the live project received them. 032 is a
   read-only look at eight old accounts (and a commented-out delete) — not a
   schema step — and CATCH-UP.sql is 008–023 again, concatenated. */
export function mirrorFiles({ upTo = '035' } = {}) {
  return readdirSync(SUPA)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('032_') && f.slice(0, 3) <= upTo)
    .sort();
}

/* A fresh mirror: the three Supabase roles, every file once, then 030, 031
   and 035 AGAIN — each says it is safe to run twice, and this holds it to it. */
export async function mirrorDb({ log = () => {}, again = true } = {}) {
  const PGlite = await loadPGlite();
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;`);
  for (const f of mirrorFiles()) {
    try { await db.exec(readFileSync(join(SUPA, f), 'utf8')); log('applied ' + f); }
    catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  if (again) {
    for (const f of ['030_erp_access.sql', '031_till_status.sql', '035_night_requests.sql']) {
      await db.exec(readFileSync(join(SUPA, f), 'utf8'));
    }
  }
  return db;
}

/* A small shop in the mirror: two places, three products (one with two
   colours, one archived), stock, two customers, an order and a till sale. */
export async function seedMirror(db, { lineage = 'lin-night-0001' } = {}) {
  await db.exec(`
    INSERT INTO currencies (code, symbol, symbol_ar, minor_exp) VALUES ('SYP','SYP','ل.س',0), ('USD','$','$',2) ON CONFLICT DO NOTHING;
    INSERT INTO warehouses (id, name, name_ar, kind, sort) VALUES ('floor','Shop floor','الصالة','shop',0), ('store','Back storage','المستودع','storage',1) ON CONFLICT DO NOTHING;
    INSERT INTO users (id, username, name, role, created_at, updated_at) VALUES (7, 'abode', 'Abode', 'owner', now(), now()) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, name, type, brand, currency, cost_price, selling_price, hidden, demo, created_at, updated_at) VALUES
      (50, 'Samba OG', 'sneakers', 'Adidas', 'SYP', 300000, 450000, false, false, now(), now()),
      (51, 'Air Force 1', 'sneakers', 'Nike', 'SYP', 350000, 520000, false, false, now(), now()),
      (52, 'Old runner', 'sneakers', 'Nike', 'SYP', 1, 2, true, false, now(), now());
    INSERT INTO product_colours (id, product_id, name_en, name_ar, hex, sort, created_at, updated_at) VALUES
      (500, 50, 'Standard', 'أساسي', null, 0, now(), now()),
      (510, 51, 'White', 'أبيض', '#ffffff', 0, now(), now()),
      (511, 51, 'Black', 'أسود', '#000000', 1, now(), now());
    INSERT INTO variants (sku, product_id, size, colour_id, created_at, updated_at) VALUES
      ('OG-050-42', 50, '42', 500, now(), now()), ('OG-050-43', 50, '43', 500, now(), now()),
      ('OG-051-42', 51, '42', 510, now(), now()), ('OG-051-C2-42', 51, '42', 511, now(), now()),
      ('OG-052-40', 52, '40', null, now(), now());
    INSERT INTO stock (sku, wh_id, qty) VALUES ('OG-050-42','floor',2), ('OG-050-42','store',3), ('OG-050-43','store',0),
      ('OG-051-42','floor',1), ('OG-051-C2-42','store',4);
    INSERT INTO customers (id, name, phone, city, address, archived, demo, created_at, updated_at) VALUES
      (81, 'Nour Haddad', '0933 123 456', 'Aleppo', 'New Aleppo', false, false, now(), now()),
      (82, 'Rami Khoury', '+963 944 555 666', 'Aleppo', null, false, false, now(), now());
    INSERT INTO sync_state (id, note, last_push_at) VALUES ('lineage', '${lineage} NIGHT-TEST', now() - interval '3 days'),
                                                            ('shop', 'alive: nothing waiting', now() - interval '12 minutes')
      ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note, last_push_at = EXCLUDED.last_push_at;
  `);
}

/* Run fn as og_vps the way a pooled session is: SET ROLE does not apply the
   role's own settings, so the read-only default 030 gives it is set here by
   hand — that default is exactly what night mode has to respect. */
export async function asRole(db, role, fn, { readOnly = role === 'og_vps' } = {}) {
  await db.exec(`SET ROLE ${role}`);
  if (readOnly) await db.exec('SET default_transaction_read_only = on');
  try { return await fn(); }
  finally {
    try { await db.exec('ROLLBACK'); } catch { /* not in a transaction */ }
    await db.exec('RESET default_transaction_read_only; RESET ROLE');
  }
}

/* A pg-Pool-shaped object over PGlite, running every statement as og_vps with
   the read-only default — what og-bridge's mirror.js holds in production. */
export function ogVpsPool(db) {
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const run = (text, params) => db.query(text, params || []);
  const enter = async () => { await db.exec('SET ROLE og_vps; SET default_transaction_read_only = on'); };
  const leave = async () => { try { await db.exec('ROLLBACK'); } catch { /* none open */ } await db.exec('RESET default_transaction_read_only; RESET ROLE'); };
  const log = [];
  return {
    log,
    query: (text, params) => serial(async () => {
      log.push(text);
      await enter();
      try { return await run(text, params); } finally { await leave(); }
    }),
    /* A client for a transaction: held for the whole of it, one at a time. */
    connect: () => new Promise((ok) => {
      serial(() => new Promise((release) => {
        enter().then(() => ok({
          query: (text, params) => { log.push(text); return run(text, params); },
          release: () => { leave().finally(release); }
        }));
      }));
    }),
    end: async () => {}
  };
}

/* Orders in the mirror, one in each state the night app draws: a sale with
   payment 'order' and its delivery row, its lines, and one cancelled. */
export async function seedOrders(db) {
  await db.exec(`
    INSERT INTO sales (id, at, customer_id, customer_name, cashier_id, wh_id, payment, currency, subtotal, total, fx_rate, fx_base, voided, created_at) VALUES
      ('INV-3001', now() - interval '5 hours', 81, 'Nour Haddad', 7, 'store', 'order', 'SYP', 450000, 450000, 130, 'USD', false, now()),
      ('INV-3002', now() - interval '4 hours', 82, 'Rami Khoury', 7, 'store', 'order', 'SYP', 520000, 520000, 130, 'USD', false, now()),
      ('INV-3003', now() - interval '3 hours', 81, 'Nour Haddad', 7, 'store', 'order', 'SYP', 900000, 900000, 130, 'USD', false, now()),
      ('INV-3004', now() - interval '2 hours', 82, 'Rami Khoury', 7, 'store', 'order', 'SYP', 450000, 450000, 130, 'USD', true, now()),
      ('INV-3005', now() - interval '1 hours', 82, 'Rami Khoury', 7, 'floor', 'cash', 'SYP', 450000, 450000, 130, 'USD', false, now());
    INSERT INTO sale_items (id, sale_id, sku, product_id, name, size, qty, unit_price, unit_cost, src_currency, src_unit_price) VALUES
      (9001, 'INV-3001', 'OG-050-42', 50, 'Samba OG', '42', 1, 450000, 300000, 'SYP', 450000),
      (9002, 'INV-3002', 'OG-051-42', 51, 'Air Force 1', '42', 1, 520000, 350000, 'SYP', 520000),
      (9003, 'INV-3003', 'OG-050-42', 50, 'Samba OG', '42', 2, 450000, 300000, 'SYP', 450000),
      (9004, 'INV-3004', 'OG-050-43', 50, 'Samba OG', '43', 1, 450000, 300000, 'SYP', 450000),
      (9005, 'INV-3005', 'OG-050-42', 50, 'Samba OG', '42', 1, 450000, 300000, 'SYP', 450000);
    INSERT INTO deliveries (id, sale_id, status, address, phone, currency, assigned_at, method, city) VALUES
      (701, 'INV-3001', 'waiting', 'New Aleppo', '0933 123 456', 'SYP', now(), 'driver', 'Aleppo'),
      (702, 'INV-3002', 'out', 'Al-Furqan', '+963 944 555 666', 'SYP', now(), 'driver', 'Aleppo'),
      (703, 'INV-3003', 'delivered', 'New Aleppo', '0933 123 456', 'SYP', now(), 'driver', 'Aleppo'),
      (704, 'INV-3004', 'waiting', '', '+963 944 555 666', 'SYP', now(), 'pickup', null);
  `);
}
