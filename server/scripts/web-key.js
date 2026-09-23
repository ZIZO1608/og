/* ==========================================================================
   OG SYSTEM — the website's key, and the one line the cloud needs   [web-key.js]
   --------------------------------------------------------------------------
   The website carries ONE key and shows it at two doors:

     1. the shop's own door, GET https://<shop>/api/ext/products and the rest
        of /api/ext/, which compares it with OG_WEB_API_KEY in server/.env;
     2. the cloud door in Supabase (server/supabase/030_web_orders.sql), where
        orders are left while the laptop is shut. That door keeps only the
        SHA-256 of the key, in web.settings, so the key itself is never stored
        in the cloud.

   This prints the line of SQL for the second door. It never writes .env and
   never prints a key it did not make.

   Usage:
     npm run web:key              the SQL line for the OG_WEB_API_KEY in server/.env
     npm run web:key -- --new     make a new key: printed ONCE, with the SQL line
   ========================================================================== */

import { createHash, randomBytes } from 'node:crypto';
import { maybe, mask, envFilePath } from '../lib/env.js';

const MIN = 24;
const MAX = 256;

const sha = (k) => createHash('sha256').update(k, 'utf8').digest('hex');
const sqlLine = (k) =>
  `insert into web.settings (key, value) values ('key_sha256', '${sha(k)}')\n` +
  `  on conflict (key) do update set value = excluded.value, updated_at = now();`;

if (process.argv.includes('--new')) {
  const key = randomBytes(24).toString('hex');
  console.log(`
A new website key (shown this once — copy it now):

    ${key}

1. Put it in ${envFilePath()} as
       OG_WEB_API_KEY=${key}
   and restart the shop (the panel's Restart), so /api/ext/ accepts it.

2. Run this in the Supabase SQL editor, AFTER 030_web_orders.sql:

${sqlLine(key)}

3. Give the key to the website's developer, with the Supabase project URL and
   the publishable key. The key goes on the website's SERVER, never in a page
   a browser downloads.
`);
  process.exit(0);
}

const key = maybe('OG_WEB_API_KEY');
if (!key) {
  console.log(`OG_WEB_API_KEY is not set in ${envFilePath()}.
Run  npm run web:key -- --new  to make one.`);
  process.exit(1);
}
if (key.length < MIN || key.length > MAX) {
  console.log(`OG_WEB_API_KEY (${mask(key)}) is ${key.length} characters; the cloud door takes ${MIN} to ${MAX}.
Run  npm run web:key -- --new  to make a longer one, and give the website the new key.`);
  process.exit(1);
}

console.log(`The website key in server/.env is ${mask(key)}.
Run this in the Supabase SQL editor, AFTER 030_web_orders.sql:

${sqlLine(key)}
`);
