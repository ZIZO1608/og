/* ==========================================================================
   OG SYSTEM — application shell  ·  16/17: CHANGES dispatch table + focusBack
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 7482-7638). Loads after
   app-actions.js. `bindGlobal()` (app-boot.js) reads/writes into CHANGES,
   which must already exist when it is registered.
   ========================================================================== */

var CHANGES = {
  /* Modal-scoped, so it updates the results div directly rather than
     going through the app-wide render() — the modal lives outside #app,
     a full render() would never touch it. */
  'attach-search': function (el) {
    var host = document.getElementById('attachSearchResults');
    if (!host) return;
    host.innerHTML = attachResultsHTML(el.value, host.getAttribute('data-code'));
  },
  /* The Reports screen's custom range. Debounced, because `input` fires on a
     date box while the year is still being typed — "0202-03-01" is a valid
     date the server will happily answer, and answering it is a round trip and
     a repaint for a number the person is halfway through changing. Both boxes
     must be complete before anything is asked for: one of them is not a range.

     Not repainting on the keystroke is deliberate too. The boxes hold their
     own values, and a render() mid-type would rebuild the input being typed
     into and take the caret with it — the exact trick focusBack exists to
     undo two lines below. */
  'rep-dates': function () {
    var a = document.getElementById('repFrom'), b = document.getElementById('repTo');
    OG.repFrom = a ? a.value : '';
    OG.repTo = b ? b.value : '';
    clearTimeout(CHANGES._repTimer);
    if (!(OG.repFrom && OG.repTo)) return;
    CHANGES._repTimer = setTimeout(function () {
      if (OG.view === 'reports') reloadReportsInto();
    }, 400);
  },

  'prod-q': function (el) { OG.prod.q = el.value; render(); focusBack('[data-change="prod-q"]', el.value.length); },
  'prod-type': function (el) { OG.prod.type = el.value; render(); },
  'prod-health': function (el) { OG.prod.health = el.value; render(); },
  'prod-arch': function (el) { OG.prod.arch = el.value; render(); },
  /* 066 — products whose photos are not all there, or are. */
  'prod-photos': function (el) { OG.prod.photos = el.value; render(); },

  /* The live line under the price box — never a render: the box holds a
     caret and half a number. */
  'pq-price': function () { quickPriceHint(); },
  /* 067 — the product editor's dollar boxes: the lira line under the box. */
  'pe-lira': function (el) {
    var hint = document.getElementById(el.id + 'Lira');
    if (hint) hint.innerHTML = liraHint(usdCents(el.value));
  },
  /* Repaints the grid and the count only, so the box being typed into is
     never rebuilt and the caret stays put with no focusBack trick. */
  'cust-q': function (el) { OG.cust.q = el.value; repaintCustomers(); },

  /* The attach-a-customer picker. Modal-scoped, so it patches its own
     results div rather than going through render() — the modal lives outside
     #view and a full render would never touch it. */
  'sa-q': function (el) { saPaint(el.value); },
  'cu-merge-q': function (el) { mergePaint(el.value); },
  'pj-q': function (el) { pjPaint(el.value); },
  'cust-sort': function (el) { OG.cust.sort = el.value; repaintCustomers(); },

  /* Label-printing filters — same shape as prod-q/prod-type above, kept in
     their own OG.lbf bucket so narrowing the print picker never touches the
     Products screen's own filter state. */
  'lbf-q': function (el) { OG.lbf.q = el.value; render(); focusBack('[data-change="lbf-q"]', el.value.length); },
  'lbf-type': function (el) { OG.lbf.type = el.value; render(); },
  'lbf-wh': function (el) { OG.lbf.wh = el.value; render(); },
  'lbf-stock': function (el) { OG.lbf.stock = el.value; render(); },

  /* The Print Labels table's per-row print quantity — set inline, before or
     after ticking the bulk checkbox. No render() call, same reasoning as
     qlp-qty right below: a full table repaint mid-keystroke would rebuild
     this input and drop focus. */
  /* rememberMoveWay(): which way this machine carries stock, kept per machine
     so ten trips the same way do not mean ten presses of the swap button. */
  'ms-from': function (el) { if (moveScan) { moveScan.from = el.value; rememberMoveWay(); moveScanRepaint(); } },
  'ms-to':   function (el) { if (moveScan) { moveScan.to = el.value; rememberMoveWay(); moveScanRepaint(); } },
  /* Typed over, not scanned: clamped to something sane, and 0 means remove. */
  'ms-qty': function (el) {
    if (!moveScan) return;
    var sku = el.getAttribute('data-sku');
    var n = Math.max(0, Math.min(99, parseInt(el.value, 10) || 0));
    if (!n) moveScan.lines = moveScan.lines.filter(function (l) { return l.sku !== sku; });
    else moveScan.lines.forEach(function (l) { if (l.sku === sku) l.qty = n; });
    moveScanRepaint();
  },

  'lb-qty': function (el) {
    OG.lbQty = OG.lbQty || {};
    OG.lbQty[el.getAttribute('data-sku')] = Math.max(1, Math.min(99, parseInt(el.value, 10) || 1));
  },

  /* The quick label picker's per-size qty. Patches only the modal footer's
     live count, not the whole body — a full repaint would rebuild this very
     input mid-keystroke and drop focus, the same reasoning focusBack exists
     for elsewhere. */
  'qlp-qty': function (el) {
    if (!quickPick) return;
    var sku = el.getAttribute('data-sku');
    quickPick.sel[sku] = Math.max(1, Math.min(99, parseInt(el.value, 10) || 1));
    var foot = document.querySelector('.modal-foot');
    if (foot) foot.innerHTML = quickPickerFootHTML();
  },

  'toggle-visible': function (el) {
    /* THE MARKETING WEBSITE, and only that. This switch used to write
       `hidden`, which is the ARCHIVE flag — so turning a product off the site
       took it out of the catalogue screen and out of every stock figure, and
       the row vanished under the finger that had just moved it. Migration 039
       gave the website a column of its own. Archiving is the Archive action in
       the bulk bar, and it still means "the shop has stopped selling this".

       The column is not drawn without product.write, so reaching this is
       either a stale screen or someone poking at it — either way, put the
       switch back rather than showing a change the server will not keep. */
    if (!allow('product.write')) { el.checked = !el.checked; return; }
    var p = DB.product(+el.getAttribute('data-id'));
    p.onWeb = !!el.checked;
    /* Optimistic: the switch has already moved under the finger, and waiting
       for a round trip before it settles reads as a broken toggle. */
    if (typeof Shop !== 'undefined' && Shop.live()) {
      Shop.setProductWeb(p.id, p.onWeb)
        .then(function () { return Shop.reload(); })
        .catch(function (err) {
          el.checked = !el.checked;
          p.onWeb = !p.onWeb;
          toast(p.name, API.friendly(err), 'err', 6000);
        });
    }
    toast(p.name, p.onWeb
      ? (OG.lang === 'ar' ? 'ظاهر على الموقع' : 'Showing on the website')
      : (OG.lang === 'ar' ? 'مخفي عن الموقع' : 'Hidden from the website'), 'ok', 2000);
  },

  'wh-type': function (el) { OG.wh.type = el.value; OG.wh.sizes = {}; render(); },
  'wh-name': function (el) { OG.wh.name = el.value; },

  /* Brand, made in and the colourway (ns02). All three were plain <input>s
     with no id and no data-change: `wh-save` never read them, the POST body
     carried none of them, and anything typed was thrown away without a word.
     They round-trip through OG.wh now, like the name, so a render cannot lose
     them either. */
  'wh-brand':    function (el) { OG.wh.brand = el.value; },
  'wh-made':     function (el) { OG.wh.madeIn = el.value; },
  'wh-colorway': function (el) { OG.wh.colorway = el.value; },

  /* Changing the room cannot leave the shelf choice standing: a shelf reaches
     its warehouse through its section, and a shelf id from the other building
     comes back as `wrong_warehouse` (server/lib/shelves.js:959) — by which
     time the product has already been created.

     Repaints the one select rather than calling render(). Since ns02 every
     box on this form round-trips through OG.wh, so a render here would no
     longer lose a typed price — but rebuilding the whole screen to change one
     select is still the wrong amount of work, and the shelf list is refilled
     asynchronously underneath it. */
  'wh-warehouse': function (el) {
    OG.wh.whId = el.value;
    OG.wh.shelfId = '';
    fillWhShelves();
  },
  'wh-shelf': function (el) { OG.wh.shelfId = el.value; },
  /* Was a full render() on every keystroke, which rebuilt the page, lost the
     caret and threw the scroll back to the top — while somebody was still
     typing. Now only the parts that actually depend on the number change,
     and the box being typed into is never replaced, so the caret stays put
     with no focus-restoring trick needed. */
  'wh-size': function (el) {
    var s = el.getAttribute('data-size');
    OG.wh.sizes[s] = el.value === '' ? '' : Math.max(0, parseInt(el.value, 10) || 0);
    repaintWhAdd();
  },
  /* The price and cost boxes. They keep their value on OG.wh now rather than
     living in the markup, so this stores first and then repaints only the
     preview column — the whole screen no longer has to be rebuilt to change
     one total, and the caret needs no restoring because the box being typed
     into is not replaced. */
  'wh-recalc': function (el) {
    if (el.id === 'whCost') OG.wh.cost = el.value;
    else OG.wh.price = el.value;
    /* 067 — the lira it comes to, under the box; only that line is written. */
    var hint = document.getElementById(el.id + 'Lira');
    if (hint) hint.innerHTML = liraHint(usdCents(el.value));
    repaintWhAdd();
  },

  /* Settings that actually apply. Every one of these used to be an input that
     accepted typing and threw it away, behind a Save button that said
     "Settings saved". They now write to CONFIG / PERMISSIONS, which is what
     the rest of the app reads, so a change is visible immediately everywhere.

     There is no separate "save" step because there is nothing to save to —
     state lives in memory by design. Save now just confirms what is already
     true, which is the honest version of that button. */
  /* ---- loyalty ----------------------------------------------------------
     These SAVE now. Every one of them used to write to CONFIG and nothing
     else, so the fold looked like it worked and lost the lot on reload —
     while the at-risk fold immediately below it did save, with nothing on
     screen saying which was which.

     saveConfig() is the shared debounced writer: 600ms, so "180" typed as
     1, 18, 180 is one round trip rather than three. */
  'set-pts': function (el) {
    var v = parseFloat(el.value);
    if (!isFinite(v) || v < 0) return;
    CONFIG.LOYALTY_POINTS_PER_1000 = v;
    saveConfig('loyalty.points_per_1000', v, t('loyalty_rules'));
  },
  'set-ptval': function (el) {
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 0) return;
    CONFIG.LOYALTY_POINT_VALUE = v;
    saveConfig('loyalty.point_value', v, t('loyalty_rules'));
  },
  'set-lyblock': function (el) {
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 1) return;
    CONFIG.REDEEM_BLOCK = v;
    saveConfig('loyalty.redeem_block', v, t('ly_block'));
  },
  'set-lyreq': function (el) {
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 1 || v > 99) return;
    CONFIG.STAMPS_REQUIRED = v;
    saveConfig('loyalty.stamps.required', v, t('ly_required'));
  },
  /* A select, so it settles on one value — saved immediately rather than
     debounced, and re-rendered because the mode decides which controls the
     fold even draws. */
  'set-lyper': function (el) {
    CONFIG.STAMPS_PER = el.value === 'visit' ? 'visit' : 'item';
    saveConfig('loyalty.stamps.per', CONFIG.STAMPS_PER, t('ly_per'), 0);
  },
  'set-lymode': function (el) {
    var v = el.value;
    if (['points', 'stamps', 'both', 'off'].indexOf(v) < 0) return;
    CONFIG.LOYALTY_MODE = v;
    saveConfig('loyalty.mode', v, t('ly_mode'), 0);
    render();
  },
  /* THESE FOUR SAVE THEMSELVES NOW (ns03). They went out only when somebody
     found "Save changes" in the page head, beside eight cards that saved on
     change — and the receipt's header is printed from exactly these four. */
  'set-shopname': function (el) {
    var v = String(el.value || '').trim();
    if (!v) return;                       /* never let the shop become nameless */
    CONFIG.SHOP_NAME = v;
    renderSidebar(); renderTopbar();
    saveSetting('shop.name', v);
  },
  'set-addr': function (el) {
    CONFIG.SHOP_ADDRESS = String(el.value || '');
    saveSetting('shop.address', CONFIG.SHOP_ADDRESS);
  },
  'set-city': function (el) {
    CONFIG.SHOP_CITY = String(el.value || '');
    saveSetting('shop.city', CONFIG.SHOP_CITY);
  },
  'set-phone': function (el) {
    CONFIG.SHOP_PHONE = String(el.value || '');
    saveSetting('shop.phone', CONFIG.SHOP_PHONE);
  },
  /* The website's print price, whole lira, through the one counted-figure
     parser (Arabic digits, a thousands comma). Nothing below 1 is sent. */
  'set-webprint': function (el) {
    var v = Desk.toCount(el.value);
    if (!(v > 0)) return;
    CONFIG.WEB_PRINT_PRICE = v;
    saveSetting('print.unit_price', v);
  },
  'set-motion': function (el) {
    if (el.checked) document.body.removeAttribute('data-motion');
    else document.body.setAttribute('data-motion', 'off');
    /* Re-arm or tear down the sidebar dock, which holds its own state. */
    if (typeof Motion !== 'undefined') Motion.dock();
    toast(t('mo_title'), t(el.checked ? 'mo_on' : 'mo_off'), 'ok', 2200);
  },

  /* One tick box in the roles grid. Updates the local matrix, then saves that
     whole role — so a fast series of clicks settles on the last state rather
     than racing several half-descriptions of it. */
  'set-perm': function (el) {
    if (!ROLE_MATRIX) return;
    var role = el.getAttribute('data-role');
    var perm = el.getAttribute('data-perm');

    var row = ROLE_MATRIX.permissions.filter(function (p) { return p.perm === perm; })[0];
    if (!row || !row.roles[role]) return;
    row.roles[role].allowed = el.checked;

    clearTimeout(ROLE_SAVE_T);
    ROLE_SAVE_T = setTimeout(function () { saveRolePermissions(role); }, 350);
  },

  /* Stock count inputs. Typing a number counts that size; clearing the box
     puts it back to "not counted", which is deliberately not the same as
     counting zero. */
  'st-set': function (el) {
    Stock.set(el.getAttribute('data-sku'), el.value);
    /* No re-render on every keystroke — it would blur the field being typed
       into. The variance column for this row is patched in place instead. */
    var row = el.closest('tr');
    var r = Stock.rows().filter(function (x) { return x.v.sku === el.getAttribute('data-sku'); })[0];
    if (row && r) {
      var cell = row.children[5];
      if (cell) {
        cell.innerHTML = r.has
          ? '<b class="' + (r.diff === 0 ? 'muted' : r.diff < 0 ? 'st-neg' : 'st-pos') + '">' +
              (r.diff > 0 ? '+' : '') + r.diff + '</b>'
          : '<span class="muted">—</span>';
      }
      row.className = !r.has ? '' : r.diff === 0 ? 'st-ok' : r.diff < 0 ? 'st-short' : 'st-over';
    }
  },
  'st-q': function (el) {
    Stock.state.q = el.value;
    render();
    focusBack('[data-change="st-q"]', el.value.length);
  },

  /* "Where is it?" — the find box on Stock by place (ns02). Same shape as
     st-q above: this panel is drawn by render(), so the box is rebuilt on
     every keystroke and the caret has to be put back by hand. */
  'wh-find': function (el) {
    OG.wh.find = el.value;
    render();
    focusBack('[data-change="wh-find"]', el.value.length);
  },

  /* The at-risk window, and the one Settings number that actually reaches
     the server: customer.at_risk_days goes through PUT /api/config (the
     route's allowlist admits customer.*), so it survives a reload and every
     till agrees on it. Debounced, because "180" typed as 1-18-180 must not
     fire three writes. The loyalty inputs above still write to memory only —
     a known, pre-existing gap; it is not made worse here. */
  'set-atrisk': function (el) {
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 1 || v > 3650) return;
    CONFIG.AT_RISK_DAYS = v;
    clearTimeout(ATRISK_SAVE_T);
    if (!API.live) return;
    ATRISK_SAVE_T = setTimeout(function () {
      API.put('/api/config', { updates: { 'customer.at_risk_days': String(v) } })
        .then(function () {
          toast(t('cu_atrisk_title'), v + ' ' + t('days'), 'ok', 2000);
        })
        .catch(function (err) {
          toast(t('cu_atrisk_title'), API.friendly(err), 'err', 5000);
        });
    }, 600);
  },

  /* ---- the automatic reminders (041) -------------------------------------
     Seventeen switches, five hours and a time zone, all writing config keys
     through the allowlist the same way the at-risk window does.

     NO render() ON A TOGGLE. Half this fold holds typed-but-unsaved numbers
     and a repaint takes them back to what the server last said, mid-sentence
     — the accordion's own rule. The head's count is patched in place instead.

     wait = 0 for a switch: it settles the moment it moves, and a tick that
     takes six hundred milliseconds to be believed feels broken. */
  'set-reminder': function (el) {
    var k = el.getAttribute('data-k');
    if (!k) return;
    var v = el.checked ? '1' : '0';
    CONFIG.REMINDERS[k] = v;
    if (typeof remMetaText === 'function') {
      var m = document.getElementById('remMeta');
      if (m) m.innerHTML = remMetaText();
    }
    saveConfig('reminders.' + k, v, t('reminders'), 0);
  },

  'set-reminder-num': function (el) {
    var k = el.getAttribute('data-k');
    if (!k) return;
    var v = parseInt(el.value, 10);
    var min = Number(el.getAttribute('min')), max = Number(el.getAttribute('max'));
    /* Out of range is a half-typed number, not a value: "1" on the way to
       "18" must not be saved and must not toast. */
    if (!isFinite(v) || v < min || v > max) return;
    CONFIG.REMINDERS[k] = String(v);
    saveConfig('reminders.' + k, v, t('reminders'));
  },

  /* The same switch, written from the partner's portal. A route of its own
     because their allow-list is narrower than the permission: they may move
     their own five and nothing else, and the server enforces that from the
     account's role rather than from the body. */
  'set-reminder-yl': function (el) {
    var k = el.getAttribute('data-k');
    if (!k || !API.live) return;
    var v = el.checked ? '1' : '0';
    CONFIG.REMINDERS[k] = v;
    var updates = {};
    updates['reminders.' + k] = v;
    API.put('/api/reminders/config', { updates: updates })
      .catch(function (err) {
        /* Put the switch back where the server thinks it is: a tick that
           stays down after a refusal is a promise the shop's bot did not make. */
        CONFIG.REMINDERS[k] = el.checked ? '0' : '1';
        el.checked = !el.checked;
        toast(t('reminders'), API.friendly(err), 'err', 5000);
      });
  },

  /* ---- the office's order alerts (052) -------------------------------------
     WHAT EACH ROLE HEARS, written into the same `reminders.preset.<role>` keys
     a phone already follows — one key with two writers (this grid and the
     per-chat picker), never a second set that could disagree.

     `null` MEANS EVERYTHING AND IS KEPT THAT WAY. The manager's preset is the
     string 'null', which is what makes a kind invented next month reach him
     without anybody re-ticking anything; an explicit list of today's kinds
     would silently exclude it. So a full row is stored back as null — the same
     rule the picker's Save follows — and only an actual gap is materialised. */
  'set-tgo-preset': function (el) {
    var role = el.getAttribute('data-role'), kind = el.getAttribute('data-k');
    var s = tgOfficeStatus();
    if (!role || !kind || !s) return;
    var all = (s.allKinds || []).slice();
    /* NO KIND LIST, NO WRITE. That list is what "everything" is measured
       against; saving against an empty one would store `[]` — every phone on
       that role switched off — and it would look on screen like one tick. */
    if (!all.length) { el.checked = !el.checked; return; }
    var cur = (s.presets || {})[role];
    var list = (cur === null || cur === undefined) ? all.slice() : cur.slice();
    var at = list.indexOf(kind);
    if (el.checked && at < 0) list.push(kind);
    if (!el.checked && at > -1) list.splice(at, 1);
    /* Everything ticked is stored as "everything", not as a frozen list. */
    var whole = all.length && list.length === all.length;
    s.presets[role] = whole ? null : list;
    saveConfig('reminders.preset.' + role, whole ? 'null' : JSON.stringify(list),
               t('tgo_title'), 0, t('role_' + role) + ' · ' + t('tgo_saved'), tgOfficeReload);
  },

  /* ANY HOUR, or wait for the shop to open. `alerts.urgent` is the short list
     of kinds worth a phone at three in the morning — a cancelled order, because
     it may be packed and about to leave. Written with the key spelled out
     rather than built from the box, so the config-keys test can see it. */
  'set-tgo-urgent': function (el) {
    var kind = el.getAttribute('data-k');
    var s = tgOfficeStatus();
    if (!kind || !s || !s.office) return;
    var list = (s.office.urgent || []).slice();
    var at = list.indexOf(kind);
    if (el.checked && at < 0) list.push(kind);
    if (!el.checked && at > -1) list.splice(at, 1);
    s.office.urgent = list;
    saveConfig('alerts.urgent', JSON.stringify(list), t('tgo_title'), 0,
               t('tgo_saved'), tgOfficeReload);
  },

  /* WHEN THE SHOP IS SHUT, on the shop's own clock (shop.tz_minutes). Out of
     range is a half-typed hour, not a value — the reminders' own rule. */
  'set-tgo-hour': function (el) {
    var k = el.getAttribute('data-k');
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 0 || v > 23) return;
    var s = tgOfficeStatus();
    if (s && s.office) s.office[k === 'quiet_to' ? 'quietTo' : 'quietFrom'] = v;
    if (k === 'quiet_to') saveConfig('alerts.quiet_to', v, t('tgo_title'), 600, String(v), tgOfficeReload);
    else saveConfig('alerts.quiet_from', v, t('tgo_title'), 600, String(v), tgOfficeReload);
  },

  /* Desk.toCount, NOT parseInt: parseInt("13,000") is 13, and the box used
     to be type=number, which blanks itself on a comma and refuses an Arabic
     keypad's digits outright. The rate is the one number every dollar price
     in the shop converts through. */
  /* SAVED WHEN THE PERSON IS DONE, NEVER AS IT IS TYPED (25 Sep 2026). The
     box carries data-on-commit, so this runs on Enter or on leaving it. It
     used to save 0.7 s after each key: on 24 Sep the live shop's rate went
     1 → 138 → 15 → 150 → 138 in a minute while somebody typed, and since
     067 every lira price follows this number and every open till re-prices
     on it. CONFIG moves only once the server has the rate. */
  'set-rate': function (el) {
    var v = Desk.toCount(el.value);
    if (!(v > 0) || v === CONFIG.EXCHANGE_RATE) { el.value = CONFIG.EXCHANGE_RATE; return; }
    saveRate(v, false);
  },

  /* The live feed's switches, on the same fold (FxFeedUI, js/app-settings.js).
     Each writes one fx.feed_* key through PUT /api/config; the side and the
     divisor change what the feed's number MEANS, so the card asks the feed
     again once the save has landed. */
  'fx-on': function (el) {
    saveSetting('fx.feed_on', el.checked ? '1' : '0', 0, FxFeedUI.check);
  },
  'fx-side': function (el) {
    saveSetting('fx.feed_side', el.value, 0, FxFeedUI.check);
  },
  'fx-minutes': function (el) {
    var v = Desk.toCount(el.value);
    if (!(v >= 1 && v <= 1440)) return;
    saveSetting('fx.feed_minutes', v, 700, FxFeedUI.reload);
  },
  'fx-scale': function (el) {
    var v = Desk.toCount(el.value);
    if (!(v >= 1)) return;
    saveSetting('fx.feed_scale', v, 700, FxFeedUI.check);
  },
  'fx-jump': function (el) {
    var v = Desk.toCount(el.value);
    if (!(v >= 0)) return;
    saveSetting('fx.feed_max_jump_pct', v, 700, FxFeedUI.check);
  }
};

var ATRISK_SAVE_T = null;

/* One debounced writer for every Settings control that persists.

   Debounced because these are number inputs: "180" arrives as 1, 18, 180 and
   three round trips would race each other to decide the final value. A select
   passes wait = 0, since it settles on one value the moment it changes.

   Keyed per config key so two different fields being edited in the same
   breath do not cancel each other — that was the bug waiting in a single
   shared timer. */
var CONFIG_SAVE_T = {};
/* `shown` is what the toast says instead of the raw value — a JSON list is not
   a sentence — and `after` runs once the server has it. */
function saveConfig(key, value, label, wait, shown, after) {
  clearTimeout(CONFIG_SAVE_T[key]);
  if (!API.live) return;
  CONFIG_SAVE_T[key] = setTimeout(function () {
    var updates = {};
    updates[key] = String(value);
    API.put('/api/config', { updates: updates })
      .then(function () {
        toast(label, shown === undefined ? String(value) : shown, 'ok', 1800);
        if (typeof after === 'function') after();
      })
      .catch(function (err) { toast(label, API.friendly(err), 'err', 5000); });
  }, wait === undefined ? 600 : wait);
}

/* The Telegram card as it was last loaded, and a way to load it again. */
function tgOfficeStatus() {
  return typeof YALLA !== 'undefined' && YALLA.telegramStatus ? YALLA.telegramStatus() : null;
}
function tgOfficeReload() {
  if (typeof YALLA !== 'undefined' && YALLA.telegramLoad) YALLA.telegramLoad();
}

/* Re-focus an input after a full re-render so typing is never interrupted. */
function focusBack(sel, caret) {
  var el = document.querySelector(sel);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(caret, caret); } catch (e) {}
}

/* The rate box's one write. A rate more than the feed's limit away from
   the current one is refused 409 rate_jump by the server until the person
   says yes, in a dialog naming both numbers. Anything else that fails puts
   the box back to the rate the shop really has. */
function saveRate(v, confirmed) {
  if (!API.live) return;
  API.post('/api/fx', { base: 'USD', quote: 'SYP', rate: v, confirm: !!confirmed })
    .then(function () { CONFIG.EXCHANGE_RATE = v; markSaved('fx.rate'); closeModal(); return Shop.reload(); })
    .catch(function (err) {
      var box = document.getElementById('setRate');
      if (err && err.code === 'rate_jump' && !confirmed) {
        var was = (err.detail && err.detail.was) || CONFIG.EXCHANGE_RATE;
        var pct = Math.round(Math.abs(v - was) / was * 100);
        openModal({
          title: t('rate_jump_title'),
          size: 'narrow',
          body: '<p>' + t('rate_jump_body')
            .replace('{new}', '<bdi dir="ltr">1 USD = ' + nf(v) + ' SYP</bdi>')
            .replace('{old}', '<bdi dir="ltr">' + nf(was) + '</bdi>')
            .replace('{pct}', '<bdi dir="ltr">' + pct + '%</bdi>') + '</p>' +
            '<p class="muted">' + t('rate_jump_sub') + '</p>',
          foot: '<button class="btn btn-ghost" data-act="rate-keep">' + t('rate_jump_keep').replace('{old}', nf(was)) + '</button>' +
                '<button class="btn btn-primary" data-act="rate-confirm" data-v="' + v + '">' + t('rate_jump_yes').replace('{new}', nf(v)) + '</button>'
        });
        return;
      }
      if (box) box.value = CONFIG.EXCHANGE_RATE;
      toast(t('exchange_rate'), API.friendly(err), 'err', 5000);
    });
}
ACTIONS['rate-confirm'] = function (el) { saveRate(Number(el.getAttribute('data-v')), true); };
ACTIONS['rate-keep'] = function () {
  closeModal();
  var box = document.getElementById('setRate');
  if (box) box.value = CONFIG.EXCHANGE_RATE;
};

/* ONE SETTING, SAVED WHERE IT STANDS                      (night shift 03)
   `saveConfig` toasts, which is right for a switch somebody flicked and
   wrong for a box they are still typing in: the toast has gone by the time
   the eye gets back to the field. This writes the same key through the same
   route and puts a small "Saved" beside the box instead, which is the
   answer rather than an animation — it appears only once the server has
   actually taken it. */
function saveSetting(key, value, wait, after) {
  clearTimeout(CONFIG_SAVE_T[key]);
  if (!API.live) return;
  CONFIG_SAVE_T[key] = setTimeout(function () {
    var updates = {};
    updates[key] = String(value);
    API.put('/api/config', { updates: updates })
      .then(function () { markSaved(key); if (after) after(); })
      .catch(function (err) { toast(t('settings_title'), API.friendly(err), 'err', 5000); });
  }, wait === undefined ? 700 : wait);
}

function markSaved(key) {
  var el = document.querySelector('[data-saved="' + key + '"]');
  if (!el) return;
  el.textContent = t('cb_saved_now');
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove('on'); }, 2600);
}
