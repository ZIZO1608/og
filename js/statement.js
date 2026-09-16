/* ==========================================================================
   THE MONTH'S STATEMENT                                            [data-pl]
   --------------------------------------------------------------------------
   The Statement tab of the Money screen. server/lib/statement.js does every
   sum, over every row; this draws what it says.

   Profit and loss first — sales, what came back, what the goods cost, what
   it cost to keep the doors open, and what is left. Then what is NOT a cost
   and must not be read as one (the owner's own money, suppliers paid for
   goods already counted). Then the cash flow: every place, what it held when
   the month began and ended, and what went through it.

   Lira and dollars are two columns. The "≈ in lira" column converts each row
   at the rate of its own day and says it is approximate — it is the only
   figure that adds the two.
   ========================================================================== */

var Statement = (function () {

  var ST = { month: null, data: null, at: 0, seq: 0, pending: null };

  function shopMonth() {
    return new Date(Date.now() + (CONFIG.TZ_MINUTES || 180) * 60000).toISOString().slice(0, 7);
  }
  function addMonths(ym, n) {
    var p = ym.split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + n, 1)).toISOString().slice(0, 7);
  }
  function monthName(ym) {
    var p = ym.split('-');
    return (OG.lang === 'ar' ? MONTHS_AR : MONTHS_EN)[Number(p[1]) - 1] + ' ' + p[0];
  }
  function signed(minor, cur) { return Cashbook.signed(minor, cur); }
  function plain(minor, cur) { return Cashbook.money(minor, cur); }
  function curs() { return (ST.data && ST.data.currencies) || Cashbook.currencies(); }
  function base() { return (ST.data && ST.data.base) || CONFIG.BASE_CURRENCY || 'SYP'; }

  function label(l) {
    if (l.key === 'expense') return Cashbook.catLabel(l.category);
    return t('pl_' + l.key);
  }

  function load(force) {
    var want = ST.month;
    if (!force && ST.data && ST.data.month === want && ST.at > Shop.loadedAt() && Date.now() - ST.at < 30000) return;
    if (!force && ST.pending === want) return;
    var seq = ++ST.seq;
    ST.pending = want;
    Shop.statement(want).then(function (r) {
      if (seq !== ST.seq) return;
      ST.data = r; ST.at = Date.now(); ST.pending = null;
      paint();
    }).catch(function (err) {
      if (seq !== ST.seq) return;
      ST.pending = null;
      toast(t('pl_tab'), API.friendly(err), 'err', 5000);
    });
  }

  function paint() {
    var host = document.getElementById('plBody');
    if (!host) return;
    host.innerHTML = body();
    if (typeof labelWideTables === 'function') labelWideTables(host);
  }

  function tab() {
    if (!ST.month) ST.month = shopMonth();
    load(false);
    return '<div class="py-month mb">' +
        '<button class="btn btn-ghost btn-sm" data-pl="month" data-n="-1" aria-label="' + esc(t('py_prev')) + '">‹</button>' +
        '<b class="py-month-lbl">' + esc(monthName(ST.month)) + '</b>' +
        '<button class="btn btn-ghost btn-sm" data-pl="month" data-n="1" aria-label="' + esc(t('py_next')) + '">›</button>' +
        (ST.month !== shopMonth() ? '<button class="btn btn-ghost btn-sm" data-pl="month" data-n="0">' + t('py_this_month') + '</button>' : '') +
      '</div>' +
      '<div id="plBody">' + body() + '</div>';
  }

  function find(key) {
    return ((ST.data && ST.data.lines) || []).filter(function (l) { return l.key === key; })[0] || null;
  }

  /* A stat card: one line per currency that has anything, and the lira
     estimate under it. */
  function stat(title, l, accent) {
    var h = '<div class="stat"><span class="eyebrow">' + title + '</span><div class="val py-val' +
      (accent && l && l.approx < 0 ? ' warn' : accent ? ' accent' : '') + '">';
    var any = false;
    curs().forEach(function (c) {
      if (l && l.amounts[c]) {
        h += (any ? '<br>' : '') + (accent ? signed(l.amounts[c], c) : plain(l.amounts[c], c));
        any = true;
      }
    });
    if (!any) h += '—';
    h += '</div>';
    if (l && curs().some(function (c) { return c !== base() && l.amounts[c]; })) {
      h += '<div class="foot">≈ ' + plain(l.approx, base()) + '</div>';
    }
    return h + '</div>';
  }

  function row(l, cls) {
    var h = '<tr class="' + (cls || '') + '"><td>' + (l.total ? '<b>' + esc(label(l)) + '</b>' : esc(label(l))) + '</td>';
    curs().forEach(function (c) {
      var v = l.amounts[c];
      h += '<td class="num">' + (v ? (l.total ? '<b>' + signed(v, c) + '</b>' : signed(v, c)) : '<span class="muted">—</span>') + '</td>';
    });
    h += '<td class="num muted">' + (l.approx === null || l.approx === undefined ? '' : l.approx ? signed(l.approx, base()) : '—') + '</td>';
    return h + '</tr>';
  }

  function head(first) {
    return '<thead><tr><th>' + first + '</th>' +
      curs().map(function (c) { return '<th class="num">' + c + '</th>'; }).join('') +
      '<th class="num">' + t('pl_approx') + '</th></tr></thead>';
  }

  function body() {
    var d = ST.data;
    if (!d || d.month !== ST.month) return '<div class="card"><div class="cart-empty"><b>' + t('cb_loading') + '</b></div></div>';
    var f = d.facts || {};

    var h = '<div class="grid stat-row py-stats mb">' +
      stat(t('pl_revenue'), find('revenue')) +
      stat(t('pl_gross'), find('gross')) +
      stat(t('pl_net'), find('net'), true) +
      '</div>';

    /* ---- profit and loss ---- */
    h += '<div class="card mb"><div class="card-head"><h3>' + t('pl_title') + '</h3>' +
      '<div class="card-actions muted small">' + t('pl_sales_n').replace('{n}', '<bdi dir="ltr">' + nf(f.sales || 0) + '</bdi>') + '</div></div>' +
      '<div class="table-wrap"><table class="tbl pl-tbl">' + head(t('pl_line')) + '<tbody>';
    d.lines.forEach(function (l) {
      if (!l.total && !Object.keys(l.amounts).length && l.key !== 'sales' && l.key !== 'cogs') return;
      h += row(l, l.total ? 'pl-total' + (l.key === 'net' ? ' pl-net' : '') : (l.key === 'expense' ? 'pl-sub' : ''));
    });
    h += '</tbody></table></div>';

    var notes = [];
    if (f.noCost) notes.push(t('pl_no_cost').replace('{n}', '<bdi dir="ltr">' + nf(f.noCost) + '</bdi>'));
    if (f.unconverted) notes.push(t('pl_unconverted'));
    if (f.printingOutside) notes.push(t('pl_printing'));
    notes.push(t('pl_approx_note'));
    if (f.booksFrom && f.booksFrom > d.from) {
      notes.push(t('pl_books_from').replace('{d}', '<bdi dir="auto">' + esc(fmtDate(new Date(f.booksFrom))) + '</bdi>'));
    }
    h += '<div class="card-body pl-notes">' + notes.map(function (n) { return '<p class="muted small">' + n + '</p>'; }).join('') + '</div></div>';

    /* ---- below the line ---- */
    var below = d.below.filter(function (l) { return Object.keys(l.amounts).length; });
    h += '<div class="card mb"><div class="card-head"><h3>' + t('pl_below') + '</h3></div>';
    if (!below.length) {
      h += '<div class="card-body"><p class="muted">' + t('pl_below_none') + '</p></div>';
    } else {
      h += '<div class="table-wrap"><table class="tbl pl-tbl">' + head(t('pl_line')) + '<tbody>' +
        below.map(function (l) { return row(l); }).join('') + '</tbody></table></div>';
    }
    h += '<div class="card-body"><p class="muted small">' + t('pl_below_note') + '</p></div></div>';

    /* ---- cash flow ---- */
    if (d.cash) h += cashFlow(d);
    return h;
  }

  function cashFlow(d) {
    var h = '<div class="card"><div class="card-head"><h3>' + t('pl_cash_title') + '</h3></div>';
    var list = d.cash.places.slice().sort(function (a, b) {
      return a.currency === b.currency ? Cashbook.placeName(a.place).localeCompare(Cashbook.placeName(b.place))
        : curs().indexOf(a.currency) - curs().indexOf(b.currency);
    });
    if (!list.length) {
      return h + '<div class="card-body"><p class="muted">' + t('pl_cash_none') + '</p></div></div>';
    }
    h += '<div class="table-wrap"><table class="tbl pl-cash"><thead><tr>' +
      '<th>' + t('cb_col_place') + '</th><th>' + t('cb_currency') + '</th>' +
      '<th class="num">' + t('pl_opening') + '</th><th class="num">' + t('pl_in') + '</th>' +
      '<th class="num">' + t('pl_out') + '</th><th class="num">' + t('pl_closing') + '</th></tr></thead><tbody>';
    list.forEach(function (r) {
      h += '<tr><td><b>' + esc(Cashbook.placeName(r.place)) + '</b></td><td>' + esc(r.currency) + '</td>' +
        '<td class="num">' + plain(r.opening, r.currency) + '</td>' +
        '<td class="num">' + (r.in ? signed(r.in, r.currency) : '—') + '</td>' +
        '<td class="num">' + (r.out ? signed(r.out, r.currency) : '—') + '</td>' +
        '<td class="num"><b class="' + (r.closing < 0 ? 'cb-warn-t' : '') + '">' + plain(r.closing, r.currency) + '</b></td></tr>';
    });
    Object.keys(d.cash.totals).sort(function (a, b) { return curs().indexOf(a) - curs().indexOf(b); }).forEach(function (c) {
      var x = d.cash.totals[c];
      h += '<tr class="pl-total"><td><b>' + t('total') + '</b></td><td>' + esc(c) + '</td>' +
        '<td class="num"><b>' + plain(x.opening, c) + '</b></td>' +
        '<td class="num"><b>' + signed(x.in, c) + '</b></td>' +
        '<td class="num"><b>' + signed(x.out, c) + '</b></td>' +
        '<td class="num"><b>' + plain(x.closing, c) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';

    /* What the money did, across every place — a transfer between two places
       is a zero here, which is right: it went nowhere. */
    h += '<div class="card-body"><h4 class="pl-h4">' + t('pl_by_kind') + '</h4><div class="pl-kinds">';
    Object.keys(d.cash.totals).forEach(function (c) {
      var k = d.cash.totals[c].kinds;
      Object.keys(k).filter(function (x) { return k[x]; }).sort(function (a, b) { return k[a] - k[b]; }).forEach(function (x) {
        h += '<div class="alert-row"><span class="alert-txt">' + esc(t('cb_k_' + x)) + '</span>' +
          '<span class="num">' + signed(k[x], c) + '</span></div>';
      });
    });
    h += '</div><p class="muted small mt">' + t('pl_cash_note') + '</p></div></div>';
    return h;
  }

  var ACT = {
    month: function (el) {
      var n = Number(el.getAttribute('data-n'));
      ST.month = n === 0 ? shopMonth() : addMonths(ST.month || shopMonth(), n);
      render();
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-pl]') : null;
    if (!el) return;
    var fn = ACT[el.getAttribute('data-pl')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  /* One sheet: a Section column, so the three parts filter apart. */
  function exportSpec() {
    var d = ST.data;
    var cs = curs();
    var cols = [{ label: t('pl_section'), width: 18 }, { label: t('pl_line'), width: 30 }]
      .concat(cs.map(function (c) { return { label: c, money: c }; }))
      .concat([{ label: t('pl_approx') + ' (' + base() + ')', money: base() }]);
    var whole = function (v, c) { return v / Math.pow(10, c === 'USD' ? 2 : 0); };
    var rows = [];
    var push = function (section, l) {
      rows.push([section, label(l)]
        .concat(cs.map(function (c) { return l.amounts[c] ? whole(l.amounts[c], c) : null; }))
        .concat([l.approx === null || l.approx === undefined ? null : whole(l.approx, base())]));
    };
    if (d && d.month === ST.month) {
      d.lines.forEach(function (l) { push(t('pl_title'), l); });
      d.below.forEach(function (l) { if (Object.keys(l.amounts).length) push(t('pl_below'), l); });
      if (d.cash) {
        d.cash.places.forEach(function (r) {
          var name = Cashbook.placeName(r.place);
          [['pl_opening', r.opening], ['pl_in', r.in], ['pl_out', r.out], ['pl_closing', r.closing]].forEach(function (x) {
            rows.push([t('pl_cash_title'), name + ' · ' + t(x[0])]
              .concat(cs.map(function (c) { return c === r.currency ? whole(x[1], c) : null; }))
              .concat([null]));
          });
        });
      }
    }
    var net = find('net');
    return {
      name: 'statement-' + (ST.month || ''), sheet: 'Statement',
      title: t('pl_tab') + ' · ' + monthName(ST.month || shopMonth()),
      subtitle: fmtDate(new Date()),
      columns: cols, rows: rows,
      kpis: net ? cs.filter(function (c) { return net.amounts[c]; }).map(function (c) {
        return { label: t('pl_net') + ' · ' + c, value: Cashbook.moneyText(net.amounts[c], c) };
      }) : []
    };
  }

  return { tab: tab, exportSpec: exportSpec, reload: function () { load(true); }, state: ST };
})();
