/* ==========================================================================
   OG SYSTEM — deliveries
   --------------------------------------------------------------------------
   Two screens out of one module, because they are the same list read by two
   people with opposite questions:

     the driver   "what am I taking out, where is it, and how much do I
                   collect?" — one card per run, big targets, phone first. He
                   is standing on a scooter in the sun, not at a desk.

     the manager  "what is out, with whom, what has not come back, and who
                   still owes us?" — a table with the filters answered by the
                   database, and the buttons that move a parcel along.

   Which one you get is decided by your role, on the server, in the query. The
   driver's list is filtered by driver_id before it leaves the database — this
   file never asks for "everyone's" and then hides some.

   THE BOARD USED TO HAVE NO BUTTONS AT ALL. The till wrote every delivery
   with no driver on it and nothing here could assign one, so a parcel sat in
   `waiting` until somebody called PATCH by hand. Assign, send out, mark
   delivered, record a payment: all of it is here now, and all of it is
   refused by the server when it should be — a parcel does not go to a
   transport office while money is owed on it (server/lib/deliveries.js).
   ========================================================================== */

var Deliveries = (function () {

  var rows = [];          /* what the server last told us */
  var cap = { shown: 0, total: 0, capped: false };
  var day = null;         /* his own totals for today, drivers only */
  var loaded = false;
  var failed = null;
  var drivers = [];       /* for the Assign dialog, from the office bootstrap */

  /* The filters live here rather than in OG: they are this screen's own
     question, and every one of them is answered by the database. */
  var F = { status: 'open', method: '', money: '', q: '' };

  function isDriver() { return roleOf() === 'delivery'; }

  /* ------------------------------------------------------------------ money */

  /* Every amount arrives in its own currency's minor units. Desk.fmt is the
     one formatter for those; money() upstream assumes lira and is only right
     by accident for a shop that has never sold in dollars. */
  function fmt(minor, currency) {
    if (typeof Desk !== 'undefined' && Desk.fmt) return Desk.fmt(minor, currency || 'SYP');
    return money(Number(minor) || 0);
  }

  /* ------------------------------------------------------------------ links */

  function callLink(phone, lbl) {
    if (!phone) return '';
    return '<a class="btn btn-sm" href="tel:' + esc(String(phone).replace(/[^\d+]/g, '')) + '">' + lbl + '</a>';
  }

  /* A plain maps query rather than coordinates: nobody in Aleppo is typing a
     latitude, and the addresses here are written the way people give
     directions — "near the bakery" gets a driver closer than a pin. */
  function mapLink(address, lbl) {
    if (!address) return '';
    return '<a class="btn btn-sm" target="_blank" rel="noopener" ' +
           'href="https://www.google.com/maps/search/?api=1&query=' +
           encodeURIComponent(address) + '">' + lbl + '</a>';
  }

  /* ----------------------------------------------------------------- status */

  var TONE = { waiting: 'neutral', out: 'accent', delivered: 'healthy', failed: 'critical' };

  function statusBadge(d) {
    if (d.voided) return '<span class="badge neutral">' + t('dk_cancelled') + '</span>';
    return '<span class="badge ' + (TONE[d.status] || 'neutral') + '">' + t('dl_' + d.status) + '</span>';
  }

  /* What this row is worth to the shop right now, in one badge. */
  function moneyCell(d) {
    var h = '';
    if (d.voided) return '<span class="muted">—</span>';
    if (d.remaining > 0) {
      h += '<b class="dlb-owes">' + fmt(d.remaining, d.currency) + '</b>' +
        '<small class="muted" style="display:block">' +
          (d.method === 'pickup' ? t('dl_at_pickup')
            : d.method === 'driver' || d.fromTill ? t('dl_at_door') : t('dl_before_send')) + '</small>';
    } else {
      h += '<span class="badge healthy">' + t('dl_paid_badge') + '</span>';
    }
    if (d.pending > 0) {
      h += '<small class="dlb-pending" style="display:block">' +
        t('dl_with_driver_n').replace('{a}', Desk && Desk.moneyText ? Desk.moneyText(d.pending, d.currency) : d.pending) +
        '</small>';
    }
    return h;
  }

  function whereCell(d) {
    var bits = [];
    if (d.city) bits.push(nm(d.city));
    if (d.country && d.country !== 'SY') bits.push(esc(d.country));
    var head = bits.join(' · ') || nm(d.address || '—');
    var via = t('dk_m_' + (d.method || 'driver')) +
      (d.companyName ? ' · ' + esc(d.companyName) : d.driverName ? ' · ' + nm(d.driverName) : '');
    return '<div>' + head + '</div><small class="muted" style="display:block">' + via + '</small>' +
      (d.trackingNo ? '<small class="muted" style="display:block"><bdi dir="ltr">' +
        esc(d.trackingNo) + '</bdi></small>' : '') +
      (d.city && d.address ? '<small class="muted" style="display:block">' + nm(d.address) + '</small>' : '');
  }

  /* Who this parcel is for — and whether a parcel to them has come back
     before. Derived from the board every time, never stored: "this customer
     has failed deliveries" is a judgement about a person, and a stored flag
     outlives its reason. */
  function whoCell(d) {
    var name = nm(d.customerName || t('walk_in'));
    var cust = d.customerId ? DB.customer(d.customerId) : null;
    var link = (cust && typeof allow === 'function' && allow('customer.read') && !isDriver())
      ? '<span class="clickable" data-act="cu-open" data-id="' + cust.id + '">' + name + ' ›</span>'
      : name;

    var back = 0;
    if (d.customerId) {
      rows.forEach(function (x) {
        if (x.customerId === d.customerId && x.id !== d.id && x.status === 'failed') back++;
      });
    }
    return link + (back
      ? '<small style="display:block" class="muted">' + t('dl_failed_before').replace('{n}', nf(back)) + '</small>'
      : '');
  }

  /* ------------------------------------------------------------- the driver */

  function runCard(d) {
    var done = d.status === 'delivered' || d.status === 'failed';
    var h = '<div class="run-card' + (done ? ' is-done' : '') + (d.status === 'out' ? ' is-out' : '') + '">';

    h += '<div class="rc-top">' +
      '<div class="rc-who"><b>' + esc(d.customerName || t('walk_in')) + '</b>' +
        '<small>' + esc(d.saleId) + '</small></div>' + statusBadge(d) + '</div>';

    h += '<div class="rc-addr">' + esc(d.address) + '</div>';

    if (d.items && d.items.length) {
      h += '<div class="rc-items">';
      d.items.forEach(function (it) {
        h += '<span class="rc-item">' + esc(it.name) + (it.size ? ' · ' + esc(it.size) : '') +
             ' <b>×' + it.qty + '</b></span>';
      });
      h += '</div>';
    }

    h += '<div class="rc-money">' + (d.toCollect > 0
      ? '<span class="rc-collect"><i>' + t('dl_to_collect') + '</i><b>' + fmt(d.toCollect, d.currency) + '</b></span>'
      : '<span class="rc-paid">' + t('dl_nothing_owed') + '</span>') + '</div>';

    h += '<div class="rc-acts">' + callLink(d.phone, t('dl_call')) + mapLink(d.address, t('dl_map'));
    if (d.status === 'waiting') {
      h += '<button class="btn btn-sm btn-primary" data-act="dl-go" data-id="' + d.id + '">' + t('dl_take') + '</button>';
    } else if (d.status === 'out') {
      h += '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' + t('dl_done') + '</button>' +
           '<button class="btn btn-sm" data-act="dl-fail" data-id="' + d.id + '">' + t('dl_fail') + '</button>';
    } else if (d.status === 'failed' && d.failReason) {
      h += '<span class="rc-reason">' + esc(d.failReason) + '</span>';
    }
    return h + '</div></div>';
  }

  function driverView() {
    var open = rows.filter(function (d) { return d.status === 'waiting' || d.status === 'out'; });
    var shut = rows.filter(function (d) { return d.status === 'delivered' || d.status === 'failed'; });

    var h = '<div class="page-head"><div><h1>' + t('dl_my_runs') + '</h1>' +
      '<div class="sub">' + t('dl_my_runs_sub') + ' · ' + fmtDate(TODAY) + '</div></div></div>';

    if (day) {
      h += '<div class="grid stat-row">' +
        '<div class="stat"><span class="eyebrow">' + t('dl_runs') + '</span>' +
          '<div class="val">' + nf(day.runs) + '</div>' +
          '<div class="foot">' + nf(day.delivered) + ' ' + t('dl_delivered').toLowerCase() + '</div></div>' +
        '<div class="stat"><span class="eyebrow">' + t('dl_owed') + '</span>' +
          '<div class="val accent">' + money(day.owed) + '</div>' +
          '<div class="foot">' + t('dl_collected').toLowerCase() + ' ' + money(day.collected) + '</div></div>' +
        '<div class="stat"><span class="eyebrow">' + t('dl_to_hand_in') + '</span>' +
          '<div class="val' + (day.collected > 0 ? ' warn' : '') + '">' + money(Math.max(0, day.collected)) + '</div>' +
          '<div class="foot">' + nf(day.delivered) + ' ' + t('dl_delivered').toLowerCase() +
            (day.failed ? ' · ' + nf(day.failed) + ' ' + t('dl_failed').toLowerCase() : '') + '</div></div>' +
      '</div>';
    }

    /* THE SHEET HE SIGNED FOR, AS A CHECKLIST. The office builds the handover
       (it is theirs — a driver cannot open one, see server/index.js), and
       what he carries out of the shop is exactly that piece of paper. So his
       phone groups the run by the sheet it left on and counts down: eleven
       parcels, four done. Anything with no sheet — a parcel handed over one
       at a time from the board — falls into the last group under no heading,
       which is what it is.

       Grouped here rather than asked of the server: these are his own rows,
       already loaded, and a second request would be a second answer to a
       question this screen has already had answered. */
    h += '<div class="run-list mt">';
    if (!open.length) {
      h += '<div class="card"><div class="cart-empty"><b>' + t('dl_none') + '</b>' + t('dl_none_sub') + '</div></div>';
    } else {
      var sheets = [];
      var bySheet = {};
      open.forEach(function (d) {
        var key = d.handoverId || '';
        if (!bySheet[key]) { bySheet[key] = []; sheets.push(key); }
        bySheet[key].push(d);
      });
      sheets.forEach(function (key) {
        var list = bySheet[key];
        if (key) {
          /* Done counts the whole sheet, not the part still open — "4 of 11"
             has to mean the sheet, or it reads as the work growing. */
          var all = rows.filter(function (d) { return d.handoverId === key; });
          var done = all.filter(function (d) { return d.status === 'delivered' || d.status === 'failed'; }).length;
          h += '<div class="rc-sheet"><b><bdi dir="ltr">' + esc(key) + '</bdi></b>' +
            '<span>' + t('dl_sheet_done').replace('{n}', nf(done)).replace('{of}', nf(all.length)) + '</span></div>';
        }
        list.forEach(function (d) { h += runCard(d); });
      });
    }
    h += '</div>';

    if (shut.length) {
      h += '<div class="run-list run-done mt">';
      shut.forEach(function (d) { h += runCard(d); });
      h += '</div>';
    }
    return h;
  }

  /* ------------------------------------------------------------ the manager */

  function chips(act, current, list) {
    return '<div class="seg-row">' + list.map(function (o) {
      return '<button type="button" class="seg' + (current === o.id ? ' on' : '') + '" data-act="' + act +
        '" data-id="' + esc(o.id) + '">' + o.label + '</button>';
    }).join('') + '</div>';
  }

  function filterBar() {
    var statuses = [
      { id: 'open', label: t('dl_f_open') }, { id: 'waiting', label: t('dl_waiting') },
      { id: 'out', label: t('dl_out') }, { id: 'delivered', label: t('dl_delivered') },
      { id: 'failed', label: t('dl_failed') }, { id: 'cancelled', label: t('dk_cancelled') },
      { id: 'all', label: t('dl_f_all') }
    ];
    var methods = [{ id: '', label: t('dl_f_all') }].concat(
      ['driver', 'office', 'courier', 'abroad', 'pickup'].map(function (m) {
        return { id: m, label: t('dk_m_' + m) };
      }));
    var monies = [
      { id: '', label: t('dl_f_all') }, { id: 'owes', label: t('dl_owes') },
      { id: 'paid', label: t('dl_paid_badge') }, { id: 'with_driver', label: t('dl_with_driver') }
    ];

    return '<div class="card dlb-filters"><div class="card-body">' +
      '<div class="dlb-f"><span class="lbl">' + t('status') + '</span>' + chips('dl-f-status', F.status, statuses) + '</div>' +
      '<div class="dlb-f"><span class="lbl">' + t('dl_f_method') + '</span>' + chips('dl-f-method', F.method, methods) + '</div>' +
      '<div class="dlb-f"><span class="lbl">' + t('dl_f_money') + '</span>' + chips('dl-f-money', F.money, monies) + '</div>' +
      '<div class="dlb-f dlb-search"><input class="inp" type="search" data-change="dl-q" value="' + esc(F.q) + '" ' +
        'placeholder="' + esc(t('dl_search_ph')) + '"></div>' +
    '</div></div>';
  }

  function rowActions(d) {
    if (d.voided) return '<span class="muted">—</span>';
    var h = '<div class="dlb-acts">';
    if (allow('delivery.write')) {
      if (d.status === 'waiting') {
        h += '<button class="btn btn-sm" data-act="dl-assign" data-id="' + d.id + '">' + t('dl_assign_btn') + '</button>';
        if (d.method !== 'pickup') {
          h += '<button class="btn btn-sm btn-primary" data-act="dl-go" data-id="' + d.id + '">' + t('dl_take') + '</button>';
        } else {
          h += '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' + t('dl_collected_btn') + '</button>';
        }
      } else if (d.status === 'out') {
        h += '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' + t('dl_done') + '</button>' +
             '<button class="btn btn-sm" data-act="dl-fail" data-id="' + d.id + '">' + t('dl_fail') + '</button>';
      }
    }
    if (d.order && d.remaining > 0 && (allow('delivery.desk') || allow('debt.collect'))) {
      h += '<button class="btn btn-sm" data-act="dl-pay" data-id="' + esc(d.saleId) + '">' + t('dk_take_payment') + '</button>';
    }
    /* It came back. Offered once it has actually gone somewhere — a parcel
       still waiting on the counter is cancelled, not returned. */
    if (d.order && allow('delivery.desk') && !d.voided &&
        (d.status === 'delivered' || d.status === 'failed' || d.status === 'out')) {
      h += '<button class="btn btn-sm" data-act="rd-return" data-id="' + esc(d.saleId) + '">' +
           t('rd_return') + '</button>';
    }
    h += '<button class="btn btn-sm btn-ghost" data-act="dl-open" data-id="' + esc(d.saleId) + '">' + t('dl_open') + '</button>';
    return h + '</div>';
  }

  /* THE THREE MOMENTS OF ONE DAY, side by side: what is going out, what money
     is still in a pocket, and the parcels themselves. Tabs rather than three
     more entries in the navigation — it is one desk and one person. */
  function tabBar() {
    if (typeof Road === 'undefined') return '';
    var on = Road.tab();
    var open = Road.sheetOpen() ? Road.sheetCount() : 0;
    var tabs = [
      { id: 'parcels', label: t('dl_tab_parcels'), n: 0 },
      { id: 'handover', label: t('dl_tab_handover'), n: open },
      { id: 'cash', label: t('dl_tab_cash'), n: Road.pending() }
    ];
    return '<div class="seg-row dlb-tabs">' + tabs.map(function (x) {
      return '<button type="button" class="seg' + (on === x.id ? ' on' : '') +
        '" data-act="rd-tab" data-id="' + x.id + '">' + x.label +
        (x.n ? ' <span class="badge accent">' + nf(x.n) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function boardView() {
    var out = rows.filter(function (d) { return d.status === 'out' && !d.voided; }).length;
    var owed = rows.filter(function (d) { return d.remaining > 0 && !d.voided; }).length;

    var h = '<div class="page-head"><div><h1>' + t('dl_title') + '</h1>' +
      '<div class="sub">' + t('dl_sub') + '</div></div>' +
      '<div class="head-actions">' +
        (out ? '<span class="badge accent">' + nf(out) + ' ' + t('dl_out').toLowerCase() + '</span>' : '') +
        (owed ? '<span class="badge low">' + nf(owed) + ' ' + t('dl_owes').toLowerCase() + '</span>' : '') +
        ifNav('desk', '<button class="btn btn-primary btn-sm" data-act="nav" data-view="desk">+ ' + t('dk_new') + '</button>') +
        '<button class="btn btn-ghost btn-sm" data-act="dl-reload">' + t('retry') + '</button>' +
      '</div></div>';

    h += tabBar();
    if (typeof Road !== 'undefined' && Road.tab() !== 'parcels') return h + Road.view();

    h += filterBar();

    if (!rows.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('dl_none_board') + '</b>' +
        (F.status !== 'open' || F.method || F.money || F.q ? t('dl_none_filter') : t('dl_none_board_sub')) +
        '</div></div>';
    }

    /* .dlb-tbl is what lets the stylesheet turn these rows into cards on a
       phone without touching every other table in the app. The six cells
       below are addressed by position there — invoice, customer, where,
       money, status, actions — so if a column is ever inserted, the rule in
       css/og-skin.css has to move with it. */
    h += '<div class="card table-wrap"><table class="tbl dlb-tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('dl_where') + '</th><th class="num">' + t('dl_money') + '</th>' +
      '<th>' + t('status') + '</th><th></th>' +
    '</tr></thead><tbody>';

    rows.forEach(function (d) {
      h += '<tr' + (d.status === 'failed' ? ' class="row-late"' : '') + (d.voided ? ' class="dlb-void"' : '') + '>' +
        '<td><b><bdi dir="ltr">' + esc(d.saleId) + '</bdi></b>' +
          (d.channel ? '<small style="display:block" class="muted">' + t('dk_ch_' + d.channel) + '</small>' : '') + '</td>' +
        '<td>' + whoCell(d) + (d.phone ? '<small style="display:block" class="muted">' + tel(d.phone) + '</small>' : '') + '</td>' +
        '<td class="muted">' + whereCell(d) + '</td>' +
        '<td class="num">' + moneyCell(d) + '</td>' +
        '<td>' + statusBadge(d) +
          (d.failReason ? '<small style="display:block" class="muted">' + esc(d.failReason) + '</small>' : '') + '</td>' +
        '<td class="dlb-actions">' + rowActions(d) + '</td></tr>';
    });

    return h + '</tbody></table></div>' + cappedNote(cap, t('nav_deliveries').toLowerCase());
  }

  /* -------------------------------------------------------------- the shell */

  function view() {
    if (failed) {
      return '<div class="page-head"><div><h1>' + t('dl_title') + '</h1></div></div>' +
        '<div class="card"><div class="cart-empty"><b>' + esc(failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="dl-reload">' + t('retry') + '</button></div></div>';
    }
    if (!loaded) {
      return '<div class="page-head"><div><h1>' + t('dl_title') + '</h1></div></div>' +
             '<div class="card"><div class="cart-empty"><b>' + t('loading') + '</b></div></div>';
    }
    return isDriver() ? driverView() : boardView();
  }

  function after() {
    if (typeof Auth !== 'undefined' && !Auth.can('delivery.read')) return;
    load();
    /* Whichever tab the board was left on fills itself in. */
    if (typeof Road !== 'undefined' && !isDriver()) Road.load();
    /* Who can be given a run. Only for the board, and only for an account
       that may assign one. */
    if (!isDriver() && !drivers.length && typeof Auth !== 'undefined' && Auth.can('delivery.write')) {
      API.get('/api/orders/bootstrap').then(function (b) { drivers = b.drivers || []; })
        .catch(function () { /* the Assign dialog says so if the list is empty */ });
    }
  }

  function query() {
    var p = [];
    if (F.status && F.status !== 'open') p.push('status=' + encodeURIComponent(F.status));
    else p.push('status=open');
    if (F.method) p.push('method=' + encodeURIComponent(F.method));
    if (F.money) p.push('money=' + encodeURIComponent(F.money));
    if (F.q) p.push('q=' + encodeURIComponent(F.q));
    p.push('limit=200');
    return '/api/deliveries?' + p.join('&');
  }

  function load() {
    return API.get(query())
      .then(function (d) {
        rows = d.deliveries || [];
        cap = { shown: rows.length, total: d.deliveriesTotal || rows.length, capped: !!d.deliveriesCapped };
        day = d.day || null;
        failed = null;
        loaded = true;
        repaint();
      })
      .catch(function (err) {
        loaded = true;
        failed = API.friendly(err);
        repaint();
      });
  }

  /* Repaint only this screen, and only while it is still the one on show — a
     slow response arriving after the driver has navigated away must not draw
     his round over whatever he opened instead. */
  function repaint() {
    if (OG.view !== 'dashboard' && OG.view !== 'deliveries') return;
    if (OG.view === 'dashboard' && !isDriver()) return;
    var host = document.getElementById('view');
    if (!host) return;
    host.innerHTML = view();
    /* THE SAME HOOK render() RUNS, because this screen writes #view itself
       and so never passes through it. Without this call the board was the
       one wide table in the app that never became cards on a phone: 695px
       of table on a 390px screen, with every button off the right edge. */
    if (typeof labelWideTables === 'function') labelWideTables(host);
  }

  function byId(id) {
    return rows.filter(function (d) { return d.id === id; })[0] || null;
  }

  /* ------------------------------------------------------------- the moves */

  function move(id, body, okMsg) {
    return API.patch('/api/deliveries/' + id, body)
      .then(function () {
        toast(t('dl_title'), okMsg || t('dl_marked'), 'ok');
        return load();
      })
      .catch(function (err) {
        /* The server's own sentence, which names the amount still owed when
           a company parcel is held back. */
        toast(t('dl_title'), err.message || API.friendly(err), 'err', 7000);
      });
  }

  function assignDialog(id) {
    var d = byId(id);
    if (!d) return;
    var companies = (typeof Desk !== 'undefined' && Desk.companies) ? Desk.companies() : [];

    var body = '<div class="lbl">' + t('dl_pick_driver') + '</div>';
    body += drivers.length
      ? '<div class="seg-row">' + drivers.map(function (u) {
          return '<button type="button" class="seg' + (d.driverId === u.id ? ' on' : '') +
            '" data-act="dl-assign-pick" data-kind="driver" data-id="' + u.id + '">' + nm(u.name) + '</button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_drivers') + '</div>';

    body += '<div class="lbl mt">' + t('dl_pick_company') + '</div>';
    body += companies.length
      ? '<div class="seg-row">' + companies.map(function (c) {
          return '<button type="button" class="seg' + (d.companyId === c.id ? ' on' : '') +
            '" data-act="dl-assign-pick" data-kind="company" data-id="' + esc(c.id) + '">' +
            esc(OG.lang === 'ar' ? (c.ar || c.en) : (c.en || c.ar)) + ' · ' + t('dk_m_' + c.kind) + '</button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_companies_yet') + '</div>';

    body += '<label class="field mt"><span>' + t('dl_tracking') + '</span>' +
      '<input class="inp" id="dlTrack" type="text" dir="ltr" maxlength="64" value="' + esc(d.trackingNo || '') + '"></label>';

    openModal({
      title: t('dl_assign_btn') + ' · ' + d.saleId, size: 'narrow', body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="dl-track-save" data-id="' + id + '">' + t('save') + '</button>'
    });
  }

  function doneDialog(id) {
    var d = byId(id);
    if (!d) return;
    var owed = d.remaining;
    var collects = d.method === 'pickup' || d.method === 'driver' || d.fromTill;

    var body = '';
    if (owed > 0 && collects) {
      body += '<div class="partner-note">' + t('dl_collect_hint').replace('{a}',
        (typeof Desk !== 'undefined' ? Desk.moneyText(owed, d.currency) : String(owed))) + '</div>' +
        '<label class="field mt"><span>' + t('dl_collected') + '</span>' +
          '<input class="inp num" id="dlGot" type="text" inputmode="decimal" dir="ltr" value="' +
          esc(typeof Desk !== 'undefined' ? Desk.plain(owed, d.currency) : String(owed)) + '"></label>';
      if (!isDriver() && d.method !== 'pickup') {
        body += '<label class="check"><input type="checkbox" id="dlInHand"><span>' + t('dl_in_my_hand') + '</span></label>';
      }
    } else {
      body += '<div class="partner-note">' + t('dl_nothing_to_collect') + '</div>';
    }

    openModal({
      title: t('dl_done') + ' · ' + d.saleId, size: 'narrow', body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="dl-done-go" data-id="' + id + '">' + t('dl_done') + '</button>'
    });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['dl-reload'] = function () { failed = null; loaded = false; repaint(); load(); };
    ACTIONS['dl-f-status'] = function (el) { F.status = el.getAttribute('data-id'); load(); };
    ACTIONS['dl-f-method'] = function (el) { F.method = el.getAttribute('data-id'); load(); };
    ACTIONS['dl-f-money'] = function (el) { F.money = el.getAttribute('data-id'); load(); };

    ACTIONS['dl-go'] = function (el) {
      move(+el.getAttribute('data-id'), { status: 'out' }, t('dl_sent'));
    };

    ACTIONS['dl-done'] = function (el) {
      var id = +el.getAttribute('data-id');
      /* The driver's phone asks nothing: he taps Delivered and the amount he
         was sent to collect is the amount. The board asks, because a manager
         marking somebody else's run is the one who knows what came back. */
      if (isDriver()) { move(id, { status: 'delivered' }); return; }
      doneDialog(id);
    };

    ACTIONS['dl-done-go'] = function (el) {
      var id = +el.getAttribute('data-id');
      var d = byId(id);
      var got = document.getElementById('dlGot');
      var hand = document.getElementById('dlInHand');
      var body = { status: 'delivered' };
      if (got && d && typeof Desk !== 'undefined') body.collected = Desk.toMinor(got.value, d.currency);
      if (hand && hand.checked) body.handedIn = true;
      closeModal();
      move(id, body);
    };

    ACTIONS['dl-fail'] = function (el) {
      var id = +el.getAttribute('data-id');
      openModal({
        title: t('dl_fail'), size: 'narrow',
        body: '<label class="field"><span>' + t('dl_why') + '</span>' +
              '<input class="inp" id="dlWhy" type="text" placeholder="' + esc(t('dl_why_ph')) + '"></label>',
        foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="dl-fail-go" data-id="' + id + '">' + t('dl_fail') + '</button>',
        onOpen: function (root) {
          var f = root.querySelector('#dlWhy');
          if (f) setTimeout(function () { f.focus(); }, 60);
        }
      });
    };

    ACTIONS['dl-fail-go'] = function (el) {
      var why = (document.getElementById('dlWhy') || {}).value || '';
      if (!why.trim()) { toast(t('dl_fail'), t('dl_why'), 'warn'); return; }
      closeModal();
      move(+el.getAttribute('data-id'), { status: 'failed', reason: why.trim() });
    };

    ACTIONS['dl-assign'] = function (el) { assignDialog(+el.getAttribute('data-id')); };

    /* One press, one PATCH: a driver or a company, never both — the server
       refuses the pair, and so does the dialog. */
    ACTIONS['dl-assign-pick'] = function (el) {
      var id = +el.getAttribute('data-id');
      var kind = el.getAttribute('data-kind');
      var host = el.closest('.modal');
      var saleRow = host ? host.querySelector('[data-act="dl-track-save"]') : null;
      var did = saleRow ? +saleRow.getAttribute('data-id') : null;
      if (!did) return;
      var track = (document.getElementById('dlTrack') || {}).value || '';
      closeModal();
      move(did, kind === 'driver'
        ? { driverId: id, trackingNo: track }
        : { companyId: el.getAttribute('data-id'), trackingNo: track }, t('dl_assigned'));
    };

    ACTIONS['dl-track-save'] = function (el) {
      var id = +el.getAttribute('data-id');
      var track = (document.getElementById('dlTrack') || {}).value || '';
      closeModal();
      move(id, { trackingNo: track });
    };

    ACTIONS['dl-pay'] = function (el) {
      if (typeof Desk !== 'undefined' && Desk.takePayment) Desk.takePayment(el.getAttribute('data-id'));
    };
    ACTIONS['dl-open'] = function (el) {
      if (typeof Desk !== 'undefined' && Desk.openOrder) Desk.openOrder(el.getAttribute('data-id'));
    };

    if (typeof CHANGES === 'undefined') return;
    CHANGES['dl-q'] = function (el) {
      F.q = el.value;
      clearTimeout(CHANGES._dlTimer);
      CHANGES._dlTimer = setTimeout(function () {
        load().then(function () { focusBack('[data-change="dl-q"]', String(F.q).length); });
      }, 350);
    };
  }

  return {
    view: view,
    after: after,
    load: load,
    register: register,
    /* The road's three tabs live in this screen, so they repaint through it —
       one screen, one place that writes to #view. */
    repaint: repaint,
    /* So the till can send a sale out the moment it is rung up. */
    assign: function (body) { return API.post('/api/deliveries', body); }
  };
})();
