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
| E5 | — | | |
| E3 | — | | |
| E4 | — | | |
| E7 | — | | |
| E1 | — | | |
| E6 | — | | |
| E2 | — | | |
| E8 | — | | |
| Final pass | — | | |

## Decisions I made (and why)
- **The prompt arrived truncated** at 50,000 characters ("→ the E1 migrati"). `NIGHT_SHIFT_01.md` is everything that arrived, verbatim, plus a note at the top saying so (50,718 bytes). The morning checklist is completed from the rest of the file.
- **Files the owner and I both changed are committed whole.** 101 files carry the owner's uncommitted work, including `CLAUDE.md`, `sw.js`, `server/index.js` and most of `js/`. Committing only my hunks (by patching the index) would leave those files dirty and different between `night-shift-01` and `main`, and then the morning's `git checkout main` would refuse to run at all. Committing them whole means their working copy equals the branch, so the checkout and the merge work. The cost is that those commits also carry the owner's pending edits in those files. The exact pre-night state is kept at `refs/nightshift/owner-baseline` (`a274f47`), so `git diff a274f47 night-shift-01 -- <file>` shows only my part. Files I never touched are never added, and the owner's 5 staged files stay staged: every commit is `git commit -- <paths>`, which commits only the listed paths.
- **Two dev-only switches** were added so the sandbox cannot see the real files: `OG_ENV_FILE` replaces `server/.env` outright (the real file is never opened), and `OG_DATA_DIR` moves the database, backups and certificate. Relative paths are read from the repo root. Both must be real environment variables. Every script that defaulted to `server/data/og.db` now asks `dbFile()` in `lib/env.js`.
- Sandbox test logins live in `_nightshift/sandbox-logins.txt` (gitignored, sandbox only). `nightmgr` (manager) was created for testing and will be removed by the E6 rebuild like any other account not on the list.

## Every 'manager' literal and what I decided
(E6)

## Bugs hit and how I fixed them   (error → cause → fix → retries)

## Files changed per edit
- Stage 0: `.gitignore`, `NIGHT_SHIFT_01.md`, `night_shift_log.md`, `server/lib/env.js`, `server/lib/tls.js`, `server/lib/backup.js`, `server/index.js`, `server/scripts/{backup,createuser,hardware,mirror-drift,preflight,purge-demo,supabase-check,supabase-reconcile,supabase-restore,supabase-sync,test-print,warehouse-one-room}.js`

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

## MORNING CHECKLIST (in this order)
(to be completed)
