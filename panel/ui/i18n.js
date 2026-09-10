/* ==========================================================================
   OG SYSTEM — the control panel's own words
   --------------------------------------------------------------------------
   The shop speaks English and Arabic, and the people who open it in the
   morning read Arabic. A launcher that only speaks English is the one screen
   in the system somebody has to be talked through over the phone.

   Its own dictionary rather than the shop's: js/app.js's I18N is thousands of
   keys about tills and invoices, and it only exists once the server is
   answering — which is the exact moment this window cannot rely on. The
   panel must draw with the shop stopped, for the same reason panel.css copies
   the design tokens instead of importing them.

   TWO TABLES, ONE PASS. Every string is written into `en` and `ar` in the
   same edit, never one and then the other: a missing Arabic key falls back to
   English in the middle of a right-to-left sentence, which does not read as a
   missing translation, it reads as a bug.

   Nothing here is formatted. Numbers, addresses and times arrive as values
   and are wrapped in <span dir="ltr"> where they are drawn, because Arabic
   bidi drags a leading digit to the far end of the line — "1 USD = 130 SYP"
   becomes "USD = 130 SYP 1", and "+2" becomes "2+". The shop learned that
   twice; this file does not have to learn it again.
   ========================================================================== */

var PI18N = (function () {
  'use strict';

  var en = {
    /* --------------------------------------------------------- the shell */
    app: 'OG System',
    tools: 'Tools',
    log: 'Technical log',
    back: 'Back',
    close: 'Close',
    cancel: 'Cancel',
    lang: 'العربية',
    langTip: 'Switch to Arabic',
    toolsTip: 'Tools and settings',

    /* ---------------------------------------------------------- the shop */
    /* The lamp is a word, not a sentence. It sits a hand's width from the
       headline that says the same thing at four times the size, and two
       copies of one fact side by side read as a screen with nothing to say. */
    lampOpen: 'Open',
    lampShut: 'Closed',
    lampOpening: 'Opening…',
    lampClosing: 'Closing…',
    lampFailed: 'Did not open',
    lampDied: 'Stopped',
    lampWaiting: 'Reconnecting…',

    shopOpen: 'The shop is open',
    shopShut: 'The shop is closed',
    shopOpening: 'Opening the shop…',
    shopClosing: 'Closing the shop…',
    shopElsewhere: 'The shop is open on this computer',
    shopElsewhereSub: 'Something else started it, so this window cannot close it.',

    openBrowser: 'Open in the browser',
    startShop: 'Open the shop',
    stopShop: 'Close the shop',
    restartShop: 'Restart the shop',
    tryAgain: 'Try again',

    accountsN: '{n} people can sign in',
    accounts1: '1 person can sign in',
    noAccountsYet: 'nobody can sign in yet',

    /* ------------------------------------------------------ the addresses */
    onThisComputer: 'On this computer',
    onAPhone: 'On a phone or another computer',
    fromAnywhere: 'From anywhere, on any device',
    localFallback: 'If the internet is down, on this computer',
    pointCamera: 'Point the camera at this code',
    noWifi: 'This computer is not on a network, so nothing else can reach the shop.',
    plainNoPadlock: 'without the padlock',
    copy: 'Copy',
    copied: 'Copied',

    /* ----------------------------------------------------------- the boot */
    st_port: 'The port is free',
    st_checks: 'Readiness check',
    st_padlock: 'The padlock',
    st_printers: 'Printers and scanner',
    st_server: 'Starting the shop',
    st_cloud: 'The cloud copy',
    st_open: 'Open for business',

    /* the codes a step carries — one sentence each, never composed */
    d_port_free: 'nothing else is using it',
    d_port_adopted: 'a shop is already open here',
    d_port_held: 'something else is holding port {port}',
    d_checked_at: 'checked at {time}',
    d_foreign: 'this window did not open the shop',
    d_preflight_exit: 'the check ended with code {exit}',
    d_padlock_trusted: 'Windows trusts it',
    d_padlock_now: 'now trusted on this computer',
    d_padlock_untrusted: 'Windows does not trust it yet',
    d_padlock_none: 'no certificate on this computer',
    d_printers_installed: 'set up and checked again',
    d_printers_person: 'somebody needs to look at this',
    d_printers_exit: 'the check ended with code {exit}',
    d_server_up: 'answering',
    d_server_spawn: 'could not be started — {why}',
    d_server_died: 'it stopped on its own (exit {exit})',
    d_server_signal: 'it stopped on its own ({signal})',
    d_cloud_live: 'in step',
    d_cloud_live_behind: '{n} waiting to go up',
    d_cloud_pulled: 'the shop was pulled down from the cloud',
    d_cloud_offline: 'cannot reach the cloud right now',
    d_cloud_refused: 'the cloud copy belongs to {by}',
    d_cloud_none: 'no cloud copy is set up',
    d_cloud_manual: 'switched off — by hand only',
    d_open_here: '{shop}',
    d_open_foreign: '{shop}',

    /* ------------------------------------------------------- the verdict */
    allWell: 'Everything is ready',
    allWellSub: 'Nothing needs doing.',
    someWarn: '{n} things to look at',
    someWarn1: 'One thing to look at',
    itFailed: 'The shop did not open',
    /* A shop that opened and then fell over is not a shop that failed to
       open. They call for different next actions and the sentence has to
       say which one happened. */
    itDied: 'The shop stopped by itself',
    stillSells: 'The shop still opens and still takes money.',

    /* ------------------------------------------------------- the notices */
    n_no_accounts: 'Nobody can sign in yet',
    n_no_accounts_b: 'The shop has no accounts. Make the first one under Tools → New account.',
    n_retired_account: 'An old test account is switched on again',
    n_retired_account_b: '{users} — its password was published in this project’s history. Give it a new one, or switch it off in Settings.',
    n_demo_catalogue: 'Invented stock is loaded',
    n_demo_catalogue_b: '{products} product(s) and {customers} customer(s) that are not real. The till will sell them at their invented prices.',
    n_cookies_insecure: 'Sign-ins are not being sent securely',
    n_cookies_insecure_b: 'Fine on this computer alone, wrong once the shop is reached over the network.',
    n_cert_address: 'This computer’s address has changed',
    n_cert_address_b: '{addresses} is not named in the certificate, so phones and other computers cannot open the shop at all. Make a new certificate, then restart.',
    n_cert_expiring: 'The padlock expires in {days} days',
    n_cert_expiring_b: 'Make a new certificate before it does, or other devices stop being able to open the shop.',
    n_no_cert: 'There is no padlock',
    n_no_cert_b: 'Other devices get no notifications, no camera scanner, and cannot install the app — browsers only allow those over a secure address.',
    n_no_origins: 'The shop accepts writes from any website',
    n_no_origins_b: 'Fine on a shop network you control. Set OG_ORIGINS before reaching the till from outside the shop.',
    n_stale: 'The shop is running older code than this computer has',
    n_stale_b: 'Files under server/ changed after the shop started. It keeps running what it was started with until it is restarted.',
    /* The three the boot found rather than the server: the step list goes
       away once the shop is open, so anything amber on it has to survive as
       a card here or it is simply lost. */
    n_padlock_untrusted: 'Windows does not trust the padlock',
    n_padlock_untrusted_b: 'The browser opens on a red “not private” page every time. This can be fixed on this computer, once.',
    n_printers_person: 'The printers need somebody to look at them',
    n_printers_person_b: 'The shop still opens and still takes money — it is the printing that will not work. The check says what is missing.',
    n_preflight_exit: 'The readiness check found something',
    n_preflight_exit_b: 'The shop still opens and still takes money. Run the check again to see what it said.',
    n_fix: 'Fix this',
    n_makeCert: 'Make a certificate',
    n_newAccount: 'New account',
    n_restartNow: 'Restart the shop',

    /* --------------------------------------------------------- the cloud */
    cloud: 'Cloud copy',
    cloudOff: 'Off',
    cloudLive: 'In step',
    cloudStarting: 'Starting',
    cloudOffline: 'Cannot reach it',
    cloudRefused: 'Refused',
    cloudWaiting: '{n} waiting',
    cloudPushed: 'sent {ago}',
    cloudNone: 'No cloud copy is set up on this computer.',
    cloudBelongs: 'The cloud copy belongs to {by}.',
    cloudOneLaptop: 'The shop runs on one computer at a time. To work here, close it there and bring it over.',
    syncNow: 'Send to the cloud now',

    /* ---------------------------------------------------------- the jobs */
    g_shop: 'The shop',
    g_cloud: 'The cloud copy',
    g_machine: 'This computer',
    g_dev: 'Developer',
    needsShut: 'needs the shop closed',
    closesShop: 'closes and reopens the shop',
    running: 'running',
    stepOf: 'step {step} of {of}',
    jobDone: '{label} — done',
    jobStopped: '{label} stopped',
    hardRefresh: 'Hard refresh',
    hardRefreshBlurb: 'Send the newest files to every browser that already has the shop open.',
    restartBlurb: 'Close the shop and open it again.',

    /* the refusals that used to exist only as a red line in the log */
    r_job_busy: '“{running}” is still running. Wait for it to finish.',
    r_job_unknown: 'There is no such tool.',
    r_needs_shut: '“{label}” needs the shop closed first.',
    r_sync_no_shop: 'The shop is not running, so there is nothing to send.',
    r_sync_refused: 'This computer is not the shop, so it cannot send to the cloud copy.',

    /* --------------------------------------------------------- the asks */
    typeToConfirm: 'Type {word} to confirm',
    runIt: 'Run it',
    quitTitle: 'Close OG System?',
    quitBody: 'This closes the shop as well. Nobody will be able to use the till until it is opened again.',
    quitGo: 'Close everything',
    stopTitle: 'Close the shop?',
    stopBodyNobody: 'Nobody has the shop open right now.',
    stopBodyWho: '{who} has the shop open right now.',
    stopBodyWho2: '{who} have the shop open right now.',
    stopBodyAsking: 'Checking who is using it…',
    stopGo: 'Close it anyway',

    newAccount: 'New account',
    fUser: 'Username',
    fName: 'Full name',
    fRole: 'Role',
    fPass: 'Password',
    fMessage: 'What did you change?',
    create: 'Create',
    roleManager: 'Manager',
    roleCashier: 'Cashier',
    roleWarehouse: 'Warehouse',
    roleDelivery: 'Delivery',
    rolePartner: 'Print partner',

    /* ----------------------------------------------------------- the log */
    follow: 'Follow',
    clear: 'Clear',
    quit: 'Quit',
    showLog: 'Show the technical log',
    logBlurb: 'Everything the shop and these tools printed, exactly as they printed it.',
    logEmpty: 'Nothing has been printed yet.',
    sw: 'Browser cache',
    waiting: 'Waiting for the shop…'
  };

  var ar = {
    /* --------------------------------------------------------- the shell */
    app: 'OG System',
    tools: 'الأدوات',
    log: 'السجل التقني',
    back: 'رجوع',
    close: 'إغلاق',
    cancel: 'إلغاء',
    lang: 'English',
    langTip: 'التبديل إلى الإنكليزية',
    toolsTip: 'الأدوات والإعدادات',

    /* ---------------------------------------------------------- the shop */
    lampOpen: 'مفتوح',
    lampShut: 'مغلق',
    lampOpening: 'جارٍ الفتح…',
    lampClosing: 'جارٍ الإغلاق…',
    lampFailed: 'لم يُفتح',
    lampDied: 'توقف',
    lampWaiting: 'إعادة الاتصال…',

    shopOpen: 'المحل مفتوح',
    shopShut: 'المحل مغلق',
    shopOpening: 'جارٍ فتح المحل…',
    shopClosing: 'جارٍ إغلاق المحل…',
    shopElsewhere: 'المحل مفتوح على هذا الكمبيوتر',
    shopElsewhereSub: 'شيء آخر هو الذي فتحه، لذلك لا تستطيع هذه النافذة إغلاقه.',

    openBrowser: 'افتحه في المتصفح',
    startShop: 'افتح المحل',
    stopShop: 'أغلق المحل',
    restartShop: 'أعد تشغيل المحل',
    tryAgain: 'حاول مرة أخرى',

    accountsN: '{n} أشخاص يمكنهم تسجيل الدخول',
    accounts1: 'شخص واحد يمكنه تسجيل الدخول',
    noAccountsYet: 'لا أحد يستطيع تسجيل الدخول بعد',

    /* ------------------------------------------------------ the addresses */
    onThisComputer: 'على هذا الكمبيوتر',
    onAPhone: 'على الهاتف أو كمبيوتر آخر',
    fromAnywhere: 'من أي مكان، على أي جهاز',
    localFallback: 'إذا انقطع الإنترنت، على هذا الكمبيوتر',
    pointCamera: 'وجّه الكاميرا إلى هذا الرمز',
    noWifi: 'هذا الكمبيوتر ليس على شبكة، لذلك لا يستطيع أي جهاز آخر الوصول إلى المحل.',
    plainNoPadlock: 'بدون القفل',
    copy: 'انسخ',
    copied: 'تم النسخ',

    /* ----------------------------------------------------------- the boot */
    st_port: 'المنفذ متاح',
    st_checks: 'فحص الجاهزية',
    st_padlock: 'القفل',
    st_printers: 'الطابعات والماسح',
    st_server: 'تشغيل المحل',
    st_cloud: 'النسخة السحابية',
    st_open: 'جاهز للعمل',

    d_port_free: 'لا شيء آخر يستخدمه',
    d_port_adopted: 'يوجد محل مفتوح هنا أصلاً',
    d_port_held: 'شيء آخر يشغل المنفذ {port}',
    d_checked_at: 'فُحص في {time}',
    d_foreign: 'هذه النافذة ليست من فتحت المحل',
    d_preflight_exit: 'انتهى الفحص بالرمز {exit}',
    d_padlock_trusted: 'ويندوز يثق به',
    d_padlock_now: 'صار موثوقاً على هذا الكمبيوتر',
    d_padlock_untrusted: 'ويندوز لا يثق به بعد',
    d_padlock_none: 'لا توجد شهادة على هذا الكمبيوتر',
    d_printers_installed: 'تم إعدادها وفحصها مجدداً',
    d_printers_person: 'يحتاج الأمر إلى شخص ينظر فيه',
    d_printers_exit: 'انتهى الفحص بالرمز {exit}',
    d_server_up: 'يستجيب',
    d_server_spawn: 'تعذّر تشغيله — {why}',
    d_server_died: 'توقف من تلقاء نفسه (الرمز {exit})',
    d_server_signal: 'توقف من تلقاء نفسه ({signal})',
    d_cloud_live: 'متطابقة',
    d_cloud_live_behind: '{n} بانتظار الرفع',
    d_cloud_pulled: 'تم سحب المحل من السحابة',
    d_cloud_offline: 'تعذّر الوصول إلى السحابة الآن',
    d_cloud_refused: 'النسخة السحابية تعود إلى {by}',
    d_cloud_none: 'لا توجد نسخة سحابية معدّة',
    d_cloud_manual: 'متوقفة — يدوياً فقط',
    d_open_here: '{shop}',
    d_open_foreign: '{shop}',

    /* ------------------------------------------------------- the verdict */
    allWell: 'كل شيء جاهز',
    allWellSub: 'لا شيء يحتاج إلى عمل.',
    someWarn: '{n} أمور تحتاج إلى نظرة',
    someWarn1: 'أمر واحد يحتاج إلى نظرة',
    itFailed: 'المحل لم يُفتح',
    itDied: 'المحل توقف من تلقاء نفسه',
    stillSells: 'المحل يفتح ويستقبل النقود كالمعتاد.',

    /* ------------------------------------------------------- the notices */
    n_no_accounts: 'لا أحد يستطيع تسجيل الدخول بعد',
    n_no_accounts_b: 'لا توجد حسابات في المحل. أنشئ الحساب الأول من الأدوات ← حساب جديد.',
    n_retired_account: 'حساب تجريبي قديم أُعيد تشغيله',
    n_retired_account_b: '{users} — كلمة سره منشورة في تاريخ هذا المشروع. غيّرها، أو أوقف الحساب من الإعدادات.',
    n_demo_catalogue: 'توجد بضاعة وهمية محمّلة',
    n_demo_catalogue_b: '{products} منتج و{customers} زبون غير حقيقيين. الصندوق سيبيعها بأسعارها الوهمية.',
    n_cookies_insecure: 'تسجيلات الدخول لا تُرسل بشكل آمن',
    n_cookies_insecure_b: 'لا بأس على هذا الكمبيوتر وحده، لكنه خطأ عند الوصول إلى المحل عبر الشبكة.',
    n_cert_address: 'عنوان هذا الكمبيوتر تغيّر',
    n_cert_address_b: '{addresses} غير مذكور في الشهادة، لذلك لا تستطيع الهواتف والأجهزة الأخرى فتح المحل إطلاقاً. أنشئ شهادة جديدة ثم أعد التشغيل.',
    n_cert_expiring: 'القفل ينتهي خلال {days} يوماً',
    n_cert_expiring_b: 'أنشئ شهادة جديدة قبل ذلك، وإلا لن تتمكن الأجهزة الأخرى من فتح المحل.',
    n_no_cert: 'لا يوجد قفل',
    n_no_cert_b: 'الأجهزة الأخرى لن تصلها إشعارات، ولن يعمل ماسح الكاميرا، ولا يمكن تثبيت التطبيق — المتصفحات تسمح بهذه فقط عبر عنوان آمن.',
    n_no_origins: 'المحل يقبل الكتابة من أي موقع',
    n_no_origins_b: 'لا بأس على شبكة محل تتحكم بها. اضبط OG_ORIGINS قبل الوصول إلى الصندوق من خارج المحل.',
    n_stale: 'المحل يعمل بنسخة أقدم مما على هذا الكمبيوتر',
    n_stale_b: 'ملفات في server/ تغيّرت بعد تشغيل المحل. سيبقى يعمل بما شُغّل به حتى يُعاد تشغيله.',
    n_padlock_untrusted: 'ويندوز لا يثق بالقفل',
    n_padlock_untrusted_b: 'المتصفح يفتح على صفحة حمراء «غير آمن» في كل مرة. يمكن إصلاح هذا على هذا الكمبيوتر مرة واحدة.',
    n_printers_person: 'الطابعات تحتاج من ينظر فيها',
    n_printers_person_b: 'المحل يفتح ويستقبل النقود كالمعتاد — الطباعة وحدها لن تعمل. الفحص يوضّح ما هو الناقص.',
    n_preflight_exit: 'فحص الجاهزية وجد شيئاً',
    n_preflight_exit_b: 'المحل يفتح ويستقبل النقود كالمعتاد. أعد تشغيل الفحص لترى ما قاله.',
    n_fix: 'أصلح هذا',
    n_makeCert: 'أنشئ شهادة',
    n_newAccount: 'حساب جديد',
    n_restartNow: 'أعد تشغيل المحل',

    /* --------------------------------------------------------- the cloud */
    cloud: 'النسخة السحابية',
    cloudOff: 'متوقفة',
    cloudLive: 'متطابقة',
    cloudStarting: 'جارٍ البدء',
    cloudOffline: 'تعذّر الوصول',
    cloudRefused: 'مرفوضة',
    cloudWaiting: '{n} بالانتظار',
    cloudPushed: 'أُرسلت {ago}',
    cloudNone: 'لا توجد نسخة سحابية معدّة على هذا الكمبيوتر.',
    cloudBelongs: 'النسخة السحابية تعود إلى {by}.',
    cloudOneLaptop: 'المحل يعمل على كمبيوتر واحد في كل وقت. للعمل هنا، أغلقه هناك ثم انقله إلى هنا.',
    syncNow: 'أرسل إلى السحابة الآن',

    /* ---------------------------------------------------------- the jobs */
    g_shop: 'المحل',
    g_cloud: 'النسخة السحابية',
    g_machine: 'هذا الكمبيوتر',
    g_dev: 'المطوّر',
    needsShut: 'يحتاج المحل مغلقاً',
    closesShop: 'يغلق المحل ثم يعيد فتحه',
    running: 'قيد التنفيذ',
    stepOf: 'الخطوة {step} من {of}',
    jobDone: '{label} — تم',
    jobStopped: '{label} توقف',
    hardRefresh: 'تحديث كامل',
    hardRefreshBlurb: 'أرسل أحدث الملفات إلى كل متصفح فاتح المحل أصلاً.',
    restartBlurb: 'أغلق المحل ثم افتحه من جديد.',

    r_job_busy: '«{running}» ما زال قيد التنفيذ. انتظر حتى ينتهي.',
    r_job_unknown: 'لا توجد أداة بهذا الاسم.',
    r_needs_shut: '«{label}» يحتاج المحل مغلقاً أولاً.',
    r_sync_no_shop: 'المحل غير مشغّل، فليس هناك ما يُرسل.',
    r_sync_refused: 'هذا الكمبيوتر ليس هو المحل، لذلك لا يستطيع الإرسال إلى النسخة السحابية.',

    /* --------------------------------------------------------- the asks */
    typeToConfirm: 'اكتب {word} للتأكيد',
    runIt: 'نفّذ',
    quitTitle: 'إغلاق OG System؟',
    quitBody: 'هذا يغلق المحل أيضاً. لن يتمكن أحد من استخدام الصندوق حتى يُفتح من جديد.',
    quitGo: 'أغلق كل شيء',
    stopTitle: 'إغلاق المحل؟',
    stopBodyNobody: 'لا أحد فاتح المحل الآن.',
    stopBodyWho: '{who} فاتح المحل الآن.',
    stopBodyWho2: '{who} فاتحون المحل الآن.',
    stopBodyAsking: 'جارٍ التحقق ممن يستخدمه…',
    stopGo: 'أغلقه على أي حال',

    newAccount: 'حساب جديد',
    fUser: 'اسم المستخدم',
    fName: 'الاسم الكامل',
    fRole: 'الدور',
    fPass: 'كلمة السر',
    fMessage: 'ما الذي غيّرته؟',
    create: 'أنشئ',
    roleManager: 'مدير',
    roleCashier: 'كاشير',
    roleWarehouse: 'مستودع',
    roleDelivery: 'توصيل',
    rolePartner: 'شريك الطباعة',

    /* ----------------------------------------------------------- the log */
    follow: 'تابع',
    clear: 'امسح',
    quit: 'خروج',
    showLog: 'اعرض السجل التقني',
    logBlurb: 'كل ما طبعه المحل وهذه الأدوات، كما طبعه تماماً.',
    logEmpty: 'لم يُطبع شيء بعد.',
    sw: 'ذاكرة المتصفح',
    waiting: 'بانتظار المحل…'
  };

  /* The language is remembered per MACHINE, not per person — the same
     reasoning as the shop's sidebar rail and its open Settings folds. The
     till in the shop and the laptop in the office want different answers and
     there is nobody signed in here to hang a preference on. */
  var KEY = 'og.panel.lang';
  var lang = 'en';
  try { if (localStorage.getItem(KEY) === 'ar') lang = 'ar'; } catch (e) { /* private window */ }

  function setLang(next) {
    lang = next === 'ar' ? 'ar' : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* nothing to do */ }
    return lang;
  }

  function isRTL() { return lang === 'ar'; }

  /* t('accountsN', { n: 4 }). A key that is missing in Arabic falls through to
     English rather than printing its own name — the sentence is still wrong,
     but it is readable, and the console line says which key to go and add. */
  function t(key, args) {
    var table = lang === 'ar' ? ar : en;
    var s = table[key];
    if (s === undefined) {
      s = en[key];
      if (s === undefined) return key;
      if (lang === 'ar' && window.console) console.warn('panel i18n: no Arabic for ' + key);
    }
    if (!args) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return args[k] === undefined || args[k] === null ? '' : String(args[k]);
    });
  }

  return { t: t, setLang: setLang, lang: function () { return lang; }, isRTL: isRTL, en: en, ar: ar };
})();
