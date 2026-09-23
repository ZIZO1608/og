# OG Sports website ↔ OG System — connecting the orders (contract v1)

> **For Ahmad, and for the AI helping him build the OG Sports website.**
> Paste this whole file in as the brief. It is the contract between the website and the
> shop's system (OG System). The shop side is being built to exactly this. If something
> here does not fit the website, ask before changing it. Do not work around it: both sides
> have to agree.

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
| **Products** (read-only) | `GET https://shop.ogsports1.com/api/ext/...` | Only while the shop laptop is on and online |
| **Orders, checkout info, order status** | Supabase functions (`POST {SUPABASE_URL}/rest/v1/rpc/...`) | Always |

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

### `GET /api/ext/products`

Returns **the whole published catalogue** in one answer:

```json
{
  "products": [
    {
      "id": 50,
      "name": "Samba OG",
      "brand": "Adidas",
      "type": "sneakers",
      "category": { "id": "sneakers", "en": "Sneakers", "ar": "أحذية رياضية" },
      "colorway": "Cloud White / Core Black",
      "madeIn": "Vietnam",
      "image": { "bg": "#1E293B", "initials": "SO", "url": "https://…/product-images/products/50/….jpg" },
      "price": 450000,
      "currency": "SYP",
      "minorExp": 0,
      "sizes":   [ { "size": "42", "sku": "OG-050-42", "colourId": 3, "inStock": true } ],
      "colours": [
        { "id": 3, "en": "White", "ar": "أبيض", "hex": "#F5F5F5", "imageUrl": null,
          "sizes": [ { "size": "42", "sku": "OG-050-42", "inStock": true } ] }
      ],
      "inStock": true,
      "updatedAt": "2026-09-20T11:02:00.000Z"
    }
  ],
  "count": 1,
  "generatedAt": "2026-09-23T10:00:00.000Z"
}
```

Rules:

- **Keep your own copy and refresh it every 5 minutes.** When the shop answers, **replace
  your whole list** with the new one. A product that is missing from the new list has been
  taken off the website by the shop. Hide it. There is no "changes since" feed on purpose.
- **When the shop does not answer** (laptop off, internet down), keep showing your last good
  copy. The shop checks stock by phone before confirming anyway.
- **A size is identified by its `sku`.** That is what you send back in an order. Sizes with
  `inStock: false` are shown but not buyable. Quantities are deliberately never sent.
- **Colours:** a product may have several colours (`colours[]`), each with its own sizes,
  SKUs and photo. When there is only one colour, you don't need to show a colour picker.
- **Photos:** `image.url` (or a colour's `imageUrl`) when there is one. When there is none,
  draw a coloured block with `image.bg` and `image.initials`. Never use stock photos.
- **Money is in minor units.** Displayed amount = `price / 10^minorExp`. SYP has
  `minorExp` 0 (whole lira: `450,000 SYP`). USD has 2 (cents: `2500` → `$25.00`).
  **Some products are priced in USD and some in SYP.** Show each in its own currency and
  never convert it silently.
- `GET /api/ext/products/:id` returns `{ "product": {...} }` for one product, or 404 if it is
  not published.
- `GET /api/ext/reviews?limit=50` returns delivery reviews the customer allowed **and** the
  shop approved, if you want a reviews section.

---

## 4. Checkout: what the shop ships, charges, and accepts

### `web_checkout` — call it when the checkout opens (cache it for 10 minutes)

```json
POST /rest/v1/rpc/web_checkout      { "p_key": "…" }
```

It answers from the shop's own Settings, so it works with the laptop off:

```json
{
  "ok": true,
  "baseCurrency": "SYP",
  "currencies": [ { "code": "SYP", "minorExp": 0 }, { "code": "USD", "minorExp": 2 } ],
  "rate": { "base": "USD", "quote": "SYP", "rate": 130, "at": "2026-08-24T10:00:00Z" },
  "travel": ["driver", "office", "courier", "abroad", "pickup"],
  "codAllowed": ["driver", "pickup"],
  "countries": [ { "id": "SY", "en": "Syria", "ar": "سوريا", "currency": "SYP", "dial": "963" } ],
  "shipping": [
    { "country": "SY", "cityEn": "Aleppo", "cityAr": "حلب", "method": "driver",
      "fee": 15000, "currency": "SYP", "customerPaysCourier": false }
  ],
  "transfer": [
    { "id": "shamcash", "en": "Sham Cash", "ar": "شام كاش",
      "details": { "en": "Sham Cash 0933 … — OG Sports", "ar": "شام كاش 0933 … — أو جي" } }
  ],
  "print": { "unitPrice": 950, "currency": "SYP" }
}
```

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
  option.
- **`transfer`** (Sham Cash, or another transfer office) is allowed for every method:
  1. Show the methods in `transfer`, and for the chosen one show its `details` in the page's
     language. Those details are the shop's own account text, so copy them exactly.
  2. The customer transfers the money and uploads **a photo or screenshot of the transfer
     receipt**, and may type the transfer number.
  3. The photo can come **with the order** or **later**, from their order page (section 7).
     Only offer methods that appear in `transfer`. If `transfer` is empty, offer cash only.

### Print jobs

`print.unitPrice` (in `print.currency`) is the price of **one printed piece**. If it is
`null`, the shop has not set it yet, so show "Price confirmed by phone" and do not make one up.

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
    { "design": "Barcelona home 24/25", "clubCode": "BAR", "note": null,
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
| `payment.method` | For `transfer` only: an `id` from `web_checkout.transfer` (e.g. `shamcash`). |
| `payment.reference` | Optional: the transfer number the customer typed. |
| `items[]` | Up to 40 lines. **`sku` and `qty` (1–20) are what count.** `productId`, `colourId`, `name`, `size`, `price` and `currency` are what the customer saw, shown to the shop for comparison. |
| `prints[]` | Up to 10 jobs. `design` is required. Then either `lines[]` (named shirts: `printName`, `number`, `size`, `qty` 1–50, up to 40 lines) or a plain `qty` (1–500) for unnamed pieces. `clubCode`, `note`, `price`, `currency` are optional. |
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

---

## 10. Do and don't

- ✅ Keep the three secrets on the server only.
- ✅ Save the order and its `ref` **before** sending it, and retry with the identical object.
- ✅ Show prices in the product's own currency. Show totals per currency.
- ✅ Refresh products every 5 minutes, and keep the last good copy.
- ✅ Show the shop's transfer details exactly as `web_checkout` gives them.
- ❌ **Don't use `POST /api/ext/print-jobs`** (the old print door). Print jobs go **inside the
  order**, in `prints[]`, so the shop sees the whole order in one place.
- ❌ Don't show stock quantities, or invent a photo, a price, a delivery fee or a print price
  the shop did not give.
- ❌ Don't promise a delivery time. The shop confirms it on the call.
- ❌ Don't send cost prices or anything internal. The website never receives them, and never
  needs to.

## 11. Done means

- [ ] Products come from `/api/ext/products`, refresh every 5 minutes, survive the laptop being off.
- [ ] Checkout reads `web_checkout`: delivery options, fee estimate, cash only where allowed,
      transfer details, print price.
- [ ] `web_order_submit` with a saved `ref` and safe retries, and every refusal shown in both languages.
- [ ] Transfer photo compressed and sent with the order or later (`web_order_proof`).
- [ ] Order page using `web_order_status`: the four states, rejection reasons, print progress,
      and the tracking button.
- [ ] All customer-facing text in Arabic (RTL) and English.
- [ ] Tested with `TEST-` orders, including a retry and the laptop being off.
