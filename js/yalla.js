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

  var S = { view: 'today', filter: 'open', mode: 'board', day: null, tab: 'money' };

  var DAILY_CAPACITY = 60;          // pieces the partner can print per day
  var RADAR_DAYS = 14;              // how far the deadline radar looks ahead

  var NAV = [
    { id: 'today',    key: 'yl_today',    icon: 'M3 12h4l2 6 4-13 2 7h6' },
    { id: 'queue',    key: 'yl_queue',    icon: 'M4 6h16M4 12h16M4 18h10' },
    { id: 'invoices', key: 'yl_invoices', icon: 'M6 2h9l5 5v15H6zM15 2v5h5M9 13h7M9 17h5' },
    { id: 'earnings', key: 'yl_earnings', icon: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }
  ];

  /* One icon per production stage, used by the line strip, the board columns
     and the activity feed, so a stage looks the same everywhere it appears. */
  var STAGE_ICON = {
    design:   'M3 21l3-1 11-11-2-2L4 18zM15 5l2-2 2 2-2 2',
    sent:     'M3 11l18-8-8 18-2-7z',
    printing: 'M7 8V3h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 15h10v6H7z',
    delivery: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
    done:     'M4 12.5L9 17.5 20 6.5'
  };

  function icon(path, cls) {
    return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" stroke-linecap="square"><path d="' + path + '"/></svg>';
  }

  /* ------------------------------------------------------------- derived */

  function jobs(includeDone) { return DB.partnerJobs(includeDone); }

  function openJobs() { return jobs(false); }

  function piecesDueWithin(days) {
    return openJobs().reduce(function (a, j) {
      var d = DB.daysSince(j.deadline);
      /* No deadline (null) is not "due now" — it is not due at all. */
      return (d !== null && d >= -days) ? a + j.qty : a;
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

  /* Midnight-normalised day offset: 0 = today, 1 = tomorrow, -2 = two days
     late. Everything on the radar and the heatmap keys off this, so a job due
     "today at 6pm" and one due "today at 9am" land in the same column. */
  function dayOffset(d) {
    var n = DB.daysSince(d);
    /* null stays null, so a job with no deadline matches no column at all
       rather than landing in today's (-null is -0, which === 0). */
    return n === null ? null : -n;
  }

  function jobsDueOn(off) {
    return openJobs().filter(function (j) { return dayOffset(j.deadline) === off; });
  }

  function piecesDueOn(off) {
    return jobsDueOn(off).reduce(function (a, j) { return a + j.qty; }, 0);
  }

  /* Sub-day precision, because the message feed is measured in hours. Falls
     back to the shared relDate() the moment it is a day or more old. */
  function agoShort(d) {
    var mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 2) return t('yl_just_now');
    if (mins < 60) return mins + t('yl_m');
    if (mins < 60 * 20) return Math.round(mins / 60) + t('yl_h');
    return relDate(d);
  }

  function dowLabel(d) {
    return d.toLocaleDateString(OG.lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short' });
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

  /* The partner's phone navigation. Four screens fit as four tabs, so unlike
     the OG side there is no More sheet. */
  function tabs() {
    return NAV.map(function (n) {
      var badge = n.id === 'queue' ? openJobs().filter(function (j) { return j.overdue; }).length : 0;
      return '<button class="tabbtn' + (S.view === n.id ? ' on' : '') + '" data-yl="nav" data-view="' + n.id + '">' +
        '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg>' +
          (badge ? '<i class="tb-dot"></i>' : '') + '</span>' +
        '<span class="tb-txt">' + t(n.key) + '</span></button>';
    }).join('') +
    '<button class="tabbtn" data-act="partner-view">' +
      '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M10 19l-7-7 7-7M3 12h18"/></svg></span>' +
      '<span class="tb-txt">OG</span></button>';
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
      (typeof Notify !== 'undefined' ? Notify.bell() : '') +
      '<div class="user-chip"><span class="user-avatar">Y</span><span>' + t('yl_operator') + '</span></div>';
  }

  /* ------------------------------------------------------------- widgets */

  /* DEADLINE RADAR — every open job as a dot on the day it is due, plus one
     cell on the left for everything already late. Dot size scales with piece
     count, so a 45-shirt job reads heavier than a 2-shirt one at a glance.
     Clicking a day drops straight into the queue filtered to it. */
  function radar() {
    var late = openJobs().filter(function (j) { return j.overdue; });
    var maxQty = Math.max(1, openJobs().reduce(function (m, j) { return Math.max(m, j.qty); }, 0));

    function dots(list) {
      if (!list.length) return '<span class="rd-none"></span>';
      var shown = list.slice(0, 4).map(function (j) {
        var size = 6 + Math.round(j.qty / maxQty * 9);
        return '<i class="rd-dot' + (j.priority === 'urgent' ? ' urgent' : '') +
               '" style="width:' + size + 'px;height:' + size + 'px"></i>';
      }).join('');
      return shown + (list.length > 4 ? '<span class="rd-more">+' + (list.length - 4) + '</span>' : '');
    }

    var h = '<div class="card mt"><div class="card-head"><h3>' + t('yl_radar') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_radar_sub') + '</div></div>' +
      '<div class="card-body"><div class="yl-radar">';

    h += '<button class="yl-rd late' + (late.length ? ' on' : '') + '" data-yl="day-filter" data-off="late">' +
      '<span class="rd-dow">' + t('yl_late') + '</span>' +
      '<span class="rd-num">' + late.length + '</span>' +
      '<span class="rd-dots">' + dots(late) + '</span></button>' +
      '<span class="rd-split" aria-hidden="true"></span>';

    for (var o = 0; o < RADAR_DAYS; o++) {
      var d = new Date(TODAY); d.setDate(d.getDate() + o);
      var list = jobsDueOn(o);
      var pcs = piecesDueOn(o);
      h += '<button class="yl-rd' + (list.length ? ' on' : '') + (o === 0 ? ' today' : '') +
             (pcs > DAILY_CAPACITY ? ' over' : '') + '" data-yl="day-filter" data-off="' + o + '">' +
        '<span class="rd-dow">' + (o === 0 ? t('today_word') : dowLabel(d)) + '</span>' +
        '<span class="rd-num">' + d.getDate() + '</span>' +
        '<span class="rd-dots">' + dots(list) + '</span></button>';
    }
    return h + '</div></div></div>';
  }

  /* CAPACITY HEATMAP — seven days of load against what the shop can actually
     print. The single percentage bar this replaces could read a comfortable
     54% while Thursday alone was at 200%; an average hides exactly the day
     that hurts. */
  function heatmap() {
    var h = '<div class="card"><div class="card-head"><h3>' + t('yl_heat') + '</h3>' +
      '<div class="card-actions muted small">' + nf(DAILY_CAPACITY) + ' ' + t('yl_per_day') + '</div></div>' +
      '<div class="card-body"><div class="yl-heat">';

    for (var o = 0; o < 7; o++) {
      var d = new Date(TODAY); d.setDate(d.getDate() + o);
      var pcs = piecesDueOn(o);
      var load = Math.round(pcs / DAILY_CAPACITY * 100);
      var lvl = pcs === 0 ? 0 : load <= 40 ? 1 : load <= 75 ? 2 : load <= 100 ? 3 : 4;
      h += '<button class="yl-hc l' + lvl + '" data-yl="day-filter" data-off="' + o + '" ' +
             'title="' + nf(pcs) + ' ' + t('pieces') + '">' +
        '<span class="hc-dow">' + (o === 0 ? t('today_word') : dowLabel(d)) + '</span>' +
        '<span class="hc-val">' + nf(pcs) + '</span>' +
        '<span class="hc-pct">' + (pcs ? load + '%' : '—') + '</span></button>';
    }
    h += '</div><div class="yl-heat-key">' +
      '<span class="hk l1"></span><span class="hk l2"></span><span class="hk l3"></span><span class="hk l4"></span>' +
      '<span class="muted small">' + t('yl_heat_key') + '</span></div>';
    return h + '</div></div>';
  }

  /* ACTIVITY FEED — messages, stage changes and overdue warnings on one
     timeline. Built from the same arrays the rest of the portal reads, so
     nothing here is a separate "activity log" that could fall out of step. */
  var FEED_ICON = {
    nudge:          'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 20h4',
    delay:          'M12 8v5M12 16h.01M10.3 3.9L2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z',
    note:           'M6 2h9l5 5v15H6zM15 2v5h5',
    'name-request': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h1M17 15v6M14 18h6',
    invoice:        'M6 2h9l5 5v15H6zM9 13h7M9 17h5',
    reminder:       'M12 7v5l3 2M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    stage:          'M4 12.5L9 17.5 20 6.5',
    overdue:        'M12 8v5M12 16h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'
  };

  function feedItems() {
    var out = [];

    DB.jobMessages.forEach(function (m) {
      out.push({
        at: m.at, kind: m.kind, unread: !m.readYl,
        who: m.from === 'og' ? CONFIG.SHOP_NAME.toUpperCase() : t('yl_you'),
        ref: m.jobId || m.invoiceId,
        jobId: m.jobId, invoiceId: m.invoiceId,
        text: m.text
      });
    });

    /* Stage changes inside the last week, from the stamped history. */
    jobs(true).forEach(function (j) {
      (j.history || []).forEach(function (hh) {
        if (DB.daysSince(hh.at) > 7 || hh.stage === 'design') return;
        out.push({ at: hh.at, kind: 'stage', ref: j.id, jobId: j.id,
                   who: t('yl_you'), text: t('yl_moved_to') + ' ' + t('print_' + hh.stage) });
      });
    });

    openJobs().filter(function (j) { return j.overdue; }).forEach(function (j) {
      out.push({ at: j.deadline, kind: 'overdue', ref: j.id, jobId: j.id, who: '',
                 text: t('yl_past_deadline') + ' · ' + DB.daysSince(j.deadline) + t('yl_d') });
    });

    return out.sort(function (a, b) { return new Date(b.at) - new Date(a.at); }).slice(0, 9);
  }

  function feed() {
    var items = feedItems();
    var h = '<div class="card"><div class="card-head"><h3>' + t('yl_activity') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_activity_sub') + '</div></div>';

    if (!items.length) {
      return h + '<div class="cart-empty"><b>' + t('yl_no_activity') + '</b>' + t('yl_no_activity_sub') + '</div></div>';
    }

    h += '<div class="yl-feed">';
    items.forEach(function (it) {
      h += '<button class="yl-fi' + (it.unread ? ' unread' : '') + ' k-' + it.kind + '"' +
        (it.jobId ? ' data-yl="open" data-id="' + it.jobId + '"'
                  : ' data-yl="open-invoice" data-id="' + it.invoiceId + '"') + '>' +
        '<span class="fi-ico">' + icon(FEED_ICON[it.kind] || FEED_ICON.note, 'ic') + '</span>' +
        '<span class="fi-body"><span class="fi-top"><b>' + esc(it.ref) + '</b>' +
          (it.who ? '<span class="fi-who">' + esc(it.who) + '</span>' : '') +
          '<span class="fi-ago">' + agoShort(it.at) + '</span></span>' +
        '<span class="fi-txt">' + esc(it.text) + '</span></span></button>';
    });
    return h + '</div></div>';
  }

  /* MONEY — the four numbers a subcontractor actually opens an app to see. */
  function moneyCard() {
    var out = DB.outstandingTotal();
    var thisMonth = DB.paidInMonth(0), lastMonth = DB.paidInMonth(1);
    var avg = DB.avgDaysToPay();
    var unbilled = DB.unbilledTotal();
    var age = DB.invoiceAgeing();
    var overdue = DB.partnerInvoices.filter(function (i) { return DB.invoiceOverdue(i); });

    var h = '<div class="card"><div class="card-head"><h3>' + t('yl_money') + '</h3>' +
      '<div class="card-actions">' +
        (overdue.length ? '<span class="badge critical">' + overdue.length + ' ' + t('overdue').toLowerCase() + '</span> ' : '') +
        '<button class="btn btn-sm btn-ghost" data-yl="nav" data-view="invoices">' + t('yl_view_invoices') + ' →</button>' +
      '</div></div><div class="card-body">';

    h += '<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_outstanding') + '</span>' +
        '<div class="val' + (out ? ' warn' : '') + '">' + moneyStat(out) + '</div>' +
        '<div class="foot">' + t('yl_from_og') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_invoiced_month') + '</span>' +
        '<div class="val accent">' + moneyStat(thisMonth) + '</div>' +
        deltaTag(thisMonth, lastMonth, t('vs_last_month')) + '</div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_avg_pay') + '</span>' +
        '<div class="val">' + (avg === null ? '—' : avg + '<span class="cur">' + t('yl_days') + '</span>') + '</div>' +
        '<div class="foot">' + t('yl_avg_pay_sub') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_unbilled') + '</span>' +
        '<div class="val">' + moneyStat(unbilled) + '</div>' +
        '<div class="foot">' + t('yl_unbilled_sub') + '</div></div>' +
    '</div>';

    /* Ageing, but only when there is something to age. An all-zero bar is
       noise on a dashboard. */
    if (out > 0) {
      h += '<div class="yl-age mt">';
      age.forEach(function (b) {
        var wpct = Math.round(b.value / out * 100);
        h += '<div class="yl-age-b' + (b.value ? ' on' : '') + '" style="flex:' + Math.max(1, wpct) + '">' +
          '<span class="ab-bar"></span>' +
          '<span class="ab-k">' + b.key + t('yl_d') + '</span>' +
          '<span class="ab-v">' + (b.value ? moneyShort(b.value) : '—') + '</span></div>';
      });
      h += '</div>';
    }

    return h + '</div></div>';
  }

  /* --------------------------------------------------------------- today */

  function viewToday() {
    var open = openJobs();
    var urgent = open.filter(function (j) { return j.priority === 'urgent'; });
    var overdue = open.filter(function (j) { return j.overdue; });
    var pieces = open.reduce(function (a, j) { return a + j.qty; }, 0);
    var week = piecesDueWithin(7);
    var earned = earnedIn(0), lastMonth = earnedIn(1);
    var blocked = open.reduce(function (a, j) { return a + (j.tbc || 0); }, 0);

    var h = '<div class="page-head"><div><h1>' + t('yl_today') + '</h1>' +
      '<div class="sub">' + t('yl_today_sub') + ' · ' + fmtDate(TODAY) + '</div></div>' +
      '<div class="head-actions">' +
        exportButtons() +
        '<button class="btn btn-primary" data-yl="nav" data-view="queue">' + t('yl_queue') + ' →</button>' +
      '</div></div>';

    /* New work to say yes or no to comes before everything else on the day —
       OG is waiting on this answer before anything can start. */
    h += inboxHTML();

    /* The one thing that stops the shop dead gets its own banner rather than
       a quiet number in a stat card. Five shirts nobody can print is not a
       statistic, it is a phone call OG has to make this morning. */
    if (blocked) {
      var blockedJobs = open.filter(function (j) { return j.tbc; });
      h += '<div class="yl-block">' +
        '<span class="yb-ico">' + icon(FEED_ICON['name-request'], 'ic') + '</span>' +
        '<span class="yb-txt"><b>' + blocked + ' ' + t('yl_blocked_head') + '</b>' +
          '<small>' + blockedJobs.map(function (j) { return j.id + ' (' + j.tbc + ')'; }).join(' · ') +
          ' — ' + t('yl_blocked_sub') + '</small></span>' +
        '<button class="btn btn-sm btn-primary" data-yl="ask-names" data-id="' +
          blockedJobs[0].id + '">' + t('yl_request_names') + '</button>' +
      '</div>';
    }

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
      var blocked = inStage.reduce(function (a, j) { return a + (j.tbc || 0); }, 0);
      h += (i ? '<span class="yl-line-arrow" aria-hidden="true"></span>' : '') +
        '<button class="yl-line-node' + (inStage.length ? ' on' : '') + (hot ? ' hot' : '') + '" ' +
          'data-yl="stage-filter" data-stage="' + stage + '">' +
          '<span class="yl-line-ico">' + icon(STAGE_ICON[stage]) + '</span>' +
          '<span class="yl-line-count">' + inStage.length + '</span>' +
          '<span class="yl-line-name">' + t('print_' + stage) + '</span>' +
          '<span class="yl-line-pcs">' + nf(pcs) + ' ' + t('pieces') + '</span>' +
          (blocked ? '<span class="yl-line-tbc">' + blocked + ' ' + t('yl_tbc') + '</span>' : '') +
        '</button>';
    });
    h += '</div></div></div>';

    h += radar();

    /* Two balanced columns rather than two stacked rows.
       Previously Capacity sat alone beside the much taller Activity feed and
       left roughly 300px of empty navy underneath it. Pairing the short card
       with Money, and the tall one with Next up, makes both columns land at
       about the same height and the dead space disappears. */
    h += '<div class="grid mt" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);align-items:start">' +
      '<div class="yl-stack">' + heatmap() + moneyCard() + '</div>' +
      '<div class="yl-stack">' + feed() + nextUp(open, week) + '</div>' +
    '</div>';

    /* Their phone. Linking the bot is a one-time job, so it sits last. */
    h += '<div class="card mt tg-card"><div class="card-head"><h3>' + t('tg_title') + '</h3>' +
      '<div class="card-actions muted small">' + t('tg_sub') + '</div></div>' +
      '<div class="card-body"><div id="tgHost" class="tg-host">' + t('tg_loading') + '</div></div></div>';

    return h;
  }

  /* ---- the Telegram line ----------------------------------------------------
     One card, two homes: the shop's Settings fold and the partner's Today
     screen draw it from the same status call, and the server decides whose
     bot it is talking about from the account. Linking is: press Connect,
     read a six-letter code, send it to the bot. The card polls while a code
     is live so "linked" appears without anyone pressing anything. */
  var TG = { status: null, code: null, watching: false };

  function tgCardHtml(s) {
    if (!s) return '<div class="muted small">' + t('tg_loading') + '</div>';
    var h = '';
    if (!s.configured) {
      return '<div class="tg-off"><b>' + t('tg_no_token') + '</b><small>' +
        (Notify.side() === 'og' ? t('tg_no_token_how') : t('tg_no_token_partner')) + '</small></div>';
    }
    if (s.linked) {
      h += '<div class="tg-row on"><span class="tg-dot"></span><div class="tg-txt"><b>' + t('tg_linked_to') +
        ' ' + esc(s.chatTitle || '') + '</b><small>' + (s.bot ? '@' + esc(s.bot) + ' · ' : '') +
        (s.queued ? s.queued + ' ' + t('tg_queued') : t('tg_all_sent')) +
        (s.failed ? ' · <span style="color:var(--destructive)">' + s.failed + ' ' + t('tg_failed') + '</span>' : '') +
        (s.lastError ? ' · ' + esc(String(s.lastError).slice(0, 80)) : '') + '</small></div></div>' +
        '<div class="tg-acts"><button class="btn btn-sm" data-yl="tg-test">' + t('tg_test') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-yl="tg-unlink">' + t('tg_unlink') + '</button></div>';
      return h;
    }
    h += '<div class="tg-row"><span class="tg-dot off"></span><div class="tg-txt"><b>' + t('tg_not_linked') +
      '</b><small>' + (s.bot ? '@' + esc(s.bot) : '') + '</small></div></div>';
    if (TG.code && new Date(TG.code.expires) > Date.now()) {
      var link = s.bot ? 'https://t.me/' + encodeURIComponent(s.bot) + '?start=' + TG.code.code : null;
      h += '<div class="tg-code-box"><span class="eyebrow">' + t('tg_code_hint') + '</span>' +
        '<div class="tg-code" dir="ltr">' + TG.code.code + '</div>' +
        (link ? '<a class="btn btn-primary btn-block" href="' + link + '" target="_blank" rel="noopener">' +
                  t('tg_open_bot') + '</a>' : '') +
        '<small class="muted">' + t('tg_waiting') + '</small></div>';
    } else {
      h += '<div class="tg-acts"><button class="btn btn-primary" data-yl="tg-link">' + t('tg_connect') + '</button></div>';
    }
    return h;
  }

  function tgPaint() {
    var host = document.getElementById('tgHost');
    if (host) host.innerHTML = tgCardHtml(TG.status);
    var meta = document.getElementById('tgMeta');
    if (meta && TG.status) {
      meta.innerHTML = !TG.status.configured ? t('tg_no_token')
        : TG.status.linked ? t('tg_linked_to') + ' ' + esc(TG.status.chatTitle || '')
        : t('tg_not_linked');
    }
  }

  function telegramLoad() {
    var host = document.getElementById('tgHost');
    if (!host) return;
    if (typeof Shop === 'undefined' || !Shop.live()) { host.innerHTML = ''; return; }
    Shop.telegramStatus().then(function (s) {
      TG.status = s;
      tgPaint();
    }).catch(function (e) {
      host.innerHTML = '<div class="muted small">' + esc(API.friendly ? API.friendly(e) : String(e)) + '</div>';
    });
  }

  /* While a code is live, ask every few seconds whether it has been used. */
  function tgWatch() {
    if (TG.watching) return;
    TG.watching = true;
    (function again() {
      setTimeout(function () {
        if (!TG.code || new Date(TG.code.expires) <= Date.now()) { TG.code = null; TG.watching = false; tgPaint(); return; }
        if (typeof Shop === 'undefined' || !Shop.live()) { TG.watching = false; return; }
        Shop.telegramStatus().then(function (s) {
          TG.status = s;
          if (s.linked) {
            TG.code = null; TG.watching = false;
            toast(t('tg_title'), t('tg_linked') + ' ' + (s.chatTitle || ''), 'ok', 4000);
            tgPaint();
            return;
          }
          tgPaint();
          again();
        }).catch(function () { again(); });
      }, 4000);
    })();
  }

  function nextUp(open, week) {
    var h = '<div class="card"><div class="card-head"><h3>' + t('yl_next_up') + '</h3>' +
      '<div class="card-actions muted small">' + nf(week) + ' ' + t('pieces') + ' ' + t('yl_vs_capacity') + ' ' +
        nf(DAILY_CAPACITY * 7) + '</div></div>';
    var next = open.slice(0, 5);
    if (!next.length) {
      h += '<div class="cart-empty"><b>' + t('yl_all_clear') + '</b>' + t('yl_all_clear_sub') + '</div>';
    }
    next.forEach(function (j) {
      var unread = DB.unreadOnJob('yalla', j.id);
      h += '<div class="alert-row">' +
        '<span class="alert-ico ' + (j.overdue ? 'red' : j.priority === 'urgent' ? 'amber' : 'grey') + '">' +
          (j.overdue ? '!' : j.qty) + '</span>' +
        '<span class="alert-txt"><b>' + j.id + '</b> · ' + esc(j.design.slice(0, 38)) +
          (j.tbc ? ' <span class="badge tbc">' + j.tbc + ' ' + t('yl_tbc') + '</span>' : '') +
          (unread ? ' <span class="dot-new" title="' + unread + '"></span>' : '') +
          '<small>' + j.qty + ' ' + t('pieces') + ' · ' + (j.overdue
            ? ('<span style="color:var(--destructive);font-weight:700">' + t('overdue') + '</span>')
            : relDate(j.deadline)) + '</small></span>' +
        '<button class="btn btn-sm btn-ghost" data-yl="open" data-id="' + j.id + '">' + t('yl_open') + '</button>' +
      '</div>';
    });
    return h + '</div>';
  }

  /* --------------------------------------------------------------- queue */

  /* The single source of "which jobs is the queue showing right now". The
     board, the list and the export all call this, so a filter can never mean
     one thing on screen and another in the exported file. */
  function queueList() {
    var list = jobs(S.filter === 'all');
    if (S.filter === 'urgent') list = list.filter(function (j) { return j.priority === 'urgent' || j.overdue; });
    else if (S.filter === 'tbc') list = list.filter(function (j) { return j.tbc > 0; });
    else if (S.filter !== 'all' && S.filter !== 'open') list = list.filter(function (j) { return j.stage === S.filter; });

    if (S.day !== null && S.day !== undefined) {
      list = (S.day === 'late')
        ? list.filter(function (j) { return j.overdue; })
        : list.filter(function (j) { return dayOffset(j.deadline) === +S.day; });
    }

    /* late work first, then by deadline */
    return list.sort(function (a, b) { return (b.overdue - a.overdue) || (a.deadline - b.deadline); });
  }

  function dayChipLabel() {
    if (S.day === 'late') return t('yl_late');
    var d = new Date(TODAY); d.setDate(d.getDate() + (+S.day));
    return (+S.day === 0 ? t('today_word') : dowLabel(d) + ' ' + d.getDate());
  }

  function queueFilters() {
    var h = '<div class="filters"><div class="chip-row">' +
      '<button class="chip ' + (S.filter === 'open' ? 'on' : '') + '" data-yl="filter" data-f="open">' + t('yl_open_jobs') + '</button>' +
      '<button class="chip ' + (S.filter === 'urgent' ? 'on' : '') + '" data-yl="filter" data-f="urgent">' + t('yl_urgent_late') + '</button>' +
      '<button class="chip ' + (S.filter === 'tbc' ? 'on' : '') + '" data-yl="filter" data-f="tbc">' + t('yl_tbc_filter') + '</button>';
    DB.printStages.forEach(function (st) {
      h += '<button class="chip ' + (S.filter === st ? 'on' : '') + '" data-yl="filter" data-f="' + st + '">' + t('print_' + st) + '</button>';
    });
    h += '<button class="chip ' + (S.filter === 'all' ? 'on' : '') + '" data-yl="filter" data-f="all">' + t('all_word') + '</button>';
    /* The day filter arrives from the radar, not from this row, so it needs a
       visible and dismissable chip of its own — otherwise an empty queue looks
       like a bug rather than a filter. */
    if (S.day !== null && S.day !== undefined) {
      h += '<button class="chip on chip-x" data-yl="clear-day">' + dayChipLabel() + ' ✕</button>';
    }
    return h + '</div></div>';
  }

  /* ---- new orders --------------------------------------------------------
     Offers from OG that have not been answered. These are deliberately NOT on
     the board: the job is not Yalla's until they take it, and a card sitting
     in the Design column would imply work already in hand.

     Everything needed to decide is on the card — what it is, how many, when
     OG wants it, and what it pays — so the answer does not require opening
     anything. */
  function inboxHTML() {
    var pending = DB.partnerInbox();
    if (!pending.length) return '';

    var h = '<div class="card mb yl-inbox"><div class="card-head">' +
      '<h3>' + t('yl_new_orders') +
        '<span class="badge urgent" style="margin-inline-start:8px">' + pending.length + '</span></h3>' +
      '<div class="card-actions muted small">' + t('yl_new_orders_sub') + '</div></div>' +
      '<div class="card-body">';

    pending.forEach(function (j) {
      var mins = Math.round((Date.now() - new Date(j.order.sentAt).getTime()) / 60000);
      var ago = mins < 60 ? mins + t('yl_m') : Math.round(mins / 60) + t('yl_h');
      h += '<div class="yl-offer' + (j.priority === 'urgent' ? ' urgent' : '') + '">' +
        '<div class="yl-offer-top">' +
          '<span class="yl-id">' + j.id + '</span>' +
          (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span>' : '') +
          '<span class="yl-offer-ago">' + t('yl_sent_ago') + ' ' + ago + '</span>' +
        '</div>' +
        '<div class="yl-offer-design">' + esc(j.design) + '</div>' +
        '<div class="yl-offer-meta">' +
          '<span><b>' + j.qty + '</b> ' + t('pieces') + '</span>' +
          '<span>' + t('yl_requested_by') + ' <b>' + fmtDate(j.deadline) + '</b></span>' +
          '<span class="accent"><b>' + money(j.payout) + '</b></span>' +
        '</div>' +
        '<div class="yl-offer-sizes">' + sizeChips(j.sizes) + '</div>' +
        '<div class="yl-offer-acts">' +
          '<button class="btn btn-ghost" data-yl="decline" data-id="' + j.id + '">' + t('yl_decline') + '</button>' +
          '<button class="btn btn-primary" data-yl="accept" data-id="' + j.id + '">' + t('yl_accept') + '</button>' +
        '</div>' +
      '</div>';
    });

    return h + '</div></div>';
  }

  function viewQueue() {
    var list = queueList();

    var pcs = list.reduce(function (a, j) { return a + j.qty; }, 0);

    var h = '<div class="page-head"><div><h1>' + t('yl_queue') + '</h1>' +
      '<div class="sub">' + t('yl_queue_sub') + '</div></div>' +
      '<div class="head-actions">' +
        '<span class="badge neutral">' + list.length + ' ' + t('yl_jobs') + ' · ' + nf(pcs) + ' ' + t('pieces') + '</span>' +
        /* The card grid is genuinely better than a board on a phone, so it
           stays as a mode rather than being replaced by one. */
        '<div class="seg">' +
          '<button data-yl="mode" data-m="board" class="' + (S.mode === 'board' ? 'on' : '') + '">' + t('yl_board') + '</button>' +
          '<button data-yl="mode" data-m="list" class="' + (S.mode === 'list' ? 'on' : '') + '">' + t('yl_list') + '</button>' +
        '</div>' +
        exportButtons() +
      '</div></div>';

    /* Above the filters: an unanswered offer outranks anything already on the
       board, and it must not be filterable out of sight. */
    h += inboxHTML();
    h += queueFilters();

    if (!list.length) {
      h += '<div class="card"><div class="cart-empty"><b>' + t('yl_all_clear') + '</b>' + t('yl_all_clear_sub') + '</div></div>';
      return h;
    }

    return h + (S.mode === 'board' ? boardHTML(list) : listHTML(list));
  }

  /* One card, used by both the board and the list. Everything that makes a
     job urgent is on it: late stripe, TBC count, unread messages, priority. */
  function jobCard(j, opts) {
    opts = opts || {};
    var idx = DB.printStages.indexOf(j.stage);
    var unread = DB.unreadOnJob('yalla', j.id);

    var h = '<div class="yl-card' + (j.overdue ? ' overdue' : '') + (j.tbc ? ' blocked' : '') +
              (opts.draggable ? ' drag' : '') + (opts.past ? ' past' : '') + '"' +
            (opts.draggable ? ' draggable="true"' : '') +
            ' data-yl="open" data-id="' + j.id + '">' +
      '<div class="yl-card-top">' +
        '<span class="yl-id">' + j.id + '</span>' +
        (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span>' : '') +
        (unread ? '<span class="dot-new" title="' + unread + '"></span>' : '') +
        '<span class="yl-due ' + (j.overdue ? 'late' : '') + '">' +
          (j.overdue ? t('overdue') + ' · ' + DB.daysSince(j.deadline) + t('yl_d') : relDate(j.deadline)) + '</span>' +
      '</div>' +
      '<div class="yl-design">' + esc(j.design) + '</div>';

    /* On a kit job the size chips are noise — what the printer needs to see
       is how many shirts still have no name on them. */
    if (j.tbc) {
      h += '<div class="yl-tbc-strip">' + icon(FEED_ICON['name-request'], 'ic') +
        '<b>' + j.tbc + '</b> ' + t('yl_tbc_pieces') + '</div>';
    } else {
      h += '<div class="yl-sizes">' + sizeChips(j.sizes) + '</div>';
    }

    if (!opts.compactSteps) {
      h += stepper(j.stage, { history: j.history, overdue: j.overdue, compact: true });
    }

    h += '<div class="yl-card-foot">' +
      '<span class="yl-qty"><b>' + j.qty + '</b> ' + t('pieces') + '</span>' +
      '<span class="yl-payout">' + money(j.payout) + '</span>';

    if (idx < DB.printStages.length - 1) {
      var next = DB.printStages[idx + 1];
      var blocked = DB.blockedBy(DB.job(j.id), next);
      h += '<button class="btn btn-sm ' + (blocked ? 'btn-ghost is-blocked' : 'btn-primary') + '" ' +
        'data-yl="advance" data-id="' + j.id + '"' + (blocked ? ' title="' + t('yl_blocked_tip') + '"' : '') + '>' +
        (blocked ? '🔒 ' : '') + t('print_' + next) + ' →</button>';
    } else {
      h += '<span class="badge healthy">' + t('print_done') + '</span>';
    }

    return h + '</div></div>';
  }

  function listHTML(list) {
    return '<div class="yl-grid">' + list.map(function (j) { return jobCard(j); }).join('') + '</div>';
  }

  /* BOARD — five columns, drag to advance. The drop calls DB.setStage, the
     same function the OG kanban calls, so history is stamped identically and
     the TBC gate applies to both boards without being written twice. */
  function boardHTML(list) {
    var h = '<div class="yl-board">';
    /* Design is OG's stage, not Yalla's. A job only reaches this board once it
       has been accepted, and accepting puts it straight on "Sent to print" —
       so the Design column can never hold anything and was a fifth of the
       width spent saying "nothing here". */
    DB.printStages.filter(function (s) { return s !== 'design'; }).forEach(function (st) {
      var col = list.filter(function (j) { return j.stage === st; });
      var pcs = col.reduce(function (a, j) { return a + j.qty; }, 0);
      var late = col.filter(function (j) { return j.overdue; }).length;

      /* The Done column is empty under every filter except "All", because
         done jobs are not open jobs. An always-empty final column makes the
         board look broken, so it falls back to the four most recent
         completions — shown muted and not draggable, so there is no doubt
         they are history rather than work in hand. */
      var recent = [];
      if (st === 'done' && !col.length) {
        recent = jobs(true).filter(function (j) { return j.stage === 'done'; })
          .sort(function (a, b) { return (DB.stageAt(DB.job(b.id), 'done') || 0) - (DB.stageAt(DB.job(a.id), 'done') || 0); })
          .slice(0, 4);
      }

      h += '<div class="yl-col s-' + st + '" data-stage="' + st + '">' +
        '<div class="yl-col-head">' +
          '<span class="yc-ico">' + icon(STAGE_ICON[st]) + '</span>' +
          '<span class="yc-name">' + t('print_' + st) + '</span>' +
          '<span class="yc-n">' + col.length + '</span>' +
        '</div>' +
        '<div class="yl-col-sub">' + nf(pcs) + ' ' + t('pieces') +
          (late ? ' · <b class="late">' + late + ' ' + t('overdue').toLowerCase() + '</b>' : '') +
          (recent.length ? ' · ' + t('yl_recent') : '') + '</div>' +
        '<div class="yl-col-body">';

      /* The tracker stays on board cards. The column already says which stage
         a job is in, but the tracker says WHEN each earlier stage happened —
         that stamped history is the whole point of the delivery metaphor, and
         dropping it to save 30px was the wrong trade. */
      if (!col.length && !recent.length) h += '<div class="yl-col-empty">' + t('yl_col_empty') + '</div>';
      col.forEach(function (j) { h += jobCard(j, { draggable: true }); });
      recent.forEach(function (j) { h += jobCard(j, { past: true }); });

      h += '</div></div>';
    });
    return h + '</div>';
  }

  /* Drag wiring. Runs after every render because the board is rebuilt each
     time; guarded so it is a no-op when the list view is showing. */
  function bindBoard() {
    var board = document.querySelector('.yl-board');
    if (!board) return;
    var dragId = null;

    board.querySelectorAll('.yl-card.drag').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        dragId = card.getAttribute('data-id');
        card.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
        e.dataTransfer.effectAllowed = 'move';

        /* Light up only the columns this job can legally reach, so a blocked
           job visibly cannot be dropped into Printing rather than being
           dropped and silently bouncing back. */
        var job = DB.job(dragId);
        board.querySelectorAll('.yl-col').forEach(function (c) {
          var st = c.getAttribute('data-stage');
          c.classList.add(DB.blockedBy(job, st) ? 'no-drop' : 'can-drop');
        });
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        board.querySelectorAll('.yl-col').forEach(function (c) {
          c.classList.remove('can-drop', 'no-drop', 'over');
        });
      });
    });

    board.querySelectorAll('.yl-col').forEach(function (colEl) {
      colEl.addEventListener('dragover', function (e) {
        if (colEl.classList.contains('no-drop')) return;   // no preventDefault = not a drop target
        e.preventDefault();
        colEl.classList.add('over');
      });
      colEl.addEventListener('dragleave', function () { colEl.classList.remove('over'); });
      colEl.addEventListener('drop', function (e) {
        e.preventDefault();
        colEl.classList.remove('over');
        if (!dragId) return;
        var job = DB.job(dragId);
        var st = colEl.getAttribute('data-stage');
        dragId = null;
        if (!job || job.stage === st) return;

        if (DB.blockedBy(job, st) === 'tbc') { refuseTbc(job); return; }
        if (DB.setStage(job, st, 'yalla')) {
          toast(job.id, t('yl_moved_to') + ' ' + t('print_' + st), 'ok');
          Notify.refresh();
          repaint();
        }
      });
    });
  }

  /* One place the refusal is explained, so the board, the button and any
     future caller all say the same thing and all offer the same way out.
     The action button carries data-yl attributes rather than a closure — the
     document-level delegate picks it up, and the toast lives outside #view so
     it survives the repaint. */
  function refuseTbc(job) {
    toast(job.id, DB.tbcCount(job) + ' ' + t('yl_blocked_toast'), 'warn', 6000, {
      label: t('yl_request_names'),
      attrs: 'data-yl="ask-names" data-id="' + job.id + '"'
    });
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

    /* Two questions on one screen: what it pays, and how much came off the
       press. A fifth tab would not fit a phone, so they share this one. */
    h += '<div class="seg-row mb">' +
      '<button class="seg' + (S.tab === 'production' ? '' : ' on') + '" data-yl="etab" data-t="money">' + t('yl_money_tab') + '</button>' +
      '<button class="seg' + (S.tab === 'production' ? ' on' : '') + '" data-yl="etab" data-t="production">' + t('yl_prod') + '</button>' +
    '</div>';
    if (S.tab === 'production') return h + productionHtml();

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

    /* Scorecard — both numbers come free from the stamped stage history, and
       both are the ones OG would ask about at a renewal conversation. */
    var onTime = DB.onTimeRate(), turn = DB.avgTurnaround();
    h += '<div class="grid mb" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start">' +
      '<div class="card"><div class="card-head"><h3>' + t('yl_monthly') + '</h3></div>' +
      '<div class="card-body"><div class="chart-box" style="height:230px"><canvas id="ylChart"></canvas></div></div></div>';

    h += '<div class="card"><div class="card-head"><h3>' + t('yl_scorecard') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_scorecard_sub') + '</div></div>' +
      '<div class="card-body">' +
        '<div class="yl-score">' +
          '<div class="ys"><span class="eyebrow">' + t('yl_on_time') + '</span>' +
            '<b class="' + (onTime === null ? '' : onTime >= 80 ? 'good' : onTime >= 60 ? 'mid' : 'bad') + '">' +
              (onTime === null ? '—' : onTime + '%') + '</b>' +
            '<div class="bar-track" style="height:7px;margin-top:8px">' +
              '<i class="lime" style="width:' + (onTime || 0) + '%"></i></div>' +
            '<span class="ys-foot">' + t('yl_on_time_sub') + '</span></div>' +
          '<div class="ys"><span class="eyebrow">' + t('yl_turnaround') + '</span>' +
            '<b>' + (turn === null ? '—' : turn) + '<i>' + t('yl_days') + '</i></b>' +
            '<span class="ys-foot">' + t('yl_turnaround_sub') + '</span></div>' +
        '</div></div></div></div>';

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

  /* ---- the production report ---------------------------------------------
     Pieces off the press by day and by month, from DB.stats — computed on
     the server over every finished job, in this machine's day. Nothing here
     is summed in the browser, so it cannot quietly become "the last 200". */
  function prodDays() {
    var s = DB.stats;
    var byDay = {};
    (s.perDay || []).forEach(function (r) { byDay[r.day] = r; });
    var out = [];
    var end = new Date(s.todayKey + 'T12:00:00');
    for (var i = 29; i >= 0; i--) {
      var d = new Date(end.getTime() - i * 86400000);
      var key = d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
      out.push({ day: key, date: d, jobs: byDay[key] ? byDay[key].jobs : 0, pieces: byDay[key] ? byDay[key].pieces : 0 });
    }
    return out;
  }

  function productionHtml() {
    var s = DB.stats;
    if (!s) {
      return '<div class="card"><div class="cart-empty"><b>' + t('yl_prod_none') + '</b></div></div>';
    }
    var rating = s.avgRating;
    var h = '<div class="grid mb stat-row" style="grid-template-columns:repeat(5,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_prod_today') + '</span><div class="val accent">' + nf(s.today.pieces) + '</div>' +
        '<div class="foot">' + s.today.jobs + ' ' + t('yl_jobs').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_prod_month') + '</span><div class="val">' + nf(s.month.pieces) + '</div>' +
        '<div class="foot">' + s.month.jobs + ' ' + t('yl_jobs').toLowerCase() +
          (s.month.payout != null ? ' · ' + money(s.month.payout) : '') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_prod_open') + '</span><div class="val">' + nf(s.open.pieces) + '</div>' +
        '<div class="foot">' + s.open.jobs + ' ' + t('yl_jobs').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_on_time') + '</span><div class="val' +
        (s.onTimePct === null ? '' : s.onTimePct >= 80 ? ' accent' : '') + '">' +
        (s.onTimePct === null ? '—' : s.onTimePct + '%') + '</div>' +
        '<div class="foot">' + (s.avgTurnaroundDays === null ? '' : s.avgTurnaroundDays + ' ' + t('yl_days') + ' ' + t('yl_turnaround').toLowerCase()) + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_rating') + '</span><div class="val">' +
        (rating === null ? '—' : '<span dir="ltr">' + rating + ' <span class="rv-star on" style="font-size:18px">★</span></span>') + '</div>' +
        '<div class="foot">' + s.reviews + ' ' + t('yl_prod_reviews') + '</div></div>' +
    '</div>';

    h += '<div class="card mb"><div class="card-head"><h3>' + t('yl_prod_days') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_prod_days_sub') + '</div></div>' +
      '<div class="card-body"><div class="chart-box" style="height:220px"><canvas id="ylProdChart"></canvas></div></div></div>';

    h += '<div class="card mb table-wrap"><div class="card-head"><h3>' + t('yl_prod_months') + '</h3></div>' +
      '<table class="tbl"><thead><tr><th>' + t('yl_prod_month_col') + '</th>' +
      '<th class="num">' + t('yl_jobs') + '</th><th class="num">' + t('pieces') + '</th>' +
      (s.month.payout != null ? '<th class="num">' + t('yl_payout') + '</th>' : '') + '</tr></thead><tbody>';
    var months = (s.perMonth || []).slice().reverse();
    if (!months.length) {
      h += '<tr><td colspan="4" class="muted">' + t('yl_prod_empty') + '</td></tr>';
    }
    months.forEach(function (r) {
      var d = new Date(r.month + '-01T12:00:00');
      h += '<tr><td><b>' + d.toLocaleDateString(OG.lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric' }) + '</b></td>' +
        '<td class="num">' + r.jobs + '</td><td class="num"><b>' + nf(r.pieces) + '</b></td>' +
        (s.month.payout != null ? '<td class="num">' + money(r.payout || 0) + '</td>' : '') + '</tr>';
    });
    h += '</tbody></table></div>';

    var days = prodDays().filter(function (d) { return d.pieces > 0; }).reverse();
    h += '<div class="card table-wrap"><div class="card-head"><h3>' + t('yl_prod_day_col') + '</h3>' +
      '<div class="card-actions muted small">' + t('yl_prod_days_sub') + '</div></div>' +
      '<table class="tbl"><thead><tr><th>' + t('date') + '</th>' +
      '<th class="num">' + t('yl_jobs') + '</th><th class="num">' + t('pieces') + '</th></tr></thead><tbody>';
    if (!days.length) h += '<tr><td colspan="3" class="muted">' + t('yl_prod_empty') + '</td></tr>';
    days.forEach(function (d) {
      h += '<tr><td>' + fmtDate(d.date) + '</td><td class="num">' + d.jobs + '</td>' +
        '<td class="num"><b>' + nf(d.pieces) + '</b></td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function afterProduction() {
    var c = document.getElementById('ylProdChart');
    if (!c || !DB.stats) return;
    var days = prodDays();
    Charts.bars(c, days.map(function (d) { return String(d.date.getDate()); }),
      days.map(function (d) { return d.pieces; }),
      { highlight: days.length - 1, fmt: function (v) { return nf(v); } });
  }

  function afterEarnings() {
    if (S.tab === 'production') { afterProduction(); return; }
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
      '<span class="badge neutral">' + j.qty + ' ' + t('pieces') + '</span> ' +
      '<span class="badge neutral">' + t('pj_src_' + (j.source || 'manual')) + '</span></div>';

    var body = '<div class="card mb"><div class="card-head"><h3>' + t('yl_progress') + '</h3>' +
      '<div class="card-actions muted small">' + (j.overdue
        ? '<span style="color:var(--destructive);font-weight:700">' + t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd</span>'
        : t('deadline') + ' ' + relDate(j.deadline)) + '</div></div>' +
      '<div class="card-body">' + stepper(j.stage, { history: j.history, overdue: j.overdue }) + '</div></div>';

    body += '<div class="card mb"><div class="card-head"><h3>' + t('design_note') + '</h3></div>' +
      '<div class="card-body"><p style="margin:0;font-size:14px;line-height:1.6">' + esc(j.design) + '</p></div></div>';

    /* Kit jobs get the actual print list — club, name, number, size. This is
       the sheet the person at the press works from, so TBC rows are called
       out rather than left as a blank cell someone might overlook. */
    if (j.kind === 'kit' && j.lines) {
      body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_kit_lines') + '</h3>' +
        '<div class="card-actions">' +
          (j.tbc ? '<span class="badge tbc">' + j.tbc + ' ' + t('yl_tbc') + '</span> ' : '') +
          '<span class="badge accent">' + j.qty + ' ' + t('pieces') + '</span></div></div>' +
        '<div class="table-wrap"><table class="tbl yl-kits"><thead><tr>' +
          '<th class="num">#</th><th>' + t('yl_kit') + '</th><th>' + t('yl_print') + '</th>' +
          '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th>' +
        '</tr></thead><tbody>';
      j.lines.forEach(function (l, i) {
        body += '<tr' + (l.print ? '' : ' class="is-tbc"') + '>' +
          '<td class="num muted">' + pad(i + 1, 2) + '</td>' +
          '<td><b>' + esc(l.club) + '</b><small class="ar">' + esc(l.clubAr) + '</small></td>' +
          '<td>' + (l.print
            ? '<span class="kit-name">' + esc(l.print) + '</span>' +
              (l.number ? '<span class="kit-no">' + l.number + '</span>' : '')
            : '<span class="kit-tbc">' + t('yl_to_confirm') + '</span>') + '</td>' +
          '<td><span class="yl-size"><b>' + esc(l.size) + '</b></span></td>' +
          '<td class="num">×' + l.qty + '</td></tr>';
      });
      body += '</tbody></table></div></div>';
    } else {
      body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_size_breakdown') + '</h3>' +
        '<div class="card-actions"><span class="badge accent">' + j.qty + '</span></div></div>' +
        '<div class="card-body"><div class="yl-sizes lg">' + sizeChips(j.sizes) + '</div></div></div>';
    }

    body += '<div class="grid mb" style="grid-template-columns:1fr 1fr">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_payout') + '</span><div class="val accent">' + moneyStat(j.payout) + '</div>' +
        '<div class="foot">' + money(Math.round(j.payout / j.qty)) + ' / ' + t('yl_piece') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('deadline') + '</span><div class="val" style="font-size:16px">' +
        fmtDate(j.deadline) + '</div><div class="foot">' + relDate(j.deadline) + '</div></div>' +
    '</div>';

    /* What OG thought of the finished shirts — read-only here; it is their
       verdict on this side's work. */
    if (j.review && typeof reviewCardHtml === 'function') body += reviewCardHtml(j, true);

    body += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    if (idx < DB.printStages.length - 1) {
      var nx = DB.printStages[idx + 1];
      var blk = DB.blockedBy(raw, nx) === 'tbc';
      body += '<button class="btn ' + (blk ? 'btn-ghost is-blocked' : 'btn-primary') + ' btn-lg" ' +
        'data-yl="advance" data-id="' + j.id + '"' + (blk ? '' : ' data-close="1"') + '>' +
        (blk ? '🔒 ' : '') + t('yl_move_to') + ' ' + t('print_' + nx) + '</button>';
    }
    if (j.tbc) {
      body += '<button class="btn btn-primary btn-lg" data-yl="ask-names" data-id="' + j.id + '">' +
        t('yl_request_names') + '</button>';
    }
    body += '<button class="btn btn-ghost btn-lg" data-yl="work-order" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
            '<button class="btn btn-ghost btn-lg" data-yl="note" data-id="' + j.id + '">' + t('yl_add_note') + '</button></div>';

    body += thread(j.id, 'yalla');
    body += '<div class="partner-note mt">' + t('partner_note') + '</div>';

    /* Opening the job is reading the thread. Do it after the markup is built
       so the unread styling still shows on this render, then clear it. */
    DB.markRead('yalla', { jobId: j.id });

    openDrawer({ head: head, body: body });
  }

  /* The conversation on one job, rendered identically on both sides. `side`
     is who is looking, which decides what counts as "mine". */
  function thread(jobId, side) {
    var msgs = DB.messagesFor({ jobId: jobId });
    var h = '<div class="card mt"><div class="card-head"><h3>' + t('yl_thread') + '</h3>' +
      '<div class="card-actions muted small">' + msgs.length + ' ' + t('yl_messages') + '</div></div>';

    if (!msgs.length) {
      return h + '<div class="cart-empty"><b>' + t('yl_no_messages') + '</b>' + t('yl_no_messages_sub') + '</div></div>';
    }

    h += '<div class="yl-thread">';
    msgs.forEach(function (m) {
      var mine = m.from === side;
      h += '<div class="yl-msg' + (mine ? ' mine' : '') + '">' +
        '<div class="ym-head"><b>' + (m.from === 'og' ? CONFIG.SHOP_NAME.toUpperCase() : 'YALLA WEAR') + '</b>' +
          '<span class="ym-kind k-' + m.kind + '">' + t('yl_msg_' + m.kind.replace(/-/g, '_')) + '</span>' +
          (m.reason ? '<span class="ym-reason">' + t('yl_reason_' + m.reason.replace(/-/g, '_')) + '</span>' : '') +
          '<span class="ym-ago">' + agoShort(m.at) + '</span></div>' +
        '<div class="ym-txt">' + esc(m.text) + '</div></div>';
    });
    return h + '</div></div>';
  }

  /* -------------------------------------------------------------- render */

  /* Partner exports carry Yalla Wear's brand, and only Yalla Wear's data —
     built from partnerView objects, so OG's pricing cannot reach the file.
     Each of the three pages exports itself, not the earnings sheet. */
  function exportSpec() {
    if (S.view === 'today')    return todaySpec();
    if (S.view === 'queue')    return queueSpec();
    if (S.view === 'invoices') return hasInv() ? YLINV.exportSpec() : earningsSpec();
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
              inSt.filter(function (j) { return j.overdue; }).length,
              inSt.reduce(function (a, j) { return a + (j.tbc || 0); }, 0)];
    });
    var avg = DB.avgDaysToPay();
    return {
      theme: 'yalla', name: 'yalla-today', sheet: 'Today',
      title: t('yl_today'), subtitle: t('yl_line') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('status') }, { label: t('yl_jobs'), num: true },
                { label: t('pieces'), num: true }, { label: t('overdue'), num: true },
                { label: t('yl_tbc'), num: true }],
      rows: rows,
      totals: [t('total'), open.length, open.reduce(function (a, j) { return a + j.qty; }, 0),
               open.filter(function (j) { return j.overdue; }).length,
               open.reduce(function (a, j) { return a + (j.tbc || 0); }, 0)],
      kpis: [{ label: t('yl_open_jobs'), value: nf(open.length) },
             { label: t('yl_due_week'), value: nf(week) + ' ' + t('pieces') },
             { label: t('yl_outstanding'), value: money(DB.outstandingTotal()) },
             { label: t('yl_avg_pay'), value: avg === null ? '—' : avg + ' ' + t('yl_days') }]
    };
  }

  /* The job list as a worksheet — what he has to print, in deadline order.
     Built from queueList(), so the file contains exactly the rows on screen:
     filter to "late" and export, and you get the late ones, not everything. */
  function queueSpec() {
    var list = queueList();
    var scope = [t('yl_' + (S.filter === 'open' ? 'open_jobs' : S.filter === 'urgent' ? 'urgent_late'
                 : S.filter === 'tbc' ? 'tbc_filter' : 'jobs'))];
    if (S.day !== null && S.day !== undefined) scope.push(dayChipLabel());

    return {
      theme: 'yalla', name: 'yalla-queue', sheet: 'Queue',
      title: t('yl_queue'),
      subtitle: scope.join(' · ') + ' · ' + list.length + ' ' + t('yl_jobs') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('yl_job') }, { label: t('design_note'), width: 40 },
                { label: t('qty'), num: true }, { label: t('yl_size_breakdown'), width: 24 },
                { label: t('yl_tbc'), num: true },
                { label: t('priority') }, { label: t('deadline') }, { label: t('status') }],
      rows: list.map(function (j) {
        return [j.id, j.design, j.qty,
                Object.keys(j.sizes || {}).map(function (k) { return k + '×' + j.sizes[k]; }).join(' '),
                j.tbc || 0,
                t(j.priority) + (j.overdue ? ' · ' + t('overdue') : ''),
                fmtDate(j.deadline), t('print_' + j.stage)];
      }),
      totals: [t('total'), null, list.reduce(function (a, j) { return a + j.qty; }, 0), null,
               list.reduce(function (a, j) { return a + (j.tbc || 0); }, 0), null, null, null],
      kpis: [{ label: t('yl_open_jobs'), value: nf(list.length) },
             { label: t('pieces'), value: nf(list.reduce(function (a, j) { return a + j.qty; }, 0)) },
             { label: t('yl_tbc'), value: nf(list.reduce(function (a, j) { return a + (j.tbc || 0); }, 0)) }]
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

  /* Invoices live in their own module. Delegated rather than inlined so this
     file stays the production side and ylinvoice.js stays the money side. */
  function hasInv() { return typeof YLINV !== 'undefined'; }

  var VIEWS = {
    today: viewToday, queue: viewQueue, earnings: viewEarnings,
    invoices: function () { return hasInv() ? YLINV.view() : viewEarnings(); }
  };

  function view() { return (VIEWS[S.view] || viewToday)(); }

  function after() {
    if (S.view === 'earnings') afterEarnings();
    if (S.view === 'invoices' && hasInv() && YLINV.after) YLINV.after();
    if (S.view === 'queue' && S.mode === 'board') bindBoard();
    if (S.view === 'today') telegramLoad();
  }

  /* --------------------------------------------------------------- acts */

  var ACT = {
    nav: function (el) { S.view = el.getAttribute('data-view'); S.day = null; closeDrawer(); repaint(); },
    etab: function (el) { S.tab = el.getAttribute('data-t'); repaint(); },

    /* ---- the Telegram line. Shared by both portals: the server decides
       whose bot from the account, so the same three buttons serve OG's
       Settings fold and the partner's Today card. */
    'tg-link': function () {
      if (typeof Shop === 'undefined' || !Shop.live()) return;
      Shop.telegramLink().then(function (r) {
        TG.code = r;
        if (r.bot && TG.status) TG.status.bot = r.bot;
        tgPaint();
        tgWatch();
      }).catch(function (e) { toast(t('tg_title'), API.friendly ? API.friendly(e) : String(e), 'err', 6000); });
    },
    'tg-test': function () {
      if (typeof Shop === 'undefined' || !Shop.live()) return;
      Shop.telegramTest().then(function () { toast(t('tg_title'), t('tg_test_sent'), 'ok', 3500); })
        .catch(function (e) { toast(t('tg_title'), API.friendly ? API.friendly(e) : String(e), 'err', 6000); });
    },
    'tg-unlink': function () {
      if (typeof Shop === 'undefined' || !Shop.live()) return;
      Shop.telegramUnlink().then(function () {
        TG.code = null;
        toast(t('tg_title'), t('tg_unlinked'), 'ok', 3000);
        telegramLoad();
      }).catch(function (e) { toast(t('tg_title'), API.friendly ? API.friendly(e) : String(e), 'err', 6000); });
    },
    filter: function (el) { S.filter = el.getAttribute('data-f'); repaint(); },
    'stage-filter': function (el) {
      S.view = 'queue'; S.filter = el.getAttribute('data-stage'); S.day = null; repaint();
    },
    /* Radar and heatmap both land here: jump to the queue, scoped to one day. */
    'day-filter': function (el) {
      var off = el.getAttribute('data-off');
      S.view = 'queue'; S.filter = 'open'; S.day = (off === 'late' ? 'late' : +off);
      repaint();
    },
    'clear-day': function () { S.day = null; repaint(); },
    open: function (el) { openJob(el.getAttribute('data-id')); },
    'open-invoice': function (el) {
      if (!hasInv()) return;
      S.view = 'invoices'; repaint();
      YLINV.open(el.getAttribute('data-id'));
    },

    /* Chase OG for the missing names. Posts a real message on the job thread
       — the same array OG's bell reads — rather than raising a local toast
       that goes nowhere. */
    'ask-names': function (el) {
      var id = el.getAttribute('data-id');
      var raw = DB.job(id);
      if (!raw) return;
      var missing = DB.tbcLines(raw);
      if (!missing.length) { toast(id, t('yl_nothing_pending'), 'ok'); return; }
      DB.postMessage({
        jobId: id, from: 'yalla', kind: 'name-request', reason: 'awaiting-names',
        text: t('yl_need_names') + ' ' + missing.length + ' ' + t('yl_lines') + ' — ' +
              missing.map(function (l) { return l.number ? '#' + l.number : l.club; }).join(', ')
      });
      closeDrawer();
      toast(id, t('yl_names_requested'), 'ok', 3200);
      repaint();
    },

    mode: function (el) { S.mode = el.getAttribute('data-m'); repaint(); },

    /* ---- answering an offer ---------------------------------------------
       Accepting is a commitment to a DATE, not just a yes. The field defaults
       to what OG asked for, so agreeing is one tap, but changing it is the
       whole point: the on-time score is then measured against what Yalla
       actually said, which is the only number they can fairly be held to. */
    accept: function (el) {
      var id = el.getAttribute('data-id');
      var job = DB.job(id);
      if (!job || DB.orderState(job) !== 'pending') return;

      var d = new Date(job.deadline);
      var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);

      openModal({
        title: t('yl_accept_title') + ' · ' + id,
        size: 'narrow',
        body: '<div class="ord-review">' +
                '<div class="ord-rv-row"><span>' + t('design_note') + '</span><b>' + esc(job.design) + '</b></div>' +
                '<div class="ord-rv-row"><span>' + t('total_pieces') + '</span><b>' + job.qty + '</b></div>' +
                '<div class="ord-rv-row"><span>' + t('yl_requested_by') + '</span><b>' + fmtDate(job.deadline) + '</b></div>' +
              '</div>' +
              '<label class="field mt"><span>' + t('yl_promise') + '</span>' +
                '<input class="inp" id="ylPromise" type="date" value="' + iso + '"></label>' +
              '<div class="partner-note mt">' + t('yl_promise_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-yl="accept-go" data-id="' + id + '">' + t('yl_accept') + '</button>'
      });
    },

    'accept-go': function (el) {
      var id = el.getAttribute('data-id');
      var job = DB.job(id);
      var input = document.getElementById('ylPromise');
      if (!job) return;
      /* Midday, not midnight: a date-only value parses as UTC midnight and can
         land on the previous day once it is rendered in local time. */
      var promised = (input && input.value) ? new Date(input.value + 'T12:00:00') : job.deadline;
      if (!DB.acceptOrder(job, promised)) return;

      closeModal();
      toast(id, t('yl_accepted_ok'), 'ok');
      Notify.refresh();
      repaint();
    },

    decline: function (el) {
      var id = el.getAttribute('data-id');
      if (!DB.job(id) || DB.orderState(DB.job(id)) !== 'pending') return;

      openModal({
        title: t('yl_decline_title') + ' · ' + id,
        size: 'narrow',
        body: '<label class="field"><span>' + t('yl_message') + '</span>' +
                '<textarea class="inp" id="ylDeclineText" rows="4" placeholder="' +
                  esc(t('yl_decline_ph')) + '"></textarea></label>' +
              '<div class="partner-note mt">' + t('yl_decline_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn bk-danger" data-yl="decline-go" data-id="' + id + '">' + t('yl_decline') + '</button>'
      });
    },

    'decline-go': function (el) {
      var id = el.getAttribute('data-id');
      var job = DB.job(id);
      var box = document.getElementById('ylDeclineText');
      if (!job || !DB.declineOrder(job, box ? box.value : '')) return;

      closeModal();
      toast(id, t('yl_declined_ok'), 'ok');
      Notify.refresh();
      repaint();
    },

    advance: function (el) {
      var id = el.getAttribute('data-id');
      var job = DB.job(id);
      if (!job) return;
      var i = DB.printStages.indexOf(job.stage);
      if (i >= DB.printStages.length - 1) return;
      var next = DB.printStages[i + 1];

      /* Ask before acting. setStage would refuse anyway, but the old code
         toasted "moved to Printing" regardless of the return value — it told
         the user something had happened when nothing had. */
      if (DB.blockedBy(job, next) === 'tbc') { refuseTbc(job); return; }
      /* 'yalla' so the move announces itself to OG. "It is on the press now"
         is exactly the kind of thing OG used to have to ring up and ask. */
      if (!DB.setStage(job, next, 'yalla')) return;

      if (el.getAttribute('data-close')) closeDrawer();
      toast(job.id, t('yl_moved_to') + ' ' + t('print_' + job.stage), 'ok');
      Notify.refresh();
      repaint();
    },

    /* Tell OG why. A reason code rather than free text alone, because "late"
       is not information and "fabric delivery late" is. */
    note: function (el) {
      var id = el.getAttribute('data-id');
      if (!DB.job(id)) return;
      var opts = Object.keys(DB.msgReasons).map(function (k) {
        return '<option value="' + k + '">' + t('yl_reason_' + k.replace(/-/g, '_')) + '</option>';
      }).join('');

      openModal({
        title: t('yl_add_note') + ' · ' + id,
        body: '<label class="field"><span>' + t('yl_reason') + '</span>' +
                '<select class="inp" id="ylNoteReason">' + opts + '</select></label>' +
              '<label class="field mt"><span>' + t('yl_message') + '</span>' +
                '<textarea class="inp" id="ylNoteText" rows="4" placeholder="' +
                  esc(t('yl_note_ph')) + '"></textarea></label>' +
              '<div class="partner-note mt">' + t('yl_note_hint') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-yl="note-send" data-id="' + id + '">' + t('send') + '</button>'
      });
    },

    'note-send': function (el) {
      var id = el.getAttribute('data-id');
      var reason = (document.getElementById('ylNoteReason') || {}).value || 'other';
      var text = ((document.getElementById('ylNoteText') || {}).value || '').trim();
      if (!text) { toast(t('yl_add_note'), t('yl_note_empty'), 'warn'); return; }
      DB.postMessage({ jobId: id, from: 'yalla', kind: 'delay', reason: reason, text: text });
      closeModal();
      closeDrawer();
      toast(id, t('yl_note_sent'), 'ok', 3200);
      repaint();
    },

    /* The sheet that travels with the box. One job, everything needed to
       print it, and a QR back to the job in the system. */
    'work-order': function (el) {
      var raw = DB.printJobs.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      if (!raw) return;
      var j = DB.partnerView(raw);
      closeDrawer();

      /* A kit job's work order IS the print list — club, name, number, size.
         A bulk job has no lines, so it falls back to the size breakdown. */
      var isKit = j.kind === 'kit' && j.lines;
      Export.run({
        kind: 'pdf', theme: 'yalla', name: 'work-order-' + j.id,
        title: t('yl_work_order') + ' · ' + j.id,
        subtitle: t('deadline') + ' ' + fmtDate(j.deadline) + ' · ' + t(j.priority) +
                  (j.overdue ? ' · ' + t('overdue') : '') +
                  (j.tbc ? ' · ' + j.tbc + ' ' + t('yl_tbc') : ''),
        docUrl: deepLink('job', j.id),
        columns: isKit
          ? [{ label: '#', num: true }, { label: t('yl_kit'), width: 30 },
             { label: t('yl_print'), width: 22 }, { label: t('size') }, { label: t('qty'), num: true }]
          : [{ label: t('size') }, { label: t('qty'), num: true }],
        rows: isKit
          ? j.lines.map(function (l, i) {
              return [i + 1, l.club, (l.print || t('yl_to_confirm')) + (l.number ? ' ' + l.number : ''),
                      l.size, l.qty];
            })
          : Object.keys(j.sizes || {}).map(function (k) { return [k, j.sizes[k]]; }),
        totals: isKit ? [null, t('total'), null, null, j.qty] : [t('total'), j.qty],
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
              '<button class="btn" data-act="print-doc">' + t('print') + '</button>' +
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
    tabs: tabs,
    view: view,
    after: after,
    openJob: openJob,
    exportSpec: exportSpec,
    state: S,
    thread: thread,
    /* The Telegram card, for OG's Settings fold — same card, their bot. */
    telegramLoad: telegramLoad,
    go: function (v, id) {
      S.view = v; S.day = null;
      repaint();
      if (v === 'invoices' && id && hasInv()) YLINV.open(id);
      if (v === 'queue' && id) openJob(id);
    },
    reset: function () { S.view = 'today'; S.filter = 'open'; S.mode = 'board'; S.day = null; }
  };
})();
