/* ==========================================================================
   OG SYSTEM — whose mirror is this?
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

   THE GUARD. The first database to sync under this code writes a random id
   into the mirror (sync_state row `lineage`, with the machine's hostname and
   the date) and keeps the same id in its own config table. Every later run —
   sync and reconcile — compares the two first and REFUSES, saying whose the
   mirror is, when they differ. Refusing is the point: the alternative was a
   silent deletion ten minutes after the other machine's, forever.

   Deliberately claimable, never automatic: OG_SYNC_TAKEOVER=1 (or
   --takeover) rewrites the row so THIS machine owns the mirror from now on
   and the other one is the one refused. That is a decision about which
   machine is the shop, and it is made by a person, once.

   The id lives in `config`, so a restore onto a new machine carries it
   across and the rebuilt shop continues as the same lineage rather than
   being refused by its own mirror.
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

async function claim(id) {
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

/* { ok: true, mine, claimed?, tookOver? }
   { ok: false, mine, other }              — another database owns it
   { ok: false, mine, unclaimed: true }    — history, but nobody has claimed it
   readOnly: never writes anywhere (the check).

   A NEVER-SYNCED project is claimed on the spot: a brand-new shop must not be
   made to run a second command to start mirroring. A project WITH history and
   no claim is not: the code that adds this guard arrives on two machines at
   different times, and "whichever ticks first wins" would have handed the
   shop's mirror to the development copy — the exact fight this exists to
   end. So one person, once, says which machine is the shop. */
export async function guard({ takeover = false, readOnly = false } = {}) {
  const mine = localId({ create: !readOnly });
  const other = await remote();
  if (!other) {
    if (readOnly) return { ok: true, mine, unclaimed: true };
    if (takeover || !(await everSynced())) { await claim(mine); return { ok: true, mine, claimed: true }; }
    return { ok: false, mine, unclaimed: true };
  }
  if (mine && other.id === mine) return { ok: true, mine };
  if (takeover && !readOnly) {
    await claim(mine);
    return { ok: true, mine, tookOver: other };
  }
  return { ok: false, mine, other };
}

export function takeoverRequested() {
  return process.env.OG_SYNC_TAKEOVER === '1' || process.argv.includes('--takeover');
}

/* The refusal, as lines. The first begins with '!' so lib/sync-worker.js
   picks it as the reason for the log, the Sync button and the bell. */
export function refusal(other) {
  const first = other
    ? `! This mirror belongs to another database: ${other.host}, since ` +
      `${other.since ? String(other.since).slice(0, 16).replace('T', ' ') : '?'} UTC. Nothing was pushed.`
    : '! This mirror has been synced before and no database has claimed it yet. Nothing was pushed.';
  return [
    first,
    `    Two machines on one Supabase project overwrite each other's bookmarks and delete each`,
    `    other's rows — that is the 2026-08-30 and 2026-09-03 incidents. One database must own it.`,
    `    If THIS machine is the shop:   OG_SYNC_TAKEOVER=1 npm run supabase:sync   (once), then reconcile.`,
    `    If it is a test or dev copy:   set OG_SYNC_MINUTES=0 in server/.env, or give it its own project.`
  ];
}
