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
    /* Marking a product hidden is editing the catalogue. The
       column is not drawn without product.write, so reaching this is either a
       stale screen or someone poking at it — either way, put the switch back
       rather than letting the UI show a change the server will not keep. */
    if (!allow('product.write')) { el.checked = !el.checked; return; }
    var p = DB.product(+el.getAttribute('data-id'));
    p.hidden = !el.checked;
    p.archived = p.hidden;
    /* Optimistic: the switch has already moved under the finger, and waiting
       for a round trip before it settles reads as a broken toggle. It pushed
       nothing at all before, so the switch flicked back on the next reload. */
    if (typeof Shop !== 'undefined' && Shop.live()) {
      Shop.hideProduct(p.id, p.hidden)
        .then(function () { return Shop.reload(); })
        .catch(function (err) {
          el.checked = !el.checked;
          p.hidden = !p.hidden;
          p.archived = p.hidden;
          toast(p.name, API.friendly(err), 'err', 6000);
        });
    }
    toast(p.name, p.hidden
      ? (OG.lang === 'ar' ? 'أُخفي عن المتجر' : 'Hidden from the storefront')
      : (OG.lang === 'ar' ? 'ظاهر في المتجر' : 'Visible on the storefront'), 'ok', 2000);
  },

  'wh-type': function (el) { OG.wh.type = el.value; OG.wh.sizes = {}; render(); },
  'wh-name': function (el) { OG.wh.name = el.value; },
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
