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

   Repaints patch one panel (#dkItems, #dkWho, #dkSum) and never call
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
      opId: null
    };
  }

  function loadDraft() {
    try {
      var v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      return v && v.v === 1 && Array.isArray(v.lines) ? v : null;
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
  function toMinor(typed, code) {
    var s = String(typed === undefined || typed === null ? '' : typed).replace(/[^\d.,]/g, '');
    if (!s) return 0;

    var lastDot = s.lastIndexOf('.');
    var lastCom = s.lastIndexOf(',');
    var sep = Math.max(lastDot, lastCom);
    var dec = -1;
    if (sep > -1) {
      var after = s.length - sep - 1;
      var mixed = lastDot > -1 && lastCom > -1;
      if (mixed || after !== 3) dec = sep;
    }

    var whole = (dec > -1 ? s.slice(0, dec) : s).replace(/\D/g, '');
    var frac = (dec > -1 ? s.slice(dec + 1) : '').replace(/\D/g, '');
    var e = expOf(code);
    var v = Number(whole || '0');
    if (!isFinite(v)) return 0;

    var minor = v * Math.pow(10, e);
    if (frac) {
      if (e > 0) minor += Number((frac + '00000000').slice(0, e));
      else if (Number(frac.charAt(0)) >= 5) minor += 1;
    }
    return minor > 0 ? Math.round(minor) : 0;
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
    var v = DB.variantByBarcode(code) || DB.variantBySku(code) ||
            (DB.variantByLabelCode && DB.variantByLabelCode(code));
    if (v) { addVariant(v); return; }
    var inv = invoiceFrom(code);
    if (inv) { openOrder(inv); return; }
    toast(t('dk_title'), t('dk_unknown_code') + ' · ' + code.slice(0, 40), 'warn');
  }

  function addVariant(v) {
    if (saved) startNew();
    var p = DB.product(v.productId);
    if (!p || p.archived) { toast(t('dk_title'), t('dk_archived'), 'warn'); return; }
    var line = S.lines.filter(function (l) { return l.sku === v.sku; })[0];
    if (line) line.qty += 1;
    else { line = { sku: v.sku, qty: 1 }; S.lines.unshift(line); }
    S.flash = v.sku;
    touch('items', 'sum');
    var have = DB.stockAt(v, S.whId);
    if (have < line.qty) {
      toast(p.name + ' · ' + v.size,
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
      repaint();
    }).catch(function (err) {
      loading = false;
      bootErr = API.friendly(err);
      repaint();
    });
  }

  function after() {
    if (typeof Auth !== 'undefined' && !Auth.can('delivery.desk')) return;
    if (!boot) { load(); return; }
    focusScan();
  }

  function repaint() {
    /* The Settings folds are drawn by app-settings.js, so when the bootstrap
       lands while somebody is on that screen, the page itself has to redraw —
       otherwise the four folds sit empty until the next navigation. */
    if (OG.view === 'settings') { if (typeof render === 'function') render(); return; }
    if (OG.view !== 'desk') return;
    var host = document.getElementById('view');
    if (host) host.innerHTML = view();
    focusScan();
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
      '<div class="dk">' +
        '<section class="card dk-col" id="dkItems">' + itemsHtml() + '</section>' +
        '<section class="card dk-col" id="dkWho">' + whoHtml() + '</section>' +
        '<aside class="card dk-sum" id="dkSum">' + (saved ? resultHtml() : sumHtml()) + '</aside>' +
      '</div>' +
      '<div class="dk-bar" id="dkBar">' + barHtml() + '</div>';
  }

  /* ON A PHONE THE SAVE BUTTON IS OFF THE BOTTOM OF THE PAGE. Three columns
     become one stacked screen, so the money panel — and the only way to
     finish — sits under everything that was scanned. This bar is drawn
     always and shown by CSS only where the layout has stacked; it carries the
     one number that matters and the one button, and both are the same
     delegated actions as the panel's own, so there is nothing to keep in
     step. */
  function barHtml() {
    if (saved) {
      return '<div class="dk-bar-sum"><b><bdi dir="ltr">' + esc(saved.order.sale.id) + '</bdi></b>' +
        '<span>' + t('dk_bar_done') + '</span></div>' +
        '<button class="btn btn-primary" data-act="dk-new">' + t('dk_new') + '</button>';
    }
    var tt = totals();
    var why = reasons(tt);
    return '<div class="dk-bar-sum"><b>' + fmt(tt.due, tt.currency) + '</b>' +
      '<span>' + (S.lines.length ? nf(pieces()) + ' ' + t('dk_pieces') : t('dk_empty')) +
        (tt.remaining ? ' · ' + t('dk_remaining') + ' ' + fmt(tt.remaining, tt.currency) : '') +
      '</span></div>' +
      '<button class="btn btn-primary" data-act="dk-save"' + (why.length || busy ? ' disabled' : '') + '>' +
        (busy ? t('dk_saving') : t('dk_save')) + '</button>';
  }

  function paint(part) {
    if (OG.view !== 'desk' || !boot) return;
    var id = part === 'items' ? 'dkItems' : part === 'who' ? 'dkWho' : 'dkSum';
    var host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = part === 'items' ? itemsHtml()
                   : part === 'who' ? whoHtml()
                   : (saved ? resultHtml() : sumHtml());
    /* The phone bar carries the same due figure and the same Save, so it
       repaints with every panel rather than only with the money one — a line
       scanned in panel one changes what it says. */
    var bar = document.getElementById('dkBar');
    if (bar) bar.innerHTML = barHtml();
    if (part === 'items') focusScan();
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
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var v = el.value;
      if (!String(v).trim()) return;
      var exact = DB.variantByBarcode(v.trim()) || DB.variantBySku(v.trim()) ||
                  (DB.variantByLabelCode && DB.variantByLabelCode(v.trim()));
      if (exact || invoiceFrom(v)) { el.value = ''; setHits(''); scanned(v); return; }
      setHits(v);
    });
  }

  function focusScan() {
    var el = document.getElementById('dkScan');
    if (!el) return;
    wireScan(el);
    if (coarse()) return;
    var a = document.activeElement;
    if (a && a !== document.body && a !== el && !(a.closest && a.closest('#dkItems'))) return;
    el.focus();
  }

  /* A NUMBER BECOMES A TICK WHEN THE STEP IS ACTUALLY DONE. Three panels side
     by side read as three unrelated forms, and the one question the person on
     the phone has — what is still missing before I can print — was only
     answered at the bottom of the third column, in the list under Save. The
     tick is the same fact, where the eye already is.

     `done` is never a guess: it is the same condition reasons() refuses on. */
  function stepHead(n, title, meta, done) {
    return '<div class="dk-step' + (done ? ' is-done' : '') + '">' +
      '<span class="dk-n">' + (done ? '✓' : n) + '</span><h3>' + title + '</h3>' +
      (meta ? '<span class="dk-meta">' + meta + '</span>' : '') + '</div>';
  }

  /* Is the destination finished? The same two things create() refuses
     without: somebody to send it to, and somewhere to send it — except a
     pickup, which is collected from the counter and has no address. */
  function whoDone() {
    return !!S.customerId && (S.method === 'pickup' || !!String(S.address || '').trim());
  }

  function scanIcon(cls) {
    return '<svg class="dk-ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>';
  }

  function pieces() {
    return S.lines.reduce(function (a, l) { return a + l.qty; }, 0);
  }

  /* ------------------------------------------------------ 1. what's in the bag */

  function itemsHtml() {
    var tt = totals();
    var h = stepHead(1, t('dk_items'), S.lines.length ? nf(pieces()) + ' ' + t('dk_pieces') : '',
                     S.lines.length > 0);

    h += '<div class="dk-scan">' + scanIcon() +
      '<input class="inp" id="dkScan" type="text" autocomplete="off" spellcheck="false" ' +
        'data-change="dk-q" placeholder="' + esc(t('dk_scan_ph')) + '">' +
    '</div>' +
    '<div class="dk-hits" id="dkHits"></div>';

    h += '<div class="dk-wh"><span class="lbl">' + t('dk_take_from') + '</span><div class="seg-row">';
    (boot.warehouses || []).forEach(function (w) {
      h += '<button type="button" class="seg' + (S.whId === w.id ? ' on' : '') + '" data-act="dk-wh" data-id="' +
        esc(w.id) + '">' + esc(DB.whName(w.id, OG.lang === 'ar')) + '</button>';
    });
    h += '</div></div>';

    if (!S.lines.length) {
      return h + '<div class="dk-empty">' + scanIcon('big') + '<b>' + t('dk_empty') + '</b>' +
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
          '<small>' + t('size') + ' ' + esc(hit.v.size) + ' · <bdi dir="ltr">' + esc(l.sku) + '</bdi>' +
          (short ? ' · <span class="dk-short">' + t('dk_only').replace('{n}', nf(have)) + '</span>' : '') +
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

  /* Typing a name instead of scanning: the products that match, each with its
     sizes and how many are in the place the order is packed from. */
  function hitsHtml(q) {
    var query = String(q || '').trim();
    if (query.length < 2) return '';
    var qf = DB.foldName(query);
    var list = DB.products.filter(function (p) {
      return !p.archived && DB.foldName(p.name + ' ' + (p.brand || '')).indexOf(qf) > -1;
    }).slice(0, 6);
    if (!list.length) return '<div class="dk-hit-none">' + t('dk_no_hits') + '</div>';
    return list.map(function (p) {
      var sizes = DB.variantsOf(p.id).map(function (v) {
        var have = DB.stockAt(v, S.whId);
        return '<button type="button" class="dk-size' + (have ? '' : ' is-out') + '" data-act="dk-add" data-sku="' +
          esc(v.sku) + '">' + esc(v.size) + '<i class="num">' + nf(have) + '</i></button>';
      }).join('');
      return '<div class="dk-hit">' + thumb(p, 'dk-thumb') +
        '<div class="dk-hit-txt"><b>' + esc(p.name) + '</b><div class="dk-sizes">' + sizes + '</div></div></div>';
    }).join('');
  }

  function setHits(q) {
    var host = document.getElementById('dkHits');
    if (host) host.innerHTML = hitsHtml(q);
  }

  /* --------------------------------------------- 2. who, and how it travels */

  var METHOD_ICON = {
    driver:  'M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 16h8l2-5h-4M13 11l-2-4H8',
    office:  'M5 17V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11M5 12h14M8 20v-3M16 20v-3',
    courier: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    abroad:  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    pickup:  'M4 10v10h16V10M3 10l2-6h14l2 6M9 20v-6h6v6'
  };

  function segBtn(act, id, on, label) {
    return '<button type="button" class="seg' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' +
      esc(id) + '">' + label + '</button>';
  }

  function label(row) {
    return row ? esc(OG.lang === 'ar' ? (row.ar || row.en) : (row.en || row.ar)) : '';
  }

  function whoHtml() {
    var h = stepHead(2, t('dk_who'), '', !!S.customerId);
    var cust = S.customerId ? DB.customer(S.customerId) : null;

    if (cust) {
      h += '<div class="dk-cust">' +
        '<div class="dk-cust-txt"><b>' + nm(cust.name) + '</b>' +
          '<small>' + (cust.phone ? tel(cust.phone) : '') + (cust.city ? ' · ' + nm(cust.city) : '') + '</small></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="dk-last">' + t('dk_last_address') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="dk-cust-clear">' + t('dk_change') + '</button>' +
      '</div>';
    } else {
      h += '<div class="dk-find">' +
        '<input class="inp" id="dkCust" type="text" autocomplete="off" data-change="dk-cust" ' +
          'placeholder="' + esc(t('dk_cust_ph')) + '" value="' + esc(S.custQ) + '">' +
        (allow('customer.write')
          ? '<button type="button" class="btn btn-sm" data-act="dk-cust-new">+ ' + t('dk_cust_new') + '</button>' : '') +
      '</div><div class="dk-cust-hits" id="dkCustHits">' + custHitsHtml(S.custQ) + '</div>';
    }

    h += '<div class="dk-row"><span class="lbl">' + t('dk_channel') + '</span><div class="seg-row">';
    CHANNELS.forEach(function (c) { h += segBtn('dk-channel', c, S.channel === c, t('dk_ch_' + c)); });
    h += '</div></div>';

    h += stepHead(3, t('dk_where'), '', whoDone());

    /* How it travels comes first: a pickup has no destination at all, and a
       company changes what may be paid on receipt. */
    h += '<div class="dk-methods">';
    METHODS.forEach(function (m) {
      h += '<button type="button" class="dk-method' + (S.method === m ? ' on' : '') + '" data-act="dk-method" data-id="' + m + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + METHOD_ICON[m] + '"/></svg>' +
        '<b>' + t('dk_m_' + m) + '</b><small>' + t('dk_m_' + m + '_sub') + '</small></button>';
    });
    h += '</div>';

    if (S.method === 'pickup') return h + '<div class="partner-note">' + t('dk_pickup_note') + '</div>';

    var countries = (boot.settings.countries || []).filter(function (c) { return c && c.active !== false; });
    if (countries.length > 1) {
      h += '<div class="dk-row"><span class="lbl">' + t('dk_country') + '</span><div class="seg-row">';
      countries.forEach(function (c) { h += segBtn('dk-country', c.id, S.country === c.id, label(c)); });
      h += '</div></div>';
    }

    if (COMPANY.indexOf(S.method) > -1) {
      var cos = (boot.settings.companies || []).filter(function (c) {
        return c && c.active !== false && c.kind === S.method;
      });
      h += '<div class="dk-row"><span class="lbl">' + t('dk_company') + '</span>';
      if (!cos.length) {
        h += '<div class="dk-hint">' + t('dk_no_company') +
          (allow('config.write') ? ' <span class="clickable" data-act="nav" data-view="settings">' +
            t('dk_add_in_settings') + '</span>' : '') + '</div>';
      } else {
        h += '<div class="seg-row">';
        cos.forEach(function (c) { h += segBtn('dk-company', c.id, S.companyId === c.id, label(c)); });
        h += '</div>';
      }
      h += '</div>';
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
        'placeholder="' + esc(t('dk_address_ph')) + '">' + esc(S.address) + '</textarea></label>' +
    '<label class="check dk-else"><input type="checkbox" data-change="dk-else"' + (S.someoneElse ? ' checked' : '') + '>' +
      '<span>' + t('dk_someone_else') + '</span></label>';

    if (S.someoneElse) {
      h += '<label class="field"><span>' + t('dk_recipient') + '</span>' +
        '<input class="inp" type="text" data-change="dk-field" data-k="recipient" value="' + esc(S.recipient) + '"></label>';
    }

    return h + feeHtml();
  }

  function custHitsHtml(q) {
    var query = String(q || '').trim();
    if (!query) return '';
    var list = custSearch(query).slice(0, 5);
    if (!list.length) return '<div class="dk-hit-none">' + t('dk_cust_none') + '</div>';
    return list.map(function (c) {
      return '<button type="button" class="dk-cust-hit" data-act="dk-cust-pick" data-id="' + c.id + '">' +
        '<b>' + nm(c.name) + '</b><small>' + (c.phone ? tel(c.phone) : '') + (c.city ? ' · ' + nm(c.city) : '') +
        '</small></button>';
    }).join('');
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

  function feeHtml() {
    return '<div class="dk-fee"><span class="lbl">' + t('dk_shipping') + '</span>' +
      '<div class="dk-fee-line" id="dkFeeLine">' + feeLineHtml() + '</div>' +
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

  function sumHtml() {
    var tt = totals();
    var code = tt.currency;
    var h = stepHead(4, t('dk_money'), currencyChips(code), !reasons(tt).length);

    h += '<div class="dk-tot">' + sumRow(t('dk_goods'), fmt(tt.subtotal, code)) +
      '<div class="dk-sr dk-disc"><span>' + t('discount') + '</span>' +
        '<input class="inp num" type="text" inputmode="decimal" dir="ltr" data-change="dk-discount" ' +
          'value="' + esc(S.discount) + '" placeholder="0"></div>';
    if (tt.fee.mode === 'invoice' && tt.fee.amount) h += sumRow(t('dk_shipping'), fmt(tt.fee.amount, code));
    else if (tt.fee.mode === 'courier') h += sumRow(t('dk_shipping'), '<span class="muted">' + t('dk_fee_courier') + '</span>');
    h += '<div class="dk-due"><span>' + t('dk_due') + '</span><b>' + fmt(tt.due, code) + '</b></div></div>';

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

    /* Save and the reasons it cannot be pressed are one block, because on a
       wide screen the panel scrolls inside itself and this block sticks to
       the bottom of it (.dk-close in css/og-skin.css). They belong together
       either way: a disabled button with its reason somewhere else is how
       somebody presses it twice and then asks what is wrong. */
    var why = reasons(tt);
    h += '<div class="dk-close">' +
      '<button class="btn btn-primary dk-save" data-act="dk-save"' +
        (why.length || busy ? ' disabled' : '') + '>' + (busy ? t('dk_saving') : t('dk_save')) + '</button>' +
      (why.length
        ? '<ul class="dk-why">' + why.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>'
        : '') +
    '</div>';
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

    var h = '<div class="dk-done"><div class="dk-tick" aria-hidden="true">✓</div>' +
      '<b><bdi dir="ltr">' + esc(o.sale.id) + '</bdi></b><span>' + t('dk_saved') + '</span></div>';

    h += '<div class="dk-tot">' + sumRow(t('dk_due'), fmt(m.due, code)) +
      sumRow(t('dk_paid_now'), fmt(m.paid, code)) +
      '<div class="dk-remain' + (m.remaining ? ' owes' : ' clear') + '"><span>' + t('dk_remaining') + '</span>' +
        '<b>' + fmt(m.remaining, code) + '</b></div></div>';

    h += '<div class="dk-acts">' +
      '<button class="btn" data-act="dk-print-slip" data-id="' + esc(o.sale.id) + '">' + t('dk_print_slip') + '</button>' +
      '<button class="btn" data-act="dk-print-a4" data-id="' + esc(o.sale.id) + '">' + t('dk_print_a4') + '</button>' +
      (canWa ? '<button class="btn" data-act="dk-wa" data-kind="confirm">' + t('dk_wa_confirm') + '</button>' : '') +
      (canWa && m.remaining ? '<button class="btn" data-act="dk-wa" data-kind="pay">' + t('dk_wa_pay') + '</button>' : '') +
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
      '<div class="dk-ord-top"><div><b><bdi dir="ltr">' + esc(o.sale.id) + '</bdi></b>' +
        '<small>' + nm(o.sale.customerName || t('walk_in')) +
          (o.customer && o.customer.phone ? ' · ' + tel(o.customer.phone) : '') + '</small></div>' +
        '<span class="badge ' + (d.voided ? 'neutral' : d.status === 'delivered' ? 'healthy'
          : d.status === 'failed' ? 'critical' : d.status === 'out' ? 'accent' : 'neutral') + '">' +
          t(d.voided ? 'dk_cancelled' : 'dl_' + d.status) + '</span></div>' +
      '<div class="dk-ord-where">' + methodLine(d) + (whereLine(d) ? '<small>' + whereLine(d) + '</small>' : '') +
        (d.trackingNo ? '<small><bdi dir="ltr">' + esc(d.trackingNo) + '</bdi></small>' : '') + '</div>' +
      '<div class="dk-tot">' + sumRow(t('dk_due'), fmt(due, code)) + sumRow(t('dk_paid_now'), fmt(paid, code)) +
        '<div class="dk-remain' + (left ? ' owes' : ' clear') + '"><span>' + t('dk_remaining') + '</span>' +
        '<b>' + fmt(left, code) + '</b></div></div>';

    if (o.items && o.items.length) {
      body += '<div class="dk-ord-items">' + o.items.map(function (it) {
        return '<span>' + esc(it.name) + (it.size ? ' · ' + esc(it.size) : '') + ' <b>×' + it.qty + '</b></span>';
      }).join('') + '</div>';
    }
    if (o.payments && o.payments.length) {
      body += '<div class="dk-ord-pays">' + o.payments.map(function (p) {
        return '<div><span>' + esc(DB.payLabel(p.method)) + (p.txnRef ? ' · <bdi dir="ltr">' + esc(p.txnRef) + '</bdi>' : '') +
          '</span><b>' + fmt(p.amount, p.currency) + '</b></div>';
      }).join('') + '</div>';
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
        (linkFor(o) ? '<button class="btn btn-ghost" data-act="dk-copy-link">' + t('dk_copy_link') + '</button>' : '') +
        '<button class="btn" data-act="dk-print-slip" data-id="' + esc(o.sale.id) + '">' + t('dk_print_slip') + '</button>' +
        (left && allow('delivery.desk')
          ? '<button class="btn btn-primary" data-act="dk-take-pay" data-id="' + esc(o.sale.id) + '">' +
            t('dk_take_payment') + '</button>' : '') +
        ifNav('deliveries', '<button class="btn" data-act="dk-board-go">' + t('dk_to_board') + '</button>')
    });
  }

  function openOrder(saleId) {
    API.get('/api/orders/by-sale/' + encodeURIComponent(saleId))
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

  function orderLines(o) {
    return (o.items || []).map(function (it) {
      return '• ' + it.name + (it.size ? ' — ' + (OG.lang === 'ar' ? 'مقاس ' : 'size ') + it.size : '') +
        ' × ' + it.qty;
    }).join('\n');
  }

  /* Arabic by default: the customer is in Aleppo, Damascus or Amman, and the
     English half exists for the ones who write in it. Western digits, no
     emoji, no Markdown — the same rules the Telegram messages follow. */
  function waConfirm(o, ar) {
    var d = o.delivery;
    var code = o.sale.currency;
    var link = boot && boot.publicBase && o.sale.publicToken
      ? boot.publicBase + '/i/' + o.sale.publicToken : null;
    var name = firstNameOf(o.sale.customerName || (o.customer && o.customer.name));
    var where = [d.city, (countryRow(d.country) || {})[ar ? 'ar' : 'en']].filter(Boolean).join('، ');
    var via = t('dk_m_' + (d.method || 'driver')) + (d.companyName ? ' · ' + d.companyName : '');
    var L = [];

    if (ar) {
      L.push('أهلاً ' + name + '،');
      L.push('تم تثبيت طلبك من ' + CONFIG.SHOP_NAME + '.');
      L.push('رقم الطلب: ' + o.sale.id);
      L.push('');
      L.push(orderLines(o));
      L.push('');
      L.push('قيمة البضاعة: ' + moneyText(o.sale.total, code));
      if (d.feeMode === 'invoice' && d.fee) L.push('أجرة الشحن: ' + moneyText(d.fee, code));
      if (d.feeMode === 'courier') L.push('أجرة الشحن تُدفع لشركة الشحن عند الاستلام.');
      L.push('الإجمالي: ' + moneyText(d.due, code));
      L.push('المدفوع: ' + moneyText(d.paid, code));
      L.push('المتبقي: ' + moneyText(d.remaining, code));
      L.push('');
      if (d.method === 'pickup') L.push('الطلب جاهز للاستلام من المحل.');
      else L.push('التوصيل إلى: ' + where + ' — عن طريق ' + via + '.');
      if (d.remaining && ON_RECEIPT.indexOf(d.method) > -1) L.push('المبلغ المتبقي يُدفع عند الاستلام.');
      if (d.remaining && COMPANY.indexOf(d.method) > -1) L.push('نشحن الطلب فور وصول المبلغ المتبقي.');
      if (link) { L.push(''); L.push('تابع طلبك: ' + link); }
      L.push('— ' + CONFIG.SHOP_NAME);
    } else {
      L.push('Hi ' + name + ',');
      L.push('Your order from ' + CONFIG.SHOP_NAME + ' is confirmed.');
      L.push('Order: ' + o.sale.id);
      L.push('');
      L.push(orderLines(o));
      L.push('');
      L.push('Goods: ' + moneyText(o.sale.total, code));
      if (d.feeMode === 'invoice' && d.fee) L.push('Shipping: ' + moneyText(d.fee, code));
      if (d.feeMode === 'courier') L.push('Shipping is paid to the courier on delivery.');
      L.push('Total: ' + moneyText(d.due, code));
      L.push('Paid: ' + moneyText(d.paid, code));
      L.push('Still owed: ' + moneyText(d.remaining, code));
      L.push('');
      if (d.method === 'pickup') L.push('It is ready to collect from the shop.');
      else L.push('Delivering to ' + where + ' via ' + via + '.');
      if (d.remaining && ON_RECEIPT.indexOf(d.method) > -1) L.push('The rest is paid on delivery.');
      if (d.remaining && COMPANY.indexOf(d.method) > -1) L.push('We ship as soon as the rest arrives.');
      if (link) { L.push(''); L.push('Track your order: ' + link); }
      L.push('— ' + CONFIG.SHOP_NAME);
    }
    return L.join('\n');
  }

  /* How to pay: the amount, and the shop's own account for each transfer
     method the owner has filled in (pay.accounts, config.write only). */
  function waPay(o, ar) {
    var d = o.delivery;
    var code = o.sale.currency;
    var accounts = (boot && boot.settings && boot.settings.accounts) || {};
    var name = firstNameOf(o.sale.customerName || (o.customer && o.customer.name));
    var L = [];
    L.push(ar ? 'أهلاً ' + name + '،' : 'Hi ' + name + ',');
    L.push((ar ? 'المبلغ المطلوب لطلبك ' : 'Amount due for order ') + o.sale.id + ': ' +
      moneyText(d.remaining, code));
    if (COMPANY.indexOf(d.method) > -1) L.push(ar ? 'الشحن يتم بعد وصول المبلغ.' : 'We ship once the payment arrives.');
    var any = false;
    Object.keys(accounts).forEach(function (id) {
      var a = accounts[id];
      var txt = ar ? (a.ar || a.en) : (a.en || a.ar);
      if (!txt) return;
      if (!any) { L.push(''); L.push(ar ? 'طرق الدفع:' : 'You can pay by:'); any = true; }
      L.push('• ' + DB.payLabel(id) + ': ' + txt);
    });
    L.push('');
    L.push(ar ? 'بعد التحويل أرسل لنا رقم العملية أو صورة الإشعار.'
              : 'After paying, send us the transaction number or a photo of the receipt.');
    L.push('— ' + CONFIG.SHOP_NAME);
    return L.join('\n');
  }

  function waSend(kind, o) {
    var cust = o.sale.customerId ? DB.customer(o.sale.customerId) : (o.customer || null);
    var phone = (o.delivery && o.delivery.phone) || (cust && cust.phone) || '';
    if (!phone) { toast(t('dk_title'), t('dk_no_phone'), 'warn'); return; }
    var ar = OG.lang === 'ar';
    var text = kind === 'pay' ? waPay(o, ar) : waConfirm(o, ar);

    /* wa.me cannot report a send, so what is recorded is that the message was
       OPENED, for which order, by whom — server/lib/partner.js logWhatsApp,
       written in 015 and never called until now. */
    API.post('/api/wa-messages', {
      phone: phone, body: text, kind: kind === 'pay' ? 'order_pay' : 'order_confirm',
      refType: 'sale', refId: o.sale.id
    }).catch(function () { /* the message still opens; the record is not the point of it */ });

    WA.compose({
      to: phone, text: text, name: (cust && cust.name) || '',
      kind: kind === 'pay' ? 'order_pay' : 'order_confirm',
      title: kind === 'pay' ? t('dk_wa_pay') : t('dk_wa_confirm')
    });
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
      /* THE CONFIRMATION IS THE THIRD PANEL, so on a stacked layout it is two
         screens below the scan box the person is looking at: the order saved
         and nothing visibly happened. Bring it to them. Harmless on the wide
         layout, where it is already on screen and at the top of its column. */
      var card = document.getElementById('dkSum');
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
      paint('sum');
      toast(t('dk_title'), err.message || API.friendly(err), 'err', 7000);
    });
  }

  /* A payment that arrived after the order was made — the rest of a deposit,
     a transfer the next morning. */
  function takePayment(saleId) {
    API.get('/api/orders/by-sale/' + encodeURIComponent(saleId)).then(function (r) {
      var o = r.order;
      var code = o.sale.currency;
      var left = o.delivery.remaining;
      if (!left) { toast(t('dk_title'), t('dk_already_paid'), 'warn'); return; }
      var methods = DB.payMethodsFor('desk');
      if (!methods.length) methods = [{ id: 'cash', en: 'Cash', ar: 'نقداً' }];

      openModal({
        title: t('dk_take_payment') + ' · ' + o.sale.id, size: 'narrow',
        body: '<div class="dk-tot">' + sumRow(t('dk_remaining'), fmt(left, code)) + '</div>' +
          '<label class="field mt"><span>' + t('dk_amount') + '</span>' +
            '<input class="inp num" id="dkPayAmt" type="text" inputmode="decimal" dir="ltr" value="' +
              esc(moneyPlain(left, code)) + '"></label>' +
          ((boot.currencies || []).length > 1
            ? '<label class="field"><span>' + t('dk_currency') + '</span><select class="inp" id="dkPayCur">' +
              boot.currencies.map(function (c) {
                return '<option value="' + esc(c.code) + '"' + (c.code === code ? ' selected' : '') + '>' +
                  esc(c.code) + '</option>';
              }).join('') + '</select></label>' : '') +
          '<label class="field"><span>' + t('payment') + '</span><select class="inp" id="dkPayMethod">' +
            methods.map(function (m) {
              return '<option value="' + esc(m.id) + '">' +
                esc(OG.lang === 'ar' ? (m.ar || m.en) : (m.en || m.ar)) + '</option>';
            }).join('') + '</select></label>' +
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
    if (!S.phone && c.phone) S.phone = c.phone;
    if (!S.city && c.city) S.city = c.city;
    if (!S.address && c.address) S.address = c.address;
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
    ACTIONS['dk-cust-clear'] = function () { S.customerId = null; touch('who', 'sum'); };
    ACTIONS['dk-cust-new'] = function () {
      if (typeof openNewCustomer !== 'function') return;
      openNewCustomer(S.custQ, function (c) { if (c && c.id) pickCustomer(c.id); });
    };
    ACTIONS['dk-last'] = function () {
      if (!S.customerId) return;
      API.get('/api/orders/last-destination/' + S.customerId).then(function (r) {
        if (!r.dest) { toast(t('dk_title'), t('dk_no_last'), 'warn'); return; }
        S.country = r.dest.country || S.country;
        S.city = r.dest.city || S.city;
        S.address = r.dest.address || S.address;
        S.phone = r.dest.phone || S.phone;
        if (r.dest.recipient) { S.someoneElse = true; S.recipient = r.dest.recipient; }
        touch('who', 'sum');
      }).catch(function () { toast(t('dk_title'), t('dk_no_last'), 'warn'); });
    };

    ACTIONS['dk-channel'] = function (el) { S.channel = el.getAttribute('data-id'); touch('who'); };
    ACTIONS['dk-country'] = function (el) { S.country = el.getAttribute('data-id'); touch('who', 'sum'); };
    ACTIONS['dk-company'] = function (el) {
      var id = el.getAttribute('data-id');
      S.companyId = S.companyId === id ? '' : id;
      touch('who');
    };
    ACTIONS['dk-method'] = function (el) {
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
    ACTIONS['dk-board-go'] = function () {
      closeModal();
      if (typeof go === 'function') go('deliveries');
    };

    if (typeof CHANGES === 'undefined') return;

    CHANGES['dk-q'] = function (el) { setHits(el.value); };
    CHANGES['dk-cust'] = function (el) {
      S.custQ = el.value;
      var host = document.getElementById('dkCustHits');
      if (host) host.innerHTML = custHitsHtml(el.value);
    };
    CHANGES['dk-field'] = function (el) {
      var k = el.getAttribute('data-k');
      S[k] = el.value;
      saveDraft();
      /* The city moves the fee, which moves the total. Everything else here
         moves what Save is waiting for — an address typed with Save still
         greyed out reads as a screen that has stopped working. Both repaint
         around the box being typed into, never through it. */
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

  function inp(change, i, key, value, ph, cls) {
    return '<input class="inp ' + (cls || '') + '" type="text" data-change="' + change + '" data-i="' + i +
      '" data-k="' + key + '" value="' + esc(value == null ? '' : value) + '"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
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

  function pricesCard() {
    var countries = draft().countries.map(function (c) { return { id: c.id, label: (OG.lang === 'ar' ? c.ar : c.en) || c.id }; });
    var methods = [{ id: '', label: t('dks_any_method') }].concat(
      ['driver', 'office', 'courier', 'abroad'].map(function (m) { return { id: m, label: t('dk_m_' + m) }; }));
    var currencies = (boot.currencies || []).map(function (c) { return { id: c.code, label: c.code }; });
    var modes = [{ id: 'invoice', label: t('dk_fee_shop') }, { id: 'courier', label: t('dk_fee_to_courier') }];

    var rows = draft().prices.map(function (p, i) {
      return '<div class="dks-row dks-price">' +
        sel('dks-p', i, 'country', p.country, countries) +
        inp('dks-p', i, 'city_en', p.city_en, t('dks_city_any')) +
        inp('dks-p', i, 'city_ar', p.city_ar, 'المدينة') +
        sel('dks-p', i, 'method', p.method || '', methods) +
        inp('dks-p', i, 'fee', p.fee, '0', 'num') +
        sel('dks-p', i, 'currency', p.currency, currencies) +
        sel('dks-p', i, 'fee_mode', p.fee_mode, modes) +
        '<span>' + sw('dks-p', i, 'active', p.active !== false) + '</span></div>';
    }).join('') || '<div class="dks-none">' + t('dks_no_prices') + '</div>';

    return setFoldStart('dk-prices', t('dks_prices'), nf(draft().prices.length)) +
      '<div class="card-body"><div class="partner-note">' + t('dks_prices_note') + '</div>' +
      '<div class="dks-list">' + rows + '</div>' +
      '<button class="btn btn-sm mt" data-act="dks-add" data-k="prices">+ ' + t('dks_add_price') + '</button>' +
      saveBtn('prices') + '</div>' + setFoldEnd();
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

  function settingsCards() {
    if (!allow('config.write')) return '';
    if (!boot) { load(); return ''; }
    return setSection(t('setg_delivery')) + methodsCard() + companiesCard() + pricesCard() + accountsCard();
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
    };

    ACTIONS['dks-save'] = function (el) {
      var k = el.getAttribute('data-k');
      var d = draft();
      var body = {};
      if (k === 'methods') body.methods = d.methods;
      else if (k === 'companies') body.companies = d.companies;
      else if (k === 'prices') body.prices = d.prices;
      else body.accounts = d.accounts || {};

      API.put('/api/delivery/settings', body).then(function (r) {
        boot.settings = r.settings;
        setDraft = JSON.parse(JSON.stringify(r.settings));
        toast(t('setg_delivery'), t('dks_saved'), 'ok', 3000);
        if (typeof render === 'function') render();
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
      : (k === 'fee' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value);
  }

  return {
    view: view,
    after: after,
    register: register,
    owns: owns,
    scanned: scanned,
    reload: function () { boot = null; load(); },
    settingsCards: settingsCards,

    /* The board reads money and opens orders through here rather than
       carrying its own copy of either — one formatter, one order view. */
    moneyText: moneyText,
    fmt: fmt,
    plain: moneyPlain,
    toMinor: toMinor,
    openOrder: openOrder,
    takePayment: takePayment,
    companies: function () {
      return ((boot && boot.settings && boot.settings.companies) || []).filter(function (c) {
        return c && c.active !== false;
      });
    }
  };
})();
