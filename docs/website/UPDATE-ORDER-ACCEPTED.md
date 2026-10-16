# Update for the website: the shop tells you when an order is accepted (contract v1.8)

Ahmad, a short one.

**What changed in the shop.** When somebody in the shop presses **Accept** (or **Reject**) on a
website order, the shop now calls the website straight away instead of waiting for the website
to ask. The owner wants the customer's order to turn **Confirmed** at that moment, and the
customer to get a notification.

**The call** (full text: `PROMPT-FOR-AHMAD.md` §7a):

```
POST https://<your site>/api/og/order-changed
Authorization: Bearer <OG_WEB_API_KEY>      ← the same key as catalog-changed
{ "event": "order_changed", "ref": "W-1A2B3C", "state": "accepted", "code": null,
  "saleId": "INV-2184", "trackUrl": "https://…", "total": {…}, "decidedAt": "…",
  "message": { "title": { "ar": "…", "en": "…" }, "body": { "ar": "…", "en": "…" } } }
```

**What the website needs to do:**

1. Check the key. If it is wrong, answer `401`. Otherwise answer `200 {"ok": true}` at once.
2. Reload that order with `web_order_status`. That answer is the truth; don't trust the body
   alone.
3. Update the order page: **Confirmed** with the **Track your order / تابع طلبك** button, or the
   rejection words you already have for each `code`. If the customer has the page open, update
   it live.
4. Notify the customer in their language: push if they allowed it, email if you have it. The
   words are ready in `message.title` and `message.body`.
5. Notify only once per `ref` + `state`. The shop may send the same news twice (a retry, or a
   "Tell the website again" button in the shop). Answer `200` to the repeat and don't send a
   second notification.

There is no name or phone in the call. Use the order you already have under `ref`.

Once the door is live, the shop's Website orders screen shows a third tick, **"The customer was
notified"**, on every accepted order. Until then it shows "the website has not built this yet".
