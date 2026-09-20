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
| `panel/` | the Windows control panel for the shop's own laptop |
| `agent/` | the print agent for the label printer |
| `docs/` | everything written down that is not the manual — see [docs/README.md](docs/README.md) |

## Run it

```bash
cd server && npm start          # http://localhost:8090
```

On the shop's laptop, double-click **`start-og-system.bat`** instead: it opens
the control panel, which starts the shop, checks the printers and the
certificate, and shows the address with a QR code for phones on the wifi.

Node **22.5 or newer** (the server uses `node:sqlite`; 24 is what is used here).
There is no `npm install` — the server has no dependencies and the frontend has
no build step.

> **It needs the server.** There is no offline or demo mode. Opening
> `index.html` from a file, or any static copy of the frontend, shows the
> "server is not answering" screen and nothing else — every screen is filled
> from the API. This is deliberate: a till that falls back to invented data
> takes real money into a database nobody keeps.

## Deploy it

**[DEPLOY.md](DEPLOY.md)** — Coolify from GitHub. One container, built from
`Dockerfile`: the shop's own system, on a private hostname, never indexed.

```bash
docker compose up --build       # locally, on :8090
```

## Test

```bash
cd server && npm test
```

One small test, and it is small on purpose: every config key the browser saves
is checked against the server's allow-list. The wider suites live in the
gitignored `_nightshift/` folder — `docs/progress.md` has the two commands that
start them. Check anything else you change in a browser before pushing.

## Security, in two sentences

Every person signs in with their own username and password (scrypt hash,
`HttpOnly` session cookies). **Hiding a button is a courtesy, not a boundary**:
`Auth.can()` in the browser decides what to *draw*, and `requirePerm()` on the
server decides what is *allowed* — if you add a screen that shows cost, profit
or customer data, guard it in both, and treat the server one as the real guard.

Before it is reachable from the internet, read **DEPLOY.md §5**. Three of the
five original test accounts share a password that is still in this repository's
git history.
