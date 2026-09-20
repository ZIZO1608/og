# `shop.ogsports1.com` — putting the shop online without moving it

Written for whoever sets it up, at the VPS and at the shop laptop. About 45
minutes, most of it waiting.

## What this builds

```
   a phone, anywhere
        │  https://shop.ogsports1.com
        ▼
   VPS (Coolify + this proxy)          152.239.114.129
        │  private Tailscale link
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

## 2. Tailscale on the shop laptop — 5 minutes

Tailscale is a private network between your machines. Nothing is exposed to
the internet by it; the two computers simply find each other.

1. Download from **tailscale.com/download/windows**, install
2. Sign in — **use an account you will still have in two years**, not a
   throwaway. Google or Microsoft sign-in is fine.
3. Tailscale sits in the tray. Leave it running.

**Then, once, in the admin console** at `login.tailscale.com/admin/machines`:

- find the laptop → **⋯** → **Disable key expiry**

> ⚠️ Do this. Without it the machine's key expires in a few months, the link
> stops, and `shop.ogsports1.com` starts showing "the shop is not connected"
> with nothing in the shop having changed.

---

## 3. Tailscale on the VPS — 3 minutes

SSH in (hPanel → VPS → **Browser terminal**, or `ssh root@152.239.114.129`):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

It prints a URL. Open it in a browser, sign in with **the same account**, and
the VPS joins. Disable key expiry for this machine too.

---

## 4. Find the laptop's private address — 1 minute

On the **VPS**:

```bash
tailscale status
```

You get a line per machine:

```
100.94.18.7     og-laptop    zizo@   windows  -
100.71.203.44   vps-hostinger ...
```

**Write down the laptop's `100.x.y.z`.** That is its address on the private
network, and it does not change.

Now prove the VPS can reach the shop — with `OG System.exe` **running** on the
laptop:

```bash
curl -s http://100.94.18.7:8090/api/health
```

(substitute your own address)

**Expected:**

```json
{"ok":true,"warehouses":2,"time":"...","shop":"OG Sports","https":false,...}
```

🛑 **Do not go on until you see that.** Everything after this assumes it works.

<details>
<summary>If it hangs or refuses</summary>

- Is `OG System.exe` actually running on the laptop? The panel should say the
  shop is open.
- **Windows Firewall** is the usual answer. On the laptop, in an
  Administrator PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "OG System from Tailscale" -Direction Inbound -Protocol TCP -LocalPort 8090 -RemoteAddress 100.64.0.0/10 -Action Allow
  ```

  That allows port 8090 **only** from the private network, not from the wider
  internet.
- `tailscale ping 100.94.18.7` from the VPS tells you whether the two machines
  can see each other at all, separately from whether the shop is listening.
</details>

---

## 5. The Coolify app — 10 minutes

**+ New Resource** → **Private Repository (with deploy key)** → the same
`og-deploy` key and `git@github.com:ZIZO1608/og.git` as before.

| Field | Value |
|---|---|
| Branch | `main` |
| Build Pack | `Dockerfile` |
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
| `SHOP_UPSTREAM` | `http://100.94.18.7:8090` ← your laptop's address |

**Health check path** (under Health Checks, if Coolify asks):
`/__proxy_health`

No persistent storage. No other variables.

Then **Deploy**.

---

## 6. Check it

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

## 7. One setting in the shop, afterwards

Sign in as the owner → **Settings** → set **`shop.public_url`** to
`https://shop.ogsports1.com`.

Telegram messages about a print job carry a link to the job only when that is
set, and it has been empty since the first tunnel was retired in September.

The laptop needs nothing else: `OG_ORIGINS` already lists
`https://shop.ogsports1.com` and `OG_TRUST_PROXY=1` is already set, both left
over from the old tunnel.

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
