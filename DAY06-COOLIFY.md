# Coolify — the two resources, click by click (day shift 06)

For Ahmad, in the Coolify UI on the VPS (`152.239.114.129`). Nothing here was clicked by the day
shift: it had no hands in Coolify. Every secret is named by its **file** in `_secrets/` on the shop
laptop (`D:\DESKTOP\OG System Demo\_secrets\`). Open the file, copy the value, paste it into
Coolify. Never paste one into a chat.

**Before either resource:**

1. **WireGuard is up on both ends.** The VPS end was done on 22 Sep (`wg show wg0` on the VPS
   lists the till's key). The laptop end is TONIGHT.md step 3.
2. **`/data/og/till.pem` is on the VPS.** It is the till's public certificate. Its SHA-256
   fingerprint must read `E6:E2:30:C3:3A:F0:9F:57:5C:5E:7F:D0:0F:A3:18:D2:CE:72:A1:50:6D:69:35:77:F6:85:03:7B:D7:CB:B3:8E`.
   If the day shift could not copy it (TONIGHT.md says which), from the repository root:
   `scp server/data/certs/og-cert.pem root@152.239.114.129:/data/og/till.pem`
3. **`/data/og/supabase-ca.crt` is on the VPS.** In Supabase: Project Settings → Database → SSL →
   Download. Then `scp <file> root@152.239.114.129:/data/og/supabase-ca.crt` and
   `ssh root@152.239.114.129 "chmod 644 /data/og/*"`.

**Both resources build from branch `night/online-offline`, NOT `main`, until the drill passes and
the branch is merged.** `main` has only the older proxy (plain http, no certificate pin), and no
`vps/og-bridge/` at all. After the merge, change **Branch** to `main` on both and redeploy.

---

## 1. og-bridge first (the proxy's `/snapshot` points at it)

Coolify → your project → **+ New Resource** → **Private Repository (with deploy key)** → the
`og-deploy` key → `git@github.com:ZIZO1608/og.git`.

| Field | Value |
|---|---|
| Branch | `night/online-offline` |
| Build pack | `Dockerfile` |
| Base Directory | `/vps/og-bridge` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `8787` |
| Port mappings | *(empty)*: it must not be reachable from the internet |
| **Domains** | ***(empty)*** |
| **Network aliases** | **`og-bridge`**: the proxy finds it by this name |
| Health check | path `/healthz`, port `8787` |

**Storage** → **+ Add** → **Directory Mount**: source `/data/og`, destination `/etc/og-till`.

**Environment Variables** (runtime, **not** build variables):

| Key | Value |
|---|---|
| `OG_TILL_URL` | `https://10.8.0.2:8443` |
| `OG_TILL_CA` | `/etc/og-till/till.pem` |
| `OG_VPS_API_KEY` | the contents of **`_secrets/og_vps_api_key.txt`**. The same value goes into the laptop's `server/.env` tonight (`server/.env.next` already has it). |
| `OG_MIRROR_URL` | `postgresql://og_vps.wsuqoippcxcwoszcgagc:` + the contents of **`_secrets/og_vps.txt`** + `@<the session pooler host>:5432/postgres`. Take the host from Supabase → **Connect** → **Session pooler** (it looks like `aws-0-<region>.pooler.supabase.com`). The user MUST be written `og_vps.<project-ref>` exactly like that. |
| `OG_MIRROR_CA` | `/etc/og-till/supabase-ca.crt` |
| `OG_SNAPSHOT_USERS` | the one JSON line from TONIGHT.md's owner-enrolment step (Part F). Leave it `[]` for the first deploy. |

`og_vps` cannot sign in until `030_erp_access.sql` and its `ALTER ROLE` have run (TONIGHT.md, the
Supabase steps). Deploy og-bridge **after** those.

**Deploy.** Then check, from an SSH session on the VPS:

```bash
docker ps --format '{{.Names}}  {{.Status}}' | grep -i bridge      # "(healthy)" after ~30 s
docker exec $(docker ps -qf name=bridge) wget -qO- http://127.0.0.1:8787/healthz
```

**Pass:** the JSON says `"mode":"live"` while the shop is open and the tunnel is up. `mirror` means
the shop is not answering, and the snapshot serves the cloud copy. Any other answer: read
`docker logs $(docker ps -qf name=bridge) --tail 50`. The usual causes are:
- a wrong `OG_MIRROR_URL` user (`og_vps.<ref>`, not `og_vps`);
- `030` not yet run;
- `till.pem` missing.

## 2. shop-proxy (nginx) for `shop.ogsports1.com`

**+ New Resource** → the same repository and key.

| Field | Value |
|---|---|
| Branch | `night/online-offline` |
| Build pack | `Dockerfile` |
| Base Directory | `/` (the image copies from `deploy/`, so the context is the repository root) |
| Dockerfile Location | `/deploy/shop-proxy/Dockerfile` |
| Ports Exposes | `8080` |
| Port mappings | *(empty)*: Coolify's own proxy carries 443 to it |
| Network aliases | *(empty)* |
| **Domains** | **`https://shop.ogsports1.com`** (DNS already points there; nothing to change in hPanel) |
| Health check | path `/__proxy_health`, port `8080` |

**Storage** → **+ Add** → **Directory Mount**: source `/data/og`, destination `/etc/nginx/og-till`.

**Environment Variables** (runtime):

| Key | Value |
|---|---|
| `SHOP_UPSTREAM` | `https://10.8.0.2:8443` |
| `SHOP_TLS_NAME` | `og-till` |
| `BRIDGE_UPSTREAM` | `http://og-bridge:8787` |

**Both containers must be on the same Docker network** for `og-bridge` to resolve. Resources in
the same Coolify project and environment, on the same server and destination, share the
`coolify` network. If `/snapshot` answers "not available right now", open each resource →
**Advanced** → check that **Connect to Predefined Network** is on, and redeploy.

**Deploy.** Then check, from an SSH session on the VPS:

```bash
docker ps --format '{{.ID}}  {{.Names}}  {{.Status}}'   # find the proxy's row (it shows port 8080)
P=<the proxy's ID from that list>
docker logs --tail 30 $P
```

**Pass (log):**
- Nothing in red, and no `emerg`.
- One block printing the pinned certificate: `subject=CN=OG System (DESKTOP-TG3H1NS)`, the names
  including `DNS:og-till` and `IP Address:10.8.0.2`, and
  `sha256 Fingerprint=E6:E2:30:…:CB:B3:8E`.
- If it says the certificate is missing or a placeholder, `/data/og/till.pem` is not there, or
  the mount is wrong.

```bash
# the tunnel, from INSIDE the container (proves Docker routes to wg0)
docker exec $P wget -qO- --no-check-certificate https://10.8.0.2:8443/api/health
# the same through nginx itself: its pinned certificate, its own name check
docker exec $P wget -qO- http://127.0.0.1:8080/api/health
docker exec $P wget -qO- http://127.0.0.1:8080/__proxy_health        # "proxy ok"
```

**Pass:**
- The first two print the till's own `{"ok":true,…}`. The first proves the route; the second
  proves the pin and the name `og-till`.
- If the first works and the second answers `503 shop_unreachable`, the pinned file is not this
  till's certificate. Copy it again and restart the container.
- If the first hangs, the tunnel or the laptop's firewall is the problem, not nginx. Check
  `sysctl net.ipv4.ip_forward` (must be `1`) and `wg show` on the VPS, then TONIGHT.md's firewall
  step.

**Last:** a phone on **mobile data**, not the shop Wi-Fi, opens `https://shop.ogsports1.com` and
gets the OG System sign-in with a padlock. From the shop Wi-Fi this proves nothing.

## 3. Afterwards

- Sign in as the owner → Settings → set `shop.public_url` to `https://shop.ogsports1.com`
  (Telegram job links need it).
- After **every** `npm run cert` on the laptop, repeat the `scp` of `till.pem` and restart both
  containers. Until then, nginx refuses every request with "the shop's internet is down".
