/* ==========================================================================
   OG SYSTEM — "Waiting for the shop" (بانتظار المحل)            [Requests]
   --------------------------------------------------------------------------
   What staff left at shop.ogsports1.com/night while the shop was shut or
   out of reach: a customer, some sizes, delivery or pickup. The laptop
   collected them with the inbox (server/lib/requests.js); NOTHING HAS
   HAPPENED YET. Here a person decides:

     Accept           the order is made through the server's own order code —
                      the stock checked now, priced from the product table,
                      the shop's own invoice number. Pickup or our driver,
                      paid on receipt: the one-press case.
     Open in the desk a transport office, a courier or abroad is paid before
                      sending, so the order desk takes it from here, filled in.
     Turn it down     one of six reasons, and a note if it helps.

   The decision goes back to night mode, which shows it to whoever asked.

   It paints #view itself, like the Reviews page, and never goes back through
   render() from its after-hook — the fix 06 loop. The "…" menu is held in
   module state (S.menu), because this screen repaints on every live push and
   a class put on a node by a click does not survive that.
   ========================================================================== */

var Requests = (function () {

  var data = null;           /* { waiting, decided, count } as the server sent it */
  var loaded = false;
  var failed = null;
  var S = { menu: null };    /* the ref whose "…" is open */
  var A = null;              /* the Accept dialog: { ref, method } */
  var R = null;              /* the Turn-it-down dialog: { ref, code } */
  var sending = false;
  var bound = false;

  var REASONS = ['out_of_stock', 'no_answer', 'customer_cancelled', 'duplicate', 'wrong_details', 'other'];
  var ICON = {
    moon:    'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
    refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
    phone:   'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    pin:     'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
    bag:     'M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2',
    dots:    'M5 12h.01M12 12h.01M19 12h.01'
  };
  function svg(path, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  /* Money in ITS OWN currency, one isolate each — never converted, never
     added across currencies. */
  function moneyOf(minor, cur) {
    var s = cur === 'USD' ? moneyUsdRaw(minor) : cur === 'SYP' ? moneySypRaw(minor) : nf(minor) + ' ' + cur;
    return '<bdi dir="ltr">' + esc(s) + '</bdi>';
  }
  function fig(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
  function whName(id) { return DB.whName ? DB.whName(id, OG.lang === 'ar') : id; }
  function reasonText(code) { return t('rq_reason_' + (REASONS.indexOf(code) > -1 ? code : 'other')); }

  /* ------------------------------------------------------------- loading */

  function load() {
    return API.get('/api/requests').then(function (r) {
      data = r;
      loaded = true;
      failed = null;
      paint();
      badge();
    }).catch(function (e) {
      failed = API.friendly(e);
      loaded = true;
      paint();
    });
  }

  function paint() {
    if (OG.view !== 'requests') return;
    var host = document.getElementById('view');
    if (host) host.innerHTML = view();
  }

  /* The count beside the menu entry follows the list. */
  function badge() {
    try { if (typeof renderSidebar === 'function') renderSidebar(); } catch (e) { /* not drawn yet */ }
    try { if (typeof renderTabbar === 'function') renderTabbar(); } catch (e) { /* not drawn yet */ }
  }

  function count() {
    if (data) return data.count || 0;
    /* Before the first load, the bell already knows. */
    var row = (DB.notifications || []).filter(function (x) { return x.kind === 'requests_waiting'; })[0];
    return row && row.args ? Number(row.args.n) || 0 : 0;
  }

  /* A live push (d.requests): reload while this is the screen and nobody is
     in the middle of a dialog; otherwise only the badge moves. */
  function live() {
    if (typeof Auth === 'undefined' || !Auth.can('delivery.desk')) return;
    if (OG.view === 'requests' && modalOpen()) return;
    load();
  }

  /* ---------------------------------------------------------------- view */

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('rq_title') + '</h1>' +
      '<div class="sub">' + t('rq_sub') + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-ghost btn-sm rq-refresh" data-act="rq-reload" title="' +
        esc(t('rq_refresh')) + '" aria-label="' + esc(t('rq_refresh')) + '">' + svg(ICON.refresh) + '</button></div></div>';
    if (failed) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="rq-reload">' + t('retry') + '</button></div></div>';
    }
    if (!loaded) {
      return head + '<div class="rq-skel" aria-busy="true"><i></i><i></i></div>' +
        '<span class="sr-only" role="status">' + esc(t('rq_loading')) + '</span>';
    }
    var w = data.waiting || [];
    /* The server sends the oldest hundred and the true count; a list that
       stops short says so rather than passing itself off as all of them. */
    var capped = (data.count || 0) > w.length
      ? '<p class="rq-capped" role="status">' + t('rq_capped').replace('{shown}', fig(nf(w.length))).replace('{total}', fig(nf(data.count))) + '</p>'
      : '';
    var body = w.length
      ? capped + '<div class="rq-list">' + w.map(card).join('') + '</div>'
      : '<div class="card"><div class="cart-empty"><b>' + t('rq_empty') + '</b><span>' + t('rq_empty_why') + '</span></div></div>';
    return head + body + decidedHtml();
  }

  function card(r) {
    var c = r.customer || {};
    var dl = r.delivery || {};
    var tel = String(c.phone || '').replace(/[^0-9+]/g, '');
    var who = c.match
      ? '<span class="rq-chip ok">' + t('rq_known') + '</span>'
      : '<span class="rq-chip">' + t('rq_new_customer') + '</span>';
    var where = dl.method === 'pickup'
      ? t('rq_pickup')
      : t('rq_delivery') + (dl.city ? ' · <bdi dir="auto">' + esc(dl.city) + '</bdi>' : '') + (dl.address ? '<br><span class="rq-addr" dir="auto">' + esc(dl.address) + '</span>' : '');

    var totals = {};
    var lines = (r.lines || []).map(function (l) {
      var name = l.known ? l.name : (l.askedName || l.sku);
      var colour = OG.lang === 'ar' ? (l.colourAr || l.askedColourAr || l.colour || l.askedColour)
                                    : (l.colour || l.askedColour || l.colourAr || l.askedColourAr);
      var size = l.known ? l.size : l.askedSize;
      var here = (l.stock && l.stock.byWh && l.stock.byWh[r.packFrom]) || 0;
      var chip;
      if (!l.known) chip = '<span class="rq-chip bad">' + t('rq_gone') + '</span>';
      else if (!here) chip = '<span class="rq-chip bad">' + t('rq_none_here').replace('{wh}', esc(whName(r.packFrom))) + '</span>';
      else if (here < l.qty) chip = '<span class="rq-chip warn">' + t('rq_only_here').replace('{n}', fig(nf(here))).replace('{wh}', esc(whName(r.packFrom))) + '</span>';
      else chip = '<span class="rq-chip ok">' + t('rq_have_here').replace('{n}', fig(nf(here))).replace('{wh}', esc(whName(r.packFrom))) + '</span>';
      if (l.known && l.currency) totals[l.currency] = (totals[l.currency] || 0) + l.price * l.qty;
      return '<li class="rq-line"><div class="rq-line-top"><span class="rq-line-name" dir="auto">' + esc(name) +
          (colour ? ' · ' + esc(colour) : '') + '</span>' +
          '<span class="rq-line-qty">' + fig((size || '') + ' ×' + l.qty) + '</span></div>' +
        '<div class="rq-line-sub">' + chip + (l.known ? '<span class="rq-price">' + moneyOf(l.price, l.currency) + '</span>' : '') + '</div></li>';
    }).join('');
    var tot = Object.keys(totals).map(function (k) { return moneyOf(totals[k], k); }).join(' · ');
    var canAccept = (r.lines || []).every(function (l) { return l.known; });

    var menu = S.menu === r.ref
      ? '<div class="rq-menu" role="menu"><button class="rq-mitem bk-danger" role="menuitem" data-act="rq-reject" data-ref="' + esc(r.ref) + '">' +
          t('rq_reject') + '</button></div>'
      : '';

    /* The card holding an open menu is lifted, or the next card — a later
       sibling — paints over the menu and takes the press (quick fix). */
    return '<article class="card rq-card' + (S.menu === r.ref ? ' is-open' : '') + '" id="rq-' + esc(r.ref) + '">' +
      '<header class="rq-head"><div class="rq-id">' + svg(ICON.moon, 'rq-ico') +
        '<b>' + fig(r.ref) + '</b><span class="rq-chip">' + t(r.source === 'web' ? 'rq_src_web' : 'rq_src_night') + '</span></div>' +
        '<small class="rq-when">' + esc(fmtDateTime(r.askedAt)) + (r.byUser ? ' · ' + t('rq_by').replace('{user}', esc(r.byUser)) : '') + '</small></header>' +
      '<div class="rq-who"><b dir="auto">' + esc(c.name || '—') + '</b>' + who +
        (tel ? '<a class="rq-tel" href="tel:' + esc(tel) + '">' + svg(ICON.phone) + fig(c.phone) + '</a>' : '') + '</div>' +
      '<div class="rq-where">' + svg(dl.method === 'pickup' ? ICON.bag : ICON.pin) + '<span>' + where + '</span></div>' +
      '<ul class="rq-lines">' + lines + '</ul>' +
      (tot ? '<div class="rq-total"><span>' + t('rq_total') + '</span><span>' + tot + '</span></div>' : '') +
      (r.note ? '<p class="rq-note" dir="auto">' + esc(r.note) + '</p>' : '') +
      '<div class="rq-actions">' +
        '<button class="btn btn-primary" data-act="rq-accept" data-ref="' + esc(r.ref) + '"' + (canAccept ? '' : ' disabled title="' + esc(t('rq_cannot')) + '"') + '>' + t('rq_accept') + '</button>' +
        '<button class="btn btn-ghost" data-act="rq-desk" data-ref="' + esc(r.ref) + '"' + (canAccept ? '' : ' disabled') + '>' + t('rq_open_desk') + '</button>' +
        '<div class="rq-more"><button class="btn btn-ghost rq-dots" data-act="rq-menu" data-ref="' + esc(r.ref) + '" aria-haspopup="menu" aria-expanded="' +
          (S.menu === r.ref ? 'true' : 'false') + '" aria-label="' + esc(t('rq_more')) + '">' + svg(ICON.dots) + '</button>' + menu + '</div>' +
      '</div>' +
    '</article>';
  }

  function decidedHtml() {
    var d = (data && data.decided) || [];
    if (!d.length) return '';
    var rows = d.map(function (r) {
      var st = r.state === 'accepted'
        ? '<span class="rq-chip ok">' + t('rq_accepted') + '</span> <button class="rq-link" data-act="rq-order" data-id="' + esc(r.saleId || '') + '">' + fig(r.saleId || '') + '</button>'
        : '<span class="rq-chip bad">' + t('rq_rejected') + '</span> <span class="rq-why">' + esc(reasonText(r.code)) + (r.reason ? ' — <bdi dir="auto">' + esc(r.reason) + '</bdi>' : '') + '</span>';
      return '<li class="rq-done"><div class="rq-done-top"><b>' + fig(r.ref) + '</b><span dir="auto">' + esc((r.customer && r.customer.name) || '') + '</span></div>' +
        '<div class="rq-done-st">' + st + '</div>' +
        '<small class="rq-when">' + esc(fmtDateTime(r.decidedAt)) + (r.decidedByName ? ' · ' + esc(r.decidedByName) : '') +
          (r.reported ? '' : ' · <span class="rq-unsent">' + t('rq_unsent') + '</span>') + '</small></li>';
    }).join('');
    return '<section class="card rq-decided"><h3>' + t('rq_decided') + '</h3><ul>' + rows + '</ul></section>';
  }

  /* ------------------------------------------------------------ the dialogs */

  function find(ref) {
    return ((data && data.waiting) || []).filter(function (r) { return r.ref === ref; })[0] || null;
  }

  /* What pressing the button will do, in one sentence — "1 piece", never
     "1 pieces". */
  function willSay(r, pickup) {
    var pieces = (r.lines || []).reduce(function (n, l) { return n + l.qty; }, 0);
    return t((pickup ? 'rq_will_pickup' : 'rq_will_driver') + (pieces === 1 ? '_1' : ''))
      .replace('{name}', '<bdi dir="auto">' + esc((r.customer && r.customer.name) || '—') + '</bdi>').replace('{n}', fig(nf(pieces)));
  }

  /* A pickup request carries no address, and our driver needs one: the server
     refuses it (needs_address), so the button is not offered. */
  function hasAddress(r) {
    return !!(r && r.delivery && String(r.delivery.address || '').trim());
  }

  function acceptBody(r) {
    var pickup = A.method === 'pickup';
    var noAddr = !hasAddress(r);
    var feeCur = (r.fee && r.fee.currency) || CONFIG.BASE_CURRENCY || 'SYP';
    var feeHint = r.fee ? t('rq_fee_list').replace('{fee}', moneyOf(r.fee.fee, r.fee.currency)) : t('rq_fee_none');
    var places = (DB.warehouses || []).map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === r.packFrom ? ' selected' : '') + '>' + esc(whName(w.id)) + '</option>';
    }).join('');
    return '<div class="rq-dlg">' +
      '<div class="rq-toggle" role="group" aria-label="' + esc(t('rq_how')) + '">' +
        '<button type="button" class="rq-opt' + (pickup ? ' on' : '') + '" data-act="rq-method" data-val="pickup" aria-pressed="' + pickup + '">' + t('rq_m_pickup') + '</button>' +
        '<button type="button" class="rq-opt' + (!pickup ? ' on' : '') + '" data-act="rq-method" data-val="driver" aria-pressed="' + !pickup + '"' +
          (noAddr ? ' disabled aria-describedby="rqNoAddr"' : '') + '>' + t('rq_m_driver') + '</button>' +
      '</div>' +
      (noAddr ? '<p class="rq-hint" id="rqNoAddr">' + t('rq_no_address') + '</p>' : '') +
      '<div class="rq-fee"' + (pickup ? ' hidden' : '') + '>' +
        '<label class="field"><span>' + t('rq_fee') + ' · ' + esc(feeCur) + '</span>' +
          '<input class="inp" id="rqFee" type="text" inputmode="decimal" autocomplete="off" dir="ltr" placeholder="' + esc(r.fee ? Desk.plain(r.fee.fee, r.fee.currency) : '') + '"></label>' +
        '<p class="rq-hint">' + feeHint + '</p></div>' +
      '<label class="field"><span>' + t('rq_from') + '</span><select class="inp" id="rqWh">' + places + '</select></label>' +
      '<p class="rq-sentence">' + willSay(r, pickup) + '</p>' +
      '<p class="rq-err" id="rqErr" role="alert"></p>' +
    '</div>';
  }

  function openAccept(ref) {
    var r = find(ref);
    if (!r) return;
    A = { ref: ref, method: r.delivery && r.delivery.method === 'pickup' || !hasAddress(r) ? 'pickup' : 'driver' };
    openModal({
      title: t('rq_accept_title').replace('{ref}', fig(ref)), size: 'narrow',
      body: acceptBody(r),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" id="rqGo" data-act="rq-accept-go">' + t('rq_make') + '</button>',
      onClose: function () { A = null; }
    });
  }

  function setMethod(m) {
    if (!A) return;
    var r = find(A.ref);
    A.method = m === 'pickup' || !hasAddress(r) ? 'pickup' : 'driver';
    var root = document.getElementById('modal-root');
    if (!r || !root) return;
    root.querySelectorAll('.rq-opt').forEach(function (b) {
      var on = b.getAttribute('data-val') === A.method;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    var fee = root.querySelector('.rq-fee');
    if (fee) fee.hidden = A.method === 'pickup';
    var s = root.querySelector('.rq-sentence');
    if (s) s.innerHTML = willSay(r, A.method === 'pickup');
  }

  function sendAccept() {
    if (!A || sending) return;
    var r = find(A.ref);
    var err = document.getElementById('rqErr');
    var go = document.getElementById('rqGo');
    var typed = (document.getElementById('rqFee') || {}).value || '';
    var feeCur = (r && r.fee && r.fee.currency) || CONFIG.BASE_CURRENCY || 'SYP';
    var body = { method: A.method, whId: (document.getElementById('rqWh') || {}).value || null };
    /* A blank box means "the price list", never "free". */
    if (A.method === 'driver' && String(typed).trim() !== '') body.fee = Desk.toMinor(typed, feeCur);
    var ref = A.ref;
    sending = true;
    if (go) { go.disabled = true; go.textContent = t('rq_making'); }
    API.post('/api/requests/' + encodeURIComponent(ref) + '/accept', body).then(function (res) {
      sending = false;
      closeModal();
      toast(t('rq_title'), t('rq_made').replace('{id}', res.sale.id), 'ok', 5000);
      load();
      if (typeof Shop !== 'undefined' && Shop.reload) Shop.reload().catch(function () {});
      if (typeof Desk !== 'undefined' && Desk.openOrder) Desk.openOrder(res.sale.id);
    }).catch(function (e) {
      sending = false;
      if (go) { go.disabled = false; go.textContent = t('rq_make'); }
      /* Sold since the list was drawn: said in the screen's language, with
         what is left, and the list reloaded so the stock chips are true. */
      var det = (e && e.detail) || {};
      if (err) err.textContent = e && e.code === 'insufficient_stock'
        ? t('rq_short').replace('{n}', nf(det.available || 0)).replace('{sku}', det.sku || '')
        : API.friendly(e);
      if (e && (e.code === 'decided' || e.code === 'insufficient_stock')) load();
    });
  }

  function reasonsHtml() {
    return '<div class="rq-reasons" role="radiogroup" aria-label="' + esc(t('rq_why')) + '">' + REASONS.map(function (c) {
      var on = R && R.code === c;
      return '<button type="button" class="rq-opt' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-act="rq-reason" data-val="' + c + '">' +
        esc(reasonText(c)) + '</button>';
    }).join('') + '</div>';
  }

  function openReject(ref) {
    S.menu = null;
    paint();
    R = { ref: ref, code: null };
    openModal({
      title: t('rq_reject_title').replace('{ref}', fig(ref)), size: 'narrow',
      body: '<div class="rq-dlg"><p class="muted">' + t('rq_reject_sub') + '</p>' + reasonsHtml() +
        '<label class="field"><span>' + t('rq_note') + '</span><textarea id="rqNote" maxlength="200" rows="3"></textarea></label>' +
        '<p class="rq-err" id="rqErr" role="alert"></p></div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn bk-danger" id="rqGo" data-act="rq-reject-go">' + t('rq_reject') + '</button>',
      onClose: function () { R = null; }
    });
  }

  function pickReason(code) {
    if (!R) return;
    R.code = code;
    var root = document.getElementById('modal-root');
    if (!root) return;
    root.querySelectorAll('.rq-reasons .rq-opt').forEach(function (b) {
      var on = b.getAttribute('data-val') === code;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    var err = document.getElementById('rqErr');
    if (err) err.textContent = '';
  }

  function sendReject() {
    if (!R || sending) return;
    var err = document.getElementById('rqErr');
    if (!R.code) { if (err) err.textContent = t('rq_pick_reason'); return; }
    var go = document.getElementById('rqGo');
    var ref = R.ref;
    sending = true;
    if (go) go.disabled = true;
    API.post('/api/requests/' + encodeURIComponent(ref) + '/reject', {
      code: R.code, note: (document.getElementById('rqNote') || {}).value || ''
    }).then(function () {
      sending = false;
      closeModal();
      toast(t('rq_title'), t('rq_rejected_toast').replace('{ref}', ref), 'ok', 3500);
      load();
    }).catch(function (e) {
      sending = false;
      if (go) go.disabled = false;
      if (err) err.textContent = API.friendly(e);
      if (e && e.code === 'decided') load();
    });
  }

  /* The order desk takes it from here: the customer found or made, the
     desk's draft filled, and the desk's own Save makes the order. */
  function toDesk(ref) {
    if (sending) return;
    sending = true;
    API.post('/api/requests/' + encodeURIComponent(ref) + '/prepare', {}).then(function (res) {
      sending = false;
      if (typeof Desk !== 'undefined' && Desk.fromRequest) Desk.fromRequest(res.draft);
    }).catch(function (e) {
      sending = false;
      toast(t('rq_title'), API.friendly(e), 'err', 7000);
      if (e && e.code === 'decided') load();
    });
  }

  /* ------------------------------------------------------------- actions */

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['rq-reload'] = function () { loaded = false; failed = null; paint(); load(); };
    ACTIONS['rq-accept'] = function (el) { openAccept(el.getAttribute('data-ref')); };
    ACTIONS['rq-method'] = function (el) { setMethod(el.getAttribute('data-val')); };
    ACTIONS['rq-accept-go'] = function () { sendAccept(); };
    ACTIONS['rq-desk'] = function (el) { toDesk(el.getAttribute('data-ref')); };
    ACTIONS['rq-menu'] = function (el) {
      var ref = el.getAttribute('data-ref');
      S.menu = S.menu === ref ? null : ref;
      paint();
    };
    ACTIONS['rq-reject'] = function (el) { openReject(el.getAttribute('data-ref')); };
    ACTIONS['rq-reason'] = function (el) { pickReason(el.getAttribute('data-val')); };
    ACTIONS['rq-reject-go'] = function () { sendReject(); };
    ACTIONS['rq-order'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id && typeof Desk !== 'undefined' && Desk.openOrder) Desk.openOrder(id);
    };
    /* A press anywhere else shuts the "…" menu. Capture phase, so it runs
       before the delegated dispatcher, as the board's own menu does. */
    if (!bound) {
      bound = true;
      document.addEventListener('pointerdown', function (e) {
        if (!S.menu || OG.view !== 'requests') return;
        if (e.target && e.target.closest && e.target.closest('.rq-more')) return;
        S.menu = null;
        paint();
      }, true);
    }
  }

  function after() { load(); }

  return { view: view, after: after, register: register, load: load, live: live, count: count };
})();
