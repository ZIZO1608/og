# Night shift 2026-09-25 — the whole system, checked

> **STATUS: IN PROGRESS.** Phases 0–8 (checking) are done. Fixes, quarantine and docs follow;
> this file is rewritten at the end with the final counts and the Arabic summary.

## 🔴 Needs you today

### 1. Receipts cannot print from the till since the move to the VPS

The shop has run on the VPS since 07:15 UTC today. The VPS still says `receipt.transport = usb`,
which only works on a Windows laptop with the printer plugged in. The print agent that should
carry receipts to the laptop is not set up:

- `agent/agent-config.json` points at `http://localhost:8090` (the laptop, which is now a
  read-only copy);
- it signs in as `hussam`, an account removed on 17 Sep;
- it has no receipt settings at all;
- its scheduled task (`OGLabelAgent`) still runs `D:\DESKTOP\OG System Demo\agent\print-agent.js`
  — the retired folder — and last stopped at 00:41 today.

**Do this, in order (10 minutes, needs the administrator password once):**

1. In `D:\DESKTOP\OG System\agent\agent-config.json` set `serverUrl` to
   `https://shop.ogsports1.com`, `username` to `cashier` and `password` to the cashier's password
   (it is in `server/data/ACCOUNTS.private.md`), and add `"receiptShare": "\\\\localhost\\OGRECEIPT"`
   and `"receiptStation": "shop"`.
2. Right-click `D:\DESKTOP\OG System\agent\install-agent.bat` → **Run as administrator**. This
   points the scheduled task at the new folder and starts it.
3. On `shop.ogsports1.com` as the owner: **Settings → Receipt printer → "The shop laptop's
   agent"**, station `shop`, Save.
4. Ring a test sale and reprint it. Paper should come out within a few seconds.

### 2. The shop's Telegram bot tells "Ahmad Sabagh" everything, including the day's takings

The bot has two linked chats. One is yours (`Zaven Jooharian`). The other is a private chat
titled **Ahmad Sabagh**, linked on 8 Sep by Hussam's (removed) account. Because it was linked
before chats had owners, the code treats it as trusted and unfiltered:

- it receives **every** message kind, including the five money ones (tonight's takings, the
  morning digest, cash variance, driver cash, dead stock);
- it can type `/today` at any time and get the day's takings and the expected drawer, and
  `/job` shows customer names.

If Ahmad should no longer receive the shop's figures: **Settings → (developer) Telegram →
the "Ahmad Sabagh" row → Disconnect.** One press. (Only you can decide this; nothing was
changed.)

### 3. The VPS that now holds the whole shop has an open front door

The VPS now has every customer, every sale and every password hash on it. Its SSH allows
**root to log in with a password**, there is **no firewall** (`ufw` off) and **no fail2ban**, and
the **Coolify dashboard is on plain http** at port 8000 (its password travels unencrypted). A
kernel update is also waiting for a reboot. The exact commands, in a safe order, are under
**VPS recommendations** below. Nothing was changed on the VPS.

## What was checked (so far)

- Git, secrets, the repo on GitHub — section 2 of this report once finished.
- A scratch copy of the shop on this laptop (port 18090, no cloud keys, bogus bot tokens, no
  printer, no push keys, no Telegram chats), every screen for every role in English and Arabic
  at desktop and five phone widths: **1,230 checks, 1 failed** (the laptop's network changed
  mid-run; the re-run passed 315/315).
- The core flows through the shop's own routes, read back from SQLite: **55 of 55**.
- The mirror's shape (**green**, 56 tables) and freshness (**the VPS beat 0 minutes ago**).
- The VPS (read-only), og-track from outside, the website's door, both bots (`getMe` only),
  every reminder rule at every hour (**28 rules, 0 errors**).
