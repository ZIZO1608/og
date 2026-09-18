/* ==========================================================================
   WHICH COLOUR?                                                  [ColourPick]
   --------------------------------------------------------------------------
   A printed code is shared by every colour of one product and size (058), so
   a scan can name several sizes at once. Every scan path hands the list here:

     ColourPick.choose(list, { whId, needStock }, function (variant) { ... })

   - one variant: answered at once, as before colours;
   - several, and `needStock` with a place: only the colours that have stock
     there count — if exactly one does, it is answered at once;
   - otherwise a one-tap sheet of swatches and names. Escape or the backdrop
     answers nothing.

   It draws on its OWN layer above dialogs, never through openModal: a scan
   taken inside move-by-scan or the office would otherwise close the very
   panel the answer is for.

   Events are delegated (data-cp). Nothing here talks to the server.
   ========================================================================== */

var ColourPick = (function () {

  var pending = null;   /* { list, cb } */

  function stockAt(v, whId) {
    if (!whId) return Number(v.qty) || 0;
    return typeof DB.stockAt === 'function' ? DB.stockAt(v, whId) : ((v.wh && v.wh[whId]) || 0);
  }

  function choose(list, opts, cb) {
    opts = opts || {};
    list = (list || []).slice();
    if (!list.length) { cb(null); return; }
    if (list.length === 1) { cb(list[0]); return; }
    if (opts.needStock) {
      var withStock = list.filter(function (v) { return stockAt(v, opts.whId) > 0; });
      if (withStock.length === 1) { cb(withStock[0]); return; }
      if (withStock.length > 1) list = withStock;
    }
    open(list, opts, cb);
  }

  function open(list, opts, cb) {
    pending = { list: list, cb: cb };
    var p = DB.product(list[0].productId);
    var h = '<div class="cp-grid">';
    list.forEach(function (v, i) {
      var c = DB.colour(v.colourId);
      var n = stockAt(v, opts.whId);
      h += '<button class="cp-opt" data-cp="pick" data-i="' + i + '"' +
        (opts.needStock && n <= 0 ? ' data-empty="1"' : '') + '>' +
        (c && c.imageUrl ? '<img class="cp-img" src="' + esc(c.imageUrl) + '" alt="">' : DB.swatch(c, 'cp-big')) +
        '<b>' + esc(DB.colourName(c) || v.sku) + '</b>' +
        '<small><bdi dir="ltr">' + esc(v.size) + '</bdi> · ' +
          (n > 0 ? '<bdi dir="ltr">' + n + '</bdi> ' + t('cp_in_stock') : t('cp_none_here')) + '</small>' +
      '</button>';
    });
    h += '</div>';
    close();
    var root = document.createElement('div');
    root.id = 'cpRoot';
    root.className = 'cp-back' + (window.innerWidth <= 560 ? ' as-sheet' : '');
    root.setAttribute('data-cp', 'back');
    root.innerHTML = '<div class="cp-card" role="dialog" aria-modal="true">' +
      '<div class="cp-head"><h3>' + t('cp_title') + ' · ' + esc(p ? p.name : '') + '</h3>' +
        '<button class="x" data-cp="cancel" aria-label="' + esc(t('cancel')) + '">&times;</button></div>' +
      '<p class="muted small cp-sub">' + t('cp_sub') + '</p>' + h + '</div>';
    document.body.appendChild(root);
    var first = root.querySelector('.cp-opt:not([data-empty])') || root.querySelector('.cp-opt');
    if (first) first.focus();
  }

  function close() {
    var r = document.getElementById('cpRoot');
    if (r) r.parentNode.removeChild(r);
  }

  document.addEventListener('click', function (e) {
    if (!pending) return;
    var b = e.target.closest ? e.target.closest('[data-cp]') : null;
    if (!b) return;
    var what = b.getAttribute('data-cp');
    if (what === 'back' && e.target !== b) return;
    e.stopPropagation();
    var cb = pending.cb;
    var v = what === 'pick' ? pending.list[+b.getAttribute('data-i')] : null;
    pending = null;
    close();
    if (v && cb) cb(v);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!pending || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    pending = null;
    close();
  }, true);

  /* Shut without answering — what Escape already did, given a name so the
     one route-change cleanup (js/layers.js) can do it too. The callback is
     deliberately NOT called: nothing was chosen. */
  function cancel() { pending = null; close(); }

  return { choose: choose, cancel: cancel, isOpen: function () { return !!pending; } };
})();
