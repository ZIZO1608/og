# Website update — coupon codes (28 Sep 2026, contract v1.4)

For Ahmad, and the AI helping him. The shop now makes **coupon codes** in OG System (a page of
the owner's own), and a customer can use one at the till, in the order desk — and on the
website. This is the short list of what the website adds. Nothing was removed or renamed; a site
built on v1.3 keeps working and simply offers no coupon box.

## Before anything: the SQL

`server/supabase/038_coupons.sql` must be run in the Supabase SQL editor (after `030`), then
`verify_038_coupons.sql` — every row should say `ok`. Until then `web_coupon` does not exist and
the box below should stay hidden (the call answers 404).

## 1. Checking a code — `web_coupon`

A Supabase function like the others, with the website key:

```json
POST /rest/v1/rpc/web_coupon
{ "p_key": "…", "p_code": "og-eid25", "p_subtotal": 4500, "p_phone": "0933 123 456" }
```

| Parameter | Rule |
|---|---|
| `p_code` | What the customer typed. Case and spaces do not matter (`og eid25` is `OG-EID25`). |
| `p_subtotal` | Optional: **the goods in the basket, in US cents** (`prices.USD.amount × qty`, summed; no shipping, no prints). With it the minimum basket is checked and `discount` is worked out. |
| `p_phone` | Optional: the customer's phone. With it a once-per-customer code is checked against that customer. |

It answers:

```json
{ "ok": true, "code": "OG-EID25", "kind": "percent", "percent": 25, "amount": null,
  "currency": "USD", "minBasket": 3000, "oncePerCustomer": false,
  "expiresAt": "2026-10-05T20:59:59.999Z", "discount": 1125 }
```

- `kind` is `percent` (then `percent` is 1–100) or `amount` (then `amount` is **US cents**).
- `discount` is **US cents** off the goods, and only when you sent `p_subtotal`.
  A percent is `round(subtotal × percent / 100)`; an amount is never more than the goods.
- Show the lira figure the same way you show prices: `discount / 100 × web_checkout.rate`,
  rounded to the whole lira. **The shop works the real cut out again, in the order's own
  currency, when it accepts the order**: a percent code takes the same share off the goods, and
  an amount code the same dollars at the rate of that moment — so a lira figure can differ by
  the rate's movement in between, exactly as the prices themselves can.

Refusals — `{ "ok": false, "code": … }` — say one of these to the customer:

| `code` | Say |
|---|---|
| `bad_key` | (your key is wrong — never shown to a customer) |
| `coupon_unknown` | هالكود مو موجود · There is no such code |
| `coupon_off` | هالكود موقّف · This code is switched off |
| `coupon_not_yet` | هالكود لسا ما بلّش · This code has not started yet (`startsAt`) |
| `coupon_expired` | هالكود خلص · This code has ended |
| `coupon_used_up` | هالكود خلص عدده · This code has been used up |
| `coupon_min_basket` | الكود بدو طلب {minBasket} أو أكتر · The basket must be at least … (`minBasket`, US cents) |
| `coupon_used_by_customer` | استعملت هالكود قبل · You have already used this code |

## 2. Sending it with the order

Add **one optional field** to the order you already send to `web_order_submit`:

```json
{ "v": 1, "ref": "W-10432", …, "coupon": "OG-EID25", … }
```

- The code as `web_coupon` answered it (`code`). Send it only after `web_coupon` said `ok`.
- `shown` may carry the discount the customer saw, per currency, like everything else in it:
  `"shown": { "items": { "SYP": 621000 }, "discount": { "SYP": 155250 }, … }`.
- `web_order_submit` itself did not change. It keeps the whole order as you sent it, and the
  shop reads `coupon` when a person opens the order to accept it.

## 3. What happens at the shop

A person calls the customer, opens the order in the order desk, and the code is filled in and
checked there for real. If it was used up or ended in the meantime, the person sees why and
decides with the customer on the phone — the website is not told separately; the order's status
(`web_order_status`) moves as always.

## 4. Do and don't

- ✅ Check the code with `web_coupon` before showing any discount; re-check it when the basket
  changes (the minimum basket and the cut depend on it).
- ✅ Keep the discount a separate line on the summary, in both currencies.
- ❌ Never work out a coupon from a list of your own — the owner switches codes off and changes
  their limits from the shop, and `web_coupon` is the only answer that follows him.
- ❌ Do not send a code `web_coupon` refused.
