/* ==========================================================================
   OG SYSTEM — Offers                                             [offers.js]
   --------------------------------------------------------------------------
   The owner asked (27 Oct 2026) for a page of its own where a sale is put on
   one product, a few, a category, a brand or the whole shop — and is then
   true everywhere: the website shows it (a badge, the struck price, a
   countdown), and the till and the order desk charge it by themselves.
   Migration 076, server/lib/offers.js, cloud file 043.

   TWO HALVES IN ONE FILE.

   1. THE PRICES (Offers.basket, Offers.badge, Offers.setLive). The till and
      the order desk ask these, and they ask js/offermath.js — the SAME file
      the server prices the sale with, against the live list the server sent
      (GET /api/offers/live, loaded with the shop and again on every live
      push). A preview: the server works the price out again inside the sale.

   2. THE PAGE (#offers, offer.write). Cards with a live countdown, the editor,
      the scoreboard, the poster, and "things that aren't selling". Paints
      #view itself and never calls render(), so after() cannot re-enter
      load() (the Safeers loop, fix 06). Events are data-act="of-…"; the open
      "…" menu, the filter and the editor's draft live in module state.
   ========================================================================== */
var Offers = (function () {
  'use strict';

  var M = function () { return window.OfferMath; };

  /* ============================================================ 1. PRICES */

  var L = { offers: [], sold: {}, at: 0, sig: '' };

  function setLive(r) {
    if (!r || !Array.isArray(r.offers)) return;
    L.offers = r.offers;
    L.sold = r.sold || {};
    L.at = Date.now();
    L.sig = liveSig();
  }

  /* What is live changes by the clock with nobody pressing anything; the
     till asks this every half minute and repaints when it moved. */
  function liveSig() {
    var now = Date.now();
    return L.offers.map(function (o) { return o.id + ':' + M().status(o, now, L.sold); }).join(',');
  }

  function reload() {
    if (typeof API === 'undefined') return Promise.resolve();
    return API.get('/api/offers/live').then(function (r) {
      setLive(r);
      moved();
    }).catch(function () { /* the last list stands */ });
  }

  /* Tell whatever is on screen that prices may have moved. */
  function moved() {
    try { if (typeof POS !== 'undefined' && POS.reprice && OG.view === 'pos') POS.reprice(); } catch (e) {}
    try { if (typeof Desk !== 'undefined' && Desk.offersMoved && OG.view === 'desk') Desk.offersMoved(); } catch (e) {}
    if (OG.view === 'offers' && S.loaded) paint();
  }

  function byId(id) {
    for (var i = 0; i < L.offers.length; i++) if (L.offers[i].id === id) return L.offers[i];
    return null;
  }

  /* lines: [{ productId, qty }] -> [{ segs:[{ qty, price, list, offer }],
     total, listTotal }] with every figure already in `cur` (the till's lira
     by default) — converted per piece the way the server converts it. */
  function basket(lines, conv) {
    var to = conv || function (minor, from) { return DB.liraOf(minor, from); };
    var rows = lines.map(function (l) {
      var p = DB.product(l.productId) || {};
      return { productId: l.productId, type: p.type, brand: p.brand,
               list: p.srcSellingPrice || 0, currency: p.srcCurrency || 'USD', qty: l.qty };
    });
    var out = M() ? M().priceBasket(rows, L.offers, Date.now(), L.sold)
      : rows.map(function (r) { return { segs: [{ qty: r.qty, price: r.list, list: r.list, offerId: null }] }; });
    return out.map(function (x, i) {
      var cur = rows[i].currency;
      var segs = x.segs.map(function (s) {
        return { qty: s.qty, price: to(s.price, cur), list: to(s.list, cur), offer: s.offerId === null ? null : byId(s.offerId) };
      });
      var total = 0, listTotal = 0;
      segs.forEach(function (s) { total += s.qty * s.price; listTotal += s.qty * s.list; });
      return { segs: segs, total: total, listTotal: listTotal };
    });
  }

  /* The card's badge and price for one product, or null. */
  function badge(p) {
    if (!p || !M()) return null;
    var b = M().bestFor(L.offers, { id: p.id, type: p.type, brand: p.brand },
      p.srcSellingPrice || 0, p.srcCurrency || 'USD', Date.now(), L.sold);
    if (!b) return null;
    var o = b.offer;
    return {
      offer: o,
      price: b.price === null ? null : DB.liraOf(b.price, p.srcCurrency),
      list: DB.liraOf(b.list, p.srcCurrency),
      text: dealShort(o, b),
      left: o.maxUnits ? b.left : null
    };
  }

  /* "−25%", "−$10", "$39", "2+1", "2+1 −50%" */
  function dealShort(o, b) {
    if (o.kind === 'bxgy') return o.buyQty + '+' + o.getQty + (o.pct < 100 ? ' −' + o.pct + '%' : '');
    if (o.kind === 'pct') return '−' + o.pct + '%';
    if (o.kind === 'off') return '−' + usd(o.amount);
    if (b && b.list) return '−' + Math.round((b.list - b.price) * 100 / b.list) + '%';
    return usd(o.amount);
  }

  function offerName(o) { return o ? (OG.lang === 'ar' ? o.nameAr : o.nameEn) || o.nameEn : ''; }

  /* =============================================================== helpers */

  var FRESH_MS = 20000;

  function ltr(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
  function usd(cents) {
    var n = Number(cents) || 0;
    return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function cash(minor, cur) {
    if (cur === 'USD') return ltr(usd(minor));
    return ltr(nf(Number(minor) || 0) + ' ' + (OG.lang === 'ar' && cur === 'SYP' ? 'ل.س' : cur));
  }
  /* Money per currency, never added: "450,000 ل.س · $81.50". */
  function pair(m) {
    var keys = Object.keys(m || {}).filter(function (k) { return m[k]; });
    if (!keys.length) return ltr('0');
    return keys.map(function (k) { return cash(m[k], k); }).join(' · ');
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  /* "2d 04:13:09" — the countdown. */
  function countdown(ms) {
    if (ms <= 0) return '0';
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    return (d ? d + (OG.lang === 'ar' ? 'ي ' : 'd ') : '') + two(h) + ':' + two(m) + ':' + two(s);
  }

  function productsText(n) {
    return t(n === 1 ? 'of_n_products_1' : 'of_n_products').replace('{n}', ltr(nf(n)));
  }

  function covered(o) {
    return DB.products.filter(function (p) { return !p.archived && M().covers(o, p); });
  }

  /* ============================================================== 2. PAGE */

  var S = {
    rows: [], loaded: false, failed: null, at: 0, shopAt: 0,
    filter: 'all',         /* all · live · scheduled · ended · off */
    menu: null,            /* the id whose "…" is open */
    draft: null,           /* the editor's values while it is open */
    sug: null, sugDays: 60, sugFailed: false,
    find: '',              /* the editor's product search */
    tick: null
  };

  function load() {
    return API.get('/api/offers').then(function (r) {
      S.rows = r.offers || [];
      if (r.live) setLive(r.live);
      S.loaded = true; S.failed = null; S.at = Date.now();
      S.shopAt = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
      paint();
      if (!S.sug) loadSuggest();
    }).catch(function (e) {
      S.failed = API.friendly(e); S.loaded = true; paint();
    });
  }

  function loadSuggest() {
    return API.get('/api/offers/suggest?days=' + S.sugDays).then(function (r) {
      S.sug = r; S.sugFailed = false; paintSug();
    }).catch(function () { S.sugFailed = true; paintSug(); });
  }

  function paint() {
    if (OG.view !== 'offers') return;
    var host = document.getElementById('view');
    if (!host) return;
    host.innerHTML = view();
    if (typeof hintInputs === 'function') hintInputs(host);
    startTick();
  }

  function paintSug() {
    var el = document.getElementById('ofSug');
    if (el) el.innerHTML = sugHtml();
  }

  function after() {
    var shop = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
    if (!S.loaded || Date.now() - S.at > FRESH_MS || shop !== S.shopAt) load();
    else startTick();
  }

  /* One timer writes the countdowns' text and nothing else — never a repaint,
     because this page holds an open menu and an editor. When an offer
     crosses its start or its end, the page asks the server again. */
  function startTick() {
    if (S.tick) return;
    S.tick = setInterval(function () {
      if (OG.view !== 'offers') { clearInterval(S.tick); S.tick = null; return; }
      var now = Date.now();
      var flip = false;
      var els = document.querySelectorAll('[data-of-cd]');
      for (var i = 0; i < els.length; i++) {
        var to = Date.parse(els[i].getAttribute('data-of-cd'));
        var left = to - now;
        if (left <= 0) flip = true;
        els[i].textContent = countdown(left);
      }
      if (flip && Date.now() - S.at > 3000) load();
    }, 1000);
  }

  function statusOf(o) { return o.status || M().status(o, Date.now(), L.sold); }

  var ST_TONE = { live: 'ok', scheduled: 'neutral', ended: 'neutral', off: 'neutral', soldout: 'warn' };

  function counts() {
    var c = { all: S.rows.length, live: 0, scheduled: 0, ended: 0, off: 0 };
    S.rows.forEach(function (o) {
      var s = statusOf(o);
      if (s === 'soldout') s = 'ended';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
  }

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('of_title') + '</h1>' +
      '<div class="sub">' + t('of_sub') + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-primary" data-act="of-new">+ ' + t('of_new') + '</button></div></div>';
    if (S.failed) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(S.failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="of-reload">' + t('retry') + '</button></div></div>';
    }
    if (!S.loaded) {
      return head + '<div class="of-grid" aria-busy="true"><div class="of-skel"></div><div class="of-skel"></div><div class="of-skel"></div></div>' +
        '<span class="sr-only" role="status">' + t('of_loading') + '</span>';
    }
    var h = head;
    h += '<div id="ofSug">' + sugHtml() + '</div>';
    if (!S.rows.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('of_empty') + '</b>' +
        '<span>' + t('of_empty_why') + '</span>' +
        '<button class="btn btn-primary mt" data-act="of-new">+ ' + t('of_new') + '</button></div></div>';
    }
    h += filters();
    var shown = S.rows.filter(function (o) {
      var s = statusOf(o);
      if (S.filter === 'all') return true;
      if (S.filter === 'ended') return s === 'ended' || s === 'soldout';
      return s === S.filter;
    });
    h += shown.length
      ? '<div class="of-grid">' + shown.map(card).join('') + '</div>'
      : '<div class="card"><div class="cart-empty"><b>' + t('of_none_here') + '</b></div></div>';
    return h;
  }

  function filters() {
    var c = counts();
    var keys = ['all', 'live', 'scheduled', 'ended', 'off'];
    return '<div class="of-filters" role="tablist">' + keys.map(function (k) {
      return '<button class="of-pill' + (S.filter === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.filter === k) + '" ' +
        'data-act="of-filter" data-k="' + k + '"><span>' + t('of_f_' + k) + '</span><bdi dir="ltr">' + nf(c[k] || 0) + '</bdi></button>';
    }).join('') + '</div>';
  }

  /* The pictures across the top of a card: the offer's own cover, or up to
     four of the products it covers. */
  function mosaic(o, list) {
    if (o.coverUrl) return '<div class="of-cover"><img src="' + esc(o.coverUrl) + '" alt="" loading="lazy"></div>';
    var pics = list.filter(function (p) { return p.image && p.image.src; }).slice(0, 4);
    if (!pics.length) {
      return '<div class="of-cover of-cover-none"></div>';
    }
    return '<div class="of-cover of-mosaic n' + pics.length + '">' + pics.map(function (p) {
      return '<img src="' + esc(p.image.src) + '" alt="" loading="lazy">';
    }).join('') + '</div>';
  }

  function dealBig(o) {
    if (o.kind === 'pct') return '−' + o.pct + '%';
    if (o.kind === 'off') return '−' + usd(o.amount);
    if (o.kind === 'price') return usd(o.amount);
    return o.buyQty + '+' + o.getQty;
  }

  function dealWords(o) {
    if (o.kind === 'pct') return t('of_w_pct').replace('{n}', ltr(o.pct + '%'));
    if (o.kind === 'off') return t('of_w_off').replace('{n}', ltr(usd(o.amount)));
    if (o.kind === 'price') return t('of_w_price').replace('{n}', ltr(usd(o.amount)));
    return t(o.pct >= 100 ? 'of_w_bxgy' : 'of_w_bxgy_pct')
      .replace('{b}', ltr(o.buyQty)).replace('{g}', ltr(o.getQty)).replace('{p}', ltr(o.pct + '%'));
  }

  function scopeWords(o, n) {
    var bits = [];
    if (o.scope === 'all') bits.push(t('of_whole_shop'));
    else {
      var cats = [], brands = [], prods = 0;
      o.targets.forEach(function (x) {
        if (x.exclude) return;
        if (x.kind === 'category') cats.push(DB.typeLabels[x.ref] || x.ref);
        else if (x.kind === 'brand') brands.push(x.ref);
        else prods++;
      });
      if (cats.length) bits.push(esc(cats.join(', ')));
      if (brands.length) bits.push(esc(brands.join(', ')));
      /* Only products picked: the count says it, once. */
      if (prods && (cats.length || brands.length)) bits.push(t('of_n_picked').replace('{n}', ltr(prods)));
    }
    var ex = o.targets.filter(function (x) { return x.exclude; }).length;
    if (ex) bits.push(t('of_n_except').replace('{n}', ltr(ex)));
    return (bits.length ? bits.join(' · ') + ' — ' : '') + productsText(n);
  }

  function card(o) {
    var st = statusOf(o);
    var list = covered(o);
    var now = Date.now();
    var h = '<article class="of-card is-' + st + (S.menu === o.id ? ' has-menu' : '') + '" data-id="' + o.id + '">';
    h += mosaic(o, list);
    h += '<div class="of-deal"><b dir="ltr">' + esc(dealBig(o)) + '</b></div>';
    h += '<div class="of-body">';
    h += '<div class="of-top"><span class="badge ' + (ST_TONE[st] || 'neutral') + ' of-st">' +
      (st === 'live' ? '<i class="of-dot"></i>' : '') + t('of_st_' + st) + '</span>' +
      '<span class="of-more">' +
        '<button class="btn btn-ghost btn-sm of-dots" data-act="of-menu" data-id="' + o.id + '" aria-label="' + esc(t('of_more')) + '" aria-expanded="' + (S.menu === o.id) + '">…</button>' +
        (S.menu === o.id ? menu(o) : '') +
      '</span></div>';
    h += '<h3 class="of-name">' + esc(offerName(o)) + '</h3>';
    h += '<div class="of-what">' + dealWords(o) + '</div>';
    h += '<div class="of-scope muted">' + scopeWords(o, list.length) + '</div>';

    /* When: a live countdown while it runs, the start while it waits. */
    if (st === 'live' && o.endsAt) {
      h += '<div class="of-when"><span>' + t('of_ends_in') + '</span> <b class="of-cd" dir="ltr" data-of-cd="' + esc(o.endsAt) + '">' +
        countdown(Date.parse(o.endsAt) - now) + '</b></div>';
    } else if (st === 'live') {
      h += '<div class="of-when"><span>' + t('of_no_end') + '</span></div>';
    } else if (st === 'scheduled') {
      h += '<div class="of-when"><span>' + t('of_starts_in') + '</span> <b class="of-cd" dir="ltr" data-of-cd="' + esc(o.startsAt) + '">' +
        countdown(Date.parse(o.startsAt) - now) + '</b></div>';
    } else if (st === 'ended' && o.endsAt) {
      h += '<div class="of-when muted"><span>' + t('of_ended_on').replace('{d}', esc(fmtDate(new Date(o.endsAt)))) + '</span></div>';
    }

    /* A flash sale: how much of it is left. */
    if (o.maxUnits) {
      var left = o.left === null || o.left === undefined ? o.maxUnits : o.left;
      var pct = Math.max(0, Math.min(100, Math.round((o.maxUnits - left) * 100 / o.maxUnits)));
      h += '<div class="of-flash"><div class="of-flash-t"><span>⚡ ' + t('of_flash_left').replace('{n}', ltr(nf(left))).replace('{m}', ltr(nf(o.maxUnits))) + '</span></div>' +
        '<div class="of-meter"><i style="width:' + pct + '%"></i></div></div>';
    }

    h += '<div class="of-nums">' +
      '<div><b dir="ltr">' + nf((o.money && o.money.sales) || 0) + '</b><small>' + t('of_sales_n') + '</small></div>' +
      '<div><b dir="ltr">' + nf(o.sold || 0) + '</b><small>' + t('of_pieces_at') + '</small></div>' +
      '<div><b>' + pair(o.money && o.money.saved) + '</b><small>' + t('of_saved_c') + '</small></div>' +
    '</div>';

    h += '<div class="of-acts">' +
      '<button class="btn btn-sm" data-act="of-score" data-id="' + o.id + '">' + t('of_score') + '</button>' +
      '<button class="btn btn-sm btn-ghost" data-act="of-poster" data-id="' + o.id + '">' + t('of_poster') + '</button>' +
    '</div>';
    return h + '</div></article>';
  }

  function menu(o) {
    return '<div class="of-menu" role="menu">' +
      '<button role="menuitem" data-act="of-edit" data-id="' + o.id + '">' + t('of_edit') + '</button>' +
      '<button role="menuitem" data-act="of-toggle" data-id="' + o.id + '">' + t(o.active ? 'of_switch_off' : 'of_switch_on') + '</button>' +
      '<button role="menuitem" data-act="of-copy" data-id="' + o.id + '">' + t('of_copy') + '</button>' +
      (o.sold ? '' : '<button role="menuitem" class="bk-danger" data-act="of-delete" data-id="' + o.id + '">' + t('of_delete') + '</button>') +
    '</div>';
  }

  /* --------------------------------------------- things that aren't selling */

  function sugHtml() {
    if (!S.sug) return '';
    var rows = (S.sug.rows || []).filter(function (r) { return !r.inOffer; });
    if (!rows.length) return '';
    var cap = {};
    rows.forEach(function (r) { cap[r.currency] = (cap[r.currency] || 0) + (r.capital || 0); });
    var pieces = rows.reduce(function (a, r) { return a + r.pieces; }, 0);
    var pics = rows.slice(0, 6).map(function (r) {
      var p = DB.product(r.id);
      return p ? thumb(p, 'of-sug-th') : '';
    }).join('');
    var days = [30, 60, 90].map(function (n) {
      return '<button class="of-pill' + (S.sugDays === n ? ' on' : '') + '" data-act="of-sug-days" data-n="' + n + '"><bdi dir="ltr">' + n + '</bdi></button>';
    }).join('');
    return '<section class="card of-sug">' +
      '<div class="of-sug-l"><div class="of-sug-pics">' + pics + '</div></div>' +
      '<div class="of-sug-r">' +
        '<b>' + t('of_sug_title').replace('{n}', ltr(nf(rows.length))).replace('{d}', ltr(S.sugDays)) + '</b>' +
        '<span class="muted">' + t('of_sug_sub').replace('{p}', ltr(nf(pieces))).replace('{m}', pair(cap)) + '</span>' +
        '<div class="of-sug-acts"><span class="of-days">' + t('of_sug_days') + ' ' + days + '</span>' +
        '<button class="btn btn-primary btn-sm" data-act="of-sug-go">' + t('of_sug_go') + '</button></div>' +
      '</div></section>';
  }

  /* ================================================================ EDITOR */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function joinIso(date, time) {
    if (!date) return null;
    var d = new Date(date + 'T' + (time || '00:00') + ':00');
    return isFinite(d.getTime()) ? d.toISOString() : null;
  }

  function blankDraft(fromSug) {
    var now = new Date();
    var end = new Date(now.getTime() + 7 * 86400000);
    return {
      id: null, nameEn: '', nameAr: '', kind: 'pct', pct: '20', amount: '', buyQty: '2', getQty: '1', freePct: '100',
      scope: fromSug ? 'pick' : 'pick', targets: fromSug || [],
      sDate: localDate(now), sTime: localTime(now), eDate: localDate(end), eTime: '23:59', noEnd: false,
      len: 'w1', dates: false, named: false,
      maxUnits: '', stack: false, note: '', active: true, more: false, sold: 0, err: null, field: null
    };
  }

  function draftFrom(o) {
    var s = new Date(o.startsAt), e = o.endsAt ? new Date(o.endsAt) : null;
    return {
      id: o.id, nameEn: o.nameEn, nameAr: o.nameAr, kind: o.kind,
      pct: o.kind === 'pct' ? String(o.pct) : '20',
      amount: o.amount ? String(o.amount / 100) : '',
      buyQty: String(o.buyQty || 2), getQty: String(o.getQty || 1), freePct: String(o.kind === 'bxgy' ? o.pct : 100),
      scope: o.scope, targets: o.targets.map(function (x) { return { kind: x.kind, ref: x.ref, exclude: !!x.exclude }; }),
      sDate: localDate(s), sTime: localTime(s), eDate: e ? localDate(e) : '', eTime: e ? localTime(e) : '23:59', noEnd: !e,
      maxUnits: o.maxUnits ? String(o.maxUnits) : '', stack: !!o.stackCoupons, note: o.note || '', active: o.active,
      len: null, dates: true, named: true,
      more: !!(o.maxUnits || o.stackCoupons || o.note), sold: o.sold || 0, err: null, field: null
    };
  }

  function readDraft() {
    var D = S.draft; if (!D) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    var v;
    var nm = document.getElementById('ofName');
    if (nm) { D[OG.lang === 'ar' ? 'nameAr' : 'nameEn'] = nm.value; if (nm.value.trim()) D.named = true; }
    [['ofNameOther', OG.lang === 'ar' ? 'nameEn' : 'nameAr'], ['ofPct', 'pct'], ['ofAmount', 'amount'], ['ofBuy', 'buyQty'],
     ['ofGet', 'getQty'], ['ofFreePct', 'freePct'], ['ofSDate', 'sDate'], ['ofSTime', 'sTime'], ['ofEDate', 'eDate'],
     ['ofETime', 'eTime'], ['ofMax', 'maxUnits'], ['ofNote', 'note']].forEach(function (x) {
      if ((v = g(x[0])) !== null) D[x[1]] = v;
    });
    var st = document.getElementById('ofStack'); if (st) D.stack = st.checked;
  }

  /* The offer as the server and OfferMath read it, from the draft. */
  function draftOffer() {
    var D = S.draft;
    var o = { id: D.id || -1, kind: D.kind, scope: D.scope, targets: D.targets, active: true,
      startsAt: joinIso(D.sDate, D.sTime), endsAt: D.noEnd ? null : joinIso(D.eDate, D.eTime) };
    if (D.kind === 'pct') o.pct = Desk.toCount(D.pct);
    if (D.kind === 'off' || D.kind === 'price') o.amount = Desk.toMinor(D.amount, 'USD');
    if (D.kind === 'bxgy') { o.buyQty = Desk.toCount(D.buyQty); o.getQty = Desk.toCount(D.getQty); o.pct = Desk.toCount(D.freePct) || 100; }
    var mx = Desk.toCount(D.maxUnits); if (mx > 0) o.maxUnits = mx;
    o.stackCoupons = !!D.stack;
    return o;
  }

  function fieldErr(name) {
    var D = S.draft;
    return D && D.err && D.field === name ? '<div class="of-err">' + esc(D.err) + '</div>' : '';
  }

  var KIND_ICON = { pct: '%', off: '−$', price: '$', bxgy: '2+1' };

  /* A name nobody had to type: "25% off" / "خصم 25%". The owner may write
     their own; this only fills an empty box. */
  function autoName(o, lang) {
    var ar = lang === 'ar';
    if (o.kind === 'pct') return ar ? 'خصم ' + (o.pct || '') + '%' : (o.pct || '') + '% off';
    if (o.kind === 'off') return ar ? 'خصم ' + usd(o.amount || 0) : usd(o.amount || 0) + ' off';
    if (o.kind === 'price') return ar ? 'بـ ' + usd(o.amount || 0) : 'Now ' + usd(o.amount || 0);
    return ar ? 'اشتري ' + o.buyQty + ' وخود ' + o.getQty : 'Buy ' + o.buyQty + ' get ' + o.getQty;
  }

  function step(n, title, body, done) {
    return '<section class="of-step' + (done ? ' is-done' : '') + '"><div class="of-step-h"><i>' + (done ? '✓' : n) + '</i><b>' + title + '</b></div>' + body + '</section>';
  }

  /* THREE STEPS AND NOTHING ELSE ON SHOW: what the deal is, what it is on,
     how long. A name is filled in for you; the other language, the exact
     dates, the flash limit and the coupon switch wait under one fold. */
  function dialogBody() {
    var D = S.draft;
    var locked = D.sold > 0;
    var o = draftOffer();
    var h = '<div class="of-dlg">';

    /* 1 — the deal */
    var deal = '<div class="of-kinds">' + ['pct', 'off', 'price', 'bxgy'].map(function (k) {
      return '<button type="button" class="of-kind' + (D.kind === k ? ' on' : '') + '" data-act="of-kind" data-k="' + k + '"' + (locked ? ' disabled' : '') + '>' +
        '<b dir="ltr">' + KIND_ICON[k] + '</b><span>' + t('of_k_' + k) + '</span></button>';
    }).join('') + '</div>';
    if (D.kind === 'pct') {
      deal += '<label class="field cb-big"><span>' + t('of_pct') + '</span><input class="inp num cb-big-in" id="ofPct" type="text" inputmode="numeric" dir="ltr" placeholder="20" value="' + esc(D.pct) + '" data-change="of-live"' + (locked ? ' disabled' : '') + '>' + fieldErr('pct') + '</label>';
    } else if (D.kind === 'off' || D.kind === 'price') {
      deal += '<label class="field cb-big"><span>' + t(D.kind === 'off' ? 'of_amount_off' : 'of_amount_price') + '</span>' +
        '<input class="inp num cb-big-in" id="ofAmount" type="text" inputmode="decimal" dir="ltr" placeholder="10" value="' + esc(D.amount) + '" data-change="of-live"' + (locked ? ' disabled' : '') + '>' +
        '<small class="pr-lira muted" id="ofAmountLira">' + (typeof liraHint === 'function' ? liraHint(Desk.toMinor(D.amount, 'USD')) : '') + '</small>' +
        fieldErr('amount') + '</label>';
    } else {
      deal += '<div class="of-bxgy2"><span>' + t('of_buy') + '</span>' +
        '<input class="inp num" id="ofBuy" type="text" inputmode="numeric" dir="ltr" value="' + esc(D.buyQty) + '" data-change="of-live"' + (locked ? ' disabled' : '') + '>' +
        '<span>' + t('of_get_free') + '</span>' +
        '<input class="inp num" id="ofGet" type="text" inputmode="numeric" dir="ltr" value="' + esc(D.getQty) + '" data-change="of-live"' + (locked ? ' disabled' : '') + '>' +
        '<span>' + t('of_free_word') + '</span></div>' + fieldErr('bxgy');
    }
    if (locked) deal += '<small class="muted">' + t('of_deal_locked') + '</small>';
    h += step(1, t('of_s1'), deal, true);

    /* 2 — on what */
    var on = '<div class="of-scope-t">' +
      '<button type="button" class="of-pill' + (D.scope === 'pick' ? ' on' : '') + '" data-act="of-scope" data-k="pick">' + t('of_choose') + '</button>' +
      '<button type="button" class="of-pill' + (D.scope === 'all' ? ' on' : '') + '" data-act="of-scope" data-k="all">' + t('of_whole_shop') + '</button>' +
    '</div><div id="ofPick">' + pickHtml() + '</div>';
    h += step(2, t('of_s2'), on, D.scope === 'all' || D.targets.some(function (x) { return !x.exclude; }));

    /* 3 — how long */
    var when = '<div class="of-quick">' + ['d1', 'd3', 'w1', 'weekend', 'm1', 'none'].map(function (k) {
      return '<button type="button" class="of-pill' + (D.len === k ? ' on' : '') + '" data-act="of-quick" data-k="' + k + '">' + t('of_q_' + k) + '</button>';
    }).join('') + '</div>';
    when += '<div class="of-when-say muted">' + whenSay(o) +
      ' <button type="button" class="link" data-act="of-dates">' + t(D.dates ? 'of_dates_hide' : 'of_dates') + '</button></div>';
    if (D.dates) {
      when += '<div class="row2">' +
        '<label class="field"><span>' + t('of_starts') + '</span><div class="of-dt"><input class="inp" id="ofSDate" type="date" value="' + esc(D.sDate) + '" data-change="of-live">' +
          '<input class="inp" id="ofSTime" type="time" dir="ltr" value="' + esc(D.sTime) + '" data-change="of-live"></div>' + fieldErr('start') + '</label>' +
        '<label class="field"><span>' + t('of_ends') + '</span>' + (D.noEnd
          ? '<div class="of-noend muted">' + t('of_no_end') + '</div>'
          : '<div class="of-dt"><input class="inp" id="ofEDate" type="date" value="' + esc(D.eDate) + '" data-change="of-live">' +
            '<input class="inp" id="ofETime" type="time" dir="ltr" value="' + esc(D.eTime) + '" data-change="of-live"></div>') + fieldErr('end') + '</label>' +
      '</div>';
    } else {
      when += fieldErr('start') + fieldErr('end');
    }
    h += step(3, t('of_s3'), when, true);

    h += '<div id="ofPreview">' + previewHtml() + '</div>';

    /* Everything else, folded. */
    var mine = OG.lang === 'ar' ? 'nameAr' : 'nameEn', other = OG.lang === 'ar' ? 'nameEn' : 'nameAr';
    h += '<div class="wh-fold"><button class="wh-more-h" type="button" data-act="of-more">' +
      t('of_more_opts') + '<span class="wh-more-x">' + (D.more ? '−' : '+') + '</span></button>' +
      '<div class="wh-fold-b"' + (D.more ? '' : ' hidden') + '>' +
        '<label class="field"><span>' + t('of_name') + '</span><input class="inp" id="ofName" dir="auto" maxlength="80" value="' + esc(D[mine]) + '" placeholder="' + esc(autoName(o, OG.lang)) + '" data-change="of-live">' + fieldErr('name') + '</label>' +
        '<label class="field"><span>' + t(OG.lang === 'ar' ? 'of_name_en' : 'of_name_ar') + '</span><input class="inp" id="ofNameOther" dir="' + (OG.lang === 'ar' ? 'ltr' : 'rtl') + '" maxlength="80" value="' + esc(D[other]) + '" placeholder="' + esc(autoName(o, OG.lang === 'ar' ? 'en' : 'ar')) + '" data-change="of-live"></label>' +
        (D.kind === 'bxgy' ? '<label class="field"><span>' + t('of_get_pct') + '</span><input class="inp num" id="ofFreePct" type="text" inputmode="numeric" dir="ltr" value="' + esc(D.freePct) + '" data-change="of-live"' + (locked ? ' disabled' : '') + '><small class="muted">' + t('of_bxgy_hint') + '</small></label>' : '') +
        '<label class="field"><span>⚡ ' + t('of_flash') + '</span><input class="inp num" id="ofMax" type="text" inputmode="numeric" dir="ltr" placeholder="∞" value="' + esc(D.maxUnits) + '" data-change="of-live">' +
          '<small class="muted">' + t('of_flash_sub') + '</small>' + fieldErr('max') + '</label>' +
        '<div class="rule-row"><div class="rr-txt"><b>' + t('of_stack') + '</b><small>' + t('of_stack_sub') + '</small></div>' +
          '<label class="switch"><input type="checkbox" id="ofStack"' + (D.stack ? ' checked' : '') + ' data-change="of-live"><i></i></label></div>' +
        '<label class="field"><span>' + t('of_note') + '</span><input class="inp" id="ofNote" dir="auto" maxlength="300" value="' + esc(D.note) + '" data-change="of-live"></label>' +
      '</div></div>';

    h += (D.err && !D.field ? '<div class="of-err">' + esc(D.err) + '</div>' : '');
    return h + '</div>';
  }

  /* "From now until Mon 3 Nov, 11:59 PM" — what the length chosen means. */
  function whenSay(o) {
    var now = Date.now();
    var s = Date.parse(o.startsAt);
    var from = !isFinite(s) || s <= now + 60000 ? t('of_from_now') : t('of_from_d').replace('{d}', esc(fmtDateTime(new Date(s))));
    return from + ' · ' + (o.endsAt ? t('of_until_d').replace('{d}', esc(fmtDateTime(new Date(o.endsAt)))) : t('of_no_end'));
  }

  /* What it is on: the chips chosen, and the search that adds more. */
  function brands() {
    var seen = {}, out = [];
    DB.products.forEach(function (p) {
      var b = String(p.brand || '').trim();
      if (!b || p.archived) return;
      var k = b.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(b); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  function chipLabel(x) {
    if (x.kind === 'category') return DB.typeLabels[x.ref] || x.ref;
    if (x.kind === 'brand') return x.ref;
    var p = DB.product(Number(x.ref));
    return p ? p.name : '#' + x.ref;
  }

  function pickHtml() {
    var D = S.draft;
    var inc = D.targets.filter(function (x) { return !x.exclude; });
    var exc = D.targets.filter(function (x) { return x.exclude; });
    var h = '';
    if (D.scope === 'pick') {
      h += '<div class="of-chips">' + (inc.length ? inc.map(function (x) { return chip(x); }).join('')
        : '<span class="muted">' + t('of_pick_none') + '</span>') + '</div>' + fieldErr('targets');
    }
    h += '<div class="of-find"><input class="inp" id="ofFind" type="search" autocomplete="off" placeholder="' + esc(t('of_find_ph')) + '" value="' + esc(S.find) + '" data-change="of-find">' +
      '<div id="ofFound">' + foundHtml() + '</div></div>';
    if (exc.length) {
      h += '<div class="of-except"><span class="lbl">' + t('of_except') + '</span><div class="of-chips">' +
        (exc.length ? exc.map(function (x) { return chip(x); }).join('') : '<span class="muted">' + t('of_except_none') + '</span>') + '</div></div>';
    }
    return h;
  }

  function chip(x) {
    var i = S.draft.targets.indexOf(x);
    var icon = x.kind === 'category' ? '▦' : x.kind === 'brand' ? '★' : '◉';
    return '<span class="of-chip' + (x.exclude ? ' is-ex' : '') + '"><i>' + icon + '</i><span dir="auto">' + esc(chipLabel(x)) + '</span>' +
      '<button type="button" data-act="of-unpick" data-i="' + i + '" aria-label="' + esc(t('remove')) + '">×</button></span>';
  }

  /* Categories, brands and products matching what is typed (or the
     categories and brands with nothing typed). Each row adds to the offer,
     or — in the whole-shop offer, or with "leave out" — to what it is not on. */
  function foundHtml() {
    var D = S.draft;
    var q = String(S.find || '').trim().toLowerCase();
    var has = function (kind, ref) {
      return D.targets.some(function (x) { return x.kind === kind && String(x.ref).toLowerCase() === String(ref).toLowerCase(); });
    };
    var rows = [];
    DB.activeTypes().forEach(function (id) {
      var name = DB.typeLabels[id] || id;
      if (q && name.toLowerCase().indexOf(q) < 0 && id.indexOf(q) < 0) return;
      if (!has('category', id)) rows.push({ kind: 'category', ref: id, label: name });
    });
    brands().forEach(function (b) {
      if (q && b.toLowerCase().indexOf(q) < 0) return;
      if (!has('brand', b)) rows.push({ kind: 'brand', ref: b, label: b });
    });
    if (q) {
      DB.products.forEach(function (p) {
        if (p.archived || has('product', String(p.id))) return;
        if (DB.productMatch(p, q)) rows.push({ kind: 'product', ref: String(p.id), label: p.name, p: p });
      });
    }
    rows = rows.slice(0, 12);
    if (!rows.length) return q ? '<div class="muted of-found-none">' + t('no_results') + '</div>' : '';
    /* Choosing: a tap puts it ON the offer. The whole shop: a tap leaves it
       OUT. One meaning per mode, said above the list, so there is one button. */
    var exMode = D.scope === 'all';
    return '<div class="of-found-h muted">' + t(exMode ? 'of_tap_out' : 'of_tap_in') + '</div><div class="of-found">' + rows.map(function (r) {
      var icon = r.kind === 'category' ? '▦' : r.kind === 'brand' ? '★' : '';
      return '<button type="button" class="of-frow" data-act="of-pick" data-kind="' + r.kind + '" data-ref="' + esc(r.ref) + '"' + (exMode ? ' data-ex="1"' : '') + '>' +
        (r.p ? thumb(r.p, 'of-fthumb') : '<i class="of-ficon">' + icon + '</i>') +
        '<span class="of-flabel" dir="auto">' + esc(r.label) + '<small class="muted">' + t('of_k_t_' + r.kind) + '</small></span>' +
        '<span class="of-fplus' + (exMode ? ' is-ex' : '') + '" aria-hidden="true">' + (exMode ? '−' : '+') + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  /* THE PREVIEW: what one of its products will look like on the website and
     at the till, and one sentence. */
  function previewHtml() {
    var D = S.draft;
    var o = draftOffer();
    var list = covered(o);
    var n = list.length;
    var h = '<div class="of-prev">';
    var p = list.filter(function (x) { return x.image && x.image.src; })[0] || list[0];
    if (p) {
      var b = null;
      if (o.kind === 'bxgy') b = { price: null };
      else {
        var price = M().unitPrice(o, p.srcSellingPrice || 0, p.srcCurrency);
        b = price === null || price >= p.srcSellingPrice ? null : { price: price };
      }
      var listL = DB.liraOf(p.srcSellingPrice, p.srcCurrency);
      h += '<div class="of-prev-card">' +
        '<span class="of-prev-img">' + thumb(p, 'of-prev-th') +
          (b ? '<span class="of-badge" dir="ltr">' + esc(dealShort(o, b.price === null ? null : { list: p.srcSellingPrice, price: b.price })) + '</span>' : '') + '</span>' +
        '<span class="of-prev-txt"><b dir="auto">' + esc(p.name) + '</b>' +
          (b && b.price !== null
            ? '<span class="of-was">' + money(listL) + '</span><span class="of-now">' + money(DB.liraOf(b.price, p.srcCurrency)) + '</span>'
            : '<span class="of-now">' + money(listL) + '</span>') +
          (o.kind === 'bxgy' ? '<small>' + dealWords(o) + '</small>' : '') +
        '</span></div>';
    }
    var say = n
      ? t('of_say').replace('{n}', productsText(n)).replace('{deal}', dealWords(o))
      : '<span class="muted">' + t('of_say_none') + '</span>';
    if (n && o.endsAt) say += ' · ' + t('of_say_until').replace('{d}', esc(fmtDateTime(new Date(o.endsAt))));
    if (n && o.maxUnits) say += ' · ⚡ ' + t('of_say_flash').replace('{n}', ltr(nf(o.maxUnits)));
    h += '<div class="cb-result of-say">' + say + '</div>';
    return h + '</div>';
  }

  function openDialog() {
    var D = S.draft;
    S.find = '';
    openModal({
      title: D.id ? t('of_edit') + ' · ' + esc(offerName({ nameEn: D.nameEn, nameAr: D.nameAr })) : t('of_new'),
      size: 'wide',
      body: '<div id="ofDlg">' + dialogBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="of-save">' + t(D.id ? 'save' : 'of_start_it') + '</button>',
      onOpen: function () {
        if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
          var el = document.getElementById(D.kind === 'pct' ? 'ofPct' : D.kind === 'bxgy' ? 'ofBuy' : 'ofAmount');
          if (el) { try { el.focus(); } catch (e) {} }
        }
      },
      onClose: function () { S.draft = null; }
    });
  }

  function repaintDialog() {
    var host = document.getElementById('ofDlg');
    if (!host || !S.draft) return;
    var k = typeof focusKey === 'function' ? focusKey(host) : null;
    host.innerHTML = dialogBody();
    if (typeof hintInputs === 'function') hintInputs(host);
    if (k && typeof refocus === 'function') refocus(host, k);
  }

  function repaintLive() {
    var p = document.getElementById('ofPreview'); if (p) p.innerHTML = previewHtml();
  }

  function save(btn) {
    readDraft();
    var D = S.draft;
    D.err = null; D.field = null;
    var o = draftOffer();
    var body = {
      nameEn: String(D.nameEn || '').trim(), nameAr: String(D.nameAr || '').trim(), note: D.note,
      kind: o.kind, scope: o.scope, targets: o.targets, startsAt: o.startsAt, endsAt: o.endsAt,
      maxUnits: o.maxUnits || null, stackCoupons: o.stackCoupons, active: D.active
    };
    if (o.kind === 'pct') body.pct = o.pct;
    if (o.kind === 'off' || o.kind === 'price') body.amount = o.amount;
    if (o.kind === 'bxgy') { body.buyQty = o.buyQty; body.getQty = o.getQty; body.pct = o.pct; }
    /* An empty name is the deal in words, in each language. */
    if (!body.nameEn) body.nameEn = autoName(o, 'en');
    if (!body.nameAr) body.nameAr = autoName(o, 'ar');
    if (!body.nameEn) { D.err = t('err_offer_name'); D.field = 'name'; repaintDialog(); return; }
    if (!o.startsAt) { D.err = t('err_offer_bad_start'); D.field = 'start'; repaintDialog(); return; }
    if (o.endsAt && o.endsAt <= o.startsAt) { D.err = t('err_offer_end_before_start'); D.field = 'end'; repaintDialog(); return; }
    if (o.scope === 'pick' && !o.targets.some(function (x) { return !x.exclude; })) { D.err = t('err_offer_no_targets'); D.field = 'targets'; repaintDialog(); return; }
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    var req = D.id ? API.patch('/api/offers/' + D.id, body) : API.post('/api/offers', body);
    req.then(function (r) {
      closeModal();
      S.draft = null;
      toast(t('of_title'), t(D.id ? 'of_saved' : 'of_made').replace('{name}', esc(offerName(r.offer))), 'ok', 3500);
      load();
      reload();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
      if (!S.draft) return;
      var map = { offer_name: 'name', offer_bad_pct: D.kind === 'bxgy' ? 'bxgy' : 'pct', offer_bad_amount: 'amount', offer_bad_bxgy: 'bxgy',
        offer_no_targets: 'targets', offer_bad_start: 'start', offer_bad_end: 'end', offer_end_before_start: 'end', offer_bad_max: 'max' };
      S.draft.err = API.friendly(err);
      S.draft.field = map[err && err.code] || null;
      repaintDialog();
    });
  }

  /* Quick lengths: from the start chosen (or now), to a time on a day. */
  function quick(k) {
    var D = S.draft;
    readDraft();
    D.len = k;
    /* A length counts from now unless somebody set the start by hand. */
    if (!D.dates && !D.id) { var nw = new Date(); D.sDate = localDate(nw); D.sTime = localTime(nw); }
    var s = new Date(joinIso(D.sDate, D.sTime) || Date.now());
    if (k === 'none') { D.noEnd = true; return; }
    D.noEnd = false;
    var e = new Date(s.getTime());
    if (k === 'd1') e.setDate(e.getDate() + 1);
    else if (k === 'd3') e.setDate(e.getDate() + 3);
    else if (k === 'w1') e.setDate(e.getDate() + 7);
    else if (k === 'm1') e.setMonth(e.getMonth() + 1);
    else if (k === 'weekend') {
      /* Thursday evening to Saturday midnight — the weekend here is Friday. */
      var dow = s.getDay();
      var toThu = (4 - dow + 7) % 7;
      var st = new Date(s.getFullYear(), s.getMonth(), s.getDate() + toThu, 18, 0);
      if (st < s) st = s;
      D.sDate = localDate(st); D.sTime = localTime(st);
      e = new Date(st.getFullYear(), st.getMonth(), st.getDate() + (6 - st.getDay() + 7) % 7, 23, 59);
      D.eDate = localDate(e); D.eTime = localTime(e);
      return;
    }
    D.eDate = localDate(e); D.eTime = k === 'm1' || k === 'w1' || k === 'd3' ? '23:59' : localTime(e);
  }

  /* ============================================================ SCOREBOARD */

  function openScore(id) {
    var o = S.rows.filter(function (x) { return x.id === id; })[0];
    openModal({
      title: t('of_score') + ' · ' + esc(offerName(o)),
      body: '<div id="ofScore"><div class="of-skel" style="height:220px"></div><span class="sr-only" role="status">' + t('of_loading') + '</span></div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>'
    });
    API.get('/api/offers/' + id + '/score').then(function (r) {
      var el = document.getElementById('ofScore');
      if (el) el.innerHTML = scoreHtml(r);
    }).catch(function (err) {
      var el = document.getElementById('ofScore');
      if (el) el.innerHTML = '<div class="cart-empty"><b>' + esc(API.friendly(err)) + '</b></div>';
    });
  }

  function change(a, b) {
    if (!b) return a ? '<span class="of-up">' + t('of_new_sales') + '</span>' : '';
    var pct = Math.round((a - b) * 100 / b);
    var cls = pct >= 0 ? 'of-up' : 'of-down';
    return '<span class="' + cls + '" dir="ltr">' + (pct >= 0 ? '▲ +' : '▼ ') + pct + '%</span>';
  }

  function scoreHtml(r) {
    var d = r.during, b = r.before;
    var days = Math.max(1, Math.round(r.ranMs / 86400000));
    var h = '<div class="of-score">';
    h += '<p class="muted">' + t('of_score_sub').replace('{n}', ltr(nf(r.products))).replace('{d}', ltr(nf(days))) + '</p>';
    h += '<div class="of-score-grid">' +
      '<div class="of-sc"><small>' + t('of_pieces') + '</small><b dir="ltr">' + nf(d.pieces) + '</b>' + change(d.pieces, b.pieces) +
        '<em>' + t('of_before').replace('{n}', ltr(nf(b.pieces))) + '</em></div>' +
      '<div class="of-sc"><small>' + t('of_sales_n') + '</small><b dir="ltr">' + nf(d.sales) + '</b>' + change(d.sales, b.sales) +
        '<em>' + t('of_before').replace('{n}', ltr(nf(b.sales))) + '</em></div>' +
      '<div class="of-sc wide"><small>' + t('of_taken') + '</small><b>' + pair(d.money) + '</b>' +
        '<em>' + t('of_before').replace('{n}', pair(b.money)) + '</em></div>' +
    '</div>';
    h += '<div class="cb-result">' + verdict(d, b) + '</div>';
    if (r.days && r.days.length) {
      h += '<span class="lbl">' + t('of_by_day') + '</span><table class="tbl of-days"><tbody>' + r.days.map(function (x) {
        return '<tr><td>' + esc(fmtDate(new Date(x.day + 'T12:00:00'))) + '</td><td class="num" dir="ltr">' + nf(x.pieces) + ' ' + t('of_pcs') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (r.top && r.top.length) {
      h += '<span class="lbl">' + t('of_top') + '</span><ol class="of-top-list">' + r.top.map(function (x) {
        return '<li><span dir="auto">' + esc(x.name) + '</span><b dir="ltr">' + nf(x.pieces) + '</b></li>';
      }).join('') + '</ol>';
    }
    return h + '</div>';
  }

  function verdict(d, b) {
    if (!d.pieces) return t('of_v_nothing');
    if (!b.pieces) return t('of_v_from_zero').replace('{n}', ltr(nf(d.pieces)));
    var x = d.pieces / b.pieces;
    if (x >= 1.15) return t('of_v_faster').replace('{x}', ltr((Math.round(x * 10) / 10) + '×'));
    if (x <= 0.85) return t('of_v_slower');
    return t('of_v_same');
  }

  /* ================================================================ POSTER */

  var LIME = '#C6FF00', INK = '#0A0A0B';

  function img(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var im = new Image();
      im.crossOrigin = 'anonymous';
      var done = false;
      var tm = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 12000);
      im.onload = function () {
        if (done) return; done = true; clearTimeout(tm);
        /* A picture that would taint the canvas is refused here, before it
           stops the whole poster saving. */
        try { var c = document.createElement('canvas'); c.width = c.height = 2; var x = c.getContext('2d'); x.drawImage(im, 0, 0, 2, 2); x.getImageData(0, 0, 1, 1); resolve(im); }
        catch (e) { resolve(null); }
      };
      im.onerror = function () { if (!done) { done = true; clearTimeout(tm); resolve(null); } };
      im.src = src;
    });
  }

  function cover(ctx, im, x, y, w, h) {
    var r = Math.max(w / im.width, h / im.height);
    var iw = im.width * r, ih = im.height * r;
    ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function fitText(ctx, text, weight, size, max, family) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (ctx.measureText(text).width > max && s > 20) { s -= 4; ctx.font = weight + ' ' + s + 'px ' + family; }
    return s;
  }

  /* A story (1080 × 1920): the mark, the deal enormous, the offer's name in
     both languages, up to four product photos with their sale price, and
     when it ends. */
  function poster(o) {
    var list = covered(o).filter(function (p) { return p.image && p.image.src; });
    if (!list.length) list = covered(o);
    var pick = list.slice(0, 4);
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('800 80px Montserrat'), document.fonts.load('700 60px Montserrat'), document.fonts.load('700 60px Cairo', 'عرض')
    ]).catch(function () {}) : Promise.resolve();
    return Promise.all([fonts, img(o.coverUrl), img('/assets/logo.svg')].concat(pick.map(function (p) { return img(p.image && p.image.src); })))
      .then(function (got) {
        var W = 1080, H = 1920;
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
        var coverImg = got[1], mark = got[2], pics = got.slice(3);
        if (coverImg) {
          ctx.save(); ctx.globalAlpha = 0.45; cover(ctx, coverImg, 0, 0, W, 900); ctx.restore();
          var fade = ctx.createLinearGradient(0, 500, 0, 900);
          fade.addColorStop(0, 'rgba(10,10,11,0)'); fade.addColorStop(1, INK);
          ctx.fillStyle = fade; ctx.fillRect(0, 500, W, 400);
        }
        var g = ctx.createRadialGradient(W * 0.85, 260, 10, W * 0.85, 260, 900);
        g.addColorStop(0, 'rgba(198,255,0,0.30)'); g.addColorStop(1, 'rgba(198,255,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        ctx.direction = 'ltr'; ctx.textBaseline = 'alphabetic';
        if (mark) { ctx.save(); rr(ctx, 80, 90, 110, 110, 24); ctx.clip(); ctx.drawImage(mark, 80, 90, 110, 110); ctx.restore(); }
        ctx.fillStyle = '#fff'; ctx.font = '700 40px Montserrat'; ctx.textAlign = 'left';
        ctx.fillText('OG SPORTS', 220, 162);

        /* The deal, as big as it will go. */
        var deal = dealBig(o);
        if (o.kind === 'pct' || o.kind === 'off') deal = deal.replace('−', '-');
        ctx.fillStyle = LIME; ctx.textAlign = 'left';
        var ds = fitText(ctx, deal, '800', 330, W - 160, 'Montserrat');
        ctx.fillText(deal, 70, 330 + ds * 0.8);
        var y = 330 + ds * 0.8 + 90;
        ctx.fillStyle = '#fff';
        var sub = o.kind === 'bxgy' ? (o.pct >= 100 ? 'BUY ' + o.buyQty + ' GET ' + o.getQty + ' FREE' : 'BUY ' + o.buyQty + ' GET ' + o.getQty + ' ' + o.pct + '% OFF')
          : o.kind === 'price' ? 'SALE PRICE' : 'OFF';
        fitText(ctx, sub, '700', 64, W - 160, 'Montserrat'); ctx.fillText(sub, 80, y);
        y += 90;
        ctx.font = '700 64px Montserrat';
        var en = o.nameEn || '';
        fitText(ctx, en, '700', 64, W - 160, 'Montserrat'); ctx.fillText(en, 80, y);
        y += 96;
        ctx.direction = 'rtl'; ctx.textAlign = 'right';
        fitText(ctx, o.nameAr || '', '700', 70, W - 160, 'Cairo, Montserrat'); ctx.fillText(o.nameAr || '', W - 80, y);
        ctx.direction = 'ltr'; ctx.textAlign = 'left';
        y += 70;

        /* The products, two by two, each with its sale price. */
        var gy = Math.max(y, 1000), gap = 30, solo = pick.length === 1;
        var cw = solo ? W - 160 : (W - 160 - gap) / 2, ch = solo ? 600 : pick.length > 2 ? 360 : 520;
        pick.forEach(function (p, i) {
          var cx = 80 + (i % 2) * (cw + gap), cy = gy + Math.floor(i / 2) * (ch + gap + 70);
          ctx.save(); rr(ctx, cx, cy, cw, ch, 32); ctx.clip();
          ctx.fillStyle = '#1b1b1e'; ctx.fillRect(cx, cy, cw, ch);
          if (pics[i]) cover(ctx, pics[i], cx, cy, cw, ch);
          else { ctx.fillStyle = p.image ? p.image.bg : '#333'; ctx.fillRect(cx, cy, cw, ch); ctx.fillStyle = '#fff'; ctx.font = '800 90px Montserrat'; ctx.textAlign = 'center'; ctx.fillText((p.image && p.image.initials) || '', cx + cw / 2, cy + ch / 2 + 30); ctx.textAlign = 'left'; }
          ctx.restore();
          var b = M().unitPrice(o, p.srcSellingPrice || 0, p.srcCurrency);
          var line = o.kind === 'bxgy' || b === null || b >= p.srcSellingPrice ? usd(p.srcSellingPrice) : usd(b);
          ctx.fillStyle = LIME; ctx.font = '800 46px Montserrat';
          ctx.fillText(line, cx + 4, cy + ch + 56);
          if (!(o.kind === 'bxgy' || b === null || b >= p.srcSellingPrice)) {
            var w0 = ctx.measureText(line).width;
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '600 34px Montserrat';
            var was = usd(p.srcSellingPrice);
            ctx.fillText(was, cx + w0 + 22, cy + ch + 56);
            var ww = ctx.measureText(was).width;
            ctx.fillRect(cx + w0 + 22, cy + ch + 44, ww, 3);
          }
        });

        /* When it ends, in a lime band. */
        ctx.fillStyle = LIME; ctx.fillRect(0, H - 170, W, 170);
        ctx.fillStyle = INK; ctx.textAlign = 'center';
        var end = o.endsAt ? new Date(o.endsAt) : null;
        var endEn = end ? 'UNTIL ' + end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase() : 'WHILE STOCKS LAST';
        if (o.maxUnits) endEn = 'ONLY ' + o.maxUnits + ' PIECES · ' + endEn;
        fitText(ctx, endEn, '800', 54, W - 120, 'Montserrat'); ctx.fillText(endEn, W / 2, H - 100);
        ctx.font = '600 34px Montserrat';
        ctx.fillText('shop.ogsports1.com', W / 2, H - 45);
        return cv;
      });
  }

  function savePoster(o, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    poster(o).then(function (cv) {
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('no_png')); }, 'image/png');
      });
    }).then(function (b) {
      var name = 'og-offer-' + o.id + '.png';
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse && typeof File !== 'undefined' && navigator.canShare) {
        var f = new File([b], name, { type: 'image/png' });
        if (navigator.canShare({ files: [f] })) {
          return navigator.share({ files: [f] }).catch(function (e) { if (!e || e.name !== 'AbortError') CouponCard.download(name, b); });
        }
      }
      CouponCard.download(name, b);
      toast(t('of_poster'), t('of_poster_done'), 'ok', 3000);
    }).catch(function () {
      toast(t('of_poster'), t('of_poster_fail'), 'err', 6000);
    }).then(function () { if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); } });
  }

  function openPoster(id) {
    var o = S.rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    openModal({
      title: t('of_poster') + ' · ' + esc(offerName(o)),
      body: '<div class="of-poster-wrap" id="ofPoster"><div class="of-skel of-poster-skel"></div></div>' +
        '<p class="muted">' + t('of_poster_sub') + '</p>' +
        '<div class="of-cover-row"><span class="lbl">' + t('of_cover') + '</span>' +
          '<button class="btn btn-sm" data-act="of-cover" data-id="' + o.id + '">' + t(o.coverUrl ? 'of_cover_change' : 'of_cover_add') + '</button>' +
          (o.coverUrl ? '<button class="btn btn-sm btn-ghost" data-act="of-cover-clear" data-id="' + o.id + '">' + t('remove') + '</button>' : '') +
        '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            '<button class="btn btn-primary" data-act="of-poster-save" data-id="' + o.id + '">' + t('of_poster_save') + '</button>'
    });
    poster(o).then(function (cv) {
      var el = document.getElementById('ofPoster');
      if (!el) return;
      el.innerHTML = '';
      cv.className = 'of-poster-cv';
      el.appendChild(cv);
    }).catch(function () {
      var el = document.getElementById('ofPoster');
      if (el) el.innerHTML = '<div class="cart-empty"><b>' + t('of_poster_fail') + '</b></div>';
    });
  }

  /* A JPEG no wider than 1600, painted on black (a clear PNG would turn
     black anyway, and the poster's ground is black). */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      if (!file || String(file.type).indexOf('image/') !== 0) return reject(new Error(t('of_cover_bad')));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error(t('of_cover_bad'))); };
      fr.onload = function () {
        var im = new Image();
        im.onerror = function () { reject(new Error(t('of_cover_bad'))); };
        im.onload = function () {
          var k = Math.min(1, 1600 / Math.max(im.width, im.height));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
          var cx = cv.getContext('2d');
          cx.fillStyle = INK; cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.86));
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* The cover: one picture from this computer, shrunk in the browser. */
  function pickCover(id) {
    var inp = document.getElementById('ofCoverFile');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'ofCoverFile'; inp.hidden = true;
      document.body.appendChild(inp);
    }
    inp.value = '';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      shrink(f).then(function (dataUrl) {
        return API.post('/api/offers/' + id + '/cover', { dataUrl: dataUrl });
      }).then(function () {
        toast(t('of_cover'), t('of_cover_done'), 'ok', 2500);
        closeModal();
        load().then(function () { openPoster(id); });
      }).catch(function (err) { toast(t('of_cover'), API.friendly(err), 'err', 6000); });
    };
    inp.click();
  }

  /* =============================================================== ACTIONS */

  function find(id) { return S.rows.filter(function (x) { return x.id === id; })[0] || null; }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['of-reload'] = function () { S.failed = null; S.loaded = false; paint(); load(); };
    ACTIONS['of-filter'] = function (el) { S.filter = el.getAttribute('data-k') || 'all'; S.menu = null; paint(); };
    ACTIONS['of-new'] = function () { S.menu = null; paint(); S.draft = blankDraft(); openDialog(); };
    ACTIONS['of-edit'] = function (el) {
      var o = find(+el.getAttribute('data-id'));
      S.menu = null; paint();
      if (!o) return;
      S.draft = draftFrom(o); openDialog();
    };
    ACTIONS['of-copy'] = function (el) {
      var o = find(+el.getAttribute('data-id'));
      S.menu = null; paint();
      if (!o) return;
      var D = draftFrom(o);
      var b = blankDraft();
      D.id = null; D.sold = 0; D.sDate = b.sDate; D.sTime = b.sTime; D.eDate = b.eDate; D.eTime = b.eTime; D.noEnd = false;
      D.nameEn = D.nameEn + ' (2)'; D.nameAr = D.nameAr + ' (٢)';
      S.draft = D; openDialog();
    };
    ACTIONS['of-menu'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.menu = S.menu === id ? null : id; paint();
    };
    ACTIONS['of-toggle'] = function (el) {
      var o = find(+el.getAttribute('data-id'));
      S.menu = null;
      if (!o) { paint(); return; }
      API.patch('/api/offers/' + o.id, { active: !o.active }).then(function (r) {
        toast(t('of_title'), t(r.offer.active ? 'of_now_on' : 'of_now_off').replace('{name}', esc(offerName(r.offer))), 'ok', 3000);
        load(); reload();
      }).catch(function (err) { toast(t('of_title'), API.friendly(err), 'err', 6000); paint(); });
    };
    ACTIONS['of-delete'] = function (el) {
      var o = find(+el.getAttribute('data-id'));
      S.menu = null; paint();
      if (!o) return;
      openModal({
        title: t('of_delete'),
        body: '<p>' + t('of_delete_q').replace('{name}', '<b>' + esc(offerName(o)) + '</b>') + '</p>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn bk-danger" data-act="of-delete-go" data-id="' + o.id + '">' + t('of_delete') + '</button>'
      });
    };
    ACTIONS['of-delete-go'] = function (el) {
      var id = +el.getAttribute('data-id');
      el.disabled = true;
      API.del('/api/offers/' + id).then(function () {
        closeModal(); toast(t('of_title'), t('of_deleted'), 'ok', 2500); load(); reload();
      }).catch(function (err) { el.disabled = false; toast(t('of_title'), API.friendly(err), 'err', 6000); });
    };
    ACTIONS['of-score'] = function (el) { S.menu = null; openScore(+el.getAttribute('data-id')); };
    ACTIONS['of-poster'] = function (el) { S.menu = null; openPoster(+el.getAttribute('data-id')); };
    ACTIONS['of-poster-save'] = function (el) { var o = find(+el.getAttribute('data-id')); if (o) savePoster(o, el); };
    ACTIONS['of-cover'] = function (el) { pickCover(+el.getAttribute('data-id')); };
    ACTIONS['of-cover-clear'] = function (el) {
      var id = +el.getAttribute('data-id');
      API.post('/api/offers/' + id + '/cover', { clear: true }).then(function () {
        closeModal(); load().then(function () { openPoster(id); });
      }).catch(function (err) { toast(t('of_cover'), API.friendly(err), 'err', 6000); });
    };

    ACTIONS['of-sug-days'] = function (el) { S.sugDays = +el.getAttribute('data-n') || 60; loadSuggest(); };
    ACTIONS['of-sug-go'] = function () {
      var rows = (S.sug && S.sug.rows || []).filter(function (r) { return !r.inOffer; });
      if (!rows.length) return;
      S.draft = blankDraft(rows.map(function (r) { return { kind: 'product', ref: String(r.id), exclude: false }; }));
      S.draft.nameEn = 'Clearance'; S.draft.nameAr = 'تصفية'; S.draft.named = true;
      S.draft.pct = '30';
      openDialog();
    };

    ACTIONS['of-kind'] = function (el) {
      if (!S.draft) return;
      readDraft(); S.draft.kind = el.getAttribute('data-k'); S.draft.err = null; S.draft.field = null; repaintDialog();
    };
    ACTIONS['of-scope'] = function (el) {
      if (!S.draft) return;
      readDraft(); S.draft.scope = el.getAttribute('data-k') === 'all' ? 'all' : 'pick'; repaintDialog();
    };
    ACTIONS['of-dates'] = function () { if (!S.draft) return; readDraft(); S.draft.dates = !S.draft.dates; repaintDialog(); };
    ACTIONS['of-more'] = function () { if (!S.draft) return; readDraft(); S.draft.more = !S.draft.more; repaintDialog(); };
    ACTIONS['of-quick'] = function (el) { if (!S.draft) return; quick(el.getAttribute('data-k')); repaintDialog(); };
    ACTIONS['of-pick'] = function (el) {
      if (!S.draft) return;
      readDraft();
      S.draft.targets.push({ kind: el.getAttribute('data-kind'), ref: el.getAttribute('data-ref'), exclude: el.getAttribute('data-ex') === '1' });
      S.draft.err = null; S.draft.field = null;
      /* The box empties after a pick, so the list goes back to the
         categories and brands rather than saying nothing matched. */
      S.find = '';
      var p = document.getElementById('ofPick'); if (p) p.innerHTML = pickHtml();
      repaintLive();
      var f = document.getElementById('ofFind'); if (f) { try { f.focus(); } catch (e) {} }
    };
    ACTIONS['of-unpick'] = function (el) {
      if (!S.draft) return;
      readDraft();
      S.draft.targets.splice(+el.getAttribute('data-i'), 1);
      var p = document.getElementById('ofPick'); if (p) p.innerHTML = pickHtml();
      repaintLive();
    };
    ACTIONS['of-save'] = function (el) { save(el); };

    if (typeof CHANGES !== 'undefined') {
      /* The preview and the lira line only — never the box being typed in. */
      CHANGES['of-live'] = function (el) {
        if (!S.draft) return;
        readDraft();
        if (el && /^of[SE](Date|Time)$/.test(el.id)) S.draft.len = null;
        repaintLive();
        if (el && el.id === 'ofAmount') {
          var l = document.getElementById('ofAmountLira');
          if (l && typeof liraHint === 'function') l.innerHTML = liraHint(Desk.toMinor(el.value, 'USD'));
        }
      };
      CHANGES['of-find'] = function (el) {
        S.find = el.value;
        var f = document.getElementById('ofFound'); if (f) f.innerHTML = foundHtml();
      };
    }

    document.addEventListener('click', function (e) {
      if (S.menu === null) return;
      if (e.target.closest && e.target.closest('.of-more')) return;
      S.menu = null; paint();
    }, true);

    /* An offer starts and ends by the clock: every half minute, if what is
       live moved, the till and the desk reprice. */
    /* A till holds no live line (a cashier is kept off /api/live on purpose,
       so a Full refresh never reloads a sale out from under her): it asks
       for the list once a minute while it is selling. */
    setInterval(function () {
      if (document.hidden || (OG.view !== 'pos' && OG.view !== 'desk')) return;
      reload();
    }, 60000);
    setInterval(function () {
      if (!L.offers.length) return;
      var s = liveSig();
      if (s !== L.sig) { L.sig = s; moved(); }
    }, 30000);
  }

  return {
    view: view, after: after, register: register, load: load,
    setLive: setLive, reload: reload, basket: basket, badge: badge, byId: byId,
    name: offerName, dealShort: dealShort
  };
})();
