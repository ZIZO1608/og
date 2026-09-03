/* ==========================================================================
   OG SYSTEM — make the certificate                         [make-cert.js]
   --------------------------------------------------------------------------
       cd server && npm run cert

   Writes a self-signed certificate covering localhost, this machine's name
   and every LAN address it currently answers on, so the till can serve
   HTTPS and the phones can have notifications, the camera scanner and the
   installable app. See lib/tls.js for why self-signed is the right trade
   here and what it costs.

   RUN IT AGAIN whenever the machine's IP changes — the server says so at
   startup when it notices. Every device then shows the warning once more,
   which is the honest price of the address having moved.

   No npm packages: the certificate is made by openssl, which is already on
   this machine as part of Git for Windows. If it is genuinely missing the
   script says where to get it rather than half-working.
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { certNames, lanAddresses } from '../lib/net.js';
import * as TLS from '../lib/tls.js';

const DAYS = 825;   /* the longest a manually trusted certificate is accepted */

const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const warn = (s) => `  \x1b[33m!\x1b[0m ${s}`;
const dim  = (s) => `  \x1b[2m${s}\x1b[0m`;

/* Git for Windows ships openssl but does not always put it on the Windows
   PATH, so the usual places are tried before giving up. */
function findOpenssl() {
  const named = process.env.OG_OPENSSL;
  const tries = (named ? [named] : []).concat([
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    '/usr/bin/openssl'
  ]);
  for (const exe of tries) {
    if (exe !== 'openssl' && !existsSync(exe)) continue;
    const r = spawnSync(exe, ['version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return { exe, version: String(r.stdout).trim() };
  }
  return null;
}

const found = findOpenssl();
console.log('');
console.log('\x1b[1m  OG SYSTEM — certificate\x1b[0m');
console.log('');

if (!found) {
  console.log(warn('openssl was not found on this machine.'));
  console.log(dim('It ships with Git for Windows — install that, or set OG_OPENSSL'));
  console.log(dim('to the full path of openssl.exe and run this again.'));
  console.log('');
  process.exit(1);
}
console.log(tick(`using ${found.version}`));

const names = certNames();
const sanList = names.dns.map((d) => 'DNS:' + d).concat(names.ip.map((i) => 'IP:' + i));
if (!sanList.length) {
  console.log(warn('no addresses to put in the certificate — is the network down?'));
  process.exit(1);
}

TLS.ensureDir();
const r = spawnSync(found.exe, [
  'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', String(DAYS), '-nodes',
  '-keyout', TLS.KEY, '-out', TLS.CERT,
  '-subj', `/CN=OG System (${hostname()})`,
  '-addext', 'subjectAltName=' + sanList.join(','),
  '-addext', 'basicConstraints=critical,CA:FALSE',
  '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
  '-addext', 'extendedKeyUsage=serverAuth'
], { encoding: 'utf8', windowsHide: true });

if (r.status !== 0) {
  console.log(warn('openssl could not write the certificate.'));
  console.log(dim(String(r.stderr || r.error || '').split('\n').slice(0, 6).join('\n    ')));
  process.exit(1);
}

const expires = new Date(Date.now() + DAYS * 86400000).toISOString();
writeFileSync(TLS.META, JSON.stringify({
  made: new Date().toISOString(), expires, days: DAYS,
  dns: names.dns, ip: names.ip, host: hostname()
}, null, 2));

console.log(tick('certificate written to server/data/certs/'));
console.log(dim('covers  ' + sanList.join('  ')));
console.log(dim('expires ' + expires.slice(0, 10)));
console.log('');

const port = Number(process.env.OG_HTTPS_PORT || 8443);
console.log('  Restart the server, then open:');
console.log(`    \x1b[1mhttps://localhost:${port}\x1b[0m`);
for (const n of lanAddresses().filter((x) => !x.note)) {
  console.log(`    \x1b[1mhttps://${n.address}:${port}\x1b[0m   (from any other device on this wifi)`);
}
console.log('');
console.log(dim('The first time each device opens it the browser warns that the'));
console.log(dim('certificate is not from a known authority — that is expected, it is'));
console.log(dim('this machine\'s own. Press Advanced, then continue. Once. After that'));
console.log(dim('notifications, the camera scanner and "install app" all work.'));
console.log('');
