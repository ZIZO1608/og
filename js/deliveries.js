/* ==========================================================================
   OG SYSTEM — deliveries
   --------------------------------------------------------------------------
   Two screens out of one module, because they are the same list read by two
   people with opposite questions:

     the driver   "what am I taking out, where is it, and how much do I
                   collect?" — one card per run, big targets, phone first. He
                   is standing on a scooter in the sun, not at a desk.

     the manager  "what is out, with whom, and what has not come back?" — a
                   table, sortable by nothing, because the interesting rows
                   sort themselves to the top by status.

   Which one you get is decided by your role, on the server, in the query. The
   driver's list is filtered by driver_id before it leaves the database — this
   file never asks for "everyone's" and then hides some.

   THIS IS THE ONE SCREEN THAT NEEDS A SERVER. Everything else in the app can
   fall back to seeded demo data; a delivery round cannot be invented, and
   pretending otherwise would have a driver ticking off parcels that do not
   exist. In demo mode it says so plainly instead.
   ========================================================================== */

var Deliveries = (function () {

  var rows = [];          /* what the server last told us */
  var cap = { shown: 0, total: 0, capped: false };
  var day = null;         /* his own totals for today, drivers only */
  var loaded = false;     /* have we asked yet */
  var failed = null;      /* the last error, so the screen can say why */

  function isDriver() { return roleOf() === 'delivery'; }

  /* ------------------------------------------------------------------ money */

  /* to_collect comes back in the sale's own minor units. SYP has none, so it
     is already whole lira; USD is in cents. money() upstream expects lira, so
     anything with minor units has to come out of them first. */
  function amount(d) {
    var v = Number(d.toCollect) || 0;
    return d.currency === 'USD' ? money(v / 100 * CONFIG.EXCHANGE_RATE) : money(v);
  }

  /* ------------------------------------------------------------------ links */

  /* tel: works on every phone. A driver tapping a number should be calling,
     not selecting text to copy into the dialler. */
  function callLink(phone, label) {
    if (!phone) return '';
    return '<a class="btn btn-sm" href="tel:' + esc(String(phone).replace(/[^\d+]/g, '')) + '">' +
           label + '</a>';
  }

  /* A plain maps query rather than coordinates: nobody in Aleppo is typing a
     latitude, and the addresses in this shop are written the way people give
     directions — "near the bakery" gets a driver closer than a pin dropped on
     a street the map does not know. */
  function mapLink(address, label) {
    if (!address) return '';
    return '<a class="btn btn-sm" target="_blank" rel="noopener" ' +
           'href="https://www.google.com/maps/search/?api=1&query=' +
           encodeURIComponent(address) + '">' + label + '</a>';
  }

  /* ----------------------------------------------------------------- status */

  var TONE = {
    waiting:   'neutral',
    out:       'accent',
    delivered: 'healthy',
    failed:    'critical'
  };

  function statusBadge(s) {
    return '<span class="badge ' + (TONE[s] || 'neutral') + '">' +
           t('dl_' + s) + '</span>';
  }

  /* Who this parcel is for — and whether a parcel to them has come back
     before.

     DERIVED from deliveries.status, every time, and never written down. "This
     customer has failed deliveries" is a judgement about a person, and a
     stored flag is one that outlives its reason: a wrong address fixed in
     March would still be marking somebody in December. Counted from the board
     the shop is already looking at, it corrects itself the moment a delivery
     succeeds.

     Shown to whoever can see the board; a driver gets no link, because the
     customers screen is not his (navAllowed, js/app-shell.js). */
  function whoCell(d) {
    var name = nm(d.customerName || t('walk_in'));
    var cust = d.customerId ? DB.customer(d.customerId) : null;
    var link = (cust && typeof allow === 'function' && allow('customer.read') && !isDriver())
      ? '<span class="clickable" data-act="cu-open" data-id="' + cust.id + '">' + name + ' ›</span>'
      : name;

    /* Other parcels to the same customer that came back — counted across
       the board this browser HOLDS, which is a window (cap). A failure older
       than that window reads as a clean record, so the board says underneath
       what it counted over. */
    var failed = 0;
    if (d.customerId) {
      rows.forEach(function (x) {
        if (x.customerId === d.customerId && x.id !== d.id && x.status === 'failed') failed++;
      });
    }
    return link + (failed
      ? '<small style="display:block" class="muted">' +
          t('dl_failed_before').replace('{n}', nf(failed)) + '</small>'
      : '');
  }

  /* ------------------------------------------------------------- the driver */

  function runCard(d) {
    var done = d.status === 'delivered' || d.status === 'failed';

    var h = '<div class="run-card' + (done ? ' is-done' : '') +
            (d.status === 'out' ? ' is-out' : '') + '">';

    h += '<div class="rc-top">' +
      '<div class="rc-who"><b>' + esc(d.customerName || t('walk_in')) + '</b>' +
        '<small>' + esc(d.saleId) + '</small></div>' +
      statusBadge(d.status) +
    '</div>';

    h += '<div class="rc-addr">' + esc(d.address) + '</div>';

    /* What is in the bag, so he can check it at the door without ringing the
       shop. No prices per line — the only figure he needs is the total. */
    if (d.items && d.items.length) {
      h += '<div class="rc-items">';
      d.items.forEach(function (it) {
        h += '<span class="rc-item">' + esc(it.name) +
             (it.size ? ' · ' + esc(it.size) : '') +
             ' <b>×' + it.qty + '</b></span>';
      });
      h += '</div>';
    }

    h += '<div class="rc-money">' +
      (d.toCollect > 0
        ? '<span class="rc-collect"><i>' + t('dl_to_collect') + '</i><b>' + amount(d) + '</b></span>'
        : '<span class="rc-paid">' + t('dl_nothing_owed') + '</span>') +
    '</div>';

    /* -- what he can do about it right now -- */
    h += '<div class="rc-acts">' +
      callLink(d.phone, t('dl_call')) +
      mapLink(d.address, t('dl_map'));

    if (d.status === 'waiting') {
      h += '<button class="btn btn-sm btn-primary" data-act="dl-go" data-id="' + d.id + '">' +
           t('dl_take') + '</button>';
    } else if (d.status === 'out') {
      h += '<button class="btn btn-sm btn-primary" data-act="dl-done" data-id="' + d.id + '">' +
             t('dl_done') + '</button>' +
           '<button class="btn btn-sm" data-act="dl-fail" data-id="' + d.id + '">' +
             t('dl_fail') + '</button>';
    } else if (d.status === 'failed' && d.failReason) {
      h += '<span class="rc-reason">' + esc(d.failReason) + '</span>';
    }

    h += '</div></div>';
    return h;
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
        /* What is in his pocket and not yet in the drawer — the figure the
           end-of-day settle-up is about, on the screen he actually reads. */
        '<div class="stat"><span class="eyebrow">' + t('dl_to_hand_in') + '</span>' +
          '<div class="val' + (day.collected > 0 ? ' warn' : '') + '">' + money(Math.max(0, day.collected)) + '</div>' +
          '<div class="foot">' + nf(day.delivered) + ' ' + t('dl_delivered').toLowerCase() +
            (day.failed ? ' · ' + nf(day.failed) + ' ' + t('dl_failed').toLowerCase() : '') + '</div></div>' +
      '</div>';
    }

    h += '<div class="run-list mt">';
    if (!open.length) {
      h += '<div class="card"><div class="cart-empty"><b>' + t('dl_none') + '</b>' +
           t('dl_none_sub') + '</div></div>';
    } else {
      open.forEach(function (d) { h += runCard(d); });
    }
    h += '</div>';

    /* Finished runs stay on the screen, greyed. He needs to be able to check
       that he did mark the one at number 12, without navigating anywhere. */
    if (shut.length) {
      h += '<div class="run-list run-done mt">';
      shut.forEach(function (d) { h += runCard(d); });
      h += '</div>';
    }

    return h;
  }

  /* ------------------------------------------------------------ the manager */

  function boardView() {
    var h = '<div class="page-head"><div><h1>' + t('dl_title') + '</h1>' +
      '<div class="sub">' + t('dl_sub') + '</div></div>' +
      '<div class="head-actions">' +
        '<span class="badge accent">' +
          rows.filter(function (d) { return d.status === 'out'; }).length + ' ' +
          t('dl_out').toLowerCase() + '</span>' +
      '</div></div>';

    if (!rows.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('dl_none_board') + '</b>' +
             t('dl_none_board_sub') + '</div></div>';
    }

    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('dl_address') + '</th><th>' + t('dl_driver') + '</th>' +
      '<th class="num">' + t('dl_to_collect') + '</th><th>' + t('status') + '</th>' +
    '</tr></thead><tbody>';

    rows.forEach(function (d) {
      h += '<tr' + (d.status === 'failed' ? ' class="row-late"' : '') + '>' +
        '<td><b>' + esc(d.saleId) + '</b></td>' +
        '<td>' + whoCell(d) + '</td>' +
        '<td class="muted">' + esc(d.address) +
          (d.phone ? '<small style="display:block">' + tel(d.phone) + '</small>' : '') + '</td>' +
        '<td>' + (d.driverName ? esc(d.driverName) : '<span class="muted">' + t('dl_unassigned') + '</span>') + '</td>' +
        '<td class="num">' + (d.toCollect > 0
          ? '<b>' + amount(d) + '</b>' +
            (d.status === 'delivered'
              ? '<small style="display:block" class="muted">' + t('dl_collected') + '</small>' : '')
          : '<span class="muted">—</span>') + '</td>' +
        '<td>' + statusBadge(d.status) +
          (d.failReason ? '<small style="display:block" class="muted">' + esc(d.failReason) + '</small>' : '') +
        '</td></tr>';
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

  /* Fetch, then repaint. Called by the AFTER hook every time the screen is
     entered, so a driver pulling the app out of his pocket sees the round as
     it is now rather than as it was when he last looked. */
  function after() {
    /* Don't ask for a board this account cannot read. The server answers 403
       correctly, but the browser logs every refusal as a failed request, and
       a console full of expected failures is a console nobody reads. */
    if (typeof Auth !== 'undefined' && !Auth.can('delivery.read')) return;
    load();
  }

  function load() {
    return API.get('/api/deliveries')
      .then(function (d) {
        rows = d.deliveries || [];
        /* whoCell counts a customer's FAILED deliveries across , so a
           failure older than this window reads as a clean record. Recorded so
           the board can say the count is of what it can see. */
        cap = { shown: rows.length, total: d.deliveriesTotal || rows.length,
                capped: !!d.deliveriesCapped };
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
    if (host) host.innerHTML = view();
  }

  /* ------------------------------------------------------------- the actions
     Registered here rather than in app.js ACTIONS so everything this screen
     does lives in one file. app.js exposes the table; this fills in its part
     of it at load time. */

  /* api.js exposes get/post/put/del but not patch, and adding a verb there for
     one caller is more surface than this needs. Same options, same cookie
     handling, same error shape — API.friendly() still reads it. */
  function fetchPatch(id, body) {
    return fetch('/api/deliveries/' + id, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* not json */ }
        if (res.ok) return data;
        var e = new Error((data && data.error) || ('HTTP ' + res.status));
        e.code = (data && data.code) || 'server_error';
        throw e;
      });
    });
  }

  function move(id, body) {
    return fetchPatch(id, body)
      .then(function () {
        toast(t('dl_title'), t('dl_marked'), 'ok');
        return load();
      })
      .catch(function (err) {
        toast(t('dl_title'), err.message || API.friendly(err), 'err', 5000);
      });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['dl-reload'] = function () { failed = null; loaded = false; repaint(); load(); };
    ACTIONS['dl-go']     = function (el) { move(+el.getAttribute('data-id'), { status: 'out' }); };
    ACTIONS['dl-done']   = function (el) { move(+el.getAttribute('data-id'), { status: 'delivered' }); };

    /* A failure needs a reason typed by the person who was there. Without one
       the manager gets a red row and no idea whether to send it again. */
    ACTIONS['dl-fail'] = function (el) {
      var id = +el.getAttribute('data-id');
      openModal({
        title: t('dl_fail'),
        body: '<label class="field"><span>' + t('dl_why') + '</span>' +
              '<input class="inp" id="dlWhy" type="text" placeholder="' + esc(t('dl_why_ph')) + '"></label>',
        foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="dl-fail-go" data-id="' + id + '">' +
                t('dl_fail') + '</button>',
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
  }

  return {
    view: view,
    after: after,
    load: load,
    register: register,
    /* So the till can send a sale out the moment it is rung up. */
    assign: function (body) { return API.post('/api/deliveries', body); }
  };
})();
