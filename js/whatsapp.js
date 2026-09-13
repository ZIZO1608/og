/* ==========================================================================
   WHATSAPP — real messages, not a toast                          [data-wa]
   --------------------------------------------------------------------------
   The Send button used to close the modal and raise "sent". Nothing was sent.

   This opens an actual wa.me link with the text pre-filled, which genuinely
   works from file://, from GitHub Pages, and from a phone — it hands off to
   the installed WhatsApp app or to web.whatsapp.com. No API, no key, no
   backend. It is the one integration that is real without a server.

   What it cannot do is send silently: WhatsApp always shows the message to
   the user before they press send. That is a platform rule, not a shortcut
   taken here, and the UI says so rather than implying the message has gone.
   ========================================================================== */

var WA = (function () {

  /* wa.me wants digits only — no +, no spaces, no dashes. A Syrian number
     stored as "+963 933 447 210" has to become "963933447210" or the link
     opens WhatsApp on a blank chat, which looks like the feature is broken. */
  function digits(phone) {
    /* DB.normPhone is the one rule — the server's twin, and what the
       customer search matches on. This used to be a third copy that only knew
       Syria, so a Jordanian 07… number opened WhatsApp on a Syrian number
       nobody had given the shop. */
    if (typeof DB !== 'undefined' && DB.normPhone) return DB.normPhone(phone);
    return String(phone || '').replace(/[^\d]/g, '');
  }

  function link(phone, text) {
    var d = digits(phone);
    if (!d) return null;
    /* encodeURIComponent, not escape: the templates are Arabic and contain
       newlines. Getting this wrong truncates the message at the first space. */
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text || '');
  }

  /* Every send is recorded, so the demo can show a history rather than a
     one-off action that leaves no trace. */
  function log(entry) {
    DB.waMessages.unshift({
      id: 'WA-' + pad(DB.waMessages.length + 1, 4),
      at: new Date(),
      to: entry.to, name: entry.name || '',
      kind: entry.kind || 'note',
      text: entry.text || ''
    });
  }

  /* ------------------------------------------------ both languages, always

     EVERY MESSAGE THIS APP HANDS TO WHATSAPP IS ARABIC, A RULE, THEN ENGLISH —
     the customer, the supplier, Yalla Wear and the owner each read the half
     that is theirs, and nobody at the counter chooses a language before Send.
     Build the two halves as arrays of lines and pass them to both(); never
     write a one-language message again.

     WhatsApp's own formatting: *bold* for headings and the figures somebody
     acts on, one emoji a heading, Western digits in both halves. WhatsApp
     takes each LINE's direction from its first strong letter, so an Arabic
     line that begins with a Latin word (a product name, an invoice number, a
     city typed in English) is started with U+200F here, or it sits
     left-aligned in the middle of the Arabic. Links are left alone. */
  var RULE = '━━━━━━━━━━━━━━';
  var RLM = '‏';

  function rtlLine(s) {
    s = String(s == null ? '' : s);
    if (!s || s.charAt(0) === RLM || /^\s*https?:\/\//i.test(s)) return s;
    return /^[^A-Za-z؀-ۿ]*[A-Za-z]/.test(s) ? RLM + s : s;
  }
  function lines(x) {
    return (Array.isArray(x) ? x.join('\n') : String(x == null ? '' : x)).split('\n');
  }
  function both(ar, en) {
    return lines(ar).map(rtlLine).join('\n') + '\n\n' + RULE + '\n\n' + lines(en).join('\n');
  }

  /* An amount the way the screen counts it (money()'s rule: the shop's
     dollar view converts), written in each half's own words. */
  function cash(syp, ar) {
    if (typeof OG !== 'undefined' && OG.currency === 'USD') {
      return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
    }
    return nf(syp) + (ar ? ' ل.س' : ' SYP');
  }
  /* Always lira, whatever the screen shows — the loyalty value is lira. */
  function lira(syp, ar) { return nf(syp) + (ar ? ' ل.س' : ' SYP'); }
  function day(d, ar) {
    d = new Date(d);
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + (ar ? MONTHS_AR : MONTHS_EN)[d.getMonth()] + ' ' + d.getFullYear();
  }
  function first(name) {
    if (typeof personFirst === 'function') return personFirst(name) || '';
    return String(name || '').trim().split(/\s+/)[0] || '';
  }
  function hi(name, ar) {
    var n = first(name);
    return (ar ? 'مرحباً' : 'Hi') + (n ? ' ' + n : '') + ' 👋';
  }

  /* ---------------------------------------------------------- templates */

  var T = {
    /* A customer who has not bought in a while. */
    winback: function (c) {
      var n = first(c.name);
      var pts = Number(c.loyaltyPoints) || 0;
      var worth = pts * CONFIG.LOYALTY_POINT_VALUE;
      var shop = CONFIG.SHOP_NAME;
      return both([
        'مرحباً' + (n ? ' ' + n : '') + '، اشتقنالك! 🖤',
        '',
        pts ? 'وصلتنا موديلات جديدة 🔥 وعندك *' + nf(pts) + ' نقطة ولاء* تعادل *' + lira(worth, true) + '* جاهزة للاستخدام.'
            : 'وصلتنا موديلات جديدة 🔥',
        'مرّ علينا قبل ما تخلص المقاسات 👟',
        '',
        '📍 *' + shop + '* · ' + (CONFIG.SHOP_ADDRESS_AR || CONFIG.SHOP_ADDRESS)
      ], [
        'Hi' + (n ? ' ' + n : '') + ', we miss you! 🖤',
        '',
        pts ? 'New styles just landed 🔥 and you have *' + nf(pts) + ' loyalty points* worth *' + lira(worth, false) + '* ready to use.'
            : 'New styles just landed 🔥',
        'Drop by before the sizes run out 👟',
        '',
        '📍 *' + shop + '* · ' + CONFIG.SHOP_ADDRESS
      ]);
    },

    /* The size they asked about is back on the shelf. */
    backInStock: function (c, product, size) {
      return both([
        hi(c.name, true),
        '',
        'رجع *' + product + '* مقاس *' + size + '* عالرف ✅',
        'احجزه قبل ما يخلص.',
        '',
        '— ' + CONFIG.SHOP_NAME
      ], [
        hi(c.name, false),
        '',
        'Good news: *' + product + '* in size *' + size + '* is back on the shelf ✅',
        'Reserve yours before it goes.',
        '',
        '— ' + CONFIG.SHOP_NAME
      ]);
    }
  };

  /* ------------------------------------------------ end-of-day summary
     One tap at closing puts the whole day in a message. He gets his shop on
     his phone instead of counting a notebook. Everything here is derived from
     the same helpers the dashboard uses, so the message and the screen can
     never disagree. */

  function dayStats() {
    var start = daysAgo(0), end = daysAgo(-1);
    var sales = DB.sales.filter(function (s) { return s.date >= start && s.date < end; });
    var total = sales.reduce(function (a, s) { return a + s.total; }, 0);
    var pieces = sales.reduce(function (a, s) {
      return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0);
    }, 0);

    var byPay = {};
    sales.forEach(function (s) { byPay[s.payment] = (byPay[s.payment] || 0) + s.total; });

    /* Best seller by pieces moved today. */
    var count = {};
    sales.forEach(function (s) {
      s.items.forEach(function (i) { count[i.name] = (count[i.name] || 0) + i.qty; });
    });
    var best = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];

    return {
      sales: sales, count: sales.length, total: total, pieces: pieces,
      byPay: byPay, best: best, bestQty: best ? count[best] : 0,
      critical: DB.criticalVariants().length,
      overdueJobs: DB.printJobs.filter(function (j) { return DB.isOverdue(j); }).length
    };
  }

  function dayText() {
    var d = dayStats();
    var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
    function part(ar) {
      var L = [];
      L.push('📊 *' + CONFIG.SHOP_NAME + '* — ' + (ar ? 'ملخّص اليوم' : 'Today’s summary'));
      L.push('🗓️ ' + day(TODAY, ar));
      L.push('');
      L.push((ar ? '💰 المبيعات: *' : '💰 Sales: *') + cash(d.total, ar) + '*');
      L.push('🧾 ' + (ar ? d.count + ' فاتورة · ' + d.pieces + ' قطعة'
                          : plural(d.count, 'invoice', 'invoices') + ' · ' + plural(d.pieces, 'piece', 'pieces')));
      var pays = Object.keys(d.byPay);
      if (pays.length) {
        L.push('');
        L.push(ar ? '💳 *طرق الدفع*' : '💳 *How it was paid*');
        pays.forEach(function (k) {
          var label = ar ? ((DB.paymentLabelsAr || {})[k] || (DB.paymentLabels || {})[k] || k)
                         : ((DB.paymentLabels || {})[k] || k);
          L.push('▫️ ' + label + ': ' + cash(d.byPay[k], ar));
        });
      }
      if (d.best) {
        L.push('');
        L.push((ar ? '🔥 الأكثر مبيعاً: ' : '🔥 Best seller: ') + d.best + ' (' + d.bestQty + ')');
      }
      if (d.critical || d.overdueJobs) L.push('');
      if (d.critical) {
        L.push('⚠️ ' + (ar ? d.critical + ' مقاس وصل حد الخطر' : plural(d.critical, 'size', 'sizes') + ' at the danger level'));
      }
      if (d.overdueJobs) {
        L.push('⚠️ ' + (ar ? d.overdueJobs + ' طلب طباعة متأخر' : plural(d.overdueJobs, 'print job', 'print jobs') + ' overdue'));
      }
      return L;
    }
    return both(part(true), part(false));
  }

  /* ------------------------------------------------------------- compose

     A preview the user can edit before it goes. The text is never sent behind
     their back — they see it, then WhatsApp shows it to them again. */
  function compose(o) {
    var text = o.text || '';
    var phone = o.to || '';

    openModal({
      title: o.title || t('send_whatsapp'),
      size: 'narrow',
      body:
        '<label class="field"><span>' + t('phone') + '</span>' +
          '<input class="inp num" id="waPhone" dir="ltr" type="text" value="' + esc(phone) + '"></label>' +
        '<label class="field mt"><span>' + t('whatsapp_msg') + '</span>' +
          /* Each LINE finds its own direction (unicode-bidi: plaintext): the
             order messages are Arabic then English in one box, and a box forced
             either way draws the other half with every full stop at the wrong
             end — "Hi Nour," came out as ",Hi Nour". WhatsApp itself reads
             direction per paragraph, so the box now looks like the message. */
          '<textarea class="inp" id="waText" dir="auto" rows="12" style="line-height:1.7;unicode-bidi:plaintext;text-align:start">' +
            esc(text) + '</textarea></label>' +
        (o.note ? '<div class="partner-note mt">' + o.note + '</div>' : '') +
        '<div class="partner-note mt">' + t('wa_handoff') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-wa="open" data-name="' + esc(o.name || '') +
              '" data-kind="' + esc(o.kind || 'note') + '">' + t('wa_open') + '</button>'
    });
  }

  var ACT = {
    open: function (el) {
      var phone = (document.getElementById('waPhone') || {}).value || '';
      var text = (document.getElementById('waText') || {}).value || '';
      var url = link(phone, text);

      if (!url) { toast(t('send_whatsapp'), t('wa_bad_number'), 'err'); return; }

      log({ to: phone, name: el.getAttribute('data-name'),
            kind: el.getAttribute('data-kind'), text: text });

      closeModal();
      /* noopener on a user-initiated window.open — without it the new tab can
         reach back into this one through window.opener. */
      window.open(url, '_blank', 'noopener');
      toast(t('send_whatsapp'), t('wa_opened'), 'ok', 3200);
      if (typeof render === 'function') render();
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-wa]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-wa')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
  }
  bind();

  return {
    link: link, digits: digits, compose: compose, log: log,
    templates: T, dayText: dayText, dayStats: dayStats,
    both: both, cash: cash, lira: lira, day: day, first: first, hi: hi, RULE: RULE
  };
})();
