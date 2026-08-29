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
        toast(t('sync_now'), busy ? t('sync_busy') : API.friendly(e), busy ? 'warn' : 'err', 6000);
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
        '<span class="notif-dot ' + n.tone + '">' + n.icon + '</span><span>' + n.text + '</span></div>';
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

  'alert-fix': function (el) {
    var a = buildAlerts()[+el.getAttribute('data-i')];
    if (!a) return;
    if (a.tab) OG.rep.tab = a.tab;
    if (a.filter) OG.cust.filter = a.filter;
    go(a.view, a.pid ? function () { openProductDrawer(a.pid); } : null);
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

  'open-customer': function (el) { openCustomerDrawer(+el.getAttribute('data-id')); },
  whatsapp: function (el) { openWhatsapp(+el.getAttribute('data-id')); },
  'day-summary': function () { openDaySummary(); },
  'dash-scope': function (el) { OG.dashScope = el.getAttribute('data-k'); render(); },

  'prod-sort': function (el) {
    var k = el.getAttribute('data-k');
    if (OG.prod.sort === k) OG.prod.dir *= -1; else { OG.prod.sort = k; OG.prod.dir = 1; }
    render();
  },
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
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
    var po = DB.newPO(supId, lines, p.name);
    DB.sendPO(po);

    closeModal();
    render();
    toast(po.id + ' → ' + DB.supplier(supId).name,
      DB.poPieces(po) + ' ' + t('pieces') + ' · ' + money(DB.poTotal(po)), 'ok', 5000, {
        label: t('po_whatsapp'),
        attrs: 'data-act="po-whatsapp" data-id="' + po.id + '"'
      });
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

    /* Purchase orders themselves have no server table yet — they live in this
       browser. The STOCK they raise does not: an arrival that only exists here
       would be gone on the next reload while the boxes are on the floor. So
       the pieces go through the same receive endpoint a scan uses, and the
       order's own paperwork is updated afterwards. */
    var lines = po.lines.map(function (l) {
      var v = DB.variants.filter(function (x) {
        return x.productId === l.productId && x.size === l.size;
      })[0];
      return v ? { sku: v.sku, qty: l.qty } : null;
    }).filter(Boolean);

    Shop.write(
      function () {
        return Promise.all(lines.map(function (l) {
          return Shop.receive(l.sku, DB.intakeWh, l.qty, 'Received on ' + po.id);
        }));
      },
      function () { DB.receivePO(po); },
      function () {
        /* In live mode the stock is already booked and re-read, so only the
           order's own state is left to move — passing `true` stops it raising
           the same pieces a second time. */
        if (Shop.live()) DB.receivePO(po, true);
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

  'rc-save-config': function (el) {
    if (!allow('config.write') || typeof Auth === 'undefined') return;
    var updates = {
      'receipt.printer_host': (document.getElementById('rcHost') || {}).value || '',
      'receipt.printer_port': (document.getElementById('rcPort') || {}).value || '9100',
      'shop.branch_name':     (document.getElementById('rcBranch') || {}).value || '',
      'shop.phone':           (document.getElementById('rcPhone') || {}).value || '',
      'receipt.auto_print':   (document.getElementById('rcAutoPrint') || {}).checked ? '1' : '0',
      'receipt.copies':       (document.getElementById('rcCopies') || {}).value || '2',
      'receipt.cut_mode':     ((document.getElementById('rcCutMode') || {}).getAttribute &&
                                document.getElementById('rcCutMode').getAttribute('data-v')) || 'partial',
      'receipt.show_qr':      (document.getElementById('rcShowQr') || {}).checked ? '1' : '0',
      'receipt.show_barcode': (document.getElementById('rcShowBarcode') || {}).checked ? '1' : '0',
      'receipt.show_loyalty': (document.getElementById('rcShowLoyalty') || {}).checked ? '1' : '0',
      'receipt.footer_ar':    (document.getElementById('rcFooterAr') || {}).value || '',
      'receipt.footer_en':    (document.getElementById('rcFooterEn') || {}).value || '',
      'receipt.policy_ar':    (document.getElementById('rcPolicyAr') || {}).value || '',
      'receipt.policy_en':    (document.getElementById('rcPolicyEn') || {}).value || ''
    };
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

  'wh-tab': function (el) { OG.wh.tab = el.getAttribute('data-tab'); render(); },

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
       called Ahmad, which in Aleppo is most of them. */
    var dupe = DB.customers.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() &&
             (!phone || c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
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
          loyaltyPoints: 0, totalSpent: 0, lastPurchaseDate: null,
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
        if (c) {
          toast(t('cu_new'), c.name + (c.phone ? ' · ' + c.phone : ''), 'ok', 3500);
          if (after) after(c);
        }
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
          /* Opening stock arrives at the back door, like any delivery. */
          whId: DB.intakeWh
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

        OG.wh.sizes = {}; OG.wh.name = ''; OG.wh.img = null; OG.wh.imgSrc = null;
        render();

        /* Take him to the thing he just made — a toast alone leaves you
           wondering whether it worked. */
        toast(t('save_product'), name + ' · ' + pieces + ' pcs · ' + skus + ' SKU', 'ok', 5000,
              id ? { label: t('view_all'),
                     attrs: 'data-act="open-new-product" data-id="' + id + '"' } : null);
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

  /* OG settles the bill. This writes into the same invoice object the partner
     portal renders, so switching portals shows it already paid — no sync. */
  'og-pay-inv': function (el) {
    var inv = DB.invoice(el.getAttribute('data-id'));
    if (!inv) return;
    var bal = DB.invoiceBalance(inv);
    if (bal <= 0) return;
    DB.payInvoice(inv, bal, 'cash');
    DB.postMessage({ invoiceId: inv.id, from: 'og', kind: 'invoice',
      text: t('og_paid_msg') + ' ' + money(bal) + ' — ' + inv.id });
    closeModal();
    toast(inv.id, money(bal) + ' · ' + t('og_paid_toast'), 'ok', 3200);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
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

  /* Every field applies as it is typed, so by the time this is pressed the
     settings are already live. It reports what actually changed rather than
     claiming to have performed a save that never existed. */
  'settings-save': function () {
    render();
    toast(t('save_changes'),
      '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' · ' +
      CONFIG.LOYALTY_POINTS_PER_1000 + ' ' + t('points').toLowerCase() + '/1,000 · ' +
      esc(CONFIG.SHOP_NAME), 'ok', 3600);
  },

  'new-sale': function () { closeModal(); go('pos'); }
};
