/* ==========================================================================
   OG SYSTEM — whose mirror is this?                             [lineage.js]
   --------------------------------------------------------------------------
   One Supabase project can only ever be the copy of ONE database. Two
   machines pointed at the same project do not share it — they fight over
   it. Each run writes its own change_log seqs into every sync_state cursor,
   so the other machine's next run finds a bookmark from a book it never read:
   above its own log it rewinds and replays every delete it has ever made,
   below it, rows sit forever where no rewind will look. Ids collide across
   the two (INV-2106 is the next invoice on both tills), so one machine's
   purge of a demo invoice deletes the other machine's real one.

   That happened twice: 2026-08-30 and again 2026-09-03, when the shop's
   real install and the development copy on another machine ran the same
   .env against the same project. The mirror lost every sale, every
   delivery, and carried the two staff lists side by side.

   ONE SHOP LAPTOP (audit 06). The shop used to move between laptops: a boot
   pull replaced the local database from the mirror, a heartbeat said who was
   working, and "Claim the mirror" took the mirror off the other machine.
   All of that is gone. What is left is one rule:

   THE OWNER GUARD. The mirror records which database owns it — a random id
   in sync_state row `lineage`, with the machine's hostname and the date —
   and the owner keeps the same id in its own config table. Every push (the
   live worker before EVERY run, the sync CLI, the reconcile, users:mirror)
   compares the two first and REFUSES when they differ:

       This computer isn't the shop. It can't send to the cloud copy.

   There is no takeover switch. OG_SYNC_TAKEOVER and --takeover are gone, and
   so is the panel's Claim the mirror. THE ONLY WAY THE OWNER CHANGES is the
   disaster restore (lib/restore.js → `npm run supabase:restore -- --wipe`,
   the panel's "Restore the shop from the cloud"): it rebuilds the whole shop
   on a clean machine, then forget()s the id the restored config carried,
   mints a NEW one and claims the mirror with it. A new id on purpose — the
   dead laptop's database still holds the old one, and two databases under
   one id are two databases this guard cannot tell apart. If that laptop ever
   comes back, it is the one refused.

   A NEVER-SYNCED project is claimed on the spot: a brand-new shop must not
   be made to run a second command to start mirroring. A project WITH history
   and NO owner row (a mirror older than this guard) is claimed only by
   `npm run supabase:sync -- --claim-unclaimed`: there is no owner there to
   take anything from, so that is a first claim, not a change of owner — and
   "whichever machine ticks first" must still never decide it.

   The id lives in `config` under sync.lineage. og-track's inbox RPCs compare
   it too (lib/inbox.js), so only the owner collects what customers left on
   the public page.
   ========================================================================== */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import * as DB from './db.js';
import * as SB from './supabase.js';

const KEY = 'sync.lineage';   /* local config row */
const ROW = 'lineage';        /* sync_state row in the mirror */

/* This database's id. Created on first use — a write, so a read-only caller
   (the check) passes create:false and may get null: "never synced under a
   lineage" is a true answer for it. */
export function localId({ create = true } = {}) {
  const d = DB.get();
  const row = d.prepare('SELECT value FROM config WHERE key = ?').get(KEY);
  if (row) return row.value;
  if (!create) return null;
  const id = randomUUID();
  d.prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)')
   .run(KEY, id, new Date().toISOString());
  return id;
}

export async function remote() {
  const [r] = await SB.select('sync_state', { eq: { id: ROW } });
  if (!r || !r.note) return null;
  const [id, ...rest] = String(r.note).split(' ');
  return { id, host: rest.join(' ') || '(unknown machine)', since: r.last_push_at };
}

export async function claim(id) {
  const note = `${id} ${hostname()}`;
  const at = new Date().toISOString();
  const [r] = await SB.select('sync_state', { eq: { id: ROW } });
  if (r) await SB.update('sync_state', { id: ROW }, { note, last_push_at: at });
  else await SB.insert('sync_state', { id: ROW, last_seq: 0, note, last_push_at: at });
}

/* Has anything ever synced into this project? The `shop` heartbeat is written
   at the end of every completed run since the first version of the sync. */
async function everSynced() {
  const [r] = await SB.select('sync_state', { eq: { id: 'shop' } });
  return !!(r && r.last_push_at);
}

/* When did the mirror last hear from the database that owns it? The newest
   last_push_at on any bookmark: a cursor moves on every push that landed, and
   the `shop` row at the end of every full run (hourly while the shop is
   open). Read ONLY by the disaster restore, to refuse taking the mirror off a
   shop that is plainly still working (lib/restore.js, `owner_active`). */
export async function ownerSeen() {
  const rows = await SB.select('sync_state', { limit: 1000 });
  let newest = null;
  for (const r of rows) {
    if (r.id === ROW || !r.last_push_at) continue;
    if (!newest || String(r.last_push_at) > newest) newest = String(r.last_push_at);
  }
  return newest;
}

/* An owner that pushed this recently is open for business. A full run lands
   every OG_SYNC_MINUTES (60) on an idle shop, so ninety minutes is one missed
   run of slack; a laptop that died at noon is past it by two. */
export const OWNER_ACTIVE_MS = 90 * 60 * 1000;

/* Drop this database's id so the next localId() mints a fresh one. ONLY the
   disaster restore calls this, after rebuilding the shop — see the header. */
export function forget() {
  DB.get().prepare('DELETE FROM config WHERE key = ?').run(KEY);
}

/* { ok: true, mine, claimed? }
   { ok: false, mine, other }              — another database owns it
   { ok: false, mine, unclaimed: true }    — history, but no owner row at all
   readOnly: never writes anywhere (the check, users:mirror's dry run).

   claimUnclaimed: claim a mirror that HAS history and NO owner row. It can
   never move an existing owner — that branch does not look at it. */
export async function guard({ claimUnclaimed = false, readOnly = false } = {}) {
  const mine = localId({ create: !readOnly });
  const other = await remote();
  if (!other) {
    if (readOnly) return { ok: true, mine, unclaimed: true };
    if (claimUnclaimed || !(await everSynced())) { await claim(mine); return { ok: true, mine, claimed: true }; }
    return { ok: false, mine, unclaimed: true };
  }
  if (mine && other.id === mine) return { ok: true, mine };
  return { ok: false, mine, other };
}

export function claimUnclaimedRequested() {
  return process.argv.includes('--claim-unclaimed');
}

/* The one sentence, for every place that has to say it (the worker's status,
   the CLI, the panel, the Settings fold). Both languages live in the two i18n
   tables; this is the log's copy. */
export const NOT_THE_SHOP = "This computer isn't the shop. It can't send to the cloud copy.";

/* The refusal, as lines. The first begins with '!' so lib/sync-worker.js
   picks it as the reason for the log, the Sync button and the bell. */
export function refusal(other) {
  const first = other
    ? `! ${NOT_THE_SHOP} The cloud copy belongs to ${other.host}, since ` +
      `${other.since ? String(other.since).slice(0, 16).replace('T', ' ') : '?'} UTC. Nothing was pushed.`
    : '! This cloud copy has been written to before and no computer owns it yet. Nothing was pushed.';
  return other ? [
    first,
    `    Two machines on one Supabase project overwrite each other's bookmarks and delete each`,
    `    other's rows — that is the 2026-08-30 and 2026-09-03 incidents. One database owns it.`,
    `    A development copy:  set OG_SYNC_MINUTES=0, or point it at its own test project.`,
    `    The shop's laptop is gone for good:  npm run supabase:restore -- --wipe   on the NEW laptop`,
    `    (the panel's "Restore the shop from the cloud"). That is the only way the owner changes.`
  ] : [
    first,
    `    If THIS machine is the shop and holds the data:  npm run supabase:sync -- --claim-unclaimed`,
    `    (once), then npm run supabase:reconcile.`
  ];
}
