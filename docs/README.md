# docs

Everything written down that is not the manual. **The manual is
[CLAUDE.md](../CLAUDE.md)** at the repository root — how the system works, why
each decision was made, and what will bite you. This folder is what would
otherwise clutter the root.

Three documents live at the root on purpose, because they are the ones somebody
arriving at this repository needs first: `README.md`, `CLAUDE.md` and
`DEPLOY.md`.

## Still current — read these

| | |
|---|---|
| [connections-map.md](connections-map.md) | **Every connection that leaves the process** — the cloud copy, the bots, the printers, the phones, the panel. Read it before touching any of them, and keep it current: a connection added and not written here is one nobody knows is there. |
| [customers.md](customers.md) | The customer half in full: the owner's decisions, what each stage built, how it was proved, and what is still open. `CLAUDE.md`'s Customers section is the summary; this is the record. |
| [progress.md](progress.md) | Where the last run got to, and — at the top — **the two commands that start the sandbox server and the headless Chrome** the test suites need. |

## What is in the pictures

`img/` is mostly gitignored, with one deliberate exception: `warehouse-*` — the
owner's design reference for the 3D warehouse room and the screenshots of each
stage built from it. They are tracked because three stages in a row were judged
from a chat attachment that nobody could find afterwards.

## The run logs

[history/](history/) — one file per night shift or fix, newest last, with an
index of its own. They are records rather than instructions: each says what was
found, what was changed, how it was checked, and what was deliberately left
alone. When `CLAUDE.md` says "the log is …", that is where it went.
