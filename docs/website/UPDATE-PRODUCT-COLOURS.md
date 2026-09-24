# Update for the OG Sports website: show every colour the shop adds

> **For Ahmad and the AI helping him build the website.** Paste this whole message in.
> Nothing changes in what OG System sends. The colours have been in `GET /api/ext/products`
> since the contract's first version (`PROMPT-FOR-AHMAD.md` §3). The website has to show them.

## What is wrong now

In OG System a product can come in several colours: a sneaker in red and in navy, a hoodie in
black and in white. **Each colour has its own photos, its own sizes and its own SKUs.** When the
owner adds a colour, the website does not show it: the product appears as one colour, or every
size appears twice, or the photos never change.

## What the shop already sends (a real product, today)

```json
{
  "id": 57,
  "name": "siki ba7 ba7",
  "price": 900, "currency": "SYP", "minorExp": 0,
  "photos": [ "…the FIRST colour's photos…" ],
  "sizes": [
    { "size": "39", "sku": "OG-057-39",    "colourId": 9,  "inStock": true },
    { "size": "39", "sku": "OG-057-C2-39", "colourId": 10, "inStock": true },
    { "size": "40", "sku": "OG-057-40",    "colourId": 9,  "inStock": true },
    { "size": "40", "sku": "OG-057-C2-40", "colourId": 10, "inStock": true }
  ],
  "colours": [
    { "id": 9,  "en": "sakalmbo",     "ar": "…", "hex": "#C62828",
      "imageUrl": "https://…-l.jpg",
      "photos": [ { "kind": "model", "url": "…", "thumbUrl": "…", "width": 1317, "height": 1194 },
                  { "kind": "product", "url": "…", "thumbUrl": "…", "width": 1278, "height": 1230 } ],
      "sizes": [ { "size": "39", "sku": "OG-057-39", "inStock": true },
                 { "size": "40", "sku": "OG-057-40", "inStock": true } ] },
    { "id": 10, "en": "siki ba7 ba7", "ar": "…", "hex": "#1F2A44",
      "imageUrl": "https://…-l.jpg",
      "photos": [ "…this colour's own model and product photos…" ],
      "sizes": [ { "size": "39", "sku": "OG-057-C2-39", "inStock": true },
                 { "size": "40", "sku": "OG-057-C2-40", "inStock": true } ] }
  ]
}
```

- **`colours[]` is the list to draw**, in the order given. Each colour has `id`, its name in both
  languages (`en`, `ar`), `hex` (the swatch colour, `#rrggbb`, or `null`), its own `photos`
  (model first) and its own `sizes`.
- **The same size has a different SKU in each colour**: `OG-057-39` is size 39 in the first
  colour and `OG-057-C2-39` is size 39 in the second. The SKU is how the shop knows which colour
  the customer bought.
- **The top-level `sizes` holds every colour's sizes mixed together**, so each size appears once
  per colour. That is why a size can appear twice on the page. Don't draw it as the size picker.
  Use the chosen colour's `sizes`, or filter the top-level list by `colourId`.

## What to build

1. **A colour picker on the product page** whenever `colours.length > 1`:
   - One round swatch per colour, filled with `hex`. When `hex` is `null`, use a neutral grey
     swatch.
   - The colour's name in the page's language (`ar` on the Arabic site, `en` on the English one)
     next to the swatches, and as each swatch's label for screen readers.
   - The first colour is chosen when the page opens, unless the link names one (step 5).
   - With one colour, show no picker. You may show its name as text.
2. **Choosing a colour changes three things together:**
   - the **photo gallery** switches to that colour's `photos` (model first, then product, then
     extras);
   - the **size buttons** come from that colour's `sizes`. A size with `inStock: false` is shown
     but greyed out and cannot be chosen;
   - a size already chosen stays chosen if the new colour has it in stock, and is cleared if not.
3. **Add to cart sends the SKU of the chosen colour and size** (from `colour.sizes[].sku`), plus
   `colourId`. In the order (`web_order_submit`, `items[]`), `sku` is what counts. `colourId` and
   the colour's name are shown to the shop for comparison.
4. **Every cart line, the checkout and the order page show the colour**: a small swatch and the
   colour's name beside the size. Two colours of one product in the cart are two separate lines.
5. **Links can open a colour**: `…/product/57?colour=10` opens the product page with colour 10
   chosen, its photos and its sizes. The product cards use this link (step 6).
6. **Product cards in the grid** show small swatch dots under the name when a product has more
   than one colour: up to 5 dots, then "+N". Tapping a dot opens the product page on that colour.
   On a desktop, hovering a dot may switch the card's photo to that colour's product photo.
7. **Only the colours in the answer exist.** A colour still waiting for its two photos is not
   sent at all, so it simply doesn't appear. When the 5-minute refresh no longer has a colour:
   - remove it from the page;
   - a cart line whose SKU is no longer in the list says "No longer available / ما عاد متوفر", and
     is left out of the order when it is sent.

## Words for the page

| Where | Arabic | English |
|---|---|---|
| Picker label | اللون | Colour |
| Chosen colour | اللون: {name} | Colour: {name} |
| Size out of stock (tooltip) | خلصان بهاللون | Out of stock in this colour |
| Cart line gone | ما عاد متوفر | No longer available |

## Done means

- [ ] A product with two or more colours shows a swatch for each, named in the page's language.
- [ ] Choosing a colour switches the photos and the sizes together, and no size appears twice.
- [ ] The cart and the order send the chosen colour's SKU. Test with product 57: size 39 in the
      second colour must send `OG-057-C2-39`, not `OG-057-39`.
- [ ] Every cart line, the checkout and the order page show the colour's swatch and name.
- [ ] `?colour=ID` opens the product on that colour, and the grid's swatch dots link there.
- [ ] A colour that disappears from the list disappears from the page, and from the cart with a
      message.
- [ ] Works in Arabic (RTL) and English, on a phone and a desktop.
