/* ==========================================================================
   COMMAND PALETTE — Ctrl+K                                        [data-cp]
   --------------------------------------------------------------------------
   One box over everything: products, customers, invoices, print jobs, and the
   actions themselves. Type three letters, press Enter.

   This is the "make the work easier" feature in its purest form — it removes
   navigation entirely. Instead of Products → search → filter → click, it is
   Ctrl+K, "af1", Enter.

   Two design decisions worth stating:

   COMMANDS RANK ABOVE RECORDS. Typing "sale" should offer "New sale" before
   it offers a customer called Salem. Someone reaching for the palette is
   usually trying to DO something, not look something up.

   SCORING, NOT FILTERING. A plain indexOf match puts "Nike Air Max" and
   "Air Force" in arbitrary order for "air". Matches at the start of a word
   score higher than matches in the middle, so the obvious answer is first
   and Enter is safe to press without reading the list.
   ========================================================================== */

var Palette = (function () {

  var S = { open: false, q: '', sel: 0, items: [] };
  var MAX = 9;

  /* ------------------------------------------------------------ commands */

  function commands() {
    var c = [
      { icon: '⌁', label: t('cp_new_sale'), hint: t('nav_pos'),
        run: function () { go('pos'); } },
      { icon: '⛶', label: t('sc_title'), hint: t('cp_scan_hint'),
        run: function () { Scan.open({ onHit: function (code) { handleScan(code); } }); } },
      { icon: '＋', label: t('cp_add_product'), hint: t('nav_warehouse'),
        run: function () { OG.wh.tab = 'add'; go('warehouse'); } },
      { icon: '☑', label: t('st_count'), hint: t('nav_warehouse'),
        run: function () { OG.wh.tab = 'count'; go('warehouse'); } },
      { icon: '⇄', label: t('po_title'), hint: t('nav_warehouse'),
        run: function () { OG.wh.tab = 'po'; go('warehouse'); } },
      { icon: '✉', label: t('wa_send_day'), hint: t('nav_dashboard'),
        run: function () { openDaySummary(); } },
      { icon: '⇥', label: t('partner_view'), hint: CONFIG.PRINT_PARTNER,
        run: function () { ACTIONS['partner-view'](); } },
      { icon: 'ع', label: t('cp_toggle_lang'), hint: OG.lang === 'ar' ? 'English' : 'العربية',
        run: function () { ACTIONS.lang({ getAttribute: function () { return OG.lang === 'ar' ? 'en' : 'ar'; } }); } },
      { icon: '$', label: t('cp_toggle_curr'), hint: OG.currency === 'SYP' ? 'USD' : 'SYP',
        run: function () { ACTIONS.curr({ getAttribute: function () { return OG.currency === 'SYP' ? 'USD' : 'SYP'; } }); } }
    ];

    /* Every screen is reachable by name too. */
    NAV.forEach(function (n) {
      c.push({ icon: '›', label: t(n.key), hint: t('cp_go_to'),
               run: function () { go(n.id); } });
    });
    return c;
  }

  /* ------------------------------------------------------------- scoring
     Higher is better. Word-start beats mid-word, which beats a scattered
     subsequence — so "af1" finds "Air Force 1" and "nik" ranks Nike first. */
  function score(text, q) {
    if (!q) return 1;
    var s = String(text).toLowerCase();
    var i = s.indexOf(q);
    if (i === 0) return 100;
    if (i > 0) return (/[\s\-·/]/.test(s[i - 1]) ? 70 : 40) - Math.min(20, i);

    /* subsequence, e.g. "af1" in "air force 1" */
    var qi = 0;
    for (var k = 0; k < s.length && qi < q.length; k++) if (s[k] === q[qi]) qi++;
    return qi === q.length ? 12 : 0;
  }

  function build(q) {
    q = String(q || '').trim().toLowerCase();
    var out = [];

    commands().forEach(function (c) {
      var sc = score(c.label, q);
      if (sc > 0) out.push({ kind: 'cmd', score: sc + 25, icon: c.icon, title: c.label,
                             sub: c.hint, run: c.run });
    });

    if (q.length >= 2) {
      DB.products.forEach(function (p) {
        var sc = Math.max(score(p.name, q), score(p.brand, q) - 10);
        if (sc > 0) out.push({
          kind: 'product', score: sc, icon: null, thumb: p,
          title: p.name, sub: DB.typeLabels[p.type] + ' · ' + DB.totalQty(p.id) + ' ' + t('pieces'),
          run: function () { go('products', function () { openProductDrawer(p.id); }); }
        });
      });

      DB.customers.forEach(function (c) {
        var sc = Math.max(score(c.name, q), score(c.phone.replace(/\s/g, ''), q));
        if (sc > 0) out.push({
          kind: 'customer', score: sc - 4, icon: '☺',
          /* nfOrDash: a delivery driver's rows carry no points balance, and
             "0 points" is a claim the server never made. */
          title: c.name, sub: c.city + ' · ' + nfOrDash(c.loyaltyPoints) + ' ' + t('points'),
          run: function () { go('customers', function () { openCustomerDrawer(c.id); }); }
        });
      });

      DB.sales.slice(0, 60).forEach(function (s) {
        var sc = score(s.id, q);
        if (sc > 0) out.push({
          kind: 'invoice', score: sc - 6, icon: '▤',
          title: s.id, sub: s.customerName + ' · ' + money(s.total),
          run: function () { openInvoice(s); }
        });
      });

      DB.printJobs.forEach(function (j) {
        var sc = Math.max(score(j.id, q), score(j.design, q) - 12);
        if (sc > 0) out.push({
          kind: 'job', score: sc - 8, icon: '⎙',
          title: j.id, sub: j.customer + ' · ' + t('print_' + j.stage),
          run: function () { go('print', function () { openJobDrawer(j.id); }); }
        });
      });
    }

    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, MAX);
  }

  /* ---------------------------------------------------------------- view */

  function open() {
    if (S.open) return;
    S.open = true; S.q = ''; S.sel = 0;

    var root = document.getElementById('palette-root');
    if (!root) return;
    root.innerHTML =
      '<div class="cp-back" data-cp="close">' +
        '<div class="cp" role="dialog" aria-label="' + esc(t('cp_title')) + '">' +
          '<div class="cp-head">' +
            '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
              '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
            '<input id="cpInput" type="text" autocomplete="off" spellcheck="false" ' +
              'placeholder="' + esc(t('cp_placeholder')) + '">' +
            '<span class="keycap">esc</span>' +
          '</div>' +
          '<div class="cp-list" id="cpList"></div>' +
        '</div>' +
      '</div>';

    paint();
    var input = document.getElementById('cpInput');
    if (input) {
      input.addEventListener('input', function () { S.q = input.value; S.sel = 0; paint(); });
      /* rAF so the element is laid out before focus — otherwise the caret
         lands but the on-screen keyboard does not open on a phone. */
      requestAnimationFrame(function () { input.focus(); });
    }
  }

  function close() {
    S.open = false;
    var root = document.getElementById('palette-root');
    if (root) root.innerHTML = '';
  }

  function paint() {
    S.items = build(S.q);
    var list = document.getElementById('cpList');
    if (!list) return;

    if (!S.items.length) {
      list.innerHTML = '<div class="cp-empty">' + t('no_results') + '</div>';
      return;
    }

    list.innerHTML = S.items.map(function (it, i) {
      var left = it.thumb ? thumb(it.thumb)
               : '<span class="cp-ico">' + (it.icon || '›') + '</span>';
      return '<button class="cp-row' + (i === S.sel ? ' on' : '') + '" data-cp="run" data-i="' + i + '">' +
        left +
        '<span class="cp-txt"><b>' + esc(it.title) + '</b><small>' + esc(it.sub) + '</small></span>' +
        '<span class="cp-kind">' + t('cp_' + it.kind) + '</span>' +
      '</button>';
    }).join('');
  }

  function move(d) {
    if (!S.items.length) return;
    S.sel = (S.sel + d + S.items.length) % S.items.length;
    paint();
    var el = document.querySelector('.cp-row.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    var it = S.items[i === undefined ? S.sel : i];
    if (!it) return;
    close();
    try { it.run(); } catch (e) { console.warn('palette', e); }
  }

  /* --------------------------------------------------------------- keys */

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('keydown', function (e) {
      /* Ctrl+K / Cmd+K opens from anywhere. */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        S.open ? close() : open();
        return;
      }
      if (!S.open) return;

      if (e.key === 'Escape')    { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); return; }
      if (e.key === 'Enter')     { e.preventDefault(); run(); return; }
    }, true);

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-cp]') : null;
      if (!el) return;
      var a = el.getAttribute('data-cp');
      if (a === 'close' && el === e.target) { close(); return; }   /* backdrop only */
      if (a === 'run') { e.preventDefault(); run(+el.getAttribute('data-i')); }
    });
  }
  bind();

  return { open: open, close: close, build: build, score: score,
           isOpen: function () { return S.open; }, state: S };
})();
