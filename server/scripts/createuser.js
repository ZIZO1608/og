/* ==========================================================================
   Create a user account from the command line
   --------------------------------------------------------------------------
   This is how the FIRST manager gets in — there is no other way, deliberately.
   A server that ships with a default admin password is a server that gets
   broken into, because that password is never changed.

   Usage:
     npm run createuser
     node scripts/createuser.js --username boss --name "Zaven" --role manager

   With no flags it asks. The password is always asked for and never taken as
   a flag, because command-line arguments end up in shell history and in the
   process list where any other user on the machine can read them.
   ========================================================================== */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit, env } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

/* --------------------------------------------------------------- arguments */

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

/* ------------------------------------------------------------------ input
   Two modes, because this script is used both by a person at a keyboard and
   by setup automation.

   Piped input is read up front and answered from a queue rather than through
   readline. readline on a non-TTY leaves `question()` unresolved once the
   stream ends, the event loop empties, and node exits 0 having done nothing —
   a script that reports success while silently creating no account is worse
   than one that crashes. */

const INTERACTIVE = stdin.isTTY;
let piped = null;

async function loadPiped() {
  if (INTERACTIVE) return;
  const chunks = [];
  for await (const c of stdin) chunks.push(c);

  let text = Buffer.concat(chunks).toString('utf8');

  /* Strip a leading byte-order mark. PowerShell adds one to almost everything
     it pipes, and an invisible ﻿ glued to the front of the first line
     makes a password silently not match its own confirmation — which reads as
     "I typed it right twice and it still refuses". */
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  piped = text.split(/\r?\n/);
}

function nextPiped(what) {
  if (!piped || piped.length === 0) {
    throw new Error(
      `ran out of input while asking for "${what}". When piping, supply one ` +
      'line per prompt: password, password again, then hint (blank to skip).'
    );
  }
  return piped.shift();
}

async function ask(rl, prompt, what) {
  if (!INTERACTIVE) return nextPiped(what ?? prompt).trim();
  return (await rl.question(prompt)).trim();
}

/* Read a password without printing it. Node's readline has no built-in for
   this, so the output is muted while it is typed — otherwise it goes on screen
   and, worse, stays in the scrollback. */
async function askHidden(rl, prompt, what) {
  if (!INTERACTIVE) return nextPiped(what ?? prompt);

  stdout.write(prompt);
  const original = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = function (s) {
    /* Echo only the newline, so Enter still moves the cursor down. */
    if (s.includes('\n')) original?.('\n');
  };

  const answer = await rl.question('');
  rl._writeToOutput = original;
  stdout.write('\n');
  return answer;
}

/* -------------------------------------------------------------------- main */

async function main() {
  await loadPiped();
  DB.open(DB_FILE);

  const existing = DB.get().prepare('SELECT COUNT(*) AS n FROM users').get().n;

  console.log('');
  console.log('  OG SYSTEM — create an account');
  console.log(`  database: ${DB_FILE}`);
  console.log(`  existing accounts: ${existing}`);
  if (existing === 0) {
    console.log('');
    console.log('  This is the first account. Make it a manager — it is the');
    console.log('  only role that can create the others.');
  }
  console.log('');

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const username = flag('username') || await ask(rl, '  username : ', 'username');
    const name     = flag('name')     || await ask(rl, '  full name: ', 'full name');

    let role = flag('role');
    if (!role) {
      const suggested = existing === 0 ? 'manager' : 'cashier';
      console.log(`  roles    : ${Auth.ROLES.join(', ')}`);
      role = (await ask(rl, `  role [${suggested}]: `, 'role')) || suggested;
    }

    if (!Auth.ROLES.includes(role)) {
      console.error(`\n  "${role}" is not a role. Pick one of: ${Auth.ROLES.join(', ')}\n`);
      exit(1);
    }

    if (Auth.findByUsername(username)) {
      console.error(`\n  "${username}" already exists. Pick another, or reset`);
      console.error('  their password from the Staff screen instead.\n');
      exit(1);
    }

    const password = await askHidden(rl, '  password : ', 'password');
    const problem = Auth.passwordProblem(password);
    if (problem) {
      console.error(`\n  ${problem}\n`);
      exit(1);
    }

    const confirm = await askHidden(rl, '  again    : ', 'password again');
    if (password !== confirm) {
      console.error('\n  Those do not match. Nothing was created.\n');
      exit(1);
    }

    /* Optional, and the last prompt — so a piped caller may simply stop here
       rather than being forced to supply a trailing blank line. */
    const hint = piped && piped.length === 0
      ? ''
      : await ask(rl, '  hint (optional, press Enter to skip): ', 'hint');
    if (hint) {
      console.log('');
      console.log('  Note: the hint is shown to anyone who types this username on');
      console.log('  the login screen. Keep it vague enough to be useless to them.');
    }

    const id = await Auth.createUser({
      username, name, role, password, hint: hint || null
    });

    console.log('');
    console.log(`  Created #${id}  ${username}  (${role})`);
    console.log('');
    if (existing === 0) {
      console.log('  Start the server and sign in:');
      console.log('    npm start');
      console.log('');
    }
  } finally {
    rl.close();
    DB.close();
  }
}

main().catch((err) => {
  console.error('\n  Failed:', err.message, '\n');
  exit(1);
});
