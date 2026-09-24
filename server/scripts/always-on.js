#!/usr/bin/env node
/* ==========================================================================
   OG SYSTEM — does this laptop open the shop BY ITSELF?      npm run always-on
   --------------------------------------------------------------------------
   The shop's laptop is its server. After a power cut — Aleppo has them daily —
   or a Windows update that restarts it at night, the shop comes back only if
   every one of these is true:

     1. STARTS WITH WINDOWS  OG System.exe is in this Windows account's
                             "run at sign-in" list, pointing at THIS folder,
                             and not switched off in Task Manager's Startup tab.
     2. NEVER SLEEPS         on mains power: no sleep, no hibernate. A till
                             that dozes off after 30 idle minutes is a closed
                             shop to every phone and to the website.
     3. THE LID              closing it does nothing on mains power (a laptop
                             with a separate screen is often shut).
     4. SIGNS IN BY ITSELF   Windows logs into the account after a restart,
                             so step 1 happens with nobody at the keyboard.
     5. THE BIOS             "power on after power loss". No program can read
                             that; it is on the checklist this prints.

   1–3 this script sets (--apply), with no administrator prompt: the Run key
   is this account's own, and powercfg writes the active plan's values without
   elevation (tried on a throwaway copy of a plan, 24 Sep 2026). 4 it only
   CHECKS: turning it on means giving Windows the account's password, which is
   a person's decision and a person's typing (Sysinternals Autologon keeps it
   encrypted; see the checklist). It never reads the password — only whether a
   plain-text one is lying in the registry, by NAME, which is worth a warning.

     node scripts/always-on.js            check and print, change nothing
     node scripts/always-on.js --apply    turn 1–3 on
     node scripts/always-on.js --undo     take 1 away again (the power plan is
                                          left alone: never sleeping is harmless)
     node scripts/always-on.js --json     one line for the control panel

   Exit: 0 all of 1–4 true · 4 something this script can turn on · 1 a
   person is needed (4 is off) · 2 not Windows.

   Test switches, never set on a shop: OG_AUTOSTART_NAME (the Run value's
   name) and OG_POWER_SCHEME (a plan GUID instead of the active one).
   ========================================================================== */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const EXE = join(ROOT, 'OG System.exe');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
/* Task Manager's Startup tab writes here: a first byte of 02 is on, 03 off.
   Deleting our value there puts it back to the default, which is on. */
const APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const WINLOGON = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
const NAME = process.env.OG_AUTOSTART_NAME || 'OGSystem';
const SCHEME = process.env.OG_POWER_SCHEME || 'SCHEME_CURRENT';

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* ---------------------------------------------------------------- 1. startup */

function startup() {
  const q = run('reg', ['query', RUN_KEY, '/v', NAME]);
  if (q.code !== 0) return { state: 'missing' };
  const m = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(q.out);
  const target = m ? m[1].trim().replace(/^"|"$/g, '').replace(/"\s.*$/, '') : '';
  if (resolve(target).toLowerCase() !== resolve(EXE).toLowerCase()) return { state: 'elsewhere', target };
  if (!existsSync(EXE)) return { state: 'exe_missing', target };
  const a = run('reg', ['query', APPROVED_KEY, '/v', NAME]);
  const bytes = /REG_BINARY\s+([0-9A-F]+)/i.exec(a.out);
  if (a.code === 0 && bytes && /^03/i.test(bytes[1])) return { state: 'switched_off', target };
  return { state: 'ok', target };
}

function setStartup() {
  const w = run('reg', ['add', RUN_KEY, '/v', NAME, '/t', 'REG_SZ', '/d', '"' + EXE + '"', '/f']);
  if (w.code !== 0) return w.out.trim() || 'reg add failed';
  run('reg', ['delete', APPROVED_KEY, '/v', NAME, '/f']);   // absent is fine
  return null;
}

function unsetStartup() {
  run('reg', ['delete', RUN_KEY, '/v', NAME, '/f']);
  run('reg', ['delete', APPROVED_KEY, '/v', NAME, '/f']);
}

/* ------------------------------------------------------ 2 + 3. the power plan */

/* powercfg prints "Current AC Power Setting Index: 0x…" then the DC one — in
   the machine's own language, so the words cannot be matched on an Arabic
   Windows. The last two hex values of the answer are AC then DC, whatever
   the language; a setting the plan does not carry answers with no values. */
function acValue(sub, setting) {
  const q = run('powercfg', ['-query', SCHEME, sub, setting]);
  if (q.code !== 0) return null;
  const hex = q.out.match(/0x[0-9a-f]{8}/gi) || [];
  if (hex.length < 2) return null;
  return parseInt(hex[hex.length - 2], 16);
}

const POWER = [
  { id: 'sleep', sub: 'SUB_SLEEP', setting: 'STANDBYIDLE', want: 0 },
  { id: 'hibernate', sub: 'SUB_SLEEP', setting: 'HIBERNATEIDLE', want: 0 },
  /* 0 = do nothing. A plan without a lid setting (a desktop, or a custom
     plan that hides it) reports nothing, and that is not a fault. */
  { id: 'lid', sub: 'SUB_BUTTONS', setting: 'LIDACTION', want: 0, optional: true }
];

function power() {
  const out = {};
  for (const p of POWER) {
    const v = acValue(p.sub, p.setting);
    out[p.id] = v === null ? (p.optional ? 'none' : 'unknown') : v === p.want ? 'ok' : 'on';
    if (v !== null && p.id !== 'lid') out[p.id + 'Minutes'] = Math.round(v / 60);
  }
  return out;
}

function setPower() {
  const errs = [];
  for (const p of POWER) {
    const w = run('powercfg', ['-setacvalueindex', SCHEME, p.sub, p.setting, String(p.want)]);
    if (w.code !== 0 && !p.optional) errs.push(p.id + ': ' + w.out.trim());
  }
  /* Values written to the ACTIVE plan take effect when it is made active
     again; a test plan is left inactive. */
  if (SCHEME === 'SCHEME_CURRENT') run('powercfg', ['-setactive', 'SCHEME_CURRENT']);
  return errs;
}

/* ------------------------------------------------------ 4. signs in by itself */

function autoSignIn() {
  const q = run('reg', ['query', WINLOGON, '/v', 'AutoAdminLogon']);
  const m = /REG_SZ\s+(\S+)/.exec(q.out);
  const on = q.code === 0 && m && m[1].trim() === '1';
  /* NAMES only: `reg query` of the key would print a stored password with the
     rest. GetValueNames() never touches a value's data. */
  const n = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-Item 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon').GetValueNames() -contains 'DefaultPassword'"]);
  const plain = /True/i.test(n.out);
  return { state: on ? 'ok' : 'off', plainPassword: on && plain };
}

/* ------------------------------------------------------------------- the run */

if (process.platform !== 'win32') {
  if (JSON_OUT) console.log('OG_ALWAYS_JSON ' + JSON.stringify({ platform: process.platform }));
  else console.log('  This is for the shop\'s Windows laptop; nothing to check on ' + process.platform + '.');
  process.exit(2);
}

if (args.has('--undo')) {
  unsetStartup();
  console.log('  OG System no longer starts with Windows on this account.');
  console.log('  (The power plan was left as it is.)');
}

if (args.has('--apply')) {
  const e1 = setStartup();
  const e2 = setPower();
  if (e1) console.log('  ! could not add OG System to the sign-in list: ' + e1);
  for (const e of e2) console.log('  ! could not change the power plan: ' + e);
  if (!e1 && !e2.length) console.log('  Turned on: starts with Windows, never sleeps on mains, the lid does nothing on mains.');
}

const facts = { startup: startup(), power: power(), signIn: autoSignIn(), exe: EXE };
const fixable = facts.startup.state !== 'ok' || facts.power.sleep === 'on' ||
  facts.power.hibernate === 'on' || facts.power.lid === 'on';
const person = facts.signIn.state !== 'ok' || facts.signIn.plainPassword;
const code = fixable ? 4 : person ? 1 : 0;

if (JSON_OUT) {
  console.log('OG_ALWAYS_JSON ' + JSON.stringify({ ...facts, code }));
  process.exit(code);
}

const tick = (ok) => (ok ? '  ✓ ' : '  ✗ ');
const S = facts.startup;
console.log('');
console.log('  Does this laptop open the shop by itself after a power cut?');
console.log('');
console.log(tick(S.state === 'ok') + 'Starts with Windows' + ({
  ok: '',
  missing: ' - not in the sign-in list',
  elsewhere: ' - points at another folder: ' + S.target,
  exe_missing: ' - OG System.exe is not in ' + ROOT,
  switched_off: ' - switched off in Task Manager > Startup apps'
})[S.state]);
const P = facts.power;
console.log(tick(P.sleep === 'ok') + 'Never sleeps on mains power' +
  (P.sleep === 'on' ? ' - sleeps after ' + P.sleepMinutes + ' min' : P.sleep === 'unknown' ? ' - could not read the power plan' : ''));
console.log(tick(P.hibernate === 'ok') + 'Never hibernates on mains power' +
  (P.hibernate === 'on' ? ' - hibernates after ' + P.hibernateMinutes + ' min' : P.hibernate === 'unknown' ? ' - could not read the power plan' : ''));
console.log(P.lid === 'none' ? '  - The lid: this power plan has no lid setting' :
  tick(P.lid === 'ok') + 'Closing the lid does nothing on mains power');
console.log(tick(facts.signIn.state === 'ok' && !facts.signIn.plainPassword) + 'Windows signs in by itself' +
  (facts.signIn.state !== 'ok' ? ' - a person has to turn this on (below)'
    : facts.signIn.plainPassword ? ' - but the password is stored in plain text (below)' : ''));
console.log('  ? The BIOS powers on after a power cut - no program can see this (below)');
console.log('');
if (fixable) console.log('  To turn on the first ones:  npm run always-on -- --apply   (no administrator needed)');
if (facts.signIn.state !== 'ok' || facts.signIn.plainPassword) {
  console.log('  Windows signing in by itself - once, by a person, with the account\'s password:');
  console.log('    Sysinternals "Autologon" (learn.microsoft.com/sysinternals/downloads/autologon)');
  console.log('    keeps the password encrypted. Run it, type the password, press Enable.');
  if (facts.signIn.plainPassword) {
    console.log('    A plain-text DefaultPassword is in the registry now: Autologon replaces it');
    console.log('    with an encrypted one when it is enabled.');
  }
}
console.log('  The BIOS - once, by a person: restart, open the BIOS setup (usually F2 or Del),');
console.log('    and set "Restore on AC power loss" (or "AC recovery", "Power on after power');
console.log('    fail") to Power On. Without it the laptop waits for its button after a cut.');
console.log('  And a small UPS in front of the laptop and the router carries the shop across');
console.log('    the short cuts without any of the above being needed.');
console.log('');
process.exit(code);
