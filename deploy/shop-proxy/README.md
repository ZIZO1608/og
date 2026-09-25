# `shop.ogsports1.com` — putting the shop online without moving it

Written for whoever sets it up, at the VPS and at the shop laptop. About an
hour, most of it copying keys between two windows.

## What this builds

```
   a phone, anywhere
        │  https://shop.ogsports1.com
        ▼
   VPS (Coolify + this proxy)          152.239.114.129
        │  private WireGuard link, 10.8.0.0/24
        ▼
   shop laptop  ── OG System.exe ── the database, both printers
```

**The shop's server never moves.** It stays on the laptop in Aleppo, which is
the only reason the till keeps working when the internet dies: the price, the
stock check and the receipt all go through that server on every single sale.
This container is only a public address for it.

What you get:

- `shop.ogsports1.com` opens the shop from anywhere, with a real certificate
- the internet dies → **the till carries on**, and only the view from outside
  goes away
- the internet comes back → the cloud copy catches up by itself, no button
- no ports opened on the shop's router, and no static IP needed there

## Why WireGuard, and not Tailscale or ZeroTier

Both of those were tried and neither can be used from Syria. They are US
companies, and the part that breaks is not the encryption — it is the **login
server** that introduces your two machines to each other. That is the piece
sanctions reach.

WireGuard has no company in it. It is software on your own two machines, and
the "meeting point" is your own VPS, which already has a public IP. There is
no account to create, no login to be refused, and nothing that can stop
working because of where the shop is.

It is also in the Linux kernel and has a signed Windows installer, so neither
end depends on a service staying in business.

---

## 1. DNS — 2 minutes

hPanel → **Domains** → `ogsports1.com` → **DNS records**:

| Type | Name | Points to | TTL |
|---|---|---|---|
| `A` | `shop` | `152.239.114.129` | default |

Just `shop`, not the whole name — Hostinger adds the domain for you.

> Do not touch the `@` or `www` records. Those are the live store, and this is
> a separate name beside it.

Check from your own machine before moving on:

```bash
nslookup shop.ogsports1.com
```

It must answer `152.239.114.129`. Usually 5–30 minutes.

---

## 2. WireGuard on the VPS — 10 minutes

SSH in (hPanel → VPS → **Browser terminal**, or `ssh root@152.239.114.129`).

**2a. Install it and make the server's keys:**

```bash
apt update && apt install -y wireguard
cd /etc/wireguard
umask 077
wg genkey | tee server.key | wg pubkey > server.pub
echo "SERVER PUBLIC KEY:"; cat server.pub
echo "SERVER PRIVATE KEY:"; cat server.key
```

Copy both somewhere for a moment. The **public** key goes to the laptop; the
**private** key stays here and goes in the file below.

**2b. Write the config** — `nano /etc/wireguard/wg0.conf`:

```ini
[Interface]
Address    = 10.8.0.1/24
ListenPort = 51820
PrivateKey = PASTE_SERVER_PRIVATE_KEY_HERE

[Peer]
# the shop laptop — its public key goes here after step 3
PublicKey  = PASTE_LAPTOP_PUBLIC_KEY_HERE
AllowedIPs = 10.8.0.2/32
```

Save (Ctrl+O, Enter, Ctrl+X). Leave the laptop's key as a placeholder for now.

**2c. Open the port and start it:**

```bash
ufw allow 51820/udp   || true
systemctl enable --now wg-quick@wg0
wg show
```

`wg show` should print an interface called `wg0`. It will say no handshake yet
— nothing is connected at the other end.

---

## 3. WireGuard on the shop laptop — 10 minutes

**3a.** Download the Windows installer from **wireguard.com/install** and run
it.

**3b.** Open WireGuard → **Add Tunnel** → **Add empty tunnel…**

It generates a key pair and shows the **public key** at the top. **Copy that
public key** — it goes back to the VPS in step 4.

**3c.** Name it `og-shop` and make the config read exactly this, keeping the
`PrivateKey` line it generated for you:

```ini
[Interface]
PrivateKey = (leave the line it already made)
Address    = 10.8.0.2/24

[Peer]
PublicKey           = PASTE_SERVER_PUBLIC_KEY_HERE
Endpoint            = 152.239.114.129:51820
AllowedIPs          = 10.8.0.1/32
PersistentKeepalive = 25
```

**Save.** Do not activate yet.

> ### 🔴 `AllowedIPs = 10.8.0.1/32` — get this one right
>
> It means "only send traffic for the VPS down this tunnel."
>
> If you write `0.0.0.0/0` instead, **every byte the shop laptop sends goes
> through Germany** — the till, the browser, Windows Update, everything. The
> shop would get slower and the whole thing would stop the moment the VPS did.
> That is not what this tunnel is for.

> ### `PersistentKeepalive = 25`
>
> The shop's router forgets an idle connection after a minute or two. This
> sends one tiny packet every 25 seconds so the path stays open, which is what
> lets the VPS start a conversation with a laptop that has no public address.
> Without it the link works until it goes quiet, then silently stops.

---

## 4. Introduce them — 2 minutes

Back on the **VPS**, put the laptop's public key in:

```bash
nano /etc/wireguard/wg0.conf     # replace PASTE_LAPTOP_PUBLIC_KEY_HERE
systemctl restart wg-quick@wg0
```

Then on the **laptop**, in the WireGuard app, press **Activate**.

Within a few seconds the app shows **"latest handshake"** and bytes moving.

**Make it permanent:** the WireGuard Windows app installs an activated tunnel
as a service, so it comes back after a reboot. Confirm it by restarting the
laptop and checking the tunnel is active before anyone opens the shop.

---

## 5. The checkpoint — the step that proves everything

On the **VPS**, with `OG System.exe` **running** on the laptop:

```bash
wg show                                     # a recent handshake?
ping -c 3 10.8.0.2                          # does the laptop answer?
curl -sk https://10.8.0.2:8443/api/health   # does the SHOP answer?
```

**Expected from the last one:**

```json
{"ok":true,"warehouses":2,"time":"...","shop":"OG Sports","https":false,...}
```

🛑 **Do not go on until you see that.** Everything after this assumes it works.

<details>
<summary>If the handshake never happens</summary>

- **Firewall on the VPS:** `ufw status` — UDP **51820** must be allowed. Also
  check Hostinger's own firewall panel; some plans have one in hPanel on top
  of `ufw`.
- **Keys swapped.** The most common mistake by far: each side must hold the
  OTHER machine's public key. `wg show` on the VPS prints the peer key it
  expects — compare it with the one the laptop's app displays.
- **The shop's ISP blocks UDP 51820.** Rare, but it happens. Change
  `ListenPort` on the VPS and `Endpoint` on the laptop to **51820 → 443**, and
  reopen the firewall for `443/udp`. UDP 443 is what QUIC uses, so it is
  almost never filtered. (Nothing else on the VPS uses UDP 443 — Coolify's
  proxy uses TCP 443.)
</details>

<details>
<summary>If the handshake works but curl hangs</summary>

- Is `OG System.exe` actually running? The panel should say the shop is open.
- **Windows Firewall** is the usual answer. On the laptop, in an
  Administrator PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "OG System over WireGuard" -Direction Inbound -Protocol TCP -LocalPort 8443 -RemoteAddress 10.8.0.1 -Action Allow
  ```

  That allows the shop's https port **only** from the VPS's end of the
  tunnel. `docs/vps/MORNING.md` has the whole firewall script (night shift 04), which
  also narrows the LAN side.
</details>

---

## 6. The Coolify app — 10 minutes

**+ New Resource** → **Private Repository (with deploy key)** → the same
`og-deploy` key and `git@github.com:ZIZO1608/og.git` as before.

| Field | Value |
|---|---|
| Branch | `main` |
| Build strategy | `Dockerfile` |
| **Dockerfile Location** | **`/deploy/shop-proxy/Dockerfile`** |
| Base Directory | `/` |
| Ports Exposes | `8080` |
| Port mappings | *(empty)* |
| Network aliases | *(empty)* |
| Domains | `https://shop.ogsports1.com` |

**Environment Variables** → **+ Add** (a normal runtime variable, **not** a
build variable):

| Key | Value |
|---|---|
| `SHOP_UPSTREAM` | `https://10.8.0.2:8443` |
| `SHOP_TLS_NAME` | `og-till` |
| `BRIDGE_UPSTREAM` | `http://og-bridge:8787` |

**Storage** → **+ Add** → Directory mount: source `/data/og` on the VPS,
destination `/etc/nginx/og-till`. It holds `till.pem`, the laptop's **public**
certificate (night shift 04 — the proxy trusts that one certificate and no
other). Copy it from the laptop, and again after every `npm run cert` there:

```bash
# on the laptop, from the repository root
scp server/data/certs/og-cert.pem root@152.239.114.129:/data/og/till.pem
```

Then restart the container. Its log prints the pinned certificate's
fingerprint at every start; without a certificate it says so and every
request gets the "shop's internet is down" answer rather than a crash loop.
The certificate must name `og-till` — made by `npm run cert` from night shift
04 on.

That address is fixed — you chose it in step 3. It never changes, which is one
more thing WireGuard makes simpler than a service that hands out addresses.

**Health check path** (under Health Checks, if Coolify asks):
`/__proxy_health`

No persistent storage. No other variables.

Then **Deploy**.

> **A container reaching 10.8.0.2.** The proxy runs in Docker, and Docker
> routes anything it does not recognise through the host — which is where the
> `wg0` interface lives. So it works with no extra configuration. If it ever
> does not, `sysctl net.ipv4.ip_forward=1` on the VPS is the thing to check.

---

## 7. Check it

| Where | What |
|---|---|
| On the VPS | `curl -s localhost:8080/__proxy_health` → `proxy ok` |
| A phone **on mobile data**, not the shop wifi | `https://shop.ogsports1.com` → the OG System sign-in screen, with a 🔒 |
| Sign in | it should work exactly as it does in the shop |

Testing from the shop's wifi proves nothing — you would be reaching the laptop
directly and learning only that the LAN works.

**Then turn the laptop off** and load it again: you should get the dark
"the shop is not connected / المحل مش موصول هلأ" page rather than a browser
error. That is this proxy telling the truth.

---

## 8. One setting in the shop, afterwards

Sign in as the owner → **Settings** → set **`shop.public_url`** to
`https://shop.ogsports1.com`.

Telegram messages about a print job carry a link to the job only when that is
set, and it has been empty since the first tunnel was retired in September.

The laptop needs four lines in `server/.env` (night shift 04, exact in
`docs/vps/MORNING.md`): `OG_PROXY_ADDR=10.8.0.1` (the only socket whose
`X-OG-Client-IP` is believed), `OG_TUNNEL_ADDR=10.8.0.2`, `OG_VPS_API_KEY`,
and `OG_ORIGINS` still listing `https://shop.ogsports1.com`. Delete
`OG_TRUST_PROXY` — it is retired, and a startup notice says so while it is set.

---

## If WireGuard itself is ever blocked

An SSH reverse tunnel does the same job over TCP and needs nothing installed
on either machine — Windows 10 and later ship `ssh.exe`, and the VPS already
runs `sshd`. From the **laptop**:

```powershell
ssh -N -R 127.0.0.1:8090:127.0.0.1:8090 root@152.239.114.129
```

Then forward 8443 instead of 8090 and keep `SHOP_UPSTREAM=https://172.17.0.1:8443`
(the Docker host, since the forward lands on the VPS's own loopback). On the
laptop the proxy then arrives from 127.0.0.1, so `OG_PROXY_ADDR=127.0.0.1` —
which makes any local process that sends `X-OG-Client-IP` "the proxy" too. It needs a wrapper to restart itself
and to run at boot, which is why it is the fallback rather than the plan.

---

## Night mode: `/night`

`/night` goes to **og-bridge**, like `/snapshot`, never to the laptop: it is the
app staff use while the laptop cannot be reached. It shows stock, customers and
orders read from the cloud copy, and takes one kind of write — a **request**
that waits in Supabase (`server/supabase/035_night_requests.sql`) until somebody
on the laptop accepts it. The laptop stays the only writer of shop data.

- It has its own rate limit (`og_night`, 60 a minute per visitor) and its own
  "not available right now" page (`@night_down`) for when og-bridge is down.
- Its sign-in POST (`/night/login`) also sits in the till's sign-in zone
  (`og_login`, 10 a minute, 5 at once per visitor), on top of og-bridge's own
  five-failure throttle.
- The "shop's internet is down" page (`@shop_closed`) links to it. Phones that
  already have the app get the same button on the app's own down screen.
- `tools/night-mode/proxy.mjs` checks the change is additions only, runs
  `nginx -t`, and routes real requests through it.

---

## What this deliberately does not do

- **It does not hold data.** No database, no volume, no keys. If this
  container is deleted, the shop loses a front door and nothing else.
- **It does not cache.** `proxy_buffering off` is required rather than tuning:
  `/api/live` is a server-sent-event stream that the board, the bell and the
  partner thread repaint from, and `/api/labels/next` is a 25-second long-poll
  the label agent lives on. Buffering waits for a response that is deliberately
  never going to end.
- **It never becomes a second shop.** The root `Dockerfile` in this repository
  builds the shop's own system, and running it here while the laptop is also
  running would give you two databases that both think they are the shop —
  both minting `INV-2106`, both selling the last pair of 43s. `docs/go-live.md`
  has the full story. This proxy exists so that never has to happen.
