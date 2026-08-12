/* ==========================================================================
   YALLA WEAR — partner portal
   --------------------------------------------------------------------------
   A full-screen takeover of the OG shell: same components, same engine, the
   partner's own brand (navy + mint, via the [data-portal="yalla"] token
   override in style.css).

   Every screen here reads ONLY from DB.partnerView() / DB.partnerJobs().
   The customer's name, their phone number and the price OG charges them are
   not hidden by a template — they never leave data.js. Yalla Wear does see
   its own payout, because that is their money.
   ========================================================================== */

var YALLA = (function () {

  var S = { view: 'today', filter: 'open' };

  var DAILY_CAPACITY = 60;          // pieces the partner can print per day

  var NAV = [
    { id: 'today',    key: 'yl_today',    icon: 'M3 12h4l2 6 4-13 2 7h6' },
    { id: 'queue',    key: 'yl_queue',    icon: 'M4 6h16M4 12h16M4 18h10' },
    { id: 'earnings', key: 'yl_earnings', icon: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }
  ];

  /* ------------------------------------------------------------- derived */

  function jobs(includeDone) { return DB.partnerJobs(includeDone); }

  function openJobs() { return jobs(false); }

  function piecesDueWithin(days) {
    return openJobs().reduce(function (a, j) {
      var d = DB.daysSince(j.deadline);
      return (d >= -days) ? a + j.qty : a;
    }, 0);
  }

  function earnedIn(monthsBack) {
    var start = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsBack, 1);
    var end = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsBack + 1, 1);
    return jobs(true).reduce(function (a, j) {
      return (j.created >= start && j.created < end) ? a + j.payout : a;
    }, 0);
  }

  function sizeChips(sizes) {
    return Object.keys(sizes || {}).map(function (k) {
      return '<span class="yl-size"><b>' + k + '</b>' + sizes[k] + '</span>';
    }).join('');
  }

  /* --------------------------------------------------------------- shell */

  function sidebar() {
    var h = '<div class="brand">' +
      '<div class="brand-mark"><img src="assets/yalla-mark.svg" alt="Yalla Wear"></div>' +
      '<div class="brand-text"><b>YALLA WEAR</b><span>' + t('yl_tagline') + '</span></div>' +
    '</div><nav class="nav">';

    h += '<div class="nav-label">' + t('yl_production') + '</div>';
    NAV.forEach(function (n) {
      var badge = n.id === 'queue' ? openJobs().filter(function (j) { return j.overdue; }).length : 0;
      h += '<button class="nav-item' + (S.view === n.id ? ' active' : '') + '" data-yl="nav" data-view="' + n.id + '">' +
        '<span class="nav-icon"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg></span>' +
        '<span class="nav-txt">' + t(n.key) + '</span>' +
        (badge ? '<span class="nav-badge">' + badge + '</span>' : '') +
      '</button>';
    });

    h += '</nav>' +
      '<div class="yl-leave">' +
        '<div class="yl-leave-note">' + t('yl_partner_of') + '<b>OG SYSTEM</b></div>' +
        '<button class="btn btn-ghost btn-block btn-sm" data-act="partner-view">' + t('yl_back_og') + '</button>' +
      '</div>';
    return h;
  }

  function topbar() {
    return '<div class="yl-topline">' +
        '<span class="partner-chip">' + t('partner_access') + '</span>' +
        '<span class="muted small">' + t('yl_scope') + '</span>' +
      '</div>' +
      '<div class="spacer"></div>' +
      '<div class="seg">' +
        '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
        '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
      '</div>' +
      '<div class="seg">' +
        '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
        '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
      '</div>' +
      '<div class="user-chip"><span class="user-avatar">Y</span><span>' + t('yl_operator') + '</span></div>';
  }

  /* --------------------------------------------------------------- today */

  function viewToday() {
    var open = openJobs();
    var urgent = open.filter(function (j) { return j.priority === 'urgent'; });
    var overdue = open.filter(function (j) { return j.overdue; });
    var pieces = open.reduce(function (a, j) { return a + j.qty; }, 0);
    var week = piecesDueWithin(7);
    var earned = earnedIn(0), lastMonth = earnedIn(1);
    var load = Math.min(100, Math.round(week / (DAILY_CAPACITY * 7) * 100));

    var h = '<div class="page-head"><div><h1>' + t('yl_today') + '</h1>' +
      '<div class="sub">' + t('yl_today_sub') + ' · ' + fmtDate(TODAY) + '</div></div>' +
      '<div class="head-actions">' +
        '<button class="btn btn-primary" data-yl="nav" data-view="queue">' + t('yl_queue') + ' →</button>' +
      '</div></div>';

    h += '<div class="grid stat-row" style="grid-template-columns:repeat(5,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_open_jobs') + '</span><div class="val">' + open.length + '</div>' +
        '<div class="foot">' + overdue.length + ' ' + t('overdue').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_pieces') + '</span><div class="val accent">' + nf(pieces) + '</div>' +
        '<div class="foot">' + t('yl_in_queue') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_urgent') + '</span><div class="val">' + urgent.length + '</div>' +
        '<div class="foot">' + t('yl_priority_first') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_due_week') + '</span><div class="val">' + nf(week) + '</div>' +
        '<div class="foot">' + t('yl_pieces').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_earned_month') + '</span><div class="val">' + moneyStat(earned) + '</div>' +
        deltaTag(earned, lastMonth, t('vs_last_month')) + '</div>' +
    '</div>';

    /* The production line — the delivery metaphor applied to the whole shop */
    h += '<div class="card mt"><div class="card-head"><h3>' + t('yl_line') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_line_sub') + '</div></div>' +
      '<div class="card-body"><div class="yl-line">';
    DB.printStages.forEach(function (stage, i) {
      var inStage = jobs(true).filter(function (j) { return j.stage === stage; });
      var pcs = inStage.reduce(function (a, j) { return a + j.qty; }, 0);
      var hot = inStage.some(function (j) { return j.overdue; });
      h += (i ? '<span class="yl-line-arrow" aria-hidden="true"></span>' : '') +
        '<button class="yl-line-node' + (inStage.length ? ' on' : '') + (hot ? ' hot' : '') + '" ' +
          'data-yl="stage-filter" data-stage="' + stage + '">' +
          '<span class="yl-line-count">' + inStage.length + '</span>' +
          '<span class="yl-line-name">' + t('print_' + stage) + '</span>' +
          '<span class="yl-line-pcs">' + nf(pcs) + ' ' + t('pieces') + '</span>' +
        '</button>';
    });
    h += '</div></div></div>';

    /* Capacity — a number the partner actually cares about */
    h += '<div class="grid mt" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
      '<div class="card"><div class="card-head"><h3>' + t('yl_capacity') + '</h3>' +
        '<div class="card-actions"><span class="badge ' + (load > 85 ? 'critical' : load > 60 ? 'low' : 'healthy') + '">' + load + '%</span></div></div>' +
        '<div class="card-body">' +
          '<div class="bar-track" style="height:12px"><i class="lime" style="width:' + load + '%"></i></div>' +
          '<div class="mt small muted">' + nf(week) + ' ' + t('pieces') + ' ' + t('yl_vs_capacity') + ' ' +
            nf(DAILY_CAPACITY * 7) + ' ' + t('yl_per_week') + '</div>' +
        '</div></div>';

    h += '<div class="card"><div class="card-head"><h3>' + t('yl_next_up') + '</h3></div>';
    var next = open.slice(0, 4);
    next.forEach(function (j) {
      h += '<div class="alert-row">' +
        '<span class="alert-ico ' + (j.overdue ? 'red' : j.priority === 'urgent' ? 'amber' : 'grey') + '">' +
          (j.overdue ? '!' : j.qty) + '</span>' +
        '<span class="alert-txt"><b>' + j.id + '</b> · ' + esc(j.design.slice(0, 42)) +
          '<small>' + j.qty + ' ' + t('pieces') + ' · ' + (j.overdue
            ? ('<span style="color:var(--destructive);font-weight:700">' + t('overdue') + '</span>')
            : relDate(j.deadline)) + '</small></span>' +
        '<button class="btn btn-sm btn-ghost" data-yl="open" data-id="' + j.id + '">' + t('yl_open') + '</button>' +
      '</div>';
    });
    h += '</div></div>';

    return h;
  }

  /* --------------------------------------------------------------- queue */

  function viewQueue() {
    var list = jobs(S.filter === 'all');
    if (S.filter === 'urgent') list = list.filter(function (j) { return j.priority === 'urgent' || j.overdue; });
    else if (S.filter !== 'all' && S.filter !== 'open') list = list.filter(function (j) { return j.stage === S.filter; });

    /* late work first, then by deadline */
    list.sort(function (a, b) { return (b.overdue - a.overdue) || (a.deadline - b.deadline); });

    var h = '<div class="page-head"><div><h1>' + t('yl_queue') + '</h1>' +
      '<div class="sub">' + t('yl_queue_sub') + '</div></div>' +
      '<div class="head-actions"><span class="badge neutral">' + list.length + ' ' + t('yl_jobs') + '</span></div></div>';

    h += '<div class="filters"><div class="chip-row">' +
      '<button class="chip ' + (S.filter === 'open' ? 'on' : '') + '" data-yl="filter" data-f="open">' + t('yl_open_jobs') + '</button>' +
      '<button class="chip ' + (S.filter === 'urgent' ? 'on' : '') + '" data-yl="filter" data-f="urgent">' + t('yl_urgent_late') + '</button>';
    DB.printStages.forEach(function (st) {
      h += '<button class="chip ' + (S.filter === st ? 'on' : '') + '" data-yl="filter" data-f="' + st + '">' + t('print_' + st) + '</button>';
    });
    h += '<button class="chip ' + (S.filter === 'all' ? 'on' : '') + '" data-yl="filter" data-f="all">' + t('all_word') + '</button>' +
      '</div></div>';

    if (!list.length) {
      h += '<div class="card"><div class="cart-empty"><b>' + t('yl_all_clear') + '</b>' + t('yl_all_clear_sub') + '</div></div>';
      return h;
    }

    h += '<div class="yl-grid">';
    list.forEach(function (j) {
      var idx = DB.printStages.indexOf(j.stage);
      h += '<div class="yl-card' + (j.overdue ? ' overdue' : '') + '" data-yl="open" data-id="' + j.id + '">' +
        '<div class="yl-card-top">' +
          '<span class="yl-id">' + j.id + '</span>' +
          (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span>' : '') +
          '<span class="yl-due ' + (j.overdue ? 'late' : '') + '">' +
            (j.overdue ? t('overdue') + ' · ' + DB.daysSince(j.deadline) + 'd' : relDate(j.deadline)) + '</span>' +
        '</div>' +
        '<div class="yl-design">' + esc(j.design) + '</div>' +
        '<div class="yl-sizes">' + sizeChips(j.sizes) + '</div>' +
        stepper(j.stage, { history: j.history, overdue: j.overdue, compact: true }) +
        '<div class="yl-card-foot">' +
          '<span class="yl-qty"><b>' + j.qty + '</b> ' + t('pieces') + '</span>' +
          '<span class="yl-payout">' + money(j.payout) + '</span>' +
          (idx < DB.printStages.length - 1
            ? '<button class="btn btn-sm btn-primary" data-yl="advance" data-id="' + j.id + '">' +
                t('print_' + DB.printStages[idx + 1]) + ' →</button>'
            : '<span class="badge healthy">' + t('print_done') + '</span>') +
        '</div>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }

  /* ------------------------------------------------------------ earnings */

  function viewEarnings() {
    var all = jobs(true);
    var month = earnedIn(0), last = earnedIn(1);
    var unpaid = all.filter(function (j) { return j.stage !== 'done'; })
                    .reduce(function (a, j) { return a + j.payout; }, 0);
    var lifetime = all.reduce(function (a, j) { return a + j.payout; }, 0);
    var pieces = all.reduce(function (a, j) { return a + j.qty; }, 0);

    var h = '<div class="page-head"><div><h1>' + t('yl_earnings') + '</h1>' +
      '<div class="sub">' + t('yl_earnings_sub') + '</div></div>' +
      '<div class="head-actions">' +
        '<button class="btn btn-ghost" data-act="export" data-kind="excel">' + t('export_excel') + '</button>' +
        '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('export_pdf') + '</button>' +
        '<button class="btn btn-primary" data-yl="invoice">' + t('yl_invoice_og') + '</button>' +
      '</div></div>';

    h += '<div class="grid mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_earned_month') + '</span><div class="val accent">' + moneyStat(month) + '</div>' +
        deltaTag(month, last, t('vs_last_month')) + '</div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_unpaid') + '</span><div class="val">' + moneyStat(unpaid) + '</div>' +
        '<div class="foot">' + t('yl_on_open_jobs') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_lifetime') + '</span><div class="val">' + moneyStat(lifetime) + '</div>' +
        '<div class="foot">' + all.length + ' ' + t('yl_jobs').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_per_piece') + '</span><div class="val">' +
        moneyStat(pieces ? Math.round(lifetime / pieces) : 0) + '</div>' +
        '<div class="foot">' + nf(pieces) + ' ' + t('pieces') + '</div></div>' +
    '</div>';

    h += '<div class="card mb"><div class="card-head"><h3>' + t('yl_monthly') + '</h3></div>' +
      '<div class="card-body"><div class="chart-box" style="height:230px"><canvas id="ylChart"></canvas></div></div></div>';

    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('yl_job') + '</th><th>' + t('design_note') + '</th>' +
      '<th class="num">' + t('qty') + '</th><th>' + t('status') + '</th>' +
      '<th>' + t('deadline') + '</th><th class="num">' + t('yl_payout') + '</th>' +
    '</tr></thead><tbody>';
    all.slice().sort(function (a, b) { return b.created - a.created; }).forEach(function (j) {
      h += '<tr class="clickable" data-yl="open" data-id="' + j.id + '">' +
        '<td><b>' + j.id + '</b></td>' +
        '<td class="muted">' + esc(j.design.slice(0, 46)) + '</td>' +
        '<td class="num">' + j.qty + '</td>' +
        '<td><span class="badge ' + (j.stage === 'done' ? 'healthy' : 'neutral') + '">' + t('print_' + j.stage) + '</span></td>' +
        '<td class="num muted">' + fmtDate(j.deadline) + '</td>' +
        '<td class="num"><b>' + money(j.payout) + '</b></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td class="num">' + nf(pieces) + '</td>' +
      '<td></td><td></td><td class="num">' + money(lifetime) + '</td></tr></tfoot></table></div>';

    return h;
  }

  function afterEarnings() {
    var months = [], vals = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1);
      months.push(d.toLocaleDateString('en-GB', { month: 'short' }));
      vals.push(OG.currency === 'USD' ? earnedIn(i) / CONFIG.EXCHANGE_RATE : earnedIn(i));
    }
    Charts.bars(document.getElementById('ylChart'), months, vals, {
      highlight: 5,
      fmt: function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); }
    });
  }

  /* ---------------------------------------------------------- job drawer */

  function openJob(id) {
    var raw = DB.printJobs.filter(function (x) { return x.id === id; })[0];
    if (!raw) return;
    var j = DB.partnerView(raw);           // whitelist, even inside the portal
    var idx = DB.printStages.indexOf(j.stage);

    var head = '<div style="flex:1">' +
      '<span class="eyebrow">' + t('yl_job') + '</span>' +
      '<h3 style="font-size:20px;margin:4px 0 7px">' + j.id + '</h3>' +
      (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span> ' : '') +
      (j.overdue ? '<span class="badge critical">' + t('overdue') + '</span> ' : '') +
      '<span class="badge neutral">' + j.qty + ' ' + t('pieces') + '</span></div>';

    var body = '<div class="card mb"><div class="card-head"><h3>' + t('yl_progress') + '</h3>' +
      '<div class="card-actions muted small">' + (j.overdue
        ? '<span style="color:var(--destructive);font-weight:700">' + t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd</span>'
        : t('deadline') + ' ' + relDate(j.deadline)) + '</div></div>' +
      '<div class="card-body">' + stepper(j.stage, { history: j.history, overdue: j.overdue }) + '</div></div>';

    body += '<div class="card mb"><div class="card-head"><h3>' + t('design_note') + '</h3></div>' +
      '<div class="card-body"><p style="margin:0;font-size:14px;line-height:1.6">' + esc(j.design) + '</p></div></div>';

    body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_size_breakdown') + '</h3>' +
      '<div class="card-actions"><span class="badge accent">' + j.qty + '</span></div></div>' +
      '<div class="card-body"><div class="yl-sizes lg">' + sizeChips(j.sizes) + '</div></div></div>';

    body += '<div class="grid mb" style="grid-template-columns:1fr 1fr">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_payout') + '</span><div class="val accent">' + moneyStat(j.payout) + '</div>' +
        '<div class="foot">' + money(Math.round(j.payout / j.qty)) + ' / ' + t('yl_piece') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('deadline') + '</span><div class="val" style="font-size:16px">' +
        fmtDate(j.deadline) + '</div><div class="foot">' + relDate(j.deadline) + '</div></div>' +
    '</div>';

    body += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    if (idx < DB.printStages.length - 1) {
      body += '<button class="btn btn-primary btn-lg" data-yl="advance" data-id="' + j.id + '" data-close="1">' +
        t('yl_move_to') + ' ' + t('print_' + DB.printStages[idx + 1]) + '</button>';
    }
    body += '<button class="btn btn-ghost btn-lg" data-yl="work-order" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
            '<button class="btn btn-ghost btn-lg" data-yl="flag" data-id="' + j.id + '">' + t('yl_flag') + '</button></div>';

    body += '<div class="partner-note mt">' + t('partner_note') + '</div>';

    openDrawer({ head: head, body: body });
  }

  /* -------------------------------------------------------------- render */

  /* Partner exports carry Yalla Wear's brand, and only Yalla Wear's data —
     built from partnerView objects, so OG's pricing cannot reach the file.
     Each of the three pages exports itself, not the earnings sheet. */
  function exportSpec() {
    if (S.view === 'today')  return todaySpec();
    if (S.view === 'queue')  return queueSpec();
    return earningsSpec();
  }

  /* What is in each stage right now — the print floor's morning sheet. */
  function todaySpec() {
    var open = openJobs();
    var week = piecesDueWithin(7);
    var rows = DB.printStages.map(function (st) {
      var inSt = jobs(true).filter(function (j) { return j.stage === st; });
      return [t('print_' + st), inSt.length,
              inSt.reduce(function (a, j) { return a + j.qty; }, 0),
              inSt.filter(function (j) { return j.overdue; }).length];
    });
    return {
      theme: 'yalla', name: 'yalla-today', sheet: 'Today',
      title: t('yl_today'), subtitle: t('yl_line') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('status') }, { label: t('yl_jobs'), num: true },
                { label: t('pieces'), num: true }, { label: t('overdue'), num: true }],
      rows: rows,
      totals: [t('total'), open.length, open.reduce(function (a, j) { return a + j.qty; }, 0),
               open.filter(function (j) { return j.overdue; }).length],
      kpis: [{ label: t('yl_open_jobs'), value: nf(open.length) },
             { label: t('yl_due_week'), value: nf(week) + ' ' + t('pieces') },
             { label: t('yl_urgent'), value: nf(open.filter(function (j) { return j.priority === 'urgent'; }).length) }]
    };
  }

  /* The job list as a worksheet — what he has to print, in deadline order. */
  function queueSpec() {
    var list = jobs(false).slice().sort(function (a, b) {
      return (b.overdue - a.overdue) || (a.deadline - b.deadline);
    });
    return {
      theme: 'yalla', name: 'yalla-queue', sheet: 'Queue',
      title: t('yl_queue'), subtitle: list.length + ' ' + t('yl_jobs') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('yl_job') }, { label: t('design_note'), width: 40 },
                { label: t('qty'), num: true }, { label: t('yl_size_breakdown'), width: 24 },
                { label: t('priority') }, { label: t('deadline') }, { label: t('status') }],
      rows: list.map(function (j) {
        return [j.id, j.design, j.qty,
                Object.keys(j.sizes || {}).map(function (k) { return k + '×' + j.sizes[k]; }).join(' '),
                t(j.priority) + (j.overdue ? ' · ' + t('overdue') : ''),
                fmtDate(j.deadline), t('print_' + j.stage)];
      }),
      totals: [t('total'), null, list.reduce(function (a, j) { return a + j.qty; }, 0), null, null, null, null],
      kpis: [{ label: t('yl_open_jobs'), value: nf(list.length) },
             { label: t('pieces'), value: nf(list.reduce(function (a, j) { return a + j.qty; }, 0)) }]
    };
  }

  function earningsSpec() {
    var all = jobs(true);
    var pcs = all.reduce(function (a, j) { return a + j.qty; }, 0);
    var total = all.reduce(function (a, j) { return a + j.payout; }, 0);
    return {
      theme: 'yalla', name: 'yalla-earnings', sheet: 'Earnings',
      title: t('yl_earnings'), subtitle: t('yl_partner_of') + CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY),
      chartId: 'ylChart',
      columns: [{ label: t('yl_job') }, { label: t('design_note'), width: 36 },
                { label: t('qty'), num: true }, { label: t('status') },
                { label: t('deadline') }, { label: exCol(t('yl_payout')), num: true }],
      rows: all.map(function (j) {
        return [j.id, j.design, j.qty, t('print_' + j.stage), fmtDate(j.deadline), exMoney(j.payout)];
      }),
      totals: [t('total'), null, pcs, null, null, exMoney(total)],
      kpis: [{ label: t('yl_earned_month'), value: money(earnedIn(0)) },
             { label: t('yl_lifetime'), value: money(total) },
             { label: t('pieces'), value: nf(pcs) }]
    };
  }

  var VIEWS = { today: viewToday, queue: viewQueue, earnings: viewEarnings };

  function view() { return (VIEWS[S.view] || viewToday)(); }
  function after() { if (S.view === 'earnings') afterEarnings(); }

  /* --------------------------------------------------------------- acts */

  var ACT = {
    nav: function (el) { S.view = el.getAttribute('data-view'); closeDrawer(); repaint(); },
    filter: function (el) { S.filter = el.getAttribute('data-f'); repaint(); },
    'stage-filter': function (el) { S.view = 'queue'; S.filter = el.getAttribute('data-stage'); repaint(); },
    open: function (el) { openJob(el.getAttribute('data-id')); },

    advance: function (el) {
      var id = el.getAttribute('data-id');
      var job = DB.printJobs.filter(function (x) { return x.id === id; })[0];
      if (!job) return;
      var i = DB.printStages.indexOf(job.stage);
      if (i >= DB.printStages.length - 1) return;
      DB.setStage(job, DB.printStages[i + 1]);
      if (el.getAttribute('data-close')) closeDrawer();
      toast(job.id, t('yl_moved_to') + ' ' + t('print_' + job.stage), 'ok');
      repaint();
    },

    flag: function (el) {
      toast(el.getAttribute('data-id'), t('yl_flagged'), 'warn');
      closeDrawer();
    },

    /* The sheet that travels with the box. One job, everything needed to
       print it, and a QR back to the job in the system. */
    'work-order': function (el) {
      var raw = DB.printJobs.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      if (!raw) return;
      var j = DB.partnerView(raw);
      closeDrawer();
      Export.run({
        kind: 'pdf', theme: 'yalla', name: 'work-order-' + j.id,
        title: t('yl_work_order') + ' · ' + j.id,
        subtitle: t('deadline') + ' ' + fmtDate(j.deadline) + ' · ' + t(j.priority) +
                  (j.overdue ? ' · ' + t('overdue') : ''),
        docUrl: deepLink('job', j.id),
        columns: [{ label: t('size') }, { label: t('qty'), num: true }],
        rows: Object.keys(j.sizes || {}).map(function (k) { return [k, j.sizes[k]]; }),
        totals: [t('total'), j.qty],
        kpis: [{ label: t('qty'), value: nf(j.qty) + ' ' + t('pieces') },
               { label: t('status'), value: t('print_' + j.stage) },
               { label: t('design_note'), value: j.design }]
      });
    },

    /* A printable partner invoice — and the natural home for the full
       Yalla Wear lockup, which is too detailed for the 48px sidebar mark. */
    invoice: function () {
      var done = jobs(true).filter(function (j) { return j.stage === 'done'; });
      var total = done.reduce(function (a, j) { return a + j.payout; }, 0);
      var pcs = done.reduce(function (a, j) { return a + j.qty; }, 0);
      var no = 'YW-' + TODAY.getFullYear() + '-' + pad(TODAY.getMonth() + 1, 2);

      var body = '<div class="invoice-sheet yl-inv">' +
        '<div class="inv-top">' +
          '<div class="inv-logo"><img class="yl-lockup" src="assets/yalla-wear.svg" alt="Yalla Wear"></div>' +
          '<div class="inv-meta"><b>' + no + '</b><br>' + fmtDate(TODAY) + '<br>' + t('yl_billed_to') + ' OG SYSTEM</div>' +
        '</div>' +
        '<table class="inv-tbl"><thead><tr>' +
          '<th>' + t('yl_job') + '</th><th>' + t('design_note') + '</th>' +
          '<th class="num">' + t('qty') + '</th><th class="num">' + t('yl_payout') + '</th>' +
        '</tr></thead><tbody>';
      done.forEach(function (j) {
        body += '<tr><td>' + j.id + '</td><td>' + esc(j.design.slice(0, 44)) + '</td>' +
          '<td class="num">' + j.qty + '</td><td class="num">' + money(j.payout) + '</td></tr>';
      });
      body += '</tbody></table>' +
        '<div class="inv-sum"><div></div><div class="inv-totals">' +
          '<div class="tr"><span>' + t('yl_jobs') + '</span><span>' + done.length + '</span></div>' +
          '<div class="tr"><span>' + t('pieces') + '</span><span>' + nf(pcs) + '</span></div>' +
          '<div class="tr grand"><span>' + t('total') + '</span><span>' + money(total) + '</span></div>' +
        '</div></div>' +
        '<div class="inv-foot">' + t('yl_tagline') + ' · ' + t('yl_partner_of') + 'OG SYSTEM</div>' +
      '</div>';

      openModal({
        title: t('yl_invoice_og'), size: 'wide', body: body,
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
              '<button class="btn" data-act="print-now">' + t('print') + '</button>' +
              '<button class="btn btn-primary" data-yl="invoice-send">' + t('send') + '</button>'
      });
    },

    'invoice-send': function () {
      closeModal();
      toast(t('yl_invoice_og'), t('yl_invoice_sent'), 'ok', 3500);
    }
  };

  function repaint() {
    renderSidebar();
    render();
  }

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-yl]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-yl')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
  }
  bind();

  return {
    sidebar: sidebar,
    topbar: topbar,
    view: view,
    after: after,
    openJob: openJob,
    exportSpec: exportSpec,
    state: S,
    reset: function () { S.view = 'today'; S.filter = 'open'; }
  };
})();
