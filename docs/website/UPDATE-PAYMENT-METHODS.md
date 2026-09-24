# Update for the OG Sports website: payment methods are now live from the shop

> **For Ahmad and the AI helping him build the website.** Paste this whole message in.
> It is a small change to the existing contract (`PROMPT-FOR-AHMAD.md`, now v1.1). Nothing
> you already built stops working: no field was removed or renamed. Four things change.

## What the shop can now do

From OG System — its own **Payment methods** page in the menu — the owner decides:

1. **Which transfer methods the website offers.** Each method (Sham Cash, Fuad, Haram, …) has
   an **"On the website"** switch. It can only be switched on once the account the customer
   sends money to is written in both Arabic and English, so the website never gets an empty one.
2. **A colour for each method's button** (one of a fixed palette, or none).
3. **Whether cash on delivery is offered on the website at all.**

When he presses Save, the change is in Supabase within about 2 seconds, and OG System reads it
back through the same `web_checkout` you call, then shows him **"Live on the website ✓"**. So
if your checkout still shows the old methods, the problem is on the website side. The four
changes below are what make it appear on the website straight away.

## 1. Read `web_checkout` every time a checkout opens

The old rule was "cache it for 10 minutes". **It is now "at most 60 seconds".** Call it when a
customer opens the checkout (your server may reuse an answer that is less than 60 seconds old).

The answer has four new fields:

```json
{
  "ok": true,
  "cod": true,
  "codAllowed": ["driver", "pickup"],
  "transfer": [
    { "id": "sham", "en": "Sham Cash", "ar": "شام كاش", "color": "#16a34a",
      "details": { "en": "Sham Cash 0933 … — OG Sports", "ar": "شام كاش 0933 … — أو جي" } },
    { "id": "fuad", "en": "Fuad", "ar": "فؤاد", "color": null,
      "details": { "en": "Fuad office, Aleppo — OG", "ar": "مكتب فؤاد، حلب — أو جي" } }
  ],
  "version": "3f1c9a0e5b7d2c4a8e6f1b3d5a7c9e0f",
  "updatedAt": "2026-09-24T11:12:58.410Z",
  "…": "everything else exactly as before"
}
```

| Field | Meaning |
|---|---|
| `cod` | `false` = the owner switched cash on delivery off. `codAllowed` is then `[]`. Offer transfer only. |
| `transfer[].color` | The button colour, `#rrggbb` (lower case), or `null` = your normal button. |
| `transfer` order | The owner's order. Show them in this order. |
| `version` | Changes exactly when anything in this answer changes, and never otherwise. |
| `updatedAt` | When the owner last changed one of the settings behind it. It does not move when the rate moves by itself (`version` does). For display or logs only. |

`details.en` / `details.ar`: copy them exactly, in the page's language. Older data can have one
of the two `null`: show the other one.

## 2. Keep an open checkout up to date

While a checkout page is open, have the browser ask **your server** every 60 seconds for the
current `version` (your server calls `web_checkout`, cached at most 60 s). If it differs from
the version the page was drawn with:

- redraw the delivery and payment choices,
- **keep the cart and everything the customer has typed**,
- if the method they had selected is no longer in `transfer` (or cash is gone), clear only that
  choice and show: **"The payment options changed. Please choose again." / "طرق الدفع تغيّرت —
  اختار من جديد لو سمحت"**.

The keys stay on your server as before. The browser never calls Supabase.

## 3. Draw the methods with their colours

For each item in `transfer`, one selectable card or button:

- the name in the page's language (`ar` first on the Arabic site),
- the colour as its accent: a coloured border or dot, and the selected state filled with it.
  Keep the text readable (white text on the filled colour).
- when selected: its `details` in the page's language, the upload-receipt button, and the
  optional transfer-number box (unchanged from v1).

Cash on delivery: show it only when `cod` is `true` **and** the chosen delivery method is in
`codAllowed`. If `transfer` is empty and `cod` is `false`, the shop is not taking payment on
the website right now: replace the Order button with **"Please message us to order" /
"راسلنا لنكمّل طلبك"**.

Never hard-code a method, an account number or a colour. They belong to the owner.

## 4. Two new answers from `web_order_submit`

If the owner changes the methods after the customer's page loaded, the order is refused with a
clear code instead of being placed on a method the shop no longer takes:

| `code` | `field` | Show (EN / AR) | Then |
|---|---|---|---|
| `method_gone` | `payment.method` | This payment method just changed. Please choose again. / طريقة الدفع هي تغيّرت هلّق — اختار من جديد لو سمحت. | Call `web_checkout` again, redraw the payment choices, keep the cart and every field. A refused order is **not stored**, so the same `ref` can be sent again with the new choice. |
| `cod_off` | `payment.type` | Cash on delivery isn't available right now. Please pay by transfer. / الدفع عند الاستلام مو متاح هلّق — ادفع بتحويل لو سمحت. | Same: re-read the checkout, offer transfer. |

A retry of an order that was already placed before the change still answers
`{"ok": true, "replayed": true}`. The retry rule in §5 of the contract is unchanged.

## Minimal server-side example (Node)

```js
// Cached at most 60 s. og() is the helper from the contract (§2).
let checkout = null, fetchedAt = 0;
export async function getCheckout() {
  if (checkout && Date.now() - fetchedAt < 60_000) return checkout;
  try {
    const r = await og('web_checkout', {});
    if (r.ok) { checkout = r; fetchedAt = Date.now(); }
  } catch (e) { console.error('web_checkout', e); }   // keep the last good answer
  return checkout;                                      // may be null on the very first failure
}

// GET /api/checkout/version  → the browser polls this every 60 s while the checkout is open
export async function checkoutVersion(req, res) {
  const c = await getCheckout();
  res.json({ version: c ? c.version : null });
}

// When placing the order
const r = await og('web_order_submit', { p_order: order, p_proof: proof });
if (!r.ok && (r.code === 'method_gone' || r.code === 'cod_off')) {
  fetchedAt = 0;                        // force a fresh web_checkout
  const fresh = await getCheckout();
  return res.status(409).json({ code: r.code, checkout: fresh });   // the page redraws, cart kept
}
```

## How to test it (with the shop on the phone)

1. Open the checkout. Ask the owner to switch a method off the website (or change its colour,
   or switch cash on delivery off) and press Save. OG System shows "Live on the website ✓".
2. Within about a minute your open page shows the new choices **without a reload**, the cart is
   still there. A freshly opened checkout shows them at once.
3. On a page that still shows the removed method, pick it and press Order: `method_gone`, the
   choices redraw, nothing in the cart is lost. Do the same for `cod_off`.
4. Switch it back on: it reappears in its colour.
5. Use `TEST-` refs for every test order (contract §9).

## Done means

- [ ] `web_checkout` read on every checkout open, cached 60 s at most, last good answer kept on failure.
- [ ] Transfer methods drawn in the owner's order and colours, details copied exactly, Arabic first.
- [ ] Cash on delivery only while `cod` is `true` and for `driver` / `pickup`.
- [ ] An open checkout redraws itself when `version` changes, and keeps the cart.
- [ ] `method_gone` and `cod_off` handled: re-read, redraw, keep the cart, bilingual message.
- [ ] "Please message us to order" when there is no way to pay on the website.
- [ ] Tested live with the owner, as above.
