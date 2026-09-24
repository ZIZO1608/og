/* The cloud copy, as og_vps — a role that can only READ (server/supabase/030
   and 031). `pg` is og-bridge's one dependency and is imported lazily, so the
   pure modules and their tests never need it installed.

   NIGHT MODE (035) adds exactly one write: submit() — a request into
   inbox.requests through erp.request_submit, the only function og_vps may
   call that writes. og_vps sessions are READ-ONLY by default (030), so that
   one call is made inside `BEGIN READ WRITE`, on a client of its own, and
   NOTHING ELSE here ever opens one: every read keeps the role's default.
   `pool` may be handed in (a test's Postgres); otherwise pg makes one. */
import { readFileSync } from 'node:fs';
import { QUERIES, bind } from './snapshot-queries.js';

export function makeMirror({ url, caFile, tlsInsecure, pool: given = null }) {
  let pool = given;
  async function db() {
    if (pool) return pool;
    if (!url) throw new Error('OG_MIRROR_URL is not set');
    const { default: pg } = await import('pg');
    let ssl;
    if (caFile) ssl = { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
    else if (tlsInsecure) ssl = { rejectUnauthorized: false };
    else throw new Error('OG_MIRROR_CA is not set (Supabase dashboard → Database → SSL → download the certificate)');
    pool = new pg.Pool({ connectionString: url, ssl, max: 3, idleTimeoutMillis: 30000,
                         statement_timeout: 15000, application_name: 'og-bridge' });
    return pool;
  }

  return {
    /* erp.till_status(): whose mirror it is, and when it last heard. */
    async tillStatus() {
      try {
        const p = await db();
        const r = await p.query('SELECT lineage_id, beat_at FROM erp.till_status()');
        const row = r.rows[0] || {};
        return { ok: true, lineageId: row.lineage_id || null, beatAt: row.beat_at || null };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    /* Every row the snapshot's figures are made from — the same SQL the
       parity test runs on SQLite (snapshot-queries.js). */
    async rows(window) {
      const p = await db();
      const out = {};
      for (const [name, q] of Object.entries(QUERIES)) {
        const { sql, params } = bind(q, window, '$');
        out[name] = (await p.query(sql, params)).rows;
      }
      return out;
    },
    /* One read for night mode (night-queries.js), in the read-only default. */
    async query(sql, params = []) {
      const p = await db();
      return (await p.query(sql, params)).rows;
    },
    /* What became of a night user's requests (NULL: everybody's). */
    async requestsList(user, limit = 50) {
      const p = await db();
      const r = await p.query('SELECT erp.requests_list($1, $2) AS r', [user, limit]);
      return (r.rows[0] && r.rows[0].r) || { ok: false, code: 'bad_answer' };
    },
    /* THE ONE WRITE. A client of its own, READ WRITE for this transaction
       only, rolled back on anything but a clean answer. */
    async submit(user, op, request) {
      const p = await db();
      const client = await p.connect();
      try {
        await client.query('BEGIN READ WRITE');
        const r = await client.query('SELECT erp.request_submit($1, $2, $3::jsonb) AS r', [user, op, JSON.stringify(request)]);
        await client.query('COMMIT');
        return (r.rows[0] && r.rows[0].r) || { ok: false, code: 'bad_answer' };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* the connection is gone */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { if (pool && !given) await pool.end(); pool = given; }
  };
}
