/* ==========================================================================
   OG SYSTEM — the delivery office                                  [Desk]
   --------------------------------------------------------------------------
   A till for orders that do not walk in: a phone call, an Instagram message,
   a WhatsApp chat. The office scans the shoes into an invoice, says who it is
   for, where it is going and how it travels, takes whatever was paid up
   front, and prints.

   THE SERVER DECIDES. Every figure drawn here — the line prices, the fee, the
   total, what is still owed — is a preview of the arithmetic in
   server/lib/orders.js, so the office is never surprised at Save. What is
   written is what the server works out: prices from the product table, the
   fee from the price list, the balance recomputed inside the transaction.

   THE DRAFT SURVIVES A REFRESH. An order half-typed while the customer is on
   the phone is kept in localStorage on every change, opId included — so a
   Save that lost the wifi and is pressed again returns the order it already
   made instead of making a second one.

   ONE STEP AT A TIME: bag, customer, how it travels, where to, the money —
   one centred panel (#dkStage), a rail over it, Back and Next under it.

   Repaints patch the step's body (#dkBody), the foot and the rail, and never call
   render(): half this screen is typed-but-unsaved, and a full repaint takes
   the caret out of the box somebody is typing a phone number into.
   ========================================================================== */

var Desk = (function () {

  var DRAFT_KEY = 'og.desk.draft';
  var PRINT_KEY = 'og.desk.print';

  /* Handed to a company that never collects for the shop — the same list as
     COMPANY_METHODS in server/lib/orders.js. */
  var COMPANY = ['office', 'courier', 'abroad'];
  var ON_RECEIPT = ['driver', 'pickup'];
  var METHODS = ['driver', 'office', 'courier', 'abroad', 'pickup'];
  var CHANNELS = ['phone', 'instagram', 'whatsapp', 'web', 'other'];

  var boot = null;        /* GET /api/orders/bootstrap */
  var bootErr = null;
  var loading = false;
  var S = null;           /* the draft */
  var saved = null;       /* the order just made, for the result card */
  var celebrated = null;  /* the order whose "saved" card has already landed once */
  var lastStamp = null;   /* the ticket's stamp last drawn, so it thumps only on a change */
  var busy = false;

  /* ------------------------------------------------------------------ draft */

  function printPref() {
    try { return localStorage.getItem(PRINT_KEY) || (boot && boot.settings.print) || 'slip'; }
    catch (e) { return (boot && boot.settings.print) || 'slip'; }
  }

  function fresh() {
    return {
      v: 1,
      lines: [],                       /* [{ sku, qty }], newest first */
      whId: boot ? boot.settings.wh : null,
      customerId: null, custQ: '',
      channel: 'whatsapp',
      country: 'SY', city: '', address: '', recipient: '', phone: '', someoneElse: false,
      method: 'driver', companyId: '',
      /* auto = the price list, courier = the customer pays the courier,
         none = no shipping. A typed fee overrides the list. */
      feeMode: 'auto', feeTyped: '',
      currency: null,                  /* null = follow the destination */
      discount: '',
      plan: 'receipt', planTouched: false,
      pays: [],                        /* [{ amount, currency, method, txnRef }] */
      note: '',
      print: printPref(),
      opId: null,
      step: 0,                         /* the step on screen, kept so a refresh returns to it */
      maxStep: 0                       /* the furthest step reached, for the rail's ticks */
    };
  }

  function loadDraft() {
    try {
      var v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!(v && v.v === 1 && Array.isArray(v.lines))) return null;
      /* A draft saved before the steps existed has none. */
      if (typeof v.step !== 'number' || v.step < 0 || v.step > 4) v.step = 0;
      if (typeof v.maxStep !== 'number') v.maxStep = v.step;
      return v;
    } catch (e) { return null; }
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ }
  }

  function dropDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function newOpId() {
    return 'ord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ------------------------------------------------------------------ money
     Minor units and a currency code everywhere, exactly as the server holds
     them. A number typed into a box is whole units and is converted once, on
     the way in. */

  function currency(code) {
    var list = (boot && boot.currencies) || [];
    return list.filter(function (c) { return c.code === code; })[0] || null;
  }

  function expOf(code) {
    var c = currency(code);
    return c ? Number(c.minor_exp) || 0 : (code === 'USD' ? 2 : 0);
  }

  /* USD -> code, the direction every rate in the database is stored in. */
  function rate(code) {
    if (code === 'USD') return 1;
    return boot && boot.rates ? Number(boot.rates[code]) || null : null;
  }

  function convert(amount, from, to) {
    if (from === to) return Math.round(Number(amount) || 0);
    var rf = rate(from), rt = rate(to);
    if (!rf || !rt) return null;
    var whole = (Number(amount) || 0) / Math.pow(10, expOf(from));
    return Math.round(whole * (rt / rf) * Math.pow(10, expOf(to)));
  }

  /* A COMMA IS A DECIMAL POINT HERE, AND IT WAS BEING DELETED.

     This stripped everything but digits and dots, so "12,50" — which is how
     everybody in this shop writes twelve and a half — became "1250" and a
     $12.50 deposit was recorded as **$1,250**. A hundred times too big, on
     the one screen where the figure is read out over the phone and agreed.

     Both separators are real and which is which depends on what follows it:
     three digits after the last separator is a thousands group ("2,250",
     "1.250"), anything else is the decimal part ("12,50", "12.5"). When both
     kinds appear the LAST one is always the decimal, whatever follows it.
     A fraction on a currency with no minor unit (lira) rounds to the nearest
     whole rather than being thrown away. */
  /* ----------------------------------------------------------------------
     THE DIGITS SOMEBODY ACTUALLY TYPES                     (night shift 03)
     JS `\d` is ASCII only, so an Arabic phone keyboard's ١٢٠ was stripped to
     nothing and every money box in the shop read ZERO — in an app whose
     shop reads Arabic first. Arabic-Indic (٠-٩) and Persian (۰-۹) digits
     are folded to ASCII here, once, for every parser below.

     The Arabic separators are UNAMBIGUOUS where the Latin ones are not:
     ٬ is always a thousands group, so it is simply dropped, and ٫ is always
     the decimal, so it skips the "three digits after the separator means a
     thousands group" guess entirely. A space — ordinary, no-break or narrow
     — is a thousands group too, and was already thrown away by the
     character class. */
  function foldDigits(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[٠-٩۰-۹]/g, function (d) {
        var c = d.charCodeAt(0);
        return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
      });
  }

  /* ONE reading of a typed figure, for money and for a count alike: which
     digits are the whole part and which are after the decimal. Three digits
     after the last separator is a thousands group, anything else is the
     decimal, and when both kinds appear the last one wins — unless ٫ said
     so outright, which settles it. */
  function figure(typed) {
    var raw = foldDigits(typed);
    var hardDec = raw.indexOf('٫') > -1;

    /* A MINUS IN FRONT MEANS NOTHING, NOT ITS OPPOSITE (fix 05). Every
       figure this shop types is a quantity or an amount, and neither has a
       negative — a correction is its own row, never a sign in a box. The
       minus used to be stripped with the rest of the punctuation, so "-500"
       read as five hundred and a slipped finger moved money the way the
       typed figure said it should not. A leading minus is now the same
       answer as an empty box: nothing. */
    if (/^[^\d]*[-−–—]/.test(raw)) return null;

    var s = raw.replace(/٬/g, '').replace(/٫/g, '.').replace(/[^\d.,]/g, '');
    if (!s.replace(/\D/g, '')) return null;

    var lastDot = s.lastIndexOf('.');
    var lastCom = s.lastIndexOf(',');
    var sep = Math.max(lastDot, lastCom);
    var dec = -1;
    if (sep > -1) {
      var after = s.length - sep - 1;
      var mixed = lastDot > -1 && lastCom > -1;
      /* A THOUSANDS GROUP CANNOT FOLLOW A BARE ZERO (fix 05). The
         three-digits rule is right for "1.250" — twelve hundred and fifty,
         which is how this shop writes it — and wrong for "0.005", where it
         read the whole part as 0005 and made half a cent into five dollars.
         Nothing is ever written "0,500" meaning five hundred. */
      var head = s.slice(0, sep).replace(/\D/g, '');
      var zeroHead = head === '' || /^0+$/.test(head);
      if (hardDec || mixed || after !== 3 || zeroHead) dec = sep;
    }
    return {
      whole: (dec > -1 ? s.slice(0, dec) : s).replace(/\D/g, ''),
      frac: (dec > -1 ? s.slice(dec + 1) : '').replace(/\D/g, '')
    };
  }

  function toMinor(typed, code) {
    var f = figure(typed);
    if (!f) return 0;
    var e = expOf(code);
    var v = Number(f.whole || '0');
    if (!isFinite(v)) return 0;

    var minor = v * Math.pow(10, e);
    if (f.frac) {
      if (e > 0) minor += Number((f.frac + '00000000').slice(0, e));
      else if (Number(f.frac.charAt(0)) >= 5) minor += 1;
    }
    return minor > 0 ? Math.round(minor) : 0;
  }

  /* A COUNTED THING — pairs, pieces, a quantity on a shelf. Whole numbers,
     never negative, and it reads exactly the digits `toMinor` reads: four
     places parsed a quantity with a bare Number() or parseInt(), and every
     one of them turned "1 000" and "١٢" into 0 without a word.
     `opts.empty` is what an EMPTY box means, which is not the same answer as
     zero — the stock count has to tell "not counted" from "counted none". */
  function toCount(typed, opts) {
    opts = opts || {};
    var f = figure(typed);
    if (!f) return opts.empty === undefined ? 0 : opts.empty;
    var n = Math.floor(Number(f.whole || '0'));
    if (!isFinite(n) || n < 0) n = 0;
    if (opts.max !== undefined) n = Math.min(opts.max, n);
    if (opts.min !== undefined) n = Math.max(opts.min, n);
    return n;
  }

  function wholeOf(minor, code) {
    return (Number(minor) || 0) / Math.pow(10, expOf(code));
  }

  /* The figure as text, for WhatsApp and for the value of an input. */
  function moneyText(minor, code) {
    var e = expOf(code);
    var v = wholeOf(minor, code);
    var n = v.toLocaleString('en-US', { minimumFractionDigits: e && v % 1 ? e : 0, maximumFractionDigits: e });
    if (code === 'USD') return '$' + n;
    var c = currency(code);
    var sym = c ? (OG.lang === 'ar' && c.symbol_ar ? c.symbol_ar : c.symbol) : code;
    return n + ' ' + (OG.lang === 'ar' && code === 'SYP' ? 'ل.س' : sym);
  }

  /* The same on screen, isolated so Arabic cannot drag the digits around. */
  function fmt(minor, code) {
    return '<bdi dir="ltr">' + esc(moneyText(minor, code)) + '</bdi>';
  }

  /* --------------------------------------------------------- the price list
     A twin of feeFor in server/lib/orders.js, for the preview only. */

  function sameCity(row, city) {
    var c = String(city || '').trim().toLowerCase();
    if (!c) return false;
    return [row.id, row.city_en, row.city_ar].some(function (v) {
      return String(v || '').trim().toLowerCase() === c;
    });
  }

  function priceRow() {
    if (!boot || S.method === 'pickup') return null;
    var best = null, bestN = -1;
    (boot.settings.prices || []).forEach(function (r) {
      if (!r || r.active === false || r.country !== S.country) return;
      if (r.method && r.method !== S.method) return;
      var hasCity = !!(r.city_en || r.city_ar);
      if (hasCity && !sameCity(r, S.city)) return;
      var n = (hasCity ? 2 : 0) + (r.method ? 1 : 0);
      if (n > bestN) { best = r; bestN = n; }
    });
    return best;
  }

  /* ======================================================================
     THE COUNTRY FOLLOWS THE CITY                          (night shift 03)
     Three orders in the sandbox are Aleppo addresses filed under JO and TR.
     That is not somebody being careless — it is five separate ways for the
     pair to disagree, none of them guarded:

       1  changing the city never touched the country;
       2  the country is part of the DRAFT, which lives in localStorage, so
          one order to Amman left TR/JO on the next five;
       3  "use the last address" copied the two with independent fallbacks
          (`r.dest.country || S.country`), so a destination carrying a city
          and no country kept the PREVIOUS order's country;
       4  picking a customer filled the city and never the country;
       5  a one-country shop drew no control at all, so a draft already
          carrying TR could never be corrected from that screen.

     Now: a city the price list knows sets its own country, and the country
     may only be CHOSEN when the parcel is going abroad. Everything else is
     the shop's own country, stated rather than offered — and a draft that
     arrives holding another one is put right on the next paint, which is
     what closes (2) and (5) together.

     NOTHING EXISTING IS EDITED. The three rows already in the sandbox are
     history and stay as they are; they are listed in the log instead. */

  /* The shop's own country: the first active one in the owner's own list.
     Derived, never invented — `delivery.countries` is his. */
  function homeCountry() {
    var list = ((boot && boot.settings.countries) || []).filter(function (c) { return c && c.active !== false; });
    return (list[0] || {}).id || 'SY';
  }

  /* Which country this city belongs to, per the shipping price list. Null
     when the list has never heard of it — a city nobody has priced says
     nothing about where it is, and guessing would be inventing a fact. */
  function countryForCity(city) {
    var rows = (boot && boot.settings.prices) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.active === false) continue;
      if (!(r.city_en || r.city_ar)) continue;
      if (sameCity(r, city)) return r.country || null;
    }
    return null;
  }

  /* Abroad is the one method where the country is a question. */
  function abroad() { return S.method === 'abroad'; }

  /* Called wherever the city, the method or the customer moves. Returns true
     when it changed something, so the caller can repaint. */
  function syncCountry() {
    var was = S.country;
    if (!abroad()) {
      S.country = homeCountry();
    } else {
      var byCity = countryForCity(S.city);
      if (byCity) S.country = byCity;
      else if (!countryRow(S.country)) S.country = homeCountry();
    }
    return S.country !== was;
  }

  function countryRow(id) {
    return ((boot && boot.settings.countries) || []).filter(function (c) { return c && c.id === id; })[0] || null;
  }

  /* The order's currency: chosen, or the price row's, or the country's, or
     the shop's own. */
  function orderCur() {
    if (S.currency && currency(S.currency)) return S.currency;
    var row = priceRow();
    if (row && currency(row.currency)) return row.currency;
    var c = countryRow(S.country);
    if (c && currency(c.currency)) return c.currency;
    return (boot && boot.base) || 'SYP';
  }

  function feeInfo() {
    if (S.method === 'pickup' || S.feeMode === 'none') return { amount: 0, mode: 'none', source: null };
    var code = orderCur();
    var courier = S.feeMode === 'courier';
    if (String(S.feeTyped).trim() !== '') {
      return { amount: toMinor(S.feeTyped, code), mode: courier ? 'courier' : 'invoice', source: 'manual' };
    }
    var row = priceRow();
    if (row) {
      var amt = convert(Math.round(Number(row.fee) || 0), row.currency, code);
      return { amount: amt || 0, mode: courier ? 'courier' : (row.fee_mode === 'courier' ? 'courier' : 'invoice'),
               source: 'list', row: row };
    }
    return { amount: 0, mode: courier ? 'courier' : 'none', source: null };
  }

  function product(line) {
    var v = DB.variantBySku(line.sku);
    return v ? { v: v, p: DB.product(v.productId) } : null;
  }

  /* One unit, in the order's currency — the server's per-unit conversion,
     rounded per unit and then multiplied, so the two cannot disagree. */
  function unitPrice(line) {
    var hit = product(line);
    if (!hit || !hit.p) return null;
    return convert(hit.p.srcSellingPrice, hit.p.srcCurrency, orderCur());
  }

  function payInOrder(p) {
    var code = orderCur();
    var pc = p.currency && currency(p.currency) ? p.currency : code;
    var minor = toMinor(p.amount, pc);
    return minor ? convert(minor, pc, code) : 0;
  }

  function totals() {
    var code = orderCur();
    var sub = 0, unpriced = false;
    S.lines.forEach(function (l) {
      var u = unitPrice(l);
      if (u === null) unpriced = true; else sub += u * l.qty;
    });
    var disc = Math.min(sub, toMinor(S.discount, code));
    var fee = feeInfo();
    var due = sub - disc + (fee.mode === 'invoice' ? fee.amount : 0);
    var paid = 0;
    S.pays.forEach(function (p) { paid += payInOrder(p) || 0; });
    var maxPct = boot ? Number(boot.maxDiscountPct) : 100;
    return {
      currency: code, subtotal: sub, discount: disc, fee: fee, due: due, paid: paid,
      remaining: Math.max(0, due - paid), over: paid > due, unpriced: unpriced,
      discountTooBig: disc > 0 && !allow('discount.unlimited') && disc > Math.floor(sub * maxPct / 100),
      maxPct: maxPct
    };
  }

  /* Why Save cannot be pressed yet, in words — the server refuses every one
     of these as well; this is so the office hears it before the customer
     does. */
  function reasons(tt) {
    var r = [];
    if (!S.lines.length) r.push(t('dk_r_items'));
    /* NOT ENOUGH AT THE PLACE IT IS PACKED FROM. The server refuses the whole
       order for it (insufficient_stock), so letting it reach Save meant five
       steps of typing ended in "Only 0 of OG-050-42 left" and nothing printed. */
    else if (shortLines().length) r.push(t('dkp_r_short').replace('{wh}', whLabel(S.whId)));
    if (!S.customerId) r.push(t('dk_r_customer'));
    if (S.method !== 'pickup' && !String(S.address).trim()) r.push(t('dk_r_address'));
    /* SHIPPING HAS TO BE ANSWERED, not left to a price list that may say
       nothing. The list ships empty, so every order was saving with no
       shipping on it and the money panel never mentioned it — the shop was
       giving away the carriage without deciding to. Three answers count: a
       row in the price list (even a zero one), a figure typed here, or
       "the customer pays the courier". Silence does not. */
    if (S.method !== 'pickup' && S.feeMode === 'auto' && !tt.fee.source) r.push(t('dk_r_fee'));
    if (S.plan === 'receipt' && COMPANY.indexOf(S.method) > -1) r.push(t('dk_r_receipt'));
    if (tt.over) r.push(t('dk_r_over'));
    if (S.plan === 'full' && tt.remaining > 0) r.push(t('dk_r_full'));
    if (S.plan === 'deposit' && !tt.paid) r.push(t('dk_r_deposit'));
    if (tt.discountTooBig) r.push(t('dk_r_discount').replace('{n}', nf(tt.maxPct)));
    S.pays.forEach(function (p) {
      if (toMinor(p.amount, p.currency || tt.currency) > 0 && DB.payNeedsRef(p.method) &&
          !String(p.txnRef || '').trim()) {
        r.push(t('dk_r_ref').replace('{m}', DB.payLabel(p.method)));
      }
    });
    return r;
  }

  /* -------------------------------------------------------------- scanning */

  /* The desk owns the scanner while it is on screen and no dialog is open
     over it — a dialog is somebody else's question. */
  function owns() {
    return OG.view === 'desk' && !!boot && !(typeof modalOpen === 'function' && modalOpen());
  }

  /* A slip's barcode is the invoice number. On an Arabic keyboard layout the
     scanner's letters arrive as Arabic letters (js/wedge.js reads e.key) and
     only the digits survive, so the number is matched by its digits. */
  function invoiceFrom(code) {
    var m = /^\D{0,4}-?(\d{3,})$/.exec(String(code || '').trim());
    return m ? 'INV-' + m[1] : null;
  }

  function scanned(raw) {
    var code = String(raw || '').trim();
    if (!code) return;
    var list = DB.variantsByCode(code);
    if (list.length) {
      ColourPick.choose(list, { whId: S.whId, needStock: true }, function (v) { if (v) addVariant(v); });
      return;
    }
    var inv = invoiceFrom(code);
    if (inv) { openOrder(inv); return; }
    toast(t('dk_title'), t('dk_unknown_code') + ' · ' + code.slice(0, 40), 'warn');
  }

  function addVariant(v) {
    /* Whatever put it in — a pick from the list, Enter, the gun — the list
       has done its job and the box is ready for the next pair. */
    pick.open = false;
    pick.q = '';
    pick.hi = -1;
    if (saved) startNew();
    var p = DB.product(v.productId);
    if (!p || p.archived) { toast(t('dk_title'), t('dk_archived'), 'warn'); return; }
    var line = S.lines.filter(function (l) { return l.sku === v.sku; })[0];
    if (line) line.qty += 1;
    else { line = { sku: v.sku, qty: 1 }; S.lines.unshift(line); }
    S.flash = v.sku;
    touch('items', 'sum');
    /* Scanned while another step is on screen: it still goes in the bag, and
       says so, because the bag is not in view to show it. */
    if (S.step !== 0) {
      toast(p.name + ' · ' + DB.variantLabel(v), t('dkw_added').replace('{n}', nf(pieces())), 'ok', 2600);
    }
    var have = DB.stockAt(v, S.whId);
    if (have < line.qty) {
      toast(p.name + ' · ' + DB.variantLabel(v),
        t('dk_short').replace('{n}', nf(have)).replace('{wh}', DB.whName(S.whId, OG.lang === 'ar')),
        'warn', 3500);
    }
  }

  function startNew() {
    S = fresh();
    saved = null;
    saveDraft();
    repaint();
  }

  /* THE ONE BUTTON IN THIS OFFICE THAT DESTROYS WORK. It sits in the page
     head beside "Camera", two centimetres from the scan box, and a half-typed
     order — three pairs scanned, the customer found, the address read off a
     WhatsApp message — went with one press and no question.

     It asks only when there is something to lose: on an empty draft, and
     straight after a save (where it is the obvious next thing), it just
     starts the next order. */
  function askNew() {
    if (saved || !(S.lines.length || S.customerId || String(S.address || '').trim())) {
      startNew();
      return;
    }
    openModal({
      title: t('dk_new'), size: 'narrow',
      body: '<div class="partner-note">' + t('dk_new_sure').replace('{n}', nf(pieces())) + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="dk-new-go">' + t('dk_new_yes') + '</button>'
    });
  }

  /* What the chosen plan means, as a payment row ready to be typed over — so
     the commonest order is two taps. Called from wherever the plan can move,
     which is both the plan chips and the travel method (a courier cannot be
     paid on receipt, so choosing one moves the plan by itself). */
  function planPrefill() {
    var tt = totals();
    if (S.plan === 'receipt') { S.pays = []; return; }
    if (S.pays.length && toMinor(S.pays[0].amount, tt.currency)) return;
    var want = S.plan === 'full' ? tt.due : Math.round(tt.due / 2);
    S.pays = [{ amount: moneyPlain(want, tt.currency), currency: tt.currency, method: 'cash', txnRef: '' }];
  }

  /* Save the draft and patch the named panels. */
  function touch() {
    saveDraft();
    for (var i = 0; i < arguments.length; i++) paint(arguments[i]);
  }

  /* --------------------------------------------------------------- loading */

  function load() {
    if (loading) return;
    loading = true;
    API.get('/api/orders/bootstrap').then(function (b) {
      boot = b;
      bootErr = null;
      loading = false;
      if (!S) S = loadDraft() || fresh();
      if (!S.whId) S.whId = b.settings.wh;
      /* A draft restored onto a step it can no longer be on — a product
         archived since, a customer merged away — goes back to the first
         step that still needs answering. */
      while (S.step > 0 && !canReach(S.step)) S.step--;
      repaint();
    }).catch(function (err) {
      loading = false;
      bootErr = API.friendly(err);
      repaint();
    });
  }

  function after() {
    if (!Auth.can('delivery.desk')) return;
    if (!boot) { load(); return; }
    focusStep();
  }

  function repaint() {
    /* The Settings folds are drawn by app-settings.js, so when the bootstrap
       lands while somebody is on that screen, the page itself has to redraw —
       otherwise the four folds sit empty until the next navigation. */
    if (OG.view === 'settings') { renderKeepScroll(); return; }
    if (OG.view !== 'desk') return;
    var host = document.getElementById('view');
    if (host) host.innerHTML = view();
    markCustHi(false);
    focusStep();
  }

  /* ----------------------------------------------------------------- views */

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('dk_title') + '</h1>' +
      '<div class="sub">' + t('dk_sub') + '</div></div>' +
      '<div class="head-actions">' +
        ifNav('deliveries', '<button class="btn btn-ghost btn-sm" data-act="nav" data-view="deliveries">' +
          t('dk_to_board') + ' →</button>') +
        '<button class="btn btn-sm" data-act="dk-camera">' + t('dk_camera') + '</button>' +
        '<button class="btn btn-sm" data-act="dk-new">' + t('dk_new') + '</button>' +
      '</div></div>';

    if (bootErr) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(bootErr) + '</b>' +
        '<button class="btn btn-sm mt" data-act="dk-reload">' + t('retry') + '</button></div></div>';
    }
    if (!boot || !S) {
      return head + '<div class="card"><div class="cart-empty"><b>' + t('loading') + '</b></div></div>';
    }

    return head +
      '<nav class="dk-rail dk-wiz-rail" id="dkRail" aria-label="' + esc(t('dkp_rail')) + '">' + railSteps() + '</nav>' +
      stageHtml();
  }

  /* ONE STEP AT A TIME. Three panels side by side read as three forms to be
     filled at once, and the person on the phone with a customer needs one
     question in front of them: what is in the bag, who it is for, how it
     travels, where to, and the money. The office asked for exactly that.

     Nothing about the order changed underneath: every step reads and writes
     the same draft (S), the step itself is kept in it so a refresh comes
     back to the step it was on, and what may not be left yet is reasons()'s
     own list split by step (stepReason) — so Next and Save can never
     disagree about what is missing. A scan never moves the screen on: an
     order is often three pairs, and Next is pressed when the bag is full. */
  var STEP_KEYS = ['bag', 'customer', 'method', 'address', 'pay'];
  var stageDir = '';          /* ' is-fwd' | ' is-back', for the one paint after a step change */

  function stageHtml() {
    var dir = stageDir;
    stageDir = '';
    if (saved) {
      return '<section class="card dk-stage is-done' + dir + '" id="dkStage">' +
        '<div class="dk-body" id="dkBody">' + resultHtml() + '</div></section>';
    }
    var i = S.step;
    return '<section class="card dk-stage' + dir + '" id="dkStage">' +
      '<header class="dk-stage-head">' +
        '<span class="dk-stage-n">' + t('dkw_step_n').replace('{n}', nf(i + 1)) + '</span>' +
        '<h2>' + t('dkw_t_' + STEP_KEYS[i]) + '</h2><p>' + t('dkw_d_' + STEP_KEYS[i]) + '</p>' +
      '</header>' +
      '<div class="dk-body" id="dkBody">' + stepBody() + '</div>' +
      '<footer class="dk-nav" id="dkNav">' + navHtml() + '</footer>' +
    '</section>';
  }

  function stepBody() {
    switch (S.step) {
      case 1: return customerHtml();
      case 2: return methodHtml();
      case 3: return addressHtml();
      case 4: return payHtml();
      default: return itemsHtml();
    }
  }

  var CHEV = '<svg class="dk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  var CHEV_BACK = '<svg class="dk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  /* The foot of every step: back, what the order comes to with whatever is
     still missing, and the way on — Save, on the last step. It sticks to the
     bottom of the screen, so the next move is never a scroll away. */
  function navHtml() {
    var tt = totals();
    var i = S.step;
    var why = stepReason(i, tt);
    var note = why
      ? '<span class="is-why">' + esc(why) + '</span>'
      : '<span>' + (S.lines.length ? piecesText() : '') +
          (i === 0 && S.lines.length && !coarse() ? ' · ' + t('dkw_enter_hint') : '') + '</span>';
    return (i > 0
        ? '<button type="button" class="btn btn-ghost dk-back" data-act="dk-back">' + CHEV_BACK +
          '<span>' + t('dkw_back') + '</span></button>'
        : '<span class="dk-nav-gap"></span>') +
      '<div class="dk-nav-mid"><b>' + fmt(tt.due, tt.currency) + '</b>' + note + '</div>' +
      (i < 4
        ? '<button type="button" class="btn btn-primary dk-next" data-act="dk-next"' + (why ? ' disabled' : '') + '>' +
          '<span>' + t('dkw_next') + '</span>' + CHEV + '</button>'
        : '<button type="button" class="btn btn-primary dk-next" data-act="dk-save"' +
          (why || busy ? ' disabled' : '') + '>' + (busy ? t('dk_saving') : t('dk_save')) + '</button>');
  }

  /* Which step a part's content lives on. A change repaints the step's body
     only when that step is the one on screen — typing an address must not
     rebuild the box the caret is in — while the rail and the foot, which
     answer "can I go on" and "what does it come to", repaint with anything. */
  var PART_STEP = { items: [0], who: [1, 2, 3], sum: [4] };

  function paint(part) {
    if (OG.view !== 'desk' || !boot || !S) return;
    var body = document.getElementById('dkBody');
    if (body) {
      if (saved) { if (part === 'sum') body.innerHTML = resultHtml(); }
      else if ((PART_STEP[part] || []).indexOf(S.step) > -1) body.innerHTML = stepBody();
    }
    var nav = document.getElementById('dkNav');
    if (nav) nav.innerHTML = navHtml();
    var rail = document.getElementById('dkRail');
    if (rail) rail.innerHTML = railSteps();
    if (part === 'items' && S.step === 0 && !saved) focusScan();
    if (S.step === 1) markCustHi(false);
  }

  /* Back to the scan box after a line lands — unless somebody is typing
     somewhere else on the page, in which case the scanner's keys already
     went into Wedge and the box they are in stays theirs. */
  /* A PHONE IS NOT A COUNTER WITH A SCANNER GUN ON IT. Focusing the box on
     arrival is exactly right at the desk — the gun types into whatever has
     focus — and exactly wrong on a phone, where it throws the keyboard up
     over the screen before anybody has decided to type. Asked of the pointer,
     not of the width: a tablet with a keyboard and a gun is a desk. */
  function coarse() {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  /* Enter in the box is a person typing, not the gun — js/wedge.js swallows
     the gun's own Enter once the keys were fast enough to be a scan. Bound
     once per element, whether or not the box is about to be focused. */
  function wireScan(el) {
    if (el.__wired) return;
    el.__wired = true;
    el.addEventListener('click', function () { if (!pick.open) openDrop(); });
    el.addEventListener('keydown', function (e) {
      var k = e.key;

      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        if (!pick.open) {
          openDrop();
          if (pick.hi < 0) { pick.hi = firstInStockOpt(); markHi(true); }
          return;
        }
        if (!pick.opts.length) return;
        pick.hi = pick.hi < 0 ? firstInStockOpt()
          : Math.max(0, Math.min(pick.opts.length - 1, pick.hi + (k === 'ArrowDown' ? 1 : -1)));
        markHi(true);
        return;
      }

      /* Esc closes the list; a second Esc empties the box. */
      if (k === 'Escape') {
        if (pick.open) { e.preventDefault(); closeDrop(); }
        else if (el.value) { e.preventDefault(); el.value = ''; pick.q = ''; }
        return;
      }

      if (k !== 'Enter') return;
      e.preventDefault();
      var code = String(el.value || '').trim();

      /* A code typed in full is a scan. */
      if (code) {
        var exact = DB.variantsByCode(code).length > 0;
        if (exact || invoiceFrom(code)) { el.value = ''; pick.q = ''; closeDrop(); scanned(code); return; }
      }
      /* The lit size in the list. */
      if (pick.open && pick.hi > -1 && pick.opts[pick.hi]) {
        var lit = DB.variantBySku(pick.opts[pick.hi]);
        if (lit) { addVariant(lit); return; }
      }
      /* An empty box and Enter: the bag is full, go on. */
      if (!code) { closeDrop(); nextStep(); return; }
      openDrop(el.value);
    });
  }

  function focusScan() {
    var el = document.getElementById('dkScan');
    if (!el) return;
    wireScan(el);
    markHi(false);
    if (coarse()) return;
    var a = document.activeElement;
    if (a && a !== document.body && a !== el && !(a.closest && a.closest('#dkStage'))) return;
    el.focus();
  }

  /* WHY THIS STEP CANNOT BE LEFT YET, in words — or '' when it can. Each is
     one of reasons()'s own refusals, filed under the step it belongs to; the
     last step answers with the first of whatever reasons() still has. */
  function stepReason(i, tt) {
    if (i === 0) {
      if (!S.lines.length) return t('dk_r_items');
      return shortLines().length ? t('dkp_r_short').replace('{wh}', whLabel(S.whId)) : '';
    }
    if (i === 1) return S.customerId ? '' : t('dk_r_customer');
    if (i === 2) return '';
    if (i === 3) {
      if (S.method === 'pickup') return '';
      if (!String(S.address || '').trim()) return t('dk_r_address');
      if (S.feeMode === 'auto' && !tt.fee.source) return t('dk_r_fee');
      return '';
    }
    var r = reasons(tt);
    return r.length ? r[0] : '';
  }

  /* A step can be opened once every step before it is answered. A pickup
     has no address step at all. */
  function canReach(n, tt) {
    tt = tt || totals();
    for (var j = 0; j < n && j < 4; j++) {
      if (j === 3 && S.method === 'pickup') continue;
      if (stepReason(j, tt)) return false;
    }
    return true;
  }

  function goStep(n) {
    if (!S || saved || n < 0 || n > 4) return;
    /* A pickup's address step is stepped over, in whichever direction. */
    if (n === 3 && S.method === 'pickup') n = n > S.step ? 4 : 2;
    if (n === S.step) return;
    if (n > S.step && !canReach(n)) return;
    stageDir = n > S.step ? ' is-fwd' : ' is-back';
    pick.open = false;
    pick.hi = -1;
    cpick.open = false;
    cpick.hi = -1;
    S.step = n;
    S.maxStep = Math.max(S.maxStep || 0, n);
    saveDraft();
    repaint();
    /* On a long step scrolled down, the next one must start at its top. */
    var rail = document.getElementById('dkRail');
    if (rail && rail.getBoundingClientRect().top < 0) {
      try { rail.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { rail.scrollIntoView(); }
    }
  }

  function nextStep() {
    if (!S || saved || S.step >= 4 || stepReason(S.step, totals())) return;
    goStep(S.step + 1);
  }

  function prevStep() {
    if (!S || saved || S.step <= 0) return;
    goStep(S.step - 1);
  }

  /* Where the caret goes when a step opens: the box the step is answered in.
     Never on a phone, where a focus throws the keyboard over the step you
     were just shown, and never on the last step, where Enter must not save.
     On "how it travels" it is Next, so Enter takes the default and goes on. */
  function focusStep() {
    if (!S || saved || OG.view !== 'desk') return;
    if (S.step === 0) { focusScan(); return; }
    if (coarse()) return;
    var sel = S.step === 1 ? '#dkCust' : S.step === 2 ? '.dk-next' : S.step === 3 ? '[data-k="address"]' : null;
    var el = sel ? document.querySelector(sel) : null;
    if (!el || el.disabled) return;
    setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 40);
  }

  /* THE RAIL: five steps, the one on screen ringed, the answered ones
     ticked, a pickup's address step struck through. A step is a button only
     when it can actually be opened, so pressing ahead of an unanswered step
     does nothing rather than something wrong. */
  function railSteps() {
    var tt = totals();
    return '<ol>' + STEP_KEYS.map(function (k, i) {
      var skip = i === 3 && S.method === 'pickup';
      var cur = !saved && i === S.step;
      var done = saved || (!cur && i < 4 && i <= (S.maxStep || 0) && !stepReason(i, tt));
      var st = skip ? 'skip' : cur ? 'now' : done ? 'on' : 'off';
      var open = !saved && !cur && !skip && canReach(i, tt);
      return '<li class="' + st + '"><button type="button" data-act="dk-go" data-id="' + i + '"' +
        (open ? '' : ' disabled') + '>' +
        '<i>' + (st === 'on' ? '✓' : st === 'skip' ? '–' : nf(i + 1)) + '</i>' +
        '<span>' + t('dkw_r_' + k) + '</span></button></li>';
    }).join('') + '</ol>';
  }

  /* THE STAMP ON THE TICKET: what happens to the money, in the words said to
     the customer on the phone, drawn from the same totals as the panel. It
     thumps only when its answer CHANGES — a stamp that re-landed on every
     keystroke in the discount box would be noise, not news. */
  function stampKind(tt) {
    if (!S.lines.length || tt.due <= 0 || tt.over) return null;
    if (tt.remaining <= 0) return 'paid';
    if (COMPANY.indexOf(S.method) > -1) return 'first';
    if (tt.paid > 0) return 'deposit';
    return S.method === 'pickup' ? 'pickup' : 'door';
  }

  function stampHtml(tt) {
    var k = stampKind(tt);
    var fresh = !!k && k !== lastStamp;
    lastStamp = k;
    return k ? '<div class="dk-stamp-row"><span class="dk-stamp is-' + k + (fresh ? ' is-fresh' : '') + '">' +
      t('dkp_st_' + k) + '</span></div>' : '';
  }

  function scanIcon(cls) {
    return '<svg class="dk-ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>';
  }

  function pieces() {
    return S.lines.reduce(function (a, l) { return a + l.qty; }, 0);
  }

  function whLabel(id) { return DB.whName(id, OG.lang === 'ar'); }

  /* The lines the place the order is packed from cannot cover, by the stock
     this browser last loaded. The server has the last word at Save; this is
     so the person hears it on the bag step, where it can still be fixed. */
  function shortLines(whId) {
    var at = whId || S.whId;
    return S.lines.filter(function (l) {
      var v = DB.variantBySku(l.sku);
      return !!v && DB.stockAt(v, at) < l.qty;
    });
  }

  /* Another place that holds EVERYTHING in the bag — the order is packed from
     one place, so a place that covers only some of it is not an answer. */
  function coveringPlace() {
    var list = (boot && boot.warehouses) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== S.whId && !shortLines(list[i].id).length) return list[i].id;
    }
    return null;
  }

  /* Where else a size is, and how many — for the line that is short. */
  function bestElsewhere(v) {
    var best = null;
    ((boot && boot.warehouses) || []).forEach(function (w) {
      if (w.id === S.whId) return;
      var n = DB.stockAt(v, w.id);
      if (n > 0 && (!best || n > best.n)) best = { id: w.id, n: n };
    });
    return best;
  }

  /* "1 pieces" is how a screen tells you nobody read it. */
  function piecesText() {
    var n = pieces();
    return n === 1 ? t('dkw_one_piece') : nf(n) + ' ' + t('dk_pieces');
  }

  /* ------------------------------------------------------ 1. what's in the bag */

  function itemsHtml() {
    var tt = totals();
    /* The scan box and the product list are ONE control: the gun types into
       it, a person types into it, and a click opens the list under it. */
    var h = '<div class="dk-combo' + (pick.open ? ' is-open' : '') + '" id="dkCombo">' +
      '<div class="dk-scan">' + scanIcon() +
        '<input class="inp" id="dkScan" type="text" autocomplete="off" spellcheck="false" role="combobox" ' +
          'aria-autocomplete="list" aria-controls="dkDrop" aria-expanded="' + (pick.open ? 'true' : 'false') + '" ' +
          'data-change="dk-q" value="' + esc(pick.q) + '" placeholder="' + esc(t('dkc_ph')) + '">' +
        '<button type="button" class="dk-combo-btn" data-act="dk-browse" aria-label="' + esc(t('dkc_browse')) + '" ' +
          'title="' + esc(t('dkc_browse')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '</div>' +
      '<div class="dk-drop" id="dkDrop" role="listbox"' + (pick.open ? '>' + dropHtml() : ' hidden>') + '</div>' +
    '</div>';

    h += '<div class="dk-wh"><span class="lbl">' + t('dk_take_from') + '</span><div class="seg-row">';
    (boot.warehouses || []).forEach(function (w) {
      h += '<button type="button" class="seg' + (S.whId === w.id ? ' on' : '') + '" data-act="dk-wh" data-id="' +
        esc(w.id) + '">' + esc(DB.whName(w.id, OG.lang === 'ar')) + '</button>';
    });
    h += '</div></div>';

    /* What the place cannot cover, said above the lines with the way out:
       pack from the place that has all of it, or refresh a stale count. */
    var short = S.lines.length ? shortLines() : [];
    if (short.length) {
      var other = coveringPlace();
      h += '<div class="dk-shortbar" role="alert"><div>' +
          '<b>' + t('dkp_short_head').replace('{wh}', esc(whLabel(S.whId))) + '</b>' +
          '<span>' + short.map(function (l) {
            var sv = DB.variantBySku(l.sku), sp = sv ? DB.product(sv.productId) : null;
            return esc((sp ? sp.name : l.sku) + (sv ? ' · ' + DB.variantLabel(sv) : '')) + ' (' +
              t('dkp_n_here').replace('{n}', nf(sv ? DB.stockAt(sv, S.whId) : 0)) + ')';
          }).join(' · ') + '</span></div>' +
        '<div class="dk-shortbar-acts">' +
          (other ? '<button type="button" class="btn btn-sm" data-act="dk-wh" data-id="' + esc(other) + '">' +
            t('dkp_pack_from').replace('{wh}', esc(whLabel(other))) + '</button>' : '') +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="dk-restock">' + t('dkp_restock') + '</button>' +
        '</div></div>';
    }

    if (!S.lines.length) {
      return h + '<div class="dk-empty"><span class="dk-laser">' + scanIcon('big') + '<i></i></span>' +
        '<b>' + t('dk_empty') + '</b>' +
        '<span>' + t('dk_empty_sub') + '</span></div>';
    }

    h += '<div class="dk-lines">';
    S.lines.forEach(function (l) {
      var hit = product(l);
      if (!hit || !hit.p) {
        h += '<div class="dk-line is-short"><div class="dk-l-txt"><b><bdi dir="ltr">' + esc(l.sku) + '</bdi></b>' +
          '<small>' + t('dk_gone') + '</small></div><span></span><span></span>' +
          '<button type="button" class="dk-x" data-act="dk-drop" data-sku="' + esc(l.sku) + '" aria-label="' +
          esc(t('dk_remove')) + '">&times;</button></div>';
        return;
      }
      var u = unitPrice(l);
      var have = DB.stockAt(hit.v, S.whId);
      var short = have < l.qty;
      h += '<div class="dk-line' + (S.flash === l.sku ? ' is-new' : '') + (short ? ' is-short' : '') + '">' +
        thumb(hit.p, 'dk-thumb') +
        '<div class="dk-l-txt"><b>' + esc(hit.p.name) + '</b>' +
          '<small>' + t('size') + ' ' + esc(DB.variantLabel(hit.v)) + ' · <bdi dir="ltr">' + esc(l.sku) + '</bdi>' +
          (short ? ' · <span class="dk-short">' + t('dk_only').replace('{n}', nf(have)) +
            (function () {
              var e = bestElsewhere(hit.v);
              return e ? ' · ' + t('dkp_there').replace('{wh}', esc(whLabel(e.id))).replace('{n}', nf(e.n)) : '';
            })() + '</span>' : '') +
          '</small></div>' +
        '<div class="dk-qty">' +
          '<button type="button" data-act="dk-qty" data-sku="' + esc(l.sku) + '" data-d="-1" aria-label="−">−</button>' +
          '<b class="num">' + nf(l.qty) + '</b>' +
          '<button type="button" data-act="dk-qty" data-sku="' + esc(l.sku) + '" data-d="1" aria-label="+">+</button>' +
        '</div>' +
        '<div class="dk-l-money">' + (u === null ? '<span class="muted">—</span>'
          : '<b>' + fmt(u * l.qty, tt.currency) + '</b>' + (l.qty > 1 ? '<small>' + fmt(u, tt.currency) + '</small>' : '')) +
        '</div>' +
        '<button type="button" class="dk-x" data-act="dk-drop" data-sku="' + esc(l.sku) + '" aria-label="' +
          esc(t('dk_remove')) + '">&times;</button>' +
      '</div>';
    });
    S.flash = null;
    return h + '</div>';
  }

  /* ---- the product picker ------------------------------------------------
     THE SCAN BOX IS ALSO A SEARCH. Click it and the products drop down under
     it — with an empty box, what is in stock at the place the order is packed
     from, most first; type and the list narrows on the name, the brand, the
     colourway, a size, the SKU, the barcode or the label code, every word
     having to match. Each product carries its sizes as chips with the count
     on hand; a click or Enter puts that size in the bag, ↑ ↓ walk the sizes.

     It opens on a CLICK, a keystroke or ↓ — never on focus. The box is
     focused again after every line lands, so the gun is always ready, and a
     list springing open at each of those would bury the bag being built.

     A code typed in full and Enter is still a scan (the size goes straight
     in), and the gun itself never goes near the list: js/wedge.js hands the
     code to scanned(), which closes it.

     CAPPED, AND SAYS SO. The list draws the first PICK_MAX matches and the
     head names the total — a list that quietly stops at thirty is how
     somebody concludes the shop does not stock the thirty-first. */
  var PICK_MAX = 30;
  var pick = { open: false, q: '', hi: -1, auto: false, opts: [] };

  function pickResults() {
    var tokens = DB.foldName(String(pick.q || '').trim()).split(/\s+/).filter(Boolean);
    /* One pass over the variants per paint, not one filter per product. */
    var byP = {};
    DB.liveVariants().forEach(function (v) { (byP[v.productId] = byP[v.productId] || []).push(v); });

    var rows = [];
    DB.products.forEach(function (p) {
      if (p.archived) return;
      var vs = byP[p.id] || [];
      if (tokens.length) {
        var hay = DB.foldName([p.name, p.brand, p.colorway].filter(Boolean).join(' ') + ' ' +
          vs.map(function (v) { return [v.size, v.sku, v.barcode, v.labelCode].filter(Boolean).join(' '); }).join(' '));
        for (var i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) < 0) return;
      }
      var have = vs.reduce(function (a, v) { return a + (DB.stockAt(v, S.whId) || 0); }, 0);
      rows.push({ p: p, vs: vs, have: have });
    });

    /* An empty box shows what is on hand here — and everything, saying so,
       when nothing is. */
    var fallback = false;
    if (!tokens.length) {
      var inStock = rows.filter(function (r) { return r.have > 0; });
      if (inStock.length) rows = inStock; else fallback = true;
    }
    rows.sort(function (a, b) {
      return ((b.have > 0) - (a.have > 0)) ||
        (tokens.length ? 0 : b.have - a.have) ||
        String(a.p.name).localeCompare(String(b.p.name));
    });
    return { rows: rows.slice(0, PICK_MAX), total: rows.length, tokens: tokens, fallback: fallback };
  }

  function dropHtml() {
    var r = pickResults();
    var cur = orderCur();
    var wh = esc(DB.whName(S.whId, OG.lang === 'ar'));
    pick.opts = [];

    if (!r.rows.length) {
      pick.hi = -1;
      pick.auto = false;
      return '<div class="dk-drop-none">' + esc(t('dkc_no_match').replace('{q}', String(pick.q).trim())) + '</div>';
    }

    var head = r.tokens.length ? t('dkc_found').replace('{n}', nf(r.total))
      : r.fallback ? t('dkc_none_here').replace('{wh}', wh) : t('dkc_instock').replace('{wh}', wh);
    if (r.total > r.rows.length) head += ' · ' + t('dkc_shown').replace('{n}', nf(r.rows.length));
    var h = '<div class="dk-drop-head"><span>' + head + '</span>' +
      (coarse() ? '' : '<small>' + t('dkc_keys') + '</small>') + '</div>';

    var want = -1, firstIn = -1;
    r.rows.forEach(function (x) {
      var p = x.p;
      var skus = {};
      x.vs.forEach(function (v) { skus[v.sku] = 1; });
      var inBag = S.lines.reduce(function (a, l) { return a + (skus[l.sku] ? l.qty : 0); }, 0);
      var price = convert(p.srcSellingPrice, p.srcCurrency, cur);

      h += '<div class="dk-opt' + (x.have ? '' : ' is-out') + '">' + thumb(p, 'dk-thumb') +
        '<div class="dk-opt-txt">' +
          '<div class="dk-opt-top"><b>' + esc(p.name) + '</b>' +
            (price === null ? '' : '<span class="dk-opt-price">' + fmt(price, cur) + '</span>') + '</div>' +
          '<small>' + (p.brand ? esc(p.brand) + ' · ' : '') + t('dkc_have').replace('{n}', nf(x.have)) +
            (inBag ? ' · <em>' + t('dkc_in_bag').replace('{n}', nf(inBag)) + '</em>' : '') + '</small>' +
          '<div class="dk-sizes">' + x.vs.map(function (v) {
            var have = DB.stockAt(v, S.whId);
            var i = pick.opts.length;
            pick.opts.push(v.sku);
            if (firstIn < 0 && have > 0) firstIn = i;
            /* "samba 43": the 43 is the size the person means. */
            if (want < 0 && have > 0 && r.tokens.indexOf(DB.foldName(v.size)) > -1) want = i;
            return '<button type="button" class="dk-size' + (have ? '' : ' is-out') + '" data-act="dk-add" ' +
              'data-sku="' + esc(v.sku) + '" data-opt="' + i + '" role="option" tabindex="-1">' +
              esc(DB.variantLabel(v)) + '<i class="num">' + nf(have) + '</i></button>';
          }).join('') + '</div>' +
        '</div></div>';
    });

    /* After a keystroke the first size worth adding is lit, so Enter does the
       obvious thing; an untouched list lights nothing, so Enter still means
       "the bag is full, go on". */
    if (pick.auto) {
      pick.hi = r.tokens.length ? (want > -1 ? want : firstIn > -1 ? firstIn : 0) : -1;
      pick.auto = false;
    }
    if (pick.hi >= pick.opts.length) pick.hi = pick.opts.length - 1;
    return h;
  }

  /* Only the list repaints while somebody types — never the box itself. */
  function paintDrop() {
    var host = document.getElementById('dkDrop');
    if (!host) return;
    var combo = document.getElementById('dkCombo');
    var box = document.getElementById('dkScan');
    host.hidden = !pick.open;
    if (combo) combo.classList.toggle('is-open', pick.open);
    if (box) box.setAttribute('aria-expanded', pick.open ? 'true' : 'false');
    host.innerHTML = pick.open ? dropHtml() : '';
    markHi(true);
  }

  /* The lit option in a list, scrolled into the list's own view — never the
     page's. One helper for both pickers. */
  function lightOpt(hostId, index, scroll) {
    var host = document.getElementById(hostId);
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('.is-hi'), function (b) { b.classList.remove('is-hi'); });
    var b = index > -1 ? host.querySelector('[data-opt="' + index + '"]') : null;
    if (!b) return;
    b.classList.add('is-hi');
    if (!scroll) return;
    var hr = host.getBoundingClientRect(), br = b.getBoundingClientRect();
    if (br.top < hr.top + 40) host.scrollTop -= (hr.top + 40) - br.top;
    else if (br.bottom > hr.bottom) host.scrollTop += br.bottom - hr.bottom + 8;
  }

  function markHi(scroll) { lightOpt('dkDrop', pick.hi, scroll); }
  function markCustHi(scroll) { lightOpt('dkCustDrop', cpick.hi, scroll); }

  function openDrop(q) {
    if (q !== undefined) { pick.q = q; pick.auto = true; }
    pick.open = true;
    paintDrop();
  }

  function closeDrop() {
    if (!pick.open) return;
    pick.open = false;
    pick.hi = -1;
    paintDrop();
  }

  function firstInStockOpt() {
    for (var i = 0; i < pick.opts.length; i++) {
      if (DB.stockAt(DB.variantBySku(pick.opts[i]), S.whId) > 0) return i;
    }
    return pick.opts.length ? 0 : -1;
  }

  /* --------------------------------------------- 2. who, and how it travels */

  var METHOD_ICON = {
    driver:  'M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 16h8l2-5h-4M13 11l-2-4H8',
    office:  'M5 17V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11M5 12h14M8 20v-3M16 20v-3',
    courier: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    abroad:  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    pickup:  'M4 10v10h16V10M3 10l2-6h14l2 6M9 20v-6h6v6'
  };

  function methodIconSvg(m, cls) {
    return '<svg class="dlp-mi' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="' + (METHOD_ICON[m] || METHOD_ICON.driver) + '"/></svg>';
  }

  /* THE RAIL, the browser's twin of the one on the customer's tracking page
     (server/lib/receipt.js) — same four steps, same rule for each, so the
     board and the link a customer opens can never disagree about how far a
     parcel has got. Nothing is estimated: each dot is on because of a stamp
     the database holds. A parcel that has arrived is finished, every dot
     filled and none ringed; the ring means "still moving". */
  function railHtml(d, labels) {
    if (!d) return '';
    var done = d.status === 'delivered';
    var back = d.status === 'failed' || (d.returns > 0);
    var at = d.voided ? 0 : done ? 3 : d.status === 'out' ? 2 : (d.paid > 0 ? 1 : 0);
    var names = [t('dlp_r_placed'), t('dlp_r_paid'),
                 d.method === 'pickup' ? t('dlp_r_counter') : t('dlp_r_road'), t('dlp_r_arrived')];
    return '<ol class="og-rail' + (back ? ' is-back' : '') + (labels ? ' has-labels' : '') + '">' +
      names.map(function (n, i) {
        var st = d.voided ? 'off' : i < at ? 'on' : i === at ? (done ? 'on' : 'now') : 'off';
        return '<li class="' + st + '" title="' + esc(n) + '"><i></i>' + (labels ? '<span>' + n + '</span>' : '') + '</li>';
      }).join('') + '</ol>';
  }

  /* A person as two letters in their own colour — personFace/personTint in
     js/app-util.js, keyed on the account id so a driver is the same colour
     on the board, the sheet and the cash card. */
  function faceHtml(id, name) {
    var tint = typeof personTint === 'function' ? personTint(id) : null;
    var txt = typeof personFace === 'function' ? personFace(name) : String(name || '?').charAt(0);
    return '<span class="dlp-face"' + (tint ? ' style="color:' + tint.fg + ';background:' + tint.bg + '"' : '') +
      ' aria-hidden="true">' + esc(txt) + '</span>';
  }

  function segBtn(act, id, on, label) {
    return '<button type="button" class="seg' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' +
      esc(id) + '">' + label + '</button>';
  }

  function label(row) {
    return row ? esc(OG.lang === 'ar' ? (row.ar || row.en) : (row.en || row.ar)) : '';
  }

  /* ---- 2. who it is for, and where the order came from ---- */

  function customerHtml() {
    var h = '';
    var cust = S.customerId ? DB.customer(S.customerId) : null;

    if (cust) {
      h += '<div class="dk-cust is-picked">' + faceHtml(cust.id, cust.name) +
        '<div class="dk-cust-txt"><b>' + nm(cust.name) + '</b>' +
          '<small>' + (cust.phone ? tel(cust.phone) : '') + (cust.city ? ' · ' + nm(cust.city) : '') + '</small></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="dk-cust-clear">' + t('dk_change') + '</button>' +
      '</div>';
    } else {
      /* The same control as the bag's: a box that searches and a list that
         drops under it — and the button for somebody not in it yet, kept
         right beside it. */
      h += '<div class="dk-find">' +
        '<div class="dk-combo dk-ccombo' + (cpick.open ? ' is-open' : '') + '" id="dkCustCombo">' +
          '<div class="dk-scan">' +
            '<svg class="dk-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 20a8 8 0 0 1 16 0"/></svg>' +
            '<input class="inp" id="dkCust" type="text" autocomplete="off" spellcheck="false" role="combobox" ' +
              'aria-autocomplete="list" aria-controls="dkCustDrop" aria-expanded="' + (cpick.open ? 'true' : 'false') + '" ' +
              'data-change="dk-cust" placeholder="' + esc(t('dk_cust_ph')) + '" value="' + esc(S.custQ) + '">' +
            '<button type="button" class="dk-combo-btn" data-act="dk-cdrop" aria-label="' + esc(t('dkc_cust_browse')) + '" ' +
              'title="' + esc(t('dkc_cust_browse')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '</div>' +
          '<div class="dk-drop" id="dkCustDrop" role="listbox"' + (cpick.open ? '>' + custDropHtml() : ' hidden>') + '</div>' +
        '</div>' +
        (allow('customer.write')
          ? '<button type="button" class="btn dk-cust-newbtn" data-act="dk-cust-new">+ ' + t('dk_cust_new') + '</button>' : '') +
      '</div>';
    }

    h += '<div class="dk-row"><span class="lbl">' + t('dk_channel') + '</span><div class="seg-row">';
    CHANNELS.forEach(function (c) { h += segBtn('dk-channel', c, S.channel === c, t('dk_ch_' + c)); });
    h += '</div></div>';
    return h;
  }

  /* ---- 3. how it travels ----
     Before the address, because a pickup has no destination at all and a
     company changes what may be paid on receipt. */

  function methodHtml() {
    var h = '<div class="dk-methods">';
    METHODS.forEach(function (m) {
      h += '<button type="button" class="dk-method' + (S.method === m ? ' on' : '') + '" data-act="dk-method" data-id="' + m + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + METHOD_ICON[m] + '"/></svg>' +
        '<b>' + t('dk_m_' + m) + '</b><small>' + t('dk_m_' + m + '_sub') + '</small></button>';
    });
    h += '</div>';

    if (S.method === 'pickup') return h + '<div class="partner-note mt">' + t('dk_pickup_note') + '</div>';

    if (COMPANY.indexOf(S.method) > -1) {
      var cos = (boot.settings.companies || []).filter(function (c) {
        return c && c.active !== false && c.kind === S.method;
      });
      h += '<div class="dk-row"><span class="lbl">' + t('dk_company') + '</span>';
      if (!cos.length) {
        h += '<div class="dk-hint">' + t('dk_no_company') +
          (allow('config.write') ? ' <span class="clickable" data-act="dk-goto-companies">' +
            t('dk_add_in_settings') + '</span>' : '') + '</div>';
      } else {
        h += '<div class="seg-row">';
        cos.forEach(function (c) { h += segBtn('dk-company', c.id, S.companyId === c.id, label(c)); });
        h += '</div>';
      }
      h += '</div>';
    }
    return h;
  }

  /* ---- 4. where to, and the shipping ---- */

  function addressHtml() {
    if (S.method === 'pickup') {
      return '<div class="dk-empty">' + methodIconSvg('pickup', 'dk-ico big') +
        '<b>' + t('dkw_pickup_skip') + '</b><span>' + t('dk_pickup_note') + '</span></div>';
    }
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var h = '';
    if (cust) {
      h += '<div class="dk-last-row"><button type="button" class="btn btn-sm" data-act="dk-last">' +
        t('dk_last_address') + '</button></div>';
    }

    /* The country is put right before it is drawn, so a draft that arrives
       holding another one is corrected rather than shown. */
    syncCountry();
    var countries = (boot.settings.countries || []).filter(function (c) { return c && c.active !== false; });
    if (abroad() && countries.length > 1) {
      h += '<div class="dk-row"><span class="lbl">' + t('dk_country') + '</span><div class="seg-row">';
      countries.forEach(function (c) { h += segBtn('dk-country', c.id, S.country === c.id, label(c)); });
      h += '</div></div>';
    } else {
      /* Said, not offered. A parcel our own driver carries does not go to
         Turkey, and a control that can put it there is the whole fault. */
      h += '<div class="dk-row"><span class="lbl">' + t('dk_country') + '</span>' +
        '<div class="dk-hint">' + esc(label(countryRow(S.country)) || S.country) + '</div></div>';
    }

    var country = countryRow(S.country);
    h += '<div class="dk-2">' +
      '<label class="field"><span>' + t('dk_city') + '</span>' +
        '<input class="inp" type="text" list="dkCities" autocomplete="off" data-change="dk-field" data-k="city" ' +
          'value="' + esc(S.city) + '"></label>' +
      '<datalist id="dkCities">' + cityOptions().map(function (c) {
        return '<option value="' + esc(c) + '">';
      }).join('') + '</datalist>' +
      '<label class="field"><span>' + t('dk_phone') + '</span>' +
        '<input class="inp num" type="tel" dir="ltr" inputmode="tel" data-change="dk-field" data-k="phone" ' +
          'value="' + esc(S.phone) + '" placeholder="' + esc(cust && cust.phone ? cust.phone
            : (country && country.dial ? '+' + country.dial : '')) + '"></label>' +
    '</div>' +
    '<label class="field"><span>' + t('dk_address') + '</span>' +
      '<textarea class="inp" rows="2" data-change="dk-field" data-k="address" ' +
        'placeholder="' + esc(t('dk_addr_ph')) + '">' + esc(S.address) + '</textarea></label>' +
    '<label class="check dk-else"><input type="checkbox" data-change="dk-else"' + (S.someoneElse ? ' checked' : '') + '>' +
      '<span>' + t('dk_someone_else') + '</span></label>';

    if (S.someoneElse) {
      h += '<label class="field"><span>' + t('dk_recipient') + '</span>' +
        '<input class="inp" type="text" data-change="dk-field" data-k="recipient" value="' + esc(S.recipient) + '"></label>';
    }

    return h + feeHtml();
  }

  /* ---- the customer picker ----------------------------------------------
     The bag's picker, for people. A click, a keystroke or ↓ opens the list;
     an empty box lists the shop's customers most recent buyer first, and
     typing narrows it through custSearch() — the ONE rule for "which customer
     does this text mean" (name and city folded, the phone in any of its
     spellings), shared with the attach, merge and job-link pickers, so the
     office cannot find somebody the customers screen cannot. Archived and
     merged-away people are not offered.

     Capped at CUST_MAX and the head says so. Nothing matching offers to add
     what was typed as a new customer, beside the + New customer button that
     is always there. */
  var CUST_MAX = 30;
  var cpick = { open: false, hi: -1, auto: false, ids: [] };

  function custDropHtml() {
    var q = String(S.custQ || '').trim();
    var all = typeof custSearch === 'function' ? custSearch(q) : [];
    var rows = all.slice(0, CUST_MAX);
    var canAdd = allow('customer.write');
    cpick.ids = rows.map(function (c) { return c.id; });

    if (!rows.length) {
      cpick.hi = -1;
      cpick.auto = false;
      return '<div class="dk-drop-none">' +
          esc(q ? t('dkc_cust_none_q').replace('{q}', q) : t('dkc_cust_empty')) + '</div>' +
        (canAdd ? '<button type="button" class="dk-copt-new" data-act="dk-cust-new">+ ' +
          esc(q ? t('dkc_cust_add_q').replace('{q}', q) : t('dk_cust_new')) + '</button>' : '');
    }

    var head = q ? t('dkc_found').replace('{n}', nf(all.length)) : t('dkc_cust_recent');
    if (all.length > rows.length) head += ' · ' + t('dkc_shown').replace('{n}', nf(rows.length));
    var h = '<div class="dk-drop-head"><span>' + head + '</span>' +
      (coarse() ? '' : '<small>' + t('dkc_keys_c') + '</small>') + '</div>';

    rows.forEach(function (c, i) {
      /* Debt is null, not zero, for an account that may not see it. */
      var owes = (c.debtSyp > 0) || (c.debtUsd > 0);
      h += '<button type="button" class="dk-copt" data-act="dk-cust-pick" data-id="' + c.id + '" ' +
          'data-opt="' + i + '" role="option" tabindex="-1">' + faceHtml(c.id, c.name) +
        '<span class="dk-copt-txt"><b>' + nm(c.name) + '</b>' +
          '<small>' + (c.phone ? tel(c.phone) : t('dkc_cust_nophone')) + (c.city ? ' · ' + nm(c.city) : '') + '</small></span>' +
        '<span class="dk-copt-side">' +
          (owes ? '<em>' + t('dkc_cust_owes') + '</em>' : '') +
          '<small>' + (c.lastPurchaseDate ? t('dkc_cust_last').replace('{d}', fmtDate(c.lastPurchaseDate))
                                          : t('dkc_cust_never')) + '</small>' +
        '</span></button>';
    });

    /* After a keystroke the best match is lit, so Enter takes it. */
    if (cpick.auto) { cpick.hi = q ? 0 : -1; cpick.auto = false; }
    if (cpick.hi >= cpick.ids.length) cpick.hi = cpick.ids.length - 1;
    return h;
  }

  function paintCust() {
    var host = document.getElementById('dkCustDrop');
    if (!host) return;
    var combo = document.getElementById('dkCustCombo');
    var box = document.getElementById('dkCust');
    host.hidden = !cpick.open;
    if (combo) combo.classList.toggle('is-open', cpick.open);
    if (box) box.setAttribute('aria-expanded', cpick.open ? 'true' : 'false');
    host.innerHTML = cpick.open ? custDropHtml() : '';
    markCustHi(true);
  }

  function openCust(typed) {
    if (typed) cpick.auto = true;
    cpick.open = true;
    paintCust();
  }

  function closeCust() {
    if (!cpick.open) return;
    cpick.open = false;
    cpick.hi = -1;
    paintCust();
  }

  function custKey(e) {
    var el = e.target, k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!cpick.open) {
        openCust();
        if (cpick.hi < 0 && cpick.ids.length) { cpick.hi = 0; markCustHi(true); }
        return;
      }
      if (!cpick.ids.length) return;
      cpick.hi = cpick.hi < 0 ? 0
        : Math.max(0, Math.min(cpick.ids.length - 1, cpick.hi + (k === 'ArrowDown' ? 1 : -1)));
      markCustHi(true);
      return;
    }
    if (k === 'Escape') {
      if (cpick.open) { e.preventDefault(); closeCust(); }
      else if (el.value) { e.preventDefault(); el.value = ''; S.custQ = ''; }
      return;
    }
    if (k !== 'Enter') return;
    e.preventDefault();
    if (cpick.open && cpick.hi > -1 && cpick.ids[cpick.hi] != null) { pickCustomer(cpick.ids[cpick.hi]); return; }
    openCust(!!String(el.value || '').trim());
  }

  /* The cities the price list knows for this country, in the reader's
     language — offered, never required. */
  function cityOptions() {
    var seen = {}, out = [];
    (boot.settings.prices || []).forEach(function (r) {
      if (!r || r.active === false || r.country !== S.country) return;
      var name = OG.lang === 'ar' ? (r.city_ar || r.city_en) : (r.city_en || r.city_ar);
      if (name && !seen[name]) { seen[name] = 1; out.push(name); }
    });
    return out;
  }

  /* The fee line lives in its own host so typing a city or a fee repaints the
     sentence and not the box being typed into. */
  function feeLineHtml() {
    var tt = totals(), f = tt.fee;
    if (f.mode === 'courier') {
      return '<b>' + t('dk_fee_courier') + '</b>' +
        (f.amount ? ' <span class="muted">· ' + fmt(f.amount, tt.currency) + '</span>' : '');
    }
    if (S.feeMode === 'none') return '<b>' + t('dk_fee_none') + '</b>';
    if (f.source === 'list') return '<b>' + fmt(f.amount, tt.currency) + '</b> <span class="muted">· ' + t('dk_fee_from_list') + '</span>';
    if (f.source === 'manual') return '<b>' + fmt(f.amount, tt.currency) + '</b> <span class="muted">· ' + t('dk_fee_typed') + '</span>';
    return '<span class="muted">' + t('dk_fee_not_listed') + '</span>';
  }

  /* THE LIST IS EMPTY ON THIS SHOP, and that is why every order stalls here.
     Somebody who can fix it gets the door; somebody who cannot is told who
     to ask, rather than being sent to a screen they may not open. */
  function noPricesHint() {
    var any = (boot.settings.prices || []).some(function (p) { return p && p.active !== false; });
    if (any) return '';
    return '<div class="dk-hint">' + (allow('config.write')
      ? '<span class="clickable" data-act="dk-goto-prices">' + t('dk_no_prices') + ' →</span>'
      : t('dk_no_prices_ask')) + '</div>';
  }

  function feeHtml() {
    return '<div class="dk-fee"><span class="lbl">' + t('dk_shipping') + '</span>' +
      '<div class="dk-fee-line" id="dkFeeLine">' + feeLineHtml() + '</div>' +
      noPricesHint() +
      '<div class="dk-fee-ctl">' +
        '<div class="seg-row">' +
          segBtn('dk-feemode', 'auto', S.feeMode === 'auto', t('dk_fee_shop')) +
          segBtn('dk-feemode', 'courier', S.feeMode === 'courier', t('dk_fee_to_courier')) +
          segBtn('dk-feemode', 'none', S.feeMode === 'none', t('dk_fee_free')) +
        '</div>' +
        (S.feeMode === 'none' ? '' :
          '<input class="inp num" type="text" inputmode="decimal" dir="ltr" data-change="dk-fee" ' +
            'placeholder="' + esc(t('dk_fee_type')) + '" value="' + esc(S.feeTyped) + '">') +
      '</div></div>';
  }

  /* ------------------------------------------------ 4. the money, and Save */

  function sumRow(lbl, val) {
    return '<div class="dk-sr"><span>' + lbl + '</span><b>' + val + '</b></div>';
  }

  function receiptOk() { return ON_RECEIPT.indexOf(S.method) > -1; }

  function currencyChips(code) {
    var list = (boot.currencies || []);
    if (list.length < 2) return '';
    return '<span class="dk-cur">' + list.map(function (c) {
      var sym = c.code === 'USD' ? '$' : (OG.lang === 'ar' && c.symbol_ar ? c.symbol_ar : c.symbol);
      return '<button type="button" class="chip' + (code === c.code ? ' on' : '') + '" data-act="dk-cur" data-id="' +
        esc(c.code) + '">' + esc(sym) + '</button>';
    }).join('') + '</span>';
  }

  /* One payment. The amount may arrive in a currency other than the order's —
     a lira deposit against a dollar order is ordinary here — so the row says
     what it counts as, and the server freezes the rate it was worth. */
  function payRow(p, i, code) {
    var pc = p.currency && currency(p.currency) ? p.currency : code;
    var methods = DB.payMethodsFor('desk');
    if (!methods.length) methods = [{ id: 'cash', en: 'Cash', ar: 'نقداً' }];

    var h = '<div class="dk-pay"><div class="dk-pay-top">' +
      '<input class="inp num" type="text" inputmode="decimal" dir="ltr" data-change="dk-pay-amt" data-i="' + i + '" ' +
        'value="' + esc(p.amount) + '" placeholder="' + esc(t('dk_amount')) + '">';
    if ((boot.currencies || []).length > 1) {
      h += '<select class="inp dk-pay-cur" data-change="dk-pay-cur" data-i="' + i + '">' +
        boot.currencies.map(function (c) {
          return '<option value="' + esc(c.code) + '"' + (pc === c.code ? ' selected' : '') + '>' + esc(c.code) + '</option>';
        }).join('') + '</select>';
    }
    if (S.pays.length > 1) {
      h += '<button type="button" class="dk-x" data-act="dk-pay-drop" data-i="' + i + '" aria-label="' +
        esc(t('dk_remove')) + '">&times;</button>';
    }
    h += '</div><div class="dk-pay-methods">' + methods.map(function (m) {
      return '<button type="button" class="chip' + (p.method === m.id ? ' on' : '') + '" data-act="dk-pay-method" ' +
        'data-i="' + i + '" data-id="' + esc(m.id) + '">' +
        esc(OG.lang === 'ar' ? (m.ar || m.en) : (m.en || m.ar)) + '</button>';
    }).join('') + '</div>';

    if (DB.payNeedsRef(p.method)) {
      h += '<input class="inp dk-ref" type="text" dir="ltr" maxlength="64" data-change="dk-pay-ref" data-i="' + i + '" ' +
        'value="' + esc(p.txnRef) + '" placeholder="' + esc(t('dk_ref_ph')) + '">';
    }
    if (pc !== code && toMinor(p.amount, pc)) {
      h += '<div class="dk-pay-conv">' + esc(t('dk_counts_as').replace('{a}', moneyText(payInOrder(p), code))) + '</div>';
    }
    return h + '</div>';
  }

  /* THE ORDER, READ BACK before the money: one row per step, each a button
     back to the step it came from. This is the summary the one-panel layout
     owes the person — nothing they typed three steps ago is out of sight. */
  function reviewRow(i, lbl, main, sub) {
    return '<button type="button" class="dk-rv" data-act="dk-go" data-id="' + i + '">' +
      '<span class="dk-rv-lbl">' + lbl + '</span>' +
      '<span class="dk-rv-main"><b>' + main + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      '<span class="dk-rv-edit">' + t('dkw_edit') + '</span></button>';
  }

  function reviewHtml() {
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var items = S.lines.map(function (l) {
      var hit = product(l);
      return (hit && hit.p ? esc(hit.p.name) + ' · ' + esc(DB.variantLabel(hit.v)) : '<bdi dir="ltr">' + esc(l.sku) + '</bdi>') +
        ' ×' + nf(l.qty);
    }).join(' · ');
    var co = COMPANY.indexOf(S.method) > -1
      ? ((boot.settings.companies || []).filter(function (c) { return c && c.id === S.companyId; })[0] || null)
      : null;
    var phone = S.phone || (cust && cust.phone) || '';
    var place = [S.city ? nm(S.city) : '', label(countryRow(S.country))].filter(Boolean).join(' · ');

    var h = '<div class="dk-review">' +
      reviewRow(0, t('dkw_r_bag'), piecesText(), items) +
      reviewRow(1, t('dkw_r_customer'), cust ? nm(cust.name) : '—',
        (phone ? tel(phone) + ' · ' : '') + t('dk_ch_' + S.channel)) +
      reviewRow(2, t('dkw_r_method'), methodIconSvg(S.method) + '<span>' + t('dk_m_' + S.method) + '</span>',
        co ? label(co) : '');
    if (S.method !== 'pickup') {
      h += reviewRow(3, t('dkw_r_address'), place || '—',
        nm(S.address) + (S.someoneElse && S.recipient ? ' · ' + nm(S.recipient) : ''));
    }
    return h + '</div>';
  }

  function payHtml() {
    var tt = totals();
    var code = tt.currency;
    var h = reviewHtml();
    /* A RECEIPT, NOT A FORM. The money is drawn as the ticket the customer is
       about to be read over the phone: the bill, the stamp saying what
       happens to the money, then how it is paid. */
    h += '<div class="dk-tk-meta"><span>' + t('dkp_ticket') + '</span>' + currencyChips(code) + '</div>' +
      '<div class="dk-perf" aria-hidden="true"></div>';

    h += '<div class="dk-tot">' + sumRow(t('dk_goods'), fmt(tt.subtotal, code)) +
      '<div class="dk-sr dk-disc"><span>' + t('discount') + '</span>' +
        '<input class="inp num" type="text" inputmode="decimal" dir="ltr" data-change="dk-discount" ' +
          'value="' + esc(S.discount) + '" placeholder="0"></div>';
    if (tt.fee.mode === 'invoice' && tt.fee.amount) h += sumRow(t('dk_shipping'), fmt(tt.fee.amount, code));
    else if (tt.fee.mode === 'courier') h += sumRow(t('dk_shipping'), '<span class="muted">' + t('dk_fee_courier') + '</span>');
    h += '<div class="dk-due"><span>' + t('dk_due') + '</span><b>' + fmt(tt.due, code) + '</b></div></div>';
    h += stampHtml(tt) + '<div class="dk-perf" aria-hidden="true"></div>';

    h += '<div class="dk-row"><span class="lbl">' + t('dk_plan') + '</span><div class="seg-row">' +
      segBtn('dk-plan', 'full', S.plan === 'full', t('dk_plan_full')) +
      segBtn('dk-plan', 'deposit', S.plan === 'deposit', t('dk_plan_deposit')) +
      '<button type="button" class="seg' + (S.plan === 'receipt' ? ' on' : '') + (receiptOk() ? '' : ' is-off') +
        '" data-act="dk-plan" data-id="receipt">' + t('dk_plan_receipt') + '</button>' +
      '</div>' + (receiptOk() ? '' : '<div class="dk-hint">' + t('dk_r_receipt') + '</div>') + '</div>';

    h += '<div class="dk-pays">';
    S.pays.forEach(function (p, i) { h += payRow(p, i, code); });
    h += '</div><button type="button" class="btn btn-ghost btn-sm dk-split" data-act="dk-pay-add">+ ' +
      t('dk_split') + '</button>';

    h += '<div class="dk-paid">' + sumRow(t('dk_paid_now'), fmt(tt.paid, code)) +
      '<div class="dk-remain' + (tt.remaining ? ' owes' : ' clear') + '"><span>' + t('dk_remaining') + '</span>' +
        '<b>' + fmt(tt.remaining, code) + '</b></div>';
    if (tt.remaining && COMPANY.indexOf(S.method) > -1) {
      h += '<div class="dk-hint warn">' + t('dk_must_pay_first') + '</div>';
    } else if (tt.remaining && receiptOk()) {
      h += '<div class="dk-hint">' + t('dk_collect_on').replace('{m}', t('dk_m_' + S.method)) + '</div>';
    }
    h += '</div>';

    h += '<label class="field"><span>' + t('note') + '</span>' +
      '<input class="inp" type="text" data-change="dk-note" value="' + esc(S.note) + '" ' +
        'placeholder="' + esc(t('dk_note_ph')) + '"></label>';

    h += '<div class="dk-row"><span class="lbl">' + t('dk_print') + '</span><div class="seg-row">' +
      segBtn('dk-print', 'slip', S.print === 'slip', t('dk_print_slip')) +
      segBtn('dk-print', 'a4', S.print === 'a4', t('dk_print_a4')) +
      segBtn('dk-print', 'both', S.print === 'both', t('dk_print_both')) +
      segBtn('dk-print', 'none', S.print === 'none', t('dk_print_none')) +
      '</div></div>';

    /* Save is in the foot, like every Next; what still stops it is listed
       here, right above it. */
    var why = reasons(tt);
    if (why.length) {
      h += '<ul class="dk-why">' + why.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    }
    return h;
  }

  /* ------------------------------------------------------ the order, saved */

  function linkFor(o) {
    var tok = o && o.sale && o.sale.publicToken;
    return (boot && boot.publicBase && tok) ? boot.publicBase + '/i/' + tok : null;
  }

  /* Whichever order is in front of the person: the one in the modal while it
     is open, otherwise the one just saved. */
  function current() {
    if (viewing && typeof modalOpen === 'function' && modalOpen()) return viewing;
    return saved ? saved.order : null;
  }

  function trackLink() { return linkFor(current()); }

  function resultHtml() {
    var o = saved.order;
    var m = saved.money;
    var code = m.currency;
    var cust = o.sale.customerId ? DB.customer(o.sale.customerId) : null;
    var canWa = !!(cust && cust.phone);

    /* It lands ONCE. Recording the rest of a deposit repaints this card, and
       a celebration that replays every time is not one. */
    var anim = celebrated !== o.sale.id;
    celebrated = o.sale.id;
    var dv = o.delivery || null;
    var h = '<div class="dk-done' + (anim ? ' is-anim' : '') + '">' +
      '<svg class="dk-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/>' +
        '<path d="M15 27l7 7 15-16"/></svg>' +
      '<b><bdi dir="ltr">' + esc(o.sale.id) + '</bdi></b><span>' + t('dk_saved') + '</span>' +
      '<span class="dk-stamp is-saved">' + t('dkp_st_saved') + '</span></div>';
    if (dv) {
      h += '<div class="dk-done-route">' + methodIconSvg(dv.method || 'driver') +
        '<span>' + methodLine(dv) + (whereLine(dv) ? '<small>' + whereLine(dv) + '</small>' : '') + '</span></div>' +
        railHtml(dv, true);
    }

    h += '<div class="dk-tot">' + sumRow(t('dk_due'), fmt(m.due, code)) +
      sumRow(t('dk_paid_now'), fmt(m.paid, code)) +
      '<div class="dk-remain' + (m.remaining ? ' owes' : ' clear') + '"><span>' + t('dk_remaining') + '</span>' +
        '<b>' + fmt(m.remaining, code) + '</b></div></div>';

    h += '<div class="dk-acts">' +
      '<button class="btn" data-act="dk-print-slip" data-id="' + esc(o.sale.id) + '">' + t('dk_print_slip') + '</button>' +
      '<button class="btn" data-act="dk-print-a4" data-id="' + esc(o.sale.id) + '">' + t('dk_print_a4') + '</button>' +
      (canWa ? '<button class="btn" data-act="dk-wa" data-kind="confirm">' + t('dk_wa_confirm') + '</button>' : '') +
      (canWa && m.remaining ? '<button class="btn" data-act="dk-wa" data-kind="pay">' + t('dk_wa_pay') + '</button>' : '') +
      (trackLink() ? '<button class="btn" data-act="dk-wa" data-kind="track">' + t('dk_wa_track') + '</button>' : '') +
      (trackLink() ? '<button class="btn btn-ghost" data-act="dk-copy-link">' + t('dk_copy_link') + '</button>' : '') +
      (m.remaining ? '<button class="btn btn-ghost" data-act="dk-take-pay" data-id="' + esc(o.sale.id) + '">' +
        t('dk_take_payment') + '</button>' : '') +
      ifNav('deliveries', '<button class="btn btn-ghost" data-act="nav" data-view="deliveries">' + t('dk_to_board') + '</button>') +
      '<button class="btn btn-primary" data-act="dk-new">' + t('dk_new') + '</button>' +
    '</div>';
    return h;
  }

  /* --------------------------------------------------------------- an order
     Scanning a printed slip at the desk opens the order it belongs to — the
     same view the board's rows open. */

  function methodLine(d) {
    var m = t('dk_m_' + (d.method || 'driver'));
    if (d.companyName) m += ' · ' + esc(d.companyName);
    else if (d.driverName) m += ' · ' + nm(d.driverName);
    return m;
  }

  function whereLine(d) {
    var bits = [];
    if (d.city) bits.push(nm(d.city));
    var c = countryRow(d.country);
    if (c) bits.push(label(c));
    if (d.address) bits.push(nm(d.address));
    return bits.join(' · ');
  }

  /* The order the modal is showing, so the WhatsApp buttons and the tracking
     link work for ANY order and not only for the one just saved. Cleared by
     the modal's own onClose, whichever of the four ways out was taken. */
  var viewing = null;

  function orderModal(o) {
    viewing = o;
    var d = o.delivery;
    var code = o.sale.currency;
    var due = d.due, paid = d.paid, left = d.remaining;
    var body =
      '<div class="dk-ord-top">' +
        '<span class="dk-ord-mi">' + methodIconSvg(d.method || 'driver') + '</span>' +
        '<div><b><bdi dir="ltr">' + esc(o.sale.id) + '</bdi></b>' +
        '<small>' + nm(o.sale.customerName || t('walk_in')) +
          (o.customer && o.customer.phone ? ' · ' + tel(o.customer.phone) : '') + '</small></div>' +
        '<span class="badge ' + (d.voided ? 'neutral' : d.status === 'delivered' ? 'healthy'
          : d.status === 'failed' ? 'critical' : d.status === 'out' ? 'accent' : 'neutral') + '">' +
          t(d.voided ? 'dk_cancelled' : 'dl_' + d.status) + '</span></div>' +
      /* The same rail the customer's tracking link draws, with its words. */
      railHtml(d, true) +
      '<div class="dk-ord-where">' + methodLine(d) + (whereLine(d) ? '<small>' + whereLine(d) + '</small>' : '') +
        (d.trackingNo ? '<small><bdi dir="ltr">' + esc(d.trackingNo) + '</bdi></small>' : '') + '</div>' +
      '<div class="dk-tot dk-ord-tot">' + sumRow(t('dk_due'), fmt(due, code)) + sumRow(t('dk_paid_now'), fmt(paid, code)) +
        '<div class="dk-remain' + (left ? ' owes' : ' clear') + '"><span>' + t('dk_remaining') + '</span>' +
        '<b>' + fmt(left, code) + '</b></div></div>';

    if (o.items && o.items.length) {
      body += '<div class="lbl mt">' + t('dkp_in_bag') + '</div><div class="dk-ord-items">' + o.items.map(function (it) {
        return '<span>' + esc(it.name) + (it.size ? ' · ' + esc(DB.lineSize(it)) : '') + ' <b>×' + it.qty + '</b></span>';
      }).join('') + '</div>';
    }
    /* The money as a timeline — when it came, how, and who took it — because
       "did he pay the rest?" is answered by the last line, not by a total. */
    if (o.payments && o.payments.length) {
      body += '<div class="lbl mt">' + t('dkp_payments') + '</div><ol class="dk-ord-pays">' + o.payments.map(function (p) {
        var back = !!p.kind && p.kind !== 'in';
        return '<li class="' + (back ? 'is-out' : 'is-in') + '"><i aria-hidden="true"></i><div>' +
          '<span>' + esc(DB.payLabel(p.method)) + (p.txnRef ? ' · <bdi dir="ltr">' + esc(p.txnRef) + '</bdi>' : '') +
            '<small>' + (p.at ? fmtDateTime(p.at) : '') + (p.receivedBy ? ' · ' + nm(p.receivedBy) : '') +
              (back ? ' · ' + t('dkp_refund') : '') + '</small></span>' +
          '<b>' + fmt(p.amount, p.currency) + '</b></div></li>';
      }).join('') + '</ol>';
    }

    /* THE MESSAGES AND THE LINK LIVE HERE TOO, not only on the card that
       appears for as long as nobody scans the next customer's shoes. They
       were unreachable the moment that card went — and the shop's commonest
       question after an order is "send him the details again". Every one of
       these works off the order in front of you (current()), so scanning a
       slip is enough to get them back. */
    var cust = o.sale.customerId ? DB.customer(o.sale.customerId) : (o.customer || null);
    var canWa = !!((o.delivery && o.delivery.phone) || (cust && cust.phone));

    openModal({
      title: t('dk_order'), size: 'narrow', body: body,
      onClose: function () { viewing = null; },
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
        (canWa ? '<button class="btn" data-act="dk-wa" data-kind="confirm">' + t('dk_wa_confirm') + '</button>' : '') +
        (canWa && left ? '<button class="btn" data-act="dk-wa" data-kind="pay">' + t('dk_wa_pay') + '</button>' : '') +
        (linkFor(o) && !o.sale.voided ? '<button class="btn" data-act="dk-wa" data-kind="track">' + t('dk_wa_track') + '</button>' : '') +
        (linkFor(o) ? '<button class="btn btn-ghost" data-act="dk-copy-link">' + t('dk_copy_link') + '</button>' : '') +
        '<button class="btn" data-act="dk-print-slip" data-id="' + esc(o.sale.id) + '">' + t('dk_print_slip') + '</button>' +
        (left && allow('delivery.desk')
          ? '<button class="btn btn-primary" data-act="dk-take-pay" data-id="' + esc(o.sale.id) + '">' +
            t('dk_take_payment') + '</button>' : '') +
        ifNav('deliveries', '<button class="btn" data-act="dk-board-go">' + t('dk_to_board') + '</button>')
    });
  }

  function openOrder(saleId) {
    /* The dialog's WhatsApp messages and tracking link read the office's
       bootstrap (the public address, the transfer accounts), which was only
       fetched once the office screen had been opened — so a dialog opened from
       the board straight after sign-in had no tracking button and a
       confirmation with no link. Fetched first; the dialog opens either way. */
    ensureBoot()['catch'](function () { return null; })
      .then(function () { return API.get('/api/orders/by-sale/' + encodeURIComponent(saleId)); })
      .then(function (r) { orderModal(r.order); })
      .catch(function (err) {
        toast(t('dk_title'), err.code === 'not_found'
          ? t('dk_no_order').replace('{id}', saleId) : API.friendly(err), 'warn', 4000);
      });
  }

  /* ------------------------------------------------------------- printing */

  function printSlip(saleId) {
    if (typeof Receipt === 'undefined') return;
    Receipt.printSale(saleId);
  }

  /* The A4 invoice reads the sale out of the browser's own copy, so the shop
     is reloaded first when this order is newer than the last hydrate. */
  function printA4(saleId, order) {
    var open = function () {
      var s = DB.sale(saleId);
      if (!s) { toast(t('dk_title'), t('dk_a4_wait'), 'warn'); return; }
      openInvoice(s, { order: order || (saved && saved.order) || null });
    };
    if (DB.sale(saleId)) { open(); return; }
    Shop.reload().then(open).catch(function () { open(); });
  }

  function printAfterSave() {
    var id = saved && saved.order && saved.order.sale.id;
    if (!id || S.print === 'none') return;
    if (S.print === 'slip' || S.print === 'both') printSlip(id);
    if (S.print === 'a4' || S.print === 'both') printA4(id, saved.order);
  }

  /* ------------------------------------------------------------- WhatsApp */

  function firstNameOf(name) {
    if (typeof personFirst === 'function') return personFirst(name);
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  /* BOTH LANGUAGES IN EVERY MESSAGE. The office used to write in whichever
     language its own screen was in, so an English-reading customer in Amman
     got Arabic because the person at the desk works in Arabic. Now each
     message is the Arabic block, a rule, then the English block — the
     customer reads the half that is theirs and nobody chooses before Send.

     WhatsApp's own formatting: *bold* for each heading and for the figures a
     customer acts on, one emoji per heading so a long message can be scanned
     on a phone. Western digits in both halves. The Arabic half's link opens
     the Arabic page, the English half's opens ?lang=en.

     RLM (U+200F) starts an Arabic line that would otherwise begin with a
     Latin letter — a product name, a city typed in English — because WhatsApp
     takes each line's direction from its first strong letter, and that line
     would sit left-aligned in the middle of the Arabic. */
  var RLM = '‏';

  function moneyIn(minor, code, ar) {
    var e = expOf(code);
    var v = wholeOf(minor, code);
    var n = v.toLocaleString('en-US', { minimumFractionDigits: e && v % 1 ? e : 0, maximumFractionDigits: e });
    if (code === 'USD') return '$' + n;
    var c = currency(code);
    var sym = c ? (ar && c.symbol_ar ? c.symbol_ar : c.symbol) : code;
    return n + ' ' + (ar && code === 'SYP' ? 'ل.س' : sym);
  }

  function payName(id, ar) {
    var m = ((boot && boot.settings && boot.settings.methods) || [])
      .filter(function (x) { return x && x.id === id; })[0];
    if (m) return (ar ? (m.ar || m.en) : (m.en || m.ar)) || id;
    return DB.payLabel ? DB.payLabel(id) : id;
  }

  function itemsIn(o, ar) {
    return (o.items || []).map(function (it) {
      return (ar ? RLM : '') + '▫️ ' + it.name +
        (it.size ? (ar ? ' · مقاس ' : ' · size ') + DB.lineSize(it, ar) : '') + '  ×' + it.qty;
    }).join('\n');
  }

  function helloIn(o, ar) {
    var name = firstNameOf(o.sale.customerName || (o.customer && o.customer.name));
    return ar ? 'أهلاً' + (name ? ' ' + name : '') + ' 👋' : 'Hi' + (name ? ' ' + name : '') + ' 👋';
  }

  function trackUrl(o, ar) {
    var l = linkFor(o);
    return l ? l + (ar ? '' : '?lang=en') : null;
  }

  /* How it travels, as a sentence reads it — the office's own labels are
     button captions ("Our driver"), which read wrongly after "via". A named
     company is named instead. */
  var WA_VIA = {
    ar: { driver: 'سائق المحل', office: 'مكتب نقل', courier: 'شركة شحن', abroad: 'الشحن الخارجي' },
    en: { driver: 'our own driver', office: 'a transport office', courier: 'a courier company', abroad: 'shipping abroad' }
  };
  function viaIn(d, ar) {
    if (d.companyName) return d.companyName;
    var m = WA_VIA[ar ? 'ar' : 'en'];
    return m[d.method] || m.driver;
  }

  /* WA.both (js/whatsapp.js) is the one shape every WhatsApp message takes. */
  function waBoth(arLines, enLines) {
    return WA.both(arLines, enLines);
  }

  function waConfirm(o) {
    var d = o.delivery || {};
    var code = o.sale.currency;
    var owed = d.remaining > 0;
    function part(ar) {
      var L = [];
      var where = [d.city, (countryRow(d.country) || {})[ar ? 'ar' : 'en']].filter(Boolean).join(ar ? '، ' : ', ');
      var via = viaIn(d, ar);
      var url = trackUrl(o, ar);
      L.push('🛍️ *' + CONFIG.SHOP_NAME + '*' + (ar ? ' — تأكيد الطلب' : ' — Order confirmed'));
      L.push('');
      L.push(helloIn(o, ar));
      L.push(ar ? 'تم تثبيت طلبك رقم *' + o.sale.id + '* ✅' : 'Your order *' + o.sale.id + '* is confirmed ✅');
      L.push('');
      L.push(ar ? '🧾 *الطلب*' : '🧾 *Your order*');
      L.push(itemsIn(o, ar));
      L.push('');
      L.push(ar ? '💳 *الحساب*' : '💳 *Payment*');
      L.push((ar ? 'البضاعة: ' : 'Goods: ') + moneyIn(o.sale.total, code, ar));
      if (d.feeMode === 'invoice' && d.fee) L.push((ar ? 'الشحن: ' : 'Shipping: ') + moneyIn(d.fee, code, ar));
      if (d.feeMode === 'courier') L.push(ar ? 'الشحن: يُدفع لشركة الشحن عند الاستلام' : 'Shipping: paid to the courier on delivery');
      L.push((ar ? 'الإجمالي: *' : 'Total: *') + moneyIn(d.due, code, ar) + '*');
      if (d.paid) L.push((ar ? 'المدفوع: ' : 'Paid: ') + moneyIn(d.paid, code, ar));
      L.push(owed ? (ar ? 'المتبقي: *' : 'Still to pay: *') + moneyIn(d.remaining, code, ar) + '*'
                  : (ar ? '✔️ مدفوع بالكامل' : '✔️ Paid in full'));
      L.push('');
      if (d.method === 'pickup') {
        L.push(ar ? '🏬 *الاستلام*' : '🏬 *Pickup*');
        L.push(ar ? 'طلبك جاهز للاستلام من المحل.' : 'It is ready to collect from the shop.');
      } else {
        L.push(ar ? '🚚 *التوصيل*' : '🚚 *Delivery*');
        L.push((ar ? RLM : '') + (where ? where + ' — ' : '') + (ar ? 'عن طريق ' : 'via ') + via);
      }
      if (owed && ON_RECEIPT.indexOf(d.method) > -1) L.push(ar ? '💵 المتبقي يُدفع عند الاستلام.' : '💵 The rest is paid on delivery.');
      if (owed && COMPANY.indexOf(d.method) > -1) L.push(ar ? '📦 نشحن الطلب فور وصول المبلغ المتبقي.' : '📦 We ship as soon as the rest arrives.');
      if (url) {
        L.push('');
        L.push(ar ? '📍 *تابع طلبك مباشرة*' : '📍 *Track it live*');
        L.push(url);
      }
      L.push('');
      L.push(ar ? 'شكراً لثقتك بنا 🖤' : 'Thank you for shopping with us 🖤');
      return L;
    }
    return waBoth(part(true), part(false));
  }

  /* How to pay: the amount, and the shop's own account for each transfer
     method the owner has filled in (pay.accounts, config.write only). */
  function waPay(o) {
    var d = o.delivery || {};
    var code = o.sale.currency;
    var accounts = (boot && boot.settings && boot.settings.accounts) || {};
    function part(ar) {
      var L = [];
      L.push('💳 *' + CONFIG.SHOP_NAME + '*' + (ar ? ' — طريقة الدفع' : ' — How to pay'));
      L.push('');
      L.push(helloIn(o, ar));
      L.push(ar ? 'المبلغ المطلوب لطلبك *' + o.sale.id + '*:' : 'Amount due for order *' + o.sale.id + '*:');
      L.push('💰 *' + moneyIn(d.remaining, code, ar) + '*');
      if (COMPANY.indexOf(d.method) > -1) L.push(ar ? '📦 نشحن الطلب فور وصول المبلغ.' : '📦 We ship as soon as it arrives.');
      var rows = [];
      Object.keys(accounts).forEach(function (id) {
        var a = accounts[id] || {};
        var txt = ar ? (a.ar || a.en) : (a.en || a.ar);
        if (txt) rows.push((ar ? RLM : '') + '▫️ *' + payName(id, ar) + '*: ' + txt);
      });
      if (rows.length) {
        L.push('');
        L.push(ar ? '🏦 *طرق الدفع*' : '🏦 *You can pay by*');
        L = L.concat(rows);
      }
      L.push('');
      L.push(ar ? '📸 بعد التحويل أرسل لنا رقم العملية أو صورة الإشعار.'
                : '📸 After paying, send us the transaction number or a photo of the receipt.');
      return L;
    }
    return waBoth(part(true), part(false));
  }

  /* THE TRACKING LINK ON ITS OWN — the message sent most after the first one,
     because the question after an order is "where is it?". It says where it
     has got to right now and what is left to pay, since the link answers
     nothing until it is tapped, and it points at Notify me on the page, which
     is what saves the next question. Each half's link opens the page in that
     half's language (the page is Arabic unless ?lang=en). */
  var WA_STATE = {
    ar: { waiting: '⏳ قيد التجهيز', pickup: '🏬 جاهز للاستلام من المحل', out: '🚚 في الطريق إليك',
          delivered: '✅ تم التسليم', failed: '↩️ رجع إلى المحل', 'void': '✖️ ملغى' },
    en: { waiting: '⏳ Being prepared', pickup: '🏬 Ready to collect from the shop', out: '🚚 On its way to you',
          delivered: '✅ Delivered', failed: '↩️ Came back to the shop', 'void': '✖️ Cancelled' }
  };

  function waTrack(o) {
    var d = o.delivery || {};
    var code = o.sale.currency;
    var st = o.sale.voided ? 'void'
      : (d.status === 'waiting' && d.method === 'pickup') ? 'pickup'
      : (d.status || 'waiting');
    var moving = !o.sale.voided && d.status !== 'delivered';
    var owed = d.remaining > 0 && !o.sale.voided ? d.remaining : 0;
    function part(ar) {
      var S = WA_STATE[ar ? 'ar' : 'en'];
      var L = [];
      L.push('📦 *' + CONFIG.SHOP_NAME + '*' + (ar ? ' — تتبّع الطلب' : ' — Order tracking'));
      L.push('');
      L.push(helloIn(o, ar));
      L.push(ar ? 'تابع طلبك *' + o.sale.id + '* لحظة بلحظة من هنا 👇' : 'Follow your order *' + o.sale.id + '* live, right here 👇');
      L.push(trackUrl(o, ar));
      L.push('');
      L.push((ar ? '*الحالة الآن:* ' : '*Right now:* ') + (S[st] || S.waiting));
      if (owed) {
        L.push((ar ? '*المتبقي:* ' : '*Still to pay:* ') + moneyIn(owed, code, ar) +
          (ON_RECEIPT.indexOf(d.method) > -1 ? (ar ? ' — يُدفع عند الاستلام' : ' — on delivery')
            : COMPANY.indexOf(d.method) > -1 ? (ar ? ' — نشحن الطلب فور وصوله' : ' — we ship as soon as it arrives') : ''));
      }
      if (moving) {
        L.push('');
        L.push(ar ? '🔔 اضغط «فعّل الإشعارات» في الصفحة ليصلك إشعار عند كل تحرّك للطلب.'
                  : '🔔 Tap “Notify me” on the page to get a notification every time it moves.');
      }
      return L;
    }
    return waBoth(part(true), part(false));
  }

  function waSend(kind, o) {
    var cust = o.sale.customerId ? DB.customer(o.sale.customerId) : (o.customer || null);
    var phone = (o.delivery && o.delivery.phone) || (cust && cust.phone) || '';
    var track = kind === 'track';
    /* A link nobody outside the shop's wifi can open is not worth sending. */
    if (track && !linkFor(o)) { toast(t('dk_title'), t('dk_wa_no_link'), 'warn', 9000); return; }
    /* The tracking link is also sent to a number typed on the spot — a friend
       collecting it, a customer writing from another phone — so with no
       number on the order it opens the composer with the box empty instead
       of refusing. The two money messages still need the customer's own. */
    if (!phone && !track) { toast(t('dk_title'), t('dk_no_phone'), 'warn'); return; }
    var text = kind === 'pay' ? waPay(o) : track ? waTrack(o) : waConfirm(o);
    var waKind = kind === 'pay' ? 'order_pay' : track ? 'order_track' : 'order_confirm';

    /* wa.me cannot report a send, so what is recorded is that the message was
       OPENED, for which order, by whom — server/lib/partner.js logWhatsApp,
       written in 015 and never called until now. A number typed into the
       composer is not known here, so that one opens without a record. */
    if (phone) {
      API.post('/api/wa-messages', {
        phone: phone, body: text, kind: waKind, refType: 'sale', refId: o.sale.id
      }).catch(function () { /* the message still opens; the record is not the point of it */ });
    }

    WA.compose({
      to: phone, text: text, name: (cust && cust.name) || '', kind: waKind,
      title: kind === 'pay' ? t('dk_wa_pay') : track ? t('dk_wa_track') : t('dk_wa_confirm')
    });
  }

  /* From the Deliveries board, where the order in hand is a row, not the full
     order: fetch it (and the office's bootstrap, which knows the public
     address) and send the tracking link. */
  function sendTrack(saleId) {
    ensureBoot().then(function () {
      return API.get('/api/orders/by-sale/' + encodeURIComponent(saleId));
    }).then(function (r) {
      if (r && r.order) waSend('track', r.order);
    }).catch(function (e) { toast(t('dk_title'), API.friendly(e), 'err', 7000); });
  }

  /* ---------------------------------------------------------------- saving */

  function save() {
    if (busy || !S) return;
    var tt = totals();
    if (reasons(tt).length) return;

    /* Minted before the send and kept on the draft: a Save that lost the wifi
       and is pressed again returns the order it already made. */
    if (!S.opId) S.opId = newOpId();
    busy = true;
    paint('sum');

    var pays = S.pays.filter(function (p) {
      return toMinor(p.amount, p.currency || tt.currency) > 0;
    }).map(function (p) {
      var pc = p.currency || tt.currency;
      return { amount: toMinor(p.amount, pc), currency: pc, method: p.method,
               txnRef: String(p.txnRef || '').trim() || null };
    });

    API.post('/api/orders', {
      lines: S.lines.map(function (l) { return { sku: l.sku, qty: l.qty }; }),
      whId: S.whId,
      customerId: S.customerId,
      currency: tt.currency,
      discount: tt.discount,
      channel: S.channel,
      note: String(S.note || '').trim() || null,
      dest: S.method === 'pickup' ? {} : {
        country: S.country, city: S.city, address: S.address,
        recipient: S.someoneElse ? S.recipient : '', phone: S.phone
      },
      method: S.method,
      companyId: COMPANY.indexOf(S.method) > -1 ? (S.companyId || null) : null,
      /* auto means "ask the price list", which the server does by being sent
         no fee and no mode. */
      feeMode: S.feeMode === 'auto' ? null : S.feeMode,
      fee: String(S.feeTyped).trim() === '' ? null : toMinor(S.feeTyped, tt.currency),
      plan: S.plan,
      payments: pays,
      opId: S.opId
    }).then(function (r) {
      busy = false;
      saved = { order: r.order, money: r.money };
      dropDraft();
      var print = S.print;
      S = fresh();
      S.print = print;
      repaint();
      /* The confirmation replaces the last step, which may have been
         scrolled a long way down: bring its top back into view. */
      var card = document.getElementById('dkRail');
      if (card && card.scrollIntoView) {
        try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        catch (e) { card.scrollIntoView(); }
      }
      toast(t('dk_title'), t('dk_saved_toast').replace('{id}', r.order.sale.id), 'ok', 4500);
      printAfterSave();
      /* In the background: the board, the customer and the stock figures are
         all a little out of date now. */
      if (typeof Shop !== 'undefined' && Shop.reload) Shop.reload().catch(function () {});
    }).catch(function (err) {
      busy = false;
      /* SOLD WHILE THE ORDER WAS BEING TYPED. The browser's count said there
         was one; the server, which decides, says there is not. Say so in the
         person's language, say the order was NOT saved (so nobody waits for a
         slip that will never come), refresh the stock, and put them back on
         the bag where it can be changed. */
      if (err && err.code === 'insufficient_stock') {
        var det = err.detail || {};
        var sv = det.sku ? DB.variantBySku(det.sku) : null;
        var sp = sv ? DB.product(sv.productId) : null;
        toast(t('dk_title'), t('dkp_sold_meanwhile')
          .replace('{item}', sp ? sp.name + ' · ' + DB.variantLabel(sv) : String(det.sku || ''))
          .replace('{n}', nf(Number(det.available) || 0))
          .replace('{wh}', whLabel(S.whId)), 'err', 10000);
        goStep(0);
        if (typeof Shop !== 'undefined' && Shop.reload) {
          Shop.reload().then(function () { paint('items'); }).catch(function () { paint('items'); });
        }
        return;
      }
      paint('sum');
      toast(t('dk_title'), err.message || API.friendly(err), 'err', 7000);
    });
  }

  /* A payment that arrived after the order was made — the rest of a deposit,
     a transfer the next morning. */
  /* THE BOARD CAN ASK FOR A PAYMENT BEFORE THIS SCREEN HAS EVER LOADED.
     The dialog reads the currencies and the payment methods out of the
     office's bootstrap, which was only fetched when the office screen opened
     — so Take a payment pressed on the deliveries board after a fresh sign-in
     died on `boot.currencies` and the shopkeeper saw a TypeError in a toast.
     Fetched here on demand, the same request the screen would have made. */
  function ensureBoot() {
    if (boot) return Promise.resolve(boot);
    return API.get('/api/orders/bootstrap').then(function (b) {
      boot = b;
      bootErr = null;
      if (!S) S = loadDraft() || fresh();
      if (!S.whId) S.whId = b.settings.wh;
      return b;
    });
  }

  function takePayment(saleId) {
    ensureBoot().then(function () {
      return API.get('/api/orders/by-sale/' + encodeURIComponent(saleId));
    }).then(function (r) {
      var o = r.order;
      var code = o.sale.currency;
      var left = o.delivery.remaining;
      if (!left) { toast(t('dk_title'), t('dk_already_paid'), 'warn'); return; }
      var methods = DB.payMethodsFor('desk');
      if (!methods.length) methods = [{ id: 'cash', en: 'Cash', ar: 'نقداً' }];

      openModal({
        title: t('dk_take_payment') + ' · ' + o.sale.id, size: 'narrow',
        body: '<div class="dl-hero"><span>' + t('dk_remaining') + '</span><b>' + fmt(left, code) + '</b>' +
            '<small>' + nm(o.sale.customerName || t('walk_in')) + ' · <bdi dir="ltr">' + esc(o.sale.id) + '</bdi></small></div>' +
          /* The two amounts people actually take — the rest, or half of it —
             one tap each, still typed over when it is something else. */
          '<div class="field mt"><span>' + t('dk_amount') + '</span><div class="dkp-amt">' +
            '<input class="inp num" id="dkPayAmt" type="text" inputmode="decimal" dir="ltr" value="' +
              esc(moneyPlain(left, code)) + '">' +
            '<button type="button" class="chip on" data-act="dk-fill" data-cur="' + esc(code) + '" data-v="' +
              esc(moneyPlain(left, code)) + '">' + t('dkp_fill_all') + '</button>' +
            (left > 1 ? '<button type="button" class="chip" data-act="dk-fill" data-cur="' + esc(code) + '" data-v="' +
              esc(moneyPlain(Math.round(left / 2), code)) + '">' + t('dkp_fill_half') + '</button>' : '') +
          '</div></div>' +
          ((boot.currencies || []).length > 1
            ? '<label class="field"><span>' + t('dk_currency') + '</span><select class="inp" id="dkPayCur">' +
              boot.currencies.map(function (c) {
                return '<option value="' + esc(c.code) + '"' + (c.code === code ? ' selected' : '') + '>' +
                  esc(c.code) + '</option>';
              }).join('') + '</select></label>' : '') +
          /* Chips over a hidden value rather than a select: the methods are
             four words, and a select hides three of them behind a tap. payGo
             reads #dkPayMethod either way. */
          '<div class="field"><span>' + t('payment') + '</span><div class="dkp-methods">' +
            methods.map(function (m, i) {
              return '<button type="button" class="chip' + (i === 0 ? ' on' : '') + '" data-act="dk-paym" ' +
                'data-id="' + esc(m.id) + '">' + esc(OG.lang === 'ar' ? (m.ar || m.en) : (m.en || m.ar)) + '</button>';
            }).join('') +
            '<input type="hidden" id="dkPayMethod" value="' + esc(methods[0].id) + '"></div></div>' +
          '<label class="field"><span>' + t('dk_ref_ph') + '</span>' +
            '<input class="inp" id="dkPayRef" type="text" dir="ltr" maxlength="64"></label>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="dk-pay-go" data-id="' + esc(saleId) + '">' + t('save') + '</button>'
      });
    }).catch(function (err) { toast(t('dk_title'), API.friendly(err), 'err', 6000); });
  }

  /* The plain number for an input box: no symbol, no thousands separator. */
  function moneyPlain(minor, code) {
    var e = expOf(code);
    var v = wholeOf(minor, code);
    return e ? v.toFixed(e) : String(Math.round(v));
  }

  function payGo(saleId) {
    var amt = (document.getElementById('dkPayAmt') || {}).value || '';
    var cur = (document.getElementById('dkPayCur') || {}).value || null;
    var method = (document.getElementById('dkPayMethod') || {}).value || 'cash';
    var ref = (document.getElementById('dkPayRef') || {}).value || '';
    var code = cur || (saved && saved.money && saved.money.currency) || (boot && boot.base) || 'SYP';
    var minor = toMinor(amt, code);
    if (!minor) { toast(t('dk_take_payment'), t('dk_amount'), 'warn'); return; }
    closeModal();
    API.post('/api/orders/' + encodeURIComponent(saleId) + '/payments', {
      amount: minor, currency: code, method: method,
      txnRef: String(ref).trim() || null, opId: newOpId()
    }).then(function (r) {
      toast(t('dk_take_payment'), t('dk_pay_added').replace('{a}', moneyText(r.money.remaining, r.money.currency)), 'ok', 4500);
      if (saved && saved.order && saved.order.sale.id === saleId) {
        saved = { order: r.order, money: r.money };
        paint('sum');
      }
      if (typeof Deliveries !== 'undefined' && Deliveries.load && OG.view === 'deliveries') Deliveries.load();
    }).catch(function (err) {
      toast(t('dk_take_payment'), err.message || API.friendly(err), 'err', 7000);
    });
  }

  /* --------------------------------------------------------------- actions */

  function line(sku) {
    return S.lines.filter(function (l) { return l.sku === sku; })[0];
  }

  function pickCustomer(id) {
    var c = DB.customer(id);
    if (!c) return;
    S.customerId = id;
    S.custQ = '';
    cpick.open = false;
    cpick.hi = -1;
    if (!S.phone && c.phone) S.phone = c.phone;
    if (!S.city && c.city) S.city = c.city;
    if (!S.address && c.address) S.address = c.address;
    /* a customer's city used to arrive with the PREVIOUS order's country */
    syncCountry();
    touch('who', 'sum');
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    registerSettings();

    ACTIONS['dk-new'] = function () { askNew(); };
    ACTIONS['dk-new-go'] = function () { closeModal(); startNew(); };
    ACTIONS['dk-reload'] = function () { bootErr = null; boot = null; repaint(); load(); };
    ACTIONS['dk-camera'] = function () {
      if (typeof Scan === 'undefined') return;
      Scan.open({ title: t('dk_title'), continuous: true, onHit: scanned });
    };

    ACTIONS['dk-wh'] = function (el) { S.whId = el.getAttribute('data-id'); touch('items', 'sum'); };
    ACTIONS['dk-add'] = function (el) {
      var v = DB.variantBySku(el.getAttribute('data-sku'));
      if (v) addVariant(v);
    };
    ACTIONS['dk-qty'] = function (el) {
      var l = line(el.getAttribute('data-sku'));
      if (!l) return;
      l.qty += Number(el.getAttribute('data-d')) || 0;
      if (l.qty < 1) S.lines = S.lines.filter(function (x) { return x !== l; });
      touch('items', 'sum');
    };
    ACTIONS['dk-drop'] = function (el) {
      var sku = el.getAttribute('data-sku');
      S.lines = S.lines.filter(function (l) { return l.sku !== sku; });
      touch('items', 'sum');
    };

    ACTIONS['dk-cust-pick'] = function (el) { pickCustomer(Number(el.getAttribute('data-id'))); };
    /* Change means "somebody else" — so the list is already open for them. */
    ACTIONS['dk-cust-clear'] = function () {
      S.customerId = null;
      cpick.open = true;
      cpick.hi = -1;
      touch('who', 'sum');
      var box = document.getElementById('dkCust');
      if (box && !coarse()) box.focus();
    };
    ACTIONS['dk-cust-new'] = function () {
      closeCust();
      if (typeof openNewCustomer !== 'function') return;
      openNewCustomer(S.custQ, function (c) { if (c && c.id) pickCustomer(c.id); });
    };
    ACTIONS['dk-last'] = function () {
      if (!S.customerId) return;
      API.get('/api/orders/last-destination/' + S.customerId).then(function (r) {
        if (!r.dest) { toast(t('dk_title'), t('dk_no_last'), 'warn'); return; }
        /* The city leads and the country follows it — copying the two
           with independent fallbacks is how an Aleppo address kept JO. */
        S.city = r.dest.city || S.city;
        S.country = r.dest.country || S.country;
        syncCountry();
        S.address = r.dest.address || S.address;
        S.phone = r.dest.phone || S.phone;
        if (r.dest.recipient) { S.someoneElse = true; S.recipient = r.dest.recipient; }
        touch('who', 'sum');
      }).catch(function () { toast(t('dk_title'), t('dk_no_last'), 'warn'); });
    };

    ACTIONS['dk-channel'] = function (el) { S.channel = el.getAttribute('data-id'); touch('who'); };
    /* Only reachable while the parcel is going abroad — see syncCountry. */
    ACTIONS['dk-country'] = function (el) {
      if (!abroad()) return;
      S.country = el.getAttribute('data-id');
      touch('who', 'sum');
    };
    ACTIONS['dk-company'] = function (el) {
      var id = el.getAttribute('data-id');
      S.companyId = S.companyId === id ? '' : id;
      touch('who');
    };
    ACTIONS['dk-method'] = function (el) {
      /* to or from ‘abroad’ changes whether the country is a question */
      setTimeout(function () { if (syncCountry()) { paint('who'); paintFee(); paint('sum'); } }, 0);
      S.method = el.getAttribute('data-id');
      if (COMPANY.indexOf(S.method) === -1) S.companyId = '';
      /* Nobody has said how it is paid yet: a company is paid before it
         ships, our driver or a pickup can be paid on receipt. */
      if (!S.planTouched) S.plan = receiptOk() ? 'receipt' : 'full';
      if (S.plan === 'receipt' && !receiptOk()) S.plan = 'full';
      /* AND THE PLAN HAS TO BRING ITS AMOUNT BOX WITH IT. Picking a courier
         moves the plan to "all of it now" — which the chips then draw as
         chosen — while S.pays was left empty, so there was no box to type the
         payment into and Save stayed disabled saying money was still owed.
         The same prefill the plan chips do, done wherever the plan moves. */
      planPrefill();
      touch('who', 'sum');
    };
    ACTIONS['dk-feemode'] = function (el) { S.feeMode = el.getAttribute('data-id'); touch('who', 'sum'); };
    ACTIONS['dk-cur'] = function (el) { S.currency = el.getAttribute('data-id'); touch('items', 'sum'); };
    ACTIONS['dk-print'] = function (el) {
      S.print = el.getAttribute('data-id');
      try { localStorage.setItem(PRINT_KEY, S.print); } catch (e) {}
      touch('sum');
    };
    ACTIONS['dk-plan'] = function (el) {
      var plan = el.getAttribute('data-id');
      if (plan === 'receipt' && !receiptOk()) { toast(t('dk_title'), t('dk_r_receipt'), 'warn'); return; }
      S.plan = plan;
      S.planTouched = true;
      planPrefill();
      touch('sum');
    };

    ACTIONS['dk-pay-add'] = function () {
      S.pays.push({ amount: '', currency: totals().currency, method: 'cash', txnRef: '' });
      touch('sum');
    };
    ACTIONS['dk-pay-drop'] = function (el) {
      S.pays.splice(Number(el.getAttribute('data-i')), 1);
      touch('sum');
    };
    ACTIONS['dk-pay-method'] = function (el) {
      var p = S.pays[Number(el.getAttribute('data-i'))];
      if (p) { p.method = el.getAttribute('data-id'); touch('sum'); }
    };

    ACTIONS['dk-save'] = function () { save(); };
    ACTIONS['dk-print-slip'] = function (el) { printSlip(el.getAttribute('data-id')); };
    ACTIONS['dk-print-a4'] = function (el) { printA4(el.getAttribute('data-id')); };
    ACTIONS['dk-wa'] = function (el) {
      var o = current();
      if (o) waSend(el.getAttribute('data-kind'), o);
    };
    ACTIONS['dk-copy-link'] = function () {
      var link = trackLink();
      if (!link) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () {
          toast(t('dk_title'), t('dk_link_copied'), 'ok', 3000);
        }).catch(function () { toast(t('dk_title'), link, 'info', 8000); });
      } else {
        toast(t('dk_title'), link, 'info', 8000);
      }
    };
    ACTIONS['dk-take-pay'] = function (el) { takePayment(el.getAttribute('data-id')); };
    ACTIONS['dk-pay-go'] = function (el) { payGo(el.getAttribute('data-id')); };

    ACTIONS['dk-fill'] = function (el) {
      var box = document.getElementById('dkPayAmt');
      if (!box) return;
      box.value = el.getAttribute('data-v') || '';
      /* The amount is in the order's currency, so the currency box follows. */
      var cur = document.getElementById('dkPayCur');
      if (cur && el.getAttribute('data-cur')) cur.value = el.getAttribute('data-cur');
      markChip(el);
    };
    ACTIONS['dk-paym'] = function (el) {
      var hidden = document.getElementById('dkPayMethod');
      if (hidden) hidden.value = el.getAttribute('data-id');
      markChip(el);
    };

    /* The steps: on, back, and straight to one — from the rail or from a
       row of the read-back on the last step. goStep refuses a step ahead of
       an unanswered one. */
    /* The ▾ at the end of the box: the list, for somebody who would rather
       look than type. NOT 'dk-drop' — that is the ✕ on a bag line, and ACTIONS
       is one object: a second key of the same name silently replaced the
       remove button with "open the list". */
    ACTIONS['dk-browse'] = function () {
      if (pick.open) closeDrop(); else openDrop();
      var box = document.getElementById('dkScan');
      if (box && !coarse()) box.focus();
    };
    /* A press anywhere outside the box and its list closes it. mousedown,
       not click, so the list is gone before whatever was pressed reacts. */
    document.addEventListener('mousedown', function (e) {
      if (pick.open) {
        var combo = document.getElementById('dkCombo');
        if (!(combo && combo.contains(e.target))) closeDrop();
      }
      if (cpick.open) {
        var cc = document.getElementById('dkCustCombo');
        if (!(cc && cc.contains(e.target))) closeCust();
      }
    });

    /* The customer box is rebuilt with its step, so it is listened to at the
       document rather than wired element by element. */
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'dkCust' && !cpick.open) openCust();
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'dkCust') custKey(e);
    });
    ACTIONS['dk-cdrop'] = function () {
      if (cpick.open) closeCust(); else openCust();
      var box = document.getElementById('dkCust');
      if (box && !coarse()) box.focus();
    };

    /* A count this browser loaded a while ago may be behind the warehouse. */
    ACTIONS['dk-restock'] = function () {
      if (typeof Shop === 'undefined' || !Shop.reload) return;
      toast(t('dk_title'), t('dkp_restocking'), 'ok', 1500);
      Shop.reload().then(function () { paint('items'); })
        .catch(function (e) { toast(t('dk_title'), API.friendly(e), 'err', 6000); });
    };

    ACTIONS['dk-next'] = function () { nextStep(); };
    ACTIONS['dk-back'] = function () { prevStep(); };
    ACTIONS['dk-go'] = function (el) { goStep(Number(el.getAttribute('data-id'))); };
    ACTIONS['dk-board-go'] = function () {
      closeModal();
      if (typeof go === 'function') go('deliveries');
    };

    if (typeof CHANGES === 'undefined') return;

    CHANGES['dk-q'] = function (el) { openDrop(el.value); };
    CHANGES['dk-cust'] = function (el) {
      S.custQ = el.value;
      openCust(true);
    };
    CHANGES['dk-field'] = function (el) {
      var k = el.getAttribute('data-k');
      S[k] = el.value;
      saveDraft();
      /* The city moves the fee, which moves the total. Everything else here
         moves what Save is waiting for — an address typed with Save still
         greyed out reads as a screen that has stopped working. Both repaint
         around the box being typed into, never through it. */
      /* THE CITY DECIDES THE COUNTRY. A city the price list knows carries
         its own country, and until ns03 nothing connected the two at all. */
      if (k === 'city' && syncCountry()) { paint('who'); paintFee(); paint('sum'); return; }
      if (k === 'city') paintFee();
      paint('sum');
    };
    CHANGES['dk-else'] = function (el) { S.someoneElse = !!el.checked; touch('who'); };
    CHANGES['dk-fee'] = function (el) {
      S.feeTyped = el.value;
      saveDraft();
      paintFee();
      paint('sum');
      focusBack('[data-change="dk-fee"]', el.value.length);
    };
    CHANGES['dk-discount'] = function (el) {
      S.discount = el.value;
      saveDraft();
      paint('sum');
      focusBack('[data-change="dk-discount"]', el.value.length);
    };
    CHANGES['dk-note'] = function (el) { S.note = el.value; saveDraft(); };
    CHANGES['dk-pay-amt'] = function (el) {
      var i = el.getAttribute('data-i');
      if (S.pays[Number(i)]) S.pays[Number(i)].amount = el.value;
      saveDraft();
      paint('sum');
      focusBack('[data-change="dk-pay-amt"][data-i="' + i + '"]', el.value.length);
    };
    CHANGES['dk-pay-ref'] = function (el) {
      var i = el.getAttribute('data-i');
      if (S.pays[Number(i)]) S.pays[Number(i)].txnRef = el.value;
      saveDraft();
      paint('sum');
      focusBack('[data-change="dk-pay-ref"][data-i="' + i + '"]', el.value.length);
    };
    CHANGES['dk-pay-cur'] = function (el) {
      var p = S.pays[Number(el.getAttribute('data-i'))];
      if (p) { p.currency = el.value; touch('sum'); }
    };
  }

  /* One chip lit in its own row. */
  function markChip(el) {
    var row = el.parentNode;
    if (!row) return;
    Array.prototype.forEach.call(row.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c === el);
    });
  }

  function paintFee() {
    var host = document.getElementById('dkFeeLine');
    if (host) host.innerHTML = feeLineHtml();
  }

  /* ------------------------------------------------------------- settings
     Four folds in Settings: the payment methods, the courier companies, the
     shipping price list, and the shop's own transfer details. Each holds its
     own draft and saves on its own button — a round trip per keystroke on a
     shop wifi is how a list of fourteen ends up half written. */

  var setDraft = null;

  function draft() {
    if (!setDraft) setDraft = JSON.parse(JSON.stringify(boot.settings));
    return setDraft;
  }

  function sw(change, i, key, on, off) {
    return '<label class="switch"><input type="checkbox" data-change="' + change + '" data-i="' + i +
      '" data-k="' + key + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '><i></i></label>';
  }

  /* A number box (a phone, a fee) is left-to-right in both languages: in the
     Arabic layout "021 111 222" was drawn as "222 111 021". */
  function inp(change, i, key, value, ph, cls) {
    var ltr = / ?num\b/.test(cls || '');
    return '<input class="inp ' + (cls || '') + '" type="text" data-change="' + change + '" data-i="' + i +
      '" data-k="' + key + '" value="' + esc(value == null ? '' : value) + '"' + (ltr ? ' dir="ltr"' : '') +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
  }

  /* Settings redraws whole after a save; the page must stay where the person
     was working, not jump back to Branding at the top. */
  function renderKeepScroll() {
    if (typeof render !== 'function') return;
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    render();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  function sel(change, i, key, value, options) {
    return '<select class="inp" data-change="' + change + '" data-i="' + i + '" data-k="' + key + '">' +
      options.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (String(value) === String(o.id) ? ' selected' : '') + '>' +
          esc(o.label) + '</option>';
      }).join('') + '</select>';
  }

  function saveBtn(kind) {
    return '<div class="dks-foot"><button class="btn btn-primary btn-sm" data-act="dks-save" data-k="' + kind + '">' +
      t('save') + '</button></div>';
  }

  function methodsCard() {
    var rows = draft().methods.map(function (m, i) {
      var locked = !!m.system;
      return '<div class="dks-row">' +
        '<div class="dks-names">' + inp('dks-m', i, 'en', m.en, 'English') + inp('dks-m', i, 'ar', m.ar, 'العربية') +
          '<small class="muted"><bdi dir="ltr">' + esc(m.id) + '</bdi>' +
            (locked ? ' · ' + t('dks_system') : '') + '</small></div>' +
        '<div class="dks-flags">' +
          '<span title="' + esc(t('dks_f_active')) + '">' + t('dks_f_active') + sw('dks-m', i, 'active', m.active !== false, locked) + '</span>' +
          '<span title="' + esc(t('dks_f_till')) + '">' + t('dks_f_till') + sw('dks-m', i, 'till', !!m.till, locked) + '</span>' +
          '<span title="' + esc(t('dks_f_desk')) + '">' + t('dks_f_desk') + sw('dks-m', i, 'desk', !!m.desk, locked) + '</span>' +
          '<span title="' + esc(t('dks_f_ref')) + '">' + t('dks_f_ref') + sw('dks-m', i, 'ref', !!m.ref, locked) + '</span>' +
          '<span title="' + esc(t('dks_f_drawer')) + '">' + t('dks_f_drawer') + sw('dks-m', i, 'drawer', !!m.drawer, true) + '</span>' +
        '</div></div>';
    }).join('');
    var meta = nf(draft().methods.filter(function (m) { return m.active !== false; }).length) + ' ' + t('dks_active');
    return setFoldStart('dk-methods', t('dks_methods'), meta) +
      '<div class="card-body"><div class="partner-note">' + t('dks_methods_note') + '</div>' +
      '<div class="dks-list">' + rows + '</div>' +
      '<button class="btn btn-sm mt" data-act="dks-add" data-k="methods">+ ' + t('dks_add_method') + '</button>' +
      saveBtn('methods') + '</div>' + setFoldEnd();
  }

  function companiesCard() {
    var kinds = COMPANY.map(function (k) { return { id: k, label: t('dk_m_' + k) }; });
    var rows = draft().companies.map(function (c, i) {
      return '<div class="dks-row">' +
        '<div class="dks-names">' + inp('dks-c', i, 'en', c.en, 'English') + inp('dks-c', i, 'ar', c.ar, 'العربية') +
          '<small class="muted"><bdi dir="ltr">' + esc(c.id) + '</bdi></small></div>' +
        '<div class="dks-flags">' + sel('dks-c', i, 'kind', c.kind, kinds) +
          inp('dks-c', i, 'phone', c.phone, t('phone'), 'num') +
          '<span>' + t('dks_f_active') + sw('dks-c', i, 'active', c.active !== false) + '</span></div></div>';
    }).join('') || '<div class="dks-none">' + t('dks_no_companies') + '</div>';
    return setFoldStart('dk-companies', t('dks_companies'), nf(draft().companies.length)) +
      '<div class="card-body"><div class="partner-note">' + t('dks_companies_note') + '</div>' +
      '<div class="dks-list">' + rows + '</div>' +
      '<button class="btn btn-sm mt" data-act="dks-add" data-k="companies">+ ' + t('dks_add_company') + '</button>' +
      saveBtn('companies') + '</div>' + setFoldEnd();
  }

  /* THE SHIPPING PRICE LIST, FILLABLE IN ONE SITTING       (night shift 03)
     It ships EMPTY, so on this shop every single order stops on "Say what
     the shipping is" until somebody presses Free or types a figure. That is
     a data problem with a one-time fix, and this is the screen where the fix
     happens — so it is laid out to be filled straight down: the city, the
     price, the currency as two toggles, and a ✕ per row. Country and method
     come first because they are the ones usually left alone.

     NOTHING HERE INVENTS A PRICE. The list starts empty and stays empty
     until the shop types its own numbers. */
  function pricesCard() {
    var countries = draft().countries.map(function (c) { return { id: c.id, label: (OG.lang === 'ar' ? c.ar : c.en) || c.id }; });
    var methods = [{ id: '', label: t('dks_any_method') }].concat(
      ['driver', 'office', 'courier', 'abroad'].map(function (m) { return { id: m, label: t('dk_m_' + m) }; }));
    var currencies = (boot.currencies || []).map(function (c) { return c.code; });
    var modes = [{ id: 'invoice', label: t('dk_fee_shop') }, { id: 'courier', label: t('dk_fee_to_courier') }];

    var rows = draft().prices.map(function (p, i) {
      return '<div class="dks-row dks-price">' +
        sel('dks-p', i, 'country', p.country, countries) +
        inp('dks-p', i, 'city_en', p.city_en, t('dks_city_any')) +
        inp('dks-p', i, 'city_ar', p.city_ar, 'المدينة') +
        /* The price, and the currency beside it as toggles rather than a
           dropdown of two — the ns03 money-dialog rule, one screen along. */
        inp('dks-p', i, 'fee', feeText(p), '0', 'num') +
        curToggle(i, p.currency, currencies) +
        sel('dks-p', i, 'method', p.method || '', methods) +
        sel('dks-p', i, 'fee_mode', p.fee_mode, modes) +
        '<span>' + sw('dks-p', i, 'active', p.active !== false) + '</span>' +
        '<button type="button" class="dks-x" data-act="dks-del" data-k="prices" data-i="' + i + '" ' +
          'title="' + esc(t('set_ship_del')) + '" aria-label="' + esc(t('set_ship_del')) + '">✕</button>' +
      '</div>';
    }).join('');

    return setFoldStart('dk-prices', t('dks_prices'), nf(draft().prices.length), t('set_ship_sub')) +
      '<div class="card-body">' +
      (draft().prices.length
        ? '<div class="partner-note">' + t('dks_prices_note') + '</div>'
        : '<div class="cb-why">' + t('set_ship_empty') + '</div>') +
      '<div class="dks-list dks-prices">' + rows + '</div>' +
      '<button class="btn btn-sm mt" data-act="dks-add" data-k="prices">' + t('set_ship_add') + '</button>' +
      saveBtn('prices') + '</div>' + setFoldEnd();
  }

  /* The stored figure is minor units in the row's own currency, so it is
     shown the way a person writes it and read back the same way. */
  function feeText(p) {
    var n = Number(p.fee) || 0;
    if (!n) return '';
    return moneyPlain(n, p.currency || boot.base || 'SYP');
  }

  function curToggle(i, value, list) {
    if (list.length > 3) return sel('dks-p', i, 'currency', value, list.map(function (c) { return { id: c, label: c }; }));
    return '<span class="dks-cur">' + list.map(function (c) {
      return '<button type="button" class="chip' + (String(value) === c ? ' on' : '') + '" ' +
        'data-act="dks-cur" data-i="' + i + '" data-v="' + esc(c) + '">' +
        esc(c === 'USD' ? '$' : (OG.lang === 'ar' && c === 'SYP' ? 'ل.س' : c)) + '</button>';
    }).join('') + '</span>';
  }

  function accountsCard() {
    var acc = draft().accounts || {};
    var rows = draft().methods.filter(function (m) { return m.ref && m.active !== false; }).map(function (m) {
      var a = acc[m.id] || {};
      return '<div class="dks-row"><div class="dks-names"><b>' +
        esc(OG.lang === 'ar' ? (m.ar || m.en) : (m.en || m.ar)) + '</b></div>' +
        '<div class="dks-acc">' +
          '<input class="inp" type="text" data-change="dks-a" data-i="' + esc(m.id) + '" data-k="en" value="' +
            esc(a.en || '') + '" placeholder="' + esc(t('dks_acc_ph')) + '">' +
          '<input class="inp" type="text" data-change="dks-a" data-i="' + esc(m.id) + '" data-k="ar" value="' +
            esc(a.ar || '') + '" placeholder="بالعربية">' +
        '</div></div>';
    }).join('') || '<div class="dks-none">' + t('dks_no_transfer') + '</div>';

    return setFoldStart('dk-accounts', t('dks_accounts'), '') +
      '<div class="card-body"><div class="partner-note">' + t('dks_accounts_note') + '</div>' +
      '<div class="dks-list">' + rows + '</div>' + saveBtn('accounts') + '</div>' + setFoldEnd();
  }

  /* `bare` drops the heading: ns03 gave Settings a Deliveries section of its
     own, and two headings one under the other is not a section. */
  function settingsCards(opts) {
    if (!allow('config.write')) return '';
    if (!boot) { load(); return ''; }
    return ((opts && opts.bare) ? '' : setSection(t('setg_delivery'))) +
      methodsCard() + companiesCard() + pricesCard() + accountsCard();
  }

  /* One id per new row, from the name the person typed or a timestamp — the
     server refuses anything that is not lowercase letters, digits and _. */
  function makeId(seed, taken) {
    var base = String(seed || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    if (!base || !/^[a-z]/.test(base)) base = 'x' + String(Date.now()).slice(-6);
    var id = base, n = 2;
    while (taken.indexOf(id) > -1) { id = base + '_' + n; n++; }
    return id;
  }

  /* One door into one Settings fold, from anywhere. Scrolled AFTER the page
     has settled, and checked: navigating resets the view's scroll once the
     new screen is in, so a scroll made on the first frame is undone a moment
     later and the list sat off-screen. The office's settings may still be on
     their way on a first visit, which is what the retries are for. */
  function gotoSettingsFold(id) {
    if (typeof closeModal === 'function') closeModal();
    if (typeof setFoldRemember === 'function') setFoldRemember(id, true);
    if (typeof go === 'function') go('settings');
    var tries = 0;
    (function find() {
      var f = document.querySelector('[data-fold="' + id + '"]');
      var r = f && f.getBoundingClientRect();
      var inView = r && r.top >= 0 && r.top < window.innerHeight - 80;
      if (inView && tries > 3) return;
      if (f) f.scrollIntoView({ block: 'start' });
      if (++tries < 50) setTimeout(find, 120);
    })();
  }

  function registerSettings() {
    if (typeof ACTIONS === 'undefined' || typeof CHANGES === 'undefined') return;

    CHANGES['dks-m'] = function (el) { setField(draft().methods, el); };
    CHANGES['dks-c'] = function (el) { setField(draft().companies, el); };
    CHANGES['dks-p'] = function (el) { setField(draft().prices, el); };
    CHANGES['dks-a'] = function (el) {
      var id = el.getAttribute('data-i');
      var acc = draft().accounts || (draft().accounts = {});
      acc[id] = acc[id] || { en: '', ar: '' };
      acc[id][el.getAttribute('data-k')] = el.value;
    };

    /* "Add one in Settings", from the office, the Assign dialog and the
       handover picker: straight to the companies list, already open, rather
       than to the top of an eleven-card page. */
    /* Straight to the shipping price list, opened, and scrolled to AFTER the
       page has settled — navigating resets the view's scroll once the screen
       is in, so a first-frame scroll is undone. */
    ACTIONS['dk-goto-prices'] = function () {
      gotoSettingsFold('dk-prices');
    };

    ACTIONS['dk-goto-companies'] = function () { gotoSettingsFold('dk-companies'); };

    /* A PRICE ROW MAY BE DELETED, and a method or a company may not: those
       are frozen onto deliveries by id, while a delivery freezes its own fee
       as a number. This is the one list here with a ✕. */
    ACTIONS['dks-del'] = function (el) {
      var i = Number(el.getAttribute('data-i'));
      var d = draft();
      if (el.getAttribute('data-k') !== 'prices' || !(i >= 0) || !d.prices[i]) return;
      d.prices.splice(i, 1);
      renderKeepScroll();
    };

    /* The currency toggle beside a price. */
    ACTIONS['dks-cur'] = function (el) {
      var i = Number(el.getAttribute('data-i'));
      var d = draft();
      if (!d.prices[i]) return;
      d.prices[i].currency = el.getAttribute('data-v');
      renderKeepScroll();
    };

    ACTIONS['dks-add'] = function (el) {
      var k = el.getAttribute('data-k');
      var d = draft();
      if (k === 'methods') {
        d.methods.push({ id: makeId('method', d.methods.map(function (m) { return m.id; })),
          en: '', ar: '', ref: true, drawer: false, till: false, desk: true, debt: true, active: true });
      } else if (k === 'companies') {
        d.companies.push({ id: makeId('company', d.companies.map(function (c) { return c.id; })),
          en: '', ar: '', kind: 'office', phone: '', active: true });
      } else {
        d.prices.push({ id: makeId('price', d.prices.map(function (p) { return p.id; })),
          country: (d.countries[0] || {}).id || 'SY', city_en: '', city_ar: '', method: '',
          fee: 0, currency: (boot.base || 'SYP'), fee_mode: 'invoice', active: true });
      }
      if (typeof render === 'function') render();
      /* The row just added is empty, so the caret goes into its name. */
      var change = k === 'methods' ? 'dks-m' : k === 'companies' ? 'dks-c' : null;
      if (change) {
        var names = document.querySelectorAll('[data-change="' + change + '"][data-k="en"]');
        var last = names[names.length - 1];
        if (last) { try { last.focus({ preventScroll: false }); } catch (e) { last.focus(); } }
      }
    };

    ACTIONS['dks-save'] = function (el) {
      var k = el.getAttribute('data-k');
      var d = draft();
      var body = {};
      /* A nameless row is the one refusal somebody meets by pressing Add and
         then Save — said here in their language, rather than as the server's
         English with a JSON path on the end. */
      var list = k === 'methods' ? d.methods : k === 'companies' ? d.companies : null;
      if (list && list.some(function (r) { return !String(r.en || '').trim() && !String(r.ar || '').trim(); })) {
        toast(t('setg_delivery'), t(k === 'companies' ? 'dks_need_name_c' : 'dks_need_name_m'), 'warn', 5000);
        return;
      }
      if (k === 'methods') body.methods = d.methods;
      else if (k === 'companies') body.companies = d.companies;
      else if (k === 'prices') body.prices = d.prices;
      else body.accounts = d.accounts || {};

      API.put('/api/delivery/settings', body).then(function (r) {
        boot.settings = r.settings;
        setDraft = JSON.parse(JSON.stringify(r.settings));
        toast(t('setg_delivery'), t('dks_saved'), 'ok', 3000);
        renderKeepScroll();
      }).catch(function (err) {
        toast(t('setg_delivery'), (err.message || API.friendly(err)) +
          (err.detail && err.detail.path ? ' · ' + err.detail.path : ''), 'err', 8000);
      });
    };
  }

  function setField(list, el) {
    var row = list[Number(el.getAttribute('data-i'))];
    if (!row) return;
    var k = el.getAttribute('data-k');
    row[k] = el.type === 'checkbox' ? !!el.checked
      : (k === 'fee' ? toMinor(el.value, row.currency || boot.base || 'SYP') : el.value);
  }

  return {
    view: view,
    after: after,
    register: register,
    owns: owns,
    scanned: scanned,
    settingsCards: settingsCards,

    /* FIX 05 — the two drop lists, for the one route-change cleanup. Both
       are drawn inside the office's own panel, so leaving the screen takes
       them with it; what does NOT go is `pick.open` / `cpick.open`, which
       live in module state and would open the list again the moment the
       office is next drawn. */
    dropsOpen: function () { return !!(pick.open || cpick.open); },
    closeDrops: function () { closeDrop(); closeCust(); },

    /* The board reads money and opens orders through here rather than
       carrying its own copy of either — one formatter, one order view. */
    moneyText: moneyText,
    fmt: fmt,
    plain: moneyPlain,
    toMinor: toMinor,
    toCount: toCount,
    foldDigits: foldDigits,
    openOrder: openOrder,
    sendTrack: sendTrack,
    takePayment: takePayment,
    /* The pictures the board, the road and the order dialog share, so a
       parcel is drawn one way wherever it appears. */
    methodIcon: methodIconSvg,
    rail: railHtml,
    face: faceHtml,
    companies: function () {
      return ((boot && boot.settings && boot.settings.companies) || []).filter(function (c) {
        return c && c.active !== false;
      });
    },
    /* Whether the list above is the office's real one — it is the copy a
       Settings save updates, so the board and the handover picker prefer it
       over the one they fetched earlier. */
    companiesLoaded: function () { return !!boot; },
    /* The owner's own country list, and the first live one — the board asks
       so it can say the country ONLY when the parcel is leaving it, rather
       than assuming SY. */
    countries: function () { return (boot && boot.settings && boot.settings.countries) || []; },
    homeCountry: homeCountry,
    /* The one rule for “which country is this parcel going to”, as a pure
       function of the three things it depends on — so a check can ask it the
       same question the screen asks, rather than a copy of it. */
    countryFor: function (o) {
      o = o || {};
      if (o.method !== 'abroad') return homeCountry();
      var byCity = countryForCity(o.city);
      if (byCity) return byCity;
      return countryRow(o.country) ? o.country : homeCountry();
    }
  };
})();
