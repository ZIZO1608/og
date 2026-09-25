# docs/vps — putting the shop on the internet through the VPS

The runbooks written while the shop was put behind `shop.ogsports1.com` (the VPS's nginx, then
WireGuard to the till). They lived at the repository root until 25 Sep 2026 and were moved here so
the root keeps only `README.md`, `CLAUDE.md` and `DEPLOY.md`.

They are written for a person at a keyboard, step by step, in the order the work was done. The
branch names in them (`night/online-offline`, "not merged") describe the day they were written:
**everything they talk about is merged into `main` now.**

| | |
|---|---|
| [TONIGHT.md](TONIGHT.md) | **The current list** (day shifts 06, 06b and 07, 22 Sep). Every item marked done, yours or blocked. Start here. |
| [DRILL-TONIGHT.md](DRILL-TONIGHT.md) | The outage drill: 35 minutes with the shop's internet cable out, proving the till keeps selling and catches up by itself. |
| [DAY06-COOLIFY.md](DAY06-COOLIFY.md) | The two Coolify resources on the VPS (the proxy and og-bridge), click by click. |
| [DAY06-VPS-STEPS.md](DAY06-VPS-STEPS.md) | What was done on the VPS over SSH, and the steps still left there. |
| [MORNING.md](MORNING.md) | The night shift 05 checklist. **Superseded by TONIGHT.md**; kept for its history. |

The design these carry out is in [../go-live.md](../go-live.md). Secrets are named by their file in
`_secrets/` at the repository root (git-ignored) and are never written into a page.
