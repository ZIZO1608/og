/* ==========================================================================
   OG SYSTEM — the customer's page: a receipt, and a parcel's journey
   --------------------------------------------------------------------------
   The one page in this system with no login in front of it. A customer scans
   the QR on their paper receipt, or taps the link in a WhatsApp message, and
   lands here — on a phone that has never seen the shop's network, possibly on
   bad mobile data, possibly years later.

   That shapes every decision:

   1. COMPLETE WITH NO JAVASCRIPT, BETTER WITH IT. Everything a customer needs —
      where the parcel is, what is left to pay, what is in it — is in this
      server's HTML. The one script (lib/track-page-client.js) only ADDS: the
      page updates itself when the order moves, relative times, and "Notify
      me" through Web Push. It carried no script at all until the owner asked
      for a live page and a buzz in the pocket, neither of which HTML can do;
      a browser that runs nothing still gets the whole page, as before.

   2. NO COST, NO PROFIT, NO MARGIN, EVER. There is no permission check to lean
      on here — everyone who has the link is "allowed". So the query selects the
      columns a customer may see and nothing else. Widening that SELECT is how
      a supplier price ends up public. The live refresh fetches THIS page again
      rather than a JSON feed, so there is still only one shape to keep clean.

   3. FOUND ONLY BY THE TOKEN. Never by invoice number from outside.
      bySaleId() exists for lib/tracking.js inside the server and no route
      may ever call it.

   4. IT IS THE SHOP'S FACE. Always dark, the shop's own mark, lime only where
      it means something (lib/track-page-css.js). Words in both languages live
      in lib/track-page-words.js, shared with the notifications.
   ========================================================================== */

import { get } from './db.js';
import { STR } from './track-page-words.js';
import { CSS } from './track-page-css.js';
import { CLIENT } from './track-page-client.js';
import * as Reviews from './reviews.js';

/* ------------------------------------------------------------------ lookup */

/* The columns a member of the public may read. Everything about what the shop
   paid, and everything about the cashier beyond their first name, is absent by
   construction rather than deleted afterwards. `where` is one of the two fixed
   strings below, never text from a request. */
function load(where, value) {
  const sale = get().prepare(
    `SELECT s.id, s.at, s.customer_name, s.currency, s.payment, s.public_token,
            s.subtotal, s.discount, s.total, s.fx_rate, s.fx_base, s.voided,
            u.name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${where}`
  ).get(value);

  if (!sale) return null;

  /* A delivery order's own two facts: where it has got to, and what is still
     owed on it. NOT the address, NOT the phone and NOT the shop's transfer
     details — this link can be forwarded to anybody. */
  sale.order = sale.payment === 'order'
    ? get().prepare(
        `SELECT d.status, d.method, d.company_name, d.city, d.country,
                d.fee, d.fee_mode, d.out_at, d.closed_at, d.tracking_no,
                (SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount_order ELSE -amount_order END), 0)
                   FROM order_payments WHERE sale_id = d.sale_id) AS paid,
                (SELECT COALESCE(SUM(due_minor), 0)
                   FROM order_returns WHERE sale_id = d.sale_id) AS returned
           FROM deliveries d WHERE d.sale_id = ?`
      ).get(sale.id) || null
    : null;

  /* WHAT HAS HAPPENED TO IT, IN ORDER. Money only as amounts and dates — no
     method, no reference, no account number. The ids are here only to give
     each event a stable key (events()); they are never printed. */
  sale.track = !sale.order ? null : {
    payments: get().prepare(
      `SELECT id, at, kind, amount_order FROM order_payments
        WHERE sale_id = ? ORDER BY at, id`
    ).all(sale.id),
    returns: get().prepare(
      `SELECT id, at, outcome FROM order_returns WHERE sale_id = ? ORDER BY at, id`
    ).all(sale.id)
  };

  /* No unit_cost. A customer's own receipt is exactly the wrong place to
     publish what the shop paid for the shoes. */
  sale.items = get().prepare(
    `SELECT name, size, qty, unit_price
       FROM sale_items WHERE sale_id = ? ORDER BY id`
  ).all(sale.id);

  return sale;
}

export function byToken(token) {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
  return load('s.public_token = ?', token);
}

/* The server's own use only (lib/tracking.js). See rule 3. */
export function bySaleId(id) {
  if (!id) return null;
  return load('s.id = ?', String(id));
}

/* The country as the shop named it in Settings, not as a two-letter code. */
function countryName(code) {
  if (!code) return '';
  const row = get().prepare("SELECT value FROM config WHERE key = 'delivery.countries'").get();
  try {
    const hit = JSON.parse(row ? row.value : '[]').find((c) => c && c.id === code);
    return hit ? (hit.en || hit.id) : code;
  } catch { return code; }
}

/* ---------------------------------------------------------------- shop info */

function shop() {
  const rows = get().prepare(`SELECT key, value FROM config WHERE key LIKE 'shop.%'`).all();
  const c = {};
  for (const r of rows) c[r.key.slice(5)] = r.value;
  return c;
}

export function shopName() { return shop().name || 'OG Sports'; }

/* receipt.* — the contact links and the exchange window. Safe to publish:
   the shop's own public handles, already printed on the paper this page
   copies. Cost keys live under other prefixes and are not selected. */
function receiptCfg() {
  const rows = get().prepare(`SELECT key, value FROM config WHERE key LIKE 'receipt.%'`).all();
  const c = {};
  for (const r of rows) c[r.key.slice(8)] = r.value;
  return c;
}

/* The exchange deadline from the sale's own timestamp and the configured
   window — an actual date, so nobody adds 48 hours in their head. */
function exchange(sale, cfg) {
  const hours = Number(cfg.exchange_hours) || 48;
  const until = new Date(new Date(sale.at).getTime() + hours * 3600e3);
  const left = until.getTime() - Date.now();
  return {
    hours, until,
    open: !sale.voided && left > 0,
    /* Rounded up: with 90 minutes left a customer should read "2 hours". */
    hoursLeft: Math.max(0, Math.ceil(left / 3600e3))
  };
}

/* WHAT IS STILL OWED, WORKED OUT THE WAY THE SERVER WORKS IT OUT — including
   what came back (`returned` is the same due_minor orders.js reduces by). */
export function moneyOf(sale) {
  const o = sale.order;
  if (!o) return null;
  const fee = o.fee_mode === 'invoice' ? (o.fee || 0) : 0;
  const due = Math.max(0, sale.total + fee - (o.returned || 0));
  const paid = o.paid || 0;
  return { fee, due, paid, left: Math.max(0, due - paid) };
}

/* ---------------------------------------------------------------- helpers */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]); }
function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
/* A digit run inside an Arabic sentence, isolated so bidi cannot drag the
   currency code to the wrong end of it. */
const iso = (s) => `⁨${s}⁩`;

/* Minor units out, whole units in. */
function amount(minor, code) {
  const exp = get().prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  return nf(minor / Math.pow(10, exp ? exp.minor_exp : 0));
}

function when(iso8601) {
  const d = new Date(iso8601);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* "Sun 31 Aug, 5:45 PM", fixed en-GB digits on every handset — the printed
   slip's rule (js/receipt.js western()). */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function deadlineText(d) {
  const h = d.getHours(), h12 = h % 12 || 12;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ` +
         `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* The shop's initials, drawn behind the logo so a page whose image never
   arrives still says whose it is. "OG Sports" → OG: the first word's letters. */
function monogram(name) {
  const first = String(name || 'OG').trim().split(/\s+/).filter(Boolean)[0] || 'OG';
  return first.slice(0, 2).toUpperCase();
}
function initials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
}
/* One steady colour per product name — the app's colour-block idea, not a picture. */
function hue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

const ICONS = {
  bag: 'M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 10v.01M17.5 14v.01',
  truck: 'M2 6h12v9H2zM14 9h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  back: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  check: 'M5 12.5l4.2 4.2L19 7',
  alert: 'M12 8v5M12 16.5v.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  x: 'M6 6l12 12M18 6L6 18',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  bellOff: 'M6 16v-5a6 6 0 0 1 9.4-4.9M18 11v5l2 2H8M10 20a2 2 0 0 0 4 0M3 3l18 18',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  insta: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5v.01',
  tg: 'M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l8-6',
  vol: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9.5l5 5M22 9.5l-5 5',
  star: 'M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z',
  send: 'M4 12l16-8-6 16-2.6-6.4zM11.4 13.6L20 4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  /* the Home Screen guide */
  plus: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  down: 'M12 5v14M6 13l6 6 6-6'
};
function svg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
}

/* ------------------------------------------------------------------ events

   THE JOURNEY, oldest first — the page, the live refresh and every push
   notification read this one list. Each row carries a KEY that names the
   event and nothing about how it is worded, so "has this been said yet"
   (lib/tracking.js, push_seen) survives a change of language or wording. An
   order that goes out, fails and goes out again has two different out_at
   stamps, so it is news twice, which is right. Nothing here is estimated. */
export function events(sale, lang) {
  const o = sale.order;
  if (!o) return [];
  const L = STR[lang === 'en' ? 'en' : 'ar'];
  const cur = sale.currency;
  const t = sale.track || { payments: [], returns: [] };
  const rows = [{ key: 'placed', at: sale.at, icon: 'bag', tone: 'dim', text: L.placed }];

  for (const p of t.payments) {
    rows.push(p.kind === 'refund'
      ? { key: 'pay:' + p.id, at: p.at, icon: 'back', tone: 'warn', text: `${L.refunded} · ${iso(amount(p.amount_order, cur) + ' ' + cur)}` }
      : { key: 'pay:' + p.id, at: p.at, icon: 'cash', tone: 'ok', text: `${L.payment} · ${iso(amount(p.amount_order, cur) + ' ' + cur)}` });
  }
  if (o.out_at) {
    rows.push({
      key: 'out:' + o.out_at, at: o.out_at, icon: 'truck', tone: 'go',
      text: o.method === 'driver' ? L.outDriver : o.company_name ? L.outWith(o.company_name) : L.onRoad
    });
  }
  for (const r of t.returns) rows.push({ key: 'ret:' + r.id, at: r.at, icon: 'back', tone: 'warn', text: L.cameBack });
  if (o.closed_at) {
    const failed = o.status === 'failed';
    rows.push({
      key: `closed:${o.status}:${o.closed_at}`, at: o.closed_at,
      icon: failed ? 'alert' : 'check', tone: failed ? 'bad' : 'done',
      text: failed ? L.failedStep : o.method === 'pickup' ? L.collected : L.delivered
    });
  }
  /* A voided sale has no stamp of its own, so it sorts last and shows no time. */
  if (sale.voided) rows.push({ key: 'void', at: null, icon: 'x', tone: 'bad', text: L.voidRow });

  rows.sort((a, b) => String(a.at || '~').localeCompare(String(b.at || '~')));
  return rows;
}

/* ------------------------------------------------------------ push words

   A notification is one sentence the page already shows, with the order
   number in front: the customer is told the newest event, the office is told
   the same thing with the customer's name when their account may read it.
   `hello` is the first one, sent the moment somebody turns notifications on,
   so they see on their own screen that it worked. */
export function pushText(sale, lang, key, { audience = 'track', more = 0, customer = false, hello = false } = {}) {
  const lng = lang === 'en' ? 'en' : 'ar';
  const L = STR[lng];
  const name = shopName();
  const base = { lang: lng, dir: L.dir, at: new Date().toISOString(), icon: '/assets/icon-192.png' };
  const staffTitle = `${name} · ${L.staffTitle}`;

  if (audience === 'staff' && hello) return { ...base, title: staffTitle, body: L.staffOn, url: '/#deliveries', tag: 'og-staff' };
  if (!sale) return null;

  const url = audience === 'track'
    ? `/i/${sale.public_token}${lng === 'en' ? '?lang=en' : ''}`
    : '/#deliveries';
  const tag = 'order-' + sale.id;
  /* `always`: the customer is looking at the page when they turn this on, and
     this one notification is the proof — the worker shows it even so. */
  if (hello) return { ...base, title: name, body: L.pushOn(iso(sale.id)), url, tag, always: true };

  const rows = events(sale, lng);
  const row = rows.find((r) => r.key === key) || rows[rows.length - 1];
  if (!row) return null;

  let text = row.key === 'placed' && audience === 'staff' ? L.newOrder : row.text;
  const m = moneyOf(sale);
  /* A parcel leaving with money still to pay says how much: it is the one
     number the customer needs ready at the door. */
  if (audience === 'track' && row.key.startsWith('out:') && m && m.left) {
    text += ' · ' + L.toPayShort(iso(amount(m.left, sale.currency) + ' ' + sale.currency));
  }
  const bits = [iso(sale.id)];
  if (audience === 'staff' && customer && sale.customer_name) bits.push(sale.customer_name);
  bits.push(text);
  if (more > 0) bits.push(L.andMore(more));
  /* THE ARRIVAL ASKS FOR THE REVIEW, once, and only while there is none: the
     moment a customer is most likely to answer is the moment the parcel is in
     their hands. A "Rate it" button on the notification opens the form. */
  const ask = audience === 'track' && row.key.startsWith('closed:delivered:') && !Reviews.forSale(sale.id);
  if (ask) bits.push(L.rateAsk);
  return {
    ...base, title: audience === 'staff' ? staffTitle : name, body: bits.join(' · '), url, tag,
    ...(ask ? { actions: [{ action: 'rate', title: L.rateBtn }], links: { rate: url + '#review' }, sticky: true } : {})
  };
}

/* The office hears about a review the moment it is written: the stars, the
   customer's name for an account that may read customers, and the words. */
export function reviewText(sale, review, lang, { customer = false, edited = false } = {}) {
  const lng = lang === 'en' ? 'en' : 'ar';
  const L = STR[lng];
  const bits = [iso(sale.id), '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)];
  if (customer && sale.customer_name) bits.push(sale.customer_name);
  let body = bits.join(' · ');
  const words = String(review.comment || '');
  if (words) body += '\n“' + words.slice(0, 140) + (words.length > 140 ? '…' : '') + '”';
  return {
    lang: lng, dir: L.dir, at: new Date().toISOString(), icon: '/assets/icon-192.png',
    title: `${shopName()} · ${edited ? L.reviewEdited : L.reviewNew}`,
    body, url: '/#reviews', tag: 'review-' + sale.id
  };
}

/* ----------------------------------------------------------------- render */

export function render(sale, lang, opts = {}) {
  const s = shop();
  const rc = receiptCfg();
  const en = lang === 'en';
  const L = STR[en ? 'en' : 'ar'];
  const cur = sale.currency;
  const ex = exchange(sale, rc);
  const o = sale.order;
  const money = moneyOf(sale);
  const name = s.name || 'OG Sports';
  const token = sale.public_token;
  const rows = o ? events(sale, en ? 'en' : 'ar') : [];
  const stamped = rows.filter((r) => r.at);
  const lastAt = stamped.length ? stamped[stamped.length - 1].at : sale.at;

  /* The dollar value AT THE RATE OF THAT DAY, never today's. */
  const usd = sale.fx_rate
    ? (sale.total / Math.pow(10, cur === 'USD' ? 2 : 0) / sale.fx_rate).toFixed(2)
    : null;

  /* ---- where it has got to. The rail's rule is Desk.rail's twin in
     js/desk.js: change it in both places or neither. */
  const done = !!o && o.status === 'delivered';
  const failed = !!o && o.status === 'failed';
  const back = !!o && (failed || !!(sale.track && sale.track.returns.length));
  const at = !o || sale.voided ? 0 : done ? 3 : o.status === 'out' ? 2 : money.paid > 0 ? 1 : 0;

  const rail = !o ? '' : `
    <div class="rail${sale.voided ? ' off' : back ? ' back' : ''}" style="--p:${sale.voided ? 0 : (at / 3).toFixed(3)}">
      <div class="rail-track"><i class="rail-fill"></i></div>
      <ol>${L.steps.map((label, i) => {
        const st = sale.voided ? 'off' : i < at ? 'on' : i === at ? (done ? 'on' : 'now') : 'off';
        return `<li class="st ${st}"><b>${svg(['bag', 'cash', 'truck', 'check'][i])}</b><span>${esc(label)}</span></li>`;
      }).join('')}</ol>
    </div>`;

  const headline = !o
    ? (sale.voided ? L.cancelled : L.thanksHero)
    : sale.voided ? L.stCancel
    : done ? (o.method === 'pickup' ? L.collected : L.stDone)
    : o.status === 'out' ? L.stOut
    : failed ? L.stBack
    : o.method === 'pickup' ? L.stPick
    : L.stPrep;

  const where = o ? [o.city, countryName(o.country)].filter(Boolean).join(', ') : '';
  const eyebrow = o
    ? [where, L.via[o.method || 'driver'] || L.via.driver].filter(Boolean).join(' · ')
    : [sale.customer_name, sale.cashier_name ? `${L.servedBy} ${sale.cashier_name.split(' ')[0]}` : ''].filter(Boolean).join(' · ');

  const heroCls = ['card', 'hero', sale.voided ? 'is-void' : '', failed ? 'is-bad' : '', done ? 'is-done' : '']
    .filter(Boolean).join(' ');
  const hero = `<section class="${heroCls}" id="tpHero" data-live>
    <img class="hero-mark" src="/assets/logo.svg" alt="">
    <div class="hero-top">
      <span class="chip"><span>${esc(o ? L.invoice : L.receiptT)}</span><b class="mono" dir="ltr">${esc(sale.id)}</b></span>
      <span class="hero-date mono" dir="ltr">${esc(when(sale.at))}</span>
    </div>
    ${sale.voided ? `<div class="stamp">${esc(L.cancelled)}</div>` : ''}
    ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : '<p class="eyebrow"></p>'}
    <h1 class="headline">${esc(headline)}</h1>
    ${o ? rail : `<div class="big mono" dir="ltr">${amount(sale.total, cur)}<small>${esc(cur)}</small></div>`}
    ${o ? `<div class="hero-foot">
      <span class="upd">${svg('clock')}<span>${esc(L.updatedAt)}</span><span class="rel" data-at="${esc(lastAt)}"></span><span class="abs" dir="ltr">${esc(deadlineText(new Date(lastAt)))}</span></span>
      ${o.tracking_no ? `<span class="trk">${esc(L.track)} <b class="mono" dir="ltr">${esc(o.tracking_no)}</b></span>` : ''}
    </div>` : ''}
  </section>`;

  /* ---- what is left to pay */
  let moneyCard = '';
  if (o && !sale.voided) {
    const pct = money.due ? Math.min(100, Math.round(money.paid / money.due * 100)) : 100;
    const leftText = amount(money.left, cur) + ' ' + cur;
    const owed = money.left
      ? ((o.method === 'driver' || o.method === 'pickup') ? L.toPay(iso(leftText)) : L.toPaySend(iso(leftText)))
      : '';
    moneyCard = `<section class="card money ${money.left ? 'owes' : 'clear'}" id="tpMoney" data-live>
      <p class="label">${esc(money.left ? L.left : L.paidFull)}</p>
      <div class="big mono" dir="ltr">${money.left
        ? `${amount(money.left, cur)}<small>${esc(cur)}</small>`
        : `${svg('check')}<span>${amount(money.due, cur)}<small>${esc(cur)}</small></span>`}</div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <p class="sub">${esc(L.paidOf(iso(amount(money.paid, cur) + ' ' + cur), iso(amount(money.due, cur) + ' ' + cur)))}</p>
      ${owed ? `<p class="note">${esc(owed)}</p>` : ''}
    </section>`;
  }

  /* ---- the review, once it has ARRIVED. data-keep, never data-live: the
     card may hold a half-written comment, and the live refresh must not wipe
     it. The script reloads after a send, and a card appearing (the order just
     arrived) changes the page's region list, which reloads it too. Hidden
     until the script runs: every control on it needs the script. */
  let reviewCard = '';
  if (Reviews.canReview(sale)) {
    const rv = Reviews.forSale(sale.id);
    const tagWord = (t) => Reviews.TAG_WORDS[t][en ? 'en' : 'ar'];
    const form = (hidden) => `<form class="rv-form" id="tpRvForm" data-rating="${rv ? rv.rating : 0}"${hidden ? ' hidden' : ''} novalidate>
        <div class="rv-stars" role="group" aria-label="${esc(L.rvPick)}">${[1, 2, 3, 4, 5].map((n) =>
          `<button type="button" class="rv-star${rv && n <= rv.rating ? ' on' : ''}" data-rv-star="${n}" aria-label="${n}/5">${svg('star')}</button>`).join('')}</div>
        <p class="rv-word" id="tpRvWord" data-words="${esc(JSON.stringify(L.rvStars))}" data-pick="${esc(L.rvPick)}">${esc(rv ? L.rvStars[rv.rating - 1] : L.rvPick)}</p>
        <p class="rv-h">${esc(L.rvTagsH)}</p>
        <div class="rv-tags">${Reviews.TAGS.map((t) => {
          const on = !!(rv && rv.tags.includes(t));
          return `<button type="button" class="rv-tag${on ? ' on' : ''}" data-rv-tag="${t}" aria-pressed="${on}">${esc(tagWord(t))}</button>`;
        }).join('')}</div>
        <div class="rv-text"><textarea id="tpRvText" maxlength="600" rows="3" dir="auto" placeholder="${esc(L.rvCommentPh)}">${esc(rv ? rv.comment : '')}</textarea><span class="rv-count mono" id="tpRvCount">${rv ? rv.comment.length : 0}/600</span></div>
        <label class="rv-allow"><input type="checkbox" id="tpRvAllow"${rv && rv.allowWeb ? ' checked' : ''}><span><b>${esc(L.rvAllow.replace('{shop}', name))}</b><small>${esc(L.rvAllowSub)}</small></span></label>
        <button type="submit" class="btn btn-p" id="tpRvSend"${rv ? '' : ' disabled'}>${svg('send')}<span>${esc(L.rvSend)}</span></button>
      </form>`;
    reviewCard = rv
      ? `<section class="card review is-done" id="tpReview" data-keep hidden>
          <div class="rv-done-h"><span class="rv-badge">${svg('check')}</span><div><p class="n-t">${esc(L.rvThanks)}</p><p class="n-s">${esc(L.rvThanksSub)}</p></div></div>
          <div class="rv-shown" id="tpRvShown">
            <div class="rv-stars is-static" aria-label="${rv.rating}/5">${[1, 2, 3, 4, 5].map((n) => `<i class="rv-star${n <= rv.rating ? ' on' : ''}">${svg('star')}</i>`).join('')}</div>
            ${rv.tags.length ? `<div class="rv-tags is-static">${rv.tags.map((t) => `<span class="rv-tag on">${esc(tagWord(t))}</span>`).join('')}</div>` : ''}
            ${rv.comment ? `<blockquote class="rv-quote" dir="auto">${esc(rv.comment)}</blockquote>` : ''}
            ${rv.onWeb ? `<p class="rv-web">${svg('globe')}<span>${esc(L.rvOnWeb)}</span></p>` : ''}
            <button type="button" class="btn btn-g" data-rv-edit>${esc(L.rvEdit)}</button>
          </div>
          ${form(true)}
        </section>`
      : `<section class="card review" id="tpReview" data-keep hidden>
          <div class="card-h"><h2>${esc(L.rvYours)}</h2></div>
          <p class="rv-title">${esc(L.rvTitle)}</p>
          <p class="n-s">${esc(L.rvSub)}</p>
          ${form(false)}
        </section>`;
  }

  /* ---- Notify me: an empty card the script fills, because every state it
     can be in depends on the browser in the customer's hand. */
  const canPush = !!(o && !sale.voided && opts.vapidKey);
  const notify = canPush ? `<section class="card notify" id="tpNotify" hidden aria-live="polite"></section>` : '';

  /* ---- the journey, newest first: the question is "what moved since I looked" */
  const timeline = !o ? '' : `<section class="card time" id="tpTime" data-live>
    <div class="card-h"><h2>${esc(L.journey)}</h2><span class="count mono">${rows.length}</span></div>
    <ol class="tl">${rows.slice().reverse().map((r, i) => `
      <li class="tl-r tone-${r.tone}${i === 0 ? ' is-latest' : ''}" data-key="${esc(r.key)}">
        <span class="tl-i">${svg(r.icon)}</span>
        <div class="tl-b"><b>${esc(r.text)}</b>${r.at
          ? `<span class="when"><span class="rel" data-at="${esc(r.at)}"></span><span dir="ltr">${esc(deadlineText(new Date(r.at)))}</span></span>`
          : ''}</div>
        ${i === 0 && rows.length > 1 ? `<em class="latest">${esc(L.latest)}</em>` : ''}
      </li>`).join('')}
    </ol>
  </section>`;

  /* ---- what is in it, and the sums */
  const pieces = sale.items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const lines = sale.items.map((it) => `
      <li class="it">
        <span class="it-sq" style="--h:${hue(it.name)}">${esc(initials(it.name))}</span>
        <div class="it-n"><b>${esc(it.name)}</b><span>${it.size ? `<em class="sz">${esc(it.size)}</em>` : ''}<bdi dir="ltr">${it.qty} × ${amount(it.unit_price, cur)}</bdi></span></div>
        <b class="it-m mono" dir="ltr">${amount(it.unit_price * it.qty, cur)}</b>
      </li>`).join('');
  const itemsCard = `<section class="card items" id="tpItems" data-live>
    <div class="card-h"><h2>${esc(o ? L.whatsIn : L.items)}</h2><span class="count mono">${pieces}</span></div>
    <ul class="its">${lines}</ul>
    <div class="tots">
      <div class="tr"><span>${esc(L.subtotal)}</span><span class="mono" dir="ltr">${amount(sale.subtotal, cur)}</span></div>
      ${sale.discount ? `<div class="tr"><span>${esc(L.discount)}</span><span class="mono" dir="ltr">− ${amount(sale.discount, cur)}</span></div>` : ''}
      ${money && money.fee ? `<div class="tr"><span>${esc(L.shipping)}</span><span class="mono" dir="ltr">${amount(money.fee, cur)}</span></div>` : ''}
      ${o && o.returned ? `<div class="tr"><span>${esc(L.returnedLine)}</span><span class="mono" dir="ltr">− ${amount(o.returned, cur)}</span></div>` : ''}
      <div class="tr grand"><span>${esc(L.total)}</span><span class="mono" dir="ltr">${amount(money ? money.due : sale.total, cur)} <small>${esc(cur)}</small></span></div>
      ${usd ? `<div class="fx"><span dir="ltr">≈ $${usd}</span> ${esc(L.atRate(nf(sale.fx_rate)))}</div>` : ''}
    </div>
  </section>`;

  /* ---- can it still come back, and where the shop is */
  const pill = (tone, icon, title, sub) =>
    `<div class="pill ${tone}"><span class="p-i">${svg(icon)}</span><div><b>${esc(title)}</b><span>${esc(sub)}</span></div></div>`;
  const exPill = sale.voided
    ? pill('bad', 'x', L.cancelled, L.cancelledNote)
    : ex.open
      ? pill('ok', 'back', L.exOpen, `${L.exLeft(ex.hoursLeft)} · ${L.exUntil(iso(deadlineText(ex.until)))}`)
      : pill('done', 'clock', L.exShut, `${L.exRan(ex.hours)} · ${iso(deadlineText(ex.until))}`);
  /* Real tappable links — paper shortens them, this is a browser. */
  const link = (url, icon, label) => url
    ? `<a class="lk" href="${esc(url)}" rel="noopener noreferrer nofollow" target="_blank">${svg(icon)}<span>${esc(label)}</span></a>`
    : '';
  const links = [link(rc.instagram, 'insta', 'Instagram'), link(rc.telegram, 'tg', 'Telegram'), link(rc.maps_url, 'pin', L.findShop)]
    .filter(Boolean).join('');
  const extra = `<section class="card extra" id="tpExtra" data-live>${exPill}${links ? `<div class="links">${links}</div>` : ''}</section>`;

  const foot = `<footer class="foot">
    <p>${esc((en ? rc.policy_en : rc.policy_ar) || L.policy(ex.hours))}</p>
    <p>${esc(L.thanks)}<strong>${esc(name)}</strong></p>
  </footer>`;

  const sub = [s.tagline, s.branch_name].filter(Boolean).join(' · ');
  /* The script's inputs. `<` is escaped so no value can close the tag. */
  const data = JSON.stringify({
    base: `/i/${token}`, lang: en ? 'en' : 'ar', live: !!o, push: canPush, key: canPush ? opts.vapidKey : null,
    shop: name,
    icons: { bell: svg('bell'), bellOff: svg('bellOff'), share: svg('share'), check: svg('check'), vol: svg('vol'), mute: svg('mute'),
             plus: svg('plus'), compass: svg('compass'), copy: svg('copy'), phone: svg('phone'), down: svg('down'), x: svg('x') },
    t: L.js
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="${en ? 'en' : 'ar'}" dir="${L.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(sale.id)} · ${esc(name)}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#09090B">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/assets/icon-192.png">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
${o ? `<link rel="manifest" href="/i/${esc(token)}/manifest.webmanifest${en ? '?lang=en' : ''}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${esc(name)}">` : ''}
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<style>${CSS}</style>
</head>
<body>
<div class="glow" aria-hidden="true"></div>
<header class="top">
  <div class="brand">
    <span class="logo"><b class="lat">${esc(monogram(name))}</b><img src="/assets/logo.svg" alt=""></span>
    <span class="bn"><strong class="lat">${esc(name.toUpperCase())}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
  </div>
  <div class="top-r">
    ${o ? `<button type="button" class="snd" id="tpSound" hidden></button><span class="live" id="tpLive" data-state="wait" hidden><i></i><span></span></span>` : ''}
    <a class="lang" href="?lang=${L.other}" rel="nofollow" hreflang="${L.other}">${esc(L.otherName)}</a>
  </div>
</header>
<main class="wrap${o ? '' : ' is-receipt'}">
${hero}
<div class="side">${reviewCard}${moneyCard}${notify}${itemsCard}${extra}</div>
${timeline}
${foot}
</main>
<div class="banner" id="tpBanner" role="status" aria-live="polite" hidden>
  <span class="b-logo"><img src="/assets/logo.svg" alt=""></span>
  <div class="b-txt"><b></b><span></span></div>
  <em class="b-now"></em>
</div>
<script type="application/json" id="tpData">${data}</script>
<script>${CLIENT}</script>
</body>
</html>`;
}

export function notFound(lang) {
  /* A mistyped link is the likeliest way anybody arrives here, and they were
     sent an Arabic message to begin with. Same face as the page it failed to be. */
  const ar = lang !== 'en';
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ar ? 'لم يُعثر على الفاتورة' : 'Receipt not found'}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#09090B">
<link rel="icon" href="/assets/icon-192.png">
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;
         background:#09090B radial-gradient(60% 40% at 50% 0, rgba(198,255,0,.12), transparent 70%); color:#FAFAFA;
         font:15px/1.7 "Segoe UI","Noto Sans Arabic",Tahoma,system-ui,-apple-system,Roboto,Arial,sans-serif; }
  .m { width:64px; height:64px; margin:0 auto 18px; border-radius:18px; overflow:hidden; background:#000;
       box-shadow:0 0 0 1px rgba(255,255,255,.12), 0 10px 30px -10px rgba(198,255,0,.45); }
  .m img { width:100%; height:100%; display:block; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#8C8C96; margin:0 auto; max-width:34ch; }
</style></head>
<body><div>
  <div class="m"><img src="/assets/logo.svg" alt=""></div>
  <h1>${ar ? 'لم يُعثر على الفاتورة' : 'Receipt not found'}</h1>
  <p>${ar
    ? 'هذا الرابط لا يطابق أي فاتورة. تأكّد من الرمز على إيصالك أو أحضره إلى المحل.'
    : 'This link does not match any invoice. Check the code on your receipt, or bring it into the shop.'}</p>
</div></body></html>`;
}
