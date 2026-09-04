/* ==========================================================================
   OG SYSTEM — trust this machine's own certificate            [trust-cert.js]
   --------------------------------------------------------------------------
   `npm run cert` makes a certificate nobody vouches for, so the browser on
   THIS machine — the till — opened https://localhost:8443 onto a full-page
   red "Your connection is not private" every single morning. The launcher
   opened that address on purpose (it is the one that gets notifications and
   the camera) and the first thing a cashier saw was a warning about
   attackers. Read as "the shop is broken", every time.

   Windows keeps a list of certificates it trusts. Putting our own in it,
   once, is what makes Chrome and Edge open the secure address with a plain
   padlock and no page in between. It needs administrator — the list is
   machine-wide, which is exactly what a till shared by three people wants.

   Three modes, chosen so the launcher can run it every morning for free:

     --check    read-only, no prompt. Exit 0 = trusted, 4 = not yet, 1 = no
                certificate has been made (`npm run cert` first).
     (default)  trust it. Asks for administrator through the normal Windows
                prompt, then checks its own work.
     --remove   take it out again, e.g. after `npm run cert` was re-run and
                the old one is now just clutter.

   Only this machine. A phone or another PC still shows the warning once,
   and "Advanced → continue" is still the answer there: a phone will not
   install a certificate that is not a certificate AUTHORITY, and making
   this one an authority would mean anyone who copied server/data/certs/
   could sign for any website on every device that trusted it. One press
   per phone is the cheaper half of that bargain.

   Windows only. Everything it does goes through certutil, which ships with
   Windows; on another OS it says so and exits 0 so nothing upstream stops.
   ========================================================================== */

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { execPath, env, platform, argv } from 'node:process';
import * as TLS from '../lib/tls.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(argv.slice(2));
const MODE = args.has('--check') ? 'check' : args.has('--remove') ? 'remove' : 'install';
const LOG = (() => { const i = argv.indexOf('--log'); return i > -1 ? argv[i + 1] : null; })();

/* When run elevated it runs in a hidden window, so everything it says also
   goes to a file the un-elevated parent prints afterwards — the same trick
   hardware.js uses, for the same reason: a UAC prompt followed by silence
   tells nobody anything. */
function say(s = '') { console.log(s); if (LOG) { try { appendFileSync(LOG, s + '\n'); } catch { /* the exit code still tells the truth */ } } }
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim  = (s) => `\x1b[2m${s}\x1b[0m`;
const tick = (s) => `  \x1b[32mOK\x1b[0m    ${s}`;
const warn = (s) => `  \x1b[33mNOTE\x1b[0m  ${s}`;
const bad  = (s) => `  \x1b[31mNO\x1b[0m    ${s}`;
const hint = (s) => `        ${dim(s)}`;

if (platform !== 'win32') {
  say(warn('Trusting the certificate automatically is a Windows step; on this OS add'));
  say(hint(`${TLS.CERT} to the system's trusted certificates by hand.`));
  process.exit(0);
}

if (!TLS.have()) {
  say(bad('No certificate has been made yet, so there is nothing to trust.'));
  say(hint('Run:  npm run cert   (in the server folder), then start the shop again.'));
  process.exit(1);
}

let cert;
try { cert = new X509Certificate(readFileSync(TLS.CERT)); }
catch (e) {
  say(bad(`The certificate file could not be read: ${e.message}`));
  say(hint('Run  npm run cert  to make a fresh one.'));
  process.exit(1);
}
/* certutil addresses a certificate by its SHA-1 thumbprint, no colons. */
const THUMB = cert.fingerprint.replace(/:/g, '');
const NAME = cert.subject.replace(/^CN=/, '');

function certutil(...a) {
  const r = spawnSync('certutil', a, { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

/* Reading the machine store needs no elevation, so the morning check is
   free. The store is "Root" — Trusted Root Certification Authorities — on
   the LOCAL MACHINE, so it holds for every Windows account on this till. */
function trusted() { return certutil('-store', 'Root', THUMB).ok; }

function isAdmin() {
  /* `net session` is the classic probe: it errors unless elevated. */
  const r = spawnSync('net', ['session'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

function psq(s) { return String(s).replace(/'/g, "''"); }

function elevate(verb) {
  const log = resolve(env.TEMP || env.TMP || HERE, `og-trust-cert-${Date.now()}.log`);
  try { writeFileSync(log, ''); } catch { /* fine, printed later if it exists */ }
  const script =
    'try {\n' +
    `  $p = Start-Process -FilePath '${psq(execPath)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '"${psq(resolve(HERE, 'trust-cert.js'))}"','${verb}','--log','"${psq(log)}"'\n` +
    '  exit $p.ExitCode\n' +
    '} catch { exit 99 }';
  say('  Windows will ask permission — trusting a certificate is a machine-wide change.');
  say('');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 300000 });
  if (existsSync(log)) {
    try { const t = readFileSync(log, 'utf8').replace(/\r?\n$/, ''); if (t) say(t); } catch { /* exit code below */ }
  }
  if (r.status === 99) {
    say('');
    say(warn('Nothing changed — the permission prompt was refused or closed.'));
    say(hint('The shop still opens; the browser will show its certificate warning once.'));
    say(hint('Press "Advanced", then "Proceed to localhost". Or run this again:  npm run cert:trust'));
    say('');
    return 1;
  }
  return r.status === 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ modes */

if (MODE === 'check') {
  if (trusted()) { say(tick(`Windows trusts the shop's certificate (${NAME}).`)); process.exit(0); }
  say(warn('Windows does not trust the shop\'s certificate yet, so the browser will'));
  say(hint('open on a red "not private" page. This can be fixed from here, once.'));
  process.exit(4);
}

if (MODE === 'remove') {
  if (!trusted()) { say(tick('The certificate was not in the trusted list; nothing to remove.')); process.exit(0); }
  if (!isAdmin()) process.exit(elevate('--remove'));
  const r = certutil('-delstore', 'Root', THUMB);
  if (r.ok && !trusted()) { say(tick('Removed from the trusted list.')); process.exit(0); }
  say(bad('certutil could not remove it:')); say(hint(r.out.trim().split('\n').slice(-2).join(' ')));
  process.exit(1);
}

/* install */
if (trusted()) {
  say(tick(`Already trusted: ${NAME}.`));
  say(hint(`https://localhost:${Number(env.OG_HTTPS_PORT || 8443)} opens with no warning on this machine.`));
  process.exit(0);
}
if (!isAdmin()) process.exit(elevate('--install'));

const r = certutil('-addstore', '-f', 'Root', TLS.CERT);
if (r.ok && trusted()) {
  say(tick(`Windows now trusts ${bold(NAME)} on this machine.`));
  say(hint(`Chrome and Edge open https://localhost:${Number(env.OG_HTTPS_PORT || 8443)} with a padlock and no warning.`));
  say(hint('Already-open browser windows need closing and reopening once.'));
  say(hint('Phones and other PCs still see the warning once — press Advanced, then continue.'));
  process.exit(0);
}
say(bad('certutil could not add the certificate:'));
say(hint(r.out.trim().split('\n').slice(-3).join(' | ')));
say(hint('Try again from an administrator command prompt:  npm run cert:trust'));
process.exit(1);
