# PRINT_FACTS

Read from the code on `main` (fae2689), 7 Oct 2026. No code or data was changed.

## 1. Web orders

- **`web_order_requests`: not used by this system.** It appears once, in a comment in
  `server/supabase/030_erp_access.sql`. That comment lists it as one of the website's own
  `web_*` tables that share the Supabase project. Nothing in this repo reads or writes it.
- **The path is:**
  1. **Cloud:** table `web.orders`, created by `server/supabase/030_web_orders.sql`. The
     website writes to it through `public.web_order_submit(key, order, proof)`.
  2. **This system:** `server/lib/weborders.js` collects the orders by calling
     `public.web_orders_take(lineage, limit)` every minute. `collectWeb()` in
     `server/lib/sync-worker.js` triggers it.
  3. **Local table:** each collected order becomes a row in `web_orders`
     (`server/migrations/061_web_orders.sql`).
  4. **Report back:** the result goes to the cloud through `public.web_orders_mark(lineage, items)`.
- **Confirmation** happens in `POST /api/orders`, in `server/index.js` around lines 1839–1889.
  - When the body carries `webRef`, the route calls `WebOrders.forAccept(ref)` before it saves.
  - It forces `channel 'web'` and `opId = weborder:<ref>`.
  - After the order is saved, it calls `WebOrders.accepted(ref, saleId, userId)` (`server/lib/weborders.js`).
  - In the browser, the person presses the order desk's Save (`js/desk.js`, `Desk.fromWeb`).
- **Rejection** is `WebOrders.reject(ref, {code, note, userId})`.

## 2. Catalog

- **`web_catalog_snapshot`: not found.** No table, file or reference with that name exists in this repo.
- The website gets the catalogue from two places. Both are filled from this system's data:
  - `GET /api/ext/products`, built by `webRow()` in `server/lib/catalogue.js`;
  - the cloud functions `public.web_products(key)` and `public.web_product(key, id)`. They are
    defined in `server/supabase/037_web_products.sql` and `040_product_web_extras.sql`, and they
    read the mirrored `products`, `variants`, `product_colours` and `product_photos` tables.
- One product, in the shape `webRow()` returns (the values are made up):

```json
{
  "id": 57, "name": "Samba OG", "brand": "Adidas", "type": "sneakers",
  "category": { "id": "sneakers", "en": "Sneakers", "ar": "أحذية" },
  "colorway": null, "madeIn": "VN",
  "image": { "bg": "#222", "initials": "SO", "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg" },
  "photos": [ { "id": 1, "productId": 57, "colourId": 3, "kind": "model", "url": "…", "thumbUrl": "…", "width": 1600, "height": 1200, "sort": 0 } ],
  "price": 3499, "currency": "USD", "minorExp": 2,
  "prices": { "USD": { "amount": 3499, "minorExp": 2 }, "SYP": { "amount": 4829, "minorExp": 0 } },
  "rate": { "rate": 138, "at": "2026-10-01T09:00:00.000Z" },
  "sizes": [ { "size": "42", "sku": "OG-057-42", "colourId": 3, "inStock": true } ],
  "colours": [ { "id": 3, "en": "White", "ar": "أبيض", "hex": "#ffffff", "imageUrl": "…", "photos": [ … ],
                 "sizes": [ { "size": "42", "sku": "OG-057-42", "inStock": true } ] } ],
  "inStock": true,
  "description": { "en": "…", "ar": "…" },
  "pairsWith": [61, 12],
  "updatedAt": "2026-10-01T09:00:00.000Z"
}
```

## 3. Yalla Wear portal: price and cost

These are defined in `server/migrations/015_partner.sql` and written by `server/lib/partner.js`.

- **`print_jobs.price`** is what the **customer** pays OG. The OG side sets it:
  - the till sets it when it creates the job;
  - the Print screen form sets it for a manual job;
  - for a website job it comes from config `print.unit_price` (`Partner.webPrices()`).
  - Yalla Wear never receives it: it is in `PARTNER_STRIP`.
- **`print_jobs.cost`** is what **Yalla Wear charges** OG. `null` means no price has been agreed.
  - It is set when the job is created (`create({cost})`). For a website job it comes from config
    `print.partner_unit_cost`, default 460.
  - For a **kit** job, `cost` is not used. The cost is derived as SUM(`print_job_lines.qty × unit_cost`).
- **Sending a manually created job to Yalla Wear:**
  - Route: `POST /api/print-jobs/:id/order` (`print.write`) → `Partner.sendOrder()` → `placeOrder()` in `server/lib/partner.js`.
  - It refuses the job if it is already `pending` or `accepted`, or if any shirt has no name (`names_missing`).
  - It sets `print_jobs.order_state = 'pending'`, `order_sent_at` and `updated_at`.
  - It writes a `job_messages` row (kind `order`) and a `partner_events` row (`order_new`, audience `yalla`, used for Telegram), plus `logChange`.
  - In the browser: `DB.sendOrder` (`js/data.js`) → `Shop.sendOrder` (`js/shop.js`).
  - `Partner.create({autoSend:true})` does the same in one step.

## 4. Stages

**`print_jobs.stage`** (a CHECK in 015), in order:

1. `design`: the job is being prepared at OG. This is the default.
2. `sent`: "Sent to print", meaning the printer took the job. It can only be set once `order_state = 'accepted'`, and accepting moves `design` → `sent` automatically.
3. `printing`: Yalla Wear is printing it.
4. `delivery`: the printed job is on its way.
5. `done`: finished. A review and an invoice are only possible after this.

**`print_job_stages.stage`** has **no CHECK** (plain TEXT). It is the history of the stages above: one stamped row per step, with `by_side` (`og` or `yalla`) and `user_id`. When a job moves back a stage, the rows at or beyond that stage are deleted.

**`print_jobs.order_state`** (a CHECK in 015), in order:

1. `draft`: not sent to Yalla Wear yet. This is the default, and a job with a blank name stays here.
2. `pending`: sent, and waiting for Yalla Wear to answer.
3. `accepted`: Yalla Wear took it.
4. `declined`: Yalla Wear refused it. The stage is left where it was.

## 5. Delivery after printing

- **Not found: there is no link from a print job to a delivery.**
  - `deliveries`, `handovers` and `errands` have no column that points at `print_jobs`.
  - `server/lib/deliveries.js`, `orders.js` and `safeers.js` never mention `print_job`.
- Today the return trip is recorded only as a stage. Moving the job to `delivery` posts a
  "shipped" message in the job thread and sends a `stage` event to the other side.
- What does exist:
  - an **errand** (`server/migrations/060_*.sql`) of kind `supplier_pickup` or `other`. It can point at a `sale_id`, but not at a print job;
  - the till's sale, linked through `print_jobs.sale_id`, which may itself have its own delivery.
- CLAUDE.md, "Known open work", says this outright: a finished website print job "has no set road to the customer".

## 6. Sync (e.g. `clubs`)

- **The direction is one-way**, from local SQLite to Supabase. Nothing reads the mirror back while
  the server is running. The only way back is a restore or the boot pull (`server/lib/restore.js`).
- **`clubs` is a "mirror-shape" table.**
  - It is **not** in `change_log`.
  - It is pushed whole on every full run: `mirrorTable(log, 'clubs', ['code'], …)` in `server/lib/mirror.js`, around line 997.
  - Rows deleted locally are deleted in the mirror too.
  - Between full runs, the 10-second tick in `server/lib/sync-worker.js` finds changes with a content hash.
- **The other shapes:**
  - **Cursor tables** (`CURSOR_TABLES`, `mirror.js:730`) replay `change_log` from a bookmark kept in Supabase `sync_state`.
  - **Append-only tables** are pushed above the highest `id` already sent.
- **Adding a new table** (from the code and CLAUDE.md):
  1. Write a new cloud file, `server/supabase/041_*.sql`, and run it by hand. It needs the table, `ENABLE ROW LEVEL SECURITY` with no policy, and the `GRANT … TO service_role` / `REVOKE` block. Re-run `030_erp_access.sql` afterwards.
  2. Push it from `server/lib/mirror.js`, in the right shape, behind a guard. A cursor table also needs `CURSOR_TABLES`, and every write needs `DB.logChange()` in the same transaction.
  3. Add it to `ORDER` in `server/lib/restore.js`, to `PUSHED` in `server/lib/drift.js`, and to the reconcile list.
  4. Add an entry in `server/lib/mirror-lag.js` while the cloud is missing a column.
  5. For a local-only table, add it to `LOCAL_ONLY` in `supabase-check.js` instead.

## 7. Supabase key

`SUPABASE_SERVICE_ROLE_KEY`, falling back to `SUPABASE_SECRET_KEY` (`server/lib/supabase.js`).
The URL is in `SUPABASE_URL`. Both are in `server/.env`.
