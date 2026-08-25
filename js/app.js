/* ==========================================================================
   OG SYSTEM — application shell, navigation, and screens
   Vanilla JS. No framework, no build step, no persistence.
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

/* ------------------------------------------------------------ 2. LANGUAGE */

var I18N = {
  en: {
    nav_main: 'Operations', nav_ops: 'Business',
    nav_dashboard: 'Dashboard', nav_pos: 'Point of Sale', nav_products: 'Products',
    nav_warehouse: 'Warehouse', nav_customers: 'Customers', nav_print: 'Print Jobs',
    nav_reports: 'Reports', nav_storefront: 'Storefront', nav_settings: 'Settings',
    tagline: 'Sneakers & Streetwear', live: 'Live demo data',

    search_ph: 'Search products, customers, invoices…', admin: 'Admin',
    notifications: 'Notifications', view_all: 'View all', no_results: 'Nothing matched that search',

    /* --- account --- */
    signed_in_as: 'Signed in as', sign_out: 'Sign out', signing_out: 'Signing out…',
    change_pw: 'Change password', my_account: 'My account',
    pw_current: 'Current password', pw_new: 'New password', pw_again: 'Type it again',
    pw_changed: 'Password changed', pw_reauth: 'Sign in again with your new password',
    pw_mismatch: 'The two new passwords do not match',
    pw_must_change: 'Your password was reset — please change it',
    demo_account: 'Demo', demo_no_account: 'No server — demo data, nothing is saved',
    role_delivery: 'Delivery', role_partner: 'Print partner',
    /* --- roles grid --- */
    roles_editable: 'Tick what each role may do. Saved straight away.',
    perm_locked: 'Locked', perm_saved: 'Role updated', perm_refused: 'Some changes were refused',
    pg_till: 'Till', pg_stock: 'Stock', pg_products: 'Products',
    pg_customers: 'Customers', pg_money: 'Money', pg_print: 'Printing',
    pg_admin: 'Management', pg_partner: 'Yalla Wear', pg_delivery: 'Deliveries',

    /* --- the role home screens --- */
    hi_morning: 'Good morning', hi_afternoon: 'Good afternoon', hi_evening: 'Good evening',
    my_sales_today: 'My sales today', my_invoices: 'My invoices',
    my_last_sales: 'My last sales', open_till: 'Open the till',
    nothing_sold_yet: 'Nothing rung up yet today', first_sale_hint: 'Scan something to start',
    low_on_shelf: 'Running out on the shelf', low_on_shelf_sub: 'ask the back for more',
    shelf_all_good: 'The shelf is well stocked',
    back_title: 'The back room', back_sub: 'What came in, what needs moving',
    arrived_today: 'Arrived today', to_move_out: 'Waiting to go to the floor',
    empty_on_floor: 'Empty sizes on the floor', open_orders: 'Orders on the way',
    back_receive: 'Book something in', back_count: 'Start a count',
    back_nothing: 'Nothing waiting', back_nothing_sub: 'the floor is stocked from the back',

    /* --- deliveries --- */
    nav_deliveries: 'Deliveries',
    dl_title: 'Deliveries', dl_sub: 'What is going out and what came back',
    dl_my_runs: 'My runs today', dl_my_runs_sub: 'tap a card when it is done',
    dl_waiting: 'To take out', dl_out: 'On the road', dl_delivered: 'Delivered',
    dl_failed: 'Not delivered', dl_to_collect: 'Collect', dl_collected: 'Collected',
    dl_nothing_owed: 'Already paid', dl_call: 'Call', dl_map: 'Map',
    dl_take: 'Take it out', dl_done: 'Delivered', dl_fail: 'Could not deliver',
    dl_why: 'What happened?', dl_why_ph: 'nobody home, wrong address, refused…',
    dl_none: 'Nothing to take out', dl_none_sub: 'you are all caught up',
    dl_none_board: 'No deliveries yet',
    dl_none_board_sub: 'send one out from a sale on the Till or Reports screen',
    dl_driver: 'Driver', dl_unassigned: 'Nobody yet', dl_assign: 'Send out for delivery',
    dl_address: 'Address', dl_address_ph: 'street, building, flat — enough to find the door',
    dl_phone: 'Phone', dl_runs: 'Runs', dl_owed: 'To collect today',
    dl_marked: 'Marked', dl_sent: 'Out for delivery',
    dl_no_address: 'Type an address first', dl_pick_driver: 'Pick a driver',
    retry: 'Try again', loading: 'Loading…',

    /* --- the printed receipt --- */
    rc_title: 'Receipt', rc_full_page: 'Full page invoice',
    rc_scan: 'Scan for your copy',
    rc_policy: 'Exchange within 7 days with this receipt',
    rc_paper: 'Receipt paper', rc_80: '80 mm', rc_58: '58 mm',
    rc_paper_hint: 'The roll your printer takes. 80 mm is standard.',

    /* --- the 80mm thermal receipt (js/receipt.js) — drawn on canvas, so
       these are read directly off I18N.en / I18N.ar rather than through
       t(), because the printed slip needs both languages on the page at
       once, never just whichever one the app happens to be showing. */
    rc2_invoice: 'Invoice', rc2_datetime: 'Date & time', rc2_cashier: 'Cashier',
    rc2_customer: 'Customer', rc2_phone: 'Phone', rc2_points_balance: 'Points balance',
    rc2_size: 'Size', rc2_line_discount: 'Discount',
    rc2_subtotal: 'Subtotal', rc2_discount: 'Discount', rc2_points_used: 'Points used',
    rc2_total: 'TOTAL', rc2_payment: 'Payment', rc2_to_collect: 'Amount to collect (COD)',
    rc2_points_earned: 'Points earned', rc2_shop_copy: 'SHOP COPY',
    print_receipt: 'Print receipt', preview_receipt: 'Preview', printing: 'Printing',
    print_sent: 'Sent to the printer', print_retry: 'Retry from the receipt.',

    rc3_title: 'Receipt printer', rc3_sub: 'The 80mm slip a customer walks out holding',
    rc3_host: 'Printer address (LAN IP)', rc3_port: 'Port', rc3_branch: 'Branch name',
    rc3_auto_print: 'Auto-print on sale', rc3_auto_print_hint: 'Off for a client demo — a printer chattering through a meeting is a bad look.',
    rc3_copies: 'Copies', rc3_cut_mode: 'Cut', rc3_cut_partial: 'Partial', rc3_cut_full: 'Full',
    rc3_show_qr: 'QR code', rc3_show_barcode: 'Barcode', rc3_show_loyalty: 'Loyalty lines',
    rc3_footer_ar: 'Footer (Arabic)', rc3_footer_en: 'Footer (English)',
    rc3_policy_ar: 'Return policy (Arabic)', rc3_policy_en: 'Return policy (English)',
    rc3_save: 'Save receipt settings', rc3_saved: 'Receipt settings saved',
    rc3_demo_note: 'No server here — these are shown for reference and cannot be saved.',

    /* --- thermal product labels (XP-235B) — separate from the browser
       "Label Studio" (rc_paper/hw_printer strings above stay untouched) --- */
    lbl_title: 'Thermal labels',
    lbl_print_now: 'Print now', lbl_preview_title: 'Label preview',
    lbl_demo_only: 'No server here — labels can be previewed but not printed.',
    lbl_queued: 'Queued {n} labels for {station}',
    lbl_pick_station: 'Pick a station first',
    lbl_calibrate_sent: 'Calibration sent',
    lbl_fallback: 'Falls back to Code128 — too narrow for EAN-13',
    lbl_station: 'Station', lbl_preset: 'Size', lbl_qty: 'Qty',
    lbl_batch_total: 'labels total',
    lbl_thermal_section: 'Thermal labels (XP-235B)',
    lbl_thermal_sub: 'The barcode sticker on the box, printed over USB',
    lbl_queue_title: 'Print queue', lbl_queue_empty: 'Nothing queued',
    lbl_cancel: 'Cancel', lbl_reprint: 'Reprint',
    lbl_unknown_code: 'That code doesn’t match any product',
    lbl_attach_code: 'Attach this code to a product',
    lbl_attach_search: 'Search products…', lbl_attach_save: 'Save',
    lbl_save: 'Save label settings', lbl_saved: 'Label settings saved',
    lbl_host: 'Printer address (LAN, only for the TCP transport)',
    lbl_port: 'Port', lbl_transport: 'Transport', lbl_transport_agent: 'Agent (USB laptop)',
    lbl_transport_tcp: 'Direct (LAN)', lbl_density: 'Density', lbl_speed: 'Speed',
    lbl_gap: 'Gap between labels (mm)', lbl_max_batch: 'Batch ceiling',

    /* --- discounts --- */
    disc_capped: 'Discounts above {p}% need a manager',
    disc_max: 'most you can take off: {v}',
    wh_cost_later: 'A manager adds the cost price. Enter what the shop sells it for.',

    dash_title: 'Dashboard', dash_sub: 'Everything about the shop, on one screen',
    st_today: 'Sales today', st_month: 'Sales this month', st_products: 'Products',
    st_critical: 'SKUs in critical stock', st_customers: 'Active customers', st_print: 'Pending print jobs',
    vs_yesterday: 'vs yesterday', vs_last_month: 'vs last month', vs_last_period: 'vs last period',
    in_catalogue: 'in the catalogue', need_reorder: 'need reordering now',
    bought_90: 'bought in the last 90 days', in_queue: 'in the Yalla Wear queue',
    sales_6m: 'Sales — last 6 months', sales_by_type: 'Sales by product type',
    needs_attention: 'Needs attention', recent_sales: 'Latest sales', fix: 'Fix',

    invoice: 'Invoice', customer: 'Customer', date: 'Date', items: 'Items', total: 'Total',
    payment: 'Payment', cashier: 'Cashier', actions: 'Actions', qty: 'Qty', size: 'Size',
    unit_price: 'Unit price', line_total: 'Line total', price: 'Price', cost: 'Cost',
    margin: 'Margin', stock: 'Stock', type: 'Type', product: 'Product', name: 'Name',
    phone: 'Phone', city: 'City', status: 'Status', notes: 'Notes', barcode: 'Barcode',
    shelf: 'Shelf', sku: 'SKU', brand: 'Brand', made_in: 'Made in', colour: 'Colourway',

    pos_title: 'Point of Sale', pos_sub: 'Scan, size, done — under ten seconds',
    scan_ph: 'Scan barcode or search product…', scan_btn: 'Scan', try_scanning: 'Try scanning:',
    cart: 'Cart', clear: 'Clear', empty_cart: 'Cart is empty',
    empty_cart_sub: 'Scan a barcode or tap a product to start a sale',
    all_products: 'All', subtotal: 'Subtotal', discount: 'Discount', coupon: 'Coupon code',
    apply: 'Apply', applied: 'Applied', points: 'points', loyalty: 'Loyalty',
    use_points: 'Use', payment_method: 'Payment method', add_print: 'Add print job to this sale',
    complete_sale: 'Complete sale', customer_ph: 'Type 3 digits of the phone…', change_customer: 'Change',
    walk_in: 'Walk-in customer', print_text: 'Text / name to print', priority: 'Priority',
    deadline: 'Deadline', normal: 'Normal', urgent: 'Urgent', amount: 'Amount', percent: 'Percent',
    in_stock: 'in stock', pick_size: 'Pick a size', out_of_stock: 'Out of stock',
    sale_complete: 'Sale complete', points_earned: 'Loyalty points earned',
    new_sale: 'New sale', print: 'Print', pdf: 'PDF', thank_you: 'Thank you — see you soon',
    served_by: 'Served by', bill_to: 'Bill to',

    products_title: 'Products', products_sub: 'Every item, every size, live stock',
    health: 'Stock health', visible: 'On storefront', healthy: 'Healthy', low: 'Low',
    critical: 'Critical', out: 'Out', all_types: 'All types', all_health: 'All health',
    per_size: 'Stock per size', sales_trend: 'Sales trend — last 6 months',
    size_gap_warn: 'Size gap — good total stock, zero in the sizes people ask for',
    total_stock: 'Total stock', stock_value: 'Stock value at cost', last_sold: 'Last sold',
    edit_product: 'Edit product', reorder: 'Create reorder',

    warehouse_title: 'Warehouse', warehouse_sub: 'Nothing moves without a trace',
    tab_add: 'Add product', tab_moves: 'Stock movements',

    /* Multi-warehouse. The wording avoids "location" as a noun on buttons —
       "Shop floor" and "Back storage" are what the staff actually say. */
    wh_stock: 'Stock by place', wh_all: 'Everywhere',
    wh_location: 'Place', wh_sell_from: 'Take the stock from',
    wh_not_here: 'Not on the shop floor', wh_in_the_back: 'in the back',
    wh_bring_out: 'Bring one out', wh_moved: 'Moved',
    wh_count_where: 'Which place are you counting?',
    wh_transfer: 'Move stock', wh_move: 'Move', wh_from: 'From', wh_to: 'To',
    wh_qty_to_move: 'How many', wh_move_done: 'Stock moved',
    wh_suggest: 'Bring these out of the back',
    wh_suggest_sub: 'Empty on the shop floor, sitting in storage',
    wh_here: 'Here', wh_elsewhere: 'Elsewhere',
    wh_pieces_here: 'pieces here', wh_value_here: 'Value at cost',
    wh_skus_here: 'sizes stocked here',

    /* ---- the order handshake with Yalla Wear ----------------------------
       Wording is careful about who is doing what. OG *offers* an order; only
       Yalla can accept it. Nothing here may imply OG put the job on the press. */
    or_state: 'Order', or_draft: 'Not sent yet', or_pending: 'Waiting on Yalla Wear',
    or_accepted: 'Accepted', or_declined: 'Declined',
    or_send: 'Send to Yalla Wear', or_send_again: 'Send again',
    or_send_title: 'Send this order to Yalla Wear',
    or_send_hint: 'This is exactly what Yalla Wear will see. They can accept it or turn it down.',
    or_sent_ok: 'Order sent — waiting for Yalla Wear to accept',
    or_cannot: 'Cannot send this order',
    or_why_tbc: 'Some shirts still have no name. Yalla Wear cannot print a blank back — confirm the names first.',
    or_why_sent: 'This order is already with Yalla Wear.',
    or_why_accepted: 'Yalla Wear has already accepted this one.',
    or_wait_head: 'waiting on Yalla Wear',
    or_wait_sub: 'Sent, with no answer yet',
    or_declined_head: 'Yalla Wear turned this down',
    or_promised: 'Promised by', or_requested: 'You asked for',
    or_timeline: 'Order timeline',
    or_tl_created: 'Job created', or_tl_sent: 'Sent to Yalla Wear',
    or_tl_accepted: 'Accepted by Yalla Wear', or_tl_declined: 'Declined by Yalla Wear',
    or_by_og: 'OG', or_by_yalla: 'Yalla Wear',
    or_blocked_stage: 'Yalla Wear has not accepted this order yet',
    or_wa: 'Send on WhatsApp too',
    or_wa_title: 'Send the order on WhatsApp',
    or_none_pending: 'No new orders right now',

    /* partner side */
    yl_new_orders: 'New orders', yl_new_orders_sub: 'Sent by OG, waiting on you',
    yl_accept: 'Accept', yl_decline: 'Turn down',
    yl_accept_title: 'Accept this order', yl_decline_title: 'Turn down this order',
    yl_promise: 'Ready by', yl_promise_hint: 'This is the date you will be measured on, not the one OG asked for.',
    yl_decline_hint: 'Tell OG why, in your own words. They will see this straight away.',
    yl_decline_ph: 'e.g. the press is booked solid until Sunday…',
    yl_accepted_ok: 'Accepted — it is now on your board',
    yl_declined_ok: 'Turned down — OG has been told',
    yl_requested_by: 'OG asked for',
    yl_sent_ago: 'Sent',
    wh_empty_sizes: 'sizes empty here', wh_none_here: 'Nothing in this place',
    wh_nothing_to_move: 'Nothing needs bringing out — the floor is stocked',
    wh_split_hint: 'Shop floor / Back storage',
    image: 'Image', upload_hint: 'Click to upload', product_name: 'Product name',
    /* Product photo intake. Three ways in, so the hint names all three. */
    nav_more: 'More', language: 'Language',
    /* WhatsApp. The wording is careful: the app OPENS WhatsApp, it cannot
       send on the user's behalf, and the UI must not imply otherwise. */
    wa_open: 'Open in WhatsApp', wa_opened: 'WhatsApp opened with the message ready',
    wa_handoff: 'This opens WhatsApp with the message written. You press send there.',
    wa_bad_number: 'That phone number is not usable',
    wa_day_title: 'Send today’s summary', wa_day_empty: 'No sales recorded today yet',
    wa_send_day: 'Send the day',
    /* purchase orders */
    po_place: 'Place the order', po_rate: 'Sells', po_week: 'wk', po_cover: 'Lasts',
    po_order: 'Order', po_no_sales: 'not selling',
    po_need_qty: 'Set a quantity on at least one size',
    po_explain: 'Quantities are suggested from what actually sold in the last 8 weeks, ' +
                'enough to cover the next 4. Change anything you like.',
    po_whatsapp: 'Send on WhatsApp', po_received_toast: 'received into stock',
    po_title: 'Purchase orders', po_draft: 'Draft', po_sent: 'Sent', po_received: 'Received',
    po_receive: 'Receive stock', po_none: 'No purchase orders yet',
    po_none_sub: 'Reorder any low product and it appears here',
    po_suggest: 'Worth reordering', po_suggest_sub: 'from real sales speed, most urgent first',
    /* scanning */
    sc_title: 'Scan', sc_looking: 'Point the camera at the label',
    sc_found: 'Found', sc_found_title: 'Scanned', sc_again: 'Scan another',
    sc_photo: 'Take a photo instead', sc_torch: 'Light',
    sc_no_torch: 'This camera has no light',
    sc_type_code: 'or type the barcode', sc_go: 'Go',
    sc_reading: 'Reading the photo…', sc_nothing: 'No code found in that photo',
    sc_unknown: 'Nothing in the system matches',
    sc_denied: 'Camera permission was refused — allow it, or use a photo',
    sc_nodevice: 'No camera found on this device',
    sc_failed: 'The camera could not be opened',
    sc_no_camera: 'Live camera needs https',
    sc_no_camera_sub: 'Opened from a file, the browser blocks the camera. Take a photo instead — it works the same.',
    sc_use_photo: 'Take a photo of the label',
    sc_this_size: 'Scanned size', sc_all_sizes: 'Every size', sc_scanned: 'scanned',
    sc_add_to_sale: 'Add to the sale', sc_per_week: 'a week',

    /* ---- what a scan can do, and the hardware behind it -----------------
       Wording is deliberate: "check in" is putting stock away, "check out" is
       taking it off the shelf for any reason that is not a sale. Selling is
       its own word because it is the only one that takes money. */
    sc_sells: 'Selling', sc_last_8w: 'over the last 8 weeks',
    sc_months: 'mo', sc_over_a_year: 'over a year',
    sc_cover: 'Lasts about', sc_at_this_rate: 'at this speed',
    sc_not_moving: 'not moving', sc_never_sold: 'never sold in this size',
    sc_sourcing: 'Where it comes from', sc_last_delivery: 'Last delivery',
    sc_no_delivery: 'nothing recorded yet',
    sc_recent_moves: 'Recent movements', sc_no_moves: 'Nothing has moved on this size yet.',
    sc_what_now: 'What are you doing with it?',
    sc_check_in: 'Put into stock', sc_check_out: 'Take out of stock',
    sc_sell: 'Sell it',
    sc_enter_hint: 'Press Enter to sell straight away — the scanner can stay in your hand.',
    sc_checked_in: 'Put into stock', sc_checked_out: 'Taken out of stock',
    sc_in_note: 'Checked in by scan', sc_out_note: 'Checked out by scan',
    sc_cannot_out: 'Nothing to take out', sc_only_had: 'only had',

    hw_title: 'Scanner and printer', hw_sub: 'The hardware, and how to prove it works',
    hw_scanner: 'Barcode scanner',
    hw_scanner_note: 'A cable, dongle or Bluetooth scanner all type like a keyboard, so all three work with no setup. Scan into the box below to check yours.',
    hw_test: 'Scan anything here to test', hw_waiting: 'Waiting for a scan…',
    hw_last: 'Last scan', hw_gap: 'Speed', hw_accepted: 'Recognised as a scan',
    hw_rejected: 'Read as typing, not a scan',
    hw_prefix: 'Prefix character', hw_prefix_note: 'Optional. If you program your scanner to send a character first, recognition becomes exact instead of based on speed.',
    hw_threshold: 'Speed limit', hw_threshold_note: 'A scanner types faster than this many milliseconds per character. Raise it if real scans are being missed.',
    hw_printer: 'Label printer',
    hw_printer_note: 'Install the printer driver, choose the exact label size below, then print a test. Roll mode prints one label per page at true size.',
    hw_mode: 'Paper', hw_roll: 'Label roll', hw_sheet: 'A4 sticker sheet',
    hw_test_label: 'Print a test label', hw_calibrate: 'Print a ruler',
    hw_calibrate_note: 'The printed rulers must measure exactly 10mm. If they do not, the printer is scaling and the label size in its driver does not match the roll.',
    hw_symbology: 'Barcode on your labels',
    hw_sym_note: 'Code 128 carries the SKU itself, so the label says what it is and can never clash with a real product barcode.',
    hw_camera_gap: 'On a phone without native barcode support the camera reads EAN-13 only, not Code 128. A hardware scanner is unaffected — it decodes on the device.',
    sc_running_out: 'Runs out in about {d} days',
    sizes: 'Sizes',
    /* stock count */
    st_count: 'Stock count', st_intro_sub: 'Walk the shelf, scan, compare',
    st_ready: 'Ready to count', st_begin: 'Start counting',
    st_ready_sub: 'Scan or type what is actually on the shelf. Nothing changes until you post — ' +
                  'the count is compared against the system first, and you see every difference before it applies.',
    st_started: 'started', st_progress: 'Counted', st_variance: 'Differences',
    st_sizes_differ: 'sizes do not match', st_net_pieces: 'Net pieces', st_vs_system: 'against the system',
    st_value: 'Value', st_at_cost: 'at cost price',
    st_system: 'System', st_counted: 'Counted', st_diff: 'Diff',
    st_f_all: 'All', st_f_variance: 'Differences only', st_f_counted: 'Counted', st_f_uncounted: 'Not counted',
    st_find: 'Find a product, SKU or barcode…',
    st_now_counted: 'counted:', st_showing: 'Showing {n} of {t} — use the search to narrow it down',
    st_post: 'Post the count', st_post_q: 'Adjust {n} sizes?',
    st_post_sub: '{p} pieces · {v} at cost',
    st_post_note: 'Only sizes you actually counted are touched. Anything left blank is untouched, ' +
                  'and every adjustment is written into the stock movement log.',
    st_posted: 'posted — {n} sizes adjusted, {p} pieces',
    st_adjust_note: 'Stock count', st_last: 'Last count', st_adjusted: 'Sizes adjusted',
    st_discard_title: 'Discard this count?',
    st_discard_body: 'You have counted {n} sizes. Nothing has been applied to stock yet, and closing now loses the count.',
    st_discard: 'Discard it',
    /* duplicate guard */
    dup_title: 'This may already be in the catalogue',
    dup_head: 'A very similar product already exists',
    dup_sub: 'Adding it twice splits the stock between two products, and neither count is right.',
    dup_match: 'Match', dup_use: 'Add stock to this one',
    dup_anyway: 'It is a different product — add it',
    dup_note: 'You are adding “{n}”. If it is genuinely a different colourway or model, carry on.',
    mo_title: 'Motion', mo_animations: 'Animations and transitions',
    mo_hint: 'Turn this off if the app feels slow on a projector or an old phone.',
    mo_on: 'animations on', mo_off: 'animations off',
    /* command palette */
    cp_title: 'Quick search', cp_placeholder: 'Search or type a command…',
    cp_new_sale: 'New sale', cp_add_product: 'Add a product',
    cp_scan_hint: 'camera', cp_go_to: 'go to',
    cp_toggle_lang: 'Switch language', cp_toggle_curr: 'Switch currency',
    cp_cmd: 'action', cp_product: 'product', cp_customer: 'customer',
    cp_invoice: 'invoice', cp_job: 'print job',
    /* money */
    nav_money: 'Money', mn_title: 'Money', mn_sub: 'The drawer, the costs, and who owes you',
    mn_shift: 'Shift', mn_expenses: 'Expenses', mn_debt: 'Debt book',
    mn_open_shift: 'Open a shift', mn_close_shift: 'Close the shift',
    mn_no_shift: 'No shift is open',
    mn_no_shift_sub: 'Open a shift with the cash you are starting with. Every sale gets attached to it, ' +
                     'and at closing the system tells you what should be in the drawer.',
    mn_cashier: 'Cashier', mn_float: 'Opening float',
    mn_float_hint: 'The cash already in the drawer before the first sale.',
    mn_shift_open: 'shift open', mn_open_since: 'Open since',
    mn_sales: 'Sold this shift', mn_in_drawer: 'Should be in the drawer',
    mn_expected_now: 'right now', mn_not_drawer: 'Not in the drawer',
    mn_settles_later: 'Sham Cash, card — settles later',
    mn_drawer_now: 'The drawer', mn_by_method: 'How they paid',
    mn_cash_sales: 'Cash sales', mn_debt_settled: 'Debt settled', mn_cash_out: 'Paid out in cash',
    mn_expected: 'Expected', mn_counted: 'Counted', mn_difference: 'Difference',
    mn_count_now: 'Count the drawer and type the total',
    mn_close_hint: 'Count the notes before you look at the expected figure — ' +
                   'checking against a number you already know is not a count.',
    mn_count_needed: 'Type what you counted', mn_closed: 'closed',
    mn_balanced: 'Balanced exactly', mn_short: 'short', mn_over: 'over',
    mn_last_shift: 'Last shift', mn_in_box: 'in the box', mn_to_account: 'to an account',
    mn_owed: 'owed to you',
    mn_no_sales_yet: 'No sales yet this shift', mn_no_sales_sub: 'They appear here as they happen',
    mn_add: 'Add', mn_add_expense: 'Add an expense', mn_amount: 'Amount',
    mn_amount_needed: 'Enter an amount', mn_where: 'Where the money goes',
    mn_category: 'Category', mn_from_drawer: 'taken from the drawer',
    mn_expense_hint: 'A cash expense comes straight out of the open shift, so the drawer still balances.',
    mn_exp_month: 'Spent this month', mn_gross: 'Sold this month', mn_after_cost: 'After stock cost',
    mn_minus_cogs: 'minus what the stock cost', mn_net: 'Real profit',
    mn_real_profit: 'after everything', mn_this_month: 'this month',
    mn_c_rent: 'Rent', mn_c_generator: 'Generator / fuel', mn_c_salaries: 'Salaries',
    mn_c_transport: 'Transport', mn_c_packaging: 'Packaging', mn_c_supplier: 'Supplier',
    mn_c_other: 'Other',
    mn_owed_total: 'Owed to you', mn_people: 'unpaid invoices', mn_over_30: 'Older than 30 days',
    mn_chase_these: 'worth chasing', mn_oldest: 'Oldest', mn_still_owed: 'Still owed',
    mn_age: 'Age', mn_settle: 'Settle', mn_remind: 'Remind',
    mn_part_paid: 'part paid, still', mn_cleared: 'cleared',
    mn_settle_hint: 'Cash settled while a shift is open goes into that drawer.',
    mn_no_debt: 'Nobody owes you anything', mn_no_debt_sub: 'Credit sales appear here until they are paid',
    up_pick: 'Add a photo', up_hint: 'click · drag · paste',
    up_swap: 'Change photo', up_colour: 'Use a colour instead',
    up_ok: 'Photo added',
    up_err_none: 'No file was selected',
    up_err_type: 'That is not an image file',
    up_err_size: 'That photo is too large — 12 MB is the limit',
    up_err_read: 'The file could not be read',
    up_err_decode: 'That image is damaged or in a format the browser cannot open',
    cost_price: 'Cost price', selling_price: 'Selling price', shelf_box: 'Shelf / box',
    size_matrix: 'Quantity per size', matrix_hint: 'Enter a quantity — a barcode is generated for each size',
    print_labels: 'Print barcode labels', save_product: 'Save product to warehouse',
    barcode_preview: 'Generated barcodes', movement: 'Movement', user: 'User',
    balance: 'Balance after', received: 'Received', sold: 'Sold', damaged: 'Damaged',
    returned: 'Return', transfer: 'Transfer', label_sheet: 'Barcode labels',
    total_pieces: 'Total pieces', total_cost: 'Total cost', expected_revenue: 'Expected revenue',

    customers_title: 'Customers', customers_sub: 'Who buys, what they buy, when they stopped',
    cu_new: 'New customer', cu_name_ph: 'Full name',
    cu_new_note: 'Three fields is all it takes. Points start at zero and build from the first sale.',
    cu_exists: 'Already in the list',
    no_access: 'Your account does not have access to this',
    tier: 'Tier', total_spent: 'Total spent', last_purchase: 'Last purchase',
    at_risk: 'At risk', send_whatsapp: 'Send WhatsApp', purchase_history: 'Purchase history',
    points_timeline: 'Loyalty timeline', preferred_sizes: 'Preferred sizes',
    source: 'Source', online: 'Online', in_store: 'In-store', gold: 'Gold', silver: 'Silver',
    bronze: 'Bronze', all_customers: 'All customers', risk_only: 'At risk only',
    gold_only: 'Gold only', whatsapp_msg: 'WhatsApp message', send: 'Send',
    days_ago: 'days ago', today_word: 'today', yesterday: 'yesterday', in_days: 'in',
    days: 'days', orders: 'Orders',

    print_title: 'Print Jobs', print_sub: 'Every t-shirt job, from design to delivery',
    jobs_month: 'Jobs this month', on_time: 'On-time', print_revenue: 'Printing revenue',
    paid_partner: 'Paid to Yalla Wear', partner_view: 'Open Yalla Wear portal view',
    admin_view: 'Back to admin view', partner_access: 'Partner access',
    partner_note: 'This is everything the printing partner can see. No costs, no customer phone numbers, no stock, no prices you charge.',
    overdue: 'Overdue', design_note: 'Design note', drag_hint: 'Drag a card between columns to move the job',

    reports_title: 'Reports', reports_sub: 'The numbers behind the shop',
    tab_sales: 'Sales', tab_profit: 'Profit', tab_inventory: 'Inventory value',
    tab_employees: 'Employees', tab_suppliers: 'Suppliers',
    export_excel: 'Export Excel', export_pdf: 'Export PDF', revenue: 'Revenue',
    profit: 'Profit', units: 'Units', capital_in_stock: 'Capital sitting in stock',
    retail_value: 'Retail value', role: 'Role', salary: 'Monthly salary',
    next_payment: 'Next payment', outstanding: 'Outstanding', due: 'Due',
    supplier: 'Supplier', category: 'Category', sales_made: 'Sales handled',
    avg_basket: 'Average basket', invoices: 'Invoices', best_sellers: 'Best sellers',
    generating: 'Generating…', export_ready: 'Export ready',

    store_title: 'Storefront', store_sub: 'What your customers see on their phone',
    store_note: 'Orders placed here appear in the admin Orders queue for confirmation.',
    orders_queue: 'Orders queue', add_to_cart: 'Add to cart', checkout: 'Checkout',
    place_order: 'Place order', whatsapp: 'WhatsApp number', gender: 'Gender',
    male: 'Male', female: 'Female', choose_size: 'Choose your size', back: 'Back',
    shop_all: 'Shop all', order_placed: 'Order placed', pending: 'Pending',
    confirmed: 'Confirmed', confirm: 'Confirm', live_shop: 'Live shop preview',
    products_online: 'products online', hidden_count: 'hidden from the shop',

    settings_title: 'Settings', settings_sub: 'Rules, roles and money',
    roles_perms: 'Roles & permissions', exchange_rate: 'Exchange rate',
    loyalty_rules: 'Loyalty rules', reminders: 'Automatic reminders', branding: 'Branding',
    save_changes: 'Save changes', role_admin: 'Admin', role_manager: 'Manager',
    role_cashier: 'Cashier', role_warehouse: 'Warehouse', permission: 'Permission',
    points_per: 'Points per 1,000 SYP spent', point_value: 'Value of 1 point',
    rate_hint: '1 USD equals', shop_name: 'Shop name', accent_colour: 'Accent colour',

    tour_start: 'Demo tour', next: 'Next', back_btn: 'Back', skip: 'Skip',
    step: 'Step', of: 'of', close: 'Close', cancel: 'Cancel', save: 'Save',
    all_word: 'All', none: 'None', yes: 'Yes', no: 'No', remove: 'Remove',
    print_job: 'Print job', for_word: 'for', day_word: 'day',
    day_overdue: 'day overdue', days_overdue: 'days overdue',
    payment_overdue: 'payment overdue by', payment_due: 'payment due',
    size_gap: 'Size gap', gap_only: 'Size gaps', pieces: 'pcs', all_new: 'all new'
  },

  ar: {
    nav_main: 'العمليات', nav_ops: 'الأعمال',
    nav_dashboard: 'لوحة التحكم', nav_pos: 'نقطة البيع', nav_products: 'المنتجات',
    nav_warehouse: 'المستودع', nav_customers: 'الزبائن', nav_print: 'أعمال الطباعة',
    nav_reports: 'التقارير', nav_storefront: 'المتجر', nav_settings: 'الإعدادات',
    tagline: 'أحذية وملابس ستريت وير', live: 'بيانات العرض التجريبي',

    search_ph: 'ابحث عن منتج أو زبون أو فاتورة…', admin: 'المدير',
    notifications: 'التنبيهات', view_all: 'عرض الكل', no_results: 'لا توجد نتائج مطابقة',

    /* --- الحساب --- */
    signed_in_as: 'مسجّل الدخول باسم', sign_out: 'تسجيل الخروج', signing_out: 'جارٍ الخروج…',
    change_pw: 'تغيير كلمة المرور', my_account: 'حسابي',
    pw_current: 'كلمة المرور الحالية', pw_new: 'كلمة المرور الجديدة', pw_again: 'أعد كتابتها',
    pw_changed: 'تم تغيير كلمة المرور', pw_reauth: 'سجّل الدخول من جديد بكلمة المرور الجديدة',
    pw_mismatch: 'كلمتا المرور غير متطابقتين',
    pw_must_change: 'تمت إعادة تعيين كلمة مرورك — يرجى تغييرها',
    demo_account: 'عرض تجريبي', demo_no_account: 'بدون خادم — بيانات تجريبية ولا يُحفظ شيء',
    role_delivery: 'التوصيل', role_partner: 'شريك الطباعة',
    /* --- جدول الصلاحيات --- */
    roles_editable: 'حدّد ما يستطيع كل دور فعله. يُحفظ فوراً.',
    perm_locked: 'مقفل', perm_saved: 'تم تحديث الدور', perm_refused: 'رُفضت بعض التغييرات',
    pg_till: 'الكاشير', pg_stock: 'المخزون', pg_products: 'المنتجات',
    pg_customers: 'الزبائن', pg_money: 'المال', pg_print: 'الطباعة',
    pg_admin: 'الإدارة', pg_partner: 'يلا وير', pg_delivery: 'التوصيل',

    /* --- الشاشات الرئيسية حسب الدور --- */
    hi_morning: 'صباح الخير', hi_afternoon: 'مساء الخير', hi_evening: 'مساء الخير',
    my_sales_today: 'مبيعاتي اليوم', my_invoices: 'فواتيري',
    my_last_sales: 'آخر مبيعاتي', open_till: 'افتح الكاشير',
    nothing_sold_yet: 'لم تُسجَّل أي فاتورة اليوم', first_sale_hint: 'امسح باركود لتبدأ',
    low_on_shelf: 'قارب على النفاد في المعرض', low_on_shelf_sub: 'اطلب من المستودع',
    shelf_all_good: 'المعرض مجهّز بشكل جيد',
    back_title: 'المستودع', back_sub: 'ما وصل وما يحتاج نقلاً',
    arrived_today: 'وصل اليوم', to_move_out: 'بانتظار النقل إلى المعرض',
    empty_on_floor: 'مقاسات فارغة في المعرض', open_orders: 'طلبيات في الطريق',
    back_receive: 'إدخال بضاعة', back_count: 'ابدأ جرداً',
    back_nothing: 'لا شيء بالانتظار', back_nothing_sub: 'المعرض مجهّز من المستودع',

    /* --- التوصيل --- */
    nav_deliveries: 'التوصيل',
    dl_title: 'التوصيل', dl_sub: 'ما يخرج وما يعود',
    dl_my_runs: 'توصيلاتي اليوم', dl_my_runs_sub: 'اضغط على البطاقة عند الانتهاء',
    dl_waiting: 'للخروج', dl_out: 'في الطريق', dl_delivered: 'تم التسليم',
    dl_failed: 'لم يُسلَّم', dl_to_collect: 'يُحصَّل', dl_collected: 'حُصِّل',
    dl_nothing_owed: 'مدفوع مسبقاً', dl_call: 'اتصال', dl_map: 'الخريطة',
    dl_take: 'خذها معك', dl_done: 'سُلِّمت', dl_fail: 'تعذّر التسليم',
    dl_why: 'ماذا حصل؟', dl_why_ph: 'لا أحد في البيت، عنوان خاطئ، رفض الاستلام…',
    dl_none: 'لا يوجد ما يُخرج', dl_none_sub: 'أنهيت كل شيء',
    dl_none_board: 'لا توجد توصيلات بعد',
    dl_none_board_sub: 'أرسل واحدة من فاتورة في الكاشير أو التقارير',
    dl_driver: 'السائق', dl_unassigned: 'لم يُحدَّد', dl_assign: 'إرسال للتوصيل',
    dl_address: 'العنوان', dl_address_ph: 'الشارع والبناء والطابق — ما يكفي للوصول للباب',
    dl_phone: 'الهاتف', dl_runs: 'الرحلات', dl_owed: 'للتحصيل اليوم',
    dl_marked: 'تم التحديث', dl_sent: 'خرجت للتوصيل',
    dl_no_address: 'اكتب العنوان أولاً', dl_pick_driver: 'اختر السائق',
    retry: 'حاول مرة أخرى', loading: 'جارٍ التحميل…',

    /* --- الفاتورة المطبوعة --- */
    rc_title: 'الفاتورة', rc_full_page: 'فاتورة بحجم كامل',
    rc_scan: 'امسح الرمز لنسختك',
    rc_policy: 'الاستبدال خلال ٧ أيام مع هذه الفاتورة',
    rc_paper: 'ورق الفاتورة', rc_80: '٨٠ مم', rc_58: '٥٨ مم',
    rc_paper_hint: 'قياس الرول في طابعتك. ٨٠ مم هو القياس المعتاد.',

    rc2_invoice: 'رقم الفاتورة', rc2_datetime: 'التاريخ والوقت', rc2_cashier: 'الكاشير',
    rc2_customer: 'الزبون', rc2_phone: 'الهاتف', rc2_points_balance: 'رصيد النقاط',
    rc2_size: 'مقاس', rc2_line_discount: 'خصم',
    rc2_subtotal: 'المجموع الفرعي', rc2_discount: 'الخصم', rc2_points_used: 'نقاط مستخدمة',
    rc2_total: 'الإجمالي', rc2_payment: 'طريقة الدفع', rc2_to_collect: 'المبلغ المطلوب تحصيله',
    rc2_points_earned: 'نقاط مكتسبة', rc2_shop_copy: 'نسخة المحل',
    print_receipt: 'طباعة الفاتورة', preview_receipt: 'معاينة', printing: 'جارٍ الطباعة',
    print_sent: 'أُرسلت إلى الطابعة', print_retry: 'أعد المحاولة من الفاتورة.',

    rc3_title: 'طابعة الفاتورة', rc3_sub: 'الفاتورة الحرارية ٨٠ مم التي يحملها الزبون',
    rc3_host: 'عنوان الطابعة (IP على الشبكة)', rc3_port: 'المنفذ', rc3_branch: 'اسم الفرع',
    rc3_auto_print: 'طباعة تلقائية عند البيع', rc3_auto_print_hint: 'أوقفها في عرض تجريبي للعميل — طابعة تعمل خلال اجتماع مظهر غير مناسب.',
    rc3_copies: 'عدد النسخ', rc3_cut_mode: 'القص', rc3_cut_partial: 'جزئي', rc3_cut_full: 'كامل',
    rc3_show_qr: 'رمز QR', rc3_show_barcode: 'الباركود', rc3_show_loyalty: 'سطور نقاط الولاء',
    rc3_footer_ar: 'التذييل (عربي)', rc3_footer_en: 'التذييل (إنجليزي)',
    rc3_policy_ar: 'سياسة الاستبدال (عربي)', rc3_policy_en: 'سياسة الاستبدال (إنجليزي)',
    rc3_save: 'حفظ إعدادات الفاتورة', rc3_saved: 'تم حفظ إعدادات الفاتورة',
    rc3_demo_note: 'لا يوجد خادم هنا — هذه القيم للعرض فقط ولا يمكن حفظها.',

    lbl_title: 'ملصقات حرارية',
    lbl_print_now: 'اطبع الآن', lbl_preview_title: 'معاينة الملصق',
    lbl_demo_only: 'لا يوجد خادم هنا — يمكن معاينة الملصق لكن لا يمكن طباعته.',
    lbl_queued: 'تمت إضافة {n} ملصق إلى {station}',
    lbl_pick_station: 'اختر محطة أولاً',
    lbl_calibrate_sent: 'تم إرسال أمر المعايرة',
    lbl_fallback: 'يتحول إلى Code128 — العرض غير كافٍ لـ EAN-13',
    lbl_station: 'المحطة', lbl_preset: 'المقاس', lbl_qty: 'العدد',
    lbl_batch_total: 'ملصق بالمجموع',
    lbl_thermal_section: 'ملصقات حرارية (XP-235B)',
    lbl_thermal_sub: 'ملصق الباركود على الصندوق، يُطبع عبر USB',
    lbl_queue_title: 'طابور الطباعة', lbl_queue_empty: 'لا يوجد شيء في الطابور',
    lbl_cancel: 'إلغاء', lbl_reprint: 'إعادة طباعة',
    lbl_unknown_code: 'هذا الرمز لا يطابق أي منتج',
    lbl_attach_code: 'اربط هذا الرمز بمنتج',
    lbl_attach_search: 'ابحث عن منتج…', lbl_attach_save: 'حفظ',
    lbl_save: 'حفظ إعدادات الملصق', lbl_saved: 'تم حفظ إعدادات الملصق',
    lbl_host: 'عنوان الطابعة (شبكة، لوضع النقل المباشر فقط)',
    lbl_port: 'المنفذ', lbl_transport: 'طريقة النقل', lbl_transport_agent: 'وكيل (لابتوب USB)',
    lbl_transport_tcp: 'مباشر (شبكة)', lbl_density: 'الكثافة', lbl_speed: 'السرعة',
    lbl_gap: 'الفجوة بين الملصقات (مم)', lbl_max_batch: 'سقف الدفعة',

    /* --- الحسومات --- */
    disc_capped: 'الحسم فوق {p}٪ يحتاج موافقة المدير',
    disc_max: 'أقصى حسم ممكن: {v}',
    wh_cost_later: 'المدير يضيف سعر التكلفة. اكتب سعر البيع فقط.',

    dash_title: 'لوحة التحكم', dash_sub: 'كل شيء عن المحل في شاشة واحدة',
    st_today: 'مبيعات اليوم', st_month: 'مبيعات هذا الشهر', st_products: 'المنتجات',
    st_critical: 'أصناف بمخزون حرج', st_customers: 'الزبائن النشطون', st_print: 'طلبات طباعة معلّقة',
    vs_yesterday: 'مقارنة بالأمس', vs_last_month: 'مقارنة بالشهر الماضي', vs_last_period: 'مقارنة بالفترة السابقة',
    in_catalogue: 'في الكتالوج', need_reorder: 'تحتاج طلب فوري',
    bought_90: 'اشتروا خلال ٩٠ يوم', in_queue: 'في قائمة يلا وير',
    sales_6m: 'المبيعات — آخر ٦ أشهر', sales_by_type: 'المبيعات حسب نوع المنتج',
    needs_attention: 'تحتاج انتباهك', recent_sales: 'آخر المبيعات', fix: 'معالجة',

    invoice: 'الفاتورة', customer: 'الزبون', date: 'التاريخ', items: 'الأصناف', total: 'الإجمالي',
    payment: 'الدفع', cashier: 'الكاشير', actions: 'إجراءات', qty: 'الكمية', size: 'القياس',
    unit_price: 'سعر القطعة', line_total: 'الإجمالي', price: 'السعر', cost: 'التكلفة',
    margin: 'الربح %', stock: 'المخزون', type: 'النوع', product: 'المنتج', name: 'الاسم',
    phone: 'الهاتف', city: 'المدينة', status: 'الحالة', notes: 'ملاحظات', barcode: 'الباركود',
    shelf: 'الرف', sku: 'الرمز', brand: 'الماركة', made_in: 'بلد الصنع', colour: 'اللون',

    pos_title: 'نقطة البيع', pos_sub: 'امسح، اختر القياس، خلصت — بأقل من عشر ثوانٍ',
    scan_ph: 'امسح الباركود أو ابحث عن منتج…', scan_btn: 'مسح', try_scanning: 'جرّب مسح:',
    cart: 'السلة', clear: 'إفراغ', empty_cart: 'السلة فارغة',
    empty_cart_sub: 'امسح باركود أو اضغط على منتج لبدء البيع',
    all_products: 'الكل', subtotal: 'المجموع', discount: 'الخصم', coupon: 'كود الخصم',
    apply: 'تطبيق', applied: 'مطبّق', points: 'نقطة', loyalty: 'الولاء',
    use_points: 'استخدم', payment_method: 'طريقة الدفع', add_print: 'أضف طلب طباعة لهذه الفاتورة',
    complete_sale: 'إتمام البيع', customer_ph: 'اكتب ٣ أرقام من الهاتف…', change_customer: 'تغيير',
    walk_in: 'زبون عابر', print_text: 'النص / الاسم المراد طباعته', priority: 'الأولوية',
    deadline: 'موعد التسليم', normal: 'عادي', urgent: 'مستعجل', amount: 'مبلغ', percent: 'نسبة',
    in_stock: 'متوفر', pick_size: 'اختر القياس', out_of_stock: 'غير متوفر',
    sale_complete: 'تمّ البيع', points_earned: 'نقاط الولاء المكتسبة',
    new_sale: 'بيع جديد', print: 'طباعة', pdf: 'PDF', thank_you: 'شكراً لك — نراك قريباً',
    served_by: 'بواسطة', bill_to: 'الفاتورة إلى',

    products_title: 'المنتجات', products_sub: 'كل صنف وكل قياس ومخزون لحظي',
    health: 'حالة المخزون', visible: 'ظاهر بالمتجر', healthy: 'جيد', low: 'منخفض',
    critical: 'حرج', out: 'منتهي', all_types: 'كل الأنواع', all_health: 'كل الحالات',
    per_size: 'المخزون حسب القياس', sales_trend: 'حركة المبيعات — آخر ٦ أشهر',
    size_gap_warn: 'فجوة قياسات — الكمية جيدة لكن القياسات المطلوبة صفر',
    total_stock: 'إجمالي المخزون', stock_value: 'قيمة المخزون بالتكلفة', last_sold: 'آخر بيع',
    edit_product: 'تعديل المنتج', reorder: 'طلب توريد',

    warehouse_title: 'المستودع', warehouse_sub: 'لا تتحرك قطعة دون أثر',
    tab_add: 'إضافة منتج', tab_moves: 'حركات المخزون',

    wh_stock: 'المخزون حسب المكان', wh_all: 'كل الأماكن',
    wh_location: 'المكان', wh_sell_from: 'اسحب البضاعة من',
    wh_not_here: 'مو موجود بالمحل', wh_in_the_back: 'بالمستودع',
    wh_bring_out: 'جيب وحدة', wh_moved: 'تم النقل',
    wh_count_where: 'وين رح تعدّ؟',
    wh_transfer: 'نقل بضاعة', wh_move: 'انقل', wh_from: 'من', wh_to: 'إلى',
    wh_qty_to_move: 'كم قطعة', wh_move_done: 'انتقلت البضاعة',
    wh_suggest: 'طلّع هدول من المستودع',
    wh_suggest_sub: 'صفر بالمحل وموجودة بالمستودع',
    wh_here: 'هون', wh_elsewhere: 'بمكان تاني',
    wh_pieces_here: 'قطعة هون', wh_value_here: 'القيمة بالتكلفة',
    wh_skus_here: 'قياس موجود هون',

    or_state: 'الطلب', or_draft: 'ما انبعت بعد', or_pending: 'بانتظار يلا وير',
    or_accepted: 'مقبول', or_declined: 'مرفوض',
    or_send: 'أرسل ليلا وير', or_send_again: 'أرسل مرة تانية',
    or_send_title: 'إرسال الطلب ليلا وير',
    or_send_hint: 'هيدا بالضبط يلي رح يشوفوه. فيهم يقبلوا أو يعتذروا.',
    or_sent_ok: 'انبعت الطلب — بانتظار موافقة يلا وير',
    or_cannot: 'ما فينا نبعت هالطلب',
    or_why_tbc: 'في قمصان لسا بلا أسماء. يلا وير ما بتقدر تطبع ظهر فاضي — أكّد الأسماء أول.',
    or_why_sent: 'هالطلب أصلاً عند يلا وير.',
    or_why_accepted: 'يلا وير قبلته من قبل.',
    or_wait_head: 'بانتظار رد يلا وير',
    or_wait_sub: 'انبعت وما إجا رد',
    or_declined_head: 'يلا وير اعتذرت عن هالطلب',
    or_promised: 'وعدوا فيه', or_requested: 'إنت طلبت',
    or_timeline: 'مسار الطلب',
    or_tl_created: 'إنشاء الطلب', or_tl_sent: 'انبعت ليلا وير',
    or_tl_accepted: 'يلا وير قبلت', or_tl_declined: 'يلا وير اعتذرت',
    or_by_og: 'OG', or_by_yalla: 'يلا وير',
    or_blocked_stage: 'يلا وير لسا ما قبلت هالطلب',
    or_wa: 'ابعته عالواتساب كمان',
    or_wa_title: 'إرسال الطلب عالواتساب',
    or_none_pending: 'ما في طلبات جديدة هلق',

    yl_new_orders: 'طلبات جديدة', yl_new_orders_sub: 'انبعتت من OG وناطرة ردّك',
    yl_accept: 'اقبل', yl_decline: 'اعتذر',
    yl_accept_title: 'قبول الطلب', yl_decline_title: 'الاعتذار عن الطلب',
    yl_promise: 'جاهز بتاريخ', yl_promise_hint: 'عهالتاريخ رح ينقاس التزامك، مو عتاريخ OG.',
    yl_decline_hint: 'خبّر OG ليش، بكلامك. رح يشوفوها فوراً.',
    yl_decline_ph: 'مثلاً: المكبس محجوز لتاريخ الأحد…',
    yl_accepted_ok: 'قبلت الطلب — صار عندك عاللوح',
    yl_declined_ok: 'اعتذرت — وانبلغت OG',
    yl_requested_by: 'OG طلبت',
    yl_sent_ago: 'انبعت',
    wh_empty_sizes: 'قياس فاضي هون', wh_none_here: 'ما في شي بهالمكان',
    wh_nothing_to_move: 'ما في شي لازم يطلع — المحل معبّى',
    wh_split_hint: 'المحل / المستودع',
    image: 'الصورة', upload_hint: 'اضغط للرفع', product_name: 'اسم المنتج',
    nav_more: 'المزيد', language: 'اللغة',
    wa_open: 'افتح في واتساب', wa_opened: 'فُتح واتساب والرسالة جاهزة',
    wa_handoff: 'يفتح واتساب والرسالة مكتوبة. الإرسال يتم من هناك.',
    wa_bad_number: 'رقم الهاتف غير صالح',
    wa_day_title: 'أرسل ملخّص اليوم', wa_day_empty: 'لا مبيعات مسجّلة اليوم بعد',
    wa_send_day: 'أرسل اليوم',
    po_place: 'إرسال الطلبية', po_rate: 'يُباع', po_week: 'أسبوع', po_cover: 'يكفي',
    po_order: 'الطلب', po_no_sales: 'لا مبيعات',
    po_need_qty: 'أدخل كمية على مقاس واحد على الأقل',
    po_explain: 'الكميات مقترحة من المبيعات الفعلية آخر ٨ أسابيع، بما يكفي ٤ أسابيع قادمة. ' +
                'يمكنك تعديل أي رقم.',
    po_whatsapp: 'أرسل على واتساب', po_received_toast: 'أُدخلت إلى المخزون',
    po_title: 'طلبيات الشراء', po_draft: 'مسودة', po_sent: 'مُرسلة', po_received: 'مستلمة',
    po_receive: 'استلام البضاعة', po_none: 'لا طلبيات شراء بعد',
    po_none_sub: 'اطلب أي منتج منخفض وستظهر هنا',
    po_suggest: 'يستحق إعادة الطلب', po_suggest_sub: 'من سرعة البيع الفعلية، الأكثر إلحاحاً أولاً',
    sc_title: 'مسح', sc_looking: 'وجّه الكاميرا نحو الملصق',
    sc_found: 'تم العثور على', sc_found_title: 'نتيجة المسح', sc_again: 'امسح آخر',
    sc_photo: 'التقط صورة بدلاً من ذلك', sc_torch: 'إضاءة',
    sc_no_torch: 'لا إضاءة في هذه الكاميرا',
    sc_type_code: 'أو اكتب الباركود', sc_go: 'اذهب',
    sc_reading: 'جارٍ قراءة الصورة…', sc_nothing: 'لم يُعثر على رمز في الصورة',
    sc_unknown: 'لا يوجد تطابق في النظام',
    sc_denied: 'رُفض إذن الكاميرا — اسمح به أو استخدم صورة',
    sc_nodevice: 'لا توجد كاميرا على هذا الجهاز',
    sc_failed: 'تعذّر فتح الكاميرا',
    sc_no_camera: 'الكاميرا المباشرة تحتاج https',
    sc_no_camera_sub: 'عند الفتح من ملف يمنع المتصفح الكاميرا. التقط صورة — النتيجة نفسها.',
    sc_use_photo: 'التقط صورة للملصق',
    sc_this_size: 'المقاس الممسوح', sc_all_sizes: 'كل المقاسات', sc_scanned: 'ممسوح',
    sc_add_to_sale: 'أضف إلى البيع', sc_per_week: 'أسبوعياً',

    sc_sells: 'بينباع', sc_last_8w: 'خلال آخر ٨ أسابيع',
    sc_months: ' شهر', sc_over_a_year: 'أكتر من سنة',
    sc_cover: 'بيكفّي حوالي', sc_at_this_rate: 'عهالسرعة',
    sc_not_moving: 'ما عم ينباع', sc_never_sold: 'ما انباع بهالقياس أبداً',
    sc_sourcing: 'من وين بيجي', sc_last_delivery: 'آخر توريد',
    sc_no_delivery: 'ما في شي مسجّل بعد',
    sc_recent_moves: 'آخر الحركات', sc_no_moves: 'ما تحرّك شي على هالقياس بعد.',
    sc_what_now: 'شو رح تعمل فيها؟',
    sc_check_in: 'دخّلها عالمخزون', sc_check_out: 'طلّعها من المخزون',
    sc_sell: 'بيعها',
    sc_enter_hint: 'اضغط Enter لتبيعها فوراً — خلّي القارئ بإيدك.',
    sc_checked_in: 'دخلت عالمخزون', sc_checked_out: 'طلعت من المخزون',
    sc_in_note: 'إدخال بالمسح', sc_out_note: 'إخراج بالمسح',
    sc_cannot_out: 'ما في شي تطلّعه', sc_only_had: 'كان في بس',

    hw_title: 'القارئ والطابعة', hw_sub: 'الأجهزة، وكيف تتأكد إنها شغّالة',
    hw_scanner: 'قارئ الباركود',
    hw_scanner_note: 'القارئ بالكبل أو بالدونغل أو بالبلوتوث كلهم بيكتبوا متل الكيبورد، فكلهم بيشتغلوا بلا إعداد. امسح بالمربّع تحت لتتأكد.',
    hw_test: 'امسح أي باركود هون للتجربة', hw_waiting: 'بانتظار مسح…',
    hw_last: 'آخر مسح', hw_gap: 'السرعة', hw_accepted: 'انعرف كمسح',
    hw_rejected: 'انقرأ ككتابة، مو مسح',
    hw_prefix: 'حرف البداية', hw_prefix_note: 'اختياري. إذا برمجت القارئ يبعت حرف قبل الكود، بيصير التعرّف أكيد بدل ما يكون على أساس السرعة.',
    hw_threshold: 'حدّ السرعة', hw_threshold_note: 'القارئ بيكتب أسرع من هالعدد بالميلي ثانية للحرف. زيّده إذا صار يفوّت مسحات حقيقية.',
    hw_printer: 'طابعة الملصقات',
    hw_printer_note: 'نزّل تعريف الطابعة، اختار قياس الملصق بالضبط، وبعدين اطبع تجربة. وضع الرول بيطبع ملصق بكل صفحة بالقياس الحقيقي.',
    hw_mode: 'الورق', hw_roll: 'رول ملصقات', hw_sheet: 'ورقة ستيكر A4',
    hw_test_label: 'اطبع ملصق تجربة', hw_calibrate: 'اطبع مسطرة',
    hw_calibrate_note: 'المساطر المطبوعة لازم تقيس ١٠ ملم بالضبط. إذا ما قاست، الطابعة عم تكبّر أو تصغّر والقياس بالتعريف مو مطابق للرول.',
    hw_symbology: 'الباركود على ملصقاتك',
    hw_sym_note: 'كود ١٢٨ بيحمل رمز الصنف نفسه، فالملصق بيقول شو هو وما بيتعارض أبداً مع باركود منتج حقيقي.',
    hw_camera_gap: 'عالموبايل يلي ما بيدعم الباركود أصلاً، الكاميرا بتقرأ EAN-13 بس مو كود ١٢٨. قارئ الباركود ما بيتأثر — بيفكّ الترميز عالجهاز.',
    sc_running_out: 'ينفد خلال {d} يوم تقريباً',
    sizes: 'المقاسات',
    st_count: 'جرد المخزون', st_intro_sub: 'امشِ على الرف، امسح، قارن',
    st_ready: 'جاهز للجرد', st_begin: 'ابدأ الجرد',
    st_ready_sub: 'امسح أو اكتب ما هو موجود فعلاً على الرف. لا شيء يتغيّر حتى الترحيل — ' +
                  'تتم المقارنة مع النظام أولاً وترى كل فرق قبل تطبيقه.',
    st_started: 'بدأ', st_progress: 'تم جرده', st_variance: 'الفروقات',
    st_sizes_differ: 'مقاساً غير مطابق', st_net_pieces: 'صافي القطع', st_vs_system: 'مقابل النظام',
    st_value: 'القيمة', st_at_cost: 'بسعر التكلفة',
    st_system: 'النظام', st_counted: 'المجرود', st_diff: 'الفرق',
    st_f_all: 'الكل', st_f_variance: 'الفروقات فقط', st_f_counted: 'مجرود', st_f_uncounted: 'غير مجرود',
    st_find: 'ابحث عن منتج أو رمز أو باركود…',
    st_now_counted: 'العدد:', st_showing: 'يعرض {n} من {t} — استخدم البحث للتضييق',
    st_post: 'ترحيل الجرد', st_post_q: 'تعديل {n} مقاساً؟',
    st_post_sub: '{p} قطعة · {v} بالتكلفة',
    st_post_note: 'تُعدَّل المقاسات التي جردتها فقط. ما تُرك فارغاً لا يُمسّ، وكل تعديل يُسجَّل في حركات المخزون.',
    st_posted: 'رُحّل — {n} مقاساً معدّلاً، {p} قطعة',
    st_adjust_note: 'جرد مخزون', st_last: 'آخر جرد', st_adjusted: 'مقاسات معدّلة',
    st_discard_title: 'إلغاء هذا الجرد؟',
    st_discard_body: 'جردت {n} مقاساً. لم يُطبَّق شيء على المخزون بعد، والإغلاق الآن يفقد الجرد.',
    st_discard: 'ألغِه',
    dup_title: 'قد يكون هذا المنتج موجوداً أصلاً',
    dup_head: 'يوجد منتج مشابه جداً',
    dup_sub: 'إضافته مرتين تقسّم المخزون بين منتجين، ولا يكون أي عدد منهما صحيحاً.',
    dup_match: 'التطابق', dup_use: 'أضف الكمية إلى هذا',
    dup_anyway: 'إنه منتج مختلف — أضفه',
    dup_note: 'أنت تضيف «{n}». إن كان لوناً أو موديلاً مختلفاً فعلاً، تابع.',
    mo_title: 'الحركة', mo_animations: 'الحركات والانتقالات',
    mo_hint: 'أطفئها إذا بدا التطبيق بطيئاً على جهاز عرض أو هاتف قديم.',
    mo_on: 'الحركات مفعّلة', mo_off: 'الحركات متوقفة',
    cp_title: 'بحث سريع', cp_placeholder: 'ابحث أو اكتب أمراً…',
    cp_new_sale: 'بيع جديد', cp_add_product: 'إضافة منتج',
    cp_scan_hint: 'الكاميرا', cp_go_to: 'اذهب إلى',
    cp_toggle_lang: 'تبديل اللغة', cp_toggle_curr: 'تبديل العملة',
    cp_cmd: 'أمر', cp_product: 'منتج', cp_customer: 'زبون',
    cp_invoice: 'فاتورة', cp_job: 'طلب طباعة',
    nav_money: 'المال', mn_title: 'المال', mn_sub: 'الصندوق، المصاريف، ومن له عليك',
    mn_shift: 'الوردية', mn_expenses: 'المصاريف', mn_debt: 'دفتر الدين',
    mn_open_shift: 'افتح وردية', mn_close_shift: 'إغلاق الوردية',
    mn_no_shift: 'لا توجد وردية مفتوحة',
    mn_no_shift_sub: 'افتح وردية بالمبلغ الموجود في الصندوق. كل بيع يُربط بها، وعند الإغلاق ' +
                     'يخبرك النظام بما يجب أن يكون في الصندوق.',
    mn_cashier: 'الكاشير', mn_float: 'رصيد الافتتاح',
    mn_float_hint: 'النقد الموجود في الصندوق قبل أول عملية بيع.',
    mn_shift_open: 'وردية مفتوحة', mn_open_since: 'مفتوحة منذ',
    mn_sales: 'مبيعات الوردية', mn_in_drawer: 'يجب أن يكون في الصندوق',
    mn_expected_now: 'الآن', mn_not_drawer: 'ليس في الصندوق',
    mn_settles_later: 'شام كاش، بطاقة — تُحصَّل لاحقاً',
    mn_drawer_now: 'الصندوق', mn_by_method: 'طريقة الدفع',
    mn_cash_sales: 'مبيعات نقدية', mn_debt_settled: 'ديون محصّلة', mn_cash_out: 'مدفوع نقداً',
    mn_expected: 'المتوقع', mn_counted: 'المعدود', mn_difference: 'الفرق',
    mn_count_now: 'عُدّ الصندوق واكتب المجموع',
    mn_close_hint: 'عُدّ النقود قبل النظر إلى الرقم المتوقع — المطابقة على رقم تعرفه مسبقاً ليست عدّاً.',
    mn_count_needed: 'اكتب ما عددته', mn_closed: 'أُغلقت',
    mn_balanced: 'مطابق تماماً', mn_short: 'ناقص', mn_over: 'زائد',
    mn_last_shift: 'آخر وردية', mn_in_box: 'في الصندوق', mn_to_account: 'إلى حساب',
    mn_owed: 'لك عند الزبون',
    mn_no_sales_yet: 'لا مبيعات في هذه الوردية بعد', mn_no_sales_sub: 'ستظهر هنا فور حدوثها',
    mn_add: 'إضافة', mn_add_expense: 'إضافة مصروف', mn_amount: 'المبلغ',
    mn_amount_needed: 'أدخل مبلغاً', mn_where: 'أين تذهب النقود',
    mn_category: 'التصنيف', mn_from_drawer: 'من الصندوق',
    mn_expense_hint: 'المصروف النقدي يُخصم من الوردية المفتوحة، ليبقى الصندوق مطابقاً.',
    mn_exp_month: 'مصاريف الشهر', mn_gross: 'مبيعات الشهر', mn_after_cost: 'بعد كلفة البضاعة',
    mn_minus_cogs: 'ناقص كلفة البضاعة', mn_net: 'الربح الحقيقي',
    mn_real_profit: 'بعد كل شيء', mn_this_month: 'هذا الشهر',
    mn_c_rent: 'الإيجار', mn_c_generator: 'المولّدة / الوقود', mn_c_salaries: 'الرواتب',
    mn_c_transport: 'النقل', mn_c_packaging: 'التغليف', mn_c_supplier: 'المورّد',
    mn_c_other: 'أخرى',
    mn_owed_total: 'لك عند الزبائن', mn_people: 'فاتورة غير مدفوعة', mn_over_30: 'أقدم من ٣٠ يوماً',
    mn_chase_these: 'تستحق المتابعة', mn_oldest: 'الأقدم', mn_still_owed: 'المتبقي',
    mn_age: 'العمر', mn_settle: 'تحصيل', mn_remind: 'تذكير',
    mn_part_paid: 'دفعة جزئية، تبقّى', mn_cleared: 'سُدِّد بالكامل',
    mn_settle_hint: 'النقد المحصَّل أثناء وردية مفتوحة يدخل صندوقها.',
    mn_no_debt: 'لا أحد مدين لك', mn_no_debt_sub: 'مبيعات الدين تظهر هنا حتى تُسدَّد',
    up_pick: 'أضف صورة', up_hint: 'اضغط · اسحب · الصق',
    up_swap: 'تغيير الصورة', up_colour: 'استخدم لوناً بدلاً منها',
    up_ok: 'تمت إضافة الصورة',
    up_err_none: 'لم يتم اختيار أي ملف',
    up_err_type: 'هذا الملف ليس صورة',
    up_err_size: 'الصورة كبيرة جداً — الحد ١٢ ميغابايت',
    up_err_read: 'تعذّرت قراءة الملف',
    up_err_decode: 'الصورة تالفة أو بصيغة لا يدعمها المتصفح',
    cost_price: 'سعر التكلفة', selling_price: 'سعر البيع', shelf_box: 'الرف / الصندوق',
    size_matrix: 'الكمية لكل قياس', matrix_hint: 'أدخل الكمية — يتم توليد باركود لكل قياس',
    print_labels: 'طباعة ملصقات الباركود', save_product: 'حفظ المنتج في المستودع',
    barcode_preview: 'الباركودات المولّدة', movement: 'الحركة', user: 'المستخدم',
    balance: 'الرصيد بعدها', received: 'وارد', sold: 'مبيع', damaged: 'تالف',
    returned: 'مرتجع', transfer: 'نقل', label_sheet: 'ملصقات الباركود',
    total_pieces: 'إجمالي القطع', total_cost: 'إجمالي التكلفة', expected_revenue: 'الإيراد المتوقع',

    customers_title: 'الزبائن', customers_sub: 'من يشتري وماذا يشتري ومتى توقّف',
    cu_new: 'زبون جديد', cu_name_ph: 'الاسم الكامل',
    cu_new_note: 'ثلاث خانات وبس. النقاط تبدأ من صفر وتزيد من أول عملية بيع.',
    cu_exists: 'موجود في القائمة',
    no_access: 'حسابك ما عندو صلاحية لهالشي',
    tier: 'الفئة', total_spent: 'إجمالي الإنفاق', last_purchase: 'آخر شراء',
    at_risk: 'معرّض للفقدان', send_whatsapp: 'إرسال واتساب', purchase_history: 'سجل المشتريات',
    points_timeline: 'سجل نقاط الولاء', preferred_sizes: 'القياسات المفضلة',
    source: 'المصدر', online: 'أونلاين', in_store: 'من المحل', gold: 'ذهبي', silver: 'فضي',
    bronze: 'برونزي', all_customers: 'كل الزبائن', risk_only: 'المعرّضون فقط',
    gold_only: 'الذهبيون فقط', whatsapp_msg: 'رسالة واتساب', send: 'إرسال',
    days_ago: 'يوم مضى', today_word: 'اليوم', yesterday: 'أمس', in_days: 'خلال',
    days: 'يوم', orders: 'الطلبات',

    print_title: 'أعمال الطباعة', print_sub: 'كل طلب تيشيرت من التصميم حتى التسليم',
    jobs_month: 'طلبات هذا الشهر', on_time: 'التسليم بالوقت', print_revenue: 'إيراد الطباعة',
    paid_partner: 'المدفوع ليلا وير', partner_view: 'فتح واجهة يلا وير',
    admin_view: 'العودة لواجهة الإدارة', partner_access: 'وصول شريك',
    partner_note: 'هذا كل ما يراه شريك الطباعة. لا تكاليف، لا أرقام هواتف زبائن، لا مخزون، ولا أسعارك.',
    overdue: 'متأخر', design_note: 'ملاحظة التصميم', drag_hint: 'اسحب البطاقة بين الأعمدة لتغيير المرحلة',

    reports_title: 'التقارير', reports_sub: 'الأرقام الحقيقية خلف المحل',
    tab_sales: 'المبيعات', tab_profit: 'الأرباح', tab_inventory: 'قيمة المخزون',
    tab_employees: 'الموظفون', tab_suppliers: 'الموردون',
    export_excel: 'تصدير Excel', export_pdf: 'تصدير PDF', revenue: 'الإيراد',
    profit: 'الربح', units: 'القطع', capital_in_stock: 'رأس المال المجمّد بالمخزون',
    retail_value: 'قيمة البيع', role: 'الوظيفة', salary: 'الراتب الشهري',
    next_payment: 'الدفعة القادمة', outstanding: 'المستحق', due: 'الاستحقاق',
    supplier: 'المورّد', category: 'الفئة', sales_made: 'المبيعات المنجزة',
    avg_basket: 'متوسط الفاتورة', invoices: 'الفواتير', best_sellers: 'الأكثر مبيعاً',
    generating: 'جاري التجهيز…', export_ready: 'الملف جاهز',

    store_title: 'المتجر الإلكتروني', store_sub: 'ما يراه زبونك على هاتفه',
    store_note: 'الطلبات التي تُنفّذ هنا تظهر في قائمة الطلبات لدى الإدارة للتأكيد.',
    orders_queue: 'قائمة الطلبات', add_to_cart: 'أضف للسلة', checkout: 'إتمام الطلب',
    place_order: 'تأكيد الطلب', whatsapp: 'رقم الواتساب', gender: 'الجنس',
    male: 'ذكر', female: 'أنثى', choose_size: 'اختر قياسك', back: 'رجوع',
    shop_all: 'تصفّح الكل', order_placed: 'تم استلام الطلب', pending: 'بانتظار التأكيد',
    confirmed: 'مؤكد', confirm: 'تأكيد', live_shop: 'معاينة المتجر',
    products_online: 'منتج ظاهر', hidden_count: 'مخفي عن المتجر',

    settings_title: 'الإعدادات', settings_sub: 'القواعد والصلاحيات والمال',
    roles_perms: 'الصلاحيات والأدوار', exchange_rate: 'سعر الصرف',
    loyalty_rules: 'قواعد الولاء', reminders: 'التذكيرات التلقائية', branding: 'الهوية',
    save_changes: 'حفظ التعديلات', role_admin: 'مدير عام', role_manager: 'مدير',
    role_cashier: 'كاشير', role_warehouse: 'مستودع', permission: 'الصلاحية',
    points_per: 'نقاط لكل ١٠٠٠ ل.س', point_value: 'قيمة النقطة الواحدة',
    rate_hint: '١ دولار يساوي', shop_name: 'اسم المحل', accent_colour: 'اللون المميز',

    tour_start: 'جولة العرض', next: 'التالي', back_btn: 'السابق', skip: 'تخطي',
    step: 'خطوة', of: 'من', close: 'إغلاق', cancel: 'إلغاء', save: 'حفظ',
    all_word: 'الكل', none: 'لا شيء', yes: 'نعم', no: 'لا', remove: 'حذف',
    print_job: 'طلب طباعة', for_word: 'لـ', day_word: 'يوم',
    day_overdue: 'يوم تأخير', days_overdue: 'أيام تأخير',
    payment_overdue: 'الدفعة متأخرة', payment_due: 'دفعة مستحقة',
    size_gap: 'فجوة قياس', gap_only: 'فجوات القياسات', pieces: 'قطعة', all_new: 'كلها جديدة'
  }
};

function t(key) {
  var d = I18N[OG.lang] || I18N.en;
  return (d[key] !== undefined ? d[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key));
}

/* ------------------------------------------------------------ 3. FORMATTING */

function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

function money(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + ' ' + (OG.lang === 'ar' ? 'ل.س' : 'SYP');
}

/* Big stat cards: full separators, currency demoted so long numbers still fit. */
function moneyStat(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + '<span class="cur">' + (OG.lang === 'ar' ? 'ل.س' : 'SYP') + '</span>';
}

function moneyShort(syp) {
  var v = OG.currency === 'USD' ? (Number(syp) || 0) / CONFIG.EXCHANGE_RATE : (Number(syp) || 0);
  return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v);
}

function pct(n, digits) { return (Number(n) || 0).toFixed(digits === undefined ? 1 : digits) + '%'; }

var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_AR = ['كانون٢', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين١', 'تشرين٢', 'كانون١'];

function fmtDate(d) {
  d = new Date(d);
  var m = OG.lang === 'ar' ? MONTHS_AR[d.getMonth()] : MONTHS_EN[d.getMonth()];
  return d.getDate() + ' ' + m + ' ' + d.getFullYear();
}

function fmtDateTime(d) {
  d = new Date(d);
  var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  /* ص / م, not AM / PM. Two Latin letters in the middle of an Arabic line
     read as a missing translation, and this one is printed on the receipt a
     customer walks out holding. */
  var ap = OG.lang === 'ar'
    ? (hh >= 12 ? 'م' : 'ص')
    : (hh >= 12 ? 'PM' : 'AM');
  var h12 = hh % 12 || 12;
  return fmtDate(d) + ' · ' + h12 + ':' + mm + ' ' + ap;
}

/* "3 days ago" / "in 3 days" / "today" */
function relDate(d) {
  var n = DB.daysSince(d);
  if (n === 0) return t('today_word');
  if (n === 1) return t('yesterday');
  if (n > 0) return n + ' ' + t('days_ago');
  return t('in_days') + ' ' + Math.abs(n) + ' ' + t('days');
}

function dateWithRel(d) { return fmtDate(d) + ' <span class="muted">· ' + relDate(d) + '</span>'; }

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function deltaTag(now, before, suffix) {
  var tail = '<span class="muted" style="font-weight:500">' + (suffix || '') + '</span>';
  /* No baseline to divide by — "100%" would be a lie, so say what it is. */
  if (!before) {
    return '<div class="delta ' + (now ? 'up' : 'flat') + '">' +
           (now ? '▲ ' + t('all_new') : '—') + ' ' + tail + '</div>';
  }
  var d = (now - before) / before * 100, cls, arrow;
  if (Math.abs(d) < 0.5) { cls = 'flat'; arrow = '—'; }
  else if (d > 0) { cls = 'up'; arrow = '▲'; }
  else { cls = 'down'; arrow = '▼'; }
  return '<div class="delta ' + cls + '">' + arrow + ' ' + Math.abs(d).toFixed(1) + '% ' + tail + '</div>';
}

/* Phone numbers, addresses and SKUs are latin runs. In RTL the bidi algorithm
   reorders their space-separated groups ("+963 960 380 435" renders backwards),
   so isolate them with <bdi dir="ltr">. */
function tel(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }

/* A product shows a real photo when it has one and its colour block when it
   does not. `image.src` is a data URL held in memory — the original brief said
   no stock photo URLs, and this is not one: it is the shop's own picture, and
   it never leaves the browser. */
function thumb(p, cls) {
  if (p.image && p.image.src) {
    return '<span class="thumb ' + (cls || '') + ' has-img">' +
           '<img src="' + p.image.src + '" alt="' + esc(p.name) + '"></span>';
  }
  return '<span class="thumb ' + (cls || '') + '" style="background:' + p.image.bg + '">' + p.image.initials + '</span>';
}

/* Big square version, for the storefront and the product drawer. */
function thumbBox(p, cls) {
  if (p.image && p.image.src) {
    return '<div class="thumb-box ' + (cls || '') + ' has-img">' +
           '<img src="' + p.image.src + '" alt="' + esc(p.name) + '"></div>';
  }
  return '<div class="thumb-box ' + (cls || '') + '" style="background:' + p.image.bg + '">' +
         p.image.initials + '</div>';
}

/* ------------------------------------------------------------ IMAGE INTAKE
   Reads a picture off the user's machine and turns it into a small data URL.

   The downscale is not cosmetic. A phone photo is 3–6 MB; held raw as a data
   URL it would sit in memory base64-encoded (a third bigger again) and would
   be embedded whole into any export. 420px is more than the largest place the
   image is ever displayed.

   WebP first because it keeps transparency AND compresses well; canvas falls
   back to PNG on its own if the browser will not encode WebP, which we detect
   from the returned prefix rather than assuming. */
var IMG_MAX_PX = 420;
var IMG_MAX_BYTES = 12 * 1024 * 1024;

function readImageFile(file, done) {
  if (!file) { done(null, 'none'); return; }
  if (String(file.type).indexOf('image/') !== 0) { done(null, 'type'); return; }
  if (file.size > IMG_MAX_BYTES) { done(null, 'size'); return; }

  var fr = new FileReader();
  fr.onerror = function () { done(null, 'read'); };
  fr.onload = function () {
    var im = new Image();
    im.onerror = function () { done(null, 'decode'); };
    im.onload = function () {
      var scale = Math.min(1, IMG_MAX_PX / Math.max(im.width, im.height));
      var w = Math.max(1, Math.round(im.width * scale));
      var h = Math.max(1, Math.round(im.height * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, 0, 0, w, h);
      var out;
      try { out = cv.toDataURL('image/webp', 0.85); } catch (e) { out = null; }
      if (!out || out.indexOf('data:image/webp') !== 0) {
        try { out = cv.toDataURL('image/png'); } catch (e2) { out = null; }
      }
      /* If the canvas refused entirely, hand back the original rather than
         losing the user's picture — it is bigger, but it is theirs. */
      done(out || fr.result, null);
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* Everything that can hand us a picture funnels through here, so the toast,
   the validation and the repaint are written once. */
function takeProductImage(file) {
  readImageFile(file, function (src, err) {
    if (err) {
      toast(t('image'), t('up_err_' + err), 'err', 4000);
      return;
    }
    OG.wh.imgSrc = src;
    OG.wh.img = null;
    render();
    toast(t('image'), t('up_ok'), 'ok', 2000);
  });
}

function healthBadge(qty) {
  var h = DB.health(qty);
  return '<span class="badge ' + h + '"><i class="dot ' + h + '"></i>' + t(h) + '</span>';
}

/* ---------------------------------------------------- delivery-style tracker
   The parcel-tracking metaphor the client asked for: circles joined by
   arrows. Shared by the OG print board and the Yalla Wear portal, so both
   sides of the job read identically. `compact` drops labels for card use. */
function stepper(stage, opts) {
  opts = opts || {};
  var stages = DB.printStages;
  var cur = stages.indexOf(stage);
  var h = '<div class="track' + (opts.compact ? ' compact' : '') + (opts.overdue ? ' late' : '') + '">';

  stages.forEach(function (s, i) {
    var state = i < cur ? 'done' : (i === cur ? 'now' : 'next');
    var at = null;
    if (opts.history) {
      var hit = opts.history.filter(function (x) { return x.stage === s; })[0];
      at = hit ? hit.at : null;
    }
    var label = t('print_' + s);

    if (i) h += '<span class="track-arrow" aria-hidden="true"></span>';
    h += '<span class="track-step ' + state + '" title="' + esc(label + (at ? ' · ' + fmtDate(at) : '')) + '">' +
      '<span class="track-node">' + (state === 'done' ? '&#10003;' : (i + 1)) + '</span>' +
      (opts.compact ? '' :
        '<span class="track-label">' + label + '</span>' +
        '<span class="track-time">' +
          (at ? fmtDate(at) : (state === 'now' ? t('yl_now') : '—')) + '</span>') +
    '</span>';
  });

  return h + '</div>';
}

/* ------------------------------------------------------------ QR payloads
   Text by default: it resolves on any phone with no internet, which a URL
   would not. Set CONFIG.QR_MODE = 'url' in js/data.js once the app is
   deployed and every printed code becomes a link that opens the record.

   In url mode these go through deepLink(), not CONFIG.QR_BASE_URL — that
   constant is a placeholder domain, so scanning it would land on nothing.
   deepLink() emits a route the app actually handles. */
function qrForVariant(v) {
  var p = DB.product(v.productId);
  if (CONFIG.QR_MODE === 'url') return deepLink('product', v.productId);
  return CONFIG.SHOP_NAME.toUpperCase() + '\n' + p.name + '\n' +
         t('size') + ' ' + v.size + ' | ' + v.sku + '\n' +
         money(p.sellingPrice) + ' | ' + v.shelf;
}

function qrForSale(sale) {
  if (CONFIG.QR_MODE === 'url') return deepLink('invoice', sale.id);
  return CONFIG.SHOP_NAME.toUpperCase() + ' | ' + sale.id + '\n' +
         money(sale.total) + '\n' + fmtDateTime(sale.date) + '\n' + CONFIG.SHOP_ADDRESS;
}

/* Never let an over-long payload silently render a blank square. */
function qrSafe(text, fallback, opts) {
  var svg = Codes.qrSVG(text, opts);
  return svg || Codes.qrSVG(fallback, opts);
}

/* ------------------------------------------------------------ 4. FEEDBACK */

/* `action` = { label, attrs } renders a button inside the toast — used by the
   bulk Undo. The toast container is pointer-events:none, so a toast carrying
   an action has to re-enable them on itself. */
function toast(title, msg, kind, ms, action) {
  var host = document.getElementById('toasts');
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<div style="flex:1"><b>' + esc(title) + '</b>' +
                 (msg ? '<small>' + esc(msg) + '</small>' : '') + '</div>' +
                 (action ? '<button class="toast-act" ' + action.attrs + '>' + esc(action.label) + '</button>' : '');
  if (action) el.style.pointerEvents = 'auto';
  host.appendChild(el);
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, ms || 3000);
}

/* `sheet: true` makes it rise from the bottom edge instead of sitting in the
   middle — the phone idiom, and thumb-reachable. Everything else is identical,
   so no caller has to know which shape it will take. */
function openModal(o) {
  closeModal();
  var root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop' + (o.sheet ? ' as-sheet' : '') + '" data-act="modal-backdrop">' +
      '<div class="modal ' + (o.size || '') + (o.sheet ? ' sheet' : '') + '">' +
        (o.title ? '<div class="modal-head"><h3>' + o.title + '</h3>' +
          '<button class="x" data-act="modal-close" aria-label="Close">&times;</button></div>' : '') +
        '<div class="modal-body">' + o.body + '</div>' +
        (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  if (o.onOpen) o.onOpen(root);
  /* Held on the module, not on the DOM, because closeModal() wipes innerHTML
     and there are four ways out of a modal — the ×, the backdrop, Escape, and
     another modal opening on top. A teardown that only runs on one of them is
     a teardown that does not run. */
  modalOnClose = o.onClose || null;
}

var modalOnClose = null;

function closeModal() {
  var fn = modalOnClose;
  modalOnClose = null;
  if (fn) { try { fn(); } catch (e) { console.warn('modal onClose', e); } }
  document.getElementById('modal-root').innerHTML = '';
}
function modalOpen() { return !!document.getElementById('modal-root').firstChild; }

function openDrawer(o) {
  closeDrawer();
  var root = document.getElementById('drawer-root');
  root.innerHTML =
    '<div class="drawer-backdrop" data-act="drawer-close"></div>' +
    '<aside class="drawer">' +
      '<div class="drawer-head">' + o.head +
        '<button class="x" data-act="drawer-close" style="margin-inline-start:auto;border:0;background:none;font-size:22px;line-height:1;color:var(--muted-foreground)">&times;</button>' +
      '</div>' +
      '<div class="drawer-body">' + o.body + '</div>' +
    '</aside>';
  if (o.onOpen) o.onOpen(root);
}

function closeDrawer() { document.getElementById('drawer-root').innerHTML = ''; }

/* ------------------------------------------------------------ EXPORT SPECS
   Money leaves as a raw number in the active currency so Excel can sum it —
   the unit goes in the column heading instead of into every cell. */

function exCur() { return OG.currency === 'USD' ? 'USD' : 'SYP'; }
function exMoney(v) {
  return Math.round(OG.currency === 'USD' ? (Number(v) || 0) / CONFIG.EXCHANGE_RATE : (Number(v) || 0));
}
function exCol(label) { return label + ' (' + exCur() + ')'; }

function reportExportSpec() {
  var tab = OG.rep.tab, s = { name: 'report-' + tab, chartId: 'repChart',
                              docUrl: deepLink('report', tab),
                              subtitle: fmtDate(daysAgo(179)) + ' — ' + fmtDate(TODAY) };

  if (tab === 'sales') {
    var m = DB.monthlySales(6);
    var tot = m.reduce(function (a, x) { return a + x.total; }, 0);
    var inv = m.reduce(function (a, x) { return a + x.count; }, 0);
    s.title = t('tab_sales'); s.sheet = 'Sales';
    s.columns = [{ label: 'Month' }, { label: t('invoices'), num: true },
                 { label: exCol(t('revenue')), num: true }, { label: exCol(t('avg_basket')), num: true }];
    s.rows = m.map(function (x) {
      return [x.label + ' ' + x.date.getFullYear(), x.count, exMoney(x.total),
              exMoney(x.count ? x.total / x.count : 0)];
    });
    s.totals = [t('total'), inv, exMoney(tot), exMoney(inv ? tot / inv : 0)];
    s.kpis = [{ label: t('revenue'), value: money(tot) }, { label: t('invoices'), value: nf(inv) },
              { label: t('avg_basket'), value: money(inv ? tot / inv : 0) }];

  } else if (tab === 'profit') {
    var rows = DB.profitByType();
    var tr = rows.reduce(function (a, x) { return a + x.revenue; }, 0);
    var tc = rows.reduce(function (a, x) { return a + x.cost; }, 0);
    s.title = t('tab_profit'); s.sheet = 'Profit';
    s.columns = [{ label: t('type') }, { label: t('units'), num: true },
                 { label: exCol(t('revenue')), num: true }, { label: exCol(t('cost')), num: true },
                 { label: exCol(t('profit')), num: true }, { label: t('margin') }];
    s.rows = rows.map(function (x) {
      return [x.label, x.units, exMoney(x.revenue), exMoney(x.cost), exMoney(x.profit), pct(x.margin, 1)];
    });
    s.totals = [t('total'), null, exMoney(tr), exMoney(tc), exMoney(tr - tc), pct((tr - tc) / tr * 100, 1)];
    s.kpis = [{ label: t('revenue'), value: money(tr) }, { label: t('profit'), value: money(tr - tc) },
              { label: t('margin'), value: pct((tr - tc) / tr * 100, 1) }];

  } else if (tab === 'inventory') {
    var inv2 = DB.inventoryValue();
    var tCost = inv2.reduce(function (a, x) { return a + x.cost; }, 0);
    var tRet = inv2.reduce(function (a, x) { return a + x.retail; }, 0);
    var tU = inv2.reduce(function (a, x) { return a + x.units; }, 0);
    s.title = t('tab_inventory'); s.sheet = 'Inventory';
    s.columns = [{ label: t('type') }, { label: t('units'), num: true },
                 { label: exCol(t('capital_in_stock')), num: true },
                 { label: exCol(t('retail_value')), num: true }, { label: exCol(t('profit')), num: true }];
    s.rows = inv2.map(function (x) {
      return [x.label, x.units, exMoney(x.cost), exMoney(x.retail), exMoney(x.retail - x.cost)];
    });
    s.totals = [t('total'), tU, exMoney(tCost), exMoney(tRet), exMoney(tRet - tCost)];
    s.kpis = [{ label: t('capital_in_stock'), value: money(tCost) },
              { label: t('retail_value'), value: money(tRet) },
              { label: t('total_pieces'), value: nf(tU) }];

  } else if (tab === 'employees') {
    s.title = t('tab_employees'); s.sheet = 'Employees';
    s.columns = [{ label: t('name') }, { label: t('role') }, { label: exCol(t('salary')), num: true },
                 { label: exCol(t('sales_made')), num: true }, { label: t('next_payment') }];
    s.rows = DB.employees.map(function (e) {
      return [e.name, e.role, exMoney(e.salary), exMoney(e.sales), fmtDate(e.nextPayment)];
    });
    s.totals = [t('total'), null, exMoney(DB.employees.reduce(function (a, e) { return a + e.salary; }, 0)),
                exMoney(DB.employees.reduce(function (a, e) { return a + e.sales; }, 0)), null];

  } else {
    s.title = t('tab_suppliers'); s.sheet = 'Suppliers';
    s.columns = [{ label: t('supplier') }, { label: t('category') },
                 { label: exCol('Total purchased'), num: true },
                 { label: exCol(t('outstanding')), num: true }, { label: t('due') }];
    s.rows = DB.suppliers.map(function (x) {
      return [x.name, x.category, exMoney(x.totalPurchased), exMoney(x.outstanding), fmtDate(x.dueDate)];
    });
    s.totals = [t('total'), null, exMoney(DB.suppliers.reduce(function (a, x) { return a + x.totalPurchased; }, 0)),
                exMoney(DB.suppliers.reduce(function (a, x) { return a + x.outstanding; }, 0)), null];
  }
  return s;
}

/* An export is the same data with a different lid on it. A column hidden on
   screen and present in the spreadsheet is not protected — it is protected
   from being glanced at, which is not a thing anyone needs. Both cost and
   margin are gated here on exactly the permissions the table uses. */
function productsExportSpec() {
  var rows = productRows();
  var cost = seesCost(), profit = seesProfit();

  var columns = [{ label: t('product'), width: 32 }, { label: t('brand') }, { label: t('type') },
                 { label: t('stock'), num: true }];
  if (cost) columns.push({ label: exCol(t('cost')), num: true });
  columns.push({ label: exCol(t('price')), num: true });
  if (profit) columns.push({ label: t('margin') });
  columns.push({ label: t('health') }, { label: t('visible') });

  var pieces = rows.reduce(function (a, r) { return a + r.qty; }, 0);

  return {
    name: 'products', sheet: 'Products', title: t('products_title'),
    docUrl: deepLink('report', 'inventory'),
    subtitle: rows.length + ' / ' + DB.products.length + ' · ' + fmtDate(TODAY),
    columns: columns,
    rows: rows.map(function (r) {
      var out = [r.p.name, r.p.brand, DB.typeLabels[r.type], r.qty];
      if (cost) out.push(exMoney(r.cost));
      out.push(exMoney(r.price));
      if (profit) out.push(pct(r.margin, 0));
      out.push(t(r.health) + (DB.sizeGaps(r.p.id).length ? ' · ' + t('size_gap') : ''),
               r.p.hidden ? t('no') : t('yes'));
      return out;
    }),
    /* One entry per column, or the totals row slides out of alignment with
       its own header the moment a column is dropped. */
    totals: columns.map(function (c, i) {
      return i === 0 ? t('total') : (i === 3 ? pieces : null);
    }),
    kpis: [{ label: t('st_products'), value: nf(DB.products.length) },
           { label: t('total_pieces'), value: nf(pieces) },
           { label: t('st_critical'), value: nf(DB.criticalVariants().length) }]
  };
}

function customersExportSpec() {
  var list = DB.customers.slice().sort(function (a, b) { return b.totalSpent - a.totalSpent; });
  return {
    name: 'customers', sheet: 'Customers', title: t('customers_title'),
    docUrl: deepLink('report', 'sales'),
    subtitle: list.length + ' · ' + DB.inactiveCustomers(90).length + ' ' + t('at_risk'),
    columns: [{ label: t('name'), width: 24 }, { label: t('phone') }, { label: t('city') },
              { label: t('tier') }, { label: t('loyalty'), num: true },
              { label: exCol(t('total_spent')), num: true }, { label: t('orders'), num: true },
              { label: t('last_purchase') }],
    rows: list.map(function (c) {
      return [c.name, c.phone, c.city, t(DB.tier(c.loyaltyPoints)), c.loyaltyPoints,
              exMoney(c.totalSpent), c.history.length, fmtDate(c.lastPurchaseDate)];
    }),
    totals: [t('total'), null, null, null, null,
             exMoney(list.reduce(function (a, c) { return a + c.totalSpent; }, 0)),
             list.reduce(function (a, c) { return a + c.history.length; }, 0), null],
    kpis: [{ label: t('customers_title'), value: nf(list.length) },
           { label: t('at_risk'), value: nf(DB.inactiveCustomers(90).length) }]
  };
}

function warehouseExportSpec() {
  /* Tab-aware: exporting from "Add product" must not hand back the movement log. */
  if (OG.wh.tab !== 'moves') {
    var sizes = DB.sizeSets[OG.wh.type] || [];
    var rows = [];
    sizes.forEach(function (s, i) {
      var q = Number(OG.wh.sizes[s] || 0);
      rows.push([s, q, whBarcode(OG.wh.type, s, i + 1)]);
    });
    return {
      name: 'new-product', sheet: 'New product', title: t('tab_add'),
      subtitle: (OG.wh.name || t('product_name')) + ' · ' + DB.typeLabels[OG.wh.type],
      columns: [{ label: t('size') }, { label: t('qty'), num: true }, { label: t('barcode') }],
      rows: rows,
      totals: [t('total_pieces'), rows.reduce(function (a, r) { return a + r[1]; }, 0), null],
      kpis: [{ label: t('type'), value: DB.typeLabels[OG.wh.type] },
             { label: t('size_matrix'), value: sizes.length + ' ' + t('size').toLowerCase() }]
    };
  }

  var mv = DB.stockMovements.slice(0, 200);
  return {
    name: 'stock-movements', sheet: 'Movements', title: t('tab_moves'),
    subtitle: mv.length + ' ' + t('movement').toLowerCase(),
    columns: [{ label: t('date') }, { label: t('movement') }, { label: t('product'), width: 30 },
              { label: t('size') }, { label: t('sku') }, { label: t('qty'), num: true },
              { label: t('balance'), num: true }, { label: t('user') }, { label: t('notes'), width: 34 }],
    rows: mv.map(function (m) {
      var p = DB.product(m.productId);
      return [fmtDate(m.date), t(m.type), p ? p.name : '—', m.size, m.sku, m.delta, m.balance, m.user, m.note];
    })
  };
}

function printJobsExportSpec() {
  var jobs = DB.printJobs.slice().sort(function (a, b) { return a.deadline - b.deadline; });
  var rev = jobs.reduce(function (a, j) { return a + j.price; }, 0);
  var cost = jobs.reduce(function (a, j) { return a + j.cost; }, 0);
  return {
    name: 'print-jobs', sheet: 'Print jobs', title: t('print_title'),
    docUrl: deepLink('report', 'profit'),
    subtitle: jobs.length + ' · ' + jobs.filter(function (j) { return DB.isOverdue(j); }).length + ' ' + t('overdue').toLowerCase(),
    columns: [{ label: t('yl_job') }, { label: t('customer'), width: 22 }, { label: t('design_note'), width: 36 },
              { label: t('qty'), num: true }, { label: t('priority') }, { label: t('deadline') },
              { label: t('status') }, { label: exCol(t('yl_charged')), num: true },
              { label: exCol(t('paid_partner')), num: true }, { label: exCol(t('profit')), num: true }],
    rows: jobs.map(function (j) {
      return [j.id, j.customer, j.design, j.qty, t(j.priority), fmtDate(j.deadline),
              t('print_' + j.stage), exMoney(j.price), exMoney(j.cost), exMoney(j.price - j.cost)];
    }),
    totals: [t('total'), null, null, jobs.reduce(function (a, j) { return a + j.qty; }, 0),
             null, null, null, exMoney(rev), exMoney(cost), exMoney(rev - cost)],
    kpis: [{ label: t('print_revenue'), value: money(rev) },
           { label: t('paid_partner'), value: money(cost) },
           { label: t('profit'), value: money(rev - cost) }]
  };
}

function ordersExportSpec() {
  return {
    name: 'store-orders', sheet: 'Orders', title: t('orders_queue'),
    subtitle: DB.storeOrders.length + ' · ' + fmtDate(TODAY),
    columns: [{ label: 'Order' }, { label: t('name'), width: 22 }, { label: t('phone') },
              { label: t('city') }, { label: t('items'), width: 34 }, { label: t('payment') },
              { label: t('status') }, { label: exCol(t('total')), num: true }],
    rows: DB.storeOrders.map(function (o) {
      return [o.id, o.name, o.phone, o.city, o.items, DB.payLabel(o.payment), t(o.status), exMoney(o.total)];
    }),
    totals: [t('total'), null, null, null, null, null, null,
             exMoney(DB.storeOrders.reduce(function (a, o) { return a + o.total; }, 0))]
  };
}

function salesExportSpec() {
  var sales = DB.sales.slice(0, 200);
  return {
    name: 'sales', sheet: 'Sales', title: t('recent_sales'), chartId: 'dashLine',
    subtitle: sales.length + ' ' + t('invoices').toLowerCase(),
    columns: [{ label: t('invoice') }, { label: t('date') }, { label: t('customer'), width: 22 },
              { label: t('items'), num: true }, { label: t('payment') },
              { label: exCol(t('total')), num: true }],
    rows: sales.map(function (s) {
      return [s.id, fmtDate(s.date), s.customerName,
              s.items.reduce(function (a, i) { return a + i.qty; }, 0),
              DB.payLabel(s.payment), exMoney(s.total)];
    }),
    totals: [t('total'), null, null, null, null,
             exMoney(sales.reduce(function (a, s) { return a + s.total; }, 0))]
  };
}

/* ------------------------------------------------------- DEEP LINKS
   #open/<type>/<id> — the destination a scanned QR lands on. Works when
   pasted from file://, and works from a phone camera once the folder is
   served on the LAN. Same route the printed receipt will use. */

function deepLink(type, id) {
  /* CONFIG.PUBLIC_URL wins when it is set: a QR printed today has to keep
     working from a phone that has never seen this laptop. Without it the link
     would carry file:/// or a LAN IP and die the moment it leaves the room. */
  var base = CONFIG.PUBLIC_URL || location.href.split('#')[0];
  return base + '#open/' + type + '/' + encodeURIComponent(id);
}

function handleDeepLink(hash) {
  var m = /^#?open\/([a-z]+)\/(.+)$/.exec(hash || '');
  if (!m) return false;
  var type = m[1], id = decodeURIComponent(m[2]);

  switch (type) {
    case 'product':
      go('products', function () { openProductDrawer(+id); });
      return true;
    case 'customer':
      go('customers', function () { openCustomerDrawer(+id); });
      return true;
    case 'invoice':
      var s = DB.sale(id);
      go('reports', function () { if (s) openInvoice(s); else toast(t('invoice'), id, 'err'); });
      return true;
    case 'job':
      go('print', function () { openJobDrawer(id); });
      return true;
    /* A partner invoice only exists inside the Yalla Wear portal, so the link
       has to switch portals before it can open anything. Scanning a printed
       bill therefore lands the reader in the right app, not just the right
       screen. */
    case 'ywinvoice':
      if (!DB.invoice(id)) { toast(t('yi_invoice'), id, 'err'); return true; }
      if (!OG.print.partner) {
        OG.print.partner = true;
        YALLA.reset();
        renderSidebar(); renderTopbar();
      }
      YALLA.go('invoices', id);
      return true;
    case 'report':
      if (['sales', 'profit', 'inventory', 'employees', 'suppliers'].indexOf(id) > -1) OG.rep.tab = id;
      go('reports');
      return true;
    default:
      return false;
  }
}

/* Same pair of buttons on every screen that has something worth exporting. */
function exportButtons() {
  return '<button class="btn btn-ghost" data-act="export" data-kind="excel">' + t('export_excel') + '</button>' +
         '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('export_pdf') + '</button>';
}

/* The whole shop on one sheet — the page he hands a partner or a bank. */
function dashboardExportSpec() {
  var m = DB.monthlySales(6);
  var today = sumSalesOn(0);
  var mtd = monthToDate(0);
  var crit = DB.criticalVariants().length;
  var active = DB.customers.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) < 90; }).length;
  var pend = DB.printJobs.filter(function (j) { return j.stage !== 'done'; }).length;
  var byType = DB.salesByType();

  var rows = m.map(function (x) {
    return [t('sales_6m'), x.label + ' ' + x.date.getFullYear(), x.count, exMoney(x.total)];
  });
  byType.forEach(function (x) { rows.push([t('sales_by_type'), x.label, null, exMoney(x.total)]); });
  buildAlerts().forEach(function (a) {
    rows.push([t('needs_attention'), String(a.text).replace(/<[^>]+>/g, ''), null, null]);
  });

  return {
    name: 'dashboard', sheet: 'Dashboard', title: t('dash_title'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY), chartId: 'dashLine',
    docUrl: deepLink('report', 'sales'),
    columns: [{ label: t('status'), width: 22 }, { label: t('name'), width: 44 },
              { label: t('invoices'), num: true }, { label: exCol(t('total')), num: true }],
    rows: rows,
    kpis: [{ label: t('st_today'), value: money(today) },
           { label: t('st_month'), value: money(mtd) },
           { label: t('st_critical'), value: nf(crit) },
           { label: t('st_customers'), value: nf(active) },
           { label: t('st_print'), value: nf(pend) }]
  };
}

/* Today's till — effectively a shift report until the Money phase lands. */
function posExportSpec() {
  var from = daysAgo(0), to = daysAgo(-1);
  var today = DB.sales.filter(function (s) { return s.date >= from && s.date < to; });
  var byPay = {};
  today.forEach(function (s) { byPay[s.payment] = (byPay[s.payment] || 0) + s.total; });

  var rows = today.map(function (s) {
    return [s.id, fmtDateTime(s.date), s.customerName, DB.payLabel(s.payment),
            s.items.reduce(function (a, i) { return a + i.qty; }, 0), exMoney(s.total)];
  });
  Object.keys(byPay).forEach(function (k) {
    rows.push(['— ' + t('payment'), DB.payLabel(k), '', '', null, exMoney(byPay[k])]);
  });

  var total = today.reduce(function (a, s) { return a + s.total; }, 0);
  return {
    name: 'till-today', sheet: 'Till', title: t('pos_title'),
    subtitle: t('st_today') + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('invoice') }, { label: t('date'), width: 22 }, { label: t('customer'), width: 22 },
              { label: t('payment') }, { label: t('items'), num: true },
              { label: exCol(t('total')), num: true }],
    rows: rows,
    totals: [t('total'), null, null, null,
             today.reduce(function (a, s) { return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0),
             exMoney(total)],
    kpis: [{ label: t('st_today'), value: money(total) },
           { label: t('invoices'), value: nf(today.length) },
           { label: t('avg_basket'), value: money(today.length ? total / today.length : 0) }]
  };
}

/* Who is allowed to do what — printable, for pinning on the wall. */
/* OG's side of the partner ledger: what it owes Yalla Wear, per invoice. */
function partnerInvoicesExportSpec() {
  var live = DB.partnerInvoices.filter(function (i) { return DB.invoiceStatus(i) !== 'draft'; });
  var total = 0, paid = 0;
  var rows = live.slice().sort(function (a, b) { return (b.issued || 0) - (a.issued || 0); })
    .map(function (inv) {
      total += DB.invoiceTotal(inv);
      paid += DB.invoicePaid(inv);
      return [inv.id, fmtDate(inv.issued), fmtDate(inv.due), DB.invoicePieces(inv),
              exMoney(DB.invoiceTotal(inv)), exMoney(DB.invoicePaid(inv)),
              exMoney(DB.invoiceBalance(inv)),
              t('yi_st_' + DB.invoiceStatus(inv)) + (DB.invoiceOverdue(inv) ? ' · ' + t('overdue') : '')];
    });

  return {
    name: 'partner-invoices', sheet: 'Partner invoices',
    title: t('og_partner_inv'),
    subtitle: CONFIG.PRINT_PARTNER + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('yi_invoice') }, { label: t('yi_issued') }, { label: t('yi_due') },
              { label: t('pieces'), num: true }, { label: exCol(t('total')), num: true },
              { label: exCol(t('yi_paid')), num: true }, { label: exCol(t('yi_balance')), num: true },
              { label: t('status') }],
    rows: rows,
    totals: [t('total'), null, null,
             live.reduce(function (a, i) { return a + DB.invoicePieces(i); }, 0),
             exMoney(total), exMoney(paid), exMoney(DB.outstandingTotal()), null],
    kpis: [{ label: t('og_owed_to'), value: money(DB.outstandingTotal()) },
           { label: t('yi_paid'), value: money(paid) },
           { label: t('invoices'), value: String(live.length) }]
  };
}

function settingsExportSpec() {
  var roles = [t('role_admin'), t('role_manager'), t('role_cashier'), t('role_warehouse')];
  var rows = PERMISSIONS.map(function (p) {
    return [p[0], p[1] ? '✓' : '—', p[2] ? '✓' : '—', p[3] ? '✓' : '—', p[4] ? '✓' : '—'];
  });
  rows.push(['', '', '', '', '']);
  rows.push([t('exchange_rate'), '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP', '', '', '']);
  rows.push([t('points_per'), String(CONFIG.LOYALTY_POINTS_PER_1000), '', '', '']);
  rows.push([t('point_value'), nf(CONFIG.LOYALTY_POINT_VALUE) + ' SYP', '', '', '']);
  rows.push([t('tier'), t('silver') + ' ' + nf(CONFIG.TIER_SILVER) + ' · ' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD), '', '', '']);

  return {
    name: 'settings', sheet: 'Roles', title: t('roles_perms'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('permission'), width: 34 }, { label: roles[0] }, { label: roles[1] },
              { label: roles[2] }, { label: roles[3] }],
    rows: rows,
    kpis: [{ label: t('roles_perms'), value: PERMISSIONS.length + ' × 4' },
           { label: t('exchange_rate'), value: nf(CONFIG.EXCHANGE_RATE) }]
  };
}

/* ------------------------------------------------- RECORD DOCUMENTS
   One record, one sheet. Each carries a QR back to itself in the system. */

function customerStatementSpec(cid) {
  var c = DB.customer(cid);
  if (!c) return null;
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
                  .sort(function (a, b) { return a.date - b.date; });
  return {
    name: 'statement-' + c.id, sheet: 'Statement',
    title: t('rec_statement'),
    subtitle: c.name + ' · ' + c.phone + ' · ' + c.city,
    docUrl: deepLink('customer', c.id),
    columns: [{ label: t('invoice') }, { label: t('date') }, { label: t('items'), num: true },
              { label: t('payment') }, { label: exCol(t('total')), num: true },
              { label: t('points'), num: true }],
    rows: invoices.map(function (s) {
      return [s.id, fmtDate(s.date), s.items.reduce(function (a, i) { return a + i.qty; }, 0),
              DB.payLabel(s.payment), exMoney(s.total),
              Math.round(s.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000)];
    }),
    totals: [t('total'), null, null, null, exMoney(c.totalSpent), c.loyaltyPoints],
    kpis: [{ label: t('total_spent'), value: money(c.totalSpent) },
           { label: t('loyalty'), value: nf(c.loyaltyPoints) + ' ' + t('points') },
           { label: t('tier'), value: t(DB.tier(c.loyaltyPoints)) },
           { label: t('last_purchase'), value: relDate(c.lastPurchaseDate) }]
  };
}

function productSheetSpec(pid) {
  var p = DB.product(pid);
  if (!p) return null;
  var vs = DB.variantsOf(pid), total = DB.totalQty(pid), gaps = DB.sizeGaps(pid);
  return {
    name: 'stock-' + p.id, sheet: 'Stock sheet',
    title: t('rec_stock_sheet'),
    subtitle: p.name + ' · ' + p.brand + ' · ' + DB.typeLabels[p.type] +
              (gaps.length ? ' · ' + t('size_gap') + ': ' + gaps.join(', ') : ''),
    docUrl: deepLink('product', p.id),
    columns: [{ label: t('size') }, { label: t('sku') }, { label: t('barcode') },
              { label: t('qty'), num: true }, { label: t('shelf') }, { label: t('health') }],
    rows: vs.map(function (v) {
      return [v.size, v.sku, v.barcode, v.qty, v.shelf, t(DB.health(v.qty))];
    }),
    totals: [t('total'), null, null, total, null, t(DB.health(total))],
    kpis: [{ label: t('total_stock'), value: nf(total) + ' ' + t('pieces') },
           { label: t('stock_value'), value: money(total * p.costPrice) },
           { label: t('price'), value: money(p.sellingPrice) },
           { label: t('margin'), value: pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) }]
  };
}

function jobSheetSpec(jid) {
  var j = DB.printJobs.filter(function (x) { return x.id === jid; })[0];
  if (!j) return null;
  return {
    name: 'job-' + j.id, sheet: 'Work order',
    title: t('yl_work_order') + ' · ' + j.id,
    subtitle: j.customer + ' · ' + t('deadline') + ' ' + fmtDate(j.deadline) + ' · ' + t(j.priority),
    docUrl: deepLink('job', j.id),
    columns: [{ label: t('size') }, { label: t('qty'), num: true }],
    rows: Object.keys(j.sizes || {}).map(function (k) { return [k, j.sizes[k]]; }),
    totals: [t('total'), j.qty],
    kpis: [{ label: t('qty'), value: nf(j.qty) + ' ' + t('pieces') },
           { label: t('status'), value: t('print_' + j.stage) },
           { label: exCol(t('yl_charged')), value: money(j.price) },
           { label: t('design_note'), value: j.design }]
  };
}

function currentExportSpec() {
  if (OG.print.partner) return YALLA.exportSpec();
  switch (OG.view) {
    /* The dashboard export is the whole shop on one sheet — six months of
       revenue, best sellers, the lot. On a role home it would be a back door
       to figures that screen deliberately does not show, so it is tied to the
       same permission as the Reports screen it summarises. */
    case 'dashboard':  return allow('report.read') ? dashboardExportSpec() : null;
    case 'money':      return Money.exportSpec();
    case 'pos':        return posExportSpec();
    case 'settings':   return settingsExportSpec();
    case 'reports':    return reportExportSpec();
    case 'products':   return productsExportSpec();
    case 'customers':  return customersExportSpec();
    /* The count sheet is its own document — the one he signs off. Two `case
       'warehouse'` labels would be legal JavaScript and the first would
       silently win, so this stays a single branch. */
    case 'warehouse':  return (OG.wh.tab === 'count' && Stock.active())
                              ? Stock.exportSpec() : warehouseExportSpec();
    /* The Print screen has two tabs now, and each has to export itself — the
       same tab-blindness that once made every Warehouse tab export the same
       movement log. */
    case 'print':      return (OG.pr && OG.pr.tab === 'invoices')
                              ? partnerInvoicesExportSpec() : printJobsExportSpec();
    case 'storefront': return ordersExportSpec();
    default:           return salesExportSpec();
  }
}

/* -------------------------------------------------------------- 5. SHELL */

/* ------------------------------------------------------------- 5a. WHO, WHAT

   Three ways this app runs, and every permission question has to answer for
   all of them:

     signed in   — a real account with a real role. Ask the server's answer,
                   which Auth cached at sign-in.
     demo mode   — file://, GitHub Pages, serve.ps1. Nobody is signed in and
                   nothing is saved. The demo exists to SHOW the whole system,
                   so everything is permitted and no screen is trimmed.
     no Auth     — _shot.html, which loads neither api.js nor auth.js and
                   drives the Arabic proposal screenshots. Same answer as demo.

   Getting this backwards is how the proposal PDF ends up full of empty
   screens, so both fallbacks say yes rather than no. That is safe precisely
   because neither case has any real data behind it. */

function roleOf() {
  if (typeof Auth === 'undefined' || Auth.demoMode()) return null;
  var u = Auth.user();
  return u ? u.role : null;
}

function allow(perm) {
  if (typeof Auth === 'undefined' || Auth.demoMode()) return true;
  return Auth.can(perm);
}

/* What things cost us, and what we make on them. Two separate permissions
   because they are two separate secrets: a manager may reasonably want a
   senior person to see margin without seeing supplier prices.

   These exist as named functions rather than `allow('cost.read')` sprinkled
   through the file because the failure mode is missing ONE call site, and a
   named thing is greppable. */
function seesCost()   { return allow('cost.read'); }
function seesProfit() { return allow('profit.read'); }

/* Yalla Wear does not get the shop. They get their portal and nothing else —
   no sidebar, no search, no dashboard, no way to type their way out. Checked
   against the role rather than a permission, because this is not a thing a
   manager should be able to switch on by ticking a box. */
function isPartnerAccount() { return roleOf() === 'partner'; }

var NAV = [
  { id: 'dashboard',  key: 'nav_dashboard', group: 'main', icon: 'M3 12h4l2 6 4-13 2 7h6' },
  { id: 'pos',        key: 'nav_pos',       group: 'main', icon: 'M3 4h3l2 10h9l2-7H7M9 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0' },
  { id: 'products',   key: 'nav_products',  group: 'main', icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
  { id: 'warehouse',  key: 'nav_warehouse', group: 'main', icon: 'M3 20V9l9-5 9 5v11M7 20v-7h10v7' },
  { id: 'money',      key: 'nav_money',     group: 'main', icon: 'M3 8h18v11H3zM3 8l2-4h14l2 4M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4' },
  { id: 'deliveries', key: 'nav_deliveries',group: 'ops',  icon: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3' },
  { id: 'customers',  key: 'nav_customers', group: 'ops',  icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
  { id: 'print',      key: 'nav_print',     group: 'ops',  icon: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z' },
  { id: 'reports',    key: 'nav_reports',   group: 'ops',  icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'storefront', key: 'nav_storefront',group: 'ops',  icon: 'M4 8h16l-1 12H5zM9 8V6a3 3 0 0 1 6 0v2' },
  { id: 'settings',   key: 'nav_settings',  group: 'ops',  icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z' }
];

/* Which permission each screen needs.

   A screen missing from this map is open to anyone signed in — `dashboard` is
   the only one, deliberately, so no role can ever end up with an empty shell
   and nowhere to land.

   This hides menu items; it is not the security boundary. The server refuses
   the data regardless. What this fixes is a cashier staring at a Money screen
   that loads empty and looks broken, when the real answer is "not your job". */
var NAV_PERM = {
  pos:        'sell',
  products:   'product.read',
  warehouse:  'stock.read',
  money:      'money.read',
  deliveries: 'delivery.read',
  customers:  'customer.read',
  print:      'print.read',
  reports:    'report.read',
  storefront: 'product.read',
  settings:   'config.write'
};

/* In demo mode every screen shows — the demo is meant to display the whole
   system — and with no Auth at all (_shot.html) nothing is filtered either. */
function navAllowed(id) {
  /* The partner has no shop nav at all, including the dashboard that is
     otherwise open to everyone. Their whole app is the portal. */
  if (isPartnerAccount()) return false;

  /* A driver's home screen already IS his runs, so a second menu entry to the
     same list is just a way of making him wonder which one is the real one. */
  if (id === 'deliveries' && roleOf() === 'delivery') return false;

  var need = NAV_PERM[id];
  return !need || allow(need);
}

function allowedNav() {
  return NAV.filter(function (n) { return navAllowed(n.id); });
}

/* Wrap any in-page shortcut to another screen — a "View all" on a dashboard
   card, a "+ Add" that jumps to the warehouse. Hiding the sidebar entry is not
   enough on its own: these buttons live inside screens the role CAN see, and
   go() would quietly bounce them somewhere else. A button that visibly does
   the wrong thing is worse than one that is not there. */
function ifNav(view, html) {
  return navAllowed(view) ? html : '';
}

/* The sidebar order IS the depth axis: moving down the list reads as going
   deeper, so that is what the page transition animates against. */
if (typeof Motion !== 'undefined') {
  Motion.setOrder(NAV.map(function (n) { return n.id; }));
}

function navBadge(id) {
  if (id === 'print') { var n = DB.printJobs.filter(function (j) { return DB.isOverdue(j); }).length; return n ? n : 0; }
  if (id === 'products') { return DB.criticalVariants().length; }
  if (id === 'storefront') { return DB.storeOrders.filter(function (o) { return o.status === 'pending'; }).length; }
  return 0;
}

function renderSidebar() {
  /* Partner mode takes over the whole shell — its own nav, its own brand. */
  if (OG.print.partner) { document.getElementById('sidebar').innerHTML = YALLA.sidebar(); return; }

  /* The logo is white-on-black, so on the black sidebar the wordmark sits bare. */
  var html =
    '<div class="brand">' +
      '<div class="brand-mark brand-mark-inverse"><img src="assets/logo.svg" alt="OG"></div>' +
      /* Reads CONFIG rather than a hardcoded string — otherwise renaming the
         shop in Settings changes the invoices and the labels but leaves the
         sidebar still saying OG SYSTEM. */
      '<div class="brand-text"><b>' + esc(CONFIG.SHOP_NAME.toUpperCase()) + '</b>' +
        '<span>' + t('tagline') + '</span></div>' +
    '</div><nav class="nav">';

  ['main', 'ops'].forEach(function (g) {
    var items = NAV.filter(function (n) { return n.group === g && navAllowed(n.id); });
    /* A role with nothing in a group must not get a bare heading floating
       above no buttons — delivery has an empty "Operations" otherwise. */
    if (!items.length) return;
    html += '<div class="nav-label">' + t(g === 'main' ? 'nav_main' : 'nav_ops') + '</div>';
    items.forEach(function (n) {
      var b = navBadge(n.id);
      html +=
        '<button class="nav-item' + (OG.view === n.id ? ' active' : '') + '" data-act="nav" data-view="' + n.id + '">' +
          '<span class="nav-icon"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter"><path d="' + n.icon + '"/></svg></span>' +
          '<span class="nav-txt">' + t(n.key) + '</span>' +
          (b ? '<span class="nav-badge">' + b + '</span>' : '') +
        '</button>';
    });
  });

  html += '</nav><div class="sidebar-foot">' + t('live') + ' · <b>v1.0</b></div>';
  document.getElementById('sidebar').innerHTML = html;
  /* The sliding indicator is positioned from the active item's own offset, so
     it has to be placed after the nav exists in the DOM. */
  if (typeof Motion !== 'undefined') {
    try { Motion.navIndicator(); Motion.dock(); } catch (e) {}
  }
  renderTabbar();
}

/* ------------------------------------------------------------ BOTTOM TABS
   The phone navigation. Rendered into a permanent #tabbar element and hidden
   by CSS above 720px, so there is no JS breakpoint to keep in sync and a
   resize needs no re-render.

   Five is the ceiling — a sixth tab makes each one too narrow for a thumb, so
   the rest live behind More. */
var TABS = ['dashboard', 'pos', 'products', 'print'];
var MORE_ITEMS = ['warehouse', 'deliveries', 'customers', 'reports', 'storefront', 'settings'];

function renderTabbar() {
  var host = document.getElementById('tabbar');
  if (!host) return;

  /* The partner portal brings its own four screens; it has no More. */
  if (OG.print.partner) {
    host.innerHTML = YALLA.tabs ? YALLA.tabs() : '';
    return;
  }

  var h = '';
  TABS.forEach(function (id) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || !navAllowed(id)) return;
    var b = navBadge(id);
    h += '<button class="tabbtn' + (OG.view === id ? ' on' : '') + '" data-act="nav" data-view="' + id + '">' +
      '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg>' +
        (b ? '<i class="tb-dot"></i>' : '') + '</span>' +
      '<span class="tb-txt">' + t(n.key) + '</span></button>';
  });

  /* More always shows: even a role with no extra screens reaches sign out
     through it, and on a phone there is nowhere else to put that. */
  var inMore = MORE_ITEMS.indexOf(OG.view) > -1;
  h += '<button class="tabbtn' + (inMore ? ' on' : '') + '" data-act="more-sheet">' +
    '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
      '<path d="M4 7h16M4 12h16M4 17h16"/></svg></span>' +
    '<span class="tb-txt">' + t('nav_more') + '</span></button>';

  host.innerHTML = h;
}

/* Everything that did not fit in five tabs, plus the two shell switches that
   were dropped from the collapsed topbar. */
function openMoreSheet() {
  var h = '<div class="more-grid">';
  MORE_ITEMS.forEach(function (id) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || !navAllowed(id)) return;
    var b = navBadge(id);
    h += '<button class="more-item' + (OG.view === id ? ' on' : '') + '" data-act="more-go" data-view="' + id + '">' +
      '<span class="mi-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg></span>' +
      '<span>' + t(n.key) + '</span>' +
      (b ? '<span class="nav-badge">' + b + '</span>' : '') + '</button>';
  });
  h += '</div>';

  h += '<div class="more-rows">' +
    '<div class="more-row"><span>' + t('language') + '</span><div class="seg">' +
      '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div></div>' +
    '<div class="more-row"><span>' + t('currency') + '</span><div class="seg">' +
      '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
      '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
    '</div></div>' +
    /* Previewing the partner's portal is a manager's tool for checking what
       the other company can see. Anyone without partner.read has no business
       in there, and Yalla Wear are already in it. */
    (allow('partner.read')
      ? '<div class="more-row"><span>' + t('partner_view') + '</span>' +
        '<button class="btn btn-sm btn-dark" data-act="partner-view">' + CONFIG.PRINT_PARTNER + ' →</button></div>'
      : '') +
  '</div>';

  /* The account block lives here too, and this is not a duplicate for
     convenience. `.user-chip` is display:none below 900px, so on the phones
     used on the shop floor this sheet is the ONLY way to reach sign out. */
  var u = acct();
  if (u) {
    h += '<div class="more-acct">' +
      '<div class="ma-who">' +
        '<span class="user-avatar">' + esc(initialsOf(u.name)) + '</span>' +
        '<div><b>' + esc(u.name) + '</b>' +
          '<span class="acct-role">' + esc(roleLabel(u.role)) + '</span></div>' +
      '</div>' +
      '<div class="ma-btns">' +
        '<button class="btn btn-sm" data-act="acct-pw">' + t('change_pw') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-act="acct-out">' + t('sign_out') + '</button>' +
      '</div>' +
    '</div>';
  }

  openModal({ title: t('nav_more'), size: 'narrow', body: h, sheet: true });
}

function renderTopbar() {
  if (OG.print.partner) { document.getElementById('topbar').innerHTML = YALLA.topbar(); return; }

  document.getElementById('topbar').innerHTML =
    '<div class="search">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="globalSearch" type="text" placeholder="' + t('search_ph') + '" autocomplete="off">' +
      '<div id="searchResults"></div>' +
    '</div>' +
    '<div class="spacer"></div>' +
    '<div class="seg">' +
      '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div>' +
    '<div class="seg">' +
      '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
      '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
    '</div>' +
    /* Scan is the most-reached-for control on a phone in a shop, so it gets a
       permanent place in the top bar rather than living inside one screen. */
    '<button class="icon-btn scan-btn" data-act="scan-open" title="' + esc(t('sc_title')) + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M3 12h18"/></svg></button>' +
    /* Partner messages sit beside the alert bell, not inside it. One is the
       shop talking to itself; the other is another company talking to us. */
    (typeof Notify !== 'undefined' ? Notify.bell() : '') +
    '<button class="icon-btn" data-act="bell" title="' + t('notifications') + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="M18 16V10a6 6 0 1 0-12 0v6l-2 3h16zM10 21h4"/></svg>' +
      '<span class="bell-badge">' + DB.notifications.length + '</span>' +
    '</button>' +
    accountChip();
}

/* ------------------------------------------------------------- 5b. ACCOUNT */

/* Who is signed in. Three shapes, because there are three ways to be here:

     no Auth at all  — _shot.html, which loads neither api.js nor auth.js.
                       Falls back to the old static chip so the Arabic
                       proposal screenshots keep looking like a real app.
     demo mode       — file:// or a static host. Nobody to sign out.
     signed in       — the real thing.  */
function acct() {
  return (typeof Auth !== 'undefined' && !Auth.demoMode()) ? Auth.user() : null;
}

function initialsOf(name) {
  var w = String(name || '').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
}

function roleLabel(role) {
  var k = { manager: 'role_manager', cashier: 'role_cashier', warehouse: 'role_warehouse',
            delivery: 'role_delivery', partner: 'role_partner' }[role];
  return k ? t(k) : role;
}

function accountChip() {
  if (typeof Auth === 'undefined') {
    return '<div class="user-chip"><span class="user-avatar">A</span>' +
           '<span>' + t('admin') + '</span></div>';
  }

  if (Auth.demoMode()) {
    return '<div class="user-chip is-demo" title="' + esc(t('demo_no_account')) + '">' +
      '<span class="user-avatar demo">D</span><span>' + t('demo_account') + '</span></div>';
  }

  var u = Auth.user();
  if (!u) return '';

  return '<button class="user-chip is-btn' + (u.mustChange ? ' needs-pw' : '') + '" ' +
      'data-act="acct" aria-haspopup="menu" title="' + esc(t('my_account')) + '">' +
    '<span class="user-avatar">' + esc(initialsOf(u.name)) + '</span>' +
    '<span class="uc-name">' + esc(u.name) + '</span>' +
    '<svg class="uc-caret" viewBox="0 0 24 24" stroke-linecap="square"><path d="M6 9l6 6 6-6"/></svg>' +
  '</button>';
}

/* The popover. Same pattern as the notifications bell: appended to the topbar,
   closed by the global click handler. */
function accountPopHtml(u) {
  return '<div class="acct-head">' +
      '<span class="user-avatar lg">' + esc(initialsOf(u.name)) + '</span>' +
      '<div><b>' + esc(u.name) + '</b>' +
        '<span class="acct-role">' + esc(roleLabel(u.role)) + '</span></div>' +
    '</div>' +
    (u.mustChange
      ? '<div class="acct-warn">' + t('pw_must_change') + '</div>' : '') +
    '<div class="acct-sep"></div>' +
    '<button class="acct-item" data-act="acct-pw">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' +
      t('change_pw') + '</button>' +
    '<button class="acct-item danger" data-act="acct-out">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7"/></svg>' +
      t('sign_out') + '</button>';
}

/* The change-password dialog.

   The server drops every session on success — including this one — so the
   message says "sign in again" rather than letting it look like a fault. */
function openChangePassword() {
  openModal({
    title: t('change_pw'),
    size: 'narrow',
    body:
      '<div class="pw-form">' +
        '<label class="field"><span>' + t('pw_current') + '</span>' +
          '<input class="inp" id="pwCur" type="password" autocomplete="current-password"></label>' +
        '<label class="field"><span>' + t('pw_new') + '</span>' +
          '<input class="inp" id="pwNew" type="password" autocomplete="new-password"></label>' +
        '<label class="field"><span>' + t('pw_again') + '</span>' +
          '<input class="inp" id="pwNew2" type="password" autocomplete="new-password"></label>' +
        '<div class="pw-err" id="pwErr"></div>' +
      '</div>',
    foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="acct-pw-save">' + t('change_pw') + '</button>',
    onOpen: function (root) {
      var f = root.querySelector('#pwCur');
      if (f) setTimeout(function () { f.focus(); }, 60);
    }
  });
}

/* --------------------------------------------------------- 6. GLOBAL SEARCH */

function runSearch(q) {
  var box = document.getElementById('searchResults');
  if (!box) return;
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; return; }

  /* One search box that reaches three tables, so it needs all three
     permissions asked separately. This is the easiest place in the app to
     leak a customer's phone number to someone who cannot open the Customers
     screen — the box is on every page and it does not look like a screen. */
  var prods = !allow('product.read') ? [] : DB.products.filter(function (p) {
    return p.name.toLowerCase().indexOf(q) > -1 || p.brand.toLowerCase().indexOf(q) > -1;
  }).slice(0, 5);

  var custs = !allow('customer.read') ? [] : DB.customers.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
  }).slice(0, 4);

  /* `sell` and not `report.read`: a cashier has to be able to pull up the
     invoice she wrote ten minutes ago to take a refund against it. Gating
     this on Reports would break the refund she is allowed to give. */
  var invs = !(allow('sell') || allow('report.read')) ? [] : DB.sales.filter(function (s) {
    return s.id.toLowerCase().indexOf(q) > -1;
  }).slice(0, 3);

  var h = '';
  if (prods.length) {
    h += '<div class="sr-group">' + t('nav_products') + '</div>';
    prods.forEach(function (p) {
      h += '<div class="sr-item" data-act="search-prod" data-id="' + p.id + '">' + thumb(p) +
           '<span>' + esc(p.name) + '</span><small class="num">' + DB.totalQty(p.id) + ' pcs</small></div>';
    });
  }
  if (custs.length) {
    h += '<div class="sr-group">' + t('nav_customers') + '</div>';
    custs.forEach(function (c) {
      h += '<div class="sr-item" data-act="search-cust" data-id="' + c.id + '">' +
           '<span class="cc-av" style="width:24px;height:24px;font-size:10px">' + c.name[0] + '</span>' +
           '<span>' + esc(c.name) + '</span><small class="num">' + tel(c.phone) + '</small></div>';
    });
  }
  if (invs.length) {
    h += '<div class="sr-group">' + t('invoices') + '</div>';
    invs.forEach(function (s) {
      h += '<div class="sr-item" data-act="search-inv" data-id="' + s.id + '">' +
           '<span>' + s.id + '</span><small class="num">' + money(s.total) + '</small></div>';
    });
  }
  if (!h) h = '<div class="sr-item muted">' + t('no_results') + '</div>';
  box.innerHTML = '<div class="search-results">' + h + '</div>';
}

/* ------------------------------------------------------------- 7. DASHBOARD */

function sumSalesRange(from, to) {
  return DB.sales.reduce(function (s, x) { return (x.date >= from && x.date < to) ? s + x.total : s; }, 0);
}

function sumSalesOn(dayOffset) { return sumSalesRange(daysAgo(dayOffset), daysAgo(dayOffset - 1)); }

/* Month-to-date. Comparing a half-finished August against a whole July would
   read as a collapse, so both sides use the same 1st-to-today window. */
function monthToDate(monthsBack) {
  var start = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsBack, 1);
  var end = new Date(start.getFullYear(), start.getMonth(), 1);
  end.setDate(end.getDate() + TODAY.getDate());
  return sumSalesRange(start, end);
}

function buildAlerts() {
  var out = [];

  /* Size gaps — the three products with holes in the popular middle sizes. */
  var gapped = [];
  DB.products.forEach(function (p) {
    DB.sizeGaps(p.id).forEach(function (sz) { gapped.push({ p: p, size: sz }); });
  });
  gapped.slice(0, 3).forEach(function (g) {
    out.push({
      tone: 'red', icon: '!',
      text: esc(g.p.name) + ' — ' + t('size') + ' ' + g.size + ' ' + t('out_of_stock').toLowerCase(),
      sub: t('total_stock') + ': ' + DB.totalQty(g.p.id) + ' ' + t('units').toLowerCase(),
      view: 'products', pid: g.p.id
    });
  });

  DB.printJobs.filter(function (j) { return DB.isOverdue(j); }).slice(0, 2).forEach(function (j) {
    var n = DB.daysSince(j.deadline);
    out.push({
      tone: 'red', icon: 'P',
      text: t('print_job') + ' #' + j.id + ' ' + t('for_word') + ' ' + esc(j.customer.split(' ')[0]) +
            ' — ' + n + ' ' + t(n === 1 ? 'day_overdue' : 'days_overdue'),
      sub: j.qty + ' pcs · ' + t(j.priority) + ' · ' + t('deadline') + ' ' + fmtDate(j.deadline),
      view: 'print'
    });
  });

  DB.suppliers.filter(function (s) { return s.outstanding > 0 && DB.daysSince(s.dueDate) >= -7; })
    .sort(function (a, b) { return a.dueDate - b.dueDate; }).slice(0, 2).forEach(function (s) {
      var n = DB.daysSince(s.dueDate);
      var when = n > 0
        ? (t('payment_overdue') + ' ' + n + ' ' + t(n === 1 ? 'day_word' : 'days'))
        : (t('payment_due') + ' ' + relDate(s.dueDate));
      out.push({
        tone: n > 0 ? 'red' : 'amber', icon: '$',
        text: t('supplier') + ' ' + esc(s.name) + ' — ' + when,
        sub: money(s.outstanding) + ' · ' + fmtDate(s.dueDate),
        view: 'reports', tab: 'suppliers'
      });
    });

  var inactive = DB.inactiveCustomers(90).length;
  out.push({
    tone: 'amber', icon: 'C',
    text: inactive + ' ' + (OG.lang === 'ar' ? 'زبون لم يشترِ منذ ٩٠ يوماً' : "customers haven't purchased in 90 days"),
    sub: OG.lang === 'ar' ? 'أرسل لهم رسالة واتساب بضغطة' : 'One tap sends them a WhatsApp message',
    view: 'customers', filter: 'risk'
  });

  var dead = DB.products.slice().sort(function (a, b) { return b.lastSoldDaysAgo - a.lastSoldDaysAgo; })[0];
  var deadQty = DB.totalQty(dead.id);
  var deadShelf = (DB.variantsOf(dead.id)[0] || {}).shelf || '—';
  out.push({
    tone: 'grey', icon: 'Z',
    text: esc(dead.name) + ' — ' + (OG.lang === 'ar'
      ? ('لم يُبَع منذ ' + dead.lastSoldDaysAgo + ' يوماً')
      : ("hasn't sold in " + dead.lastSoldDaysAgo + ' days')) +
      ' — ' + deadQty + ' pcs · ' + deadShelf,
    sub: t('stock_value') + ': ' + money(deadQty * dead.costPrice),
    view: 'products', pid: dead.id
  });

  return out;
}

function viewDashboard() {
  var today = sumSalesOn(0), yest = sumSalesOn(1);
  var m = DB.monthlySales(6);
  var thisMonth = monthToDate(0), lastMonth = monthToDate(1);
  var mtdLabel = '1–' + TODAY.getDate() + ' ' + (OG.lang === 'ar' ? MONTHS_AR : MONTHS_EN)[TODAY.getMonth()];
  var crit = DB.criticalVariants().length;
  var active = DB.customers.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) < 90; }).length;
  var pendingPrint = DB.printJobs.filter(function (j) { return j.stage !== 'done'; }).length;

  var stats = [
    { k: 'st_today',   v: moneyStat(today),     d: deltaTag(today, yest, t('vs_yesterday')), accent: true },
    { k: 'st_month',   v: moneyStat(thisMonth), d: deltaTag(thisMonth, lastMonth, t('vs_last_month')), f: mtdLabel },
    { k: 'st_products',v: nf(DB.products.length), d: deltaTag(DB.products.length, DB.products.length - 2, t('vs_last_month')), f: t('in_catalogue') },
    { k: 'st_critical',v: nf(crit),           d: deltaTag(crit, crit - 4, t('vs_last_period')), f: t('need_reorder') },
    { k: 'st_customers', v: nf(active),       d: deltaTag(active, active - 5, t('vs_last_month')), f: t('bought_90') },
    { k: 'st_print',   v: nf(pendingPrint),   d: deltaTag(pendingPrint, 11, t('vs_last_month')), f: t('in_queue') }
  ];

  var h =
    '<div class="page-head"><div><h1>' + t('dash_title') + '</h1>' +
    '<div class="sub">' + t('dash_sub') + ' · ' + fmtDate(TODAY) + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      '<button class="btn btn-ghost" data-act="day-summary">' + t('wa_send_day') + '</button>' +
      ifNav('pos', '<button class="btn btn-primary" data-act="nav" data-view="pos">' + t('nav_pos') + '</button>') +
    '</div></div>';

  h += '<div class="grid stat-row" id="dashStats">';
  stats.forEach(function (s) {
    h += '<div class="stat"><span class="eyebrow">' + t(s.k) + '</span>' +
         '<div class="val' + (s.accent ? ' accent' : '') + '">' + s.v + '</div>' + s.d +
         (s.f ? '<div class="foot">' + s.f + '</div>' : '') + '</div>';
  });
  h += '</div>';

  h += '<div class="dash-grid mt">' +
    '<div>' +
      '<div class="card"><div class="card-head"><h3>' + t('sales_6m') + '</h3>' +
        '<div class="card-actions"><span class="badge neutral">' + DB.sales.length + ' ' + t('invoices') + '</span></div></div>' +
        '<div class="card-body"><div class="chart-box"><canvas id="dashLine"></canvas></div></div></div>' +

      '<div class="grid mt" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
        '<div class="card"><div class="card-head"><h3>' + t('sales_by_type') + '</h3></div>' +
          '<div class="card-body"><div class="chart-box"><canvas id="dashDonut"></canvas></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>' + t('best_sellers') + '</h3></div>' +
          '<div class="card-body"><div class="chart-box"><canvas id="dashBars"></canvas></div></div></div>' +
      '</div>' +

      '<div class="card mt"><div class="card-head"><h3>' + t('recent_sales') + '</h3>' +
        '<div class="card-actions">' + ifNav('reports',
          '<button class="btn btn-ghost btn-sm" data-act="nav" data-view="reports">' + t('view_all') + '</button>') +
        '</div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th><th>' + t('items') + '</th>' +
          '<th>' + t('payment') + '</th><th>' + t('date') + '</th><th class="num">' + t('total') + '</th>' +
        '</tr></thead><tbody>';

  DB.sales.slice(0, 5).forEach(function (s) {
    h += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td>' +
      '<td>' + esc(s.customerName) + '</td>' +
      '<td class="muted">' + s.items.length + ' × ' + esc(s.items[0].name.slice(0, 22)) + (s.items.length > 1 ? '…' : '') + '</td>' +
      '<td><span class="badge neutral">' + DB.payLabel(s.payment) + '</span></td>' +
      '<td class="num muted">' + fmtDate(s.date) + '</td>' +
      '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
  });

  h += '</tbody></table></div></div></div>';

  /* Right column — live alerts */
  h += '<div class="card" id="alertPanel"><div class="card-head">' +
       '<h3>' + t('needs_attention') + '</h3>' +
       '<div class="card-actions"><span class="badge critical">' + buildAlerts().length + '</span></div></div>';
  buildAlerts().forEach(function (a, i) {
    h += '<div class="alert-row">' +
      '<span class="alert-ico ' + a.tone + '">' + a.icon + '</span>' +
      '<span class="alert-txt">' + a.text + (a.sub ? '<small>' + a.sub + '</small>' : '') + '</span>' +
      '<button class="btn btn-sm btn-ghost" data-act="alert-fix" data-i="' + i + '">' + t('fix') + '</button>' +
    '</div>';
  });
  h += '</div></div>';

  return h;
}

function afterDashboard() {
  var m = DB.monthlySales(6);
  Charts.line(document.getElementById('dashLine'),
    m.map(function (x) { return x.label; }),
    m.map(function (x) { return OG.currency === 'USD' ? x.total / CONFIG.EXCHANGE_RATE : x.total; }),
    { fmt: function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); } });

  var byType = DB.salesByType();
  Charts.donut(document.getElementById('dashDonut'),
    byType.map(function (x) { return x.label; }),
    byType.map(function (x) { return OG.currency === 'USD' ? x.total / CONFIG.EXCHANGE_RATE : x.total; }),
    { fmt: function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); } });

  var unitsByProduct = {};
  DB.sales.forEach(function (s) {
    s.items.forEach(function (it) { unitsByProduct[it.productId] = (unitsByProduct[it.productId] || 0) + it.qty; });
  });
  var top = Object.keys(unitsByProduct).map(function (k) {
    return { name: DB.product(+k).name, units: unitsByProduct[k] };
  }).sort(function (a, b) { return b.units - a.units; }).slice(0, 6);

  Charts.bars(document.getElementById('dashBars'),
    top.map(function (x) { return x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name; }),
    top.map(function (x) { return x.units; }),
    { horizontal: true, highlight: 0, fmt: function (v) { return nf(v); } });
}

/* ------------------------------------------------------- 7b. HOME, PER ROLE

   The dashboard above is a manager's dashboard: today's takings, six months of
   revenue, best sellers, margin. It was the landing screen for all five roles,
   which meant a cashier signed in to the shop's money and a driver signed in
   to a bar chart he cannot act on.

   Each of these is the first thing one person sees in the morning, and each is
   built around the first thing that person actually does. They are deliberately
   short: a home screen you have to read is a home screen you stop reading.

   All three use the markup the rest of the app already uses — `stat`, `card`,
   `alert-row`, `tbl` — so they inherit spacing, dark mode, RTL and the
   entrance animation without a single new rule. */

function greeting() {
  var hr = new Date().getHours();
  return hr < 12 ? t('hi_morning') : hr < 17 ? t('hi_afternoon') : t('hi_evening');
}

/* The same day boundary the dashboard's "Sales today" uses, via the same
   daysAgo() the seeded data is built around. Rolling our own midnight here
   would give two screens two different answers for the same word. */
function isToday(d) {
  var x = new Date(d);
  return x >= daysAgo(0) && x < daysAgo(-1);
}

/* First name only. "Good morning, Hussam" reads like a person talking;
   "Good morning, Hussam Fattal" reads like a bank letter. */
function firstName() {
  var u = (typeof Auth !== 'undefined') ? Auth.user() : null;
  return u && u.name ? String(u.name).trim().split(/\s+/)[0] : '';
}

function roleHomeHead(title, sub) {
  var who = firstName();
  return '<div class="page-head"><div><h1>' +
    (who ? greeting() + ', ' + esc(who) : title) + '</h1>' +
    '<div class="sub">' + sub + ' · ' + fmtDate(TODAY) + '</div></div></div>';
}

/* ---- cashier ---------------------------------------------------------------
   Her shift, not the shop. No revenue total, no month, no charts, no profit —
   the till, what she has done today, and what is running out where she can
   see it. */
function viewShiftHome() {
  var me = firstName();
  var mine = DB.sales.filter(function (s) {
    /* Matched on the first name so it still works when the account name and
       the staff record disagree on a middle name or a spelling. */
    return isToday(s.date) &&
           String(s.cashier || '').indexOf(me) === 0;
  });
  var taken = mine.reduce(function (a, s) { return a + s.total; }, 0);

  var h = roleHomeHead(t('nav_pos'), t('my_sales_today'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('my_sales_today') + '</span>' +
      '<div class="val accent">' + moneyStat(taken) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('my_invoices') + '</span>' +
      '<div class="val">' + nf(mine.length) + '</div>' +
      '<div class="foot">' + fmtDate(TODAY) + '</div></div>' +
  '</div>';

  h += ifNav('pos', '<div class="home-cta mt">' +
    '<button class="btn btn-primary btn-lg" data-act="nav" data-view="pos">' +
      t('open_till') + ' →</button></div>');

  /* -- what she has rung up -- */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('my_last_sales') + '</h3></div>';
  if (!mine.length) {
    h += '<div class="cart-empty"><b>' + t('nothing_sold_yet') + '</b>' + t('first_sale_hint') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
    mine.slice(0, 6).forEach(function (s) {
      h += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
        '<td><b>' + s.id + '</b></td>' +
        '<td>' + esc(s.customerName) + '</td>' +
        '<td class="muted">' + s.items.length + ' × ' + esc(s.items[0].name.slice(0, 20)) +
          (s.items.length > 1 ? '…' : '') + '</td>' +
        '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  /* -- what she will be asked for and cannot find --
     Only what is short ON THE FLOOR. A cashier does not care that the back is
     low; she cares that the customer in front of her wants a 42 and the wall
     is empty. */
  var gaps = DB.floorOuts().slice(0, 6);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('low_on_shelf') + '</h3>' +
    '<div class="card-actions"><span class="badge ' + (gaps.length ? 'critical' : 'healthy') + '">' +
      gaps.length + '</span></div></div>';
  if (!gaps.length) {
    h += '<div class="cart-empty"><b>' + t('shelf_all_good') + '</b></div>';
  } else {
    gaps.forEach(function (g) {
      var p = DB.product(g.productId);
      h += '<div class="alert-row">' +
        '<span class="alert-ico amber">!</span>' +
        '<span class="alert-txt"><b>' + esc(p ? p.name : g.sku) + '</b>' +
          '<small>' + t('size') + ' ' + esc(g.size) + ' · ' + t('low_on_shelf_sub') + '</small></span>' +
      '</div>';
    });
  }
  h += '</div>';

  return h;
}

/* ---- warehouse -------------------------------------------------------------
   The back room. Four counts, two buttons, and the list of things that need
   carrying to the front. Not one money figure: he has neither money.read nor
   cost.read, and a stock keeper does not need either to do his job well. */
function viewBackHome() {
  var arrived = DB.stockMovements.filter(function (m) {
    return m.delta > 0 && isToday(m.date);
  });
  var arrivedPieces = arrived.reduce(function (a, m) { return a + m.delta; }, 0);
  var toMove = DB.floorOuts();
  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; });
  var empties = DB.variants.filter(function (v) { return DB.stockAt(v, 'floor') === 0; }).length;

  var h = roleHomeHead(t('back_title'), t('back_sub'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('arrived_today') + '</span>' +
      '<div class="val accent">' + nf(arrivedPieces) + '</div>' +
      '<div class="foot">' + t('pieces') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('to_move_out') + '</span>' +
      '<div class="val' + (toMove.length ? ' warn' : '') + '">' + nf(toMove.length) + '</div>' +
      '<div class="foot">' + t('sku') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('empty_on_floor') + '</span>' +
      '<div class="val">' + nf(empties) + '</div>' +
      '<div class="foot">' + t('wh_empty_sizes') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('open_orders') + '</span>' +
      '<div class="val">' + nf(openPOs.length) + '</div>' +
      '<div class="foot">' + t('po_title').toLowerCase() + '</div></div>' +
  '</div>';

  h += '<div class="home-cta mt">' +
    (allow('product.write')
      ? '<button class="btn btn-primary btn-lg" data-act="home-wh" data-tab="add">' + t('back_receive') + '</button>'
      : '') +
    (allow('stock.count')
      ? '<button class="btn btn-lg" data-act="home-wh" data-tab="count">' + t('back_count') + '</button>'
      : '') +
  '</div>';

  /* -- the actual to-do list: sold out on the wall, still in the back -- */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('to_move_out') + '</h3>' +
    '<div class="card-actions"><span class="badge ' + (toMove.length ? 'critical' : 'healthy') + '">' +
      toMove.length + '</span></div></div>';

  if (!toMove.length) {
    h += '<div class="cart-empty"><b>' + t('back_nothing') + '</b>' + t('back_nothing_sub') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('wh_in_the_back') + '</th><th></th>' +
    '</tr></thead><tbody>';
    toMove.slice(0, 10).forEach(function (g) {
      var p = DB.product(g.productId);
      h += '<tr>' +
        '<td><div class="cell-prod">' + (p ? thumb(p) : '') + '<span><b>' +
          esc(p ? p.name : g.sku) + '</b></span></div></td>' +
        '<td><b>' + esc(g.size) + '</b></td>' +
        '<td class="num' + (g.back ? '' : ' muted') + '">' + nf(g.back) + '</td>' +
        '<td>' + (allow('stock.move') && p
          ? '<button class="btn btn-sm btn-primary" data-act="wh-transfer" data-id="' + p.id + '">' +
            t('wh_move') + '</button>'
          : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  return h;
}

/* ---- delivery --------------------------------------------------------------
   Rendered by js/deliveries.js, which owns the whole screen — it is the only
   role whose home is live server data rather than a view over what is already
   in memory, so it loads asynchronously and paints itself. */
function viewRunsHome() {
  return (typeof Deliveries !== 'undefined')
    ? Deliveries.view()
    : '<div class="card"><div class="cart-empty"><b>' + t('dl_none') + '</b></div></div>';
}

/* -------------------------------------------------------------- 8. PRODUCTS */

/* `need` names the permission a column depends on. A column with no `need` is
   for everyone. Declaring it here rather than filtering at each draw site
   means the header, the body and the export all read the same list and cannot
   drift apart — which is exactly how a hidden column reappears in a
   spreadsheet six months later. */
var PROD_COLS_ALL = [
  { k: 'name',   label: 'product' },
  { k: 'type',   label: 'type' },
  { k: 'qty',    label: 'stock', num: true, need: 'stock.read' },
  { k: 'cost',   label: 'cost',  num: true, need: 'cost.read' },
  { k: 'price',  label: 'price', num: true },
  { k: 'margin', label: 'margin', num: true, need: 'profit.read' },
  { k: 'health', label: 'health', need: 'stock.read' },
  /* Hiding something from the storefront is editing the catalogue, not
     browsing it. */
  { k: 'hidden', label: 'visible', need: 'product.write' }
];

function prodCols() {
  return PROD_COLS_ALL.filter(function (c) { return !c.need || allow(c.need); });
}

function productRows() {
  var f = OG.prod;
  var base = DB.products.filter(function (p) { return f.health === 'archived' ? p.archived : !p.archived; });
  var rows = base.map(function (p) {
    var qty = DB.totalQty(p.id);
    return {
      p: p, qty: qty, cost: p.costPrice, price: p.sellingPrice,
      margin: (p.sellingPrice - p.costPrice) / p.sellingPrice * 100,
      health: DB.health(qty), name: p.name, type: p.type, hidden: p.hidden ? 0 : 1
    };
  });

  if (f.type) rows = rows.filter(function (r) { return r.type === f.type; });
  if (f.health === 'gap') rows = rows.filter(function (r) { return DB.sizeGaps(r.p.id).length > 0; });
  else if (f.health && f.health !== 'archived') rows = rows.filter(function (r) { return r.health === f.health; });
  if (f.q) {
    var q = f.q.toLowerCase();
    rows = rows.filter(function (r) {
      return r.name.toLowerCase().indexOf(q) > -1 || r.p.brand.toLowerCase().indexOf(q) > -1;
    });
  }

  /* Sorting by a column this person cannot see would order the whole table by
     an invisible number — and cost order and price order are close enough that
     it would look like a bug rather than a secret. Fall back to name. */
  var sort = f.sort;
  if (!prodCols().some(function (c) { return c.k === sort; })) sort = 'name';

  var order = { out: 0, critical: 1, low: 2, healthy: 3 };
  rows.sort(function (a, b) {
    var x = a[sort], y = b[sort];
    if (sort === 'health') { x = order[x]; y = order[y]; }
    if (typeof x === 'string') return x.localeCompare(y) * f.dir;
    return (x - y) * f.dir;
  });
  return rows;
}

function viewProducts() {
  var rows = productRows();
  var types = Object.keys(DB.typeLabels);

  /* The products sheet is an inventory document — stock levels, pieces,
     critical SKUs. Without stock.read it would export a list of names and
     prices under a heading about inventory, which is worse than no button. */
  var canExport = allow('stock.read');

  var h = '<div class="page-head"><div><h1>' + t('products_title') + '</h1>' +
    '<div class="sub">' + t('products_sub') + '</div></div>' +
    '<div class="head-actions">' +
      (canExport ? exportButtons() : '') +
      ifNav('warehouse',
        '<button class="btn btn-primary" data-act="nav" data-view="warehouse">+ ' + t('tab_add') + '</button>') +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.prod.q) + '" data-change="prod-q">' +
    '<select class="inp" data-change="prod-type"><option value="">' + t('all_types') + '</option>';
  types.forEach(function (ty) {
    h += '<option value="' + ty + '"' + (OG.prod.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
  });
  h += '</select>';

  /* Every option in this filter is a stock level. To someone who cannot see
     the stock column it is a dropdown that reorders the list for no visible
     reason. */
  if (allow('stock.read')) {
    h += '<select class="inp" data-change="prod-health"><option value="">' + t('all_health') + '</option>';
    ['healthy', 'low', 'critical', 'out', 'gap', 'archived'].forEach(function (hh) {
      h += '<option value="' + hh + '"' + (OG.prod.health === hh ? ' selected' : '') + '>' +
           t(hh === 'gap' ? 'gap_only' : (hh === 'archived' ? 'bk_archived_only' : hh)) + '</option>';
    });
    h += '</select>';
  }

  h += '<span class="badge neutral">' + rows.length + ' / ' + DB.products.length + '</span></div>';

  var cols = prodCols();

  /* Bulk select feeds bulk EDIT. No point offering the checkboxes to someone
     who cannot act on the selection. */
  var bulk = allow('product.write');

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>';
  if (bulk) h += '<th class="bk-col">' + Bulk.headBox('products') + '</th>';
  cols.forEach(function (c) {
    var arrow = OG.prod.sort === c.k ? (OG.prod.dir === 1 ? ' ▲' : ' ▼') : '';
    h += '<th class="sortable' + (c.num ? ' num' : '') + '" data-act="prod-sort" data-k="' + c.k + '">' +
         t(c.label) + '<span class="arrow">' + arrow + '</span></th>';
  });
  h += '</tr></thead><tbody>';

  rows.forEach(function (r, ri) {
    var gaps = DB.sizeGaps(r.p.id);

    /* Built as a map and emitted in header order, rather than as a fixed run
       of <td>s. Dropping a column from the header alone would shunt every
       later cell one place left — the cashier would not see cost, she would
       see cost UNDER the heading "price", which is worse than showing it. */
    var cell = {
      name: '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        '<small>' + esc(r.p.brand) + ' · ' + esc(r.p.colorway) +
        (gaps.length ? ' · <span style="color:var(--destructive);font-weight:600">' + t('size') + ' ' + gaps.join('/') + ' = 0</span>' : '') +
        '</small></span></div></td>',
      type: '<td><span class="badge neutral">' + DB.typeLabels[r.type] + '</span></td>',
      qty: '<td class="num"><b>' + nf(r.qty) + '</b> <span class="muted small">' + t('pieces') + '</span></td>',
      cost: '<td class="num muted">' + money(r.cost) + '</td>',
      price: '<td class="num"><b>' + money(r.price) + '</b></td>',
      margin: '<td class="num">' + pct(r.margin, 0) + '</td>',
      health: '<td class="nowrap">' + healthBadge(r.qty) +
        (gaps.length ? ' <span class="badge critical">' + t('size_gap') + '</span>' : '') + '</td>',
      hidden: '<td onclick="event.stopPropagation()"><label class="switch"><input type="checkbox"' +
        (r.p.hidden ? '' : ' checked') + ' data-change="toggle-visible" data-id="' + r.p.id + '"><i></i></label></td>'
    };

    h += '<tr class="clickable' + (bulk && Bulk.has('products', r.p.id) ? ' bk-on' : '') +
         '" data-act="open-product" data-id="' + r.p.id + '">' +
      (bulk ? '<td class="bk-col">' + Bulk.box('products', r.p.id, ri) + '</td>' : '');
    cols.forEach(function (c) { h += cell[c.k]; });
    h += '</tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

function openProductDrawer(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var vs = DB.variantsOf(pid);
  var total = DB.totalQty(pid);
  var gaps = DB.sizeGaps(pid);
  var trend = DB.productTrend(pid);
  var max = Math.max.apply(null, trend.concat([1]));

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      thumb(p, 'lg') +
      '<div><span class="eyebrow">' + DB.typeLabels[p.type] + ' · ' + esc(p.brand) + '</span>' +
      '<h3 style="font-size:18px;margin:3px 0 4px">' + esc(p.name) + '</h3>' +
      healthBadge(total) + ' <span class="badge neutral">' + esc(p.colorway) + '</span></div>' +
    '</div>';

  var body = '';

  if (gaps.length) {
    body += '<div class="alert-row alert-danger" style="margin-bottom:14px">' +
      '<span class="alert-ico red">!</span><span class="alert-txt"><b>' + t('size_gap_warn') + '</b>' +
      '<small>' + t('size') + ' ' + gaps.join(', ') + ' = 0 · ' + t('total_stock') + ' ' + total + '</small></span>' +
      '<button class="btn btn-sm btn-primary" data-act="reorder" data-id="' + p.id + '">' + t('reorder') + '</button></div>';
  }

  /* Stock, then what it is worth to us, then what we make on it — the last
     two are only for people allowed the numbers. The selling price is on the
     header above and stays: a cashier has to be able to answer "how much?". */
  var kpi = [
    '<div class="stat"><span class="eyebrow">' + t('total_stock') + '</span><div class="val">' + nf(total) + '</div></div>'
  ];
  if (seesCost()) {
    kpi.push('<div class="stat"><span class="eyebrow">' + t('stock_value') + '</span><div class="val">' +
             moneyShort(total * p.costPrice) + '</div></div>');
  }
  if (seesProfit()) {
    kpi.push('<div class="stat"><span class="eyebrow">' + t('margin') + '</span><div class="val accent">' +
             pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) + '</div></div>');
  }
  body += '<div class="grid" style="grid-template-columns:repeat(' + kpi.length +
          ',1fr);margin-bottom:16px">' + kpi.join('') + '</div>';

  var canLabel = allow('label.print');
  body += '<div class="card mb"><div class="card-head"><h3>' + t('per_size') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + vs.length + ' SKU</span></div></div>' +
    '<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th>' + t('sku') + '</th><th>' + t('barcode') + '</th>' +
      '<th class="num">' + t('qty') + '</th><th>' + t('shelf') + '</th><th>' + t('status') + '</th>' +
      (canLabel ? '<th class="num">' + t('lbl_qty') + '</th><th></th>' : '') +
    '</tr></thead><tbody>';
  vs.forEach(function (v) {
    body += '<tr' + (v.qty === 0 ? ' class="row-danger"' : '') + '>' +
      '<td><b style="font-family:var(--font-head);font-size:14px">' + v.size + '</b></td>' +
      '<td class="muted num nowrap">' + v.sku + '</td>' +
      '<td class="num muted nowrap">' + v.barcode + '</td>' +
      '<td class="num"><b>' + v.qty + '</b></td>' +
      '<td><span class="badge neutral">' + v.shelf + '</span></td>' +
      '<td>' + healthBadge(v.qty) + '</td>' +
      (canLabel
        ? '<td class="num"><input class="inp num lbl-qty-inp" type="number" min="1" max="99" value="1" style="width:56px"></td>' +
          '<td><button class="btn btn-sm" data-act="preview-labels" data-variant-sku="' + esc(v.sku) + '">' +
            t('print_labels') + '</button></td>'
        : '') +
      '</tr>';
  });
  body += '</tbody></table></div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('sales_trend') + '</h3>' +
    '<div class="card-actions muted small">' + trend.reduce(function (a, b) { return a + b; }, 0) + ' ' + t('units').toLowerCase() + '</div></div>' +
    '<div class="card-body"><div class="sparkline">';
  trend.forEach(function (v, i) {
    body += '<i class="' + (i === trend.length - 1 ? 'last' : '') + '" style="height:' + Math.max(4, v / max * 100) + '%" title="' + v + '"></i>';
  });
  body += '</div></div></div>';

  body += '<div class="card"><div class="card-body"><dl class="kv">' +
    '<dt>' + t('brand') + '</dt><dd>' + esc(p.brand) + '</dd>' +
    '<dt>' + t('made_in') + '</dt><dd>' + esc(p.madeIn) + '</dd>' +
    '<dt>' + t('colour') + '</dt><dd>' + esc(p.colorway) + '</dd>' +
    (seesCost() ? '<dt>' + t('cost_price') + '</dt><dd>' + money(p.costPrice) + '</dd>' : '') +
    '<dt>' + t('selling_price') + '</dt><dd>' + money(p.sellingPrice) + '</dd>' +
    '<dt>' + t('last_sold') + '</dt><dd>' + p.lastSoldDaysAgo + ' ' + t('days_ago') + '</dd>' +
    '<dt>' + t('visible') + '</dt><dd>' + (p.hidden ? t('no') : t('yes')) + '</dd>' +
  '</dl></div></div>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" data-act="nav-close" data-view="warehouse">' + t('edit_product') + '</button>' +
    '<button class="btn" data-act="labels-for" data-id="' + p.id + '">' + t('print_labels') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="product" data-kind="pdf" data-id="' + p.id + '">' + t('rec_stock_sheet') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="product" data-kind="excel" data-id="' + p.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  openDrawer({ head: head, body: body });
}

/* ------------------------------------------------------------- 9. WAREHOUSE */

/* 12-digit body plus a real mod-10 check digit, so warehouse labels scan too. */
function whBarcode(type, size, i) {
  var typeCode = { sneakers: '11', boots: '12', tshirts: '21', jerseys: '22', shirts: '23',
                   jackets: '24', jeans: '31', crocs: '13' }[type] || '99';
  /* 3 + 2 + 3 + 4 = exactly 12 digits before the check digit */
  var body = '621' + typeCode + pad(i, 3) +
             pad((size.charCodeAt(0) * 37 + (size.charCodeAt(1) || 7) * 11) % 10000, 4);
  return body + Codes.ean13Check(body);
}

function viewWarehouse() {
  var h = '<div class="page-head"><div><h1>' + t('warehouse_title') + '</h1>' +
    '<div class="sub">' + t('warehouse_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge neutral">' + DB.variants.length + ' SKU</span>' +
      '<span class="badge accent">' + nf(DB.variants.reduce(function (a, v) { return a + v.qty; }, 0)) + ' ' + t('total_pieces').toLowerCase() + '</span>' +
      exportButtons() +
    '</div></div>';

  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; }).length;

  var floorGaps = DB.floorOuts().length;

  /* Which tabs this person's job includes. A cashier has stock.read and
     nothing else here: she is allowed to look in the back to answer "have you
     got it in a 42", and that is all. Receiving, moving, ordering and counting
     are somebody else's work, and a tab that opens onto a form the server will
     refuse is worse than no tab. */
  var tabs = [
    { id: 'stock', label: t('wh_stock'), dot: !!floorGaps },
    { id: 'add',   label: t('tab_add'),  need: 'product.write' },
    /* The movement log is the audit trail for receiving, transferring and
       counting. You get the history of the thing you can do — for a cashier
       looking up whether a 42 is in the back, it is a wall of somebody else's
       paperwork. */
    { id: 'moves', label: t('tab_moves'), need: 'stock.move' },
    { id: 'po',    label: t('po_title'), dot: !!openPOs, need: 'stock.move' },
    { id: 'count', label: t('st_count'), dot: !!Stock.active(), need: 'stock.count' }
  ].filter(function (x) { return !x.need || allow(x.need); });

  /* A tab bar with one tab in it is furniture. */
  if (tabs.length > 1) {
    h += '<div class="tabs">';
    tabs.forEach(function (x) {
      h += '<button class="tab ' + (OG.wh.tab === x.id ? 'on' : '') + '" data-act="wh-tab" data-tab="' + x.id + '">' +
        x.label + (x.dot ? '<span class="tab-dot"></span>' : '') + '</button>';
    });
    h += '</div>';
  }

  /* Landing on a tab that is no longer there — a remembered choice, a deep
     link — falls back to the first one she does have rather than rendering
     a blank panel under no heading. */
  var tab = OG.wh.tab;
  if (!tabs.some(function (x) { return x.id === tab; })) tab = tabs[0].id;

  h += (tab === 'stock') ? whStockTab()
     : (tab === 'add')   ? whAddTab()
     : (tab === 'po')    ? whPoTab()
     : (tab === 'count') ? Stock.view()
     : whMovesTab();
  return h;
}

/* ---- stock by place --------------------------------------------------------
   The question this page could not answer before: is that pair on the wall, or
   is it in the back? Pick a place, see every product in it, expand one to see
   the per-size breakdown for that place alone. */
function whStockTab() {
  var whId = OG.wh.place || 'all';
  var ar = OG.lang === 'ar';
  var tot = DB.whTotals(whId);
  var h = '';

  /* -- place picker -- */
  h += '<div class="seg-row mb">' +
    '<button class="seg' + (whId === 'all' ? ' on' : '') + '" data-act="wh-place" data-w="all">' +
      t('wh_all') + '</button>';
  DB.warehouses.forEach(function (w) {
    h += '<button class="seg' + (whId === w.id ? ' on' : '') + '" data-act="wh-place" data-w="' + w.id + '">' +
      esc(DB.whName(w.id, ar)) + '</button>';
  });
  h += '</div>';

  /* -- what is in the selected place -- */
  var emptyHere = DB.variants.filter(function (v) {
    return (whId === 'all' ? v.qty : DB.stockAt(v, whId)) === 0;
  }).length;

  /* "Value at cost" is the capital sitting on the shelf. It is a money figure
     dressed as a stock figure, and it is the one thing on this page a cashier
     or a stock keeper has no business reading. */
  var whStats = [
    '<div class="stat"><span class="eyebrow">' + t('stock') + '</span>' +
      '<div class="val">' + nf(tot.pieces) + '</div>' +
      '<div class="foot">' + t('wh_pieces_here') + '</div></div>',
    '<div class="stat"><span class="eyebrow">' + t('sku') + '</span>' +
      '<div class="val">' + tot.skus + '</div>' +
      '<div class="foot">' + (whId === 'all' ? t('in_catalogue') : t('wh_skus_here')) + '</div></div>'
  ];
  if (seesCost()) {
    whStats.push('<div class="stat"><span class="eyebrow">' + t('wh_value_here') + '</span>' +
      '<div class="val" style="font-size:20px">' + money(tot.value) + '</div></div>');
  }
  whStats.push('<div class="stat"><span class="eyebrow">' + t('out') + '</span>' +
    '<div class="val' + (emptyHere ? ' warn' : '') + '">' + emptyHere + '</div>' +
    '<div class="foot">' + t('wh_empty_sizes') + '</div></div>');

  h += '<div class="grid stat-row mb" style="grid-template-columns:repeat(' +
       whStats.length + ',minmax(0,1fr))">' + whStats.join('') + '</div>';

  /* -- suggested moves, only where they exist -- */
  /* "Move these to the floor" is an instruction to do something. Without
     stock.move it is an instruction she cannot carry out. */
  if (whId !== 'store' && allow('stock.move')) h += whSuggestCard();

  /* -- grouped by product type: "Sneakers · 142 pieces" -- */
  var byType = {};
  DB.products.forEach(function (p) {
    var n = DB.variantsOf(p.id).reduce(function (s, v) {
      return s + (whId === 'all' ? v.qty : DB.stockAt(v, whId));
    }, 0);
    if (!byType[p.type]) byType[p.type] = { pieces: 0, rows: [] };
    byType[p.type].pieces += n;
    byType[p.type].rows.push({ p: p, n: n });
  });

  var types = Object.keys(byType).sort(function (a, b) {
    return byType[b].pieces - byType[a].pieces;
  });

  types.forEach(function (ty) {
    var g = byType[ty];
    g.rows.sort(function (a, b) { return b.n - a.n; });

    h += '<div class="card mb"><div class="card-head">' +
      '<h3>' + esc(DB.typeLabels[ty] || ty) + '</h3>' +
      '<div class="card-actions"><span class="badge accent">' + nf(g.pieces) + ' ' +
        t('pieces').toLowerCase() + '</span></div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('product') + '</th>' +
        '<th class="num">' + t('qty') + '</th>' +
        '<th>' + t('per_size') + '</th>' +
        '<th></th>' +
      '</tr></thead><tbody>';

    g.rows.forEach(function (r) {
      var vs = DB.variantsOf(r.p.id);
      h += '<tr' + (r.n === 0 ? ' class="row-dim"' : '') + '>' +
        '<td><div class="cell-prod">' + thumb(r.p) +
          '<span><b>' + esc(r.p.name) + '</b><small>' + esc(r.p.colorway) + '</small></span></div></td>' +
        '<td class="num"><b>' + r.n + '</b></td>' +
        '<td><div class="wh-sizes">';

      vs.forEach(function (v) {
        var here = whId === 'all' ? v.qty : DB.stockAt(v, whId);
        /* On "Everywhere" each cell reads floor/store, because the whole point
           of that view is the split, not the total. */
        var sub = whId === 'all'
          ? DB.stockAt(v, 'floor') + '/' + DB.stockAt(v, 'store')
          : String(here);
        var cls = here === 0
          ? (DB.stockElsewhere(v, whId) > 0 ? 'wh-cell elsewhere' : 'wh-cell zero')
          : 'wh-cell';
        h += '<span class="' + cls + '" title="' + esc(v.size + ' · ' + v.shelf) + '">' +
          '<b>' + v.size + '</b><i>' + sub + '</i></span>';
      });

      h += '</div></td>' +
        '<td>' + (allow('stock.move')
          ? '<button class="btn btn-sm btn-ghost" data-act="wh-transfer" data-id="' + r.p.id + '">' +
            t('wh_transfer') + '</button>'
          : '') + '</td></tr>';
    });

    h += '</tbody></table></div></div>';
  });

  return h;
}

/* Move stock between places. Every size is listed with what each place holds,
   so the choice is made against real numbers rather than from memory. */
/* ---- a person the shop has not met before ---------------------------------
   The customer list was read-only, which was survivable while it was forty
   seeded names and nothing was saved. It stopped being survivable the moment
   customers became real: the receipt prints a name and a points balance, and
   a list nobody can add to means the loyalty scheme only ever works for people
   who were already in the database.

   Deliberately three fields. This is filled in at a till with somebody waiting;
   a form asking for an address and a note is a form that gets skipped, and a
   skipped form is a walk-in sale with no customer on it. */
function openNewCustomer(prefill, onCreated) {
  if (!allow('customer.write')) { toast(t('customer'), t('no_access'), 'err'); return; }

  var name = '', phone = '';
  /* Whatever was typed into the search that found nobody. Digits are a phone
     number, anything else is a name — she has already typed it once. */
  var seed = String(prefill || '').trim();
  if (/^[\d+\s()-]+$/.test(seed) && seed.replace(/\D/g, '').length >= 3) phone = seed;
  else name = seed;

  openModal({
    title: t('cu_new'), size: 'narrow',
    body:
      '<label class="field"><span>' + t('name') + '</span>' +
        '<input class="inp" id="cuName" type="text" value="' + esc(name) + '" ' +
        'placeholder="' + esc(t('cu_name_ph')) + '"></label>' +
      '<label class="field mt"><span>' + t('phone') + '</span>' +
        '<input class="inp" id="cuPhone" type="tel" inputmode="tel" value="' + esc(phone) + '" ' +
        'placeholder="+963 9__ ___ ___"></label>' +
      '<label class="field mt"><span>' + t('city') + '</span>' +
        '<input class="inp" id="cuCity" type="text" value="' + esc(CONFIG.SHOP_CITY || 'Aleppo') + '"></label>' +
      '<div class="partner-note mt">' + t('cu_new_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="cu-save">' + t('save') + '</button>'
  });

  /* Handed to the action rather than read back out of the DOM, because the
     modal is gone by the time the server answers. */
  OG.cuOnCreated = onCreated || null;
  setTimeout(function () {
    var el = document.getElementById(name ? 'cuPhone' : 'cuName');
    if (el) el.focus();
  }, 60);
}

function openTransfer(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var ar = OG.lang === 'ar';
  var vs = DB.variantsOf(pid);

  var body = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">' +
    thumb(p, 'lg') + '<div><span class="eyebrow">' + esc(p.brand) + '</span>' +
    '<h3 style="font-size:16px;margin:2px 0">' + esc(p.name) + '</h3></div></div>';

  body += '<div class="lbl">' + t('size') + '</div>' +
    '<select class="inp" id="trSku">';
  vs.forEach(function (v) {
    var parts = DB.warehouses.map(function (w) {
      return DB.whName(w.id, ar) + ' ' + DB.stockAt(v, w.id);
    }).join(' · ');
    body += '<option value="' + v.sku + '">' + v.size + ' — ' + esc(parts) + '</option>';
  });
  body += '</select>';

  body += '<div class="grid mt" style="grid-template-columns:1fr 1fr;gap:10px">' +
    '<div><div class="lbl">' + t('wh_from') + '</div><select class="inp" id="trFrom">' +
      DB.warehouses.map(function (w) {
        return '<option value="' + w.id + '"' + (w.id === DB.intakeWh ? ' selected' : '') + '>' +
          esc(DB.whName(w.id, ar)) + '</option>';
      }).join('') +
    '</select></div>' +
    '<div><div class="lbl">' + t('wh_to') + '</div><select class="inp" id="trTo">' +
      DB.warehouses.map(function (w) {
        return '<option value="' + w.id + '"' + (w.id === DB.defaultWh ? ' selected' : '') + '>' +
          esc(DB.whName(w.id, ar)) + '</option>';
      }).join('') +
    '</select></div>' +
  '</div>';

  body += '<div class="mt"><div class="lbl">' + t('wh_qty_to_move') + '</div>' +
    '<input class="inp" id="trQty" type="number" min="1" value="1"></div>' +
    '<div class="partner-note mt">' + t('wh_split_hint') + '</div>';

  openModal({
    title: t('wh_transfer'),
    size: 'narrow',
    body: body,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="wh-transfer-go">' + t('wh_move') + '</button>'
  });
}

/* The list that turns "the wall is empty" into a job someone can do. */
function whSuggestCard() {
  var all = DB.replenishSuggestions();
  /* Five, not the full list. This card sits above the stock breakdown, and a
     dozen rows pushed the thing the page is actually for off the screen. Five
     is a trip to the back room; the rest are still counted in the header. */
  var sug = all.slice(0, 5);
  if (!sug.length) {
    return '<div class="partner-note note-ok mb">' + t('wh_nothing_to_move') + '</div>';
  }

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('wh_suggest') +
    '<span class="badge critical" style="margin-inline-start:8px">' + all.length + '</span></h3>' +
    '<div class="card-actions muted small">' + t('wh_suggest_sub') + '</div></div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('wh_here') + '</th><th class="num">' + t('wh_in_the_back') + '</th>' +
      '<th class="num">' + t('po_rate') + '</th><th class="num">' + t('wh_move') + '</th><th></th>' +
    '</tr></thead><tbody>';

  sug.forEach(function (s) {
    var p = DB.product(s.productId);
    if (!p) return;
    h += '<tr class="row-late">' +
      '<td><div class="cell-prod">' + thumb(p) + '<span><b>' + esc(p.name) + '</b></span></div></td>' +
      '<td><b>' + s.size + '</b></td>' +
      '<td class="num"><span class="badge critical">0</span></td>' +
      '<td class="num"><b>' + s.back + '</b></td>' +
      /* One decimal. A single size sells a fraction of a pair per week and the
         raw figure prints as 0.375, which reads like a bug rather than a rate. */
      '<td class="num muted">' + (Math.round(s.rate * 10) / 10) + '/' + t('po_week') + '</td>' +
      '<td class="num"><b>' + s.qty + '</b></td>' +
      '<td><button class="btn btn-sm btn-primary" data-act="wh-move-now" ' +
        'data-sku="' + s.sku + '" data-n="' + s.qty + '">' + t('wh_move') + '</button></td></tr>';
  });

  return h + '</tbody></table></div></div>';
}

/* Purchase orders, plus the list of what is worth ordering next. The
   suggestion table is the useful half — it turns "something is low" into a
   ranked list of exactly what to buy and how many. */
function whPoTab() {
  var h = '';

  var sug = DB.reorderSuggestions().slice(0, 10);
  if (sug.length) {
    h += '<div class="card mb"><div class="card-head"><h3>' + t('po_suggest') + '</h3>' +
      '<div class="card-actions muted small">' + t('po_suggest_sub') + '</div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
        '<th class="num">' + t('in_stock') + '</th><th class="num">' + t('po_rate') + '</th>' +
        '<th class="num">' + t('po_cover') + '</th><th class="num">' + t('po_order') + '</th><th></th>' +
      '</tr></thead><tbody>';
    sug.forEach(function (s) {
      var p = DB.product(s.productId);
      h += '<tr class="clickable' + (s.have === 0 ? ' row-late' : '') + '" data-act="reorder" data-id="' + p.id + '">' +
        '<td><div class="cell-prod">' + thumb(p) + '<span><b>' + esc(p.name) + '</b></span></div></td>' +
        '<td><b>' + s.size + '</b></td>' +
        '<td class="num">' + healthBadge(s.have) + ' ' + s.have + '</td>' +
        '<td class="num muted">' + s.rate + '/' + t('po_week') + '</td>' +
        '<td class="num ' + (s.cover < 14 ? 'po-urgent' : 'muted') + '">' +
          (s.cover === Infinity ? '—' : s.cover + t('yl_d')) + '</td>' +
        '<td class="num"><b>' + s.qty + '</b></td>' +
        '<td onclick="event.stopPropagation()"><button class="btn btn-sm btn-primary" ' +
          'data-act="reorder" data-id="' + p.id + '">' + t('reorder') + '</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
  }

  if (!DB.purchaseOrders.length) {
    return h + '<div class="card"><div class="cart-empty"><b>' + t('po_none') + '</b>' +
           t('po_none_sub') + '</div></div>';
  }

  /* A purchase order is two things at once: a list of goods to check off the
     van, and a bill. The stock keeper needs the first and not the second, so
     the tab stays and the money column goes. Hiding the whole tab instead
     would take his receiving workflow away to protect a number. */
  var poMoney = seesCost();

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('yi_invoice') + '</th><th>' + t('supplier') + '</th><th>' + t('date') + '</th>' +
    '<th class="num">' + t('pieces') + '</th>' +
    (poMoney ? '<th class="num">' + t('total') + '</th>' : '') +
    '<th>' + t('status') + '</th><th></th>' +
  '</tr></thead><tbody>';

  DB.purchaseOrders.forEach(function (po) {
    var sup = DB.supplier(po.supplierId);
    var cls = po.status === 'received' ? 'healthy' : po.status === 'sent' ? 'accent' : 'neutral';
    h += '<tr>' +
      '<td><b>' + po.id + '</b><small class="muted" style="display:block">' + esc(po.note) + '</small></td>' +
      '<td>' + esc(sup ? sup.name : '—') + '</td>' +
      '<td class="num muted">' + fmtDate(po.created) + '</td>' +
      '<td class="num">' + DB.poPieces(po) + '</td>' +
      (poMoney ? '<td class="num"><b>' + money(DB.poTotal(po)) + '</b></td>' : '') +
      '<td><span class="badge ' + cls + '">' + t('po_' + po.status) + '</span></td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm btn-ghost" data-act="po-whatsapp" data-id="' + po.id + '">' +
          t('po_whatsapp') + '</button> ' +
        (po.status !== 'received'
          ? '<button class="btn btn-sm btn-primary" data-act="po-receive" data-id="' + po.id + '">' +
              t('po_receive') + '</button>'
          : '') +
      '</td></tr>';
  });

  return h + '</tbody></table></div>';
}

function whAddTab() {
  var sizes = DB.sizeSets[OG.wh.type] || [];
  var totalPieces = 0, totalCost = 0, totalRev = 0;
  var cost = Number(document.getElementById('whCost') && document.getElementById('whCost').value) || 0;

  sizes.forEach(function (s) { totalPieces += Number(OG.wh.sizes[s] || 0); });

  var h = '<div class="grid" style="grid-template-columns:minmax(0,1fr) 330px;align-items:start">';

  /* -- form -- */
  h += '<div class="card"><div class="card-head"><h3>' + t('tab_add') + '</h3>' +
    '<div class="card-actions muted small">' + t('matrix_hint') + '</div></div><div class="card-body">';

  h += '<div class="grid" style="grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:start">';

  /* Three ways in, because people reach for different ones: click to browse,
     drag a file onto the square, or just paste a screenshot. The hidden file
     input is the real control — the box is its label. */
  h += '<div><span class="lbl">' + t('image') + '</span>' +
    '<div class="upload-box' + (OG.wh.imgSrc ? ' has-img' : '') + '" id="whDrop" data-act="wh-image">' +
      (OG.wh.imgSrc
        ? '<img class="up-img" src="' + OG.wh.imgSrc + '" alt="">' +
          '<span class="up-swap">' + t('up_swap') + '</span>' +
          '<button class="up-x" data-act="wh-image-clear" title="' + esc(t('remove')) + '">✕</button>'
        : OG.wh.img
          ? '<span class="up-preview" style="background:' + OG.wh.img + '">' +
              (OG.wh.name.slice(0, 2).toUpperCase() || 'OG') + '</span>' +
            '<button class="up-x" data-act="wh-image-clear" title="' + esc(t('remove')) + '">✕</button>'
          : '<span class="up-empty">' +
              '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
                '<path d="M3 16l5-5 4 4 3-3 6 6M3 5h18v14H3zM8.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg>' +
              '<b>' + t('up_pick') + '</b><small>' + t('up_hint') + '</small></span>') +
    '</div>' +
    '<input type="file" id="whFile" accept="image/*" hidden>' +
    '<button class="btn btn-sm btn-ghost btn-block mt-xs" data-act="wh-image-colour">' +
      t('up_colour') + '</button>' +
  '</div>';

  h += '<div>' +
    '<label class="field"><span>' + t('product_name') + '</span>' +
      '<input class="inp" id="whName" type="text" value="' + esc(OG.wh.name) + '" placeholder="OG Heavyweight Tee" data-change="wh-name"></label>' +
    '<div class="row2">' +
      '<label class="field"><span>' + t('type') + '</span><select class="inp" data-change="wh-type">' +
        Object.keys(DB.typeLabels).map(function (ty) {
          return '<option value="' + ty + '"' + (OG.wh.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>' + t('brand') + '</span><input class="inp" type="text" value="OG" placeholder="OG"></label>' +
    '</div>' +
    '<div class="' + (seesCost() ? 'row3' : 'row2') + '">' +
      '<label class="field"><span>' + t('made_in') + '</span><input class="inp" type="text" value="Syria"></label>' +
      /* Someone booking goods in without cost.read enters what the shop sells
         it for, not what it was bought for. The field is left out rather than
         disabled, because a disabled box invites a guess — and a guessed cost
         price is worse than a missing one: it quietly poisons every margin
         and profit figure the manager reads afterwards. */
      (seesCost()
        ? '<label class="field"><span>' + t('cost_price') + '</span><input class="inp num" id="whCost" type="number" value="1050" data-change="wh-recalc"></label>'
        : '') +
      '<label class="field"><span>' + t('selling_price') + '</span><input class="inp num" id="whPrice" type="number" value="2250" data-change="wh-recalc"></label>' +
    '</div>' +
    (seesCost() ? '' :
      '<div class="partner-note">' + t('wh_cost_later') + '</div>') +
    '<label class="field"><span>' + t('shelf_box') + '</span><input class="inp" type="text" value="D-09"></label>' +
  '</div></div>';

  h += '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px">' +
    '<span class="lbl">' + t('size_matrix') + ' — ' + DB.typeLabels[OG.wh.type] + '</span>' +
    '<div class="size-matrix">';
  sizes.forEach(function (s, i) {
    var q = OG.wh.sizes[s] || '';
    h += '<div class="size-cell' + (q ? ' filled' : '') + '"><b>' + s + '</b>' +
      '<input type="number" min="0" placeholder="0" value="' + q + '" data-change="wh-size" data-size="' + s + '">' +
      '<small>' + (q ? whBarcode(OG.wh.type, s, i + 1) : '—') + '</small></div>';
  });
  h += '</div></div>';

  h += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
    '<button class="btn btn-primary btn-lg" data-act="wh-save">' + t('save_product') + '</button>' +
    '<button class="btn btn-lg" data-act="wh-labels"' + (totalPieces ? '' : ' disabled') + '>' + t('print_labels') + '</button>' +
  '</div>';

  h += '</div></div>';

  /* -- live preview -- */
  var priceEl = document.getElementById('whPrice');
  var price = Number(priceEl && priceEl.value) || 2250;
  cost = cost || 1050;
  totalCost = totalPieces * cost;
  totalRev = totalPieces * price;

  h += '<div><div class="card"><div class="card-head"><h3>' + t('barcode_preview') + '</h3></div>' +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th><th>' + t('barcode') + '</th></tr></thead><tbody>';
  var any = false;
  sizes.forEach(function (s, i) {
    var q = Number(OG.wh.sizes[s] || 0);
    if (!q) return;
    any = true;
    h += '<tr><td><b>' + s + '</b></td><td class="num">' + q + '</td>' +
         '<td class="num muted" style="letter-spacing:.04em">' + whBarcode(OG.wh.type, s, i + 1) + '</td></tr>';
  });
  if (!any) {
    sizes.slice(0, 3).forEach(function (s, i) {
      h += '<tr class="muted"><td><b>' + s + '</b></td><td class="num">0</td>' +
           '<td class="num" style="letter-spacing:.04em">' + whBarcode(OG.wh.type, s, i + 1) + '</td></tr>';
    });
  }
  h += '</tbody><tfoot><tr><td>' + t('total_pieces') + '</td><td class="num">' + totalPieces + '</td><td></td></tr></tfoot></table></div></div>';

  /* Expected revenue is selling price × pieces — no cost in it, so it stays
     for everyone. Total cost does not. */
  h += '<div class="grid mt" style="grid-template-columns:' + (seesCost() ? '1fr 1fr' : '1fr') + '">' +
    (seesCost()
      ? '<div class="stat"><span class="eyebrow">' + t('total_cost') + '</span><div class="val">' + moneyShort(totalCost) + '</div></div>'
      : '') +
    '<div class="stat"><span class="eyebrow">' + t('expected_revenue') + '</span><div class="val accent">' + moneyShort(totalRev) + '</div></div>' +
  '</div>';

  h += '<div class="card mt"><div class="card-head"><h3>' + t('tab_moves') + '</h3></div>';
  DB.stockMovements.slice(0, 5).forEach(function (mv) {
    var p = DB.product(mv.productId);
    h += '<div class="alert-row"><span class="alert-ico ' + (mv.delta > 0 ? 'green' : 'grey') + '">' + (mv.delta > 0 ? '+' : '−') + '</span>' +
      '<span class="alert-txt">' + esc(p ? p.name : mv.sku) + ' · ' + mv.size +
      '<small>' + esc(mv.note) + ' · ' + relDate(mv.date) + '</small></span>' +
      '<b class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' + (mv.delta > 0 ? '+' : '') + mv.delta + '</b></div>';
  });
  h += '</div></div></div>';

  return h;
}

function whMovesTab() {
  var h = '<div class="card table-wrap" id="mvTable" style="max-height:calc(100vh - 240px);overflow-y:auto">' +
    '<table class="tbl"><thead><tr>' +
      '<th class="bk-col">' + Bulk.headBox('movements') + '</th>' +
      '<th>' + t('date') + '</th><th>' + t('movement') + '</th><th>' + t('product') + '</th>' +
      '<th>' + t('sku') + '</th><th>' + t('wh_location') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('balance') + '</th><th>' + t('user') + '</th><th>' + t('notes') + '</th>' +
    '</tr></thead><tbody>';

  DB.stockMovements.slice(0, 90).forEach(function (mv, mi) {
    var p = DB.product(mv.productId);
    h += '<tr' + (Bulk.has('movements', mv.id) ? ' class="bk-on"' : '') + '>' +
      '<td class="bk-col">' + Bulk.box('movements', mv.id, mi) + '</td>' +
      '<td class="nowrap muted num">' + fmtDate(mv.date) + '</td>' +
      '<td><span class="badge ' + (mv.delta > 0 ? 'healthy' : (mv.type === 'damaged' ? 'critical' : 'neutral')) + '">' + t(mv.type) + '</span></td>' +
      '<td><div class="cell-prod">' + (p ? thumb(p) : '') + '<span><b>' + esc(p ? p.name : '—') + '</b>' +
        '<small>' + t('size') + ' ' + mv.size + '</small></span></div></td>' +
      '<td class="muted num">' + mv.sku + '</td>' +
      /* Historical rows written before places existed have no wh; show a dash
         rather than inventing a location they were never recorded in. */
      '<td>' + (mv.wh
        ? '<span class="badge neutral">' + esc(DB.whName(mv.wh, OG.lang === 'ar')) + '</span>'
        : '<span class="muted">—</span>') + '</td>' +
      '<td class="num"><span class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' + (mv.delta > 0 ? '+' : '') + mv.delta + '</span></td>' +
      '<td class="num"><b>' + mv.balance + '</b></td>' +
      '<td class="muted">' + esc(mv.user) + '</td>' +
      '<td class="muted small">' + esc(mv.note) + '</td>' +
    '</tr>';
  });

  h += '</tbody></table></div>' +
    '<div class="partner-note" style="margin-top:12px">' +
    (OG.lang === 'ar'
      ? 'كل حركة مسجّلة باسم المستخدم والتاريخ والرصيد بعدها. لا يمكن حذف سطر — فقط إضافة حركة تصحيح.'
      : 'Every movement is stamped with a user, a date and the balance after it. Rows cannot be deleted — only corrected with a new movement.') +
    '</div>';
  return h;
}

/* --------------------------------------------------------- LABEL STUDIO
   Four templates, three physical sizes, real EAN-13 and real QR. The sheet
   prints at true millimetre dimensions with crop marks; the controls carry
   .no-print so only the labels reach paper. */

var LABEL_TEMPLATES = {
  /* The default, and deliberately price-free: what goes on the shoe is its
     IDENTITY. Prices move; a price printed on a sticker turns every price
     change into a reprint of the whole shelf. */
  product: { key: 'lb_product', barcode: 1, qr: 0, price: 0, size: 1, shelf: 0, logo: 1 },
  price: { key: 'lb_price', barcode: 1, qr: 0, price: 1, size: 1, shelf: 0, logo: 1 },
  shelf: { key: 'lb_shelf', barcode: 1, qr: 0, price: 0, size: 1, shelf: 1, logo: 0 },
  hang:  { key: 'lb_hang',  barcode: 0, qr: 1, price: 1, size: 1, shelf: 0, logo: 1 },
  mini:  { key: 'lb_mini',  barcode: 1, qr: 0, price: 0, size: 0, shelf: 0, logo: 0 }
};

var LABEL_SIZES = {
  '30x30': { w: 30, h: 30 },
  '50x30': { w: 50, h: 30 },
  '40x30': { w: 40, h: 30 },
  '70x40': { w: 70, h: 40 }
};

/* ---- fitting the barcode to the label ------------------------------------
   The label is whatever roll the printer is loaded with, so the barcode has to
   be generated TO that size rather than at a fixed pixel width and hoped for.

   The old code used a constant `module: 1.1`. Code 128 of OG-001-42 is 134
   modules, plus 20 for the quiet zones — 154 × 1.1px ≈ 169px, while a 40mm
   label is only 151px wide at 96dpi. It overflowed, and because the SVG
   carries max-width:100% the browser quietly scaled it DOWN to fit. Which is
   worse than overflowing: the label looked perfect and the bars came out
   narrower than the print head can resolve, so it simply would not scan.  */

var MM_PX = 96 / 25.4;          /* CSS pixels per millimetre */
var LABEL_PAD_MM = 5;           /* 2.5mm padding each side, from .blabel */

/* The narrowest bar a thermal head can render cleanly. A 203dpi printer puts
   down 8 dots/mm, so 0.25mm is two dots — the practical floor for Code 128.
   Thinner than this and the bars blur into each other on the sticker. */
var MIN_MODULE_MM = 0.25;

/* The label the studio is currently set to, custom included. */
function labelDim() {
  if (OG.lb.size === 'custom') {
    return {
      w: Math.max(15, Math.min(200, +OG.lb.cw || 50)),
      h: Math.max(10, Math.min(200, +OG.lb.ch || 30))
    };
  }
  return LABEL_SIZES[OG.lb.size] || LABEL_SIZES['30x30'];
}

/* Work out the module width that makes this exact symbol span the usable
   width of this exact label — and say plainly when it cannot. */
function fitBarcode(text, dim, sym) {
  var mods;
  if (sym === 'ean13') {
    mods = 11 + 95 + 7;                       /* quiet zones are asymmetric */
  } else {
    var m = Codes.code128(text);
    if (!m) return null;
    mods = m.length + 20;                     /* 10-module quiet zone each side */
  }
  var usableMm = Math.max(4, dim.w - LABEL_PAD_MM);
  var moduleMm = usableMm / mods;
  return {
    mods: mods,
    moduleMm: moduleMm,
    modulePx: moduleMm * MM_PX,
    /* Bar height, budgeted against everything else on the sticker rather than
       picked to look good. A 30mm label has 26mm usable after padding, and the
       logo, two lines of name, the size chip and the gaps already claim ~16mm.
       code128SVG then adds its own human-readable line UNDER the bars (~2.4mm),
       so at 0.30 the block came to 11.4mm and pushed the product name out of
       the top of the label — clipped, on every sticker. 0.22 leaves it room. */
    heightPx: Math.max(6, dim.h * 0.22) * MM_PX,
    tooSmall: moduleMm < MIN_MODULE_MM
  };
}

/* Any code on any current label that will not print readably. Drives the
   warning in the label studio — better to be told before a roll is spent. */
function labelFitWarnings() {
  var dim = labelDim();
  var bad = [];
  labelRows().forEach(function (r) {
    var f = fitBarcode(OG.lb.sym === 'ean13' ? r.code : r.sku, dim, OG.lb.sym);
    if (f && f.tooSmall) bad.push({ sku: r.sku, mm: f.moduleMm });
  });
  return bad;
}

function labelRows() {
  var rows = [];
  /* pids is the bulk path — labels for every selected product in one sheet */
  var pids = (OG.lb.pids && OG.lb.pids.length) ? OG.lb.pids : (OG.lb.pid ? [OG.lb.pid] : null);
  if (pids) {
    pids.forEach(function (pid) {
      var p = DB.product(pid);
      if (!p) return;
      DB.variantsOf(pid).forEach(function (v) {
        rows.push({ name: p.name, size: v.size, price: p.sellingPrice, code: v.barcode,
                    shelf: v.shelf, sku: v.sku, variant: v, n: Math.max(1, Math.min(v.qty || 1, OG.lb.max)) });
      });
    });
  } else {
    var sizes = DB.sizeSets[OG.wh.type] || [];
    var nameEl = document.getElementById('whName');
    var priceEl = document.getElementById('whPrice');
    var nm = (nameEl && nameEl.value) || OG.wh.name || 'OG Heavyweight Tee';
    var pr = Number(priceEl && priceEl.value) || 2250;
    sizes.forEach(function (s, i) {
      var q = Number(OG.wh.sizes[s] || 0);
      if (!q) return;
      var code = whBarcode(OG.wh.type, s, i + 1);
      rows.push({ name: nm, size: s, price: pr, code: code, shelf: 'D-09',
                  sku: 'NEW-' + s, variant: null, n: Math.min(q, OG.lb.max) });
    });
  }
  return rows;
}

/* A label QR must stay short. A 70-character payload becomes a 49-module
   symbol, which at 17mm is 0.35mm per module — below what a phone camera
   reliably resolves. The SKU alone is a 25-module symbol at 0.68mm. The
   rich, human-readable payload stays on the invoice, where there is room.

   url mode takes the same label from 25 modules to 41 — measured, not
   guessed. That is fine on the 50mm sticker and marginal on the smallest
   one, so leave QR_MODE on 'text' if he prints the small size. */
function labelQrPayload(r) {
  if (CONFIG.QR_MODE !== 'url') return r.sku;
  return r.variant ? deepLink('product', r.variant.productId) : r.sku;
}

function labelHTML(r) {
  var tpl = LABEL_TEMPLATES[OG.lb.template];
  var dim = labelDim();
  var big = dim.w >= 70;
  var useQr = tpl.qr && OG.lb.qr && r.variant;

  var txt = '';
  if (tpl.logo && OG.lb.logo) txt += '<img class="bl-logo" src="assets/logo.svg" alt="OG">';
  txt += '<b class="bl-name">' + esc(r.name) + '</b>';

  var meta = [];
  if (tpl.size && OG.lb.size2) meta.push('<span class="bl-size">' + r.size + '</span>');
  if (tpl.shelf && OG.lb.shelf) meta.push('<span class="bl-shelf">' + r.shelf + '</span>');
  if (meta.length) txt += '<div class="bl-meta">' + meta.join('') + '</div>';

  if (tpl.barcode && OG.lb.barcode) {
    /* Code 128 of the SKU on our own labels, not the EAN-13.
       ------------------------------------------------------------------
       The generated EAN-13s begin 621, which is GS1's real country prefix
       for Syria — an OG code could collide with a genuine Syrian product.
       Code 128 encodes text, so the label carries OG-001-42 itself: unique
       by construction, readable by a human, and no registry involved.

       Scanning it needs no new lookup either: resolveScan already falls back
       to DB.variantBySku, so a Code 128 label resolves through a path that
       has been there all along. EAN-13 stays readable for supplier goods. */
    /* Generated to the label, not to a guess. fitBarcode divides the usable
       width by this symbol's own module count, so the bars end exactly at the
       edge of the sticker whatever roll is loaded and however long the SKU. */
    var payload = OG.lb.sym === 'ean13' ? r.code : r.sku;
    var fit = fitBarcode(payload, dim, OG.lb.sym);
    if (fit) {
      txt += '<div class="bl-bc' + (fit.tooSmall ? ' bl-bc-tight' : '') + '">' +
        (OG.lb.sym === 'ean13'
          ? Codes.ean13SVG(payload, { module: fit.modulePx, height: fit.heightPx })
          : Codes.code128SVG(payload, { module: fit.modulePx, height: fit.heightPx })) +
      '</div>';
    }
  }
  /* Price is OFF by default and this is why: a price on a barcode sticker
     means every price change is a reprint of every sticker. The barcode
     identifies the shoe; the price lives at the till and on the shelf edge,
     where changing it costs nothing. */
  if (tpl.price && OG.lb.price) txt += '<div class="bl-price">' + money(r.price) + '</div>';

  /* has-qr rather than a :has() selector — plain class, no CSS-support risk */
  var h = '<div class="blabel tpl-' + OG.lb.template + (useQr ? ' has-qr' : '') +
          '" style="width:' + dim.w + 'mm;height:' + dim.h + 'mm">';
  if (useQr) {
    /* QR beside the text, not stacked — stacking overflows a 30mm label. */
    h += '<div class="bl-col">' + txt + '</div>' +
         '<div class="bl-qr">' + qrSafe(labelQrPayload(r), r.sku,
           { size: big ? 96 : 74, quiet: 2, style: 'square', dark: '#000000' }) + '</div>';
  } else {
    h += txt;
  }
  return h + '</div>';
}

function labelSheetHTML() {
  var rows = labelRows(), total = 0, sheet = '';
  rows.forEach(function (r) {
    for (var k = 0; k < r.n; k++) { sheet += labelHTML(r); total++; }
  });
  return { html: '<div class="label-sheet">' + sheet + '</div>', count: total, rows: rows.length };
}

function labelControls() {
  var h = '<div class="lb-controls no-print">';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_template') + '</span><div class="chip-row">';
  Object.keys(LABEL_TEMPLATES).forEach(function (k) {
    h += '<button class="chip ' + (OG.lb.template === k ? 'on' : '') + '" data-act="lb-tpl" data-k="' + k + '">' +
      t(LABEL_TEMPLATES[k].key) + '</button>';
  });
  h += '</div></div>';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_size') + '</span><div class="chip-row">';
  Object.keys(LABEL_SIZES).forEach(function (k) {
    h += '<button class="chip ' + (OG.lb.size === k ? 'on' : '') + '" data-act="lb-size" data-k="' + k + '">' +
      k.replace('x', ' × ') + ' mm</button>';
  });
  /* Whatever roll the printer is actually loaded with. Three fixed sizes were
     a guess made before the hardware was chosen. */
  h += '<button class="chip ' + (OG.lb.size === 'custom' ? 'on' : '') + '" data-act="lb-size" data-k="custom">' +
    t('lb_custom') + '</button>';
  h += '</div>';
  if (OG.lb.size === 'custom') {
    h += '<div class="lb-custom">' +
      '<input class="inp num" id="lbCW" type="number" min="15" max="200" step="1" data-change="lb-cw" value="' + (OG.lb.cw || 50) + '">' +
      '<span class="lb-x">×</span>' +
      '<input class="inp num" id="lbCH" type="number" min="10" max="200" step="1" data-change="lb-ch" value="' + (OG.lb.ch || 30) + '">' +
      '<span class="muted small">mm</span>' +
    '</div>';
  }
  h += '</div>';

  /* Paper. A thermal roll and an A4 sticker sheet need genuinely different
     page rules, and printing one as the other wastes a whole roll. */
  h += '<div class="lb-group"><span class="lbl">' + t('hw_mode') + '</span><div class="chip-row">' +
    '<button class="chip ' + (OG.lb.mode === 'roll' ? 'on' : '') + '" data-act="lb-mode" data-k="roll">' +
      t('hw_roll') + '</button>' +
    '<button class="chip ' + (OG.lb.mode === 'sheet' ? 'on' : '') + '" data-act="lb-mode" data-k="sheet">' +
      t('hw_sheet') + '</button>' +
  '</div></div>';

  /* Which symbology goes on our own stock. */
  h += '<div class="lb-group"><span class="lbl">' + t('hw_symbology') + '</span><div class="chip-row">' +
    '<button class="chip ' + (OG.lb.sym === 'c128' ? 'on' : '') + '" data-act="lb-sym" data-k="c128">' +
      'Code 128 · SKU</button>' +
    '<button class="chip ' + (OG.lb.sym === 'ean13' ? 'on' : '') + '" data-act="lb-sym" data-k="ean13">' +
      'EAN-13</button>' +
  '</div></div>';

  var tpl = LABEL_TEMPLATES[OG.lb.template];
  h += '<div class="lb-group"><span class="lbl">' + t('lb_show') + '</span><div class="chip-row">';
  [['barcode', 'barcode'], ['qr', 'lb_qr'], ['price', 'price'], ['size2', 'size'], ['shelf', 'shelf'], ['logo', 'lb_logo']]
    .forEach(function (pair) {
      var field = pair[0];
      var allowed = field === 'size2' ? tpl.size : (field === 'qr' ? tpl.qr : tpl[field]);
      if (!allowed) return;
      h += '<button class="chip ' + (OG.lb[field] ? 'on' : '') + '" data-act="lb-toggle" data-k="' + field + '">' +
        t(pair[1]) + '</button>';
    });
  h += '</div></div>';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_copies') + '</span>' +
    '<input class="inp num" type="number" min="1" max="24" value="' + OG.lb.max + '" data-change="lb-max" style="width:96px">' +
    '<span class="muted small" style="margin-inline-start:10px">' + t('lb_copies_hint') + '</span></div>';

  /* Whether the barcode actually fits this roll, said before the roll is
     spent rather than after a scanner refuses the stickers. */
  if (OG.lb.barcode && LABEL_TEMPLATES[OG.lb.template].barcode) {
    var dim = labelDim();
    var probe = labelRows()[0];
    var bad = labelFitWarnings();
    if (bad.length) {
      h += '<div class="partner-note note-danger lb-fit">' +
        t('lb_fit_warn').replace('{n}', bad.length)
                        .replace('{mm}', (Math.round(bad[0].mm * 100) / 100)) + '</div>';
    } else if (probe) {
      var f = fitBarcode(OG.lb.sym === 'ean13' ? probe.code : probe.sku, dim, OG.lb.sym);
      if (f) {
        h += '<div class="partner-note note-ok lb-fit">' +
          t('lb_fit_ok').replace('{mm}', (Math.round(f.moduleMm * 100) / 100)) + '</div>';
      }
    }
  }

  if (!LABEL_TEMPLATES[OG.lb.template].price) {
    h += '<div class="partner-note lb-fit">' + t('lb_no_price_note') + '</div>';
  }

  return h + '</div>';
}

function openLabelSheet(pid) {
  OG.lb.pid = pid || null;
  if (pid) OG.lb.pids = null;              // a single product overrides a bulk selection
  var s = labelSheetHTML();
  if (!s.count) { toast(t('label_sheet'), t('lb_nothing'), 'warn'); return; }

  openModal({
    title: t('lb_studio'),
    size: 'wide',
    body: labelControls() +
      '<div class="lb-preview-head no-print"><span class="eyebrow">' + t('lb_sheet') + '</span>' +
        '<span class="badge accent">' + s.count + ' ' + t('lb_labels') + '</span>' +
        '<span class="badge neutral">' + t('lb_scannable') + '</span></div>' +
      '<div id="lbSheet">' + s.html + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-primary" data-act="print-now">' + t('print') + '</button>'
  });
}

/* Re-render the sheet in place so the controls keep their scroll position. */
function repaintLabels() {
  var host = document.getElementById('lbSheet');
  if (!host) return;
  var s = labelSheetHTML();
  host.innerHTML = s.html;
  var ctrl = document.querySelector('.lb-controls');
  if (ctrl) ctrl.outerHTML = labelControls();
  var badge = document.querySelector('.lb-preview-head .badge.accent');
  if (badge) badge.textContent = s.count + ' ' + t('lb_labels');
}

/* ------------------------------------------------------------- 10. CUSTOMERS */

/* The filtered customer list, shared by the view and by bulk select-all so
   "select all" can never grab more than the filter is showing. */
function customerRows() {
  var f = OG.cust;
  var list = DB.customers.filter(function (c) { return f.filter === 'archived' ? c.archived : !c.archived; });
  if (f.filter === 'risk') list = list.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) >= 90; });
  if (f.filter === 'gold') list = list.filter(function (c) { return DB.tier(c.loyaltyPoints) === 'gold'; });
  if (f.q) {
    var q = f.q.toLowerCase();
    list = list.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
    });
  }
  return list.sort(function (a, b) { return b.totalSpent - a.totalSpent; });
}

function viewCustomers() {
  var list = customerRows();
  var risk = DB.inactiveCustomers(90).length;

  var h = '<div class="page-head"><div><h1>' + t('customers_title') + '</h1>' +
    '<div class="sub">' + t('customers_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge critical">' + risk + ' ' + t('at_risk') + '</span>' +
      (allow('customer.write')
        ? '<button class="btn btn-primary btn-sm" data-act="cu-new">+ ' + t('cu_new') + '</button>'
        : '') +
      exportButtons() +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.cust.q) + '" data-change="cust-q">' +
    '<div class="chip-row">' +
      '<button class="chip ' + (OG.cust.filter === 'all' ? 'on' : '') + '" data-act="cust-filter" data-f="all">' + t('all_customers') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'risk' ? 'on' : '') + '" data-act="cust-filter" data-f="risk">' + t('risk_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'gold' ? 'on' : '') + '" data-act="cust-filter" data-f="gold">' + t('gold_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'archived' ? 'on' : '') + '" data-act="cust-filter" data-f="archived">' + t('bk_archived_only') + '</button>' +
    '</div>' +
    '<span class="badge neutral">' + list.length + ' / ' + DB.customers.length + '</span></div>';

  h += '<div class="cust-grid">';
  list.forEach(function (c, ci) {
    var since = DB.daysSince(c.lastPurchaseDate);
    var atRisk = since >= 90;
    var tier = DB.tier(c.loyaltyPoints);
    h += '<div class="cust-card' + (atRisk ? ' risk' : '') + (Bulk.has('customers', c.id) ? ' bk-on' : '') +
         '" data-act="open-customer" data-id="' + c.id + '">' +
      '<span class="bk-corner">' + Bulk.box('customers', c.id, ci) + '</span>' +
      '<div class="cc-top"><span class="cc-av">' + esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
        '<small class="num">' + tel(c.phone) + '</small>' +
        '<small>' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</small></div>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span>' +
      '</div>' +
      '<div class="cc-stats">' +
        '<div><span class="eyebrow">' + t('total_spent') + '</span><b>' + moneyShort(c.totalSpent) + '</b></div>' +
        '<div><span class="eyebrow">' + t('loyalty') + '</span><b>' + nf(c.loyaltyPoints) + '</b></div>' +
        '<div><span class="eyebrow">' + t('orders') + '</span><b>' + c.history.length + '</b></div>' +
        '<div><span class="eyebrow">' + t('last_purchase') + '</span><b style="font-size:11.5px;font-weight:700">' + relDate(c.lastPurchaseDate) + '</b></div>' +
      '</div>' +
      (atRisk
        ? '<div style="display:flex;gap:6px;align-items:center">' +
            '<span class="badge critical">' + t('at_risk') + '</span>' +
            '<button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>' +
          '</div>'
        : '') +
    '</div>';
  });
  h += '</div>';
  return h;
}

function openCustomerDrawer(cid) {
  var c = DB.customer(cid);
  if (!c) return;
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
    .sort(function (a, b) { return b.date - a.date; });

  /* Infer the sizes this customer actually buys, split by category family. */
  var sizeCount = {};
  invoices.forEach(function (s) {
    s.items.forEach(function (it) {
      var fam = (it.type === 'sneakers' || it.type === 'boots' || it.type === 'crocs') ? 'Footwear'
              : (it.type === 'jeans' ? 'Jeans' : 'Tops');
      sizeCount[fam] = sizeCount[fam] || {};
      sizeCount[fam][it.size] = (sizeCount[fam][it.size] || 0) + it.qty;
    });
  });

  var tier = DB.tier(c.loyaltyPoints);
  var since = DB.daysSince(c.lastPurchaseDate);

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      '<span class="cc-av" style="width:52px;height:52px;font-size:18px">' +
        esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
      '<div><span class="eyebrow">' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</span>' +
        '<h3 style="font-size:19px;margin:3px 0 5px">' + esc(c.name) + '</h3>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span> ' +
        (since >= 90 ? '<span class="badge critical">' + t('at_risk') + '</span>' : '') +
        ' <span class="badge neutral num">' + tel(c.phone) + '</span></div>' +
    '</div>';

  var body = '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    '<div class="stat"><span class="eyebrow">' + t('total_spent') + '</span><div class="val">' + moneyShort(c.totalSpent) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('loyalty') + '</span><div class="val accent">' + nf(c.loyaltyPoints) + '</div>' +
      '<div class="foot">= ' + money(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_purchase') + '</span><div class="val" style="font-size:15px">' + relDate(c.lastPurchaseDate) + '</div>' +
      '<div class="foot">' + fmtDate(c.lastPurchaseDate) + '</div></div>' +
  '</div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('preferred_sizes') + '</h3>' +
    '<div class="card-actions muted small">' + (OG.lang === 'ar' ? 'مستنتجة من المشتريات' : 'inferred from purchases') + '</div></div><div class="card-body">';
  var fams = Object.keys(sizeCount);
  if (fams.length) {
    body += '<div style="display:flex;gap:18px;flex-wrap:wrap">';
    fams.forEach(function (f) {
      var best = Object.keys(sizeCount[f]).sort(function (a, b) { return sizeCount[f][b] - sizeCount[f][a]; })[0];
      body += '<div><span class="eyebrow">' + f + '</span>' +
        '<div class="strong-num" style="font-size:24px">' + best + '</div>' +
        '<small class="muted">' + sizeCount[f][best] + ' ' + t('units').toLowerCase() + '</small></div>';
    });
    body += '</div>';
  } else {
    body += '<span class="muted">' + t('none') + '</span>';
  }
  body += '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('purchase_history') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + invoices.length + '</span></div></div>' +
    '<div class="table-wrap" style="max-height:250px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('date') + '</th><th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
  invoices.forEach(function (s) {
    body += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td><td class="muted num">' + fmtDate(s.date) + '</td>' +
      '<td class="muted">' + s.items.map(function (i) { return esc(i.name) + ' (' + i.size + ')'; }).join(', ').slice(0, 46) + '</td>' +
      '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
  });
  body += '</tbody></table></div></div>';

  body += '<div class="card"><div class="card-head"><h3>' + t('points_timeline') + '</h3></div><div class="card-body">' +
    '<ul class="timeline" style="margin:0;padding-inline-start:14px">';
  invoices.slice(0, 6).forEach(function (s) {
    body += '<li class="plus"><b>+' + nf(s.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000) + ' ' + t('points') + '</b>' +
      '<small>' + s.id + ' · ' + fmtDate(s.date) + ' · ' + money(s.total) + '</small></li>';
  });
  body += '</ul></div></div>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="pdf" data-id="' + c.id + '">' + t('rec_statement') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="excel" data-id="' + c.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  if (since >= 90) {
    body += '<button class="btn btn-primary btn-block btn-lg mt" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>';
  }

  openDrawer({ head: head, body: body });
}

/* Routed through the WA layer so the Send button opens a real conversation
   instead of raising a toast and discarding the message. */
function openWhatsapp(cid) {
  var c = DB.customer(cid);
  WA.compose({
    title: t('whatsapp_msg') + ' · ' + esc(c.name),
    to: c.phone,
    name: c.name,
    kind: 'winback',
    text: WA.templates.winback(c),
    note: OG.lang === 'ar'
      ? 'آخر شراء: ' + relDate(c.lastPurchaseDate) + ' · إجمالي الإنفاق ' + money(c.totalSpent)
      : 'Last purchase ' + relDate(c.lastPurchaseDate) + ' · lifetime ' + money(c.totalSpent)
  });
}

/* -------------------------------------------------- DUPLICATE PRODUCT GUARD
   Shown before a near-identical product is created. It offers the useful
   action first — open the one that already exists and add stock to it —
   because that is almost always what he actually meant to do. */
function openDuplicateGuard(name, dupes) {
  var h = '<div class="yl-block" style="margin-bottom:14px">' +
    '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
      '<path d="M12 8v5M12 16h.01M10.3 3.9L2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z"/>' +
    '</svg></span>' +
    '<span class="yb-txt"><b>' + t('dup_head') + '</b>' +
      '<small>' + t('dup_sub') + '</small></span></div>';

  h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('product') + '</th><th class="num">' + t('in_stock') + '</th>' +
    '<th class="num">' + t('price') + '</th><th class="num">' + t('dup_match') + '</th><th></th>' +
  '</tr></thead><tbody>';
  dupes.slice(0, 5).forEach(function (d) {
    var p = d.product;
    h += '<tr><td><div class="cell-prod">' + thumb(p) +
        '<span><b>' + esc(p.name) + '</b><small>' + esc(p.brand) + ' · ' + esc(p.colorway) + '</small></span></div></td>' +
      '<td class="num">' + healthBadge(DB.totalQty(p.id)) + ' ' + DB.totalQty(p.id) + '</td>' +
      '<td class="num">' + money(p.sellingPrice) + '</td>' +
      '<td class="num"><b>' + Math.round(d.score * 100) + '%</b></td>' +
      '<td><button class="btn btn-sm btn-primary" data-act="dup-open" data-id="' + p.id + '">' +
        t('dup_use') + '</button></td></tr>';
  });
  h += '</tbody></table></div></div>';

  h += '<div class="partner-note mt">' + t('dup_note').replace('{n}', esc(name)) + '</div>';

  openModal({
    title: t('dup_title'), size: 'wide', body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn" data-act="dup-anyway">' + t('dup_anyway') + '</button>'
  });
}

/* ======================================================== SCAN → PRODUCT
   "when they scan will appear all details from this product, how many exist,
   available sizes" — this is that screen.

   It accepts anything a label can carry: an EAN-13, a SKU, a deep link from a
   QR, or an invoice number. Whatever comes back from the camera is resolved
   here rather than in the scanner, so every entry point behaves identically. */
function resolveScan(raw) {
  var code = String(raw || '').trim();
  if (!code) return null;

  /* A QR on a label or a printed document carries a deep link. */
  var m = /#open\/([a-z]+)\/(.+)$/.exec(code);
  if (m) return { kind: 'route', hash: '#open/' + m[1] + '/' + m[2] };

  var v = DB.variantByBarcode(code);
  if (v) return { kind: 'variant', variant: v };

  v = DB.variantBySku(code);
  if (v) return { kind: 'variant', variant: v };

  /* The numeric code printed under a thermal label's Code128 barcode —
     matching it here is the other half of "scanning must match printing":
     server/lib/catalogue.js's byBarcode() checks the same three fields for
     a real server. */
  v = DB.variantByLabelCode(code);
  if (v) return { kind: 'variant', variant: v };

  var sale = DB.sale(code);
  if (sale) return { kind: 'invoice', sale: sale };

  var job = DB.job(code);
  if (job) return { kind: 'job', job: job };

  /* Bare SKU prefix — the label may have been cropped. */
  var partial = DB.variants.filter(function (x) {
    return x.sku.toLowerCase().indexOf(code.toLowerCase()) === 0;
  })[0];
  if (partial) return { kind: 'variant', variant: partial };

  return null;
}

/* A scanned code that matches nothing — printing a code the till can't
   resolve is the worst failure here, it stops a sale with a customer
   standing there. Rather than a dead-end error, offer to attach the code
   to whichever product it actually belongs to (a supplier barcode typed by
   hand, or a label whose code was never recorded). */
function attachResultsHTML(q, code) {
  var query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return '<p class="small muted">' + t('lbl_attach_search') + '</p>';
  var hits = DB.variants.filter(function (v) {
    var p = DB.product(v.productId);
    return p && (p.name.toLowerCase().indexOf(query) > -1 || v.sku.toLowerCase().indexOf(query) > -1);
  }).slice(0, 12);
  if (!hits.length) return '<p class="small muted">' + t('none') + '</p>';
  return hits.map(function (v) {
    var p = DB.product(v.productId);
    return '<div class="rule-row"><div class="rr-txt"><b>' + esc(p.name) + '</b>' +
      '<small>' + esc(v.sku) + ' · ' + t('size') + ' ' + esc(v.size) + '</small></div>' +
      '<button class="btn btn-sm btn-primary" data-act="variant-attach-save" data-sku="' + esc(v.sku) +
        '" data-code="' + esc(code) + '">' + t('lbl_attach_save') + '</button></div>';
  }).join('');
}

function openUnknownCodeModal(code) {
  openModal({
    title: t('lbl_unknown_code'),
    body: '<p class="num" style="margin-top:0">' + esc(code) + '</p>' +
      '<label class="field"><span>' + t('lbl_attach_code') + '</span>' +
      '<input class="inp" id="attachSearchInp" data-change="attach-search" placeholder="' + esc(t('lbl_attach_search')) + '" autocomplete="off"></label>' +
      '<div id="attachSearchResults" data-code="' + esc(code) + '">' + attachResultsHTML('', code) + '</div>',
    foot: '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>'
  });
  setTimeout(function () { var el = document.getElementById('attachSearchInp'); if (el) el.focus(); }, 60);
}

/* The product sheet a scan lands on: the size that was scanned, every other
   size with its stock, where each one sits, and what to do next. */
function openScanResult(raw) {
  var found = resolveScan(raw);

  if (!found) {
    openUnknownCodeModal(String(raw).slice(0, 40));
    return;
  }
  if (found.kind === 'route')   { handleDeepLink(found.hash); return; }
  if (found.kind === 'invoice') { openInvoice(found.sale); return; }
  if (found.kind === 'job')     { openJobDrawer(found.job.id); return; }

  var v = found.variant;
  var p = DB.product(v.productId);
  var vs = DB.variantsOf(p.id);
  var total = DB.totalQty(p.id);
  var gaps = DB.sizeGaps(p.id);
  var rate = DB.weeklyRate(p.id, v.size);
  var cover = DB.daysOfCover(v);

  /* thumbBox, not thumb: a two-letter chip cannot tell two similar shoes
     apart, and the first question with a box in hand is "is this the right
     one?". thumbBox already shows the uploaded photo when there is one and
     falls back to the colour block when there is not. */
  var h = '<div class="sc-hit">' +
    thumbBox(p, 'sc-photo') +
    '<div class="sc-hit-txt"><b>' + esc(p.name) + '</b>' +
      '<span>' + esc(p.brand) + ' · ' + DB.typeLabels[p.type] + ' · ' + esc(p.colorway) + '</span>' +
      '<span class="num">' + esc(v.barcode) + '</span>' +
      '<span class="num sc-sku">' + esc(v.sku) + '</span></div>' +
    healthBadge(v.qty) +
  '</div>';

  /* The scanned size first and loudest — that is the one in his hand. */
  h += '<div class="grid mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('sc_this_size') + '</span>' +
      '<div class="val accent">' + v.size + '</div>' +
      '<div class="foot">' + v.qty + ' ' + t('in_stock') + ' · ' + esc(v.shelf) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('total_stock') + '</span>' +
      '<div class="val">' + nf(total) + '</div>' +
      '<div class="foot">' + vs.length + ' ' + t('sizes').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('price') + '</span>' +
      '<div class="val">' + moneyStat(p.sellingPrice) + '</div>' +
      '<div class="foot">' + t('margin') + ' ' +
        pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) + '</div></div>' +
  '</div>';

  /* How this size is actually moving. cover and rate were already computed
     above and then thrown away unless cover < 21 — which meant the sheet went
     quiet exactly when the news was good. Both are now always shown. */
  var lastSold = DB.lastSoldFor(p.id, v.size);
  h += '<div class="grid mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('sc_sells') + '</span>' +
      '<div class="val" style="font-size:20px">' +
        (rate > 0 ? (Math.round(rate * 10) / 10) + '<span class="cur">/' + t('po_week') + '</span>' : '—') +
      '</div><div class="foot">' + t('sc_last_8w') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('sc_cover') + '</span>' +
      '<div class="val' + (cover !== Infinity && cover < 21 ? ' warn' : '') + '" style="font-size:20px">' +
        coverText(cover) +
      '</div><div class="foot">' + (cover === Infinity ? t('sc_not_moving') : t('sc_at_this_rate')) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_sold') + '</span>' +
      '<div class="val" style="font-size:20px">' +
        /* A dash, never "today" — a size that has never sold must not be
           mistaken for one that sold this morning. */
        (lastSold ? relDate(lastSold) : '—') +
      '</div><div class="foot">' + (lastSold ? fmtDate(lastSold) : t('sc_never_sold')) + '</div></div>' +
  '</div>';

  if (cover !== Infinity && cover < 21) {
    h += '<div class="yl-block mt"><span class="yb-txt"><b>' +
      t('sc_running_out').replace('{d}', cover) + '</b><small>' +
      (Math.round(rate * 10) / 10) + ' ' + t('sc_per_week') + '</small></span>' +
      '<button class="btn btn-sm btn-primary" data-act="reorder" data-id="' + p.id + '">' +
        t('reorder') + '</button></div>';
  }

  /* Every size, so he can answer "do you have it in 43?" without walking. */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_all_sizes') + '</h3>' +
    (gaps.length ? '<div class="card-actions"><span class="badge critical">' +
       t('size_gap') + ': ' + gaps.join(', ') + '</span></div>' : '') + '</div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('wh_split_hint') + '</th>' +
      '<th>' + t('shelf') + '</th><th>' + t('health') + '</th><th class="num">' + t('po_rate') + '</th>' +
    '</tr></thead><tbody>';
  vs.forEach(function (x) {
    var xr = DB.weeklyRate(p.id, x.size);
    h += '<tr' + (x.sku === v.sku ? ' class="sc-row-on"' : '') + '>' +
      '<td><b>' + x.size + '</b>' + (x.sku === v.sku ? ' <span class="badge accent">' + t('sc_scanned') + '</span>' : '') + '</td>' +
      '<td class="num"><b>' + x.qty + '</b></td>' +
      /* Split by place, because "we have 8" is useless if all 8 are in the
         back and the customer is standing at the shelf. */
      '<td class="num">' + DB.stockAt(x, 'floor') + ' / ' + DB.stockAt(x, 'store') + '</td>' +
      '<td class="muted">' + esc(x.shelf) + '</td>' +
      '<td>' + healthBadge(x.qty) + '</td>' +
      '<td class="num muted">' + (xr > 0 ? (Math.round(xr * 10) / 10) + '/' + t('po_week') : '—') + '</td>' +
    '</tr>';
  });
  h += '</tbody></table></div></div>';

  /* ---- where it comes from ----------------------------------------------
     Deliberately below the size table rather than beside the selling price:
     this card carries the COST, and a glance at the top of the sheet across
     the counter should not tell a customer what the shoe cost. */
  var sup = DB.supplierFor(p);
  var deliv = DB.lastDelivery(p.id);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_sourcing') + '</h3>' +
    '<div class="card-actions muted small">' + esc(p.madeIn) + '</div></div>' +
    '<div class="card-body"><div class="sc-src">' +
      '<div><span class="eyebrow">' + t('supplier') + '</span>' +
        '<b>' + esc(sup ? sup.name : '—') + '</b>' +
        '<small class="muted num">' + esc(sup ? sup.contact : '') + '</small></div>' +
      '<div><span class="eyebrow">' + t('cost') + '</span>' +
        '<b>' + money(p.costPrice) + '</b>' +
        '<small class="muted">' + t('margin') + ' ' + money(p.sellingPrice - p.costPrice) + '</small></div>' +
      '<div><span class="eyebrow">' + t('sc_last_delivery') + '</span>' +
        '<b>' + (deliv ? fmtDate(deliv.date) : '—') + '</b>' +
        '<small class="muted">' + (deliv
          ? '+' + deliv.delta + ' · ' + esc(DB.whName(deliv.wh, OG.lang === 'ar'))
          : t('sc_no_delivery')) + '</small></div>' +
    '</div></div></div>';

  /* ---- where the pieces went --------------------------------------------
     The same audited log every sale, delivery and transfer writes to, so it
     cannot disagree with the stock figure above it. This is the card that
     answers "where did the other three go?" while the box is still in hand. */
  var moves = DB.movementsFor(v.sku, 4);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_recent_moves') + '</h3>' +
    '<div class="card-actions muted small">' + esc(v.sku) + '</div></div>';
  if (!moves.length) {
    h += '<div class="card-body"><span class="muted small">' + t('sc_no_moves') + '</span></div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('date') + '</th><th>' + t('movement') + '</th>' +
      '<th>' + t('wh_location') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('balance') + '</th><th>' + t('by') + '</th>' +
    '</tr></thead><tbody>';
    moves.forEach(function (mv) {
      h += '<tr>' +
        '<td class="nowrap muted num">' + fmtDate(mv.date) + '</td>' +
        '<td><span class="badge ' + (mv.delta > 0 ? 'healthy' : (mv.type === 'damaged' ? 'critical' : 'neutral')) +
          '">' + t(mv.type) + '</span></td>' +
        '<td>' + (mv.wh ? esc(DB.whName(mv.wh, OG.lang === 'ar')) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num"><span class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' +
          (mv.delta > 0 ? '+' : '') + mv.delta + '</span></td>' +
        '<td class="num"><b>' + mv.balance + '</b></td>' +
        '<td class="muted small">' + esc(mv.user) + '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  /* ---- what to do with the thing now that it is in your hand -------------
     Every scan lands here, so this row is the whole point of owning a
     scanner: put it away, take it out, or sell it. Check in and check out go
     through DB.moveStock — the same audited path the warehouse uses — so a
     hardware scan can never become a second way to change stock. */
  h += '<div class="card mt sc-do"><div class="card-head"><h3>' + t('sc_what_now') + '</h3>' +
    '<div class="card-actions muted small">' + esc(v.sku) + '</div></div><div class="card-body">' +
    '<div class="sc-qty">' +
      '<span class="lbl">' + t('qty') + '</span>' +
      '<button class="btn btn-ghost sc-step" data-act="sc-qty" data-d="-1">−</button>' +
      '<input class="inp num" id="scQty" type="number" min="1" value="1">' +
      '<button class="btn btn-ghost sc-step" data-act="sc-qty" data-d="1">+</button>' +
      '<select class="inp" id="scPlace">' +
        DB.warehouses.map(function (w) {
          return '<option value="' + w.id + '"' + (w.id === DB.defaultWh ? ' selected' : '') + '>' +
            esc(DB.whName(w.id, OG.lang === 'ar')) + ' · ' + DB.stockAt(v, w.id) + '</option>';
        }).join('') +
      '</select>' +
    '</div>' +
    /* Hint above the buttons, not below: the action row is the last thing in
       a scrolling modal, so anything after it lands on the fold and reads as
       clipped. */
    '<div class="partner-note mb">' + t('sc_enter_hint') + '</div>' +
    '<div class="sc-acts">' +
      '<button class="btn btn-ghost btn-lg" data-act="sc-out" data-sku="' + esc(v.sku) + '">' +
        t('sc_check_out') + '</button>' +
      '<button class="btn btn-ghost btn-lg" data-act="sc-in" data-sku="' + esc(v.sku) + '">' +
        t('sc_check_in') + '</button>' +
      '<button class="btn btn-primary btn-lg" id="scPrimary" data-act="scan-to-pos" data-code="' +
        esc(v.barcode) + '">' + t('sc_sell') + ' <span class="keycap">↵</span></button>' +
    '</div>' +
  '</div></div>';

  openModal({
    title: t('sc_found_title'),
    size: 'wide sc-modal',
    body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-ghost" data-act="labels-for" data-id="' + p.id + '">' + t('print_labels') + '</button>' +
          '<button class="btn btn-ghost" data-act="scan-open">' + t('sc_again') + '</button>',
    onOpen: function () {
      /* Focused on open so Enter completes the sale without a mouse. Always
         showing the sheet costs a tap at the till; this is what buys it back —
         scan, Enter, done, with the detail still there if it is wanted. */
      var b = document.getElementById('scPrimary');
      if (b) b.focus();
    }
  });
}

/* Days of cover, in the unit a shop owner actually thinks in.
   ---------------------------------------------------------------------------
   The raw figure for a slow size comes out as "252 d", which is arithmetically
   right and useless: nobody plans in 252 days, and next to a "Low" badge it
   just reads as noise. Under two months it stays in days, because that is when
   the number is actionable. Past a year it stops pretending to be a forecast —
   a size selling a quarter of a pair a week is not covered for 3 years, it is
   simply not selling. */
function coverText(days) {
  if (days === Infinity) return '—';
  if (days < 60) return days + '<span class="cur">' + t('yl_d') + '</span>';
  if (days < 365) return Math.round(days / 30) + '<span class="cur">' + t('sc_months') + '</span>';
  return '<span style="font-size:15px">' + t('sc_over_a_year') + '</span>';
}

/* How many the scan sheet is acting on. */
function scanQty() {
  var el = document.getElementById('scQty');
  var n = Math.max(1, parseInt(el && el.value, 10) || 1);
  return n;
}
function scanPlace() {
  var el = document.getElementById('scPlace');
  return (el && el.value) || DB.defaultWh;
}

/* ------------------------------------------------------------ REORDER
   The old Reorder button toasted "→ Karam Trading" and created nothing.

   It now opens the order it was pretending to place, pre-filled from real
   sales speed: how many of this exact size sell per week, how many days of
   cover are left, and a quantity that covers the next four weeks. He can
   change any of it — the point is that he does not have to start from zero
   and guess, which is the thing he does on paper today. */
function openReorder(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var vs = DB.variantsOf(pid);
  var sup = DB.supplierFor(p);

  var h = '<div class="field"><span class="lbl">' + t('supplier') + '</span>' +
    '<select class="inp" id="poSupplier">' +
      DB.suppliers.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === sup.id ? ' selected' : '') + '>' +
               esc(s.name) + ' · ' + esc(s.category) + '</option>';
      }).join('') + '</select></div>';

  h += '<div class="table-wrap mt"><table class="tbl po-tbl"><thead><tr>' +
    '<th>' + t('size') + '</th><th class="num">' + t('in_stock') + '</th>' +
    '<th class="num">' + t('po_rate') + '</th><th class="num">' + t('po_cover') + '</th>' +
    '<th class="num">' + t('po_order') + '</th>' +
  '</tr></thead><tbody>';

  var sug = {}, total = 0;
  DB.reorderSuggestions().forEach(function (s) { if (s.productId === pid) sug[s.size] = s; });

  vs.forEach(function (v) {
    var s = sug[v.size];
    var rate = DB.weeklyRate(pid, v.size);
    var cover = DB.daysOfCover(v);
    var qty = s ? s.qty : 0;
    total += qty * p.costPrice;

    h += '<tr' + (v.qty === 0 ? ' class="row-late"' : '') + '>' +
      '<td><b>' + v.size + '</b></td>' +
      '<td class="num">' + healthBadge(v.qty) + ' ' + v.qty + '</td>' +
      '<td class="num muted">' + (rate > 0 ? (Math.round(rate * 10) / 10) + '/' + t('po_week') : '—') + '</td>' +
      '<td class="num ' + (cover < 14 ? 'po-urgent' : 'muted') + '">' +
        (cover === Infinity ? t('po_no_sales') : cover + t('yl_d')) + '</td>' +
      '<td class="num"><input class="inp num po-qty" type="number" min="0" value="' + qty + '" ' +
        'data-po-qty="1" data-pid="' + pid + '" data-size="' + v.size + '"></td></tr>';
  });

  h += '</tbody></table></div>' +
    '<div class="partner-note mt">' + t('po_explain') + '</div>';

  openModal({
    title: t('reorder') + ' · ' + esc(p.name),
    size: 'wide',
    body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="po-create" data-id="' + pid + '">' +
            t('po_place') + '</button>'
  });
}

/* One tap at closing time: the whole day as a message he can send to himself
   or a partner. Defaults to the shop's own number so it is one tap, not two. */
function openDaySummary() {
  var d = WA.dayStats();
  WA.compose({
    title: t('wa_day_title'),
    to: CONFIG.SHOP_PHONE,
    name: CONFIG.SHOP_NAME,
    kind: 'daily',
    text: WA.dayText(),
    note: d.count
      ? (d.count + ' ' + t('invoices').toLowerCase() + ' · ' + money(d.total))
      : t('wa_day_empty')
  });
}

/* ------------------------------------------------------------ 11. PRINT JOBS */

function viewPrint() {
  /* Partner mode is routed at the shell level in render(), not here. */
  var jobs = DB.printJobs;
  var thisMonth = jobs.filter(function (j) { return new Date(j.created).getMonth() === TODAY.getMonth(); }).length;
  var overdue = jobs.filter(function (j) { return DB.isOverdue(j); }).length;
  var onTime = Math.round((jobs.length - overdue) / jobs.length * 100);
  var revenue = jobs.reduce(function (a, j) { return a + j.price; }, 0);
  var paid = jobs.reduce(function (a, j) { return a + j.cost; }, 0);

  OG.pr = OG.pr || { tab: 'board' };
  var owed = DB.outstandingTotal();
  var unreadPartner = DB.unreadFor('og').length;

  var h = '<div class="page-head"><div><h1>' + t('print_title') + '</h1>' +
    '<div class="sub">' + t('print_sub') + ' · ' + t('drag_hint') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      (allow('partner.read')
        ? '<button class="btn btn-dark" data-act="partner-view">' + t('partner_view') + '</button>'
        : '') +
    '</div></div>';

  /* Two halves of the same relationship: the work, and the bill for it. */
  h += '<div class="tabs mb">' +
    '<button class="tab' + (OG.pr.tab === 'board' ? ' on' : '') + '" data-act="pr-tab" data-tab="board">' +
      t('print_title') + '</button>' +
    '<button class="tab' + (OG.pr.tab === 'invoices' ? ' on' : '') + '" data-act="pr-tab" data-tab="invoices">' +
      t('og_partner_inv') +
      (owed ? '<span class="tab-dot"></span>' : '') + '</button>' +
  '</div>';

  if (OG.pr.tab === 'invoices') return h + viewPartnerInvoices();

  if (unreadPartner) {
    h += '<div class="yl-block mb">' +
      '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.2A8 8 0 1 1 21 12z"/></svg></span>' +
      '<span class="yb-txt"><b>' + unreadPartner + ' ' + t('og_unread_head') + '</b>' +
        '<small>' + t('og_unread_sub') + '</small></span></div>';
  }

  /* An order sent and never answered is the one way this feature could make
     things worse than the phone call it replaces. Four hours of silence and it
     says so, on the screen where the work lives. */
  var waiting = DB.awaitingResponse(4);
  if (waiting.length) {
    h += '<div class="yl-block note-warn mb">' +
      '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M12 7v5l3 2M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/></svg></span>' +
      '<span class="yb-txt"><b>' + waiting.length + ' ' + t('or_wait_head') + '</b>' +
        '<small>' + t('or_wait_sub') + ' · ' +
          waiting.map(function (j) { return j.id; }).join(', ') + '</small></span></div>';
  }

  h += '<div class="grid mb" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('jobs_month') + '</span><div class="val">' + thisMonth + '</div>' +
      deltaTag(thisMonth, Math.max(1, thisMonth - 2), t('vs_last_month')) + '</div>' +
    '<div class="stat"><span class="eyebrow">' + t('on_time') + '</span><div class="val' + (onTime >= 80 ? ' accent' : '') + '">' + onTime + '%</div>' +
      '<div class="foot">' + overdue + ' ' + t('overdue').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('print_revenue') + '</span><div class="val">' + moneyShort(revenue) + '</div>' +
      '<div class="foot">' + jobs.length + ' ' + t('orders').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span><div class="val">' + moneyShort(paid) + '</div>' +
      '<div class="foot">' + t('profit') + ': ' + moneyShort(revenue - paid) + '</div></div>' +
  '</div>';

  h += '<div class="kanban">';
  DB.printStages.forEach(function (stage) {
    var col = jobs.filter(function (j) { return j.stage === stage; });
    h += '<div class="kcol" data-stage="' + stage + '" data-drop="1">' +
      '<div class="kcol-head"><b>' + t('print_' + stage) + '</b><span class="cnt">' + col.length + '</span></div>' +
      '<div class="kcol-body">';
    col.forEach(function (j) {
      var over = DB.isOverdue(j);
      h += '<div class="kcard' + (over ? ' overdue' : '') + (Bulk.has('jobs', j.id) ? ' bk-on' : '') +
             '" draggable="true" data-id="' + j.id + '" data-act="open-job" data-jid="' + j.id + '">' +
        '<div class="kcard-top"><span class="bk-inline">' + Bulk.box('jobs', j.id) + '</span><b>' + esc(j.customer) + '</b>' +
          (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span>' : '') +
        '</div>' +
        '<div class="note">' + esc(j.design) + '</div>' +
        /* Only in Design, and only when it says something the stepper cannot:
           an accepted job's chip would just repeat the column it is sitting in. */
        (j.stage === 'design'
          ? '<div class="kcard-ord">' + orderChip(j) + '</div>'
          : '') +
        stepper(j.stage, { history: j.history, overdue: over, compact: true }) +
        '<div style="display:flex;gap:6px;align-items:center;font-size:10.5px;margin-top:8px" class="num">' +
          '<span class="badge neutral">' + j.qty + ' pcs</span>' +
          '<span class="' + (over ? 'badge critical' : 'muted') + '">' + (over ? t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd' : relDate(j.deadline)) + '</span>' +
        '</div>' +
        '<div class="kcard-foot"><span class="muted">' + j.id + '</span>' +
          '<span class="money">' + moneyShort(j.price) + ' <span class="cost">/ ' + moneyShort(j.cost) + '</span></span>' +
        '</div>' +
      '</div>';
    });
    h += '</div></div>';
  });
  h += '</div>';

  return h;
}

/* What OG owes Yalla Wear. Reads the same partnerInvoices array the partner
   portal writes to — that shared array IS the integration. */
function viewPartnerInvoices() {
  var owed = DB.outstandingTotal();
  var overdue = DB.partnerInvoices.filter(function (i) { return DB.invoiceOverdue(i); });
  var paidTotal = DB.partnerInvoices.reduce(function (a, i) { return a + DB.invoicePaid(i); }, 0);

  var h = '<div class="grid mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('og_owed_to') + '</span>' +
      '<div class="val' + (owed ? ' warn' : '') + '">' + moneyStat(owed) + '</div>' +
      '<div class="foot">' + (overdue.length
        ? '<span style="color:var(--destructive);font-weight:700">' + overdue.length + ' ' + t('overdue').toLowerCase() + '</span>'
        : CONFIG.PRINT_PARTNER) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('yi_paid') + '</span>' +
      '<div class="val">' + moneyStat(paidTotal) + '</div>' +
      '<div class="foot">' + DB.partnerInvoices.length + ' ' + t('invoices').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span>' +
      '<div class="val">' + moneyStat(DB.printJobs.reduce(function (a, j) { return a + j.cost; }, 0)) + '</div>' +
      '<div class="foot">' + t('yl_lifetime').toLowerCase() + '</div></div>' +
  '</div>';

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('yi_invoice') + '</th><th>' + t('yi_issued') + '</th><th>' + t('yi_due') + '</th>' +
    '<th class="num">' + t('pieces') + '</th><th class="num">' + t('total') + '</th>' +
    '<th class="num">' + t('yi_balance') + '</th><th>' + t('status') + '</th><th></th>' +
  '</tr></thead><tbody>';

  DB.partnerInvoices.slice().sort(function (a, b) {
    return (b.issued || 0) - (a.issued || 0);
  }).forEach(function (inv) {
    var bal = DB.invoiceBalance(inv);
    var st = DB.invoiceStatus(inv);
    /* A draft is the partner's private working copy — OG should not see a
       bill that has not been sent to them. */
    if (st === 'draft') return;
    var cls = st === 'paid' ? 'healthy' : st === 'part' ? 'low' : 'accent';
    if (DB.invoiceOverdue(inv)) cls = 'critical';
    h += '<tr class="clickable' + (DB.invoiceOverdue(inv) ? ' row-late' : '') +
           '" data-act="og-open-inv" data-id="' + inv.id + '">' +
      '<td><b>' + inv.id + '</b></td>' +
      '<td class="muted">' + fmtDate(inv.issued) + '</td>' +
      '<td class="muted">' + fmtDate(inv.due) + '</td>' +
      '<td class="num">' + nf(DB.invoicePieces(inv)) + '</td>' +
      '<td class="num"><b>' + money(DB.invoiceTotal(inv)) + '</b></td>' +
      '<td class="num">' + (bal ? '<b style="color:var(--warning)">' + money(bal) + '</b>' : '—') + '</td>' +
      '<td><span class="badge ' + cls + '">' + t('yi_st_' + st) +
        (DB.invoiceOverdue(inv) ? ' · ' + DB.daysSince(inv.due) + 'd' : '') + '</span></td>' +
      '<td onclick="event.stopPropagation()">' + (bal
        ? '<button class="btn btn-sm btn-primary" data-act="og-pay-inv" data-id="' + inv.id + '">' +
            t('og_pay_now') + '</button>'
        : '') + '</td></tr>';
  });

  return h + '</tbody></table></div>';
}

/* Admin-side job detail. Unlike the partner drawer this shows the full
   commercial picture: who ordered it, what OG charges, what the margin is. */
/* ---- the order handover, OG's side ----------------------------------------
   Four states, and the block says plainly which one it is in. The important
   one is `draft`: until Send is pressed, Yalla Wear does not know this job
   exists, and nothing else on the screen should imply otherwise. */

/* Only the classes the stylesheet actually defines. `tbc` is the amber pill
   already used for "to be confirmed", which is exactly the right feeling for
   an order sitting with somebody else. */
var ORDER_TONE = { draft: 'neutral', pending: 'tbc', accepted: 'healthy', declined: 'critical' };

function orderChip(job) {
  var st = DB.orderState(job);
  return '<span class="badge ' + (ORDER_TONE[st] || 'neutral') + '">' + t('or_' + st) + '</span>';
}

function orderBlock(job) {
  var st = DB.orderState(job);
  var o = DB.order(job);
  var why = DB.canSendOrder(job);

  var h = '<div class="card mb ord-card is-' + st + '"><div class="card-head">' +
    '<h3>' + t('or_state') + '</h3><div class="card-actions">' + orderChip(job) + '</div></div>' +
    '<div class="card-body">';

  if (st === 'draft' || st === 'declined') {
    if (st === 'declined') {
      h += '<div class="yl-block note-danger mb">' +
        '<span class="yb-txt"><b>' + t('or_declined_head') + '</b>' +
        (o.note ? '<small>' + esc(o.note) + '</small>' : '') + '</span></div>';
    }
    if (why === 'tbc') {
      /* Refuse with the reason, not a dead button. An order carrying a shirt
         with no name is one Yalla physically cannot print. */
      h += '<div class="yl-block note-danger"><span class="yb-txt">' +
        '<b>' + t('or_cannot') + '</b><small>' + t('or_why_tbc') + '</small></span></div>';
    } else {
      h += '<button class="btn btn-primary btn-block btn-lg" data-act="or-send" data-id="' + job.id + '">' +
        t(st === 'declined' ? 'or_send_again' : 'or_send') + '</button>';
    }
  } else if (st === 'pending') {
    var mins = o.sentAt ? Math.round((Date.now() - new Date(o.sentAt).getTime()) / 60000) : 0;
    h += '<div class="ord-wait"><span class="ord-dot"></span>' +
      '<b>' + t('or_pending') + '</b>' +
      '<small>' + t('yl_sent_ago') + ' ' + (mins < 60 ? mins + t('yl_m') : Math.round(mins / 60) + t('yl_h')) + '</small></div>';
  } else if (st === 'accepted') {
    h += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">' +
      '<div class="stat"><span class="eyebrow">' + t('or_requested') + '</span>' +
        '<div class="val" style="font-size:15px">' + fmtDate(job.deadline) + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('or_promised') + '</span>' +
        '<div class="val accent" style="font-size:15px">' + fmtDate(DB.promisedDate(job)) + '</div></div>' +
    '</div>';
  }

  h += orderTimeline(job);
  return h + '</div></div>';
}

/* Sent → accepted → printing → delivered, with a stamp on each and the side
   that did it. Built from the order envelope plus the stage history that was
   already being recorded, so it costs nothing to keep and cannot be fudged. */
function orderTimeline(job) {
  var o = DB.order(job);
  var rows = [{ label: t('or_tl_created'), at: job.created, by: 'og' }];

  if (o.sentAt) rows.push({ label: t('or_tl_sent'), at: o.sentAt, by: 'og' });
  if (o.state === 'accepted' && o.respondedAt) {
    rows.push({ label: t('or_tl_accepted'), at: o.respondedAt, by: 'yalla' });
  }
  if (o.state === 'declined' && o.respondedAt) {
    rows.push({ label: t('or_tl_declined'), at: o.respondedAt, by: 'yalla' });
  }
  ['printing', 'delivery', 'done'].forEach(function (s) {
    var at = DB.stageAt(job, s);
    if (at) rows.push({ label: t('print_' + s), at: at, by: 'yalla' });
  });

  if (rows.length < 2) return '';

  var h = '<div class="ord-tl"><div class="lbl">' + t('or_timeline') + '</div>';
  rows.forEach(function (r) {
    h += '<div class="ord-tl-row">' +
      '<span class="ord-tl-dot"></span>' +
      '<span class="ord-tl-txt">' + esc(r.label) + '</span>' +
      '<span class="ord-tl-by">' + t(r.by === 'og' ? 'or_by_og' : 'or_by_yalla') + '</span>' +
      '<span class="ord-tl-at">' + fmtDateTime(r.at) + '</span>' +
    '</div>';
  });
  return h + '</div>';
}

function openJobDrawer(id) {
  var j = DB.printJobs.filter(function (x) { return x.id === id; })[0];
  if (!j) return;
  var over = DB.isOverdue(j);
  var margin = j.price - j.cost;

  var head = '<div style="flex:1">' +
    '<span class="eyebrow">' + t('print_job') + ' · ' + j.id + '</span>' +
    '<h3 style="font-size:19px;margin:4px 0 7px">' + esc(j.customer) + '</h3>' +
    (j.priority === 'urgent' ? '<span class="badge urgent">' + t('urgent') + '</span> ' : '') +
    (over ? '<span class="badge critical">' + t('overdue') + '</span> ' : '') +
    '<span class="badge neutral num">' + tel(j.phone) + '</span></div>';

  /* The handover sits above the progress bar, because until Yalla Wear has
     accepted, the stage tracker is describing something that has not started. */
  var body = orderBlock(j);

  body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_progress') + '</h3>' +
    '<div class="card-actions muted small">' + (over
      ? '<span style="color:var(--destructive);font-weight:700">' + t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd</span>'
      : t('deadline') + ' ' + relDate(j.deadline)) + '</div></div>' +
    '<div class="card-body">' + stepper(j.stage, { history: j.history, overdue: over }) + '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('design_note') + '</h3></div>' +
    '<div class="card-body"><p style="margin:0;font-size:14px;line-height:1.6">' + esc(j.design) + '</p></div></div>';

  /* A kit job shows its print list, editable. This is OG's half of the
     confirmation loop — the only place a missing name can be filled in,
     because OG is the one holding the customer's phone number. */
  if (j.kind === 'kit' && j.lines) {
    var tbc = DB.tbcCount(j);
    body += '<div class="card mb"><div class="card-head"><h3>' + t('og_kit_lines') + '</h3>' +
      '<div class="card-actions">' +
        (tbc ? '<span class="badge tbc">' + tbc + ' ' + t('yl_tbc') + '</span> ' : '') +
        '<span class="badge accent">' + j.qty + ' ' + t('pieces') + '</span></div></div>';

    if (tbc) {
      body += '<div class="yl-block" style="margin:0 16px 12px">' +
        '<span class="yb-txt"><b>' + tbc + ' ' + t('og_tbc_warn') + '</b></span></div>';
    }

    body += '<div class="table-wrap"><table class="tbl yl-kits og-kits"><thead><tr>' +
        '<th class="num">#</th><th>' + t('yl_kit') + '</th><th>' + t('yl_print') + '</th>' +
        '<th class="num">' + t('yi_number') + '</th><th>' + t('size') + '</th><th class="num">' + t('qty') + '</th>' +
      '</tr></thead><tbody>';
    j.lines.forEach(function (l, i) {
      body += '<tr' + (l.print ? '' : ' class="is-tbc"') + '>' +
        '<td class="num muted">' + pad(i + 1, 2) + '</td>' +
        '<td><b>' + esc(l.club) + '</b><small class="ar">' + esc(l.clubAr) + '</small></td>' +
        '<td><input class="inp" type="text" value="' + esc(l.print || '') +
          '" placeholder="' + esc(t('yl_to_confirm')) + '" ' +
          'data-og-line="print" data-jid="' + j.id + '" data-lid="' + l.id + '"></td>' +
        '<td><input class="inp num" type="number" min="0" max="99" style="width:62px" value="' +
          esc(l.number === null ? '' : l.number) + '" placeholder="—" ' +
          'data-og-line="number" data-jid="' + j.id + '" data-lid="' + l.id + '"></td>' +
        '<td><span class="yl-size"><b>' + esc(l.size) + '</b></span></td>' +
        '<td class="num">×' + l.qty + '</td></tr>';
    });
    body += '</tbody></table></div>';

    if (tbc) {
      body += '<div class="card-body" style="padding-top:0">' +
        '<button class="btn btn-primary btn-block" data-act="og-confirm-names" data-id="' + j.id + '">' +
          t('og_confirm_names') + '</button></div>';
    }
    body += '</div>';
  } else {
    body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_size_breakdown') + '</h3>' +
      '<div class="card-actions"><span class="badge accent">' + j.qty + '</span></div></div>' +
      '<div class="card-body"><div class="yl-sizes lg">' +
        Object.keys(j.sizes || {}).map(function (k) {
          return '<span class="yl-size"><b>' + k + '</b>' + j.sizes[k] + '</span>';
        }).join('') + '</div></div></div>';
  }

  body += '<div class="grid mb" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="stat"><span class="eyebrow">' + t('yl_charged') + '</span><div class="val">' + moneyStat(j.price) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span><div class="val">' + moneyStat(j.cost) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('profit') + '</span><div class="val accent">' + moneyStat(margin) + '</div>' +
      '<div class="foot">' + pct(margin / j.price * 100, 0) + '</div></div>' +
  '</div>';

  /* The conversation, rendered by the same function the partner portal uses,
     so both sides read an identical thread. */
  if (typeof YALLA !== 'undefined' && YALLA.thread) body += YALLA.thread(j.id, 'og');
  DB.markRead('og', { jobId: j.id });

  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
    '<button class="btn btn-ghost" data-act="og-nudge" data-id="' + j.id + '">' + t('og_nudge') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="job" data-kind="pdf" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
    (allow('partner.read')
      ? '<button class="btn btn-dark" style="flex:1" data-act="partner-view">' + t('partner_view') + '</button>'
      : '') + '</div>';

  openDrawer({ head: head, body: body });
}

/* OG's view of a partner invoice — their bill to pay, so it lives in OG,
   not inside the partner portal. Same document, same numbers. */
function openPartnerInvoice(id) {
  var inv = DB.invoice(id);
  if (!inv || typeof YLINV === 'undefined') return;
  var bal = DB.invoiceBalance(inv);
  DB.markRead('og', { invoiceId: id });

  var foot = '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
    '<button class="btn" data-act="print-now">' + t('print') + '</button>';
  if (bal > 0 && inv.issued) {
    foot += '<button class="btn btn-primary" data-act="og-pay-inv" data-id="' + id + '">' +
      t('og_pay_now') + ' · ' + money(bal) + '</button>';
  }
  openModal({ title: inv.id + ' · ' + CONFIG.PRINT_PARTNER, size: 'wide',
              body: YLINV.sheet(inv, false), foot: foot });
}

/* --------------------------------------------------------------- 12. REPORTS */

function viewReports() {
  var tabs = [['sales', 'tab_sales'], ['profit', 'tab_profit'], ['inventory', 'tab_inventory'],
              ['employees', 'tab_employees'], ['suppliers', 'tab_suppliers']];

  var h = '<div class="page-head"><div><h1>' + t('reports_title') + '</h1>' +
    '<div class="sub">' + t('reports_sub') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
    '</div></div><div class="tabs">';

  tabs.forEach(function (tb) {
    h += '<button class="tab ' + (OG.rep.tab === tb[0] ? 'on' : '') + '" data-act="rep-tab" data-tab="' + tb[0] + '">' + t(tb[1]) + '</button>';
  });
  h += '</div>';

  h += '<div class="card mb"><div class="card-head"><h3>' + t(tabs.filter(function (x) { return x[0] === OG.rep.tab; })[0][1]) + '</h3>' +
    '<div class="card-actions muted small">' + fmtDate(daysAgo(179)) + ' — ' + fmtDate(TODAY) + '</div></div>' +
    '<div class="card-body"><div class="chart-box" style="height:250px"><canvas id="repChart"></canvas></div></div></div>';

  h += repTable();
  return h;
}

function repTable() {
  var h = '<div class="card table-wrap">';

  if (OG.rep.tab === 'sales') {
    var m = DB.monthlySales(6);
    var totalRev = m.reduce(function (a, x) { return a + x.total; }, 0);
    var totalInv = m.reduce(function (a, x) { return a + x.count; }, 0);
    h += '<table class="tbl"><thead><tr><th>Month</th><th class="num">' + t('invoices') + '</th>' +
      '<th class="num">' + t('revenue') + '</th><th class="num">' + t('avg_basket') + '</th><th>' + t('vs_last_month') + '</th></tr></thead><tbody>';
    m.forEach(function (x, i) {
      var prev = i > 0 ? m[i - 1].total : 0;
      var d = prev ? (x.total - prev) / prev * 100 : 0;
      h += '<tr><td><b>' + x.label + ' ' + x.date.getFullYear() + '</b></td>' +
        '<td class="num">' + x.count + '</td>' +
        '<td class="num"><b>' + money(x.total) + '</b></td>' +
        '<td class="num muted">' + money(x.count ? x.total / x.count : 0) + '</td>' +
        '<td><span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + '%</span></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td class="num">' + totalInv + '</td>' +
      '<td class="num">' + money(totalRev) + '</td><td class="num">' + money(totalRev / totalInv) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'profit') {
    var rows = DB.profitByType();
    var tr = rows.reduce(function (a, x) { return a + x.revenue; }, 0);
    var tc = rows.reduce(function (a, x) { return a + x.cost; }, 0);
    h += '<table class="tbl"><thead><tr><th>' + t('type') + '</th><th class="num">' + t('units') + '</th>' +
      '<th class="num">' + t('revenue') + '</th><th class="num">' + t('cost') + '</th>' +
      '<th class="num">' + t('profit') + '</th><th class="num">' + t('margin') + '</th><th style="width:120px"></th></tr></thead><tbody>';
    var best = rows[0] ? rows[0].profit : 1;
    rows.forEach(function (x) {
      h += '<tr><td><b>' + x.label + '</b></td>' +
        '<td class="num">' + nf(x.units) + '</td>' +
        '<td class="num">' + money(x.revenue) + '</td>' +
        '<td class="num muted">' + money(x.cost) + '</td>' +
        '<td class="num"><b>' + money(x.profit) + '</b></td>' +
        '<td class="num">' + pct(x.margin, 1) + '</td>' +
        '<td><div class="bar-track"><i class="lime" style="width:' + Math.max(3, x.profit / best * 100) + '%"></i></div></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td class="num">' + money(tr) + '</td>' +
      '<td class="num">' + money(tc) + '</td><td class="num">' + money(tr - tc) + '</td>' +
      '<td class="num">' + pct((tr - tc) / tr * 100, 1) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'inventory') {
    var inv = DB.inventoryValue();
    var totalCost = inv.reduce(function (a, x) { return a + x.cost; }, 0);
    var totalRetail = inv.reduce(function (a, x) { return a + x.retail; }, 0);
    var totalUnits = inv.reduce(function (a, x) { return a + x.units; }, 0);
    h = '<div class="grid mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="stat"><span class="eyebrow">' + t('capital_in_stock') + '</span>' +
        '<div class="val accent">' + money(totalCost) + '</div>' +
        '<div class="foot">' + nf(totalUnits) + ' ' + t('total_pieces').toLowerCase() + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('retail_value') + '</span><div class="val">' + money(totalRetail) + '</div>' +
        '<div class="foot">' + t('profit') + ' ' + t('if_sold_all') + '</div></div>' +
      '<div class="stat"><span class="eyebrow">' + t('profit') + '</span><div class="val">' + money(totalRetail - totalCost) + '</div>' +
        '<div class="foot">' + pct((totalRetail - totalCost) / totalRetail * 100, 1) + ' ' + t('margin').toLowerCase() + '</div></div>' +
    '</div><div class="card table-wrap">' +
      '<table class="tbl"><thead><tr><th>' + t('type') + '</th><th class="num">' + t('units') + '</th>' +
      '<th class="num">' + t('capital_in_stock') + '</th><th class="num">' + t('retail_value') + '</th>' +
      '<th class="num">' + t('profit') + '</th><th style="width:130px"></th></tr></thead><tbody>';
    inv.forEach(function (x) {
      h += '<tr><td><b>' + x.label + '</b></td><td class="num">' + nf(x.units) + '</td>' +
        '<td class="num"><b>' + money(x.cost) + '</b></td>' +
        '<td class="num muted">' + money(x.retail) + '</td>' +
        '<td class="num">' + money(x.retail - x.cost) + '</td>' +
        '<td><div class="bar-track"><i style="width:' + Math.max(3, x.cost / totalCost * 100) + '%"></i></div></td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td class="num">' + nf(totalUnits) + '</td>' +
      '<td class="num">' + money(totalCost) + '</td><td class="num">' + money(totalRetail) + '</td>' +
      '<td class="num">' + money(totalRetail - totalCost) + '</td><td></td></tr></tfoot></table>';

  } else if (OG.rep.tab === 'employees') {
    h += '<table class="tbl"><thead><tr><th>' + t('name') + '</th><th>' + t('role') + '</th>' +
      '<th class="num">' + t('salary') + '</th><th class="num">' + t('sales_made') + '</th>' +
      '<th>' + t('next_payment') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';
    var totalSal = 0;
    DB.employees.forEach(function (e) {
      totalSal += e.salary;
      h += '<tr><td><div class="cell-prod"><span class="cc-av" style="width:28px;height:28px;font-size:10px">' +
          esc(e.name.split(' ').map(function (w) { return w[0]; }).join('')) + '</span>' +
          '<span><b>' + esc(e.name) + '</b><small>since ' + e.since + '</small></span></div></td>' +
        '<td><span class="badge neutral">' + esc(e.role) + '</span></td>' +
        '<td class="num">' + money(e.salary) + '</td>' +
        '<td class="num"><b>' + (e.sales ? money(e.sales) : '—') + '</b></td>' +
        '<td class="num">' + fmtDate(e.nextPayment) + ' <span class="muted">· ' + relDate(e.nextPayment) + '</span></td>' +
        '<td class="muted num">' + tel(e.phone) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td class="num">' + money(totalSal) + '</td>' +
      '<td class="num">' + money(DB.employees.reduce(function (a, e) { return a + e.sales; }, 0)) + '</td><td></td><td></td></tr></tfoot></table>';

  } else {
    h += '<table class="tbl"><thead><tr><th>' + t('supplier') + '</th><th>' + t('category') + '</th>' +
      '<th class="num">Total purchased</th><th class="num">' + t('outstanding') + '</th>' +
      '<th>' + t('due') + '</th><th>' + t('phone') + '</th></tr></thead><tbody>';
    var totalOut = 0;
    DB.suppliers.forEach(function (s) {
      totalOut += s.outstanding;
      var late = DB.daysSince(s.dueDate) > 0 && s.outstanding > 0;
      var soon = DB.daysSince(s.dueDate) > -5 && s.outstanding > 0;
      h += '<tr><td><b>' + esc(s.name) + '</b></td>' +
        '<td class="muted">' + esc(s.category) + '</td>' +
        '<td class="num muted">' + money(s.totalPurchased) + '</td>' +
        '<td class="num"><b' + (s.outstanding ? '' : ' class="muted"') + '>' + money(s.outstanding) + '</b></td>' +
        '<td>' + (s.outstanding
          ? '<span class="badge ' + (late ? 'critical' : (soon ? 'low' : 'neutral')) + '">' + fmtDate(s.dueDate) + ' · ' + relDate(s.dueDate) + '</span>'
          : '<span class="badge healthy">' + t('none') + '</span>') + '</td>' +
        '<td class="muted num">' + tel(s.contact) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>' + t('total') + '</td><td></td><td></td><td class="num">' + money(totalOut) + '</td><td></td><td></td></tr></tfoot></table>';
  }

  h += '</div>';
  return h;
}

function afterReports() {
  var c = document.getElementById('repChart');
  var f = function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); };
  var conv = function (v) { return OG.currency === 'USD' ? v / CONFIG.EXCHANGE_RATE : v; };

  if (OG.rep.tab === 'sales') {
    var m = DB.monthlySales(6);
    Charts.line(c, m.map(function (x) { return x.label; }), m.map(function (x) { return conv(x.total); }), { fmt: f });
  } else if (OG.rep.tab === 'profit') {
    var rows = DB.profitByType();
    Charts.bars(c, rows.map(function (x) { return x.label; }), rows.map(function (x) { return conv(x.profit); }), { highlight: 0, fmt: f });
  } else if (OG.rep.tab === 'inventory') {
    var inv = DB.inventoryValue();
    Charts.donut(c, inv.map(function (x) { return x.label; }), inv.map(function (x) { return conv(x.cost); }), { fmt: f });
  } else if (OG.rep.tab === 'employees') {
    var e = DB.employees.slice().sort(function (a, b) { return b.sales - a.sales; });
    Charts.bars(c, e.map(function (x) { return x.name.split(' ')[0]; }), e.map(function (x) { return conv(x.sales); }), { highlight: 0, fmt: f });
  } else {
    var s = DB.suppliers.slice().sort(function (a, b) { return b.outstanding - a.outstanding; });
    Charts.bars(c, s.map(function (x) { return x.name.split(' ')[0]; }), s.map(function (x) { return conv(x.outstanding); }), { highlight: 0, fmt: f });
  }
}

/* ------------------------------------------------------------ 13. STOREFRONT */

function storeVisible() { return DB.products.filter(function (p) { return !p.hidden; }); }

function viewStorefront() {
  var visible = storeVisible();
  var hidden = DB.products.length - visible.length;

  var h = '<div class="page-head"><div><h1>' + t('store_title') + '</h1>' +
    '<div class="sub">' + t('store_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge accent">' + visible.length + ' ' + t('products_online') + '</span>' +
      '<span class="badge neutral">' + hidden + ' ' + t('hidden_count') + '</span>' +
      exportButtons() +
    '</div></div>';

  h += '<div class="store-layout">' +
    '<div><div class="eyebrow" style="text-align:center;margin-bottom:8px">' + t('live_shop') + '</div>' +
      '<div class="phone"><div class="phone-notch"><i></i></div>' +
      '<div class="phone-screen" id="phoneScreen">' + storeScreen() + '</div></div>' +
      '<div class="partner-note" style="margin-top:12px">' + t('store_note') + '</div>' +
    '</div>';

  h += '<div><div class="card"><div class="card-head"><h3>' + t('orders_queue') + '</h3>' +
    '<div class="card-actions"><span class="badge critical">' +
      DB.storeOrders.filter(function (o) { return o.status === 'pending'; }).length + ' ' + t('pending').toLowerCase() + '</span></div></div>' +
    '<div id="ordersList">' + ordersList() + '</div></div>';

  h += '<div class="card mt"><div class="card-head"><h3>' + t('visible') + '</h3></div>' +
    '<div class="table-wrap" style="max-height:320px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('product') + '</th><th class="num">' + t('stock') + '</th><th class="num">' + t('price') + '</th><th>' + t('visible') + '</th>' +
    '</tr></thead><tbody>';
  DB.products.forEach(function (p) {
    var q = DB.totalQty(p.id);
    h += '<tr' + (p.hidden ? ' class="muted"' : '') + '>' +
      '<td><div class="cell-prod">' + thumb(p) + '<span><b class="' + (p.hidden ? 'hidden-flag' : '') + '">' + esc(p.name) + '</b>' +
      '<small>' + DB.typeLabels[p.type] + '</small></span></div></td>' +
      '<td class="num">' + q + '</td><td class="num">' + money(p.sellingPrice) + '</td>' +
      '<td><label class="switch"><input type="checkbox"' + (p.hidden ? '' : ' checked') +
        ' data-change="toggle-visible" data-id="' + p.id + '"><i></i></label></td></tr>';
  });
  h += '</tbody></table></div></div></div></div>';

  return h;
}

function ordersList() {
  var h = '';
  DB.storeOrders.forEach(function (o, i) {
    h += '<div class="order-row' + (o.fresh ? ' fresh' : '') + (Bulk.has('orders', o.id) ? ' bk-on' : '') + '">' +
      '<span class="bk-inline">' + Bulk.box('orders', o.id, i) + '</span>' +
      '<span class="cc-av" style="width:30px;height:30px;font-size:11px">' + esc(o.name[0]) + '</span>' +
      '<div style="flex:1;min-width:0"><b>' + esc(o.name) + ' <span class="muted num">· ' + o.id + '</span></b>' +
        '<small>' + esc(o.items) + '</small>' +
        '<small>' + esc(o.city) + ' · ' + DB.payLabel(o.payment) + ' · ' + relDate(o.date) + '</small></div>' +
      '<div class="money">' + money(o.total) +
        '<div>' + (o.status === 'pending'
          ? '<button class="btn btn-sm btn-primary" data-act="order-confirm" data-i="' + i + '">' + t('confirm') + '</button>'
          : '<span class="badge healthy">' + t('confirmed') + '</span>') + '</div>' +
      '</div></div>';
    o.fresh = false;
  });
  return h;
}

function storeScreen() {
  var s = OG.store;
  var cartCount = s.cart.reduce(function (a, x) { return a + x.qty; }, 0);
  var cartTotal = s.cart.reduce(function (a, x) { return a + x.qty * x.price; }, 0);

  var bar = '<div class="st-bar">' +
    (s.screen !== 'grid' ? '<button class="btn btn-sm btn-ghost" data-act="st-back">‹ ' + t('back') + '</button>' : '<b>' + t('shop_all') + '</b>') +
    '<button class="btn btn-sm ' + (cartCount ? 'btn-primary' : 'btn-ghost') + '" data-act="st-cart">' + t('cart') + ' (' + cartCount + ')</button>' +
  '</div>';

  if (s.screen === 'grid') {
    var h = '<div class="st-hero"><div class="brand-mark"><img src="assets/logo.svg" alt="OG"></div><h2>OG STORE</h2><p>' + t('tagline') + '</p></div>' + bar + '<div class="st-grid">';
    storeVisible().forEach(function (p) {
      h += '<div class="st-card" data-act="st-open" data-id="' + p.id + '">' +
        thumbBox(p) +
        '<div class="info"><b>' + esc(p.name) + '</b><span>' + money(p.sellingPrice) + '</span></div></div>';
    });
    return h + '</div>';
  }

  if (s.screen === 'pd') {
    var p = DB.product(s.productId);
    var vs = DB.variantsOf(p.id);
    var picked = vs.filter(function (v) { return v.size === s.size; })[0];
    var h2 = bar + '<div class="st-pd">' +
      thumbBox(p) +
      '<span class="eyebrow">' + esc(p.brand) + ' · ' + DB.typeLabels[p.type] + '</span>' +
      '<h3 style="font-size:16px;margin:4px 0 6px">' + esc(p.name) + '</h3>' +
      '<div class="strong-num" style="font-size:20px">' + money(p.sellingPrice) + '</div>' +
      '<div class="lbl" style="margin-top:12px">' + t('choose_size') + '</div><div class="st-sizes">';
    vs.forEach(function (v) {
      h2 += '<button class="st-size' + (s.size === v.size ? ' on' : '') + '"' + (v.qty <= 0 ? ' disabled' : '') +
        ' data-act="st-size" data-size="' + v.size + '">' + v.size + '</button>';
    });
    h2 += '</div>' +
      '<button class="btn btn-primary btn-block btn-lg" data-act="st-add"' + (picked && picked.qty > 0 ? '' : ' disabled') + '>' +
        (s.size ? t('add_to_cart') : t('choose_size')) + '</button>' +
      '<div class="partner-note" style="margin-top:12px">' + esc(p.colorway) + ' · ' + t('made_in') + ' ' + esc(p.madeIn) + '</div>' +
    '</div>';
    return h2;
  }

  if (s.screen === 'cart') {
    var h3 = bar + '<div class="st-pd"><h3 style="font-size:16px;margin-bottom:8px">' + t('cart') + '</h3>';
    if (!s.cart.length) {
      h3 += '<div class="partner-note">' + t('empty_cart') + '</div>' +
        '<button class="btn btn-block mt" data-act="st-back">' + t('shop_all') + '</button>';
    } else {
      s.cart.forEach(function (l, i) {
        h3 += '<div class="st-line"><b>' + esc(l.name) + '</b><span class="muted">· ' + l.size + ' ×' + l.qty + '</span>' +
          '<span class="money">' + money(l.qty * l.price) + '</span>' +
          '<button class="cl-del" data-act="st-remove" data-i="' + i + '">×</button></div>';
      });
      h3 += '<div class="st-line" style="border:0;font-size:15px"><b>' + t('total') + '</b>' +
        '<span class="money strong-num" style="font-size:17px">' + money(cartTotal) + '</span></div>' +
        '<button class="btn btn-primary btn-block btn-lg mt" data-act="st-checkout">' + t('checkout') + '</button>';
    }
    return h3 + '</div>';
  }

  /* checkout */
  var h4 = bar + '<div class="st-pd"><h3 style="font-size:16px;margin-bottom:10px">' + t('checkout') + '</h3>' +
    '<label class="field"><span>' + t('name') + '</span><input class="inp" id="stName" value="Joud Attar"></label>' +
    '<label class="field"><span>' + t('whatsapp') + '</span><input class="inp num" id="stPhone" value="+963 933 662 108"></label>' +
    '<div class="row2">' +
      '<label class="field"><span>' + t('gender') + '</span><select class="inp" id="stGender">' +
        '<option value="male">' + t('male') + '</option><option value="female">' + t('female') + '</option></select></label>' +
      '<label class="field"><span>' + t('city') + '</span><select class="inp" id="stCity">' +
        ['Damascus', 'Aleppo', 'Homs', 'Latakia', 'Hama', 'Tartus'].map(function (c) { return '<option>' + c + '</option>'; }).join('') +
      '</select></label>' +
    '</div>' +
    '<label class="field"><span>' + t('payment_method') + '</span><select class="inp" id="stPay">' +
      DB.paymentMethods.map(function (m) { return '<option value="' + m + '">' + DB.payLabel(m) + '</option>'; }).join('') +
    '</select></label>' +
    '<div class="st-line" style="border:0;font-size:15px"><b>' + t('total') + '</b>' +
      '<span class="money strong-num" style="font-size:17px">' + money(cartTotal) + '</span></div>' +
    '<button class="btn btn-primary btn-block btn-lg" data-act="st-place">' + t('place_order') + '</button></div>';
  return h4;
}

function renderStore() {
  var el = document.getElementById('phoneScreen');
  if (el) el.innerHTML = storeScreen();
  var ol = document.getElementById('ordersList');
  if (ol) ol.innerHTML = ordersList();
}

/* -------------------------------------------------------------- 14. SETTINGS */

/* ------------------------------------------------------------ ROLES & ACCESS

   This used to be a hardcoded array of thirteen rows with tick boxes wired to
   nothing — it edited a variable in the browser and the server never saw it.
   It looked exactly like the control panel for permissions and controlled
   nothing at all.

   The real matrix now comes from GET /api/roles and saves back with PUT. Held
   here after the first fetch so a re-render does not blank the table. */
var ROLE_MATRIX = null;
var ROLE_SAVE_T = null;

/* Fallback for demo mode and for _shot.html, where there is no server to ask.
   Shows the shipped defaults, read-only, so the screen still says something
   true rather than rendering an empty card in a client screenshot. */
var DEMO_MATRIX_ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner'];
var DEMO_MATRIX = [
  ['sell',           'till',      'Sell at the till',            [1, 1, 0, 0, 0]],
  ['refund',         'till',      'Give a refund',               [1, 1, 0, 0, 0]],
  ['void',           'till',      'Cancel a completed sale',     [1, 0, 0, 0, 0]],
  ['stock.read',     'stock',     'See stock levels',            [1, 1, 1, 1, 0]],
  ['stock.move',     'stock',     'Receive and move stock',      [1, 0, 1, 0, 0]],
  ['stock.count',    'stock',     'Do a stock count',            [1, 0, 1, 0, 0]],
  ['product.read',   'products',  'See products',                [1, 1, 1, 1, 0]],
  ['product.write',  'products',  'Add and edit products',       [1, 0, 1, 0, 0]],
  ['customer.read',  'customers', 'See customers',               [1, 1, 0, 1, 0]],
  ['customer.write', 'customers', 'Add and edit customers',      [1, 1, 0, 0, 0]],
  ['cost.read',      'money',     'See what things cost',        [1, 0, 0, 0, 0]],
  ['profit.read',    'money',     'See profit',                  [1, 0, 0, 0, 0]],
  ['money.read',     'money',     'See the money screen',        [1, 0, 0, 0, 0]],
  ['money.write',    'money',     'Record expenses and debts',   [1, 0, 0, 0, 0]],
  ['print.read',     'print',     'See print jobs',              [1, 1, 1, 1, 0]],
  ['print.write',    'print',     'Create and change print jobs',[1, 0, 0, 0, 0]],
  ['partner.read',   'print',     'See the partner portal',      [1, 0, 0, 0, 0]],
  ['partner.write',  'print',     'Act on partner orders',       [1, 0, 0, 0, 0]],
  ['staff.read',     'admin',     'See staff accounts',          [1, 0, 0, 0, 0]],
  ['staff.write',    'admin',     'Add and edit staff',          [1, 0, 0, 0, 0]],
  ['report.read',    'admin',     'See reports',                 [1, 0, 0, 0, 0]],
  ['config.write',   'admin',     'Change settings',             [1, 0, 0, 0, 0]],
  ['partner.jobs',   'partner',   'Yalla Wear: own jobs',        [0, 0, 0, 0, 1]],
  ['partner.respond','partner',   'Yalla Wear: accept or decline',[0, 0, 0, 0, 1]],
  ['partner.invoice','partner',   'Yalla Wear: own invoices',    [0, 0, 0, 0, 1]]
];

function demoMatrix() {
  return {
    roles: DEMO_MATRIX_ROLES,
    permissions: DEMO_MATRIX.map(function (r) {
      var roles = {};
      DEMO_MATRIX_ROLES.forEach(function (name, i) {
        roles[name] = { allowed: !!r[3][i], locked: true, why: null };
      });
      return { perm: r[0], group: r[1], label: r[2], roles: roles };
    })
  };
}

function rolesCard() {
  var m = ROLE_MATRIX || (typeof Auth === 'undefined' || Auth.demoMode() ? demoMatrix() : null);

  /* Still loading. Draw the frame rather than nothing, so the card does not
     pop into existence and shove the rest of the page down. */
  if (!m) {
    return '<div class="card mb"><div class="card-head"><h3>' + t('roles_perms') + '</h3></div>' +
      '<div class="card-body muted small">…</div></div>';
  }

  /* Only a manager may change these. Everyone else sees the same grid,
     read-only — knowing the rules is not a privilege, changing them is. */
  var editable = typeof Auth !== 'undefined' && !Auth.demoMode() && Auth.can('config.write');

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('roles_perms') + '</h3>' +
    '<div class="card-actions muted small">' +
      m.roles.length + ' ' + t('role').toLowerCase() + 's · ' +
      m.permissions.length + ' ' + t('permission').toLowerCase() + 's</div></div>';

  if (editable) h += '<div class="perm-hint">' + t('roles_editable') + '</div>';

  h += '<div class="table-wrap"><table class="tbl perm-tbl"><thead><tr>' +
    '<th>' + t('permission') + '</th>';
  m.roles.forEach(function (r) {
    h += '<th class="pc">' + esc(roleLabel(r)) + '</th>';
  });
  h += '</tr></thead><tbody>';

  var lastGroup = null;
  m.permissions.forEach(function (p) {
    /* A group heading row. Twenty-five ticked boxes in a column is unreadable;
       broken into "Till", "Stock", "Money" it reads as a description of a job. */
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      h += '<tr class="perm-group"><td colspan="' + (m.roles.length + 1) + '">' +
        t('pg_' + p.group) + '</td></tr>';
    }

    h += '<tr><td class="perm-name">' + esc(p.label) + '</td>';
    m.roles.forEach(function (r) {
      var cell = p.roles[r] || { allowed: false, locked: true };
      var locked = cell.locked || !editable;
      h += '<td class="pc' + (cell.locked ? ' is-locked' : '') + '"' +
        (cell.why ? ' title="' + esc(cell.why) + '"' : '') + '>' +
        '<input type="checkbox"' + (cell.allowed ? ' checked' : '') +
        (locked ? ' disabled' : ' data-change="set-perm" data-role="' + r +
                                '" data-perm="' + esc(p.perm) + '"') + '>' +
        (cell.locked ? '<span class="lock-i" aria-hidden="true">🔒</span>' : '') +
        '</td>';
    });
    h += '</tr>';
  });

  h += '</tbody></table></div></div>';
  return h;
}

/* Pull the live matrix, then repaint Settings once. Called from afterSettings
   so it only runs when the screen is actually open. */
function loadRoleMatrix() {
  if (typeof Auth === 'undefined' || Auth.demoMode()) return;
  if (ROLE_MATRIX) return;

  API.get('/api/roles')
    .then(function (m) {
      ROLE_MATRIX = { roles: m.roles, permissions: m.permissions };
      if (OG.view === 'settings') render();
    })
    .catch(function () { /* the card keeps its placeholder; nothing else breaks */ });
}

/* Save one role. Sends the whole granted list rather than a diff, so the
   server never has to reconcile a partial view of the truth. */
function saveRolePermissions(role) {
  if (!ROLE_MATRIX) return;

  var granted = ROLE_MATRIX.permissions
    .filter(function (p) { return p.roles[role] && p.roles[role].allowed; })
    .map(function (p) { return p.perm; });

  API.put('/api/roles/' + encodeURIComponent(role), { granted: granted })
    .then(function (res) {
      ROLE_MATRIX = { roles: res.matrix.roles, permissions: res.matrix.permissions };

      /* The server may have refused part of it — a pinned manager permission,
         or something the partner may never have. Say so plainly and redraw
         from what actually saved, rather than leaving a tick that did not
         stick. */
      if (res.refused && res.refused.length) {
        toast(t('perm_refused'), res.refused.join(', '), 'err', 5000);
      } else {
        toast(t('perm_saved'), roleLabel(role), 'ok', 1800);
      }

      /* Your own role may have just changed — repaint the menu, not just the
         table. */
      if (typeof Auth !== 'undefined') Auth.refresh().then(function () { refreshAll(); });
      else render();
    })
    .catch(function (e) { toast(t('roles_perms'), API.friendly(e), 'err', 5000); });
}

var REMINDER_RULES = [
  ['Low stock alert', 'Warn when any SKU drops to 3 pieces or fewer', 1],
  ['Size gap alert', 'Warn when a middle size hits zero but the product still has stock', 1],
  ['Dormant customer', 'Flag customers with no purchase for 90 days', 1],
  ['Supplier payment', 'Remind 5 days before a supplier payment is due', 1],
  ['Print deadline', 'Remind 1 day before a print job deadline', 1],
  ['Dead stock', 'Flag products with no sale for 60 days', 0],
  ['Daily closing summary', 'Send the day total on WhatsApp at 22:00', 0]
];

/* ---- hardware ------------------------------------------------------------
   A scanner that half-works is the worst failure mode in the shop: codes land
   in a search box, or nothing happens at all, and there is nothing on screen
   to say why. This card is the answer to "is it the scanner or the app?" —
   it shows the raw characters, how fast they arrived, and the verdict. */
function hardwareCard() {
  var cfg = (typeof Wedge !== 'undefined') ? Wedge.config() : { prefix: '', maxGapMs: 35 };
  var cam = (typeof Scan !== 'undefined') ? Scan.supported() : { native: false };

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('hw_title') + '</h3>' +
    '<div class="card-actions muted small">' + t('hw_sub') + '</div></div><div class="card-body">';

  /* -- scanner -- */
  h += '<h4 class="hw-h">' + t('hw_scanner') + '</h4>' +
    '<p class="small muted">' + t('hw_scanner_note') + '</p>' +
    '<div class="hw-test" id="hwTest">' +
      '<input class="inp" id="hwProbe" type="text" placeholder="' + esc(t('hw_test')) + '" autocomplete="off">' +
      '<div class="hw-read" id="hwRead"><span class="muted">' + t('hw_waiting') + '</span></div>' +
    '</div>';

  h += '<div class="grid mt" style="grid-template-columns:1fr 1fr;gap:12px">' +
    '<label class="field"><span class="lbl">' + t('hw_prefix') + '</span>' +
      '<input class="inp" id="hwPrefix" type="text" maxlength="1" value="' + esc(cfg.prefix) + '">' +
      '<small class="faint">' + t('hw_prefix_note') + '</small></label>' +
    '<label class="field"><span class="lbl">' + t('hw_threshold') + ' — <b id="hwGapVal">' + cfg.maxGapMs + '</b> ms</span>' +
      '<input class="inp" id="hwGap" type="range" min="10" max="120" step="5" value="' + cfg.maxGapMs + '">' +
      '<small class="faint">' + t('hw_threshold_note') + '</small></label>' +
  '</div>';

  /* The camera gap, said out loud rather than discovered in the shop. */
  if (!cam.native) {
    h += '<div class="partner-note note-warn mt">' + t('hw_camera_gap') + '</div>';
  }

  /* -- printer -- */
  h += '<div class="hw-sep"></div>' +
    '<h4 class="hw-h">' + t('hw_printer') + '</h4>' +
    '<p class="small muted">' + t('hw_printer_note') + '</p>' +
    '<div class="chip-row mt">' +
      '<button class="chip ' + (OG.lb.mode === 'roll' ? 'on' : '') + '" data-act="lb-mode" data-k="roll">' + t('hw_roll') + '</button>' +
      '<button class="chip ' + (OG.lb.mode === 'sheet' ? 'on' : '') + '" data-act="lb-mode" data-k="sheet">' + t('hw_sheet') + '</button>' +
    '</div>' +
    '<div class="chip-row mt">';
  Object.keys(LABEL_SIZES).forEach(function (k) {
    h += '<button class="chip ' + (OG.lb.size === k ? 'on' : '') + '" data-act="lb-size" data-k="' + k + '">' +
      k.replace('x', ' × ') + ' mm</button>';
  });
  h += '</div>' +
    '<div class="chip-row mt">' +
      '<button class="btn btn-ghost" data-act="hw-test-label">' + t('hw_test_label') + '</button>' +
      '<button class="btn btn-ghost" data-act="hw-calibrate">' + t('hw_calibrate') + '</button>' +
    '</div>';

  h += '<div class="partner-note mt">' + t('hw_sym_note') + '</div>';

  /* -- receipt paper --
     Separate from the label roll above: they are two different printers in
     most shops, and even where they are one machine, a 30mm label and an 80mm
     receipt are different stock. */
  h += '<div class="hw-sep"></div>' +
    '<h4 class="hw-h">' + t('rc_paper') + '</h4>' +
    '<p class="small muted">' + t('rc_paper_hint') + '</p>' +
    '<div class="chip-row mt">' +
      '<button class="chip ' + (OG.rc.width === '80' ? 'on' : '') + '" data-act="rc-width" data-k="80">' + t('rc_80') + '</button>' +
      '<button class="chip ' + (OG.rc.width === '58' ? 'on' : '') + '" data-act="rc-width" data-k="58">' + t('rc_58') + '</button>' +
    '</div>';

  return h + '</div></div>';
}

/* ---- the 80mm thermal receipt --------------------------------------------
   Everything a manager can tune without a code change: which printer to
   talk to, how many copies, and the two blocks of text that print on every
   receipt bilingual — the footer and the return policy. Saves straight to
   the server's config table via PUT /api/config; there is nothing to save
   in demo mode, so the fields show the seeded defaults and stay read-only. */
function receiptSettingsCard() {
  var demo = typeof Auth === 'undefined' || Auth.demoMode();
  var dis = demo ? ' disabled' : '';

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('rc3_title') + '</h3>' +
    '<div class="card-actions muted small">' + t('rc3_sub') + '</div></div><div class="card-body">';

  if (demo) h += '<div class="partner-note note-warn mb">' + t('rc3_demo_note') + '</div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_host') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcHost" value="' + esc(CONFIG.RECEIPT_PRINTER_HOST) + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('rc3_port') + '</span>' +
      '<input class="inp num" type="number" id="rcPort" value="' + CONFIG.RECEIPT_PRINTER_PORT + '"' + dis + '></label>' +
  '</div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_branch') + '</span>' +
      '<input class="inp" id="rcBranch" value="' + esc(CONFIG.SHOP_BRANCH) + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('phone') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcPhone" value="' + esc(CONFIG.SHOP_PHONE) + '"' + dis + '></label>' +
  '</div>';

  h += '<div class="rule-row"><div class="rr-txt"><b>' + t('rc3_auto_print') + '</b>' +
    '<small>' + t('rc3_auto_print_hint') + '</small></div>' +
    '<label class="switch"><input type="checkbox" id="rcAutoPrint"' +
      (CONFIG.RECEIPT_AUTO_PRINT ? ' checked' : '') + dis + '><i></i></label></div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_copies') + '</span>' +
      '<input class="inp num" type="number" min="1" max="4" id="rcCopies" value="' + CONFIG.RECEIPT_COPIES + '"' + dis + '></label>' +
    '<label class="field"><span>' + t('rc3_cut_mode') + '</span>' +
      '<div class="chip-row" id="rcCutMode" data-v="' + esc(CONFIG.RECEIPT_CUT_MODE) + '">' +
        '<button class="chip ' + (CONFIG.RECEIPT_CUT_MODE !== 'full' ? 'on' : '') + '"' + dis +
          ' data-act="rc-cut" data-k="partial">' + t('rc3_cut_partial') + '</button>' +
        '<button class="chip ' + (CONFIG.RECEIPT_CUT_MODE === 'full' ? 'on' : '') + '"' + dis +
          ' data-act="rc-cut" data-k="full">' + t('rc3_cut_full') + '</button>' +
      '</div></label>' +
  '</div>';

  [['rcShowQr', 'rc3_show_qr', CONFIG.RECEIPT_SHOW_QR],
   ['rcShowBarcode', 'rc3_show_barcode', CONFIG.RECEIPT_SHOW_BARCODE],
   ['rcShowLoyalty', 'rc3_show_loyalty', CONFIG.RECEIPT_SHOW_LOYALTY]
  ].forEach(function (f) {
    h += '<div class="rule-row"><div class="rr-txt"><b>' + t(f[1]) + '</b></div>' +
      '<label class="switch"><input type="checkbox" id="' + f[0] + '"' + (f[2] ? ' checked' : '') + dis + '><i></i></label></div>';
  });

  h += '<div class="row2 mt">' +
    '<label class="field"><span>' + t('rc3_footer_ar') + '</span>' +
      '<textarea class="inp" dir="rtl" id="rcFooterAr" rows="2"' + dis + '>' + esc(CONFIG.RECEIPT_FOOTER_AR) + '</textarea></label>' +
    '<label class="field"><span>' + t('rc3_footer_en') + '</span>' +
      '<textarea class="inp" dir="ltr" id="rcFooterEn" rows="2"' + dis + '>' + esc(CONFIG.RECEIPT_FOOTER_EN) + '</textarea></label>' +
  '</div>';

  h += '<div class="row2">' +
    '<label class="field"><span>' + t('rc3_policy_ar') + '</span>' +
      '<textarea class="inp" dir="rtl" id="rcPolicyAr" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_POLICY_AR) + '</textarea></label>' +
    '<label class="field"><span>' + t('rc3_policy_en') + '</span>' +
      '<textarea class="inp" dir="ltr" id="rcPolicyEn" rows="3"' + dis + '>' + esc(CONFIG.RECEIPT_POLICY_EN) + '</textarea></label>' +
  '</div>';

  h += '<div class="mt"><button class="btn btn-primary" data-act="rc-save-config"' + dis + '>' +
    t('rc3_save') + '</button></div>';

  return h + '</div></div>';
}

/* ---- thermal product labels (XP-235B) -------------------------------------
   A separate card from receiptSettingsCard() and from the old browser
   Label Studio's controls inside hardwareCard() — different printer,
   different protocol, different queue. Station/preset pickers and the
   queue view work for anyone with label.print; the config fields below
   them are manager-only (config.write), same split as everywhere else. */
function thermalLabelsCard() {
  var demo = typeof Auth === 'undefined' || Auth.demoMode();
  var canPrint = allow('label.print');
  var canConfig = allow('config.write') && !demo;
  var dis = demo || !canPrint ? ' disabled' : '';
  var cdis = canConfig ? '' : ' disabled';

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('lbl_thermal_section') + '</h3>' +
    '<div class="card-actions muted small">' + t('lbl_thermal_sub') + '</div></div><div class="card-body">';

  if (demo) h += '<div class="partner-note note-warn mb">' + t('rc3_demo_note') + '</div>';
  else if (!canPrint) h += '<div class="partner-note note-warn mb">' + t('no_access') + '</div>';

  h += '<div class="chip-row"><span class="lbl-lbl">' + t('lbl_station') + '</span>';
  Labels.stationOptions().forEach(function (s) {
    h += '<button class="chip ' + (Labels.lastChoice().station === s ? 'on' : '') + '"' + dis +
      ' data-act="label-station" data-k="' + esc(s) + '">' + esc(s) + '</button>';
  });
  h += '</div>';

  h += '<div class="chip-row mt"><span class="lbl-lbl">' + t('lbl_preset') + '</span>';
  Labels.presetOptions().forEach(function (p) {
    h += '<button class="chip ' + (Labels.lastChoice().preset === p.key ? 'on' : '') + '"' + dis +
      ' data-act="label-preset" data-k="' + p.key + '">' + p.key + '</button>';
  });
  h += '</div>';

  h += '<div class="mt"><button class="btn btn-ghost"' + dis + ' data-act="label-calibrate">' +
    t('hw_calibrate') + '</button></div>';

  if (!demo && canPrint && OG.labelQueue === undefined && !OG.labelQueueLoading) {
    OG.labelQueueLoading = true;
    API.get('/api/labels/queue').then(function (res) {
      OG.labelQueueLoading = false;
      OG.labelQueue = res.jobs || [];
      if (OG.view === 'settings') render();
    }).catch(function () { OG.labelQueueLoading = false; OG.labelQueue = []; });
  }
  var jobs = OG.labelQueue || [];
  h += '<div class="hw-sep"></div><h4 class="hw-h">' + t('lbl_queue_title') + '</h4>';
  if (!jobs.length) {
    h += '<p class="small muted">' + t('lbl_queue_empty') + '</p>';
  } else {
    h += '<div class="table-wrap"><table class="tbl tbl-compact"><tbody>';
    jobs.forEach(function (j) {
      h += '<tr><td>' + esc(j.station) + '</td><td class="muted small">' + esc(j.preset) + '</td>' +
        '<td class="num">' + j.label_count + '</td>' +
        '<td><span class="badge ' + (j.status === 'done' ? 'silver' : j.status === 'failed' ? 'danger' : 'neutral') + '">' + esc(j.status) + '</span></td>' +
        '<td>' + (j.status === 'pending'
          ? '<button class="btn btn-sm btn-ghost" data-act="label-cancel-job" data-id="' + j.id + '">' + t('lbl_cancel') + '</button>'
          : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  h += '<div class="hw-sep"></div><h4 class="hw-h">' + t('lbl_transport') + '</h4>';
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('lbl_transport') + '</span>' +
      '<select class="inp" id="lblTransport"' + cdis + '>' +
        '<option value="agent"' + (CONFIG.LABEL_TRANSPORT !== 'tcp' ? ' selected' : '') + '>' + t('lbl_transport_agent') + '</option>' +
        '<option value="tcp"' + (CONFIG.LABEL_TRANSPORT === 'tcp' ? ' selected' : '') + '>' + t('lbl_transport_tcp') + '</option>' +
      '</select></label>' +
    '<label class="field"><span>' + t('lbl_host') + '</span>' +
      '<input class="inp num" dir="ltr" id="lblHost" value="' + esc(CONFIG.LABEL_PRINTER_HOST || '') + '"' + cdis + '></label>' +
  '</div>';
  h += '<div class="row2">' +
    '<label class="field"><span>' + t('lbl_density') + '</span>' +
      '<input class="inp num" type="number" min="1" max="15" id="lblDensity" value="' + (CONFIG.LABEL_DENSITY || 8) + '"' + cdis + '></label>' +
    '<label class="field"><span>' + t('lbl_gap') + '</span>' +
      '<input class="inp num" type="number" min="0" step="0.5" id="lblGap" value="' + (CONFIG.LABEL_GAP_MM || 2) + '"' + cdis + '></label>' +
  '</div>';
  h += '<div class="mt"><button class="btn btn-primary"' + cdis + ' data-act="lbl-save-config">' + t('lbl_save') + '</button></div>';

  return h + '</div></div>';
}

function viewSettings() {
  var h = '<div class="page-head"><div><h1>' + t('settings_title') + '</h1>' +
    '<div class="sub">' + t('settings_sub') + '</div></div>' +
    '<div class="head-actions">' + exportButtons() +
      '<button class="btn btn-primary" data-act="settings-save">' + t('save_changes') + '</button></div></div>';

  h += hardwareCard();

  h += receiptSettingsCard();

  h += thermalLabelsCard();

  h += rolesCard();

  h += '<div class="set-grid">';

  h += '<div class="card"><div class="card-head"><h3>' + t('exchange_rate') + '</h3></div><div class="card-body">' +
    '<label class="field"><span>' + t('rate_hint') + '</span>' +
      '<input class="inp num" id="setRate" type="number" value="' + CONFIG.EXCHANGE_RATE + '" data-change="set-rate"></label>' +
    '<div class="partner-note">1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP · ' +
      (OG.lang === 'ar' ? 'كل الأسعار في النظام تتحدّث فوراً' : 'every price in the system updates instantly') + '</div>' +
  '</div></div>';

  h += '<div class="card"><div class="card-head"><h3>' + t('loyalty_rules') + '</h3></div><div class="card-body">' +
    '<div class="row2">' +
      '<label class="field"><span>' + t('points_per') + '</span><input class="inp num" type="number" min="0" ' +
        'value="' + CONFIG.LOYALTY_POINTS_PER_1000 + '" data-change="set-pts"></label>' +
      '<label class="field"><span>' + t('point_value') + '</span><input class="inp num" type="number" min="0" ' +
        'value="' + CONFIG.LOYALTY_POINT_VALUE + '" data-change="set-ptval"></label>' +
    '</div>' +
    '<div class="partner-note">500 ' + t('points') + ' = ' + money(500 * CONFIG.LOYALTY_POINT_VALUE) + '</div>' +
    '<div class="mt"><div class="lbl">' + t('tier') + '</div>' +
      '<span class="badge bronze">' + t('bronze') + ' 0–' + nf(CONFIG.TIER_SILVER - 1) + '</span> ' +
      '<span class="badge silver">' + t('silver') + ' ' + nf(CONFIG.TIER_SILVER) + '–' + nf(CONFIG.TIER_GOLD - 1) + '</span> ' +
      '<span class="badge gold">' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD) + '+</span></div>' +
  '</div></div>';

  /* The escape hatch for a laggy projector or a remote-desktop demo. Writes
     body[data-motion], which the reduced-motion rules already honour, so no
     screen needs to know about it. */
  var moOff = document.body.getAttribute('data-motion') === 'off';
  h += '<div class="card"><div class="card-head"><h3>' + t('mo_title') + '</h3></div>' +
    '<div class="card-body">' +
      '<div class="rule-row"><div class="rr-txt"><b>' + t('mo_animations') + '</b>' +
        '<small>' + t('mo_hint') + '</small></div>' +
        '<label class="switch"><input type="checkbox"' + (moOff ? '' : ' checked') +
          ' data-change="set-motion"><i></i></label></div>' +
    '</div></div>';

  h += '<div class="card"><div class="card-head"><h3>' + t('reminders') + '</h3></div>';
  REMINDER_RULES.forEach(function (r) {
    h += '<div class="rule-row"><div class="rr-txt"><b>' + r[0] + '</b><small>' + r[1] + '</small></div>' +
      '<label class="switch"><input type="checkbox"' + (r[2] ? ' checked' : '') + '><i></i></label></div>';
  });
  h += '</div>';

  h += '<div class="card"><div class="card-head"><h3>' + t('branding') + '</h3></div><div class="card-body">' +
    '<div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">' +
      '<div class="brand-mark" style="width:56px;height:56px"><img src="assets/logo.svg" alt="OG"></div>' +
      '<div style="flex:1"><label class="field" style="margin:0"><span>' + t('shop_name') + '</span>' +
        '<input class="inp" id="setShopName" value="' + esc(CONFIG.SHOP_NAME) + '" data-change="set-shopname"></label></div>' +
    '</div>' +
    '<div class="lbl">' + t('accent_colour') + '</div>' +
    '<div class="swatch-row" style="margin-bottom:24px">' +
      '<div class="swatch" style="background:#C6FF00;border-color:var(--foreground);border-width:2px"><span>C6FF00</span></div>' +
      '<div class="swatch" style="background:#0A0A0B"><span>0A0A0B</span></div>' +
      '<div class="swatch" style="background:#FAFAFA"><span>FAFAFA</span></div>' +
      '<div class="swatch" style="background:#F87171"><span>F87171</span></div>' +
      '<div class="swatch" style="background:#4ADE80"><span>4ADE80</span></div>' +
    '</div>' +
    '<label class="field"><span>' + t('phone') + '</span><input class="inp num" dir="ltr" id="setAddr" ' +
      'value="' + esc(CONFIG.SHOP_ADDRESS) + '" data-change="set-addr"></label>' +
  '</div></div>';

  h += '</div>';
  return h;
}

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

/* What the QR carries.

   A LAN address is NEVER printed as a link. `http://10.10.99.9:8090` is dead
   the second the customer leaves the shop, and worse, may one day resolve to a
   stranger's router on their own home network. So a link is only promised when
   there is a real public address to promise — otherwise the QR falls back to
   readable text, which needs no internet and cannot rot. */
function receiptLink(sale) {
  var base = String(CONFIG.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  var token = sale.publicToken || sale.public_token;
  if (!token || !/^https:\/\//i.test(base)) return null;
  /* The GitHub Pages demo is a static host with no /i/ route — pointing a
     customer's receipt at it would open the demo app and show them a
     fabricated invoice with the same number. Worse than no link. */
  if (/github\.io/i.test(base)) return null;
  return base + '/i/' + token;
}

function receiptQr(sale) {
  var link = receiptLink(sale);
  var d = receiptDim();
  /* Modules must land on whole printer dots. 22mm at 80mm, a little less on
     58mm paper where there is not room for it. */
  var px = d.paper >= 80 ? 132 : 108;
  var payload = link || (CONFIG.SHOP_NAME.toUpperCase() + ' | ' + sale.id + '\n' +
    money(sale.total) + '\n' + fmtDateTime(sale.date));
  return {
    svg: qrSafe(payload, sale.id, { size: px, quiet: 2, style: 'square', dark: '#000000' }),
    link: link
  };
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
  var qr = receiptQr(sale);

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

  /* ---- the QR ---- */
  h += '<div class="rcp-qr">' + qr.svg +
    (qr.link ? '<div class="rcp-qr-cap">' + t('rc_scan') + '</div>' : '') +
  '</div>';

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
    body: receiptHtml(sale),
    foot: '<button class="btn btn-ghost" data-act="rc-invoice" data-id="' + esc(sale.id) + '">' +
            t('rc_full_page') + '</button>' +
          '<button class="btn" data-act="print-now">' + t('print') + '</button>' +
          (allow('sale.reprint')
            ? '<button class="btn" data-act="print-receipt" data-id="' + esc(sale.id) + '">' +
                t('print_receipt') + '</button>'
            : '') +
          (opts.newSale
            ? '<button class="btn btn-primary" data-act="new-sale">' + t('new_sale') + '</button>'
            : '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>'),
    /* The body class drives the @page swap, so it has to come off however the
       modal is dismissed — otherwise the next thing anyone prints, from any
       screen, comes out 80mm wide. */
    onClose: function () { document.body.classList.remove('printing-receipt'); }
  });
}

function openInvoice(sale, opts) {
  opts = opts || {};
  openModal({
    title: t('invoice') + ' ' + sale.id,
    size: 'wide',
    body: invoiceHtml(sale),
    foot: '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('pdf') + '</button>' +
          '<button class="btn" data-act="print-now">' + t('print') + '</button>' +
          (allow('sale.reprint')
            ? '<button class="btn btn-ghost" data-act="preview-receipt" data-id="' + esc(sale.id) + '">' +
                t('preview_receipt') + '</button>' +
              '<button class="btn" data-act="print-receipt" data-id="' + esc(sale.id) + '">' +
                t('print_receipt') + '</button>'
            : '') +
          (opts.newSale
            ? '<button class="btn btn-primary" data-act="new-sale">' + t('new_sale') + '</button>'
            : '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>')
  });
}

/* ----------------------------------------------------------------- 16. TOUR */

var Tour = {
  i: 0,
  on: false,
  steps: [
    { view: 'dashboard', sel: '#dashStats', titleEn: 'Everything about the business on one screen',
      txtEn: 'Today, this month, what is running out, who stopped buying. No notebook, no counting at midnight.',
      titleAr: 'كل شيء عن العمل في شاشة واحدة',
      txtAr: 'اليوم، الشهر، ما الذي ينفد، ومن توقف عن الشراء. بلا دفتر وبلا عدّ في آخر الليل.' },

    { view: 'pos', sel: '.pos-scanbar', titleEn: 'A sale takes 8 seconds, not a notebook page',
      txtEn: 'Scan the barcode — the product and the exact size land in the cart in one move.',
      titleAr: 'البيع يستغرق ٨ ثوانٍ لا صفحة دفتر',
      txtAr: 'امسح الباركود — المنتج والقياس المضبوط يدخلان السلة بحركة واحدة.',
      enter: function () {
        POS.reset(true);
        POS.scanBarcode(CONFIG.DEMO_BARCODE, true);
        /* A second line makes the invoice in step 3 look like a real basket. */
        var tee = DB.variantsOf(11).filter(function (v) { return v.qty > 0; })[0];
        POS.add(tee, true);
        POS.state.customerId = 1;
      } },

    { view: 'pos', sel: '.invoice-sheet', titleEn: 'The invoice prints itself',
      txtEn: 'Branded, itemised, with the loyalty points already calculated. One button and it is on paper.',
      titleAr: 'الفاتورة تطبع نفسها',
      txtAr: 'بهوية المحل ومفصّلة ونقاط الولاء محسوبة سلفاً. زر واحد وتصبح على الورق.',
      enter: function () { POS.complete(true); }, wait: 380 },

    { view: 'products', sel: '.card.table-wrap', titleEn: 'Watch the stock drop instantly',
      txtEn: 'The exact size you just sold is gone from the warehouse. Everything is connected — nothing is typed twice.',
      titleAr: 'شاهد المخزون ينقص فوراً',
      txtAr: 'القياس الذي بعته للتو نقص من المستودع. كل شيء متصل — لا شيء يُكتب مرتين.',
      enter: function () { closeModal(); OG.prod.q = 'Air Force'; } },

    { view: 'warehouse', sel: '#mvTable', titleEn: 'Every movement is recorded, forever',
      txtEn: 'Received, sold, damaged, returned — with the user, the date and the balance after it. Nothing disappears quietly.',
      titleAr: 'كل حركة مسجّلة إلى الأبد',
      txtAr: 'وارد، مبيع، تالف، مرتجع — مع المستخدم والتاريخ والرصيد. لا شيء يختفي بصمت.',
      enter: function () { OG.wh.tab = 'moves'; } },

    { view: 'print', sel: '.kanban', titleEn: 'Yalla Wear gets the job automatically',
      txtEn: 'Tick "Add print" during a sale and the job appears here in Design. Drag it as it moves. The partner sees only what they need.',
      titleAr: 'يلا وير تستلم الطلب تلقائياً',
      txtAr: 'فعّل "أضف طلب طباعة" أثناء البيع فيظهر الطلب هنا في التصميم. اسحبه مع تقدّمه. والشريك لا يرى إلا ما يخصّه.' },

    { view: 'reports', sel: '#repChart', titleEn: 'Know your real profit for the first time',
      txtEn: 'Revenue minus cost, per category, plus the capital sitting frozen on your shelves.',
      titleAr: 'اعرف ربحك الحقيقي لأول مرة',
      txtAr: 'الإيراد ناقص التكلفة لكل فئة، مع رأس المال المجمّد على رفوفك.',
      enter: function () { OG.rep.tab = 'profit'; } }
  ],

  start: function () {
    Tour.on = true; Tour.i = 0;
    document.body.classList.add('tour-on');
    Tour.show();
  },

  stop: function () {
    Tour.on = false;
    document.body.classList.remove('tour-on');
    document.getElementById('tour-root').innerHTML = '';
    OG.prod.q = '';
    closeModal();
  },

  go: function (n) {
    if (n < 0) return;
    if (n >= Tour.steps.length) { Tour.stop(); toast(t('tour_start'), OG.lang === 'ar' ? 'انتهت الجولة' : 'Tour complete', 'ok'); return; }
    Tour.i = n; Tour.show();
  },

  show: function () {
    var s = Tour.steps[Tour.i];
    if (OG.view !== s.view) { OG.view = s.view; renderSidebar(); }
    if (s.enter) { try { s.enter(); } catch (e) {} }
    render();
    setTimeout(function () { Tour.paint(); }, s.wait || 120);
  },

  paint: function () {
    var s = Tour.steps[Tour.i];
    var el = document.querySelector(s.sel) || document.querySelector('.view') || document.body;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}

    setTimeout(function () {
      var r = el.getBoundingClientRect();
      var pad = 6;
      var top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad);
      var w = Math.min(r.width + pad * 2, window.innerWidth - left - 6);
      var h = Math.min(r.height + pad * 2, window.innerHeight - top - 6);

      var popW = Math.min(306, window.innerWidth - 32);
      var popTop = top + h + 14;
      if (popTop + 210 > window.innerHeight) popTop = Math.max(12, top - 224);
      var popLeft = Math.min(Math.max(12, left), window.innerWidth - popW - 12);

      var title = OG.lang === 'ar' ? s.titleAr : s.titleEn;
      var txt = OG.lang === 'ar' ? s.txtAr : s.txtEn;

      var dots = '';
      Tour.steps.forEach(function (_, i) { dots += '<i class="' + (i <= Tour.i ? 'on' : '') + '"></i>'; });

      document.getElementById('tour-root').innerHTML =
        '<div class="spot" style="top:' + top + 'px;left:' + left + 'px;width:' + w + 'px;height:' + h + 'px"></div>' +
        '<div class="tour-pop" style="top:' + popTop + 'px;left:' + popLeft + 'px;width:' + popW + 'px">' +
          '<div class="tour-progress">' + dots + '</div>' +
          '<div class="step">' + t('step') + ' ' + (Tour.i + 1) + ' ' + t('of') + ' ' + Tour.steps.length + '</div>' +
          '<h4>' + title + '</h4><p>' + txt + '</p>' +
          '<div class="tp-foot">' +
            '<button class="btn btn-sm btn-ghost" data-act="tour-back"' +
              (Tour.i === 0 ? ' disabled' : '') + '>' + t('back_btn') + '</button>' +
            '<button class="btn btn-sm btn-primary" data-act="tour-next">' +
              (Tour.i === Tour.steps.length - 1 ? t('close') : t('next')) + '</button>' +
            '<button class="skip" data-act="tour-skip">' + t('skip') + '</button>' +
          '</div>' +
        '</div>';
    }, 260);
  }
};

/* ------------------------------------------------------------- 17. ROUTING */

var VIEWS = {
  /* "Home" is a different screen for different jobs. A chooser rather than a
     fifth branch inside viewDashboard, so each one stays a small readable
     function instead of one screen with four moods.

     roleOf() is null on file://, on the static demo and in _shot.html, so all
     three keep the full manager dashboard — the demo exists to show the whole
     system, and the Arabic proposal is screenshotted from it. */
  dashboard: function () {
    var r = roleOf();
    return r === 'cashier'   ? viewShiftHome()
         : r === 'warehouse' ? viewBackHome()
         : r === 'delivery'  ? viewRunsHome()
         : viewDashboard();
  },
  money: function () { return Money.view(); },
  pos: function () { return POS.render(); },
  products: viewProducts,
  warehouse: viewWarehouse,
  deliveries: function () { return Deliveries.view(); },
  customers: viewCustomers,
  print: viewPrint,
  reports: viewReports,
  storefront: viewStorefront,
  settings: viewSettings
};

var AFTER = {
  dashboard: function () {
    var r = roleOf();
    /* The charts only exist on the manager's dashboard. Calling afterDashboard
       on a shift home would hand Chart.js three canvases that are not there. */
    if (r === 'cashier' || r === 'warehouse') return;
    if (r === 'delivery') return Deliveries.after();
    afterDashboard();
  },
  deliveries: function () { return Deliveries.after(); },
  pos: function () { POS.after(); },
  reports: afterReports,
  print: bindKanban,
  warehouse: bindWarehouse,
  settings: afterSettings
};

/* The scanner test box. While Settings is open the wedge reports here instead
   of opening the product sheet — otherwise every test scan would fire the
   sheet over the page you are trying to configure. */
function afterSettings() {
  /* Before the early return below — the roles grid must still load on a
     machine with no scanner support, which is most of them. */
  loadRoleMatrix();

  var probeBox = document.getElementById('hwProbe');
  var read = document.getElementById('hwRead');
  if (!probeBox || !read || typeof Wedge === 'undefined') return;

  OG.set.captureScans = false;

  function paint(info) {
    if (!info) return;
    var ok = info.accepted;
    read.innerHTML =
      '<div class="hw-line"><span>' + t('hw_last') + '</span><b class="lat">' + esc(info.text) + '</b></div>' +
      '<div class="hw-line"><span>' + t('hw_gap') + '</span><b>' +
        (info.medianGap === null ? '—' : info.medianGap + ' ms') +
        ' · ' + info.length + ' ' + (OG.lang === 'ar' ? 'حرف' : 'chars') + '</b></div>' +
      '<div class="hw-line"><span></span><span class="badge ' + (ok ? 'healthy' : 'critical') + '">' +
        t(ok ? 'hw_accepted' : 'hw_rejected') + (info.viaPrefix ? ' · prefix' : '') + '</span></div>';
    /* A scan that resolves to real stock is the proof that matters — the
       code being readable is only half of it. */
    var hit = resolveScan(info.text);
    if (hit && hit.kind === 'variant') {
      var p = DB.product(hit.variant.productId);
      read.innerHTML += '<div class="hw-line"><span>' + t('product') + '</span><b>' +
        esc(p ? p.name : '') + ' · ' + esc(hit.variant.size) + '</b></div>';
    }
  }

  /* Only capture while the test box has focus, so the rest of Settings still
     behaves like every other screen. */
  probeBox.addEventListener('focus', function () { OG.set.captureScans = true; });
  probeBox.addEventListener('blur',  function () { OG.set.captureScans = false; });

  if (afterSettings._probe) Wedge.offProbe(afterSettings._probe);
  afterSettings._probe = function (info) {
    if (!document.getElementById('hwRead')) return;   /* screen has moved on */
    paint(info);
    var box = document.getElementById('hwProbe');
    if (box) box.value = '';
  };
  Wedge.probe(afterSettings._probe);

  var gap = document.getElementById('hwGap');
  var gapVal = document.getElementById('hwGapVal');
  if (gap) {
    gap.addEventListener('input', function () {
      Wedge.config({ maxGapMs: +gap.value });
      if (gapVal) gapVal.textContent = gap.value;
    });
  }
  var pre = document.getElementById('hwPrefix');
  if (pre) {
    pre.addEventListener('input', function () { Wedge.config({ prefix: pre.value || '' }); });
  }
}

/* Wires the three ways a picture gets in. Re-run on every warehouse render
   because the box is rebuilt each time; the listeners go on the fresh nodes,
   so there is nothing to tear down. */
function bindWarehouse() {
  if (OG.wh.tab !== 'add') return;
  var box = document.getElementById('whDrop');
  var input = document.getElementById('whFile');
  if (!box || !input) return;

  input.addEventListener('change', function () {
    takeProductImage(input.files && input.files[0]);
    /* Cleared so picking the SAME file twice still fires a change event. */
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    box.addEventListener(ev, function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      box.classList.add('drop');
    });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    box.addEventListener(ev, function () { box.classList.remove('drop'); });
  });
  box.addEventListener('drop', function (e) {
    e.preventDefault();
    box.classList.remove('drop');
    var dt = e.dataTransfer;
    takeProductImage(dt && dt.files && dt.files[0]);
  });
}

/* Paste, bound once at the document. Scoped tightly: it must never swallow a
   Ctrl+V that was meant for a text field. */
document.addEventListener('paste', function (e) {
  if (OG.print.partner || OG.view !== 'warehouse' || OG.wh.tab !== 'add') return;
  var tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].type).indexOf('image/') === 0) {
      takeProductImage(items[i].getAsFile());
      e.preventDefault();
      return;
    }
  }
});

/* A wide table cannot work at 320px however it scrolls, so on a phone each
   row restacks into a card and every cell labels itself. Rather than editing
   thirty hand-written tables, the labels are copied from the header row here,
   once per render.

   The class is added at every width — the CSS that acts on it only exists
   inside the phone breakpoint, so desktop is untouched and there is no JS
   breakpoint to drift out of sync with the stylesheet. */
function labelWideTables(root) {
  if (!root) return;
  root.querySelectorAll('table.tbl').forEach(function (tbl) {
    var ths = tbl.querySelectorAll('thead th');
    /* Narrow tables read fine as tables; restacking them wastes vertical
       space and makes them harder to scan, not easier. */
    if (ths.length < 5) return;
    var heads = [].map.call(ths, function (th) { return th.textContent.trim(); });
    tbl.classList.add('tbl-cards');
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      [].forEach.call(tr.children, function (td, i) {
        if (heads[i] && !td.getAttribute('data-l')) td.setAttribute('data-l', heads[i]);
      });
    });
  });
}

function render() {
  Charts.destroyAll();
  var host = document.getElementById('view');

  /* The last gate. Whatever set OG.print.partner false — a stale hash, a
     console poke, a toggle that should not exist for them — a partner account
     renders the portal. Checked at the point of drawing rather than at the
     point of navigating, because there is only one of the former. */
  if (isPartnerAccount()) OG.print.partner = true;

  var partner = OG.print.partner;

  /* Claimed exactly once per view change. Every other repaint — a keystroke
     in the search box, a filter chip, a sort click — renders silently, so
     the entrance animation and the counting numbers do not replay while the
     user is typing. This is the difference between polish and a twitch. */
  var entering = (typeof Motion !== 'undefined') && Motion.claim();

  document.body.setAttribute('data-view', partner ? 'yalla' : OG.view);
  if (partner) document.body.setAttribute('data-portal', 'yalla');
  else document.body.removeAttribute('data-portal');

  host.className = 'view' + (entering ? '' : ' fade-in') +
                   (!partner && OG.view === 'pos' ? ' pos-view' : '');
  host.innerHTML = partner ? YALLA.view() : (VIEWS[OG.view] || viewDashboard)();
  host.scrollTop = 0;

  if (partner) { try { YALLA.after(); } catch (e) { console.warn('yalla after', e); } }
  else if (AFTER[OG.view]) { try { AFTER[OG.view](); } catch (e) { console.warn('after hook', e); } }

  try { Bulk.paint(); } catch (e) { console.warn('bulk paint', e); }

  try { labelWideTables(host); } catch (e) { console.warn('table labels', e); }

  if (entering) {
    try {
      Motion.enter(host, OG.dir);
      Motion.countAll(host);
      Motion.navIndicator();
    } catch (e) { console.warn('motion', e); }
  }
  OG.dir = null;

  if (OG.pending) { var p = OG.pending; OG.pending = null; try { p(); } catch (e) {} }
}

function go(view, pending) {
  if (!VIEWS[view]) view = 'dashboard';

  /* Hiding a menu item does not stop something else asking for that screen —
     a bookmarked #settings, a stale URL hash, a deep link out of a toast. A
     cashier would land on a page they should not see, half-rendered from data
     the server is refusing. Bounce to somewhere they are allowed instead. */
  if (!navAllowed(view)) {
    var first = allowedNav()[0];
    view = first ? first.id : 'dashboard';
  }
  /* Work out the travel direction before OG.view moves on. */
  if (typeof Motion !== 'undefined') {
    OG.dir = Motion.direction(OG.view, view);
    Motion.mark();
  }
  OG.view = view;
  OG.pending = pending || null;
  /* location.hash, not history.pushState — pushState throws on file:// origins. */
  if (window.location.hash !== '#' + view) window.location.hash = view;
  closeDrawer();
  renderSidebar();
  render();
}

function applyLang() {
  var ar = OG.lang === 'ar';
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  document.body.classList.toggle('rtl', ar);
  document.getElementById('tourBtnLabel').textContent = t('tour_start');
}

function refreshAll() {
  /* Language and currency switches redraw the whole shell, so they get the
     entrance too — otherwise flipping to Arabic looks like a hard cut. */
  if (typeof Motion !== 'undefined') Motion.mark();
  renderSidebar();
  renderTopbar();
  render();
}

/* --------------------------------------------------------------- 18. KANBAN */

function bindKanban() {
  if (OG.print.partner) return;
  var dragId = null;

  document.querySelectorAll('.kcard').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      dragId = card.getAttribute('data-id');
      card.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
  });

  document.querySelectorAll('.kcol').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', function () { col.classList.remove('over'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('over');
      var id = dragId;
      try { id = e.dataTransfer.getData('text/plain') || dragId; } catch (err) {}
      var stage = col.getAttribute('data-stage');
      var job = DB.printJobs.filter(function (j) { return j.id === id; })[0];
      if (!job) return;

      /* A refused drop used to just snap back and say nothing, which reads as
         a broken board rather than a rule. Both rules that can refuse it are
         worth stating out loud. */
      if (stage === 'sent' && DB.orderState(job) !== 'accepted') {
        toast(job.id, t('or_blocked_stage'), 'warn', 5000,
              DB.orderState(job) === 'draft'
                ? { label: t('or_send'), attrs: 'data-act="or-send" data-id="' + job.id + '"' }
                : null);
        return;
      }
      if (DB.blockedBy(job, stage) === 'tbc') {
        toast(job.id, t('or_why_tbc'), 'warn', 5000);
        return;
      }

      /* setStage stamps the history so the tracker stays truthful. `og` tells
         Yalla Wear it moved. */
      if (!DB.setStage(job, stage, 'og')) return;
      toast(job.id + ' → ' + t('print_' + stage), job.customer + ' · ' + job.qty + ' pcs', 'ok');
      Notify.refresh();
      renderSidebar();
      render();
    });
  });
}

/* Stage labels are looked up as print_<stage> so they translate cleanly. */
['design', 'sent', 'printing', 'delivery', 'done'].forEach(function (s, i) {
  I18N.en['print_' + s] = ['Design', 'Sent to print', 'Printing', 'Delivery', 'Done'][i];
  I18N.ar['print_' + s] = ['تصميم', 'أُرسل للطباعة', 'قيد الطباعة', 'التوصيل', 'منجز'][i];
});
I18N.en.if_sold_all = 'if everything sells';
I18N.ar.if_sold_all = 'لو بيع كل شيء';
I18N.en.invoices = 'Invoices';
I18N.ar.invoices = 'الفواتير';

/* ---- Yalla Wear portal, tracker and Label Studio strings ---------------- */
/* ---- Yalla Wear v3: kits, board, radar, money, messages ------------------
   Every key here exists in EXTRA_AR too. A missing key does not throw — t()
   quietly returns the slug — so the demo would render "yl_outstanding" in
   Arabic and nobody would notice until the meeting. The suite asserts the two
   objects have identical key sets for exactly that reason. */
var EXTRA_V3_EN = {
  /* nav + modes */
  yl_invoices: 'Invoices', yl_board: 'Board', yl_list: 'List',
  yl_col_empty: 'nothing here',

  /* radar + heatmap */
  yl_radar: 'Deadline radar', yl_radar_sub: 'next 14 days · tap a day to filter',
  yl_late: 'LATE', yl_heat: 'Capacity', yl_per_day: 'pieces a day',
  yl_heat_key: 'quiet → overbooked',

  /* activity */
  yl_activity: 'Activity', yl_activity_sub: 'messages, moves and warnings',
  yl_no_activity: 'All quiet', yl_no_activity_sub: 'Nothing has happened today',
  yl_you: 'You', yl_just_now: 'just now', yl_m: 'm', yl_h: 'h', yl_d: 'd',
  yl_past_deadline: 'Past deadline',

  /* money */
  yl_money: 'Money', yl_outstanding: 'Outstanding', yl_from_og: 'owed by OG System',
  yl_invoiced_month: 'Paid this month', yl_avg_pay: 'Average time to pay',
  yl_avg_pay_sub: 'from issue to settled', yl_days: 'days',
  yl_unbilled: 'Not invoiced yet', yl_unbilled_sub: 'delivered work',
  yl_view_invoices: 'Invoices', yl_ageing: 'How old',

  /* kits + TBC */
  yl_kit_lines: 'Print list', yl_kit: 'Kit', yl_print: 'Print',
  yl_to_confirm: 'TO BE CONFIRMED', yl_tbc: 'TBC', yl_tbc_pieces: 'shirts have no name yet',
  yl_tbc_filter: 'Waiting on names',
  yl_blocked_head: 'shirts cannot be printed',
  yl_blocked_sub: 'the customer has not chosen a name yet, so only OG can clear these',
  yl_blocked_toast: 'shirts still have no name — OG has to confirm them first',
  yl_blocked_tip: 'Blocked: names still missing',
  yl_request_names: 'Ask OG for the names',
  yl_names_requested: 'OG has been asked for the missing names',
  yl_nothing_pending: 'every name is already confirmed',
  yl_need_names: 'Names still needed on', yl_lines: 'lines',

  /* messages */
  yl_thread: 'Messages', yl_messages: 'messages', yl_no_messages: 'No messages',
  yl_no_messages_sub: 'Nothing has been said about this job yet',
  yl_add_note: 'Tell OG something', yl_reason: 'Reason', yl_message: 'Message',
  yl_note_ph: 'What should OG know?',
  yl_note_hint: 'This lands in OG System straight away — they see it on the job.',
  yl_note_empty: 'Write something first', yl_note_sent: 'sent to OG System',
  yl_msg_nudge: 'Nudge', yl_msg_delay: 'Delay', yl_msg_note: 'Note',
  yl_msg_name_request: 'Names needed', yl_msg_invoice: 'Invoice',
  yl_msg_reminder: 'Reminder', yl_msg_reply: 'Reply',
  yl_reason_fabric_late: 'Fabric delivery late', yl_reason_printer_down: 'Printer / heat press down',
  yl_reason_awaiting_names: 'Waiting on name confirmation',
  yl_reason_quality_recheck: 'Quality re-check', yl_reason_other: 'Other',
  yl_recent: 'recent',

  /* invoices + finance */
  yi_sub: 'What OG System owes you, and how long it has been owed',
  yi_new: 'New invoice', yi_from_work: 'From delivered work',
  yi_mode_blank: 'Blank invoice', yi_mode_work: 'Pick delivered kits',
  yi_invoice: 'Invoice', yi_issued: 'Issued', yi_due: 'Due',
  yi_lines: 'Lines', yi_lines_ready: 'lines ready to bill',
  yi_paid: 'Paid', yi_balance: 'Still owed',
  yi_st_draft: 'Draft', yi_st_sent: 'Sent', yi_st_part: 'Part paid', yi_st_paid: 'Paid',
  yi_ageing_sub: 'unpaid balance by age since issue',
  yi_add_line: 'Add a shirt', yi_rows: 'rows', yi_price: 'Price', yi_number: 'No.',
  yi_pick_club: 'Choose a kit…', yi_other_club: 'Something else…', yi_club_name: 'Type the kit name',
  yi_name_ph: 'Name on the back — leave blank for TBC',
  yi_empty: 'Nothing on this invoice yet', yi_empty_sub: 'Add a shirt to get started',
  yi_nothing_ready: 'Nothing to bill', yi_nothing_ready_sub: 'Every delivered kit is already invoiced',
  yi_note: 'Notes', yi_default_note: 'All kits printed · payment on delivery.',
  yi_per_kit: 'per kit, printing included', yi_terms: 'payment on delivery',
  yi_total_due: 'TOTAL DUE', yi_received: 'RECEIVED',
  yi_save_draft: 'Save as draft', yi_issue: 'Issue invoice',
  yi_draft_saved: 'saved as a draft', yi_issued_toast: 'issued and sent to OG System',
  yi_draft_deleted: 'draft deleted', yi_need_a_line: 'Add at least one shirt first',
  yi_record_payment: 'Record a payment', yi_amount: 'Amount received',
  yi_half: 'Half', yi_full: 'Full balance',
  yi_payment_saved: 'payment recorded', yi_bad_amount: 'That is more than the balance',
  yi_paper: 'Paper version', yi_brand_mode: 'Branded version',
  yi_msg_issued: 'Invoice issued —', yi_due_in: 'due in',

  /* OG side */
  og_partner_inv: 'Partner invoices', og_pay_now: 'Pay this invoice',
  og_owed_to: 'Owed to Yalla Wear', og_nudge: 'Nudge the partner',
  og_nudge_sent: 'sent to Yalla Wear', og_confirm_names: 'Confirm the names',
  og_names_saved: 'names confirmed — Yalla Wear can print now',
  og_kit_lines: 'Kit lines', og_tbc_warn: 'shirts have no name yet — Yalla Wear cannot print them',
  og_paid_toast: 'marked as paid',
  og_unread_head: 'new messages from Yalla Wear',
  og_unread_sub: 'open the speech bubble in the top bar, or the job itself',
  og_nudge_default: 'The customer is asking about this one — can it move up the queue?',
  og_nudge_hint: 'This lands in Yalla Wear straight away — they see it on the job.',
  og_nothing_changed: 'nothing changed',
  og_names_msg: 'Names confirmed:', og_all_confirmed: 'all names confirmed, you can print',
  og_paid_msg: 'Payment sent:',

  /* notifications */
  nt_title: 'Partner messages', nt_new: 'new', nt_read_all: 'Mark all read',
  nt_you: 'You', nt_empty: 'Nothing yet',
  nt_empty_sub: 'Messages between OG System and Yalla Wear show up here',

  yl_scorecard: 'Your record', yl_scorecard_sub: 'from the stamped history',
  yl_on_time: 'Delivered on time', yl_on_time_sub: 'of finished jobs hit their deadline',
  yl_turnaround: 'Average turnaround', yl_turnaround_sub: 'order taken to delivered'
};

var EXTRA_V3_AR = {
  yl_invoices: 'الفواتير', yl_board: 'لوحة', yl_list: 'قائمة',
  yl_col_empty: 'لا شيء هنا',

  yl_radar: 'رادار المواعيد', yl_radar_sub: '١٤ يوماً القادمة · اضغط يوماً للتصفية',
  yl_late: 'متأخر', yl_heat: 'الطاقة الإنتاجية', yl_per_day: 'قطعة يومياً',
  yl_heat_key: 'هادئ ← محمّل زيادة',

  yl_activity: 'النشاط', yl_activity_sub: 'رسائل وتحديثات وتنبيهات',
  yl_no_activity: 'كل شيء هادئ', yl_no_activity_sub: 'لم يحدث شيء اليوم',
  yl_you: 'أنت', yl_just_now: 'الآن', yl_m: ' د', yl_h: ' س', yl_d: ' ي',
  yl_past_deadline: 'تجاوز الموعد',

  yl_money: 'المال', yl_outstanding: 'مستحق لك', yl_from_og: 'على OG System',
  yl_invoiced_month: 'المقبوض هذا الشهر', yl_avg_pay: 'متوسط مدة السداد',
  yl_avg_pay_sub: 'من الإصدار حتى التحصيل', yl_days: 'يوم',
  yl_unbilled: 'لم تُفوتر بعد', yl_unbilled_sub: 'أعمال مسلّمة',
  yl_view_invoices: 'الفواتير', yl_ageing: 'حسب العمر',

  yl_kit_lines: 'قائمة الطباعة', yl_kit: 'القميص', yl_print: 'الطباعة',
  yl_to_confirm: 'بانتظار التأكيد', yl_tbc: 'غير مؤكد', yl_tbc_pieces: 'قميصاً بلا اسم بعد',
  yl_tbc_filter: 'بانتظار الأسماء',
  yl_blocked_head: 'قميصاً لا يمكن طباعته',
  yl_blocked_sub: 'الزبون لم يختر الاسم بعد، وOG وحده يستطيع تأكيده',
  yl_blocked_toast: 'قميصاً بلا اسم — على OG تأكيدها أولاً',
  yl_blocked_tip: 'موقوف: الأسماء ناقصة',
  yl_request_names: 'اطلب الأسماء من OG',
  yl_names_requested: 'تم إرسال طلب الأسماء إلى OG',
  yl_nothing_pending: 'كل الأسماء مؤكدة',
  yl_need_names: 'أسماء ناقصة على', yl_lines: 'سطر',

  yl_thread: 'الرسائل', yl_messages: 'رسالة', yl_no_messages: 'لا رسائل',
  yl_no_messages_sub: 'لم يُكتب شيء عن هذا الطلب بعد',
  yl_add_note: 'أبلغ OG', yl_reason: 'السبب', yl_message: 'الرسالة',
  yl_note_ph: 'ما الذي يجب أن يعرفه OG؟',
  yl_note_hint: 'تصل إلى OG System فوراً وتظهر لهم على الطلب.',
  yl_note_empty: 'اكتب شيئاً أولاً', yl_note_sent: 'أُرسلت إلى OG System',
  yl_msg_nudge: 'استعجال', yl_msg_delay: 'تأخير', yl_msg_note: 'ملاحظة',
  yl_msg_name_request: 'أسماء مطلوبة', yl_msg_invoice: 'فاتورة',
  yl_msg_reminder: 'تذكير', yl_msg_reply: 'رد',
  yl_reason_fabric_late: 'تأخر توريد القماش', yl_reason_printer_down: 'عطل في المكبس/الطابعة',
  yl_reason_awaiting_names: 'بانتظار تأكيد الأسماء',
  yl_reason_quality_recheck: 'إعادة فحص الجودة', yl_reason_other: 'أخرى',
  yl_recent: 'الأخيرة',

  yi_sub: 'ما له عليك من OG System، ومنذ متى',
  yi_new: 'فاتورة جديدة', yi_from_work: 'من الأعمال المسلّمة',
  yi_mode_blank: 'فاتورة فارغة', yi_mode_work: 'اختر قمصاناً مسلّمة',
  yi_invoice: 'فاتورة', yi_issued: 'تاريخ الإصدار', yi_due: 'الاستحقاق',
  yi_lines: 'البنود', yi_lines_ready: 'بنداً جاهزاً للفوترة',
  yi_paid: 'المدفوع', yi_balance: 'المتبقي',
  yi_st_draft: 'مسودة', yi_st_sent: 'مُرسلة', yi_st_part: 'مدفوعة جزئياً', yi_st_paid: 'مدفوعة',
  yi_ageing_sub: 'الرصيد غير المدفوع حسب عمره منذ الإصدار',
  yi_add_line: 'أضف قميصاً', yi_rows: 'أسطر', yi_price: 'السعر', yi_number: 'الرقم',
  yi_pick_club: 'اختر القميص…', yi_other_club: 'شيء آخر…', yi_club_name: 'اكتب اسم القميص',
  yi_name_ph: 'الاسم على الظهر — اتركه فارغاً إن لم يُحدَّد',
  yi_empty: 'لا شيء في هذه الفاتورة بعد', yi_empty_sub: 'أضف قميصاً للبدء',
  yi_nothing_ready: 'لا شيء للفوترة', yi_nothing_ready_sub: 'كل الأعمال المسلّمة مفوترة',
  yi_note: 'ملاحظات', yi_default_note: 'جميع القمصان مطبوعة · الدفع عند الاستلام.',
  yi_per_kit: 'للقميص، الطباعة مشمولة', yi_terms: 'الدفع عند الاستلام',
  yi_total_due: 'المبلغ المستحق', yi_received: 'الاستلام',
  yi_save_draft: 'حفظ كمسودة', yi_issue: 'إصدار الفاتورة',
  yi_draft_saved: 'حُفظت كمسودة', yi_issued_toast: 'صدرت وأُرسلت إلى OG System',
  yi_draft_deleted: 'حُذفت المسودة', yi_need_a_line: 'أضف قميصاً واحداً على الأقل',
  yi_record_payment: 'تسجيل دفعة', yi_amount: 'المبلغ المقبوض',
  yi_half: 'النصف', yi_full: 'كامل المتبقي',
  yi_payment_saved: 'سُجّلت الدفعة', yi_bad_amount: 'المبلغ أكبر من المتبقي',
  yi_paper: 'نسخة ورقية', yi_brand_mode: 'النسخة المُعلَّمة',
  yi_msg_issued: 'صدرت الفاتورة —', yi_due_in: 'تستحق خلال',

  og_partner_inv: 'فواتير الشريك', og_pay_now: 'سدّد هذه الفاتورة',
  og_owed_to: 'مستحق لـ Yalla Wear', og_nudge: 'استعجل الشريك',
  og_nudge_sent: 'أُرسلت إلى Yalla Wear', og_confirm_names: 'تأكيد الأسماء',
  og_names_saved: 'تم تأكيد الأسماء — يستطيع Yalla Wear الطباعة الآن',
  og_kit_lines: 'بنود القمصان', og_tbc_warn: 'قميصاً بلا اسم — لا يستطيع Yalla Wear طباعتها',
  og_paid_toast: 'وُسمت كمدفوعة',
  og_unread_head: 'رسالة جديدة من Yalla Wear',
  og_unread_sub: 'افتح أيقونة الرسائل في الشريط العلوي، أو الطلب نفسه',
  og_nudge_default: 'الزبون يسأل عن هذا الطلب — هل يمكن تقديمه في الدور؟',
  og_nudge_hint: 'تصل إلى Yalla Wear فوراً وتظهر لهم على الطلب.',
  og_nothing_changed: 'لم يتغيّر شيء',
  og_names_msg: 'تم تأكيد الأسماء:', og_all_confirmed: 'كل الأسماء مؤكدة، يمكنكم الطباعة',
  og_paid_msg: 'تم إرسال دفعة:',

  nt_title: 'رسائل الشريك', nt_new: 'جديدة', nt_read_all: 'تعليم الكل كمقروء',
  nt_you: 'أنت', nt_empty: 'لا شيء بعد',
  nt_empty_sub: 'الرسائل بين OG System وYalla Wear تظهر هنا',

  yl_scorecard: 'سجلّك', yl_scorecard_sub: 'من سجل المراحل الموثّق',
  yl_on_time: 'التسليم في الموعد', yl_on_time_sub: 'من الطلبات المنجزة سُلّمت بموعدها',
  yl_turnaround: 'متوسط مدة الإنجاز', yl_turnaround_sub: 'من استلام الطلب حتى التسليم'
};

var EXTRA_EN = {
  yl_tagline: 'Style That Moves You!', yl_operator: 'Production',
  yl_today: 'Today', yl_today_sub: 'What has to be printed, and by when',
  yl_queue: 'Job queue', yl_queue_sub: 'Late work first, then by deadline',
  yl_earnings: 'Earnings', yl_earnings_sub: 'What OG System owes you, job by job',
  yl_production: 'Production', yl_open_jobs: 'Open jobs', yl_pieces: 'pieces',
  yl_urgent: 'Urgent', yl_due_week: 'Due this week', yl_earned_month: 'Earned this month',
  yl_in_queue: 'waiting in the queue', yl_priority_first: 'printed first',
  yl_line: 'Production line', yl_line_sub: 'tap a stage to filter the queue',
  yl_capacity: 'Capacity this week', yl_vs_capacity: 'against', yl_per_week: 'per week',
  yl_next_up: 'Next up', yl_open: 'Open', yl_jobs: 'jobs',
  yl_urgent_late: 'Urgent & late', yl_all_clear: 'Nothing waiting',
  yl_all_clear_sub: 'Every job in this filter is finished', yl_job: 'Job',
  yl_progress: 'Progress', yl_size_breakdown: 'Sizes to print', yl_payout: 'You get paid',
  yl_piece: 'piece', yl_move_to: 'Move to', yl_moved_to: 'moved to',
  yl_flag: 'Flag a problem', yl_flagged: 'Flagged for OG System — they have been notified',
  yl_invoice_og: 'Invoice OG System', yl_invoice_sent: 'invoice sent',
  yl_unpaid: 'On open jobs', yl_on_open_jobs: 'not invoiced yet', yl_lifetime: 'All time',
  yl_per_piece: 'Average per piece', yl_monthly: 'Earnings by month',
  yl_back_og: '← Back to OG System', yl_partner_of: 'Printing partner of ',
  yl_scope: 'You see only your own jobs and your own pay',
  yl_entered: 'Partner portal — this is all they can see',
  yl_left: 'Back in the admin system', yl_now: 'now', yl_charged: 'Charged to customer',
  yl_billed_to: 'Billed to',

  lb_studio: 'Label studio', lb_template: 'Template', lb_size: 'Label size',
  lb_show: 'Show on label', lb_copies: 'Copies per size',
  lb_copies_hint: 'capped at the stock on hand', lb_sheet: 'Print sheet',
  lb_labels: 'labels', lb_scannable: 'Real EAN-13 · scannable',
  lb_qr: 'QR code', lb_logo: 'Logo', lb_nothing: 'Enter some quantities first',
  lb_price: 'Price tag', lb_shelf: 'Shelf label', lb_hang: 'Hang tag', lb_mini: 'Mini sticker',
  lb_product: 'Product label', lb_custom: 'Custom size',
  lb_fit_warn: 'Bars come out {mm}mm wide on {n} label(s) — under 0.25mm a thermal head cannot print them cleanly and they will not scan. Use a wider label.',
  lb_fit_ok: 'Sized to the label: {mm}mm per bar.',
  lb_no_price_note: 'Prices are left off on purpose. The barcode identifies the shoe; the price lives at the till, so changing a price never means reprinting stickers.',

  ex_generated: 'Generated', ex_footer: 'Generated by OG System',
  ex_pdf_preview: 'PDF preview', ex_save_pdf: 'Print / Save as PDF',
  ex_pdf_hint: 'Choose "Save as PDF" as the destination',
  export_failed: 'Export failed',

  bk_select: 'Select', bk_select_all: 'Select everything the filter matches',
  bk_selected: 'selected', bk_clear: 'Clear selection',
  bk_show: 'Show in shop', bk_hide: 'Hide from shop',
  bk_price: 'Change price', bk_price_pct: 'Adjust by percent',
  bk_price_hint: 'Applies to every selected product, rounded to the nearest 1,000.',
  bk_archive: 'Archive', bk_archived: 'archived', bk_archived_only: 'Archived',
  bk_delete: 'Delete', bk_deleted: 'deleted', bk_delete_title: 'Delete permanently',
  bk_delete_q: 'Delete {n} records?',
  bk_delete_note: 'Archiving is usually what you want — it hides them but keeps the history. Delete cannot be undone once the Undo toast disappears.',
  bk_undo: 'Undo', bk_undo_hint: 'Undo available for a few seconds',
  bk_restored: 'Restored', bk_hidden: 'hidden from the shop', bk_shown: 'visible in the shop',
  bk_message: 'Send WhatsApp', bk_message_hint: 'Each opens WhatsApp with the message ready to send.',
  bk_log_all: 'Mark all as sent', bk_logged: 'logged as sent',
  bk_points: '+250 points', bk_advance: 'Move to next stage', bk_done: 'Mark done',
  bk_moved: 'jobs moved', bk_sent: 'orders sent to Yalla Wear',

  ex_scan: 'Scan to open', ex_till: 'Till PDF',
  rec_statement: 'Customer statement', rec_stock_sheet: 'Stock sheet',
  yl_work_order: 'Work order'
};

var EXTRA_AR = {
  yl_tagline: 'ستايل يحرّكك!', yl_operator: 'الإنتاج',
  yl_today: 'اليوم', yl_today_sub: 'ما يجب طباعته ومتى',
  yl_queue: 'قائمة الطلبات', yl_queue_sub: 'المتأخر أولاً ثم حسب موعد التسليم',
  yl_earnings: 'الأرباح', yl_earnings_sub: 'ما يترتب على OG لك، طلباً بطلب',
  yl_production: 'الإنتاج', yl_open_jobs: 'طلبات مفتوحة', yl_pieces: 'قطعة',
  yl_urgent: 'مستعجل', yl_due_week: 'مستحق هذا الأسبوع', yl_earned_month: 'أرباح هذا الشهر',
  yl_in_queue: 'بانتظار الطباعة', yl_priority_first: 'تُطبع أولاً',
  yl_line: 'خط الإنتاج', yl_line_sub: 'اضغط مرحلة لتصفية القائمة',
  yl_capacity: 'الطاقة هذا الأسبوع', yl_vs_capacity: 'مقابل', yl_per_week: 'أسبوعياً',
  yl_next_up: 'التالي', yl_open: 'فتح', yl_jobs: 'طلب',
  yl_urgent_late: 'مستعجل ومتأخر', yl_all_clear: 'لا يوجد شيء بالانتظار',
  yl_all_clear_sub: 'كل الطلبات في هذا الفلتر منجزة', yl_job: 'الطلب',
  yl_progress: 'مراحل التنفيذ', yl_size_breakdown: 'القياسات المطلوبة', yl_payout: 'مستحقاتك',
  yl_piece: 'قطعة', yl_move_to: 'نقل إلى', yl_moved_to: 'انتقل إلى',
  yl_flag: 'الإبلاغ عن مشكلة', yl_flagged: 'تم إبلاغ OG System بالمشكلة',
  yl_invoice_og: 'إرسال فاتورة إلى OG', yl_invoice_sent: 'أُرسلت الفاتورة',
  yl_unpaid: 'على الطلبات المفتوحة', yl_on_open_jobs: 'لم تُفوتر بعد', yl_lifetime: 'الإجمالي الكلي',
  yl_per_piece: 'متوسط سعر القطعة', yl_monthly: 'الأرباح حسب الشهر',
  yl_back_og: '→ العودة إلى OG System', yl_partner_of: 'شريك الطباعة لـ ',
  yl_scope: 'ترى طلباتك ومستحقاتك فقط',
  yl_entered: 'واجهة الشريك — هذا كل ما يراه', yl_left: 'عدنا إلى نظام الإدارة',
  yl_now: 'الآن', yl_charged: 'المحصّل من الزبون', yl_billed_to: 'الفاتورة إلى',

  lb_studio: 'استوديو الملصقات', lb_template: 'القالب', lb_size: 'قياس الملصق',
  lb_show: 'ما يظهر على الملصق', lb_copies: 'نسخ لكل قياس',
  lb_copies_hint: 'بحد أقصى الكمية المتوفرة', lb_sheet: 'ورقة الطباعة',
  lb_labels: 'ملصق', lb_scannable: 'باركود EAN-13 حقيقي · قابل للمسح',
  lb_qr: 'رمز QR', lb_logo: 'الشعار', lb_nothing: 'أدخل الكميات أولاً',
  lb_price: 'بطاقة سعر', lb_shelf: 'ملصق رف', lb_hang: 'بطاقة معلّقة', lb_mini: 'ملصق صغير',
  lb_product: 'ملصق منتج', lb_custom: 'قياس خاص',
  lb_fit_warn: 'عرض الخطوط بيطلع {mm} ملم على {n} ملصق — تحت ٠٫٢٥ ملم الطابعة الحرارية ما بتقدر تطبعها نظيفة وما رح تنقرأ. استعمل ملصق أعرض.',
  lb_fit_ok: 'متقاس على الملصق: {mm} ملم لكل خط.',
  lb_no_price_note: 'الأسعار مقصود ما تنطبع. الباركود بيعرّف الحذاء، والسعر بيضلّ عالكاشير — فتغيير السعر أبداً ما بيحتاج إعادة طباعة الملصقات.',

  ex_generated: 'تاريخ الإصدار', ex_footer: 'صادر عن نظام OG',
  ex_pdf_preview: 'معاينة PDF', ex_save_pdf: 'طباعة / حفظ PDF',
  ex_pdf_hint: 'اختر "حفظ كـ PDF" كوجهة للطباعة',
  export_failed: 'فشل التصدير',

  bk_select: 'تحديد', bk_select_all: 'تحديد كل ما يطابق الفلتر',
  bk_selected: 'محدد', bk_clear: 'إلغاء التحديد',
  bk_show: 'إظهار بالمتجر', bk_hide: 'إخفاء عن المتجر',
  bk_price: 'تعديل السعر', bk_price_pct: 'التعديل بالنسبة المئوية',
  bk_price_hint: 'يُطبّق على كل منتج محدد، مقرّباً لأقرب ١٠٠٠.',
  bk_archive: 'أرشفة', bk_archived: 'مؤرشف', bk_archived_only: 'المؤرشف',
  bk_delete: 'حذف', bk_deleted: 'محذوف', bk_delete_title: 'حذف نهائي',
  bk_delete_q: 'حذف {n} سجل؟',
  bk_delete_note: 'الأرشفة غالباً هي المطلوب — تخفيها وتحتفظ بالسجل. الحذف لا يمكن التراجع عنه بعد اختفاء التنبيه.',
  bk_undo: 'تراجع', bk_undo_hint: 'التراجع متاح لثوانٍ',
  bk_restored: 'تمت الاستعادة', bk_hidden: 'أُخفيت عن المتجر', bk_shown: 'ظاهرة بالمتجر',
  bk_message: 'إرسال واتساب', bk_message_hint: 'كل زر يفتح واتساب والرسالة جاهزة للإرسال.',
  bk_log_all: 'اعتبارها مُرسلة', bk_logged: 'سُجّلت كمُرسلة',
  bk_points: '+٢٥٠ نقطة', bk_advance: 'نقل للمرحلة التالية', bk_done: 'إنهاء',
  bk_moved: 'طلب تم نقله', bk_sent: 'طلب أُرسل ليلا وير',

  ex_scan: 'امسح للفتح', ex_till: 'تقرير الصندوق',
  rec_statement: 'كشف حساب الزبون', rec_stock_sheet: 'كشف المخزون',
  yl_work_order: 'أمر عمل'
};

Object.keys(EXTRA_EN).forEach(function (k) { I18N.en[k] = EXTRA_EN[k]; });
Object.keys(EXTRA_AR).forEach(function (k) { I18N.ar[k] = EXTRA_AR[k]; });
Object.keys(EXTRA_V3_EN).forEach(function (k) { I18N.en[k] = EXTRA_V3_EN[k]; });
Object.keys(EXTRA_V3_AR).forEach(function (k) { I18N.ar[k] = EXTRA_V3_AR[k]; });

/* -------------------------------------------------------------- 19. ACTIONS */

var ACTIONS = {
  nav: function (el) { go(el.getAttribute('data-view')); },
  'nav-close': function (el) { closeDrawer(); go(el.getAttribute('data-view')); },

  lang: function (el) {
    OG.lang = el.getAttribute('data-val');
    applyLang();
    refreshAll();
    toast(OG.lang === 'ar' ? 'اللغة العربية' : 'English', OG.lang === 'ar' ? 'تم قلب الواجهة لليمين' : 'Interface switched', 'ok');
  },

  curr: function (el) {
    OG.currency = el.getAttribute('data-val');
    renderTopbar();
    render();
    toast(OG.currency, '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP', 'ok', 2000);
  },

  bell: function (el, e) {
    e.stopPropagation();
    var existing = document.getElementById('notifPop');
    if (existing) { existing.remove(); return; }
    var pop = document.createElement('div');
    pop.id = 'notifPop';
    pop.className = 'notif-pop';
    var h = '<h4>' + t('notifications') + ' · ' + DB.notifications.length + '</h4>';
    DB.notifications.forEach(function (n, i) {
      h += '<div class="notif-row" data-act="notif-go" data-i="' + i + '">' +
        '<span class="notif-dot ' + n.tone + '">' + n.icon + '</span><span>' + n.text + '</span></div>';
    });
    pop.innerHTML = h;
    document.getElementById('topbar').appendChild(pop);
  },

  'notif-go': function (el) {
    var n = DB.notifications[+el.getAttribute('data-i')];
    var pop = document.getElementById('notifPop'); if (pop) pop.remove();
    go(n.view);
  },

  /* --- account ------------------------------------------------------------ */

  acct: function (el, e) {
    e.stopPropagation();
    var existing = document.getElementById('acctPop');
    if (existing) { existing.remove(); return; }

    var u = acct();
    if (!u) return;

    var pop = document.createElement('div');
    pop.id = 'acctPop';
    pop.className = 'acct-pop';
    pop.innerHTML = accountPopHtml(u);
    document.getElementById('topbar').appendChild(pop);
  },

  'acct-pw': function () {
    var pop = document.getElementById('acctPop'); if (pop) pop.remove();
    closeModal();
    openChangePassword();
  },

  'acct-pw-save': function (el) {
    var cur = document.getElementById('pwCur');
    var a = document.getElementById('pwNew');
    var b = document.getElementById('pwNew2');
    var err = document.getElementById('pwErr');
    if (!cur || !a || !b) return;

    var show = function (m) { if (err) err.textContent = m; };

    /* Catch the mismatch here rather than after a round trip — the server
       cannot check it, since it only ever receives one new password. */
    if (a.value !== b.value) { show(t('pw_mismatch')); b.select(); return; }
    if (!cur.value || !a.value) { show(t('pw_mismatch')); return; }

    el.disabled = true;
    show('');

    API.post('/api/auth/password', { current: cur.value, next: a.value })
      .then(function () {
        closeModal();
        toast(t('pw_changed'), t('pw_reauth'), 'ok', 5000);
        /* Every session died, this one included. Give the toast a moment to
           be read, then let the login screen come back. */
        setTimeout(function () { location.reload(); }, 1800);
      })
      .catch(function (e2) {
        el.disabled = false;
        show(API.friendly(e2));
      });
  },

  'acct-out': function () {
    var pop = document.getElementById('acctPop'); if (pop) pop.remove();
    closeModal();
    toast(t('sign_out'), t('signing_out'), 'ok', 1500);
    Auth.logout();
  },

  /* The A4 invoice is still there for anyone who wants a full page — a
     wholesale customer, or a copy for the file. */
  'rc-invoice': function (el) {
    var s = DB.sale(el.getAttribute('data-id'));
    closeModal();
    if (s) openInvoice(s);
  },

  'modal-close': closeModal,
  'modal-backdrop': function (el, e) { if (e.target === el) closeModal(); },
  'drawer-close': closeDrawer,
  'print-now': function () { setRollPageSize(); window.print(); },

  export: function (el) {
    var spec = currentExportSpec();
    if (!spec || !spec.rows || !spec.rows.length) { toast(t('export_failed'), t('none'), 'warn'); return; }
    spec.kind = el.getAttribute('data-kind') === 'excel' ? 'xlsx' : 'pdf';
    Export.run(spec);
  },

  /* Single-record sheets, launched from the record's own drawer. */
  'export-rec': function (el) {
    var type = el.getAttribute('data-rec'), id = el.getAttribute('data-id');
    var spec = type === 'customer' ? customerStatementSpec(+id)
             : type === 'product'  ? productSheetSpec(+id)
             : jobSheetSpec(id);
    if (!spec || !spec.rows.length) { toast(t('export_failed'), t('none'), 'warn'); return; }
    spec.kind = el.getAttribute('data-kind') === 'excel' ? 'xlsx' : 'pdf';
    closeDrawer();
    Export.run(spec);
  },

  'search-prod': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var id = +el.getAttribute('data-id');
    go('products', function () { openProductDrawer(id); });
  },
  'search-cust': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var id = +el.getAttribute('data-id');
    go('customers', function () { openCustomerDrawer(id); });
  },
  'search-inv': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var s = DB.sale(el.getAttribute('data-id'));
    if (s) openInvoice(s);
  },

  'alert-fix': function (el) {
    var a = buildAlerts()[+el.getAttribute('data-i')];
    if (!a) return;
    if (a.tab) OG.rep.tab = a.tab;
    if (a.filter) OG.cust.filter = a.filter;
    go(a.view, a.pid ? function () { openProductDrawer(a.pid); } : null);
  },

  'open-invoice': function (el) {
    var s = DB.sale(el.getAttribute('data-id'));
    if (s) openInvoice(s);
  },

  'open-product': function (el) { openProductDrawer(+el.getAttribute('data-id')); },
  'open-customer': function (el) { openCustomerDrawer(+el.getAttribute('data-id')); },
  whatsapp: function (el) { openWhatsapp(+el.getAttribute('data-id')); },
  'day-summary': function () { openDaySummary(); },

  'prod-sort': function (el) {
    var k = el.getAttribute('data-k');
    if (OG.prod.sort === k) OG.prod.dir *= -1; else { OG.prod.sort = k; OG.prod.dir = 1; }
    render();
  },
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
  reorder: function (el) { openReorder(+el.getAttribute('data-id')); },

  'po-create': function (el) {
    var pid = +el.getAttribute('data-id');
    var p = DB.product(pid);
    var lines = [];
    document.querySelectorAll('[data-po-qty][data-pid="' + pid + '"]').forEach(function (inp) {
      var qty = parseInt(inp.value, 10) || 0;
      if (qty > 0) lines.push({ productId: pid, size: inp.getAttribute('data-size'), qty: qty, cost: p.costPrice });
    });
    if (!lines.length) { toast(t('reorder'), t('po_need_qty'), 'warn'); return; }

    var supId = +(document.getElementById('poSupplier') || {}).value || DB.supplierFor(p).id;
    var po = DB.newPO(supId, lines, p.name);
    DB.sendPO(po);

    closeModal();
    render();
    toast(po.id + ' → ' + DB.supplier(supId).name,
      DB.poPieces(po) + ' ' + t('pieces') + ' · ' + money(DB.poTotal(po)), 'ok', 5000, {
        label: t('po_whatsapp'),
        attrs: 'data-act="po-whatsapp" data-id="' + po.id + '"'
      });
  },

  /* Send the order to the supplier on WhatsApp — which is how these orders
     are actually placed here, not by email. */
  'po-whatsapp': function (el) {
    var po = DB.po(el.getAttribute('data-id'));
    if (!po) return;
    var sup = DB.supplier(po.supplierId);
    var body = po.lines.map(function (l) {
      var p = DB.product(l.productId);
      return '• ' + p.name + ' — ' + t('size') + ' ' + l.size + ' × ' + l.qty;
    }).join('\n');
    WA.compose({
      title: po.id + ' · ' + sup.name,
      to: sup.contact, name: sup.name, kind: 'purchase-order',
      text: 'مرحباً ' + sup.name + '،\n\nطلبية جديدة ' + po.id + ':\n\n' + body +
            '\n\nالإجمالي: ' + money(DB.poTotal(po)) + '\n— ' + CONFIG.SHOP_NAME,
      note: DB.poPieces(po) + ' ' + t('pieces') + ' · ' + money(DB.poTotal(po))
    });
  },

  'po-receive': function (el) {
    var po = DB.po(el.getAttribute('data-id'));
    if (!po || po.status === 'received') return;

    /* Purchase orders themselves have no server table yet — they live in this
       browser. The STOCK they raise does not: an arrival that only exists here
       would be gone on the next reload while the boxes are on the floor. So
       the pieces go through the same receive endpoint a scan uses, and the
       order's own paperwork is updated afterwards. */
    var lines = po.lines.map(function (l) {
      var v = DB.variants.filter(function (x) {
        return x.productId === l.productId && x.size === l.size;
      })[0];
      return v ? { sku: v.sku, qty: l.qty } : null;
    }).filter(Boolean);

    Shop.write(
      function () {
        return Promise.all(lines.map(function (l) {
          return Shop.receive(l.sku, DB.intakeWh, l.qty, 'Received on ' + po.id);
        }));
      },
      function () { DB.receivePO(po); },
      function () {
        /* In live mode the stock is already booked and re-read, so only the
           order's own state is left to move — passing `true` stops it raising
           the same pieces a second time. */
        if (Shop.live()) DB.receivePO(po, true);
        render();
        toast(po.id, DB.poPieces(po) + ' ' + t('pieces') + ' · ' + t('po_received_toast'), 'ok', 4000);

        /* Offer to print a label for every piece that just arrived — the
           `lines` list here is the exact same {sku, qty} breakdown Shop.receive
           was just called with, one entry per variant on the order. */
        if (allow('label.print') && typeof Labels !== 'undefined' && lines.length) {
          Labels.openPreviewModal(lines, Labels.lastChoice().preset, Labels.lastChoice().station);
        }
      }
    );
  },
  'labels-for': function (el) { openLabelSheet(+el.getAttribute('data-id')); },

  'variant-attach-save': function (el) {
    var sku = el.getAttribute('data-sku');
    var code = el.getAttribute('data-code');
    var digits = String(code || '').replace(/\D/g, '');
    /* A real EAN-13 goes on `barcode`; a shorter numeric code (what a
       thermal label's Code128 actually carries) goes on `labelCode`.
       Anything else still goes on `barcode` — a supplier code that isn't a
       clean 13-digit EAN is still the code printed on the box. */
    var isLabelCode = digits.length === code.length && digits.length > 0 && digits.length <= 8;
    var patch = isLabelCode ? { labelCode: code } : { barcode: code };

    function apply() {
      var v = DB.variantBySku(sku);
      if (v) { if (patch.barcode) v.barcode = patch.barcode; if (patch.labelCode) v.labelCode = patch.labelCode; }
      closeModal();
      toast(t('lbl_attach_code'), (v && DB.product(v.productId) || {}).name || sku, 'ok', 3000);
    }

    if (typeof Auth === 'undefined' || Auth.demoMode()) { apply(); return; }
    API.patch('/api/variants/' + encodeURIComponent(sku), patch)
      .then(function (res) {
        var v = DB.variantBySku(sku);
        if (v && res.variant) { v.barcode = res.variant.barcode; v.labelCode = res.variant.label_code; }
        closeModal();
        toast(t('lbl_attach_code'), res.variant ? res.variant.name : sku, 'ok', 3000);
      })
      .catch(function (err) { toast(t('lbl_attach_code'), API.friendly(err), 'err', 6000); });
  },
  'open-job': function (el) { openJobDrawer(el.getAttribute('data-jid')); },

  'lb-tpl': function (el) {
    OG.lb.template = el.getAttribute('data-k');
    /* switching template re-enables its own fields so nothing looks broken */
    var tpl = LABEL_TEMPLATES[OG.lb.template];
    OG.lb.barcode = !!tpl.barcode; OG.lb.qr = !!tpl.qr;
    OG.lb.price = !!tpl.price; OG.lb.size2 = !!tpl.size;
    OG.lb.shelf = !!tpl.shelf; OG.lb.logo = !!tpl.logo;
    repaintLabels();
  },
  'lb-size': function (el) { OG.lb.size = el.getAttribute('data-k'); repaintLabels(); },

  'rc-width': function (el) {
    OG.rc.width = el.getAttribute('data-k');
    /* Re-inject immediately rather than at the next print. If the rule only
       updated when a receipt was opened, a cashier could change the paper
       here, print from a screen still holding the old @page, and get an 80mm
       layout on a 58mm roll with the right-hand column shaved off. */
    setReceiptPageSize();
    if (OG.view === 'settings') render();
  },
  'lb-mode': function (el) {
    OG.lb.mode = el.getAttribute('data-k');
    if (OG.view === 'settings') { render(); } else { repaintLabels(); }
  },

  /* Just flips which chip is lit — rc-save-config reads the choice straight
     back off this element when the card is actually saved. */
  'rc-cut': function (el) {
    var row = document.getElementById('rcCutMode');
    if (!row) return;
    row.setAttribute('data-v', el.getAttribute('data-k'));
    Array.prototype.forEach.call(row.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c === el);
    });
  },

  'rc-save-config': function (el) {
    if (!allow('config.write') || typeof Auth === 'undefined' || Auth.demoMode()) return;
    var updates = {
      'receipt.printer_host': (document.getElementById('rcHost') || {}).value || '',
      'receipt.printer_port': (document.getElementById('rcPort') || {}).value || '9100',
      'shop.branch_name':     (document.getElementById('rcBranch') || {}).value || '',
      'shop.phone':           (document.getElementById('rcPhone') || {}).value || '',
      'receipt.auto_print':   (document.getElementById('rcAutoPrint') || {}).checked ? '1' : '0',
      'receipt.copies':       (document.getElementById('rcCopies') || {}).value || '2',
      'receipt.cut_mode':     ((document.getElementById('rcCutMode') || {}).getAttribute &&
                                document.getElementById('rcCutMode').getAttribute('data-v')) || 'partial',
      'receipt.show_qr':      (document.getElementById('rcShowQr') || {}).checked ? '1' : '0',
      'receipt.show_barcode': (document.getElementById('rcShowBarcode') || {}).checked ? '1' : '0',
      'receipt.show_loyalty': (document.getElementById('rcShowLoyalty') || {}).checked ? '1' : '0',
      'receipt.footer_ar':    (document.getElementById('rcFooterAr') || {}).value || '',
      'receipt.footer_en':    (document.getElementById('rcFooterEn') || {}).value || '',
      'receipt.policy_ar':    (document.getElementById('rcPolicyAr') || {}).value || '',
      'receipt.policy_en':    (document.getElementById('rcPolicyEn') || {}).value || ''
    };
    el.disabled = true;
    API.put('/api/config', { updates: updates })
      .then(function (res) {
        if (typeof DB !== 'undefined' && DB.hydrate) DB.hydrate({ config: res.config });
        toast(t('rc3_title'), t('rc3_saved'), 'ok', 3000);
        if (OG.view === 'settings') render();
      })
      .catch(function (err) {
        el.disabled = false;
        toast(t('rc3_title'), API.friendly(err), 'err', 6000);
      });
  },

  'lbl-save-config': function (el) {
    if (!allow('config.write') || typeof Auth === 'undefined' || Auth.demoMode()) return;
    var updates = {
      'label.transport':    (document.getElementById('lblTransport') || {}).value || 'agent',
      'label.printer_host': (document.getElementById('lblHost') || {}).value || '',
      'label.density':      (document.getElementById('lblDensity') || {}).value || '8',
      'label.gap_mm':       (document.getElementById('lblGap') || {}).value || '2'
    };
    el.disabled = true;
    API.put('/api/config', { updates: updates })
      .then(function (res) {
        if (typeof DB !== 'undefined' && DB.hydrate) DB.hydrate({ config: res.config });
        toast(t('lbl_title'), t('lbl_saved'), 'ok', 3000);
        if (OG.view === 'settings') render();
      })
      .catch(function (err) {
        el.disabled = false;
        toast(t('lbl_title'), API.friendly(err), 'err', 6000);
      });
  },

  /* One label, printed now, so the roll and the driver can be proved before
     a hundred stickers are committed to it. */
  'hw-test-label': function () {
    var v = DB.variants.filter(function (x) { return x.qty > 0; })[0] || DB.variants[0];
    OG.lb.pids = null;
    OG.lb.pid = v.productId;
    openLabelSheet(v.productId);
  },
  'hw-calibrate': function () { openCalibration(); },
  'lb-sym':  function (el) { OG.lb.sym  = el.getAttribute('data-k'); repaintLabels(); },
  'lb-toggle': function (el) { var k = el.getAttribute('data-k'); OG.lb[k] = !OG.lb[k]; repaintLabels(); },

  /* ---- the order handshake, OG's actions -------------------------------- */

  /* Show exactly what crosses the boundary before it crosses. The printer is
     another company: an order they cannot fulfil costs both sides a day, so
     the confirm step is a real review, not an "are you sure". */
  'or-send': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job) return;
    var why = DB.canSendOrder(job);
    if (why) { toast(t('or_cannot'), t('or_why_' + (why === 'tbc' ? 'tbc' : why === 'already-sent' ? 'sent' : 'accepted')), 'err'); return; }

    var pv = DB.partnerView(job);
    var body = '<div class="ord-review">' +
      '<div class="ord-rv-row"><span>' + t('design_note') + '</span><b>' + esc(job.design) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('total_pieces') + '</span><b>' + job.qty + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('size') + '</span><b>' +
        Object.keys(pv.sizes || {}).map(function (k) { return k + ' ×' + pv.sizes[k]; }).join(' · ') + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('deadline') + '</span><b>' + fmtDate(job.deadline) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('priority') + '</span><b>' + t(job.priority) + '</b></div>' +
      '<div class="ord-rv-row"><span>' + t('yl_payout') + '</span><b>' + money(job.cost) + '</b></div>' +
    '</div>' +
    '<div class="partner-note mt">' + t('or_send_hint') + '</div>';

    openModal({
      title: t('or_send_title') + ' · ' + job.id,
      size: 'narrow',
      body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="or-send-go" data-id="' + job.id + '">' + t('or_send') + '</button>'
    });
  },

  'or-send-go': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job || !DB.sendOrder(job)) return;
    closeModal();
    closeDrawer();
    /* The toast carries the WhatsApp handoff rather than a second modal: most
       of the time the in-app send is enough, and the ones who also want to
       message have it one tap away without being asked every single time. */
    toast(job.id, t('or_sent_ok'), 'ok', 6000,
          { label: t('or_wa'), attrs: 'data-act="or-wa" data-id="' + job.id + '"' });
    Notify.refresh();
    render();
  },

  /* Opens WhatsApp with the order written out. wa.me hands off — it cannot
     send on the user's behalf, and the wording never claims it did. */
  'or-wa': function (el) {
    var job = DB.job(el.getAttribute('data-id'));
    if (!job) return;
    var sizes = Object.keys(job.sizes || {}).map(function (k) { return k + '×' + job.sizes[k]; }).join(' · ');
    var text = 'طلب طباعة جديد · ' + job.id + '\n\n' +
      job.design + '\n' +
      'العدد: ' + job.qty + ' قطعة\n' +
      (sizes ? 'القياسات: ' + sizes + '\n' : '') +
      'موعد التسليم: ' + fmtDate(job.deadline) + '\n' +
      (job.priority === 'urgent' ? '⚡ مستعجل\n' : '') +
      'المستحق: ' + money(job.cost) + '\n\n' +
      '— ' + CONFIG.SHOP_NAME;
    WA.compose({
      to: '+963 932 887 190',            /* Yalla Wear, from the supplier list */
      name: CONFIG.PRINT_PARTNER,
      kind: 'order',
      title: t('or_wa_title') + ' · ' + job.id,
      text: text
    });
  },

  'wh-tab': function (el) { OG.wh.tab = el.getAttribute('data-tab'); render(); },

  /* The shortcuts on the warehouse home. Same as wh-tab, but it has to travel
     to the screen first — wh-tab alone would set the tab and re-render the
     home he is already standing on. */
  'home-wh': function (el) {
    OG.wh.tab = el.getAttribute('data-tab');
    go('warehouse');
  },
  'wh-place': function (el) { OG.wh.place = el.getAttribute('data-w'); render(); },

  /* One tap on a suggested move: carry it out of the back and onto the wall. */
  'wh-move-now': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    var n = parseInt(el.getAttribute('data-n'), 10) || 1;
    if (!v) return;

    /* Refused here rather than sent and refused there, so the message names
       the place instead of quoting a server error at a warehouse worker. */
    var have = DB.stockAt(v, DB.intakeWh);
    if (have <= 0) { toast(t('wh_none_here'), '', 'err'); return; }
    var want = Math.min(n, have);

    var p = DB.product(v.productId);
    Shop.write(
      function () { return Shop.transfer(v.sku, DB.intakeWh, DB.defaultWh, want, t('wh_move_done')); },
      function () { DB.transfer(v, DB.intakeWh, DB.defaultWh, want, t('admin')); },
      function () {
        toast(t('wh_move_done'),
              p.name + ' · ' + t('size') + ' ' + v.size + ' — ' + want + ' ' + t('pieces'),
              'ok');
        render();
      }
    );
  },

  /* Per-product transfer: choose a size, a direction and a quantity. */
  'wh-transfer': function (el) { openTransfer(+el.getAttribute('data-id')); },

  'wh-transfer-go': function () {
    var sku  = document.getElementById('trSku');
    var from = document.getElementById('trFrom');
    var to   = document.getElementById('trTo');
    var qty  = document.getElementById('trQty');
    if (!sku || !from || !to || !qty) return;

    if (from.value === to.value) { toast(t('wh_transfer'), t('wh_from') + ' = ' + t('wh_to'), 'err'); return; }
    var v = DB.variantBySku(sku.value);
    if (!v) return;

    var f = from.value, tgt = to.value;
    var want = Math.min(parseInt(qty.value, 10) || 0, DB.stockAt(v, f));
    if (want <= 0) { toast(t('wh_transfer'), t('out_of_stock'), 'err'); return; }

    var p = DB.product(v.productId);
    Shop.write(
      function () { return Shop.transfer(v.sku, f, tgt, want, t('wh_transfer')); },
      function () { DB.transfer(v, f, tgt, want, t('admin')); },
      function () {
        closeModal();
        toast(t('wh_move_done'),
              p.name + ' · ' + t('size') + ' ' + v.size + ' — ' + want + ' ' + t('pieces') + ' · ' +
                DB.whName(f, OG.lang === 'ar') + ' → ' + DB.whName(tgt, OG.lang === 'ar'),
              'ok');
        render();
      }
    );
  },
  /* Opens the real file picker. This used to pick a random colour from a
     palette and toast "Image uploaded", which is why choosing a picture
     appeared to fail — nothing was ever read from disk. */
  'wh-image': function () {
    var input = document.getElementById('whFile');
    if (input) input.click();
  },

  'wh-image-clear': function () {
    OG.wh.imgSrc = null;
    OG.wh.img = null;
    render();
  },

  /* The colour block is still offered — it is genuinely the faster choice
     when he is entering thirty items and has no photos. */
  'wh-image-colour': function () {
    var palette = ['#4A4A52', '#3E5C8A', '#8E3B3B', '#B5822F', '#6B5B45', '#6455A0', '#3A5478', '#2F5744'];
    OG.wh.imgSrc = null;
    OG.wh.img = palette[Math.floor(Math.random() * palette.length)];
    render();
  },
  'wh-labels': function () { openLabelSheet(null); },

  'cu-new': function (el) {
    openNewCustomer(el.getAttribute('data-q') || '', null);
  },

  'cu-save': function () {
    var name = ((document.getElementById('cuName') || {}).value || '').trim();
    var phone = ((document.getElementById('cuPhone') || {}).value || '').trim();
    var city = ((document.getElementById('cuCity') || {}).value || '').trim();

    if (!name) {
      toast(t('cu_new'), OG.lang === 'ar' ? 'اكتب الاسم' : 'Enter a name', 'err');
      return;
    }

    /* Same name AND same phone is a duplicate; same name alone is two people
       called Ahmad, which in Aleppo is most of them. */
    var dupe = DB.customers.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() &&
             (!phone || c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    })[0];
    if (dupe) {
      closeModal();
      toast(t('cu_new'), t('cu_exists') + ' · ' + esc(dupe.name), 'warn', 5000);
      if (OG.cuOnCreated) OG.cuOnCreated(dupe);
      OG.cuOnCreated = null;
      return;
    }

    var after = OG.cuOnCreated;
    OG.cuOnCreated = null;

    Shop.write(
      function () {
        return Shop.newCustomer({ name: name, phone: phone, city: city, source: 'in-store' });
      },
      function () {
        /* Demo mode only. Nothing is saved, so the id just has to be unique
           within this page's lifetime. */
        var c = {
          id: DB.customers.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1,
          name: name, phone: phone, city: city, source: 'in-store', address: '', note: '',
          loyaltyPoints: 0, totalSpent: 0, lastPurchaseDate: null,
          archived: false, history: []
        };
        DB.customers.push(c);
        return { customer: c };
      },
      function (res) {
        closeModal();
        /* Re-found by id after the reload rather than kept from the response:
           in live mode the object in DB.customers is a fresh one, and handing
           the caller the stale copy is how a till ends up holding a customer
           the rest of the app cannot see. */
        var made = res && res.customer;
        var c = made ? (DB.customer(made.id) || made) : null;
        render();
        if (c) {
          toast(t('cu_new'), c.name + (c.phone ? ' · ' + c.phone : ''), 'ok', 3500);
          if (after) after(c);
        }
      }
    );
  },
  /* Actually creates the product now. It used to toast and throw the form
     away, which meant a picture the user had just chosen vanished with it —
     the same frustration as the upload not working. */
  'wh-save': function () {
    var name = (document.getElementById('whName') || {}).value || OG.wh.name;
    var pieces = Object.keys(OG.wh.sizes).reduce(function (a, k) { return a + (Number(OG.wh.sizes[k]) || 0); }, 0);
    if (!name) { toast(t('product_name'), OG.lang === 'ar' ? 'اكتب اسم المنتج' : 'Enter a product name', 'err'); return; }
    if (!pieces) { toast(t('size_matrix'), OG.lang === 'ar' ? 'أدخل الكميات' : 'Enter quantities per size', 'err'); return; }

    /* Stop a second SKU for a shoe already in the catalogue — unless he has
       looked at the match and said it really is a different product. */
    var dupes = DB.similarProducts(name);
    if (dupes.length && !OG.wh.dupeOk) { openDuplicateGuard(name, dupes); return; }
    OG.wh.dupeOk = false;

    var cost = Number((document.getElementById('whCost') || {}).value) || 0;
    var price = Number((document.getElementById('whPrice') || {}).value) || 0;
    var sizes = OG.wh.sizes;
    var skus = Object.keys(sizes).filter(function (k) { return sizes[k]; }).length;
    var imgSrc = OG.wh.imgSrc, bg = OG.wh.img;

    /* A photo has nowhere to go on the server yet — the products table stores
       a colour block, which is what every screen draws. Said out loud rather
       than dropped, because he just chose the file and would otherwise watch
       it disappear with no explanation. */
    if (imgSrc && Shop.live()) {
      toast(t('save_product'),
            OG.lang === 'ar'
              ? 'الصورة لا تُحفظ بعد على الخادم — سيُستخدم المربّع اللوني.'
              : 'Photos are not stored on the server yet — the colour block is used.',
            'warn', 6000);
    }

    Shop.write(
      function () {
        return Shop.newProduct({
          name: name,
          type: OG.wh.type,
          /* Entered in the shop's base currency. Whole units for SYP, which
             is what minor_exp 0 means — the number typed is the number
             stored. */
          currency: CONFIG.BASE_CURRENCY,
          costPrice: cost,
          sellingPrice: price,
          imageBg: bg || undefined,
          sizes: Object.keys(sizes)
            .filter(function (s) { return Number(sizes[s]) > 0; })
            .map(function (s) { return { size: s, qty: Number(sizes[s]) }; }),
          /* Opening stock arrives at the back door, like any delivery. */
          whId: DB.intakeWh
        });
      },
      function () {
        return DB.newProduct({
          name: name, type: OG.wh.type, cost: cost, price: price,
          sizes: sizes, imgSrc: imgSrc, bg: bg
        });
      },
      function (res) {
        var id = res && (res.productId !== undefined ? res.productId : res.id);

        OG.wh.sizes = {}; OG.wh.name = ''; OG.wh.img = null; OG.wh.imgSrc = null;
        render();

        /* Take him to the thing he just made — a toast alone leaves you
           wondering whether it worked. */
        toast(t('save_product'), name + ' · ' + pieces + ' pcs · ' + skus + ' SKU', 'ok', 5000,
              id ? { label: t('view_all'),
                     attrs: 'data-act="open-new-product" data-id="' + id + '"' } : null);
      }
    );
  },

  /* "It really is a different product" — remembered for exactly one save, so
     the guard is back on for the next one. */
  'dup-anyway': function () {
    OG.wh.dupeOk = true;
    closeModal();
    ACTIONS['wh-save']();
  },

  'dup-open': function (el) {
    closeModal();
    go('products', function () { openProductDrawer(+el.getAttribute('data-id')); });
  },

  'open-new-product': function (el) {
    var id = +el.getAttribute('data-id');
    go('products', function () { openProductDrawer(id); });
  },

  'rep-tab': function (el) { OG.rep.tab = el.getAttribute('data-tab'); render(); },

  /* One scan entry point, used by the topbar, the tab bar, POS and the
     product pages, so the camera behaves identically everywhere. */
  'scan-open': function () {
    closeModal();
    Scan.open({ onHit: function (code) { openScanResult(code); } });
  },

  'scan-to-pos': function (el) {
    var code = el.getAttribute('data-code');
    var n = scanQty();
    closeModal();
    go('pos', function () {
      for (var i = 0; i < n; i++) POS.scanBarcode(code, i > 0);
    });
  },

  /* ---- putting stock away and taking it out, straight off a scan --------
     Both go through DB.moveStock, so they land in the same movement log as a
     sale, a delivery or a transfer. There is exactly one way stock changes in
     this system and a barcode scanner does not get to be a second one. */
  'sc-qty': function (el) {
    var box = document.getElementById('scQty');
    if (!box) return;
    var d = parseInt(el.getAttribute('data-d'), 10) || 0;
    box.value = Math.max(1, (parseInt(box.value, 10) || 1) + d);
  },

  'sc-in': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    if (!v) return;
    var n = scanQty(), wh = scanPlace();
    var p = DB.product(v.productId);

    Shop.write(
      function () { return Shop.receive(v.sku, wh, n, t('sc_in_note')); },
      function () {
        DB.moveStock(v, wh, n, {
          type: 'received', note: t('sc_in_note'), user: t('admin')
        });
      },
      function () {
        closeModal();
        toast(t('sc_checked_in'),
              p.name + ' · ' + v.size + ' · +' + n + ' → ' + DB.whName(wh, OG.lang === 'ar'),
              'ok');
        render();
      }
    );
  },

  'sc-out': function (el) {
    var v = DB.variantBySku(el.getAttribute('data-sku'));
    if (!v) return;
    var n = scanQty(), wh = scanPlace();
    var have = DB.stockAt(v, wh);
    if (have <= 0) {
      /* Refuse rather than clamp silently. Taking out what is not there is
         how a stock figure quietly stops matching the shelf. */
      toast(t('sc_cannot_out'), t('wh_none_here') + ' · ' + DB.whName(wh, OG.lang === 'ar'), 'err');
      return;
    }
    var moved = Math.min(n, have);
    var p = DB.product(v.productId);

    Shop.write(
      /* A removal that is not a sale. writeOff is the server's name for it —
         stock leaving without an invoice — and it lands in the same movement
         log, which is the point: anything that changes a count has to be
         explainable afterwards. */
      function () { return Shop.writeOff(v.sku, wh, moved, t('sc_out_note')); },
      function () {
        DB.moveStock(v, wh, -moved, {
          type: 'transfer', note: t('sc_out_note'), user: t('admin')
        });
      },
      function () {
        closeModal();
        toast(t('sc_checked_out'),
              p.name + ' · ' + v.size + ' · −' + moved + ' ' + t('wh_from') + ' ' +
                DB.whName(wh, OG.lang === 'ar') +
                (moved < n ? ' (' + t('sc_only_had') + ' ' + moved + ')' : ''),
              'ok');
        render();
      }
    );
  },

  'more-sheet': function () { openMoreSheet(); },
  'more-go': function (el) { closeModal(); go(el.getAttribute('data-view')); },

  'pr-tab': function (el) {
    OG.pr = OG.pr || {};
    OG.pr.tab = el.getAttribute('data-tab');
    render();
  },

  'og-open-inv': function (el) { openPartnerInvoice(el.getAttribute('data-id')); },

  /* OG settles the bill. This writes into the same invoice object the partner
     portal renders, so switching portals shows it already paid — no sync. */
  'og-pay-inv': function (el) {
    var inv = DB.invoice(el.getAttribute('data-id'));
    if (!inv) return;
    var bal = DB.invoiceBalance(inv);
    if (bal <= 0) return;
    DB.payInvoice(inv, bal, 'cash');
    DB.postMessage({ invoiceId: inv.id, from: 'og', kind: 'invoice',
      text: t('og_paid_msg') + ' ' + money(bal) + ' — ' + inv.id });
    closeModal();
    toast(inv.id, money(bal) + ' · ' + t('og_paid_toast'), 'ok', 3200);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
  },

  /* Fill in the names Yalla Wear is waiting on. Reads the inputs already in
     the drawer rather than opening a second form on top of the first. */
  'og-confirm-names': function (el) {
    var id = el.getAttribute('data-id');
    var job = DB.job(id);
    if (!job) return;
    var before = DB.tbcCount(job);

    document.querySelectorAll('[data-og-line][data-jid="' + id + '"]').forEach(function (inp) {
      var l = DB.line(id, inp.getAttribute('data-lid'));
      if (!l) return;
      var f = inp.getAttribute('data-og-line');
      if (f === 'print') l.print = (inp.value || '').toUpperCase().trim() || null;
      if (f === 'number') l.number = inp.value === '' ? null : +inp.value;
    });

    var after = DB.tbcCount(job);
    if (after === before) { toast(id, t('og_nothing_changed'), 'warn'); return; }

    DB.postMessage({ jobId: id, from: 'og', kind: 'reply',
      text: t('og_names_msg') + ' ' + (before - after) + ' — ' +
            (after ? after + ' ' + t('yl_tbc_pieces') : t('og_all_confirmed')) });

    closeDrawer();
    toast(id, after ? (after + ' ' + t('yl_tbc') + ' ' + t('yl_lines')) : t('og_names_saved'),
          after ? 'warn' : 'ok', 3600);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
  },

  'og-nudge': function (el) {
    var id = el.getAttribute('data-id');
    if (!DB.job(id)) return;
    openModal({
      title: t('og_nudge') + ' · ' + id,
      body: '<label class="field"><span>' + t('yl_message') + '</span>' +
              '<textarea class="inp" id="ogNudgeText" rows="3">' +
                esc(t('og_nudge_default')) + '</textarea></label>' +
            '<div class="partner-note mt">' + t('og_nudge_hint') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-act="og-nudge-send" data-id="' + id + '">' + t('send') + '</button>'
    });
  },

  'og-nudge-send': function (el) {
    var id = el.getAttribute('data-id');
    var text = ((document.getElementById('ogNudgeText') || {}).value || '').trim();
    if (!text) { toast(t('og_nudge'), t('yl_note_empty'), 'warn'); return; }
    DB.postMessage({ jobId: id, from: 'og', kind: 'nudge', text: text });
    closeModal();
    closeDrawer();
    toast(id, t('og_nudge_sent'), 'ok', 3200);
    render();
    if (typeof Notify !== 'undefined') Notify.refresh();
  },

  'partner-view': function () {
    /* This is the manager's preview of what Yalla Wear sees. For Yalla Wear
       themselves it is the way out of their own portal, so there is no way
       out. Nothing renders this button for them; this is the belt to that
       brace. */
    if (isPartnerAccount()) return;
    OG.print.partner = !OG.print.partner;
    /* A portal switch is the biggest context change in the app — it earns a
       full entrance, and it always reads as going forward. */
    if (typeof Motion !== 'undefined') { OG.dir = 'fwd'; Motion.mark(); }
    if (OG.print.partner) YALLA.reset();
    closeDrawer();
    renderSidebar();
    renderTopbar();
    render();
    toast(OG.print.partner ? 'YALLA WEAR' : CONFIG.SHOP_NAME.toUpperCase(),
          t(OG.print.partner ? 'yl_entered' : 'yl_left'), 'ok', 2400);
  },

  'st-open': function (el) { OG.store.screen = 'pd'; OG.store.productId = +el.getAttribute('data-id'); OG.store.size = null; renderStore(); },
  'st-size': function (el) { OG.store.size = el.getAttribute('data-size'); renderStore(); },
  'st-back': function () {
    var s = OG.store;
    s.screen = (s.screen === 'checkout') ? 'cart' : 'grid';
    renderStore();
  },
  'st-cart': function () { OG.store.screen = 'cart'; renderStore(); },
  'st-add': function () {
    var s = OG.store, p = DB.product(s.productId);
    s.cart.push({ productId: p.id, name: p.name, size: s.size, price: p.sellingPrice, qty: 1 });
    toast(t('add_to_cart'), p.name + ' · ' + s.size, 'ok', 1800);
    s.screen = 'cart';
    renderStore();
  },
  'st-remove': function (el) { OG.store.cart.splice(+el.getAttribute('data-i'), 1); renderStore(); },
  'st-checkout': function () { OG.store.screen = 'checkout'; renderStore(); },
  'st-place': function () {
    var s = OG.store;
    if (!s.cart.length) return;
    var total = s.cart.reduce(function (a, x) { return a + x.qty * x.price; }, 0);
    var order = {
      id: DB.nextOrderId(),
      name: (document.getElementById('stName') || {}).value || 'Online customer',
      phone: (document.getElementById('stPhone') || {}).value || '+963 9xx xxx xxx',
      city: (document.getElementById('stCity') || {}).value || 'Damascus',
      items: s.cart.map(function (l) { return l.name + ' — ' + l.size + ' ×' + l.qty; }).join(', '),
      total: total,
      payment: (document.getElementById('stPay') || {}).value || 'cod',
      status: 'pending',
      date: new Date(),
      fresh: true
    };
    DB.storeOrders.unshift(order);
    s.cart = []; s.screen = 'grid'; s.productId = null; s.size = null;
    renderSidebar();
    render();
    toast(t('order_placed'), order.id + ' · ' + money(total), 'ok');
  },
  'order-confirm': function (el) {
    var o = DB.storeOrders[+el.getAttribute('data-i')];
    o.status = 'confirmed';
    renderSidebar();
    render();
    toast(t('confirmed'), o.id + ' · ' + o.name, 'ok');
  },

  /* Every field applies as it is typed, so by the time this is pressed the
     settings are already live. It reports what actually changed rather than
     claiming to have performed a save that never existed. */
  'settings-save': function () {
    render();
    toast(t('save_changes'),
      '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' · ' +
      CONFIG.LOYALTY_POINTS_PER_1000 + ' ' + t('points').toLowerCase() + '/1,000 · ' +
      esc(CONFIG.SHOP_NAME), 'ok', 3600);
  },

  'tour-next': function () { Tour.go(Tour.i + 1); },
  'tour-back': function () { Tour.go(Tour.i - 1); },
  'tour-skip': function () { Tour.stop(); },
  'new-sale': function () { closeModal(); go('pos'); }
};

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

/* ------------------------------------------------------------------ 20. BOOT */

function bindGlobal() {
  document.addEventListener('click', function (e) {
    /* Bulk owns its own namespace — never let a checkbox also open a drawer. */
    if (e.target.closest && e.target.closest('[data-bk]')) return;

    var el = e.target.closest ? e.target.closest('[data-act]') : null;

    /* close the notification popover when clicking elsewhere */
    var pop = document.getElementById('notifPop');
    if (pop && !pop.contains(e.target) && (!el || el.getAttribute('data-act') !== 'bell')) pop.remove();

    /* same for the account menu. Clicks INSIDE it must survive, or the item
       being clicked is removed before its own handler runs. */
    var ap = document.getElementById('acctPop');
    if (ap && !ap.contains(e.target) && (!el || el.getAttribute('data-act') !== 'acct')) ap.remove();

    /* close the global search dropdown */
    var sr = document.getElementById('searchResults');
    if (sr && sr.innerHTML && !e.target.closest('.search')) sr.innerHTML = '';

    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'globalSearch') { runSearch(el.value); return; }
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && el.tagName !== 'SELECT' && el.type !== 'checkbox') CHANGES[k](el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && (el.tagName === 'SELECT' || el.type === 'checkbox')) CHANGES[k](el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modalOpen()) { closeModal(); return; }
      if (document.getElementById('drawer-root').firstChild) { closeDrawer(); return; }
      if (Tour.on) { Tour.stop(); return; }
      var sc = Bulk.scope();
      if (sc && Bulk.count(sc)) { Bulk.clear(sc); render(); Bulk.paint(); }
    }
    if (Tour.on && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var fwd = (e.key === 'ArrowRight') !== (OG.lang === 'ar');
      Tour.go(Tour.i + (fwd ? 1 : -1));
    }
  });

  window.addEventListener('resize', function () { if (Tour.on) Tour.paint(); });
  window.addEventListener('hashchange', function () {
    var raw = window.location.hash;
    if (handleDeepLink(raw)) return;
    var v = raw.replace('#', '');
    if (v && VIEWS[v] && v !== OG.view) go(v);
  });

  document.getElementById('tourBtn').addEventListener('click', function () { Tour.start(); });
}

/* ---- thermal roll page sizing --------------------------------------------
   `@page { size: … }` is the one property that cannot be driven by a CSS
   variable or a class — the browser reads it from the stylesheet at print
   time, so the rule has to be WRITTEN with the numbers in it.

   Called immediately before window.print(). In roll mode each label becomes a
   page of exactly its own size with no margin; in sheet mode the A4 rule the
   app has always used is restored. */
function setRollPageSize() {
  var id = 'rollPageRule';
  var old = document.getElementById(id);
  if (old) old.parentNode.removeChild(old);

  var roll = OG.lb.mode === 'roll';
  document.body.classList.toggle('roll-labels', roll);
  if (!roll) return;

  var dim = labelDim();
  var st = document.createElement('style');
  st.id = id;
  st.textContent = '@media print{@page{size:' + dim.w + 'mm ' + dim.h + 'mm;margin:0}' +
                   'body.roll-labels .blabel{width:' + dim.w + 'mm;height:' + dim.h + 'mm}}';
  document.head.appendChild(st);
}

/* A page of rulers. Thermal printers scale silently when the driver's stock
   size does not match the roll that is actually loaded, and a barcode printed
   at 94% simply stops scanning — with nothing on screen to suggest why. The
   only honest test is to print a known length and measure it. */
function openCalibration() {
  var dim = labelDim();
  var body =
    '<div class="cal-sheet" style="width:' + dim.w + 'mm">' +
      '<div class="cal-row"><span class="cal-rule h"></span><small>10 mm</small></div>' +
      '<div class="cal-row"><span class="cal-rule v"></span><small>10 mm tall</small></div>' +
      '<div class="cal-row"><small>' + dim.w + ' &times; ' + dim.h + ' mm</small></div>' +
      '<div class="cal-row">' + Codes.code128SVG('OG-CAL-10MM', { module: 1.2, height: 26 }) + '</div>' +
    '</div>';

  openModal({
    title: t('hw_calibrate'),
    size: 'narrow',
    body: body + '<div class="partner-note mt no-print">' + t('hw_calibrate_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-primary" data-act="print-now">' + t('print') + '</button>'
  });
}

/* ---- the hardware scanner, everywhere ------------------------------------
   A cable, dongle or Bluetooth scanner types wherever the cursor happens to
   be. Before this, a scan only registered when the POS search box was focused;
   from the dashboard or the warehouse it went nowhere.

   One rule: every scan opens the product sheet, on every screen. Predictable
   beats clever — the person holding the scanner should never have to think
   about which page they are on. */
function bindWedge() {
  if (typeof Wedge === 'undefined') return;

  Wedge.onScan(function (code) {
    /* The hardware settings page owns the scanner while it is open, or its
       own test box would fire the product sheet on every test scan. */
    if (OG.view === 'settings' && OG.set && OG.set.captureScans) return;

    /* A second scan of the same code confirms whatever the sheet is already
       offering, so a fast cashier never has to reach for the keyboard. */
    var open = document.getElementById('scPrimary');
    if (open && open.getAttribute('data-code') === code) { open.click(); return; }

    closeModal();
    openScanResult(code);
  });
}

function boot() {
  applyLang();

  /* Yalla Wear signs in and is already inside their portal. Set before the
     first paint, so there is no frame in which the shop's dashboard is on
     screen — and set here rather than by hiding the toggle, because the
     toggle is a button and buttons can be clicked from a console. */
  if (isPartnerAccount()) OG.print.partner = true;

  /* deliveries.js adds its own handlers to the shared ACTIONS table. Done at
     boot rather than at load time because ACTIONS is a var in this file and
     script order should not decide whether the buttons work. */
  if (typeof Deliveries !== 'undefined') Deliveries.register();
  if (typeof Receipt !== 'undefined') Receipt.register();
  if (typeof Labels !== 'undefined') Labels.register();

  renderTopbar();
  var raw = window.location.hash;
  var v = raw.replace('#', '');
  OG.view = (v && VIEWS[v]) ? v : 'dashboard';

  /* The same guard go() applies, because the case go()'s comment names — a
     bookmarked #settings — arrives HERE, not there. Landing straight on a
     screen from the address bar skipped the check entirely: a cashier with
     #settings saved would have rendered the roles grid, half-filled from data
     the server then refuses. */
  if (!navAllowed(OG.view)) {
    var firstAllowed = allowedNav()[0];
    OG.view = firstAllowed ? firstAllowed.id : 'dashboard';
  }
  /* First paint gets the full entrance — this is the moment he first sees
     the app, and it is the one time the animation is unambiguously worth it. */
  if (typeof Motion !== 'undefined') Motion.mark();
  renderSidebar();
  render();
  bindGlobal();
  bindWedge();
  /* a scanned QR lands here — route after the shell exists */
  if (raw.indexOf('#open/') === 0) handleDeepLink(raw);

  if (!Charts.has()) {
    console.info('Chart.js unavailable — charts fall back to CSS bars.');
  }
  setTimeout(function () {
    toast('OG System', OG.lang === 'ar' ? 'جاهز للعرض — اضغط "جولة العرض"' : 'Ready — press "Demo tour" to begin', 'ok', 4200);
  }, 700);
}

/* The login holds boot() back on http(s) until someone is signed in; on
   file:// there is no server to ask, so it releases immediately and the app
   runs on demo data. Double-clicking index.html behaves exactly as before.

   In live mode the shop's real data is loaded BEFORE the first paint. Drawing
   the seeded catalogue first and swapping it underneath would put invented
   prices on screen for a moment, and a cashier who scanned in that moment
   would be looking at a product the server does not have. */
function start() {
  if (typeof Auth === 'undefined') return boot();

  Auth.guard(function () {
    if (Auth.demoMode() || typeof Shop === 'undefined') return boot();
    /* No fallback to demo data on failure. A till that boots anyway is a till
       that takes real money into memory nobody keeps. */
    Shop.load().then(boot, Shop.fail);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
