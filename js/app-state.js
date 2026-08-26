/* ==========================================================================
   OG SYSTEM — application shell  ·  1/17: STATE
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 1-40). Loads absolute first —
   every other split file (and every other module: pos.js, labels.js, etc.)
   reads/writes the shared `OG` object defined here. Vanilla JS. No
   framework, no build step, no persistence.
   ========================================================================== */

/* --------------------------------------------------------------- 1. STATE */

var OG = {
  view: 'dashboard',
  lang: 'en',
  currency: 'SYP',
  pending: null,                                        // action to run after a view renders
  prod: { type: '', health: '', q: '', sort: 'name', dir: 1 },
  /* img = a colour block, imgSrc = a real photo as a data URL. Only one is
     ever set; imgSrc wins wherever both are checked. */
  /* `place` is which warehouse the Stock tab is showing: 'all' | a warehouse
     id. The tab defaults to 'stock' because "what have I got, and where" is
     the question this page is opened to answer. */
  wh:   { tab: 'stock', place: 'all', type: 'sneakers', sizes: {}, name: '', img: null, imgSrc: null },
  dir:  null,                                           // page-transition direction
  rep:  { tab: 'sales' },
  print:{ partner: false },
  store:{ screen: 'grid', productId: null, size: null, cart: [] },
  cust: { q: '', filter: 'all' },
  /* `sym` is what gets PRINTED on our own labels: 'c128' carries the SKU,
     'ean13' is kept for anyone who wants the old numeric code. `mode` is the
     paper: a thermal roll needs one label per page at exact size, an A4
     sticker sheet needs them tiled. */
  /* price:false by default — see LABEL_TEMPLATES.product. cw/ch are the
     custom label size in mm, used when size === 'custom'. */
  lb:   { pid: null, template: 'product', size: '30x30', cw: 30, ch: 30, max: 4,
          sym: 'c128', mode: 'roll',
          barcode: true, qr: true, price: false, size2: true, shelf: true, logo: true },
  /* Receipt paper. 80mm is the shop standard; 58mm rolls are common enough
     and cheap enough that the client may turn up with one. */
  rc:   { width: '80' },
  /* Hardware settings — scanner tuning and printer paper. */
  set:  { captureScans: false }
};
