/* ==========================================================================
   OG SYSTEM — application shell  ·  11/17: the full SETTINGS screen
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 4811-5437). Loads after
   app-jobs-reports.js.
   ========================================================================== */

/* -------------------------------------------------------------- 14. SETTINGS */

/* ---------------------------------------------------------- THE ACCORDION

   Settings is eleven unrelated jobs on one page — the receipt printer's paper
   width above the loyalty tiers above who is signed in right now. Open all at
   once it is a wall you scroll rather than a page you read, and the one field
   somebody came here to change is somewhere in the middle of it.

   So every card folds and the head is the switch. Shut, the page is a list of
   what is in here; each head keeps the card's own one-line summary — the shop
   name, the rate, how many people are online — so the closed page still
   answers a question rather than being eleven bare nouns.

   A closed section is HIDDEN, not skipped. The markup is rendered either way,
   so the scanner probe still binds, the shelf list still fills and the roles
   grid still loads behind a head nobody has opened. Folding is a decision
   about display; making it one about data would mean afterSettings() had to
   re-run on every toggle, and half of these cards fetch.

   Which sections are open is remembered per MACHINE, like the sidebar rail
   and for the same reason: the till wants the printer open and the office
   wants the roles grid, and they are frequently the same account. */
var SET_FOLD_KEY = 'og.settings.open';
var SET_FOLDS = null;

function setFolds() {
  if (SET_FOLDS) return SET_FOLDS;
  SET_FOLDS = {};
  try {
    var raw = localStorage.getItem(SET_FOLD_KEY);
    var v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') SET_FOLDS = v;
  } catch (e) { /* private mode, or a value in an older shape — start shut */ }
  return SET_FOLDS;
}

function setFoldIsOpen(id) { return setFolds()[id] === true; }

/* Only the open ones are stored, so a section added later starts shut rather
   than inheriting whatever a stale key happened to hold. */
function setFoldRemember(id, open) {
  var s = setFolds();
  if (open) s[id] = true; else delete s[id];
  try { localStorage.setItem(SET_FOLD_KEY, JSON.stringify(s)); } catch (e) {}
}

/* Opens a foldable card. `meta` is the line the head carries while the body
   is shut — the sub-title the card already had, or a live count. */
/* The switch is a real <button> inside the heading — the disclosure shape,
   not a div told to behave like one. Enter, Space, the focus ring and the
   screen-reader announcement all come with the element; a role="button" div
   would have needed every one of them written by hand, and the keyboard half
   is the half that quietly never gets written. The <h3> stays outside it so
   Settings is still a page with headings rather than a stack of buttons. */
function setFoldStart(id, title, meta) {
  var open = setFoldIsOpen(id);
  return '<section class="card fold mb" data-fold="' + id + '" data-open="' + (open ? '1' : '0') + '">' +
    '<div class="card-head fold-head">' +
      '<h3 class="fold-h"><button type="button" class="fold-btn" data-act="set-fold"' +
        ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="fold-' + id + '">' +
        '<span class="fold-caret" aria-hidden="true"></span>' +
        '<span class="fold-title">' + title + '</span>' +
        (meta ? '<span class="fold-meta muted small">' + meta + '</span>' : '') +
      '</button></h3>' +
    '</div>' +
    '<div class="fold-body" id="fold-' + id + '">';
}

function setFoldEnd() { return '</div></section>'; }

/* A heading over a run of folds. Five of them across eleven cards is the
   difference between a list and a page. */
function setSection(label) { return '<div class="set-sec">' + label + '</div>'; }

/* ------------------------------------------------------------ ROLES & ACCESS

   This used to be a hardcoded array of thirteen rows with tick boxes wired to
   nothing — it edited a variable in the browser and the server never saw it.
   It looked exactly like the control panel for permissions and controlled
   nothing at all.

   The real matrix now comes from GET /api/roles and saves back with PUT. Held
   here after the first fetch so a re-render does not blank the table. */
var ROLE_MATRIX = null;
var ROLE_SAVE_T = null;

/* Fallback for demo mode and for _shot.html, where there is no server to ask.
   Shows the shipped defaults, read-only, so the screen still says something
   true rather than rendering an empty card in a client screenshot. */
var DEMO_MATRIX_ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner'];
var DEMO_MATRIX = [
  ['sell',           'till',      'Sell at the till',            [1, 1, 0, 0, 0]],
  ['refund',         'till',      'Give a refund',               [1, 1, 0, 0, 0]],
  ['void',           'till',      'Cancel a completed sale',     [1, 0, 0, 0, 0]],
  ['stock.read',     'stock',     'See stock levels',            [1, 1, 1, 1, 0]],
  ['stock.move',     'stock',     'Receive and move stock',      [1, 0, 1, 0, 0]],
  ['stock.count',    'stock',     'Do a stock count',            [1, 0, 1, 0, 0]],
  ['product.read',   'products',  'See products',                [1, 1, 1, 1, 0]],
  ['product.write',  'products',  'Add and edit products',       [1, 0, 1, 0, 0]],
  ['customer.read',  'customers', 'See customers',               [1, 1, 0, 1, 0]],
  ['customer.write', 'customers', 'Add and edit customers',      [1, 1, 0, 0, 0]],
  ['cost.read',      'money',     'See what things cost',        [1, 0, 0, 0, 0]],
  ['profit.read',    'money',     'See profit',                  [1, 0, 0, 0, 0]],
  ['money.read',     'money',     'See the money screen',        [1, 0, 0, 0, 0]],
  ['money.write',    'money',     'Record expenses and debts',   [1, 0, 0, 0, 0]],
  ['print.read',     'print',     'See print jobs',              [1, 1, 1, 1, 0]],
  ['print.write',    'print',     'Create and change print jobs',[1, 0, 0, 0, 0]],
  ['partner.read',   'print',     'See the partner portal',      [1, 0, 0, 0, 0]],
  ['partner.write',  'print',     'Act on partner orders',       [1, 0, 0, 0, 0]],
  ['staff.read',     'admin',     'See staff accounts',          [1, 0, 0, 0, 0]],
  ['staff.write',    'admin',     'Add and edit staff',          [1, 0, 0, 0, 0]],
  ['report.read',    'admin',     'See reports',                 [1, 0, 0, 0, 0]],
  ['config.write',   'admin',     'Change settings',             [1, 0, 0, 0, 0]],
  ['partner.jobs',   'partner',   'Yalla Wear: own jobs',        [0, 0, 0, 0, 1]],
  ['partner.respond','partner',   'Yalla Wear: accept or decline',[0, 0, 0, 0, 1]],
  ['partner.invoice','partner',   'Yalla Wear: own invoices',    [0, 0, 0, 0, 1]]
];

function demoMatrix() {
  return {
    roles: DEMO_MATRIX_ROLES,
    permissions: DEMO_MATRIX.map(function (r) {
      var roles = {};
      DEMO_MATRIX_ROLES.forEach(function (name, i) {
        roles[name] = { allowed: !!r[3][i], locked: true, why: null };
      });
      return { perm: r[0], group: r[1], label: r[2], roles: roles };
    })
  };
}

function rolesCard() {
  var m = ROLE_MATRIX || (typeof Auth === 'undefined' ? demoMatrix() : null);

  /* Still loading. Draw the frame rather than nothing, so the card does not
     pop into existence and shove the rest of the page down. */
  if (!m) {
    return setFoldStart('roles', t('roles_perms'), '') +
      '<div class="card-body muted small">…</div>' + setFoldEnd();
  }

  /* Only a manager may change these. Everyone else sees the same grid,
     read-only — knowing the rules is not a privilege, changing them is. */
  var editable = typeof Auth !== 'undefined' && Auth.can('config.write');

  var h = setFoldStart('roles', t('roles_perms'),
    m.roles.length + ' ' + t('role').toLowerCase() + 's · ' +
    m.permissions.length + ' ' + t('permission').toLowerCase() + 's');

  if (editable) h += '<div class="perm-hint">' + t('roles_editable') + '</div>';

  h += '<div class="table-wrap"><table class="tbl perm-tbl"><thead><tr>' +
    '<th>' + t('permission') + '</th>';
  m.roles.forEach(function (r) {
    h += '<th class="pc">' + esc(roleLabel(r)) + '</th>';
  });
  h += '</tr></thead><tbody>';

  var lastGroup = null;
  m.permissions.forEach(function (p) {
    /* A group heading row. Twenty-five ticked boxes in a column is unreadable;
       broken into "Till", "Stock", "Money" it reads as a description of a job. */
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      h += '<tr class="perm-group"><td colspan="' + (m.roles.length + 1) + '">' +
        t('pg_' + p.group) + '</td></tr>';
    }

    h += '<tr><td class="perm-name">' + esc(p.label) + '</td>';
    m.roles.forEach(function (r) {
      var cell = p.roles[r] || { allowed: false, locked: true };
      var locked = cell.locked || !editable;
      h += '<td class="pc' + (cell.locked ? ' is-locked' : '') + '"' +
        (cell.why ? ' title="' + esc(cell.why) + '"' : '') + '>' +
        '<input type="checkbox"' + (cell.allowed ? ' checked' : '') +
        (locked ? ' disabled' : ' data-change="set-perm" data-role="' + r +
                                '" data-perm="' + esc(p.perm) + '"') + '>' +
        (cell.locked ? '<span class="lock-i" aria-hidden="true">🔒</span>' : '') +
        '</td>';
    });
    h += '</tr>';
  });

  h += '</tbody></table></div>' + setFoldEnd();
  return h;
}

/* Pull the live matrix, then repaint Settings once. Called from afterSettings
   so it only runs when the screen is actually open. */
function loadRoleMatrix() {
  if (typeof Auth === 'undefined') return;
  if (ROLE_MATRIX) return;

  API.get('/api/roles')
    .then(function (m) {
      ROLE_MATRIX = { roles: m.roles, permissions: m.permissions };
      if (OG.view === 'settings') render();
    })
    .catch(function () { /* the card keeps its placeholder; nothing else breaks */ });
}

/* ------------------------------------------------------ ONLINE NOW (presence)

   Reuses sessions.last_seen — already ticking on every authenticated
   request — rather than any new tracking. GET /api/staff/presence lists
   only accounts with a live (non-expired) session; someone who's fully
   signed out just isn't in the list, same "absent means nothing to
   report" shape as the rest of the app. Same fetch-once/cache/render
   pattern as ROLE_MATRIX/loadRoleMatrix above. */
var STAFF_PRESENCE = null;

/* How long a presence read stays good enough to reuse.

   This number is doing more than saving a request. loadStaffPresence() is
   called from afterSettings(), which runs after EVERY render — and the
   response calls render(). Without something to break that, the two chase
   each other forever: render, fetch, render, fetch. The page never settles,
   which is felt as a Settings screen that lags and throws the scroll back to
   the top every second or so.

   loadRoleMatrix() above avoids it with `if (ROLE_MATRIX) return` — it can,
   because a permission matrix does not change while you look at it. Who is
   signed in does, so this cannot latch permanently; it goes stale instead. */
var PRESENCE_FRESH_MS = 30 * 1000;
var STAFF_PRESENCE_AT = 0;

function loadStaffPresence() {
  if (typeof Auth === 'undefined') return;
  if (!Auth.can('staff.read')) return;

  /* The render this fetch triggers lands back here immediately; that second
     visit is inside the window and stops, which is what ends the loop. */
  if (Date.now() - STAFF_PRESENCE_AT < PRESENCE_FRESH_MS) return;
  STAFF_PRESENCE_AT = Date.now();

  API.get('/api/staff/presence')
    .then(function (r) {
      STAFF_PRESENCE = r.staff || [];
      if (OG.view === 'settings') render();
    })
    .catch(function () {
      /* The card keeps its placeholder. The stamp stays set on purpose — a
         server that is refusing this call must not be asked again on every
         render; the next attempt is a window away. */
    });
}

function presenceMinutesAgo(iso) {
  var mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t('presence_active_now');
  if (mins < 60) return t('presence_active_min').replace('{n}', mins);
  var hrs = Math.round(mins / 60);
  return t('presence_active_hr').replace('{n}', hrs);
}

function presenceCard() {
  if (typeof Auth === 'undefined') {
    return setFoldStart('presence', t('presence_title'), '') +
      '<div class="card-body muted small">' + t('demo_no_account') + '</div>' + setFoldEnd();
  }
  if (!Auth.can('staff.read')) return '';

  var list = STAFF_PRESENCE;

  /* The count IS the head here: a manager running down a shut page wants to
     know somebody is on the till, not to open a card to find out. */
  var meta = '';
  if (list) {
    var onlineNow = list.filter(function (s) { return s.online; }).length;
    meta = '<span class="badge ' + (onlineNow ? 'healthy' : 'neutral') + '">' +
      onlineNow + ' ' + t('presence_online_count') + '</span>';
  }
  var h = setFoldStart('presence', t('presence_title'), meta);

  if (!list) return h + '<div class="card-body muted small">…</div>' + setFoldEnd();
  if (!list.length) {
    return h + '<div class="card-body muted small">' + t('presence_empty') + '</div>' + setFoldEnd();
  }

  list.forEach(function (s) {
    h += '<div class="alert-row">' +
      '<span class="dot ' + (s.online ? 'healthy' : 'offline') + '"></span>' +
      '<span class="alert-txt"><b>' + esc(s.name) + '</b>' +
        '<small>' + esc(roleLabel(s.role)) + ' · ' + presenceMinutesAgo(s.lastSeen) + '</small></span>' +
    '</div>';
  });
  h += setFoldEnd();
  return h;
}

/* Save one role. Sends the whole granted list rather than a diff, so the
   server never has to reconcile a partial view of the truth. */
function saveRolePermissions(role) {
  if (!ROLE_MATRIX) return;

  var granted = ROLE_MATRIX.permissions
    .filter(function (p) { return p.roles[role] && p.roles[role].allowed; })
    .map(function (p) { return p.perm; });

  API.put('/api/roles/' + encodeURIComponent(role), { granted: granted })
    .then(function (res) {
      ROLE_MATRIX = { roles: res.matrix.roles, permissions: res.matrix.permissions };

      /* The server may have refused part of it — a pinned manager permission,
         or something the partner may never have. Say so plainly and redraw
         from what actually saved, rather than leaving a tick that did not
         stick. */
      if (res.refused && res.refused.length) {
        toast(t('perm_refused'), res.refused.join(', '), 'err', 5000);
      } else {
        toast(t('perm_saved'), roleLabel(role), 'ok', 1800);
      }

      /* Your own role may have just changed — repaint the menu, not just the
         table. */
      if (typeof Auth !== 'undefined') Auth.refresh().then(function () { refreshAll(); });
      else render();
    })
    .catch(function (e) { toast(t('roles_perms'), API.friendly(e), 'err', 5000); });
}

/* ---- the automatic reminders --------------------------------------------
   THE IDS ARE THE SERVER'S. Each one is a rule in server/lib/reminders.js and
   a config key `reminders.<id>`, so a rule added there needs one row here and
   two i18n strings (`rem_<id>` and `rem_<id>_sub`) and nothing else — no
   handler, no save path, no third list to keep in step.

   This card used to be seven hardcoded English sentences with a third element
   that looked like an on/off state and was bound to nothing at all: the
   switches drew, moved, and saved nowhere. Everything below is live.

   [ id, group ]. Audience is implied by the `yl_` prefix, which is also what
   the partner's own copy of this list filters on. */
var REMINDER_RULES = [
  ['day_close', 'day'], ['shift_open', 'day'], ['cash_variance', 'day'],
  ['stock_out', 'stock'], ['stock_critical', 'stock'], ['po_late', 'stock'],
  ['wants_back', 'stock'],
  ['order_no_answer', 'print'], ['job_late', 'print'], ['partner_unread', 'print'],
  ['job_stuck', 'print'], ['pay_wait', 'print'],
  ['yl_order_waiting', 'yl'], ['yl_due', 'yl'], ['yl_blocked', 'yl'],
  ['yl_digest', 'yl'], ['yl_pay_wait', 'yl']
];

/* The numbers each group owns: [ config key without the prefix, min, max ].
   Hours are 0-23 in the SHOP's clock, not the browser's. */
var REMINDER_NUMS = {
  day:   [['day_close_hour', 0, 23], ['shift_open_hour', 0, 23], ['variance_min', 0, 99999999]],
  stock: [['stock_repeat_days', 1, 365]],
  print: [['order_wait_hours', 1, 168], ['unread_hours', 1, 168],
          ['delivery_stuck_hours', 1, 720], ['pay_confirm_hours', 1, 720]],
  yl:    [['yl_digest_hour', 0, 23]]
};

function remOn(id) { return CONFIG.REMINDERS[id] !== '0'; }
function remNum(key, fb) {
  var v = Number(CONFIG.REMINDERS[key]);
  return isFinite(v) && CONFIG.REMINDERS[key] !== undefined && CONFIG.REMINDERS[key] !== '' ? v : fb;
}
/* The shop's clock, from shop.tz_minutes — which is what the scheduler's day
   is built from, and therefore the one number that decides whether the nightly
   close lands at nine in the evening or four in the morning. */
function remShopClock() {
  var d = new Date(Date.now() + CONFIG.TZ_MINUTES * 60000);
  var hh = String(d.getUTCHours()); if (hh.length < 2) hh = '0' + hh;
  var mm = String(d.getUTCMinutes()); if (mm.length < 2) mm = '0' + mm;
  var off = CONFIG.TZ_MINUTES / 60;
  return hh + ':' + mm + ' UTC' + (off >= 0 ? '+' : '') + off;
}

/* ---- hardware ------------------------------------------------------------
   A scanner that half-works is the worst failure mode in the shop: codes land
   in a search box, or nothing happens at all, and there is nothing on screen
   to say why. This card is the answer to "is it the scanner or the app?" —
   it shows the raw characters, how fast they arrived, and the verdict. */
function hardwareCard() {
  var cfg = (typeof Wedge !== 'undefined') ? Wedge.config() : { prefix: '', maxGapMs: 35 };
  var cam = (typeof Scan !== 'undefined') ? Scan.supported() : { native: false };

  var h = setFoldStart('hw', t('hw_title'), t('hw_sub')) + '<div class="card-body">';

  /* -- scanner -- */
  h += '<h4 class="set-h">' + t('hw_scanner') + '</h4>' +
    '<p class="set-note">' + t('hw_scanner_note') + '</p>' +
    '<div class="hw-test" id="hwTest">' +
      '<input class="inp" id="hwProbe" type="text" placeholder="' + esc(t('hw_test')) + '" autocomplete="off">' +
      '<div class="hw-read" id="hwRead"><span class="muted">' + t('hw_waiting') + '</span></div>' +
    '</div>';

  h += '<div class="grid mt" style="grid-template-columns:1fr 1fr;gap:12px">' +
    '<label class="field"><span class="lbl">' + t('hw_prefix') + '</span>' +
      '<input class="inp" id="hwPrefix" type="text" maxlength="1" value="' + esc(cfg.prefix) + '">' +
      '<small class="faint">' + t('hw_prefix_note') + '</small></label>' +
    '<label class="field"><span class="lbl">' + t('hw_threshold') + ' — <b id="hwGapVal">' + cfg.maxGapMs + '</b> ms</span>' +
      '<input class="inp" id="hwGap" type="range" min="10" max="120" step="5" value="' + cfg.maxGapMs + '">' +
      '<small class="faint">' + t('hw_threshold_note') + '</small></label>' +
  '</div>';

  /* The camera gap, said out loud rather than discovered in the shop. */
  if (!cam.native) {
    h += '<div class="partner-note note-warn mt">' + t('hw_camera_gap') + '</div>';
  }

  /* -- printer -- */
  /* The label printer's own choices — output, template, station — live in
     the Labels fold below (thermalLabelsCard); this card keeps the two
     things that prove the hardware: a test label and the ruler. */
  h += '<div class="set-sep"></div>' +
    '<h4 class="set-h">' + t('hw_printer') + '</h4>' +
    '<p class="set-note">' + t('hw_printer_note') + '</p>' +
    '<div class="chip-row mt">' +
      '<button class="btn btn-ghost" data-act="hw-test-label">' + t('hw_test_label') + '</button>' +
      '<button class="btn btn-ghost" data-act="hw-calibrate">' + t('hw_calibrate') + '</button>' +
    '</div>';

  h += '<div class="partner-note mt">' + t('hw_sym_note') + '</div>';

  /* -- receipt paper --
     Separate from the label roll above: they are two different printers in
     most shops, and even where they are one machine, a 30mm label and an 80mm
     receipt are different stock. */
  h += '<div class="set-sep"></div>' +
    '<h4 class="set-h">' + t('rc_paper') + '</h4>' +
    '<p class="set-note">' + t('rc_paper_hint') + '</p>' +
    '<div class="chip-row mt">' +
      '<button class="chip ' + (OG.rc.width === '80' ? 'on' : '') + '" data-act="rc-width" data-k="80">' + t('rc_80') + '</button>' +
      '<button class="chip ' + (OG.rc.width === '58' ? 'on' : '') + '" data-act="rc-width" data-k="58">' + t('rc_58') + '</button>' +
    '</div>';

  return h + '</div>' + setFoldEnd();
}

/* ---- the 80mm thermal receipt --------------------------------------------
   Everything a manager can tune without a code change: which printer to
   talk to, how many copies, and the two blocks of text that print on every
   receipt bilingual — the footer and the return policy. Saves straight to
   the server's config table via PUT /api/config; there is nothing to save
   in demo mode, so the fields show the seeded defaults and stay read-only. */
function receiptSettingsCard() {
  var demo = typeof Auth === 'undefined';
  var dis = demo ? ' disabled' : '';

  var h = setFoldStart('receipt', t('rc3_title'), t('rc3_sub')) + '<div class="card-body">';

  if (demo) h += '<div class="partner-note note-warn mb">' + t('rc3_demo_note') + '</div>';

  /* FIVE SUBJECTS, NOT FORTY FIELDS. Which printer, what prints at the top of
     the slip, how the head burns it, what appears on the paper, and the gift
     slip's own separate wording. Written as one flat column they read as a
     wall somebody scrolls past; the hardware card two folds down had already
     worked this out with a heading and a rule between each group. */
  h += '<h4 class="set-h">' + t('rc3_g_printer') + '</h4>';

  var usb = CONFIG.RECEIPT_TRANSPORT === 'usb';
  h += '<label class="field"><span>' + t('rc3_transport') + '</span>' +
    '<div class="chip-row" id="rcTransport" data-v="' + (usb ? 'usb' : 'tcp') + '">' +
      '<button class="chip ' + (!usb ? 'on' : '') + '"' + dis +
        ' data-act="rc-transport" data-k="tcp">' + t('rc3_transport_network') + '</button>' +
      '<button class="chip ' + (usb ? 'on' : '') + '"' + dis +
        ' data-act="rc-transport" data-k="usb">' + t('rc3_transport_usb') + '</button>' +
    '</div></label>';

  h += '<div class="row2" id="rcTransportFields">';
  if (usb) {
    h += '<label class="field" style="grid-column:1/-1"><span>' + t('rc3_printer_share') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcShare" value="' + esc(CONFIG.RECEIPT_PRINTER_SHARE) + '"' + dis + '></label>' +
      '<div class="partner-note" style="grid-column:1/-1">' + t('rc3_printer_share_hint') + '</div>';
  } else {
    h += '<label class="field"><span>' + t('rc3_host') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcHost" value="' + esc(CONFIG.RECEIPT_PRINTER_HOST) + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('rc3_port') + '</span>' +
      '<input class="inp num" type="number" id="rcPort" value="' + CONFIG.RECEIPT_PRINTER_PORT + '"' + dis + '></label>';
  }
  h += '</div>';

  h += '<div class="set-sep"></div><h4 class="set-h">' + t('rc3_g_head') + '</h4>' +
    '<p class="set-note">' + t('rc3_g_head_note') + '</p>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_branch') + '</span>' +
      '<input class="inp" id="rcBranch" value="' + esc(CONFIG.SHOP_BRANCH) + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('phone') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcPhone" value="' + esc(CONFIG.SHOP_PHONE) + '"' + dis + '></label>' +
  '</div>';

  /* Printed on the receipt in place of the street address (drawHeader() no
     longer prints it — the customer is standing in the shop already). */
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_instagram') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcInstagram" value="' + esc(CONFIG.RECEIPT_INSTAGRAM) + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('rc3_telegram') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcTelegram" value="' + esc(CONFIG.RECEIPT_TELEGRAM) + '"' + dis + '></label>' +
  '</div>';
  h += '<div class="row2">' +
    '<label class="field" style="grid-column:1/-1"><span>' + t('rc3_maps_url') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcMapsUrl" value="' + esc(CONFIG.RECEIPT_MAPS_URL) + '"' + dis + '></label>' +
  '</div>';

  h += '<div class="set-sep"></div><h4 class="set-h">' + t('rc3_g_how') + '</h4>' +
    '<p class="set-note">' + t('rc3_g_how_note') + '</p>';

  h += '<div class="rule-row"><div class="rr-txt"><b>' + t('rc3_auto_print') + '</b>' +
    '<small>' + t('rc3_auto_print_hint') + '</small></div>' +
    '<label class="switch"><input type="checkbox" id="rcAutoPrint"' +
      (CONFIG.RECEIPT_AUTO_PRINT ? ' checked' : '') + dis + '><i></i></label></div>';

  h += '<div class="rule-row"><div class="rr-txt"><b>' + t('rc3_confirm_print') + '</b>' +
    '<small>' + t('rc3_confirm_print_hint') + '</small></div>' +
    '<label class="switch"><input type="checkbox" id="rcConfirmPrint"' +
      (CONFIG.RECEIPT_CONFIRM_PRINT ? ' checked' : '') + dis + '><i></i></label></div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_copies') + '</span>' +
      '<input class="inp num" type="number" min="1" max="4" id="rcCopies" value="' + CONFIG.RECEIPT_COPIES + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('rc3_cut_mode') + '</span>' +
      '<div class="chip-row" id="rcCutMode" data-v="' + esc(CONFIG.RECEIPT_CUT_MODE) + '">' +
        '<button class="chip ' + (CONFIG.RECEIPT_CUT_MODE !== 'full' ? 'on' : '') + '"' + dis +
          ' data-act="rc-cut" data-k="partial">' + t('rc3_cut_partial') + '</button>' +
        '<button class="chip ' + (CONFIG.RECEIPT_CUT_MODE === 'full' ? 'on' : '') + '"' + dis +
          ' data-act="rc-cut" data-k="full">' + t('rc3_cut_full') + '</button>' +
      '</div></label>' +
  '</div>';

  /* Print darkness. Not a cosmetic preference — this is the knob that decides
     whether the small print reaches the paper at all, so it sits on the card
     with a hint rather than being buried. Three named steps and no raw number:
     the person adjusting it is holding a receipt that came out too faint. */
  h += '<label class="field"><span>' + t('rc3_ink') + '</span>' +
    '<div class="chip-row" id="rcInk" data-v="' + esc(CONFIG.RECEIPT_INK) + '">' +
      ['normal', 'dark', 'darker'].map(function (k) {
        return '<button class="chip ' + (CONFIG.RECEIPT_INK === k ? 'on' : '') + '"' + dis +
          ' data-act="rc-ink" data-k="' + k + '">' + t('rc3_ink_' + k) + '</button>';
      }).join('') +
    '</div><small class="faint">' + t('rc3_ink_hint') + '</small></label>';

  h += '<div class="set-sep"></div><h4 class="set-h">' + t('rc3_g_slip') + '</h4>' +
    '<p class="set-note">' + t('rc3_g_slip_note') + '</p>';

  [['rcShowBarcode', 'rc3_show_barcode', 'rc3_show_barcode_hint', CONFIG.RECEIPT_SHOW_BARCODE],
   ['rcShowLoyalty', 'rc3_show_loyalty', 'rc3_show_loyalty_hint', CONFIG.RECEIPT_SHOW_LOYALTY]
  ].forEach(function (f) {
    h += '<div class="rule-row"><div class="rr-txt"><b>' + t(f[1]) + '</b>' +
      '<small>' + t(f[2]) + '</small></div>' +
      '<label class="switch"><input type="checkbox" id="' + f[0] + '"' + (f[3] ? ' checked' : '') + dis + '><i></i></label></div>';
  });

  h += '<div class="row2 mt">' +
    '<label class="field"><span>' + t('rc3_footer_ar') + '</span>' +
      '<textarea class="inp" dir="rtl" id="rcFooterAr" rows="2"' + dis + '>' + esc(CONFIG.RECEIPT_FOOTER_AR) + '</textarea></label>' +
    '<label class="field"><span>' + t('rc3_footer_en') + '</span>' +
      '<textarea class="inp" dir="ltr" id="rcFooterEn" rows="2"' + dis + '>' + esc(CONFIG.RECEIPT_FOOTER_EN) + '</textarea></label>' +
  '</div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_policy_ar') + '</span>' +
      '<textarea class="inp" dir="rtl" id="rcPolicyAr" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_POLICY_AR) + '</textarea></label>' +
    '<label class="field"><span>' + t('rc3_policy_en') + '</span>' +
      '<textarea class="inp" dir="ltr" id="rcPolicyEn" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_POLICY_EN) + '</textarea></label>' +
  '</div>';

  /* ---- the gift slip -----------------------------------------------------
     A separate window and separate wording from the two above, because a
     present is bought before it is given: the shop's ordinary 48 hours has
     usually run out by the time the box is opened. The wording also has to
     say "exchange only, no cash back", which an ordinary receipt never needs
     to because the customer is holding the price.

     STORED IN HOURS, SHOWN IN DAYS. Hours is what receipt.exchange_hours
     already uses and what the slip's "exchange before" date is computed from;
     days is how the owner thinks about it. The x24 lives here and nowhere
     else. */
  h += '<div class="set-sep"></div><h4 class="set-h">' + t('rc3_g_gift') + '</h4>';

  /* The reason for a separate window is longer than the field is wide, and it
     went UNDER a half-width input with the other half of the row empty. It
     sits beside the field instead: the hole is exactly where it belongs. */
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_gift_window') + '</span>' +
      '<input class="inp num" type="number" min="1" max="365" id="rcGiftDays" value="' +
        Math.max(1, Math.round(CONFIG.RECEIPT_GIFT_EXCHANGE_HOURS / 24)) + '"' + dis + '></label>' +
    '<p class="set-note set-aside">' + t('rc3_gift_window_hint') + '</p>' +
  '</div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_gift_policy_ar') + '</span>' +
      '<textarea class="inp" dir="rtl" id="rcGiftPolicyAr" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_GIFT_POLICY_AR) + '</textarea></label>' +
    '<label class="field"><span>' + t('rc3_gift_policy_en') + '</span>' +
      '<textarea class="inp" dir="ltr" id="rcGiftPolicyEn" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_GIFT_POLICY_EN) + '</textarea></label>' +
  '</div>';

  h += '<div class="mt"><button class="btn btn-primary" data-act="rc-save-config"' + dis + '>' +
    t('rc3_save') + '</button></div>';

  return h + '</div>' + setFoldEnd();
}

/* ---- thermal product labels (XP-235B) -------------------------------------
   A separate card from receiptSettingsCard() and from the old browser
   Label Studio's controls inside hardwareCard() — different printer,
   different protocol, different queue. Station/preset pickers and the
   queue view work for anyone with label.print; the config fields below
   them are manager-only (config.write), same split as everywhere else. */
function thermalLabelsCard() {
  var demo = typeof Auth === 'undefined';
  var canPrint = allow('label.print');
  var canConfig = allow('config.write') && !demo;
  var dis = demo || !canPrint ? ' disabled' : '';
  var cdis = canConfig ? '' : ' disabled';

  var h = setFoldStart('labels', t('lbl_thermal_section'), t('lbl_thermal_sub')) + '<div class="card-body">';

  if (demo) h += '<div class="partner-note note-warn mb">' + t('rc3_demo_note') + '</div>';
  else if (!canPrint) h += '<div class="partner-note note-warn mb">' + t('no_access') + '</div>';

  /* Where this machine's labels come out — the same choice the preview
     offers, remembered per machine. */
  var out = Labels.outputChoice();
  h += '<div class="chip-row"><span class="lbl-lbl">' + t('lbl_output') + '</span>' +
    '<button class="chip ' + (out === 'station' ? 'on' : '') + '"' + dis + ' data-act="label-output" data-k="station">' + t('lbl_out_station') + '</button>' +
    '<button class="chip ' + (out === 'browser' ? 'on' : '') + '"' + dis + ' data-act="label-output" data-k="browser">' + t('lbl_out_browser') + '</button>' +
    '</div>';

  if (out === 'station') {
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_station') + '</span>';
    Labels.stationOptions().forEach(function (s) {
      h += '<button class="chip ' + (Labels.lastChoice().station === s ? 'on' : '') + '"' + dis +
        ' data-act="label-station" data-k="' + esc(s) + '">' + esc(s) + '</button>';
    });
    h += '</div>';
  } else {
    h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('hw_mode') + '</span>' +
      '<button class="chip ' + (Labels.lastChoice().paper !== 'sheet' ? 'on' : '') + '"' + dis + ' data-act="label-paper" data-k="roll">' + t('hw_roll') + '</button>' +
      '<button class="chip ' + (Labels.lastChoice().paper === 'sheet' ? 'on' : '') + '"' + dis + ' data-act="label-paper" data-k="sheet">' + t('hw_sheet') + '</button>' +
      '</div>';
  }

  h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_preset') + '</span>';
  Labels.presetOptions().forEach(function (p) {
    h += '<button class="chip ' + (Labels.lastChoice().preset === p.key ? 'on' : '') + '"' + dis +
      ' data-act="label-preset" data-k="' + esc(p.key) + '" title="' + esc(p.widthMm + ' × ' + p.heightMm + ' mm') + '">' +
      esc(Labels.presetLabel(p)) + '</button>';
  });
  h += '</div>';
  h += '<p class="small muted mt">' + t('lbl_templates_note') + '</p>';

  h += '<div class="mt"><button class="btn btn-ghost"' + dis + ' data-act="label-calibrate">' +
    t('hw_calibrate') + '</button></div>';

  if (!demo && canPrint && OG.labelQueue === undefined && !OG.labelQueueLoading) {
    OG.labelQueueLoading = true;
    API.get('/api/labels/queue').then(function (res) {
      OG.labelQueueLoading = false;
      OG.labelQueue = res.jobs || [];
      if (OG.view === 'settings') render();
    }).catch(function () { OG.labelQueueLoading = false; OG.labelQueue = []; });
  }
  var jobs = OG.labelQueue || [];
  h += '<div class="set-sep"></div><h4 class="set-h">' + t('lbl_queue_title') + '</h4>';
  if (!jobs.length) {
    h += '<p class="small muted">' + t('lbl_queue_empty') + '</p>';
  } else {
    h += '<div class="table-wrap"><table class="tbl tbl-compact"><tbody>';
    jobs.forEach(function (j) {
      h += '<tr><td>' + esc(j.station) + '</td><td class="muted small">' + esc(j.preset) + '</td>' +
        '<td class="num">' + j.label_count + '</td>' +
        '<td><span class="badge ' + (j.status === 'done' ? 'silver' : j.status === 'failed' ? 'danger' : 'neutral') + '">' + esc(j.status) + '</span></td>' +
        '<td>' + (j.status === 'pending'
          ? '<button class="btn btn-sm btn-ghost" data-act="label-cancel-job" data-id="' + j.id + '">' + t('lbl_cancel') + '</button>'
          : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  h += '<div class="set-sep"></div><h4 class="set-h">' + t('lbl_transport') + '</h4>';
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('lbl_transport') + '</span>' +
      '<select class="inp" id="lblTransport"' + cdis + '>' +
        '<option value="agent"' + (CONFIG.LABEL_TRANSPORT !== 'tcp' ? ' selected' : '') + '>' + t('lbl_transport_agent') + '</option>' +
        '<option value="tcp"' + (CONFIG.LABEL_TRANSPORT === 'tcp' ? ' selected' : '') + '>' + t('lbl_transport_tcp') + '</option>' +
      '</select></label>' +
    '<label class="field"><span>' + t('lbl_host') + '</span>' +
      '<input class="inp num" dir="ltr" id="lblHost" value="' + esc(CONFIG.LABEL_PRINTER_HOST || '') + '"' + cdis + '></label>' +
  '</div>';
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('lbl_density') + '</span>' +
      '<input class="inp num" type="number" min="1" max="15" id="lblDensity" value="' + (CONFIG.LABEL_DENSITY || 8) + '"' + cdis + '></label>' +
    '<label class="field"><span>' + t('lbl_gap') + '</span>' +
      '<input class="inp num" type="number" min="0" step="0.5" id="lblGap" value="' + (CONFIG.LABEL_GAP_MM || 2) + '"' + cdis + '></label>' +
  '</div>';
  h += '<div class="mt"><button class="btn btn-primary"' + cdis + ' data-act="lbl-save-config">' + t('lbl_save') + '</button></div>';

  return h + '</div>' + setFoldEnd();
}

/* Which model each shelf is for — the coarse list beside the map, for the
   manager who wants to run down a whole room's assignments without clicking
   forty tiles. The controls are ShelfMap's own (data-change="smset-assign"),
   so both surfaces hit PATCH /api/shelves/:id through one flow, warnings and
   stale-label counts included. */
function shelvesCard() {
  /* The map button moved out of the head when the head became the fold
     switch: a button sitting inside the thing you click to open a section is
     a target people miss in both directions. */
  return setFoldStart('shelves', t('sm_shelves_title'), '') +
    '<div class="card-body">' +
      '<div class="fold-row"><div class="sub">' + t('sm_shelves_sub') + '</div>' +
        '<button class="btn btn-ghost btn-sm" data-act="nav" data-view="warehouse" data-tab="map">' +
          t('sm_open_map') + '</button></div>' +
      '<div id="setShelves"><span class="muted">…</span></div>' +
    '</div>' + setFoldEnd();
}

/* ---- the shop's own details ----------------------------------------------
   The five cards below used to be written inline inside viewSettings() and
   laid out in a two-column grid. They are functions now for one reason: a
   fold needs a head with a summary on it, and a summary is a line of code,
   not a line of markup. */
/* The mark sits BESIDE the name's input, not beside the whole field, so the
   label above it starts on the same left edge as every other label in the
   card. It used to wrap both, which pushed "SHOP NAME" 70px in while "ACCENT
   COLOUR" and the address below stayed at the body's edge — three labels, three
   different left edges, in the card whose entire subject is how the shop looks.

   The last field is the shop's ADDRESS. It was labelled t('phone') and typed
   as .num dir="ltr" while holding "Aleppo, Syria": a phone number is a
   different field, it is in the receipt fold, and forcing LTR on an Arabic
   address reorders the phrase the same way it does a date. */
function brandingCard() {
  return setFoldStart('brand', t('branding'), esc(CONFIG.SHOP_NAME)) +
    '<div class="card-body">' +
    '<label class="field"><span>' + t('shop_name') + '</span>' +
      '<div class="set-brand-row">' +
        '<div class="brand-mark"><img src="assets/logo.svg" alt=""></div>' +
        '<input class="inp" id="setShopName" value="' + esc(CONFIG.SHOP_NAME) + '" data-change="set-shopname">' +
      '</div></label>' +
    '<div class="lbl">' + t('accent_colour') + '</div>' +
    '<div class="swatch-row">' +
      '<div class="swatch" style="background:#C6FF00;border-color:var(--foreground);border-width:2px"><span>C6FF00</span></div>' +
      '<div class="swatch" style="background:#0A0A0B"><span>0A0A0B</span></div>' +
      '<div class="swatch" style="background:#FAFAFA"><span>FAFAFA</span></div>' +
      '<div class="swatch" style="background:#F87171"><span>F87171</span></div>' +
      '<div class="swatch" style="background:#4ADE80"><span>4ADE80</span></div>' +
    '</div>' +
    '<label class="field"><span>' + t('address') + '</span>' +
      '<input class="inp" dir="auto" id="setAddr" value="' + esc(CONFIG.SHOP_ADDRESS) + '" ' +
        'data-change="set-addr"></label>' +
    '</div>' + setFoldEnd();
}

/* Every dollar price on every screen converts through this one number, so the
   rate itself is what the shut head says. */
function rateCard() {
  /* The summary is an LTR run inside what may be an RTL page: unmarked, the
     leading 1 is dragged to the far end and the head reads 'USD = 130 SYP 1'. */
  return setFoldStart('rate', t('exchange_rate'),
      '<span dir="ltr">1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP</span>') +
    '<div class="card-body">' +
    '<label class="field"><span>' + t('rate_hint') + '</span>' +
      '<input class="inp num" id="setRate" type="number" value="' + CONFIG.EXCHANGE_RATE + '" data-change="set-rate"></label>' +
    '<div class="partner-note">1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP · ' +
      (OG.lang === 'ar' ? 'كل الأسعار في النظام تتحدّث فوراً' : 'every price in the system updates instantly') + '</div>' +
    '</div>' + setFoldEnd();
}

/* The loyalty rules — and since Stage D these actually SAVE.

   Every input here used to write to CONFIG in memory and nothing else, so the
   fold looked like it worked and lost everything on reload. It sat directly
   beside the at-risk fold, which did save, with nothing on screen saying which
   was which — worse than either bug alone. `loyalty.*` is open in
   CONFIG_WRITABLE now and every control below goes through PUT /api/config. */
function loyaltyCard() {
  var mode = CONFIG.LOYALTY_MODE || 'points';
  var block = DB.redeemBlock();
  var meta = t('ly_mode_' + mode);
  if (DB.pointsOn()) {
    meta += ' · <span dir="ltr">' + CONFIG.LOYALTY_POINTS_PER_1000 + ' / 1,000</span>';
  }
  if (DB.stampsOn()) {
    meta += ' · <span dir="ltr">' + nf(CONFIG.STAMPS_REQUIRED) + '</span> ' + t('ly_stamps').toLowerCase();
  }

  var h = setFoldStart('loyalty', t('loyalty_rules'), meta) + '<div class="card-body">';

  /* Which scheme the shop runs. Every screen reads this, so the shop can
     start on stamps alone and turn points on later with no deploy. */
  h += '<label class="field"><span>' + t('ly_mode') + '</span>' +
    '<select class="inp" data-change="set-lymode">' +
      ['points', 'stamps', 'both', 'off'].map(function (m) {
        return '<option value="' + m + '"' + (mode === m ? ' selected' : '') + '>' +
          t('ly_mode_' + m) + '</option>';
      }).join('') +
    '</select></label>';

  if (DB.pointsOn()) {
    h += '<div class="row2 mt">' +
      '<label class="field"><span>' + t('points_per') + '</span><input class="inp num" type="number" min="0" ' +
        'value="' + CONFIG.LOYALTY_POINTS_PER_1000 + '" data-change="set-pts"></label>' +
      '<label class="field"><span>' + t('point_value') + '</span><input class="inp num" type="number" min="0" ' +
        'value="' + CONFIG.LOYALTY_POINT_VALUE + '" data-change="set-ptval"></label>' +
    '</div>' +
    '<label class="field mt"><span>' + t('ly_block') + '</span>' +
      '<input class="inp num" type="number" min="1" value="' + block + '" data-change="set-lyblock"></label>' +
    '<div class="partner-note">' + nf(block) + ' ' + t('points') + ' = ' + money(block * CONFIG.LOYALTY_POINT_VALUE) + '</div>' +
    '<div class="mt"><div class="lbl">' + t('tier') + '</div>' +
      '<span class="badge bronze">' + t('bronze') + ' 0–' + nf(CONFIG.TIER_SILVER - 1) + '</span> ' +
      '<span class="badge silver">' + t('silver') + ' ' + nf(CONFIG.TIER_SILVER) + '–' + nf(CONFIG.TIER_GOLD - 1) + '</span> ' +
      '<span class="badge gold">' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD) + '+</span></div>';
  }

  if (DB.stampsOn()) {
    h += '<div class="row2 mt">' +
      '<label class="field"><span>' + t('ly_required') + '</span><input class="inp num" type="number" min="1" max="99" ' +
        'value="' + nf(CONFIG.STAMPS_REQUIRED) + '" data-change="set-lyreq"></label>' +
      '<label class="field"><span>' + t('ly_per') + '</span>' +
        '<select class="inp" data-change="set-lyper">' +
          '<option value="item"' + (CONFIG.STAMPS_PER === 'item' ? ' selected' : '') + '>' + t('ly_per_item') + '</option>' +
          '<option value="visit"' + (CONFIG.STAMPS_PER === 'visit' ? ' selected' : '') + '>' + t('ly_per_visit') + '</option>' +
        '</select></label>' +
    '</div>' +
    '<div class="partner-note">' + t('ly_stamps_note') + '</div>';
  }

  return h + '</div>' + setFoldEnd();
}

/* How many days without a purchase before a customer counts as at risk.
   One number, but it moves the red badge, the risk filter, the dashboard
   nudge and the "active customers" KPI everywhere at once — and unlike the
   loyalty inputs above it, it is SAVED: set-atrisk writes it through
   PUT /api/config, so it holds across reloads and machines. */
function customersCard() {
  var d = DB.atRiskDays();
  return setFoldStart('customers', t('cu_atrisk_title'),
      '<span dir="ltr">' + d + '</span> ' + t('days')) +
    '<div class="card-body">' +
    '<label class="field"><span>' + t('cu_atrisk_days') + '</span>' +
      '<input class="inp num" id="setAtRisk" type="number" min="1" max="3650" value="' + d + '" data-change="set-atrisk"></label>' +
    '<div class="partner-note">' + t('cu_atrisk_note') + '</div>' +
    '</div>' + setFoldEnd();
}

/* The escape hatch for a laggy projector or a remote-desktop demo. Writes
   body[data-motion], which the reduced-motion rules already honour, so no
   screen needs to know about it. */
function motionCard() {
  var moOff = document.body.getAttribute('data-motion') === 'off';
  return setFoldStart('motion', t('mo_title'), t(moOff ? 'set_off' : 'set_on')) +
    '<div class="card-body">' +
      '<div class="rule-row"><div class="rr-txt"><b>' + t('mo_animations') + '</b>' +
        '<small>' + t('mo_hint') + '</small></div>' +
        '<label class="switch"><input type="checkbox"' + (moOff ? '' : ' checked') +
          ' data-change="set-motion"><i></i></label></div>' +
    '</div>' + setFoldEnd();
}

function remSwitch(id, key, isOn, sub) {
  return '<div class="rule-row"><div class="rr-txt"><b>' + t('rem_' + id) + '</b>' +
    '<small>' + (sub || t('rem_' + id + '_sub')) + '</small></div>' +
    '<label class="switch"><input type="checkbox"' + (isOn ? ' checked' : '') +
      ' data-change="set-reminder" data-k="' + key + '"><i></i></label></div>';
}

function remNumField(spec) {
  return '<label class="field"><span>' + t('rem_n_' + spec[0]) + '</span>' +
    '<input class="inp num" type="number" min="' + spec[1] + '" max="' + spec[2] + '"' +
    ' value="' + remNum(spec[0], '') + '" data-change="set-reminder-num" data-k="' + spec[0] + '"></label>';
}

function remGroup(name) {
  var h = '<h4 class="set-h mt">' + t('rem_g_' + name) + '</h4>';
  REMINDER_RULES.forEach(function (r) {
    if (r[1] === name) h += remSwitch(r[0], r[0], remOn(r[0]));
  });
  var nums = REMINDER_NUMS[name] || [];
  if (nums.length) {
    h += '<div class="row2">';
    nums.forEach(function (spec) { h += remNumField(spec); });
    h += '</div>';
  }
  return h;
}

/* One card for a thing that runs while nobody is looking, so it has to say
   three things a switch cannot: WHAT CLOCK it is on, WHEN it will next speak,
   and WHAT IT WOULD SAY RIGHT NOW. The last is the preview, and it is why
   this can be tried on a real shop without anybody's phone buzzing. */
/* The line the head carries while the body is shut — how many of the
   seventeen are on, and the clock they are on. Patched in place by
   `set-reminder` rather than re-rendered: half this fold holds typed values. */
function remMetaText() {
  var count = REMINDER_RULES.filter(function (r) { return remOn(r[0]); }).length;
  return '<span dir="ltr">' + count + ' / ' + REMINDER_RULES.length + '</span>' +
         ' · <span dir="ltr">' + remShopClock() + '</span>';
}

function remindersCard() {
  var h = setFoldStart('reminders', t('reminders'),
    '<span id="remMeta">' + remMetaText() + '</span>');
  h += '<div class="card-body">';

  h += remSwitch('enabled', 'enabled', remOn('enabled'), t('rem_enabled_sub'));

  /* THE CLOCK, AND A WAY TO FIX IT. The device's own offset is offered only
     when it disagrees — a button that always sits there inviting a change is
     a button somebody presses on a phone in another country. */
  var devOff = -new Date().getTimezoneOffset();
  h += '<div class="rule-row"><div class="rr-txt"><b>' + t('rem_tz') + '</b>' +
    '<small>' + t('rem_tz_sub').replace('{clock}', '<span dir="ltr">' + remShopClock() + '</span>') + '</small></div>' +
    (devOff === CONFIG.TZ_MINUTES ? '<span class="muted small">' + t('rem_tz_ok') + '</span>'
      : '<button class="btn btn-ghost btn-sm" data-act="rem-tz-device" data-tz="' + devOff + '">' +
        t('rem_tz_use_device') + '</button>') +
    '</div>';

  h += '<div class="row2">' +
    remNumField(['quiet_from', 0, 23]) + remNumField(['quiet_to', 0, 23]) + '</div>' +
    '<div class="partner-note">' + t('rem_quiet_note') + '</div>';

  h += remGroup('day');
  h += remGroup('stock');
  h += remGroup('print');

  /* Yalla Wear's five, with OG's master pause above them. The switches
     themselves are ONE key each and the partner writes the same ones from
     their portal — last write wins, deliberately, rather than a second set of
     keys that could disagree about one switch. The pause is OG's alone. */
  h += '<h4 class="set-h mt">' + t('rem_g_yl') + '</h4>';
  h += remSwitch('yalla_paused', 'yalla_paused', CONFIG.REMINDERS.yalla_paused === '1',
                 t('rem_yalla_paused_sub'));
  REMINDER_RULES.forEach(function (r) {
    if (r[1] === 'yl') h += remSwitch(r[0], r[0], remOn(r[0]));
  });
  h += '<div class="row2">' + remNumField(REMINDER_NUMS.yl[0]) + '</div>';
  h += '<div class="partner-note">' + t('rem_yl_note') + '</div>';

  h += '<div id="remHost" class="mir-host mt">' + t('rem_loading') + '</div>';
  h += '</div>';
  return h + setFoldEnd();
}

/* ---- what it would say right now ------------------------------------------
   A list of rule names is not something anybody can judge. The preview asks
   the server to evaluate every rule and render the message WITHOUT queueing
   it, so the nightly close can be read at two in the afternoon and a wrong
   time zone shows up as a digest dated the wrong day rather than as silence.
   POST, because it computes; it writes nothing. */
var RemindersUI = (function () {
  var last = null;

  function can() {
    return typeof Auth !== 'undefined' && Auth.can('config.write') &&
           typeof Shop !== 'undefined' && Shop.live();
  }

  function paint(s) {
    if (s) last = s;
    var host = document.getElementById('remHost');
    if (!host || !last) return;
    var h = '';

    /* Why nothing is going out, when nothing is going out. Ordered by how
       permanent the reason is, so the line names the thing to act on. */
    ['og', 'yalla'].forEach(function (side) {
      var why = last.skipped && last.skipped[side];
      if (!why) return;
      h += '<div class="mir-state warn"><span class="mir-dot warn"></span><div>' +
        '<div class="mir-line"><span dir="auto">' +
        t('rem_skip_' + why).replace('{side}', t(side === 'og' ? 'rem_side_og' : 'rem_side_yl')) +
        '</span></div></div></div>';
    });

    var nd = last.nextDaily || {};
    if (nd.day_close && nd.day_close.on) {
      h += '<div class="mir-fact"><div class="muted small">' + t('rem_next_close') + '</div>' +
        '<div><span dir="ltr">' + esc(String(nd.day_close.hour) + ':00') + '</span></div></div>';
    }
    if (nd.yl_digest && nd.yl_digest.on) {
      h += '<div class="mir-fact"><div class="muted small">' + t('rem_next_digest') + '</div>' +
        '<div><span dir="ltr">' + esc(String(nd.yl_digest.hour) + ':00') + '</span></div></div>';
    }

    var broken = [];
    Object.keys(last.byRule || {}).forEach(function (id) {
      if (last.byRule[id].error) broken.push(id + ': ' + last.byRule[id].error);
    });
    if (broken.length) {
      h += '<div class="mir-state bad"><span class="mir-dot bad"></span><div>' +
        '<div class="mir-line"><span dir="auto">' + esc(broken.join(' · ')) + '</span></div></div></div>';
    }

    if (last.preview) {
      if (!last.preview.length) {
        h += '<div class="muted small mt">' + t('rem_preview_none') + '</div>';
      } else {
        h += '<div class="muted small mt">' + t('rem_preview') + '</div>';
        last.preview.forEach(function (r) {
          h += '<div class="rem-prev"><div class="muted small">' + esc(r.rule) + '</div>' +
            '<div dir="auto">' + esc(r.text).replace(/\n/g, '<br>') + '</div></div>';
        });
      }
    }

    h += '<div class="mir-act">' +
      '<button class="btn btn-ghost btn-sm" data-act="rem-preview">' + t('rem_preview_btn') + '</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="rem-run">' + t('rem_run') + '</button></div>';
    host.innerHTML = h;
  }

  function load() {
    var host = document.getElementById('remHost');
    if (!host) return;
    if (!can()) { host.innerHTML = '<div class="muted">' + t('rem_notconf') + '</div>'; return; }
    API.get('/api/reminders/status')
      .then(function (r) { paint(r.status); })
      .catch(function () { host.innerHTML = '<div class="muted">' + t('rem_notconf') + '</div>'; });
  }

  function preview() {
    return API.post('/api/reminders/preview', {}).then(function (r) {
      if (last) { last.skipped = r.skipped; last.byRule = r.byRule; }
      else last = { skipped: r.skipped, byRule: r.byRule, nextDaily: {} };
      last.preview = r.rows || [];
      paint();
      return r;
    });
  }

  return { load: load, paint: paint, preview: preview };
})();

/* The Telegram line — the shop's own bot, linked to a person or a staff
   group. The card itself is drawn by YALLA.telegramCard, because the partner
   portal shows the very same card for their bot; only the words differ. The
   body loads in afterSettings, like the roles grid — a shut fold still binds. */
/* ---- the Supabase mirror -------------------------------------------------
   Where the copy of the shop is up to. The server pushes every change a
   couple of seconds after it lands and reports itself on the live channel
   after each push (pulse.js hands the payload to MirrorUI.paint), so the
   fold is repainted without asking; a slow poll while Settings is open is
   the backstop for a tab whose line is down. The same painter colours the
   dot on the topbar's Sync button, so a stuck mirror is visible from every
   screen without opening this one.

   The sentences mix Arabic words with digits, so they sit in dir="auto" —
   forcing LTR reorders the phrase, and forcing nothing lets a leading number
   drift to the far end. */
var MirrorUI = (function () {
  var last = null;
  var pollT = null;
  var tickT = null;

  function can() {
    return typeof Auth !== 'undefined' && Auth.can('config.write') &&
           typeof Shop !== 'undefined' && Shop.live();
  }

  function ago(iso) {
    if (!iso) return null;
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return t('mir_ago_s').replace('{n}', s);
    if (s < 3600) return t('mir_ago_m').replace('{n}', Math.round(s / 60));
    return t('mir_ago_h').replace('{n}', Math.round(s / 3600));
  }

  function until(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  }

  /* One verdict for the head, the dot and the first line of the body. */
  function verdict(s) {
    if (!s || !s.configured) return { tone: 'off', text: t('mir_notconf') };
    if (s.mode === 'off') return { tone: 'off', text: t('mir_off') };
    if (s.mode === 'starting') return { tone: 'wait', text: t('mir_starting') };
    if (s.mode === 'refused') {
      return { tone: 'bad', text: t('mir_refused').replace('{host}', s.refusedBy || t('mir_nobody')) };
    }
    if (s.mode === 'offline') {
      var w = until(s.nextRetryAt);
      return { tone: 'bad', text: t('mir_offline').replace('{n}', w), why: s.lastError };
    }
    if (s.running) return { tone: 'wait', text: t('mir_pushing') };
    if (s.lastError && s.failures > 0) {
      return { tone: 'warn', text: t('mir_retry').replace('{n}', until(s.nextRetryAt)), why: s.lastError };
    }
    if (s.behind > 0) return { tone: 'warn', text: t('mir_waiting').replace('{n}', s.behind) };
    var when = ago(s.lastPushAt || s.lastOkAt);
    return { tone: 'ok', text: when ? t('mir_instep').replace('{ago}', when) : t('mir_instep_never') };
  }

  function paint(s) {
    if (s) last = s;
    s = last;
    if (!s) return;
    var v = verdict(s);

    document.querySelectorAll('.sync-btn').forEach(function (b) {
      b.setAttribute('data-mode', v.tone);
      b.title = t('sync_now') + ' · ' + v.text;
    });

    var meta = document.getElementById('mirMeta');
    if (meta) meta.innerHTML = '<span class="mir-dot ' + v.tone + '"></span><span dir="auto">' + esc(v.text) + '</span>';

    var host = document.getElementById('mirHost');
    if (!host) return;
    var h = '<div class="mir-state ' + v.tone + '"><span class="mir-dot ' + v.tone + '"></span>' +
      '<div><div class="mir-line"><span dir="auto">' + esc(v.text) + '</span></div>' +
      (v.why ? '<div class="muted small mt-xs"><span dir="auto">' + esc(v.why) + '</span></div>' : '') +
      '</div></div>';
    h += pullLine(s.pull);
    h += '<div class="mir-facts">';
    h += fact(t('mir_last_push'), s.lastPushAt ? ago(s.lastPushAt) : t('mir_never'));
    h += fact(t('mir_behind'), s.behind === null || s.behind === undefined ? '—' : String(s.behind));
    h += fact(t('mir_last_full'), s.lastFullAt
      ? ago(s.lastFullAt) + (s.lastFullOk === false ? ' · ' + t('mir_full_skipped') : '')
      : t('mir_never'));
    h += fact(t('mir_full_every'), t('mir_minutes').replace('{n}', s.fullEveryMinutes));
    h += '</div>';
    h += '<div class="mir-act"><button class="btn btn-ghost btn-sm" data-act="sync-now">' + t('sync_now') + '</button>' +
         '<span class="muted small">' + t('mir_how') + '</span></div>';
    host.innerHTML = h;
  }

  function fact(label, value) {
    return '<div class="mir-fact"><div class="muted small">' + label + '</div>' +
           '<div><span dir="auto">' + esc(value) + '</span></div></div>';
  }

  /* The boot pull's own line: what this laptop did with the cloud copy when
     the server started, or why it did not (lib/restore.js — the baton).
     Absent on a server from before it, and silent when the pull is simply
     off. Numbers sit in dir="ltr" or Arabic drags them to the far end. */
  function pullLine(p) {
    if (!p || p.reason === 'disabled' || p.reason === 'not_configured') return '';
    var ltr = function (n) { return '<span dir="ltr">' + esc(String(n)) + '</span>'; };
    var text, why = '', tone;
    if (p.did) {
      text = t('mir_pulled').replace('{n}', ltr(p.rows || 0)).replace('{ago}', ago(p.at) || '');
      if (p.from && p.from.host) text += ' · ' + t('mir_pull_from').replace('{host}', esc(p.from.host));
      if (p.warning) why = t('mir_pull_warning_' + p.warning);
      tone = p.warning ? 'warn' : 'ok';
    } else {
      var d = p.detail || {};
      var key = 'mir_pull_' + p.reason;
      var w = t(key);
      if (w === key) w = esc(p.message || p.reason);
      w = w.replace('{host}', esc(d.host || (p.from && p.from.host) || ''))
           .replace('{n}', ltr(d.n || 0))
           .replace('{file}', esc((d.files && d.files[0]) || 'server/supabase/CATCH-UP.sql'));
      text = t('mir_pull_none').replace('{why}', w);
      tone = (p.reason === 'own_lineage' || p.reason === 'mirror_empty') ? 'ok' : 'warn';
    }
    return '<div class="mir-state mir-pull ' + tone + '"><span class="mir-dot ' + tone + '"></span><div>' +
      '<div class="muted small">' + t('mir_pull') + '</div>' +
      '<div class="mir-line"><span dir="auto">' + text + '</span></div>' +
      (why ? '<div class="muted small mt-xs"><span dir="auto">' + esc(why) + '</span></div>' : '') +
      (p.did && p.backup ? '<div class="muted small mt-xs">' + ltr(t('mir_pull_backup').replace('{file}', p.backup)) + '</div>' : '') +
      '</div></div>';
  }

  function load() {
    var host = document.getElementById('mirHost');
    stop();
    if (!host) return;
    if (!can()) { host.innerHTML = '<div class="muted">' + t('mir_notconf') + '</div>'; return; }
    fetchNow();
    /* The live channel does the real work; this only covers a tab whose
       line is down, and the countdowns need a clock while the fold is open. */
    pollT = setInterval(function () {
      if (!document.getElementById('mirHost')) return stop();
      fetchNow();
    }, 15000);
    tickT = setInterval(function () {
      if (!document.getElementById('mirHost')) return stop();
      paint();
    }, 1000);
  }

  function fetchNow() {
    API.get('/api/sync/status').then(function (r) { paint(r.status); }).catch(function () { /* the last known state stays */ });
  }

  function stop() {
    if (pollT) { clearInterval(pollT); pollT = null; }
    if (tickT) { clearInterval(tickT); tickT = null; }
  }

  return { paint: paint, load: load, stop: stop, fetchNow: fetchNow };
})();

function mirrorCard() {
  var h = setFoldStart('mirror', t('mir_title'),
    '<span id="mirMeta" class="muted">' + t('mir_loading') + '</span>');
  h += '<div class="card-body"><div id="mirHost" class="mir-host">' + t('mir_loading') + '</div>' +
    '<div class="muted small mt">' + t('mir_note') + '</div></div>';
  return h + setFoldEnd();
}

function telegramCard() {
  var h = setFoldStart('telegram', t('tg_title'),
    '<span id="tgMeta" class="muted">' + t('tg_loading') + '</span>');
  h += '<div class="card-body"><div id="tgHost" class="tg-host">' + t('tg_loading') + '</div>' +
    '<div class="muted small mt">' + t('tg_partner_note') + '</div></div>';
  return h + setFoldEnd();
}

/* Eleven folds under five headings, in the order somebody actually walks in
   here: the shop's own numbers first, then the machines it prints on, then
   the warehouse, then people, then the two switches nobody touches twice a
   year. The old two-column .set-grid is gone — with the bodies shut, a grid
   of heads reads as a wall of tiles, and a single column reads as a list. */
function viewSettings() {
  var h = '<div class="page-head"><div><h1>' + t('settings_title') + '</h1>' +
    '<div class="sub">' + t('settings_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<button class="btn btn-ghost btn-sm" data-act="set-folds" data-k="open">' + t('set_expand') + '</button>' +
      exportButtons() +
      '<button class="btn btn-primary" data-act="settings-save">' + t('save_changes') + '</button></div></div>';

  h += '<div class="set-list">';

  h += setSection(t('setg_shop'));
  h += brandingCard();
  h += rateCard();
  h += loyaltyCard();
  h += customersCard();

  h += setSection(t('setg_print'));
  h += receiptSettingsCard();
  h += thermalLabelsCard();
  h += hardwareCard();

  h += setSection(t('setg_wh'));
  h += shelvesCard();

  h += setSection(t('setg_people'));
  h += presenceCard();
  h += rolesCard();

  h += setSection(t('setg_system'));
  if (allow('config.write')) h += mirrorCard();
  h += telegramCard();
  /* The same gate as the mirror: these are switches on a thing that sends
     messages to phones outside this building, and the routes behind them are
     config.write anyway — a card that draws and then refuses to save is
     worse than a card that is not there. */
  if (allow('config.write')) h += remindersCard();
  h += motionCard();

  h += '</div>';
  return h;
}
