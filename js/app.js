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
  wh:   { tab: 'add', type: 'sneakers', sizes: {}, name: '', img: null },
  rep:  { tab: 'sales' },
  print:{ partner: false },
  store:{ screen: 'grid', productId: null, size: null, cart: [] },
  cust: { q: '', filter: 'all' },
  lb:   { pid: null, template: 'price', size: '50x30', max: 4,
          barcode: true, qr: true, price: true, size2: true, shelf: true, logo: true }
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
    image: 'Image', upload_hint: 'Click to upload', product_name: 'Product name',
    cost_price: 'Cost price', selling_price: 'Selling price', shelf_box: 'Shelf / box',
    size_matrix: 'Quantity per size', matrix_hint: 'Enter a quantity — a barcode is generated for each size',
    print_labels: 'Print barcode labels', save_product: 'Save product to warehouse',
    barcode_preview: 'Generated barcodes', movement: 'Movement', user: 'User',
    balance: 'Balance after', received: 'Received', sold: 'Sold', damaged: 'Damaged',
    returned: 'Return', transfer: 'Transfer', label_sheet: 'Barcode labels',
    total_pieces: 'Total pieces', total_cost: 'Total cost', expected_revenue: 'Expected revenue',

    customers_title: 'Customers', customers_sub: 'Who buys, what they buy, when they stopped',
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
    image: 'الصورة', upload_hint: 'اضغط للرفع', product_name: 'اسم المنتج',
    cost_price: 'سعر التكلفة', selling_price: 'سعر البيع', shelf_box: 'الرف / الصندوق',
    size_matrix: 'الكمية لكل قياس', matrix_hint: 'أدخل الكمية — يتم توليد باركود لكل قياس',
    print_labels: 'طباعة ملصقات الباركود', save_product: 'حفظ المنتج في المستودع',
    barcode_preview: 'الباركودات المولّدة', movement: 'الحركة', user: 'المستخدم',
    balance: 'الرصيد بعدها', received: 'وارد', sold: 'مبيع', damaged: 'تالف',
    returned: 'مرتجع', transfer: 'نقل', label_sheet: 'ملصقات الباركود',
    total_pieces: 'إجمالي القطع', total_cost: 'إجمالي التكلفة', expected_revenue: 'الإيراد المتوقع',

    customers_title: 'الزبائن', customers_sub: 'من يشتري وماذا يشتري ومتى توقّف',
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
  var ap = hh >= 12 ? 'PM' : 'AM'; var h12 = hh % 12 || 12;
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

function thumb(p, cls) {
  return '<span class="thumb ' + (cls || '') + '" style="background:' + p.image.bg + '">' + p.image.initials + '</span>';
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

function openModal(o) {
  closeModal();
  var root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop" data-act="modal-backdrop">' +
      '<div class="modal ' + (o.size || '') + '">' +
        (o.title ? '<div class="modal-head"><h3>' + o.title + '</h3>' +
          '<button class="x" data-act="modal-close" aria-label="Close">&times;</button></div>' : '') +
        '<div class="modal-body">' + o.body + '</div>' +
        (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  if (o.onOpen) o.onOpen(root);
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
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

function productsExportSpec() {
  var rows = productRows();
  return {
    name: 'products', sheet: 'Products', title: t('products_title'),
    docUrl: deepLink('report', 'inventory'),
    subtitle: rows.length + ' / ' + DB.products.length + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('product'), width: 32 }, { label: t('brand') }, { label: t('type') },
              { label: t('stock'), num: true }, { label: exCol(t('cost')), num: true },
              { label: exCol(t('price')), num: true }, { label: t('margin') },
              { label: t('health') }, { label: t('visible') }],
    rows: rows.map(function (r) {
      return [r.p.name, r.p.brand, DB.typeLabels[r.type], r.qty, exMoney(r.cost), exMoney(r.price),
              pct(r.margin, 0), t(r.health) + (DB.sizeGaps(r.p.id).length ? ' · ' + t('size_gap') : ''),
              r.p.hidden ? t('no') : t('yes')];
    }),
    totals: [t('total'), null, null, rows.reduce(function (a, r) { return a + r.qty; }, 0), null, null, null, null, null],
    kpis: [{ label: t('st_products'), value: nf(DB.products.length) },
           { label: t('total_pieces'), value: nf(rows.reduce(function (a, r) { return a + r.qty; }, 0)) },
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
      return [o.id, o.name, o.phone, o.city, o.items, DB.paymentLabels[o.payment], t(o.status), exMoney(o.total)];
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
              DB.paymentLabels[s.payment], exMoney(s.total)];
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
    return [s.id, fmtDateTime(s.date), s.customerName, DB.paymentLabels[s.payment],
            s.items.reduce(function (a, i) { return a + i.qty; }, 0), exMoney(s.total)];
  });
  Object.keys(byPay).forEach(function (k) {
    rows.push(['— ' + t('payment'), DB.paymentLabels[k], '', '', null, exMoney(byPay[k])]);
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
              DB.paymentLabels[s.payment], exMoney(s.total),
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
    case 'dashboard':  return dashboardExportSpec();
    case 'pos':        return posExportSpec();
    case 'settings':   return settingsExportSpec();
    case 'reports':    return reportExportSpec();
    case 'products':   return productsExportSpec();
    case 'customers':  return customersExportSpec();
    case 'warehouse':  return warehouseExportSpec();
    case 'print':      return printJobsExportSpec();
    case 'storefront': return ordersExportSpec();
    default:           return salesExportSpec();
  }
}

/* -------------------------------------------------------------- 5. SHELL */

var NAV = [
  { id: 'dashboard',  key: 'nav_dashboard', group: 'main', icon: 'M3 12h4l2 6 4-13 2 7h6' },
  { id: 'pos',        key: 'nav_pos',       group: 'main', icon: 'M3 4h3l2 10h9l2-7H7M9 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0' },
  { id: 'products',   key: 'nav_products',  group: 'main', icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
  { id: 'warehouse',  key: 'nav_warehouse', group: 'main', icon: 'M3 20V9l9-5 9 5v11M7 20v-7h10v7' },
  { id: 'customers',  key: 'nav_customers', group: 'ops',  icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
  { id: 'print',      key: 'nav_print',     group: 'ops',  icon: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z' },
  { id: 'reports',    key: 'nav_reports',   group: 'ops',  icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'storefront', key: 'nav_storefront',group: 'ops',  icon: 'M4 8h16l-1 12H5zM9 8V6a3 3 0 0 1 6 0v2' },
  { id: 'settings',   key: 'nav_settings',  group: 'ops',  icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z' }
];

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
      '<div class="brand-text"><b>OG SYSTEM</b><span>' + t('tagline') + '</span></div>' +
    '</div><nav class="nav">';

  ['main', 'ops'].forEach(function (g) {
    html += '<div class="nav-label">' + t(g === 'main' ? 'nav_main' : 'nav_ops') + '</div>';
    NAV.filter(function (n) { return n.group === g; }).forEach(function (n) {
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
    '<button class="icon-btn" data-act="bell" title="' + t('notifications') + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="M18 16V10a6 6 0 1 0-12 0v6l-2 3h16zM10 21h4"/></svg>' +
      '<span class="bell-badge">' + DB.notifications.length + '</span>' +
    '</button>' +
    '<div class="user-chip"><span class="user-avatar">A</span><span>' + t('admin') + '</span></div>';
}

/* --------------------------------------------------------- 6. GLOBAL SEARCH */

function runSearch(q) {
  var box = document.getElementById('searchResults');
  if (!box) return;
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; return; }

  var prods = DB.products.filter(function (p) {
    return p.name.toLowerCase().indexOf(q) > -1 || p.brand.toLowerCase().indexOf(q) > -1;
  }).slice(0, 5);
  var custs = DB.customers.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
  }).slice(0, 4);
  var invs = DB.sales.filter(function (s) { return s.id.toLowerCase().indexOf(q) > -1; }).slice(0, 3);

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
      '<button class="btn btn-primary" data-act="nav" data-view="pos">' + t('nav_pos') + '</button>' +
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
        '<div class="card-actions"><button class="btn btn-ghost btn-sm" data-act="nav" data-view="reports">' + t('view_all') + '</button></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th><th>' + t('items') + '</th>' +
          '<th>' + t('payment') + '</th><th>' + t('date') + '</th><th class="num">' + t('total') + '</th>' +
        '</tr></thead><tbody>';

  DB.sales.slice(0, 5).forEach(function (s) {
    h += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td>' +
      '<td>' + esc(s.customerName) + '</td>' +
      '<td class="muted">' + s.items.length + ' × ' + esc(s.items[0].name.slice(0, 22)) + (s.items.length > 1 ? '…' : '') + '</td>' +
      '<td><span class="badge neutral">' + DB.paymentLabels[s.payment] + '</span></td>' +
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

/* -------------------------------------------------------------- 8. PRODUCTS */

var PROD_COLS = [
  { k: 'name',   label: 'product' },
  { k: 'type',   label: 'type' },
  { k: 'qty',    label: 'stock', num: true },
  { k: 'cost',   label: 'cost',  num: true },
  { k: 'price',  label: 'price', num: true },
  { k: 'margin', label: 'margin', num: true },
  { k: 'health', label: 'health' },
  { k: 'hidden', label: 'visible' }
];

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

  var order = { out: 0, critical: 1, low: 2, healthy: 3 };
  rows.sort(function (a, b) {
    var x = a[f.sort], y = b[f.sort];
    if (f.sort === 'health') { x = order[x]; y = order[y]; }
    if (typeof x === 'string') return x.localeCompare(y) * f.dir;
    return (x - y) * f.dir;
  });
  return rows;
}

function viewProducts() {
  var rows = productRows();
  var types = Object.keys(DB.typeLabels);

  var h = '<div class="page-head"><div><h1>' + t('products_title') + '</h1>' +
    '<div class="sub">' + t('products_sub') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      '<button class="btn btn-primary" data-act="nav" data-view="warehouse">+ ' + t('tab_add') + '</button>' +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.prod.q) + '" data-change="prod-q">' +
    '<select class="inp" data-change="prod-type"><option value="">' + t('all_types') + '</option>';
  types.forEach(function (ty) {
    h += '<option value="' + ty + '"' + (OG.prod.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
  });
  h += '</select><select class="inp" data-change="prod-health"><option value="">' + t('all_health') + '</option>';
  ['healthy', 'low', 'critical', 'out', 'gap', 'archived'].forEach(function (hh) {
    h += '<option value="' + hh + '"' + (OG.prod.health === hh ? ' selected' : '') + '>' +
         t(hh === 'gap' ? 'gap_only' : (hh === 'archived' ? 'bk_archived_only' : hh)) + '</option>';
  });
  h += '</select><span class="badge neutral">' + rows.length + ' / ' + DB.products.length + '</span></div>';

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>';
  h += '<th class="bk-col">' + Bulk.headBox('products') + '</th>';
  PROD_COLS.forEach(function (c) {
    var arrow = OG.prod.sort === c.k ? (OG.prod.dir === 1 ? ' ▲' : ' ▼') : '';
    h += '<th class="sortable' + (c.num ? ' num' : '') + '" data-act="prod-sort" data-k="' + c.k + '">' +
         t(c.label) + '<span class="arrow">' + arrow + '</span></th>';
  });
  h += '</tr></thead><tbody>';

  rows.forEach(function (r, ri) {
    var gaps = DB.sizeGaps(r.p.id);
    h += '<tr class="clickable' + (Bulk.has('products', r.p.id) ? ' bk-on' : '') +
         '" data-act="open-product" data-id="' + r.p.id + '">' +
      '<td class="bk-col">' + Bulk.box('products', r.p.id, ri) + '</td>' +
      '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        '<small>' + esc(r.p.brand) + ' · ' + esc(r.p.colorway) +
        (gaps.length ? ' · <span style="color:var(--destructive);font-weight:600">' + t('size') + ' ' + gaps.join('/') + ' = 0</span>' : '') +
        '</small></span></div></td>' +
      '<td><span class="badge neutral">' + DB.typeLabels[r.type] + '</span></td>' +
      '<td class="num"><b>' + nf(r.qty) + '</b> <span class="muted small">' + t('pieces') + '</span></td>' +
      '<td class="num muted">' + money(r.cost) + '</td>' +
      '<td class="num"><b>' + money(r.price) + '</b></td>' +
      '<td class="num">' + pct(r.margin, 0) + '</td>' +
      '<td class="nowrap">' + healthBadge(r.qty) +
        (gaps.length ? ' <span class="badge critical">' + t('size_gap') + '</span>' : '') + '</td>' +
      '<td onclick="event.stopPropagation()"><label class="switch"><input type="checkbox"' +
        (r.p.hidden ? '' : ' checked') + ' data-change="toggle-visible" data-id="' + r.p.id + '"><i></i></label></td>' +
    '</tr>';
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

  body += '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    '<div class="stat"><span class="eyebrow">' + t('total_stock') + '</span><div class="val">' + nf(total) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('stock_value') + '</span><div class="val">' + moneyShort(total * p.costPrice) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('margin') + '</span><div class="val accent">' + pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) + '</div></div>' +
  '</div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('per_size') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + vs.length + ' SKU</span></div></div>' +
    '<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th>' + t('sku') + '</th><th>' + t('barcode') + '</th>' +
      '<th class="num">' + t('qty') + '</th><th>' + t('shelf') + '</th><th>' + t('status') + '</th>' +
    '</tr></thead><tbody>';
  vs.forEach(function (v) {
    body += '<tr' + (v.qty === 0 ? ' class="row-danger"' : '') + '>' +
      '<td><b style="font-family:var(--font-head);font-size:14px">' + v.size + '</b></td>' +
      '<td class="muted num nowrap">' + v.sku + '</td>' +
      '<td class="num muted nowrap">' + v.barcode + '</td>' +
      '<td class="num"><b>' + v.qty + '</b></td>' +
      '<td><span class="badge neutral">' + v.shelf + '</span></td>' +
      '<td>' + healthBadge(v.qty) + '</td></tr>';
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
    '<dt>' + t('cost_price') + '</dt><dd>' + money(p.costPrice) + '</dd>' +
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

  h += '<div class="tabs">' +
    '<button class="tab ' + (OG.wh.tab === 'add' ? 'on' : '') + '" data-act="wh-tab" data-tab="add">' + t('tab_add') + '</button>' +
    '<button class="tab ' + (OG.wh.tab === 'moves' ? 'on' : '') + '" data-act="wh-tab" data-tab="moves">' + t('tab_moves') + '</button>' +
  '</div>';

  h += (OG.wh.tab === 'add') ? whAddTab() : whMovesTab();
  return h;
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

  h += '<div class="grid" style="grid-template-columns:130px minmax(0,1fr);gap:16px;align-items:start">';
  h += '<div><span class="lbl">' + t('image') + '</span>' +
    '<div class="upload-box" data-act="wh-image">' +
      (OG.wh.img
        ? '<span class="up-preview" style="background:' + OG.wh.img + '">' + (OG.wh.name.slice(0, 2).toUpperCase() || 'OG') + '</span>'
        : '<span>+<br><small>' + t('upload_hint') + '</small></span>') +
    '</div></div>';

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
    '<div class="row3">' +
      '<label class="field"><span>' + t('made_in') + '</span><input class="inp" type="text" value="Syria"></label>' +
      '<label class="field"><span>' + t('cost_price') + '</span><input class="inp num" id="whCost" type="number" value="105000" data-change="wh-recalc"></label>' +
      '<label class="field"><span>' + t('selling_price') + '</span><input class="inp num" id="whPrice" type="number" value="225000" data-change="wh-recalc"></label>' +
    '</div>' +
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
  var price = Number(priceEl && priceEl.value) || 225000;
  cost = cost || 105000;
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

  h += '<div class="grid mt" style="grid-template-columns:1fr 1fr">' +
    '<div class="stat"><span class="eyebrow">' + t('total_cost') + '</span><div class="val">' + moneyShort(totalCost) + '</div></div>' +
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
      '<th>' + t('sku') + '</th><th class="num">' + t('qty') + '</th>' +
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
  price: { key: 'lb_price', barcode: 1, qr: 0, price: 1, size: 1, shelf: 0, logo: 1 },
  shelf: { key: 'lb_shelf', barcode: 1, qr: 0, price: 0, size: 1, shelf: 1, logo: 0 },
  hang:  { key: 'lb_hang',  barcode: 0, qr: 1, price: 1, size: 1, shelf: 0, logo: 1 },
  mini:  { key: 'lb_mini',  barcode: 1, qr: 0, price: 0, size: 0, shelf: 0, logo: 0 }
};

var LABEL_SIZES = {
  '50x30': { w: 50, h: 30 },
  '40x30': { w: 40, h: 30 },
  '70x40': { w: 70, h: 40 }
};

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
    var pr = Number(priceEl && priceEl.value) || 225000;
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
  var dim = LABEL_SIZES[OG.lb.size];
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
    txt += '<div class="bl-bc">' + Codes.ean13SVG(r.code, { module: big ? 2 : 1.4, height: big ? 34 : 24 }) + '</div>';
  }
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
  h += '</div></div>';

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

function openWhatsapp(cid) {
  var c = DB.customer(cid);
  var msg = 'مرحباً ' + c.name.split(' ')[0] + '، اشتقنالك! 🖤\n\n' +
    'وصلتنا موديلات جديدة من الأحذية والتيشيرتات، وعندك ' + nf(c.loyaltyPoints) + ' نقطة ولاء ' +
    'تعادل ' + nf(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + ' ل.س جاهزة للاستخدام.\n\n' +
    'مرّ علينا قبل ما تخلص المقاسات.\n— OG · ' + CONFIG.SHOP_ADDRESS;

  openModal({
    title: t('whatsapp_msg') + ' · ' + esc(c.name),
    size: 'narrow',
    body: '<div class="field"><span class="lbl">' + t('phone') + '</span>' +
            '<input class="inp num" dir="ltr" type="text" value="' + esc(c.phone) + '" readonly></div>' +
          '<div class="field"><span class="lbl">' + t('whatsapp_msg') + '</span>' +
            '<textarea class="inp" dir="rtl" rows="8" style="line-height:1.6">' + esc(msg) + '</textarea></div>' +
          '<div class="partner-note">' + (OG.lang === 'ar'
            ? 'آخر شراء: ' + relDate(c.lastPurchaseDate) + ' · إجمالي الإنفاق ' + money(c.totalSpent)
            : 'Last purchase ' + relDate(c.lastPurchaseDate) + ' · lifetime ' + money(c.totalSpent)) + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="whatsapp-send" data-name="' + esc(c.name) + '">' + t('send') + '</button>'
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

  var h = '<div class="page-head"><div><h1>' + t('print_title') + '</h1>' +
    '<div class="sub">' + t('print_sub') + ' · ' + t('drag_hint') + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      '<button class="btn btn-dark" data-act="partner-view">' + t('partner_view') + '</button>' +
    '</div></div>';

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

/* Admin-side job detail. Unlike the partner drawer this shows the full
   commercial picture: who ordered it, what OG charges, what the margin is. */
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

  var body = '<div class="card mb"><div class="card-head"><h3>' + t('yl_progress') + '</h3>' +
    '<div class="card-actions muted small">' + (over
      ? '<span style="color:var(--destructive);font-weight:700">' + t('overdue') + ' ' + DB.daysSince(j.deadline) + 'd</span>'
      : t('deadline') + ' ' + relDate(j.deadline)) + '</div></div>' +
    '<div class="card-body">' + stepper(j.stage, { history: j.history, overdue: over }) + '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('design_note') + '</h3></div>' +
    '<div class="card-body"><p style="margin:0;font-size:14px;line-height:1.6">' + esc(j.design) + '</p></div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('yl_size_breakdown') + '</h3>' +
    '<div class="card-actions"><span class="badge accent">' + j.qty + '</span></div></div>' +
    '<div class="card-body"><div class="yl-sizes lg">' +
      Object.keys(j.sizes || {}).map(function (k) {
        return '<span class="yl-size"><b>' + k + '</b>' + j.sizes[k] + '</span>';
      }).join('') + '</div></div></div>';

  body += '<div class="grid mb" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="stat"><span class="eyebrow">' + t('yl_charged') + '</span><div class="val">' + moneyStat(j.price) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('paid_partner') + '</span><div class="val">' + moneyStat(j.cost) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('profit') + '</span><div class="val accent">' + moneyStat(margin) + '</div>' +
      '<div class="foot">' + pct(margin / j.price * 100, 0) + '</div></div>' +
  '</div>';

  body += '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="job" data-kind="pdf" data-id="' + j.id + '">' + t('yl_work_order') + '</button>' +
    '<button class="btn btn-dark" style="flex:1" data-act="partner-view">' + t('partner_view') + '</button></div>';

  openDrawer({ head: head, body: body });
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
        '<small>' + esc(o.city) + ' · ' + DB.paymentLabels[o.payment] + ' · ' + relDate(o.date) + '</small></div>' +
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
        '<div class="thumb-box" style="background:' + p.image.bg + '">' + p.image.initials + '</div>' +
        '<div class="info"><b>' + esc(p.name) + '</b><span>' + money(p.sellingPrice) + '</span></div></div>';
    });
    return h + '</div>';
  }

  if (s.screen === 'pd') {
    var p = DB.product(s.productId);
    var vs = DB.variantsOf(p.id);
    var picked = vs.filter(function (v) { return v.size === s.size; })[0];
    var h2 = bar + '<div class="st-pd">' +
      '<div class="thumb-box" style="background:' + p.image.bg + '">' + p.image.initials + '</div>' +
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
      DB.paymentMethods.map(function (m) { return '<option value="' + m + '">' + DB.paymentLabels[m] + '</option>'; }).join('') +
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

var PERMISSIONS = [
  ['View dashboard',        1, 1, 1, 0],
  ['Use point of sale',     1, 1, 1, 0],
  ['Give discounts',        1, 1, 0, 0],
  ['View cost prices',      1, 1, 0, 1],
  ['Edit products',         1, 1, 0, 1],
  ['Receive stock',         1, 1, 0, 1],
  ['Write off damaged',     1, 1, 0, 0],
  ['View customer data',    1, 1, 1, 0],
  ['Manage print jobs',     1, 1, 0, 0],
  ['View profit reports',   1, 1, 0, 0],
  ['Pay suppliers',         1, 0, 0, 0],
  ['Manage employees',      1, 0, 0, 0],
  ['Change settings',       1, 0, 0, 0]
];

var REMINDER_RULES = [
  ['Low stock alert', 'Warn when any SKU drops to 3 pieces or fewer', 1],
  ['Size gap alert', 'Warn when a middle size hits zero but the product still has stock', 1],
  ['Dormant customer', 'Flag customers with no purchase for 90 days', 1],
  ['Supplier payment', 'Remind 5 days before a supplier payment is due', 1],
  ['Print deadline', 'Remind 1 day before a print job deadline', 1],
  ['Dead stock', 'Flag products with no sale for 60 days', 0],
  ['Daily closing summary', 'Send the day total on WhatsApp at 22:00', 0]
];

function viewSettings() {
  var h = '<div class="page-head"><div><h1>' + t('settings_title') + '</h1>' +
    '<div class="sub">' + t('settings_sub') + '</div></div>' +
    '<div class="head-actions">' + exportButtons() +
      '<button class="btn btn-primary" data-act="settings-save">' + t('save_changes') + '</button></div></div>';

  h += '<div class="card mb"><div class="card-head"><h3>' + t('roles_perms') + '</h3>' +
    '<div class="card-actions muted small">4 ' + t('role').toLowerCase() + 's · ' + PERMISSIONS.length + ' ' + t('permission').toLowerCase() + 's</div></div>' +
    '<div class="table-wrap"><table class="tbl perm-tbl"><thead><tr><th>' + t('permission') + '</th>' +
      '<th class="pc" style="text-align:center">' + t('role_admin') + '</th>' +
      '<th class="pc" style="text-align:center">' + t('role_manager') + '</th>' +
      '<th class="pc" style="text-align:center">' + t('role_cashier') + '</th>' +
      '<th class="pc" style="text-align:center">' + t('role_warehouse') + '</th></tr></thead><tbody>';
  PERMISSIONS.forEach(function (p) {
    h += '<tr><td>' + p[0] + '</td>';
    for (var i = 1; i <= 4; i++) {
      h += '<td class="pc"><input type="checkbox"' + (p[i] ? ' checked' : '') + (i === 1 ? ' disabled' : '') + '></td>';
    }
    h += '</tr>';
  });
  h += '</tbody></table></div></div>';

  h += '<div class="set-grid">';

  h += '<div class="card"><div class="card-head"><h3>' + t('exchange_rate') + '</h3></div><div class="card-body">' +
    '<label class="field"><span>' + t('rate_hint') + '</span>' +
      '<input class="inp num" id="setRate" type="number" value="' + CONFIG.EXCHANGE_RATE + '" data-change="set-rate"></label>' +
    '<div class="partner-note">1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP · ' +
      (OG.lang === 'ar' ? 'كل الأسعار في النظام تتحدّث فوراً' : 'every price in the system updates instantly') + '</div>' +
  '</div></div>';

  h += '<div class="card"><div class="card-head"><h3>' + t('loyalty_rules') + '</h3></div><div class="card-body">' +
    '<div class="row2">' +
      '<label class="field"><span>' + t('points_per') + '</span><input class="inp num" type="number" value="' + CONFIG.LOYALTY_POINTS_PER_1000 + '"></label>' +
      '<label class="field"><span>' + t('point_value') + '</span><input class="inp num" type="number" value="' + CONFIG.LOYALTY_POINT_VALUE + '"></label>' +
    '</div>' +
    '<div class="partner-note">500 ' + t('points') + ' = ' + money(500 * CONFIG.LOYALTY_POINT_VALUE) + '</div>' +
    '<div class="mt"><div class="lbl">' + t('tier') + '</div>' +
      '<span class="badge bronze">' + t('bronze') + ' 0–' + nf(CONFIG.TIER_SILVER - 1) + '</span> ' +
      '<span class="badge silver">' + t('silver') + ' ' + nf(CONFIG.TIER_SILVER) + '–' + nf(CONFIG.TIER_GOLD - 1) + '</span> ' +
      '<span class="badge gold">' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD) + '+</span></div>' +
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
        '<input class="inp" value="' + CONFIG.SHOP_NAME + '"></label></div>' +
    '</div>' +
    '<div class="lbl">' + t('accent_colour') + '</div>' +
    '<div class="swatch-row" style="margin-bottom:24px">' +
      '<div class="swatch" style="background:#C6FF00;border-color:var(--foreground);border-width:2px"><span>C6FF00</span></div>' +
      '<div class="swatch" style="background:#0A0A0B"><span>0A0A0B</span></div>' +
      '<div class="swatch" style="background:#FAFAFA"><span>FAFAFA</span></div>' +
      '<div class="swatch" style="background:#F87171"><span>F87171</span></div>' +
      '<div class="swatch" style="background:#4ADE80"><span>4ADE80</span></div>' +
    '</div>' +
    '<label class="field"><span>' + t('phone') + '</span><input class="inp num" dir="ltr" value="' + CONFIG.SHOP_ADDRESS + '"></label>' +
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
      DB.paymentLabels[sale.payment] + '</div></div>' +

    '<div class="inv-parties">' +
      '<div><div class="lbl">' + t('bill_to') + '</div><b>' + esc(cust ? cust.name : t('walk_in')) + '</b>' +
        (cust ? '<br><span class="num">' + esc(cust.phone) + '</span><br>' + esc(cust.city) : '') + '</div>' +
      '<div style="text-align:end"><div class="lbl">' + t('served_by') + '</div><b>' + esc(sale.cashier) + '</b><br>' +
        tel(CONFIG.SHOP_ADDRESS) + '</div>' +
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
      '<div class="tr"><span>' + t('payment_method') + '</span><span>' + DB.paymentLabels[sale.payment] + '</span></div>' +
      '<div class="tr grand"><span>' + t('total') + '</span><span>' + money(sale.total) + '</span></div>' +
      (OG.currency === 'SYP' ? '<div class="tr" style="color:#666;font-size:11px"><span></span><span>≈ $' +
        nf(sale.total / CONFIG.EXCHANGE_RATE) + '</span></div>' : '') +
    '</div>' +
  '</div>';

  h += '<div class="inv-loyalty"><span>' + t('points_earned') + '</span><b>+' + nf(earned) + ' ' + t('points') +
    (cust ? ' &nbsp;·&nbsp; <span style="font-weight:400;font-size:11px">' + t('total') + ' ' + nf(cust.loyaltyPoints) + '</span>' : '') + '</b></div>';

  h += '<div class="inv-foot">' + t('thank_you') + ' · ' + CONFIG.SHOP_NAME + ' · ' + tel(CONFIG.SHOP_ADDRESS) + '</div>';
  h += '</div>';
  return h;
}

function openInvoice(sale, opts) {
  opts = opts || {};
  openModal({
    title: t('invoice') + ' ' + sale.id,
    size: 'wide',
    body: invoiceHtml(sale),
    foot: '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('pdf') + '</button>' +
          '<button class="btn" data-act="print-now">' + t('print') + '</button>' +
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
  dashboard: viewDashboard,
  pos: function () { return POS.render(); },
  products: viewProducts,
  warehouse: viewWarehouse,
  customers: viewCustomers,
  print: viewPrint,
  reports: viewReports,
  storefront: viewStorefront,
  settings: viewSettings
};

var AFTER = {
  dashboard: afterDashboard,
  pos: function () { POS.after(); },
  reports: afterReports,
  print: bindKanban
};

function render() {
  Charts.destroyAll();
  var host = document.getElementById('view');
  var partner = OG.print.partner;

  document.body.setAttribute('data-view', partner ? 'yalla' : OG.view);
  if (partner) document.body.setAttribute('data-portal', 'yalla');
  else document.body.removeAttribute('data-portal');

  host.className = 'view fade-in' + (!partner && OG.view === 'pos' ? ' pos-view' : '');
  host.innerHTML = partner ? YALLA.view() : (VIEWS[OG.view] || viewDashboard)();
  host.scrollTop = 0;

  if (partner) { try { YALLA.after(); } catch (e) { console.warn('yalla after', e); } }
  else if (AFTER[OG.view]) { try { AFTER[OG.view](); } catch (e) { console.warn('after hook', e); } }

  try { Bulk.paint(); } catch (e) { console.warn('bulk paint', e); }

  if (OG.pending) { var p = OG.pending; OG.pending = null; try { p(); } catch (e) {} }
}

function go(view, pending) {
  if (!VIEWS[view]) view = 'dashboard';
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
      /* setStage stamps the history so the tracker stays truthful */
      if (!job || !DB.setStage(job, stage)) return;
      toast(job.id + ' → ' + t('print_' + stage), job.customer + ' · ' + job.qty + ' pcs', 'ok');
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
  bk_moved: 'jobs moved',

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
  bk_moved: 'طلب تم نقله',

  ex_scan: 'امسح للفتح', ex_till: 'تقرير الصندوق',
  rec_statement: 'كشف حساب الزبون', rec_stock_sheet: 'كشف المخزون',
  yl_work_order: 'أمر عمل'
};

Object.keys(EXTRA_EN).forEach(function (k) { I18N.en[k] = EXTRA_EN[k]; });
Object.keys(EXTRA_AR).forEach(function (k) { I18N.ar[k] = EXTRA_AR[k]; });

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

  'modal-close': closeModal,
  'modal-backdrop': function (el, e) { if (e.target === el) closeModal(); },
  'drawer-close': closeDrawer,
  'print-now': function () { window.print(); },

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
  'whatsapp-send': function (el) {
    closeModal();
    toast(t('send_whatsapp'), el.getAttribute('data-name'), 'ok');
  },

  'prod-sort': function (el) {
    var k = el.getAttribute('data-k');
    if (OG.prod.sort === k) OG.prod.dir *= -1; else { OG.prod.sort = k; OG.prod.dir = 1; }
    render();
  },
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
  reorder: function (el) {
    var p = DB.product(+el.getAttribute('data-id'));
    toast(t('reorder'), p.name + ' → ' + DB.suppliers[0].name, 'ok');
  },
  'labels-for': function (el) { openLabelSheet(+el.getAttribute('data-id')); },
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
  'lb-toggle': function (el) { var k = el.getAttribute('data-k'); OG.lb[k] = !OG.lb[k]; repaintLabels(); },

  'wh-tab': function (el) { OG.wh.tab = el.getAttribute('data-tab'); render(); },
  'wh-image': function () {
    var palette = ['#4A4A52', '#3E5C8A', '#8E3B3B', '#B5822F', '#6B5B45', '#6455A0', '#3A5478', '#2F5744'];
    OG.wh.img = palette[Math.floor(Math.random() * palette.length)];
    render();
    toast(t('image'), OG.lang === 'ar' ? 'تم رفع الصورة' : 'Image uploaded', 'ok', 1800);
  },
  'wh-labels': function () { openLabelSheet(null); },
  'wh-save': function () {
    var name = (document.getElementById('whName') || {}).value || OG.wh.name;
    var pieces = Object.keys(OG.wh.sizes).reduce(function (a, k) { return a + (Number(OG.wh.sizes[k]) || 0); }, 0);
    if (!name) { toast(t('product_name'), OG.lang === 'ar' ? 'اكتب اسم المنتج' : 'Enter a product name', 'err'); return; }
    if (!pieces) { toast(t('size_matrix'), OG.lang === 'ar' ? 'أدخل الكميات' : 'Enter quantities per size', 'err'); return; }
    toast(t('save_product'), name + ' · ' + pieces + ' pcs · ' + Object.keys(OG.wh.sizes).filter(function (k) { return OG.wh.sizes[k]; }).length + ' SKU', 'ok');
    OG.wh.sizes = {}; OG.wh.name = ''; OG.wh.img = null;
    render();
  },

  'rep-tab': function (el) { OG.rep.tab = el.getAttribute('data-tab'); render(); },

  'partner-view': function () {
    OG.print.partner = !OG.print.partner;
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

  'settings-save': function () { toast(t('save_changes'), OG.lang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved', 'ok'); },

  'tour-next': function () { Tour.go(Tour.i + 1); },
  'tour-back': function () { Tour.go(Tour.i - 1); },
  'tour-skip': function () { Tour.stop(); },
  'new-sale': function () { closeModal(); go('pos'); }
};

var CHANGES = {
  'prod-q': function (el) { OG.prod.q = el.value; render(); focusBack('[data-change="prod-q"]', el.value.length); },
  'prod-type': function (el) { OG.prod.type = el.value; render(); },
  'prod-health': function (el) { OG.prod.health = el.value; render(); },
  'cust-q': function (el) { OG.cust.q = el.value; render(); focusBack('[data-change="cust-q"]', el.value.length); },

  'toggle-visible': function (el) {
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

  'wh-recalc': function (el) {
    var id = el.id, caret = el.value.length;
    render();
    focusBack('#' + id, caret);
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

function boot() {
  applyLang();
  renderTopbar();
  var raw = window.location.hash;
  var v = raw.replace('#', '');
  OG.view = (v && VIEWS[v]) ? v : 'dashboard';
  renderSidebar();
  render();
  bindGlobal();
  /* a scanned QR lands here — route after the shell exists */
  if (raw.indexOf('#open/') === 0) handleDeepLink(raw);

  if (!Charts.has()) {
    console.info('Chart.js unavailable — charts fall back to CSS bars.');
  }
  setTimeout(function () {
    toast('OG System', OG.lang === 'ar' ? 'جاهز للعرض — اضغط "جولة العرض"' : 'Ready — press "Demo tour" to begin', 'ok', 4200);
  }, 700);
}

/* The passcode gate holds boot() back on http(s); on file:// it releases
   immediately, so double-clicking index.html behaves exactly as before. */
function start() {
  if (typeof Gate !== 'undefined') Gate.guard(boot);
  else boot();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
