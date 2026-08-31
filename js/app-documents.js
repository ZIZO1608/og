/* ==========================================================================
   OG SYSTEM — application shell  ·  12/17: INVOICE (A4) + THE THERMAL RECEIPT
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 5438-5731). Loads after
   app-settings.js.
   ========================================================================== */

/* --------------------------------------------------------------- 15. INVOICE */

function invoiceHtml(sale) {
  var cust = sale.customerId ? DB.customer(sale.customerId) : null;
  var earned = Math.round(sale.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000);

  var h = '<div class="invoice-sheet">' +
    '<div class="inv-top"><div class="inv-logo"><div class="brand-mark"><img src="assets/logo.svg" alt="OG"></div>' +
      '<div><b>OG SYSTEM</b><small>' + CONFIG.SHOP_TAGLINE + '</small></div></div>' +
      '<div class="inv-meta"><b>' + sale.id + '</b><br>' + fmtDateTime(sale.date) + '<br>' +
      DB.payLabel(sale.payment) + '</div></div>' +

    '<div class="inv-parties">' +
      '<div><div class="lbl">' + t('bill_to') + '</div><b>' + esc(cust ? cust.name : t('walk_in')) + '</b>' +
        (cust ? '<br><span class="num">' + esc(cust.phone) + '</span><br>' + esc(cust.city) : '') + '</div>' +
      '<div style="text-align:end"><div class="lbl">' + t('served_by') + '</div><b>' + esc(sale.cashier) + '</b><br>' +
        esc(CONFIG.SHOP_ADDRESS) + '<br>' + tel(CONFIG.SHOP_PHONE) + '</div>' +
    '</div>' +

    '<table class="inv-tbl"><thead><tr><th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('qty') + '</th><th class="num">' + t('unit_price') + '</th>' +
      '<th class="num">' + t('line_total') + '</th></tr></thead><tbody>';
  sale.items.forEach(function (it) {
    h += '<tr><td>' + esc(it.name) + '</td><td>' + it.size + '</td>' +
      '<td class="num">' + it.qty + '</td><td class="num">' + money(it.unitPrice) + '</td>' +
      '<td class="num">' + money(it.qty * it.unitPrice) + '</td></tr>';
  });
  h += '</tbody></table>';

  h += '<div class="inv-sum">' +
    '<div><div class="inv-qr">' +
        qrSafe(qrForSale(sale), sale.id, { size: 104, quiet: 2, style: 'square', dark: '#09090B' }) +
      '</div>' +
      '<div style="font-size:9px;color:#71717A;margin-top:4px;letter-spacing:.08em">' + sale.id + '</div></div>' +
    '<div class="inv-totals">' +
      '<div class="tr"><span>' + t('subtotal') + '</span><span>' + money(sale.subtotal) + '</span></div>' +
      (sale.discount ? '<div class="tr"><span>' + t('discount') + (sale.couponCode ? ' (' + sale.couponCode + ')' : '') +
        '</span><span>− ' + money(sale.discount) + '</span></div>' : '') +
      (sale.pointsUsed ? '<div class="tr"><span>' + t('loyalty') + ' (' + sale.pointsUsed + ' ' + t('points') + ')</span>' +
        '<span>− ' + money(sale.pointsUsed * CONFIG.LOYALTY_POINT_VALUE) + '</span></div>' : '') +
      '<div class="tr"><span>' + t('payment_method') + '</span><span>' + DB.payLabel(sale.payment) + '</span></div>' +
      (sale.txnRef ? '<div class="tr"><span>' + t('txn_ref') + '</span>' +
        '<span class="num" dir="ltr">' + esc(sale.txnRef) + '</span></div>' : '') +
      '<div class="tr grand"><span>' + t('total') + '</span><span>' + money(sale.total) + '</span></div>' +
      (OG.currency === 'SYP' ? '<div class="tr" style="color:#666;font-size:11px"><span></span><span>≈ $' +
        nf(sale.total / CONFIG.EXCHANGE_RATE) + '</span></div>' : '') +
    '</div>' +
  '</div>';

  h += '<div class="inv-loyalty"><span>' + t('points_earned') + '</span><b>+' + nf(earned) + ' ' + t('points') +
    (cust ? ' &nbsp;·&nbsp; <span style="font-weight:400;font-size:11px">' + t('total') + ' ' + nf(cust.loyaltyPoints) + '</span>' : '') + '</b></div>';

  h += '<div class="inv-foot">' + t('thank_you') + ' · ' + CONFIG.SHOP_NAME + ' · ' + esc(CONFIG.SHOP_ADDRESS) + ' · ' + tel(CONFIG.SHOP_PHONE) + '</div>';
  h += '</div>';
  return h;
}

/* ==========================================================================
   THE THERMAL RECEIPT
   --------------------------------------------------------------------------
   80mm roll, 5mm clear each side, 70mm of content, height continuous. This is
   what the customer actually walks out holding, so it is designed for the
   machine that prints it rather than for the screen it is composed on.

   A 203dpi thermal head prints ONE BIT PER DOT. There is no grey. Everything
   the A4 invoice does with #71717A, soft borders and background fills either
   disappears or dithers into speckle. So:

     * hierarchy comes from WEIGHT AND SIZE only, and every colour is #000;
     * separators are dashed rules at a real millimetre weight, never 1px;
     * nothing smaller than 8pt — below that the head fills in the counters of
       the letters and the line turns to mush;
     * money is tabular so the column lines up down the whole receipt;
     * the QR gets 22mm and crispEdges, or its modules land on half-dots and
       a phone stops reading it.

   Reuses `Codes.qrSVG` (already ECC level H — 30% recovery, which is the
   headroom a smudged thermal print needs) and the app's own `money()`, `t()`
   and `esc()`. */

var RECEIPT_WIDTHS = { '80': { paper: 80, pad: 5 }, '58': { paper: 58, pad: 4 } };

function receiptDim() {
  return RECEIPT_WIDTHS[OG.rc && OG.rc.width] || RECEIPT_WIDTHS['80'];
}

/* @page cannot read a CSS variable, so the paper size is injected as a real
   stylesheet at print time — the same trick setRollPageSize() uses for labels. */
function setReceiptPageSize() {
  var id = 'receiptPageRule';
  var old = document.getElementById(id);
  if (old) old.parentNode.removeChild(old);

  var d = receiptDim();
  var content = d.paper - d.pad * 2;
  var st = document.createElement('style');
  st.id = id;
  /* The width is set for the SCREEN as well as for print. A preview that is
     always 70mm wide while the printer is loaded with a 58mm roll is not a
     preview — the cashier would approve a layout on screen and get a
     different one out of the machine, with the money column shaved off the
     edge. Same number, both places, from one source. */
  st.textContent =
    '.receipt{width:' + content + 'mm}' +
    '@media print{@page{size:' + d.paper + 'mm auto;margin:0}' +
    '.receipt{width:' + content + 'mm;margin:0 ' + d.pad + 'mm}}';
  document.head.appendChild(st);
}

/* ---- putting the paper back ------------------------------------------------
   `@page` is a PAGE-level at-rule. No body class scopes it, no selector
   reaches it, and nothing takes it away on its own — so the 80mm receipt rule
   and the label roll's rule both outlive the screen that injected them and
   silently re-size the next thing anybody prints, from any screen.

   That was live, and it is why a Products export came out as eight sheets
   with the shop name sliced down the middle: a receipt had been opened
   earlier in the session, and the A4 report was being laid out on an 80mm
   till roll. openReceipt() already tried to undo this by removing the
   `printing-receipt` class on close, which was a reasonable guess and could
   never have worked — the class was never what carried the size. */
function clearReceiptPageSize() {
  var old = document.getElementById('receiptPageRule');
  if (old) old.parentNode.removeChild(old);
}

/* A4, whatever the last thing printed was.

   Documents ASSERT their paper rather than inheriting it. Relying on the
   previous screen to have cleaned up is what broke this in the first place,
   and a report is the one thing here that must come out the same on the
   hundredth print as on the first. */
function setDocPageSize() {
  clearReceiptPageSize();

  var roll = document.getElementById('rollPageRule');
  if (roll) roll.parentNode.removeChild(roll);
  document.body.classList.remove('roll-labels');
  document.body.classList.remove('printing-receipt');

  var id = 'docPageRule';
  var old = document.getElementById(id);
  if (old) old.parentNode.removeChild(old);

  var st = document.createElement('style');
  st.id = id;
  /* The same 12mm the stylesheet has always used for a document — restated
     here because an injected rule beats the stylesheet's, so putting the
     margin back is part of putting the size back. */
  st.textContent = '@media print{@page{size:A4;margin:12mm}}';
  document.head.appendChild(st);
}

/* A money figure with no currency suffix.

   70mm does not fit "Size 42  1 × 12,500 SYP" and "12,500 SYP" on one line —
   they collide, and the collision only shows up on the longest item in the
   basket, which is exactly the one nobody tests with. Every receipt in every
   shop solves this the same way: bare numbers down the item list, the currency
   named once on the total. The dollar sign stays because it is one character
   and it sits in front, where its absence would change the meaning. */
function moneyBare(v) {
  return OG.currency === 'USD'
    ? '$' + nf((Number(v) || 0) / CONFIG.EXCHANGE_RATE)
    : nf(v);
}

function receiptHtml(sale) {
  var cust = sale.customerId ? DB.customer(sale.customerId) : null;
  var earned = Math.round(sale.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000);
  var ar = OG.lang === 'ar';

  var addr = ar ? (CONFIG.SHOP_ADDRESS_AR || CONFIG.SHOP_ADDRESS) : CONFIG.SHOP_ADDRESS;

  var h = '<div class="receipt" dir="' + (ar ? 'rtl' : 'ltr') + '">';

  /* ---- head ---- */
  h += '<div class="rcp-head">' +
    '<div class="rcp-mark"><img src="assets/logo.svg" alt=""></div>' +
    '<div class="rcp-shop">' + esc(CONFIG.SHOP_NAME.toUpperCase()) + '</div>' +
    '<div class="rcp-tag">' + esc(CONFIG.SHOP_TAGLINE) + '</div>' +
    '<div class="rcp-tag">' + esc(addr) + '</div>' +
  '</div>';

  h += '<div class="rcp-rule"></div>';

  /* ---- who, when ---- */
  h += '<div class="rcp-meta">' +
    '<div><span>' + t('invoice') + '</span><b>' + esc(sale.id) + '</b></div>' +
    '<div><span>' + t('date') + '</span><b>' + fmtDateTime(sale.date) + '</b></div>' +
    '<div><span>' + t('served_by') + '</span><b>' + esc(String(sale.cashier || '').split(' ')[0]) + '</b></div>' +
    (cust ? '<div><span>' + t('customer') + '</span><b>' + esc(cust.name) + '</b></div>' : '') +
  '</div>';

  h += '<div class="rcp-rule"></div>';

  /* ---- the goods ----
     Name on its own line, then size / qty / money on the next. Two lines per
     item rather than one cramped row: at 70mm a product name and three
     numbers on the same line means the name gets four characters. */
  /* Flex rows, not a table.

     A table looked right and measured wrong: the full-width `colspan="2"`
     product-name row feeds its width back into BOTH columns, so the money
     column kept a share of the name's length and the amounts floated 37mm
     short of the paper edge. Every total on this receipt is already a flex
     row and every one of them lands exactly on the edge, so the items use the
     same thing rather than a second mechanism that has to be argued with. */
  h += '<div class="rcp-items">';
  sale.items.forEach(function (it) {
    h += '<div class="rcp-name">' + esc(it.name) + '</div>' +
      '<div class="rcp-line">' +
        '<span>' + (it.size ? esc(it.size) + '  ·  ' : '') +
          it.qty + ' × ' + moneyBare(it.unitPrice) + '</span>' +
        '<span class="rcp-amt">' + moneyBare(it.qty * it.unitPrice) + '</span>' +
      '</div>';
  });
  h += '</div>';

  h += '<div class="rcp-rule"></div>';

  /* ---- the money ---- */
  h += '<div class="rcp-tot"><span>' + t('subtotal') + '</span><span>' + moneyBare(sale.subtotal) + '</span></div>';
  if (sale.discount) {
    h += '<div class="rcp-tot"><span>' + t('discount') + '</span><span>− ' + moneyBare(sale.discount) + '</span></div>';
  }
  if (sale.pointsUsed) {
    h += '<div class="rcp-tot"><span>' + t('loyalty') + '</span><span>− ' +
         moneyBare(sale.pointsUsed * CONFIG.LOYALTY_POINT_VALUE) + '</span></div>';
  }
  h += '<div class="rcp-tot"><span>' + t('payment_method') + '</span><span>' +
       DB.payLabel(sale.payment) + '</span></div>';

  if (sale.txnRef) {
    h += '<div class="rcp-tot"><span>' + t('txn_ref') + '</span>' +
         '<span class="num" dir="ltr">' + esc(sale.txnRef) + '</span></div>';
  }

  h += '<div class="rcp-grand"><span>' + t('total') + '</span><span>' + money(sale.total) + '</span></div>';

  /* The dollar value at the rate of THIS sale. A receipt has to say the same
     thing in a year as it did on the day. */
  var rate = sale.fxRate || CONFIG.EXCHANGE_RATE;
  h += '<div class="rcp-usd">≈ $' + nf(sale.total / rate) + '  ·  1 $ = ' + nf(rate) + '</div>';

  if (cust) {
    h += '<div class="rcp-rule"></div>' +
      '<div class="rcp-tot"><span>' + t('points_earned') + '</span><span>+' + nf(earned) + '</span></div>' +
      '<div class="rcp-tot"><span>' + t('total') + ' ' + t('points') + '</span><span>' +
        nf(cust.loyaltyPoints) + '</span></div>';
  }

  h += '<div class="rcp-foot">' +
    '<div class="rcp-policy">' + t('rc_policy') + '</div>' +
    '<div>' + t('thank_you') + ' · ' + esc(CONFIG.SHOP_NAME) + '</div>' +
    '<div class="rcp-tag">' + tel(CONFIG.SHOP_PHONE || '') + '</div>' +
  '</div>';

  return h + '</div>';
}

/* The receipt goes in the same modal shell the invoice uses, so print, PDF and
   the close button all keep working with no new plumbing. */
function openReceipt(sale, opts) {
  opts = opts || {};
  setReceiptPageSize();
  document.body.classList.add('printing-receipt');
  openModal({
    title: t('rc_title') + ' ' + sale.id,
    /* The print-and-tear animation (css/print-hardware-receipt-newlabels.css's
       .rc-fresh) only plays for the sale that just happened — a reprint pulled
       up later is a lookup, not a moment, and replaying "fresh off the press"
       on a receipt from three days ago would read as a bug, not a delight. */
    body: opts.newSale ? '<div class="rc-fresh">' + receiptHtml(sale) + '</div>' : receiptHtml(sale),
    foot: '<button class="btn btn-ghost" data-act="rc-invoice" data-id="' + esc(sale.id) + '">' +
            t('rc_full_page') + '</button>' +
          '<button class="btn" data-act="print-receipt-now">' + t('print') + '</button>' +
          (allow('sale.reprint')
            ? '<button class="btn" data-act="approve-receipt" data-id="' + esc(sale.id) + '">' +
                t('print_receipt') + '</button>' +
              /* The slip that goes in the bag with a present: same sale, no
                 prices on it. Here as well as in POS because the ask usually
                 comes after the sale is closed — often days later, when
                 somebody comes back and says it was a gift. */
              '<button class="btn" data-act="gift-receipt" data-id="' + esc(sale.id) + '">' +
                t('gift_receipt') + '</button>'
            : '') +
          (opts.newSale
            ? '<button class="btn btn-primary" data-act="new-sale">' + t('new_sale') + '</button>'
            : '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>'),
    /* Both halves have to come off however the modal is dismissed, or the next
       thing anyone prints from any screen comes out 80mm wide.

       The class alone was the original attempt and could not work: the class
       styles the receipt BODY, while the paper size lives in an injected
       @page rule that no selector reaches. Removing the rule is the half that
       actually puts A4 back. */
    onClose: function () {
      document.body.classList.remove('printing-receipt');
      clearReceiptPageSize();
    }
  });
}

function openInvoice(sale, opts) {
  opts = opts || {};
  openModal({
    title: t('invoice') + ' ' + sale.id,
    size: 'wide',
    body: invoiceHtml(sale),
    foot: '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('pdf') + '</button>' +
          '<button class="btn" data-act="print-doc">' + t('print') + '</button>' +
          /* One button, not "Preview" next to "Print receipt". The old pair
             made checking the slip optional and put the unchecked path one
             click closer; this opens the real rendered receipt with Print
             inside it, so the look and the print are the same gesture. */
          (allow('sale.reprint')
            ? '<button class="btn" data-act="approve-receipt" data-id="' + esc(sale.id) + '">' +
                t('print_receipt') + '</button>' +
              '<button class="btn" data-act="gift-receipt" data-id="' + esc(sale.id) + '">' +
                t('gift_receipt') + '</button>'
            : '') +
          (opts.newSale
            ? '<button class="btn btn-primary" data-act="new-sale">' + t('new_sale') + '</button>'
            : '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>')
  });
}
