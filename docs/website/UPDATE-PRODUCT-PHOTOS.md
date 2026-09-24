# Update for the OG Sports website: every product now has real photos

> **For Ahmad and the AI helping him build the website.** Paste this whole message in.
> It is a small change to the existing contract (`PROMPT-FOR-AHMAD.md`, now **v1.2**). Nothing
> you already built stops working: no field was removed or renamed. Four things change.

## What the shop now does

In OG System, every **colour** of every product has its own photos, taken by the shop:

1. **Photo 1: the model photo.** Somebody wearing it. Always shown first.
2. **Photo 2: the product photo.** The product on its own. Always shown second.
3. **Extra photos** (optional, up to 8): other angles and details.

The owner's rule: **a colour is published only once it has photos 1 and 2.** A colour still
waiting for its photos is left out of `/api/ext/products` completely (its swatch, sizes and
SKUs). A product with no colour ready is not in the list at all, as if it were switched off.
The shop can still sell it in the shop; it just isn't on the website yet.

The files are on the shop's Supabase Storage (public HTTPS), so **they load even when the
shop's laptop is off**.

## 1. Read the new `photos` list

Every product and every colour in `GET /api/ext/products` (and `/api/ext/products/:id`) now
has `photos`, **already in display order**. Don't sort it.

```json
{
  "id": 50,
  "name": "Samba OG",
  "image": { "bg": "#1E293B", "initials": "SO", "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg" },
  "photos": [
    { "kind": "model",   "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1280, "height": 1600 },
    { "kind": "product", "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1600, "height": 1600 },
    { "kind": "extra",   "url": "https://…-l.jpg", "thumbUrl": "https://…-s.jpg", "width": 1600, "height": 1200 }
  ],
  "colours": [
    { "id": 3, "en": "White", "ar": "أبيض", "hex": "#F5F5F5", "imageUrl": "https://…-l.jpg",
      "photos": [ { "kind": "model", "…": "…" }, { "kind": "product", "…": "…" } ],
      "sizes": [ { "size": "42", "sku": "OG-050-42", "inStock": true } ] }
  ]
}
```

- `kind` is `model`, `product` or `extra`. The first two are always there.
- **`url`** is the large file (at most 1600 px on the long side), for the product page and
  zoom. **`thumbUrl`** is the small file (at most 480 px), for grids, the cart and the order
  page. Use the small one wherever the photo is small: the customer is often on mobile data.
- `width` and `height` are the large file's size, so you can reserve the space before it
  loads. They can be `null` on an old photo.
- The product's `photos` are its **first colour's** photos. `image.url` / `image.thumbUrl` and
  each colour's `imageUrl` are kept for v1.1 and are the model photo.

## 2. Show them

- **Product card (grid):** show the **product photo** (`kind: "product"`, its `thumbUrl`), and
  switch to the **model photo** on hover (desktop). On a phone, show the product photo.
- **Product page:** a gallery of the chosen colour's `photos`, in the order given, starting with
  the model photo. Swipe on a phone, thumbnails underneath on a desktop.
- **Colour picker:** when the customer picks a colour, the gallery shows **that colour's**
  `photos`, and the sizes come from that colour.
- Only the colours in the answer can be chosen. Don't show a colour, size or SKU you remember
  from an older copy.

## 3. Allow the image host

The photos come from `https://<project>.supabase.co/storage/v1/object/public/product-images/…`
(the same project as `OG_SUPABASE_URL`). If your framework needs image hosts listed (Next.js
`images.remotePatterns`, a Content-Security-Policy `img-src`), add that host.

## 4. Don't keep old photo addresses

When the shop replaces a photo, the new one gets **a new address and the old file is
deleted**. Keep photo URLs only as part of your 5-minute product copy: replace the whole list
every refresh, as the contract already says. A photo URL cached for a day will be a broken
image.

## Done means

- [ ] Grid cards use `thumbUrl`, the product photo first and the model photo on hover.
- [ ] The product page shows the chosen colour's `photos` in the order given, model first.
- [ ] Picking a colour switches the photos and the sizes.
- [ ] The Supabase Storage host is allowed, and photos load with the shop's laptop off.
- [ ] Nothing shows a photo URL older than the latest product refresh.
- [ ] A product or colour missing from the answer is simply not shown (no "coming soon").
