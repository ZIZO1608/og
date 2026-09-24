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
  /* The language this machine last used (written by applyLang). The login
     screen already spoke it; the app now opens in it too. */
  lang: (function () { try { return localStorage.getItem('og.lang') === 'ar' ? 'ar' : 'en'; } catch (e) { return 'en'; } })(),
  currency: 'SYP',
  pending: null,                                        // action to run after a view renders
  /* `arch` is the LIFECYCLE filter and is deliberately NOT part of `health`.
     Stock health is out/low/critical/healthy — a fact about quantity.
     Archived is whether the shop still sells the line at all. They were one
     dropdown, and that is how the storefront switch became a disappearing
     act: the switch set the very flag the list filtered on, so the row you
     had just edited left the screen with nothing to say where it went. */
  /* `filters` (is the panel open) and `select` (is the tick column on) are
     here rather than on the DOM: this screen repaints on every save and
     every live push, and a class put on a node by a click does not survive
     that — the Safeers card menu, one screen along. */
  prod: { type: '', health: '', arch: 'active', photos: '', q: '', sort: 'name', dir: 1, filters: false, select: false },
  /* img = a colour block, imgSrc = a real photo as a data URL. Only one is
     ever set; imgSrc wins wherever both are checked. */
  /* `place` is which warehouse the Stock tab is showing: 'all' | a warehouse
     id. The tab defaults to 'stock' because "what have I got, and where" is
     the question this page is opened to answer. */
  /* whId is the warehouse the NEW product's opening stock is booked into, and
     so also the only warehouse whose shelves the shelf picker may offer — a
     shelf reaches its warehouse through its room, and assign-shelf refuses a
     pair held in the other building.

     Left null rather than set to DB.intakeWh here: data.js loads first, but
     the intake warehouse is overridden from server config during hydrate(),
     which is long after this line runs. Resolved where it is read, so the
     shop's own setting wins. shelfId '' is "not put away yet", which is a
     real and permanent state — stock.shelf_id is nullable on purpose. */
  /* `arrived` since night shift 02. This was `moves` — the movement log —
     so the warehouse opened every morning on an audit trail of what had
     already happened, which is the one thing nobody walks into that room to
     do. An account without stock.move never sees that panel at all and
     viewWarehouse falls it back to the first job it does have. */
  wh:   { tab: 'arrived', place: 'all', type: 'sneakers', sizes: {}, name: '', img: null, imgSrc: null,
          whId: null, shelfId: '', find: '',
          /* ns02: every box on the Add form round-trips through here now.
             They were markup with literal values in it — brand and made-in
             read by nothing, the two prices pre-filled with 1050 and 2250 —
             so a render lost what had been typed and a save sent inventions. */
          brand: '', madeIn: '', colorway: '', price: '', cost: '' },
  dir:  null,                                           // page-transition direction
  rep:  { tab: 'sales' },
  /* The Reports screen's own window, deliberately NOT shared with the
     dashboard's `dashScope`. The two screens answer different questions —
     "how is today going" against "what did this month look like" — and while
     one chip drove both, every visit to Reports quietly reset the dashboard
     to whatever range was last read there. Thirty days rather than today: a
     report of a single day is a receipt.

     repFrom / repTo are 'YYYY-MM-DD' as the date inputs give them, and are
     only consulted when repScope is 'custom'. */
  repScope: '30d',
  repFrom: '',
  repTo: '',
  repLoading: false,
  print:{ partner: false },
  /* `size` is set by the product screen's "who wears this" link, and is the
     one customer filter that arrives from another screen. */
  cust: { q: '', filter: 'all', sort: 'recent', size: '' },
  /* The browser Label Studio's state (`lb`) is gone with the studio. What a
     label looks like is a server template; which template, which printer and
     which paper this machine uses live in js/labels.js's own remembered
     choice, not here. */
  /* Receipt paper. 80mm is the shop standard; 58mm rolls are common enough
     and cheap enough that the client may turn up with one. */
  rc:   { width: '80' },
  /* Hardware settings — scanner tuning and printer paper. */
  set:  { captureScans: false }
};
