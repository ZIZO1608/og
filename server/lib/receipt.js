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

/* receipt.* — the contact links and the exchange window. Safe to publish:
   these are the shop's own public handles, already printed on the paper this
   page is a copy of. Cost keys live under different prefixes and are not
   selected here. */
function receiptCfg() {
  const rows = get().prepare(
    `SELECT key, value FROM config WHERE key LIKE 'receipt.%'`
  ).all();
  const c = {};
  for (const r of rows) c[r.key.slice(8)] = r.value;
  return c;
}

/* The exchange deadline, computed from the sale's own timestamp and the
   shop's configured window — so the page states an actual date and time
   rather than making a customer add 48 hours to a receipt in their head,
   and so changing the window in Settings moves every page at once.

   Deliberately computed HERE and not in the browser: this page carries no
   JavaScript (see the header), and a countdown that needs a script is a
   countdown that shows nothing on a phone with an old browser. */
function exchange(sale, cfg) {
  const hours = Number(cfg.exchange_hours) || 48;
  const bought = new Date(sale.at);
  const until = new Date(bought.getTime() + hours * 3600e3);
  const left = until.getTime() - Date.now();
  return {
    hours,
    until,
    open: !sale.voided && left > 0,
    /* Rounded up: with 90 minutes left a customer should read "2 hours",
       not "1" — the number is a promise about a shop's opening hours, and
       rounding it down is the direction that makes the shop look late. */
    hoursLeft: Math.max(0, Math.ceil(left / 3600e3)),
    daysLeft: Math.max(0, Math.ceil(left / 86400e3))
  };
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

/* "Sun 31 Aug, 5:45 PM" — a deadline is the one date on this page somebody
   acts on, so it is spelled out with a weekday rather than left as digits to
   decode. Fixed en-GB, never the phone's locale: this must not come back in
   Arabic-Indic digits on an Arabic handset, the same rule the printed slip
   follows in js/receipt.js's western(). */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function deadlineText(d) {
  const h = d.getHours(), h12 = h % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ` +
         `${h12}:${mins} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* The shop's initials, for the monogram. Built from the name rather than
   shipped as an asset so this page has no image to fail to load — it is
   opened on strangers' phones on bad mobile data, years from now. */
function monogram(name) {
  const first = String(name || 'OG').trim().split(/\s+/).filter(Boolean)[0] || 'OG';
  /* The FIRST WORD's first two letters, not one letter from each of two
     words: "OG Sports" is a brand called OG that sells sports, so the mark
     is OG. Taking a letter per word gave "OS", which is not the name of
     anything. */
  return first.slice(0, 2).toUpperCase();
}
export function render(sale) {
  const s = shop();
  const rc = receiptCfg();
  const cur = sale.currency;
  const ex = exchange(sale, rc);

  /* The dollar value AT THE RATE OF THAT DAY, not today's. The customer's
     receipt must say the same thing in a year as it did on the day, which is
     the whole reason the rate is frozen into the row. */
  const usd = sale.fx_rate
    ? (sale.total / Math.pow(10, cur === 'USD' ? 2 : 0) / sale.fx_rate).toFixed(2)
    : null;

  const lines = sale.items.map(it => `
      <li class="it">
        <div class="it-n">${esc(it.name)}${it.size ? `<span class="sz">${esc(it.size)}</span>` : ''}</div>
        <div class="it-q">${it.qty} × ${amount(it.unit_price, cur)}</div>
        <div class="it-m">${amount(it.unit_price * it.qty, cur)}</div>
      </li>`).join('');

  /* Real tappable links, unlike the printed slip — that one shortens them to
     un-tappable text because paper is not a browser. This is a browser. */
  const link = (url, label) => url
    ? `<a class="lk" href="${esc(url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(label)}</a>`
    : '';
  const links = [
    link(rc.instagram, 'Instagram'),
    link(rc.telegram, 'Telegram'),
    link(rc.maps_url, 'Find the shop')
  ].filter(Boolean).join('');

  /* The one thing a customer actually opens this page to find out: can I
     still bring this back. Stated as a verdict with the deadline behind it,
     not as a policy sentence they have to apply to their own calendar. */
  const status = sale.voided
    ? '<div class="pill bad"><b>Cancelled</b><span>This sale was voided — it is not valid for exchange.</span></div>'
    : ex.open
      ? `<div class="pill ok"><b>Exchange open</b><span>${ex.hoursLeft} hour${ex.hoursLeft === 1 ? '' : 's'} left · until ${esc(deadlineText(ex.until))}</span></div>`
      : `<div class="pill done"><b>Exchange window closed</b><span>It ran ${ex.hours} hours, to ${esc(deadlineText(ex.until))}</span></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(sale.id)} · ${esc(s.name || 'OG Sports')}</title>
<!-- A receipt is not something a search engine should hold a copy of. -->
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0B0B0D">
<style>
  /* No JavaScript anywhere on this page, by design — see the module header.
     Everything below is static CSS, so it renders on a cheap phone with a
     browser nobody has updated in three years. */
  :root {
    color-scheme: light dark;
    --bg:#F2F2F4; --ink:#141417; --dim:#71717A; --paper:#FFFFFF;
    --line:#E4E4E7; --ok:#166534; --okbg:#DCFCE7;
    --bad:#991B1B; --badbg:#FEE2E2; --done:#52525B; --donebg:#EFEFF1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0B0B0D; --ink:#FAFAFA; --dim:#8A8A93; --paper:#141417;
      --line:#26262B; --ok:#4ADE80; --okbg:#0F2A18;
      --bad:#F87171; --badbg:#2B1416; --done:#A1A1AA; --donebg:#1C1C20;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin:0; padding:28px 14px 56px; background:var(--bg); color:var(--ink);
    font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; align-items:center;
  }

  /* The paper. Scalloped top and bottom edges from a repeating radial
     gradient — the silhouette of a torn thermal slip, and the reason this
     reads as a receipt before a word of it is read. Pure background paint,
     no mask or clip-path, so anything that cannot draw it degrades to a
     straight edge rather than to a hole. */
  .paper {
    position:relative; width:100%; max-width:390px; background:var(--paper);
    padding:30px 22px 26px; border:1px solid var(--line); border-top:0; border-bottom:0;
    animation:rise .45s cubic-bezier(.2,.7,.3,1) both;
  }
  .paper::before, .paper::after {
    content:""; position:absolute; left:-1px; right:-1px; height:11px;
    background:radial-gradient(circle at 7px 0, transparent 6.5px, var(--paper) 7px) 0 0/14px 11px repeat-x;
  }
  .paper::before { top:-10px; transform:rotate(180deg); }
  .paper::after  { bottom:-10px; }
  @keyframes rise { from { opacity:0; transform:translateY(14px); } }
  @media (prefers-reduced-motion: reduce) { .paper { animation:none; } }

  .mono {
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric:tabular-nums;
  }

  .brand { text-align:center; }
  .mark {
    width:54px; height:54px; margin:0 auto 12px; border-radius:16px;
    display:flex; align-items:center; justify-content:center;
    background:var(--ink); color:var(--paper);
    font-weight:800; font-size:21px; letter-spacing:.06em;
  }
  h1 { margin:0; font-size:20px; font-weight:800; letter-spacing:.14em; }
  .tag { margin:4px 0 0; font-size:12.5px; color:var(--dim); }

  .rule { border:0; border-top:1px dashed var(--line); margin:18px 0; }

  .pill {
    display:flex; flex-direction:column; gap:2px; padding:11px 14px;
    border-radius:11px; margin:16px 0 4px; font-size:12.5px;
  }
  .pill b { font-size:13.5px; letter-spacing:.02em; }
  .pill.ok   { background:var(--okbg);   color:var(--ok); }
  .pill.bad  { background:var(--badbg);  color:var(--bad); }
  .pill.done { background:var(--donebg); color:var(--done); }

  .meta { display:flex; justify-content:space-between; gap:14px; font-size:13px; padding:3px 0; }
  .meta span:first-child { color:var(--dim); }
  .inv { font-size:15px; letter-spacing:.06em; font-weight:700; }

  ul { list-style:none; margin:0; padding:0; }
  .it { display:grid; grid-template-columns:1fr auto; gap:2px 12px; padding:9px 0; border-bottom:1px solid var(--line); }
  .it:last-child { border-bottom:0; }
  .it-n { grid-column:1; font-weight:600; font-size:14.5px; }
  .it-q { grid-column:1; font-size:12.5px; color:var(--dim); }
  .it-m { grid-column:2; grid-row:1/3; align-self:center; text-align:end; white-space:nowrap; font-weight:600; }
  .sz {
    display:inline-block; margin-inline-start:7px; padding:1px 7px; border-radius:5px;
    background:var(--donebg); color:var(--dim); font-size:11.5px; font-weight:700; vertical-align:1px;
  }

  .tot { display:flex; justify-content:space-between; font-size:13.5px; padding:3px 0; color:var(--dim); }
  .tot.grand { color:var(--ink); font-size:15px; font-weight:800; align-items:baseline; padding-top:12px; }
  .grand .big { font-size:27px; letter-spacing:-.02em; }
  .fx { text-align:end; font-size:12px; color:var(--dim); margin-top:2px; }

  .links { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin:18px 0 4px; }
  .lk {
    flex:1 1 auto; text-align:center; min-width:92px; padding:9px 12px; border-radius:9px;
    border:1px solid var(--line); color:var(--ink); text-decoration:none;
    font-size:12.5px; font-weight:600;
  }
  .foot { text-align:center; font-size:11.5px; color:var(--dim); margin:14px 0 0; }
  .stamp {
    margin:0 auto 14px; width:fit-content; padding:6px 16px;
    border:2.5px solid var(--bad); color:var(--bad); border-radius:7px;
    font-weight:800; letter-spacing:.16em; font-size:14px;
    transform:rotate(-6deg);
  }
</style>
</head>
<body>
<div class="paper">

  ${sale.voided ? '<div class="stamp">CANCELLED</div>' : ''}

  <div class="brand">
    <div class="mark">${esc(monogram(s.name))}</div>
    <h1>${esc((s.name || 'OG SPORTS').toUpperCase())}</h1>
    ${s.tagline ? `<p class="tag">${esc(s.tagline)}</p>` : ''}
    ${s.branch_name ? `<p class="tag">${esc(s.branch_name)}</p>` : ''}
  </div>

  ${status}

  <hr class="rule">

  <div class="meta"><span>Invoice</span><b class="inv mono">${esc(sale.id)}</b></div>
  <div class="meta"><span>Date</span><span class="mono">${when(sale.at)}</span></div>
  ${sale.cashier_name ? `<div class="meta"><span>Served by</span><span>${esc(sale.cashier_name.split(' ')[0])}</span></div>` : ''}
  ${sale.customer_name ? `<div class="meta"><span>Customer</span><span>${esc(sale.customer_name)}</span></div>` : ''}

  <hr class="rule">

  <ul>${lines}</ul>

  <hr class="rule">

  <div class="tot"><span>Subtotal</span><span class="mono">${amount(sale.subtotal, cur)}</span></div>
  ${sale.discount ? `<div class="tot"><span>Discount</span><span class="mono">− ${amount(sale.discount, cur)}</span></div>` : ''}
  <div class="tot grand"><span>TOTAL</span><span class="big mono">${amount(sale.total, cur)} ${esc(cur)}</span></div>
  ${usd ? `<div class="fx mono">≈ $${usd} at ${nf(sale.fx_rate)} / $</div>` : ''}

  ${links ? `<div class="links">${links}</div>` : ''}

  <p class="foot">
    ${esc(rc.policy_en || 'Exchange within ' + ex.hours + ' hours with this receipt.')}<br>
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
<meta name="theme-color" content="#0B0B0D">
<style>
  :root { color-scheme: light dark; --bg:#F2F2F4; --ink:#141417; --dim:#71717A; --line:#E4E4E7; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0B0B0D; --ink:#FAFAFA; --dim:#8A8A93; --line:#26262B; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
         background:var(--bg); color:var(--ink); padding:24px; text-align:center; }
  .m { width:54px; height:54px; margin:0 auto 16px; border-radius:16px; border:2px dashed var(--line);
       display:flex; align-items:center; justify-content:center; font-size:24px; color:var(--dim); }
  h1 { font-size:19px; margin:0 0 8px; }
  p { color:var(--dim); margin:0 auto; max-width:34ch; }
</style></head>
<body><div>
  <div class="m">?</div>
  <h1>Receipt not found</h1>
  <p>This link does not match any invoice. Check the code on your receipt, or bring it into the shop.</p>
</div></body></html>`;
}
