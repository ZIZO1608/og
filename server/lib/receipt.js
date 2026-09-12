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
    `SELECT s.id, s.at, s.customer_name, s.currency, s.payment,
            s.subtotal, s.discount, s.total, s.fx_rate, s.fx_base, s.voided,
            u.name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.public_token = ?`
  ).get(token);

  if (!sale) return null;

  /* A delivery order's own two facts: where it has got to, and what is still
     owed on it. NOT the address, NOT the phone and NOT the shop's transfer
     details — this link can be forwarded to anybody, and the person who
     ordered already knows where they live. */
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

  /* WHAT HAS HAPPENED TO IT, IN ORDER. The question a tracking link is opened
     to answer is not "what state is it in" but "has anything moved since I
     last looked", and a single status pill cannot answer that.

     Money only as amounts and dates — no method, no reference, no account
     number. A payment reference is the shop's bookkeeping, and this link can
     be forwarded to anybody. */
  sale.track = !sale.order ? null : {
    payments: get().prepare(
      `SELECT at, kind, amount_order FROM order_payments
        WHERE sale_id = ? ORDER BY at, id`
    ).all(sale.id),
    returns: get().prepare(
      `SELECT at, outcome FROM order_returns WHERE sale_id = ? ORDER BY at, id`
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

/* The country as the shop named it in Settings, not as a two-letter code:
   "JO" on a customer's page is a database detail leaking onto paper. */
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

/* ----------------------------------------------------------- both languages
   THE ONE PAGE IN THE WHOLE SYSTEM SOMEBODY OUTSIDE THE SHOP EVER SEES, and
   until now it was the only screen with no Arabic on it at all — while the
   WhatsApp message that hands out the link is written in Arabic. A customer
   in Aleppo was sent an Arabic message and opened an English page.

   Arabic is the default and English is one tap away (?lang=en). Server-side
   rather than a toggle in the page, for two reasons: `dir` and `lang` belong
   on <html>, which no CSS trick can set; and this page has no JavaScript by
   design and is not gaining any for a language switch.

   The table is small on purpose. Everything here is a sentence about ONE
   parcel — where it is, what is left to pay, what is in it. Anything longer
   than that belongs in the app, behind a login. */
const STR = {
  ar: {
    dir: 'rtl', other: 'en', otherName: 'English',
    invoice: 'رقم الطلب', date: 'التاريخ', servedBy: 'بإشراف', customer: 'الزبون',
    subtotal: 'المجموع', discount: 'الحسم', total: 'الإجمالي',
    shipping: 'الشحن', paid: 'المدفوع', left: 'المتبقّي', paidFull: 'مدفوع بالكامل',
    thanks: 'شكراً لك — ', cancelled: 'ملغى',
    cancelledNote: 'هذه الفاتورة ملغاة — لا تصلح للاستبدال.',
    exOpen: 'الاستبدال متاح', exLeft: (h) => `باقي ${h} ساعة`,
    exUntil: (d) => `حتى ${d}`, exShut: 'انتهت مهلة الاستبدال',
    exRan: (h) => `كانت ${h} ساعة`,
    policy: (h) => `الاستبدال خلال ${h} ساعة مع هذه الفاتورة.`,
    track: 'رقم التتبّع', findShop: 'موقع المحل', atRate: (r) => `بسعر ${r} لكل دولار`,
    /* the journey */
    steps: ['تم الطلب', 'الدفع', 'في الطريق', 'وصل'],
    placed: 'تم تسجيل الطلب', payment: 'دفعة واردة', refunded: 'مبلغ مُعاد',
    outDriver: 'خرجت مع سائقنا', outWith: (who) => `سُلّمت إلى ${who}`, onRoad: 'في الطريق',
    cameBack: 'رجعت إلى المحل', delivered: 'تم التسليم', collected: 'تم الاستلام من المحل',
    failedStep: 'تعذّر التسليم',
    stPrep: 'قيد التجهيز', stOut: 'في الطريق إليك', stDone: 'تم التسليم',
    stPick: 'جاهز للاستلام من المحل', stBack: 'رجعت إلى المحل', stCancel: 'ملغى',
    via: { driver: 'سائق المحل', office: 'مكتب نقل', courier: 'شركة شحن',
           abroad: 'شحن للخارج', pickup: 'استلام من المحل' },
    toPay: (a) => `${a} تُدفع عند الاستلام.`,
    toPaySend: (a) => `${a} — نرسل الطلب فور وصول المبلغ.`,
    whatsIn: 'محتويات الطلب'
  },
  en: {
    dir: 'ltr', other: 'ar', otherName: 'العربية',
    invoice: 'Order', date: 'Date', servedBy: 'Served by', customer: 'Customer',
    subtotal: 'Subtotal', discount: 'Discount', total: 'TOTAL',
    shipping: 'Shipping', paid: 'Paid', left: 'Still to pay', paidFull: 'Paid in full',
    thanks: 'Thank you — ', cancelled: 'CANCELLED',
    cancelledNote: 'This sale was voided — it is not valid for exchange.',
    exOpen: 'Exchange open', exLeft: (h) => `${h} hour${h === 1 ? '' : 's'} left`,
    exUntil: (d) => `until ${d}`, exShut: 'Exchange window closed',
    exRan: (h) => `It ran ${h} hours`,
    policy: (h) => `Exchange within ${h} hours with this receipt.`,
    track: 'Tracking number', findShop: 'Find the shop', atRate: (r) => `at ${r} / $`,
    steps: ['Ordered', 'Payment', 'On the way', 'Arrived'],
    placed: 'Order placed', payment: 'Payment received', refunded: 'Refunded',
    outDriver: 'Out with our driver', outWith: (who) => `Handed to ${who}`, onRoad: 'On its way',
    cameBack: 'Came back to the shop', delivered: 'Delivered', collected: 'Collected from the shop',
    failedStep: 'Could not be delivered',
    stPrep: 'Being prepared', stOut: 'On its way to you', stDone: 'Delivered',
    stPick: 'Ready to collect from the shop', stBack: 'Came back to the shop', stCancel: 'Cancelled',
    via: { driver: 'our own driver', office: 'a transport office', courier: 'a courier company',
           abroad: 'a shipment abroad', pickup: 'collection from the shop' },
    toPay: (a) => `${a} to pay on delivery.`,
    toPaySend: (a) => `${a} — we send it as soon as this arrives.`,
    whatsIn: 'What is in the parcel'
  }
};

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
export function render(sale, lang) {
  const s = shop();
  const rc = receiptCfg();
  const cur = sale.currency;
  const ex = exchange(sale, rc);
  /* Arabic unless the page was asked for in English. Anything else is
     Arabic: this link is forwarded and mistyped, and the shop's own language
     is the right thing to fall back to. */
  const L = STR[lang === 'en' ? 'en' : 'ar'];

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
    link(rc.maps_url, L.findShop)
  ].filter(Boolean).join('');

  /* The one thing a customer actually opens this page to find out: can I
     still bring this back. Stated as a verdict with the deadline behind it,
     not as a policy sentence they have to apply to their own calendar. */
  /* A delivery order answers a different question first — where is my parcel,
     and do I still owe anything — so its verdict goes above the exchange
     one. Where it is going is named only as far as the city: a link like
     this gets forwarded. */
  const o = sale.order;

  /* WHAT IS STILL OWED, WORKED OUT THE WAY THE SERVER WORKS IT OUT.
     This page had its own arithmetic — total plus the fee, less what was
     paid — which knew nothing about a parcel that came back: a fully
     refunded order went on telling its customer they owed the whole amount.
     `returned` is the same due_minor the office reduces the bill by
     (server/lib/orders.js, money()). */
  const money = !o ? null : (function () {
    const fee = o.fee_mode === 'invoice' ? (o.fee || 0) : 0;
    const due = Math.max(0, sale.total + fee - (o.returned || 0));
    return { fee, due, paid: o.paid || 0, left: Math.max(0, due - (o.paid || 0)) };
  })();

  /* THE RAIL. One pill can say where a parcel is; it cannot say how far
     along it is, and "how far along" is the whole question a customer opens
     this link to ask — usually more than once. Four steps, the reached ones
     filled, the current one ringed. A pickup never travels, so its third
     step is the counter rather than the road.

     Nothing here is estimated. Each step is on or off because of a stamp the
     database holds. */
  const rail = !o ? '' : (function () {
    const done = o.status === 'delivered';
    const back = o.status === 'failed' || (sale.track && sale.track.returns.length);
    const at = sale.voided ? 0
      : done ? 3
      : o.status === 'out' ? 2
      : money.paid > 0 ? 1 : 0;
    const cells = L.steps.map((label, i) => {
      /* A parcel that has arrived is not 'at' its last step, it is finished:
         every dot filled and none of them ringed. The ring means "this is
         where it has got to", which is a sentence about a journey still
         happening. */
      const state = sale.voided ? 'off'
        : i < at ? 'on'
        : i === at ? (done ? 'on' : 'now')
        : 'off';
      return `<li class="st ${state}"><i></i><span>${esc(label)}</span></li>`;
    }).join('');
    return `<ol class="rail${back ? ' back' : ''}">${cells}</ol>`;
  })();

  const journey = !o ? '' : (function () {
    const via = L.via[o.method || 'driver'] || L.via.driver;
    const step = sale.voided ? L.stCancel
      : o.status === 'delivered' ? (o.method === 'pickup' ? L.collected : L.stDone)
      : o.status === 'out' ? L.stOut
      : o.status === 'failed' ? L.stBack
      : o.method === 'pickup' ? L.stPick
      : L.stPrep;
    const owed = money.left
      ? ((o.method === 'driver' || o.method === 'pickup')
          ? L.toPay(amount(money.left, cur) + ' ' + cur)
          : L.toPaySend(amount(money.left, cur) + ' ' + cur))
      : L.paidFull;
    const tone = sale.voided ? 'bad' : money.left ? 'done' : 'ok';
    const where = [o.city, countryName(o.country)].filter(Boolean).join(', ');
    return `<div class="pill ${tone}"><b>${esc(step)}</b>` +
      `<span>${esc(where ? where + ' · ' : '')}${esc(via)}</span>` +
      `<span class="owed">${esc(owed)}</span></div>`;
  })();

  /* THE JOURNEY, IN ORDER. One pill says where a parcel is; a person who
     looked yesterday wants to know what has moved since, and only a list of
     stamped events answers that. Every row is a fact the database holds with
     a time on it — nothing here is estimated, and a step that has not
     happened is simply not drawn. */
  const timeline = !o ? '' : (function () {
    const t = sale.track || { payments: [], returns: [] };
    const rows = [{ at: sale.at, icon: '•', text: L.placed }];

    for (const p of t.payments) {
      rows.push(p.kind === 'refund'
        ? { at: p.at, icon: '↩', text: `${L.refunded} · ${amount(p.amount_order, cur)} ${cur}` }
        : { at: p.at, icon: '✓', text: `${L.payment} · ${amount(p.amount_order, cur)} ${cur}` });
    }
    if (o.out_at) {
      rows.push({
        at: o.out_at, icon: '→',
        text: o.method === 'driver' ? L.outDriver
            : o.company_name ? L.outWith(o.company_name) : L.onRoad
      });
    }
    for (const r of t.returns) {
      rows.push({ at: r.at, icon: '↩', text: L.cameBack });
    }
    if (o.closed_at) {
      rows.push({
        at: o.closed_at,
        icon: o.status === 'failed' ? '!' : '✓',
        text: o.status === 'failed' ? L.failedStep
            : o.method === 'pickup' ? L.collected : L.delivered
      });
    }

    rows.sort((a2, b2) => String(a2.at).localeCompare(String(b2.at)));
    const last = rows.length - 1;
    return `<div class="tl">` + rows.map((r, i) => `
      <div class="tl-r${i === last ? ' on' : ''}">
        <i>${esc(r.icon)}</i>
        <div><b>${esc(r.text)}</b><span dir="ltr">${esc(deadlineText(new Date(r.at)))}</span></div>
      </div>`).join('') + '</div>' +
      (o.tracking_no ? `<div class="tl-no">${esc(L.track)} · <b dir="ltr">${esc(o.tracking_no)}</b></div>` : '');
  })();

  const status = rail + journey + timeline + (sale.voided
    ? `<div class="pill bad"><b>${esc(L.cancelled)}</b><span>${esc(L.cancelledNote)}</span></div>`
    : ex.open
      ? `<div class="pill ok"><b>${esc(L.exOpen)}</b><span>${esc(L.exLeft(ex.hoursLeft))} · ${esc(L.exUntil(deadlineText(ex.until)))}</span></div>`
      : `<div class="pill done"><b>${esc(L.exShut)}</b><span>${esc(L.exRan(ex.hours))} · ${esc(deadlineText(ex.until))}</span></div>`);

  return `<!doctype html>
<html lang="${L.dir === 'rtl' ? 'ar' : 'en'}" dir="${L.dir}">
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
    /* Two Arabic faces first — the system UI font on an Android or an iPhone
       here IS an Arabic face, and naming Latin ones first has the browser
       fall back per glyph and mix two shapes in one word. */
    font:15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Arabic",
         "Droid Arabic Kufi", Tahoma, Roboto, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; align-items:center;
  }
  /* Every id, amount and date on this page is a digit run, and bidi will
     drag a sign or a currency code to the wrong end of one inside an Arabic
     sentence. .mono already carries them; these are the rest. */
  [dir="ltr"] { unicode-bidi:isolate; }

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
  .pill .owed { font-weight:700; }

  /* ---- the rail ---------------------------------------------------------
     Four dots and three connecting lines: ordered, on the way, arrived. It
     is the first thing on the page because it is the question — a customer
     opens this link to see whether anything has moved, and a sentence makes
     them read to find out.

     Built out of a flex row and one ::before per step rather than a grid, so
     it survives a browser from 2016; the connector is drawn on the step, not
     between them, so RTL mirrors it for free. */
  .rail { display:flex; list-style:none; margin:18px 0 10px; padding:0; }
  .rail .st { flex:1; position:relative; text-align:center; font-size:10.5px;
              color:var(--dim); min-width:0; }
  .rail .st i {
    display:block; width:13px; height:13px; margin:0 auto 7px; border-radius:50%;
    background:var(--paper); border:2px solid var(--line); position:relative; z-index:1;
  }
  /* The line runs from the middle of this step to the middle of the one
     before it — the first step therefore draws none. */
  .rail .st::before {
    content:""; position:absolute; top:5.5px; height:2px; background:var(--line);
    inset-inline-end:50%; width:100%;
  }
  .rail .st:first-child::before { display:none; }
  .rail .st.on i, .rail .st.now i { border-color:var(--ok); background:var(--ok); }
  .rail .st.on, .rail .st.now { color:var(--ink); font-weight:700; }
  .rail .st.on::before, .rail .st.now::before { background:var(--ok); }
  /* The step it is AT is ringed rather than filled — a dot that is merely
     reached and a dot that is the current one must not look the same. */
  .rail .st.now i { background:var(--paper); box-shadow:0 0 0 3px var(--okbg); }
  .rail.back .st.on i, .rail.back .st.now i,
  .rail.back .st.on::before, .rail.back .st.now::before { border-color:var(--bad); background:var(--bad); }
  .rail.back .st.now i { background:var(--paper); box-shadow:0 0 0 3px var(--badbg); }
  .rail .st span { display:block; overflow:hidden; text-overflow:ellipsis; }

  /* ---- the language ---------------------------------------------------- */
  .lang {
    position:absolute; top:12px; inset-inline-end:14px; z-index:2;
    padding:4px 11px; border:1px solid var(--line); border-radius:999px;
    font-size:11.5px; font-weight:700; color:var(--dim); text-decoration:none;
    background:var(--paper);
  }

  /* The journey. A rail drawn with one border and no pseudo-element tricks:
     this page is opened on phones with browsers nobody has updated. */
  .tl { margin:14px 0 4px; padding-inline-start:4px; }
  .tl-r { display:flex; gap:11px; align-items:flex-start; padding:0 0 13px; position:relative; }
  .tl-r:not(:last-child) { border-inline-start:1px solid var(--line); margin-inline-start:9px; padding-inline-start:17px; }
  .tl-r:last-child { margin-inline-start:9px; padding-inline-start:17px; padding-bottom:0; }
  .tl-r i {
    position:absolute; inset-inline-start:-9px; top:1px;
    width:18px; height:18px; border-radius:50%; background:var(--paper);
    border:1px solid var(--line); color:var(--dim);
    font-style:normal; font-size:10px; line-height:16px; text-align:center;
  }
  .tl-r.on i { border-color:var(--ok); color:var(--ok); font-weight:700; }
  .tl-r div { display:flex; flex-direction:column; gap:1px; }
  .tl-r b { font-size:13px; font-weight:700; }
  .tl-r span { font-size:11.5px; color:var(--dim); }
  .tl-no { font-size:12px; color:var(--dim); margin:2px 0 6px; }
  .tl-no b { color:var(--ink); letter-spacing:.04em; }

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
  .tot.grand.owes .big { color:var(--bad); }
  .tot.grand.clear .big { color:var(--ok); }
  .tot.grand.owes, .tot.grand.clear { border-top:0; padding-top:4px; }
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

  <a class="lang" href="?lang=${L.other}" rel="nofollow">${esc(L.otherName)}</a>

  ${sale.voided ? `<div class="stamp">${esc(L.cancelled)}</div>` : ''}

  <div class="brand">
    <div class="mark">${esc(monogram(s.name))}</div>
    <h1>${esc((s.name || 'OG SPORTS').toUpperCase())}</h1>
    ${s.tagline ? `<p class="tag">${esc(s.tagline)}</p>` : ''}
    ${s.branch_name ? `<p class="tag">${esc(s.branch_name)}</p>` : ''}
  </div>

  ${status}

  <hr class="rule">

  <div class="meta"><span>${esc(L.invoice)}</span><b class="inv mono" dir="ltr">${esc(sale.id)}</b></div>
  <div class="meta"><span>${esc(L.date)}</span><span class="mono" dir="ltr">${when(sale.at)}</span></div>
  ${sale.cashier_name ? `<div class="meta"><span>${esc(L.servedBy)}</span><span>${esc(sale.cashier_name.split(' ')[0])}</span></div>` : ''}
  ${sale.customer_name ? `<div class="meta"><span>${esc(L.customer)}</span><span>${esc(sale.customer_name)}</span></div>` : ''}

  <hr class="rule">

  ${o ? `<div class="meta"><span>${esc(L.whatsIn)}</span><span></span></div>` : ''}
  <ul>${lines}</ul>

  <hr class="rule">

  <div class="tot"><span>${esc(L.subtotal)}</span><span class="mono">${amount(sale.subtotal, cur)}</span></div>
  ${sale.discount ? `<div class="tot"><span>${esc(L.discount)}</span><span class="mono">− ${amount(sale.discount, cur)}</span></div>` : ''}
  ${money && money.fee ? `<div class="tot"><span>${esc(L.shipping)}</span><span class="mono">${amount(money.fee, cur)}</span></div>` : ''}
  <div class="tot grand"><span>${esc(L.total)}</span><span class="big mono" dir="ltr">${amount(money ? money.due : sale.total, cur)} ${esc(cur)}</span></div>
  ${usd ? `<div class="fx"><span dir="ltr">≈ $${usd}</span> ${esc(L.atRate(nf(sale.fx_rate)))}</div>` : ''}

  ${money ? `
  <div class="tot"><span>${esc(L.paid)}</span><span class="mono">${amount(money.paid, cur)}</span></div>
  <div class="tot grand ${money.left ? 'owes' : 'clear'}"><span>${esc(money.left ? L.left : L.paidFull)}</span>
    <span class="big mono" dir="ltr">${money.left ? amount(money.left, cur) + ' ' + esc(cur) : '✓'}</span></div>` : ''}

  ${links ? `<div class="links">${links}</div>` : ''}

  <p class="foot">
    ${esc((L.dir === 'rtl' ? rc.policy_ar : rc.policy_en) || L.policy(ex.hours))}<br>
    ${esc(L.thanks)}${esc(s.name || 'OG Sports')}
  </p>

</div>
</body>
</html>`;
}

export function notFound(lang) {
  /* A mistyped link is the likeliest way anybody arrives here, and they were
     sent an Arabic message to begin with. */
  const ar = lang !== "en";
  return `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ar ? "لم يُعثر على الفاتورة" : "Receipt not found"}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0B0B0D">
<style>
  :root { color-scheme: light dark; --bg:#F2F2F4; --ink:#141417; --dim:#71717A; --line:#E4E4E7; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0B0B0D; --ink:#FAFAFA; --dim:#8A8A93; --line:#26262B; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Arabic",Tahoma,Roboto,Arial,sans-serif;
         background:var(--bg); color:var(--ink); padding:24px; text-align:center; }
  .m { width:54px; height:54px; margin:0 auto 16px; border-radius:16px; border:2px dashed var(--line);
       display:flex; align-items:center; justify-content:center; font-size:24px; color:var(--dim); }
  h1 { font-size:19px; margin:0 0 8px; }
  p { color:var(--dim); margin:0 auto; max-width:34ch; }
</style></head>
<body><div>
  <div class="m">?</div>
  <h1>${ar ? "لم يُعثر على الفاتورة" : "Receipt not found"}</h1>
  <p>${ar
    ? "هذا الرابط لا يطابق أي فاتورة. تأكّد من الرمز على إيصالك أو أحضره إلى المحل."
    : "This link does not match any invoice. Check the code on your receipt, or bring it into the shop."}</p>
</div></body></html>`;
}
