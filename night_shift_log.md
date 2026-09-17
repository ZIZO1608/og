# Night Shift 01 — 2026-09-17, 01:07 → (running)
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
| Stage 0 | DONE | isolation proof above | (see below) |
| E5 | DONE | `_nightshift/e5.mjs`: title and page text in EN+AR × 1366 and 375 (8/8); screenshots `e5-*.png` | (E5 commit) |
| E3 | DONE | `_nightshift/e3.mjs` 60/60: server refusals (past, non-date), every field dressed, white icon, whole field opens, hit-test over a modal, sheet only at 375, RTL, keyboard (arrows mirrored, PgUp/PgDn, Esc keeps the modal), outside tap, PO saved → reload keeps the date → list column → WhatsApp composer opens (nothing sent); Reports custom range fires its handler. EN+AR × 1366 and 375; `e3-*.png` | (E3 commit) |
| E4 | DONE | `_nightshift/e4.mjs` 38/38: server rules (dup EN / dup AR / missing name / switched-off / unknown refused, never deleted, website feed carries both names, every product has a category), till chips, Settings fold (browser refusal, add, stays open, switch saves at once), products filter — EN+AR × 1366 and 375; Arabic login screen; `i18ncheck.mjs` | (E4 commit) |
| E7 | DONE | `_nightshift/e7.mjs` 25/25 (twice): one job (tick, untick, re-tick, issue, server holds exactly it, screen total = server total, SYP, visible after reload) at 1366 EN; two jobs at 375 AR (hit-tested); a job invoiced behind the tab's back → the server's 409 reason toasted, the local guess removed; select-all (header box and button) at 1366 AR; nothing left to bill; OG's side sees all four; a tick box in any other dialog works and the backdrop still closes. Throw-away partner `nightcheck-partner` on the sandbox only. | (E7 commit) |
| E1 | — | | |
| E6 | — | | |
| E2 | — | | |
| E8 | — | | |
| Final pass | — | | |

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
- Sandbox test logins live in `_nightshift/sandbox-logins.txt` (gitignored, sandbox only). `nightmgr` (manager) was created for testing and will be removed by the E6 rebuild like any other account not on the list.

## Every 'manager' literal and what I decided
(E6)

## Bugs hit and how I fixed them   (error → cause → fix → retries)
- E7: the new server guards seemed not to work → the "restart" had failed with EADDRINUSE: TaskStop killed the wrapper shell, not the sandbox node, so the old server kept answering → `_nightshift/sb-stop.ps1` stops only the node.exe listening on 8190 (checked it was the sandbox's `node index.js`; nothing listened on 8090/8443) → 1 retry.
- E7: the refusal check was flaky → the browser's POST sat unsent behind connections held by earlier page loads in the same tab → each step gets a fresh tab → 2 retries.
- Heredocs containing backticks broke the Bash tool's parser twice → patches are written as files and run with node.
- E3: every date refused as `bad_due` → a heredoc ate the backslashes in `/^d{4}…/` → fixed with Edit, sandbox restarted → 1 retry.
- E3: the test's "Escape keeps the dialog" failed → the harness clicked at coordinates taken before `scrollIntoView` moved the dialog, so it pressed the backdrop → recompute the point before each press, `block:'nearest'` → 1 retry.
- E3: a run hung → four tabs left by failed runs each held an SSE stream (six per host) → `closeall.mjs`, and the harness now closes its tab on any uncaught error → 1 retry.
- E3: the face read "PICK A DATE" and the native "/ /" showed through → `.field > span` styled the wrapper, and the datetime-edit text part kept its colour → wrapper is a div, all three edit parts at opacity 0; Today lost its lime to og-skin's `.btn` → an og-skin rule for `.dp-today`.

## Files changed per edit
- E7: `js/app-boot.js`, `js/ylinvoice.js`, `server/lib/partner.js`, `server/index.js`, `js/app-i18n-extra.js`, `css/yalla-scan.css`, `sw.js` (v244)
- E4: `server/migrations/057_categories.sql`, `server/supabase/025_categories.sql`, `server/lib/categories.js` (new), `server/lib/catalogue.js`, `server/index.js`, `server/lib/mirror.js`, `server/lib/restore.js`, `server/lib/drift.js`, `server/scripts/supabase-check.js`, `js/catset.js` (new), `js/data.js`, `js/shop.js`, `js/app-routing.js`, `js/app-state.js`, `js/auth.js`, `js/pos.js`, `js/app-products.js`, `js/app-print-labels.js`, `js/app-warehouse.js`, `js/shelfmap.js`, `js/app-settings.js`, `js/app-i18n-extra.js`, `css/warehouse-settings.css`, `index.html`, `sw.js` (v243)
- E3: `js/datepick.js` (new), `index.html`, `sw.js` (v242, precached), `css/inputs-dashboard-pos.css`, `css/og-skin.css`, `js/api.js`, `js/app-i18n-extra.js`, `js/app-customers-scan.js`, `js/app-actions.js`, `js/app-warehouse.js`, `js/data.js`, `server/lib/purchasing.js`, `server/lib/alerts.js`, `server/lib/mirror-lag.js`, `server/migrations/056_po_due.sql`, `server/supabase/024_po_due.sql`
- E5: `js/app-i18n.js`, `manifest.webmanifest`, `sw.js` (v240 → v241)
- Stage 0: `.gitignore`, `NIGHT_SHIFT_01.md`, `night_shift_log.md`, `server/lib/env.js`, `server/lib/tls.js`, `server/lib/backup.js`, `server/index.js`, `server/scripts/{backup,createuser,hardware,mirror-drift,preflight,purge-demo,supabase-check,supabase-reconcile,supabase-restore,supabase-sync,test-print,warehouse-one-room}.js`

## New migrations + Supabase files (in order)
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
- `_nightshift/i18ncheck.mjs` loads `app-i18n.js` + `app-i18n-extra.js` in a VM: **2,747 keys in each table, none missing on either side, none left identical to the English**; no key defined twice inside one object block (the scanner was proved on a planted duplicate); the panel's own table (`PI18N`, 177 keys) is complete both ways. Re-run in the final pass for tonight's keys.
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

## E8 every panel job: job | how tested | result

## E8 connections: check | result on the sandbox

## E8 password-leak search result (no passwords)

## Cloudflare: removed from the panel / leftovers elsewhere (for a later decision)

## Going online later — Railway or a VPS (research only, NO code)

## MORNING CHECKLIST (in this order)
(to be completed)
