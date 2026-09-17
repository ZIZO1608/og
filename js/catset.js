/* ==========================================================================
   SETTINGS → CATEGORIES                                             [CatSet]
   --------------------------------------------------------------------------
   The owner's list of product categories (migration 057): an English and an
   Arabic name for each, the sizes it comes in, and a switch. A category is
   never deleted — products and old reports name it — so "remove" is the
   switch. Both names are required and neither may repeat; the server
   refuses the same things, and its refusal is what the toast says.

   Each row saves on its own button; the switch saves the moment it moves.
   A save reloads the catalogue (so the till's chips and every form follow)
   and redraws Settings where it was, never at the top: half the page can be
   typed-but-unsaved values.
   ========================================================================== */

var CatSet = (function () {

  function rows() { return (DB.categories || []).slice(); }

  function card() {
    if (!allow('config.write')) return '';
    var list = rows();
    var off = list.filter(function (c) { return !c.active; }).length;
    var meta = '<span dir="ltr">' + list.length + '</span> ' + t('cat_count') +
      (off ? ' · <span dir="ltr">' + off + '</span> ' + t('cat_off_count') : '');

    var h = setFoldStart('categories', t('cat_title'), meta) +
      '<div class="card-body"><p class="muted small cat-note">' + t('cat_note') + '</p>' +
      '<div class="cat-list">' +
        '<div class="cat-row cat-headrow"><span>' + t('cat_name_en') + '</span><span>' + t('cat_name_ar') + '</span>' +
          '<span>' + t('cat_sizes') + '</span><span>' + t('cat_on') + '</span><span></span></div>';
    list.forEach(function (c) {
      h += '<div class="cat-row' + (c.active ? '' : ' is-off') + '" data-cat-row="' + esc(c.id) + '">' +
        '<label class="cat-cell"><span class="cat-lbl">' + t('cat_name_en') + '</span>' +
          '<input class="inp" dir="ltr" data-k="en" maxlength="40" value="' + esc(c.nameEn) + '"></label>' +
        '<label class="cat-cell"><span class="cat-lbl">' + t('cat_name_ar') + '</span>' +
          '<input class="inp" dir="rtl" lang="ar" data-k="ar" maxlength="40" value="' + esc(c.nameAr) + '"></label>' +
        '<label class="cat-cell"><span class="cat-lbl">' + t('cat_sizes') + '</span>' +
          '<input class="inp" dir="ltr" data-k="sizes" value="' + esc((c.sizes || []).join(', ')) + '" placeholder="39, 40, 41"></label>' +
        '<div class="cat-cell cat-sw"><span class="cat-lbl">' + t('cat_on') + '</span>' +
          '<label class="switch" title="' + esc(t(c.active ? 'cat_turn_off' : 'cat_turn_on')) + '">' +
            '<input type="checkbox" data-cat-on="' + esc(c.id) + '"' + (c.active ? ' checked' : '') + '><i></i></label>' +
          '<small class="muted">' + (c.active ? t('cat_is_on') : t('cat_is_off')) + '</small></div>' +
        '<div class="cat-cell cat-act"><button class="btn btn-sm" data-cat="save" data-id="' + esc(c.id) + '">' + t('save') + '</button></div>' +
      '</div>';
    });
    h += '</div>' +
      '<div class="cat-add">' +
        '<div class="cat-add-h"><b>' + t('cat_add') + '</b></div>' +
        '<div class="cat-row" data-cat-row="">' +
          '<label class="cat-cell"><span class="cat-lbl">' + t('cat_name_en') + '</span>' +
            '<input class="inp" dir="ltr" data-k="en" maxlength="40" placeholder="Track pants"></label>' +
          '<label class="cat-cell"><span class="cat-lbl">' + t('cat_name_ar') + '</span>' +
            '<input class="inp" dir="rtl" lang="ar" data-k="ar" maxlength="40" placeholder="بناطيل رياضية"></label>' +
          '<label class="cat-cell"><span class="cat-lbl">' + t('cat_sizes') + '</span>' +
            '<input class="inp" dir="ltr" data-k="sizes" placeholder="S, M, L, XL"></label>' +
          '<div class="cat-cell cat-sw"></div>' +
          '<div class="cat-cell cat-act"><button class="btn btn-sm btn-primary" data-cat="add">' + t('cat_add_btn') + '</button></div>' +
        '</div>' +
      '</div></div>' + setFoldEnd();
    return h;
  }

  function read(row) {
    var v = function (k) { var el = row.querySelector('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
    return { nameEn: v('en'), nameAr: v('ar'), sizes: v('sizes') };
  }

  /* The browser's copy of the server's rule, so the obvious mistakes are said
     before a round trip. The server still decides. */
  function problem(body, id) {
    if (!body.nameEn) return t('err_name_en_required');
    if (!body.nameAr) return t('err_name_ar_required');
    var fold = function (s) { return DB.foldName ? DB.foldName(s) : String(s).toLowerCase(); };
    var clash = rows().filter(function (c) { return c.id !== id; });
    if (clash.some(function (c) { return fold(c.nameEn) === fold(body.nameEn); })) return t('err_category_dup_en');
    if (clash.some(function (c) { return fold(c.nameAr) === fold(body.nameAr); })) return t('err_category_dup_ar');
    return null;
  }

  var busy = false;
  function send(req, okMsg) {
    if (busy) return;
    busy = true;
    req.then(function () {
      return Shop.reload();
    }).then(function () {
      busy = false;
      toast(t('cat_title'), okMsg, 'ok', 2500);
      keepScroll();
    }).catch(function (e) {
      busy = false;
      toast(t('cat_title'), API.friendly(e), 'err', 5000);
      keepScroll();
    });
  }

  function keepScroll() {
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    if (OG.view === 'settings') render();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-cat]') : null;
      if (!b) return;
      var row = b.closest('[data-cat-row]');
      if (!row) return;
      var id = row.getAttribute('data-cat-row');
      var body = read(row);
      var bad = problem(body, id || null);
      if (bad) { toast(t('cat_title'), bad, 'warn', 4000); return; }
      if (b.getAttribute('data-cat') === 'add') {
        send(API.post('/api/categories', body), t('cat_added').replace('{name}', OG.lang === 'ar' ? body.nameAr : body.nameEn));
      } else {
        send(API.patch('/api/categories/' + encodeURIComponent(id), body), t('cat_saved'));
      }
    });
    /* The switch saves the moment it moves. */
    document.addEventListener('change', function (e) {
      var el = e.target;
      var id = el && el.getAttribute && el.getAttribute('data-cat-on');
      if (!id) return;
      send(API.patch('/api/categories/' + encodeURIComponent(id), { active: el.checked }),
           el.checked ? t('cat_now_on') : t('cat_now_off'));
    });
  }

  if (typeof document !== 'undefined') bind();

  return { card: card };
})();
