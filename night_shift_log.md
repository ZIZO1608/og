# Night Shift 01 — 2026-09-17, 01:07 → 12:20
Folder: D:\DESKTOP\OG System Demo · Branch: night-shift-01 · Backup: `server\backups\og-2026-09-16T22-04-18-511.db` (1,216,512 bytes, `PRAGMA integrity_check` = ok, re-checked 01:20) · Worktree removed: yes (`D:\og-night-01` held only an untracked 114-byte `NIGHT_SHIFT_01.md`; `git worktree remove --force` + `prune`, folder gone)

Owner's pre-existing uncommitted changes (not committed by me): 101 paths at 01:08, **5 of them already staged by the owner** (`.serena/.gitignore` D, `.serena/project.yml` D, `assets/fonts/Cairo-700.ttf` A, `assets/yalla-mark.svg` A, `assets/yalla-wear.svg` A). The full list is in `_nightshift/prestatus.txt`; the exact content of every one of them is preserved as a commit object that is on no branch: **`refs/nightshift/owner-baseline` = `a274f47`** (made with a throw-away index file, so neither the real index nor the stash was touched). `git diff 503f0b2 a274f47` is exactly the owner's work as it stood when the night started. See "Decisions" for how files the owner AND I both changed are committed.

Sandbox: port **8190**, `OG_ENV_FILE=server/.env.sandbox`, `OG_DATA_DIR=server/data-sandbox` (both new, see Stage 0), a copy of the verified backup — **older than the shop's own database**, which is fine for testing.
Isolation proof (01:23):
- `GET /api/sync/status` → `{"configured":false,"mode":"off", … "pull":{"reason":"disabled","message":"Boot pull is off (OG_PULL_AT_BOOT=0)."}}`
- startup print: `database : D:\DESKTOP\OG System Demo\server\data-sandbox\og.db`, `listening : http://localhost:8190`, `Supabase: not configured — running on local SQLite only.`
- Telegram: `og bot could not be reached — Unauthorized: invalid token specified` (same for yalla) → the bots never start, so no `getUpdates` long-poll; the copy's `telegram.og_chats` ids replaced with fake negative ids, `telegram.og_chat_id` = `-900000000`.
- Web Push: `OG_PUSH=0` and `push_subscriptions` emptied in the copy (7 rows → 0).
- `server/data/og.db` mtime `2026-09-17 01:08:46.2155828 +0300` (it last changed 4 minutes after the backup was taken; no shop server was running on this laptop when the night started — nothing listened on 8090/8443/8099, the only node.exe was Adobe's). This is the baseline the final pass compares against.
- `server/.env.sandbox` holds no Supabase key and a throw-away `OG_VAULT_KEY` generated tonight.

Baton on this laptop (read-only check): **probably yes, not verified against Supabase.** The backup's `config['sync.lineage']` is `7aa291b1-…`, and the memory notes say this laptop took the mirror over on 2026-09-13. Asking the mirror would be a network read with the real key, which the fence rules out, so it was not asked. Note: the sandbox copy carries the same lineage id — harmless only because the sandbox has no Supabase at all.

## Status
| Edit | DONE / PARTIAL / NOT DONE | Verified how (screens, languages, widths) | Commit |
|---|---|---|---|
| Stage 0 | DONE | isolation proof above | eaacf4c |
| E5 | DONE | `_nightshift/e5.mjs`: title and page text in EN+AR × 1366 and 375 (8/8); screenshots `e5-*.png` | 750b528 |
| E3 | DONE | `_nightshift/e3.mjs` 60/60: server refusals (past, non-date), every field dressed, white icon, whole field opens, hit-test over a modal, sheet only at 375, RTL, keyboard (arrows mirrored, PgUp/PgDn, Esc keeps the modal), outside tap, PO saved → reload keeps the date → list column → WhatsApp composer opens (nothing sent); Reports custom range fires its handler. EN+AR × 1366 and 375; `e3-*.png` | 702f5d9 |
| E4 | DONE | `_nightshift/e4.mjs` 38/38: server rules (dup EN / dup AR / missing name / switched-off / unknown refused, never deleted, website feed carries both names, every product has a category), till chips, Settings fold (browser refusal, add, stays open, switch saves at once), products filter — EN+AR × 1366 and 375; Arabic login screen; `i18ncheck.mjs` | 569c1bf |
| E7 | DONE | `_nightshift/e7.mjs` 25/25 (twice): one job (tick, untick, re-tick, issue, server holds exactly it, screen total = server total, SYP, visible after reload) at 1366 EN; two jobs at 375 AR (hit-tested); a job invoiced behind the tab's back → the server's 409 reason toasted, the local guess removed; select-all (header box and button) at 1366 AR; nothing left to bill; OG's side sees all four; a tick box in any other dialog works and the backdrop still closes. Throw-away partner `nightcheck-partner` on the sandbox only. | ffd3701 |
| E1 | DONE | `e1mig.mjs` (the migration on a clean copy and on a sabotaged copy); `e1api.mjs` 19/21 by the API — the two misses were my test hitting route names that do not exist, and the same facts were then read from the database (five opening "received" movements; `Black / أسود` frozen on the sold line); `e1ui.mjs` 37/38 → the one miss (sideways scroll at 375) was an older tab-row bug, fixed and re-measured: the form (palette, steppers, typing keeps focus, never below zero, empty-colour warning, nothing lost, remove asks), save, the drawer matrix (read-only), add a colour and add a size from the drawer, the till picker (two colours → sheet, hit-tested, Black into the cart and named; one colour → straight in; Escape → nothing), move-by-scan asks over its own panel, 375 AR (palette names, bottom sheet, Arabic matrix), a Black sale frozen and named on the invoice. EN+AR × 1366 and 375. | 8e7afca |
| E6 | DONE | `users:rebuild` dry run → `--apply` on the sandbox (10 created, 10 removed, guard ✓, manager 31 → 22, a second dry run finds nothing); the guard broken twice on a second copy (`server/data-sandbox2`: no shop at the URL; a shop that refuses abode) — only `abode` was added, nothing else moved; `e6api.mjs` 32/32 (Wael refused money → owner opens it → Wael sees it on his next request → closed again; a deny and a reset; members add a product with cost, cannot reach Settings/money/Access by hand-sent requests; partner grants refused 409; pinned refused; self-switch-off refused; add a person, password once, reset kills the old one; no pw_* field in any answer); `e6ui.mjs` 48/48 (Access fold in EN+AR × 1366 and 375, switches hit-tested, saved and marked, Back to the role, password shown once, owner's pinned switch locked with a reason, role homes and menus); `preflight` clean about accounts; `users:mirror` dry run | 288fe31 |
| E2 | DONE | `e2.mjs` 61/61: API (rate, errand + parcel for safeer1, his scope, safeer2 404 on read and write, forward-only status, failed needs a reason, today +2 and earned = count × rate, cash from the road, Wael sees tasks and no money until the owner opens money.read, adding and switching off a safeer, Wael cannot add a login) and the browser (team + tasks in EN+AR × 1366/375, new errand with the date picker, an offline save stays open and says "connect to the shop wifi", Wael's page has no money, safeer2's phone in EN+AR: only his card, the area named, Out → Done offered, Failed with a reason) | cc3a395 |
| E8 | DONE | a test panel on 8199 over the sandbox: `e8api.mjs` 90/90 (every hand-sent locked action refused, cashier and owner refused on both paths, the developer let in, danger words enforced in `runJob`, every job run or verified — table below, connections, reveal, reset ending the old session, restart / full refresh / stop, the window closing locks it, the leak search), `e8idle.mjs` 6/6 (idle lock with the idle time shortened, throttle), `e8ui.mjs` 175/175 (the window over CDP in EN+AR × 1100×760 and 375×760: boot mid/end, Shop screen, a failing connection, the lock, Tools/Log/Connections/Accounts/This machine, a reveal, a reset, a failed boot, reduced motion, every confirm hit-tested, no sideways scroll, 76 screenshots) | 7903243 |
| Final pass | DONE | (1) `sw.js` CACHE **og-system-v253** (bumped by the Full refresh tests; nothing under `css/`/`js/` changed after); the six new files (`datepick`, `catset`, `colourpick`, `colourform`, `access`, `safeers`) are all in the precache list and load in `index.html` before every `app-*` file that uses them. (2) Sandbox restarted on the final code; every touched screen walked again in EN+AR × desktop and 375: `e5` 8/8, `e3` 60/60, `e4` 38/38, `e7` 25/25, `e1ui` 38/38, `e6ui` 48/48, `e2` 61/61, `e6api` 32/32; the test panel: `e8api` 90/90, `e8ui` 175/175, `e8idle` 6/6 — screenshots `_nightshift/shots/final/` (52) and `shots/e8/` (76). (3) i18n: 2,955 keys each side, 0 missing, 0 left in English; panel 319 each side. (4) sandbox `npm.cmd run preflight` → exit 3, its own "the shop is already open here" (re-run after the last rebuild: 236 permission names OK, 12 accounts can sign in, 3 owner/developer can open Access, 14 sellable products — the extras are test products); `npm.cmd run supabase:drift` → `✗ Supabase is not configured`, exit 1 — the sandbox has no Supabase by design and the fence forbids the real one, so the real drift check is morning step 2. (5) `git status`: nothing of mine uncommitted; 55 lines remain, all yours from before the night (the 5 you had staged still staged, `panel/package.json` still untracked). (6) `server/data/og.db` mtime **2026-09-17 01:08:46.2155828 +03:00** = the baseline, 1,232,896 bytes; nothing in `server/data/` newer than that; nothing listened on 8090 / 8443 / 8099 at any check. (7) this log. Sandbox accounts: `users:rebuild --apply` run twice (the second proving the owner's password is kept), a last dry run shows nothing to create, fix or remove — exactly your twelve plus the hidden Former staff. | the last commit on `night-shift-01` |

## Decisions I made (and why)
- **The prompt arrived truncated** at 50,000 characters ("→ the E1 migrati"). `NIGHT_SHIFT_01.md` is everything that arrived, verbatim, plus a note at the top saying so (50,718 bytes). The morning checklist is completed from the rest of the file.
- **Files the owner and I both changed are committed whole.** 101 files carry the owner's uncommitted work, including `CLAUDE.md`, `sw.js`, `server/index.js` and most of `js/`. Committing only my hunks (by patching the index) would leave those files dirty and different between `night-shift-01` and `main`, and then the morning's `git checkout main` would refuse to run at all. Committing them whole means their working copy equals the branch, so the checkout and the merge work. The cost is that those commits also carry the owner's pending edits in those files. The exact pre-night state is kept at `refs/nightshift/owner-baseline` (`a274f47`), so `git diff a274f47 night-shift-01 -- <file>` shows only my part. Files I never touched are never added, and the owner's 5 staged files stay staged: every commit is `git commit -- <paths>`, which commits only the listed paths.
- **Two dev-only switches** were added so the sandbox cannot see the real files: `OG_ENV_FILE` replaces `server/.env` outright (the real file is never opened), and `OG_DATA_DIR` moves the database, backups and certificate. Relative paths are read from the repo root. Both must be real environment variables. Every script that defaulted to `server/data/og.db` now asks `dbFile()` in `lib/env.js`.
- **E5:** the screen is "Cashier" / "الكاشير" (`nav_pos`, `pos_title`, the palette group `pg_till`, `open_till`, the empty-board hint, the manifest shortcut). The **role** keeps its own label, "Cashier" / "كاشير" (indefinite in Arabic), because in the roles grid it names a person, not a screen; in English the two words are now the same, and they never appear side by side as two different things (the cashier's home header reads "Cashier · My sales today"). Code ids, `#pos`, `POS`, classes and the `cashier` role id are unchanged. The panel never said "Point of Sale", so it needed nothing.
- The harness bypasses the service worker (`Network.setBypassServiceWorker`) — the first E5 run failed on desktop only because the old cached `app-i18n.js` answered.
- **E3 — the PO had no due date at all.** Neither the reorder dialog nor `purchase_orders` carried one, so "pick a due date, save, reload" could not be done. Added `purchase_orders.due_date` (YYYY-MM-DD, migration **056**, mirror file **024**, declared in `mirror-lag.js`), `Purchasing.cleanDue` (refuses `bad_due` / `due_past`, with 36 h of slack for the clock), a Due field (min = today) in the reorder dialog, a Due column with a "late" badge in the PO list, and the bell: an order with a due date is late the day after it (`po_overdue`), one without keeps the old 14-day rule. The 14–42-day `po_late` Telegram reminder is unchanged.
- **E3 — DatePick keeps the native input** (SelectBox's rule): read-only, transparent, wrapped in a `div.dp-wrap` with a face that says the date through `fmtDate`; a pick writes ISO back and fires `input` + `change`, so no call site changed. A MutationObserver dresses every date field, now and later (10 fields today: PO due, Reports from/to, cash book from/to, expense date, print-job deadlines ×2, Yalla's promise date, supplier due, employee since). **The week starts on Saturday** in both languages (the shop's week ends on Friday). z-index 960, beside SelectBox's 950.
- `API.friendly()` now says `err_<code>` in the screen's language when the app has that string, before its English fallbacks.
- **E4 — where categories lived:** nowhere on the server. `products.type` held a slug (`sneakers`), and the names and size runs were two hardcoded objects in `js/data.js` (`TYPE_LABELS`, English only, and `SIZE_SETS`); the Arabic words existed only as `ty_*` keys that the shelf map alone used. Now a `categories` table (057) **keyed by that same slug**, so no product changed: before the migration the sandbox had 8 products over 4 distinct types (boots 1, jerseys 2, sneakers 3, tshirts 2); after it, 8 categories (the old eight, seeded) and the same 8 products on the same 4 ids — none unknown, none lost. A type the seed does not know would have been carried over under its own spelling. No foreign key (it would mean rebuilding `products`): `Categories.assertUsable` runs on every product create and type change. Mirror shape **whole** (in `WHOLE_KEYS`, `syncSettings` behind its own guard, restore `ORDER` + `SEEDED`, drift `PUSHED`, check `WHOLE`), file **025**.
- **E4 — the browser keeps `DB.typeLabels` / `DB.sizeSets`** as the objects every screen already reads, refilled in place with the current language's names on hydrate and on every language switch; `DB.activeTypes()` is what a filter or form offers (switched-off ones leave the till and the add form, but a product already in one keeps it in its editor). The till's chips show only categories with something on sale; the till's search matches either language's name. A category an owner adds gets a derived dark hue, away from the reserved green/amber/red/lime.
- **E4 — the login screen was English for everybody.** It read `localStorage['og.lang']`, which nothing ever wrote. `applyLang()` writes it now, the app opens in it, and every string on the gate is in both languages.
- **E1 — the printed code is shared per product AND size**, so `variants.barcode` and `label_code` lost their UNIQUE, and SQLite can only drop an inline UNIQUE by rebuilding `variants` (five tables reference it). The migration runner gained two small, opt-in switches (`lib/migration-checks.js`): foreign keys off around that one migration (SQLite's own rebuild procedure — otherwise DROP TABLE cascades into `stock`) with a check that no new broken reference appeared, and a JavaScript before/after stock check that rolls back and names the product.
- **E1 — one colour draws as before.** The colour is named only where there is a choice: `DB.variantLabel`, and `sale_items.colour` / `colour_ar` are frozen only for a product with more than one colour. Existing products got one colour, "Standard / أساسي", because none had a colourway.
- **E1 — SKUs:** the first colour keeps `OG-050-42`; later colours are `OG-050-C2-42`. No existing SKU changed.
- **E1 — a colour name may be given in one language only; the other copies it.** With a single colour the names may be blank (it becomes "Standard"); with two or more every colour needs a name.
- **E1 — ColourPick has its own overlay layer** rather than `openModal`, because opening a modal closes the one underneath, and a scan in move-by-scan or the delivery office would have closed its own panel.
- **E1 — Not done: the label does not print the colour name.** The code on a sticker is shared by every colour on purpose, and the preview/TSPL layout was left alone ("may print" — optional).
- **E1 — found on the way:** `Cat.remove` checked a table called `po_lines`, which does not exist; its try/catch hid it, so a product on a purchase order was not refused and would have died on a foreign key. It now asks `purchase_order_lines`. And the warehouse tab row scrolled the whole page sideways on a phone (`max-width` added).
- **E6 — the sealed box never held a password.** `pw_enc` seals the password HASH at sync time; nothing could ever read a password back from it. The developer panel's Accounts screen needs one, so 059 adds `users.pw_box` (the password sealed with `OG_VAULT_KEY`), written by `createUser`, `changePassword` and `resetPassword`, carried to the mirror only inside `pw_enc`. **Accounts made before tonight have no `pw_box`** — `zaven` and `zohrab` among them, whose passwords the owner said to leave alone — so the panel shows them as "not readable" with a Reset button, which is the prompt's own fallback.
- **E6 — the manager's new default is applied by `users:rebuild`, not by 059.** 059 runs when the shop laptop first starts the new code, before any owner account exists; taking Settings away from every manager at that moment would leave nobody who could open it.
- **E6 — Former staff is recognised by its username** (`former-staff`, `former-staff-<old>`), not a new column, so the mirror's `users` table needed only its role check changed. Its role is `cashier`, so it can never appear in a driver or partner list either.
- **E6 — `users:mirror` sends a mirror-only account's history to the local account with the same username** when there is one (a second install's `ahmad` would otherwise block the real `ahmad` on the username index), and to Former staff otherwise.
- **E6 — passwords are `Xxxxx-Xxxxx-9999`** (15 characters, no look-alike letters), readable over a counter.
- **E6 — sandbox leftovers:** the tests added `nighttemp…` and `nightui…` accounts on the sandbox; the final pass re-runs `users:rebuild --apply` there to remove them.
- **E2 — areas are a config list** (`safeer.areas`): `delivery.prices` is empty on this shop, so there were no Aleppo areas to reuse. 060 seeds eight real districts (New Aleppo, Al-Furqan, Mogambo, Al-Sabil, Al-Aziziyah, Al-Shahba, Al-Jamiliyah, Al-Muhafaza) for the owner to edit. A parcel's "area" is its own city/address — the delivery's `fee_mode` and price list are untouched.
- **E2 — the week starts on Saturday** for "earned this week", like the date picker.
- **E2 — the safeer's own view is his existing run list** (parcels, with the board's own buttons) with his errands underneath as big cards, not a second screen.
- **E2 — found on the way:** removing an account re-pointed its *waiting* parcels to Former staff, who cannot carry anything. They now go back to nobody (errands too). The sandbox still shows three parcels assigned to Former staff from before that fix — sandbox only.
- Sandbox test logins live in `_nightshift/sandbox-logins.txt` (gitignored, sandbox only). `nightmgr` (manager) was created for testing and will be removed by the E6 rebuild like any other account not on the list.

## Every 'manager' literal and what I decided
| Where | Decision |
|---|---|
| `server/lib/auth.js` `ROLES` / `PINNED` | `owner`, `developer` added; the pins moved from manager to owner + developer, with `access.write` |
| `server/lib/restore.js` — "an active manager's box must open" before the boot pull wipes | owner and developer count too (the new real accounts are owner/developer, so the manager-only rule would have refused every pull) |
| `server/lib/telegram.js` `PRESET_ROLES` | owner and developer added; 059 seeds their presets from the manager's |
| `server/lib/telegram.js` `personPerms: Auth.permissionsFor(u.role)` | now `permissionsForUser(u)` — the per-person switches reach the chat gate too |
| `server/index.js` Telegram office grid `for (r of ['manager', …])` | owner and developer added |
| `server/index.js` `PUT /api/roles/:role` | editing the owner/developer rows needs `access.write` |
| `server/scripts/createuser.js` suggested first role | `owner` |
| `server/scripts/preflight.js` | new line: at least one active owner/developer |
| `js/app-shell.js` `roleLabel` | Owner / صاحب المحل, Developer / مطوّر |
| `js/app-routing.js` `VIEWS.dashboard` chooser | unchanged — owner/developer fall through to the full dashboard, as the manager does |
| `role === 'delivery'` scoping (index, deliveries, customers, alerts, pulse) | unchanged — a driver-only rule |
| `panel/ui/panel.js` `ROLES` / role labels | owner and developer added to New account and to the Accounts screen's labels |
| `server/index.js` `retired_account` notice, `preflight` retired list | unchanged — still names the old five if any is active |

## Bugs hit and how I fixed them   (error → cause → fix → retries)
- E7: the new server guards seemed not to work → the "restart" had failed with EADDRINUSE: TaskStop killed the wrapper shell, not the sandbox node, so the old server kept answering → `_nightshift/sb-stop.ps1` stops only the node.exe listening on 8190 (checked it was the sandbox's `node index.js`; nothing listened on 8090/8443) → 1 retry.
- E7: the refusal check was flaky → the browser's POST sat unsent behind connections held by earlier page loads in the same tab → each step gets a fresh tab → 2 retries.
- Heredocs containing backticks broke the Bash tool's parser twice → patches are written as files and run with node.
- E8: my own test runs tripped the unlock throttle twice (eight refused sign-ins inside 15 min across runs → even the right password refused `too_many`) → the throttle working; the test panel is restarted between runs → 2 retries.
- E8: the sign-in dialog would not open in the test → a toast in the top corner sat over the bar's Developer button → toasts moved below the bar → 1 retry.
- E8: "a dev event said unlocked" failed → the test read the event list before the stream delivered the frame → it waits for it → 1 retry.
- E8: the window test hung at the end → closing the fake port holder waited for the panel's open probe socket → the test destroys its sockets → 1 retry.
- Final pass: **re-running `users:rebuild --apply` gave the owner a new password every time** (the lockout guard signed in by resetting abode) → it now signs in with abode's sealed password when this machine can read it and it still matches, and resets only when it cannot; proved on the sandbox (a second run: guard ✓, `new pw : —`, abode still signs in with the recorded password) → fixed in `server/scripts/users-rebuild.js`, committed with the final pass.
- Final pass: E1's "add a size from the drawer" clicked the button while the drawer was still redrawing after the first save → the test waits for the dialog → 1 retry. E1's save also met the duplicate-product question, because earlier runs left similar test products → the test answers it.
- Final pass: E7 had nothing left to bill (its own last step bills everything) → `_nightshift/e7setup.mjs` made five finished jobs P-1035…P-1039 on the sandbox (owner orders, the test partner accepts and finishes) → 1 retry.
- Final pass: five older suites failed at sign-in → they used `nightmgr` and `nightcheck-partner`, removed by the E6 rebuild → they sign in as `abode`, and a new throw-away `nightcheck-partner` was made on the sandbox (removed again by the last rebuild) → 1 retry.
- E3: every date refused as `bad_due` → a heredoc ate the backslashes in `/^d{4}…/` → fixed with Edit, sandbox restarted → 1 retry.
- E3: the test's "Escape keeps the dialog" failed → the harness clicked at coordinates taken before `scrollIntoView` moved the dialog, so it pressed the backdrop → recompute the point before each press, `block:'nearest'` → 1 retry.
- E3: a run hung → four tabs left by failed runs each held an SSE stream (six per host) → `closeall.mjs`, and the harness now closes its tab on any uncaught error → 1 retry.
- E3: the face read "PICK A DATE" and the native "/ /" showed through → `.field > span` styled the wrapper, and the datetime-edit text part kept its colour → wrapper is a div, all three edit parts at opacity 0; Today lost its lime to og-skin's `.btn` → an og-skin rule for `.dp-today`.

## Files changed per edit
- E8: `panel/panel.js`, `panel/jobs.js`, `panel/ui/index.html`, `panel/ui/panel.js`, `panel/ui/i18n.js`, `panel/ui/panel.css`, `server/index.js` (the `resetpw` pipe message), `server/lib/http.js` (the password guard), `server/scripts/hardware.js` (`--json`), `sw.js` (v253, bumped by the Full refresh tests), `CLAUDE.md` (the launcher section). `OGSystem.cs` / `build-exe.ps1` untouched, so no rebuild. `panel/package.json` is yours (untracked before the night) and was left alone.
- E2: `server/migrations/060_safeers.sql`, `server/supabase/028_safeers.sql`, `server/lib/safeers.js` (new), `server/lib/people.js`, `server/lib/auth.js`, `server/lib/mirror.js`, `server/lib/restore.js`, `server/lib/drift.js`, `server/scripts/supabase-reconcile.js`, `server/index.js`, `server/supabase/CATCH-UP.sql`, `js/safeers.js` (new), `js/app-shell.js`, `js/app-routing.js`, `js/deliveries.js`, `js/pulse.js`, `js/app-settings.js`, `js/app-i18n-extra.js`, `css/warehouse-settings.css`, `index.html`, `sw.js` (v248), `CLAUDE.md`
- E6: `server/migrations/059_access.sql`, `server/supabase/027_access.sql`, `server/lib/people.js` (new), `server/scripts/users-rebuild.js` (new), `server/scripts/users-mirror.js` (new), `server/lib/auth.js`, `server/lib/credvault.js`, `server/lib/migration-checks.js`, `server/lib/mirror.js`, `server/lib/restore.js`, `server/lib/drift.js`, `server/lib/telegram.js`, `server/index.js`, `server/scripts/supabase-check.js`, `server/scripts/preflight.js`, `server/scripts/createuser.js`, `server/package.json`, `server/supabase/CATCH-UP.sql`, `js/access.js` (new), `js/app-settings.js`, `js/app-shell.js`, `js/app-i18n-extra.js`, `css/warehouse-settings.css`, `index.html`, `sw.js` (v247), `CLAUDE.md` (Accounts)
- E1: `server/migrations/058_colours.sql`, `server/supabase/026_colours.sql`, `server/lib/migration-checks.js` (new), `server/lib/db.js`, `server/lib/catalogue.js`, `server/lib/sales.js`, `server/lib/orders.js`, `server/lib/deliveries.js`, `server/lib/printing.js`, `server/lib/alerts.js`, `server/lib/stockwatch.js`, `server/lib/storage.js`, `server/lib/mirror.js`, `server/lib/mirror-lag.js`, `server/lib/restore.js`, `server/lib/drift.js`, `server/scripts/supabase-reconcile.js`, `server/scripts/purge-demo.js`, `server/index.js`, `server/supabase/CATCH-UP.sql`, `js/colourpick.js` (new), `js/colourform.js` (new), `js/data.js`, `js/shop.js`, `js/app-util.js`, `js/app-boot.js`, `js/app-customers-scan.js`, `js/pos.js`, `js/app-warehouse.js`, `js/stock.js`, `js/desk.js`, `js/road.js`, `js/receipt.js`, `js/app-documents.js`, `js/deliveries.js`, `js/app-export.js`, `js/app-actions.js`, `js/app-products.js`, `js/app-i18n-extra.js`, `css/inputs-dashboard-pos.css`, `css/warehouse-settings.css`, `css/og-skin.css`, `index.html`, `sw.js` (v246), `CLAUDE.md` (the night-shift section)
- E7: `js/app-boot.js`, `js/ylinvoice.js`, `server/lib/partner.js`, `server/index.js`, `js/app-i18n-extra.js`, `css/yalla-scan.css`, `sw.js` (v244)
- E4: `server/migrations/057_categories.sql`, `server/supabase/025_categories.sql`, `server/lib/categories.js` (new), `server/lib/catalogue.js`, `server/index.js`, `server/lib/mirror.js`, `server/lib/restore.js`, `server/lib/drift.js`, `server/scripts/supabase-check.js`, `js/catset.js` (new), `js/data.js`, `js/shop.js`, `js/app-routing.js`, `js/app-state.js`, `js/auth.js`, `js/pos.js`, `js/app-products.js`, `js/app-print-labels.js`, `js/app-warehouse.js`, `js/shelfmap.js`, `js/app-settings.js`, `js/app-i18n-extra.js`, `css/warehouse-settings.css`, `index.html`, `sw.js` (v243)
- E3: `js/datepick.js` (new), `index.html`, `sw.js` (v242, precached), `css/inputs-dashboard-pos.css`, `css/og-skin.css`, `js/api.js`, `js/app-i18n-extra.js`, `js/app-customers-scan.js`, `js/app-actions.js`, `js/app-warehouse.js`, `js/data.js`, `server/lib/purchasing.js`, `server/lib/alerts.js`, `server/lib/mirror-lag.js`, `server/migrations/056_po_due.sql`, `server/supabase/024_po_due.sql`
- E5: `js/app-i18n.js`, `manifest.webmanifest`, `sw.js` (v240 → v241)
- Stage 0: `.gitignore`, `NIGHT_SHIFT_01.md`, `night_shift_log.md`, `server/lib/env.js`, `server/lib/tls.js`, `server/lib/backup.js`, `server/index.js`, `server/scripts/{backup,createuser,hardware,mirror-drift,preflight,purge-demo,supabase-check,supabase-reconcile,supabase-restore,supabase-sync,test-print,warehouse-one-room}.js`

## New migrations + Supabase files (in order)
- 060_safeers.sql ↔ 028_safeers.sql — `errands`, `safeer.*` permissions, `safeer.rate`/`safeer.areas` config
- 059_access.sql ↔ 027_access.sql — the two role checks, `user_permissions`, `users.pw_box`/`last_login_at` (local only). **027 before `users:mirror`.**
- 058_colours.sql ↔ 026_colours.sql — `product_colours`, `variants.colour_id`, the shared-code constraints dropped, `sale_items`/`order_return_lines` colour (then `supabase:reconcile`). **026 must be run before the shop runs the new code.**
- 057_categories.sql ↔ 025_categories.sql — `categories` (whole-table; no reconcile needed)
- 056_po_due.sql ↔ 024_po_due.sql — `purchase_orders.due_date` (then `supabase:reconcile`)

## Category translations EN → AR (for review)
| id | English | Arabic |
|---|---|---|
| sneakers | Sneakers | أحذية رياضية |
| boots | Boots | بوط |
| tshirts | T-Shirts | تيشيرتات |
| jeans | Jeans | جينز |
| jerseys | Jerseys | قمصان فرق (was جيرسي in the old `ty_` key — "team shirts" reads better on a till; change it in Settings if the shop says جيرسي) |
| crocs | Crocs | كروكس |
| shirts | Shirts | قمصان |
| jackets | Jackets | جاكيتات |
Only four are in use in the sandbox copy (boots, jerseys, sneakers, tshirts). The sandbox also holds test categories made by `e4.mjs` ("Night Caps …", "Beanies …") — sandbox only.

## Arabic check — what was missing and fixed
- The Settings → Roles grid printed every permission name in English on the Arabic screen (the server's label) — all 38 now have `perm_*` strings in both languages.
- `_nightshift/i18ncheck.mjs` loads `app-i18n.js` + `app-i18n-extra.js` in a VM: **2,747 keys in each table, none missing on either side, none left identical to the English**; no key defined twice inside one object block (the scanner was proved on a planted duplicate); the panel's own table (`PI18N`) is complete both ways. **Final pass: 2,955 keys each side, 0 missing, 0 identical; the panel 319 each side, 0 missing.**
- Hardcoded English that bypassed `t()`: **the login screen** (title line, Username, Password, Show/Hide password, Sign in, Signing in…, Forgotten your password?, Cannot reach the server, the three validation/hint lines, the reset-password toast) — all now in both languages; and `API`'s five English fallbacks (offline, timeout, signed out, forbidden, server error) plus the three login refusals now have `err_*` strings in both tables, which `API.friendly()` prefers.
- Category names: the till, the product forms and filters, Reports and exports showed English category names in Arabic — now the category's Arabic name.

## E7 root cause
**Every tick box inside any dialog was impossible to tick.** A dialog's backdrop carries `data-act="modal-backdrop"` and is the ancestor of everything in the dialog, so the app's one delegated click handler (`js/app-boot.js`) found it for a press on the tick box and called `e.preventDefault()` before `ACTIONS['modal-backdrop']` decided not to close — and preventing a checkbox's click un-ticks it. The Yalla Wear builder's "from delivered work" list is all tick boxes, so nothing could ever be chosen and Issue always said "Add at least one shirt first" (0 `partner_invoices` in the database). **Fix:** the dispatcher ignores the backdrop unless the backdrop itself was pressed.

Found on the way, and fixed with it:
- The picker ticked kit **lines**, but the server bills whole **jobs** (`partner_invoice_refs` holds job ids), so ticking one shirt billed the whole job once it came back from the server. The picker is now one row per finished job (sizes and total), with a select-all box in the header.
- "Issued and sent" was toasted before the server answered, and a refusal arrived underneath it. Issue now waits: the button says Sending…, the dialog keeps every tick until the answer, a refusal says the server's reason in the screen's language and reloads the truth.
- The server accepted anything: a job not finished, a job already on another invoice (billed twice), a reused invoice number (500 `UNIQUE constraint failed`), and always labelled the invoice SYP. `Partner.createInvoice` now refuses `job_not_done`, `already_invoiced`, `invoice_exists` and `mixed_currency` (409) and takes the jobs' own currency.
- **Still open, not touched:** a **blank** (hand-typed) invoice and a **draft** still live only in the browser — there is no table for hand-typed lines, so "Issue" on a blank invoice reaches no server. That is the known-open note in `CLAUDE.md`, unchanged.

## E1 stock reconciliation result (before = after)
Migration 058 on a copy of the verified backup (`_nightshift/e1mig.mjs`):
- **clean copy:** `OPENED`, 055 → 058, 8 colours made ("Standard / أساسي" — no product had a colourway), 0 broken references before and after, **per product before = after: true** — 8 products, 1,625 pieces, 89 movements: Test Shoe 0/1 size, Puma Suede Classic 2/3, Ahmad jersey 1450/5, Ahmad jersey 222 0/1, teen 153/5, zizo 7/7, raphinha 5/5, vache 8/1. No size left without a colour.
- **sabotaged copy** (058 edited to move one stocked size of product 50 onto the last product, run through `OG_MIGRATIONS_DIR`): `REFUSED: migration 058_colours.sql failed: stock changed for product 50 "Puma Suede Classic": 2 pieces / 3 sizes / value 0 before, 1 / 2 / 0 after — nothing was changed`; the database stayed on 057, no `product_colours` table, stock unchanged.
- The sandbox itself migrated the same way when restarted.

## E8 every panel job: job | how tested | result
Test panel: `node panel/panel.js` via `_nightshift/tp-run.sh` — `OG_PANEL_PORT=8199`, `OG_PANEL_KEY` set, `OG_PANEL_AUTOSTART=0`, the sandbox env (shop on 8190), `OG_PANEL_LOG_DIR=_nightshift/panel-logs`. `OG System.exe` was never started; nothing listened on 8099. `OGSystem.cs` did not change, so the .exe was not rebuilt. Script: `_nightshift/e8api.mjs` (90/90).

| job | how tested | result |
|---|---|---|
| testPrintDry (new) | run for real while LOCKED (public); sandbox printer config; `--dry` sends nothing | exit 0 |
| (action) start | run for real while locked (public) — the panel started the sandbox shop, 7 steps, none failed | running |
| backup | run for real (lands in `server/data-sandbox/backups`) | exit 0 |
| preflight | run for real (prints only) | exit 3 = its own "the shop is already open here" answer; accounts, 3 owner/developer, catalogue all OK |
| hardware | run for real (read-only check) | exit 0 |
| mirrorCheck | run for real; the sandbox env has no Supabase | exit 1 "Supabase is not configured" (expected) |
| mirrorDrift | run for real; no Supabase | exit 1 (expected, same reason) |
| createuser | run for real: a throw-away sandbox cashier (password piped, never on the command line); it then signed in | exit 0 |
| cert | run for real with its word NEW CERT: written to `server/data-sandbox/certs` (the real `server/data/certs` untouched), then that sandbox folder deleted so no later Start asks Windows to trust it | exit 0 |
| push (Publish) | NOT run — commits + pushes. Verified: dev-only (hand-sent while locked → `locked`), needs a message | verified without running |
| pull | NOT run — git pull is forbidden tonight. Verified: dev-only | verified without running |
| deploy | NOT run — would rewrite the owner's untracked `dist/`. Verified: dev-only | verified without running |
| testPrint | NOT run — real paper. Verified: public; the window only offers it after `testPrintDry` exits 0, and asks first (screens `*-07-printers-real-ask`) | verified without running |
| hardwareInstall | NOT run — administrator prompt, installs queues. Verified: dev-only | verified without running |
| certTrust | NOT run — writes the Windows trusted store. Verified: dev-only | verified without running |
| mirrorSync | NOT run — pushes to Supabase. Verified: dev-only; with the shop open → `needs_shut` | verified without running |
| mirrorReconcile | NOT run — deletes in Supabase. Verified: dev-only; without RECONCILE → `needs_word` | verified without running |
| claim | NOT run — takes the lineage. Verified: without CLAIM → `needs_word` | verified without running |
| restore | NOT run — replaces og.db from Supabase. Verified: locked → `locked`; without RESTORE → `needs_word` | verified without running |
| takeShop | NOT run — the same wipe. Verified: locked and not in a handover → `locked`; without TAKE → `needs_word` | verified without running |
| (action) restart | run for real, sandbox | running again |
| (action) refresh (Full refresh) | run for real, sandbox — all six steps ok; it bumps `sw.js` (the test runs took it v249 → v253) | ok |
| (action) sync | run for real; the sandbox worker has no Supabase → "[panel] sync finished", nothing pushed | ok, nothing sent |
| (action) who / stop | run for real while locked (public) | answered / stopped |

**The lock, proved** (`e8api.mjs`, `e8idle.mjs` 6/6, `e8ui.mjs`):
- Hand-sent `POST /act` while locked, refused `locked` by the panel process: accounts, reveal, resetpw, info, clear, sync, quit, job backup, job restore (with its word), job takeShop (with its word, not a handover), job push. The locked event stream carried no log line.
- `cashier` and owner `abode` refused on both paths (shop closed → read-only database check; shop open → the shop's own login); a wrong developer password refused; `zizo` (developer) let in on both paths, and the session the shop's login made for the question was gone afterwards (session count before = after).
- Idle: with `OG_PANEL_DEV_IDLE_MS=8000`, 12 s of use kept it open, 10 s of nothing locked it, the window was told `why: idle`, a hand-sent accounts afterwards was refused.
- The window closing: with no stream connected for 5 s it locked itself.
- Throttle: after eight failures in 15 min even the right password is refused `too_many` (it also caught my own test runs twice, which is how the throttle was first seen working).
- After Lock: a hand-sent reveal and accounts refused.

**The window** (`e8ui.mjs` 175/175, CDP, EN + AR × 1100×760 and 375×760; 76 screenshots in `_nightshift/shots/e8/`, passwords blurred before every picture): closed Shop screen shows only Open the shop, Test the printers, the language and the lock (plus the connection re-checks) — no job reachable; a failing connection (the bogus Telegram tokens) shown with no fix button; boot mid (ring part-filled, running step named) and end (ring full and lit); the open Shop screen scrolls to its last connection at 760 px; printer test → dry check → the real print ASKED, not sent; Restart asks; the lock dialog; a cashier refused in the window (password field emptied); the developer in; Tools (18 jobs + restart + full refresh, publish box), Log, Connections, Accounts (no Former staff, zaven "not readable" + Reset, all hidden), a reveal of the right password with a countdown, a second reveal hiding the first, the reveal hiding itself after 30 s, a reset (confirm hit-tested, the new password shown once, gone from the page when closed), This machine; Lock back to the Shop screen with the log emptied; Stop asks; **a failed boot** (a socket held 8190 and never answered): ring red, one sentence, a shopkeeper gets Try again only, a developer also Show details and the step list, Show details opens the Log; `prefers-reduced-motion` stops the draw-in and the orbit; no sideways scroll anywhere (RTL included); no page errors; every confirm button hit-tested.

Fixed on the way: toasts sat over the bar and covered the Developer button (moved below the bar); tool rows ran off a 375 screen (tags wrap); after a stop the "Shop server" row still said Answering (the panel re-checks server and mirror when the shop stops; a closed shop reads "not checked", not red); the failed-boot line read "The port is free — something else is holding port 8190" (now just the reason); "0 h ago" for a fresh backup; a reset of Former staff was written to the audit log before being refused (now refused first); `restore`/`takeShop`/`cert`/… danger words were checked only in the window (now in `runJob` too).

## E8 connections: check | result on the sandbox
Checked at 11:43 by the test panel, shop open (`_nightshift/e8-connections.json`):

| check | how | result |
|---|---|---|
| Shop server | `/api/health`, 5 s | ok — answering (OG Sports) |
| Secure address | `trust-cert --check` (15 s) + `TLS.daysLeft` + `TLS.uncovered` | warn `https_none` — the sandbox has no certificate (the real one was not looked at) |
| Receipt printer | `hardware.js --json` (60 s, one run for three rows) | ok |
| Label printer | same | ok |
| Scanner | same | ok |
| Cloud copy | the worker's own state | warn `mirror_off` — no Supabase in the sandbox |
| Telegram · OG bot | `getMe` only, 6 s; linked-chat count from config | bad `tg_refused` — the sandbox's bogus token (2 chats in the copy, with fake ids) |
| Telegram · Yalla Wear bot | same | bad `tg_refused` — bogus token, 0 chats |
| Web Push keys | `push_keys` row, `OG_PUSH` | warn `push_off` (keys present, push switched off in the sandbox) |
| Internet | `gstatic generate_204`, 5 s | ok |
| Last backup | newest `.db` in the data folder's backups | ok — within the hour |
| Vault key | `OG_VAULT_KEY` present | ok (the sandbox's throw-away key) |
With the shop closed, the server row reads "The shop is closed" as skip and the mirror row "not checked". Every row has a deadline; the whole card has one of 70 s.

## E8 password-leak search result (no passwords)
Six passwords were used or shown in the test (the developer's, the owner's and the cashier's sandbox passwords; the password revealed; two made by reset; one piped to createuser). Each was searched for as plain text:

| where | size | hits |
|---|---|---|
| test `panel.log` | 15,578 chars | 0 |
| test panel stdout | 62 | 0 |
| test `panel-audit.log` | 788 | 0 |
| every event-stream frame (incl. every Log-screen line) | 272,623 | 0 |
| every HTTP answer except the reveal/reset answers themselves | 4,275 | 0 |
| the REAL `%LOCALAPPDATA%\OGSystem\panel.log` | 17,096 | 0 (and its mtime unchanged by the tests) |
| the REAL `launcher.log` | 336 | 0 (mtime unchanged) |
**Git:** every sandbox password on record (15, from `sandbox-logins.txt` and both `ACCOUNTS.private.md` files) was searched for in `git log -p main..night-shift-01` (1.04 MB of diffs) and in every commit message: **0 found**.
The only answers carrying a password are the reveal and reset answers, by design (keyed, `no-store`). The audit log records `unlock`, `unlock-refused <name>`, `lock (button/idle/closed)`, `reveal <user>`, `reset-password <user>` — no password. Also: `sendJson` now refuses any JSON answer holding `pw_box`/`pw_enc`/`pw_hash`/`pw_salt` (tested directly: a clean answer → 200; `pw_box`, `pw_hash` and a nested `pw_salt` key → 500 `server_error`; the words "pw_box" inside a value → 200. `e6api.mjs` already checked that no answer carries a `pw_*` field; it is re-run in the final pass). No screenshot shows a password (blurred before each capture).

## Cloudflare: removed from the panel / leftovers elsewhere (for a later decision)
**Panel:** there was nothing to remove — no Cloudflare job in `panel/jobs.js`, no button or word in `panel/ui/` or `panel/panel.js` (it went on 16 Sep). The new panel mentions none. `git grep -i cloudflare` over tracked files other than Markdown: **0**.

Left elsewhere, untouched (the Cloudflare service was left alone):
1. **`server/.env` still holds three lines: `OG_CF_TUNNEL_ID`, `OG_CF_HOSTNAME`, `OG_CF_TUNNEL_TOKEN`** (values not read tonight). No code reads them since 16 Sep. The token is a live credential for the tunnel → decide: delete the lines, and delete or rotate the tunnel in the Cloudflare dashboard.
2. **`C:\Program Files (x86)\cloudflared\cloudflared.exe`** (54 MB, 11 Sep) is still on disk. There is no Windows service called `cloudflared` and no `%USERPROFILE%\.cloudflared`. CLAUDE.md says "no longer installed" — the service is gone, the program file is not.
3. The Cloudflare account: the tunnel and the `shop.ogsports1.com` DNS record (not looked at tonight — no calls to Cloudflare).
4. `dist/js/app-i18n-extra.js` (untracked build of 16 Sep) still has the old "…or connect Cloudflare, first." strings in both languages; the next Build dist replaces it.
5. Words only: CLAUDE.md's "The way in from outside — retired", the memory notes, and git history (`git log -- server/scripts/cloudflare.js`).

## Going online later — Railway or a VPS (research only, NO code)
Today the shop is one Node process on the shop laptop, SQLite beside it, reached on the wifi. Moving it off the laptop changes these things:

- **SQLite as the one writer, and the baton.** Either option keeps one process and one file, which suits `node:sqlite`. But the server would become the permanent writer, so the laptop handover (`restore.js` boot pull, `lineage.js`) would stop being routine. It would become a one-time move: the last laptop pushes, the server takes the lineage, and every laptop is then a browser only. **Laptops must never run the server again**, or a second writer appears — the 2026-08-30 incident one layer up. `OG_PULL_AT_BOOT=0` and `OG_SYNC_MINUTES` then belong to the server alone.
- **The Supabase mirror.** It stays a backup copy, pushed from the server. Nothing in `mirror.js` changes. og-track (already on Railway) keeps reading it.
- **USB printers and the scanner.** The scanner is a keyboard in the browser, so it keeps working. The label printer already works remotely through `agent/print-agent.js` (it long-polls `/api/labels/next` over HTTP). **The receipt printer does not**: `lib/printer.js` prints from the server process to a Windows share, and a cloud server has no share. Receipts would need the agent to take ESC/POS jobs too, a queue like `print_jobs`, and the agent authenticating to a public URL. This is the biggest code change.
- **HTTPS.** A public domain gets a real certificate: Railway provides one; on a VPS, Caddy or nginx with Let's Encrypt. The self-signed `make-cert` / `trust-cert` flow and the phones' one-time warning go away, and staff Web Push becomes possible again. `OG_ORIGINS` must list the domain and `OG_TRUST_PROXY=1` must be set, or login throttling treats every visitor as one address.
- **Telegram long polling.** It works from either place: one process, outbound only. On Railway the shop bot's webhook design (built, not switched on) also fits. Only one poller or webhook may be live per token, so the laptop copy must stop.
- **Web Push keys.** `push_keys` lives in the database file, so it moves with the file; og-track's inbox collection moves with the lineage. The subscriptions survive only if the same file moves.
- **Railway's filesystem vs a VPS disk.** Railway containers are rebuilt on every deploy, so `server/data/` (og.db, backups, certs, `ACCOUNTS.private.md`) must be on a **mounted volume** at a path given by `OG_DATA_DIR`, which exists since tonight. Railway runs one replica per volume, which is exactly one writer, and backups must leave the volume. A VPS has an ordinary disk and systemd; you patch it yourself.
- **The panel (`OG System.exe`)** is a laptop tool. On a server it becomes a service manager (Railway's dashboard, or systemd), and the developer panel would need a web login instead.
- **Yalla Wear portal and the Safeers' phones.** These gain the most: they work from anywhere once the server is public. That also puts the till on the internet, so rate limits, `OG_ORIGINS` and the retired test accounts matter more. The Safeers view already uses relative paths only.
- **Backups.** `npm run backup` writes beside the database. Remote: a scheduled `backup.js` plus a copy off the machine (object storage), and a restore drill. The Supabase mirror is a second copy, not the only one.

**Questions for the owner:** (1) Should the till keep working when the shop's internet is down? A cloud server means no internet, no till, unless a laptop copy stays as a fallback, which brings back the two-writer problem. (2) Is the monthly cost acceptable? A Railway volume or a VPS is roughly USD 5–20 a month, plus a domain. (3) Who looks after a VPS (updates, security)? Or is a managed Railway preferred? (4) Which receipt printers must keep printing, and may one laptop at the counter always run the print agent? (5) Which domain name, and may the till be reachable from the public internet at all? (6) Which laptop's database becomes the one that moves?

## MORNING CHECKLIST (in this order)
(PowerShell blocks npm.ps1 on these machines, so every command below uses npm.cmd.)

1. **Your own laptop (this one):** review the branch: `git log --oneline main..night-shift-01` (11 commits: stage 0, the eight edits, the final pass, and this log fix), this log, and the screenshots in `_nightshift/shots/`. Then `git checkout main`, `git merge night-shift-01`, then **Publish**.
   - The files the night and you both changed are committed whole (see "Decisions"). `git diff a274f47 night-shift-01 -- <file>` shows only the night's part.
   - **Publish runs `git add -A`**, so it also commits your other ~90 pending edits and the 5 files you had staged. Commit or set those aside first if they are not ready.
   - After the merge: `git update-ref -d refs/nightshift/owner-baseline`, and `git branch -d night-shift-01` if you like.
2. **Supabase dashboard (SQL editor), before ANY laptop runs the new code:** run `server/supabase/024_po_due.sql` → `025_categories.sql` → `026_colours.sql` → `027_access.sql` → `028_safeers.sql`.
   - **026 especially:** until it runs, a second colour's variants carry a barcode already used by the first colour, and the mirror refuses them.
   - If `021`–`023` were never run (CLAUDE.md said outstanding on 16 Sep), run them first. `CATCH-UP.sql` is 008–028 in one paste and is safe to re-run.
   - Then check from any laptop: `cd server; npm.cmd run supabase:drift` → green.
3. **Shop laptop:**
   - `cd server; npm.cmd run backup`
   - In the panel that is running now (the old one, no lock yet): **Get the latest code**, then **Full refresh**. The server restarts and migrations **056 → 060** apply. On a copy, 058 refuses and changes nothing if any product's stock would move.
   - `npm.cmd run users:rebuild` (the dry run: read the plan). Then `npm.cmd run users:rebuild -- --apply --url http://localhost:8090`. The new passwords go to `server\data\ACCOUNTS.private.md`. Hand them out, then keep that file safe.
   - **Close the shop** in the panel. The next two write to Supabase, and the running shop's mirror must not write at the same time; `users:rebuild` above was the step that needed the shop open.
   - `npm.cmd run users:mirror` (the dry run), then `npm.cmd run users:mirror -- --apply` (it needs 027).
   - `npm.cmd run supabase:reconcile` (it fills `purchase_orders.due_date`, the colour columns and the rest).
   - **Full refresh** (it opens the shop again).
   - **Quit OG System from the tray and open it again**: the new panel, with the Shop screen and the developer lock, loads only when the panel restarts. Sign in to the Developer section as `zizo` or `ahmad`, open Connections, then Check all.
4. **Also:**
   - Delivery notes that named a removed account now say **Former staff**. Waiting parcels that were assigned to a removed account are **unassigned**: on the Deliveries board, give them to `safeer1` / `safeer2`. Waiting errands likewise.
   - `zaven` and `zohrab` show "Password not readable" in the Developer → Accounts screen (their passwords were never sealed). Leave them, or Reset if you want them readable (that signs them out).
   - Settings → Safeers: set the rate per delivery and check the eight Aleppo areas.
   - The categories' Arabic names (the table above), especially قمصان فرق.
   - Cloudflare leftovers (the section above): the three `OG_CF_*` lines in `server\.env`, the tunnel in the Cloudflare dashboard, `cloudflared.exe`.
   - Ahmad's laptop: only after steps 2–3, and only as a dev copy or through Take the shop here. Never two writers.
   - Optional cleanup on this laptop: `server\data-sandbox\`, `server\data-sandbox2\`, `server\.env.sandbox`, `_nightshift\` (all gitignored, sandbox only).

## Review fix (17 Sep, after the night) — Supabase refused the new tables
- **What happened.** At 12:42 the owner started OG System on this laptop while the folder was on `night-shift-01`, so the real shop runs the new code and migrations 056–060 are in the real `og.db`. 027 had been run in Supabase, and the live mirror failed every push with `403 permission denied for table user_permissions`: a table created in the SQL editor on this project gets no privileges for `service_role`, and the old mirror code stopped the whole run at the first refusal.
- **Fix 1 — the files.** 019, 021, 022, 023, 025, 026, 027, 028 and their `CATCH-UP.sql` sections end with a guarded block: `GRANT SELECT, INSERT, UPDATE, DELETE` to `service_role`, `USAGE, SELECT` on any owned sequence (none today), `REVOKE ALL` from `anon`/`authenticated`, a missing table skipped. PGlite: 001–028 run, `CATCH-UP.sql` twice, 025–028 again, every new table granted, the public roles refused, a sequence granted — 51/51. The SQL to run now is `_nightshift/supabase-grants-now.sql` (the ten tables from 019 and 021–028; any that does not exist is skipped).
- **Fix 2 — the mirror.** A refused table is skipped by name at every step and the rest goes up; its bookmark does not move, so its rows wait and go up after the GRANT. Loud: `denied` in the sync status, a red Connections row with the SQL and Copy SQL in the panel, the Mirror fold in Settings, a red bell row, and the log (when the list changes and after each full run). The fast lane retries a refused table at most once a minute. `denied-test.mjs` 29/29 (fake PostgREST: both refused tables named, sales/products/etc. pushed, the refused bookmark unmoved, then pushed and cleared once allowed; a refused core table does not stop the fast lane), `denied-e2e.mjs` 27/27 (test panel + sandbox shop against the fake: panel row in EN/AR at 1100 and 375, the log, the app's Mirror fold and bell in EN/AR, and all of it clearing).
- **Not done, on purpose:** the running real shop was not stopped or restarted and the branch was not switched. It still runs the code it loaded at 12:44 (old mirror behaviour), so the GRANT is what un-sticks it; the new behaviour arrives with its next restart.
