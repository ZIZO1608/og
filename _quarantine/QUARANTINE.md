# Quarantine — night shift 2026-09-25

**Nothing was moved.** No tracked file met the bar: *no reference anywhere, and not something a
person runs by hand.*

How it was decided: every tracked file outside the protected folders (migrations, cloud SQL,
`js/`, `css/`, `server/lib/`, the panel, vendor files, tests) was searched for by its name and its
path in every tracked text file (`D:\DESKTOP\og-night-shift\tools\unused.mjs`; output in
`…\logs\unused.txt`). 39 files had no reference from code. None of them is unused:

| Group | Files | Why they stay |
|---|---|---|
| History and runbooks | `docs/history/*.md`, `docs/vps/*.md`, `docs/website/UPDATE-*.md`, `docs/connections-map.md`, `tools/tonight/drill.md` | Documentation, referenced from `CLAUDE.md` and the docs indexes. Listed in the report as "old reports — keep or quarantine?" |
| The room's design reference | `docs/img/warehouse-*` | Tracked on purpose (see the shelf map section of `CLAUDE.md`) |
| Test suites run by hand | `tools/always-on/*.mjs`, `tools/night-mode/*.mjs`, `vps/og-bridge/test/*.test.js` | Run with `node` or `node --test`; named in `CLAUDE.md` as how each feature was verified |
| Tools for a person | `server/scripts/till-firewall.ps1`, `tools/wg-test/shop-verdict.ps1` | Run by hand, from the VPS runbooks |

**Your call** (not moved, low confidence):

| File | Size | Last changed | Evidence | Restore command (if it is ever moved) |
|---|---|---|---|---|
| `tools/night-mode/undo.mjs` | 4.1 KB | 2026-09-24 | Named nowhere, not even in `CLAUDE.md`; it is the PGlite check for `undo_035_night_requests.sql` (commit 1326263) | `git mv _quarantine/tools/night-mode/undo.mjs tools/night-mode/undo.mjs` |
