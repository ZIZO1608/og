/* ==========================================================================
   ADD PRODUCT → COLOURS                                          [ColourForm]
   --------------------------------------------------------------------------
   The owner's shape (058): a product has colours, each colour has its own
   sizes, each size its own quantity. Red → 42: 3, 43: 2 · Black → 42: 1.
   One price for the whole product; the barcode of a size is shared by every
   colour (the server issues it).

   STATE LIVES IN OG.wh.colours, so a failed save, a tab switch or a language
   switch loses nothing that was typed:
     [{ key, nameEn, nameAr, hex, qty: { '42': 3 }, imgSrc }]

   Typing a quantity never repaints the form (the caret stays); it patches
   the card's total, the grand total and the preview column. Adding or
   removing a colour, or picking a swatch, repaints — those are clicks.

   Events are delegated: data-cf (click), data-cf-in (input), data-cf-file
   (a colour's photo input).
   ========================================================================== */

var ColourForm = (function () {

  /* Common shoe and streetwear colours, with the words a shop would use. */
  var PALETTE = [
    ['#111111', 'Black', 'أسود'], ['#F5F5F5', 'White', 'أبيض'], ['#8A8F98', 'Grey', 'رمادي'],
    ['#1F2A44', 'Navy', 'كحلي'], ['#2563EB', 'Blue', 'أزرق'], ['#C62828', 'Red', 'أحمر'],
    ['#2E7D32', 'Green', 'أخضر'], ['#D8C3A5', 'Beige', 'بيج'], ['#6D4C41', 'Brown', 'بني'],
    ['#EC8FB0', 'Pink', 'زهري'], ['#F2C94C', 'Yellow', 'أصفر'], ['#EF6C00', 'Orange', 'برتقالي']
  ];

  var seq = 0;
  function blank() { return { key: 'c' + (++seq) + Date.now().toString(36), nameEn: '', nameAr: '', hex: '', qty: {}, imgSrc: null }; }

  function list() {
    if (!OG.wh.colours || !OG.wh.colours.length) OG.wh.colours = [blank()];
    return OG.wh.colours;
  }
  function find(key) { return list().filter(function (c) { return c.key === key; })[0] || null; }
  function sizes() { return DB.sizeSets[OG.wh.type] || []; }

  function colourTotal(c) {
    return sizes().reduce(function (a, s) { return a + (Number(c.qty[s]) || 0); }, 0);
  }
  function grand() { return list().reduce(function (a, c) { return a + colourTotal(c); }, 0); }
  function label(c, i) {
    var name = OG.lang === 'ar' ? (c.nameAr || c.nameEn) : (c.nameEn || c.nameAr);
    return name || (t('cl_colour') + ' ' + (i + 1));
  }

  /* ---------------------------------------------------------------- draw */

  function html() {
    var cs = list();
    var h = '<div class="cf" id="cfRoot">' +
      '<div class="cf-top"><span class="lbl">' + t('cl_colours') + '</span>' +
        '<span class="muted small">' + t('cl_first_hint') + '</span></div>' +
      '<div class="cf-chips" role="tablist">';
    cs.forEach(function (c, i) {
      h += '<span class="cf-chip">' +
        '<span class="cp-sw" style="background:' + (c.hex || '#3F3F46') + '"></span>' +
        '<b>' + esc(label(c, i)) + '</b>' +
        '<small class="num" data-cf-chip="' + c.key + '"><bdi dir="ltr">' + nf(colourTotal(c)) + '</bdi></small>' +
        (cs.length > 1
          ? '<button class="cf-chip-x" data-cf="remove" data-k="' + c.key + '" title="' + esc(t('cl_remove')) + '" aria-label="' + esc(t('cl_remove')) + '">✕</button>'
          : '') +
      '</span>';
    });
    h += '<button class="btn btn-sm cf-add" data-cf="add">+ ' + t('cl_add') + '</button></div>';

    cs.forEach(function (c, i) { h += card(c, i); });

    h += '<div class="cf-grand"><span>' + t('cl_grand') + '</span><b class="num" id="cfGrand"><bdi dir="ltr">' +
      nf(grand()) + '</bdi> ' + t('pieces') + '</b></div></div>';
    return h;
  }

  function card(c, i) {
    var h = '<section class="cf-card" data-cf-card="' + c.key + '">' +
      '<div class="cf-head">' +
        '<div class="cf-photo' + (c.imgSrc ? ' has-img' : '') + '" data-cf="photo" data-k="' + c.key + '" title="' + esc(t('cl_photo_add')) + '">' +
          (c.imgSrc
            ? '<img src="' + c.imgSrc + '" alt=""><button class="up-x" data-cf="photo-clear" data-k="' + c.key + '">✕</button>'
            : '<span class="cp-sw cp-big" style="background:' + (c.hex || '#3F3F46') + '"></span><small>' + t('cl_photo') + '</small>') +
        '</div>' +
        '<input type="file" accept="image/*" hidden data-cf-file="' + c.key + '">' +
        '<div class="cf-names">' +
          '<label class="field"><span>' + t('cl_name_en') + '</span>' +
            '<input class="inp" dir="ltr" maxlength="40" data-cf-in="nameEn" data-k="' + c.key + '" value="' + esc(c.nameEn) + '" placeholder="Black"></label>' +
          '<label class="field"><span>' + t('cl_name_ar') + '</span>' +
            '<input class="inp" dir="rtl" lang="ar" maxlength="40" data-cf-in="nameAr" data-k="' + c.key + '" value="' + esc(c.nameAr) + '" placeholder="أسود"></label>' +
        '</div>' +
      '</div>' +
      '<div class="cf-palette" role="group" aria-label="' + esc(t('cl_colour')) + '">';
    PALETTE.forEach(function (p) {
      h += '<button class="cf-sw' + (c.hex && c.hex.toUpperCase() === p[0] ? ' on' : '') + '" style="background:' + p[0] + '" ' +
        'data-cf="hex" data-k="' + c.key + '" data-hex="' + p[0] + '" data-en="' + esc(p[1]) + '" data-ar="' + esc(p[2]) + '" ' +
        'title="' + esc(OG.lang === 'ar' ? p[2] : p[1]) + '" aria-label="' + esc(OG.lang === 'ar' ? p[2] : p[1]) + '"></button>';
    });
    h += '<label class="cf-custom" title="' + esc(t('cl_custom')) + '"><input type="color" data-cf-in="hex" data-k="' + c.key + '" value="' +
      (c.hex || '#808080') + '"><span>' + t('cl_custom') + '</span></label></div>';

    h += '<div class="cf-sizes">';
    sizes().forEach(function (s) {
      var q = c.qty[s] === undefined ? '' : c.qty[s];
      h += '<div class="cf-size' + (Number(q) > 0 ? ' filled' : '') + '" data-cf-cell="' + c.key + '|' + esc(s) + '">' +
        '<b dir="ltr">' + esc(s) + '</b>' +
        '<div class="cf-step">' +
          '<button data-cf="step" data-k="' + c.key + '" data-size="' + esc(s) + '" data-d="-1" aria-label="−">−</button>' +
          '<input type="number" min="0" step="1" inputmode="numeric" dir="ltr" placeholder="0" value="' + esc(String(q)) + '" ' +
            'data-cf-in="qty" data-k="' + c.key + '" data-size="' + esc(s) + '">' +
          '<button data-cf="step" data-k="' + c.key + '" data-size="' + esc(s) + '" data-d="1" aria-label="+">+</button>' +
        '</div></div>';
    });
    h += '</div>' +
      '<div class="cf-foot"><span>' + t('cl_total') + '</span><b class="num" data-cf-total="' + c.key + '"><bdi dir="ltr">' +
        nf(colourTotal(c)) + '</bdi> ' + t('pieces') + '</b></div>' +
    '</section>';
    return h;
  }

  /* Totals only — the input being typed into is left alone. */
  function patch(c) {
    var tot = document.querySelector('[data-cf-total="' + c.key + '"]');
    if (tot) tot.innerHTML = '<bdi dir="ltr">' + nf(colourTotal(c)) + '</bdi> ' + t('pieces');
    var chip = document.querySelector('[data-cf-chip="' + c.key + '"]');
    if (chip) chip.innerHTML = '<bdi dir="ltr">' + nf(colourTotal(c)) + '</bdi>';
    var g = document.getElementById('cfGrand');
    if (g) g.innerHTML = '<bdi dir="ltr">' + nf(grand()) + '</bdi> ' + t('pieces');
    sizes().forEach(function (s) {
      var cell = document.querySelector('[data-cf-cell="' + c.key + '|' + s + '"]');
      if (cell) cell.classList.toggle('filled', Number(c.qty[s]) > 0);
    });
    if (typeof repaintWhAdd === 'function') repaintWhAdd();
  }

  function keepScroll(fn) {
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    fn();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  /* ------------------------------------------------------------- the save */

  /* What goes to the server, or the reason it cannot. */
  function payload() {
    var cs = list();
    var named = cs.length > 1;
    var out = [], seen = {};
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      var en = String(c.nameEn || '').trim(), ar = String(c.nameAr || '').trim();
      if (named && !en && !ar) return { error: t('cl_need_name'), key: c.key };
      var fold = function (s) { return DB.foldName ? DB.foldName(s) : String(s).toLowerCase(); };
      var k1 = en ? 'en:' + fold(en) : null, k2 = ar ? 'ar:' + fold(ar) : null;
      if ((k1 && seen[k1]) || (k2 && seen[k2])) return { error: t('cl_dup'), key: c.key };
      if (k1) seen[k1] = 1;
      if (k2) seen[k2] = 1;
      var sz = [];
      for (var j = 0; j < sizes().length; j++) {
        var s = sizes()[j];
        var raw = c.qty[s];
        if (raw === '' || raw === undefined) continue;
        var n = Number(raw);
        if (!(n >= 0) || Math.floor(n) !== n) return { error: t('cl_no_neg'), key: c.key };
        if (n > 0) sz.push({ size: s, qty: n });
      }
      if (!sz.length) {
        return { error: t('cl_empty_warn').replace('{name}', label(c, i)), key: c.key, empty: true };
      }
      out.push({ key: c.key, nameEn: en || undefined, nameAr: ar || undefined, hex: c.hex || undefined, sizes: sz, imgSrc: c.imgSrc });
    }
    if (!out.length) return { error: t('cl_need_colour') };
    return { colours: out };
  }

  function flag(key) {
    var el = document.querySelector('[data-cf-card="' + key + '"]');
    if (!el) return;
    el.classList.remove('cf-bad'); void el.offsetWidth; el.classList.add('cf-bad');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function reset() { OG.wh.colours = [blank()]; }

  /* -------------------------------------------------------------- events */

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-cf]') : null;
    if (!b) return;
    var a = b.getAttribute('data-cf');
    var c = find(b.getAttribute('data-k'));
    if (a === 'add') {
      list().push(blank());
      keepScroll(render);
      var cs = list();
      var last = document.querySelector('[data-cf-card="' + cs[cs.length - 1].key + '"] [data-cf-in="nameEn"]');
      if (last) last.focus();
      return;
    }
    if (!c) return;
    if (a === 'remove') {
      var any = colourTotal(c) > 0 || c.nameEn || c.nameAr || c.imgSrc;
      if (!any) { OG.wh.colours = list().filter(function (x) { return x !== c; }); keepScroll(render); return; }
      openModal({
        title: t('cl_remove'),
        body: '<p>' + esc(t('cl_remove_q').replace('{name}', label(c, list().indexOf(c)))) + '</p>',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-cf="remove-ok" data-k="' + c.key + '">' + t('cl_remove') + '</button>'
      });
      return;
    }
    if (a === 'remove-ok') {
      OG.wh.colours = list().filter(function (x) { return x !== c; });
      closeModal();
      keepScroll(render);
      return;
    }
    if (a === 'hex') {
      c.hex = b.getAttribute('data-hex');
      if (!c.nameEn && !c.nameAr) { c.nameEn = b.getAttribute('data-en'); c.nameAr = b.getAttribute('data-ar'); }
      keepScroll(render);
      return;
    }
    if (a === 'step') {
      var s = b.getAttribute('data-size');
      var n = Math.max(0, (Number(c.qty[s]) || 0) + Number(b.getAttribute('data-d')));
      c.qty[s] = n;
      var inp = document.querySelector('[data-cf-in="qty"][data-k="' + c.key + '"][data-size="' + s + '"]');
      if (inp) inp.value = n;
      patch(c);
      return;
    }
    if (a === 'photo') {
      if (e.target.closest('[data-cf="photo-clear"]')) return;
      var f = document.querySelector('[data-cf-file="' + c.key + '"]');
      if (f) f.click();
      return;
    }
    if (a === 'photo-clear') { e.stopPropagation(); c.imgSrc = null; keepScroll(render); }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    var f = el.getAttribute && el.getAttribute('data-cf-in');
    if (!f) return;
    var c = find(el.getAttribute('data-k'));
    if (!c) return;
    if (f === 'nameEn' || f === 'nameAr') {
      c[f] = el.value;
      var chip = document.querySelector('[data-cf-chip="' + c.key + '"]');
      if (chip && chip.previousElementSibling) chip.previousElementSibling.textContent = label(c, list().indexOf(c));
      return;
    }
    if (f === 'qty') {
      var s = el.getAttribute('data-size');
      if (el.value === '') { c.qty[s] = ''; patch(c); return; }
      var n = Math.floor(Number(el.value));
      if (!(n >= 0)) { n = 0; el.value = '0'; }
      c.qty[s] = n;
      patch(c);
      return;
    }
    if (f === 'hex') { c.hex = String(el.value || '').toUpperCase(); }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-cf-in') === 'hex') { keepScroll(render); return; }
    var key = el.getAttribute && el.getAttribute('data-cf-file');
    if (!key) return;
    var c = find(key);
    var file = el.files && el.files[0];
    el.value = '';
    if (!c || !file) return;
    readImageFile(file, function (src, err) {
      if (err) { toast(t('image'), t('up_err_' + err), 'err', 4000); return; }
      c.imgSrc = src;
      keepScroll(render);
    });
  });

  /* ------------------------------------------- the drawer: colour × size */

  function matrix(p) {
    var cs = p.colours || [];
    var vs = DB.variantsOf(p.id);
    if (!cs.length || !vs.length) return '';
    var sz = [];
    vs.forEach(function (v) { if (sz.indexOf(v.size) < 0) sz.push(v.size); });
    var order = DB.sizeSets[p.type] || [];
    sz.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return String(a).localeCompare(String(b), undefined, { numeric: true });
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    var h = '<div class="card mb"><div class="card-head"><h3>' + t('cl_matrix') + '</h3></div>' +
      '<div class="table-wrap"><table class="tbl tbl-compact cf-matrix"><thead><tr><th>' + t('cl_colour') + '</th>';
    sz.forEach(function (s) { h += '<th class="num"><bdi dir="ltr">' + esc(s) + '</bdi></th>'; });
    h += '<th class="num">' + t('total') + '</th></tr></thead><tbody>';
    cs.forEach(function (c) {
      var row = 0;
      h += '<tr><td><span class="line-colour">' + DB.swatch(c) + '<b>' + esc(DB.colourName(c)) + '</b></span></td>';
      sz.forEach(function (s) {
        var v = vs.filter(function (x) { return x.colourId === c.id && x.size === s; })[0];
        if (!v) { h += '<td class="num muted">·</td>'; return; }
        row += v.qty;
        h += '<td class="num' + (v.qty === 0 ? ' cf-zero' : '') + '"><b>' + nf(v.qty) + '</b></td>';
      });
      h += '<td class="num"><b>' + nf(row) + '</b></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  /* -------------------------- the drawer: add a colour, or a size to one */

  var ADD = null;   /* { pid, mode: 'colour'|'size', hex, qty: {} } */

  function openAdd(pid) {
    var p = DB.product(pid);
    if (!p) return;
    ADD = ADD && ADD.pid === pid ? ADD : { pid: pid, mode: 'colour', hex: '', qty: {}, nameEn: '', nameAr: '' };
    openModal({ title: t('cl_add_more') + ' · ' + esc(p.name), size: 'wide', body: '<div id="cfAdd">' + addBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-cf="add-save">' + t('save') + '</button>',
      onClose: function () { /* keep what was typed for this product */ } });
  }

  function placeSelect(id) {
    return '<select class="inp" id="' + id + '">' + DB.warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === DB.intakeWh ? ' selected' : '') + '>' +
        esc(DB.whName(w.id, OG.lang === 'ar')) + '</option>';
    }).join('') + '</select>';
  }

  function addBody() {
    var p = DB.product(ADD.pid);
    var h = '<div class="seg-row cf-mode">' +
      '<button class="seg' + (ADD.mode === 'colour' ? ' on' : '') + '" data-cf="add-mode" data-m="colour">' + t('cl_new_colour') + '</button>' +
      '<button class="seg' + (ADD.mode === 'size' ? ' on' : '') + '" data-cf="add-mode" data-m="size">' + t('cl_new_size') + '</button></div>';
    if (ADD.mode === 'colour') {
      h += '<div class="cf-names mt">' +
        '<label class="field"><span>' + t('cl_name_en') + '</span><input class="inp" dir="ltr" id="cfaEn" maxlength="40" value="' + esc(ADD.nameEn) + '"></label>' +
        '<label class="field"><span>' + t('cl_name_ar') + '</span><input class="inp" dir="rtl" lang="ar" id="cfaAr" maxlength="40" value="' + esc(ADD.nameAr) + '"></label>' +
      '</div><div class="cf-palette">';
      PALETTE.forEach(function (x) {
        h += '<button class="cf-sw' + (ADD.hex === x[0] ? ' on' : '') + '" style="background:' + x[0] + '" data-cf="add-hex" data-hex="' + x[0] +
          '" data-en="' + esc(x[1]) + '" data-ar="' + esc(x[2]) + '" title="' + esc(OG.lang === 'ar' ? x[2] : x[1]) + '"></button>';
      });
      h += '</div><span class="lbl">' + t('cl_qty_arrives') + '</span><div class="cf-sizes">';
      (DB.sizeSets[p.type] || []).forEach(function (s) {
        var q = ADD.qty[s] === undefined ? '' : ADD.qty[s];
        h += '<div class="cf-size"><b dir="ltr">' + esc(s) + '</b><div class="cf-step">' +
          '<button data-cf="add-step" data-size="' + esc(s) + '" data-d="-1">−</button>' +
          '<input type="number" min="0" step="1" dir="ltr" placeholder="0" value="' + esc(String(q)) + '" data-cf-add="' + esc(s) + '">' +
          '<button data-cf="add-step" data-size="' + esc(s) + '" data-d="1">+</button></div></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="row3 mt">' +
        '<label class="field"><span>' + t('cl_colour') + '</span><select class="inp" id="cfsColour">' +
          (p.colours || []).map(function (c) { return '<option value="' + c.id + '">' + esc(DB.colourName(c)) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="field"><span>' + t('cl_size') + '</span><input class="inp" dir="ltr" id="cfsSize" maxlength="12" placeholder="46"></label>' +
        '<label class="field"><span>' + t('cl_qty_arrives') + '</span><input class="inp num" type="number" min="0" step="1" dir="ltr" id="cfsQty" value="0"></label>' +
      '</div>';
    }
    h += '<label class="field mt"><span>' + t('wh_intake') + '</span>' + placeSelect('cfaWh') + '</label>' +
      '<p class="muted small">' + t('cl_first_hint') + '</p>';
    return h;
  }

  function repaintAdd() {
    var host = document.getElementById('cfAdd');
    if (!host) return;
    var en = document.getElementById('cfaEn'), ar = document.getElementById('cfaAr');
    if (en) ADD.nameEn = en.value;
    if (ar) ADD.nameAr = ar.value;
    host.innerHTML = addBody();
  }

  function saveAdd() {
    var pid = ADD.pid;
    var wh = (document.getElementById('cfaWh') || {}).value || DB.intakeWh;
    var send;
    if (ADD.mode === 'colour') {
      var en = ((document.getElementById('cfaEn') || {}).value || '').trim();
      var ar = ((document.getElementById('cfaAr') || {}).value || '').trim();
      if (!en && !ar) { toast(t('cl_new_colour'), t('cl_need_name'), 'warn'); return; }
      var sizesOut = Object.keys(ADD.qty).filter(function (s) { return ADD.qty[s] !== '' && Number(ADD.qty[s]) >= 0; })
        .map(function (s) { return { size: s, qty: Number(ADD.qty[s]) || 0 }; })
        .filter(function (x) { return x.qty > 0; });
      if (!sizesOut.length) { toast(t('cl_new_colour'), t('cl_empty_warn').replace('{name}', en || ar), 'warn', 6000); return; }
      send = function () { return Shop.addColour(pid, { nameEn: en, nameAr: ar, hex: ADD.hex || undefined, sizes: sizesOut, whId: wh }); };
    } else {
      var size = ((document.getElementById('cfsSize') || {}).value || '').trim();
      var qty = Math.floor(Number((document.getElementById('cfsQty') || {}).value) || 0);
      var colourId = Number((document.getElementById('cfsColour') || {}).value);
      if (!size) { toast(t('cl_new_size'), t('cl_size'), 'warn'); return; }
      if (qty < 0) { toast(t('cl_new_size'), t('cl_no_neg'), 'warn'); return; }
      send = function () { return Shop.addSize(pid, { size: size, colourId: colourId, qty: qty, whId: wh }); };
    }
    /* Said only once the server has it — the dialog stays, with what was
       typed, if it refuses. */
    var btn = document.querySelector('[data-cf="add-save"]');
    if (btn) btn.disabled = true;
    send().then(function () {
      ADD = null;
      closeModal();
      return Shop.reload();
    }).then(function () {
      toast(t('cl_add_more'), t('cl_saved'), 'ok', 2500);
      if (typeof openProductDrawer === 'function') openProductDrawer(pid);
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      toast(t('cl_add_more'), API.friendly(err), 'err', 6000);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-cf]') : null;
    if (!b) return;
    var a = b.getAttribute('data-cf');
    if (a === 'add-more') { closeDrawer(); openAdd(+b.getAttribute('data-pid')); return; }
    if (!ADD) return;
    if (a === 'add-mode') { ADD.mode = b.getAttribute('data-m'); repaintAdd(); return; }
    if (a === 'add-hex') {
      ADD.hex = b.getAttribute('data-hex');
      var en = document.getElementById('cfaEn'), ar = document.getElementById('cfaAr');
      if (en && ar && !en.value && !ar.value) { en.value = b.getAttribute('data-en'); ar.value = b.getAttribute('data-ar'); }
      repaintAdd();
      return;
    }
    if (a === 'add-step') {
      var s = b.getAttribute('data-size');
      ADD.qty[s] = Math.max(0, (Number(ADD.qty[s]) || 0) + Number(b.getAttribute('data-d')));
      var inp = document.querySelector('[data-cf-add="' + s + '"]');
      if (inp) inp.value = ADD.qty[s];
      return;
    }
    if (a === 'add-save') saveAdd();
  });
  document.addEventListener('input', function (e) {
    var s = e.target.getAttribute && e.target.getAttribute('data-cf-add');
    if (!s || !ADD) return;
    var n = Math.floor(Number(e.target.value));
    if (e.target.value !== '' && !(n >= 0)) { n = 0; e.target.value = '0'; }
    ADD.qty[s] = e.target.value === '' ? '' : n;
  });

  return {
    matrix: matrix, openAdd: openAdd,
    html: html, list: list, grand: grand, colourTotal: colourTotal,
    payload: payload, flag: flag, reset: reset, label: label, sizes: sizes
  };
})();
