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
      /* A job raised by hand — a customer who rang, a club order taken at
         the door. Until this existed the till was the only way in. */
      (allow('print.write')
        ? '<button class="btn btn-primary" data-act="pj-new">+ ' + t('pj_new') + '</button>'
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
      '<td>' + (DB.invoiceOpen(inv) > 0
        ? '<button class="btn btn-sm btn-primary" data-act="og-pay-inv" data-id="' + inv.id + '">' +
            t('og_pay_now') + '</button>'
        : (DB.invoicePending(inv)
            ? '<span class="badge tbc">' + t('pay_pending') + '</span>'
            : '')) + '</td></tr>';
  });

  return h + '</tbody></table></div>';
}

/* ---- a job raised by hand ---------------------------------------------------
   The till raises most print jobs, with the customer already on the basket.
   This is the other door: somebody rang, or a club captain walked in with a
   squad list. Same shape, same server call, same rule — every shirt with a
   name goes straight to Yalla Wear; a blank one keeps the job a draft. */

var PJ_PIECE_PRICE = 950;    /* what the customer pays per piece, matches the till */

function pjBlankLine() {
  var first = Object.keys(DB.clubs)[0] || '';
  return { club: first, print: '', number: '', size: 'M', qty: 1 };
}

function pjCollect() {
  var f = OG.pj;
  var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
  f.customer = v('pjCustomer'); f.phone = v('pjPhone'); f.design = v('pjDesign');
  f.qty = Math.max(0, Math.round(Number(v('pjQty')) || 0));
  f.priority = v('pjPriority') || 'normal';
  f.deadline = v('pjDeadline');
  f.unitPrice = Math.max(0, Math.round(Number(v('pjPrice')) || 0));
  if (document.getElementById('pjCost')) f.unitCost = Math.max(0, Math.round(Number(v('pjCost')) || 0));
  f.currency = v('pjCurrency') || 'SYP';
  document.querySelectorAll('[data-pj-line]').forEach(function (el) {
    var i = +el.getAttribute('data-i'), k = el.getAttribute('data-pj-line');
    if (!f.lines[i]) return;
    f.lines[i][k] = el.value;
  });
  return f;
}

function pjLinesHtml(f) {
  var clubs = Object.keys(DB.clubs);
  var h = '<div class="pj-lines">';
  f.lines.forEach(function (l, i) {
    h += '<div class="pj-line">' +
      '<span class="pj-n num muted">' + pad(i + 1, 2) + '</span>' +
      '<select class="inp" data-pj-line="club" data-i="' + i + '">' +
        clubs.map(function (c) {
          return '<option value="' + esc(c) + '"' + (c === l.club ? ' selected' : '') + '>' +
            esc(OG.lang === 'ar' ? DB.clubs[c][1] : DB.clubs[c][0]) + '</option>';
        }).join('') + '</select>' +
      '<input class="inp" type="text" placeholder="' + esc(t('pj_line_name_ph')) + '" value="' + esc(l.print) +
        '" data-pj-line="print" data-i="' + i + '">' +
      '<input class="inp num" type="number" min="0" max="99" placeholder="#" value="' + esc(l.number) +
        '" data-pj-line="number" data-i="' + i + '">' +
      '<select class="inp" data-pj-line="size" data-i="' + i + '">' +
        TEE_SIZES.map(function (s) {
          return '<option value="' + s + '"' + (s === l.size ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select>' +
      '<input class="inp num" type="number" min="1" value="' + esc(l.qty) + '" data-pj-line="qty" data-i="' + i + '">' +
      '<button class="btn btn-sm btn-ghost" data-act="pj-line-del" data-i="' + i + '" aria-label="' + esc(t('bk_delete')) + '">✕</button>' +
    '</div>';
  });
  return h + '</div>' +
    '<button class="btn btn-sm mt" data-act="pj-line-add">+ ' + t('pj_add_line') + '</button>';
}

function pjFormHtml() {
  var f = OG.pj;
  var kit = f.kind === 'kit';
  var h = '<div class="pj-form">' +
    '<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">' +
      '<label class="field"><span>' + t('pj_customer') + '</span>' +
        '<input class="inp" id="pjCustomer" type="text" value="' + esc(f.customer) + '" autocomplete="off"></label>' +
      '<label class="field"><span>' + t('pj_phone') + '</span>' +
        '<input class="inp num" id="pjPhone" type="tel" value="' + esc(f.phone) + '" dir="ltr"></label>' +
    '</div>' +
    '<label class="field mt"><span>' + t('pj_design') + '</span>' +
      '<textarea class="inp" id="pjDesign" rows="2" placeholder="' + esc(t('pj_design_ph')) + '">' + esc(f.design) + '</textarea></label>' +

    '<div class="seg-row mt">' +
      '<button class="seg' + (kit ? ' on' : '') + '" data-act="pj-kind" data-k="kit">' + t('pj_kind_kit') + '</button>' +
      '<button class="seg' + (kit ? '' : ' on') + '" data-act="pj-kind" data-k="bulk">' + t('pj_kind_bulk') + '</button>' +
    '</div>';

  if (kit) {
    h += '<div class="mt"><span class="eyebrow">' + t('pj_lines') + '</span>' +
      '<div class="muted small mb">' + t('pj_lines_hint') + '</div>' + pjLinesHtml(f) + '</div>';
  } else {
    h += '<label class="field mt"><span>' + t('pj_qty') + '</span>' +
      '<input class="inp num" id="pjQty" type="number" min="1" value="' + esc(f.qty || 12) + '"></label>';
  }

  var today = new Date();
  var dflt = new Date(today.getTime() + 5 * 86400000);
  var iso = f.deadline || (dflt.getFullYear() + '-' + pad(dflt.getMonth() + 1, 2) + '-' + pad(dflt.getDate(), 2));

  h += '<div class="grid mt" style="grid-template-columns:1fr 1fr;gap:10px">' +
      '<label class="field"><span>' + t('pj_deadline') + '</span>' +
        '<input class="inp" id="pjDeadline" type="date" value="' + esc(iso) + '"></label>' +
      '<label class="field"><span>' + t('priority') + '</span>' +
        '<select class="inp" id="pjPriority">' +
          '<option value="normal"' + (f.priority === 'urgent' ? '' : ' selected') + '>' + t('normal') + '</option>' +
          '<option value="urgent"' + (f.priority === 'urgent' ? ' selected' : '') + '>' + t('urgent') + '</option>' +
        '</select></label>' +
      '<label class="field"><span>' + t('pj_unit_price') + '</span>' +
        '<input class="inp num" id="pjPrice" type="number" min="0" value="' + esc(f.unitPrice) + '"></label>' +
      (seesCost()
        ? '<label class="field"><span>' + t('pj_unit_cost') + '</span>' +
            '<input class="inp num" id="pjCost" type="number" min="0" value="' + esc(f.unitCost) + '"></label>'
        : '') +
      '<label class="field"><span>' + t('pj_currency') + '</span>' +
        '<select class="inp" id="pjCurrency">' +
          '<option value="SYP"' + (f.currency === 'USD' ? '' : ' selected') + '>SYP</option>' +
          '<option value="USD"' + (f.currency === 'USD' ? ' selected' : '') + '>USD</option>' +
        '</select></label>' +
    '</div>' +
    '<div class="partner-note mt">' + t('pj_auto_hint') + '</div>' +
  '</div>';
  return h;
}

function openNewJob() {
  OG.pj = {
    kind: 'kit', lines: [pjBlankLine()], customer: '', phone: '', design: '', qty: 12,
    priority: 'normal', deadline: '', unitPrice: PJ_PIECE_PRICE,
    unitCost: CONFIG.KIT_PRINT_PRICE, currency: 'SYP'
  };
  openModal({
    title: t('pj_new'), size: 'wide', sheet: window.innerWidth <= 720,
    body: pjFormHtml(),
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="pj-save">' + t('pj_send') + '</button>'
  });
}

/* Repaint only the body, so the modal itself (and its scroll) stays put. */
function pjRepaint() {
  var body = document.querySelector('#modal-root .modal-body');
  if (body) body.innerHTML = pjFormHtml();
}

/* ---- what the shop thought of the finished shirts ---------------------------
   Five stars and a line, written once the job is done and shown to Yalla Wear
   because it is about their work. Editable: a second look after a customer
   complained is exactly when the rating should be allowed to move. */
function starsHtml(n, pick, jid) {
  var h = '<div class="rv-stars' + (pick ? ' rv-pick' : '') + '" dir="ltr">';
  for (var i = 1; i <= 5; i++) {
    h += pick
      ? '<button type="button" class="rv-star' + (i <= n ? ' on' : '') + '" data-act="job-rate" data-jid="' +
          esc(jid) + '" data-n="' + i + '" aria-label="' + i + '">★</button>'
      : '<span class="rv-star' + (i <= n ? ' on' : '') + '">★</span>';
  }
  return h + '</div>';
}

function reviewCardHtml(j, readOnly) {
  var r = j.review;
  var rating = (OG.rv && OG.rv.jobId === j.id) ? OG.rv.rating : (r ? r.rating : 0);
  var h = '<div class="card mb rv-card"><div class="card-head"><h3>' + t('rv_title') + '</h3>' +
    '<div class="card-actions muted small">' + (r ? fmtDate(r.at) : t('rv_sub')) + '</div></div>' +
    '<div class="card-body">';
  if (readOnly) {
    h += starsHtml(r ? r.rating : 0, false) +
      (r && r.feedback ? '<p class="rv-text">' + esc(r.feedback) + '</p>' : '');
  } else {
    h += starsHtml(rating, true, j.id) +
      '<textarea class="inp mt" id="rvText" rows="3" placeholder="' + esc(t('rv_ph')) + '">' +
        esc(r ? r.feedback : '') + '</textarea>' +
      '<button class="btn btn-primary btn-block mt" data-act="job-review-save" data-id="' + esc(j.id) + '">' +
        t(r ? 'rv_update' : 'rv_save') + '</button>';
  }
  return h + '</div></div>';
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
    '<span class="badge neutral">' + t('pj_src_' + (j.source || 'manual')) + '</span> ' +
    '<span class="badge neutral num">' + tel(j.phone) + '</span>' +
    /* WHO this job is actually for. The free text above is what was typed at
       the time; this is the link, and migration 032 deliberately left every
       job it could not PROVE unlinked — for a person to link. This is that
       person's control; without it the migration was an instruction to
       nobody. Never matched from the name: across two scripts that attaches
       somebody else's order. */
    (j.customerId && DB.customer(j.customerId)
      ? ' <span class="badge accent clickable" data-act="cu-open" data-id="' + j.customerId + '">' +
          nm(DB.customer(j.customerId).name) + ' ›</span>'
      : (allow('print.write') && allow('customer.read')
          ? ' <button class="btn btn-sm" data-act="job-link" data-jid="' + esc(j.id) + '">+ ' +
              t('pj_link') + '</button>'
          : '')) +
    '</div>';

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

  /* Once the shirts are in hand, the shop's verdict — written here, read in
     the partner portal. Before that there is nothing to rate. */
  if (j.stage === 'done' && allow('print.write')) body += reviewCardHtml(j, false);
  else if (j.review) body += reviewCardHtml(j, true);

  /* The conversation, rendered by the same function the partner portal uses,
     so both sides read an identical thread. */
  if (typeof YALLA !== 'undefined' && YALLA.thread) body += YALLA.thread(j.id, 'og');
  DB.markRead('og', { jobId: j.id });

  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
    '<button class="btn btn-ghost" data-act="og-nudge" data-id="' + j.id + '">' + t('og_nudge') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="job" data-kind="pdf" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
    '</div>';

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
    '<button class="btn" data-act="print-doc">' + t('print') + '</button>';
  if (bal > 0 && inv.issued && DB.invoiceOpen(inv) > 0) {
    foot += '<button class="btn btn-primary" data-act="og-pay-inv" data-id="' + id + '">' +
      t('og_pay_now') + ' · ' + money(DB.invoiceOpen(inv)) + '</button>';
  }
  openModal({ title: inv.id + ' · ' + CONFIG.PRINT_PARTNER, size: 'wide',
              body: YLINV.sheet(inv, false), foot: foot });
}

/* --------------------------------------------------------------- 12. REPORTS

   EVERY FIGURE ON THIS SCREEN COMES FROM THE SERVER, computed in SQL over
   every sale — `DB.rep`, the snapshot GET /api/reports returned for the window
   the scope chips name. Nothing here is summed from `DB.sales`, which is the
   last two hundred invoices and was, until this rewrite, the only source this
   screen had. It read as the shop; it was a window, and a window that added
   dollars to lira on the way past. server/lib/reports.js has the full account.

   Four rules follow from that and are visible in every function below:

     - MONEY IS A PAIR `{ syp, usd }` and is drawn as a pair. Nothing here
       converts one into the other and nothing adds them. The one place a
       single number appears is the chart, which can only plot one series and
       says in its own label which currency it is showing.

     - A BLOCK THE ACCOUNT MAY NOT SEE IS ABSENT from the snapshot, so every
       reader is null-safe and the TAB ITSELF is not drawn. A tab that opens
       onto "0" is worse than no tab: zero is a claim about the shop.

     - THE RANGE IS SAID OUT LOUD, and it is the range that was actually asked
       for. The old card head printed "179 days ago — today" over a table of
       six calendar months, an inventory total that was present-tense, and a
       payroll that has no dates in it at all.

     - AN EMPTY RANGE IS A SENTENCE, not a blank table. A shop that sold
       nothing last Tuesday should read as a shop that sold nothing last
       Tuesday.                                                              */

/* Which tabs this account may actually open. Server-side each block is gated
   on its own permission and simply not sent; this is the browser half of the
   same rule, and the two are deliberately written to the same list. */
function repTabs() {
  var tabs = [['sales', 'tab_sales', null]];
  if (allow('profit.read')) tabs.push(['profit', 'tab_profit', 'profit.read']);
  tabs.push(['inventory', 'tab_inventory', null]);
  if (allow('money.read')) tabs.push(['payments', 'rp_tab_payments', 'money.read']);
  if (allow('staff.read')) tabs.push(['employees', 'tab_employees', 'staff.read']);
  if (allow('money.read')) tabs.push(['suppliers', 'tab_suppliers', 'money.read']);
  return tabs;
}

/* A bookmarked #reports, a permission revoked while somebody was looking at
   the screen, or an export button pressed on a tab that has since gone: all
   three land here rather than on a blank card. */
function repTab() {
  var tabs = repTabs(), want = OG.rep.tab;
  for (var i = 0; i < tabs.length; i++) if (tabs[i][0] === want) return want;
  OG.rep.tab = tabs[0][0];
  return OG.rep.tab;
}

var REP_SCOPES = [['today', 'dash_scope_today'], ['7d', 'dash_scope_7d'],
                  ['30d', 'dash_scope_30d'], ['month', 'rp_scope_month'],
                  ['year', 'rp_scope_year'], ['custom', 'rp_scope_custom']];

/* The window actually on screen, in words. Built from the same scopeRange()
   the request was built from, so the label cannot drift from the figures —
   which is exactly how the old fixed "179 days" came to sit over six calendar
   months of table. */
function repRangeLabel() {
  var r = scopeRange(OG.repScope || '30d', OG.repFrom, OG.repTo);
  var last = new Date(r.to.getTime() - 1);
  var a = fmtDate(r.from), b = fmtDate(last);
  return a === b ? a : a + ' — ' + b;
}

/* Money out of the report's pairs. `moneyPair` already draws each half in its
   own bidi isolate and prints "—" when both halves are zero, which is the
   honest reading of a day the shop took nothing. */
function repMoney(p) { return moneyPair(p ? p.syp : 0, p ? p.usd : 0); }
function repMoneyShort(p) { return moneyPair(p ? p.syp : 0, p ? p.usd : 0, true); }

/* A percentage pair. null is "there was no revenue in that currency at all",
   which is not 0% — 0% would say the shop sold at cost. */
function repPct(p, digits) {
  if (!p) return '<span class="muted">—</span>';
  var out = [];
  if (p.syp !== null && p.syp !== undefined) out.push('<bdi dir="ltr">' + pct(p.syp, digits === undefined ? 1 : digits) + '</bdi>');
  if (p.usd !== null && p.usd !== undefined) out.push('<bdi dir="ltr">$ ' + pct(p.usd, digits === undefined ? 1 : digits) + '</bdi>');
  return out.length ? out.join(' · ') : '<span class="muted">—</span>';
}

/* "15 invoices" — a number and the noun it counts.

   The noun is a COUNTED form (rp_n_*), not the column heading. Arabic has
   different words for the two: `invoices` is الفواتير, "the invoices", which
   is right at the top of a column and reads as "3 the-invoices" under a
   number. Every count on this screen went through the heading key and every
   one of them was wrong in Arabic.

   The numeral is isolated so a digit run cannot reorder against the Arabic
   beside it — the same reason tel() and moneyPair() carry a <bdi>. */
function repCount(n, key) {
  return '<bdi dir="ltr">' + nf(n) + '</bdi> ' + t(key);
}

/* One row of a table that has nothing in it. */
function repNone(cols, msg) {
  return '<tr><td colspan="' + cols + '" class="muted" style="text-align:center;padding:28px">' +
         esc(msg || t('rp_empty_range')) + '</td></tr>';
}

/* A bar whose width is a share of the biggest row. Guarded, because every
   version of this on every screen has at some point divided by a zero total
   and written `width:NaN%` — which the browser drops silently, so the column
   goes blank and nobody can say when it stopped working. */
function repBar(value, best, lime) {
  var w = (best > 0 && value > 0) ? Math.max(3, Math.min(100, value / best * 100)) : 0;
  return '<div class="bar-track"><i' + (lime ? ' class="lime"' : '') +
         ' style="width:' + w.toFixed(1) + '%"></i></div>';
}

/* Refetch the snapshot for whatever window the chips and boxes now name.

   A FAILURE PUTS THE OLD FIGURES BACK. Blanking DB.rep on a timeout would
   draw an empty report over a shop that had a perfectly good month, and an
   empty report is not silence — it is the claim that nothing was sold. The
   toast says the range could not be read; the screen goes on showing the
   last window that was. */
function reloadReportsInto() {
  OG.repLoading = true;
  render();
  var done = function () {
    OG.repLoading = false;
    if (OG.view === 'reports') render();
  };
  Shop.reloadReports().then(done, function (err) {
    done();
    toast(t('reports_title'), (err && err.message) || t('rp_unavailable'), 'err', 4000);
  });
}

function viewReports() {
  OG.rep = OG.rep || { tab: 'sales' };
  OG.repScope = OG.repScope || '30d';
  var tabs = repTabs(), tab = repTab();

  var h = '<div class="page-head"><div><h1>' + t('reports_title') + '</h1>' +
    '<div class="sub">' + t('reports_sub') + '</div></div>' +
    '<div class="head-actions">' + exportButtons() + '</div></div>';

  /* ---- the window ----
     Two date boxes only when Custom is chosen: a pair of empty inputs on
     every visit is two more things to read past on a screen that is already
     six tabs wide. */
  h += '<div class="chip-row mb"><span class="lbl-lbl">' + t('dash_scope_label') + '</span>';
  REP_SCOPES.forEach(function (o) {
    h += '<button class="chip ' + (OG.repScope === o[0] ? 'on' : '') +
         '" data-act="rep-scope" data-k="' + o[0] + '">' + t(o[1]) + '</button>';
  });
  if (OG.repScope === 'custom') {
    h += '<span class="rp-dates">' +
      '<input type="date" class="inp" id="repFrom" value="' + esc(OG.repFrom || '') + '" ' +
        'aria-label="' + esc(t('rp_from')) + '" data-change="rep-dates">' +
      '<span class="lbl-lbl">→</span>' +
      '<input type="date" class="inp" id="repTo" value="' + esc(OG.repTo || '') + '" ' +
        'aria-label="' + esc(t('rp_to')) + '" data-change="rep-dates">' +
      '</span>';
  }
  h += '</div>';

  h += '<div class="tabs">';
  tabs.forEach(function (tb) {
    h += '<button class="tab ' + (tab === tb[0] ? 'on' : '') +
         '" data-act="rep-tab" data-tab="' + tb[0] + '">' + t(tb[1]) + '</button>';
  });
  h += '</div>';

  /* The snapshot itself may be missing — no report.read, or the request
     failed. Say which, and stop: drawing six tabs of dashes over a server
     that is simply not answering sends somebody looking for a data problem
     that is not there. */
  if (!DB.rep) {
    return h + '<div class="card"><div class="card-body">' +
      '<div class="muted" style="text-align:center;padding:48px 20px">' +
      esc(t('rp_unavailable')) + '</div></div></div>';
  }

  var label = tabs.filter(function (x) { return x[0] === tab; })[0][1];
  /* Stock is a present-tense fact, so the date chips do not apply to it and
     the card says so rather than letting "30 days" imply thirty days of
     shelves. Same for the payroll, which has no dates on it at all. */
  var timeless = (tab === 'inventory' || tab === 'employees' || tab === 'suppliers');

  h += '<div class="card mb"><div class="card-head"><h3>' + t(label) + '</h3>' +
    '<div class="card-actions muted small">' +
      (timeless ? esc(t('rp_as_of')) + ' <span dir="auto">' + esc(fmtDate(new Date())) + '</span>'
                : '<span dir="auto">' + esc(repRangeLabel()) + '</span>') +
    (OG.repLoading ? ' · ' + esc(t('loading')) : '') + '</div></div>' +
    '<div class="card-body"><div class="chart-box" style="height:250px">' +
      (repHasChart(tab) ? '<canvas id="repChart"></canvas>'
                        : '<div class="chart-empty">' + esc(t('rp_empty_range')) + '</div>') +
    '</div></div></div>';

  return h + repTable(tab);
}

/* ------------------------------------------------------------- the series
   ONE description of what the chart is, read by both the markup that decides
   whether to put a canvas on the page and the hook that draws into it.

   They used to be two separate pieces of code answering the same question,
   and they disagreed: the Inventory canvas appeared whenever any type had
   PIECES on the shelf, while the donut was fed CAPITAL — so a shop whose cost
   prices have not been entered got a chart card with a legend, an empty ring
   and nothing else in it. A canvas drawn over an all-zero series is not an
   empty chart, it is a broken-looking one, and the reader cannot tell which.

   `positiveOnly` marks the two donuts: a slice of a negative number is not a
   thing, so a loss is charted as bars and left off a ring. */
function repChartData(tab) {
  var r = DB.rep;
  if (!r) return null;
  var base = DB.repBase();
  var money = function (v) { return (base === 'USD' ? '$' : '') + Charts.compact(v); };
  var count = function (v) { return nf(v); };
  var typeName = function (x) { return DB.typeLabels[x.type] || x.type || '—'; };
  var firstName = function (s) { return String(s || '—').split(/\s+/)[0]; };

  if (tab === 'sales' && r.sales) {
    return {
      kind: 'line', fmt: money,
      labels: r.sales.series.map(function (b) { return DB.repBucketTick(b.bucket, r.sales.grain); }),
      values: r.sales.series.map(function (b) { return DB.repBaseOf(b); })
    };
  }

  if (tab === 'profit' && r.profit) {
    return {
      kind: 'bars', fmt: money, highlight: 0,
      labels: r.profit.rows.map(typeName),
      values: r.profit.rows.map(function (x) {
        return DB.repBaseOf(x.profit || x.revenue);
      })
    };
  }

  if (tab === 'inventory' && r.inventory) {
    var live = r.inventory.rows.filter(function (x) { return x.units > 0; });
    /* Capital is the better answer — what the shelves are worth is the
       question this tab is opened for — but a shop that has not entered its
       cost prices has none, and pieces is a true answer rather than an empty
       ring. Whichever is charted, the axis formatter follows it. */
    var byCost = r.inventory.hasCost &&
      live.some(function (x) { return DB.repBaseOf(x.cost) > 0; });
    return {
      kind: 'donut', positiveOnly: true, fmt: byCost ? money : count,
      labels: live.map(typeName),
      values: live.map(function (x) { return byCost ? DB.repBaseOf(x.cost) : x.units; })
    };
  }

  if (tab === 'payments' && r.payments) {
    return {
      kind: 'donut', positiveOnly: true, fmt: money,
      labels: r.payments.byPayment.map(function (x) { return DB.payLabel(x.payment); }),
      values: r.payments.byPayment.map(function (x) { return DB.repBaseOf(x); })
    };
  }

  if (tab === 'employees' && r.employees) {
    var sold = r.employees.rows.filter(function (x) { return x.sold && x.sold.count; })
      .sort(function (a, b) { return DB.repBaseOf(b.sold) - DB.repBaseOf(a.sold); });
    return {
      kind: 'bars', fmt: money, highlight: 0,
      labels: sold.map(function (x) { return firstName(x.name); }),
      values: sold.map(function (x) { return DB.repBaseOf(x.sold); })
    };
  }

  if (tab === 'suppliers' && r.suppliers) {
    /* Only the suppliers billed in the shop's own currency can share an axis;
       putting dollars and lira on one scale would draw a $200 debt as larger
       than a two-million-lira one. The table beside it carries every row in
       the currency it is actually owed in. */
    var sup = r.suppliers
      .filter(function (x) { return x.currency === base && x.outstanding > 0; })
      .sort(function (a, b) { return b.outstanding - a.outstanding; }).slice(0, 12);
    return {
      kind: 'bars', fmt: money, highlight: 0,
      labels: sup.map(function (x) { return firstName(x.name); }),
      values: sup.map(function (x) { return x.outstanding; })
    };
  }

  return null;
}

/* Is there anything worth drawing? A donut needs a positive slice; a bar or a
   line only needs one figure that is not zero, because a month that lost
   money is very much worth charting. */
function repHasChart(tab) {
  var d = repChartData(tab);
  if (!d || !d.values.length) return false;
  return d.values.some(d.positiveOnly
    ? function (v) { return v > 0; }
    : function (v) { return v !== 0; });
}

/* A row of stat cards above a table. */
function repStats(cards) {
  var h = '<div class="grid mb" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">';
  cards.forEach(function (c) {
    if (!c) return;
    h += '<div class="stat"><span class="eyebrow">' + esc(c[0]) + '</span>' +
      '<div class="val' + (c[3] ? ' accent' : '') + '">' + c[1] + '</div>' +
      (c[2] ? '<div class="foot">' + c[2] + '</div>' : '') + '</div>';
  });
  return h + '</div>';
}

function repTable(tab) {
  tab = tab || repTab();
  if (!DB.rep) return '';
  switch (tab) {
    case 'profit':    return repProfit();
    case 'inventory': return repInventory();
    case 'payments':  return repPayments();
    case 'employees': return repEmployees();
    case 'suppliers': return repSuppliers();
    default:          return repSales();
  }
}

/* ---------------------------------------------------------------- SALES ---
   One row per bucket — days up to about three months, calendar months beyond
   — with the empty ones included, because a week the shop took nothing is a
   fact and closing the gap would draw a flat line over a hole. */
function repSales() {
  var s = DB.rep.sales, grain = s.grain;
  var series = s.series;
  var base = DB.repBase();

  /* Delta on the shop's OWN currency only, and the header says so. The two
     halves of a pair cannot be added to make one number to compare, and
     picking one silently would be the same mistake in a new coat. */
  var deltaCur = base === 'USD' ? 'USD' : 'SYP';

  var prev = s.previous;
  var prevBase = DB.repBaseOf(prev.takings), nowBase = DB.repBaseOf(s.takings);

  var h = repStats([
    [t('revenue'), repMoney(s.takings),
     nowBase || prevBase ? deltaTag(nowBase, prevBase, t('rp_vs_prev')) : '', true],
    [t('invoices'), nf(s.count), s.units ? repCount(s.units, 'pieces') : ''],
    [t('avg_basket'), repMoney(s.avgBasket),
     /* One decimal, and isolated like every other numeral here: "1.1" is a
        digit run with a dot in it, which the bidi algorithm will happily
        reorder against the Arabic word beside it. */
     s.count ? '<bdi dir="ltr">' + (Math.round(s.units / s.count * 10) / 10) + '</bdi> ' +
               t('rp_per_sale') : ''],
    [t('discount'), repMoney(s.discount),
     s.discounted ? repCount(s.discounted, 'rp_n_invoice') : t('none')],
    s.voided.count ? [t('rp_voided'), nf(s.voided.count), repMoneyShort(s.voided.total)] : null
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t(grain === 'day' ? 'rp_day' : 'rp_month') + '</th>' +
    '<th class="num">' + t('invoices') + '</th>' +
    '<th class="num">' + t('revenue') + '</th>' +
    '<th class="num">' + t('avg_basket') + '</th>' +
    '<th>' + t('rp_change') + ' <span class="muted" dir="ltr">(' + esc(deltaCur) + ')</span></th>' +
    '</tr></thead><tbody>';

  if (!series.length) {
    h += repNone(5);
  } else {
    series.forEach(function (b, i) {
      var before = i > 0 ? DB.repBaseOf(series[i - 1]) : (i === 0 ? DB.repBaseOf(prev.takings) : 0);
      var avg = {
        syp: b.count && b.syp ? Math.round(b.syp / b.count) : 0,
        usd: b.count && b.usd ? Math.round(b.usd / b.count) : 0
      };
      h += '<tr' + (b.count ? '' : ' class="dim"') + '>' +
        '<td><b dir="auto">' + esc(DB.repBucketLabel(b.bucket, grain)) + '</b></td>' +
        '<td class="num">' + nf(b.count) + '</td>' +
        '<td class="num"><b>' + repMoney(b) + '</b></td>' +
        '<td class="num muted">' + (b.count ? repMoney(avg) : '—') + '</td>' +
        '<td>' + (i === 0 && !before ? '<span class="muted">—</span>'
                                     : deltaTag(DB.repBaseOf(b), before, '')) + '</td></tr>';
    });
  }

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td>' +
    '<td class="num">' + nf(s.count) + '</td>' +
    '<td class="num">' + repMoney(s.takings) + '</td>' +
    '<td class="num">' + repMoney(s.avgBasket) + '</td><td></td></tr></tfoot></table></div>';

  return h;
}

/* --------------------------------------------------------------- PROFIT ---
   Only ever drawn for profit.read — the tab is not offered otherwise and the
   server does not compute the cost half either. `unit_price` and `unit_cost`
   are both stored in the sale's own currency, so every row here is arithmetic
   on one currency rather than a re-conversion at today's rate. */
function repProfit() {
  var p = DB.rep.profit, rows = p.rows, tot = p.totals;

  if (!p.hasCost) {
    /* Belt to the tab list's braces: a permission revoked between the load
       and the render lands here rather than on a table of dashes. */
    return '<div class="card"><div class="card-body"><div class="muted" ' +
      'style="text-align:center;padding:48px 20px">' + esc(t('rp_no_profit')) + '</div></div></div>';
  }

  var best = rows.reduce(function (m, x) {
    return Math.max(m, Math.abs(DB.repBaseOf(x.profit)));
  }, 0);

  var h = repStats([
    [t('revenue'), repMoney(tot.revenue), '', true],
    [t('cost'), repMoney(tot.cost), ''],
    [t('profit'), repMoney(tot.profit), ''],
    [t('margin'), repPct(tot.margin), repCount(tot.units, 'rp_n_unit')]
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('type') + '</th><th class="num">' + t('units') + '</th>' +
    '<th class="num">' + t('revenue') + '</th><th class="num">' + t('cost') + '</th>' +
    '<th class="num">' + t('profit') + '</th><th class="num">' + t('margin') + '</th>' +
    '<th style="width:120px"></th></tr></thead><tbody>';

  if (!rows.length) h += repNone(7);
  rows.forEach(function (x) {
    h += '<tr><td><b>' + esc(DB.typeLabels[x.type] || x.type || '—') + '</b></td>' +
      '<td class="num">' + nf(x.units) + '</td>' +
      '<td class="num">' + repMoney(x.revenue) + '</td>' +
      '<td class="num muted">' + repMoney(x.cost) + '</td>' +
      '<td class="num"><b>' + repMoney(x.profit) + '</b></td>' +
      '<td class="num">' + repPct(x.margin) + '</td>' +
      '<td>' + repBar(Math.abs(DB.repBaseOf(x.profit)), best, true) + '</td></tr>';
  });

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td>' +
    '<td class="num">' + nf(tot.units) + '</td>' +
    '<td class="num">' + repMoney(tot.revenue) + '</td>' +
    '<td class="num">' + repMoney(tot.cost) + '</td>' +
    '<td class="num">' + repMoney(tot.profit) + '</td>' +
    '<td class="num">' + repPct(tot.margin) + '</td><td></td></tr></tfoot></table></div>';

  return h;
}

/* ------------------------------------------------------------ INVENTORY ---
   Present tense, and ARCHIVED LINES ARE NOT STOCK. A discontinued product
   keeps its row so old invoices still resolve, and it used to keep its pieces
   in this total too — so the shop's "capital in stock" counted goods it had
   stopped selling. The server filters them and names what it left out, because
   somebody who remembers a bigger number is owed the reason it moved. */
function repInventory() {
  var iv = DB.rep.inventory, rows = iv.rows, tot = iv.totals;
  var best = rows.reduce(function (m, x) {
    return Math.max(m, iv.hasCost ? DB.repBaseOf(x.cost) : x.units);
  }, 0);

  var h = repStats([
    iv.hasCost ? [t('capital_in_stock'), repMoney(tot.cost),
                  repCount(tot.units, 'pieces'), true] : null,
    [t('retail_value'), repMoney(tot.retail),
     iv.hasCost ? '' : repCount(tot.units, 'pieces'), !iv.hasCost],
    iv.hasCost ? [t('profit'), repMoney(tot.profit), t('if_sold_all')] : null,
    [t('rp_lines'), nf(tot.skus), repCount(rows.length, 'rp_types')]
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('type') + '</th><th class="num">' + t('pieces') + '</th>' +
    '<th class="num">' + t('rp_lines') + '</th>' +
    (iv.hasCost ? '<th class="num">' + t('capital_in_stock') + '</th>' : '') +
    '<th class="num">' + t('retail_value') + '</th>' +
    (iv.hasCost ? '<th class="num">' + t('profit') + '</th>' : '') +
    '<th style="width:130px"></th></tr></thead><tbody>';

  var cols = iv.hasCost ? 7 : 5;
  if (!rows.length) h += repNone(cols, t('rp_empty_stock'));
  rows.forEach(function (x) {
    h += '<tr' + (x.units ? '' : ' class="dim"') + '>' +
      '<td><b>' + esc(DB.typeLabels[x.type] || x.type || '—') + '</b></td>' +
      '<td class="num">' + nf(x.units) + '</td>' +
      '<td class="num muted">' + nf(x.skus) + '</td>' +
      (iv.hasCost ? '<td class="num"><b>' + repMoney(x.cost) + '</b></td>' : '') +
      '<td class="num' + (iv.hasCost ? ' muted' : '') + '">' + repMoney(x.retail) + '</td>' +
      (iv.hasCost ? '<td class="num">' + repMoney({ syp: x.retail.syp - x.cost.syp,
                                                    usd: x.retail.usd - x.cost.usd }) + '</td>' : '') +
      '<td>' + repBar(iv.hasCost ? DB.repBaseOf(x.cost) : x.units, best) + '</td></tr>';
  });

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td>' +
    '<td class="num">' + nf(tot.units) + '</td>' +
    '<td class="num">' + nf(tot.skus) + '</td>' +
    (iv.hasCost ? '<td class="num">' + repMoney(tot.cost) + '</td>' : '') +
    '<td class="num">' + repMoney(tot.retail) + '</td>' +
    (iv.hasCost ? '<td class="num">' + repMoney(tot.profit) + '</td>' : '') +
    '<td></td></tr></tfoot></table></div>';

  if (iv.archivedUnits) {
    h += '<div class="partner-note">' +
      t('rp_archived_note').replace('{n}', '<b dir="ltr">' + nf(iv.archivedUnits) + '</b>') + '</div>';
  }
  return h;
}

/* ------------------------------------------------------------- PAYMENTS ---
   How the money actually arrived, what was given away in discounts, what is
   still owed to the shop and what the shop owes out. money.read.

   The debt figure is deliberately NOT windowed by the chips: a sale taken on
   credit in March is still owed in September, and a report that dropped it
   because the chip says "30 days" would understate the shop's exposure by
   exactly the debts that have been outstanding longest. The card says so. */
function repPayments() {
  var p = DB.rep.payments, s = DB.rep.sales;
  var rows = p.byPayment;
  var best = rows.reduce(function (m, x) { return Math.max(m, DB.repBaseOf(x)); }, 0);

  var h = repStats([
    [t('rp_taken'), repMoney(s.takings), repCount(s.count, 'rp_n_invoice'), true],
    [t('rp_owed_by_customers'), repMoney(p.debts),
     p.debts.invoices
       ? repCount(p.debts.invoices, 'rp_n_invoice') + ' · ' +
         repCount(p.debts.customers, 'rp_people') +
         (p.debts.oldestDays !== null ? ' · ' + t('rp_oldest') + ' ' + repCount(p.debts.oldestDays, 'days') : '')
       : t('none')],
    [t('rp_owed_to_suppliers'), repMoney(p.suppliers),
     p.suppliers.count ? repCount(p.suppliers.count, 'rp_n_supplier') : t('none')],
    [t('mn_expenses'), repMoney(p.expenses.total),
     p.expenses.rows.length ? repCount(p.expenses.rows.length, 'rp_n_category') : t('none')],
    [t('discount'), repMoney(p.discounts.amount),
     p.discounts.overCap
       ? t('rp_over_cap').replace('{n}', nf(p.discounts.overCap)).replace('{p}', p.discounts.capPct + '%')
       : repCount(p.discounts.count, 'rp_n_invoice')]
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('rp_method') + '</th><th class="num">' + t('invoices') + '</th>' +
    '<th class="num">' + t('total') + '</th><th style="width:140px">' + t('rp_share') + '</th>' +
    '</tr></thead><tbody>';

  if (!rows.length) h += repNone(4);
  rows.forEach(function (x) {
    h += '<tr><td><b>' + esc(DB.payLabel(x.payment)) + '</b></td>' +
      '<td class="num">' + nf(x.count) + '</td>' +
      '<td class="num"><b>' + repMoney(x) + '</b></td>' +
      '<td>' + repBar(DB.repBaseOf(x), best, true) + '</td></tr>';
  });

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td>' +
    '<td class="num">' + nf(s.count) + '</td>' +
    '<td class="num">' + repMoney(s.takings) + '</td><td></td></tr></tfoot></table></div>';

  /* Debt collected in the window is money that came IN against sales taken
     earlier, so it belongs beside the takings and not inside them — adding it
     would count the same sale twice, once when it was rung up and once when
     it was paid for. */
  if (p.collected.count) {
    h += '<div class="partner-note">' +
      t('rp_collected_note')
        .replace('{n}', '<b dir="ltr">' + nf(p.collected.count) + '</b>')
        .replace('{m}', '<b>' + repMoney(p.collected.total) + '</b>') + '</div>';
  }

  if (p.expenses.rows.length) {
    var bestX = p.expenses.rows.reduce(function (m, x) { return Math.max(m, DB.repBaseOf(x)); }, 0);
    h += '<div class="card table-wrap mt"><table class="tbl"><thead><tr>' +
      '<th>' + t('mn_expenses') + '</th><th class="num">' + t('rp_entries') + '</th>' +
      '<th class="num">' + t('total') + '</th><th style="width:140px">' + t('rp_share') + '</th>' +
      '</tr></thead><tbody>';
    p.expenses.rows.forEach(function (x) {
      /* `expense.categories` lives in config so Settings can add one without
         a deploy, which means a category can exist that has no translation
         yet. t() returns the slug in that case, and the slug is what the
         person typed — so print that rather than "mn_c_municipality". */
      h += '<tr><td><b>' + esc(expenseLabel(x.category)) + '</b></td>' +
        '<td class="num">' + nf(x.count) + '</td>' +
        '<td class="num"><b>' + repMoney(x) + '</b></td>' +
        '<td>' + repBar(DB.repBaseOf(x), bestX) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td>' +
      '<td class="num">' + repMoney(p.expenses.total) + '</td><td></td></tr></tfoot></table></div>';
  }

  h += '<div class="partner-note">' + esc(t('rp_debt_note')) + '</div>';
  return h;
}

/* ------------------------------------------------------------ EMPLOYEES ---
   staff.read. An employee is matched to their sales through `user_id`, never
   through a name — two people called Ahmad is a shop, not a bug. Somebody on
   the payroll with no login has `sold: null`, and that is drawn as "no till
   login" rather than as a zero: a tailor or a driver is not the worst
   salesman in the shop. */
function repEmployees() {
  var e = DB.rep.employees, rows = e.rows;
  var best = rows.reduce(function (m, x) { return Math.max(m, x.sold ? DB.repBaseOf(x.sold) : 0); }, 0);
  var soldTotal = { syp: 0, usd: 0 }, soldCount = 0;
  rows.forEach(function (x) {
    if (!x.sold) return;
    soldTotal.syp += x.sold.syp; soldTotal.usd += x.sold.usd; soldCount += x.sold.count;
  });

  var h = repStats([
    [t('rp_payroll'), repMoney(e.salary), repCount(e.count, 'rp_people'), true],
    [t('sales_made'), repMoney(soldTotal),
     soldCount ? repCount(soldCount, 'rp_n_invoice') + ' · ' + esc(repRangeLabel()) : t('none')]
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('name') + '</th><th>' + t('role') + '</th>' +
    '<th class="num">' + t('salary') + '</th>' +
    '<th class="num">' + t('sales_made') + '</th>' +
    '<th style="width:120px"></th>' +
    '<th>' + t('next_payment') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';

  if (!rows.length) h += repNone(7, t('rp_no_employees'));
  rows.forEach(function (x) {
    h += '<tr><td><div class="cell-prod">' +
        '<span class="cc-av" style="width:28px;height:28px;font-size:10px">' + esc(initialsOf(x.name)) + '</span>' +
        '<span><b>' + esc(x.name) + '</b>' +
        (x.since ? '<small dir="auto">' + esc(t('rp_since') + ' ' + fmtDate(x.since)) + '</small>' : '') +
        '</span></div></td>' +
      '<td><span class="badge neutral">' + esc(x.role || '—') + '</span></td>' +
      '<td class="num">' + moneyIn(x.currency, x.salary) + '</td>' +
      '<td class="num"><b>' + (x.sold ? (x.sold.count ? repMoney(x.sold) : '<span class="muted">—</span>')
                                      : '<span class="muted">' + esc(t('rp_no_login')) + '</span>') + '</b></td>' +
      '<td>' + (x.sold && x.sold.count ? repBar(DB.repBaseOf(x.sold), best, true) : '') + '</td>' +
      '<td class="num">' + (x.nextPayment
          ? '<span dir="auto">' + esc(fmtDate(x.nextPayment)) + '</span> <span class="muted">· ' + esc(relDate(x.nextPayment)) + '</span>'
          : '<span class="muted">—</span>') + '</td>' +
      '<td class="muted num">' + (x.phone ? tel(x.phone) : '—') + '</td></tr>';
  });

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td>' +
    '<td class="num">' + repMoney(e.salary) + '</td>' +
    '<td class="num">' + repMoney(soldTotal) + '</td><td></td><td></td><td></td></tr></tfoot></table></div>';

  return h;
}

/* ------------------------------------------------------------ SUPPLIERS ---
   money.read. Each supplier is billed in ONE currency — it is a column on the
   row, not a pair — so these are drawn in the currency the shop actually owes
   and the totals are still folded into a pair. */
function repSuppliers() {
  var list = DB.rep.suppliers || [];
  var outstanding = { syp: 0, usd: 0 }, purchased = { syp: 0, usd: 0 };
  list.forEach(function (s) {
    if (s.currency === 'USD') { outstanding.usd += s.outstanding; purchased.usd += s.totalPurchased; }
    else { outstanding.syp += s.outstanding; purchased.syp += s.totalPurchased; }
  });
  var owing = list.filter(function (s) { return s.outstanding > 0; });

  var h = repStats([
    [t('outstanding'), repMoney(outstanding),
     owing.length ? '<bdi dir="ltr">' + nf(owing.length) + ' / ' + nf(list.length) + '</bdi> ' + t('rp_n_supplier') : t('none'), true],
    [t('rp_purchased'), repMoney(purchased), repCount(list.length, 'rp_n_supplier')]
  ]);

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('supplier') + '</th><th>' + t('category') + '</th>' +
    '<th class="num">' + t('rp_purchased') + '</th>' +
    '<th class="num">' + t('outstanding') + '</th>' +
    '<th>' + t('due') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';

  if (!list.length) h += repNone(6, t('rp_no_suppliers'));
  list.forEach(function (s) {
    /* null due date = neither late nor soon, whatever is owed. */
    var due = DB.daysSince(s.dueDate);
    var late = due !== null && due > 0 && s.outstanding > 0;
    var soon = due !== null && due > -5 && s.outstanding > 0;
    h += '<tr><td><b>' + esc(s.name) + '</b></td>' +
      '<td class="muted">' + esc(s.category || '—') + '</td>' +
      '<td class="num muted">' + moneyIn(s.currency, s.totalPurchased) + '</td>' +
      '<td class="num"><b' + (s.outstanding ? '' : ' class="muted"') + '>' +
        moneyIn(s.currency, s.outstanding) + '</b></td>' +
      '<td>' + (s.outstanding
        ? (s.dueDate
            ? '<span class="badge ' + (late ? 'critical' : (soon ? 'low' : 'neutral')) + '" dir="auto">' +
              esc(fmtDate(s.dueDate)) + ' · ' + esc(relDate(s.dueDate)) + '</span>'
            : '<span class="badge neutral">' + esc(t('rp_no_due')) + '</span>')
        : '<span class="badge healthy">' + t('none') + '</span>') + '</td>' +
      '<td class="muted num">' + (s.contact ? tel(s.contact) : '—') + '</td></tr>';
  });

  h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td>' +
    '<td class="num">' + repMoney(purchased) + '</td>' +
    '<td class="num">' + repMoney(outstanding) + '</td><td></td><td></td></tr></tfoot></table></div>';

  /* No share-of-total bar column here, deliberately: each supplier is billed
     in ONE currency, so a bar measured against the biggest lira balance would
     draw every dollar supplier as empty. The due-date badge carries the
     urgency instead, and it means the same thing in either currency. */
  return h;
}

/* An expense category's label, or the category itself when nobody has
   translated it. `expense.categories` is config, so a shop can add
   "municipality" in Settings and it will never have a key here. */
function expenseLabel(cat) {
  var k = 'mn_c_' + cat;
  var s = t(k);
  return s === k ? String(cat || '—') : s;
}

/* Initials for the avatar block. `.split(' ')` on a name with a double space
   yields an empty string whose [0] is undefined, and 'undefined' is what used
   to be printed in the circle. */
function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean)
    .slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '—';
}

/* ------------------------------------------------------------------ chart
   ONE series, in the shop's own currency, and the formatter says which. A
   chart cannot draw a pair, so rather than adding two currencies into one
   misleading line it plots the base one. Dollars taken as dollars are in
   every table on the screen and in both exports.

   The description comes from repChartData, which is also what decided the
   canvas was worth drawing — so the two can no longer disagree. */
function afterReports() {
  var c = document.getElementById('repChart');
  if (!c || !DB.rep) return;
  var d = repChartData(repTab());
  if (!d) return;

  var opts = { fmt: d.fmt, highlight: d.highlight };
  if (d.kind === 'line') Charts.line(c, d.labels, d.values, opts);
  else if (d.kind === 'donut') Charts.donut(c, d.labels, d.values, opts);
  else Charts.bars(c, d.labels, d.values, opts);
}
