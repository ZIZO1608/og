# Night shift — 25 Sep 2026 — the whole OG system, checked and fixed

## بالعربي، بخمس سطور

- النظام شغّال منيح: فحصت كل الشاشات لكل الأدوار بالعربي والإنكليزي، والنسخة السحابية محدّثة (آخر نبضة من الـVPS قبل دقيقة).
- صلّحت ١٢ شغلة على فرع `night-shift/2026-09-25`، منها ٣ بالمصاري لازم تراجعها. ما لمست `main` ولا الـVPS ولا Supabase.
- **أهم شي هلق:** الفواتير ما عم تنطبع من الكاشير من وقت ما انتقل المحل عالـVPS. لازم تظبط الـagent، والخطوات الأربعة تحت.
- كمان: محادثة «Ahmad Sabagh» عالبوت بيوصلها كل شي، حتى غلّة اليوم. والـVPS بيقبل دخول root بكلمة سر، وما عليه firewall.
- ما في ولا مفتاح سري مكشوف بالـgit، بس انتبه إنو الـrepo عام (public) وكل شي فيه مقروء.

## Branches

| Branch | What it is |
|---|---|
| `night-shift/2026-09-25` (pushed) | Tonight's work: this report, its appendix, 12 fixes, one commit each. It starts at `main` (`c302c23`), so it also carries `main`'s 61 commits that were not on GitHub yet. |
| `main` | **Not touched**, locally or on GitHub (`origin/main` is still `777deb9`). No deploy ran. |

**Every local branch's commits are now on GitHub**, because the night branch carries `main`, and
`main` holds every merged branch. The one exception is `feature/offsite-backups`: another session
has one commit in progress there today, and it was left alone. There are no stashes.

No safety branch was made. You chose to leave the uncommitted panel and QR work in
`D:\DESKTOP\OG System` alone: it is still there, uncommitted, exactly as it was.

The work was done in a separate worktree (`D:\DESKTOP\og-night-shift\repo`), so the folder the
standby runs from never had a branch checked out under it.

## Traffic lights

| | | |
|---|---|---|
| 🔴 | Printing | Receipts cannot print since the VPS switch |
| 🔴 | Telegram | Ahmad's chat receives the takings |
| 🔴 | VPS security | Root logs in with a password; no firewall |
| 🟢 | VPS health | Up 5 days, 19% disk, all healthy |
| 🟡 | Git | `main` is 61 commits ahead, unpushed (yours, on purpose) |
| 🟢 | Secrets | No live key in any git object |
| 🟢 | Server boots | Scratch copy boots clean and isolated |
| 🟢 | Screens & tabs | 1,249 checks after the fixes, 0 failed |
| 🟢 | Permissions | Every route gated; invoice leak fixed on the branch |
| 🟢 | Money maths | Three lira+dollar sums fixed on the branch |
| 🟢 | I18N / RTL | 3,532 keys in both languages |
| 🟢 | Supabase shape | All 56 tables match |
| 🟢 | Supabase freshness | VPS beat 0 minutes ago |
| 🟢 | og-track live | Branded pages, TLS to December |
| 🟢 | og-track ↔ Supabase | Same project, publishable key only |
| 🟢 | Website bridge | Wrong keys refused; contract current |
| 🟡 | og-bridge (`/snapshot`) | Built from an old branch; watches the laptop |
| 🟢 | Web Push | Keys survived the move |
| 🟢 | Docs | Corrected tonight |

## 🔴 Needs you today

### 1. Receipts cannot print from the till (fix before the shop opens)

Since 07:15 UTC the till is the VPS. It still has `receipt.transport = usb`, and a server in a
data centre cannot reach a USB printer in Aleppo. The print agent that carries receipts to the
laptop is not set up:

- `agent/agent-config.json` points at `http://localhost:8090` (the laptop, now a read-only copy);
- it signs in as `hussam`, an account removed on 17 Sep;
- it has no receipt settings;
- its scheduled task still runs `D:\DESKTOP\OG System Demo\...`, the retired folder, and last
  stopped at 00:41 today.

**Do this (10 minutes, one administrator prompt):**

1. Edit `D:\DESKTOP\OG System\agent\agent-config.json`:
   - `serverUrl`: `https://shop.ogsports1.com`;
   - `username`: `cashier`;
   - `password`: the cashier's (in `server/data/ACCOUNTS.private.md`);
   - add `"receiptShare": "\\\\localhost\\OGRECEIPT"` and `"receiptStation": "shop"`.
2. Right-click `D:\DESKTOP\OG System\agent\install-agent.bat` → **Run as administrator**.
3. On `shop.ogsports1.com` as the owner: **Settings → Receipt printer → "The shop laptop's
   agent"**, station `shop` → Save.
4. Reprint any sale. Paper should come out within seconds.

### 2. The shop's Telegram bot sends "Ahmad Sabagh" everything

The bot has two chats: yours and a private chat titled **Ahmad Sabagh**, linked on 8 Sep by
Hussam's removed account. It was linked before chats had owners, so the code trusts it
completely:

- It receives every message, including the five about money: the day's takings, the morning
  digest, cash differences, driver cash and dead stock.
- It can type `/today` at any time for the takings and the expected drawer, and `/job` for
  customer names.

If Ahmad should not get these: **Settings → (developer) Telegram → the "Ahmad Sabagh" row →
Disconnect.** One press. Nothing was changed tonight; this one is your decision.

### 3. The VPS has the whole shop on it, and its front door is open

- Root can log in over SSH **with a password**.
- There is **no firewall** and **no fail2ban**.
- The **Coolify dashboard is on plain http** (port 8000), so its password crosses the internet
  unencrypted.

Nothing was changed on the VPS. The commands are under **VPS recommendations**. Do them at a
quiet moment, with a second terminal open.

## Fixed tonight

### Review these first: they change money or who sees money

| Area | Was wrong | Does now | Commit | Verified |
|---|---|---|---|---|
| Permissions | Yalla Wear's invoices (what the shop owes them, every payment) went to every `print.read` account, the cashier included, while the same jobs had their cost stripped | Only to `cost.read` or `money.read`; the tab is drawn only for them | `eeb40ca` | yes: owner 1, warehouse 1, Yalla 1, cashier 0 |
| Money | The WhatsApp end-of-day summary added dollar cents to lira ($16.30 counted as 1,630 SYP) | "Sales: 6,747 SYP + $16.30", with payment lines per currency | `5d0066b` | yes, against SQL |
| Money | The sales and till-today exports put dollar cents in the lira column (181,178 "SYP" for 116,772 SYP + $644.06) | A column per currency, totalled apart | `ef09cc0` | yes, against SQL |

### The rest

| Area | Was wrong | Does now | Commit | Verified |
|---|---|---|---|---|
| Print screen | "▲ 66.7% vs last month" compared against a made-up number; on-time read NaN% with no jobs; cashier saw "Paid 0 · Profit 0" and "950 / 0" on every card | Real last month, "—" with no jobs, cost cards only with `cost.read` (profit only with `profit.read`), same for the export | `4e3bc24` | yes: cashier en/ar, warehouse, owner |
| Search | The topbar search and Ctrl+K offered archived and merged customers; showed dollar invoices as lira; "pcs" in English on Arabic screens (5 places) | Uses the one customer-search rule; own currency; bilingual | `4b02db0` | yes, with an archived customer and a dollar sale |
| Settings | "Open the map" landed on Goods arrived | Opens the shelf map | `46bfc88` | yes |
| Scripts | The Readiness check and Check printers, both "read-only" and both runnable while the shop is open, applied pending database migrations | Open the database read-only; preflight names what is waiting | `ac93f34` | yes: 66 records stay 66 (the old path made it 67) |
| Cloud docs | The Supabase README said `CATCH-UP.sql` covers 001–029; following it on a new project would skip 002–007 and fail | 001–007 first, then CATCH-UP (008–029, 036) | `19f93b6` | read against the file |
| Panel | The job table's header described a job that no longer exists | Correct | `fe65103` | comment only |
| Service worker | — | `og-system-v309` → `v310`, so open tabs receive tonight's changes | `881f923` | precache checked: 98 entries, none missing |
| Docs | CLAUDE.md said the repo is private, the boot pull exists, og-track is on Railway, "the one test"; README said `site/` is ogsports1.com | Corrected, plus an audit section at the top | `5a33d9d` | — |
| Website contract | `/api/ext` "only while the laptop is on" | Whenever the shop's server is up (the VPS) | `9d1a922` | measured from outside: 401 without the key |

## Run in the Supabase dashboard

Nothing. No cloud SQL was written tonight. `supabase:drift` is green: the next push will land.

## Quarantined files

**None moved.** The 39 files nothing in the code names are documentation, test suites run by hand,
or tools for a person. `_quarantine/QUARANTINE.md` lists them with the evidence.

**Your call:** `tools/night-mode/undo.mjs` (4 KB). Nothing names it; it is the check for
`undo_035_night_requests.sql`.

## Old reports — keep or quarantine?

These are the project's history, tracked in git: `docs/history/*.md` (night shifts 01–03, fix 04,
fix 05, quick fix), `docs/vps/DAY06-*.md`, `docs/vps/DRILL-TONIGHT.md`, `docs/vps/MORNING.md`,
`docs/vps/TONIGHT.md`, `docs/website/UPDATE-*.md`, `docs/connections-map.md`,
`tools/tonight/drill.md`. **Recommendation: keep them.** They cost nothing and explain decisions.

## Not fixed, on purpose

| What | Why not tonight | One next step |
|---|---|---|
| Receipts via the agent | Needs a password and administrator | The four steps above |
| The Ahmad chat | Your decision | Disconnect it in Settings |
| VPS security | Rules forbid SSH/firewall changes overnight | The commands below |
| og-bridge still builds from `night/online-offline` and watches the laptop (`OG_TILL_URL=https://10.8.0.2:8443`); the VPS shop has no `OG_VPS_API_KEY` | A Coolify change, plus a new key on the VPS | After you push `main`: in Coolify, switch og-bridge to branch `main`, set `OG_TILL_URL=http://10.8.0.1:8090`, add the same `OG_VPS_API_KEY` to `/data/og-shop/og-shop.env`, restart both |
| `/night` is not live (the proxy serves the app shell there) | Night mode is on `main`, which is not pushed | Push `main` when you are ready; the proxy and og-bridge rebuild from it |
| 15 messages to Yalla Wear (2–16 Sep) wait in the outbox; they would all arrive the day they link their bot | Changing what the outbox drops is a behaviour decision | Before they link: add one rule to `drain()` in `server/lib/telegram.js` — a live event older than 3 days is marked sent with `error = 'stale'` instead of going out |
| Backups exist only on the VPS disk (one so far, 07:18) | Being built on `feature/offsite-backups` by another session | Finish that branch |
| `www.shop.ogsports1.com` has no DNS record | DNS change | Add a CNAME to `shop.ogsports1.com`, or drop it from the proxy and `OG_ORIGINS` |
| The driver's `day` figures add currencies together | Sent to the phone but drawn nowhere | Drop `day` from `GET /api/deliveries`, or make it a pair |
| `data-st` and `data-cp` are each used by two modules | They do not collide today | Rename the stock count's to `data-sk` next time that file is touched |
| `viewShiftHome` / `viewBackHome` are dead code | Removing code needs a reason to open those lines | Remove them next time `app-dashboard.js` is edited |

## VPS recommendations

Each command runs **as root on the VPS**, one at a time. **Keep your current SSH session open**
until a new login works.

1. **Stop password logins for root** (key logins keep working; two keys are authorised):
   ```
   sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf
   sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
   sshd -t && systemctl reload ssh
   ```
   - Changes: password guessing stops working.
   - Risk: if both keys are lost, only Hostinger's browser console gets you in.
   - Test from a second terminal first: `ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1 true`.
2. **fail2ban:**
   ```
   apt install -y fail2ban && systemctl enable --now fail2ban
   ```
   - Changes: an address with repeated SSH failures is blocked for a while.
   - Risk: low.
3. **Firewall: use Hostinger's hPanel firewall, not ufw.**
   - Docker publishes ports around ufw, so ufw would not close 8000, 32768 or 57176 anyway.
   - Allow: 22/tcp, 80/tcp, 443/tcp, 443/udp, 51820/udp.
   - Everything else closed.
   - Reach Coolify through a tunnel instead: `ssh -L 8000:localhost:8000 root@10.8.0.1`, then
     open `http://localhost:8000`.
   - Risk: a mistake in the rules can cut the tunnel. Keep 51820/udp open.
4. **Reboot** (a kernel update is waiting) at a quiet hour:
   ```
   reboot
   ```
   - The shop is down for about 2 minutes.
   - Docker waits for WireGuard (`og-after-wireguard.conf`), so `og-shop` comes back by itself.
   - Afterwards, `https://shop.ogsports1.com/api/health` should say `"role":"primary"`.
5. **Two services that are not OG run on this box with public ports:** OpenClaw and Evolution API
   (a WhatsApp gateway). If nobody uses them, stop them in hPanel/Coolify. Each one is another way
   into the machine that holds the shop.

## Morning checklist

1. **Printing:** the four agent steps (before 13:00).
2. **Telegram:** disconnect the "Ahmad Sabagh" chat, if that is what you want.
3. **Review** the three `[REVIEW: money]` commits on `night-shift/2026-09-25` (the rest are
   small).
4. **Merge** in `D:\DESKTOP\OG System`:
   - commit the panel/QR work that is sitting there first;
   - then `git merge night-shift/2026-09-25`;
   - a conflict, if any, will be the `CACHE` line in `sw.js` (keep the higher number) or
     `CLAUDE.md`.
5. **Send it to the shop:** `cd server && npm run vps -- deploy`. Open tills update themselves.
6. **On this laptop**, press **Restart** in OG System so the standby runs the same code.
7. **VPS:** commands 1–2 now; 3–4 at a quiet hour.
8. **Tidy:** `git worktree remove D:\DESKTOP\og-night-shift\repo` once merged. The branch stays.

## Appendix

`NIGHT-SHIFT-APPENDIX.md`: the full system map, every route and who may call it, every script,
every outside connection, and the check outputs.

Logs, screenshots and the scratch copy are in `D:\DESKTOP\og-night-shift\` (not in git; the scratch
database is a copy of the real shop and stays on this laptop).
