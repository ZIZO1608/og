/* The cloud copy, as og_vps — a role that can only READ (server/supabase/030
   and 031). `pg` is og-bridge's one dependency and is imported lazily, so the
   pure modules and their tests never need it installed. */
import { readFileSync } from 'node:fs';
import { QUERIES, bind } from './snapshot-queries.js';

export function makeMirror({ url, caFile, tlsInsecure }) {
  let pool = null;
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
    async close() { if (pool) await pool.end(); pool = null; }
  };
}
