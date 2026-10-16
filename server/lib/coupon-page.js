/* ==========================================================================
   THE COUPON'S PAGE — what a stranger sees after scanning a sticker
   GET /c/<code>                                            (migration 074)
   --------------------------------------------------------------------------
   The owner leaves QR stickers around the city. Whoever finds one scans it
   and lands here: the code, what it takes off, and every way to use it —

     - Shop now: the website, with the code already in the cart
       (<web.site_url>/?coupon=<code>, contract v1.7);
     - Copy the code;
     - Save the picture (js/couponcard.js — the same picture the shop prints);
     - Send it to OG on WhatsApp, in both languages (the shop's rule);
     - Send it to a friend (the phone's share sheet);
     - At the shop: a barcode the cashier's gun reads. It carries DIGITS
       (Coupons.scanToken), because a hand scanner types through the keyboard
       and on the Arabic layout every letter of a code arrives as something
       else.

   Arabic first, English one tap away (?lang=en), like the tracking page.
   Everything a person needs is in the HTML; the one inline script ADDS
   copying, the picture, the share sheet and the barcode.

   It says only what a sticker already says: the code, its value and its
   rules. Never who used it, never the note, never what it has given away.
   ========================================================================== */

import { normPhone } from './text.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* JSON inside a <script>: nothing in it may close the tag. */
const jsonIn = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const RULE = '━━━━━━━━━━━━━━';

const WORDS = {
  ar: {
    found: 'لقيت كوبون! 🎉',
    single: 'إلك إذا كنت أول واحد بيستعملو — لا تتأخر!',
    multi: 'استعملو عالموقع أو بالمحل.',
    yourCode: 'كود الخصم',
    tapCopy: 'اضغط لتنسخ',
    copied: 'تم النسخ ✓',
    shop: 'تسوّق هلق — الكود بينحط بالسلة لحالو',
    copy: 'انسخ الكود',
    save: 'احفظ الصورة',
    saving: 'عم نجهّز الصورة…',
    saved: 'انحفظت ✓',
    wa: 'ابعتو لـ OG عالواتساب',
    share: 'ابعتو لرفيقك',
    store: 'بالمحل؟',
    storeSub: 'ورجي هالباركود للكاشير، أو قلّو الكود.',
    min: 'على طلب فوق {n}',
    ends: 'بيخلص {d}',
    starts: 'بيبلش {d}',
    once: 'مرة وحدة لكل زبون',
    onlyOnce: 'بينفع مرة وحدة بس',
    left: 'باقي {n}',
    anyone: 'لأي حدا، عالموقع وبالمحل',
    soonHead: 'لسا ما بلّش',
    usedHead: 'سبقك حدا! 😅',
    usedBody: 'هالكوبون انستعمل. خلّي عينك مفتوحة — في غيرو مخبّى بالشوارع.',
    endedHead: 'خلص وقت هالكوبون',
    endedBody: 'بس في دايماً شي جديد عنا — مرّ شوف.',
    offHead: 'هالكوبون موقّف',
    nfHead: 'ما لقينا هالكوبون',
    nfBody: 'يمكن الكود انكتب غلط. جرّب امسحو مرة تانية.',
    visit: 'زور الموقع',
    other: 'English',
    city: 'حلب',
    off: 'خصم',
    waText: (code, v) => [
      'مرحبا OG 👋',
      `لقيت كوبون *${code}* (${v}) وبدي استعملو 🎉`
    ],
    title: (v) => `${v} · OG Sports`
  },
  en: {
    found: 'You found a coupon! 🎉',
    single: "It's yours if you're the first to use it — be quick!",
    multi: 'Use it on the website or in the shop.',
    yourCode: 'Your code',
    tapCopy: 'Tap to copy',
    copied: 'Copied ✓',
    shop: 'Shop now — the code goes in your cart',
    copy: 'Copy code',
    save: 'Save image',
    saving: 'Making the image…',
    saved: 'Saved ✓',
    wa: 'Send to OG on WhatsApp',
    share: 'Send to a friend',
    store: 'In the shop?',
    storeSub: 'Show this barcode to the cashier, or tell them the code.',
    min: 'On orders over {n}',
    ends: 'Ends {d}',
    starts: 'Starts {d}',
    once: 'Once per customer',
    onlyOnce: 'Works once only',
    left: '{n} left',
    anyone: 'For anyone, online and in store',
    soonHead: 'Not started yet',
    usedHead: 'Someone beat you to it! 😅',
    usedBody: 'This coupon has been used. Keep your eyes open — there are more hidden around the city.',
    endedHead: 'This coupon has ended',
    endedBody: "There's always something new with us — come and have a look.",
    offHead: 'This coupon is switched off',
    nfHead: "We couldn't find this coupon",
    nfBody: 'The code may have been mistyped. Try scanning it again.',
    visit: 'Visit the website',
    other: 'العربية',
    city: 'Aleppo',
    off: 'OFF',
    waText: (code, v) => [
      'Hi OG 👋',
      `I found coupon *${code}* (${v}) and I'd like to use it 🎉`
    ],
    title: (v) => `${v} · OG Sports`
  }
};

function usd(cents) {
  const n = Number(cents) || 0;
  return '$' + (n / 100).toFixed(n % 100 ? 2 : 0);
}
const valueEn = (c) => (c.kind === 'percent' ? `${c.percent}%` : usd(c.amount)) + ' OFF';
/* The figure is its own left-to-right run, or Arabic puts the % on the wrong side. */
const valueAr = (c) => 'خصم \u2066' + (c.kind === 'percent' ? `${c.percent}%` : usd(c.amount)) + '\u2069';

function day(iso, lang) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SY-u-nu-latn' : 'en-GB',
      { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Damascus' }).format(new Date(iso));
  } catch { return String(iso).slice(0, 10); }
}

/* The WhatsApp line to the shop: Arabic, the rule, English — js/whatsapp.js
   WA.both's shape, written here because this page has no app behind it. */
function waLink(phone, c) {
  const to = normPhone(phone || '');
  if (!/^\d{8,15}$/.test(to)) return null;
  const RLM = '\u200F';
  const arLines = WORDS.ar.waText(c.code, valueAr(c)).map((s) => (/^[^A-Za-z\u0600-\u06FF]*[A-Za-z]/.test(s) ? RLM + s : s));
  const text = arLines.join('\n') + '\n\n' + RULE + '\n\n' + WORDS.en.waText(c.code, valueEn(c)).join('\n');
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

const CSS = `
:root{--bg:#0A0A0B;--card:#141416;--line:rgba(255,255,255,.09);--text:#F4F4F5;--muted:#A1A1AA;--lime:#C6FF00;--ink:#0A0A0B}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font-family:Montserrat,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;
  background:radial-gradient(900px 520px at 100% -10%,rgba(198,255,0,.16),transparent 60%),radial-gradient(700px 500px at -10% 110%,rgba(198,255,0,.08),transparent 60%),var(--bg)}
html[dir=rtl] body{font-family:Tahoma,"Segoe UI",system-ui,sans-serif}
html[dir=rtl] .kick,html[dir=rtl] .val2,html[dir=rtl] .btn,html[dir=rtl] h1,html[dir=rtl] h2{font-family:Cairo,Tahoma,sans-serif}
html[dir=rtl] .val{font-family:Montserrat,Cairo,sans-serif}
main{max-width:480px;margin:0 auto;padding:18px 16px 40px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.top img{width:40px;height:40px;border-radius:10px;border:1px solid var(--line)}
.top b{font:700 16px Montserrat,sans-serif;letter-spacing:.14em}
.top a.lang{margin-inline-start:auto;color:var(--muted);font-size:14px;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:8px 14px}
.hero{text-align:center;padding:6px 0 18px;position:relative}
.kick{font-weight:700;font-size:20px;margin:0 0 8px}
.val{font:700 clamp(52px,16vw,76px)/1 Montserrat,sans-serif;color:var(--lime);margin:0;letter-spacing:-.02em;text-shadow:0 0 40px rgba(198,255,0,.25)}
.val2{font-weight:700;font-size:22px;margin:8px 0 0}
.sub{color:var(--muted);margin:12px auto 0;max-width:34ch;line-height:1.5}
.ticket{position:relative;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:20px 18px 18px;margin:8px 0 16px;text-align:center;overflow:hidden}
.ticket:before,.ticket:after{content:"";position:absolute;top:50%;width:26px;height:26px;border-radius:50%;background:var(--bg);transform:translateY(-50%)}
.ticket:before{left:-13px}.ticket:after{right:-13px}
.lbl{display:block;color:var(--muted);font-size:13px;letter-spacing:.08em;margin-bottom:8px}
.code{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:64px;border:2px dashed rgba(198,255,0,.55);border-radius:14px;background:rgba(198,255,0,.06);color:#fff;
  font:700 clamp(26px,8vw,34px) Montserrat,sans-serif;letter-spacing:.12em;cursor:pointer;padding:8px 12px}
.code svg{width:22px;height:22px;flex:none;stroke:var(--lime);fill:none;stroke-width:2}
.hint{display:block;color:var(--muted);font-size:13px;margin-top:8px;min-height:18px}
.hint.ok{color:var(--lime)}
.rules{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.rules li{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:6px 12px;color:var(--text)}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:54px;border-radius:14px;border:1px solid var(--line);background:#1C1C1F;color:#fff;
  font:inherit;font-weight:700;font-size:16px;text-decoration:none;cursor:pointer;padding:12px 16px;margin:0 0 10px;-webkit-tap-highlight-color:transparent;transition:transform .12s}
.btn:active{transform:scale(.97)}
.btn svg{width:22px;height:22px;flex:none}
.btn.primary{background:var(--lime);color:var(--ink);border-color:var(--lime);font-size:17px;box-shadow:0 10px 30px rgba(198,255,0,.18)}
.btn.wa{background:#1DA851;border-color:#1DA851}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.row .btn{margin:0}
.row + .btn,.row{margin-bottom:10px}
.store{margin-top:22px;background:#fff;color:var(--ink);border-radius:20px;padding:18px 16px;text-align:center}
.store h2{margin:0 0 4px;font-size:18px}
.store p{margin:0 0 12px;color:#52525B;font-size:14px}
.store .bar svg{max-width:100%;height:auto}
.store small{display:block;font:600 14px Montserrat,sans-serif;letter-spacing:.2em;color:#3F3F46;margin-top:4px}
.gone{text-align:center;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px 20px;margin:10px 0 16px}
.gone h1{margin:0 0 10px;font-size:26px}
.gone p{color:var(--muted);line-height:1.6;margin:0}
.gone .x{font:700 22px Montserrat,sans-serif;letter-spacing:.12em;color:var(--muted);text-decoration:line-through;margin:14px 0 0}
footer{text-align:center;color:var(--muted);font-size:13px;margin-top:26px}
footer a{color:var(--muted)}
.burst{position:absolute;inset:-10px 0 auto;height:0;pointer-events:none}
.burst i{position:absolute;top:0;width:8px;height:14px;border-radius:2px;opacity:0;animation:fall 1.6s ease-out forwards}
@keyframes fall{0%{opacity:1;transform:translateY(0) rotate(0)}100%{opacity:0;transform:translateY(150px) rotate(320deg)}}
@media (prefers-reduced-motion:reduce){.burst{display:none}.btn{transition:none}}
[hidden]{display:none!important}
`;

const ICON = {
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>'
};

function shell(lang, title, body, extraHead = '') {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0A0A0B">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/assets/icon-192.png">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
${extraHead}<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function top(W, otherHref) {
  return `<header class="top"><img src="/assets/logo.svg" alt=""><b>OG SPORTS</b>` +
    `<a class="lang" href="${esc(otherHref)}" hreflang="${W === WORDS.ar ? 'en' : 'ar'}">${W.other}</a></header>`;
}

function foot(W, siteUrl) {
  const host = siteUrl.replace(/^https?:\/\//, '');
  return `<footer>OG Sports · ${W.city} · <a href="${esc(siteUrl)}" rel="noopener"><bdi dir="ltr">${esc(host)}</bdi></a></footer>`;
}

/* The page for a code that exists. `c` is Coupons.forPage(); `links` is
   Coupons.links(); `pageUrl` the address the QR carries. */
export function render(c, langIn, links, pageUrl) {
  const lang = langIn === 'en' ? 'en' : 'ar';
  const W = WORDS[lang];
  const other = lang === 'ar' ? '?lang=en' : '?lang=ar';
  const valMain = lang === 'ar' ? valueAr(c) : valueEn(c);
  const valOther = lang === 'ar' ? valueEn(c) : valueAr(c);
  const site = links.siteUrl;

  if (c.status === 'used_up' || c.status === 'expired' || c.status === 'off') {
    const head = c.status === 'used_up' ? W.usedHead : c.status === 'expired' ? W.endedHead : W.offHead;
    const body = c.status === 'used_up' ? W.usedBody : W.endedBody;
    return shell(lang, W.title(valMain),
      `<main>${top(W, other)}
<section class="gone"><h1>${esc(head)}</h1><p>${esc(body)}</p><div class="x"><bdi dir="ltr">${esc(c.code)}</bdi></div></section>
<a class="btn primary" href="${esc(site)}" rel="noopener">${ICON.bag}<span>${esc(W.visit)}</span></a>
${foot(W, site)}</main>`);
  }

  const rules = [];
  if (c.status === 'soon') rules.push(W.starts.replace('{d}', day(c.startsAt, lang)));
  if (c.maxUses === 1) rules.push(W.onlyOnce);
  else if (c.left !== null && c.left <= 20) rules.push(W.left.replace('{n}', c.left));
  if (c.minBasket) rules.push(W.min.replace('{n}', usd(c.minBasket)));
  if (c.oncePerCustomer) rules.push(W.once);
  if (c.expiresAt) rules.push(W.ends.replace('{d}', day(c.expiresAt, lang)));
  if (!rules.length) rules.push(W.anyone);

  const shopHref = `${site}/?coupon=${encodeURIComponent(c.code)}`;
  const wa = waLink(links.phone, c);
  const data = {
    code: c.code, kind: c.kind, percent: c.percent, amount: c.amount,
    expiresAt: c.expiresAt, single: c.maxUses === 1, url: pageUrl, token: c.scanToken,
    words: { copied: W.copied, tapCopy: W.tapCopy, saving: W.saving, saved: W.saved, save: W.save },
    share: { title: 'OG Sports', text: lang === 'ar'
      ? `${valueAr(c)} عند OG Sports — الكود ${c.code}`
      : `${valueEn(c)} at OG Sports — code ${c.code}` }
  };

  const confetti = Array.from({ length: 18 }, (_, i) => {
    const left = (i * 53) % 100;
    const colors = ['#C6FF00', '#FFFFFF', '#C6FF00', '#71717A'];
    return `<i style="left:${left}%;background:${colors[i % 4]};animation-delay:${(i % 6) * 0.07}s"></i>`;
  }).join('');

  return shell(lang, W.title(valMain), `<main>${top(W, other)}
<section class="hero"><div class="burst" aria-hidden="true">${confetti}</div>
<p class="kick">${esc(W.found)}</p>
<h1 class="val"><bdi>${esc(valMain)}</bdi></h1>
<p class="val2"><bdi>${esc(valOther)}</bdi></p>
<p class="sub">${esc(c.maxUses === 1 ? W.single : W.multi)}</p>
</section>
<section class="ticket">
<span class="lbl">${esc(W.yourCode)}</span>
<button type="button" class="code" id="cpCode" aria-label="${esc(W.copy)}"><bdi dir="ltr">${esc(c.code)}</bdi>${ICON.copy}</button>
<span class="hint" id="cpHint" aria-live="polite">${esc(W.tapCopy)}</span>
<ul class="rules">${rules.map((r) => `<li><bdi>${esc(r)}</bdi></li>`).join('')}</ul>
</section>
<a class="btn primary" id="cpShop" href="${esc(shopHref)}" rel="noopener">${ICON.bag}<span>${esc(W.shop)}</span></a>
<div class="row">
<button type="button" class="btn" id="cpCopy">${ICON.copy.replace('<svg ', '<svg fill="none" stroke="currentColor" stroke-width="2" ')}<span>${esc(W.copy)}</span></button>
<button type="button" class="btn" id="cpSave">${ICON.img}<span id="cpSaveTxt">${esc(W.save)}</span></button>
</div>
${wa ? `<a class="btn wa" href="${esc(wa)}" rel="noopener">${ICON.wa}<span>${esc(W.wa)}</span></a>` : ''}
<button type="button" class="btn" id="cpShare" hidden>${ICON.share}<span>${esc(W.share)}</span></button>
<section class="store"><h2>${esc(W.store)}</h2><p>${esc(W.storeSub)}</p>
<div class="bar" id="cpBar"></div><small dir="ltr">${esc(c.scanToken)}</small></section>
${foot(W, site)}
</main>
<script type="application/json" id="cpData">${jsonIn(data)}</script>
<script src="/js/codes.js"></script>
<script src="/js/couponcard.js"></script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('cpData').textContent);
  var hint = document.getElementById('cpHint');
  function say(t, ok) { hint.textContent = t; hint.className = 'hint' + (ok ? ' ok' : ''); }
  function copy() {
    var done = function () { say(D.words.copied, true); setTimeout(function () { say(D.words.tapCopy); }, 2400); };
    try { navigator.clipboard.writeText(D.code).then(done, fallback); } catch (e) { fallback(); }
    function fallback() {
      var t = document.createElement('textarea'); t.value = D.code; t.setAttribute('readonly', '');
      t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(t);
    }
  }
  document.getElementById('cpCode').addEventListener('click', copy);
  document.getElementById('cpCopy').addEventListener('click', copy);

  var bar = document.getElementById('cpBar');
  try { if (window.Codes) bar.innerHTML = Codes.code128SVG(D.token, { module: 2.4, height: 70, text: false }); } catch (e) {}

  var save = document.getElementById('cpSave'), saveTxt = document.getElementById('cpSaveTxt');
  if (!window.CouponCard) save.hidden = true;
  save.addEventListener('click', function () {
    if (save.disabled) return;
    save.disabled = true; saveTxt.textContent = D.words.saving;
    CouponCard.save(D).then(function (how) {
      saveTxt.textContent = how === 'cancelled' ? D.words.save : D.words.saved;
    }, function () { saveTxt.textContent = D.words.save; }).then(function () {
      save.disabled = false;
      setTimeout(function () { saveTxt.textContent = D.words.save; }, 2600);
    });
  });

  var share = document.getElementById('cpShare');
  if (navigator.share) {
    share.hidden = false;
    share.addEventListener('click', function () {
      navigator.share({ title: D.share.title, text: D.share.text, url: D.url }).catch(function () {});
    });
  }
})();
</script>`);
}

export function notFound(langIn, links) {
  const lang = langIn === 'en' ? 'en' : 'ar';
  const W = WORDS[lang];
  const other = lang === 'ar' ? '?lang=en' : '?lang=ar';
  return shell(lang, 'OG Sports', `<main>${top(W, other)}
<section class="gone"><h1>${esc(W.nfHead)}</h1><p>${esc(W.nfBody)}</p></section>
<a class="btn primary" href="${esc(links.siteUrl)}" rel="noopener">${ICON.bag}<span>${esc(W.visit)}</span></a>
${foot(W, links.siteUrl)}</main>`);
}

/* For a test, and for anything else that has to agree with the page. */
export { waLink, valueEn, valueAr };
