# Update for the website: a coupon arrives in the link (contract v1.7)

Ahmad, a short one.

**What changed in the shop.** Every coupon code now has a QR code. The owner prints them as
stickers and leaves them around the city. Whoever finds one scans it and lands on the shop's
page, `https://shop.ogsports1.com/c/OG-7K2QX`. That page has a big **Shop now** button, which
opens:

```
https://ogsports1.com/?coupon=OG-7K2QX
```

**What the website needs to do** (full text: `PROMPT-FOR-AHMAD.md` §5b):

1. On **any** page, read `coupon` from the address. Trim it, remove spaces and make it upper case.
   Ignore it unless it is 3–24 letters, digits or dashes.
2. Check it with `web_coupon` (no subtotal needed). Your coupon box already uses this.
3. If it is `ok`: put it in the cart as if the customer had typed it, and **open the cart** with
   one line:
   - EN: "Coupon OG-7K2QX added — 20% off"
   - AR: "انضاف الكوبون OG-7K2QX — خصم 20%"
4. If it is not `ok`: open the cart and say why, using the same words as for a typed code. For
   `coupon_used_up`, a street sticker means somebody got there first:
   - EN: "Someone already used this code"
   - AR: "حدا سبقك واستعمل هالكود"
5. Take `coupon` out of the address afterwards (`history.replaceState`), so a refresh does not
   add it twice.
6. If the cart is empty, open it anyway with the code kept and a "Choose something" button. The
   minimum basket is checked when products are added, as for a typed code.

**What does not change.** The order still sends the code as `coupon`, and the shop still checks
it when it accepts the order. There is no new Supabase file.

**How to test.** Open `https://ogsports1.com/?coupon=OG-AHMAD` (a real 10% code). The cart should
open with the code in it, and the address should lose `?coupon=…`.
