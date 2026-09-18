/* ==========================================================================
   SAFEERS — the delivery team (السفراء)                             [Safeers]
   --------------------------------------------------------------------------
   Migration 060. The team layer over the delivery office and the road:
   who is on the road, what each of them is carrying, what they have done,
   what they have earned and the cash on them. Parcels are the board's
   (assigned with the board's own route); errands are this screen's.

   - Earned and cash on him are money: they arrive only for an account with
     money.read, and are drawn only when they arrived.
   - Nothing looks saved until the server has it. A button waits, and a shop
     that cannot be reached says so in words — the phones only reach the shop
     on its wifi until the server moves somewhere public.
   - The safeer's own phone (his home is the driver's run list) gets his
     errands here, as big cards: Out · Done · Failed (with a reason).

   Delegated events: data-sf (click).
   ========================================================================== */

var Safeers = (function () {

  var S = {
    team: null, areas: [], rate: null, errands: [], parcels: [],
    filter: { safeer: '', status: 'open', date: '' },
    loading: false, error: null, shown: null, menu: null,
    mine: null, mineError: null, mineLoading: false
  };

  function fmt(minor, currency) {
    if (currency === 'USD') return moneyUsdRaw(minor);
    if (currency === 'SYP' || !currency) return moneySypRaw(minor);
    return nf(minor) + ' ' + currency;
  }
  function areaName(id) {
    var a = S.areas.filter(function (x) { return x.id === id; })[0];
    return a ? (OG.lang === 'ar' ? a.ar : a.en) : (id || '');
  }
  function offline(err) {
    return err && (err.code === 'offline' || err.code === 'timeout' || err.status === 0);
  }
  function tzMinutes() { return -new Date().getTimezoneOffset(); }
  function midnight() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }

  /* ------------------------------------------------------------ loading */

  function load() {
    /* a filter changed while a load is out: ask again when it lands, or the
       answer on screen is for the old filter */
    if (S.loading) { S.again = true; return; }
    S.loading = true;
    var q = [];
    if (S.filter.safeer) q.push('safeer=' + encodeURIComponent(S.filter.safeer));
    if (S.filter.status) q.push('status=' + encodeURIComponent(S.filter.status));
    if (S.filter.date) q.push('since=' + encodeURIComponent(new Date(S.filter.date + 'T00:00:00').toISOString()));
    Promise.all([
      API.get('/api/safeers?tz=' + tzMinutes()),
      API.get('/api/errands' + (q.length ? '?' + q.join('&') : '')),
      Auth.can('delivery.read') ? API.get('/api/deliveries?status=today&since=' + encodeURIComponent(midnight())) : Promise.resolve({ deliveries: [] })
    ]).then(function (r) {
      S.loading = false;
      S.error = null;
      S.team = r[0].people;
      S.rate = r[0].rate === undefined ? undefined : r[0].rate;
      S.areas = r[0].areas || [];
      S.errands = r[1].errands || [];
      S.parcels = (r[2].deliveries || []).filter(function (d) { return !d.voided && d.method !== 'pickup' && (!d.method || d.method === 'driver'); });
      if (S.again) { S.again = false; load(); return; }
      repaint();
    }, function (err) {
      S.loading = false;
      S.error = err;
      if (S.again) { S.again = false; load(); return; }
      repaint();
    });
  }

  function repaint() {
    if (OG.view !== 'safeers') return;
    if (document.querySelector('#modal-root .modal')) return;
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    render();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  /* --------------------------------------------------------------- views */

  function statusBadge(st) {
    var cls = st === 'done' || st === 'delivered' ? 'healthy' : st === 'failed' ? 'critical' : st === 'out' ? 'accent' : 'neutral';
    return '<span class="badge ' + cls + '">' + t('sf_st_' + st) + '</span>';
  }

  function view() {
    var h = '<div class="page-head"><div><h1>' + t('nav_safeers') + '</h1><div class="sub">' + t('sf_sub') + '</div></div>' +
      '<div class="head-actions">' +
        '<button class="btn btn-ghost btn-sm" data-sf="reload">' + t('sf_reload') + '</button>' +
        (allow('safeer.write') ? '<button class="btn" data-sf="assign-parcel">' + t('sf_assign_parcel') + '</button>' +
                                 '<button class="btn btn-primary" data-sf="new-errand">' + t('sf_new_errand') + '</button>' : '') +
      '</div></div>';

    if (S.error) {
      h += '<div class="card sf-offline"><b>' + t(offline(S.error) ? 'sf_offline' : 'sf_failed') + '</b>' +
        '<small>' + esc(API.friendly(S.error)) + '</small>' +
        '<button class="btn btn-sm" data-sf="reload">' + t('retry') + '</button></div>';
    }
    if (!S.team) { if (!S.loading && !S.error) load(); return h + '<div class="card"><div class="card-body muted">…</div></div>'; }

    /* ---- the team ---- */
    var money = S.rate !== undefined;
    h += '<div class="sf-team">';
    if (!S.team.length) h += '<div class="card"><div class="cart-empty"><b>' + t('sf_no_team') + '</b>' + t('sf_no_team_sub') + '</div></div>';
    S.team.forEach(function (p) {
      h += '<div class="card sf-person' + (p.active ? '' : ' is-off') + (S.menu === p.id ? ' is-menu' : '') + '">' +
        '<div class="sf-p-head">' +
          (typeof Desk !== 'undefined' && Desk.face ? Desk.face(p.id, p.name) : '') +
          '<div class="sf-p-who"><b>' + esc(p.name) + '</b>' +
            '<small>' + (p.phone ? '<bdi dir="ltr">' + esc(p.phone) + '</bdi> · ' : '') + '<bdi dir="ltr">' + esc(p.username) + '</bdi></small></div>' +
          '<span class="badge ' + (!p.active ? 'neutral' : p.busy ? 'accent' : 'healthy') + '">' +
            t(!p.active ? 'sf_off' : p.busy ? 'sf_busy' : 'sf_free') + '</span>' +
        '</div>' +
        '<div class="sf-p-stats">' +
          '<div><span class="eyebrow">' + t('sf_open') + '</span><b>' + nf(p.open) + '</b></div>' +
          '<div><span class="eyebrow">' + t('sf_done_today') + '</span><b>' + nf(p.done.today) + '</b></div>' +
          '<div><span class="eyebrow">' + t('sf_done_month') + '</span><b>' + nf(p.done.month) + '</b></div>' +
        '</div>';
      if (money) {
        h += '<div class="sf-p-money">' +
          '<div><span class="eyebrow">' + t('sf_earned') + '</span>' +
            (p.earned
              ? '<b><bdi dir="ltr">' + fmt(p.earned.today, p.earned.currency) + '</bdi></b><small>' + t('sf_week') + ' <bdi dir="ltr">' + fmt(p.earned.week, p.earned.currency) + '</bdi> · ' +
                t('sf_month') + ' <bdi dir="ltr">' + fmt(p.earned.month, p.earned.currency) + '</bdi></small>'
              : '<small class="muted">' + t('sf_no_rate') + '</small>') + '</div>' +
          '<div><span class="eyebrow">' + t('sf_cash_on_him') + '</span>' +
            (p.cash && p.cash.length
              ? p.cash.map(function (c) { return '<b><bdi dir="ltr">' + fmt(c.amount, c.currency) + '</bdi></b>'; }).join('')
              : '<b class="muted">—</b>') + '</div>' +
        '</div>';
      }
      if (allow('safeer.write')) {
        /* "Their tasks" is what this card is pressed for. The two account
           actions — a new password, and switching somebody off — are rarer
           and one of them ends their sessions, so they moved behind a "…"
           (quick fix). Same shape as the deliveries board's row menu: markup
           already in the card, shown by a class, closed by an outside press. */
        var acct = (allow('staff.write') || allow('access.write'))
          ? '<button class="dlb-mitem" data-sf="password" data-id="' + p.id + '">' + t('ac_new_pw') + '</button>' +
            '<button class="dlb-mitem" data-sf="active" data-id="' + p.id + '" data-on="' + (p.active ? '0' : '1') + '">' +
              t(p.active ? 'ac_switch_off' : 'ac_switch_on') + '</button>'
          : '';
        h += '<div class="sf-p-act">' +
          '<button class="btn btn-sm btn-ghost" data-sf="filter-person" data-id="' + p.id + '">' + t('sf_their_tasks') + '</button>' +
          (acct
            ? '<span class="dlb-more">' +
                '<button class="btn btn-sm btn-ghost dlb-dots" data-sf="menu" data-id="' + p.id + '" ' +
                  'aria-label="' + esc(t('sf_more_actions')) + '" title="' + esc(t('sf_more_actions')) + '">···</button>' +
                '<span class="dlb-menu' + (S.menu === p.id ? ' on' : '') + '" data-menu="sf' + p.id + '">' + acct + '</span>' +
              '</span>'
            : '') +
        '</div>';
      }
      h += '</div>';
    });
    h += '</div>';

    if (S.shown) {
      h += '<div class="ac-once" role="status"><b>' + esc(t('ac_pw_once').replace('{name}', S.shown.name)) + '</b>' +
        '<div class="ac-once-row"><code dir="ltr">' + esc(S.shown.password) + '</code>' +
        '<button class="btn btn-sm btn-ghost" data-sf="hide-once">' + t('ac_done') + '</button></div>' +
        '<small class="muted">' + t('ac_pw_once_sub') + '</small></div>';
    }
    if (allow('safeer.write') && (allow('staff.write') || allow('access.write'))) {
      h += '<div class="card sf-add"><div class="card-head"><h3>' + t('sf_add') + '</h3></div><div class="card-body sf-add-row">' +
        '<label class="field"><span>' + t('ac_name') + '</span><input class="inp" id="sfName" maxlength="60"></label>' +
        '<label class="field"><span>' + t('phone') + '</span><input class="inp" id="sfPhone" dir="ltr" maxlength="30"></label>' +
        '<label class="field"><span>' + t('ac_username') + '</span><input class="inp" id="sfUser" dir="ltr" maxlength="32" autocomplete="off"></label>' +
        '<button class="btn btn-primary" data-sf="add">' + t('ac_add_btn') + '</button></div></div>';
    }

    /* ---- the tasks ---- */
    h += '<div class="card mt"><div class="card-head"><h3>' + t('sf_tasks') + '</h3></div>' +
      '<div class="card-body sf-filters">' +
        '<label class="field"><span>' + t('sf_safeer') + '</span><select class="inp" data-sf-f="safeer"><option value="">' + t('sf_everyone') + '</option>' +
          S.team.map(function (p) { return '<option value="' + p.id + '"' + (String(S.filter.safeer) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="field"><span>' + t('status') + '</span><select class="inp" data-sf-f="status">' +
          ['open', 'waiting', 'out', 'done', 'failed', ''].map(function (s) {
            return '<option value="' + s + '"' + (S.filter.status === s ? ' selected' : '') + '>' + t(s ? 'sf_f_' + s : 'sf_f_all') + '</option>';
          }).join('') + '</select></label>' +
        '<label class="field"><span>' + t('sf_since') + '</span><input class="inp" type="date" data-sf-f="date" value="' + esc(S.filter.date) + '"></label>' +
      '</div>';
    var rows = tasks();

    /* THE LIST OPENS FILTERED, AND NEVER SAID SO (quick fix). `S.filter.status`
       starts at 'open', which is the right default — but it meant somebody
       seeing four rows out of twenty-four read the page as empty or cut off,
       which is exactly how it was reported. It says which filter is on and
       offers one press to drop the lot. */
    var filtered = !!(S.filter.status || S.filter.safeer || S.filter.date);
    if (filtered) {
      h += '<div class="sf-filtered muted small">' +
        t('sf_filtered').replace('{n}', '<bdi dir="ltr">' + nf(rows.length) + '</bdi>') +
        ' <button class="btn btn-sm btn-ghost" data-sf="filter-clear">' + t('sf_show_all') + '</button>' +
      '</div>';
    }

    if (!rows.length) {
      h += '<div class="cart-empty"><b>' + t('sf_no_tasks') + '</b>' +
        (filtered ? t('sf_no_tasks_filtered') : t('sf_no_tasks_sub')) + '</div>';
    } else {
      h += '<div class="table-wrap"><table class="tbl sf-tbl"><thead><tr>' +
        '<th>' + t('sf_task') + '</th><th>' + t('sf_area') + '</th><th>' + t('sf_safeer') + '</th>' +
        '<th>' + t('status') + '</th><th>' + t('sf_due') + '</th><th></th></tr></thead><tbody>';
      rows.forEach(function (r) { h += taskRow(r); });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  /* Parcels (the board's) and errands, one list.

     The two halves are filtered in two different places and that is not an
     oversight: the errands are asked for WITH the filter on the query string
     (`load()`), so the server has already narrowed them, while the parcels
     arrive from the board's own request and are narrowed here.

     What WAS an oversight (quick fix): `since` was on the errands' query and
     was read nowhere for the parcels, so picking a date changed half the list
     and left the other half alone. */
  function tasks() {
    var f = S.filter;
    var since = f.date ? new Date(f.date + 'T00:00:00').getTime() : 0;
    var out = [];
    S.parcels.forEach(function (d) {
      if (!d.driverId) return;
      if (f.safeer && String(d.driverId) !== String(f.safeer)) return;
      var st = d.status === 'delivered' ? 'done' : d.status;
      if (f.status === 'open' && !(st === 'waiting' || st === 'out')) return;
      if (f.status && f.status !== 'open' && f.status !== st) return;
      if (since) {
        /* The same instant the row is sorted and stamped by elsewhere: when
           it closed if it has, else when it went out, else when it was given
           to somebody. A parcel with no date at all is kept — dropping it
           would hide a real task behind a filter about time. */
        var at = new Date(d.closedAt || d.outAt || d.assignedAt || d.saleAt || '').getTime();
        if (isFinite(at) && at < since) return;
      }
      out.push({ type: 'parcel', id: d.id, title: d.saleId + ' · ' + (d.customerName || ''), area: d.city || d.address || '',
                 safeer: d.driverName, status: d.status, due: null, raw: d });
    });
    S.errands.forEach(function (e) {
      out.push({ type: 'errand', id: e.id, title: e.title, area: areaName(e.area), safeer: e.safeerName,
                 status: e.status, due: e.dueDate, raw: e });
    });
    return out;
  }

  function taskRow(r) {
    var act = '';
    if (r.type === 'errand' && allow('safeer.write')) {
      var e = r.raw;
      if (e.status === 'waiting') act += '<button class="btn btn-sm" data-sf="errand-assign" data-id="' + e.id + '">' + t('dl_assign_btn') + '</button>' +
        (e.safeerId ? '<button class="btn btn-sm" data-sf="errand-status" data-to="out" data-id="' + e.id + '">' + t('sf_mark_out') + '</button>' : '');
      if (e.status === 'out') act += '<button class="btn btn-sm btn-primary" data-sf="errand-status" data-to="done" data-id="' + e.id + '">' + t('sf_mark_done') + '</button>';
      if (e.status === 'waiting' || e.status === 'out') act += '<button class="btn btn-sm btn-ghost" data-sf="errand-fail" data-id="' + e.id + '">' + t('sf_mark_failed') + '</button>';
    }
    if (r.type === 'parcel') act += '<button class="btn btn-sm btn-ghost" data-act="nav" data-view="deliveries">' + t('sf_on_board') + '</button>';
    return '<tr data-sf-row="' + r.type + '-' + r.id + '"><td><span class="badge neutral">' + t(r.type === 'parcel' ? 'sf_parcel' : 'sf_errand') + '</span> ' +
      '<b>' + esc(r.title) + '</b>' + (r.type === 'errand' && r.raw.notes ? '<small class="muted" style="display:block">' + esc(r.raw.notes) + '</small>' : '') +
      (r.raw.failReason ? '<small class="sf-why">' + esc(r.raw.failReason) + '</small>' : '') + '</td>' +
      '<td>' + esc(r.area || '—') + '</td><td>' + esc(r.safeer || '—') + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td>' + (r.due ? '<span dir="auto">' + fmtDate(ymdLocal(r.due)) + '</span>' : '—') + '</td>' +
      '<td class="sf-act">' + act + '</td></tr>';
  }

  function after() {
    load();
    if (typeof labelWideTables === 'function') labelWideTables();
  }

  /* ------------------------------------------------------------- dialogs */

  function areaSelect(id, sel) {
    var list = S.areas.filter(function (a) { return a.active !== false; });
    return '<select class="inp" id="' + id + '"><option value="">—</option>' + list.map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(OG.lang === 'ar' ? a.ar : a.en) + '</option>';
    }).join('') + '</select>';
  }
  function safeerSelect(id, sel) {
    return '<select class="inp" id="' + id + '"><option value="">' + t('sf_nobody_yet') + '</option>' +
      (S.team || []).filter(function (p) { return p.active; }).map(function (p) {
        return '<option value="' + p.id + '"' + (String(sel) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('') + '</select>';
  }

  function newErrand() {
    openModal({
      title: t('sf_new_errand'),
      body: '<label class="field"><span>' + t('sf_title') + '</span><input class="inp" id="sfeTitle" maxlength="120" placeholder="' + esc(t('sf_title_ph')) + '"></label>' +
        '<div class="row2"><label class="field"><span>' + t('sf_kind') + '</span><select class="inp" id="sfeKind">' +
          ['stock_run', 'supplier_pickup', 'bank', 'other'].map(function (k) { return '<option value="' + k + '">' + t('sf_k_' + k) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="field"><span>' + t('sf_from') + '</span><input class="inp" id="sfeFrom" maxlength="80"></label></div>' +
        '<div class="row2"><label class="field"><span>' + t('sf_area') + '</span>' + areaSelect('sfeArea') + '</label>' +
        '<label class="field"><span>' + t('sf_due') + '</span><input class="inp" type="date" id="sfeDue"></label></div>' +
        '<div class="row2"><label class="field"><span>' + t('sf_safeer') + '</span>' + safeerSelect('sfeWho') + '</label>' +
        '<label class="field"><span>' + t('sf_order') + '</span><input class="inp" id="sfeSale" dir="ltr" placeholder="INV-2140"></label></div>' +
        '<label class="field"><span>' + t('note') + '</span><textarea class="inp" id="sfeNotes" rows="2" maxlength="500"></textarea></label>' +
        '<p class="muted small">' + t('sf_errand_note') + '</p>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-sf="errand-save">' + t('save') + '</button>'
    });
  }

  function assignParcel() {
    var waiting = S.parcels.filter(function (d) { return d.status === 'waiting'; });
    openModal({
      title: t('sf_assign_parcel'),
      body: (waiting.length
        ? '<label class="field"><span>' + t('sf_parcel') + '</span><select class="inp" id="sfpParcel">' +
            waiting.map(function (d) {
              return '<option value="' + d.id + '">' + esc(d.saleId + ' · ' + (d.customerName || '') + ' · ' + (d.city || d.address || '')) +
                (d.driverName ? ' — ' + esc(d.driverName) : '') + '</option>';
            }).join('') + '</select></label>' +
          '<label class="field"><span>' + t('sf_safeer') + '</span>' + safeerSelect('sfpWho') + '</label>'
        : '<div class="cart-empty"><b>' + t('sf_no_waiting') + '</b>' + t('sf_no_waiting_sub') + '</div>'),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            (waiting.length ? '<button class="btn btn-primary" data-sf="parcel-save">' + t('save') + '</button>' : '')
    });
  }

  function failDialog(id, mine) {
    openModal({
      title: t('sf_mark_failed'),
      body: '<label class="field"><span>' + t('sf_why') + '</span><textarea class="inp" id="sfWhy" rows="3" maxlength="200"></textarea></label>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-sf="' + (mine ? 'my-fail-go' : 'errand-fail-go') + '" data-id="' + id + '">' + t('sf_mark_failed') + '</button>'
    });
    setTimeout(function () { var w = document.getElementById('sfWhy'); if (w) w.focus(); }, 60);
  }

  /* Writes: the button waits; only the server's yes says "saved". */
  function send(btn, req, ok, then) {
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    return req.then(function (r) {
      if (ok) toast(t('nav_safeers'), ok, 'ok', 2200);
      if (then) then(r);
    }, function (err) {
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
      toast(t('nav_safeers'), offline(err) ? t('sf_offline') : API.friendly(err), 'err', 6000);
    });
  }

  /* ------------------------------------------ the safeer's own phone view */

  function loadMine() {
    if (S.mineLoading) return;
    S.mineLoading = true;
    API.get('/api/errands?status=open').then(function (r) {
      S.mineLoading = false;
      S.mine = r.errands || [];
      if (r.areas) S.areas = r.areas;
      S.mineError = null;
      if (OG.view === 'dashboard' && roleOf() === 'delivery' && !document.querySelector('#modal-root .modal')) render();
    }, function (err) {
      S.mineLoading = false;
      S.mineError = err;
      if (OG.view === 'dashboard' && roleOf() === 'delivery') render();
    });
  }

  function myErrandsHtml() {
    var h = '<div class="sf-mine">';
    if (S.mineError) {
      h += '<div class="card sf-offline"><b>' + t(offline(S.mineError) ? 'sf_offline' : 'sf_failed') + '</b>' +
        '<button class="btn btn-sm" data-sf="mine-reload">' + t('retry') + '</button></div>';
    }
    if (S.mine === null) { if (!S.mineLoading) loadMine(); return h + '</div>'; }
    if (!S.mine.length) return h + '</div>';
    h += '<div class="rc-sheet"><b>' + t('sf_my_errands') + '</b><span>' + nf(S.mine.length) + '</span></div>';
    S.mine.forEach(function (e) {
      h += '<div class="card sf-card">' +
        '<div class="sf-card-head"><span class="badge neutral">' + t('sf_k_' + e.kind) + '</span>' + statusBadge(e.status) + '</div>' +
        '<b class="sf-card-title">' + esc(e.title) + '</b>' +
        (e.area ? '<div class="sf-card-area">' + t('sf_to') + ' <b>' + esc(areaName(e.area)) + '</b></div>' : '') +
        (e.from ? '<div class="muted">' + t('sf_from') + ': ' + esc(e.from) + '</div>' : '') +
        (e.notes ? '<p class="sf-card-notes">' + esc(e.notes) + '</p>' : '') +
        (e.dueDate ? '<small class="muted">' + t('sf_due') + ' <span dir="auto">' + fmtDate(ymdLocal(e.dueDate)) + '</span></small>' : '') +
        '<div class="sf-card-act">' +
          (e.status === 'waiting' ? '<button class="btn btn-lg btn-primary" data-sf="my-status" data-to="out" data-id="' + e.id + '">' + t('sf_go_out') + '</button>' : '') +
          (e.status === 'out' ? '<button class="btn btn-lg btn-primary" data-sf="my-status" data-to="done" data-id="' + e.id + '">' + t('sf_mark_done') + '</button>' : '') +
          '<button class="btn btn-lg" data-sf="my-fail" data-id="' + e.id + '">' + t('sf_mark_failed') + '</button>' +
        '</div></div>';
    });
    return h + '</div>';
  }

  /* -------------------------------------------------- settings: rate, areas */

  var SET = null;
  function settingsCard() {
    if (!allow('config.write')) return '';
    if (!SET) {
      SET = { loaded: false };
      API.get('/api/safeers?tz=' + tzMinutes()).then(function (r) {
        SET = { loaded: true, rate: r.rate || null, areas: r.areas || [] };
        if (OG.view === 'settings') { var v = document.querySelector('.view'); var y = v ? v.scrollTop : 0; render(); v = document.querySelector('.view'); if (v) v.scrollTop = y; }
      }, function () { SET = null; });
    }
    var meta = SET && SET.loaded && SET.rate ? '<bdi dir="ltr">' + fmt(SET.rate.amount, SET.rate.currency) + '</bdi> / ' + t('sf_per_delivery') : t('sf_no_rate');
    var h = setFoldStart('safeers', t('sf_settings'), meta) + '<div class="card-body">';
    if (!SET || !SET.loaded) return h + '<div class="muted small">…</div></div>' + setFoldEnd();
    var cur = SET.rate ? SET.rate.currency : 'SYP';
    var exp = cur === 'USD' ? 2 : 0;
    h += '<p class="muted small">' + t('sf_rate_note') + '</p>' +
      '<div class="row2"><label class="field"><span>' + t('sf_rate') + '</span><input class="inp num" id="sfRate" dir="ltr" value="' +
        (SET.rate ? (exp ? (SET.rate.amount / 100).toFixed(2) : SET.rate.amount) : '') + '"></label>' +
      '<label class="field"><span>' + t('currency') + '</span><select class="inp" id="sfRateCur">' +
        ['SYP', 'USD'].map(function (c) { return '<option' + (c === cur ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
      '</select></label></div>' +
      '<label class="field"><span>' + t('sf_areas') + '</span><textarea class="inp" id="sfAreas" rows="6" dir="auto">' +
        esc(SET.areas.map(function (a) { return a.en + ' | ' + a.ar + (a.active === false ? ' | off' : ''); }).join('\n')) +
      '</textarea><small class="muted">' + t('sf_areas_hint') + '</small></label>' +
      '<button class="btn btn-primary" data-sf="settings-save">' + t('save') + '</button>';
    return h + '</div>' + setFoldEnd();
  }

  /* -------------------------------------------------------------- events */

  document.addEventListener('change', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-sf-f');
    if (!f) return;
    S.filter[f] = e.target.value;
    load();
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-sf]') : null;
    /* A press anywhere but inside a card menu shuts it. */
    if (S.menu !== null && !(e.target.closest && e.target.closest('.dlb-more'))) { S.menu = null; repaint(); }
    if (!b) return;
    var a = b.getAttribute('data-sf');
    var id = +b.getAttribute('data-id');
    var v = function (x) { var el = document.getElementById(x); return el ? el.value.trim() : ''; };

    if (a === 'reload') { S.error = null; load(); return; }
    if (a === 'mine-reload') { S.mineError = null; S.mine = null; loadMine(); render(); return; }
    if (a === 'new-errand') { newErrand(); return; }
    if (a === 'assign-parcel') { assignParcel(); return; }
    if (a === 'filter-person') { S.filter.safeer = String(id); load(); return; }
    /* Drop every filter at once (quick fix) — the status one is on by
       default, so "show everything" has to be one press and not three. */
    if (a === 'filter-clear') { S.filter.safeer = ''; S.filter.status = ''; S.filter.date = ''; load(); return; }
    if (a === 'hide-once') { S.shown = null; repaint(); return; }

    if (a === 'errand-save') {
      var body = { title: v('sfeTitle'), kind: v('sfeKind'), from: v('sfeFrom') || null, area: v('sfeArea') || null,
                   dueDate: v('sfeDue') || null, safeerId: v('sfeWho') ? +v('sfeWho') : null,
                   saleId: v('sfeSale') || null, notes: v('sfeNotes') || null };
      if (!body.title) { toast(t('sf_new_errand'), t('err_title_required'), 'warn'); return; }
      send(b, API.post('/api/errands', body), t('sf_saved'), function () { closeModal(); load(); });
      return;
    }
    if (a === 'parcel-save') {
      var who = v('sfpWho');
      if (!who) { toast(t('sf_assign_parcel'), t('sf_pick_safeer'), 'warn'); return; }
      send(b, API.patch('/api/deliveries/' + v('sfpParcel'), { driverId: +who }), t('sf_saved'), function () { closeModal(); load(); });
      return;
    }
    if (a === 'errand-assign') {
      var er = S.errands.filter(function (x) { return x.id === id; })[0];
      openModal({
        title: t('dl_assign_btn') + ' · ' + esc(er ? er.title : ''),
        body: '<label class="field"><span>' + t('sf_safeer') + '</span>' + safeerSelect('sfaWho', er && er.safeerId) + '</label>' +
              '<label class="field"><span>' + t('sf_area') + '</span>' + areaSelect('sfaArea', er && er.area) + '</label>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-sf="errand-assign-go" data-id="' + id + '">' + t('save') + '</button>'
      });
      return;
    }
    if (a === 'errand-assign-go') {
      send(b, API.patch('/api/errands/' + id, { safeerId: v('sfaWho') ? +v('sfaWho') : null, area: v('sfaArea') || null }),
           t('sf_saved'), function () { closeModal(); load(); });
      return;
    }
    if (a === 'errand-status') {
      send(b, API.patch('/api/errands/' + id, { status: b.getAttribute('data-to') }), t('sf_saved'), function () { load(); });
      return;
    }
    if (a === 'errand-fail') { failDialog(id, false); return; }
    if (a === 'errand-fail-go' || a === 'my-fail-go') {
      var why = v('sfWhy');
      if (!why) { toast(t('sf_mark_failed'), t('err_reason_required'), 'warn'); return; }
      send(b, API.patch('/api/errands/' + id, { status: 'failed', reason: why }), t('sf_saved'), function () {
        closeModal();
        if (a === 'my-fail-go') { S.mine = null; loadMine(); } else load();
      });
      return;
    }
    if (a === 'my-status') {
      send(b, API.patch('/api/errands/' + id, { status: b.getAttribute('data-to') }), t('sf_saved'), function () { S.mine = null; loadMine(); });
      return;
    }
    if (a === 'my-fail') { failDialog(id, true); return; }

    if (a === 'add') {
      var body2 = { name: v('sfName'), phone: v('sfPhone') || null, username: v('sfUser') };
      if (!body2.name || !body2.username) { toast(t('sf_add'), t('ac_need_both'), 'warn'); return; }
      send(b, API.post('/api/safeers', body2), t('ac_added').replace('{name}', body2.name), function (r) {
        S.shown = { name: r.user.name, password: r.password };
        load();
      });
      return;
    }
    if (a === 'password') {
      var p = (S.team || []).filter(function (x) { return x.id === id; })[0];
      send(b, API.post('/api/safeers/' + id + '/password', {}), t('ac_pw_new'), function (r) {
        S.shown = { name: p ? p.name : '', password: r.password };
        repaint();
      });
      return;
    }
    /* The card's "…" (quick fix). One open at a time, and the OPEN ONE IS
       HELD IN STATE, not as a class on the node: this page repaints itself
       whenever a load lands or a live event arrives, and render() rebuilds
       the cards — a class put straight on the element was gone within half a
       second, which is exactly how it behaved when first written. */
    if (a === 'menu') {
      S.menu = (S.menu === id) ? null : id;
      repaint();
      return;
    }
    if (a === 'active') {
      var on = b.getAttribute('data-on') === '1';
      /* SWITCHING SOMEBODY OFF ENDS THEIR SESSIONS and takes the shop off
         their phone mid-round, so it asks first and NAMES WHAT THEY ARE
         STILL CARRYING (quick fix). Switching back on is harmless and does
         not ask. `open` is the count this page already shows on the card. */
      if (!on) {
        var who = (S.team || []).filter(function (x) { return x.id === id; })[0];
        var carrying = who ? Number(who.open) || 0 : 0;
        openModal({
          title: t('ac_switch_off'), size: 'narrow',
          body: '<p>' + t('sf_off_q').replace('{name}', esc(who ? who.name : '')) + '</p>' +
            (carrying
              ? '<div class="sf-off-warn">' + t('sf_off_open')
                  .replace('{n}', '<bdi dir="ltr">' + nf(carrying) + '</bdi>') + '</div>'
              : ''),
          foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
                '<button class="btn bk-danger" data-sf="active-go" data-id="' + id + '">' +
                  t('ac_switch_off') + '</button>'
        });
        return;
      }
      send(b, API.post('/api/safeers/' + id + '/active', { active: on }), t('ac_now_on'), function () { load(); });
      return;
    }
    if (a === 'active-go') {
      send(b, API.post('/api/safeers/' + id + '/active', { active: false }), t('ac_now_off'), function () {
        closeModal(); load();
      });
      return;
    }
    if (a === 'settings-save') {
      var cur2 = v('sfRateCur') || 'SYP';
      var raw = v('sfRate');
      var rate = null;
      if (raw !== '') {
        var n = (typeof Desk !== 'undefined' && Desk.toMinor) ? Desk.toMinor(raw, cur2) : Math.round(Number(raw) * (cur2 === 'USD' ? 100 : 1));
        if (!(n >= 0)) { toast(t('sf_settings'), t('err_bad_rate'), 'warn'); return; }
        rate = { amount: n, currency: cur2 };
      }
      var areas = v('sfAreas').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l, i) {
        var parts = l.split('|').map(function (x) { return x.trim(); });
        var old = SET && SET.areas && SET.areas[i];
        return { id: old && old.en === parts[0] ? old.id : undefined, en: parts[0], ar: parts[1] || parts[0], active: parts[2] !== 'off' };
      });
      send(b, API.put('/api/safeers/settings', { rate: rate, areas: areas }), t('sf_saved'), function (r) {
        SET = { loaded: true, rate: r.rate, areas: r.areas };
        var vv = document.querySelector('.view'); var y = vv ? vv.scrollTop : 0; render(); vv = document.querySelector('.view'); if (vv) vv.scrollTop = y;
      });
    }
  });

  return {
    view: view, after: after, load: load,
    myErrandsHtml: myErrandsHtml, loadMine: loadMine,
    /* What this screen last loaded, for the staff card's “what is this
       person still holding” sentence. Null when it has never been opened,
       which is a different answer from none. */
    errands: function () { return S.errands; },
    parcels: function () { return S.parcels; },
    settingsCard: settingsCard,
    live: function () {
      if (OG.view === 'safeers') load();
      if (OG.view === 'dashboard' && roleOf() === 'delivery') { S.mine = null; loadMine(); }
    }
  };
})();
