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
   (Partner.webPrices, lib/weborders.js) — the one print key, named alone.

   shop.public_url (panel polish, 24 Sep 2026) is the shop's address on the
   internet — https://shop.ogsports1.com since day shift 07. Telegram's job
   links are built on it, the launcher draws it as the "from anywhere" QR, and
   go-live.md has told the owner to set it in Settings since night shift 04,
   when this list still refused it. Checked by publicUrlProblem() below. */
export const CONFIG_WRITABLE = /^receipt\.|^print\.unit_price$|^customer\.|^loyalty\.|^reminders\.|^shop\.(name|address|city|branch_name|phone|tz_minutes|public_url)$|^alerts\.(quiet_from|quiet_to|urgent)$|^label\.(default_preset|transport|printer_host|printer_port|stations|density|speed|gap_mm|max_batch|lease_minutes|calibrate_cmd)$/;

/* What is wrong with a value for shop.public_url, or null when it will do.
   Strict, because the value goes into a QR code taped to a counter and into a
   link on somebody's phone: an https origin and NOTHING after it — no path, no
   query, no fragment, no name:password — named by a real domain rather than an
   IP address, localhost or a .local name, because a public link that only
   opens on the shop's wifi is not public. One trailing slash is allowed, since
   that is how a browser's address bar hands it over, and every reader strips
   it. Empty means "not set", which is a real answer: Telegram then carries no
   link rather than a wrong one. */
export function publicUrlProblem(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const bad = 'shop.public_url must be an https address with nothing after the name, like https://shop.ogsports1.com';
  if (/[\s\\]/.test(v) || v.includes('?') || v.includes('#') || v.includes('@')) return bad;
  let u;
  try { u = new URL(v); } catch { return bad; }
  if (u.protocol !== 'https:') return bad;
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return bad;
  /* The parser forgives a lot ("https:shop.com", "https://SHOP.com:443"), so
     what was typed must BE the origin, give or take the one slash. */
  if (v.toLowerCase().replace(/\/$/, '') !== u.origin.toLowerCase()) return bad;
  const host = u.hostname;
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return 'shop.public_url must be a name, not an IP address.';
  if (host === 'localhost' || host.endsWith('.local') || !host.includes('.')) {
    return 'shop.public_url must be the shop’s address on the internet, not a name only this network knows.';
  }
  return null;
}

/* The first reason a batch of updates may not be saved, or null. One bad key
   refuses the whole batch: nothing is written unless all of it can be. */
export function configRefusal(updates) {
  for (const k of Object.keys(updates || {})) {
    if (!CONFIG_WRITABLE.test(k)) return `${k} cannot be changed here.`;
    /* Every receipt, every label and the login screen print it. The Branding
       field already refuses a blank one; this is the same rule at the door. */
    if (k === 'shop.name' && !String(updates[k] ?? '').trim()) return 'The shop needs a name.';
    if (k === 'shop.public_url') {
      const p = publicUrlProblem(updates[k]);
      if (p) return p;
    }
  }
  return null;
}
