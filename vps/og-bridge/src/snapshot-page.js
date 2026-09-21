/* ==========================================================================
   The snapshot's pages — HTML from the server, no script at all.
   --------------------------------------------------------------------------
   The shop's own look (dark, Montserrat, one card shape, 8·12·16·24·32, a
   44 px thumb, lime only on the hero number) and its own rules for Arabic:
   right to left for real, no letter-spacing, every figure its own isolated
   run with its sign inside. The words live HERE, in both languages, not in
   the app's I18N — this page is served by another machine.

   Nothing on it changes anything: the only two forms are sign in and sign
   out, and neither touches the shop.
   ========================================================================== */

export const WORDS = {
  en: {
    title: 'Where the shop stood', langOther: 'العربية',
    signinTitle: 'The owner’s snapshot', signinSub: 'The last figures the shop sent to the cloud copy. Read-only.',
    user: 'Username', password: 'Password', code: 'Code from the authenticator app', signin: 'Sign in',
    bad: 'Wrong username, password or code.', throttled: 'Too many tries. Wait 15 minutes and try again.',
    signout: 'Sign out',
    liveTitle: 'The shop is online', liveSub: 'The live shop is the truth when it answers. Open it instead of this page.', open: 'Open the shop',
    synced: 'Last synced {time} — {ago}', neverSynced: 'The cloud copy has never heard from the shop.',
    split: 'The shop is online and selling — only the road from here to it is down. These are the figures it last sent.',
    mirror: 'The shop has been out of reach since {time}. These are the last figures it sent; anything after that is not here.',
    unknown: 'It is not clear whether the shop is online. These are the last figures the cloud copy holds.',
    today: 'Today', takings: 'Takings', sales: '{n} sales', sale1: '1 sale', noSales: 'No sales yet today.',
    returns: 'Returns: {n}, {amounts}', noReturns: 'No returns today.',
    money: 'Where the money is', total: 'Total', noMoney: 'The cash book has no entries yet.',
    owed: 'Owed to suppliers', owedN: '{n} suppliers', owed1: '1 supplier', owedNone: 'Nothing owed.',
    road: 'On the road', waiting: 'Waiting to go out', out: 'Out with a carrier', cash: 'Cash with drivers', noCash: 'No cash waiting with drivers.',
    stock: 'Stock', stockOut: 'Out of stock', stockLow: 'Down to {low} or fewer', stockNone: 'Nothing is low.',
    last: 'Last 20 sales', voided: 'voided', noCashier: '—',
    places: { drawer: 'Drawer', owner: 'With the owner' },
    ago: { now: 'just now', m: '{n} min ago', h: '{n} h ago', d: '{n} days ago' }
  },
  ar: {
    title: 'وين وقف المحل', langOther: 'English',
    signinTitle: 'لمحة صاحب المحل', signinSub: 'آخر أرقام بعتها المحل للنسخة السحابية. للقراءة بس.',
    user: 'اسم المستخدم', password: 'كلمة السر', code: 'الرمز من تطبيق المصادقة', signin: 'دخول',
    bad: 'اسم المستخدم أو كلمة السر أو الرمز غلط.', throttled: 'محاولات كتير. استنى ربع ساعة وجرّب مرة تانية.',
    signout: 'خروج',
    liveTitle: 'المحل شغّال هلأ', liveSub: 'المحل الحي هو الأصح لمّا يرد. افتحه بدل هالصفحة.', open: 'افتح المحل',
    synced: 'آخر مزامنة {time} — {ago}', neverSynced: 'النسخة السحابية ما وصلها شي من المحل أبداً.',
    split: 'المحل شغّال وعم يبيع — بس الطريق من هون لعنده مقطوع. هاي آخر أرقام بعتها.',
    mirror: 'المحل ما عم يرد من الساعة {time}. هاي آخر أرقام بعتها؛ اللي صار بعدها مو هون.',
    unknown: 'مو واضح إذا المحل شغّال. هاي آخر أرقام عند النسخة السحابية.',
    today: 'اليوم', takings: 'المبيعات', sales: '{n} فاتورة', sale1: 'فاتورة وحدة', noSales: 'ما في مبيعات لهلأ اليوم.',
    returns: 'المرتجعات: {n}، {amounts}', noReturns: 'ما في مرتجعات اليوم.',
    money: 'وين المصاري', total: 'المجموع', noMoney: 'دفتر الصندوق فاضي لهلأ.',
    owed: 'علينا للموردين', owedN: '{n} موردين', owed1: 'مورد واحد', owedNone: 'ما علينا شي.',
    road: 'عالطريق', waiting: 'ناطرة تطلع', out: 'مع الموصّل', cash: 'مصاري مع الموصّلين', noCash: 'ما في مصاري مع الموصّلين.',
    stock: 'البضاعة', stockOut: 'خلصانة', stockLow: 'باقي {low} أو أقل', stockNone: 'ما في شي قليل.',
    last: 'آخر ٢٠ فاتورة', voided: 'ملغاة', noCashier: '—',
    places: { drawer: 'الصندوق', owner: 'مع صاحب المحل' },
    ago: { now: 'هلأ', m: 'من {n} دقيقة', h: 'من {n} ساعة', d: 'من {n} يوم' }
  }
};

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : v[k]));

/* Minor units + a code → text, in the currency's own decimals. Never
   converted, never added to another currency. */
export function fmtMoney(minor, cur, exps = {}) {
  const exp = exps[cur] !== undefined ? exps[cur] : (cur === 'USD' ? 2 : 0);
  const neg = minor < 0;
  const n = Math.abs(minor) / Math.pow(10, exp);
  const body = n.toLocaleString('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp });
  const s = cur === 'USD' ? '$' + body : body + ' ' + cur;
  return (neg ? '−' : '') + s;
}
const money = (minor, cur, exps) => `<bdi dir="ltr" class="fig">${esc(fmtMoney(minor, cur, exps))}</bdi>`;
const num = (n) => `<bdi dir="ltr" class="fig">${esc(Number(n).toLocaleString('en-US'))}</bdi>`;
const pairs = (obj, exps, order) => {
  const keys = Object.keys(obj || {}).filter((k) => obj[k] !== 0)
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return keys.map((k) => money(obj[k], k, exps));
};

export function clock(iso, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
function dayClock(iso, tz, nowMs) {
  const d = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const t = clock(iso, tz);
  return d(Date.parse(iso)) === d(nowMs) ? t : `${d(Date.parse(iso))} ${t}`;
}
export function ago(ms, W) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return W.ago.now;
  if (m < 60) return fill(W.ago.m, { n: m });
  const h = Math.floor(m / 60);
  if (h < 48) return fill(W.ago.h, { n: h });
  return fill(W.ago.d, { n: Math.floor(h / 24) });
}

const CSS = `
:root{--bg:#0A0A0B;--card:#111113;--line:#1E1E22;--text:#FAFAFA;--muted:#A1A1AA;--lime:#C6FF00;--amber:#FBBF24;--red:#F87171;--r:14px}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:400 15px/1.55 Montserrat,system-ui,-apple-system,Segoe UI,sans-serif;padding:24px 16px 32px}
body[dir=rtl]{font-family:Tahoma,"Segoe UI",system-ui,sans-serif;letter-spacing:0}
body[dir=rtl] *{letter-spacing:0!important}
.wrap{max-width:720px;margin:0 auto;display:grid;gap:16px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
h1{font-size:22px;font-weight:700;margin:0}
h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em}
body[dir=rtl] h2{text-transform:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px}
.age{font-size:18px;font-weight:700}
.note{color:var(--muted);margin:8px 0 0}
.banner{border-color:#7C5410;background:#1C160A}
.banner .note{color:var(--amber)}
.hero{display:grid;gap:8px}
.hero>.fig{font-size:30px;font-weight:700;color:var(--lime);display:block}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);align-items:baseline}
.row:first-of-type{border-top:0}
.row .v{display:grid;justify-items:end;gap:2px;text-align:end}
.muted{color:var(--muted)}
.fig{unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.sale{padding:8px 0;border-top:1px solid var(--line)}
.sale:first-of-type{border-top:0}
.sale .top{display:flex;justify-content:space-between;gap:12px;font-weight:600}
.sale .sub{color:var(--muted);font-size:13px}
.sale.void .top{text-decoration:line-through;color:var(--muted)}
.tag{font-size:12px;color:var(--red);font-weight:600}
a,button{min-height:44px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);font-weight:600;font-size:14px;font-family:inherit;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--lime);color:#0A0A0B;border-color:var(--lime)}
.links{display:flex;gap:8px;flex-wrap:wrap}
form.inline{margin:0}
label{display:grid;gap:8px;font-weight:600;font-size:14px}
input{min-height:44px;font-size:16px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:#0D0D0F;color:var(--text);font-family:inherit}
.stack{display:grid;gap:16px}
.err{color:var(--red);font-weight:600;margin:0}
`;

function shell(lang, title, body) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin"><link rel="icon" href="data:,"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap">
<style>${CSS}</style></head><body dir="${dir}"><main class="wrap">${body}</main></body></html>`;
}

const langLink = (lang, W, path = '/snapshot') =>
  `<a class="btn" href="${path}?lang=${lang === 'ar' ? 'en' : 'ar'}" lang="${lang === 'ar' ? 'en' : 'ar'}">${esc(W.langOther)}</a>`;

export function loginPage(lang, { error } = {}) {
  const W = WORDS[lang];
  const msg = error ? `<p class="err" role="alert">${esc(W[error] || W.bad)}</p>` : '';
  return shell(lang, W.signinTitle, `
<div class="head"><h1>${esc(W.signinTitle)}</h1>${langLink(lang, W)}</div>
<form class="card stack" method="post" action="/snapshot/login" autocomplete="on">
  <p class="note" style="margin:0">${esc(W.signinSub)}</p>${msg}
  <input type="hidden" name="lang" value="${lang}">
  <label>${esc(W.user)}<input name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required enterkeyhint="next"></label>
  <label>${esc(W.password)}<input name="password" type="password" autocomplete="current-password" required enterkeyhint="next"></label>
  <label>${esc(W.code)}<input name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="one-time-code" dir="ltr" required enterkeyhint="go"></label>
  <button class="btn primary" type="submit">${esc(W.signin)}</button>
</form>`);
}

const signout = (W, lang) =>
  `<form class="inline" method="post" action="/snapshot/logout"><input type="hidden" name="lang" value="${lang}"><button class="btn" type="submit">${esc(W.signout)}</button></form>`;

export function livePage(lang) {
  const W = WORDS[lang];
  return shell(lang, W.liveTitle, `
<div class="head"><h1>${esc(W.liveTitle)}</h1><div class="links">${langLink(lang, W)}${signout(W, lang)}</div></div>
<section class="card"><p class="note" style="margin:0 0 16px">${esc(W.liveSub)}</p>
<a class="btn primary" href="/">${esc(W.open)}</a></section>`);
}

export function snapshotPage(lang, f, road, { tz = 'Asia/Damascus', now = Date.now() } = {}) {
  const W = WORDS[lang];
  const ORDER = [f.base, 'SYP', 'USD'];
  const ex = f.exps;

  const beat = road.beatAt;
  const age = beat
    ? `<div class="age">${fill(W.synced, { time: `<bdi dir="ltr">${esc(dayClock(beat, tz, now))}</bdi>`, ago: esc(ago(now - Date.parse(beat), W)) })}</div>`
    : `<div class="age">${esc(W.neverSynced)}</div>`;
  /* Every piece is escaped before it is joined; the time is its own bidi run,
     or Arabic draws "2026-09-21 23:46" as "23:46 2026-09-21". */
  const why = road.mode === 'split' ? esc(W.split)
    : road.mode === 'mirror' ? fill(esc(W.mirror), { time: `<bdi dir="ltr">${esc(beat ? dayClock(beat, tz, now) : '?')}</bdi>` })
    : esc(W.unknown);

  const t = f.today;
  const tk = pairs(t.takings, ex, ORDER);
  const retAmts = pairs(t.returns.amounts, ex, ORDER).join(' · ');
  const hero = `<section class="card hero"><h2>${esc(W.today)} · ${esc(W.takings)}</h2>
  ${tk.length ? tk.join('') : `<p class="note" style="margin:0">${esc(W.noSales)}</p>`}
  ${t.count ? `<div class="muted">${t.count === 1 ? esc(W.sale1) : fill(W.sales, { n: num(t.count) })}</div>` : ''}
  <div class="muted">${t.returns.count ? fill(W.returns, { n: num(t.returns.count), amounts: retAmts }) : esc(W.noReturns)}</div></section>`;

  const placeName = (p) => (p.kind === 'drawer' || p.kind === 'owner') ? W.places[p.kind] : (lang === 'ar' ? p.ar : p.en);
  const placeRows = f.places.filter((p) => Object.values(p.balances).some((v) => v !== 0)).map((p) =>
    `<div class="row"><span>${esc(placeName(p))}</span><span class="v">${pairs(p.balances, ex, ORDER).join('')}</span></div>`).join('');
  const totals = pairs(f.placeTotals, ex, ORDER);
  const moneyCard = `<section class="card"><h2>${esc(W.money)}</h2>${placeRows || `<p class="note" style="margin:0">${esc(W.noMoney)}</p>`}
  ${totals.length ? `<div class="row"><strong>${esc(W.total)}</strong><span class="v">${totals.join('')}</span></div>` : ''}</section>`;

  const owed = pairs(f.suppliers.amounts, ex, ORDER);
  const owedCard = `<section class="card"><h2>${esc(W.owed)}</h2>${owed.length
    ? `<div class="row"><span>${f.suppliers.count === 1 ? esc(W.owed1) : fill(W.owedN, { n: num(f.suppliers.count) })}</span><span class="v">${owed.join('')}</span></div>`
    : `<p class="note" style="margin:0">${esc(W.owedNone)}</p>`}</section>`;

  const cash = f.road.cash.filter((c) => c.amount !== 0).map((c) => money(c.amount, c.currency, ex));
  const roadCard = `<section class="card"><h2>${esc(W.road)}</h2>
  <div class="row"><span>${esc(W.waiting)}</span><span class="v">${num(f.road.waiting)}</span></div>
  <div class="row"><span>${esc(W.out)}</span><span class="v">${num(f.road.out)}</span></div>
  <div class="row"><span>${esc(W.cash)}</span><span class="v">${cash.length ? cash.join('') : `<span class="muted">${esc(W.noCash)}</span>`}</span></div></section>`;

  const list = (arr) => arr.map((v) => `${esc(v.name)} <bdi dir="ltr">${esc(v.size)}</bdi>${v.qty !== undefined ? ` (<bdi dir="ltr">${v.qty}</bdi>)` : ''}`).join(' · ');
  const s = f.stock;
  const stockCard = `<section class="card"><h2>${esc(W.stock)}</h2>${s.out || s.critical ? `
  <div class="row"><span>${esc(W.stockOut)}</span><span class="v">${num(s.out)}</span></div>${s.outTop.length ? `<div class="muted" style="font-size:13px">${list(s.outTop)}</div>` : ''}
  <div class="row"><span>${fill(W.stockLow, { low: num(s.low) })}</span><span class="v">${num(s.critical)}</span></div>${s.criticalTop.length ? `<div class="muted" style="font-size:13px">${list(s.criticalTop)}</div>` : ''}`
    : `<p class="note" style="margin:0">${esc(W.stockNone)}</p>`}</section>`;

  const sales = f.lastSales.map((x) => `<div class="sale${x.voided ? ' void' : ''}">
    <div class="top"><span><bdi dir="ltr">${esc(x.id)}</bdi> ${x.voided ? `<span class="tag">${esc(W.voided)}</span>` : ''}</span>${money(x.total, x.currency, ex)}</div>
    <div class="sub"><bdi dir="ltr">${esc(dayClock(x.at, tz, now))}</bdi> · ${esc(x.cashier || W.noCashier)}</div>
    <div class="sub">${x.items.map((i) => `${esc(i.name)} <bdi dir="ltr">${esc(i.size || '')} ×${i.qty}</bdi>`).join(' · ')}</div></div>`).join('');
  const lastCard = `<section class="card"><h2>${esc(W.last)}</h2>${sales}</section>`;

  return shell(lang, W.title, `
<div class="head"><h1>${esc(f.shop || W.title)}</h1><div class="links">${langLink(lang, W)}${signout(W, lang)}</div></div>
<section class="card banner">${age}<p class="note">${why}</p></section>
${hero}${moneyCard}${owedCard}${roadCard}${stockCard}${lastCard}`);
}
