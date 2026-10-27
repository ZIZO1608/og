/* THE ORDER SIZES ARE LISTED IN — ONE FILE, READ BY THE BROWSER AND THE SERVER.

   Night shift 28 Oct 2026. Every clothing product listed its sizes as
   L, M, S, XL, XXL: the catalogue query said `ORDER BY v.size`, which is a
   text sort, and every screen drew what it was handed. Two screens had their
   own private sort (the colour matrix, the shelf map's editor) and they did
   not agree with each other either.

   The rule, in order of what decides:
     1. the product type's own size set (Settings → Categories, DB.sizeSets),
        in the order the owner wrote it;
     2. a size that is a number, by its value (39, 40, 42.5 … and 28, 30, 32);
     3. a clothing letter size, smallest first (XXS, XS, S, M, L, XL, XXL,
        3XL …; 2XL is XXL);
     4. anything else, alphabetically, digits read as numbers.
   A product with several colours is grouped by colour first (in the order
   its colours were added), then sized inside each colour.

   Like js/offermath.js this is a plain script that sets one global, loaded by
   index.html and imported by the server for its side effect
   (`import '../../js/sizeorder.js'` in server/lib/catalogue.js) — one copy of
   the rule, not a twin to keep in step. The repo root has no "type", so Node
   reads it as CommonJS and `globalThis` is the same object either way. */
(function (root) {
  'use strict';

  var LETTERS = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL'];

  /* "2XL" → "XXL", "3xl" → "XXXL"; anything else upper-cased and trimmed. */
  function letterKey(s) {
    var t = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
    var m = /^(\d)X(S|L)$/.exec(t);
    if (m) t = new Array(Number(m[1]) + 1).join('X') + m[2];
    return t;
  }

  function asNumber(s) {
    var t = String(s == null ? '' : s).trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }

  /* [tier, value, text] — compared left to right. */
  function rank(size, set) {
    var s = String(size == null ? '' : size);
    if (set && set.length) {
      var i = set.indexOf(s);
      if (i < 0) i = set.map(letterKey).indexOf(letterKey(s));
      if (i > -1) return [0, i, s];
    }
    var n = asNumber(s);
    if (n !== null) return [1, n, s];
    var li = LETTERS.indexOf(letterKey(s));
    if (li > -1) return [2, li, s];
    return [3, 0, s];
  }

  function compare(a, b, set) {
    var ra = rank(a, set), rb = rank(b, set);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return String(ra[2]).localeCompare(String(rb[2]), 'en', { numeric: true });
  }

  /* A list of plain size strings, sorted (a new array). */
  function sizes(list, set) {
    return (list || []).slice().sort(function (a, b) { return compare(a, b, set); });
  }

  /* A list of variants, sorted (a new array): by colour, then size.
     opts.size(v) / opts.colour(v) read the two fields (the browser says
     size/colourId, the server size/colour_id); opts.colours is the colour ids
     in the product's order. */
  function variants(list, set, opts) {
    opts = opts || {};
    var sizeOf = opts.size || function (v) { return v.size; };
    var colOf = opts.colour || function (v) { return v.colourId != null ? v.colourId : v.colour_id; };
    var order = opts.colours || [];
    function ci(v) {
      var c = colOf(v);
      var i = order.indexOf(c);
      return i > -1 ? i : (c == null ? -1 : 1e6 + Number(c || 0));
    }
    return (list || []).slice().sort(function (a, b) {
      var d = ci(a) - ci(b);
      if (d) return d;
      return compare(sizeOf(a), sizeOf(b), set) ||
        String(a.sku || '').localeCompare(String(b.sku || ''), 'en', { numeric: true });
    });
  }

  root.SizeOrder = { rank: rank, compare: compare, sizes: sizes, variants: variants };
})(typeof globalThis !== 'undefined' ? globalThis : this);
