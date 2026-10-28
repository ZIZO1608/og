/* ==========================================================================
   OG SYSTEM — the deposit (عربون) at the till (migration 078, night shift
   28 Oct 2026)
   --------------------------------------------------------------------------
   Global `Reserve`, clicks on `data-rv`, one document listener. The server
   half is server/lib/reserve.js and it decides; this file draws.

   A reservation is a pickup order paid by deposit: the pieces leave stock
   with the sale (held for the customer), the deposit is an order payment
   (cash into the drawer), and the rest is taken when the customer comes back
   with the slip. Never collected: the manager releases it — the deposit
   becomes store credit and the pieces go back on sale.

     - the till's foot: "Reserve with a deposit" and "Reservations · N";
     - the reserve dialog: the customer, the total, the least deposit
       (deposit.till_pct), how it is paid, held until; an agreed smaller
       deposit only for discount.unlimited (owner, manager);
     - a reservation's dialog: collect (take the rest), extend, release as
       store credit (void) or as a refund (void + money.move);
     - a scanned slip (its invoice number) opens it, from any screen;
     - Settings → Money and prices → Deposit.
   Every write has an opId minted when its dialog opened, and its button goes
   busy at once (busyButton). Nothing here calls render() under the till.
   ========================================================================== */
var Reserve = (function () {
  'use strict';

  var HELD = [];          /* the held reservations, for the scan and the count */
  var loadedAt = 0, loading = false;
  var D = null;           /* the dialog's state */

  function can(p) { return typeof allow === 'function' && allow(p); }
  function amt(cur, v) { return typeof moneyIn === 'function' ? moneyIn(cur, v) : '<bdi dir="ltr">' + nf(v) + ' ' + cur + '</bdi>'; }
  function op(tag) { return 'rv-' + tag + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function day(iso) { return '<span dir="auto">' + fmtDate(new Date(iso)) + '</span>'; }

  function methods() {
    var list = (DB.payMethodList || []).filter(function (m) {
      return m && m.active !== false && m.desk && m.id !== 'order' && m.id !== 'credit';
    });
    if (!list.length) list = [{ id: 'cash', en: 'Cash', ar: 'كاش' }];
    return list;
  }
  function mLabel(m) { return OG.lang === 'ar' ? (m.ar || m.en || m.id) : (m.en || m.id); }
  function chips(sel, attr) {
    return '<div class="chip-row rv-methods">' + methods().map(function (m) {
      return '<button type="button" class="chip' + (m.id === sel ? ' on' : '') + '" aria-pressed="' + (m.id === sel) + '" data-rv="' + attr + '" data-m="' + esc(m.id) + '">' + esc(mLabel(m)) + '</button>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------- the held list */
  function load(force) {
    if (loading || !(can('sell') || can('void') || can('delivery.desk'))) return Promise.resolve(HELD);
    if (!force && Date.now() - loadedAt < 30000) return Promise.resolve(HELD);
    loading = true;
    return API.get('/api/reservations').then(function (r) {
      HELD = r.reservations || []; loadedAt = Date.now(); loading = false;
      var b = document.querySelector('[data-rv="list"] .rv-n');
      if (b) b.textContent = HELD.length ? String(HELD.length) : '';
      return HELD;
    }).catch(function () { loading = false; return HELD; });
  }
  /* A scanned slip: its invoice number — the digits survive any keyboard
     layout (js/wedge.js reads e.key). Only a reservation still held. */
  function byScan(code) {
    var c = String(code || '').trim().toUpperCase();
    var dig = (c.match(/^\D{0,4}-?(\d{3,})$/) || [])[1];
    for (var i = 0; i < HELD.length; i++) {
      var id = HELD[i].saleId;
      if (id === c || (dig && id.replace(/\D/g, '') === dig)) return id;
    }
    return null;
  }

  /* ----------------------------------------------------- the till's foot */
  function tillButtons(n) {
    if (!can('sell')) return '';
    if (!HELD.length && !loadedAt) setTimeout(function () { load(); }, 0);
    return '<div class="rv-till">' +
      '<button class="btn" data-rv="new"' + (n ? '' : ' disabled') + '>' + t('rs_reserve') + '</button>' +
      '<button class="btn btn-ghost" data-rv="list">' + t('rs_list') + ' <span class="badge neutral rv-n">' + (HELD.length || '') + '</span></button>' +
    '</div>';
  }

  /* ---------------------------------------------------- the reserve dialog */
  function openNew() {
    if (typeof POS === 'undefined') return;
    var S = POS.state, x = POS.totals();
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var pct = Number(CONFIG.DEP_TILL_PCT) || 50;
    var total = x.total + (x.pointsValue || 0) - (x.print || 0);
    D = { kind: 'new', op: op('new'), method: 'cash', total: total, min: Math.ceil(total * pct / 100), pct: pct };
    var until = new Date(Date.now() + (Number(CONFIG.DEP_HOLD_DAYS) || 7) * 86400000);
    var block = !cust ? t('rs_need_customer') : (S.print && S.print.on ? t('rs_no_print') : (S.pointsUsed ? t('rs_no_points') : ''));
    var body = '<div class="rv-sum">' +
        '<div><span class="lbl">' + t('rs_customer') + '</span><b>' + (cust ? esc(cust.name) : '—') + '</b></div>' +
        '<div><span class="lbl">' + t('total') + '</span><b>' + money(total) + '</b></div>' +
        '<div><span class="lbl">' + t('rs_least') + '</span><b class="rv-hero">' + money(D.min) + '</b><small class="muted"> · <bdi dir="ltr">' + pct + '%</bdi></small></div>' +
        '<div><span class="lbl">' + t('rs_until') + '</span><b>' + day(until) + '</b></div>' +
      '</div>';
    if (block) {
      body += '<div class="partner-note note-danger">' + esc(block) + '</div>';
    } else {
      body += '<label class="field"><span>' + t('rs_deposit_now') + ' (' + esc(CONFIG.BASE_CURRENCY || 'SYP') + ')</span>' +
          '<input class="inp num rv-amt" id="rvAmt" type="text" inputmode="decimal" dir="ltr" autocomplete="off" value="' + D.min + '"></label>' +
        '<span class="lbl">' + t('rs_paid_by') + '</span>' + chips(D.method, 'm') +
        (can('discount.unlimited')
          ? '<label class="field mt"><span>' + t('rs_agreed') + '</span>' +
              '<input class="inp num" id="rvAgreed" type="text" inputmode="decimal" dir="ltr" autocomplete="off" placeholder="' + esc(t('rs_agreed_ph')) + '">' +
              '<small class="muted">' + t('rs_agreed_sub') + '</small></label>'
          : '') +
        '<p class="muted small">' + t('rs_new_sub') + '</p>' +
        '<div class="rv-why" id="rvWhy" role="status" aria-live="polite"></div>';
    }
    shutCart();
    openModal({
      title: t('rs_title_new'), size: 'narrow', body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            (block ? '' : '<button class="btn btn-primary" data-rv="save">' + t('rs_take') + '</button>')
    });
  }

  /* On a phone the cart is a sheet above the page; a dialog opened from it
     must not open underneath it. */
  function shutCart() { if (document.body.getAttribute('data-cart') === 'open') document.body.removeAttribute('data-cart'); }

  function why(msg) { var w = document.getElementById('rvWhy'); if (w) w.textContent = msg || ''; }

  function save(el) {
    var S = POS.state, base = CONFIG.BASE_CURRENCY || 'SYP';
    var a = Desk.toMinor((document.getElementById('rvAmt') || {}).value, base);
    if (!(a > 0)) { why(t('rs_err_amount')); return; }
    var agEl = document.getElementById('rvAgreed');
    var agreed = agEl && String(agEl.value).trim() !== '' ? Desk.toMinor(agEl.value, base) : null;
    if (agreed === null && a < D.min) { why(t('rs_err_min').replace('{min}', nf(D.min))); return; }
    var x = POS.totals();
    var unbusy = busyButton(el);
    API.post('/api/reservations', {
      lines: S.cart.map(function (l) { return { sku: l.sku, qty: l.qty }; }),
      whId: S.warehouse, customerId: S.customerId, discount: x.manual,
      couponCode: S.coupon ? S.coupon.code : null,
      deposit: { amount: a, currency: base, method: D.method },
      agreed: agreed, opId: D.op
    }).then(function (r) {
      unbusy();
      closeModal();
      POS.reset();
      load(true);
      toast(t('rs_title_new'), t('rs_done').replace('{id}', r.sale.id).replace('{date}', fmtDate(new Date(r.reservation.holdUntil))), 'ok', 6000);
      if (typeof Receipt !== 'undefined' && Receipt.printSale) Receipt.printSale(r.sale.id);
      if (typeof Shop !== 'undefined' && Shop.reload) Shop.reload();
    }).catch(function (err) {
      unbusy();
      if (err.code === 'deposit_too_small' && err.detail) why(t('rs_err_min').replace('{min}', nf(err.detail.min)));
      else why(API.friendly(err));
    });
  }

  /* --------------------------------------------- one reservation's dialog */
  function open(saleId) {
    API.get('/api/reservations/' + encodeURIComponent(saleId)).then(function (r) {
      var v = r.reservation;
      D = { kind: 'open', r: v, op: op('c'), method: 'cash', releaseHow: null };
      paintOpen(true);
    }).catch(function (err) { toast(t('rs_title'), API.friendly(err), 'err'); });
  }
  function paintOpen(first) {
    var v = D.r;
    var lines = v.lines.map(function (l) {
      return '<li><b dir="auto">' + esc(l.name) + '</b> · <bdi dir="ltr">' + esc(l.size) + '</bdi>' + (l.qty > 1 ? ' × ' + l.qty : '') + '</li>';
    }).join('');
    var st = v.status === 'held' ? (v.expired ? '<span class="badge critical">' + t('rs_expired') + '</span>' : '<span class="badge low">' + t('rs_held') + '</span>')
      : '<span class="badge ' + (v.status === 'collected' ? 'healthy' : 'neutral') + '">' + t('rs_st_' + v.status) + '</span>';
    var body = '<div class="rv-head">' + st + ' <b dir="ltr">' + esc(v.saleId) + '</b></div>' +
      '<div class="rv-sum">' +
        '<div><span class="lbl">' + t('rs_customer') + '</span><b dir="auto">' + esc(v.customer || '—') + '</b>' + (v.phone ? ' <small dir="ltr" class="muted">' + esc(v.phone) + '</small>' : '') + '</div>' +
        '<div><span class="lbl">' + t('rs_until') + '</span><b>' + day(v.holdUntil) + '</b></div>' +
        '<div><span class="lbl">' + t('total') + '</span><b>' + amt(v.currency, v.total) + '</b></div>' +
        '<div><span class="lbl">' + t('rs_paid') + '</span><b>' + amt(v.currency, v.paid) + '</b></div>' +
        '<div><span class="lbl">' + t('rs_left') + '</span><b class="rv-hero">' + amt(v.currency, v.remaining) + '</b></div>' +
      '</div><ul class="rv-lines">' + lines + '</ul>';
    if (v.status === 'held') {
      if (D.releaseHow) {
        body += '<div class="partner-note note-danger">' + t(D.releaseHow === 'refund' ? 'rs_rel_refund_q' : 'rs_rel_credit_q')
          .replace('{amt}', amt(v.currency, v.paid)).replace('{name}', esc(v.customer || '')) + '</div>';
      } else if (v.remaining > 0 && can('sell')) {
        body += '<span class="lbl">' + t('rs_rest_by') + '</span>' + chips(D.method, 'm');
      }
      body += '<div class="rv-why" id="rvWhy" role="status" aria-live="polite"></div>';
    } else if (v.released) {
      body += '<p class="muted">' + t(v.released.how === 'refund' ? 'rs_was_refunded' : 'rs_was_credit') + '</p>';
    }
    var foot = '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>';
    if (v.status === 'held') {
      if (D.releaseHow) {
        foot = '<button class="btn btn-ghost" data-rv="rel-back">' + t('cancel') + '</button>' +
               '<button class="btn bk-danger" data-rv="rel-go">' + t(D.releaseHow === 'refund' ? 'rs_refund' : 'rs_release') + '</button>';
      } else {
        foot += (can('void') ? '<button class="btn btn-ghost" data-rv="rel" data-how="credit">' + t('rs_release') + '</button>' : '') +
          (can('void') && can('money.move') ? '<button class="btn btn-ghost" data-rv="rel" data-how="refund">' + t('rs_refund') + '</button>' : '') +
          (can('sell') ? '<button class="btn" data-rv="extend">' + t('rs_extend').replace('{n}', Number(CONFIG.DEP_HOLD_DAYS) || 7) + '</button>' : '') +
          (can('sell') ? '<button class="btn btn-primary" data-rv="collect">' + (v.remaining > 0 ? t('rs_collect').replace('{amt}', amt(v.currency, v.remaining)) : t('rs_hand_over')) + '</button>' : '');
      }
    }
    if (first) shutCart();
    if (first) openModal({ title: t('rs_title'), size: 'narrow', body: body, foot: foot });
    else {
      var b = document.querySelector('.modal-body'), f = document.querySelector('.modal-foot');
      if (b) b.innerHTML = body;
      if (f) f.innerHTML = foot;
    }
  }

  function after(el, req, done) {
    var unbusy = busyButton(el);
    req.then(function (r) {
      unbusy(); load(true);
      if (typeof Shop !== 'undefined' && Shop.reload) Shop.reload();
      done(r);
    }).catch(function (err) { unbusy(); why(API.friendly(err)); });
  }

  /* ------------------------------------------------------- the list */
  function openList() {
    load(true).then(function (list) {
      var body = list.length ? '<div class="rv-list">' + list.map(function (v) {
        return '<button class="rv-row" data-rv="open" data-id="' + esc(v.saleId) + '">' +
          '<span><b dir="auto">' + esc(v.customer || '—') + '</b><small class="muted"> · <bdi dir="ltr">' + esc(v.saleId) + '</bdi></small></span>' +
          '<span class="rv-row-r">' + (v.expired ? '<span class="badge critical">' + t('rs_expired') + '</span>' : day(v.holdUntil)) +
          ' · ' + amt(v.currency, v.remaining) + '</span></button>';
      }).join('') + '</div>'
        : '<div class="cart-empty"><b>' + t('rs_none') + '</b><span>' + t('rs_none_sub') + '</span></div>';
      shutCart();
      openModal({ title: t('rs_list'), size: 'narrow', body: body,
                  foot: '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>' });
    });
  }

  /* --------------------------------------------------------- events */
  var ACT = {
    new: function () { openNew(); },
    list: function () { openList(); },
    open: function (el) { open(el.getAttribute('data-id')); },
    m: function (el) {
      if (!D) return;
      D.method = el.getAttribute('data-m');
      var row = el.parentNode;
      [].forEach.call(row.querySelectorAll('.chip'), function (c) {
        var on = c === el; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on);
      });
    },
    save: save,
    collect: function (el) {
      var v = D.r;
      after(el, API.post('/api/reservations/' + encodeURIComponent(v.saleId) + '/collect', {
        payment: v.remaining > 0 ? { amount: v.remaining, currency: v.currency, method: D.method } : null, opId: D.op
      }), function (r) {
        closeModal();
        toast(t('rs_title'), t('rs_collected').replace('{id}', v.saleId), 'ok', 5000);
        if (typeof Receipt !== 'undefined' && Receipt.printSale) Receipt.printSale(v.saleId);
      });
    },
    extend: function (el) {
      after(el, API.post('/api/reservations/' + encodeURIComponent(D.r.saleId) + '/extend', {}), function (r) {
        D.r = r.reservation; paintOpen(false);
        toast(t('rs_title'), t('rs_extended').replace('{date}', fmtDate(new Date(D.r.holdUntil))), 'ok');
      });
    },
    rel: function (el) { D.releaseHow = el.getAttribute('data-how'); D.op = op('r'); paintOpen(false); },
    'rel-back': function () { D.releaseHow = null; paintOpen(false); },
    /* 078 — a website order's deposit, saved from its card. */
    wodep: function (el) {
      var ref = el.getAttribute('data-ref');
      var v = (document.getElementById('wodA-' + ref) || {}).value;
      var u = (document.getElementById('wodU-' + ref) || {}).value || '%';
      var body;
      if (u === '%') {
        var p = Desk.toCount(v, { empty: null });
        if (p === null || p < 0 || p > 100) { toast(t('rs_wo_deposit'), t('rs_err_pct'), 'err'); return; }
        body = { pct: p };
      } else {
        var a = Desk.toMinor(v, u);
        if (!(a >= 0)) { toast(t('rs_wo_deposit'), t('rs_err_amount'), 'err'); return; }
        body = { amount: a, currency: u };
      }
      var unbusy = busyButton(el);
      API.post('/api/web-orders/' + encodeURIComponent(ref) + '/deposit', body).then(function () {
        unbusy();
        toast(t('rs_wo_deposit'), t('rs_wo_saved'), 'ok', 3000);
      }).catch(function (err) { unbusy(); toast(t('rs_wo_deposit'), API.friendly(err), 'err'); });
    },
    'rel-go': function (el) {
      var how = D.releaseHow;
      after(el, API.post('/api/reservations/' + encodeURIComponent(D.r.saleId) + '/release', { how: how, opId: D.op }), function (r) {
        closeModal();
        toast(t('rs_title'), t(how === 'refund' ? 'rs_refunded' : 'rs_credited'), 'ok', 6000);
      });
    }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-rv]') : null;
    if (!el || el.disabled) return;
    var fn = ACT[el.getAttribute('data-rv')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  /* --------------------------------------------- Settings → Deposit */
  function settingsCard() {
    if (!can('config.write')) return '';
    var row = function (key, cfgKey, unit) {
      return '<label class="field"><span>' + t('rs_set_' + key) + savedPill('deposit.' + key) + '</span>' +
        '<div class="rv-set-in"><input class="inp num" type="text" inputmode="numeric" dir="ltr" value="' + esc(String(CONFIG[cfgKey])) + '" ' +
        'data-change="rv-set" data-k="' + key + '"><span class="muted">' + unit + '</span></div>' +
        '<small class="muted">' + t('rs_set_' + key + '_sub') + '</small></label>';
    };
    var meta = '<span dir="ltr">' + CONFIG.DEP_TILL_PCT + '% · ' + CONFIG.DEP_HOLD_DAYS + '</span> ' + t('rs_days');
    return setFoldStart('deposit', t('rs_set_title'), meta, t('rs_set_sub')) +
      '<div class="pe-grid">' + row('till_pct', 'DEP_TILL_PCT', '%') + row('online_pct', 'DEP_ONLINE_PCT', '%') +
      row('hold_days', 'DEP_HOLD_DAYS', t('rs_days')) + row('chase_days', 'DEP_CHASE_DAYS', t('rs_days')) + '</div>' + setFoldEnd();
  }
  var MAP = { till_pct: 'DEP_TILL_PCT', online_pct: 'DEP_ONLINE_PCT', hold_days: 'DEP_HOLD_DAYS', chase_days: 'DEP_CHASE_DAYS' };
  function settingChanged(el) {
    var k = el.getAttribute('data-k');
    var n = typeof Desk !== 'undefined' ? Desk.toCount(el.value, { empty: null }) : parseInt(el.value, 10);
    var max = /pct/.test(k) ? 100 : 60;
    if (n === null || !(n >= 1 && n <= max)) { el.classList.add('sg-bad'); return; }
    el.classList.remove('sg-bad');
    CONFIG[MAP[k]] = n;
    saveSetting('deposit.' + k, String(n));
  }

  /* ---------------------------------------- the product drawer's line */
  function heldHtml(p) {
    var rows = [];
    DB.variantsOf(p.id).forEach(function (v) {
      ((DB.held || {})[v.sku] || []).forEach(function (h) { rows.push({ v: v, h: h }); });
    });
    if (!rows.length) return '';
    return '<div class="card mb rv-held"><div class="card-head"><h3>' + t('rs_held_title') + '</h3></div><ul class="rv-lines">' +
      rows.map(function (x) {
        return '<li><bdi dir="ltr">' + esc(x.v.size) + '</bdi> × ' + x.h.qty + ' · ' +
          t('rs_held_for').replace('{name}', '<b dir="auto">' + esc(x.h.customer || '—') + '</b>').replace('{date}', day(x.h.until)) +
          (can('sell') || can('void') ? ' <button class="btn btn-sm btn-ghost" data-rv="open" data-id="' + esc(x.h.saleId) + '">' + t('rs_open') + '</button>' : '') + '</li>';
      }).join('') + '</ul></div>';
  }
  function heldCount(pid) {
    var n = 0;
    DB.variantsOf(pid).forEach(function (v) { ((DB.held || {})[v.sku] || []).forEach(function (h) { n += h.qty; }); });
    return n;
  }

  return {
    tillButtons: tillButtons, load: load, byScan: byScan, open: open, openNew: openNew, openList: openList,
    settingsCard: settingsCard, settingChanged: settingChanged, heldHtml: heldHtml, heldCount: heldCount,
    held: function () { return HELD; }
  };
})();
