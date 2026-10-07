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
/* 071 — a SECOND bucket, `print-fonts`, for the print kits' faces (the
   original .ttf/.otf and the WOFF2 made from it). Public for the same reason
   as the pictures: the website loads the font straight from its URL. Kept
   apart because a bucket's allowed types are part of what stops an upload
   being served as something else — a font is not an image, and widening the
   picture bucket to take fonts would widen it for everything. */
export const FONT_BUCKET = 'print-fonts';
const BUCKETS = {
  [BUCKET]: { maxBytes: MAX_BYTES, mime: ['image/jpeg', 'image/png', 'image/webp'], big: 'That picture is too large.' },
  [FONT_BUCKET]: { maxBytes: 4 * 1024 * 1024, mime: ['font/woff2', 'font/ttf', 'font/otf'], big: 'That font file is too large.' }
};
const ready = new Set();

export async function ensureBucket(bucket = BUCKET) {
  if (ready.has(bucket)) return;
  const spec = BUCKETS[bucket];
  const r = await fetch(`${base()}/bucket/${bucket}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  if (r.ok) { ready.add(bucket); return; }
  if (r.status !== 404 && r.status !== 400) {
    throw new Error(`Storage answered ${r.status} looking for the ${bucket} bucket`);
  }
  const c = await fetch(`${base()}/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: spec.maxBytes,
                           allowed_mime_types: spec.mime }),
    signal: AbortSignal.timeout(15000)
  });
  if (!c.ok) {
    const t = await c.text().catch(() => '');
    /* Two servers racing to create it is not a failure. */
    if (!/already exists|Duplicate/i.test(t)) throw new Error(`Could not create the ${bucket} bucket — ${c.status} ${t.slice(0, 160)}`);
  }
  ready.add(bucket);
}

/* Puts the bytes at `path` and returns the public address. Upsert, so a
   product's picture is replaced at the same path rather than piling up. */
export async function putObject(path, bytes, contentType, bucket = BUCKET) {
  if (!isConfigured()) { const e = new Error('Supabase is not set up on this server.'); e.code = 'not_configured'; throw e; }
  if (bytes.length > BUCKETS[bucket].maxBytes) { const e = new Error(BUCKETS[bucket].big); e.code = 'too_large'; throw e; }
  await ensureBucket(bucket);
  const r = await fetch(`${base()}/object/${bucket}/${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000' }),
    body: bytes,
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Upload refused — ${r.status} ${t.slice(0, 160)}`);
  }
  return publicUrl(path, bucket);
}

export async function removeObject(path, bucket = BUCKET) {
  if (!isConfigured() || !path) return false;
  const r = await fetch(`${base()}/object/${bucket}/${path}`, {
    method: 'DELETE', headers: authHeaders(), signal: AbortSignal.timeout(15000)
  });
  return r.ok;
}

export function publicUrl(path, bucket = BUCKET) { return `${base()}/object/public/${bucket}/${path}`; }

/* The inverse, for removing the old file when a picture is replaced. A URL
   that is not ours (somebody hand-edited the mirror) yields nothing, and
   nothing is deleted. */
export function pathOfUrl(url, bucket = BUCKET) {
  const i = String(url || '').indexOf(`/object/public/${bucket}/`);
  return i < 0 ? '' : String(url).slice(i + `/object/public/${bucket}/`.length);
}

/* 071 — a font's two files. A new stamp on every upload, for the CDN reason
   above; the slug is only there so the bucket is readable by a person. */
export function pathForFont(stamp, ext, name = '') {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'font';
  return `fonts/${stamp}-${slug}.${ext}`;
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

/* 066 — one photo of a colour, as two files: `size` is 'l' (the website's)
   or 's' (the till's). Both share the stamp, so the pair is easy to find in
   the bucket, and the stamp is new on every upload for the CDN reason above. */
export function pathForPhoto(productId, colourId, stamp, size, ext) {
  return `products/${productId}/colours/${colourId}/photos/${stamp}-${size}.${ext}`;
}

/* A data URL from the browser into bytes and a type. Only the three image
   types the bucket accepts; anything else is refused by name rather than
   stored as "octet-stream" that no <img> will draw. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) { const e = new Error('Not a picture this accepts (JPEG, PNG or WebP).'); e.code = 'bad_image'; throw e; }
  const type = m[1];
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  const bytes = Buffer.from(m[2], 'base64');
  /* BY CONTENT, NOT BY NAME (audit 06). The type above is whatever the sender
     wrote in front of the comma; the bucket is public and serves the object
     under that type. So the first bytes have to be what that type really
     starts with — a page or a script sent as "image/png" is refused here
     rather than parked on a public URL with the shop's name on it. */
  const is = (sig, at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
  const real = type === 'image/jpeg' ? is([0xFF, 0xD8, 0xFF])
    : type === 'image/png' ? is([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    : is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8);
  if (!real) { const e = new Error('That file is not the kind of picture it says it is (JPEG, PNG or WebP).'); e.code = 'bad_image'; throw e; }
  return { type, ext, bytes };
}
