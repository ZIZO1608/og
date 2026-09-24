/* ==========================================================================
   Night mode's pages — HTML from the server, no script at all. [night-page.js]
   --------------------------------------------------------------------------
   The shop's own look (css/tokens.css: dark, lime spent only on the one thing
   to do, 8·12·16·24·32, a 44 px thumb, 16 px fields so an iPhone never zooms)
   and its rules for Arabic: right to left for real, no letter-spacing, every
   figure its own isolated run. Arabic first, in the shop's own Syrian words.

   HONESTY IS THE LAYOUT. Every page opens with the banner that says what this
   is: night mode, the time the data is from, and that changes wait for the
   shop. Nothing here may look like the live system.

   THE CSP HAS A HASH, NOT 'unsafe-inline'. The stylesheet is ONE constant,
   its SHA-256 is computed once here and put in the header, and nothing draws
   a style="" attribute — a test checks both. There is no script, so the
   policy names none: default-src 'none' already refuses every one.

   No remote font: a render-blocking stylesheet from another host on a slow
   line is a blank page. Montserrat is used if the phone has it.
   ========================================================================== */
import { createHash } from 'node:crypto';
import { esc, fmtMoney, clock } from './snapshot-page.js';

export { esc };

export const fill = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : v[k]));

export const WORDS = {
  en: {
    app: 'Night mode', langOther: 'العربية', signout: 'Sign out',
    banner: 'Night mode · data from {time} · changes wait for the shop',
    bannerUnknown: 'Night mode · when this data is from is not known · changes wait for the shop',
    yesterday: 'yesterday {time}',
    nav: { home: 'Home', stock: 'Stock', customers: 'Customers', orders: 'Orders', requests: 'Requests' },
    signinTitle: 'OG System · night mode', signinSub: 'For when the shop is closed or cannot be reached. You can look things up, and leave requests the shop will answer.',
    user: 'Username', password: 'Password', code: 'Code from the authenticator app', signin: 'Sign in',
    bad: 'Wrong username, password or code.', throttled: 'Too many tries. Wait 15 minutes and try again.',
    hello: 'Hello, {user}', liveTitle: 'The shop is online right now',
    liveSub: 'The full system is answering. Use it for anything real — night mode is only the cloud copy.', openShop: 'Open the full system',
    homeNote: 'Everything here is read from the cloud copy. A request you leave waits until somebody at the shop accepts it.',
    today: 'Today, as of {time}', takings: 'Takings', sales: '{n} sales', sale1: '1 sale', noSales: 'No sales yet today.',
    returns: 'Returns: {n}', road: 'Orders waiting: {w} · on the road: {o}', cash: 'Cash with drivers',
    tiles: { stock: 'Stock', stockSub: 'What is on the shelves', customers: 'Customers', customersSub: 'Find somebody',
             orders: 'Orders', ordersSub: 'Where each one is', request: 'New request', requestSub: 'Leave it for the shop',
             requests: 'My requests', requestsSub: '{n} waiting' },
    stockTitle: 'Stock', search: 'Search', stockPh: 'Name, brand, size or code', asOf: 'As of {time}',
    stockEmpty: 'Nothing matches.', stockHint: 'Type a name, a brand or a size — "samba 42".', recent: 'Changed most recently',
    none: 'none', inRequest: 'In the request: {n}', add: 'Add', price: 'Price', added: 'Added to the request.',
    custTitle: 'Customers', custPh: 'Name or phone number', custHint: 'Type at least two letters or three digits.',
    custEmpty: 'Nobody matches.', recentOrders: 'Recent orders', noOrders: 'No orders yet.', forCustomer: 'New request for this customer',
    call: 'Call', noteLabel: 'Note', address: 'Address', city: 'City', phone: 'Phone', name: 'Name',
    ordersTitle: 'Orders', all: 'All', ordersEmpty: 'No orders here.',
    st: { waiting: 'To take out', out: 'On the road', delivered: 'Delivered', failed: 'Not delivered', cancelled: 'Cancelled', till: 'At the till' },
    via: { driver: 'Our driver', office: 'Transport office', courier: 'Courier', abroad: 'Abroad', pickup: 'Pickup' },
    reqTitle: 'New request', reqEmpty: 'Nothing in the request yet.', reqFind: 'Find it in stock',
    lines: 'What they want', qty: 'Quantity', update: 'Change', remove: 'Remove', addMore: 'Add more',
    zero: 'none in stock at {time}', low: 'only {n} in stock at {time}',
    who: 'Who is it for', pickCustomer: 'Choose a known customer', known: 'Known customer · {id}', forget: 'Not them',
    how: 'How it reaches them', pickup: 'They collect it from the shop', delivery: 'Deliver it',
    cityPh: 'Aleppo', addressPh: 'Area, street, a landmark', notePh: 'Anything the shop should know',
    send: 'Send to the shop', sendNote: 'Nothing changes now. The shop checks the stock and the price, and accepts or turns it down.',
    clear: 'Start again', clearAsk: 'Throw this request away?',
    off: 'Requests are switched off tonight. You can still look things up.',
    sent: 'Sent. {ref} is waiting for the shop.',
    reqsTitle: 'Requests', mine: 'Mine', everyone: 'Everyone', reqsEmpty: 'No requests yet.',
    rst: { waiting: 'Waiting for the shop', received: 'The shop has it — not decided yet', accepted: 'Accepted · {id}', rejected: 'Turned down' },
    reason: { out_of_stock: 'Out of stock', no_answer: 'Could not reach the customer', customer_cancelled: 'The customer cancelled',
              duplicate: 'Already ordered', wrong_details: 'The details were wrong', other: 'Another reason' },
    by: 'by {user}', pieces: '{n} pcs',
    err: {
      bad_name: 'Write their name (2 to 80 letters).', bad_phone: 'Write a phone number (7 to 15 digits).',
      bad_customer: 'That customer could not be used.', bad_items: 'The request has a line that cannot be sent — check the sizes and quantities (up to 20 each, 60 in all).',
      empty: 'Add at least one size.', unknown_sku: 'One of the sizes is no longer for sale: {sku}.',
      bad_delivery: 'Choose pickup or delivery.', bad_city: 'Write the city.', bad_address: 'Write the address (3 to 300 letters).',
      bad_note: 'The note is too long (500 letters at most).', too_many_phone: 'This phone already has 5 requests waiting for the shop.',
      too_many_user: 'Too many requests from this account in the last hour.', full: 'The shop has too many requests waiting. Try again later.',
      op_taken: 'This form was already used. Start the request again.', unsupported: 'The request could not be read.', too_big: 'The request is too big.',
      bad_user: 'This account cannot send requests.', bad_op: 'This form expired. Send it again.', off: 'Requests are switched off tonight.',
      rate: 'Too many requests from this account in the last hour.', down: 'The cloud copy did not answer. Nothing was sent — try again.',
      form: 'This page is out of date. Open it again and send it again.',
      changed: 'Your earlier send did reach the shop, as {ref} — without the changes you made after it. They are still here: send again to make a second request with them, or start again.'
    },
    downTitle: 'The cloud copy is not answering', downSub: 'Night mode cannot read anything right now. Try again in a minute.', retry: 'Try again',
    formTitle: 'This page is out of date', formSub: 'Open it again from the start and do it once more. Nothing was sent.',
    lostTitle: 'Nothing here', lostSub: 'This page does not exist in night mode.'
  },
  ar: {
    app: 'وضع الليل', langOther: 'English', signout: 'خروج',
    banner: 'وضع الليل · البيانات من الساعة {time} · التغييرات بتستنى المحل',
    bannerUnknown: 'وضع الليل · ما منعرف من أيمت هالبيانات · التغييرات بتستنى المحل',
    yesterday: 'مبارح {time}',
    nav: { home: 'الرئيسية', stock: 'البضاعة', customers: 'الزبائن', orders: 'الطلبات', requests: 'طلباتي' },
    signinTitle: 'OG System · وضع الليل', signinSub: 'لمّا يكون المحل مسكّر أو ما عم يرد. فيك تدوّر على شي، وتترك طلبات المحل بيرد عليها.',
    user: 'اسم المستخدم', password: 'كلمة السر', code: 'الرمز من تطبيق المصادقة', signin: 'دخول',
    bad: 'اسم المستخدم أو كلمة السر أو الرمز غلط.', throttled: 'محاولات كتير. استنى ربع ساعة وجرّب مرة تانية.',
    hello: 'أهلا يا {user}', liveTitle: 'المحل شغّال هلأ',
    liveSub: 'النظام الكامل عم يرد. استعمله لأي شي حقيقي — وضع الليل هو بس النسخة السحابية.', openShop: 'افتح النظام الكامل',
    homeNote: 'كل شي هون مقروء من النسخة السحابية. الطلب اللي بتتركه بيستنى لحتى حدا بالمحل يوافق عليه.',
    today: 'اليوم، لحد الساعة {time}', takings: 'المبيعات', sales: '{n} فاتورة', sale1: 'فاتورة وحدة', noSales: 'ما في مبيعات لهلأ اليوم.',
    returns: 'المرتجعات: {n}', road: 'طلبات ناطرة: {w} · بالطريق: {o}', cash: 'مصاري مع الموصّلين',
    tiles: { stock: 'البضاعة', stockSub: 'شو في عالرفوف', customers: 'الزبائن', customersSub: 'دوّر على حدا',
             orders: 'الطلبات', ordersSub: 'وين وصل كل طلب', request: 'طلب جديد', requestSub: 'اتركه للمحل',
             requests: 'طلباتي', requestsSub: '{n} ناطرين' },
    stockTitle: 'البضاعة', search: 'دوّر', stockPh: 'الاسم، الماركة، القياس أو الكود', asOf: 'لحد الساعة {time}',
    stockEmpty: 'ما لقينا شي.', stockHint: 'اكتب اسم أو ماركة أو قياس — «samba 42».', recent: 'آخر شي تغيّر',
    none: 'ما في', inRequest: 'بالطلب: {n}', add: 'أضف', price: 'السعر', added: 'انضاف للطلب.',
    custTitle: 'الزبائن', custPh: 'الاسم أو رقم الموبايل', custHint: 'اكتب حرفين أو ثلاث أرقام عالأقل.',
    custEmpty: 'ما في حدا بهالاسم أو الرقم.', recentOrders: 'آخر طلبات', noOrders: 'ما في طلبات لسا.', forCustomer: 'طلب جديد لهالزبون',
    call: 'اتصل', noteLabel: 'ملاحظة', address: 'العنوان', city: 'المدينة', phone: 'الموبايل', name: 'الاسم',
    ordersTitle: 'الطلبات', all: 'الكل', ordersEmpty: 'ما في طلبات هون.',
    st: { waiting: 'للخروج', out: 'بالطريق', delivered: 'وصل', failed: 'ما وصل', cancelled: 'ملغى', till: 'عالكاشير' },
    via: { driver: 'موصّلنا', office: 'مكتب نقل', courier: 'شركة شحن', abroad: 'برّا البلد', pickup: 'استلام من المحل' },
    reqTitle: 'طلب جديد', reqEmpty: 'ما في شي بالطلب لسا.', reqFind: 'دوّر عالبضاعة',
    lines: 'شو بدّو', qty: 'الكمية', update: 'غيّر', remove: 'شيل', addMore: 'زيد شي',
    zero: 'ما في منه الساعة {time}', low: 'في بس {n} الساعة {time}',
    who: 'لمين الطلب', pickCustomer: 'اختار زبون معروف', known: 'زبون معروف · {id}', forget: 'مو هو',
    how: 'كيف بيوصله', pickup: 'بياخده من المحل', delivery: 'بدّو توصيل',
    cityPh: 'حلب', addressPh: 'المنطقة، الشارع، علامة قريبة', notePh: 'أي شي لازم يعرفه المحل',
    send: 'ابعت الطلب للمحل', sendNote: 'ما في شي بيتغيّر هلأ. المحل بيتأكد من البضاعة والسعر، وبيوافق أو بيرفض.',
    clear: 'من الأول', clearAsk: 'نكب هالطلب؟',
    off: 'الطلبات مسكّرة الليلة. فيك تضل تدوّر على شي.',
    sent: 'انبعت. {ref} ناطر المحل.',
    reqsTitle: 'الطلبات الليلية', mine: 'تبعي', everyone: 'الكل', reqsEmpty: 'ما في طلبات لسا.',
    rst: { waiting: 'بانتظار المحل', received: 'وصل للمحل — لسا ما انقرر', accepted: 'انقبل · {id}', rejected: 'انرفض' },
    reason: { out_of_stock: 'خلصت البضاعة', no_answer: 'ما قدرنا نحكي الزبون', customer_cancelled: 'الزبون لغى',
              duplicate: 'في طلب قبله', wrong_details: 'المعلومات غلط', other: 'سبب تاني' },
    by: 'من {user}', pieces: '{n} قطعة',
    err: {
      bad_name: 'اكتب اسمه (من حرفين لـ ٨٠).', bad_phone: 'اكتب رقم موبايل (من ٧ لـ ١٥ رقم).',
      bad_customer: 'ما منقدر نستعمل هالزبون.', bad_items: 'في سطر بالطلب ما بينبعت — شوف القياسات والكميات (لحد ٢٠ من كل وحدة، و٦٠ بالمجموع).',
      empty: 'أضف قياس واحد عالأقل.', unknown_sku: 'في قياس ما عاد للبيع: {sku}.',
      bad_delivery: 'اختار استلام أو توصيل.', bad_city: 'اكتب المدينة.', bad_address: 'اكتب العنوان (من ٣ لـ ٣٠٠ حرف).',
      bad_note: 'الملاحظة طويلة كتير (٥٠٠ حرف بالأكتر).', too_many_phone: 'هالرقم إله ٥ طلبات ناطرة المحل.',
      too_many_user: 'طلبات كتير من هالحساب بآخر ساعة.', full: 'في طلبات كتير ناطرة المحل. جرّب بعدين.',
      op_taken: 'هالفورم انستعمل قبل. ابدأ الطلب من جديد.', unsupported: 'ما قدرنا نقرا الطلب.', too_big: 'الطلب كبير كتير.',
      bad_user: 'هالحساب ما فيه يبعت طلبات.', bad_op: 'هالفورم قديم. ابعته مرة تانية.', off: 'الطلبات مسكّرة الليلة.',
      rate: 'طلبات كتير من هالحساب بآخر ساعة.', down: 'النسخة السحابية ما ردّت. ما انبعت شي — جرّب مرة تانية.',
      form: 'هالصفحة قديمة. افتحها من جديد وابعت مرة تانية.',
      changed: 'الإرسال الأول وصل للمحل برقم {ref} — بس بدون التغييرات اللي عملتها بعده. التغييرات لسا هون: ابعت مرة تانية لتعمل طلب تاني فيها، أو ابدأ من الأول.'
    },
    downTitle: 'النسخة السحابية ما عم ترد', downSub: 'وضع الليل ما فيه يقرا شي هلأ. جرّب بعد دقيقة.', retry: 'جرّب مرة تانية',
    formTitle: 'هالصفحة قديمة', formSub: 'افتحها من الأول وعيد مرة تانية. ما انبعت شي.',
    lostTitle: 'ما في شي هون', lostSub: 'هالصفحة مو موجودة بوضع الليل.'
  }
};

/* ---------------------------------------------------------------- pieces */

export const fig = (s) => `<bdi dir="ltr" class="fig">${esc(s)}</bdi>`;
export const num = (n) => fig(Number(n || 0).toLocaleString('en-US'));
export const money = (minor, cur, exps) => fig(fmtMoney(Number(minor || 0), cur, exps));

/* When: the clock for today, "yesterday 22:10", or the date and the clock. */
export function when(iso, tz, nowMs, W) {
  if (!iso) return '';
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const c = clock(new Date(t).toISOString(), tz);
  if (day(t) === day(nowMs)) return fig(c);
  if (day(t) === day(nowMs - 86400000)) return fill(esc(W.yesterday), { time: fig(c) });
  return fig(day(t) + ' ' + c);
}

const I = {
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  home: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  box: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  people: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8',
  truck: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M16 16l5 5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'
};
const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${I[name]}"/></svg>`;

/* ------------------------------------------------------------------- CSS */

export const CSS = `
:root{--bg:#0A0A0B;--card:#141417;--pop:#1B1B1F;--line:#1E1E22;--line2:#27272A;--input:#2A2A2F;--text:#FAFAFA;--muted:#A1A1AA;--dim:#71717A;
--brand:#C6FF00;--brand-fg:#0A0A0B;--brand-soft:#1C2600;--brand-border:#4A6600;--warn:#FBBF24;--warn-soft:#2A2110;--warn-border:#7C5410;
--ok:#4ADE80;--ok-soft:#0F2418;--ok-border:#1D6B3D;--bad:#F87171;--bad-soft:#2B1416;--bad-border:#7F2226;--r:10px;--r-lg:14px;--tab:64px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:400 15px/1.55 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:0 0 calc(var(--tab) + 24px);min-height:100vh}
body[dir=rtl]{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
body[dir=rtl] *{letter-spacing:0!important}
a{color:inherit}
.banner{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--warn-soft);color:var(--warn);border-bottom:1px solid var(--warn-border);font-size:13px;font-weight:600;line-height:1.4}
.banner .ic{flex:none;width:18px;height:18px}
.wrap{max-width:720px;margin:0 auto;padding:16px;display:grid;gap:16px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
h1{font-size:22px;font-weight:700;margin:0;line-height:1.3}
h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em}
body[dir=rtl] h2{text-transform:none;font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:16px}
.card.tight{padding:12px}
.note{color:var(--muted);margin:0}
.small{font-size:13px}
.muted{color:var(--muted)}
.fig{unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.stack{display:grid;gap:12px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0;padding-top:0}
.hero{font-size:30px;font-weight:700;color:var(--brand);display:block;line-height:1.2}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border-radius:var(--r);border:1px solid var(--line2);background:transparent;color:var(--text);font:600 15px/1.2 inherit;font-family:inherit;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--brand);color:var(--brand-fg);border-color:var(--brand)}
.btn.quiet{border-color:transparent;color:var(--muted)}
.btn.small{min-height:44px;padding:0 12px;font-size:14px}
.btn.wide{width:100%}
.btn .ic{width:18px;height:18px}
.links{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
form{margin:0}
label.f{display:grid;gap:8px;font-weight:600;font-size:14px}
input,select,textarea{font:400 16px/1.4 inherit;font-family:inherit;color:var(--text);background:#0D0D0F;border:1px solid var(--input);border-radius:var(--r);min-height:44px;padding:8px 12px;width:100%}
textarea{min-height:88px;resize:vertical}
select{width:auto;min-width:72px;padding:0 12px}
input:focus,select:focus,textarea:focus,.btn:focus-visible,a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.err{color:var(--bad);font-weight:600;font-size:14px;margin:0}
.alert{border-radius:var(--r-lg);padding:12px 16px;font-weight:600;border:1px solid}
.alert.bad{background:var(--bad-soft);border-color:var(--bad-border);color:var(--bad)}
.alert.ok{background:var(--ok-soft);border-color:var(--ok-border);color:var(--ok)}
.alert.warn{background:var(--warn-soft);border-color:var(--warn-border);color:var(--warn)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tile{display:grid;gap:8px;align-content:start;min-height:96px;padding:16px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);text-decoration:none}
.tile b{font-size:16px}
.tile span{color:var(--muted);font-size:13px}
.tile .ic{width:24px;height:24px;color:var(--muted)}
.tile.primary{background:var(--brand-soft);border-color:var(--brand-border)}
.tile.primary .ic,.tile.primary b{color:var(--brand)}
.tile.wide{grid-column:1/-1}
.search{display:flex;gap:8px}
.search input{flex:1}
.prod{display:grid;gap:12px}
.prod-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.prod-h b{font-size:16px}
.colour{font-size:13px;color:var(--muted);font-weight:600;margin-top:4px}
.sz{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.sz:first-of-type{border-top:0}
.sz-n{font-weight:700;font-size:16px;text-align:center;border:1px solid var(--line2);border-radius:var(--r);padding:8px 0}
.sz-q{display:grid;gap:2px}
.sz-q b{font-size:15px}
.sz-q span{font-size:12px;color:var(--muted)}
.sz-q .pl{white-space:nowrap;margin-inline-end:8px}
.sz.zero .sz-n,.sz.zero .sz-q b{color:var(--dim)}
.addf{display:flex;gap:8px;align-items:center}
.addf select{min-width:64px}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;border:1px solid var(--line2);color:var(--muted);white-space:nowrap}
.chip.ok{color:var(--ok);border-color:var(--ok-border);background:var(--ok-soft)}
.chip.warn{color:var(--warn);border-color:var(--warn-border);background:var(--warn-soft)}
.chip.bad{color:var(--bad);border-color:var(--bad-border);background:var(--bad-soft)}
.chip.brand{color:var(--brand);border-color:var(--brand-border);background:var(--brand-soft)}
.list{display:grid}
.item{display:grid;gap:4px;padding:12px 0;border-top:1px solid var(--line);text-decoration:none}
.item:first-child{border-top:0;padding-top:0}
.item-top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:600}
.item-sub{color:var(--muted);font-size:13px}
.filters{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.filters a{flex:none}
.filters a.on{border-color:var(--brand);color:var(--brand)}
.line{display:grid;gap:8px;padding:12px 0;border-top:1px solid var(--line)}
.line:first-child{border-top:0;padding-top:0}
.line-top{display:flex;justify-content:space-between;gap:12px;font-weight:600}
.line-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.def{position:absolute;width:1px;height:1px;min-height:0;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.seg input{position:absolute;opacity:0;width:1px;height:1px;min-height:0;pointer-events:none}
.seg label{display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px 12px;border:1px solid var(--line2);border-radius:var(--r);font-weight:600;text-align:center;cursor:pointer}
#m-pickup:checked~.seg label[for=m-pickup],#m-delivery:checked~.seg label[for=m-delivery]{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
#m-pickup:focus-visible~.seg label[for=m-pickup],#m-delivery:focus-visible~.seg label[for=m-delivery]{outline:2px solid var(--brand);outline-offset:2px}
#m-pickup:checked~.addr{display:none}
.mode-inputs{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.known{display:flex;justify-content:space-between;align-items:center;gap:8px}
.foot{display:grid;gap:12px}
.draftbar{position:fixed;inset-inline:0;bottom:var(--tab);z-index:25;padding:8px 16px;background:var(--pop);border-top:1px solid var(--line2)}
.draftbar a{max-width:720px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;min-height:44px;text-decoration:none;font-weight:600;color:var(--brand)}
.tabbar{position:fixed;inset-inline:0;bottom:0;z-index:26;height:var(--tab);display:grid;grid-template-columns:repeat(5,1fr);background:#000;border-top:1px solid var(--line)}
.tabbar a{display:grid;justify-items:center;align-content:center;gap:2px;font-size:11px;font-weight:600;color:var(--muted);text-decoration:none;min-height:44px}
.tabbar a.on{color:var(--text)}
.tabbar a.on .ic{color:var(--brand)}
.tabbar .ic{width:22px;height:22px}
.ic{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.req{display:grid;gap:8px}
.req-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.req-top b{font-size:16px}
.dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px}
.dl dt{color:var(--muted)}
.dl dd{margin:0}
.signin{max-width:420px;margin:0 auto}
@media (min-width:640px){.tiles{grid-template-columns:repeat(3,1fr)}.tile.wide{grid-column:auto}}
`;

export const CSS_HASH = 'sha256-' + createHash('sha256').update(CSS, 'utf8').digest('base64');
export const CSP = `default-src 'none'; style-src '${CSS_HASH}'; img-src data:; form-action 'self'; ` +
  `frame-ancestors 'none'; base-uri 'none'`;

/* ----------------------------------------------------------------- shell */

function banner(W, road, tz, nowMs) {
  const t = road && road.beatAt ? when(road.beatAt, tz, nowMs, W) : null;
  const text = t ? fill(esc(W.banner), { time: t }) : esc(W.bannerUnknown);
  return `<div class="banner" role="status">${ic('moon')}<span>${text}</span></div>`;
}

const TABS = [['home', '/night', 'home'], ['stock', '/night/stock', 'box'], ['customers', '/night/customers', 'people'],
              ['orders', '/night/orders', 'truck'], ['requests', '/night/requests', 'list']];

export function shell({ lang, title, road, tz, now, body, tab = null, draftCount = 0, signedIn = true, form = null }) {
  const W = WORDS[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const tabs = signedIn ? `<nav class="tabbar" aria-label="${esc(W.app)}">${TABS.map(([k, href, icon]) =>
    `<a href="${href}"${tab === k ? ' class="on" aria-current="page"' : ''}>${ic(icon)}<span>${esc(W.nav[k])}</span></a>`).join('')}</nav>` : '';
  const bar = signedIn && draftCount > 0 && tab !== 'request'
    ? `<div class="draftbar"><a href="/night/request"><span>${esc(W.reqTitle)} · ${fill(esc(W.pieces), { n: num(draftCount) })}</span>${ic('plus')}</a></div>`
    : '';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0A0A0B">
<link rel="icon" href="data:,"><title>${esc(title)} · ${esc(W.app)}</title><style>${CSS}</style></head>
<body dir="${dir}">${banner(W, road, tz, now)}<main class="wrap">${body}</main>${bar}${tabs}${form || ''}</body></html>`;
}

/* A POST form's hidden fields: the session's token, and the language. */
export const hidden = (csrf, lang) => `<input type="hidden" name="t" value="${esc(csrf)}"><input type="hidden" name="lang" value="${lang}">`;

const langLink = (lang, W, path) =>
  `<a class="btn small" href="${esc(path)}${path.includes('?') ? '&' : '?'}lang=${lang === 'ar' ? 'en' : 'ar'}" lang="${lang === 'ar' ? 'en' : 'ar'}">${esc(W.langOther)}</a>`;

/* --------------------------------------------------------------- sign in */

export function signinPage(lang, { error, road, tz, now } = {}) {
  const W = WORDS[lang];
  const msg = error ? `<p class="err" role="alert">${esc(W[error] || W.bad)}</p>` : '';
  return shell({ lang, title: W.signinTitle, road, tz, now, signedIn: false, body: `
<div class="signin stack">
<div class="head"><h1>${esc(W.signinTitle)}</h1>${langLink(lang, W, '/night')}</div>
<form class="card stack" method="post" action="/night/login" autocomplete="on">
  <p class="note">${esc(W.signinSub)}</p>${msg}
  <input type="hidden" name="lang" value="${lang}">
  <label class="f">${esc(W.user)}<input name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required enterkeyhint="next"></label>
  <label class="f">${esc(W.password)}<input name="password" type="password" autocomplete="current-password" required enterkeyhint="next"></label>
  <label class="f">${esc(W.code)}<input name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="one-time-code" dir="ltr" required enterkeyhint="go"></label>
  <button class="btn primary wide" type="submit">${esc(W.signin)}</button>
</form></div>` });
}

/* ------------------------------------------------------------------ home */

export function homePage(ctx, { today = null, waiting = 0, exps = {} } = {}) {
  const { lang, road, tz, now, who, csrf } = ctx;
  const W = WORDS[lang];
  const live = road && road.mode === 'live' ? `<section class="alert ok stack"><div>${esc(W.liveTitle)}</div>
    <p class="note small">${esc(W.liveSub)}</p><div><a class="btn primary" href="/">${esc(W.openShop)}</a></div></section>` : '';
  let todayCard = '';
  if (today) {
    const tk = Object.keys(today.today.takings || {}).filter((k) => today.today.takings[k]);
    const cash = (today.road.cash || []).filter((c) => c.amount);
    todayCard = `<section class="card stack"><h2>${fill(esc(W.today), { time: road && road.beatAt ? when(road.beatAt, tz, now, W) : '—' })}</h2>
      <div>${tk.length ? tk.map((k) => `<span class="hero">${money(today.today.takings[k], k, exps)}</span>`).join('') : `<p class="note">${esc(W.noSales)}</p>`}</div>
      <div class="muted small">${today.today.count === 1 ? esc(W.sale1) : fill(esc(W.sales), { n: num(today.today.count) })}
        · ${fill(esc(W.returns), { n: num(today.today.returns.count) })}</div>
      <div class="row"><span>${fill(esc(W.road), { w: num(today.road.waiting), o: num(today.road.out) })}</span></div>
      ${cash.length ? `<div class="row"><span>${esc(W.cash)}</span><span>${cash.map((c) => money(c.amount, c.currency, exps)).join(' · ')}</span></div>` : ''}
    </section>`;
  }
  const t = W.tiles;
  const tile = (href, icon, title, sub, cls = '') =>
    `<a class="tile${cls}" href="${href}">${ic(icon)}<b>${esc(title)}</b><span>${sub}</span></a>`;
  const body = `
<div class="head"><h1>${fill(esc(W.hello), { user: esc(who.user) })}</h1><div class="links">${langLink(lang, W, '/night')}
  <form method="post" action="/night/logout">${hidden(csrf, lang)}<button class="btn small quiet" type="submit">${esc(W.signout)}</button></form></div></div>
${live}
<p class="note small">${esc(W.homeNote)}</p>
${todayCard}
<nav class="tiles">
  ${tile('/night/request', 'plus', t.request, esc(t.requestSub), ' primary wide')}
  ${tile('/night/stock', 'box', t.stock, esc(t.stockSub))}
  ${tile('/night/customers', 'people', t.customers, esc(t.customersSub))}
  ${tile('/night/orders', 'truck', t.orders, esc(t.ordersSub))}
  ${tile('/night/requests', 'list', t.requests, fill(esc(t.requestsSub), { n: num(waiting) }))}
</nav>`;
  return shell({ ...ctx, title: W.app, tab: 'home', body });
}

/* ----------------------------------------------------------------- stock */

const sizeOrder = (a, b) => {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
};

/* rows (STOCK_ROWS) → products → colours → sizes, each size with its places. */
export function groupStock(rows, order = null) {
  const byId = new Map();
  for (const r of rows) {
    const id = Number(r.id);
    if (!byId.has(id)) byId.set(id, { id, name: r.name, brand: r.brand, colorway: r.colorway, currency: r.currency,
                                      price: Number(r.selling_price || 0), multi: Number(r.colours || 0) > 1, sizes: new Map() });
    const p = byId.get(id);
    if (!p.sizes.has(r.sku)) p.sizes.set(r.sku, { sku: r.sku, size: r.size, colour: r.colour, colourAr: r.colour_ar,
                                                  colourSort: Number(r.colour_sort || 0), total: 0, places: {} });
    const s = p.sizes.get(r.sku);
    if (r.wh_id) { const q = Number(r.qty || 0); s.places[r.wh_id] = (s.places[r.wh_id] || 0) + q; s.total += q; }
  }
  const list = [...byId.values()];
  if (order) list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  for (const p of list) {
    p.sizes = [...p.sizes.values()].sort((a, b) => a.colourSort - b.colourSort || sizeOrder(a.size, b.size) || a.sku.localeCompare(b.sku));
  }
  return list;
}

export function stockPage(ctx, { q = '', products = [], warehouses = [], exps = {}, draft = new Map(), added = null } = {}) {
  const { lang, road, tz, now, csrf } = ctx;
  const W = WORDS[lang];
  const whName = (id) => { const w = warehouses.find((x) => x.id === id); return w ? (lang === 'ar' ? w.name_ar : w.name) : id; };
  const asOf = road && road.beatAt ? `<p class="note small">${fill(esc(W.asOf), { time: when(road.beatAt, tz, now, W) })}</p>` : '';
  const cards = products.map((p) => {
    let lastColour = null;
    const sizes = p.sizes.map((s) => {
      const head = p.multi && s.colour !== lastColour
        ? `<div class="colour">${esc(lang === 'ar' ? (s.colourAr || s.colour) : (s.colour || s.colourAr))}</div>` : '';
      lastColour = s.colour;
      const places = Object.entries(s.places).filter(([, n]) => n > 0).map(([w, n]) => `<span class="pl">${esc(whName(w))} ${num(n)}</span>`).join(' ');
      const inReq = draft.get(s.sku);
      return `${head}<div class="sz${s.total ? '' : ' zero'}"><span class="sz-n">${fig(s.size)}</span>
        <span class="sz-q"><b>${s.total ? num(s.total) : esc(W.none)}</b>${places ? `<span>${places}</span>` : ''}${inReq ? `<span class="chip brand">${fill(esc(W.inRequest), { n: num(inReq) })}</span>` : ''}</span>
        <form class="addf" method="post" action="/night/request/add">${hidden(csrf, lang)}<input type="hidden" name="sku" value="${esc(s.sku)}">
          <input type="hidden" name="q" value="${esc(q)}">
          <select name="qty" aria-label="${esc(W.qty)} ${esc(s.size)}">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select>
          <button class="btn small" type="submit">${ic('plus')}${esc(W.add)}</button></form></div>`;
    }).join('');
    return `<section class="card prod"><div class="prod-h"><div><b>${esc(p.name)}</b>
      <div class="muted small">${esc([p.brand, p.colorway].filter(Boolean).join(' · '))}</div></div>${money(p.price, p.currency, exps)}</div>
      <div>${sizes}</div></section>`;
  }).join('');
  const body = `
<div class="head"><h1>${esc(W.stockTitle)}</h1></div>
${added ? `<p class="alert ok" role="status">${esc(added)}</p>` : ''}
<form class="search" method="get" action="/night/stock" role="search">
  <input name="q" value="${esc(q)}" placeholder="${esc(W.stockPh)}" aria-label="${esc(W.stockPh)}" enterkeyhint="search" autocomplete="off">
  <button class="btn" type="submit">${ic('search')}<span>${esc(W.search)}</span></button></form>
${asOf}
${q ? '' : `<p class="note small">${esc(W.stockHint)} ${products.length ? '· ' + esc(W.recent) : ''}</p>`}
${products.length ? cards : `<section class="card"><p class="note">${esc(q ? W.stockEmpty : W.stockHint)}</p></section>`}`;
  return shell({ ...ctx, title: W.stockTitle, tab: 'stock', body });
}

/* ------------------------------------------------------------- customers */

export function customersPage(ctx, { q = '', rows = [] } = {}) {
  const { lang } = ctx;
  const W = WORDS[lang];
  const list = rows.map((c) => `<a class="item" href="/night/customers/${Number(c.id)}">
    <span class="item-top"><span>${esc(c.name)}</span>${c.phone ? fig(c.phone) : ''}</span>
    ${c.city ? `<span class="item-sub">${esc(c.city)}</span>` : ''}</a>`).join('');
  const body = `
<div class="head"><h1>${esc(W.custTitle)}</h1></div>
<form class="search" method="get" action="/night/customers" role="search">
  <input name="q" value="${esc(q)}" placeholder="${esc(W.custPh)}" aria-label="${esc(W.custPh)}" enterkeyhint="search" autocomplete="off">
  <button class="btn" type="submit">${ic('search')}<span>${esc(W.search)}</span></button></form>
${q.trim().length < 2 ? `<p class="note small">${esc(W.custHint)}</p>`
    : rows.length ? `<section class="card list">${list}</section>` : `<section class="card"><p class="note">${esc(W.custEmpty)}</p></section>`}`;
  return shell({ ...ctx, title: W.custTitle, tab: 'customers', body });
}

function orderStatus(o, W) {
  if (o.voided) return `<span class="chip bad">${esc(W.st.cancelled)}</span>`;
  if (!o.status) return `<span class="chip">${esc(W.st.till)}</span>`;
  const cls = o.status === 'delivered' ? 'ok' : o.status === 'failed' ? 'bad' : o.status === 'out' ? 'brand' : 'warn';
  return `<span class="chip ${cls}">${esc(W.st[o.status] || o.status)}</span>`;
}

export function customerPage(ctx, { c, orders = [], items = {}, exps = {} }) {
  const { lang, tz, now, csrf } = ctx;
  const W = WORDS[lang];
  const tel = c.phone ? String(c.phone).replace(/[^0-9+]/g, '') : '';
  const ord = orders.map((o) => `<div class="item"><span class="item-top"><span>${fig(o.id)}</span>${orderStatus(o, W)}</span>
    <span class="item-sub">${when(o.at, tz, now, W)} · ${money(o.total, o.currency, exps)}${o.method ? ' · ' + esc(W.via[o.method] || o.method) : ''}</span>
    ${(items[o.id] || []).length ? `<span class="item-sub">${items[o.id].map((i) => `${esc(i.name)} ${fig((i.size || '') + ' ×' + i.qty)}`).join(' · ')}</span>` : ''}</div>`).join('');
  const body = `
<div class="head"><h1>${esc(c.name)}</h1></div>
<section class="card stack">
  <dl class="dl">
    ${c.phone ? `<dt>${esc(W.phone)}</dt><dd>${fig(c.phone)}</dd>` : ''}
    ${c.city ? `<dt>${esc(W.city)}</dt><dd>${esc(c.city)}</dd>` : ''}
    ${c.address ? `<dt>${esc(W.address)}</dt><dd>${esc(c.address)}</dd>` : ''}
    ${c.note ? `<dt>${esc(W.noteLabel)}</dt><dd>${esc(c.note)}</dd>` : ''}
  </dl>
  <div class="links">
    <form method="post" action="/night/request/customer">${hidden(csrf, lang)}<input type="hidden" name="id" value="${Number(c.id)}">
      <button class="btn primary" type="submit">${ic('plus')}${esc(W.forCustomer)}</button></form>
    ${tel ? `<a class="btn" href="tel:${esc(tel)}">${ic('phone')}${esc(W.call)}</a>` : ''}
  </div>
</section>
<section class="card"><h2>${esc(W.recentOrders)}</h2>${ord ? `<div class="list">${ord}</div>` : `<p class="note">${esc(W.noOrders)}</p>`}</section>`;
  return shell({ ...ctx, title: c.name, tab: 'customers', body });
}

/* ---------------------------------------------------------------- orders */

export function ordersPage(ctx, { status = '', rows = [], items = {}, exps = {} }) {
  const { lang, tz, now } = ctx;
  const W = WORDS[lang];
  const f = (k, label) => `<a class="btn small${status === k ? ' on' : ''}" href="/night/orders${k ? '?status=' + k : ''}">${esc(label)}</a>`;
  const list = rows.map((o) => `<div class="item"><span class="item-top"><span>${fig(o.id)} · ${esc(o.customer || o.customer_name || '—')}</span>${orderStatus(o, W)}</span>
    <span class="item-sub">${when(o.at, tz, now, W)} · ${money(o.total, o.currency, exps)} · ${esc(W.via[o.method] || o.method || '')}${o.city ? ' · ' + esc(o.city) : ''}${o.company_name ? ' · ' + esc(o.company_name) : ''}</span>
    ${(items[o.id] || []).length ? `<span class="item-sub">${items[o.id].map((i) => `${esc(i.name)} ${fig((i.size || '') + ' ×' + i.qty)}`).join(' · ')}</span>` : ''}</div>`).join('');
  const body = `
<div class="head"><h1>${esc(W.ordersTitle)}</h1></div>
<nav class="filters">${f('', W.all)}${['waiting', 'out', 'delivered', 'failed', 'cancelled'].map((k) => f(k, W.st[k])).join('')}</nav>
${rows.length ? `<section class="card list">${list}</section>` : `<section class="card"><p class="note">${esc(W.ordersEmpty)}</p></section>`}`;
  return shell({ ...ctx, title: W.ordersTitle, tab: 'orders', body });
}

/* --------------------------------------------------------------- request */

/* draft: { lines:[{sku, qty}], customer:{id,name,phone}, method, city, address, note }
   info:  sku → { name, size, colour, colourAr, qty } from the mirror */
export function requestPage(ctx, { draft, info = {}, errors = {}, submitOn = true, message = null }) {
  const { lang, road, tz, now, csrf } = ctx;
  const W = WORDS[lang];
  const at = road && road.beatAt ? when(road.beatAt, tz, now, W) : '—';
  const errOf = (k) => errors[k] ? `<p class="err" role="alert">${fill(esc(W.err[errors[k]] || W.err.unsupported), { sku: fig(errors.sku || '') })}</p>` : '';
  const lines = draft.lines.map((l) => {
    const i = info[l.sku] || {};
    const colour = lang === 'ar' ? (i.colourAr || i.colour) : (i.colour || i.colourAr);
    const stock = i.qty === undefined ? '' : Number(i.qty) === 0
      ? `<span class="chip warn">${fill(esc(W.zero), { time: at })}</span>`
      : Number(i.qty) < l.qty ? `<span class="chip warn">${fill(esc(W.low), { n: num(i.qty), time: at })}</span>` : '';
    return `<div class="line"><div class="line-top"><span>${esc(i.name || l.sku)}${colour ? ' · ' + esc(colour) : ''}</span>${fig(i.size || '')}</div>
      ${stock ? `<div>${stock}</div>` : ''}
      <div class="line-ctl">
        <select name="q.${esc(l.sku)}" aria-label="${esc(W.qty)}">${Array.from({ length: 20 }, (_, n) => `<option${n + 1 === l.qty ? ' selected' : ''}>${n + 1}</option>`).join('')}</select>
        <button class="btn small" type="submit" formaction="/night/request/save">${esc(W.update)}</button>
        <button class="btn small quiet" type="submit" formaction="/night/request/save" name="do" value="remove:${esc(l.sku)}">${esc(W.remove)}</button></div></div>`;
  }).join('');
  const c = draft.customer || {};
  const m = draft.method === 'pickup' ? 'pickup' : draft.method === 'delivery' ? 'delivery' : '';
  const off = submitOn ? '' : `<p class="alert warn" role="status">${esc(W.off)}</p>`;
  /* ONE form. Every button but Send posts the whole of it to /save, so none of
     them can throw away what was typed somewhere else on the page. The hidden
     button is FIRST, which makes it the form's default: Enter in a box saves
     and stays, and never sends, forgets the customer or opens another page. */
  const body = `
<div class="head"><h1>${esc(W.reqTitle)}</h1></div>
${message ? `<p class="alert bad" role="alert">${message}</p>` : ''}${off}
<form class="stack" method="post" action="/night/request" novalidate>${hidden(csrf, lang)}
<button class="def" type="submit" formaction="/night/request/save" tabindex="-1" aria-hidden="true">${esc(W.update)}</button>
<section class="card stack"><h2>${esc(W.lines)}</h2>${errOf('items')}
  ${draft.lines.length ? `<div>${lines}</div>` : `<p class="note">${esc(W.reqEmpty)}</p>`}
  <div><button class="btn" type="submit" formaction="/night/request/save?next=stock">${ic('box')}${esc(draft.lines.length ? W.addMore : W.reqFind)}</button></div></section>
<section class="card stack"><h2>${esc(W.who)}</h2>
  ${c.id ? `<div class="known"><span class="chip brand">${fill(esc(W.known), { id: fig('#' + c.id) })}</span>
    <button class="btn small quiet" type="submit" formaction="/night/request/save?next=forget">${esc(W.forget)}</button></div>` : ''}
  <label class="f">${esc(W.name)}<input name="name" value="${esc(c.name || '')}" maxlength="80" autocomplete="off" enterkeyhint="next"></label>${errOf('name')}
  <label class="f">${esc(W.phone)}<input name="phone" value="${esc(c.phone || '')}" type="tel" inputmode="tel" dir="ltr" maxlength="40" autocomplete="off" enterkeyhint="next"></label>${errOf('phone')}
  <div><button class="btn small" type="submit" formaction="/night/request/save?next=customers">${ic('people')}${esc(W.pickCustomer)}</button></div>
</section>
<section class="card stack"><h2>${esc(W.how)}</h2>
  <input class="mode-inputs" type="radio" name="method" id="m-pickup" value="pickup"${m === 'pickup' ? ' checked' : ''}>
  <input class="mode-inputs" type="radio" name="method" id="m-delivery" value="delivery"${m === 'delivery' ? ' checked' : ''}>
  <div class="seg"><label for="m-pickup">${esc(W.pickup)}</label><label for="m-delivery">${esc(W.delivery)}</label></div>${errOf('method')}
  <div class="addr stack">
    <label class="f">${esc(W.city)}<input name="city" value="${esc(draft.city || '')}" placeholder="${esc(W.cityPh)}" maxlength="80" enterkeyhint="next"></label>${errOf('city')}
    <label class="f">${esc(W.address)}<textarea name="address" maxlength="300" placeholder="${esc(W.addressPh)}">${esc(draft.address || '')}</textarea></label>${errOf('address')}
  </div>
</section>
<section class="card stack">
  <label class="f">${esc(W.noteLabel)}<textarea name="note" maxlength="500" placeholder="${esc(W.notePh)}">${esc(draft.note || '')}</textarea></label>${errOf('note')}
</section>
<section class="foot">
  <p class="note small">${esc(W.sendNote)}</p>
  <button class="btn primary wide" type="submit"${submitOn ? '' : ' disabled'}>${esc(W.send)}</button>
  <button class="btn quiet" type="submit" formaction="/night/request/clear">${esc(W.clear)}</button>
</section>
</form>`;
  return shell({ ...ctx, title: W.reqTitle, tab: 'request', body });
}

/* -------------------------------------------------------------- requests */

export function requestsPage(ctx, { items = [], scope = 'mine', canAll = false, sent = null }) {
  const { lang, tz, now } = ctx;
  const W = WORDS[lang];
  const chip = (r) => {
    if (r.state === 'accepted') return `<span class="chip ok">${fill(esc(W.rst.accepted), { id: fig(r.saleId || '') })}</span>`;
    if (r.state === 'rejected') return `<span class="chip bad">${esc(W.rst.rejected)}</span>`;
    if (r.state === 'received') return `<span class="chip brand">${esc(W.rst.received)}</span>`;
    return `<span class="chip warn">${esc(W.rst.waiting)}</span>`;
  };
  const cards = items.map((r) => {
    const p = r.payload || {};
    const cu = p.customer || {};
    const d = p.delivery || {};
    const lines = (p.items || []).map((i) => {
      const colour = lang === 'ar' ? (i.colourAr || i.colour) : (i.colour || i.colourAr);
      return `${esc(i.name || i.sku)}${colour ? ' · ' + esc(colour) : ''} ${fig((i.size || '') + ' ×' + i.qty)}`;
    }).join('<br>');
    const why = r.state === 'rejected'
      ? `<p class="alert bad small">${esc(W.reason[r.code] || W.reason.other)}${r.note ? ' — <bdi dir="auto">' + esc(r.note) + '</bdi>' : ''}</p>` : '';
    return `<section class="card req"><div class="req-top"><b>${fig(r.ref)}</b>${chip(r)}</div>
      <div class="item-sub">${when(r.at, tz, now, W)}${scope === 'all' && r.byUser ? ' · ' + fill(esc(W.by), { user: esc(r.byUser) }) : ''}</div>
      <dl class="dl"><dt>${esc(W.name)}</dt><dd><bdi dir="auto">${esc(cu.name || '')}</bdi> ${cu.phone ? fig(cu.phone) : ''}</dd>
        <dt>${esc(W.how)}</dt><dd>${esc(d.method === 'pickup' ? W.pickup : W.delivery)}${d.city ? ' · <bdi dir="auto">' + esc(d.city) + '</bdi>' : ''}${d.address ? '<br><bdi dir="auto">' + esc(d.address) + '</bdi>' : ''}</dd>
        <dt>${esc(W.lines)}</dt><dd>${lines}</dd>
        ${p.note ? `<dt>${esc(W.noteLabel)}</dt><dd dir="auto">${esc(p.note)}</dd>` : ''}</dl>${why}</section>`;
  }).join('');
  const toggle = canAll ? `<nav class="filters"><a class="btn small${scope === 'mine' ? ' on' : ''}" href="/night/requests">${esc(W.mine)}</a>
    <a class="btn small${scope === 'all' ? ' on' : ''}" href="/night/requests?all=1">${esc(W.everyone)}</a></nav>` : '';
  const body = `
<div class="head"><h1>${esc(W.reqsTitle)}</h1><a class="btn primary small" href="/night/request">${ic('plus')}${esc(W.reqTitle)}</a></div>
${sent ? `<p class="alert ok" role="status">${fill(esc(W.sent), { ref: fig(sent) })}</p>` : ''}
${toggle}
${cards || `<section class="card"><p class="note">${esc(W.reqsEmpty)}</p></section>`}`;
  return shell({ ...ctx, title: W.reqsTitle, tab: 'requests', body });
}

/* ------------------------------------------------------------- the cloud */

/* One sentence and a way back: the cloud not answering ('down'), a form from
   another session ('form'), a page that does not exist ('lost'). */
export function messagePage(ctx, kind = 'down') {
  const W = WORDS[ctx.lang];
  const title = W[kind + 'Title'], sub = W[kind + 'Sub'];
  return shell({ ...ctx, title, body: `
<section class="card stack"><h1>${esc(title)}</h1><p class="note">${esc(sub)}</p>
<div><a class="btn primary" href="/night">${esc(kind === 'down' ? W.retry : W.nav.home)}</a></div></section>` });
}
export const downPage = (ctx) => messagePage(ctx, 'down');
