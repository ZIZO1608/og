#!/usr/bin/env node
/* ==========================================================================
   Enrol somebody for the owner's snapshot.              [snapshot-user.js]
   --------------------------------------------------------------------------
     node vps/og-bridge/src/snapshot-user.js

   Asks for a username and a password (twice, not echoed), makes a new
   authenticator secret, and prints:

     - the ONE line to add to OG_SNAPSHOT_USERS in Coolify (a JSON list — to
       add a second person, put both objects in one list);
     - the otpauth:// address, as text and as a QR code drawn in this
       terminal, to scan with Google Authenticator, Microsoft Authenticator,
       2FAS or any TOTP app.

   The QR is drawn by the shop's own encoder (js/codes.js, "the ONE encoder")
   when this runs from the repository; if that file is not there the text
   address is enough — most apps take it typed in as a "setup key".

   Nothing is written to disk and nothing is sent anywhere. The secret is
   shown once: whoever sees this terminal can make codes, so clear it after.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { hashPassword, newTotpSecret, totpStep } from './snapshot-auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Input without an echo on a TTY; plain lines when piped (for a test). */
async function ask(q, { hidden = false } = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    if (!ask.lines) {
      const chunks = [];
      for await (const c of stdin) chunks.push(c);
      ask.lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    }
    stdout.write(q + '\n');
    return (ask.lines.shift() || '').trim();
  }
  stdout.write(q);
  return new Promise((ok) => {
    let buf = '';
    stdin.setRawMode(hidden);
    stdin.resume();
    stdin.setEncoding('utf8');
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); return ok(buf.trim()); }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
      if (!hidden) { /* echoed by the terminal itself */ }
    };
    stdin.on('data', on);
  });
}

function qrText(text) {
  const file = resolve(HERE, '../../../js/codes.js');
  if (!existsSync(file)) return null;
  const ctx = { console };
  runInNewContext(readFileSync(file, 'utf8') + '\n;this.Codes = Codes;', ctx);
  const qr = ctx.Codes.qrMatrix(text, { ecc: 'M' });
  const q = 2, n = qr.size;
  const dark = (x, y) => x >= 0 && y >= 0 && x < n && y < n && !!qr.modules[y][x];
  const lines = [];
  /* Two rows per character with the half blocks, light on dark terminals:
     a module that is DARK is drawn as a space, so the code reads as black on
     white the way a camera expects. */
  for (let y = -q; y < n + q; y += 2) {
    let s = '';
    for (let x = -q; x < n + q; x++) {
      const top = dark(x, y), bottom = dark(x, y + 1);
      s += top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█';
    }
    lines.push(s);
  }
  return lines.join('\n');
}

const user = await ask('Username (the owner, e.g. abode): ');
if (!/^[a-z0-9._-]{2,32}$/i.test(user)) { console.error('A username is 2–32 letters, digits, dots, dashes or underscores.'); process.exit(1); }
const pw = await ask('Password (12 characters or more, not shown): ', { hidden: true });
if (pw.length < 12 || /^\d+$/.test(pw)) { console.error('Use at least 12 characters, and not only digits.'); process.exit(1); }
const again = await ask('Same password again: ', { hidden: true });
if (again !== pw) { console.error('The two passwords are not the same.'); process.exit(1); }

const secret = newTotpSecret();
const scrypt = await hashPassword(pw);
const label = encodeURIComponent('OG Snapshot:' + user);
const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('OG Snapshot')}&algorithm=SHA1&digits=6&period=30`;

/* Self-check before anything is shown: the secret must produce a code the
   door itself accepts. A secret that did not would lock the owner out. */
const { hotp, base32Decode } = await import('./snapshot-auth.js');
const now = Date.now();
if (totpStep(secret, hotp(base32Decode(secret), Math.floor(now / 30000)), now) === null) {
  console.error('Internal check failed: the new secret does not verify. Nothing was produced.');
  process.exit(2);
}

console.log('\n1. Add this to OG_SNAPSHOT_USERS in og-bridge\'s Coolify environment');
console.log('   (one JSON list; for a second person, put both objects in the same [ ]):\n');
console.log('OG_SNAPSHOT_USERS=' + JSON.stringify([{ user, scrypt, totpSecret: secret }]));
console.log('\n2. Scan this with the authenticator app on the owner\'s phone:\n');
const qr = qrText(uri);
if (qr) console.log(qr + '\n');
else console.log('   (js/codes.js not found — use the address below)\n');
console.log('   ' + uri);
console.log('\n   Or type this setup key into the app by hand: ' + secret.replace(/(.{4})/g, '$1 ').trim());
console.log('\n3. Redeploy og-bridge, open https://shop.ogsports1.com/snapshot and sign in');
console.log('   with the password and the 6-digit code the app shows.');
console.log('\nThe secret is shown only here. Clear this terminal when done.');
