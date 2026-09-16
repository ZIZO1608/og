/* ==========================================================================
   MONEY — where it is, the drawer, the expenses, and الدين         [data-mn]
   --------------------------------------------------------------------------
   The things the shop kept on paper, one tab each — only the tabs the
   account may have are drawn.

   Now and Book are the cash book (053, js/cashbook.js): every place the
   shop's money physically is — the drawer, the owner's own pocket, each
   transfer office — and every move between them. Close the day is 054.
   Suppliers and Salaries are js/payables.js (055); Statement is
   js/statement.js. Shift, Expenses and Debt are the three that came first.

   Until the expenses existed, Reports showed REVENUE and called it profit.
   Gross, minus what the stock cost, minus rent and diesel and transport, is
   the number he actually lives on.

   The shift close is still here and still honest. It states what SHOULD be
   in the box, he counts what is, and the difference is shown without
   softening it. The whole thing is only worth anything because of one
   distinction: Sham Cash and card are revenue but they are not in the drawer.
   ========================================================================== */

var Money = (function () {

  var S = { tab: 'now' };

  /* ------------------------------------------------------------- shell */

  function base() { return CONFIG.BASE_CURRENCY || 'SYP'; }

  /* In the currency the money is actually in. money() assumes lira and
     converts with the header's switch — right for the shop's own figures,
     wrong for a dollar debt or a dollar expense. */
  function inCur(minor, cur) {
    if (!cur || cur === base()) return money(minor);
    return (typeof Desk !== 'undefined' && Desk.fmt) ? Desk.fmt(minor, cur) : nf(minor) + ' ' + cur;
  }
  function inCurText(minor, cur) {
    if (!cur || cur === base()) return money(minor);
    return (typeof Desk !== 'undefined' && Desk.moneyText) ? Desk.moneyText(minor, cur) : nf(minor) + ' ' + cur;
  }
  function toMinor(v, cur) {
    return (typeof Desk !== 'undefined' && Desk.toMinor)
      ? Desk.toMinor(v, cur)
      : Math.max(0, Math.round(Number(String(v || '').replace(/[^\d.]/g, '')) * (cur === 'USD' ? 100 : 1)));
  }

  function view() {
    var reads = allow('money.read');
    var counts = allow('money.count') || allow('money.move');
    var open = reads ? DB.currentShift() : null;
    var owed = reads && (DB.debtTotal() || DB.debtTotal(base() === 'USD' ? 'SYP' : 'USD'));

    /* ONLY THE TABS THIS ACCOUNT MAY HAVE (054). A cashier reaches this
       screen to count the drawer and nothing else — the others read the
       shop's money, which the server does not send her anyway. */
    var staff = allow('staff.read');
    var tabs = [];
    if (reads) tabs.push(['now', t('cb_now')]);
    if (counts) tabs.push(['close', t('dc_tab')]);
    if (reads) {
      tabs.push(['book', t('cb_book')]);
      tabs.push(['shift', t('mn_shift') + (open ? '<span class="tab-dot on"></span>' : '')]);
      tabs.push(['expenses', t('mn_expenses')]);
      tabs.push(['debt', t('mn_debt') + (owed ? '<span class="tab-dot"></span>' : '')]);
      /* 055: what the shop owes the people it buys from. */
      var dueSup = (DB.suppliers || []).some(function (x) { return x.outstanding > 0; });
      tabs.push(['suppliers', t('py_suppliers') + (dueSup ? '<span class="tab-dot"></span>' : '')]);
    }
    if (staff) tabs.push(['salaries', t('py_salaries')]);
    var profit = allow('profit.read');
    if (profit) tabs.push(['statement', t('pl_tab')]);
    if (!tabs.some(function (x) { return x[0] === S.tab; })) S.tab = tabs.length ? tabs[0][0] : 'close';

    var h = '<div class="page-head"><div><h1>' + t('mn_title') + '</h1>' +
      '<div class="sub">' + t(reads ? 'mn_sub' : counts ? 'dc_sub' : staff ? 'py_sub' : 'pl_sub') + '</div></div>' +
      (reads || staff || profit ? '<div class="head-actions">' + exportButtons() + '</div>' : '') + '</div>';

    if (tabs.length > 1) {
      h += '<div class="tabs mb">' + tabs.map(function (x) {
        return '<button class="tab ' + (S.tab === x[0] ? 'on' : '') + '" data-mn="tab" data-t="' + x[0] + '">' +
          x[1] + '</button>';
      }).join('') + '</div>';
    }

    return h + (S.tab === 'now' ? Cashbook.nowTab()
              : S.tab === 'close' ? Cashbook.closeTab()
              : S.tab === 'book' ? Cashbook.bookTab()
              : S.tab === 'shift' ? shiftTab()
              : S.tab === 'expenses' ? expensesTab()
              : S.tab === 'suppliers' ? Payables.suppliersTab()
              : S.tab === 'salaries' ? Payables.salariesTab()
              : S.tab === 'statement' ? Statement.tab()
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
        /* The delivery office's cash is inside `expected` — it has to be a
           line too, or the sum does not add up by eye. */
        (sum.orders ? row(t('mn_orders_in'), sum.orders, 'plus') : '') +
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
    /* NEWEST FIRST — that is the order the server sends shifts in
       (server/lib/money.js). This took the last element and so showed the
       OLDEST of sixty shifts under the heading "Last shift". */
    var last = DB.shifts.filter(function (x) { return x.closed; })[0];

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
    var canWrite = allow('money.write');

    /* The month's profit is the Statement's (server-side, every sale, both
       currencies). It used to be worked out here from the last 200 sales
       with lira and dollars added together. */
    var h = '<div class="grid stat-row py-stats mn-exp-stats mb">' +
      '<div class="stat"><span class="eyebrow">' + t('mn_exp_month') + '</span>' +
        '<div class="val warn">' + moneyStat(month) + '</div>' +
        deltaTag(month, lastMonth, t('vs_last_month')) + '</div>' +
      (allow('profit.read')
        ? '<div class="stat clickable" data-mn="tab" data-t="statement"><span class="eyebrow">' + t('mn_net') + '</span>' +
            '<div class="val py-val">' + t('pl_open') + ' →</div>' +
            '<div class="foot">' + t('pl_open_sub') + '</div></div>'
        : '') +
    '</div>';

    /* Where it goes, biggest first — the shop's own currency, voids left out,
       the same set the month's figure above is made of. */
    var byCat = {};
    DB.expenses.forEach(function (e) {
      if (e.voided || e.currency !== base()) return;
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var maxCat = cats.length ? byCat[cats[0]] : 1;

    h += '<div class="mn-exp-grid">';

    h += '<div class="card"><div class="card-head"><h3>' + t('mn_where') + '</h3>' +
      (canWrite ? '<div class="card-actions"><button class="btn btn-sm btn-primary" data-mn="add-expense">+ ' +
        t('mn_add') + '</button></div>' : '') + '</div><div class="card-body">';
    if (!cats.length) h += '<p class="muted">' + t('mn_no_expenses') + '</p>';
    cats.forEach(function (c) {
      h += '<div class="mn-cat">' +
        '<span class="mc-name">' + esc(Cashbook.catLabel(c)) + '</span>' +
        '<span class="mc-bar"><i style="width:' + Math.round(byCat[c] / maxCat * 100) + '%"></i></span>' +
        '<span class="mc-amt">' + moneyShort(byCat[c]) + '</span></div>';
    });
    h += '</div></div>';

    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('date') + '</th><th>' + t('mn_category') + '</th><th>' + t('note') + '</th>' +
      '<th>' + t('mn_paid_from') + '</th><th class="num">' + t('mn_amount') + '</th>' +
      (canWrite ? '<th></th>' : '') +
    '</tr></thead><tbody>';
    DB.expenses.forEach(function (e) {
      h += '<tr class="' + (e.voided ? 'mn-void' : '') + '"><td class="num muted">' + fmtDate(e.at) + '</td>' +
        '<td><span class="badge neutral">' + esc(Cashbook.catLabel(e.category)) + '</span>' +
          (e.voided ? ' <span class="badge critical">' + t('mn_voided') + '</span>' : '') + '</td>' +
        '<td class="muted">' + esc(e.note) + '</td>' +
        '<td class="muted">' + esc(e.place ? Cashbook.placeName(e.place) : DB.payLabel(e.method)) + '</td>' +
        '<td class="num"><b>' + inCur(e.amount, e.currency) + '</b></td>' +
        (canWrite ? '<td>' + (e.voided ? '' :
          '<button class="btn btn-sm btn-ghost" data-mn="void-expense" data-id="' + esc(e.id) + '">' +
            t('mn_void') + '</button>') + '</td>' : '') +
        '</tr>';
    });
    h += '</tbody></table>' +
      (DB.expenses.length >= 200 ? '<div class="partner-note mt">' + t('mn_exp_window') + '</div>' : '') +
      '</div></div>';
    return h;
  }

  /* -------------------------------------------------------------- debt */

  function debtTab() {
    var debts = DB.debts();
    var other = base() === 'USD' ? 'SYP' : 'USD';
    var total = DB.debtTotal();
    var totalOther = DB.debtTotal(other);
    var age = DB.debtAgeing();
    var over30 = debts.filter(function (d) { return d.age > 30; }).length;

    var h = '<div class="grid stat-row mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('mn_owed_total') + '</span>' +
        '<div class="val' + (total ? ' warn' : '') + '">' + moneyStat(total) + '</div>' +
        '<div class="foot">' + (totalOther ? '+ ' + inCur(totalOther, other) + ' · ' : '') +
          debts.length + ' ' + t('mn_people') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_over_30') + '</span>' +
        '<div class="val' + (over30 ? ' warn' : '') + '">' + over30 + '</div>' +
        '<div class="foot">' + t('mn_chase_these') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('mn_oldest') + '</span>' +
        '<div class="val">' + (debts.length ? debts[0].age + '<span class="cur">' + t('yl_d') + '</span>' : '—') + '</div>' +
        '<div class="foot">' + (debts.length ? esc(debts[0].name) : '') + '</div></div>' +
    '</div>';

    if (total > 0) {
      h += '<div class="card mb"><div class="card-head"><h3>' + t('yl_ageing') + '</h3>' +
        (totalOther ? '<div class="card-actions muted small">' + esc(base()) + '</div>' : '') + '</div>' +
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
        '<td class="num">' + inCur(d.total, d.currency) + '</td>' +
        '<td class="num muted">' + (d.paid ? inCur(d.paid, d.currency) : '—') + '</td>' +
        '<td class="num"><b style="color:var(--warning)">' + inCur(d.balance, d.currency) + '</b></td>' +
        '<td><span class="badge ' + (late ? 'critical' : 'neutral') + '">' + d.age + t('yl_d') + '</span></td>' +
        '<td style="white-space:nowrap">' +
          (d.customer ? '<button class="btn btn-sm btn-ghost" data-mn="remind" data-id="' + d.sale.id + '">' +
            t('mn_remind') + '</button> ' : '') +
          (allow('debt.collect') ? '<button class="btn btn-sm btn-primary" data-mn="settle" data-id="' + d.sale.id + '">' +
            t('mn_settle') + '</button>' : '') + '</td></tr>';
    });

    return h + '</tbody></table></div>';
  }

  function fmtTime(d) {
    d = new Date(d);
    var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    return (hh % 12 || 12) + ':' + mm + ' ' + (hh >= 12 ? 'PM' : 'AM');
  }

  /* The methods a debt can be settled by: the owner's own list, never the
     four the till started with — a customer settling by Haram or Tarabut
     had no way to be recorded. Credit and delivery orders are never offered. */
  function debtMethods() {
    var list = DB.payMethodsFor('debt');
    return list.length ? list.map(function (m) { return m.id; }) : ['cash', 'sham', 'fuad', 'card'];
  }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
                '<input class="inp num" id="mnFloat" type="number" min="0" value="0"></label>' +
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

    /* COUNT BEFORE YOU LOOK. The dialog used to print the expected figure
       and put it in the box as a placeholder, which is the exact thing its
       own hint told people not to do. The figure comes back after the count. */
    'close-shift': function () {
      var s = DB.currentShift();
      if (!s) return;
      openModal({
        title: t('mn_close_shift') + ' · ' + s.id, size: 'narrow',
        body: '<label class="field"><span>' + t('mn_count_now') + '</span>' +
                '<input class="inp num" id="mnCounted" type="number" min="0" dir="ltr"></label>' +
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
                t(done.diff < 0 ? 'mn_short' : 'mn_over') +
                ' · ' + t('mn_expected') + ' ' + money(done.expected),
            kind, 6000);
        }
      );
    },

    /* An expense names WHERE it was paid from — the drawer, the owner's own
       cash, a wallet — in either currency, on the day it was paid. */
    'add-expense': function () {
      var places = Cashbook.pickable();
      var curs = (DB.cash && DB.cash.currencies ? DB.cash.currencies.map(function (c) { return c.code; }) : ['SYP', 'USD']);
      openModal({
        title: t('mn_add_expense'), size: 'narrow',
        body: '<label class="field"><span>' + t('mn_category') + '</span>' +
                '<select class="inp" id="mnCat">' +
                  DB.expenseCategories.map(function (c) {
                    return '<option value="' + esc(c) + '">' + esc(Cashbook.catLabel(c)) + '</option>';
                  }).join('') + '</select></label>' +
              '<div class="cb-pair">' +
                '<label class="field"><span>' + t('cb_currency') + '</span><select class="inp" id="mnCur">' +
                  curs.map(function (c) {
                    return '<option value="' + c + '"' + (c === base() ? ' selected' : '') + '>' + c + '</option>';
                  }).join('') + '</select></label>' +
                '<label class="field"><span>' + t('mn_amount') + '</span>' +
                  '<input class="inp num" id="mnAmt" type="text" inputmode="decimal" dir="ltr" autocomplete="off"></label>' +
              '</div>' +
              '<label class="field mt"><span>' + t('mn_paid_from') + '</span>' +
                (places.length
                  ? '<select class="inp" id="mnPlace">' + places.map(function (p) {
                      return '<option value="' + esc(p.id) + '">' + esc(Cashbook.placeName(p.id)) + '</option>';
                    }).join('') + '</select>'
                  : '<select class="inp" id="mnMethod">' + debtMethods().map(function (m) {
                      return '<option value="' + esc(m) + '">' + esc(DB.payLabel(m)) + '</option>';
                    }).join('') + '</select>') +
              '</label>' +
              '<label class="field mt"><span>' + t('date') + '</span>' +
                '<input class="inp" id="mnDate" type="date" dir="ltr" max="' + todayYmd() + '" value="' + todayYmd() + '"></label>' +
              '<label class="field mt"><span>' + t('note') + '</span>' +
                '<input class="inp" id="mnNote" type="text" maxlength="300"></label>' +
              '<div class="partner-note mt">' + t('mn_expense_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="add-expense-go">' + t('save') + '</button>'
      });
    },

    'add-expense-go': function () {
      var cur = (document.getElementById('mnCur') || {}).value || base();
      var amt = toMinor((document.getElementById('mnAmt') || {}).value, cur);
      if (!amt || amt <= 0) { toast(t('mn_add_expense'), t('mn_amount_needed'), 'warn'); return; }
      var place = (document.getElementById('mnPlace') || {}).value || null;
      var ymd = (document.getElementById('mnDate') || {}).value || '';
      var body = {
        category: (document.getElementById('mnCat') || {}).value,
        amount: amt,
        currency: cur,
        place: place,
        method: place ? null : (document.getElementById('mnMethod') || {}).value,
        note: (document.getElementById('mnNote') || {}).value,
        /* A LOCAL day. Today stays "now" so the order of today's rows is the
           order they happened; an earlier day is that day's noon, which no
           time zone can push into the next or previous date. */
        at: !ymd || ymd === todayYmd() ? null : new Date(ymd + 'T12:00:00').toISOString()
      };
      Shop.write(
        function () { return Shop.addExpense(body); },
        function () { return { expense: DB.newExpense(body) }; },
        function (res) {
          var e = res && res.expense;
          closeModal();
          render();
          if (!e) return;
          toast(Cashbook.catLabel(e.category), inCurText(e.amount, e.currency || cur) +
            ' · ' + Cashbook.placeName(e.place || place || 'drawer'), 'ok', 3600);
        }
      );
    },

    'void-expense': function (el) {
      var id = el.getAttribute('data-id');
      var e = DB.expenses.filter(function (x) { return x.id === id; })[0];
      if (!e) return;
      openModal({
        title: t('mn_void') + ' · ' + esc(id), size: 'narrow',
        body: '<p>' + esc(Cashbook.catLabel(e.category)) + ' · <b>' + inCur(e.amount, e.currency) + '</b> · ' +
                esc(fmtDate(e.at)) + '</p>' +
              '<p class="muted small">' + t('mn_void_hint') + '</p>' +
              '<label class="field mt"><span>' + t('mn_void_why') + '</span>' +
                '<input class="inp" id="mnWhy" type="text" maxlength="200"></label>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-danger" data-mn="void-expense-go" data-id="' + esc(id) + '">' + t('mn_void') + '</button>'
      });
    },

    'void-expense-go': function (el) {
      var id = el.getAttribute('data-id');
      var why = (document.getElementById('mnWhy') || {}).value || null;
      Shop.write(function () { return Shop.voidExpense(id, why); }, null, function () {
        closeModal();
        toast(id, t('mn_voided_toast'), 'ok', 3200);
      });
    },

    settle: function (el) {
      var s = DB.sale(el.getAttribute('data-id'));
      if (!s) return;
      var bal = DB.debtBalance(s);
      var cur = s.currency || base();
      openModal({
        title: t('mn_settle') + ' · ' + esc(s.customerName), size: 'narrow',
        body: '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
                '<div class="stat"><span class="eyebrow">' + t('total') + '</span>' +
                  '<div class="val" style="font-size:17px">' + inCur(s.total, cur) + '</div></div>' +
                '<div class="stat"><span class="eyebrow">' + t('mn_still_owed') + '</span>' +
                  '<div class="val warn" style="font-size:17px">' + inCur(bal, cur) + '</div></div>' +
              '</div>' +
              /* In the debt's own currency: the server refuses any other, and a
                 dollar debt is typed in dollars ("12,50"), never in cents. */
              '<label class="field mt"><span>' + t('yi_amount') + ' · ' + esc(cur) + '</span>' +
                '<input class="inp num" id="mnPay" type="text" inputmode="decimal" dir="ltr" value="' +
                  esc(cur === 'USD' ? (bal / 100).toFixed(2) : String(bal)) + '"></label>' +
              '<label class="field mt"><span>' + t('payment') + '</span>' +
                '<select class="inp" id="mnPayMethod">' +
                  debtMethods().map(function (m) {
                    return '<option value="' + esc(m) + '">' + esc(DB.payLabel(m)) + '</option>';
                  }).join('') + '</select></label>' +
              '<div class="partner-note mt">' + t('mn_settle_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-mn="settle-go" data-id="' + s.id + '" data-op="' +
                'dp-' + s.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '">' + t('save') + '</button>'
      });
    },

    'settle-go': function (el) {
      var id = el.getAttribute('data-id');
      var sale = DB.sale(id);
      var cur = (sale && sale.currency) || base();
      var amt = toMinor((document.getElementById('mnPay') || {}).value, cur);
      var method = (document.getElementById('mnPayMethod') || {}).value;
      if (!amt) { toast(t('mn_settle'), t('mn_amount_needed'), 'warn'); return; }
      /* Money across the counter, so it carries an opId — minted when the
         dialog opened, so a second press of Save on a stalled line is the
         same payment rather than a second one. The server recomputes the
         balance too; checked here it is only a courtesy. */
      var opId = el.getAttribute('data-op');
      Shop.write(
        function () {
          return Shop.payDebt({ saleId: id, amount: amt, method: method, currency: cur, opId: opId });
        },
        function () {
          if (!DB.payDebt(id, amt, method)) return null;
          return { payment: { balance: DB.debtBalance(DB.sale(id)) } };
        },
        function (res) {
          if (!res) { toast(t('mn_settle'), t('yi_bad_amount'), 'err'); return; }
          closeModal();
          render();
          var s2 = DB.sale(id);
          var left = res.payment ? res.payment.balance
                                 : (s2 ? DB.debtBalance(s2) : 0);
          toast(s2 ? s2.customerName : id, inCurText(amt, cur) + ' · ' +
            (left ? t('mn_part_paid') + ' ' + inCurText(left, cur) : t('mn_cleared')),
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
      var cur = s.currency || base();
      var owed = function (ar) {
        if (cur === base()) return WA.cash(bal, ar);
        return (typeof Desk !== 'undefined' && Desk.moneyText) ? Desk.moneyText(bal, cur) : nf(bal) + ' ' + cur;
      };
      /* Both languages, like every WhatsApp message (WA.both). */
      var part = function (ar) {
        return [
          WA.hi(c.name, ar),
          '',
          ar ? 'تذكير ودّي بخصوص الفاتورة *' + s.id + '* بتاريخ ' + WA.day(s.date, true) + '.'
             : 'A friendly reminder about invoice *' + s.id + '* from ' + WA.day(s.date, false) + '.',
          (ar ? '💰 المتبقّي: *' : '💰 Still to pay: *') + owed(ar) + '*',
          '',
          (ar ? 'شكراً لك 🖤' : 'Thank you 🖤'),
          '— ' + CONFIG.SHOP_NAME
        ];
      };
      WA.compose({
        title: t('mn_remind') + ' · ' + esc(c.name),
        to: c.phone, name: c.name, kind: 'debt-reminder',
        text: WA.both(part(true), part(false)),
        note: t('mn_age') + ' ' + DB.daysSince(s.date) + t('yl_d') + ' · ' + inCurText(bal, cur)
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
    if (S.tab === 'book') return Cashbook.exportSpec();
    if (S.tab === 'close') return Cashbook.closeExportSpec();
    if (S.tab === 'suppliers' || S.tab === 'salaries') return Payables.exportSpec(S.tab);
    if (S.tab === 'statement') return Statement.exportSpec();
    if (S.tab === 'now') {
      var c = DB.cash;
      var ps = c ? c.places : [];
      return {
        name: 'money-now', sheet: 'Where the money is', title: t('cb_now'),
        subtitle: fmtDate(new Date()),
        columns: [{ label: t('cb_col_place'), width: 28 }, { label: t('cb_col_kind') },
                  { label: 'SYP', money: 'SYP' }, { label: 'USD', money: 'USD' },
                  { label: t('cb_checked'), date: true }],
        rows: ps.map(function (p) {
          var b = p.balances || {};
          return [Cashbook.placeName(p.id), t('cb_kind_' + p.kind),
                  b.SYP === undefined ? null : b.SYP,
                  b.USD === undefined ? null : b.USD / 100,
                  p.lastCheck ? new Date(p.lastCheck) : null];
        }),
        totals: [t('total'), null,
                 c && c.totals.SYP !== undefined ? c.totals.SYP : null,
                 c && c.totals.USD !== undefined ? c.totals.USD / 100 : null, null]
      };
    }
    if (S.tab === 'debt') {
      var d = DB.debts();
      return {
        name: 'debt-book', sheet: 'Debts', title: t('mn_debt'),
        subtitle: money(DB.debtTotal()) + ' · ' + fmtDate(TODAY),
        columns: [{ label: t('customer'), width: 26 }, { label: t('invoice') }, { label: t('date') },
                  { label: 'SYP', money: 'SYP' }, { label: 'USD', money: 'USD' },
                  { label: t('yi_paid') }, { label: t('mn_age'), num: true }],
        rows: d.map(function (x) {
          var whole = x.balance / (x.currency === 'USD' ? 100 : 1);
          return [x.name, x.sale.id, fmtDate(x.sale.date),
                  x.currency === 'USD' ? null : whole,
                  x.currency === 'USD' ? whole : null,
                  x.paid ? inCurText(x.paid, x.currency) : '', x.age];
        }),
        totals: [t('total'), null, null, DB.debtTotal('SYP'), DB.debtTotal('USD') / 100, null, null],
        kpis: [{ label: t('mn_owed_total'), value: money(DB.debtTotal()) },
               { label: t('mn_people'), value: String(d.length) }]
      };
    }
    if (S.tab === 'expenses') {
      var live = DB.expenses.filter(function (e) { return !e.voided; });
      return {
        name: 'expenses', sheet: 'Expenses', title: t('mn_expenses'),
        subtitle: fmtDate(TODAY),
        columns: [{ label: t('date') }, { label: t('mn_category') }, { label: t('note'), width: 30 },
                  { label: t('mn_paid_from') },
                  { label: 'SYP', money: 'SYP' }, { label: 'USD', money: 'USD' }],
        rows: live.map(function (e) {
          var whole = e.amount / (e.currency === 'USD' ? 100 : 1);
          return [fmtDate(e.at), Cashbook.catLabel(e.category), e.note,
                  e.place ? Cashbook.placeName(e.place) : DB.payLabel(e.method),
                  e.currency === 'USD' ? null : whole, e.currency === 'USD' ? whole : null];
        }),
        totals: [t('total'), null, null, null,
                 live.reduce(function (a, e) { return e.currency === 'USD' ? a : a + e.amount; }, 0),
                 live.reduce(function (a, e) { return e.currency === 'USD' ? a + e.amount / 100 : a; }, 0)],
        kpis: [{ label: t('mn_exp_month'), value: money(DB.expensesInMonth(0)) }]
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
