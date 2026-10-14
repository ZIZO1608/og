#!/usr/bin/env node
/* ==========================================================================
   SHIP — one command from "I changed something" to "it is live"
   --------------------------------------------------------------------------
       ship "what changed"        commit everything, push to GitHub, wait
                                  until the shop on the VPS runs it
       ship                       the same, and it asks for the words
       ship status                where things are (npm run vps -- status)

   It is ship.cmd in the project folder, because PowerShell on this machine
   refuses .ps1 scripts (npm.ps1 included) and a .cmd is not one.

   GitHub is the whole road. The VPS takes main from GitHub by itself every
   minute (deploy/og-shop/autodeploy.sh), builds it with the tests inside,
   and puts the old one back if the new one does not come up healthy — so a
   push is a deploy, and the line from this computer to the VPS (which breaks
   for hours) is not needed. The waiting at the end is only to say when.

   It commits EVERYTHING that has changed (git add -A), like the launcher's
   Publish button, and shows the list first so nothing goes unseen.
   ========================================================================== */
import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIP = readFileSync(join(ROOT, 'deploy', 'og-shop', 'ship-paths.txt'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/* The folder belongs to a Windows account from another machine, so plain git
   refuses it ("dubious ownership"). Trusting THIS folder, for these calls. */
function git(...args) {
  const r = spawnSync('git', ['-c', `safe.directory=${ROOT.replace(/\\/g, '/')}`, '-C', ROOT, ...args],
    { encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const say = (s = '') => console.log(s);
const stop = (s) => { console.error('\n  ✗ ' + s + '\n'); exit(1); };

function vps(args) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [join(ROOT, 'server', 'scripts', 'vps.js'), ...args],
      { cwd: join(ROOT, 'server'), stdio: 'inherit', windowsHide: true });
    p.on('close', (code) => done(code));
  });
}

const words = argv.slice(2);
if (words[0] === 'status') exit(await vps(['status']));
const yes = words.includes('-y');
let message = words.filter((w) => w !== '-y').join(' ').trim();

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
if (!branch) stop('This folder is not a git repository.');
if (branch !== 'main') stop(`You are on "${branch}", not main. Only main goes live:  git checkout main`);

const changed = git('status', '--porcelain').out;
git('fetch', '--quiet', 'origin', 'main');
const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD').out) || 0;

if (!changed && !ahead) {
  say('\n  Nothing new to publish — GitHub already has everything here.');
  say('  Where the shop is:  ship status\n');
  exit(0);
}

if (changed) {
  say('\n  These changes go to GitHub, and from there to the shop:\n');
  for (const l of changed.split(/\r?\n/).slice(0, 40)) say('    ' + l);
  const n = changed.split(/\r?\n/).length;
  if (n > 40) say(`    … and ${n - 40} more`);
  const rl = createInterface({ input: stdin, output: stdout });
  if (!message) message = (await rl.question('\n  What changed? (one line)  ')).trim();
  if (!message) { rl.close(); stop('A commit needs a line saying what changed.'); }
  if (!yes) {
    const a = (await rl.question(`\n  Publish these ${n} change(s) as "${message}"? [Y/n]  `)).trim().toLowerCase();
    if (a && a !== 'y' && a !== 'yes') { rl.close(); say('\n  Nothing published.\n'); exit(0); }
  }
  rl.close();
  if (git('add', '-A').code !== 0) stop('git add failed.');
  const c = git('commit', '-q', '-m', message);
  if (c.code !== 0) stop('The commit failed:\n' + (c.err || c.out));
  say(`\n  ✓ committed  ${git('rev-parse', '--short', 'HEAD').out}  ${message}`);
}

const before = git('rev-parse', 'origin/main').out;
const pull = git('pull', '--quiet', '--rebase', '--autostash', 'origin', 'main');
if (pull.code !== 0) {
  stop('Someone else changed the same lines on GitHub, and git could not put the two together.\n' +
       '    Nothing was pushed. Open the folder in VS Code to settle it, or ask Claude.\n\n' + (pull.err || pull.out));
}
const push = git('push', '--quiet', 'origin', 'HEAD:main');
if (push.code !== 0) stop('The push to GitHub failed:\n' + (push.err || push.out));
const head = git('rev-parse', '--short=12', 'HEAD').out;
say(`  ✓ on GitHub  ${head}`);

const shopChanged = git('diff', '--quiet', before, 'HEAD', '--', ...SHIP).code !== 0;
if (!shopChanged) {
  say('\n  Nothing the shop runs changed (notes, tests, the launcher) — the shop keeps running as it is.\n');
  exit(0);
}

say('\n  The VPS takes it from GitHub by itself within a minute or two. Waiting to see it live …');
const code = await vps(['deploy', '--ref', 'HEAD']);
if (code !== 0) {
  say('\n  GitHub has it either way. If this computer simply could not reach the VPS to watch,');
  say('  the VPS still deploys it by itself; look again later with:  ship status\n');
  exit(1);
}
say('\n  ✓ live on https://shop.ogsports1.com\n');
