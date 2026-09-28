# Website update — descriptions, "goes well with", and the shop calls you (29 Sep 2026, contract v1.5)

For Ahmad, and the AI helping him. This answers your request of 28 Sep ("descriptions, goes well
with, and telling the website when products change"). All three are built on the shop's side, as
you asked, with every new field optional: a site that does not read them keeps working. The full
contract is `docs/website/PROMPT-FOR-AHMAD.md` (v1.5, §3 and §3a); this is the short list.

## Before anything: the SQL

Run `server/supabase/040_product_web_extras.sql` in the Supabase SQL editor (after `037`), then
`verify_040_product_web_extras.sql`: every row should say ✅ (row 6 says ⚠️ only while no product
is published). Until it is run, `web_products` still answers, with `description: null` and
`pairsWith: []` on every product. The shop's laptop door (`/api/ext/products`) has both fields
already.

## 1. `description` on every product — done

```json
"description": { "en": "Soft cotton hoodie with a brushed inside.", "ar": "هودي قطن ناعم من جوّا." }
```

Exactly as you asked: plain text, `\n` kept, either language may be `null`, the whole field `null`
when there is none. One per **product**. The owner types it in OG System (the product's
"On the website" card → Edit). **At most 1,500 characters per language**; a longer one is
refused when it is saved, never cut.

## 2. `pairsWith` on every product — done

```json
"pairsWith": [57, 61, 12]
```

Product ids, the owner's order, at most 12, `[]` when he chose none (never missing). The owner
picks them with a search in the same dialog. **Only ids of products that exist**: a product that
is deleted leaves every list by itself. A product that is off the website today (waiting for its
photos, or switched off) may stay on a list, as you said, so skip ids you do not have or that are
out of stock.

## 3. The shop calls `POST /api/og/catalog-changed` — done

```http
POST https://<your site>/api/og/catalog-changed
Authorization: Bearer <OG_WEBSITE_KEY>
Content-Type: application/json

{ "reason": "product_saved", "productIds": [57] }
```

What we decided on our side, so you know what to expect:

- **The key** is the website key (`OG_WEB_API_KEY` on the shop's server, your `OG_WEBSITE_KEY`).
- **One call about 5 seconds after the last change**, and only when what `web_products` answers
  actually changed. A sale that leaves a size in stock sends nothing; selling the last pair does;
  a new exchange rate does (every lira price moved), with `reason: "rate_changed"`.
- **Sent after the cloud copy has the change** (usually 2–5 seconds after the save), because your
  site reads `web_products` from the cloud. So when you fetch, the change is there.
- **`reason`**: `product_saved` (with `productIds`, at most 100), `rate_changed`, `catalog_changed`,
  or `test`. For your logs only — refresh the whole list for any of them.
- **Retries**: 30 s, 2 min, 5 min after a network error, a timeout (10 s) or a 5xx, then it stops.
  A `401`/`403`, a `404` or a redirect is not retried, and **a redirect is never followed** (it
  would carry the key). So give us the exact address your site answers on.
- It is sent by the shop's main server (the VPS), whether or not the shop's laptop is open.

## What we need from you

**Your site's address** — your `NEXT_PUBLIC_SITE_URL`, e.g. `https://ogsports1.com`. We put it in
OG System → Settings → Advanced → Website (https only, nothing after the name). That screen has a
**Tell the website now** button: it sends a `test` call and shows what your site answered — a
quick way to check the key and the door together.

## How we tested it

- 11 server checks (`server/test/web-extras.test.js`): what is cleaned and refused, what the
  website receives, a deleted product leaving every list, the address rules, and the call — once
  per change, not for a change nobody sees, retried on a 500, not on a 401, never following a
  redirect.
- The laptop's answer and the cloud's compared field for field on the same products, in Postgres
  (PGlite running every cloud file): descriptions in one language, both and none; lists with an
  archived product, a deleted one and garbage; the cloud with 037 but not 040; each file run twice.
- In a browser (54 checks, English on a desk and Arabic on a phone): the owner typing a
  description and choosing, ordering and removing products, the result read back from the
  database, the products door serving it, and a stand-in for your site receiving exactly one call
  with the right key and the right product.
