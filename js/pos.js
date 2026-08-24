/* ==========================================================================
   OG SYSTEM — Point of Sale
   The screen the demo lives or dies on. Everything here is built for speed:
   scan → size → done. Sub-renders keep focus in the input while the cart
   updates around it.
   ========================================================================== */

var POS = (function () {

  var S = {
    cart: [],            // { sku, productId, name, size, price, cost, qty }
    customerId: null,
    discount: { mode: 'amount', value: 0 },
    coupon: null,
    pointsUsed: 0,
    payment: 'cash',
    /* Going out with a driver. `deliver` is the tick box; `deliverAddress` is
       null until someone types, so an empty string can mean "cleared it
       deliberately" and still be told apart from "not filled in yet". */
    deliver: false,
    deliverAddress: null,
    /* Which location this sale takes stock out of. The wall by default,
       because that is what a customer is holding when they reach the till. */
    warehouse: DB.defaultWh,
    cat: '',
    q: '',
    flashSku: null,
    print: { on: false, text: '', qty: 1, priority: 'normal', deadline: null }
  };

  var PRINT_UNIT_PRICE = 950;     // charged to the customer, per piece (new pound)
  var PRINT_UNIT_COST  = 460;     // paid to Yalla Wear, per piece (new pound)

  function isoAhead(n) {
    var d = daysAhead(n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------------- totals */

  function totals() {
    var subtotal = S.cart.reduce(function (a, l) { return a + l.qty * l.price; }, 0);
    var manual = 0;
    if (S.discount.value > 0) {
      manual = S.discount.mode === 'percent'
        ? Math.round(subtotal * Math.min(100, S.discount.value) / 100)
        : Math.min(subtotal, S.discount.value);
    }
    var couponCut = S.coupon ? Math.round(subtotal * CONFIG.COUPON.percent / 100) : 0;
    var pointsValue = S.pointsUsed * CONFIG.LOYALTY_POINT_VALUE;
    var discount = Math.min(subtotal, manual + couponCut);
    var total = Math.max(0, subtotal - discount - pointsValue);
    return { subtotal: subtotal, manual: manual, couponCut: couponCut, discount: discount, pointsValue: pointsValue, total: total };
  }

  function cartCount() { return S.cart.reduce(function (a, l) { return a + l.qty; }, 0); }

  /* ---------------------------------------------------- the discount ceiling

     The real check is on the server, in Sales.record, and it stays there: a
     limit that only exists in the browser is not a limit, and the request can
     be sent by hand.

     This is the same rule drawn on the screen, and it is worth doing twice for
     one reason — the cashier is standing in front of a customer she has just
     offered a discount to. Finding out it was refused AFTER pressing Charge
     makes her look like she does not know her own shop's rules. */

  var MAX_DISCOUNT_PCT = 10;      /* mirrors config sale.max_discount_pct */

  function discountCapped() {
    /* Demo mode has no accounts, so nothing is capped — the demo exists to
       show the whole system, and a refused discount in a sales pitch just
       looks broken. */
    if (typeof Auth === 'undefined' || Auth.demoMode()) return false;
    return !Auth.can('discount.unlimited');
  }

  /* The most that may come off this basket, in lira. Floored, so a discount
     one lira over the line is over the line — the same comparison the server
     makes, or the two would disagree at the boundary. */
  function discountCeiling() {
    return Math.floor(totals().subtotal * MAX_DISCOUNT_PCT / 100);
  }

  function overCap() {
    if (!discountCapped()) return false;
    var x = totals();
    /* The manual discount only. A coupon is a rule the shop set deliberately
       and points are the customer spending something they earned; neither is
       the cashier deciding to knock money off. */
    return x.manual > discountCeiling();
  }

  /* -------------------------------------------------------------- adding */

  /* What can actually be sold right now: the stock in the chosen location, not
     the grand total. Selling the pair that is in the back is the exact failure
     this whole feature exists to stop. */
  function stockFor(sku) {
    var v = DB.variantBySku(sku);
    return v ? DB.stockAt(v, S.warehouse) : 0;
  }

  function addVariant(v, silent) {
    if (!v) return false;
    var p = DB.product(v.productId);
    var line = S.cart.filter(function (l) { return l.sku === v.sku; })[0];
    var inCart = line ? line.qty : 0;

    var here = DB.stockAt(v, S.warehouse);
    if (here <= inCart) {
      var back = DB.stockElsewhere(v, S.warehouse);
      if (!silent) {
        if (back > 0) {
          /* It exists — just not where the cashier is standing. Say where, and
             offer to move it, rather than a flat "out of stock" that is a lie. */
          toast(
            t('wh_not_here'),
            p.name + ' · ' + t('size') + ' ' + v.size + ' — ' +
              back + ' ' + t('wh_in_the_back'),
            'warn', 6000,
            { label: t('wh_bring_out'), attrs: 'data-pos="bring" data-sku="' + v.sku + '"' }
          );
        } else {
          toast(t('out_of_stock'), p.name + ' · ' + t('size') + ' ' + v.size, 'err');
        }
      }
      return false;
    }

    if (line) line.qty += 1;
    else S.cart.push({
      sku: v.sku, productId: p.id, name: p.name, type: p.type,
      size: v.size, price: p.sellingPrice, cost: p.costPrice, qty: 1
    });

    S.flashSku = v.sku;
    if (!silent) toast(p.name, t('size') + ' ' + v.size + ' · ' + money(p.sellingPrice), 'ok', 1600);
    paintCart();
    pulseScan(true);
    countTotal();
    /* Leave the sheet closed on a phone — he is mid-scan and wants to see the
       products, not have the cart jump over them after every item. The
       collapsed handle already shows the running count and total. */
    return true;
  }

  function scanBarcode(code, silent) {
    code = String(code || '').trim();
    if (!code) return false;
    var v = DB.variantByBarcode(code);
    if (!v) {
      if (!silent) {
        toast(t('scan_btn'), (OG.lang === 'ar' ? 'باركود غير معروف: ' : 'Unknown barcode: ') + code, 'err');
        pulseScan(false);
      }
      return false;
    }
    return addVariant(v, silent);
  }

  function randomScan() {
    var pool = DB.variants.filter(function (v) { return v.qty > 2; });
    var v = pool[Math.floor(Math.random() * pool.length)];
    addVariant(v);
    var inp = document.getElementById('posScan');
    if (inp) { inp.value = ''; inp.focus(); }
    S.q = '';
    paintGrid();
  }

  /* ------------------------------------------------------------ rendering */

  function filteredProducts() {
    var list = DB.products.slice();
    if (S.cat) list = list.filter(function (p) { return p.type === S.cat; });
    if (S.q) {
      var q = S.q.toLowerCase();
      list = list.filter(function (p) {
        return p.name.toLowerCase().indexOf(q) > -1 ||
               p.brand.toLowerCase().indexOf(q) > -1 ||
               DB.typeLabels[p.type].toLowerCase().indexOf(q) > -1;
      });
    }
    return list;
  }

  function gridHtml() {
    var list = filteredProducts();
    if (!list.length) {
      return '<div class="cart-empty" style="grid-column:1/-1"><b>' + t('no_results') + '</b>' +
             (OG.lang === 'ar' ? 'جرّب اسم منتج أو ماركة' : 'Try a product name or a brand') + '</div>';
    }
    var h = '';
    list.forEach(function (p) {
      var q = DB.totalQty(p.id);
      h += '<button class="pcard' + (q === 0 ? ' dead' : '') + '" data-pos="pick" data-id="' + p.id + '">' +
        '<span class="pcard-img" style="background:' + p.image.bg + '">' + p.image.initials +
          '<span class="qty-tag' + (q <= CONFIG.STOCK_LOW ? ' low' : '') + '">' + q + '</span></span>' +
        '<span class="pcard-body"><b>' + esc(p.name) + '</b>' +
          '<span class="price">' + money(p.sellingPrice) + '</span>' +
          '<small>' + DB.typeLabels[p.type] + '</small></span>' +
      '</button>';
    });
    return h;
  }

  function linesHtml() {
    if (!S.cart.length) {
      return '<div class="cart-empty"><b>' + t('empty_cart') + '</b>' + t('empty_cart_sub') + '</div>';
    }
    var h = '';
    S.cart.forEach(function (l, i) {
      var max = stockFor(l.sku);
      h += '<div class="cart-line' + (S.flashSku === l.sku ? ' flash' : '') + '" data-sku="' + l.sku + '">' +
        '<div class="cl-main"><b>' + esc(l.name) + '</b>' +
          '<small>' + t('size') + ' ' + l.size + ' · ' + max + ' ' + t('in_stock') + '</small></div>' +
        '<span class="stepper">' +
          '<button data-pos="dec" data-i="' + i + '">−</button>' +
          '<span>' + l.qty + '</span>' +
          '<button data-pos="inc" data-i="' + i + '">+</button>' +
        '</span>' +
        '<span class="cl-total">' + money(l.qty * l.price) + '</span>' +
        '<button class="cl-del" data-pos="del" data-i="' + i + '" title="' + t('remove') + '">×</button>' +
      '</div>';
    });
    return h;
  }

  function custBoxHtml() {
    var c = S.customerId ? DB.customer(S.customerId) : null;
    if (!c) {
      return '<span class="lbl">' + t('customer') + ' <span class="keycap">F2</span></span>' +
        '<div class="cust-box"><input class="inp" id="posCust" type="text" autocomplete="off" ' +
          'placeholder="' + t('customer_ph') + '" data-pos-input="cust">' +
          '<div id="custDrop"></div></div>';
    }
    var tier = DB.tier(c.loyaltyPoints);
    var canRedeem = c.loyaltyPoints >= 500 && !S.pointsUsed;
    var h = '<span class="lbl">' + t('customer') + '</span>' +
      '<div class="cust-picked"><div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
        '<small class="num">' + tel(c.phone) + ' · ' + esc(c.city) + '</small></div>' +
        '<span class="badge ' + tier + '">' + nf(c.loyaltyPoints) + ' ' + t('points') + '</span>' +
        '<button class="btn btn-sm btn-ghost" data-pos="cust-clear">' + t('change_customer') + '</button></div>';
    if (canRedeem) {
      h += '<button class="btn btn-sm btn-block mt" data-pos="redeem">' +
        t('use_points') + ' 500 ' + t('points') + ' = ' + money(500 * CONFIG.LOYALTY_POINT_VALUE) + '</button>';
    }
    if (S.pointsUsed) {
      h += '<div class="mt"><span class="badge accent">− ' + money(S.pointsUsed * CONFIG.LOYALTY_POINT_VALUE) +
        ' (' + S.pointsUsed + ' ' + t('points') + ')</span> ' +
        '<button class="btn btn-sm btn-ghost" data-pos="unredeem">' + t('remove') + '</button></div>';
    }
    return h;
  }

  function totalsHtml() {
    var x = totals();
    var h = '<div class="totals">' +
      '<div class="tr"><span>' + t('subtotal') + ' · ' + cartCount() + ' ' + t('items').toLowerCase() + '</span><span>' + money(x.subtotal) + '</span></div>';
    if (x.manual) h += '<div class="tr disc"><span>' + t('discount') + '</span><span>− ' + money(x.manual) + '</span></div>';
    if (x.couponCut) h += '<div class="tr disc"><span>' + t('coupon') + ' ' + CONFIG.COUPON.code + '</span><span>− ' + money(x.couponCut) + '</span></div>';
    if (x.pointsValue) h += '<div class="tr disc"><span>' + t('loyalty') + '</span><span>− ' + money(x.pointsValue) + '</span></div>';
    h += '<div class="tr grand"><span>' + t('total') + '</span><span>' + money(x.total) + '</span></div>';
    if (OG.currency === 'SYP') h += '<div class="sub-usd">≈ $' + nf(x.total / CONFIG.EXCHANGE_RATE) + '</div>';
    h += '</div>';
    return h;
  }

  /* Which location the sale comes out of. Same pill grid as the payment
     methods, sitting directly above them, because both are "how was this
     sale done" rather than "what is being sold". */
  function whGridHtml() {
    var h = '<span class="lbl">' + t('wh_sell_from') + '</span>' +
            '<div class="pay-grid" id="whGrid">';
    DB.warehouses.forEach(function (w) {
      h += '<button class="' + (S.warehouse === w.id ? 'on' : '') + '" ' +
           'data-pos="wh" data-w="' + w.id + '">' +
           esc(DB.whName(w.id, OG.lang === 'ar')) + '</button>';
    });
    return h + '</div>';
  }

  function payGridHtml() {
    var h = '<span class="lbl">' + t('payment_method') + '</span><div class="pay-grid" id="payGrid">';
    DB.paymentMethods.forEach(function (m) {
      h += '<button class="' + (S.payment === m ? 'on' : '') + '" data-pos="pay" data-m="' + m + '">' + DB.payLabel(m) + '</button>';
    });
    return h + '</div>' + deliveryBoxHtml();
  }

  /* ------------------------------------------------------------- delivery

     "Cash on delivery" was already a payment method here and meant nothing —
     it printed a word on the receipt and the parcel's whereabouts stayed on
     paper. Choosing it now opens the address, because a COD sale is by
     definition going out of the door with somebody.

     A sale paid in the shop can be sent out too, hence the tick box: people
     pay for a pair and ask for it to be dropped at their flat. */
  function deliveryBoxHtml() {
    if (typeof Auth === 'undefined' || Auth.demoMode()) return '';
    if (!Auth.can('delivery.write')) return '';

    /* COD is not optional — money is owed on the doorstep, so somebody has to
       stand on it. The tick box is hidden in that case rather than shown
       ticked and disabled, which invites a fight with it. */
    var forced = S.payment === 'cod';
    var on = forced || S.deliver;

    var h = '<div class="deliver-add">';

    if (!forced) {
      h += '<label class="check"><input type="checkbox" id="posDeliver"' +
        (S.deliver ? ' checked' : '') + ' data-pos-check="deliver">' +
        '<span><b>' + t('dl_assign') + '</b></span></label>';
    } else {
      h += '<div class="lbl" style="margin:0 0 6px">' + t('dl_assign') + '</div>';
    }

    if (on) {
      /* Pre-filled from the customer when we have one, because the commonest
         delivery is to somebody the shop already knows. Still editable — the
         address on the delivery is the one he was actually sent to. */
      var cust = S.customerId ? DB.customer(S.customerId) : null;
      var addr = S.deliverAddress !== null && S.deliverAddress !== undefined
        ? S.deliverAddress
        : ((cust && cust.address) || '');

      h += '<label class="field"><span>' + t('dl_address') + '</span>' +
        '<input class="inp" id="posAddr" type="text" data-pos-input="addr" ' +
          'placeholder="' + esc(t('dl_address_ph')) + '" value="' + esc(addr) + '"></label>';

      if (cust && cust.phone) {
        h += '<div class="partner-note">' + t('dl_phone') + ': ' + tel(cust.phone) + '</div>';
      }
    }

    return h + '</div>';
  }

  function printBoxHtml() {
    var h = '<div class="print-add">' +
      '<label class="check"><input type="checkbox" id="posPrintOn"' + (S.print.on ? ' checked' : '') + ' data-pos-check="print">' +
        '<span><b>' + t('add_print') + '</b><br><small class="muted">→ ' + CONFIG.PRINT_PARTNER + '</small></span></label>';
    if (S.print.on) {
      h += '<div class="print-add-form">' +
        '<label class="field"><span>' + t('print_text') + '</span>' +
          '<input class="inp" id="prText" type="text" value="' + esc(S.print.text) + '" placeholder="TEAM OG · back print"></label>' +
        '<div class="row3">' +
          '<label class="field"><span>' + t('qty') + '</span>' +
            '<input class="inp num" id="prQty" type="number" min="1" value="' + S.print.qty + '"></label>' +
          '<label class="field"><span>' + t('priority') + '</span><select class="inp" id="prPrio">' +
            '<option value="normal"' + (S.print.priority === 'normal' ? ' selected' : '') + '>' + t('normal') + '</option>' +
            '<option value="urgent"' + (S.print.priority === 'urgent' ? ' selected' : '') + '>' + t('urgent') + '</option>' +
          '</select></label>' +
          '<label class="field"><span>' + t('deadline') + '</span>' +
            '<input class="inp" id="prDate" type="date" value="' + (S.print.deadline || isoAhead(5)) + '"></label>' +
        '</div></div>';
    }
    return h + '</div>';
  }

  /* Silent until she types something, and only ever says the one thing she
     needs: what the biggest allowed number is. Nobody wants a permanent
     "maximum discount 10%" label on a till they use four hundred times a day.

     The empty container is always rendered so the hint can be filled in place
     on each keystroke — repainting the whole foot would take the focus out of
     the box she is typing in, which is the single most annoying bug a till
     can have. */
  function discHintText() {
    if (!discountCapped() || !S.discount.value) return '';
    var line = t('disc_max').replace('{v}', money(discountCeiling()));
    return overCap()
      ? t('disc_capped').replace('{p}', MAX_DISCOUNT_PCT) + ' · ' + line
      : line;
  }

  function discHintHtml() {
    return '<div class="disc-hint' + (overCap() ? ' is-bad' : '') + '" id="discHint">' +
           discHintText() + '</div>';
  }

  function paintDiscHint() {
    var el = document.getElementById('discHint');
    if (el) {
      el.textContent = discHintText();
      el.className = 'disc-hint' + (overCap() ? ' is-bad' : '');
    }
    var inp = document.getElementById('posDisc');
    if (inp) inp.classList.toggle('is-bad', overCap());
  }

  function footHtml() {
    var x = totals();
    return '<div id="custWrap">' + custBoxHtml() + '</div>' +

      '<div class="row2 mt">' +
        '<div><span class="lbl">' + t('discount') + '</span>' +
          '<div style="display:flex;gap:4px">' +
            '<input class="inp num' + (overCap() ? ' is-bad' : '') + '" id="posDisc" type="number" min="0" placeholder="0" value="' + (S.discount.value || '') + '" data-pos-input="disc">' +
            '<span class="seg" style="flex:none">' +
              '<button data-pos="disc-mode" data-m="amount" class="' + (S.discount.mode === 'amount' ? 'on' : '') + '">#</button>' +
              '<button data-pos="disc-mode" data-m="percent" class="' + (S.discount.mode === 'percent' ? 'on' : '') + '">%</button>' +
            '</span>' +
          '</div>' + discHintHtml() + '</div>' +
        '<div><span class="lbl">' + t('coupon') + '</span>' +
          (S.coupon
            ? '<div style="display:flex;gap:4px;align-items:center;height:34px">' +
                '<span class="badge accent">' + CONFIG.COUPON.code + ' −' + CONFIG.COUPON.percent + '%</span>' +
                '<button class="btn btn-sm btn-ghost" data-pos="coupon-clear">' + t('remove') + '</button></div>'
            : '<div style="display:flex;gap:4px">' +
                '<input class="inp" id="posCoupon" type="text" placeholder="OG20">' +
                '<button class="btn btn-sm" style="flex:none" data-pos="coupon">' + t('apply') + '</button></div>') +
        '</div>' +
      '</div>' +

      '<div id="cartTotals">' + totalsHtml() + '</div>' +
      whGridHtml() +
      payGridHtml() +
      printBoxHtml() +

      '<button class="btn btn-primary btn-block btn-lg" data-pos="complete"' + (S.cart.length ? '' : ' disabled') + '>' +
        t('complete_sale') + ' · ' + money(x.total) + ' <span class="keycap">F4</span></button>';
  }

  function render() {
    var cats = Object.keys(DB.typeLabels);

    var h = '<div class="pos">' +
      '<div class="pos-left">' +
        '<div class="pos-scanbar">' +
          '<div class="scan-wrap">' +
            '<input class="scan-input" id="posScan" type="text" autocomplete="off" spellcheck="false" ' +
              'placeholder="' + t('scan_ph') + '" value="' + esc(S.q) + '">' +
            /* Camera first — on a phone this is the primary way in, and the
               random-scan button is the demo shortcut beside it. */
            '<button class="btn btn-primary btn-lg" style="flex:none" data-act="scan-open" ' +
              'title="' + esc(t('sc_title')) + '">' +
              '<svg viewBox="0 0 24 24" stroke-linecap="square" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2">' +
                '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M3 12h18"/></svg></button>' +
            '<button class="btn btn-dark btn-lg" style="flex:none" data-pos="scan-random">⌁ ' + t('scan_btn') + '</button>' +
          '</div>' +
          '<div class="scan-meta">' +
            '<span class="hint-chip">' + t('try_scanning') + ' <b>' + CONFIG.DEMO_BARCODE + '</b></span>' +
            '<button class="btn btn-sm btn-ghost" data-pos="fill-demo">↧</button>' +
            '<button class="btn btn-sm btn-ghost" data-act="export" data-kind="pdf">' + t('ex_till') + '</button>' +
            '<span class="keys">' +
              '<span><span class="keycap">↵</span> ' + (OG.lang === 'ar' ? 'مسح' : 'scan') + '</span>' +
              '<span><span class="keycap">F2</span> ' + (OG.lang === 'ar' ? 'زبون' : 'customer') + '</span>' +
              '<span><span class="keycap">F4</span> ' + (OG.lang === 'ar' ? 'إتمام' : 'complete') + '</span>' +
            '</span>' +
          '</div>' +
        '</div>' +

        '<div class="pos-cats">' +
          '<button class="chip' + (S.cat === '' ? ' on' : '') + '" data-pos="cat" data-c="">' + t('all_products') + '</button>';
    cats.forEach(function (c) {
      h += '<button class="chip' + (S.cat === c ? ' on' : '') + '" data-pos="cat" data-c="' + c + '">' + DB.typeLabels[c] + '</button>';
    });
    h += '</div>' +
        '<div class="pos-grid-wrap"><div class="pos-grid" id="posGrid">' + gridHtml() + '</div></div>' +
      '</div>' +

      '<div class="pos-right">' +
        /* On a phone this row is the sheet handle — tapping it opens the
           cart. On desktop the click does nothing visible, because the cart
           is already a column. */
        '<div class="cart-head" data-pos="cart-toggle"><h3>' + t('cart') + '</h3>' +
          '<span class="badge accent" id="cartCount">' + cartCount() + '</span>' +
          '<span class="cart-peek num">' + money(totals().total) + '</span>' +
          '<button class="btn btn-sm btn-ghost" style="margin-inline-start:auto" ' +
            'onclick="event.stopPropagation()" data-pos="clear">' + t('clear') + '</button></div>' +
        '<div class="cart-lines" id="cartLines">' + linesHtml() + '</div>' +
        '<div class="cart-foot" id="cartFoot">' + footHtml() + '</div>' +
      '</div>' +
    '</div>';

    return h;
  }

  /* ------------------------------------------------------- sub-renderers */

  function paintGrid() {
    var g = document.getElementById('posGrid');
    if (g) g.innerHTML = gridHtml();
  }

  function paintCart() {
    var lines = document.getElementById('cartLines');
    if (lines) lines.innerHTML = linesHtml();
    var cnt = document.getElementById('cartCount');
    if (cnt) cnt.textContent = cartCount();
    paintFoot();
    if (S.flashSku) {
      var row = document.querySelector('.cart-line[data-sku="' + S.flashSku + '"]');
      if (row) { row.scrollIntoView({ block: 'nearest' }); }
      S.flashSku = null;
    }
    paintGrid();
  }

  /* Confirms the scan landed, before the eye reaches the cart. At a till the
     feedback loop matters more than the animation: he needs to know it took
     without looking away from the next item in his hand. */
  function pulseScan(good) {
    var inp = document.getElementById('posScan');
    if (!inp || (typeof Motion !== 'undefined' && Motion.reduced())) return;
    var cls = good ? 'hit' : 'miss';
    inp.classList.remove('hit', 'miss');
    void inp.offsetWidth;                 // restart the animation on a repeat scan
    inp.classList.add(cls);
    setTimeout(function () { inp.classList.remove(cls); }, good ? 420 : 520);
  }

  /* The grand total re-counts to its new value rather than swapping. Reuses
     the same count-up the dashboard KPIs use, so the easing matches. */
  function countTotal() {
    if (typeof Motion === 'undefined') return;
    var el = document.querySelector('#cartTotals .tr.grand span:last-child');
    if (el) Motion.count(el);
  }

  function paintFoot() {
    var f = document.getElementById('cartFoot');
    if (f) f.innerHTML = footHtml();
  }

  function paintTotals() {
    var el = document.getElementById('cartTotals');
    if (el) el.innerHTML = totalsHtml();
    var btn = document.querySelector('[data-pos="complete"]');
    if (btn) btn.innerHTML = t('complete_sale') + ' · ' + money(totals().total) + ' <span class="keycap">F4</span>';
  }

  /* -------------------------------------------------------- size picker */

  function openSizePicker(pid) {
    var p = DB.product(pid);
    var vs = DB.variantsOf(pid);
    var body = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">' +
      thumb(p, 'lg') + '<div><span class="eyebrow">' + esc(p.brand) + ' · ' + DB.typeLabels[p.type] + '</span>' +
      '<h3 style="font-size:16px;margin:2px 0 3px">' + esc(p.name) + '</h3>' +
      '<div class="strong-num" style="font-size:17px">' + money(p.sellingPrice) + '</div></div></div>' +
      '<div class="lbl">' + t('pick_size') + '</div><div class="size-pop">';
    /* Each size shows what is HERE and, when it differs, what is elsewhere.
       A size with nothing on the wall but stock in the back stays enabled —
       tapping it offers to fetch it, which is more useful than a dead button
       that makes the shop look empty when it is not. */
    vs.forEach(function (v) {
      var here = DB.stockAt(v, S.warehouse);
      var back = DB.stockElsewhere(v, S.warehouse);
      var cls = 'size-btn' + (here <= 0 && back > 0 ? ' size-elsewhere' : '');
      var note = here > 0
        ? here + ' ' + t('in_stock')
        : (back > 0 ? back + ' ' + t('wh_in_the_back') : t('out'));
      body += '<button class="' + cls + '" data-pos="size" data-sku="' + v.sku + '"' +
        (here <= 0 && back <= 0 ? ' disabled' : '') + '>' +
        v.size + '<small>' + note + '</small></button>';
    });
    body += '</div>';
    var gaps = DB.sizeGaps(pid);
    if (gaps.length) {
      body += '<div class="partner-note note-danger">' +
        t('size_gap_warn') + ' — ' + gaps.join(', ') + '</div>';
    }
    openModal({ title: t('pick_size'), size: 'narrow', body: body });
  }

  /* ----------------------------------------------------------- checkout */

  /* Checkout has two paths, and which one runs is the whole difference between
     a demo and a shop.

       demo    — no server exists. Ring it up locally, exactly as before.
       real    — ASK THE SERVER FIRST, and only touch anything locally once it
                 has said yes.

     The order matters. This browser's idea of the stock is a guess several
     seconds old, taken before the other till rang up the same last pair. If
     the sale were applied here first and posted afterwards, a refusal would
     leave a receipt printed, a cart cleared and stock decremented for a sale
     the shop does not have — and no obvious way back. */
  function complete(silent) {
    if (!S.cart.length) {
      if (!silent) toast(t('cart'), t('empty_cart'), 'err');
      return;
    }

    if (typeof Auth === 'undefined' || Auth.demoMode()) return completeLocal(silent, null);

    /* Caught here so she is told before the customer is told. The server
       refuses this too — that is the actual boundary — but a cashier should
       not have to press Charge to discover she is not allowed. */
    if (overCap()) {
      toast(t('cart'),
            t('disc_capped').replace('{p}', MAX_DISCOUNT_PCT) + ' · ' +
            t('disc_max').replace('{v}', money(discountCeiling())),
            'err', 6000);
      return;
    }

    /* Disable while the server decides. It is about a fifth of a second, which
       is exactly long enough for an impatient second click — and two clicks
       would be two sales. The opId below makes that harmless, but not showing
       the wait at all is how people learn to double-click a till. */
    var btn = document.querySelector('[data-pos="complete"]');
    var wasLabel = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = t('complete_sale') + '…'; }

    /* One id for this attempt, reused on every retry. If the wifi drops after
       the server committed but before the reply arrived, sending the same id
       returns the original invoice instead of selling the shoes twice. */
    var opId = S.opId || (S.opId = 'op-' + Date.now() + '-' +
                                   Math.random().toString(36).slice(2, 10));

    /* Only what was scanned and how many. Prices come from the product table
       on the server — a till that names its own price is a till that can sell
       a 450,000 pair for 1,000 and leave an ordinary-looking receipt. */
    API.post('/api/sales', {
      lines: S.cart.map(function (l) { return { sku: l.sku, qty: l.qty }; }),
      whId: S.warehouse,
      customerId: S.customerId || null,
      payment: S.payment,
      discount: totals().discount,
      opId: opId
    })
      .then(function (data) {
        S.opId = null;
        /* Read before completeLocal, which resets the cart. */
        var out = wantsDelivery() ? deliveryPayload(data.sale) : null;
        completeLocal(silent, data.sale);
        if (out) sendOut(out);
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = wasLabel; }

        /* Someone else got there first. Say which item and how many are
           actually left, then reload the real numbers so the cashier is not
           looking at a screen the shop has moved on from. */
        if (err.code === 'insufficient_stock') {
          toast(t('cart'), err.message, 'err', 6000);
          if (typeof refreshAll === 'function') refreshAll();
          return;
        }

        /* Over the ceiling. Reachable even with the check above — the cap can
           be lowered in Settings while this basket is open, or the permission
           taken away mid-shift. The server's own sentence names the real
           limit and the real maximum, so it is repeated rather than
           paraphrased, and the cart is left alone to be adjusted. */
        if (err.code === 'discount_too_big') {
          toast(t('cart'), err.message, 'err', 7000);
          paintFoot();
          return;
        }

        /* Everything else — offline, timeout, signed out. The cart is left
           exactly as it was so the sale can be retried without re-scanning. */
        toast(t('cart'), API.friendly(err), 'err', 6000);
      });
  }

  /* --------------------------------------------------------- sending it out */

  function wantsDelivery() {
    if (typeof Auth === 'undefined' || Auth.demoMode()) return false;
    if (!Auth.can('delivery.write')) return false;
    return S.payment === 'cod' || S.deliver;
  }

  function deliveryPayload(sale) {
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var addr = (S.deliverAddress !== null && S.deliverAddress !== undefined)
      ? S.deliverAddress
      : ((cust && cust.address) || '');

    return {
      saleId: sale.id,
      address: String(addr).trim(),
      phone: cust ? cust.phone : null,
      /* No driver named here. The cashier does not know who is free — the
         manager assigns from the board, and an unassigned row is visible
         there. A guess would be worse than an empty field. */
      driverId: null,
      opId: 'dl-' + sale.id
    };
  }

  /* Deliberately AFTER the sale is committed, and never in the same request.

     The money is already in the drawer by the time this runs. A delivery that
     fails to save must not be able to unwind a completed sale, so a failure
     here is reported and left alone: the sale stands, and the order shows on
     the manager's board as needing an address. Rolling back real money because
     a second write failed would be the worse bug by a long way. */
  function sendOut(payload) {
    if (!payload.address) {
      toast(t('dl_assign'), t('dl_no_address'), 'warn', 6000);
      return;
    }
    Deliveries.assign(payload)
      .then(function () { toast(t('dl_assign'), t('dl_sent'), 'ok', 3000); })
      .catch(function (err) {
        toast(t('dl_assign'), API.friendly(err), 'err', 7000);
      });
  }

  function completeLocal(silent, server) {
    var x = totals();
    var cust = S.customerId ? DB.customer(S.customerId) : null;

    /* Whoever is actually standing at the till. This was hardcoded to one
       cashier's name from the demo, which was harmless while there were no
       accounts and is not any more: it is the name that goes on the receipt,
       into the stock movement log, and onto "my sales today". */
    var cashier = (typeof Auth !== 'undefined' && Auth.user() && Auth.user().name)
      ? Auth.user().name
      : 'Lubna Kayali';

    var sale = {
      /* The server's invoice number when it wrote one, so the printed receipt
         and the database agree. Two sources of numbering would eventually
         collide and print the same invoice id twice. */
      id: server ? server.id : DB.nextInvoiceId(),
      date: server ? new Date(server.at) : new Date(),
      customerId: cust ? cust.id : null,
      customerName: cust ? cust.name : t('walk_in'),
      items: S.cart.map(function (l) {
        return { sku: l.sku, productId: l.productId, name: l.name, type: l.type,
                 size: l.size, qty: l.qty, unitPrice: l.price, unitCost: l.cost };
      }),
      subtotal: x.subtotal,
      discount: x.discount,
      pointsUsed: S.pointsUsed,
      couponCode: S.coupon ? CONFIG.COUPON.code : null,
      total: x.total,
      payment: S.payment,
      warehouseId: S.warehouse,
      cashier: cashier,
      /* Stamped with the open shift, not matched by time later. A sale rung
         up before the shift opened must never drift into its drawer count. */
      shiftId: (DB.currentShift() || {}).id || null,

      /* Both come from the server and only exist on a real sale.

         publicToken is the address the receipt's QR points at. fxRate is the
         rate this sale was actually settled at — the receipt has to print
         that, not today's, or a customer comparing two receipts a month apart
         finds the same purchase quoted at two different dollar values. In
         demo mode there is no server, so the current rate is the honest
         answer and nothing is saved anyway. */
      publicToken: server ? server.publicToken : null,
      fxRate: server ? server.fxRate : CONFIG.EXCHANGE_RATE
    };

    /* --- the moment that sells the product: stock actually moves --- */
    sale.items.forEach(function (it) {
      var v = DB.variantBySku(it.sku);
      if (!v) return;
      /* Out of the location this sale was rung against, so the wall count and
         the back count each stay true. moveStock re-derives v.qty. */
      DB.moveStock(v, sale.warehouseId, -it.qty, {
        date: new Date(), type: 'sold',
        note: 'Sold, invoice #' + sale.id, user: cashier
      });
    });

    DB.sales.unshift(sale);

    var earned = Math.round(sale.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000);
    if (cust) {
      cust.totalSpent += sale.total;
      cust.loyaltyPoints = Math.max(0, cust.loyaltyPoints - S.pointsUsed + earned);
      cust.lastPurchaseDate = sale.date;
      cust.history.unshift(sale.id);
    }

    var e = DB.employees.filter(function (x2) { return x2.name === cashier; })[0];
    if (e) e.sales += sale.total;

    /* --- optional print job, straight into the Design column --- */
    var job = null;
    if (S.print.on) {
      var txtEl = document.getElementById('prText');
      var qtyEl = document.getElementById('prQty');
      var prioEl = document.getElementById('prPrio');
      var dateEl = document.getElementById('prDate');
      var pqty = Math.max(1, parseInt((qtyEl && qtyEl.value) || S.print.qty, 10) || 1);
      var pdate = (dateEl && dateEl.value) || S.print.deadline || isoAhead(5);

      job = DB.newPrintJob({
        customer: cust ? cust.name : t('walk_in'),
        phone: cust ? cust.phone : '—',
        design: ((txtEl && txtEl.value) || S.print.text || 'Custom print') + ' · ' + sale.id,
        qty: pqty,
        priority: (prioEl && prioEl.value) || S.print.priority,
        deadline: new Date(pdate + 'T12:00:00'),
        price: pqty * PRINT_UNIT_PRICE,
        cost: pqty * PRINT_UNIT_COST
      });
    }

    reset(true);
    renderSidebar();

    var lines = document.getElementById('cartLines');
    if (lines) { paintCart(); }

    /* The thermal receipt, not the A4 invoice. This is the moment the paper
       comes off the roll and goes into a customer's hand, so what is on screen
       has to be what the printer will produce. The full page is one click away
       for anyone who wants it. */
    openReceipt(sale, { newSale: true });

    if (!silent) {
      toast(t('sale_complete'), sale.id + ' · ' + money(sale.total), 'ok');
      setTimeout(function () {
        toast(t('points_earned'), '+' + nf(earned) + ' ' + t('points'), 'ok');
      }, 400);
    }
    if (job) {
      setTimeout(function () {
        toast(OG.lang === 'ar' ? 'أُرسل طلب الطباعة إلى يلا وير' : 'Print job sent to Yalla Wear',
              job.id + ' · ' + job.qty + ' pcs · ' + t(job.priority), 'ok', 4000);
      }, silent ? 300 : 900);
    }
  }

  function reset(keepView) {
    S.cart = [];
    S.customerId = null;
    S.discount = { mode: 'amount', value: 0 };
    S.coupon = null;
    S.pointsUsed = 0;
    S.payment = 'cash';
    /* Cleared with everything else. An address left behind would be attached
       to the NEXT customer's sale, and the parcel would go to the wrong door. */
    S.deliver = false;
    S.deliverAddress = null;
    S.print = { on: false, text: '', qty: 1, priority: 'normal', deadline: null };
    S.q = '';
    S.cat = '';
    if (!keepView) { paintCart(); paintGrid(); }
  }

  /* -------------------------------------------------------- interactions */

  var ACT = {
    pick: function (el) { openSizePicker(+el.getAttribute('data-id')); },

    size: function (el) {
      var v = DB.variantBySku(el.getAttribute('data-sku'));
      closeModal();
      addVariant(v);
      focusScan();
    },

    cat: function (el) { S.cat = el.getAttribute('data-c'); renderShellPos(); },

    'scan-random': function () { randomScan(); },

    /* Phone only: the cart sheet. Desktop ignores it because the CSS that
       makes the cart a sheet only exists below 720px. */
    'cart-toggle': function () {
      var open = document.body.getAttribute('data-cart') === 'open';
      if (open) document.body.removeAttribute('data-cart');
      else document.body.setAttribute('data-cart', 'open');
    },

    'fill-demo': function () {
      var inp = document.getElementById('posScan');
      if (inp) { inp.value = CONFIG.DEMO_BARCODE; inp.focus(); inp.select(); }
    },

    inc: function (el) {
      var l = S.cart[+el.getAttribute('data-i')];
      if (l.qty >= stockFor(l.sku)) { toast(t('out_of_stock'), l.name + ' · ' + l.size, 'err'); return; }
      l.qty += 1; S.flashSku = l.sku; paintCart();
    },
    dec: function (el) {
      var i = +el.getAttribute('data-i');
      S.cart[i].qty -= 1;
      if (S.cart[i].qty <= 0) S.cart.splice(i, 1);
      paintCart();
    },
    del: function (el) { S.cart.splice(+el.getAttribute('data-i'), 1); paintCart(); },
    clear: function () { S.cart = []; S.coupon = null; S.pointsUsed = 0; paintCart(); },

    'disc-mode': function (el) { S.discount.mode = el.getAttribute('data-m'); paintFoot(); },

    coupon: function () {
      var el = document.getElementById('posCoupon');
      var code = (el && el.value || '').trim().toUpperCase();
      if (code === CONFIG.COUPON.code) {
        S.coupon = code;
        toast(t('coupon'), CONFIG.COUPON.code + ' · −' + CONFIG.COUPON.percent + '%', 'ok');
        paintFoot();
      } else {
        toast(t('coupon'), (OG.lang === 'ar' ? 'كود غير صالح: ' : 'Invalid code: ') + (code || '—'), 'err');
      }
    },
    'coupon-clear': function () { S.coupon = null; paintFoot(); },

    'cust-clear': function () { S.customerId = null; S.pointsUsed = 0; paintFoot(); setTimeout(focusCust, 30); },

    'cust-pick': function (el) {
      S.customerId = +el.getAttribute('data-id');
      paintFoot();
      var c = DB.customer(S.customerId);
      toast(t('customer'), c.name + ' · ' + nf(c.loyaltyPoints) + ' ' + t('points'), 'ok', 2000);
    },

    redeem: function () {
      var c = DB.customer(S.customerId);
      S.pointsUsed = Math.min(500, c.loyaltyPoints);
      toast(t('loyalty'), '− ' + money(S.pointsUsed * CONFIG.LOYALTY_POINT_VALUE), 'ok');
      paintFoot();
    },
    unredeem: function () { S.pointsUsed = 0; paintFoot(); },

    pay: function (el) { S.payment = el.getAttribute('data-m'); paintFoot(); },

    /* Switching location re-renders the whole POS body, not just the footer:
       the product grid's availability badges and every size in the picker are
       now describing a different shelf. */
    wh: function (el) {
      S.warehouse = el.getAttribute('data-w');
      renderShellPos();
    },

    /* "Bring one out" from the out-of-stock toast. Moves a single pair from
       wherever it actually is into the till's location, then adds it — so the
       cashier's one tap both fixes the shelf and completes the scan. */
    bring: function (el) {
      var v = DB.variantBySku(el.getAttribute('data-sku'));
      if (!v) return;
      var from = null;
      DB.warehouses.forEach(function (w) {
        if (!from && w.id !== S.warehouse && DB.stockAt(v, w.id) > 0) from = w.id;
      });
      if (!from) { toast(t('out_of_stock'), '', 'err'); return; }

      DB.transfer(v, from, S.warehouse, 1, 'POS');
      var p = DB.product(v.productId);
      toast(t('wh_moved'),
            p.name + ' · ' + t('size') + ' ' + v.size + ' — ' +
              DB.whName(from, OG.lang === 'ar') + ' → ' +
              DB.whName(S.warehouse, OG.lang === 'ar'),
            'ok');
      addVariant(v, true);
      renderShellPos();
      focusScan();
    },

    complete: function () { complete(); }
  };

  /* Re-render only the POS body, keeping the app shell untouched. */
  function renderShellPos() {
    var host = document.getElementById('view');
    if (!host) return;
    host.innerHTML = render();
    after();
  }

  function focusScan() {
    var el = document.getElementById('posScan');
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.select();
  }

  function focusCust() {
    var el = document.getElementById('posCust');
    if (el) el.focus();
    else {
      var btn = document.querySelector('[data-pos="cust-clear"]');
      if (btn) btn.click();
    }
  }

  function custDrop(q) {
    var box = document.getElementById('custDrop');
    if (!box) return;
    q = (q || '').trim().toLowerCase();
    if (q.length < 3) { box.innerHTML = ''; return; }
    var digits = q.replace(/\D/g, '');
    var hits = DB.customers.filter(function (c) {
      var phone = c.phone.replace(/\D/g, '');
      return (digits.length >= 3 && phone.indexOf(digits) > -1) || c.name.toLowerCase().indexOf(q) > -1;
    }).slice(0, 6);

    if (!hits.length) { box.innerHTML = '<div class="cust-drop"><div class="muted">' + t('no_results') + '</div></div>'; return; }
    var h = '<div class="cust-drop">';
    hits.forEach(function (c) {
      h += '<div data-pos="cust-pick" data-id="' + c.id + '"><b>' + esc(c.name) + '</b> ' +
        '<span class="muted num">' + tel(c.phone) + '</span>' +
        '<small>' + nf(c.loyaltyPoints) + ' ' + t('points') + '</small></div>';
    });
    box.innerHTML = h + '</div>';
  }

  /* Called by app.js after the POS view is inserted into the DOM. */
  function after() {
    S.print.deadline = S.print.deadline || isoAhead(5);
    setTimeout(focusScan, 60);
  }

  /* --------------------------------------------------------- global bind */

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-pos]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-pos')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });

    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'posScan') {
        S.q = el.value;
        /* A real scanner types fast and ends with Enter; free text filters live. */
        if (!/^\d{8,}$/.test(el.value.trim())) paintGrid();
        return;
      }
      var k = el.getAttribute && el.getAttribute('data-pos-input');
      if (k === 'cust') { custDrop(el.value); return; }
      if (k === 'disc') {
        S.discount.value = Math.max(0, parseInt(el.value, 10) || 0);
        paintTotals();
        paintDiscHint();
        return;
      }
      /* Kept in state on every keystroke rather than read off the DOM at the
         end, because the foot repaints when the payment method changes and
         a half-typed address would vanish with it. */
      if (k === 'addr') { S.deliverAddress = el.value; return; }
      if (el.id === 'prText') S.print.text = el.value;
      if (el.id === 'prQty') S.print.qty = Math.max(1, parseInt(el.value, 10) || 1);
      if (el.id === 'prDate') S.print.deadline = el.value;
    });

    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.getAttribute && el.getAttribute('data-pos-check') === 'print') {
        S.print.on = el.checked;
        paintFoot();
      }
      if (el.getAttribute && el.getAttribute('data-pos-check') === 'deliver') {
        S.deliver = el.checked;
        paintFoot();
      }
      if (el.id === 'prPrio') S.print.priority = el.value;
    });

    document.addEventListener('keydown', function (e) {
      if (OG.view !== 'pos') return;

      if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'posScan') {
        e.preventDefault();
        var val = document.activeElement.value.trim();
        if (!val) { randomScan(); return; }
        if (/^\d{6,}$/.test(val)) {
          if (scanBarcode(val)) { document.activeElement.value = ''; S.q = ''; paintGrid(); }
        } else {
          var list = filteredProducts();
          if (list.length === 1) openSizePicker(list[0].id);
          else if (list.length) openSizePicker(list[0].id);
        }
        return;
      }

      if (e.key === 'F2') { e.preventDefault(); focusCust(); }
      if (e.key === 'F4') { e.preventDefault(); if (!modalOpen()) complete(); }
    });
  }

  bind();

  return {
    render: render,
    after: after,
    complete: complete,
    reset: reset,
    scanBarcode: scanBarcode,
    add: addVariant,
    state: S
  };
})();
