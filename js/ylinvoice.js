/* ==========================================================================
   YALLA WEAR — invoices & finance                              [data-yi]
   --------------------------------------------------------------------------
   The partner's money side: what OG owes, how old it is, and the document
   that asks for it.

   Two ways to raise an invoice, because a print shop bills both ways:

     BLANK    an empty sheet you fill in like a form — pick the club from a
              dropdown, type the name, pick the size, set the price. Nothing
              has to exist in the system first.
     FROM WORK  tick off delivered kits that have not been billed yet, and
              the lines come across with their job reference attached.

   Both produce the same document and the same totals; DB.invoiceLines()
   flattens `refs` (linked to jobs) and `lines` (typed by hand) into one shape
   so nothing downstream has to know which is which.
   ========================================================================== */

var YLINV = (function () {

  /* Working copy for the builder. Held here rather than written straight into
     DB so an abandoned invoice leaves nothing behind. */
  var D = null;

  var SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

  /* Offered in the price dropdown. The middle one is CONFIG.KIT_PRINT_PRICE,
     so changing that constant moves the default without touching this list. */
  function priceOptions() {
    var base = CONFIG.KIT_PRINT_PRICE;
    var out = [Math.round(base * 0.5), Math.round(base * 0.75), base,
               Math.round(base * 1.25), Math.round(base * 1.5), Math.round(base * 2)];
    /* De-duplicate in case the base makes two steps collide. */
    return out.filter(function (v, i) { return out.indexOf(v) === i; });
  }

  function statusBadge(inv) {
    var st = DB.invoiceStatus(inv);
    var cls = st === 'paid' ? 'healthy' : st === 'part' ? 'low' : st === 'draft' ? 'neutral' : 'accent';
    if (DB.invoiceOverdue(inv)) cls = 'critical';
    return '<span class="badge ' + cls + '">' + t('yi_st_' + st) +
           (DB.invoiceOverdue(inv) ? ' · ' + DB.daysSince(inv.due) + t('yl_d') : '') + '</span>';
  }

  /* ------------------------------------------------------------ the page */

  function view() {
    var out = DB.outstandingTotal();
    var paid = DB.paidInMonth(0), lastPaid = DB.paidInMonth(1);
    var avg = DB.avgDaysToPay();
    var unbilled = DB.unbilledTotal();
    var overdue = DB.partnerInvoices.filter(function (i) { return DB.invoiceOverdue(i); });
    var age = DB.invoiceAgeing();

    var h = '<div class="page-head"><div><h1>' + t('yl_invoices') + '</h1>' +
      '<div class="sub">' + t('yi_sub') + '</div></div>' +
      '<div class="head-actions">' +
        exportButtons() +
        '<button class="btn btn-dark" data-yi="new-from-work">' + t('yi_from_work') + '</button>' +
        '<button class="btn btn-primary" data-yi="new-blank">+ ' + t('yi_new') + '</button>' +
      '</div></div>';

    h += '<div class="grid stat-row" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('yl_outstanding') + '</span>' +
        '<div class="val' + (out ? ' warn' : '') + '">' + moneyStat(out) + '</div>' +
        '<div class="foot">' + (overdue.length
          ? '<span style="color:var(--destructive);font-weight:700">' + overdue.length + ' ' + t('overdue').toLowerCase() + '</span>'
          : t('yl_from_og')) + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_invoiced_month') + '</span>' +
        '<div class="val accent">' + moneyStat(paid) + '</div>' +
        deltaTag(paid, lastPaid, t('vs_last_month')) + '</div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_avg_pay') + '</span>' +
        '<div class="val">' + (avg === null ? '—' : avg + '<span class="cur">' + t('yl_days') + '</span>') + '</div>' +
        '<div class="foot">' + t('yl_avg_pay_sub') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('yl_unbilled') + '</span>' +
        '<div class="val">' + moneyStat(unbilled) + '</div>' +
        '<div class="foot">' + DB.unbilledRefs().length + ' ' + t('yi_lines_ready') + '</div></div>' +
    '</div>';

    /* Ageing — the answer to "how long has OG been sitting on my money". */
    if (out > 0) {
      h += '<div class="card mt"><div class="card-head"><h3>' + t('yl_ageing') + '</h3>' +
        '<div class="card-actions muted small">' + t('yi_ageing_sub') + '</div></div>' +
        '<div class="card-body"><div class="yl-age">';
      age.forEach(function (b) {
        var wpct = Math.round(b.value / out * 100);
        h += '<div class="yl-age-b' + (b.value ? ' on' : '') + '" style="flex:' + Math.max(1, wpct) + '">' +
          '<span class="ab-bar"></span><span class="ab-k">' + b.key + t('yl_d') + '</span>' +
          '<span class="ab-v">' + (b.value ? money(b.value) : '—') + '</span></div>';
      });
      h += '</div></div></div>';
    }

    h += '<div class="card mt table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('yi_invoice') + '</th><th>' + t('yi_issued') + '</th><th>' + t('yi_due') + '</th>' +
      '<th class="num">' + t('yi_lines') + '</th><th class="num">' + t('pieces') + '</th>' +
      '<th class="num">' + t('total') + '</th><th class="num">' + t('yi_paid') + '</th>' +
      '<th class="num">' + t('yi_balance') + '</th><th>' + t('status') + '</th>' +
    '</tr></thead><tbody>';

    var sorted = DB.partnerInvoices.slice().sort(function (a, b) {
      return (b.issued || new Date(8640000000000000)) - (a.issued || new Date(8640000000000000));
    });

    sorted.forEach(function (inv) {
      var bal = DB.invoiceBalance(inv);
      h += '<tr class="clickable' + (DB.invoiceOverdue(inv) ? ' row-late' : '') +
             '" data-yi="open" data-id="' + inv.id + '">' +
        '<td><b>' + inv.id + '</b></td>' +
        '<td class="muted">' + (inv.issued ? fmtDate(inv.issued) : '—') + '</td>' +
        '<td class="muted">' + (inv.due ? fmtDate(inv.due) : '—') + '</td>' +
        '<td class="num">' + DB.invoiceLines(inv).length + '</td>' +
        '<td class="num">' + nf(DB.invoicePieces(inv)) + '</td>' +
        '<td class="num"><b>' + money(DB.invoiceTotal(inv)) + '</b></td>' +
        '<td class="num muted">' + money(DB.invoicePaid(inv)) + '</td>' +
        '<td class="num">' + (bal ? '<b style="color:var(--warning)">' + money(bal) + '</b>' : '—') + '</td>' +
        '<td>' + statusBadge(inv) + '</td></tr>';
    });

    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td></td><td></td>' +
      '<td class="num">' + nf(DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoicePieces(i); }, 0)) + '</td>' +
      '<td class="num">' + money(DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoiceTotal(i); }, 0)) + '</td>' +
      '<td class="num">' + money(DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoicePaid(i); }, 0)) + '</td>' +
      '<td class="num">' + money(out) + '</td><td></td></tr></tfoot></table></div>';

    return h;
  }

  function after() {}

  /* ----------------------------------------------------------- the builder
     A blank sheet with a row editor. Every control is a real input; the
     totals recompute on each keystroke rather than on save, so the number at
     the bottom is never a surprise. */

  function blankLine(seed) {
    seed = seed || {};
    return { id: 'F' + Math.random().toString(36).slice(2, 7),
             club: seed.club || '', clubAr: seed.clubAr || '',
             print: seed.print || '', number: seed.number || '',
             size: seed.size || 'L', qty: seed.qty || 1,
             price: seed.price || CONFIG.KIT_PRINT_PRICE };
  }

  function openBuilder(mode) {
    D = {
      mode: mode,
      id: DB.nextPartnerInvoiceId(),
      note: t('yi_default_note'),
      lines: mode === 'blank' ? [blankLine(), blankLine(), blankLine()] : [],
      refs: []
    };
    openModal({
      title: t('yi_new') + ' · ' + D.id,
      size: 'wide',
      body: '<div id="yiBuild">' + builderBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn" data-yi="save-draft">' + t('yi_save_draft') + '</button>' +
            '<button class="btn btn-primary" data-yi="issue-now">' + t('yi_issue') + '</button>'
    });
  }

  function repaintBuilder() {
    var host = document.getElementById('yiBuild');
    if (host) host.innerHTML = builderBody();
  }

  /* The rows that will actually be saved. A blank row sitting in the editor
     is scaffolding, not a line — counting it would show a running total of
     90,000 and then commit an invoice for 54,000, which is the kind of
     discrepancy that loses trust in the whole screen. Totals and commit both
     go through this, so they cannot disagree. */
  function validLines() {
    return D.lines.filter(function (l) { return l.club && l.club.trim() && Number(l.qty) > 0; });
  }

  function builderTotal() {
    var fromLines = validLines().reduce(function (a, l) {
      return a + (Number(l.qty) || 0) * (Number(l.price) || 0);
    }, 0);
    var fromRefs = D.refs.reduce(function (a, r) {
      var d = DB.refDetail(r); return a + (d ? d.amount : 0);
    }, 0);
    return fromLines + fromRefs;
  }

  function builderPieces() {
    var a = validLines().reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0);
    return a + D.refs.reduce(function (s, r) {
      var d = DB.refDetail(r); return s + (d ? d.qty : 0);
    }, 0);
  }

  function clubOptions(sel) {
    var h = '<option value="">' + t('yi_pick_club') + '</option>';
    Object.keys(DB.clubs).forEach(function (k) {
      var c = DB.clubs[k];
      h += '<option value="' + k + '"' + (sel === c[0] ? ' selected' : '') + '>' + esc(c[0]) + '</option>';
    });
    h += '<option value="__custom"' + (sel && !clubKeyFor(sel) ? ' selected' : '') + '>' + t('yi_other_club') + '</option>';
    return h;
  }

  function clubKeyFor(name) {
    var hit = null;
    Object.keys(DB.clubs).forEach(function (k) { if (DB.clubs[k][0] === name) hit = k; });
    return hit;
  }

  function builderBody() {
    var h = '';

    /* Mode switch — the same modal does both jobs. */
    h += '<div class="seg mb" style="width:100%">' +
      '<button data-yi="mode" data-m="blank" class="' + (D.mode === 'blank' ? 'on' : '') + '" style="flex:1">' +
        t('yi_mode_blank') + '</button>' +
      '<button data-yi="mode" data-m="work" class="' + (D.mode === 'work' ? 'on' : '') + '" style="flex:1">' +
        t('yi_mode_work') + '</button>' +
    '</div>';

    if (D.mode === 'blank') {
      h += '<div class="table-wrap"><table class="tbl yi-build"><thead><tr>' +
        '<th class="num">#</th><th>' + t('yl_kit') + '</th><th>' + t('yl_print') + '</th>' +
        '<th class="num">' + t('yi_number') + '</th><th>' + t('size') + '</th>' +
        '<th class="num">' + t('qty') + '</th><th class="num">' + t('yi_price') + '</th>' +
        '<th class="num">' + t('total') + '</th><th></th>' +
      '</tr></thead><tbody>';

      D.lines.forEach(function (l, i) {
        var amount = (Number(l.qty) || 0) * (Number(l.price) || 0);
        var custom = l.club && !clubKeyFor(l.club);
        h += '<tr>' +
          '<td class="num muted">' + pad(i + 1, 2) + '</td>' +
          '<td><select class="inp" data-yi-in="club" data-i="' + i + '">' + clubOptions(l.club) + '</select>' +
            (custom ? '<input class="inp mt-xs" type="text" placeholder="' + esc(t('yi_club_name')) +
                      '" value="' + esc(l.club) + '" data-yi-in="clubtext" data-i="' + i + '">' : '') + '</td>' +
          '<td><input class="inp" type="text" placeholder="' + esc(t('yi_name_ph')) +
            '" value="' + esc(l.print) + '" data-yi-in="print" data-i="' + i + '"></td>' +
          '<td><input class="inp num" type="number" min="0" max="99" placeholder="—" value="' +
            esc(l.number) + '" data-yi-in="number" data-i="' + i + '"></td>' +
          '<td><select class="inp" data-yi-in="size" data-i="' + i + '">' +
            SIZES.map(function (s) {
              return '<option value="' + s + '"' + (l.size === s ? ' selected' : '') + '>' + s + '</option>';
            }).join('') + '</select></td>' +
          '<td><input class="inp num" type="number" min="1" value="' + l.qty +
            '" data-yi-in="qty" data-i="' + i + '"></td>' +
          '<td><select class="inp num" data-yi-in="price" data-i="' + i + '">' +
            priceOptions().map(function (p) {
              return '<option value="' + p + '"' + (+l.price === p ? ' selected' : '') + '>' + nf(p) + '</option>';
            }).join('') +
            (priceOptions().indexOf(+l.price) === -1
              ? '<option value="' + l.price + '" selected>' + nf(l.price) + '</option>' : '') +
            '</select></td>' +
          '<td class="num"><b>' + nf(amount) + '</b></td>' +
          '<td><button class="btn btn-sm btn-ghost" data-yi="del-line" data-i="' + i + '" title="' +
            esc(t('remove')) + '">✕</button></td></tr>';
      });

      h += '</tbody></table></div>' +
        '<div class="mt" style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-sm" data-yi="add-line">+ ' + t('yi_add_line') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-yi="add-five">+ 5 ' + t('yi_rows') + '</button>' +
        '</div>';

      if (!D.lines.length) {
        h += '<div class="cart-empty"><b>' + t('yi_empty') + '</b>' + t('yi_empty_sub') + '</div>';
      }

    } else {
      /* From delivered work — tick what goes on the bill. */
      var refs = DB.unbilledRefs();
      if (!refs.length) {
        h += '<div class="cart-empty"><b>' + t('yi_nothing_ready') + '</b>' + t('yi_nothing_ready_sub') + '</div>';
      } else {
        var chosen = {};
        D.refs.forEach(function (r) { chosen[r.jobId + '|' + (r.lineId || '')] = true; });

        h += '<div style="display:flex;gap:8px;margin-bottom:10px">' +
          '<button class="btn btn-sm" data-yi="pick-all">' + t('bk_select_all') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-yi="pick-none">' + t('clear') + '</button></div>';

        h += '<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="tbl"><thead><tr>' +
          '<th style="width:34px"></th><th>' + t('yl_job') + '</th><th>' + t('yl_kit') + '</th>' +
          '<th>' + t('yl_print') + '</th><th>' + t('size') + '</th>' +
          '<th class="num">' + t('qty') + '</th><th class="num">' + t('total') + '</th>' +
        '</tr></thead><tbody>';

        refs.forEach(function (r) {
          var d = DB.refDetail(r);
          if (!d) return;
          var key = r.jobId + '|' + (r.lineId || '');
          h += '<tr>' +
            '<td><input type="checkbox" data-yi-pick="' + esc(key) + '"' + (chosen[key] ? ' checked' : '') + '></td>' +
            '<td class="muted">' + r.jobId + '</td>' +
            '<td><b>' + esc(d.label) + '</b></td>' +
            '<td>' + esc(d.print || (d.lineId ? t('yl_to_confirm') : '—')) +
              (d.number ? ' <span class="kit-no">' + d.number + '</span>' : '') + '</td>' +
            '<td>' + (d.size || '—') + '</td>' +
            '<td class="num">×' + d.qty + '</td>' +
            '<td class="num">' + nf(d.amount) + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
    }

    h += '<label class="field mt"><span>' + t('yi_note') + '</span>' +
      '<textarea class="inp" rows="2" data-yi-in="note">' + esc(D.note) + '</textarea></label>';

    h += '<div class="yi-sum mt">' +
      '<span>' + builderPieces() + ' ' + t('pieces') + ' · ' +
        (validLines().length + D.refs.length) + ' ' + t('yi_lines').toLowerCase() + '</span>' +
      '<b>' + money(builderTotal()) + '</b></div>';

    return h;
  }

  /* ------------------------------------------------------- the document */

  /* The invoice as Yalla Wear's own branded sheet: navy stock, mint accents,
     bilingual, numbered kit lines. `paper` swaps it to white stock with navy
     ink — see the note in the CSS about printers dropping backgrounds. */
  function sheet(inv, paper) {
    var lines = DB.invoiceLines(inv);
    var total = DB.invoiceTotal(inv);
    var pcs = DB.invoicePieces(inv);
    var paidAmt = DB.invoicePaid(inv);
    var bal = DB.invoiceBalance(inv);

    var h = '<div class="yw-sheet' + (paper ? ' paper' : '') + '">' +
      '<div class="yw-top">' +
        '<img class="yw-lockup" src="assets/yalla-wear.svg" alt="Yalla Wear">' +
        '<div class="yw-title"><b>INVOICE</b><span>فاتـورة</span></div>' +
      '</div>' +

      '<div class="yw-meta">' +
        '<div><span class="yw-lbl">' + t('yl_billed_to') + '</span><b>' + esc(CONFIG.SHOP_NAME.toUpperCase()) + '</b></div>' +
        '<div><span class="yw-lbl">' + t('yi_invoice') + '</span><b>' + inv.id + '</b></div>' +
        '<div><span class="yw-lbl">' + t('yi_issued') + '</span><b>' +
          (inv.issued ? fmtDate(inv.issued) : t('yi_st_draft')) + '</b></div>' +
        '<img class="yw-mark" src="assets/logo.svg" alt="OG">' +
      '</div>' +

      '<table class="yw-tbl"><thead><tr>' +
        '<th></th><th>' + t('yl_kit') + '</th><th>' + t('yl_print') + '</th>' +
        '<th class="num">' + t('qty') + '</th><th class="num">' + (OG.currency === 'USD' ? 'USD' : 'SYP') + '</th>' +
      '</tr></thead><tbody>';

    lines.forEach(function (d, i) {
      h += '<tr>' +
        '<td class="yw-n">' + pad(i + 1, 2) + '</td>' +
        '<td class="yw-kit"><b>' + esc(d.label) + '</b>' +
          (d.sub ? '<span class="yw-ar">' + esc(d.sub) + '</span>' : '') + '</td>' +
        '<td class="yw-print">' + (d.print
          ? '<span class="yw-name">' + esc(d.print) + '</span>' +
            (d.number ? '<span class="yw-no">' + d.number + '</span>' : '')
          : '<span class="yw-tbc">' + t('yl_to_confirm') + '</span>') + '</td>' +
        '<td class="num yw-qty">×' + d.qty + '</td>' +
        '<td class="num yw-amt">' + nf(OG.currency === 'USD'
          ? Math.round(d.amount / CONFIG.EXCHANGE_RATE) : d.amount) + '</td></tr>';
    });

    h += '</tbody></table>';

    h += '<div class="yw-foot-grid">' +
      '<div class="yw-notes"><span class="yw-lbl">' + t('yi_note') + ' · ملاحظات</span>' +
        '<p>' + esc(inv.note || '') + '</p>' +
        '<p>' + nf(CONFIG.KIT_PRINT_PRICE) + ' SYP ' + t('yi_per_kit') + ' · ' + t('yi_terms') + '</p></div>' +
      '<div class="yw-total">' +
        '<span class="yw-lbl">' + t('yi_total_due') + ' · ' + pcs + ' ' + t('pieces').toUpperCase() + '</span>' +
        '<span class="yw-total-ar">المبلغ الإجمالي</span>' +
        '<b>' + nf(OG.currency === 'USD' ? Math.round(total / CONFIG.EXCHANGE_RATE) : total) +
          '<i>' + (OG.currency === 'USD' ? 'USD' : 'SYP') + '</i></b>' +
        (paidAmt ? '<span class="yw-paid">' + t('yi_paid') + ' ' + money(paidAmt) +
                   ' · ' + t('yi_balance') + ' <b>' + money(bal) + '</b></span>' : '') +
      '</div></div>';

    h += '<div class="yw-sign">' +
        '<div><span class="yw-lbl">YALLA WEAR · التوقيع</span></div>' +
        '<div><span class="yw-lbl">' + t('yi_received') + ' · الاستلام</span></div>' +
      '</div>';

    h += '<div class="yw-end">' +
        '<span>' + t('yl_tagline').toUpperCase() + '</span>' +
        '<img class="yw-mark sm" src="assets/logo.svg" alt="OG">' +
      '</div>';

    /* A QR that opens this exact invoice, so a printed bill is not a dead end. */
    var qr = Codes.qrSVG(deepLink('ywinvoice', inv.id), { size: 74, quiet: 2, style: 'square',
      dark: paper ? '#2A2547' : '#B5DCC0', light: 'none' });
    if (qr) h += '<div class="yw-qr">' + qr + '<span>' + t('ex_scan') + '</span></div>';

    return h + '</div>';
  }

  function open(id) {
    var inv = DB.invoice(id);
    if (!inv) return;
    var st = DB.invoiceStatus(inv);
    var bal = DB.invoiceBalance(inv);

    var foot = '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
      '<button class="btn btn-ghost" data-yi="paper" data-id="' + id + '">' + t('yi_paper') + '</button>' +
      '<button class="btn btn-ghost" data-yi="xlsx" data-id="' + id + '">' + t('export_excel') + '</button>' +
      '<button class="btn" data-act="print-now">' + t('print') + '</button>';

    if (st === 'draft') {
      foot += '<button class="btn btn-ghost" data-yi="drop" data-id="' + id + '">' + t('bk_delete') + '</button>' +
              '<button class="btn btn-primary" data-yi="issue" data-id="' + id + '">' + t('yi_issue') + '</button>';
    } else if (bal > 0) {
      foot += '<button class="btn btn-primary" data-yi="pay" data-id="' + id + '">' + t('yi_record_payment') + '</button>';
    }

    openModal({ title: inv.id, size: 'wide', body: sheet(inv, false), foot: foot });
  }

  /* --------------------------------------------------------------- export */

  function exportSpec() {
    var rows = [], pcs = 0, total = 0;
    DB.partnerInvoices.slice().sort(function (a, b) {
      return (b.issued || 0) - (a.issued || 0);
    }).forEach(function (inv) {
      pcs += DB.invoicePieces(inv);
      total += DB.invoiceTotal(inv);
      rows.push([inv.id, inv.issued ? fmtDate(inv.issued) : '—', inv.due ? fmtDate(inv.due) : '—',
                 DB.invoicePieces(inv), exMoney(DB.invoiceTotal(inv)), exMoney(DB.invoicePaid(inv)),
                 exMoney(DB.invoiceBalance(inv)),
                 t('yi_st_' + DB.invoiceStatus(inv)) + (DB.invoiceOverdue(inv) ? ' · ' + t('overdue') : '')]);
    });
    var avg = DB.avgDaysToPay();
    return {
      theme: 'yalla', name: 'yalla-invoices', sheet: 'Invoices',
      title: t('yl_invoices'), subtitle: t('yi_sub') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('yi_invoice') }, { label: t('yi_issued') }, { label: t('yi_due') },
                { label: t('pieces'), num: true }, { label: exCol(t('total')), num: true },
                { label: exCol(t('yi_paid')), num: true }, { label: exCol(t('yi_balance')), num: true },
                { label: t('status') }],
      rows: rows,
      totals: [t('total'), null, null, pcs, exMoney(total),
               exMoney(DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoicePaid(i); }, 0)),
               exMoney(DB.outstandingTotal()), null],
      kpis: [{ label: t('yl_outstanding'), value: money(DB.outstandingTotal()) },
             { label: t('yl_invoiced_month'), value: money(DB.paidInMonth(0)) },
             { label: t('yl_avg_pay'), value: avg === null ? '—' : avg + ' ' + t('yl_days') }]
    };
  }

  /* One invoice as its own file — the line-by-line document, not the list. */
  function invoiceSpec(inv, kind) {
    var lines = DB.invoiceLines(inv);
    return {
      kind: kind, theme: 'yalla', name: 'invoice-' + inv.id, sheet: inv.id,
      title: t('yi_invoice') + ' ' + inv.id,
      subtitle: t('yl_billed_to') + ' ' + CONFIG.SHOP_NAME.toUpperCase() + ' · ' +
                (inv.issued ? fmtDate(inv.issued) : t('yi_st_draft')),
      docUrl: deepLink('ywinvoice', inv.id),
      columns: [{ label: '#', num: true }, { label: t('yl_kit'), width: 30 },
                { label: t('yl_print'), width: 22 }, { label: t('size') },
                { label: t('qty'), num: true }, { label: exCol(t('total')), num: true }],
      rows: lines.map(function (d, i) {
        return [i + 1, d.label, (d.print || t('yl_to_confirm')) + (d.number ? ' ' + d.number : ''),
                d.size || '—', d.qty, exMoney(d.amount)];
      }),
      totals: [null, t('total'), null, null, DB.invoicePieces(inv), exMoney(DB.invoiceTotal(inv))],
      kpis: [{ label: t('total'), value: money(DB.invoiceTotal(inv)) },
             { label: t('yi_paid'), value: money(DB.invoicePaid(inv)) },
             { label: t('yi_balance'), value: money(DB.invoiceBalance(inv)) }]
    };
  }

  /* ---------------------------------------------------------------- acts */

  function refresh() { render(); }

  var ACT = {
    'new-blank': function () { openBuilder('blank'); },
    'new-from-work': function () { openBuilder('work'); },
    mode: function (el) { D.mode = el.getAttribute('data-m'); repaintBuilder(); },
    'add-line': function () { D.lines.push(blankLine()); repaintBuilder(); },
    'add-five': function () { for (var i = 0; i < 5; i++) D.lines.push(blankLine()); repaintBuilder(); },
    'del-line': function (el) { D.lines.splice(+el.getAttribute('data-i'), 1); repaintBuilder(); },

    'pick-all': function () { D.refs = DB.unbilledRefs(); repaintBuilder(); },
    'pick-none': function () { D.refs = []; repaintBuilder(); },

    'save-draft': function () { commit(false); },
    'issue-now': function () { commit(true); },

    issue: function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (!inv || !DB.issueInvoice(inv)) return;
      DB.postMessage({ invoiceId: inv.id, from: 'yalla', kind: 'invoice',
        text: t('yi_msg_issued') + ' ' + inv.id + ' — ' + money(DB.invoiceTotal(inv)) +
              ', ' + t('yi_due_in') + ' ' + CONFIG.INVOICE_TERMS_DAYS + ' ' + t('yl_days') });
      closeModal();
      toast(inv.id, t('yi_issued_toast'), 'ok', 3400);
      refresh();
    },

    drop: function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (!inv || !DB.deleteDraft(inv)) return;
      closeModal();
      toast(inv.id, t('yi_draft_deleted'), 'warn');
      refresh();
    },

    paper: function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (!inv) return;
      openModal({
        title: inv.id + ' · ' + t('yi_paper'), size: 'wide', body: sheet(inv, true),
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
              '<button class="btn btn-ghost" data-yi="open" data-id="' + inv.id + '">' + t('yi_brand_mode') + '</button>' +
              '<button class="btn btn-primary" data-act="print-now">' + t('print') + '</button>'
      });
    },

    open: function (el) { open(el.getAttribute('data-id')); },

    xlsx: function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (inv) Export.run(invoiceSpec(inv, 'xlsx'));
    },

    pay: function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (!inv) return;
      var bal = DB.invoiceBalance(inv);
      openModal({
        title: t('yi_record_payment') + ' · ' + inv.id,
        body: '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="stat"><span class="eyebrow">' + t('total') + '</span>' +
              '<div class="val" style="font-size:18px">' + money(DB.invoiceTotal(inv)) + '</div></div>' +
            '<div class="stat"><span class="eyebrow">' + t('yi_balance') + '</span>' +
              '<div class="val warn" style="font-size:18px">' + money(bal) + '</div></div>' +
          '</div>' +
          '<label class="field mt"><span>' + t('yi_amount') + '</span>' +
            '<input class="inp num" id="yiPayAmt" type="number" min="1" max="' + bal + '" value="' + bal + '"></label>' +
          '<label class="field mt"><span>' + t('payment_method') + '</span>' +
            '<select class="inp" id="yiPayMethod">' +
              Object.keys(DB.paymentLabels).map(function (k) {
                return '<option value="' + k + '">' + esc(DB.paymentLabels[k]) + '</option>';
              }).join('') + '</select></label>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button class="btn btn-sm btn-ghost" data-yi="pay-part" data-id="' + inv.id +
              '" data-v="' + Math.round(bal / 2) + '">' + t('yi_half') + '</button>' +
            '<button class="btn btn-sm btn-ghost" data-yi="pay-part" data-id="' + inv.id +
              '" data-v="' + bal + '">' + t('yi_full') + '</button></div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-yi="pay-save" data-id="' + inv.id + '">' + t('save') + '</button>'
      });
    },

    'pay-part': function (el) {
      var f = document.getElementById('yiPayAmt');
      if (f) f.value = el.getAttribute('data-v');
    },

    'pay-save': function (el) {
      var inv = DB.invoice(el.getAttribute('data-id'));
      if (!inv) return;
      var amt = Math.round(Number((document.getElementById('yiPayAmt') || {}).value) || 0);
      var method = (document.getElementById('yiPayMethod') || {}).value || 'cash';
      if (!DB.payInvoice(inv, amt, method)) {
        toast(inv.id, t('yi_bad_amount'), 'err');
        return;
      }
      closeModal();
      toast(inv.id, money(amt) + ' · ' + t('yi_payment_saved'), 'ok', 3200);
      refresh();
    }
  };

  /* Turn the working copy into a real invoice. Validation happens here, once,
     rather than being scattered through the row editor. */
  function commit(issueIt) {
    var lines = validLines()
      .map(function (l) {
        var key = clubKeyFor(l.club);
        return { id: l.id, club: l.club, clubAr: key ? DB.clubs[key][1] : '',
                 print: (l.print || '').toUpperCase().trim() || null,
                 number: l.number === '' ? null : +l.number,
                 size: l.size, qty: +l.qty, price: +l.price };
      });

    if (!lines.length && !D.refs.length) {
      toast(t('yi_new'), t('yi_need_a_line'), 'warn');
      return;
    }

    var noteEl = document.querySelector('[data-yi-in="note"]');
    var inv = DB.newInvoice(D.refs, noteEl ? noteEl.value : D.note, lines);
    if (issueIt) {
      DB.issueInvoice(inv);
      DB.postMessage({ invoiceId: inv.id, from: 'yalla', kind: 'invoice',
        text: t('yi_msg_issued') + ' ' + inv.id + ' — ' + money(DB.invoiceTotal(inv)) +
              ', ' + t('yi_due_in') + ' ' + CONFIG.INVOICE_TERMS_DAYS + ' ' + t('yl_days') });
    }
    D = null;
    closeModal();
    toast(inv.id, issueIt ? t('yi_issued_toast') : t('yi_draft_saved'), 'ok', 3400);
    refresh();
    open(inv.id);
  }

  /* --------------------------------------------------------------- wiring
     Inputs are read on `input`/`change` straight into the working copy, so
     the running total at the bottom of the builder is always live. Only the
     rows that need re-drawing trigger a repaint — retyping a name must not
     steal focus from the field being typed into. */
  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-yi]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-yi')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });

    document.addEventListener('change', function (e) {
      var pick = e.target.getAttribute && e.target.getAttribute('data-yi-pick');
      if (pick && D) {
        var parts = pick.split('|');
        var ref = { jobId: parts[0], lineId: parts[1] || null };
        if (e.target.checked) D.refs.push(ref);
        else D.refs = D.refs.filter(function (r) { return r.jobId + '|' + (r.lineId || '') !== pick; });
        repaintBuilder();
      }
    });

    document.addEventListener('input', onField, true);
    document.addEventListener('change', onField, true);
  }

  function onField(e) {
    var el = e.target;
    if (!D || !el.getAttribute) return;
    var f = el.getAttribute('data-yi-in');
    if (!f) return;

    if (f === 'note') { D.note = el.value; return; }

    var l = D.lines[+el.getAttribute('data-i')];
    if (!l) return;

    if (f === 'club') {
      /* Switching to "other" has to redraw to reveal the free-text field. */
      l.club = el.value === '__custom' ? (l.club && !clubKeyFor(l.club) ? l.club : ' ')
             : el.value ? DB.clubs[el.value][0] : '';
      l.clubAr = el.value && el.value !== '__custom' ? DB.clubs[el.value][1] : '';
      repaintBuilder();
      return;
    }
    if (f === 'clubtext') { l.club = el.value; updateTotals(); return; }
    if (f === 'print')    { l.print = el.value; return; }
    if (f === 'number')   { l.number = el.value; return; }
    if (f === 'size')     { l.size = el.value; return; }
    if (f === 'qty')      { l.qty = Math.max(1, +el.value || 1); updateTotals(); return; }
    if (f === 'price')    { l.price = +el.value || 0; updateTotals(); }
  }

  /* Patch the two numbers in place instead of repainting — a full repaint on
     every keystroke would blur the input the user is typing into. */
  function updateTotals() {
    var sum = document.querySelector('.yi-sum');
    if (!sum) return;
    sum.innerHTML = '<span>' + builderPieces() + ' ' + t('pieces') + ' · ' +
      (validLines().length + D.refs.length) + ' ' + t('yi_lines').toLowerCase() + '</span>' +
      '<b>' + money(builderTotal()) + '</b>';
    document.querySelectorAll('.yi-build tbody tr').forEach(function (tr, i) {
      var l = D.lines[i];
      if (!l) return;
      var cell = tr.children[7];
      if (cell) cell.innerHTML = '<b>' + nf((Number(l.qty) || 0) * (Number(l.price) || 0)) + '</b>';
    });
  }

  bind();

  return { view: view, after: after, open: open, sheet: sheet,
           exportSpec: exportSpec, invoiceSpec: invoiceSpec };
})();
