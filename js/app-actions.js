/* ==========================================================================
   OG SYSTEM — application shell  ·  15/17: ACTIONS dispatch table
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 6517-7481, section 19 "ACTIONS").
   Loads after app-i18n-extra.js.

   This is one giant object literal referencing dozens of functions by
   value (nav: go, whatsapp: openWhatsapp, ...) — every file that defines
   one of those functions (app-shell/app-dashboard/app-products/
   app-warehouse/app-customers-scan/app-jobs-reports/
   app-settings/app-documents/app-routing) MUST already be
   loaded before this file runs, since cross-<script> execution does not
   hoist. Kept as a single intact object literal per the split plan —
   breaking it into ACTIONS['key'] = fn assignments would be a real code
   shape change, not just a file move.
   ========================================================================== */

/* -------------------------------------------------------------- 19. ACTIONS */

/* Which piece of state holds a screen's open tab. Only two screens have
   tabs; naming them here means a shortcut can say WHERE it is going rather
   than only which screen — "+ Add product" on the Products page should land
   on the Add form, not on whichever warehouse tab was open last. */
var NAV_TAB_STATE = { warehouse: function () { return OG.wh; }, reports: function () { return OG.rep; } };

function navTo(view, tab) {
  /* Set before go(), because go() renders — doing it after would draw the
     old tab first and then snap. */
  if (tab && NAV_TAB_STATE[view]) NAV_TAB_STATE[view]().tab = tab;
  go(view);
}

/* The gift-slip exchange window, in days, out of a text box.
   ONE RULE, so the box behaves the same however it is abused: a real number is
   clamped into range, and anything that is not one falls back to the default.
   Written out rather than done inline with `Number(v) || 7`, which quietly
   made 0 mean "seven days" while -4 meant "one day" — two different answers to
   the same "that isn't a window" and no way to guess which you would get.

   The floor is the point. A window of zero prints a gift slip that expired the
   moment it came off the roll, which is worse than no slip: the recipient is
   holding paper that says they are too late. */
function giftDays(raw) {
  var s = String(raw == null ? '' : raw).trim();
  var n = s === '' ? NaN : Number(s);
  if (!isFinite(n)) return 7;
  return Math.min(365, Math.max(1, Math.round(n)));
}

var ACTIONS = {
  nav: function (el) { navTo(el.getAttribute('data-view'), el.getAttribute('data-tab')); },
  'nav-close': function (el) { closeDrawer(); navTo(el.getAttribute('data-view'), el.getAttribute('data-tab')); },

  /* Collapse the sidebar to an icon rail, and remember it. Re-rendered rather
     than just re-styled because the sliding active-indicator is positioned
     from the nav's real geometry, which the narrower rail changes. */
  'sidebar-toggle': function () {
    setSidebarMini(document.body.getAttribute('data-sidebar') !== 'mini');
    renderSidebar();
  },

  /* Push everything to Supabase now. The timer already does this every ten
     minutes; this is for the moment somebody has just finished a stock count
     and wants to see it land.

     The button reports the real verdict — it spins while the server works and
     then says what happened. A button that always flashes green teaches
     people to stop believing it, which is worse than no button. */
  'sync-now': function (el) {
    if (el.disabled) return;
    el.disabled = true;
    el.classList.add('spinning');

    API.post('/api/sync/push', {})
      .then(function (r) {
        toast(t('sync_now'), t('sync_done').replace('{s}', r.seconds || 0), 'ok', 3500);
        /* The mirror changed, not the shop — nothing on screen is stale, so
           there is deliberately no re-render here. */
      })
      .catch(function (e) {
        var busy = e && e.code === 'busy';
        /* The server's message is now the sync's own last line — the foreign
           key, the column the mirror has not got, the project that did not
           answer — so the person who pressed learns why, not only that. */
        var why = busy ? t('sync_busy')
                       : t('sync_failed').replace('{why}', (e && e.message) || API.friendly(e));
        toast(t('sync_now'), why, busy ? 'warn' : 'err', 8000);
      })
      .then(function () {
        el.disabled = false;
        el.classList.remove('spinning');
      });
  },

  lang: function (el) {
    OG.lang = el.getAttribute('data-val');
    applyLang();
    refreshAll();
    toast(OG.lang === 'ar' ? 'اللغة العربية' : 'English', OG.lang === 'ar' ? 'تم قلب الواجهة لليمين' : 'Interface switched', 'ok');
  },

  curr: function (el) {
    OG.currency = el.getAttribute('data-val');
    renderTopbar();
    render();
    toast(OG.currency, '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP', 'ok', 2000);
  },

  bell: function (el, e) {
    e.stopPropagation();
    var existing = document.getElementById('notifPop');
    if (existing) { existing.remove(); return; }
    var pop = document.createElement('div');
    pop.id = 'notifPop';
    pop.className = 'notif-pop';
    var unread = DB.unreadNotifications().length;
    var h = '<h4>' + t('notifications') +
      (unread ? ' · ' + unread + ' ' + t('nt_new') : '') +
      (unread
        ? '<button class="notif-read-all" data-act="notif-read-all">' + t('nt_read_all') + '</button>'
        : '') +
      '</h4>';
    DB.notifications.forEach(function (n, i) {
      h += '<div class="notif-row' + (n.read ? ' seen' : '') +
        '" data-act="notif-go" data-i="' + i + '">' +
        '<span class="notif-dot ' + n.tone + '">' + n.icon + '</span><span>' + DB.alertText(n) + '</span></div>';
    });
    pop.innerHTML = h;
    document.getElementById('topbar').appendChild(pop);
  },

  /* Reading one is opening it — the same thing every mail client does, and
     it means the badge falls as alerts are actually dealt with rather than
     only when somebody presses the button. */
  'notif-go': function (el) {
    var n = DB.notifications[+el.getAttribute('data-i')];
    var pop = document.getElementById('notifPop'); if (pop) pop.remove();
    DB.markNotifRead(n);
    renderTopbar();
    /* A partner message opens the thread it belongs to, not just the screen. */
    if (n.kind === 'partner_msg' && n.args) {
      if (n.args.invoice) { OG.pr = OG.pr || {}; OG.pr.tab = 'invoices'; go('print', function () { openPartnerInvoice(n.args.invoice); }); }
      else if (n.args.job) { go('print', function () { openJobDrawer(n.args.job); }); }
      else go(n.view);
      return;
    }
    go(n.view);
  },

  'notif-read-all': function (el) {
    DB.markNotifRead();
    var pop = document.getElementById('notifPop'); if (pop) pop.remove();
    renderTopbar();
    toast(t('notifications'), t('nt_all_read'), 'ok', 1800);
  },

  /* --- account ------------------------------------------------------------ */

  acct: function (el, e) {
    e.stopPropagation();
    var existing = document.getElementById('acctPop');
    if (existing) { existing.remove(); return; }

    var u = acct();
    if (!u) return;

    var pop = document.createElement('div');
    pop.id = 'acctPop';
    pop.className = 'acct-pop';
    pop.innerHTML = accountPopHtml(u);
    document.getElementById('topbar').appendChild(pop);
  },

  'acct-pw': function () {
    var pop = document.getElementById('acctPop'); if (pop) pop.remove();
    closeModal();
    openChangePassword();
  },

  'acct-pw-save': function (el) {
    var cur = document.getElementById('pwCur');
    var a = document.getElementById('pwNew');
    var b = document.getElementById('pwNew2');
    var err = document.getElementById('pwErr');
    if (!cur || !a || !b) return;

    var show = function (m) { if (err) err.textContent = m; };

    /* Catch the mismatch here rather than after a round trip — the server
       cannot check it, since it only ever receives one new password. */
    if (a.value !== b.value) { show(t('pw_mismatch')); b.select(); return; }
    if (!cur.value || !a.value) { show(t('pw_mismatch')); return; }

    el.disabled = true;
    show('');

    API.post('/api/auth/password', { current: cur.value, next: a.value })
      .then(function () {
        closeModal();
        toast(t('pw_changed'), t('pw_reauth'), 'ok', 5000);
        /* Every session died, this one included. Give the toast a moment to
           be read, then let the login screen come back. */
        setTimeout(function () { location.reload(); }, 1800);
      })
      .catch(function (e2) {
        el.disabled = false;
        show(API.friendly(e2));
      });
  },

  'acct-out': function () {
    var pop = document.getElementById('acctPop'); if (pop) pop.remove();
    closeModal();
    toast(t('sign_out'), t('signing_out'), 'ok', 1500);
    Auth.logout();
  },

  /* The A4 invoice is still there for anyone who wants a full page — a
     wholesale customer, or a copy for the file. */
  'rc-invoice': function (el) {
    var s = DB.sale(el.getAttribute('data-id'));
    closeModal();
    if (s) openInvoice(s);
  },

  'modal-close': closeModal,
  'modal-backdrop': function (el, e) { if (e.target === el) closeModal(); },
  'drawer-close': closeDrawer,
  'print-now': function () { setRollPageSize(); window.print(); },

  /* Printing a DOCUMENT — a report, an export, an invoice — rather than a
     label or a till receipt.

     Separate from print-now because print-now exists to put the LABEL roll's
     size on the page, and it does that from OG.lb.mode, which defaults to
     'roll'. Sent through it, an A4 report asked for a 30mm square page; and
     if a receipt had been opened first, an 80mm one. Neither is a document,
     and neither rule belonged to the screen that was actually open. */
  'print-doc': function () { setDocPageSize(); window.print(); },

  /* A till receipt, on till-roll paper. Also asserts rather than inherits:
     openReceipt() sets the roll width when it opens, but print-now would then
     append the LABEL rule on top of it and print the receipt at 30mm. */
  'print-receipt-now': function () {
    var roll = document.getElementById('rollPageRule');
    if (roll) roll.parentNode.removeChild(roll);
    document.body.classList.remove('roll-labels');
    var doc = document.getElementById('docPageRule');
    if (doc) doc.parentNode.removeChild(doc);
    setReceiptPageSize();
    window.print();
  },

  export: function (el) {
    var spec = currentExportSpec();
    if (!spec || !spec.rows || !spec.rows.length) { toast(t('export_failed'), t('none'), 'warn'); return; }
    spec.kind = el.getAttribute('data-kind') === 'excel' ? 'xlsx' : 'pdf';
    Export.run(spec);
  },

  /* Single-record sheets, launched from the record's own drawer. */
  'export-rec': function (el) {
    var type = el.getAttribute('data-rec'), id = el.getAttribute('data-id');
    var spec = type === 'customer' ? customerStatementSpec(+id)
             : type === 'product'  ? productSheetSpec(+id)
             : jobSheetSpec(id);
    if (!spec || !spec.rows.length) { toast(t('export_failed'), t('none'), 'warn'); return; }
    spec.kind = el.getAttribute('data-kind') === 'excel' ? 'xlsx' : 'pdf';
    closeDrawer();
    Export.run(spec);
  },

  'search-prod': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var id = +el.getAttribute('data-id');
    go('products', function () { openProductDrawer(id); });
  },
  'search-cust': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var id = +el.getAttribute('data-id');
    go('customers', function () { openCustomerDrawer(id); });
  },
  'search-inv': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var s = DB.sale(el.getAttribute('data-id'));
    if (s) openInvoice(s);
  },

  /* A to-do row on the dashboard or the warehouse home. Found by KEY in the
     lists the server sent — the dashboard's fifty first, the bell's eight
     as a fallback — marked read in both, then opened where it can be acted
     on. The customers screen takes the filter that matches the kind. */
  'alert-fix': function (el) {
    var key = el.getAttribute('data-key');
    var pool = (DB.dash && DB.dash.todo ? DB.dash.todo.rows : []).concat(DB.notifications);
    var a = null;
    pool.some(function (x) { if (x.key === key) { a = x; return true; } });
    if (!a) return;
    DB.markNotifReadKey(key);
    renderTopbar();
    var of = a.kind === 'more' ? (a.args && a.args.of) : a.kind;
    /* The wants list lives on the warehouse screen — it is the back room
       that answers "who was waiting for this box". */
    if (of === 'wants_back') OG.wh.tab = 'wants';
    if (of === 'stamps') OG.cust.filter = 'cardfull';
    if (of === 'supplier_due') OG.rep.tab = 'suppliers';
    go(a.view);
  },

  /* A count on the dashboard's people row is the door to the list it counts. */
  'dash-cust': function (el) {
    var f = el.getAttribute('data-f');
    if (f === 'wants') { OG.wh.tab = 'wants'; go('warehouse'); return; }
    OG.cust.filter = f || 'all';
    go('customers');
  },

  'open-invoice': function (el) {
    var s = DB.sale(el.getAttribute('data-id'));
    if (s) openInvoice(s);
  },

  'open-product': function (el) { openProductDrawer(+el.getAttribute('data-id')); },
  'quick-label': function (el) { openQuickLabelPicker(+el.getAttribute('data-id')); },

  'qlp-toggle': function (el) {
    if (!quickPick) return;
    var sku = el.getAttribute('data-sku');
    if (Object.prototype.hasOwnProperty.call(quickPick.sel, sku)) delete quickPick.sel[sku];
    else quickPick.sel[sku] = 1;
    repaintQuickLabelPicker();
  },
  'qlp-all': function () {
    if (!quickPick) return;
    DB.variantsOf(quickPick.pid).forEach(function (v) {
      if (v.qty > 0) quickPick.sel[v.sku] = quickPick.sel[v.sku] || 1;
    });
    repaintQuickLabelPicker();
  },
  'qlp-clear': function () {
    if (!quickPick) return;
    quickPick.sel = {};
    repaintQuickLabelPicker();
  },
  'qlp-print': function () {
    if (!quickPick) return;
    var skus = Object.keys(quickPick.sel);
    if (!skus.length) { toast(t('print_labels'), t('lbl_none_picked'), 'warn'); return; }
    var lines = skus.map(function (sku) { return { sku: sku, qty: quickPick.sel[sku] }; });
    closeModal();
    if (typeof Labels !== 'undefined') {
      Labels.openPreviewModal(lines, Labels.lastChoice().preset, Labels.lastChoice().station);
    }
  },

  /* The counter view: a drawer over whatever screen you were on. Deliberately
     still a drawer — mid-sale, the question is a size and a phone number, and
     navigating away to answer it loses the basket. */
  'open-customer': function (el) { openCustomerDrawer(+el.getAttribute('data-id')); },

  /* The whole record, as a place. */
  'cu-open': function (el) { closeDrawer(); go('customers', null, el.getAttribute('data-id')); },

  /* Back from a profile goes to the LIST, not to whatever screen was showing
     before it. Somebody who arrives from the bell, a scan or a pasted link
     wants "the customers screen" — not the dashboard they happened to be on.
     Browser Back still walks the history it actually has; this is the
     affordance on the page, and the two are allowed to differ. */
  'cu-list': function () { go('customers', null, null); },

  /* Draw the rest of the timeline. A RENDER cap, not a fetch — the rows are
     already in memory, so this redraws rather than asking the server again. */
  'cu-tl-all': function () {
    var host = document.getElementById('cuTl');
    if (!host || !OG.tlRows) return;
    host.innerHTML = timelineHTML(OG.tlRows, true);
  },

  'cu-edit': function (el) { openEditCustomer(+el.getAttribute('data-id')); },

  /* ---- taking a payment against a debt -----------------------------------
     `debt.collect`, which a cashier has and which does NOT give her the money
     screen. The three guards are the server's — an opId so a retry cannot
     take it twice, the balance recomputed inside the transaction, and
     Sales.void refusing a part-paid sale — and none of them are restated
     here, because a second copy of a money rule is one copy that is wrong. */
  'cu-pay': function (el) {
    if (!allow('debt.collect')) { toast(t('cu_take_payment'), t('no_access'), 'err'); return; }
    var saleId = el.getAttribute('data-sale');
    var cid = +el.getAttribute('data-cid');
    var sale = DB.sale(saleId);
    OG.payFor = { saleId: saleId, cid: cid };

    openModal({
      title: t('cu_take_payment') + ' · ' + esc(saleId), size: 'narrow',
      body: '<label class="field"><span>' + t('amount') + '</span>' +
          '<input class="inp num" id="cuPayAmt" type="number" min="1" inputmode="numeric"></label>' +
        '<label class="field mt"><span>' + t('payment_method') + '</span>' +
          '<select class="inp" id="cuPayMethod">' +
            ['cash', 'sham', 'fuad', 'haram', 'card'].map(function (m) {
              return '<option value="' + m + '">' + esc(DB.payLabel(m)) + '</option>';
            }).join('') +
          '</select></label>' +
        '<label class="field mt"><span>' + t('note') + '</span>' +
          '<input class="inp" id="cuPayNote" type="text"></label>' +
        '<div class="partner-note mt">' + t('cu_pay_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="cu-pay-do">' + t('cu_take_payment') + '</button>',
      onOpen: function () {
        setTimeout(function () {
          var i = document.getElementById('cuPayAmt');
          if (i) i.focus();
        }, 60);
      }
    });
  },

  'cu-pay-do': function () {
    var ref = OG.payFor || {};
    var amt = Math.round(Number((document.getElementById('cuPayAmt') || {}).value) || 0);
    if (!(amt > 0)) {
      toast(t('cu_take_payment'), t('cu_pay_amount_needed'), 'err');
      return;
    }
    var method = (document.getElementById('cuPayMethod') || {}).value || 'cash';
    var note = ((document.getElementById('cuPayNote') || {}).value || '').trim();
    /* Generated once, HERE, not inside the send function — Shop.write can be
       called again by a person tapping twice, and a fresh opId each time is
       exactly the thing an opId exists to prevent. */
    var opId = 'pay-' + ref.saleId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    Shop.write(
      function () {
        return Shop.payDebt({
          saleId: ref.saleId, amount: amt, method: method,
          note: note || null, opId: opId
        });
      },
      function () { return null; },
      function (res) {
        closeModal();
        render();
        var left = res && res.payment ? res.payment.balance : null;
        toast(t('cu_take_payment'),
          nf(amt) + (left === 0
            ? ' · ' + t('cu_debt_cleared')
            : (left != null ? ' · ' + t('cu_still_owed').replace('{n}', nf(left)) : '')),
          'ok', 4000);
      }
    );
  },

  /* ---- merging two records that are one person ---------------------------
     Manager only on the server (staff.write); drawn only for them here so
     nobody is offered a button that will refuse. */
  /* Linking an old print job to a customer by hand. Reuses the same picker
     shape as the attach-a-sale one — one idea, one interaction. */
  'job-link': function (el) {
    var jid = el.getAttribute('data-jid');
    OG.linkJob = jid;
    openModal({
      title: t('pj_link'), size: 'narrow',
      body: '<p style="margin-top:0">' + t('pj_link_ask').replace('{n}', esc(jid)) + '</p>' +
        '<label class="field"><span>' + t('customer') + '</span>' +
          '<input class="inp" id="pjQ" type="text" autocomplete="off" ' +
            'placeholder="' + esc(t('customer_ph')) + '" data-change="pj-q"></label>' +
        '<div id="pjHits" class="mt"></div>' +
        '<div class="partner-note mt">' + t('pj_link_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>'
    });
    setTimeout(function () {
      var i = document.getElementById('pjQ');
      if (i) i.focus();
      pjPaint('');
    }, 60);
  },

  'job-link-do': function (el) {
    var cid = +el.getAttribute('data-id');
    var jid = OG.linkJob;
    Shop.write(
      function () { return Shop.linkJobCustomer(jid, cid); },
      function () { return null; },
      function () {
        closeModal();
        render();
        var c = DB.customer(cid);
        toast(t('pj_link'), (c ? c.name : '') + ' · ' + jid, 'ok', 3000);
      }
    );
  },

  'cu-merge': function (el) {
    var keepId = +el.getAttribute('data-id');
    var keep = DB.customer(keepId);
    if (!keep) return;
    OG.mergeKeep = keepId;
    openModal({
      title: t('cu_merge'), size: 'narrow',
      body: '<p style="margin-top:0">' + t('cu_merge_ask').replace('{n}', nm(keep.name)) + '</p>' +
        '<label class="field"><span>' + t('cu_merge_which') + '</span>' +
          '<input class="inp" id="cuMergeQ" type="text" autocomplete="off" ' +
            'placeholder="' + esc(t('customer_ph')) + '" data-change="cu-merge-q"></label>' +
        '<div id="cuMergeHits" class="mt"></div>' +
        '<div class="partner-note mt">' + t('cu_merge_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>'
    });
    setTimeout(function () {
      var i = document.getElementById('cuMergeQ');
      if (i) i.focus();
      mergePaint('');
    }, 60);
  },

  'cu-merge-do': function (el) {
    var loseId = +el.getAttribute('data-id');
    var keepId = OG.mergeKeep;
    var keep = DB.customer(keepId), lose = DB.customer(loseId);
    if (!keep || !lose) return;

    /* A confirm that NAMES what will move, because this cannot be undone with
       a button and "merge" on its own does not tell anybody what they are
       agreeing to. */
    openModal({
      title: t('cu_merge'), size: 'narrow',
      body: '<p style="margin-top:0">' +
          t('cu_merge_confirm').replace('{a}', nm(lose.name)).replace('{b}', nm(keep.name)) + '</p>' +
        '<ul class="ly-past">' +
          '<li>' + t('cu_merge_sales').replace('{n}', nf(lose.visits || 0)) + '</li>' +
          '<li>' + t('cu_merge_points')
            .replace('{a}', nf(keep.loyaltyPoints || 0))
            .replace('{b}', nf(lose.loyaltyPoints || 0))
            .replace('{c}', nf((keep.loyaltyPoints || 0) + (lose.loyaltyPoints || 0))) + '</li>' +
          '<li>' + t('cu_merge_archived').replace('{n}', nm(lose.name)) + '</li>' +
        '</ul>' +
        '<div class="partner-note mt">' + t('cu_merge_irreversible') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="cu-merge-go" data-id="' + loseId + '">' +
              t('cu_merge') + '</button>'
    });
  },

  'cu-merge-go': function (el) {
    var loseId = +el.getAttribute('data-id');
    var keepId = OG.mergeKeep;
    Shop.write(
      function () { return Shop.mergeCustomers(keepId, loseId); },
      function () { return null; },
      function (res) {
        closeModal();
        go('customers', null, keepId);
        var moved = (res && res.moved) || {};
        toast(t('cu_merge'),
          t('cu_merged').replace('{n}', String(moved.sales || 0)) +
            (res && res.pointsAfter != null ? ' · ' + nf(res.pointsAfter) + ' ' + t('points') : ''),
          'ok', 5000);
      }
    );
  },

  /* ---- attaching a customer to a sale already rung up --------------------
     Reuses the customer picker the till already has rather than inventing a
     second one. The rules — who may, and how long after — are the server's;
     this only asks the question. */
  'sale-attach': function (el) {
    var saleId = el.getAttribute('data-id');
    var sale = DB.sale(saleId);
    if (!sale) return;
    OG.saSaleId = saleId;
    openModal({
      title: t('sa_attach'), size: 'narrow',
      body: '<p style="margin-top:0">' + t('sa_ask').replace('{n}', esc(saleId)) + '</p>' +
        '<label class="field"><span>' + t('customer') + '</span>' +
          '<input class="inp" id="saQ" type="text" autocomplete="off" ' +
            'placeholder="' + esc(t('customer_ph')) + '" data-change="sa-q"></label>' +
        '<div id="saHits" class="mt"></div>' +
        '<div class="partner-note mt">' + t('sa_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>'
    });
    setTimeout(function () {
      var i = document.getElementById('saQ');
      if (i) i.focus();
      saPaint('');
    }, 60);
  },

  'sale-attach-do': function (el) {
    var saleId = el.getAttribute('data-sale');
    var cid = +el.getAttribute('data-id');
    var opId = 'attach-' + saleId + '-' + cid + '-' + Date.now();
    Shop.write(
      function () { return Shop.attachSaleCustomer(saleId, cid, opId); },
      function () { return null; },
      function (res) {
        closeModal();
        render();
        /* A PLAIN name, not nm(): toast() escapes its message, so markup
           passed in here reaches the screen as literal <bdi> tags. */
        toast(t('sa_attach'),
          ((res && res.customerName) || '') +
            (res && res.pointsEarned
              ? ' · +' + nf(res.pointsEarned) + ' ' + t('points')
              : ''),
          'ok', 4000);
      }
    );
  },

  /* ---- cashing in a full stamp card -------------------------------------
     Nothing fires automatically at ten. The owner decides what the card is
     worth — a free pair, a discount, early access to a drop — and the person
     at the counter records what was actually handed over. That is why this is
     a note rather than a menu: an enum here would be the list of rewards
     somebody thought of in one afternoon. */
  'ly-redeem': function (el) {
    var id = +el.getAttribute('data-id');
    var c = DB.customer(id);
    if (!c) return;
    openModal({
      title: t('ly_redeem'), size: 'narrow',
      body: '<p style="margin-top:0">' + t('ly_redeem_ask').replace('{n}', nm(c.name)) + '</p>' +
        '<label class="field"><span>' + t('ly_given') + '</span>' +
          '<input class="inp" id="lyNote" type="text" placeholder="' + esc(t('ly_given_ph')) + '"></label>' +
        '<div class="partner-note mt">' + t('ly_redeem_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="ly-redeem-do" data-id="' + id + '">' +
              t('ly_redeem') + '</button>',
      onOpen: function () {
        setTimeout(function () {
          var n = document.getElementById('lyNote');
          if (n) n.focus();
        }, 60);
      }
    });
  },

  'ly-redeem-do': function (el) {
    var id = +el.getAttribute('data-id');
    var note = ((document.getElementById('lyNote') || {}).value || '').trim();
    /* An opId, like every other write that gives something away: a till that
       loses wifi mid-request and retries must not cash the same card twice. */
    var opId = 'redeem-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    Shop.write(
      function () { return Shop.redeemCard(id, { note: note || null, opId: opId }); },
      function () { return null; },
      function (res) {
        closeModal();
        /* The card is derived, so nothing local to patch — re-ask the server
           for the count it now computes. */
        loadStampCard(id);
        var left = res && res.card ? res.card.stamps : 0;
        toast(t('ly_redeem'),
          t('ly_redeemed').replace('{n}', nf((res && res.stampsUsed) || 0)) +
            (left ? ' · ' + t('ly_carried').replace('{n}', nf(left)) : ''),
          'ok', 4000);
      }
    );
  },

  'cu-update': function (el) {
    var id = +el.getAttribute('data-id');
    var fields = {
      name: ((document.getElementById('cuName') || {}).value || '').trim(),
      phone: ((document.getElementById('cuPhone') || {}).value || '').trim(),
      city: ((document.getElementById('cuCity') || {}).value || '').trim(),
      address: ((document.getElementById('cuAddr') || {}).value || '').trim(),
      note: ((document.getElementById('cuNote') || {}).value || '').trim()
    };

    /* Dollars on screen, USD CENTS in the database — and BLANK stays blank.
       '' means no limit set and 0 means no credit at all, so an empty box
       must not become 0 on the way through. */
    var limitEl = document.getElementById('cuLimit');
    if (limitEl) {
      var raw = String(limitEl.value || '').trim();
      fields.credit_limit = raw === '' ? null : Math.round(Number(raw) * 100);
    }
    var ncEl = document.getElementById('cuNoCredit');
    if (ncEl) fields.no_credit = ncEl.value === '1' ? 1 : 0;
    if (!fields.name) {
      toast(t('cu_edit'), OG.lang === 'ar' ? 'اكتب الاسم' : 'Enter a name', 'err');
      return;
    }

    Shop.write(
      function () { return Shop.updateCustomer(id, fields); },
      function () {
        var c = DB.customer(id);
        if (c) {
          c.name = fields.name; c.phone = fields.phone; c.city = fields.city;
          c.address = fields.address; c.note = fields.note;
        }
        return { customer: c };
      },
      function (res) {
        closeModal();
        render();
        /* The same duplicate warning a create gets — see cu-save. Changing a
           number is exactly when two records get merged by accident. */
        var w = res && res.warning;
        if (w && w.code === 'phone_taken' && w.existing) {
          toast(t('cu_edit'),
            t(w.existing.archived ? 'cu_phone_taken_archived' : 'cu_phone_taken')
              .replace('{n}', w.existing.name || ''),
            'warn', 9000,
            { label: t('cu_view'),
              attrs: 'data-act="cu-open" data-id="' + (+w.existing.id) + '"' });
        } else {
          toast(t('cu_edit'), fields.name, 'ok', 2500);
        }
      }
    );
  },

  /* Archiving ONE person. It existed only as a bulk action, so putting one
     customer away meant ticking a box and using the selection bar — which is
     the tool for forty, not for one. */
  'cu-archive': function (el) {
    var id = +el.getAttribute('data-id');
    var c = DB.customer(id);
    if (!c) return;
    openModal({
      title: t('bk_archive'), size: 'narrow',
      body: '<p style="margin-top:0">' + t('cu_archive_ask').replace('{n}', nm(c.name)) + '</p>' +
            '<div class="partner-note">' + t('cu_archive_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="cu-archive-do" data-id="' + id + '">' +
              t('bk_archive') + '</button>'
    });
  },

  'cu-archive-do': function (el) {
    var id = +el.getAttribute('data-id');
    Shop.write(
      function () { return Shop.updateCustomer(id, { archived: 1 }); },
      function () { var c = DB.customer(id); if (c) c.archived = true; return { customer: c }; },
      function () {
        closeModal();
        /* Back to the list: the page you were reading is now about somebody
           the list no longer shows, and leaving it up invites a second click
           on a button that will not work. */
        go('customers', null, null);
        toast(t('bk_archive'), t('bk_archived'), 'ok', 2500);
      }
    );
  },
  whatsapp: function (el) { openWhatsapp(+el.getAttribute('data-id')); },
  'day-summary': function () { openDaySummary(); },
  /* One request, not twelve, and the old numbers are dimmed while it is in
     flight so a chip never shows yesterday's figure under today's label. */
  'dash-scope': function (el) {
    OG.dashScope = el.getAttribute('data-k');
    OG.dashLoading = true;
    render();
    Shop.reloadDashboard().then(function () {
      OG.dashLoading = false;
      if (OG.view === 'dashboard') render();
    }, function () {
      OG.dashLoading = false;
      if (OG.view === 'dashboard') render();
      toast(t('dash_title'), t('dash_unavailable'), 'err', 3000);
    });
  },

  'prod-sort': function (el) {
    var k = el.getAttribute('data-k');
    if (OG.prod.sort === k) OG.prod.dir *= -1; else { OG.prod.sort = k; OG.prod.dir = 1; }
    render();
  },
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
  'cust-size-clear': function () { OG.cust.size = ''; render(); },

  /* From a product's size straight to the people who wear it. Sets the same
     filter the chip clears, so what you arrive at is a state of the list
     rather than a one-off view you cannot get back to. */
  'cu-size': function (el) {
    closeDrawer();
    closeModal();
    OG.cust.size = el.getAttribute('data-size') || '';
    OG.cust.q = '';
    OG.cust.filter = 'all';
    go('customers', null, null);
  },
  reorder: function (el) { openReorder(+el.getAttribute('data-id')); },

  'po-create': function (el) {
    var pid = +el.getAttribute('data-id');
    var p = DB.product(pid);
    var lines = [];
    document.querySelectorAll('[data-po-qty][data-pid="' + pid + '"]').forEach(function (inp) {
      var qty = parseInt(inp.value, 10) || 0;
      if (qty > 0) lines.push({ productId: pid, size: inp.getAttribute('data-size'), qty: qty, cost: p.costPrice });
    });
    if (!lines.length) { toast(t('reorder'), t('po_need_qty'), 'warn'); return; }

    var supId = +(document.getElementById('poSupplier') || {}).value || DB.supplierFor(p).id;

    /* The server keys a line on its sku — which is what the shop reads off
       the box when the delivery arrives — so the product+size pair is
       resolved here rather than sent as two halves. */
    var srvLines = lines.map(function (l) {
      var v = DB.variants.filter(function (x) {
        return x.productId === l.productId && x.size === l.size;
      })[0];
      return v ? { sku: v.sku, qty: l.qty, unitCost: l.cost } : null;
    }).filter(Boolean);

    Shop.write(
      function () {
        return Shop.newPO({
          supplierId: supId, whId: DB.intakeWh, note: p.name, lines: srvLines
        }).then(function (r) {
          /* Raised and placed in one gesture, the way the screen presents it. */
          return Shop.sendPO(r.po.id).then(function (sent) { return sent; });
        });
      },
      function () { var local = DB.newPO(supId, lines, p.name); DB.sendPO(local); return local; },
      function (res) {
        /* The server hands out the real order number; the local one was a
           guess made before it answered. */
        var po = (res && res.po) ? DB.po(res.po.id) || res.po : res;
        closeModal();
        render();
        toast(po.id + ' → ' + DB.supplier(supId).name,
          DB.poPieces(po) + ' ' + t('pieces') + ' · ' + money(DB.poTotal(po)), 'ok', 5000, {
            label: t('po_whatsapp'),
            attrs: 'data-act="po-whatsapp" data-id="' + po.id + '"'
          });
      }
    );
  },

  /* Send the order to the supplier on WhatsApp — which is how these orders
     are actually placed here, not by email. */
  'po-whatsapp': function (el) {
    var po = DB.po(el.getAttribute('data-id'));
    if (!po) return;
    var sup = DB.supplier(po.supplierId);
    var body = po.lines.map(function (l) {
      var p = DB.product(l.productId);
      return '• ' + p.name + ' — ' + t('size') + ' ' + l.size + ' × ' + l.qty;
    }).join('\n');
    WA.compose({
      title: po.id + ' · ' + sup.name,
      to: sup.contact, name: sup.name, kind: 'purchase-order',
      text: 'مرحباً ' + sup.name + '،\n\nطلبية جديدة ' + po.id + ':\n\n' + body +
            '\n\nالإجمالي: ' + money(DB.poTotal(po)) + '\n— ' + CONFIG.SHOP_NAME,
      note: DB.poPieces(po) + ' ' + t('pieces') + ' · ' + money(DB.poTotal(po))
    });
  },

  'po-receive': function (el) {
    var po = DB.po(el.getAttribute('data-id'));
    if (!po || po.status === 'received') return;

    /* One call, not one per line. The server books every piece through the
       movement log AND moves the supplier balance in a single transaction,
       so a delivery either lands whole or not at all.

       This used to fire N parallel Shop.receive calls and then patch the
       order's own paperwork locally — which meant the stock persisted, the
       order status and the supplier balance did not, and a retry could book
       the same boxes twice. Calling both would now double the stock. */
    /* A hydrated line already carries its sku; a locally built one still has
       the product+size pair it was raised from. Both shapes resolve here so
       the label offer below works either way. */
    var lines = po.lines.map(function (l) {
      if (l.sku) return { sku: l.sku, qty: l.qty };
      var v = DB.variants.filter(function (x) {
        return x.productId === l.productId && x.size === l.size;
      })[0];
      return v ? { sku: v.sku, qty: l.qty } : null;
    }).filter(Boolean);

    Shop.write(
      function () { return Shop.receivePO(po.id); },
      function () { DB.receivePO(po); },
      function () {
        render();
        toast(po.id, DB.poPieces(po) + ' ' + t('pieces') + ' · ' + t('po_received_toast'), 'ok', 4000);

        /* Offer to print a label for every piece that just arrived — the
           `lines` list here is the exact same {sku, qty} breakdown Shop.receive
           was just called with, one entry per variant on the order. */
        if (allow('label.print') && typeof Labels !== 'undefined' && lines.length) {
          Labels.openPreviewModal(lines, Labels.lastChoice().preset, Labels.lastChoice().station);
        }
      }
    );
  },
  'labels-for': function (el) { openLabelSheet(+el.getAttribute('data-id')); },

  'variant-attach-save': function (el) {
    var sku = el.getAttribute('data-sku');
    var code = el.getAttribute('data-code');
    var digits = String(code || '').replace(/\D/g, '');
    /* A real EAN-13 goes on `barcode`; a shorter numeric code (what a
       thermal label's Code128 actually carries) goes on `labelCode`.
       Anything else still goes on `barcode` — a supplier code that isn't a
       clean 13-digit EAN is still the code printed on the box. */
    var isLabelCode = digits.length === code.length && digits.length > 0 && digits.length <= 8;
    var patch = isLabelCode ? { labelCode: code } : { barcode: code };

    function apply() {
      var v = DB.variantBySku(sku);
      if (v) { if (patch.barcode) v.barcode = patch.barcode; if (patch.labelCode) v.labelCode = patch.labelCode; }
      closeModal();
      toast(t('lbl_attach_code'), (v && DB.product(v.productId) || {}).name || sku, 'ok', 3000);
    }

    if (typeof Auth === 'undefined') { apply(); return; }
    API.patch('/api/variants/' + encodeURIComponent(sku), patch)
      .then(function (res) {
        var v = DB.variantBySku(sku);
        if (v && res.variant) { v.barcode = res.variant.barcode; v.labelCode = res.variant.label_code; }
        closeModal();
        toast(t('lbl_attach_code'), res.variant ? res.variant.name : sku, 'ok', 3000);
      })
      .catch(function (err) { toast(t('lbl_attach_code'), API.friendly(err), 'err', 6000); });
  },
  'open-job': function (el) { openJobDrawer(el.getAttribute('data-jid')); },

  'lb-tpl': function (el) {
    OG.lb.template = el.getAttribute('data-k');
    /* switching template re-enables its own fields so nothing looks broken */
    var tpl = LABEL_TEMPLATES[OG.lb.template];
    OG.lb.barcode = !!tpl.barcode; OG.lb.qr = !!tpl.qr;
    OG.lb.price = !!tpl.price; OG.lb.size2 = !!tpl.size;
    OG.lb.shelf = !!tpl.shelf; OG.lb.logo = !!tpl.logo;
    repaintLabels();
  },
  'lb-size': function (el) { OG.lb.size = el.getAttribute('data-k'); repaintLabels(); },

  'rc-width': function (el) {
    OG.rc.width = el.getAttribute('data-k');
    /* Re-inject immediately rather than at the next print. If the rule only
       updated when a receipt was opened, a cashier could change the paper
       here, print from a screen still holding the old @page, and get an 80mm
       layout on a 58mm roll with the right-hand column shaved off. */
    setReceiptPageSize();
    if (OG.view === 'settings') render();
  },
  'lb-mode': function (el) {
    OG.lb.mode = el.getAttribute('data-k');
    if (OG.view === 'settings') { render(); } else { repaintLabels(); }
  },

  /* Network vs USB changes which fields the card even shows (host/port vs
     a printer share), not just which chip is lit — so unlike rc-cut this
     needs a real re-render, not just a class toggle. Pending only: applied
     for real when rc-save-config PUTs it, same as every other field on
     this card. */
  'rc-transport': function (el) {
    CONFIG.RECEIPT_TRANSPORT = el.getAttribute('data-k');
    if (OG.view === 'settings') render();
  },

  /* Just flips which chip is lit — rc-save-config reads the choice straight
     back off this element when the card is actually saved. */
  'rc-cut': function (el) {
    var row = document.getElementById('rcCutMode');
    if (!row) return;
    row.setAttribute('data-v', el.getAttribute('data-k'));
    Array.prototype.forEach.call(row.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c === el);
    });
  },

  /* Same shape as rc-cut: flips which chip is lit and leaves the value on the
     row for rc-save-config to read back. No re-render — nothing else on the
     card depends on which darkness is picked. */
  'rc-ink': function (el) {
    var row = document.getElementById('rcInk');
    if (!row) return;
    row.setAttribute('data-v', el.getAttribute('data-k'));
    Array.prototype.forEach.call(row.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c === el);
    });
  },

  'rc-save-config': function (el) {
    if (!allow('config.write') || typeof Auth === 'undefined') return;
    var transportEl = document.getElementById('rcTransport');
    var transport = (transportEl && transportEl.getAttribute('data-v')) || 'tcp';
    var updates = {
      'receipt.transport':    transport,
      'shop.branch_name':     (document.getElementById('rcBranch') || {}).value || '',
      'shop.phone':           (document.getElementById('rcPhone') || {}).value || '',
      'receipt.instagram':    (document.getElementById('rcInstagram') || {}).value || '',
      'receipt.telegram':     (document.getElementById('rcTelegram') || {}).value || '',
      'receipt.maps_url':     (document.getElementById('rcMapsUrl') || {}).value || '',
      'receipt.auto_print':   (document.getElementById('rcAutoPrint') || {}).checked ? '1' : '0',
      'receipt.confirm_print': (document.getElementById('rcConfirmPrint') || {}).checked ? '1' : '0',
      'receipt.copies':       (document.getElementById('rcCopies') || {}).value || '2',
      'receipt.cut_mode':     ((document.getElementById('rcCutMode') || {}).getAttribute &&
                                document.getElementById('rcCutMode').getAttribute('data-v')) || 'partial',
      'receipt.ink':          ((document.getElementById('rcInk') || {}).getAttribute &&
                                document.getElementById('rcInk').getAttribute('data-v')) || 'dark',
      'receipt.show_barcode': (document.getElementById('rcShowBarcode') || {}).checked ? '1' : '0',
      'receipt.show_loyalty': (document.getElementById('rcShowLoyalty') || {}).checked ? '1' : '0',
      'receipt.footer_ar':    (document.getElementById('rcFooterAr') || {}).value || '',
      'receipt.footer_en':    (document.getElementById('rcFooterEn') || {}).value || '',
      'receipt.policy_ar':    (document.getElementById('rcPolicyAr') || {}).value || '',
      'receipt.policy_en':    (document.getElementById('rcPolicyEn') || {}).value || '',
      /* Days on screen, hours in the database — the field is labelled in days
         because that is how a shop owner thinks about an exchange window, and
         stored in hours to match its sibling receipt.exchange_hours. */
      'receipt.gift_exchange_hours': String(giftDays((document.getElementById('rcGiftDays') || {}).value) * 24),
      'receipt.gift_policy_ar': (document.getElementById('rcGiftPolicyAr') || {}).value || '',
      'receipt.gift_policy_en': (document.getElementById('rcGiftPolicyEn') || {}).value || ''
    };
    /* Only the fields for the transport actually showing are saved — the
       other transport's settings stay whatever they were on the server,
       so switching back later doesn't come back to a blanked-out host or
       share path. */
    if (transport === 'usb') {
      updates['receipt.printer_share'] = (document.getElementById('rcShare') || {}).value || '';
    } else {
      updates['receipt.printer_host'] = (document.getElementById('rcHost') || {}).value || '';
      updates['receipt.printer_port'] = (document.getElementById('rcPort') || {}).value || '9100';
    }
    el.disabled = true;
    API.put('/api/config', { updates: updates })
      .then(function (res) {
        if (typeof DB !== 'undefined' && DB.hydrate) DB.hydrate({ config: res.config });
        toast(t('rc3_title'), t('rc3_saved'), 'ok', 3000);
        if (OG.view === 'settings') render();
      })
      .catch(function (err) {
        el.disabled = false;
        toast(t('rc3_title'), API.friendly(err), 'err', 6000);
      });
  },

  'lbl-save-config': function (el) {
    if (!allow('config.write') || typeof Auth === 'undefined') return;
    var updates = {
      'label.transport':    (document.getElementById('lblTransport') || {}).value || 'agent',
      'label.printer_host': (document.getElementById('lblHost') || {}).value || '',
      'label.density':      (document.getElementById('lblDensity') || {}).value || '8',
      'label.gap_mm':       (document.getElementById('lblGap') || {}).value || '2'
    };
    el.disabled = true;
    API.put('/api/config', { updates: updates })
      .then(function (res) {
        if (typeof DB !== 'undefined' && DB.hydrate) DB.hydrate({ config: res.config });
        toast(t('lbl_title'), t('lbl_saved'), 'ok', 3000);
        if (OG.view === 'settings') render();
      })
      .catch(function (err) {
        el.disabled = false;
        toast(t('lbl_title'), API.friendly(err), 'err', 6000);
      });
  },

  /* One label, printed now, so the roll and the driver can be proved before
     a hundred stickers are committed to it. */
  'hw-test-label': function () {
    var v = DB.variants.filter(function (x) { return x.qty > 0; })[0] || DB.variants[0];
    OG.lb.pids = null;
    OG.lb.pid = v.productId;
    openLabelSheet(v.productId);
  },
  'hw-calibrate': function () { openCalibration(); },
  'lb-sym':  function (el) { OG.lb.sym  = el.getAttribute('data-k'); repaintLabels(); },
  'lb-toggle': function (el) { var k = el.getAttribute('data-k'); OG.lb[k] = !OG.lb[k]; repaintLabels(); },

  /* ---- the order handshake, OG's actions -------------------------------- */

  /* Show exactly what crosses the boundary before it crosses. The printer is
     another company: an order they cannot fulfil costs both sides a day, so
     the confirm step is a real review, not an "are you sure". */
  'or-send': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job) return;
    var why = DB.canSendOrder(job);
    if (why) { toast(t('or_cannot'), t('or_why_' + (why === 'tbc' ? 'tbc' : why === 'already-sent' ? 'sent' : 'accepted')), 'err'); return; }

    var pv = DB.partnerView(job);
    var body = '<div class="ord-review">' +
      '<div class="ord-rv-row"><span>' + t('design_note') + '</span><b>' + esc(job.design) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('total_pieces') + '</span><b>' + job.qty + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('size') + '</span><b>' +
        Object.keys(pv.sizes || {}).map(function (k) { return k + ' ×' + pv.sizes[k]; }).join(' · ') + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('deadline') + '</span><b>' + fmtDate(job.deadline) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('priority') + '</span><b>' + t(job.priority) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('yl_payout') + '</span><b>' + money(job.cost) + '</b></div>' +
    '</div>' +
    '<div class="partner-note mt">' + t('or_send_hint') + '</div>';

    openModal({
      title: t('or_send_title') + ' · ' + job.id,
      size: 'narrow',
      body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="or-send-go" data-id="' + job.id + '">' + t('or_send') + '</button>'
    });
  },

  'or-send-go': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job || !DB.sendOrder(job)) return;
    closeModal();
    closeDrawer();
    /* The toast carries the WhatsApp handoff rather than a second modal: most
       of the time the in-app send is enough, and the ones who also want to
       message have it one tap away without being asked every single time. */
    toast(job.id, t('or_sent_ok'), 'ok', 6000,
          { label: t('or_wa'), attrs: 'data-act="or-wa" data-id="' + job.id + '"' });
    Notify.refresh();
    render();
  },

  /* Opens WhatsApp with the order written out. wa.me hands off — it cannot
     send on the user's behalf, and the wording never claims it did. */
  'or-wa': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job) return;
    var sizes = Object.keys(job.sizes || {}).map(function (k) { return k + '×' + job.sizes[k]; }).join(' · ');
    var text = 'طلب طباعة جديد · ' + job.id + '\n\n' +
      job.design + '\n' +
      'العدد: ' + job.qty + ' قطعة\n' +
      (sizes ? 'القياسات: ' + sizes + '\n' : '') +
      'موعد التسليم: ' + fmtDate(job.deadline) + '\n' +
      (job.priority === 'urgent' ? '⚡ مستعجل\n' : '') +
      'المستحق: ' + money(job.cost) + '\n\n' +
      '— ' + CONFIG.SHOP_NAME;
    WA.compose({
      to: '+963 932 887 190',            /* Yalla Wear, from the supplier list */
      name: CONFIG.PRINT_PARTNER,
      kind: 'order',
      title: t('or_wa_title') + ' · ' + job.id,
      text: text
    });
  },

  'wh-tab': function (el) {
    OG.wh.tab = el.getAttribute('data-tab');
    /* The wants list is fetched, not hydrated — drop the cached copy on the
       way in so opening the tab shows what is true now rather than what was
       true when it was last opened. */
    if (OG.wh.tab === 'wants') wantRows = null;
    render();
  },

  /* "We came back to them." Never deletes the row — that the shop kept its
     word is the half worth keeping. */
  'wa-close': function (el) {
    var id = +el.getAttribute('data-id');
    Shop.closeWant(id, null)
      .then(function () {
        wantRows = null;
        render();
        toast(t('wa_wants'), t('wa_told'), 'ok', 2500);
      })
      .catch(function (err) { toast(t('wa_wants'), API.friendly(err), 'err', 5000); });
  },

  /* The shortcuts on the warehouse home. Same as wh-tab, but it has to travel
     to the screen first — wh-tab alone would set the tab and re-render the
     home he is already standing on. */
  'home-wh': function (el) {
    OG.wh.tab = el.getAttribute('data-tab');
    go('warehouse');
  },
  'wh-place': function (el) { OG.wh.place = el.getAttribute('data-w'); render(); },

  /* One tap on a suggested move: carry it out of the back and onto the wall. */
  'wh-move-now': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    var n = parseInt(el.getAttribute('data-n'), 10) || 1;
    if (!v) return;

    /* Refused here rather than sent and refused there, so the message names
       the place instead of quoting a server error at a warehouse worker. */
    var have = DB.stockAt(v, DB.intakeWh);
    if (have <= 0) { toast(t('wh_none_here'), '', 'err'); return; }
    var want = Math.min(n, have);

    var p = DB.product(v.productId);
    Shop.write(
      function () { return Shop.transfer(v.sku, DB.intakeWh, DB.defaultWh, want, t('wh_move_done')); },
      function () { DB.transfer(v, DB.intakeWh, DB.defaultWh, want, t('admin')); },
      function () {
        toast(t('wh_move_done'),
              p.name + ' · ' + t('size') + ' ' + v.size + ' — ' + want + ' ' + t('pieces'),
              'ok');
        render();
      }
    );
  },

  /* Per-product transfer: choose a size, a direction and a quantity. */
  'wh-transfer': function (el) { openTransfer(+el.getAttribute('data-id')); },

  'wh-transfer-go': function () {
    var sku  = document.getElementById('trSku');
    var from = document.getElementById('trFrom');
    var to   = document.getElementById('trTo');
    var qty  = document.getElementById('trQty');
    if (!sku || !from || !to || !qty) return;

    if (from.value === to.value) { toast(t('wh_transfer'), t('wh_from') + ' = ' + t('wh_to'), 'err'); return; }
    var v = DB.variantBySku(sku.value);
    if (!v) return;

    var f = from.value, tgt = to.value;
    var want = Math.min(parseInt(qty.value, 10) || 0, DB.stockAt(v, f));
    if (want <= 0) { toast(t('wh_transfer'), t('out_of_stock'), 'err'); return; }

    var p = DB.product(v.productId);
    Shop.write(
      function () { return Shop.transfer(v.sku, f, tgt, want, t('wh_transfer')); },
      function () { DB.transfer(v, f, tgt, want, t('admin')); },
      function () {
        closeModal();
        toast(t('wh_move_done'),
              p.name + ' · ' + t('size') + ' ' + v.size + ' — ' + want + ' ' + t('pieces') + ' · ' +
                DB.whName(f, OG.lang === 'ar') + ' → ' + DB.whName(tgt, OG.lang === 'ar'),
              'ok');
        render();
      }
    );
  },
  /* Opens the real file picker. This used to pick a random colour from a
     palette and toast "Image uploaded", which is why choosing a picture
     appeared to fail — nothing was ever read from disk. */
  'wh-image': function () {
    var input = document.getElementById('whFile');
    if (input) input.click();
  },

  'wh-image-clear': function () {
    OG.wh.imgSrc = null;
    OG.wh.img = null;
    render();
  },

  'wh-labels': function () { openLabelSheet(null); },

  'cu-new': function (el) {
    openNewCustomer(el.getAttribute('data-q') || '', null);
  },

  'cu-save': function () {
    var name = ((document.getElementById('cuName') || {}).value || '').trim();
    var phone = ((document.getElementById('cuPhone') || {}).value || '').trim();
    var city = ((document.getElementById('cuCity') || {}).value || '').trim();

    if (!name) {
      toast(t('cu_new'), OG.lang === 'ar' ? 'اكتب الاسم' : 'Enter a name', 'err');
      return;
    }

    /* Same name AND same phone is a duplicate; same name alone is two people
       called Ahmad, which in Aleppo is most of them. Archived people are
       left to the server's phone check below — re-adding somebody who was
       archived should warn AND save, not be silently swallowed here. */
    var dupe = DB.customers.filter(function (c) {
      return !c.archived && c.name.toLowerCase() === name.toLowerCase() &&
             (!phone || DB.normPhone(c.phone) === DB.normPhone(phone));
    })[0];
    if (dupe) {
      closeModal();
      toast(t('cu_new'), t('cu_exists') + ' · ' + esc(dupe.name), 'warn', 5000);
      if (OG.cuOnCreated) OG.cuOnCreated(dupe);
      OG.cuOnCreated = null;
      return;
    }

    var after = OG.cuOnCreated;
    OG.cuOnCreated = null;

    Shop.write(
      function () {
        return Shop.newCustomer({ name: name, phone: phone, city: city, source: 'in-store' });
      },
      function () {
        /* Demo mode only. Nothing is saved, so the id just has to be unique
           within this page's lifetime. */
        var c = {
          id: DB.customers.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1,
          name: name, phone: phone, city: city, source: 'in-store', address: '', note: '',
          loyaltyPoints: 0, spentSyp: 0, spentUsd: 0, spentUsdEquiv: 0,
          debtSyp: 0, debtUsd: 0, openDebts: 0, visits: 0, sizes: [],
          createdAt: new Date(), lastPurchaseDate: null,
          archived: false, history: []
        };
        DB.customers.push(c);
        return { customer: c };
      },
      function (res) {
        closeModal();
        /* Re-found by id after the reload rather than kept from the response:
           in live mode the object in DB.customers is a fresh one, and handing
           the caller the stale copy is how a till ends up holding a customer
           the rest of the app cannot see. */
        var made = res && res.customer;
        var c = made ? (DB.customer(made.id) || made) : null;
        render();
        if (!c) return;

        /* The creation SUCCEEDED and the customer is already on screen — this
           is the success path, not an error path. A duplicate phone is only a
           remark on top of it: two people genuinely share a number (a
           household, a shop landline), so name whoever had it first, say when
           that person is archived, and offer to open them, because deciding
           whether this is really a duplicate is the whole point of telling
           anybody. Nine seconds, because it is a sentence with a name in it. */
        var w = res && res.warning;
        if (w && w.code === 'phone_taken' && w.existing) {
          toast(t('cu_new'),
            t(w.existing.archived ? 'cu_phone_taken_archived' : 'cu_phone_taken')
              .replace('{n}', w.existing.name || ''),
            'warn', 9000,
            { label: t('cu_view'),
              attrs: 'data-act="cu-open" data-id="' + (+w.existing.id) + '"' });
        } else {
          toast(t('cu_new'), c.name + (c.phone ? ' · ' + c.phone : ''), 'ok', 3500);
        }
        if (after) after(c);
      }
    );
  },
  /* Actually creates the product now. It used to toast and throw the form
     away, which meant a picture the user had just chosen vanished with it —
     the same frustration as the upload not working. */
  'wh-save': function () {
    var name = (document.getElementById('whName') || {}).value || OG.wh.name;
    var pieces = Object.keys(OG.wh.sizes).reduce(function (a, k) { return a + (Number(OG.wh.sizes[k]) || 0); }, 0);
    if (!name) { toast(t('product_name'), OG.lang === 'ar' ? 'اكتب اسم المنتج' : 'Enter a product name', 'err'); return; }
    if (!pieces) { toast(t('size_matrix'), OG.lang === 'ar' ? 'أدخل الكميات' : 'Enter quantities per size', 'err'); return; }

    /* Stop a second SKU for a shoe already in the catalogue — unless he has
       looked at the match and said it really is a different product. */
    var dupes = DB.similarProducts(name);
    if (dupes.length && !OG.wh.dupeOk) { openDuplicateGuard(name, dupes); return; }
    OG.wh.dupeOk = false;

    var cost = Number((document.getElementById('whCost') || {}).value) || 0;
    var price = Number((document.getElementById('whPrice') || {}).value) || 0;

    /* Read NOW, not inside done() — done() runs after render() has rebuilt
       the form and cleared OG.wh, so by then both selects are gone.
       shelfId is ignored without stock.move: the picker is not drawn for
       that account, and assign-shelf would refuse it anyway. */
    var whId = whAddWh();
    var shelfId = (allow('stock.move') && OG.wh.shelfId) ? Number(OG.wh.shelfId) : null;
    var shelfCode = shelfId ? whShelfCode() : '';
    var sizes = OG.wh.sizes;
    var skus = Object.keys(sizes).filter(function (k) { return sizes[k]; }).length;
    var imgSrc = OG.wh.imgSrc, bg = OG.wh.img;

    /* A photo has nowhere to go on the server yet — the products table stores
       a colour block, which is what every screen draws. Said out loud rather
       than dropped, because he just chose the file and would otherwise watch
       it disappear with no explanation. */
    if (imgSrc && Shop.live()) {
      toast(t('save_product'),
            OG.lang === 'ar'
              ? 'الصورة لا تُحفظ بعد على الخادم — سيُستخدم المربّع اللوني.'
              : 'Photos are not stored on the server yet — the colour block is used.',
            'warn', 6000);
    }

    Shop.write(
      function () {
        return Shop.newProduct({
          name: name,
          type: OG.wh.type,
          /* Entered in the shop's base currency. Whole units for SYP, which
             is what minor_exp 0 means — the number typed is the number
             stored. */
          currency: CONFIG.BASE_CURRENCY,
          costPrice: cost,
          sellingPrice: price,
          imageBg: bg || undefined,
          sizes: Object.keys(sizes)
            .filter(function (s) { return Number(sizes[s]) > 0; })
            .map(function (s) { return { size: s, qty: Number(sizes[s]) }; }),
          /* Opening stock arrives where the person booking it in says it
             does. This was hard-coded to the back door, underneath a text
             box reading "SHELF / BOX" that nothing ever read. */
          whId: whId
        });
      },
      function () {
        return DB.newProduct({
          name: name, type: OG.wh.type, cost: cost, price: price,
          sizes: sizes, imgSrc: imgSrc, bg: bg
        });
      },
      function (res) {
        var id = res && (res.productId !== undefined ? res.productId : res.id);

        /* createWithVariants answers { productId, variants:[{sku,size,barcode}] },
           so the SKUs the server has just minted are already here — nothing
           has to re-hydrate the catalogue and guess which rows are new. Only
           sizes with a quantity are in it, which matters: a size with no
           opening stock has no stock row, and assign-shelf refuses one with
           `no_stock`. */
        var made = (res && res.variants) || [];
        var act = id ? { label: t('view_all'),
                         attrs: 'data-act="open-new-product" data-id="' + id + '"' } : null;
        var line = name + ' · ' + pieces + ' pcs · ' + skus + ' SKU';

        OG.wh.sizes = {}; OG.wh.name = ''; OG.wh.img = null; OG.wh.imgSrc = null;
        /* The room STAYS — the next box off the same delivery goes to the
           same place. The shelf does not: it now belongs to the product just
           created, so offering it again would create the next product and
           then refuse it with `wrong_shelf`. */
        OG.wh.shelfId = '';
        render();

        /* Take him to the thing he just made — a toast alone leaves you
           wondering whether it worked. */
        if (!(shelfId && made.length)) {
          toast(t('save_product'), line, 'ok', 5000, act);
          return;
        }

        whAssignAll(made, whId, shelfId, function (failed, firstErr) {
          /* That shelf has just adopted a product; a cached list still
             showing it free would offer it to the next one. */
          if (typeof ShelfMap !== 'undefined') ShelfMap.invalidate();

          if (!failed.length) {
            toast(t('save_product'), line + ' · ' + shelfCode, 'ok', 5000, act);
            return;
          }
          /* The product exists and the stock is in — only the shelf pointer
             is missing, and only for these sizes. A warning rather than an
             error for exactly that reason, naming the sizes so they can be
             put right from the map with the scanner. */
          toast(t('save_product'),
                line + ' — ' +
                t('wh_shelf_partial').replace('{n}', failed.length).replace('{m}', made.length) +
                ' (' + failed.join(', ') + ') ' + firstErr,
                'warn', 9000, act);
        });
      }
    );
  },

  /* "It really is a different product" — remembered for exactly one save, so
     the guard is back on for the next one. */
  'dup-anyway': function () {
    OG.wh.dupeOk = true;
    closeModal();
    ACTIONS['wh-save']();
  },

  'dup-open': function (el) {
    closeModal();
    go('products', function () { openProductDrawer(+el.getAttribute('data-id')); });
  },

  'open-new-product': function (el) {
    var id = +el.getAttribute('data-id');
    go('products', function () { openProductDrawer(id); });
  },

  'rep-tab': function (el) { OG.rep.tab = el.getAttribute('data-tab'); render(); },

  /* One scan entry point, used by the topbar, the tab bar, POS and the
     product pages, so the camera behaves identically everywhere — including
     the till rule: a hit while POS is open lands in the cart, not a sheet. */
  'scan-open': function () {
    closeModal();
    Scan.open({ onHit: function (code) { handleScan(code); } });
  },

  'scan-to-pos': function (el) {
    var code = el.getAttribute('data-code');
    var n = scanQty();
    closeModal();
    go('pos', function () {
      for (var i = 0; i < n; i++) POS.scanBarcode(code, i > 0);
    });
  },

  /* ---- putting stock away and taking it out, straight off a scan --------
     Both go through DB.moveStock, so they land in the same movement log as a
     sale, a delivery or a transfer. There is exactly one way stock changes in
     this system and a barcode scanner does not get to be a second one. */
  'sc-qty': function (el) {
    var box = document.getElementById('scQty');
    if (!box) return;
    var d = parseInt(el.getAttribute('data-d'), 10) || 0;
    box.value = Math.max(1, (parseInt(box.value, 10) || 1) + d);
  },

  'sc-in': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    if (!v) return;
    var n = scanQty(), wh = scanPlace();
    var p = DB.product(v.productId);

    Shop.write(
      function () { return Shop.receive(v.sku, wh, n, t('sc_in_note')); },
      function () {
        DB.moveStock(v, wh, n, {
          type: 'received', note: t('sc_in_note'), user: t('admin')
        });
      },
      function () {
        closeModal();
        toast(t('sc_checked_in'),
              p.name + ' · ' + v.size + ' · +' + n + ' → ' + DB.whName(wh, OG.lang === 'ar'),
              'ok');
        render();
      }
    );
  },

  'sc-out': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    if (!v) return;
    var n = scanQty(), wh = scanPlace();
    var have = DB.stockAt(v, wh);
    if (have <= 0) {
      /* Refuse rather than clamp silently. Taking out what is not there is
         how a stock figure quietly stops matching the shelf. */
      toast(t('sc_cannot_out'), t('wh_none_here') + ' · ' + DB.whName(wh, OG.lang === 'ar'), 'err');
      return;
    }
    var moved = Math.min(n, have);
    var p = DB.product(v.productId);

    Shop.write(
      /* A removal that is not a sale. writeOff is the server's name for it —
         stock leaving without an invoice — and it lands in the same movement
         log, which is the point: anything that changes a count has to be
         explainable afterwards. */
      function () { return Shop.writeOff(v.sku, wh, moved, t('sc_out_note')); },
      function () {
        DB.moveStock(v, wh, -moved, {
          type: 'transfer', note: t('sc_out_note'), user: t('admin')
        });
      },
      function () {
        closeModal();
        toast(t('sc_checked_out'),
              p.name + ' · ' + v.size + ' · −' + moved + ' ' + t('wh_from') + ' ' +
                DB.whName(wh, OG.lang === 'ar') +
                (moved < n ? ' (' + t('sc_only_had') + ' ' + moved + ')' : ''),
              'ok');
        render();
      }
    );
  },

  'more-sheet': function () { openMoreSheet(); },
  'more-go': function (el) { closeModal(); go(el.getAttribute('data-view')); },

  'pr-tab': function (el) {
    OG.pr = OG.pr || {};
    OG.pr.tab = el.getAttribute('data-tab');
    render();
  },

  'og-open-inv': function (el) { openPartnerInvoice(el.getAttribute('data-id')); },

  /* OG settles the bill. Both portals read the same invoice, so paying it
     here shows it paid there — the row is one row, not a copy.

     Money leaving the shop, so it goes server-first rather than optimistic.
     It used to write the payment into memory and then post a message, and
     the reload that message triggered wiped the payment about a second
     later: the bill showed itself unpaid again with the cash gone. */
  'og-pay-inv': function (el) {
    /* The same amount-and-method sheet the printer uses to record money
       received, so both halves of the handshake look alike. It used to pay
       the whole balance in cash on one tap with no opId — a second tap on
       bad wifi was a second payment. The server posts the thread line and
       tells Yalla Wear; they confirm it from their side. */
    if (typeof YLINV !== 'undefined') YLINV.pay(el.getAttribute('data-id'));
  },

  /* ---- a print job raised by hand ---- */
  'pj-new': function () { openNewJob(); },
  'pj-kind': function (el) {
    pjCollect();
    OG.pj.kind = el.getAttribute('data-k') === 'bulk' ? 'bulk' : 'kit';
    if (OG.pj.kind === 'kit' && !OG.pj.lines.length) OG.pj.lines.push(pjBlankLine());
    pjRepaint();
  },
  'pj-line-add': function () {
    pjCollect();
    var lastLine = OG.pj.lines[OG.pj.lines.length - 1];
    var fresh = pjBlankLine();
    /* A squad wears one kit: the next row starts on the club and size the
       last one used, so twelve rows is twelve names, not twelve menus. */
    if (lastLine) { fresh.club = lastLine.club; fresh.size = lastLine.size; }
    OG.pj.lines.push(fresh);
    pjRepaint();
    var inputs = document.querySelectorAll('[data-pj-line="print"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  },
  'pj-line-del': function (el) {
    pjCollect();
    OG.pj.lines.splice(+el.getAttribute('data-i'), 1);
    if (!OG.pj.lines.length) OG.pj.lines.push(pjBlankLine());
    pjRepaint();
  },
  'pj-save': function () {
    var f = pjCollect();
    if (!f.customer.trim()) { toast(t('pj_new'), t('pj_need_customer'), 'warn'); return; }
    if (!f.design.trim()) { toast(t('pj_new'), t('pj_need_design'), 'warn'); return; }
    var lines = null, qty = f.qty;
    if (f.kind === 'kit') {
      lines = f.lines.filter(function (l) { return l.club && (Number(l.qty) || 0) > 0; }).map(function (l) {
        var club = DB.clubs[l.club] || [l.club, l.club];
        return DB.newKitLine({
          club: club[0], clubAr: club[1],
          print: String(l.print || '').toUpperCase().trim() || null,
          number: (l.number !== '' && isFinite(+l.number)) ? +l.number : null,
          size: String(l.size || 'M'), qty: Math.max(1, Math.round(Number(l.qty) || 1)),
          price: f.unitCost
        });
      });
      if (!lines.length) { toast(t('pj_new'), t('pj_need_line'), 'warn'); return; }
      qty = lines.reduce(function (a, l) { return a + l.qty; }, 0);
    } else if (!(qty > 0)) { toast(t('pj_new'), t('pj_need_line'), 'warn'); return; }

    var when = f.deadline ? new Date(f.deadline + 'T12:00:00') : new Date(Date.now() + 5 * 86400000);
    DB.newPrintJob({
      customer: f.customer.trim(), phone: f.phone.trim() || '—', design: f.design.trim(),
      lines: lines, qty: qty, priority: f.priority, deadline: when,
      price: qty * f.unitPrice, cost: qty * (f.unitCost || 0), currency: f.currency,
      source: 'manual', autoSend: true,
      onSaved: function (saved) {
        if (typeof Notify !== 'undefined') Notify.refresh();
        if (saved && saved.order_state === 'pending') {
          toast(t('pj_new'), saved.id + ' · ' + t('pj_sent'), 'ok', 4500);
        } else {
          toast(t('pj_new'), (saved ? saved.id + ' · ' : '') +
                t('pr_draft_tbc').replace('{n}', saved ? saved.tbc : '?'), 'warn', 6500);
        }
      }
    });
    closeModal();
    OG.pj = null;
    render();
  },

  /* ---- the review ---- */
  'job-rate': function (el) {
    var jid = el.getAttribute('data-jid'), n = +el.getAttribute('data-n');
    OG.rv = { jobId: jid, rating: n };
    /* Repaint the five stars in place — a render() would throw away the
       sentence being typed under them. */
    var host = el.closest('.rv-stars');
    if (host) host.querySelectorAll('.rv-star').forEach(function (s, i) {
      s.classList.toggle('on', i < n);
    });
  },
  'job-review-save': function (el) {
    var id = el.getAttribute('data-id');
    var j = DB.job(id);
    if (!j) return;
    var rating = (OG.rv && OG.rv.jobId === id) ? OG.rv.rating : (j.review ? j.review.rating : 0);
    if (!rating) { toast(t('rv_title'), t('rv_need_stars'), 'warn'); return; }
    var box = document.getElementById('rvText');
    var feedback = box ? box.value.trim() : '';
    Shop.write(
      function () { return Shop.reviewJob(id, { rating: rating, feedback: feedback || null }); },
      null,
      function () {
        OG.rv = null;
        toast(id, t('rv_saved'), 'ok', 3200);
        if (typeof Notify !== 'undefined') Notify.refresh();
        openJobDrawer(id);
      }
    );
  },

  /* Fill in the names Yalla Wear is waiting on. Reads the inputs already in
     the drawer rather than opening a second form on top of the first. */
  'og-confirm-names': function (el) {
    var id = el.getAttribute('data-id');
    var job = DB.job(id);
    if (!job) return;
    var before = DB.tbcCount(job);

    document.querySelectorAll('[data-og-line][data-jid="' + id + '"]').forEach(function (inp) {
      var l = DB.line(id, inp.getAttribute('data-lid'));
      if (!l) return;
      var f = inp.getAttribute('data-og-line');
      if (f === 'print') l.print = (inp.value || '').toUpperCase().trim() || null;
      if (f === 'number') l.number = inp.value === '' ? null : +inp.value;
    });

    var after = DB.tbcCount(job);
    if (after === before) { toast(id, t('og_nothing_changed'), 'warn'); return; }

    /* Send them. Without this the names went onto the local copy only, and
       the reload that the message below triggers put every TBC straight
       back — the shop typed them in, watched them save, and found the job
       still unprintable. The id carries the 'L' prefix the browser adds. */
    DB.saveLines(job);

    DB.postMessage({ jobId: id, from: 'og', kind: 'reply',
      text: t('og_names_msg') + ' ' + (before - after) + ' — ' +
            (after ? after + ' ' + t('yl_tbc_pieces') : t('og_all_confirmed')) });

    closeDrawer();
    toast(id, after ? (after + ' ' + t('yl_tbc') + ' ' + t('yl_lines')) : t('og_names_saved'),
          after ? 'warn' : 'ok', 3600);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
  },

  'og-nudge': function (el) {
    var id = el.getAttribute('data-id');
    if (!DB.job(id)) return;
    openModal({
      title: t('og_nudge') + ' · ' + id,
      body: '<label class="field"><span>' + t('yl_message') + '</span>' +
              '<textarea class="inp" id="ogNudgeText" rows="3">' +
                esc(t('og_nudge_default')) + '</textarea></label>' +
            '<div class="partner-note mt">' + t('og_nudge_hint') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="og-nudge-send" data-id="' + id + '">' + t('send') + '</button>'
    });
  },

  'og-nudge-send': function (el) {
    var id = el.getAttribute('data-id');
    var text = ((document.getElementById('ogNudgeText') || {}).value || '').trim();
    if (!text) { toast(t('og_nudge'), t('yl_note_empty'), 'warn'); return; }
    DB.postMessage({ jobId: id, from: 'og', kind: 'nudge', text: text });
    closeModal();
    closeDrawer();
    toast(id, t('og_nudge_sent'), 'ok', 3200);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
  },

  'partner-view': function () {
    /* This is the manager's preview of what Yalla Wear sees. For Yalla Wear
       themselves it is the way out of their own portal, so there is no way
       out. Nothing renders this button for them; this is the belt to that
       brace. */
    if (isPartnerAccount()) return;
    OG.print.partner = !OG.print.partner;
    /* A portal switch is the biggest context change in the app — it earns a
       full entrance, and it always reads as going forward. */
    if (typeof Motion !== 'undefined') { OG.dir = 'fwd'; Motion.mark(); }
    if (OG.print.partner) YALLA.reset();
    closeDrawer();
    renderSidebar();
    renderTopbar();
    render();
    toast(OG.print.partner ? 'YALLA WEAR' : CONFIG.SHOP_NAME.toUpperCase(),
          t(OG.print.partner ? 'yl_entered' : 'yl_left'), 'ok', 2400);
  },

  /* Open or shut one section of Settings. Deliberately NOT a render(): half
     the cards on that screen hold typed-but-unsaved values — the receipt
     footer, the printer's host, the shop name — and a repaint would take them
     back to whatever the server last said, in the middle of somebody typing.
     So this moves one attribute and remembers it. */
  'set-fold': function (el) {
    var sec = el.closest ? el.closest('.fold') : null;
    if (!sec) return;

    var open = sec.getAttribute('data-open') !== '1';
    sec.setAttribute('data-open', open ? '1' : '0');
    el.setAttribute('aria-expanded', open ? 'true' : 'false');
    setFoldRemember(sec.getAttribute('data-fold'), open);

    /* The entrance is added on the way in and taken off again, rather than
       left on the element: an animation already sitting on a node does not
       replay when the node comes back from display:none, so folding the same
       section twice would animate once. */
    var body = sec.querySelector('.fold-body');
    if (open && body) {
      body.classList.add('fold-in');
      setTimeout(function () { body.classList.remove('fold-in'); }, 320);
    }
  },

  /* One button rather than a pair: it does what it says, then says the other
     thing. The label is flipped here rather than read back off the page,
     because somebody folding a single section by hand afterwards does not
     make "collapse all" the wrong offer. */
  'set-folds': function (el) {
    var open = el.getAttribute('data-k') === 'open';
    Array.prototype.forEach.call(document.querySelectorAll('#view .fold'), function (sec) {
      sec.setAttribute('data-open', open ? '1' : '0');
      var btn = sec.querySelector('.fold-btn');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      setFoldRemember(sec.getAttribute('data-fold'), open);
    });
    el.setAttribute('data-k', open ? 'close' : 'open');
    el.textContent = t(open ? 'set_collapse' : 'set_expand');
  },

  /* This used to say the settings were "already live" because every field
     applies as it is typed — which was true when there was nowhere to save
     them TO. It has been false since the server arrived: typing changed
     CONFIG in memory, this button re-rendered and claimed success, and the
     next load overwrote all of it from the database. The exchange rate is
     the one that matters, because every dollar price on every screen is
     converted through it.

     The rate is not a config key — it lives in fx_rates with its own
     endpoint, so that it can be frozen onto each sale — hence two requests
     rather than one. */
  'settings-save': function (el) {
    if (typeof Shop === 'undefined' || !Shop.live()) { render(); return; }
    if (el) el.disabled = true;

    var updates = {
      'loyalty.points_per_1000': String(CONFIG.LOYALTY_POINTS_PER_1000),
      'loyalty.point_value':     String(CONFIG.LOYALTY_POINT_VALUE),
      'shop.name':               CONFIG.SHOP_NAME,
      'shop.address':            CONFIG.SHOP_ADDRESS || '',
      'shop.city':               CONFIG.SHOP_CITY || '',
      'shop.phone':              CONFIG.SHOP_PHONE || ''
    };

    API.put('/api/config', { updates: updates })
      .then(function () {
        return API.post('/api/fx', { base: 'USD', quote: 'SYP', rate: CONFIG.EXCHANGE_RATE });
      })
      .then(function () { return Shop.reload(); })
      .then(function () {
        toast(t('save_changes'),
          '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' · ' +
          CONFIG.LOYALTY_POINTS_PER_1000 + ' ' + t('points').toLowerCase() + '/1,000 · ' +
          esc(CONFIG.SHOP_NAME), 'ok', 3600);
      })
      .catch(function (err) {
        /* Reload so the screen shows what the server actually holds. Leaving
           the typed values up after a failed save is how somebody walks away
           believing the rate changed. */
        toast(t('save_changes'), API.friendly(err), 'err', 6000);
        Shop.reload();
      })
      .then(function () { if (el) el.disabled = false; });
  },

  'new-sale': function () { closeModal(); go('pos'); }
};
