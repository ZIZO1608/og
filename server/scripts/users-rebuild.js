/* ==========================================================================
   The shop's real accounts                              [users-rebuild.js]
   --------------------------------------------------------------------------
   npm run users:rebuild                 dry run — prints the plan, changes nothing
   npm run users:rebuild -- --apply      does it
   Options: --url http://localhost:8090  the RUNNING shop, for the lockout guard

   Night shift 01, E6. Makes this database's accounts exactly the owner's
   table below, and nothing else:

     1. THE LOCKOUT GUARD (2026-09-05 happened). `abode` (owner) is made first,
        then signed in through the running shop's real login route, and the
        Access list must open for him. Only then is any other account touched.
        If any of that fails, nothing else changes.
     2. Every missing account is created through Auth.createUser — hashed, and
        with OG_VAULT_KEY set, its password sealed for the developer panel —
        with a new strong password. The passwords are written ONLY to
        ACCOUNTS.private.md in the data folder this runs against (gitignored).
        zaven and zohrab are left exactly as they are.
     3. Every other account is removed without breaking history
        (lib/people.js): references re-pointed to one hidden "Former staff"
        record, sessions ended, rows deleted — or, where a table will not take
        the re-point, kept hidden and unusable.
     4. The manager's new default set is applied (059's header), through the
        running shop so its permission cache follows.

   Prints no password. Run `npm run users:mirror` afterwards to make Supabase
   match, and restart the shop (Full refresh).
   ========================================================================== */

import { argv, exit, env } from 'node:process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dbFile, dataDir, load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';
import * as People from '../lib/people.js';
import * as Backup from '../lib/backup.js';
import * as Vault from '../lib/credvault.js';

load();
const APPLY = argv.includes('--apply');
const flag = (n) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : null; };
const URL_BASE = flag('url') || `http://localhost:${env.OG_PORT || 8090}`;

export const TARGET = [
  { username: 'abode',   name: 'Abode',           role: 'owner' },
  { username: 'wael',    name: 'Wael',            role: 'manager' },
  { username: 'cashier', name: 'Cashier',         role: 'cashier' },
  { username: 'member1', name: 'Member 1',        role: 'warehouse' },
  { username: 'member2', name: 'Member 2',        role: 'warehouse' },
  { username: 'member3', name: 'Member 3',        role: 'warehouse' },
  { username: 'zaven',   name: null,              role: 'partner', keep: true },
  { username: 'zohrab',  name: null,              role: 'partner', keep: true },
  { username: 'zizo',    name: 'Developer Zizo',  role: 'developer' },
  { username: 'ahmad',   name: 'Developer Ahmad', role: 'developer' },
  { username: 'safeer1', name: 'Safeer 1',        role: 'delivery' },
  { username: 'safeer2', name: 'Safeer 2',        role: 'delivery' }
];

const line = (s = '') => console.log('  ' + s);
const DB_FILE = dbFile();

function plan() {
  const d = DB.get();
  const all = d.prepare('SELECT id, username, name, role, active FROM users ORDER BY id').all();
  const byName = new Map(all.map((u) => [u.username.toLowerCase(), u]));
  const create = [], fix = [], keep = [];
  for (const t of TARGET) {
    const u = byName.get(t.username);
    if (!u) { if (!t.keep) create.push(t); else keep.push({ ...t, missing: true }); continue; }
    if (t.keep) { keep.push({ ...t, id: u.id, roleOk: u.role === t.role }); continue; }
    if (u.role !== t.role || !u.active || (t.name && u.name !== t.name)) fix.push({ ...t, id: u.id, was: u });
    else keep.push({ ...t, id: u.id });
  }
  const wanted = new Set(TARGET.map((t) => t.username));
  const remove = all.filter((u) => !wanted.has(u.username.toLowerCase()) && !Auth.isHiddenUser(u));
  return { all, create, fix, keep, remove };
}

async function signIn(username, password) {
  const r = await fetch(URL_BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: URL_BASE },
    body: JSON.stringify({ username, password })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw new Error(`sign-in refused (${r.status} ${body.code || ''})`);
  return (r.headers.getSetCookie?.() || []).map((s) => s.split(';')[0]).join('; ');
}
async function call(cookie, method, path, body) {
  const r = await fetch(URL_BASE + path, {
    method, headers: { 'content-type': 'application/json', cookie, origin: URL_BASE },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function writePasswords(rows) {
  const file = join(dataDir(), 'ACCOUNTS.private.md');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  let text = existsSync(file) ? readFileSync(file, 'utf8') + '\n' : '# OG System accounts — PRIVATE, never commit, never send\n';
  text += `\n## Made by users:rebuild, ${stamp} UTC\n\n| username | password | role |\n|---|---|---|\n` +
          rows.map((r) => `| ${r.username} | ${r.password} | ${r.role} |`).join('\n') + '\n';
  writeFileSync(file, text, { mode: 0o600 });
  return file;
}

async function main() {
  const pending = (() => { const d0 = DB.openReadOnly(DB_FILE); const p = DB.pendingMigrations(d0); DB.close(); return p; })();
  if (pending.length) {
    console.log(`\n  Refused: this database has migrations the server has not applied yet (${pending.join(', ')}).`);
    console.log('  Start the shop once on this code (Full refresh), then run this again.\n');
    exit(3);
  }
  DB.open(DB_FILE);

  console.log('\n  OG SYSTEM — the shop\'s accounts' + (APPLY ? '' : '  (DRY RUN — nothing changes; add --apply)'));
  line(`database : ${DB_FILE}`);
  line(`shop     : ${URL_BASE}   (for the sign-in check)`);
  line(`vault    : ${Vault.isEnabled() ? 'on — passwords will be sealed for the developer panel' : 'OFF — the developer panel will not be able to show these passwords'}`);
  const p = plan();
  line('');
  line(`create   : ${p.create.map((t) => `${t.username} (${t.role})`).join(', ') || '—'}`);
  line(`fix      : ${p.fix.map((t) => `${t.username} → ${t.role}${t.was.active ? '' : ', switched on'}`).join(', ') || '—'}`);
  line(`keep     : ${p.keep.map((t) => t.username + (t.missing ? ' (MISSING)' : t.roleOk === false ? ' (role will be set to partner)' : '')).join(', ') || '—'}`);
  line(`remove   : ${p.remove.map((u) => u.username).join(', ') || '—'}`);
  line(`history  : every reference to a removed account moves to one hidden "Former staff" record`);
  line(`manager  : default set loses money, cost, profit, staff, settings and access`);

  if (!APPLY) { line(''); line('Nothing was changed.'); console.log(''); DB.close(); return; }

  /* a backup first, like every other script that rewrites people */
  const target = join(Backup.BACKUP_DIR, `og-${Backup.stamp()}-before-users-rebuild.db`);
  DB.close();
  Backup.snapshot(DB_FILE, target);
  const v = Backup.verify(target);
  if (!v.ok) { console.log(`\n  Refused: the backup did not verify (${v.reason || 'unknown'}).\n`); exit(4); }
  DB.open(DB_FILE);
  line('');
  line(`backup   : ${target}`);

  const made = [];

  /* ---- 1. the lockout guard ------------------------------------------ */
  let abodePw = null;
  let abode = Auth.findByUsername('abode');
  if (!abode) {
    const r = await People.add({ name: 'Abode', username: 'abode', role: 'owner' });
    abodePw = r.password;
    made.push({ username: 'abode', password: abodePw, role: 'owner' });
    abode = Auth.findByUsername('abode');
  } else {
    if (abode.role !== 'owner' || !abode.active) {
      DB.get().prepare("UPDATE users SET role = 'owner', active = 1, updated_at = ? WHERE id = ?").run(DB.nowIso(), abode.id);
    }
    const r = await People.newPassword(abode.id);
    abodePw = r.password;
    made.push({ username: 'abode', password: abodePw, role: 'owner' });
  }
  Auth.invalidatePermissions();
  /* the passwords are on disk before anything can fail */
  writePasswords(made);

  let cookie;
  try {
    cookie = await signIn('abode', abodePw);
    const a = await call(cookie, 'GET', '/api/access');
    if (a.status !== 200) throw new Error(`the Access list answered ${a.status}`);
  } catch (e) {
    console.log(`\n  STOPPED at the lockout guard: ${e.message}.`);
    console.log('  The owner account exists, but nothing else was changed.');
    console.log(`  Its password is in ${join(dataDir(), 'ACCOUNTS.private.md')}. Is the shop running at ${URL_BASE}?\n`);
    DB.close();
    exit(2);
  }
  line('guard    : abode signed in through the shop and opened Access ✓');

  /* ---- 2. the rest of the table -------------------------------------- */
  for (const t of p.create) {
    if (t.username === 'abode') continue;
    const r = await People.add({ name: t.name, username: t.username, role: t.role });
    made.push({ username: t.username, password: r.password, role: t.role });
  }
  for (const t of p.fix) {
    if (t.username === 'abode') continue;
    DB.get().prepare('UPDATE users SET role = ?, name = ?, active = 1, updated_at = ? WHERE id = ?')
      .run(t.role, t.name || t.was.name, DB.nowIso(), t.id);
    /* an account we did not make has a password nobody here knows: a new one */
    const r = await People.newPassword(t.id);
    made.push({ username: t.username, password: r.password, role: t.role });
  }
  for (const t of p.keep) {
    if (t.keep && t.roleOk === false) {
      DB.get().prepare("UPDATE users SET role = 'partner', updated_at = ? WHERE id = ?").run(DB.nowIso(), t.id);
    }
  }
  writePasswords(made.filter((m) => m.username !== 'abode'));

  /* ---- 3. everyone else ---------------------------------------------- */
  const gone = People.removeAccounts(p.remove.map((u) => u.id), abode.id);

  /* ---- 4. the manager's default set, through the running shop -------- */
  const matrix = (await call(cookie, 'GET', '/api/roles')).body;
  const managerNow = (matrix.permissions || []).filter((x) => x.roles.manager && x.roles.manager.allowed).map((x) => x.perm);
  const managerNew = managerNow.filter((perm) => !People.MANAGER_WITHOUT(perm));
  const put = await call(cookie, 'PUT', '/api/roles/manager', { granted: managerNew });
  if (put.status !== 200) {
    /* The shop is reachable (the guard proved it) but refused: set it here and say so. */
    Auth.setRolePermissions('manager', managerNew, abode.id);
    line('manager  : set in the database — RESTART THE SHOP so it reads the new set');
  } else {
    line(`manager  : ${managerNow.length} → ${managerNew.length} permissions (set through the shop)`);
  }
  await call(cookie, 'POST', '/api/auth/logout', {});

  line('');
  line(`created  : ${made.filter((m) => p.create.some((t) => t.username === m.username)).map((m) => m.username).join(', ') || '—'}`);
  line(`new pw   : ${made.map((m) => m.username).join(', ')}`);
  for (const g of gone.done) {
    line(g.outcome === 'removed'
      ? `removed  : ${g.username} (${g.moved} reference(s) → Former staff)`
      : `KEPT     : ${g.username} as hidden "${g.as}" — ${g.why}`);
  }
  line(`former   : "Former staff" is user ${gone.formerId}, hidden and switched off`);
  line(`passwords: ${join(dataDir(), 'ACCOUNTS.private.md')}   (no password was printed)`);
  line('');
  line('Next: npm run users:mirror  (dry run first), then Full refresh.');
  console.log('');
  DB.close();
}

main().catch((e) => { console.error('\n  Failed:', e.message, '\n'); exit(1); });
