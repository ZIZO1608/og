# Putting the shop online — the safe order

Written for whoever does it, at the laptop and at a browser. Four phases,
newest risk last. Each one is useful on its own and none of them depends on
the next, so you can stop after any of them.

> **The shape, in one line.** The shop's own system stays on the laptop in
> Aleppo — that is what makes the till work when the internet dies — and a
> tunnel makes the same server reachable at `shop.ogsports1.com`. The VPS
> carries the public page at `ogsports1.com`, which is the one thing the
> laptop cannot do. There is never a second copy of the shop's data.

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

## Phase 1 — the public page  ·  ~20 min  ·  no risk

Nothing here touches the shop. If it all goes wrong, a marketing page is down.

**1.1 DNS, at Hostinger** (hPanel → Domains → DNS / Nameservers):

```
Type: A    Name: @      Value: <the VPS IP>    TTL: default
Type: A    Name: www    Value: <the VPS IP>    TTL: default
```

Wait until `nslookup ogsports1.com` answers with the VPS IP before the next
step — Let's Encrypt fails on a name that does not resolve yet, and then
retries on a back-off that wastes ten minutes of your evening.

**1.2 Coolify** → New Resource → Private Repository (GitHub App) →
`ZIZO1608/og`:

| setting | value |
|---|---|
| Branch | `audit-06` |
| Build Pack | `Dockerfile` |
| **Dockerfile Location** | **`/site/Dockerfile`** |
| Base Directory | `/` |
| Ports Exposes | **`8080`** |
| Domain | `https://ogsports1.com` |
| Build Argument | `SITE_URL=https://ogsports1.com` |

No volume, no environment variables, no keys.

**1.3 Check it:**

```
https://ogsports1.com/              the Arabic page
https://ogsports1.com/en/           the English one
https://ogsports1.com/robots.txt    Allow, and a Sitemap: line
https://ogsports1.com/sitemap.xml   two URLs
```

**1.4 Tell the search engines** — this is the step that actually does
something, and none of it is automatic:

- **Google Search Console** → add `ogsports1.com` → submit `/sitemap.xml`
- **Bing Webmaster Tools** → the same sitemap (several AI assistants read
  Bing's index)
- **Google Business Profile** → claim the pin the page already links. For
  "sports shop in Aleppo" this matters *more* than the website does, and what
  makes the pair work is that the name, the city and the Instagram link match
  the page exactly.
- Put `ogsports1.com` in the **Instagram and Telegram bios**. The page's
  `sameAs` claims those accounts; a link back from the profile proves it.

---

## Phase 2 — the tunnel  ·  ~20 min  ·  low risk, one gate

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

**2.1 Nameservers to Cloudflare.** A Cloudflare Tunnel needs the zone on
Cloudflare. Add the site (free plan), let it import the existing records, and
**check the MX records came across before switching** if any email uses this
domain. Then set Cloudflare's two nameservers at Hostinger. Propagation is
usually under an hour.

**2.2 The tunnel.** Cloudflare → **Zero Trust** → Networks → **Tunnels** →
Create a tunnel → name it `og-shop` → it gives you a Windows install command
carrying a token. Run that on the shop laptop. Then add a public hostname:

```
Hostname:  shop.ogsports1.com
Service:   http://localhost:8090
```

> **`http://localhost:8090`, not `https://…:8443`.** The local certificate is
> self-signed, and the connector refuses it with an error about nothing you
> did. The server is built for this: browsers get sent to HTTPS, machines
> carry on over plain HTTP.

> **One connector per token.** A second `cloudflared` running the same token
> is a high-availability pair as far as Cloudflare is concerned, and it takes
> requests away from the laptop without a word. That cost a day of diagnosis
> on this project once already.

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
