/* ==========================================================================
   STOCK COUNT — the shelf against the system                      [data-st]
   --------------------------------------------------------------------------
   The job he does on paper twice a year and dreads. Walk the shelf, scan
   each item, type what is actually there. The system holds what it THINKS is
   there, and the difference is the whole point.

   Two rules make this trustworthy rather than a spreadsheet:

   1. COUNTING NEVER CHANGES STOCK. A count is a separate record. Nothing
      moves until he presses Post, and then every adjustment is written
      through DB.logMovement like any other change, so the stock trail
      explains itself afterwards. A count that silently rewrote quantities
      would be impossible to audit and impossible to undo.

   2. UNCOUNTED IS NOT ZERO. A size he has not reached yet is blank, not 0.
      Treating "not counted" as "none present" would wipe the shelf on the
      first Post — the single most destructive thing this screen could do.
   ========================================================================== */

var Stock = (function () {

  var S = {
    active: null,      /* the open count session */
    filter: 'all',     /* all | counted | variance | uncounted */
    q: ''
  };

  /* A count belongs to ONE location. You cannot walk two rooms at once, and
     counting the shop floor against a system number that includes the back
     would report a variance on every single line. */
  function start(scope, whId) {
    S.active = {
      id: 'CNT-' + pad(DB.stockCounts.length + 1, 3),
      started: new Date(),
      scope: scope || 'all',
      whId: whId || DB.defaultWh,
      /* sku -> counted quantity. Absent means genuinely not counted yet. */
      counted: {},
      posted: false
    };
    S.filter = 'all';
    S.q = '';
    return S.active;
  }

  function active() { return S.active; }

  /* The system figure this count is being checked against — the chosen
     location's bucket, never the grand total. */
  function systemQty(v) {
    return S.active ? DB.stockAt(v, S.active.whId) : v.qty;
  }

  function rows() {
    if (!S.active) return [];
    var list = DB.variants.slice();

    if (S.q) {
      var q = S.q.toLowerCase();
      list = list.filter(function (v) {
        var p = DB.product(v.productId);
        return v.sku.toLowerCase().indexOf(q) > -1 ||
               v.barcode.indexOf(q) > -1 ||
               (p && p.name.toLowerCase().indexOf(q) > -1);
      });
    }

    var out = list.map(function (v) {
      var has = Object.prototype.hasOwnProperty.call(S.active.counted, v.sku);
      var c = has ? S.active.counted[v.sku] : null;
      var sys = systemQty(v);
      return {
        v: v, p: DB.product(v.productId),
        system: sys, counted: c, has: has,
        diff: has ? c - sys : 0
      };
    });

    if (S.filter === 'counted')   out = out.filter(function (r) { return r.has; });
    if (S.filter === 'uncounted') out = out.filter(function (r) { return !r.has; });
    if (S.filter === 'variance')  out = out.filter(function (r) { return r.has && r.diff !== 0; });

    /* Variance first — that is what he is looking for. */
    return out.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  }

  function totals() {
    if (!S.active) return { counted: 0, total: DB.variants.length, variance: 0, pieces: 0, value: 0 };
    var counted = 0, variance = 0, pieces = 0, value = 0;
    DB.variants.forEach(function (v) {
      if (!Object.prototype.hasOwnProperty.call(S.active.counted, v.sku)) return;
      counted++;
      var d = S.active.counted[v.sku] - systemQty(v);
      if (d !== 0) { variance++; pieces += d; value += d * (DB.product(v.productId) || {}).costPrice || 0; }
    });
    return { counted: counted, total: DB.variants.length, variance: variance, pieces: pieces, value: value };
  }

  function set(sku, qty) {
    if (!S.active) return;
    var n = parseInt(qty, 10);
    if (qty === '' || qty === null || isNaN(n) || n < 0) {
      /* Clearing the box means "not counted", which is deliberately different
         from counting zero. */
      delete S.active.counted[sku];
      return;
    }
    S.active.counted[sku] = n;
  }

  /* A scan during a count increments what is in front of him rather than
     opening a product sheet — he is holding the item, not researching it. */
  function scanned(raw) {
    if (!S.active) return false;
    var v = DB.variantByBarcode(String(raw).trim()) || DB.variantBySku(String(raw).trim());
    if (!v) { toast(t('st_count'), t('sc_unknown'), 'err'); return false; }
    var cur = Object.prototype.hasOwnProperty.call(S.active.counted, v.sku) ? S.active.counted[v.sku] : 0;
    S.active.counted[v.sku] = cur + 1;
    var p = DB.product(v.productId);
    toast(p.name + ' · ' + v.size, t('st_now_counted') + ' ' + (cur + 1), 'ok', 1400);
    render();
    return true;
  }

  /* Writes the count into stock. Only sizes that were actually counted AND
     differ are touched; everything else is left exactly as it was. */
  /* `then` is called with the summary once the count is genuinely posted —
      after the server has taken every adjustment, in live mode. A count is the
      one write here that is many writes, so it cannot go through Shop.write's
      one-at-a-time gate line by line: they are sent together and the data is
      re-read once at the end. */
  function post(then) {
    if (!S.active || S.active.posted) return;
    var now = new Date();
    var applied = 0, pieces = 0;
    var whId = S.active.whId;
    var adjust = [];

    Object.keys(S.active.counted).forEach(function (sku) {
      var v = DB.variantBySku(sku);
      if (!v) return;
      var c = S.active.counted[sku];
      var diff = c - DB.stockAt(v, whId);
      if (diff === 0) return;

      applied++;
      pieces += diff;
      adjust.push({ v: v, counted: c, diff: diff });
    });

    var note = t('st_adjust_note') + ' ' + S.active.id;

    /* Adjusts only the counted location. The other one is untouched — it was
       not walked, so nothing about it was learned. A shortfall is a loss and a
       surplus is a find; using the existing movement types keeps this in the
       same audit trail as everything else. */
    function mirror() {
      adjust.forEach(function (a) {
        DB.setStockAt(a.v, whId, a.counted, {
          date: now,
          type: a.diff < 0 ? 'damaged' : 'received',
          note: note,
          user: 'Maher Odeh'
        });
      });
    }

    function finish() {
      S.active.posted = true;
      S.active.finished = now;
      S.active.applied = applied;
      S.active.pieces = pieces;
      DB.stockCounts.unshift(S.active);

      var done = S.active;
      S.active = null;
      if (then) then({ count: done, applied: applied, pieces: pieces });
    }

    if (!adjust.length) { mirror(); finish(); return; }

    Shop.write(
      function () {
        /* Every adjustment, then one re-read. The server records each as the
           DIFFERENCE it found rather than the number sent, so a shortfall in
           March is still explainable in June. */
        return Promise.all(adjust.map(function (a) {
          return Shop.count(a.v.sku, whId, a.counted, note);
        }));
      },
      mirror,
      finish
    );
  }

  function cancel() { S.active = null; }

  /* ---------------------------------------------------------------- view */

  function view() {
    if (!S.active) return intro();

    var tt = totals();
    var pct2 = Math.round(tt.counted / tt.total * 100);

    var h = '<div class="page-head"><div><h1>' + t('st_count') + ' — ' +
        esc(DB.whName(S.active.whId, OG.lang === 'ar')) + '</h1>' +
      '<div class="sub">' + S.active.id + ' · ' + t('st_started') + ' ' + fmtDateTime(S.active.started) + '</div></div>' +
      '<div class="head-actions">' +
        '<button class="btn btn-ghost" data-st="cancel">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-st="post"' + (tt.counted ? '' : ' disabled') + '>' +
          t('st_post') + '</button>' +
      '</div></div>';

    h += '<div class="grid stat-row mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('st_progress') + '</span>' +
        '<div class="val">' + tt.counted + '<span class="cur">/ ' + tt.total + '</span></div>' +
        '<div class="bar-track mt" style="height:6px"><i class="lime" style="width:' + pct2 + '%"></i></div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('st_variance') + '</span>' +
        '<div class="val' + (tt.variance ? ' warn' : '') + '">' + tt.variance + '</div>' +
        '<div class="foot">' + t('st_sizes_differ') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('st_net_pieces') + '</span>' +
        '<div class="val' + (tt.pieces < 0 ? ' warn' : '') + '">' +
          (tt.pieces > 0 ? '+' : '') + tt.pieces + '</div>' +
        '<div class="foot">' + t('st_vs_system') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('st_value') + '</span>' +
        '<div class="val">' + moneyStat(tt.value) + '</div>' +
        '<div class="foot">' + t('st_at_cost') + '</div></div>' +
    '</div>';

    h += '<div class="filters"><div class="chip-row">' +
      ['all', 'variance', 'counted', 'uncounted'].map(function (f) {
        return '<button class="chip ' + (S.filter === f ? 'on' : '') + '" data-st="filter" data-f="' + f + '">' +
               t('st_f_' + f) + '</button>';
      }).join('') +
      '</div>' +
      '<input class="inp grow" type="text" placeholder="' + esc(t('st_find')) + '" ' +
        'value="' + esc(S.q) + '" data-change="st-q">' +
      '<button class="btn btn-primary" data-st="scan">' + t('sc_title') + '</button>' +
    '</div>';

    var list = rows();
    h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th><th>' + t('shelf') + '</th>' +
      '<th class="num">' + t('st_system') + '</th><th class="num">' + t('st_counted') + '</th>' +
      '<th class="num">' + t('st_diff') + '</th>' +
    '</tr></thead><tbody>';

    list.slice(0, 120).forEach(function (r) {
      var cls = !r.has ? '' : r.diff === 0 ? 'st-ok' : r.diff < 0 ? 'st-short' : 'st-over';
      h += '<tr class="' + cls + '">' +
        '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
          '<small class="num">' + esc(r.v.sku) + '</small></span></div></td>' +
        '<td><b>' + r.v.size + '</b></td>' +
        '<td class="muted">' + esc(r.v.shelf) + '</td>' +
        '<td class="num muted">' + r.system + '</td>' +
        '<td class="num"><input class="inp num st-in" type="number" min="0" ' +
          'value="' + (r.has ? r.counted : '') + '" placeholder="—" ' +
          'data-change="st-set" data-sku="' + esc(r.v.sku) + '"></td>' +
        '<td class="num">' + (r.has
          ? '<b class="' + (r.diff === 0 ? 'muted' : r.diff < 0 ? 'st-neg' : 'st-pos') + '">' +
              (r.diff > 0 ? '+' : '') + r.diff + '</b>'
          : '<span class="muted">—</span>') + '</td>' +
      '</tr>';
    });

    h += '</tbody></table></div>';
    if (list.length > 120) {
      h += '<div class="partner-note mt">' + t('st_showing').replace('{n}', 120)
             .replace('{t}', list.length) + '</div>';
    }
    return h;
  }

  function intro() {
    var last = DB.stockCounts[0];
    var h = '<div class="page-head"><div><h1>' + t('st_count') + '</h1>' +
      '<div class="sub">' + t('st_intro_sub') + '</div></div></div>';

    h += '<div class="card"><div class="card-body" style="text-align:center;padding:38px 24px">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square" ' +
        'style="width:44px;height:44px;fill:none;stroke:var(--brand);stroke-width:1.4;margin-bottom:14px">' +
        '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 12h10M7 9h10M7 15h6"/></svg>' +
      '<h3 style="font-size:18px;margin-bottom:8px">' + t('st_ready') + '</h3>' +
      '<p class="muted" style="max-width:440px;margin:0 auto 20px;font-size:13px;line-height:1.6">' +
        t('st_ready_sub') + '</p>' +
      /* One button per location instead of a single Begin. Which room you are
         standing in is the first decision of a count, not a setting to find
         afterwards. */
      '<div class="lbl" style="text-align:center">' + t('wh_count_where') + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px">' +
        DB.warehouses.map(function (w) {
          return '<button class="btn btn-primary btn-lg" data-st="start" data-w="' + w.id + '">' +
            esc(DB.whName(w.id, OG.lang === 'ar')) + '</button>';
        }).join('') +
      '</div>' +
    '</div></div>';

    if (last) {
      h += '<div class="card mt"><div class="card-head"><h3>' + t('st_last') + '</h3></div>' +
        '<div class="card-body">' +
          '<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
            '<div class="stat"><span class="eyebrow">' + t('date') + '</span>' +
              '<div class="val" style="font-size:16px">' + fmtDate(last.finished) + '</div></div>' +
            '<div class="stat"><span class="eyebrow">' + t('st_adjusted') + '</span>' +
              '<div class="val">' + last.applied + '</div></div>' +
            '<div class="stat"><span class="eyebrow">' + t('st_net_pieces') + '</span>' +
              '<div class="val' + (last.pieces < 0 ? ' warn' : '') + '">' +
                (last.pieces > 0 ? '+' : '') + last.pieces + '</div></div>' +
          '</div></div></div>';
    }
    return h;
  }

  /* --------------------------------------------------------------- acts */

  var ACT = {
    start: function (el) {
      start('all', (el && el.getAttribute('data-w')) || DB.defaultWh);
      render();
    },
    cancel: function () {
      var tt = totals();
      if (tt.counted) {
        openModal({
          title: t('st_discard_title'), size: 'narrow',
          body: '<div class="partner-note">' + t('st_discard_body').replace('{n}', tt.counted) + '</div>',
          foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
                '<button class="btn bk-danger" data-st="cancel-yes">' + t('st_discard') + '</button>'
        });
        return;
      }
      cancel(); render();
    },
    'cancel-yes': function () { cancel(); closeModal(); render(); },
    filter: function (el) { S.filter = el.getAttribute('data-f'); render(); },
    scan: function () {
      /* Continuous: he is walking a shelf, not scanning one thing. */
      Scan.open({
        title: t('st_count'), continuous: true,
        onHit: function (code) { scanned(code); }
      });
    },
    post: function () {
      var tt = totals();
      openModal({
        title: t('st_post'), size: 'narrow',
        body: '<div class="alert-row"><span class="alert-ico ' + (tt.variance ? 'amber' : 'grey') + '">' +
                tt.variance + '</span>' +
              '<span class="alert-txt"><b>' + t('st_post_q').replace('{n}', tt.variance) + '</b>' +
                '<small>' + t('st_post_sub')
                  .replace('{p}', (tt.pieces > 0 ? '+' : '') + tt.pieces)
                  .replace('{v}', money(tt.value)) + '</small></span></div>' +
              '<div class="partner-note mt">' + t('st_post_note') + '</div>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-st="post-yes">' + t('st_post') + '</button>'
      });
    },
    'post-yes': function () {
      closeModal();
      post(function (res) {
        render();
        toast(res.count.id, t('st_posted')
          .replace('{n}', res.applied)
          .replace('{p}', (res.pieces > 0 ? '+' : '') + res.pieces), 'ok', 5000);
      });
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-st]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-st')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
  }
  bind();

  /* Export the variance sheet — the document he signs off. */
  function exportSpec() {
    var list = rows();
    var tt = totals();
    return {
      name: 'stock-count', sheet: 'Count',
      title: t('st_count'),
      subtitle: (S.active ? S.active.id : '') + ' · ' + fmtDate(TODAY),
      columns: [{ label: t('product'), width: 32 }, { label: t('size') }, { label: t('sku') },
                { label: t('shelf') }, { label: t('st_system'), num: true },
                { label: t('st_counted'), num: true }, { label: t('st_diff'), num: true }],
      rows: list.map(function (r) {
        return [r.p.name, r.v.size, r.v.sku, r.v.shelf, r.system,
                r.has ? r.counted : '—', r.has ? r.diff : '—'];
      }),
      totals: [t('total'), null, null, null, null, tt.counted, tt.pieces],
      kpis: [{ label: t('st_progress'), value: tt.counted + ' / ' + tt.total },
             { label: t('st_variance'), value: String(tt.variance) },
             { label: t('st_value'), value: money(tt.value) }]
    };
  }

  return {
    view: view, start: start, active: active, set: set, post: post,
    cancel: cancel, scanned: scanned, totals: totals, rows: rows,
    exportSpec: exportSpec, state: S
  };
})();
