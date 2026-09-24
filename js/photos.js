/* ==========================================================================
   PRODUCT PHOTOS                                                     [Photos]
   --------------------------------------------------------------------------
   The owner's rule (24 Sep 2026): every colour of every product has AT LEAST
   TWO photos before the website may show it — FIRST somebody wearing it (the
   model photo), SECOND the product on its own — and may have more. A colour
   missing either stays off the website; the shop still sells it, prints its
   labels and counts it. The server decides that (server/lib/photos.js and
   Cat.webList); this file draws it and says what is missing, in words.

   Four places use it:
   - the manager dialog — Photos.open(productId, colourId) — one colour at a
     time, a chip per colour, two numbered slots and the extras;
   - the product drawer's card — Photos.card(p);
   - the Products list's mark — Photos.mark(p) — and its "needs photos" filter;
   - the Add-product form — Photos.formStrip(colour) inside each colour card,
     sent by Photos.sendDrafts() once the product exists.

   EVERY PHOTO GOES UP TWICE, from one file: a large JPEG for the website
   (at most 1600 px on the long side) and a small one for the till (at most
   480 px). The till draws dozens of thumbnails over the shop's wifi; the
   website shows one photo big. One size cannot serve both.

   A PHOTO IS PAINTED ON WHITE. A transparent PNG turned into a JPEG goes
   black where it was clear — a product cut out on a transparent background
   would arrive as a shoe on a black square.

   STATE THAT MUST SURVIVE A REPAINT LIVES HERE (S), never on the DOM: which
   colour is showing, which "…" menu is open, which photos are on their way.
   The dialog repaints #phRoot and nothing else — never render() under it.

   Events are delegated: data-ph (click). The file input is ONE element on
   <body>, made the first time it is needed, so no repaint can take it away
   between the press and the file arriving.
   ========================================================================== */

var Photos = (function () {

  var FULL_PX = 1600, THUMB_PX = 480;
  /* A phone photo is 3–12 MB; a camera's can be more. The limit is on what
     is read, not on what is sent — what is sent is the shrunk JPEG. */
  var IN_MAX = 30 * 1024 * 1024;
  /* The large JPEG as a data URL. The server takes 4 MB per request and the
     bucket 2 MB per file; this keeps a photo well inside both. */
  var FULL_MAX_CHARS = 1900000;
  var MAX_EXTRA = 8;
  var KINDS = ['model', 'product'];

  var S = { pid: null, cid: null, menu: null, arm: null, sending: [], pick: null, fromDrawer: false };

  /* ------------------------------------------------------------ reading */

  function draw(im, px, q) {
    var w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height;
    var scale = Math.min(1, px / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    cx.fillStyle = '#FFFFFF';
    cx.fillRect(0, 0, w, h);
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(im, 0, 0, w, h);
    return { data: cv.toDataURL('image/jpeg', q), width: w, height: h };
  }

  /* One file → { full, thumb, width, height } or an error code the
     up_err_* strings already name: type · size · decode. */
  function read(file, done) {
    if (!file) { done(null, 'none'); return; }
    if (String(file.type || '').indexOf('image/') !== 0) { done(null, 'type'); return; }
    if (file.size > IN_MAX) { done(null, 'size'); return; }
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onerror = function () { URL.revokeObjectURL(url); done(null, 'decode'); };
    im.onload = function () {
      try {
        var q = 0.86, big = draw(im, FULL_PX, q);
        while (big.data.length > FULL_MAX_CHARS && q > 0.62) { q -= 0.08; big = draw(im, FULL_PX, q); }
        if (big.data.length > FULL_MAX_CHARS) big = draw(im, 1200, 0.78);
        var small = draw(im, THUMB_PX, 0.82);
        URL.revokeObjectURL(url);
        done({ full: big.data, thumb: small.data, width: big.width, height: big.height }, null);
      } catch (e) {
        URL.revokeObjectURL(url);
        done(null, 'decode');
      }
    };
    im.src = url;
  }

  /* The shared up_err_* words, except the size: this reader takes a bigger
     file than the old one did, and the old sentence names the old limit. */
  function readErr(err) { return err === 'size' ? t('ph_err_size') : t('up_err_' + err); }

  function input() {
    var el = document.getElementById('phFile');
    if (!el) {
      el = document.createElement('input');
      el.type = 'file';
      el.accept = 'image/*';
      el.id = 'phFile';
      el.hidden = true;
      el.addEventListener('change', function () {
        var files = [].slice.call(el.files || []);
        el.value = '';
        var pick = S.pick;
        S.pick = null;
        if (!pick || !files.length) return;
        if (pick.form) takeForForm(pick.key, pick.kind, files);
        else upload(pick.pid, pick.cid, pick.kind, files);
      });
      document.body.appendChild(el);
    }
    return el;
  }

  function choose(pick) {
    S.pick = pick;
    var el = input();
    el.multiple = pick.kind === 'extra';
    el.click();
  }

  /* ------------------------------------------------------------ reading the catalogue */

  function list(p) { return (p && p.photos) || []; }
  function slots(p, cid) {
    var mine = list(p).filter(function (x) { return x.colourId === cid; });
    return {
      model: mine.filter(function (x) { return x.kind === 'model'; })[0] || null,
      product: mine.filter(function (x) { return x.kind === 'product'; })[0] || null,
      extras: mine.filter(function (x) { return x.kind === 'extra'; })
    };
  }
  function ready(p, cid) { var s = slots(p, cid); return !!(s.model && s.product); }
  function missing(p, cid) {
    var s = slots(p, cid);
    return KINDS.filter(function (k) { return !s[k]; });
  }
  function colours(p) { return (p && p.colours) || []; }
  function readyCount(p) { return colours(p).filter(function (c) { return ready(p, c.id); }).length; }

  /* What the website shows of this product, as the server decides it:
     off (switched off or archived) · live (at least one colour ready) ·
     waiting (switched on, and no colour has both photos yet). */
  function webState(p) {
    if (!p || p.onWeb === false || p.archived || p.hidden) return 'off';
    return readyCount(p) ? 'live' : 'waiting';
  }

  function colourLabel(c) { return DB.colourName ? DB.colourName(c) : (OG.lang === 'ar' ? c.nameAr : c.nameEn); }

  function missingWords(kinds) {
    return kinds.map(function (k) { return t('ph_need_' + k); }).join(' · ');
  }

  /* ------------------------------------------------------------ small pieces */

  var CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>';

  /* The Products list's mark: one colour counts its two photos (1/2), several
     colours count the colours that are ready (1/3). Amber until done. */
  function mark(p) {
    var cs = colours(p);
    if (!cs.length) return '';
    var done, of, tip;
    if (cs.length === 1) {
      of = 2;
      done = of - missing(p, cs[0].id).length;
      tip = done === 2 ? t('ph_ready') : t('ph_missing') + ': ' + missingWords(missing(p, cs[0].id));
    } else {
      of = cs.length;
      done = readyCount(p);
      tip = t('ph_colours_ready').replace('{n}', done).replace('{m}', of);
    }
    var ok = done === of;
    return '<span class="ph-mark' + (ok ? ' ok' : '') + '" title="' + esc(tip) + '">' + CAM +
      '<bdi dir="ltr">' + done + '/' + of + '</bdi></span>';
  }

  /* The drawer's line under "On website". */
  function webLine(p) {
    var st = webState(p);
    if (st === 'off') return t('no');
    if (st === 'waiting') return '<span class="warn">' + t('ph_web_waiting') + '</span>';
    var n = readyCount(p), m = colours(p).length;
    return t('yes') + (n < m ? ' · <span class="warn">' + t('ph_web_some').replace('{n}', m - n) + '</span>' : '');
  }

  function canEdit() {
    return typeof allow === 'function' && allow('product.write') && typeof Shop !== 'undefined' && Shop.live();
  }

  function mini(photo, n) {
    if (photo) return '<img class="ph-mini" src="' + esc(photo.thumbUrl) + '" alt="" loading="lazy">';
    return '<span class="ph-mini ph-mini-empty" aria-hidden="true"><bdi dir="ltr">' + n + '</bdi></span>';
  }

  /* ------------------------------------------------------------ the drawer card */

  function card(p) {
    var cs = colours(p);
    if (!cs.length) return '';
    var many = cs.length > 1, edit = canEdit();
    var st = webState(p);
    var badge = st === 'live' ? '<span class="badge healthy">' + t('ph_on_web') + '</span>'
      : st === 'waiting' ? '<span class="badge low">' + t('ph_web_waiting') + '</span>'
      : '<span class="badge neutral">' + t('ph_off_web') + '</span>';
    var h = '<div class="card mb ph-card"><div class="card-head"><h3>' + t('ph_title') + '</h3>' +
      '<div class="card-actions">' + badge + '</div></div><div class="card-body">';
    cs.forEach(function (c) {
      var s = slots(p, c.id), miss = missing(p, c.id);
      h += '<div class="ph-row">' +
        (many ? '<span class="line-colour ph-row-name">' + DB.swatch(c) + '<b>' + esc(colourLabel(c)) + '</b></span>' : '') +
        '<div class="ph-strip">' + mini(s.model, 1) + mini(s.product, 2) +
          s.extras.slice(0, 3).map(function (x) { return mini(x); }).join('') +
          (s.extras.length > 3 ? '<span class="ph-more"><bdi dir="ltr">+' + (s.extras.length - 3) + '</bdi></span>' : '') +
        '</div>' +
        '<div class="ph-row-state">' + (miss.length
          ? '<span class="warn">' + esc(t('ph_missing') + ': ' + missingWords(miss)) + '</span>'
          : '<span class="ok-text">✓ ' + esc(t('ph_ready')) + '</span>') + '</div>' +
        (edit ? '<button class="btn btn-sm' + (miss.length ? ' btn-primary' : '') + '" data-ph="open" data-pid="' + p.id +
          '" data-cid="' + c.id + '">' + t(miss.length ? 'ph_add_btn' : 'ph_edit_btn') + '</button>' : '') +
      '</div>';
    });
    return h + '</div></div>';
  }

  /* ------------------------------------------------------------ the manager dialog */

  function open(pid, cid, opts) {
    var p = DB.product(pid);
    if (!p || !colours(p).length) return;
    S.pid = pid;
    S.menu = null; S.arm = null;
    var first = colours(p).filter(function (c) { return !ready(p, c.id); })[0] || colours(p)[0];
    S.cid = cid && colours(p).some(function (c) { return c.id === Number(cid); }) ? Number(cid) : first.id;
    S.fromDrawer = !!(opts && opts.fromDrawer) || !!document.querySelector('#drawer-root .drawer');
    openModal({
      title: t('ph_title') + ' · ' + esc(p.name),
      size: 'wide',
      body: '<div id="phRoot">' + body() + '</div>',
      foot: '<button class="btn btn-primary" data-act="modal-close">' + t('ph_done') + '</button>',
      onClose: function () {
        var was = S.pid, drawer = S.fromDrawer;
        S.pid = null; S.menu = null; S.arm = null;
        /* The drawer under the dialog was drawn before the photos changed. */
        if (drawer && was != null && document.querySelector('#drawer-root .drawer') &&
            typeof openProductDrawer === 'function') {
          setTimeout(function () { openProductDrawer(was); }, 0);
        }
      }
    });
  }

  function repaint() {
    var host = document.getElementById('phRoot');
    if (!host || S.pid == null) return;
    host.innerHTML = body();
  }

  function body() {
    var p = DB.product(S.pid);
    if (!p) return '';
    var cs = colours(p), many = cs.length > 1;
    var c = cs.filter(function (x) { return x.id === S.cid; })[0] || cs[0];
    S.cid = c.id;
    var s = slots(p, c.id), miss = missing(p, c.id);
    var h = '';
    if (many) {
      h += '<div class="ph-chips" role="tablist">' + cs.map(function (x) {
        var r = ready(p, x.id), n = 2 - missing(p, x.id).length;
        return '<button class="ph-chip' + (x.id === c.id ? ' on' : '') + '" role="tab" data-ph="colour" data-cid="' + x.id + '">' +
          DB.swatch(x) + '<b>' + esc(colourLabel(x)) + '</b>' +
          '<span class="ph-chip-n' + (r ? ' ok' : '') + '">' + (r ? '✓' : '<bdi dir="ltr">' + n + '/2</bdi>') + '</span></button>';
      }).join('') + '</div>';
    }
    h += '<div class="ph-state ' + (miss.length ? 'warn' : 'ok') + '">' + (miss.length
      ? '<b>' + esc(t('ph_missing') + ': ' + missingWords(miss)) + '</b><span>' + esc(t('ph_rule')) + '</span>'
      : '<b>✓ ' + esc(t('ph_ready')) + '</b><span>' + esc(webState(p) === 'off' ? t('ph_ready_off') : t('ph_ready_sub')) + '</span>') +
    '</div>';

    h += '<div class="ph-grid">';
    h += tile(c.id, 'model', s.model, 1) + tile(c.id, 'product', s.product, 2);
    s.extras.forEach(function (x, i) { h += tile(c.id, 'extra', x, i + 3, i, s.extras.length); });
    S.sending.filter(function (x) { return x.pid === p.id && x.cid === c.id && x.kind === 'extra'; }).forEach(function (x) {
      h += busyTile(x.preview, s.extras.length + 3);
    });
    if (s.extras.length < MAX_EXTRA) {
      h += '<button class="ph-tile ph-add" data-ph="pick" data-kind="extra" data-cid="' + c.id + '">' +
        '<span class="ph-plus">+</span><b>' + t('ph_add_more') + '</b><small>' + t('ph_add_more_sub') + '</small></button>';
    }
    h += '</div><p class="muted small ph-foot">' + t('ph_sizes_note') + '</p>';
    return h;
  }

  function sendingFor(cid, kind) {
    return S.sending.filter(function (x) { return x.pid === S.pid && x.cid === cid && x.kind === kind; })[0] || null;
  }

  function busyTile(preview, n) {
    return '<div class="ph-tile busy"><span class="ph-tag"><bdi dir="ltr">' + n + '</bdi></span>' +
      '<span class="ph-img"><img src="' + preview + '" alt=""></span>' +
      '<span class="ph-spin"><i></i>' + t('ph_sending') + '</span></div>';
  }

  function tile(cid, kind, photo, n, idx, of) {
    var tag = '<span class="ph-tag"><bdi dir="ltr">' + n + '</bdi>' + (kind !== 'extra' ? ' ' + esc(t('ph_slot_' + kind)) : '') + '</span>';
    var busy = kind !== 'extra' ? sendingFor(cid, kind) : null;
    if (busy) return busyTile(busy.preview, n);
    if (!photo) {
      return '<button class="ph-tile empty req" data-ph="pick" data-kind="' + kind + '" data-cid="' + cid + '">' + tag +
        '<span class="ph-cam">' + CAM + '</span><b>' + t('ph_pick_' + kind) + '</b>' +
        '<small>' + t('ph_pick_' + kind + '_sub') + '</small></button>';
    }
    var h = '<div class="ph-tile filled' + (kind !== 'extra' ? ' req' : '') + '">' + tag +
      '<a class="ph-img" href="' + esc(photo.url) + '" target="_blank" rel="noopener"><img src="' + esc(photo.thumbUrl) +
        '" alt="" loading="lazy"></a>' +
      '<button class="ph-dots" data-ph="menu" data-id="' + photo.id + '" aria-label="' + esc(t('nav_more')) + '">⋯</button>';
    if (S.menu === photo.id) {
      var items = [];
      if (kind !== 'extra') items.push(['replace', 'ph_replace']);
      if (kind !== 'model') items.push(['as-model', 'ph_as_model']);
      if (kind !== 'product') items.push(['as-product', 'ph_as_product']);
      if (kind === 'extra' && idx > 0) items.push(['left', 'ph_earlier']);
      if (kind === 'extra' && idx < of - 1) items.push(['right', 'ph_later']);
      h += '<div class="ph-menu" role="menu">' + items.map(function (it) {
        return '<button role="menuitem" data-ph="' + it[0] + '" data-id="' + photo.id + '" data-kind="' + kind + '" data-cid="' + cid + '">' +
          t(it[1]) + '</button>';
      }).join('') +
        '<button role="menuitem" class="ph-danger' + (S.arm === photo.id ? ' armed' : '') + '" data-ph="remove" data-id="' + photo.id + '">' +
          t(S.arm === photo.id ? 'ph_remove_sure' : 'ph_remove') + '</button></div>';
    }
    return h + '</div>';
  }

  /* ------------------------------------------------------------ sending */

  function whyFailed(err) {
    var code = err && err.code;
    if (code === 'not_configured') return t('ph_err_no_cloud');
    if (code === 'too_many') return t('ph_err_too_many').replace('{n}', MAX_EXTRA);
    if (code === 'too_large' || (err && err.status === 413)) return t('ph_err_big');
    if (code === 'not_found' || (err && err.status === 404)) return t('img_stale_server');
    return API.friendly(err);
  }

  function upload(pid, cid, kind, files) {
    /* A slot takes one photo; "add more" takes as many as fit. */
    var p = DB.product(pid);
    var room = kind === 'extra' ? Math.max(0, MAX_EXTRA - slots(p, cid).extras.length) : 1;
    files = files.slice(0, room);
    if (!files.length) return;
    var ok = 0, bad = 0, i = 0;
    function next() {
      if (i >= files.length) { finish(); return; }
      var f = files[i++];
      read(f, function (out, err) {
        if (err) { bad++; toast(t('ph_title'), readErr(err), 'err', 5000); next(); return; }
        var job = { pid: pid, cid: cid, kind: kind, preview: out.thumb };
        S.sending.push(job);
        repaint();
        Shop.addPhoto(pid, { colourId: cid, kind: kind, full: out.full, thumb: out.thumb, width: out.width, height: out.height })
          .then(function () { ok++; })
          .catch(function (e) { bad++; toast(t('ph_title'), t('ph_not_saved') + ' ' + whyFailed(e), 'err', 9000); })
          .then(function () {
            S.sending = S.sending.filter(function (x) { return x !== job; });
            next();
          });
      });
    }
    function finish() {
      if (!ok) { repaint(); return; }
      Shop.reload().then(function () {
        /* Shop.reload() has already redrawn the page behind the dialog. */
        repaint();
        var q = DB.product(pid);
        toast(t('ph_title'), (ok === 1 ? t('ph_saved_1') : t('ph_saved_n').replace('{n}', ok)) +
          (q && ready(q, cid) ? ' · ' + t('ph_ready') : ''), 'ok', 3000);
      });
    }
    next();
  }

  function modalOpenFor() { return !!document.getElementById('phRoot'); }

  /* A change to a photo that is already there: its slot, its place, or gone. */
  function change(promise, done) {
    return promise.then(function () { return Shop.reload(); }).then(function () {
      S.menu = null; S.arm = null;
      repaint();
      if (done) done();
    }).catch(function (e) {
      toast(t('ph_title'), t('ph_not_saved') + ' ' + whyFailed(e), 'err', 8000);
      repaint();
    });
  }

  /* ------------------------------------------------------------ the Add-product form */

  function blankDrafts() { return { model: null, product: null, extra: [] }; }

  function drafts(c) {
    if (!c.photos) c.photos = blankDrafts();
    return c.photos;
  }

  function formTile(c, kind, d, n, i) {
    var tag = '<span class="ph-tag"><bdi dir="ltr">' + n + '</bdi>' + (kind !== 'extra' ? ' ' + esc(t('ph_slot_' + kind)) : '') + '</span>';
    if (!d) {
      return '<button type="button" class="ph-tile empty req" data-ph="f-pick" data-k="' + c.key + '" data-kind="' + kind + '">' + tag +
        '<span class="ph-cam">' + CAM + '</span><b>' + t('ph_pick_' + kind) + '</b></button>';
    }
    return '<div class="ph-tile filled' + (kind !== 'extra' ? ' req' : '') + '">' + tag +
      '<span class="ph-img"><img src="' + d.thumb + '" alt=""></span>' +
      '<button type="button" class="ph-x" data-ph="f-clear" data-k="' + c.key + '" data-kind="' + kind + '"' +
        (i !== undefined ? ' data-i="' + i + '"' : '') + ' aria-label="' + esc(t('remove')) + '">✕</button></div>';
  }

  function formStrip(c) {
    var d = drafts(c);
    var h = '<div class="ph-form" data-ph-form="' + c.key + '"><div class="ph-form-top"><span class="lbl">' + t('ph_title') + '</span>' +
      '<small class="muted">' + t('ph_form_hint') + '</small></div><div class="ph-grid ph-grid-sm">' +
      formTile(c, 'model', d.model, 1) + formTile(c, 'product', d.product, 2);
    d.extra.forEach(function (x, i) { h += formTile(c, 'extra', x, i + 3, i); });
    if (d.extra.length < MAX_EXTRA) {
      h += '<button type="button" class="ph-tile ph-add" data-ph="f-pick" data-k="' + c.key + '" data-kind="extra">' +
        '<span class="ph-plus">+</span><b>' + t('ph_add_more') + '</b></button>';
    }
    return h + '</div></div>';
  }

  function repaintForm(key) {
    var c = ColourForm.colour(key);
    var el = document.querySelector('[data-ph-form="' + key + '"]');
    if (c && el) el.outerHTML = formStrip(c);
  }

  function takeForForm(key, kind, files) {
    var c = ColourForm.colour(key);
    if (!c) return;
    var d = drafts(c);
    var i = 0;
    (function next() {
      if (i >= files.length) return;
      var f = files[i++];
      read(f, function (out, err) {
        if (err) { toast(t('ph_title'), readErr(err), 'err', 5000); next(); return; }
        if (kind === 'extra') { if (d.extra.length < MAX_EXTRA) d.extra.push(out); }
        else d[kind] = out;
        repaintForm(key);
        if (kind !== 'extra') return;
        next();
      });
    })();
  }

  /* A picture pasted or dropped onto the Add-product form: the first colour's
     first empty slot — the model, then the product, then an extra. */
  function takeFirstEmpty(file) {
    var c = ColourForm.colour(null);
    if (!c) return;
    var d = drafts(c);
    var kind = !d.model ? 'model' : !d.product ? 'product' : 'extra';
    takeForForm(c.key, kind, [file]);
  }

  /* After the product exists: every colour's drafts, in order, one request
     at a time, then one reload and one toast. The product is saved whatever
     happens here; a photo that did not land is said, and can be added from
     the product's drawer. `made` is the server's colours, in the order the
     form sent them. */
  function sendDrafts(pid, made, draftList, done) {
    var queue = [];
    (made || []).forEach(function (c, i) {
      var d = draftList[i];
      if (!d) return;
      if (d.model) queue.push({ cid: c.id, kind: 'model', d: d.model });
      if (d.product) queue.push({ cid: c.id, kind: 'product', d: d.product });
      (d.extra || []).forEach(function (x) { queue.push({ cid: c.id, kind: 'extra', d: x }); });
    });
    if (!queue.length || !Shop.live()) { if (done) done(0, 0); return false; }
    var ok = 0, bad = 0, why = '';
    toast(t('ph_title'), t('ph_sending_n').replace('{n}', queue.length), null, 3000);
    (function next(i) {
      if (i >= queue.length) {
        Shop.reload().then(function () {
          if (bad) toast(t('ph_title'), t('ph_some_failed').replace('{n}', bad) + ' ' + why, 'err', 10000);
          else toast(t('ph_title'), ok === 1 ? t('ph_saved_1') : t('ph_saved_n').replace('{n}', ok), 'ok', 3000);
          if (done) done(ok, bad);
        });
        return;
      }
      var q = queue[i];
      Shop.addPhoto(pid, { colourId: q.cid, kind: q.kind, full: q.d.full, thumb: q.d.thumb, width: q.d.width, height: q.d.height })
        .then(function () { ok++; })
        .catch(function (e) { bad++; why = whyFailed(e); })
        .then(function () { next(i + 1); });
    })(0);
    return true;
  }

  /* ------------------------------------------------------------ events */

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ph]') : null;
    if (!b) return;
    var a = b.getAttribute('data-ph');
    var id = Number(b.getAttribute('data-id'));
    var cid = Number(b.getAttribute('data-cid'));
    var kind = b.getAttribute('data-kind');

    if (a === 'open') { open(Number(b.getAttribute('data-pid')), cid, { fromDrawer: true }); return; }
    if (a === 'colour') { S.cid = cid; S.menu = null; S.arm = null; repaint(); return; }
    if (a === 'pick') { S.menu = null; choose({ pid: S.pid, cid: cid, kind: kind }); return; }
    if (a === 'menu') { e.preventDefault(); S.menu = S.menu === id ? null : id; S.arm = null; repaint(); return; }
    if (a === 'replace') { S.menu = null; repaint(); choose({ pid: S.pid, cid: cid, kind: kind }); return; }
    if (a === 'as-model' || a === 'as-product') {
      change(Shop.patchPhoto(id, { kind: a === 'as-model' ? 'model' : 'product' }));
      return;
    }
    if (a === 'left' || a === 'right') { change(Shop.patchPhoto(id, { move: a === 'left' ? -1 : 1 })); return; }
    if (a === 'remove') {
      /* Two presses: the file leaves the bucket, and a photo taken on a
         busy afternoon is not something anybody wants to take twice. */
      if (S.arm !== id) {
        S.arm = id; repaint();
        setTimeout(function () { if (S.arm === id) { S.arm = null; repaint(); } }, 4000);
        return;
      }
      change(Shop.removePhoto(id));
      return;
    }

    /* the Add-product form */
    var key = b.getAttribute('data-k');
    if (a === 'f-pick') { choose({ form: true, key: key, kind: kind }); return; }
    if (a === 'f-clear') {
      var c = ColourForm.colour(key);
      if (!c) return;
      var d = drafts(c);
      if (kind === 'extra') d.extra.splice(Number(b.getAttribute('data-i')), 1);
      else d[kind] = null;
      repaintForm(key);
    }
  });

  /* An open "…" menu shuts on a press anywhere else — in the capture phase,
     before the dispatcher, the way the board's row menu does it. */
  document.addEventListener('mousedown', function (e) {
    if (S.menu == null) return;
    if (e.target.closest && e.target.closest('.ph-menu, .ph-dots')) return;
    S.menu = null; S.arm = null; repaint();
  }, true);

  /* A photo dropped onto an empty slot of the dialog, or pasted while it is
     open, goes into that slot — or the first empty one. */
  document.addEventListener('dragover', function (e) {
    if (e.target.closest && e.target.closest('#phRoot .ph-tile, .ph-form .ph-tile')) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    var tileEl = e.target.closest && e.target.closest('#phRoot [data-ph="pick"], .ph-form [data-ph="f-pick"]');
    if (!tileEl) return;
    e.preventDefault();
    var files = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    var kind = tileEl.getAttribute('data-kind');
    if (tileEl.getAttribute('data-ph') === 'f-pick') takeForForm(tileEl.getAttribute('data-k'), kind, kind === 'extra' ? files : files.slice(0, 1));
    else upload(S.pid, Number(tileEl.getAttribute('data-cid')), kind, kind === 'extra' ? files : files.slice(0, 1));
  });
  document.addEventListener('paste', function (e) {
    if (!modalOpenFor() || S.pid == null) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].type).indexOf('image/') === 0) {
        e.preventDefault();
        var p = DB.product(S.pid), s = slots(p, S.cid);
        upload(S.pid, S.cid, !s.model ? 'model' : !s.product ? 'product' : 'extra', [items[i].getAsFile()]);
        return;
      }
    }
  });

  return {
    open: open,
    card: card,
    mark: mark,
    webLine: webLine,
    webState: webState,
    ready: ready,
    readyCount: readyCount,
    missing: missing,
    formStrip: formStrip,
    blankDrafts: blankDrafts,
    takeFirstEmpty: takeFirstEmpty,
    sendDrafts: sendDrafts,
    read: read,
    MAX_EXTRA: MAX_EXTRA
  };
})();
