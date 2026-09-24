# Website update — prices are dollars, the lira comes ready, products come from the cloud (25 Sep 2026)

For Ahmad. The contract is now **v1.3** (`PROMPT-FOR-AHMAD.md` §2, §3, §10, §11). Nothing was
removed or renamed, so the site keeps working while you make these changes.

## What changed in the shop

- **Every product is priced in US dollars.** The owner enters dollars, and the lira price is
  the dollar price at the shop's rate of the moment. That rate follows the market feed by itself
  (see `UPDATE-EXCHANGE-RATE.md`), so a product's lira price moves with the dollar without
  anybody touching the product.
- **The till charges that lira price.** What the website shows and what the shop charges are
  the same number, worked out by the same rule (dollars × rate, rounded to the whole lira).

## What the website must change

1. **Read the products from Supabase, not from the shop laptop.** Call the function
   `web_products` exactly like the order functions (`og('web_products', {})` with the helper in
   §2), and `web_product` with `p_id` for one product. It answers **even when the laptop is
   off**. The answer is the same as `/api/ext/products`, plus `ok` and `version`. Keep the
   laptop door only as a fallback, or drop it.
2. **Show two prices on every product:** `prices.SYP.amount` **large** (`4,829 ل.س`) and
   `prices.USD.amount / 100` **small** beside it (`$34.99`).
3. **Never work the lira out yourself.** Don't multiply by `web_checkout.rate` for a product,
   and don't keep a rate of your own. The lira price arrives ready and follows the rate within
   seconds.
4. **Refresh every 5 minutes** as before. `version` changes exactly when something shown changed
   (a price, the rate, a photo, a size selling out), so an unchanged `version` means nothing to
   redraw.
5. **Cart and order:** add up the `prices.SYP.amount` figures. Send them as each item's `price`
   with `currency: "SYP"`, and in `shown`. The shop prices every line again when it accepts the
   order.
6. `prices.SYP.amount` is `null` only if the shop has no rate at all. Then show the dollar price
   alone.

## Before you switch

The shop runs one SQL file once in the Supabase SQL editor: `server/supabase/037_web_products.sql`,
then `verify_037_web_products.sql` (every row ✅). Until then `web_products` answers
`404 PGRST202`. Keep using `/api/ext/products` until the owner says it is done.
