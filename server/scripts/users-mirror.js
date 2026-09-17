/* ==========================================================================
   Make the mirror's accounts match this database          [users-mirror.js]
   --------------------------------------------------------------------------
   npm run users:mirror                  dry run — prints the plan
   npm run users:mirror -- --apply       does it

   Night shift 01, E6, after `npm run users:rebuild`. The ordinary sync
   upserts users and never deletes one, so accounts removed here — and any
   that only another install ever wrote (Ahmad's laptop, which is no longer
   part of this system) — would live in Supabase for ever and come back on a
   restore. This:

     1. refuses unless THIS database holds the mirror (the sync's lineage
        check) — a second writer is the 2026-08-30 incident;
     2. upserts every local account, "Former staff" included, with its
        sealed box;
     3. for every account the mirror has and this database has not,
        re-points its references IN THE MIRROR — append-only tables too,
        which the sync will never send again — to the local account with the
        same username if there is one, or to "Former staff";
     4. then deletes those accounts there;
     5. checks that role_permissions and user_permissions match.

   Safe to run twice: the second run finds nothing to move.
   ========================================================================== */

import { argv, exit } from 'node:process';
import { dbFile, load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Lineage from '../lib/lineage.js';
import * as Vault from '../lib/credvault.js';
import * as People from '../lib/people.js';

load();
const APPLY = argv.includes('--apply');
const line = (s = '') => console.log('  ' + s);

async function main() {
  console.log('\n  OG SYSTEM — the mirror\'s accounts' + (APPLY ? '' : '  (DRY RUN — nothing changes; add --apply)'));
  DB.openReadOnly(dbFile());
  const d = DB.get();
  line(`database : ${dbFile()}`);

  const local = d.prepare('SELECT id, username, name, role, phone, active, created_at, updated_at FROM users ORDER BY id').all();
  const former = local.find((u) => u.username === People.FORMER);
  const refs = People.userRefs(d).filter((r) => !['sessions', 'login_attempts', 'change_log', 'applied_ops'].includes(r.table));
  line(`local    : ${local.length} account(s), Former staff ${former ? '#' + former.id : 'MISSING — run users:rebuild --apply first'}`);

  if (!SB.isConfigured()) {
    line('');
    line('Supabase is not configured on this machine, so there is nothing to compare against.');
    line('Plan, when it is: upsert the accounts above, re-point and delete every mirror account');
    line(`not among them, across ${refs.length} referencing column(s), then check the permission tables.`);
    line('Nothing was changed.');
    console.log('');
    DB.close();
    return;
  }
  if (!former) { console.log('\n  Refused: no "Former staff" record here yet.\n'); exit(3); }

  const g = await Lineage.guard({ readOnly: true });
  if (!g.ok || g.unclaimed) {
    console.log('\n  Refused: this laptop does not hold the mirror (the baton).');
    for (const l of Lineage.refusal(g.other)) console.log('  ' + l);
    console.log('');
    exit(2);
  }
  line(`baton    : this database owns the mirror ✓`);

  const remote = await SB.select('users', { select: 'id,username', limit: 10000 });
  const localIds = new Set(local.map((u) => u.id));
  const byName = new Map(local.map((u) => [u.username.toLowerCase(), u.id]));
  const gone = remote.filter((r) => !localIds.has(Number(r.id)))
    .map((r) => ({ id: Number(r.id), username: r.username, to: byName.get(String(r.username).toLowerCase()) ?? former.id }));
  line(`mirror   : ${remote.length} account(s); ${gone.length} to remove: ${gone.map((x) => `${x.username} → #${x.to}`).join(', ') || '—'}`);
  line(`sealing  : ${Vault.isEnabled() ? 'on' : 'OFF — accounts go up without their boxes and would come back disabled on a restore'}`);

  if (!APPLY) {
    line('');
    line('Nothing was changed.');
    console.log('');
    DB.close();
    return;
  }

  /* 1 — the accounts, with their boxes. A local account that shares a
     username with a mirror-only row cannot land until that row is gone, so
     those wait for step 3. */
  const cred = d.prepare('SELECT pw_hash, pw_salt, pw_hint, must_change, pw_box FROM users WHERE id = ?');
  const rows = local.map((u) => {
    const r = { ...u, active: !!u.active };
    if (Vault.isEnabled()) { const c = cred.get(u.id); r.pw_enc = c && c.pw_hash ? Vault.sealUser(c) : null; }
    return r;
  });
  const clash = new Set(gone.map((x) => String(x.username).toLowerCase()));
  const first = rows.filter((r) => !clash.has(r.username.toLowerCase()));
  if (first.length) await SB.insert('users', first, { upsert: true });
  line(`upserted : ${first.length}`);

  /* 2 — re-point, then delete */
  let moved = 0;
  for (const x of gone) {
    for (const { table, col } of refs) {
      try {
        const out = await SB.update(table, { [col]: x.id }, { [col]: x.to });
        moved += out.length;
      } catch (e) {
        if (!/does not exist|Could not find|PGRST20[45]|schema cache/i.test(String(e.message))) {
          /* notification_reads and user_permissions are about the person */
          if (['notification_reads', 'user_permissions'].includes(table)) {
            await SB.remove(table, { [col]: x.id }).catch(() => {});
          } else throw new Error(`${table}.${col} for ${x.username}: ${e.message}`);
        }
      }
    }
    await SB.remove('users', { id: x.id });
    line(`removed  : ${x.username} (#${x.id})`);
  }
  line(`moved    : ${moved} reference(s)`);

  const second = rows.filter((r) => clash.has(r.username.toLowerCase()));
  if (second.length) { await SB.insert('users', second, { upsert: true }); line(`upserted : ${second.length} more`); }

  /* 3 — do the permission tables match? */
  for (const [t, keys] of [['role_permissions', ['role', 'perm']], ['user_permissions', ['user_id', 'perm']]]) {
    const here = d.prepare(`SELECT ${keys.join(', ')}, allowed FROM ${t}`).all();
    let there = [];
    try { there = await SB.select(t, { select: keys.concat('allowed').join(','), limit: 20000 }); }
    catch (e) { line(`${t.padEnd(9)}: cannot read (${String(e.message).slice(0, 60)}) — run 027`); continue; }
    const k = (r) => keys.map((c) => String(r[c])).join('|') + '=' + (r.allowed ? 1 : 0);
    const a = new Set(here.map(k)), b = new Set(there.map(k));
    const diff = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
    line(`${t.padEnd(9)}: ${diff === 0 ? 'match ✓' : diff + ' difference(s) — the next sync pushes it whole'}`);
  }
  console.log('');
  DB.close();
}

main().catch((e) => { console.error('\n  Failed:', e.message, '\n'); exit(1); });
