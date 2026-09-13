/* ==========================================================================
   OG SYSTEM — the road                                              [Road]
   --------------------------------------------------------------------------
   What happens to a parcel after the office has printed its slip: it is
   handed to somebody in a batch, the cash it earns comes back at the end of
   the day, and sometimes the parcel itself comes back.

   THREE SCREENS, ONE PLACE. They are three tabs on the deliveries board
   rather than three entries in the navigation, because they are the same
   question asked at three moments of one day — what is going out, what money
   is still in a pocket, what came back — and the person asking is standing at
   the same desk for all three.

   THE SHEET IS THE POINT. A driver at the counter with eleven bags is the
   moment parcels get lost, and the answer the shop already trusts is paper:
   scan each slip, print the sheet, they sign it. So the scan box here owns
   the scanner (Road.owns, wired in js/app-boot.js beside the office's), every
   beep is one parcel on the sheet, and Hand over moves all of them in ONE
   request — the server refuses the whole sheet and names the parcels holding
   it up rather than sending half of it (server/lib/orders.js, handOver).

   NOTHING HERE DECIDES MONEY. What a driver is holding, what a return is
   worth, what may be refunded: every one of those is computed on the server
   inside the transaction that writes it. This file draws the answer and
   sends the intention.
   ========================================================================== */

var Road = (function () {

  var TAB = 'og.dl.tab';

  var tab = 'parcels';        /* parcels | handover | cash */
  var sheet = null;           /* the open handover, from the server */
  var sheets = [];            /* the recent ones */
  var cash = null;            /* GET /api/driver-cash */
  var drivers = [];
  var cos = [];               /* the transport companies, from the same call */
  var busy = false;
  var loadedFor = null;       /* which tab the data on hand belongs to */
  var justAdded = null;       /* the slip that just beeped, so its row can say so */

  try { tab = localStorage.getItem(TAB) || 'parcels'; } catch (e) { /* private window */ }
  if (['parcels', 'handover', 'cash'].indexOf(tab) < 0) tab = 'parcels';

  /* ------------------------------------------------------------------ small */

  /* TWO FORMATTERS, AND THEY ARE NOT INTERCHANGEABLE. fmt() returns MARKUP —
     the amount inside a <bdi dir="ltr"> so Arabic cannot drag the digits to
     the far end of the sentence — and is for places that render HTML. A toast
     and a sentence that gets escaped need the plain text, or the reader is
     shown the tag itself. That is exactly what a returned-money toast said
     the first time it fired. */
  function fmt(minor, cur) {
    if (typeof Desk !== 'undefined' && Desk.fmt) return Desk.fmt(minor, cur || 'SYP');
    return String(minor);
  }

  function fmtText(minor, cur) {
    if (typeof Desk !== 'undefined' && Desk.moneyText) return Desk.moneyText(minor, cur || 'SYP');
    return String(minor);
  }

  /* The office draws the faces and the method icons; the road borrows them so
     a driver looks the same on the board, the sheet and the cash card. */
  function face(id, name) {
    return (typeof Desk !== 'undefined' && Desk.face) ? Desk.face(id, name) : '';
  }
  function methodIcon(m) {
    return (typeof Desk !== 'undefined' && Desk.methodIcon) ? Desk.methodIcon(m || 'courier') : '';
  }

  function scanArt(big) {
    return '<span class="dk-laser' + (big ? '' : ' is-small') + '">' +
      '<svg class="dk-ico' + (big ? ' big' : '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>' +
      (big ? '<i></i>' : '') + '</span>';
  }

  /* THE OFFICE SCREEN MAY NEVER HAVE BEEN OPENED. Desk.companies() reads the
     office's own bootstrap, which is fetched when that screen loads — so on a
     board opened straight from the navigation the carrier picker offered
     drivers and no companies at all, and a courier standing at the counter
     could not be given a sheet. This keeps its own copy from the same
     request, and prefers whichever list has something in it. */
  function companies() {
    /* The office's copy first once it is loaded: it is the one a Settings
       save updates, so a courier added a minute ago is offered here too. */
    if (typeof Desk !== 'undefined' && Desk.companiesLoaded && Desk.companiesLoaded()) return Desk.companies();
    return cos.filter(function (c) { return c && c.active !== false; });
  }

  function coName(c) {
    return esc(OG.lang === 'ar' ? (c.ar || c.en || c.id) : (c.en || c.ar || c.id));
  }

  function coKind(id) {
    var c = companies().filter(function (x) { return x && x.id === id; })[0];
    return (c && c.kind) || 'courier';
  }

  /* The sheet is the office's — `delivery.desk` and nothing else, matching
     the routes (server/index.js). It used to accept `delivery.write` too,
     which a driver holds: the scan box was drawn on his phone and every
     scan came back 403. A control that is refused is worse than absent. */
  function mayScan() {
    return allow('delivery.desk');
  }

  function repaint() {
    if (typeof Deliveries !== 'undefined' && Deliveries.repaint) Deliveries.repaint();
  }

  /* ---------------------------------------------------------------- loading */

  function load(force) {
    if (tab === 'parcels') return Promise.resolve();
    if (!force && loadedFor === tab) return Promise.resolve();
    loadedFor = tab;

    if (tab === 'cash') {
      return API.get('/api/driver-cash')
        .then(function (d) { cash = d; repaint(); })
        .catch(function (e) { cash = { totals: [], rows: [], error: API.friendly(e) }; repaint(); });
    }

    /* The board may have been opened straight onto this tab — a reload, or a
       bookmark — so the carrier list is fetched here and not only when
       somebody presses the tab. */
    needDrivers();
    return API.get('/api/handovers?limit=12')
      .then(function (d) {
        sheets = d.handovers || [];
        var open = sheets.filter(function (h) { return h.status === 'open'; })[0];
        if (!open) { sheet = null; repaint(); return; }
        return API.get('/api/handovers/' + encodeURIComponent(open.id))
          .then(function (r) { sheet = r.handover; repaint(); });
      })
      .catch(function (e) { toast(t('rd_title'), API.friendly(e), 'err'); });
  }

  /* Who can carry a parcel, for the picker. The office bootstrap is the one
     list of both — drivers from `users`, companies from the owner's config. */
  function needDrivers() {
    if ((drivers.length || cos.length) || !allow('delivery.read')) return;
    API.get('/api/orders/bootstrap')
      .then(function (b) {
        drivers = b.drivers || [];
        cos = (b.settings && b.settings.companies) || [];
        repaint();
      })
      .catch(function () { /* the picker says the list is empty */ });
  }

  /* --------------------------------------------------------------- scanning
     The handover tab owns the scanner while it is on screen and nothing is
     open over it: every beep here is a slip, never a product. */

  function owns() {
    return OG.view === 'deliveries' && tab === 'handover' && !!sheet &&
           mayScan() && !(typeof modalOpen === 'function' && modalOpen());
  }

  /* The digits are the invoice number. On an Arabic keyboard layout the
     letters of "INV" arrive as Arabic ones — the digits do not — which is why
     this matches on them and lets the server resolve the rest. */
  function invoiceFrom(code) {
    var m = String(code || '').trim().match(/^\D{0,4}-?(\d{3,})$/);
    return m ? 'INV-' + m[1] : String(code || '').trim();
  }

  function scanned(raw) {
    add(invoiceFrom(raw));
  }

  /* ------------------------------------------------------------ the actions */

  function post(url, body, okMsg, then) {
    if (busy) return;
    busy = true;
    API.post(url, body || {})
      .then(function (r) {
        busy = false;
        if (okMsg) toast(t('rd_title'), okMsg, 'ok');
        if (then) then(r);
      })
      .catch(function (err) {
        busy = false;
        /* The server's own sentence: it names the parcels a sheet cannot
           carry, which is the whole point of refusing the batch. */
        toast(t('rd_title'), err.message || API.friendly(err), 'err', 8000);
        if (err.detail && err.detail.blocked) { load(true); }
      });
  }

  function open(kind, id) {
    post('/api/handovers', kind === 'driver' ? { kind: 'driver', driverId: id }
                                             : { kind: 'company', companyId: id },
      null, function (r) { sheet = r.handover; loadedFor = null; load(true); });
  }

  function add(saleId) {
    if (!sheet || !saleId) return;
    var already = (sheet.lines || []).filter(function (l) { return l.sale_id === saleId; })[0];
    post('/api/handovers/' + encodeURIComponent(sheet.id) + '/lines', { saleId: saleId },
      null,
      function (r) {
        sheet = r.handover;
        if (!already) {
          beep();
          /* The row that just landed glows once, so somebody scanning eleven
             bags sees each one arrive without reading the list. Cleared on a
             timer, or the next unrelated repaint would flash it again. */
          justAdded = saleId;
          setTimeout(function () { if (justAdded === saleId) justAdded = null; }, 1400);
        }
        repaint();
        focusScan();
      });
  }

  /* A short tick so somebody scanning eleven bags does not have to look up
     after every one. The same WebAudio shape js/pulse.js uses. */
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      var ctx = new C();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.06);
      setTimeout(function () { ctx.close(); }, 200);
    } catch (e) { /* a browser that will not make a sound is not an error */ }
  }

  function focusScan() {
    var el = document.getElementById('rdScan');
    if (el) setTimeout(function () { el.focus(); el.select(); }, 30);
  }

  function drop(deliveryId) {
    if (!sheet) return;
    API.del('/api/handovers/' + encodeURIComponent(sheet.id) + '/lines/' + deliveryId)
      .then(function (r) { sheet = r.handover; repaint(); })
      .catch(function (e) { toast(t('rd_title'), API.friendly(e), 'err'); });
  }

  function handOver() {
    if (!sheet) return;
    var id = sheet.id;
    post('/api/handovers/' + encodeURIComponent(id) + '/hand',
      { opId: 'ho-' + id + '-' + Date.now() },
      t('rd_handed_ok'),
      function (r) {
        sheet = null;
        loadedFor = null;
        load(true);
        if (typeof Deliveries !== 'undefined') Deliveries.load();
        printSheet(r.handover || null);
      });
  }

  /* ------------------------------------------------------------- the paper */

  function carrierOf(h) {
    if (!h) return '';
    return h.kind === 'driver' ? (h.driver_name || t('rd_driver'))
                               : (h.company_name || t('rd_company'));
  }

  function sheetDoc(h) {
    var lines = h.lines || [];
    var totals = {};
    lines.forEach(function (l) {
      if (!l.to_collect) return;
      totals[l.currency] = (totals[l.currency] || 0) + l.to_collect;
    });

    var rows = lines.map(function (l, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td><b><bdi dir="ltr">' + esc(l.sale_id) + '</bdi></b></td>' +
        '<td>' + esc(l.customer_name || '') +
          (l.phone ? '<br><span class="num" dir="ltr">' + esc(l.phone) + '</span>' : '') + '</td>' +
        '<td>' + esc([l.city, l.address].filter(Boolean).join(' — ')) + '</td>' +
        '<td class="num">' + (l.to_collect ? fmt(l.to_collect, l.currency) : '—') + '</td>' +
        '<td style="width:70px"></td></tr>';
    }).join('');

    var sum = Object.keys(totals).map(function (c) {
      return '<b>' + fmt(totals[c], c) + '</b>';
    }).join(' · ') || '—';

    return '<div class="invoice-sheet">' +
      '<div class="inv-top"><div class="inv-logo"><div class="brand-mark">' +
        '<img src="assets/logo.svg" alt="OG"></div>' +
        '<div><b>OG SYSTEM</b><small>' + t('rd_sheet') + '</small></div></div>' +
        '<div class="inv-meta"><b>' + esc(h.id) + '</b><br>' +
          fmtDateTime(new Date(h.handed_at || h.opened_at)) + '</div></div>' +

      '<div class="inv-parties">' +
        '<div><div class="lbl">' + t('rd_carrier') + '</div><b>' + esc(carrierOf(h)) + '</b><br>' +
          esc(t(h.kind === 'driver' ? 'rd_k_driver' : 'rd_k_company')) + '</div>' +
        '<div><div class="lbl">' + t('rd_parcels') + '</div><b>' + nf(lines.length) + '</b></div>' +
        '<div style="text-align:end"><div class="lbl">' + t('rd_to_collect') + '</div>' + sum + '</div>' +
      '</div>' +

      '<table class="inv-tbl"><thead><tr><th>#</th><th>' + t('invoice') + '</th>' +
        '<th>' + t('customer') + '</th><th>' + t('dl_where') + '</th>' +
        '<th class="num">' + t('rd_to_collect') + '</th><th>' + t('rd_got_it') + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +

      /* The signature is why this is paper and not a screen. */
      '<div class="inv-sign">' +
        '<div><div class="lbl">' + t('rd_sign_carrier') + '</div><div class="inv-line"></div>' +
          '<small>' + esc(carrierOf(h)) + '</small></div>' +
        '<div><div class="lbl">' + t('rd_sign_shop') + '</div><div class="inv-line"></div>' +
          '<small>' + esc(h.user_name || '') + '</small></div>' +
      '</div>' +
      '<div class="inv-note">' + t('rd_sheet_note') + '</div>' +
    '</div>';
  }

  function printSheet(h) {
    if (!h) return;
    openModal({
      title: t('rd_sheet') + ' · ' + h.id, size: 'wide',
      body: sheetDoc(h),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            '<button class="btn btn-primary" data-act="print-doc">' + t('print') + '</button>'
    });
  }

  /* ---------------------------------------------------------- the handover */

  /* WHO IS AT THE COUNTER, AS PEOPLE. A row of name chips read as a filter;
     a face per driver and an icon per company reads as "pick the person
     standing in front of you", which is the question. */
  function carrierPicker() {
    var co = companies();
    var h = '<div class="card rd-pickcard"><div class="card-body">' +
      '<div class="rd-pick-head">' + scanArt(false) +
        '<div><b>' + t('rd_pick_carrier') + '</b><span>' + t('rd_pick_carrier_sub') + '</span></div></div>';

    h += '<div class="lbl mt">' + t('rd_our_drivers') + '</div>';
    h += drivers.length
      ? '<div class="dl-picks">' + drivers.map(function (u) {
          return '<button type="button" class="dl-pick" data-act="rd-open" data-kind="driver" ' +
            'data-id="' + u.id + '">' + face(u.id, u.name) + '<b>' + nm(u.name) + '</b>' +
            '<small>' + t('rd_k_driver') + '</small></button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_drivers') + '</div>';

    h += '<div class="lbl mt">' + t('rd_companies') + '</div>';
    h += co.length
      ? '<div class="dl-picks">' + co.map(function (c) {
          return '<button type="button" class="dl-pick" data-act="rd-open" data-kind="company" ' +
            'data-id="' + esc(c.id) + '"><span class="dl-pick-ico">' + methodIcon(c.kind) + '</span>' +
            '<b>' + coName(c) + '</b><small>' + t('dk_m_' + c.kind) + '</small></button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_companies_yet') +
          (allow('config.write') ? ' <span class="clickable" data-act="dk-goto-companies">' +
            t('dk_add_in_settings') + '</span>' : '') + '</div>';

    return h + '</div></div>';
  }

  /* Goes through esc() where it is drawn, so it is TEXT. */
  function whyText(why, l) {
    if (why === 'unpaid_before_send') {
      return t('rd_why_unpaid').replace('{a}', fmtText(l ? l.remaining : 0, l ? l.currency : 'SYP'));
    }
    if (why === 'voided') return t('dk_cancelled');
    return t('rd_why_moved').replace('{s}', t('dl_' + String(why).replace('already_', '')));
  }

  function lineRow(l, open, n) {
    var why = null;
    (sheet.blocked || []).forEach(function (b) { if (b.saleId === l.sale_id) why = b.why; });
    var cls = [];
    if (why) cls.push('row-late');
    if (l.sale_id === justAdded) cls.push('rd-new');
    return '<tr' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' +
      '<td><span class="rd-n">' + nf(n) + '</span><b><bdi dir="ltr">' + esc(l.sale_id) + '</bdi></b>' +
        (why ? '<small style="display:block" class="critical">' + esc(whyText(why, l)) + '</small>' : '') + '</td>' +
      '<td>' + esc(l.customer_name || '') + '</td>' +
      '<td class="muted">' + esc([l.city, l.address].filter(Boolean).join(' — ')) + '</td>' +
      '<td class="num">' + (sheet.kind === 'company'
        ? '<span class="muted">—</span>'
        : (l.remaining ? '<b>' + fmt(l.remaining, l.currency) + '</b>'
                       : '<span class="badge healthy">' + t('dl_paid_badge') + '</span>')) + '</td>' +
      '<td>' + (open
        ? '<button class="btn btn-sm btn-ghost" data-act="rd-drop" data-id="' + l.delivery_id + '" ' +
          'aria-label="' + esc(t('dk_remove')) + '">✕</button>'
        : '') + '</td></tr>';
  }

  function openSheet() {
    var lines = sheet.lines || [];
    var blocked = (sheet.blocked || []).length;
    var totals = sheet.collect || {};
    var sum = Object.keys(totals).map(function (c) {
      return '<b>' + fmt(totals[c], c) + '</b>';
    }).join('');

    var who = sheet.kind === 'driver'
      ? face(sheet.driver_id || carrierOf(sheet), carrierOf(sheet))
      : '<span class="dl-pick-ico">' + methodIcon(coKind(sheet.company_id)) + '</span>';

    /* THE MANIFEST HEAD: who is carrying, which sheet, and the two numbers
       they are signing for — as large as the scan box, because they are what
       is read out loud before anybody signs. */
    var h = '<div class="card rd-sheet"><div class="card-body">' +
      '<div class="rd-man">' +
        '<div class="rd-man-who">' + who +
          '<div><b>' + esc(carrierOf(sheet)) + '</b>' +
          '<small><bdi dir="ltr">' + esc(sheet.id) + '</bdi> · ' +
            t(sheet.kind === 'driver' ? 'rd_k_driver' : 'rd_k_company') +
            (sheet.opened_at ? ' · ' + fmtDateTime(new Date(sheet.opened_at)) : '') + '</small></div></div>' +
        '<div class="rd-man-stats">' +
          '<div><span>' + t('rd_parcels') + '</span><b>' + nf(lines.length) + '</b></div>' +
          (sheet.kind === 'company' ? '' :
            '<div><span>' + t('rd_to_collect') + '</span>' + (sum || '<b>—</b>') + '</div>') +
        '</div>' +
      '</div>';

    /* The scan box: the whole reason this screen exists. */
    h += '<div class="rd-scan">' + scanArt(false) +
      '<input class="inp" id="rdScan" type="text" dir="ltr" autocomplete="off" ' +
        'placeholder="' + esc(t('rd_scan_ph')) + '">' +
      '<button class="btn" data-act="rd-add">' + t('rd_add') + '</button>' +
    '</div>';

    if (!lines.length) {
      h += '<div class="rd-empty">' + scanArt(true) + '<b>' + t('rd_scan_first') + '</b>' +
           '<span>' + t('rd_scan_first_sub') + '</span></div>';
    } else {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
        '<th>' + t('dl_where') + '</th><th class="num">' + t('rd_to_collect') + '</th><th></th>' +
        '</tr></thead><tbody>' +
        lines.map(function (l, i) { return lineRow(l, true, i + 1); }).join('') +
        '</tbody></table></div>';
    }

    if (blocked) {
      h += '<div class="partner-note critical mt">' + t('rd_blocked').replace('{n}', nf(blocked)) + '</div>';
    }

    h += '<div class="rd-acts">' +
      '<button class="btn btn-ghost" data-act="rd-cancel">' + t('rd_cancel_sheet') + '</button>' +
      '<button class="btn" data-act="rd-print">' + t('rd_print_sheet') + '</button>' +
      '<button class="btn btn-primary" data-act="rd-hand"' +
        (lines.length && !blocked ? '' : ' disabled') + '>' +
        t('rd_hand_over') + (lines.length ? ' · ' + nf(lines.length) : '') + '</button>' +
    '</div>';

    return h + '</div></div>';
  }

  function sheetsList() {
    var done = sheets.filter(function (h) { return h.status !== 'open'; });
    if (!done.length) return '';
    return '<div class="card mt"><div class="card-body">' +
      '<div class="lbl">' + t('rd_recent') + '</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('rd_sheet') + '</th><th>' + t('rd_carrier') + '</th>' +
        '<th class="num">' + t('rd_parcels') + '</th><th>' + t('date') + '</th><th></th>' +
      '</tr></thead><tbody>' + done.map(function (h) {
        return '<tr><td><b><bdi dir="ltr">' + esc(h.id) + '</bdi></b></td>' +
          '<td>' + esc(carrierOf(h)) + '</td>' +
          '<td class="num">' + nf(h.parcels || 0) + '</td>' +
          '<td class="muted">' + fmtDateTime(new Date(h.handed_at || h.opened_at)) + '</td>' +
          '<td><button class="btn btn-sm btn-ghost" data-act="rd-reprint" data-id="' + esc(h.id) + '">' +
            t('print') + '</button></td></tr>';
      }).join('') + '</tbody></table></div></div></div>';
  }

  function handoverView() {
    if (!mayScan()) return '<div class="card"><div class="cart-empty"><b>' + t('no_access') + '</b></div></div>';
    return (sheet ? openSheet() : carrierPicker()) + sheetsList();
  }

  /* --------------------------------------------------------- the day's cash */

  function cashView() {
    if (!cash) return '<div class="dlb-skel" aria-busy="true"><i></i><i></i></div>';
    if (!cash.totals.length) {
      return '<div class="card dlb-empty"><div class="cart-empty">' +
        '<span class="dlb-empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span>' +
        '<b>' + t('rd_cash_none') + '</b>' + t('rd_cash_none_sub') + '</div></div>';
    }

    /* One card per driver, one line per currency — a driver carrying lira and
       dollars is carrying two things, and one number for both would disagree
       with the notes on the counter. */
    var byDriver = {}, order = [];
    var all = {}, curs = [];
    cash.totals.forEach(function (r) {
      var k = String(r.driverId);
      if (!byDriver[k]) { byDriver[k] = { name: r.driverName, id: r.driverId, cur: [] }; order.push(k); }
      byDriver[k].cur.push(r);
      if (!(r.currency in all)) { all[r.currency] = 0; curs.push(r.currency); }
      all[r.currency] += r.amount;
    });

    /* The whole pile across every driver, per currency — adding lira to lira
       is arithmetic; adding lira to dollars is not, and is not done. */
    var h = '<div class="rd-cash-sum">' +
      '<span class="eyebrow">' + t('dlp_t_cash') + '</span>' +
      '<div class="rd-cash-sum-val">' + curs.map(function (c) { return '<b>' + fmt(all[c], c) + '</b>'; }).join('') + '</div>' +
      '<small>' + (order.length === 1 ? t('dlp_t_cash_sub_1')
        : t('dlp_t_cash_sub').replace('{n}', nf(order.length))) + '</small>' +
    '</div>';

    if (!cash.shift) h += '<div class="partner-note mt">' + t('rd_no_shift') + '</div>';

    order.forEach(function (k) {
      var dv = byDriver[k];
      var rows = cash.rows.filter(function (r) { return String(r.driverId) === k; });
      var parcels = {};
      rows.forEach(function (r) { parcels[r.saleId] = 1; });
      h += '<div class="card mt rd-cash-card"><div class="card-body">' +
        '<div class="rd-cash-head">' + face(dv.id, dv.name || t('rd_driver')) +
          '<div class="rd-cash-who"><b>' + nm(dv.name || t('rd_driver')) + '</b>' +
            '<small>' + t('rd_since').replace('{d}', fmtDateTime(new Date(dv.cur[0].since))) + ' · ' +
              (Object.keys(parcels).length === 1 ? t('dlp_n_parcels_1')
                : t('dlp_n_parcels').replace('{n}', nf(Object.keys(parcels).length))) + '</small></div>' +
          '<div class="rd-cash-amt">' + dv.cur.map(function (c) {
            return '<b>' + fmt(c.amount, c.currency) + '</b>';
          }).join('') + '</div></div>' +

        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
          '<th>' + t('dl_where') + '</th><th class="num">' + t('amount') + '</th>' +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr><td><b><bdi dir="ltr">' + esc(r.saleId) + '</bdi></b></td>' +
            '<td>' + esc(r.customer || '') + '</td>' +
            '<td class="muted">' + esc(r.city || r.address || '') + '</td>' +
            '<td class="num"><b>' + fmt(r.amount, r.currency) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>' +

        '<div class="rd-acts">' +
          '<button class="btn btn-primary" data-act="rd-handin" data-id="' + dv.id + '">' +
            t('rd_hand_in') + '</button>' +
        '</div></div></div>';
    });
    return h;
  }

  /* -------------------------------------------------------------- the return
     Four outcomes, chosen per case — the owner's own decision. The dialog
     asks two questions in the order a person asks them at the counter: which
     pieces came back, and what happens to the money. */

  var R = null;   /* { saleId, order, lines, outcome, amount, method } */

  function openReturn(saleId) {
    Promise.all([
      API.get('/api/orders/' + encodeURIComponent(saleId) + '/returns'),
      API.get('/api/orders/by-sale/' + encodeURIComponent(saleId))
    ]).then(function (r) {
      var can = (r[0].lines || []).filter(function (l) { return l.left > 0; });
      if (!can.length) {
        toast(t('rd_return'), t('rd_all_back'), 'warn');
        return;
      }
      R = {
        saleId: saleId, order: r[1].order, past: r[0].returns || [],
        lines: can.map(function (l) { return { sku: l.sku, name: l.name, size: l.size, left: l.left, qty: l.left, price: l.unit_price }; }),
        outcome: 'refund', amount: '', method: 'cash'
      };
      openModal({
        title: t('rd_return') + ' · ' + saleId, size: 'wide',
        body: returnBody(),
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="rd-return-go">' + t('rd_take_back') + '</button>'
      });
    }).catch(function (e) { toast(t('rd_return'), API.friendly(e), 'err'); });
  }

  var OUTCOME_ICON = {
    refund:   'M20 12H5M11 6l-6 6 6 6',
    credit:   'M3 7h18v10H3zM3 11h18M7 15h3',
    exchange: 'M4 8h14l-3-3M20 16H6l3 3',
    keep_fee: 'M2 6h12v9H2zM14 9h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4'
  };

  /* Four option cards, each carrying its own sentence — the choice and what
     it means are read together, not a chip here and its explanation below. */
  function outcomeChips() {
    return '<div class="rd-opts">' + ['refund', 'credit', 'exchange', 'keep_fee'].map(function (o) {
      return '<button type="button" class="rd-opt' + (R.outcome === o ? ' on' : '') +
        '" data-act="rd-outcome" data-id="' + o + '" aria-pressed="' + (R.outcome === o ? 'true' : 'false') + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + OUTCOME_ICON[o] + '"/></svg>' +
        '<b>' + t('rd_o_' + o) + '</b><small>' + t('rd_o_' + o + '_sub') + '</small></button>';
    }).join('') + '</div>';
  }

  function payMethods() {
    var list = (typeof DB !== 'undefined' && DB.payMethodsFor) ? DB.payMethodsFor('desk') : [];
    return list.filter(function (m) { return m.id !== 'store_credit'; });
  }

  /* What the shop would hand back if everything ticked comes off the order.
     A preview of the server's arithmetic, exactly like the office screen. */
  function backEstimate() {
    var o = R.order;
    if (!o) return 0;
    var goods = 0;
    R.lines.forEach(function (l) { goods += (Number(l.qty) || 0) * l.price; });
    var all = R.lines.every(function (l) { return Number(l.qty) === l.left; });
    var fee = (o.delivery.feeMode === 'invoice' ? o.delivery.fee : 0) || 0;
    var drop = goods + (all && R.outcome !== 'keep_fee' ? fee : 0);
    var dueAfter = Math.max(0, o.delivery.due - drop);
    return Math.max(0, o.delivery.paid - dueAfter);
  }

  function lineThumb(sku) {
    if (typeof DB === 'undefined' || !DB.variantBySku) return '';
    var v = DB.variantBySku(sku);
    var p = v ? DB.product(v.productId) : null;
    return p && typeof thumb === 'function' ? thumb(p, 'dk-thumb') : '';
  }

  function returnBody() {
    var cur = R.order ? R.order.sale.currency : 'SYP';
    var back = backEstimate();

    var h = '<div class="lbl">' + t('rd_which_back') + '</div><div class="rd-lines">';
    R.lines.forEach(function (l, i) {
      h += '<div class="rd-line' + (Number(l.qty) > 0 ? ' is-on' : '') + '">' +
        '<div class="rd-l-main">' + lineThumb(l.sku) +
          '<div><b>' + esc(l.name) + '</b>' + (l.size ? '<span class="sz">' + esc(l.size) + '</span>' : '') +
          '<small class="muted" style="display:block">' + fmt(l.price, cur) + '</small></div></div>' +
        '<div class="rd-qty">' +
          '<button type="button" class="btn btn-sm" data-act="rd-q" data-i="' + i + '" data-d="-1" aria-label="−">−</button>' +
          '<b>' + nf(l.qty) + '</b>' +
          '<button type="button" class="btn btn-sm" data-act="rd-q" data-i="' + i + '" data-d="1" aria-label="+">+</button>' +
          '<span class="muted">/ ' + nf(l.left) + '</span>' +
        '</div></div>';
    });
    h += '</div>';

    h += '<div class="lbl mt">' + t('rd_what_money') + '</div>' + outcomeChips();

    h += '<div class="rd-back">' + t('rd_goes_back') +
         ' <b dir="ltr">' + fmt(back, cur) + '</b></div>';

    if (back > 0 && (R.outcome === 'refund' || R.outcome === 'keep_fee')) {
      h += '<div class="lbl mt">' + t('rd_refund_by') + '</div><div class="seg-row">' +
        payMethods().map(function (m) {
          return '<button type="button" class="seg' + (R.method === m.id ? ' on' : '') +
            '" data-act="rd-method" data-id="' + esc(m.id) + '">' +
            esc(OG.lang === 'ar' ? (m.ar || m.en) : (m.en || m.ar)) + '</button>';
        }).join('') + '</div>';
    }

    h += '<label class="field mt"><span>' + t('rd_why') + '</span>' +
         '<input class="inp" id="rdWhy" type="text" maxlength="200" placeholder="' +
         esc(t('rd_why_ph')) + '"></label>';

    if (R.past.length) {
      h += '<div class="partner-note mt">' + t('rd_past').replace('{n}', nf(R.past.length)) + '</div>';
    }
    return h;
  }

  /* The dialog holds a typed reason and a chosen quantity, so it patches its
     own body rather than reopening — and the body is `#modal-root`, an id,
     not a class. As a class selector this matched nothing at all and the
     outcome chips simply never changed what they were drawn under. */
  function repaintReturn() {
    var host = document.querySelector('#modal-root .modal-body');
    if (!host) return;
    /* Whatever was typed about why it came back survives the repaint — the
       person usually writes that first and chooses the outcome after. */
    var why = (document.getElementById('rdWhy') || {}).value || '';
    host.innerHTML = returnBody();
    var box = document.getElementById('rdWhy');
    if (box && why) box.value = why;
  }

  function sendReturn() {
    var why = (document.getElementById('rdWhy') || {}).value || '';
    var lines = R.lines.filter(function (l) { return Number(l.qty) > 0; })
                       .map(function (l) { return { sku: l.sku, qty: Number(l.qty) }; });
    if (!lines.length) { toast(t('rd_return'), t('rd_which_back'), 'warn'); return; }
    var body = { outcome: R.outcome, lines: lines, reason: why.trim() || null,
                 method: R.method, opId: 'rt-' + R.saleId + '-' + Date.now() };
    var saleId = R.saleId;
    closeModal();
    post('/api/orders/' + encodeURIComponent(saleId) + '/returns', body, t('rd_taken_back'),
      function (r) {
        R = null;
        if (typeof Deliveries !== 'undefined') Deliveries.load();
        var msg = r.credited ? t('rd_now_credit').replace('{a}', fmtText(r.credited, r.money.currency))
                : r.refunded ? t('rd_now_refunded').replace('{a}', fmtText(r.refunded, r.money.currency))
                : t('rd_nothing_moved');
        toast(t('rd_return'), msg, 'ok', 6000);
      });
  }

  /* -------------------------------------------------------------- the wiring */

  function setTab(next) {
    tab = next;
    try { localStorage.setItem(TAB, next); } catch (e) { /* private window */ }
    if (next === 'handover') needDrivers();
    load();
    repaint();
    if (next === 'handover') focusScan();
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['rd-tab'] = function (el) { setTab(el.getAttribute('data-id')); };
    ACTIONS['rd-open'] = function (el) { open(el.getAttribute('data-kind'), el.getAttribute('data-id')); };
    ACTIONS['rd-add'] = function () {
      var el = document.getElementById('rdScan');
      if (el && el.value.trim()) { add(invoiceFrom(el.value)); el.value = ''; }
    };
    ACTIONS['rd-drop'] = function (el) { drop(+el.getAttribute('data-id')); };
    ACTIONS['rd-hand'] = function () { handOver(); };
    ACTIONS['rd-print'] = function () { printSheet(sheet); };
    ACTIONS['rd-reprint'] = function (el) {
      API.get('/api/handovers/' + encodeURIComponent(el.getAttribute('data-id')))
        .then(function (r) { printSheet(r.handover); })
        .catch(function (e) { toast(t('rd_title'), API.friendly(e), 'err'); });
    };
    ACTIONS['rd-cancel'] = function () {
      if (!sheet) return;
      post('/api/handovers/' + encodeURIComponent(sheet.id) + '/cancel', {}, t('rd_cancelled'),
        function () { sheet = null; loadedFor = null; load(true); });
    };
    ACTIONS['rd-handin'] = function (el) {
      var id = +el.getAttribute('data-id');
      post('/api/driver-cash/handin', { driverId: id, opId: 'dc-' + id + '-' + Date.now() },
        t('rd_handed_in'), function () {
          loadedFor = null;
          load(true);
          /* The board's cash tile counts the same notes. */
          if (typeof Deliveries !== 'undefined') Deliveries.load();
        });
    };

    ACTIONS['rd-return'] = function (el) { openReturn(el.getAttribute('data-id')); };
    ACTIONS['rd-outcome'] = function (el) { R.outcome = el.getAttribute('data-id'); repaintReturn(); };
    ACTIONS['rd-method'] = function (el) { R.method = el.getAttribute('data-id'); repaintReturn(); };
    ACTIONS['rd-q'] = function (el) {
      var l = R.lines[+el.getAttribute('data-i')];
      var d = +el.getAttribute('data-d');
      l.qty = Math.max(0, Math.min(l.left, (Number(l.qty) || 0) + d));
      repaintReturn();
    };
    ACTIONS['rd-return-go'] = function () { sendReturn(); };

    /* Enter in the scan box adds what was TYPED. A scanner's own Enter never
       reaches here — js/wedge.js swallows it once the keys were fast enough
       to be a scan, and Road.scanned has already had the code. This is for
       the invoice number somebody reads off a slip by hand. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var el = e.target;
      if (!el || el.id !== 'rdScan') return;
      e.preventDefault();
      if (el.value.trim()) { add(invoiceFrom(el.value)); el.value = ''; }
    });
  }

  return {
    tab: function () { return tab; },
    setTab: setTab,
    view: function () { return tab === 'cash' ? cashView() : handoverView(); },
    load: load,
    owns: owns,
    scanned: scanned,
    register: register,
    openReturn: openReturn,
    /* The board asks for these when it draws its own tab bar. */
    sheetOpen: function () { return !!sheet; },
    sheetCount: function () { return sheet ? (sheet.lines || []).length : 0; },
    pending: function () { return cash ? (cash.totals || []).length : 0; }
  };
})();
