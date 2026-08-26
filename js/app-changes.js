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
  'prod-q': function (el) { OG.prod.q = el.value; render(); focusBack('[data-change="prod-q"]', el.value.length); },
  'prod-type': function (el) { OG.prod.type = el.value; render(); },
  'prod-health': function (el) { OG.prod.health = el.value; render(); },
  'cust-q': function (el) { OG.cust.q = el.value; render(); focusBack('[data-change="cust-q"]', el.value.length); },

  'toggle-visible': function (el) {
    /* Hiding a product from the storefront is editing the catalogue. The
       column is not drawn without product.write, so reaching this is either a
       stale screen or someone poking at it — either way, put the switch back
       rather than letting the UI show a change the server will not keep. */
    if (!allow('product.write')) { el.checked = !el.checked; return; }
    var p = DB.product(+el.getAttribute('data-id'));
    p.hidden = !el.checked;
    toast(p.name, p.hidden
      ? (OG.lang === 'ar' ? 'أُخفي عن المتجر' : 'Hidden from the storefront')
      : (OG.lang === 'ar' ? 'ظاهر في المتجر' : 'Visible on the storefront'), 'ok', 2000);
    if (OG.view === 'storefront') render();
  },

  'wh-type': function (el) { OG.wh.type = el.value; OG.wh.sizes = {}; render(); },
  'wh-name': function (el) { OG.wh.name = el.value; },
  'wh-size': function (el) {
    var s = el.getAttribute('data-size');
    OG.wh.sizes[s] = el.value === '' ? '' : Math.max(0, parseInt(el.value, 10) || 0);
    render();
    focusBack('[data-change="wh-size"][data-size="' + s + '"]', String(OG.wh.sizes[s]).length);
  },
  'lb-max': function (el) {
    OG.lb.max = Math.max(1, Math.min(24, parseInt(el.value, 10) || 1));
    repaintLabels();
    focusBack('[data-change="lb-max"]', String(OG.lb.max).length);
  },

  /* The roll actually loaded in the printer. Clamped rather than validated on
     blur, so a half-typed "5" never renders a 5mm label mid-keystroke. */
  'lb-cw': function (el) {
    OG.lb.cw = Math.max(15, Math.min(200, parseInt(el.value, 10) || 50));
    repaintLabels();
    focusBack('#lbCW', String(OG.lb.cw).length);
  },
  'lb-ch': function (el) {
    OG.lb.ch = Math.max(10, Math.min(200, parseInt(el.value, 10) || 30));
    repaintLabels();
    focusBack('#lbCH', String(OG.lb.ch).length);
  },

  'wh-recalc': function (el) {
    var id = el.id, caret = el.value.length;
    render();
    focusBack('#' + id, caret);
  },

  /* Settings that actually apply. Every one of these used to be an input that
     accepted typing and threw it away, behind a Save button that said
     "Settings saved". They now write to CONFIG / PERMISSIONS, which is what
     the rest of the app reads, so a change is visible immediately everywhere.

     There is no separate "save" step because there is nothing to save to —
     state lives in memory by design. Save now just confirms what is already
     true, which is the honest version of that button. */
  'set-pts': function (el) {
    var v = parseFloat(el.value);
    if (isFinite(v) && v >= 0) { CONFIG.LOYALTY_POINTS_PER_1000 = v; render(); }
  },
  'set-ptval': function (el) {
    var v = parseInt(el.value, 10);
    if (isFinite(v) && v >= 0) { CONFIG.LOYALTY_POINT_VALUE = v; render(); }
  },
  'set-shopname': function (el) {
    var v = String(el.value || '').trim();
    if (!v) return;                       /* never let the shop become nameless */
    CONFIG.SHOP_NAME = v;
    renderSidebar(); renderTopbar();
    focusBack('#setShopName', el.value.length);
  },
  'set-addr': function (el) {
    CONFIG.SHOP_ADDRESS = String(el.value || '');
    focusBack('#setAddr', el.value.length);
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

  'set-rate': function (el) {
    var v = parseInt(el.value, 10);
    if (v > 0) {
      CONFIG.EXCHANGE_RATE = v;
      render();
      focusBack('#setRate', String(v).length);
      toast(t('exchange_rate'), '1 USD = ' + nf(v) + ' SYP', 'ok', 2000);
    }
  }
};

/* Re-focus an input after a full re-render so typing is never interrupted. */
function focusBack(sel, caret) {
  var el = document.querySelector(sel);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(caret, caret); } catch (e) {}
}
