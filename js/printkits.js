/* ==========================================================================
   OG SYSTEM — Print kits and their fonts                     [printkits.js]
   --------------------------------------------------------------------------
   Migration 071, server/lib/printkits.js, cloud file 041. The website sells a
   name and a number on the back of an adult jersey; a KIT says how it looks:
   the font, the colours, an outline and a shadow, and where the name and the
   number sit on a 400 × 440 drawing of a jersey's back. This page makes the
   kits and keeps the font library; the product form attaches a kit to a
   product (PrintKits.productSection, used by js/app-products.js).

   svg() is THE drawing — the kit form's live preview, the kit cards and the
   product form all call it — and it is the same geometry the website is told
   to draw (docs/website/UPDATE-PRINT-KITS.md): the name on a curve through
   (70, nameY) and (330, nameY) bowed by 2 × nameArc at the middle, the number
   centred on numberY.

   Paints #view itself and never calls render(), so after() cannot re-enter
   load() (the Safeers loop, fix 06). The kit form repaints its preview alone,
   never the boxes being typed in. Events are data-act="pk-…" on the one
   ACTIONS table and data-change="pk-…" on CHANGES.
   ========================================================================== */
var PrintKits = (function () {
  'use strict';

  var FRESH_MS = 20000;
  var MAX_FONT = 4 * 1024 * 1024;

  var S = {
    loaded: false, failed: null, at: 0, shopAt: 0, loading: null,
    kits: [], fonts: [], clubs: [], rules: { maxLetters: 12, turnaround: { min: 5, max: 7 } },
    kitTypes: ['home', 'away', 'third', 'retro', 'gk', 'special'], price: null,
    tab: 'kits', menu: null, draft: null, saving: false, upload: null, busy: false,
    /* The "from the internet" box: what is typed (a repaint must not take
       it), the name being fetched, and the refusal under it. */
    net: { text: '', busy: null, err: null },
    /* "Make a font from a picture": which place it is open in, the picture
       as one bit a pixel, what the server read in it, the preview face. */
    pic: null
  };
  var PIC_ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function picFresh(where) {
    return { open: where, w: 0, h: 0, bits: null, canvas: null, shot: null, order: PIC_ORDER, name: '',
             read: null, fam: null, busy: null, err: null };
  }

  /* ------------------------------------------------------------- helpers */

  function canManage() { return typeof allow === 'function' && allow('print_kits.manage'); }
  function ltr(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
  function kitById(id) { return S.kits.filter(function (k) { return k.id === id; })[0] || null; }
  function fontById(id) { return S.fonts.filter(function (f) { return f.id === id; })[0] || null; }
  function clubName(code) {
    var c = S.clubs.filter(function (x) { return x.code === code; })[0];
    return c ? (OG.lang === 'ar' ? c.ar : c.en) : code;
  }
  /* Club · season · kind, or "Any shirt" for a style. */
  function kitWhere(k) {
    if (!k.clubCode) return t('pk_style_any');
    var bits = [clubName(k.clubCode)];
    if (k.season) bits.push(k.season);
    if (k.kitType) bits.push(t('pk_type_' + k.kitType));
    return bits.join(' · ');
  }

  /* --------------------------------------------------------- the fonts */

  var faces = {};
  /* Every font is registered once, under its own family name, for the whole
     weight range — a variable font (Teko, Cairo) is drawn at the weight the
     kit's font says, a static one draws as itself. SVG text re-lays out by
     itself when the face arrives, so nothing has to repaint. */
  function ensureFont(f) {
    if (!f || !f.fileUrl || faces[f.id] || typeof FontFace === 'undefined') return;
    try {
      var face = new FontFace('pkf-' + f.id, 'url(' + JSON.stringify(f.fileUrl) + ')', { weight: '1 1000' });
      faces[f.id] = face;
      document.fonts.add(face);
      face.load().catch(function () { faces[f.id] = 'failed'; });
    } catch (e) { faces[f.id] = 'failed'; }
  }
  function family(fontId) { return "'pkf-" + fontId + "', 'Arial Narrow', Impact, sans-serif"; }

  /* ---------------------------------------------------------- the shirt */

  var SHIRT = 'M128 18 Q200 52 272 18 L352 46 L398 148 L344 172 L328 142 L328 428 Q200 442 72 428 L72 142 ' +
              'L56 172 L2 148 L48 46 Z';
  var COLLAR = 'M128 18 Q200 52 272 18 Q200 34 128 18 Z';
  var seq = 0;

  function lum(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 1;
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
  }

  /* k: a kit as the server answers it (or the form's draft); o: {name,
     number, cls}. The shirt is a neutral colour chosen against the text, so
     white names show on a dark shirt and black ones on a light one — the
     preview is about the print, not the shirt. */
  function svg(k, o) {
    o = o || {};
    if (!k) return '';
    var id = 'pkArc' + (++seq);
    var name = String(o.name == null ? 'NAME' : o.name).toUpperCase();
    var num = String(o.number == null ? '10' : o.number);
    var fontId = k.fontId != null ? k.fontId : (k.font && k.font.id);
    var weight = (k.font && k.font.weight) || (fontById(fontId) || {}).weight || 400;
    ensureFont(fontById(fontId));
    var y = Number(k.nameY), arc = Number(k.nameArc);
    var path = 'M70 ' + y + ' Q200 ' + (y - 2 * arc) + ' 330 ' + y;
    var shirt = lum(k.textColor) < 0.45 ? '#e8e6df' : '#1b1b1f';
    var edge = lum(k.textColor) < 0.45 ? '#c9c6bd' : '#2c2c31';
    var ow = Number(k.outlineWidth) || 0;
    var stroke = ow > 0 && k.outlineColor
      ? ' stroke="' + esc(k.outlineColor) + '" stroke-width="' + (ow * 2) + '" stroke-linejoin="round" paint-order="stroke"' : '';
    var fam = ' font-family="' + esc(family(fontId)) + '" font-weight="' + weight + '"';
    function nameText(fill, extra, dx, dy) {
      return '<text' + fam + ' font-size="' + k.nameSize + '" fill="' + esc(fill) + '" text-anchor="middle"' + extra +
        (dx || dy ? ' transform="translate(' + dx + ' ' + dy + ')"' : '') +
        '><textPath href="#' + id + '" startOffset="50%">' + esc(name) + '</textPath></text>';
    }
    function numText(fill, extra, dx, dy) {
      return '<text' + fam + ' x="200" y="' + k.numberY + '" font-size="' + k.numberSize + '" fill="' + esc(fill) +
        '" text-anchor="middle"' + extra + (dx || dy ? ' transform="translate(' + dx + ' ' + dy + ')"' : '') + '>' + esc(num) + '</text>';
    }
    var shadow = '';
    if (k.shadowColor && (Number(k.shadowDx) || Number(k.shadowDy))) {
      shadow = nameText(k.shadowColor, stroke ? ' stroke="' + esc(k.shadowColor) + '" stroke-width="' + (ow * 2) + '" stroke-linejoin="round"' : '', k.shadowDx, k.shadowDy) +
               numText(k.shadowColor, stroke ? ' stroke="' + esc(k.shadowColor) + '" stroke-width="' + (ow * 2) + '" stroke-linejoin="round"' : '', k.shadowDx, k.shadowDy);
    }
    return '<svg class="pk-svg' + (o.cls ? ' ' + o.cls : '') + '" viewBox="0 0 400 440" role="img" aria-label="' +
        esc(name + ' ' + num) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><path id="' + id + '" d="' + path + '" fill="none"/></defs>' +
      '<path d="' + SHIRT + '" fill="' + shirt + '" stroke="' + edge + '" stroke-width="3"/>' +
      '<path d="' + COLLAR + '" fill="' + edge + '"/>' +
      shadow + nameText(k.textColor, stroke) + numText(k.textColor, stroke) +
    '</svg>';
  }

  /* ----------------------------------------------------------------- load */

  function load() {
    if (S.loading) return S.loading;
    S.loading = API.get('/api/print-kits').then(function (r) {
      S.kits = r.kits || []; S.fonts = r.fonts || []; S.clubs = r.clubs || [];
      S.rules = r.rules || S.rules; S.kitTypes = r.kitTypes || S.kitTypes; S.price = r.price || null;
      S.loaded = true; S.failed = null; S.at = Date.now();
      S.shopAt = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
      S.fonts.forEach(ensureFont);
      paint();
      return S;
    }).catch(function (err) {
      S.failed = API.friendly(err);
      paint();
      throw err;
    }).then(function (x) { S.loading = null; return x; }, function (e) { S.loading = null; throw e; });
    return S.loading;
  }
  /* What the product form waits for: the kits as last loaded, or a load. */
  function ready() { return S.loaded && Date.now() - S.at < FRESH_MS ? Promise.resolve(S) : load(); }

  function paint() {
    if (OG.view !== 'printkits') return;
    var host = document.getElementById('view');
    if (host) {
      host.innerHTML = view();
      if (typeof hintInputs === 'function') hintInputs(host);
    }
  }

  function after() {
    var shop = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
    if (!S.loaded || Date.now() - S.at > FRESH_MS || shop !== S.shopAt) load().catch(function () {});
  }

  /* ----------------------------------------------------------------- view */

  function view() {
    var add = !canManage() ? '' : S.tab === 'fonts'
      ? '<button class="btn btn-primary" data-act="pk-font-add">+ ' + t('pk_font_add') + '</button>'
      : '<button class="btn btn-primary" data-act="pk-new">+ ' + t('pk_new') + '</button>';
    var head = '<div class="page-head"><div><h1>' + t('nav_printkits') + '</h1>' +
      '<div class="sub">' + t('pk_sub') + '</div></div><div class="head-actions">' + add + '</div></div>';
    var tabs = '<div class="chip-row pk-tabs" role="tablist">' + ['kits', 'fonts'].map(function (k) {
      var n = k === 'kits' ? S.kits.filter(function (x) { return !x.archived; }).length
                           : S.fonts.filter(function (x) { return !x.archived; }).length;
      return '<button type="button" class="chip' + (S.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.tab === k) +
        '" data-act="pk-tab" data-k="' + k + '"><span>' + t('pk_tab_' + k) + ' <bdi class="muted">' + nf(n) + '</bdi></span></button>';
    }).join('') + '</div>';

    if (S.failed) {
      return head + '<div class="card"><div class="cart-empty"><b>' + esc(S.failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="pk-reload">' + t('retry') + '</button></div></div>';
    }
    if (!S.loaded) {
      return head + '<div class="pk-grid" aria-busy="true"><div class="pk-skel"></div><div class="pk-skel"></div><div class="pk-skel"></div></div>' +
        '<span class="sr-only" role="status">' + t('pk_loading') + '</span>';
    }
    return head + rulesLine() + tabs + (S.tab === 'fonts' ? fontsTab() : kitsTab());
  }

  /* The four rules the website is held to, said once at the top. */
  function rulesLine() {
    var price = S.price ? (S.price.currency === 'USD'
      ? '$' + (S.price.amount / 100).toFixed(S.price.amount % 100 ? 2 : 0)
      : nf(S.price.amount) + ' ' + S.price.currency) : t('pk_price_unset');
    return '<div class="pk-rules muted">' +
      t('pk_rules').replace('{price}', ltr(price)).replace('{n}', ltr(String(S.rules.maxLetters)))
        .replace('{min}', ltr(String(S.rules.turnaround.min))).replace('{max}', ltr(String(S.rules.turnaround.max))) +
      (canManage() && typeof Desk !== 'undefined' && Desk.gotoSettingsFold
        ? ' <button type="button" class="link" data-act="pk-settings">' + t('pk_rules_change') + '</button>' : '') +
      '</div>';
  }

  function kitsTab() {
    var live = S.kits.filter(function (k) { return !k.archived; });
    var away = S.kits.filter(function (k) { return k.archived; });
    if (!S.kits.length) {
      return '<div class="card"><div class="cart-empty"><b>' + t('pk_empty') + '</b><span>' + t('pk_empty_why') + '</span>' +
        (canManage() ? '<button class="btn btn-primary mt" data-act="pk-new">+ ' + t('pk_new') + '</button>' : '') + '</div></div>';
    }
    var h = '<div class="pk-grid">' + live.map(kitCard).join('') + '</div>';
    if (away.length) h += '<h3 class="pk-away-h">' + t('pk_away') + '</h3><div class="pk-grid">' + away.map(kitCard).join('') + '</div>';
    return h;
  }

  function kitCard(k) {
    var f = fontById(k.fontId);
    var badges = (k.isDefault ? '<span class="badge ok">' + t('pk_default') + '</span>' : '') +
                 (k.featured ? '<span class="badge neutral">' + t('pk_featured') + '</span>' : '') +
                 (k.archived ? '<span class="badge warn">' + t('pk_put_away') + '</span>' : '') +
                 (f && !f.uploaded ? '<span class="badge warn">' + t('pk_font_missing') + '</span>' : '');
    var menu = !canManage() ? '' :
      '<div class="pk-more"><button type="button" class="btn btn-ghost btn-sm" aria-label="' + t('pk_more') + '" data-act="pk-menu" data-id="' + k.id + '">…</button>' +
      (S.menu === k.id ? '<div class="pk-menu" role="menu">' +
        '<button type="button" class="pk-mitem" data-act="pk-edit" data-id="' + k.id + '">' + t('pk_edit') + '</button>' +
        (!k.isDefault && !k.archived ? '<button type="button" class="pk-mitem" data-act="pk-flag" data-f="isDefault" data-v="1" data-id="' + k.id + '">' + t('pk_make_default') + '</button>' : '') +
        (!k.archived ? '<button type="button" class="pk-mitem" data-act="pk-flag" data-f="featured" data-v="' + (k.featured ? 0 : 1) + '" data-id="' + k.id + '">' + t(k.featured ? 'pk_unfeature' : 'pk_feature') + '</button>' : '') +
        (!k.isDefault ? '<button type="button" class="pk-mitem" data-act="pk-flag" data-f="archived" data-v="' + (k.archived ? 0 : 1) + '" data-id="' + k.id + '">' + t(k.archived ? 'pk_bring_back' : 'pk_archive') + '</button>' : '') +
      '</div>' : '') + '</div>';
    return '<div class="card pk-card' + (k.archived ? ' is-away' : '') + (S.menu === k.id ? ' has-menu' : '') + '">' +
      '<button type="button" class="pk-prev-btn" data-act="' + (canManage() ? 'pk-edit' : 'pk-noop') + '" data-id="' + k.id + '" aria-label="' + esc(k.label) + '">' +
        svg(k, { name: 'NAME', number: 10 }) + '</button>' +
      '<div class="pk-card-body"><div class="pk-card-top"><b dir="auto">' + esc(k.label) + '</b>' + menu + '</div>' +
        '<div class="muted small" dir="auto">' + esc(kitWhere(k)) + '</div>' +
        '<div class="muted small">' + esc(f ? f.name : '?') + (k.products ? ' · ' + t(k.products === 1 ? 'pk_n_product1' : 'pk_n_products').replace('{n}', nf(k.products)) : '') + '</div>' +
        (badges ? '<div class="pk-badges">' + badges + '</div>' : '') +
      '</div></div>';
  }

  function fontsTab() {
    var missing = S.fonts.filter(function (f) { return !f.uploaded && !f.archived; });
    var h = '';
    if (missing.length) {
      h += '<div class="card pk-banner"><div><b>' + t('pk_seed_title').replace('{n}', nf(missing.length)) + '</b>' +
        '<div class="muted small">' + t('pk_seed_why') + '</div></div>' +
        (canManage() ? '<button class="btn btn-primary btn-sm" data-act="pk-seed"' + (S.busy ? ' disabled' : '') + '>' +
          '<span>' + t(S.busy ? 'pk_seeding' : 'pk_seed') + '</span></button>' : '') + '</div>';
    }
    if (canManage()) h += '<div class="card pk-netcard">' + netBox('tab') + picBox('tab') + '</div>';
    if (S.upload) h += '<div class="card pk-banner"><b>' + t('pk_uploading').replace('{name}', esc(S.upload)) + '</b></div>';
    if (!S.fonts.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('pk_fonts_empty') + '</b><span>' + t('pk_font_rule') + '</span></div></div>';
    }
    h += '<div class="card pk-fonts">' + S.fonts.map(function (f) {
      ensureFont(f);
      var sample = f.uploaded
        ? '<div class="pk-sample" style="font-family:' + esc(family(f.id)) + ';font-weight:' + Number(f.weight) + '">NAME 10</div>'
        : '<div class="pk-sample is-none">' + t('pk_not_uploaded') + '</div>';
      return '<div class="pk-font' + (f.archived ? ' is-away' : '') + '">' + sample +
        '<div class="pk-font-meta"><b dir="auto">' + esc(f.name) + '</b>' +
          '<div class="muted small">' + t('pk_weight') + ' ' + ltr(String(f.weight)) +
            ' · ' + t('pk_n_kits').replace('{n}', nf(f.kits || 0)) +
            (f.archived ? ' · <span class="warn">' + t('pk_put_away') + '</span>' : '') + '</div>' +
          (f.licenseNote ? '<div class="muted small" dir="auto">' + esc(f.licenseNote) + '</div>' : '') +
        '</div>' +
        (canManage() ? '<div class="pk-font-acts">' +
          '<button class="btn btn-sm" data-act="pk-font-rename" data-id="' + f.id + '">' + t('pk_rename') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="pk-font-file" data-id="' + f.id + '">' + t('pk_replace') + '</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="pk-font-archive" data-id="' + f.id + '" data-v="' + (f.archived ? 0 : 1) + '">' +
            t(f.archived ? 'pk_bring_back' : 'pk_archive') + '</button>' +
        '</div>' : '') +
      '</div>';
    }).join('') + '</div>' +
    '<div class="muted small pk-foot">' + t('pk_font_rule') + '</div>';
    return h;
  }

  /* ------------------------------------------------------- the kit form */

  var DEF = { label: '', clubCode: null, season: '', kitType: '', fontId: null, textColor: '#ffffff',
              outlineColor: null, outlineWidth: 0, shadowColor: null, shadowDx: 0, shadowDy: 0,
              nameSize: 34, nameY: 165, nameArc: 30, numberSize: 160, numberY: 345,
              featured: false, isDefault: false };

  function draftFrom(k, prefill) {
    var src = k || {};
    var d = {};
    Object.keys(DEF).forEach(function (key) { d[key] = src[key] !== undefined && src[key] !== null ? src[key] : DEF[key]; });
    if (prefill) Object.keys(prefill).forEach(function (key) { if (prefill[key] != null) d[key] = prefill[key]; });
    if (!d.fontId) {
      var def = S.kits.filter(function (x) { return x.isDefault; })[0];
      d.fontId = def ? def.fontId : (S.fonts[0] || {}).id;
    }
    d.id = k ? k.id : null;
    d.sample = { name: 'NAME', number: 10 };
    d.err = null; d.field = null;
    return d;
  }

  /* Open the form: an existing kit, or a new one pre-filled (the product
     form's "Create kit" sends the club, season and kind it was asked for).
     onSaved(kit) runs after a save lands. */
  function openKitForm(kit, prefill, onSaved, onCancel) {
    ready().then(function () {
      S.draft = draftFrom(kit, prefill);
      S.draft.onSaved = onSaved || null;
      if (!S.draft.label && prefill && prefill.clubCode) {
        S.draft.label = [clubName(prefill.clubCode), prefill.season, prefill.kitType ? t('pk_type_' + prefill.kitType) : '']
          .filter(Boolean).join(' ');
      }
      openModal({
        title: kit ? t('pk_edit_title') : t('pk_new_title'),
        size: 'wide',
        body: '<div id="pkForm">' + formHtml() + '</div>',
        foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
              '<button class="btn btn-primary" data-act="pk-save"><span>' + t('save') + '</span></button>',
        /* Closed without a save (Save clears the draft first): the caller
           gets its own screen back. */
        onClose: function () {
          var cancelled = !!S.draft;
          S.draft = null;
          if (S.pic && S.pic.open === 'form') S.pic = null;
          if (cancelled && onCancel) setTimeout(onCancel, 0);
        }
      });
    }).catch(function (err) { toast(t('nav_printkits'), API.friendly(err), 'err', 5000); });
  }

  function opt(v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function range(key, lo, hi, val) {
    return '<label class="field pk-range"><span>' + t('pk_f_' + key) + ' <bdi class="muted" id="pkV_' + key + '">' + esc(String(val)) + '</bdi></span>' +
      '<input type="range" min="' + lo + '" max="' + hi + '" step="1" value="' + esc(String(val)) + '" data-k="' + key + '" data-change="pk-live"></label>';
  }
  function colourField(key, val, nullable) {
    var on = !!val;
    return '<div class="field pk-colour"><span>' + t('pk_f_' + key) + '</span><div class="pk-colour-row">' +
      (nullable ? '<label class="pk-tick"><input type="checkbox" data-k="' + key + '_on"' + (on ? ' checked' : '') + ' data-change="pk-live"> ' + t('pk_on') + '</label>' : '') +
      '<input type="color" value="' + esc(val || '#000000') + '" data-k="' + key + '" data-change="pk-live"' + (nullable && !on ? ' disabled' : '') + '>' +
      '<bdi class="muted" dir="ltr" id="pkV_' + key + '">' + esc(on || !nullable ? val : '—') + '</bdi></div></div>';
  }

  function formHtml() {
    var D = S.draft;
    var clubs = '<option value="">' + esc(t('pk_style_any')) + '</option>' + S.clubs.filter(function (c) { return !c.archived || c.code === D.clubCode; })
      .map(function (c) { return opt(c.code, OG.lang === 'ar' ? c.ar : c.en, c.code === D.clubCode); }).join('');
    var types = '<option value="">—</option>' + S.kitTypes.map(function (k) { return opt(k, t('pk_type_' + k), k === D.kitType); }).join('');
    var fonts = S.fonts.filter(function (f) { return !f.archived || f.id === D.fontId; })
      .map(function (f) { return opt(f.id, f.name + (f.uploaded ? '' : ' · ' + t('pk_not_uploaded')), f.id === D.fontId); }).join('');
    var err = D.err ? '<div class="pk-err" role="alert">' + esc(D.err) + '</div>' : '';
    return '<div class="pk-form">' +
      '<div class="pk-form-fields">' + err +
        '<label class="field"><span>' + t('pk_f_label') + '</span><input class="inp" data-k="label" data-change="pk-live" dir="auto" maxlength="40" value="' + esc(D.label) + '"></label>' +
        '<div class="pk-row3">' +
          '<label class="field"><span>' + t('pk_f_club') + '</span><select class="inp" data-k="clubCode" data-change="pk-live">' + clubs + '</select></label>' +
          '<label class="field"><span>' + t('pk_f_season') + '</span><input class="inp" data-k="season" data-change="pk-live" dir="ltr" placeholder="26/27" maxlength="7" value="' + esc(D.season || '') + '"' + (D.clubCode ? '' : ' disabled') + '></label>' +
          '<label class="field"><span>' + t('pk_f_kitType') + '</span><select class="inp" data-k="kitType" data-change="pk-live"' + (D.clubCode ? '' : ' disabled') + '>' + types + '</select></label>' +
        '</div>' +
        '<label class="field"><span>' + t('pk_f_font') + '</span><select class="inp" data-k="fontId" data-change="pk-live">' + fonts + '</select></label>' +
        netBox('form') + picBox('form') +
        '<div class="pk-row3">' + colourField('textColor', D.textColor, false) + colourField('outlineColor', D.outlineColor, true) +
          colourField('shadowColor', D.shadowColor, true) + '</div>' +
        '<div class="pk-row3">' + range('outlineWidth', 0, 20, D.outlineWidth) + range('shadowDx', -20, 20, D.shadowDx) + range('shadowDy', -20, 20, D.shadowDy) + '</div>' +
        '<div class="pk-row3">' + range('nameSize', 10, 120, D.nameSize) + range('nameY', 0, 440, D.nameY) + range('nameArc', -80, 80, D.nameArc) + '</div>' +
        '<div class="pk-row3">' + range('numberSize', 40, 300, D.numberSize) + range('numberY', 0, 440, D.numberY) + '<span></span></div>' +
        '<label class="pk-tick"><input type="checkbox" data-k="featured" data-change="pk-live"' + (D.featured ? ' checked' : '') + '> ' + t('pk_f_featured') + '</label>' +
        '<label class="pk-tick"><input type="checkbox" data-k="isDefault" data-change="pk-live"' + (D.isDefault ? ' checked' : '') + (D.id && kitById(D.id) && kitById(D.id).isDefault ? ' disabled' : '') + '> ' + t('pk_f_default') + '</label>' +
      '</div>' +
      '<div class="pk-form-prev">' +
        '<div id="pkPrev">' + svg(D, D.sample) + '</div>' +
        '<div class="pk-row2">' +
          '<label class="field"><span>' + t('pk_sample_name') + '</span><input class="inp" data-k="sampleName" data-change="pk-live" dir="ltr" maxlength="' + S.rules.maxLetters + '" value="' + esc(D.sample.name) + '"></label>' +
          '<label class="field"><span>' + t('pk_sample_number') + '</span><input class="inp" data-k="sampleNumber" data-change="pk-live" dir="ltr" inputmode="numeric" maxlength="2" value="' + esc(String(D.sample.number)) + '"></label>' +
        '</div>' +
        '<div class="muted small">' + t('pk_prev_note') + '</div>' +
      '</div>' +
    '</div>';
  }

  /* One box moved: the draft and the preview, nothing else on the form. */
  function live(el) {
    var D = S.draft;
    if (!D || !el) return;
    var k = el.getAttribute('data-k');
    var v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'sampleName') D.sample.name = String(v).toUpperCase().slice(0, S.rules.maxLetters);
    else if (k === 'sampleNumber') D.sample.number = String(v).replace(/[^0-9]/g, '').slice(0, 2);
    else if (/_on$/.test(k)) {
      var base = k.replace(/_on$/, '');
      var box = document.querySelector('#pkForm input[type=color][data-k="' + base + '"]');
      D[base] = v ? (box ? box.value : '#000000') : null;
      if (box) box.disabled = !v;
      var lab = document.getElementById('pkV_' + base);
      if (lab) lab.textContent = D[base] || '—';
    } else if (k === 'fontId') D.fontId = Number(v);
    else if (k === 'clubCode') {
      D.clubCode = v || null;
      if (!D.clubCode) { D.season = ''; D.kitType = ''; }
      ['season', 'kitType'].forEach(function (x) {
        var b = document.querySelector('#pkForm [data-k="' + x + '"]');
        if (b) { b.disabled = !D.clubCode; if (!D.clubCode) b.value = ''; }
      });
    } else if (el.type === 'range') {
      D[k] = Number(v);
      var out = document.getElementById('pkV_' + k);
      if (out) out.textContent = String(v);
    } else if (el.type === 'color') {
      D[k] = String(v).toLowerCase();
      var l2 = document.getElementById('pkV_' + k);
      if (l2) l2.textContent = D[k];
    } else if (el.type === 'checkbox') D[k] = !!v;
    else D[k] = v;
    var p = document.getElementById('pkPrev');
    if (p) p.innerHTML = svg(D, D.sample);
  }

  function save(btn) {
    var D = S.draft;
    if (!D || S.saving) return;
    var body = {
      label: String(D.label || '').trim(), clubCode: D.clubCode || null,
      season: D.clubCode && String(D.season || '').trim() ? String(D.season).trim() : null,
      kitType: D.clubCode && D.kitType ? D.kitType : null, fontId: Number(D.fontId),
      textColor: D.textColor, outlineColor: D.outlineColor || null, outlineWidth: Number(D.outlineWidth) || 0,
      shadowColor: D.shadowColor || null, shadowDx: Number(D.shadowDx) || 0, shadowDy: Number(D.shadowDy) || 0,
      nameSize: Number(D.nameSize), nameY: Number(D.nameY), nameArc: Number(D.nameArc),
      numberSize: Number(D.numberSize), numberY: Number(D.numberY),
      featured: !!D.featured, isDefault: !!D.isDefault
    };
    /* Refused here in the screen's language before the request; the server
       refuses the same things. */
    var err = !body.label ? t('pk_err_label')
            : body.season && !/^(\d{2}|\d{4})\/\d{2}$/.test(body.season) ? t('pk_err_season')
            : body.outlineWidth > 0 && !body.outlineColor ? t('pk_err_outline') : null;
    if (err) { D.err = err; repaintForm(); return; }
    S.saving = true;
    if (btn) btn.disabled = true;
    var req = D.id ? API.patch('/api/print-kits/' + D.id, body) : API.post('/api/print-kits', body);
    req.then(function (r) {
      S.saving = false;
      var done = D.onSaved;
      S.draft = null;
      closeModal();
      toast(t('nav_printkits'), t(D.id ? 'pk_saved' : 'pk_made').replace('{name}', r.kit.label), 'ok', 3000);
      S.at = 0;
      load().then(function () { if (done) done(r.kit); }).catch(function () { if (done) done(r.kit); });
    }).catch(function (e) {
      S.saving = false;
      if (btn) btn.disabled = false;
      if (!S.draft) return;
      S.draft.err = e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e);
      repaintForm();
    });
  }

  /* After a refusal only: the error line goes at the top and the boxes keep
     what was typed (they are drawn from the draft). */
  function repaintForm() {
    var host = document.getElementById('pkForm');
    if (host) host.innerHTML = formHtml();
  }

  /* ---------------------------------------------------------- the fonts */

  function fileInput() {
    var f = document.getElementById('pkFile');
    if (f) return f;
    f = document.createElement('input');
    f.type = 'file'; f.id = 'pkFile'; f.hidden = true;
    f.accept = '.ttf,.otf,font/ttf,font/otf,application/x-font-ttf,application/font-sfnt';
    document.body.appendChild(f);
    f.addEventListener('change', function () {
      var file = f.files && f.files[0];
      var mode = f.getAttribute('data-mode') || 'add';
      f.value = '';
      if (file) sendFont(file, mode);
    });
    return f;
  }

  function sendFont(file, mode) {
    if (!/\.(ttf|otf)$/i.test(file.name)) { toast(t('pk_tab_fonts'), t('pk_err_bad_font'), 'err', 6000); return; }
    if (file.size > MAX_FONT) { toast(t('pk_tab_fonts'), t('pk_err_too_large'), 'err', 6000); return; }
    var fr = new FileReader();
    fr.onload = function () {
      S.upload = file.name; paint();
      var data = String(fr.result);
      var req = mode === 'add'
        ? API.post('/api/print-fonts', { name: '', data: data, filename: file.name })
        : API.post('/api/print-fonts/' + mode.split(':')[1] + '/file', { data: data });
      req.then(function (r) {
        S.upload = null;
        toast(t('pk_tab_fonts'), t('pk_font_uploaded').replace('{name}', r.font.name), 'ok', 3500);
        S.at = 0; load().catch(function () {});
      }).catch(function (e) {
        S.upload = null; paint();
        toast(t('pk_tab_fonts'), e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e), 'err', 7000);
      });
    };
    fr.onerror = function () { toast(t('pk_tab_fonts'), t('pk_err_bad_font'), 'err', 5000); };
    fr.readAsDataURL(file);
  }

  /* A font from the internet, by its name: the server fetches it from Google
     Fonts and makes it ready (lib/printkits.js fontFromInternet). Drawn in the
     kit form, where the font it brings is chosen for the kit, and on the
     Fonts tab. Only the box repaints while it works — the kit form around it
     holds typed values. */
  function netBox(where) {
    var N = S.net;
    var busy = !!N.busy;
    return '<div class="pk-net" id="pkNet_' + where + '">' +
      '<div class="pk-net-head"><b>' + t('pk_net_title') + '</b>' +
        ' <a class="link" href="https://fonts.google.com" target="_blank" rel="noopener">' + t('pk_net_link') + '</a></div>' +
      '<div class="pk-net-row">' +
        '<input class="inp" id="pkNetIn_' + where + '" dir="ltr" maxlength="60" autocomplete="off" spellcheck="false"' +
          ' enterkeyhint="go" placeholder="' + esc(t('pk_net_ph')) + '" value="' + esc(N.text) + '"' + (busy ? ' disabled' : '') + '>' +
        '<button type="button" class="btn' + (where === 'tab' ? ' btn-primary' : '') + '" data-act="pk-net-get" data-w="' + where + '"' +
          (busy ? ' disabled' : '') + '><span>' + (busy ? t('pk_net_busy').replace('{name}', esc(N.busy)) : t('pk_net_go')) + '</span></button>' +
      '</div>' +
      (N.err ? '<div class="pk-err" role="alert">' + esc(N.err) + '</div>' : '') +
      '<div class="muted small">' + t(where === 'tab' ? 'pk_net_hint_tab' : 'pk_net_hint') + '</div>' +
    '</div>';
  }
  function repaintNet() {
    ['form', 'tab'].forEach(function (w) {
      var el = document.getElementById('pkNet_' + w);
      if (el) el.outerHTML = netBox(w);
    });
  }
  function getFromNet(where) {
    var box = document.getElementById('pkNetIn_' + where);
    var name = String(box ? box.value : S.net.text).replace(/\s+/g, ' ').trim();
    S.net.text = name;
    if (S.net.busy) return;
    if (!name) { S.net.err = t('pk_err_bad_font_name'); repaintNet(); return; }
    S.net.busy = name; S.net.err = null; repaintNet();
    API.post('/api/print-fonts/internet', { family: name }).then(function (r) {
      S.net = { text: '', busy: null, err: null };
      toast(t('pk_tab_fonts'), t(r.existing ? 'pk_net_have' : 'pk_net_done').replace('{name}', r.font.name), 'ok', 4000);
      S.at = 0;
      return load().then(function () {
        if (where === 'form' && S.draft) {
          S.draft.fontId = r.font.id;
          repaintForm();
        } else repaintNet();
      });
    }).catch(function (e) {
      S.net.busy = null;
      S.net.err = e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e);
      repaintNet();
    });
  }

  /* ------------------------------------------- a font from a picture
     Yalla Wear's road to a club's lettering: a picture of it, often a sheet
     a picture tool drew from a photo of the shirt. The picture is read HERE
     into one bit a pixel (the threshold chosen by Otsu's method, light
     letters on dark turned round), the server finds the letters and makes the
     font (lib/letterfont.js), and the person checks every box has the right
     character before it is saved. An inline panel, not a dialog: in the kit
     form a second dialog would close the first. Only the panel repaints. */
  var PIC_PROMPT = 'Draw the full alphabet A to Z and the digits 0 to 9 in exactly the lettering style of the shirt ' +
    'in the attached picture. Capital letters only. Solid black letters on a plain white background: flat, no outline, ' +
    'no shadow, no texture, no perspective. Three rows: A to M, N to Z, 0 to 9. Leave clear space between every ' +
    'character. Nothing else in the picture.';
  var picFaces = 0;

  function picBox(where) {
    var P = S.pic;
    if (!P || P.open !== where) {
      return '<div class="pk-pic-line" id="pkPic_' + where + '"><button type="button" class="btn btn-sm" data-act="pk-pic-open" data-w="' + where + '">' +
        '<span>' + t('pk_pic_open') + '</span></button></div>';
    }
    var R = P.read;
    var busy = !!P.busy;
    var h = '<div class="pk-pic" id="pkPic_' + where + '">' +
      '<div class="pk-net-head"><b>' + t('pk_pic_open') + '</b>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="pk-pic-close">' + t('pk_pic_close') + '</button></div>';
    if (!P.bits) {
      h += '<div class="muted small">' + t('pk_pic_step1') + '</div>' +
        '<pre class="pk-pic-prompt" dir="ltr">' + esc(PIC_PROMPT) + '</pre>' +
        '<div><button type="button" class="btn btn-sm" data-act="pk-pic-copy">' + t('pk_pic_copy') + '</button></div>' +
        '<div class="muted small">' + t('pk_pic_step2') + '</div>';
    }
    h += '<div><button type="button" class="btn' + (P.bits ? ' btn-sm' : ' btn-primary') + '" data-act="pk-pic-file" data-w="' + where + '"' + (busy ? ' disabled' : '') + '>' +
      '<span>' + t(P.bits ? 'pk_pic_other' : 'pk_pic_choose') + '</span></button></div>';
    if (P.err) h += '<div class="pk-err" role="alert">' + esc(P.err) + '</div>';
    if (busy) h += '<div class="muted small" role="status">' + esc(P.busy) + '</div>';
    if (P.shot) h += '<img class="pk-pic-shot" alt="" src="' + P.shot + '">';
    if (R) {
      var notes = '<b>' + t('pk_pic_found').replace('{n}', ltr(String(R.glyphs.length))).replace('{l}', ltr(String(R.lines))) + '</b>';
      if (R.missing.length) notes += '<div class="warn">' + t('pk_pic_missing').replace('{list}', ltr(R.missing.join(' '))) + '</div>';
      if (R.extra) notes += '<div class="warn">' + t('pk_pic_extra').replace('{n}', ltr(String(R.extra))) + '</div>';
      if (R.doubled.length) notes += '<div class="warn">' + t('pk_pic_doubled').replace('{list}', ltr(R.doubled.join(' '))) + '</div>';
      h += '<div class="pk-pic-notes small">' + notes + '<div class="muted">' + t('pk_pic_check') + '</div></div>' +
        '<div class="pk-net-row">' +
          '<label class="field"><span>' + t('pk_pic_order') + '</span><input class="inp" id="pkPicOrder_' + where + '" dir="ltr" maxlength="80" autocomplete="off" spellcheck="false" value="' + esc(P.order) + '"' + (busy ? ' disabled' : '') + '></label>' +
          '<button type="button" class="btn pk-pic-reread" data-act="pk-pic-read" data-w="' + where + '"' + (busy ? ' disabled' : '') + '><span>' + t('pk_pic_reread') + '</span></button>' +
        '</div>';
      if (P.fam) {
        h += '<div class="muted small">' + t('pk_pic_sample') + '</div>' +
          '<div class="pk-pic-sample" dir="ltr" style="font-family:' + esc("'" + P.fam + "', sans-serif") + '">NAME 10</div>' +
          '<div class="pk-pic-sample is-small" dir="ltr" style="font-family:' + esc("'" + P.fam + "', sans-serif") + '">ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</div>';
      }
      h += '<div class="pk-net-row">' +
          '<label class="field"><span>' + t('pk_pic_name') + '</span><input class="inp" id="pkPicName_' + where + '" dir="auto" maxlength="40" autocomplete="off" placeholder="' + esc(t('pk_pic_name_ph')) + '" value="' + esc(P.name) + '"' + (busy ? ' disabled' : '') + '></label>' +
          '<button type="button" class="btn btn-primary pk-pic-reread" data-act="pk-pic-save" data-w="' + where + '"' + (busy || !R.glyphs.some(function (g) { return g.char; }) ? ' disabled' : '') + '><span>' + t('pk_pic_save') + '</span></button>' +
        '</div>';
    }
    return h + '</div>';
  }
  function repaintPic() {
    ['form', 'tab'].forEach(function (w) {
      var el = document.getElementById('pkPic_' + w);
      if (el) el.outerHTML = picBox(w);
    });
  }
  function picFail(e) {
    return e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e);
  }

  function picInput() {
    var f = document.getElementById('pkPicFile');
    if (f) return f;
    f = document.createElement('input');
    f.type = 'file'; f.id = 'pkPicFile'; f.hidden = true; f.accept = 'image/*';
    document.body.appendChild(f);
    f.addEventListener('change', function () {
      var file = f.files && f.files[0];
      f.value = '';
      if (file && S.pic) takePicture(file);
    });
    return f;
  }

  /* The picture into ink and paper, at 1000–2000 px on its longer side. */
  function takePicture(file) {
    var P = S.pic;
    P.err = null; P.busy = t('pk_pic_reading'); P.read = null; P.shot = null; P.fam = null; repaintPic();
    var fr = new FileReader();
    fr.onerror = function () { P.busy = null; P.err = t('pk_err_bad_picture'); repaintPic(); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = fr.onerror;
      img.onload = function () {
        var long = Math.max(img.naturalWidth, img.naturalHeight);
        if (!long) return fr.onerror();
        var k = Math.min(2000 / long, Math.max(1, 1000 / long));
        var w = Math.max(16, Math.round(img.naturalWidth * k)), h = Math.max(16, Math.round(img.naturalHeight * k));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h).data;
        var n = w * h, lum = new Uint8Array(n), hist = new Array(256).fill(0);
        for (var i = 0; i < n; i++) { var v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; lum[i] = v; hist[v]++; }
        /* Otsu: the threshold that best splits the two tones */
        var sum = 0, sumB = 0, wB = 0, best = 0, thr = 128;
        for (i = 0; i < 256; i++) sum += i * hist[i];
        for (i = 0; i < 256; i++) {
          wB += hist[i]; if (!wB) continue;
          var wF = n - wB; if (!wF) break;
          sumB += i * hist[i];
          var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
          if (between > best) { best = between; thr = i; }
        }
        var ink = new Uint8Array(n), edge = 0, edgeInk = 0;
        for (i = 0; i < n; i++) ink[i] = lum[i] <= thr ? 1 : 0;
        for (var px = 0; px < w; px++) { edge += 2; edgeInk += ink[px] + ink[(h - 1) * w + px]; }
        for (var py = 0; py < h; py++) { edge += 2; edgeInk += ink[py * w] + ink[py * w + w - 1]; }
        if (edgeInk > edge / 2) for (i = 0; i < n; i++) ink[i] = 1 - ink[i];   // light letters on dark
        var bytes = new Uint8Array(Math.ceil(n / 8));
        for (i = 0; i < n; i++) if (ink[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
        var s = '';
        for (i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        /* what the person sees: the ink as it will be read */
        var out = x.createImageData(w, h);
        for (i = 0; i < n; i++) {
          var g = ink[i] ? 20 : 255;
          out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g; out.data[i * 4 + 3] = 255;
        }
        x.putImageData(out, 0, 0);
        P.w = w; P.h = h; P.bits = btoa(s); P.canvas = c;
        readPicture();
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }

  function readPicture() {
    var P = S.pic;
    if (!P || !P.bits) return;
    P.err = null; P.busy = t('pk_pic_reading'); repaintPic();
    API.post('/api/print-fonts/picture/read', { w: P.w, h: P.h, bits: P.bits, order: P.order }).then(function (r) {
      if (S.pic !== P) return;
      P.read = r; P.busy = null;
      /* the boxes and their characters, drawn over the ink */
      var c = document.createElement('canvas');
      c.width = P.w; c.height = P.h;
      var x = c.getContext('2d');
      x.drawImage(P.canvas, 0, 0);
      var fs = Math.max(14, Math.round(r.capPx * 0.3));
      x.lineWidth = Math.max(2, Math.round(r.capPx / 40));
      x.font = '700 ' + fs + 'px Montserrat, Arial, sans-serif';
      r.glyphs.forEach(function (g) {
        x.strokeStyle = g.char ? '#7AB800' : '#E5484D';
        x.strokeRect(g.x - 3, g.y - 3, g.w + 6, g.h + 6);
        var label = g.char || '?', lw = x.measureText(label).width + 8;
        x.fillStyle = g.char ? '#7AB800' : '#E5484D';
        x.fillRect(g.x - 3, Math.max(0, g.y - fs - 8), lw, fs + 6);
        x.fillStyle = '#fff';
        x.fillText(label, g.x + 1, Math.max(fs, g.y - 7));
      });
      P.shot = c.toDataURL('image/png');
      if (!r.preview || typeof FontFace === 'undefined') { repaintPic(); return; }
      var fam = 'pkpic-' + (++picFaces);
      var face = new FontFace(fam, 'url(data:font/woff2;base64,' + r.preview + ')', { weight: '1 1000' });
      face.load().then(function (f) { document.fonts.add(f); if (S.pic === P) { P.fam = fam; repaintPic(); } },
                       function () { repaintPic(); });
      repaintPic();
    }).catch(function (e) {
      if (S.pic !== P) return;
      P.busy = null; P.read = null; P.err = picFail(e); repaintPic();
    });
  }

  function savePicture(where) {
    var P = S.pic;
    if (!P || !P.bits || P.busy) return;
    var name = String(P.name || '').replace(/\s+/g, ' ').trim();
    if (!name) { P.err = t('pk_pic_need_name'); repaintPic(); return; }
    P.err = null; P.busy = t('pk_pic_saving'); repaintPic();
    API.post('/api/print-fonts/picture', { name: name, w: P.w, h: P.h, bits: P.bits, order: P.order }).then(function (r) {
      S.pic = null;
      toast(t('pk_tab_fonts'), t('pk_net_done').replace('{name}', r.font.name), 'ok', 4000);
      S.at = 0;
      return load().then(function () {
        if (where === 'form' && S.draft) { S.draft.fontId = r.font.id; repaintForm(); }
      });
    }).catch(function (e) {
      if (S.pic !== P) return;
      P.busy = null; P.err = picFail(e); repaintPic();
    });
  }

  function renameFont(f) {
    openModal({
      title: t('pk_rename_title'),
      body: '<div id="pkRename"><label class="field"><span>' + t('pk_f_font_name') + '</span>' +
        '<input class="inp" id="pkRenameName" dir="auto" maxlength="40" value="' + esc(f.name) + '"></label>' +
        '<label class="field"><span>' + t('pk_weight') + '</span>' +
        '<input class="inp" id="pkRenameWeight" inputmode="numeric" dir="ltr" maxlength="4" value="' + esc(String(f.weight)) + '"></label>' +
        '<div class="muted small">' + t('pk_weight_note') + '</div><div id="pkRenameErr"></div></div>',
      foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="pk-font-rename-go" data-id="' + f.id + '"><span>' + t('save') + '</span></button>'
    });
  }

  /* ------------------------------------------------- the product's Print
     A section of the product form (js/app-products.js): printable, and the
     club + season + kind that find the kit. An existing kit attaches by
     itself and draws; none, and "Create kit" opens the kit form filled in
     and attaches what it saves. State is P (one product form at a time). */
  var P = null;

  /* Stage 1b — the same section on the Add-product form. The form repaints
     on every box, so the section's state is kept across repaints while it is
     the NEW product's; formReset() after a save starts the next one clean. */
  function formSection() {
    if (P && P.productId === 'new') return '<div class="pe-sec pk-pe" id="pkPe">' + productInner() + '</div>';
    return productSection({ id: 'new', printable: false, printKitId: null });
  }
  function formReset() { if (P && P.productId === 'new') P = null; }

  function productSection(p) {
    P = { productId: p.id, printable: !!p.printable, kitId: p.printKitId || null, clubCode: null, season: '', kitType: '',
          style: null, derived: false };
    derive();
    return '<div class="pe-sec pk-pe" id="pkPe">' + productInner() + '</div>';
  }

  /* The club, season and kind the product's kit was found by — once the
     kits are in. A kit with no club is a STYLE (OG Classic): it stays
     attached until somebody chooses a club. */
  function derive() {
    if (!P || P.derived || !S.loaded) return;
    P.derived = true;
    var k = P.kitId ? kitById(P.kitId) : null;
    if (!k || k.archived) return;
    if (k.clubCode) { P.clubCode = k.clubCode; P.season = k.season || ''; P.kitType = k.kitType || ''; }
    else if (!k.isDefault) P.style = k.id;
  }

  function productInner() {
    if (!P) return '';
    derive();
    if (!S.loaded) {
      ready().then(function () { repaintProduct(); }).catch(function () {});
      return '<div class="pe-sec-h">' + t('pk_pe_title') + '</div><div class="muted small">' + t('pk_loading') + '</div>';
    }
    var h = '<div class="pe-sec-h">' + t('pk_pe_title') + '</div>' +
      '<label class="pk-tick"><input type="checkbox" id="pkPePrintable" data-change="pk-pe" data-k="printable"' + (P.printable ? ' checked' : '') + '> ' +
        t('pk_pe_printable') + '</label>' +
      '<div class="muted small">' + t('pk_pe_printable_note') + '</div>';
    if (!P.printable) return h;
    var clubs = '<option value="">' + esc(t('pk_pe_no_club')) + '</option>' + S.clubs.filter(function (c) { return !c.archived; })
      .map(function (c) { return opt(c.code, OG.lang === 'ar' ? c.ar : c.en, c.code === P.clubCode); }).join('');
    var types = '<option value="">—</option>' + S.kitTypes.map(function (k) { return opt(k, t('pk_type_' + k), k === P.kitType); }).join('');
    h += '<div class="pk-row3">' +
      '<label class="field"><span>' + t('pk_f_club') + '</span><select class="inp" data-change="pk-pe" data-k="clubCode">' + clubs + '</select></label>' +
      '<label class="field"><span>' + t('pk_f_season') + '</span><input class="inp" data-change="pk-pe" data-k="season" dir="ltr" placeholder="26/27" maxlength="7" value="' + esc(P.season) + '"' + (P.clubCode ? '' : ' disabled') + '></label>' +
      '<label class="field"><span>' + t('pk_f_kitType') + '</span><select class="inp" data-change="pk-pe" data-k="kitType"' + (P.clubCode ? '' : ' disabled') + '>' + types + '</select></label>' +
    '</div><div id="pkPeKit">' + productKit() + '</div>';
    return h;
  }

  /* The kit the choice names, or the default when no club is chosen. */
  function matchKit() {
    if (!P.clubCode) return null;
    return S.kits.filter(function (k) {
      return !k.archived && k.clubCode === P.clubCode && (k.season || '') === (P.season || '').trim() && (k.kitType || '') === (P.kitType || '');
    })[0] || null;
  }

  function productKit() {
    var k = matchKit();
    var def = S.kits.filter(function (x) { return x.isDefault; })[0];
    if (!P.clubCode && P.style && kitById(P.style)) {
      var st = kitById(P.style);
      P.kitId = st.id;
      return '<div class="pk-pe-kit">' + svg(st, { cls: 'pk-svg-sm' }) + '<div><b dir="auto">' + esc(st.label) + '</b>' +
        '<div class="muted small">' + t('pk_pe_attached') + '</div></div></div>';
    }
    if (!P.clubCode) {
      P.kitId = null;
      return '<div class="pk-pe-kit">' + (def ? svg(def, { cls: 'pk-svg-sm' }) : '') + '<div><b>' + t('pk_pe_default') + '</b>' +
        '<div class="muted small" dir="auto">' + esc(def ? def.label : '—') + '</div></div></div>';
    }
    if (k) {
      P.kitId = k.id;
      return '<div class="pk-pe-kit">' + svg(k, { cls: 'pk-svg-sm' }) + '<div><b dir="auto">' + esc(k.label) + '</b>' +
        '<div class="muted small">' + t('pk_pe_attached') + '</div></div></div>';
    }
    P.kitId = null;
    return '<div class="pk-pe-kit is-none"><div><b>' + t('pk_pe_none') + '</b><div class="muted small">' + t('pk_pe_none_why') + '</div>' +
      (canManage() ? '<button type="button" class="btn btn-sm mt" data-act="pk-pe-create">' + t('pk_pe_create') + '</button>' : '') +
      '</div></div>';
  }

  function repaintProduct() {
    var host = document.getElementById('pkPe');
    if (host) host.innerHTML = productInner();
  }

  /* What the product form's Save sends: the two columns, or nothing when the
     section was never drawn. A club chosen with no kit made yet is refused
     in words rather than saved as "the default" by surprise. */
  function productFields() {
    if (!P || !document.getElementById('pkPe')) return null;
    if (!P.derived && P.kitId) return { printable: P.printable ? 1 : 0, print_kit_id: P.printable ? P.kitId : null };
    if (P.printable && P.clubCode && !matchKit()) return { error: t('pk_pe_err_no_kit') };
    return { printable: P.printable ? 1 : 0, print_kit_id: P.printable ? (P.kitId || null) : null };
  }

  /* ------------------------------------------------------------- actions */

  function closeMenu() { if (S.menu !== null) { S.menu = null; paint(); } }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['pk-reload'] = function () { S.failed = null; S.loaded = false; paint(); load().catch(function () {}); };
    ACTIONS['pk-tab'] = function (el) { S.tab = el.getAttribute('data-k') === 'fonts' ? 'fonts' : 'kits'; S.menu = null; paint(); };
    ACTIONS['pk-noop'] = function () {};
    ACTIONS['pk-settings'] = function () { if (typeof Desk !== 'undefined' && Desk.gotoSettingsFold) Desk.gotoSettingsFold('webprint'); };
    ACTIONS['pk-new'] = function () { S.menu = null; paint(); openKitForm(null, null, null); };
    ACTIONS['pk-edit'] = function (el) {
      var k = kitById(+el.getAttribute('data-id'));
      S.menu = null; paint();
      if (k) openKitForm(k, null, null);
    };
    ACTIONS['pk-menu'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.menu = S.menu === id ? null : id;
      paint();
    };
    ACTIONS['pk-flag'] = function (el) {
      var id = +el.getAttribute('data-id');
      var body = {};
      body[el.getAttribute('data-f')] = el.getAttribute('data-v') === '1';
      S.menu = null; paint();
      API.patch('/api/print-kits/' + id, body).then(function (r) {
        toast(t('nav_printkits'), t('pk_saved').replace('{name}', r.kit.label), 'ok', 2500);
        S.at = 0; load().catch(function () {});
      }).catch(function (e) {
        toast(t('nav_printkits'), e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e), 'err', 6000);
      });
    };
    ACTIONS['pk-save'] = function (el) { save(el); };
    ACTIONS['pk-net-get'] = function (el) { getFromNet(el.getAttribute('data-w') === 'form' ? 'form' : 'tab'); };
    /* Enter in the box is the button. Bound once, at the document: the box is
       redrawn with its form and its tab. */
    document.addEventListener('keydown', function (e) {
      var tg = e.target;
      if (e.key !== 'Enter' || !tg || !tg.id || tg.id.indexOf('pkNetIn_') !== 0) return;
      e.preventDefault();
      getFromNet(tg.id.slice(8));
    });
    document.addEventListener('input', function (e) {
      var tg = e.target;
      if (!tg || !tg.id) return;
      if (tg.id.indexOf('pkNetIn_') === 0) S.net.text = tg.value;
      else if (S.pic && tg.id.indexOf('pkPicOrder_') === 0) S.pic.order = tg.value;
      else if (S.pic && tg.id.indexOf('pkPicName_') === 0) S.pic.name = tg.value;
    });
    ACTIONS['pk-pic-open'] = function (el) { S.pic = picFresh(el.getAttribute('data-w') === 'form' ? 'form' : 'tab'); repaintPic(); };
    ACTIONS['pk-pic-close'] = function () { S.pic = null; repaintPic(); };
    ACTIONS['pk-pic-file'] = function () { picInput().click(); };
    ACTIONS['pk-pic-read'] = function () { readPicture(); };
    ACTIONS['pk-pic-save'] = function (el) { savePicture(el.getAttribute('data-w') === 'form' ? 'form' : 'tab'); };
    ACTIONS['pk-pic-copy'] = function () {
      try {
        navigator.clipboard.writeText(PIC_PROMPT).then(function () { toast(t('pk_pic_open'), t('pk_pic_copied'), 'ok', 2500); });
      } catch (e) { /* the text is on screen to select by hand */ }
    };
    ACTIONS['pk-font-add'] = function () { var f = fileInput(); f.setAttribute('data-mode', 'add'); f.click(); };
    ACTIONS['pk-font-file'] = function (el) { var f = fileInput(); f.setAttribute('data-mode', 'replace:' + el.getAttribute('data-id')); f.click(); };
    ACTIONS['pk-font-rename'] = function (el) { var f = fontById(+el.getAttribute('data-id')); if (f) renameFont(f); };
    ACTIONS['pk-font-rename-go'] = function (el) {
      var id = +el.getAttribute('data-id');
      var name = (document.getElementById('pkRenameName') || {}).value;
      var weight = typeof Desk !== 'undefined' ? Desk.toCount((document.getElementById('pkRenameWeight') || {}).value) : 400;
      el.disabled = true;
      API.patch('/api/print-fonts/' + id, { name: name, weight: weight }).then(function () {
        closeModal(); S.at = 0; load().catch(function () {});
      }).catch(function (e) {
        el.disabled = false;
        var box = document.getElementById('pkRenameErr');
        if (box) box.innerHTML = '<div class="pk-err" role="alert">' +
          esc(e && e.code && I18N.en['pk_err_' + e.code] ? t('pk_err_' + e.code) : API.friendly(e)) + '</div>';
      });
    };
    ACTIONS['pk-font-archive'] = function (el) {
      var id = +el.getAttribute('data-id');
      el.disabled = true;
      API.patch('/api/print-fonts/' + id, { archived: el.getAttribute('data-v') === '1' }).then(function () {
        S.at = 0; load().catch(function () {});
      }).catch(function (e) {
        el.disabled = false;
        var msg = e && e.code === 'font_in_use' && e.detail && e.detail.kits
          ? t('pk_err_font_in_use_list').replace('{kits}', e.detail.kits.join(', '))
          : API.friendly(e);
        toast(t('pk_tab_fonts'), msg, 'err', 7000);
      });
    };
    ACTIONS['pk-seed'] = function () {
      S.busy = true; paint();
      API.post('/api/print-fonts/seed', {}).then(function (r) {
        S.busy = false;
        var bad = (r.results || []).filter(function (x) { return !x.ok; });
        if (bad.length) toast(t('pk_tab_fonts'), t('pk_seed_failed').replace('{names}', bad.map(function (x) { return x.name; }).join(', ')), 'err', 8000);
        else toast(t('pk_tab_fonts'), t('pk_seed_done'), 'ok', 3000);
        S.at = 0; load().catch(function () {});
      }).catch(function (e) { S.busy = false; paint(); toast(t('pk_tab_fonts'), API.friendly(e), 'err', 6000); });
    };
    ACTIONS['pk-pe-create'] = function () {
      if (!P) return;
      var keep = P;
      openKitFormOverProduct({ clubCode: keep.clubCode, season: keep.season ? keep.season.trim() : null, kitType: keep.kitType || null }, keep);
    };

    if (typeof CHANGES !== 'undefined') {
      CHANGES['pk-live'] = live;
      CHANGES['pk-pe'] = function (el) {
        if (!P) return;
        var k = el.getAttribute('data-k');
        if (k === 'printable') { P.printable = el.checked; repaintProduct(); return; }
        if (k === 'clubCode') {
          P.clubCode = el.value || null;
          P.style = null;
          if (!P.clubCode) { P.season = ''; P.kitType = ''; }
          repaintProduct();
          return;
        }
        if (k === 'season') P.season = el.value;
        if (k === 'kitType') P.kitType = el.value;
        /* The kit line alone: the season box keeps its caret. */
        var host = document.getElementById('pkPeKit');
        if (host) host.innerHTML = productKit();
      };
    }

    document.addEventListener('click', function (e) {
      if (S.menu === null) return;
      if (e.target.closest && e.target.closest('.pk-more')) return;
      closeMenu();
    }, true);
  }

  /* The kit form opens OVER the product form, which openModal would close —
     so the product form's typed values go into a holder first, the kit form
     runs, and the product form is opened again with the kit attached. */
  function openKitFormOverProduct(prefill, keep) {
    /* The Add-product form is the page itself, not a dialog: it stays under
       the kit form, and only the section needs the new kit. */
    if (keep && keep.productId === 'new') {
      openKitForm(null, prefill, function (kit) {
        P = keep;
        P.kitId = kit.id; P.clubCode = kit.clubCode; P.season = kit.season || ''; P.kitType = kit.kitType || '';
        P.printable = true; P.derived = true;
        repaintProduct();
      });
      return;
    }
    var reopen = typeof ProductForm !== 'undefined' && ProductForm.stash ? ProductForm.stash() : null;
    openKitForm(null, prefill, function (kit) {
      if (reopen) reopen(function () {
        P = keep;
        P.kitId = kit.id; P.clubCode = kit.clubCode; P.season = kit.season || ''; P.kitType = kit.kitType || '';
        P.printable = true;
        repaintProduct();
      });
    }, function () {
      if (reopen) reopen(function () { P = keep; repaintProduct(); });
    });
  }

  return {
    view: view, after: after, register: register, load: load, ready: ready,
    svg: svg, ensureFont: ensureFont, openKitForm: openKitForm,
    productSection: productSection, productFields: productFields,
    formSection: formSection, formReset: formReset,
    kits: function () { return S.kits; }
  };
})();
