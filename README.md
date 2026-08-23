# OG System

Retail operations for a sneaker and streetwear shop in Aleppo — point of sale,
stock across two warehouses, customers, money, barcode scanning and label
printing, plus a separate portal for **Yalla Wear**, the print partner.

Run it with `cd server && npm start`, then open http://localhost:8090.

> **The old `zizo1608.github.io/og/` demo link no longer works.** The repository
> was made private — the right call before real customer data goes in — and on
> a free GitHub plan Pages does not serve private repositories. The app is
> served by [`server/`](server/) now, which is where it was heading anyway.
> To bring the public demo back, either make the repo public again or upgrade
> the account; CI resumes publishing on the next push with no changes needed.

---

## Run it

Three ways, in increasing order of fidelity:

| | How | What you get |
|---|---|---|
| Quickest | Double-click `index.html` | The demo on seeded data. No camera, no offline mode, nothing saved. |
| Frontend only | `.\serve.ps1` → http://localhost:8080 | Same, plus the service worker. Still saves nothing. |
| **The real thing** | `cd server && npm start` → http://localhost:8090 | Login, accounts, permissions, and data that is **still there tomorrow** |

The first two need nothing installed — no npm, no build step, that rule still
holds for the frontend. The third needs **Node 22.5 or newer**, and the server
itself has zero dependencies, so there is still no `npm install` to run.

---

## First time on a new machine

For a second person joining, or for setting the project up on another computer.

1. **Accept the invite.** GitHub emails it. If you miss the email, open
   https://github.com/ZIZO1608/og while signed in and accept it there.
2. **Install GitHub Desktop** from https://desktop.github.com and sign in. You
   do not have to use it day to day — install it because it performs the
   GitHub sign-in that `push.bat` relies on afterwards.
3. **File → Clone repository → GitHub.com → `ZIZO1608/og` → Clone.**
4. Open the folder it created and double-click `index.html`. If the app opens,
   you are done setting up.

From then on the whole loop is: **edit files, double-click `push.bat`.**

The very first `push.bat` may pop up a GitHub sign-in window once. That is
expected, it happens once, and it is not an error.

> Work in the folder GitHub Desktop cloned — not in a copy of it, and not in a
> zip someone sent you. Only the clone knows where to push.

---

## Publish a change

**Double-click `push.bat`.** It describes what you changed, asks for a one-line
summary, pulls in your partner's work, and pushes.

GitHub then rebuilds the site. Watch it at
[the Actions tab](https://github.com/ZIZO1608/og/actions).

**Nothing checks your change before it goes out.** The automated tests were
removed on request, so a push that breaks the till reaches the live site just
as fast as one that fixes it. Try what you changed before you push it — you are
the only check left. See [Tests](#tests) for how to get them back.

### If the site looks unchanged afterwards

Almost always the **service-worker cache**. The app is cache-first so it works
offline, which means a browser that has visited before keeps serving the files
it already has, no matter what you publish.

The fix is to bump `CACHE` in `sw.js` — `og-system-v13` → `v14`. Do this
whenever you change anything under `css/`, `js/` or `index.html`. The Action
prints the cache name it published on every run, so you can check what actually
went out.

To unstick a device: `Ctrl+Shift+R` on desktop, or close the tab entirely and
reopen it on a phone.

---

## The rules this codebase is built on

These are constraints, not preferences. Breaking one means rewriting a lot.

- **Vanilla HTML, CSS and JavaScript.** No React, no framework, no bundler, no
  npm, no build step. The only third-party file in the repo is
  `js/vendor/chart.umd.min.js`, committed directly.
- **No backend, no database, no login, no `fetch`, no `localStorage`.** All
  state lives in one JavaScript object in memory. Reloading the page resets
  everything to the same rehearsed demo — which is a feature during a client
  meeting, not a limitation.
- **It must work by double-clicking `index.html`, fully offline.** Anything
  that only works over `http://` breaks the fastest way to look at the app.
- **Dark mode only. Montserrat. English and Arabic, with real RTL** — not a
  mirrored stylesheet; the layouts are built for both.
- **No placeholder content.** No "Lorem ipsum", no "Coming soon", no stock
  photo URLs. Product images are CSS colour blocks. If a screen exists, it
  works.

---

## How it fits together

```
index.html          the whole shell — one page, no router
css/style.css       ~2,900 lines, all of it
js/
  data.js    2023   the seeded dataset and every query over it (DB.*)
  app.js     5345   rendering, routing, modals, labels, settings
  yalla.js   1184   the print partner's portal
  pos.js      713   till
  codes.js    695   EAN-13 and Code 128, encoders and decoders
  ylinvoice.js 600  partner invoicing
  money.js    453   expenses, debts, cash
  bulk.js     426   multi-select actions
  scan.js     378   camera scanning
  motion.js   366   animation, and the switch that disables it
  export.js   342   CSV and PDF
  stock.js    341   stock counts
  charts.js   258   Chart.js wrappers
  palette.js  201   Ctrl+K command palette
  notify.js   181   notifications
  wedge.js    160   hardware barcode scanners
  whatsapp.js 154   message composition
  gate.js      70   the passcode screen
  vendor/chart.umd.min.js
```

### Conventions worth knowing before you write any of it

**Events are delegated, never bound per-element.** One listener per namespace,
dispatching on a `data-*` attribute: `data-act`, `data-pos`, `data-yl`,
`data-nt`, `data-mo`, `data-sc`, `data-st`, `data-bk`, `data-wa`,
`data-change`. Adding a button means adding a `data-act="thing"` and a case —
not an `addEventListener`.

**The demo data is generated by a seeded random number generator**, so every
launch tells the identical story. The generator is a plain LCG:

```js
seed = (seed * 1664525 + 1013904223) % 4294967296
```

**Call order is load-bearing.** Inserting one extra `rand()` call shifts every
value drawn after it, which rewrites unrelated parts of the dataset and breaks
tests that had nothing to do with your change. If you need new random values,
add a separate generator with its own seed — that is what the warehouse code
does.

**Each module is an IIFE** exposing one global (`DB`, `POS`, `Codes`, `YALLA`,
`Wedge`, …). Loading order in `index.html` matters.

**The code deliberately avoids `:has()`** and other very recent CSS, because it
has to run on the shop's actual hardware.

---

## Tests

**There are none. They were removed on request.**

Until then there were 986 automatic checks — 858 in the browser across six
harnesses, 128 on the server — and CI refused to publish if any of them failed.
Nothing inspects a change now.

What that costs, concretely: the browser suite caught a Code 128 decoder that
returned an empty string, a barcode that clipped the product name on every
30mm label, and four screens overflowing at 390px. The server suite proved
two tills cannot both sell the last pair. None of that is watched any more.

**They are not gone, only removed.** Everything is in git history and comes
back in one command:

```
git checkout d76950a -- server/test _selftest.html _mobile.html \
    _yalla.html _connect.html _stagea.html _codes.html _codetest.html
```

`d76950a` is the last commit that had them. The CI jobs that ran them are in
that commit's `.github/workflows/deploy.yml`.

> `_shot.html` is still in the root and is **not** a test — it is the
> screenshot rig `make-proposal.ps1` drives to build the Arabic client PDF.
> Deleting it breaks the proposal.

Anything whose filename starts with `_` is stripped from the published site by
both `make-deploy.ps1` and the Action, and the server refuses to serve it.
`.nojekyll` is what stops GitHub deleting underscore-named files on its own.

---

## What is in the repo, and what is not

Tracked: the app, the tests, the build scripts, and `docs/proposal-ar.html`
plus `docs/proposal.css` (the Arabic client proposal, as source).

**Not tracked**, and deliberately:

- **`dist/`** — build output. It exists in exactly one place now: the Action
  builds it fresh on every push. Committing it is what let the live site drift.
- **`flutter_app/`** — a Flutter port of the app, ~350 KB of Dart. Kept out
  until it compiles cleanly end to end; the Android build currently fails on an
  NDK/`sdkmanager` crash. Remove the line from `.gitignore` to bring it in.
- **`docs/img/`, `docs/fonts/`, `docs/*.pdf`** — all regenerated by
  `make-proposal.ps1`, and the Cairo fonts are Google's to distribute, not ours.

---

## Scripts

| | |
|---|---|
| `push.bat` | commit + pull + push. The only one you need day to day. |
| `serve.ps1` | local web server on :8080 |
| `make-deploy.ps1` | build `dist/` locally — the Action does the same thing in bash |
| `make-proposal.ps1` | regenerate the Arabic client PDF from the live app |
| `start-og-system.bat` | serve and open a browser in one click |

---

## One-time repo setting

**Settings → Pages → Build and deployment → Source → "GitHub Actions"**

Until that is switched away from "Deploy from a branch", the workflow goes green
and publishes nothing. It fails silently, which is the only reason it is called
out this loudly.

---

## Security, read this once

`js/gate.js` contains:

```js
var PASSCODE = 'OG2026';
```

in plain text, in a public repository, in a file the browser downloads.

**This is a curtain, not a lock.** It keeps a casual visitor and a search engine
crawler out of an unreleased client demo. It cannot do more than that, and no
amount of obfuscation would change it: a static site has no server, so there is
nothing to check a password against.

That is fine for what this currently is — a demo over generated data, with no
real customer records in it. It stops being fine the moment real names, phone
numbers or money go in. At that point this needs a real backend with a real
login, and this gate deleted rather than improved.

If the passcode itself matters before then, the options are to change it, or to
make the repository private.
