# NIGHT SHIFT 01 — OG System — FINAL MASTER PROMPT (eight edits)

> Saved by the night shift from the text pasted into the session. **The pasted text reached the
> session truncated** — it ended at "→ the E1 migrati" followed by
> "[Message truncated - exceeded 50,000 character limit]". Everything received is below, unchanged;
> the rest of the MORNING CHECKLIST template (and anything after it) never arrived, and the log's
> checklist was completed from the rest of this file.

You are in **Autonomous Night Shift** mode on the OG System repository. I am asleep. Finish the eight edits below on your own and leave me a full report. This is our **first pipeline test** of this pattern: expect errors, fix them yourself, and log every one.

## START HERE — facts about this PC, and your first steps

1. **You work in the normal project folder: `D:\DESKTOP\OG System Demo`.** There is no separate night folder.
2. **Clean up the unused worktree, then switch to the branch** (in this order):
   1. A worktree was created by mistake at `D:\og-night-01` on branch `night-shift-01`. It holds nothing but a broken 114-byte `NIGHT_SHIFT_01.md`. Remove it: `git worktree remove --force D:\og-night-01`, then `git worktree prune`. If the folder is still there, delete it.
   2. In `D:\DESKTOP\OG System Demo`, run `git status`. **Pre-existing uncommitted changes are the owner's work.**
      - Do not commit them and do not throw them away.
      - List them in the log. They carry over with the checkout, because the branch starts at the same commit, `503f0b2`.
   3. `git checkout night-shift-01`. The branch already exists at `503f0b2`; if it does not, run `git checkout -b night-shift-01`.
   4. **Commit only files you changed tonight** (`git add <paths>`, never `git add -A`).
3. **Save this prompt.** The text I pasted to you IS the prompt.
   - Write it, complete and unchanged, to `D:\DESKTOP\OG System Demo\NIGHT_SHIFT_01.md`, and check the size is the full text (tens of KB).
   - Commit it on `night-shift-01`.
   - From now on, "this file" means that saved copy.
4. **The backup for 1b is already taken and verified:** `D:\DESKTOP\OG System Demo\server\backups\og-2026-09-16T22-04-18-511.db` (1188 KB, integrity check passed). Use this file for the sandbox copy.
5. **PowerShell on this PC blocks `npm.ps1`.** Always run `npm.cmd …` (or `node …` directly), never `npm …`.
   - If you run PowerShell scripts, start with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (this window only).
   - The Bash tool is fine for POSIX commands.
6. **Ahmad's laptop is no longer part of this system** (owner's decision).
   - Only two machines matter: **this laptop** (the only development machine) and **the shop laptop** (runs the shop).
   - Ahmad keeps his `developer` **account**; only his laptop is out.
   - Ahmad's install may still have written to Supabase in the past (see "One Supabase project, one database"), so:
     - in the log, list anything in the mirror or in `CLAUDE.md` that still assumes a second developer laptop;
     - make sure `users:mirror` removes any account rows that only his install created, **except** the accounts in the E6 table.
7. **Known from the backup:** the database has **0 `partner_invoices`**, which fits the E7 bug (no Yalla Wear invoice has ever been saved). It also has 10 `users`, 8 `products` and 28 `variants`.

---

## 0. Autonomous directives

1. **No human interaction.** Never stop to ask. Every decision I could give you is in this file. If something is still unclear, do what `CLAUDE.md` and the existing code already do, write the decision and the reason in the log, and continue.
2. **Self-healing.** When a command, migration, script or browser check fails:
   - read the error, fix the cause, and retry (up to 3 times per error);
   - if it still fails, **do not fake it**: no placeholder content, no invented data, no half-working screen;
   - keep the old behaviour, or leave that one piece off the navigation;
   - log it as NOT DONE with the exact error, then move on.
3. **Silent execution.** Assume YES to commands, file creation and edits, **inside the safety fence in section 1.**
4. **Work log.** Create `night_shift_log.md` at the root of the working folder **first**, and update it after every stage. If you die at 4 a.m., the log must already say how far you got.
5. **Memory resilience.** This night is long, and your context may be compacted or restarted.
   - This file lives in the project root as `NIGHT_SHIFT_01.md` (commit it).
   - **After any compaction, restart or confusion:**
     1. Re-read `NIGHT_SHIFT_01.md` and `night_shift_log.md` completely.
     2. Continue from the first stage the log does not mark DONE.
   - Never redo a DONE stage, and never trust your memory over these two files.
6. **The goal.** By morning, all eight edits are built, committed on a branch, and verified in a real browser:
   - in English **and** Arabic;
   - at desktop width **and** 375 px.

   Making them live is a short morning checklist I run myself (see "Morning checklist").

## 1. Safety fence — overrides everything above

**Where this runs:** the developer's own laptop, **not** the shop machine.

- The live shop runs on the shop laptop, which normally holds the baton.
- This laptop's `server/data/og.db` and `server/.env` are **real**:
  - the `.env` holds the real Supabase keys, Telegram tokens and vault key;
  - a server started here with them writes to the real mirror and messages real phones.
- A shop server may be running here on 8090/8443. **Leave it alone:** do not stop it, restart it, or start one.
  - Restarting it would run tonight's migrations on the real database and push them to Supabase.

The shop is real, and so are its money and its phones. **Nothing you do tonight may touch the live shop, its database, Supabase, or Telegram.**

### 1a. The branch — and git rules

1. Follow "START HERE" step 2: remove the unused worktree, then check out `night-shift-01` in `D:\DESKTOP\OG System Demo`.
2. Log how the branch relates to `origin/main` (`git fetch`, then `git log --oneline night-shift-01..origin/main` and the reverse). Only this laptop pushes code now, so `origin/main` should normally have nothing new.
3. If `origin/main` has commits the branch lacks **and** the branch has no commits of its own yet, and the working tree has no pre-existing changes, fast-forward onto it. Otherwise leave it, and log it.

**Rules:**

- Commit after each finished stage, with the message `night-shift-01: <edit>`, adding only your own paths.
- **Never** push, merge to `main`, `git pull`, `git stash`, `git reset`, or use the panel's **Publish**.
- **Never** stop, restart, start or "Full refresh" the real server (8090/8443) or the real panel (`OG System.exe`).
- Add `server/data-sandbox/`, `_nightshift/` and `server/.env.sandbox` to `.gitignore` before creating them.

### 1b. Back up first

I already ran the backup before I slept (see START HERE step 4).

- Confirm that file exists in `server\backups\`, confirm it passed its integrity check, and write its path in the log.
- If there is no backup from today, run the same command yourself (it is read-only for the shop).

### 1c. Every test runs on a SANDBOX server — a copy of the database, cut off from the world

Set this up once, before any edit.

1. **The sandbox must never use `server/data/og.db` or `server/.env`.** Those are the real ones, in the same folder you are working in.
   - Copy **the verified backup file** from 1b to `server/data-sandbox/og.db`. Never copy the live file: a running server has part of its data in the WAL.
   - **Never write anything into `server/data/` tonight.** Tonight's `users:rebuild --apply` runs against the sandbox and writes its password file into `server/data-sandbox/`.

   This laptop's copy may be older than the shop's. That is fine for testing — say so in the log.
2. **Point the sandbox at its own data and its own env file.**
   - If the server has no switch for this, add small dev-only env vars, and document them in `CLAUDE.md`:
     - one for the data folder (e.g. `OG_DATA_DIR=server/data-sandbox`), which also covers backups, certs and push keys;
     - one for the env file (e.g. `OG_ENV_FILE=server/.env.sandbox`). When it is set, **`server/.env` must not be read at all.**
   - Start the sandbox from this folder on **another port** (e.g. `8190`; never `8090` or `8443`).
3. Give it an environment that **cannot reach anything real**:
   - **Supabase disabled**: `server/.env.sandbox` has no Supabase URL/key and no real `OG_VAULT_KEY` (use a throwaway sandbox vault key). A second database with the same `.env` is a *second writer*; that deleted real sales on 2026-08-30 and 2026-09-03 (see "One Supabase project, one database").
   - `OG_PULL_AT_BOOT=0` and `OG_SYNC_MINUTES=0`.
   - **Telegram disabled**: set `OG_TELEGRAM_TOKEN_OG` and `OG_TELEGRAM_TOKEN_YALLA` to **bogus non-empty** values (an empty value is deleted by PowerShell, and the server then reads the real token), and put fake chat ids in the copy's `telegram.og_chats` / `telegram.yalla_chats` config (see "Testing it without spamming the shop").
   - Web Push must not reach real subscribers: clear `push_subscriptions` in the **copy**.
4. **Prove the isolation before any edit**, and paste the proof in the log:
   - `GET /api/sync/status` on the sandbox says the mirror is off;
   - the sandbox's database path is `server/data-sandbox/og.db`;
   - `server/data/og.db`'s modified time has not changed;
   - no Telegram long-poll is running;
   - the port is the sandbox port.
5. If you need an environment switch the server does not have (for example a data folder), add it as a small dev-only env var, and document it in `CLAUDE.md`.

**Every test write — test products, test tasks, test accounts, test invoices — happens only on the sandbox.** Generated data in the real shop reads exactly like the truth; that is the failure `CLAUDE.md` was rebuilt to prevent.

**Real account changes and real Supabase changes are NOT made tonight.** You build them as commands, prove them on the sandbox, and I run them in the morning (section E6 and the checklist).

### 1d. Rules from `CLAUDE.md` that apply to every stage

Read `CLAUDE.md` before each stage — at least the sections each stage names. It overrides `README.md` and your habits.

- **Frontend:** vanilla HTML/CSS/JS. No framework, no bundler, no npm, no build step. Zero server dependencies. Node 22.5+.
- **Look:** dark mode only. Montserrat for Latin. Real RTL for Arabic. The shop's look goes in `css/og-skin.css`, with every rule prefixed `body:not([data-portal="yalla"])`, so the partner portal keeps its own mint skin. No `:has()` and no very recent CSS.
- **Strings:** every string goes in **both** `I18N.en` and `I18N.ar`. Wrap digits inside Arabic text in `<span dir="ltr">`.
- **Events:** delegated only (`data-act` + a case in `ACTIONS`), never `addEventListener` per element. Each module is an IIFE with one global, and load order in `index.html` matters. **Grep before defining any global name** (see the `firstName()` story).
- **Server calls:** `js/api.js` is the only file that talks to the server.
- **Permissions:** guard both layers — browser `allow()`/`navAllowed`, and server `requirePerm()`, which is the real guard. Call `invalidatePermissions()` on every permission write.
- **Cursor-shape tables:** every write calls `logChange` **in the same transaction**. `DB.tx()` does not nest, so use `Stock.apply(d, …)` inside a transaction.
- **Service worker:** bump `CACHE` in `sw.js` on every stage that changes `css/`, `js/` or `index.html`, and add every new JS file to its precache list.
- **Restarts:** restart the **sandbox** server after server code changes.
- **Every schema change needs its Supabase twin**, because you cannot run SQL in the dashboard:
  - write the next-numbered mirror file under `server/supabase/` and append it to `CATCH-UP.sql`;
  - declare new columns on existing mirrored tables in `mirror-lag.js`;
  - give new tables row-level security like the existing mirror files;
  - add new mirrored tables to **every list** the sync, reconcile, restore, `supabase:check` and `drift` read — grep a recent table such as `order_payments` and follow every place it appears;
  - pick each new table's shape deliberately: **Cursor**, **Mirror** (pushed whole, deletes follow) or **Append-only**.
- **Shell:** PowerShell is 5.1 (no `&&`, no heredocs, and it adds a UTF-8 BOM when piping). Use the Bash tool for POSIX.
- **Browser checks** (there are no tests):
  - drive headless Chrome **top-level** (`X-Frame-Options: DENY`) with a persistent profile, and give it a mouse (the `--blink-settings` flags in "Gotchas");
  - poll real readiness, because `--virtual-time-budget` makes timers instant;
  - **hit-test** popovers with `document.elementFromPoint`, click `.fold-btn` rather than `.fold-head`, and screenshot after fades;
  - save screenshots to `_nightshift/` (gitignored).
- **Docs:** document each new thing in `CLAUDE.md`, in the same voice, briefly — **no passwords**.
- **Passwords never appear in the log, in git, or in your summaries.**

## 2. Order of work

Easy and low-risk first; accounts before Safeers, because Safeers need accounts.

**Stage 0 (START HERE, branch, backup, sandbox, log) → E5 → E3 → E4 → E7 → E1 → E6 → E2 → E8 → Final pass**

E8 comes last because its Accounts screen shows the accounts E6 builds.

---

## E5 — Rename "Point of sale" to "Cashier"

- Every **label** that says Point of sale / POS becomes **Cashier** (EN) and **الكاشير** (AR): navigation, headings, the More sheet, the palette, tooltips, empty states, and the control panel if it shows the name.
- **Do not rename** code ids, routes, the `POS` global, CSS classes, or the `cashier` role id.
- Check the roles grid and account menus: if the screen name and the role name now read confusingly side by side, the role keeps its own label.

## E3 — The calendar button (whole app)

**The bug:** on the warehouse's reorder / purchase-order form, the **Due date** is a native `<input type="date">`. On the dark skin its calendar icon is a dark glyph on a dark field — almost invisible — and on small screens it cannot be opened.

**The fix:** one OG date picker, used everywhere.

- Create `js/datepick.js` (global `DatePick`; grep the name first), with delegated events.
- **Every** `input[type=date]` in the app becomes it. Grep `js/` and `index.html`: the PO due date, Reports and export ranges, the road and handover screens, the partner portal, and every other date field.
- **The value stays ISO `YYYY-MM-DD`**, so no server route changes.
- **Look:**
  - the calendar icon is **white** and clearly visible;
  - the **whole field** opens the picker;
  - the popup follows the OG skin: dark, soft corners, lime only on the selected day and the primary button;
  - inside the Yalla Wear portal it follows **the portal's mint skin**, not OG's;
  - the Arabic side uses the app's existing Arabic font (Montserrat has no Arabic glyphs);
  - month names reuse the app's date formatting (`fmtDate`), so English and Arabic stay consistent.
- **Behaviour:**
  - month and year navigation, **Today**, **Clear**;
  - `min`/`max` support — a PO due date cannot be in the past;
  - arrows / Enter / Esc work;
  - an outside tap closes it;
  - real RTL.
- **Phone:** at ≤ 480 px it opens as a bottom sheet with large tap targets.
- **Stacking:** respect `.topbar { z-index: 20 }` and the stacking-context gotcha. Hit-test the open popup, including inside modals and drawers.
- **Verify** on the sandbox, at 375 px and on desktop, in English and Arabic:
  1. Open a new PO, pick a due date and save.
  2. Reload; the date is kept.
  3. The PO's **send-to-supplier** step still works up to the point it would send. Do not send anything real (the sandbox cannot anyway).

## E4 — Categories in English and Arabic, plus a full Arabic check

**Find where categories live** and write what you found in the log. It may be the product's `type` field (it is in `catalogue.js`'s EDITABLE set), a config list, a table, or hardcoded.

**Do not confuse them with `expense.categories`** — that is a different list, and it stays as it is.

- **Every product category gets `name_en` + `name_ar`**, and each screen shows the one for the current language:
  - the Cashier category filters;
  - the Add-product form and the product editor;
  - lists and search;
  - Reports and exports;
  - the website feed (`/api/ext/products` carries both).
- **Existing data must not break.** If products store free text today, move them onto category ids in the migration. Every distinct existing value becomes a category, so no product loses its category. Log the before and after counts.
- Translate every existing category into proper shop Arabic, and list the pairs in the log for my review.
- **Settings → new fold "Categories":**
  - `setFoldStart` with a `meta` line showing the count;
  - the owner adds, renames and disables categories;
  - both names are required, and duplicates in either language are refused;
  - a category is never deleted, only disabled;
  - gated on `config.write` on both layers.
- **Full Arabic check:**
  1. List every key in `I18N.en` that is missing from `I18N.ar`, and fill them.
  2. Check for keys defined twice in one language (the `movement` story).
  3. Grep the render code for hardcoded English that bypasses `t()`.
  4. Include tonight's new screens, **and the control panel's own strings in `panel/ui/i18n.js`** (English and Arabic).
  5. Put the list of fixes in the log.

## E7 — Yalla Wear portal: making an invoice from ticked jobs does not work

In the partner portal (`js/yalla.js`, `server/lib/partner.js`), Yalla Wear ticks checkboxes to choose which jobs go on an invoice to OG. **Making the invoice from the ticked jobs does not work.**

- **Reproduce on the sandbox first, then find the root cause.** Read "The partner half", "The line to Yalla Wear", and the known-open note that *a draft partner invoice still lives only in the browser*.
- **Things to check** (hints, not answers):
  - the delegated `data-yl` handler for the tick boxes and the button;
  - whether the selection survives a repaint;
  - the gate on `POST /api/partner-invoices` (`['partner.write','partner.invoice']`) against what the `partner` role actually holds;
  - the jobs' currency and state;
  - the z-index / stacking trap on the portal's bar (it has `backdrop-filter`).
- **Test account:** create a temporary partner **on the sandbox only** (`nightcheck-partner`, random password, never written anywhere but the sandbox).
- **It works when:**
  - tick one job, several, or all → Make invoice → the invoice holds **exactly** those jobs, with the right totals in the right currency;
  - OG's side of the sandbox sees it;
  - already-invoiced jobs cannot be ticked again;
  - untick and select-all behave;
  - it works at 375 px and in Arabic;
  - a server refusal shows a toast with the reason and puts the truth back (the optimistic-write pattern).
- **Log the root cause** in one or two sentences, plus the fix.

## E1 — Warehouse: add a product with colours and a quantity per colour

**My decisions:**

- **A product has colours.** Each colour has its own sizes, and each size has its own quantity (e.g. Red → 42: 3, 43: 2 · Black → 42: 1).
- **The barcode does NOT change per colour.** The printed code stays exactly as the code makes it today (read `label_code_seq` and "Product labels" to see how), and every colour of the same product and size shares it.
- **A picture per colour is optional.**
- **All colours share the product's price** (confirmed). A colour has no price field, and the Add-product form has one price for the whole product.
- **Warehouse staff add products and prices** (see E6).

**Data** — first read `server/lib/catalogue.js`, the variants/stock schema, "Product labels", "Product pictures", "Editing a product", "The warehouse: moving stock", "Archived is not deleted", and "Purchase orders".

- **Add a colour dimension:**
  - a product has colours (`id`, `name_en`, `name_ar`, `hex`, optional `image_url`);
  - a variant becomes **colour × size**;
  - stock is per variant.
- **Migrate existing products** so their current `colourway` becomes their single colour, with no stock lost and no movement written.
- **The migration checks itself.** It will later run on the **real shop laptop** when the new code first starts there.
  - Inside its own transaction, it compares stock quantity and value per product before and after.
  - On any difference it **rolls back and refuses to finish**, naming the product.
  - Prove this on the sandbox, including a copy you deliberately break.
  - Log the result.
- **Internal ids stay unique; the printed code is shared.**
  - If `variants` has a UNIQUE constraint on the printed code (locally or in the Supabase schema), restructure it so the code can repeat across colours, and do the same in the mirror file.
  - Lookup by a scanned code can now return **several** variants. Make every scan path handle a list:
    - Cashier;
    - Move by scan;
    - stock counts;
    - returns;
    - the delivery desk;
    - label printing;
    - the camera scanner and the keyboard-wedge scanner (remember the wedge reads `e.key`: match on digits the way the desk does).
- **At the till:**
  - if the scanned size exists in more than one colour **with stock**, show a one-tap colour picker (swatch + name);
  - if only one colour has stock, add it directly, as today.
- **Opening quantities are movements, not typed-over numbers.** Write the product, its colours, its variants and one opening "received" movement per variant with qty > 0 in **one transaction** (`DB.tx` + `Stock.apply`), with `logChange` for every cursor-table row.

**Colour must appear wherever a variant is named:**

- receipt and A4 invoice lines;
- the delivery slip;
- product drawer and lists;
- stock by place;
- the movement log;
- Worth reordering and PO lines (a PO line is now colour × size, and its picker must ask for the colour);
- stock counts;
- returns and wants;
- Reports and exports;
- labels (the colour name may print, the code stays shared);
- reorder and stock-out reminders;
- `DB.liveVariants()` and everything that walks it;
- `/api/ext/products` for the website (colours with their sizes and pictures).

Mirror: new columns go in `mirror-lag.js`, and the new table and shape go in the Supabase file.

**The Add-product form must look really good:**

- **Colour chips row** with "+ Add colour":
  - name in EN and AR;
  - a swatch palette of common shoe colours, plus a custom hex;
  - duplicates refused;
  - removing a colour asks to confirm.
- **One card per colour:**
  - swatch, name, and an optional photo (reuse `readImageFile` and the image route; the storage path is keyed by product **and** colour, new path on every replace);
  - a size grid with − / + steppers and direct typing;
  - a live total per colour and a grand total.
- **Validation:**
  - no negative quantities;
  - a colour with no sizes is warned about before save;
  - nothing typed is lost on an error;
  - the whole form works in RTL and at 375 px.
- **The product picture** falls back to the first colour's photo when the product has none.
- **Drawer and editor:**
  - the drawer shows colour × size stock as a compact matrix (stock stays **not** editable there — that rule stays);
  - adding a colour or a size to an existing product gets its screen now, through `Shop.addVariant` (listed as missing in "Known open work"). New stock for it arrives through a movement.

## E6 — Real accounts, new roles, and the owner's access panel

Read these first:

- "Accounts";
- "Permissions";
- "Home screen is chosen by role";
- "Who a message is for";
- the whole Supabase section, especially:
  - `users` is a **plain full upsert**, so a local delete does **not** delete in Supabase;
  - passwords cross only as sealed boxes (`credvault.js`, `pw_enc`);
  - "accounts restore before the tables";
  - the boot-pull rule that **the wipe is refused unless an active manager's box opens**.

### Roles

- **Add `owner` and `developer`.** Both get every permission and the full dashboard home.
- **Check for role constraints.** Look for a CHECK on `users.role` locally (SQLite needs a table rebuild to change one) and in `server/supabase/*.sql`. Update both, or the new roles will be refused.
- **`PINNED`** (`config.write`, `staff.write`, and the new `access.write`) moves to `owner` and `developer`. `manager` is **no longer pinned.**
- **`FORBIDDEN`** for `partner` is unchanged, and it also applies to per-person grants.
- **Seed `role_permissions`** for the new roles in the migration. The mirror carries it whole, and it is in `SEEDED`.
- **Grep every literal `'manager'`** in `server/` and `js/`, and decide per place whether `owner`/`developer` must pass too. Log each place and the decision. Known places:
  - the home-screen chooser;
  - the restore/boot-pull "active manager" guard;
  - `preflight`;
  - the Telegram role presets (`reminders.preset.<role>`);
  - anything else you find.

  Permission checks should ask the permission (`Auth.can(user, …)`), not the role.
- **Default permissions per role:**
  - **`manager`**: today's manager set **minus** every `money.*`, `cost.read`, `profit.read`, `staff.*`, `config.write` and `access.write`. So Wael has no money page, no cost, no profit, no Settings and no staff by default. The owner can switch any of these on (below).
  - **`warehouse`**: receive, move, count, print labels, **add and edit products and prices, including cost** (`product.write` and `cost.read` on). No money page, customers, staff or Settings.
  - **`cashier`**: as today.
  - **`delivery`**: as today, plus the safeer task view from E2.
  - **`partner`**: unchanged.

### Per-person access — owner and developer only

- **A new table of per-person grants and denies**, on top of the role.
  - Effective permissions = role + grants − denies, with `FORBIDDEN` and `PINNED` enforced on the server.
  - Computed in **one place** in `server/lib/auth.js`, so `requirePerm`, `Auth.can(user, …)`, `/api/live` and the permission list sent to the browser all agree.
  - `invalidatePermissions()` is called on every write.
  - Mirror shape: **Mirror** (pushed whole, deletes follow), added to every mirror list.
- **Settings → new fold "Access"**, allowed only with `access.write` (pinned to owner and developer):
  - a list of people (name, role, active); "Former staff" is never shown;
  - tap a person to see permission groups as switches, marked *from role* or *changed for this person*;
  - each switch **saves instantly**, with a toast;
  - "Reset to role" per person;
  - disabled switches say why (forbidden or pinned).
  - The owner opens or closes access for anybody in seconds.
- **The same fold also manages people:**
  - add a person: name, username, role, and a password shown **once** with a copy button — created through the same path as `npm.cmd run createuser`, **so it gets a sealed box** (otherwise a restore brings that account back disabled);
  - disable a person, which ends their sessions;
  - reset a password, which re-seals the box.

### The final set of logins

| Username | Display name | Role |
|---|---|---|
| `abode` | Abode | owner |
| `wael` | Wael | manager |
| `cashier` | Cashier | cashier |
| `member1` | Member 1 | warehouse |
| `member2` | Member 2 | warehouse |
| `member3` | Member 3 | warehouse |
| `zaven` | (unchanged) | partner — **keep the account and its password exactly as they are** |
| `zohrab` | (unchanged) | partner — **keep the account and its password exactly as they are** |
| `zizo` | Developer Zizo | developer |
| `ahmad` | Developer Ahmad | developer |
| `safeer1` | Safeer 1 | delivery |
| `safeer2` | Safeer 2 | delivery |

**Every other account is removed:** `hussam`, `lubna`, `maher`, `talal`, `yalla`, `mirrortest`, `owner`, `zaren`, `nightcheck-partner`, and anything else.

### Build it as two commands — dry-run by default, `--apply` to write

**`npm.cmd run users:rebuild`** — works on the local database it is run against.

- Without `--apply` it prints what it would create, re-point and delete.
- With `--apply`:
  1. **Lockout guard (this happened on 2026-09-05).**
     - Create `abode` first.
     - Sign in as `abode` through the real login route.
     - Confirm Access opens.
     - Only then touch any other manager-level account. If any step fails, stop and change nothing else.
  2. **Create the missing accounts** from the table, each through the `createuser` path (hashed and sealed, `pw_hint` NULL), each with a new strong, readable password (12+ characters).
     - Write the passwords **only** to `ACCOUNTS.private.md` inside the **data folder the command is running against**: `server/data-sandbox/` tonight, `server/data/` on the real run in the morning. Format: username / password / role.
     - Confirm that path is gitignored; add it to `.gitignore` if not.
     - Existing `zaven` and `zohrab` are left untouched, apart from confirming their role is `partner`.
  3. **Remove the others without breaking history.**
     - Create one hidden, inactive **"Former staff"** record: no password, can never sign in, never shown in any list, picker or fold.
     - In one transaction, re-point every foreign key that references a removed account to it, with `logChange` where the table is cursor-shape.
     - End all their sessions, then delete the rows.
     - Do **not** run `purge-demo.js --test-sales`; that is a separate decision.
     - **If a table is protected against updates by design** (an append-only log, a trigger), do not break that protection. Instead keep that one old account as a hidden, disabled record with a scrambled password, named "Former staff – <old username>", out of every list, and say so in the output.
  4. Print a summary. **No passwords** in the printout.

**`npm.cmd run users:mirror`** — makes Supabase match. Without `--apply` it prints the plan.

- It refuses to run unless **this laptop holds the baton** (the lineage check the sync uses), and says so.
- With `--apply`, using the sync's own HTTP client:
  1. Upsert "Former staff" and the new accounts, with their sealed boxes.
  2. Re-point the removed accounts' references **in the mirror too** — including append-only tables, which the sync will never re-send.
  3. Then **delete** the removed users there.
  4. Confirm that `role_permissions` and the per-person table match.
- It is safe to run twice.

**Tonight, run both only on the sandbox.** For `users:mirror` on the sandbox, only the dry-run is possible, because there is no Supabase there, and that is correct. Then prove on the sandbox:

- each role sees what it should, and the server refuses what it should (send requests by hand);
- **Wael**: no money page, and a hand-sent money request returns 403;
- **Owner**: switches Wael's money access on, and Wael sees it on his next request; switches it off again;
- **Members**: add a product with cost, and cannot open Settings;
- **Partner**: a forbidden grant is refused, even by a hand-sent request;
- the lockout guard really stops when `abode` cannot sign in (test it by breaking it on purpose in a second sandbox copy);
- `npm.cmd run preflight` on the sandbox is clean about accounts.

Update `CLAUDE.md` → "Accounts" to describe the new model and the two commands (**no passwords**). The live state is written there after I run them.

## E2 — Safeers (السفراء): the delivery team page

The delivery office, the board and the road already exist ("The delivery office", "The road", "Deliveries", "Delivery reviews"). **Do not rebuild them.** Safeers is the **team layer** on top: the people, their tasks, their pay, and the cash they carry.

- **New screen "Safeers" / "السفراء"** for owner, developer and manager (new permissions `safeer.read` / `safeer.write`, on both layers).
- **Team section:**
  - each safeer with name, phone, and status (free / on a task);
  - today's tasks, and completed today and this month;
  - **earned** and **cash on him**. These two are money: show them only with `money.read` — so Wael does not see them unless the owner switches it on.
  - Cash on him is read from the road's cash-back data (`order_payments` with `handed_in_at IS NULL`); do not re-implement it.
- **Add a safeer:**
  - name, phone, username, and a password shown once;
  - this creates a `delivery` login through the same sealed `createuser` path as E6;
  - disable a safeer, reset a password;
  - how many safeers there are is the owner's choice.
- **Tasks board:**
  - assign **parcels** — the existing orders/deliveries, reusing the board's assign route;
  - assign **errands** — a new task type, e.g. bring stock from the warehouse, or pick up from a supplier;
  - status moves one way: `waiting → out → done | failed`, like deliveries;
  - filters by safeer, status and date.
- **Destination area on every task**, e.g. *send this to Halab al-Jadida (حلب الجديدة)*.
  - The areas come from the owner's list: reuse the Aleppo areas behind `delivery.prices` if they fit, otherwise a `config` list the owner edits in a Settings fold.
  - Do not change what the delivery fee (`fee_mode`) means.
- **An errand never moves stock or money by itself.** If goods leave the shop, that goes through an order or a stock move. An errand may link to an order.
- **Errands table** (new; Cursor shape, `logChange` in the same transaction, mirror file with RLS). Fields:
  - title, type, from, to area, notes;
  - due date (the E3 picker);
  - optional linked order;
  - assigned safeer, who assigned it;
  - status, a failure reason, timestamps.

  **A safeer is scoped to his own tasks in the SQL.** Someone else's task returns 404, as deliveries do.
- **Pay is per delivery.**
  - The owner sets the rate and its currency in Settings (`config` key `safeer.rate`).
  - Every **done** parcel or errand counts as one delivery.
  - Earned = count × rate. It is **derived, never stored**, and shown for today, this week and this month.
- **Reaching the system from the road is NOT solved tonight.** Without Cloudflare, phones only reach the shop on its wifi. The owner may later move the server to **Railway or a VPS**.
  - Build the safeer view so it works from any address: no hardcoded LAN IP or `localhost`, and relative API paths only.
  - When the server cannot be reached, the view says so clearly in both languages ("Connect to the shop wifi to update your tasks"). **Tapping a button must never look successful when it was not saved.**
  - Do not build an offline write queue, and do not add Telegram write buttons (see "Known open work").
- **The safeer's own phone view** (the `delivery` home, extending `viewRunsHome()`):
  - only his tasks, as big cards showing the area, the address or notes, and the money to collect;
  - big **Out / Done / Failed** buttons (Failed asks for a reason);
  - excellent at 375 px and in Arabic.
- **Starting accounts:** `safeer1` and `safeer2` are part of the E6 rebuild table, not created separately.
- **Verify on the sandbox:**
  1. As the owner, assign one parcel and one errand to safeer1.
  2. As safeer1: he sees only his own tasks, and marks both done.
  3. Earned and counts update.
  4. safeer2 gets 404 on safeer1's task.
  5. Wael sees tasks but not money.

## E8 — The control panel (`OG System.exe`): simpler, polished, a developer section, every tool checked

Read the whole of "The launcher: `OG System.exe` and the control panel" first, including all its subsections. The panel is `panel/panel.js`, `panel/jobs.js`, `panel/ui/` (with its own `panel/ui/i18n.js`, English and Arabic), and the `.exe` source `panel/launcher/OGSystem.cs`.

**The owner's request:** the panel is simpler for the shop, looks great, has a real loading animation, checks every connection, and hides every tool behind a **Developer** section that only developers can open. That section also shows **every username and password**.

### Rules that stay

These all come from `CLAUDE.md`:

- **Shop** is the default screen every time, and the last screen is never remembered.
- The boot steps are real signals (codes, not sentences, and no timer pretending to be progress). `skip` means skipped.
- `morning()` runs once per session and never stops the shop opening.
- `while: 'shut'` and `danger` stay enforced in `runJob`, not in the window.
- The panel binds `127.0.0.1` with its boot key.
- `[hidden]` keeps its `!important` rule.
- The QR is drawn for the wifi address, never `localhost`, using the one encoder in `js/codes.js`.
- Class names and global names are grepped before they are defined.
- **The `.exe` is rebuilt only if `OGSystem.cs` changes**, with `panel/build-exe.ps1`. `OGSystem.cs` and `build-exe.ps1` stay **pure ASCII**. Change them only if the polish really needs it (for example a tray menu entry), and log why.

### 1. The simple Shop screen — what everybody sees

- The OG mark, one status sentence, one big lime button, the address with its QR, and problems as cards.
- **The only actions visible without the developer unlock:**
  - Open the shop;
  - Start / Stop;
  - Restart — the Full refresh, which keeps its "asks first" question;
  - Test the printers — receipt and label, `--dry` first, then a real slip only when the person confirms;
  - Language switch.
- **The handover card** ("Take the shop here") stays visible **only when the state actually needs it**, with its typed `TAKE` confirmation unchanged. A shopkeeper can meet that situation, and hiding it would strand the shop.
- **Everything else is hidden** from the shop screen and only appears inside Developer: the Tools list (all jobs in `jobs.js`, all four groups), the Log screen, Publish, Get the latest code, Claim, Restore, Reconcile, and create-user.
- **Simpler wording:** one short sentence per state, in both languages, written for someone who keeps records on paper. No jargon on the Shop screen.

### 2. Loading animation and overall polish

- **A real boot animation:**
  - the OG mark drawing in, a lime ring that fills **per real step** (the seven `STEPS`), and each step ticking in with a soft motion;
  - on success, a short confident finish, then the Shop screen;
  - on failure, the ring stops red on the failing step with one sentence and a "Show details" button (details open only for developers; others see the sentence and "Try again").
  - Respect `prefers-reduced-motion`.
- **Polish across the panel:**
  - the same tokens and Montserrat as the shop, and the Arabic font the panel already uses;
  - real RTL;
  - smooth screen transitions, consistent spacing, hover and pressed states, readable at 100% and 125% Windows scaling;
  - the small window (around 760 px tall) scrolls correctly (the `justify-content` trap in "Things that bit").
- The window and taskbar icon stay correct (`<link rel="icon">`; see the icon notes).

### Cloudflare is removed from this project

The owner has dropped the Cloudflare tunnel idea. Tonight:

- **Do not add any Cloudflare check,** and do not mention Cloudflare anywhere in the panel UI (English or Arabic).
- **Remove any Cloudflare job or button from the panel,** along with its `i18n.js` strings. That includes the "Check Cloudflare" job in `jobs.js` and any Cloudflare card on the Shop or Tools screens. Log exactly what was removed.
- **Outside the panel, do not delete Cloudflare code.** List every remaining Cloudflare file, script, npm script, `.env` key and `CLAUDE.md` section in the log under "Cloudflare leftovers", for a separate decision.
- **Leave the Cloudflare service alone.** Do not stop, uninstall or reconfigure any Cloudflare service on the machine.

### 3. Connections — one screen that checks everything

A **Connections** card on the Shop screen shows a short summary: all good / N need attention. The full list is visible to everybody; fix buttons that are jobs stay behind the developer unlock.

Each row has a status dot, one sentence, **when it was checked**, and a Check again button.

**The checks** — reuse the existing checks, never write a second copy:

- **Shop server:** the port answers and `/api/health` is healthy.
- **Secure address (HTTPS):** the certificate is trusted on this machine, its SANs match this machine's address, and the days to expiry (`trust-cert.js --check`, `lib/net.js`).
- **Receipt printer** and **label printer:** `hardware.js` in check mode. Paper only through Test print.
- **Scanner:** the `hardware.js` device check.
- **Cloud mirror (Supabase):** mode, rows waiting, last push, and who holds the baton — the `sync-status` object the server already sends up the pipe.
- **Telegram:** the OG bot and the Yalla Wear bot. Token present and the bot answers `getMe`; chats linked or not. Never sends a message.
- **Web Push keys:** present on this laptop.
- **Internet:** reachable.
- **Last backup:** age.
- **Vault key:** present (without it, accounts cannot be restored or shown).

**How the checks behave:**

- Every check has a timeout and never blocks the shop opening.
- A check that did not run shows `skip`, never a tick.
- Results are codes, and the words come from `panel/ui/i18n.js`.

### 4. The Developer section — only developers

- **Where:** a small "Developer" button in the panel's settings or gear area. Pressing it asks for a **developer username and password**.
- **Who can open it:** only accounts with the **`developer`** role (Zizo, Ahmad).
  - **The owner (Abode) is refused too.** This is the owner's own decision (confirmed).
  - Test it: `abode` must be refused, like `cashier`.
- **How the password is checked:**
  - through the shop server's own login route when the server answers;
  - otherwise, with the same hash check against a **read-only** open of the database (`DB.openReadOnly()`).
  - The password check is throttled like the app's login. Wrong attempts are refused with no hint of which part was wrong.
- **The unlock lasts** until the window closes, or after 15 minutes of no activity, whichever comes first. A visible "Lock" button is always there.
- **Inside Developer:**
  - **Tools:** every job in `jobs.js` under its four groups, with the existing `while` / `danger` / `aroundShop` behaviour.
  - **Log:** the terminal screen.
  - **Connections:** the full list with every fix button.
  - **Accounts** (below).

### 5. Developer → Accounts: every username and password

- **The list:** display name, username, role, active or disabled, last sign-in. "Former staff" is never shown.
- **The password:**
  - hidden by default (`••••••`), with an eye to reveal **one row at a time**, and a copy button;
  - the reveal hides itself again after 30 seconds.
- **Passwords appear in ONE place only: this Developer → Accounts screen in the `.exe` panel** (confirmed). Everywhere else they stay hidden:
  - The website's Settings → Access fold (E6) **never** shows an existing password. It only shows a new one **once**, at the moment it is created or reset.
  - The Safeers page follows the same rule.
- **Where passwords come from:** opening each account's **sealed box** (`users.pw_enc`, `server/lib/credvault.js`, `OG_VAULT_KEY`). Hashes cannot be reversed.
  - An account whose box does not open shows "Password not readable on this machine" and a **Reset password** button. That covers: no key, a box sealed by an old install's key, or no box at all.
  - Reset password generates a new one, shows it once, re-seals the box, and ends that account's sessions.
- **Security rules — all absolute:**
  - **Passwords travel only between the panel process and its own server over the IPC pipe** (`panel-link.js`, a new message type), or through a panel-side read-only script. **No HTTP route may ever return a password** — not on 8090, not on 8443, not to any device on the wifi. Add a server-side guard or check that proves no response body contains a `pw_enc` field or a decrypted password.
  - **Never print a password to stdout, stderr, `panel.log`, `launcher.log`, or the Log screen.** The terminal pane is written to disk verbatim, so passwords must never go through `say()`.
  - Every reveal and every reset is recorded (who unlocked, which account, when) **without the password**.
  - The window's key and session handling stay as they are. A page open in any other browser must not be able to call the reveal.
- Also show, read-only: the panel's own log file paths, the current `sw.js` cache version, the git branch, and the baton holder.

### 6. Every tool works and is connected — prove it without touching the real shop

- **Run a test panel only:** `node panel/panel.js` with its own `OG_PANEL_PORT` (not 8099), `OG_PANEL_AUTOSTART=0` at first, and the **sandbox** environment from section 1c, so the server it spawns uses `server/data-sandbox` and `server/.env.sandbox`.
  - Never start `OG System.exe` tonight.
  - The live panel's single-instance mutex must never be touched.
  - The real panel's logs live in `%LOCALAPPDATA%\OGSystem\` and are truncated at every start. Give the test panel its own log folder (a small dev-only env var if needed), so the real `panel.log` / `launcher.log` are never overwritten. The password-leak search below reads the **test** panel's logs.
- **Test every job in `jobs.js`** and log a row for each: `job | how tested | result`.
  - **Safe jobs** (checks, `--dry` modes, preflight, drift, check, hardware check, cert `--check`, test-print `--dry`, backup of the sandbox): run them for real against the sandbox.
  - **Jobs that touch the world** (Publish/push, Get the latest code/pull, claim, restore, takeShop, reconcile, `hardware:install`, `cert:trust`, a real test print): **do not run them.** Verify only that:
    - the button shows the right question and `danger` word;
    - `while` / `aroundShop` behave;
    - the command line it would run is correct.

    Where the job supports it, use a dry flag. Log each as "verified without running".
- **Drive the window** with Edge or Chrome in `--app` mode over **CDP**. `--screenshot` cannot work: the SSE stream never finishes loading.
  - Screenshot the boot animation mid-way and at the end, the simple Shop screen, a failing connection, the developer lock, the unlocked Tools / Log / Connections / Accounts screens, a reveal, and a reset — in **English and Arabic**.
  - Hit-test the confirm overlays.
- **Prove the lock:**
  1. Non-developer accounts are refused — the sandbox's `cashier`, and also `abode` (owner).
  2. A developer is let in.
  3. After the idle timeout (shorten it with a dev-only env var for the test) the section locks.
  4. Tools and Log are unreachable while locked, including by sending the panel's `POST /act` for a hidden job without the unlock: **refuse it in `runJob`/the panel server, not only in the window.**
- **Prove the password safety:**
  1. Reveal a password on the sandbox (use a sandbox-only throwaway vault key; never copy the real `OG_VAULT_KEY`).
  2. Search `panel.log`, `launcher.log`, the Log screen text and every HTTP response captured during the test for that password. It must appear nowhere.
  3. Write the search result in the log (without the password).
- **Update `CLAUDE.md`** → the launcher section: the simple screen, the developer lock, Connections, Accounts, and the "passwords never over HTTP / never in logs" rule.

---

## Final pass

1. Bump `CACHE` in `sw.js`. Confirm every new JS file is precached and loads in the right order in `index.html`.
2. Restart the **sandbox**. Walk every screen touched tonight in **English and Arabic × desktop and 375 px**, and save the screenshots. Then open the test panel over the sandbox once more and walk the simple Shop screen, Connections, the developer lock, and Accounts.
3. Run a last I18N sweep for keys added tonight.
4. On the sandbox, run `npm.cmd run preflight` and `npm.cmd run supabase:drift`, and log the output. `drift` lists the new Supabase files — that is expected.
5. `git status` shows nothing of yours uncommitted (only gitignored files and the owner's pre-existing changes you listed at the start), everything of yours is committed on `night-shift-01`, and nothing was pushed.
6. The live folder, live database, Supabase and Telegram were **not touched**. Say how you know (for example, `server/data/og.db`'s modified time is unchanged since the backup, and no process read `server/.env` except a real server that was already running).
7. Complete the log.

## `night_shift_log.md` — required structure

```
# Night Shift 01 — <date>, <start> → <end>
Folder: D:\DESKTOP\OG System Demo · Branch: night-shift-01 · Backup: <path> · Worktree removed: yes/no
Owner's pre-existing uncommitted changes (not committed by me): <list>
Sandbox: port <n>, isolation proof: <sync status / telegram / push>
Baton on this laptop (read-only check): yes / no

## Status
| Edit | DONE / PARTIAL / NOT DONE | Verified how (screens, languages, widths) | Commit |

## Decisions I made (and why)
## Every 'manager' literal and what I decided
## Bugs hit and how I fixed them   (error → cause → fix → retries)
## Files changed per edit
## New migrations + Supabase files (in order)
## Category translations EN → AR (for review)
## Arabic check — what was missing and fixed
## E7 root cause
## E1 stock reconciliation result (before = after)
## E8 every panel job: job | how tested | result
## E8 connections: check | result on the sandbox
## E8 password-leak search result (no passwords)
## Cloudflare: removed from the panel / leftovers elsewhere (for a later decision)
## Going online later — Railway or a VPS (research only, NO code)
Half a page. For each option: what in this codebase would have to change, and why. Cover at least:
- SQLite as the one writer, and the baton / lineage
- the Supabase mirror
- the USB printers and the scanner at the shop (the existing `agent/` print agent)
- HTTPS
- Telegram long polling
- Web Push keys
- Railway's filesystem and volumes vs a VPS disk
- the Yalla Wear portal and the Safeers phones
- backups
End with the questions the owner must answer before choosing.

## MORNING CHECKLIST (in this order)
(PowerShell blocks npm.ps1 on these machines, so every command below uses npm.cmd)
1. MY laptop: review the branch, git checkout main, merge night-shift-01, Publish
2. Supabase dashboard: run these SQL files, in this order: <list>   (before any laptop runs the new code)
3. SHOP laptop: npm.cmd run backup → "Get the latest code" → Full refresh
   → the E1 migrati

[Message truncated - exceeded 50,000 character limit]
