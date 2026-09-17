# OG System

Retail operations for a sneaker and streetwear shop in Aleppo — the till, stock
across two warehouses, customers, money, barcode scanning and label printing —
plus a separate portal for **Yalla Wear**, the print partner.

**How everything works is in [CLAUDE.md](CLAUDE.md).** Trust it over this file.

## Run it

- Double-click **`OG System.exe`** in the repo root. It opens the control panel,
  which starts the shop, checks the printers and the padlock, and shows the
  address to open (with a QR code for phones on the wifi).
- Or, from a terminal: `cd server && npm start`, then open the address it prints.

Node **22.5 or newer** is required (the server uses `node:sqlite`). There is no
`npm install`: the server has no dependencies and the frontend has no build step.

**It needs the server.** There is no offline or demo mode: opening `index.html`
from a file, or any static copy of the frontend, shows only the "server is not
answering" screen.

## Publish

The **Publish** button in the panel: it commits everything with the message you
type into the box, pulls, and pushes. CI then builds the frontend copy.

GitHub Pages is off while the repository is private, and a static copy of the
frontend could only ever show "server is not answering" anyway.

## Test

```bash
cd server && npm test
```

One small test: every config key the browser saves is on the server's allow-list.
Check anything else you change in a browser before pushing.

## Security

**Real accounts, checked by the server.** Each person signs in with their own
username and password; the password is stored as a scrypt hash; sessions are
`HttpOnly` cookies the page's JavaScript cannot read.

**Hiding a button is a courtesy, not a boundary.** `Auth.can()` in the browser
decides what to *draw*. Every permission is checked again on the server,
because anyone can edit what runs in their own browser. If you add a screen
that shows cost or profit, guard it in **both** places — and treat the server
one as the real guard.
