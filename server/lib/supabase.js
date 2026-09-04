/* ==========================================================================
   OG SYSTEM — Supabase client
   --------------------------------------------------------------------------
   Talks to Supabase over its REST API (PostgREST) using nothing but `fetch`,
   which Node has had built in since 18. No @supabase/supabase-js, no npm
   install, so the server keeps its "copy the folder and run node" property.

   WHERE THIS SITS
   ---------------
   The browser never talks to Supabase. It talks to this server, exactly as
   it does today, and this server talks to Supabase. That is not an
   arbitrary preference:

     - `requirePerm()` in index.js is the real security boundary. Point the
       browser at Supabase directly and the only thing left guarding the data
       is Postgres RLS — every one of the 28 permissions would have to be
       rewritten as a policy, correctly, before a single sale is safe.
     - Prices are read from the product table, never from the client. A till
       that can name its own price can sell a 450,000 pair for 1,000 and
       leave an ordinary-looking receipt behind.
     - The service_role key below bypasses RLS completely. It must never
       reach a browser, so it can only live on a server.

   THE KEY
   -------
   SUPABASE_SERVICE_ROLE_KEY is a master key for the whole database. It is
   read from server/.env, which is already in server/.gitignore — and this
   repository is public, so that matters more than usual.
   ========================================================================== */

import { load, maybe, need } from './env.js';

let base = null;
let key = null;
let keyKind = null;

/* Resolved on first use rather than at import, so simply importing this file
   cannot crash a server that is running happily on SQLite with no Supabase
   configured at all. */
function config() {
  if (base) return { base, key };
  load();

  base = need('SUPABASE_URL').replace(/\/+$/, '');

  /* Supabase issued `service_role` JWTs historically and `sb_secret_…` keys
     more recently. Both are sent the same way, so accept either and let the
     user paste whichever their dashboard shows. */
  key = maybe('SUPABASE_SERVICE_ROLE_KEY') || maybe('SUPABASE_SECRET_KEY');
  keyKind = 'service_role';

  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Supabase dashboard → Project Settings → ' +
      'API Keys → the secret / service_role key. Put it in server/.env.'
    );
  }
  return { base, key };
}

export function isConfigured() {
  load();
  return !!(maybe('SUPABASE_URL') &&
           (maybe('SUPABASE_SERVICE_ROLE_KEY') || maybe('SUPABASE_SECRET_KEY')));
}

export function projectUrl() { load(); return maybe('SUPABASE_URL'); }
export function keyType() { config(); return keyKind; }

function headers(extra = {}) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

/* One place where every Supabase response is turned into either data or a
   thrown Error carrying what PostgREST actually said. The default fetch
   failure message ("fetch failed") names neither the table nor the reason,
   which turns a five-second fix into a twenty-minute hunt. */
/* EVERY REQUEST HAS A DEADLINE. A connection that is accepted and then goes
   quiet — a proxy that drops the shop's line, a phone hotspot that fades —
   would otherwise hold a run open for ever, and the sync worker's "never
   overlap yourself" rule then means the mirror never moves again with no
   line in any log. Thirty seconds is generous for a batch of five hundred
   rows and short enough that the next push is minutes away, not never. */
const TIMEOUT_MS = 30 * 1000;

async function call(path, opts = {}) {
  const { base } = config();
  const url = `${base}/rest/v1/${path}`;

  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: headers(opts.headers),
      signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS)
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(`Cannot reach Supabase at ${base} — ` +
                    (timedOut ? `no answer within ${Math.round((opts.timeoutMs || TIMEOUT_MS) / 1000)} s`
                              : (err.cause && err.cause.message) || err.message));
  }

  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }

  if (!res.ok) {
    const detail = body && typeof body === 'object'
      ? [body.message, body.details, body.hint].filter(Boolean).join(' · ')
      : String(body || '').slice(0, 300);
    throw new Error(`Supabase ${res.status} on ${path} — ${detail || res.statusText}`);
  }

  return { body, res };
}

/* ------------------------------------------------------------------- reads */

/* select('products', { select: 'id,name', eq: { type: 'sneakers' }, limit: 20 })

   `filters` takes PostgREST operators straight through, so anything the API
   supports is reachable without this wrapper growing to cover it. */
export async function select(table, opts = {}) {
  const q = new URLSearchParams();
  q.set('select', opts.select || '*');

  for (const [col, val] of Object.entries(opts.eq || {})) q.set(col, `eq.${val}`);
  for (const [col, val] of Object.entries(opts.filters || {})) q.set(col, val);

  if (opts.order) q.set('order', opts.order);
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));

  const { body } = await call(`${table}?${q}`, { method: 'GET' });
  return body || [];
}

/* ------------------------------------------------------------ the schema

   Which columns PostgREST will actually ACCEPT, per table — read from the
   OpenAPI document it serves at the API root.

   Read from there rather than by fetching a row, because an empty table hands
   back no columns at all and would look identical to a table missing every
   one of them. A mirror is frequently empty in exactly the tables that were
   added most recently, which are the tables this question is asked about.

   Cached for the life of the process: it is one request, and every caller
   walks thirty-odd tables against it.

   Returns a Map of table -> column names. A table the API does not expose is
   absent from the map, which is how a caller tells "no such table" apart from
   "a table with no columns". */
let schemaCache = null;
export async function columns() {
  if (schemaCache) return schemaCache;

  const { body } = await call('', { method: 'GET' });
  /* PostgREST 11 emits Swagger 2 (`definitions`); newer builds emit OpenAPI 3
     (`components.schemas`). Read whichever is there rather than pinning a
     version of a thing the project upgrades without telling us. */
  const defs = (body && body.definitions) ||
               (body && body.components && body.components.schemas) || {};

  schemaCache = new Map();
  for (const [table, def] of Object.entries(defs)) {
    if (def && def.properties) schemaCache.set(table, Object.keys(def.properties));
  }
  return schemaCache;
}

/* Row count without dragging the rows across the wire. */
export async function count(table) {
  const { res } = await call(`${table}?select=*`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' }
  });
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total === '*' || total == null ? null : Number(total);
}

/* ------------------------------------------------------------------ writes */

/* return=minimal by default: the mirror never reads a pushed row back, and
   with representation every upsert dragged the whole batch down the wire
   again — 155 permission rows returned for nothing, on every run. Pass
   { returning: true } to get the rows. */
export async function insert(table, rows, opts = {}) {
  const prefer = [opts.returning ? 'return=representation' : 'return=minimal'];
  if (opts.upsert) prefer.push('resolution=merge-duplicates');

  const { body } = await call(table, {
    method: 'POST',
    headers: { Prefer: prefer.join(',') },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
  });
  return body || [];
}

export async function update(table, match, patch) {
  const q = new URLSearchParams();
  for (const [col, val] of Object.entries(match)) q.set(col, `eq.${val}`);

  const { body } = await call(`${table}?${q}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  return body || [];
}

/* Named `remove` because `delete` is a reserved word and `del` reads like a
   typo six months from now. A match is required: PostgREST happily deletes
   every row in a table when given no filter. */
export async function remove(table, match) {
  if (!match || !Object.keys(match).length) {
    throw new Error(`remove(${table}) needs a filter — refusing to delete every row.`);
  }
  const q = new URLSearchParams();
  for (const [col, val] of Object.entries(match)) q.set(col, `eq.${val}`);

  const { body } = await call(`${table}?${q}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  return body || [];
}

/* ---------------------------------------------------------------- functions

   A Postgres function runs its whole body in one transaction. That is the
   only way to get an atomic multi-table write through PostgREST — six
   separate HTTP calls are six separate transactions, and a sale that writes
   stock but loses the invoice is exactly the failure this project's schema
   was designed to make impossible. */
export async function rpc(fn, args = {}) {
  const { body } = await call(`rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args)
  });
  return body;
}

/* -------------------------------------------------------------- connection */

/* Does the project answer, and does the key work? Used by the check script
   and safe to call on startup. Returns a report rather than throwing, so a
   caller can decide whether a missing Supabase is fatal. */
export async function ping() {
  if (!isConfigured()) {
    return { ok: false, reason: 'not_configured', message: 'SUPABASE_URL / key not set in server/.env' };
  }
  try {
    const { base } = config();
    const res = await fetch(`${base}/rest/v1/`, { headers: headers() });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'bad_key', message: `Key rejected (HTTP ${res.status}).` };
    }
    if (!res.ok) {
      return { ok: false, reason: 'http', message: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, url: base };
  } catch (err) {
    /* Node reports every network failure as the bare string "fetch failed"
       and hides the real reason — ENOTFOUND, ECONNREFUSED, a TLS error — on
       `cause`. Unwrapping it here is the difference between "check your
       internet" and "that project name does not resolve". */
    const why = err.cause?.code || err.cause?.message || err.message;
    return { ok: false, reason: 'unreachable', message: `Cannot reach ${base} — ${why}` };
  }
}
