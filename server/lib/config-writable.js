/* ==========================================================================
   Which config keys PUT /api/config may write
   --------------------------------------------------------------------------
   An allow-list, not "any key in the table": the route exists for the
   Settings cards, not as a general "edit the config table" backdoor. The
   history of each opening is on the route in server/index.js.

   THE SHOP'S NAME, ADDRESS AND CITY WERE NEVER ON IT (found 15 Sep 2026).
   Settings → Save changes sends all three in the same request as the loyalty
   rate, so the server refused the WHOLE save with "shop.name cannot be
   changed here.", the exchange rate — posted only after that save succeeds —
   never went out, and the page reloaded the old values over what had been
   typed. The only sign was a red toast. The list's own comment had said the
   shop.* fields it left out "already have a writer"; they did not.

   server/test/config-keys.test.js reads the browser's source for every key
   it sends through this route and checks each one against THIS list — the
   one the route uses — which is the test that would have caught it.
   ========================================================================== */

/* alerts.* (052) is the office's order alerts on Telegram: when the shop shuts
   and opens, and which of them go out at any hour. Named key by key — the
   prefix alone would let anything under it be written.
   print.unit_price is what one printed piece costs a WEBSITE customer
   (Partner.webPrices, lib/weborders.js) — the one print key, named alone. */
export const CONFIG_WRITABLE = /^receipt\.|^print\.unit_price$|^customer\.|^loyalty\.|^reminders\.|^shop\.(name|address|city|branch_name|phone|tz_minutes)$|^alerts\.(quiet_from|quiet_to|urgent)$|^label\.(default_preset|transport|printer_host|printer_port|stations|density|speed|gap_mm|max_batch|lease_minutes|calibrate_cmd)$/;

/* The first reason a batch of updates may not be saved, or null. One bad key
   refuses the whole batch: nothing is written unless all of it can be. */
export function configRefusal(updates) {
  for (const k of Object.keys(updates || {})) {
    if (!CONFIG_WRITABLE.test(k)) return `${k} cannot be changed here.`;
    /* Every receipt, every label and the login screen print it. The Branding
       field already refuses a blank one; this is the same rule at the door. */
    if (k === 'shop.name' && !String(updates[k] ?? '').trim()) return 'The shop needs a name.';
  }
  return null;
}
