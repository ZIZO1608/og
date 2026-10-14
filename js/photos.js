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

   073 — under the gallery in the dialog, each colour's four 3D ANGLES
   (front and back needed, left and right optional): the photos a 3D model
   is made from. Kept apart from the gallery; the website never shows them.

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
        if (pick.form && pick.angle) takeAngleForForm(pick.key, pick.angle, files[0]);
        else if (pick.form) takeForForm(pick.key, pick.kind, files);
        else if (pick.angle) uploadAngle(pick.pid, pick.cid, pick.angle, files[0]);
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

  /* 073 — the 3D angles: the photos a 3D model is made from, kept apart from
     the gallery (server/lib/angles.js). Front and back are needed before a
     model can be asked for; left and right make a better one. */
  var ANGLES = ['front', 'back', 'left', 'right'];
  var ANGLES_REQ = ['front', 'back'];
  function angleSlots(p, cid) {
    var out = {};
    ((p && p.angles) || []).forEach(function (a) { if (a.colourId === cid) out[a.angle] = a; });
    return out;
  }
  function anglesMissing(p, cid) {
    var s = angleSlots(p, cid);
    return ANGLES_REQ.filter(function (k) { return !s[k]; });
  }
  function anglesReady(p, cid) { return !anglesMissing(p, cid).length; }
  function anglesReadyCount(p) {
    return ((p && p.colours) || []).filter(function (c) { return anglesReady(p, c.id); }).length;
  }
  function angleWords(list) { return list.map(function (k) { return t('a3_' + k); }).join(' · '); }
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

  /* 073 — the same mark for the 3D angles, beside the camera: one colour
     counts its front and back (1/2), several count the colours that have
     both (1/3). Left and right are optional and never make it amber. */
  function angleMark(p) {
    var cs = colours(p);
    if (!cs.length) return '';
    var done, of, tip;
    if (cs.length === 1) {
      var miss = anglesMissing(p, cs[0].id);
      of = 2; done = of - miss.length;
      tip = miss.length ? t('a3_missing') + ': ' + angleWords(miss) : t('a3_ready');
    } else {
      of = cs.length; done = anglesReadyCount(p);
      tip = t('a3_colours_ready').replace('{n}', done).replace('{m}', of);
    }
    return '<span class="ph-mark ph-mark-3d' + (done === of ? ' ok' : '') + '" title="' + esc(tip) + '">' +
      '<i dir="ltr">3D</i><bdi dir="ltr">' + done + '/' + of + '</bdi></span>';
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

  /* ------------------------------------------------------------ the drawer's gallery

     EVERY PHOTO, BIG, WHERE SOMEBODY LOOKS AT THE PRODUCT. The drawer used to
     squeeze a colour's photos into 36 px thumbnails, so a product with its
     model, its product and two more read as four smudges (the owner, 24 Sep:
     "make the 4 images appear"). Now: the chosen photo large and whole
     (contain, never cropped — this is where somebody checks what the website
     will show), every photo of that colour underneath in the website's own
     order, arrows and a swipe to walk them, and a chip per colour when there
     is more than one.

     Which photo is showing lives in G, never on the DOM: the drawer is redrawn
     when the manager closes and on a save, and a gallery that jumped back to
     photo 1 on every redraw would be one nobody could look through. A step or
     a pick repaints the gallery alone (repaintGal), never the drawer. */

  var G = { pid: null, cid: null, i: 0 };

  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>';

  function galColour(p) {
    var cs = colours(p);
    if (G.pid === p.id && cs.some(function (c) { return c.id === G.cid; })) return G.cid;
    var has = cs.filter(function (c) { return list(p).some(function (x) { return x.colourId === c.id; }); })[0];
    return (has || cs[0]).id;
  }

  function photoLabel(ph, n) {
    return ph.kind === 'extra' ? t('ph_photo_n').replace('{n}', n) : n + ' ' + t('ph_slot_' + ph.kind);
  }

  function gallery(p) {
    var cs = colours(p), many = cs.length > 1, edit = canEdit();
    var cid = galColour(p);
    if (G.pid !== p.id || G.cid !== cid) { G.pid = p.id; G.cid = cid; G.i = 0; }
    /* list(p) is already in the website's order: model, product, extras. */
    var photos = list(p).filter(function (x) { return x.colourId === cid; });
    if (G.i >= photos.length || G.i < 0) G.i = 0;
    var miss = missing(p, cid);
    var h = '<div class="ph-gal" data-ph-gal="' + p.id + '">';

    if (many) {
      h += '<div class="ph-chips">' + cs.map(function (x) {
        var r = ready(p, x.id), n = 2 - missing(p, x.id).length;
        return '<button class="ph-chip' + (x.id === cid ? ' on' : '') + '" data-ph="g-colour" data-pid="' + p.id + '" data-cid="' + x.id + '">' +
          DB.swatch(x) + '<b>' + esc(colourLabel(x)) + '</b>' +
          '<span class="ph-chip-n' + (r ? ' ok' : '') + '">' + (r ? '✓' : '<bdi dir="ltr">' + n + '/2</bdi>') + '</span></button>';
      }).join('') + '</div>';
    }

    if (photos.length) {
      var ph = photos[G.i], n = G.i + 1;
      h += '<div class="ph-gal-main" data-ph-swipe="' + p.id + '">' +
        /* The small file behind the large one, so a step shows something at
           once and sharpens when the big file lands. */
        '<a class="ph-gal-img" href="' + esc(ph.url) + '" target="_blank" rel="noopener" title="' + esc(t('ph_open_full')) + '">' +
          '<img src="' + esc(ph.url) + '" alt="' + esc(photoLabel(ph, n)) + '" style="background-image:url(&quot;' + esc(ph.thumbUrl) + '&quot;)"></a>' +
        '<span class="ph-tag">' + esc(photoLabel(ph, n)) + '</span>' +
        (photos.length > 1
          ? '<span class="ph-gal-count"><bdi dir="ltr">' + n + ' / ' + photos.length + '</bdi></span>' +
            '<button class="ph-gal-nav prev" data-ph="g-step" data-pid="' + p.id + '" data-d="-1" aria-label="' + esc(t('ph_prev')) + '">' + CHEV + '</button>' +
            '<button class="ph-gal-nav next" data-ph="g-step" data-pid="' + p.id + '" data-d="1" aria-label="' + esc(t('ph_next')) + '">' + CHEV + '</button>'
          : '') +
      '</div>';
      if (photos.length > 1) {
        h += '<div class="ph-gal-thumbs">' + photos.map(function (x, i) {
          return '<button class="ph-gal-thumb' + (i === G.i ? ' on' : '') + '" data-ph="g-pick" data-pid="' + p.id + '" data-i="' + i + '" ' +
            'aria-label="' + esc(photoLabel(x, i + 1)) + '"><img src="' + esc(x.thumbUrl) + '" alt="" loading="lazy">' +
            '<span><bdi dir="ltr">' + (i + 1) + '</bdi></span></button>';
        }).join('') + '</div>';
      }
    } else {
      h += '<div class="ph-gal-empty">' + CAM + '<b>' + t('ph_none_yet') + '</b><small>' + t('ph_rule') + '</small></div>';
    }

    h += '<div class="ph-gal-foot">' + (miss.length
        ? '<span class="warn">' + esc(t('ph_missing') + ': ' + missingWords(miss)) + '</span>'
        : '<span class="ok-text">✓ ' + esc(t('ph_ready')) + '</span>') +
      (edit ? '<button class="btn btn-sm' + (miss.length ? ' btn-primary' : '') + '" data-ph="open" data-pid="' + p.id +
        '" data-cid="' + cid + '">' + t(miss.length ? 'ph_add_btn' : 'ph_edit_btn') + '</button>' : '') +
    '</div>';
    /* 073 — this colour's 3D angles, in words: a tooltip on the list's mark
       is no answer on a phone. */
    var miss3 = anglesMissing(p, cid);
    h += '<p class="ph-gal-3d">' + (miss3.length
      ? '<span class="warn">' + esc(t('a3_missing') + ': ' + angleWords(miss3)) + '</span>'
      : '<span class="ok-text">✓ ' + esc(t('a3_ready')) + '</span>') + '</p>';
    return h + '</div>';
  }

  function repaintGal(pid) {
    var el = document.querySelector('[data-ph-gal="' + pid + '"]');
    var p = DB.product(pid);
    if (el && p) el.outerHTML = gallery(p);
  }

  function stepGal(pid, d) {
    var p = DB.product(pid);
    if (!p) return;
    var n = list(p).filter(function (x) { return x.colourId === galColour(p); }).length;
    if (n < 2) return;
    G.i = (G.i + d + n) % n;
    repaintGal(pid);
  }

  /* ------------------------------------------------------------ the drawer card */

  function card(p) {
    if (!colours(p).length) return '';
    var st = webState(p);
    var badge = st === 'live' ? '<span class="badge healthy">' + t('ph_on_web') + '</span>'
      : st === 'waiting' ? '<span class="badge low">' + t('ph_web_waiting') + '</span>'
      : '<span class="badge neutral">' + t('ph_off_web') + '</span>';
    return '<div class="card mb ph-card"><div class="card-head"><h3>' + t('ph_title') + '</h3>' +
      '<div class="card-actions">' + badge + '</div></div><div class="card-body">' + gallery(p) + '</div></div>';
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
    return h + angleSection(p, c.id);
  }

  /* 073 — the colour's four 3D angles, under its gallery. */
  function angleSection(p, cid) {
    var s = angleSlots(p, cid), miss = anglesMissing(p, cid);
    var badge = miss.length
      ? '<span class="badge low">' + esc(t('a3_missing') + ': ' + angleWords(miss)) + '</span>'
      : '<span class="badge healthy">✓ ' + esc(t('a3_ready')) + '</span>';
    return '<div class="ph-3d"><div class="ph-3d-head"><h4>' + t('a3_title') + '</h4>' + badge + '</div>' +
      '<p class="ph-3d-hint">' + t('a3_hint') + '</p><div class="ph-grid">' +
      ANGLES.map(function (k) { return angleTile(cid, k, s[k] || null); }).join('') + '</div></div>';
  }

  function angleTile(cid, angle, a) {
    var req = ANGLES_REQ.indexOf(angle) >= 0;
    var tag = '<span class="ph-tag">' + esc(t('a3_' + angle)) + (req ? ' *' : '') + '</span>';
    var busy = sendingFor(cid, 'a:' + angle);
    if (busy) {
      return '<div class="ph-tile busy">' + tag + '<span class="ph-img"><img src="' + busy.preview + '" alt=""></span>' +
        '<span class="ph-spin"><i></i>' + t('ph_sending') + '</span></div>';
    }
    if (!a) {
      return '<button class="ph-tile empty' + (req ? ' req' : '') + '" data-ph="a-pick" data-angle="' + angle + '" data-cid="' + cid + '">' + tag +
        '<span class="ph-cam">' + CAM + '</span><b>' + t('a3_pick_' + angle) + '</b>' +
        '<small>' + t(req ? 'a3_needed' : 'a3_optional') + '</small></button>';
    }
    var key = 'a' + a.id;
    var h = '<div class="ph-tile filled' + (req ? ' req' : '') + '">' + tag +
      '<a class="ph-img" href="' + esc(a.url) + '" target="_blank" rel="noopener"><img src="' + esc(a.thumbUrl) + '" alt="" loading="lazy"></a>' +
      '<button class="ph-dots" data-ph="menu" data-id="' + key + '" aria-label="' + esc(t('nav_more')) + '">⋯</button>';
    if (S.menu === key) {
      h += '<div class="ph-menu" role="menu">' +
        '<button role="menuitem" data-ph="a-replace" data-angle="' + angle + '" data-cid="' + cid + '">' + t('ph_replace') + '</button>' +
        '<button role="menuitem" class="ph-danger' + (S.arm === key ? ' armed' : '') + '" data-ph="a-remove" data-id="' + a.id + '">' +
          t(S.arm === key ? 'ph_remove_sure' : 'ph_remove') + '</button></div>';
    }
    return h + '</div>';
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

  /* 073 — one photo into one 3D angle; a taken angle is replaced. */
  function uploadAngle(pid, cid, angle, file) {
    read(file, function (out, err) {
      if (err) { toast(t('a3_title'), readErr(err), 'err', 5000); return; }
      var job = { pid: pid, cid: cid, kind: 'a:' + angle, preview: out.thumb };
      S.sending.push(job);
      repaint();
      Shop.addAngle(pid, { colourId: cid, angle: angle, full: out.full, thumb: out.thumb, width: out.width, height: out.height })
        .then(function () {
          return Shop.reload().then(function () {
            S.sending = S.sending.filter(function (x) { return x !== job; });
            repaint();
            var q = DB.product(pid);
            toast(t('a3_title'), t('ph_saved_1') + (q && !anglesMissing(q, cid).length ? ' · ' + t('a3_ready') : ''), 'ok', 3000);
          });
        })
        .catch(function (e) {
          S.sending = S.sending.filter(function (x) { return x !== job; });
          toast(t('a3_title'), t('ph_not_saved') + ' ' + whyFailed(e), 'err', 9000);
          repaint();
        });
    });
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

  /* `angles` holds the 073 3D angles by name (front, back, left, right). */
  function blankDrafts() { return { model: null, product: null, extra: [], angles: {} }; }

  function drafts(c) {
    if (!c.photos) c.photos = blankDrafts();
    if (!c.photos.angles) c.photos.angles = {};
    return c.photos;
  }

  /* 073 — the colour's four 3D angles on the form, under its photos. */
  function formAngleTile(c, angle, d) {
    var req = ANGLES_REQ.indexOf(angle) >= 0;
    var tag = '<span class="ph-tag">' + esc(t('a3_' + angle)) + (req ? ' *' : '') + '</span>';
    if (!d) {
      return '<button type="button" class="ph-tile empty' + (req ? ' req' : '') + '" data-ph="f-a-pick" data-k="' + c.key +
        '" data-angle="' + angle + '">' + tag + '<span class="ph-cam">' + CAM + '</span><b>' + t('a3_pick_' + angle) + '</b></button>';
    }
    return '<div class="ph-tile filled' + (req ? ' req' : '') + '">' + tag +
      '<span class="ph-img"><img src="' + d.thumb + '" alt=""></span>' +
      '<button type="button" class="ph-x" data-ph="f-a-clear" data-k="' + c.key + '" data-angle="' + angle + '" ' +
        'aria-label="' + esc(t('remove')) + '">✕</button></div>';
  }

  function formAngles(c) {
    var a = drafts(c).angles;
    return '<div class="ph-form-top ph-form-3d"><span class="lbl">' + t('a3_title') + '</span>' +
      '<small class="muted">' + t('a3_form_hint') + '</small></div><div class="ph-grid ph-grid-sm ph-3d-grid">' +
      ANGLES.map(function (k) { return formAngleTile(c, k, a[k] || null); }).join('') + '</div>';
  }

  function takeAngleForForm(key, angle, file) {
    var c = ColourForm.colour(key);
    if (!c || !file || ANGLES.indexOf(angle) < 0) return;
    read(file, function (out, err) {
      if (err) { toast(t('a3_title'), readErr(err), 'err', 5000); return; }
      drafts(c).angles[angle] = out;
      repaintForm(key);
    });
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
    return h + '</div>' + formAngles(c) + '</div>';
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
      /* 073 — then its 3D angles, front first. */
      ANGLES.forEach(function (k) { if (d.angles && d.angles[k]) queue.push({ cid: c.id, angle: k, d: d.angles[k] }); });
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
      var files = { colourId: q.cid, full: q.d.full, thumb: q.d.thumb, width: q.d.width, height: q.d.height };
      if (q.angle) files.angle = q.angle; else files.kind = q.kind;
      (q.angle ? Shop.addAngle(pid, files) : Shop.addPhoto(pid, files))
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
    /* the drawer's gallery */
    if (a === 'g-colour') { G.pid = Number(b.getAttribute('data-pid')); G.cid = cid; G.i = 0; repaintGal(G.pid); return; }
    if (a === 'g-pick') { G.i = Number(b.getAttribute('data-i')) || 0; repaintGal(Number(b.getAttribute('data-pid'))); return; }
    if (a === 'g-step') { stepGal(Number(b.getAttribute('data-pid')), Number(b.getAttribute('data-d')) || 1); return; }
    if (a === 'colour') { S.cid = cid; S.menu = null; S.arm = null; repaint(); return; }
    if (a === 'pick') { S.menu = null; choose({ pid: S.pid, cid: cid, kind: kind }); return; }
    if (a === 'menu') {
      /* A 3D angle's menu is keyed 'a<id>': its ids are not the photos'. */
      var mk = String(b.getAttribute('data-id')).charAt(0) === 'a' ? b.getAttribute('data-id') : id;
      e.preventDefault(); S.menu = S.menu === mk ? null : mk; S.arm = null; repaint(); return;
    }
    /* 073 — the 3D angles */
    var angle = b.getAttribute('data-angle');
    if (a === 'a-pick') { S.menu = null; choose({ pid: S.pid, cid: cid, angle: angle }); return; }
    if (a === 'a-replace') { S.menu = null; repaint(); choose({ pid: S.pid, cid: cid, angle: angle }); return; }
    if (a === 'a-remove') {
      if (S.arm !== 'a' + id) {
        S.arm = 'a' + id; repaint();
        setTimeout(function () { if (S.arm === 'a' + id) { S.arm = null; repaint(); } }, 4000);
        return;
      }
      change(Shop.removeAngle(id));
      return;
    }
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
    if (a === 'f-a-pick') { choose({ form: true, key: key, angle: angle }); return; }
    if (a === 'f-a-clear') {
      var ca = ColourForm.colour(key);
      if (ca) { delete drafts(ca).angles[angle]; repaintForm(key); }
      return;
    }
    if (a === 'f-clear') {
      var c = ColourForm.colour(key);
      if (!c) return;
      var d = drafts(c);
      if (kind === 'extra') d.extra.splice(Number(b.getAttribute('data-i')), 1);
      else d[kind] = null;
      repaintForm(key);
    }
  });

  /* A swipe across the big photo walks the gallery — towards the reading
     direction is the next photo, so in Arabic a swipe to the right is next.
     A touch that barely moved is a tap, and opens the photo as the link says. */
  var swipe = null;
  document.addEventListener('touchstart', function (e) {
    var el = e.target.closest && e.target.closest('[data-ph-swipe]');
    swipe = el && e.touches.length === 1
      ? { pid: Number(el.getAttribute('data-ph-swipe')), x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!swipe || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y, pid = swipe.pid;
    swipe = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    var rtl = document.body.classList.contains('rtl');
    stepGal(pid, (dx < 0) !== rtl ? 1 : -1);
  }, { passive: true });

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
    var tileEl = e.target.closest && e.target.closest('#phRoot [data-ph="pick"], #phRoot [data-ph="a-pick"], ' +
      '.ph-form [data-ph="f-pick"], .ph-form [data-ph="f-a-pick"]');
    if (!tileEl) return;
    e.preventDefault();
    var files = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    if (tileEl.getAttribute('data-ph') === 'f-a-pick') {
      takeAngleForForm(tileEl.getAttribute('data-k'), tileEl.getAttribute('data-angle'), files[0]);
      return;
    }
    if (tileEl.getAttribute('data-ph') === 'a-pick') {
      uploadAngle(S.pid, Number(tileEl.getAttribute('data-cid')), tileEl.getAttribute('data-angle'), files[0]);
      return;
    }
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
    anglesMissing: anglesMissing,
    anglesReadyCount: anglesReadyCount,
    angleMark: angleMark,
    formStrip: formStrip,
    blankDrafts: blankDrafts,
    takeFirstEmpty: takeFirstEmpty,
    sendDrafts: sendDrafts,
    read: read,
    MAX_EXTRA: MAX_EXTRA
  };
})();
