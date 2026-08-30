/* ==========================================================================
   OG SYSTEM — the warehouse map                                [shelfmap.js]
   --------------------------------------------------------------------------
   The room, drawn. One section at a time, tilted 18° so a rack reads as a
   rack, with a slider down to flat for when somebody actually wants to read
   it like a table.

   TWO SURFACES, ONE RULE. The 3D rack is for LOOKING — which shelf, how
   full, where the gap is. The flat panel underneath is for WORKING — what is
   on the shelf, what belongs on it, and every edit. Nothing readable ever
   goes in the tilted plane; a table at 18° is a table nobody can read.

   CSS transforms only. This runs on the shop's real hardware in Aleppo, and
   a 3D library to draw forty rectangles would be the biggest file in the
   repo for the least reason.

   COLOUR DISCIPLINE. The map is greys and pure white. Green, amber and red
   exist ONLY as scan feedback — accepted, look-here, refused — and appear
   nowhere as decoration, so that when a tile flashes red it means one thing.

   `grid_origin` IS ABOUT THE ROOM, NOT THE LANGUAGE. Column 1 draws on
   whichever side that room's door puts it, and stays there when the app
   switches to Arabic — a room does not turn around because a menu changed
   language. The grid element is pinned dir="ltr" and every tile is placed by
   explicit grid coordinates, because letting an RTL document mirror the grid
   automatically is exactly the bug this paragraph exists to prevent.

   Reading is `stock.read` (the warehouse screen's own gate). Scanning stock
   onto shelves is `stock.move`. The layout editor is drawn only for
   `config.write` — the manager. The server holds the real boundary; these
   gates decide what is worth drawing.
   ========================================================================== */

var ShelfMap = (function () {

  var S = {
    data: null,        /* sections, straight from GET /api/sections */
    secId: null,       /* which room is on screen */
    tilt: 18,          /* degrees; 0 = flat */
    edit: false,       /* layout editor on (manager only) */
    sel: null,         /* selected shelf id — also the put-away target */
    loading: false,
    err: null,

    /* The put-away run. `chips` is newest-first and is the undo strip: there
       are no confirm dialogs anywhere in this flow, because a dialog needs a
       mouse and a scanner has none — the person is holding a shoe. */
    chips: [],
    seq: 0,
    sound: true
  };

  var CHIPS_SHOWN = 8;
  var SOUND_KEY = 'og_sm_sound';

  try {
    S.sound = localStorage.getItem(SOUND_KEY) !== '0';
  } catch (e) { /* private window, cleared storage — sound simply stays on */ }

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* The same payload shape js/labels60.js scans and prints:
     SH + two-digit warehouse + room letter + shelf code. */
  var SHELF_SCAN_RE = /^SH(\d{2})([A-Z])([A-Z]\d{1,3})$/;

  /* ---------------------------------------------------------------- data */

  function load(keepSel) {
    S.loading = true; S.err = null;
    return Shop.sections().then(function (res) {
      S.data = res.sections || [];
      S.loading = false;
      if (!keepSel) S.sel = null;
      /* Keep the chosen room if it still exists; otherwise the first. */
      if (!current()) S.secId = S.data.length ? S.data[0].id : null;
      repaint();
    }).catch(function (err) {
      S.loading = false; S.err = API.friendly(err);
      repaint();
    });
  }

  function reload() { return load(true); }

  function current() {
    if (!S.data) return null;
    for (var i = 0; i < S.data.length; i++) {
      if (S.data[i].id === S.secId) return S.data[i];
    }
    return null;
  }

  function shelfById(id) {
    if (!S.data) return null;
    for (var i = 0; i < S.data.length; i++) {
      var list = S.data[i].shelves;
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === id) return { sec: S.data[i], sh: list[j] };
      }
    }
    return null;
  }

  function canEdit() { return allow('config.write'); }
  function canMove() { return allow('stock.move'); }

  /* -------------------------------------------------------------- sound
     Warehouse staff look at the shoe, not at the screen, so the answer has to
     arrive in the ear. Three tones, one oscillator each, no audio file and no
     library: a short high beep for accepted, a low buzz for refused, and a
     rising two-note chirp — deliberately unlike either — for the target
     changing, which is the one event that silently changes what the NEXT scan
     will do.

     SOUND IS NEVER THE ONLY SIGNAL. Every tone has a chip in the same colour
     landing in the strip at the bottom, because the shop is noisy, the tablet
     may be muted, and a person can be deaf. */
  var actx = null;

  function tone(freq, ms, type, delay, peak) {
    var t0 = actx.currentTime + (delay || 0);
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    /* Ramped, not switched: a square wave started and stopped at full gain
       clicks through a cheap tablet speaker louder than the tone itself. */
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak || 0.14, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain); gain.connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  function beep(kind) {
    if (!S.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!actx) actx = new Ctx();
      /* Browsers start the context suspended until a gesture. A scan through
         the keyboard wedge counts as one, but the resume is asynchronous, so
         this is attempted every time rather than once at startup. */
      if (actx.state === 'suspended' && actx.resume) actx.resume();

      if (kind === 'ok')        tone(880, 70, 'sine', 0, 0.15);
      else if (kind === 'bad')  tone(150, 260, 'square', 0, 0.11);
      else if (kind === 'shelf') { tone(620, 60, 'sine', 0, 0.13); tone(930, 70, 'sine', 0.07, 0.13); }
    } catch (e) { /* no audio on this machine; the chips still say everything */ }
  }

  /* Whether the map owns scans right now. The wedge dispatcher in
     js/app-boot.js checks this and stands aside, the same arrangement the
     label batch modal has — and a modal on top takes the scanner back,
     because a scan mid-dialog must not silently file stock. */
  function owns() {
    return OG.view === 'shelfmap' && !!S.data && !modalOpen();
  }

  /* ---------------------------------------------------------------- view */

  function view() {
    return '<div id="smRoot" class="sm-root">' + body() + '</div>';
  }

  function body() {
    if (S.err) {
      return '<div class="card"><div class="card-body"><div class="partner-note note-danger">' +
             esc(S.err) + '</div></div></div>';
    }
    if (!S.data) return '<div class="sm-empty muted">…</div>';
    if (!S.data.length) {
      return '<div class="card"><div class="card-body">' +
        '<b>' + t('sm_no_rooms') + '</b>' +
        (canEdit()
          ? '<div style="margin-top:10px"><button class="btn btn-primary" data-sm="room-new">' +
            t('sm_new_room') + '</button></div>'
          : '') +
        '</div></div>';
    }

    var sec = current();
    var h = scanStrip() + topBar(sec);
    if (!sec) return h + chipStrip();

    if (!sec.shelves.length) {
      h += emptyRoom(sec);
    } else {
      h += stage(sec);
      if (S.edit) {
        h += '<div class="sm-note muted">' + t('sm_no_renumber') + '</div>';
      }
    }
    h += panel(sec);
    h += chipStrip();
    return h;
  }

  /* ------------------------------------------------------------ the scan box
     One box, and it takes the focus back after every repaint. It is not what
     captures a scan — js/wedge.js does that at the document, whatever has
     focus — it is what makes the mode visible, and what lets somebody TYPE a
     code off a label whose barcode has been scuffed off a box. */
  function scanStrip() {
    var hit = S.sel == null ? null : shelfById(S.sel);
    var arm = hit && canMove();

    return '<div class="sm-scan no-print">' +
      '<div class="sm-scanbox' + (arm ? ' armed' : '') + '">' +
        '<input class="inp sm-scanin" id="smScan" type="text" autocomplete="off"' +
          ' spellcheck="false" dir="ltr"' +
          ' placeholder="' + esc(t('sm_scan_ph')) + '" data-smv="scan-enter">' +
      '</div>' +
      '<div class="sm-scanwhat">' +
        (arm
          ? '<b>' + esc(t('sm_target').replace('{code}', hit.sec.key + '-' + hit.sh.code)) + '</b>' +
            '<small class="muted">' + esc(t('sm_scan_hint')) + '</small>'
          : '<b class="muted">' + esc(t('sm_no_target')) + '</b>' +
            '<small class="muted">' + esc(t('sm_no_target_hint')) + '</small>') +
      '</div>' +
      '<button class="btn btn-ghost sm-sound' + (S.sound ? ' on' : '') + '" data-sm="sound"' +
        ' aria-pressed="' + (S.sound ? 'true' : 'false') + '"' +
        ' title="' + esc(t(S.sound ? 'sm_sound_on' : 'sm_sound_off')) + '">' +
        (S.sound ? soundIcon(true) : soundIcon(false)) +
        '<span>' + esc(t(S.sound ? 'sm_sound_on' : 'sm_sound_off')) + '</span>' +
      '</button>' +
    '</div>';
  }

  function soundIcon(on) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6 9H3v6h3l5 4z"/>' +
      (on ? '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
          : '<path d="M17 9l4 6M21 9l-4 6"/>') +
      '</svg>';
  }

  /* --------------------------------------------------------- the undo strip
     The last eight scans, newest first, each one removable by tapping it.
     This is what replaces the confirm dialog: instead of asking before every
     scan — which would halve the speed and need a mouse — it lets the run go
     at scanner pace and makes the last few reversible.

     The colour is the sound, written down: the same three states, so a muted
     tablet or a noisy room loses nothing. */
  function chipStrip() {
    if (!S.chips.length) return '';
    var shown = S.chips.slice(0, CHIPS_SHOWN);
    var h = '<div class="sm-chipstrip no-print"><span class="sm-chiplabel muted">' +
            esc(t('sm_last_scans')) + '</span>';
    shown.forEach(function (c) {
      h += '<button class="sm-undo ' + c.kind + '" data-sm="undo" data-id="' + c.id + '"' +
        ' title="' + esc(t('sm_undo_hint')) + '">' +
        '<b>' + esc(c.label) + '</b>' +
        (c.sub ? '<small>' + esc(c.sub) + '</small>' : '') +
        '<span class="sm-undo-x" aria-hidden="true">&times;</span>' +
        '</button>';
    });
    if (S.chips.length > CHIPS_SHOWN) {
      h += '<span class="sm-chipmore muted">+' + nf(S.chips.length - CHIPS_SHOWN) + '</span>';
    }
    h += '<button class="btn btn-ghost sm-chipclear" data-sm="chips-clear">' +
         esc(t('sm_clear_strip')) + '</button>';
    return h + '</div>';
  }

  function addChip(c) {
    c.id = ++S.seq;
    S.chips.unshift(c);
    /* The strip shows eight; the list keeps more so a tally survives a long
       run, but not without bound. */
    if (S.chips.length > 80) S.chips.length = 80;
  }

  function topBar(sec) {
    /* Name the warehouse only when more than one actually has rooms —
       "M · المستودع" is noise while there is one building. */
    var whs = {};
    S.data.forEach(function (s) { whs[s.wh_id] = 1; });
    var manyWh = Object.keys(whs).length > 1;

    var h = '<div class="sm-top no-print">';
    h += '<label class="field sm-roomsel"><span>' + t('sm_room') + '</span>' +
         '<select class="inp" data-smv="room">';
    S.data.forEach(function (s) {
      var label = s.key + ' · ' + s.name +
                  (manyWh ? ' — ' + DB.whName(s.wh_id, OG.lang === 'ar') : '');
      h += '<option value="' + s.id + '"' + (s.id === S.secId ? ' selected' : '') + '>' +
           esc(label) + '</option>';
    });
    h += '</select></label>';

    /* The tilt. Hidden entirely under prefers-reduced-motion (see the CSS):
       a slider that does nothing is broken furniture. */
    h += '<label class="field sm-tiltbox"><span>' + t('sm_tilt') + '</span>' +
         '<input class="sm-tilt" type="range" min="0" max="25" step="1" value="' + S.tilt +
         '" data-smv="tilt"></label>';

    if (canEdit()) {
      h += '<div class="sm-topbtns">' +
        '<button class="btn ' + (S.edit ? 'btn-primary' : '') + '" data-sm="edit">' +
          (S.edit ? t('sm_done') : t('sm_edit')) + '</button>';
      if (S.edit) {
        h += '<button class="btn btn-ghost" data-sm="room-cfg">' + t('sm_room_cfg') + '</button>' +
             '<button class="btn btn-ghost" data-sm="room-new">' + t('sm_new_room') + '</button>';
      }
      h += '</div>';
    }
    h += '</div>';

    /* No put-away line here: the scan box above the room selector already
       says what the next scan will do, and saying it twice on one screen
       makes a person read neither. */
    return h;
  }

  function emptyRoom(sec) {
    var h = '<div class="card"><div class="card-body">' +
            '<b>' + t('sm_room_empty') + '</b>';
    if (canEdit()) {
      h += '<div class="sm-seed">' +
        '<label class="field"><span>' + t('sm_rows') + '</span>' +
          '<input class="inp num" id="smSeedR" type="number" min="1" max="26" value="3"></label>' +
        '<label class="field"><span>' + t('sm_cols') + '</span>' +
          '<input class="inp num" id="smSeedC" type="number" min="1" max="99" value="6"></label>' +
        '<label class="field"><span>' + t('sm_capacity') + '</span>' +
          '<input class="inp num" id="smSeedCap" type="number" min="1" placeholder="' + t('sm_cap_hint') + '"></label>' +
        '<button class="btn btn-primary" data-sm="seed" data-id="' + sec.id + '">' +
          t('sm_grid_setup') + '</button>' +
      '</div>';
    }
    h += '</div></div>';
    return h;
  }

  /* ----------------------------------------------------------- the rack */

  function geometry(sec) {
    var maxCol = 0, maxRow = 0;
    sec.shelves.forEach(function (sh) {
      if (sh.col_index > maxCol) maxCol = sh.col_index;
      var ri = ALPHA.indexOf(sh.row_label);
      if (ri > maxRow) maxRow = ri;
    });
    var byPos = {};
    sec.shelves.forEach(function (sh) { byPos[sh.row_label + ':' + sh.col_index] = sh; });
    return { maxCol: maxCol, rows: maxRow + 1, byPos: byPos };
  }

  /* Which grid column a physical column number lands in. +2 because grid
     column 1 is the row-letter gutter. THE ROOM DECIDES, NEVER THE LANGUAGE:
     with origin 'right', column 1 draws on the right, in English and in
     Arabic alike. */
  function visCol(sec, c, maxCol) {
    return (sec.grid_origin === 'right' ? (maxCol - c + 1) : c) + 1;
  }

  function stage(sec) {
    var g = geometry(sec);
    var addable = S.edit && canEdit();

    /* dir="ltr" pinned on the grid: an RTL document mirrors grid tracks on
       its own, which would flip every room the moment the app speaks Arabic.
       Placement is explicit coordinates, so what you see is what was said. */
    var h = '<div class="sm-stage no-print"><div class="sm-rack" style="--sm-tilt:' + S.tilt + 'deg">' +
            '<div class="sm-grid" dir="ltr" style="grid-template-columns:34px repeat(' +
            g.maxCol + ', minmax(58px, 1fr))">';

    /* Column numbers across the top, at their VISUAL positions. */
    for (var c = 1; c <= g.maxCol; c++) {
      h += '<div class="sm-colhead" style="grid-row:1;grid-column:' + visCol(sec, c, g.maxCol) + '">' +
           c +
           (addable ? '<button class="sm-rc-x" data-sm="col-rm" data-col="' + c + '" title="' +
                      esc(t('sm_remove_col').replace('{x}', String(c))) + '">&times;</button>' : '') +
           '</div>';
    }

    for (var r = 0; r < g.rows; r++) {
      var letter = ALPHA.charAt(r);
      var gr = r + 2;

      h += '<div class="sm-rowhead" style="grid-row:' + gr + ';grid-column:1">' + letter +
           (addable ? '<button class="sm-rc-x" data-sm="row-rm" data-row="' + letter + '" title="' +
                      esc(t('sm_remove_row').replace('{x}', letter)) + '">&times;</button>' : '') +
           '</div>';

      for (var c2 = 1; c2 <= g.maxCol; c2++) {
        var sh = g.byPos[letter + ':' + c2];
        var pos = 'grid-row:' + gr + ';grid-column:' + visCol(sec, c2, g.maxCol);
        if (sh) {
          h += tile(sec, sh, pos);
        } else if (addable) {
          /* A door, a pillar — or the place a rack goes next. */
          h += '<button class="sm-cell-add" style="' + pos + '" data-sm="add-here" ' +
               'data-row="' + letter + '" data-col="' + c2 + '">+<span>' +
               esc(letter + c2) + '</span></button>';
        } else {
          h += '<div class="sm-cell-gap" style="' + pos + '"></div>';
        }
      }
    }

    h += '</div></div></div>';

    /* Whole-row and whole-column growth lives in a labelled toolbar under
       the rack rather than as bare + cells in the grid. A new column's
       position depends on the room's walking direction, and a labelled
       button never needs the reader to work out which side it will land on
       — the room grows at its far end either way. */
    if (addable) {
      h += '<div class="sm-growbar no-print">' +
        '<button class="btn btn-ghost" data-sm="row-add">+ ' + t('sm_add_row') + '</button>' +
        '<button class="btn btn-ghost" data-sm="col-add">+ ' + t('sm_add_col') + '</button>' +
        '</div>';
    }
    return h;
  }

  function tile(sec, sh, pos) {
    var cls = 'sm-tile' + (sh.id === S.sel ? ' on' : '');
    var inner = '<span class="sm-code">' + esc(sh.code) + '</span>';

    /* Fill against capacity when a capacity is known; a plain count when it
       is not. Never a bar against a guessed number — an invented capacity is
       a fill level that lies. */
    if (sh.capacity != null && sh.capacity > 0) {
      var pct = Math.max(0, Math.min(100, Math.round(sh.qty / sh.capacity * 100)));
      inner += '<span class="sm-fill" style="height:' + pct + '%"></span>' +
               '<span class="sm-load">' + nf(sh.qty) + '/' + nf(sh.capacity) + '</span>';
    } else if (sh.qty > 0) {
      inner += '<span class="sm-load">' + nf(sh.qty) + '</span>';
    }

    /* In the editor, a shelf with stock says so before anyone tries to
       delete it — the lock is the same fact the server will enforce. */
    if (S.edit && sh.qty > 0) {
      inner += '<svg class="sm-lock" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
               '<path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2H5v13h14V9h-2zM9 7a3 3 0 0 1 6 0v2H9V7z"/></svg>';
    }

    return '<button class="' + cls + '" id="smT' + sh.id + '" style="' + pos +
           '" data-sm="tile" data-id="' + sh.id + '"' +
           (sh.product_name ? ' title="' + esc(sh.product_name + (sh.range ? ' · ' + sh.range : '')) + '"' : '') +
           '>' + inner + '</button>';
  }

  /* ----------------------------------------------------------- the panel */

  function panel(sec) {
    if (S.sel == null) return '';
    var hit = shelfById(S.sel);
    if (!hit) return '';
    var sh = hit.sh;

    var h = '<div class="card sm-panel"><div class="card-head"><h3>' +
      esc(hit.sec.key + '-' + sh.code) +
      ' <small class="muted">' + esc(hit.sec.name) + '</small></h3>' +
      '<div class="head-actions">' +
        (allow('label.print')
          ? '<button class="btn btn-ghost" data-sm="print-shelf" data-id="' + sh.id + '">' +
            t('sm_print_label') + '</button>'
          : '') +
      '</div></div><div class="card-body">';

    /* What the shelf is FOR — assignment, which is what the label says. */
    h += '<div class="sm-assign-line">' +
      (sh.product_id
        ? '<b>' + esc(sh.product_name || '') + '</b>' +
          '<span class="muted"> · ' + (sh.range ? esc(sh.range) : t('sm_whole_model')) + '</span>'
        : '<span class="muted">' + t('sm_unassigned') + '</span>') +
      (sh.capacity != null
        ? '<span class="muted"> · ' + t('sm_capacity_n').replace('{n}', nf(sh.capacity)) + '</span>'
        : '') +
      '</div>';

    h += contentsRows(sh);

    if (S.edit && canEdit()) h += editForm(hit.sec, sh);

    h += '</div></div>';
    return h;
  }

  /* One row per product with a presence on this shelf — physically on it,
     or assigned to it and run out. The chips are the whole message: a
     filled chip is a size in stock ON THIS SHELF, a dim one is a hole in
     the run. No numbers to read; the holes are the information. */
  function contentsRows(sh) {
    var byProduct = {};
    (sh.contents || []).forEach(function (row) {
      (byProduct[row.product_id] = byProduct[row.product_id] || {})[row.sku] = row.qty;
    });
    /* The assigned model always gets a row, even sold out — "this belongs
       here and it has run out" is exactly what an empty shelf with a purpose
       looks like, and it is the difference between assignment and contents. */
    if (sh.product_id && !byProduct[sh.product_id]) byProduct[sh.product_id] = {};

    var pids = Object.keys(byProduct);
    if (!pids.length) {
      return '<div class="sm-emptyrow muted">' + t('sm_shelf_empty') + '</div>';
    }

    var h = '<div class="sm-rows">';
    pids.forEach(function (pidStr) {
      var pid = +pidStr;
      var p = DB.product(pid);
      if (!p || p.archived) return;   /* archived is not stock, here either */
      var have = byProduct[pid];

      var chips = '';
      sizesOf(p).forEach(function (v) {
        var onHere = (have[v.sku] || 0) > 0;
        chips += '<span class="sm-chip' + (onHere ? ' in' : '') + '">' + esc(v.size) + '</span>';
      });

      h += '<div class="sm-row">' +
        '<span class="sm-stripe" style="background:' + esc(p.image.bg) + '"></span>' +
        '<div class="sm-row-name"><b>' + esc(p.name) + '</b>' +
          (p.colorway ? '<small class="muted">' + esc(p.colorway) + '</small>' : '') +
        '</div>' +
        '<div class="sm-chips" dir="ltr">' + chips + '</div>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }

  /* A product's sizes in the order a person reads a run — the house
     SIZE_SETS order when the type has one, numeric-aware otherwise, so 9
     never sorts after 42. */
  function sizesOf(p) {
    var vs = DB.variantsOf(p.id).slice();
    var order = DB.sizeSets[p.type];
    vs.sort(function (a, b) {
      if (order) {
        var ia = order.indexOf(a.size), ib = order.indexOf(b.size);
        if (ia > -1 && ib > -1) return ia - ib;
        if (ia > -1) return -1;
        if (ib > -1) return 1;
      }
      var na = parseFloat(a.size), nb = parseFloat(b.size);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return String(a.size).localeCompare(String(b.size));
    });
    return vs;
  }

  function editForm(sec, sh) {
    var products = DB.products.filter(function (p) { return !p.archived; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var h = '<div class="sm-edit">';
    h += '<div class="sm-editrow">' +
      '<label class="field"><span>' + t('sm_code') + '</span>' +
        '<input class="inp" id="smCode" type="text" value="' + esc(sh.code) + '" dir="ltr" maxlength="4"></label>' +
      '<label class="field"><span>' + t('sm_capacity') + '</span>' +
        '<input class="inp num" id="smCap" type="number" min="1" value="' + (sh.capacity == null ? '' : sh.capacity) + '" placeholder="' + t('sm_cap_hint') + '"></label>' +
      '</div>';

    h += '<div class="sm-editrow">' +
      '<label class="field grow"><span>' + t('product') + '</span>' +
        '<select class="inp" id="smProd" data-smv="prod-pick" data-id="' + sh.id + '">' +
        '<option value="">' + t('sm_unassigned_opt') + '</option>';
    products.forEach(function (p) {
      h += '<option value="' + p.id + '"' + (p.id === sh.product_id ? ' selected' : '') + '>' +
           esc(p.name) + '</option>';
    });
    h += '</select></label>' + rangeSelects(sh.product_id, sh.size_from, sh.size_to) + '</div>';

    h += '<div class="sm-editrow sm-editbtns">' +
      '<button class="btn btn-primary" data-sm="save" data-id="' + sh.id + '">' + t('save') + '</button>' +
      '<button class="btn btn-ghost danger" data-sm="del" data-id="' + sh.id + '"' +
        (sh.qty > 0 ? ' disabled title="' + esc(t('sm_locked').replace('{n}', nf(sh.qty))) + '"' : '') + '>' +
        t('sm_delete') + '</button>' +
      (sh.qty > 0 ? '<span class="muted sm-lockednote">' + t('sm_locked').replace('{n}', nf(sh.qty)) + '</span>' : '') +
      '</div>';

    h += '</div>';
    return h;
  }

  /* The from/to size pickers, rebuilt whenever the product changes. Options
     come from the product's real size run — a free-text range box would
     invite '41 ' and 'XL' onto the same shelf, which the server refuses
     anyway; better not to offer it. */
  function rangeSelects(pid, from, to) {
    var sizes = [];
    if (pid) {
      var p = DB.product(pid);
      if (p) sizes = sizesOf(p).map(function (v) { return v.size; });
    }
    /* Built with an explicit selected flag per option  marking the choice
       by string-replacing value="39" would also hit the front of
       value="39.5", and a size run is exactly where both exist. */
    function sel(id, val) {
      var o = '<select class="inp" id="' + id + '">' +
              '<option value="">' + t('sm_whole_model') + '</option>';
      sizes.forEach(function (s) {
        o += '<option value="' + esc(s) + '"' + (s === val ? ' selected' : '') + '>' +
             esc(s) + '</option>';
      });
      return o + '</select>';
    }
    return '<span id="smRange" class="sm-range">' +
      '<label class="field"><span>' + t('l60_from') + '</span>' + sel('smFrom', from) + '</label>' +
      '<label class="field"><span>' + t('l60_to') + '</span>' + sel('smTo', to) + '</label>' +
      '</span>';
  }

  /* -------------------------------------------------------------- repaint */

  function repaint() {
    var root = document.getElementById('smRoot');
    if (!root) return;

    /* WHO HAD THE CARET, read BEFORE the innerHTML that destroys them.
       Checking afterwards cannot work: replacing the markup detaches the
       focused node, the browser falls back to <body>, and a guard reading
       activeElement at that point sees "nobody" and takes the focus — pulling
       the caret out of the code field a manager is halfway through typing.
       This is the focusBack() idiom the filter inputs already use. */
    var a = document.activeElement;
    var hadId = a && a.id && root.contains(a) ? a.id : null;
    var caret = null;
    if (hadId) { try { caret = a.selectionStart; } catch (e) {} }

    root.innerHTML = body();

    if (hadId && hadId !== 'smScan') {
      var back = document.getElementById(hadId);
      if (back) {
        back.focus();
        if (caret != null) { try { back.setSelectionRange(caret, caret); } catch (e) {} }
        return;
      }
    }
    keepFocus();
  }

  /* The box takes the focus back after every repaint — and every scan is a
     repaint, so without this the caret is gone by the second box of the run. */
  function keepFocus() {
    var box = document.getElementById('smScan');
    if (!box || modalOpen()) return;
    var a = document.activeElement;
    if (a && a !== box && a !== document.body) {
      var tag = (a.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || a.isContentEditable) return;
    }
    try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
  }

  function after() {
    if (!S.data && !S.loading) load();
    else keepFocus();
  }

  /* ------------------------------------------------------------ scanning */

  var lastScan = null, lastScanAt = 0;

  function onScan(code) {
    if (!owns()) return;
    var c = String(code || '').trim();
    if (!c) return;

    /* A scanner left in presentation mode re-reads the label it is sitting
       over, several times a second. That is the ONLY repeat this collapses.

       A person scanning the same shoe six times because six boxes are going
       onto the shelf is doing something different and deliberate, and 700ms
       is far longer than the gap between two re-reads and far shorter than
       the gap between two boxes. */
    var now = Date.now();
    if (c === lastScan && now - lastScanAt < 700) { lastScanAt = now; return; }
    lastScan = c; lastScanAt = now;

    var m = SHELF_SCAN_RE.exec(c.toUpperCase());
    if (m) return shelfScan(+m[1], m[2], m[3]);

    var v = DB.variantByBarcode(c) || DB.variantBySku(c) ||
            (DB.variantByLabelCode && DB.variantByLabelCode(c));
    if (v) return productScan(v);

    beep('bad');
    addChip({ kind: 'bad', label: c.slice(0, 14), sub: t('sm_unknown_code') });
    repaint();
    toast(t('sm_unknown_code'), c.slice(0, 40), 'warn');
  }

  function shelfScan(whCode, key, code) {
    var found = null;
    (S.data || []).forEach(function (s) {
      if (s.wh_code === whCode && s.key === key) {
        s.shelves.forEach(function (sh) { if (sh.code === code) found = { sec: s, sh: sh }; });
      }
    });
    if (!found) {
      beep('bad');
      addChip({ kind: 'bad', label: key + '-' + code, sub: t('sm_shelf_gone') });
      repaint();
      toast(t('sm_shelf_gone'), 'SH' + (whCode < 10 ? '0' : '') + whCode + key + code, 'warn');
      return;
    }
    S.secId = found.sec.id;
    S.sel = found.sh.id;
    /* Its own tone. Nothing on the shelf changed, but what the NEXT scan will
       do just did — the one event that is otherwise silent. */
    beep('shelf');
    addChip({ kind: 'shelf', label: found.sec.key + '-' + found.sh.code, sub: t('sm_target_set') });
    repaint();
    flash(found.sh.id, 'sm-flash-ok');
  }

  function productScan(v) {
    /* A shelf is selected and this person can move stock: the scan IS the
       put-away. The server is the judge — its refusal already names where
       the pair belongs, and the map's job is to point at it. */
    if (S.sel != null && canMove()) {
      var hit = shelfById(S.sel);
      if (!hit) return;
      var shelfId = S.sel;
      var p = DB.product(v.productId);

      /* Where this size is RIGHT NOW, read before the write, so undoing this
         scan can put it back rather than merely clearing it. `contents` only
         carries rows with stock on them, so a size that had sold out of its
         old shelf reads as nowhere — and undo then clears, which is the safe
         direction: it declines to invent a location. */
      var prev = shelfHolding(v.sku, hit.sec.wh_id);

      /* Only the FIRST scan of this size onto this shelf in this run actually
         moved anything. Six boxes of the same 42 is six scans and six chips —
         the tally the person is counting on — but the row already points here
         after the first, so the rest are the server confirming, not changing.
         The chip that owns the change is the one whose undo has to reverse it. */
      var owner = !S.chips.some(function (c) {
        return c.kind === 'ok' && c.sku === v.sku && c.shelfId === shelfId;
      });

      API.post('/api/stock/assign-shelf', {
        sku: v.sku, whId: hit.sec.wh_id, shelfId: shelfId
      }).then(function () {
        beep('ok');
        addChip({
          kind: 'ok', label: (p ? p.name : v.sku), sub: v.size + ' → ' + hit.sec.key + '-' + hit.sh.code,
          sku: v.sku, size: v.size, whId: hit.sec.wh_id,
          shelfId: shelfId, prevShelfId: prev, owner: owner
        });
        reload().then(function () { flash(shelfId, 'sm-flash-ok'); });
      }).catch(function (err) {
        beep('bad');
        var d = err && err.detail;
        var where = d && d.belongsOn && d.belongsOn.matching && d.belongsOn.matching.length
          ? d.belongsOn.matching.map(function (s) { return s.full_code; }).join(' / ')
          : '';
        addChip({
          kind: 'bad', label: (p ? p.name : v.sku),
          sub: v.size + (where ? ' → ' + where : ' · ' + t('sm_refused'))
        });
        repaint();
        flash(shelfId, 'sm-flash-bad');
        if (d && d.belongsOn && d.belongsOn.matching) {
          d.belongsOn.matching.forEach(function (s) { flash(s.id, 'sm-flash-warn'); });
        }
        toast(API.friendly(err), v.sku, 'warn', 5000);
      });
      return;
    }

    /* No target: light up where this model lives. Membership only — whether
       THIS size fits a range is the server's call, given on a real assign. */
    var homes = [];
    (S.data || []).forEach(function (s) {
      s.shelves.forEach(function (sh) {
        if (sh.product_id === v.productId) homes.push({ sec: s, sh: sh });
      });
    });
    var pl = DB.product(v.productId);
    if (!homes.length) {
      beep('bad');
      addChip({ kind: 'bad', label: (pl ? pl.name : v.sku), sub: v.size + ' · ' + t('sm_no_home') });
      repaint();
      toast(t('sm_no_home'), v.sku, 'warn');
      return;
    }
    var here = homes.filter(function (x) { return x.sec.id === S.secId; });
    if (!here.length) { S.secId = homes[0].sec.id; here = [homes[0]]; }
    var codes = homes.map(function (x) { return x.sec.key + '-' + x.sh.code; }).join(' · ');
    /* Located, not moved: the amber tone would claim a put-away happened. */
    beep('shelf');
    addChip({ kind: 'shelf', label: (pl ? pl.name : v.sku), sub: v.size + ' · ' + codes });
    repaint();
    here.forEach(function (x) { flash(x.sh.id, 'sm-flash-warn'); });
    toast(codes, v.sku, '');
  }

  /* Which shelf currently holds this size in this warehouse, from the last
     read of the map. */
  function shelfHolding(sku, whId) {
    var found = null;
    (S.data || []).forEach(function (s) {
      if (s.wh_id !== whId) return;
      s.shelves.forEach(function (sh) {
        (sh.contents || []).forEach(function (c) { if (c.sku === sku) found = sh.id; });
      });
    });
    return found;
  }

  /* ------------------------------------------------------------------ undo
     Tapping a chip takes that scan back. A refusal changed nothing, so its
     chip only leaves the strip. An accepted scan is reversed only when it was
     the one that MOVED the row and no other scan of the same size onto the
     same shelf is still standing — take one box off a stack of six and the
     other five are still on the shelf, which is what the remaining chips say.
     When it was the owner and others remain, the ownership passes to the
     oldest of them instead. */
  function undoChip(id) {
    var i = -1;
    for (var k = 0; k < S.chips.length; k++) if (S.chips[k].id === id) { i = k; break; }
    if (i < 0) return;
    var c = S.chips[i];
    S.chips.splice(i, 1);

    if (c.kind !== 'ok' || !c.owner) { repaint(); return; }

    var siblings = S.chips.filter(function (x) {
      return x.kind === 'ok' && x.sku === c.sku && x.shelfId === c.shelfId;
    });
    if (siblings.length) {
      siblings[siblings.length - 1].owner = true;   /* oldest remaining */
      repaint();
      return;
    }

    API.post('/api/stock/assign-shelf', {
      sku: c.sku, whId: c.whId, shelfId: c.prevShelfId == null ? null : c.prevShelfId
    }).then(function () {
      beep('shelf');
      reload();
    }).catch(function (err) {
      beep('bad');
      /* The scan is off the strip either way — putting it back would say the
         shoe is on a shelf the server has just refused to agree about. */
      toast(API.friendly(err), c.sku, 'warn', 5000);
      reload();
    });
    repaint();
  }

  function flash(shelfId, cls) {
    var el = document.getElementById('smT' + shelfId);
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 1400);
  }

  /* ---------------------------------------------------- the shared write
     One flow for every shelf change, from the panel AND from the Settings
     list — both hit PATCH /api/shelves/:id. The server answers
     `confirm_required` with the real numbers (pairs on the shelf, whose
     they are, how many printed labels go stale), and this turns that into
     the modal with the reprint button. Force is only ever sent after the
     numbers have been on screen. */
  function assignFlow(shelfId, patch, done) {
    API.patch('/api/shelves/' + shelfId, patch).then(function (res) {
      if (res.reprint && res.labels && res.labels.stale > 0 && res.shelf && res.shelf.product_id) {
        toast(t('sm_stale').replace('{n}', nf(res.labels.stale)), '', 'warn', 6000,
              { attrs: 'data-act="l60-product-labels" data-id="' + res.shelf.product_id + '"',
                label: t('sm_reprint') });
      }
      reload();
      if (done) done(res);
    }).catch(function (err) {
      if (err && err.code === 'confirm_required' && err.detail) {
        confirmModal(err.detail, function () {
          var forced = {};
          Object.keys(patch).forEach(function (k) { forced[k] = patch[k]; });
          forced.force = true;
          assignFlow(shelfId, forced, done);
        });
        return;
      }
      toast(API.friendly(err), '', 'warn', 5000);
    });
  }

  function confirmModal(d, apply) {
    var b = '';
    if (d.onShelf && d.onShelf.pieces > 0) {
      var names = (d.onShelf.products || []).map(function (p) { return p.name; }).join(', ');
      b += '<p><b>' + t('sm_confirm_stock')
             .replace('{n}', nf(d.onShelf.pieces)).replace('{p}', esc(names)) + '</b></p>';
    }
    if (d.reasons && d.reasons.indexOf('code') > -1) {
      b += '<p>' + t('sm_confirm_code') + '</p>';
    }
    var stale = d.labels ? d.labels.stale : 0;
    b += '<p class="' + (stale > 0 ? '' : 'muted') + '">' +
         t('sm_stale').replace('{n}', nf(stale)) + '</p>';

    var staleProduct = d.onShelf && d.onShelf.products && d.onShelf.products[0];
    openModal({
      title: t('sm_confirm_title'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (stale > 0 && staleProduct
          ? '<button class="btn" data-sm="confirm-reprint" data-id="' + staleProduct.id + '">' +
            t('sm_reprint') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-sm="confirm-apply">' + t('sm_apply') + '</button>'
    });
    pendingApply = apply;
  }

  var pendingApply = null;

  /* --------------------------------------------------------------- wiring */

  /* This module's own dispatch tables, the shape js/stock.js (data-st),
     js/money.js (data-mn) and js/pos.js (data-pos) already use: `data-sm` for
     a click, `data-smv` for a change. Two listeners on the document, for the
     whole screen — a forty-tile rack that bound a handler per tile would
     rebuild forty listeners on every repaint, and every scan is a repaint. */
  var ACT = {}, CHG = {};

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-sm]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-sm')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });

    document.addEventListener('change', function (e) {
      var el = e.target.closest ? e.target.closest('[data-smv]') : null;
      if (!el) return;
      var fn = CHG[el.getAttribute('data-smv')];
      if (fn) fn(el, e);
    });

    /* MANUAL ENTRY, and only manual entry.
       js/wedge.js already listens on the document and, when the keystrokes
       really were a scan, calls stopImmediatePropagation() on the terminating
       Enter — so this never sees one. It is registered from register(), which
       boot() calls long after wedge.js bound at load, which is what puts it
       second in line and makes that work. What reaches here is somebody
       typing a code off a scuffed box, slowly, by hand. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var box = e.target;
      if (!box || box.id !== 'smScan') return;
      var code = String(box.value || '').trim();
      box.value = '';
      if (!code) return;
      e.preventDefault();
      /* Past the wedge's own de-duplication window, which guards against a
         scanner re-reading a label it is resting on — not against a person
         deliberately typing the same code twice. */
      lastScan = null;
      onScan(code);
    });
  }

  function register() {
    bind();
    /* -- looking ---------------------------------------------------- */
    ACT['tile'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.sel = (S.sel === id) ? null : id;
      repaint();
    };

    CHG['room'] = function (el) {
      S.secId = +el.value; S.sel = null; repaint();
    };

    /* Straight to the DOM, no repaint: a slider that re-renders forty tiles
       per tick stutters on exactly the hardware this has to run on. */
    CHG['tilt'] = function (el) {
      S.tilt = +el.value;
      var rack = document.querySelector('.sm-rack');
      if (rack) rack.style.setProperty('--sm-tilt', S.tilt + 'deg');
    };

    /* -- the editor -------------------------------------------------- */
    ACT['edit'] = function () { S.edit = !S.edit; repaint(); };

    ACT['seed'] = function (el) {
      var id = +el.getAttribute('data-id');
      var rows = +document.getElementById('smSeedR').value;
      var cols = +document.getElementById('smSeedC').value;
      var cap = document.getElementById('smSeedCap').value;
      API.post('/api/sections/' + id + '/grid', {
        rows: rows, cols: cols, capacity: cap === '' ? null : +cap
      }).then(function () { reload(); })
        .catch(function (err) { toast(API.friendly(err), '', 'warn'); });
    };

    ACT['add-here'] = function (el) {
      var sec = current();
      if (!sec) return;
      API.post('/api/shelves', {
        sectionId: sec.id,
        rowLabel: el.getAttribute('data-row'),
        colIndex: +el.getAttribute('data-col')
      }).then(function (res) {
        reload().then(function () {
          if (res.shelf) { S.sel = res.shelf.id; repaint(); }
        });
      }).catch(function (err) { toast(API.friendly(err), '', 'warn'); });
    };

    ACT['row-add'] = function () {
      var sec = current();
      if (sec) rowsCols('rows', { action: 'add' });
    };
    ACT['col-add'] = function () {
      var sec = current();
      if (sec) rowsCols('cols', { action: 'add' });
    };
    ACT['row-rm'] = function (el) {
      removeRC('rows', { action: 'remove', row: el.getAttribute('data-row') },
               t('sm_remove_row').replace('{x}', el.getAttribute('data-row')));
    };
    ACT['col-rm'] = function (el) {
      removeRC('cols', { action: 'remove', col: +el.getAttribute('data-col') },
               t('sm_remove_col').replace('{x}', el.getAttribute('data-col')));
    };

    ACT['save'] = function (el) {
      var id = +el.getAttribute('data-id');
      var code = document.getElementById('smCode').value.trim().toUpperCase();
      var cap = document.getElementById('smCap').value;
      var pid = document.getElementById('smProd').value;
      var from = document.getElementById('smFrom').value;
      var to = document.getElementById('smTo').value;
      assignFlow(id, {
        code: code,
        capacity: cap === '' ? null : +cap,
        productId: pid === '' ? null : +pid,
        sizeFrom: from === '' ? null : from,
        sizeTo: to === '' ? null : to
      });
    };

    ACT['del'] = function (el) {
      var id = +el.getAttribute('data-id');
      API.del('/api/shelves/' + id).then(function () {
        S.sel = null; reload();
      }).catch(function (err) {
        /* The server's refusal carries the count: "M-A3 has 5". */
        toast(API.friendly(err), '', 'warn', 5000);
      });
    };

    /* The product pick rebuilds the from/to selects for that product's own
       run — patching just that span, not the whole map, so the two inputs
       beside it keep their values. */
    CHG['prod-pick'] = function (el) {
      var span = document.getElementById('smRange');
      if (span) span.outerHTML = rangeSelects(el.value === '' ? null : +el.value, null, null);
    };

    /* -- rooms -------------------------------------------------------- */
    ACT['room-new'] = function () { roomModal(null); };
    ACT['room-cfg'] = function () { roomModal(current()); };
    ACT['room-save'] = function (el) {
      var id = el.getAttribute('data-id');
      var name = document.getElementById('smRmName').value.trim();
      var origin = document.querySelector('input[name="smRmOrigin"]:checked').value;
      if (id) {
        API.patch('/api/sections/' + id, { name: name, gridOrigin: origin })
          .then(function () { closeModal(); reload(); })
          .catch(function (err) { toast(API.friendly(err), '', 'warn'); });
      } else {
        API.post('/api/sections', {
          whId: document.getElementById('smRmWh').value,
          key: document.getElementById('smRmKey').value.trim().toUpperCase(),
          name: name, gridOrigin: origin
        }).then(function (res) {
          closeModal();
          S.secId = res.section.id;
          reload();
        }).catch(function (err) { toast(API.friendly(err), '', 'warn'); });
      }
    };
    ACT['room-del'] = function (el) {
      API.del('/api/sections/' + el.getAttribute('data-id'))
        .then(function () { closeModal(); S.secId = null; load(); })
        .catch(function (err) { toast(API.friendly(err), '', 'warn', 5000); });
    };

    /* -- confirm + reprint ------------------------------------------- */
    ACT['confirm-apply'] = function () {
      closeModal();
      if (pendingApply) { var f = pendingApply; pendingApply = null; f(); }
    };
    /* Same mechanics, its own name: the row/column removal confirm. */
    ACT['remove-go'] = ACT['confirm-apply'];
    ACT['confirm-reprint'] = function (el) {
      /* Labels60 opens its own modal on top; the confirm's pending apply is
         dropped on purpose — reprinting first, then re-doing the change,
         keeps every step deliberate. */
      pendingApply = null;
      Labels60.openProductLabels(+el.getAttribute('data-id'));
    };

    ACT['print-shelf'] = function (el) {
      var hit = shelfById(+el.getAttribute('data-id'));
      if (hit) Labels60.openShelfLabels(hit.sec.wh_id, { sectionId: hit.sec.id, code: hit.sh.code });
    };

    /* -- the scan run ------------------------------------------------- */
    ACT['sound'] = function () {
      S.sound = !S.sound;
      try { localStorage.setItem(SOUND_KEY, S.sound ? '1' : '0'); } catch (e) {}
      /* Play the change so the toggle proves itself — turning sound ON in
         silence tells you nothing about whether this tablet has a speaker. */
      if (S.sound) beep('shelf');
      repaint();
    };
    ACT['undo'] = function (el) { undoChip(+el.getAttribute('data-id')); };
    ACT['chips-clear'] = function () { S.chips = []; repaint(); };

    /* -- the Settings list (same route, same flow) -------------------- */
    CHG['set-assign'] = function (el) {
      var id = +el.getAttribute('data-id');
      var pid = el.value;
      assignFlow(id, { productId: pid === '' ? null : +pid }, function () {
        var host = document.getElementById('setShelves');
        if (host) settingsList(host, true);
      });
    };

    if (typeof Wedge !== 'undefined' && Wedge.onScan) Wedge.onScan(onScan);
  }

  function rowsCols(kind, body) {
    var sec = current();
    API.post('/api/sections/' + sec.id + '/' + kind, body)
      .then(function () { reload(); })
      .catch(function (err) { toast(API.friendly(err), '', 'warn', 5000); });
  }

  /* Removing a row of empty shelves is one click from erasing a row of
     assignments, so it asks first — with the standing rule restated, because
     "the rows stay A, C, D" looks like a bug until you know that renumbering
     would invalidate every printed label in the room. */
  function removeRC(kind, body, title) {
    var sec = current();
    var doomed = sec.shelves.filter(function (sh) {
      return kind === 'rows' ? sh.row_label === body.row : sh.col_index === body.col;
    });
    var assigned = doomed.filter(function (sh) { return sh.product_id != null; }).length;
    openModal({
      title: title,
      size: 'narrow',
      body: '<p>' + t('sm_remove_n').replace('{n}', nf(doomed.length))
              .replace('{a}', nf(assigned)) + '</p>' +
            '<p class="muted">' + t('sm_no_renumber') + '</p>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-sm="remove-go">' + t('sm_remove_go') + '</button>'
    });
    pendingApply = function () { rowsCols(kind, body); };
  }

  function roomModal(sec) {
    var b = '';
    if (!sec) {
      b += '<label class="field"><span>' + t('sm_room_key') + '</span>' +
           '<input class="inp" id="smRmKey" type="text" maxlength="1" dir="ltr" ' +
           'style="width:70px;text-transform:uppercase"></label>';
      if (DB.warehouses.length > 1) {
        b += '<label class="field"><span>' + t('warehouse') + '</span>' +
             '<select class="inp" id="smRmWh">';
        DB.warehouses.forEach(function (w) {
          b += '<option value="' + esc(w.id) + '">' +
               esc(OG.lang === 'ar' ? w.nameAr : w.name) + '</option>';
        });
        b += '</select></label>';
      } else {
        b += '<input type="hidden" id="smRmWh" value="' + esc(DB.warehouses[0].id) + '">';
      }
    }
    b += '<label class="field"><span>' + t('sm_room_name') + '</span>' +
         '<input class="inp" id="smRmName" type="text" value="' + esc(sec ? sec.name : '') + '"></label>';

    var origin = sec ? sec.grid_origin : 'left';
    b += '<div class="field"><span>' + t('sm_origin') + '</span>' +
      '<label class="check"><input type="radio" name="smRmOrigin" value="left"' +
        (origin === 'left' ? ' checked' : '') + '><span>' + t('sm_origin_left') + '</span></label>' +
      '<label class="check"><input type="radio" name="smRmOrigin" value="right"' +
        (origin === 'right' ? ' checked' : '') + '><span>' + t('sm_origin_right') + '</span></label>' +
      '<small class="muted">' + t('sm_origin_hint') + '</small></div>';

    openModal({
      title: sec ? (sec.key + ' · ' + sec.name) : t('sm_new_room'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (sec && !sec.shelves.length
          ? '<button class="btn btn-ghost danger" data-sm="room-del" data-id="' + sec.id + '">' +
            t('sm_delete_room') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-sm="room-save"' +
          (sec ? ' data-id="' + sec.id + '"' : '') + '>' + t('save') + '</button>'
    });
  }

  /* ---------------------------------------------------- the Settings list */

  /* The coarse list: every room, every shelf, the assignment select — the
     same control the map's panel has, hitting the same route.

     afterSettings() runs after EVERY render of that screen, so this caches
     for a short window the way loadStaffPresence() does — refetching on
     every keystroke elsewhere in Settings would repaint the list under the
     user's pointer for no news. A write through smset-assign passes `force`,
     because its whole point is that something changed. */
  var setFreshAt = 0, setCache = null, setPending = null;
  var SET_FRESH_MS = 30 * 1000;

  /* The room list as a promise, for every screen that needs to NAME a shelf
     without drawing the map — the Settings list below, and the shelf picker
     on the Add product form.

     Always every room in every warehouse, never `?wh=`: a caller that wants
     one warehouse filters on wh_id itself, and fetching per warehouse would
     go back to the server the moment somebody flipped that select.

     `setPending` is not belt and braces. bindWarehouse() runs after EVERY
     render of the warehouse screen, and a render lands on the same tick as
     the first fetch often enough — without it, two requests go out and the
     slower answer paints over the newer one. */
  function cachedSections(force) {
    if (!force && setCache && Date.now() - setFreshAt < SET_FRESH_MS) {
      return Promise.resolve(setCache);
    }
    if (!force && setPending) return setPending;
    setPending = Shop.sections().then(function (res) {
      setCache = res.sections || [];
      setFreshAt = Date.now();
      setPending = null;
      return setCache;
    }, function (err) {
      /* Left null rather than cached, so the next paint retries instead of
         showing the same failure for thirty seconds. */
      setPending = null;
      throw err;
    });
    return setPending;
  }

  /* Called after anything that moves stock onto a shelf, so the next reader
     asks the server instead of drawing a shelf as empty when something was
     just put on it. */
  function invalidate() { setCache = null; setFreshAt = 0; }

  function settingsList(host, force) {
    if (!force && setCache && Date.now() - setFreshAt < SET_FRESH_MS &&
        host.getAttribute('data-painted')) {
      return;
    }
    cachedSections(force).then(function (secs) {
      host.setAttribute('data-painted', '1');
      if (!secs.length) {
        host.innerHTML = '<div class="muted">' + t('sm_no_rooms') + '</div>';
        return;
      }
      var products = DB.products.filter(function (p) { return !p.archived; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });

      var h = '';
      secs.forEach(function (s) {
        h += '<div class="sm-set-sec"><b>' + esc(s.key) + '</b> · ' + esc(s.name) + '</div>';
        if (!s.shelves.length) {
          h += '<div class="muted sm-set-none">' + t('sm_room_empty') + '</div>';
          return;
        }
        h += '<table class="tbl sm-set-tbl"><tbody>';
        s.shelves.forEach(function (sh) {
          h += '<tr><td class="mono">' + esc(sh.full_code) + '</td><td>' +
            '<select class="inp" data-smv="set-assign" data-id="' + sh.id + '">' +
            '<option value="">' + t('sm_unassigned_opt') + '</option>';
          products.forEach(function (p) {
            h += '<option value="' + p.id + '"' + (p.id === sh.product_id ? ' selected' : '') + '>' +
                 esc(p.name) + '</option>';
          });
          h += '</select></td>' +
            '<td class="muted">' + (sh.range ? esc(sh.range) : '') + '</td>' +
            '<td class="num">' + nf(sh.qty) + '</td></tr>';
        });
        h += '</tbody></table>';
      });
      host.innerHTML = h;
    }).catch(function (err) {
      host.innerHTML = '<div class="partner-note note-danger">' + esc(API.friendly(err)) + '</div>';
    });
  }

  return {
    view: view,
    after: after,
    owns: owns,
    register: register,
    reload: reload,
    assignFlow: assignFlow,
    settingsList: settingsList,
    /* The rooms themselves, for screens that name a shelf without drawing
       one. `S.data` stays private — this is a separate, short-lived cache. */
    cachedSections: cachedSections,
    invalidate: invalidate
  };
})();
