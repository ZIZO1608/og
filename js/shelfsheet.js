/* ==========================================================================
   OG SYSTEM — the shelf sheet                                  [shelfsheet.js]
   --------------------------------------------------------------------------
   Scanning a shelf label (SH02AA1, printed by js/labels60.js) anywhere but
   the shelf map opens this sheet: which shelf it is, what is on it, and two
   big jobs — TAKE something off it, or PUT something on it.

   Nothing here is a second way to change stock. Taking is a transfer to
   another place, putting is a receive (new pieces) or a transfer (from
   another place) followed by the shelf assignment — the same three routes
   the warehouse and the shelf map use, so the movement log and the server's
   shelf rules (one product per shelf, its size range) decide, and a refusal
   comes back in the server's own words.

   While the sheet is open it owns the scanner (js/app-boot.js): another
   shelf label opens that shelf, and a product box picks that size to put
   here — scanning the same box again counts one more.

   State lives in S, never on the DOM: the sheet repaints #ssRoot whenever
   an answer lands, and the search box and quantity repaint only their own
   corner so the caret stays.
   ========================================================================== */

var ShelfSheet = (function () {

  /* The payload js/labels60.js prints: SH + two-digit warehouse + rack
     letter + shelf code. The same pattern js/shelfmap.js reads. */
  var RE = /^SH(\d{2})([A-Z])([A-Z]\d{1,3})$/;

  var S = null;
  var lastScan = '', lastScanAt = 0;

  function isAr() { return OG.lang === 'ar'; }
  function n(x) { return '<bdi>' + nf(x) + '</bdi>'; }
  function canMove() { return allow('stock.move'); }

  /* A shelf code from what the scanner typed, or — on the Arabic keyboard
     layout, where the letters arrive replaced — from the keys it pressed. */
  function parse(text, latin) {
    var a = String(text || '').trim().toUpperCase();
    if (RE.test(a)) return a;
    var b = String(latin || '').trim().toUpperCase();
    return RE.test(b) ? b : null;
  }

  function isOpen() { return !!document.getElementById('ssRoot'); }

  /* ------------------------------------------------------------- opening */

  function open(code) {
    if (!allow('stock.read')) { toast(t('ss_title'), t('ss_no_read'), 'warn'); return; }
    var m = RE.exec(code);
    if (!m) return;
    S = { code: code, whCode: +m[1], key: m[2], shCode: m[3], hit: null, loading: true, err: null,
          mode: 'home', sku: null, pid: null, qty: 1, to: null, from: 'new', q: '', busy: false, msg: null };
    var title = t('ss_title') + ' ' + m[2] + '-' + m[3];
    if (isOpen()) {
      var head = document.querySelector('.ss-modal .modal-head h3, .ss-modal .modal-title');
      if (head) head.textContent = title;
      paint();
    } else {
      openModal({ title: title, size: 'ss-modal', body: '<div id="ssRoot">' + body() + '</div>' });
    }
    load();
  }

  function load() {
    var mine = S;
    return Shop.sections().then(function (res) {
      if (S !== mine) return;
      S.loading = false;
      S.hit = null;
      (res.sections || []).forEach(function (sec) {
        if (sec.wh_code === S.whCode && sec.key === S.key) {
          sec.shelves.forEach(function (sh) { if (sh.code === S.shCode) S.hit = { sec: sec, sh: sh }; });
        }
      });
      paint();
    }, function (err) {
      if (S !== mine) return;
      S.loading = false; S.err = API.friendly(err);
      paint();
    });
  }

  function paint() {
    var root = document.getElementById('ssRoot');
    if (root && S) root.innerHTML = body();
  }

  /* ------------------------------------------------------------- drawing */

  function body() {
    if (!S || S.loading) {
      return '<div class="ss-skel" aria-hidden="true"><i></i><i></i><i></i></div>' +
             '<span class="sr-only" role="status">' + t('loading') + '</span>';
    }
    if (S.err) return '<div class="cart-empty"><b>' + esc(S.err) + '</b>' +
      '<button class="btn" data-ss="retry">' + t('ss_retry') + '</button></div>';
    if (!S.hit) return '<div class="cart-empty"><b>' + t('ss_unknown_shelf') + '</b>' +
      '<span class="num">' + esc(S.code) + '</span></div>';

    return head() + (S.mode === 'get' ? getView() : S.mode === 'add' ? addView() : homeView());
  }

  function head() {
    var sec = S.hit.sec, sh = S.hit.sh;
    var whose = sh.product_id ? esc(sh.product_name || '') : t('ss_empty_shelf');
    return '<div class="ss-head">' +
      '<div class="ss-code" dir="ltr"><small>' + esc(sec.key) + '</small>' + esc(sh.code) + '</div>' +
      '<div class="ss-id">' +
        '<b>' + esc(sec.name || '') + '</b>' +
        '<span>' + esc(DB.whName(sec.wh_id, isAr())) + '</span>' +
        '<span class="ss-for' + (sh.product_id ? '' : ' is-empty') + '">' + whose + '</span>' +
      '</div>' +
      '<div class="ss-total"><b>' + n(sh.qty || 0) + '</b><span>' + t('ss_pieces') + '</span></div>' +
    '</div>';
  }

  function contents() { return (S.hit && S.hit.sh.contents) || []; }

  function homeView() {
    var rows = contents();
    var h = '<div class="ss-list">';
    if (!rows.length) {
      h += '<div class="ss-none">' + t('ss_nothing') + '</div>';
    } else {
      var oneProduct = rows.every(function (r) { return r.product_id === rows[0].product_id; });
      rows.forEach(function (r) {
        h += '<div class="ss-row"><b class="ss-size">' + esc(r.size) + '</b>' +
          '<span class="ss-row-name">' + (oneProduct ? '' : esc(r.product_name)) + '</span>' +
          '<span class="ss-row-qty">' + n(r.qty) + '</span></div>';
      });
    }
    h += '</div>';

    if (canMove()) {
      h += '<div class="ss-jobs">' +
        '<button class="ss-job" data-ss="mode" data-m="get"' + (rows.length ? '' : ' disabled') + '>' +
          '<span class="ss-job-ico" aria-hidden="true">↑</span><b>' + t('ss_get') + '</b>' +
          '<small>' + (rows.length ? t('ss_get_sub') : t('ss_nothing_short')) + '</small></button>' +
        '<button class="ss-job is-primary" data-ss="mode" data-m="add">' +
          '<span class="ss-job-ico" aria-hidden="true">↓</span><b>' + t('ss_add') + '</b>' +
          '<small>' + t('ss_add_sub') + '</small></button>' +
      '</div>';
    }
    if (navAllowed('shelfmap')) {
      h += '<button class="ss-link" data-ss="map">' + t('ss_map') + '</button>';
    }
    return h;
  }

  function stepper() {
    return '<div class="ss-step">' +
      '<button type="button" class="btn btn-ghost" data-ss="qty" data-d="-1" aria-label="−1">−</button>' +
      '<input class="inp num" id="ssQty" type="text" inputmode="numeric" enterkeyhint="done" value="' + S.qty + '" aria-label="' + esc(t('sc2_how_many')) + '">' +
      '<button type="button" class="btn btn-ghost" data-ss="qty" data-d="1" aria-label="+1">+</button>' +
    '</div>';
  }

  function backBtn() {
    return '<button type="button" class="ss-back" data-ss="mode" data-m="home">' +
      '<span aria-hidden="true">' + (isAr() ? '→' : '←') + '</span> ' + t('ss_back') + '</button>';
  }

  function msgHtml() {
    return S.msg ? '<div class="ss-msg" role="alert">' + esc(S.msg) + '</div>' : '';
  }

  /* ---- take something off ---- */

  function getView() {
    var rows = contents();
    var wh = S.hit.sec.wh_id;
    var others = DB.warehouses.filter(function (w) { return w.id !== wh; });
    var row = rows.filter(function (r) { return r.sku === S.sku; })[0] || null;

    var h = backBtn() + '<div class="ss-q">' + t('ss_which_get') + '</div>' +
      '<div class="ss-chips">' + rows.map(function (r) {
        var on = r.sku === S.sku;
        return '<button type="button" class="sc2-chip' + (on ? ' on' : '') + '" data-ss="sku" data-sku="' + esc(r.sku) + '"' +
          (on ? ' aria-pressed="true"' : '') + '><b>' + esc(r.size) + '</b><span class="num">' + nf(r.qty) + '</span></button>';
      }).join('') + '</div>';

    if (!row) return h;

    h += '<div class="ss-do">' +
      '<div class="ss-field"><span class="sc2-lbl">' + t('sc2_how_many') + '</span>' + stepper() + '</div>';
    if (others.length) {
      h += '<div class="ss-field ss-grow"><span class="sc2-lbl">' + t('ss_to') + '</span><div class="sc2-places">' +
        others.map(function (w) {
          var on = w.id === S.to;
          return '<button type="button" class="sc2-place' + (on ? ' on' : '') + '" data-ss="to" data-wh="' + esc(w.id) + '" aria-pressed="' + on + '">' +
            '<span>' + esc(DB.whName(w.id, isAr())) + '</span></button>';
        }).join('') + '</div></div>';
    }
    h += '</div>' + msgHtml() +
      '<button class="btn btn-primary btn-lg ss-go" id="ssGo" data-ss="go-get"' + (S.busy || !S.to ? ' disabled' : '') + '>' +
        goLabel() + '</button>';
    return h;
  }

  /* ---- put something on ---- */

  function addView() {
    var sh = S.hit.sh, wh = S.hit.sec.wh_id;
    var pid = sh.product_id || S.pid;
    var h = backBtn();

    if (!pid) {
      h += '<div class="ss-q">' + t('ss_which_add') + '</div>' +
        '<input class="inp ss-search" id="ssQ" type="search" autocomplete="off" enterkeyhint="search" placeholder="' +
          esc(t('ss_search_ph')) + '" value="' + esc(S.q) + '">' +
        '<div id="ssFound">' + found() + '</div>';
      return h;
    }

    var p = DB.product(pid);
    if (!sh.product_id) {
      h += '<div class="ss-chosen"><b>' + esc(p ? p.name : '') + '</b>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-ss="unpick">' + t('ss_change') + '</button></div>';
    } else {
      h += '<div class="ss-hint">' + t('ss_scan_hint') + '</div>';
    }
    var vs = DB.variantsOf(pid);
    h += '<div class="ss-q">' + t('ss_which_size') + '</div><div class="ss-chips">' +
      vs.map(function (v) {
        var on = v.sku === S.sku;
        return '<button type="button" class="sc2-chip' + (on ? ' on' : '') + '" data-ss="sku" data-sku="' + esc(v.sku) + '"' +
          (on ? ' aria-pressed="true"' : '') + '><b>' + esc(DB.variantLabel(v)) + '</b></button>';
      }).join('') + '</div>';

    var v = S.sku && DB.variantBySku(S.sku);
    if (!v) return h + msgHtml();

    var sources = DB.warehouses.filter(function (w) { return w.id !== wh; });
    h += '<div class="ss-do">' +
      '<div class="ss-field"><span class="sc2-lbl">' + t('sc2_how_many') + '</span>' + stepper() + '</div>' +
      '<div class="ss-field ss-grow"><span class="sc2-lbl">' + t('ss_from') + '</span><div class="sc2-places">' +
        '<button type="button" class="sc2-place' + (S.from === 'new' ? ' on' : '') + '" data-ss="from" data-wh="new" aria-pressed="' + (S.from === 'new') + '">' +
          '<span>' + t('ss_new') + '</span></button>' +
        sources.map(function (w) {
          var have = DB.stockAt(v, w.id), on = S.from === w.id;
          return '<button type="button" class="sc2-place' + (on ? ' on' : '') + '" data-ss="from" data-wh="' + esc(w.id) + '"' +
            (have > 0 ? '' : ' disabled') + ' aria-pressed="' + on + '">' +
            '<span>' + esc(DB.whName(w.id, isAr())) + '</span><b class="num">' + nf(have) + '</b></button>';
        }).join('') +
      '</div></div>' +
    '</div>' + msgHtml() +
    '<button class="btn btn-primary btn-lg ss-go" id="ssGo" data-ss="go-add"' + (S.busy ? ' disabled' : '') + '>' +
      goLabel() + '</button>';
    return h;
  }

  /* Products for an empty shelf: what the box matches, most held first. */
  function found() {
    var q = S.q.trim();
    var list = DB.products.filter(function (p) { return !p.hidden && DB.productMatch(p, q); });
    list.sort(function (a, b) { return DB.totalQty(b.id) - DB.totalQty(a.id); });
    if (!list.length) return '<div class="ss-none">' + t('no_results') + '</div>';
    return '<div class="ss-found">' + list.slice(0, 6).map(function (p) {
      return '<button type="button" class="ss-prod" data-ss="pick" data-pid="' + p.id + '">' +
        thumbBox(p, 'ss-thumb') + '<b>' + esc(p.name) + '</b><span class="num">' + nf(DB.totalQty(p.id)) + '</span></button>';
    }).join('') + '</div>';
  }

  function goLabel() {
    if (S.busy) return '<span>' + t('ss_saving') + '</span>';
    var c = S.hit.sec.key + '-' + S.hit.sh.code;
    var s = S.mode === 'get'
      ? t('ss_go_get').replace('{n}', '<bdi>' + nf(S.qty) + '</bdi>').replace('{w}', esc(S.to ? DB.whName(S.to, isAr()) : ''))
      : t('ss_go_add').replace('{n}', '<bdi>' + nf(S.qty) + '</bdi>').replace('{c}', '<bdi dir="ltr">' + esc(c) + '</bdi>');
    return '<span>' + s + '</span>';
  }

  /* ------------------------------------------------------------- acting */

  function setMode(m) {
    S.mode = m; S.msg = null; S.qty = 1; S.sku = null; S.from = 'new'; S.q = '';
    if (m === 'get') {
      var rows = contents();
      if (rows.length === 1) S.sku = rows[0].sku;
      var floor = DB.warehouses.filter(function (w) { return w.id !== S.hit.sec.wh_id; });
      S.to = floor.some(function (w) { return w.id === DB.defaultWh; }) ? DB.defaultWh : (floor[0] ? floor[0].id : null);
    }
    if (m === 'add') S.pid = S.hit.sh.product_id || null;
    paint();
    focusFirst();
  }

  function focusFirst() {
    var q = document.getElementById('ssQ');
    if (q && !matchMedia('(pointer: coarse)').matches) q.focus();
  }

  function maxQty() {
    if (S.mode !== 'get') return 9999;
    var r = contents().filter(function (x) { return x.sku === S.sku; })[0];
    return r ? r.qty : 1;
  }

  function setQty(v) {
    S.qty = Math.max(1, Math.min(maxQty(), v));
    var box = document.getElementById('ssQty');
    if (box && box !== document.activeElement) box.value = S.qty;
    var go = document.getElementById('ssGo');
    if (go) go.innerHTML = goLabel();
  }

  function done(key) {
    var c = S.hit.sec.key + '-' + S.hit.sh.code;
    var v = DB.variantBySku(S.sku);
    toast(t(key).replace('{c}', c), (v ? DB.product(v.productId).name + ' · ' + v.size : '') + ' · ' + S.qty, 'ok');
    S.busy = false;
    S.mode = 'home'; S.sku = null; S.msg = null;
    S.loading = true; paint();
    load();
  }

  function failed(err) {
    S.busy = false;
    S.msg = API.friendly(err);
    paint();
  }

  function goGet() {
    var sku = S.sku, wh = S.hit.sec.wh_id, to = S.to, qty = S.qty;
    if (!sku || !to || S.busy) return;
    if (qty > maxQty()) { S.msg = t('ss_too_many').replace('{n}', maxQty()); paint(); return; }
    S.busy = true; S.msg = null; paint();
    var note = t('ss_note').replace('{c}', S.hit.sec.key + '-' + S.hit.sh.code);
    var started = Shop.write(
      function () { return Shop.transfer(sku, wh, to, qty, note); },
      null,
      function () { done('ss_done_get'); },
      failed
    );
    if (!started) { S.busy = false; paint(); }
  }

  /* Putting away is two requests: the pieces arrive (receive or transfer),
     and the size is filed on this shelf. When the size is already held in
     this warehouse the shelf is asked FIRST, so a shelf that refuses it
     (another product, the wrong size) changes nothing. When it is new here
     there is no stock row to file yet, so the pieces come first — and if the
     shelf then refuses, the sheet says plainly they were booked into the
     warehouse but not onto this shelf, with the server's reason. */
  function goAdd() {
    var v = DB.variantBySku(S.sku);
    if (!v || S.busy) return;
    var wh = S.hit.sec.wh_id, shelfId = S.hit.sh.id, qty = S.qty, from = S.from;
    var note = t('ss_note').replace('{c}', S.hit.sec.key + '-' + S.hit.sh.code);
    var arrive = function () {
      return from === 'new' ? Shop.receive(v.sku, wh, qty, note) : Shop.transfer(v.sku, from, wh, qty, note);
    };
    var file = function () { return Shop.assignShelf(v.sku, wh, shelfId); };
    var heldHere = DB.stockAt(v, wh) > 0;

    S.busy = true; S.msg = null; paint();
    var started = Shop.write(
      function () {
        if (heldHere) return file().then(arrive);
        return arrive().then(function () {
          return file().catch(function (err) { err.half = true; throw err; });
        });
      },
      null,
      function () { done('ss_done_add'); },
      function (err) {
        if (err && err.half) {
          S.busy = false;
          S.msg = t('ss_half').replace('{w}', DB.whName(wh, isAr())) + ' — ' + API.friendly(err);
          paint();
          Shop.reload();
          return;
        }
        failed(err);
      }
    );
    if (!started) { S.busy = false; paint(); }
  }

  /* ------------------------------------------------------------ scanning */

  function scanned(code, info) {
    var sc = parse(code, info && info.latin);
    if (sc) { open(sc); return; }
    if (!S || !S.hit || S.busy) return;
    var c = String(code || '').trim();
    var now = Date.now();
    if (c === lastScan && now - lastScanAt < 700) { lastScanAt = now; return; }
    lastScan = c; lastScanAt = now;

    var list = DB.variantsByCode(c);
    if (!list.length) { toast(t('lbl_unknown_code'), c.slice(0, 40), 'warn'); return; }
    var pick = function (v) {
      if (!v) return;
      if (S.mode === 'get') {
        var on = contents().some(function (r) { return r.sku === v.sku; });
        if (!on) { toast(t('ss_not_here'), DB.product(v.productId).name + ' · ' + v.size, 'warn'); return; }
        if (S.sku === v.sku) { setQty(S.qty + 1); return; }
        S.sku = v.sku; S.qty = 1; S.msg = null; paint(); return;
      }
      if (!canMove()) return;
      var own = S.hit.sh.product_id;
      if (own && own !== v.productId) {
        toast(t('ss_wrong_product').replace('{p}', S.hit.sh.product_name || ''), DB.product(v.productId).name, 'warn', 5000);
        return;
      }
      if (S.mode === 'add' && S.sku === v.sku) { setQty(S.qty + 1); return; }
      if (S.mode !== 'add') { S.mode = 'add'; S.from = 'new'; S.q = ''; }
      S.pid = v.productId; S.sku = v.sku; S.qty = 1; S.msg = null;
      paint();
    };
    if (list.length > 1 && typeof ColourPick !== 'undefined') ColourPick.choose(list, {}, pick);
    else pick(list[0]);
  }

  /* ------------------------------------------------------------- events */

  var ACT = {
    retry: function () { S.err = null; S.loading = true; paint(); load(); },
    mode: function (el) { setMode(el.getAttribute('data-m')); },
    sku: function (el) {
      S.sku = el.getAttribute('data-sku'); S.qty = 1; S.msg = null;
      if (S.mode === 'add' && S.from !== 'new') {
        var v = DB.variantBySku(S.sku);
        if (!v || DB.stockAt(v, S.from) <= 0) S.from = 'new';
      }
      paint();
    },
    qty: function (el) { setQty(S.qty + (Number(el.getAttribute('data-d')) || 0)); },
    to: function (el) { S.to = el.getAttribute('data-wh'); S.msg = null; paint(); },
    from: function (el) { S.from = el.getAttribute('data-wh'); S.msg = null; paint(); },
    pick: function (el) { S.pid = Number(el.getAttribute('data-pid')); S.sku = null; S.msg = null; paint(); },
    unpick: function () { S.pid = null; S.sku = null; S.msg = null; paint(); focusFirst(); },
    'go-get': goGet,
    'go-add': goAdd,
    map: function () {
      var code = S.code;
      closeModal();
      if (typeof ShelfMap !== 'undefined' && ShelfMap.showShelf) ShelfMap.showShelf(code);
      go('shelfmap');
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-ss]') : null;
    if (!el || !S || !isOpen() || el.disabled) return;
    var fn = ACT[el.getAttribute('data-ss')];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('input', function (e) {
    if (!S || !e.target) return;
    if (e.target.id === 'ssQ') {
      S.q = e.target.value;
      var f = document.getElementById('ssFound');
      if (f) f.innerHTML = found();
    } else if (e.target.id === 'ssQty') {
      S.qty = Math.max(1, Math.min(maxQty(), Desk.toCount(e.target.value, { min: 1, empty: 1 })));
      var go = document.getElementById('ssGo');
      if (go) go.innerHTML = goLabel();
    }
  });

  document.addEventListener('focusout', function (e) {
    if (S && e.target && e.target.id === 'ssQty') e.target.value = S.qty;
  });

  return { parse: parse, open: open, isOpen: isOpen, scanned: scanned };
})();
