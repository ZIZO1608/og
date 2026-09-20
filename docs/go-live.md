# Putting the shop online — the safe order

Written for whoever does it, at the laptop and at a browser. Four phases,
newest risk last. Each one is useful on its own and none of them depends on
the next, so you can stop after any of them.

> **The shape, in one line.** The shop's own system stays on the laptop in
> Aleppo — that is what makes the till work when the internet dies — and a
> small proxy on the VPS makes that same server reachable at
> `shop.ogsports1.com`. The apex, `ogsports1.com`, is somebody else's job:
> it already runs the online store. There is never a second copy of the
> shop's data.

---

## Why the server stays in the shop

Three things happen on **every single sale**, and all three go through the
server:

1. **The price.** `Sales.record` reads it from the product table. The browser
   is never allowed to name a price — a till that can is a till that sells a
   450,000 pair for 1,000 and leaves an ordinary-looking receipt.
2. **The stock.** `CHECK (qty >= 0)` runs inside the same transaction as the
   sale.
3. **The receipt.** The browser rasterises it and POSTs the bytes to
   `/api/print`; the **server** hands them to the printer.

A server the till cannot reach means no price, no stock check and no paper. So
a till that must survive an outage needs its server in the same room. With the
server on a VPS, an outage stops the shop selling; with it on the laptop, an
outage stops nothing but the view from outside.

---

## Phase 1 — the public page  ·  the domain is already taken, by a real store

`ogsports1.com` **already serves a working online store** — a Next.js
application with a cart, a checkout and sign-in, on this same VPS, its
certificate already issued. Found on 20 Sep 2026 by asking the domain rather
than by being told about it.

So the static page in `site/` **is not deployed, and must not be**. Pointing a
second Coolify application at that domain would leave two of them claiming it;
the best case is a failed deploy and the worst is the store going dark. A
one-page site could not out-rank a store with product pages anyway.

`site/` stays in the repository as a working reference for the parts the store
may still be missing — the bilingual `hreflang` pair, the
`SportingGoodsStore` structured data, and a `robots.txt` that names the AI
crawlers one by one. `site/README.md` explains each.

**The useful work on that store is a different job**, and the biggest piece of
it is a door the POS has had built for exactly this purpose which nothing has
ever called:

```
GET /api/ext/products      the published catalogue, behind OG_WEB_API_KEY
```

Real products, real sizes, real prices, an `inStock` flag per size, with
archived lines and anything not marked for the web filtered out. A store fed
from it stops advertising a pair that was sold in the shop an hour ago.

---

## Phase 2 — the tunnel  ·  ~45 min  ·  low risk, one gate

> **The step-by-step is [deploy/shop-proxy/README.md](../deploy/shop-proxy/README.md)**,
> which is the route actually taken: Tailscale between the laptop and the VPS,
> and a small nginx proxy in Coolify holding the name. Cloudflare Tunnel was
> the first plan and was dropped — it needs the whole zone on Cloudflare, and
> moving nameservers under a live store is a risk taken for nothing.

This puts the shop's own system back on the internet. It was there before,
through the same hostname, until 16 Sep 2026.

**2.0 The gate — check it, do not assume it.** The shop was once on the public
internet while five accounts shared a password that is still in this
repository's git history. Run this on the laptop and read the output:

```bash
cd server && npm run preflight
```

It names any of `hussam` `lubna` `maher` `talal` `yalla` that still exists and
is active. **Checked on 20 Sep 2026: all five are gone**, the account list is
the 12 real people plus the hidden Former-staff record. If that ever changes,
`npm run users:rebuild -- --apply` is the fix, and it runs before the tunnel,
not after.

**2.1 DNS, at Hostinger.** One record: `shop` → `152.239.114.129`. The `@` and
`www` records belong to the live store — leave them alone.

**2.2 Tailscale, then the proxy.** Tailscale on the laptop and on the VPS puts
them on one private network with no port opened on the shop's router, then the
container built from `deploy/shop-proxy/Dockerfile` holds the public name and
forwards to the laptop. Every step, every value and the two things that go
wrong are in **[deploy/shop-proxy/README.md](../deploy/shop-proxy/README.md)**.

> **Two settings in that proxy are not tuning, they are requirements.**
> `proxy_buffering off`, because `/api/live` is a server-sent-event stream and
> `/api/labels/next` is a 25-second long-poll — buffering waits for a response
> that is deliberately never going to end. And
> `proxy_set_header X-Forwarded-Proto https`, or the shop redirects browsers
> to its own `:8443`, a port nothing out here carries.

> **Disable key expiry on both machines** in the Tailscale admin console.
> Without it the key expires in a few months, the link stops, and
> `shop.ogsports1.com` starts showing "the shop is not connected" with nothing
> in the shop having changed.

**2.3 The laptop needs no changes.** Checked on 20 Sep 2026:
`OG_ORIGINS` already lists `https://shop.ogsports1.com` from the first tunnel,
and `OG_TRUST_PROXY=1` is set.

**2.4 Check it** from a phone **on mobile data, not the shop wifi** —
otherwise you are testing the LAN and learning nothing:

```
https://shop.ogsports1.com          the sign-in screen
```

**2.5 Afterwards**, `shop.public_url` can be set to
`https://shop.ogsports1.com` in Settings. Telegram messages about a print job
carry a link only when it is set, and it has been empty since the first tunnel
was retired.

---

## Phase 3 — the outage drill  ·  ~5 min  ·  do it once, in the shop

Do not take anybody's word for the offline story, including this file's. Run
it:

1. Sell something normally. The receipt prints.
2. **Unplug the internet** at the router, or turn the wifi off.
3. Sell **three** more things. They ring up, they print, they save.
4. Open **Settings → the cloud copy fold**. It says rows are waiting.
5. **Plug the internet back in.**
6. Wait a minute, reload. It says the last push was seconds ago, with nothing
   waiting.

Between steps 2 and 6 nobody pressed anything but the till. That is the whole
claim, and now you have watched it.

What is genuinely lost during the outage: the view from outside. The tunnel
needs the internet that just died. Phase 4 is the answer to that.

---

## Phase 4 — the read-only view  ·  optional, not built yet

A small page on the VPS that reads the **Supabase mirror** and shows the day's
takings, what is owed and what is on the road — from anywhere, including while
the laptop is asleep or the shop's internet is down.

It is safe because it **only reads**. There is no second writer, which is the
line this whole architecture is built on. It also has precedent here: og-track
already serves the customer's tracking page from the mirror the same way.

Say the word and it gets built.

---

## What must never happen

**Two servers writing one shop.** If the VPS ever runs `Dockerfile` (the shop's
own system) while the laptop is also running, you have two databases that both
think they are the shop:

- both mint `INV-2106` as the next invoice number,
- both sell the last pair of 43s, each correctly, and together sell stock that
  does not exist,
- `applied_ops` — what stops one sale being recorded twice — is per database,
- and if both reach one Supabase project, each run deletes the other's rows.
  That happened on 2026-08-30 and again on 2026-09-03, which is why
  `server/lib/lineage.js` exists and refuses the second writer.

The root `Dockerfile` is for one machine at a time. Today that machine is the
laptop, and the VPS runs `site/Dockerfile` only.
