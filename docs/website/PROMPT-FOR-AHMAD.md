# OG Sports website ↔ OG System — connecting the orders (contract v1.3)

> **For Ahmad, and for the AI helping him build the OG Sports website.**
> Paste this whole file in as the brief. It is the contract between the website and the
> shop's system (OG System). The shop side is being built to exactly this. If something
> here does not fit the website, ask before changing it. Do not work around it: both sides
> have to agree.

> **v1.3 (25 Sep 2026) — prices are dollars, the lira follows the rate, and products come from
> the cloud.** Every product is now priced in **US dollars**, and its lira price is the dollar
> price at the shop's current rate, which follows the market by itself. Each product carries
> **both, ready to show**: `prices.SYP` (show it large) and `prices.USD` (show it small beside
> it). **Never work the lira out yourself.** Products now come from the Supabase function
> **`web_products`**, so the shop window works **even with the shop's laptop switched off**;
> `GET /api/ext/products` still answers the same thing while the laptop is on. Nothing was
> removed or renamed. The short list of what to change is `docs/website/UPDATE-USD-PRICES.md`.

> **v1.2 (24 Sep 2026) — every product has real photos.** Each colour of a product now has at
> least two photos: **first somebody wearing it (the model photo), second the product on its
> own**, and then any extra photos. A colour appears in `/api/ext/products` **only once it has
> both**, and a product with no colour ready is not in the list at all. Every product and every
> colour now carries a `photos` list, model first, each photo in two sizes (§3). Nothing was
> removed or renamed: `image.url` and a colour's `imageUrl` are still there and are now the
> model photo. The short list of what to change is `docs/website/UPDATE-PRODUCT-PHOTOS.md`.

> **v1.1 (24 Sep 2026) — payment methods are live.** The shop's owner now decides, from OG
> System, which transfer methods the website offers, the colour of each one's button, and
> whether cash on delivery is offered at all. A change reaches the cloud within seconds.
> What changed for the website: `web_checkout` gained `cod`, `version`, `updatedAt` and a
> `color` per transfer method, and must now be read **every time a checkout opens** (§4);
> `web_order_submit` has two new refusals, `method_gone` and `cod_off` (§6). Nothing was
> removed or renamed, so a website built on v1 keeps working. The short list of what to
> change is `docs/website/UPDATE-PAYMENT-METHODS.md`.

---

## 1. What we are building

OG Sports is a sneaker and streetwear shop in Aleppo. Everything in the shop (stock, orders,
deliveries, money, and print jobs for **Yalla Wear**, the print partner) runs in **OG System**,
on a laptop in the shop. The website must:

1. **Show the shop's real products**, prices, sizes and photos, taken from OG System.
2. **Send every order into OG System automatically.** An order can be:
   - **products** (shoes, clothes) delivered to the customer or picked up from the shop,
   - **print jobs** (a name or number printed on a shirt), which go straight to Yalla Wear,
   - or both in one order.
3. **Show the customer where their order is** (received, confirmed, rejected, the print's
   progress, and a tracking link once it is confirmed).

**The shop laptop is switched off at night.** People still shop at night, so the website
**never places an order with the laptop directly**. It leaves the order in the cloud
(Supabase). The laptop collects it within a minute whenever it is on. An order placed at
2 am is waiting for the shop in the morning.

What happens after the website submits an order:

1. The order sits in the cloud as **`waiting`** until the shop laptop collects it.
2. The laptop collects it and it becomes **`received`**. Any print jobs in it go to Yalla Wear
   at that moment.
3. Somebody at the shop **calls the customer to confirm**.
4. The shop presses **Accept**, and the order becomes **`accepted`**: a real order, with
   stock leaving and a delivery and tracking link.
5. Or the shop presses **Reject**, and the order becomes **`rejected`**, with a reason code.

Nothing leaves the shelves until a person at the shop says yes. **Prices are always decided by
the shop.** The prices the website sends are only "what the customer saw", so the shop can
compare them.

---

## 2. The two connections, and the three secrets

| What | Where | When it works |
|---|---|---|
| **Products** (read-only) | Supabase functions `web_products` / `web_product` (v1.3) | Always |
| **Orders, checkout info, order status** | Supabase functions (`POST {SUPABASE_URL}/rest/v1/rpc/...`) | Always |
| Products, the old door (same answer) | `GET https://shop.ogsports1.com/api/ext/...` | Whenever the shop's server is up. Since 25 Sep 2026 that server is on the VPS, not the laptop, so this is nearly always; still prefer the Supabase functions |

The shop gives you three values:

| Name (suggested env var) | What it is |
|---|---|
| `OG_WEBSITE_KEY` | The website's key. Used at **both** doors. |
| `OG_SUPABASE_URL` | e.g. `https://xxxx.supabase.co` |
| `OG_SUPABASE_PUBLISHABLE_KEY` | The project's publishable (public) key |

**All three stay on the website's SERVER.** None of them ever goes into JavaScript that a
browser downloads, or into the page source. The browser talks to *your* server; your server
talks to OG System. Anyone holding the website key can place orders in the shop's name.

### Calling the products door

Products are a Supabase function like the others (v1.3): `og('web_products', {})` with the
helper below, or `og('web_product', { p_id: 50 })` for one. The old door on the shop laptop
gives exactly the same products while the laptop is on:

```http
GET https://shop.ogsports1.com/api/ext/products
Authorization: Bearer <OG_WEBSITE_KEY>
```

### Calling a Supabase door (every order call looks like this)

```http
POST {OG_SUPABASE_URL}/rest/v1/rpc/web_order_submit
apikey: <OG_SUPABASE_PUBLISHABLE_KEY>
Content-Type: application/json
Accept: application/json

{ "p_key": "<OG_WEBSITE_KEY>", "p_order": { ... }, "p_proof": null }
```

- The publishable key goes in the **`apikey` header only**. It is not a JWT, so **do not**
  send it as `Authorization: Bearer`.
- The body is JSON with the function's parameter names (`p_key`, `p_order`, …).
- A function answers **HTTP 200 with JSON** in both cases:
  - it worked: `{"ok": true, ...}`
  - the shop refused: `{"ok": false, "code": "bad_phone", "field": "customer.phone"}`
- Anything that is **not** HTTP 200 is a transport problem: network, wrong URL, wrong
  publishable key, or `404 PGRST202` = "the shop has not installed the functions yet".
  Log it and retry later. Never show the raw error to a customer.

Minimal Node example:

```js
async function og(fn, params) {
  const res = await fetch(`${process.env.OG_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: process.env.OG_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ p_key: process.env.OG_WEBSITE_KEY, ...params }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`OG ${fn}: HTTP ${res.status} ${await res.text()}`);
  return res.json();            // { ok: true, ... } or { ok: false, code, field? }
}
```

---

## 3. Products

### `web_products` (and `GET /api/ext/products`, the same answer)

Returns **the whole published catalogue** in one answer:

```json
{
  "ok": true,
  "products": [
    {
      "id": 50,
      "name": "Samba OG",
      "brand": "Adidas",
      "type": "sneakers",
      "category": { "id": "sneakers", "en": "Sneakers", "ar": "أحذية رياضية" },
      "colorway": "Cloud White / Core Black",
      "madeIn": "Vietnam",
      "image": { "bg": "#1E293B", "initials": "SO",
                 "url": "https://…/product-images/products/50/colours/3/photos/mufq…-l.jpg",
                 "thumbUrl": "https://…/product-images/products/50/colours/3/photos/mufq…-s.jpg" },
      "photos": [
        { "kind": "model",   "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1280, "height": 1600 },
        { "kind": "product", "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1600, "height": 1600 },
        { "kind": "extra",   "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1600, "height": 1200 }
      ],
      "price": 3499,
      "currency": "USD",
      "minorExp": 2,
      "prices": { "USD": { "amount": 3499, "minorExp": 2 },
                  "SYP": { "amount": 4829, "minorExp": 0 } },
      "rate": { "rate": 138, "at": "2026-09-25T08:10:00.000Z" },
      "sizes":   [ { "size": "42", "sku": "OG-050-42", "colourId": 3, "inStock": true } ],
      "colours": [
        { "id": 3, "en": "White", "ar": "أبيض", "hex": "#F5F5F5",
          "imageUrl": "https://…-l.jpg",
          "photos": [ { "kind": "model", "url": "…", "thumbUrl": "…", "width": 1280, "height": 1600 },
                      { "kind": "product", "url": "…", "thumbUrl": "…", "width": 1600, "height": 1600 } ],
          "sizes": [ { "size": "42", "sku": "OG-050-42", "inStock": true } ] }
      ],
      "inStock": true,
      "updatedAt": "2026-09-20T11:02:00.000Z"
    }
  ],
  "count": 1,
  "rate": { "rate": 138, "at": "2026-09-25T08:10:00.000Z" },
  "version": "5b0f0c1e8a4d3c2b1a09f8e7d6c5b4a3",
  "generatedAt": "2026-09-25T08:12:00.000Z"
}
```

(The laptop's `/api/ext/products` has no `ok` and no `version`; everything else is identical.)

Rules:

- **Keep your own copy and refresh it every 5 minutes.** When the shop answers, **replace
  your whole list** with the new one. A product that is missing from the new list has been
  taken off the website by the shop. Hide it. There is no "changes since" feed on purpose.
  `version` changes exactly when something shown changed (a price, the rate, a photo, a size
  selling out), so an unchanged `version` means there is nothing to redraw.
- **`web_products` answers from the cloud copy, so it answers with the laptop off** (v1.3).
  If it does not answer at all (internet down), keep showing your last good copy. The shop
  checks stock by phone before confirming anyway.
- **A size is identified by its `sku`.** That is what you send back in an order. Sizes with
  `inStock: false` are shown but not buyable. Quantities are deliberately never sent.
- **Colours:** a product may have several colours (`colours[]`), each with its own sizes,
  SKUs and photos. When there is only one colour, you don't need to show a colour picker.
  With more than one (the full brief is `docs/website/UPDATE-PRODUCT-COLOURS.md`):
  - **Draw a swatch per colour** from `colours[]`, in the order given: `hex` for the swatch
    (`null` = a neutral one), `ar` / `en` for its name. The first colour is chosen by default.
  - **Choosing a colour switches its `photos` and its `sizes` together.** The same size has a
    different SKU in each colour (`OG-057-39`, `OG-057-C2-39`), and the order sends the chosen
    colour's SKU.
  - **The top-level `sizes` mixes every colour's sizes** (each size once per colour, with
    `colourId`). Never draw it as the size picker unfiltered, or every size appears twice.
  - Show the colour's swatch and name on every cart line and on the order page.
- **Photos (v1.2).** The shop's rule: every colour has **at least two** photos before it is
  published — **1. the model photo** (somebody wearing it) and **2. the product photo** (the
  product on its own) — plus any number of extras.
  - **Only colours with both photos are in the answer.** A colour still waiting for photos is
    left out completely: its swatch, its sizes and its SKUs. A product with no colour ready is
    not in the list at all, exactly like a product the shop switched off. You don't need to
    check anything: show what you are given.
  - **`photos` is already in the order to show**: the model first, the product second, then
    the extras. Don't sort it. `kind` is `model`, `product` or `extra`.
  - **Each photo has two files.** `url` is large (at most 1600 px on the long side) for the
    product page and a zoom; `thumbUrl` is small (at most 480 px) for grids, carts and the
    order page. `width` and `height` are the large file's size, so you can reserve the space
    before it loads (they may be `null` for an old photo).
  - **The product's `photos` are its first colour's.** When the customer picks another colour,
    show **that colour's** `photos`. `image.url` / `image.thumbUrl` (the product's first photo)
    and a colour's `imageUrl` (its first photo) are the model photo, kept for a site built on v1.1.
  - A nice product card: the **product photo** by default and the **model photo** on hover (or
    the other way round). That is the owner's reason for asking for two.
  - **The files live on the shop's Supabase Storage** (public, `https://<project>.supabase.co/
    storage/v1/object/public/product-images/…`), so they load **even when the shop's laptop is
    off**. If your framework needs image hosts listed (Next.js `images.remotePatterns`, a CSP
    `img-src`), allow that host.
  - **A replaced photo gets a new address and the old file is deleted.** Never keep your own
    copy of a photo URL longer than your 5-minute product copy, or you will show broken images.
  - `image.bg` and `image.initials` are still sent for a placeholder while a photo loads.
    Never use stock photos.
- **Prices (v1.3): every product is priced in dollars, and the lira is worked out for you.**
  `prices.SYP.amount` is the dollar price at the shop's current `rate`, rounded to the whole
  lira: **exactly what the shop's till charges today.** Show it **large** (`4,829 ل.س`), and
  `prices.USD` **small** beside it (`$34.99`).
  - **Never compute the lira yourself** and never cache a rate of your own. The rate follows the
    market by itself, and `prices.SYP` follows it within seconds.
  - Money is in minor units: displayed amount = `amount / 10^minorExp`. SYP has `minorExp` 0
    (whole lira), USD has 2 (cents: `3499` → `$34.99`).
  - `prices.SYP.amount` is `null` only if the shop has no rate at all. Then show the dollar
    price alone.
  - `price` / `currency` / `minorExp` are the product's own price (now always dollars), kept
    for a site built before v1.3.
  - Cart and order totals: add up `prices.SYP.amount`, and send those lira figures as the
    item `price` with `currency: "SYP"` and in `shown` (§5). The shop re-prices every line
    when it accepts the order, so a rate that moved in between is settled on the call.
- `web_product` with `p_id` returns `{ "ok": true, "product": {...} }` for one product, or
  `{ "ok": false, "code": "not_found" }` if it is not published. `GET /api/ext/products/:id`
  returns `{ "product": {...} }` or 404.
- `GET /api/ext/reviews?limit=50` returns delivery reviews the customer allowed **and** the
  shop approved, if you want a reviews section.

---

## 4. Checkout: what the shop ships, charges, and accepts

### `web_checkout` — call it EVERY time a checkout opens

```json
POST /rest/v1/rpc/web_checkout      { "p_key": "…" }
```

It answers from the shop's own Settings, so it works with the laptop off. **The owner changes
these from OG System and the change is in the cloud within seconds**, so:

- Call it every time a customer opens the checkout. Your server may keep the answer for **at
  most 60 seconds**; never longer (v1 said 10 minutes — that is gone).
- While a checkout page stays open, ask your server again every 60 seconds. When `version` is
  different from the one the page was drawn with, redraw the delivery and payment choices
  **and keep the cart and everything the customer typed**. If the method they had picked has
  gone, clear only that choice and say so (§6, `method_gone`).
- `version` changes exactly when something this answer shows changes, and never otherwise, so
  comparing it is all you need. `updatedAt` is when the owner last changed one of the settings
  behind it (methods, shipping, countries, the print price). It does **not** move when the rate
  moves by itself; `version` does.
- When the call fails (no line, 5xx), keep using your last good answer. `web_order_submit`
  checks the payment again anyway.

```json
{
  "ok": true,
  "baseCurrency": "SYP",
  "currencies": [ { "code": "SYP", "minorExp": 0 }, { "code": "USD", "minorExp": 2 } ],
  "rate": { "base": "USD", "quote": "SYP", "rate": 138, "at": "2026-09-24T20:12:21Z" },
  "travel": ["driver", "office", "courier", "abroad", "pickup"],
  "cod": true,
  "codAllowed": ["driver", "pickup"],
  "countries": [ { "id": "SY", "en": "Syria", "ar": "سوريا", "currency": "SYP", "dial": "963" } ],
  "shipping": [
    { "country": "SY", "cityEn": "Aleppo", "cityAr": "حلب", "method": "driver",
      "fee": 15000, "currency": "SYP", "customerPaysCourier": false }
  ],
  "transfer": [
    { "id": "sham", "en": "Sham Cash", "ar": "شام كاش", "color": "#16a34a",
      "details": { "en": "Sham Cash 0933 … — OG Sports", "ar": "شام كاش 0933 … — أو جي" } }
  ],
  "print": { "unitPrice": 950, "currency": "SYP",
             "clubs": [ { "code": "bar", "en": "Barcelona 26/27 · Fan Edition", "ar": "برشلونة" } ] },
  "version": "3f1c9a0e5b7d2c4a8e6f1b3d5a7c9e0f",
  "updatedAt": "2026-09-24T11:12:58.410Z"
}
```

- `transfer` is **in the order the owner lists them**. Show them in that order.
- `color` is the owner's colour for that method's button (`#rrggbb`, lower case), or `null`
  for none. Use it as the accent (a border, a dot, the selected state). Keep the text readable:
  white text on the colour, or the colour as a border on your normal button. `null` means your
  normal button.
- `details.en` / `details.ar` are the shop's own account text. Copy them exactly. A method the
  owner has switched on always has both, but older data can have one of them `null`: then show
  the other one.
- `rate` is the shop's dollar rate **in the redenominated lira** (1 USD = 138 SYP, not 13,800),
  and since 24 Sep 2026 it **follows the market feed by itself**: the shop's server reads the
  exchange-rates function every ten minutes and writes the new rate, which reaches this answer
  within seconds. Do not call the exchange-rates function from the website for prices — use this
  `rate`, so the website and the till always agree on the same number, and the shop's guard
  (a jump the owner has to confirm) applies to both. `version` moves when the rate does, so an
  open checkout redraws its lira prices exactly as it does for a new method. **Product prices
  come ready in lira from `web_products`** (`prices.SYP`, §3), worked out at this same rate:
  use those for products, and this `rate` only for a figure the shop quotes in dollars.

### How the customer receives it (`delivery.method`)

Offer these four:

| Offer as | `method` | Notes |
|---|---|---|
| Delivery in Aleppo (our team) | `driver` | Cash on delivery allowed |
| Another Syrian city | `office` | Sent with a transport office. The shop chooses which one. Pay before sending. |
| Abroad | `abroad` | Only countries in `countries` other than `SY`. Pay before sending. |
| Pick up from the shop | `pickup` | No address needed. Pay at the shop allowed. |

`courier` exists in the shop, but the shop chooses it. Don't offer it to customers.

### The delivery fee (an estimate; the shop confirms it)

For the chosen country, city and method, look through `shipping`:

1. Ignore rows for another country.
2. Ignore rows whose `method` is set but is not the chosen method.
3. Ignore rows whose city (`cityEn` or `cityAr`, compared case-insensitively after trimming)
   is set and does not match the customer's city.
4. Of what is left, prefer a row **with a city** over one without, then a row **with a method**
   over one without.

Then:

- The row's `fee` is in the row's own `currency`.
- If `customerPaysCourier` is true, the customer pays the fee to the courier on arrival. Show it,
  but **don't add it to the total**.
- If no row matches, show "Delivery price confirmed by phone" (Arabic in section 8).
- `shipping` may be empty today, because the shop has not filled in its price list yet. The
  checkout must still work.

### How the customer pays (`payment.type`)

- **`cod`** (cash on delivery, or cash at the shop for a pickup) is only allowed when the
  method is in `codAllowed` (`driver` or `pickup`). For every other method, hide the cash
  option. **When `cod` is `false` the owner has switched cash off on the website:
  `codAllowed` is empty and cash is not offered for any method** — transfer only.
- **`transfer`** (Sham Cash, or another transfer office) is allowed for every method:
  1. Show the methods in `transfer`, in their order and colour, and for the chosen one show
     its `details` in the page's language. Those details are the shop's own account text, so
     copy them exactly.
  2. The customer transfers the money and uploads **a photo or screenshot of the transfer
     receipt**, and may type the transfer number.
  3. The photo can come **with the order** or **later**, from their order page (section 7).
     Only offer methods that appear in `transfer`. If `transfer` is empty, offer cash only.
     If `transfer` is empty **and** `cod` is `false`, the shop is not taking payment on the
     website right now: show "Please message us to order" (§8) instead of the Order button.

### Print jobs

`print.unitPrice` (in `print.currency`) is the price of **one printed piece**. If it is
`null`, the shop has not set it yet, so show "Price confirmed by phone" and do not make one up.

`print.clubs` is the list of clubs the shop prints kits for. A print job's `clubCode` must be
one of these `code` values, copied exactly as given (they are lower-case, e.g. `bar`). A code
that is not on the list is not refused, but the shirt is then recorded with no club, so offer
clubs from this list rather than typing your own.

---

## 5. Placing the order — `web_order_submit`

```json
POST /rest/v1/rpc/web_order_submit
{ "p_key": "…", "p_order": { …the order below… }, "p_proof": null }
```

### The order (`p_order`), version 1

```json
{
  "v": 1,
  "ref": "W-10432",
  "lang": "ar",
  "customer": { "name": "نور الحلبي", "phone": "0933 123 456", "email": null },
  "delivery": {
    "method": "driver",
    "country": "SY",
    "city": "حلب",
    "address": "السريان، جنب الفرن، بناية ٣",
    "recipient": null,
    "phone": null,
    "note": "اتصلوا قبل ما توصلوا"
  },
  "payment": { "type": "cod" },
  "items": [
    { "sku": "OG-050-42", "productId": 50, "colourId": 3, "name": "Samba OG", "size": "42",
      "qty": 1, "price": 450000, "currency": "SYP" }
  ],
  "prints": [
    { "design": "Barcelona home 24/25", "clubCode": "bar", "note": null,
      "lines": [
        { "printName": "ZAVEN", "number": "10", "size": "L", "qty": 1 },
        { "printName": "ZOHRAB", "number": "7", "size": "M", "qty": 2 }
      ],
      "price": 2850, "currency": "SYP" }
  ],
  "shown": { "items": { "SYP": 450000 }, "prints": { "SYP": 2850 }, "shipping": { "SYP": 15000 } },
  "note": "Anything the customer wrote in the order's comment box"
}
```

| Field | Rule |
|---|---|
| `v` | Always `1`. |
| `ref` | **Your** order number. It must be unique forever. 3–40 characters: letters, digits, `-`, `_`, starting with a letter or digit. It is shown to the customer and to the shop, so keep it short (`W-10432`). |
| `lang` | `ar` or `en`: the language the customer used. The shop replies in it. |
| `customer.name` | Required, up to 80 characters. |
| `customer.phone` | Required, as typed. It must contain 7–15 digits. Syrian `09…`, `+963 9…`, `00963…`, Jordanian and Turkish numbers are all fine. |
| `customer.email` | Optional. |
| `delivery.method` | `driver`, `office`, `abroad` or `pickup` (see section 4). |
| `delivery.country` | Two-letter code (`SY`, `JO`, `TR`, …). Required unless `pickup`. |
| `delivery.city` | Required unless `pickup`, up to 80 characters. |
| `delivery.address` | Required unless `pickup`, 3–500 characters. |
| `delivery.recipient`, `delivery.phone` | Optional: when somebody else receives it. |
| `delivery.note` | Optional, for the driver. |
| `payment.type` | `cod` or `transfer`. `cod` only with `driver` or `pickup`. |
| `payment.method` | For `transfer` only: an `id` from `web_checkout.transfer` (e.g. `sham`). |
| `payment.reference` | Optional: the transfer number the customer typed. |
| `items[]` | Up to 40 lines. **`sku` and `qty` (1–20) are what count.** The SKU alone decides the product, the colour and the size (each colour of a size has its own SKU). `name`, `size`, `price` and `currency` are what the customer saw: the shop shows its own price and notes the one the customer saw when they differ. `productId` and `colourId` are accepted and not used. |
| `prints[]` | Up to 10 jobs. `design` is required. Then either `lines[]` (named shirts: `printName`, `number`, `size`, `qty` 1–50, up to 40 lines) or a plain `qty` (1–500) for unnamed pieces. `clubCode` (one of `web_checkout.print.clubs[].code`), `note`, `price`, `currency` are optional. The shop prices every print at `print.unitPrice`, never at the `price` sent. When `print.unitPrice` is `null` (the owner has not set it), show "price by phone": the job reaches the printer unpriced and the price is agreed on the call. |
| | At least one item **or** one print is required. |
| `shown` | Optional: totals **per currency**, exactly as the customer saw them. Never convert currencies into one total here. |
| `note` | Optional: the customer's comment. |

The whole order must be under **16 KB** of JSON, which leaves plenty of room.

### Sending it safely (read this twice)

1. **Build the order object once, save it (with its `ref`) in your database, then send it.**
2. If the call fails (timeout, network, a 5xx), **send the exact same saved object again**,
   with the same `ref` and every field identical. The shop recognises it and answers
   `{"ok": true, "replayed": true}` instead of making a second order. Retry for up to an
   hour, then keep the order flagged for a person to check.
3. **Never rebuild the object for a retry.** A changed field, such as a new timestamp, makes it
   a *different* order under the same `ref`, and the shop refuses it (`ref_taken`).
4. `ref_taken` on a first attempt means your numbering produced a duplicate. That is a bug on
   the website side: make a new `ref` and send again.

Answer:

```json
{ "ok": true, "ref": "W-10432", "state": "waiting", "placedAt": "2026-09-23T21:14:03Z" }
```

Then show the thank-you page (section 8): **"We've got your order, and we'll call you to
confirm it."**

### The transfer photo (`p_proof`)

- Compress it **in the browser** before uploading to your server: longest side ≤ 1280 px,
  JPEG quality about 0.7. Aim for about 300 KB.
- Send it as a **data URL**: `data:image/jpeg;base64,....` PNG and WebP are accepted too.
  Maximum 900 KB for the whole string. Anything else is refused (`bad_proof`).
- `p_proof` is **not** part of the order object, so a retry with or without it is still the
  same order.

---

## 6. Rules the shop enforces (show them before the customer presses Order)

| Code | When | Show the customer (EN / AR) |
|---|---|---|
| `bad_name` | name missing or too long | Please enter your name. / اكتب اسمك لو سمحت. |
| `bad_phone` | not 7–15 digits | Please check your phone number. / تأكّد من رقم الموبايل. |
| `bad_address` | no address for a delivery | Please write your full address. / اكتب العنوان كامل لو سمحت. |
| `bad_city` | no city | Please choose your city. / اختار مدينتك. |
| `bad_country` | not a two-letter code | (a website bug: fix the form) |
| `cod_not_here` | cash on delivery outside Aleppo or pickup | Cash on delivery is only in Aleppo. Please pay by transfer. / الدفع عند الاستلام بس بحلب — ادفع بتحويل لو سمحت. |
| `cod_off` | cash on delivery while the owner has it off (the page was older than the change) | Cash on delivery isn't available right now. Please pay by transfer. / الدفع عند الاستلام مو متاح هلّق — ادفع بتحويل لو سمحت. **Then call `web_checkout` again, redraw the payment choices, keep the cart.** |
| `method_gone` | a transfer method the website no longer offers (the owner changed it after the page loaded) | This payment method just changed. Please choose again. / طريقة الدفع هي تغيّرت هلّق — اختار من جديد لو سمحت. **Then call `web_checkout` again, redraw the payment choices, keep the cart and every field the customer typed.** |
| `bad_payment` | transfer without a method | Please choose how you'll transfer. / اختار طريقة التحويل. |
| `bad_proof` | the photo is not a JPEG, PNG or WebP, or is too big | That photo didn't work. Please try another. / الصورة ما زبطت — جرّب صورة تانية. |
| `empty` | nothing in the order | Your cart is empty. / السلة فاضية. |
| `bad_items`, `bad_prints`, `bad_delivery`, `bad_ref`, `unsupported`, `too_big` | the website sent something malformed | (a website bug: log it, and tell the customer "Something went wrong, please contact us") |
| `too_many` | 5 orders from this phone are already waiting | You already have orders waiting. We'll call you soon. / عندك طلبات لسّا عم تنتظر — رح نتصل فيك قريباً. |
| `full` | 2,000 orders waiting (should never happen) | We can't take orders right now. Please message us. / ما فينا ناخد طلبات هلّق — راسلنا لو سمحت. |
| `ref_taken` | see section 5 | (a website bug) |
| `bad_key` | the website key is wrong | (a setup problem: tell the shop) |

`field` in the answer names the field (e.g. `customer.phone`), so you can highlight it.

---

## 7. After the order

### Adding the transfer photo later — `web_order_proof`

```json
POST /rest/v1/rpc/web_order_proof
{ "p_key": "…", "p_ref": "W-10432", "p_proof": "data:image/jpeg;base64,…", "p_txn_ref": "TX-998877" }
```

- Replaces any earlier photo. It works only while the order is `waiting` or `received`.
- Codes: `not_found`, `decided` (the shop already accepted or rejected it), `bad_proof`,
  `too_many` (more than 20 photos).
- Put an **"Upload your transfer receipt"** button on the customer's order page while the
  order is paid by transfer and not decided yet.

### Where the order is now — `web_order_status`

```json
POST /rest/v1/rpc/web_order_status
{ "p_key": "…", "p_ref": "W-10432" }
```

```json
{
  "ok": true,
  "ref": "W-10432",
  "state": "accepted",
  "code": null,
  "placedAt": "2026-09-23T21:14:03Z",
  "decidedAt": "2026-09-24T09:40:11Z",
  "saleId": "INV-2150",
  "trackUrl": "https://og-track-production-aa0b.up.railway.app/i/3f9c…",
  "hasProof": true,
  "prints": [ { "id": "P-1043", "stage": "printing", "orderState": "accepted" } ]
}
```

Call it when the customer opens their order page. Don't poll it more often than once a
minute per order.

| `state` | Meaning | Show (EN / AR) |
|---|---|---|
| `waiting` | placed; the shop has not opened it yet | We've got your order. We'll call you to confirm it. / وصلنا طلبك ✔ رح نتصل فيك لنأكّد الطلب. |
| `received` | the shop has it and will call | Same as above. |
| `accepted` | confirmed. It is a real order now. | Your order is confirmed. / تأكّد طلبك ✔ plus a **"Track your order / تابع طلبك"** button to `trackUrl` (when it is not null). `saleId` is the shop's invoice number. |
| `rejected` | the shop said no | See `code` below. |

When `state` is `rejected`, `code` says why:

| `code` | Show (EN / AR) |
|---|---|
| `no_answer` | We couldn't reach you on your number. Please contact us. / ما قدرنا نوصلك على رقمك — تواصل معنا لو سمحت. |
| `out_of_stock` | Sorry, this item just sold out. / للأسف القطعة خلصت. |
| `customer_cancelled` | Your order was cancelled, as you asked. / انلغى الطلب متل ما طلبت. |
| `unpaid` | We didn't receive the transfer. Please contact us. / ما وصلنا التحويل — تواصل معنا لو سمحت. |
| `duplicate` | This order was a duplicate of another one. / هالطلب مكرّر مع طلب تاني. |
| `test` | (a test order: section 9) |
| anything else | We couldn't complete this order. Please contact us. / ما قدرنا نكمّل هالطلب — تواصل معنا لو سمحت. |

**Print jobs** (`prints[]`) go to Yalla Wear as soon as the shop collects the order. Each one
has:

- `orderState`:
  - `pending`: waiting for the print shop to accept (بانتظار المطبعة)
  - `accepted`
  - `declined`: say "We'll contact you" (رح نتواصل معك) and nothing more
- `stage`, in order: `design` (بالتصميم), `sent` (عند المطبعة), `printing` (عم ينطبع),
  `delivery` (بالطريق للمحل), `done` (جاهز).

Codes: `not_found`, `bad_key`.

---

## 8. Words to use (Syrian Arabic first, English beside it)

The website is Arabic first, with real right-to-left layout, and English one tap away.
Numbers, prices and order numbers stay in Western digits and must be isolated so Arabic
does not reorder them: `<bdi dir="ltr">450,000 SYP</bdi>`.

| Place | Arabic | English |
|---|---|---|
| Thank-you page | وصلنا طلبك ✔ رقم طلبك **W-10432**. رح نتصل فيك لنأكّد الطلب. | We've got your order ✔ Your order number is **W-10432**. We'll call you to confirm it. |
| Transfer box | حوّل المبلغ على الحساب التالي، وبعدين ارفع صورة إيصال التحويل. | Transfer the amount to the account below, then upload a photo of the receipt. |
| Upload button | ارفع صورة الإيصال | Upload the receipt |
| Delivery price unknown | سعر التوصيل منأكّدلك ياه على التلفون | Delivery price confirmed by phone |
| Print price unknown | السعر منأكّدلك ياه على التلفون | Price confirmed by phone |
| Courier fee | أجرة التوصيل بتندفع للمندوب عند الاستلام | Delivery fee is paid to the courier on arrival |
| Something went wrong | صار في مشكلة — جرّب كمان مرة أو تواصل معنا | Something went wrong. Please try again or contact us. |
| Payment choices changed while the page was open | طرق الدفع تغيّرت — اختار من جديد لو سمحت | The payment options changed. Please choose again. |
| No way to pay on the website right now | راسلنا لنكمّل طلبك | Please message us to order |

---

## 9. Testing without bothering the shop

- **Every test order's `ref` starts with `TEST-`** (e.g. `TEST-001`). The shop's screen marks
  them as tests, and the shop rejects them with code `test`. Never use `TEST-` for a real
  order.
- Test every row of section 6 by sending a bad order on purpose and checking the website
  shows the right message.
- Test a retry: send the same order twice and check the second answer has `"replayed": true`.
- Test with the laptop off (ask the shop): the products still show from your saved copy, and
  an order is still accepted as `waiting`.
- **Test a live change (v1.1)** with the shop on the phone: open the checkout, ask the owner to
  switch a transfer method off (or change its colour, or switch cash on delivery off) in OG
  System → Payment methods (its own page in the menu) and press Save. Within about a minute your open page
  shows the new choices without a reload (the `version` changed), and a fresh page shows them
  at once. Then pick the method that was taken away on a page that still shows it and press
  Order: the answer is `method_gone`, the page redraws the choices, and the cart is untouched.
  Do the same with cash on delivery for `cod_off`.

---

## 10. Do and don't

- ✅ Keep the three secrets on the server only.
- ✅ Save the order and its `ref` **before** sending it, and retry with the identical object.
- ✅ Show each product's `prices.SYP` large and `prices.USD` small (v1.3). Show totals per currency.
- ❌ Don't work the lira price out yourself, and don't keep a rate of your own for products.
- ✅ Refresh products every 5 minutes, and keep the last good copy.
- ✅ Read `web_checkout` every time a checkout opens (60 seconds of caching at most), and
  redraw an open checkout when its `version` changes.
- ✅ Show the shop's transfer details exactly as `web_checkout` gives them, in its order and
  colours.
- ❌ Don't hard-code a payment method, its account number, or its colour. They are the
  owner's, and he changes them from the shop.
- ❌ **Don't use `POST /api/ext/print-jobs`** (the old print door). Print jobs go **inside the
  order**, in `prints[]`, so the shop sees the whole order in one place.
- ❌ Don't show stock quantities, or invent a photo, a price, a delivery fee or a print price
  the shop did not give.
- ❌ Don't promise a delivery time. The shop confirms it on the call.
- ❌ Don't send cost prices or anything internal. The website never receives them, and never
  needs to.

## 11. Done means

- [ ] Products come from `web_products` (the laptop's `/api/ext/products` only as a fallback),
      refresh every 5 minutes, and still show with the laptop off.
- [ ] Every price shows `prices.SYP` large and `prices.USD` small, and follows a rate change
      without the website computing anything.
- [ ] Every product shows its photos in the order given (model, product, extras), `thumbUrl`
      in grids and `url` on the product page; picking a colour shows that colour's photos.
- [ ] Checkout reads `web_checkout` on every open (≤ 60 s cache): delivery options, fee
      estimate, cash only where allowed and only while `cod` is true, transfer methods in
      order with their colours and details, print price.
- [ ] An open checkout redraws itself when `version` changes, keeping the cart.
- [ ] `method_gone` and `cod_off` re-read the checkout and ask the customer to choose again.
- [ ] `web_order_submit` with a saved `ref` and safe retries, and every refusal shown in both languages.
- [ ] Transfer photo compressed and sent with the order or later (`web_order_proof`).
- [ ] Order page using `web_order_status`: the four states, rejection reasons, print progress,
      and the tracking button.
- [ ] All customer-facing text in Arabic (RTL) and English.
- [ ] Tested with `TEST-` orders, including a retry and the laptop being off.
