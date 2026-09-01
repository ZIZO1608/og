/* ==========================================================================
   OG SYSTEM — application shell  ·  9/17: CUSTOMERS + duplicate guard +
   SCAN → PRODUCT + REORDER
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 3684-4282). Loads after
   app-warehouse.js.
   ========================================================================== */

/* ------------------------------------------------------------- 10. CUSTOMERS */

/* The filtered customer list, shared by the view and by bulk select-all so
   "select all" can never grab more than the filter is showing. */
function customerRows() {
  var f = OG.cust;
  var list = DB.customers.filter(function (c) { return f.filter === 'archived' ? c.archived : !c.archived; });
  /* Each person against their OWN rhythm, not one shop-wide number — see
     DB.quietAfter. Somebody who has never bought is not quiet: there is
     nothing to have lost yet, and customerState calls that 'new'. */
  if (f.filter === 'risk') list = list.filter(function (c) { return DB.customerState(c) === 'quiet'; });
  if (f.filter === 'gold') list = list.filter(function (c) { return DB.tier(c.loyaltyPoints) === 'gold'; });
  if (f.filter === 'debt') list = list.filter(function (c) { return c.openDebts > 0; });
  /* Set by the product screen's "who wears this size" link (Stage E leans on
     the same field). Matched against the server's top-two-per-family, which
     is what the card draws — so what you searched is what you can see. */
  if (f.size) list = list.filter(function (c) {
    return (c.sizes || []).some(function (s) { return String(s.size) === String(f.size); });
  });

  if (f.q) {
    /* Two paths, kept distinct on purpose. Names go through foldName so محمد
       finds مُحَمَّد; digits go through normPhone so 0933 111 222 finds
       +963 933 111 222. A name is never routed through normPhone — it strips
       letters to an empty string. The folded forms are cached on the row
       (rebuilt with it on every hydrate) so a keystroke over 5,000 customers
       is a substring scan, not ten thousand regex passes. */
    var qf = DB.foldName(f.q);
    var qd = DB.normPhone(f.q);
    /* A local number typed short — 0933… — carries a leading zero the
       stored, 963-prefixed form does not, so its zero-less tail is what can
       actually be contained in the stored digits. */
    var qd0 = qd.charAt(0) === '0' ? qd.replace(/^0+/, '') : '';
    list = list.filter(function (c) {
      if (c._fold === undefined) c._fold = DB.foldName(c.name + ' ' + c.city);
      if (c._tel === undefined) c._tel = DB.normPhone(c.phone);
      if (qf && c._fold.indexOf(qf) > -1) return true;
      if (qd.length >= 3 && c._tel &&
          (c._tel.indexOf(qd) > -1 || (qd0 && c._tel.indexOf(qd0) > -1))) return true;
      return false;
    });
  }

  var by = {
    /* Spend orders on spentUsdEquiv — every sale at its own frozen rate.
       Ordering is the ONE thing that figure exists for; it is never drawn. */
    spend: function (a, b) { return b.spentUsdEquiv - a.spentUsdEquiv; },
    visits: function (a, b) { return b.visits - a.visits; },
    name: function (a, b) { return a.name.localeCompare(b.name); },
    /* Debt needs one number to ORDER by; today's rate is fine for that and
       would be wrong for display — the same rule as spend. */
    debt: function (a, b) { return debtOrder(b) - debtOrder(a); },
    recent: function (a, b) {
      return (b.lastPurchaseDate ? b.lastPurchaseDate.getTime() : -1) -
             (a.lastPurchaseDate ? a.lastPurchaseDate.getTime() : -1);
    }
  };
  return list.sort(by[f.sort] || by.recent);
}

function debtOrder(c) {
  return c.debtSyp + Math.round(c.debtUsd / 100 * CONFIG.EXCHANGE_RATE);
}

/* Only this many cards reach the DOM. The filter and the count are honest
   about the whole list; the grid draws the top of it, because five thousand
   cards is a page nobody scrolls and a render everybody waits for. The note
   under the grid says what was left out and how to narrow it. */
var CUST_RENDER_CAP = 60;

/* The rows actually ON SCREEN — the capped ones.

   Bulk select-all reads this, not customerRows(). Its rule is that select-all
   must never grab more than the filter is showing, and once the grid is
   capped those two stopped being the same list: a tick box that selected
   5,000 people while 60 cards were visible would put the whole customer
   table one click from Archive. What you can see is what you can select. */
function customerRowsShown() {
  return customerRows().slice(0, CUST_RENDER_CAP);
}

/* Does the shop keep points at all? `stamps` and `off` mean no tier, so
   drawing a Bronze badge would be inventing a scheme the shop does not run. */
function pointsMode() {
  return CONFIG.LOYALTY_MODE === 'points' || CONFIG.LOYALTY_MODE === 'both';
}

/* The size chips — the thing that makes somebody open the card.
   "43" on its own is the question a shop actually asks; the family is the
   quieter half, so it goes in the title rather than on the chip. */
function sizeChips(c) {
  var sizes = (c.sizes || []).slice(0, 3);
  if (!sizes.length) return '';
  return '<div class="cc-sizes">' + sizes.map(function (s) {
    return '<span class="badge accent" title="' + esc(t('fam_' + s.fam)) + ' · ' +
      nf(s.qty) + ' ' + esc(t('units').toLowerCase()) + '">' + esc(s.size) + '</span>';
  }).join('') + '</div>';
}

function customerCardHTML(c, ci) {
  var state = DB.customerState(c);          /* 'new' | 'quiet' | 'ok' */
  var tier = DB.tier(c.loyaltyPoints);

  /* Order is deliberate and is the reading order of the card: who they are,
     what they are worth to the scheme, WHAT THEY WEAR, when they were last
     in, what they have spent, and only then anything owed. */
  return '<div class="cust-card' +
       (state === 'quiet' ? ' quiet' : state === 'new' ? ' fresh' : '') +
       (Bulk.has('customers', c.id) ? ' bk-on' : '') +
       /* From the LIST a card opens the whole record. Nobody is mid-sale on
          this screen, so the drawer's reason to exist — do not lose the
          basket — does not apply here. `open-customer` still opens the drawer
          everywhere else, which is where the counter cases live. */
       '" data-act="cu-open" data-id="' + c.id + '">' +
    '<span class="bk-corner">' + Bulk.box('customers', c.id, ci) + '</span>' +

    '<div class="cc-top"><span class="cc-av">' + esc(initialsOf(c.name)) + '</span>' +
      '<div style="flex:1;min-width:0"><b>' + nm(c.name) + '</b>' +
      '<small class="num">' + tel(c.phone) + '</small>' +
      '<small>' + nm(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</small></div>' +
      (pointsMode() ? '<span class="badge ' + tier + '">' + t(tier) + '</span>' : '') +
    '</div>' +

    sizeChips(c) +

    '<div class="cc-stats">' +
      '<div><span class="eyebrow">' + t('cu_last_in') + '</span>' +
        '<b style="font-size:12.5px">' + relDate(c.lastPurchaseDate) + '</b></div>' +
      '<div><span class="eyebrow">' + t('total_spent') + '</span>' +
        '<b style="font-size:12.5px">' + moneyPair(c.spentSyp, c.spentUsd, true) + '</b></div>' +
    '</div>' +

    (state === 'new' || state === 'quiet' || c.openDebts
      ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          (state === 'new' ? '<span class="badge neutral">' + t('cu_never_bought') + '</span>' : '') +
          (state === 'quiet' ? '<span class="badge low">' + t('cu_quiet') + '</span>' : '') +
          (c.openDebts
            ? '<span class="badge critical">' + t('cu_debt') + ' ' + moneyPair(c.debtSyp, c.debtUsd, true) + '</span>'
            : '') +
          (state === 'quiet'
            ? '<button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>'
            : '') +
        '</div>'
      : '') +
  '</div>';
}

/* Two letters from a name that may be Arabic, Latin, or one word. */
function initialsOf(name) {
  var parts = String(name || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  return parts.map(function (w) { return w.charAt(0); }).slice(0, 2).join('');
}

/* Four different nothings, and they call for four different next actions —
   add somebody, widen the search, order that size, or nothing at all. The
   shared shape is .card > .cart-empty with a bold line and a sub-line, the
   nearest thing this codebase has to a convention (recon §B6). */
function customerEmptyHTML() {
  var f = OG.cust;
  var head, sub, action = '';

  if (f.size) {
    head = t('cu_none_size').replace('{n}', esc(f.size));
    sub = t('cu_none_size_sub');
    action = '<button class="btn btn-sm" data-act="cust-size-clear">' + t('cu_clear_size') + '</button>';
  } else if (f.q) {
    head = t('cu_none_search');
    sub = t('cu_none_search_sub');
    action = allow('customer.write')
      ? '<button class="btn btn-sm btn-primary" data-act="cu-new" data-q="' + esc(f.q) + '">+ ' + t('cu_new') + '</button>'
      : '';
  } else if (f.filter === 'debt') {
    head = t('cu_none_debt');
    sub = t('cu_none_debt_sub');
  } else if (f.filter === 'risk') {
    head = t('cu_none_quiet');
    sub = t('cu_none_quiet_sub');
  } else if (f.filter === 'archived') {
    head = t('cu_none_archived');
    sub = t('cu_none_archived_sub');
  } else if (f.filter === 'gold') {
    head = t('cu_none_gold');
    sub = t('cu_none_gold_sub');
  } else {
    head = t('cu_none_at_all');
    sub = t('cu_none_at_all_sub');
    action = allow('customer.write')
      ? '<button class="btn btn-sm btn-primary" data-act="cu-new">+ ' + t('cu_new') + '</button>'
      : '';
  }

  return '<div class="card" style="grid-column:1/-1"><div class="cart-empty">' +
    '<b>' + head + '</b>' + sub +
    (action ? '<div style="margin-top:12px">' + action + '</div>' : '') +
  '</div></div>';
}

function customerCardsHTML(list) {
  if (!list.length) return customerEmptyHTML();
  var h = '';
  /* Same slice Bulk's visibleIds uses — see customerRowsShown(). */
  list.slice(0, CUST_RENDER_CAP).forEach(function (c, ci) { h += customerCardHTML(c, ci); });
  if (list.length > CUST_RENDER_CAP) {
    h += '<div class="partner-note" style="grid-column:1/-1">' +
      t('cu_showing').replace('{a}', nf(CUST_RENDER_CAP)).replace('{b}', nf(list.length)) + '</div>';
  }
  return h;
}

function custCountText(list) { return list.length + ' / ' + DB.customers.length; }

/* The keystroke path: repaint the grid and the count, never the whole page.
   A full render() rebuilds the search box mid-word and then needs focusBack
   to hide it; leaving the box alone needs nothing. */
function repaintCustomers() {
  var grid = document.getElementById('cuGrid');
  if (!grid) { render(); return; }
  var list = customerRows();
  grid.innerHTML = customerCardsHTML(list);
  var count = document.getElementById('cuCount');
  if (count) count.textContent = custCountText(list);
}

function viewCustomers() {
  var list = customerRows();
  /* The same function the At-risk chip filters on. The bell sends people
     here, so a head count that disagreed with the list it opens would be
     worse than no count at all. */
  var quiet = DB.quietCustomers().length;

  var h = '<div class="page-head"><div><h1>' + t('customers_title') + '</h1>' +
    '<div class="sub">' + t('customers_sub') + '</div></div>' +
    '<div class="head-actions">' +
      (quiet ? '<span class="badge low">' + quiet + ' ' + t('cu_quiet') + '</span>' : '') +
      (allow('customer.write')
        ? '<button class="btn btn-primary btn-sm" data-act="cu-new">+ ' + t('cu_new') + '</button>'
        : '') +
      exportButtons() +
    '</div></div>';

  var sorts = ['recent', 'name', 'spend', 'visits', 'debt'];
  var chips = [['all', 'all_customers'], ['risk', 'cu_quiet_only'], ['debt', 'cu_owes_only']];
  if (pointsMode()) chips.push(['gold', 'gold_only']);
  chips.push(['archived', 'bk_archived_only']);

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.cust.q) + '" data-change="cust-q">' +
    '<select class="inp" data-change="cust-sort" style="max-width:170px" aria-label="' + esc(t('cu_sort')) + '">' +
      sorts.map(function (s) {
        return '<option value="' + s + '"' + ((OG.cust.sort || 'recent') === s ? ' selected' : '') + '>' +
          t('cu_sort') + ': ' + t('cu_sort_' + s) + '</option>';
      }).join('') +
    '</select>' +
    '<div class="chip-row">' +
      chips.map(function (p) {
        return '<button class="chip ' + (OG.cust.filter === p[0] ? 'on' : '') +
          '" data-act="cust-filter" data-f="' + p[0] + '">' + t(p[1]) + '</button>';
      }).join('') +
      /* Only while it is on — a chip that clears a filter nobody set is a
         control with nothing to do. Same shape as the Yalla date chip. */
      (OG.cust.size
        ? '<button class="chip on chip-x" data-act="cust-size-clear">' +
            t('size') + ' ' + esc(OG.cust.size) + ' ✕</button>'
        : '') +
    '</div>' +
    '<span class="badge neutral" id="cuCount">' + custCountText(list) + '</span></div>';

  h += '<div class="cust-grid" id="cuGrid">' + customerCardsHTML(list) + '</div>';
  return h;
}

/* ======================================================= THE PROFILE PAGE
   `#customers/<id>`. A place, not an overlay: it survives a refresh, it can
   be bookmarked and sent, and Back leaves it rather than reopening it.

   The DRAWER still exists and is still the right tool at the counter —
   mid-sale, tap, read the size and the phone, close, carry on. This page is
   for the other question: what has this person actually done with us. */

/* One chronological stream. Every source maps into the same row shape, so
   adding a kind — a stamp, a message, a print job — is one mapper and one
   entry in TL_ICON, not a new column or a new tab.

     { at: Date, kind, title, sub, tone, act, id }

   `act`/`id` become a data-act on the row, so every line is tappable through
   to the thing itself. */
function timelineRows(payload, c) {
  var out = [];

  (payload.sales || []).forEach(function (s) {
    var when = new Date(s.at);
    var items = (s.items || []).map(function (it) {
      return esc(it.name) + (it.size ? ' (' + esc(it.size) + ')' : '') + ' ×' + it.qty;
    }).join(' · ');
    out.push({
      at: when, kind: 'sale',
      title: saleMoney(s.total, s.currency) + (s.voided ? ' <span class="badge critical">' + t('cu_voided') + '</span>' : ''),
      sub: (items || t('none')) + ' · ' + esc(DB.payLabel(s.payment)) +
           (s.discount ? ' · ' + t('discount') + ' −' + saleMoney(s.discount, s.currency) : ''),
      tone: s.voided ? 'muted' : '',
      act: DB.sale(s.id) ? 'open-invoice' : '', id: s.id,
      lead: esc(s.id)
    });

    /* Points move BECAUSE of a sale, but they are their own event: the
       question "where did my points go" is answered by seeing them in the
       stream, not by opening every invoice. */
    if (!s.voided && s.points_earned) {
      out.push({
        at: when, kind: 'points', title: '+' + nf(s.points_earned) + ' ' + t('points'),
        sub: t('cu_from_invoice').replace('{n}', esc(s.id)), tone: 'plus',
        act: DB.sale(s.id) ? 'open-invoice' : '', id: s.id, lead: '★'
      });
    }
    if (!s.voided && s.points_used) {
      out.push({
        at: when, kind: 'points', title: '−' + nf(s.points_used) + ' ' + t('points'),
        sub: t('cu_spent_on').replace('{n}', esc(s.id)), tone: '',
        act: DB.sale(s.id) ? 'open-invoice' : '', id: s.id, lead: '★'
      });
    }
  });

  /* null means the account may not see deliveries at all — which is not the
     same as there being none, so nothing is drawn either way. */
  (payload.deliveries || []).forEach(function (d) {
    out.push({
      at: new Date(d.closed_at || d.out_at || d.assigned_at),
      kind: 'delivery',
      title: t('dl_one') + ' · ' + t('dl_' + d.status),
      sub: (d.address ? nm(d.address) : '') +
           (d.driver_name ? ' · ' + nm(d.driver_name) : '') +
           (d.fail_reason ? ' · ' + nm(d.fail_reason) : ''),
      tone: d.status === 'failed' ? 'bad' : '',
      act: '', id: d.id, lead: '⌂'
    });
  });

  return out
    .filter(function (r) { return r.at && !isNaN(r.at.getTime()); })
    .sort(function (a, b) { return b.at - a.at; });
}

function timelineHTML(rows) {
  if (!rows.length) {
    return '<div class="cart-empty"><b>' + t('cu_tl_empty') + '</b>' + t('cu_tl_empty_sub') + '</div>';
  }
  return '<ul class="timeline cu-tl">' + rows.map(function (r) {
    return '<li class="' + (r.tone === 'plus' ? 'plus' : '') + '"' +
      (r.act ? ' data-act="' + r.act + '" data-id="' + esc(r.id) + '" style="cursor:pointer"' : '') + '>' +
      '<b' + (r.tone === 'muted' ? ' class="muted"' : '') + '>' + r.title + '</b>' +
      '<small>' + (r.lead ? '<span class="num">' + r.lead + '</span> · ' : '') +
        fmtDate(r.at) + (r.sub ? ' · ' + r.sub : '') + '</small></li>';
  }).join('') + '</ul>';
}

/* Do the sizes they buy NOW differ from the sizes they used to? Either their
   size changed — a growing teenager, a different cut — or they are buying for
   somebody else. Both are worth knowing before recommending anything, and
   neither is something the shop should guess at silently. */
function sizeDrift(sales) {
  var recent = {}, older = {}, n = 0;
  (sales || []).forEach(function (s) {
    if (s.voided) return;
    var bucket = (n++ < 3) ? recent : older;
    (s.items || []).forEach(function (it) {
      if (!it.size) return;
      bucket[it.size] = (bucket[it.size] || 0) + it.qty;
    });
  });
  var top = function (o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })[0];
  };
  var r = top(recent), o = top(older);
  if (!r || !o || r === o) return null;
  return { recent: r, older: o };
}

function viewCustomerProfile(cid) {
  var c = DB.customer(cid);

  /* An id that resolves to nobody — a stale bookmark, a mistyped hash, or a
     customer this account is not allowed to see. The two are deliberately
     indistinguishable here, the same reason the delivery routes answer 404
     rather than 403: a page that said "not allowed" would confirm the person
     exists to somebody who may not know that. */
  if (!c) {
    return '<div class="page-head"><div><h1>' + t('customer') + '</h1>' +
      '<div class="sub">#' + esc(cid) + '</div></div>' +
      '<div class="head-actions"><button class="btn" data-act="cu-list">← ' + t('customers_title') + '</button></div></div>' +
      '<div class="card"><div class="cart-empty"><b>' + t('cu_gone') + '</b>' + t('cu_gone_sub') + '</div></div>';
  }

  var state = DB.customerState(c);
  var tier = DB.tier(c.loyaltyPoints);
  var quietAfter = DB.quietAfter(c);

  var h = '<div class="page-head"><div style="display:flex;gap:12px;align-items:flex-start;min-width:0">' +
      '<span class="cc-av" style="width:46px;height:46px;font-size:16px">' + esc(initialsOf(c.name)) + '</span>' +
      '<div style="min-width:0"><h1 style="font-size:22px">' + nm(c.name) + '</h1>' +
        '<div class="sub">' +
          '<span class="num">' + tel(c.phone) + '</span>' +
          (c.city ? ' · ' + nm(c.city) : '') +
          ' · ' + t(c.source === 'online' ? 'online' : 'in_store') +
          (c.createdAt ? ' · ' + t('cu_since') + ' ' + fmtDate(c.createdAt) : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
          (pointsMode() ? '<span class="badge ' + tier + '">' + t(tier) + '</span>' : '') +
          (state === 'quiet' ? '<span class="badge low">' + t('cu_quiet') + '</span>' : '') +
          (state === 'new' ? '<span class="badge neutral">' + t('cu_never_bought') + '</span>' : '') +
          (c.archived ? '<span class="badge neutral">' + t('bk_archived') + '</span>' : '') +
          (c.openDebts ? '<span class="badge critical">' + t('cu_debt') + ' ' + moneyPair(c.debtSyp, c.debtUsd) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="head-actions">' +
      '<button class="btn" data-act="cu-list">← ' + t('customers_title') + '</button>' +
      (allow('customer.write')
        ? '<button class="btn" data-act="cu-edit" data-id="' + c.id + '">' + t('edit') + '</button>' : '') +
      (c.phone ? '<button class="btn btn-primary" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>' : '') +
    '</div></div>';

  /* The numbers, in the order somebody asks for them. */
  h += '<div class="grid mb" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('total_spent') + '</span>' +
      '<div class="val" style="font-size:16px">' + moneyPair(c.spentSyp, c.spentUsd) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('cu_visits') + '</span><div class="val">' + nf(c.visits) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('cu_last_in') + '</span>' +
      '<div class="val" style="font-size:16px">' + relDate(c.lastPurchaseDate) + '</div>' +
      '<div class="foot">' + fmtDate(c.lastPurchaseDate) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('cu_rhythm') + '</span>' +
      '<div class="val" style="font-size:16px">' +
        (c.medianGapDays == null ? '—' : '<span dir="ltr">' + t('cu_every_n').replace('{n}', nf(c.medianGapDays)) + '</span>') +
      '</div>' +
      '<div class="foot">' + (c.medianGapDays == null
        ? t('cu_rhythm_unknown')
        : '<span dir="ltr">' + t('cu_quiet_after').replace('{n}', nf(quietAfter)) + '</span>') + '</div></div>' +
    (pointsMode()
      ? '<div class="stat"><span class="eyebrow">' + t('loyalty') + '</span>' +
          '<div class="val accent">' + nf(c.loyaltyPoints) + '</div>' +
          '<div class="foot">= ' + money(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + '</div></div>'
      : '') +
    (c.openDebts
      ? '<div class="stat"><span class="eyebrow">' + t('cu_debt') + '</span>' +
          '<div class="val warn" style="font-size:16px">' + moneyPair(c.debtSyp, c.debtUsd) + '</div>' +
          '<div class="foot">' + nf(c.openDebts) + ' ' + t('invoices').toLowerCase() + '</div></div>'
      : '') +
  '</div>';

  /* The timeline is the page. Filled by afterCustomerProfile; data-cid guards
     a slow response against a page that has already moved to somebody else. */
  h += '<div class="card mb"><div class="card-head"><h3>' + t('cu_timeline') + '</h3>' +
    '<div class="card-actions muted small" id="cuTlCount"></div></div>' +
    '<div class="card-body" id="cuTl" data-cid="' + c.id + '">' +
      '<span class="muted small">' + t('loading') + '</span></div></div>';

  h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">';

  /* What they buy. */
  h += '<div class="card"><div class="card-head"><h3>' + t('preferred_sizes') + '</h3></div>' +
    '<div class="card-body" id="cuSizes">';
  if ((c.sizes || []).length) {
    var byFam = {}, order = [];
    c.sizes.forEach(function (s) {
      if (!byFam[s.fam]) { byFam[s.fam] = []; order.push(s.fam); }
      byFam[s.fam].push(s);
    });
    h += '<div style="display:flex;gap:18px;flex-wrap:wrap">';
    order.forEach(function (f) {
      var best = byFam[f][0], second = byFam[f][1];
      h += '<div><span class="eyebrow">' + t('fam_' + f) + '</span>' +
        '<div class="strong-num" style="font-size:24px">' + esc(best.size) + '</div>' +
        '<small class="muted">' + nf(best.qty) + ' ' + t('units').toLowerCase() +
          (second ? ' · ' + esc(second.size) + ' ×' + nf(second.qty) : '') + '</small></div>';
    });
    h += '</div><div id="cuDrift"></div>';
  } else {
    h += '<span class="muted">' + t('cu_no_sizes') + '</span>';
  }
  h += '</div></div>';

  /* Note and address — both stored since the beginning and never once shown.
     There is no permission of their own: anyone with customer.read sees them
     from here on. */
  h += '<div class="card"><div class="card-head"><h3>' + t('cu_details') + '</h3>' +
    (allow('customer.write')
      ? '<div class="card-actions"><button class="btn btn-sm" data-act="cu-edit" data-id="' + c.id + '">' + t('edit') + '</button></div>'
      : '') + '</div>' +
    '<div class="card-body">' +
      '<div class="rule-row"><div class="rr-txt"><b>' + t('address') + '</b>' +
        '<small>' + (c.address ? nm(c.address) : t('cu_no_address')) + '</small></div></div>' +
      '<div class="rule-row"><div class="rr-txt"><b>' + t('note') + '</b>' +
        '<small>' + (c.note ? nm(c.note) : t('cu_no_note')) + '</small></div></div>' +
    '</div></div>';

  h += '</div>';

  if (allow('customer.write') && !c.archived) {
    h += '<div style="margin-top:16px">' +
      '<button class="btn" data-act="cu-archive" data-id="' + c.id + '">' + t('bk_archive') + '</button>' +
      '<div class="partner-note" style="margin-top:8px">' + t('cu_archive_note') + '</div></div>';
  }

  return h;
}

/* The one fetch the page makes. Same guard as the drawer: the response is
   dropped unless the page is still showing the customer it was asked for. */
function afterCustomerProfile(cid) {
  var host = document.getElementById('cuTl');
  if (!host || host.getAttribute('data-cid') !== String(cid)) return;

  if (typeof Shop === 'undefined' || !Shop.live()) {
    host.innerHTML = timelineHTML([]);
    return;
  }

  Shop.customerHistory(cid).then(function (r) {
    var el = document.getElementById('cuTl');
    if (!el || el.getAttribute('data-cid') !== String(cid)) return;
    var rows = timelineRows(r || {}, DB.customer(cid));
    el.innerHTML = timelineHTML(rows);
    var n = document.getElementById('cuTlCount');
    if (n) n.textContent = rows.length ? nf(rows.length) + ' ' + t('cu_events') : '';

    var drift = sizeDrift((r || {}).sales);
    var d = document.getElementById('cuDrift');
    if (d && drift) {
      d.innerHTML = '<div class="partner-note" style="margin-top:12px">' +
        t('cu_size_drift').replace('{a}', esc(drift.older)).replace('{b}', esc(drift.recent)) + '</div>';
    }
  }).catch(function (err) {
    var el = document.getElementById('cuTl');
    if (!el || el.getAttribute('data-cid') !== String(cid)) return;
    el.innerHTML = '<span class="muted small">' + esc(API.friendly(err)) + '</span>';
  });
}

function openCustomerDrawer(cid) {
  var c = DB.customer(cid);
  if (!c) return;

  var tier = DB.tier(c.loyaltyPoints);
  var state = DB.customerState(c);
  var atRisk = state === 'quiet';

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      '<span class="cc-av" style="width:52px;height:52px;font-size:18px">' +
        esc(initialsOf(c.name)) + '</span>' +
      '<div><span class="eyebrow">' + nm(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</span>' +
        '<h3 style="font-size:19px;margin:3px 0 5px">' + nm(c.name) + '</h3>' +
        (pointsMode() ? '<span class="badge ' + tier + '">' + t(tier) + '</span> ' : '') +
        (atRisk ? '<span class="badge low">' + t('cu_quiet') + '</span> ' : '') +
        (state === 'new' ? '<span class="badge neutral">' + t('cu_never_bought') + '</span> ' : '') +
        '<span class="badge neutral num">' + tel(c.phone) + '</span></div>' +
    '</div>';

  var body = '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">' +
    '<div class="stat"><span class="eyebrow">' + t('total_spent') + '</span><div class="val" style="font-size:15px">' + moneyPair(c.spentSyp, c.spentUsd, true) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('loyalty') + '</span><div class="val accent">' + nf(c.loyaltyPoints) + '</div>' +
      '<div class="foot">= ' + money(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_purchase') + '</span><div class="val" style="font-size:15px">' + relDate(c.lastPurchaseDate) + '</div>' +
      '<div class="foot">' + fmtDate(c.lastPurchaseDate) + '</div></div>' +
  '</div>';

  body += '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    '<div class="stat"><span class="eyebrow">' + t('cu_visits') + '</span><div class="val">' + nf(c.visits) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('cu_debt') + '</span><div class="val' + (c.openDebts ? ' warn' : '') + '" style="font-size:15px">' +
      (c.openDebts ? moneyPair(c.debtSyp, c.debtUsd, true) : '—') + '</div>' +
      (c.openDebts ? '<div class="foot">' + nf(c.openDebts) + ' ' + t('invoices').toLowerCase() + '</div>' : '') + '</div>' +
    '<div class="stat"><span class="eyebrow">' + t('cu_since') + '</span><div class="val" style="font-size:15px">' + fmtDate(c.createdAt) + '</div></div>' +
  '</div>';

  /* The top two sizes per family, aggregated on the server over EVERY
     non-voided sale — not re-derived here from whatever 200 sales the
     browser happens to hold, which is what this card used to do and why it
     went blank for anyone not recent. */
  body += '<div class="card mb"><div class="card-head"><h3>' + t('preferred_sizes') + '</h3>' +
    '<div class="card-actions muted small">' + (OG.lang === 'ar' ? 'من كل المشتريات' : 'from every purchase') + '</div></div><div class="card-body">';
  if ((c.sizes || []).length) {
    var byFam = {};
    var famOrder = [];
    c.sizes.forEach(function (s) {
      if (!byFam[s.fam]) { byFam[s.fam] = []; famOrder.push(s.fam); }
      byFam[s.fam].push(s);
    });
    body += '<div style="display:flex;gap:18px;flex-wrap:wrap">';
    famOrder.forEach(function (f) {
      var best = byFam[f][0], second = byFam[f][1];
      body += '<div><span class="eyebrow">' + t('fam_' + f) + '</span>' +
        '<div class="strong-num" style="font-size:24px">' + esc(best.size) + '</div>' +
        '<small class="muted">' + nf(best.qty) + ' ' + t('units').toLowerCase() +
          (second ? ' · ' + esc(second.size) + ' ×' + nf(second.qty) : '') + '</small></div>';
    });
    body += '</div>';
  } else {
    body += '<span class="muted">' + t('none') + '</span>';
  }
  body += '</div></div>';

  /* Filled by the fetch below — the drawer opens now, the invoices follow.
     data-cid guards the late response against a drawer that has already
     moved on to a different customer. */
  body += '<div class="card mb"><div class="card-head"><h3>' + t('purchase_history') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + nf(c.visits) + '</span></div></div>' +
    '<div id="cuHist" data-cid="' + c.id + '">' +
      '<div class="card-body"><span class="muted small">' + t('loading') + '</span></div>' +
    '</div></div>';

  body += '<div class="card"><div class="card-head"><h3>' + t('points_timeline') + '</h3></div>' +
    '<div class="card-body" id="cuPts"><span class="muted small">' + t('loading') + '</span></div></div>';

  /* The way OUT of the counter view and into the whole record. The drawer
     deliberately stays small — at the till the question is a size and a phone
     number — so everything it does not carry lives one tap away. */
  body += '<button class="btn btn-primary btn-block mt" data-act="cu-open" data-id="' + c.id + '">' +
    t('cu_open_profile') + ' →</button>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="pdf" data-id="' + c.id + '">' + t('rec_statement') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="excel" data-id="' + c.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  if (atRisk) {
    body += '<button class="btn btn-primary btn-block btn-lg mt" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>';
  }

  openDrawer({ head: head, body: body });

  if (typeof Shop !== 'undefined' && Shop.live()) {
    Shop.customerHistory(c.id).then(function (r) {
      fillCustomerHistory(c.id, (r && r.sales) || []);
    }).catch(function (err) {
      var host = custHistHost(c.id);
      if (host) {
        host.innerHTML = '<div class="card-body"><span class="muted small">' +
          esc(API.friendly(err)) + '</span></div>';
      }
    });
  } else {
    /* _shot.html and demo mirrors: no server to ask, so the history stays
       honestly empty rather than invented. */
    fillCustomerHistory(c.id, []);
  }
}

function custHistHost(cid) {
  var el = document.getElementById('cuHist');
  return el && el.getAttribute('data-cid') === String(cid) ? el : null;
}

/* One sale's money, in the sale's OWN currency — a dollar invoice must not
   be drawn as lira at today's rate. */
function saleMoney(minor, cur) {
  return '<bdi dir="ltr">' + (cur === 'USD' ? moneyUsdRaw(minor) : moneySypRaw(minor)) + '</bdi>';
}

function fillCustomerHistory(cid, rows) {
  var host = custHistHost(cid);
  if (!host) return;                                 /* drawer moved on */

  var pts = document.getElementById('cuPts');
  if (!rows.length) {
    host.innerHTML = '<div class="card-body"><span class="muted">' + t('none') + '</span></div>';
    if (pts) pts.innerHTML = '<span class="muted">' + t('none') + '</span>';
    return;
  }

  var h = '<div class="table-wrap" style="max-height:280px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
    '<th>' + t('invoice') + '</th><th>' + t('date') + '</th><th>' + t('items') + '</th>' +
    '<th class="num">' + t('total') + '</th><th class="num">' + t('points') + '</th>' +
  '</tr></thead><tbody>';

  rows.forEach(function (s) {
    /* Rows only open when the invoice is among the hydrated sales — the
       history reaches further back than the 200 the app holds, and a click
       that silently did nothing would read as broken. unit_cost is never
       drawn here for ANYONE: the server already strips it for those without
       cost.read, and a cost across the counter is not this screen's job. */
    var open = !!DB.sale(s.id);
    var items = (s.items || []).map(function (it) {
      return nm(it.name) + ' (' + esc(it.size || '—') + ') ×' + it.qty +
             ' @ ' + saleMoney(it.unit_price, s.currency);
    }).join('<br>');
    var p = (s.points_earned ? '+' + nf(s.points_earned) : '') +
            (s.points_used ? (s.points_earned ? ' ' : '') + '−' + nf(s.points_used) : '');
    h += '<tr' + (open ? ' class="clickable" data-act="open-invoice" data-id="' + esc(s.id) + '"' : '') +
         (s.voided ? ' style="opacity:.55"' : '') + '>' +
      '<td><b>' + esc(s.id) + '</b>' +
        (s.voided ? ' <span class="badge critical">' + t('cu_voided') + '</span>' : '') +
        (s.discount ? '<br><small class="muted">' + t('discount') + ' −' + saleMoney(s.discount, s.currency) + '</small>' : '') + '</td>' +
      '<td class="muted num">' + fmtDate(s.at) + '</td>' +
      '<td class="muted small">' + (items || '—') + '</td>' +
      '<td class="num"><b>' + saleMoney(s.total, s.currency) + '</b>' +
        /* The rate frozen into THIS sale — the number that makes last
           month's lira figure auditable after the rate has moved. Shown for
           lira sales; on a dollar sale it is 1 and says nothing. */
        (s.currency !== 'USD' && s.fx_rate
          ? '<br><small class="muted"><bdi dir="ltr">$1 = ' + nf(s.fx_rate) + '</bdi></small>'
          : '') + '</td>' +
      '<td class="num muted">' + (p || '—') + '</td>' +
    '</tr>';
  });
  h += '</tbody></table></div>';
  host.innerHTML = h;

  if (pts) {
    var live = rows.filter(function (s) {
      return !s.voided && (s.points_earned || s.points_used);
    }).slice(0, 6);
    pts.innerHTML = live.length
      ? '<ul class="timeline" style="margin:0;padding-inline-start:14px">' +
        live.map(function (s) {
          return '<li class="plus"><b>' +
            (s.points_earned ? '+' + nf(s.points_earned) : '−' + nf(s.points_used)) + ' ' + t('points') + '</b>' +
            '<small>' + esc(s.id) + ' · ' + fmtDate(s.at) + ' · ' + saleMoney(s.total, s.currency) + '</small></li>';
        }).join('') + '</ul>'
      : '<span class="muted">' + t('none') + '</span>';
  }
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
      ? 'آخر شراء: ' + relDate(c.lastPurchaseDate) + ' · إجمالي الإنفاق ' + moneyPairText(c.spentSyp, c.spentUsd)
      : 'Last purchase ' + relDate(c.lastPurchaseDate) + ' · lifetime ' + moneyPairText(c.spentSyp, c.spentUsd)
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
     Every scan away from the till lands here (at the till an exact product
     code goes straight into the cart — handleScan), so this row is what the
     scanner is for on every other screen: put it away, take it out, or sell
     it. Check in and check out go through DB.moveStock — the same audited
     path the warehouse uses — so a hardware scan can never become a second
     way to change stock. */
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
      /* Focused on open so Enter sells without a mouse — scan, Enter, done,
         with the detail still there if it is wanted. (Exact scans AT the
         till skip this sheet entirely and land in the cart; this focus
         serves every other screen, and the partial-code case where the
         sheet is the confirmation step.) */
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
