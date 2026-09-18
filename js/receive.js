/* ==========================================================================
   OG SYSTEM — GOODS ARRIVED                                 (night shift 02)
   --------------------------------------------------------------------------
   The screen for a person standing next to a pile of boxes.

   WHY THIS IS NOT SCAN-FIRST, WHEN EVERYTHING ELSE IN THE SHOP IS.
   New stock arrives with no usable barcode on it — the shop prints its own
   OG labels AFTER the goods are in. So the moment a delivery lands is the one
   moment in the building when nothing can be scanned, and a screen that opens
   a scan box is a screen that cannot be used. This is pick-and-count, and
   printing the labels is its last step. From the moment a box carries an OG
   label, every other flow in the shop is scan-first again.

   WHAT IT REPLACED. There was no receiving screen at all. A purchase order
   had a "Receive stock" button that fired on the press with no dialog: it
   booked the WHOLE order, moved the supplier balance, and opened a label
   preview nobody asked for. A short delivery — eight of ten, which is
   ordinary — could not be recorded at all, although the column
   (`purchase_order_lines.received_qty`), the library (`Purchasing.receive`)
   and the route have supported it since the day they were written. The two
   things people did instead both lied: receive ten and write two off as
   `damaged`, or never receive the order and book eight through the scan
   sheet, leaving the supplier uncharged for ever.

   NO SERVER CHANGE WAS NEEDED FOR ANY OF THIS. `POST /api/purchase-orders/
   :id/receive` already takes `received: [{sku, qty}]` and already leaves an
   order `sent` with the rest still owed; `POST /api/stock/receive` already
   books a delivery nobody ordered. Both are `stock.move`, and they still are.

   THE SHAPE
     1  What arrived?   open orders as cards, or "not from an order"
     2  Count it        steppers, prefilled with what is still owed
     3  Where to        one place, remembered per machine
        one confirm, one write
     4  Print the labels — the natural last step, and the main button

   Repaints patch `#rcBody` and `#rcFoot` only. This panel holds typed
   quantities and a caret, and render() would take both — the same rule the
   move-by-scan panel and the order desk follow.
   ========================================================================== */

var Receive = (function () {

  /* Which place the last delivery went into, per MACHINE — the back-room
     laptop and the till answer this differently and always will. */
  var PLACE_KEY = 'og.receive.place';

  /* step: 0 what arrived · 1 count · 2 done (labels)
     from: null | {kind:'po', po} | {kind:'free'}
     lines: [{ sku, name, size, colour, qty, owed }]   qty = what really came */
  var S = null;
  var busy = false;
  var q = '';                /* the product search on the free path */

  function fresh() {
    return { step: 0, from: null, lines: [], whId: place(), done: null };
  }

  function place() {
    try {
      var v = localStorage.getItem(PLACE_KEY);
      if (v && DB.warehouses.some(function (w) { return w.id === v; })) return v;
    } catch (e) { /* private window */ }
    return DB.intakeWh;
  }

  function rememberPlace(id) {
    try { localStorage.setItem(PLACE_KEY, id); } catch (e) {}
  }

  /* An order still owing something. `sent` and `draft` both count: a draft is
     unreachable from the UI today, but a delivery that turns up against one
     is still a delivery. */
  function openOrders() {
    return DB.purchaseOrders.filter(function (p) {
      if (p.status === 'received' || p.status === 'cancelled') return false;
      return p.lines.some(function (l) { return (l.qty - (l.received || 0)) > 0; });
    });
  }

  function owed(l) { return Math.max(0, l.qty - (l.received || 0)); }

  function total() {
    return S.lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
  }

  function whName(id) { return DB.whName(id, OG.lang === 'ar'); }

  /* ------------------------------------------------------------- the view */

  function tab() {
    if (!S) S = fresh();
    return '<div class="rc-wrap">' +
      '<div id="rcBody">' + body() + '</div>' +
      '<div id="rcFoot" class="rc-foot">' + foot() + '</div>' +
    '</div>';
  }

  function body() {
    return S.step === 0 ? pickHtml() : S.step === 1 ? countHtml() : doneHtml();
  }

  /* ---- step 1: what arrived? ---- */
  function pickHtml() {
    var orders = openOrders();
    var h = '<div class="rc-head"><h3>' + t('rc_what') + '</h3>' +
      '<p class="muted">' + t('rc_what_sub') + '</p></div>';

    if (orders.length) {
      h += '<div class="rc-cards">';
      orders.forEach(function (p) {
        var left = p.lines.reduce(function (a, l) { return a + owed(l); }, 0);
        h += '<button class="rc-card" data-act="rc-po" data-id="' + esc(p.id) + '">' +
          '<span class="rc-card-top"><b><bdi dir="ltr">' + esc(p.id) + '</bdi></b>' +
            '<span class="badge neutral">' + t('rc_still_due').replace('{n}',
              '<bdi dir="ltr">' + nf(left) + '</bdi>') + '</span></span>' +
          '<span class="rc-card-who">' + esc(p.supplierName || t('supplier')) + '</span>' +
          '<span class="rc-card-when muted">' + (p.created ? fmtDate(p.created) : '') +
            (p.note ? ' · ' + esc(p.note) : '') + '</span>' +
        '</button>';
      });
      h += '</div>';
    }

    /* The two cards that are always there. "A new product" hands straight to
       the Add-product form, which books its own opening stock and prints its
       own labels — so it is the same job, done by the screen that already
       does it, rather than a second way of creating a product. */
    h += '<div class="rc-cards rc-cards-alt">' +
      '<button class="rc-card rc-card-plain" data-act="rc-free">' +
        '<span class="rc-card-top"><b>' + t('rc_no_order') + '</b></span>' +
        '<span class="rc-card-when muted">' + t('rc_no_order_sub') + '</span>' +
      '</button>' +
      (allow('product.write')
        ? '<button class="rc-card rc-card-plain" data-act="rc-new-product">' +
            '<span class="rc-card-top"><b>' + t('rc_new_product') + '</b></span>' +
            '<span class="rc-card-when muted">' + t('rc_new_product_sub') + '</span>' +
          '</button>'
        : '') +
    '</div>';

    if (!orders.length) {
      h += '<p class="muted small mt">' + t('rc_no_orders') + '</p>';
    }
    return h;
  }

  /* ---- step 2: count it ---- */
  function countHtml() {
    var h = '<div class="rc-head"><h3>' + t('rc_count') + '</h3>' +
      '<p class="muted">' + (S.from.kind === 'po'
        ? t('rc_count_sub_po').replace('{id}', '<bdi dir="ltr">' + esc(S.from.po.id) + '</bdi>')
        : t('rc_count_sub_free')) + '</p></div>';

    if (S.from.kind === 'po') {
      h += '<div class="rc-row-btns">' +
        '<button class="btn" data-act="rc-all">' + t('rc_all_arrived') + '</button>' +
        '<button class="btn btn-ghost" data-act="rc-none">' + t('rc_none_yet') + '</button>' +
      '</div>';
    } else {
      h += searchHtml();
    }

    if (!S.lines.length) {
      h += '<div class="cart-empty"><b>' + t('rc_nothing_yet') + '</b>' +
        t('rc_nothing_yet_sub') + '</div>';
      return h;
    }

    /* Grouped by product so a person works down the pile a box at a time,
       which is the order the boxes are actually in. */
    var groups = [], byName = {};
    S.lines.forEach(function (l) {
      if (!byName[l.name]) { byName[l.name] = { name: l.name, rows: [] }; groups.push(byName[l.name]); }
      byName[l.name].rows.push(l);
    });

    h += '<div class="rc-list">';
    groups.forEach(function (g) {
      h += '<div class="rc-group"><div class="rc-group-h">' + esc(g.name) + '</div>';
      g.rows.forEach(function (l) {
        var over = S.from.kind === 'po' && Number(l.qty) > l.owed;
        h += '<div class="rc-line' + (over ? ' row-danger' : '') + '">' +
          '<span class="rc-size">' + esc(l.size) +
            (l.colour ? ' <span class="muted">· ' + esc(l.colour) + '</span>' : '') + '</span>' +
          (S.from.kind === 'po'
            ? '<span class="rc-owed muted">' + t('rc_ordered').replace('{n}',
                '<bdi dir="ltr">' + nf(l.owed) + '</bdi>') + '</span>'
            : '<span class="rc-owed"></span>') +
          '<span class="rc-step">' +
            '<button class="btn btn-sm" data-act="rc-minus" data-sku="' + esc(l.sku) + '">−</button>' +
            '<input class="inp num" type="number" min="0" max="9999" ' +
              'value="' + (Number(l.qty) || 0) + '" data-change="rc-qty" data-sku="' + esc(l.sku) + '">' +
            '<button class="btn btn-sm" data-act="rc-plus" data-sku="' + esc(l.sku) + '">+</button>' +
          '</span>' +
          '<button class="btn btn-ghost btn-sm rc-x" data-act="rc-drop" data-sku="' + esc(l.sku) + '" ' +
            'aria-label="' + esc(t('remove')) + '">✕</button>' +
        '</div>';
      });
      h += '</div>';
    });
    h += '</div>';

    /* More than was ordered is not refused — a supplier really does send an
       extra pair sometimes, and the shop has it in its hands. It is said. */
    if (S.from.kind === 'po' && S.lines.some(function (l) { return Number(l.qty) > l.owed; })) {
      h += '<div class="rc-warn">' + t('rc_more_than_ordered') + '</div>';
    }
    return h;
  }

  /* The product picker on the "not from an order" path. Typing, never
     scanning — see the header of this file. */
  function searchHtml() {
    var h = '<label class="field rc-find"><span>' + t('rc_find') + '</span>' +
      '<input class="inp" id="rcFind" type="text" value="' + esc(q) + '" ' +
        'placeholder="' + esc(t('rc_find_ph')) + '" data-change="rc-find"></label>';

    var hits = matches();
    if (!q) {
      h += '<p class="muted small">' + t('rc_find_hint') + '</p>';
      return h;
    }
    if (!hits.length) {
      h += '<p class="muted small">' + t('rc_find_none') + '</p>';
      return h;
    }
    h += '<div class="rc-hits">';
    hits.forEach(function (p) {
      h += '<button class="rc-hit" data-act="rc-pick" data-id="' + p.id + '">' +
        thumb(p, 'sm') + '<span class="rc-hit-t"><b>' + esc(p.name) + '</b>' +
        '<small class="muted">' + esc(DB.typeLabels[p.type] || p.type || '') +
          (p.brand ? ' · ' + esc(p.brand) : '') + '</small></span></button>';
    });
    h += '</div>';
    return h;
  }

  /* Live products only — an archived line is one the shop has stopped
     selling, and booking a delivery against it is nearly always a mistake. */
  function matches() {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return [];
    var words = s.split(/\s+/);
    return DB.products.filter(function (p) {
      if (p.archived) return false;
      var hay = (p.name + ' ' + (p.brand || '') + ' ' + (p.colorway || '') + ' ' +
                 (DB.typeLabels[p.type] || p.type || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    }).slice(0, 8);
  }

  /* ---- step 3: it is in, print the labels ---- */
  function doneHtml() {
    var d = S.done || { pieces: 0, whId: place(), lines: [], failed: [], left: 0 };
    var h = '<div class="rc-done">' +
      '<div class="rc-tick" aria-hidden="true">✓</div>' +
      '<h3>' + t('rc_in').replace('{n}', '<bdi dir="ltr">' + nf(d.pieces) + '</bdi>')
                        .replace('{place}', esc(whName(d.whId))) + '</h3>';

    if (d.left > 0) {
      h += '<p class="muted">' + t('rc_still_owed').replace('{n}',
        '<bdi dir="ltr">' + nf(d.left) + '</bdi>') + '</p>';
    }
    if (d.failed && d.failed.length) {
      h += '<div class="rc-warn">' + t('rc_some_failed')
        .replace('{n}', '<bdi dir="ltr">' + nf(d.failed.length) + '</bdi>') +
        '<br><span class="muted small">' + esc(d.failed[0].why || '') + '</span></div>';
    }

    h += '<p class="rc-label-why muted">' + t('rc_labels_why') + '</p>';
    return h + '</div>';
  }

  /* ------------------------------------------------------------- the foot */

  function foot() {
    if (S.step === 0) return '';

    if (S.step === 2) {
      var n = (S.done && S.done.pieces) || 0;
      /* One <span> round the caption on purpose. `.btn` is a flex row, so
         every child is a flex item and the gap lands either side of the
         <bdi> — "Print   12   labels". One element, one item, one gap. */
      return (allow('label.print') && n
        ? '<button class="btn btn-primary btn-lg" data-act="rc-labels"><span>' +
            t('rc_print_labels').replace('{n}', '<bdi dir="ltr">' + nf(n) + '</bdi>') +
          '</span></button>'
        : '') +
        '<button class="btn" data-act="rc-again">' + t('rc_another') + '</button>';
    }

    /* Step 2. One sentence on the button: how many pieces, into where. */
    var n2 = total();
    var why = reason();
    return '<button class="btn btn-ghost" data-act="rc-back">' + t('back') + '</button>' +
      placeHtml() +
      '<button class="btn btn-primary btn-lg" data-act="rc-save"' +
        (why || busy ? ' disabled' : '') + '><span>' +
        (busy ? t('rc_saving')
              : t('rc_put_in').replace('{n}', '<bdi dir="ltr">' + nf(n2) + '</bdi>')
                              .replace('{place}', esc(whName(S.whId)))) +
      '</span></button>' +
      (why ? '<span class="rc-why muted small">' + why + '</span>' : '');
  }

  /* A purchase order's place is the order's own — the server books it into
     `purchase_orders.wh_id` and takes no place from the request. Offering a
     picker that does nothing would be worse than no picker, so the place is
     stated as the fact it is. */
  function placeHtml() {
    if (S.from && S.from.kind === 'po') {
      return '<span class="rc-place muted">' +
        t('rc_goes_to').replace('{place}', '<b>' + esc(whName(S.whId)) + '</b>') + '</span>';
    }
    return '<label class="rc-place"><span class="muted">' + t('rc_goes_to_lbl') + '</span>' +
      '<select class="inp" data-change="rc-wh">' +
        DB.warehouses.map(function (w) {
          return '<option value="' + esc(w.id) + '"' + (w.id === S.whId ? ' selected' : '') + '>' +
            esc(whName(w.id)) + '</option>';
        }).join('') +
      '</select></label>';
  }

  function reason() {
    if (!S.lines.length) return t('rc_r_empty');
    if (total() <= 0) return t('rc_r_zero');
    return '';
  }

  /* ------------------------------------------------------------- painting */

  function paint() {
    var b = document.getElementById('rcBody');
    var f = document.getElementById('rcFoot');
    if (!b || !f) return;
    b.innerHTML = body();
    f.innerHTML = foot();
  }

  /* Only the foot moved — used by the quantity boxes, so the box being typed
     into is never replaced under the caret. */
  function paintFoot() {
    var f = document.getElementById('rcFoot');
    if (f) f.innerHTML = foot();
  }

  function after() {
    var box = document.getElementById('rcFind');
    /* Not on a touch screen: focusing here throws the keyboard up over the
       list the moment the step opens. Same rule as the order desk's scan box. */
    if (box && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
      try { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } catch (e) {}
    }
  }

  /* ---------------------------------------------------------------- lines */

  function addVariant(v, want) {
    if (!v) return;
    if (S.lines.some(function (l) { return l.sku === v.sku; })) return;
    var p = DB.product(v.productId);
    S.lines.push({
      sku: v.sku,
      name: p ? p.name : v.sku,
      size: v.size,
      colour: DB.shownColour(v) || '',
      owed: want === undefined ? 0 : want,
      qty: want === undefined ? 0 : want
    });
  }

  function line(sku) {
    return S.lines.filter(function (l) { return l.sku === sku; })[0];
  }

  function setQty(sku, n) {
    var l = line(sku);
    if (!l) return;
    l.qty = Desk.toCount(n, { max: 9999 });
  }

  /* ---------------------------------------------------------------- write */

  function save() {
    if (busy || reason()) return;
    var got = S.lines.filter(function (l) { return Number(l.qty) > 0; })
                     .map(function (l) { return { sku: l.sku, qty: Number(l.qty) }; });
    if (!got.length) return;

    busy = true; paintFoot();
    var pieces = got.reduce(function (a, l) { return a + l.qty; }, 0);
    var whId = S.whId;
    var lines = S.lines.filter(function (l) { return Number(l.qty) > 0; });

    /* Shop.write(send, mirror, done) toasts its own failure and does NOT call
       `done` — so a rejection has to put this panel's Save button back by
       itself, then rethrow so the shop still says what went wrong. Without
       the rethrow the write would look like it succeeded. */
    var unstick = function (e) { busy = false; paintFoot(); throw e; };

    var finish = function (failed, left) {
      busy = false;
      S.done = { pieces: pieces, whId: whId, lines: lines, failed: failed || [], left: left || 0 };
      S.step = 2;
      paint();
      toast(t('rc_in_toast'), nf(pieces) + ' ' + t('pieces') + ' · ' + whName(whId), 'ok', 4000);
    };

    if (S.from.kind === 'po') {
      var poId = S.from.po.id;
      var reply = null;
      Shop.write(function () {
        return Shop.receivePO(poId, got).then(function (r) { reply = r; return r; }, unstick);
      }, null, function () {
        var po = reply && (reply.po || reply.purchaseOrder);
        var left = po ? (po.lines || []).reduce(function (a, l) {
          return a + Math.max(0, l.qty - (l.received_qty || 0));
        }, 0) : 0;
        finish([], left);
      });
      return;
    }

    /* Not from an order: one receive per line, chained inside ONE Shop.write
       so the busy gate is held for the batch. Chained rather than fired
       together, because each is its own transaction against one SQLite file
       and a queue of them is how a busy_timeout becomes a failed delivery.
       Deliberately not atomic, and it says which lines did not land: the
       alternative is unbooking goods a person has already put on a shelf. */
    var failed = [];
    Shop.write(function () {
      var chain = Promise.resolve();
      got.forEach(function (g) {
        chain = chain.then(function () {
          return Shop.receive(g.sku, whId, g.qty, t('rc_note'))
            .catch(function (e) {
              /* Caught per line, never rethrown: one refused size must not
                 unbook the seven that landed. Which ones failed is said on
                 the next screen rather than in a toast that scrolls away. */
              failed.push({ sku: g.sku, why: API.friendly ? API.friendly(e) : (e && e.message) || '' });
            });
        });
      });
      return chain;
    }, null, function () {
      pieces = got.reduce(function (a, g) {
        return a + (failed.some(function (f) { return f.sku === g.sku; }) ? 0 : g.qty);
      }, 0);
      finish(failed, 0);
    });
  }

  /* One sticker per piece that actually arrived, grouped by product so they
     can be stuck on box by box — which is why the lines are not merged. */
  function labels() {
    if (!S.done || typeof Labels === 'undefined') return;
    var lines = [];
    S.done.lines.forEach(function (l) {
      if (Number(l.qty) > 0) lines.push({ sku: l.sku, qty: Number(l.qty) });
    });
    if (!lines.length) return;
    /* openPreviewModal(lines, presetKey, station, barcodeType) — it remembers
       all three per machine, so the delivery hands it the lines and nothing
       else, and the roll somebody set last time is still the roll. */
    Labels.openPreviewModal(lines);
  }

  /* --------------------------------------------------------------- wiring */

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['rc-po'] = function (el) {
      var po = DB.po(el.getAttribute('data-id'));
      if (!po) return;
      S.from = { kind: 'po', po: po };
      S.whId = po.whId || DB.intakeWh;
      S.lines = [];
      po.lines.forEach(function (l) {
        if (owed(l) <= 0) return;
        var v = DB.variantBySku(l.sku);
        S.lines.push({
          sku: l.sku,
          name: l.name || (v && DB.product(v.productId) ? DB.product(v.productId).name : l.sku),
          size: l.size || (v ? v.size : ''),
          colour: v ? (DB.shownColour(v) || '') : '',
          owed: owed(l),
          qty: owed(l)              /* the common case is "it all came" */
        });
      });
      S.step = 1; paint();
    };

    ACTIONS['rc-free'] = function () {
      S.from = { kind: 'free' }; S.lines = []; q = '';
      S.whId = place();
      S.step = 1; paint(); after();
    };

    ACTIONS['rc-new-product'] = function () {
      /* The Add-product form books its own opening stock and offers its own
         labels, so this is the same job on the screen that already does it. */
      OG.wh.tab = 'add';
      render();
    };

    ACTIONS['rc-all'] = function () {
      S.lines.forEach(function (l) { l.qty = l.owed; });
      paint();
    };
    ACTIONS['rc-none'] = function () {
      S.lines.forEach(function (l) { l.qty = 0; });
      paint();
    };

    ACTIONS['rc-plus'] = function (el) {
      var l = line(el.getAttribute('data-sku'));
      if (l) { setQty(l.sku, (Number(l.qty) || 0) + 1); paint(); }
    };
    ACTIONS['rc-minus'] = function (el) {
      var l = line(el.getAttribute('data-sku'));
      if (l) { setQty(l.sku, (Number(l.qty) || 0) - 1); paint(); }
    };
    ACTIONS['rc-drop'] = function (el) {
      var sku = el.getAttribute('data-sku');
      S.lines = S.lines.filter(function (l) { return l.sku !== sku; });
      paint();
    };

    ACTIONS['rc-pick'] = function (el) {
      var p = DB.product(Number(el.getAttribute('data-id')));
      if (!p) return;
      DB.variantsOf(p.id).forEach(function (v) { addVariant(v, 0); });
      q = '';
      paint(); after();
    };

    ACTIONS['rc-back'] = function () {
      S.step = 0; S.from = null; S.lines = []; q = ''; paint();
    };
    ACTIONS['rc-save'] = function () { save(); };
    ACTIONS['rc-labels'] = function () { labels(); };
    ACTIONS['rc-again'] = function () { S = fresh(); paint(); };

    if (typeof CHANGES === 'undefined') return;
    CHANGES['rc-qty'] = function (el) {
      setQty(el.getAttribute('data-sku'), el.value);
      /* The foot only: the box being typed into lives in the body. */
      paintFoot();
    };
    CHANGES['rc-wh'] = function (el) {
      S.whId = el.value; rememberPlace(S.whId); paintFoot();
    };
    CHANGES['rc-find'] = function (el) {
      q = el.value;
      var b = document.getElementById('rcBody');
      if (b) b.innerHTML = body();
      /* The box was just replaced with the rest of the step — put the caret
         back where the person left it. */
      var box = document.getElementById('rcFind');
      if (box) { try { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } catch (e) {} }
    };
  }

  /* A fresh delivery every time the tab is opened from elsewhere. */
  function reset() { S = fresh(); q = ''; busy = false; }

  return { tab: tab, after: after, register: register, reset: reset };
})();
