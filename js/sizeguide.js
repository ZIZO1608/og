/* ==========================================================================
   OG SYSTEM — the size guide, in centimetres (night shift 28 Oct 2026)
   --------------------------------------------------------------------------
   Global `SizeGuide`, events on `data-sg` (click), `data-sg-in` (typing) and
   `data-sg-ch` (a select), one listener each on the document. The server half
   is server/lib/sizeguide.js (migration 077), and it decides: this file only
   draws, and says no before the request where it can.

   ONE EDITOR, FOUR PLACES. The grid is the same component in:
     'new'   — Warehouse → Add product, under the colours and sizes;
     'edit'  — the product editor (Edit product);
     'chart' — Settings → Size charts → a chart;
   and it is read in the product drawer, at the till (a sheet on its own
   layer, #sgRoot, so the till's size picker and the basket stay as they
   are), on the website (server side) and as a WhatsApp picture.

   Typing never repaints: a cell's value goes into the editor's state and the
   cell alone is marked. Ticking a measurement, choosing a chart or a mode
   repaints the editor's own host ([data-sg-host]) and nothing else.

   The grid is fast to fill: Enter moves to the next cell, Tab is the
   browser's own, a column pasted from Excel fills down from the cell it was
   pasted into (tabs fill across too), and every row but the first has
   "copy the row above". A comma is a decimal point ("52,5" is 52.5) and
   Arabic-Indic digits are read — the same rule as the server's.
   ========================================================================== */
var SizeGuide = (function () {
  'use strict';

  /* KEEP IN STEP with MEASURES in server/lib/sizeguide.js and
     web.size_measure() in server/supabase/044_size_guides.sql. */
  var MEASURES = [
    { id: 'chest', unit: 'cm' }, { id: 'length', unit: 'cm' }, { id: 'shoulder', unit: 'cm' },
    { id: 'sleeve', unit: 'cm' }, { id: 'waist', unit: 'cm' }, { id: 'hip', unit: 'cm' },
    { id: 'inseam', unit: 'cm' }, { id: 'foot', unit: 'cm' },
    { id: 'eu', unit: '' }, { id: 'us', unit: '' }, { id: 'uk', unit: '' }
  ];
  var ORDER = MEASURES.map(function (m) { return m.id; });
  var UNIT = {};
  MEASURES.forEach(function (m) { UNIT[m.id] = m.unit; });
  /* Length belongs to tops and to bottoms; it is one measurement, so ticking
     it in either group ticks it in both. */
  var GROUPS = [
    { id: 'tops', ms: ['chest', 'length', 'shoulder', 'sleeve'] },
    { id: 'bottoms', ms: ['waist', 'hip', 'length', 'inseam'] },
    { id: 'shoes', ms: ['foot', 'eu', 'us', 'uk'] }
  ];
  var FITS = ['small', 'true', 'large'];

  var ED = {};        /* key → editor state */
  var CH = null;      /* the charts, once asked for */
  var chLoading = false;

  function mName(id) { return t('sg_m_' + id); }
  function isClothes(type) { return (CONFIG.SG_CLOTHES || []).indexOf(type) >= 0; }

  /* ---------------------------------------------------------- the numbers */
  function fold(v) {
    return String(v == null ? '' : v).trim()
      .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })
      .replace(/[\u066B,]/g, '.').replace(/\s+/g, '');
  }
  /* A typed cell → a number, or NaN, or null for blank. */
  function parse(v, m) {
    var s = fold(v);
    if (s === '') return null;
    if (!/^\d+(\.\d)?$/.test(s)) return NaN;
    var n = Number(s), max = UNIT[m] === 'cm' ? 300 : 60;
    return n > 0 && n <= max ? n : NaN;
  }
  function show(n) { return n == null || n === '' ? '' : String(n); }

  /* ----------------------------------------------------------- the state */
  function blank(sizes) {
    return { sizes: sizes || [], chartId: null, follows: false, measures: [], values: {}, fit: '', noteEn: '', noteAr: '', dirty: false };
  }
  function fromGuide(g, sizes) {
    var e = blank(sizes);
    if (!g) return e;
    e.chartId = g.chartId || null; e.follows = !!g.follows; e.measures = (g.measures || []).slice();
    (g.rows || []).forEach(function (r) {
      e.values[r.size] = {};
      Object.keys(r.values || {}).forEach(function (m) { e.values[r.size][m] = show(r.values[m]); });
    });
    e.fit = g.fit || ''; e.noteEn = g.noteEn || ''; e.noteAr = g.noteAr || '';
    return e;
  }
  function chart(id) { return (CH || []).filter(function (c) { return c.id === Number(id); })[0] || null; }
  /* What the grid shows: the chart's numbers while following one. */
  function cellsOf(e) {
    if (e.follows && chart(e.chartId)) {
      var c = chart(e.chartId), map = {};
      c.rows.forEach(function (r) { map[r.size] = r.values || {}; });
      return { measures: c.measures, val: function (s, m) { return show((map[s] || {})[m]); } };
    }
    return { measures: e.measures, val: function (s, m) { return (e.values[s] || {})[m] || ''; } };
  }

  function loadCharts(after) {
    if (CH && !after) return;
    if (chLoading) return;
    if (!allow('product.read') && !allow('product.write')) return;
    chLoading = true;
    API.get('/api/size-charts').then(function (r) {
      CH = r.charts || [];
      chLoading = false;
      if (after) after(); else repaintAll();
    }).catch(function () { chLoading = false; CH = CH || []; });
  }

  /* -------------------------------------------------------- the editor */
  function editorHtml(key, opts) {
    opts = opts || {};
    var e = ED[key];
    if (!e) return '';
    if (!CH) loadCharts();
    var c = cellsOf(e);
    var follows = e.follows && chart(e.chartId);
    var h = '<div class="sg-ed" data-sg-host="' + key + '">';

    if (opts.charts !== false) {
      var list = (CH || []).filter(function (x) { return x.active || x.id === e.chartId; });
      h += '<div class="sg-row"><label class="field sg-chart"><span>' + t('sg_start_from') + '</span>' +
        '<select class="inp" data-sg-ch="chart" data-k="' + key + '"><option value="">' + t('sg_no_chart') + '</option>' +
        list.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === e.chartId ? ' selected' : '') + '>' +
            esc(OG.lang === 'ar' ? x.nameAr : x.nameEn) + '</option>';
        }).join('') + '</select></label>';
      if (e.chartId && chart(e.chartId)) {
        h += '<div class="seg sg-mode" role="group">' +
          '<button type="button" class="' + (e.follows ? 'on' : '') + '" aria-pressed="' + !!e.follows + '" data-sg="mode" data-k="' + key + '" data-v="follow">' + t('sg_follow') + '</button>' +
          '<button type="button" class="' + (e.follows ? '' : 'on') + '" aria-pressed="' + !e.follows + '" data-sg="mode" data-k="' + key + '" data-v="own">' + t('sg_own') + '</button></div>';
      }
      h += '</div>';
      if (follows) h += '<p class="muted small sg-hint">' + t('sg_follow_hint') + '</p>';
    }

    /* the measurements, ticked */
    h += '<div class="sg-ms">';
    GROUPS.forEach(function (g) {
      h += '<div class="sg-mg"><span class="lbl">' + t('sg_g_' + g.id) + '</span><div class="chip-row">';
      g.ms.forEach(function (m) {
        var on = c.measures.indexOf(m) >= 0;
        h += '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-sg="m" data-k="' + key + '" data-m="' + m + '"' +
          (follows ? ' disabled' : '') + '>' + (on ? '✓ ' : '') + esc(mName(m)) + '</button>';
      });
      h += '</div></div>';
    });
    h += '</div>';

    /* the grid */
    if (!e.sizes.length) {
      h += '<p class="muted small sg-hint">' + t(opts.noSizes || 'sg_no_sizes') + '</p>';
    } else if (!c.measures.length) {
      h += '<p class="muted small sg-hint">' + t('sg_tick_first') + '</p>';
    } else {
      h += '<div class="table-wrap sg-wrap"><table class="tbl tbl-compact sg-grid"><thead><tr><th>' + t('size') + '</th>';
      c.measures.forEach(function (m) {
        h += '<th class="num">' + esc(mName(m)) + (UNIT[m] ? ' <small dir="ltr">(cm)</small>' : '') + '</th>';
      });
      h += '<th></th></tr></thead><tbody>';
      e.sizes.forEach(function (s, ri) {
        h += '<tr><th scope="row"><b dir="ltr">' + esc(s) + '</b></th>';
        c.measures.forEach(function (m, ci) {
          var v = c.val(s, m), n = parse(v, m);
          h += '<td class="num"><input class="inp sg-cell' + (v !== '' && !(n > 0) ? ' sg-bad' : '') + '" type="text" inputmode="decimal" dir="ltr" ' +
            'enterkeyhint="next" autocomplete="off" aria-label="' + esc(s + ' · ' + mName(m)) + '" ' +
            'data-sg-in="cell" data-k="' + key + '" data-size="' + esc(s) + '" data-m="' + m + '" data-r="' + ri + '" data-c="' + ci + '" ' +
            'value="' + esc(v) + '"' + (follows ? ' readonly' : '') + '></td>';
        });
        h += '<td>' + (ri && !follows ? '<button type="button" class="btn btn-sm btn-ghost sg-up" data-sg="copyup" data-k="' + key + '" data-r="' + ri + '" title="' +
          esc(t('sg_copy_up')) + '" aria-label="' + esc(t('sg_copy_up')) + '">↑</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (!follows) h += '<p class="muted small sg-hint">' + t('sg_grid_hint') + '</p>';
    }

    /* the fit, and the notes */
    if (!follows) {
      h += '<div class="sg-row sg-fit"><span class="lbl">' + t('sg_fit') + '</span><div class="chip-row">' +
        ['', 'small', 'true', 'large'].map(function (f) {
          return '<button type="button" class="chip' + (e.fit === f ? ' on' : '') + '" aria-pressed="' + (e.fit === f) + '" data-sg="fit" data-k="' + key + '" data-v="' + f + '">' +
            t(f ? 'sg_fit_' + f : 'sg_fit_none') + '</button>';
        }).join('') + '</div></div>' +
        '<div class="pe-grid sg-notes">' +
          '<label class="field"><span>' + t('sg_note') + ' · English</span><input class="inp" dir="ltr" maxlength="200" data-sg-in="noteEn" data-k="' + key + '" value="' + esc(e.noteEn) + '"></label>' +
          '<label class="field"><span>' + t('sg_note') + ' · عربي</span><input class="inp" dir="rtl" lang="ar" maxlength="200" data-sg-in="noteAr" data-k="' + key + '" value="' + esc(e.noteAr) + '"></label>' +
        '</div>';
    }
    h += '<div class="sg-why" role="status" aria-live="polite" data-sg-why="' + key + '"></div>';
    return h + '</div>';
  }

  function repaint(key) {
    var host = document.querySelector('[data-sg-host="' + key + '"]');
    if (!host) return false;
    var wrap = document.createElement('div');
    wrap.innerHTML = editorHtml(key, host.getAttribute('data-sg-opts') ? JSON.parse(host.getAttribute('data-sg-opts')) : undefined);
    var fresh = wrap.firstChild;
    if (host.getAttribute('data-sg-opts')) fresh.setAttribute('data-sg-opts', host.getAttribute('data-sg-opts'));
    host.parentNode.replaceChild(fresh, host);
    if (typeof hintInputs === 'function') hintInputs(fresh);
    return true;
  }
  function repaintAll() { Object.keys(ED).forEach(repaint); }

  /* The guide to send, or { error, size, m } — `required` says an empty
     guide is not allowed (clothes). */
  function payload(key, required) {
    var e = ED[key];
    if (!e) return { guide: null };
    if (e.follows && e.chartId) {
      var c = chart(e.chartId);
      if (c) {
        var have = {};
        c.rows.forEach(function (r) { have[r.size] = r.values || {}; });
        for (var i = 0; i < e.sizes.length; i++) {
          for (var j = 0; j < c.measures.length; j++) {
            var cv = (have[e.sizes[i]] || {})[c.measures[j]];
            if (typeof cv !== 'number') return { error: t('sg_chart_missing').replace('{size}', e.sizes[i]), size: e.sizes[i] };
          }
        }
      }
      return { guide: { chartId: e.chartId, follows: true } };
    }
    if (!e.measures.length) {
      if (required) return { error: t('sg_required') };
      return { guide: e.dirty ? { none: true } : null, none: true };
    }
    var rows = [];
    for (var ri = 0; ri < e.sizes.length; ri++) {
      var s = e.sizes[ri], values = {};
      for (var mi = 0; mi < e.measures.length; mi++) {
        var m = e.measures[mi], raw = (e.values[s] || {})[m], n = parse(raw, m);
        if (n === null) return { error: t('sg_empty_cell').replace('{size}', s).replace('{m}', mName(m)), size: s, m: m };
        if (!(n > 0)) return { error: t(UNIT[m] === 'cm' ? 'sg_bad_cm' : 'sg_bad_shoe').replace('{size}', s).replace('{m}', mName(m)), size: s, m: m };
        values[m] = n;
      }
      rows.push({ size: s, values: values });
    }
    return { guide: { chartId: e.chartId || null, follows: false, measures: e.measures.slice(), rows: rows,
                      fit: e.fit || null, noteEn: e.noteEn, noteAr: e.noteAr } };
  }

  /* A refusal, said under the grid and on the cell that caused it. */
  function sayWhy(key, res) {
    var box = document.querySelector('[data-sg-why="' + key + '"]');
    if (box) box.textContent = res && res.error ? res.error : '';
    if (res && res.size && res.m) {
      var cell = document.querySelector('[data-sg-host="' + key + '"] .sg-cell[data-size="' + cssq(res.size) + '"][data-m="' + res.m + '"]');
      if (cell) { cell.classList.add('sg-bad'); cell.scrollIntoView({ block: 'center' }); cell.focus(); }
    } else if (box && res && res.error) box.scrollIntoView({ block: 'center' });
  }
  function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* A server refusal (sg_*) → the same place, in this screen's words. */
  function serverWhy(key, err) {
    var size = err && err.detail ? err.detail.size : (err && err.size);
    var m = err && err.detail ? err.detail.measure : (err && err.measure);
    sayWhy(key, { error: API.friendly(err), size: size, m: m });
  }

  /* ------------------------------------------------------------ events */
  var ACT = {
    m: function (el) {
      var e = ED[el.getAttribute('data-k')], m = el.getAttribute('data-m');
      if (!e || e.follows) return;
      var i = e.measures.indexOf(m);
      if (i >= 0) e.measures.splice(i, 1); else e.measures.push(m);
      e.measures.sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
      e.dirty = true;
      repaint(el.getAttribute('data-k'));
    },
    mode: function (el) {
      var key = el.getAttribute('data-k'), e = ED[key], c = chart(e && e.chartId);
      if (!e || !c) return;
      if (el.getAttribute('data-v') === 'follow') e.follows = true;
      else if (e.follows) {
        /* "Start from it": the chart's numbers become this product's own. */
        e.follows = false; e.measures = c.measures.slice(); e.values = {};
        c.rows.forEach(function (r) {
          e.values[r.size] = {};
          Object.keys(r.values || {}).forEach(function (m) { e.values[r.size][m] = show(r.values[m]); });
        });
        e.fit = c.fit || ''; e.noteEn = c.noteEn || ''; e.noteAr = c.noteAr || '';
      }
      e.dirty = true;
      repaint(key);
    },
    fit: function (el) {
      var key = el.getAttribute('data-k'), e = ED[key];
      if (!e) return;
      e.fit = el.getAttribute('data-v') || ''; e.dirty = true;
      repaint(key);
    },
    copyup: function (el) {
      var key = el.getAttribute('data-k'), e = ED[key], r = +el.getAttribute('data-r');
      if (!e || !r) return;
      var from = e.sizes[r - 1], to = e.sizes[r];
      e.values[to] = Object.assign({}, e.values[from] || {});
      e.dirty = true;
      repaint(key);
      var first = document.querySelector('[data-sg-host="' + key + '"] .sg-cell[data-r="' + r + '"]');
      if (first) first.focus();
    },
    till: function (el) { openSheet(+el.getAttribute('data-pid'), el.getAttribute('data-wh')); },
    close: function () { closeSheet(); },
    wa: function (el) { send(+el.getAttribute('data-pid'), el); },
    edit: function (el) {
      var pid = +el.getAttribute('data-pid');
      if (typeof closeDrawer === 'function') closeDrawer();
      if (typeof openProductEditor === 'function') openProductEditor(pid, { sizeGuide: true });
    }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-sg]') : null;
    if (!el || el.disabled) return;
    var fn = ACT[el.getAttribute('data-sg')];
    if (!fn) return;
    if (el.getAttribute('data-sg') === 'back' && ev.target !== el) return;
    ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.getAttribute('data-sg-in')) return;
    var e = ED[el.getAttribute('data-k')];
    if (!e) return;
    var what = el.getAttribute('data-sg-in');
    e.dirty = true;
    if (what === 'cell') {
      var s = el.getAttribute('data-size'), m = el.getAttribute('data-m');
      (e.values[s] = e.values[s] || {})[m] = el.value;
      var n = parse(el.value, m);
      el.classList.toggle('sg-bad', el.value.trim() !== '' && !(n > 0));
      var why = document.querySelector('[data-sg-why="' + el.getAttribute('data-k') + '"]');
      if (why && why.textContent) why.textContent = '';
    } else if (what === 'noteEn' || what === 'noteAr') {
      e[what] = el.value;
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-sg-ch') !== 'chart') return;
    var key = el.getAttribute('data-k'), e = ED[key];
    if (!e) return;
    e.chartId = el.value ? Number(el.value) : null;
    e.follows = !!e.chartId;
    e.dirty = true;
    repaint(key);
  });
  /* Enter: the next cell, along the row, then down. */
  document.addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (ev.key !== 'Enter' || !el.classList || !el.classList.contains('sg-cell')) return;
    ev.preventDefault();
    var host = el.closest('[data-sg-host]');
    var cells = host ? [].slice.call(host.querySelectorAll('.sg-cell')) : [];
    var i = cells.indexOf(el);
    var next = cells[ev.shiftKey ? i - 1 : i + 1];
    if (next) { next.focus(); next.select(); }
  });
  /* A column (or a block) pasted from Excel fills down from this cell. */
  document.addEventListener('paste', function (ev) {
    var el = ev.target;
    if (!el.classList || !el.classList.contains('sg-cell') || el.readOnly) return;
    var text = (ev.clipboardData || window.clipboardData).getData('text') || '';
    if (!/[\n\t]/.test(text.trim())) return;          /* one value: the browser's own paste */
    ev.preventDefault();
    var key = el.getAttribute('data-k'), e = ED[key];
    if (!e) return;
    var r0 = +el.getAttribute('data-r'), c0 = +el.getAttribute('data-c');
    var lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
    lines.forEach(function (line, dr) {
      line.split('\t').forEach(function (val, dc) {
        var s = e.sizes[r0 + dr], m = e.measures[c0 + dc];
        if (s === undefined || m === undefined) return;
        (e.values[s] = e.values[s] || {})[m] = val.trim();
      });
    });
    e.dirty = true;
    repaint(key);
    var last = document.querySelector('[data-sg-host="' + key + '"] .sg-cell[data-r="' + Math.min(r0 + lines.length - 1, e.sizes.length - 1) + '"][data-c="' + c0 + '"]');
    if (last) last.focus();
  });

  /* ----------------------------------------- Add product (Warehouse) */
  function formSizes() {
    return typeof ColourForm !== 'undefined' && ColourForm.sizesInUse ? ColourForm.sizesInUse() : [];
  }
  function formHtml() {
    var type = OG.wh && OG.wh.type;
    var sizes = SizeOrder.sizes(formSizes(), DB.sizeSets[type] || []);
    if (!ED['new']) ED['new'] = blank(sizes);
    ED['new'].sizes = sizes;
    var req = isClothes(type);
    return '<section class="sg-card" id="sgNew"><div class="sg-head"><span class="lbl">' + t('sg_title') + '</span>' +
      '<span class="badge ' + (req ? 'warning' : 'neutral') + '">' + t(req ? 'sg_required_badge' : 'sg_optional_badge') + '</span></div>' +
      editorHtml('new', { noSizes: 'sg_qty_first' }).replace('<div class="sg-ed"', '<div class="sg-ed" data-sg-opts=\'{"noSizes":"sg_qty_first"}\'') +
      '</section>';
  }
  /* ColourForm calls this when a quantity moves a size in or out. */
  function sizesMoved() {
    var e = ED['new'];
    if (!e || !document.querySelector('[data-sg-host="new"]')) return;
    var type = OG.wh && OG.wh.type;
    var sizes = SizeOrder.sizes(formSizes(), DB.sizeSets[type] || []);
    if (sizes.join('|') === e.sizes.join('|')) return;
    e.sizes = sizes;
    repaint('new');
  }
  function newPayload() {
    var res = payload('new', isClothes(OG.wh && OG.wh.type));
    if (res.error) sayWhy('new', res);
    return res;
  }
  function formReset() { delete ED['new']; }

  /* ---------------------------------------------------- Edit product */
  function productSizes(p) {
    var seen = {}, out = [];
    DB.variantsOf(p.id).forEach(function (v) { if (!seen[v.size]) { seen[v.size] = 1; out.push(v.size); } });
    return SizeOrder.sizes(out, DB.sizeSets[p.type] || []);
  }
  function editSection(p, open) {
    ED['edit'] = fromGuide(p.sizeGuide, productSizes(p));
    var req = isClothes(p.type);
    return '<div class="wh-fold sg-fold"><button class="wh-more-h" type="button" data-act="pe-sg">' + t('sg_title') +
      ' <span class="badge ' + (p.sizeGuide ? 'success' : (req ? 'warning' : 'neutral')) + '">' +
      t(p.sizeGuide ? 'sg_has' : (req ? 'sg_missing' : 'sg_optional_badge')) + '</span><span class="wh-more-x">' + (open ? '−' : '+') + '</span></button>' +
      '<div class="wh-fold-b" id="peSg"' + (open ? '' : ' hidden') + '>' + editorHtml('edit') + '</div></div>';
  }
  /* For prod-edit-save: null when nothing changed, else {guide} or {error}. */
  function editPayload() {
    var e = ED['edit'];
    if (!e || !e.dirty) return null;
    var res = payload('edit', false);
    if (res.error) {
      var b = document.getElementById('peSg');
      if (b && b.hidden) b.hidden = false;
      sayWhy('edit', res);
    }
    return res;
  }
  function saveFor(pid, guide) {
    return API.put('/api/products/' + pid + '/size-guide', { guide: guide }).catch(function (err) {
      serverWhy('edit', err);
      throw err;
    });
  }

  /* ------------------------------------------------- reading a guide */
  function tableHtml(g, opts) {
    opts = opts || {};
    if (!g || !g.measures || !g.measures.length) return '';
    var h = '<div class="table-wrap"><table class="tbl tbl-compact sg-read"><thead><tr><th>' + t('size') + '</th>';
    g.measures.forEach(function (m) { h += '<th class="num">' + esc(mName(m)) + (UNIT[m] ? ' <small dir="ltr">(cm)</small>' : '') + '</th>'; });
    h += '</tr></thead><tbody>';
    g.rows.forEach(function (r) {
      var hot = opts.inStock && opts.inStock[r.size];
      h += '<tr' + (hot ? ' class="sg-hot"' : '') + '><td class="sg-sz"><b dir="ltr">' + esc(r.size) + '</b>' +
        (opts.inStock ? (hot ? ' <span class="badge success">' + t('sg_here') + '</span>' : ' <span class="muted small">' + t('sg_not_here') + '</span>') : '') + '</td>';
      g.measures.forEach(function (m) {
        var v = r.values ? r.values[m] : null;
        h += '<td class="num"><bdi dir="ltr">' + (typeof v === 'number' ? esc(String(v)) : '—') + '</bdi></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var note = OG.lang === 'ar' ? (g.noteAr || g.noteEn) : (g.noteEn || g.noteAr);
    if (g.fit || note) {
      h += '<p class="sg-fitline">' + (g.fit ? '<b>' + t('sg_fit_' + g.fit) + '</b>' : '') +
        (g.fit && note ? ' · ' : '') + (note ? '<span dir="auto">' + esc(note) + '</span>' : '') + '</p>';
    }
    return h;
  }

  /* The product drawer's card. */
  function card(p) {
    var g = p.sizeGuide, req = isClothes(p.type), canEdit = allow('product.write');
    if (!g && !req && !canEdit) return '';
    var h = '<div class="card mb sg-card-r"><div class="card-head"><h3>' + t('sg_title') + '</h3>' +
      (g && g.follows ? '<span class="badge neutral">' + t('sg_follows_badge') + '</span>' : '') + '</div>';
    if (g) {
      h += tableHtml(g);
      h += '<div class="sg-acts">' +
        '<button class="btn btn-sm" data-sg="wa" data-pid="' + p.id + '">' + t('sg_send') + '</button>' +
        (canEdit ? '<button class="btn btn-sm btn-ghost" data-sg="edit" data-pid="' + p.id + '">' + t('edit') + '</button>' : '') +
      '</div>';
    } else {
      h += '<p class="muted small">' + t(req ? 'sg_none_clothes' : 'sg_none_shoes') + '</p>' +
        (canEdit ? '<div class="sg-acts"><button class="btn btn-sm" data-sg="edit" data-pid="' + p.id + '">' + t('sg_add') + '</button></div>' : '');
    }
    return h + '</div>';
  }

  /* The till's size picker: one button, only when there is a guide. */
  function tillButton(p, whId) {
    if (!p || !p.sizeGuide) return '';
    return '<button type="button" class="btn btn-sm sg-till-b" data-sg="till" data-pid="' + p.id + '" data-wh="' + esc(whId || '') + '">' +
      '<span aria-hidden="true">📏</span> ' + t('sg_title') + '</button>';
  }

  /* ---------------------------------------------- the till's sheet
     On its own layer (#sgRoot), never through openModal: the size picker it
     is opened from stays open under it, and the basket and a half-typed
     discount are not touched. */
  var sheetPid = null;
  function openSheet(pid, whId) {
    var p = DB.product(pid);
    if (!p || !p.sizeGuide) return;
    closeSheet();
    sheetPid = pid;
    var inStock = {};
    DB.variantsOf(pid).forEach(function (v) {
      var n = whId ? DB.stockAt(v, whId) : v.qty;
      if (n > 0) inStock[v.size] = true;
    });
    var root = document.createElement('div');
    root.id = 'sgRoot';
    root.className = 'sg-back' + (window.innerWidth <= 560 ? ' as-sheet' : '');
    root.setAttribute('data-sg', 'close');
    root.innerHTML = '<div class="sg-sheet" role="dialog" aria-modal="true" aria-label="' + esc(t('sg_title')) + '">' +
      '<div class="sg-sheet-h"><h3>' + t('sg_title') + ' · ' + esc(p.name) + '</h3>' +
        '<button class="x" data-sg="close" aria-label="' + esc(t('close')) + '">&times;</button></div>' +
      '<div class="sg-sheet-b">' + tableHtml(p.sizeGuide, { inStock: inStock }) + '</div>' +
      '<div class="sg-sheet-f"><button class="btn" data-sg="wa" data-pid="' + p.id + '">' + t('sg_send') + '</button>' +
        '<button class="btn btn-primary" data-sg="close">' + t('close') + '</button></div></div>';
    /* Only the backdrop itself closes: a press inside the sheet is not one. */
    root.addEventListener('click', function (ev) { if (ev.target === root) closeSheet(); });
    root.querySelector('.sg-sheet').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sg]');
      if (b && b.getAttribute('data-sg') === 'close') { ev.stopPropagation(); closeSheet(); }
    });
    root.removeAttribute('data-sg');
    document.body.appendChild(root);
    var x = root.querySelector('.sg-sheet-f .btn-primary');
    if (x) x.focus();
  }
  function closeSheet() {
    var r = document.getElementById('sgRoot');
    if (r) r.parentNode.removeChild(r);
    sheetPid = null;
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && document.getElementById('sgRoot')) { ev.preventDefault(); ev.stopPropagation(); closeSheet(); }
  }, true);
  if (typeof Layers !== 'undefined') Layers.register('sizeguide', function () { return !!document.getElementById('sgRoot'); }, closeSheet, 4);

  /* --------------------------------------------- the WhatsApp picture
     A clean branded PNG drawn on a canvas: the OG mark, the product, the
     table, the fit and the note, in both languages. On a phone it goes
     through the share sheet as a file; elsewhere it downloads and WhatsApp
     opens with the caption — Arabic, the rule, English (WA.both). */
  var MARK = null;
  function mark() {
    if (MARK) return Promise.resolve(MARK);
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () { MARK = img; ok(img); };
      img.onerror = function () { ok(null); };
      img.src = 'assets/logo.svg';
    });
  }
  var AR_NAME = { chest: 'عرض الصدر', length: 'الطول', shoulder: 'عرض الكتف', sleeve: 'طول الكم', waist: 'الخصر',
                  hip: 'الورك', inseam: 'الطول الداخلي', foot: 'طول القدم', eu: 'EU', us: 'US', uk: 'UK' };
  var EN_NAME = { chest: 'Chest width', length: 'Length', shoulder: 'Shoulder', sleeve: 'Sleeve', waist: 'Waist',
                  hip: 'Hip', inseam: 'Inseam', foot: 'Foot length', eu: 'EU', us: 'US', uk: 'UK' };
  var FIT_AR = { small: 'المقاس صغير — خود مقاس أكبر', true: 'المقاس مظبوط', large: 'المقاس كبير — خود مقاس أصغر' };
  var FIT_EN = { small: 'Runs small — take a size up', true: 'True to size', large: 'Runs large — take a size down' };

  function draw(p) {
    var g = p.sizeGuide;
    var W = 1080, pad = 64, rowH = 76, cols = g.measures.length + 1;
    var headH = 300, tableH = rowH * (g.rows.length + 1) + 24, footH = 200;
    var H = headH + tableH + footH;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    return mark().then(function (m) {
      x.fillStyle = '#0B0B0D'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#C6FF00'; x.fillRect(0, 0, W, 10);
      if (m) { try { x.drawImage(m, pad, 44, 96, 96); } catch (e) { /* no mark */ } }
      x.fillStyle = '#FFFFFF'; x.textBaseline = 'middle';
      x.font = '700 30px Montserrat, Tahoma, sans-serif'; x.textAlign = 'left';
      x.fillText('OG SPORTS', pad + 120, 74);
      x.fillStyle = '#A1A1AA'; x.font = '600 24px Montserrat, Tahoma, sans-serif';
      x.fillText('Size guide · cm', pad + 120, 112);
      x.textAlign = 'right'; x.direction = 'rtl'; x.fillStyle = '#A1A1AA';
      x.fillText('دليل المقاسات · سم', W - pad, 112);
      x.direction = 'ltr';
      x.textAlign = 'left'; x.fillStyle = '#FFFFFF'; x.font = '700 46px Montserrat, Tahoma, sans-serif';
      var name = p.name.length > 34 ? p.name.slice(0, 33) + '…' : p.name;
      x.fillText(name, pad, 210);
      /* the table */
      var top = headH, colW = (W - pad * 2) / cols;
      x.fillStyle = '#18181B'; x.fillRect(pad, top, W - pad * 2, rowH);
      x.font = '700 22px Montserrat, Tahoma, sans-serif'; x.fillStyle = '#C6FF00'; x.textAlign = 'center';
      x.fillText('Size · المقاس', pad + colW / 2, top + rowH / 2);
      g.measures.forEach(function (ms, i) {
        var cx = pad + colW * (i + 1) + colW / 2;
        x.fillStyle = '#FFFFFF'; x.font = '700 20px Montserrat, Tahoma, sans-serif';
        x.fillText(EN_NAME[ms], cx, top + rowH / 2 - 13);
        x.fillStyle = '#A1A1AA'; x.font = '600 20px Tahoma, sans-serif';
        x.fillText(AR_NAME[ms], cx, top + rowH / 2 + 15);
      });
      g.rows.forEach(function (r, ri) {
        var y = top + rowH * (ri + 1);
        if (ri % 2 === 0) { x.fillStyle = '#121214'; x.fillRect(pad, y, W - pad * 2, rowH); }
        x.fillStyle = '#FFFFFF'; x.font = '700 30px Montserrat, Tahoma, sans-serif';
        x.fillText(r.size, pad + colW / 2, y + rowH / 2);
        x.font = '600 28px Montserrat, Tahoma, sans-serif';
        g.measures.forEach(function (ms, i) {
          var v = r.values ? r.values[ms] : null;
          x.fillText(typeof v === 'number' ? String(v) : '—', pad + colW * (i + 1) + colW / 2, y + rowH / 2);
        });
      });
      /* the fit and the note */
      var fy = top + tableH + 30;
      x.textAlign = 'left'; x.direction = 'ltr'; x.fillStyle = '#FFFFFF'; x.font = '600 26px Montserrat, Tahoma, sans-serif';
      var en = [g.fit ? FIT_EN[g.fit] : '', g.noteEn || ''].filter(Boolean).join(' · ');
      var ar = [g.fit ? FIT_AR[g.fit] : '', g.noteAr || ''].filter(Boolean).join(' · ');
      if (en) x.fillText(en.slice(0, 70), pad, fy + 20);
      if (ar) { x.textAlign = 'right'; x.direction = 'rtl'; x.fillText(ar.slice(0, 70), W - pad, fy + 70); x.direction = 'ltr'; }
      x.textAlign = 'left'; x.fillStyle = '#71717A'; x.font = '600 22px Montserrat, Tahoma, sans-serif';
      x.fillText((CONFIG.SHOP_NAME || 'OG Sports') + (CONFIG.SHOP_PHONE ? ' · ' + CONFIG.SHOP_PHONE : ''), pad, H - 50);
      return new Promise(function (ok) { cv.toBlob(function (b) { ok(b); }, 'image/png'); });
    });
  }

  function caption(p) {
    return WA.both(
      ['📏 *دليل المقاسات*', p.name, 'كل القياسات بالسنتيمتر. إذا محتار بين مقاسين، راسلنا ومنساعدك 🙏'],
      ['📏 *Size guide*', p.name, 'All measurements in centimetres. Between two sizes? Message us and we will help 🙏']
    );
  }

  function send(pid, el) {
    var p = DB.product(pid);
    if (!p || !p.sizeGuide) return;
    var unbusy = typeof busyButton === 'function' ? busyButton(el) : function () {};
    draw(p).then(function (blob) {
      unbusy();
      if (!blob) { toast(t('sg_title'), t('sg_img_failed'), 'err'); return; }
      var fname = 'size-guide-' + String(p.name).replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 40) + '.png';
      var text = caption(p);
      var file = null;
      try { file = new File([blob], fname, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file], text: text }).catch(function () { /* the person closed the sheet */ });
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      toast(t('sg_title'), t('sg_downloaded'), 'ok', 6000);
    }).catch(function () { unbusy(); toast(t('sg_title'), t('sg_img_failed'), 'err'); });
  }

  /* ----------------------------------------- Settings → Size charts */
  function chartEditor(c) {
    var type = c ? c.type : (OG.sgType || 'tshirts');
    ED['chart'] = fromGuide(c ? { measures: c.measures, rows: c.rows, fit: c.fit, noteEn: c.noteEn, noteAr: c.noteAr } : null,
                            SizeOrder.sizes((DB.sizeSets[type] || []).concat(c ? c.rows.map(function (r) { return r.size; }) : []), DB.sizeSets[type] || []));
    var types = DB.activeTypes(type ? [type] : []);
    openModal({
      title: c ? t('sg_chart_edit') : t('sg_chart_new'),
      size: 'wide',
      body: '<div class="pe-grid">' +
          '<label class="field"><span>' + t('sg_chart_name') + ' · English</span><input class="inp" id="sgcEn" dir="ltr" maxlength="60" value="' + esc(c ? c.nameEn : '') + '" placeholder="Nike tee"></label>' +
          '<label class="field"><span>' + t('sg_chart_name') + ' · عربي</span><input class="inp" id="sgcAr" dir="rtl" lang="ar" maxlength="60" value="' + esc(c ? c.nameAr : '') + '" placeholder="تيشيرت نايكي"></label>' +
          '<label class="field"><span>' + t('sg_chart_type') + '</span><select class="inp" id="sgcType" data-sg-ch="ctype">' +
            types.map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + esc(DB.typeLabels[k] || k) + '</option>'; }).join('') +
          '</select></label></div>' +
        editorHtml('chart', { charts: false }).replace('<div class="sg-ed"', '<div class="sg-ed" data-sg-opts=\'{"charts":false}\''),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-sg="csave" data-id="' + (c ? c.id : '') + '">' + t('save') + '</button>'
    });
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || el.id !== 'sgcType') return;
    var e = ED['chart'];
    if (!e) return;
    OG.sgType = el.value;
    e.sizes = SizeOrder.sizes(DB.sizeSets[el.value] || [], DB.sizeSets[el.value] || []);
    repaint('chart');
  });
  ACT.csave = function (el) {
    var id = el.getAttribute('data-id');
    var res = payload('chart', true);
    if (res.error) { sayWhy('chart', res); return; }
    var body = { nameEn: (document.getElementById('sgcEn') || {}).value, nameAr: (document.getElementById('sgcAr') || {}).value,
                 type: (document.getElementById('sgcType') || {}).value };
    if (!String(body.nameEn || '').trim() && !String(body.nameAr || '').trim()) { sayWhy('chart', { error: t('sg_chart_name_needed') }); return; }
    Object.assign(body, { measures: res.guide.measures, rows: res.guide.rows, fit: res.guide.fit, noteEn: res.guide.noteEn, noteAr: res.guide.noteAr });
    var unbusy = busyButton(el);
    (id ? API.patch('/api/size-charts/' + id, body) : API.post('/api/size-charts', body)).then(function (r) {
      unbusy();
      closeModal();
      toast(t('sg_charts'), r.chart && r.chart.refreshed ? t('sg_chart_saved_n').replace('{n}', r.chart.refreshed) : t('sg_chart_saved'), 'ok', 4000);
      loadCharts(function () { repaintSettings(); });
      if (r.chart && r.chart.refreshed && typeof Shop !== 'undefined') Shop.reload && Shop.reload();
    }).catch(function (err) { unbusy(); serverWhy('chart', err); });
  };
  ACT.cnew = function () { chartEditor(null); };
  ACT.cedit = function (el) { var c = chart(+el.getAttribute('data-id')); if (c) chartEditor(c); };
  ACT.cdup = function (el) {
    var unbusy = busyButton(el);
    API.post('/api/size-charts/' + el.getAttribute('data-id') + '/duplicate', {}).then(function () {
      unbusy(); toast(t('sg_charts'), t('sg_chart_copied'), 'ok'); loadCharts(repaintSettings);
    }).catch(function (err) { unbusy(); toast(t('sg_charts'), API.friendly(err), 'err'); });
  };
  ACT.chide = function (el) {
    var c = chart(+el.getAttribute('data-id'));
    if (!c) return;
    var unbusy = busyButton(el);
    API.patch('/api/size-charts/' + c.id, { active: !c.active }).then(function () {
      unbusy(); loadCharts(repaintSettings);
    }).catch(function (err) { unbusy(); toast(t('sg_charts'), API.friendly(err), 'err'); });
  };
  ACT.clothes = function (el) {
    var k = el.getAttribute('data-t');
    var list = (CONFIG.SG_CLOTHES || []).slice();
    var i = list.indexOf(k);
    if (i >= 0) list.splice(i, 1); else list.push(k);
    CONFIG.SG_CLOTHES = list;
    if (typeof saveSetting === 'function') saveSetting('sizeguide.clothes_types', JSON.stringify(list));
    repaintSettings();
  };

  function settingsCard() {
    if (!allow('product.write')) return '';
    if (!CH) loadCharts(repaintSettings);
    var list = CH || [];
    var meta = CH ? '<span dir="ltr">' + list.filter(function (c) { return c.active; }).length + '</span> ' + t('sg_n_charts') : t('loading');
    var h = setFoldStart('sizecharts', t('sg_charts'), meta, t('sg_charts_sub'));
    h += '<div class="sg-set">';
    /* Nothing pressable until the list is in: the card redraws itself when
       it lands, and a press on a button being replaced is a press lost. */
    if (!CH) return h + '<p class="muted">' + t('loading') + '</p></div>' + setFoldEnd();
    if (!list.length) h += '<div class="cart-empty"><b>' + t('sg_no_charts') + '</b><span>' + t('sg_no_charts_sub') + '</span></div>';
    list.forEach(function (c) {
      h += '<div class="sg-ch' + (c.active ? '' : ' off') + '"><div><b>' + esc(OG.lang === 'ar' ? c.nameAr : c.nameEn) + '</b>' +
        '<small class="muted">' + esc(DB.typeLabels[c.type] || c.type || '') + ' · ' + c.measures.map(mName).join(', ') +
        (c.products ? ' · <span dir="ltr">' + c.products + '</span> ' + t('sg_n_following') : '') + (c.active ? '' : ' · ' + t('sg_hidden')) + '</small></div>' +
        '<div class="sg-ch-a"><button class="btn btn-sm" data-sg="cedit" data-id="' + c.id + '">' + t('edit') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-sg="cdup" data-id="' + c.id + '">' + t('sg_duplicate') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-sg="chide" data-id="' + c.id + '">' + t(c.active ? 'sg_hide' : 'sg_show') + '</button></div></div>';
    });
    h += '<button class="btn btn-primary mt" data-sg="cnew">+ ' + t('sg_chart_new') + '</button>';
    h += '<div class="mt"><span class="lbl">' + t('sg_clothes_types') + '</span><p class="muted small">' + t('sg_clothes_sub') + '</p><div class="chip-row">' +
      DB.activeTypes([]).map(function (k) {
        var on = (CONFIG.SG_CLOTHES || []).indexOf(k) >= 0;
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-sg="clothes" data-t="' + k + '">' +
          (on ? '✓ ' : '') + esc(DB.typeLabels[k] || k) + '</button>';
      }).join('') + '</div></div>';
    h += '</div>';
    return h + setFoldEnd();
  }
  function repaintSettings() {
    if (typeof OG !== 'undefined' && OG.view === 'settings' && typeof setFoldRepaint === 'function') setFoldRepaint('sizecharts', settingsCard());
  }

  return {
    MEASURES: ORDER, parse: parse, isClothes: isClothes,
    formHtml: formHtml, sizesMoved: sizesMoved, newPayload: newPayload, formReset: formReset,
    editSection: editSection, editPayload: editPayload, saveFor: saveFor,
    card: card, tableHtml: tableHtml, tillButton: tillButton, openSheet: openSheet, closeSheet: closeSheet,
    settingsCard: settingsCard, serverWhy: serverWhy, draw: draw, caption: caption,
    isOpen: function () { return !!document.getElementById('sgRoot'); },
    state: function (k) { return ED[k]; }
  };
})();
