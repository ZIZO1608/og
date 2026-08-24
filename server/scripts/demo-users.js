/* ==========================================================================
   Create the test accounts
   --------------------------------------------------------------------------
   One account per role, with passwords printed on screen, so the permission
   boundaries can actually be seen rather than taken on trust. Sign in as the
   cashier and the cost and profit figures are simply not there — not hidden
   with CSS, not present in the response at all.

   Names match the staff already in js/data.js, so a demo reads as a real shop
   rather than "user1, user2".

   THESE ARE NOT REAL ACCOUNTS. Everyone who reads this file knows the
   passwords, and this file is in a public repository. Three guards:

     - it refuses to run when OG_SECURE=1, which is set on a real server
     - it refuses if real accounts already exist, unless --force
     - the server prints a warning on every startup while they exist

   Before the shop opens on this system: npm run demo-users -- --remove

   Usage:
     npm run demo-users            create them
     npm run demo-users -- --remove   delete them again
     npm run demo-users -- --force    create even alongside real accounts
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

const has = (f) => argv.includes(`--${f}`);

/* One password for all of them. Individually strong passwords on accounts
   whose credentials are printed in a public file would be theatre, and
   remembering five is friction during the one thing these exist for. */
const PASSWORD = 'test-1234';

export const DEMO_USERS = [
  { username: 'hussam', name: 'Hussam Fattal', role: 'manager',
    hint: 'the test one', does: 'Everything — cost, profit, staff, voids' },
  { username: 'lubna',  name: 'Lubna Kayali',  role: 'cashier',
    hint: 'the test one', does: 'Sell and take payment. NO cost, NO profit' },
  { username: 'maher',  name: 'Maher Odeh',    role: 'warehouse',
    hint: 'the test one', does: 'Receive, move and count stock. Cannot sell' },
  { username: 'talal',  name: 'Talal Mroue',   role: 'delivery',
    hint: 'the test one', does: 'Read-only: what to deliver' },
  { username: 'yalla',  name: 'Yalla Wear',    role: 'partner',
    hint: 'the test one', does: 'Their print jobs only. No customers, no prices' }
];

const NAMES = DEMO_USERS.map(u => u.username);

async function main() {
  /* A real server sets this. Known passwords must never reach one. */
  if (env.OG_SECURE === '1' && !has('remove')) {
    console.error('');
    console.error('  REFUSING: OG_SECURE=1 means this is a real server.');
    console.error('  Test accounts have published passwords and must not exist here.');
    console.error('  Use `npm run createuser` to make a real account instead.');
    console.error('');
    exit(1);
  }

  DB.open(DB_FILE);
  const d = DB.get();

  /* ---- remove ------------------------------------------------------------ */
  if (has('remove')) {
    let gone = 0;
    for (const u of NAMES) {
      const row = Auth.findByUsername(u);
      if (!row) continue;
      Auth.destroyAllSessions(row.id);
      d.prepare('DELETE FROM users WHERE id = ?').run(row.id);
      gone++;
    }
    console.log('');
    console.log(`  Removed ${gone} test account(s).`);
    console.log('');
    if (d.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
      console.log('  There are now NO accounts at all. Make one before starting:');
      console.log('    npm run createuser');
      console.log('');
    }
    DB.close();
    return;
  }

  /* ---- guard against a live database ------------------------------------- */
  const real = d.prepare('SELECT username FROM users').all()
                .map(r => r.username)
                .filter(u => !NAMES.includes(u));

  if (real.length && !has('force')) {
    console.error('');
    console.error(`  REFUSING: this database already has ${real.length} real account(s):`);
    console.error(`    ${real.join(', ')}`);
    console.error('');
    console.error('  It looks like a database in use, not a scratch one. Adding');
    console.error('  accounts with published passwords beside real ones is how a');
    console.error('  test login survives into a live shop.');
    console.error('');
    console.error('  If you are sure:  npm run demo-users -- --force');
    console.error('');
    DB.close();
    exit(1);
  }

  /* ---- create ------------------------------------------------------------- */
  console.log('');
  console.log('  Creating test accounts…');
  console.log('');

  for (const u of DEMO_USERS) {
    const existing = Auth.findByUsername(u.username);
    if (existing) {
      /* Re-running should reset the password rather than fail, so a forgotten
         change during testing is one command away from fixed. */
      await Auth.changePassword(existing.id, PASSWORD);
      d.prepare('UPDATE users SET active = 1, must_change = 0 WHERE id = ?').run(existing.id);
      console.log(`    reset   ${u.username.padEnd(9)} ${u.role}`);
    } else {
      await Auth.createUser({
        username: u.username, name: u.name, role: u.role,
        password: PASSWORD, hint: u.hint
      });
      console.log(`    created ${u.username.padEnd(9)} ${u.role}`);
    }
  }

  const line = '  ' + '─'.repeat(74);
  console.log('');
  console.log(line);
  console.log('   TEST ACCOUNTS      password for all:  ' + PASSWORD);
  console.log(line);
  console.log('   username   role         what they can do');
  console.log(line);
  for (const u of DEMO_USERS) {
    console.log(`   ${u.username.padEnd(10)} ${u.role.padEnd(12)} ${u.does}`);
  }
  console.log(line);
  console.log('');
  console.log('   Sign in at http://localhost:8090');
  console.log('');
  console.log('   Worth doing once: sign in as lubna, then as hussam, and look');
  console.log('   at the same product. The cashier has no cost and no profit —');
  console.log('   the server does not send them, so there is nothing to reveal.');
  console.log('');
  console.log('   DELETE THESE BEFORE THE SHOP USES THIS FOR REAL:');
  console.log('     npm run demo-users -- --remove');
  console.log('');

  DB.close();
}

main().catch((err) => {
  console.error('\n  Failed:', err.message, '\n');
  exit(1);
});
