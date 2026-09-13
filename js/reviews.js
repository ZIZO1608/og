/* ==========================================================================
   OG SYSTEM — the Reviews page                                    [Reviews]
   --------------------------------------------------------------------------
   What customers said when their delivery arrived. They write it on their own
   tracking page (/i/<token>, server/lib/reviews.js); the office reads it here:
   the average and the spread for the whole shop, what they liked, and every
   review as a card with its order, its carrier and the website switch.

   TWO SWITCHES, BOTH REQUIRED (migration 049). A card whose customer did not
   allow it says so and has no switch; a card that may go up has one, and only
   a manager (config.write) can press it — the server refuses the rest.

   THE SUMMARY IS THE SHOP'S, NOT THE LIST'S. It comes from the server beside
   the rows and does not move when a filter does — the tiles rule.

   Typing in the search box repaints only #rvwList, never the whole screen, so
   the caret stays where it is.
   ========================================================================== */

var Reviews = (function () {

  var rows = [];
  var cap = { shown: 0, total: 0, capped: false };
  var summary = null;
  var loaded = false;
  var failed = null;
  var busy = {};
  var F = { stars: '', show: '', q: '' };
  var qTimer = null;

  var TAGS = ['fast', 'driver', 'packed', 'described', 'quality', 'again'];
  var ICON = {
    star:    'M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z',
    refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
    globe:   'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    lock:    'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    search:  'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M16 16l5 5'
  };

  function svg(path, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }
  function stars(n, size) {
    var h = '<span class="rvw-stars' + (size ? ' is-' + size : '') + '" role="img" aria-label="' + n + '/5">';
    for (var i = 1; i <= 5; i++) h += svg(ICON.star, i <= n ? 'on' : '');
    return h + '</span>';
  }
  function when(iso) {
    var d = new Date(iso || '');
    return isNaN(d) ? '' : fmtDateTime(d);
  }

  /* ------------------------------------------------------------- loading */

  function query() {
    var p = ['limit=200'];
    if (F.stars) p.push('stars=' + encodeURIComponent(F.stars));
    if (F.show) p.push('show=' + encodeURIComponent(F.show));
    if (F.q) p.push('q=' + encodeURIComponent(F.q));
    return '/api/reviews?' + p.join('&');
  }

  function load(listOnly) {
    return API.get(query()).then(function (r) {
      rows = r.rows || [];
      cap = { shown: r.shown || 0, total: r.total || 0, capped: !!r.capped };
      summary = r.summary || null;
      loaded = true;
      failed = null;
      paint(listOnly);
    }).catch(function (e) {
      failed = API.friendly(e);
      loaded = true;
      paint();
    });
  }

  function paint(listOnly) {
    if (OG.view !== 'reviews') return;
    if (listOnly) {
      var list = document.getElementById('rvwList');
      if (list) { list.innerHTML = listHtml(); return; }
    }
    var host = document.getElementById('view');
    if (host) host.innerHTML = view();
  }

  /* ---------------------------------------------------------------- view */

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('rv_title') + '</h1>' +
      '<div class="sub">' + t('rv_sub') + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-ghost btn-sm rvw-refresh" data-act="rv-reload" title="' +
        esc(t('rv_refresh')) + '" aria-label="' + esc(t('rv_refresh')) + '">' + svg(ICON.refresh) + '</button></div></div>';
    if (failed) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="rv-reload">' + t('retry') + '</button></div></div>';
    }
    if (!loaded) return head + '<div class="rvw-skel" aria-busy="true"><i></i><i></i><i></i></div>';
    return head + summaryHtml() + toolbarHtml() + '<div id="rvwList">' + listHtml() + '</div>';
  }

  function summaryHtml() {
    var s = summary || { count: 0, average: null, distribution: [0, 0, 0, 0, 0], tags: {}, onWeb: 0, allowed: 0, delivered: 0 };
    var dist = s.distribution || [0, 0, 0, 0, 0];
    var max = Math.max.apply(null, dist.concat([1]));
    var bars = '';
    for (var n = 5; n >= 1; n--) {
      var c = dist[n - 1] || 0;
      bars += '<button type="button" class="rvw-bar' + (F.stars === String(n) ? ' on' : '') + '" data-act="rv-stars" data-val="' + n + '">' +
        '<span class="rvw-bar-n">' + n + svg(ICON.star) + '</span>' +
        '<span class="rvw-bar-t"><i style="width:' + Math.round(c / max * 100) + '%"></i></span>' +
        '<span class="rvw-bar-c">' + nf(c) + '</span></button>';
    }
    var liked = TAGS.map(function (k) { return { k: k, n: (s.tags || {})[k] || 0 }; })
      .sort(function (a, b) { return b.n - a.n; })
      .map(function (x) {
        return '<span class="rvw-tagc' + (x.n ? '' : ' is-zero') + '">' + t('rv_tag_' + x.k) + '<b>' + nf(x.n) + '</b></span>';
      }).join('');
    var share = s.delivered ? Math.round(s.count / s.delivered * 100) : 0;

    return '<div class="rvw-sum">' +
      '<div class="card rvw-hero">' +
        '<div class="rvw-avg"><b class="num">' + (s.average != null ? Number(s.average).toFixed(1) : '—') + '</b>' +
          stars(Math.round(s.average || 0), 'lg') + '</div>' +
        '<div class="rvw-meta"><span>' + t('rv_n_reviews').replace('{n}', nf(s.count)) + '</span>' +
          (s.delivered ? '<span>' + t('rv_share').replace('{p}', nf(share)).replace('{n}', nf(s.delivered)) + '</span>' : '') +
        '</div></div>' +
      '<div class="card rvw-dist">' + bars + '</div>' +
      '<div class="card rvw-side"><div class="rvw-side-h">' + t('rv_tags_h') + '</div>' +
        '<div class="rvw-tagcs">' + liked + '</div>' +
        '<div class="rvw-web"><span>' + svg(ICON.globe) + t('rv_on_web_n').replace('{n}', nf(s.onWeb)) + '</span>' +
          '<small>' + t('rv_allowed_n').replace('{n}', nf(s.allowed)) + '</small></div></div>' +
    '</div>';
  }

  function toolbarHtml() {
    function seg(list, cur, act) {
      return '<div class="rvw-seg" role="group">' + list.map(function (o) {
        return '<button type="button" class="' + (cur === o[0] ? 'on' : '') + '" data-act="' + act + '" data-val="' + o[0] + '">' +
          (o[1].indexOf('rv_') === 0 ? t(o[1]) : o[1]) + '</button>';
      }).join('') + '</div>';
    }
    return '<div class="rvw-bar-row">' +
      seg([['', 'rv_f_all'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['low', 'rv_f_low']], F.stars, 'rv-stars') +
      seg([['', 'rv_s_all'], ['comment', 'rv_s_comment'], ['allowed', 'rv_s_allowed'], ['web', 'rv_s_web']], F.show, 'rv-show') +
      '<label class="rvw-search">' + svg(ICON.search) +
        '<input class="inp" type="search" data-change="rv-q" value="' + esc(F.q) + '" placeholder="' + esc(t('rv_search_ph')) + '"></label>' +
    '</div>';
  }

  function listHtml() {
    if (!rows.length) {
      var any = !!(summary && summary.count);
      return '<div class="card rvw-empty">' + svg(ICON.star) +
        '<b>' + t(any ? 'rv_none_match' : 'rv_none') + '</b>' +
        '<span>' + t(any ? 'rv_none_match_sub' : 'rv_none_sub') + '</span></div>';
    }
    return '<div class="rvw-grid">' + rows.map(cardHtml).join('') + '</div>' +
      (typeof cappedNote === 'function' ? cappedNote(cap, t('rv_noun')) : '');
  }

  function cardHtml(r) {
    var face = (typeof Desk !== 'undefined' && Desk.face) ? Desk.face(r.customerId || 0, r.customerName || r.showName || '?') : '';
    var tags = (r.tags || []).map(function (k) { return '<span class="rvw-tag">' + t('rv_tag_' + k) + '</span>'; }).join('');
    var via = r.companyName ? esc(r.companyName) : r.driverName ? esc(r.driverName) : (r.method ? t('dk_m_' + r.method) : '');
    var icon = (r.method && typeof Desk !== 'undefined' && Desk.methodIcon) ? '<span class="rvw-mi">' + Desk.methodIcon(r.method) + '</span>' : '';

    var web;
    if (!r.allowWeb) {
      web = '<div class="rvw-webrow is-no">' + svg(ICON.lock) + '<span>' + t('rv_no_permission') + '</span></div>';
    } else {
      var off = !!busy[r.saleId] || !allow('config.write');
      web = '<label class="rvw-webrow' + (r.onWeb ? ' is-on' : '') + (off ? ' is-locked' : '') + '">' +
        '<span class="switch"><input type="checkbox" data-change="rv-web" data-id="' + esc(r.saleId) + '"' +
          (r.onWeb ? ' checked' : '') + (off ? ' disabled' : '') + '><i></i></span>' +
        '<span><b>' + t(r.onWeb ? 'rv_web_on' : 'rv_web_off') + '</b><small>' +
          (r.onWeb && r.webAt
            ? t('rv_web_since').replace('{d}', esc(when(r.webAt))) + (r.webByName ? ' · ' + esc(r.webByName) : '')
            : t('rv_web_as').replace('{name}', esc(r.showName || '—'))) +
        '</small></span></label>';
    }

    return '<article class="card rvw-card rating-' + r.rating + (r.voided ? ' is-void' : '') + '">' +
      '<header class="rvw-c-top">' + face +
        '<div class="rvw-c-who"><b>' + esc(r.customerName || r.showName || '—') + '</b>' +
          '<small><button type="button" class="rvw-link" data-act="rv-order" data-id="' + esc(r.saleId) + '">' +
            '<bdi dir="ltr">' + esc(r.saleId) + '</bdi></button> · <span dir="auto">' + esc(when(r.updatedAt)) + '</span></small></div>' +
        stars(r.rating) + '</header>' +
      (tags ? '<div class="rvw-tags">' + tags + '</div>' : '') +
      (r.comment
        ? '<blockquote class="rvw-quote" dir="auto">' + esc(r.comment) + '</blockquote>'
        : '<p class="rvw-noquote">' + t('rv_no_words') + '</p>') +
      '<div class="rvw-c-meta">' + icon + '<span>' + [r.city ? esc(r.city) : '', via].filter(Boolean).join(' · ') + '</span>' +
        (r.updatedAt && r.at && r.updatedAt !== r.at ? '<em>' + t('rv_edited') + '</em>' : '') + '</div>' +
      web +
    '</article>';
  }

  /* ------------------------------------------------------------- actions */

  function setWeb(id, on, el) {
    busy[id] = true;
    API.patch('/api/reviews/' + encodeURIComponent(id), { onWeb: !!on }).then(function () {
      delete busy[id];
      toast(t('rv_title'), t(on ? 'rv_web_turned_on' : 'rv_web_turned_off'), 'ok', 3000);
      load();
    }).catch(function (e) {
      delete busy[id];
      if (el) el.checked = !on;
      toast(t('rv_title'), e && e.code === 'no_permission' ? t('rv_no_permission') : API.friendly(e), 'err', 7000);
    });
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['rv-reload'] = function () { loaded = false; failed = null; paint(); load(); };
    /* A lit star filter pressed again (a distribution bar, or its chip) clears. */
    ACTIONS['rv-stars'] = function (el) {
      var v = el.getAttribute('data-val') || '';
      F.stars = (v && F.stars === v) ? '' : v;
      paint();
      load();
    };
    ACTIONS['rv-show'] = function (el) { F.show = el.getAttribute('data-val') || ''; paint(); load(); };
    ACTIONS['rv-order'] = function (el) {
      if (typeof Desk !== 'undefined' && Desk.openOrder) Desk.openOrder(el.getAttribute('data-id'));
    };
    if (typeof CHANGES !== 'undefined') {
      CHANGES['rv-q'] = function (el) {
        F.q = el.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(function () { load(true); }, 280);
      };
      CHANGES['rv-web'] = function (el) { setWeb(el.getAttribute('data-id'), el.checked, el); };
    }
  }

  function after() { load(); }

  return { view: view, after: after, register: register, load: load };
})();
