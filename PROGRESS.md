# Night shift 03 — where things stand

Started the run-through at **19:18, Fri 18 Sep 2026** (GTBDT), on branch `night-shift-03`.

Commits already on the branch at that moment:

```
77b42a9 ns03 phase 3: the products list — one box that takes a scan, and three quick edits
51c6f70 ns03: the parseInt bug had four siblings, and every one read ZERO
572bbbe ns03 phase 2: money — one shape for every dialog, and plain words
64ccb94 ns03: phase 0+1 — the audit, and a job home for everyone
2c7c428 quick-fix: the log, and the gotcha in CLAUDE.md   (the branch point)
```

Phase 1 check on arrival: the job home, the grouped menu and the replaced dashboards are all in
`64ccb94` — but **`ns03-home` and `ns03-tabbar` were never written**, so Phase 1 is not provable.
That is Phase 1b, first.

---

## The suites, and how to rerun them

```bash
# the server, in the sandbox and nowhere near the real files
cd server && OG_ENV_FILE=server/.env.sandbox OG_DATA_DIR=server/data-sandbox OG_PORT=8190 \
  OG_HTTPS=0 OG_SYNC_MINUTES=0 OG_PULL_AT_BOOT=0 OG_PUSH=0 node index.js

# a headless Chrome the scripts attach to (the shell opens it, not the script)
chrome --remote-debugging-port=9224 --user-data-dir=_nightshift/chrome --headless=new

cd server && npm test                       # the one server test
node _nightshift/ns03/p1-home.mjs           # the job home, per role
node _nightshift/ns03/p1-tabbar.mjs         # the phone menu
node _nightshift/ns03/p2-money.mjs          # the money dialogs, balances read from SQLite
node _nightshift/ns03/p2-money-phone.mjs    # the same at 390, in Arabic
node _nightshift/ns03/p2-digits.mjs         # every digit a person might type
node _nightshift/ns03/p2-cashier.mjs        # what the cashier may see, and the 403s
node _nightshift/ns03/p3-products.mjs       # the products list, and an Arabic-layout scan
node _nightshift/ns03/p3-products-phone.mjs
node _nightshift/ns03/p4-settings-staff.mjs # settings, the shipping list, the people
node _nightshift/ns03/p5-safeers-board.mjs  # the country, the board, safeers, the driver
node _nightshift/ns03/sweep.mjs             # every screen, every role, EN 1100 + AR 390
node _nightshift/ns03/sweep.mjs wael        # …or one role

# fix 04 (branch fix-04)
node _nightshift/fix04/bring-back.mjs       # why a parcel on the road cannot come back
node _nightshift/fix04/till.mjs             # the till at 390, and a real sale on a phone
node _nightshift/fix04/golden-desk.mjs      # regenerate the 1100 golden till.mjs compares against
```

---

## Log

| Time | What | Commit | Checks | Skipped |
|---|---|---|---|---|
| 19:18 | run-through started | — | — | — |
| 19:31 | Phase 1b — the two missing suites, `ns03/p1-home` and `ns03/p1-tabbar` | 712fdbb | 118 | Phase 1 code was already complete; only the proof was missing |
| 19:45 | Phase 4 — Settings in five sections that save themselves, the shipping price list, the people as cards | 712fdbb | 43 | nothing |
| 20:09 | Phase 5 — country follows the city, the board card, Safeers, the driver, the shelf | 66d1add | 56 | Reassign on a parcel already OUT — the server refuses it by design (question 4) |
| 20:39 | Phase 6 — the sweep (`ns03/sweep.mjs`), the report, CLAUDE.md | 6eec5b6 | 433 | the till under the phone bar (question 5) |

## The final pass — everything, one at a time

```
npm test                      6 pass, 0 fail
ns03/p1-home                 53      ns02/qf-board                20
ns03/p1-tabbar               65      ns02/qf-safeers              22
ns03/p2-money                39      ns02/qf-walk                 26
ns03/p2-money-phone          34      ns02/p1-charts               29
ns03/p2-digits               36      ns02/p1-exports              16
ns03/p2-cashier              22      ns02/p2-products             27
ns03/p3-products             50      ns02/p2-edit                 11
ns03/p3-products-phone       17      ns02/p2-solo                 10
ns03/p4-settings-staff       43      ns02/p3-find                  9
ns03/p5-safeers-board        56      ns02/p3-more                 20
ns03/sweep                  433      ns02/p3-receive              19
                                     ns02/p4-money                18

1131 checks. 0 failed.
```

(Run them ONE AT A TIME: they share one Chrome profile and therefore one cookie jar, so a
second suite signing in kills the first one’s session.)

---

**Every phase is done and committed. Nothing pushed, nothing merged.** The two things for the
shop laptop, the nine questions and the whole story are in `night_shift_03_log.md`.

---

## Fix 05 — the run-through

| Time | Part | Commit | Checks | Notes |
|---|---|---|---|---|
| — | 0 — why the buttons did nothing; one build per page | 334152c | 11 (sw-update) + 6 (p0-namespaces) | the tiles carried `data-hm`, which nothing dispatches on |
| — | 1 — the job tiles pressed, the grid, "Staff" | efba6ac | 173 (p1-tiles) + 63 (ns03/p1-home, repaired) | ns03/p1-home measured the tiles and never pressed one |
| — | 2 — one cleanup for everything that floats | 0dfd08e | 48 (p2-layers) | the shelf card is on <body>, and render() only rewrites #view |
| — | 3 — Safeers: every control pressed, and finished | 2c0040a | 75 (p3-safeers) + 56 (ns03/p5, repaired) | every button already worked; ns03/p5 was spending its own fixture |
| — | 4 — Money: the screen, the dialogs, and what landed | a58db4e | 49 (p4-money) | every phone dialog is a sheet now, and the keyboard is answered |
| — | 5 — phone quality at six widths | fb06376 | 122 (p5-phone) + 1027 (ns03/sweep, extended) | the sweep now walks 360/375/390/414/430 and 740 landscape |
| — | 6 — the devil pass, and a full shop | 2933536 | 52 (p6-devil) + 49 (p6-load) | a minus used to mean its opposite; 0.005 dollars used to mean five |
| — | 7 — the style rules, enforced | — | 617 (p7-style) | Arabic was tracked on every screen and set in two faces |

```bash
node _nightshift/fix05/p0-namespaces.mjs   # no button wired to a dead namespace (no browser)
node _nightshift/fix05/sw-update.mjs       # needs the SECOND Chrome on 9225
node _nightshift/fix05/p1-tiles.mjs        # every tile, every role, click AND tap, EN/AR, 1100/390
node _nightshift/fix05/p2-layers.mjs       # every floating layer, route change, Esc, outside, Back
node _nightshift/fix05/p3-safeers.mjs      # every Safeers control, click AND tap, read back from SQLite
node _nightshift/fix05/p4-money.mjs        # the money screen, the dialogs, a double tap and a pulled plug
node _nightshift/fix05/p5-phone.mjs        # targets, fields, the sheet, rotation, at five phone widths
node _nightshift/fix05/p6-devil.mjs        # rubbish in, three presses, deep links, two tabs, a dead session
node _nightshift/fix05/p7-style.mjs        # the style rules, every screen, every role, EN/AR

# the load test is DESTRUCTIVE — it is run between a backup and a restore:
#   1. stop the sandbox server
#   2. cp server/data-sandbox/og.db{,-wal,-shm} somewhere aside
#   3. start it, then:
node _nightshift/fix05/p6-load.mjs         # 500 products, 200 parcels, 300 money events
#   4. stop it, put the three files back, start it again
```

**Starting the two Chromes on Windows: QUOTE THE PROFILE PATH.** The repo lives under
`D:\DESKTOP\OG System Demo`, and an unquoted `--user-data-dir=...OG System Demo\_nightshift\chrome`
reaches Chrome as three arguments — it reads the last two as URLs and exits with
`Multiple targets are not supported in headless mode`, which names nothing that is true.

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList `
  '--remote-debugging-port=9224','"--user-data-dir=D:\DESKTOP\OG System Demo\_nightshift\chrome"',`
  '--headless=new','--no-first-run',`
  '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2'
# and the same on 9225 with _nightshift\chrome-fresh, for fix05/sw-update only
```
