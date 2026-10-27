# Update for the website: offers (contract v1.9)

Ahmad, this one is for marketing.

**What changed in the shop.** The owner now puts sales on products from a page of their own in
OG System:

- a percent off, dollars off, a fixed sale price, or **buy X, get Y** (free or at a percent off);
- on one product, a few, a brand, a category, or the whole shop (with some left out);
- from a start to an end date and time — or a **flash sale** of only so many pieces.

The till and the order desk already charge it. The website needs to show it.

**What the website needs to do** (full text: `PROMPT-FOR-AHMAD.md` §3c):

1. **Every product now has `offer`** (in `web_products` and `web_product`). `null` = no sale.
   Otherwise show a badge (`−25%`, or `2+1`), the normal price struck, `offer.prices` big beside
   it, and a countdown to `offer.endsAt`. A flash sale has `left`: "only 12 left at this price".
2. **The cart** follows the shop's rule: per-piece offers at `offer.prices`; for buy X get Y, every
   `buy + get` pieces of that same offer make the **cheapest** `get` pieces cheaper (100% = free).
   Show "Offers saved / وفّرت العروض" in the cart.
3. **Coupons:** when `stackCoupons` is `false`, send `web_coupon` the subtotal **without** those
   pieces. All pieces under such offers → "This code does not work on items already on offer /
   هالكود ما بيمشي عالقطع اللي عليها عرض".
4. **An offers page** (optional, recommended): **`web_offers`** lists live, coming and sold-out
   offers with their cover picture, dates and `productIds`.
5. The order is sent **as before** — SKUs and quantities, never a price. The shop prices it again.

**When it changes:** the shop calls your `/api/og/catalog-changed` the moment an offer starts,
ends, changes or sells out. Reload both doors then, and when a countdown reaches zero.

**Words:**

| | English | العربي |
|---|---|---|
| badge | −25% · 2+1 | −25% · 2+1 |
| countdown | Ends in 2d 04:13 | بيخلص بعد 2ي 04:13 |
| flash | Only 12 left at this price | باقي 12 بس بهالسعر |
| cart | Offers saved | وفّرت العروض |
| free piece | Free | ببلاش |

Nothing was removed or renamed: `price` and `prices` are still the normal price.
