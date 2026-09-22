> **Superseded by `TONIGHT.md` (day shift 06, 22 Sep 2026).** Kept for its history; follow TONIGHT.md.

# Morning — after night shift 05

For Ahmad. Night shift 04 wrote this checklist; night shift 05 did part of it. Every step is
marked **DONE TONIGHT**, **YOURS** or **CHANGED**. Work top to bottom.

- **main** (`631a292`, pushed): the proxy fix only (b6e0940), `OG_CERT_EXTRA_SANS` (2432253),
  `_tools/` ignored, docs. Started on the till at 01:43, checked, then stopped again; see
  CLAUDE.md, night shift 05.
- **`night/online-offline`** (pushed, **not merged**): everything else, rebased onto
  that main. It merges only after the drill at the end of this page passes.

Addresses: laptop's tunnel end **10.8.0.2**, VPS's tunnel end **10.8.0.1**, VPS public
**152.239.114.129**, shop Wi-Fi **10.10.99.9**.

---

## 0. YOURS, first: change the owner's password

During the night shift, a masking command failed and **printed `abode`'s password into the Claude
session transcript on this laptop** (`%USERPROFILE%\.claude\projects\…`). It went nowhere else, but
it is now in a file. Changing passwords was forbidden tonight, so it was not changed. Sign in as a
developer → Settings → Access → `abode` → **New password**, and give him the new one.

## 1. YOURS: the WireGuard test (NEW; do this before anything on the VPS)

Everything below the tunnel depends on one unknown: **does the shop's own internet line carry
WireGuard's UDP?** Syrian lines sometimes drop UDP. Test it before spending any time on Coolify.

**At the shop, on the shop's own line, with PIA disconnected** (the script refuses otherwise:
through PIA the answer is about PIA's line, not the shop's).

1. Install WireGuard for Windows on the laptop:
   <https://download.wireguard.com/windows-client/wireguard-installer.exe>
2. On the VPS, as root: `bash tools/wg-test/vps-side.sh`. It installs WireGuard, makes the keys
   once, writes `wg0.conf` (10.8.0.1/24, UDP 51820), opens 51820/udp in ufw if ufw is on, and
   prints **the VPS public key**. It refuses to overwrite a `wg0.conf` it did not write, and it
   touches no Docker or Coolify network. **Also check hPanel's own firewall lets UDP 51820 in.**
3. On the laptop, in an **Administrator** PowerShell:
   ```powershell
   cd "D:\DESKTOP\OG System Demo"
   powershell -ExecutionPolicy Bypass -File tools\wg-test\till-side.ps1
   ```
   It prints **this laptop's public key**. Back on the VPS: `bash tools/wg-test/vps-side.sh <that key>`.
4. On the laptop again:
   `powershell -ExecutionPolicy Bypass -File tools\wg-test\till-side.ps1 -ServerPublicKey <the VPS key>`

**Pass** looks like `WORKS - the tunnel is up and 10.8.0.1 answers in 38 ms (4/4 pings).` Leave
the tunnel installed.

- `UDP BLOCKED` → read `tools/wg-test/FALLBACK.md`. Try UDP port 443 or 53 first; then wstunnel
  (recommended); a reverse SSH tunnel is the one-afternoon stopgap. The script removes the tunnel
  again.
- `VPS UNREACHABLE` → the VPS is down or its firewall drops everything. The tunnel is removed again.

*Seen failing tonight, nothing else:* the laptop has no WireGuard, so `-CheckOnly` stopped at
"not installed"; `vps-side.sh` refused without root; `bash -n` passed. Neither has been run
against the VPS. That was forbidden tonight.

## 2. YOURS: ZeroTier is still installed and joined

Service `ZeroTierOneService` is running on network **`76fc96e49897c3c8`**, as **10.132.90.237**.
WireGuard is the chosen route, so this network is unused. To leave it (Administrator PowerShell):

```powershell
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q leave 76fc96e49897c3c8
```

or uninstall it entirely (Settings → Apps → ZeroTier One). The new certificate names its address.
That is harmless and needs no action.

## 3. YOURS: the firewall (node.exe is open on every port, to every address)

The night shift was not elevated, and was told never to touch the firewall. Unchanged from night
shift 04 (Administrator PowerShell):

```powershell
cd "D:\DESKTOP\OG System Demo"
powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1
```

**Pass**: `https://10.10.99.9:8443` still opens from a phone on the shop Wi-Fi. `… -Undo` reverses it.
The script is on the branch. Run it from the branch worktree, or after the merge.

## 4. CHANGED: the lines in `server/.env`

**Done tonight** (backup of the old file: `server/.env.bak-ns05`, gitignored):
- `OG_TRUST_PROXY=1` **deleted**.
- `OG_CERT_EXTRA_SANS=10.8.0.2,10.10.99.9` **added**. It replaces the old `OG_TUNNEL_ADDR` step;
  **do not add `OG_TUNNEL_ADDR`**. It only ever named the certificate, and this does that already.
- `OG_ORIGINS`: untouched; it already lists `https://shop.ogsports1.com`.

**Yours, and only once step 1 said WORKS:**
```dotenv
OG_PROXY_ADDR=10.8.0.1
```
Until then, leave it unset. Unset means no visitor header is believed from anyone, which is the
safe state for a till with no proxy in front of it.

**Yours, after the merge:** `OG_VPS_API_KEY=<openssl rand -hex 32>`. The door it opens is branch
code. Keep the value, because og-bridge needs the same one (step 8).

## 5. DONE TONIGHT, except the trust: the certificate

Made once, with every name. It is valid to **24 Dec 2028**:
DNS `localhost, DESKTOP-TG3H1NS, DESKTOP-TG3H1NS.local, og-till`;
IP `127.0.0.1, 10.132.90.237, 172.20.10.2, 10.102.4.158, 10.8.0.2, 10.10.99.9`.
The old one is in `server/data/certs.bak-ns05/`.

- **YOURS, the till:** the panel's first Start of the day finds the new certificate untrusted and
  asks for **administrator once** (Windows' UAC prompt). Press Yes. Or run it yourself now:
  `cd server && npm run cert:trust`. **Pass**: `https://localhost:8443` opens with a padlock, not
  a red page.
- **Every phone and tablet sees the warning once more.** This is a new key, so each device shows
  "your connection is not private / not a known authority" one time. Somebody presses
  **Advanced → Continue**, and from then on it is quiet. The difference from before: phones on the
  shop Wi-Fi at **`https://10.10.99.9:8443`** now get a certificate that names that address. The
  old one did not, so they were also getting a name mismatch.
- **Copy the PUBLIC half to the VPS** (needed from step 8; never `og-key.pem`):
  ```bash
  scp server/data/certs/og-cert.pem root@152.239.114.129:/data/og/till.pem
  ```
  The repository does not keep a copy in `deploy/shop-proxy/`. The VPS mount is the only place.
  **Copy it again after every `npm run cert`**, then restart the proxy and og-bridge.

## 6. CHANGED: restarting the shop

**Main's part is done**: restarted once at 01:43, with every check green. The shop was stopped
before the night shift, and it is stopped now. Open it normally in the morning.
**The drill needs the branch running on the till**, because the amber screen, the VPS's door and
the write queue are branch code. The evening of the drill, after closing (the night shift's own
worktree for the branch was removed, so the live folder can switch):

```bash
cd "D:/DESKTOP/OG System Demo" && git fetch && git switch night/online-offline
```

Then the panel's **Restart** (the Full refresh).
If the drill fails: `git switch main`, then Restart, and the till is back on tonight's main.
If it passes: merge, `git switch main && git pull`, then Restart.
**Pass**: no startup notice about `OG_TRUST_PROXY`, the public origin or the certificate's addresses.

## 7. YOURS: Supabase, three files, in order, in the SQL Editor

1. `server/supabase/029_second_lock.sql`: only if it has not been run (it only revokes, so it is
   safe to run twice).
2. `server/supabase/030_erp_access.sql`, then on its own, with a new password
   (`openssl rand -hex 24`): `ALTER ROLE og_vps PASSWORD '<password>';`. Read the list it prints:
   every table except `users` and `sync_state`, and `users` with `SELECT` only.
3. `server/supabase/031_till_status.sql`. Its last line prints `lineage_id` and `beat_at`.

Download the database certificate: Supabase → Project Settings → Database → **SSL** → Download.

**Also, older than tonight:** `npm run supabase:check` is red because the mirror's `users` has no
`pw_box` or `last_login_at`, and it holds eight accounts this database does not have. It was red
before the restart and exactly as red after. Look at it before the drill, or the drill's last check
cannot go green (see step 10).

## 8. YOURS: the VPS (og-bridge, then the proxy)

```bash
scp <downloaded supabase certificate> root@152.239.114.129:/data/og/supabase-ca.crt
ssh root@152.239.114.129 "chmod 644 /data/og/*"
```

**og-bridge**: Coolify → + New Resource → this repository, branch **`night/online-offline`** for the drill (switch it to `main` after the merge):

| Field | Value |
|---|---|
| Base Directory | `/vps/og-bridge` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `8787` |
| Domains | **none** |
| Network aliases | `og-bridge` |
| Health check path | `/healthz` |
| Storage | directory mount `/data/og` → `/etc/og-till` |

Environment (see `vps/og-bridge/.env.example`):

| Variable | Value |
|---|---|
| `OG_TILL_URL` | `https://10.8.0.2:8443` |
| `OG_TILL_CA` | `/etc/og-till/till.pem` |
| `OG_VPS_API_KEY` | the value from step 4 |
| `OG_MIRROR_URL` | the **session pooler** string, with user `og_vps.<project-ref>` and the step 7 password |
| `OG_MIRROR_CA` | `/etc/og-till/supabase-ca.crt` |
| `OG_SNAPSHOT_USERS` | from step 9 |

**The proxy** (`deploy/shop-proxy`): redeploy with these settings:

| Setting | Value |
|---|---|
| `SHOP_UPSTREAM` | `https://10.8.0.2:8443` |
| `SHOP_TLS_NAME` | `og-till` |
| `BRIDGE_UPSTREAM` | `http://og-bridge:8787` |
| Storage | `/data/og` → `/etc/nginx/og-till` |

**CHANGED: nginx has been run for real now**: nginx 1.31.6 on this laptop, the real template,
`tools/nginx-harness.mjs`. The first `nginx -t` **failed** on a duplicate `proxy_buffering` line;
it is fixed on the branch. Then, through nginx to the branch's server (sandbox) with the till's
certificate pinned, 14 checks passed:

1. `nginx -t` passes on the real config, and nginx starts.
2. The proxy's own `/__proxy_health` answers 200.
3. `/` reaches the till through the pinned https upstream and serves the app's page.
4. `/api/health` through the proxy is the till's own answer.
5. `/api/vps/health` from outside is 404, even with the right key.
6. The same key works on the tunnel side, so that 404 comes from the proxy, not the key.
7. `/snapshot` reaches og-bridge and shows its sign-in page.
8. A forged `X-OG-Client-IP` is overwritten by nginx.
9. The rightmost untrusted `X-Forwarded-For` entry is taken as the visitor.
10. A real sign-in works through the proxy.
11. The first `/api/live` event arrives in under 2 s.
12. The live stream is still open after 30 s.
13. The sign-in rate limit trips.
14. The API rate limit trips on a burst.

With a **different** certificate pinned, 4 checks passed:

1. nginx starts.
2. `/api/` answers `503 shop_unreachable`.
3. A page request gets the "shop's internet is down" page.
4. The error log names the certificate verification failure.

Each check was seen red once. One gap: removing the stream's buffering setting on purpose did
**not** turn check 11 red (nginx streams server-sent events promptly anyway, and the till sends
`X-Accel-Buffering: no`). A 5 s read timeout did turn it red.

**Checks on the VPS**:

```bash
# on the VPS: does the till answer the VPS's door?
curl -s --cacert /data/og/till.pem --resolve og-till:8443:10.8.0.2 \
  -H "Authorization: Bearer <OG_VPS_API_KEY>" https://og-till:8443/api/vps/health
# og-bridge's view of the world: "live" while the till answers
docker exec $(docker ps -qf name=og-bridge) wget -qO- localhost:8787/healthz
```

**Confirm that the visitor's real address arrives.** Sign in once from a phone on mobile data,
then run this on the laptop:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('server/data/og.db',{readOnly:true});console.log(d.prepare('SELECT username, ip, at FROM login_attempts ORDER BY id DESC LIMIT 3').all())"
```

**Pass**: `ip` is the phone's public address, not `10.x` or `172.x`. (Ignore the `ns05-probe-*`
rows. They are from the throttle check tonight.)

## 9. YOURS: enrol the owner for the snapshot

```bash
node vps/og-bridge/src/snapshot-user.js
```

It prints `OG_SNAPSHOT_USERS=[…]` and a QR code. The owner scans the QR with an authenticator app.
Redeploy og-bridge, then sign in at `https://shop.ogsports1.com/snapshot`. Clear the terminal
afterwards, because the secret is on it.

---

## 10. The drill (after hours, before merging)

This proves the design: the shop works when its internet does not, and the outside world is told
the truth. Take about half an hour after closing. Steps 1–9 must be done. You need somebody at the
till and a phone **on mobile data** (not the shop Wi-Fi).

1. **Before.** On the phone, open `https://shop.ogsports1.com`. It must show the app, signed in.
   Open `https://shop.ogsports1.com/snapshot` and note today's takings.
   On the laptop, `cd server && npm run supabase:check` must be green (see step 7's note).
2. **Pull the cable.** Unplug the shop router's **internet** cable (WAN), not its power: the Wi-Fi
   must stay up. Start a 15-minute timer. Leave PIA alone; this is the line, not the laptop.
3. **The till keeps selling.** On the till, ring up one real small sale (or a test product you void
   afterwards), paid in cash.
   **Pass**: the receipt prints, the sale appears in Invoices, and nothing on the till says it is
   offline.
4. **Outside says the internet is down.** On the phone (mobile data), reload
   `https://shop.ogsports1.com`.
   **Pass**: the amber **"The shop's internet is down"** screen, with a link to the snapshot, and
   not "the server is not answering" or a browser error. On a phone with nothing cached, the proxy's
   bilingual page with the same words.
5. **The snapshot shows the right numbers, with their age.** Open `/snapshot` on the phone.
   **Pass**: the figures from step 1 (without the sale from step 3, which is still on the till),
   and a line saying how old they are, which keeps growing: "Last synced 14:02 — 6 min ago".
   It must not claim to be live.
6. **Reconnect** after 15 minutes. Plug the WAN cable back in.
7. **The mirror catches up.** Within about a minute, the panel's Connections card shows the cloud
   copy row green, and Settings → Mirror shows no rows waiting.
   **Pass**: `/snapshot` says "The shop is online" with Open the shop, and its figures include step 3's sale, synced "just now".
   `https://shop.ogsports1.com` shows the app again after a reload.
8. **The check is green.** `cd server && npm run supabase:check`.
   **Pass**: exit 0, and every table matches by primary key.

If all eight pass, merge `night/online-offline` and do step 6's restart. If any fails, write down
which step and what the screen said, and do not merge.

---

## Skipped tonight, and why

- **`cert:trust`, the firewall, the WireGuard install**: `net session` said not elevated. The
  firewall was forbidden in any case.
- **The VPS, Coolify, Hostinger DNS, the live Supabase**: all out of bounds. Nothing was written
  to any of them.
- **Graceful stop after the live check**: the check script crashed on its own last request (a stale
  keep-alive socket) before sending the stop. The server exited without its shutdown handler. The
  database was checked afterwards: integrity ok, no broken foreign keys.
- **The developer session from the live check** (`zizo`, created 22:43Z) is still in `sessions`.
  Removing it meant writing to the live database outside the server, or starting it a second time,
  and neither was allowed. It expires by itself in 14 days, or it ends when `zizo` signs out.
- **`p3-sql` was not re-run after the rebase**: PGlite is not on this machine tonight. The rebase
  changed nothing under `vps/` or `server/supabase/` (checked with `git diff`), so night shift 04's
  result stands.
