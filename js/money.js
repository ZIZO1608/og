/* ==========================================================================
   MONEY — the drawer, the expenses, and الدين                     [data-mn]
   --------------------------------------------------------------------------
   Three screens for the three things the shop keeps on paper.

   Until now Reports showed REVENUE and called it profit, because expenses did
   not exist anywhere in the system. That is the gap this closes: gross, minus
   what the stock cost, minus rent and diesel and transport, is the number he
   actually lives on.

   The shift close is the emotional centre. It states what SHOULD be in the
   box, he counts what is, and the difference is shown without softening it.
   The whole thing is only worth anything because of one distinction:
   Sham Cash and card are revenue but they are not in the drawer.
   ========================================================================== */

var Money = (function () {

  var S = { tab: 'shift', expCat: 'all' };

  /* ------------------------------------------------------------- shell */

  function view() {
    var open = DB.currentShift();
    var debt = DB.debtTotal();

    var h = '<div class="page-head"><div><h1>' + t('mn_title') + '</h1>' +
      '<div class="sub">' + t('mn_sub') + '</div></div>' +
      '<div class="head-actions">' + exportButtons() + '</div></div>';

    h += '<div class="tabs mb">' +
      '<button class="tab ' + (S.tab === 'shift' ? 'on' : '') + '" data-mn="tab" data-t="shift">' +
        t('mn_shift') + (open ? '<span class="tab-dot on"></span>' : '') + '</button>' +
      '<button class="tab ' + (S.tab === 'expenses' ? 'on' : '') + '" data-mn="tab" data-t="expenses">' +
        t('mn_expenses') + '</button>' +
      '<button class="tab ' + (S.tab === 'debt' ? 'on' : '') + '" data-mn="tab" data-t="debt">' +
        t('mn_debt') + (debt ? '<span class="tab-dot"></span>' : '') + '</button>' +
    '</div>';

    return h + (S.tab === 'shift' ? shiftTab()
              : S.tab === 'expenses' ? expensesTab()
              : debtTab());
  }

  /* ------------------------------------------------------------- shift */

  function shiftTab() {
    var s = DB.currentShift();
    if (!s) return shiftClosed();

    var sum = DB.shiftSummary(s);

    var h = '<div class="grid stat-row mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('mn_open_since') + '</span>' +
        '<div class="val" style="font-size:21px">' + fmtTime(s.openedAt) + '</div>' +
        '<div class="foot">' + esc(s.user) + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_sales') + '</span>' +
        '<div class="val accent">' + moneyStat(sum.revenue) + '</div>' +
        '<div class="foot">' + sum.count + ' ' + t('invoices').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_in_drawer') + '</span>' +
        '<div class="val">' + moneyStat(sum.expected) + '</div>' +
        '<div class="foot">' + t('mn_expected_now') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_not_drawer') + '</span>' +
        '<div class="val">' + moneyStat(sum.offDrawer) + '</div>' +
        '<div class="foot">' + t('mn_settles_later') + '</div></div>' +
    '</div>';

    /* The arithmetic, written out. He should be able to check it by eye. */
    h += '<div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:start">';

    h += '<div class="card"><div class="card-head"><h3>' + t('mn_drawer_now') + '</h3>' +
      '<div class="card-actions muted small">' + s.id + '</div></div><div class="card-body">' +
      '<div class="mn-calc">' +
        row(t('mn_float'), s.float, '') +
        row(t('mn_cash_sales'), sum.drawerSales, 'plus') +
        (sum.settled ? row(t('mn_debt_settled'), sum.settled, 'plus') : '') +
        (sum.cashOut ? row(t('mn_cash_out'), -sum.cashOut, 'minus') : '') +
        '<div class="mn-line"></div>' +
        row(t('mn_expected'), sum.expected, 'total') +
      '</div>' +
      '<button class="btn btn-primary btn-block btn-lg mt" data-mn="close-shift">' +
        t('mn_close_shift') + '</button>' +
    '</div></div>';

    /* Where the money went, by method — the reason expected is not revenue. */
    h += '<div class="card"><div class="card-head"><h3>' + t('mn_by_method') + '</h3></div>' +
      '<div class="card-body">';
    var methods = Object.keys(sum.byMethod);
    if (!methods.length) {
      h += '<div class="cart-empty"><b>' + t('mn_no_sales_yet') + '</b>' + t('mn_no_sales_sub') + '</div>';
    } else {
      methods.sort(function (a, b) { return sum.byMethod[b] - sum.byMethod[a]; }).forEach(function (m) {
        var inDrawer = DB.drawerMethods.indexOf(m) > -1;
        h += '<div class="mn-method">' +
          '<span class="mm-dot' + (inDrawer ? ' in' : m === 'credit' ? ' owed' : '') + '"></span>' +
          '<span class="mm-name">' + esc(DB.payLabel(m)) + '</span>' +
          '<span class="mm-tag">' + t(inDrawer ? 'mn_in_box' : m === 'credit' ? 'mn_owed' : 'mn_to_account') + '</span>' +
          '<span class="mm-amt">' + money(sum.byMethod[m]) + '</span>' +
        '</div>';
      });
    }
    h += '</div></div></div>';

    return h;
  }

  function row(label, amount, cls) {
    return '<div class="mn-row ' + (cls || '') + '"><span>' + label + '</span>' +
           '<span class="num">' + (amount < 0 ? '− ' : '') + money(Math.abs(amount)) + '</span></div>';
  }

  function shiftClosed() {
    var last = DB.shifts.filter(function (x) { return x.closed; }).slice(-1)[0];

    var h = '<div class="card"><div class="card-body" style="text-align:center;padding:36px 24px">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square" ' +
        'style="width:42px;height:42px;fill:none;stroke:var(--brand);stroke-width:1.4;margin-bottom:14px">' +
        '<path d="M3 8h18v11H3zM3 8l2-4h14l2 4M12 12v3"/></svg>' +
      '<h3 style="font-size:18px;margin-bottom:8px">' + t('mn_no_shift') + '</h3>' +
      '<p class="muted" style="max-width:420px;margin:0 auto 20px;font-size:13px;line-height:1.6">' +
        t('mn_no_shift_sub') + '</p>' +
      '<button class="btn btn-primary btn-lg" data-mn="open-shift">' + t('mn_open_shift') + '</button>' +
    '</div></div>';

    if (last) {
      var good = last.diff === 0;
      h += '<div class="card mt"><div class="card-head"><h3>' + t('mn_last_shift') + '</h3>' +
        '<div class="card-actions muted small">' + last.id + ' · ' + esc(last.user) + '</div></div>' +
        '<div class="card-body"><div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
          '<div class="stat"><span class="eyebrow">' + t('date') + '</span>' +
            '<div class="val" style="font-size:15px">' + fmtDate(last.closedAt) + '</div></div>' +
          '<div class="stat"><span class="eyebrow">' + t('mn_expected') + '</span>' +
            '<div class="val" style="font-size:17px">' + moneyStat(last.expected) + '</div></div>' +
          '<div class="stat"><span class="eyebrow">' + t('mn_counted') + '</span>' +
            '<div class="val" style="font-size:17px">' + moneyStat(last.counted) + '</div></div>' +
          '<div class="stat"><span class="eyebrow">' + t('mn_difference') + '</span>' +
            '<div class="val ' + (good ? 'accent' : 'warn') + '" style="font-size:17px">' +
              (last.diff > 0 ? '+' : '') + money(last.diff) + '</div>' +
            '<div class="foot">' + t(good ? 'mn_balanced' : last.diff < 0 ? 'mn_short' : 'mn_over') + '</div></div>' +
        '</div></div></div>';
    }
    return h;
  }

  /* ---------------------------------------------------------- expenses */

  function expensesTab() {
    var month = DB.expensesInMonth(0), lastMonth = DB.expensesInMonth(1);
    var p = DB.netProfit(0);

    var h = '<div class="grid stat-row mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('mn_exp_month') + '</span>' +
        '<div class="val warn">' + moneyStat(month) + '</div>' +
        deltaTag(month, lastMonth, t('vs_last_month')) + '</div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_gross') + '</span>' +
        '<div class="val">' + moneyStat(p.gross) + '</div>' +
        '<div class="foot">' + t('mn_this_month') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_after_cost') + '</span>' +
        '<div class="val">' + moneyStat(p.grossProfit) + '</div>' +
        '<div class="foot">' + t('mn_minus_cogs') + '</div></div>' +
      /* The number that did not exist before this screen. */
      '<div class="stat"><span class="eyebrow">' + t('mn_net') + '</span>' +
        '<div class="val ' + (p.net >= 0 ? 'accent' : 'warn') + '">' + moneyStat(p.net) + '</div>' +
        '<div class="foot">' + t('mn_real_profit') + '</div></div>' +
    '</div>';

    /* Where it goes, biggest first. */
    var byCat = {};
    DB.expenses.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var maxCat = cats.length ? byCat[cats[0]] : 1;

    h += '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);align-items:start">';

    h += '<div class="card"><div class="card-head"><h3>' + t('mn_where') + '</h3>' +
      '<div class="card-actions"><button class="btn btn-sm btn-primary" data-mn="add-expense">+ ' +
        t('mn_add') + '</button></div></div><div class="card-body">';
    cats.forEach(function (c) {
      h += '<div class="mn-cat">' +
        '<span class="mc-name">' + t('mn_c_' + c) + '</span>' +
        '<span class="mc-bar"><i style="width:' + Math.round(byCat[c] / maxCat * 100) + '%"></i></span>' +
        '<span class="mc-amt">' + moneyShort(byCat[c]) + '</span></div>';
    });
    h += '</div></div>';

    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('date') + '</th><th>' + t('mn_category') + '</th><th>' + t('note') + '</th>' +
      '<th>' + t('payment') + '</th><th class="num">' + t('mn_amount') + '</th>' +
    '</tr></thead><tbody>';
    DB.expenses.slice(0, 40).forEach(function (e) {
      h += '<tr><td class="num muted">' + fmtDate(e.at) + '</td>' +
        '<td><span class="badge neutral">' + t('mn_c_' + e.category) + '</span></td>' +
        '<td class="muted">' + esc(e.note) + '</td>' +
        '<td class="muted">' + esc(DB.payLabel(e.method)) + '</td>' +
        '<td class="num"><b>' + money(e.amount) + '</b></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* -------------------------------------------------------------- debt */

  function debtTab() {
    var debts = DB.debts();
    var total = DB.debtTotal();
    var age = DB.debtAgeing();
    var over30 = debts.filter(function (d) { return d.age > 30; }).length;

    var h = '<div class="grid stat-row mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('mn_owed_total') + '</span>' +
        '<div class="val' + (total ? ' warn' : '') + '">' + moneyStat(total) + '</div>' +
        '<div class="foot">' + debts.length + ' ' + t('mn_people') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_over_30') + '</span>' +
        '<div class="val' + (over30 ? ' warn' : '') + '">' + over30 + '</div>' +
        '<div class="foot">' + t('mn_chase_these') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_oldest') + '</span>' +
        '<div class="val">' + (debts.length ? debts[0].age + '<span class="cur">' + t('yl_d') + '</span>' : '—') + '</div>' +
        '<div class="foot">' + (debts.length ? esc(debts[0].name) : '') + '</div></div>' +
    '</div>';

    if (total > 0) {
      h += '<div class="card mb"><div class="card-head"><h3>' + t('yl_ageing') + '</h3></div>' +
        '<div class="card-body"><div class="yl-age">';
      age.forEach(function (b) {
        var w = Math.round(b.value / total * 100);
        h += '<div class="yl-age-b' + (b.value ? ' on' : '') + '" style="flex:' + Math.max(1, w) + '">' +
          '<span class="ab-bar"></span><span class="ab-k">' + b.key + t('yl_d') + '</span>' +
          '<span class="ab-v">' + (b.value ? money(b.value) : '—') + '</span></div>';
      });
      h += '</div></div></div>';
    }

    if (!debts.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('mn_no_debt') + '</b>' +
             t('mn_no_debt_sub') + '</div></div>';
    }

    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('customer') + '</th><th>' + t('invoice') + '</th><th>' + t('date') + '</th>' +
      '<th class="num">' + t('total') + '</th><th class="num">' + t('yi_paid') + '</th>' +
      '<th class="num">' + t('mn_still_owed') + '</th><th>' + t('mn_age') + '</th><th></th>' +
    '</tr></thead><tbody>';

    debts.forEach(function (d) {
      var late = d.age > 30;
      h += '<tr class="' + (late ? 'row-late' : '') + '">' +
        '<td><b>' + nm(d.name) + '</b>' +
          (d.customer ? '<small class="muted" style="display:block">' + tel(d.customer.phone) + '</small>' : '') + '</td>' +
        '<td class="muted">' + d.sale.id + '</td>' +
        '<td class="num muted">' + fmtDate(d.sale.date) + '</td>' +
        '<td class="num">' + money(d.total) + '</td>' +
        '<td class="num muted">' + (d.paid ? money(d.paid) : '—') + '</td>' +
        '<td class="num"><b style="color:var(--warning)">' + money(d.balance) + '</b></td>' +
        '<td><span class="badge ' + (late ? 'critical' : 'neutral') + '">' + d.age + t('yl_d') + '</span></td>' +
        '<td style="white-space:nowrap">' +
          (d.customer ? '<button class="btn btn-sm btn-ghost" data-mn="remind" data-id="' + d.sale.id + '">' +
            t('mn_remind') + '</button> ' : '') +
          '<button class="btn btn-sm btn-primary" data-mn="settle" data-id="' + d.sale.id + '">' +
            t('mn_settle') + '</button></td></tr>';
    });

    return h + '</tbody></table></div>';
  }

  function fmtTime(d) {
    d = new Date(d);
    var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    return (hh % 12 || 12) + ':' + mm + ' ' + (hh >= 12 ? 'PM' : 'AM');
  }

  /* --------------------------------------------------------------- acts */

  var ACT = {
    tab: function (el) { S.tab = el.getAttribute('data-t'); render(); },

    'open-shift': function () {
      openModal({
        title: t('mn_open_shift'), size: 'narrow',
        body: '<label class="field"><span>' + t('mn_cashier') + '</span>' +
                '<select class="inp" id="mnUser">' +
                  DB.employees.filter(function (e) { return e.role === 'Cashier' || e.role === 'Manager'; })
                    .map(function (e) { return '<option>' + esc(e.name) + '</option>'; }).join('') +
                '</select></label>' +
              '<label class="field mt"><span>' + t('mn_float') + '</span>' +
                '<input class="inp num" id="mnFloat" type="number" min="0" value="200000"></label>' +
              '<div class="partner-note mt">' + t('mn_float_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="open-shift-go">' + t('mn_open_shift') + '</button>'
      });
    },

    'open-shift-go': function () {
      var user = (document.getElementById('mnUser') || {}).value;
      var f = parseInt((document.getElementById('mnFloat') || {}).value, 10) || 0;
      /* Server-first, like everything in this file. The drawer is money, and
         a shift that looks open and is not means a day of sales stamped to
         nothing. The server is also where the one-open-shift rule actually
         holds — checked here it was defeated by opening the screen on a
         second device. */
      Shop.write(
        function () { return Shop.openShift({ float: f, whId: DB.defaultWh }); },
        function () { return { shift: DB.openShift(user, f) }; },
        function (res) {
          var opened = res && res.shift;
          closeModal();
          render();
          if (opened) toast(opened.id, t('mn_shift_open') + ' · ' + money(f), 'ok', 3200);
        }
      );
    },

    'close-shift': function () {
      var s = DB.currentShift();
      if (!s) return;
      var sum = DB.shiftSummary(s);
      openModal({
        title: t('mn_close_shift') + ' · ' + s.id, size: 'narrow',
        body: '<div class="mn-calc">' +
                row(t('mn_float'), s.float, '') +
                row(t('mn_cash_sales'), sum.drawerSales, 'plus') +
                (sum.settled ? row(t('mn_debt_settled'), sum.settled, 'plus') : '') +
                (sum.cashOut ? row(t('mn_cash_out'), -sum.cashOut, 'minus') : '') +
                '<div class="mn-line"></div>' +
                row(t('mn_expected'), sum.expected, 'total') +
              '</div>' +
              '<label class="field mt"><span>' + t('mn_count_now') + '</span>' +
                '<input class="inp num" id="mnCounted" type="number" min="0" ' +
                  'placeholder="' + sum.expected + '"></label>' +
              '<div class="partner-note mt">' + t('mn_close_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="close-shift-go">' + t('mn_close_shift') + '</button>'
      });
    },

    'close-shift-go': function () {
      var s = DB.currentShift();
      if (!s) return;
      var el = document.getElementById('mnCounted');
      var counted = parseInt(el && el.value, 10);
      if (isNaN(counted) || counted < 0) { toast(t('mn_close_shift'), t('mn_count_needed'), 'warn'); return; }

      /* The difference comes back from the server rather than being worked
         out here: it computes what to expect from the sales, expenses and
         debt payments it actually holds, and freezes that figure onto the
         shift. A till that could name its own expected total could sign off
         a short drawer as exact. */
      Shop.write(
        function () { return Shop.closeShift(s.id, counted); },
        function () { DB.closeShift(s, counted); return { shift: s }; },
        function (res) {
          var done = (res && res.shift) || s;
          closeModal();
          render();
          var kind = done.diff === 0 ? 'ok' : Math.abs(done.diff) > 50000 ? 'err' : 'warn';
          toast(done.id + ' · ' + t('mn_closed'),
            done.diff === 0 ? t('mn_balanced')
              : (done.diff > 0 ? '+' : '') + money(done.diff) + ' · ' +
                t(done.diff < 0 ? 'mn_short' : 'mn_over'),
            kind, 6000);
        }
      );
    },

    'add-expense': function () {
      openModal({
        title: t('mn_add_expense'), size: 'narrow',
        body: '<label class="field"><span>' + t('mn_category') + '</span>' +
                '<select class="inp" id="mnCat">' +
                  DB.expenseCategories.map(function (c) {
                    return '<option value="' + c + '">' + t('mn_c_' + c) + '</option>';
                  }).join('') + '</select></label>' +
              '<label class="field mt"><span>' + t('mn_amount') + '</span>' +
                '<input class="inp num" id="mnAmt" type="number" min="1"></label>' +
              '<label class="field mt"><span>' + t('payment') + '</span>' +
                '<select class="inp" id="mnMethod">' +
                  ['cash', 'sham', 'fuad', 'card'].map(function (m) {
                    return '<option value="' + m + '">' + esc(DB.payLabel(m)) + '</option>';
                  }).join('') + '</select></label>' +
              '<label class="field mt"><span>' + t('note') + '</span>' +
                '<input class="inp" id="mnNote" type="text"></label>' +
              '<div class="partner-note mt">' + t('mn_expense_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="add-expense-go">' + t('save') + '</button>'
      });
    },

    'add-expense-go': function () {
      var amt = parseInt((document.getElementById('mnAmt') || {}).value, 10);
      if (!amt || amt <= 0) { toast(t('mn_add_expense'), t('mn_amount_needed'), 'warn'); return; }
      var body = {
        category: (document.getElementById('mnCat') || {}).value,
        amount: amt,
        method: (document.getElementById('mnMethod') || {}).value,
        note: (document.getElementById('mnNote') || {}).value
      };
      Shop.write(
        function () { return Shop.addExpense(body); },
        function () { return { expense: DB.newExpense(body) }; },
        function (res) {
          var e = res && res.expense;
          closeModal();
          render();
          if (!e) return;
          /* shift_id from the server, shiftId from the local mirror — the
             same fact under two spellings, because this is the one toast
             that reads a field the server named. */
          var fromDrawer = e.shiftId || e.shift_id;
          toast(t('mn_c_' + e.category), money(e.amount) +
            (fromDrawer ? ' · ' + t('mn_from_drawer') : ''), 'ok', 3200);
        }
      );
    },

    settle: function (el) {
      var s = DB.sale(el.getAttribute('data-id'));
      if (!s) return;
      var bal = DB.debtBalance(s);
      openModal({
        title: t('mn_settle') + ' · ' + esc(s.customerName), size: 'narrow',
        body: '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
                '<div class="stat"><span class="eyebrow">' + t('total') + '</span>' +
                  '<div class="val" style="font-size:17px">' + money(s.total) + '</div></div>' +
                '<div class="stat"><span class="eyebrow">' + t('mn_still_owed') + '</span>' +
                  '<div class="val warn" style="font-size:17px">' + money(bal) + '</div></div>' +
              '</div>' +
              '<label class="field mt"><span>' + t('yi_amount') + '</span>' +
                '<input class="inp num" id="mnPay" type="number" min="1" max="' + bal + '" value="' + bal + '"></label>' +
              '<label class="field mt"><span>' + t('payment') + '</span>' +
                '<select class="inp" id="mnPayMethod">' +
                  ['cash', 'sham', 'fuad', 'card'].map(function (m) {
                    return '<option value="' + m + '">' + esc(DB.payLabel(m)) + '</option>';
                  }).join('') + '</select></label>' +
              '<div class="partner-note mt">' + t('mn_settle_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="settle-go" data-id="' + s.id + '">' + t('save') + '</button>'
      });
    },

    'settle-go': function (el) {
      var id = el.getAttribute('data-id');
      var amt = parseInt((document.getElementById('mnPay') || {}).value, 10);
      var method = (document.getElementById('mnPayMethod') || {}).value;
      /* Money across the counter, and the one write here that carries an
         opId. A till that loses wifi mid-request does not know whether the
         payment landed, and tapping Save again must not clear the debt twice
         on one payment. The server recomputes the balance too — checked here
         it is only a courtesy, and two devices settling the same debt both
         pass a check made on screen. */
      var opId = 'dp-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      Shop.write(
        function () {
          return Shop.payDebt({ saleId: id, amount: amt, method: method, opId: opId });
        },
        function () {
          if (!DB.payDebt(id, amt, method)) return null;
          return { payment: { balance: DB.debtBalance(DB.sale(id)) } };
        },
        function (res) {
          if (!res) { toast(t('mn_settle'), t('yi_bad_amount'), 'err'); return; }
          closeModal();
          render();
          var sale = DB.sale(id);
          var left = res.payment ? res.payment.balance
                                 : (sale ? DB.debtBalance(sale) : 0);
          toast(esc(sale ? sale.customerName : id), money(amt) + ' · ' +
            (left ? t('mn_part_paid') + ' ' + money(left) : t('mn_cleared')),
            'ok', 4000);
        }
      );
    },

    /* Chasing a debt is a WhatsApp message here, not a letter. */
    remind: function (el) {
      var s = DB.sale(el.getAttribute('data-id'));
      if (!s || !s.customerId) return;
      var c = DB.customer(s.customerId);
      var bal = DB.debtBalance(s);
      WA.compose({
        title: t('mn_remind') + ' · ' + esc(c.name),
        to: c.phone, name: c.name, kind: 'debt-reminder',
        text: 'مرحباً ' + String(c.name).split(' ')[0] + '،\n\n' +
              'تذكير ودّي بخصوص الفاتورة ' + s.id + ' بتاريخ ' + fmtDate(s.date) + '.\n' +
              'المتبقّي: ' + money(bal) + '\n\nشكراً لك 🖤\n— ' + CONFIG.SHOP_NAME,
        note: t('mn_age') + ' ' + DB.daysSince(s.date) + t('yl_d') + ' · ' + money(bal)
      });
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-mn]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-mn')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
  }
  bind();

  /* Each tab exports itself. */
  function exportSpec() {
    if (S.tab === 'debt') {
      var d = DB.debts();
      return {
        name: 'debt-book', sheet: 'Debts', title: t('mn_debt'),
        subtitle: money(DB.debtTotal()) + ' · ' + fmtDate(TODAY),
        columns: [{ label: t('customer'), width: 26 }, { label: t('invoice') }, { label: t('date') },
                  { label: exCol(t('total')), num: true }, { label: exCol(t('yi_paid')), num: true },
                  { label: exCol(t('mn_still_owed')), num: true }, { label: t('mn_age'), num: true }],
        rows: d.map(function (x) {
          return [x.name, x.sale.id, fmtDate(x.sale.date), exMoney(x.total),
                  exMoney(x.paid), exMoney(x.balance), x.age];
        }),
        totals: [t('total'), null, null, null, null, exMoney(DB.debtTotal()), null],
        kpis: [{ label: t('mn_owed_total'), value: money(DB.debtTotal()) },
               { label: t('mn_people'), value: String(d.length) }]
      };
    }
    if (S.tab === 'expenses') {
      var p = DB.netProfit(0);
      return {
        name: 'expenses', sheet: 'Expenses', title: t('mn_expenses'),
        subtitle: fmtDate(TODAY),
        columns: [{ label: t('date') }, { label: t('mn_category') }, { label: t('note'), width: 30 },
                  { label: t('payment') }, { label: exCol(t('mn_amount')), num: true }],
        rows: DB.expenses.map(function (e) {
          return [fmtDate(e.at), t('mn_c_' + e.category), e.note,
                  DB.payLabel(e.method), exMoney(e.amount)];
        }),
        totals: [t('total'), null, null, null,
                 exMoney(DB.expenses.reduce(function (a, e) { return a + e.amount; }, 0))],
        kpis: [{ label: t('mn_gross'), value: money(p.gross) },
               { label: t('mn_exp_month'), value: money(p.expenses) },
               { label: t('mn_net'), value: money(p.net) }]
      };
    }
    var s = DB.currentShift();
    var sum = s ? DB.shiftSummary(s) : null;
    var closed = DB.shifts.filter(function (x) { return x.closed; });
    return {
      name: 'shifts', sheet: 'Shifts', title: t('mn_shift'),
      subtitle: (s ? s.id + ' · ' + t('mn_open_since') + ' ' + fmtTime(s.openedAt) : t('mn_no_shift')),
      columns: [{ label: t('mn_shift') }, { label: t('mn_cashier') }, { label: t('date') },
                { label: exCol(t('mn_expected')), num: true }, { label: exCol(t('mn_counted')), num: true },
                { label: exCol(t('mn_difference')), num: true }],
      rows: closed.map(function (x) {
        return [x.id, x.user, fmtDate(x.closedAt), exMoney(x.expected), exMoney(x.counted), exMoney(x.diff)];
      }),
      kpis: sum
        ? [{ label: t('mn_sales'), value: money(sum.revenue) },
           { label: t('mn_in_drawer'), value: money(sum.expected) },
           { label: t('mn_not_drawer'), value: money(sum.offDrawer) }]
        : [{ label: t('mn_no_shift'), value: '—' }]
    };
  }

  return { view: view, exportSpec: exportSpec, state: S };
})();
