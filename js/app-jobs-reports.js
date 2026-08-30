/* ==========================================================================
   OG SYSTEM — application shell  ·  10/17: PRINT JOBS kanban + partner
   invoices (OG side) + REPORTS
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 4283-4810). Loads after
   app-customers-scan.js.
   ========================================================================== */

/* ------------------------------------------------------------ 11. PRINT JOBS */

function viewPrint() {
  /* Partner mode is routed at the shell level in render(), not here. */
  var jobs = DB.printJobs;
  var thisMonth = jobs.filter(function (j) { return new Date(j.created).getMonth() === TODAY.getMonth(); }).length;
  var overdue = jobs.filter(function (j) { return DB.isOverdue(j); }).length;
  var onTime = Math.round((jobs.length - overdue) / jobs.length * 100);
  var revenue = jobs.reduce(function (a, j) { return a + j.price; }, 0);
  var paid = jobs.reduce(function (a, j) { return a + j.cost; }, 0);

  OG.pr = OG.pr || { tab: 'board' };
  var owed = DB.outstandingTotal();
  var unreadPartner = DB.unreadFor('og').length;

  var h = '<div class="page-head"><div><h1>' + t('print_title') + '</h1>' +
    '<div class="sub">' + t('print_sub') + ' · ' + t('drag_hint') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      (allow('partner.read')
        ? '<button class="btn btn-dark" data-act="partner-view">' + t('partner_view') + '</button>'
        : '') +
    '</div></div>';

  /* Two halves of the same relationship: the work, and the bill for it. */
  h += '<div class="tabs mb">' +
    '<button class="tab' + (OG.pr.tab === 'board' ? ' on' : '') + '" data-act="pr-tab" data-tab="board">' +
      t('print_title') + '</button>' +
    '<button class="tab' + (OG.pr.tab === 'invoices' ? ' on' : '') + '" data-act="pr-tab" data-tab="invoices">' +
      t('og_partner_inv') +
      (owed ? '<span class="tab-dot"></span>' : '') + '</button>' +
  '</div>';

  if (OG.pr.tab === 'invoices') return h + viewPartnerInvoices();

  if (unreadPartner) {
    h += '<div class="yl-block mb">' +
      '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.2A8 8 0 1 1 21 12z"/></svg></span>' +
      '<span class="yb-txt"><b>' + unreadPartner + ' ' + t('og_unread_head') + '</b>' +
        '<small>' + t('og_unread_sub') + '</small></span></div>';
  }

  /* An order sent and never answered is the one way this feature could make
     things worse than the phone call it replaces. Four hours of silence and it
     says so, on the screen where the work lives. */
  var waiting = DB.awaitingResponse(4);
  if (waiting.length) {
    h += '<div class="yl-block note-warn mb">' +
      '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M12 7v5l3 2M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/></svg></span>' +
      '<span class="yb-txt"><b>' + waiting.length + ' ' + t('or_wait_head') + '</b>' +
        '<small>' + t('or_wait_sub') + ' · ' +
          waiting.map(function (j) { return j.id; }).join(', ') + '</small></span></div>';
  }

  h += '<div class="grid mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('jobs_month') + '</span><div class="val">' + thisMonth + '</div>' +
      deltaTag(thisMonth, Math.max(1, thisMonth - 2), t('vs_last_month')) + '</div>' +
    '<div class="stat"><span class="eyebrow">' + t('on_time') + '</span><div class="val' + (onTime >= 80 ? ' accent' : '') + '">' + onTime + '%</div>' +
      '<div class="foot">' + overdue + ' ' + t('overdue').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('print_revenue') + '</span><div class="val">' + moneyShort(revenue) + '</div>' +
      '<div class="foot">' + jobs.length + ' ' + t('orders').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span><div class="val">' + moneyShort(paid) + '</div>' +
      '<div class="foot">' + t('profit') + ': ' + moneyShort(revenue - paid) + '</div></div>' +
  '</div>';

  h += '<div class="kanban">';
  DB.printStages.forEach(function (stage) {
    var col = jobs.filter(function (j) { return j.stage === stage; });
    h += '<div class="kcol" data-stage="' + stage + '" data-drop="1">' +
      '<div class="kcol-head"><b>' + t('print_' + stage) + '</b><span class="cnt">' + col.length + '</span></div>' +
      '<div class="kcol-body">';
    col.forEach(function (j) {
      var over = DB.isOverdue(j);
      h += '<div class="kcard' + (over ? ' overdue' : '') + (Bulk.has('jobs', j.id) ? ' bk-on' : '') +
             '" draggable="true" data-id="' + j.id + '" data-act="open-job" data-jid="' + j.id + '">' +
        '<div class="kcard-top"><span class="bk-inline">' + Bulk.box('jobs', j.id) + '</span><b>' + esc(j.customer) + '</b>' +
          (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span>' : '') +
        '</div>' +
        '<div class="note">' + esc(j.design) + '</div>' +
        /* Only in Design, and only when it says something the stepper cannot:
           an accepted job's chip would just repeat the column it is sitting in. */
        (j.stage === 'design'
          ? '<div class="kcard-ord">' + orderChip(j) + '</div>'
          : '') +
        stepper(j.stage, { history: j.history, overdue: over, compact: true }) +
        '<div style="display:flex;gap:6px;align-items:center;font-size:10.5px;margin-top:8px" class="num">' +
          '<span class="badge neutral">' + j.qty + ' pcs</span>' +
          '<span class="' + (over ? 'badge critical' : 'muted') + '">' + (over ? t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd' : relDate(j.deadline)) + '</span>' +
        '</div>' +
        '<div class="kcard-foot"><span class="muted">' + j.id + '</span>' +
          '<span class="money">' + moneyShort(j.price) + ' <span class="cost">/ ' + moneyShort(j.cost) + '</span></span>' +
        '</div>' +
      '</div>';
    });
    h += '</div></div>';
  });
  h += '</div>';

  return h;
}

/* What OG owes Yalla Wear. Reads the same partnerInvoices array the partner
   portal writes to — that shared array IS the integration. */
function viewPartnerInvoices() {
  var owed = DB.outstandingTotal();
  var overdue = DB.partnerInvoices.filter(function (i) { return DB.invoiceOverdue(i); });
  var paidTotal = DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoicePaid(i); }, 0);

  var h = '<div class="grid mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('og_owed_to') + '</span>' +
      '<div class="val' + (owed ? ' warn' : '') + '">' + moneyStat(owed) + '</div>' +
      '<div class="foot">' + (overdue.length
        ? '<span style="color:var(--destructive);font-weight:700">' + overdue.length + ' ' + t('overdue').toLowerCase() + '</span>'
        : CONFIG.PRINT_PARTNER) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('yi_paid') + '</span>' +
      '<div class="val">' + moneyStat(paidTotal) + '</div>' +
      '<div class="foot">' + DB.partnerInvoices.length + ' ' + t('invoices').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span>' +
      '<div class="val">' + moneyStat(DB.printJobs.reduce(function (a, j) { return a + j.cost; }, 0)) + '</div>' +
      '<div class="foot">' + t('yl_lifetime').toLowerCase() + '</div></div>' +
  '</div>';

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('yi_invoice') + '</th><th>' + t('yi_issued') + '</th><th>' + t('yi_due') + '</th>' +
    '<th class="num">' + t('pieces') + '</th><th class="num">' + t('total') + '</th>' +
    '<th class="num">' + t('yi_balance') + '</th><th>' + t('status') + '</th><th></th>' +
  '</tr></thead><tbody>';

  DB.partnerInvoices.slice().sort(function (a, b) {
    return (b.issued || 0) - (a.issued || 0);
  }).forEach(function (inv) {
    var bal = DB.invoiceBalance(inv);
    var st = DB.invoiceStatus(inv);
    /* A draft is the partner's private working copy — OG should not see a
       bill that has not been sent to them. */
    if (st === 'draft') return;
    var cls = st === 'paid' ? 'healthy' : st === 'part' ? 'low' : 'accent';
    if (DB.invoiceOverdue(inv)) cls = 'critical';
    h += '<tr class="clickable' + (DB.invoiceOverdue(inv) ? ' row-late' : '') +
           '" data-act="og-open-inv" data-id="' + inv.id + '">' +
      '<td><b>' + inv.id + '</b></td>' +
      '<td class="muted">' + fmtDate(inv.issued) + '</td>' +
      '<td class="muted">' + fmtDate(inv.due) + '</td>' +
      '<td class="num">' + nf(DB.invoicePieces(inv)) + '</td>' +
      '<td class="num"><b>' + money(DB.invoiceTotal(inv)) + '</b></td>' +
      '<td class="num">' + (bal ? '<b style="color:var(--warning)">' + money(bal) + '</b>' : '—') + '</td>' +
      '<td><span class="badge ' + cls + '">' + t('yi_st_' + st) +
        (DB.invoiceOverdue(inv) ? ' · ' + DB.daysSince(inv.due) + 'd' : '') + '</span></td>' +
      /* No stopPropagation — it killed the click before the delegated
         [data-act] dispatcher on `document` ever saw it, so Pay now did
         nothing. closest('[data-act]') finds this button, not the row. */
      '<td>' + (bal
        ? '<button class="btn btn-sm btn-primary" data-act="og-pay-inv" data-id="' + inv.id + '">' +
            t('og_pay_now') + '</button>'
        : '') + '</td></tr>';
  });

  return h + '</tbody></table></div>';
}

/* Admin-side job detail. Unlike the partner drawer this shows the full
   commercial picture: who ordered it, what OG charges, what the margin is. */
/* ---- the order handover, OG's side ----------------------------------------
   Four states, and the block says plainly which one it is in. The important
   one is `draft`: until Send is pressed, Yalla Wear does not know this job
   exists, and nothing else on the screen should imply otherwise. */

/* Only the classes the stylesheet actually defines. `tbc` is the amber pill
   already used for "to be confirmed", which is exactly the right feeling for
   an order sitting with somebody else. */
var ORDER_TONE = { draft: 'neutral', pending: 'tbc', accepted: 'healthy', declined: 'critical' };

function orderChip(job) {
  var st = DB.orderState(job);
  return '<span class="badge ' + (ORDER_TONE[st] || 'neutral') + '">' + t('or_' + st) + '</span>';
}

function orderBlock(job) {
  var st = DB.orderState(job);
  var o = DB.order(job);
  var why = DB.canSendOrder(job);

  var h = '<div class="card mb ord-card is-' + st + '"><div class="card-head">' +
    '<h3>' + t('or_state') + '</h3><div class="card-actions">' + orderChip(job) + '</div></div>' +
    '<div class="card-body">';

  if (st === 'draft' || st === 'declined') {
    if (st === 'declined') {
      h += '<div class="yl-block note-danger mb">' +
        '<span class="yb-txt"><b>' + t('or_declined_head') + '</b>' +
        (o.note ? '<small>' + esc(o.note) + '</small>' : '') + '</span></div>';
    }
    if (why === 'tbc') {
      /* Refuse with the reason, not a dead button. An order carrying a shirt
         with no name is one Yalla physically cannot print. */
      h += '<div class="yl-block note-danger"><span class="yb-txt">' +
        '<b>' + t('or_cannot') + '</b><small>' + t('or_why_tbc') + '</small></span></div>';
    } else {
      h += '<button class="btn btn-primary btn-block btn-lg" data-act="or-send" data-id="' + job.id + '">' +
        t(st === 'declined' ? 'or_send_again' : 'or_send') + '</button>';
    }
  } else if (st === 'pending') {
    var mins = o.sentAt ? Math.round((Date.now() - new Date(o.sentAt).getTime()) / 60000) : 0;
    h += '<div class="ord-wait"><span class="ord-dot"></span>' +
      '<b>' + t('or_pending') + '</b>' +
      '<small>' + t('yl_sent_ago') + ' ' + (mins < 60 ? mins + t('yl_m') : Math.round(mins / 60) + t('yl_h')) + '</small></div>';
  } else if (st === 'accepted') {
    h += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">' +
      '<div class="stat"><span class="eyebrow">' + t('or_requested') + '</span>' +
        '<div class="val" style="font-size:15px">' + fmtDate(job.deadline) + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('or_promised') + '</span>' +
        '<div class="val accent" style="font-size:15px">' + fmtDate(DB.promisedDate(job)) + '</div></div>' +
    '</div>';
  }

  h += orderTimeline(job);
  return h + '</div></div>';
}

/* Sent → accepted → printing → delivered, with a stamp on each and the side
   that did it. Built from the order envelope plus the stage history that was
   already being recorded, so it costs nothing to keep and cannot be fudged. */
function orderTimeline(job) {
  var o = DB.order(job);
  var rows = [{ label: t('or_tl_created'), at: job.created, by: 'og' }];

  if (o.sentAt) rows.push({ label: t('or_tl_sent'), at: o.sentAt, by: 'og' });
  if (o.state === 'accepted' && o.respondedAt) {
    rows.push({ label: t('or_tl_accepted'), at: o.respondedAt, by: 'yalla' });
  }
  if (o.state === 'declined' && o.respondedAt) {
    rows.push({ label: t('or_tl_declined'), at: o.respondedAt, by: 'yalla' });
  }
  ['printing', 'delivery', 'done'].forEach(function (s) {
    var at = DB.stageAt(job, s);
    if (at) rows.push({ label: t('print_' + s), at: at, by: 'yalla' });
  });

  if (rows.length < 2) return '';

  var h = '<div class="ord-tl"><div class="lbl">' + t('or_timeline') + '</div>';
  rows.forEach(function (r) {
    h += '<div class="ord-tl-row">' +
      '<span class="ord-tl-dot"></span>' +
      '<span class="ord-tl-txt">' + esc(r.label) + '</span>' +
      '<span class="ord-tl-by">' + t(r.by === 'og' ? 'or_by_og' : 'or_by_yalla') + '</span>' +
      '<span class="ord-tl-at">' + fmtDateTime(r.at) + '</span>' +
    '</div>';
  });
  return h + '</div>';
}

function openJobDrawer(id) {
  var j = DB.printJobs.filter(function (x) { return x.id === id; })[0];
  if (!j) return;
  var over = DB.isOverdue(j);
  var margin = j.price - j.cost;

  var head = '<div style="flex:1">' +
    '<span class="eyebrow">' + t('print_job') + ' · ' + j.id + '</span>' +
    '<h3 style="font-size:19px;margin:4px 0 7px">' + esc(j.customer) + '</h3>' +
    (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span> ' : '') +
    (over ? '<span class="badge critical">' + t('overdue') + '</span> ' : '') +
    '<span class="badge neutral num">' + tel(j.phone) + '</span></div>';

  /* The handover sits above the progress bar, because until Yalla Wear has
     accepted, the stage tracker is describing something that has not started. */
  var body = orderBlock(j);

  body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_progress') + '</h3>' +
    '<div class="card-actions muted small">' + (over
      ? '<span style="color:var(--destructive);font-weight:700">' + t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd</span>'
      : t('deadline') + ' ' + relDate(j.deadline)) + '</div></div>' +
    '<div class="card-body">' + stepper(j.stage, { history: j.history, overdue: over }) + '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('design_note') + '</h3></div>' +
    '<div class="card-body"><p style="margin:0;font-size:14px;line-height:1.6">' + esc(j.design) + '</p></div></div>';

  /* A kit job shows its print list, editable. This is OG's half of the
     confirmation loop — the only place a missing name can be filled in,
     because OG is the one holding the customer's phone number. */
  if (j.kind === 'kit' && j.lines) {
    var tbc = DB.tbcCount(j);
    body += '<div class="card mb"><div class="card-head"><h3>' + t('og_kit_lines') + '</h3>' +
      '<div class="card-actions">' +
        (tbc ? '<span class="badge tbc">' + tbc + ' ' + t('yl_tbc') + '</span> ' : '') +
        '<span class="badge accent">' + j.qty + ' ' + t('pieces') + '</span></div></div>';

    if (tbc) {
      body += '<div class="yl-block" style="margin:0 16px 12px">' +
        '<span class="yb-txt"><b>' + tbc + ' ' + t('og_tbc_warn') + '</b></span></div>';
    }

    body += '<div class="table-wrap"><table class="tbl yl-kits og-kits"><thead><tr>' +
        '<th class="num">#</th><th>' + t('yl_kit') + '</th><th>' + t('yl_print') + '</th>' +
        '<th class="num">' + t('yi_number') + '</th><th>' + t('size') + '</th><th class="num">' + t('qty') + '</th>' +
      '</tr></thead><tbody>';
    j.lines.forEach(function (l, i) {
      body += '<tr' + (l.print ? '' : ' class="is-tbc"') + '>' +
        '<td class="num muted">' + pad(i + 1, 2) + '</td>' +
        '<td><b>' + esc(l.club) + '</b><small class="ar">' + esc(l.clubAr) + '</small></td>' +
        '<td><input class="inp" type="text" value="' + esc(l.print || '') +
          '" placeholder="' + esc(t('yl_to_confirm')) + '" ' +
          'data-og-line="print" data-jid="' + j.id + '" data-lid="' + l.id + '"></td>' +
        '<td><input class="inp num" type="number" min="0" max="99" style="width:62px" value="' +
          esc(l.number === null ? '' : l.number) + '" placeholder="—" ' +
          'data-og-line="number" data-jid="' + j.id + '" data-lid="' + l.id + '"></td>' +
        '<td><span class="yl-size"><b>' + esc(l.size) + '</b></span></td>' +
        '<td class="num">×' + l.qty + '</td></tr>';
    });
    body += '</tbody></table></div>';

    if (tbc) {
      body += '<div class="card-body" style="padding-top:0">' +
        '<button class="btn btn-primary btn-block" data-act="og-confirm-names" data-id="' + j.id + '">' +
          t('og_confirm_names') + '</button></div>';
    }
    body += '</div>';
  } else {
    body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_size_breakdown') + '</h3>' +
      '<div class="card-actions"><span class="badge accent">' + j.qty + '</span></div></div>' +
      '<div class="card-body"><div class="yl-sizes lg">' +
        Object.keys(j.sizes || {}).map(function (k) {
          return '<span class="yl-size"><b>' + k + '</b>' + j.sizes[k] + '</span>';
        }).join('') + '</div></div></div>';
  }

  body += '<div class="grid mb" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="stat"><span class="eyebrow">' + t('yl_charged') + '</span><div class="val">' + moneyStat(j.price) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span><div class="val">' + moneyStat(j.cost) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('profit') + '</span><div class="val accent">' + moneyStat(margin) + '</div>' +
      '<div class="foot">' + pct(margin / j.price * 100, 0) + '</div></div>' +
  '</div>';

  /* The conversation, rendered by the same function the partner portal uses,
     so both sides read an identical thread. */
  if (typeof YALLA !== 'undefined' && YALLA.thread) body += YALLA.thread(j.id, 'og');
  DB.markRead('og', { jobId: j.id });

  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
    '<button class="btn btn-ghost" data-act="og-nudge" data-id="' + j.id + '">' + t('og_nudge') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="job" data-kind="pdf" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
    (allow('partner.read')
      ? '<button class="btn btn-dark" style="flex:1" data-act="partner-view">' + t('partner_view') + '</button>'
      : '') + '</div>';

  openDrawer({ head: head, body: body });
}

/* OG's view of a partner invoice — their bill to pay, so it lives in OG,
   not inside the partner portal. Same document, same numbers. */
function openPartnerInvoice(id) {
  var inv = DB.invoice(id);
  if (!inv || typeof YLINV === 'undefined') return;
  var bal = DB.invoiceBalance(inv);
  DB.markRead('og', { invoiceId: id });

  var foot = '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
    '<button class="btn" data-act="print-now">' + t('print') + '</button>';
  if (bal > 0 && inv.issued) {
    foot += '<button class="btn btn-primary" data-act="og-pay-inv" data-id="' + id + '">' +
      t('og_pay_now') + ' · ' + money(bal) + '</button>';
  }
  openModal({ title: inv.id + ' · ' + CONFIG.PRINT_PARTNER, size: 'wide',
              body: YLINV.sheet(inv, false), foot: foot });
}

/* --------------------------------------------------------------- 12. REPORTS */

function viewReports() {
  var tabs = [['sales', 'tab_sales'], ['profit', 'tab_profit'], ['inventory', 'tab_inventory'],
              ['employees', 'tab_employees'], ['suppliers', 'tab_suppliers']];

  var h = '<div class="page-head"><div><h1>' + t('reports_title') + '</h1>' +
    '<div class="sub">' + t('reports_sub') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
    '</div></div><div class="tabs">';

  tabs.forEach(function (tb) {
    h += '<button class="tab ' + (OG.rep.tab === tb[0] ? 'on' : '') + '" data-act="rep-tab" data-tab="' + tb[0] + '">' + t(tb[1]) + '</button>';
  });
  h += '</div>';

  h += '<div class="card mb"><div class="card-head"><h3>' + t(tabs.filter(function (x) { return x[0] === OG.rep.tab; })[0][1]) + '</h3>' +
    '<div class="card-actions muted small">' + fmtDate(daysAgo(179)) + ' — ' + fmtDate(TODAY) + '</div></div>' +
    '<div class="card-body"><div class="chart-box" style="height:250px"><canvas id="repChart"></canvas></div></div></div>';

  h += repTable();
  return h;
}

function repTable() {
  var h = '<div class="card table-wrap">';

  if (OG.rep.tab === 'sales') {
    var m = DB.monthlySales(6);
    var totalRev = m.reduce(function (a, x) { return a + x.total; }, 0);
    var totalInv = m.reduce(function (a, x) { return a + x.count; }, 0);
    h += '<table class="tbl"><thead><tr><th>Month</th><th class="num">' + t('invoices') + '</th>' +
      '<th class="num">' + t('revenue') + '</th><th class="num">' + t('avg_basket') + '</th><th>' + t('vs_last_month') + '</th></tr></thead><tbody>';
    m.forEach(function (x, i) {
      var prev = i > 0 ? m[i - 1].total : 0;
      var d = prev ? (x.total - prev) / prev * 100 : 0;
      h += '<tr><td><b>' + x.label + ' ' + x.date.getFullYear() + '</b></td>' +
        '<td class="num">' + x.count + '</td>' +
        '<td class="num"><b>' + money(x.total) + '</b></td>' +
        '<td class="num muted">' + money(x.count ? x.total / x.count : 0) + '</td>' +
        '<td><span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + '%</span></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td class="num">' + totalInv + '</td>' +
      '<td class="num">' + money(totalRev) + '</td><td class="num">' + money(totalRev / totalInv) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'profit') {
    var rows = DB.profitByType();
    var tr = rows.reduce(function (a, x) { return a + x.revenue; }, 0);
    var tc = rows.reduce(function (a, x) { return a + x.cost; }, 0);
    h += '<table class="tbl"><thead><tr><th>' + t('type') + '</th><th class="num">' + t('units') + '</th>' +
      '<th class="num">' + t('revenue') + '</th><th class="num">' + t('cost') + '</th>' +
      '<th class="num">' + t('profit') + '</th><th class="num">' + t('margin') + '</th><th style="width:120px"></th></tr></thead><tbody>';
    var best = rows[0] ? rows[0].profit : 1;
    rows.forEach(function (x) {
      h += '<tr><td><b>' + x.label + '</b></td>' +
        '<td class="num">' + nf(x.units) + '</td>' +
        '<td class="num">' + money(x.revenue) + '</td>' +
        '<td class="num muted">' + money(x.cost) + '</td>' +
        '<td class="num"><b>' + money(x.profit) + '</b></td>' +
        '<td class="num">' + pct(x.margin, 1) + '</td>' +
        '<td><div class="bar-track"><i class="lime" style="width:' + Math.max(3, x.profit / best * 100) + '%"></i></div></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td class="num">' + money(tr) + '</td>' +
      '<td class="num">' + money(tc) + '</td><td class="num">' + money(tr - tc) + '</td>' +
      '<td class="num">' + pct((tr - tc) / tr * 100, 1) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'inventory') {
    var inv = DB.inventoryValue();
    var totalCost = inv.reduce(function (a, x) { return a + x.cost; }, 0);
    var totalRetail = inv.reduce(function (a, x) { return a + x.retail; }, 0);
    var totalUnits = inv.reduce(function (a, x) { return a + x.units; }, 0);
    h = '<div class="grid mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('capital_in_stock') + '</span>' +
        '<div class="val accent">' + money(totalCost) + '</div>' +
        '<div class="foot">' + nf(totalUnits) + ' ' + t('total_pieces').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('retail_value') + '</span><div class="val">' + money(totalRetail) + '</div>' +
        '<div class="foot">' + t('profit') + ' ' + t('if_sold_all') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('profit') + '</span><div class="val">' + money(totalRetail - totalCost) + '</div>' +
        '<div class="foot">' + pct((totalRetail - totalCost) / totalRetail * 100, 1) + ' ' + t('margin').toLowerCase() + '</div></div>' +
    '</div><div class="card table-wrap">' +
      '<table class="tbl"><thead><tr><th>' + t('type') + '</th><th class="num">' + t('units') + '</th>' +
      '<th class="num">' + t('capital_in_stock') + '</th><th class="num">' + t('retail_value') + '</th>' +
      '<th class="num">' + t('profit') + '</th><th style="width:130px"></th></tr></thead><tbody>';
    inv.forEach(function (x) {
      h += '<tr><td><b>' + x.label + '</b></td><td class="num">' + nf(x.units) + '</td>' +
        '<td class="num"><b>' + money(x.cost) + '</b></td>' +
        '<td class="num muted">' + money(x.retail) + '</td>' +
        '<td class="num">' + money(x.retail - x.cost) + '</td>' +
        '<td><div class="bar-track"><i style="width:' + Math.max(3, x.cost / totalCost * 100) + '%"></i></div></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td class="num">' + nf(totalUnits) + '</td>' +
      '<td class="num">' + money(totalCost) + '</td><td class="num">' + money(totalRetail) + '</td>' +
      '<td class="num">' + money(totalRetail - totalCost) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'employees') {
    h += '<table class="tbl"><thead><tr><th>' + t('name') + '</th><th>' + t('role') + '</th>' +
      '<th class="num">' + t('salary') + '</th><th class="num">' + t('sales_made') + '</th>' +
      '<th>' + t('next_payment') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';
    var totalSal = 0;
    DB.employees.forEach(function (e) {
      totalSal += e.salary;
      h += '<tr><td><div class="cell-prod"><span class="cc-av" style="width:28px;height:28px;font-size:10px">' +
          esc(e.name.split(' ').map(function (w) { return w[0]; }).join('')) + '</span>' +
          '<span><b>' + esc(e.name) + '</b><small>since ' + e.since + '</small></span></div></td>' +
        '<td><span class="badge neutral">' + esc(e.role) + '</span></td>' +
        '<td class="num">' + money(e.salary) + '</td>' +
        '<td class="num"><b>' + (e.sales ? money(e.sales) : '—') + '</b></td>' +
        '<td class="num">' + fmtDate(e.nextPayment) + ' <span class="muted">· ' + relDate(e.nextPayment) + '</span></td>' +
        '<td class="muted num">' + tel(e.phone) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td class="num">' + money(totalSal) + '</td>' +
      '<td class="num">' + money(DB.employees.reduce(function (a, e) { return a + e.sales; }, 0)) + '</td><td></td><td></td></tr></tfoot></table>';

  } else {
    h += '<table class="tbl"><thead><tr><th>' + t('supplier') + '</th><th>' + t('category') + '</th>' +
      '<th class="num">Total purchased</th><th class="num">' + t('outstanding') + '</th>' +
      '<th>' + t('due') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';
    var totalOut = 0;
    DB.suppliers.forEach(function (s) {
      totalOut += s.outstanding;
      var late = DB.daysSince(s.dueDate) > 0 && s.outstanding > 0;
      var soon = DB.daysSince(s.dueDate) > -5 && s.outstanding > 0;
      h += '<tr><td><b>' + esc(s.name) + '</b></td>' +
        '<td class="muted">' + esc(s.category) + '</td>' +
        '<td class="num muted">' + money(s.totalPurchased) + '</td>' +
        '<td class="num"><b' + (s.outstanding ? '' : ' class="muted"') + '>' + money(s.outstanding) + '</b></td>' +
        '<td>' + (s.outstanding
          ? '<span class="badge ' + (late ? 'critical' : (soon ? 'low' : 'neutral')) + '">' + fmtDate(s.dueDate) + ' · ' + relDate(s.dueDate) + '</span>'
          : '<span class="badge healthy">' + t('none') + '</span>') + '</td>' +
        '<td class="muted num">' + tel(s.contact) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td></td><td class="num">' + money(totalOut) + '</td><td></td><td></td></tr></tfoot></table>';
  }

  h += '</div>';
  return h;
}

function afterReports() {
  var c = document.getElementById('repChart');
  var f = function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); };
  var conv = function (v) { return OG.currency === 'USD' ? v / CONFIG.EXCHANGE_RATE : v; };

  if (OG.rep.tab === 'sales') {
    var m = DB.monthlySales(6);
    Charts.line(c, m.map(function (x) { return x.label; }), m.map(function (x) { return conv(x.total); }), { fmt: f });
  } else if (OG.rep.tab === 'profit') {
    var rows = DB.profitByType();
    Charts.bars(c, rows.map(function (x) { return x.label; }), rows.map(function (x) { return conv(x.profit); }), { highlight: 0, fmt: f });
  } else if (OG.rep.tab === 'inventory') {
    var inv = DB.inventoryValue();
    Charts.donut(c, inv.map(function (x) { return x.label; }), inv.map(function (x) { return conv(x.cost); }), { fmt: f });
  } else if (OG.rep.tab === 'employees') {
    var e = DB.employees.slice().sort(function (a, b) { return b.sales - a.sales; });
    Charts.bars(c, e.map(function (x) { return x.name.split(' ')[0]; }), e.map(function (x) { return conv(x.sales); }), { highlight: 0, fmt: f });
  } else {
    var s = DB.suppliers.slice().sort(function (a, b) { return b.outstanding - a.outstanding; });
    Charts.bars(c, s.map(function (x) { return x.name.split(' ')[0]; }), s.map(function (x) { return conv(x.outstanding); }), { highlight: 0, fmt: f });
  }
}
