# CUSTOMERS-RECON-2.md

Second reconnaissance for the Customers rebuild. **Read-only pass — nothing in the repo or the database
was modified; no `git add`, no migration, no `npm install`.** The only file created is this one.

Every claim carries a `path:line-range` citation or a query I ran; anything I could not verify is
marked `UNVERIFIED` or `NOT FOUND`. Personal data is redacted as `[name]` / `+963XXXXXXXXX`.

State examined: `main` at `c2c6a82` (2026-09-01 18:48 +0300), working tree clean, database
`server/data/og.db` (WAL, last migration `027_gift_receipt.sql` applied 2026-08-31), opened with
`node:sqlite` `{ readOnly: true }`. The shop server was running on `:8090` (PID 32168) throughout; I did
not start a second one and did not log in.

---

## Read this first — "Phase 1" is not in this repository

The brief says Phase 1 of the Customers rebuild has already been run and refers to "the new Phase 1
spend and debt fields". **I could not find it.** Against the commit that added `CUSTOMERS-RECON.md`
(`992e0ba`, 2026-08-31 03:56 +0300):

```
$ git diff 992e0ba HEAD --stat
 CLAUDE.md                              |  55 ++++--
 js/app-actions.js                      |  32 +++-
 js/app-documents.js                    |  12 +-
 js/app-i18n-extra.js                   |   2 +
 js/app-i18n.js                         |  20 ++
 js/app-settings.js                     |  25 +++
 js/data.js                             |  11 ++
 js/pos.js                              |  41 +++-
 js/receipt.js                          | 331 +++++++++++++++++++++++++++++----
 server/index.js                        |   6 +-
 server/lib/alerts.js                   |  18 ++
 server/lib/db.js                       |  13 ++
 server/lib/printing.js                 |  21 ++-
 server/lib/sync-worker.js              | 116 ++++++++----
 server/migrations/027_gift_receipt.sql |  70 +++++++
 server/scripts/purge-demo.js           |  16 +-
 server/scripts/supabase-check.js       | 166 +++++++++++++++--
 server/scripts/supabase-reconcile.js   | Bin 8929 -> 11865 bytes
 server/scripts/supabase-restore.js     |  51 ++++-
 server/scripts/supabase-sync.js        | 118 ++++++++----
 server/supabase/009_gift_receipt.sql   |  22 +++
 sw.js                                  |   2 +-
```

- `server/lib/customers.js`, `js/app-customers-scan.js`, `js/api.js`, `js/shop.js`, `js/bulk.js`,
  `js/app-warehouse.js` (the customer form) are **byte-identical** to what the first recon quoted.
- The 11 lines added to `js/data.js` are the gift-receipt config keys (`RECEIPT_GIFT_*`); the
  customer block of `hydrate()` is unchanged.
- No commit on any branch mentions customers after `992e0ba` (`git log --all -i --grep=customer`
  lists only older work); `archive/hand-uploads` has nothing beyond its four upload commits;
  `git stash list` is empty; `git status --ignored` shows only `.claude/` and `agent/agent-config.json`.
- The customers table still has exactly the columns migration `001` + `004` + `007` gave it
  (`PRAGMA table_info(customers)`, §C6). There is no debt column anywhere near it.

So everything below answers against the code **as it exists at HEAD**, which is the pre-Phase-1 code
the first recon described. Wherever a question says "after Phase 1", the answer is "unchanged since
the first recon", with the evidence. If Phase 1 lives on another machine or an unpushed branch, this
report is against the wrong tree and should be re-run there — see §F4 and the Confidence block.

---

# Part A — Scale, and whether the current approach survives it

## A1. Row counts

Queries run read-only through `node:sqlite` (script in my scratchpad, not the repo):

```
SELECT archived, COUNT(*) FROM customers GROUP BY archived
  → archived=0: 1          (no archived rows; demo=0 for that row)

SELECT (customer_id IS NULL) AS no_customer, voided, COUNT(*) FROM sales GROUP BY 1, 2
  → no_customer=1, voided=0: 10   (every sale is a walk-in; nothing voided)

SELECT COUNT(*) FROM sale_items → 11
SELECT COUNT(*), MIN(at), MAX(at) FROM sales → 10, 2026-08-24T05:59:40Z, 2026-09-01T15:40:12Z
```

One customer, ten sales, **zero sales attached to a customer**.

## A2. Busiest customer

```
SELECT c.id, '[name]', COUNT(s.id) AS sales
  FROM customers c LEFT JOIN sales s ON s.customer_id = c.id
 GROUP BY c.id ORDER BY sales DESC LIMIT 5
  → id 81, [name], sales 0, live_sales 0
```

There is no top five: one customer, with no sales. Every scale question in this part is therefore
answered by extrapolation from measured per-row costs, not from a real distribution.

## A3. `GET /api/customers` — whole table, no pagination, no server-side search

Still true. The route and the query it calls, verbatim:

```js:server/index.js:588-600
router.add('GET /api/customers', requirePerm('customer.read', (ctx) => {
  sendOk(ctx.res, {
    customers: Customers.list({
      includeArchived: Auth.can(ctx.user, 'customer.write')
    })
  });
}));

router.add('GET /api/customers/:id/history', requirePerm('customer.read', (ctx) => {
  const c = Customers.byId(Number(ctx.params.id));
  if (!c) return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  sendOk(ctx.res, { sales: Customers.historyFor(c.id).map(s => scrubCost(s, ctx.user)) });
}));
```

```js:server/lib/customers.js:27-49
const SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address, c.note,
         c.loyalty_points, c.archived, c.demo, c.created_at, c.updated_at,
         COALESCE(agg.spent,  0) AS total_spent,
         COALESCE(agg.visits, 0) AS visits,
         agg.last_at             AS last_purchase_at
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(total)  AS spent,
             COUNT(*)    AS visits,
             MAX(at)     AS last_at
        FROM sales
       WHERE voided = 0 AND customer_id IS NOT NULL
       GROUP BY customer_id
    ) agg ON agg.customer_id = c.id`;

export function list({ includeArchived = false } = {}) {
  return get().prepare(
    `${SELECT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.name`
  ).all();
}
```

No `LIMIT`, no `OFFSET`, no `q` parameter is read (`ctx.url.searchParams` is never touched in this
route). The only filter is the `includeArchived` gate, keyed on `customer.write` — which the live
`role_permissions` table grants to **cashier** as well as manager (§C4), so a cashier's browser
receives archived rows too. The browser side requests it once at sign-in with no parameters:

```js:js/shop.js:67
    customers: function () { return want('customer.read', '/api/customers', { customers: [] }); },
```

The one route that *is* per-customer — `GET /api/customers/:id/history` — has **no caller** in
`js/` (`grep -rn "/history" js` returns nothing; the only `/api/customers` strings in `js/` are
`shop.js:67,336,337,339`).

## A4. Payload size, measured and extrapolated

Measured by calling `Customers.list({ includeArchived: true })` through the server's own
`DB.openReadOnly()` and `JSON.stringify`-ing the `{ customers: [...] }` body the route sends:

```
rows: 1   bytes of {customers:[...]}: 307
the one row, redacted:
{"id":81,"name":"[name]","phone":"+963XXXXXXXXX","city":"Aleppo","source":"in-store",
 "address":null,"note":null,"loyalty_points":0,"archived":0,"demo":0,
 "created_at":"2026-08-24T18:39:18.933Z","updated_at":"2026-08-24T18:39:18.933Z",
 "total_spent":0,"visits":0,"last_purchase_at":null}
bytes of that row: 291
bytes of the derived fields (total_spent / visits / last_purchase_at) inside it: 50
keys sent: id, name, phone, city, source, address, note, loyalty_points, archived, demo,
           created_at, updated_at, total_spent, visits, last_purchase_at
```

That row is mostly nulls and zeros, so it understates. A **synthetic, clearly-not-measured** filled
row (18-char Arabic name, 13-char phone, 6-char city, 40-char Arabic address, 30-char note, a
populated `last_purchase_at`) came to **462 bytes, of which the three derived fields are 78 bytes**.

Extrapolation (uncompressed JSON; the server sets no `Content-Encoding`, `UNVERIFIED` — I did not
read `server/lib/http.js` for gzip):

| customers | sparse rows (291 B) | filled rows (462 B) | derived-field share |
|---|---|---|---|
| 1 (today) | 0.3 KB | — | 50 B |
| 1,000 | ~285 KB | ~450 KB | ~50–78 KB (≈17%) |
| 5,000 | ~1.4 MB | ~2.3 MB | ~250–390 KB (≈17%) |

Two corrections to the question's premise:

1. **There are no "Phase 1 spend and debt fields."** The derived fields in the payload today are
   `total_spent`, `visits` and `last_purchase_at`, all of which the first recon already quoted
   (`server/lib/customers.js:27-42`). **No per-customer debt figure exists anywhere in the response**;
   debt is derived in the browser from `DB.sales` (§C6, §A6).
2. Of the derived fields the browser keeps only two. `hydrate()` **drops `visits`, `created_at` and
   `updated_at` on arrival** (`js/data.js:2277-2293`, quoted in §A6), and shows `history.length` as
   "orders" instead (`js/app-customers-scan.js:68`).

So at 5,000 customers the shop pays for ~2 MB on every sign-in **and after every write**, because
`Shop.write()` re-runs the whole `load()` after each accepted write (`js/shop.js:223-229`), and so do
`Bulk.pushRows` (`js/bulk.js:415-416`) and `pushPartner` (`js/data.js:2499-2510`). Archiving one
customer from the bulk bar re-downloads the whole list.

## A5. The linear scans

The lookups are `Array.prototype.filter(...)[0]` — a full walk and a throw-away array on every call:

```js:js/data.js:622-625
  product: function (id) { return products.filter(function (p) { return p.id === id; })[0]; },
  customer: function (id) { return customers.filter(function (c) { return c.id === id; })[0]; },
  sale: function (id) { return sales.filter(function (s) { return s.id === id; })[0]; },
  variantsOf: function (pid) { return variants.filter(function (v) { return v.productId === pid; }); },
```

```js:js/data.js:645-647
  variantBySku: function (sku) { return variants.filter(function (v) { return v.sku === sku; })[0]; },
  variantByBarcode: function (b) { return variants.filter(function (v) { return v.barcode === b; })[0]; },
  variantByLabelCode: function (c) { return variants.filter(function (v) { return v.labelCode === c; })[0]; },
```

There is no lookup by phone at all; every phone search is a `filter` over `DB.customers` with
`indexOf` (§B5). `DB.customer(id)` call sites (`grep -rn "DB\.customer(" js`):

```
js/app-actions.js:833        (after creating a customer)
js/app-customers-scan.js:84  openCustomerDrawer
js/app-customers-scan.js:175 openWhatsapp
js/app-documents.js:11,176   invoiceHtml / receiptHtml
js/app-export.js:408         customerStatementSpec
js/bulk.js:84                selCustomers — once per selected id
js/data.js:1706              DB.debts() — once per open credit sale
js/money.js:476              remind
js/pos.js:436,565,1037,1075,1369,1577
js/receipt.js:819
```

The ones inside loops, in order of how badly they scale:

**(a) The Customers screen re-renders every card on every keystroke.** The search box dispatches
`render()` per input event, with no debounce:

```js:js/app-changes.js:21
  'cust-q': function (el) { OG.cust.q = el.value; render(); focusBack('[data-change="cust-q"]', el.value.length); },
```

`render()` (`js/app-routing.js:213-257`) calls `viewCustomers()`, which builds HTML for **every**
matching customer with no cap, and per card calls `DB.daysSince`, `DB.tier`, `Bulk.has`, `relDate`,
`moneyShort` (`js/app-customers-scan.js:52-78`, quoted in §B1's neighbour). It also calls
`DB.inactiveCustomers(90)` for the badge (line 29). Then `render()` calls `Bulk.paint()`
(`js/app-routing.js:243`), which calls `visibleIds('customers')` → `customerRows()` **a second time**
(`js/bulk.js:50-53,143-155`), and `labelWideTables(host)` walks every `table.tbl` in the view. At
5,000 customers that is 5,000 `innerHTML` cards plus two full filter+sorts per keypress.

Measured in headless Chrome against a synthetic 5,000-customer `DB` (real code, synthetic rows —
see §A7): `customerRows()`-style filter+sort **0.34 ms**, `DB.inactiveCustomers(90)` **1.0 ms**. The
cheap part is the JavaScript; the expensive part is building and parsing 5,000 cards of HTML per
keystroke, which I did not measure (`UNVERIFIED`) because it needs the full app in a real layout.

**(b) `hydrate()` scans the product array once per sale line:**

```js:js/data.js:2324-2336
        items: (s.items || []).map(function (it) {
          return {
            sku: it.sku, productId: it.product_id, name: it.name,
            type: (DB.product(it.product_id) || {}).type || '',
```

O(sale lines × products), bounded by the 200-sale cap, so it stays flat as customers grow.

**(c) `DB.debts()` scans customers once per open credit sale and is called four times per Money
render:**

```js:js/data.js:1700-1719
  debts: function () {
    return sales
      .filter(function (s) { return s.payment === 'credit' && DB.debtBalance(s) > 0; })
      .map(function (s) {
        return {
          sale: s,
          customer: s.customerId ? DB.customer(s.customerId) : null,
          name: s.customerName,
          total: s.total,
          paid: DB.debtPaid(s.id),
          balance: DB.debtBalance(s),
          age: DB.daysSince(s.date)
        };
      })
      .sort(function (a, b) { return b.age - a.age; });
  },

  debtTotal: function () {
    return DB.debts().reduce(function (a, d) { return a + d.balance; }, 0);
  },
```

`DB.debtPaid` is itself a `reduce` over every debt payment, so `debts()` is O(credit sales ×
(customers + payments)). `Money.view()` calls `DB.debtTotal()` at `js/money.js:25` and `debtTab()`
calls `DB.debts()`, `DB.debtTotal()` and `DB.debtAgeing()` (which calls `debts()` again) at
`js/money.js:204-206` — four full passes per paint.

**(d) The customer drawer scans the sales array once per history entry:**

```js:js/app-customers-scan.js:86-87
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
    .sort(function (a, b) { return b.date - a.date; });
```

O(history × 200) — bounded today, but `customerStatementSpec` does the same (`js/app-export.js:410`).

**(e) The worst case I measured:** 5,000 `DB.customer(id)` calls against 5,000 customers took
**121 ms** in headless Chrome. That shape — one lookup per row of something else — is exactly what
`Bulk.selCustomers` (`js/bulk.js:84`) and `DB.debts()` do, and what a profile timeline joining sales
to customers would do if written the same way.

Nothing indexes customers by id or phone in the browser, and `custById` in `hydrate()` is a local
variable thrown away after linking history (`js/data.js:2295-2296`).

## A6. The 200-sale cap — unchanged

The server clamps to 200 whatever is asked for, and the browser asks for exactly that:

```js:server/index.js:701-706
router.add('GET /api/sales', requirePerm('sell', (ctx) => {
  const limit = Math.min(200, Number(ctx.url.searchParams.get('limit')) || 50);
  sendOk(ctx.res, {
    sales: Sales.recent(limit).map(s => scrubCost(s, ctx.user))
  });
}));
```

```js:js/shop.js:68
    sales:    function () { return want('sell', '/api/sales?limit=200', { sales: [] }); },
```

A customer's history is built **only** from that array (plus open credit sales folded in from
`/api/money`), inside `hydrate()`:

```js:js/data.js:2272-2296
    /* ---- customers -------------------------------------------------------
       totalSpent and lastPurchaseDate come from the server, where they are
       derived from the sales table rather than stored. A stored total is a
       second source of truth for money, and the first void makes it wrong. */
    customers.length = 0;
    (payload.customers || []).forEach(function (c) {
      customers.push({
        id: c.id,
        name: c.name,
        phone: c.phone || '',
        city: c.city || '',
        source: c.source || 'in-store',
        address: c.address || '',
        note: c.note || '',
        loyaltyPoints: Number(c.loyalty_points) || 0,
        totalSpent: Number(c.total_spent) || 0,
        lastPurchaseDate: c.last_purchase_at ? new Date(c.last_purchase_at) : null,
        archived: !!c.archived,
        demo: !!c.demo,
        history: []
      });
    });

    var custById = {};
    customers.forEach(function (c) { custById[c.id] = c; });
```

```js:js/data.js:2303-2318
    sales.length = 0;
    /* Every credit sale still carrying a balance, however old, folded in
       before the mapping so it gets exactly the same shape.

       The debt book is derived from this array, and this array is the last
       200 sales — so an unpaid debt older than that quietly stopped being
       owed, which is the worst thing this screen could do. The server sends
       them unbounded; deduped on id because a recent one is in both. */
    var srcSales = (payload.sales || []).slice();
    if (payload.money && payload.money.creditSales) {
      var have = {};
      srcSales.forEach(function (s) { have[s.id] = true; });
      payload.money.creditSales.forEach(function (s) { if (!have[s.id]) srcSales.push(s); });
    }

    srcSales.forEach(function (s) {
```

```js:js/data.js:2354-2355
      sales.push(sale);
      if (custById[sale.customerId]) custById[sale.customerId].history.push(sale.id);
```

The unbounded credit-sale source is `Money.openDebts()`:

```js:server/lib/money.js:205-214
export function openDebts() {
  const d = DB.get();
  return d.prepare(
    `SELECT s.*, COALESCE((SELECT SUM(amount) FROM debt_payments p
                            WHERE p.sale_id = s.id), 0) AS paid
       FROM sales s
      WHERE s.payment = 'credit' AND s.voided = 0
      ORDER BY s.created_at DESC`
  ).all().map((s) => ({ ...s, balance: s.total - s.paid })).filter((s) => s.balance > 0);
}
```

Note it returns `s.*` **without `items`** — a credit sale older than 200 arrives with no lines, and
`hydrate()` maps `(s.items || [])` to an empty list, so the drawer's "preferred sizes" and the
`items` column show nothing for it.

**Current situation, stated exactly:** a customer's `history`, the drawer's purchase table, its
points timeline, the "orders" figure on the card, and the PDF statement all see at most the shop's
last 200 non-voided sales plus any open credit sales. `Customers.historyFor` (`LIMIT 50`,
`server/lib/customers.js:57-65`) and its route are never called. Phase 1 changed none of this
(`js/data.js` diff since `992e0ba` is the gift-receipt config only).

## A7. Timing `DB.hydrate()`

Two measurements, because I could not run the signed-in app (no credentials exist for me and the
session cookie is `HttpOnly`; the server on `:8090` belongs to the shop and I did not start a second
one).

**Server side** — the exact `lib` functions each bootstrap route calls, timed through
`DB.openReadOnly()` (avg of 20 calls, warm):

```
GET /api/config      (config+warehouses+rate)   0.100 ms    4,169 bytes
GET /api/catalogue   Cat.list({includeHidden})  0.166 ms    3,832 bytes
GET /api/customers   Customers.list()           0.034 ms      307 bytes
GET /api/sales?limit=200  Sales.recent(200)     0.115 ms    6,566 bytes
GET /api/movements?limit=400  Stock.recent(400) 0.123 ms   10,151 bytes
GET /api/partner     Partner.all()              0.180 ms    1,224 bytes
GET /api/purchase-orders  Purchasing.list()     0.021 ms       21 bytes
GET /api/money       Money.all()                0.117 ms      159 bytes
GET /api/stock-counts  Counts.list({})          0.034 ms      237 bytes
GET /api/suppliers   Partner.suppliers()        0.011 ms       16 bytes
GET /api/employees   Partner.employees()        0.011 ms       16 bytes
GET /api/notifications  Alerts.list(manager)    0.128 ms      394 bytes
whole hydrate payload: 26,966 bytes
```

**Browser side** — `DB.hydrate()` itself, in headless Chrome 152 loading the repo's own `codes.js`,
`data.js`, `app-state.js`, `app-i18n.js` from disk and the payload above (assembled by the same
script in the shape `Shop.load()` hands to `hydrate`, `js/shop.js:99-114`):

```
REAL DB (today):                          0.144 ms per DB.hydrate()  (avg of 50; includes a 0.088 ms JSON clone)
SYNTHETIC 1,000 customers + 200 sales:    0.980 ms                    (clone alone 0.810 ms)
SYNTHETIC 5,000 customers + 200 sales:    5.360 ms                    (clone alone 4.740 ms)
```

**The number:** about **0.15 ms** today; **under 1 ms** at 1,000 customers; **~5 ms** at 5,000
(of which ~90% is copying the payload, i.e. the same work `JSON.parse` does on the response).

**What dominates:** at today's size, nothing in `hydrate()` — the twelve parallel HTTP round trips
in `Shop.load()` do, and I could not measure those (`UNVERIFIED`). At scale, the customer array's
own size (parse + mapping) grows linearly and stays cheap; the parts that would hurt are not in
`hydrate()` but downstream of it (§A5a) — and the fact that every write re-fetches everything (§A4).

What is **not** in these numbers: `Auth.guard` → `/api/auth/me`, the first `render()`, Chart.js, the
service worker, and the wifi. Treat the browser figure as "the mapping function is not the problem",
not as "sign-in takes 0.15 ms".

---

# Part B — The visual vocabulary to reuse

## B1. The customer drawer as it stands

`openCustomerDrawer`, in full:

```js:js/app-customers-scan.js:83-170
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
```

The shell it goes into, and how it closes:

```js:js/app-util.js:290-304
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
```

```css:css/dialogs-customers-jobs.css:40-54
.drawer-backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / .70); z-index: 190; animation: fade .15s ease both; }
.drawer {
  position: fixed; top: 0; inset-inline-end: 0; height: 100%; width: 620px; max-width: 96vw;
  background: var(--app); border-inline-start: 1px solid var(--border);
  box-shadow: var(--shadow-lg); z-index: 191;
  display: flex; flex-direction: column;
  animation: slideIn 220ms cubic-bezier(.4, 0, .2, 1) both;
}
@keyframes slideIn { from { transform: translateX(100%); } to { transform: none; } }
body.rtl .drawer { animation-name: slideInR; }
@keyframes slideInR { from { transform: translateX(-100%); } to { transform: none; } }
.drawer-head { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; gap: 14px; align-items: flex-start; background: var(--card); }
.drawer-head .x { width: 28px; height: 28px; border-radius: var(--radius-sm); transition: background var(--t); }
.drawer-head .x:hover { background: var(--accent); }
.drawer-body { flex: 1; overflow-y: auto; padding: 20px; }
```

```css:css/bulk-gate-responsive.css:409
  .drawer { width: 100%; }
```
(inside `@media (max-width: 720px)`, line 359).

Other classes the drawer body relies on and where they live: `.cc-av`
(`css/dialogs-customers-jobs.css:94-98`), `.eyebrow` (`css/motion-cards.css:79`), `.badge` + tier /
`critical` / `neutral` (`css/motion-cards.css:226-240`), `.stat .val .foot .accent`
(`css/motion-cards.css:142-170`), `.card .card-head .card-actions .card-body`
(`css/motion-cards.css:120-135`), `.table-wrap table.tbl .tbl-compact tr.clickable td.num`
(`css/motion-cards.css:174-208`), `.timeline li.plus` (`css/dialogs-customers-jobs.css:105-109`),
`.strong-num` (`css/bulk-gate-responsive.css:296`), `.muted .small .mt .mb`
(`css/bulk-gate-responsive.css:293-295`), `.btn .btn-ghost .btn-primary .btn-block .btn-lg`
(`css/motion-cards.css:83-106`), `.grid` (`css/motion-cards.css:137`), `.num` (`css/tokens.css:253`).

**How it is opened** — five ways, all ending in `openCustomerDrawer(id)`:

```js:js/app-actions.js:331
  'open-customer': function (el) { openCustomerDrawer(+el.getAttribute('data-id')); },
```
```js:js/app-actions.js:272-277
  'search-cust': function (el) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('globalSearch').value = '';
    var id = +el.getAttribute('data-id');
    go('customers', function () { openCustomerDrawer(id); });
  },
```
```js:js/palette.js:101
          run: function () { go('customers', function () { openCustomerDrawer(c.id); }); }
```
```js:js/app-export.js:246-248
    case 'customer':
      go('customers', function () { openCustomerDrawer(+id); });
      return true;
```
(`handleDeepLink`, for `#open/customer/<id>` — from a QR or a scanned code, §D2.)

**How it is closed / dismissed:** the `×` and the backdrop both carry `data-act="drawer-close"`
(`js/app-actions.js:221` → `closeDrawer`); Escape closes it when no modal is open:

```js:js/app-boot.js:50-57
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modalOpen()) { closeModal(); return; }
      if (document.getElementById('drawer-root').firstChild) { closeDrawer(); return; }
      var sc = Bulk.scope();
      if (sc && Bulk.count(sc)) { Bulk.clear(sc); render(); Bulk.paint(); }
    }
  });
```

and **every navigation closes it** — `go()` calls `closeDrawer()` before rendering
(`js/app-routing.js:279`), while a plain `render()` (search keystroke, filter chip, `refreshAll()`
after any write) does **not**, so the drawer survives a repaint underneath it showing the *old*
customer object (the array is emptied and refilled by `hydrate`, but the drawer's HTML is static).

**Focus trap: none.** There is no `role="dialog"`, no `aria-modal`, no `inert`, no `tabindex`
management and no focus move into the drawer (`grep -rn "aria-modal\|role=\"dialog\"\|inert" js`
finds only the command palette, `js/palette.js:137`). Tab order continues into the page behind the
backdrop. The `onOpen` hook exists but the customer drawer passes none.

**Narrow screen:** the aside becomes full-width at ≤720px (`bulk-gate-responsive.css:409`). But the
three-stat grid at the top is an inline `style="grid-template-columns:repeat(3,1fr)"`, and the
phone rule that collapses inline grids only matches `.view .grid[style*="minmax"]`
(`css/bulk-gate-responsive.css:403`) — the drawer is rendered into `#drawer-root`, outside `#app
.view`, and does not use `minmax`, so on a 320px phone it stays three columns of 28px stat figures
(`UNVERIFIED` visually; derived from the selectors). The history table has four headers, so
`labelWideTables` leaves it as a table (threshold is five, §B4) — and `labelWideTables` is only run
over `#view` anyway (`js/app-routing.js:245`), never over the drawer.

## B2. Every other drawer or modal

Every overlay goes through one of three functions: `openModal` (`js/app-util.js:260-288`), `openDrawer`
(above), or the command palette's own root (`js/palette.js:129-157`). Callers, from
`grep -rn "openDrawer\|openModal" js`:

**Drawers (3):** `openCustomerDrawer` (`app-customers-scan.js:169`), `openProductDrawer`
(`app-products.js:278`), `openJobDrawer` (`app-jobs-reports.js:357`).

**Modals (by file):**
- `app-shell.js:321` More sheet (`sheet: true`), `:439` change password
- `app-boot.js:113` calibration rulers
- `app-customers-scan.js:218` duplicate-product guard, `:291` unknown scanned code → attach,
  `:491` scan result sheet (`size: 'wide sc-modal'`), `:586` reorder
- `app-warehouse.js:221` **new customer** (`openNewCustomer`), `:285` transfer, `:1071` (label sheet)
- `app-documents.js:275` thermal receipt preview (with `onClose` cleanup), `:314` A4 invoice
- `app-jobs-reports.js:374` partner invoice (OG side)
- `app-print-labels.js:196` quick label picker
- `bulk.js:209` reprice, `:239` bulk WhatsApp message
- `deliveries.js:316` delivery-failed reason
- `export.js:384` PDF preview
- `labels.js:364` label preview/print; `labels60.js:215` 60×40 preview
- `money.js:277` open shift, `:316` close shift, `:365` add expense, `:418` settle debt
- `pos.js:890` pick size
- `stock.js:387` discard count, `:408` post count
- `scan.js:202` camera scanner

The one I'd copy is the **customer form**, because it is the only modal in the customers area that
already talks to the server and it shows the house pattern end to end — prefill from what was typed,
`Shop.write` with a local mirror, re-find by id after the reload, callback into the caller:

```js:js/app-warehouse.js:211-244
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
```

```js:js/app-actions.js:783-841
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
```

Note what the form does **not** have: address, note, source, or any edit mode — there is no
edit-customer form anywhere (`Shop.updateCustomer` is called only by `js/bulk.js:321,325` to flip
`archived`).

The modal shell and its CSS:

```js:js/app-util.js:257-288
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
```

```css:css/dialogs-customers-jobs.css:15-38
.modal-backdrop {
  position: fixed; inset: 0; background: rgb(0 0 0 / .78); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 26px; z-index: 200;
  animation: fade .15s ease both;
}
.modal {
  background: var(--popover); border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 100%; max-width: 540px; max-height: 92vh; display: flex; flex-direction: column;
  animation: pop .18s cubic-bezier(.4, 0, .2, 1) both;
}
@keyframes pop { from { opacity: 0; transform: scale(.96) translateY(6px); } to { opacity: 1; transform: none; } }
.modal.wide { max-width: 940px; }
.modal.narrow { max-width: 430px; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 14px; }
.modal-head h3 { font-size: 16.5px; font-weight: 700; letter-spacing: -.02em; }
.modal-head .x {
  margin-inline-start: auto; border: 0; background: none; font-size: 20px; line-height: 1;
  ...
}
.modal-head .x:hover { background: var(--accent); color: var(--foreground); }
.modal-body { padding: 0 20px 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; gap: 9px; justify-content: flex-end; background: var(--subtle); border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
```

```css:css/bulk-gate-responsive.css:537-543
.modal-backdrop.as-sheet { align-items: flex-end; padding: 0; }
.modal.sheet {
  width: 100%; max-width: none; border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: sheetUp var(--d-3) var(--e-out) both;
}
@keyframes sheetUp { from { transform: translateY(100%); } to { transform: none; } }
```

The money-side modal worth studying for a debt tool is `settle` / `settle-go`
(`js/money.js:414-470`): server-first through `Shop.write`, an `opId` per attempt, the balance shown
from `DB.debtBalance`, and the toast built from the server's own `balance` reply.

## B3. Filter chips / segmented controls — three patterns, one of them dominant

**1. `.chip-row` / `.chip`** — the filter chip. **59 occurrences** across `js/`
(`grep -c 'class="chip'`: app-settings 21, app-warehouse 13, labels 7, yalla 7,
app-customers-scan 5, dashboard 2, pos 2, stock 2). The Customers screen's own:

```js:js/app-customers-scan.js:41-49
  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.cust.q) + '" data-change="cust-q">' +
    '<div class="chip-row">' +
      '<button class="chip ' + (OG.cust.filter === 'all' ? 'on' : '') + '" data-act="cust-filter" data-f="all">' + t('all_customers') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'risk' ? 'on' : '') + '" data-act="cust-filter" data-f="risk">' + t('risk_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'gold' ? 'on' : '') + '" data-act="cust-filter" data-f="gold">' + t('gold_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'archived' ? 'on' : '') + '" data-act="cust-filter" data-f="archived">' + t('bk_archived_only') + '</button>' +
    '</div>' +
    '<span class="badge neutral">' + list.length + ' / ' + DB.customers.length + '</span></div>';
```

```js:js/app-actions.js:341
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
```

```css:css/inputs-dashboard-pos.css:92-106
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.filters .inp { width: auto; min-width: 160px; }
.filters .grow { flex: 1; min-width: 220px; }

.chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--input); background: var(--card);
  padding: 0 14px; height: 34px; border-radius: var(--radius);
  font-size: 12.5px; font-weight: 600; color: var(--muted-foreground);
  display: inline-flex; align-items: center; white-space: nowrap;
  transition: background var(--t), color var(--t), border-color var(--t);
}
.chip:hover { background: var(--accent); color: var(--foreground); border-color: var(--border-strong); }
.chip.on { background: var(--brand); border-color: var(--brand); color: var(--brand-foreground); font-weight: 700; }
.chip:disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }
```

Variants: `.chip.chip-x` (an active chip with a ✕ to clear a date, `css/yalla-scan.css:312`,
`js/yalla.js:492`) and the phone override `.chip { padding: 9px 14px; }`
(`css/bulk-gate-responsive.css:501`). The same pattern is used with `data-st`, `data-yl` and
`data-pos` namespaces on other screens (`js/stock.js:293-298`, `js/yalla.js:480-492`,
`js/pos.js:768-770`).

**2. `.tabs` / `.tab`** — the tab strip (warehouse `app-warehouse.js:58`, money `money.js:31`,
reports `app-jobs-reports.js:34`, print `app-jobs-reports.js:388`):

```js:js/money.js:31-33
    h += '<div class="tabs mb">' +
      '<button class="tab ' + (S.tab === 'shift' ? 'on' : '') + '" data-mn="tab" data-t="shift">' +
        t('mn_shift') + (open ? '<span class="tab-dot on"></span>' : '') + '</button>' +
```

```css:css/warehouse-settings.css:11-18
.tabs { display: inline-flex; gap: 3px; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; margin-bottom: 18px; flex-wrap: wrap; }
.tab {
  border: 0; background: none; padding: 0 16px; height: 32px; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600; color: var(--muted-foreground);
  transition: background var(--t), color var(--t);
}
.tab:hover { color: var(--foreground); background: var(--accent); }
.tab.on { background: var(--brand); color: var(--brand-foreground); font-weight: 700; }
```

**3. `.seg`** — two *different* components share the name. v1 is the topbar's two-button switch
(language, currency; `js/app-shell.js:350-357`, More sheet `:286-293`, POS `pos.js:656,715`,
Yalla `yalla.js:146,150,552`):

```css:css/shell.css:186-195
/* Segmented control = shadcn TabsList */
.seg { display: inline-flex; gap: 2px; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 3px; }
.seg button {
  border: 0; background: none; padding: 5px 12px; border-radius: var(--radius-sm);
  font-size: 12.5px; font-weight: 600; color: var(--muted-foreground);
  transition: background var(--t), color var(--t);
}
/* Light pill, not lime — lime stays reserved for nav state and real actions. */
.seg button.on { background: var(--foreground); color: var(--primary-foreground); font-weight: 700; }
.seg button:not(.on):hover { color: var(--foreground); background: var(--accent); }
```

v2 is the Warehouse screen's standalone pill, redefined later in the cascade (`js/app-warehouse.js:91-95`):

```css:css/yalla-scan.css:536-545
.seg-row { display: flex; gap: 6px; flex-wrap: wrap; }
.seg {
  border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground);
  border-radius: var(--radius-full); padding: 8px 15px; font-size: var(--fs-sm); font-weight: 600;
  min-height: 38px;   /* thumb target: this is used on a phone in the stockroom */
  transition: background var(--d-1) var(--e-std), color var(--d-1) var(--e-std),
              border-color var(--d-1) var(--e-std);
}
.seg:hover { background: var(--accent); color: var(--foreground); }
.seg.on { background: var(--brand); border-color: var(--brand); color: var(--brand-foreground); font-weight: 700; }
```

The stylesheet header warns about this collision (`css/yalla-scan.css:9-14`). Use `.chip-row` for
filters and `.tabs` for tabs; avoid `.seg` for anything new.

## B4. Tables on a narrow screen

The JS adds the class at every width; the CSS acts only under 720px. Threshold: **five or more
headers**, and only tables inside `#view`:

```js:js/app-routing.js:188-211
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
```

```js:js/app-routing.js:245
  try { labelWideTables(host); } catch (e) { console.warn('table labels', e); }
```

```css:css/bulk-gate-responsive.css:468-494
  /* ---- wide tables become cards --------------------------------------
     A nine-column table at 320px is unusable however it scrolls. Below this
     width the primary tables restack: each row becomes a block, and each
     cell carries its own label from the data-l attribute the renderer sets.
     The header row is hidden because every cell now labels itself. */
  .tbl-cards thead { display: none; }
  .tbl-cards, .tbl-cards tbody, .tbl-cards tr, .tbl-cards td { display: block; width: 100%; }
  .tbl-cards tr {
    background: var(--surface-1); border-radius: var(--radius);
    padding: 12px 14px; margin-bottom: 10px;
  }
  .tbl-cards tr + tr td { box-shadow: none; }
  .tbl-cards td {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 5px 0; text-align: start; border: 0;
  }
  .tbl-cards td::before {
    content: attr(data-l); flex: none;
    font-size: var(--fs-micro); font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--dim);
  }
  /* The first cell is the identity of the row — it gets the full width and
     no label, because a product name does not need to be told it is one. */
  .tbl-cards td:first-child { padding-bottom: 9px; }
  .tbl-cards td:first-child::before { content: none; }
  .tbl-cards td.num { justify-content: space-between; }
  .tbl-cards .cell-prod { min-width: 0; }
```

Which tables qualify — counted from `<th` occurrences on the header lines (a grep count, not a
render; a header row split across lines is summed):

| Screen / table | headers | restacks? |
|---|---|---|
| Products main (`app-products.js:126-134`) | 5–10 by permission | yes |
| Product drawer per-size (`app-products.js:226-230`) | 6–8 | **no** — drawer is outside `#view` |
| Customers drawer history (`app-customers-scan.js:141-143`) | 4 | no (and outside `#view`) |
| Scan sheet all-sizes (`app-customers-scan.js:383-387`) | 6 | no — modal, outside `#view` |
| Duplicate guard (`:200-203`), Reorder (`:557-561`) | 5 | no — modals |
| Deliveries board (`deliveries.js:188-192`) | 6 | yes |
| Money expenses (`money.js:186-189`) | 5 | yes |
| Money debts (`money.js:238-242`) | 8 | yes |
| Stock count sheet (`stock.js:305-309`) | 6 | yes |
| Warehouse stock tables (`app-warehouse.js:309-311, 344-346, 379-382, 737-740`) | 7–10 | yes |
| Warehouse movements (`app-warehouse.js:158-161`) | 4 | no |
| Dashboard recent sales (`app-dashboard.js:299-300`) | 6 | yes |
| Print jobs / reports tables (`app-jobs-reports.js:134-136, 410-411, 428-430, 459-461, 474-476, 493-495`) | 5–8 | yes |
| Print Labels picker (`app-print-labels.js:85-89`) | 8 | yes |
| Yalla portal (`yalla.js:798-800, 863-864`; `ylinvoice.js:96-99, 224-227, 284-286, 345-346`) | 5–9 | yes (portal renders into `#view`) |

The Customers screen itself has no table — it is a card grid (`.cust-grid`,
`css/dialogs-customers-jobs.css:85-103`), which collapses by `auto-fill, minmax(272px, 1fr)` and
needs no JS.

## B5. Every search box

None debounce. None call the server. All filter a hydrated array on every `input` event.

**1. Topbar global search** — markup `js/app-shell.js:328-332` (`<input id="globalSearch"
type="text" … autocomplete="off">`), CSS `.search / .search input / .search-results / .sr-group /
.sr-item` at `css/shell.css:161-182`, wired without any `data-change`:

```js:js/app-boot.js:37-42
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'globalSearch') { runSearch(el.value); return; }
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && el.tagName !== 'SELECT' && el.type !== 'checkbox') CHANGES[k](el);
  });
```

```js:js/app-shell.js:463-486
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
```

Results are `.sr-item` rows carrying `data-act="search-cust"` etc. (`:496-503`); the dropdown is
closed by the global click handler (`js/app-boot.js:28-30`). It does not filter archived customers
(§C3). Plain `toLowerCase()` — no Arabic normalisation (the first recon's §29 still holds).

**2. Customers screen** — `js/app-customers-scan.js:42` (`class="inp grow" data-change="cust-q"`),
handler `js/app-changes.js:21` (full `render()` per keystroke, quoted in §A5), filter in
`customerRows()`:

```js:js/app-customers-scan.js:13-25
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
```

Caret is put back with `focusBack()` after the re-render (`js/app-changes.js:222-227`), which is
the tell that the whole view is rebuilt under the finger.

**3. Products** — `js/app-products.js:93` (`data-change="prod-q"`), `js/app-changes.js:18`, filter
`js/app-products.js:47-52` (name/brand). Same shape.

**4. Print Labels** — `js/app-print-labels.js:61` (`data-change="lbf-q"`), `js/app-changes.js:26`.

**5. Stock count** — `js/stock.js:299-300` (`data-change="st-q"`), `js/app-changes.js:204-208`,
filter `js/stock.js:90-98` (sku / barcode / name).

**6. POS customer picker** — `<input class="inp" id="posCust" … data-pos-input="cust">`
(`js/pos.js:439-443`), repainted per keystroke by `custDrop()` (`js/pos.js:1637-1648`); CSS
`.cust-box .cust-caret .cust-drop .cust-row .cust-hint .cust-add .cust-picked` at
`css/inputs-dashboard-pos.css:320-369`. This is the one search with a real matching rule:

```js:js/pos.js:1485-1514
  function custMatches(q) {
    q = String(q || '').trim().toLowerCase();
    /* Archived people are off the books; the till must not offer them. The
       server sends them to anyone with customer.write — which a cashier has,
       because she adds customers here — so filtering has to happen here. */
    var list = DB.customers.filter(function (c) { return !c.archived; });
    list.sort(function (a, b) {
      /* Newest buyer first. Ties break on newest id so somebody added a
         minute ago and not yet sold to sits at the top of the list rather
         than the very bottom of it. */
      return lastBuy(b) - lastBuy(a) || (b.id - a.id);
    });
    if (!q) return list;
    /* Two digits is enough to narrow once the list is already on screen; the
       old three-digit floor existed only because nothing showed before it.

       Only a query with no letters in it is read as a phone number. Without
       that test "Bulk Tester 59" also drags in everyone whose number happens
       to contain 59, and the cashier is handed a list of strangers under the
       name she typed. Arabic letters count as letters. */
    var digits = q.replace(/\D/g, '');
    var byPhone = digits.length >= 2 && !/[a-z؀-ۿ]/.test(q);
    return list.filter(function (c) {
      if (byPhone) {
        return String(c.phone || '').replace(/\D/g, '').indexOf(digits) > -1;
      }
      return String(c.name || '').toLowerCase().indexOf(q) > -1 ||
             String(c.city || '').toLowerCase().indexOf(q) > -1;
    });
  }
```

It caps what it *draws* at 40 and says so (`CUST_MAX`, `js/pos.js:1474`, `:1553-1558`), which is the
only search in the app that acknowledges a long list.

**7. POS product search** — `#posScan` (`js/pos.js:1639-1644`); an all-digit string of 8+ is left
for the scanner path rather than filtering.

**8. Attach-code search** — inside the unknown-code modal, `data-change="attach-search"`
(`js/app-customers-scan.js:295`, handler `js/app-changes.js:13-17`, filter `:273-288`).

**9. Command palette** — `#cpInput` (`js/palette.js:141-152`), scored not filtered; walks
`DB.customers` on every keystroke from two characters:

```js:js/palette.js:96-103
      DB.customers.forEach(function (c) {
        var sc = Math.max(score(c.name, q), score(c.phone.replace(/\s/g, ''), q));
        if (sc > 0) out.push({
          kind: 'customer', score: sc - 4, icon: '☺',
          title: c.name, sub: c.city + ' · ' + nf(c.loyaltyPoints) + ' ' + t('points'),
          run: function () { go('customers', function () { openCustomerDrawer(c.id); }); }
        });
      });
```

**10. Camera scanner manual box** — `#scManual` (`js/scan.js:196-200`).

**Debounce:** `grep -rn -i "debounce\|throttle" js` (excluding the vendored chart) hits only
`js/stock.js:60` — the count-sheet *save* (`saveSheet`, 1200 ms) — and the roles grid save uses a
350 ms timer (`js/app-changes.js:180-181`). No search is debounced.

**Server search:** `GET /api/scan/:code` exists (`server/index.js:358-365`, `Cat.byBarcode` matches
barcode/sku/label_code) but **nothing in `js/` calls it**. No route searches customers.

## B6. Empty states — no shared pattern

Every "nothing here" I found, verbatim:

```js:js/pos.js:415        (cart)
      return '<div class="cart-empty"><b>' + t('empty_cart') + '</b>' + t('empty_cart_sub') + '</div>';
```
```js:js/pos.js:396        (product grid, no match)
      return '<div class="cart-empty" style="grid-column:1/-1"><b>' + t('no_results') + '</b>' +
```
```js:js/deliveries.js:154-155   (driver, no runs)
      h += '<div class="card"><div class="cart-empty"><b>' + t('dl_none') + '</b>' +
           t('dl_none_sub') + '</div></div>';
```
```js:js/deliveries.js:184-185   (board)
      return h + '<div class="card"><div class="cart-empty"><b>' + t('dl_none_board') + '</b>' +
             t('dl_none_board_sub') + '</div></div>';
```
```js:js/money.js:233-236        (no debts)
    if (!debts.length) {
      return h + '<div class="card"><div class="cart-empty"><b>' + t('mn_no_debt') + '</b>' +
             t('mn_no_debt_sub') + '</div></div>';
    }
```
```js:js/ylinvoice.js:267
        h += '<div class="cart-empty"><b>' + t('yi_empty') + '</b>' + t('yi_empty_sub') + '</div>';
```
```js:js/app-shell.js:511       (global search)
  if (!h) h = '<div class="sr-item muted">' + t('no_results') + '</div>';
```
```js:js/pos.js:1535            (POS customer picker)
    if (!hits.length) h += '<div class="cust-hint">' + t('no_results') + '</div>';
```
```js:js/palette.js:171
      list.innerHTML = '<div class="cp-empty">' + t('no_results') + '</div>';
```
```js:js/notify.js:95
      return h + '<div class="nt-empty"><b>' + t('nt_empty') + '</b><span>' + t('nt_empty_sub') + '</span></div></div>';
```
```js:js/yalla.js:667
      if (!col.length && !recent.length) h += '<div class="yl-col-empty">' + t('yl_col_empty') + '</div>';
```
```js:js/shelfmap.js:1306
      return '<div class="sm-emptyrow muted">' + t('sm_shelf_empty') + '</div>';
```
```js:js/app-customers-scan.js:135   (drawer, no sizes)
    body += '<span class="muted">' + t('none') + '</span>';
```
```js:js/app-customers-scan.js:432-433  (scan sheet, no movements)
  if (!moves.length) {
    h += '<div class="card-body"><span class="muted small">' + t('sc_no_moves') + '</span></div>';
```
```js:js/app-settings.js:285,597
    return h + '<div class="card-body muted small">' + t('presence_empty') + '</div>' + setFoldEnd();
    h += '<p class="small muted">' + t('lbl_queue_empty') + '</p>';
```

The nearest thing to a convention is **`.card > .cart-empty`** with a bold title and a sub-line:

```css:css/inputs-dashboard-pos.css:306-307
.cart-empty { padding: 44px 20px; text-align: center; color: var(--dim); font-size: 13px; font-weight: 500; }
.cart-empty b { display: block; font-family: var(--font-head); font-size: 16px; color: var(--muted-foreground); margin-bottom: 6px; font-weight: 700; }
```

with `.nt-empty` (`css/yalla-scan.css:443-445`), `.cp-empty` (`:734`) and `.yl-col-empty` (`:280`)
as one-off copies. **The Customers screen has no empty state at all**: `viewCustomers()` draws the
head, the filters, the badge `0 / N` and an empty `.cust-grid` (`js/app-customers-scan.js:51-79`;
there is no `if (!list.length)` branch). A search that matches nobody shows nothing.

## B7. Badges, chips and pills

The one badge class and its tones:

```css:css/motion-cards.css:226-246
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; line-height: 1.5; letter-spacing: .01em;
  padding: 2px 10px; border: 1px solid transparent; border-radius: var(--radius-full); white-space: nowrap;
}
.badge.healthy  { color: var(--success); border-color: var(--success-border); background: var(--success-soft); }
.badge.low      { color: var(--warning); border-color: var(--warning-border); background: var(--warning-soft); }
.badge.critical { color: var(--destructive); border-color: var(--destructive-border); background: var(--destructive-soft); }
.badge.out      { color: #FFFFFF; border-color: var(--destructive-solid); background: var(--destructive-solid); font-weight: 700; }
.badge.neutral  { color: var(--muted-foreground); border-color: var(--border); background: var(--muted); }
.badge.accent   { color: var(--brand); border-color: var(--brand-border); background: var(--brand-soft); font-weight: 700; }
.badge.gold     { color: #FCD34D; border-color: #6B4E11; background: #241C08; }
.badge.silver   { color: #D4D4D8; border-color: #3F3F46; background: #1E1E22; }
.badge.bronze   { color: #E8A87C; border-color: #6B3E22; background: #241610; }
.badge.urgent   { color: #FFFFFF; border-color: var(--destructive-solid); background: var(--destructive-solid); font-weight: 700; }

.dot { width: 7px; height: 7px; border-radius: var(--radius-full); display: inline-block; flex: none; }
.dot.healthy { background: var(--success); } .dot.low { background: var(--warning); }
.dot.critical { background: var(--destructive); }
.dot.out { background: #FFFFFF; }
.dot.offline { background: var(--dim); }
```

plus `.badge.tbc` (`css/yalla-scan.css:308`) and the shrunken variant inside the POS picker
(`.cust-row .badge`, `css/inputs-dashboard-pos.css:354`).

One example of each in use:

- **Tier**: `'<span class="badge ' + tier + '">' + t(tier) + '</span>'`
  (`js/app-customers-scan.js:63`; `tier` is `gold|silver|bronze` from `DB.tier`, `js/data.js:1406-1410`).
- **Stock health**: `healthBadge(qty)` → `'<span class="badge ' + h + '"><i class="dot ' + h + '"></i>' + t(h) + '</span>'` (`js/app-util.js:172-175`).
- **Status** (delivery): `statusBadge(s)` mapping `waiting→neutral, out→accent, delivered→healthy, failed→critical` (`js/deliveries.js:67-77`).
- **Count / meta**: `'<span class="badge neutral">' + list.length + ' / ' + DB.customers.length + '</span>'` (`js/app-customers-scan.js:49`).
- **Warning**: `'<span class="badge critical">' + risk + ' ' + t('at_risk') + '</span>'` (`:34`).
- **Phone as a pill**: `'<span class="badge neutral num">' + tel(c.phone) + '</span>'` (`:111`).

Other pills: `.nav-badge` (`css/shell.css:84-90`, red count on a nav item), `.bell-badge`
(`css/shell.css:205-211`), `.nt-pill` (`css/yalla-scan.css:392-395`: 10px, destructive-soft),
`.tab-dot` (`css/yalla-scan.css:446, 680`), `.partner-chip` (`css/dialogs-customers-jobs.css:145`),
`.keycap` (`css/motion-cards.css:108-113`), `.cc-av` avatar circle (`css/dialogs-customers-jobs.css:94-98`).

## B8. RTL and bidi — names are never isolated

Whole-frontend search (`grep -rn -i -E "<bdi|dir=\"auto\"|dir='auto'|unicode-bidi" js css index.html _shot.html`):

```
js/app-util.js:84:   so isolate them with <bdi dir="ltr">. */
js/app-util.js:85:function tel(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
js/pos.js:1539:         <bdi> wrapper, so filtering the formatted strings would keep a blank
js/shelfmap.js:1031:        h += '<div class="sm-peek-name" dir="auto">' +
js/shelfmap.js:1236:    if (p) inner += '<span class="sm-pname" dir="auto">' + esc(p.name) + '</span>';
```

That is the complete list. `tel()` isolates **phone numbers** only; the shelf map isolates
**product** names in two places. **No customer name anywhere is wrapped** — the card
(`js/app-customers-scan.js:60`), the drawer head (`:108`), the POS picker row (`js/pos.js:1547`),
the picked customer (`:448`), the topbar search result (`js/app-shell.js:501`), the palette
(`js/palette.js:180`), the debts table (`js/money.js:247`), the deliveries board
(`js/deliveries.js:197`) and the A4 invoice (`js/app-documents.js:21`) all emit `esc(c.name)` bare.
`unicode-bidi` appears in no stylesheet. The receipt canvas draws names with the browser's own bidi
(`js/receipt.js:30`, `FONT` stack), so paper is fine; the screens are not. A Latin name such as
"Nike Store 2" in an Arabic layout, or an Arabic name followed by a Latin city, will reorder.

## B9. Routing — every screen is a flat list plus an overlay

The whole router is `location.hash` = view id. There is no `history.pushState`, no parameterised
route, no `popstate` handling (`grep -rn "pushState|replaceState|popstate|history.back" js` finds only
the comment at `js/app-routing.js:277`):

```js:js/app-routing.js:259-282
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
```

```js:js/app-boot.js:59-64
  window.addEventListener('hashchange', function () {
    var raw = window.location.hash;
    if (handleDeepLink(raw)) return;
    var v = raw.replace('#', '');
    if (v && VIEWS[v] && v !== OG.view) go(v);
  });
```

The only parameterised thing is the **deep link** `#open/<type>/<id>`, which is not a route but a
one-shot instruction consumed on `hashchange` / at boot:

```js:js/app-export.js:237-251
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
```

Trace `#open/customer/81`: `go('customers', …)` sets the hash to `#customers` (replacing the deep
link), renders, then the `pending` callback opens the drawer (`js/app-routing.js:256`). The drawer
is never in the history. **Browser Back** from there goes to the previous hash — which *is*
`#open/customer/81` — so `hashchange` fires `handleDeepLink` again and the drawer reopens; Back a
second time reaches whatever came before. Back from an ordinary drawer (opened by clicking a card)
does nothing to the drawer and changes the screen under it. Forward/refresh loses the drawer.

**Verdict:** no screen opens one record by id as a page with a back button; nothing here can host a
customer profile page without adding a second routing layer (a `#customers/<id>` form parsed in
`boot()` and the `hashchange` handler, and a `VIEWS` entry that reads it). The pieces that would
have to change are `boot()` (`js/app-boot.js:234-246`), the `hashchange` handler, `go()` and
`navAllowed()` (`js/app-shell.js:99-110`), all of which currently assume the hash **is** a view id.

---

# Part C — Behaviour the code settles

## C1. Can loyalty points be spent at the till? **Yes** — 500 at a time, and only if they hold 500.

The UI offers one fixed block:

```js:js/pos.js:445-460
    var tier = DB.tier(c.loyaltyPoints);
    var canRedeem = c.loyaltyPoints >= 500 && !S.pointsUsed;
    var h = '<span class="lbl">' + t('customer') + '</span>' +
      '<div class="cust-picked"><div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
        '<small class="num">' + tel(c.phone) + ' · ' + esc(c.city) + '</small></div>' +
        '<span class="badge ' + tier + '">' + nf(c.loyaltyPoints) + ' ' + t('points') + '</span>' +
        '<button class="btn btn-sm btn-ghost" data-pos="cust-clear">' + t('change_customer') + '</button></div>';
    if (canRedeem) {
      h += '<button class="btn btn-sm btn-block mt" data-pos="redeem">' +
        t('use_points') + ' 500 ' + t('points') + ' = ' + money(500 * CONFIG.LOYALTY_POINT_VALUE) + '</button>';
    }
    if (S.pointsUsed) {
      h += '<div class="mt"><span class="badge accent">− ' + money(S.pointsUsed * CONFIG.LOYALTY_POINT_VALUE) +
        ' (' + S.pointsUsed + ' ' + t('points') + ')</span> ' +
        '<button class="btn btn-sm btn-ghost" data-pos="unredeem">' + t('remove') + '</button></div>';
    }
```

```js:js/pos.js:1368-1374
    redeem: function () {
      var c = DB.customer(S.customerId);
      S.pointsUsed = Math.min(500, c.loyaltyPoints);
      toast(t('loyalty'), '− ' + money(S.pointsUsed * CONFIG.LOYALTY_POINT_VALUE), 'ok');
      paintFoot();
    },
    unredeem: function () { S.pointsUsed = 0; paintFoot(); },
```

It is sent as a count (`js/pos.js:965` `pointsUsed: S.pointsUsed`), and the server values, checks and
deducts it inside the sale transaction and writes the column:

```js:server/lib/sales.js:212-232
    const wantPoints = Math.max(0, Math.round(Number(pointsUsed) || 0));
    let pointsValue = 0;

    if (wantPoints > 0) {
      if (!cust) throw new Error('points can only be redeemed against a customer');

      if (wantPoints > cust.loyalty_points) {
        const e = new Error(
          `${cust.name} has ${cust.loyalty_points} points, not ${wantPoints}.`);
        e.code = 'not_enough_points';
        e.available = cust.loyalty_points;
        throw e;
      }

      const pointValue = Number(d.prepare(
        "SELECT value FROM config WHERE key = 'loyalty.point_value'"
      ).get()?.value ?? 0);

      pointsValue = Math.round(
        wantPoints * pointValue * Math.pow(10, minorExp(settle)));
    }
```

```js:server/lib/sales.js:303-312
    d.prepare(
      `INSERT INTO sales
         (id, at, customer_id, customer_name, cashier_id, wh_id, payment,
          currency, subtotal, discount, total, fx_rate, fx_base, created_at,
          public_token, points_used, points_earned, txn_ref, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(saleId, at, cust ? cust.id : null, cust ? cust.name : null,
          userId ?? null, whId, payment || 'cash',
          settle, subtotal, disc, total, rate, base, at, token, wantPoints,
          earnedForRow, ref, openShift ? openShift.id : null);
```

```js:server/lib/sales.js:331-341
    if (cust) {
      /* Spend and earn in one statement, in the same transaction as the
         invoice that caused both. Two updates could interleave with another
         till serving the same customer and lose one of them. */
      d.prepare(
        `UPDATE customers
            SET loyalty_points = loyalty_points - ? + ?, updated_at = ?
          WHERE id = ?`
      ).run(wantPoints, earned, at, cust.id);
      logChange('customers', cust.id, 'update', userId, null);
    }
```

The redeemed value rides **on top of** the discount cap (`server/lib/sales.js:258-271`). Live data:
`SUM(points_used > 0) = 0` across all 10 sales — the path has never been used.

The "500" is a magic number in `pos.js` in two places; the point value and the earn rate are config
(`loyalty.point_value = 0.5`, `loyalty.points_per_1000 = 100`), the block size is not.

## C2. Does voiding reverse the points? **No.**

```js:server/lib/sales.js:419-458
/* Void a sale and put the stock back.

   A void is not a delete. The row stays, flagged, and returning the stock
   writes its own movements — so the trail shows a sale happened and was
   reversed, which is exactly what an auditor, or you, needs to see. */
export function voidSale(id, { reason, userId }) {
  return tx((d) => {
    const s = d.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new Error('no such sale');
    if (s.voided) throw new Error('that sale is already voided');

    /* A credit sale the customer has already part-paid cannot simply be
       undone. The cash is in the box; voiding would erase the debt it was
       paid against and leave the money unexplained in every report. Refund
       the payments first, then void. */
    const paid = d.prepare(
      'SELECT COUNT(*) AS n FROM debt_payments WHERE sale_id = ?'
    ).get(id).n;
    if (paid) {
      throw Object.assign(
        new Error('that sale has been part-paid — refund the payments before voiding it'),
        { code: 'has_payments' });
    }

    const items = d.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    for (const it of items) {
      Stock.apply(d, {
        sku: it.sku, whId: s.wh_id, delta: it.qty, type: 'returned',
        note: `voided ${id}${reason ? ': ' + reason : ''}`,
        userId, refType: 'void', refId: id
      });
    }

    d.prepare('UPDATE sales SET voided = 1, void_reason = ? WHERE id = ?')
     .run(reason ?? null, id);
    logChange('sales', id, 'update', userId, null);

    return { id, voided: true, returned: items.length };
  });
}
```

What happens to the points, exactly: **nothing.** `points_earned` and `points_used` stay on the
voided row; `customers.loyalty_points` is not touched; no `change_log` row is written for the
customer. The earned points stay spendable and the spent points stay spent. The derived
`total_spent` / `visits` / `last_purchase_at` do drop the sale (`WHERE voided = 0`,
`server/lib/customers.js:39`), so a voided sale disappears from the list's lifetime spend while its
points remain — the two figures disagree from the first void.

Also: **there is no UI to void.** `grep -rn "/void|voidSale|'void'" js` finds only the label in the
roles grid (`js/app-settings.js:102`). `POST /api/sales/:id/void` (`server/index.js:718-727`) is
reachable only by hand.

## C3. Archived customers in search

**POS picker: yes, excluded** — `js/pos.js:1490` (quoted in §B5):
`var list = DB.customers.filter(function (c) { return !c.archived; });`.

**Topbar search: no** — `js/app-shell.js:477-479` (quoted in §B5) filters `DB.customers` on name and
phone only. **Palette: no** — `js/palette.js:96-103`. Both will offer an archived customer to anyone
whose `DB.customers` contains archived rows, which the server sends to holders of `customer.write`
(`server/index.js:588-594`) — cashier included (§C4). Clicking such a result opens the drawer on the
Customers screen, where the default `all` filter hides that same customer from the grid
(`customerRows`, `js/app-customers-scan.js:15`).

## C4. Can the cashier reach the Customers screen? **Yes.**

```js:js/app-shell.js:79-95
var NAV_PERM = {
  pos:        'sell',
  products:   'product.read',
  warehouse:  'stock.read',
  ...
  customers:  'customer.read',
  ...
};
```

The live `role_permissions` table for `cashier` (query, not the seed):

```
customer.read   1
customer.write  1
sell 1  refund 1  sale.reprint 1  print.read 1  product.read 1  stock.read 1  delivery.write 1
everything else 0  (void 0, money.* 0, cost.read 0, profit.read 0, report.read 0, config.write 0, …)
```

So the cashier holds both customer permissions, reaches `#customers` from the More sheet (it is in
`MORE_ITEMS`, `js/app-shell.js:236`, not one of the four tabs), sees the whole list **including
archived rows**, can add, archive and bulk-adjust points (+250, `js/bulk.js:309-317`), and receives
`note` and `address` for everyone (§C9). "After Phase 1" changes nothing: the table has not been
touched since the first recon's §27 (`updated_at` values are all the migration epoch —
`UNVERIFIED` for the exact timestamps, I did not select them).

## C5. Attach a customer to a sale after the fact — **NOT FOUND.**

`customer_id` is written once, in the INSERT (`server/lib/sales.js:303-312`, §C1). The only `UPDATE
sales` in the server is the void flag (`server/lib/sales.js:452`). There is no `PATCH /api/sales`,
no route touching `customer_id`, and nothing in `js/` posts one (`grep -rn "api/customers|/history|
/api/scan" js` → only `shop.js:67,336-339`). The receipt's `customer_name` is denormalised at sale
time (`sales.customer_name TEXT -- denormalised: a receipt is a record of that moment`,
`server/migrations/001_init.sql:202-203`) and would also need rewriting.

## C6. Credit limit / blocked flag — **does not exist.**

`PRAGMA table_info(customers)`: `id, name, phone, note, loyalty_points, created_at, updated_at,
address, city, source, archived, demo`. Nothing else. `config` keys containing `credit`, `block`,
`debt` or `customer`: **none**. The full key list is the 58 keys under `expense.`, `label.`,
`loyalty.`, `receipt.`, `sale.max_discount_pct`, `shop.`, `stock.`.

Credit is simply a payment method with no gate on it:

```js:js/data.js:351-357
/* `credit` is الدين — sold now, paid later. It is a payment METHOD because
   ...
var PAYMENT_METHODS = ['cash', 'sham', 'fuad', 'haram', 'card', 'cod', 'credit'];
var PAYMENT_LABELS = {
  ...
  cod: 'Cash on delivery', credit: 'On credit'
```

`Sales.record` accepts `payment || 'cash'` verbatim (`server/lib/sales.js:310`) and does not require
a customer for `credit` — a walk-in sale on credit is a legal row with nobody to collect from. The
only ceilings in the sale path are the discount cap and the points-vs-total check
(`server/lib/sales.js:239-271`). `archived` is the only per-customer refusal the server makes
(`:159-163`).

## C7. Where a delivery's address comes from — typed per delivery; the customer row is a prefill.

At the till the field is pre-filled from `cust.address` and remains editable, and the payload is
whatever is in the box:

```js:js/pos.js:561-577
    if (on) {
      /* Pre-filled from the customer when we have one, because the commonest
         delivery is to somebody the shop already knows. Still editable — the
         address on the delivery is the one he was actually sent to. */
      var cust = S.customerId ? DB.customer(S.customerId) : null;
      var addr = S.deliverAddress !== null && S.deliverAddress !== undefined
        ? S.deliverAddress
        : ((cust && cust.address) || '');

      h += '<label class="field"><span>' + t('dl_address') + '</span>' +
        '<input class="inp" id="posAddr" type="text" data-pos-input="addr" ' +
          'placeholder="' + esc(t('dl_address_ph')) + '" value="' + esc(addr) + '"></label>';

      if (cust && cust.phone) {
        h += '<div class="partner-note">' + t('dl_phone') + ': ' + tel(cust.phone) + '</div>';
      }
    }
```

```js:js/pos.js:1036-1052
  function deliveryPayload(sale) {
    var cust = S.customerId ? DB.customer(S.customerId) : null;
    var addr = (S.deliverAddress !== null && S.deliverAddress !== undefined)
      ? S.deliverAddress
      : ((cust && cust.address) || '');

    return {
      saleId: sale.id,
      address: String(addr).trim(),
      phone: cust ? cust.phone : null,
      /* No driver named here. The cashier does not know who is free — the
         manager assigns from the board, and an unassigned row is visible
         there. A guess would be worse than an empty field. */
      driverId: null,
      opId: 'dl-' + sale.id
    };
  }
```

The server copies it onto the delivery row and writes it back to the customer **only if the
customer has none** — write-once, never overwritten:

```js:server/lib/deliveries.js:172-188
    /* Remember it on the customer as the address to offer next time, but only
       when they have none — never overwrite one someone typed deliberately. */
    if (sale.customer_id) {
      const touched = d.prepare(
        `UPDATE customers SET address = ?, updated_at = ?
          WHERE id = ? AND (address IS NULL OR address = '')`
      ).run(String(address).trim(), at, sale.customer_id);

      /* customers is cursor-shape in the mirror, so a write nobody logs never
         leaves this machine. The WHERE is conditional — most of the time the
         customer already has an address and nothing changes — so log only when
         a row actually moved, rather than queueing a no-op push per delivery. */
      if (touched.changes > 0) {
        logChange('customers', String(sale.customer_id), 'update', byUserId, null);
      }
    }
```

**Is `customers.address` written anywhere else?** `Customers.create` / `update` accept it
(`FIELDS`, `server/lib/customers.js:69`) but no screen sends it — the only form has name, phone,
city (`js/app-warehouse.js:224-232`) and there is no edit form. `Deliveries.update` can change the
*delivery's* address (`server/lib/deliveries.js:233-236`) but never writes back. So: written by the
first delivery to a customer, then frozen. Live: `0 of 1` customers have an address; `0 of 4`
deliveries belong to a sale with a customer.

## C8. How print jobs identify their customer — a free-text name and phone; `sale_id` optional and never set.

```sql:server/migrations/015_partner.sql:74-105
CREATE TABLE IF NOT EXISTS print_jobs (
  id         TEXT PRIMARY KEY,
  customer   TEXT    NOT NULL,
  phone      TEXT,
  design     TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'bulk'   CHECK (kind IN ('bulk','kit')),
  priority   TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  stage      TEXT    NOT NULL DEFAULT 'design'
             CHECK (stage IN ('design','sent','printing','delivery','done')),
  qty        INTEGER NOT NULL DEFAULT 0,   -- bulk only; a kit's comes from its lines
  currency   TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  price      INTEGER NOT NULL DEFAULT 0,   -- what the customer pays
  cost       INTEGER,                      -- what Yalla Wear charges; null = not agreed
  deadline   TEXT,
  sale_id    TEXT    REFERENCES sales(id), -- set when the till raised it
  ...
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id)
);
```

No `customer_id`. Where the customer is **set**:

```js:js/pos.js:1180-1190     (the till, after a sale with "print" ticked)
      job = DB.newPrintJob({
        customer: cust ? cust.name : t('walk_in'),
        phone: cust ? cust.phone : '—',
        design: 'Custom print · ' + sale.id,
        lines: klines,
        qty: klines.length,
        priority: S.print.priority,
        deadline: new Date(pdate + 'T12:00:00'),
        price: klines.length * PRINT_UNIT_PRICE,
        cost: klines.length * PRINT_UNIT_COST
      });
```

```js:js/data.js:2037-2049     (what actually reaches the server)
    pushPartner(function () {
      return Shop.newPrintJob({
        customer: job.customer, phone: job.phone, design: job.design,
        kind: job.kind, qty: job.qty, priority: job.priority,
        deadline: job.deadline ? new Date(job.deadline).toISOString() : null,
        price: job.price, cost: job.cost,
        lines: (job.lines || []).map(function (l) {
          return {
            clubCode: clubCodeFor(l.club), printName: l.print,
            number: l.number, size: l.size, qty: l.qty, unitCost: l.price
          };
        })
      });
    }, typeof t === 'function' ? t('print_title') : 'Print jobs');
```

```js:server/lib/partner.js:150-173
export function create({
  customer, phone, design, kind = 'bulk', qty = 0, priority = 'normal',
  deadline, price = 0, cost = null, currency = 'SYP', saleId = null,
  lines = [], userId = null
}) {
  ...
    d.prepare(
      `INSERT INTO print_jobs
         (id, customer, phone, design, kind, priority, stage, qty, currency,
          price, cost, deadline, sale_id, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,'design',?,?,?,?,?,?,?,?,?)`
    ).run(id, customer, phone ?? null, design, kind, priority,
          kind === 'kit' ? 0 : qty, currency, price, cost, deadline ?? null,
          saleId, at, at, userId);
```

The server accepts `saleId`, but the browser **never sends it** — `Shop.newPrintJob` is passed
`customer/phone/design/kind/qty/priority/deadline/price/cost/lines` and nothing else. The only link
back to the sale is the human string `'Custom print · INV-…'` in `design`. Where the customer is
**read**: the kanban card and drawer use `job.customer` (`js/app-jobs-reports.js`, `js/yalla.js`),
the Yalla portal is deliberately fed no name/phone (`js/data.js:1346-1367` comment; the partner
response strips `price` but *does* carry `customer` and `phone` — `server/index.js:1026-1034`
removes only `price`, so **the partner receives the customer's name and phone on every job**; the
first recon's §36 noted the same).

Live data: `print_jobs` has **0 rows**, so `sale_id` is populated 0 of 0 times — and by the code
above it would be NULL for every till-raised job anyway.

## C9. Is `customers.note` gated? **No.**

`note` is in the list `SELECT` (`server/lib/customers.js:28`) for everyone with `customer.read`, and
`scrubCost` strips only:

```js:server/index.js:1437-1445
const COST_KEYS = [
  'cost_price', 'costPrice',
  'unit_cost', 'unitCost',
  ...
  'cost',
  'profit', 'margin'
];
```

The browser keeps it (`note: c.note || ''`, `js/data.js:2285`) and **never displays it** — no
`.note` reference in `js/app-customers-scan.js`, `js/pos.js` or `js/app-shell.js`. The moment a
screen prints it, a cashier, a manager and the delivery driver (who holds `customer.read`, per the
live table) all see it. There is also no way to write one: the form has no note field.

## C10. A debt when its sale is voided — the void is refused.

The guard in `voidSale` (`server/lib/sales.js:430-441`, quoted in §C2) counts `debt_payments` for
the sale and throws `has_payments`. The mirror on the payment side refuses to take money against a
voided sale:

```js:server/lib/money.js:223-231
export function balanceOf(d, saleId) {
  const s = d.prepare('SELECT total, voided FROM sales WHERE id = ?').get(saleId);
  if (!s) throw fail('no such sale', 'not_found');
  if (s.voided) throw fail('that sale was voided', 'voided');
  const paid = d.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments WHERE sale_id = ?'
  ).get(saleId).n;
  return Math.max(0, s.total - paid);
}
```

```js:server/lib/money.js:279-285
/* Called by Sales.void before it voids. A credit sale the customer has
   already part-paid cannot simply be undone: the cash is in the box, and
   voiding would erase the debt it was paid against while leaving the money
   unexplained. */
export function paymentsAgainst(d, saleId) {
  return d.prepare('SELECT COUNT(*) AS n FROM debt_payments WHERE sale_id = ?').get(saleId).n;
}
```

(The comment says `Sales.void` calls this; `voidSale` actually inlines the same query rather than
importing it — harmless, but two copies of the rule.) A credit sale with **no** payments voids
normally and simply stops being a debt, because the debt book is derived (`openDebts`, §A6,
`WHERE s.voided = 0`). There is no "refund a payment" route, so a part-paid credit sale can never be
voided through the API at all. Live: `debt_payments` is empty and no sale has `payment = 'credit'`
(7 cash, 3 cod).

---

# Part D — The scanner, and whether a loyalty card can work

## D1. `js/wedge.js`, in full, and what decides meaning

```js:js/wedge.js:1-193
/* ==========================================================================
   KEYBOARD WEDGE — hardware barcode scanners                      [Wedge]
   --------------------------------------------------------------------------
   A USB-cable scanner, a 2.4GHz dongle scanner and a Bluetooth HID scanner all
   enumerate as a KEYBOARD. They type the code and press Enter. So one listener
   covers every scanner the shop might buy, on any browser, with no drivers, no
   pairing code and no permission prompt.

   Until now a scan only registered when the POS search box happened to be
   focused. A real scanner fires wherever the cursor is — or nowhere.

   TWO WAYS TO RECOGNISE A SCAN
   ----------------------------
   1. PREFIX (exact). Almost every scanner can be programmed to send a
      character before the code. When one is configured, recognition is
      certain — no guessing, no threshold. This is the mode to use once the
      hardware is in hand.

   2. SPEED (works out of the box). A scanner emits characters far faster than
      hands can type. Buffer the keys with timestamps and, on Enter, decide
      from how fast they arrived.

   THE RULE THIS MODULE MUST NEVER BREAK
   -------------------------------------
   It must not eat real typing. Keys are OBSERVED and passed straight through;
   nothing is cancelled until a burst has already been classified as a scan.
   Getting this wrong would make every search box in the app feel broken, and
   it would be blamed on anything but the scanner.
   ========================================================================== */

var Wedge = (function () {

  var CFG = {
    enabled:   true,
    prefix:    '',     /* set this once the scanner is programmed  */
    suffix:    'Enter',
    minLength: 4,      /* shorter than this is a person, not a scan */
    maxGapMs:  35      /* median ms between keys to still count as a scan */
  };

  var S = {
    buf:   [],         /* { ch, t } */
    armed: false,      /* prefix seen, collecting */
    last:  null        /* diagnostics for the Settings page */
  };

  var handlers = [];
  var probes = [];     /* live listeners for the Settings test box */

  function on(fn)    { if (typeof fn === 'function') handlers.push(fn); }
  function probe(fn) { if (typeof fn === 'function') probes.push(fn); }
  function offProbe(fn) { probes = probes.filter(function (p) { return p !== fn; }); }

  function config(patch) {
    if (patch) {
      Object.keys(patch).forEach(function (k) {
        if (k in CFG) CFG[k] = patch[k];
      });
    }
    return JSON.parse(JSON.stringify(CFG));
  }

  /* Median, not mean. One scheduling hiccup — a garbage collection, a repaint —
     can stretch a single gap to 200ms in an otherwise perfect burst. A mean
     lets that one outlier disqualify the whole scan; a median shrugs it off. */
  function medianGap(buf) {
    if (buf.length < 2) return Infinity;
    var gaps = [];
    for (var i = 1; i < buf.length; i++) gaps.push(buf[i].t - buf[i - 1].t);
    gaps.sort(function (a, b) { return a - b; });
    var m = Math.floor(gaps.length / 2);
    return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function reset() { S.buf = []; S.armed = false; }

  /* Decide, report, and hand the code on. */
  function finish(target) {
    var text = S.buf.map(function (b) { return b.ch; }).join('');
    var gap  = medianGap(S.buf);
    var fast = gap <= CFG.maxGapMs;
    var longEnough = text.length >= CFG.minLength;
    /* A configured prefix is proof on its own; without one, speed decides. */
    var isScan = CFG.enabled && longEnough && (S.armed || fast);

    S.last = {
      text: text,
      length: text.length,
      medianGap: gap === Infinity ? null : Math.round(gap),
      viaPrefix: S.armed,
      accepted: isScan,
      at: new Date()
    };
    probes.slice().forEach(function (p) { try { p(S.last); } catch (e) {} });

    reset();
    if (!isScan) return false;

    /* The characters have already landed in whatever box had focus. Clearing
       it is the difference between a clean scan and a barcode wedged into the
       middle of a search term. */
    if (isEditable(target) && typeof target.value === 'string' &&
        target.value.indexOf(text) > -1) {
      target.value = target.value.split(text).join('');
      try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }

    handlers.slice().forEach(function (fn) { try { fn(text, S.last); } catch (e) {} });
    return true;
  }

  function onKeyDown(e) {
    if (!CFG.enabled) return;
    if (e.ctrlKey || e.altKey || e.metaKey) { reset(); return; }

    var now = (e.timeStamp && e.timeStamp > 0) ? e.timeStamp : Date.now();

    /* The programmed prefix opens a capture window. */
    if (CFG.prefix && e.key === CFG.prefix && !S.armed) {
      S.armed = true;
      S.buf = [];
      e.preventDefault();          /* the prefix itself must not reach the page */
      return;
    }

    if (e.key === CFG.suffix) {
      if (!S.buf.length) return;
      /* Only swallow the Enter if this really was a scan — otherwise a person
         pressing Enter in a form would find the form never submits. Once it
         IS a scan, the Enter is the scanner's terminator, not a keypress, and
         no other listener may treat it as one: POS reads Enter-on-an-empty-
         search-box as the demo's random-sale shortcut, and the palette runs
         whatever row is highlighted. Hence stopImmediatePropagation, not just
         preventDefault. */
      if (finish(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }

    /* Single printable characters only. Shift, arrows and the rest reset the
       buffer: a scanner never sends them mid-code. */
    if (e.key && e.key.length === 1) {
      /* A long pause means the previous keys were a person typing something
         else. Start fresh rather than gluing two inputs together. */
      if (S.buf.length && (now - S.buf[S.buf.length - 1].t) > 500) S.buf = [];
      S.buf.push({ ch: e.key, t: now });
      if (S.buf.length > 128) S.buf.shift();
      return;
    }

    if (e.key === 'Tab' || e.key === 'Escape') reset();
  }

  var bound = false;
  function bind() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    /* Capture phase: the code has to be seen before a screen's own key
       handler acts on it. */
    document.addEventListener('keydown', onKeyDown, true);
  }

  /* Replay a burst with no hardware attached, so the behaviour is testable and
     the Settings page can demonstrate itself. Times are simulated, so this
     runs instantly rather than in real time. */
  function feed(text, gapMs, opts) {
    opts = opts || {};
    var t0 = (opts.startAt || 0);
    reset();
    if (CFG.prefix && opts.withPrefix) { S.armed = true; }
    for (var i = 0; i < text.length; i++) {
      S.buf.push({ ch: text.charAt(i), t: t0 + i * gapMs });
    }
    return finish(opts.target || null);
  }

  bind();

  return {
    onScan: on,
    probe: probe,
    offProbe: offProbe,
    config: config,
    feed: feed,
    last: function () { return S.last; },
    _reset: reset
  };
})();
```

The wedge decides *whether* it was a scan (≥4 printable characters, median gap ≤35 ms or a configured
prefix, terminated by Enter). It attaches no meaning. Meaning is decided by the single handler
registered at boot and by `resolveScan`:

```js:js/app-boot.js:131-155
function handleScan(code) {
  /* Only an EXACT product code goes into the cart — the same three matchers
     labels.js trusts, and pointedly not resolveScan's cropped-label prefix
     guess: ... */
  if (OG.view === 'pos' && !(OG.print && OG.print.partner) && typeof POS !== 'undefined') {
    var c = String(code || '').trim();
    var v = DB.variantByBarcode(c) || DB.variantBySku(c) ||
            (DB.variantByLabelCode && DB.variantByLabelCode(c));
    if (v) {
      closeModal();
      POS.add(v);
      return;
    }
  }
  closeModal();
  openScanResult(code);
}
```

```js:js/app-customers-scan.js:232-266
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
```

## D2. How a scanned string is routed today

In order, from `bindWedge` (`js/app-boot.js:157-210`):

1. Settings' scanner test box owns the scan while focused (`:174`).
2. An open command palette is closed (`:179`).
3. If the label-batch picker is open, `labels.js` handles it; a code that is not an exact product
   code just gets a toast `lbl_unknown_code` (`:186-191`).
4. If the shelf map is on screen with data loaded and no modal open, `ShelfMap.onScan` owns it
   (`js/shelfmap.js:262-264`, `:1493-1512`): first `/^SH(\d{2})([A-Z])([A-Z]\d{1,3})$/`, then
   barcode/sku/label code, else "unknown code" chip + toast (`:1516-1519`).
5. Same code within 700 ms is dropped (`:199-201`).
6. If the scan sheet is already open for that code, the second scan clicks its Sell button (`:205-206`).
7. `handleScan`: at the POS, an **exact** barcode / SKU / label code goes straight into the cart;
   anything else, on any screen, goes to `openScanResult`.

`openScanResult` (`js/app-customers-scan.js:304-313`): `route` → `handleDeepLink(hash)`; `invoice` →
`openInvoice`; `job` → `openJobDrawer`; `variant` → the product sheet; **nothing matched** →
`openUnknownCodeModal(code)` (`:290-300`), which is neither silence nor a dead end — it offers to
attach the code to a product (`attachResultsHTML`, `:273-288`, `POST /api/variants/:sku` via
`variant-attach-save`, `js/app-actions.js:451`).

So: **not** always a product, but the only non-product meanings are invoice, job, shelf and deep
link, and the fall-through for an unknown string is a modal that assumes it is a product barcode
you forgot to record. A customer card scanned today lands in that modal.

One consequence worth stating: a card carrying the existing deep link `#open/customer/81` **already
works** — `resolveScan` returns `route` and `handleDeepLink` opens the drawer — but at the till it
**navigates away from the POS** (`go('customers', …)`, `js/app-export.js:246-248`) instead of
attaching the customer to the basket. The wedge passes `#` and `/` fine (single printable keys).

## D3. The internal code formats, and a safe prefix

Every code the app mints or parses:

| Thing | Format | Minted | Parsed |
|---|---|---|---|
| SKU | `OG-` + 3-digit product id + `-` + size, e.g. `OG-036-42` | `server/lib/catalogue.js:334, 418` | exact: `DB.variantBySku`; **prefix**: `resolveScan` partial match (`js/app-customers-scan.js:259-263`) |
| Product barcode (EAN-13) | `621` + (product id mod 1000, 3 digits) + 6 random digits + check digit | `server/lib/catalogue.js:133-143` | `DB.variantByBarcode`; camera EAN decoder `js/scan.js:62-154` |
| Label code | numeric, 6–8 digits, starting at `100000`, `label_code_seq` | `server/lib/catalogue.js:156-179`; `010_labels.sql:20-44` | `DB.variantByLabelCode`; attach route accepts `/^\d{1,8}$/` (`catalogue.js:262`) |
| Shelf | `SH` + 2-digit warehouse + room letter + row letter + column, e.g. `SH01MA3` | `js/labels60.js:90-95` | `js/shelfmap.js:123` `SHELF_SCAN_RE` |
| Invoice | `INV-` + number | `server/lib/sales.js:79-87` | `DB.sale(code)` |
| Print job | `P-` + number | `server/lib/partner.js:140-146` | `DB.job(code)` |
| Deep link | `…#open/<type>/<id>` | `deepLink()`, `js/app-export.js:229-235` | `resolveScan` regex; `handleDeepLink` |

```js:server/lib/catalogue.js:133-143
export function nextBarcode(d, productId) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const serial = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const body = '621' + String(productId % 1000).padStart(3, '0') + serial;
    const code = body + ean13Check(body);

    const clash = d.prepare('SELECT 1 FROM variants WHERE barcode = ?').get(code);
    if (!clash) return code;
  }
  throw new Error('could not find a free barcode after 50 tries');
}
```

```js:server/lib/catalogue.js:334
      const sku = `OG-${String(productId).padStart(3, '0')}-${size}`;
```

```js:js/labels60.js:90-95
  function shelfPayload(whCode, sectionKey, code) {
    if (whCode == null || whCode === '') return null;
    var n = Number(whCode);
    if (!isFinite(n) || n < 1 || n > 99) return null;
    return 'SH' + (n < 10 ? '0' + n : String(n)) + sectionKey + code;
  }
```

```js:js/shelfmap.js:123
  var SHELF_SCAN_RE = /^SH(\d{2})([A-Z])([A-Z]\d{1,3})$/;
```

The server-side scan lookup checks the same three product fields and nothing else:

```js:server/lib/catalogue.js:238-246
export function byBarcode(code) {
  const v = get().prepare(
    `SELECT v.*, p.name, p.type, p.brand, p.colorway, p.currency,
            p.cost_price, p.selling_price, p.image_bg, p.image_initials
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.barcode = ? OR v.sku = ? OR v.label_code = ?`
  ).get(code, code, code);
  return v ?? null;
}
```

**What a customer card code must avoid, from the parsers above:**

- **Not all digits.** 6–8 digits is a label code; 13 digits is an EAN; the attach route accepts any
  1–8 digits as a label code; the POS product search treats `/^\d{8,}$/` as "a scanner is typing"
  (`js/pos.js:1642`).
- **Not starting with `OG-`** — or, more precisely, not a string that is a *prefix of any SKU*
  case-insensitively: `resolveScan`'s cropped-label fallback would return the first variant whose
  SKU starts with it. `OG-C…` is safe from that because no SKU has `C` after `OG-`, but `OG-0` is
  not. Don't go near it.
- **Not `INV-`, `P-`, `SH` + two digits** (invoice, job, shelf).
- **At least 4 characters** (`Wedge.minLength`), all single printable keys (Code 128 subset B covers
  a `-` and digits; the wedge sees `-` as a key).
- **Not the EAN prefix `621`** if it is numeric at all (see first bullet).

A prefix like **`CU-`** (or `CUS-`, `OGC-`) followed by the customer id — `CU-000081` — matches none
of the seven parsers, cannot be a SKU prefix, and reaches `openUnknownCodeModal` today, which is the
one place a new `kind: 'customer'` branch would go in `resolveScan`. The alternative already handled
by the code is the deep link `#open/customer/81` (QR-friendly, 16+ characters, works with the camera
scanner and the wedge), with the navigation caveat in §D2.

## D4. Label printing — the three pipelines, and what a card would need

There are **three** ways paper comes out, and Arabic survives on only two of them.

**Pipeline 1 — thermal product labels (XP-235B, TSPL, server-built).** The browser asks the server
for a layout, rasterises any Arabic field itself, and posts bytes back:

```js:js/labels.js:271-296
  function doPrint(lines, presetKey, station, barcodeType) {
    if (typeof Auth === 'undefined') {
      toast(t('lbl_title'), t('lbl_demo_only'), 'info', 5000);
      return Promise.resolve(null);
    }
    if (!station) {
      toast(t('lbl_title'), t('lbl_pick_station'), 'err', 4000);
      return Promise.resolve(null);
    }
    barcodeType = barcodeType || lastChoice.barcodeType || 'auto';
    remember(station, presetKey, barcodeType);
    return renderPreview(lines, presetKey, barcodeType).then(function (preview) {
      var arabicBitmaps = buildArabicBitmaps(preview);
      return API.post('/api/labels/print', {
        lines: lines, preset: presetKey, station: station, barcodeType: barcodeType,
        opId: opId(), arabicBitmaps: arabicBitmaps
      });
    }).then(function (res) {
      toast(t('lbl_title'), t('lbl_queued').replace('{n}', res.labelCount).replace('{station}', station), 'ok', 5000);
      if (typeof OG !== 'undefined') OG.labelQueue = undefined;
      return res;
    }).catch(function (err) {
      toast(t('lbl_title'), API.friendly(err), 'err', 6000);
      throw err;
    });
  }
```

The canvas rendering of an Arabic run, 1 px = 1 dot:

```js:js/labels.js:189-241
  /* --------------------------------------------------------- Arabic bitmap
     One offscreen canvas per Arabic field, sized to the exact dot box the
     server's layout reserved, drawn at 1 canvas px = 1 printer dot so no
     scaling step can blur it, then packed with the SAME function the
     receipt feature uses (ESCPOS.packBitmap) — same polarity (ESC/POS,
     1=black); the server inverts it exactly once before embedding. */
  function rasterizeArabic(text, widthDots, heightDots, maxLines) {
    maxLines = maxLines || 2;
    var c = document.createElement('canvas');
    c.width = Math.ceil(widthDots / 8) * 8;   // ESCPOS.packBitmap requires a multiple of 8
    c.height = Math.max(8, heightDots);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    var lineH = Math.floor(c.height / maxLines);
    var fontPx = Math.max(8, Math.floor(lineH * 0.72));
    ctx.font = fontPx + "px 'Montserrat','Segoe UI',Tahoma,sans-serif";

    /* Greedy word wrap by real measured width — ... */
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width > c.width - 4 && cur) {
        lines.push(cur);
        cur = words[i];
        if (lines.length === maxLines) break;
      } else {
        cur = next;
      }
    }
    if (lines.length < maxLines && cur) lines.push(cur);

    var consumed = lines.join(' ').split(/\s+/).length;
    if (lines.length === maxLines && consumed < words.length) {
      var last = lines[maxLines - 1];
      while (ctx.measureText(last + '…').width > c.width - 4 && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last + '…';
    }

    lines.forEach(function (line, i) { ctx.fillText(line, c.width - 2, i * lineH + 2); });

    var bmp = ESCPOS.packBitmap(c);
    return { bytesPerRow: bmp.bytesPerRow, height: bmp.height, dataB64: bytesToB64(bmp.data) };
  }
```

(Note the font stack here is Montserrat/Segoe/Tahoma at weight 400 — **not** the Cairo-700 the
receipt and the 60×40 labels moved to after the "grey ghost" discovery, `js/receipt.js:30-45`. A
customer name rendered through this function would come out light.)

```js:js/labels.js:248-268
  function buildArabicBitmaps(previewData) {
    var out = {};
    previewData.lines.forEach(function (l) {
      var bitmaps = {};
      (l.layout.fields || []).forEach(function (f) {
        if (f.type !== 'bitmap') return;
        var raw = f.kind === 'name' ? l.name
          : f.kind === 'variant' ? String(l.size)
          : (typeof CONFIG !== 'undefined' && CONFIG.SHOP_NAME) || '';
        var maxLines = f.kind === 'name' ? 2 : 1;
        bitmaps[f.kind] = rasterizeArabic(raw, f.wDots, f.hDots, maxLines);
      });
      if (Object.keys(bitmaps).length) out[l.sku] = bitmaps;
    });
    return out;
  }
```

The bit-packer shared with the receipt:

```js:js/escpos.js:52-81
  /* 1 canvas px = 1 printer dot, packed 8 horizontal pixels per byte, MSB
     first — exactly what GS v 0 expects. Width must already be a multiple
     of 8; the receipt is drawn at 576px so this always holds. */
  function packBitmap(canvas, burnLuma) {
    var w = canvas.width, h = canvas.height;
    if (w % 8 !== 0) throw new Error('ESCPOS: canvas width must be a multiple of 8, got ' + w);
    var cut = burnLuma || BURN_LUMA;

    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h).data;
    var bytesPerRow = w / 8;
    var out = new Uint8Array(bytesPerRow * h);

    for (var y = 0; y < h; y++) {
      var rowBase = y * w;
      var outRowBase = y * bytesPerRow;
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byte = 0;
        for (var bit = 0; bit < 8; bit++) {
          var x = bx * 8 + bit;
          var i = (rowBase + x) * 4;
          var luma = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
          if (luma < cut) byte |= (1 << (7 - bit));
        }
        out[outRowBase + bx] = byte;
      }
    }

    return { bytesPerRow: bytesPerRow, height: h, data: out };
  }
```

Server side: a template is a row of `label_templates` with a JSON `slots` list of `logo | header |
name | variant | barcode | price | date` boxes in dots (`server/migrations/011_label_templates.sql:23-37`).
`resolveSlot` turns a slot into a field and marks Arabic text as `bitmap`:

```js:server/lib/labels.js:309-321
  if (slot.kind === 'name') {
    const arabic = isArabic(variant.name);
    const maxLines = slot.lines || 2;
    const lineHeight = TSPL_FONTS['2'].charH + 2;
    if (arabic) {
      return { kind: 'name', type: 'bitmap', arabic: true, xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots };
    }
    const lines = wrapName(variant.name, { font: '2', maxLines, widthDots: slot.wDots });
    return {
      kind: 'name', type: 'text', xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots,
      font: '2', lineHeight, text: lines.join('\n'), overflow: false
    };
  }
```

and `buildLabelBytes` is the whole TSPL emitter:

```js:server/lib/labels.js:456-517
function bitmapCmd(x, y, bmp) {
  const raw = invertToTsplPolarity(Buffer.from(bmp.dataB64, 'base64'));
  return Buffer.concat([ascii(`BITMAP ${x},${y},${bmp.bytesPerRow},${bmp.height},0,`), raw, ascii('\r\n')]);
}
function escText(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* One full TSPL command block for ONE label. ... */
export function buildLabelBytes(layout, tpl, arabicBitmaps = {}) {
  const chunks = [];
  chunks.push(ascii(
    `SIZE ${tpl.widthMm} mm,${tpl.heightMm} mm\r\n` +
    `GAP ${effectiveGapMm(tpl)} mm,0 mm\r\n` +
    `DIRECTION 1\r\n` +
    `DENSITY ${cfgNum('label.density', 8)}\r\n` +
    `SPEED ${cfgNum('label.speed', 4)}\r\n` +
    `CLS\r\n`
  ));

  for (const f of layout.fields) {
    if (f.type === 'image') {
      if (f.kind === 'logo') {
        const asset = loadLogoAsset();
        if (asset) chunks.push(bitmapCmd(f.xDots, f.yDots, asset));
      }
      continue;
    }

    if (f.type === 'bitmap') {
      const bmp = arabicBitmaps[f.kind];
      if (!bmp) {
        throw Object.assign(new Error(`Arabic "${f.kind}" field needs a browser-rendered bitmap but none was supplied`), { code: 'missing_bitmap' });
      }
      chunks.push(bitmapCmd(f.xDots, f.yDots, bmp));
      continue;
    }

    if (f.type === 'text') {
      const lineHeight = f.lineHeight || (TSPL_FONTS[f.font].charH + 2);
      String(f.text).split('\n').forEach((line, i) => {
        chunks.push(ascii(`TEXT ${f.xDots},${f.yDots + i * lineHeight},"${f.font}",0,1,1,"${escText(line)}"\r\n`));
      });
      continue;
    }

    if (f.type === 'barcode') {
      /* 1 = print the human-readable code below the bars when showHri is
         on. Scanners fail sometimes, eyes don't. */
      chunks.push(ascii(
        `BARCODE ${f.xDots},${f.yDots},"${f.symbology === 'ean13' ? 'EAN13' : '128'}",` +
        `${f.hDots},${f.showHri ? 1 : 0},0,${f.narrowDots},${f.narrowDots},"${f.content}"\r\n`
      ));
    }
  }

  chunks.push(ascii('PRINT 1,1\r\n'));
  return Buffer.concat(chunks);
}
```

The queue is built per **SKU** — the one and only subject this path knows:

```js:server/lib/labels.js:544-582
  const flat = [];
  for (const l of lines) {
    const sku = String(l.variantId || l.sku);
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    for (let i = 0; i < qty; i++) flat.push(sku);
  }
  ...
      for (const sku of chunkSkus) {
        const variant = resolveVariant(sku);
        const layout = computeLayout(variant, tpl, { barcodeType });
        bytesChunks.push(buildLabelBytes(layout, tpl, arabicBitmaps[sku]));
      }
  ...
      for (const { sku, qty } of chunkLines) {
        d.prepare(
          `INSERT INTO label_print_log (batch_id, job_id, sku, qty, preset, station, user_id, status, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
        ).run(batchId, info.lastInsertRowid, sku, qty, tpl.key, station, userId ?? null, at);
      }
```

The route: `POST /api/labels/print` (`server/index.js:1225-1254`, needs `label.print`, forwards
`lines/preset/station/arabicBitmaps/barcodeType`, dispatches over TCP when `label.transport = 'tcp'`,
otherwise leaves the job for `agent/print-agent.js` to poll).

**Pipeline 2 — the 60×40 labels (browser-laid-out, OS print dialog).** Built as HTML at real
millimetres, Arabic through the browser's own shaping in Cairo 700, barcode via `Codes.code128SVG`,
`window.print()`, then a record posted afterwards:

```js:js/labels60.js:64-68
  function run(text, cls) {
    var ar = isArabic(text);
    return '<div class="' + cls + (ar ? ' ar' : ' lat') + '" dir="' + (ar ? 'rtl' : 'ltr') + '">' +
           esc(text) + '</div>';
  }
```

```js:js/labels60.js:191-210
  function doPrint() {
    if (!state || !state.items.length) return;
    setRollPageSize({ w: W_MM, h: H_MM });
    window.print();

    /* Recorded AFTER the dialog closes, and recorded as 'printed' rather than
       'done'. ... */
    API.post('/api/labels/record', {
      preset: state.kind === 'shelf' ? SHELF_PRESET : PRODUCT_PRESET,
      station: 'browser',
      items: state.record
    }).catch(function (err) {
      toast(t('l60_not_logged') + ' — ' + API.friendly(err));
    });
  }
```

```js:server/lib/labels.js:617-649
export function record({ preset, station, items = [], userId = null }) {
  ...
    for (const it of items) {
      const kind = it.subjectType === 'shelf' ? 'shelf' : 'variant';
      const qty = Math.max(1, Number(it.qty) || 1);
      const sku = kind === 'variant' ? String(it.subjectId) : null;
      ins.run(batchId, sku, kind, String(it.subjectId), qty,
              String(preset || ''), String(station || 'browser'), userId, at);
      labels += qty;
    }
```

**Pipeline 3 — the receipt** (§E2): canvas at 576 px → `ESCPOS.buildJob` → `POST /api/print` → raw
TCP/USB to the receipt printer.

**What printing a card with an Arabic name would need that is not there:**

1. **A subject other than a SKU.** `enqueue` resolves every line through `resolveVariant(sku)`
   (`server/lib/labels.js:564`); there is no way to hand it a customer. `record()` accepts only
   `subjectType` `variant | shelf`, and the audit table enforces it:
   `subject_type TEXT NOT NULL DEFAULT 'variant' CHECK (subject_type IN ('variant','shelf'))`
   (`server/migrations/024_label_subjects.sql:51-52`). A `'customer'` subject is a table rebuild
   (SQLite cannot alter a CHECK — the migration says so at `:20-21`).
2. **A slot kind for a person's name.** `resolveSlot` knows `logo/header/name/variant/barcode/price/
   date` and throws on anything else (`server/lib/labels.js:357`); `name` means `variant.name`.
   `buildArabicBitmaps` maps `name → l.name`, `variant → l.size`, everything else → shop name
   (`js/labels.js:259-261`). A customer name needs either a new kind or a synthetic "variant" object.
3. **A template row** with the card's boxes (`label_templates.slots` JSON), or a hard-coded 60×40
   HTML layout on pipeline 2 (the closest fit — Arabic is free there, and `Codes.code128SVG`
   already draws a Code 128 of any string, `js/app-boot.js:110`, `js/labels60.js:109-123`).
4. **The barcode content builder** — pipeline 1's `barcodeFor(variant, slot)` chooses EAN-13 or the
   numeric label code (`server/lib/labels.js:160-179`); a card code is neither.
5. **The Arabic weight problem on pipeline 1** — `rasterizeArabic` uses Montserrat/Tahoma at 400
   (`js/labels.js:208`); Cairo 700 is only in `labels60.js` and `receipt.js`.
6. **The 60×40 roll is the only size in the printer** as far as the code knows
   (`server/migrations/011_label_templates.sql:86-91` calls it "unconfirmed"; `labels60.js:4` calls it
   "the roll that is actually loaded"). A card-sized label stock is a physical question (§F3).

## D5. Does anything print *for* a customer? Two documents, no card.

- **Statement** (PDF or Excel) — `customerStatementSpec(cid)` (`js/app-export.js:407-431`) →
  `Export.run(spec)` → for PDF an A4 preview modal with `data-act="print-doc"` →
  `setDocPageSize(); window.print()` (`js/export.js:384-391`, `js/app-actions.js:232`); for Excel a
  generated `.xlsx` download (`js/export.js:368-382`). Launched from the drawer's two buttons
  (`js/app-customers-scan.js:160-163`) and `export-rec` (`js/app-actions.js:255-264`). The points
  column and the KPI recompute points arithmetically (`Math.round(s.total / 1000 *
  CONFIG.LOYALTY_POINTS_PER_1000)`, `:423`) rather than reading `points_earned` — the first recon's
  §38.3 still holds.
- **The receipt** prints the customer's name, points earned and balance when a sale has one
  (`js/app-documents.js:199, 253-258`; `server/lib/printing.js:68-72` sends `name, phone,
  loyalty_points`).

Nothing prints a card, a label, or a QR **about** a customer. `deepLink('customer', id)` is only
used as the QR in the statement's footer (`js/app-export.js:416`, rendered by `buildPdfHtml`
`js/export.js:337`) — so the statement PDF does already carry a scannable `#open/customer/<id>`.

---

# Part E — Telegram, receipts, and what exists

## E1. Telegram — **NOT FOUND.**

`grep -ril telegram` across the tree (excluding `.git`, `dist`, `docs`, `flutter_app`): the receipt
config key and its UI only —

```
assets/telegram-mark.svg                      (the glyph drawn on the receipt)
js/app-actions.js:548                         'receipt.telegram': (document.getElementById('rcTelegram') …
js/app-settings.js:457-458                    the Settings input
js/app-i18n.js:103,657                        rc3_telegram labels
js/data.js:140,2143                           CONFIG.RECEIPT_TELEGRAM default + hydrate
js/receipt.js:101-107,612-622                 draws the icon + short URL on the paper
server/lib/receipt.js:182                     link(rc.telegram, 'Telegram') on the public page
server/migrations/019_receipt_contact.sql     seeds receipt.telegram = https://t.me/… ; comment: bot is future work
sw.js:39                                      precaches the svg
```

No bot token, no `api.telegram.org`, no polling, no webhook route, no `chat_id` column, no `.env`
key (I did not open `server/.env`; `.env.example` has no Telegram key per the first recon §33 and
nothing in this tree mentions one).

## E2. The receipt subsystem — yes, and it logs *printing*, not sending.

`Receipt.autoPrint` fires after a sale when `receipt.auto_print` is on and the account holds
`sale.reprint` (`js/receipt.js:971-986`); `printJob` draws two canvases, packs them, and posts:

```js:js/receipt.js:896-904
  function sendToPrinter(bytesB64, saleId, copies, kind) {
    kind = kind || 'sale';
    var slot = kind + ':' + saleId;
    var opId = pendingOpId[slot] ||
      (pendingOpId[slot] = 'pr-' + kind + '-' + saleId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

    return API.post('/api/print', { saleId: saleId, bytes: bytesB64, copies: copies, opId: opId, kind: kind })
      .then(function (res) { delete pendingOpId[slot]; return res; });
  }
```

The server writes one `print_log` row per attempt, success or failure:

```js:server/lib/printing.js:112-131
  return sendPromise.then(
    () => {
      logAttempt({ saleId, userId, copies, kind, status: 'sent', error: null });
      const result = { ok: true };
      ...
    },
    (err) => {
      logAttempt({ saleId, userId, copies, kind, status: 'failed', error: err.message });
      throw err;
    }
  );
```

```js:server/lib/printing.js:139-151
function logAttempt({ saleId, userId, copies, kind, status, error }) {
  get().prepare(
    `INSERT INTO print_log (sale_id, user_id, copies, kind, status, error, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(saleId, userId ?? null, copies || 1, kind || 'sale', status, error ?? null, nowIso());
}

export function log(saleId, limit = 20) {
  return get().prepare(
    `SELECT id, user_id, copies, kind, status, error, at FROM print_log
      WHERE sale_id = ? ORDER BY at DESC LIMIT ?`
  ).all(saleId, limit);
}
```

`print_log` columns (live): `id, sale_id, user_id, copies, status ('sent'|'failed'), error, at, kind`.
**`Printing.log()` has no route** — `grep -n "Printing\." server/index.js` gives `:739 Printing.data`
and `:757 Printing.send` only. Live: **1 row** (`sent`, `kind NULL`, 2026-08-30) and 12
`applied_ops` of kind `print`. There is **no timestamp on `sales`** for printing, no "sent to
customer" concept anywhere, and the public receipt page (`GET /i/:token`, `server/lib/receipt.js`)
records nothing when opened.

## E3. `wa_messages` — schema exists, nothing writes to it.

```sql:server/migrations/015_partner.sql:191-203
-- --------------------------------------------------------- what was sent out
--  A log of messages handed to WhatsApp. The shop's proof that a customer was
--  told, which is worth having the day somebody says they never were.
CREATE TABLE IF NOT EXISTS wa_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL,
  phone    TEXT    NOT NULL,
  body     TEXT    NOT NULL,
  kind     TEXT,
  ref_type TEXT,
  ref_id   TEXT,
  user_id  INTEGER REFERENCES users(id)
);
```

The only writer is defined and never called:

```js:server/lib/partner.js:490-497
/* ---- what was sent out -------------------------------------------------- */

export function logWhatsApp({ phone, body, kind = null, refType = null, refId = null, userId = null }) {
  const d = DB.get();
  d.prepare(
    'INSERT INTO wa_messages (at, phone, body, kind, ref_type, ref_id, user_id) VALUES (?,?,?,?,?,?,?)'
  ).run(nowIso(), phone, body, kind, refType, refId, userId);
}
```

`grep -rn logWhatsApp server` → only that definition. It is **read** (`Partner.all()` selects the
last 200, `server/lib/partner.js:85`, hydrated into `DB.waMessages`, `js/data.js:2651-2659`). The
browser's `WA.log` writes to memory only:

```js:js/whatsapp.js:36-46
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
```

— gone on the next `hydrate`. Live rows: **0**. The bulk "log all" button is a toast
(`js/bulk.js:503-507`).

## E4. What a timeline's "receipt sent" could read from today — **nothing.**

There is no record of a receipt being *sent* to anyone. What exists per customer, by joining through
`sales.customer_id`:

| Event | Source | Caveat |
|---|---|---|
| bought | `sales` (`at, total, payment, points_earned, points_used, voided`) | browser holds last 200 + open credit |
| receipt **printed** / gift slip printed | `print_log` (`sale_id, kind, status, at, user_id`) | server-only; no route reads it; 1 row live |
| paid off debt | `debt_payments` (`sale_id, at, amount, method`) | `/api/money` needs `money.read` |
| delivered | `deliveries` (`sale_id, status, out_at, closed_at, fail_reason`) | `delivery.read`; driver-scoped |
| points adjusted by hand | `change_log.origin` text `points +250: reason` (`server/lib/customers.js:153-154`) | free text; no route reads `change_log` |
| messaged on WhatsApp | `wa_messages` | never written |
| told on Telegram | — | does not exist |
| created / archived | `customers.created_at` (dropped by hydrate), `change_log` | — |

Anything labelled "sent" would be invented.

---

# Part F — My own read

## F1. Unused or half-connected today (so it does not become permanent)

- `GET /api/customers/:id/history` (`server/index.js:596-600`) and `Customers.historyFor`
  (`customers.js:57-65`) — no caller.
- `Customers.archive()` (`customers.js:126-128`) — no caller; archiving goes through `update({archived})`.
- `visits`, `created_at`, `updated_at` — sent (`customers.js:28-31`), dropped by `hydrate`
  (`js/data.js:2277-2293`); "orders" on the card is `history.length` (`app-customers-scan.js:68`).
- `note` and `address` — hydrated, never displayed, never editable (§C7, §C9).
- `source` — always `'in-store'` from the only form (`app-actions.js:812`); `'online'` is only ever
  read (`app-customers-scan.js:62,107`).
- `demo` flag — hydrated (`js/data.js:2290`), nothing sets or reads it.
- `CITIES` (`js/data.js:335`) — declared, unused.
- `Partner.logWhatsApp` / `wa_messages` / `WA.log` / `bk msg-log` (§E3).
- `points_earned` — stored per sale, never hydrated; three screens recompute it
  (`app-customers-scan.js:155`, `app-export.js:423`, `app-documents.js:12,177`).
- `Printing.log()` (`printing.js:146-151`) — no route.
- `GET /api/scan/:code` (`server/index.js:358-365`) — no browser caller.
- `POST /api/sales/:id/void` — no UI (§C2).
- `Bulk` points `+250` — a hard-coded delta with a hard-coded reason (`bulk.js:309-317`).
- `custById` — built and thrown away inside `hydrate` (`js/data.js:2295-2296`) while every screen
  does a linear scan for the same thing (§A5).
- `.strong-num` — used once, by the drawer (`app-customers-scan.js:130`).
- The `500`-point redemption block — two literals in `pos.js` (`:446, :454, :1370`), not config.

## F2. Five things that will bite whoever builds the list and the profile

**1. The list is rebuilt from scratch on every keystroke, and it draws every match.**
`CHANGES['cust-q']` → `render()` (`js/app-changes.js:21`) → `viewCustomers()` builds a card per
matching customer with no cap and no empty state (`js/app-customers-scan.js:51-79`), then
`Bulk.paint()` runs `customerRows()` again (`js/bulk.js:143-155, 50-53`). Measured: the JS is cheap
(0.34 ms filter+sort at 5,000), so the cost is entirely DOM. Either paginate/window the grid or stop
calling `render()` from the search box.

**2. Everyone who has never bought is "At risk", including the person you just added.**
`DB.daysSince(null)` is `new Date(null)` = the epoch:

```js:js/data.js:814
  daysSince: function (d) { return Math.round((TODAY - new Date(d).setHours(0, 0, 0, 0)) / 86400000); },
```

Used by the card (`app-customers-scan.js:16, 53-54`), the head badge (`:29`), the drawer (`:101,
110, 165`), the export subtitle (`app-export.js:131`), the dashboard alert that deep-links into the
`risk` filter (`app-dashboard.js:67-73`) and the dashboard's "active customers" KPI
(`app-export.js:290`). Live: the one customer is flagged at risk with no sales. The POS picker had
to work around it separately (`lastBuy()`, `js/pos.js:1480-1483`).

**3. The profile's history is a window onto the shop's last 200 sales, not the customer's sales.**
§A6. The card's "orders" count and the drawer, the statement, the points timeline and preferred
sizes all stop at that horizon; credit sales past it arrive with no `items`. The route that fixes
it exists and is unused. Any "lifetime" figure the profile shows must come from the server
(`total_spent`, `visits`) or it will disagree with the card next to it.

**4. Drawers are not places.** Nothing puts a record in the history (§B9); `go()` closes the drawer
(`js/app-routing.js:279`); a deep link's hash is overwritten with `#customers` and Back reopens the
drawer; a repaint after any write leaves the open drawer showing stale HTML. A profile *page* means
a new hash grammar in `boot()`, the `hashchange` handler, `go()` and `navAllowed()`, and deciding
what Back does — none of which exists.

**5. Archived customers leak, and the counts include them.** The server sends archived rows to
anyone with `customer.write` — cashier included (§C4) — and only the POS picker filters them
(§C3). The head badge shows `list.length + ' / ' + DB.customers.length` (`app-customers-scan.js:49`),
so "12 / 15" counts three archived people; the topbar search and the palette will open them; and
`Sales.record` refuses the sale at the last moment with `unknown_customer` if one is attached
(`server/lib/sales.js:159-163`, surfaced by `js/pos.js:1013-1019`).

Two more, shorter: **names are never bidi-isolated** (§B8) — the first mixed-script name on the
list will reorder in Arabic; and **`total_spent` sums `sales.total` across currencies**
(`customers.js:36`) while `sales.currency` can be USD or SYP per sale (`server/lib/sales.js:128-130`),
so a shop that settles some sales in dollars gets a lifetime figure that adds cents to lira — the
first recon's §38.1, still true.

## F3. What the code does not settle — for the shop owner, with what the code does today

1. **Redeeming points.** Today: a fixed block of 500 (`pos.js:446-454`), only if the balance is ≥500,
   no partial spend, worth `loyalty.point_value` (0.5) each, cannot exceed the sale, rides above the
   discount cap (`sales.js:258-271`). *Ask:* any amount, or blocks? A minimum? Cash value on a
   receipt? Can points pay a debt?
2. **Points on a void or a return.** Today: nothing moves (§C2); the earned points remain spendable.
   *Ask:* claw back on void? What about an exchange within the 48-hour window?
3. **Selling on credit.** Today: any cashier, any customer, any amount, no limit, no flag, and a
   walk-in can be sold on credit with nobody to chase (§C6). *Ask:* who may, to whom, up to what,
   and does a customer with an old debt get refused or warned?
4. **Archived customers.** Today: hidden from the grid and the till, visible in the topbar search,
   the palette and the "n / N" count, and still counted in nothing else (§C3, F2-5). *Ask:* should
   an archived person be findable at all, and by whom?
5. **The address.** Today: one address per customer, written by the first delivery, never editable
   (§C7); the real address lives on each delivery. *Ask:* keep one default, keep several, or none?
6. **Identity and duplicates.** Today: no uniqueness on phone; a "duplicate" is same name *and* same
   phone, checked only in the browser (`app-actions.js:793-805`); the server accepts anything
   (`customers.js:83-100`). *Ask:* is the phone the identity? What happens when two records are the
   same person (the merge tool's rules)?
7. **What counts as an "order".** Today: the card shows `history.length` (recent invoices seen by
   this browser); the server's `visits` counts non-voided sales; neither counts deliveries or print
   jobs. *Ask:* which number goes on the profile?
8. **"At risk".** Today: 90 days, hard-coded (`app-customers-scan.js:16, 54`), and everyone with no
   purchase qualifies. *Ask:* the threshold, and whether never-bought is a different state.
9. **Who sees what.** Today: cashier and driver both hold `customer.read`, cashier holds
   `customer.write`; `note`, `address`, phone and lifetime spend go to all of them (§C4, §C9). *Ask:*
   should the note be manager-only? Should a driver see spend?
10. **Receipts by message.** Today: WhatsApp is a `wa.me` hand-off that logs nothing durable; there is
    no Telegram (§E1, §E3). *Ask:* which channel, and is "sent" worth recording at all if the app
    cannot know it arrived?
11. **The card.** Today: no card, no code, two label sizes in the code and one roll confirmed in the
    printer (§D4-6). *Ask:* card stock and size, QR or barcode, Arabic name on it, who prints it.
12. **Currency of lifetime spend.** Today: summed across currencies (§F2). *Ask:* report in SYP at the
    frozen rate of each sale, or in the sale's own currency?
13. **Name script.** Today: one `name` column, no Arabic/Latin pair, no bidi isolation. *Ask:* do
    customers get two names (the way `warehouses` and `clubs` do)?
14. **Source.** Today: always `in-store`; `online` exists as a label only. *Ask:* is "where they came
    from" a thing the shop wants to record, and what are the values?

## F4. What contradicts what Phase 1 assumed

1. **Phase 1 is not in this tree** (opening section). Every "after Phase 1" answer here is "as at the
   first recon". If the rebuild prompts were written against a Phase 1 diff, that diff is not on
   `main`, not on `archive/hand-uploads`, not stashed, not in the working tree.
2. **There are no "spend and debt fields" on the customer payload.** Spend fields (`total_spent`,
   `visits`, `last_purchase_at`) predate the first recon; there is no debt field, no debt route, and
   debt is derived in the browser from `DB.sales` + `money.creditSales` (§A6, §C6).
3. **The first recon's §38.5 ("the frozen exchange rate is used by nothing on screen") is no longer
   true**: the thermal receipt preview prints `sale.fxRate` (`js/app-documents.js:250-251`), and
   `js/receipt.js` reads `fx_rate` from `Printing.data`. It is still unused by the customer screens.
4. **`CLAUDE.md` still says `js/app.js`**; the customers code is in `js/app-customers-scan.js`, the
   form in `js/app-warehouse.js`, the actions in `js/app-actions.js`, the routing in
   `js/app-routing.js` and the deep links in `js/app-export.js`. (Already noted by the first recon
   §40.1; unchanged.)
5. **`CLAUDE.md`'s "28 permissions × 5 roles"** is 30 × 5 (`ALL_PERMISSIONS`, `server/lib/auth.js:56-95`;
   the live table has 30 rows for `cashier`).
6. **The `has_payments` comment says `Sales.void` calls `Money.paymentsAgainst`**
   (`server/lib/money.js:279-282`); it inlines the same query instead (`sales.js:434-436`). Two
   copies of one rule.

---

# Confidence

## Verified by running or reading

- Every row count, schema, permission value, config key and index in Parts A, C and E: read-only
  queries through `node:sqlite` `{ readOnly: true }` against `server/data/og.db` at 2026-09-01
  (the server was running; WAL reads are consistent).
- Payload bytes and server-side timings (§A4, §A7): the server's own `lib` modules imported through
  `DB.openReadOnly()`, `JSON.stringify` byte lengths, 20-call averages on this machine (Node 24.19.0).
- Browser `DB.hydrate()` timings (§A7, §A5): Headless Chrome 152 loading the repo's real
  `codes.js`, `data.js`, `app-state.js`, `app-i18n.js` from disk with the real payload; the 1,000 and
  5,000-customer figures are **synthetic rows** (one real row cloned with new ids) and say nothing
  about real name lengths or real sales distributions.
- Every code extract: read from the files at `c2c6a82`, line numbers from `cat -n`.
- "No caller" claims: repo-wide `grep` over `js/` and `server/` whose only hit is the definition or
  the route.
- The Phase 1 absence: `git diff 992e0ba HEAD --stat`, `git log --all`, `git stash list`,
  `git status --ignored`, and byte-identical customer files.

## Inferred, not directly verified

- The narrow-screen behaviour of the drawer's three-column stat grid (§B1) — from the selectors, not
  from a rendered 320px viewport.
- Which tables restack on a phone (§B4) — from a `<th` count per header line, not from opening each
  screen; a header row I mis-counted would move a row of that table between "yes" and "no".
- The A4/A7 extrapolations — linear from one sparse row and one synthetic filled row; real rows will
  sit between them.
- That response bodies are uncompressed (§A4) — I did not read `server/lib/http.js`.
- That "cashier" in the live table has not changed since the first recon — I read the `allowed`
  values, not `updated_at`.

## Could not check at all

- **End-to-end `Shop.load()` in a signed-in browser** — no credentials exist for me, the cookie is
  `HttpOnly`, and I would not start a second server against the live database. The A7 number is the
  mapping function, not the sign-in.
- **Anything on another machine or an unpushed branch** — if Phase 1 lives there, this report
  describes the wrong code.
- `server/.env` (Telegram/bot keys, `OG_VAULT_KEY`) — deliberately not opened; the "no Telegram"
  answer rests on the tree, `.env.example` per the first recon, and the absence of any code that
  would read such a key.
- The physical label stock and printer roll (§D4-6) — the code disagrees with itself about the roll
  size and only a person in the shop can settle it.
- Real-data shapes for names, phones, addresses — one customer row, all fields either null or short.
