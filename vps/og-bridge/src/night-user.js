#!/usr/bin/env node
/* ==========================================================================
   Enrol somebody for night mode.                          [night-user.js]
   --------------------------------------------------------------------------
     node vps/og-bridge/src/night-user.js

   The sibling of snapshot-user.js, for /night's own accounts. Asks for a
   username, a ROLE and a password (twice, not echoed), makes a new
   authenticator secret, and prints:

     - the line for OG_NIGHT_USERS in og-bridge's Coolify environment. If this
       terminal already has OG_NIGHT_USERS set (paste the current value in
       first), the printed list is that list with this person added — or
       replaced, when the username is already there;
     - the otpauth:// address, as text and as a QR code, for the person's
       authenticator app.

   THE ROLE decides what they see at night: owner and manager see today's
   numbers and everybody's requests; staff see stock, customers, orders and
   their own requests, and never the money.

   Nothing is written to disk and nothing is sent anywhere. The secret is
   shown once: whoever sees this terminal can make codes, so clear it after.
   OG_VAULT_KEY is never needed here and never goes to the VPS.
   ========================================================================== */
import { hashPassword, newTotpSecret, totpStep, hotp, base32Decode } from './snapshot-auth.js';
import { ask, qrText, nightProblem, mergeNightUsers, otpUri, NIGHT_ROLES } from './enrol.js';

const user = (await ask('Username (e.g. sara): ')).toLowerCase();
const role = (await ask(`Role (${NIGHT_ROLES.join(' / ')}): `)).toLowerCase();
const pw = await ask('Password (12 characters or more, not shown): ', { hidden: true });
const problem = nightProblem({ user, role, password: pw });
if (problem) { console.error(problem); process.exit(1); }
const again = await ask('Same password again: ', { hidden: true });
if (again !== pw) { console.error('The two passwords are not the same.'); process.exit(1); }

const secret = newTotpSecret();
const now = Date.now();
/* The secret must make a code the door itself accepts before anything is
   shown — a secret that did not would lock this person out. */
if (totpStep(secret, hotp(base32Decode(secret), Math.floor(now / 30000)), now) === null) {
  console.error('Internal check failed: the new secret does not verify. Nothing was produced.');
  process.exit(2);
}
const entry = { user, role, scrypt: await hashPassword(pw), totpSecret: secret };
const list = mergeNightUsers(process.env.OG_NIGHT_USERS, entry);
const uri = otpUri('OG Night', user, secret);

console.log('\n1. Put this in OG_NIGHT_USERS in og-bridge\'s Coolify environment' +
  (list.length > 1 ? ` (${list.length} people — the list you had, with ${user} added):` : ':') + '\n');
console.log('OG_NIGHT_USERS=' + JSON.stringify(list));
console.log('\n2. Scan this with the authenticator app on ' + user + '\'s phone:\n');
const qr = qrText(uri);
if (qr) console.log(qr + '\n');
else console.log('   (js/codes.js not found — use the address below)\n');
console.log('   ' + uri);
console.log('\n   Or type this setup key into the app by hand: ' + secret.replace(/(.{4})/g, '$1 ').trim());
console.log('\n3. Redeploy og-bridge, open https://shop.ogsports1.com/night and sign in');
console.log('   with the password and the 6-digit code the app shows.');
console.log('\nThe secret is shown only here. Clear this terminal when done.');
