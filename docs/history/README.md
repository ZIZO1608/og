# The run logs

One file per night shift or fix, oldest first. These are **records, not
instructions** — each one says what was found, what was changed, how it was
checked, and what was deliberately left alone. Where a decision from one of
these nights still governs the code, it is written up in
[CLAUDE.md](../../CLAUDE.md); read that first and come here for the reasoning.

| when | what | |
|---|---|---|
| 17 Sep 2026 | **Night shift 01** — colours × sizes, categories in both languages, the date picker, the partner invoice, the safeers, the accounts rebuild | [night-shift-01.md](night-shift-01.md) |
| 18 Sep 2026 | **Night shift 02** — "fewer steps": the charts came out, the warehouse got verbs, goods could finally arrive, money went from nine tabs to six | [night-shift-02.md](night-shift-02.md) |
| 18 Sep 2026 | **Quick fix** — one hour: the `.dlb-mi` class collision (committed twice), a menu that vanished under its own repaint, `scroll-padding-bottom` | [quick-fix.md](quick-fix.md) |
| 18 Sep 2026 | **Night shift 03** — "big buttons": one home screen of verbs per role, one shape for every money dialog, the two number parsers, products, settings, staff | [night-shift-03.md](night-shift-03.md) |
| 18 Sep 2026 | **Fix 04** — the parcel that cannot come back (and why it was *not* built), and the till's bottom on a phone | [fix-04.md](fix-04.md) |
| 19 Sep 2026 | **Fix 05** — the buttons that did nothing, one build per page, one place everything floating shuts, phone sheets, the style rules | [fix-05.md](fix-05.md) |

Fix 06 and audit 06 have no log of their own: what they changed is in
`CLAUDE.md`, and audit 06's lasting output is
[docs/connections-map.md](../connections-map.md).

[review-guide-ns01.md](review-guide-ns01.md) is a reviewer's walk-through of
night shift 01. It is deliberately **not in git** (`.git/info/exclude`).

## These files were merged, and moved

Tidied on 20 Sep 2026, before the first deployment to a server. Each night's
**audit/brief** and its **log** were two files and are now one, in that order,
with nothing edited but a header. The logs still talk about each other by their
old names — they are records of what was true when they were written, so that
prose was left alone. This is the translation:

| it says | it is now |
|---|---|
| `NIGHT_SHIFT_01.md`, `night_shift_log.md` | `docs/history/night-shift-01.md` |
| `night_shift_02_audit.md`, `night_shift_02_log.md` | `docs/history/night-shift-02.md` |
| `night_shift_03_audit.md`, `night_shift_03_log.md` | `docs/history/night-shift-03.md` |
| `quick_fix_log.md` | `docs/history/quick-fix.md` |
| `fix_04_log.md` | `docs/history/fix-04.md` |
| `fix_05_log.md` | `docs/history/fix-05.md` |
| `audit_06_map.md` | `docs/connections-map.md` |
| `CUSTOMERS.md` | `docs/customers.md` |
| `PROGRESS.md` | `docs/progress.md` |
| `REVIEW_GUIDE.md` | `docs/history/review-guide-ns01.md` |
