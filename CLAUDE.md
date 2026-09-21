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

# Double-clicking index.html no longer shows an app — there is nothing to draw
# without the server, and the page says so rather than inventing a shop.

cd server
npm test                         # the one test: browser config keys vs the server's allow-list
npm run warehouse:one-room       # the owner's one-room rebuild of the shelf map (see Stage B)
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

### A sandbox that cannot see the real files — `OG_ENV_FILE` and `OG_DATA_DIR`

Two dev-only switches, both **real** environment variables (a file cannot name the file it is read
from). `OG_ENV_FILE=server/.env.sandbox` replaces `server/.env` outright: the real file is never
opened, so a scratch server cannot pick up the real Supabase keys, Telegram tokens or vault key by
accident. `OG_DATA_DIR=server/data-sandbox` moves the database, `backups/` and `certs/` together
(`dataDir()` / `backupDir()` / `dbFile()` in `lib/env.js`; `OG_DB` still wins). A relative path is
read from the repository root. Every script that used to default to `server/data/og.db` asks
`dbFile()`. Both folders and the env file are gitignored. The night shift's sandbox sets both, plus
`OG_PORT=8190 OG_HTTPS=0 OG_SYNC_MINUTES=0 OG_PULL_AT_BOOT=0 OG_PUSH=0`, bogus non-empty Telegram
tokens and no Supabase keys.

**Node 22.5+ required** (`node:sqlite` is used, which arrived in 22.5). There is **no `npm install`** —
the server has zero dependencies by design, and the frontend has no build step at all.

Publishing: **the Publish button in the panel** (add → commit → pull --rebase → push, the message
typed into the box; `push.bat` is gone). CI then builds `dist/`
and skips publishing while the repository is private (see Deploy).

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
- **The launcher opens the browser itself**: the panel's `open` step (`openBrowser` in
  `panel/panel.js`) opens whichever address the server's ready line says is actually serving,
  and an adopted shop is opened from its own health line rather than by guessing https from a
  file on disk.
- `SECURE` sets itself when HTTPS is actually serving, so session cookies get the `Secure` flag
  without anyone remembering `OG_SECURE`. Browsers still accept Secure cookies on
  `http://localhost`, so the till on this machine is unaffected.
- **`server/lib/net.js` is the one list of this machine's addresses** — the startup print,
  `/api/health` (which the login screen reads) and the certificate's SANs all come from it. A
  certificate that does not name the address somebody types is a page that will not open at all,
  so the server compares the two at startup and says `npm run cert` by name when the IP has
  moved. It also warns 30 days before expiry.
- `server/data/certs/` is gitignored: it holds a private key, and it is one command to rebuild.

### The way in from outside — retired (16 Sep 2026)

The shop was reachable from outside through a Cloudflare tunnel (`shop.ogsports1.com` →
`http://localhost:8090`). It was retired: cloudflared is no longer installed on this laptop and
the hostname has no connector. `server/scripts/cloudflare.js`, the panel's Check Cloudflare
button, the `cloudflare` npm scripts, the `OG_CF_*` settings and every fallback that read them
were removed. The server no longer reports a `public` address in `/api/health` or the panel's
`ready` payload, so the launcher's address card shows the local and Wi-Fi addresses only.
Customers reach their order page through og-track on Railway (`receipt.public_url`); Telegram job
links appear only when `shop.public_url` is set. The shop is back on the internet through the
VPS proxy since night shift 04 — see that section: `OG_ORIGINS` must list the hostname (blank
allows only the address the request was sent to — `originAllowed()` in `lib/http.js`, audit 06),
and `OG_PROXY_ADDR` names the proxy's own address. **`OG_TRUST_PROXY` is retired and ignored**. A second connector on one tunnel token is a high-availability pair to
Cloudflare and takes requests away from this laptop without a word — the same shape as the
`lineage.js` problem, one layer down. The full story is in git history (`git log -- server/scripts/cloudflare.js`).

### Accounts

**The shop's accounts are one table, and two commands make the world match it** (night shift 01,
migration 059). The table is `TARGET` in `server/scripts/users-rebuild.js`: `abode` (owner), `wael`
(manager), `cashier`, `member1`–`member3` (warehouse), `zaven` and `zohrab` (Yalla Wear, left exactly as
they are), `zizo` and `ahmad` (developer), `safeer1` and `safeer2` (delivery). Every other account is
removed. Ahmad keeps his developer ACCOUNT; his laptop is no longer part of this system.

- **`npm run users:rebuild`** (dry run; `-- --apply` to write; `--url` names the running shop). Backs up
  first. **The lockout guard** — 2026-09-05 happened — creates `abode`, signs him in through the RUNNING
  shop's real login route and opens Access; if any of that fails it stops with nothing else changed.
  **A second run keeps the owner's password**: the guard signs in with `abode`'s sealed password when
  this machine can read it and it still matches, and makes a new one only when it cannot (the first
  run did not, and every re-run quietly rotated it — found in the final pass).
  Then it creates the missing accounts (Auth.createUser, sealed), gives a new password to any account it
  did not make, removes the rest without breaking history, and applies the manager's new default set
  through the shop so its permission cache follows. **Passwords go ONLY to `ACCOUNTS.private.md` in the
  data folder it ran against** (gitignored); nothing is printed. Refuses while migrations are pending.
- **Removing an account** (`lib/people.js`): every column that references `users` — read from the schema,
  so a new table is covered — is re-pointed to one hidden, disabled **"Former staff"** record
  (`former-staff`), logged where the mirror replays change_log; sessions, per-person permissions and read
  marks go with the account. A table that will not take the re-point keeps that one account instead,
  hidden and unusable, as `former-staff-<username>`. `Auth.isHiddenUser` keeps these out of every list.
- **`npm run users:mirror`** (dry run; `-- --apply`). Refuses unless this database holds the mirror
  (the lineage check). Upserts every local account with its sealed box; for every account the mirror has
  and this database has not — including anything only another install ever wrote — re-points its
  references IN THE MIRROR (append-only tables too) to the local account with the same username, or to
  Former staff, then deletes it; then compares `role_permissions` and `user_permissions`. Safe twice.
- **Roles.** `owner` and `developer` hold every permission and the full dashboard; `config.write`,
  `staff.write` and **`access.write`** are PINNED to them (the manager is no longer pinned). The manager's
  default set is everything else minus money, cost, profit, staff, settings and access — applied by
  `users:rebuild`, never by the migration, which runs before any owner exists. The warehouse adds and edits
  products and prices, cost included. `users.role` and `role_permissions.role` had inline CHECKs, so 059
  rebuilds both (foreign keys off, checked).
- **Access per person** (`user_permissions`, pushed whole): effective = role + grants − denies, FORBIDDEN
  and PINNED enforced, computed once in `Auth.effectiveFor()` — `requirePerm`, `can()`, `/api/live` and
  the list the browser gets all use it. Setting a switch back to the role's answer deletes the row.
  **Settings → Access** (`js/access.js`, `access.write` only) lists people, a switch per permission that
  saves at once, Back to the role, add a person, switch one off (ends their sessions; never yourself, never
  the last owner/developer), new password. **A password is shown ONCE**, when made or reset — never again
  there. Every permission name is in both languages (`perm_*`); the roles grid printed the server's English.
- **`users.pw_box`** is the readable password sealed with `OG_VAULT_KEY`, written wherever a password is
  set, carried to the mirror only inside the `pw_enc` box, and read ONLY by the developer panel over its
  pipe. `pw_enc` itself seals the HASH — it never held a password anybody could read.
- **Check the database, not this file:** `SELECT id, username, role, active FROM users`. The live state is
  written here after the owner runs the two commands. The old five (`hussam` … `yalla`) and their
  published password are still in git history; once `users:rebuild --apply` has run on a database they no
  longer exist in it.

### Accounts — the history before the rebuild

There are no test accounts. Five used to exist — `hussam`, `lubna`, `maher`, `talal`, `yalla` — all
on one password published in the repo, each with `pw_hint = 'the test one'`, which the login screen
hands to anyone who types the username. **That password is still in git history and cannot be
taken out of it.** The scripts that created them are deleted. Make new accounts with
`npm run createuser`.

**Retiring them is a fact about ONE DATABASE, and it did not happen on every copy.** This section
used to say all five were retired — `maher` and `yalla` deleted, the other three disabled with their
hashes replaced by random bytes. That describes another install's database (Ahmad's, which holds the
mirror's lineage; not verified from this laptop). On this laptop's `server/data/og.db` all five were
still `active = 1` with the hint, and because the paragraph said otherwise nobody looked — including
while this laptop was on the public internet through the (since retired) Cloudflare tunnel. **Check the database, not
this file:** `SELECT id, username, active, pw_hint FROM users`.

- **2026-09-05, the attempt that undid itself.** A session disabled the five with raw SQL, found no
  manager left who could sign in, was refused the raw-SQL undo, created **`owner` ("Shop Owner",
  manager, id 7)** with `npm run createuser` as a way back in, and signed in as it to switch the five
  back ON through `POST /api/users/:id/active`. That is why all five carry the same `updated_at` and
  why `owner` exists. Its password is in that session's transcript on this laptop, not in the repo.
  It is kept on purpose — a development partner may sign in with it.
- **2026-09-13, this laptop.** The five are `active = 0` with `pw_hint = NULL` and every session
  deleted — what the app's own disable route does, plus the hint. The rows stay: invoices and
  deliveries name them. **Their hashes are unchanged, so the published password still matches**:
  switching one back on re-opens it. Replacing `pw_hash`/`pw_salt` with random bytes is the step that
  makes re-enabling harmless, and has not been taken here.
- Also on this copy: `mirrortest` (id 6, disabled), `zaven` and `zohrab` (Yalla Wear — see the
  partner half), `zaren` (id 10, manager, created 2026-09-13).
- **2026-09-16, this laptop — they were back.** A read-only check found `lubna`, `maher` and `talal`
  `active = 1` again, and `mirrortest` too (`hussam` and `yalla` were still 0). The cause is not
  known. The owner was told; nothing was changed.

Done with raw SQL, which is acceptable on a dev copy only. On the shop machine use the
`staff.write`-gated route (`POST /api/users/:id/active`), which also ends the sessions — Settings has
no control for it yet, so it is called by hand (see Known open work). The server's startup notice
(`retired_account`) and `npm run preflight` both name any of the five usernames that is
`active = 1` — which is exactly the warning that was printed on this laptop every morning and read
as noise because this section said the accounts were already gone.

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
panel/package.json          {"type":"module"} — every panel file is ESM; without it Node 24 warns and re-parses them
panel/ui/                   the window: the Shop screen + the developer screens, the shop's tokens and Montserrat
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

### Hard refresh — now the Full refresh

The button that makes an edit, or anything else that moved, reach every copy of the shop already
open. It was two halves plus a server restart only when server code had changed; the owner asked
(13 Sep 2026) for "a full server refresh, with new data", so it is now **one sequence, every
time** — `hardRefresh()` in `panel/panel.js`, six steps pushed to the window as `event: refresh`
(`state.refresh`, ids and states only; the words are `rf_*` in `panel/ui/i18n.js`):

1. **files** — bump `CACHE` in `sw.js` (`og-system-v119` → `v120`). The Gotchas section below has
   said to do this by hand on every change to `css/`, `js/` or `index.html` since long before the
   panel; one integer in one file is better kept by a button than by a paragraph.
2. **warn** — `{type:'refreshing'}` up the pipe → `Live.notify('all', { refreshing: true })`. Every
   open tab covers itself with the mark, a ring and "Updating OG System…" (`.og-refresh`,
   `beginRefresh()` in `js/pulse.js`) instead of a failing page while the shop is down.
3. **stop** — the graceful `{type:'stop'}`, after 800 ms so the warning lands first.
4. **start** and 5. **answer** — the ordinary start (boot pull included), then the wait for `ready`,
   up to five minutes.
6. **tabs** — `{type:'reload'}` → `hardRefresh()` in `js/pulse.js`: every cache deleted, the worker
   registration updated, then reload. `location.reload()` alone never worked: `sw.js` is cache-first
   with `ignoreSearch`, so it answered out of the old store however hard anyone pressed F5.

- **A warned tab reloads on the next `hello` it hears**, which can only come from the fresh server —
  so a tab that reconnected after the reload message went out is not left on old code. One that
  never reconnects reloads after 90 s anyway.
- **It reaches the tabs on `/api/live` — the manager's and the developer's — and deliberately not a
  cashier's**, because a till reloading itself under somebody's hands mid-sale is a lost sale. The
  restart does close the shop for those seconds, which is why the window **asks first** and shows
  who has the shop open (the Stop question's `who` line).
- **The window draws a progress sheet** (`#refresh`, `paintRefresh()`): the mark in a lime ring that
  fills per step, the steps ticking (with the new cache name, and how long the answer took), seconds
  counting. Success closes itself after 4.5 s; a failure (`start_failed`, `no_answer`) stays red
  with Show log. A window opened more than 15 s after the result does not replay it.
- **A shop this panel did not start gets the file step only** (`rf_code_foreign`) — somebody else's
  process is theirs to restart. A second press while one runs is refused `refresh_busy`; a running
  job refuses it `job_busy`.
- **`serverIsStale()` still draws the amber card**, whose button is this one. Node reads a module
  once, at import, so a shop started before an edit runs the old code: the new
  `POST /api/products/:id/image` once answered "No such endpoint" to a button that plainly existed in
  the source, and the app names that cause (`img_stale_server`). `data/` and `backups/` are excluded
  from the check.
- Verified against a stand-in panel serving the real `panel/ui` files (the question, six steps,
  success, failure), and a scratch server held over IPC the way the panel holds it — warned,
  stopped, started, and the open tab covered, then back by itself and still signed in.

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

### The window opens on the one screen a shopkeeper needs

It used to open on a 306px rail of five cards beside a **full-height black terminal**, which was
the largest thing on screen and the first thing the owner saw at eight in the morning. He keeps
his records on paper. A wall of scrolling monospace reads as a fault, not as a working shop, and
that is how it was reported.

- **Shop** is the default, every single time. The mark in a progress ring, one sentence, one lime
  button, the address with a QR beside it, and anything wrong as a card. The last screen is
  deliberately **not** remembered: the one morning somebody opened the log out of curiosity would
  otherwise become every morning after it.
- **Developer** (the lock at the end of the bar) is everything else — Tools (every job under four
  headings, drawn from `group` in `jobs.js`), Log (the terminal), Connections with fix buttons,
  Accounts, This machine — and it opens only for a **developer** account. See **The Shop screen and
  the developer door** below.

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

### The Shop screen and the developer door (night shift 01)

The owner asked for a launcher a shopkeeper cannot hurt the shop with. **The Shop screen is the
whole window for anybody without a developer sign-in**: Open in the browser, Open / Close the shop,
Restart (the Full refresh, asked first), Test the printers, the language, the address and QR, the
notices, the handover card when the situation is the handover, and the **Connections** card.
Everything else is behind the lock in the bar.

- **THE GATE IS IN THE PANEL PROCESS, NOT THE PAGE.** `ask()` in `panel/panel.js` runs in front of
  `act()` for every `POST /act`: `PUBLIC_ACTIONS` (start, stop, restart, refresh, open, who, lock,
  unlock, connections, devstate) and the jobs marked `public: true` (`testPrintDry`, `testPrint`,
  and `takeShop` **only while `state.mirror.mode === 'refused'`**) pass; anything else answers
  `{ok:false, code:'locked'}` and pushes `refused`. `quit` and `clear` are developer actions. The
  typed danger word is checked in `runJob` too (`needs_word`) — the window's disabled button was the
  only check before, and a hand-sent request has no button.
- **Only the `developer` role opens it — the owner is refused too**, by the owner's decision.
  `devAuth()` asks the running shop's own `POST /api/auth/login` (and logs that session out at once),
  or, with the shop closed, opens the database **read-only** and runs `verifyPassword` (an unknown
  name hashes against random bytes, as the shop's login does). Eight failures in fifteen minutes
  refuse even the right password (`too_many`), and every failure waits 700 ms. The unlock lasts until
  `OG_PANEL_DEV_IDLE_MS` (15 min) passes with nothing asked — the window sends `devstate` on use, at
  most twice a minute — or until no window is connected for five seconds (a reload reconnects
  sooner). **Lock** is always in the bar while it is open.
- **The log is a developer's screen.** `say()` pushes `line` only while unlocked; the `hello` frame
  carries no lines to a locked window, and the unlock replays the ring (`event: lines`). A lock
  empties the pane.
- **Connections** (`checkConnections()` / `checkOne()`): shop server (`/api/health`), HTTPS
  (`trust-cert --check`, `TLS.daysLeft()`, `TLS.uncovered()`), receipt · label · scanner
  (`hardware.js --json`, one run for the three), cloud copy (the worker's own state), both Telegram
  bots (**`getMe` only — nothing is ever sent**) with the linked-chat count, Web Push keys, internet
  (`generate_204`), the newest backup's age, the vault key. Each has a deadline, answers `skip`
  when it did not run, and is a code plus values; the words are `cc_*` in `panel/ui/i18n.js`. The
  card is checked when the shop reports ready, when the shop stops (server and mirror rows), and on
  Check all / Check again. Fix buttons (`CONN_FIX` in the window) are drawn only while unlocked.
- **Accounts** are read straight from the database, read-only; Former staff never listed. The eye
  opens `users.pw_box` with this machine's `OG_VAULT_KEY` (`revealPassword`) and the answer goes
  **only** in the keyed `/act` response (`Cache-Control: no-store`), is drawn in one row for 30 s,
  one row at a time, and is never logged, toasted or pushed. No box, no key or the wrong key reads
  "Password not readable on this machine" with **Reset**: the panel asks the shop over IPC
  (`{type:'resetpw'}` → `People.newPassword`, which re-seals it and ends that account's sessions)
  and the answer comes back as `{type:'secret'}`, never through `say()`. A reset needs the shop
  open. Every unlock, refusal, lock, reveal and reset is a line in `panel-audit.log` beside
  `panel.log` — **without** the password.
- **`sendJson` in `server/lib/http.js` refuses any JSON answer carrying `pw_box`, `pw_enc`,
  `pw_hash` or `pw_salt`** (a 500 and a log line), so a `SELECT *` added to a route next year
  cannot hand password material to a browser.
- **The boot**: the mark draws itself in (clip-path, blur) on open and on every fresh sequence, an
  orbit turns while the shop opens, the ring counts the real steps, the line under the headline
  names the step running. A failure turns the ring red where it stopped and says ONE sentence;
  a shopkeeper gets Try again, a developer also Show details and the step list. All of it stands
  still under `prefers-reduced-motion`.
- **Test printers is two steps**: `testPrintDry` (sends nothing), and only if it exits 0 the
  window asks before `testPrint` spends paper.
- **Toasts sit below the bar.** At the top corner they covered the Developer button, and a test
  could not open the sign-in until the toast faded.
- **A test panel** is `node panel/panel.js` with `OG_PANEL_PORT` (not 8099), `OG_PANEL_KEY`,
  `OG_PANEL_AUTOSTART=0`, the sandbox env (`OG_ENV_FILE`, `OG_DATA_DIR`, `OG_PORT=8190` …) and
  **`OG_PANEL_LOG_DIR`**, which moves `panel.log` and `panel-audit.log` so the real ones in
  `%LOCALAPPDATA%\OGSystem` (truncated at every start) are never touched. `OG_PANEL_DEV_IDLE_MS`
  shortens the idle lock for a test. Never start `OG System.exe` for a test: its mutex is the
  live panel's. `OGSystem.cs` did not change for any of this, so the `.exe` was not rebuilt.

Verified (17 Sep 2026) on the sandbox through a test panel on 8199: 90 checks over HTTP (every
hand-sent locked action refused; cashier and owner refused on both paths; the developer let in and
the question session ended; every danger word enforced; connections; a reveal matching the real
password; a reset ending the old session; restart, full refresh, stop; the window closing locks
it), 7 for the idle lock and the throttle, and 175 in the window over CDP in English and Arabic at
1100 × 760 and 375 × 760, every confirm button hit-tested. Six passwords were searched for in
`panel.log`, `panel-audit.log`, the panel's stdout, every event-stream frame, every HTTP answer
other than the reveal and reset themselves, and the real `panel.log` and `launcher.log`: zero hits.

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
  which is a build-step-shaped problem). **Neither is a `<script>` in `index.html`.** Three.js is
  lazily injected by `js/shelfroom.js` the first time somebody opens the shelf map (600 KB), and
  since night shift 02 Chart.js is lazily injected by `js/charts.js` on the first draw (200 KB,
  and there is one chart left in the shop). Same reason both times: the till must not parse it
  every morning for a screen a cashier never opens. Both stay in `sw.js`'s precache, so they are
  already on disk when something finally asks.
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

The Arabic proposal rig (`make-proposal.ps1`, `_shot.html`, `serve.ps1`, `docs/proposal-ar.html`) was
retired on 16 Sep 2026: with no seeded shop it could only screenshot empty screens. The
`typeof Auth === 'undefined'` guards that existed for `_shot.html` went with it — `Auth` and `API` are
always loaded (they are the 2nd and 3rd scripts in `index.html`). It is in git history if a proposal
is ever wanted again; it would need a data source first.

### Frontend conventions

- **Each module is an IIFE exposing one global**: `DB`, `POS`, `Codes`, `YALLA`, `Wedge`, `Auth`, `API`,
  `Deliveries`, … **Load order in `index.html` matters.**
- **Events are delegated, never bound per element.** One listener per namespace dispatching on a
  `data-*` attribute: `data-act`, `data-pos`, `data-yl`, `data-nt`, `data-mo`, `data-sc`, `data-st`,
  `data-bk`, `data-wa`, `data-change`. Adding a button means adding `data-act="thing"` and a case in
  `ACTIONS` — not an `addEventListener`.
- **Every new string goes in BOTH `I18N.en` and `I18N.ar`** in `js/app-i18n.js` (or the grouped blocks in `js/app-i18n-extra.js`). A missing Arabic key falls
  back to English mid-sentence inside an RTL layout and reads as a bug.
- `js/api.js` is **the only file allowed to talk to the server**. Everything else goes through `DB.*`.
- Every screen reads from the server. `js/data.js` holds the shape and the lookups; the data arrives
  through `DB.hydrate()`.

### Settings is an accordion, and a new card is a fold

(**Night shift 03 regrouped this into five sections, dropped the page-level Save and put the
mirror, the reminders and Telegram behind the developer’s door** — see that section. The fold
machinery below is unchanged; `setFoldStart` gained a fourth argument, one plain line saying what
the card changes.)

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

The dataset generator is gone (see above). `pick()`, `chance()`, `whRnd()`, the
`splitAcrossWarehouses()` IIFE and `pinDeadStock` were deleted on 16 Sep 2026. `rnd()` and `ri()`
remain in `js/data.js` only because `DB.newProduct` still calls `ri()` for the local mirror of a new
product. **Do not build on them**: a new screen that draws from `rnd()` is a screen inventing
numbers, which is the thing the server-only mode was introduced to end.

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

### Helpers in `js/app-shell.js` you should reuse rather than re-derive

```js
roleOf()            // 'manager' | 'cashier' | … | null when nobody is signed in
allow(perm)         // Auth.can(perm)
seesCost()          // allow('cost.read')
seesProfit()        // allow('profit.read')
isPartnerAccount()  // Yalla Wear — locked into their portal
navAllowed(id)      // per-screen gate, via the NAV_PERM map
ifNav(view, html)   // wrap in-page shortcut buttons ("View all →")
```

`allow()` is `Auth.can()`, so a signed-out browser draws nothing — there is no mode where
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

`VIEWS.dashboard` in `js/app-routing.js` is a chooser, not one screen with four moods:

| Role | Home | Built from |
|---|---|---|
| cashier | `viewShiftHome()` — her shift, never the shop's money | `stat`, `card`, `tbl` markup |
| warehouse | `viewBackHome()` — what arrived, what needs moving | same |
| delivery | `viewRunsHome()` → `Deliveries.view()` | live server data |
| manager | `viewDashboard()` — the full dashboard | `stat`, `card`, `tbl` markup (the three charts went in night shift 02) |

**Night shift 03 replaced all four of those with ONE screen, `Home.view()`** — 4–6 big job
buttons chosen by role and filtered by what the account may actually do — except the driver, who
keeps his runs. The owner’s and the developer’s full dashboard is still drawn, under the buttons.
See **Night shift 03** below; the four functions above still exist and `viewDashboard()` is still
what that half of the owner’s home is.

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
- **PowerShell here is 5.1**: no `&&`/`||`, no heredocs, no ternary; it prepends a UTF-8 BOM when piping
  (which once made a password not match its own confirmation). The Bash tool is available for POSIX.
- `dist/`, `flutter_app/`, `docs/img/`, `docs/fonts/`, `docs/*.pdf` are **deliberately untracked** —
  except `docs/img/warehouse-*`, the 3D room's design reference and its screenshots (see the shelf map).
  Committing `dist/` is what previously let the live site drift several versions behind.

## Tests

**One, deliberately small: `cd server && npm test`** (`node --test`, no dependency, no server, no
database). `server/test/config-keys.test.js` reads the browser's own source for every config key it
sends through `PUT /api/config` and checks each against `CONFIG_WRITABLE` in
`server/lib/config-writable.js` — the list the route itself uses. It reads an `updates` literal,
`updates['x'] = …`, and both debounced writers, `saveConfig(…)` and `saveSetting(…)` — night
shift 03 added the second when every box on the Settings shop card started saving itself, and a
writer the reader does not know about is a key nobody is checking. It exists because
**Settings → Save changes never saved** (found and confirmed on a scratch server, 15 Sep 2026): the button sends
`shop.name`, `shop.address` and `shop.city` with the loyalty rate, the allow-list had never held those
three, so the server refused the whole request with "shop.name cannot be changed here."; the exchange
rate, posted only after that save, never went out; and the page reloaded the old name, address and rate
over what had been typed, leaving one red toast. The three keys are on the list now, a blank shop name
is refused at the door, and the test was run against the old list to see it go red on exactly those
three keys (`js/app-actions.js:2015–2017`). It does not start the server — `index.js` reads `.env` and
would long-poll the real Telegram bots.

**Everything else was removed on request.** 986 checks (858 browser, 128 server) used to gate
deployment. Nothing inspects a push now, so a change that breaks the till reaches the live site as fast
as one that fixes it. Verify your own changes in a browser before pushing.

**But the night shifts left their own, in the gitignored `_nightshift/`**, and they are the
fastest way to find out whether a change broke something. They need the sandbox server on 8190
and a headless Chrome on 9224 that the SHELL opens (a browser a test script spawns cannot bind
its debugging port here) — the exact two commands are at the top of `docs/progress.md`. The widest is
`node _nightshift/ns03/sweep.mjs`: every screen every role can open, in English at 1100 and
Arabic at 390, checking for a console error, a failed request, a raw i18n key, sideways scroll,
anything drawn outside its card, and whether the last element on the page clears the phone bar.
It reads the navigation from the app itself, so a screen added next year is swept without anybody
remembering to add it.

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
- **A permission the mirror has no row for keeps this code's default** (`unknownPerms()` in
  `applyShop`). `role_permissions` is otherwise replaced whole, and a mirror written by a laptop on
  older code has no row at all for a permission a newer migration added — "no row" is denied, so a
  pull from it stripped 053's `money.move` and 054's `money.count` from the manager and the cashier.
  Safe because permission rows are only ever upserted, never deleted. Config is still replaced
  whole: the keys 053/054 seed have the same defaults in code, so losing them changes nothing.

Every guard refuses to the local copy with a reason code, and **no path exits or opens an empty
shop**: `sync_off` · `vault_off` · `unreachable` · `own_lineage` (the same laptop again — skipped:
the mirror is its own copy and a pull would only empty the Telegram outbox) · `mirror_empty` ·
`busy_elsewhere` · `unpushed_local` · `drift` (`lib/drift.js`, **both directions** — `ahead` means
this laptop's code is behind the mirror) · `fetch_failed` · `accounts_unreadable` · `backup_failed`
· `restore_failed` (the moved-aside file is put back). The result rides `GET /api/sync/status` as
`pull` — `MirrorUI` draws it, `backup` is stripped from the live-channel copy, the splash's cloud
chip says "N rows pulled", and `app-boot.js` toasts once per pull. `OG_PULL_AT_BOOT=0` on a dev
copy; `OG_SYNC_MINUTES=0` refuses on its own. The panel's Full refresh waits up to five minutes for
the answer (`ANSWER_LIMIT_MS` in `panel/panel.js`) because of this.

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

- **The schema files are run by hand in the Supabase dashboard**, `002` through `023` (`001` too,
  on a new project). **`021_cash_book.sql`, `022_day_close.sql` and `023_payables.sql` (local 053–055)
  are outstanding as of 16 Sep 2026** — until they are run the boot pull refuses with `drift`; run them
  in that order, then `npm run supabase:reconcile` (023 adds `employees.pay_day`, which the sync pushes
  without until then); see "The money". **`server/supabase/CATCH-UP.sql` is `008`–`023` concatenated** (the last three are the outstanding ones) — one
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
  a button — the dashboard paste stays the default, and nothing in this repo stores such a token. `002`–`007` are applied on the live mirror, and `008`–`018` went up with `CATCH-UP.sql`; the notes below say what each adds. `008` (rooms, and which wall a rack hangs on)
  must be run before the shelf map's rooms mirror at all — until then the sync skips `rooms` by name
  and pushes `sections` without the three placement columns. `009` adds `print_log.kind` (local `027`);
  until it is run the print history block is rejected and retries every run, so nothing is lost, only
  late. `010` adds `loyalty_redemptions` and `wants` plus `print_jobs.customer_id` (local `031`/`032`).
  `011` adds the three `customers` columns (local `033`). `013` adds the four rack-size columns on
  `sections` (local `036`); until it is run the sync pushes racks without their size and names the
  file every run. `002` adds `users.pw_enc` and is easy to forget because the sync only needs it
  once `OG_VAULT_KEY` is set.
- **A TABLE MADE IN THE SQL EDITOR IS NOT READABLE BY THE SHOP'S KEY ON THIS PROJECT** (found
  17 Sep 2026): 027 created `user_permissions`, and every push then died on `403 permission denied
  for table user_permissions`. The files that create tables since 019 (019, 021–023, 025–028, and
  their `CATCH-UP.sql` sections) now end with a guarded block — `GRANT SELECT, INSERT, UPDATE,
  DELETE … TO service_role`, `USAGE, SELECT` on any sequence the table owns, `REVOKE ALL` from
  `anon` and `authenticated` (001's second lock), a table that does not exist skipped — so running
  one twice changes nothing. **A new table file needs the same block.** Verified in PGlite: 001–028,
  `CATCH-UP.sql` twice, 025–028 again, a refused table fixed, a sequence granted.
  **And the mirror no longer stops for it**: `noteRefused()` / `guard()` in `lib/mirror.js` skip a
  refused table BY NAME at every step (reference, settings, users, the two-phase groups, layout,
  history, colours, loyalty, road, partner, cash book) and push the rest. Its bookmark (cursor,
  highest id or content hash) moves only after a push that landed, so its rows wait here and go up
  on the first run after the GRANT. It is loud: `Mirror.refusals()` rides the sync status as
  `denied` (`[{table, sql, since, at}]`), the panel's Connections card turns the mirror row red with
  the SQL and a Copy SQL button, the Settings Mirror fold draws each table with its line, the bell
  has a red `mirror_denied` row for `config.write`, and the log names the tables and the SQL when
  the list changes and after every full run. The fast lane asks a refused table at most once a
  minute and never reports it as pushed. Tested with a fake PostgREST (`_nightshift/denied-test.mjs`,
  29 checks; `denied-e2e.mjs`, 27 — the panel, the log, the bell and the fold in both languages,
  and the refusal clearing itself once the fake allows it).
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
  is the one list: **day · stock · print · yl · live** (the ten real-time `emitEvent` kinds) **·
office** (the nine `dl_*` order alerts, 052, which are gated harder than any other group —
see **The office hears an order move**). It
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

## Night shift 01 (17 Sep 2026) — colours, categories, the date picker, partner invoices

Built on branch `night-shift-01`, verified on a sandbox copy; the night's log is `docs/history/night-shift-01.md`.
**Mirror files 024–026 must be run in the Supabase dashboard BEFORE the shop laptop runs this code**
(026 above all — see "Colours").

### Colours — a product is colours × sizes (058)

`product_colours`, `server/lib/catalogue.js` (`coloursOf`, `addColour`, `updateColour`,
`setColourImage`, `addVariant`), `js/colourform.js` (`ColourForm`, the Add-product form and the drawer's
"Add a colour or a size"), `js/colourpick.js` (`ColourPick`), mirror file `026_colours.sql`.

- **A variant is a colour × size**: `variants.colour_id`, `UNIQUE (product_id, colour_id, size)`. The first
  colour keeps the old SKUs (`OG-050-42`); a later one is `OG-050-C2-42`.
- **THE PRINTED CODE IS SHARED BY EVERY COLOUR OF ONE PRODUCT AND SIZE** (the owner's decision): the
  barcode and the label code of a size are issued once and reused by `codesFor()`, so both columns lost
  their UNIQUE. `attachCode` writes a code to every sibling and refuses it only against a different
  product or size. A scan can therefore name several variants: **`DB.variantsByCode(code)` is the one
  lookup**, and every scan path — the wedge at the till, `resolveScan`, the till's own box, move-by-scan,
  the stock count, the office — hands the list to `ColourPick.choose(list, {whId, needStock}, cb)`. One
  colour (or one with stock at that place) is answered at once; otherwise a sheet of swatches. It draws
  on **its own layer (`#cpRoot`, z 970), never through `openModal`**, or it would close the move-by-scan
  panel it was asked from.
- **A product with ONE colour draws exactly as before.** `DB.shownColour(v)` is null for it, so
  `DB.variantLabel(v)` is just the size; a sold line freezes `sale_items.colour` / `colour_ar` only when
  there was a choice (`DB.lineSize(line)` prints it). Migration 058 gave every existing product one colour
  ("Standard / أساسي", or its colourway) and touched no SKU, stock row or movement.
- **Opening stock is `Stock.apply` (a `received` movement)**, for a new product, a new colour and a new
  size alike. `createWithVariants` takes `colours: [{nameEn, nameAr, hex, sizes:[{size, qty}]}]`; a caller
  sending only `sizes` gets one colour.
- **The migration checks itself.** `lib/migration-checks.js`: a migration listed there gets a `before` and
  an `after` inside its transaction, and 058's compares pieces, value and sizes per product, the movement
  count and the stock table — any difference rolls back and names the product, and the server does not
  start. It also asks for `foreignKeysOff` (SQLite's table-rebuild procedure: DROP TABLE on `variants`
  would otherwise cascade into `stock`), with a check that no NEW broken reference appeared.
  `OG_MIGRATIONS_DIR` points the runner at another folder — only for the test that proves the refusal on a
  deliberately broken copy; never set on a shop.
- **Colour photos**: `POST /api/colours/:id/image`, stored at `products/<id>/colours/<cid>/<time>.<ext>`; a
  product with no picture shows its first colour's.
- **The website** (`/api/ext/products`) carries `colours: [{id, en, ar, hex, imageUrl, sizes}]`; the stock
  reminders and the bell name the colour when there is a choice.
- **RUN 026 BEFORE THE SHOP RUNS THIS CODE.** Postgres still holds 001's `UNIQUE (product_id, size)` until
  026 drops it, and `variants` lead the unguarded core loop: the first second colour of a size would be
  refused there and take stock, customers, sales and deliveries with it. `mirror-lag.js` covers the
  missing column, not a constraint.

### Categories in both languages (057)

`categories` (`id` = the slug `products.type` already held), `server/lib/categories.js`, `js/catset.js`
(`CatSet`, Settings → Warehouse → Categories). Both names required, duplicates refused in either language
(folded), never deleted — switched off. `Categories.assertUsable` guards every product write (no foreign
key: that would mean rebuilding `products`). The browser keeps `DB.typeLabels` / `DB.sizeSets` and refills
them in place in the screen's language on hydrate and on every `applyLang()`; `DB.activeTypes()` is what a
form or filter offers. Pushed whole (`WHOLE_KEYS`), file 025.

`applyLang()` now also writes `localStorage['og.lang']`, which the login screen and the splash always read
and nothing wrote — so the gate was English for everybody. The app opens in it too. Every string on the
gate is in both languages, and `API.friendly()` prefers an `err_<code>` string in the screen's language.

### The date picker (`js/datepick.js`, `DatePick`)

Every `input[type=date]` is dressed by a MutationObserver, SelectBox's rule: the input stays (read-only,
transparent, ISO value), a face says the date through `fmtDate` with a white calendar icon, and a pick
fires `input` + `change`. The whole field opens it; a bottom sheet under 480px; the week starts on
**Saturday**; `min`/`max` honoured; arrows mirrored in Arabic. The wrapper is a `div` — `.field > span` is
the label's style. A purchase order now has a **due date** (`purchase_orders.due_date`, 056 / file 024):
the reorder dialog asks for it (not in the past, refused `due_past` on the server too), the PO list shows
it with a "late" badge, and the bell calls a dated order late the day after it (`po_overdue`).

### Safeers (السفراء) — the delivery team (060)

`server/lib/safeers.js`, `js/safeers.js` (`Safeers`, the Safeers screen, the Settings fold "Safeers — pay
and areas", and a safeer's errand cards under his runs), `errands` (cursor shape, file 028). Not a
rebuild of the office: PARCELS are still the deliveries table, assigned and moved on the board's own
routes; ERRANDS (a stock run, a supplier pickup, a bank trip) are new, move `waiting → out → done | failed`
(failed needs a reason), may point at an order, and never move stock or money by themselves.

- `safeer.read` / `safeer.write` (owner, developer, manager; FORBIDDEN to the partner). A safeer (role
  `delivery`) reads and moves only his own errands, scoped in the SQL; another's is 404 and he can change
  nothing but the status.
- **Pay is per delivery and derived**: delivered parcels + done errands × `config safeer.rate`
  (`{amount, currency}`), for today / this week (Saturday-first) / this month in the shop's day. **Earned
  and cash on him ride only with `money.read`** — left out, not zeroed — and cash is `Orders.driverCash()`.
- `safeer.areas` (config, the owner's list; 060 seeds real Aleppo districts) names where a task goes; the
  errands answer carries it so a phone that cannot read the team page still shows the name.
- Adding a safeer makes a `delivery` login through `People.add` (needs staff.write or access.write), the
  password shown once. Removing an account now returns its **waiting** parcels and errands to nobody.
- Nothing looks saved before the server has it; an unreachable shop says "connect to the shop wifi".
  No offline queue and no Telegram write buttons, by decision.

### Tick boxes in dialogs, and Yalla Wear's invoice from finished work

**No tick box inside any dialog could be ticked.** The backdrop carries `data-act="modal-backdrop"` and is
every control's ancestor, so the delegated dispatcher found it and called `preventDefault()` — which undoes
a checkbox's click — before the action decided not to close. The dispatcher now ignores the backdrop unless
it was pressed itself. That was why Yalla Wear had never issued an invoice. With it: the picker ticks whole
**jobs** (the server bills jobs, not kit lines); Issue waits for the server before saying anything; and
`Partner.createInvoice` refuses a job not finished, a job already invoiced, a reused number and mixed
currencies (409 `job_not_done` / `already_invoiced` / `invoice_exists` / `mixed_currency`).

## Night shift 02 (18 Sep 2026) — fewer steps

Built on branch `night-shift-02`; the audit that starts it is `docs/history/night-shift-02.md` and the
morning report is `docs/history/night-shift-02.md`. **No migration, no `server/supabase/` file, no
`mirror-lag.js` entry, no config key** — every flow here uses routes and columns that already
existed. The people who use this system are not computer people and the owner keeps his records
on paper; the whole pass is about the number of decisions between somebody and the job they came
to do.

### No charts, except one, and Chart.js is lazy

There were **five Chart.js canvases and eight hand-built bar visuals** in the shop. One chart is
left: **Reports → Sales**, a line of takings over the chosen window, drawn only when
`repChartRoles()` is true — **`owner` or `developer`**. That is a DISPLAY choice, not a boundary:
every figure behind it is already gated on `report.read`, and hiding a picture of data somebody
may read protects nothing. A note under it says the line is base currency only, because a canvas
plots one series and a reader who does not know that reads a short month.

- **`Charts.ensure()` injects `js/vendor/chart.umd.min.js` on the first draw**, the way
  `js/shelfroom.js` injects three.js. The `<script>` tag is gone from `index.html`; the file stays
  in `sw.js`'s precache, so it is already on disk when asked for. **Callers did not change** —
  `line`/`bars`/`donut` each start at `notReady()`, which fetches and redraws when it lands,
  latches a failed fetch so it is not retried on every repaint, and skips a canvas that left the
  page while 200 KB came down. This is why the **Yalla Wear portal, which is out of scope, still
  draws both its charts** without being touched. `Charts.compact()` is the app's number formatter
  (`js/app-util.js`) and is pure arithmetic — it never triggers a fetch.
- What replaced them: the dashboard's three became **`sellingCard()`** in `js/app-dashboard.js`
  (best sellers, category with the share as a number, and one sentence comparing this month with
  last, from the last two `charts.monthly` buckets — nothing new is computed). The product
  drawer's sparkline became two sentences. The driver's SVG ring became the figure that was
  inside it. `repBar()` prints a percentage instead of drawing one, and **keeps its column, its
  header and its width on purpose** — five tables call it and the phone card layout is addressed
  by column position. The reviews histogram is five rows that still filter.
- **The stock count's progress bar stays.** It is a progress indicator, not a picture of data.
- **Home screens do not count their numbers up.** `render()` puts `data-nocount` on `#view` for
  the `dashboard` view and `Motion.countAll` skips anything inside it — opt-out, so every other
  screen keeps the effect without being listed.
- Fixed with it: the dashboard drew a card reading "no staff" for every account without
  `staff.read`, which is the zero-instead-of-absent mistake that file is careful about everywhere
  else. It is gone; Reports → Employees is the one place that list lives.

### The warehouse has verbs on it, and goods can arrive

The screen opened on **Stock movements** — an audit trail — under six tabs wrapping onto two rows.
It opens on the four things somebody walks into that room to do, as buttons, with Add product
beside them:

    Goods arrived · Move stock · Where is it? · Count        (+ Add product)

- **`whPanels()` is the one list** — the buttons, the More fold and the dispatch all read it, so a
  panel cannot appear in one and not the others. **No tab id changed**, so every deep link,
  `data-act="home-wh"` and `NAV_TAB_STATE.warehouse` still land where they did.
- The rarer panels (the movement log, `po`, `wants`) are under **More**, remembered per machine in
  `og.wh.more`. `OG.wh.tab` defaults to **`arrived`** now, not `moves`.
- A cashier holds one of these jobs, so **she gets the panel and no bar** — one button is
  furniture. The fallback also **rewrites `OG.wh.tab`** rather than only a local, which is what
  used to draw a panel with nothing lit above it.

**`js/receive.js` (global `Receive`, `data-rc`) is the flow that did not exist.** A purchase order
had a button that fired on the press: no dialog, no review, the WHOLE order booked, the supplier
balance moved, and a label preview nobody asked for. **A short delivery could not be recorded at
all** — though `purchase_order_lines.received_qty`, `Purchasing.receive` and the route have
supported `received:[{sku,qty}]` since they were written. The two things people did instead both
lied: receive ten and write two off as `damaged`, or never receive the order and book eight
through the scan sheet, leaving the supplier uncharged for ever.

- **It is pick-and-count, NOT scan-first, and that is the design.** New stock arrives with no
  usable barcode — the shop prints its own OG labels afterwards — so this is the one moment in the
  building when nothing can be scanned. Printing the labels is therefore the last step and the
  main button, and the screen says why. From there on every other flow is scan-first again.
- Four steps: what arrived (open orders as cards, "not from an order", "a new product" → the
  Add-product form) · count it, prefilled with what is still owed, with "All arrived as ordered" ·
  where to, remembered per machine in `og.receive.place` · one confirm that names the pieces and
  the place · **Print N labels**.
- **A purchase order's place is the order's own** (`purchase_orders.wh_id`; the server takes no
  place from the request), so it is stated as a fact rather than offered as a picker that does
  nothing.
- More than was ordered is **not refused** — a supplier really does send an extra pair — and is
  said. The unordered path chains one `Shop.receive` per line inside ONE `Shop.write`, deliberately
  not atomic, and names the lines that did not land: unbooking goods somebody has already shelved
  is worse.
- **`Shop.write(send, mirror, done)` toasts its own failure and does NOT call `done`**, so the
  panel's rejection handler puts its own Save button back and rethrows.
- Repaints patch `#rcBody` / `#rcFoot` only — this panel holds typed quantities and a caret.

Three more from the audit, in `js/app-warehouse.js`: **move-by-scan remembers its direction** per
machine (`og.wh.moveway`) instead of resetting to store→floor on every open; the movement log's
reason column **names both ends** (`ms_note_way`) instead of saying "Carried to the floor"
whichever way the stock went; and **"Where is it?" has a search box** (`whFindMatch`, matching
name, brand, size, SKU, barcode and label code) — the only per-size-per-place breakdown in the app
had none, so answering "have you got it in a 42" meant scrolling the whole catalogue.

### Adding a product asks for four things

Name, category, selling price, quantity per size. Brand, made in, the colourway, the place and the
shelf are behind **More details** (`og.wh.addmore`). **Every box on the form round-trips through
`OG.wh` now** — they used to be markup with literal values in it.

Three of these were defects rather than friction, and are worth not reintroducing:

- **Brand and "made in" were dead inputs.** Drawn with no id and no `data-change`; `wh-save` never
  read them and the POST body carried neither, so anything typed was discarded in silence — and
  brand IS editable later in the edit modal, which made the loss harder to notice.
  `createWithVariants` has accepted all three since it was written.
- **The prices were pre-filled with 1050 and 2250**, as literal markup, and were not cleared
  between products. A hurried save booked a real shoe at 2,250. Both start empty, and the preview
  draws a dash rather than quoting revenue off a price nobody typed.
- **A blank selling price saved as 0** (`Number(...) || 0`) while the edit modal refused the same
  blank. One rule now, and it is the refusing one.

Two traps found while walking it: a **one-colour product showed the whole colour apparatus** — two
name boxes, a photo, a twelve-square palette — for a thing `DB.shownColour()` returns null for and
nothing ever draws. `cf-solo` on `#cfRoot` hides the heading, the chip, the names and the palette
and leaves the size grid; adding a second colour removes the class and everything comes back with
what was typed still in it. And a **single unnamed colour was refused by the SERVER**
(`colour_name_required`) pointing at a box the form had called optional — `ColourForm.payload()`
saves it as **"Standard / أساسي"**, which is what migration 058 gave every pre-colour product and
what the server's own fallback uses.

Also: **the label button is the primary one** (the boxes cannot be scanned unlabelled, and the
plain Save is a subset of it — it says "Save without labels"); the **duplicate guard's polarity**
was inverted, its eye-catching primary being the one that abandoned the save, under a caption
("Add stock to this one") for something it does not do; the success toast said "View all" and
opened the one product just made. The next product keeps the category, the brand and the country
and clears the rest. Three refusals that were hard-coded bilingual strings now have keys.

**"Visible" meant two opposite things on one screen.** The Products column and the edit checkbox
write `on_web`; the drawer printed `hidden` — the ARCHIVE flag — under the same word, so an
archived product read "On website: No" and a withdrawn one read "Yes". Two rows now
(`pr_on_web`, `pr_selling`), each naming its own question.

The **edit modal** leads with name, category and the two prices — changing a price is much the
commonest reason it is opened and it stood eighth of nine — with the rest behind a fold that moves
**one attribute and never re-renders**, because the dialog is full of typed-but-unsaved values.

### Money is six tabs, and a parcel has one next step

- **Nine tabs became six and a "Records" fold.** The six are jobs (where the money is · close the
  day · expenses · suppliers · salaries · this month); the three inside are records — the cash
  book is the audit trail, the debt book is read when a customer walks in, and the shift is the
  older way of proving the drawer that the day close replaced. The fold **opens itself when the
  tab inside it is showing**, so a deep link still lands with its own tab lit, and `S.more` lets
  it shut again. Two of the nine read as the same job ("Close the shift", "Close the day").
- **"Where the money is" carries the four jobs as buttons** — add an expense, pay a supplier, pay
  wages, close the day — each gated exactly as its own tab is. The expense opens its dialog on the
  way (`Money.addExpense()`), because there is nothing to read on that tab first.
- **A board row could carry nine buttons.** A parcel is always at one point on one road, so the
  row draws **one lime button for its next step** (waiting → Assign → Send out → Delivered) and a
  **"…"** for everything else. **Failed above all**: it is not a step forward and it was the same
  size and colour as Delivered, where a tired hand reaches. A parcel that already has a carrier
  gets "Send out" as its next step and "change the carrier" in the menu.
- The menu is **markup already in the row, shown by a class** — the board repaints on every live
  push and a popover built on click would be rebuilt out from under an open one. It closes on an
  outside press, bound once at the document **in the capture phase** so it runs before the
  delegated dispatcher. `.dlb-menu` sits at z 30: the topbar owns 20 and the phone tab bar 340.

### Things that will bite you

- **`.btn` is a flex row, so every child is a flex item.** A caption built as
  `'Print ' + '<bdi>12</bdi>' + ' labels'` comes out with the flex gap either side of the number.
  Wrap a composed caption in ONE `<span>`.
- **A fold or a direction remembered per machine makes a test depend on the last run.** The
  harness shares one Chrome profile, so `og.wh.moveway`, `og.wh.addmore` and friends have to be
  cleared at the top of a suite or it asserts what the previous run chose.
- **`cdp.click` scrolls `block:'nearest'`**, which on a phone can leave a target under the fixed
  tab bar, and the tap then reaches the bar. Nothing is permanently unreachable — the view's 86px
  bottom padding clears the 58px bar at the end of the content, and every action is reachable once
  centred, both measured — but centre a target before tapping it, the way a person scrolls until
  they can see the thing. This is app-wide and older than night shift 02.
- **`/api/catalogue` answers a partner 403 by design** (`js/shop.js` asks softly). With a shared
  browser profile a partner session from an earlier suite is still live for the moment before
  `login()` signs out, so that 403 appears in the console log of an unrelated suite. It is not
  evidence of anything.
- **The duplicate guard fires on test data.** `DB.similarProducts` folds at 0.5, so two products
  called "NS02 Check 123456" and "NS02 Check 654321" match and the save stops at the guard — which
  is the guard working, and worth handling in a suite rather than working around.

## Quick fix (18 Sep 2026)

Four fixes in an hour; the log is `docs/history/quick-fix.md`. **No migration, no data change.** One thing
to do by hand: `role_permissions` on the live database says `warehouse / cost.read = 1`, while
`003_role_permissions.sql` seeds it 0 — the row is stored state, not a code default, so it is
unticked in **Settings → Roles → Warehouse → "See what things cost"** and not migrated.

- **I COMMITTED THE `.pos` COLLISION AGAIN, and the Gotchas section above had already named the
  rule.** `.dlb-mi` was the deliveries card's METHOD ICON (32px, `flex:none`, `display:grid`);
  night shift 02 gave the same name to the row menu's items as `display:block; width:100%` under
  `body:not([data-portal="yalla"])`, which is (0,2,0) against (0,1,0). The icon took the whole head
  row and pushed the invoice number, the money and the Paid pill out of the card onto the next
  lane; the "empty lime band" people reported was that icon, stretched. The menu item is
  `.dlb-mitem` now. **Grep for a class name before defining one** — third time in this repo, and
  the first where the rule was already written down.
- **A class put on a node by a click does not survive a screen that repaints itself.** The Safeers
  page `repaint()`s whenever a load lands or a live event arrives, so the card menu opened and
  vanished within half a second. What is open is held in module state (`S.menu`) and re-drawn. The
  deliveries board gets away with the class because it only repaints on a pulse.
- **A popover inside a card needs the CARD lifted, not the popover.** The next card is a later
  sibling, so a `z-index` on the menu inside an unpositioned ancestor still paints under it — and
  the press lands on the wrong card. Found by hit-testing (`document.elementFromPoint`), which is
  the only way this kind of fault is ever found.
- **`scroll-padding-bottom` is the missing half of the phone tab bar.** The bottom PADDING was
  already right, so nothing rests under the bar at the end of a scroll — but `scrollIntoView`,
  focusing a field and anchor jumps all park the target flush with the scrollport's bottom edge,
  under a bar that floats over it. One property on `.view`, `.drawer-body` and `.modal-body`,
  because scroll-margin on the items would have to be remembered on every new element for ever.

## Night shift 03 (18 Sep 2026) — big buttons

Built on branch `night-shift-03`, off `quick-fix`; the audit is `docs/history/night-shift-03.md`, the
morning report is `docs/history/night-shift-03.md`, and `docs/progress.md` says where the run got to.
**No migration, no `server/supabase/` file, no `mirror-lag.js` entry, no data change.** Two things
to do by hand before the shop laptop runs it: untick **Warehouse → "See what things cost"**, and
**fill the shipping price list** (it ships empty and stalls every order).

### Every role opens on a verb — `js/home.js`

`VIEWS.dashboard` was four different home screens made of figures. It is `Home.view()` now for
everybody but the driver: **4–6 big job buttons**, and everything else one tap away under More.

- **`JOBS` is one table** (`{id, view, tab, perm, key, icon}`) and `ORDER` is the per-role
  sequence. Every entry is filtered by `navAllowed(view)` **and** its own permission, so a button
  is only ever drawn to an account that can do the job. `MAX` is 6; `FALLBACK` reads for an
  account given permissions its role does not normally carry.
- **A `key` may be a FUNCTION of the account.** `closeday` says "Close the day" to somebody with
  `money.move` and **"Count the drawer"** to somebody with only `money.count` — the cashier was
  being offered a job she cannot do. **Words are derived from the permissions that are actually
  stored, never from the role's name** (see the staff card below, which does the same).
- **The owner's and the developer's dashboard is untouched**, under the buttons, under a
  `.dash-tear`. They are the two who read the shop's figures.
- **The driver keeps his runs.** A grid of buttons over the parcels in his hand is one more press
  between him and the road.
- The phone's menu is `ROLE_TABS` (Home + 2–3) and `MORE_GROUPS` (built from `NAV` itself minus
  whatever is already a tab, under four plain headings). A group with nothing in it draws no
  heading, which is what emptied the driver's More of its empty grid.

### ONE SHAPE FOR EVERY MONEY DIALOG — `js/cashbook.js`

Eighteen dialogs, eighteen shapes: some led with a category, some with a currency, some with a
place, and the amount — the only thing anybody opened the dialog to type — stood second, third or
fourth and looked exactly like the optional note under it. The pattern, and every part of it is in
that file:

1. the **amount first**, big, focused (never on a coarse pointer), `inputmode="decimal"`
2. the **currency as two big toggles**, remembered per machine per job (`og.cb.cur.<job>`)
3. from / to / category as **chips** while there are few enough to show (>5 falls back to a select)
4. the date, the fee and the note under **one "More"**
5. a **sentence** saying what will be true afterwards
6. **refusals under the field** that causes them, before the button

- **EVERY CONTROL KEEPS ITS ID.** A chip row is visible buttons over a hidden input carrying the
  id the handler already reads — what `cbODir` has always done — so `move-go`, `add-expense-go`,
  `sup-pay-go` and `pr-pay-go` are untouched and cannot drift from what is on screen.
- **A chip press dispatches a real `change` on that hidden input**, so a live hint fires exactly
  as it did from a `<select>`. **`hookAttr` lets a hook name another module's namespace** —
  `'py:pay-hint'` writes `data-pyc` and so reaches payables' own dispatcher — which is why one
  helper set serves cashbook, money and payables without a second copy of any of them.
- Renames: **Cash book → Money history**, **Debt book → Who owes whom**, and that tab answers the
  question in two halves — "They owe us" over the customer debts, "We owe them" as a summary and a
  door to the Suppliers tab, where they are actually paid. The words were changed where they are
  DEFINED, not at seven call sites.

### EVERY FIGURE A PERSON TYPES GOES THROUGH ONE OF TWO PARSERS

`Desk.toMinor` (money) and `Desk.toCount` (a counted thing), both reading the same digits through
one `foldDigits` in `js/desk.js`. **`\d` in JavaScript is ASCII only**, so an Arabic phone
keypad's ١٢٠ was stripped to nothing in an app whose shop reads Arabic first. Arabic-Indic
(٠-٩) and Persian (۰-۹) digits fold to ASCII once; **٬ is always a thousands group and is
dropped, ٫ is always the decimal and settles it outright**, skipping the "three digits after the
separator" guess; ordinary, no-break and narrow spaces were already thrown away.

Seven places had it wrong, each measured in the browser before the change:

| Where | Was | Read as |
|---|---|---|
| the shift boxes | `parseInt("120,000", 10)` | 120 |
| **the shipping price list** | `Number("120,000") \|\| 0` | **0 — the carriage saved as FREE** |
| add-product quantities (×2) | `Math.floor(Number("١٢"))` | NaN → 0 |
| the stock count | `parseInt("١٢", 10)` | NaN → "not counted" |
| goods arrived | `Number("1 000") \|\| 0` | 0 |
| **the product editor** | `Number(String(v).replace(',', '.'))` | a 120,000 shoe saved at **120** |
| the exchange rate | `parseInt("13,000", 10)` | 13 |

**No new `parseInt` / `parseFloat` / `Number` / unary `+` on typed input, anywhere.** A money box
is `type="text" inputmode="decimal"`, never `type="number"` — a number box blanks itself on a
comma and refuses Arabic digits outright.

### The products list

- **One full-width search box that takes a scan.** `DB.productMatch(p, q)` in `js/data.js` is the
  one "which product does this text mean" rule — name, brand, colourway, the category in the
  screen's language, a size, a SKU, a barcode, the label code — and `whFindMatch` was rewritten to
  call it rather than keep the second copy that had already drifted.
- **A SCAN IS A SEARCH HERE.** `js/wedge.js` reads `e.key`, so a gun fired into a machine on the
  Arabic keyboard layout delivers a code whose LETTERS are replaced and whose digits survive — the
  fact the order desk and the handover sheet already match a slip by. A word of three or more
  digits matches the digits of any code with the letters and dashes taken out of both sides, so
  `OG-050-42` is found by whatever the layout made of it. The Products screen owns the scanner
  while it is on show (`prodScanOwns`): one row left opens, several or none leaves the list
  filtered and says what was scanned.
- **Filters behind a Filter button, as removable chips**, held in `OG.prod` — module state, never
  a class on the DOM, because this screen repaints on every save and every live push.
- **Selection is a mode.** The tick column was drawn on every row for anybody with
  `product.write`; press Select. Leaving the mode empties the selection, or the bulk bar would act
  on rows nobody can see.
- **Three quick edits on the drawer**: Change the price (one field, in the product's OWN currency
  and saying which), Add a size, Add a colour — the last two opening on the half that was asked
  for and ending in **"Print N labels"**, one per piece booked in. The full editor, stopping the
  line and the two exports moved under a `.pr-more` "…".
- **"Stop selling it" writes `hidden` and NOTHING ELSE.** `GET /api/ext/products` asks for
  `hidden = 0 AND on_web = 1`, so archived already beats the website switch — which is exactly why
  "Sell it again" can simply un-hide and cannot put a product on the website that was never on it.

### Settings is five sections that save themselves

- **The shop · Money and prices · Deliveries · People and access · Advanced**, most used first,
  every fold carrying one line saying what it changes (`setFoldStart(id, title, meta, sub)`).
- **The page-level "Save changes" is GONE.** The shop's name, phone, city and address went out
  only when somebody found a button in the page head, beside eight cards that saved on change —
  and those four are what the receipt prints at the top. `saveSetting()` in `js/app-changes.js`
  writes the same keys through the same route and puts a small **"Saved"** beside the box.
  **`server/test/config-keys.test.js` was taught that writer**: a writer the reader does not know
  about is a key nobody is checking.
- **Advanced is the developer's** — the mirror, the reminders, the Telegram links. That is
  DISPLAY: all three are `config.write` on the server and a hand-sent request from anybody else
  still gets a 403. What hiding buys is that the owner, who holds `config.write`, is not one
  mis-press from a boot pull that restores over his own shop.
- **The shipping price list is laid out to be filled in one sitting** — a row per city, the price,
  the currency as toggles, a ✕ per row, "Add a city" — and the order desk links straight to it
  (`dk-goto-prices`, through the shared `gotoSettingsFold`). An empty list says
  "No shipping prices yet — set them once →" to anybody with `config.write` and "Ask the manager"
  to everybody else. **Nothing invents a price.**

### The people — `js/staff.js`

One hiring screen, where there were two with different fields and different behaviour (Settings →
Access asked for a role off a dropdown of seven; the Safeers screen asked for a phone with the
role implied, and offered no Copy on the password shown once).

- **THE JOB LINES ARE GENERATED FROM `role_permissions`**, read live through `GET /api/roles` —
  never from the role's name and never from `003_role_permissions.sql`, which this shop's database
  differs from in at least two rows. On this shop the cashier holds `delivery.write`, so her line
  says "carries the parcels", which is true here and would be wrong from the seed.
- Adding a person is one dialog: name, phone, **five big job choices with a line each**, a
  username suggested from the name and still editable, the password shown once with Copy.
- **Reset and Switch off are under the card's "…"**, held in `S.menu` — this card repaints
  whenever a load lands. **Switching somebody off names what they are still holding** — parcels,
  errands, an open drawer, cash on them — in one sentence first, and offers the board to reassign
  the parcels. Switching on asks nothing.
- The card is gated on **`access.write`**, not `staff.write`: every route behind it is
  `access.write` on the server, and a card that draws and then 403s on every button is worse than
  no card.
- **Buying needs `cost.read` now.** A purchase order is a list of unit costs and a supplier
  balance, and "Worth reordering" ranks by money; `whPanels()`'s `need` may be a list, meaning
  EVERY one of them (unlike `requirePerm`'s any-of).

### The country follows the city

Eleven rows in the sandbox are Aleppo addresses filed under JO or TR, **every one of them
`method: driver`** — our own driver does not go to Amman, so this was never carelessness. Five
separate ways for the pair to disagree, none guarded:

1. changing the city never touched the country;
2. the country lives in the DRAFT, which lives in `localStorage`, so one order to Amman left JO on
   the next five;
3. "use the last address" copied the two with independent fallbacks
   (`r.dest.country || S.country`), so a destination carrying a city and no country kept the
   PREVIOUS order's;
4. picking a customer filled the city and never the country;
5. a one-country shop drew no control at all, so a draft already carrying TR could never be
   corrected from that screen.

**`Desk.countryFor({country, city, method})` is the one rule**: the country is a question ONLY
when the parcel is going abroad, a city the price list knows carries its own, and a draft holding
another one is put right before it is drawn. The existing rows are history and were not edited.

### The board card, and the driver's phone

- **The destination is said once**: the city as the heading, the country only when the parcel is
  leaving the country (`Desk.homeCountry()`, the owner's own list, never assumed to be SY), and
  the typed address with the city taken off either end — people write "Aleppo, Seryan, near the
  bakery" and the heading already says Aleppo. `withoutCity()` only ever strips a whole word at an
  end, never from the middle where it may be a street name.
- **The four unlabelled dots are gone from lane cards.** Three of them repeated the lane the card
  sits in, and the fourth — "some money has arrived" — could contradict the green **Paid** pill two
  inches above it. The rail stays on the table row, where there is no lane, and in the order
  dialog, where it has its words.
- **A parcel whose driver was switched off says so in amber.** Removing or disabling an account
  re-points its WAITING parcels to the hidden "Former staff" record, and one already OUT keeps
  that id for ever — the board drew a parcel on the road with a carrier nobody can call and said
  nothing. `driverActive` is a read-only column off a join the query was already doing.
  **The button is honest about what the server will accept**: Reassign while it is still on the
  counter, and Delivered (with "Couldn't deliver" behind the dots) once it has left, because
  `Deliveries.update` refuses a carrier change past `waiting` with `bad_status` — a parcel in one
  person's hands going to a second is what the handover sheet exists to prevent.
- **The pointer glow does not belong on a work screen.** `.mo-glow` (`css/tokens.css`) is
  `position:fixed; z-index:1` on the BODY while a lane card is `position:relative; z-index:auto`,
  so a 260px lime haze followed the mouse ACROSS the cards. One rule keyed on the `data-view` the
  router already sets, off on deliveries · safeers · warehouse · money · desk · pos.
- **The driver's home opens on "Cash on me"** — what is in his pocket and has not reached the
  shop, the same rows `Orders.driverCash` counts, as a pair and never added. Each card says the
  area on its own line, and **"Couldn't deliver" moved under a "…"** so Delivered is the only
  button that size.

### Safeers

One lime button, **"Give a task"**, opening a sheet with two big choices — the header carried two
buttons that were the same idea. **Refresh is gone**: the page reloads after every action, on
every live push and when the window comes back, and says "Updated 1 min ago" instead. Each card is
three big numbers (Open tasks · Done today · Cash on him) — **a real `0` where there is none, and
`—` only where the account may not ask, which are different answers** — one button, and "this
month" in the detail line. A missing pay rate is a dash plus an owner-only link straight to that
setting, rather than printing "Settings → Safeers", a path most accounts cannot open. The
always-open Add form is a quiet button and a dialog with Copy. The filters are behind a Filter
button as removable chips, in `S.filter` / `S.filtersOpen`.

### `variants.shelf` lies, and the catalogue stopped repeating it

The column is written once, at insert, and the real assignment is `stock.shelf_id`, which never
touches it — on this database it is set on **zero** rows while the product drawer, the count sheet
and the scan sheet all printed it as the answer to "where is this size". `Cat.bundle`'s variants
query now also answers **`shelf_at`**: the section key and shelf code of the place the stock
actually is, most held first. `js/data.js` hydrates `shelf` from it and keeps the old column
underneath as `shelfSaid`. No schema change and no row written.

### Things that will bite you

- **A figure typed by a person goes through `Desk.toMinor` or `Desk.toCount`.** Nothing else.
  Add a check whenever you add an input; `_nightshift/ns03/p2-digits.mjs` is where they live.
- **Words are derived from the permissions that are STORED**, not from the role's name and not
  from the seed file. This database differs from `003_role_permissions.sql` in at least two rows
  (`warehouse / cost.read`, `cashier / delivery.write`), and a screen that reads the seed
  describes a job nobody here has.
- **UI state that must survive a repaint lives in module state** — an open menu, an open filter
  panel, which filters are on, a selection, a half-filled dialog. A class put on a node by a click
  does not survive a screen that repaints itself. `S.menu` (safeers, staff), `OG.prod.filters`,
  `S.filtersOpen` (safeers) all exist for that reason.
- **A card that holds its actions in a flex ROW will push them out of a narrow grid column**, and
  the NEXT card — a later sibling at the same z-index — paints over them. The staff card's dots
  were the right size and the press landed on somebody else's avatar. Found by hit-testing. It is
  a grid now.
- **A `.table-wrap` exists to hold something wider than itself.** A sweep that measures "is
  anything outside its card" has to skip what is inside one, or every wide table is a false
  positive — and it has to measure twice, because the mirror card and the office's settings fetch
  for themselves and a rectangle read mid-redraw never existed.
- **TWO SUITES CANNOT RUN AT ONCE.** They share one Chrome profile and therefore one cookie jar:
  the second one’s sign-out kills the first one’s session, and the first then collects 401s on
  `/api/safeers`, `/api/errands` and `/api/deliveries` that have nothing to do with what it is
  testing. Run them one after another.
- **The shared Chrome profile carries the previous suite's session** for the moment before
  `login()` signs it out, so `/api/deliveries`, `/api/safeers` and `/api/errands` answer a partner
  session **403** and `/api/auth/logout` answers **401**, in a suite about something else. Start
  the ledger after the login, as `sweep.mjs` does.
- **`js/staff.js` is new and is in `sw.js`'s precache.** Adding a JS file means both.

### How it was verified

`cd server && npm test` (6), and over CDP on the sandbox: `ns03/p1-home` 53 · `ns03/p1-tabbar` 65
· `ns03/p2-money` 39 · `ns03/p2-money-phone` 34 · `ns03/p2-digits` 36 · `ns03/p2-cashier` 22 ·
`ns03/p3-products` 50 · `ns03/p3-products-phone` 17 · `ns03/p4-settings-staff` 43 ·
`ns03/p5-safeers-board` 56, plus `ns03/sweep` over every screen every role can open in English at
1100 and Arabic at 390. Every money move, every price, every new person, every reassignment and
every Delivered was read back out of SQLite — never off the screen that wrote it. The ns02 and
quick-fix suites re-run green; `qf-safeers` and `ns02/p2-edit` were updated where a control moved.

## Fix 04 (18 Sep 2026) — the parcel that cannot come back, and the till's bottom

Branch `fix-04`, off `night-shift-03`; the log is `docs/history/fix-04.md`. **No migration, no schema
change, no data change, and no server permission weakened.** Nothing to do by hand.

### A parcel on the road with "Former staff" on it is STUCK, and that is the schema

It was asked for as a small fix — a lime **Bring it back** on the board, running the existing
routes, landing the parcel in `waiting` where Assign already works. **It was not built, because
the second half of that path does not exist.** `NEXT` in `server/lib/deliveries.js` is
`waiting: ['out','failed']` · `out: ['delivered','failed']` · `delivered: []` · `failed: []`, and
assignment is refused on anything past `waiting` (`bad_status`). Every one of the six ways back was
tried against the running server and refused with a 409 — `fix04/bring-back` is that, pinned, with
the delivery rows, `money_moves`, `stock_movements` and `order_payments` counted before and after
to prove nothing was written while proving it.

- **What "couldn't deliver" actually does**: writes `fail_reason` and `closed_at`, and nothing
  else. No `Cash.apply`, no `order_payments`, no `Stock.apply` — the goods stay out and the money
  stays owed. Outside the row it fires the office's `dl_failed` Telegram alert and a permanent
  "could not be delivered" event on the customer's tracking page (`push_seen`).
- **The only other route that moves an `out` parcel is a RETURN** (`Orders.takeBack`), and it is a
  money-and-stock decision rather than a fix: it restocks through `Stock.apply`, pays a refund or
  grants store credit, and **still closes the delivery as `failed`, never back to `waiting`**.
- So the only way to satisfy the ask is to add `failed → waiting` to that table — a new server
  rule, against the module's own stated invariant ("delivered and failed are the end"), which is
  the stop condition the brief wrote. It is question 1 in `docs/history/fix-04.md` and the owner's to
  answer. Night shift 03's board is already honest about it: Reassign only while the parcel is on
  the counter, Delivered (and "Couldn't deliver" under the dots) once it has left.

### The till's bottom on a phone — and the cart sheet that scrolled away

Reported as "the last 58px sit under the tab bar". Measured at 390 it was two faults, both worse
than that, and both fixed in one block in `css/og-skin.css` (`FIX 04`), **layout only** — the
sale, its steps and its buttons did not move. The desktop is untouched: the 1100 picture is
byte-identical to a golden taken with the fix stashed out.

- **THE COMPLETE-SALE BUTTON WAS NOT UNDER THE BAR, IT WAS NOT THERE.** At ≤720 the cart is a
  fixed sheet (`.pos-right`, `bottom: var(--tabbar-h)`, `max-height: 76vh`, `overflow: hidden`)
  holding head + lines + foot. The ≤1080 block lifts the base `max-height: 64vh` off the foot —
  right for 721–1080, where the cart is stacked and follows the page down — and the base says
  `flex: none`, so inside a 578px sheet the foot kept its full 851px of customer, discount,
  totals, eleven payment methods and Pay, and the sheet's own `overflow: hidden` cut the bottom
  426px off. **`flex: 0 1 auto; min-height: 0`** lets it shrink, its own `overflow-y: auto` then
  scrolls it, and **Pay is `position: sticky; bottom: 0`** in a band of the foot's own colour so
  the one control the screen exists for is never the thing you have to go looking for.
- **THE SHEET WAS NOT FIXED TO THE SCREEN.** `#view` carries `.fade-in` (every repaint) and
  `.mo-view` (a view change); both END in `transform: none` and both fill **`both`**, so the
  finished animation goes on applying that last keyframe and `#view` keeps
  `transform: matrix(1, 0, 0, 1, 0, 0)` for as long as the screen is up. An identity transform is
  still a transform, and it makes `#view` the containing block for everything `position: fixed`
  inside it — so scrolling to the end of the shoes took the cart, the total and the pay sheet
  **2,210px off the top of the screen**. `animation-fill-mode: backwards` is the cure and costs
  nothing on the glass. **This is the `shell.css` stacking-context trap one step on** (the same
  filling animation, the other consequence), and the same one the order desk met in its sticky
  foot; it is scoped to the phone till because that is the one screen with something fixed inside
  the view. Whether `.fade-in` should say `backwards` app-wide is question 3 in the log.
- Smaller, same block: the product grid cleared the 62px collapsed cart sheet and not the bar
  under it (`calc(62px + var(--tabbar-h) + 24px)` now); `.view.pos-view` opts out of `.view`'s
  padding by design, so it has to restate its own `scroll-padding-bottom`; and the lines window's
  90px floor was shorter than one 125–140px cart line, which showed half a shoe with the top of
  it scrolled up behind the head.
- **`ns03/sweep` no longer skips the till.** It had a written exception pointing at question 5 of
  the night-shift-03 log; the till is swept now, measuring the last PRODUCT CARD rather than the
  view's last child, because `.view.pos-view` has no bottom padding of its own to measure against.

Verified: `fix04/bring-back` 33 · `fix04/till` 88 (both languages at 390 as the cashier and as the
owner, a cart of one and a cart of twelve, every control hit-tested, a real sale rung up on the
phone and read back out of SQLite), plus `npm test`, `ns03/sweep` and `qf-board`.

## Fix 05 (19 Sep 2026) — the buttons that did nothing, and one build per page

Branch `fix-05`, off `fix-04`; eight commits, the log is `docs/history/fix-05.md`. **No migration, no
schema change, no `server/supabase/` file, no `mirror-lag.js` entry, no data change, and no server
permission weakened.** Nothing to do by hand.

It started as "the job-home buttons do nothing, the Safeers buttons do nothing, and Money looks no
different" against 1131 green checks. There were **two** causes and only one of them was the
cache, which is why it read as one mysterious fault.

### A BUTTON WIRED TO A NAMESPACE NOBODY LISTENS FOR IS A DEAD BUTTON

`js/home.js` drew every job tile as `<button class="hm-job" data-hm="go" data-id="…">` while its
handler was registered as `ACTIONS['hm-go']` — and **`ACTIONS` is the table behind `data-act`**.
Nothing in this app has ever listened for `data-hm`. So every tile, on every role's home, did
nothing when pressed, for the whole of night shift 03, and 53 checks went green over it because
`ns03/p1-home` MEASURED the tiles — they exist, there are four to six, they are 88px tall, the
first hit-tests to itself — and pressed none of them.

- **A measured button and a working button are different claims.** Every suite written since
  presses the middle of what is PAINTED, through `Input.dispatchMouseEvent` and
  `Input.dispatchTouchEvent`, and refuses a point that belongs to something else. `cdp.mjs` gained
  `box()` / `press()` / `tap()` for exactly that, and a `key()` that performs the DEFAULT ACTION —
  `keyDown` alone delivers the JavaScript event and no click, so Enter on a focused button looked
  broken when it was not.
- **`_nightshift/fix05/p0-namespaces.mjs` is the general rule**, read off the source in about a
  second with no browser: no button in the app may carry a `data-*` namespace nothing dispatches
  on, and no registered `data-act` handler may be unreachable from markup. It is verified to go
  RED on the tile exactly as it was written. **Run it after adding any control.**

### ONE PAGE, ONE BUILD — `js/update.js`

`sw.js` called `self.skipWaiting()` on install, so a new worker took over a page that had already
parsed the OLD files and served it the NEW ones for anything fetched later (the lazily injected
Chart.js, three.js, an icon, a font). New markup, old handlers, no reload to settle it — the same
symptom with none of the cause, and it is what the Safeers half of the report was: every control
on that screen was pressed one at a time and all of them work.

- The new worker **waits**. `Update.watch(reg)` (wired from `index.html`'s registration) notices
  it, asks for one on focus and every five minutes, and when there is one it waits for
  `Update.busy()` to be false — an overlay, a modal, a drawer, the refresh cover, **an open
  basket**; deliberately NOT the order desk's draft, which is in localStorage with its own `opId`
  and comes back exactly as it was. Then it toasts and reloads the tab ONCE.
- `skip-waiting` and `version` are the worker's two messages. **Adding a JS file still means
  adding it to `SHELL` and bumping `CACHE`** — that has not changed.
- **Which build is this**: `GET /api/health` carries `build: { branch, started }` to a SIGNED-IN
  caller only (a stranger on the wifi gets nothing), and Settings draws `og-system-v280 · fix-05`
  at the bottom for the **developer role only**, with the cache name read back out of the worker
  over a MessageChannel rather than guessed.

### EVERYTHING THAT FLOATS SHUTS IN ONE PLACE — `js/layers.js`

The reported "shelf popup that stays on screen" is the map's bay card (`.sm-peek`), which is
appended to `<body>` — it has to be, the map repaints under it — and `render()` rewrites `#view`
and never touches `<body>`. Fourteen things float outside `#view`, and fixing them one at a time
is how the fifteenth is forgotten.

- `Layers.route()` is called by `go()` **before it writes the hash**; `Layers.closeTop()` answers
  Escape and the back gesture; `Layers.anyOpen()` is what a suite can ask. **Adding a floating
  layer means `Layers.register(name, isOpen, close, rank)`** — low rank is topmost.
- **Each closer takes the MODULE STATE with the node**, because these screens repaint themselves
  and a class taken off a node comes straight back (the quick-fix lesson): `peekPin` on the map,
  `S.menu` on the Safeers and Staff cards, `pick.open` on the order desk.
- **The back gesture.** While a layer is open a marker entry sits on the history stack with the
  SAME url — no hashchange, so no route change — and Back pops it: popstate sees the marker gone
  and a layer open, and closes the layer instead of navigating. Two traps, both found by a suite
  that went flaky rather than red, both worth not reintroducing: `route()` must drop the marker
  BEFORE it closes anything (closing runs `syncOverlay` → `history.back()`, which undid the
  navigation that asked for the cleanup), and a dialog REPLACING a dialog must not unmark and
  remark in one beat (`history.back()` is async, so the pop removed the new marker). `unmark()`
  also refuses outright unless `history.state.ogLayer` is really there.

### EVERY PHONE DIALOG IS A BOTTOM SHEET, AND THE KEYBOARD IS ANSWERED

`openModal` decides it now, not each of forty callers — three passed `sheet:` and the rest put
their Save under the eye, out of thumb reach and behind the keyboard.

- **A `position: fixed` element is fixed to the LAYOUT viewport, which the phone keyboard does not
  change.** There is no CSS for this: `100dvh` answers the browser's toolbar, not the keyboard.
  `js/layers.js` reads `visualViewport` into `--vvh` (what is visible) and `--kb` (what the
  keyboard took), and the stylesheet stands the sheet on top of the keyboard with its confirm
  button on the glass. `body.kb-open` is the flag, and it needs more than 120px of movement —
  a toolbar sliding away as the page scrolls is not a keyboard.
- A grab handle, a pull-down to close (bound to the handle and the head only — a pull that starts
  on a list is a scroll), its own scroll with `overscroll-behavior: contain`, and the page behind
  held still (`body[data-overlay] .view { overflow: hidden }` — `.view` is the scroller here, not
  `<body>`).

### MONEY

- The jobs are the **same tiles as the job home** (`.hm-job`), one grid, one lime primary. A
  "Today" card carries five to ten plain sentences instead of sending somebody to read six columns
  of signed minor units. Places are bigger cards; the records stay behind one entry.
- **`Cashbook.bigAmount` is the one money box in the app**, and it now carries the currency symbol
  INSIDE the field and groups as you type — 120000 becomes 120,000 on the sixth digit, with the
  caret held even for a digit typed into the middle, and Arabic-Indic digits grouped with `٬` and
  never converted. **It stops dead the moment somebody types a separator themselves**: "12,50"
  means twelve and a half here, and a formatter that regrouped it as 1,250 would change the
  meaning of a figure while it was being written. Deleting the separator starts it again.
- **`Cashbook.submit` is the one way a money dialog saves.** Spinner, disabled, in the button's own
  width so nothing shifts; a second press never becomes a second click; the `opId` minted when the
  dialog opened means even a press that reaches the server twice is one move. Success closes the
  sheet, toasts, and **lights the card whose figure changed**. A refusal puts the reason under the
  field and keeps every typed value; no line at all says "Not saved — check the connection and try
  again" and keeps them too.
- **`Shop.write(send, mirror, done, fail)`** gained the fourth argument and now ANSWERS whether it
  started. Without either, a refusal was a generic toast headed "Stock", the caller never heard,
  and a button could be left spinning over a write that never began.

### PHONE QUALITY, MEASURED AT SIX WIDTHS

`ns03/sweep` walks 360 · 375 · 390 · 414 · 430 portrait and 740 × 360 landscape now, in both
languages, for every role — the two full passes keep every check and the five extra widths ask
only what differs with width. **Under 16px an iPhone zooms the whole page in when a field takes
focus**, and every field in the shop was 13.5px; they are 16px and 44px tall on a phone, with
`inputmode` and `enterkeyhint` derived from what the field already is (`hintInputs`, called by
render and by openModal). The top bar's bell, sync, presence pill and avatar were 34–38px with the
account menu immediately beside them. `100dvh` replaces `100vh` **on phone widths only** — on a
desk the two are the same number and it is not free, as fix 04's golden proved by re-aliasing.

### THE TWO PARSERS

`Desk.toMinor` / `Desk.toCount` are still the only way a typed figure becomes money or a count,
and the devil pass found two things wrong with them:

- **A minus was stripped with the punctuation**, so "-500" read as five hundred. Nothing in this
  shop is ever negative — a correction is its own row — so a leading minus is now the same answer
  as an empty box. `ns03/p2-digits` ASSERTED the old behaviour; a suite that asserts a bug
  protects it.
- **A thousands group cannot follow a bare zero.** "1.250" is twelve hundred and fifty, which is
  how this shop writes it; "0.005" was five dollars and is now nothing.

### THINGS THAT WILL BITE YOU

- **Grep for a `data-*` namespace before inventing one, and check it has a dispatcher.** This is
  the `.pos` class collision and the `firstName()` global, in a third shape. `fix05/p0-namespaces`
  is the check.
- **A suite that measures a control has not tested it.** Press the middle of what is painted, with
  a real pointer event, and read what the app did out of the DATABASE.
- **A suite must not spend its own fixture.** `ns03/p5` assigned a waiting parcel and sent it out
  on every run with nothing sending one back, so it passed once and then reported a broken screen
  for ever. `_nightshift/fix05/fixtures.mjs` makes what it needs through the shop's own routes —
  and is honest about the rule it meets on the way: a parcel CANNOT be assigned to a switched-off
  account (`bad_driver`), so the orphan is made the way the shop makes one.
- **A byte-for-byte screenshot is a check about the browser.** Fix 04's golden went red with the
  stylesheet provably unchanged, because this session's Chrome was started with different
  command-line flags. `comparePng` in `fix04/golden-desk.mjs` asks whether anything MOVED instead.
- **A hidden element's rectangle is all zeros**, and reading a floor off one puts the floor at 0.
  The sweep read `#tabbar`'s top at widths where it is `display: none` and reported every screen
  in landscape as 264px under a bar that was not there.
- **Starting the harness Chrome on Windows: QUOTE THE PROFILE PATH.** The repo lives under a path
  with a space in it, and an unquoted `--user-data-dir` reaches Chrome as three arguments — it
  reads the last two as URLs and exits with `Multiple targets are not supported in headless mode`,
  which names nothing that is true. The exact lines are at the end of `docs/progress.md`.
- **`Layers.route()` drops the history marker BEFORE it closes anything**, and `openModal`
  replacing a dialog must not unmark and remark in the same beat. Both produced a screen that
  navigated backwards by itself.
- **THE CONSOLE-ARTEFACT FILTER IS ONE LIST, `quietErrors(T, extra)` IN `cdp.mjs`.** It was kept
  in 39 copies and they had all drifted: one full pass went red on four suites, the next on a
  different four, and neither had anything to do with what those suites test. The same second-copy
  problem as `mirror-lag.js` and the panel’s job list, in a harness. What it drops is the shared
  cookie jar’s 401s on the polling routes, and a NETWORK failure fetching a product photograph
  from the public Supabase bucket — because no picture is a state every screen draws correctly,
  so a dropped wifi is a check about the router. **A 404 or a 403 from that same bucket stays
  red**, because that is a row pointing at a picture that is not there, and so does a dead line to
  the shop’s own server. Both directions were measured before the rule was kept.
- **A dropped wifi mid-run reads as eleven broken suites.** The third full pass was 23 red across
  eleven suites; 21 were that one `<img>`, and the other two were the same outage slowing a save
  past the wait in front of it. Both re-ran green on their own with the line back. Before hunting
  a fault that is spread evenly across unrelated suites, check the room.

### How it was verified

`cd server && npm test` (6), and every suite one at a time (`bash _nightshift/fix05/run-all.sh`,
which is the one-at-a-time rule made into a script). The fix-05 suites: `p0-namespaces` 6 ·
`sw-update` 11 · `p1-tiles` 173 · `p2-layers` 48 · `p3-safeers` 75 · `p4-money` 49 · `p5-phone` 122
· `p6-devil` 52 · `p7-style` 617, plus `p6-load` 49 (destructive — run between a backup and a
restore; 500 products, 200 parcels and 300 money events, measured at 1,532 / 626 / 1,922 after
three runs, then the database put back). `ns03/sweep` is 1027 over six viewports. Every money
move, every errand and every product was read back out of SQLite, never off the screen that wrote
it. **WebKit was not driven** — there is no Safari on Windows and the only way to a WebKit build
here is an npm install, which this repo does not have and will not grow for a test; the iOS risks
that ARE addressed are listed in `docs/history/fix-05.md`, and what remains untested is named there as
untested.

## Fix 06 (19 Sep 2026) — the screen that was asking the shop 235 times a second

Branch `fix-05`; **no migration, no schema change, no server change, no permission
weakened.** One file of app code, `js/safeers.js`.

The Safeers screen was reported as "still not working" after fix 05 had pressed every control on
it and found them all sound. Both reports were true. The controls work; **the screen was redrawing
itself two or three hundred times a second**, so a press that landed between one rewrite and the
next went to a node that no longer existed.

### AFTER() → LOAD() → REPAINT() → RENDER() → AFTER()

`render()` ends by calling the screen's after-hook. `Safeers.after()` called `load()`. `load()`
called `repaint()` when its answer landed. `repaint()` called `render()`. **Measured on the code as
it stood: 1,884 requests to `/api/safeers`, `/api/errands` and `/api/deliveries` in eight idle
seconds** — about 235 a second, per open tab — and 384 on a single navigation onto the screen.
After the fix, in the same eight seconds: **zero**.

- `after()` now asks only when there is nothing, when the shop has been written to since
  (`Shop.loadedAt()` moves on every reload), or when what it holds is more than `FRESH_MS` (20 s)
  old — the same number the focus handler already used for "just looked". **A live push and every
  action still call `load()` directly**, which is what keeps the screen current; the guard only
  stops it chasing its own tail.
- **It also explains the quick-fix note about the card menu "opening and vanishing within half a
  second".** That was treated by holding the open menu in module state, which was right — and
  nobody asked why the screen was repainting twice a second in the first place. The symptom was
  fixed and the cause left in.
- **Safeers was the only screen with this shape**, and that is not luck: the board and the reviews
  page write `#view` themselves (`host.innerHTML = view()`) and so never re-enter `render()`, and
  the order desk guards its load behind `if (!boot)`. Safeers is the one that repainted through
  the app's own `render()`. `_nightshift/fix06/idle.mjs` now asks the question of every screen the
  owner can open, by counting requests while nobody touches anything.

### The second one, which only showed itself when the shop could not be reached

`myErrandsHtml()` — the safeer's own errands, drawn under his runs on his phone — asked for them
while drawing, and `loadMine()` ended in `render()`. On the happy path that stops, because
`S.mine` is no longer null. **On a failure it did not**: the request failed, `S.mine` stayed null,
`render()` ran, the draw asked again — an unbounded retry loop on a phone that had just lost the
shop's wifi, which is the worst possible moment to spin. `S.mineTried` makes it ask once; the
error card's Retry and a live push are how it comes back.

### And one thing the loop had been hiding

"Updated 3 minutes ago" was only ever current because the screen was repainting constantly. With
the loop closed it would have frozen at "just now" and lied for the rest of the afternoon — the
screen's one claim about how old what you are reading is. One 30-second interval writes **that one
element's text** and never repaints, because this page holds an open card menu, a filter panel and
a half-typed dialog, and redrawing takes all three away.

### What was NOT wrong

Worth writing down, because it was all checked before the cause was found: the routes are all
registered on the live server (`/api/safeers` answers 401, not 404); `role_permissions` holds
`safeer.read` and `safeer.write` for owner, developer and manager; the pay rate and the areas are
set; every one of the eight connections answers each role correctly (`fix06/safeer-connections`
prints the matrix — the manager's 403 on `PUT /api/safeers/settings` is `config.write` doing its
job, not a fault); and the safeer's own phone works end to end, with a real tap moving an errand to
`out` and read back out of SQLite.

### How it was verified

`fix06/no-loops` 7 — **and it was run against the old code first, where it goes red with 1,884 and
384** — `fix06/safeer-phone` 13 (two errands made through the office's own route, tapped on a
390px phone, read back from SQLite, another safeer's errand 404 to him), `fix06/safeer-connections`
9, `fix06/idle` over every screen, plus `ns02/qf-safeers` 22, `ns03/p5-safeers-board` 56,
`fix05/p3-safeers` 71 and `ns03/sweep`. `fix06/safeer-audit` is the report that found it: it
presses every visible `[data-sf]` control in turn and says what each one actually did.

### Things that will bite you

- **A screen whose `repaint()` goes through the app's `render()` must not load from its
  after-hook.** `render()` calls the after-hook; that is the loop. Either repaint by writing
  `#view` yourself, as the board and the reviews page do, or guard the load — never both halves.
- **Count the requests.** Every suite on this screen was green throughout, because each one
  navigated, waited, and asserted a DOM that was always correct — it was just being rebuilt three
  hundred times between the assertions. A screen that is redrawing itself passes every check you
  can write about its markup. `fix06/idle.mjs` is the check that cannot miss it.
- **A drawing function that starts a fetch must be able to stop asking.** `myErrandsHtml()` was
  right to load on first draw and wrong to do it again after a failure; the flag is the difference.
- **Every suite gets its own browser now: `bash _nightshift/with-chrome.sh <suite>`.** A temp
  profile and a free port per run, so no suite can end another's session — the shared cookie jar
  is what the "two suites cannot run at once" rule and half of `quietErrors` were working around.
  `run-all.sh` goes through it. `cdp.mjs` reads its port inside `tab()`, because an ESM import is
  evaluated before the importing module's body and a port assigned after the import never applied.

### The card, the same evening — four things it did not do

No migration and no permission changed; one small route (the phone number, below).
`_nightshift/fix06/polish.mjs` (37) presses each one at 1280 in English and 390 in Arabic.

- **His number was text.** The commonest thing anybody does with a driver on the road is ring
  him, and the card printed digits to retype. It is a real `tel:` link and the shop's own
  WhatsApp composer (`WA.compose` over `WA.both` — a bilingual greeting and nothing else; what he
  is being written to ABOUT is typed by the person before anything leaves). Drawn for anybody who
  may see the card, not only for who may give tasks, and not at all for a safeer with no number.
- **His number could be typed once, when the account was made, and never again** — and the
  accounts `users:rebuild` makes carry none, so on this shop **both real safeers had no number and
  the two buttons above would never have appeared for them**. The card's "…" has **Phone number**:
  one field, `POST /api/safeers/:id/phone` (`safeer.write`, 404 for a login that is not a safeer,
  the one new route in fix 06) → `People.setPhone`. Kept as typed with the digits folded to ASCII
  (an Arabic keypad writes ٠٩٣٣), refused as `bad_phone` when it is not a number, and an empty box
  removes it. `users.phone` already existed, and `users` goes to the mirror whole by content hash,
  so there is no migration, no `change_log` row and no mirror file.
- **The week was never drawn.** `done.week` and `earned.week` have ridden on `GET /api/safeers`
  since the screen was written. The detail is two lines now — the work (this week · this month),
  then the pay (today · week · month) — because five figures joined with dots broke wherever the
  card's width happened to fall.
- **"Cash on him" was a dead end.** It is followed by a link to the board's **Cash back** tab
  (`Road.setTab('cash')` then `go('deliveries')`). **A door, not a second hand-in**: the money
  write stays in one place, with its own question and its own open-drawer rule. `canHandIn()`
  draws it only where the route would accept the press (`delivery.desk` or `debt.collect`, and
  the deliveries screen reachable).
- **No errands drew NOTHING on his phone**, which is indistinguishable from the block being
  broken. One quiet line, and it says new ones arrive by themselves, because they do.
- Found on the way: **`.link` had a rule only inside `.pic-line`**, so the owner's "Set the pay
  rate" on this card has always drawn as the browser's grey default button; and **an `<a>` wearing
  `.btn` kept its web-link underline** — Call and Map on the driver's phone too. Both are in the
  `FIX 06` block at the end of `og-skin.css`.

## Night shift 05 (22 Sep 2026) — the live fix shipped, one certificate, nginx run for real

Main got **only** the proxy fix from night shift 04's Phase 1 (b6e0940, cherry-picked from
bbfde0d), plus `OG_CERT_EXTRA_SANS` (2432253) and `_tools/` in `.gitignore` (3cf675f). Everything
else (the VPS's door, og-bridge, `/snapshot`, the write queue, the beat) stays on
**`night/online-offline`**, rebased onto this main and **not merged**. It merges after the owner's
outage drill (the end of `MORNING.md` on that branch).

- **`server/lib/proxy.js` decides who the visitor is.** A visitor header (`X-OG-Client-IP`) is
  believed **only from the socket `OG_PROXY_ADDR` names**. It is unset on the live `.env` tonight,
  so no header is believed from anyone, and a forged `X-Forwarded-For` is recorded as the socket
  (checked on the live server: `127.0.0.1`). **`OG_TRUST_PROXY` is retired**. It believed any
  caller's header, which let one attacker spread guesses across invented addresses. It was deleted
  from the live `.env`, and a startup notice names it if it comes back.
- **Sign-in is limited per ADDRESS too**: 20 failures in 15 minutes from one address answer 429,
  whatever usernames are tried (`server/lib/auth.js`). Before this, the only limit was per
  username, so one address could try every account. Checked on the live server from `127.0.0.2`
  with invented usernames: 20 × 401, then 429. **Those `ns05-probe-*` rows are in the live
  `login_attempts`**. They are harmless, and nobody signs in with those names.
- **`OG_CERT_EXTRA_SANS`** (`extraSans()` in `server/lib/net.js`): comma-separated IPs and DNS
  names, merged into what `net.js` finds, for `npm run cert` and for the `cert_address` startup
  notice. The live `.env` has `10.8.0.2,10.10.99.9`: the WireGuard end (go-live §2.2) and the shop
  Wi-Fi. That way the certificate is made **once**, with every name, whatever network the laptop is
  on the night it runs. Every certificate also carries the fixed DNS name **`og-till`**, which is the
  one nginx verifies (`X509_check_host` compares DNS names only; see `deploy/shop-proxy`).
- **The certificate made tonight** (valid to 24 Dec 2028) names DNS `localhost, DESKTOP-TG3H1NS,
  DESKTOP-TG3H1NS.local, og-till` and IP `127.0.0.1, 10.132.90.237 (ZeroTier), 172.20.10.2 (the
  phone hotspot it was on), 10.102.4.158 (PIA), 10.8.0.2, 10.10.99.9`. The three incidental
  addresses do no harm. The old certificate is in `server/data/certs.bak-ns05/` (gitignored). **It
  is a new key**, so every phone sees the "not a known authority" warning once more. The till
  itself prompts for administrator on the panel's first Start (`trust-cert --check` → the trust
  run), because `cert:trust` needs elevation and the night shift had none.
- **The one restart** was at **01:43 Damascus**, after every precondition held: inside 00:30–07:00,
  no sale, payment or stock write for 30 minutes, a verified backup
  (`og-2026-09-21T22-26-48-910.db`, integrity ok, `sales` and `variants` equal to live), and the
  sandbox suites green on main. All the checks passed and **rollback did not run**. The harness then
  crashed on its own last request (a stale keep-alive socket, ECONNRESET) before sending the
  graceful `{type:'stop'}`, so the server exited with its parent instead of shutting down cleanly.
  The database was checked afterwards: integrity ok, no broken foreign keys, WAL present and
  replayed on the next open. The shop was stopped before the night shift started and was left
  stopped; the panel's next Start runs this main.
- `supabase:check` was **red before the restart and exactly as red after** (`users` lacks `pw_box`
  and `last_login_at` in the mirror; eight mirrored accounts this database does not have). This is
  older than tonight and is not caused by it.
- **nginx was run, not linted** (the Windows build from nginx.org, signature checked, in
  `_tools/nginx/`; `tools/nginx-harness.mjs` on the branch). The first real `nginx -t` **failed**:
  `/api/live` repeated `proxy_buffering off`, which `to-till.conf` already sets, and nginx refuses a
  duplicate. The container would never have started. Fixed on the branch.

## The style rules

Written down in fix 05, after a pass that asked every screen every role can open, in both
languages, whether it kept them — and found eleven that did not. They are not opinions about
taste: each one is a rule the shop already lived by in most places, and the places that had
drifted are where the eye notices something is wrong without being able to say what.

**`_nightshift/fix05/p7-style.mjs` enforces them.** A rule nobody measures is a paragraph.

### Spacing — 8 · 12 · 16 · 24 · 32, and nothing between

One scale, in that order of preference. 8 between things that belong together (a button and the
button beside it), 12 inside a card, 16 between cards, 24 between a card and the next heading,
32 at the top of a section. A gap of 13 or 18 is not a decision anybody made; it is a number
somebody nudged until it looked right on the screen they had open.

### One lime primary per place a decision is made

`--brand` is the shop's one loud colour and it means *this is the thing to do here*. The rule is
**not** one per screen: night shift 02 settled that a board row draws one lime button for its own
next step (waiting → Assign → Send out → Delivered), and a screen of twelve parcels is twelve
separate decisions, each with one answer. So: **one lime primary in the page head, and at most
one inside any one card or row.** Two in the same place is two answers to one question.

Everything else is `.btn` (quiet) or `.btn-ghost` (quieter). A destructive action is
`.bk-danger`, behind a hairline, last — and `og-skin.css` has to restate that class, because its
own two-class `.btn` rule beats a one-class one.

### One card, one button set, one heading

- Every panel is `.card` and takes its radius, its border and its background from that one rule.
  A panel that invents its own will drift within a month.
- Every screen opens with one `<h1>` inside `.page-head`, 27px, on the same edge as every other
  screen's. The two exceptions are deliberate: the till is a full-bleed working surface where a
  heading would cost a row of the product grid, and the shelf map's header is the room's own
  controls.
- A job the person DOES is a tile (`.hm-job`), the same tile on the job home and on the money
  screen. A job is not sometimes a tile and sometimes a small button.

### Empty, loading, error — three states, one shape each

- **Empty** is `.cart-empty`: a bold line saying what is not there, a plain line saying why, and —
  where there is one — **the one action that fixes it, on the card**. "Add one below" pointing at a
  ghost button somebody has to go and find is not an empty state.
- **Loading** is a skeleton the shape of what is coming, not "…" and not a spinner in the middle
  of the page. A card of three dots that becomes four people, a filter bar and a table makes the
  whole screen jump. Say it in words too, for a screen reader (`.sr-only[role=status]`).
- **Error** is the server's own sentence, in the person's language, in the place that caused it —
  under the field for a refusal, on the card for a screen that could not load. Never a code.
- **A save with no line** says "Not saved — check the connection and try again" and **keeps what
  was typed**. Money is the one screen where re-typing an amount because the wifi blinked is
  unacceptable.
- **Toasts** are `ok` · `warn` · `err`, one line of what happened and one of detail, below the
  bar. A toast is never the only record of something that failed.

### Arabic

- **Zero letter-spacing, everywhere.** Latin letters stand apart and a little negative tracking
  tightens a headline; Arabic letters JOIN, and tracking pulls the joins open so a word comes
  apart into its letters. `og-skin.css` zeroes it under `body.rtl` for everything, with one
  exception — an explicit Latin run (`[dir="ltr"]`, `<bdi>`, `<code>`) keeps what it was given.
- **One face.** Montserrat has no Arabic glyphs at all, so every Arabic screen is really set in
  whatever comes next in the stack. There were two stacks — `body.rtl` named Tahoma and
  `--font-head` named system-ui — so on a machine with one and not the other, a heading and the
  paragraph under it were two different Arabic faces. `body.rtl` redefines `--font-head` and
  `--font-body` as well as its own `font-family`, which reaches the ten small rules across four
  stylesheets that ask for the token.
- **Cairo is NOT adopted, and that is a decision.** It is vendored at weight 700 only, for the
  thermal label where a thin fallback smudges (`assets/fonts/fonts.css` says so at length).
  Adopting it for the app would set every Arabic screen in one bold weight, with no woff2
  converter and no build step to make the others.
- **Every figure is its own bidi run.** A run of digits beside Arabic is reordered unless it is
  isolated: "1 USD = 130 SYP" is drawn "USD = 130 SYP 1". Use `<bdi dir="ltr">` in markup, or
  `unicode-bidi: isolate` in CSS for a slot written inline on thirty screens (`.stat .val`). Do
  **not** force `direction: ltr` — that left-aligns a figure inside a right-aligned card.
- **A sign goes INSIDE the isolate with its figure.** Two isolates side by side are reordered and
  "−$81.50" comes out "$81.50−".
- **No English sentence on an Arabic screen.** A product name, a username, a SKU and a currency
  code are DATA and stay as they are; a label, a button or a heading in English is a missing
  string. Every new string goes in `I18N.en` **and** `I18N.ar`, in Syrian Arabic — "مو" not "مش",
  "المزيد" for More.
- **No raw key on screen**, ever. `ns03/sweep` greps for the app's own key families on every
  screen in both languages.

### A thumb is 44px

On a phone, everything pressable is at least 44px tall with 8px between it and the next thing;
every field is at least 16px (under that an iPhone zooms the whole page in on focus and there is
no way back but a pinch) with the right `inputmode` and `enterkeyhint`; every dialog is a bottom
sheet with a grab handle, its own scroll and the confirm button above the keyboard; and nothing
comes to rest under the tab bar. See **Fix 05** for what enforces each of those.

## Known open work

- **A PRESS DURING ANOTHER SAVE'S RELOAD IS DROPPED IN SILENCE** (found 19 Sep 2026 by the first
  full pass with a browser per suite). `Shop.write()` allows one write at a time and holds the
  lock through the whole-shop `load()` that follows a save; it answers `false` when it did not
  start. **Only `Cashbook.submit` reads that answer.** The other 37 call sites — payables' wages,
  supplier and employee saves, `app-actions.js`, `money.js`, `receive.js`, the till — ignore it,
  so a Save pressed while the previous save is still reloading sends nothing, shows no spinner
  and no toast, and leaves the dialog open. `_nightshift/fix06/dropped-press.mjs` reproduces it
  on the wages dialog by holding the lock for two seconds. It is what made `ns03/p2-money` hang
  once in 38 suites: the supplier payment's reload was still running when the bonus was saved.
  Not fixed, because the cure is a decision: route every money save through `Cashbook.submit`,
  or make `Shop.write` itself toast "still saving — press again" when it refuses, or queue the
  second write. The third is wrong for a double-tap, which is what the lock exists for.
- **Left by fix 05, and all five are decisions rather than faults** (`docs/history/fix-05.md` §6).
  **Cairo for the app's own Arabic** — vendored at weight 700 only, so adopting it sets every
  Arabic screen in one bold weight; doing it properly needs 400/600/700 woff2, a converter and a
  build step this repo does not have, and it changes how the whole thing looks, so it is the
  owner's. **Two tabs saving one product** both answer 200 and the last one wins, silently;
  telling the first it was overwritten needs a row version, which is a schema change. **Whether
  `.fade-in` should say `backwards` app-wide** — fix 04's question 3, still open: a filling
  animation that ends in `transform: none` leaves an identity transform, which makes its element a
  containing block for anything `position: fixed` inside it, and it has now bitten the till and
  the order desk. **`out` → `waiting` for a parcel whose carrier was switched off** is still fix
  04's question 1. And **"one lime primary per card or row"** is the rule written into the style
  rules, which is not quite the "one per screen" the brief asked for — the board draws one per
  ROW on purpose (night shift 02), and enforcing one per screen would undo that.
- The supplier and payroll editors exist now (the Money screen, 055), and adding a colour or a size to an
  existing product has its dialog (night shift 01). Still no screen for cancelling a purchase order
  (`Shop.cancelPO`), kept on purpose, unwired, so the gap stays visible.
- **Left by night shift 02 — the first three are CLOSED by night shift 03.** The `variants.shelf`
  column is answered from `stock.shelf_id` now (`shelf_at`, on the catalogue's variants query);
  archiving a product is **Stop selling it**, a button of its own with a question and an undo in
  the toast; and the shipping price list is laid out to be filled in one sitting, with the order
  desk linking straight to it. **The list itself is still EMPTY on the shop's database** — that is
  data, not a screen, and nothing invents a price.
  Raising a purchase order is still one click longer than it was, because "Worth reordering" is
  under the warehouse's More fold — and since ns03 it also needs `cost.read`, because it is a list
  of unit costs and a supplier balance. And **marking a parcel failed is one click longer on
  purpose** — it sat the same size and colour as Delivered, and it is behind the row's "…".
- **A PARCEL ON THE ROAD WITH A REMOVED ACCOUNT ON IT CANNOT COME BACK** (fix 04). Removing an
  account returns its WAITING parcels to nobody (`lib/people.js`) and leaves one already `out`
  pointing at the hidden Former-staff record for ever. `out` can only become `delivered` or
  `failed`, `failed` is terminal, and a carrier change is refused past `waiting` — so the board's
  only honest offers are Delivered and "Couldn't deliver", and the parcel can never be given to
  a real safeer. The sandbox's INV-2121 is the case. **Unsticking it means adding `failed →
  waiting` to `NEXT` in `lib/deliveries.js`** — a new rule against that module's own stated
  invariant, and a decision about whether a revived parcel keeps its `closed_at` and the "could
  not be delivered" line already sent to the customer's tracking page. Question 1 in
  `docs/history/fix-04.md`.
- **Server routes with no button.** A sale can be voided only by a hand-sent
  `POST /api/sales/:id/void`; the staff-account routes (`POST /api/users`, `/api/users/:id/reset`,
  `/api/users/:id/active`) have no Settings control. The permissions `refund` and `partner.read` gate
  nothing, so their tick boxes in Settings → Roles change nothing. `receipt.show_qr` and
  `receipt.site_url` are seeded by migrations and read by nothing (the second QR `020` describes was
  never built).
- **An exchange return is not linked to the order that replaced it.** `order_returns.new_sale_id`
  stays NULL: the `linkExchange` helper was never called and was removed on 16 Sep 2026.
- **There are endpoints but no website.** `/api/ext/print-jobs` and `/api/ext/products` are both
  live behind `OG_WEB_API_KEY`; nothing calls either yet. The catalogue side is complete — the
  flag, the mirror column, the editor and the read door — so what is missing is the site itself,
  not anything here.
- **Telegram job messages carry no link.** `publicBase()` in `server/lib/telegram.js` reads
  `shop.public_url` only (the `OG_CF_HOSTNAME` fallback went with the tunnel on 16 Sep), and it is
  never set, so no link line is added. It is not the tracking base (`receipt.public_url`, the
  Railway address): these links open the POS itself (`/#open/job/<id>`), which Railway does not
  serve. Setting `shop.public_url` to a POS address that works brings them back.
- **The shop's bot on Railway is built but not switched on** — see "The shop's bot can be answered on
  Railway". The cutover (secrets, `sql/004`, Railway variables, `OG_TELEGRAM_OG_RELAY=railway`, the
  webhook) is a by-hand job, in the order written in og-track's `night_shift_2_log.md`.
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
- **Telegram now says what an order DID, but still not what it FAILED to do.** The nine `dl_*`
  kinds (052) are events: placed, paid, out, back, delivered, failed, cancelled, reviewed, cash in.
  What is still not a rule is the absence of one — a deposit that never turned into the rest, or a
  parcel a customer has not collected for a fortnight. Those belong in `reminders.js` with the
  other standing conditions, not in `office-alerts.js`, which only ever speaks when something
  happened.
- Bulk catalogue entry; an offline write queue. (The Yalla Wear portal now runs against real data —
  what remains is exposing the server to them: Tailscale or a tunnel, and `OG_ORIGINS` listing the
  address they use.)
- **The lira question is settled by the data**: `fx_rates` holds 1 USD = 130 SYP (set 2026-08-24) and
  every real sale was frozen at it — the shop is on the redenominated lira. The seed that assumed
  13,000 is gone, so nothing in the repo asserts the old scale any more.
- `flutter_app/` fails to build on an Android NDK/`sdkmanager` crash.
- **Shelf map, Arabic fullscreen: the "putting away onto…" line overlaps the scan box** in the bottom
  strip (`.sm-ov-bottom`, `.sm-scanbox` + `.sm-scanwhat`). Seen 14 Sep 2026 while building the room's
  Stage A; older than that work and deliberately left out of it.
- **The one-room script has not been run on the shop's database** (15 Sep 2026). `npm run
  warehouse:one-room` is written and verified on copies; the live `og.db` still holds the three test
  rooms. Migration 051 is already applied there (the server restarted at 18:58); **run
  `server/supabase/020_free_racks.sql` in the dashboard BEFORE the script**, or D reaches the mirror
  without its place. See **Stage B** under the shelf map.
- **The demo rows are gone** (`server/scripts/purge-demo.js`; the live database holds zero rows with
  `demo = 1`). `products.demo` and `customers.demo` remain as columns, `GET /api/ext/products` still
  filters on `demo = 0`, and nothing sets either any more.
- **Customers, still open**: the printed loyalty card (held on the ruler test — the app believes a
  sticker is 30 × 30 mm and `labels60.js` was built for 60 × 40), a lint for the cap family, merge
  with no undo, a one-currency credit limit, a wants tab with no "arrived" filter. The full list
  with reasons is `docs/customers.md` → "Still open".
- **Web Push dies when the shop moves laptops.** The VAPID pair lives in `push_keys`, which is per
  laptop and deliberately not mirrored (migration 048), and so is `push_subscriptions`. The laptop
  that takes the baton mints a new pair, publishes its public half to config `push.public_key`, and
  holds no subscriptions at all — so every customer's Notify me stops
  delivering, silently. og-track's inbox does not bring them back: follows the old laptop already
  applied are marked done in the inbox and are never collected again. A customer's browser
  recovers only when somebody opens the page and taps Notify me again (the page sees the key has
  changed and subscribes afresh). The fix
  is not decided — carrying the private half across sealed the way `credvault.js` seals the
  passwords, or re-applying recent inbox follows when a laptop claims a new lineage.
  **The office is no longer part of this problem**: its alerts are Telegram since 052, and a linked
  chat lives in `config`, which is mirrored whole — so the phones survive the laptop baton for free.
- **NOBODY HEARS AN ORDER ALERT YET, and the shop has to press two buttons for that to change**
  (16 Sep 2026). The office's alerts are Telegram now (**The office hears an order move**, below),
  and the gate is real: a private chat hears one only while the account behind it can work the
  delivery office. The shop's ONE linked chat is private with **no `person` recorded** — it was
  linked before chat owners existed — so it hears none of them, and every `dl_*` row is currently
  marked sent with `no chat on this side is subscribed to …` written into it. That is the guard
  working, not a fault. The fix is either: the owner signs in, opens **My Telegram** in the account
  menu, presses Connect and sends the code from that same chat (which records him as its owner and
  puts it on the manager preset), or somebody ticks the order alerts for it by hand in
  Settings → Telegram → Choose. Settings names the chat and the reason on its face so this is not
  discovered by silence.
- **Staff Web Push is gone, and that question is settled** (16 Sep 2026). It could not survive
  Phase C: a browser registers a service worker only on an origin it TRUSTS, and a self-signed
  certificate somebody pressed "continue" on is enough to open the page but not to register the
  worker — so on a LAN-only shop the office bell could only ever have worked on the till, where it
  adds nothing. The office's alerts moved to the shop's Telegram bot, which is outbound-only, needs
  no certificate and no inbound port, and survives somebody replacing a phone. **The CUSTOMER's
  push is untouched** and still carries that limit: `/i/<token>` must be opened on an origin the
  browser trusts, which today means the public address rather than the Wi-Fi IP, and on an iPhone
  the page added to the Home Screen. Delivery still needs outbound internet from this laptop to the
  push services.

## Customers

`server/lib/customers.js` (`list`, `byId`, `historyFor`, `create`, `update`, `merge`, `archive`,
`adjustPoints`), `server/lib/text.js` (`normPhone`, `foldName`), `server/lib/loyalty.js`,
`server/lib/wants.js`, `server/lib/capped.js`; the screen, the profile and the drawer are
`js/app-customers-scan.js`; migrations `028` to `034`. Built in stages over 31 Aug – 3 Sep 2026 —
**`docs/customers.md` is the record**: the owner's decisions, what each stage built, how it was proved,
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
  carry a "keep in step" comment and a nineteen-row parity table in `docs/customers.md`. `custSearch()`
  is the one "which customer does this text mean" rule; the attach, merge and job-link pickers all
  use it. It had been written three times before it was one.
- **The grid caps at 60 cards** (`CUST_RENDER_CAP`), and `customerRowsShown()` is what **both** the
  grid and `Bulk.visibleIds('customers')` read. They are a pair: the day they disagreed, one tick
  box put 5,000 invisible customers a click from Archive. Every capped reader in the system returns
  `{ rows, shown, total, capped }` from `server/lib/capped.js` with `capped = total > shown` (never
  `shown === limit` — a table of exactly 200 rows is not truncated), and the screen says so through
  `cappedNote` / `cappedCount`. A number derived from a truncated set is the mistake this codebase
  has made most often; the sweep that closed seven of them is in `docs/customers.md`.
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
  `docs/customers.md`.
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
  reached the shop (`POST /api/driver-cash/handin`, `Orders.handInFor`).
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
  `docs/customers.md` is the test, and `js/whatsapp.js` no longer keeps a third copy.

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
- An exchange grants the credit, and the customer spends it on the order that replaces it; there is
  one way money moves between two orders and one ledger to read. The return itself is not linked to
  that order (`new_sale_id` stays NULL — see Known open work).
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
  `.dk-bar` carries it. That bar used to switch on only under 860px. (Both rules went with the
  three-column layout; the five-step panel's sticky foot carries Save now — see "The look".)
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
  `dir` and `lang` belong on `<html>`; the page had no script then, and still works without one
  — see **The tracking page is live** below). It grew a
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

### The look (12 Sep 2026, later the same day)

The owner asked for the delivery screens to be "something cool" for the admin and the office, and
chose, from four questions: premium-but-alive over a louder control room, **lanes + live tiles**
for the board, **a rail + a receipt ticket** for the office (replaced the same evening by five steps — see
below), and all four places (office, board,
driver's phone, the dialogs). No new features and no money logic moved; what changed on the server
is two read-only additions below.

- **The four tiles are `Deliveries.summary()`, never the list.** To take out · On the road · Still
  owed · Cash with drivers ride on `GET /api/deliveries` as `summary` (not for a driver), computed
  for the whole shop. The list under them is filtered and capped; tiles derived from it would change
  with the search box. Owed uses the board's own `owes` arithmetic; cash uses **exactly
  `Orders.driverCash`'s WHERE**, so the tile and the Cash back tab count the same notes. Money is a
  pair per currency, drawn stacked, never added. A status tile narrows the parcels, "Still owed"
  sets the money filter, the cash tile switches to the Cash back tab; a lit tile pressed again
  resets.
- **`status=today&since=<browser midnight>`** is what the lanes and the driver's phone ask for:
  everything open, plus what closed since the reader's own midnight (the server is UTC; the day is
  the browser's, as on the dashboard). That is what fills the third lane and the driver's "Done
  today". The table's "Open" still means open. An old server ignores the unknown status and
  returns everything — degraded, not broken.
- **Lanes or List is per machine** (`og.dl.layout`). The filters became one row of three selects
  and a search (they were 516px of chips on a phone). The table keeps its six columns — the phone
  card rules address them by position.
- **One rail, one face, one icon.** `Desk.rail(d, labels)` is the browser twin of the tracking
  page's rail in `server/lib/receipt.js` — same four steps, same on/now rule, green not lime,
  `.is-back` red — and the board cards, the table, the order dialog and the saved card all draw it.
  `Desk.face(id, name)` (personFace/personTint) and `Desk.methodIcon(m)` are shared by the board,
  the handover sheet and the cash cards. **Change the rail's rule in both places or neither.**
- **The office is five steps in one centred panel** (`stageHtml()` in `js/desk.js`), asked for the
  same evening after seeing the three-column version: Bag → Customer → Travels by → Address →
  Payment, a rail over it, Back · running total · Next under it, and the saved card in its place
  after Save. `S.step` and `S.maxStep` live in the draft, so a refresh returns to the step it was on
  (clamped back by `canReach()` if a product or customer has gone since).
  - **A scan never moves the step** — orders are often several pairs, and the owner chose "stay on
    the bag until Next". Enter on the empty scan box is Next; a scan while another step is on screen
    still lands in the bag and says so in a toast.
  - **What stops a step is `stepReason(i)`**: reasons()'s own refusals filed under the step they
    belong to, the last step taking whatever reasons() still has — so Next and Save can never
    disagree. The rail's buttons are disabled unless `canReach()`; a pickup has no address step and
    `goStep()` skips it in both directions.
  - **`paint(part)` repaints the body only when that part's step is on screen** (`PART_STEP`), and
    the rail and foot always. The CHANGES handlers still call `paint('sum')` on every keystroke;
    without the filter, typing an address would rebuild the textarea under the caret.
  - The last step **reads the order back** (`.dk-rv`, each row a button to its step) above the
    ticket. **The stamp** (`stampKind`) thumps only when its answer changes (`lastStamp`); **the
    saved card** animates once per order (`celebrated`), because recording the rest of a deposit
    repaints it.
- **The scan box is also a product picker** (`pick`, `dropHtml()`, `paintDrop()` in `js/desk.js`).
  A click, a keystroke or ↓ opens a list under the box — **never focus**, because the box is
  refocused after every line lands and a list springing open each time would bury the bag. An empty
  box lists what is in stock at the packed-from place, most first (everything, saying so, when
  nothing is); typing narrows on name, brand, colourway, size, SKU, barcode and label code, every
  word having to match, and a word that is a size lights that size ("samba 43"). Sizes are the
  options: ↑ ↓ walk them, Enter or a click adds, Esc closes and a second Esc empties the box, a
  mousedown outside closes. A code typed in full + Enter is still a scan; the gun goes through
  `scanned()` and `addVariant()` closes the list whatever added the line. The list is capped at
  `PICK_MAX` (30) **and the head says so**. Only `#dkDrop` repaints while typing, never the input.
  **The ▾ is `dk-browse`, never `dk-drop`** — `dk-drop` is the ✕ on a bag line, and `ACTIONS` is one
  object: the picker's handler was added under the same key, replaced the remove button, and every ✕
  opened the product list instead. The same trap as a global function name — **grep for a
  `data-act` name before adding one.**
- **The customer box is the same control** (`cpick`, `custDropHtml()`, `paintCust()`), and its
  search is **`custSearch()` and nothing else** — the one "which customer does this text mean" rule
  the attach, merge and job-link pickers share, so archived and merged-away people are never offered
  and a phone matches in any spelling. An empty box lists most recent buyers first; each row carries
  the face, phone · city, "last bought", and an amber *owes* when `debtSyp`/`debtUsd` > 0 (null for
  an account that may not see debt, so the tag never lies). **+ New customer stays beside the box**,
  and nothing matching also offers "Add '…' as a new customer" with what was typed prefilled.
  **Change reopens the list** — it means "somebody else". The box is rebuilt with its step, so it is
  listened to at the document (`click`/`keydown` on `#dkCust`) rather than wired per element; both
  lists share `lightOpt()` for the lit row and one outside-mousedown listener closes either.
- **The Delivery section of Settings was never on the page.** `Desk.settingsCards()` — payment
  methods, transport offices and couriers, the shipping price list, where customers send the money —
  was written with the office and exported, and nothing in `viewSettings()` called it, so every
  "add one in Settings" hint sent the shop to a page with no such list. It is drawn after Warehouse
  now (it brings its own heading, gates itself on `config.write`, and on a first visit fetches the
  office's settings and redraws). Every such hint — the office's travel step, the Assign dialog, the
  handover picker — is `dk-goto-companies`, which opens that fold and scrolls to it **after** the
  page has settled (navigating resets the view's scroll once the screen is in, so a first-frame
  scroll was undone). A save redraws Settings through `renderKeepScroll()` rather than jumping to
  the top; a nameless row is refused in words before the request; number boxes carry `dir="ltr"`.
  **The board and the handover picker now prefer `Desk.companies()` once `Desk.companiesLoaded()`**,
  because that is the copy a Settings save updates — a courier added a minute ago was otherwise
  missing from their own earlier fetch.
- **"It did not print" was a save the server refused.** The office let a size with none at the
  packed-from place reach Save (the picker dims it, the line said "only 0 here" in amber), and
  `Orders.create` refused the whole order with `insufficient_stock` — so nothing was saved and
  there was nothing to print. Now `shortLines()` is one of `reasons()`'s refusals and stops the bag
  step: a red `.dk-shortbar` names what is short, each line says where there is some
  (`bestElsewhere`), and **Pack from … instead** appears only when one place covers the WHOLE bag
  (`coveringPlace` — an order is packed from one place). **Refresh stock** reloads a stale count.
  The browser's count can still be behind another till, so the Save refusal is handled too: the
  person is told in their language that the order was NOT saved and nothing printed, the stock is
  reloaded, and they are put back on the bag step. Printing itself was never broken — "Both" sends
  the slip to the receipt printer (`Receipt.printSale`, no dialog) and opens the A4 invoice with its
  Print button, which is what verified on a scratch copy whose printer share is deliberately
  `\\127.0.0.1\NOWHERE` (so the slip reports "could not reach" there, and nowhere else).
- **The foot is sticky with a NEGATIVE offset** — `bottom: -84px` on a desk, `-20px` on a phone.
  `.view` is the scroller, and a sticky element sticks inside its scroller's PADDING (96px on a desk,
  the tab bar + 28px on a phone): with `bottom: 0` the bar floated 96px up the screen with the step
  showing again beneath it. **Change `.view`'s bottom padding and these must move with it.** A
  page-coloured `::after` skirt fills the few pixels under a stuck foot. The step transition fills
  `backwards`, not `both` — a filling transform left `matrix(1,0,0,1,0,0)` on the body, which is a
  stacking context and a containing block for anything fixed inside it.
- **Motion is feedback, never idle**: a scan sweeps its row, a beeped slip flashes on the sheet
  (`justAdded`, cleared on a timer so an unrelated repaint does not replay it), the stamp lands, the
  tick draws. The only things that move by themselves are the "on the road" dot and the scanner
  beam on an empty bag. The lane cards deliberately have **no entry animation**: the board repaints
  on every live push and every action, and a board that re-animates is a board that flickers.
- **Two bugs found while testing, both older than the look.** *Take a payment* on the board read
  `boot.currencies` from the office's bootstrap, which is only fetched when the office screen has
  been opened — so after a fresh sign-in it died with a TypeError in a toast. `ensureBoot()` fetches
  it on demand. The **Assign** dialog had the same trap for companies ("No companies yet" with one
  configured) and now keeps its own copy, as the handover picker already did. The driver's stat
  cards that summed dollars into a lira figure were replaced by the day card, which counts his own
  rows and keeps money per currency.
- **Phone:** the tab icons hide under 720px (three tabs with counts were 394px of a 358px row), the
  refresh button is not stretched by the head's share-the-width rule, and the tab row has
  `overflow-y: hidden` — its tabs' −1px underline margin made it 1px taller than itself, which drew
  a vertical scrollbar as a thin lime bar at the end of the row.
- **Verified** on a scratch copy with real orders made through the API (7 orders, a signed sheet
  with one delivered for cash and one failed, an open sheet): every section at 1366×768, 390×844 and
  in Arabic, sideways scroll measured, every dialog's primary button hit-tested, zero runtime errors.
  **A hash-only navigation does not reload the page** — a harness that signs in as a second account
  and navigates to the same URL with a different `#` is still looking at the first account's
  screen; add a changing query string.

### The tracking page is live, branded, and can buzz a phone (13 Sep 2026)

`server/lib/receipt.js` (lookups, `events()`, `pushText()`, `render()`), `track-page-css.js`,
`track-page-client.js`, `track-page-words.js`, `server/lib/tracking.js`, `server/lib/webpush.js`,
migration `048_push.sql`. The owner asked for `/i/<token>` to be "more branded, real time, and send a
notification to the mobile and laptop", and chose: **Web Push that arrives with the page closed**,
**to the customer AND the shop's staff**, **always dark**. (The STAFF half moved to Telegram on
16 Sep 2026 — see **The office hears an order move**. Everything below about the CUSTOMER's push
still stands, unchanged.)

- **The page is no longer script-free, and still works without one.** Everything a customer needs
  is in the server's HTML; the one inline script ADDS the live refresh, relative times and Notify
  me. Every place that said "no JavaScript by design" meant a page with nothing that moves. The
  look, the script and the two-language words are three modules so the renderer stays readable —
  and the words are shared with the notifications, so a phone is told the page's own sentence.
- **Live = a data-less nudge + a refetch of the same public page.** `GET /i/<token>/live` is a
  SEPARATE set in `lib/live.js` (`subscribeTrack`/`notifyTrack`), never counted in `presence()` —
  a customer watching a parcel is not "online" on the shop's side. Capped at 12 per order and 600
  in all; past the cap, or with no EventSource, the page polls every 45 s. The script swaps the
  `[data-live]` regions by id and **reloads when the set of regions changes** (a cancelled order
  loses its money card). There is deliberately no JSON feed: this HTML is the one shape of the data
  a stranger may see.
- **What counts as news is a KEY, not a route.** `events(sale)` gives every public event a stable
  key (`placed`, `pay:<id>`, `out:<out_at>`, `ret:<id>`, `closed:<status>:<closed_at>`, `void`);
  `push_seen` holds the keys already announced per order. Routes just call
  `Tracking.moved(saleIds, actorId)` after committing — create, payment, hand-in, handover, return,
  PATCH delivery, void — and a change the customer cannot see (cash handed in) says nothing, two
  routes on one order say it once, a restart repeats nothing. An order with no `push_seen` row
  treats only events from the last 3 minutes as news, so old orders are not re-announced.
- **THE OFFICE'S HALF OF THIS IS GONE — it is Telegram now** (052; see **The office hears an order
  move** below). What survived the move is the shape: `Tracking.moved(saleIds, actorId)` still
  carries the actor, and that actor is what `partner_events.skip_users` is set from, so "never tell
  somebody about the button they just pressed" still holds. Removed with the bell: the Deliveries
  board's `dl-push` button and its `.dlb-push` rules, `POST /api/push/state|subscribe|unsubscribe`,
  `followShop`/`unfollowShop`/`shopState`, the staff wording in `receipt.js`, and the app `sw.js`'s
  two push handlers. `push_subscriptions` now holds customers only.
- **`webpush.js` is RFC 8291 + VAPID on `node:crypto`, no package.** The endpoint is a URL a
  stranger's browser sends, so **only the vendors' push hosts are ever called** (FCM, Mozilla,
  WNS, Apple), https on 443. The VAPID key pair lives in `push_keys` — not `config` (handed to every
  login), not `.env`. Only the PUBLIC half is also written to config `push.public_key`
  (`Push.publishKey()` at boot), for og-track; see **og-track's inbox** below. `push_subscriptions` and `push_seen` are **not mirrored**, for
  `partner_events`' reason; `drift.js` checks only its PUSHED list, so it stays green. A 404/410 from
  a vendor deletes every row on that endpoint; eight other failures in a row delete the one row.
- **A SCRATCH COPY MUST NOT PUSH.** A copy of `og.db` carries real customers' subscriptions — the
  Telegram-token trap again. Set `OG_PUSH=0`, or `OG_PUSH_TEST_HOST=127.0.0.1:9311`, which allows
  that one plain-http receiver and **refuses every real push service**. That is how it was tested:
  a local receiver that verifies the ES256 signature against `k=` and decrypts the body.
- **iPhones get push only from a page added to the Home Screen** (Apple's rule), so each order
  page links `/i/<token>/manifest.webmanifest` (scope `/i/`, start_url that order) and the card
  says how, instead of a button that cannot work. The page's worker is `/i/sw.js`, served from
  `Tracking.WORKER` with `Service-Worker-Allowed: /i/`, and since 052 it is the **only** push
  worker there is: the app's `sw.js` carried the same two handlers for the office's bell and lost
  them when that moved to Telegram. Push also needs a secure page: the public
  `https://shop.ogsports1.com/i/…` link works, the Wi-Fi IP does not, and both screens say so.
- **The Home Screen guide.** The owner asked for install steps in the notifications card and for
  iPhone notifications "from the top". The second is Apple's own banner, which exists only for a
  Home Screen page, so the first is the way to it. The card SHOWS what installing buys — a drawn
  phone with this shop's notification dropping in from the top — then the three taps, and **Show me
  how** opens a three-slide sheet with the phone drawn at each tap (Share lit on Safari's bar, "Add
  to Home Screen" lit in the share sheet, the mark on a Home Screen as a notification lands). All
  CSS: no screenshot of Apple's interface, which changes every September.
  - **The user agent chooses WORDS only**: Safari (the bar at the bottom, or inside ••• on newer
    iPhones), iPad (the top), Chrome/Edge on iOS (the address bar), Firefox/Opera (the menu). An app's
    own browser — Instagram, Facebook, TikTok, Google (`inapp`) — cannot add to the Home Screen at
    all and is told to open Safari, with Copy link. iOS below 16.4 (`old`) is told to update rather
    than walked through something that cannot work. What the page can DO is still asked of the
    browser (`supported()`).
  - **Opened from the Home Screen with permission not yet asked, the card is `ready`** — "added, one
    tap left" with a pulsing Notify me, because iOS only asks for permission from a tap.
  - **Chrome's own `beforeinstallprompt` becomes "Install as an app"** under Notify me.
  - **With notifications on in a Home Screen iPhone, the page's banner stands down for live
    updates** (`nativeTop`): iOS drops its own banner for the same news, and two stacked is noise.
  - **`.sheet` is `touch-action: pan-y`.** A sideways swipe turns the sheet (towards the reading
    direction); left to the browser it was taken as Back, and the order page went with it — found
    by the harness, not by reading.
  - Verified with emulated user agents in `guide.mjs` (PushManager deleted, as an iPhone Safari tab
    has none). An emulated iPhone is not an iPhone: the real banner has only been seen through the
    local push receiver, never on Apple's service.
- **"WhatsApp: tracking link"** (`waTrack` / `kind: 'track'` in `js/desk.js`, `Desk.sendTrack`) is
  the third order message beside confirm and how-to-pay: the link, where the order is right now,
  what is left to pay, and a pointer to Notify me — in both languages (below). It is on the saved card, the order dialog
  and **every order card on the Deliveries board** (`dl-wa-track`, which fetches the order and the
  bootstrap because the board has neither). Unlike the money messages it opens with an empty number
  box when the order has none, and it refuses with words when the shop has no public address
  (`publicBase()` null), because a link only the shop's wifi can open is not worth sending.
  **Since 16 Sep 2026 the base is og-track on Railway**: `receipt.public_url` =
  `https://og-track-production-aa0b.up.railway.app` (it had been empty, so `publicBase()` fell through
  to `OG_CF_HOSTNAME`, dead since 13 Sep and removed on 16 Sep). Set through the same `configRefusal()` + upsert
  `PUT /api/config` runs; the paper receipt itself prints a barcode, not a tracking QR.
  `WA.compose`'s message box is `dir="auto"` now — it was forced rtl and turned "Hi Nour," into
  ",Hi Nour". Verified by `wa.mjs` in both languages: the button on the cards, the composer's
  text, the link opening the page, and the `wa.me` URL (window.open caught).
- **EVERY WhatsApp message is both languages — the owner's standing rule ("in all things").**
  `WA.both(arLines, enLines)` in `js/whatsapp.js` is the one shape: the Arabic block, a `━━━` rule,
  then the English block, whichever language the screen is in, and it starts any Arabic line that
  begins with a Latin letter with U+200F by itself. Its users: the three order messages (`waBoth()`
  in `js/desk.js` delegates to it), the win-back and back-in-stock templates, the end-of-day
  summary, the purchase order to a supplier (`po-whatsapp`), the print order to Yalla Wear
  (`or-wa`), the debt reminder (`money.js`) and the bulk customer message (`bulk.js`). That box
  starts bilingual with `{name}`, and each customer's Send reads the box AS IT STANDS — every row
  used to carry its own fixed Arabic sentence in its link, so what was typed was never what was
  sent. `WA.cash` / `WA.lira` / `WA.day` / `WA.hi` write money, dates and the greeting in each
  half's own words. **A new WhatsApp message goes through `WA.both`, never one language**;
  `waall.mjs` checks every one (two halves, one rule, bold closed, no left-to-right Arabic line).
  For the order messages the customer reads their half and nobody chooses before Send. It
  replaces "no emoji, no Markdown", which was Telegram's rule copied across (Telegram's parse mode is
  why it exists; WhatsApp has none): `*bold*` headings and the figures a customer acts on, one emoji
  per heading, Western digits. The Arabic half links the Arabic page and the English half `?lang=en`.
  An Arabic line that would begin with a Latin letter (a product name, a city typed in English)
  starts with U+200F, or WhatsApp left-aligns it. The method is worded for a sentence (`WA_VIA` —
  "via our own driver", or the company's name), not the office's button caption ("via Our driver").
  The composer is `unicode-bidi: plaintext`, each line taking its own direction as WhatsApp draws it.
  **`openOrder()` fetches the office bootstrap first**: the dialog's tracking button and every
  message's link read `boot.publicBase`, and a dialog opened from the board straight after sign-in
  (office screen never visited) had no tracking button and a confirmation with no link.
- **Heard, not only seen.** A web page cannot choose a notification's sound — the phone plays its
  own — so pushes are `silent: false` with a `vibrate` pattern, and an arrival that asks for a
  review is `requireInteraction`. On the OPEN page an update drops a banner from the top
  (`#tpBanner`) with a two-note WebAudio chime, a sound button beside LIVE (`og.track.sound`,
  per device), and a buzz only after the person has touched the page (Chrome logs every refused
  vibrate). A browser plays no audio before a first tap, so the chime is unlocked by one. **The
  page's worker skips the system notification when that very order is open and focused** — the
  page's banner is the same news — except on Safari, which withdraws push from a site that
  receives one without showing anything; the "notifications are on" proof carries `always`.
- **When several events land at once, the biggest news leads** (`weight()` in
  `tracking.announce`): arrival or cancellation, then out, return, payment. A driver marking a
  parcel delivered with the cash writes the payment a moment AFTER the arrival, and "Payment
  received · +1 more" was what the phone said — with the review request, which hangs off the
  arrival, never sent.

### Delivery reviews (13 Sep 2026)

`server/lib/reviews.js`, migration `049_order_reviews.sql`, mirror file
`server/supabase/019_order_reviews.sql`, `js/reviews.js` (the Reviews page, its own menu entry).
The owner chose: stars + quick tags + a comment; its own page; a review reaches the website only
when **the customer allowed it AND the shop switched it on**; and the arrival asks for it.

- **The form appears on the tracking page once the order is DELIVERED**, right under the status
  on a phone. `POST /i/<token>/review` — the sale is the token's, one row per order, editable by
  whoever holds the link. Six tags (`TAGS`/`TAG_WORDS` on the server, `rv_tag_*` in the app —
  keep the ids in step), 600 characters, a permission tick naming the website. The card is
  `data-keep`, not `data-live`: the live refresh swaps live cards and must not wipe a half-typed
  comment, and `regionIds()` counts kept cards so one appearing (the parcel just arrived) reloads.
- **The arrival asks.** The customer's "Delivered" push gets "· Rate your delivery", a **Rate it**
  action whose `links.rate` opens `#review`, and stays until tapped — only while no review exists.
- **Two switches.** `allow_web` is the customer's, `on_web` the shop's (`PATCH /api/reviews/:id`,
  `config.write`, refused `no_permission` without the customer's). **Changing the stars, tags or
  words takes it off the website** — the shop approved what it read. `show_name` is frozen as
  first name + initial.
- **`GET /api/ext/reviews`** (the website's bearer key) returns only both-switches-on, non-voided
  reviews: an opaque id (never the invoice number), stars, tags in both languages, words, name,
  city, date, plus the count and average. Ready for the e-commerce site.
- **The Reviews page** (`#reviews`, gated `delivery.desk` — a driver holds `delivery.read` and has
  no business reading every customer's words): the shop's average (the lime number), the 1–5
  spread as bars that filter, what they liked, the share of delivered orders reviewed, then a card
  per review with its order (opens it), carrier, words and the website switch or the lock line.
  The summary is the whole shop's, never the filtered list's. Search repaints `#rvwList` only, so
  the caret stays. The office hears each review on the shop's Telegram bot (`dl_review`): the stars, whether it is
  new or changed, and the words — and **never the customer's name**, because a chat is a room whose
  membership nobody in this system controls (052).
- **Mirrored**, cursor shape like `job_reviews`: `order_reviews` sits in the ROAD guarded block,
  `CURSOR_TABLES`, `restore.js ORDER`, `drift.js PUSHED`, reconcile `TABLES` (key `sale_id`) and the
  sale-purge list, and `019` is appended to `CATCH-UP.sql`. **Run `019` in the Supabase dashboard,
  then reconcile** — until then the sync skips it by name and the boot pull refuses with `drift`,
  which is the guard working.

- **Verified** on a scratch copy: `pushcrypto` (25 — endpoints, encryption, JWT, 410, off switch),
  `trackflow` (41 — page, worker, manifest, live stream, follow, the staff bell **as it was then**,
  who is told what) and
  `trackui` (the look at 390/820/1366 in both languages, the Live pill, a payment taken elsewhere
  landing on the open page without a reload, Notify me on and off).

### The office hears an order move — on Telegram, not on a bell (16 Sep 2026)

`server/lib/office-alerts.js`, migration `052_office_alerts.sql`, the `office` group in
`server/lib/telegram.js`, the Order alerts section of the Telegram fold (`tgoHtml` in `js/yalla.js`).
**The staff half of Web Push (048) is gone**; the customer's half is untouched.

It could not survive the shop going LAN-only. A browser registers a service worker only on an origin
it TRUSTS, and a self-signed certificate somebody pressed "continue" on opens the page but does not
earn a worker — so the Deliveries board's bell could only ever have worked on the till itself, where
it adds nothing. It was already silent: the one staff subscription belonged to an account disabled on
13 Sep, and both staff paths skip an inactive account without a word. Telegram is outbound-only, needs
no certificate and no inbound port, survives a replaced phone, and **the shop's bot is already
running** — so this adds no listener on either token. It writes rows; the `drain()` that has always
sent them sends these too.

- **NINE KINDS, one `dl_` group**: `dl_new` `dl_paid` `dl_out` `dl_back` `dl_delivered` `dl_failed`
  `dl_cancelled` `dl_review` `dl_handin`. The `dl_` prefix is not decoration — the print partner
  already owns `order_new` and `review`, and one name for two things is how a warehouse phone starts
  hearing another company's invoices.
- **WHAT IS NEWS IS STILL DECIDED IN ONE PLACE.** `tracking.js` reads the customer's own event list
  (`Receipt.events`) against `push_seen` and hands what is new to `Office.orderMoved()` — so the
  office and the customer's phone can never disagree, and a restart repeats nothing. It is called
  **before** the subscriptions query, because `announce()` returns early on an order nobody follows,
  which is most of them, and the office's news used to sit behind that return.
- **NO CUSTOMER NAME, EVER.** Order number, what happened, how it travels, what is still owed. A
  staff group is wider than `customer.read`, and a phone on a counter is readable by whoever picks
  it up — the same rule `PARTNER_STRIP` follows one door along.
- **THE HARD GATE IS `officeWants()`, and it is a real gate.** Every other kind's permission note is
  advisory; these are enforced. A chat with a PERSON hears an order alert only while that account
  can work the delivery office (`Auth.can` — false for a disabled account too), whatever is ticked.
  A chat with NO person — a group, or a phone linked before owners were recorded — hears them only
  if somebody ticked them **by hand**: never by default (`DEFAULT_RULES` excludes the group), never
  by the newer-kind upgrade rule. **Today that means the shop's one linked chat hears nothing**, and
  the Settings section says so with the fix; see Known open work.
- **SKIP-YOURSELF is a column, not an argument.** `partner_events.skip_users` is a JSON array of the
  ids whose own buttons made the news; `drain()` drops a chat whose `person` is in it, and a row
  with nobody left is marked **sent with the reason**, never retried. It is a column because
  `args.actor` is printed as the message's signature — routing is not part of the message, the call
  `to_user` (042) already made. Refused for the partner audience, and refused unless every id is an
  integer: SQLite would store `'lubna'` in an INTEGER column without complaint and the row would
  reach nobody. **A group has no owner**, so somebody acting from a room still sees their own action
  there — that is the room's business, not the system's.
- **ONE ACTOR SIGNS THE MESSAGE, several sign nothing.** `userId` is passed only when the batch had
  exactly one actor, so a message ends "— Lubna" or ends plainly, and never names one of three.
- **THE SHOP IS SHUT FROM 23:00 TO 13:00** (`alerts.quiet_from` / `alerts.quiet_to`, on
  `shop.tz_minutes`), and only `alerts.urgent` — a cancelled order, because it may be packed and
  about to leave — goes out in the night. An event fires once and cannot be re-evaluated the way a
  reminder can, so a held alert is queued with `next_try_at` set to the next 13:00 shop time;
  `drain()` already waits for that and does not count it as an attempt. Kept apart from
  `reminders.quiet_*` (00–08), or the 21:00 day close would never go out.
- **OVERNIGHT, ONE ROW PER ORDER.** A held alert overtaken by a bigger one about the same order is
  marked `superseded overnight`, and a weaker one arriving after a stronger is dropped — so 13:00
  brings "delivered", not "out" and then "delivered". An urgent alert is never held, so it can
  never be superseded.
- **THE ROW IS WRITTEN EVEN WHEN NOBODY IS SUBSCRIBED**, which is the opposite of a reminder. A
  reminder asks `canReach()` first because its row IS the ledger that the thing was said; an order
  alert is news whose key can never recur, so the row is queued and `drain()` marks it sent with
  `no chat on this side is subscribed to dl_out` written into it. `Telegram.canQueue(side)` — a bot
  AND a linked chat — is still asked, because `drain()` skips a row for a side with neither without
  bumping it, and it would sit in the card's queue for ever.
- **`dl_*` are excluded from `linkFor()`**: it builds a link from the public tunnel hostname, which
  dies with Phase C, and a link that opens nothing is worse than none. `/mute` still silences the
  reminders only — these are news.
- **Money is the currency's own decimals** (`minor_exp`), so a dollar order says `17.31 USD` and a
  lira one `450,000 SYP`, never rounded and never added together.
- **MY TELEGRAM IS IN THE ACCOUNT MENU, for every account.** Linking is self-service like the
  password (`POST /api/telegram/link` is deliberately ungated, and a chat answers a command only as
  far as its account may); the card used to live on a manager-only screen, so a cashier could not
  press Connect at all. Choosing what a chat receives stays `config.write`.
- **Settings → Telegram → Order alerts** is the other half: every linked chat with what it gets or
  why it gets none and the fix, a roles × kinds grid writing `reminders.preset.<role>`, the "any
  hour" column writing `alerts.urgent`, and the shop's two hours. The grid stores **everything
  ticked as `null`**, the picker's own rule — an explicit list of today's kinds would silently
  exclude next month's.
- **The picker and the summary had to learn about the gate.** A chat on "everything" can still
  receive no order alert, so both read the office kinds from what the server says the chat
  ACTUALLY gets (`office.gets`) rather than from its stored rules. Nine ticks against nine messages
  that never arrive is exactly the lie this section exists to stop.
- `partner_events` stays **local-only**: no `server/supabase/` file, no `mirror-lag.js` entry,
  `supabase:drift` stays green. The migration also deletes `push_subscriptions WHERE audience =
  'staff'` and leaves the CHECK constraint alone — rebuilding a table real customers' rows live in
  to drop one word is risk for nothing.

### og-track's inbox: the public page writes, this laptop applies (13 Sep 2026)

`server/lib/inbox.js`, migration `050_inbox_applied.sql`, `Push.publishKey()` in
`server/lib/webpush.js`, the inbox timer in `server/lib/sync-worker.js`. **og-track** is a separate
project (Railway, its own repository) that answers `/i/<token>` from the mirror while this laptop is
shut. It cannot reach SQLite, so a customer's review and Notify me land in Supabase's `inbox.items`
(og-track's `sql/002_inbox.sql`: schema `inbox`, not exposed, written only through `track.review` /
`track.push` with the publishable key) and this laptop collects them. `inbox.items` is not a mirrored
table: `mirror.js`, `restore.js`, reconcile and drift never see it.

- **Collected through the POS's own code.** `Inbox.collect()` runs after the boot's full run and every
  minute while the worker is `live`: `track.inbox_take` (up to 50, oldest first) with the service key
  and `Content-Profile: track` (`SB.rpc(fn, args, { schema })`), then each item through exactly what
  the route calls — `Reviews.submit` + `Live.notify` + `Tracking.reviewed` for a review,
  `Tracking.followOrder` / `unfollowOrder` for Notify me — then `track.inbox_done`.
- **Only the mirror's owner collects.** Both functions answer `not_owner` to any lineage id but the
  first word of `sync_state.lineage`; the worker sends `Lineage.localId({ create: false })`. A dev copy
  holding the service key collects nothing and says `[inbox] not collected: not_owner` once.
- **A refusal is reported, a failure waits.** An error with a string `code` and a 4xx `status` — the
  shape of every `fail()` in `reviews.js` and `tracking.js` — is reported `rejected` with that code.
  Anything else (a locked database, a bug) leaves the item pending and logs it; the next minute tries
  again.
- **Applied once: `inbox_applied` (050, LOCAL_ONLY).** Each decision is recorded per item AND revision
  before it is reported, so an `inbox_done` lost to the line is reported again, not applied again.
  `tx()` cannot nest and `Reviews.submit` has its own, so the record follows that commit: a crash in
  between applies one item once more, which is harmless (the same review; a follow already there). A
  newer revision — the customer edited — is a new row and is applied. Rows go after 30 days.
- **A repeat follow greets nobody.** `followOrder` sends the "notifications are on" push only when this
  browser did not already follow this order — on the POS's own page as well. The row is still saved
  again, so fresh keys and a changed language take effect.
- **The page's push key comes from config.** `Push.publishKey()` writes the public half to
  `push.public_key` at boot — after the pull, so a laptop that took the baton replaces the other
  laptop's key — and only when it differs; the settings lane mirrors it and og-track's `track.page`
  hands it to the page. No key in config, no Notify me card on og-track. `CONFIG_WRITABLE` does not
  match `push.*`. What becomes of subscriptions when the laptop changes is in **Known open work**.
- **`supabase:check`'s LOCAL_ONLY** also names `push_keys`, `push_subscriptions` and `push_seen` (048),
  which it had been reporting as missing mirror tables on every run, and `inbox_applied`.
- **Bookkeeping never costs a pass its answer.** Recording, marking reported and the 30-day prune are
  each best-effort: an item already applied is reported even if its record did not land, because the
  report is what stops it being applied again.
- **How it was verified**: 23 checks on a `VACUUM INTO` copy of the live database, with a local
  stand-in for `inbox_take` / `inbox_done` (the script refuses to run unless `lib/supabase.js` points
  at it) and `OG_PUSH_TEST_HOST` on a local receiver — migration 050, `publishKey` once and replacing
  another laptop's key, no lineage and `not_owner` collecting nothing, a review applied and reported
  with the service key and `Content-Profile: track`, a follow whose report was dropped reported next
  pass without a second apply or greeting, a repeat follow greeting nobody, unfollow, a returning
  browser greeted again, `not_delivered` / `bad_subscription` / `not_found` / `unsupported` reported
  with their codes, a locked database leaving an edit pending then applied, the prune, and nothing
  but those two functions called. The locked-database check is what found the prune taking a whole
  pass down with it. The copy was deleted afterwards.

### The shop's bot can be answered on Railway — built, NOT switched on (16 Sep 2026)

`ogRelay()` / `relay()` / `linkWith()` in `server/lib/telegram.js`, `ON_RAILWAY` in
`server/lib/reminders.js`, kind `tg` in `server/lib/inbox.js`. The other half is og-track's `src/tg/`
and `sql/004_tg_bot.sql`; the cutover, in order, is at the end of og-track's `night_shift_2_log.md`.
**Until somebody sets the webhook by hand and puts `OG_TELEGRAM_OG_RELAY=railway` in `server/.env`,
nothing here behaves differently.**

- **One bot moves, the shop's.** With the switch on, `start()` still calls `getMe` and `drain()` still
  sends through `OG_TELEGRAM_TOKEN_OG` — sending is allowed from anywhere — but the laptop stops
  long-polling that bot, because a webhook and `getUpdates` cannot both be live on one token.
  **Yalla Wear's bot never moves**: `OG_TELEGRAM_TOKEN_YALLA` keeps polling here. og-track holds only
  the shop bot's token (`TG_BOT_TOKEN`) and checks it with `getMe` against `TG_BOT_USERNAME`.
- **Railway reads the mirror, never this laptop's tables.** Its one database door, `track.tg`, needs a
  secret (`TG_DB_SECRET`, whose SHA-256 is in `tgbot.settings`, an unexposed schema) and answers with
  counts, ids, stages, dates and money totals — the POS bot's `/queue`, `/today`, `/late`, `/job`,
  `/status`, authorised the same way (the chat must be on `telegram.og_chats`; the owning account's
  `role_permissions` with PINNED/FORBIDDEN restated). It also keeps a hard allowlist of chat ids
  (`TG_ALLOWED_CHATS`): **a phone linked here is answered there only once its chat id is on that list.**
- **Writes come back through the inbox.** The chat list is this laptop's config, so `/start CODE`,
  `/mute`, `/unmute` and the Mute 2h button are queued by og-track as `inbox.items` kind `tg` and
  applied here by `relay()`: a link spends the code in THIS process's memory exactly as the poll does
  (a message older than a code's 10 minutes is refused as `expired`; a wrong code is refused as
  `no_code` and nobody is told — Railway already answered the same sentence either way), a mute goes
  through `muteChat()` for a linked chat, capped at 72 h from when it was asked. Linking therefore
  needs the laptop on, which it is whenever somebody is looking at a code in Settings.
- **The morning digest moves; nothing else does.** `og_digest` fires at shop hour ≥ 9, so with the
  laptop off at nine it arrives when the laptop opens. With the switch on it is skipped here
  (`movedTo: 'railway'` in the preview and status) and og-track sends it at nine from the mirror —
  but only while `config telegram.og_relay` = `railway`, which `start()` writes when the switch is on
  and removes when it is off. So it cannot go out twice, and taking the switch back takes the digest
  back. og-track claims each send in `tgbot.sent` (rule + shop day + chat) and marks it with a
  conditional update; a send with no answer stays claimed and is never repeated. The other 26 rules
  stay: every one is about something this laptop changes while it is on, and several read what the
  mirror does not have (`partner_events`, the dedupe ledger).
- **What the switch does not change.** Telegram job links (`linkFor`, `publicBase()` in this file)
  appear only when `shop.public_url` is set — see Known open work.
- **How it was verified** (scratchpad only, nothing live): 134 checks of the SQL in PGlite (Postgres 18
  in WebAssembly) including every block of `sql/verify_tg.sql`; 43 checks of this side on a `VACUUM
  INTO` copy with invented tokens and every fetch intercepted (the og-track texts proved byte-identical
  to `welcomeText`, `COMMAND_MENU` and `rem_og_digest`); and a 25-check end-to-end run — og-track's
  webhook → the real SQL behind a PostgREST stand-in → this laptop's collector on a copy.

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
  series and so plots the base currency — and says so underneath in words (`rp_chart_base`), since
  a reader who does not know that reads a short month.
- **`repChartData(tab)` is the ONE description of the chart**, read by both the markup that decides
  whether to put a canvas on the page and the hook that draws into it. They used to be separate and
  disagreed: the Inventory canvas appeared whenever any type had PIECES, while the donut was fed
  CAPITAL — so a shop with no cost prices got a legend, an empty ring and nothing else.
  **Since night shift 02 there is one chart, not six**: `repHasChart()` answers true only for the
  Sales tab and only when `repChartRoles()` is (owner or developer), so the other five tabs draw
  their range as a line of words (`.rp-when`) and no card. `repChartData` still describes all six
  — nothing was deleted from it — and `repBar()` prints its share as a percentage rather than
  drawing a bar, keeping its column, header and width because five tables call it and the phone
  card layout is addressed by column position.
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
- **`shelf` is a slot kind** — where the pair belongs, resolved server-side (`shelfCodeFor` in
  `server/lib/labels.js`); blank keeps its box. `shelves.js` already counted labels printed
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

**The design reference for the 3D room is `docs/img/warehouse-ref.jpg`** — the owner's render of the
back room: the 3D view, the floor plan, the view through the open door, 4.5 × 5.5 × 3.5 m. Look at it
before changing anything the room draws; the screenshots of each stage sit beside it
(`warehouse-a1-*`, `warehouse-b-*`). It is tracked on purpose: `docs/img/*` is ignored as the
proposal rig's output, with an exception for `warehouse-*`. Three stages in a row were judged from a
chat attachment before it was committed.

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

- **Names and clicks are occlusion-tested — and for as long as the feature existed, only the bottom
  half of each rack was.** One world box per rack, tested against the line from the camera; without
  it a product name from the far wall floated over the near rack, and a click went through a rack
  and selected a bay behind it — the hit boxes write no depth. The box was built centred on the
  rack's group, whose origin is ON THE FLOOR, so it ran from −h/2 to +h/2: half underground, and
  every click and name above half the rack's height passed straight through to whatever stood
  behind. This line said "occlusion-tested" the whole time. Fixed in Stage A (floor to top board),
  and `_smcheck.html` now fires a real press through a gap in a near rack at a bay behind it and
  asserts nothing is picked. **Do not read a line like this as covered without a test that goes red
  when it is not.**
- **The room's name is in `sameSig`.** Left out, renaming a room left the old name painted on the
  back wall until something structural forced a rebuild.
- **No mark is better than a black square.** The logo plate starts hidden and appears only once the
  artwork is in hand; the loader is async and can fail outright.

Verified by `_smcheck.html` — `?gl=force` runs the room suite (needs
`--use-angle=swiftshader --enable-unsafe-swiftshader` headless), and **`?hold=1` stops before the
context-loss test** so the finished room can be looked at, which is the one check that cannot be
written as an assertion.

### Stage A: the look, one box per pair, and pressing a bay (15 Sep 2026)

No schema, no API. Pixels, camera and strings.

- **The look is the back room itself**: warm near-black walls and steel, cold concrete, kraft
  boxes, one warm light (`C.light` `#FFD9A0`) as the only bright thing. Selection and hover are
  that light's white (`#FFF2DC`) — green and red stay the scan colours. Floor paint is that white
  too, faint (it was worn lime, and on this screen lime reads as a scan accepted — Stage A.1).
- **The light is counted, per tier**: a hemisphere, one shadow-casting key from overhead, and on
  high four point lights under the strips — **6 on high, 2 on low** (`LIGHTS_HIGH/LOW`, counted as
  VISIBLE lights in `stats()`). The strips are unlit geometry; the pools on the walls are emissive
  maps; the floor's reflection is an env map of the strips (high only), not a second render.
- **The ceiling is one boolean on the camera's height** (`ceilingByCamera()` in `updateCam()`):
  hidden above the walls, there once the camera drops inside.
- **One box per pair, ONE `InstancedMesh` for the room** (plus a second for the type stickers on
  the box ends — the type colour moved there from the old crate fill, so the legend stays true).
  `slotsFor(rec)` decides how many fit a bay from the bay's own size — 24 on the standard rack,
  half on low — and `layoutBoxes()` places them with repeatable jitter keyed on bay and slot, so a
  scan never reshuffles a shelf. **The drawing is capped; the card is not** — the pinned peek
  shows the server's `qty`. `BOX` is the size of a shoe box, not rack geometry; every rack number
  still comes from the server. The box's look is `boxAtlas()` and nothing else: a photo of a real
  box replaces what it draws.
- **Pressing a bay flies to it** (`ShelfRoom.focus`, from the map's `pick` hook, after the repaint
  — a repaint detaches the canvas and stops any tween): square on, the bay and one either side,
  500 ms, clamped so the camera never stands inside the rack opposite. **Where the first press was
  made from is kept** (`flyHome`, the walk included) and Escape flies back there; Escape mid-flight
  stops the camera where it is; a press or a drag takes it back too. Pressing the selected bay
  again deselects and flies back — the touch screen's Escape. No flight while the layout editor is
  open. A canned view or a camera switch forgets the way back.
- **The pinned card** (`showPinned` in `shelfmap.js`) is the peek, docked in the room's corner, and
  — unlike the hover card and the flat panel — it carries the **count per size**, most held first,
  with colourway and "Rack · Level · Bay". `peekPin` survives the repaint that `hidePeek()`s it.
  Its Escape listener is at the capture phase so one Escape never closes a dialog AND flies.
- **On touch, a finger holds before it grabs** (450 ms still) in the editor; move first and it is
  an orbit. Held and let go without moving puts the rack back, saving nothing.
- **The rack boxes were half underground** until this stage: built centred on a group whose origin
  is the floor, they covered −h/2..h/2, so clicks and names above half height went unoccluded. Now
  floor to top board. The harness's occlusion test is what found it.
- Arabic: **one word for a bay, خانة** — it was already on screen and the shop knows it. Stage A
  briefly used عمود; A.1 changed those, and the two older strings that also said عمود
  (`sm_origin`, `sm_no_renumber`). The one عمود left in the repo is a customers-screen note about a
  table column, which is the right word there.
- `_smcheck.html?gl=force` asserts all of it (lights per tier, one instanced mesh, cap vs card,
  ceiling, flight frames, Escape, occlusion, shaped RTL Arabic on plates and tags, touch hold);
  `?room=og&hold` is a look-only room shaped like the shop's 4.5 × 5.5 × 3.5 m back room.
  `ShelfRoom.bench(n)` times frames with a pixel read-back — **Chrome does not block on
  `gl.finish()`**, which reported 0.27 ms under swiftshader.

### Stage A.1: the room from the reference render (15 Sep 2026)

The owner's reference render (a 3D cutaway, a floor plan, a view through the open door; 4.5 × 5.5 ×
3.5 m) is the target. Still no schema, no migration, no API. The middle free-standing rack in it is
**Stage B** — the schema cannot describe a rack that is not on a wall — and is not faked.

- **Racks are open steel**: a slim post front and back at every bay boundary (drawn inside the
  server's `upright`, so a bay's clear width is unchanged), the boards, and two top rails instead of
  a top board — from above, the top level's boxes are what a person looks down on. Bay outlines and
  the metre grid are **edit-only** (`editOnly`, toggled in `setEdit`): the open frame shows a bay on
  its own, and a wireframe over every shelf made the room read as a drawing.
- **Walls have thickness** (`WALL_T`, 20 cm, outward of the measured room): plaster inside, block
  outside, a lighter cap on top that draws the room's outline from above. **The inside cornice is
  gone** — seen from above it was a dark band across the floor. The inside face is still the only
  thing a wall pull grabs. **The outside face steps aside** for a camera outside that wall and below
  its top (`ceilingByCamera` now also does the shell — one boolean per wall), so a low orbit past the
  front still looks into the room. Outside faces cast no shadow, so this never touches the baked map.
- **The door is a hole in the front wall**, hung on the jamb nearer the middle and **standing open
  outward**, as the reference draws it: slatted leaf, the mark on its outside face, a lamp over it
  whose wash is on the front wall's outside face (so it steps aside with it), and a warm pool on the
  ground. The ground outside (`groundTexture`, unlit) carries the light spilling along the foot of
  the front wall.
- **The back wall carries the mark and nothing else** — the room's name is on the room selector.
  The mark is drawn as white ink from the artwork's brightness (`markCanvas`), because
  `assets/logo.svg` is a white mark on a black square and drawn as-is the square comes with it.
  Still hidden until the artwork loads; a tainted canvas gives no mark, never the square.
- **Wall lights are slim lit bars** with their wash painted into the wall's emissive map
  (`wallWash`): upright above the racks on the side walls, level either side of the mark on the
  back. No real lights were added — the tier budget (6 / 2) is unchanged and still asserted.
- **Floor paint is the light's white, faint** (`floorPaint`): three thin lines with open arrowheads
  looping up the right aisle from the door, across the back, down the left; the front area is a
  dashed edge from the end of the side racks to the front wall (at most 1.4 m), and its words sit
  **beside** the door, never in front of it. No lime anywhere on the floor — the per-rack lime aisle
  line is gone inside a room, and the drag ghost's floor is white.
- **The floor is neutral grey**, key light less orange than the strips (`C.key`), and a faint
  additive glow makes the middle brightest, as a room lit from the ceiling is.
- **The room opens from the reference's seat**, nearly frontal and steep (`homeAz` 0.18, `homePol`
  0.6). From the old three-quarter seat the new front wall's block face covered half the floor.
- **A wall whose outside face is showing now occludes like a rack** (`shellWalls[].box` in
  `blocked()`): names and clicks behind it are hidden. Without it the right rack's names floated
  over the front wall. A wall that has stepped aside for a low camera occludes nothing, and walls
  stand outside the room, so from inside they never get between the eye and a bay.
- **Harness** (`_smcheck.html?gl=force`): every wall shows its thickness from above and the front one
  steps aside for a low camera out front; no painted pixel on the floor is green; the arrows loop;
  the Front area words clear the door; the grid and outlines appear only in the editor.
  `?room=og&hold` is now the live room's exact sizes. The `short:` check was made to reset the camera
  first: it had passed or failed on how long the room took to build, because a canvas-centre ray taken
  mid-arrival landed just outside a 2 m room.
- **Declined on purpose**: a true mirror floor (the scene twice per frame) and soft contact shadows
  under the boxes (a post-processing pass, per frame, against "a still camera schedules nothing").

**Superseded by `npm run warehouse:one-room` (Stage B, below)**, which builds the same room with the
middle rack as well and every rack on 92 cm bays (B moved to 41 cm); the paragraph is kept for what
it says about the old racks' labels.
**Rebuilding the live room from the render was prepared, NOT run** (15 Sep 2026 — the session's
auto mode refused a write to the live `og.db`). It is one script, verified on a `VACUUM INTO` copy
and going through `server/lib/shelves.js` so every row is `logChange`d: it refuses unless the rooms
are exactly the owner's old test rooms `vorig`, `safa` and `safaSSS`; clears the shelf location of the
153 pieces of OG-053 on `safaSSS`'s A6 (their quantity on the shop floor is untouched); deletes the 172
shelves, four racks and three rooms; and creates room **المستودع** (store, 450 × 550 × 350 cm) with rack
**A** الرف الأيسر (left wall at 115 cm, 4 × 92 cm bays), **B** الرف الخلفي (back wall at 55 cm, 4 × 85 cm)
and **C** الرف الأيمن (right wall at 67 cm, 4 × 92 cm), each 6 levels of 34 cm, 45 cm deep. A backup was
taken first (`server/backups/og-2026-09-15T11-18-14-590.db`). Once it runs, **every shelf label printed
for the old racks is a code for a shelf that does not exist.** Check the database, not this paragraph:
`SELECT id, name FROM rooms`.

### Stage B: a rack that stands on the floor, and one real room (15 Sep 2026)

Migration `051_free_racks.sql`, mirror file `server/supabase/020_free_racks.sql` (in `CATCH-UP.sql`),
`server/lib/shelves.js`, `server/scripts/warehouse-one-room.js`.

- **`sections.placement`** is `'wall'` or `'free'`, with `x_cm` (left edge to the rack's middle),
  `y_cm` (FRONT edge — the door's wall — to its middle) and `rot_deg` (0/90/180/270). **The DEFAULT is
  the migration**: every existing row reads `'wall'` with no UPDATE, no `change_log` row, nothing
  re-mirrored — verified column for column on a copy of the live database.
- **`'wall'` with no `wall` is still legal** — a rack in its room not placed yet, which live rows
  are. What is refused, in `checkPlacement` with `bad_placement`, is half and half: `'free'` with a
  wall or a wall position, or `'wall'` (or no placement) with any of x/y/rot. A free rack needs all
  three, a quarter turn (`bad_rotation`), and a **measured** room (`free_unmeasured`) — there is
  nothing to measure its aisles against otherwise; a room holding one cannot be un-measured.
- **Quarter turns only**, so every footprint stays axis-aligned and the maths extends rather than
  being replaced. **`footprint()` (server, cm) and `placeOnWall()` + `footprint()` (shelfroom.js,
  metres) gained the same fifth case, `'free'`, in the same position** — n, s, e, free, default w —
  and `fpCm()` in shelfmap.js, the fill plan's copy, with them. Change one, change all.
- **Every rack tests against every rack** (`placedRacks` now returns racks on the floor too, each
  with its `place`), and a free rack is also tested against the walls (`outside_room`). Refusals
  name the neighbour by name and letter (`rack_overlap`).
- **THE AISLE RULE**: `AISLE_MIN` (70 cm) beside the other constants; `aisleMin()` reads
  `OG_AISLE_MIN` on every call, and **0 turns it off** (for a harness). A free rack may leave no less
  than that to any wall or rack (`aisle_narrow` carries `gap`, `need`, and the wall or the rack), and
  a wall rack placed or grown into a free rack's aisle is refused the same way — the gap is the same
  whichever of the two moved. It rides `GET /api/sections` as `limits.aisle_min_cm`, with
  `limits.rotations`, so the drag previews the server's number.
- **Where the old code grew a rack without asking**, it now asks: `seedGrid` re-checks a placed rack
  at its new width (before 051 a grid could run a wall rack off its wall), `editCols` checks free
  racks too, and `fitRoom` refuses a resize that would put a wall or a wall rack through a free
  rack's aisle, with the room that would do.
- **`clearances(roomId)`** reports every gap round every free rack, for the script's report and for
  the check that a seed passes its own rule.
- **The browser**: a free rack drags on the floor (never snapping onto a wall), **R** turns it a
  quarter in the air, the readout shows the live gap to the nearest thing and hides the ghost where
  the server would refuse; **nothing is written until release**. The on-screen turn — a touch screen
  has no R — is the ⟳ button on the island's row in the designer. The rack dialog offers
  Free-standing / حر in the wall list, with x, y and turn. The plan draws the island on its floor,
  upright when it runs front to back (`.sm-pl-island`). In the room it is the same open frame, its
  boxes in the same InstancedMesh, **no light added**, and its plate turns to face the camera
  (`billboards`, set in `ceilingByCamera`; depth-tested, casts no shadow). The floor arrows run the
  two aisles either side of an island and turn across the floor behind it.
- **The room switcher hides when it would offer one choice** (rooms + racks in no room ≤ 1), at
  render time; rooms stay fully supported.
- **`npm run warehouse:one-room`** is the owner's script: refuses unless the rooms are exactly
  `vorig`, `safa`, `safaSSS` with every rack in one of them; takes and verifies a backup; clears the
  shelf location of the 153 pieces of OG-053 (quantities untouched); deletes the 172 shelves, 4 racks
  and 3 rooms through the lib; builds المستودع with **every rack on the room's own 92 cm bay** — A on
  the left wall at 115 cm, B centred on the back wall at 41 cm, C on the right wall at 67 cm, 4 × 92
  each — and **D الرف الأوسط free-standing, 2 × 92 = 184 cm** (the count nearest 2 m), centred (x 225),
  115 cm clear to the front wall (y 207), turned 270° so its bays face the aisle the door opens onto.
  84 shelves. Each rack is placed only after its grid exists, so the fit and aisle checks run on the
  rack as it will stand. A second run finds the room built and changes nothing.
  **Clearances round D**: 158 cm to A and to C, 206 cm to B, 115 cm to the front wall, 251 cm to the
  back wall.
- **A rack's bay width belongs to its room.** The first version seeded D with the server's standard
  114 cm (228 cm long, outside the 190–205 cm measured off the reference) beside wall racks of 92 cm —
  and B at 85 — so one rack stood a different size from its neighbours for good. `ROOM.bayCm` is the
  one number now, and nothing else in the seed reached for `GEOMETRY` (levels and depth were already
  the script's own). The script checks the ROWS after building and on every later run (`wrongBays`)
  and refuses with exit 4, naming the rack, when one is not the room's width — a rack resized
  afterwards, or left on the standard (`bay_cm` NULL), included.
- **THE GO-LIVE ORDER, from the code**: `020_free_racks.sql` in the dashboard → the server restarted
  on this code (which applies 051) → the script → `npm run supabase:check`. **The script pushes
  nothing**: the RUNNING server's mirror tick finds its `change_log` rows and pushes `sections` with
  `SELECT *`. A server older than Stage B has no `mirror-lag.js` entry for the four columns, so a
  mirror without 020 rejects every rack batch; a Stage B server facing the same mirror drops the
  columns and pushes D anyway with its cursor past it — a rack on no wall in the mirror until
  reconcile. **It will not apply 051 itself**: `lib/db.js` `open()` migrates on the way in, which put
  the first version's schema change BEFORE its own refusal and before its backup. It now looks
  through `DB.openReadOnly()` and `DB.pendingMigrations()` first, refuses with exit 3 while any
  migration is pending, and opens to write only after the backup, re-checking that the rooms and
  racks are the ones it checked. **On 15 Sep 2026 the live server was restarted at 18:58 and applied
  051 then; 020 had not been run on the mirror** (`supabase:drift` named the four columns).
- **Verified**: the script against copies, 26 checks — refused on a database the server has not been
  restarted on, with the schema, the rooms and the backup folder all untouched; built on a copy of
  the live file with every rack at 92 cm, 84 shelves and no stock quantity moved; nothing to do the
  second time; refused naming D at 114 cm and at the standard; refused on unexpected rooms. Before
  that, 38 server checks on a copy (migration, footprints, round trip, every refusal, the
  aisle at 0, `fitRoom`, a restore through the same insert `restore.js` uses, and a row from a mirror
  without 020); the script refused a mismatched copy and ran twice on another; `_smcheck.html` —
  wall racks with no placement draw as before, the four turns, the island drawn, plate facing from
  four sides, occlusion through it, drag and R and release, the aisle refusal and its words, the
  aisle at 0, the switcher at one and two rooms. 211 pass in English, 212 in Arabic, 140 as staff
  (**staff have no editor**, so the step checks there is no turn button and skips the carrying; it
  used to click an edit button that is not there). The walk check now waits for the loop's second
  frame instead of 120 ms — under swiftshader the first frame after the walk switch came later
  than that, and the key had been taken.
- **Frame time with the island** (`ShelfRoom.bench(30)`, Intel UHD, 1440×900 fullscreen, DPR 1):
  high 11.7 ms mean from the seat and 14.4 walking, low 6.4 and 7.7; 358 boxes, 260 draw calls,
  6 lights on high and 2 on low. Two swiftshader harness runs at once share one CPU and fail the
  timing checks — run one at a time; the GPU Chrome can run beside it.
- **Run `020` in the Supabase dashboard, then reconcile**, or a free rack restores as a rack on no
  wall; until then the sync names the file every run.

### Stage C: live, editable, and the product on the box (15 Sep 2026)

No migration. `server/lib/shelves.js`, `server/index.js`, `js/pulse.js`, `js/shelfmap.js`,
`js/shelfroom.js`, the `sm_*` strings, `_smcheck.html`.

**Live.** The map was not subscribed to anything: stock put away on one screen reached another on its
next reload. Now `DB.onCommit` in `index.js` watches the tables a commit touched — `rooms`,
`sections`, `shelves` are a LAYOUT change, `stock` a STOCK change — debounces 250 ms and sends
`Live.notify('og', { shelves: 'layout' | 'stock' })`: a flag, no data (a burst of three writes is one
event). `/api/live` admits `stock.read`, so the warehouse holds the line. `js/pulse.js` hands the flag
to `ShelfMap.live()`, which asks `GET /api/sections` again through the same gated route and compares
two signatures before drawing anything (`layoutSig` / `stockSig`).

- **A stock change is the repaint every scan already is**: the room's `sameSig` has no quantities,
  so it keeps its scene, moves the instanced boxes, draws one frame and goes quiet. `stats().rebuilds`
  counts real rebuilds and the harness asserts it does not move.
- **Never under somebody's hands.** `busy()` in `shelfmap.js` is the one list: a dialog or drawer
  open, the layout editor open, a new rack being placed, a rack / wall / grip in the air
  (`ShelfRoom.dragging()`), a camera flight, a hand on the canvas (`ShelfRoom.handBusy()`). A held
  update is looked at every 400 ms — a timer, never a frame — and taken the moment they are free.
- **A layout changed ELSEWHERE while this person is laying the room out is never taken for them**:
  `#smLive` (and `#smLiveFs` in fullscreen) says so with **Show the new layout**, written straight into
  its host rather than by a repaint, because a repaint is the thing it exists not to do.
- **The 45 s poll is the backstop only while the live line is down** (`Pulse.isLive()`), and a map
  that is not on screen marks itself stale and reloads when it comes back.

**Who may reshape the room.** Every layout write — sections, rooms, grid, rows, cols, POST/DELETE
shelves, and since 16 Sep 2026 `PATCH /api/shelves/:id` — is `config.write` now; putting a pair away
(`POST /api/stock/assign-shelf`) stays `stock.move`. A warehouse account is refused 403 at the server, and in the browser has no
editor, so no Add a rack, no grips and no take-the-layout button — the staff run asserts all three
are absent.

**Found on the way — a Stage B bug:** `SHELF_STATUS` never learned 051's refusal codes, so
`rack_overlap`, `aisle_narrow`, `outside_room` and `free_unmeasured` reached the browser as a bare
`400 invalid` without their numbers. They are 409 with their fields now, beside the new
`rack_too_tall` and `room_too_low` (and `bad_placement` / `bad_rotation` as 400).

**Adding and removing, from inside the room.**

- **A new rack takes its room's size — bay, level AND depth** (`roomSizeCm`: the size the racks
  already there share, the smaller on a tie), never the standard, and `createSection` takes
  `rows`/`cols` so the grid is written in the same transaction as the rack: a refusal leaves nothing
  behind. The rack dialog's placeholder and hint say the room's size for a new rack
  (`sm_rack_size_hint_room`); an existing rack left blank is still the standard.
- **Add a rack** is a small form in the designer, drawn only inside the room: on a wall or standing
  free, how many bays and levels (the room's commonest to start). **Place it** puts a ghost in the
  hand at the room's own numbers (`roomShape()` — the browser twin of `roomSizeCm`), a press on the
  room puts it down, Escape or a press elsewhere puts it back. Nothing is written until it is down;
  then one POST with the next free letter, the grid and **no size**.
- **Grips on the rack in focus** while the editor is open (`placeHandles`): one at the end a rack
  grows from, for bays; one over its top, for levels. The light's white. Drag, and the ghost shows the
  shape with a readout: how many, and the live gap to the nearest thing. A wall rack grows from its
  measured end, a free rack both ways from its middle; a level is added at the bottom and taking
  levels away takes the lowest. **Nothing is written until release**, then one request —
  `{action:'add', count}` or `{action:'remove', last}` (`editRows`/`editCols` take both).
- **Refused in the air, saying why**: past the end of its wall, through a wall, into a rack, into a
  free rack's aisle, a free rack in an unmeasured room, **through the ceiling** (`checkHeight`: base +
  levels × level + top against the room's height, with the most levels that would fit), and taking
  away **a bay or level with stock on it — named, with the count** ("خانة ٤ فيها ٣ قطعة — فضّيها
  أولاً"). The server refuses the same things (`rack_too_tall`; `shelf_occupied` now carries
  `bays:[{col,pieces}]` and `levels:[{row,pieces}]`) and `layoutError` words them. **Stock is never
  moved for anybody.** A ceiling lowered onto a rack is `room_too_low`, naming it.
- The owner's example said زوج; the strings say **قطعة**, because the server counts pieces and a
  bay can hold things that are not pairs.

**THE PRODUCT ON THE BOX.** Every box is one `InstancedMesh`, and one mesh has one texture, so the
pictures are ONE ATLAS: a grid of slots, one per product with a photo (`products.image_url`, hydrated
as `image.src`). Each box carries its slot as an instanced attribute (`aSlot`, −1 = kraft); the box
material's shader — `onBeforeCompile` on the ordinary `MeshStandardMaterial`, the lighting untouched —
samples that slot on **both end faces** (`aEnd`/`aEndUv`, taken before the kraft atlas remap), so a
wall rack shows it to its aisle and the island to both of its.

- **A slot is the end face's letterbox** (about 2.5 : 1 under the lid's edge, `PIC_U0..PIC_V1`), and a
  photo of another shape is fitted inside it on kraft, centred, never stretched. The sticker stays and
  thins under a picture (`PIC_TAG0/1`); a box without one is exactly the old box.
- **The slots come from the product count**: as wide as they can be up to 420 px (the product
  screen's stored photos are ≤ 420 px) and no narrower than 96, with a quarter again of headroom, in
  an atlas of at most 2048 — the real room made a 1024 × 2048 atlas of 16 slots for 12 products, the
  2× room 2048 × 2048 of 30 for 24.
- **Most held first.** More products than slots: the least held stay kraft (`nospace`), and a box
  only ever shows a slot whose photo is still that product's photo — `pictureAudit()` checks every
  box against whose it is. **A product put away later takes a free slot without a rebuild**, or stays
  kraft until the next rebuild when there is none; a photo replaced or removed is kraft until then.
- **The room never waits for a picture.** It draws kraft and a box takes its picture when the image
  lands. Four fetches at once, 20 s each, `crossOrigin='anonymous'` (the bucket sends
  `Access-Control-Allow-Origin: *`), cached per page by URL including failures. Each image is drawn
  through a scratch canvas that is read back first, so one that would taint the canvas is refused
  there instead of stopping the whole atlas uploading. No URL, a dead one, a timeout: that product's
  boxes are kraft and **nothing is logged**. A room where no product has a photo — the shop today —
  makes no atlas and fetches nothing. **The low tier draws none and fetches none.**

**Draw calls stopped growing with the room.** The hit boxes were drawn — invisible, but a draw call
each, 84 in the shop's room — and are `visible = false` now (r147's raycaster ignores visibility).
Every post, rail and board was its own mesh; they are two `InstancedMesh`es for the whole room
(`frameMesh`, `boardMesh`), a board's type tint its instance colour, and a rack in the hand is hidden
by collapsing its own instances (`rackPieces`, `showRack`). **260 calls became 50**; the 2× room is 60 —
what is left per rack is its name plate, and a wider room adds a ceiling strip.

**At double.** `_smcheck.html?room=og2&pics=24` is the headroom room: 6.36 × 7.78 m (twice the floor),
eight racks with two islands, 162 bays, 702 boxes, 24 products with drawn test photographs (`?pics=N`,
harness artwork only). It builds, walks, keeps 6 lights on high and 2 on low, and two islands keep
the aisle between them. Frame time (`ShelfRoom.bench(60)`, Intel UHD, 1440 × 900 fullscreen, DPR 1,
mean ms):

| | high, seat | high, walking | low, seat | low, walking | calls |
|---|---|---|---|---|---|
| Stage B, the shop's room | 11.7 | 14.4 | 6.4 | 7.7 | 260 |
| Stage C, no photos | 10.7 | 13.3 | 6.5 | 6.2 | 50 |
| Stage C, 12 photos | 9.5 | 13.0 | 5.7 | 6.1 | 50 |
| 2×, no photos | 11.0 | 13.6 | 6.2 | 7.9 | 60 |
| 2×, 24 photos | 11.2 | 13.5 | 8.2 | 8.9 | 60 |

The pictures cost nothing measurable. **High stays under 16.7 ms at 2× — about 3 ms of headroom
walking**, and what grows with the room now is triangles and the shadow bake (702 boxes, 13k
triangles), not calls. Before the frame was instanced the 2× room was 306 calls with a worst frame of
16.7 ms walking.

**Verified**: 30 server checks on a copy with the one-room script run on it (room size, grid in the
same transaction, rows/cols count and last, ceiling, room too low, occupied bays and levels named);
16 over HTTP on a scratch server (`OG_SYNC_MINUTES=0 OG_HTTPS=0 OG_PULL_AT_BOOT=0 OG_PUSH=0`, bogus
Telegram tokens — a warehouse account holds the live line, gets `shelves: stock` once for a burst, is
refused 403 on every layout write, still reads and puts away; `aisle_narrow` arrives as 409 with its
gap); `_smcheck.html` 273 in English, 274 in Arabic, 179 as staff, 97 flat — live update without a
rebuild and one frame then quiet, held through a drag / a flight / a dialog, the backstop poll, the
layout line while editing, a rack added at the room's 92 cm bay, grips with nothing written in the
air, the aisle and the ceiling refused in the air and from the server in the page's language, an
occupied bay named with its count, pictures with no rebuild, a failed photo kraft, a portrait photo
letterboxed, the atlas filled, both end faces read back as pixels, the low tier, nothing logged; and
11 checks on the 2× room. Screenshots: `docs/img/warehouse-c-pictures.png`,
`warehouse-c-pictures-island.png`, `warehouse-c-double.png`.

## The warehouse: moving stock, and the log of it

### The four jobs (was: the tabs, in the order the room works)

**Night shift 02 replaced the tab bar with four verbs** — see that section. The screen opens on
**Goods arrived · Move stock · Where is it? · Count**, with Add product beside them and the
movement log, the purchase orders and the wants list under a **More** fold; `OG.wh.tab` lands on
`arrived`, and an account without `stock.move` falls back to the first job it does have (the
fallback in `viewWarehouse`, which now rewrites `OG.wh.tab` rather than only a local). **The tab
ids did not change** — `moves`, `stock`, `po`, `add`, `count`, `wants` are all still there and
still dispatch to the same panels, so every deep link and dashboard shortcut lands where it did.

What was true before and is still true: the Shelf map button left the header (the map has its own
nav entry), and **nothing on "Where is it?" carries stock to the floor** — the per-row Transfer
button and the Move column on the "bring these out" card are gone, because that is the scan
panel's job; the card stays as the list of what to go and fetch. The five-movement card inside Add
product is gone too: movements have a panel of their own.

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

## The money — where every lira and dollar is

`server/lib/cashbook.js`, `js/cashbook.js`, migration `053_cash_book.sql`, mirror file
`server/supabase/021_cash_book.sql`. The shop's money was on paper: the live database had 20 sales,
every one with `shift_id = NULL`, and zero shifts, expenses or supplier payments. Money arrives as cash
and through nine transfer offices and wallets (Sham Cash, Fuad, Haram, Tarabut, Gold Master, Andalus,
Yaqut, Tima, Zam Zam) and card, and **the owner said money sits in those as a balance** — the system
recorded which method a sale used and nothing about how much was where.

**THE STOCK MOVEMENT LOG, APPLIED TO MONEY.** A *place* is where money physically is; a *move* is one
signed row `(place, currency, amount)` in `money_moves` with a `kind` and a reference; a balance is
`SUM(amount)` per place and currency, derived every time and stored nowhere (the `Money.openDebts`
reason). Not a double-entry ledger — debits and credits are vocabulary nobody here reads — but every
move names both sides (the kind and ref, or the other place for a transfer), which is enough for a
balance, a cash flow and a profit and loss. The owner's answers that shaped it (16 Sep 2026): wallet
money stays as a balance; lira and dollars are both held and exchanged often; **the owner takes the
day's cash home and it still pays shop costs**; the cashier counts blind and the owner confirms;
salaries are monthly with advances. Phase 2 (closing the day), phase 3 (suppliers and salaries) and
phase 4 (the month's statement — profit and loss, cash flow) are below.

- **Places are text, not a table.** `drawer`, `owner` ("with the owner"), `m:<method id>` for every
  `pay.methods` entry that is not a drawer method and not `credit`/`order`/`store_credit` — **derived,
  so there is no second list to keep in step** — `driver:<user id>` for door cash not handed in, and
  `x:<id>` for the owner's own places (a safe, a bank) in `config['money.places']`, edited by the
  Settings fold `Cashbook.settingsCard()` through `PUT /api/cash/places`. An `x:` id that has held money
  is never removed, only switched off, and a switched-off place still holding money is still drawn.
- **Every money write the system already made writes its move in the SAME transaction**, through
  `Cash.apply(d, …)`, which opens no transaction of its own (the `Stock.apply` rule): a till sale
  (`Sales.recordIn` — a credit or `order` sale writes none, a sale paid entirely in points writes
  none), a void (`Cash.reverse`, new rows, never an edit), a debt payment, an expense, a delivery-office
  payment and refund (`Orders.takePayment` / `refundOut`), the driver hand-in (`Cash.handInPayment`:
  `driver:<id>` → `drawer`; a payment taken before 053 simply *arrives* in the drawer), and a payment
  to Yalla Wear. **The shop's money leaves once** for Yalla Wear: when the shop records the payment,
  or when the shop confirms one Yalla Wear recorded — never both, and Yalla Wear's own record moves
  nothing on the shop's books. Their request can carry no `place`; the route reads it only for `og`.
- **A NEGATIVE BALANCE IS ALLOWED, AND SAID.** The opposite of stock's `CHECK (qty >= 0)`, on purpose:
  a wallet reading −50,000 means something coming IN was never recorded, and refusing a supplier
  payment out of it would stop the shop recording the payment at all. The card turns amber and says so
  in words.
- **Append-only, and corrections are rows.** Load-bearing twice: the trail stays honest, and the mirror
  pushes this table above its highest id, which never sees an UPDATE. **An expense is voided by an
  `expense_void` move, not a flag** — `expenses` is append-only in the mirror too, so a `voided` column
  there would never arrive. Every reader of expenses asks the book (`Money.summary`, `EXPENSE_SELECT`).
- **The one zero.** `amount <> 0` except for `opening`, `count_diff` and `expense_void` — a check that
  matched ("Sham Cash, the 16th, exact") is evidence, a first balance of nothing is a start, and a void
  of an expense written before 053 has no move to reverse.
- **The first check of a place in a currency is its `opening`.** No backfill of the 20 old sales —
  that cash went home weeks ago. The owner enters starting balances once (the Now tab's call to
  action); because it is a *check*, a sale rung up between the deploy and that pass is not counted
  twice. **A check never shows what the book expects** — the difference comes back afterwards.
- **An expense names WHERE it was paid from** (`place`), in either currency, on a past day (refused
  more than a day and a half ahead). The `expenses` table gained no column for it (a column the mirror
  lacks would stop every expense landing): the place lives on the move, and `method` says as much as it
  can — a wallet's method id, `cash` for the drawer (so a shift still counts it), and the place id for
  anything else, which is in no drawer list, so a shift never subtracts money that did not leave it.
- **A transfer's fee is its own `fee` row out of the FROM place** — a hawala office keeps a commission,
  and that row is what the statement will count as a cost. **An exchange freezes the rate actually
  got** on the non-dollar row (`fx_rate`), so the difference from the shop's rate is a real figure;
  a rate half or double the shop's is recorded and flagged `rate_far` (cents typed as dollars).
  "Make this the shop's rate" inserts the `fx_rates` row inside the same transaction (`Cat.setRate`
  opens its own) and needs `config.write` as well.
- **Permission `money.move`** (manager) for every write here; reading is `money.read`. `money.*` is
  already forbidden to the partner by prefix. `GET /api/money` carries `cash` (the snapshot) and `book`
  (the latest 200, capped with `withCap`); the Book tab's filters ask `GET /api/cash/book` and repaint
  one panel.
- **Bugs fixed with it:** `payDebt` forced the base currency and subtracted lira from a dollar-cent
  balance — a debt is now paid in its own currency and anything else is `bad_currency`; a debt cannot
  be "paid on credit" (`bad_method`); a dollar cash sale at the till is now listed beside the shift
  figure (`salesOther`); `DB.debtTotal()` / `debtAgeing()` added cents to lira — one currency each now,
  and the debt book draws each debt in its own; the "Last shift" card read the OLDEST shift (the server
  sends newest first); the expense and settle dialogs offered four hardcoded methods; the close-shift
  dialog printed the expected figure it tells people not to look at; the drawer arithmetic left out the
  delivery office's cash (`mn_orders_in`); `CONFIG.BASE_CURRENCY` was never read from
  `shop.base_currency`.
- **The screen** is the Money screen; 053 gave it five tabs (054 and 055 add three more): **Where it is** (a card per place, per-currency
  totals, the four actions), **Cash book**, Shift, Expenses, Debt book. A card's status chips sit under
  the name — beside it they took the width and "Safe" was drawn a letter per line. **A signed amount is
  ONE `<bdi dir="ltr">` with the sign inside** — two isolates side by side were reordered by Arabic and
  "−$81.50" read "$81.50−". The expense list sits under the categories at full width; beside them its
  columns scrolled sideways at 1366. `Desk.toMinor` parses every amount, so "12,50" is twelve and a half.
- **The mirror.** `money_moves` is append-only and behind a guarded block of its own at the end of the
  walk (`flags.cashFailed`, exit 1 from `supabase:sync`). It is in `restore.js` `ORDER`, `drift.js`
  `PUSHED` and the reconcile's list; `supabase:check` finds it from the schema. **Until `021` is run in
  the dashboard, the sync names the file every run AND THE BOOT PULL REFUSES WITH `drift`** — the
  laptop handover will not happen until it is run. Run `021` (it is also at the end of `CATCH-UP.sql`)
  before the shop next moves laptops; no reconcile is needed for it alone.
- **Verified** on a `VACUUM INTO` copy with a scratch server (`OG_SYNC_MINUTES=0`, a dead
  `SUPABASE_URL`, bogus Telegram tokens, `OG_ORIGINS` set to the scratch address — the real list refuses
  a browser login there): 90 API checks (every write path, both currencies, replays, refusals, the
  driver hand-in, the cashier refused; every balance equals the sum of its moves), 15 on the Yalla Wear
  handshake, 50 in a browser over CDP (both languages, 1366 and 390, dialogs hit-tested, raw i18n keys,
  the cashier bounced), and the real `Mirror.fullRun` against a faked `fetch` with the table present
  (every row pushed, a second push finds nothing) and absent (skipped by name, the rest still pushed).
  Two harness facts: `Page.navigate` from `/` to `/#money` is a hash change and does not reload —
  sign in, then load a distinct URL; and wait for `#bootSplash` to go before hit-testing anything.

### Closing the day (054)

`server/lib/dayclose.js`, the **Close the day** tab (`Cashbook.closeTab`), migration
`054_day_close.sql`, mirror file `server/supabase/022_day_close.sql`. The owner's night as he described
it: **the cashier counts** — lira and dollars — **and the owner confirms and takes the cash home**.

- **The count is blind ON THE SERVER.** An account with `money.count` and not `money.move` is sent
  `DayClose.blind(close)` — who counted and what they counted, never `expected` or the difference —
  in the answer to its own count and in `GET /api/day-close`, and no history at all (a list of how
  short people were is the owner's). A figure hidden only in the browser is one devtools away.
- **`expected` is frozen AT THE COUNT**, per currency, from the cash book's drawer. A sale rung up
  between the count and the confirmation is in the drawer and not in the count; measured at
  confirmation it would read as a shortage nobody caused. A **recount** (while unconfirmed) replaces
  the lines and re-freezes the figure; a confirmed close is history and is corrected in the book.
- **Every currency the drawer holds must be counted** (`count_all`, naming them) — or the owner
  confirms a night with the dollars missing. The form always sends every currency; an empty box is 0.
- **Confirming is one transaction**: per currency a `count_diff` row (the `opening` if the book had
  not started there, and a zero when exact — it dates the drawer's last check), then what he takes as
  a `transfer` drawer → `owner`. `take_too_much` refuses more than was counted. **The drawer is
  continuous** — tomorrow's float is what he left; nobody types a float. "Take" defaults to all but
  what was left last night. A count he will not confirm is thrown away (`cancelled`); nothing moved.
- **Shifts stay** — sales carry `shift_id`, the table is mirrored, and a shop that uses shifts keeps
  them. The Shift tab is untouched; the day close is what proves the drawer from now on.
- **`money.count`** (cashier + manager) reaches the Money screen, which then draws only the tabs the
  account may have — a cashier gets the count and nothing else. `NAV_PERM` values may now be a list
  (any-of, `navAllowed`). **Money was missing from the phone's More sheet** (`MORE_ITEMS`), so nobody
  could reach it on a phone at all. The cashier's home has **Count the drawer** (`data-cb="go-close"`).
- **Reminders.** New rule **`day_uncounted`** (on, `reminders.day_count_hour` 22): the drawer moved
  today, the book has started there, and nobody counted — no figure in the sentence, in the cashier
  preset (054 appends it), `KIND_SINCE` 5 / `RULES_VERSION` 5, listed in `nextDaily()`.
  **`day_close`** now quotes the book's drawer and whether tonight is counted, and a day with a count
  but no invoice is still a day. **`cash_variance`** also reads the last confirmed close, one row per
  currency over its own threshold (`reminders.variance_min_usd`, cents, beside the lira one), filed
  `refType: 'day_close'` — a rule's row may now name its own `refType`.
- **`fmtMoney` in `telegram.js` printed minor units as they came**, so a driver holding $60 was told
  "6,000 USD" — every template passes minor units. Dollars get two decimals now.
- **The mirror:** `day_closes` is cursor-shape (updated on confirmation) with `day_close_lines`
  riding on its `afterUpsert`, in the cash-book block behind **its own** guard — a project with 021
  and not 022 still mirrors the book. In `ORDER`, `PUSHED` and the reconcile list. **Run `022` in the
  dashboard after `021`**; until then the boot pull refuses with `drift`.
- **Verified** on the scratch copy: 31 API checks (the blind answer, the refusal to leave out
  dollars, a replay, a recount, a sale after the count not becoming a shortage, the float left, the
  zero check, `take_too_much`, a cancel moving nothing, the nudge before and after, the variance
  message naming the close), the real mirror against a faked `fetch` in three states (both files,
  neither, 021 without 022), and 22 in a browser (the cashier's screen never containing the book's
  figure, her phone in Arabic, the owner's table and the live "stays in the drawer").

### Suppliers and salaries (055)

`server/lib/payables.js`, `js/payables.js` (global `Payables`, `data-py`), the **Suppliers** and
**Salaries** tabs of the Money screen, migration `055_payables.sql`, mirror file
`server/supabase/023_payables.sql`. Before this, receiving a purchase order raised
`suppliers.outstanding` and nothing ever lowered it; nothing recorded a salary or an advance, and the
payroll bell, keyed on a date nothing moved, never cleared.

- **A supplier's debt is a ledger with a running total — the stock pattern.** `supplier_ledger` is
  append-only (`opening · purchase · payment · return · adjust · reversal`, signed, + = the shop owes
  more), and `suppliers.outstanding` is written **in the same transaction by `Payables.post()`, the
  only way it moves**. `Payables.audit()` compares every running total with its sum. The columns the
  ledger keeps (`outstanding`, `total_purchased`, `last_payment`) are not writable by the editor, and
  the generic upsert in `partner.js` that could write them is gone.
- **One debt currency per supplier.** Goods received on a lira order from a dollar supplier are
  converted through the USD rates at that moment (`convert()`), and the row keeps what the order said
  (`paid_amount` / `paid_currency`). A payment in the other currency is the same: the money leaves the
  place in the currency it was handed over in (a `supplier_pay` move), the debt comes down in the
  supplier's. **The currency cannot change while anything is owed** (`currency_locked`) — the balance
  would silently change meaning. Paying more than is owed is allowed and said (`paid_ahead`).
- **A supplier payment is not an expense** (017's rule, restated on the dialog): the goods are already
  in cost price. An opening balance can be entered once (`already_opened`); a correction needs a reason
  (`needs_note`); only a payment can be undone, by a `reversal` row that also puts the money back
  (`Cash.reverse`). 055 backfilled an `opening` row for every non-zero `outstanding`, so the audit holds
  from the first boot.
- **Salaries are months.** `salary_payments` (`advance · salary · bonus · deduction · reversal`,
  `month` = `YYYY-MM`). A month owes salary + bonuses − deductions; advances and the salary payment
  count against it. **Only an advance or a salary moves money** (a `salary` move, and the route then
  also needs `money.write`); a bonus or a deduction changes what the month owes and ignores any place
  sent. Paying more than is left is refused with the figure (`more_than_owed`, `left`) — add the bonus
  first, so the record says why. The browser stops it before sending, from the same number.
- **The pay day is derived, never stored.** `employees.pay_day` (1–28) is the day; `next_payment` is
  this month's pay day while this month is unpaid, next month's once it is settled
  (`Payables.nextPayDay`). The old column is still there, written by nothing; `GET /api/employees` and
  Reports both send the derived one. **The bell's key carries the month** (`payroll:YYYY-MM`) — it was
  the constant `payroll`, so marking it read silenced every month after — and opens Money, on the tab.
- **Reports** read the ledgers: the employees block adds what was actually **paid** in the window
  (advances and salaries, less undone ones) beside the monthly bill, and the next pay day is derived.
- **The screens.** Suppliers: owed per currency (never added), a row per supplier with Pay, History
  (a drawer with undo, returns and corrections) and Edit; a new supplier can carry its opening balance.
  Salaries: a month picker (› ‹, and "this month"), what the month owes / paid / left, a row per person
  with Pay the rest, Advance, Bonus / deduction (one dialog, four kinds), History with undo, and the
  person editor with a login picker (working logins only, never the partner). Every write carries an
  opId minted when the dialog opened. **The payroll body is painted after `render()`**, so it — and the
  Cash book's and Close the day's panels — call `labelWideTables()` themselves; without that the
  table was cut off at 390 instead of becoming cards. In Arabic "Adjust" and "Edit" were both تعديل, so
  the button is "Bonus / deduction".
- **The mirror.** Both ledgers are append-only, in the cash-book block behind their own guard (a
  project with 021 and 022 and not 023 still mirrors the book and the closes), with the 023 file named
  on every run. `employees.pay_day` is in `mirror-lag.js`, so employees go up without it until 023 is
  run. In `ORDER`, `PUSHED` and the reconcile list. **Run `023` after `021` and `022`, then
  `npm run supabase:reconcile`** to fill in `pay_day`; until then the boot pull refuses with `drift`.
- **Verified** on the scratch copy: 80 API checks (permissions for the cashier and the partner, the
  opening and its replay, a lira order received against a dollar supplier, payments in both
  currencies and their moves, a replayed Pay, unknown place and zero refused, paying ahead, undo and
  undo twice, returns, a signed correction, the currency lock, the ledger history, the audit, the whole
  payroll month through advance / bonus / deduction / salary / undo, the derived pay day moving, the
  bell's month key, and the Reports figures), the real mirror against a faked `fetch` with 023 run and
  not run (ledgers skipped by name, employees retried without `pay_day`, only 023 named), and 76 in a
  browser (both editors, the pay hint in the other currency, "120,000" and "20,000" parsed as whole
  lira, the ledger drawer's undo, the month picker, the login list, the exports, Arabic at 390 with
  dialogs hit-tested, the cashier seeing neither tab). With them, the earlier suites re-run green on
  the same copy: 90 + 50 + 15 + 31 + 22.

### The month's statement

`server/lib/statement.js`, `GET /api/statement?month=YYYY-MM&tz=<minutes>` (`profit.read`; the cash
flow only with `money.read` as well), `js/statement.js` (global `Statement`, `data-pl`), the
**Statement** tab of the Money screen. No migration and no mirror file — it reads what is there.
**`DB.netProfit` is gone**: it summed the last 200 sales, added dollars to lira and costed them at
today's price list, and the Expenses tab's three profit cards were built on it. That tab now points
at the statement.

- **Profit and loss, per currency, over every row of the shop's month** (the month's two instants
  come from `tz`, as the dashboard's do): sales (non-voided, by the sale's time) + shipping charged
  on the invoice (`fee_mode = 'invoice'`) − returns (each return's own `due_minor`, by the return's
  time) = **takings**; − the cost of the goods (`sale_items.unit_cost`, which is in the sale's
  currency, less the cost of what came back) = **gross**; − expenses by category (voided ones are
  the `expense_void` moves) − salaries paid **for** the month (`salary_payments.month`, so an
  advance paid on the 28th for next month is next month's) − transfer fees ± count differences ±
  the exchange result = **net**.
- **The exchange result** is each exchange pair (`COALESCE(pair_id, id)`) valued in lira at the
  shop's rate at that moment: changing $100 for 13,500 when the rate is 130 made 500.
- **"≈ in lira" converts each row at the shop's rate at its own moment**, from the `fx_rates`
  history — never from `sales.fx_rate`, which is 1 for a dollar sale and so says nothing about lira.
  It is labelled approximate; the currency columns are the figures. `unconverted` counts rows that
  had no rate.
- **Below the line, never a cost:** what the owner took out or put in, suppliers paid (the goods
  are in the cost of goods already), Yalla Wear paid, and the salaries still owed for the month.
- **Printing is left out, and the page says so.** The till writes the print price onto the job
  (`print_jobs.price`), not into the sale, so the shop's print income is not in `sales` and adding
  Yalla Wear's bill as a cost would show printing as a pure loss. What was paid to them is listed
  below the line. **The `salaries` expense category still exists** (017's defaults): a salary
  entered there AND through the payroll is counted twice. The payroll is the place now.
- **`noCost`** counts pieces sold with no cost price — the gross is too high by them, and the page
  says so rather than guessing.
- **Cash flow** per place and currency: the balance before the month, every move in it by kind, the
  balance at its end. **This month's end is the Now tab to the unit**, and next month opens where this
  one closed — both are tested. Across all places a transfer adds to nothing.
- **Panels that fetch for themselves go stale after a write**, which reloads the shop but not them.
  `Shop.loadedAt()` is stamped on every load; the payroll and the statement refetch whenever what
  they hold is older than it (or half a minute old).
- **The dashboard** gains "Where the money is" (every place's total, opening the Now tab); with no
  shift open the drawer card shows the cash book's drawer — amber below zero — and a Close the day
  button, instead of "No shift open"; "owed to suppliers" opens the Suppliers tab, where they are paid.
  `moneyUsdRaw` prints "-$112.50", not "$-112.50".
- **Export** is one sheet with a Section column (profit and loss, not costs, cash flow) and a column
  per currency.
- **Verified**: 58 API checks, each a delta or an independent SQL sum (the copy carries the shop's
  real month): the three totals add up in both currencies, sales and returns equal their tables, a
  sale moves sales and cost and its void takes both back, lira and dollar expenses and a voided one,
  a fee, a short count, a profitable exchange, owner and supplier money leaving net untouched,
  salaries landing in their own month, the seams between months, refusals for a cashier, the
  partner, a bad month and a bad zone. 25 in a browser: the figures against the API, the month
  picker, a new expense appearing without a reload, the Expenses shortcut, the dashboard band,
  Arabic at 390 with the cash flow as cards, the export, the cashier without the tab.
