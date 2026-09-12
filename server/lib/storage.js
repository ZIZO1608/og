/* ==========================================================================
   OG SYSTEM — the picture bucket
   --------------------------------------------------------------------------
   Supabase Storage, spoken to with the same fetch and the same service key
   lib/supabase.js uses for the tables. Zero dependencies, like everything
   else here: the Storage API is three plain HTTP calls and does not need the
   SDK any more than PostgREST did.

   One bucket, `product-images`, PUBLIC. Public because the URL goes into an
   <img> on the till, on a phone on the shop wifi, and one day on the website
   — a signed URL expires, and a picture that stops loading on Tuesday reads
   as the shop being broken. The pictures are the shop's own photographs of
   shoes on a shelf; there is nothing in them the catalogue endpoint does not
   already publish.

   What is stored is the address, on products.image_url (migration 040). The
   bytes never touch og.db, so a restore onto a new laptop gets its pictures
   back the moment the row does.
   ========================================================================== */

import { projectUrl, authHeaders, isConfigured } from './supabase.js';

export const BUCKET = 'product-images';

/* A phone photograph is 3-6 MB; the browser already shrinks it to at most
   420 px before it is sent (readImageFile in js/app-util.js), so a picture
   here is tens of kilobytes. The cap is a backstop against a client that
   did not, not a budget. */
const MAX_BYTES = 2 * 1024 * 1024;

function base() { return String(projectUrl() || '').replace(/\/+$/, '') + '/storage/v1'; }

/* Made the first time it is needed, with the service key, and remembered
   for the life of the process. Asking on every upload is a round trip that
   answers the same thing every time; asking never means the first picture
   in a fresh project fails with a 404 nobody can act on. */
let bucketReady = false;

export async function ensureBucket() {
  if (bucketReady) return;
  const r = await fetch(`${base()}/bucket/${BUCKET}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  if (r.ok) { bucketReady = true; return; }
  if (r.status !== 404 && r.status !== 400) {
    throw new Error(`Storage answered ${r.status} looking for the ${BUCKET} bucket`);
  }
  const c = await fetch(`${base()}/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES,
                           allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
    signal: AbortSignal.timeout(15000)
  });
  if (!c.ok) {
    const t = await c.text().catch(() => '');
    /* Two servers racing to create it is not a failure. */
    if (!/already exists|Duplicate/i.test(t)) throw new Error(`Could not create the ${BUCKET} bucket — ${c.status} ${t.slice(0, 160)}`);
  }
  bucketReady = true;
}

/* Puts the bytes at `path` and returns the public address. Upsert, so a
   product's picture is replaced at the same path rather than piling up. */
export async function putObject(path, bytes, contentType) {
  if (!isConfigured()) { const e = new Error('Supabase is not set up on this server.'); e.code = 'not_configured'; throw e; }
  if (bytes.length > MAX_BYTES) { const e = new Error('That picture is too large.'); e.code = 'too_large'; throw e; }
  await ensureBucket();
  const r = await fetch(`${base()}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000' }),
    body: bytes,
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Upload refused — ${r.status} ${t.slice(0, 160)}`);
  }
  return publicUrl(path);
}

export async function removeObject(path) {
  if (!isConfigured() || !path) return false;
  const r = await fetch(`${base()}/object/${BUCKET}/${path}`, {
    method: 'DELETE', headers: authHeaders(), signal: AbortSignal.timeout(15000)
  });
  return r.ok;
}

export function publicUrl(path) { return `${base()}/object/public/${BUCKET}/${path}`; }

/* The inverse, for removing the old file when a picture is replaced. A URL
   that is not ours (somebody hand-edited the mirror) yields nothing, and
   nothing is deleted. */
export function pathOfUrl(url) {
  const i = String(url || '').indexOf(`/object/public/${BUCKET}/`);
  return i < 0 ? '' : String(url).slice(i + `/object/public/${BUCKET}/`.length);
}

/* The path a product's picture lives at. Versioned by time so a browser that
   cached the old picture for a year (see the Cache-Control above) shows the
   new one the moment the row's URL changes — the address changes, not the
   bytes behind an old one. */
/* A JOB'S DESIGN, in the same bucket under its own prefix rather than a second
   bucket. The bucket is public and holds the shop’s pictures; a print job’s
   artwork is one of them, and a second bucket would be a second thing to
   create, a second RLS decision and a second place to look. Same new-path-on-
   every-replace rule as a product, for the same CDN reason. */
export function pathForJob(jobId, ext) {
  return `jobs/${String(jobId).replace(/[^A-Za-z0-9_-]/g, '')}/${Date.now().toString(36)}.${ext}`;
}

export function pathFor(productId, ext) {
  return `products/${productId}/${Date.now().toString(36)}.${ext}`;
}

/* A data URL from the browser into bytes and a type. Only the three image
   types the bucket accepts; anything else is refused by name rather than
   stored as "octet-stream" that no <img> will draw. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) { const e = new Error('Not a picture this accepts (JPEG, PNG or WebP).'); e.code = 'bad_image'; throw e; }
  const type = m[1];
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  return { type, ext, bytes: Buffer.from(m[2], 'base64') };
}
