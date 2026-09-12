# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Retail operations for a real sneaker and streetwear shop in **Aleppo, Syria** — till, stock across two
warehouses, customers, money, barcode scanning, label printing, and a separate portal for **Yalla Wear**,
the print partner (a different company, working remotely).

Two audiences shape every decision: shop staff who are not computer people, and a client who is shown
this in meetings. The owner keeps his records on paper today.

## Commands

```bash
# The real thing — serves the app AND the API from one origin on :8090
cd server && npm start          # or double-click "OG System.exe" - the panel, see below

# serve.ps1 and double-clicking index.html no longer show an app — there is
# nothing to draw without the server. Both now say so rather than inventing a shop.

cd server
npm run createuser               # interactive; also accepts piped stdin
npm run backup                   # VACUUM INTO + integrity_check + FK check
npm run preflight                # accounts, catalogue, Supabase, port
npm run supabase:check           # is the mirror a faithful copy of the DATA
npm run supabase:drift           # can the next write even land — the SHAPE
npm run hardware                 # printers and scanner: what is missing, and why
npm run hardware:install         # installs what it can (asks for administrator)
npm run test-print               # sends real bytes so paper comes out (--receipt / --label)
npm run test-print:dry           # says where it would go, spends no paper
npm run cert:trust               # Windows trusts the self-signed certificate (asks for administrator once)
```

### The till's hardware

`server/scripts/hardware.js`, run by the panel's first Start of the session (`morning()` in
`panel/panel.js`) after the port check — so a double-click while the shop is already open
does nothing. It exits **4** when something is
missing that it can install (the launcher then installs and asks again), **1** when a person
is needed, **0** otherwise. **It never stops the shop opening**: a till that cannot print can
still sell shoes, same rule as `preflight.js`.

**The driver the printers need is not the one on the box.** Both are sent bytes they already
understand — ESC/POS for the receipt, TSPL for the label — so what they need is a shared queue
on the Windows built-in **`Generic / Text Only`** driver. The manufacturer's driver is worse
than none: it accepts the job and reformats the command bytes into pages of gibberish, which
looks like a working printer. Which queue is checked comes from `receipt.printer_share` and
`agent/agent-config.json`; a printer on `transport = tcp` has no driver at all and is only
probed on :9100.

**The scanner has no driver, deliberately** — it enumerates as a keyboard (see `js/wedge.js`),
so there is nothing to install and the check says so rather than inventing a step. It reports
what can actually be wrong: a device Windows left sitting on an error.

It **will not guess between two USB ports.** One candidate, identified by the vendor driver
name already on that port, is a fact; choosing between two is how labels come out of the
receipt printer all morning. Two candidates means it stops and prints the list.

**Node 22.5+ required** (`node:sqlite` is used, which arrived in 22.5). There is **no `npm install`** —
the server has zero dependencies by design, and the frontend has no build step at all.

Publishing: **the Publish button in the panel** (add → commit → pull --rebase → push, the message
typed into the box; `push.bat` is gone). CI then builds `dist/`
and deploys to GitHub Pages.

### HTTPS, and why the till needs it

`cd server && npm run cert` once per machine, then restart. The server listens on
**https://localhost:8443** (`OG_HTTPS_PORT`) and the plain HTTP port keeps working: it serves
the API unchanged and **redirects only browser page requests** to the secure address. Machines —
the print agent, the website's bearer-key calls, any local script — carry on over http, because
a redirect to a self-signed origin fails certificate validation in Node with an error about
nothing they did.

**This is not cosmetic.** On `http://10.10.99.9:8090` a browser silently refuses three things
the app needs, with no error a shopkeeper would recognise: `Notification` (the phone never
buzzes for a new order), `getUserMedia` (the camera barcode scanner cannot open the camera) and
`serviceWorker` (no offline shell, cannot be installed). `http://localhost` is exempt, which is
exactly why this went unnoticed on the machine doing the testing.

- The certificate is **self-signed** (`server/lib/tls.js` says why): each device shows one
  "not a known authority" warning, somebody presses continue, and from then on the origin is
  secure. A certificate the world trusts needs a public domain, which means exposing a till full
  of real money to the internet.
- **On the till itself that warning is gone**: `npm run cert:trust` (`scripts/trust-cert.js`)
  puts the certificate in Windows' machine-wide trusted list through `certutil`, asking for
  administrator once, and the panel runs its free `--check` on the first Start of the day and
  only prompts when it is not there. Before this the launcher opened `https://localhost:8443` straight
  onto a full-page red "not private" every day, and it was reported as "there is an error".
  Phones still get the one warning: the certificate is deliberately not an authority (`CA:FALSE`),
  because an authority that anyone with `server/data/certs/` could copy would sign for any site.
  `cert:untrust` takes it out again after a re-run of `npm run cert`.
- **The launcher opens the browser itself** (`scripts/open-when-ready.js`, started with
  `start /b` just before `node index.js`, which blocks the window): it polls `/api/health` and
  opens whichever address the health line says is actually serving. The "already open" branch
  uses the same script rather than guessing https from a file on disk.
- `SECURE` sets itself when HTTPS is actually serving, so session cookies get the `Secure` flag
  without anyone remembering `OG_SECURE`. Browsers still accept Secure cookies on
  `http://localhost`, so the till on this machine is unaffected.
- **`server/lib/net.js` is the one list of this machine's addresses** — the startup print,
  `/api/health` (which the login screen reads) and the certificate's SANs all come from it. A
  certificate that does not name the address somebody types is a page that will not open at all,
  so the server compares the two at startup and says `npm run cert` by name when the IP has
  moved. It also warns 30 days before expiry.
- `server/data/certs/` is gitignored: it holds a private key, and it is one command to rebuild.

### The way in from outside — Cloudflare

`server/scripts/cloudflare.js`, the panel's **Check Cloudflare** button, and one Cloudflare
tunnel. The shop listens on one laptop; a phone on the shop wifi reaches it by IP and nobody
else can, because there is no public address and nothing is going to open a port on a router in
Aleppo. `cloudflared` runs as a Windows service, makes an **outbound** connection to Cloudflare
and holds it open; Cloudflare answers for `shop.ogsports1.com` and passes each request back down
it to `http://localhost:8090`. No inbound port, no fixed IP, and the padlock is Cloudflare's real
certificate rather than the one `lib/tls.js` apologises for.

- **`npm run cert` BREAKS THIS, and nothing says so at the time.** `index.js` is
  `createServer(SECURE_SERVER ? httpHandler : handle)`, and `httpHandler` sends any browser
  asking for a page to `https://<host>:8443`. Through the tunnel that is a redirect to
  `shop.ogsports1.com:8443`, a port Cloudflare does not carry, so the public address dies with
  no error a shopkeeper could read. The check looks for `server/data/certs/` and says so; the
  panel's Make certificate blurb warns before the fact. If the local certificate is ever genuinely
  needed, the tunnel must be repointed at `https://localhost:8443` with **No TLS Verify** on.
- **The id is public, the token is the secret.** `OG_CF_TUNNEL_ID` names the tunnel and
  authorises nothing; `OG_CF_TUNNEL_TOKEN` is what lets a machine join it and lives in
  `server/.env`. Once `cloudflared service install <token>` has run, Windows keeps its own copy
  at `C:\ProgramData\cloudflared\token`, **administrator-only** — so nothing here ever reads it,
  and the check reports the service's command line instead. Its existence is the only fact needed.
- **The hostname mapping lives in the dashboard, not on this machine.** A token-based tunnel has
  no `config.yml` to write, which is why the connect pass is one call and there is no local file
  to drift. **It can still be read here, and the check reads it**: cloudflared runs a metrics
  server on localhost (20241 upwards, or whatever `--metrics` names), and `/diag/tunnel` says
  which tunnel it actually joined while `/config` carries the ingress rules the dashboard handed
  it. Read-only, localhost-only, no credential — the token file is still never opened. So "which
  tunnel is this laptop on" and "where does it send the hostname" are facts now, not guesses, and
  a build too old to answer prints nothing rather than inventing it.
- **A 502 IS ANSWERED BY WHOEVER CLOUDFLARE GAVE THE REQUEST TO, AND THAT NEED NOT BE THIS
  LAPTOP.** 530 means no connector is attached at all; 502 means one is, and it failed — but not
  necessarily the one here. `cloudflared_tunnel_total_requests` on the metrics page is read either
  side of the check's own public request, and that bracket answers the question no amount of
  reading configuration can: *did that request come through this computer*. Measured on
  12 Sep 2026 — the connector here was on the right tunnel, its rule already read
  `http://localhost:8090`, and across nineteen public requests its counter never moved once.
  Every one was being answered elsewhere. The check used to report this as "the tunnel is pointed
  somewhere else", sending somebody to change a setting that was already correct; it now
  distinguishes the two and names the second machine as the cause. Two connectors on one tunnel
  are a high-availability pair to Cloudflare, which hands each request to whichever it likes — so
  a second install sharing `OG_CF_TUNNEL_TOKEN` takes the shop off the internet without touching
  it. Same shape as the `lineage.js` problem, one layer down; see the Supabase section.
- **`Get-CimInstance Win32_Service` does not return on the shop's laptop**, and a `try/catch`
  around a call that never returns protects nothing. It was how the service's command line was
  read, so its hang took the whole probe's 60-second timeout with it and *all four* answers were
  lost — the check told the owner his running service was "not installed", and then that his
  tunnel token was missing, which followed from the first. One slow call, four wrong sentences,
  a minute each time the panel's button was pressed. The registry holds the same string
  (`HKLM:\SYSTEM\CurrentControlSet\Services\cloudflared` → `ImagePath`) and answers in
  milliseconds. **Nothing there may use WMI for a fact readable another way**, the probe's
  timeout is 15 s, and `asked` now separates "Windows says there is no service" from "Windows did
  not say" — printing the second as the first is what made the advice wrong.
- **The service's command line can carry the token**, because `cloudflared service install
  <token>` writes it into `ImagePath`. The check prints that line, to the terminal and into its
  log file, so it is redacted on the way out. This laptop uses `--token-file` and never showed
  one, which is exactly why it went unnoticed.
- **One button that checks and fixes**, unlike `hardware` / `hardwareInstall` which are a pair.
  On a client's machine the only useful answer to "is Cloudflare set up" is "it is now". A machine
  already connected raises no permission prompt, which is what makes it safe to press twice.
- **`OG_ORIGINS` must list the tunnel hostname** the moment the shop is reachable from outside.
  Blank does not mean "allow the shop", it means allow everything — `originAllowed()` in
  `lib/http.js` returns true on an empty list. `OG_TRUST_PROXY=1` belongs with it, or every remote
  visitor shares one address for login throttling because they all arrive from localhost.

### Accounts

There are no test accounts. The five that used to exist (`hussam`, `lubna`, `maher`, `talal`,
`yalla`, all on a password published in the repo) were retired, and the scripts that created them
deleted. `maher` and `yalla` referenced nothing and were removed outright; `hussam`, `lubna` and
`talal` had rung up real sales and deliveries, so their rows survive **disabled, with their password
hashes replaced by random bytes** — deleting them would have taken the invoices that name them.

**Their old password is still in git history.** The server and `npm run preflight` both warn if one
of those usernames is ever `active = 1` again. Make new accounts with `npm run createuser`.

## The launcher: `OG System.exe` and the control panel

One thing to double-click. It replaced four `.bat` files — `start-og-system.bat` (now a one-line
shim, kept only because the shop laptop has a desktop icon and a pinned taskbar entry pointing
at it), `push.bat`, `claim-mirror.bat` and `make-deploy.bat` (deleted; in git history if ever
wanted back). The old window printed the addresses as text somebody retyped, could not be
stopped except by closing it, and said the mirror's state once at 8 am and never again.

```
OG System.exe               the icon. Starts panel/panel.js, opens a window onto it, sits in the tray
panel/panel.js              the supervisor: holds the server as a child, streams its output, runs the jobs
panel/jobs.js               the button table — every job is a command plus the two sentences before it
panel/ui/                   the window: three screens, same tokens and Montserrat as the shop
panel/ui/i18n.js            its own English and Arabic — the shop's I18N needs a server to exist
panel/launcher/OGSystem.cs  the .exe's source. panel/build-exe.ps1 compiles it; panel/make-icon.js the icon
```

- **The `.exe` is built with the `csc.exe` that ships inside Windows**
  (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`), so it needs nothing installed — the same
  reason the server has no dependencies and the frontend no build step. Electron needs npm and
  200 MB, Tauri needs Rust, a Node SEA needs postject. **Rebuild only when `OGSystem.cs`
  changes**: `powershell -ExecutionPolicy Bypass -File panel/build-exe.ps1`. Everything else in
  `panel/` is read off disk at run time. The 66 KB `.exe` is committed because it is the thing a
  fresh clone double-clicks; `make-deploy.ps1` and CI use allow-lists, so neither it nor `panel/`
  ever reaches the published site. **`OGSystem.cs` and `build-exe.ps1` stay pure ASCII** —
  `csc` and PowerShell 5.1 both read a file without a BOM as ANSI, and an em-dash in a
  MessageBox string arrives as two wrong characters.
- **The icon is drawn, not exported** — `panel/make-icon.js` writes `panel/og.ico` (the `.exe`,
  the tray) and `panel/ui/icon.png` (the window's favicon) from one description in fractions of
  the icon's own side: a lime `#C6FF00` ring on the shop's near-black tile, circles and a rounded
  square with exact distance functions so a pixel's coverage is arithmetic and needs no image
  library. It used to repackage `assets/icon-512.png`, which is the brush-drawn OG mark on a black
  square **with black padding around it** — right on a phone at 192px, a dark smudge at the 16px
  the taskbar actually asks for. **A taskbar icon is a different job from an app icon**; the
  shop's own mark in `assets/` is untouched and is still what a phone home screen and every screen
  in the app show.
  - **Only the 256 is a PNG entry; 64 and below are BMP.** `System.Drawing.Icon` on the .NET
    Framework — which is how `LoadIcon` in `OGSystem.cs` gets the tray icon — **cannot decode a
    PNG entry at all**: it throws `Requested range extends past the end of the array`, and at 64
    it quietly hands back a blank. The shell is perfectly happy with PNG, so nothing looks wrong
    until something asks in code. Measured, not assumed: the first draft had PNG down to 64.
    **A PNG entry at or below 48 puts a blank in the tray.** 128 is left out on purpose — 66 KB
    of BMP for a size Windows scales from the 256 indistinguishably.
  - The small sizes get a **heavier ring** (`SMALL_HALF`): below about 32px the stroke is under
    two pixels and the anti-aliasing spends most of it, so the lime greys out.
- **The window is Edge in `--app` mode** (Chrome second, the default browser as a plain tab
  third): no address bar, its own taskbar button, our icon. The panel is HTML because the shop
  is HTML — one design system, and Arabic that already works. A WinForms UI would have been the
  second design system, and the ugly one.
  **Edge takes the PAGE's icon for that taskbar button**, and `panel/ui/index.html` carried no
  `<link rel="icon">` at all, so the launcher's own window sat in the taskbar as the browser's
  grey globe — looking like somebody's stray tab. The comment above claiming "our icon" had been
  wrong since it was written.
- **The panel binds `127.0.0.1` and every request carries a key minted at boot**, handed to the
  window in its URL. Localhost-only is not a defence by itself: any page in any browser on the
  machine can POST to a local port, and this one has a Stop button for the till. One instance
  only (a named mutex in the launcher; the second says so and exits). Env: `OG_PANEL_PORT`
  (8099), `OG_PANEL_KEY` (set it to drive the panel from a script), `OG_PANEL_AUTOSTART=0`
  (open without starting the shop), `OG_PANEL_PARENT=1` (set by the launcher — the panel then
  treats end-of-file on stdin as "quit"; **gated on the flag, not on stdin merely not being a
  TTY**, because a background job or a test harness hands over a stdin that is already at the
  end, and the first version quit a moment after it started).

### The pipe to the server — `server/lib/panel-link.js`

The panel spawns `node index.js` with an IPC channel, and that channel is the whole
conversation. With no channel — `npm start`, a terminal, a scheduled task — every call is a
no-op and nothing behaves differently. It is not a door: no port, no origin, no cookie; a
message can only come from the parent that spawned the process.

- **Stopping.** Windows has no SIGINT to send a child; `child.kill()` there is
  `TerminateProcess`, uncatchable, so the shutdown handler never runs and `DB.close()` never
  happens. `{type:'stop'}` is the only graceful stop the platform has. `shutdown()` in
  `index.js` is one function with three ways in (Ctrl-C, SIGTERM, the message), guarded so a
  second Stop cannot race the first into closing a database already shut. The panel waits 8 s
  and only then `taskkill /T /F`, which leaves the WAL to replay on the next open.
- **Asking without signing in.** `GET /api/sync/status` is rightly gated on `config.write`.
  The panel is not a browser on the wifi, it is the process that started this one, and making
  somebody log into their own launcher to see whether the mirror is stuck is the wrong answer.
  `tell()` in `sync-worker.js` sends the same status object up the pipe (backup path included —
  it is this machine) alongside `Live.notify`. The server sends `ready` (addresses, padlock,
  accounts, shop name) once listening, and `stopping`.
- **`{type:'sync'}`** runs `SyncWorker.runNow('full')` — the same call `POST /api/sync/push`
  makes; the worker's own lock stops the two overlapping.

### Hard refresh

The button that makes an edit reach the copy already open in a browser. Two halves, and it is
only a hard refresh with both:

1. **The file half bumps `CACHE` in `sw.js`** (`og-system-v119` → `v120`). The Gotchas section
   below has said to do this by hand on every change to `css/`, `js/` or `index.html` since long
   before the panel; one integer in one file is better kept by a button than by a paragraph.
2. **The tab half** sends `{type:'reload'}` up the pipe → `Live.notify('all', { reload: true })`
   → `hardRefresh()` in `js/pulse.js`, which deletes every cache, asks the worker registration
   to update, and only then reloads. `location.reload()` alone never worked: `sw.js` is
   cache-first with `ignoreSearch`, so it answered out of the old store however hard anyone
   pressed F5. **It reaches the tabs on `/api/live` — the manager's and the developer's — and
   deliberately not a cashier's**, because a till reloading itself under somebody's hands
   mid-sale is a lost sale, not a refresh.

3. **The server half, when the server's own code moved.** Node reads a module once, at import, so a
   shop started before an edit goes on running the old code — and Hard refresh, which only ever
   spoke to the browser, could not fix that. `serverIsStale()` compares the newest mtime under
   `server/index.js`, `lib/`, `scripts/` and `migrations/` against when the child was launched
   (`startedAt`); when it is newer, Hard refresh **stops and restarts the shop first**, waits for it
   to answer, and only then tells the tabs — reloading into a server still doing its boot pull shows
   the failure page. Restarted only when something it runs actually changed, because a restart costs
   the boot pull and interrupts the till. The panel shows it in amber under the buttons before
   anything looks broken, and `snapshot()` recomputes it for the hello frame as well as every push,
   so a window opened after an edit does not say the server is current when it is not. `data/` and
   `backups/` are excluded: they change constantly and mean nothing here. **What this cost before it
   existed:** the new `POST /api/products/:id/image` answered "No such endpoint" to a button that
   plainly existed in the source, and the app now names that cause (`img_stale_server`) rather than
   repeating the 404.

It also needed **`serveStatic` to stop sending `public, max-age=3600`** on `js/`, `css/` and
`assets/`. That was an hour in which the browser would not even ask, with no ETag and no
Last-Modified, so it could not have revalidated if it wanted to. Everything is `no-cache` with a
weak ETag from size+mtime now, answered with a bodiless 304 on a LAN in about a millisecond.
`no-cache` means "store it, but ask first", not "do not store"; offline is the service worker's
job, which this header has no say over.

### Start, and what runs before it

`startServer()` first binds a probe to the shop's port, the way `preflight.js` always has.
Busy and `/api/health` answers → **the shop is already open somewhere else**: the panel adopts
it (addresses drawn from its health line, Stop greyed out with the reason) rather than
reporting a failure. Busy and no answer → the `netstat`/`taskkill` lines, not the `EADDRINUSE`
stack trace that names `node:internal` and never the window to close — that trace went straight
into the terminal pane the first time the panel was driven, which is how the check got written.

Then **`morning()`**, once per panel session and not on Restart: `preflight.js` (prints only),
`trust-cert.js --check` (a 4 leads to the trust run and its one permission prompt), and
`hardware.js` (a 4 leads to `--install` and a re-check; a 1 is said and left on screen). **None
of it may stop the shop opening** — the .bat's loudest rule, kept to the letter. Once per
session because two of these can raise a UAC prompt, right at 8 am and wrong on the ninth
restart of an afternoon's editing.

### The window is three screens, and it opens on the one a shopkeeper needs

It used to open on a 306px rail of five cards beside a **full-height black terminal**, which was
the largest thing on screen and the first thing the owner saw at eight in the morning. He keeps
his records on paper. A wall of scrolling monospace reads as a fault, not as a working shop, and
that is how it was reported.

- **Shop** is the default, every single time. The mark in a progress ring, one sentence, one lime
  button, the address with a QR beside it, and anything wrong as a card. The last screen is
  deliberately **not** remembered: the one morning somebody opened the log out of curiosity would
  otherwise become every morning after it.
- **Tools** (the gear) is all sixteen jobs under four headings, drawn from `group` in `jobs.js`.
- **Log** is the terminal, given the whole window — a place you go to, not the room you arrive in.

**The boot is seven steps, and every one is a real signal** — an exit code, a spawn, a message off
the pipe. `STEPS` in `panel.js`: `port · checks · padlock · printers · server · cloud · open`, each
pushed as `event: step` carrying a **code and its values, never a sentence**, so the window writes
the words from `panel/ui/i18n.js` and the same step reads correctly in Arabic. That is
`server/lib/alerts.js`'s rule, for alerts.js's reason. Nothing here is a timer pretending to be
progress, which is what `js/splash.js` says and the only reason either screen can be believed.

Three things it is easy to break, all of them the same mistake:

- **`morning()` runs once a session, so on a Restart those three steps are `skip`** — "checked at
  08:04" — never fresh ticks. A tick for a check that did not run is the exact lie this screen
  exists to stop telling.
- **A shop this window did not start has not been checked BY it.** The foreign branch marks every
  check `skip` and the verdict line is not drawn at all: "Everything is ready" over a shop whose
  ready line carries no notices would be a clean bill of health signed on no evidence.
- **A shop that stops by itself is not a shop that failed to open.** `server_died` gets its own
  headline, and `open`/`cloud` are pushed back to `wait` — left alone they went on carrying their
  ticks *underneath* the row that had just gone red.

The steps live in `state` and ride in `snapshot()`, so the `hello` frame redraws a boot already in
progress rather than starting a second sequence under the first.

**Refusals are pushed, not just printed.** `POST /act` answers `{"ok":true}` before the action
runs, so every refusal used to exist only as a red line in a pane this window no longer opens on.
`refuse()` pushes `event: refused` with a code and the window toasts it. Job progress goes the same
way (`event: job`, `{step, of}`), and the long-emitted-but-ignored `event: done` is now the
completion toast.

### The jobs — `panel/jobs.js`

One entry per button: a command plus `label`, `blurb`, `while` and `danger`. **`while: 'shut'`
is enforced in `runJob`, not in the window** — a disabled button is a suggestion, and two writers
on one set of mirror bookmarks is the exact failure `lineage.js` exists to prevent. `danger` is a
word the person types before it runs; three of these can lose a day's work (`restore` moves
`og.db` aside, `mirrorReconcile` deletes in the mirror, `claim` takes the baton off the other
laptop), and `claim-mirror.bat` had that protection in a comment above the line that did it
anyway. `push` stops at the first failing step, as `push.bat` did — pushing after a failed
rebase is how a conflict becomes a force-push conversation. `createuser` passes name, username
and role as flags and pipes only the password, so no line can be silently read as the wrong
prompt.

**`group` (`shop` · `cloud` · `machine` · `dev`) is what makes "the window draws its tool list
from the table" true.** It was not: `panel/ui/panel.js` held a hand-written array of thirteen job
NAMES and drew only those, so a job added to `jobs.js` appeared nowhere at all while this
paragraph claimed otherwise. A second copy of a fact drifts from the first — the same lesson as
`mirror-lag.js`, in a smaller place.

**`catalogue()` sends `aroundShop` too, and the window was wrong without it.** `restore` and
`takeShop` are `while: 'shut'`, so the window greyed them out whenever the shop was open — but
`runJob` closes the shop around them and opens it again, so the restriction it was drawing did not
exist. The mirror card only worked because it drew its own un-greyed copy of the button.

**`pull` — "Get the latest code" — is the other half of Publish**, because the shop is worked on
from more than one machine and taking what the other one pushed should not need a terminal. Three
steps, not one: `git fetch`, then `git log HEAD..@{u}` listing what is **about to** land, then
`git pull --rebase --autostash`. Reading it back off the reflog afterwards was the other option and
it lies — with nothing new to take, `HEAD@{1}` is wherever HEAD happened to be last time and the
list names commits that did not just arrive. `--autostash` for the reason `push` has it, and the
chain stops at the first failure so a conflict is left standing rather than half-resolved by a
button. Nothing needs restarting by hand afterwards: a pull that touched `server/` is picked up by
`serverIsStale()` within the second and the Shop screen raises its amber card.

**`testPrint` answers what `hardware` cannot.** That check proves a queue exists, is shared under
the right name and sits on Generic / Text Only — all three stay true of a printer that is switched
off, out of paper, or on a different port than Windows believes. `server/scripts/test-print.js`
sends the real bytes through the shop's own transports (`lib/printer.js`,
`lib/label-transport-tcp.js`), reading the receipt's queue from `config` and the label's from
`agent/agent-config.json` — the same two places `hardware.js` reads, rather than a second copy.
The database is opened **read-only**: the till is usually running while somebody stands at a quiet
printer, and `DB.open()` would apply migrations underneath a live shop.

It is deliberately plain ESC/POS text mode, not the till's real receipt — that one is a canvas
rasterised by `js/escpos.js` because Arabic needs shaping no thermal font can do, and none of it is
what is being tested. **A readable slip IS the pass condition**: with the manufacturer's driver on
the queue the command bytes come back as printed gibberish, which is the exact failure
`lib/printer.js` was written about and the one thing no exit code can report. The label's size
comes from the shop's default `label_templates` row, because a test label at the wrong size feeds
through the gap sensor wrong and wastes the next one too. `--dry` says where it would go and sends
nothing, so checking the settings costs no paper and no mystery slip at a busy counter.

### The handover — "Take the shop here"

The shop runs on **one laptop at a time** and moves to whichever boots with the other closed
(the boot pull, under Supabase below). When the mirror belongs to the other laptop the worker
sits in `refused`, and the panel's mirror card is where somebody learns what that means: it
draws **the boot pull's own sentence** (`pull.message` — "Ahmad_Sabagh is working on the shop
right now (seen 43 s ago)", "3 change(s) on this machine never reached the cloud", "OG_VAULT_KEY
is not set"), one line saying the shop is elsewhere, and **one button** — `takeShop` in
`panel/jobs.js`, the same `supabase-restore.js --wipe` as `restore`, framed for the situation
and typed-confirmed with `TAKE`. Sync now is greyed while refused, and pressing it anyway says
why: a machine that is not the shop cannot push.

`aroundShop: true` on a job makes `runJob` **close the shop first and reopen it after** — the
wipe refuses while anything answers on the port, and telling a person "press Stop, then try"
was the old `.bat`'s way. It waits for the child's exit rather than a fixed pause, and reopens
**even after a refusal**: `lib/restore.js` puts the file back untouched, and a shop left closed
over a refusal reads as a crash. Exit `2` is `busy_elsewhere` by contract and the panel says so
in its own words ("the other laptop is still open — quit OG System there, wait a minute"); the
other refusal a person can act on is `unpushed_local`, whose answer is **Claim the mirror**
instead, if this machine's rows are the truth. Verified on a scratch copy with a foreign lineage
id: refused → stop → wipe (refused `vault_off`, so it claimed nothing) → reopen, and the real
mirror never saw a write. **`claim-mirror.bat` is gone**; every message that named it — the
worker's refusal line, `restore.js`, the app's `mir_*` strings in both languages — now names the
two panel buttons.

### Things that bit while building it

- **`[hidden] { display: none !important }` is in `panel.css` for a reason.** The browser's
  own `[hidden]` rule loses to any author rule that sets `display`, and the confirm overlay is
  `display:flex` with a 74% black backdrop. It sat over the whole window from the first paint —
  every colour at a quarter of its brightness, every button behind glass — and was found by
  measuring a screenshot's brightest pixel (`#334200` where `#C6FF00` should have been), not by
  looking at one.
- **`.qr` was nearly the `.pos` collision again.** `js/codes.js` puts `class="qr"` on the `<svg>`
  it returns, so a container class of the same name hands the picture a grid, a card background
  and 13px of padding. The container is `.qrcard`. **Grep for a class name before defining one**,
  exactly as for a global function name — this is the third time in this repo.
- **`justify-content: center` on a scrolling column clips BOTH ends.** The Shop screen with three
  notices is taller than a 760px window, and centring put the mark's top and the last card's
  bottom out of reach with no way to scroll to either. `justify-content: flex-start` plus
  `margin-block: auto` on the child centres while there is room and collapses when there is not.
- **ANSI is stripped in `say()`**, not in the server, which is right to keep colouring a terminal
  it may be running in. The tick and the dot are text and survive.
- **The QR is drawn for the WIFI address, never `localhost`** — a phone pointed at a code for
  `https://localhost:8443` opens the phone's own machine and finds nothing, which reads as the
  shop being broken. `js/codes.js` is served to the window under `/shop/` and is the ONE encoder;
  writing a second one beside a working one is how two things that must agree stop agreeing.
- **Two logs in `%LOCALAPPDATA%\OGSystem\`**, each truncated at every start: `launcher.log` (what the
  `.exe` did — root, node, every line the panel printed, which browser opened, the quit) and
  `panel.log` (the terminal pane, verbatim). A tray application has no console, so "it did not
  open" is the whole of what anybody can report about it; these are the answer. The first line
  in the terminal names the file.
- **A screenshot of the panel cannot be taken with `--screenshot`**: the page holds an SSE
  stream open and the load never finishes. Drive it over CDP (`Page.captureScreenshot`).

## Hard constraints

These are constraints, not preferences. Breaking one means rewriting a lot.

- **Vanilla HTML/CSS/JS. No framework, no bundler, no npm, no build step** for the frontend. Two
  third-party files, both committed directly to `js/vendor/`: `chart.umd.min.js`, and
  `three.min.js` (r147 — the last release with a UMD build and a `THREE` global; r150+ is ESM-only,
  which is a build-step-shaped problem). Three.js is **lazily injected by `js/shelfroom.js` the
  first time somebody opens the shelf map**, never a `<script>` in `index.html`: it is 600KB, and
  the till must not parse it every morning for a screen a cashier never opens.
- **It needs the server.** This used to say the opposite — that double-clicking `index.html` had to
  keep working offline, because that was the fastest way to show the app to a client. That constraint
  was dropped deliberately: it was paid for with a generated shop, and generated data on a till looks
  exactly like the truth. There is now no way to run the app without `cd server && npm start`.
- **Dark mode only. Montserrat. English and Arabic with real RTL** — the layouts are built for both, not
  a mirrored stylesheet.
- **No placeholder content.** No lorem ipsum, no "coming soon", no stock photos. A product shows the
  shop's own photograph when one has been taken (see "Product pictures") and a CSS colour block with
  its initials when not — never a stock image. If a screen exists, it works.
- Avoid `:has()` and very recent CSS — this runs on the shop's actual hardware.
- **The shop's look lives in `css/og-skin.css`, loaded last.** Quiet and expensive: soft corners,
  weight 600/700 doing the talking, hairlines where the base had boxes, lime spent only on the primary
  action and the hero number, the active nav item marked by a short lime tick rather than a filled
  block. A louder "streetwear" draft (hard corners, caps, lime blocks) was built and turned down the
  same day. Every rule is prefixed `body:not([data-portal="yalla"])` — that is how the partner portal
  keeps its mint skin, and it is also what gives the file (0,2,x) specificity over the base components
  without `!important`. Two consequences: a base rule with two classes (`.view.pos-view`, the phone
  `.topbar`) is *beaten* by this file and has to be restated inside it; and every `letter-spacing` set
  there is zeroed again under `body.rtl` at the bottom, because tracked Arabic pulls the joined letters
  apart. Restyle a component by adding to this file, not by editing the base rule it overrides. The two
  `.seg` meanings (top-bar segmented control vs the warehouse's standalone pill) are told apart by
  `.topbar .seg` / `.seg-row .seg`.

> `README.md` is out of date on several points. There is a real server; the Pages deployment at
> `https://zizo1608.github.io/og/` is a static host with no backend and so now shows only the
> "server is not answering" screen. Trust this file over the README.

## Architecture

Two halves that must both keep working:

```
index.html + css/ + js/     static frontend — runs with or without a server
server/                     zero-dependency Node + node:sqlite, serves the API *and* the static files
```

### One run mode: a real server, or nothing

`cd server && npm start`. That is the only way the app runs.

There used to be three. Opened from a `file://` double-click or served from GitHub Pages, the app ran
on a seeded generator — 24 products, 40 customers, 120 invoices — with a permanent DEMO banner over it.
Both are gone, along with `Auth.demoMode()`, the banner, and the ~500 lines that generated the shop.

**Nothing is invented to fill a screen.** Every collection in `js/data.js` starts empty and is filled
by `DB.hydrate()` from the server. When the server cannot be reached, `Shop.fail()` draws the reason
and how to fix it — an empty app would be read as "the shop has no stock" rather than "this machine
cannot reach the server", and those call for very different next actions.

The failure this prevents was specific and real: generated data looks exactly like the truth, so a
till that falls back to it takes money into memory nobody keeps. A banner is a thing you stop seeing
by the second day.

`_shot.html` loads **neither `api.js` nor `auth.js`**, so `Auth` is `undefined` there, and the
`typeof Auth === 'undefined'` guards all over the frontend exist for it. **It no longer renders
anything useful** — it drew the seeded shop, and there is no seeded shop. The file and its guards are
kept because deleting them is a separate decision; the Arabic proposal PDF cannot be built until it is
given a data source.

### Frontend conventions

- **Each module is an IIFE exposing one global**: `DB`, `POS`, `Codes`, `YALLA`, `Wedge`, `Auth`, `API`,
  `Deliveries`, … **Load order in `index.html` matters.**
- **Events are delegated, never bound per element.** One listener per namespace dispatching on a
  `data-*` attribute: `data-act`, `data-pos`, `data-yl`, `data-nt`, `data-mo`, `data-sc`, `data-st`,
  `data-bk`, `data-wa`, `data-change`. Adding a button means adding `data-act="thing"` and a case in
  `ACTIONS` — not an `addEventListener`.
- **Every new string goes in BOTH `I18N.en` and `I18N.ar`** in `js/app.js`. A missing Arabic key falls
  back to English mid-sentence inside an RTL layout and reads as a bug.
- `js/api.js` is **the only file allowed to talk to the server**. Everything else goes through `DB.*`.
- Every screen reads from the server. `js/data.js` holds the shape and the lookups; the data arrives
  through `DB.hydrate()`.

### Settings is an accordion, and a new card is a fold

Eleven unrelated jobs on one page — the receipt printer's paper width above the loyalty tiers above
who is signed in. `viewSettings()` stacks them as folds under five headings; `setFoldStart(id, title,
meta)` / `setFoldEnd()` in `js/app-settings.js` are the wrapper, `setSection(label)` the heading. Add a
card by writing one that returns `setFoldStart(…) + … + setFoldEnd()` and calling it from
`viewSettings()`.

- **`meta` is the point.** It is the line the head carries while the body is shut — the shop name, the
  rate, how many people are online. Without one the folded page is eleven bare nouns and every answer
  costs a click. Wrap anything with digits in `<span dir="ltr">`, or Arabic drags the leading number to
  the far end (`1 USD = 130 SYP` becomes `USD = 130 SYP 1`).
- **A shut section is hidden, not skipped.** Every body is in the DOM either way, so `afterSettings()`
  still binds the scanner probe, fills the shelf list and loads the roles grid behind a head nobody has
  opened. Rendering only what is open would mean re-running that hook on every toggle.
- **Toggling never calls `render()`.** Half these cards hold typed-but-unsaved values — the receipt
  footer, the printer's host, the shop name — and a repaint takes them back to what the server last
  said, mid-sentence. `ACTIONS['set-fold']` moves one attribute.
- Which folds are open lives in `localStorage` under `og.settings.open`, per MACHINE like the sidebar
  rail: the till wants the printer open and the office wants the roles grid, on the same account. Only
  open ones are stored, so a card added later starts shut.

### What is left of the seeded generator

The dataset generator is gone (see above), but its helpers are not: `rnd()`, `ri()`, `pick()`,
`chance()`, the private `whRnd()` and the `splitAcrossWarehouses()` IIFE still sit in `js/data.js`,
and the IIFE still runs at boot — over collections that are now empty, so it does nothing. The old
rule ("one extra `rand()` call shifts every value drawn after it") described data that no longer
exists. **Do not build on these**: a new screen that draws from `rnd()` is a screen inventing
numbers, which is the thing the server-only mode was introduced to end. Deleting them is a separate,
safe decision that nobody has taken yet.

## Permissions — the model to understand before touching any screen

Deny by default. 28 permissions × 5 roles live in the **`role_permissions` table**, editable by a
manager in Settings. `server/lib/auth.js` holds `ALL_PERMISSIONS` (the labels and grouping) and caches
the table in memory; **every write path calls `invalidatePermissions()`** — a stale cache here is a
security bug.

**Two layers, and only one is a boundary:**

- Browser: `Auth.can()` / the `allow()` helper decide what to **draw**. A courtesy.
- Server: `requirePerm()` decides what is **allowed**. The real guard.

If you add a screen showing cost, profit or customer data, guard it in both — and treat the server one
as the actual protection.

### Helpers in `js/app.js` you should reuse rather than re-derive

```js
roleOf()            // 'manager' | 'cashier' | … | null in _shot.html
allow(perm)         // Auth.can(), or true in _shot.html where Auth does not exist
seesCost()          // allow('cost.read')
seesProfit()        // allow('profit.read')
isPartnerAccount()  // Yalla Wear — locked into their portal
navAllowed(id)      // per-screen gate, via the NAV_PERM map
ifNav(view, html)   // wrap in-page shortcut buttons ("View all →")
```

`allow()` returns **true** only when `Auth` is undefined, which now means `_shot.html` alone. In the
app it is `Auth.can()`, so a signed-out browser draws nothing — there is no longer a mode where
everything is permitted because nothing is real.

### Two rules enforced in code, not in the table

In `server/lib/auth.js`:

- **`PINNED`** — `manager` always keeps `config.write` and `staff.write`. A manager who removes their own
  access to Settings leaves nobody able to put it back without opening the database by hand.
- **`FORBIDDEN`** — `partner` (Yalla Wear) can never be granted `customer.*`, `cost.read`, `profit.read`,
  `money.*`, `staff.*`, `delivery.*` or `discount.unlimited`. They are a different company. One
  mis-clicked box must not hand a supplier your customer list and your margins.

Both are refused server-side and shown disabled with a reason — **a disabled tick box is a suggestion**,
anyone can send the request by hand.

### Home screen is chosen by role

`VIEWS.dashboard` in `js/app.js` is a chooser, not one screen with four moods:

| Role | Home | Built from |
|---|---|---|
| cashier | `viewShiftHome()` — her shift, never the shop's money | `stat`, `card`, `tbl` markup |
| warehouse | `viewBackHome()` — what arrived, what needs moving | same |
| delivery | `viewRunsHome()` → `Deliveries.view()` | live server data |
| manager / `_shot.html` | `viewDashboard()` — the full dashboard | charts |

The partner never reaches it: `boot()` and `render()` both force `OG.print.partner = true` for that role.
**There is no door between the two sides in either direction.** The `partner-view` toggle, the sidebar
entry, the Print-screen buttons, the More-sheet row and the portal's "Back to OG System" were all
removed on request: which side an account sees is decided by its role at login and nothing in the
browser flips it. A scanned partner-invoice QR opens OG's own copy of the bill (`openPartnerInvoice`)
for a shop account and the portal's for Yalla Wear, rather than switching portals.

**`boot()` must apply the same `navAllowed` guard as `go()`.** A bookmarked `#settings` arrives through
`boot()`, not `go()` — that gap was a real bug.

## Server

`server/index.js` routes; `server/lib/` does the work. Migrations are numbered `.sql`, each run in one
transaction and recorded once in `schema_migrations`.

Conventions that are non-negotiable and easy to break:

- **Money is integer minor units + a currency code.** Never floats. USD `minor_exp` 2 (cents), SYP 0
  (whole lira). The shop genuinely prices some goods in dollars and some in lira.
- **The exchange rate is frozen into each sale row.** Without it, re-running last month's profit after
  the rate moves gives a different answer every time and nobody can say which is true.
- **Stock is derived from an append-only movement log**, with the running total written in the same
  transaction under `CHECK (qty >= 0)`.
- **Prices always come from the product table, never from the client.** A till that can name its own
  price can sell a 450,000 pair for 1,000 and leave an ordinary-looking receipt.
- **Idempotency via `applied_ops` + a client-generated `opId`.** A till that loses wifi mid-request does
  not know whether the sale landed; the same `opId` returns the original invoice instead of selling twice.
- SQLite in WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`, `BEGIN IMMEDIATE`. `DB.tx()` refuses to
  nest.
- Passwords: scrypt (N=32768, r=8, keylen=64). Sessions: `HttpOnly` `SameSite=Lax` cookies, 14-day
  sliding expiry. Login is throttled per username and hashes even for unknown users, so timing does not
  leak which accounts exist.

### The startup notices are one list with two readers

The eight standing conditions the server prints after its address block — no accounts · a retired
test account is active · the demo catalogue is loaded · `OG_SECURE` unset · the certificate no
longer names this address · it expires in N days · there is no certificate · `OG_ORIGINS` unset —
are collected once into `notices[]` as `{ code, level, args, lines }` and then read twice.

`lines` is printed exactly as before, in the same order, so **the terminal output is byte-identical**;
`{code, level, args}` rides on the `PanelLink.tell('ready', …)` payload and the launcher writes its
own sentence from `panel/ui/i18n.js`, which is how the same warning can appear in Arabic. Shipping
the English along with it would be the same fact in two places, which is what the list exists to
avoid. **Adding a notice is one entry here and two strings there — never a ninth `console.log`.**

`SyncWorker.start()` also `tell()`s on both of its early returns now. "Off, because there is no
Supabase in `server/.env`" is a finished answer; before this the worker simply never spoke on those
paths and the launcher's mirror card sat on "No word from the mirror yet." for as long as the
window stayed open, which reads as still loading rather than switched off on purpose.

`PanelLink.onAsk` also answers `who` with `Live.presence()`, which is what the launcher asks before
it closes the till. It proves who has the shop OPEN, not who is mid-sale, and the wording says only
that.

### `scrubCost`

`server/index.js` strips cost keys for anyone without `cost.read`, from the row **and from nested
`variants` / `items` arrays**. The nested case was a live leak — every cashier's own invoice response
carried `unit_cost` for every line. `COST_KEYS` is an explicit list; a new cost column must be added to it.

### Deliveries

`server/lib/deliveries.js`. Status moves one way: `waiting → out → delivered | failed`. Migration 045
extended all of this for the delivery office — how a parcel travels, what it costs, what is still
owed, and the board's buttons; `046`/`047` added the sheet it left on and what came back. See **The
delivery office** and **The road** below before changing anything here.

- **A driver is scoped to his own runs in the SQL query**, by role, not by what the request asks for.
- **Someone else's delivery returns 404, not 403** — a driver must not learn that a delivery to that
  address exists by telling the two apart.
- `to_collect` is **read from the sale** (`payment === 'cod' ? total : 0`), never from the request, and
  frozen at assignment.
- Assignment happens **after** the sale is committed, never in the same call. The money is already in the
  drawer; a failed delivery write must not unwind a real sale.

### Discounts

Capped at `config.sale.max_discount_pct` (10). Enforced in `Sales.record` and mirrored in `js/pos.js` so
the cashier is not made to look wrong in front of a customer. `discount.unlimited` lifts it. The server
returns **403 `discount_too_big`** with the real ceiling in the message.

### The loading screen

`js/splash.js` + `css/splash.css`, mounted by `start()` in `js/app-boot.js` before the server is
asked and taken down by `boot()` after the first render. The mark in the middle, a hairline orbit,
and one chip per part of the system waiting in a dim halo outside it; a chip docks onto the orbit
the moment its request lands, with the number it came back with ("Catalogue · 214 products"), and
the arc around the mark is the count. At the end everything pulls into the mark and it pulses once.

- **Progress is real, never a timer.** `Shop.load(onStep)` calls `onStep(name, value)` as each of
  its requests resolves; `Splash.step` queues them and docks one every 95 ms so fifteen answers in
  one frame still read as a sequence. `Shop.mirrorStatus()` is the last tick (the cloud copy's own
  word on itself, `config.write` only). The floor is 1.5 s from `begin()`, zero under
  `prefers-reduced-motion`, and a boot that never calls `done()` is taken down by a 30 s watchdog.
- **A bundle the account may not ask for is marked `notAsked`** (non-enumerable, set by `want()` /
  `wantAny()` in `js/shop.js`) and docks quiet with a dash. Without it a cashier was shown
  "0 suppliers", which is a lie — the list exists, they may not see it.
- **It snaps in and fades only on the way out.** A fade-in was 260 ms of the shell — drawn underneath
  by a boot that finished before the sequence did — showing through a half-there splash.
- **The stage box holds the halo, not the orbit**, or the waiting chips at the bottom sit on the
  caption. RTL docks counter-clockwise, the arc is mirrored, the dot moves to the left.
- Strings are `sp_*` in `I18N`; adding a request to `REQUESTS` means adding a row to `MODULES` in
  `splash.js` (icon + how to read a number out of the answer) and its `sp_m_*` name, or the chip
  docks with the boxes icon and its raw key.

## Gotchas that will bite you

- **The service worker is cache-first with `ignoreSearch: true`.** After changing anything under `css/`,
  `js/` or `index.html`, **bump `CACHE` in `sw.js`** (`og-system-v15` → `v16`) — the panel's Hard refresh
  button does exactly this and tells the open tabs — *and* add any new JS file to its precache list. Skip this and nobody who has already opened the app ever receives the change —
  no query-string cache-buster will help.
- **Anything that hangs below the topbar depends on `.topbar { z-index: 20 }`** (`css/shell.css`). Two
  invisible stacking contexts fight over it. `.mo-view` leaves a *filling* opacity animation on `#view`,
  and an element mid-animation on opacity is a stacking context — one at level 0 that outlives the
  movement. The partner portal's bar carries `backdrop-filter`, which makes the bar a stacking context
  too, so a child's `z-index: 60` stops competing with the page and the whole bar competes instead, at
  level 0, against a `#view` that comes later in the DOM. The messages panel therefore opened at the
  right size, holding the right rows, and was painted **behind the screen**: nothing appeared, and a tap
  where a message should be went to whatever the page had at that spot. OG's bar has no backdrop-filter,
  which is the only reason its alert bell, account menu and search results were not broken as well.
  Naming a level on the bar settles it for all four. **Test a popover by hit-testing it**
  (`document.elementFromPoint` over its own rectangle), not by checking it exists in the DOM — it existed
  the whole time. And screenshot it *after* its 0.16s fade, or the shot shows a half-transparent panel and
  sends you looking for a second bug.
- **A global function name is a namespace of one, and the second definition wins silently.**
  `js/app-dashboard.js` has owned `firstName()` — no argument, returns the SIGNED-IN person's
  first name — since the greeting was written. A second `firstName(name)` added to
  `js/app-util.js` for the partner presence work was simply replaced by it at load time, so every
  name in the pill and the thread came out as whoever was looking: "Test" printed beside Zaven's
  own face, with his real name still in the tooltip. It is now `personFirst(name)`, and the same
  search found `app-jobs-reports.js` calling `firstName(x.name)` for the Reports chart labels —
  passing an argument to the function that ignores it, so every bar on the employees and suppliers
  charts was labelled with the viewer's own first name. Fixed with it. **Grep for a name before
  defining a global one**; this is the `.pos` class collision from the movement log, in JavaScript.
- **The server sends `X-Frame-Options: DENY`**, so a test harness cannot load the app in an iframe. Drive
  it top-level with a persistent Chrome profile instead (log in on one launch, inspect on the next; the
  session cookie is `HttpOnly` and cannot be forged).
- **Headless Chrome `--virtual-time-budget` makes `setTimeout` fire instantly**, so "wait 1.4s for the app
  to boot" waits for nothing. Poll a real readiness condition. Also give the runner a mouse when testing
  pointer-dependent code: `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`.
- **Files starting with `_` are stripped from the published site** by `make-deploy.ps1` and by CI, and the
  server refuses to serve them. `.nojekyll` stops GitHub deleting them itself.
- **Do not delete `_shot.html`.** It is not a test — it is the screenshot rig `make-proposal.ps1` drives
  to build the Arabic client PDF.
- **PowerShell here is 5.1**: no `&&`/`||`, no heredocs, no ternary; it prepends a UTF-8 BOM when piping
  (which once made a password not match its own confirmation). The Bash tool is available for POSIX.
- `dist/`, `flutter_app/`, `docs/img/`, `docs/fonts/`, `docs/*.pdf` are **deliberately untracked**.
  Committing `dist/` is what previously let the live site drift several versions behind.

## Tests

**There are none — they were removed on request.** 986 checks (858 browser, 128 server) used to gate
deployment. Nothing inspects a push now, so a change that breaks the till reaches the live site as fast
as one that fixes it. Verify your own changes in a browser before pushing.

They are recoverable:

```bash
git checkout d76950a -- server/test _selftest.html _mobile.html \
    _yalla.html _connect.html _stagea.html _codes.html _codetest.html
```

## Deploy

`.github/workflows/deploy.yml` — one job, builds `dist/` and publishes to Pages on push to `main` or a
manual run. It checks whether Pages is enabled and **skips cleanly rather than failing** when it is off
(CI reporting a deliberate choice as a failure trains people to ignore red builds).

Requires **Settings → Pages → Source → "GitHub Actions"**. Until that is set the workflow goes green and
publishes nothing.

## Supabase — a one-way mirror, and the baton

SQLite is the system of record. Supabase is a copy kept for the day this machine dies — and, since
the baton, the way the shop moves between laptops. Nothing reads from it while the server is up.
`npm run supabase:sync` pushes; `npm run supabase:restore` pulls the whole shop back onto a clean
machine, and `npm run supabase:restore -- --wipe` runs the boot pull by hand.

### The boot pull, and the baton

The shop runs on **one laptop at a time**, but which laptop changes. `Restore.pullAtBoot()`
(`server/lib/restore.js`) runs in `index.js` after `DB.open` and **before `listen()`** — nothing can
see a database half-way through being replaced. When the mirror was last written by ANOTHER
database it moves `og.db` into `backups/` (checkpointed, verified — `lib/backup.js`, with a rename
retry because this repo lives under OneDrive), opens a fresh file, restores every table from the
mirror in **one transaction**, mints a **new** lineage id and claims it, and resets the bookmarks.
Booting means "I am the writer now".

Four facts it is built on, all verified in source and all easy to break:

- **A restore copies the lineage id** — `config` is mirrored whole and the id lives in it. Two
  laptops restored from one mirror would share an id and `lineage.js` could not tell them apart.
  The pull calls `Lineage.forget()` and mints. Do not "fix" that by inheriting.
- **The worker checks lineage before EVERY push** (`run()` in `sync-worker.js`), not only at boot —
  the laptop that lost the baton must stop the moment it next tries. It also beats
  `sync_state.shop` every two minutes while live; `STALE_MS` (10 min) in `lineage.js` is five
  missed beats, and it is what tells "closed last night" from "working right now".
- **`Mirror.behind()` is meaningless against another laptop's bookmarks** — they sit in a different
  `change_log` seq space and can read 0 while rows are stranded. `Mirror.unpushed()` counts against
  `sync_local` (migration 038), the record of what THIS machine pushed, written by `advance()` and
  filled in by `adoptCursorsLocally()` on the first boot under an owned lineage. **Never decide a
  wipe on `behind()`.**
- **A mirrored user with no sealed box comes back DISABLED** with random password bytes, so
  `sales.cashier_id` holds; the wipe itself is refused unless an active manager's box opens.

Every guard refuses to the local copy with a reason code, and **no path exits or opens an empty
shop**: `sync_off` · `vault_off` · `unreachable` · `own_lineage` (the same laptop again — skipped:
the mirror is its own copy and a pull would only empty the Telegram outbox) · `mirror_empty` ·
`busy_elsewhere` · `unpushed_local` · `drift` (`lib/drift.js`, **both directions** — `ahead` means
this laptop's code is behind the mirror) · `fetch_failed` · `accounts_unreadable` · `backup_failed`
· `restore_failed` (the moved-aside file is put back). The result rides `GET /api/sync/status` as
`pull` — `MirrorUI` draws it, `backup` is stripped from the live-channel copy, the splash's cloud
chip says "N rows pulled", and `app-boot.js` toasts once per pull. `OG_PULL_AT_BOOT=0` on a dev
copy; `OG_SYNC_MINUTES=0` refuses on its own. `open-when-ready.js` waits four minutes because of
this.

**Cursors after a pull are RESET explicitly** (`resetCursorsAfterPull`: seq cursors → 0, maxid
cursors → local `MAX(id)`, one upsert), not left to the rewind — the rewind would fire one table
at a time, each with a "reset underneath us" warning that is a lie after a deliberate pull.

**`npm run supabase:check` is the one command that answers "is the mirror trustworthy".** It
compares every mirrored table **by primary key** (eight here and eight there is not a match — five
pushed by the shop and three left by a test database add up to eight as well, and that is the shape
the live gap took), names rows sitting at or below their table's bookmark (the sync will never look
at those again; only reconcile will), checks each bookmark against its own table, and reports whether
accounts could actually be recovered — including a mirrored account this shop does not have. It
exits non-zero when the mirror is not a faithful copy, so it can gate a deploy. `--quick` stops
after the connection test. It opens the database through `DB.openReadOnly()`: `DB.open()` applies
pending migrations, and a check that changes the schema it is checking is not read-only.

### The mirror is live, not on a ten-minute timer

**`server/lib/mirror.js` is the one implementation**; `scripts/supabase-sync.js` is a thin CLI
over it (one full run, printed, exit 0/1/2 as before) and `server/lib/sync-worker.js` runs it
**in-process** inside the server. Three triggers, one lane:

1. **The commit hook.** `DB.tx()` fires `DB.onCommit(fn)` listeners after COMMIT with the tables
   `logChange` touched; the worker debounces two seconds and calls `Mirror.pushChanged()`.
2. **A ten-second tick**, the backstop for writes outside a transaction and for the eight tables
   nothing logs (`config`, `role_permissions`, `label_templates`, `clubs`, `notification_reads`,
   `users`, `currencies`, `warehouses`) — those are detected by a content hash.
3. **A full run every hour** (`OG_SYNC_MINUTES`, default 60, `0` = by hand only): settings
   rewritten whole, every cursor walked, every guard exercised. The reconcile relies on this.

`pushChanged()` asks SQLite locally which tables moved past their bookmark and walks only those,
in the same FK order as the full run, so an idle shop makes **no request at all**. Bookmarks are
read from `sync_state` once at boot (`loadCursors`) and held in memory — this process is the only
writer, which is what the lineage guard guarantees. A foreign-key refusal naming a missing parent
(`Key (sale_id)=(INV-2102) is not present in table "sales"`) **heals itself**: the parent is
fetched locally, pushed with its children, and the batch retried once. Every request has a 30 s
deadline (`supabase.js`), a failure backs off 10 s → 5 min, and one push runs at a time.

`GET /api/sync/status` and the **Mirror fold in Settings** (`MirrorUI` in `js/app-settings.js`)
show mode, rows waiting, last push and the reason it is stuck; the same object rides the live
channel (`Live.notify('og', { mirror })`) so the fold repaints without polling, and the Sync
button carries an amber/red dot. The bell fires on **time** (rows waiting and no success for
15 min, or a refused mirror), not on "three failures" — at this cadence three failures is thirty
seconds. Before all this, a foreign key killed every run for a day and the only record was a line
printed to nowhere.

It did not always do this. It used to check the connection and five table names, and printed
"Connected. 5 of 5 core tables present" while five invoices and every delivery were missing —
both statements true, neither the thing anyone wanted to know. **A check that cannot go red is
not a check**; if you extend it, verify the new branch fails on a database you have broken
on purpose.

Three shapes, because three kinds of table behave differently:

| Shape | Tables | How |
|---|---|---|
| **Cursor** | `products` `variants` `stock` `customers` `sales` (+`sale_items`) `deliveries` `print_jobs` (+lines, +stages) `partner_invoices` (+refs, +payments) `job_messages` `suppliers` `employees` `purchase_orders` (+lines) `shifts` `stock_counts` (+lines) | Replays `change_log` from a cursor held in Supabase `sync_state` |
| **Mirror** | `config` `role_permissions` `label_templates` `clubs` `notification_reads` | Pushed whole every run, **and rows deleted here are deleted there** |
| **Append-only** | `fx_rates` `stock_movements` `wa_messages` `expenses` `debt_payments` `print_log` `label_print_log` | Pushed above the highest `id` already sent |

Plus `currencies`, `warehouses` and `users` as plain full upserts.

Things that will bite you:

- **A cursor can outlive the log it points into.** Rebuild the database and `seq` restarts at 1 while
  the cursor sits in the hundreds — every run then reports "nothing new" forever. Both the cursor and
  the append-only paths detect this (a cursor ahead of the highest id that exists) and rewind. Do not
  remove that check. **The comparison must be against that table's own `MAX(seq)`, not the log's.**
  Every table has its own cursor and so can strand on its own; measured against the global maximum a
  busy table permanently masks a quiet one. That was live: `sync:deliveries` sat at 142 while
  deliveries' highest entry was 22, and because `sales` had reached 1001 the rewind never fired and
  the shop's four deliveries reported "nothing new" on every run, for good.
- **A write that skips `logChange` never leaves this machine.** It is not a missing audit line, it is
  a row that exists here and nowhere else, and nothing reports it — the mirror looks healthy. Three
  paths had this and were fixed: the customer address written by `Deliveries.assign`, the automatic
  notices from `Partner.setStage` / `respondToOrder` (which is why the log now lives inside
  `insertMessage`, where a fourth caller cannot miss it), and the zero-delta path in
  `Stock.reconcile`. When adding a write to a cursor-shape table, log it in the same transaction.
- **Deleting locally must delete in the mirror**, or a restore hands back a permission somebody
  deliberately revoked. That is why the settings tables are mirrored rather than upserted.
- **The migrations seed `config`, `role_permissions`, `label_templates`, `currencies`, `warehouses`
  and `fx_rates` with defaults**, so those tables are never empty and the restore's "already has rows"
  guard would skip them forever — handing a rebuilt shop the factory permission matrix instead of the
  manager's. They are in `SEEDED` in `supabase-restore.js` and are replaced from the mirror.
- **Accounts restore before the tables**, because `sales.cashier_id` points at a user. They used to
  come last, and a restore onto a genuinely empty database died on that foreign key partway through.
- Passwords cross only as AES-256-GCM sealed boxes (`server/lib/credvault.js`). Without
  `OG_VAULT_KEY` the restore skips accounts rather than creating ones nobody can sign in to.
  **It is set in `server/.env`, and a copy must live somewhere that is not this machine** — it is the
  only thing that opens the sealed boxes, and `users` is not in the restore's `ORDER` list, so
  without it a rebuilt shop comes back with no way to sign in at all.
- `npm run supabase:reconcile` is the repair tool for **every cursor and append-only table** when
  something wrote rows outside `change_log`, or a bookmark was left above rows that never landed.
  The mirror-shape tables and `users` are rewritten whole on every sync and do not need it. It is
  the **only** thing that recovers a row whose log entry was consumed by a run that did not land
  it — the cursor is legitimately past it, so no rewind will ever look there again. Its comparison
  reports both directions; a table short of rows *in Supabase* is the case that matters, and it
  read as "in step" until that was fixed. It applies the same per-column fallbacks as the sync: the
  day it lacked one it threw on the fourth table and never reached the sales the check had sent
  somebody to repair.

### A column here that the mirror has not got

The local schema migrates itself on boot; the mirror's is applied **by hand** in the dashboard. So
every local migration touching a mirrored table opens a window where PostgREST rejects the row — and
it rejects the **whole batch**, not the column:

```
400  Could not find the 'credit_limit' column of 'customers'
```

- **`server/lib/mirror-lag.js` is the one list of those windows**, imported by both the sync and the
  reconcile. It was kept twice and drifted twice, both the same way — the reconcile's copy short of
  the sync's, so the *repair* tool threw partway down and never reached the rows somebody had been
  sent there to fix. **Adding a column to a mirrored table means adding it there and writing the
  matching `server/supabase/` file, in the same change.** Each entry carries `retriedBy`, because the
  tools deliberately disagree: `print_log` is append-only, so the sync does *not* drop `kind` —
  landing rows and advancing the bookmark past them means nothing ever fills it in. Late is
  recoverable; silently wrong forever is not.
- **`customers` and `sales` are the two that break a whole run**, because both are pushed OUTSIDE the
  guarded block: a rejection there stops customers, sales *and* deliveries, not just the one table.
  `sales.shift_id` has been covered since `005`. `customers` gained three columns in local migration
  `033` and the matching file was written late — measured against the live mirror on 2026-09-02, a
  customer row was rejected outright. The shop was one customer edit away from a day going unmirrored.
- **A fallback is a stopgap, never the answer.** The mirror is what a rebuilt shop is restored *from*,
  and `credit_limit`/`no_credit` decide whether somebody may owe the shop money — a restore missing
  them hands back a shop where every credit rule has quietly reset. That is why the retry names the
  file on every single run rather than settling in.
- **`npm run supabase:drift` is the command that answers "can the next write even land".** Read-only
  on both sides. It reads the columns PostgREST actually exposes, compares them against this
  database's, and **goes red on any difference `mirror-lag.js` has not declared** — so the list can no
  longer quietly fall behind the schema. It is a question about the *shape*, where `supabase:check`
  asks about the *data*; the shape question used to be answered by a day of missing sales instead of
  by a command. Both new branches were verified by breaking `mirror-lag.js` on purpose.

- **The schema files are run by hand in the Supabase dashboard**, `002` through `018` (`001` too,
  on a new project). **`server/supabase/CATCH-UP.sql` is every outstanding one concatenated** — one
  paste instead of four visits; it is generated, every statement is `IF NOT EXISTS`, and re-running it
  is safe. **`016`, `017` and `018` were applied on 2026-09-12** — `supabase:drift` reads green, all
  45 pushed tables column for column, and the six new tables (`order_payments`, `handovers`,
  `handover_lines`, `order_returns`, `order_return_lines`, `customer_credit`) are there with RLS on
  and no policies. `supabase:drift` is the check that answers this, and it is **read-only and
  lineage-free, so it works from any machine** — including one refused from syncing. The data
  backfill is not: `supabase:reconcile` writes, so only the laptop owning the lineage may run it.
- **"DDL cannot be run over the API" WAS WRONG, and it cost this project four hand-run visits.**
  What is true is narrower: PostgREST exposes no SQL function (`exec_sql`, `exec`, `query`, `sql`,
  `run_sql` — all `PGRST202`), and the **service key is not an account credential**, so the
  Management API answers it `401 JWT could not be decoded`. But
  `POST https://api.supabase.com/v1/projects/<ref>/database/query` with a **personal access token**
  (`sbp_…`, from supabase.com/dashboard/account/tokens) runs arbitrary SQL, DDL included — plain
  `fetch`, no dependency, which is the only reason it could belong here. `CATCH-UP.sql` went up that
  way in one pass, 65 statements, HTTP 201. **A personal access token is account-wide**, not
  project-scoped: it manages every project on the account, so it is made for the job, kept out of
  `.env` afterwards, and revoked. That is why this is written down as a route rather than wired into
  a button — the dashboard paste stays the default, and nothing in this repo stores such a token. `002`–`007` are applied on the live mirror. `008` (rooms, and which wall a rack hangs on)
  must be run before the shelf map's rooms mirror at all — until then the sync skips `rooms` by name
  and pushes `sections` without the three placement columns. `009` adds `print_log.kind` (local `027`);
  until it is run the print history block is rejected and retries every run, so nothing is lost, only
  late. `010` adds `loyalty_redemptions` and `wants` plus `print_jobs.customer_id` (local `031`/`032`).
  `011` adds the three `customers` columns (local `033`). `013` adds the four rack-size columns on
  `sections` (local `036`); until it is run the sync pushes racks without their size and names the
  file every run. `002` adds `users.pw_enc` and is easy to forget because the sync only needs it
  once `OG_VAULT_KEY` is set.
- **Running one of these files is only half the repair.** The sync pushed those rows with the missing
  columns *dropped* and its cursor is already past them, so the columns exist afterwards and stay
  NULL. **`npm run supabase:reconcile` is what refills them**, and it is not optional.
- **Every new mirrored table gets `ENABLE ROW LEVEL SECURITY`, with no policies** — `001`'s own
  header states it and every file since repeats it for its own tables. On with no policy means the
  service key still works and nothing else can, which is the entire security model of the mirror:
  there is no per-user authorisation here to get right because no user reaches it. `010` was written
  without it, which was an oversight rather than a decision, and its two tables are the shop's
  customer list joined to their behaviour — the one category `FORBIDDEN` in `server/lib/auth.js`
  refuses even to the print partner. Fixed; check for it when adding a table.
- **One Supabase project, one database.** A second database pointed at the same project is not a
  second copy, it is a second writer: its `users` land beside the first's (upserted, never
  deleted), its run writes its own `change_log` seqs into every `sync_state` cursor, and because
  invoice ids collide (INV-2106 is the next number on both tills) its purge of a demo invoice
  deletes the other machine's real one. That happened on 2026-08-30 and again on 2026-09-03 — the
  second database was not a throwaway test copy but **another live install with the same `.env`**
  (its sealed passwords do not open with this machine's `OG_VAULT_KEY`; its retired accounts are
  disabled the way the Accounts section above describes). Each side's run deleted the other's sales
  and left the other's bookmarks stranded, and the local run then died on the `deliveries → sales`
  foreign key before the history, partner and drawer blocks ran.
  **`server/lib/lineage.js` is the guard**: the first database to sync writes a random id into
  `sync_state` (`lineage`, with hostname and date) and keeps it in its own `config`; sync and
  reconcile compare first and **refuse with exit 2** when the mirror belongs to another database.
  `OG_SYNC_TAKEOVER=1` (or `--takeover`) claims it — a decision about which machine is the shop, made
  by a person, once, and followed by a reconcile. A dev or test copy sets `OG_SYNC_MINUTES=0` or gets
  its own project. `npm run supabase:check` names whose mirror it is and goes red on an account this
  database does not have.
  Until they are run, the sync says so by name and pushes everything else — taking a whole run down
  because one table is missing would stop a day's sales being mirrored over a table nobody has
  created yet.

## The partner half

`server/lib/partner.js` and `server/migrations/015_partner.sql`. Print jobs, the two-way line to
Yalla Wear, the invoices between the two companies, plus `suppliers` and `employees` — which had
never had tables either.

**Three rules live on the server, not in the browser.** `js/data.js` enforces the same ones so nobody
is made to look wrong in front of a customer, but that is a courtesy; this is a different company on
the other side of the boundary.

1. Stages move within `design → sent → printing → delivery → done`, and going back drops the stamps
   for everything at or beyond where it lands, so the history cannot claim a step happened after the
   one that undid it.
2. **Nothing passes `sent` while a shirt has no name on it.** A blank name is a real state — an order
   is taken before the squad is settled — and it is why a kit job carries `print_name NULL`.
3. **`sent` means the printer took the job.** The shop cannot assert that about another company, so
   the stage cannot reach it until `order_state = 'accepted'`. This is checked at or *past* `sent`,
   not only exactly on it — checking the one stage let a drag of two columns step straight over it.

Things worth knowing:

- **A kit job's `qty` and `cost` are derived from its lines and never stored**, so a line and its
  job total cannot disagree. Only bulk jobs carry their own `qty`.
- **`print_job_lines.unit_cost` is what the PRINTER charges**, while `print_jobs.price` is what the
  customer pays — opposite sides of the margin. It is named `unit_cost` so `scrubCost` strips it by
  name; called `price` it would have gone out to every cashier.
- **`employees` is not `users`.** A login is a way into the system; an employee is somebody on the
  payroll. The shop has staff who never sign in, and a login (the partner) who is not staff.
- **`GET /api/partner` is one route with three audiences.** The partner never receives `price`;
  anyone without `cost.read` never receives `cost` or `unit_cost`; `suppliers` needs
  `money.read` and `employees` needs `staff.read`. Each is left out of the response rather than
  hidden in the browser.
- **`requirePerm` accepts a list meaning any-of.** Yalla Wear holds none of the shop's permissions —
  they are not staff — so the routes both companies use are gated on `['print.read','partner.jobs']`.
- The frontend writes **optimistically**: the local model moves first so the board does not sit still
  for a round trip, then `pushPartner` sends it and reloads. A refusal means the local guess was
  wrong, and the reload puts the truth back with a toast saying which rule it was.

## The line to Yalla Wear: messages, the outbox and Telegram

Migration `035_partner_link.sql`, `server/lib/telegram.js`, `js/pulse.js`. What makes the two
companies feel connected rather than merely sharing a table.

- **In-app notifications ARE the message thread.** Every event the other side needs to hear about
  — order sent, accepted, declined, a stage moved, the last name filled in, an invoice, a payment
  recorded, a payment confirmed, a review — is a `job_messages` row written by the server inside
  the same transaction as the change (`insertMessage`). The speech-bubble bell (`js/notify.js`)
  reads them with per-side read flags. There is deliberately no second bell: the alert bell in
  `alerts.js` stays "computed, never stored".
- **`partner_events` is the Telegram OUTBOX and nothing else.** `emitEvent(d, …)` in `partner.js`
  writes it in the same transaction; `telegram.js` drains it every five seconds with the global
  `fetch`, backs off on failure (`next_try_at`, `attempts`, honours 429), and stops on a chat that
  refuses the bot. **It is never mirrored to Supabase** — it is delivery state, and a restored shop
  re-sending three months of "order accepted" to two phones would be a bug. `channel` exists so a
  WhatsApp transport can queue beside it one day.
- **The strip list for the partner lives in `emitEvent`**, keyed on the audience: `customer`,
  `phone`, `customer_id`, `price` never reach Yalla Wear's bot, the same list `GET /api/partner`
  applies. For the shop's own chat the event carries job id, design and quantity only — a staff
  group is wider than `customer.read`.
- **Each side sends to a LIST of chats, not one.** It was one chat per side
  (`telegram.<side>_chat_id`), which is one phone: the manager linked his own and the person on the
  till heard nothing. `telegram.<side>_chats` is a JSON array of `{ id, title, type, at, by }` —
  `by` being the account that pressed Connect, because "who added this group" is the first question
  asked about a chat nobody recognises. Kept in `config` rather than a table of its own on purpose:
  config is mirrored whole, so a laptop restored from the cloud keeps its links, and a new table
  would need a hand-run schema file in the dashboard first. The old single keys are **read forward**
  (a shop upgrading keeps the phone it had) and **written in step** for anything still reading them.
  One event goes to every chat and is marked sent when **at least one** landed — retrying to reach a
  failure would send a second copy to everyone who already has it, and a duplicate "order accepted"
  is worse than a missing one. **A 403 drops that chat from the list**: Telegram is being definite
  (blocked, or kicked from the group), so it would otherwise fail for ever and burn a request per
  event. `POST /api/telegram/unlink` takes a `chatId` for one, or nothing for all; the card's
  Disconnect always names the row it sits on.
- **Two bots, two tokens, in `server/.env`** (`OG_TELEGRAM_TOKEN_OG`, `OG_TELEGRAM_TOKEN_YALLA`).
  Never in `config` — `GET /api/config` hands that table to every login including the partner.
  Chat ids do live in `config` (`telegram.<side>_chat_id`), written by the lib, not by `PUT
  /api/config`. Linking: `POST /api/telegram/link` hands out a six-letter code held **in memory
  for ten minutes**; the person sends it to the bot (or into a group the bot is in); the
  `getUpdates` long-poll matches it and stores the chat. The audience is always the account's
  role, never the body — a partner asking for the shop's code gets their own.
- **Messages are Arabic then English, plain text.** No Markdown: a job id or a name with an
  underscore would break the parse and the message would silently never arrive.
- **The browser is pushed, then it asks.** `GET /api/live` (`server/lib/live.js`) is a
  server-sent-events stream, one per open tab; every partner route ends in `bump()`, which
  kicks the Telegram outbox and writes a one-line `change` event to every open tab. The event
  carries **no data** — `js/pulse.js` then asks `GET /api/partner/pulse` (two counts and a
  stamp) and refetches the bundle through the ordinary gated routes, so the push is never a
  second door past `scrubCost` or the partner strip list. A 45 s poll stays as the backstop and
  the green dot beside the bubble says which one is on. It **never calls `render()` blind**:
  only on the Print screen or inside the partner portal, and only with no modal or drawer open.
  Every new line from the OTHER company gets a toast, a short WebAudio chime and, when the tab is
  hidden, a browser Notification. `DB.hydrate` is never given a partial payload — it would
  empty the catalogue — so the pulse uses `hydratePartner` and refills the alert arrays in place.
- **The partner portal has five screens**, not four: Today, Job queue, Invoices, Earnings and
  **Reviews** (`viewReviews` in `js/yalla.js`) — the shop's rating and words on every finished
  job, with the average, a tap-to-filter distribution, and the quote given the type size rather
  than the metadata. Opening it marks those lines read through `markRead`'s **`kind` filter**,
  so a delay note on the same job stays unread; the nav badge counts `DB.unreadReviews('yalla')`.
  The phone tab bar is the five screens and nothing else — there is no OG behind the portal to go
  back to (see "Home screen is chosen by role").
- **The partner's account lives behind the avatar in the topbar** (`acctButton` / `openAccount` in
  `js/yalla.js`): a bottom sheet on a phone, a modal on a desk, with the name, the role, the live line
  and two actions. **Change password** is the portal's own form over the same `POST /api/auth/password`
  — the rule shown in the meter is the server's (`passwordProblem`: eight characters, not only
  digits), a wrong current password is refused in the form, and success reloads to the login because
  every session died. **Sign out is two taps**, armed for four seconds: the button is under the thumb
  and a pocket tap that logs the printer out mid-shift is a phone call. Portal sheets sit at z 360,
  above the floating tab bar (z 340), or the Save and Sign out buttons are behind it.
- **Yalla Wear is TWO people, and the app says which one.** They are partners, not a company
  login: `zaven` and `zohrab`, both on the `partner` role, so "same access" needs no code — the
  permissions are per role. What needed building is everything downstream of that.
  - **Presence is people, not tabs.** `Live.subscribe` carries the account's name, and
    `Live.presence()` returns `{ og, yalla, people: { og: [...], yalla: [...] }, tabs }` with the
    counts deduplicated per account — one person with the portal open on a phone and a laptop is
    one person online, and counting connections said two. The topbar pill reads "Zaven · online",
    "Zaven + Zohrab", or the company name when nobody is there, and pressing it opens **who is on
    the line**: both companies, everyone this browser has a name for, the ones reading right now
    lit. It repaints itself while open (`paintLive` re-renders `#whoPop`), because somebody
    watching for the other partner to come back should not have to close it.
  - **`GET /api/partner` carries `people`** — `{ id, name, side }` for the ids the payload's own
    rows point at (messages, stage stamps, payments, reviews) and nobody else. Not the staff list:
    that is what `FORBIDDEN`'s `staff.*` ban is about, and this is a name, never a username, a
    role or anything anyone could sign in as. **Both directions**, by the owner's decision — Yalla
    Wear sees which of the shop's people wrote a line, and `reviews` stopped stripping `user_id`
    for them, because a rating with a name on it is feedback and an anonymous one is a score.
  - **The thread, the order timeline and the reviews name the person**, with the company still
    beside them. Every one of those user ids has been in the database since the feature was
    written and was drawn nowhere. The timeline takes the stage stamps for the stages and the
    MESSAGE for the two order rows: "sent" there means the shop posted the job, while the `sent`
    STAGE means the printer took it (the partner rules explain why those differ), so reading the
    stage stamp put Zaven's name against the line about the shop pressing Send.
  - **A person's colour is derived from their account id** (`personTint` / `personHue` in
    `js/app-util.js`, golden-angle hue) and their face is **two letters of the FIRST name**
    (`personFace`) — because Zaven Yalla and Zohrab Yalla have the same initials, so "ZY" on both
    avatars is the one thing a face must never do. `initialsOf()` is untouched: it names an
    account in its own menu, where there is only one person and the surname is worth having.
  - **Telegram names the actor.** `emitEvent` resolves the first name from `userId` at the door —
    the same place the partner strip list lives, for the same reason — and `render()` adds one
    signature line, so a template written later gets it without anyone remembering. Two kinds say
    it inline instead ("Zaven at Yalla Wear accepted order P-1043"), and anything the server did
    by itself (every reminder) has no actor and keeps the company's sentence: a name invented for
    those would be a lie in somebody's pocket at nine in the morning.
- **What is new is decided before anything draws.** `Pulse.apply()` takes the unread list first
  and announces it last: the job drawer and the Reviews page both mark messages read as part of
  rendering, so a toast computed afterwards never fired for the line that had just arrived.
- **Presence rides on every live event.** `Live.presence()` counts open tabs per side; the topbar
  pill reads "Yalla Wear · online" and turns green. A join or a leave carries `who`, which the
  browser uses to repaint the pill *without* refetching the bundle.
- **Yalla Wear's unread lines are in the main bell too** (`partner_msg` in `alerts.js`, key
  `msg:<id>`, shop accounts with `print.read` only). Unread only, so opening the thread removes
  the row and the prune tidies its read mark; tapping one opens the job or invoice.
- **The website's door is the `/api/ext/` prefix**, no session: a bearer key from
  `OG_WEB_API_KEY` in `server/.env`, compared in constant time in the request pipeline, 401 on a
  wrong or missing key and **503 when no key is configured** — which is the state of a shop with
  no website. Everything under the prefix is gated by that one check, so a new route there is
  behind the key by existing rather than by remembering.
  - `POST /api/ext/print-jobs` / `GET /api/ext/print-jobs/:id`. A `reference` (the site's order
    id) is an idempotency key through `applied_ops`. It creates with `source:'web',
    autoSend:true`, prices from `config` `print.unit_price` / `print.partner_unit_cost`
    (950 / 460 defaults, the till's numbers), and the answer never carries the printer's cost.
  - `GET /api/ext/products` / `GET /api/ext/products/:id` — the published catalogue
    (`Cat.webList` / `Cat.webById`). **`hidden = 0 AND on_web = 1 AND demo = 0`**: archived beats
    the website flag, so a line taken off sale cannot stay advertised, and invented demo goods at
    invented prices never reach a public page. The columns are named explicitly rather than
    `SELECT *`, so a cost column added later cannot arrive by itself; a size carries `inStock`
    and never a quantity; money is minor units plus `currency` and `minorExp`, never converted.
    A withdrawn product answers **404, not 403** — the same rule the deliveries use, because
    "no such product" and "not published" are the shop's business to tell apart. There is no
    `since` parameter on purpose: an incremental feed cannot express "this product LEFT the
    site", so a site built on deltas would advertise withdrawn goods forever.
- **A payment is a handshake.** `partner_invoice_payments.recorded_by_side` says who recorded it;
  `confirmed_at` is set by the OTHER side (`confirmPayment` refuses `own_side` with a 409).
  `DB.invoicePaid` counts confirmed money only; `DB.invoicePending` is what is waiting;
  `DB.invoiceOpen` is what can still be recorded. `recordPayment` carries an `opId` through
  `applied_ops` like a debt payment — a retry must find the payment already there. Either side may
  record (`['money.write','partner.invoice']`); the side comes from the role.
- **A review is written once the job is `done`** (`reviewJob`, 409 `not_done` before that),
  editable, one row per job in `job_reviews` (cursor shape, mirrored), shown read-only to the
  partner because it is about their work, and posted into the thread as a `review` message.
- **`Partner.create` takes `source` and `autoSend`.** The till sends `source:'till', autoSend:true`
  and no longer fires a second request at a guessed id; the by-hand form on the Print screen
  (`openNewJob` in `js/app-jobs-reports.js`) does the same with `source:'manual'`. A blank name
  keeps it a draft and the returned job says so (`order_state`, `tbc`).
- **`Partner.stats(tz)`** is the production report — pieces per day and per month, on-time %,
  turnaround, average rating — computed in SQL in the caller's day like the dashboard, so it can
  never quietly become "the last 200". Payout sums are included only for the partner or `cost.read`.
- **The partner boot bug** this all sat behind: `js/shop.js` fetched `/api/catalogue` unwrapped
  (403 for a partner → `Shop.fail`) and asked for `/api/partner` on `print.read`, which the partner
  does not hold. Both are `soft`/`wantAny` now. A real Yalla Wear login boots into its portal.
- **`POST /api/partner-invoices` is gated `['partner.write','partner.invoice']`.** On
  `partner.write` alone the actual partner account could never issue an invoice.

Mirror side: `server/supabase/012_partner_link.sql` (also in `CATCH-UP.sql`), `mirror-lag.js` entries
for `print_jobs.source` and the three payment columns, and `insertChildren` in `supabase-sync.js` —
child rows pushed from a parent's `afterUpsert` used to miss the lagging-column fallback entirely.

## The reminders — the half that speaks when nothing has happened

`server/lib/reminders.js`, migration `041_reminders.sql`. Everything above is **news**: something
changed, `emitEvent` wrote a row inside the same transaction, the drain sent it. Nothing chased
anybody, because **the absence of a response is not an event** — an order could sit `pending` at
Yalla Wear for three days and neither side heard a word, and the shop could close with the shift
open and the only record was a bell in a browser nobody had open at nine at night.

A one-minute tick evaluates a declarative rule table and queues into **the same
`partner_events` outbox**. `drain()` already is the retry engine — batching, `attempts < 12`,
`min(3600, 5*2**attempts)` backoff, 429, 403-drops-the-chat — and a second outbox would be a
second copy of that, with the 403 handling wrong.

- **`041` rebuilds `partner_events`** to drop the `ref_type` CHECK (a stock or shift reminder is
  neither a job nor an invoice) and add `dedupe`. Cheap, because the table is deliberately
  unmirrored: no `server/supabase/` file, no `mirror-lag.js` entry, no drift window, and
  `supabase:drift` stays green. **The CHECK went rather than growing a longer list**, for the
  reason `kind` never had one — it is a routing label, not a foreign key, and widening it to eight
  values just moves the next rebuild to the next family of reminders. A synthetic ref
  (`ref_type='job', ref_id='shift:SH-0042'`) was rejected: it lies in a column a bot command will
  query.
- **"Already said" is a partial UNIQUE index, not a variable.**
  `dedupe = rem:<ruleId>:<ref>:<occasion>`, so **the row that was sent IS the record that it was
  said** — a restart, a laptop taking the baton, or a dev copy on the same file cannot double-send.
  The occasion is a shop-local **day key** (the nightly close), a **step** off an instant the row
  already carries (`6h` since `order_sent_at`), or a **calendar bucket** only where there is no
  start instant, which is stock alone. A step is better than a bucket: a server that was off at
  hour four fires **late and once** rather than skipping or repeating. Repeating and once-only are
  the same mechanism — one occasion or several — and every repeating rule has a cap, because a
  reminder nobody acts on stops being read.
- **`Partner.queueEvent` is the only way in**, and it requires a `dedupe`. `emitEvent` is private
  on purpose (the strip is done once at the door), so a scheduler writing its own INSERT would be
  a second door past `PARTNER_STRIP` — one reminder carrying a customer name or the shop's price
  onto another company's phone. Verified: a `yl_*` reminder handed `customer`, `phone`, `price`
  and `customerId` stores none of them.
- **It never opens a transaction to decide.** Candidates are pre-filtered with an indexed read;
  `DB.tx` fires the commit hook and `sync-worker.js` schedules a mirror push on it, so a tick that
  opened one every minute would wake the mirror every minute for nothing.
- **Quiet hours are enforced at the insert, never in `drain()`** — `drain` also carries the real
  events, and an order accepted at two in the morning is news that goes out at two in the morning.
  A suppressed reminder keeps its key and lands on the first tick after eight. Quiet defaults to
  **midnight–08:00, not 23:00**: with quiet at 23 the close (21) and the shift nudge (22) shared
  one hour, and a night the server was busy at ten past ten swallowed both, because the day key had
  rolled by the time quiet lifted.
- **`shift_open` has two ways in**, and the second is the one that matters: the set hour, and *any*
  hour once the drawer has been open since an earlier shop day. That is not a late evening, it is a
  shift somebody forgot, and it must not depend on the server being awake for one hour of the night.
- **Nothing is queued for a side with no bot or no linked chat.** Those rows would all arrive the
  day somebody links a phone — February's "the shift is still open" delivered in March.
- **`BURST` is six per audience per tick.** `partner_events` is unmirrored, so a laptop that takes
  the baton starts with an empty ledger and re-says everything still true; six a minute is a
  catch-up rather than thirty at once.
- **`shop.tz_minutes` (180) is the first server-side notion of the shop's day.** Everywhere else
  the day belongs to the browser — the dashboard and the reports are handed two instants and a zone
  — but a scheduler has no browser to ask. A `Date` shifted by the offset has UTC fields that *are*
  shop-local, the trick `Partner.stats` already uses. The fold shows the resulting clock and offers
  the device's offset when the two disagree, because a wrong offset is otherwise invisible until
  the nightly close has been arriving at four in the morning for a week.
- **Five queries were lifted out of `alerts.js`, not copied**: `stockOut`, `criticalCount`,
  `poLate`, `jobsLate({basis})`, `unreadFromYalla({olderThanIso, oldestFirst})`. `list()` calls
  them and the bell's behaviour is unchanged — same SQL, same LIMITs, the bell's values as the
  defaults. `Dashboard.takingsIn` came out of `build()` the same way. **`jobsLate`'s `basis` is why
  it takes options**: the bell says `deadline`, what the shop promised its customer; a reminder
  pointed at Yalla Wear says `promise` — `COALESCE(order_promised_at, deadline)`, their own word
  first, and the ladder `Partner.stats` scores their on-time percentage on. Nagging another company
  against a number they are not measured on is how a bot gets muted.
- **`job_late` counts calendar days and will not say "0 days late".** Keyed on hours it disagreed
  with itself across midnight — the row said "1 day past" under a key that had already gone out
  saying "0 days past" — and the bell counts a job late from the first moment of its own due date,
  because a bare `YYYY-MM-DD` deadline compares as text against a full instant. Right for a badge
  meaning "look at this today"; wrong for a sentence claiming the shop broke a promise.
- **Two rules stay silent on an empty day.** `day_close` skips a day with no invoices *and* no
  shift opened (Friday, a holiday); `yl_digest` skips a morning with no work at all. Zero takings
  on a day somebody *did* open the drawer still goes out — that is a fact worth having.
- **17 rules, one config key each, and the ids are shared.** `reminders.<id>` is the switch,
  `RULE_IDS` is the server's list and `REMINDER_RULES` in `js/app-settings.js` is the browser's;
  adding a rule means one row there and two i18n strings (`rem_<id>`, `rem_<id>_sub`) in **both**
  tables. `CONFIG_WRITABLE` opened `^reminders\.` and `shop.tz_minutes`.
- **A switch is ONE key with two writers, never two keys.** Yalla Wear moves their own five from
  their portal through `PUT /api/reminders/config` — a route of its own because their allow-list
  (`^reminders\.yl_`) is narrower than the permission they hold — and OG's manager writes the same
  keys through `PUT /api/config`. Last write wins. What is *not* shared is `reminders.yalla_paused`,
  OG's master override, ANDed with each `yl_*` switch and refused to a partner account.
  **The portal has its own strings** (`rem_p_*`): the Settings copy is written *about* them ("tells
  THEM the press is waiting on names from THIS side") and reads in their own portal as a
  description of somebody else's bot.
- **`POST /api/reminders/preview` is the whole test strategy.** It evaluates every rule and returns
  the rendered Arabic and English **without queueing a row**, and `at` moves the clock, so the
  nine-o'clock digest can be read at two in the afternoon and the whole thing tried on the real
  shop with nobody's phone buzzing. It is also a permanent part of the fold — a list of rule names
  is not something anybody can judge; the sentence is.
- **The phase-2 seam is in, the router is not.** `lib/telegram-commands.js` returns `false` for
  every message; what is settled is the call site in `handleUpdate` and its arguments —
  `Telegram.isLinked(side, chatId)` (**the linked-chat list IS the authorisation**, since a chat
  carries no session), `Telegram.send`, `renderFor`, `callback_query` already in `allowed_updates`,
  `partner_events_ref (audience, kind, ref_id)` as the index `/job P-1043` will use, and the two
  `reminders.muted_until_*` keys honoured from day one so `/mute 2h` needs no new state. Every
  command planned is a READ: a command that changes shop state from a chat is a second write door
  past `requirePerm`, and needs its own decision.
- `shutdown()` now calls `Reminders.stop()`, `Telegram.stop()` (written long ago, never called) and
  `SyncWorker.stop()` by name. Not a hang fix — `.unref()` already covered that — but the panel's
  Stop otherwise left a 25 s `getUpdates` long-poll and a live mirror push racing the 5 s hard exit,
  and a reminder queued *during* a shutdown is a message about a shop that is closing.

## Each chat gets only what that person asked for

Every message went to every linked chat, which was right when a side had one phone on it and wrong
the moment it had three: the person in the back room wants to hear that a size hit zero and has no
business being told the day's takings, and the owner does not want a notification every time a
shirt gets a name.

So a chat entry in `config['telegram.<side>_chats']` carries **`rules`** — the list of kinds it
accepts — and **`userId`**, the account that pressed Connect. No migration and no schema change:
`config` is mirrored whole, so the routing survives the laptop baton for free.

- **`rules: null` means EVERYTHING**, and that is what every chat linked before this exists as, so
  nothing already working changed. An empty array means nothing, which is a real and different
  answer — hence `Array.isArray`, never a truthiness test.
- **Every kind is routable, not only the reminders.** Filtering the nudges and not the live events
  would be strange, and both already pass through the same place. `KIND_GROUPS` in `telegram.js`
  is the one list: **day · stock · print · yl · live** (the ten real-time `emitEvent` kinds). It
  rides out on `GET /api/telegram/status` so the browser draws the tick boxes from THAT list and
  not a second copy — a kind added there appears on screen with two i18n strings and no other edit.
  `test` is deliberately in no group: the Test button means "does this chat work", and a test
  message that silently went nowhere would be the worst possible answer.
- **The filter is one line in `drain()`**, inside the chat loop — the single point both reminders
  and events pass through, so there is exactly one copy of the rule.
- **A row nobody subscribed to is marked SENT, not retried.** Left to the existing branch,
  `landed === 0` backs off and tries again until the twelfth attempt: a request every few seconds
  for a message no chat has asked for. It is stamped with `error: 'no chat on this side is
  subscribed to <kind>'` so the card can say so rather than showing a mysterious backlog.
- **A new chat gets everything EXCEPT the money kinds** (`rem_day_close`, `rem_cash_variance` —
  `DEFAULT_RULES`). Somebody in the warehouse links their phone to hear about stock and must not be
  handed the day's takings because nobody remembered to untick it. Turning them on is a deliberate
  act on a screen that names the chat it is doing it to. **Re-linking keeps the rules a chat
  already had**, or checking that the bot still works would silently reset somebody's choices.
- **The screen** is the Telegram card, in Settings and in the partner's portal — the same component.
  Each row grows a summary line ("Everything", "Stock (3/4) · As it happens") and a **Choose**
  button opening a picker: five group switches, their kinds indented underneath. The group tick is
  a shortcut for its own kinds and nothing more — **the stored unit stays the kind**, so "stock but
  not the purchase orders" survives a round trip. It writes on **Save**, not on every tick: a round
  trip per checkbox on a shop wifi is how a list of seventeen ends up half written.
- **Everything ticked is stored as `null`**, not as a list of today's kinds — an explicit list would
  silently exclude a kind added next month.
- **`PUT /api/telegram/chat`**, gated `['config.write','partner.jobs']`, side from the account's
  role and never the body. The manager owns the shop's chats; Yalla Wear owns theirs.
- **`.switch input:indeterminate + i` had to be written.** A half-ticked group sets `indeterminate`,
  which is *not* `checked`, so the head drew identically to fully OFF and lied about its own
  contents. The knob now stops at 9px between the two ends on a dimmed lime track. A literal
  `#6E7A1E` rather than `color-mix()`, which is Chrome 111 and this runs on the shop's hardware.

## The bots answer, and two buttons act

`server/lib/telegram-commands.js`. `/help` `/queue` `/today` `/late` `/job P-1043` `/status`
`/mute 2h` `/unmute`, on both bots, each answering only its own side.

- **The linked-chat list IS the authorisation.** A Telegram chat carries no session and no account;
  there is nothing else to check against. `linked` is computed in `telegram.js` and handed in. An
  unlinked chat gets the ordinary "send your link code" line and **never a hint the command
  exists** — not "you are not allowed", which confirms there is something behind it.
- **The side comes from the bot, never the message**, exactly as `tgSide()` decides it from the
  role on the HTTP side. `/job` proves it: the shop is told the customer, Yalla Wear is not — the
  same strip `GET /api/partner` applies, restated because this is a different door into the row.
- **`/mute 2h` needed no new state** — it writes `reminders.muted_until_<side>`, which the
  scheduler has honoured since the day it was written.
- **`keyboardFor()` decides the buttons**, and it is deliberately small. An unanswered order on
  Yalla's bot gets **Accept / Decline**; any reminder gets **Mute 2h**; a live event gets nothing.
  Accept is the one write in the whole file: it is a decision the partner side is entitled to make,
  it is refused unless the order is actually `pending`, and the **Telegram name that pressed it
  goes into `order_note`** — which is the only reason it is allowed to be a button. Money, stage
  moves and voids get none, because a chat is a room whose membership nobody in this system
  controls.
- **A button press is not a message.** It arrives as `callback_query` with its own id and Telegram
  spins the button until that id is answered, so `answerCallbackQuery` goes out whatever happens,
  including on the way out of a throw.
- **Error codes are on `.code`, not `.message`** — `respondToOrder` throws
  `Error('no order is waiting on a reply')` with `code: 'not_pending'`. Matching the message caught
  nothing and put the raw sentence in a toast.

## Eight more reminders — the shelves, the runs, the regulars, the morning

Migration `043`, `server/lib/stockwatch.js`. Twenty-five rules now; `REMINDER_RULES` in
`js/app-settings.js` and `RULE_IDS` on the server are still the two lists, and adding one is still
a row in each plus `rem_<id>` / `rem_<id>_sub` in **both** i18n tables.

**`stockwatch.js` is where the four questions about stock live**, and two of them had only ever been
answered in the browser: `DB.floorOuts()` and `DB.reorderSuggestions()` (`js/data.js`) run over
`DB.liveVariants()`, which is whatever the last hydrate loaded — the last-200 problem in miniature.
In SQL they can be asked at nine in the morning by something with no browser. Four rules apply to
every query there: `p.hidden = 0` (an archived line is not stock), every query capped and ordered,
money as minor units plus a currency and never summed, and **what counts as normal is read from
this shop's own sales** — a size it has never sold is not a gap.

| id | what it says | why it earns a message |
|---|---|---|
| `floor_empty` | zero on the shop floor, pieces still in the back, fastest-selling size first | The only one with a customer standing in the shop attached to it — fixed by walking twenty metres, not by a purchase order. Ranked above the buying questions for that reason. |
| `reorder_due` | running low against how fast it actually sells here, with weeks of cover | **`have > 0` is deliberate**: a size at zero is `stock_out`'s business, and "0 left, 0 weeks of cover" is a sentence that tells nobody anything. The two rules are kept disjoint. |
| `size_run_broken` | the sizes that sell here are gone, the odd ends remain | Reads as in stock in every total and cannot be sold. Ships **off** — it is a judgement, and the threshold will be wrong until somebody has read the preview. |
| `dead_stock` | pieces that have not moved at all, and the money in them at cost | Ships **off**, same reason. |
| `run_out_long` | a delivery `out` for hours that nobody has marked | |
| `driver_cash` | cash collected today and never handed in | **Addressed to the driver**, so the name leads the sentence. |
| `customer_quiet` | regulars quiet past their **own** usual gap | `Customers.quietList()` — the browser's rule moved to the server rather than copied, so one answer. |
| `og_digest` | the owner's morning: yesterday's money, today's work, the shelves, the people | |

- **`dead_stock` and `customer_quiet` are the only table scans in the table**, so both are gated on
  **one hour of the day before the query runs**, the way `day_close` gates on `c.hour` — not
  filtered afterwards. Every other rule is an indexed, `LIMIT`ed read, and a scan on a
  sixty-second tick is a different kind of object.
- **A zero inside a digest section is noise.** "0 worth reordering" is true and tells nobody
  anything, and three of them in a row teaches the eye to skip the line — so each part appears only
  when it has something to say, which is the whole-message rule applied one level down. The digest
  reports **yesterday's** takings: at nine in the morning "0 today" would be true and useless.
- **`run_hours`, not `delivery_stuck_hours`.** That key already belongs to the **print** rule
  `job_stuck`, and one name for two rules means editing an hour here silently retunes a job on the
  other side of the shop.
- **A missing config key reads as ON** (`on()` in `reminders.js`), so `043` names every one of the
  eight explicitly — a rule shipped without its row would be live on the day it landed.
- **`nextDaily()` had to learn the third daily rule.** It hardcoded `day_close` and `yl_digest`; a
  daily rule left out of that list cannot say when it next fires, which is the one number that
  proves the time zone is right.
- **Rule order is load-bearing twice**: `BURST` is six per side per tick and the severity sort
  follows table order, so a rule appended at the end ranks last and a cold start takes days to
  reach it. The new rules are inserted at their proper severity.
- **Two new kind groups**, `runs` and `people`, so the Telegram picker and the Settings fold both
  gain a heading from one edit. `KIND_SINCE` marks all eight as version 2 — see `rulesV` below,
  which is why they reach a chat linked before they existed.

## Who a message is for — roles, people, and the phone in somebody's pocket

Migration `042`. Every reminder used to be aimed at an **audience** — `og` or `yalla` — and nothing
narrowed below that, so "the shift is still open" went to the owner at ten at night rather than to
the cashier who left it open, and a phone was configured by a manager ticking seventeen boxes
rather than by the fact that its owner is the warehouse.

- **`partner_events.to_user` is one nullable column, and NULL still means the whole side.** No
  foreign key: `foreign_keys = ON`, and a three-month-old delivery record must not be why a user
  row cannot be deleted — the same call `041` made for `ref_type`, and for the same reason. No
  index either; `drain()` reads twenty rows and filters in JS.
- **`chat.userId` IS PROVENANCE AND NOT IDENTITY**, and confusing the two breaks the whole feature.
  It is *who pressed Connect* (`telegram.js` says so where it is written), so a manager who links
  the warehouse **group** stamps that group with his own id. Reading it as "whose phone this is"
  would have given the shop floor the manager's preset — money included — and every message
  addressed to any person. Identity is **`person`**, set only for a `type === 'private'` chat, at
  link time, and never inferred. **A group has no person**, which is the honest answer for a room
  whose membership nobody in this system controls.
  - The one exception is a **grandfather clause**, scoped to `type === 'private'` and nothing else:
    a private chat linked before any of this recorded an account still answers commands, because
    until this change the routes were gated on `config.write` and it could only have been put there
    by somebody who runs the shop. The live shop's only linked chat is exactly that. `status()`
    reports `ownerless` so the card can say "reconnect this to give it an owner".
- **The owner clause asks `Auth.can(user, 'config.write')`, never `role === 'manager'`.** The
  permission table is the authority and is cache-invalidated on every write path, `PINNED`
  guarantees a manager cannot lose it, and `Auth.can` returns false for an **inactive** account —
  which closes the departed-employee hole in the same line that answers the question.
- **A chat follows its role until somebody chooses by hand.** `preset: 'role'` resolves through
  `config['reminders.preset.<role>']`; ticking any box writes an explicit list and clears the
  preset, because "the manager can override and the override sticks" is the whole decision. An
  account that is gone, disabled, or whose preset will not parse resolves to **nothing** —
  explicitly, and never by falling through to the `rules`-is-not-an-array convention, which means
  *everything*. Getting that backwards would make a departed employee's phone receive more.
- **`rulesV` is why a rule added next month reaches a chat linked today.** An explicit `rules` array
  is frozen at the moment somebody chose it and can never contain a kind that did not exist yet, so
  a saved list carries the version it was written against and a newer kind is accepted until the
  person next chooses — *they said no to what they were shown, not to what nobody could show them*.
  **The exception is money**, which is never granted by a default, an upgrade, or anything but a
  deliberate tick.
- **`queueEvent` refuses `toUser` on the `yalla` audience.** `PARTNER_STRIP` removes the customer,
  the phone and the price — it does **not** remove a staff name, and an addressed message names the
  person it is about. It also refuses a non-integer: SQLite stores `'lubna'` in an INTEGER column
  without complaint, and the row would then be delivered to nobody.
- **The addressee is part of the dedupe key, and only when there is one.** `…:u<id>` — without it,
  two cashiers with an open shift on the same day collide on one key and the second is dropped at
  the `seen` check, before `INSERT OR IGNORE` could even report it. Appended conditionally, or the
  key of every existing row would change and every standing condition would be re-said on upgrade.
- **The name leads the sentence.** One rendered text goes to the person and to the owner, so it has
  to read as both "you left this open" and "she left this open" — a name at the front does that.
  **Not `args.actor`**, which `render()` prints as a trailing signature and therefore means the
  opposite.
- **`canReach(side, {kind, toUser})` decides at the INSERT.** Queueing a row nobody subscribes to
  and letting `drain()` mark it sent spends the occasion for ever, because the row *is* the ledger.
  A rule addressed to somebody with no phone is queued **unaddressed** instead, so the shop still
  hears it — a standing fact must not vanish because one person never set up Telegram.

**Mute is per chat, and a muted row PARKS rather than being marked sent.** One phone tapping
Mute 2h used to write `reminders.muted_until_og` and silence everybody. Now it writes the chat's
own entry, enforced in `drain()` — the opposite of quiet hours, which are a property of the shop's
night and apply to everyone equally, while a mute belongs to one chat and the row still has to
reach the others. Three things the filter must keep right: it applies only to `rem_*` kinds
(`/mute` promises real events still arrive); a row whose every target is muted gets `next_try_at`
set to the earliest expiry with **`sent_at` untouched and `attempts` not bumped** (bumping would
burn the twelve-attempt wall in three hours against a mute that may run seventy-two, and the row
would then read as `failed`); and nothing may `break` the batch, because rows are `ORDER BY id`
across **both** audiences and one unreachable OG chat would otherwise stall Yalla Wear's queue.

**Everyone links their own phone, and that is safe only because of the command gate.** Linking is
account self-service like `POST /api/auth/password`, but a linked chat carries no session — so
being on the list is the whole *authentication* and can no longer be the whole *authorisation*.
`Commands.handle` resolves the chat's owning account and asks `Auth.can` per command: `/today`
needs `money.read`, `/queue` and `/late` need `print.read`, and `/job` names the customer only on
`customer.read`. Without that, Connect would have been a way past `requirePerm` to the day's
takings for any cashier. Managing *other people's* chats stays on `config.write` throughout, and
a non-manager may never write rules at all — their phone follows their role.

**Two live bugs found on the way:**

- **`linkCode` kept one code per SIDE.** A second person pressing Connect inside ten minutes was
  handed **the first person's code**, and `addChat` then stamped their chat with the first person's
  name and id. Merely confusing while a chat's owner was a subtitle; a mis-attributed preset once
  the owner decides what the phone receives. Keyed per `(side, userId)` now, and spent by whoever
  actually sends it.
- **`GET /api/config` has no permission gate** and returned the whole config table — including
  `telegram.og_chats` and `telegram.yalla_chats` — to every signed-in account, **Yalla Wear
  included**: another company holding the shop's staff group ids. The six chat keys are stripped
  for callers without `config.write`. Not moved out of `config`, because config is mirrored whole
  and that is the entire reason the links survive a restore onto another laptop.

**What this still cannot answer** is "did Lubna actually get it". A row is marked sent when **one**
target lands, so there is no per-recipient delivery record. Said in the migration comment rather
than implied away by a screen.

## The bot explains itself, and BotFather is not where it is written

A bot that only ever buzzes is read as spam and muted. Three things now say what it is, and none of
them is typed into @BotFather by hand.

- **The tutorial is pushed at the moment of linking**, as a second message right after the "it
  worked" line — `Commands.welcomeText(side, true)`, sent from the link branch in `telegram.js`.
  That is the one moment somebody is certainly holding the phone and looking at it; a bot that
  explains itself a week later explains itself to nobody. It is also what `/start` and `/help`
  return, so there is one text and it cannot drift. It says **what arrives without being asked**
  (the live events, then the reminders) before it lists the commands — a person shown only a
  command list assumes the bot is a search box.
- **`/start` and `/help` are the two doorway commands and answer an UNLINKED chat**, with the
  joining instructions and nothing else — no job, no number, no other command. This is a
  deliberate softening of "an unlinked chat is told nothing": a Start button that does nothing
  reads as a broken bot, and the person pressing it is nearly always the owner with the code on
  his other screen. Every other command keeps the plain link-code line.
- **Arabic and English are two BLOCKS, not two halves of every line.** The first draft put
  `الطلبات عند المطبعة · what the printer has` on each command in both blocks, so the English
  reader skipped an Arabic phrase eight times. `COMMAND_MENU` carries `[name, arg, ar, en]` and
  each block is rendered in one language. The example argument lives in its own column because a
  Telegram command NAME may only be `[a-z0-9_]`, so `/job P-1043` cannot be the name.

**The command menu is published per LINKED CHAT, never the default scope.** `syncCommands()` in
`telegram.js` calls `setMyCommands` with `scope: {type:'chat'}` for every linked chat, in English
and again with `language_code: 'ar'` — a phone set to Arabic gets an Arabic menu, which is the
common case here and something BotFather cannot do at all. The default scope holds `/start` and
`/help` only (`PUBLIC_MENU`), so a stranger who finds the bot is not handed a map of the shop.
Republished on **every boot**, not only at link time: the list changes when the code does, and a
chat linked before a command existed would otherwise never be offered it. `unlink` calls
`deleteMyCommands` for **both** language sets — a `language_code` set is its own record, and
deleting only the default leaves an Arabic phone with a menu for a chat that no longer answers.

**`npm run botfather`** (`server/scripts/botfather.js`) writes the rest: `setMyDescription` — the
text filling the empty chat *before* anybody presses Start, which was blank — `setMyShortDescription`
(the About line) and the public menu, each in both languages, for both bots. `--dry` prints every
call and sends nothing. Length is checked locally first, because the API refuses the whole call
with a description that names no number. It reads `BOT_IDENTITY` and `COMMAND_MENU` out of
`telegram-commands.js`, so the shop's own words and the bot's face are one source of truth.
**What is genuinely left for BotFather is the profile photo and the name**, both pictures rather
than text; the script prints them at the end, with `/setprivacy` and `/setjoingroups` to check once.

**PRIVACY MODE IS WHY A LINK CODE MUST BE `/start CODE` IN A GROUP.** A bot in a group has privacy
mode on by default and is handed only messages beginning with `/` — so the bare six-letter code,
which is what the card told people to send, is **never delivered** and the card waits for ever.
Privacy stays ON (every command starts with a slash anyway, and the alternative is the bot reading
a staff group's whole conversation); the instruction changed instead, on the card (`tg_group_hint`,
with the actual code written into it) and in the bot's own joining message.

**Testing it without spamming the shop.** A scratch copy of `og.db`, a bogus `OG_TELEGRAM_TOKEN_*`
(**not an empty one — PowerShell deletes an env var set to `""`, and the server then reads the real
token out of `.env` and long-polls the live bots**) and a fake chat id in `telegram.<side>_chats`.
`canReach()` only asks whether a token and a chat exist, so that opens the queue path with no
network at all, and any row that did try to send is refused with "chat not found". A UI check must
click `.fold-btn`, not `.fold-head` — the delegation uses `closest()`, which walks up — and must
**hit-test** the result, because clicking the head left the preview blocks in the DOM at 0×0.

**`handleUpdate` is private, so drive the POLL LOOP instead of calling it.** Intercept
`globalThis.fetch`, answer `getUpdates` with a crafted update and `getMe` with a username, and
every reply — `sendMessage`, `setMyCommands`, `deleteMyCommands` — is read back off the wire with
its true body, including `reply_markup` and `language_code`. That is the whole path the shop runs,
not a re-implementation of it. Wait on the call appearing rather than on a sleep: the loop is a
real async loop and a fixed pause is a guess about it.

To watch the outbox without a network, replace **`globalThis.fetch`** — `call()` uses the global,
so an interceptor sees the real request body including `reply_markup`, and an ES module namespace
is frozen so the export cannot be stubbed anyway.

**`getComputedStyle` LIES IN HEADLESS ABOUT ANY TRANSITIONED PROPERTY.** `.switch i` transitions
`background` and the knob's `transform`; a headless page with no visible frame never advances the
transition, so the computed value stays at the START for ever. Three switches in three genuinely
different states all measured as the same lime over a DOM that was demonstrably correct. Inject
`*{transition:none!important;animation:none!important}` and force a reflow before measuring — the
same family as screenshotting a popover mid-fade.

## Known open work

- The **supplier and payroll editors do not exist**. `Shop.saveSupplier` / `saveEmployee` and their
  routes are live and tested; there is simply no screen. Same for adding one size to an existing
  product (`Shop.addVariant`) and cancelling a purchase order (`Shop.cancelPO`). These are listed by
  name in the wiring test so they stay visible rather than becoming permanent.
- **There are endpoints but no website.** `/api/ext/print-jobs` and `/api/ext/products` are both
  live behind `OG_WEB_API_KEY`; nothing calls either yet. The catalogue side is complete — the
  flag, the mirror column, the editor and the read door — so what is missing is the site itself,
  not anything here.
- **Yalla Wear's bot has never been linked.** `telegram.yalla_chats` does not exist, so all five
  `yl_*` rules are skipped with `no_chat` and nothing is queued for them. They link it from their
  portal's Telegram card: Connect → a six-letter code → send it to the bot.
- **Write commands past Accept/Decline are not designed.** A stage move, a payment or a void from a
  chat is a second door past `requirePerm` with no session behind it, in a room whose membership
  nobody in this system controls. Accept/Decline earned its button by being refused unless the
  order is pending and by recording who pressed it; nothing else has that shape yet.
- **WhatsApp push is not built.** The outbox has a `channel` column for it; the WhatsApp Cloud API
  needs a Meta business account and approval before a transport can be written.
- A **draft partner invoice** still lives only in the browser — `partner_invoices.issued` is
  `NOT NULL`, so there is nowhere to put one. Issuing it reaches the server; saving a draft does not.
- Delivery **cash reconciliation** is built — the Cash back tab on the deliveries board, over
  pending `order_payments` (see **The road**). What is still not built is the **orders block on the
  dashboard and in Reports**: money received in the window, what is outstanding, and what is in
  drivers' pockets. Nothing there counts an order's balance today.
- **Telegram says nothing about an order.** The reminders know about runs and a driver's cash; a
  deposit that never turned into the rest, or a parcel a customer has not collected, is not a rule
  yet.
- Bulk catalogue entry; an offline write queue. (The Yalla Wear portal now runs against real data —
  what remains is exposing the server to them: Tailscale or a tunnel, and `OG_ORIGINS` listing the
  address they use.)
- **The lira question is settled by the data**: `fx_rates` holds 1 USD = 130 SYP (set 2026-08-24) and
  every real sale was frozen at it — the shop is on the redenominated lira. The seed that assumed
  13,000 is gone, so nothing in the repo asserts the old scale any more.
- `flutter_app/` fails to build on an Android NDK/`sdkmanager` crash.
- **The demo rows are gone** (`server/scripts/purge-demo.js`; the live database holds zero rows with
  `demo = 1`). `products.demo` and `customers.demo` remain as columns, `GET /api/ext/products` still
  filters on `demo = 0`, and nothing sets either any more.
- **Customers, still open**: the printed loyalty card (held on the ruler test — the app believes a
  sticker is 30 × 30 mm and `labels60.js` was built for 60 × 40), a lint for the cap family, merge
  with no undo, a one-currency credit limit, a wants tab with no "arrived" filter. The full list
  with reasons is `CUSTOMERS.md` → "Still open".

## Customers

`server/lib/customers.js` (`list`, `byId`, `historyFor`, `create`, `update`, `merge`, `archive`,
`adjustPoints`), `server/lib/text.js` (`normPhone`, `foldName`), `server/lib/loyalty.js`,
`server/lib/wants.js`, `server/lib/capped.js`; the screen, the profile and the drawer are
`js/app-customers-scan.js`; migrations `028` to `034`. Built in stages over 31 Aug – 3 Sep 2026 —
**`CUSTOMERS.md` is the record**: the owner's decisions, what each stage built, how it was proved,
and what is still open. This section is how it works now.

- **Money on a customer is a pair**, like everywhere else: `spent_syp` / `spent_usd`, plus
  `spent_usd_equiv` — sort-only, each sale converted at its own frozen rate — and `debt_syp` /
  `debt_usd` / `open_debts` from `Money.openDebts()`, never a second SQL copy. `total_spent` was
  `SUM(total)` across currencies (cents added to lira) and is gone; nothing may bring back a single
  spend figure.
- **A shared phone number is not a duplicate.** `create` and `update` save the row and answer
  **200 with a `warning`** (`phone_taken`, naming the holder and whether they are archived) — never
  a 409 after a write, because a 409 on a row already committed turns every retry into a second
  row. The browser toasts it with an Open button. `phoneHolder(phone, exceptId)` is the one lookup;
  a live holder wins over an archived one.
- **Identity is `foldName` + `normPhone`** — Arabic diacritics, tatweel and the alef/ta-marbuta/ya
  variants folded; `0933…` and `+963 933…` the same number — with **twins in `js/data.js`** that
  carry a "keep in step" comment and a nineteen-row parity table in `CUSTOMERS.md`. `custSearch()`
  is the one "which customer does this text mean" rule; the attach, merge and job-link pickers all
  use it. It had been written three times before it was one.
- **The grid caps at 60 cards** (`CUST_RENDER_CAP`), and `customerRowsShown()` is what **both** the
  grid and `Bulk.visibleIds('customers')` read. They are a pair: the day they disagreed, one tick
  box put 5,000 invisible customers a click from Archive. Every capped reader in the system returns
  `{ rows, shown, total, capped }` from `server/lib/capped.js` with `capped = total > shown` (never
  `shown === limit` — a table of exactly 200 rows is not truncated), and the screen says so through
  `cappedNote` / `cappedCount`. A number derived from a truncated set is the mistake this codebase
  has made most often; the sweep that closed seven of them is in `CUSTOMERS.md`.
- **Quiet is per customer, computed on the server** beside `sizes`: `median_gap_days` is the
  median gap between non-voided purchases (`null` under three — never `0`, which reads as "comes in
  daily"), quiet after `median × customer.quiet_multiplier_tenths / 10` floored at
  `customer.quiet_floor_days`, falling back to `customer.at_risk_days`. `DB.quietCustomers()` feeds
  the card state, the bell and the export — one answer, never derived from `DB.sales`, which is
  200 invoices and would give a different rhythm on a machine that had been open longer. Card
  states are three different things: `.quiet` amber (a nudge), `.fresh` dashed and neutral
  (never-bought is a sale that has not closed, not a warning), ordinary gets nothing.
- **The profile is a second routing layer**, `#customers/<id>` — `parseHash` / `hashFor` /
  `applyRouteParam` in `js/app-routing.js`; every slash-less hash behaves as before. An unknown id
  and a forbidden one draw the same "no such customer" panel, so the page never confirms that
  somebody exists. Back goes to the list. **The timeline is one request** —
  `GET /api/customers/:id/history` carries sales, deliveries (`null` without `delivery.read`, not
  `[]`), print jobs (`null` without `print.read`), wants, redemptions and debts — and every kind is
  one mapper into `{ at, kind, title, sub, tone, act, id, lead }`; 40 rows drawn, the rest behind
  "show older".
- **A driver is scoped in the SQL, by role**, to the customers on the run he is carrying, through a
  narrower SELECT that never computes spend or debt — not stripped afterwards. His history request
  is 404, not 403. What he is not sent hydrates to **`null`, never `0`** (`amountOrNull`,
  `nfOrDash`): zero is a customer who owes nothing, null is a question this account cannot ask.
  The screen is off his navigation by a `navAllowed` rule, not a permission change — `customer.read`
  is what lets his board show names and addresses at all.
- **Two things are decided and must stay so.** `customers.note` is visible to anyone with
  `customer.read`, every cashier included, and the edit form says so on its face. `sales.customer_name`
  is **frozen** — a receipt is a record of that moment; renaming somebody rewrites no invoice, and
  attaching a customer to an old walk-in sale leaves it printed "Walk-in". `invoiceHtml` and
  `receiptHtml` read `sale.customerName`; they used to read the live record, which was the bug.
- **Attaching a customer to a sale after the fact** (`Sales.attachCustomer`) is the only
  `UPDATE sales` beyond the void flag: one transaction, the points earned **at the rate stored on
  the sale**, `points_earned` written onto the row, stamps following with no code because they are
  derived. A cashier may fix a sale in her own open shift; older is the manager's, through the
  **`void`** permission — the first attempt gated on `sale.void`, a name that does not exist, and
  failed silently, which is why `server/lib/permcheck.js` now checks every literal at boot and
  **stops the server** on one that does not exist. Moving a sale between customers is refused.
- **Loyalty** (`server/lib/loyalty.js`; `loyalty.mode` is `points` | `stamps` | `both` | `off`,
  `points` today). **Stamps are derived, never stored**: `SUM(qty)` over non-voided sales minus
  `SUM(stamps_used)` from `loyalty_redemptions` — "items since the last redemption" cannot express
  carry-over and was wrong. A full card is a **state with a button**, not an automatic reward; the
  person at the counter records what was handed over, and `required_then` is frozen onto the row like
  `sales.fx_rate`. Redeeming carries an `opId`, recomputes inside the transaction, and is refused
  `stamps_off` when the mode does not include stamps — the count stays readable, it is arithmetic.
  The bell keys `stamps:<id>`, five named then `stamps:more:<total>` inside its own eight-row budget;
  `DB.fullCardIds()` reads those keys rather than counting again. **Voiding a sale reverses its
  points**, clamped at zero rather than refused (the goods are back on the shelf either way), under
  `loyalty.void_reverses_points`. The 500-point block is `loyalty.redeem_block`. `loyalty.*` is in
  `CONFIG_WRITABLE` only because the Settings fold saves — one debounced writer per config key —
  and stayed shut for two stages while it wrote to memory.
- **The wants list is captured without a habit**: a size looked up at the till while out of stock
  everywhere, with a customer on the basket, is the record (`addVariant`'s genuinely-out branch,
  fire-and-forget). The server drops a same-day repeat and a size that is on the shelf. Answered
  wants are closed, never deleted. The tab is in the warehouse — green when the size has landed —
  and `wants_back` in the bell opens it. Duplicates fold on merge (earliest ask, any answer).
- **Debt and credit.** `debt.collect` is what a cashier holds to take a payment without
  `money.read`; it is named **by name** in `FORBIDDEN`, because the partner ban is
  `startsWith('money.')` and would sail past it. `Money.debtsForCustomer` gives each open debt what
  it was worth *then* (frozen rate) and *now*, both only ever beside the real amount owed. The
  payment path is `Money.payDebt` with its three guards (`opId` minted **before** the send, balance
  recomputed inside the transaction, a part-paid sale refuses to be voided). `credit_limit` is
  **USD cents**, compared by converting each open debt at its own frozen rate; `NULL` is no opinion,
  `0` is no credit at all — they are kept out of `FIELDS` because `clean()` turns `''` into null,
  right for an address and catastrophic for a flag. A credit sale to nobody is refused
  (`credit_needs_customer`), `no_credit` refuses, the limit **warns and lets it through** —
  `sale.warning` rides back on the sale, nine seconds of amber at the till, because a till that
  refuses a regular on a Thursday teaches cashiers to stop attaching customers.
- **Merge** (manager): the user picks the survivor; sales, print jobs and wants repoint, points
  **add**, the stricter credit rule and the lower limit win, the loser is archived with
  `merged_into`, one `logChange` per repointed row — and the ids are captured **before** the
  UPDATE, because read afterwards they were the survivor's whole history. `already_merged` on a
  second attempt. There is no undo.
- **The loyalty card is `CU-` + the zero-padded id**, derived, nothing stored, resolved **first**
  in `resolveScan` so no looser parser can shadow it. At the till with a sale open it attaches and
  **does not navigate** (`POS.refresh()`, not `render()`, which would lose a half-typed discount);
  with an empty basket it opens the profile. `POS.saleOpen()` (a basket with a line) is the same
  guard `#open/customer/<id>` uses. **Printing the card is held** on the ruler test — see
  `CUSTOMERS.md`.
- `print_jobs.customer_id` is set by the till and backfilled **only where a `sale_id` proves it**,
  never by name or phone; a person links the rest from the job drawer. Yalla Wear receives no
  customer field on any job — that route stripped `price` alone for a while, and it was live.
- **Config keys**: `customer.at_risk_days`, `customer.quiet_multiplier_tenths` (tenths, because
  "1,5" is a thing somebody types), `customer.quiet_floor_days`, `loyalty.mode`,
  `loyalty.stamps.*`, `loyalty.redeem_block`, `loyalty.void_reverses_points`. `CONFIG_WRITABLE`
  admits `customer.*` and `loyalty.*`.
- **`logChange(tbl, rowId, op, userId, note, origin)`** since `034`: the fifth parameter is the
  human note every caller was already passing (`points +250: goodwill`, `merged from customer 84`);
  `origin` — a device id, for echo-skipping nothing implements yet — moved to sixth so those notes
  never become bogus origins the day something reads it.

## The delivery office

`server/lib/orders.js`, `js/desk.js`, migration `045_delivery_office.sql`, mirror file
`server/supabase/017_delivery_office.sql`. The shop sells by phone, Instagram and WhatsApp and sends
parcels five ways — its own driver, a transport office, a courier company, abroad (Jordan, Turkey),
or the customer collects. None of that fitted: a delivery could only begin as a **till sale**, the
till knew one method, and the board had **no buttons at all** (the till wrote `driverId: null` and
nothing could assign one).

**AN ORDER IS A SALE, ITS DELIVERY AND ITS PAYMENTS, WRITTEN AS ONE.** `sales.payment = 'order'`
(stock leaves with it — the shoes are in the bag), the 1:1 `deliveries` row extended with how it
travels, and `order_payments`. At the till a delivery is written *after* the sale on purpose — the
money is in the drawer and a failed delivery write must not unwind it. Here nothing has changed
hands before Save, and a sale with no destination would be invisible to the board, so
`Orders.create` is one transaction: `Sales.recordIn` (the body of `record()`, extracted so a caller
holding a transaction can use it — `DB.tx` refuses to nest), the delivery row, the first payments,
`applied_ops`.

- **What is owed is derived.** due = `sales.total` + the fee when `fee_mode = 'invoice'`; paid = the
  order-currency value of every payment in, less every refund. No stored balance, for the reason
  `Money.openDebts` has none.
- **Not the debt machinery.** `openDebts` feeds the dashboard, Reports, the customer badge and the
  credit limit, so every parcel in a van would read as customer debt and a `no_credit` customer
  could not order at all; `payDebt` takes one currency and has nowhere for a transfer reference.
- **A payment keeps what arrived**: `amount` + `currency`, the frozen `fx_rate` (USD → that
  currency, the meaning `sales.fx_rate` has), and `amount_order` — the same money in the order's
  currency, rounded once. A lira deposit against a dollar order is ordinary here.
- **Other cities and abroad are PAID BEFORE SENDING** (`unpaid_before_send`, 409). Only `driver`
  and `pickup` may be paid on receipt; a pickup never goes `out`, it goes straight to delivered.
- **The drawer counts order cash when it is PAID**, not when the sale is written: `Money.summary`
  adds `order_payments WHERE shift_id = ? AND drawer = 1 AND currency = ?`, and the browser's twin
  `DB.shiftSummary` does the same from `DB.orderPayments` — two figures for one cash box that
  disagree is worse than either alone. Dollar cash in a lira drawer is reported beside the count,
  never added into it. A driver's door cash is `handed_in_at IS NULL` until somebody says it
  reached the shop (`POST /api/orders/:id/handin`).
- **Takings stay invoice-based.** The goods left at print and cost is booked then; what the office
  adds is a balance, not a second revenue figure.

**Three bugs this uncovered, all fixed here:**

- **`convert()` multiplies in one direction only** (`sales.js`), and a dollar sale has
  `rate = 1` — so a 450,000-lira pair in a **dollar** order became **$450,000.00**. The till never
  sent a currency, so nothing had tripped over it. Line prices now convert through USD both ways.
- **`js/wedge.js` reads `e.key`**, so on an Arabic keyboard layout a scanned `INV-2105` arrives with
  its letters replaced and only the digits intact. The desk and the board match a slip by its
  **digits** (`^\D{0,4}-?(\d{3,})$`). A global `e.code` fix is a separate decision.
- **`normPhone` knew only Syria**, turning a Jordanian `07…` into a Syrian number — a WhatsApp link
  to a stranger. Jordan, Turkey, `00` prefixes and trunk zeros now; the parity table in
  `CUSTOMERS.md` is the test, and `js/whatsapp.js` no longer keeps a third copy.

**The owner's lists live in `config` as JSON** — `pay.methods`, `pay.accounts`,
`delivery.companies`, `delivery.countries`, `delivery.prices`, `delivery.wh`, `delivery.print` —
because config is mirrored whole: no Supabase file, no drift window, no restore order (the idiom
`telegram.og_chats` uses). Ids are never deleted, only `active: false`, and a row freezes what it
needs (`company_name`, the method id and its `drawer` flag). **`pay.methods` replaced the hardcoded
`PAYMENT_METHODS`** in `js/data.js`: `hydrate` fills `PAYMENT_METHODS`, both label maps and
`DRAWER_METHODS` **in place**, because they are held by reference (`DB.paymentMethods`,
`js/receipt.js` reads the maps as globals). `Sales.record` checks a payment method **exists**, not
that it is a till method — a browser serving yesterday's cached list must not have its sales
refused. `pay.accounts` is stripped from `GET /api/config` for anyone without `config.write`, and
every `delivery.*` key is stripped for the partner.

**The screens.** `js/desk.js` (global `Desk`, classes `.dk-*`) is the office: scan into the order,
customer and destination, the five methods, the fee from the price list, the payment plan
(full / deposit / on receipt) with split payments in either currency, then Save & print. The draft
lives in `localStorage` with its `opId`, so a refresh loses nothing and a retried Save returns the
same order. Panels repaint one at a time (`#dkItems`, `#dkWho`, `#dkSum`) and never through
`render()`. `js/deliveries.js` is the board: every filter answered by the database (status, method,
money, search), money badges, and the buttons that were missing — assign a driver **or** a company,
send out, delivered, failed, take a payment, open the order. A cancelled order stays on the board,
dimmed. Settings gains four folds (`Desk.settingsCards`): methods, companies, price list, transfer
accounts, each saving on its own button.

**What prints.** The 80 mm slip carries a ship-to block, the shipping line, TOTAL DUE, every payment
with its reference and a large REMAINING, and its barcode is always on for an order — that barcode
is how the office and the board find it again. The A4 invoice gains a third "Ship to" column and the
same money block, drawn in the order's own currency (`money()` assumes lira). The customer's public
page `/i/<token>` gains one line saying where the parcel is and what is left to pay — **never the
address, the phone or the shop's transfer details**, because that link gets forwarded.

**The mirror.** `deliveries`' twelve new columns are declared in `mirror-lag.js` (it leads the
unguarded core loop); `order_payments` is **cursor-shape** — a payment is updated when cash is
handed in, which a highest-id bookmark would never see — and is pushed behind **its own guarded
block**, because the partner/drawer block is one `try` and a missing table there would take
`expenses`, `debt_payments` and the read marks with it. **Run `server/supabase/017_delivery_office.sql`
in the dashboard, then `npm run supabase:reconcile`**; until it is run the sync names the file every
run and the boot pull refuses with `drift`, which is the guard working.

**Step 2 is below** — the handover sheet, the driver's cash, and the four returns. What is still
not built: Telegram nudges aimed at orders, and the orders block on the dashboard and in Reports.

## The road — the handover, the cash, and what comes back

`server/lib/orders.js` (the second half), `js/road.js`, migrations `046_the_road.sql` and
`047_return_lines.sql`, mirror file `server/supabase/018_the_road.sql`. Step 1 got a parcel as far
as the counter. This is everything after it.

**THREE TABS ON THE DELIVERIES BOARD, not three entries in the navigation** — one desk, one person,
the same day asked about at three moments. `Road.tab()` is `parcels | handover | cash`, kept per
machine in `localStorage` like the sidebar rail; `Deliveries.boardView` draws the bar and hands the
body to `Road.view()`. The board is the only writer of `#view` on that screen, so `Road` repaints
through `Deliveries.repaint`.

### The sheet somebody signs

A driver or a courier is at the counter with an armful of bags. The office picks the carrier, scans
each slip onto a sheet, prints it, they sign, and **every parcel on it leaves in ONE transaction**.

- **It is all or nothing, and that is the kind thing.** `Orders.handOver` asks
  `blockedReason()` of every line first — the same three rules `Deliveries.update` enforces — and
  refuses the whole sheet with **409 `handover_blocked`** naming each parcel and why. Handing over
  half a sheet and telling somebody afterwards which half is how a parcel reaches Damascus unpaid.
  The browser toasts the server's own sentence.
- **`handover_lines.to_collect` is frozen as it leaves.** The sheet is a receipt for a person
  carrying money; a payment tomorrow must not rewrite what they signed for. A company sheet freezes
  zero — companies never collect for the shop.
- **One open sheet per carrier.** `openHandover` returns the existing open one rather than making a
  second: two half-filled sheets for one driver is how a parcel ends up on neither.
- **The scan box owns the scanner** while the tab is on screen and nothing is open over it
  (`Road.owns()`, wired in `js/app-boot.js` beside the office's). A slip is matched by its
  **digits** (`^\D{0,4}-?(\d{3,})$`), for `js/wedge.js`'s Arabic-layout reason; scanning the same
  slip twice is one parcel (`UNIQUE (handover_id, delivery_id)`), and the second scan is answered
  with the sheet it is already on.
- The printed sheet is the invoice document with a different body — same `.inv-*` classes, plus
  `.inv-sign`, which is the whole reason it is paper.

### The driver's cash

`Orders.driverCash()` / `handInFor()`, `GET /api/driver-cash`, `POST /api/driver-cash/handin`.
Door cash is `drawer = 1, handed_in_at IS NULL` from the moment it is taken — the shop's way of
saying the money is real and not here yet. The tab lists it **per driver and per currency**: a
driver carrying 400,000 lira and $60 is carrying two things, and one number for both would
disagree with the notes on the counter. Handing in stamps every row with the open shift in one
transaction, and says so plainly when no drawer is open rather than refusing.

### A return is four decisions and one mechanism

`order_returns` + `order_return_lines`, `Orders.takeBack`. The owner uses all four —
exchange · keep as credit · refund · keep the shipping — and they differ only in **where the money
goes** and **whether the shipping stays owed**. Underneath:

1. The pieces go back through the ordinary movement log (`Stock.apply`, type `returned`), to the
   place the sale was packed from unless somebody says otherwise.
2. **`due_minor` is what this return takes off the bill** — the shelf price of what came back *as
   it was sold*, plus the shipping unless it is being kept. Stored, never recomputed: a price edit
   next month must not make a settled order owe money again.
3. Money the shop is then holding above what is still owed leaves through a **refund row** — cash,
   a transfer, or `store_credit`, which is the same money staying where it is with the customer's
   name on it. So `paid` falls with `due` and **every outcome lands the order at nil**.

- **Credit is a ledger, not a balance** (`customer_credit`, grant/spend): a stored balance is a
  second source of truth about money and the first part-spend makes it wrong. It is spent on a
  later order through the ordinary payment path — `store_credit` is a payment method like any
  other, checked against the ledger inside the transaction that writes it.
- **`store_credit` is written in code, not seeded** (`SYSTEM_METHODS` + the injection in
  `settings()`), so every shop that already has 045's list gets it with no config migration.
- An exchange grants the credit and `linkExchange` points the return at the order that replaced it;
  there is one way money moves between two orders and one ledger to read.
- A partly returned order is ordinary: `returnable()` answers per size, which is why the lines
  table exists at all.

### The rest

- **The board is live.** Every order and delivery route ends in `Live.notify('og', {deliveries:true})`
  and `js/pulse.js` refetches **only** when the board (or a driver's home) is the screen on show and
  no modal is open. The event carries no data — the reload goes through the same gated route as any
  other read — and `/api/live` gained `delivery.read`/`delivery.desk` so a driver and the office can
  hold the line at all. A parcel that left five minutes ago still showing as waiting is how it gets
  handed to two carriers.
- **The tracking page grew a timeline.** `/i/<token>` lists what has actually happened, stamped:
  placed, each payment, handed over, came back, delivered. A single status pill cannot answer the
  question a tracking link is opened to ask — *has anything moved since I last looked*. Money only
  as amounts and dates: no method, no reference, no account number, because the link gets forwarded.
- **Two reminders were wrong and are fixed.** `driver_cash` now reads pending `order_payments` (per
  driver, per currency, keyed `dayKey:currency` so both messages go out) instead of a day's
  `deliveries.collected`, and no longer says "today" — it is money still in a pocket whichever day
  it was collected. `run_out_long` now has **two clocks**: four hours for our own driver, five days
  (`reminders.ship_days`) for a transport office or a courier, because nagging about a shipment to
  Amman after four hours is how a bot gets muted.
- **The office screen was polished twice over.** Each step head trades its number for a lime tick
  the moment its own condition is met — the same conditions `reasons()` refuses on, so the tick
  cannot lie — and below 860px, where the three columns stack and Save is a screen and a half under
  the scan box, a fixed bar carries the total and Save above the tab bar. Both are the panel's own
  delegated actions: one Save in the code, two on the glass.

**The mirror.** `handovers` (its lines ride on its `afterUpsert`, like `sale_items`), `order_returns`
(same, for `order_return_lines`) and `customer_credit` are cursor-shape and pushed in the guarded
ROAD block beside `order_payments` — every one of them is UPDATED after it is written, which a
highest-id bookmark would never see. **Run `server/supabase/018_the_road.sql` in the dashboard after
017, then `npm run supabase:reconcile`.**

**046 had already run on the shop's own database when the returns were written**, which is why
`due_minor` and `order_return_lines` are in `047` instead. A migration that has been applied is
finished: editing the file would leave this machine on one schema and every other on another, with
`schema_migrations` claiming they match.

### The polish pass (12 Sep 2026), and the audit behind it

Ten readers were sent over the whole delivery system — the office, the board, the three road tabs,
Arabic and RTL, the phone layout, the wiring between screens, refusals and races, the server's
money and guards, everything that prints, and what is missing entirely — and each one's findings
were then checked back against the source by a second agent that refuses by default. **93 findings,
91 confirmed, none refuted**, plus ten more that all ten had missed. The owner picked the scope:
UI and overlapping first, the shipping price list made compulsory, the handover sheet made the
office's, the tracking page rebuilt in Arabic. **The rest of that list is not done** and is the
best map of this system's remaining faults.

What landed:

- **`body[data-overlay]` — while a dialog is open, the floating furniture steps out of the way.**
  Set by `openModal`/`openDrawer`/`closeModal`/`closeDrawer` (`syncOverlay` in `js/app-util.js`),
  **read off the two roots and never counted**: there are four ways out of a modal and a counter
  that one of them forgets leaves the phone's whole navigation hidden for the session. The rule is
  in `css/bulk-gate-responsive.css` beside the tab bar. It fixes three overlaps at once, and none
  of them were cosmetic: the tab bar (z 340) painted over every dialog (backdrop z 200) and was
  **tappable through it** — open Take payment, press Products, and the shop navigated underneath a
  dialog that was still mounted — and it covered the footer of every bottom sheet, which is where
  Save lives. The bulk bar and the office bar joined it there. The partner portal had already met
  this and raised its own sheets to 360; OG's side never did.
- **`.modal-foot` wraps.** The order view carries seven buttons now; with `flex` alone the first
  one hung off the edge of the screen with half its label cut off. On a phone they share the width
  at 44px tall.
- **A scanned pair is a flex row, not five rigid grid tracks.** Measured on the shop's own
  1366×768 laptop: the product-name cell was **0px wide** and the row **326px tall**, one character
  per line — four of the five tracks were `auto` and could not give. Now 228px and 92px, one row at
  1920 and two below that, with no breakpoint to keep in step.
- **Save is on the glass at every width.** `position: sticky` only sticks while the element is
  shorter than the scrollport, and the money panel is ~780px against 610px, so it never stuck:
  Save sat below the bottom edge. Above 1240 the panel is its own scroller with `.dk-close` (Save
  plus the reasons it is disabled) stuck to its bottom; below 1240 — where the panel is drawn full
  width *underneath* both other columns and Save measured 824px below the fold — the fixed
  `.dk-bar` carries it. That bar used to switch on only under 860px.
- **A comma is a decimal point here.** `Desk.toMinor` stripped everything but digits and dots, so
  `12,50` — how everybody in this shop writes twelve and a half — became `1250` and a $12.50
  deposit was recorded as **$1,250**. Three digits after the last separator is a thousands group,
  anything else is the decimal; when both kinds appear the last one wins. Seventeen cases, from
  `2,250` to `1.250,75`, are checked in the harness.
- **The board is cards on a phone — through the mechanism the app already had.**
  `labelWideTables()` (`js/app-routing.js`) gives any table of five columns or more the
  `.tbl-cards` class and copies each header's word onto its cells. The board never got it because
  it repaints itself and so never passed through `render()`; measured, 305px of a 695px table was
  off the right edge, including every button. Fixed by calling that hook from
  `Deliveries.repaint`, **not** by writing a second card-table in `og-skin.css`.
- **The customer's page is Arabic first**, with English one tap away (`?lang=en`, server-side —
  `dir` and `lang` belong on `<html>`, and this page carries no JavaScript by design). It grew a
  four-step **rail** (ordered · payment · on the way · arrived; an arrived parcel is four filled
  dots and no ring, because the ring means "still moving"), and its money is now the server's
  arithmetic — it worked the balance out itself and knew nothing about a parcel that came back, so
  a fully refunded order went on telling its customer they owed the whole amount.
- **The sheet belongs to the office.** Every handover write is `delivery.desk` alone; they were
  also open to `delivery.write`, which a **driver** holds — on his own phone he could open a sheet
  in anybody's name, scan any parcel in the shop onto it and send it out. He also could not be
  stopped from rewriting the address and phone on his own run (the tracking number was guarded and
  these were not). His phone now shows the office's sheet as a **checklist**, grouped by `HO-xxxx`
  with "4 of 11 done".
- **Shipping has to be answered.** The price list ships empty, so every order was saving with no
  shipping on it and the money panel never mentioned it — the shop was giving away the carriage
  without deciding to. Three answers count: a row in the price list (even a zero one), a figure
  typed, or "the customer pays the courier". Silence does not.
- Smaller: the four step heads trade their number for a lime tick when their own condition is met;
  New order asks before throwing away a half-typed order; the WhatsApp messages and the tracking
  link moved into the **order view**, so they are reachable for any order rather than living for
  as long as nobody scans the next customer's shoes; choosing a courier brings its own amount box;
  the scan box is 16px and no longer auto-focuses on a coarse pointer (it threw the keyboard up
  over the screen on arrival); the stepper and ✕ are 38px under a thumb.

**How it is verified.** Seven suites, 271 checks, all green: `verify-046` (migrations, handover,
cash, returns, credit, mirror wiring — on a `VACUUM INTO` copy of the live database),
`smoke-orders` (70 API checks, **not idempotent** — rebuild the base with `make-base.mjs` first),
and five browser suites over CDP — `ui-office` (measures the line, the row height and where Save
is at seven widths from 1366 to 390), `ui-board`, `ui-overlap` (hit-tests what is painted on top
of a dialog), `ui-road`, `ui-track` (both languages). Two harness facts worth keeping: **a browser
spawned by the test script cannot bind its debugging port under the sandbox** — the shell opens it
and the script attaches — and **every tab left behind holds an SSE stream open**, so after six runs
the seventh page never loads at all (six connections per host on HTTP/1.1). Both are in the
scripts' own comments.

## The dashboard

`server/lib/dashboard.js`, `GET /api/dashboard?from=&to=&tz=`. **Every figure on the four home
screens is computed there, in SQL, over every sale.** It used to be summed in the browser from
`DB.sales` — the last 200 invoices — with nothing on screen saying so; the 201st sale of a month
made "30 days" quietly mean "the most recent two hundred". `DB.dash` is the snapshot, replaced
whole on every load (it is one window at one moment, not a collection anyone holds a reference to),
and `Shop.reloadDashboard()` refetches only it for a scope chip.

- **The day belongs to the browser.** The server is UTC and Aleppo is not. `scopeRange()` in
  `js/app-dashboard.js` builds the window from a *fresh* local midnight (never the boot-frozen
  `TODAY`) and sends two ISO instants plus the zone; the server re-normalises both through
  `toISOString()` before binding — `sales.at` is UTC text and a `+03:00` string compares wrongly —
  and aggregates half-open `at >= ? AND at < ?`.
- **Money is a pair, `{ syp, usd }`, never converted and never added.** Every sum is
  `GROUP BY currency`; the hero shows the base currency, dollars taken as dollars are a second
  line, and the only converted figure is labelled approximate at today's rate. Ordering never adds
  the two either (`byType` sorts by units).
- **A block the account may not see is absent, not null**, like `GET /api/partner`: `drawer`,
  `debts`, `suppliers` need `money.read`; `margin` needs `profit.read` and leaves as a percentage
  only; `me` (one's own sales, **by `cashier_id`**, never by name) and `latest` need `sell`;
  `staff` needs `staff.read`. The payload must **not** go through `scrubCost` whole — `COST_KEYS`
  deletes a key literally named `margin`. Only the two sale lists carry items, and only those are
  scrubbed. Every reader in the browser is null-safe and draws "unavailable", never a zero.
- **`Money.summary` is one currency** — the shift's. It used to add a $100 cash sale to a lira
  drawer as 100. Every till sale to date settled in the base currency, so nothing already frozen
  changed.
- `arrivals` counts `type = 'received'` only; the old browser figure counted any positive delta,
  so a transfer to the floor looked like a delivery.

## The admin Reports screen

`server/lib/reports.js`, `GET /api/reports?from=&to=&tz=`, gated `report.read`. The same job
`/api/dashboard` does for the home screens, and it was added for the same reason. Until it existed
the Reports screen was summed **in the browser** out of `DB.sales` and was wrong in two ways at once:

- **THE WINDOW.** `DB.sales` is the last two hundred invoices. "Six months of revenue" meant
  "whatever of the last two hundred fell in six months". The screen carried a `cappedNote` saying
  the LIST was capped; the totals under it went on claiming to be the shop.
- **THE CURRENCY.** It added `s.total` with no regard for `sales.currency` — the browser's sale
  object did not carry one — so a $100 pair went into the month as 100 lira. Every revenue, profit
  and margin figure on the screen was built on that sum.

`DB.rep` is the snapshot, replaced whole on every load like `DB.dash`; `Shop.reloadReports()`
refetches only it for a scope chip. **`DB.monthlySales`, `DB.salesByType`, `DB.profitByType` and
`DB.inventoryValue` are gone** — nothing on this screen is derived locally any more.

- **Six tabs, and a tab the account may not open is not drawn.** `repTabs()` is the browser half;
  each block is gated on its own permission server-side and is **absent** rather than nulled —
  `profit` needs `profit.read`, `payments`/`suppliers` need `money.read`, `employees` needs
  `staff.read`, and `inventory`'s cost half needs `cost.read` (`hasCost: false`, every cost key
  `null`). `repTab()` bounces a bookmarked or revoked tab back to Sales rather than onto a blank
  card.
- **Money is a pair and is drawn as a pair**, everywhere except the chart, which can only plot one
  series and so plots the base currency.
- **`repChartData(tab)` is the ONE description of the chart**, read by both the markup that decides
  whether to put a canvas on the page and the hook that draws into it. They used to be separate and
  disagreed: the Inventory canvas appeared whenever any type had PIECES, while the donut was fed
  CAPITAL — so a shop with no cost prices got a legend, an empty ring and nothing else.
- **The range is said out loud, and it is the range that was asked for.** The old card head printed
  a hardcoded "179 days ago — today" over six calendar months of table, a present-tense inventory
  total and a payroll with no dates in it at all. Stock, payroll and suppliers say `rp_as_of`
  instead.
- **`OG.repScope` is the Reports screen's own window**, deliberately not the dashboard's
  `dashScope`: while one chip drove both, every visit to Reports reset the dashboard.
  `scopeRange(scope, from, to)` grew `month`, `year` and `custom`; `ymdLocal()` reads a date box as
  LOCAL midnight, because `new Date('2026-03-01')` is UTC midnight and in Aleppo that is the small
  hours of the day before.
- **The series carries its empty buckets.** A day the shop took nothing is a fact; closing the gap
  draws a flat line over a hole. Day buckets up to 92 days, calendar months beyond, and the browser
  is told which in `grain` rather than guessing from the string's length.
- **Archived stock is not stock.** `p.hidden = 0` on every inventory query — the rule
  `DB.liveVariants()` enforces everywhere else and which `inventoryValue()` never did. What is left
  out is **named** (`archivedUnits`), because somebody who remembers a bigger number is owed the
  reason it moved.
- **Debt and supplier balances are NOT windowed by the chips.** A sale taken on credit in March is
  still owed in September, and filtering it by "30 days" would understate the shop's exposure by
  exactly the debts outstanding longest. The card says so.
- **Counted nouns are their own keys** (`rp_n_invoice`, `rp_n_supplier`, …). `t('invoices')` is
  الفواتير, "the invoices" — right at the top of a column, and "3 the-invoices" under a number.
  Every count on the screen went through the heading key. Dates use `dir="auto"`, never `dir="ltr"`:
  `fmtDate` puts an Arabic month name among the digits and forcing LTR reorders the phrase.

## The exports, and the logo in the spreadsheet

`js/export.js` writes both files by hand — a store-method ZIP plus the OOXML parts for XLSX, and
HTML through the browser's Save-as-PDF for the document. `js/app-export.js` holds one spec per
screen. **The column spec is what everything turns on**, and it decides both the Excel cell type and
how the printed page draws it:

| | |
|---|---|
| *(none)* | text |
| `num` / `int` | a number, thousands separated |
| `money: 'SYP'\|'USD'` | a number in that currency's own format — **never the same column** |
| `pct` | the percent as a person says it (53.3); divided by 100 on the way in, because Excel's % format multiplies by 100 on the way out |
| `date` | a real Excel serial, built from the LOCAL calendar date |

A cell may be `null`, which is **blank and deliberately not zero**: a supplier billed in dollars has
no lira balance, and somebody with no till login has not sold nothing.

- **The sheet carries the real mark.** There is no PNG in the repo — the mark is `assets/logo.svg` —
  so it is drawn into a canvas at export time and the bytes lifted out of the data URL, then written
  as `xl/media/logo.png` with the drawing, rels and content-type parts that go with it. Cached per
  mark. **Every failure path returns null** (no canvas, an image that will not load, a tainted
  context) and the band renders with the word alone: a missing picture must never cost somebody
  their spreadsheet. A one-column sheet has no B1 for the word to move into, so it goes without.
- **The worksheet's child elements are in a FIXED schema order** — `sheetPr`, `dimension`,
  `sheetViews`, `sheetFormatPr`, `cols`, `sheetData`, `autoFilter`, `mergeCells`, `printOptions`,
  `pageMargins`, `pageSetup`, `headerFooter`, `drawing`. Excel refuses a workbook that gets it wrong,
  with a repair dialog that names no element.
- The header row is frozen, filtered (**never over the totals row** — a filter that hides rows while
  the total stays put is how a spreadsheet lies), and repeated on every printed page via
  `_xlnm.Print_Titles`. Wide reports go landscape, fit-to-width with no page limit. Arabic gets
  `rightToLeft="1"` and a font that actually has Arabic glyphs — Montserrat has none.
- **The PDF chart is REDRAWN for paper**, not lifted off the screen. `Charts.printSnapshot(id)`
  rebuilds it from `Charts`' own record of what the chart was asked for: same type, same numbers,
  same formatter, ink-on-paper colours, animation off, 2x into a detached canvas. The old
  `toDataURL()` of the live canvas put a lime series and `#A1A1AA` axis labels on white A4 — an
  empty box with a yellow squiggle in it.
- `thead` repeats across pages and `tfoot` is forced to `table-row-group`, because a table footer
  otherwise repeats too and prints the grand total once per page. The KPI underline is a border,
  not the `box-shadow` it was — Chrome drops shadows from printed output entirely.
- **An empty report is still a report.** `ACTIONS.export` used to refuse whenever `spec.rows` was
  empty and say "Export failed · None" — two words that are both wrong. Only a spec that does not
  exist is refused now.

## The bell

`server/lib/alerts.js`. Computed on every request from the shop's current state — never stored,
because an alert is a fact about now and a stored alert is a fact about a state that has moved on.

**A row is a kind and its values, not a sentence.** `{ key, kind, args, icon, tone, view, read }`.
The words are written in the browser by `DB.alertText` from `I18N` (`al_<kind>`, with `_1` for a
singular and `al_more_<kind>` for a summary row), so the same row reads correctly in Arabic. The
server used to compose English, which was tolerable in a popover and wrong once the list became
the centre card of an Arabic-first dashboard. Nothing in `args` is formatted: money is minor units
with its currency beside it, days are integers.

**One list, two caps.** `Alerts.list(user, { limit })` returns `{ rows, shown, total, capped }`; the
bell asks for 8, the dashboard's to-do for 50, so the two cannot disagree. Each kind that names
rows has its own `LIMIT` and pushes one `<kind>:more:<total>` summary row when more exist, so the
badge counts what is there. `markRead` marks and prunes against the **uncapped** list — pruning
against the eight would un-read row twelve on the dashboard the next time anyone read anything.
`wants_back` (a size somebody asked for is back in stock, grouped by SKU, gated `stock.read` **or**
`customer.read`) opens the warehouse's wants tab, because it is the back room that knows a box
landed and the warehouse account does not hold `customer.read`.

Two things it gets right that earlier versions did not:

- **Per account.** Supplier debt needs `money.read`, payroll needs `staff.read`. Derived in the
  browser these were filtered only because the data had already been withheld, which was true by
  accident rather than by rule.
- **Read state keyed on what the alert is ABOUT** (`stock:OG-1-42`, `job:P-1043`, `supplier:3`,
  `critical`, `payroll`) and stored per user in `notification_reads`. The first version keyed on the
  alert's **text** and kept it in `localStorage`. Both were wrong: the text changes on its own —
  "due in 3 days" becomes "due in 2 days" — so a read alert came back unread every morning; and
  `localStorage` is per machine, so reading it on the till left it bold in the office.

## Product labels — one label, whichever door

`server/lib/labels.js`, `js/labels.js`, migration `037_label_shelf_slot.sql`. Every "Print labels" in
the app — the Print-labels screen, the Products row and drawer footer, the scan result, the warehouse
form after a save, a bulk selection, the shelf map's reprint — ends in **the same preview**
(`Labels.openPreviewModal`), drawn from the server's layout of a `label_templates` row.

It did not always. There were **three** label engines that disagreed about what the bars carried:
the server one (numeric `label_code` in Code 128), a browser "Label Studio" in `app-warehouse.js`
(the SKU *text* in Code 128, twice as wide, and for an unsaved product an EAN-13 the browser had
**invented** — `whBarcode()` — that the server would never issue), and a third 60x40 layout in
`labels60.js`. Same shoe, three stickers. The studio and the 60x40 product label are gone;
`labels60.js` keeps only the SHELF label, which is about a rack and has no variant to resolve.

- **The bars carry the shop's own `label_code`, on every template.** `barcodeType` defaults to
  `code128`, not `auto`: auto put an EAN-13 on a wide sticker and the label code on a narrow one,
  so the same shoe carried different bars on two rolls. Six digits in Code 128 C is also the most
  scannable thing the head can put down (6 dots a bar on the 60x40 roll). Auto and always-EAN stay
  as chips. Scanning resolves `barcode`, `sku` and `label_code` alike, so nothing already stuck on
  a box stopped working.
- **Two ways out of the preview, per machine** (`lastChoice.output`): `station` queues the server's
  TSPL for the label printer (agent or LAN); `browser` prints the **same layout at true
  millimetres** through this computer's dialog (`printViaBrowser`) — one sticker per page on a
  roll, flowing on an A4 sheet — and records it in `label_print_log` as `printed` through
  `POST /api/labels/record`, the same route and the same honesty as the shelf labels
  (`window.print()` cannot say whether paper moved). With `label.transport = tcp` and no host the
  first choice defaults to `browser`, because that is the state this shop was in: ten failed jobs
  and nothing on screen to say why.
- **The template chips come from `GET /api/labels/templates`**, derived from the rows the renderer
  reads (`templateSummaries`), never from `config.label.presets` — that blob was a second list nobody
  kept in step, and is only the backstop now. `allowEan` is computed with the same arithmetic the
  print uses, so the EAN chip is disabled exactly where a forced EAN-13 would be refused.
- **`shelf` is a slot kind** — where the pair belongs, resolved server-side (`shelfCodeFor`) the way
  `Shelves.labelRowsFor` does it; blank keeps its box. `shelves.js` already counted labels printed
  from a template with an `on` shelf slot as ones a reassignment makes stale; 037 puts one on the
  60x40 row (and re-lays that row out for the roll it is named after, price and date off).
- **The preview draws barcodes at the printer's bar width** — `narrowDots` from the layout, the
  SVG's quiet zone pulled into the margin — so preview, browser print and TSPL are the same width.
  It used to squeeze the default SVG into the box with `width:100%`, 30 mm of bars where 51 mm
  would print.
- **The warehouse form invents nothing.** Sizes say "codes on save"; the button is **Save & print
  labels**, which saves, then opens the preview on the SKUs the server minted with one label per
  piece booked in (`OG.wh.printAfter`, carried through the duplicate guard and dropped if it is
  cancelled). `label.print` gates the button.
- **The Print-labels screen is one row per product, sizes folded underneath** (`viewPrintLabels`,
  `OG.lbOpen` for the session). The product row's tick (`data-bk="group"` in `js/bulk.js`) means every
  size the filter shows — off only when all are on, so a half-ticked product fills up — and its
  **Print all sizes** (`lb-print-all`, `labelLinesForProduct`) goes into the same preview the bulk bar
  uses, one line per size at the quantity typed beside it. A click on the row opens it; a click on
  the tick does not (`lb-open` checks for `.bk-box`). Select-all in the header still means every
  filtered size, folded or not, and the row says "5 sizes · 3 ticked" so nothing is hidden by the
  fold. The Products table's per-row barcode button is gone at the shop's request.
- The size tables on the Print-labels screen and the product drawer show all three codes by name —
  SKU, EAN-13, **Label code** — because the sticker's digits are the label code and people were
  holding stickers up against a column they never matched.

Mirror side: `label_templates` is mirror-shape (pushed whole), `label_print_log` append-only, and no
column changed — `npm run supabase:drift` stays green.

## Purchase orders

`server/lib/purchasing.js`. The last screen in the warehouse writing to nothing — the browser held an
array, so an order raised on Sunday was gone on Monday.

- **Receiving books stock through the same movement log** as everything else, via `Stock.apply()`
  rather than `Stock.receive()`: the latter opens its own transaction and `DB.tx()` refuses to nest,
  deliberately, because SQLite has no nested transactions and a half-applied delivery is worse than a
  refused one.
- **A short delivery is normal.** `received_qty` is separate from `qty`; eight of ten leaves the order
  open and the two still owed. The supplier balance moves by what **arrived**, not by what was ordered.
- The unit cost is frozen onto the line at order time — with the lira moving, what a pair cost when it
  was ordered is not what it costs when it lands, and the invoice has to agree with the order.

## The shelf map's room, and moving things in it

Two views of one place — a 2D plan plus the rack seen straight on (the default), and the 3D room
one press away (`js/shelfroom.js`). With the layout editor open the room is also where the layout
is **changed**: drag a rack onto a wall, drag a rack in from the list beside it, pull a wall to say
how big the room really is.

- **The drop is the save.** Every drag ends in a `PATCH /api/sections/:id` or `/api/rooms/:id` and
  a reload. There is no Save button and no edit buffer, deliberately: a layout held in the browser
  is a layout that dies on a refresh, which is the trap the draft partner invoice is still in.
- **Placement is patched as a unit** — `roomId`, `wall`, `wallPos` in one body. `updateSection`
  reads an omitted one as *clear it*, so a rack that moved rooms must not keep the old room's wall
  position. Send all three or none.
- **The ghost only ever shows a place the rack can go.** It snaps to 5 cm, stops at the end of a
  measured wall, and slides to the nearest free place rather than overlapping — the candidates are
  the edges of everything already there, rounded AWAY from the neighbour (4.56 snapped to the
  nearest 5 cm is 4.55, which is inside the rack it was meant to sit beside). `wallAt()` in
  `shelfroom.js` is the exact inverse of `placeOnWall()` and the two are written next to each other
  for that reason — change one and you must change the other. The browser runs the server's overlap
  arithmetic locally so the answer arrives while the rack is still in the air; **the server still
  decides**, and a refusal reloads the truth back with a toast.
- **Green and red are not used by the drag.** On this screen they already mean a scan was accepted
  or refused. The ghost is white where it can land and hidden where it cannot, and the readout
  beside the hand carries the reason.
- **A rack in front of a wall wins the grab**, because moving a rack is much the commoner job; bare
  wall resizes the room. A press is not a drag until the hand has moved six pixels — the same
  threshold the click-to-select test already used — so a rack row is still a button.
- **The walls do not move while the hand does.** Changing a room's size rebuilds the whole scene, so
  a pull draws an outline of the room it would become and the real walls move once, on release.
  Width and depth are stored as a pair and so are saved as a pair — both are on the readout the
  whole time. **Height is not pulled**; it stays a number typed in Room settings.

### Centimetres, rack sizes, and what a shrink does (036)

- **Every number the room draws comes from the server.** `GEOMETRY` in `server/lib/shelves.js` is
  the standard rack in centimetres and rides with `GET /api/sections` as `geometry`; each rack may
  carry its own `bay_cm / level_cm / depth_cm` (NULL = the standard, never a measured zero) and the
  list sends them applied as `size`. `js/shelfroom.js` used to own these as constants, which meant
  the server was refusing overlaps in BAYS without knowing how wide a bay was.
- **A rack's place on its wall is `wall_cm`.** `wall_pos` stays and is DERIVED (`round(wall_cm /
  bay)`) so the mirror column and an older restore keep meaning what they meant; the API accepts
  `wallCm` (the browser sends only this) and the legacy `wallPos`. Existing rows were converted with
  114, the one number that was ever drawn, so nothing on screen moved.
- **Overlap is a floor rectangle, not a bay count.** `footprint()` in `shelves.js` is the
  centimetre twin of `placeOnWall()` in `shelfroom.js` — same four cases in the same order, and
  changing one means changing the other. One rectangle per rack is what catches a corner (a rack's
  depth eats the first centimetres of the wall beside it) and two racks nose to nose in a room too
  shallow for both. An unmeasured room has no corners and tests only the racks on the same wall.
- **Shrinking a room narrows the bays of any rack that no longer fits, never removes one.** A bay
  may hold stock and printed labels, and `removeShelves` refuses exactly that. `fitRoom` floors the
  bay at `BAY_MIN` (60 cm) and, below it, refuses the whole resize as `409 room_too_small` naming
  the rack and the smallest room that would do — nothing is written unless everything fits. Facing
  and corner conflicts are refused, not slid: moving a rack is the manager's decision. The wall
  pull previews the shrink on the hand before release; the PATCH answers with `shrunk` and the map
  says it in a toast; the room dialog keeps a refusal IN the dialog with a "use the minimum" button.
- **Resizing a rack where it stands is refused if it would then overlap, naming the neighbour**;
  adding a bay re-runs the same check one column wider. `MAX_ROOM_CM` is 100 m a side.
- **Fullscreen re-parents the canvas wrapper to `<body>` first, then asks the API.** Refused
  (an iPad, the headless harness) or absent, the same wrapper with `.sm-fs` is the whole feature
  — one code path. While it is out there `detach()`/`attach()` are no-ops, `#smRoom` is drawn as a
  placeholder, and the map writes DOM inside the wrapper in exactly one place (`paintOverlay`).
  `#toasts`, `#modal-root`, the peek and the drag readout come inside for the duration because the
  fullscreen top layer hides everything outside the element; Escape leaves both kinds the same way.
- **Walk keys are taken at the document, gated on the hand having last touched the canvas or a
  pad**, with `preventDefault`, so W never lands in the scan box — and a press anywhere else gives
  the keys back. The wedge listens at the capture phase and buffers every key itself, so a scanner
  gun is never in this conversation. The walk loop runs only while a key or pad is held; the
  still-camera-schedules-no-frames rule holds and the harness asserts it after the walk.
- **Shadows are baked** (`shadowMap.autoUpdate = false`, `needsUpdate` at the end of `rebuild()`
  and `update()`): nothing moves but the camera. A machine whose first three frames average over
  40 ms drops itself to the low tier (no shadows, no AA, DPR 1), says so, and remembers it in
  `og_sm_quality`. The harness pins `high` because swiftshader would always drop.
- **World matrices are updated at the end of `rebuild()` and after every camera move**, not left
  to the next render: a press that arrives before the first frame after a rebuild used to raycast
  against walls still standing at the origin, and the harness — which presses that fast — found it.

### Measured means measured

A room with a tape on it is now drawn at the size the tape says, full stop. It used to be
`Math.max` of the tape *and* what the racks wanted, so one rack parked past the end of a wall
quietly stretched the room while the badge went on saying "to scale". A rack that does not fit is
drawn not fitting and **named underneath** (`#smFit`, fed by `ShelfRoom`'s `fit` hook) — a wall you
can see is too short is a wall somebody will fix.

Two more things that were silently wrong and are worth not reintroducing:

- **Names and clicks are occlusion-tested.** One world box per rack, tested against the line from
  the camera. Without it a product name from the far wall floated over the near rack, and a click
  went through a rack and selected a bay behind it — the hit boxes write no depth.
- **The room's name is in `sameSig`.** Left out, renaming a room left the old name painted on the
  back wall until something structural forced a rebuild.
- **No mark is better than a black square.** The logo plate starts hidden and appears only once the
  artwork is in hand; the loader is async and can fail outright.

Verified by `_smcheck.html` — `?gl=force` runs the room suite (needs
`--use-angle=swiftshader --enable-unsafe-swiftshader` headless), and **`?hold=1` stops before the
context-loss test** so the finished room can be looked at, which is the one check that cannot be
written as an assertion.

## The warehouse: moving stock, and the log of it

### The tabs, in the order the room works

Left to right: **Stock movements, Stock by place, Worth reordering (the purchase orders, under the
name of the question the tab answers), Add product, Stock count, Asked for and not in stock** — set
by the shop, and `OG.wh.tab` lands on `moves` so the leftmost tab is the one that opens; an account
without `stock.move` falls to the first tab it does have (the fallback in `viewWarehouse`). The
Shelf map button left the header (the map has its own nav entry), and **nothing on Stock by place
carries stock to the floor any more** — the per-row Transfer button and the Move column on the
"bring these out" card are gone, because that is the scan panel's job now; the card stays as the
list of what to go and fetch. The five-movement card inside Add product is gone too: movements have
a tab.

### Export hands back the tab you are on

`warehouseExportSpec()` in `js/app-export.js` is a **switch on `OG.wh.tab`**, one sheet per tab:
`whStockExportSpec` (a column per warehouse on "Everywhere", cost only under `seesCost()`),
`whReorderExportSpec`, `whWantsExportSpec` (from the tab's own `wantRows`, so it inherits the
`customer.read` gate by only existing when the tab does), `whNewProductExportSpec`,
`whMovementsExportSpec`, and a count tab with no count running exports the stock sheet.

It was two branches — `moves`, and everything else — and "everything else" was the **Add-product
form**: its size list and whatever had been typed into it, which on any other tab is seven sizes
at 0. So Export on Stock by place, Worth reordering, Stock count and Wants each produced a file
titled "Add product" with a green "Export ready" toast, and the shop reported the buttons as not
working, which from where they stood was exactly right. The old comment said "exporting from Add
product must not hand back the movement log" — it fixed that by handing the Add-product sheet to
every tab instead. Verified by clicking the real buttons on every tab in a browser: the Excel and
PDF machinery had never been the problem.

Two things found beside it: **`I18N.en` defined `movement` twice** — `'Movement'` for the column
head and, three hundred lines later in the counting family, `'movements'` — and the later literal
wins in an object, so every column headed `t('movement')` read "movements". The second is gone.
And the movements sheet sliced 200 rows and put that number in the subtitle as the whole log; it
now says `of N in total`.

**A scratch copy of `og.db` carries the shop's `config` — including its linked Telegram chats — and
`.env` supplies the real tokens**, so a scratch server on another port has a live reminder tick
aimed at the owner's phone. The "Testing it without spamming the shop" note under the reminders
already says to set a bogus `OG_TELEGRAM_TOKEN_*`; this is the reminder that it applies to *every*
scratch run, not only the ones about Telegram.

### Move by scan

`openMoveScan` / `moveScanned` / `moveScanCommit` in `js/app-warehouse.js`, the `ms-*` actions and
changes, `POST /api/stock/transfer`. The commonest job in that room — carrying pairs out of the
back and onto the floor — had no button: it was the per-product transfer dialog, once per item.
Now a button in the warehouse header (gated `stock.move`) opens a panel that takes barcodes.

- **It collects first and moves on confirm, and that is not a preference.** `Shop.write` has a
  one-write-at-a-time gate that **silently drops** a second write while the first is in flight —
  right for a button somebody double-taps, fatal for a scanner gun, which puts three codes in
  before one round trip finishes. Scanning into a local list loses nothing; the list then goes as
  one confirmed action. The stock count batches for the same reason.
- **The commit chains one transfer per line inside a single `Shop.write`**, so the gate is held
  for the batch. Chained, not fired together: each is its own transaction on the server and a
  queue of them against one SQLite file is how a `busy_timeout` becomes a failed move. **It is not
  atomic and does not pretend to be** — a refusal partway names what moved and what did not, because
  the alternative is rolling back shelf work somebody has already done with their hands.
- **Availability is recomputed on every repaint, never stored on the line.** The stock at the FROM
  place moves under this panel (a sale, another till), and a number captured at scan time would be
  the one thing on screen that was true a minute ago. Scanning more than the place holds is a real
  accident — the same box counted twice — so it is flagged on the row and the move clamps, rather
  than being refused at the end.
- **The panel owns the scanner while it is open**, through the same early return in
  `js/app-boot.js`'s wedge router that the shelf map and the label picker use. Repaints patch the
  modal body directly and never call `render()`: the panel holds a list being built and a caret in
  the scan box, and a repaint underneath would take both.
- A size with none at the FROM place is refused **by place name** ("There are none in Back
  storage"), not "out of stock" — it may be on the floor already, and that sentence says which.

### The movement log

**`.pos` was the bug, and it is worth knowing why.** The quantity cell carried
`class="mv-delta pos"`, and `.pos` is the **Point-of-Sale screen's own layout class**
(`css/inputs-dashboard-pos.css`): `display:grid`, three columns, `height: calc(100vh -
var(--topbar-h))`. So every positive quantity in the log became a full-height POS grid — each row
**770px** tall, the quantity column 465px wide, the table 27,000px long inside a 564px box. The
page looked like a rendering fault with no cause; it was one three-letter class name shared by a
modifier and a screen. They are `.mv-up` / `.mv-down` now, namespaced so they cannot collide, and
that is the rule for any modifier that could read as a noun.

- **Seven columns, not ten.** SKU, balance, user and note each had their own, so the table was
  1,557px wide inside a 1,154px card and scrolled sideways — the balance and the reason, the two
  things an argument about stock turns on, were off the right edge. The SKU sits under the product
  name where somebody comparing a sticker reads it, and the person sits under the reason they gave.
- **The inline `max-height` is gone.** It put a second scrollbar inside a page that already
  scrolls, so the wheel did one thing over the table and another beside it.
- **It says it is a window.** It drew the most recent rows and claimed nothing — the mistake this
  codebase has made most often. `MOVES_SHOWN` is the one number, read by `Bulk.visibleIds` too so
  select-all can never reach a row nobody can see.
- **A signed number needs `dir="ltr"`.** `+2` rendered as `2+` in Arabic — the sign dragged to the
  far end by bidi, the same trap the Settings `meta` line documents. All three places that draw a
  movement delta are isolated.

## The bulk bar

`js/bulk.js`. One selection per screen, a floating bar of what can be done to it.

- **Ticking a box does NOT re-render.** It used to call `render()`, which rewrites the whole of
  `#view` — so on a long catalogue the scroll snapped back to the top and the row being ticked moved
  out from under the hand. `markRows(sc)` walks the boxes already drawn and sets two things: the
  box's `checked` and the row's `bk-on`. Nothing about a tick changes which ROWS exist, only which
  are marked. The Print-labels screen's product rows are repainted the same way (their tick, their
  indeterminate state and the "5 sizes · 3 ticked" cell, through `labelCountCell`). **No tick path
  may call `render()`** — that is the whole fix, and it is easy to undo by accident.
- **The bar is centred with `inset-inline: 0; margin-inline: auto`, not `left: 50%`.** With
  `left:50%` the box's available width runs from the middle of the screen to the right edge — half
  the viewport — so seven buttons wrapped onto three lines on a 1500px monitor with room to spare,
  and Delete took a line of its own looking like the main action. Groups are `flex-wrap: nowrap`
  inside and the bar wraps only between them.
- **Destructive actions sit behind a hairline, last.** `{ danger: true }` in `ACTIONS_FOR` puts an
  action in the second group. **`.bk-danger` is restated in `css/og-skin.css`**: it is one class, and
  that file's two-class `body:not([data-portal="yalla"]) .btn` beats it, so Delete drew as an
  ordinary white-on-dark button and read like Export. Found by reading its computed colour, not by
  looking at it. The same file redefines `--border` to `#1E1E22`, which is invisible on the bar's
  own `--popover`, so `.bk-rule` is restated there too.

## Archived is not deleted, and not stock either

Archiving is the shop's gesture for a line it has stopped selling: it sets `products.hidden` and the
row stays with whatever stock it had, so every invoice that named it still resolves.

**There is also a real delete now** — `DELETE /api/products/:id` → `Cat.remove`, and the bulk bar's
Delete — for the row typed in by mistake, which archiving leaves in the way for ever. It **refuses
by name** the moment it would cost history: sold, moved, ordered, counted, labelled, or wanted. Two
different reasons underneath, and both are asked before the delete rather than discovered during it:
`sale_items` freezes the name and both prices and carries **no** foreign key to products, so an old
invoice survives — what does not survive is answering "what did we sell" by product; while
`stock_movements`, `po_lines`, `stock_count_lines`, `label_print_log` and `wants` all reference
`variants(sku)` with **no cascade**, so SQLite would refuse anyway, with a constraint name instead of
a sentence. `stock` and `variants` do cascade, which is right — they are the product, not a record
about it. **Every removed row calls `logChange`**, or it disappears here and lives in the mirror for
ever. The bulk action is the one with **no undo**, is not all-or-nothing, and reports what went and
what stayed.
`/api/catalogue` even sends hidden rows to anyone with `product.write`, deliberately, so a
manager can bring one back.

Which means **everything answering "how much stock does the shop have" must skip them**, and
for a long time nothing did except the Products screen. The demo catalogue was carrying 293
pieces this way, and they were in the warehouse totals, the dashboard's stock value and the
count sheet — the screen was asking somebody to walk a shelf for a line the shop had stopped
selling.

`DB.liveVariants()` in `js/data.js` is the filter, and it is what `whTotals`,
`criticalVariants`, `floorOuts` and `reorderSuggestions` walk. `js/app-warehouse.js`,
`js/stock.js` and `js/app-dashboard.js` use it too. `js/app-products.js` deliberately does
not — its Archived filter is the one place they should appear.

### Archived and on-the-website are TWO columns, and were one for too long

`products.hidden` is **archived**: the shop has stopped selling the line, and it leaves every
stock figure above. `products.on_web` (migration `039`, mirror file
`server/supabase/014_product_on_web.sql`) is **whether the marketing website shows it** —
a different question with a different answer, and the site will read `hidden = 0 AND on_web = 1`.

They were one column, and the Products screen surfaced it twice under two names: a switch
headed "On storefront" and a filter option called "Archived". So turning a product off the
website archived it — the row left the table, its pieces left the stock totals, and nothing on
screen said where it had gone. The bulk bar had the same collision three ways: Show, Hide and
Archive all wrote `hidden`.

Now: the switch and the bulk Show/Hide pair write `on_web` (`Shop.setProductWeb`); bulk Archive
writes `hidden` (`Shop.hideProduct`). Both are in `EDITABLE` in `server/lib/catalogue.js`.
`on_web` defaults to 1 in both schemas — a migration must not take a shop's whole catalogue off
its website — and `js/data.js` hydrates it as `onWeb`, defaulting to true so a server older than
`039` does not read as a catalogue switched off.

**`products` leads the UNGUARDED core loop**, so until `014` is run in the Supabase dashboard a
rejection there would take variants, stock, customers, sales and deliveries down with it. There
is a `mirror-lag.js` entry for exactly that: the sync pushes products without the column and
names the file every run. Verified against the live mirror — the run stays green and the rest of
the loop lands. **Run `014`, then `npm run supabase:reconcile`**, or the flag stays NULL there and
a restore hands the shop back a website showing everything. The boot pull (`lib/restore.js`)
refuses with `drift` until that is done, which is the guard working.

Lifecycle is also no longer jammed into the stock-health dropdown: `OG.prod.arch`
(`all | active | archived`, default `active`) is its own control on the Products screen, gated on
`product.write` because only that permission is sent archived rows at all. Stock health is a fact
about quantity; archived is a decision about the line.

`GET /api/ext/products` is what reads it — see "The website's door" in the partner section. The
site's query is `hidden = 0 AND on_web = 1`, with `demo = 0` on top, and archived deliberately
beats the website flag: a line the shop has stopped selling must not stay advertised because
somebody left its site switch on.

`server/scripts/purge-demo.js` removes demo rows for good. Dry run by default; `--test-sales`
additionally takes sales rung up by accounts that no longer work here, which is a judgement
rather than a flag and so never fires on its own. **Every delete calls `logChange`** — the old
teardown did not, which is why nineteen products once vanished locally and stayed in the
mirror forever.

**Deletes sync in the opposite order to inserts.** A variant cannot land before its product;
a customer cannot be removed while a sale still points at them. `supabase-sync.js` therefore
runs each group twice — `phase: 'upsert'` in FK order, then `phase: 'delete'` in reverse —
and only advances the cursor after the second. Doing both in one pass is what rejected the
first demo purge halfway through.

## Editing a product

`openProductEditor` / `readProductEditor` in `js/app-products.js`, `prod-edit` and
`prod-edit-save` in `js/app-actions.js`, `PATCH /api/products/:id`. The drawer's **Edit product**
button used to be `data-act="nav-close" data-view="warehouse" data-tab="add"` — it navigated to the
**Add-product form**, which is a form for a product that does not exist yet and so arrived blank,
with the shop's product left behind on a screen nobody was on any more. It is a modal over the
drawer now, and the drawer reopens on the same product when the save lands.

- **Every field the server lets a product change**, and no others: the EDITABLE set in
  `server/lib/catalogue.js` — name, type, brand, made in, colourway, currency, both prices, shelf
  zone, and the website flag. Nothing new was opened server-side.
- **Prices are edited in the product's OWN currency**, `srcCurrency` in its minor units, and USD is
  shown in dollars while SYP is whole lira. A dollar-priced shoe saved back as lira is the silent
  repeg `srcCostPrice` / `srcSellingPrice` exist to prevent. Changing the currency **clears** the
  price boxes rather than converting them: a conversion at today's rate is that same repeg wearing
  a helpful face.
- **A blank cost is left alone, not written as zero** — zero is a claim about what the shop paid.
  A blank name or selling price is refused before the request, and the modal stays open with what
  was typed still in it.
- **Sizes and stock are deliberately absent**, and the note in the modal says so: stock moves
  through the warehouse's movement log, and a screen that lets somebody type over a quantity is a
  screen that puts a number in the database with no movement behind it.
- Cost price is drawn only for `seesCost()`, so a cashier editing a name never sees what it cost.

## Product pictures

Migration `040` (`products.image_url`), `server/lib/storage.js`, `POST /api/products/:id/image`,
mirror file `server/supabase/015_product_image.sql`. **The bytes live in a public Supabase Storage
bucket, `product-images`; the row holds the address.** Every renderer — `thumb`, `thumbBox`, the
POS tile — already drew `image.src` when present, so hydrating `image_url` into it is what made the
picture appear everywhere at once; the colour block stays the fallback and nothing is ever without
a visual.

- **A code change needs the server restarted**, and Hard refresh does it — see that section. This
  was the feature's first failure in the shop, and it was not a bug in the feature.
- **The browser shrinks first, the server stores.** `readImageFile` (`js/app-util.js`) turns a 3–6 MB
  phone photo into a ≤ 420 px data URL before anything is sent, so a picture is tens of kilobytes on
  the wire and in the bucket. The route decodes only `image/jpeg|png|webp` and refuses anything
  else by name (`bad_image`); 2 MB is a backstop, not a budget.
- **`storage.js` is three plain HTTP calls with the service key** — no SDK, same as PostgREST. It
  creates the bucket the first time it is needed (public, so the URL works in an `<img>` on a phone
  on the shop wifi and on the website; a signed URL expires, and a picture that stops loading on
  Tuesday reads as the shop being broken). Objects are `products/<id>/<time>.<ext>` — **a new path
  on every replace**, because the upload sends `Cache-Control: max-age` of a year and the CDN keeps
  serving an old path after it is deleted. The old object is removed on replace and on clear
  (housekeeping; a failed remove is not an error, the row is what the shop reads) — **the CDN goes
  on answering for a deleted object for a while**, which is why a test must check the bucket
  listing rather than fetching the URL, and why nothing may depend on a picture disappearing.
- **A picture is POSITIONED against its frame, never centred as a grid item.** `.thumb`,
  `.thumb-box` and `.pcard-img` are `display:grid; place-items:center` for the initials block, and a
  centred grid item does not stretch — `height:100%` on the `<img>` went unresolved, so a 200x400
  photo drew 36x72 inside a 36x36 box, overflowed downward, and `overflow:hidden` clipped it to its
  TOP edge. Every portrait picture in the shop showed its top and called it the middle. The
  `has-img` rules make the box `position:relative; display:block` and the image
  `position:absolute; inset:0` with `object-fit:cover`, which crops from the centre. A landscape
  photo hid this completely, which is why it survived a look at the screen — it was found by
  measuring the rendered rectangles, not by looking at them.
- **Only the route writes `image_url`** — `Cat.setImage`, never `update()`'s `EDITABLE` list. A client
  that could put any URL into an `<img>` on every till is not a feature.
- **The product is saved either way.** The Add-product form uploads *after* the row exists (the path
  is keyed on the id) and reports the three outcomes with one helper, `uploadProductImage`: sending,
  saved, did not land — the last with the server's own reason (no internet, `503 not_configured` on
  a server with no Supabase). The product drawer's picture is a button: press it to change it; the
  address is a link beneath the name, with Remove.
- **The mirror.** `products` is in the UNGUARDED core loop, so `mirror-lag.js` declares `image_url`
  and the sync pushes products without it, naming `015`, until it is run in the dashboard — then
  `npm run supabase:reconcile` (the Reconcile button) refills it, or a restore hands back a catalogue
  with no pictures. `014` had never been appended to `CATCH-UP.sql`; it is now, with `015`.
- The website row (`GET /api/ext/products`) carries `image.url` beside the block.

## The drawer

`server/lib/money.js` and `server/lib/counts.js`, migration `017_money_and_counts.sql`. Shifts,
expenses, customer debt repayments, and the stock-count session — the last four things that lived
only in the browser and died on a refresh.

- **A shift is a cash box, not a login session.** Sessions expire overnight and tabs close; neither
  means the drawer was counted. It is also routinely a handover, which no session spans. One open
  shift at a time, enforced inside `DB.tx()` where `BEGIN IMMEDIATE` makes the check actually hold —
  **not** a `UNIQUE` index, because NULLs are distinct in SQLite and such an index would permit any
  number of open shifts.
- **`expected` is frozen at close**, unlike almost everything else here, which derives. The variance
  was signed off by a person, and voiding a sale a week later must not rewrite last Tuesday's cash
  difference. `counted` is stored because somebody physically counted it.
- **Paying a debt carries all three guards** — an `opId` through `applied_ops` so a retry cannot take
  the money twice, the balance recomputed inside the transaction rather than trusted from the browser,
  and `Sales.void` refusing a sale that has payments against it. Money in is the one direction that
  cannot be corrected by doing it again.
- **An expense never touches `suppliers.outstanding`.** Receiving a purchase order already books what
  the shop owes; moving it here too would pay the same supplier twice in the ledger, and the goods are
  already in cost price so it would come off profit twice as well. `supplier` is deliberately not in
  `expense.categories`, which lives in `config` so Settings can add one without a deploy.
- **Posting a count is one transaction** using `Stock.apply(d, …)`, not `Stock.count()` — the latter
  opens its own and `DB.tx` refuses to nest. The old way fired one request per line, so a retry
  re-applied every adjustment and a sale landing mid-way corrected against a figure that had moved.
- `stock_count_lines.system_qty` is the one derived value this schema stores: the point of a count is
  the variance *at that moment*, and by June the live figure has moved.
