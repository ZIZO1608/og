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
    saving: false
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
      '<div class="head-actions"><button class="btn btn-primary" data-act="cpn-new">+ ' + t('cpn_new') + '</button></div></div>';

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

    return head + summary() + filters() + list();
  }

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
      var n = S.rows.filter(function (c) { return match(c, k); }).length;
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
    var rows = S.rows.filter(function (c) { return match(c, S.filter); });
    if (!rows.length) {
      return '<div class="card"><div class="cart-empty"><b>' + t('cpn_none_here') + '</b></div></div>';
    }
    return '<div class="cpn-grid">' + rows.map(ticket).join('') + '</div>';
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
    return '<article class="cpn-tk' + (st === 'live' || st === 'soon' ? '' : ' is-stopped') + (open ? ' has-menu' : '') + '">' +
      '<div class="cpn-stub"><b>' + ltr(worth(c)) + '</b><span>' + t('cpn_off') + '</span></div>' +
      '<div class="cpn-main">' +
        '<div class="cpn-top">' +
          '<button type="button" class="cpn-code" data-act="cpn-copy" data-id="' + c.id + '" title="' + esc(t('cpn_copy')) + '">' +
            ltr(c.code) + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg></button>' +
          '<span class="badge ' + STATUS_TONE[st] + '">' + t('cpn_st_' + st) + '</span>' +
        '</div>' +
        (c.note ? '<div class="cpn-note" dir="auto">' + esc(c.note) + '</div>' : '') +
        '<div class="cpn-rules">' + rules.join(' · ') + '</div>' +
        meter + people +
        (given ? '<div class="cpn-given">' + t('cpn_given') + ' ' + given + '</div>' : '') +
        '<div class="cpn-acts">' +
          '<button type="button" class="btn btn-sm" data-act="cpn-uses" data-id="' + c.id + '">' + t('cpn_who') + '</button>' +
          '<div class="cpn-more">' +
            '<button type="button" class="btn btn-sm btn-ghost cpn-dots" data-act="cpn-menu" data-id="' + c.id + '" aria-label="' + esc(t('cb_more')) + '">…</button>' +
            (open
              ? '<div class="cpn-menu">' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-edit" data-id="' + c.id + '">' + t('cpn_edit') + '</button>' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-toggle" data-id="' + c.id + '">' +
                    t(c.active ? 'cpn_turn_off' : 'cpn_turn_on') + '</button>' +
                  '<button type="button" class="cpn-mitem" data-act="cpn-copy" data-id="' + c.id + '">' + t('cpn_copy') + '</button>' +
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
    }

    /* The "…" closes on a press anywhere else — in the capture phase, before
       the dispatcher decides what the press meant (the board's rule). */
    document.addEventListener('click', function (e) {
      if (S.menu === null) return;
      if (e.target.closest && e.target.closest('.cpn-more')) return;
      closeMenu();
    }, true);
  }

  return { view: view, after: after, register: register, load: load };
})();
