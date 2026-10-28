/* ==========================================================================
   OG SYSTEM — Website orders                                 [weborders.js]
   --------------------------------------------------------------------------
   What the website sent, waiting for somebody to call the customer and say
   yes or no. The server collects the orders from the cloud every minute
   (server/lib/weborders.js) and nothing here moves stock or money:

     Accept  opens the ORDER DESK filled in (Desk.fromWeb). The person walks
             it step by step and presses the desk's own Save, which writes the
             real order and tells the website it was accepted.
     Reject  says why, in one of the codes the website has words for.

   Print jobs in an order were already sent to Yalla Wear when it was
   collected (the owner's decision); the card shows where each one is.

   Paints #view itself and never calls render() — so after() cannot re-enter
   load() (the Safeers loop, fix 06). Events are data-act="wo-…" on the one
   delegated ACTIONS table: there is no data-wo namespace, and inventing one
   is how a whole screen of buttons does nothing (fix 05).
   ========================================================================== */
var WebOrders = (function () {
  'use strict';

  var TABS = ['new', 'accepted', 'rejected'];
  var CODES = ['no_answer', 'out_of_stock', 'customer_cancelled', 'unpaid', 'duplicate', 'test', 'bad_print', 'other'];
  var FRESH_MS = 20000;

  var S = {
    tab: 'new',
    rows: [], counts: { new: 0, accepted: 0, rejected: 0 }, capped: false, whId: null,
    loaded: false, failed: null, at: 0, shopAt: 0,
    busy: null,                /* the ref whose Accept is on its way */
    reject: null,              /* { ref, code } while the reject sheet is open */
    site: { configured: true, why: null },   /* can the website be told at all (075) */
    seen: {},                  /* ref → the journey stop it was at, last load */
    just: {}                   /* ref → the stop it reached while somebody looked */
  };

  var ICON = {
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    chat: 'M4 20l1.5-4A8 8 0 1 1 9 19.5L4 20',
    box: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
    shirt: 'M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z',
    img: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4'
  };
  function svg(d) {
    return '<svg class="wo-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function ltr(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }

  /* Minor units in the product's own currency, never converted. */
  function money(minor, cur, exp) {
    if (minor == null || !cur) return '—';
    var e = exp == null ? (cur === 'USD' ? 2 : 0) : exp;
    var v = Number(minor) / Math.pow(10, e);
    var num = v.toLocaleString('en-US', { minimumFractionDigits: e, maximumFractionDigits: e });
    if (cur === 'USD') return ltr('$' + num);
    return ltr(num + ' ' + (OG.lang === 'ar' && cur === 'SYP' ? 'ل.س' : cur));
  }

  function find(ref) {
    return S.rows.filter(function (o) { return o.ref === ref; })[0] || null;
  }

  /* ----------------------------------------------------------------- load */

  function load() {
    var tab = S.tab;
    return API.get('/api/web-orders?state=' + encodeURIComponent(tab) + '&limit=80').then(function (r) {
      if (tab !== S.tab) return;
      if (r.site) S.site = r.site;
      noticeMoves(r.orders || []);
      S.rows = r.orders || [];
      S.counts = r.counts || S.counts;
      S.capped = !!r.capped;
      S.whId = r.whId || null;
      S.loaded = true;
      S.failed = null;
      S.at = Date.now();
      S.shopAt = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
      paint();
    }).catch(function (e) {
      S.failed = API.friendly(e);
      S.loaded = true;
      paint();
    });
  }

  /* A journey stop reached since the last load, on an order already on
     screen, lights up once — and the one the owner is waiting for (the
     customer told) gets a toast. The first load of a tab only remembers:
     a stop reached an hour ago is not news. */
  function noticeMoves(rows) {
    rows.forEach(function (o) {
      var now = stageOf(o);
      var was = S.seen[o.ref];
      S.seen[o.ref] = now;
      if (was == null || now <= was) return;
      S.just[o.ref] = now;
      if (now === 3) {
        toast(t('wo_jr_toast_title'), t(o.state === 'accepted' ? 'wo_jr_toast_ok' : 'wo_jr_toast_no')
          .replace('{ref}', o.ref), 'ok', 6000);
        if (typeof Pulse !== 'undefined' && Pulse.chime) { try { Pulse.chime(); } catch (e) { /* sound is optional */ } }
      }
      setTimeout(function () {
        if (S.just[o.ref] !== now) return;
        delete S.just[o.ref];
        /* The class only; a repaint here would take a typed reject note. */
        var el = document.querySelector('.wo-card[data-ref="' + (window.CSS && CSS.escape ? CSS.escape(o.ref) : o.ref) + '"] .wo-jr');
        if (el) el.className = el.className.replace(/\s*is-just-\d/g, '');
      }, 2600);
    });
  }

  function paint() {
    if (OG.view !== 'weborders') return;
    var host = document.getElementById('view');
    if (host) {
      host.innerHTML = view();
      if (typeof hintInputs === 'function') hintInputs(host);
    }
  }

  /* Asks only when there is nothing, or what it holds is old — a live push
     and every action call load() themselves. */
  function after() {
    var shop = typeof Shop !== 'undefined' && Shop.loadedAt ? Shop.loadedAt() : 0;
    if (!S.loaded || Date.now() - S.at > FRESH_MS || shop !== S.shopAt) load();
  }

  /* Said by the desk after it saves an accepted order, so this screen asks
     again the next time it is shown. */
  function stale() { S.at = 0; }

  /* ----------------------------------------------------------------- view */

  function view() {
    var head = '<div class="page-head"><div><h1>' + t('wo_title') + '</h1>' +
      '<div class="sub">' + t('wo_sub') + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-ghost btn-sm wo-refresh" data-act="wo-reload" title="' +
        esc(t('wo_refresh')) + '" aria-label="' + esc(t('wo_refresh')) + '">' + svg(ICON.refresh) + '</button></div></div>';
    var tabs = '<div class="chip-row wo-tabs" role="tablist">' + TABS.map(function (k) {
      return '<button type="button" class="chip' + (S.tab === k ? ' on' : '') + '" role="tab" aria-selected="' +
        (S.tab === k) + '" data-act="wo-tab" data-tab="' + k + '">' + t('wo_tab_' + k) +
        ' <bdi class="wo-count">' + nf(S.counts[k] || 0) + '</bdi></button>';
    }).join('') + '</div>';

    if (S.failed) {
      return head + tabs + '<div class="card"><div class="cart-empty"><b>' + esc(S.failed) + '</b>' +
        '<button class="btn btn-sm mt" data-act="wo-reload">' + t('retry') + '</button></div></div>';
    }
    if (!S.loaded) {
      return head + tabs + '<div class="wo-skel" aria-busy="true"><i></i><i></i></div>' +
        '<span class="sr-only" role="status">' + t('wo_loading') + '</span>';
    }
    if (!S.rows.length) {
      return head + tabs + '<div class="card"><div class="cart-empty"><b>' + t('wo_empty_' + S.tab) + '</b>' +
        '<span>' + t('wo_empty_why') + '</span></div></div>';
    }
    return head + tabs + '<div class="wo-list">' + S.rows.map(card).join('') + '</div>' +
      (S.capped ? '<div class="muted wo-capped">' + t('wo_capped') + '</div>' : '');
  }

  function card(o) {
    var c = o.customer || {};
    var dl = o.delivery || {};
    var pay = o.payment || {};

    var head = '<div class="wo-head"><div class="wo-ref">' + ltr(o.ref) +
        (o.test ? '<span class="badge wo-test">' + t('wo_test') + '</span>' : '') + '</div>' +
      '<div class="wo-when muted">' + t('wo_placed') + ' ' + esc(fmtDateTime(o.placedAt)) + '</div></div>';

    /* Who — and whether the shop already knows them. */
    var tel = c.phone ? String(c.phone).replace(/[^\d+]/g, '') : '';
    var who = '<div class="wo-sec"><div class="wo-k">' + t('wo_customer') + '</div>' +
      '<div class="wo-who"><b>' + esc(c.name || '—') + '</b>' +
        (c.phone ? '<span class="muted">' + ltr(c.phone) + '</span>' : '') +
        (o.match ? '<span class="badge wo-known">' + t('wo_known').replace('{name}', esc(o.match.name)) + '</span>'
                 : '<span class="badge">' + t('wo_new_customer') + '</span>') +
      '</div>' +
      (tel ? '<div class="wo-contact">' +
        '<a class="btn btn-sm" href="tel:' + esc(tel) + '">' + svg(ICON.phone) + '<span>' + t('wo_call') + '</span></a>' +
        '<button type="button" class="btn btn-sm" data-act="wo-wa" data-ref="' + esc(o.ref) + '">' + svg(ICON.chat) +
          '<span>' + t('wo_whatsapp') + '</span></button></div>' : '') +
      '</div>';

    /* Where it goes. */
    var place = dl.method === 'pickup' ? t('wo_pickup')
      : [dl.city, dl.address].filter(Boolean).map(esc).join(' · ');
    var where = '<div class="wo-sec"><div class="wo-k">' + t('wo_delivery') + '</div>' +
      '<div><b>' + (dl.method ? t('dk_m_' + dl.method) : '—') + '</b>' +
        (dl.country && dl.country !== 'SY' ? ' · ' + ltr(dl.country) : '') + '</div>' +
      (place ? '<div>' + place + '</div>' : '') +
      (dl.recipient ? '<div class="muted">' + t('wo_recipient') + ': ' + esc(dl.recipient) +
        (dl.phone ? ' · ' + ltr(dl.phone) : '') + '</div>' : '') +
      (dl.note ? '<div class="muted">“' + esc(dl.note) + '”</div>' : '') +
      '</div>';

    /* How it is paid, with the receipt photo when there is one. */
    var pm = pay.method && DB.payMethod ? DB.payMethod(pay.method) : null;
    var pmName = pm ? (OG.lang === 'ar' ? (pm.ar || pm.en) : (pm.en || pm.ar)) : (pay.method || '');
    var money_ = '<div class="wo-sec"><div class="wo-k">' + t('wo_payment') + '</div>' +
      '<div><b>' + (pay.type === 'transfer' ? t('wo_pay_transfer') : t('wo_pay_cod')) + '</b>' +
        (pay.type === 'transfer' && pmName ? ' · ' + esc(pmName) : '') + '</div>' +
      (pay.reference ? '<div class="muted">' + t('wo_txn') + ' ' + ltr(pay.reference) + '</div>' : '') +
      /* 068 — the coupon the customer gave; the desk checks it on Accept. */
      (o.coupon ? '<div>' + t('coupon') + ' <span class="badge accent">' + ltr(o.coupon) + '</span></div>' : '') +
      (o.hasProof
        ? '<button type="button" class="wo-proof" data-act="wo-proof" data-ref="' + esc(o.ref) + '" aria-label="' +
            esc(t('wo_proof_open')) + '"><img alt="" loading="lazy" src="/api/web-orders/' + encodeURIComponent(o.ref) + '/proof"></button>'
        : (pay.type === 'transfer' ? '<div class="wo-warn">' + t('wo_no_proof') + '</div>' : '')) +
      '</div>';

    return '<div class="card wo-card' + (o.test ? ' is-test' : '') + '" data-ref="' + esc(o.ref) + '">' +
      head +
      '<div class="wo-grid">' + who + where + money_ + '</div>' +
      itemsHtml(o) + printsHtml(o) +
      (o.note ? '<div class="wo-note"><span class="wo-k">' + t('wo_note') + '</span> “' + esc(o.note) + '”</div>' : '') +
      footHtml(o) +
      '</div>';
  }

  /* Every line as the shop sees it: its own name and price, and whether it is
     on the shelf where the office packs from. What the customer was shown is
     said only when it differs — that is the one thing worth a phone call. */
  /* 071 — a line the customer wants printed: the name and number as the
     shop will print them and the kit, or why it cannot be printed as asked
     (PrintKits.checkLine on the server). */
  function printOf(i) {
    var p = i.print;
    if (!p) return '';
    if (p.problem) {
      var asked = p.asked ? [p.asked.name, p.asked.number].filter(function (x) { return x != null && x !== ''; }).join(' ') : '';
      return '<div class="wo-warn wo-pline">' + svg(ICON.shirt) + '<span>' + t('wo_pl_print') +
        (asked ? ' “' + ltr(asked) + '”' : '') + ' — ' +
        esc(t('wo_pl_' + p.problem).replace('{n}', p.maxLetters != null ? p.maxLetters : '')) + '</span></div>';
    }
    return '<div class="wo-ok wo-pline">' + svg(ICON.shirt) + '<span>' + t('wo_pl_print') + ' ' +
      ltr(p.name + ' ' + p.number) + ' · ' + esc(p.kitLabel) +
      (p.substituted ? ' <span class="muted">(' + t('wo_pl_default_kit') + ')</span>' : '') + '</span></div>';
  }

  function itemsHtml(o) {
    if (!o.items || !o.items.length) return '';
    var bad = o.items.filter(function (i) { return i.print && i.print.problem; }).length;
    var rows = o.items.map(function (i) {
      if (!i.known) {
        return '<div class="wo-item is-bad"><div><b>' + esc((i.shown && i.shown.name) || i.sku) + '</b>' +
          '<div class="wo-warn">' + t('wo_unknown_sku').replace('{sku}', esc(i.sku)) + '</div>' + printOf(i) + '</div>' +
          '<div class="wo-qty">×' + ltr(i.qty) + '</div><div></div></div>';
      }
      var colour = i.colour ? ' · ' + esc(OG.lang === 'ar' ? (i.colour.ar || i.colour.en) : (i.colour.en || i.colour.ar)) : '';
      var stock = i.here >= i.qty
        ? '<span class="wo-ok">' + t('wo_in_stock').replace('{n}', nf(i.here)) + '</span>'
        : '<span class="wo-warn">' + t('wo_short').replace('{n}', nf(i.here)).replace('{all}', nf(i.total)) + '</span>';
      var sh = i.shown || {};
      var differs = sh.price != null && sh.currency && (sh.price !== i.price || sh.currency !== i.currency);
      return '<div class="wo-item"><div><b>' + esc(i.name) + '</b>' +
          '<div class="muted">' + t('size') + ' ' + ltr(i.size) + colour + ' · ' + ltr(i.sku) + '</div>' +
          (i.archived ? '<div class="wo-warn">' + t('wo_archived') + '</div>' : '') +
          stock + printOf(i) + '</div>' +
        '<div class="wo-qty">×' + ltr(i.qty) + '</div>' +
        '<div class="wo-price">' + money(i.price, i.currency, i.minorExp) +
          (differs ? '<div class="wo-warn">' + t('wo_shown') + ' ' + money(sh.price, sh.currency, sh.minorExp != null ? sh.minorExp : (sh.currency === 'USD' ? 2 : 0)) + '</div>' : '') +
        '</div></div>';
    }).join('');
    var job = o.printJob
      ? '<div class="wo-pjob">' + svg(ICON.shirt) + '<span>' + t('wo_pjob').replace('{job}', esc(o.printJob.id))
          .replace('{stage}', t('wo_st_' + (o.printJob.stage || 'design'))) +
          (o.printJob.deadline ? ' · ' + t('wo_pjob_by').replace('{d}', esc(fmtDate(new Date(o.printJob.deadline)))) : '') + '</span>' +
          ' <button type="button" class="btn btn-ghost btn-sm" data-act="wo-job" data-id="' + esc(o.printJob.id) + '">' + t('wo_open_job') + '</button></div>'
      : '';
    var warn = bad && o.state === 'new'
      ? '<div class="wo-warn wo-pwarn">' + t('wo_pl_cannot').replace('{n}', nf(bad)) + '</div>' : '';
    return '<div class="wo-block"><div class="wo-k">' + svg(ICON.box) + t('wo_items') + '</div>' + warn + rows + job + '</div>';
  }

  function printsHtml(o) {
    if (!o.prints || !o.prints.length) return '';
    var rows = o.prints.map(function (p) {
      var named = p.lines && p.lines.length
        ? p.lines.map(function (l) {
            return '<span class="wo-shirt">' + esc(l.printName || t('wo_no_name')) +
              (l.number ? ' ' + ltr('#' + l.number) : '') + (l.size ? ' · ' + ltr(l.size) : '') +
              (l.qty > 1 ? ' ×' + ltr(l.qty) : '') + '</span>';
          }).join('')
        : '<span class="wo-shirt">×' + ltr(p.qty) + '</span>';
      var state;
      if (o.test) state = '<span class="muted">' + t('wo_print_test') + '</span>';
      else if (!p.jobId) state = '<span class="wo-warn">' + t('wo_print_not_sent') + '</span>';
      else if (p.orderState === 'declined') state = '<span class="wo-warn">' + ltr(p.jobId) + ' · ' + t('wo_print_declined') + '</span>';
      else if (p.orderState === 'accepted' || p.stage !== 'design') {
        state = '<span class="wo-ok">' + ltr(p.jobId) + ' · ' + t('wo_st_' + (p.stage || 'design')) + '</span>';
      } else if (p.orderState === 'draft') state = '<span class="wo-warn">' + ltr(p.jobId) + ' · ' + t('wo_print_draft') + '</span>';
      else state = '<span class="muted">' + ltr(p.jobId) + ' · ' + t('wo_print_waiting') + '</span>';
      return '<div class="wo-print"><div><b>' + esc(p.design) + '</b>' +
          (p.clubCode ? ' <span class="muted">' + ltr(p.clubCode) + '</span>' : '') +
          '<div class="wo-shirts">' + named + '</div>' +
          (p.note ? '<div class="muted">“' + esc(p.note) + '”</div>' : '') + '</div>' +
        '<div class="wo-print-state">' + state +
          (p.jobId ? ' <button type="button" class="btn btn-ghost btn-sm" data-act="wo-job" data-id="' + esc(p.jobId) + '">' +
            t('wo_open_job') + '</button>' : '') + '</div></div>';
    }).join('');
    return '<div class="wo-block"><div class="wo-k">' + svg(ICON.shirt) + t('wo_prints') + '</div>' +
      (!o.test ? '<div class="muted wo-small">' + t('wo_prints_sent_note') + '</div>' : '') +
      rows + (o.printError ? '<div class="wo-warn">' + t('wo_print_error') + ' ' + esc(o.printError) + '</div>' : '') +
      '</div>';
  }

  /* ----------------------------------------------------- the journey (075)
     What a decision has reached, as three stops on one line: the shop said
     yes (or no) → the customer's order page on the website shows it (the
     cloud has it) → the website was told, and told its customer. Every stop
     is a fact the server read, never a timer; the strip moves by itself on
     the live line (Pulse → load), and a stop reached while somebody is
     looking lights up (S.just). */
  function stageOf(o) {
    if (o.state === 'new') return 0;
    return o.siteState ? 3 : o.cloudHas ? 2 : 1;
  }

  function siteWhy(err) {
    var code = String(err || '').split(':')[0];
    var known = ['bad_key', 'not_found', 'redirect', 'refused', 'site_error', 'timeout', 'unreachable'];
    return t('wo_jr_err_' + (known.indexOf(code) >= 0 ? code : 'failed'));
  }

  function stop(state, title, sub, extra) {
    var mark = state === 'done' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : state === 'bad' ? '<b aria-hidden="true">!</b>'
      : state === 'off' ? '<b aria-hidden="true">–</b>' : '<i aria-hidden="true"></i>';
    return '<li class="wo-jr-stop is-' + state + '"><span class="wo-jr-dot">' + mark + '</span>' +
      '<span class="wo-jr-txt"><b>' + title + '</b>' + (sub ? '<span class="muted">' + sub + '</span>' : '') +
      (extra || '') + '</span></li>';
  }

  function journeyHtml(o) {
    var acc = o.state === 'accepted';
    var when = function (iso) { return iso ? esc(fmtDateTime(iso)) : ''; };
    var s1 = stop('done', t(acc ? 'wo_jr_accepted' : 'wo_jr_rejected'),
      t('wo_jr_by').replace('{who}', esc(o.decidedBy || '—')).replace('{when}', when(o.decidedAt)));
    var s2 = o.cloudHas
      ? stop('done', t(acc ? 'wo_jr_page_ok' : 'wo_jr_page_no'), when(o.cloudAt))
      : stop('wait', t('wo_jr_page_wait'), t('wo_jr_page_wait_sub'));
    var s3;
    var again = '<button type="button" class="btn btn-ghost btn-sm wo-jr-again" data-act="wo-tell" data-ref="' +
      esc(o.ref) + '">' + t('wo_jr_again') + '</button>';
    if (o.siteState) {
      s3 = stop('done', t('wo_jr_told'), when(o.siteAt));
    } else if (!S.site.configured) {
      var fix = roleOf() === 'developer'
        ? '<button type="button" class="btn btn-ghost btn-sm wo-jr-again" data-act="wo-site-set">' + t('wo_jr_set') + '</button>'
        : '';
      s3 = stop('off', t('wo_jr_no_site'), t('wo_jr_no_site_' + (S.site.why || 'no_site')), fix);
    } else if (o.siteGaveUp) {
      s3 = stop('bad', t('wo_jr_not_told'), esc(siteWhy(o.siteError)), again);
    } else if (o.siteError) {
      s3 = stop('wait', t('wo_jr_retry'), esc(siteWhy(o.siteError)) +
        (o.siteNextAt ? ' · ' + t('wo_jr_next').replace('{when}', esc(fmtDateTime(o.siteNextAt))) : ''), again);
    } else {
      s3 = stop('wait', t('wo_jr_telling'), o.cloudHas ? t('wo_jr_telling_sub') : '');
    }
    var st = stageOf(o);
    var lit = S.just[o.ref] ? ' is-just-' + S.just[o.ref] : '';
    return '<div class="wo-jr' + (acc ? '' : ' is-no') + lit + '" style="--wo-jr:' + (st - 1) / 2 + '">' +
      '<div class="wo-jr-head"><span class="wo-k">' + t('wo_jr_title') + '</span>' +
        (o.notice ? '<button type="button" class="btn btn-ghost btn-sm" data-act="wo-preview" data-ref="' + esc(o.ref) + '">' +
          t('wo_jr_preview') + '</button>' : '') + '</div>' +
      '<ol class="wo-jr-line">' + s1 + s2 + s3 + '</ol></div>';
  }

  /* What the customer's phone shows: the notification the website is handed
     (message, in both languages) dropping in over their order page, as the
     website draws it from web_order_status. A picture of the promise, built
     from the same words the server sends — never a second copy of them. */
  function previewHtml(o, lang) {
    var n = o.notice || {};
    var pick = function (x) { return (x && (x[lang] || x.en)) || ''; };
    var acc = o.state === 'accepted';
    var dir = lang === 'ar' ? 'rtl' : 'ltr';
    var L = function (k) { return t('wo_pv_' + k + (lang === 'ar' ? '_ar' : '_en')); };
    return '<div class="wo-phone" dir="' + dir + '" lang="' + lang + '">' +
      '<div class="wo-phone-notch"></div>' +
      '<div class="wo-phone-note"><span class="wo-phone-app"><img src="assets/icon-192.png" alt=""></span>' +
        '<span><b>' + esc(pick(n.title)) + '</b><span>' + esc(pick(n.body)) + '</span></span>' +
        '<span class="wo-phone-now">' + L('now') + '</span></div>' +
      '<div class="wo-phone-page">' +
        '<div class="wo-phone-brand"><img src="assets/logo.svg" alt=""><span>ogsports1.com</span></div>' +
        '<div class="wo-phone-ref"><bdi dir="ltr">' + esc(o.ref) + '</bdi></div>' +
        '<div class="wo-phone-badge' + (acc ? '' : ' is-no') + '">' + L(acc ? 'ok' : 'no') + '</div>' +
        '<ol class="wo-phone-steps">' +
          '<li class="on">' + L('placed') + '</li>' +
          '<li class="on">' + L(acc ? 'confirmed' : 'declined') + '</li>' +
          (acc ? '<li>' + L('onway') + '</li><li>' + L('arrived') + '</li>' : '') +
        '</ol>' +
        (acc ? '<div class="wo-phone-btn">' + L('track') + '</div>' : '') +
      '</div></div>';
  }

  function openPreview(ref) {
    var o = find(ref);
    if (!o || !o.notice) return;
    openModal({
      title: t('wo_pv_title').replace('{ref}', ref),
      body: '<div class="partner-note">' + t('wo_pv_note') + '</div>' +
        '<div class="wo-phones">' + previewHtml(o, 'ar') + previewHtml(o, 'en') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>'
    });
  }

  function footHtml(o) {
    if (o.state !== 'new') return journeyHtml(o) + footDecided(o);
    return footNew(o);
  }

  function footDecided(o) {
    if (o.state === 'accepted') {
      /* Who and when are the journey's first stop; the foot is the order. */
      return '<div class="wo-foot"><div class="muted">' +
          (o.saleId ? t('wo_jr_sale') + ' ' + ltr(o.saleId) : '') + '</div>' +
        (o.saleId ? '<button type="button" class="btn btn-sm" data-act="wo-order" data-id="' + esc(o.saleId) + '">' +
          t('wo_open_order') + '</button>' : '') + '</div>';
    }
    if (o.state === 'rejected') {
      return '<div class="wo-foot"><div class="muted">' + t('wo_jr_why') + ' ' +
        '<b>' + t('wo_code_' + (o.rejectCode || 'other')) + '</b>' +
        (o.rejectNote ? ' · “' + esc(o.rejectNote) + '”' : '') + '</div></div>';
    }
    return '';
  }

  function footNew(o) {
    var goes = S.busy === o.ref;
    /* Accepting IS the desk's Save, so it needs the desk (delivery.desk).
       Somebody who may see and answer website orders (delivery.web) but not
       work the desk is told what is missing instead of being sent to a
       screen that would refuse them. */
    var accept = o.test
      ? '<span class="muted wo-small">' + t('wo_test_why') + '</span>'
      : !allow('delivery.desk')
        ? '<span class="muted wo-small">' + t('wo_accept_needs_desk') + '</span>'
        : '<button type="button" class="btn btn-primary" data-act="wo-accept" data-ref="' + esc(o.ref) + '"' +
            (goes ? ' disabled aria-busy="true"' : '') + '><span>' + t(goes ? 'wo_opening' : 'wo_accept') + '</span></button>';
    /* 078 — the deposit this order needs: deposit.online_pct, or what was
       agreed with the customer on the call (a percentage or an amount). The
       website reads it (GET /api/ext/web-orders/:ref/deposit). */
    var dep = o.deposit || {};
    var depVal = dep.amount != null ? String(dep.currency === 'USD' ? (dep.amount / 100) : dep.amount) : String(dep.pct != null ? dep.pct : (CONFIG.DEP_ONLINE_PCT || 50));
    var depUnit = dep.amount != null ? (dep.currency || 'USD') : '%';
    var depRow = '<div class="wo-dep"><span class="lbl">' + t('rs_wo_deposit') + '</span>' +
      '<span class="badge ' + (dep.source === 'set' ? 'healthy' : 'neutral') + '">' + t(dep.source === 'set' ? 'rs_wo_agreed' : 'rs_wo_default') + '</span>' +
      '<div class="wo-dep-in"><input class="inp num" id="wodA-' + esc(o.ref) + '" type="text" inputmode="decimal" dir="ltr" value="' + esc(depVal) + '" aria-label="' + esc(t('rs_wo_deposit')) + '">' +
      '<select class="inp" id="wodU-' + esc(o.ref) + '">' + ['%', 'USD', 'SYP'].map(function (u) {
        return '<option value="' + u + '"' + (u === depUnit ? ' selected' : '') + '>' + u + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn btn-sm" data-rv="wodep" data-ref="' + esc(o.ref) + '">' + t('save') + '</button></div>' +
      '<small class="muted">' + t('rs_wo_deposit_sub') + '</small></div>';
    return depRow + '<div class="wo-foot">' +
      '<button type="button" class="btn btn-ghost" data-act="wo-reject" data-ref="' + esc(o.ref) + '">' + t('wo_reject') + '</button>' +
      accept + '</div>';
  }

  /* --------------------------------------------------------------- reject */

  function rejectSheet() {
    var r = S.reject;
    if (!r) return;
    openModal({
      title: t('wo_reject_title').replace('{ref}', r.ref), size: 'narrow',
      body: '<div class="partner-note">' + t('wo_reject_note') + '</div>' +
        '<div class="chip-row mt wo-codes">' + CODES.map(function (c) {
          return '<button type="button" class="chip' + (r.code === c ? ' on' : '') + '" data-act="wo-code" data-code="' + c + '">' +
            t('wo_code_' + c) + '</button>';
        }).join('') + '</div>' +
        '<label class="field mt"><span>' + t('wo_reject_why') + '</span>' +
          '<input class="inp" id="woRejectNote" type="text" maxlength="300" value="' + esc(r.note || '') + '"></label>' +
        (r.error ? '<div class="wo-warn mt">' + esc(r.error) + '</div>' : ''),
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn bk-danger" data-act="wo-reject-go"' + (r.code ? '' : ' disabled') + '>' +
              t('wo_reject') + '</button>'
    });
  }

  /* ------------------------------------------------------------- actions */

  function register() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['wo-reload'] = function () { S.failed = null; load(); };
    ACTIONS['wo-tab'] = function (el) {
      var k = el.getAttribute('data-tab');
      if (TABS.indexOf(k) < 0 || k === S.tab) return;
      S.tab = k;
      S.loaded = false;
      S.rows = [];
      paint();
      load();
    };

    ACTIONS['wo-accept'] = function (el) {
      var ref = el.getAttribute('data-ref');
      var o = find(ref);
      if (!o || S.busy) return;
      if (typeof Desk === 'undefined' || !Desk.fromWeb) return;
      S.busy = ref;
      paint();
      var done = function () { S.busy = null; paint(); };
      /* The customer: found by phone or made from what the website sent —
         only by somebody who may add customers. Anybody else gets the desk
         with the phone number waiting in its customer box. */
      var who = allow('customer.write')
        ? API.post('/api/web-orders/' + encodeURIComponent(ref) + '/customer', {}).then(function (r) {
            return (r.created && typeof Shop !== 'undefined' && Shop.reload ? Shop.reload() : Promise.resolve())
              .then(function () { return r.customerId; });
          })
        : Promise.resolve(o.match ? o.match.id : null);
      who.then(function (customerId) {
        done();
        return Desk.fromWeb(o, customerId);
      }).catch(function (e) {
        done();
        toast(t('wo_title'), API.friendly(e), 'err', 6000);
        if (e && (e.code === 'web_rejected' || e.code === 'not_found')) load();
      });
    };

    ACTIONS['wo-reject'] = function (el) {
      var ref = el.getAttribute('data-ref');
      S.reject = { ref: ref, code: /^TEST-/i.test(ref) ? 'test' : null, note: '', error: null };
      rejectSheet();
    };
    ACTIONS['wo-code'] = function (el) {
      if (!S.reject) return;
      var box = document.getElementById('woRejectNote');
      if (box) S.reject.note = box.value;
      S.reject.code = el.getAttribute('data-code');
      rejectSheet();
    };
    ACTIONS['wo-reject-go'] = function (el) {
      var r = S.reject;
      if (!r || !r.code || el.disabled) return;
      var box = document.getElementById('woRejectNote');
      r.note = box ? box.value : r.note;
      el.disabled = true;
      API.post('/api/web-orders/' + encodeURIComponent(r.ref) + '/reject', { code: r.code, note: r.note || null })
        .then(function () {
          S.reject = null;
          closeModal();
          toast(t('wo_title'), t('wo_rejected_toast').replace('{ref}', r.ref), 'ok');
          load();
        }).catch(function (e) {
          /* The reason stays, and what was typed. */
          r.error = API.friendly(e);
          rejectSheet();
        });
    };

    ACTIONS['wo-proof'] = function (el) {
      var ref = el.getAttribute('data-ref');
      openModal({
        title: t('wo_proof_title').replace('{ref}', ref),
        body: '<img class="wo-proof-big" alt="" src="/api/web-orders/' + encodeURIComponent(ref) + '/proof">',
        foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>'
      });
    };

    /* WhatsApp in both languages, through the shop's own composer: nothing
       leaves until the person has read it (js/whatsapp.js). */
    ACTIONS['wo-wa'] = function (el) {
      var o = find(el.getAttribute('data-ref'));
      if (!o || typeof WA === 'undefined') return;
      var name = (o.customer && o.customer.name) || '';
      var shop = CONFIG.SHOP_NAME || 'OG Sports';
      WA.compose({
        to: (o.customer && o.customer.phone) || '',
        title: t('wo_whatsapp'),
        text: WA.both(
          [WA.hi(name, true), 'معك ' + shop + ' بخصوص طلبك من الموقع ' + o.ref + ' 🛍️', ''],
          [WA.hi(name, false), 'This is ' + shop + ' about your website order ' + o.ref + ' 🛍️', '']
        )
      });
    };

    /* 075 — the customer's phone, and a fresh round of calls to the website. */
    ACTIONS['wo-preview'] = function (el) { openPreview(el.getAttribute('data-ref')); };
    ACTIONS['wo-tell'] = function (el) {
      var ref = el.getAttribute('data-ref');
      if (el.disabled) return;
      el.disabled = true;
      API.post('/api/web-orders/' + encodeURIComponent(ref) + '/tell-site', {}).then(function () {
        toast(t('wo_title'), t('wo_jr_again_toast').replace('{ref}', ref), 'ok');
        load();
      }).catch(function (e) {
        el.disabled = false;
        toast(t('wo_title'), API.friendly(e), 'err', 6000);
      });
    };
    ACTIONS['wo-site-set'] = function () {
      if (typeof Desk !== 'undefined' && Desk.gotoSettingsFold) Desk.gotoSettingsFold('website');
      else go('settings');
    };

    ACTIONS['wo-order'] = function (el) {
      if (typeof Desk !== 'undefined' && Desk.openOrder) Desk.openOrder(el.getAttribute('data-id'));
    };
    ACTIONS['wo-job'] = function (el) {
      var id = el.getAttribute('data-id');
      if (typeof openJobDrawer === 'function') openJobDrawer(id);
      else go('print');
    };
  }

  return { view: view, after: after, register: register, load: load, stale: stale };
})();
