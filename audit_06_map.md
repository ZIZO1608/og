# OG System — the map of every connection

*Read this when a task touches anything that leaves the process: the cloud copy, a bot, a printer,
a phone, the panel. Started in audit 06 (19 Sep 2026); keep it current — a connection added
without a row here is a connection nobody will check.*

Every claim names its file. Line numbers are as of the audit and drift; the function names do not.
"None" under retry or timeout is a fact about the code, not an omission from this table.

## 1. The connections at a glance

| # | Connection | Lives in | Timeout | Retry / backoff | Guarded by | When it fails, a person sees |
|---|---|---|---|---|---|---|
| 1 | Browser → shop server (`/api/*`) | `js/api.js` (the only caller), `server/index.js` | see §3 | see §3 | session cookie + `requirePerm` | `API.friendly()` → `err_<code>` in the screen's language |
| 2 | HTTPS on the LAN | `server/lib/tls.js`, `lib/net.js`, `scripts/make-cert.js`, `scripts/trust-cert.js` | — | — | self-signed cert, `CA:FALSE` | browser's one "not private" warning per device; startup notice when the cert no longer names this address or expires in < 30 days |
| 3 | Live channel (SSE) `GET /api/live` | `server/lib/live.js`, `js/pulse.js` | heartbeat `: ping` every 25 s; `retry: 3000` | EventSource reconnects by itself; 45 s poll backstop while down | any of `print.read · partner.jobs · config.write · delivery.read · delivery.desk · stock.read` | the green dot beside the bubble goes grey; nothing else — data is refetched through the gated routes |
| 4 | Supabase PostgREST (the cloud copy) | `server/lib/supabase.js`, `mirror.js`, `sync-worker.js`, `lineage.js`, `drift.js`, `restore.js` | **30 s per request** (`TIMEOUT_MS`) | whole-run backoff 10 s → ×2 → 5 min; FK self-heal once; declared-lag column retry once; refused table skipped by name | service key in the env file; **the owner guard** (`Lineage.guard`) before every push | Settings → Advanced → Mirror fold, the bell (`mirror_denied`, rows waiting > 15 min), the panel's Connections row, `[mirror]` log lines |
| 5 | Supabase Storage (`product-images`) | `server/lib/storage.js` | 15 s / 15 s / 30 s (upload) / 15 s | none | service key; route `product.write` / `print.write` | 503 `storage_failed`, 400 `bad_image` / `too_large`; the product is saved either way |
| 6 | Telegram — both bots | `server/lib/telegram.js`, `telegram-commands.js`, `office-alerts.js`, `reminders.js` | send 8 s; long poll 25 s (35 s client deadline) | outbox `partner_events`: `min(3600, 5·2^attempts)` s, 12 attempts, honours `retry_after`, **403 drops the chat**; poll loop sleeps 5 s (60 s on 409) | tokens in the env file; the linked-chat list is the authorisation, then `Auth.can` per command | Settings → Telegram card (`queued` / `failed`), panel Connections (`getMe` only) |
| 7 | Web Push (customers only) | `server/lib/webpush.js`, `tracking.js` | 15 s | none; 404/410 deletes the endpoint, 8 other failures delete the row | vendor host allow-list, https:443 only; `OG_PUSH=0` off; `OG_PUSH_TEST_HOST` swaps to ONE local receiver | nothing — a customer's phone simply does not buzz; `push <status>` log line |
| 8 | og-track inbox (Supabase RPC, schema `track`) | `server/lib/inbox.js` | inherits 30 s | the next minute's pass is the retry | service key + this database's owner id (`p_lineage`) — Supabase refuses any other machine | `[inbox] not collected: …` once |
| 9 | Customer tracking page `/i/<token>` (+ `/live`, `/push`, `/review`, manifest, `/i/sw.js`) | `server/index.js` `handle()`, `lib/receipt.js`, `lib/tracking.js`, `lib/reviews.js` | — | page polls every 45 s without SSE | the 32-hex token is the only credential; SSE capped 12 per order / 600 total | its own "no such order" page (404), never the app |
| 10 | The website's door `/api/ext/*` | `server/index.js` pipeline | — | — | bearer `OG_WEB_API_KEY`, constant-time; **503 with no key set**, 401 wrong key | JSON error |
| 11 | Receipt printer | `server/lib/printing.js`, `lib/printer.js` | TCP 4 s; USB `copy /b` — see findings | none automatic; same `opId` really retries (`applied_ops` only on success) | `POST /api/print`, `sale.reprint` | 502 with `no_printer` / `printer_timeout` / `printer_unreachable` / `printer_write_failed`; every attempt in `print_log` |
| 12 | Label printer | `server/lib/labels.js`, `label-transport-tcp.js`, `agent/print-agent.js` | TCP 4 s; agent long poll 25 s | queue `label_print_jobs`, 10-minute lease with a claim token, expired leases requeued; agent backoff 1 s → 30 s | `label.print` | job status in the label history; preview offers "this computer's printer" |
| 13 | Browser printing (A4 invoice, handover sheet, exports, labels via browser) | `js/receipt.js`, `js/road.js`, `js/export.js`, `js/labels.js` | — | — | — | the browser's own dialog; recorded as `printed` (it cannot say whether paper moved) |
| 14 | Scanner — USB wedge, camera | `js/wedge.js`, camera module, router in `js/app-boot.js` | — | — | — | see §3 |
| 15 | Backups | `server/lib/backup.js`, `scripts/backup.js`, panel job | — | rename retry 5 × 250 ms | — | panel Connections row warns past 48 h |
| 16 | The panel (`127.0.0.1:8099`) | `panel/panel.js`, `panel/jobs.js`, `panel/ui/` | per-row deadlines, see §3 | — | boot-minted key on every request; `ask()` gate; developer sign-in | toasts from `event: refused`; Connections card |
| 17 | Panel ↔ server pipe (IPC) | `server/lib/panel-link.js` | stop: 8 s then `taskkill` | — | only the parent process can speak on it | — |
| 18 | Hardware checks | `server/scripts/hardware.js` | — | — | — | exit 4 (installable) / 1 (needs a person) / 0; never stops the shop opening |
| 19 | Login, sessions, throttle | `server/lib/auth.js` | session 14 days sliding | 8 failures / username / 15 min → 429 | scrypt; `HttpOnly SameSite=Lax`, `Secure` when HTTPS serves | `too_many_attempts`, `bad_credentials` |
| 20 | GitHub Pages / `dist/` | `.github/workflows/deploy.yml`, `make-deploy.ps1` | — | — | allow-lists; `_`-prefixed files stripped | the static site shows only "server is not answering" |
| 21 | WhatsApp | `js/whatsapp.js` | — | — | — | opens `wa.me` links only; nothing is sent by the server |

## 2. The server side, connection by connection

### 2.1 Supabase PostgREST — the cloud copy
- **Client** `lib/supabase.js`: `call()` (every request, 30 s `AbortSignal.timeout`), `select/insert/update/remove`, `rpc()` (schema through `Content-Profile`), `columns()` (OpenAPI, cached for the life of the process), `count()` (`HEAD` + `Prefer: count=exact`), `ping()`.
- **Push** `lib/mirror.js`: `fullRun()`, `pushChanged()`, `walk()`, `syncTable()` (cursor shape, replays `change_log`), `syncAppendOnly()` (above the highest id sent), `syncSettings()` / `wholeChanged()` (whole tables by content hash), `syncUsers()`. Batches of 500. Bookmarks: `loadCursors()` once at boot, `advance()` after a push that landed, `noteLocal()` → `sync_local`.
- **Triggers** `lib/sync-worker.js`: the commit hook (`DB.onCommit`, 2 s debounce), a 10 s tick, a full run every `OG_SYNC_MINUTES` (60); first run 20 s after boot and always full. One lane (`state.busy`).
- **Failure**: backoff 10 s → 5 min; a refused table (`403 permission denied`) is skipped BY NAME, its bookmark unmoved, the `GRANT` SQL put on the Connections card; a column the mirror lacks is retried once without it only when `mirror-lag.js` declares it.
- **The owner guard** `lib/lineage.js` — see `docs/supabase.md` and the Audit 06 section of `CLAUDE.md`. Asked before **every** push, by the sync CLI, the reconcile, the check and `users:mirror`.
- **Read back** only by the deliberate restore (`lib/restore.js` → `scripts/supabase-restore.js --wipe`, the panel's Restore job) and by the read-only tools (`supabase:check`, `supabase:drift`).
- **Routes**: `POST /api/sync/push`, `GET /api/sync/status` — both `config.write`.

### 2.2 Supabase Storage
`ensureBucket()` creates `product-images` public with a 2 MB limit and a jpeg/png/webp allow-list; `putObject()` uploads with `x-upsert` and a year of `Cache-Control`; `removeObject()` is housekeeping whose failure is swallowed (the row is what the shop reads). Callers: `POST /api/products/:id/image`, `POST /api/colours/:id/image`, `POST /api/print-jobs/:id/image`. Only the route writes `image_url`.

### 2.3 Telegram
`call()` → `api.telegram.org`, 8 s. `pollLoop()` long-polls each bot (unless `OG_TELEGRAM_OG_RELAY=railway` moves the shop's bot to og-track). `drain()` every 5 s takes ≤ 20 rows of `partner_events` (`attempts < 12`, `next_try_at <= now`); a muted target parks the row without bumping it; no subscriber marks it sent with the reason; 403 removes the chat; 429 sleeps `retry_after + 1`. Plain text, Arabic then English, no parse mode — so a name cannot break a message. `partner_events` is never mirrored.

### 2.4 Web Push
RFC 8291 + VAPID on `node:crypto`. `endpointOk()` refuses any host that is not FCM, Mozilla, WNS or Apple. Keys in `push_keys`; the public half is published to config `push.public_key` at boot. Subscriptions and `push_seen` are per machine and not mirrored. Caps: 10 per order, 20 000 in all.

### 2.5 The tracking page
`/i/<32 hex>` only; anything else under `/i/` is its own 404 and never falls through to `index.html`. Headers: `nosniff`, `DENY`, `Referrer-Policy: no-referrer`, `private, no-store`, `X-Robots-Tag: noindex`. `POST …/push` and `…/review` pass `originAllowed`. No address, phone, staff name, cost or transfer detail is rendered.

### 2.6 Printers
Receipt: bytes rendered in the browser (`js/escpos.js`), sent by the server over TCP :9100 or a Windows share (`copy /b`), every attempt logged to `print_log`. Labels: `enqueue()` → `label_print_jobs` → the agent (`GET /api/labels/next`, lease + token) or TCP. **A phone prints through the same two routes — the phone never touches a printer; the laptop does.**

### 2.7 Backups
`snapshot()` is `VACUUM INTO`; `verify()` reopens the copy and runs `integrity_check`, `foreign_key_check`, per-table counts and a must-have-rows list; `prune()` keeps the newest N `og-*.db`. See §5 for the schedule.

### 2.8 Login
Cookie `og_session`: `Path=/; HttpOnly; SameSite=Lax; Max-Age=14d`, `Secure` once HTTPS is actually serving. Constant-work password check for unknown users. Hourly `sweep()` of expired sessions and old attempts.

### 2.9 Headers
`securityHeaders()` in `lib/http.js` — the list is in the Audit 06 section of `CLAUDE.md` and is asserted by `_nightshift/audit06/p5-headers.mjs`.

## 3. The browser and the panel

### 3.1 `js/api.js` — the only file that talks to the server
One attempt per call, **15 s** (`TIMEOUT_MS`, `AbortController`), same-origin with the cookie. Errors become `ApiError(code, message, status)`: an abort is `timeout`, any other rejected fetch is `offline`, a non-OK answer carries the server's `code`. `API.friendly(err)` reads `err_<code>` in the screen's language, then its own table, then the server's sentence. **A 401** calls `Auth.lostSession()`: the sign-in gate is mounted OVER the page, nothing is reloaded, a half-typed dialog is still there underneath, and a successful sign-in calls `refreshAll()`. `API.ping()` asks `/api/health` and answers `up | none | down`; `navigator.onLine` is not used.

### 3.2 `js/pulse.js` — the live channel
`new EventSource('/api/live')` for anybody who may hold it. Reconnection is the browser's own, on the server's `retry: 3000`. A **45 s poll** (`GET /api/partner/pulse`) and a `visibilitychange` tick are the backstop. A `refreshing` event covers the tab; the next `hello` (only a fresh server can send one) hard-refreshes it, and so does 90 s of silence. When the line drops, the dot beside the bubble greys; a poll that fails says nothing (a missed beat is not news) — the first thing a person hears is the refusal of their next write.

### 3.3 `js/shop.js`
`Shop.load()` fires every boot request in parallel, each gated on `Auth.can`; only `forbidden` is swallowed. `Shop.write(send, mirror, done, fail)` is **one write at a time** — a second write while one is in flight returns `false` and is dropped, which is why a scanner-driven panel collects first and commits once. `Shop.fail(err)` replaces the page with the reason the shop could not load and how to fix it.

### 3.4 The service worker (`sw.js`, `js/update.js`)
Cache-first with `ignoreSearch`. **Never cached:** anything under `/api/` or `/i/`, any non-GET, anything cross-origin. A new worker waits; `Update` applies it when nobody is mid-anything (no overlay, no modal, no drawer, no open basket) and reloads the tab once.

### 3.5 Scanners
- **USB wedge** `js/wedge.js`: a burst is a scan when it is at least 4 characters with a **median** gap of 35 ms or less and ends in Enter; a pause over 500 ms resets the buffer. **A scanner with no Enter suffix is silent** — there is no idle flush. It reads `e.key`, so on the Arabic layout the letters of a code are replaced and the digits survive; the order desk, the handover sheet and the Products search match on digits for that reason.
- **Camera** `js/scan.js`: `BarcodeDetector`, then its own EAN-13 line reader, then a photo input. Needs a secure context. `sc_denied` / `sc_nodevice` / `sc_failed` / `sc_no_camera` are the four sentences.
- **Who owns a scan**, first match wins (`js/app-boot.js`): Settings' hardware test box → the palette → the label picker → move-by-scan → the order desk → the handover sheet → the shelf map → the Products search → (700 ms duplicate window) → the scan result's primary button → `handleScan`.
- **An unknown code** opens `openUnknownCodeModal`: it offers to ATTACH the code to an existing size. There is no "add as a new product" door (audit 06, a suggestion).

### 3.6 What prints where
| What | Path |
|---|---|
| Sale receipt, gift slip | the browser builds ESC/POS (`js/escpos.js`) → `POST /api/print` → the laptop's printer |
| Product labels, "label printer" | `POST /api/labels/print` → queue → agent or TCP |
| Product labels, "this computer" · shelf labels | `window.print()`, then `POST /api/labels/record` (an audit row only) |
| A4 invoice · handover sheet · exports · calibration sheet | `window.print()` |

A failed receipt toasts the printer's own code plus "try again"; the retry carries the **same `opId`**, so a replay is one print on the server's account. A phone prints a receipt through the laptop; it prints a label either through the laptop or, with the "this computer" chip, through the phone's own print dialog.

### 3.7 The panel
Binds `127.0.0.1` only; every request carries the key minted at boot. `POST /act` answers first and acts after, so every refusal comes back as `event: refused`. `ask()` lets through `PUBLIC_ACTIONS` (start · stop · restart · refresh · open · who · lock · unlock · connections · devstate) and the jobs marked `public`; everything else needs a **developer** sign-in (`devAuth`: 8 failures / 15 min, 700 ms per refusal, idle lock 15 min). Danger words are checked in `runJob`, not only in the window.

**Connections** (`checkConnections` → `checkOne`, each under a 70 s outer deadline; a row that did not run says `skip`):

| Row | Probe | Deadline |
|---|---|---|
| server | `GET /api/health` on this machine | 1.5 s inside 5 s |
| https | `trust-cert.js --check`, `TLS.daysLeft()`, `TLS.uncovered()` | 15 s |
| receipt · label · scanner | one `hardware.js --json` for all three | 60 s |
| mirror | the worker's own state over the pipe — off · **not the shop** · denied (with the GRANT SQL) · offline · live | — |
| tg_og · tg_yalla | `getMe` only — nothing is ever sent | 6 s |
| push | is there a VAPID pair | — |
| internet | `https://www.gstatic.com/generate_204` | 5 s |
| backup | age of the newest copy; amber past 48 h | — |
| vault | is `OG_VAULT_KEY` set | — |

**Jobs** (`panel/jobs.js`): `push` · `pull` · `deploy` (dev) · `backup` · `preflight` · `createuser` (shop) · `hardware` · `hardwareInstall` · `testPrint` · `testPrintDry` (public) · `cert` (danger) · `certTrust` (machine) · `mirrorCheck` · `mirrorDrift` · `mirrorSync` (shut) · `mirrorReconcile` (shut, danger) · **`restore`** (shut, danger `RESTORE`, closes and reopens the shop around itself — the disaster restore, and the only thing that changes the mirror's owner).

### 3.8 Deploy
`.github/workflows/deploy.yml` and `make-deploy.ps1` copy exactly `index.html · manifest.webmanifest · sw.js · robots.txt · .nojekyll · css/ · js/ · assets/` and strip every `_*` file. `server/`, `panel/`, `agent/`, every `.env*`, `data/` and `backups/` are never copied. The two lists are kept in step by hand.

### 3.9 The print agent (`agent/print-agent.js`)
Signs in with the account in the gitignored `agent/agent-config.json`, holds the cookie in memory, long-polls `GET /api/labels/next`, prints with `copy /b` to the Windows share, reports done or failed. Backoff 1 s → 30 s; a 401 signs in again.

## 4. Every HTTP route
Generated, not typed: `node _nightshift/audit06/routes.mjs`. The table is at the end of this file.
