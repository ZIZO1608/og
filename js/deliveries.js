/* ==========================================================================
   OG SYSTEM — deliveries
   --------------------------------------------------------------------------
   Two screens out of one module, because they are the same list read by two
   people with opposite questions:

     the driver   "what am I taking out, where is it, and how much do I
                   collect?" — one card per run, big targets, phone first. He
                   is standing on a scooter in the sun, not at a desk.

     the manager  "what is out, with whom, what has not come back, and who
                   still owes us?" — four live tiles, the parcels in lanes (or
                   a table for searching), and the buttons that move a parcel
                   along.

   Which one you get is decided by your role, on the server, in the query. The
   driver's list is filtered by driver_id before it leaves the database — this
   file never asks for "everyone's" and then hides some.

   THE BOARD USED TO HAVE NO BUTTONS AT ALL. The till wrote every delivery
   with no driver on it and nothing here could assign one, so a parcel sat in
   `waiting` until somebody called PATCH by hand. Assign, send out, mark
   delivered, record a payment: all of it is here now, and all of it is
   refused by the server when it should be — a parcel does not go to a
   transport office while money is owed on it (server/lib/deliveries.js).

   THE TILES ARE THE SHOP, NOT THE LIST. They come from the server's own
   summary (Deliveries.summary), because the list under them is filtered and
   capped — four numbers derived from it would change every time somebody
   typed in the search box, which is the mistake this codebase has made most
   often.
   ========================================================================== */

var Deliveries = (function () {

  var rows = [];          /* what the server last told us */
  var cap = { shown: 0, total: 0, capped: false };
  var summary = null;     /* the four tiles, for the whole shop */
  var loaded = false;
  var failed = null;
  var drivers = [];       /* for the Assign dialog, from the office bootstrap */
  var cos = [];           /* the transport companies, from the same request */

  /* The filters live here rather than in OG: they are this screen's own
     question, and every one of them is answered by the database. */
  var F = { status: 'open', method: '', money: '', q: '' };

  /* Lanes or a table, per MACHINE like the sidebar rail: the office wants the
     lanes on the big screen, whoever is hunting for last month's invoice
     wants the table. */
  var LAYOUT_KEY = 'og.dl.layout';
  var layout = 'lanes';
  try { if (localStorage.getItem(LAYOUT_KEY) === 'list') layout = 'list'; } catch (e) { /* private window */ }

  function isDriver() { return roleOf() === 'delivery'; }

  /* ------------------------------------------------------------------ money */

  /* Every amount arrives in its own currency's minor units. Desk.fmt is the
     one formatter for those; money() upstream assumes lira and is only right
     by accident for a shop that has never sold in dollars. */
  function fmt(minor, currency) {
    if (typeof Desk !== 'undefined' && Desk.fmt) return Desk.fmt(minor, currency || 'SYP');
    return money(Number(minor) || 0);
  }

  function fmtText(minor, currency) {
    if (typeof Desk !== 'undefined' && Desk.moneyText) return Desk.moneyText(minor, currency || 'SYP');
    return String(minor);
  }

  /* A pair of currencies is drawn as a pair: the first large, the rest under
     it. Never added — 400,000 lira and $60 are two things in a pocket. */
  function moneyStack(list, none) {
    if (!list || !list.length) return '<b class="dlb-t-zero">' + (none || '—') + '</b>';
    return list.map(function (m, i) {
      return i === 0 ? '<b>' + fmt(m.amount, m.currency) + '</b>'
                     : '<small class="dlb-t-more">+ ' + fmt(m.amount, m.currency) + '</small>';
    }).join('');
  }

  /* ---------------------------------------------------------------- pictures
     The method icons, the progress rail and a person's face are drawn by the
     office (js/desk.js) and shared, so a parcel looks the same on the board,
     in the order dialog and on the handover sheet. */

  function methodIcon(m) {
    return (typeof Desk !== 'undefined' && Desk.methodIcon) ? Desk.methodIcon(m || 'driver') : '';
  }
  function rail(d, labels) {
    return (typeof Desk !== 'undefined' && Desk.rail) ? Desk.rail(d, labels) : '';
  }
  function face(id, name) {
    return (typeof Desk !== 'undefined' && Desk.face) ? Desk.face(id, name) : '';
  }

  function svg(path, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  var ICON = {
    waiting:  'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    out:      'M2 6h12v9H2zM14 9h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    owed:     'M12 3v18M16.5 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7',
    cash:     'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M6.5 10v4M17.5 10v4',
    handover: 'M9 3.5h6v3H9zM7.5 5H5v15.5h14V5h-2.5M8.5 13l2.5 2.5 4.5-5',
    search:   'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M16 16l5 5',
    refresh:  'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
    wa:       'M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8.2 19.4l-4.7 1.1zM9 8.6c.2 3.4 2.9 6.2 6.4 6.4l1-1.6-2.1-1-.9.8a4.4 4.4 0 0 1-1.9-1.9l.8-.9-1-2.1L9 8.6z',
    lanes:    'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
    list:     'M4 6h16M4 12h16M4 18h16',
    check:    'M5 12.5l4.2 4.2L19 7',
    flag:     'M5 21V4M5 4h11l-2 4 2 4H5'
  };

  /* How long ago, the way it is said at a counter — "40 min", "3 h". Drawn
     once per paint; a board that ticks every second is a board that moves
     under the hand. */
  function ago(iso) {
    var at = new Date(iso || '').getTime();
    if (!isFinite(at)) return '';
    var mins = Math.floor((Date.now() - at) / 60000);
    if (mins < 1) return t('dlp_ago_now');
    if (mins < 60) return t('dlp_ago_m').replace('{n}', nf(mins));
    var hours = Math.floor(mins / 60);
    if (hours < 24) return t('dlp_ago_h').replace('{n}', nf(hours));
    return t('dlp_ago_d').replace('{n}', nf(Math.floor(hours / 24)));
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

  /* When the rest of the money is due — which depends on how it travels. */
  function whenPaid(d) {
    return d.method === 'pickup' ? t('dl_at_pickup')
      : d.method === 'driver' || d.fromTill ? t('dl_at_door') : t('dl_before_send');
  }

  function pendingLine(d) {
    if (!(d.pending > 0)) return '';
    return esc(t('dl_with_driver_n').replace('{a}', fmtText(d.pending, d.currency)));
  }

  /* What this row is worth to the shop right now, in one badge. */
  function moneyCell(d) {
    var h = '';
    if (d.voided) return '<span class="muted">—</span>';
    if (d.remaining > 0) {
      h += '<b class="dlb-owes">' + fmt(d.remaining, d.currency) + '</b>' +
        '<small class="muted" style="display:block">' + whenPaid(d) + '</small>';
    } else {
      h += '<span class="badge healthy">' + t('dl_paid_badge') + '</span>';
    }
    if (d.pending > 0) h += '<small class="dlb-pending" style="display:block">' + pendingLine(d) + '</small>';
    return h;
  }

  function whereCell(d) {
    var bits = [];
    if (d.city) bits.push(nm(d.city));
    if (d.country && d.country !== 'SY') bits.push(esc(d.country));
    var head = bits.join(' · ') || nm(d.address || '—');
    var via = t('dk_m_' + (d.method || 'driver')) +
      (d.companyName ? ' · ' + esc(d.companyName) : d.driverName ? ' · ' + nm(d.driverName) : '');
    return '<div>' + head + '</div><small class="muted dlb-via" style="display:block">' +
        methodIcon(d.method) + '<span>' + via + '</span></small>' +
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

  function isClosed(d) { return d.status === 'delivered' || d.status === 'failed'; }

  function runCard(d, stop, next) {
    var done = isClosed(d);
    var h = '<div class="run-card' + (done ? ' is-done' : '') + (d.status === 'out' ? ' is-out' : '') +
      (next ? ' is-next' : '') + '">';

    if (next) h += '<div class="rc-next">' + t('dlp_next_up') + '</div>';

    h += '<div class="rc-top">' +
      '<span class="rc-stop' + (d.status === 'failed' ? ' is-fail' : '') + '">' +
        (done ? svg(d.status === 'delivered' ? ICON.check : ICON.flag) : nf(stop)) + '</span>' +
      '<div class="rc-who"><b>' + nm(d.customerName || t('walk_in')) + '</b>' +
        '<small><bdi dir="ltr">' + esc(d.saleId) + '</bdi></small></div>' + statusBadge(d) + '</div>';

    h += '<div class="rc-addr">' + esc(d.address || (d.method === 'pickup' ? t('dk_m_pickup') : '—')) + '</div>';

    if (d.items && d.items.length) {
      h += '<div class="rc-items">';
      d.items.forEach(function (it) {
        h += '<span class="rc-item">' + esc(it.name) + (it.size ? ' · ' + esc(DB.lineSize(it)) : '') +
             ' <b>×' + it.qty + '</b></span>';
      });
      h += '</div>';
    }

    h += '<div class="rc-money">' + (d.toCollect > 0
      ? '<span class="rc-collect"><i>' + t('dl_to_collect') + '</i><b>' + fmt(d.toCollect, d.currency) + '</b></span>'
      : '<span class="rc-paid">' + svg(ICON.check) + t('dl_nothing_owed') + '</span>') + '</div>';

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

  /* Done out of today's runs. This was an SVG progress ring with the figure
     written inside it; the figure was the only part anybody read, and on a
     phone in one hand the ring was a 44px decoration around it. The numbers
     are the whole of it now — bigger, and legible at arm's length. */
  function ring(done, all) {
    return '<div class="rc-count"><b>' + nf(done) + '</b><small>/' + nf(all) + '</small></div>';
  }

  function driverView() {
    var open = rows.filter(function (d) { return d.status === 'waiting' || d.status === 'out'; });
    var shut = rows.filter(isClosed);

    var h = '<div class="page-head"><div><h1>' + t('dl_my_runs') + '</h1>' +
      '<div class="sub">' + t('dl_my_runs_sub') + ' · ' + fmtDate(new Date()) + '</div></div></div>';

    /* THE DAY IN ONE CARD. Counted off his own rows — today's, which is what
       the query asked for — and the money still to collect PER CURRENCY. The
       stat cards this replaces summed every run's to_collect into one lira
       figure, so a $60 parcel read as 60 lira. */
    var owe = {}, order = [];
    open.forEach(function (d) {
      if (!(d.remaining > 0)) return;
      var c = d.currency || 'SYP';
      if (!(c in owe)) { owe[c] = 0; order.push(c); }
      owe[c] += d.remaining;
    });
    var oweList = order.map(function (c) { return { currency: c, amount: owe[c] }; });

    if (rows.length) {
      h += '<div class="rc-hero">' + ring(shut.length, rows.length) +
        '<div class="rc-hero-txt"><span class="eyebrow">' + t('dlp_today') + '</span>' +
          '<b>' + (open.length ? t('dlp_left_n').replace('{n}', nf(open.length)) : t('dlp_all_done')) + '</b>' +
          '<small>' + t('dl_sheet_done').replace('{n}', nf(shut.length)).replace('{of}', nf(rows.length)) + '</small></div>' +
        '<div class="rc-hero-money"><span class="eyebrow">' + t('dl_to_collect') + '</span>' +
          moneyStack(oweList, t('dl_nothing_owed')) + '</div>' +
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
      h += '<div class="card rc-empty"><div class="cart-empty">' +
        '<span class="rc-empty-ico">' + svg(shut.length ? ICON.check : ICON.waiting) + '</span>' +
        '<b>' + (shut.length ? t('dlp_all_done') : t('dl_none')) + '</b>' + t('dl_none_sub') + '</div></div>';
    } else {
      var sheets = [];
      var bySheet = {};
      open.forEach(function (d) {
        var key = d.handoverId || '';
        if (!bySheet[key]) { bySheet[key] = []; sheets.push(key); }
        bySheet[key].push(d);
      });
      var stop = 0;
      sheets.forEach(function (key) {
        var list = bySheet[key];
        if (key) {
          /* Done counts the whole sheet, not the part still open — "4 of 11"
             has to mean the sheet, or it reads as the work growing. */
          var all = rows.filter(function (d) { return d.handoverId === key; });
          var done = all.filter(isClosed).length;
          /* The bar that used to sit here said exactly what the words beside
             it already said ("4 of 11"), in a thinner and vaguer way. */
          h += '<div class="rc-sheet"><b><bdi dir="ltr">' + esc(key) + '</bdi></b>' +
            '<span>' + t('dl_sheet_done').replace('{n}', nf(done)).replace('{of}', nf(all.length)) + '</span></div>';
        }
        list.forEach(function (d) { stop++; h += runCard(d, stop, stop === 1); });
      });
    }
    h += '</div>';

    /* 060 — his errands, under his parcels. */
    if (typeof Safeers !== 'undefined') h += Safeers.myErrandsHtml();

    if (shut.length) {
      h += '<div class="rc-sheet rc-sheet-done"><b>' + t('dlp_done_today') + '</b><span>' + nf(shut.length) + '</span></div>' +
        '<div class="run-list run-done">';
      shut.forEach(function (d) { h += runCard(d, 0, false); });
      h += '</div>';
    }
    return h;
  }

  /* ------------------------------------------------------------ the manager */

  function tile(id, label, value, foot, on, extra) {
    return '<button type="button" class="dlb-tile is-' + id + (on ? ' on' : '') + '" data-act="dl-tile" ' +
      'data-id="' + id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="dlb-t-head">' + svg(ICON[id]) + '<span>' + label + '</span>' + (extra || '') + '</span>' +
      '<span class="dlb-t-val">' + value + '</span>' +
      '<span class="dlb-t-foot">' + foot + '</span></button>';
  }

  function tiles() {
    if (!summary) return '';
    var s = summary;
    var owedN = 0, drv = 0;
    (s.owed || []).forEach(function (r) { owedN += r.n || 0; });
    /* A driver holding lira and dollars is one driver, not two. */
    (s.cash || []).forEach(function (r) { drv = Math.max(drv, r.drivers || 0); });
    var tab = typeof Road !== 'undefined' ? Road.tab() : 'parcels';
    return '<div class="dlb-tiles">' +
      tile('waiting', t('dl_waiting'), '<b>' + nf(s.waiting) + '</b>', t('dlp_t_waiting_sub'),
           tab === 'parcels' && F.status === 'waiting') +
      tile('out', t('dl_out'), '<b>' + nf(s.out) + '</b>', t('dlp_t_out_sub'),
           tab === 'parcels' && F.status === 'out',
           s.out ? '<i class="dlb-live" aria-hidden="true"></i>' : '') +
      tile('owed', t('dlp_t_owed'), moneyStack(s.owed, t('dlp_none_short')),
           owedN === 1 ? t('dlp_t_owed_sub_1')
             : owedN ? t('dlp_t_owed_sub').replace('{n}', nf(owedN)) : t('dlp_t_owed_none'),
           tab === 'parcels' && F.money === 'owes') +
      tile('cash', t('dlp_t_cash'), moneyStack(s.cash, t('dlp_none_short')),
           drv === 1 ? t('dlp_t_cash_sub_1')
             : drv ? t('dlp_t_cash_sub').replace('{n}', nf(drv)) : t('dlp_t_cash_none'),
           tab === 'cash') +
    '</div>';
  }

  function opt(value, current, label) {
    return '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function viewBtn(id) {
    return '<button type="button" class="dlb-vbtn' + (layout === id ? ' on' : '') + '" data-act="dl-layout" ' +
      'data-id="' + id + '" aria-pressed="' + (layout === id ? 'true' : 'false') + '">' +
      svg(ICON[id]) + '<span>' + t('dlp_v_' + id) + '</span></button>';
  }

  /* ONE ROW. It was three rows of chips — 516px of an 844px phone before the
     first parcel — and the three questions it asks are each answered by one
     choice, which is what a select is for. */
  function filterBar() {
    var statuses = [
      ['open', t(layout === 'lanes' ? 'dlp_f_today' : 'dl_f_open')], ['waiting', t('dl_waiting')],
      ['out', t('dl_out')], ['delivered', t('dl_delivered')], ['failed', t('dl_failed')],
      ['cancelled', t('dk_cancelled')], ['all', t('dl_f_all')]
    ];
    var methods = [['', t('dlp_any_method')]].concat(
      ['driver', 'office', 'courier', 'abroad', 'pickup'].map(function (m) { return [m, t('dk_m_' + m)]; }));
    var monies = [['', t('dlp_any_money')], ['owes', t('dl_owes')], ['paid', t('dl_paid_badge')],
                  ['with_driver', t('dl_with_driver')]];
    var dirty = F.status !== 'open' || F.method || F.money || F.q;

    function sel(change, current, list, aria, on) {
      return '<select class="inp dlb-sel' + (on ? ' on' : '') + '" data-change="' + change + '" aria-label="' + esc(aria) + '">' +
        list.map(function (o) { return opt(o[0], current, o[1]); }).join('') + '</select>';
    }

    return '<div class="dlb-bar">' +
      '<label class="dlb-search">' + svg(ICON.search) +
        '<input class="inp" type="search" data-change="dl-q" value="' + esc(F.q) + '" ' +
        'placeholder="' + esc(t('dl_search_ph')) + '" aria-label="' + esc(t('dl_search_ph')) + '"></label>' +
      sel('dl-f-status', F.status, statuses, t('status'), F.status !== 'open') +
      sel('dl-f-method', F.method, methods, t('dl_f_method'), !!F.method) +
      sel('dl-f-money', F.money, monies, t('dl_f_money'), !!F.money) +
      (dirty ? '<button type="button" class="btn btn-ghost btn-sm dlb-clear" data-act="dl-f-reset">' + t('dlp_clear') + '</button>' : '') +
      '<div class="dlb-view" role="group" aria-label="' + esc(t('dlp_view')) + '">' + viewBtn('lanes') + viewBtn('list') + '</div>' +
    '</div>';
  }

  /* ONE NEXT STEP, AND A "…" FOR THE REST (night shift 02).

     A row could carry NINE buttons — Assign, Take it out, Delivered, Failed,
     Take a payment, It came back, WhatsApp, Open — all the same size, several
     of them destructive, on a card the width of a phone. But a parcel is
     always at exactly one point on one road, and from any point there is one
     ordinary next thing:

         waiting → Assign a driver → Send out → Delivered

     That one is the lime button. Everything else a person might want to do to
     this parcel — mark it failed, take a payment, record a return, send the
     tracking link, open the order — goes behind a "…" on the row, which is
     how it stops being a wall and starts being a decision.

     Nothing is removed and no permission changed: every button behind the
     dots carries the same gate it carried in the row. */
  function closeRowMenus() {
    document.querySelectorAll('.dlb-menu.on').forEach(function (m) { m.classList.remove('on'); });
  }

  function rowActions(d) {
    if (d.voided) return '<span class="muted">—</span>';

    var next = '', rest = '';

    if (allow('delivery.write')) {
      if (d.status === 'waiting') {
        /* Assigned already? Then the next step is sending it, not choosing a
           carrier again — that moves under the dots as "change the carrier". */
        if (d.method !== 'pickup' && !d.driverId && !d.companyId) {
          next = '<button class="btn btn-sm btn-primary" data-act="dl-assign" data-id="' + d.id + '">' +
                 t('dl_assign_btn') + '</button>';
          rest += '<button class="dlb-mi" data-act="dl-go" data-id="' + d.id + '">' + t('dl_take') + '</button>';
        } else if (d.method !== 'pickup') {
          next = '<button class="btn btn-sm btn-primary" data-act="dl-go" data-id="' + d.id + '">' +
                 t('dl_take') + '</button>';
          rest += '<button class="dlb-mi" data-act="dl-assign" data-id="' + d.id + '">' + t('dl_assign_btn') + '</button>';
        } else {
          /* A pickup never goes out: it goes straight to collected. */
          next = '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' +
                 t('dl_collected_btn') + '</button>';
        }
      } else if (d.status === 'out') {
        next = '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' +
               t('dl_done') + '</button>';
        /* Failed is not a step forward, and it is the one a tired hand must
           not hit instead of Delivered. */
        rest += '<button class="dlb-mi" data-act="dl-fail" data-id="' + d.id + '">' + t('dl_fail') + '</button>';
      }
    }

    if (d.order && d.remaining > 0 && (allow('delivery.desk') || allow('debt.collect'))) {
      rest += '<button class="dlb-mi" data-act="dl-pay" data-id="' + esc(d.saleId) + '">' + t('dk_take_payment') + '</button>';
    }
    /* It came back. Offered once it has actually gone somewhere — a parcel
       still waiting on the counter is cancelled, not returned. */
    if (d.order && allow('delivery.desk') && !d.voided &&
        (d.status === 'delivered' || d.status === 'failed' || d.status === 'out')) {
      rest += '<button class="dlb-mi" data-act="rd-return" data-id="' + esc(d.saleId) + '">' + t('rd_return') + '</button>';
    }
    /* The tracking link, on WhatsApp, from the card itself — "where is my
       order?" is asked of the board, not of the office's saved card. Only an
       order has a page to send, and a cancelled one has nothing to follow. */
    if (d.order && d.publicToken && allow('delivery.desk')) {
      rest += '<button class="dlb-mi" data-act="dl-wa-track" data-id="' + esc(d.saleId) + '">' +
              t('dl_wa_track_title') + '</button>';
    }
    rest += '<button class="dlb-mi" data-act="dl-open" data-id="' + esc(d.saleId) + '">' + t('dl_open') + '</button>';

    /* The menu is drawn in the row and shown by a class, not built on click:
       the board repaints on every live push, and a popover held in a variable
       would be rebuilt out from under an open one. */
    return '<div class="dlb-acts">' + next +
      '<span class="dlb-more">' +
        '<button class="btn btn-sm btn-ghost dlb-dots" data-act="dl-menu" data-id="' + d.id + '" ' +
          'aria-label="' + esc(t('dl_more_actions')) + '" title="' + esc(t('dl_more_actions')) + '">···</button>' +
        '<span class="dlb-menu" data-menu="' + d.id + '">' + rest + '</span>' +
      '</span>' +
    '</div>';
  }

  /* THE THREE MOMENTS OF ONE DAY, side by side: what is going out, what money
     is still in a pocket, and the parcels themselves. Tabs rather than three
     more entries in the navigation — it is one desk and one person. */
  function tabBar() {
    if (typeof Road === 'undefined') return '';
    var on = Road.tab();
    var open = Road.sheetOpen() ? Road.sheetCount() : 0;
    var tabs = [
      { id: 'parcels', label: t('dl_tab_parcels'), n: 0, icon: ICON.waiting },
      { id: 'handover', label: t('dl_tab_handover'), n: open, icon: ICON.handover },
      { id: 'cash', label: t('dl_tab_cash'), n: Road.pending(), icon: ICON.cash }
    ];
    return '<div class="tabs dlb-tabs" role="tablist">' + tabs.map(function (x) {
      return '<button type="button" role="tab" aria-selected="' + (on === x.id ? 'true' : 'false') + '" ' +
        'class="tab' + (on === x.id ? ' on' : '') + '" data-act="rd-tab" data-id="' + x.id + '">' +
        svg(x.icon) + '<span>' + x.label + '</span>' +
        (x.n ? '<em class="dlb-tab-n">' + nf(x.n) + '</em>' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* ---- the lanes ---------------------------------------------------------- */

  function cardMoney(d) {
    if (d.voided) return '<span class="dlb-money is-void">' + t('dk_cancelled') + '</span>';
    if (d.remaining > 0) {
      return '<span class="dlb-money is-owes"><b>' + fmt(d.remaining, d.currency) + '</b>' +
        '<small>' + whenPaid(d) + '</small></span>';
    }
    return '<span class="dlb-money is-paid">' + svg(ICON.check) + t('dl_paid_badge') + '</span>';
  }

  function carrierChip(d) {
    if (d.companyName) {
      return '<span class="dlb-c-via">' + '<span class="dlb-c-ico">' + methodIcon(d.method) + '</span>' +
        '<span>' + esc(d.companyName) + '</span></span>';
    }
    if (d.driverName) {
      return '<span class="dlb-c-via">' + face(d.driverId, d.driverName) + '<span>' + nm(d.driverName) + '</span></span>';
    }
    if (d.method === 'pickup') {
      return '<span class="dlb-c-via">' + '<span class="dlb-c-ico">' + methodIcon('pickup') + '</span>' +
        '<span>' + t('dk_m_pickup') + '</span></span>';
    }
    return '<span class="dlb-c-via is-none"><span class="dlb-c-ico">' + methodIcon(d.method) + '</span>' +
      '<span>' + t('dl_unassigned') + '</span></span>';
  }

  function laneCard(d) {
    var closed = isClosed(d);
    var when = ago(closed ? d.closedAt : d.status === 'out' ? (d.outAt || d.assignedAt) : (d.assignedAt || d.saleAt));
    var place = [d.city ? nm(d.city) : '', d.country && d.country !== 'SY' ? esc(d.country) : '']
      .filter(Boolean).join(' · ');
    var addr = d.address ? nm(d.address) : '';

    /* The whole card opens the order, when there is one — the buttons and the
       customer's name inside it carry their own data-act, and the delegation
       walks up from what was pressed, so they win. */
    return '<article class="dlb-card is-' + (d.voided ? 'void' : d.status) + (d.order ? ' is-link' : '') + '"' +
        (d.order ? ' data-act="dl-open" data-id="' + esc(d.saleId) + '"' : '') + '>' +
      '<div class="dlb-c-top">' +
        '<span class="dlb-mi" title="' + esc(t('dk_m_' + (d.method || 'driver'))) + '">' + methodIcon(d.method) + '</span>' +
        '<div class="dlb-c-id"><b><bdi dir="ltr">' + esc(d.saleId) + '</bdi></b>' +
          '<small>' + (d.channel ? t('dk_ch_' + d.channel) : t('dk_m_' + (d.method || 'driver'))) +
            (when ? ' · <span dir="auto">' + when + '</span>' : '') + '</small></div>' +
        cardMoney(d) +
      '</div>' +
      '<div class="dlb-c-who">' + whoCell(d) + '</div>' +
      (place || addr
        ? '<div class="dlb-c-where">' + (place ? '<b>' + place + '</b>' : '') + (place && addr ? ' · ' : '') +
          (addr ? '<span>' + addr + '</span>' : '') + '</div>' : '') +
      '<div class="dlb-c-mid">' + carrierChip(d) + rail(d, false) + '</div>' +
      (d.pending > 0 ? '<div class="dlb-c-pend">' + svg(ICON.cash) + pendingLine(d) + '</div>' : '') +
      (d.status === 'failed' && d.failReason ? '<div class="dlb-c-why">' + svg(ICON.flag) + esc(d.failReason) + '</div>' : '') +
      '<div class="dlb-c-acts">' + rowActions(d) + '</div>' +
    '</article>';
  }

  function lanesView() {
    var today = F.status === 'open';
    var lanes = [
      { id: 'waiting', label: t('dl_waiting'), rows: [] },
      { id: 'out', label: t('dl_out'), rows: [] },
      { id: 'done', label: t(today ? 'dlp_done_today' : 'dlp_done'), rows: [] },
      { id: 'void', label: t('dk_cancelled'), rows: [] }
    ];
    rows.forEach(function (d) {
      var i = d.voided ? 3 : d.status === 'waiting' ? 0 : d.status === 'out' ? 1 : 2;
      lanes[i].rows.push(d);
    });
    /* The day's three lanes are always drawn, empty or not — an empty "On the
       road" is an answer. Under any other filter only the lanes with parcels
       in them are. */
    var shown = lanes.filter(function (l) { return l.rows.length || (today && l.id !== 'void'); });
    if (!shown.length) return emptyBoard();

    var h = '<div class="dlb-lanes n' + shown.length + '">';
    shown.forEach(function (l) {
      h += '<section class="dlb-lane is-' + l.id + '">' +
        '<header class="dlb-l-head"><i class="dlb-l-dot" aria-hidden="true"></i><h3>' + l.label + '</h3>' +
          '<span class="dlb-l-n">' + nf(l.rows.length) + '</span></header>' +
        '<div class="dlb-l-body">';
      if (!l.rows.length) {
        h += '<div class="dlb-l-empty">' + svg(ICON[l.id === 'done' ? 'check' : l.id]) +
          '<span>' + t('dlp_lane_empty_' + l.id) + '</span></div>';
      } else {
        l.rows.forEach(function (d) { h += laneCard(d); });
      }
      h += '</div></section>';
    });
    return h + '</div>';
  }

  /* ---- the table ---------------------------------------------------------- */

  function listView() {
    if (!rows.length) return emptyBoard();

    /* .dlb-tbl is what lets the stylesheet turn these rows into cards on a
       phone without touching every other table in the app. The six cells
       below are addressed by position there — invoice, customer, where,
       money, status, actions — so if a column is ever inserted, the rule in
       css/og-skin.css has to move with it. */
    var h = '<div class="card table-wrap"><table class="tbl dlb-tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('dl_where') + '</th><th class="num">' + t('dl_money') + '</th>' +
      '<th>' + t('status') + '</th><th></th>' +
    '</tr></thead><tbody>';

    rows.forEach(function (d) {
      var cls = d.voided ? 'dlb-void' : d.status === 'failed' ? 'row-late' : '';
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<td><b><bdi dir="ltr">' + esc(d.saleId) + '</bdi></b>' +
          (d.channel ? '<small style="display:block" class="muted">' + t('dk_ch_' + d.channel) + '</small>' : '') + '</td>' +
        '<td>' + whoCell(d) + (d.phone ? '<small style="display:block" class="muted">' + tel(d.phone) + '</small>' : '') + '</td>' +
        '<td class="muted">' + whereCell(d) + '</td>' +
        '<td class="num">' + moneyCell(d) + '</td>' +
        '<td>' + statusBadge(d) + rail(d, false) +
          (d.failReason ? '<small style="display:block" class="muted">' + esc(d.failReason) + '</small>' : '') + '</td>' +
        '<td class="dlb-actions">' + rowActions(d) + '</td></tr>';
    });

    return h + '</tbody></table></div>';
  }

  function emptyBoard() {
    var filtered = F.status !== 'open' || F.method || F.money || F.q;
    return '<div class="card dlb-empty"><div class="cart-empty">' +
      '<span class="dlb-empty-ico">' + svg(ICON.waiting) + '</span>' +
      '<b>' + t('dl_none_board') + '</b>' +
      (filtered ? t('dl_none_filter') : t('dl_none_board_sub')) +
      (filtered ? '<button class="btn btn-sm mt" data-act="dl-f-reset">' + t('dlp_clear') + '</button>' : '') +
      '</div></div>';
  }

  function boardView() {
    var h = '<div class="page-head"><div><h1>' + t('dl_title') + '</h1>' +
      '<div class="sub">' + t('dl_sub') + '</div></div>' +
      '<div class="head-actions">' +
        '<button class="btn btn-ghost btn-sm dlb-refresh" data-act="dl-reload" title="' + esc(t('dlp_refresh')) + '" ' +
          'aria-label="' + esc(t('dlp_refresh')) + '">' + svg(ICON.refresh) + '</button>' +
        ifNav('desk', '<button class="btn btn-primary btn-sm" data-act="nav" data-view="desk">+ ' + t('dk_new') + '</button>') +
      '</div></div>';

    h += tiles();
    h += tabBar();
    if (typeof Road !== 'undefined' && Road.tab() !== 'parcels') return h + Road.view();

    h += filterBar();
    h += layout === 'lanes' ? lanesView() : listView();
    return h + cappedNote(cap, t('nav_deliveries').toLowerCase());
  }

  /* The office's order alerts were a Web Push bell here. They are on the
     shop's Telegram bot now (server/lib/office-alerts.js, 052): a LAN-only
     shop cannot register a service worker on its self-signed certificate, so
     the bell could never have been offered anywhere but the till. Who hears
     what is Settings → Telegram → Order alerts. */

  /* -------------------------------------------------------------- the shell */

  function view() {
    if (failed) {
      return '<div class="page-head"><div><h1>' + t('dl_title') + '</h1></div></div>' +
        '<div class="card"><div class="cart-empty"><b>' + esc(failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="dl-reload">' + t('retry') + '</button></div></div>';
    }
    if (!loaded) {
      return '<div class="page-head"><div><h1>' + (isDriver() ? t('dl_my_runs') : t('dl_title')) + '</h1></div></div>' +
        '<div class="dlb-skel" aria-busy="true"><i></i><i></i><i></i><i></i></div>';
    }
    return isDriver() ? driverView() : boardView();
  }

  function after() {
    if (!Auth.can('delivery.read')) return;
    load();
    /* Whichever tab the board was left on fills itself in. */
    if (typeof Road !== 'undefined' && !isDriver()) Road.load();
    /* Who can be given a run. Only for the board, and only for an account
       that may assign one. */
    if (!isDriver() && !drivers.length && Auth.can('delivery.write')) {
      API.get('/api/orders/bootstrap').then(function (b) {
        drivers = b.drivers || [];
        cos = ((b.settings && b.settings.companies) || []).filter(function (c) { return c && c.active !== false; });
      }).catch(function () { /* the Assign dialog says so if the list is empty */ });
    }
  }

  /* The reader's own midnight, as an instant — see status=today on the
     server. A fresh Date, never the boot-frozen TODAY: the board stays open
     across midnight on the office screen. */
  function midnightIso() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function query() {
    var p = [];
    var st = F.status || 'open';
    /* The lanes and the driver's phone are about TODAY: what is still open,
       and what closed since midnight — so the third lane and the driver's
       "done" list have something in them. The table's "open" stays open. */
    if (st === 'open' && (isDriver() || layout === 'lanes')) {
      p.push('status=today', 'since=' + encodeURIComponent(midnightIso()));
    } else {
      p.push('status=' + encodeURIComponent(st));
    }
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
        summary = d.summary || null;
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
    /* Its own copy first: Desk.companies() is empty until the office screen
       has been opened, which on a board reached straight from the menu it
       never has — the same trap the handover picker fell into. */
    var desk = typeof Desk !== 'undefined' && Desk.companiesLoaded && Desk.companiesLoaded();
    var companies = desk ? Desk.companies() : cos;

    var body = '<div class="lbl">' + t('dl_pick_driver') + '</div>';
    body += drivers.length
      ? '<div class="dl-picks">' + drivers.map(function (u) {
          return '<button type="button" class="dl-pick' + (d.driverId === u.id ? ' on' : '') +
            '" data-act="dl-assign-pick" data-kind="driver" data-id="' + u.id + '">' +
            face(u.id, u.name) + '<b>' + nm(u.name) + '</b><small>' + t('dk_m_driver') + '</small></button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_drivers') + '</div>';

    body += '<div class="lbl mt">' + t('dl_pick_company') + '</div>';
    body += companies.length
      ? '<div class="dl-picks">' + companies.map(function (c) {
          return '<button type="button" class="dl-pick' + (d.companyId === c.id ? ' on' : '') +
            '" data-act="dl-assign-pick" data-kind="company" data-id="' + esc(c.id) + '">' +
            '<span class="dl-pick-ico">' + methodIcon(c.kind) + '</span>' +
            '<b>' + esc(OG.lang === 'ar' ? (c.ar || c.en) : (c.en || c.ar)) + '</b>' +
            '<small>' + t('dk_m_' + c.kind) + '</small></button>';
        }).join('') + '</div>'
      : '<div class="partner-note">' + t('dl_no_companies_yet') +
          (allow('config.write') ? ' <span class="clickable" data-act="dk-goto-companies">' +
            t('dk_add_in_settings') + '</span>' : '') + '</div>';

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
      body += '<div class="dl-hero"><span>' + t('dl_to_collect') + '</span><b>' + fmt(owed, d.currency) + '</b>' +
        '<small>' + nm(d.customerName || t('walk_in')) + ' · <bdi dir="ltr">' + esc(d.saleId) + '</bdi></small></div>' +
        '<div class="partner-note mt">' + esc(t('dl_collect_hint').replace('{a}', fmtText(owed, d.currency))) + '</div>' +
        '<label class="field mt"><span>' + t('dl_collected') + '</span>' +
          '<input class="inp num" id="dlGot" type="text" inputmode="decimal" dir="ltr" value="' +
          esc(typeof Desk !== 'undefined' ? Desk.plain(owed, d.currency) : String(owed)) + '"></label>';
      if (!isDriver() && d.method !== 'pickup') {
        body += '<label class="check"><input type="checkbox" id="dlInHand"><span>' + t('dl_in_my_hand') + '</span></label>';
      }
    } else {
      body += '<div class="dl-hero is-clear">' + svg(ICON.check) + '<b>' + t('dl_nothing_to_collect') + '</b>' +
        '<small>' + nm(d.customerName || t('walk_in')) + ' · <bdi dir="ltr">' + esc(d.saleId) + '</bdi></small></div>';
    }

    openModal({
      title: t('dl_done') + ' · ' + d.saleId, size: 'narrow', body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="dl-done-go" data-id="' + id + '">' + t('dl_done') + '</button>'
    });
  }

  /* The five things that actually happen at a door, one tap each — typed on a
     phone in the sun, "nobody home" is the sentence that gets skipped. The
     box stays editable: a chip is a start, not a category. */
  var WHY = ['nobody', 'phone', 'address', 'refused', 'later'];

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['dl-reload'] = function () { failed = null; loaded = false; repaint(); load(); };
    ACTIONS['dl-wa-track'] = function (el) {
      if (typeof Desk !== 'undefined' && Desk.sendTrack) Desk.sendTrack(el.getAttribute('data-id'));
    };

    /* A status tile narrows the parcels; "still owed" filters on money; the
       cash tile goes to where that cash is dealt with. Pressing a lit tile
       again puts the board back. */
    ACTIONS['dl-tile'] = function (el) {
      var id = el.getAttribute('data-id');
      if (id === 'cash') {
        if (typeof Road !== 'undefined') Road.setTab(Road.tab() === 'cash' ? 'parcels' : 'cash');
        return;
      }
      if (id === 'waiting' || id === 'out') F.status = F.status === id ? 'open' : id;
      else if (id === 'owed') F.money = F.money === 'owes' ? '' : 'owes';
      if (typeof Road !== 'undefined' && Road.tab() !== 'parcels') Road.setTab('parcels');
      load();
    };

    ACTIONS['dl-layout'] = function (el) {
      var next = el.getAttribute('data-id') === 'list' ? 'list' : 'lanes';
      if (next === layout) return;
      layout = next;
      try { localStorage.setItem(LAYOUT_KEY, layout); } catch (e) { /* private window */ }
      repaint();
      load();
    };

    ACTIONS['dl-f-reset'] = function () {
      F = { status: 'open', method: '', money: '', q: '' };
      load();
    };

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
      var d = byId(id);
      openModal({
        title: t('dl_fail') + (d ? ' · ' + d.saleId : ''), size: 'narrow',
        body: '<div class="dl-whys">' + WHY.map(function (k) {
                return '<button type="button" class="chip" data-act="dl-why-pick" data-id="' + k + '">' +
                  t('dlp_why_' + k) + '</button>';
              }).join('') + '</div>' +
              '<label class="field"><span>' + t('dl_why') + '</span>' +
              '<input class="inp" id="dlWhy" type="text" placeholder="' + esc(t('dl_why_ph')) + '"></label>',
        foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="dl-fail-go" data-id="' + id + '">' + t('dl_fail') + '</button>',
        onOpen: function (root) {
          var f = root.querySelector('#dlWhy');
          if (f) setTimeout(function () { f.focus(); }, 60);
        }
      });
    };

    ACTIONS['dl-why-pick'] = function (el) {
      var f = document.getElementById('dlWhy');
      if (!f) return;
      f.value = t('dlp_why_' + el.getAttribute('data-id'));
      Array.prototype.forEach.call(document.querySelectorAll('.dl-whys .chip'), function (c) {
        c.classList.toggle('on', c === el);
      });
      f.focus();
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

    /* The row's "…" (ns02). One menu open at a time, toggled by a class on
       markup that is already in the row — the board repaints on every live
       push, and a popover built on click would be rebuilt out from under an
       open one. Closing on an outside press is bound once, at the document,
       in the capture phase, so it runs before the delegated dispatcher
       decides what the press meant. */
    ACTIONS['dl-menu'] = function (el) {
      var mine = el.parentNode.querySelector('.dlb-menu');
      var wasOpen = mine && mine.classList.contains('on');
      closeRowMenus();
      if (mine && !wasOpen) mine.classList.add('on');
    };
    if (!register._menus) {
      register._menus = true;
      document.addEventListener('click', function (e) {
        var inside = e.target.closest && e.target.closest('.dlb-more');
        if (!inside) closeRowMenus();
        /* A press on an item inside the menu runs its own action through the
           ordinary dispatcher; the menu closes either way. */
        else if (e.target.closest('.dlb-mi')) setTimeout(closeRowMenus, 0);
      }, true);
    }

    if (typeof CHANGES === 'undefined') return;
    CHANGES['dl-q'] = function (el) {
      F.q = el.value;
      clearTimeout(CHANGES._dlTimer);
      CHANGES._dlTimer = setTimeout(function () {
        load().then(function () { focusBack('[data-change="dl-q"]', String(F.q).length); });
      }, 350);
    };
    CHANGES['dl-f-status'] = function (el) { F.status = el.value || 'open'; load(); };
    CHANGES['dl-f-method'] = function (el) { F.method = el.value || ''; load(); };
    CHANGES['dl-f-money'] = function (el) { F.money = el.value || ''; load(); };
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
