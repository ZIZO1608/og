/* ==========================================================================
   OG SYSTEM — the public copy of a receipt
   --------------------------------------------------------------------------
   The one page in this system with no login in front of it. A customer scans
   the QR on their paper receipt and lands here, on a phone that has never seen
   the shop's network, possibly years later, possibly on bad mobile data.

   That shapes every decision:

   1. SERVER-RENDERED, NO JAVASCRIPT. Not a single script tag. The app is 17,000
      lines of JS that assumes it is signed in; none of it belongs on a page a
      stranger opens. Plain HTML also means this still works on a cheap phone
      with a browser nobody updates.

   2. NO COST, NO PROFIT, NO MARGIN, EVER. There is no permission check to lean
      on here — everyone who has the link is "allowed". So the query selects the
      columns a customer may see and nothing else. Widening that SELECT is how
      a supplier price ends up public.

   3. FOUND ONLY BY THE TOKEN. Never by invoice number. Looking one up by a
      guessable id would turn one scanned receipt into the whole sales history.

   4. IT MUST NOT LOOK BROKEN. This is the shop's face on a customer's phone,
      long after the sale. It is styled, it is readable on a small screen, and
      it says which shop it came from.
   ========================================================================== */

import { get } from './db.js';

/* ------------------------------------------------------------------ lookup */

/* The columns a member of the public may read. Everything about what the shop
   paid, and everything about the cashier beyond their first name, is absent by
   construction rather than deleted afterwards. */
export function byToken(token) {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;

  const sale = get().prepare(
    `SELECT s.id, s.at, s.customer_name, s.currency,
            s.subtotal, s.discount, s.total, s.fx_rate, s.fx_base, s.voided,
            u.name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.public_token = ?`
  ).get(token);

  if (!sale) return null;

  /* No unit_cost. A customer's own receipt is exactly the wrong place to
     publish what the shop paid for the shoes. */
  sale.items = get().prepare(
    `SELECT name, size, qty, unit_price
       FROM sale_items WHERE sale_id = ? ORDER BY id`
  ).all(sale.id);

  return sale;
}

/* ---------------------------------------------------------------- shop info */

function shop() {
  const rows = get().prepare(
    `SELECT key, value FROM config WHERE key LIKE 'shop.%'`
  ).all();
  const c = {};
  for (const r of rows) c[r.key.slice(5)] = r.value;
  return c;
}

/* ---------------------------------------------------------------- rendering */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }

function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

/* Minor units out, whole units in. SYP has minor_exp 0 so it passes straight
   through; USD is in cents and has to come out of them. */
function amount(minor, code) {
  const exp = get().prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  const e = exp ? exp.minor_exp : 0;
  return nf(minor / Math.pow(10, e));
}

function when(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function render(sale) {
  const s = shop();
  const cur = sale.currency;

  /* The dollar value AT THE RATE OF THAT DAY, not today's. The customer's
     receipt must say the same thing in a year as it did on the day, which is
     the whole reason the rate is frozen into the row. */
  const usd = sale.fx_rate
    ? (sale.total / Math.pow(10, cur === 'USD' ? 2 : 0) / sale.fx_rate).toFixed(2)
    : null;

  const lines = sale.items.map(it => `
      <tr>
        <td class="n">${esc(it.name)}${it.size ? ` <span class="sz">${esc(it.size)}</span>` : ''}</td>
        <td class="q">×${it.qty}</td>
        <td class="m">${amount(it.unit_price * it.qty, cur)}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(sale.id)} · ${esc(s.name || 'OG Sports')}</title>
<!-- A receipt is not something a search engine should hold a copy of. -->
<meta name="robots" content="noindex,nofollow">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #F4F4F5; color: #18181B;
    display: flex; justify-content: center;
  }
  @media (prefers-color-scheme: dark) { body { background: #09090B; color: #FAFAFA; } }
  .paper {
    width: 100%; max-width: 380px; background: #FFFFFF; color: #18181B;
    border-radius: 14px; padding: 26px 22px 22px;
    box-shadow: 0 1px 3px rgb(0 0 0 / .12), 0 8px 28px rgb(0 0 0 / .08);
  }
  @media (prefers-color-scheme: dark) {
    .paper { background: #141417; color: #FAFAFA; box-shadow: none; border: 1px solid #27272A; }
    .rule { border-color: #27272A !important; }
    .muted { color: #A1A1AA !important; }
  }
  h1 { font-size: 21px; letter-spacing: .04em; margin: 0; font-weight: 800; }
  .tag { font-size: 12.5px; margin: 2px 0 0; }
  .muted { color: #71717A; }
  .center { text-align: center; }
  .rule { border: 0; border-top: 1px dashed #D4D4D8; margin: 16px 0; }
  .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 5px 0; vertical-align: top; }
  .q { text-align: center; white-space: nowrap; padding-inline: 8px; color: #71717A; }
  .m { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sz { color: #71717A; font-size: 12.5px; }
  .tot { display: flex; justify-content: space-between; font-size: 13.5px; padding: 3px 0; }
  .tot.grand { font-size: 22px; font-weight: 800; padding-top: 10px; }
  .foot { font-size: 12px; margin-top: 18px; }
  .void {
    background: #2B1416; color: #F87171; border: 1px solid #7F2226;
    border-radius: 8px; padding: 10px 12px; font-weight: 700;
    text-align: center; margin-bottom: 16px;
  }
</style>
</head>
<body>
<div class="paper">

  ${sale.voided ? '<div class="void">THIS SALE WAS CANCELLED</div>' : ''}

  <div class="center">
    <h1>${esc((s.name || 'OG SPORTS').toUpperCase())}</h1>
    <p class="tag muted">${esc(s.tagline || '')}</p>
    <p class="tag muted">${esc(s.address || '')}</p>
  </div>

  <hr class="rule">

  <div class="meta"><span class="muted">Invoice</span><b>${esc(sale.id)}</b></div>
  <div class="meta"><span class="muted">Date</span><span>${when(sale.at)}</span></div>
  ${sale.cashier_name ? `<div class="meta"><span class="muted">Served by</span><span>${esc(sale.cashier_name.split(' ')[0])}</span></div>` : ''}
  ${sale.customer_name ? `<div class="meta"><span class="muted">Customer</span><span>${esc(sale.customer_name)}</span></div>` : ''}

  <hr class="rule">

  <table>${lines}</table>

  <hr class="rule">

  <div class="tot"><span class="muted">Subtotal</span><span>${amount(sale.subtotal, cur)}</span></div>
  ${sale.discount ? `<div class="tot"><span class="muted">Discount</span><span>− ${amount(sale.discount, cur)}</span></div>` : ''}
  <div class="tot grand"><span>TOTAL</span><span>${amount(sale.total, cur)} ${esc(cur)}</span></div>
  ${usd ? `<div class="tot"><span></span><span class="muted">≈ $${usd} at ${nf(sale.fx_rate)} / $</span></div>` : ''}

  <hr class="rule">

  <p class="foot center muted">
    Exchange within 7 days with this receipt.<br>
    Thank you — ${esc(s.name || 'OG Sports')}
  </p>

</div>
</body>
</html>`;
}

export function notFound() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt not found</title>
<meta name="robots" content="noindex,nofollow">
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
         background:#F4F4F5; color:#18181B; padding:24px; text-align:center; }
  @media (prefers-color-scheme: dark){ body{ background:#09090B; color:#FAFAFA; } }
  h1 { font-size:19px; margin:0 0 8px; }
  p { color:#71717A; margin:0; max-width:34ch; }
</style></head>
<body><div>
  <h1>Receipt not found</h1>
  <p>This link does not match any invoice. Check the code on your receipt, or bring it into the shop.</p>
</div></body></html>`;
}
