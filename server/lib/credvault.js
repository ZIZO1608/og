/* ==========================================================================
   OG SYSTEM — the credential vault
   --------------------------------------------------------------------------
   Sealed boxes for the one thing the Supabase mirror is otherwise not allowed
   to hold: what is needed to sign in.

   THE PROBLEM THIS SOLVES
   -----------------------
   supabase-sync.js deliberately never sends password material, which is the
   right default — but it means a shop machine that dies takes every account
   with it. The mirror can bring back products, sales and customers, and then
   nobody can log in to look at them.

   THE SHAPE OF THE ANSWER
   -----------------------
   The hash and salt are encrypted HERE, on the shop machine, with a
   passphrase that never leaves it. Supabase stores the ciphertext and cannot
   read it. Someone who obtains the service_role key — or a stray copy of
   server/.env, or a database dump — gets an opaque blob rather than a set of
   hashes to grind offline.

   What is sealed is still only a scrypt HASH, never a password: the vault is
   a second lock on something that was already one-way.

   AES-256-GCM, so a tampered box fails to open rather than decrypting to
   rubbish. The key is scrypt-derived from the passphrase with the same cost
   parameters the passwords themselves use — one derivation per run, reused
   across rows with a fresh IV each, which is safe and keeps a sync of a
   hundred staff from costing a hundred key derivations.

   Env:  OG_VAULT_KEY   the passphrase. No default and no fallback: with it
                        unset the vault is simply off and the mirror behaves
                        exactly as it did before this file existed.

   LOSING THE PASSPHRASE MEANS LOSING THE BOXES. That is the whole point —
   there is no recovery path, by design. Keep it where you keep the Supabase
   key, and not in this repository.
   ========================================================================== */

import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

import { maybe, load } from './env.js';

/* Matched to server/lib/auth.js's password parameters rather than picked
   fresh, so there is one cost decision in this codebase and not two. */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEYLEN = 32;                      /* AES-256 */
const VERSION = 1;

let runSalt = null;
let runKey = null;

function passphrase() {
  load();
  const p = maybe('OG_VAULT_KEY');
  return (p && String(p).trim()) || null;
}

export function isEnabled() { return passphrase() !== null; }

function keyFrom(pass, salt) {
  return scryptSync(pass, salt, KEYLEN, SCRYPT);
}

/* ------------------------------------------------------------------ sealing */

export function seal(obj) {
  const pass = passphrase();
  if (!pass) throw new Error('OG_VAULT_KEY is not set — nothing can be sealed.');

  /* One derivation per process. The salt travels inside every box, so a later
     run with a different salt still opens an older one. */
  if (!runSalt) { runSalt = randomBytes(16); runKey = keyFrom(pass, runSalt); }

  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', runKey, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);

  return JSON.stringify({
    v: VERSION,
    s: runSalt.toString('base64'),
    i: iv.toString('base64'),
    t: c.getAuthTag().toString('base64'),
    c: ct.toString('base64')
  });
}

export function unseal(text) {
  const pass = passphrase();
  if (!pass) throw new Error('OG_VAULT_KEY is not set — nothing can be opened.');

  let box;
  try { box = JSON.parse(text); }
  catch { throw new Error('That is not a sealed box.'); }
  if (box.v !== VERSION) throw new Error(`Sealed by a newer version (v${box.v}).`);

  const key = keyFrom(pass, Buffer.from(box.s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(box.i, 'base64'));
  d.setAuthTag(Buffer.from(box.t, 'base64'));

  let out;
  try {
    out = Buffer.concat([d.update(Buffer.from(box.c, 'base64')), d.final()]).toString('utf8');
  } catch {
    /* GCM refusing the tag is the ONLY signal that separates a wrong
       passphrase from a corrupted box, and it cannot tell them apart. Say
       both rather than guessing at one. */
    throw new Error('Could not open the box — wrong OG_VAULT_KEY, or the data was altered.');
  }
  return JSON.parse(out);
}

/* ------------------------------------------------- what a user's box holds

   Buffers do not survive JSON, so the two BLOB columns are base64 on the way
   in and Buffers again on the way out — the shape the rest of the server
   already expects from a SQLite row. */

export function sealUser(row) {
  return seal({
    pw_hash: Buffer.from(row.pw_hash).toString('base64'),
    pw_salt: Buffer.from(row.pw_salt).toString('base64'),
    pw_hint: row.pw_hint ?? null,
    must_change: row.must_change ? 1 : 0
  });
}

export function unsealUser(text) {
  const o = unseal(text);
  return {
    pw_hash: Buffer.from(o.pw_hash, 'base64'),
    pw_salt: Buffer.from(o.pw_salt, 'base64'),
    pw_hint: o.pw_hint ?? null,
    must_change: o.must_change ? 1 : 0
  };
}

/* Testing hook: forget the derived key so a changed passphrase takes effect
   without restarting the process. Not used in normal operation. */
export function _reset() { runSalt = null; runKey = null; }
