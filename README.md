# OG System

Retail operations for **OG Sports**, a sneaker and streetwear shop in Aleppo,
Syria — the till, stock across two warehouses, customers, money, deliveries,
barcode scanning and label printing — plus a separate portal for **Yalla Wear**,
the print partner, and the public shop page.

**How everything actually works is in [CLAUDE.md](CLAUDE.md).** It is the
working manual and it is kept current; trust it over this file.

---

## What is in here

| | |
|---|---|
| `index.html`, `css/`, `js/` | the app — vanilla HTML/CSS/JS, no framework, no bundler, **no build step** |
| `server/` | the API and the static server — Node, `node:sqlite`, **zero dependencies** |
| `site/` | an earlier public page — two static pages, nginx, its own container. **Not deployed**: `ogsports1.com` is Ahmad's website, built from its own repository |
| `panel/` | the Windows control panel for the shop's own laptop |
| `agent/` | the print agent for the label and receipt printers |
| `vps/og-bridge/` | the VPS half: the owner's `/snapshot` and night mode's `/night`, read from the cloud copy |
| `deploy/` | the VPS's nginx in front of `shop.ogsports1.com` |
| `server/supabase/` | the cloud copy's SQL, run by hand — [its README](server/supabase/README.md) says the order |
| `tools/` | the tracked test rigs (always-on, night mode, the WireGuard check) |
| `docs/` | everything written down that is not the manual — see [docs/README.md](docs/README.md) |

## Run it

```bash
cd server && npm start          # http://localhost:8090
```

On the shop's laptop, double-click **`OG System.exe`** in this folder instead:
it opens the control panel, which starts the shop, checks the printers and the
certificate, and shows the address with a QR code for phones on the wifi.
(`start-og-system.bat` is a one-line shim to the same thing, kept for old
shortcuts.)

Node **22.5 or newer** (the server uses `node:sqlite`; 24 is what is used here).
There is no `npm install` — the server has no dependencies and the frontend has
no build step.

> **It needs the server.** There is no offline or demo mode. Opening
> `index.html` from a file, or any static copy of the frontend, shows the
> "server is not answering" screen and nothing else — every screen is filled
> from the API. This is deliberate: a till that falls back to invented data
> takes real money into a database nobody keeps.

## Deploy it

**Since 25 Sep 2026 the shop's main server is the VPS** (`og-shop`, reached at
`shop.ogsports1.com` through the proxy in `deploy/shop-proxy`), and this laptop is its standby.
Code reaches it only through `cd server && npm run vps -- deploy`. It is deliberately **not** a
Coolify app, because a push to `main` must not restart the till. See "Online first, phase 4" in
CLAUDE.md.

[DEPLOY.md](DEPLOY.md) describes the earlier Coolify route for the same `Dockerfile`, and what a VPS
cannot do that the laptop can.

```bash
docker compose up --build       # locally, on :8090
```

## Test

```bash
cd server && npm test
```

Small on purpose: every config key the browser saves is checked against the
server's allow-list, plus the exchange-rate feed, the dollar prices and night
mode's request shape. `cd panel && npm test` covers the control panel and
`cd vps/og-bridge && npm test` the VPS half. The wider suites live in the
gitignored `_nightshift/` folder and in `tools/` — `docs/progress.md` has the
two commands that start them. Check anything else you change in a browser
before pushing.

## Security, in two sentences

Every person signs in with their own username and password (scrypt hash,
`HttpOnly` session cookies). **Hiding a button is a courtesy, not a boundary**:
`Auth.can()` in the browser decides what to *draw*, and `requirePerm()` on the
server decides what is *allowed* — if you add a screen that shows cost, profit
or customer data, guard it in both, and treat the server one as the real guard.

**This repository is public.** The five original test accounts and their shared password are in
its git history; `npm run users:rebuild` removed them from the live database (13 accounts, none of
them, checked 25 Sep 2026). A secrets scan of every git object that night found no live key.
