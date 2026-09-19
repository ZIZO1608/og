/* ==========================================================================
   THE CASH BOOK — where every lira and dollar is, right now        [data-cb]
   --------------------------------------------------------------------------
   Two tabs of the Money screen (js/money.js draws the bar) and the dialogs
   behind them. The rules live on the server (server/lib/cashbook.js); this
   file draws what it says and sends what somebody typed.

   A PLACE is where money physically is: the drawer, the owner's own pocket,
   each transfer office and wallet, a driver who has not handed in. A balance
   is the sum of that place's moves in ONE currency. Lira and dollars are
   drawn side by side and never added together — a place holding 400,000
   lira and $60 is holding two things.

   Nothing here writes optimistically. Money is the one place where a figure
   that looks recorded and is not is worse than one that takes a moment, so
   every write goes through Shop.write and the screen redraws from what the
   server then says.
   ========================================================================== */

var Cashbook = (function () {

  /* The Book tab's filters, and the rows they fetched. `data` is null while
     no filter is set — the bundle's own latest page is used then. */
  var B = { place: '', kind: '', from: '', to: '', data: null, busy: false };

  /* The Settings card's working copy of the owner's own places. */
  var P = null;

  var KINDS = ['sale', 'sale_void', 'debt_in', 'order_in', 'order_refund', 'expense',
               'expense_void', 'supplier_pay', 'salary', 'partner_pay', 'owner_draw',
               'owner_in', 'transfer', 'exchange', 'fee', 'count_diff', 'opening'];

  /* ------------------------------------------------------------ reading */

  function snap() { return DB.cash || null; }

  function base() { return (typeof CONFIG !== 'undefined' && CONFIG.BASE_CURRENCY) || 'SYP'; }

  function currencies() {
    var c = snap();
    var list = c && c.currencies && c.currencies.length
      ? c.currencies.map(function (x) { return x.code; }) : ['SYP', 'USD'];
    /* The shop's own currency first — it is what nearly everything is in. */
    list.sort(function (a, b) { return (a === base() ? -1 : 0) - (b === base() ? -1 : 0); });
    return list;
  }

  function places() { var c = snap(); return c ? c.places : []; }

  function findPlace(id) {
    return places().filter(function (p) { return p.id === id; })[0] || null;
  }

  function placeName(id) {
    if (!id) return '—';
    if (id === 'drawer') return t('cb_p_drawer');
    if (id === 'owner') return t('cb_p_owner');
    var p = findPlace(id);
    if (p) return (OG.lang === 'ar' ? p.ar : p.en) || id;
    if (id.indexOf('m:') === 0) return DB.payLabel(id.slice(2));
    if (id.indexOf('x:') === 0) return id.slice(2);
    if (id.indexOf('driver:') === 0) return t('cb_p_driver');
    return id;
  }

  /* Where money can be sent, or taken from, in a dialog: everything that is
     switched on, plus — when asked — a switched-off place still holding
     money, so it can be emptied. Drivers are not offered: their money moves
     by the hand-in on the deliveries board, which knows which parcel it is. */
  function pickable(opts) {
    opts = opts || {};
    return places().filter(function (p) {
      if (p.kind === 'driver' || p.kind === 'unknown') return false;
      if (p.active !== false) return true;
      if (!opts.emptying) return false;
      return Object.keys(p.balances || {}).some(function (k) { return p.balances[k] !== 0; });
    });
  }

  function fmt(minor, cur) {
    if (typeof Desk !== 'undefined' && Desk.fmt) return Desk.fmt(minor, cur);
    return '<bdi dir="ltr">' + esc(nf(minor) + ' ' + cur) + '</bdi>';
  }

  /* The sign INSIDE the same isolate as the figure. Two isolates side by side
     are reordered by an Arabic line, and "−$81.50" was drawn "$81.50−". */
  function signed(minor, cur) {
    var n = Number(minor) || 0;
    return '<bdi dir="ltr">' + (n > 0 ? '+' : n < 0 ? '−' : '') + esc(text(Math.abs(n), cur)) + '</bdi>';
  }

  function text(minor, cur) {
    return (typeof Desk !== 'undefined' && Desk.moneyText) ? Desk.moneyText(minor, cur) : nf(minor) + ' ' + cur;
  }

  function toMinor(v, cur) {
    if (typeof Desk !== 'undefined' && Desk.toMinor) return Desk.toMinor(v, cur);
    var n = Math.round(Number(String(v || '').replace(/[^\d.]/g, '')) * (cur === 'USD' ? 100 : 1));
    return n > 0 ? n : 0;
  }

  function newOp(tag) {
    return 'cb-' + tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  var ICONS = {
    drawer: 'M3 8h18v11H3zM3 8l2-4h14l2 4M9 13h6',
    owner: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a7 7 0 0 1 14 0v1',
    wallet: 'M3 7h16v12H3zM3 7l12-3v3M15 13h3',
    extra: 'M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 12h4',
    driver: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
    unknown: 'M12 17h.01M9.1 9a3 3 0 1 1 3.9 2.8c-.6.3-1 .8-1 1.5V14'
  };

  function icon(kind) {
    return '<svg viewBox="0 0 24 24" stroke-linecap="square" aria-hidden="true"><path d="' +
      (ICONS[kind] || ICONS.unknown) + '"/></svg>';
  }

  /* ------------------------------------------------------------ the Now tab */

  /* Which place's figure just moved, read once per paint of this tab. */
  var flashed = null;

  /* ------------------------------------------------------------ TODAY
     FIX 05 — FIVE TO TEN PLAIN SENTENCES, and nothing to read sideways.

     "What happened today" was answerable only by opening Money history and
     reading a six-column table of kinds, references and signed minor units —
     which is the right screen for an argument about a figure and the wrong
     one for the question somebody actually walks over to ask. These are the
     same rows, said: "450,000 SYP came into the drawer from a sale", "$60
     went from the drawer to Sham Cash".

     It is deliberately the LATEST TEN, said so on its face, with the whole
     book one press away. A list that claims to be the day and is not is the
     mistake this codebase has made most often. */
  var TODAY_MAX = 10;

  function startOfToday() {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  function todayRows() {
    var page = DB.cashBook;
    if (!page || !page.rows) return null;
    var from = startOfToday();
    return page.rows.filter(function (m) {
      var at = Date.parse(m.at);
      return at === at && at >= from;
    });
  }

  /* One row, as a sentence. The money keeps its own currency and its own
     isolate; the rest is words. */
  function todayLine(m) {
    var amt = '<bdi dir="ltr">' + esc(text(Math.abs(m.amount), m.currency)) + '</bdi>';
    var place = esc(placeName(m.place));
    var what = t('cb_k_' + m.kind);
    var other = m.other_place ? esc(placeName(m.other_place)) : '';
    var key = m.amount >= 0 ? 'cb_t_in' : 'cb_t_out';
    var line = t(key).replace('{a}', amt).replace('{p}', place).replace('{w}', esc(what));
    if (other) line += ' · ' + other;
    return '<li class="cb-t-line"><span class="cb-t-dot' + (m.amount >= 0 ? ' up' : ' down') +
      '" aria-hidden="true"></span><span>' + line + '</span>' +
      '<small class="muted">' + esc(fmtTimeOnly(m.at)) + '</small></li>';
  }

  function todayCard() {
    var rows = todayRows();
    if (rows === null) return '';
    var shown = rows.slice(0, TODAY_MAX);
    var h = '<div class="card cb-today mb"><div class="card-head"><h3>' + t('cb_today') + '</h3>' +
      '<div class="card-actions"><button class="btn btn-sm btn-ghost" data-mn="tab" data-t="book">' +
        t('cb_today_more') + '</button></div></div><div class="card-body">';
    if (!shown.length) {
      h += '<div class="muted">' + t('cb_today_none') + '</div>';
    } else {
      h += '<ul class="cb-t-list">' + shown.map(todayLine).join('') + '</ul>';
      if (rows.length > shown.length) {
        h += '<div class="muted small cb-t-cap">' +
          t('cb_today_cap').replace('{n}', '<bdi dir="ltr">' + nf(shown.length) + '</bdi>')
            .replace('{t}', '<bdi dir="ltr">' + nf(rows.length) + '</bdi>') + '</div>';
      }
    }
    return h + '</div></div>';
  }

  function nowTab() {
    flashed = takeFlash();
    var c = snap();
    if (!c) {
      return '<div class="card"><div class="cart-empty"><b>' + t('cb_unavailable') + '</b>' +
        t('cb_unavailable_sub') + '</div></div>';
    }
    var can = allow('money.move');
    var h = '';

    /* The whole shop, one figure per currency. */
    var curs = currencies();
    h += '<div class="grid stat-row mb cb-totals" style="grid-template-columns:repeat(' + curs.length + ',minmax(0,1fr))">';
    curs.forEach(function (cur) {
      var v = (c.totals || {})[cur] || 0;
      var where = c.places.filter(function (p) { return (p.balances || {})[cur]; }).length;
      h += '<div class="stat"><span class="eyebrow">' + t('cb_all_money') + ' · ' + esc(cur) + '</span>' +
        '<div class="val' + (v < 0 ? ' warn' : '') + '">' + signedPlain(v, cur) + '</div>' +
        '<div class="foot">' + t('cb_in_places').replace('{n}', nf(where)) + '</div></div>';
    });
    h += '</div>';

    if (!c.started) {
      h += '<div class="card mb cb-start"><div class="card-body">' +
        '<h3>' + t('cb_start_title') + '</h3>' +
        '<p class="muted">' + t('cb_start_sub') + '</p>' +
        (can ? '<button class="btn btn-primary" data-cb="start">' + t('cb_start_btn') + '</button>'
             : '<p class="muted small">' + t('cb_start_manager') + '</p>') +
        '</div></div>';
    }

    /* THE JOBS, NOT JUST THE CASH-BOOK ONES (ns02). This row held the three
       moves between places and nothing else, so "record an expense", "pay a
       supplier", "pay somebody's wages" and "close the day" — the four things
       this screen is actually opened for — each meant finding the right tab
       first. They are buttons here now; each one lands on its own tab, and
       the expense opens its dialog on the way, because there is nothing to
       read on that tab first.

       Every one is gated exactly as its tab is. A button that navigates to a
       screen the server would refuse is worse than no button. */
    /* FIX 05 — THE JOBS ARE TILES, THE SAME TILES AS THE JOB HOME.
       They were two rows of small buttons, one row above the other, one
       styled `btn-primary` and the rest not — seven things of three
       different weights over the figures they act on. The shop's people meet
       the job home first, every morning; this screen answers the same
       question and should be the same shape. One grid, one size, one lime
       primary, each with the icon its job carries there. */
    var tiles = [];
    if (can) {
      tiles.push({ act: 'move', key: 'cb_move', primary: true,
        icon: 'M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4' });
      tiles.push({ act: 'exchange', key: 'cb_exchange',
        icon: 'M7 8h11l-3-3M17 16H6l3 3' });
      tiles.push({ act: 'owner', key: 'cb_owner_btn',
        icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a7 7 0 0 1 14 0v1' });
    }
    if (allow('money.write')) {
      tiles.push({ act: 'go-expense', key: 'cb_go_expense', icon: 'M12 5v14M5 12h14' });
    }
    if (allow('money.read')) {
      tiles.push({ act: 'go-suppliers', key: 'cb_go_suppliers',
        icon: 'M3 7h18v4H3zM5 11v9h14v-9M9 15h6' });
    }
    if (allow('staff.read')) {
      tiles.push({ act: 'go-salaries', key: 'cb_go_salaries',
        icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' });
    }
    if (allow('money.count') || allow('money.move')) {
      tiles.push({ act: 'go-close', key: 'dc_tab', icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3' });
    }
    if (c.started && can) {
      tiles.push({ act: 'start', key: 'cb_start_more', icon: 'M12 5v14M5 12h14' });
    }
    if (tiles.length) {
      h += '<div class="hm-grid cb-jobs" data-n="' + Math.min(tiles.length, 6) + '">' +
        tiles.map(function (j) {
          return '<button class="hm-job' + (j.primary ? ' is-primary' : '') +
            '" type="button" data-cb="' + j.act + '">' +
            '<span class="hm-ico"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
              '<path d="' + j.icon + '"/></svg></span>' +
            '<span class="hm-t">' + t(j.key) + '</span></button>';
        }).join('') + '</div>';
    }

    h += todayCard();

    var groups = [
      { key: 'cb_g_cash', kinds: ['drawer', 'owner', 'extra'] },
      { key: 'cb_g_wallets', kinds: ['wallet'] },
      { key: 'cb_g_drivers', kinds: ['driver'] },
      { key: 'cb_g_other', kinds: ['unknown'] }
    ];
    groups.forEach(function (g) {
      var list = c.places.filter(function (p) {
        if (g.kinds.indexOf(p.kind) < 0) return false;
        if (p.active !== false) return true;
        /* Switched off and holding nothing is nothing to look at. */
        return Object.keys(p.balances || {}).some(function (k) { return p.balances[k] !== 0; });
      });
      if (!list.length) return;
      h += '<div class="cb-group"><div class="set-sec">' + t(g.key) + '</div><div class="cb-grid">' +
        list.map(function (p) { return placeCard(p, can, c.started); }).join('') + '</div></div>';
    });

    h += '<p class="muted small mt">' + t('cb_never_added') + '</p>';
    return h;
  }

  function signedPlain(v, cur) {
    return '<bdi dir="ltr">' + (v < 0 ? '−' : '') + esc(text(Math.abs(v), cur)) + '</bdi>';
  }

  function placeCard(p, can, started) {
    var bal = p.balances || {};
    var curs = currencies().filter(function (cur, i) { return i === 0 || bal[cur]; });
    var neg = curs.some(function (cur) { return (bal[cur] || 0) < 0; });
    var chips = '';
    if (p.active === false) chips += '<span class="badge neutral">' + t('cb_off') + '</span>';
    if (started && !p.opened && p.kind !== 'driver' && p.kind !== 'unknown') {
      chips += '<span class="badge neutral">' + t('cb_not_started') + '</span>';
    }

    /* The chips sit UNDER the name, never beside it: beside it they took the
       width and a name like "Safe" was drawn one letter per line. */
    /* FIX 05 — THE CARD THAT CHANGED SAYS SO. A transfer landed, the screen
       redrew, and the only difference anywhere was one number among a dozen
       — so the toast was the whole of the feedback and the place it happened
       to had to be found by eye. `lit` is spent once, by the redraw that
       follows the save. */
    var h = '<div class="cb-place' + (neg ? ' neg' : '') + (p.active === false ? ' off' : '') +
      (p.id === flashed ? ' lit' : '') +
      '" data-place="' + esc(p.id) + '">' +
      '<div class="cb-ph"><span class="cb-ic">' + icon(p.kind) + '</span>' +
        '<div class="cb-nm"><b>' + esc(placeName(p.id)) + '</b><small>' + t('cb_kind_' + p.kind) + '</small>' +
        (chips ? '<div class="cb-chips">' + chips + '</div>' : '') + '</div></div>' +
      /* The figure carries its own currency, so no second label beside it. */
      '<div class="cb-bal">' +
        curs.map(function (cur) {
          var v = bal[cur] || 0;
          return '<div class="cb-line' + (v < 0 ? ' neg' : '') + '"><b>' + signedPlain(v, cur) + '</b></div>';
        }).join('') +
      '</div>';

    if (neg) h += '<div class="cb-warn">' + t('cb_neg_note') + '</div>';

    h += '<div class="cb-foot"><small class="muted">' +
      (p.lastCheck ? t('cb_checked') + ' ' + esc(relDate(p.lastCheck)) : t('cb_never_checked')) +
      '</small>';
    if (can && p.kind !== 'driver' && p.kind !== 'unknown') {
      h += '<span class="cb-btns">' +
        '<button class="btn btn-sm btn-ghost" data-cb="check" data-place="' + esc(p.id) + '">' + t('cb_check') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-cb="move" data-place="' + esc(p.id) + '">' + t('cb_move_short') + '</button>' +
        '</span>';
    }
    return h + '</div></div>';
  }

  /* ----------------------------------------------------------- the Book tab */

  function filtered() { return !!(B.place || B.kind || B.from || B.to); }

  function bookTab() {
    var h = '<div class="card mb"><div class="card-body cb-filters">' +
      '<label class="field"><span>' + t('cb_f_place') + '</span><select class="inp" data-cbc="f" data-k="place">' +
        '<option value="">' + t('cb_f_all') + '</option>' +
        places().map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (B.place === p.id ? ' selected' : '') + '>' +
            esc(placeName(p.id)) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>' + t('cb_f_kind') + '</span><select class="inp" data-cbc="f" data-k="kind">' +
        '<option value="">' + t('cb_f_all') + '</option>' +
        KINDS.map(function (k) {
          return '<option value="' + k + '"' + (B.kind === k ? ' selected' : '') + '>' + esc(t('cb_k_' + k)) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>' + t('cb_f_from') + '</span><input class="inp" type="date" dir="ltr" data-cbc="f" data-k="from" value="' + esc(B.from) + '"></label>' +
      '<label class="field"><span>' + t('cb_f_to') + '</span><input class="inp" type="date" dir="ltr" data-cbc="f" data-k="to" value="' + esc(B.to) + '"></label>' +
      (filtered() ? '<button class="btn btn-ghost btn-sm" data-cb="f-clear">' + t('cb_f_clear') + '</button>' : '') +
      '</div></div>';

    if (filtered() && !B.data && !B.busy) setTimeout(loadBook, 0);
    return h + '<div id="cbBook">' + bookBody() + '</div>';
  }

  function bookBody() {
    var page = filtered() ? B.data : DB.cashBook;
    if (!page) {
      return '<div class="card"><div class="cart-empty"><b>' +
        (B.busy || filtered() ? t('cb_loading') : t('cb_unavailable')) + '</b></div></div>';
    }
    if (!page.rows.length) {
      return '<div class="card"><div class="cart-empty"><b>' + t('cb_book_empty') + '</b>' +
        t('cb_book_empty_sub') + '</div></div>';
    }
    var h = '<div class="card table-wrap"><table class="tbl cb-book"><thead><tr>' +
      '<th>' + t('date') + '</th><th>' + t('cb_col_place') + '</th><th>' + t('cb_col_what') + '</th>' +
      '<th>' + t('cb_col_ref') + '</th><th class="num">' + t('mn_amount') + '</th><th>' + t('cb_col_who') + '</th>' +
      '</tr></thead><tbody>';
    page.rows.forEach(function (m) {
      h += '<tr>' +
        '<td class="num muted">' + esc(fmtDate(m.at)) + '<small class="muted" style="display:block">' +
          esc(fmtTimeOnly(m.at)) + '</small></td>' +
        '<td><b>' + esc(placeName(m.place)) + '</b></td>' +
        '<td>' + esc(t('cb_k_' + m.kind)) + otherSide(m) +
          (m.note && !refIsNote(m) ? '<small class="muted" style="display:block">' + esc(m.note) + '</small>' : '') + '</td>' +
        '<td class="muted">' + esc(refText(m)) + '</td>' +
        '<td class="num"><b class="cb-amt ' + (m.amount > 0 ? 'up' : m.amount < 0 ? 'down' : '') + '">' +
          signed(m.amount, m.currency) + '</b></td>' +
        '<td class="muted">' + esc(m.user_name || '') + '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
    return h + cappedNote(page, t('cb_moves'));
  }

  function otherSide(m) {
    if (!m.other_place) return '';
    if (m.kind === 'exchange') {
      return ' <small class="muted cb-other">' + (m.amount < 0 ? '→ ' : '← ') +
        fmt(Math.abs(m.other_amount || 0), m.other_currency) + '</small>';
    }
    return ' <small class="muted cb-other">' + (m.amount < 0 ? t('cb_to') : t('cb_from_w')) + ' ' +
      esc(placeName(m.other_place)) + '</small>';
  }

  /* The note IS the reference for the rows whose reference is an internal
     payment id — the invoice number is what somebody recognises. */
  function refIsNote(m) {
    return m.ref_type === 'order_payment' || m.ref_type === 'debt_payment' ||
           m.ref_type === 'partner_payment' || m.ref_type === 'expense' ||
           m.ref_type === 'supplier_payment' || m.ref_type === 'salary_payment';
  }

  function refText(m) {
    if (m.ref_type === 'sale') return m.ref_id || '';
    if (m.ref_type === 'expense') return (m.ref_id || '') + (m.note ? ' · ' + catLabel(m.note) : '');
    if (refIsNote(m)) return m.note || '';
    return '';
  }

  function catLabel(c) {
    var k = 'mn_c_' + c;
    return (I18N.en[k] !== undefined || I18N.ar[k] !== undefined) ? t(k) : String(c || '');
  }

  function loadBook() {
    if (typeof Shop === 'undefined' || !Shop.cashBook) return;
    if (!filtered()) { B.data = null; paintBook(); return; }
    B.busy = true;
    var q = { place: B.place, kind: B.kind, limit: 300 };
    /* The date boxes are LOCAL days; the book is UTC. */
    if (B.from) q.from = ymdStart(B.from).toISOString();
    if (B.to) { var e = ymdStart(B.to); e.setDate(e.getDate() + 1); q.to = e.toISOString(); }
    var want = JSON.stringify([B.place, B.kind, B.from, B.to]);
    Shop.cashBook(q).then(function (page) {
      if (want !== JSON.stringify([B.place, B.kind, B.from, B.to])) return;
      B.data = page;
      B.busy = false;
      paintBook();
    }).catch(function (err) {
      B.busy = false;
      toast(t('cb_book'), API.friendly(err), 'err', 5000);
    });
  }

  function ymdStart(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /* One panel repainted — the filters above keep their focus and caret. */
  function paintBook() {
    var host = document.getElementById('cbBook');
    if (!host) return;
    host.innerHTML = bookBody();
    /* render() gives wide tables their phone cards; a panel painted on its
       own has to ask for them, or at 390 the table is cut off at the edge. */
    if (typeof labelWideTables === 'function') labelWideTables(host);
  }

  /* ------------------------------------------------------------ the dialogs */

  /* A change hook may name ANOTHER module's namespace: 'py:pay-hint' writes
     data-pyc and so fires payables' own dispatcher. Without a prefix it is
     this file's data-cbc. One helper set, five namespaces, no second copy. */
  function hookAttr(change) {
    if (!change) return '';
    var i = String(change).indexOf(':');
    if (i < 0) return ' data-cbc="' + esc(change) + '"';
    return ' data-' + esc(change.slice(0, i)) + 'c="' + esc(change.slice(i + 1)) + '"';
  }

  function placeSelect(id, selected, opts) {
    return '<select class="inp" id="' + id + '"' + hookAttr(opts && opts.change) + '>' +
      pickable(opts).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' +
          esc(placeName(p.id)) + (p.active === false ? ' · ' + t('cb_off') : '') + '</option>';
      }).join('') + '</select>';
  }

  function curSelect(id, selected, change) {
    return '<select class="inp" id="' + id + '"' + hookAttr(change) + '>' +
      currencies().map(function (c) {
        return '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>';
      }).join('') + '</select>';
  }

  function amountBox(id, change) {
    return '<input class="inp num" id="' + id + '" type="text" inputmode="decimal" dir="ltr" autocomplete="off"' +
      hookAttr(change) + '>';
  }

  /* ====================================================================
     ONE SHAPE FOR EVERY MONEY DIALOG                    (night shift 03)
     --------------------------------------------------------------------
     Eighteen dialogs, eighteen shapes. Some led with a category, some with
     a currency, some with a place; the amount — the only thing anybody
     opened the dialog to type — was second, third or fourth, and looked
     exactly like the optional note under it. Currency was a `<select>`
     holding two options in seven different places.

     The pattern, and every part of it is below:

       1  the AMOUNT first, big, focused, inputmode="decimal"
       2  the currency as two big toggles, remembered per machine per job
       3  from / to / category as CHIPS while there are few enough to show
       4  the date and the note under one "More"
       5  a sentence that says what will be true afterwards
       6  refusals under the field that causes them, before the button

     EVERY CONTROL KEEPS ITS ID. A chip row is visible buttons over a
     hidden input with the id the handler already reads, which is what
     `cbODir` has always done — so `move-go`, `add-expense-go` and the rest
     are untouched and cannot drift from what is on screen. */

  /* A row of chips backed by a hidden input. `change` names the same
     `data-cbc` hook a <select> would have fired, so live hints keep working. */
  function pickRow(id, items, sel, change) {
    var h = '<div class="cb-pick" role="group">';
    items.forEach(function (o) {
      h += '<button type="button" class="cb-chip' + (String(o.v) === String(sel) ? ' on' : '') + '"' +
        ' data-cb="pick" data-for="' + id + '" data-v="' + esc(String(o.v)) + '">' +
        esc(o.label) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</button>';
    });
    /* The hook lives on the HIDDEN INPUT, not on the chips: a chip press
       dispatches a real change event on it, so whichever module's
       dispatcher owns that namespace hears it exactly as it hears a
       <select>. */
    return h + '</div><input type="hidden" id="' + id + '" value="' + esc(String(sel == null ? '' : sel)) + '"' +
      hookAttr(change) + '>';
  }

  /* Which currency this machine used last for THIS job. A shop that pays
     its suppliers in dollars and its wages in lira should not re-pick every
     time; a shop that does not will never notice this exists. */
  function lastCur(job, fallback) {
    try {
      var v = localStorage.getItem('og.cb.cur.' + job);
      if (v && currencies().indexOf(v) > -1) return v;
    } catch (e) { /* private window */ }
    return fallback || base();
  }
  function rememberCur(job, cur) {
    try { localStorage.setItem('og.cb.cur.' + job, cur); } catch (e) {}
  }

  /* Two big toggles, never a dropdown — there are two currencies in this
     shop and there have only ever been two. More than four and it falls
     back to the select, because eight chips is not a choice either. */
  function curPick(id, sel, change) {
    var list = currencies();
    if (list.length > 4) return curSelect(id, sel, change);
    return pickRow(id, list.map(function (c) { return { v: c, label: curWord(c) }; }), sel, change);
  }

  /* ل.س and $ are what is written on the notes; SYP and USD are what a
     spreadsheet calls them. */
  function curWord(c) {
    if (c === 'SYP') return OG.lang === 'ar' ? 'ل.س' : 'SYP';
    if (c === 'USD') return '$';
    return c;
  }

  function placePick(id, sel, opts) {
    var list = pickable(opts);
    if (list.length > 5) return placeSelect(id, sel, opts);
    return pickRow(id, list.map(function (p) {
      return { v: p.id, label: placeName(p.id) + (p.active === false ? ' · ' + t('cb_off') : '') };
    }), sel, opts && opts.change);
  }

  /* The amount, first and big.

     FIX 05 — TWO THINGS LIVE ON IT NOW.

     THE SYMBOL IS IN THE FIELD. `120000` in a box with the word "Amount"
     over it and a currency toggle beside it is three places to look before
     anybody knows what they have typed. `data-cur` names the toggle that
     decides it, so the symbol follows the toggle without a second listener.

     AND IT GROUPS AS YOU TYPE — carefully. 120000 becomes 120,000 the
     moment the sixth digit lands, which is the difference between a hundred
     and twenty thousand lira and a million and a bit at a glance. What it
     will NOT do is touch a separator somebody typed themselves: in this shop
     "12,50" means twelve and a half (`Desk.toMinor` settles it, and there is
     a whole night shift about why), so a formatter that regrouped it as
     1,250 would change the meaning of a figure while it was being written.
     Digits alone are grouped; the moment there is a separator in the box it
     is left exactly as it stands. */
  function bigAmount(id, label, change, curId) {
    return '<label class="field cb-big"><span>' + (label || t('cb_amount')) + '</span>' +
      '<span class="cb-money">' +
        '<input class="inp num cb-big-in cb-money-in" id="' + id + '" type="text" inputmode="decimal" ' +
          'dir="ltr" autocomplete="off" placeholder="0"' +
          (curId ? ' data-cur="' + esc(curId) + '"' : '') + hookAttr(change) + '>' +
        '<span class="cb-money-cur" id="' + id + 'Cur" aria-hidden="true"></span>' +
      '</span></label>';
  }

  /* --------------------------------------------------- grouping as you type

     `only` is the digit set the box is already written in, so an Arabic
     keypad's ١٢٠٠٠٠ groups with ٬ and an English one with a comma, and
     neither is converted into the other under somebody's hands. */
  var AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
  function isDigit(ch) {
    return (ch >= '0' && ch <= '9') || AR.indexOf(ch) > -1 || FA.indexOf(ch) > -1;
  }
  function groupDigits(raw) {
    var s = String(raw == null ? '' : raw);
    /* A separator of any kind, anywhere: hands off. */
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (!isDigit(c) && c !== ' ' && c !== ',' && c !== '٬') return null;
      if (c === ',' || c === '٬') continue;          /* our own grouping */
      if (c === ' ') continue;
    }
    var digits = '';
    for (var j = 0; j < s.length; j++) if (isDigit(s.charAt(j))) digits += s.charAt(j);
    if (!digits) return digits === '' && s !== '' ? null : '';
    var sep = AR.indexOf(digits.charAt(0)) > -1 || FA.indexOf(digits.charAt(0)) > -1 ? '٬' : ',';
    var out = '';
    for (var k = 0; k < digits.length; k++) {
      if (k > 0 && (digits.length - k) % 3 === 0) out += sep;
      out += digits.charAt(k);
    }
    return out;
  }

  /* THE CARET MUST NOT JUMP. Rewriting the value moves it to the end, so
     the number of DIGITS before it is counted first and found again after —
     a separator appearing in front of the caret must not push it a place. */
  function regroup(el) {
    var before = el.value, caret = el.selectionStart;
    if (caret == null) caret = before.length;
    var out = groupDigits(before);
    if (out === null || out === before) return;
    var seen = 0;
    for (var i = 0; i < caret && i < before.length; i++) if (isDigit(before.charAt(i))) seen++;
    el.value = out;
    var pos = out.length, count = 0;
    for (var j = 0; j < out.length; j++) {
      if (isDigit(out.charAt(j))) {
        count++;
        if (count === seen) { pos = j + 1; break; }
      }
    }
    if (seen === 0) pos = 0;
    try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ }
  }

  /* The symbol in the field follows its own currency toggle. */
  function paintMoneyCur(root) {
    var host = root || document;
    [].forEach.call(host.querySelectorAll('.cb-money-in'), function (el) {
      var lab = document.getElementById(el.id + 'Cur');
      if (!lab) return;
      var curId = el.getAttribute('data-cur');
      var cur = curId ? val(curId) : base();
      lab.textContent = curWord(cur || base());
    });
  }

  /* One listener for every money box in every dialog in the app.

     THE MOMENT SOMEBODY TYPES A SEPARATOR THEMSELVES, THIS STOPS. In this
     shop "12,50" means twelve and a half — `Desk.toMinor` settles it, and
     there is a whole night shift about why — so a formatter that regrouped
     it as 1,250 would change the meaning of a figure while it was being
     written, which is the worst thing a money box can do. The latch is per
     box and is lifted when the box is emptied.

     `e.data` is the character that was inserted, which is how the separator
     is caught at the moment it arrives; the value is checked as well, for a
     paste and for a browser that does not carry it. */
  var SEP = /[.,٫٬٫٬ ]/;
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('cb-money-in')) return;
    /* No separator left in the box: there is nothing of anybody's to
       protect, so grouping starts again. Deleting the comma out of "12,50"
       gives "1250", and that groups. */
    if (!SEP.test(el.value)) el.removeAttribute('data-nofmt');
    if (el.value === '') return;
    if (e.data && SEP.test(e.data)) { el.setAttribute('data-nofmt', '1'); return; }
    /* A decimal point is never ours — we only ever write thousands
       separators — and a paste arrives with no `data` at all, so the pasted
       text is judged by what is now in the box. */
    if (/[.٫٫]/.test(el.value) ||
        (e.inputType === 'insertFromPaste' && SEP.test(el.value))) {
      el.setAttribute('data-nofmt', '1');
      return;
    }
    if (el.getAttribute('data-nofmt')) return;
    regroup(el);
  });

  /* ==================================================================
     FIX 05 — ONE WAY TO SAVE, FOR EVERY MONEY DIALOG.

     What each of them did before: call Shop.write and say nothing until it
     came back. On a shop wifi that is two or three seconds of a button that
     looks exactly as it did before it was pressed — so it gets pressed
     again. `Shop.write`'s own gate means the second press does not become a
     second transfer, and the person pressing has no way to know that.

     So: the button goes busy (a spinner, disabled, aria-busy) the moment it
     is pressed, and NOTHING ELSE IN THE DIALOG MOVES — no layout shift, the
     spinner takes the place of the caption at the same width.

       - it lands   → the sheet closes, a toast says what happened, and the
                      place whose figure changed is flagged so the card can
                      light it when the screen redraws.
       - it refuses → the button comes back, the reason is written UNDER THE
                      FIELD that caused it, and every box keeps what was
                      typed. Money is the one screen where re-typing an
                      amount because the wifi blinked is unacceptable.
       - no line    → "Not saved — check the connection and try again", in
                      the same place, with the same values still there.

     The `opId` is minted when the dialog OPENS (`newOp`), so even a press
     that really does reach the server twice is one move: `applied_ops`
     answers the second with the first one's result. The double-tap check in
     `fix05/p4-money` proves that against SQLite. */

  /* The place whose figure just changed, for the card to light. Module
     state, because the screen is rebuilt by refreshAll() on the way. */
  var flash = null;

  function submit(el, send, done, opts) {
    opts = opts || {};
    if (!el || el.getAttribute('data-busy')) return;
    var caption = el.innerHTML;
    el.setAttribute('data-busy', '1');
    el.setAttribute('aria-busy', 'true');
    el.disabled = true;
    el.style.minWidth = el.offsetWidth + 'px';     /* no layout shift */
    el.innerHTML = '<span class="cb-spin" aria-hidden="true"></span>';

    function back() {
      el.removeAttribute('data-busy');
      el.removeAttribute('aria-busy');
      el.disabled = false;
      el.innerHTML = caption;
      el.style.minWidth = '';
    }

    /* SET BEFORE THE WRITE, because Shop.write redraws the whole shell
       (refreshAll) BEFORE it calls back — so a flag set in the callback is
       set after the paint that was meant to read it, and the card never
       lights. Cleared again if the save is refused. */
    flash = opts.flash || null;

    var started = Shop.write(send, null, function (res) {
      if (done) { try { done(res); } catch (e) { console.warn('money done', e); } }
    }, function (err) {
      flash = null;
      back();
      var box = whyBox(opts.whyId);
      var msg = offlineish(err) ? t('cb_no_line') : API.friendly(err);
      if (box) { box.innerHTML = esc(msg); box.scrollIntoView({ block: 'nearest' }); }
      else toast(opts.title || t('mn_title'), msg, 'err', 6000);
    });
    /* Shop.write refuses to start while another write is in flight, and
       says so by answering false. A button left spinning over a write that
       never began is the one thing worse than no spinner. */
    if (started === false) { flash = null; back(); }
  }

  function offlineish(err) {
    return !!err && (err.code === 'offline' || err.code === 'timeout' ||
                     err.status === 0 || err.status === undefined);
  }

  /* The refusal goes at the bottom of the dialog's own body, right above the
     button that was pressed — so it is read on the way to pressing it again.
     Made if it is not there, so no dialog has to remember a slot. */
  function whyBox(id) {
    var box = document.getElementById(id || 'cbWhy');
    if (box) return box;
    var body = document.querySelector('#modal-root .modal-body');
    if (!body) return null;
    box = document.createElement('div');
    box.className = 'cb-why mt';
    box.id = id || 'cbWhy';
    box.setAttribute('role', 'alert');
    body.appendChild(box);
    return box;
  }

  /* Which card to light, read and spent once by the Now tab. */
  function takeFlash() { var f = flash; flash = null; return f; }

  /* The rare half of a dialog: the date, the note, anything nobody fills in
     on an ordinary night. Shut, and it does not re-render when opened — a
     dialog is full of typed-but-unsaved values. */
  function moreFold(inner) {
    return '<div class="wh-fold cb-fold"><button class="wh-more-h" type="button" data-cb="dlg-more">' +
      t('cb_more') + '<span class="wh-more-x">+</span></button>' +
      '<div class="wh-fold-b" id="cbDlgMore" hidden>' + inner + '</div></div>';
  }

  /* The sentence under the button: what will be true once this is pressed.
     Filled by each dialog's own live hook — this is only the slot. */
  function resultLine(id, text) {
    return '<div class="cb-result" id="' + (id || 'cbResult') + '">' + (text || '') + '</div>';
  }

  /* A refusal shown UNDER THE FIELD, before the button is pressed. */
  function why(text) {
    return text ? '<div class="cb-why">' + text + '</div>' : '';
  }

  function field(label, inner, cls) {
    return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + inner + '</label>';
  }

  function pair(a, b) { return '<div class="cb-pair">' + a + b + '</div>'; }

  function holds(placeId, cur) {
    var p = findPlace(placeId);
    return p ? ((p.balances || {})[cur] || 0) : 0;
  }

  /* ---- move ---- */
  function openMove(from) {
    var src = from || 'drawer';
    var cur = lastCur('move');
    openModal({
      title: t('cb_move'), size: 'narrow',
      /* The pattern (ns03): amount, currency, where from, where to, then
         everything rare behind More, then the sentence. */
      body: bigAmount('cbAmt', t('cb_amount'), 'mv-hint', 'cbCur') +
        field(t('cb_which_money'), curPick('cbCur', cur, 'mv-hint'), 'mt') +
        field(t('cb_from_where'), placePick('cbFrom', src, { emptying: true, change: 'mv-hint' }), 'mt') +
        field(t('cb_to'), placePick('cbTo', src === 'owner' ? 'drawer' : 'owner'), 'mt') +
        moreFold(
          field(t('cb_fee'), amountBox('cbFee')) +
          '<div class="muted small">' + t('cb_fee_hint') + '</div>' +
          field(t('note'), '<input class="inp" id="cbNote" type="text" maxlength="300">', 'mt')
        ) +
        '<div class="partner-note mt" id="cbHint">' + moveHint(src, cur) + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-cb="move-go" data-op="' + newOp('mv') + '">' + t('cb_move') + '</button>',
      onOpen: function () { focusAmount('cbAmt'); }
    });
  }

  /* The amount is what somebody came to type, so the caret starts in it —
     except on a touch screen, where focusing throws the keyboard up over
     the dialog the moment it opens. The same rule the order desk's scan box
     and the receiving panel's search box follow. */
  function focusAmount(id) {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    var el = document.getElementById(id);
    if (el) { try { el.focus(); } catch (e) {} }
  }

  function moveHint(from, cur) {
    from = from || val('cbFrom') || 'drawer';
    cur = cur || val('cbCur') || base();
    return t('cb_holds').replace('{p}', esc(placeName(from))) + ' ' + signedPlain(holds(from, cur), cur);
  }

  /* ---- exchange ---- */
  function openExchange() {
    var other = currencies().filter(function (c) { return c !== 'USD'; })[0] || base();
    openModal({
      title: t('cb_exchange'), size: 'narrow',
      body: field(t('cb_x_where'), placeSelect('cbXPlace', 'owner')) +
        '<div class="cb-x mt">' +
          pair(field(t('cb_x_give'), curSelect('cbXGiveCur', 'USD', 'x-rate')),
               field(t('mn_amount'), amountBox('cbXGive', 'x-rate'))) +
          pair(field(t('cb_x_get'), curSelect('cbXGetCur', other, 'x-rate')),
               field(t('mn_amount'), amountBox('cbXGet', 'x-rate'))) +
        '</div>' +
        '<div class="partner-note mt" id="cbXRate">' + rateLine() + '</div>' +
        (allow('config.write')
          ? '<label class="cb-check mt"><input type="checkbox" id="cbXSet"> ' + t('cb_x_set') + '</label>' : '') +
        field(t('note'), '<input class="inp" id="cbNote" type="text" maxlength="300">', 'mt'),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-cb="exchange-go" data-op="' + newOp('x') + '">' + t('cb_exchange') + '</button>'
    });
  }

  /* The rate the office gave, worked out as it is typed, beside the shop's.
     A rate a hundred times out is nearly always cents typed as dollars. */
  function impliedRate() {
    var gc = val('cbXGiveCur'), rc = val('cbXGetCur');
    var ga = toMinor(val('cbXGive'), gc), ra = toMinor(val('cbXGet'), rc);
    if (!ga || !ra || gc === rc) return null;
    var usd = gc === 'USD' ? ga : rc === 'USD' ? ra : 0;
    var oth = gc === 'USD' ? { a: ra, c: rc } : { a: ga, c: gc };
    if (!usd) return null;
    var expOth = oth.c === 'USD' ? 2 : 0;
    return { rate: (oth.a / Math.pow(10, expOth)) / (usd / 100), code: oth.c };
  }

  function rateLine() {
    var r = impliedRate();
    var c = snap();
    if (!r) return t('cb_x_hint');
    var shop = c && c.rates ? c.rates[r.code] : null;
    var far = shop && (r.rate / shop < 0.5 || r.rate / shop > 2);
    return '<span class="' + (far ? 'cb-warn-t' : '') + '">' +
      t('cb_x_rate').replace('{r}', '<bdi dir="ltr">1 USD = ' + nf(r.rate) + ' ' + esc(r.code) + '</bdi>') +
      (shop ? ' · ' + t('cb_x_shop').replace('{r}', '<bdi dir="ltr">' + nf(shop) + '</bdi>') : '') +
      (far ? ' · ' + t('cb_x_far') : '') + '</span>';
  }

  /* ---- the owner ---- */
  function openOwner() {
    openModal({
      title: t('cb_owner_btn'), size: 'narrow',
      body: '<div class="cb-seg" role="group">' +
          '<button type="button" class="on" data-cb="owner-dir" data-v="draw">' + t('cb_o_draw') + '</button>' +
          '<button type="button" data-cb="owner-dir" data-v="in">' + t('cb_o_in') + '</button>' +
        '</div><input type="hidden" id="cbODir" value="draw">' +
        '<p class="muted small mt" id="cbOHint">' + t('cb_o_draw_hint') + '</p>' +
        field(t('cb_o_place'), placeSelect('cbOPlace', 'owner'), 'mt') +
        pair(field(t('cb_currency'), curSelect('cbCur', base())), field(t('mn_amount'), amountBox('cbAmt'))) +
        field(t('note'), '<input class="inp" id="cbNote" type="text" maxlength="300">', 'mt'),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-cb="owner-go" data-op="' + newOp('o') + '">' + t('save') + '</button>'
    });
  }

  /* ---- a check ----
     The figure the book expects is deliberately NOT shown. Checking against a
     number you already know is not a count; the difference comes back after. */
  function openCheck(placeId) {
    openModal({
      title: t('cb_check') + ' · ' + esc(placeName(placeId)), size: 'narrow',
      body: '<p class="muted">' + t('cb_check_sub') + '</p>' +
        currencies().map(function (c) {
          return field(t('cb_counted') + ' · ' + c, amountBox('cbCnt_' + c), 'mt');
        }).join('') +
        '<div class="muted small">' + t('cb_blank_skips') + '</div>' +
        field(t('note'), '<input class="inp" id="cbNote" type="text" maxlength="300">', 'mt'),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-cb="check-go" data-place="' + esc(placeId) + '" data-op="' +
          newOp('k') + '">' + t('save') + '</button>'
    });
  }

  /* ---- starting balances ----
     Every place the book has not been told about yet, both currencies. The
     first check of a place IS its starting balance. */
  function openStart() {
    var list = pickable().filter(function (p) { return !p.opened; });
    var curs = currencies();
    if (!list.length) {
      toast(t('cb_start_title'), t('cb_start_done'), 'ok', 4000);
      return;
    }
    openModal({
      title: t('cb_start_title'), size: 'wide',
      body: '<p class="muted">' + t('cb_start_sub') + '</p>' +
        '<div class="table-wrap"><table class="tbl cb-start-tbl"><thead><tr><th>' + t('cb_col_place') + '</th>' +
          curs.map(function (c) { return '<th class="num">' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
          list.map(function (p) {
            return '<tr><td><b>' + esc(placeName(p.id)) + '</b><small class="muted" style="display:block">' +
              t('cb_kind_' + p.kind) + '</small></td>' +
              curs.map(function (c) {
                return '<td class="num"><input class="inp num cb-start-in" type="text" inputmode="decimal" dir="ltr"' +
                  ' data-place="' + esc(p.id) + '" data-cur="' + c + '" placeholder="—"></td>';
              }).join('') + '</tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<div class="muted small mt">' + t('cb_blank_skips') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-cb="start-go" data-op="' + newOp('st') + '">' + t('cb_start_save') + '</button>'
    });
  }

  /* Several checks, one after another inside ONE Shop.write — its one-write
     gate is held for the batch, and each check is its own transaction on the
     server. Each carries an opId derived from the dialog's, so pressing Save
     twice on a stalled line checks each place once. */
  function runChecks(items, op, title) {
    if (!items.length) { toast(title, t('cb_nothing_typed'), 'warn'); return; }
    Shop.write(
      function () {
        var out = [];
        var chain = Promise.resolve();
        items.forEach(function (it, i) {
          chain = chain.then(function () {
            return Shop.cashCheck({
              place: it.place, currency: it.currency, counted: it.counted,
              note: it.note || null, opId: op + '-' + i
            }).then(function (r) { out.push(r); });
          });
        });
        return chain.then(function () { return { results: out }; });
      },
      null,
      function (res) {
        closeModal();
        B.data = null;
        var rs = (res && res.results) || [];
        var lines = rs.map(function (r) {
          var name = placeName(r.place);
          if (r.kind === 'opening') return name + ': ' + t('cb_r_opening') + ' ' + text(r.counted, r.currency);
          if (!r.diff) return name + ': ' + t('cb_r_exact');
          return name + ': ' + text(Math.abs(r.diff), r.currency) + ' ' + t(r.diff < 0 ? 'mn_short' : 'mn_over');
        });
        var off = rs.some(function (r) { return r.kind !== 'opening' && r.diff; });
        toast(title, lines.join(' · '), off ? 'warn' : 'ok', 7000);
      }
    );
  }

  /* ------------------------------------------------------- closing the day
     (054). Two hands: the cashier counts, the owner confirms. What the book
     expects is shown only to the owner — the server does not even send it to
     an account that may only count. Loaded when the tab is opened, not at
     boot: a cashier has no money bundle to carry it, and a count taken at
     night must not be read from a figure fetched at nine in the morning. */
  var DC = { data: null, at: 0, busy: false, recount: false };

  function loadClose(force) {
    if (DC.busy) return;
    if (!force && DC.data && Date.now() - DC.at < 4000) return;
    DC.busy = true;
    Shop.dayClose().then(function (r) {
      DC.data = r; DC.at = Date.now(); DC.busy = false;
      paintClose();
    }).catch(function (err) {
      DC.busy = false;
      toast(t('dc_title'), API.friendly(err), 'err', 5000);
    });
  }

  function paintClose() {
    var host = document.getElementById('cbClose');
    if (!host) return;
    host.innerHTML = closeBody();
    if (typeof labelWideTables === 'function') labelWideTables(host);
  }

  function closeTab() {
    loadClose(false);
    return '<div id="cbClose">' + closeBody() + '</div>';
  }

  function hm(iso) {
    return iso ? esc(fmtDate(iso)) + ' · <bdi dir="ltr">' + esc(fmtTimeOnly(iso)) + '</bdi>' : '—';
  }

  function closeBody() {
    var d = DC.data;
    if (!d) return '<div class="card"><div class="cart-empty"><b>' + t('cb_loading') + '</b></div></div>';
    var canCount = allow('money.count');
    var canConfirm = allow('money.move');
    var o = d.open;
    var h = '';

    if (o && canConfirm) h += confirmCard(o);
    else if (o && !DC.recount) h += waitingCard(o, canCount);
    if (canCount && (!o || DC.recount)) h += countCard(o);
    if (!canCount && !o) {
      h += '<div class="card"><div class="cart-empty"><b>' + t('dc_nothing') + '</b>' + t('dc_nothing_sub') + '</div></div>';
    }
    if (canConfirm) h += historyCard(d.recent || []);
    return h;
  }

  function countCard(o) {
    var curs = currencies();
    return '<div class="card mb dc-card"><div class="card-head"><h3>' + t(o ? 'dc_recount' : 'dc_count_title') + '</h3></div>' +
      '<div class="card-body">' +
        '<p class="muted">' + t('dc_count_sub') + '</p>' +
        '<div class="dc-inputs">' +
          curs.map(function (c) {
            return field(t('cb_counted') + ' · ' + c, amountBox('dcCnt_' + c));
          }).join('') +
        '</div>' +
        field(t('note'), '<input class="inp" id="dcNote" type="text" maxlength="300">', 'mt') +
        '<div class="dc-actions mt">' +
          (o ? '<button class="btn btn-ghost" data-cb="dc-recount-off">' + t('cancel') + '</button>' : '') +
          '<button class="btn btn-primary btn-lg" data-cb="dc-count" data-op="' + newOp('dc') + '">' + t('dc_save_count') + '</button>' +
        '</div>' +
      '</div></div>';
  }

  function waitingCard(o, canCount) {
    return '<div class="card mb dc-card"><div class="card-body">' +
      '<h3>' + t('dc_waiting') + '</h3>' +
      '<p class="muted">' + t('dc_counted_by').replace('{name}', esc(o.counted_name || '—')) + ' · ' + hm(o.counted_at) + '</p>' +
      '<div class="dc-lines">' + o.lines.map(function (l) {
        return '<div class="dc-line"><span class="muted">' + t('cb_counted') + '</span> <b>' + signedPlain(l.counted, l.currency) + '</b></div>';
      }).join('') + '</div>' +
      (canCount ? '<button class="btn btn-ghost mt" data-cb="dc-recount">' + t('dc_recount') + '</button>' : '') +
      '</div></div>';
  }

  /* The owner's half. What stays in the drawer is what was last left there,
     so "take the rest" is one press on an ordinary night. */
  function lastLeft(cur) {
    var r = (DC.data && DC.data.recent) || [];
    for (var i = 0; i < r.length; i++) {
      if (r[i].status !== 'closed') continue;
      var l = (r[i].lines || []).filter(function (x) { return x.currency === cur; })[0];
      if (l) return Math.max(0, l.left);
    }
    return 0;
  }

  function wholeText(minor, cur) {
    var v = (Number(minor) || 0) / Math.pow(10, cur === 'USD' ? 2 : 0);
    return cur === 'USD' ? v.toFixed(2) : String(Math.round(v));
  }

  function confirmCard(o) {
    var h = '<div class="card mb dc-card dc-confirm"><div class="card-head"><h3>' + t('dc_confirm_title') + '</h3>' +
      '<div class="card-actions muted small">' + esc(o.id) + '</div></div><div class="card-body">' +
      '<p class="muted">' + t('dc_counted_by').replace('{name}', esc(o.counted_name || '—')) + ' · ' + hm(o.counted_at) +
        (o.note ? ' · «' + esc(o.note) + '»' : '') + '</p>' +
      '<div class="table-wrap"><table class="tbl dc-tbl"><thead><tr>' +
        '<th>' + t('cb_currency') + '</th><th class="num">' + t('cb_counted') + '</th>' +
        '<th class="num">' + t('dc_book_said') + '</th><th class="num">' + t('mn_difference') + '</th>' +
        '<th class="num">' + t('dc_take') + '</th><th class="num">' + t('dc_stays') + '</th>' +
      '</tr></thead><tbody>';
    o.lines.forEach(function (l) {
      var take = Math.max(0, l.counted - lastLeft(l.currency));
      h += '<tr>' +
        '<td><b>' + esc(l.currency) + '</b></td>' +
        '<td class="num">' + signedPlain(l.counted, l.currency) + '</td>' +
        '<td class="num muted">' + signedPlain(l.expected, l.currency) + '</td>' +
        '<td class="num"><b class="' + (l.diff < 0 ? 'dc-short' : l.diff > 0 ? 'dc-over' : 'dc-exact') + '">' +
          (l.diff ? signed(l.diff, l.currency) : t('mn_balanced')) + '</b></td>' +
        '<td class="num"><input class="inp num dc-take" type="text" inputmode="decimal" dir="ltr"' +
          ' data-cbc="dc-take" data-cur="' + esc(l.currency) + '" data-counted="' + l.counted + '"' +
          ' value="' + esc(wholeText(take, l.currency)) + '"></td>' +
        '<td class="num" id="dcStay_' + esc(l.currency) + '">' + signedPlain(l.counted - take, l.currency) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="muted small mt">' + t('dc_confirm_sub') + '</p>' +
      field(t('note'), '<input class="inp" id="dcOwnerNote" type="text" maxlength="300">', 'mt') +
      '<div class="dc-actions mt">' +
        '<button class="btn btn-ghost" data-cb="dc-cancel" data-id="' + esc(o.id) + '">' + t('dc_cancel') + '</button>' +
        '<button class="btn btn-primary btn-lg" data-cb="dc-confirm" data-id="' + esc(o.id) + '" data-op="' + newOp('dcc') + '">' +
          t('dc_confirm_btn') + '</button>' +
      '</div></div></div>';
    return h;
  }

  function historyCard(list) {
    var curs = currencies();
    var h = '<div class="card table-wrap"><div class="card-head"><h3>' + t('dc_history') + '</h3></div>';
    if (!list.length) return h + '<div class="cart-empty"><b>' + t('dc_history_empty') + '</b></div></div>';
    h += '<table class="tbl dc-hist"><thead><tr><th>' + t('date') + '</th><th>' + t('dc_counted_col') + '</th>' +
      curs.map(function (c) { return '<th class="num">' + esc(c) + '</th>'; }).join('') +
      '<th>' + t('status') + '</th></tr></thead><tbody>';
    list.forEach(function (x) {
      h += '<tr' + (x.status === 'cancelled' ? ' class="mn-void"' : '') + '>' +
        '<td class="num muted">' + hm(x.counted_at) + '</td>' +
        '<td>' + esc(x.counted_name || '—') + '</td>' +
        curs.map(function (c) {
          var l = (x.lines || []).filter(function (y) { return y.currency === c; })[0];
          if (!l) return '<td class="num muted">—</td>';
          return '<td class="num"><b>' + signedPlain(l.counted, c) + '</b>' +
            (l.diff ? '<small class="' + (l.diff < 0 ? 'dc-short' : 'dc-over') + '" style="display:block">' + signed(l.diff, c) + '</small>' : '') +
            (l.taken ? '<small class="muted" style="display:block">' + t('dc_took') + ' ' + signedPlain(l.taken, c) + '</small>' : '') +
            '</td>';
        }).join('') +
        '<td><span class="badge ' + (x.status === 'closed' ? 'healthy' : x.status === 'counted' ? 'low' : 'neutral') + '">' +
          t('dc_st_' + x.status) + '</span>' +
          (x.confirmed_name ? '<small class="muted" style="display:block">' + esc(x.confirmed_name) + '</small>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ------------------------------------------------------ the owner's places
     A safe, a bank — anything that holds the shop's money and is not a
     payment method. Settings, config.write. */
  function settingsCard() {
    if (!allow('config.write')) return '';
    if (!P) {
      P = places().filter(function (p) { return p.kind === 'extra'; }).map(function (p) {
        return { id: p.id.slice(2), en: p.en, ar: p.ar, active: p.active !== false };
      });
    }
    var h = setFoldStart('cashplaces', t('cb_set_title'),
      '<span dir="ltr">' + nf(P.filter(function (x) { return x.active; }).length) + '</span>');
    h += '<div class="card-body"><p class="muted small">' + t('cb_set_sub') + '</p>';
    if (!P.length) h += '<p class="muted">' + t('cb_set_none') + '</p>';
    P.forEach(function (x, i) {
      h += '<div class="cb-set-row">' +
        '<input class="inp" type="text" maxlength="40" placeholder="' + esc(t('cb_set_en')) + '" data-cbc="pl" data-i="' + i + '" data-k="en" value="' + esc(x.en) + '">' +
        '<input class="inp" type="text" maxlength="40" dir="rtl" placeholder="' + esc(t('cb_set_ar')) + '" data-cbc="pl" data-i="' + i + '" data-k="ar" value="' + esc(x.ar) + '">' +
        '<label class="cb-check"><input type="checkbox" data-cbc="pl" data-i="' + i + '" data-k="active"' +
          (x.active ? ' checked' : '') + '> ' + t('cb_set_on') + '</label>' +
        '</div>';
    });
    h += '<div class="cb-set-foot mt">' +
      '<button class="btn btn-ghost btn-sm" data-cb="pl-add">+ ' + t('cb_set_add') + '</button>' +
      '<button class="btn btn-primary btn-sm" data-cb="pl-save">' + t('save') + '</button></div>';
    return h + '</div>' + setFoldEnd();
  }

  function keepScrollRender() {
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    render();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  function slug(s, taken) {
    var b = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'place';
    var id = b, n = 2;
    while (taken.indexOf(id) > -1) id = b + '-' + (n++);
    return id;
  }

  /* --------------------------------------------------------------- acts */

  var ACT = {
    start: function () { openStart(); },
    move: function (el) { openMove(el.getAttribute('data-place')); },
    exchange: function () { openExchange(); },
    owner: function () { openOwner(); },
    check: function (el) { openCheck(el.getAttribute('data-place')); },

    'f-clear': function () {
      B.place = B.kind = B.from = B.to = '';
      B.data = null;
      render();
    },

    /* A chip row's press (ns03). It writes the hidden input the handlers
       already read, lights the chip, and then fires the SAME `data-cbc`
       hook a <select> would have fired — so the live hints (the "X holds Y"
       line, the exchange rate, the pay hint) keep working unchanged. */
    pick: function (el) {
      var id = el.getAttribute('data-for');
      var box = document.getElementById(id);
      if (box) box.value = el.getAttribute('data-v');
      Array.prototype.forEach.call(el.parentNode.children, function (b) {
        b.classList.toggle('on', b === el);
      });
      if (box) { try { box.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      /* The symbol inside the amount box follows its own toggle. (fix 05) */
      paintMoneyCur();
    },

    /* The dialog's own "More". One attribute, never a render — this dialog
       is full of typed-but-unsaved values. */
    'dlg-more': function (el) {
      var body = document.getElementById('cbDlgMore');
      if (!body) return;
      var open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      var x = el.querySelector('.wh-more-x');
      if (x) x.textContent = open ? '−' : '+';
    },

    'owner-dir': function (el) {
      var v = el.getAttribute('data-v');
      var box = document.getElementById('cbODir');
      if (box) box.value = v;
      var seg = el.parentNode;
      Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle('on', b === el); });
      var hint = document.getElementById('cbOHint');
      if (hint) hint.textContent = t(v === 'draw' ? 'cb_o_draw_hint' : 'cb_o_in_hint');
    },

    'move-go': function (el) {
      rememberCur('move', val('cbCur') || base());
      var from = val('cbFrom'), to = val('cbTo'), cur = val('cbCur');
      var amount = toMinor(val('cbAmt'), cur);
      var fee = toMinor(val('cbFee'), cur);
      if (from === to) { toast(t('cb_move'), t('cb_same_place'), 'warn'); return; }
      if (!amount) { toast(t('cb_move'), t('mn_amount_needed'), 'warn'); return; }
      var body = { from: from, to: to, currency: cur, amount: amount, fee: fee || 0,
                   note: val('cbNote') || null, opId: el.getAttribute('data-op') };
      submit(el, function () { return Shop.cashTransfer(body); }, function () {
        closeModal();
        B.data = null;
        toast(t('cb_move'), placeName(from) + ' → ' + placeName(to) + ' · ' + text(amount, cur) +
          (fee ? ' · ' + t('cb_fee_short') + ' ' + text(fee, cur) : ''), 'ok', 4500);
      }, { flash: to, title: t('cb_move') });
    },

    'exchange-go': function (el) {
      var gc = val('cbXGiveCur'), rc = val('cbXGetCur');
      var ga = toMinor(val('cbXGive'), gc), ra = toMinor(val('cbXGet'), rc);
      if (gc === rc) { toast(t('cb_exchange'), t('cb_x_same'), 'warn'); return; }
      if (!ga || !ra) { toast(t('cb_exchange'), t('mn_amount_needed'), 'warn'); return; }
      var set = document.getElementById('cbXSet');
      var body = {
        place: val('cbXPlace'), give: { currency: gc, amount: ga }, get: { currency: rc, amount: ra },
        setRate: !!(set && set.checked), note: val('cbNote') || null, opId: el.getAttribute('data-op')
      };
      submit(el, function () { return Shop.cashExchange(body); }, function (res) {
        closeModal();
        B.data = null;
        var msg = text(ga, gc) + ' → ' + text(ra, rc);
        if (res && res.rate) msg += ' · 1 USD = ' + nf(res.rate);
        if (res && res.rateSet) msg += ' · ' + t('cb_x_rate_set');
        toast(t('cb_exchange'), msg, res && res.warning ? 'warn' : 'ok', 6000);
      }, { flash: body.place, title: t('cb_exchange') });
    },

    'owner-go': function (el) {
      var cur = val('cbCur');
      var amount = toMinor(val('cbAmt'), cur);
      if (!amount) { toast(t('cb_owner_btn'), t('mn_amount_needed'), 'warn'); return; }
      var dir = val('cbODir') === 'in' ? 'in' : 'draw';
      var body = { direction: dir, place: val('cbOPlace'), currency: cur, amount: amount,
                   note: val('cbNote') || null, opId: el.getAttribute('data-op') };
      submit(el, function () { return Shop.cashOwner(body); }, function () {
        closeModal();
        B.data = null;
        toast(t(dir === 'draw' ? 'cb_o_draw' : 'cb_o_in'), placeName(body.place) + ' · ' + text(amount, cur), 'ok', 4000);
      }, { flash: body.place, title: t('cb_owner_btn') });
    },

    'check-go': function (el) {
      var placeId = el.getAttribute('data-place');
      var note = val('cbNote');
      var items = [];
      currencies().forEach(function (c) {
        var raw = val('cbCnt_' + c).trim();
        if (raw === '') return;
        items.push({ place: placeId, currency: c, counted: toMinor(raw, c), note: note });
      });
      runChecks(items, el.getAttribute('data-op'), t('cb_check') + ' · ' + placeName(placeId));
    },

    'start-go': function (el) {
      var items = [];
      Array.prototype.forEach.call(document.querySelectorAll('.cb-start-in'), function (inp) {
        var raw = String(inp.value || '').trim();
        if (raw === '') return;
        var c = inp.getAttribute('data-cur');
        items.push({ place: inp.getAttribute('data-place'), currency: c, counted: toMinor(raw, c) });
      });
      runChecks(items, el.getAttribute('data-op'), t('cb_start_title'));
    },

    /* From anywhere — the cashier's home — straight to the count. */
    'go-close': function () {
      if (typeof Money !== 'undefined') Money.state.tab = 'close';
      go('money');
    },

    /* The four jobs, from the "Where the money is" tab (ns02). Each sets the
       tab and re-renders; the expense also opens its dialog, because there is
       nothing on that tab to read first — the list behind it is history. */
    'go-expense': function () {
      if (typeof Money === 'undefined') return;
      Money.state.tab = 'expenses';
      render();
      Money.addExpense();
    },
    'go-suppliers': function () {
      if (typeof Money !== 'undefined') Money.state.tab = 'suppliers';
      render();
    },
    'go-salaries': function () {
      if (typeof Money !== 'undefined') Money.state.tab = 'salaries';
      render();
    },

    'dc-recount': function () { DC.recount = true; paintClose(); },
    'dc-recount-off': function () { DC.recount = false; paintClose(); },

    'dc-count': function (el) {
      var counted = {};
      var any = false;
      currencies().forEach(function (c) {
        var raw = val('dcCnt_' + c).trim();
        /* An empty box is "none of this currency" — the server still refuses
           a currency the drawer holds if it was left out entirely, and the
           form always sends every one. */
        counted[c] = raw === '' ? 0 : toMinor(raw, c);
        if (raw !== '') any = true;
      });
      if (!any) { toast(t('dc_title'), t('cb_nothing_typed'), 'warn'); return; }
      var body = { counted: counted, note: val('dcNote') || null, opId: el.getAttribute('data-op') };
      Shop.write(function () { return Shop.dayCount(body); }, null, function (res) {
        DC.recount = false;
        DC.data = null;
        loadClose(true);
        toast(t('dc_title'), t(res && res.recount ? 'dc_recounted' : 'dc_counted'), 'ok', 5000);
      });
    },

    'dc-confirm': function (el) {
      var id = el.getAttribute('data-id');
      var taken = {};
      var bad = null;
      Array.prototype.forEach.call(document.querySelectorAll('.dc-take'), function (inp) {
        var c = inp.getAttribute('data-cur');
        var n = String(inp.value || '').trim() === '' ? 0 : toMinor(inp.value, c);
        if (n > Number(inp.getAttribute('data-counted'))) bad = c;
        taken[c] = n;
      });
      if (bad) { toast(t('dc_title'), t('dc_take_too_much').replace('{c}', bad), 'warn', 5000); return; }
      var body = { taken: taken, ownerNote: val('dcOwnerNote') || null, opId: el.getAttribute('data-op') };
      Shop.write(function () { return Shop.dayConfirm(id, body); }, null, function (res) {
        DC.data = null;
        loadClose(true);
        var lines = ((res && res.close && res.close.lines) || []).map(function (l) {
          return l.currency + ': ' + t('dc_took') + ' ' + text(l.taken, l.currency) + ', ' +
            t('dc_stays').toLowerCase() + ' ' + text(l.left, l.currency) +
            (l.diff ? ' (' + (l.diff < 0 ? '−' : '+') + text(Math.abs(l.diff), l.currency) + ')' : '');
        });
        var off = ((res && res.close && res.close.lines) || []).some(function (l) { return l.diff; });
        toast(t('dc_closed'), lines.join(' · '), off ? 'warn' : 'ok', 8000);
      });
    },

    'dc-cancel': function (el) {
      var id = el.getAttribute('data-id');
      Shop.write(function () { return Shop.dayCancel(id); }, null, function () {
        DC.data = null;
        loadClose(true);
        toast(t('dc_title'), t('dc_cancelled'), 'ok', 3500);
      });
    },

    'pl-add': function () {
      if (!P) return;
      P.push({ id: '', en: '', ar: '', active: true });
      keepScrollRender();
      var boxes = document.querySelectorAll('[data-cbc="pl"][data-k="en"]');
      var last = boxes[boxes.length - 1];
      if (last) { try { last.focus({ preventScroll: true }); } catch (e) { last.focus(); } }
    },

    'pl-save': function () {
      if (!P) return;
      if (P.some(function (x) { return !String(x.en || '').trim() && !String(x.ar || '').trim(); })) {
        toast(t('cb_set_title'), t('cb_set_need_name'), 'warn', 5000);
        return;
      }
      var taken = P.map(function (x) { return x.id; }).filter(Boolean);
      var list = P.map(function (x) {
        if (!x.id) { x.id = slug(x.en || x.ar, taken); taken.push(x.id); }
        return { id: x.id, en: x.en, ar: x.ar, active: !!x.active };
      });
      API.put('/api/cash/places', { places: list }).then(function () {
        P = null;
        return Shop.load();
      }).then(function () {
        toast(t('cb_set_title'), t('cb_set_saved'), 'ok', 3000);
        keepScrollRender();
      }).catch(function (err) {
        toast(t('cb_set_title'), err.message || API.friendly(err), 'err', 7000);
      });
    }
  };

  /* Typing and choosing, never render(): the dialogs hold what is being
     typed, and the Book's filters hold a caret. */
  var CHANGE = {
    f: function (el) {
      B[el.getAttribute('data-k')] = el.value;
      B.data = null;
      if (!filtered()) { paintBook(); return; }
      var host = document.getElementById('cbBook');
      if (host) host.innerHTML = '<div class="card"><div class="cart-empty"><b>' + t('cb_loading') + '</b></div></div>';
      loadBook();
    },
    'mv-hint': function () {
      var h = document.getElementById('cbHint');
      if (h) h.innerHTML = moveHint();
    },
    'x-rate': function () {
      var h = document.getElementById('cbXRate');
      if (h) h.innerHTML = rateLine();
    },
    /* What stays in the drawer, as the owner types what he takes. */
    'dc-take': function (el) {
      var c = el.getAttribute('data-cur');
      var counted = Number(el.getAttribute('data-counted')) || 0;
      var take = String(el.value || '').trim() === '' ? 0 : toMinor(el.value, c);
      var cell = document.getElementById('dcStay_' + c);
      if (cell) cell.innerHTML = signedPlain(counted - take, c);
      el.classList.toggle('dc-bad', take > counted);
    },
    pl: function (el) {
      if (!P) return;
      var row = P[Number(el.getAttribute('data-i'))];
      if (!row) return;
      var k = el.getAttribute('data-k');
      row[k] = el.type === 'checkbox' ? !!el.checked : el.value;
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-cb]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-cb')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
    var onChange = function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-cbc]') : null;
      if (!el) return;
      var fn = CHANGE[el.getAttribute('data-cbc')];
      if (fn) fn(el, e);
    };
    document.addEventListener('change', onChange);
    /* On every keystroke only where that is the point — the live rate and
       the settings copy. The Book's filters wait for a change. */
    document.addEventListener('input', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-cbc]') : null;
      if (!el) return;
      var k = el.getAttribute('data-cbc');
      if (k === 'x-rate' || k === 'pl' || k === 'dc-take') onChange(e);
    });
  }
  bind();

  /* The Book tab exports what it shows. */
  function exportSpec() {
    var page = filtered() ? B.data : DB.cashBook;
    var rows = page ? page.rows : [];
    return {
      name: 'cash-book', sheet: 'Cash book', title: t('cb_book'),
      subtitle: (page && page.capped ? t('cap_window').replace('{a}', nf(page.shown)).replace('{b}', nf(page.total))
                  .replace('{n}', t('cb_moves')) + ' · ' : '') + fmtDate(new Date()),
      /* One column per currency, never one for both; the other is blank —
         blank, not zero, because nothing moved in it. */
      columns: [{ label: t('date'), date: true }, { label: t('cb_col_place'), width: 22 },
                { label: t('cb_col_what'), width: 26 }, { label: t('cb_col_ref') },
                { label: 'SYP', money: 'SYP' }, { label: 'USD', money: 'USD' },
                { label: t('cb_col_who') }],
      rows: rows.map(function (m) {
        var whole = m.amount / Math.pow(10, m.currency === 'USD' ? 2 : 0);
        return [new Date(m.at), placeName(m.place), t('cb_k_' + m.kind) +
                  (m.other_place && m.kind !== 'exchange' ? ' ' + (m.amount < 0 ? t('cb_to') : t('cb_from_w')) +
                   ' ' + placeName(m.other_place) : ''),
                refText(m),
                m.currency === 'SYP' ? whole : null,
                m.currency === 'USD' ? whole : null,
                m.user_name || ''];
      })
    };
  }

  function closeExportSpec() {
    var list = (DC.data && DC.data.recent) || [];
    var curs = currencies();
    var cols = [{ label: t('date'), date: true }, { label: t('dc_counted_col'), width: 20 }];
    curs.forEach(function (c) {
      cols.push({ label: c + ' · ' + t('cb_counted'), money: c });
      cols.push({ label: c + ' · ' + t('mn_difference'), money: c });
      cols.push({ label: c + ' · ' + t('dc_take'), money: c });
    });
    cols.push({ label: t('status') });
    return {
      name: 'day-closes', sheet: 'Day closes', title: t('dc_history'), subtitle: fmtDate(new Date()),
      columns: cols,
      rows: list.map(function (x) {
        var row = [new Date(x.counted_at), x.counted_name || ''];
        curs.forEach(function (c) {
          var l = (x.lines || []).filter(function (y) { return y.currency === c; })[0];
          var div = c === 'USD' ? 100 : 1;
          row.push(l ? l.counted / div : null, l ? l.diff / div : null, l ? l.taken / div : null);
        });
        row.push(t('dc_st_' + x.status));
        return row;
      })
    };
  }

  return {
    nowTab: nowTab,
    bookTab: bookTab,
    closeTab: closeTab,
    closeExportSpec: closeExportSpec,
    settingsCard: settingsCard,
    placeName: placeName,
    pickable: pickable,
    /* The one money DIALOG PATTERN, shared with js/payables.js and
       js/money.js (ns03) — the whole point is that there is one shape, so
       there is one place it is built. */
    bigAmount: bigAmount, curPick: curPick, placePick: placePick, pickRow: pickRow,
    moreFold: moreFold, resultLine: resultLine, why: why, field: field,
    lastCur: lastCur, rememberCur: rememberCur, curWord: curWord, focusAmount: focusAmount,
    /* The one money encoder and parser for the Money screen's other tabs
       (js/payables.js) — a second copy is how two figures stop agreeing. */
    money: signedPlain,
    signed: signed,
    moneyText: text,
    toMinor: toMinor,
    newOp: newOp,
    placeSelect: placeSelect,
    currencies: currencies,
    catLabel: catLabel,
    exportSpec: exportSpec,
    openMove: openMove,

    /* FIX 05 — the three things every money dialog in the app now shares,
       wherever it is built. `paintMoney` is called by openModal itself. */
    paintMoney: paintMoneyCur,
    groupDigits: groupDigits,
    submit: submit
  };
})();
