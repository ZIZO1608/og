/* ==========================================================================
   OG SYSTEM — Coupon codes                                    [coupons.js]
   --------------------------------------------------------------------------
   The owner asked (28 Sep 2026) for a page of his own where coupon codes are
   made, and where every code says how many people have used it. Migration
   068, server/lib/coupons.js, cloud file 038.

   Every code is drawn as a TICKET — the value on the stub, the code big in
   the middle, and a meter of how much of it is used — because a coupon is a
   thing the shop hands out and a customer hands back, and a row in a table
   reads like an invoice.

   What each code does is decided on the SERVER, inside the sale (the till,
   the order desk and the website's accepted order all go through it). This
   page makes codes, switches them off, edits their limits, and reads their
   uses back; it never works a discount out.

   Paints #view itself and never calls render(), so after() cannot re-enter
   load() (the Safeers loop, fix 06); it asks the server only when it holds
   nothing, when the shop has been written to since, or after FRESH_MS.
   Events are data-act="cpn-…" on the one delegated ACTIONS table, and the
   open "…" menu, the filter and the dialog's draft live in module state,
   because this page repaints under them.
   ========================================================================== */
var Coupons = (function () {
  'use strict';

  var FRESH_MS = 20000;

  var S = {
    rows: [], suggest: '', loaded: false, failed: null, at: 0, shopAt: 0,
    filter: 'all',          /* all · live · stopped */
    menu: null,             /* the id whose "…" is open */
    draft: null,            /* the new/edit dialog's values, while it is open */
    saving: false,
    /* 074 — the QR, the picture, and the street batches. */
    batches: [],
    batch: null,            /* the batch whose codes are on show, or null */
    bdraft: null,           /* the street-batch dialog's values */
    pageBase: 'https://shop.ogsports1.com',
    batchMax: 200,
    zipping: false,
    /* 074 — choosing many codes at once (the bulk bar). */
    selecting: false,
    sel: {},
    bulkBusy: false
  };

  /* ------------------------------------------------------------- helpers */

  function ltr(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
  function usd(cents) {
    var n = Number(cents) || 0;
    return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  /* Minor units in their own currency, never converted and never added. */
  /* A sign goes INSIDE the isolate with its figure, or Arabic carries it to
     the far side ('–ل.س 119,260'). */
  function cash(minor, cur, sign) {
    var pre = sign || '';
    if (cur === 'USD') return ltr(pre + usd(minor));
    var s = nf(Number(minor) || 0);
    return ltr(pre + s + ' ' + (OG.lang === 'ar' && cur === 'SYP' ? 'ل.س' : cur));
  }
  function worth(c) {
    return c.kind === 'percent' ? c.percent + '%' : usd(c.amount);
  }
  function day(iso) { return iso ? fmtDate(new Date(iso)) : ''; }

  /* What a code is doing right now — the same order the server checks in. */
  function status(c) {
    var now = new Date().toISOString();
    if (!c.active) return 'off';
    if (c.expiresAt && now > c.expiresAt) return 'expired';
    if (c.startsAt && now < c.startsAt) return 'soon';
    if (c.maxUses && c.uses >= c.maxUses) return 'used_up';
    return 'live';
  }
  var STATUS_TONE = { live: 'ok', soon: 'neutral', off: 'neutral', expired: 'warn', used_up: 'warn' };

  function find(id) {
    return S.rows.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* ----------------------------------------------------------------- load */

  function load() {
    return API.get('/api/coupons').then(function (r) {
      S.rows = r.coupons || [];
      S.suggest = r.suggest || '';
      S.batches = r.batches || [];
      if (r.pageBase) S.pageBase = r.pageBase;
      if (r.batchMax) S.batchMax = r.batchMax;
      if (S.batch !== null && !S.batches.some(function (b) { return b.id === S.batch; })) S.batch = null;
      S.loaded = true;
      S.failed = null;
      S.at = Date.now();
      S.shopAt = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
      paint();
    }).catch(function (e) {
      S.failed = API.friendly(e);
      S.loaded = true;
      paint();
    });
  }

  function paint() {
    if (OG.view !== 'coupons') return;
    var host = document.getElementById('view');
    if (host) {
      host.innerHTML = view();
      if (typeof hintInputs === 'function') hintInputs(host);
    }
  }

  function after() {
    var shop = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
    if (!S.loaded || Date.now() - S.at > FRESH_MS || shop !== S.shopAt) load();
  }

  /* ----------------------------------------------------------------- view */

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('cpn_title') + '</h1>' +
      '<div class="sub">' + t('cpn_sub') + '</div></div>' +
      '<div class="head-actions">' +
        (S.rows.length ? '<button class="btn btn-ghost' + (S.selecting ? ' on' : '') + '" data-act="cpq-select" aria-pressed="' + S.selecting + '">' +
          '<span>' + t(S.selecting ? 'cpq_sel_done' : 'cpq_select') + '</span></button>' : '') +
        '<button class="btn" data-act="cpq-batch-new">+ ' + t('cpq_batch_new') + '</button>' +
        '<button class="btn btn-primary" data-act="cpn-new">+ ' + t('cpn_new') + '</button></div></div>';

    if (S.failed) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(S.failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="cpn-reload">' + t('retry') + '</button></div></div>';
    }
    if (!S.loaded) {
      return head + '<div class="cpn-grid" aria-busy="true"><div class="cpn-skel"></div><div class="cpn-skel"></div><div class="cpn-skel"></div></div>' +
        '<span class="sr-only" role="status">' + t('cpn_loading') + '</span>';
    }
    if (!S.rows.length) {
      return head + '<div class="card"><div class="cart-empty"><b>' + t('cpn_empty') + '</b>' +
        '<span>' + t('cpn_empty_why') + '</span>' +
        '<button class="btn btn-primary mt" data-act="cpn-new">+ ' + t('cpn_new') + '</button></div></div>';
    }

    if (S.batch !== null) return head + batchHead() + filters() + list() + bulkBar();
    return head + summary() + filters() + list() + bulkBar();
  }

  /* ------------------------------------------------- 074 — the batches */

  /* The codes on show: one batch's, or every code that is in no batch —
     a batch of thirty single-use stickers would bury the shop's own codes. */
  function visibleRows() {
    return S.rows.filter(function (c) {
      return S.batch !== null ? c.batchId === S.batch : !c.batchId;
    }).sort(function (a, b) {
      return S.batch !== null ? (a.batchNo || 0) - (b.batchNo || 0) : 0;
    });
  }

  function batchFacts(b) {
    var codes = S.rows.filter(function (c) { return c.batchId === b.id; });
    var found = 0, used = 0, live = 0;
    codes.forEach(function (c) {
      if (c.scans > 0) found++;
      if (c.uses > 0) used++;
      var st = status(c);
      if (st === 'live' || st === 'soon') live++;
    });
    return { codes: codes, found: found, used: used, live: live, first: codes[0] || null };
  }

  function batchMatch(b, k) {
    var f = batchFacts(b);
    if (k === 'live') return f.live > 0;
    if (k === 'stopped') return f.live === 0;
    return true;
  }

  function batchCard(b) {
    var f = batchFacts(b);
    var n = f.codes.length || 1;
    var bOn = S.selecting && f.codes.length && f.codes.every(function (c) { return S.sel[c.id]; });
    return '<article class="cpq-batch' + (f.live ? '' : ' is-stopped') + (bOn ? ' is-picked' : '') + '">' +
      (S.selecting ? tickBtn('cpq-pick-batch', b.id, bOn, t('cpq_pick_batch').replace('{n}', f.codes.length)) : '') +
      '<div class="cpq-batch-top"><span class="badge accent">' + t('cpq_b_tag') + '</span>' +
        (f.first ? '<b class="cpq-batch-val">' + ltr(worth(f.first)) + '</b>' : '') + '</div>' +
      '<h3 dir="auto">' + esc(b.name) + '</h3>' +
      '<div class="cpq-batch-figs">' +
        '<span>' + t('cpq_b_stickers').replace('{n}', ltr(nf(f.codes.length))) + '</span>' +
        '<span>' + t('cpq_b_found').replace('{n}', ltr(nf(f.found))) + '</span>' +
        '<span>' + t('cpq_b_used').replace('{n}', ltr(nf(f.used))) + '</span>' +
      '</div>' +
      '<div class="cpq-bars" role="img" aria-label="' + esc(t('cpq_b_found').replace('{n}', f.found) + ' · ' + t('cpq_b_used').replace('{n}', f.used)) + '">' +
        '<i class="f" style="width:' + Math.round(f.found / n * 100) + '%"></i>' +
        '<i class="u" style="width:' + Math.round(f.used / n * 100) + '%"></i></div>' +
      (f.live ? '' : '<div class="cpn-used">' + t('cpq_b_none_live') + '</div>') +
      '<div class="cpn-acts">' +
        '<button type="button" class="btn btn-sm" data-act="cpq-batch-open" data-id="' + b.id + '">' + t('cpq_b_open') + '</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="cpq-batch-zip" data-id="' + b.id + '">' + t('cpq_b_zip') + '</button>' +
      '</div>' +
    '</article>';
  }

  /* One batch on show: its name, its three figures, and the zip. */
  function batchHead() {
    var b = S.batches.filter(function (x) { return x.id === S.batch; })[0];
    if (!b) return '';
    var f = batchFacts(b);
    return '<div class="cpq-bhead">' +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="cpq-batch-back">' +
        '<span>' + (OG.lang === 'ar' ? '→ ' : '← ') + t('cpq_back') + '</span></button>' +
      '<h2 dir="auto">' + esc(b.name) + '</h2>' +
      '<button type="button" class="btn btn-sm btn-primary" data-act="cpq-batch-zip" data-id="' + b.id + '">' + t('cpq_b_zip') + '</button>' +
    '</div>' +
    '<div class="cpn-sum">' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpq_b_stickers').replace('{n}', '').trim() + '</span><b>' + ltr(nf(f.codes.length)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpq_b_found').replace('{n}', '').trim() + '</span><b>' + ltr(nf(f.found)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpq_b_used').replace('{n}', '').trim() + '</span><b>' + ltr(nf(f.used)) + '</b></div>' +
    '</div>';
  }

  /* What the picture and the page need from a coupon row. */
  function cardInfo(c) {
    return { code: c.code, kind: c.kind, percent: c.percent, amount: c.amount,
             expiresAt: c.expiresAt, single: c.maxUses === 1, url: pageUrl(c) };
  }
  function pageUrl(c) { return S.pageBase + '/c/' + encodeURIComponent(c.code); }

  /* Three figures across the top: codes working now, times used, and what
     the codes have given away — per currency, never added together. */
  function summary() {
    var live = 0, uses = 0, given = {};
    S.rows.forEach(function (c) {
      if (status(c) === 'live') live++;
      uses += c.uses || 0;
      (c.given || []).forEach(function (g) { given[g.currency] = (given[g.currency] || 0) + (g.amount || 0); });
    });
    var giv = Object.keys(given).filter(function (k) { return given[k]; }).map(function (k) { return cash(given[k], k); });
    return '<div class="cpn-sum">' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_live') + '</span><b>' + ltr(nf(live)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_uses') + '</span><b>' + ltr(nf(uses)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_given') + '</span><b>' + (giv.length ? giv.join('<br>') : '<span class="muted">—</span>') + '</b></div>' +
    '</div>';
  }

  function filters() {
    return '<div class="chip-row cpn-filter" role="tablist">' + ['all', 'live', 'stopped'].map(function (k) {
      var n = visibleRows().filter(function (c) { return match(c, k); }).length +
        (S.batch === null ? S.batches.filter(function (b) { return batchMatch(b, k); }).length : 0);
      return '<button type="button" class="chip' + (S.filter === k ? ' on' : '') + '" role="tab" aria-selected="' +
        (S.filter === k) + '" data-act="cpn-filter" data-k="' + k + '">' +
        /* ONE span: a chip is a flex row, and loose text and a number beside
           it become two items with the space between them dropped. */
        '<span>' + t('cpn_f_' + k) + ' <bdi class="muted">' + nf(n) + '</bdi></span></button>';
    }).join('') + '</div>';
  }

  function match(c, k) {
    var st = status(c);
    if (k === 'live') return st === 'live' || st === 'soon';
    if (k === 'stopped') return st === 'off' || st === 'expired' || st === 'used_up';
    return true;
  }

  function list() {
    var rows = visibleRows().filter(function (c) { return match(c, S.filter); });
    var bs = S.batch === null ? S.batches.filter(function (b) { return batchMatch(b, S.filter); }) : [];
    if (!rows.length && !bs.length) {
      return '<div class="card"><div class="cart-empty"><b>' + t('cpn_none_here') + '</b></div></div>';
    }
    return '<div class="cpn-grid">' + bs.map(batchCard).join('') + rows.map(ticket).join('') + '</div>';
  }

  function ticket(c) {
    var st = status(c);
    var rules = [];
    if (c.minBasket) rules.push(t('cpn_r_min').replace('{n}', ltr(usd(c.minBasket))));
    if (c.oncePerCustomer) rules.push(t('cpn_r_once'));
    if (c.startsAt && st === 'soon') rules.push(t('cpn_r_starts').replace('{d}', esc(day(c.startsAt))));
    if (c.expiresAt) rules.push(t(st === 'expired' ? 'cpn_r_ended' : 'cpn_r_ends').replace('{d}', esc(day(c.expiresAt))));
    if (!rules.length) rules.push(t('cpn_r_anyone'));

    var used = c.uses || 0;
    var meter = c.maxUses
      ? '<div class="cpn-meter" role="img" aria-label="' + esc(t('cpn_used_of').replace('{n}', used).replace('{m}', c.maxUses)) + '">' +
          '<i style="width:' + Math.min(100, Math.round(used / c.maxUses * 100)) + '%"></i></div>' +
        '<div class="cpn-used">' + t('cpn_used_of').replace('{n}', ltr(nf(used))).replace('{m}', ltr(nf(c.maxUses))) + '</div>'
      : '<div class="cpn-used">' + t('cpn_used').replace('{n}', ltr(nf(used))) + ' · ' + t('cpn_no_limit') + '</div>';

    var people = used
      ? '<div class="cpn-people">' + t('cpn_people').replace('{n}', ltr(nf(c.people || 0))) +
          (c.walkins ? ' · ' + t('cpn_walkins').replace('{n}', ltr(nf(c.walkins))) : '') +
          (c.lastUsedAt ? ' · ' + t('cpn_last').replace('{d}', esc(day(c.lastUsedAt))) : '') + '</div>'
      : '';
    var given = (c.given || []).filter(function (g) { return g.amount; })
      .map(function (g) { return cash(g.amount, g.currency, '−'); }).join(' · ');

    var open = S.menu === c.id;
    var on = !!(S.selecting && S.sel[c.id]);
    return '<article class="cpn-tk' + (st === 'live' || st === 'soon' ? '' : ' is-stopped') + (open ? ' has-menu' : '') + (on ? ' is-picked' : '') + '">' +
      (S.selecting ? tickBtn('cpq-pick', c.id, on, c.code) : '') +
      '<div class="cpn-stub"><b>' + ltr(worth(c)) + '</b><span>' + t('cpn_off') + '</span></div>' +
      '<div class="cpn-main">' +
        '<div class="cpn-top">' +
          '<button type="button" class="cpn-code" data-act="cpn-copy" data-id="' + c.id + '" title="' + esc(t('cpn_copy')) + '">' +
            ltr(c.code) + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg></button>' +
          '<span class="badge ' + STATUS_TONE[st] + '">' + t('cpn_st_' + st) + '</span>' +
        '</div>' +
        (c.note && !c.batchId ? '<div class="cpn-note" dir="auto">' + esc(c.note) + '</div>' : '') +
        (c.batchId ? '<div class="cpn-note"><span class="badge neutral">' + ltr('#' + (c.batchNo || '')) + '</span></div>' : '') +
        '<div class="cpn-rules">' + rules.join(' · ') + '</div>' +
        meter + people +
        (given ? '<div class="cpn-given">' + t('cpn_given') + ' ' + given + '</div>' : '') +
        /* 074 — FOUND: how often its page was opened from the QR. */
        '<div class="cpn-used cpq-scans">' + (c.scans
          ? t('cpq_scanned').replace('{n}', ltr(nf(c.scans))).replace('{d}', esc(day(c.firstScanAt)))
          : t('cpq_not_scanned')) + '</div>' +
        '<div class="cpn-acts">' +
          '<span class="cpq-acts-l">' +
          '<button type="button" class="btn btn-sm" data-act="cpn-uses" data-id="' + c.id + '">' + t('cpn_who') + '</button>' +
          '<button type="button" class="btn btn-sm" data-act="cpq-qr" data-id="' + c.id + '" title="' + esc(t('cpq_qr')) + '">' +
            '<svg class="cpq-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg>' +
            '<span>' + t('cpq_qr_short') + '</span></button>' +
          '</span>' +
          '<div class="cpn-more">' +
            '<button type="button" class="btn btn-sm btn-ghost cpn-dots" data-act="cpn-menu" data-id="' + c.id + '" aria-label="' + esc(t('cb_more')) + '">…</button>' +
            (open
              ? '<div class="cpn-menu">' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-edit" data-id="' + c.id + '">' + t('cpn_edit') + '</button>' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-toggle" data-id="' + c.id + '">' +
                    t(c.active ? 'cpn_turn_off' : 'cpn_turn_on') + '</button>' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-copy" data-id="' + c.id + '">' + t('cpn_copy') + '</button>' +
                  '<button type="button" class="cpn-mitem" data-act="cpq-qr" data-id="' + c.id + '">' + t('cpq_qr') + '</button>' +
                '</div>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ------------------------------------------------------- the dialog */

  function blankDraft() {
    return { id: null, code: S.suggest || '', kind: 'percent', percent: '', amount: '', minBasket: '',
             maxUses: '', once: false, starts: '', ends: '', note: '', more: false, err: null, field: null };
  }

  function ymd(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function draftFrom(c) {
    return {
      id: c.id, code: c.code, kind: c.kind,
      percent: c.kind === 'percent' ? String(c.percent) : '',
      amount: c.kind === 'amount' ? (c.amount / 100).toFixed(c.amount % 100 ? 2 : 0) : '',
      minBasket: c.minBasket ? (c.minBasket / 100).toFixed(c.minBasket % 100 ? 2 : 0) : '',
      maxUses: c.maxUses ? String(c.maxUses) : '', once: !!c.oncePerCustomer,
      starts: ymd(c.startsAt), ends: ymd(c.expiresAt), note: c.note || '',
      more: !!(c.minBasket || c.maxUses || c.oncePerCustomer || c.startsAt || c.expiresAt || c.note),
      err: null, field: null, used: c.uses > 0
    };
  }

  /* The boxes hold what was typed; this reads them into the draft before any
     repaint, so a repaint never takes a half-typed value away. */
  function readDraft() {
    var D = S.draft;
    if (!D) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    var v;
    if ((v = g('cpnCode')) !== null) D.code = v;
    if ((v = g('cpnPercent')) !== null) D.percent = v;
    if ((v = g('cpnAmount')) !== null) D.amount = v;
    if ((v = g('cpnMin')) !== null) D.minBasket = v;
    if ((v = g('cpnMax')) !== null) D.maxUses = v;
    if ((v = g('cpnStarts')) !== null) D.starts = v;
    if ((v = g('cpnEnds')) !== null) D.ends = v;
    if ((v = g('cpnNote')) !== null) D.note = v;
    var once = document.getElementById('cpnOnce');
    if (once) D.once = once.checked;
  }

  function fieldErr(name) {
    var D = S.draft;
    return D && D.err && D.field === name ? '<div class="cpn-err">' + esc(D.err) + '</div>' : '';
  }

  function dialogBody() {
    var D = S.draft;
    var h = '<div class="cpn-dlg">';
    h += '<label class="field"><span>' + t('cpn_code') + '</span>' +
      '<div class="cpn-code-row"><input class="inp cpn-code-in" id="cpnCode" dir="ltr" maxlength="24" autocomplete="off" ' +
        'autocapitalize="characters" value="' + esc(D.code) + '" data-change="cpn-live"' + (D.used ? ' disabled' : '') + '>' +
      (D.id ? '' : '<button type="button" class="btn btn-ghost cpn-dice" data-act="cpn-suggest" title="' + esc(t('cpn_suggest')) + '" aria-label="' + esc(t('cpn_suggest')) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg></button>') +
      '</div>' + (D.used ? '<small class="muted">' + t('cpn_code_locked') + '</small>' : '') + fieldErr('code') + '</label>';

    h += '<div class="cpn-kinds">' +
      '<button type="button" class="cpn-kind' + (D.kind === 'percent' ? ' on' : '') + '" data-act="cpn-kind" data-k="percent">' +
        '<b>%</b><span>' + t('cpn_k_percent') + '</span></button>' +
      '<button type="button" class="cpn-kind' + (D.kind === 'amount' ? ' on' : '') + '" data-act="cpn-kind" data-k="amount">' +
        '<b>$</b><span>' + t('cpn_k_amount') + '</span></button>' +
    '</div>';

    h += D.kind === 'percent'
      ? '<label class="field cb-big"><span>' + t('cpn_percent') + '</span>' +
          '<input class="inp num cb-big-in" id="cpnPercent" type="text" inputmode="numeric" dir="ltr" placeholder="10" value="' + esc(D.percent) + '" data-change="cpn-live">' +
          fieldErr('percent') + '</label>'
      : '<label class="field cb-big"><span>' + t('cpn_amount') + '</span>' +
          '<input class="inp num cb-big-in" id="cpnAmount" type="text" inputmode="decimal" dir="ltr" placeholder="5" value="' + esc(D.amount) + '" data-change="cpn-live">' +
          '<small class="pr-lira muted" id="cpnAmountLira">' + (typeof liraHint === 'function' ? liraHint(Desk.toMinor(D.amount, 'USD')) : '') + '</small>' +
          fieldErr('amount') + '</label>';

    h += '<div class="wh-fold"><button class="wh-more-h" type="button" data-act="cpn-more">' +
      t('cpn_limits') + '<span class="wh-more-x">' + (D.more ? '−' : '+') + '</span></button>' +
      '<div class="wh-fold-b"' + (D.more ? '' : ' hidden') + '>' +
        '<div class="row2">' +
          '<label class="field"><span>' + t('cpn_min') + '</span><input class="inp num" id="cpnMin" type="text" inputmode="decimal" dir="ltr" placeholder="—" value="' + esc(D.minBasket) + '" data-change="cpn-live">' + fieldErr('minBasket') + '</label>' +
          '<label class="field"><span>' + t('cpn_max') + '</span><input class="inp num" id="cpnMax" type="text" inputmode="numeric" dir="ltr" placeholder="∞" value="' + esc(D.maxUses) + '" data-change="cpn-live">' + fieldErr('maxUses') + '</label>' +
        '</div>' +
        '<div class="row2">' +
          '<label class="field"><span>' + t('cpn_starts') + '</span><input class="inp" id="cpnStarts" type="date" value="' + esc(D.starts) + '" data-change="cpn-live">' + fieldErr('startsAt') + '</label>' +
          '<label class="field"><span>' + t('cpn_ends') + '</span><input class="inp" id="cpnEnds" type="date" value="' + esc(D.ends) + '" data-change="cpn-live">' + fieldErr('expiresAt') + '</label>' +
        '</div>' +
        '<div class="rule-row"><div class="rr-txt"><b>' + t('cpn_once') + '</b><small>' + t('cpn_once_sub') + '</small></div>' +
          '<label class="switch"><input type="checkbox" id="cpnOnce"' + (D.once ? ' checked' : '') + ' data-change="cpn-live"><i></i></label></div>' +
        '<label class="field"><span>' + t('cpn_note') + '</span><input class="inp" id="cpnNote" dir="auto" maxlength="80" placeholder="' + esc(t('cpn_note_ph')) + '" value="' + esc(D.note) + '" data-change="cpn-live"></label>' +
      '</div></div>';

    h += '<div class="cb-result cpn-sentence" id="cpnSentence">' + sentence() + '</div>';
    h += (D.err && !D.field ? '<div class="cpn-err">' + esc(D.err) + '</div>' : '');
    return h + '</div>';
  }

  /* What will be true afterwards, in one sentence. */
  function sentence() {
    var D = S.draft;
    var code = String(D.code || '').replace(/\s+/g, '').toUpperCase() || '—';
    var val = D.kind === 'percent'
      ? (Desk.toCount(D.percent) > 0 ? Desk.toCount(D.percent) + '%' : '')
      : (Desk.toMinor(D.amount, 'USD') > 0 ? usd(Desk.toMinor(D.amount, 'USD')) : '');
    if (!val) return '<span class="muted">' + t('cpn_say_empty') + '</span>';
    var s = t('cpn_say').replace('{code}', ltr(code)).replace('{v}', ltr(val));
    var bits = [];
    var min = Desk.toMinor(D.minBasket, 'USD');
    if (min > 0) bits.push(t('cpn_r_min').replace('{n}', ltr(usd(min))));
    if (D.once) bits.push(t('cpn_r_once'));
    var max = Desk.toCount(D.maxUses);
    if (max > 0) bits.push(t('cpn_say_max').replace('{n}', ltr(nf(max))));
    if (D.ends) bits.push(t('cpn_r_ends').replace('{d}', esc(fmtDate(new Date(D.ends + 'T12:00:00')))));
    return s + (bits.length ? ' · ' + bits.join(' · ') : '');
  }

  function openDialog() {
    var D = S.draft;
    openModal({
      title: D.id ? t('cpn_edit') + ' · ' + ltr(D.code) : t('cpn_new'),
      body: '<div id="cpnDlg">' + dialogBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="cpn-save">' + t('save') + '</button>',
      onOpen: function () {
        if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
          var el = document.getElementById(D.kind === 'percent' ? 'cpnPercent' : 'cpnAmount');
          if (el) { try { el.focus(); } catch (e) {} }
        }
      },
      onClose: function () { S.draft = null; S.saving = false; }
    });
  }

  function repaintDialog() {
    readDraft();
    var host = document.getElementById('cpnDlg');
    if (!host) return;
    var key = typeof focusKey === 'function' ? focusKey(host) : null;
    host.innerHTML = dialogBody();
    if (typeof hintInputs === 'function') hintInputs(host);
    if (key && typeof refocus === 'function') refocus(host, key);
  }

  /* The body the server wants, from the draft. Dates are the shop's LOCAL
     day: from its first moment, to its last. */
  function payload() {
    var D = S.draft;
    var startIso = D.starts ? new Date(D.starts + 'T00:00:00').toISOString() : null;
    var endIso = D.ends ? new Date(D.ends + 'T23:59:59.999').toISOString() : null;
    var body = {
      code: String(D.code || '').replace(/\s+/g, '').toUpperCase(),
      kind: D.kind,
      minBasket: Desk.toMinor(D.minBasket, 'USD') > 0 ? Desk.toMinor(D.minBasket, 'USD') : null,
      maxUses: Desk.toCount(D.maxUses) > 0 ? Desk.toCount(D.maxUses) : null,
      oncePerCustomer: !!D.once,
      startsAt: startIso, expiresAt: endIso,
      note: String(D.note || '').trim() || null
    };
    if (D.kind === 'percent') body.percent = Desk.toCount(D.percent);
    else body.amount = Desk.toMinor(D.amount, 'USD');
    if (D.id && D.used) delete body.code;
    return body;
  }

  function save(btn) {
    if (!S.draft || S.saving) return;
    readDraft();
    var D = S.draft;
    var body = payload();
    /* Refused under the field that causes it, before anything is sent. */
    D.err = null; D.field = null;
    if (!D.id || !D.used) {
      if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(body.code || '')) { D.err = t('err_coupon_bad_code'); D.field = 'code'; }
    }
    if (!D.err && body.kind === 'percent' && !(body.percent >= 1 && body.percent <= 100)) { D.err = t('err_coupon_bad_percent'); D.field = 'percent'; }
    if (!D.err && body.kind === 'amount' && !(body.amount > 0)) { D.err = t('err_coupon_bad_amount'); D.field = 'amount'; }
    if (!D.err && body.startsAt && body.expiresAt && body.expiresAt <= body.startsAt) { D.err = t('err_coupon_bad_dates'); D.field = 'expiresAt'; D.more = true; }
    if (D.err) { repaintDialog(); return; }

    S.saving = true;
    if (btn) btn.disabled = true;
    var req = D.id ? API.patch('/api/coupons/' + D.id, body) : API.post('/api/coupons', body);
    req.then(function (r) {
      S.saving = false;
      var c = r.coupon;
      S.draft = null;
      closeModal();
      toast(t('cpn_title'), (D.id ? t('cpn_saved') : t('cpn_made')).replace('{code}', c.code), 'ok', 3000);
      S.at = 0;
      load();
    }).catch(function (err) {
      S.saving = false;
      if (btn) btn.disabled = false;
      if (!S.draft) return;
      S.draft.err = err && err.code === 'no_server' || (err && err.status === 0)
        ? t('cpn_not_saved') : API.friendly(err);
      S.draft.field = err && err.detail && err.detail.field || null;
      if (S.draft.field && S.draft.field !== 'code' && S.draft.field !== 'percent' && S.draft.field !== 'amount') S.draft.more = true;
      repaintDialog();
    });
  }

  /* --------------------------------------------------- who used it */

  function openUses(id) {
    var c = find(id);
    openDrawer({
      head: '<div><span class="eyebrow">' + t('cpn_who') + '</span><h3 style="margin:3px 0 0">' + ltr(c ? c.code : '') + '</h3></div>',
      body: '<div id="cpnUses"><div class="cpn-skel"></div><span class="sr-only" role="status">' + t('cpn_loading') + '</span></div>'
    });
    API.get('/api/coupons/' + id).then(function (r) {
      var host = document.getElementById('cpnUses');
      if (!host) return;
      host.innerHTML = usesHtml(r);
    }).catch(function (err) {
      var host = document.getElementById('cpnUses');
      if (host) host.innerHTML = '<div class="cart-empty"><b>' + esc(API.friendly(err)) + '</b></div>';
    });
  }

  function usesHtml(r) {
    var c = r.coupon || {};
    var h = '<div class="cpn-sum cpn-sum-sm">' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_uses') + '</span><b>' + ltr(nf(c.uses || 0)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_people') + '</span><b>' + ltr(nf(c.people || 0)) + '</b></div>' +
      '<div class="cpn-fig"><span class="eyebrow">' + t('cpn_s_walkins') + '</span><b>' + ltr(nf(c.walkins || 0)) + '</b></div>' +
    '</div>';
    if (!r.uses || !r.uses.length) {
      return h + '<div class="cart-empty"><b>' + t('cpn_no_uses') + '</b><span>' + t('cpn_no_uses_why') + '</span></div>';
    }
    h += '<div class="cpn-uses">';
    r.uses.forEach(function (u) {
      h += '<div class="cpn-use' + (u.voided ? ' is-void' : '') + '">' +
        '<div class="cpn-use-top"><b dir="auto">' + esc(u.customerName || t('walk_in')) + '</b>' +
          '<span>' + cash(u.discount, u.currency, '−') + '</span></div>' +
        '<div class="cpn-use-sub muted">' +
          '<button type="button" class="link" data-act="open-invoice" data-id="' + esc(u.saleId) + '">' + ltr(u.saleId) + '</button>' +
          ' · ' + esc(fmtDateTime(new Date(u.at))) +
          ' · <span class="badge neutral">' + t('cpn_ch_' + (u.channel || 'till')) + '</span>' +
          (u.cashier ? ' · ' + esc(u.cashier) : '') +
          (u.voided ? ' · <span class="warn">' + t('cpn_voided') + '</span>' : '') +
        '</div></div>';
    });
    h += '</div>';
    if (r.capped) h += '<div class="muted small mt">' + t('cpn_capped').replace('{n}', nf(r.shown)).replace('{m}', nf(r.total)) + '</div>';
    return h;
  }

  /* ------------------------------------------- 074 — many codes at once */

  /* A tick is a BUTTON with aria-pressed, never an input: the page repaints
     itself, and a checkbox's own state would argue with S.sel. */
  function tickBtn(act, id, on, label) {
    return '<button type="button" class="cpq-tick' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' + id + '" ' +
      'aria-pressed="' + on + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>';
  }

  function picked() {
    return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number);
  }

  /* Every code the current view shows, batch cards' codes included. */
  function shownIds() {
    var ids = visibleRows().filter(function (c) { return match(c, S.filter); }).map(function (c) { return c.id; });
    if (S.batch === null) {
      S.batches.filter(function (b) { return batchMatch(b, S.filter); }).forEach(function (b) {
        batchFacts(b).codes.forEach(function (c) { ids.push(c.id); });
      });
    }
    return ids;
  }

  function bulkBar() {
    if (!S.selecting) return '';
    var n = picked().length;
    var all = shownIds();
    var allOn = all.length && all.every(function (id) { return S.sel[id]; });
    return '<div class="cpq-bulkbar" role="toolbar" aria-label="' + esc(t('cpq_select')) + '">' +
      '<span class="cpq-bulk-n"><b>' + ltr(nf(n)) + '</b> ' + t('cpq_sel_n') + '</span>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="cpq-sel-all"><span>' + t(allOn ? 'cpq_sel_none' : 'cpq_sel_all') + '</span></button>' +
      '<span class="cpq-bulk-acts">' +
        '<button type="button" class="btn btn-sm" data-act="cpq-bulk" data-a="on"' + (n && !S.bulkBusy ? '' : ' disabled') + '><span>' + t('cpq_bulk_on') + '</span></button>' +
        '<button type="button" class="btn btn-sm" data-act="cpq-bulk" data-a="off"' + (n && !S.bulkBusy ? '' : ' disabled') + '><span>' + t('cpq_bulk_off') + '</span></button>' +
        '<span class="bk-rule" aria-hidden="true"></span>' +
        '<button type="button" class="btn btn-sm bk-danger" data-act="cpq-bulk" data-a="delete"' + (n && !S.bulkBusy ? '' : ' disabled') + '><span>' + t('cpq_bulk_delete') + '</span></button>' +
      '</span>' +
    '</div>';
  }

  function runBulk(action) {
    var ids = picked();
    if (!ids.length || S.bulkBusy) return;
    S.bulkBusy = true;
    paint();
    API.post('/api/coupons/bulk', { action: action, ids: ids }).then(function (r) {
      S.bulkBusy = false;
      S.sel = {};
      S.selecting = false;
      var kept = (r.kept || []).filter(function (k) { return k.reason === 'used'; });
      var word = action === 'delete' ? 'cpq_bulk_deleted' : action === 'on' ? 'cpq_bulk_turned_on' : 'cpq_bulk_turned_off';
      toast(t('cpn_title'), t(word).replace('{n}', (r.done || []).length) +
        (kept.length ? ' · ' + t('cpq_bulk_kept_used').replace('{n}', kept.length) : ''), kept.length ? 'warn' : 'ok', kept.length ? 8000 : 3500);
      S.at = 0;
      load();
    }).catch(function (err) {
      S.bulkBusy = false;
      paint();
      toast(t('cpn_title'), err && err.status === 0 ? t('cpn_not_saved') : API.friendly(err), 'err', 6000);
    });
  }

  function confirmDelete() {
    var ids = picked();
    var used = S.rows.filter(function (c) { return S.sel[c.id] && c.uses > 0; }).length;
    openModal({
      title: t('cpq_bulk_delete_q').replace('{n}', ids.length),
      size: 'narrow',
      body: '<p style="margin:0">' + t('cpq_bulk_delete_body') + '</p>' +
        (used ? '<p class="warn" style="margin:12px 0 0">' + t('cpq_bulk_delete_used').replace('{n}', used) + '</p>' : ''),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn bk-danger" data-act="cpq-bulk-go"><span>' + t('cpq_bulk_delete') + '</span></button>'
    });
  }

  /* ------------------------------------------- 074 — "a coupon was just used" */

  var USED_SEEN = {};
  var CH_WORD = { till: 'cpq_used_till', desk: 'cpq_used_desk', web: 'cpq_used_web' };

  /* The live line says a use happened (ids only). Ask who and where, through
     the gated route, and say it: a toast, a chime, and a system notification
     when the tab is not in front. The page itself catches up if it is open. */
  function used(ids) {
    if (!ids || !ids.length || typeof allow !== 'function' || !allow('coupon.write')) return;
    var fresh = ids.filter(function (id) { return !USED_SEEN[id]; });
    if (!fresh.length) return;
    fresh.forEach(function (id) { USED_SEEN[id] = 1; });
    API.get('/api/coupon-uses/recent?ids=' + fresh.join(',')).then(function (r) {
      var list = (r.uses || []).filter(function (u) { return !u.voided; });
      list.slice(0, 3).forEach(function (u, i) {
        setTimeout(function () {
          toast(t('cpq_used_title').replace('{code}', u.code),
            t(CH_WORD[u.channel] || 'cpq_used_till') + ' · ' + (u.customerName || t('walk_in')) + ' · ' + u.saleId +
            ' · −' + (u.currency === 'USD' ? usd(u.discount) : nf(u.discount) + ' ' + u.currency), 'ok', 8000);
        }, i * 350);
      });
      if (list.length) {
        if (typeof Pulse !== 'undefined' && Pulse.chime) Pulse.chime();
        systemNotify(list[0]);
      }
      if (OG.view === 'coupons') { S.at = 0; load(); }
    }).catch(function () { /* the bell still has it */ });
  }

  function systemNotify(u) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    try {
      var n = new Notification(t('cpq_used_title').replace('{code}', u.code), {
        body: t(CH_WORD[u.channel] || 'cpq_used_till') + ' · ' + (u.customerName || t('walk_in')),
        tag: 'og-coupon-' + u.id, icon: 'assets/icon-192.png', lang: OG.lang
      });
      n.onclick = function () { window.focus(); n.close(); go('coupons'); };
    } catch (e) { /* a browser that refuses is fine */ }
  }

  /* ------------------------------------------- 074 — the QR and the picture */

  function openQr(id) {
    var c = find(id);
    if (!c) return;
    var url = pageUrl(c);
    openModal({
      title: t('cpq_share_title').replace('{code}', ltr(c.code)),
      size: 'wide',
      body: '<div class="cpq-share">' +
        '<div class="cpq-pic" id="cpqPic"><div class="cpn-skel"></div>' +
          '<span class="sr-only" role="status">' + t('cpq_drawing') + '</span></div>' +
        '<div class="cpq-side">' +
          '<div class="field"><span>' + t('cpq_link') + '</span>' +
            '<div class="cpq-link"><bdi dir="ltr">' + esc(url) + '</bdi></div></div>' +
          '<div class="cpq-btns">' +
            '<button type="button" class="btn btn-primary" data-act="cpq-download" data-id="' + c.id + '">' + t('cpq_download') + '</button>' +
            '<button type="button" class="btn" data-act="cpq-copy-link" data-id="' + c.id + '">' + t('cpq_copy_link') + '</button>' +
            /* ?preview: the shop looking at its own page is not a sticker found. */
            '<a class="btn" href="' + esc(url) + '?preview=1" target="_blank" rel="noopener">' + t('cpq_open') + '</a>' +
          '</div>' +
          '<p class="muted small">' + t('cpq_till') + '</p>' +
          '<div class="cpq-digits"><span class="eyebrow">' + t('cpq_digits') + '</span> ' + ltr(c.scanToken || '') + '</div>' +
        '</div></div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>'
    });
    if (typeof CouponCard === 'undefined') return drawFailed();
    CouponCard.draw(cardInfo(c)).then(function (cv) {
      var host = document.getElementById('cpqPic');
      if (host) host.innerHTML = '<img src="' + cv.toDataURL('image/png') + '" alt="' + esc(c.code) + '">';
    }).catch(drawFailed);
  }

  function drawFailed() {
    var host = document.getElementById('cpqPic');
    if (host) host.innerHTML = '<div class="cart-empty"><b>' + t('cpq_draw_fail') + '</b></div>';
  }

  function downloadPicture(c, btn) {
    if (btn) btn.disabled = true;
    CouponCard.blob(cardInfo(c)).then(function (b) {
      CouponCard.download(CouponCard.fileName(c), b);
    }).catch(function () {
      toast(t('cpn_title'), t('cpq_draw_fail'), 'err', 5000);
    }).then(function () { if (btn) btn.disabled = false; });
  }

  function copyText(text, said) {
    try {
      navigator.clipboard.writeText(text).then(function () {
        toast(t('cpn_title'), said, 'ok', 1800);
      }, function () { toast(t('cpn_title'), text, 'ok', 6000); });
    } catch (e) { toast(t('cpn_title'), text, 'ok', 6000); }
  }

  /* Every sticker of a batch in one zip, drawn one at a time — thirty
     canvases at once is how a phone runs out of memory. */
  function zipBatch(id) {
    if (S.zipping || typeof CouponCard === 'undefined' || typeof Export === 'undefined') return;
    var b = S.batches.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var codes = batchFacts(b).codes.slice().sort(function (x, y) { return (x.batchNo || 0) - (y.batchNo || 0); });
    if (!codes.length) return;
    S.zipping = true;
    var entries = [], i = 0;
    function say(text) {
      document.querySelectorAll('[data-act="cpq-batch-zip"][data-id="' + id + '"]').forEach(function (el) {
        el.disabled = !!text;
        el.innerHTML = '<span>' + (text || t('cpq_b_zip')) + '</span>';
      });
    }
    function done(ok) {
      S.zipping = false;
      say(null);
      if (!ok) { toast(t('cpn_title'), t('cpq_draw_fail'), 'err', 6000); return; }
      var slug = String(b.name || 'batch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'batch-' + b.id;
      var z = Export.zip(entries);
      Export.download('og-street-' + slug + '.zip', new Blob([z], { type: 'application/zip' }));
      toast(t('cpn_title'), t('cpq_b_zipped').replace('{n}', entries.length), 'ok', 3500);
    }
    function step() {
      if (i >= codes.length) return done(true);
      var c = codes[i];
      say(t('cpq_b_zipping').replace('{i}', i + 1).replace('{n}', codes.length));
      CouponCard.blob(cardInfo(c)).then(function (bl) { return bl.arrayBuffer(); }).then(function (ab) {
        entries.push({ name: String(c.batchNo || i + 1).padStart(3, '0') + '-' + c.code + '.png', data: new Uint8Array(ab) });
        i++;
        step();
      }).catch(function () { done(false); });
    }
    step();
  }

  /* ------------------------------------------- 074 — the street batch dialog */

  function blankBatch() {
    return { name: '', count: '20', prefix: 'OG', kind: 'percent', percent: '', amount: '',
             minBasket: '', ends: '', err: null, field: null };
  }

  function readBatch() {
    var D = S.bdraft;
    if (!D) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    var v;
    if ((v = g('cpqName')) !== null) D.name = v;
    if ((v = g('cpqCount')) !== null) D.count = v;
    if ((v = g('cpqPrefix')) !== null) D.prefix = v;
    if ((v = g('cpqPercent')) !== null) D.percent = v;
    if ((v = g('cpqAmount')) !== null) D.amount = v;
    if ((v = g('cpqMin')) !== null) D.minBasket = v;
    if ((v = g('cpqEnds')) !== null) D.ends = v;
  }

  function bErr(name) {
    var D = S.bdraft;
    return D && D.err && D.field === name ? '<div class="cpn-err">' + esc(D.err) + '</div>' : '';
  }

  function batchBody() {
    var D = S.bdraft;
    return '<div class="cpn-dlg">' +
      '<p class="muted" style="margin:0">' + t('cpq_b_sub') + '</p>' +
      '<label class="field"><span>' + t('cpq_b_name') + '</span>' +
        '<input class="inp" id="cpqName" dir="auto" maxlength="60" placeholder="' + esc(t('cpq_b_name_ph')) + '" value="' + esc(D.name) + '" data-change="cpq-b-live">' + bErr('name') + '</label>' +
      '<div class="row2">' +
        '<label class="field"><span>' + t('cpq_b_count') + '</span>' +
          '<input class="inp num" id="cpqCount" type="text" inputmode="numeric" dir="ltr" value="' + esc(D.count) + '" data-change="cpq-b-live">' + bErr('count') + '</label>' +
        '<label class="field"><span>' + t('cpq_b_prefix') + '</span>' +
          '<input class="inp cpn-code-in" id="cpqPrefix" dir="ltr" maxlength="10" autocapitalize="characters" value="' + esc(D.prefix) + '" data-change="cpq-b-live">' + bErr('prefix') + '</label>' +
      '</div>' +
      '<div class="cpn-kinds">' +
        '<button type="button" class="cpn-kind' + (D.kind === 'percent' ? ' on' : '') + '" data-act="cpq-b-kind" data-k="percent">' +
          '<b>%</b><span>' + t('cpn_k_percent') + '</span></button>' +
        '<button type="button" class="cpn-kind' + (D.kind === 'amount' ? ' on' : '') + '" data-act="cpq-b-kind" data-k="amount">' +
          '<b>$</b><span>' + t('cpn_k_amount') + '</span></button>' +
      '</div>' +
      (D.kind === 'percent'
        ? '<label class="field cb-big"><span>' + t('cpn_percent') + '</span>' +
            '<input class="inp num cb-big-in" id="cpqPercent" type="text" inputmode="numeric" dir="ltr" placeholder="10" value="' + esc(D.percent) + '" data-change="cpq-b-live">' + bErr('percent') + '</label>'
        : '<label class="field cb-big"><span>' + t('cpn_amount') + '</span>' +
            '<input class="inp num cb-big-in" id="cpqAmount" type="text" inputmode="decimal" dir="ltr" placeholder="5" value="' + esc(D.amount) + '" data-change="cpq-b-live">' + bErr('amount') + '</label>') +
      '<div class="row2">' +
        '<label class="field"><span>' + t('cpn_min') + '</span><input class="inp num" id="cpqMin" type="text" inputmode="decimal" dir="ltr" placeholder="—" value="' + esc(D.minBasket) + '" data-change="cpq-b-live">' + bErr('minBasket') + '</label>' +
        '<label class="field"><span>' + t('cpn_ends') + '</span><input class="inp" id="cpqEnds" type="date" value="' + esc(D.ends) + '" data-change="cpq-b-live">' + bErr('expiresAt') + '</label>' +
      '</div>' +
      '<div class="cb-result cpn-sentence" id="cpqSentence">' + batchSentence() + '</div>' +
      (D.err && !D.field ? '<div class="cpn-err">' + esc(D.err) + '</div>' : '') +
    '</div>';
  }

  function batchPrefix(D) {
    return String(D.prefix || '').replace(/[\s-]+/g, '').toUpperCase() || 'OG';
  }

  function batchSentence() {
    var D = S.bdraft;
    var val = D.kind === 'percent'
      ? (Desk.toCount(D.percent) > 0 ? Desk.toCount(D.percent) + '%' : '')
      : (Desk.toMinor(D.amount, 'USD') > 0 ? usd(Desk.toMinor(D.amount, 'USD')) : '');
    if (!val) return '<span class="muted">' + t('cpq_b_say_empty') + '</span>';
    var n = Desk.toCount(D.count) || 0;
    return t('cpq_b_say').replace('{n}', ltr(nf(n))).replace('{code}', ltr(batchPrefix(D) + '-7K2QX')).replace('{v}', ltr(val));
  }

  function openBatch() {
    S.bdraft = blankBatch();
    openModal({
      title: t('cpq_b_title'),
      body: '<div id="cpqDlg">' + batchBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="cpq-b-save">' + t('cpq_b_make') + '</button>',
      onOpen: function () {
        if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
          var el = document.getElementById('cpqName');
          if (el) { try { el.focus(); } catch (e) {} }
        }
      },
      onClose: function () { S.bdraft = null; }
    });
  }

  function repaintBatch() {
    readBatch();
    var host = document.getElementById('cpqDlg');
    if (!host) return;
    var key = typeof focusKey === 'function' ? focusKey(host) : null;
    host.innerHTML = batchBody();
    if (typeof hintInputs === 'function') hintInputs(host);
    if (key && typeof refocus === 'function') refocus(host, key);
  }

  function saveBatch(btn) {
    if (!S.bdraft || S.saving) return;
    readBatch();
    var D = S.bdraft;
    D.err = null; D.field = null;
    var count = Desk.toCount(D.count);
    var body = {
      name: String(D.name || '').trim(), count: count, prefix: batchPrefix(D), kind: D.kind,
      minBasket: Desk.toMinor(D.minBasket, 'USD') > 0 ? Desk.toMinor(D.minBasket, 'USD') : null,
      expiresAt: D.ends ? new Date(D.ends + 'T23:59:59.999').toISOString() : null
    };
    if (D.kind === 'percent') body.percent = Desk.toCount(D.percent);
    else body.amount = Desk.toMinor(D.amount, 'USD');
    if (!body.name) { D.err = t('err_coupon_batch_name'); D.field = 'name'; }
    else if (!(count >= 1 && count <= S.batchMax)) { D.err = t('err_coupon_batch_count'); D.field = 'count'; }
    else if (!/^[A-Z0-9]{2,10}$/.test(body.prefix)) { D.err = t('err_coupon_batch_prefix'); D.field = 'prefix'; }
    else if (D.kind === 'percent' && !(body.percent >= 1 && body.percent <= 100)) { D.err = t('err_coupon_bad_percent'); D.field = 'percent'; }
    else if (D.kind === 'amount' && !(body.amount > 0)) { D.err = t('err_coupon_bad_amount'); D.field = 'amount'; }
    if (D.err) { repaintBatch(); return; }

    S.saving = true;
    if (btn) btn.disabled = true;
    API.post('/api/coupons/batch', body).then(function (r) {
      S.saving = false;
      S.bdraft = null;
      closeModal();
      toast(t('cpn_title'), t('cpq_b_made').replace('{n}', r.codes.length).replace('{name}', r.batch.name), 'ok', 3500);
      S.batch = r.batch.id;
      S.filter = 'all';
      S.at = 0;
      load();
    }).catch(function (err) {
      S.saving = false;
      if (btn) btn.disabled = false;
      if (!S.bdraft) return;
      S.bdraft.err = (err && err.status === 0) ? t('cpn_not_saved') : API.friendly(err);
      S.bdraft.field = err && err.detail && err.detail.field || null;
      repaintBatch();
    });
  }

  /* ------------------------------------------------------------- actions */

  function closeMenu() {
    if (S.menu === null) return;
    S.menu = null;
    paint();
  }

  function copy(code) {
    try {
      navigator.clipboard.writeText(code).then(function () {
        toast(t('cpn_title'), t('cpn_copied').replace('{code}', code), 'ok', 1800);
      }, function () { toast(t('cpn_title'), code, 'ok', 4000); });
    } catch (e) { toast(t('cpn_title'), code, 'ok', 4000); }
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['cpn-reload'] = function () { S.failed = null; S.loaded = false; paint(); load(); };
    ACTIONS['cpn-filter'] = function (el) { S.filter = el.getAttribute('data-k') || 'all'; S.menu = null; paint(); };
    ACTIONS['cpn-new'] = function () { S.menu = null; S.draft = blankDraft(); paint(); openDialog(); };
    ACTIONS['cpn-edit'] = function (el) {
      var c = find(+el.getAttribute('data-id'));
      S.menu = null; paint();
      if (!c) return;
      S.draft = draftFrom(c);
      openDialog();
    };
    ACTIONS['cpn-menu'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.menu = S.menu === id ? null : id;
      paint();
    };
    ACTIONS['cpn-toggle'] = function (el) {
      var c = find(+el.getAttribute('data-id'));
      S.menu = null;
      if (!c) { paint(); return; }
      el.disabled = true;
      API.patch('/api/coupons/' + c.id, { active: !c.active }).then(function (r) {
        toast(t('cpn_title'), t(r.coupon.active ? 'cpn_now_on' : 'cpn_now_off').replace('{code}', r.coupon.code), 'ok', 3000);
        load();
      }).catch(function (err) {
        toast(t('cpn_title'), API.friendly(err), 'err', 6000);
        paint();
      });
    };
    ACTIONS['cpn-copy'] = function (el) {
      var c = find(+el.getAttribute('data-id'));
      if (S.menu !== null) { S.menu = null; paint(); }
      if (c) copy(c.code);
    };
    ACTIONS['cpn-uses'] = function (el) { S.menu = null; paint(); openUses(+el.getAttribute('data-id')); };
    ACTIONS['cpn-kind'] = function (el) {
      if (!S.draft) return;
      readDraft();
      S.draft.kind = el.getAttribute('data-k') === 'amount' ? 'amount' : 'percent';
      S.draft.err = null; S.draft.field = null;
      repaintDialog();
    };
    ACTIONS['cpn-more'] = function () {
      if (!S.draft) return;
      readDraft();
      S.draft.more = !S.draft.more;
      repaintDialog();
    };
    ACTIONS['cpn-suggest'] = function (el) {
      if (!S.draft) return;
      el.disabled = true;
      API.get('/api/coupons').then(function (r) {
        S.suggest = r.suggest || S.suggest;
        if (!S.draft) return;
        readDraft();
        S.draft.code = S.suggest;
        repaintDialog();
      }).catch(function () { el.disabled = false; });
    };
    ACTIONS['cpn-save'] = function (el) { save(el); };

    /* 074 — the QR, the picture and the street batches. */
    ACTIONS['cpq-qr'] = function (el) {
      if (S.menu !== null) { S.menu = null; paint(); }
      openQr(+el.getAttribute('data-id'));
    };
    ACTIONS['cpq-download'] = function (el) {
      var c = find(+el.getAttribute('data-id'));
      if (c) downloadPicture(c, el);
    };
    ACTIONS['cpq-copy-link'] = function (el) {
      var c = find(+el.getAttribute('data-id'));
      if (c) copyText(pageUrl(c), t('cpq_link_copied'));
    };
    ACTIONS['cpq-batch-new'] = function () { S.menu = null; paint(); openBatch(); };
    ACTIONS['cpq-batch-open'] = function (el) {
      S.batch = +el.getAttribute('data-id'); S.menu = null; S.filter = 'all'; paint();
      var v = document.getElementById('view'); if (v) v.scrollTop = 0;
    };
    ACTIONS['cpq-batch-back'] = function () { S.batch = null; S.menu = null; paint(); };
    ACTIONS['cpq-batch-zip'] = function (el) { zipBatch(+el.getAttribute('data-id')); };
    ACTIONS['cpq-b-kind'] = function (el) {
      if (!S.bdraft) return;
      readBatch();
      S.bdraft.kind = el.getAttribute('data-k') === 'amount' ? 'amount' : 'percent';
      S.bdraft.err = null; S.bdraft.field = null;
      repaintBatch();
    };
    ACTIONS['cpq-b-save'] = function (el) { saveBatch(el); };

    /* 074 — choosing many codes, and what to do with them. */
    ACTIONS['cpq-select'] = function () {
      S.selecting = !S.selecting;
      if (!S.selecting) S.sel = {};
      S.menu = null;
      paint();
    };
    ACTIONS['cpq-pick'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.sel[id] = !S.sel[id];
      paint();
    };
    ACTIONS['cpq-pick-batch'] = function (el) {
      var b = S.batches.filter(function (x) { return x.id === +el.getAttribute('data-id'); })[0];
      if (!b) return;
      var codes = batchFacts(b).codes;
      var on = !codes.every(function (c) { return S.sel[c.id]; });
      codes.forEach(function (c) { S.sel[c.id] = on; });
      paint();
    };
    ACTIONS['cpq-sel-all'] = function () {
      var ids = shownIds();
      var on = !(ids.length && ids.every(function (id) { return S.sel[id]; }));
      ids.forEach(function (id) { S.sel[id] = on; });
      paint();
    };
    ACTIONS['cpq-bulk'] = function (el) {
      var a = el.getAttribute('data-a');
      if (a === 'delete') { confirmDelete(); return; }
      runBulk(a === 'on' ? 'on' : 'off');
    };
    ACTIONS['cpq-bulk-go'] = function () { closeModal(); runBulk('delete'); };

    if (typeof CHANGES !== 'undefined') {
      /* The sentence and the lira line only — never the box being typed in. */
      CHANGES['cpn-live'] = function (el) {
        if (!S.draft) return;
        readDraft();
        var s = document.getElementById('cpnSentence');
        if (s) s.innerHTML = sentence();
        if (el && el.id === 'cpnAmount') {
          var l = document.getElementById('cpnAmountLira');
          if (l && typeof liraHint === 'function') l.innerHTML = liraHint(Desk.toMinor(el.value, 'USD'));
        }
      };
      CHANGES['cpq-b-live'] = function () {
        if (!S.bdraft) return;
        readBatch();
        var s = document.getElementById('cpqSentence');
        if (s) s.innerHTML = batchSentence();
      };
    }

    /* The "…" closes on a press anywhere else — in the capture phase, before
       the dispatcher decides what the press meant (the board's rule). */
    document.addEventListener('click', function (e) {
      if (S.menu === null) return;
      if (e.target.closest && e.target.closest('.cpn-more')) return;
      closeMenu();
    }, true);
  }

  return { view: view, after: after, register: register, load: load, used: used };
})();
