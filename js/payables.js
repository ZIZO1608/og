/* ==========================================================================
   PAYING SUPPLIERS AND STAFF                                       [data-py]
   --------------------------------------------------------------------------
   Two tabs of the Money screen (055). The rules are server/lib/payables.js;
   this draws what it says and sends what somebody typed.

   SUPPLIERS owe in ONE currency each — the supplier's own. A payment in the
   other currency is converted by the server at this moment's rate; the
   screen shows its estimate only as a hint.

   STAFF are paid by the month, with advances. A month owes salary + bonuses
   − deductions; advances and the salary payment count against it; the left
   column is what is still to pay. Only an advance or a salary moves money,
   and it says which place it left.

   Every write goes through Shop.write with an opId minted when the dialog
   opened. Nothing here is optimistic.
   ========================================================================== */

var Payables = (function () {

  /* The Salaries tab's month and what the server said about it. `seq` drops
     an answer that arrives after a newer question — pressing › twice quickly
     must not paint the first month under the second month's heading. */
  var PR = { month: null, data: null, at: 0, seq: 0, pending: null };
  var LOGINS = null;

  function base() { return CONFIG.BASE_CURRENCY || 'SYP'; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function m(minor, cur) { return Cashbook.money(minor, cur); }
  function mt(minor, cur) { return Cashbook.moneyText(minor, cur); }
  function field(label, inner, cls) {
    return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + inner + '</label>';
  }
  function amountBox(id, value) {
    return '<input class="inp num" id="' + id + '" type="text" inputmode="decimal" dir="ltr" autocomplete="off"' +
      (value != null ? ' value="' + esc(value) + '"' : '') + '>';
  }
  function whole(minor, cur) {
    var v = (Number(minor) || 0) / (cur === 'USD' ? 100 : 1);
    return cur === 'USD' ? v.toFixed(2) : String(Math.round(v));
  }
  function curSelect(id, selected, disabled) {
    return '<select class="inp" id="' + id + '"' + (disabled ? ' disabled' : '') + '>' +
      Cashbook.currencies().map(function (c) {
        return '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>';
      }).join('') + '</select>';
  }
  function days(ymd) {
    if (!ymd) return null;
    var d = new Date(String(ymd).slice(0, 10) + 'T12:00:00');
    var now = new Date(); now.setHours(12, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }
  function dueBadge(ymd) {
    var n = days(ymd);
    if (n === null) return '<span class="muted">—</span>';
    var cls = n < 0 ? 'critical' : n <= 7 ? 'low' : 'neutral';
    var txt = n < 0 ? t('py_overdue').replace('{n}', Math.abs(n)) : n === 0 ? t('py_today') : t('py_in_days').replace('{n}', n);
    return '<span class="badge ' + cls + '"><bdi dir="ltr">' + esc(String(ymd).slice(0, 10)) + '</bdi> · ' + txt + '</span>';
  }

  /* ============================================================ suppliers */

  function suppliersTab() {
    var list = DB.suppliers || [];
    var can = allow('money.write');
    var owed = {};
    var dueSoon = 0;
    list.forEach(function (s) {
      if (s.outstanding > 0) owed[s.currency] = (owed[s.currency] || 0) + s.outstanding;
      var n = days(s.dueRaw);
      if (s.outstanding > 0 && n !== null && n <= 30) dueSoon++;
    });

    var h = '<div class="grid stat-row py-stats mb">' +
      '<div class="stat"><span class="eyebrow">' + t('py_owed_suppliers') + '</span>' +
        '<div class="val' + (Object.keys(owed).length ? ' warn' : '') + '">' +
          (Object.keys(owed).length ? Object.keys(owed).map(function (c) { return m(owed[c], c); }).join('<br>') : '—') +
        '</div><div class="foot">' + t('py_never_added') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('py_suppliers') + '</span>' +
        '<div class="val"><bdi dir="ltr">' + nf(list.length) + '</bdi></div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('py_due_30') + '</span>' +
        '<div class="val' + (dueSoon ? ' warn' : '') + '"><bdi dir="ltr">' + nf(dueSoon) + '</bdi></div></div>' +
      '</div>';

    if (can) {
      h += '<div class="cb-actions mb"><button class="btn btn-primary" data-py="sup-edit">+ ' + t('py_new_supplier') + '</button></div>';
    }

    if (!list.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('py_no_suppliers') + '</b>' + t('py_no_suppliers_sub') + '</div></div>';
    }

    h += '<div class="card table-wrap"><table class="tbl py-tbl"><thead><tr>' +
      '<th>' + t('py_supplier') + '</th><th class="num">' + t('py_owed') + '</th><th>' + t('py_due') + '</th>' +
      '<th class="num">' + t('py_bought') + '</th><th>' + t('py_last_paid') + '</th><th></th></tr></thead><tbody>';
    list.slice().sort(function (a, b) { return (b.outstanding || 0) - (a.outstanding || 0); }).forEach(function (s) {
      h += '<tr>' +
        '<td><b>' + esc(s.name) + '</b>' +
          '<small class="muted py-sub">' + esc([s.category, s.contact].filter(Boolean).join(' · ')) + '</small></td>' +
        '<td class="num"><b class="' + (s.outstanding > 0 ? 'py-owe' : s.outstanding < 0 ? 'py-ahead' : '') + '">' +
          m(s.outstanding, s.currency) + '</b>' +
          (s.outstanding < 0 ? '<small class="muted py-sub">' + t('py_paid_ahead') + '</small>' : '') + '</td>' +
        '<td>' + (s.outstanding > 0 ? dueBadge(s.dueRaw) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num muted">' + (s.totalPurchased ? m(s.totalPurchased, s.currency) : '—') + '</td>' +
        '<td class="muted">' + (s.lastPayment ? esc(fmtDate(s.lastPayment)) : '—') + '</td>' +
        '<td class="py-acts">' +
          (can ? '<button class="btn btn-sm btn-primary" data-py="sup-pay" data-id="' + s.id + '">' + t('py_pay') + '</button>' : '') +
          '<button class="btn btn-sm btn-ghost" data-py="sup-ledger" data-id="' + s.id + '">' + t('py_ledger') + '</button>' +
          (can ? '<button class="btn btn-sm btn-ghost" data-py="sup-edit" data-id="' + s.id + '">' + t('edit') + '</button>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function supplier(id) {
    return (DB.suppliers || []).filter(function (s) { return String(s.id) === String(id); })[0] || null;
  }

  function openSupplierEditor(id) {
    var s = id ? supplier(id) : null;
    var locked = s && s.outstanding !== 0;
    openModal({
      title: s ? t('py_edit_supplier') + ' · ' + esc(s.name) : t('py_new_supplier'), size: 'narrow',
      body: field(t('name'), '<input class="inp" id="pySName" maxlength="80" value="' + esc(s ? s.name : '') + '">') +
        field(t('py_contact'), '<input class="inp" id="pySContact" maxlength="120" value="' + esc(s ? s.contact || '' : '') + '">', 'mt') +
        field(t('py_category'), '<input class="inp" id="pySCat" maxlength="40" value="' + esc(s ? s.category || '' : '') + '">', 'mt') +
        '<div class="cb-pair">' +
          field(t('cb_currency'), curSelect('pySCur', s ? s.currency : base(), locked)) +
          field(t('py_due'), '<input class="inp" id="pySDue" type="date" dir="ltr" value="' + esc(s && s.dueRaw ? String(s.dueRaw).slice(0, 10) : '') + '">') +
        '</div>' +
        (locked ? '<div class="muted small">' + t('py_cur_locked') + '</div>' : '') +
        (!s ? field(t('py_opening'), amountBox('pySOpen'), 'mt') + '<div class="muted small">' + t('py_opening_hint') + '</div>' : '') +
        (s ? '<label class="cb-check mt"><input type="checkbox" id="pySArch"' + (s.archived ? ' checked' : '') + '> ' + t('py_archived') + '</label>' : ''),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-py="sup-save" data-id="' + (s ? s.id : '') + '" data-op="' + Cashbook.newOp('so') + '">' + t('save') + '</button>'
    });
  }

  function openSupplierPay(id) {
    var sup = supplier(id);
    if (!sup) return;
    var op = Cashbook.newOp ? Cashbook.newOp('sp') : ('sp-' + Date.now());
    /* THE PATTERN (ns03): the amount first and pre-filled with what is owed,
       the currency as toggles, the place as chips. The ids are unchanged, so
       sup-pay-go reads exactly what it read before — including the currency
       lock, which the server enforces either way. */
    openModal({
      title: t('py_pay') + ' · ' + esc(sup.name), size: 'narrow',
      body: stat(t('py_owed'), Cashbook.money(sup.outstanding, sup.currency)) +
        Cashbook.bigAmount('pyPAmt', t('cb_amount'), 'py:pay-hint', 'pyPCur') +
        Cashbook.field(t('cb_which_money'), Cashbook.curPick('pyPCur', sup.currency, 'py:pay-hint'), 'mt') +
        Cashbook.field(t('cb_from_where'), Cashbook.placePick('pyPPlace', 'owner'), 'mt') +
        '<div class="partner-note mt" id="pyPHint" data-sup="' + esc(sup.id) + '"></div>' +
        Cashbook.moreFold(Cashbook.field(t('note'), '<input class="inp" id="pyPNote" type="text" maxlength="300">')) +
        '<div class="muted small mt">' + t('py_not_expense') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-py="sup-pay-go" data-id="' + sup.id + '" data-op="' + op + '">' +
          t('py_pay') + '</button>',
      onOpen: function () {
        var box = document.getElementById('pyPAmt');
        if (box && sup.outstanding > 0) box.value = whole(sup.outstanding, sup.currency);
        payHint();
        Cashbook.focusAmount('pyPAmt');
      }
    });
  }

  function payHint() {
    var host = document.getElementById('pyPHint');
    if (!host) return;
    var s = supplier(host.getAttribute('data-sup'));
    var cur = val('pyPCur');
    var amt = Cashbook.toMinor(val('pyPAmt'), cur);
    if (!s || !amt) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    var drop = amt;
    if (cur !== s.currency) {
      var rate = (DB.cash && DB.cash.rates) || {};
      var rf = cur === 'USD' ? 1 : rate[cur], rt = s.currency === 'USD' ? 1 : rate[s.currency];
      if (!rf || !rt) { host.innerHTML = t('py_no_rate'); return; }
      var w = amt / (cur === 'USD' ? 100 : 1);
      drop = Math.round(w * (rt / rf) * (s.currency === 'USD' ? 100 : 1));
    }
    var left = s.outstanding - drop;
    host.innerHTML = (cur !== s.currency ? t('py_takes_off').replace('{x}', m(drop, s.currency)) + ' · ' : '') +
      (left < 0 ? t('py_leaves_ahead').replace('{x}', m(-left, s.currency)) : t('py_leaves').replace('{x}', m(left, s.currency)));
  }

  function openLedger(id) {
    var s = supplier(id);
    if (!s) return;
    openDrawer({
      head: '<div><h3>' + esc(s.name) + '</h3><div class="muted small">' + t('py_owed') + ' ' + m(s.outstanding, s.currency) + '</div></div>',
      body: '<div id="pyLedger"><div class="cart-empty"><b>' + t('cb_loading') + '</b></div></div>'
    });
    Shop.supplierLedger(id).then(function (r) {
      var host = document.getElementById('pyLedger');
      if (host) host.innerHTML = ledgerBody(r);
    }).catch(function (err) { toast(s.name, API.friendly(err), 'err', 5000); });
  }

  function ledgerBody(r) {
    var s = r.supplier;
    var rows = (r.ledger && r.ledger.rows) || [];
    var can = allow('money.write');
    var hasOpening = rows.some(function (x) { return x.kind === 'opening'; });
    var h = '';
    if (can) {
      h += '<div class="cb-actions mb">' +
        (!hasOpening ? '<button class="btn btn-sm" data-py="sup-adj" data-id="' + s.id + '" data-k="opening">' + t('py_opening') + '</button>' : '') +
        '<button class="btn btn-sm" data-py="sup-adj" data-id="' + s.id + '" data-k="return">' + t('py_k_return') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-py="sup-adj" data-id="' + s.id + '" data-k="adjust">' + t('py_k_adjust') + '</button>' +
        '</div>';
    }
    if (!rows.length) return h + '<div class="cart-empty"><b>' + t('py_ledger_empty') + '</b></div>';
    h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + t('date') + '</th><th>' + t('cb_col_what') + '</th>' +
      '<th class="num">' + t('mn_amount') + '</th><th></th></tr></thead><tbody>';
    rows.forEach(function (x) {
      h += '<tr' + (x.reversed_by ? ' class="mn-void"' : '') + '><td class="num muted">' + esc(fmtDate(x.at)) + '</td>' +
        '<td><b>' + esc(t('py_k_' + x.kind)) + '</b>' +
          (x.paid_amount ? '<small class="muted py-sub">' + t('py_paid_as') + ' ' + m(x.paid_amount, x.paid_currency) + '</small>' : '') +
          (x.place ? '<small class="muted py-sub">' + esc(Cashbook.placeName(x.place)) + '</small>' : '') +
          (x.note ? '<small class="muted py-sub">' + esc(x.note) + '</small>' : '') +
          (x.user_name ? '<small class="muted py-sub">' + esc(x.user_name) + '</small>' : '') + '</td>' +
        '<td class="num"><b class="cb-amt">' + Cashbook.signed(x.amount, x.currency) + '</b></td>' +
        '<td>' + (can && x.kind === 'payment' && !x.reversed_by
          ? '<button class="btn btn-sm btn-ghost" data-py="sup-void" data-id="' + x.id + '" data-sup="' + s.id + '">' + t('py_undo') + '</button>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table></div>' + cappedNote(r.ledger, t('py_entries'));
  }

  function openAdjust(id, kind) {
    var s = supplier(id);
    if (!s) return;
    openModal({
      title: t('py_k_' + kind) + ' · ' + esc(s.name), size: 'narrow',
      body: '<p class="muted small">' + t('py_adj_' + kind + '_hint') + '</p>' +
        field(t('mn_amount') + ' · ' + esc(s.currency), amountBox('pyAAmt'), 'mt') +
        (kind === 'adjust'
          ? '<div class="cb-seg mt" role="group">' +
              '<button type="button" class="on" data-py="adj-dir" data-v="up">' + t('py_adj_up') + '</button>' +
              '<button type="button" data-py="adj-dir" data-v="down">' + t('py_adj_down') + '</button>' +
            '</div><input type="hidden" id="pyADir" value="up">' : '') +
        field(t(kind === 'adjust' ? 'py_why' : 'note'), '<input class="inp" id="pyANote" maxlength="300">', 'mt'),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-py="sup-adj-go" data-id="' + s.id + '" data-k="' + kind + '" data-op="' +
          Cashbook.newOp('sa') + '">' + t('save') + '</button>'
    });
  }

  /* ============================================================== salaries */

  function shopMonth() {
    var d = new Date(Date.now() + (CONFIG.TZ_MINUTES || 180) * 60000);
    return d.toISOString().slice(0, 7);
  }
  function addMonths(ym, n) {
    var p = ym.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  function monthLabelOf(ym) {
    var p = ym.split('-');
    var names = OG.lang === 'ar' ? MONTHS_AR : MONTHS_EN;
    return names[Number(p[1]) - 1] + ' ' + p[0];
  }

  /* A repaint of the tab asks again when what it holds is for another month,
     older than the shop's last reload (every write reloads), or half a
     minute old — somebody else may have paid from another device. */
  function loadPayroll(force) {
    var want = PR.month;
    if (!force && PR.data && PR.data.month === want && PR.at > Shop.loadedAt() && Date.now() - PR.at < 30000) return;
    if (!force && PR.pending === want) return;
    var seq = ++PR.seq;
    PR.pending = want;
    Shop.payroll(want).then(function (r) {
      if (seq !== PR.seq) return;
      PR.data = r; PR.at = Date.now(); PR.pending = null;
      paintPayroll();
    }).catch(function (err) {
      if (seq !== PR.seq) return;
      PR.pending = null;
      toast(t('py_salaries'), API.friendly(err), 'err', 5000);
    });
  }

  function paintPayroll() {
    var host = document.getElementById('pyPayroll');
    if (!host) return;
    host.innerHTML = payrollBody();
    /* Painted after render(), so the phone cards are asked for here. */
    if (typeof labelWideTables === 'function') labelWideTables(host);
  }

  function salariesTab() {
    if (!PR.month) PR.month = shopMonth();
    loadPayroll(false);
    var h = '<div class="py-month mb">' +
      '<button class="btn btn-ghost btn-sm" data-py="pr-month" data-n="-1" aria-label="' + esc(t('py_prev')) + '">‹</button>' +
      '<b class="py-month-lbl">' + esc(monthLabelOf(PR.month)) + '</b>' +
      '<button class="btn btn-ghost btn-sm" data-py="pr-month" data-n="1" aria-label="' + esc(t('py_next')) + '">›</button>' +
      (PR.month !== shopMonth() ? '<button class="btn btn-ghost btn-sm" data-py="pr-month" data-n="0">' + t('py_this_month') + '</button>' : '') +
      (allow('staff.write') ? '<span class="py-grow"></span><button class="btn btn-primary btn-sm" data-py="emp-edit">+ ' + t('py_new_person') + '</button>' : '') +
      '</div>';
    return h + '<div id="pyPayroll">' + payrollBody() + '</div>';
  }

  function payrollBody() {
    var d = PR.data;
    if (!d || d.month !== PR.month) return '<div class="card"><div class="cart-empty"><b>' + t('cb_loading') + '</b></div></div>';
    var canPay = allow('staff.write') && allow('money.write');
    var canEdit = allow('staff.write');
    var curs = Object.keys(d.totals || {});
    var h = '<div class="grid stat-row py-stats mb">' +
      stat(t('py_month_owes'), curs.map(function (c) { return m(d.totals[c].due, c); }).join('<br>') || '—') +
      stat(t('py_month_paid'), curs.map(function (c) { return m(d.totals[c].paid, c); }).join('<br>') || '—') +
      stat(t('py_month_left'), curs.map(function (c) { return m(d.totals[c].left, c); }).join('<br>') || '—',
           curs.some(function (c) { return d.totals[c].left > 0; }) ? 'warn' : '') +
      '</div>';

    if (!d.people.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('py_no_people') + '</b>' + t('py_no_people_sub') + '</div></div>';
    }

    h += '<div class="card table-wrap"><table class="tbl py-tbl"><thead><tr>' +
      '<th>' + t('py_person') + '</th><th class="num">' + t('py_salary') + '</th><th class="num">' + t('py_adjust_col') + '</th>' +
      '<th class="num">' + t('py_paid') + '</th><th class="num">' + t('py_left') + '</th><th>' + t('py_pay_day') + '</th><th></th>' +
      '</tr></thead><tbody>';
    d.people.forEach(function (p) {
      /* One isolate per figure, one per line — two signed amounts sharing a
         line are reordered by an Arabic paragraph. */
      var adj = [];
      if (p.bonus) adj.push(Cashbook.signed(p.bonus, p.currency));
      if (p.deduction) adj.push(Cashbook.signed(-p.deduction, p.currency));
      h += '<tr' + (p.archived ? ' class="mn-void"' : '') + '>' +
        '<td><b>' + esc(p.name) + '</b><small class="muted py-sub">' + esc(p.role || '') + '</small></td>' +
        '<td class="num">' + m(p.salary, p.currency) + '</td>' +
        '<td class="num muted">' + (adj.join('<br>') || '—') + '</td>' +
        '<td class="num">' + (p.paid ? m(p.paid, p.currency) : '<span class="muted">—</span>') +
          (p.advances ? '<small class="muted py-sub">' + t('py_of_which_adv') + ' ' + m(p.advances, p.currency) + '</small>' : '') + '</td>' +
        '<td class="num"><b class="' + (p.left > 0 ? 'py-owe' : '') + '">' + m(Math.max(0, p.left), p.currency) + '</b></td>' +
        '<td>' + (p.left > 0 && p.pay_day ? dueBadge(PR.month + '-' + String(p.pay_day).padStart(2, '0'))
                 : p.left <= 0 && p.due > 0 ? '<span class="badge healthy">' + t('py_settled') + '</span>'
                 : '<span class="muted">' + (p.pay_day ? t('py_day_n').replace('{n}', p.pay_day) : '—') + '</span>') + '</td>' +
        '<td class="py-acts">' +
          (canPay && p.left > 0 ? '<button class="btn btn-sm btn-primary" data-py="pr-pay" data-id="' + p.id + '" data-k="salary">' + t('py_pay_rest') + '</button>' : '') +
          (canPay && p.left > 0 ? '<button class="btn btn-sm" data-py="pr-pay" data-id="' + p.id + '" data-k="advance">' + t('py_k_advance') + '</button>' : '') +
          (canEdit ? '<button class="btn btn-sm btn-ghost" data-py="pr-pay" data-id="' + p.id + '" data-k="bonus">' + t('py_more') + '</button>' : '') +
          '<button class="btn btn-sm btn-ghost" data-py="pr-rows" data-id="' + p.id + '">' + t('py_ledger') + '</button>' +
          (canEdit ? '<button class="btn btn-sm btn-ghost" data-py="emp-edit" data-id="' + p.id + '">' + t('edit') + '</button>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function stat(label, value, cls) {
    return '<div class="stat"><span class="eyebrow">' + label + '</span><div class="val' + (cls ? ' ' + cls : '') + '">' +
      value + '</div></div>';
  }

  function person(id) {
    var list = (PR.data && PR.data.people) || [];
    return list.filter(function (p) { return String(p.id) === String(id); })[0] ||
           (DB.employees || []).filter(function (e) { return String(e.id) === String(id); })[0] || null;
  }

  /* One dialog for all four entries — THE PATTERN (ns03). The amount comes
     first, big, and pre-filled with what the month still owes; the four
     entries are chips under it; the place is chips again, and only for the
     two that actually move money. Under the button is the one sentence
     nobody should have to work out in their head: what the month will owe
     once this is saved. Every id is unchanged, so `pr-pay-go` reads exactly
     what it read before. */
  function openPay(id, kind) {
    var p = person(id);
    if (!p) return;
    var kinds = allow('money.write') ? ['salary', 'advance', 'bonus', 'deduction'] : ['bonus', 'deduction'];
    if (kinds.indexOf(kind) < 0) kind = kinds[0];
    var left = Math.max(0, p.left);
    openModal({
      title: esc(p.name) + ' · ' + esc(monthLabelOf(PR.month)), size: 'narrow',
      body: '<div class="py-two">' +
          '<div class="stat"><span class="eyebrow">' + t('py_month_owes') + '</span><div class="val py-val">' + m(p.due, p.currency) + '</div></div>' +
          '<div class="stat"><span class="eyebrow">' + t('py_left') + '</span><div class="val warn py-val">' + m(left, p.currency) + '</div></div>' +
        '</div>' +
        Cashbook.bigAmount('pyKAmt', t('cb_amount') + ' · ' + esc(p.currency), 'py:pay-left') +
        Cashbook.field(t('cb_what_for'),
          Cashbook.pickRow('pyKKind', kinds.map(function (k) { return { v: k, label: t('py_k_' + k) }; }), kind, 'py:pay-kind'), 'mt') +
        '<p class="muted small" id="pyKHint">' + t('py_hint_' + kind) + '</p>' +
        '<div id="pyKPlaceWrap"' + (kind === 'salary' || kind === 'advance' ? '' : ' hidden') + '>' +
          Cashbook.field(t('mn_paid_from'), Cashbook.placePick('pyKPlace', 'owner'), 'mt') + '</div>' +
        '<div class="partner-note mt" id="pyKLeft" data-left="' + left + '" data-cur="' + esc(p.currency) + '" hidden></div>' +
        Cashbook.moreFold(Cashbook.field(t('note'), '<input class="inp" id="pyKNote" maxlength="300">')),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-py="pr-pay-go" data-id="' + p.id + '" data-left="' + left +
          '" data-cur="' + esc(p.currency) + '" data-op="' + Cashbook.newOp('pp') + '">' + t('save') + '</button>',
      onOpen: function () {
        var box = document.getElementById('pyKAmt');
        if (box && kind === 'salary' && left > 0) box.value = whole(left, p.currency);
        payLeft();
        Cashbook.focusAmount('pyKAmt');
      }
    });
  }

  /* What the month will owe afterwards — and, where the server would refuse,
     the refusal UNDER THE FIELD rather than as a toast after the press. */
  function payLeft() {
    var host = document.getElementById('pyKLeft');
    if (!host) return;
    var cur = host.getAttribute('data-cur');
    var left = Number(host.getAttribute('data-left')) || 0;
    var kind = val('pyKKind');
    var amt = Cashbook.toMinor(val('pyKAmt'), cur);
    if (!amt) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    if ((kind === 'salary' || kind === 'advance') && amt > left) {
      host.className = 'cb-why mt';
      host.innerHTML = t('py_more_than_left').replace('{x}', m(left, cur));
      return;
    }
    host.className = 'partner-note mt';
    var after = kind === 'bonus' ? left + amt : left - amt;
    host.innerHTML = kind === 'bonus' || kind === 'deduction'
      ? t('py_owes_after').replace('{x}', m(Math.max(0, after), cur))
      : (after <= 0 ? t('py_all_paid') : t('py_left_after').replace('{x}', m(after, cur)));
  }

  function openRows(id) {
    var p = person(id);
    if (!p) return;
    var rows = p.rows || [];
    var can = allow('staff.write') && allow('money.write');
    openDrawer({
      head: '<div><h3>' + esc(p.name) + '</h3><div class="muted small">' + esc(monthLabelOf(PR.month)) + '</div></div>',
      body: rows.length
        ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + t('date') + '</th><th>' + t('cb_col_what') + '</th>' +
            '<th class="num">' + t('mn_amount') + '</th><th></th></tr></thead><tbody>' +
            rows.map(function (x) {
              return '<tr' + (x.reversed_by || x.kind === 'reversal' ? ' class="mn-void"' : '') + '>' +
                '<td class="num muted">' + esc(fmtDate(x.at)) + '</td>' +
                '<td><b>' + esc(t('py_k_' + x.kind)) + '</b>' +
                  (x.place ? '<small class="muted py-sub">' + esc(Cashbook.placeName(x.place)) + '</small>' : '') +
                  (x.note ? '<small class="muted py-sub">' + esc(x.note) + '</small>' : '') + '</td>' +
                '<td class="num"><b>' + m(x.amount, x.currency) + '</b></td>' +
                '<td>' + (can && x.kind !== 'reversal' && !x.reversed_by
                  ? '<button class="btn btn-sm btn-ghost" data-py="pr-void" data-id="' + x.id + '">' + t('py_undo') + '</button>' : '') + '</td>' +
                '</tr>';
            }).join('') + '</tbody></table></div>'
        : '<div class="cart-empty"><b>' + t('py_rows_empty') + '</b></div>'
    });
  }

  function loadLogins() {
    if (LOGINS || typeof Shop === 'undefined') return;
    Shop.staffLogins().then(function (r) {
      LOGINS = (r && r.users) || [];
      var sel = document.getElementById('pyELogin');
      if (sel) sel.innerHTML = loginOptions(sel.getAttribute('data-v'));
    }).catch(function () { LOGINS = []; });
  }

  /* Working logins, and the one already linked even if it has since been
     switched off — dropping it from the list would unlink it on Save. The
     partner is not staff, and is never offered. */
  function loginOptions(selected) {
    var list = (LOGINS || []).filter(function (u) {
      return u.role !== 'partner' && (u.active || String(u.id) === String(selected));
    });
    if (selected && !list.some(function (u) { return String(u.id) === String(selected); })) {
      list.push({ id: selected, name: '#' + selected, username: '…' });
    }
    return '<option value="">' + esc(t('py_no_login')) + '</option>' + list.map(function (u) {
      return '<option value="' + u.id + '"' + (String(u.id) === String(selected) ? ' selected' : '') + '>' +
        esc(u.name + ' (' + u.username + ')') + '</option>';
    }).join('');
  }

  function openEmployeeEditor(id) {
    var p = id ? person(id) : null;
    loadLogins();
    openModal({
      title: p ? t('py_edit_person') + ' · ' + esc(p.name) : t('py_new_person'), size: 'narrow',
      body: field(t('name'), '<input class="inp" id="pyEName" maxlength="80" value="' + esc(p ? p.name : '') + '">') +
        field(t('py_role'), '<input class="inp" id="pyERole" maxlength="40" value="' + esc(p ? p.role || '' : '') + '">', 'mt') +
        field(t('py_login'), '<select class="inp" id="pyELogin" data-v="' + esc(p ? (p.user_id || p.userId || '') : '') + '">' +
          loginOptions(p ? (p.user_id || p.userId) : '') + '</select>', 'mt') +
        '<div class="cb-pair">' +
          field(t('cb_currency'), curSelect('pyECur', p ? p.currency : base())) +
          field(t('py_salary'), amountBox('pyESal', p ? whole(p.salary, p.currency) : '')) +
        '</div>' +
        '<div class="cb-pair">' +
          field(t('py_pay_day'), '<input class="inp num" id="pyEDay" type="number" min="1" max="28" dir="ltr" value="' + esc(p ? (p.pay_day || p.payDay || '') : '') + '">') +
          field(t('py_since'), '<input class="inp" id="pyESince" type="date" dir="ltr" value="' + esc(p && p.since ? String(p.since).slice(0, 10) : '') + '">') +
        '</div>' +
        '<div class="muted small">' + t('py_pay_day_hint') + '</div>' +
        field(t('phone'), '<input class="inp" id="pyEPhone" maxlength="30" dir="ltr" value="' + esc(p ? p.phone || '' : '') + '">', 'mt') +
        (p ? '<label class="cb-check mt"><input type="checkbox" id="pyEArch"' + (p.archived ? ' checked' : '') + '> ' + t('py_left_shop') + '</label>' : ''),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-py="emp-save" data-id="' + (p ? p.id : '') + '">' + t('save') + '</button>'
    });
  }

  /* ------------------------------------------------------------------ acts */

  /* Shop.write has already reloaded and redrawn; the redraw asks for the
     month again because what it held is older than that reload. */
  function done(msg, title) {
    closeModal();
    toast(title || t('mn_title'), msg, 'ok', 4000);
  }

  var ACT = {
    'sup-edit': function (el) { openSupplierEditor(el.getAttribute('data-id')); },
    'sup-pay': function (el) { openSupplierPay(el.getAttribute('data-id')); },
    'sup-ledger': function (el) { openLedger(el.getAttribute('data-id')); },
    'sup-adj': function (el) { closeDrawer(); openAdjust(el.getAttribute('data-id'), el.getAttribute('data-k')); },

    'sup-save': function (el) {
      var id = el.getAttribute('data-id');
      var name = val('pySName').trim();
      if (!name) { toast(t('py_suppliers'), t('py_need_name'), 'warn'); return; }
      var cur = val('pySCur');
      var body = { name: name, contact: val('pySContact'), category: val('pySCat'), currency: cur, due_date: val('pySDue') || null };
      if (id) {
        body.id = Number(id);
        var arch = document.getElementById('pySArch');
        if (arch) body.archived = arch.checked ? 1 : 0;
      }
      var open = id ? 0 : Cashbook.toMinor(val('pySOpen'), cur);
      var op = el.getAttribute('data-op');
      Shop.write(function () {
        return Shop.saveSupplier(body).then(function (r) {
          if (!open || !r || !r.supplier) return r;
          return Shop.adjustSupplier(r.supplier.id, { kind: 'opening', amount: open, opId: op }).then(function () { return r; });
        });
      }, null, function () { done(name, t('py_suppliers')); });
    },

    'sup-pay-go': function (el) {
      var id = el.getAttribute('data-id');
      var cur = val('pyPCur');
      var amt = Cashbook.toMinor(val('pyPAmt'), cur);
      if (!amt) { toast(t('py_pay'), t('mn_amount_needed'), 'warn'); return; }
      var body = { amount: amt, currency: cur, place: val('pyPPlace'), note: val('pyPNote') || null, opId: el.getAttribute('data-op') };
      Shop.write(function () { return Shop.paySupplier(id, body); }, null, function (r) {
        var s = r && r.supplier;
        done(mt(amt, cur) + (s ? ' · ' + t('py_owed').toLowerCase() + ' ' + mt(s.outstanding, s.currency) : '') +
             (r && r.warning === 'paid_ahead' ? ' · ' + t('py_paid_ahead') : ''), s ? s.name : t('py_pay'));
      });
    },

    'adj-dir': function (el) {
      var box = document.getElementById('pyADir');
      if (box) box.value = el.getAttribute('data-v');
      Array.prototype.forEach.call(el.parentNode.children, function (b) { b.classList.toggle('on', b === el); });
    },

    'sup-adj-go': function (el) {
      var id = el.getAttribute('data-id');
      var kind = el.getAttribute('data-k');
      var s = supplier(id);
      var amt = Cashbook.toMinor(val('pyAAmt'), s ? s.currency : base());
      if (!amt) { toast(t('py_k_' + kind), t('mn_amount_needed'), 'warn'); return; }
      if (kind === 'adjust' && val('pyADir') === 'down') amt = -amt;
      var note = val('pyANote');
      if (kind === 'adjust' && !note.trim()) { toast(t('py_k_adjust'), t('py_need_why'), 'warn'); return; }
      Shop.write(function () {
        return Shop.adjustSupplier(id, { kind: kind, amount: amt, note: note || null, opId: el.getAttribute('data-op') });
      }, null, function () { done(t('py_k_' + kind), s ? s.name : ''); });
    },

    'sup-void': function (el) {
      var id = el.getAttribute('data-id');
      var sup = el.getAttribute('data-sup');
      Shop.write(function () { return Shop.voidSupplierPay(id, null); }, null, function () {
        toast(t('py_undo'), t('py_undone'), 'ok', 3500);
        openLedger(sup);
      });
    },

    'pr-month': function (el) {
      var n = Number(el.getAttribute('data-n'));
      PR.month = n === 0 ? shopMonth() : addMonths(PR.month || shopMonth(), n);
      render();
    },

    'pr-pay': function (el) { openPay(el.getAttribute('data-id'), el.getAttribute('data-k')); },
    'pr-rows': function (el) { openRows(el.getAttribute('data-id')); },
    'emp-edit': function (el) { openEmployeeEditor(el.getAttribute('data-id')); },

    'pr-pay-go': function (el) {
      var id = el.getAttribute('data-id');
      var cur = el.getAttribute('data-cur');
      var kind = val('pyKKind');
      var amt = Cashbook.toMinor(val('pyKAmt'), cur);
      if (!amt) { toast(t('py_salaries'), t('mn_amount_needed'), 'warn'); return; }
      var left = Number(el.getAttribute('data-left')) || 0;
      if ((kind === 'salary' || kind === 'advance') && amt > left) {
        toast(t('py_salaries'), t('py_more_than_left').replace('{x}', mt(left, cur)), 'warn', 6000);
        return;
      }
      var body = {
        employeeId: Number(id), month: PR.month, kind: kind, amount: amt,
        place: (kind === 'salary' || kind === 'advance') ? val('pyKPlace') : null,
        note: val('pyKNote') || null, opId: el.getAttribute('data-op')
      };
      Shop.write(function () { return Shop.payStaff(body); }, null, function (r) {
        var mo = r && r.month;
        done(t('py_k_' + kind) + ' · ' + mt(amt, cur) + (mo ? ' · ' + t('py_left').toLowerCase() + ' ' + mt(Math.max(0, mo.left), cur) : ''),
             (person(id) || {}).name);
      });
    },

    'pr-void': function (el) {
      var id = el.getAttribute('data-id');
      Shop.write(function () { return Shop.voidStaffPay(id, null); }, null, function () {
        closeDrawer();
        toast(t('py_undo'), t('py_undone'), 'ok', 3500);
      });
    },

    'emp-save': function (el) {
      var id = el.getAttribute('data-id');
      var name = val('pyEName').trim();
      if (!name) { toast(t('py_salaries'), t('py_need_name'), 'warn'); return; }
      var cur = val('pyECur');
      var body = {
        name: name, role: val('pyERole') || null, currency: cur,
        salary: Cashbook.toMinor(val('pyESal'), cur),
        pay_day: val('pyEDay') ? Number(val('pyEDay')) : null,
        since: val('pyESince') || null, phone: val('pyEPhone') || null,
        user_id: val('pyELogin') ? Number(val('pyELogin')) : null
      };
      if (body.pay_day !== null && !(body.pay_day >= 1 && body.pay_day <= 28)) {
        toast(t('py_salaries'), t('py_pay_day_hint'), 'warn'); return;
      }
      if (id) {
        body.id = Number(id);
        var arch = document.getElementById('pyEArch');
        if (arch) body.archived = arch.checked ? 1 : 0;
      }
      Shop.write(function () { return Shop.saveEmployee(body); }, null, function () { done(name, t('py_salaries')); });
    }
  };

  var CHANGE = {
    'pay-hint': function () { payHint(); },
    'pay-left': function () { payLeft(); },

    /* The kind decides whether money moves at all, so it moves the place
       row in and out and rewrites the line under it — a bonus that offered
       a place to pay it from would be a lie about what the server does. */
    'pay-kind': function (el) {
      var k = el.value;
      var wrap = document.getElementById('pyKPlaceWrap');
      if (wrap) wrap.hidden = !(k === 'salary' || k === 'advance');
      var hint = document.getElementById('pyKHint');
      if (hint) hint.textContent = t('py_hint_' + k);
      payLeft();
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-py]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-py')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
    var onChange = function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-pyc]') : null;
      if (!el) return;
      var fn = CHANGE[el.getAttribute('data-pyc')];
      if (fn) fn(el, e);
    };
    document.addEventListener('change', onChange);
    document.addEventListener('input', onChange);
  }
  bind();

  function exportSpec(tab) {
    if (tab === 'suppliers') {
      return {
        name: 'suppliers', sheet: 'Suppliers', title: t('py_suppliers'), subtitle: fmtDate(new Date()),
        columns: [{ label: t('py_supplier'), width: 26 }, { label: t('py_category') },
                  { label: 'SYP · ' + t('py_owed'), money: 'SYP' }, { label: 'USD · ' + t('py_owed'), money: 'USD' },
                  { label: t('py_due') }, { label: t('py_last_paid') }],
        rows: (DB.suppliers || []).map(function (s) {
          var w = s.outstanding / (s.currency === 'USD' ? 100 : 1);
          return [s.name, s.category || '', s.currency === 'USD' ? null : w, s.currency === 'USD' ? w : null,
                  s.dueRaw ? String(s.dueRaw).slice(0, 10) : '', s.lastPayment ? fmtDate(s.lastPayment) : ''];
        })
      };
    }
    var d = PR.data;
    return {
      name: 'payroll-' + (PR.month || ''), sheet: 'Payroll', title: t('py_salaries') + ' · ' + monthLabelOf(PR.month || shopMonth()),
      subtitle: fmtDate(new Date()),
      columns: [{ label: t('py_person'), width: 24 }, { label: t('cb_currency') },
                { label: t('py_salary'), num: true }, { label: t('py_month_owes'), num: true },
                { label: t('py_paid'), num: true }, { label: t('py_left'), num: true }],
      rows: (d && d.people ? d.people : []).map(function (p) {
        var div = p.currency === 'USD' ? 100 : 1;
        return [p.name, p.currency, p.salary / div, p.due / div, p.paid / div, Math.max(0, p.left) / div];
      })
    };
  }

  return {
    suppliersTab: suppliersTab,
    salariesTab: salariesTab,
    exportSpec: exportSpec
  };
})();
