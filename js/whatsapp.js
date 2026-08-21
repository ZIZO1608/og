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
    var d = String(phone || '').replace(/[^\d]/g, '');
    /* Local 09xx xxx xxx -> drop the leading 0, prepend the country code. */
    if (d.indexOf('0') === 0 && d.length === 10) d = '963' + d.slice(1);
    return d;
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

  /* ---------------------------------------------------------- templates */

  var T = {
    /* A customer who has not bought in a while. */
    winback: function (c) {
      return 'مرحباً ' + String(c.name).split(' ')[0] + '، اشتقنالك! 🖤\n\n' +
        'وصلتنا موديلات جديدة، وعندك ' + nf(c.loyaltyPoints) + ' نقطة ولاء ' +
        'تعادل ' + nf(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + ' ل.س جاهزة للاستخدام.\n\n' +
        'مرّ علينا قبل ما تخلص المقاسات.\n— ' + CONFIG.SHOP_NAME + ' · ' + CONFIG.SHOP_ADDRESS;
    },

    /* The size he asked about is back on the shelf. */
    backInStock: function (c, product, size) {
      return 'مرحباً ' + String(c.name).split(' ')[0] + '،\n\n' +
        'رجع ' + product + ' مقاس ' + size + ' عالرف.\n' +
        'احجزه قبل ما يخلص.\n— ' + CONFIG.SHOP_NAME;
    },

    /* The day, to himself or a partner. Built by dayText() below. */
    daily: function (body) {
      return '📊 ' + CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY) + '\n\n' + body;
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
    var lines = [];
    lines.push('المبيعات: ' + money(d.total) + ' · ' + d.count + ' فاتورة · ' + d.pieces + ' قطعة');

    Object.keys(d.byPay).forEach(function (k) {
      lines.push('• ' + (DB.paymentLabels[k] || k) + ': ' + money(d.byPay[k]));
    });

    if (d.best) lines.push('\nالأكثر مبيعاً: ' + d.best + ' (' + d.bestQty + ')');
    if (d.critical) lines.push('⚠ ' + d.critical + ' مقاس وصل حد الخطر');
    if (d.overdueJobs) lines.push('⚠ ' + d.overdueJobs + ' طلب طباعة متأخر');

    return T.daily(lines.join('\n'));
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
          '<textarea class="inp" id="waText" dir="rtl" rows="9" style="line-height:1.7">' +
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
    templates: T, dayText: dayText, dayStats: dayStats
  };
})();
