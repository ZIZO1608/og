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
    cat: '',
    q: '',
    flashSku: null,
    print: { on: false, text: '', qty: 1, priority: 'normal', deadline: null }
  };

  var PRINT_UNIT_PRICE = 95000;   // charged to the customer, per piece
  var PRINT_UNIT_COST  = 46000;   // paid to Yalla Wear, per piece

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

  /* -------------------------------------------------------------- adding */

  function stockFor(sku) {
    var v = DB.variantBySku(sku);
    return v ? v.qty : 0;
  }

  function addVariant(v, silent) {
    if (!v) return false;
    var p = DB.product(v.productId);
    var line = S.cart.filter(function (l) { return l.sku === v.sku; })[0];
    var inCart = line ? line.qty : 0;

    if (v.qty <= inCart) {
      if (!silent) toast(t('out_of_stock'), p.name + ' · ' + t('size') + ' ' + v.size, 'err');
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
    return true;
  }

  function scanBarcode(code, silent) {
    code = String(code || '').trim();
    if (!code) return false;
    var v = DB.variantByBarcode(code);
    if (!v) {
      if (!silent) toast(t('scan_btn'), (OG.lang === 'ar' ? 'باركود غير معروف: ' : 'Unknown barcode: ') + code, 'err');
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

  function payGridHtml() {
    var h = '<span class="lbl">' + t('payment_method') + '</span><div class="pay-grid" id="payGrid">';
    DB.paymentMethods.forEach(function (m) {
      h += '<button class="' + (S.payment === m ? 'on' : '') + '" data-pos="pay" data-m="' + m + '">' + DB.paymentLabels[m] + '</button>';
    });
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

  function footHtml() {
    var x = totals();
    return '<div id="custWrap">' + custBoxHtml() + '</div>' +

      '<div class="row2 mt">' +
        '<div><span class="lbl">' + t('discount') + '</span>' +
          '<div style="display:flex;gap:4px">' +
            '<input class="inp num" id="posDisc" type="number" min="0" placeholder="0" value="' + (S.discount.value || '') + '" data-pos-input="disc">' +
            '<span class="seg" style="flex:none">' +
              '<button data-pos="disc-mode" data-m="amount" class="' + (S.discount.mode === 'amount' ? 'on' : '') + '">#</button>' +
              '<button data-pos="disc-mode" data-m="percent" class="' + (S.discount.mode === 'percent' ? 'on' : '') + '">%</button>' +
            '</span>' +
          '</div></div>' +
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
        '<div class="cart-head"><h3>' + t('cart') + '</h3>' +
          '<span class="badge accent" id="cartCount">' + cartCount() + '</span>' +
          '<button class="btn btn-sm btn-ghost" style="margin-inline-start:auto" data-pos="clear">' + t('clear') + '</button></div>' +
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
    vs.forEach(function (v) {
      body += '<button class="size-btn" data-pos="size" data-sku="' + v.sku + '"' + (v.qty <= 0 ? ' disabled' : '') + '>' +
        v.size + '<small>' + (v.qty > 0 ? v.qty + ' ' + t('in_stock') : t('out')) + '</small></button>';
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

  function complete(silent) {
    if (!S.cart.length) {
      if (!silent) toast(t('cart'), t('empty_cart'), 'err');
      return;
    }

    var x = totals();
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var cashier = 'Lubna Kayali';

    var sale = {
      id: DB.nextInvoiceId(),
      date: new Date(),
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
      cashier: cashier
    };

    /* --- the moment that sells the product: stock actually moves --- */
    sale.items.forEach(function (it) {
      var v = DB.variantBySku(it.sku);
      if (!v) return;
      v.qty = Math.max(0, v.qty - it.qty);
      DB.logMovement({
        date: new Date(), sku: v.sku, productId: v.productId, size: v.size,
        type: 'sold', delta: -it.qty, note: 'Sold, invoice #' + sale.id,
        user: cashier, balance: v.qty
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

    openInvoice(sale, { newSale: true });

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
        return;
      }
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
