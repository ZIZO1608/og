# Morning — night shift 04 (online / offline)

For Ahmad. Branch **`night/online-offline`**, not merged, not published. Review first; then these
steps **in this order**. Nothing below was done tonight: every one of them needs administrator,
the live `server/.env`, the VPS, Supabase or Coolify, which the night shift was not allowed to touch.

Addresses this work expects: laptop's tunnel end **10.8.0.2**, VPS's tunnel end **10.8.0.1**,
VPS public **152.239.114.129**, shop wifi address **10.10.99.9**.

---

## 1. ZeroTier is installed and joined on this laptop — decide, then leave

Found on 21 Sep: service `ZeroTierOneService` running, network **`76fc96e49897c3c8`** joined and
approved, this laptop at **10.132.90.237**. The route chosen is WireGuard (commit 8c46670), so this
network is unused. It only worked here because the PIA VPN was also up; it proves nothing about the
shop's own line.

To leave it (Administrator PowerShell):

```powershell
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q leave 76fc96e49897c3c8
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q listnetworks
```

To remove it entirely: Settings → Apps → **ZeroTier One** → Uninstall. Leaving it joined while
step 2 has not run means node.exe accepts connections from that network on every port.

## 2. The firewall: node.exe is open to every address on Public and Private

Four inbound rules called "Node.js JavaScript Runtime" allow node.exe in on every port, from any
address. The script switches them off and allows only the shop's two ports (8090, 8443) from the
shop's wifi and from the VPS's tunnel end. Look first, then run (Administrator PowerShell):

```powershell
cd "D:\DESKTOP\OG System Demo"
powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1
```

Then open `https://10.10.99.9:8443` from a phone on the shop wifi. To undo: `… -Undo`.

## 3. WireGuard, exactly as `deploy/shop-proxy/README.md` §2–5 says

VPS `10.8.0.1/24` listening on UDP 51820; laptop `10.8.0.2/24`, `AllowedIPs = 10.8.0.1/32` (never
`0.0.0.0/0`), `PersistentKeepalive = 25`. Stop at README §5 until the handshake shows. The firewall
rule there is already covered by step 2.

## 4. The four lines in `server/.env`

```dotenv
OG_PROXY_ADDR=10.8.0.1
OG_TUNNEL_ADDR=10.8.0.2
OG_VPS_API_KEY=<paste the output of: openssl rand -hex 32>
```

**Leave `OG_ORIGINS` as it is**: checked read-only on 21 Sep, it already lists
`https://shop.ogsports1.com` (the startup notice only checks that a public name is there).
**Delete the `OG_TRUST_PROXY=1` line**: it is retired, and while it stays a startup
notice says it is being ignored. Keep the `OG_VPS_API_KEY` value; og-bridge needs the same one (step 7).

## 5. A new certificate: the tunnel address and the name `og-till`

The current one names `127.0.0.1, 192.168.1.16, 10.171.5.29`. It does **not** name the shop wifi
address **10.10.99.9**, so phones there already get a name mismatch, and it names two addresses
that are gone. **Disconnect PIA first**, and do step 1 first, or their addresses go in too.

```bash
cd server && npm run cert
```

Check what it named: it must be **127.0.0.1, 10.10.99.9, 10.8.0.2** and DNS **localhost,
DESKTOP-TG3H1NS, DESKTOP-TG3H1NS.local, og-till**:

```bash
openssl x509 -in server/data/certs/og-cert.pem -noout -ext subjectAltName
```

Then, as Administrator: `cd server && npm run cert:untrust` and `npm run cert:trust`. **Every phone
sees the "not a known authority" warning once more**, and somebody presses continue on each.

## 6. Restart the shop on this code

The panel's **Restart** (the Full refresh), once the branch is merged and pulled. The startup notices
should now show nothing about `OG_TRUST_PROXY`, the public origin or the certificate's addresses.

## 7. Supabase: three files, in order, in the SQL Editor

1. `server/supabase/029_second_lock.sql` — only if it has not been run (it only revokes; safe twice).
2. `server/supabase/030_erp_access.sql` — then, **on its own**, with a new password
   (`openssl rand -hex 24`): `ALTER ROLE og_vps PASSWORD '<password>';` — it cannot sign in before this.
   Read the list the file prints at the end: every table but `users` and `sync_state`, and
   `users` with `SELECT` only.
3. `server/supabase/031_till_status.sql` — the last line prints `lineage_id` and `beat_at`.

Download the database certificate: Supabase → Project Settings → Database → **SSL** → Download.

## 8. The VPS: the two files, then og-bridge, then the proxy

```bash
# on the laptop, from the repository root: the PUBLIC certificate, never og-key.pem
scp server/data/certs/og-cert.pem root@152.239.114.129:/data/og/till.pem
scp <downloaded supabase certificate> root@152.239.114.129:/data/og/supabase-ca.crt
ssh root@152.239.114.129 "chmod 644 /data/og/*"
```

**Copy `till.pem` again after every `npm run cert`**, then restart both containers.

**og-bridge** — Coolify → + New Resource → this repository, branch `main`:

| Field | Value |
|---|---|
| Base Directory | `/vps/og-bridge` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `8787` |
| Domains | **none** |
| Network aliases | `og-bridge` |
| Health check path | `/healthz` |
| Storage | directory mount `/data/og` → `/etc/og-till` |

Environment (from `vps/og-bridge/.env.example`): `OG_TILL_URL=https://10.8.0.2:8443`,
`OG_TILL_CA=/etc/og-till/till.pem`, `OG_VPS_API_KEY=<step 4>`, `OG_MIRROR_URL` = the **session
pooler** string with the user written `og_vps.<project-ref>` and the step-7 password,
`OG_MIRROR_CA=/etc/og-till/supabase-ca.crt`, `OG_SNAPSHOT_USERS` from step 9.

**The proxy** (`deploy/shop-proxy`) — redeploy with `SHOP_UPSTREAM=https://10.8.0.2:8443`,
`SHOP_TLS_NAME=og-till`, `BRIDGE_UPSTREAM=http://og-bridge:8787`, and storage `/data/og` →
`/etc/nginx/og-till`. Its log prints the pinned certificate's fingerprint at every start.

Checks:

```bash
# on the VPS — does the till answer the VPS's door?
curl -s --cacert /data/og/till.pem --resolve og-till:8443:10.8.0.2 \
  -H "Authorization: Bearer <OG_VPS_API_KEY>" https://og-till:8443/api/vps/health
# og-bridge's view of the world: "live" while the till answers
docker exec $(docker ps -qf name=og-bridge) wget -qO- localhost:8787/healthz
```

**nginx was not run through `nginx -t` tonight** (no nginx, Docker or WSL on this laptop), only a
structural lint. If the container will not start, its log names the line.

**Confirm the visitor's real address arrives.** Sign in once from a phone on mobile data, then on
the laptop:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('server/data/og.db',{readOnly:true});console.log(d.prepare('SELECT username, ip, at FROM login_attempts ORDER BY id DESC LIMIT 3').all())"
```

The `ip` must be the phone's public address, not `10.x` or `172.x`. If it is Coolify's own, the
Traefik version on the VPS does not append to `X-Forwarded-For` the way the config assumes; tell
the next session.

## 9. Enrol the owner for the snapshot

```bash
node vps/og-bridge/src/snapshot-user.js
```

It asks for a username and a password (12+ characters), prints `OG_SNAPSHOT_USERS=[…]` for og-bridge's
environment, and draws a QR code. Scan it with an authenticator app on the owner's phone (Google
Authenticator, Microsoft Authenticator, 2FAS). Redeploy og-bridge, then sign in at
`https://shop.ogsports1.com/snapshot` with the password and the 6-digit code. Clear the terminal:
the secret is on it.

---

## Skipped tonight, and why

- **Everything above**: administrator, the live `.env`, the live server, the VPS, Coolify, Hostinger
  DNS and Supabase were all out of bounds. The SQL is in files; the settings are in `.env.example`.
- **`nginx -t`**: no nginx, Docker or WSL here. A structural lint (`_nightshift/ns04/nglint.cjs`)
  passed and was seen to fail on a missing `;` and a stray `{`.
- **The handed-over zip** (`og-offline-network.zip`) was not in `_handover/` or `D:\Downloads`. Every
  piece was written from the prompt's specs; `_handover/` is gitignored for when it turns up.
- **`erp.submit()`**: left out, as asked.
- **The write queue carries one route** — the hand-over sheet. Every other warehouse and delivery
  write fails at least one of the four rules; the table is in CLAUDE.md, night shift 04.
- **ZeroTier**: not left, not removed (step 1 is yours).
