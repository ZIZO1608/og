/* ==========================================================================
   OG SYSTEM — Supabase connection check
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:check

   Answers one question — "is this wired up correctly?" — and says which part
   is wrong when it is not. Every failure below prints the thing to go and do,
   because "connection failed" on its own has never helped anybody.

   Reads credentials from server/.env. It never prints a key in full.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, maybe, mask, envFilePath, envFileExists } from '../lib/env.js';
import * as SB from '../lib/supabase.js';

load();

const HERE = dirname(fileURLToPath(import.meta.url));

/* --quick answers only "is it wired up" and skips the row-by-row comparison.
   The full run is the default deliberately: the short answer is the one that
   was reassuring people while real sales sat unmirrored. */
const QUICK = process.argv.includes('--quick');

const BOLD = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m';
const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const cross = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `  \x1b[33m!\x1b[0m ${s}`;
const head = (s) => `\n\x1b[1m${s}\x1b[0m`;

let failed = false;
const fail = (msg, fix) => {
  failed = true;
  console.log(cross(msg));
  if (fix) console.log(`      ${fix}`);
};

console.log(head('1. Where settings are coming from'));

/* Deliberately not a failure. A real deployment sets these as environment
   variables in Docker, systemd or a hosting dashboard and ships no .env at
   all — reporting that as "not connected" would be a lie, and one that sends
   somebody hunting for a file they were right not to create. */
const hasFile = envFileExists();
if (hasFile) {
  console.log(tick(`Reading ${envFilePath()}`));
} else {
  console.log(warn(`No .env at ${envFilePath()}`));
  console.log('      That is fine if the variables are set in the real environment.');
  console.log('      Otherwise:  cd server && cp .env.example .env');
}

console.log(head('2. Credentials'));

const url = maybe('SUPABASE_URL');
const anon = maybe('SUPABASE_ANON_KEY');
const secret = maybe('SUPABASE_SERVICE_ROLE_KEY') || maybe('SUPABASE_SECRET_KEY');

if (!url) {
  fail('SUPABASE_URL is not set',
       'Fix: Dashboard → Project Settings → API → Project URL');
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.replace(/\/+$/, ''))) {
  console.log(warn(`SUPABASE_URL is ${url}`));
  console.log('      That does not look like https://<ref>.supabase.co — carrying on anyway.');
} else {
  console.log(tick(`SUPABASE_URL   ${url}`));
}

if (!anon) {
  console.log(warn('SUPABASE_ANON_KEY is not set (not needed yet — the browser never calls Supabase)'));
} else {
  console.log(tick(`anon key       ${mask(anon)}`));
}

if (!secret) {
  fail('SUPABASE_SERVICE_ROLE_KEY is not set',
       'Fix: Dashboard → Project Settings → API Keys → the secret / service_role key');
} else {
  console.log(tick(`service key    ${mask(secret)}`));

  /* The two keys are easy to mix up — they sit next to each other on the same
     page and look alike. Pasting the public one here fails later with a
     confusing permission error instead of an obvious wrong-key error. */
  if (anon && secret === anon) {
    fail('The service key and the anon key are identical',
         'Fix: these are two different keys. Copy the one marked secret / service_role.');
  }
}

if (failed) {
  console.log(head('Result'));
  console.log(cross('Not connected yet — fix the above and run this again.\n'));
  process.exit(1);
}

console.log(head('3. Reaching the project'));

const res = await SB.ping();

if (!res.ok) {
  if (res.reason === 'bad_key') {
    fail(res.message,
         'Fix: the URL is reachable but the key was rejected. Re-copy the secret key.');
  } else if (res.reason === 'unreachable') {
    fail(res.message,
         'Fix: check the project URL, that the project is not paused, and this machine is online.');
  } else {
    fail(res.message, 'Fix: check the project is running in the Supabase dashboard.');
  }
  console.log(head('Result'));
  console.log(cross('Not connected.\n'));
  process.exit(1);
}

console.log(tick(`Project answered at ${res.url}`));
console.log(tick('The secret key was accepted'));

console.log(head('4. Schema'));

/* The check is deliberately read-only. A script that writes to prove it can
   write is a script that leaves rubbish in a database somebody is about to
   start trusting. */
let found = 0;
const WANT = ['products', 'variants', 'sales', 'customers', 'stock'];
const missing = [];

for (const t of WANT) {
  try {
    const n = await SB.count(t);
    console.log(tick(`${t.padEnd(12)} ${n === null ? 'present' : `${n} rows`}`));
    found++;
  } catch (err) {
    if (/relation|does not exist|PGRST205|404/i.test(err.message)) missing.push(t);
    else console.log(warn(`${t.padEnd(12)} ${err.message}`));
  }
}

if (missing.length) {
  console.log(warn(`Not created yet: ${missing.join(', ')}`));
  console.log('      This is expected on a brand-new project — the schema has not been');
  console.log('      pushed. That is the next step, not an error.');
}

/* ==========================================================================
   Everything above answers "is it wired up". That is NOT the same question as
   "is the shop actually in the mirror", and answering only the first is how a
   real gap hid for weeks: this script printed "Connected. 5 of 5 core tables
   present" every time while five invoices and every delivery were missing.
   Both counts were true. Neither was the thing anyone wanted to know.

   So the rest compares the two databases row for row, and reports the
   difference rather than the connection. Read-only throughout.
   ========================================================================== */

if (QUICK || found === 0) {
  console.log(head('Result'));
  console.log(`  \x1b[32mConnected.\x1b[0m  ${found} of ${WANT.length} core tables present.`);
  console.log(found === 0
    ? '  Next: push the schema, then run this again.\n'
    : `  ${DIM}Wiring only — run without --quick to compare the shop against the mirror.${OFF}\n`);
  process.exit(0);
}

const DB = await import('../lib/db.js');
const Vault = await import('../lib/credvault.js');
const Lineage = await import('../lib/lineage.js');
/* Read-only, and it matters: DB.open() applies every pending migration on the
   way in, so with an unfinished .sql sitting in server/migrations this check
   was a schema change on the live database that nobody asked for. It did
   exactly that once. A read-only handle cannot. */
DB.openReadOnly(maybe('OG_DB') || resolve(HERE, '..', 'data', 'og.db'));
const db = DB.get();

/* Deliberately never mirrored — live session tokens, a local print queue and a
   counter have no business in a copy kept for the day this machine dies.
   partner_events is the Telegram OUTBOX (035_partner_link.sql): delivery
   state, not shop data. A restored shop re-sending three months of "order
   accepted" to two phones would be a bug, so the sync leaves it out on
   purpose — and this list must agree, or the check reports the design as a
   missing table every run. */
const LOCAL_ONLY = new Set(['sessions', 'login_attempts', 'applied_ops',
                            'label_print_jobs', 'label_code_seq',
                            'schema_migrations', 'change_log',
                            'partner_events']);

/* Columns that exist here and MUST NOT exist there. The column check below
   would otherwise report the most important security property of this mirror
   as a fault.

   A password never crosses. syncUsers reads pw_hash, pw_salt, pw_hint and
   must_change only to seal them into the single pw_enc box (credvault.js) and
   pushes the sealed box alone — so a stolen Supabase project is not a stolen
   password list. The absence of these four columns is the design working.

   Keyed by table so a column named pw_hash on some future table is not
   silently exempted along with this one. */
const LOCAL_ONLY_COLS = {
  users: new Set(['pw_hash', 'pw_salt', 'pw_hint', 'must_change'])
};

const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
).all().map((r) => r.name);

console.log(head('5. Is the shop actually in the mirror?'));

const behind = [];      /* rows here that are not there — the dangerous case */
const ahead = [];       /* rows there that are not here */
const absent = [];      /* table missing remotely */
const unreadable = [];  /* table answered with something other than a count */
const thin = [];        /* table is there, but short of columns */
let matched = 0;

/* Tables the sync rewrites WHOLE on every run. A gap in one of these closes
   on the next sync by itself; the advice for the others is reconcile. */
const WHOLE = new Set(['config', 'role_permissions', 'label_templates', 'clubs',
                       'notification_reads', 'users', 'currencies', 'warehouses']);

/* The bookmarks, fetched once here because section 5 needs them too: a row
   that is missing there AND sits at or below its table's bookmark is a row
   the ordinary sync will never look at again. */
let cursors = [];
try { cursors = await SB.select('sync_state', {}); } catch { /* reported in 6 */ }
const cursorFor = (t) => {
  const c = cursors.find((r) => r.id === `sync:${t}`);
  const m = cursors.find((r) => r.id === `sync:${t}:maxid`);
  return c ? { kind: 'seq', at: c.last_seq } : m ? { kind: 'id', at: m.last_seq } : null;
};

/* ROWS, NOT COUNTS. Eight here and eight there is not a match: five pushed by
   the shop and three left behind by a test database add up to eight as well,
   and that is the shape the live gap took. The key comes from the schema
   rather than a list written here, so the next table somebody adds is compared
   the same way without anyone remembering to come back. Values are still not
   compared — a qty that moved after its bookmark passes; that is reconcile's
   job, and this says so at the end. */
const PAGE = 1000;
const keyCols = (t) =>
  db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk').all(t).map((c) => c.name);
const keyOf = (row, cols) => cols.map((c) => String(row[c])).join('\u0000');
async function remoteKeys(t, cols) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await SB.select(t, { select: cols.join(','), order: cols.join(','), limit: PAGE, offset });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* WHAT A ROW COUNT CANNOT SEE.
   Two tables can agree on fourteen rows apiece while six columns of every one
   of those rows are missing on the far side — which is exactly what the
   sync's fallbackDrop leaves behind, quietly, on a run that reported success.
   Counting rows would call that mirror faithful and a restore would hand back
   a warehouse with no layout.

   The column list comes from PRAGMA table_info rather than being written out
   here, so this covers the next column somebody adds without anybody
   remembering to come back and list it. */
/* Both shapes the far side answers with:
     PostgREST  Could not find the 'parent_id' column of 'sections' …
     Postgres   column sections.parent_id does not exist
                column "parent_id" of relation "sections" does not exist
   The bare `table.column` form carries no quotes at all, which is why the
   first version of this reported "(unnamed)" against a real finding. */
function namedColumn(msg) {
  const m = String(msg).match(
    /'([a-z_0-9]+)' column|column "([a-z_0-9]+)"|column [a-z_0-9]+\.([a-z_0-9]+)/i
  );
  return m ? (m[1] || m[2] || m[3]) : null;
}

async function missingColumns(table) {
  const skip = LOCAL_ONLY_COLS[table] || new Set();
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
    .map((c) => c.name).filter((c) => !skip.has(c));
  if (!cols.length) return [];
  try {
    await SB.select(table, { select: cols.join(','), limit: 1 });
    return [];
  } catch (e) {
    /* PostgREST names the first column it could not find and then stops, so
       this walks: drop the named one, ask again, until it answers. Bounded by
       the column count, and it only ever runs on a table already known wrong. */
    const missing = [];
    let left = cols.slice();
    let err = e;
    for (let i = 0; i < cols.length; i++) {
      const name = namedColumn(err.message);
      if (!name || left.indexOf(name) < 0) break;
      missing.push(name);
      left = left.filter((c) => c !== name);
      if (!left.length) break;
      try { await SB.select(table, { select: left.join(','), limit: 1 }); break; }
      catch (again) { err = again; }
    }
    /* Named nothing recognisable — report the table rather than swallow it.
       A column check that goes quiet on an unfamiliar message is the failure
       this whole function exists to stop. */
    return missing.length ? missing : ['(could not name it: ' + err.message.slice(0, 60) + ')'];
  }
}

for (const t of tables) {
  if (LOCAL_ONLY.has(t)) continue;
  const here = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;

  let there;
  try { there = await SB.count(t); }
  catch (e) {
    /* A 404 is a table the mirror has not got. Anything else — a timeout, a
       500, a rejected key — is not, and calling it "does not exist" sends
       somebody to run a schema file that has already been run. */
    if (/404|PGRST205|Could not find the table|does not exist/i.test(e.message)) absent.push(t);
    else unreadable.push({ t, why: e.message });
    continue;
  }

  const gone = await missingColumns(t);
  if (gone.length) thin.push({ t, cols: gone });

  const cols = keyCols(t);
  const missing = [], extra = [];
  if (cols.length) {
    const local = new Set(
      db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM "${t}"`).all().map((r) => keyOf(r, cols))
    );
    let remote;
    try { remote = new Set((await remoteKeys(t, cols)).map((r) => keyOf(r, cols))); }
    catch (e) { unreadable.push({ t, why: e.message }); continue; }
    for (const k of local) if (!remote.has(k)) missing.push(k);
    for (const k of remote) if (!local.has(k)) extra.push(k);
  }

  if (!missing.length && !extra.length && there === here) { if (!gone.length) matched++; continue; }

  /* Of the rows that never arrived, how many will the sync never retry?
     change_log.row_id is the key joined with ':' (stock is 'sku:wh'); an
     append-only table's bookmark is the highest id sent. */
  const cur = cursorFor(t);
  let stranded = 0;
  if (cur && missing.length) {
    for (const k of missing) {
      const parts = k.split('\u0000');
      if (cur.kind === 'id') { if (Number(parts[0]) <= cur.at) stranded++; continue; }
      const top = db.prepare('SELECT MAX(seq) AS m FROM change_log WHERE tbl = ? AND row_id = ?')
                    .get(t, parts.join(':')).m;
      if (top !== null && top <= cur.at) stranded++;
    }
  }

  if (missing.length || (there !== null && here > there)) behind.push({ t, here, there, missing, extra, stranded });
  else ahead.push({ t, here, there, missing, extra, stranded });
}

console.log(tick(`${matched} table(s) match row for row`));

for (const { t, why } of unreadable) {
  console.log(warn(`${t.padEnd(18)} could not be compared — ${why.slice(0, 90)}`));
}

/* Before the row comparisons: a table short of columns is wrong however well
   its rows line up, and saying so after "36 tables match exactly" reads as an
   afterthought rather than as the reason the mirror cannot be trusted. */
for (const { t, cols } of thin) {
  console.log(cross(`${t.padEnd(18)} missing in Supabase: ${cols.join(', ')}`));
  failed = true;
}
if (thin.length) {
  console.log(`\n      Fix: run the matching server/supabase/*.sql in the SQL editor,`);
  console.log(`      ${DIM}then npm run supabase:reconcile — the sync's cursor is past those rows.${OFF}`);
}

if (absent.length) {
  console.log(cross(`${absent.length} table(s) do not exist in Supabase: ${absent.join(', ')}`));
  console.log('      Fix: run the matching file in server/supabase/ in the SQL editor.');
  failed = true;
}

/* A shop AHEAD of its mirror is the one that matters. It means a sale, a
   delivery or a stock move is on this machine only, and a dead drive loses it.
   Never soften this into a warning. */
for (const { t, here, there, missing, extra, stranded } of behind) {
  const n = missing.length || (here - there);
  console.log(cross(`${t.padEnd(18)} ${here} here, ${there} in Supabase — ${n} NOT mirrored` +
                    (extra.length ? `, ${extra.length} extra there` : '') +
                    (stranded ? `; ${stranded} below the sync's bookmark` : '')));
  failed = true;
}
for (const { t, here, there, extra } of ahead) {
  console.log(warn(`${t.padEnd(18)} ${here} here, ${there} in Supabase — ${extra.length || (there - here)} extra there`));
}

/* Which tool, said truthfully. The sync rewrites the WHOLE tables on every
   run; for the rest reconcile is the only thing that reads both sides, and
   the only thing that will ever look at a row below its bookmark again. */
if (behind.some((b) => !WHOLE.has(b.t))) {
  console.log(`\n      Fix: ${BOLD}npm run supabase:reconcile${OFF} — it pushes what is missing.`);
  if (behind.some((b) => b.stranded)) {
    console.log(`      ${DIM}The ordinary sync cannot: its bookmark is already past those rows.${OFF}`);
  }
}
if (behind.some((b) => WHOLE.has(b.t))) {
  console.log(`\n      ${DIM}${behind.filter((b) => WHOLE.has(b.t)).map((b) => b.t).join(', ')}: ` +
              `rewritten whole by the next npm run supabase:sync.${OFF}`);
}
if (ahead.some((a) => !WHOLE.has(a.t)) && !behind.length) {
  console.log(`\n      ${DIM}Extra rows there are usually rows deleted here. Check them, then${OFF}`);
  console.log(`      ${DIM}npm run supabase:reconcile removes the ones the shop no longer has.${OFF}`);
}
if (ahead.some((a) => a.t === 'users')) {
  /* Never a script's call — see 7, which names them. */
  console.log(`\n      ${DIM}users: no script deletes an account. See 7 below.${OFF}`);
}
if (ahead.some((a) => WHOLE.has(a.t) && a.t !== 'users')) {
  console.log(`\n      ${DIM}${ahead.filter((a) => WHOLE.has(a.t) && a.t !== 'users').map((a) => a.t).join(', ')}: ` +
              `rewritten whole by the next npm run supabase:sync.${OFF}`);
}

console.log(head('6. Sync bookmarks'));

/* WHOSE MIRROR IS THIS — asked before the bookmarks are judged, because a
   bookmark written by another database is not "stranded", it is somebody
   else's. Read-only here: the check never claims. See lib/lineage.js. */
try {
  const lin = await Lineage.guard({ readOnly: true });
  if (lin.ok && lin.mine && !lin.unclaimed) {
    console.log(tick(`the mirror is this database's (lineage ${lin.mine.slice(0, 8)}…)`));
  } else if (lin.unclaimed) {
    /* Red, because the next sync from this machine is refused until a person
       decides — a mirror that quietly stopped moving is the thing the whole
       check exists to catch. */
    console.log(cross('nobody has claimed this mirror yet — every sync is refused (exit 2) until one database does'));
    console.log(`      If THIS machine is the shop:  ${BOLD}OG_SYNC_TAKEOVER=1 npm run supabase:sync${OFF}  once, then reconcile.`);
    console.log('      If it is a dev or test copy:  OG_SYNC_MINUTES=0 in server/.env, or a project of its own.');
    failed = true;
  } else {
    const since = String(lin.other.since || '?').slice(0, 16).replace('T', ' ');
    console.log(cross(`the mirror belongs to ANOTHER database: ${lin.other.host}, since ${since} UTC`));
    console.log('      Every sync and reconcile from this machine is refused (exit 2) until a person decides:');
    console.log(`      this machine IS the shop   → ${BOLD}OG_SYNC_TAKEOVER=1 npm run supabase:sync${OFF}, then reconcile;`);
    console.log('      this is a dev or test copy → OG_SYNC_MINUTES=0 in server/.env, or a project of its own.');
    failed = true;
  }
} catch (e) {
  console.log(warn(`lineage could not be read — ${String(e.message).slice(0, 80)}`));
}

/* A cursor ahead of its OWN table's last log entry can never move again — the
   next run asks for changes after a number nothing will ever reach, finds
   none, and reports "nothing new" for good. Compared against the whole log's
   maximum this is invisible, because a busy table hides a quiet one. */
if (!cursors.length) {
  console.log(warn('sync_state is empty or missing — the sync has never run against this project.'));
}

let stuck = 0, live = 0;
for (const c of cursors) {
  const m = String(c.id).match(/^sync:([a-z_]+)(:maxid)?$/);
  if (!m) continue;
  const [, tbl, byId] = m;
  /* A bookmark for a table this shop does not have is not "healthy" — it is
     a bookmark somebody else's database left here, or a table that was
     renamed. Say so rather than counting it. */
  if (!tables.includes(tbl)) {
    console.log(warn(`${c.id.padEnd(30)} is a bookmark for a table this shop does not have`));
    continue;
  }
  let top;
  try {
    top = byId
      ? db.prepare(`SELECT MAX(id) AS m FROM "${tbl}"`).get().m
      : db.prepare('SELECT MAX(seq) AS m FROM change_log WHERE tbl = ?').get(tbl).m;
  } catch { continue; }
  live++;
  if (top !== null && c.last_seq > top) {
    stuck++;
    console.log(cross(`${c.id.padEnd(30)} at ${c.last_seq}, but ${tbl} only reaches ${top}`));
    failed = true;
  }
}

if (stuck) {
  console.log('      These are stranded: every run will say "nothing new" forever.');
  console.log(`      Fix: they rewind automatically on the next ${BOLD}npm run supabase:sync${OFF}.`);
} else if (live) {
  console.log(tick(`${live} bookmark(s) healthy — none ahead of its own table`));
}

console.log(head('7. Account recovery'));

if (!Vault.isEnabled()) {
  console.log(warn('OG_VAULT_KEY is not set — passwords are NOT mirrored.'));
  console.log('      A restore would rebuild this shop with no way to sign in.');
  console.log('      Fix: set OG_VAULT_KEY in server/.env, then run npm run supabase:sync.');
} else {
  let sealed = 0, total = 0;
  try {
    const remote = await SB.select('users', { select: 'id,username,active,pw_enc' });
    total = remote.length;
    sealed = remote.filter((r) => r.pw_enc).length;
    if (sealed < total) {
      console.log(warn(`${sealed} of ${total} mirrored accounts carry a sealed password.`));
      console.log('      Run npm run supabase:sync to seal the rest.');
    } else {
      console.log(tick(`all ${total} mirrored account(s) carry a sealed password`));
    }

    /* A LOGIN THE SHOP DOES NOT HAVE. users is upserted, never mirrored — the
       app never deletes an account, only disables one — so a row there that
       is not on this machine can only have come from ANOTHER database pushed
       at the same project: a throwaway test copy, or a second machine. That
       happened: a test database left an active manager and an active cashier
       in the mirror, each sealed with a password this machine never set, and
       a restore would have created both, able to sign in. Red while one is
       active. The fix is a person's decision — delete the row in Table
       Editor → users, or create the account here if it is real — not this
       script's, and not the sync's: deleting accounts automatically is how a
       second machine's staff list would erase the first's. */
    const localNames = new Set(
      db.prepare('SELECT lower(username) AS u FROM users').all().map((r) => r.u)
    );
    const foreign = remote.filter((r) => !localNames.has(String(r.username).toLowerCase()));
    if (foreign.length) {
      const live = foreign.filter((r) => r.active);
      const line = `${foreign.length} mirrored account(s) do not exist here: ` +
                   foreign.map((r) => `${r.username}${r.active ? ' (active)' : ''}`).join(', ');
      if (live.length) { console.log(cross(line)); failed = true; }
      else console.log(warn(line));
      console.log('      A restore here would recreate them. They were pushed by ANOTHER database on');
      console.log('      this project — see the lineage line in 6. If that machine is the shop, this');
      console.log('      one must stop syncing here; if it was a test copy, delete them in Table Editor.');
    }
  } catch {
    console.log(warn('users.pw_enc is missing — run server/supabase/002_user_credentials.sql.'));
  }
  console.log(`      ${DIM}Keep a copy of OG_VAULT_KEY somewhere that is not this machine.${OFF}`);
  console.log(`      ${DIM}Without it the sealed boxes never open again.${OFF}`);
}

console.log(head('Result'));
if (failed) {
  console.log(cross('The mirror is NOT a faithful copy of the shop. Fix the red lines above.\n'));
  process.exit(1);
}
console.log(`  \x1b[32mConnected, and the mirror matches the shop.\x1b[0m`);
console.log(`  ${DIM}${matched} table(s) compared${ahead.length ? `, ${ahead.length} with extra rows there` : ''}.${OFF}\n`);
