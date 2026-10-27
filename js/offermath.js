/* ==========================================================================
   OFFER MATH — what an offer does to a price, and to a basket       (076)
   --------------------------------------------------------------------------
   ONE COPY, TWO READERS. This file is a plain script: the browser loads it
   as `window.OfferMath` (the till, the order desk, the Offers page) and the
   server imports it for its side effect (lib/offers.js) and reads
   `globalThis.OfferMath`. What the till shows is what the sale charges
   because there is only one rule to show it from.

   THE THIRD COPY is web.offer_of() in server/supabase/043_offers.sql — the
   unit price only (the website's badge), never the basket. KEEP IN STEP.

   Prices are minor units of the product's own currency (USD cents since
   067). `off` and `price` are written in USD cents and only apply to a
   product priced in dollars; `pct` applies to any.

   An offer here is the PUBLIC shape (lib/offers.js publicRow):
     { id, kind, pct, amount, buyQty, getQty, scope, targets:[{kind,ref,exclude}],
       startsAt, endsAt, maxUnits, stackCoupons, active }
   `sold` is a map offer id -> pieces already sold under it (flash sales).
   ========================================================================== */
(function (root) {
  'use strict';

  var UNIT_KINDS = { pct: 1, off: 1, price: 1 };

  function time(v) { var t = Date.parse(v); return isFinite(t) ? t : null; }

  /* 'off' · 'scheduled' · 'live' · 'ended' · 'soldout' */
  function status(o, now, sold) {
    if (!o || !o.active) return 'off';
    var n = typeof now === 'number' ? now : time(now || new Date().toISOString());
    var s = time(o.startsAt), e = o.endsAt ? time(o.endsAt) : null;
    if (s !== null && n < s) return 'scheduled';
    if (e !== null && n >= e) return 'ended';
    if (o.maxUnits && left(o, sold) <= 0) return 'soldout';
    return 'live';
  }

  function left(o, sold) {
    if (!o.maxUnits) return Infinity;
    var u = sold && sold[o.id] ? Number(sold[o.id]) : 0;
    return Math.max(0, o.maxUnits - u);
  }

  function fold(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  /* p: { id, type, brand } */
  function hit(t, p) {
    if (t.kind === 'product') return Number(t.ref) === Number(p.id);
    if (t.kind === 'category') return String(t.ref) === String(p.type);
    if (t.kind === 'brand') return !!p.brand && fold(t.ref) === fold(p.brand);
    return false;
  }

  function covers(o, p) {
    var ts = Array.isArray(o.targets) ? o.targets : [];
    for (var i = 0; i < ts.length; i++) if (ts[i].exclude && hit(ts[i], p)) return false;
    if (o.scope === 'all') return true;
    for (var j = 0; j < ts.length; j++) if (!ts[j].exclude && hit(ts[j], p)) return true;
    return false;
  }

  /* Whole-number arithmetic, half up — the cloud copy says the same thing in
     integers so the two never disagree by a cent. */
  function pctOff(list, pct) { return Math.floor((list * (100 - pct) + 50) / 100); }

  /* The price of ONE piece under a unit offer, or null when the offer does
     not apply to a price in this currency. Never above the list price. */
  function unitPrice(o, list, currency) {
    list = Number(list) || 0;
    if (o.kind === 'pct') return Math.max(0, pctOff(list, o.pct));
    if ((currency || 'USD') !== 'USD') return null;
    if (o.kind === 'off') return Math.max(0, list - o.amount);
    if (o.kind === 'price') return Math.min(list, o.amount);
    return null;
  }

  /* Every live unit offer for this product that actually lowers its price,
     cheapest first (then the older offer). */
  function candidates(offers, p, list, currency, now, sold) {
    var out = [];
    for (var i = 0; i < (offers || []).length; i++) {
      var o = offers[i];
      if (!UNIT_KINDS[o.kind] || status(o, now, sold) !== 'live' || !covers(o, p)) continue;
      var price = unitPrice(o, list, currency);
      if (price === null || price >= list) continue;
      out.push({ offer: o, price: price });
    }
    out.sort(function (a, b) { return a.price - b.price || a.offer.id - b.offer.id; });
    return out;
  }

  /* What a product shows on its card and the website's badge: the best live
     unit offer, or else a live buy-X-get-Y it is in (no single price). */
  function bestFor(offers, p, list, currency, now, sold) {
    var c = candidates(offers, p, list, currency, now, sold)[0];
    if (c) return { offer: c.offer, price: c.price, list: list, left: left(c.offer, sold), save: list - c.price };
    for (var i = 0; i < (offers || []).length; i++) {
      var o = offers[i];
      if (o.kind === 'bxgy' && status(o, now, sold) === 'live' && covers(o, p)) {
        return { offer: o, price: null, list: list, left: left(o, sold), save: 0 };
      }
    }
    return null;
  }

  /* lines: [{ productId, type, brand, list, currency, qty }]
     -> [{ segs: [{ qty, price, list, offerId }], total, listTotal }] in the
     same order. A line splits when only part of it is at the offer price (a
     flash sale running out, the free piece of a buy-2-get-1). */
  function priceBasket(lines, offers, now, sold) {
    var rem = {};
    function room(o) { if (!(o.id in rem)) rem[o.id] = left(o, sold); return rem[o.id]; }
    var units = [];         // [{ li, list, price, offerId }]
    var out = lines.map(function () { return { segs: [], total: 0, listTotal: 0 }; });

    /* 1 — unit offers, cheapest first, as far as each one's pieces go */
    lines.forEach(function (l, li) {
      var p = { id: l.productId, type: l.type, brand: l.brand };
      var list = Number(l.list) || 0;
      var qty = Math.max(0, Number(l.qty) || 0);
      var cs = candidates(offers, p, list, l.currency, now, sold);
      for (var c = 0; c < cs.length && qty > 0; c++) {
        var n = Math.min(qty, room(cs[c].offer));
        for (var k = 0; k < n; k++) units.push({ li: li, list: list, price: cs[c].price, offerId: cs[c].offer.id, fixed: true });
        rem[cs[c].offer.id] -= n;
        qty -= n;
      }
      for (var r = 0; r < qty; r++) units.push({ li: li, list: list, price: list, offerId: null, fixed: false });
    });

    /* 2 — buy X get Y over the pieces no unit offer took. The cheapest
       pieces of the group are the ones that come off. */
    var bx = (offers || []).filter(function (o) { return o.kind === 'bxgy' && status(o, now, sold) === 'live'; })
      .sort(function (a, b) { return a.id - b.id; });
    bx.forEach(function (o) {
      var pool = units.filter(function (u) {
        var l = lines[u.li];
        return !u.fixed && covers(o, { id: l.productId, type: l.type, brand: l.brand });
      });
      var size = o.buyQty + o.getQty;
      var groups = Math.floor(pool.length / size);
      if (!groups) return;
      var free = Math.min(groups * o.getQty, room(o));
      pool.sort(function (a, b) { return a.list - b.list; });
      for (var i = 0; i < free; i++) {
        pool[i].price = pctOff(pool[i].list, o.pct);
        pool[i].offerId = o.id;
      }
      rem[o.id] -= free;
      pool.forEach(function (u) { u.fixed = true; });
    });

    /* 3 — back into lines, one segment per (price, offer) */
    units.forEach(function (u) {
      var L = out[u.li];
      var seg = null;
      for (var s = 0; s < L.segs.length; s++) {
        if (L.segs[s].price === u.price && L.segs[s].offerId === u.offerId) { seg = L.segs[s]; break; }
      }
      if (!seg) { seg = { qty: 0, price: u.price, list: u.list, offerId: u.offerId }; L.segs.push(seg); }
      seg.qty++;
      L.total += u.price;
      L.listTotal += u.list;
    });
    out.forEach(function (L) {
      L.segs.sort(function (a, b) { return (a.offerId === null ? 0 : 1) - (b.offerId === null ? 0 : 1) || b.price - a.price; });
    });
    return out;
  }

  var api = {
    status: status, left: left, covers: covers, unitPrice: unitPrice,
    bestFor: bestFor, priceBasket: priceBasket, pctOff: pctOff
  };
  root.OfferMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
