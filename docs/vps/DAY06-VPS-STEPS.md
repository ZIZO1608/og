# The VPS after day shift 06: what is done, what went dark, and the steps left

For Ahmad. VPS `152.239.114.129`, Hostinger (hPanel), Ubuntu 24.04, host `srv1992638`.

## Done on the VPS at 09:0x UTC, 22 Sep, over SSH

- `wireguard` installed (apt), keys made on the VPS (the private key never left it), and
  `/etc/wireguard/wg0.conf` written by `tools/wg-test/vps-side.sh`:
  - `10.8.0.1/24`, `ListenPort 51820`;
  - one peer: the till, public key `SauJrejeRltcCpbeqfVE6qA0FP2msfCJufQXY5ZzkBk=`, `AllowedIPs 10.8.0.2/32`;
  - `wg-quick@wg0` **enabled at boot** and running.
- VPS public key `p3m2Hr3XweLmuD6qXhfs97NQ5o1HZvcqpNu0wx0NThc=` (also `_secrets/wg-vps.pub`).
- ufw left **inactive**. No Docker, Coolify, iptables or forwarding change.
  `needrestart` reported "No containers need to be restarted".
- **Proved through PIA** with `tools/wg-test/handshake.mjs` (a real WireGuard handshake from Node;
  no admin was available for WireGuard for Windows). tcpdump on the VPS, and `wg show` agreeing:
  - **before** the till was a peer: 148-byte initiations arrived and nothing went back. hPanel lets
    UDP 51820 in, and WireGuard ignored an unknown key, as it must.
  - **after**: `In … UDP, length 148` / `Out … UDP, length 92`, twice, and the answer decrypted on
    the laptop. The UDP path works both ways, and the keys are right.

## Then, at about 09:14 UTC, the VPS went dark to this laptop

In order, from the laptop (all through PIA; its exit address changed from 147.90.209.49 to
147.90.209.184 at about the same time):

| When (UTC) | TCP 22 | UDP 51820 (handshake) | TCP 80 / 443 |
|---|---|---|---|
| 09:09–09:11 | open | WORKS, twice | (not tested) |
| 09:14 | timed out | NO ANSWER | 443: no answer; the IP did not answer ping |
| 09:24–09:34 | timed out (a 10-minute watch never saw it back) | | |
| ~09:52 | timed out | NO ANSWER | **80 open; https by IP → 503** (Traefik, nothing deployed there) |

`github.com:22` answered over the same path, so the laptop's line does not block port 22.

**The likeliest story is a reboot:**
- Everything went silent at once, then only the web ports came back, with Docker/Traefik.
- The WireGuard install's `needrestart` had deferred restarts of `unattended-upgrades`, `logind`
  and `dbus`. Hostinger's images often let unattended-upgrades reboot by itself.
- After the reboot, something drops **SSH and UDP 51820** but not 80/443. The other possibility
  is a filter in Hostinger's network against this PIA address.

This could not be seen or changed from the laptop.

## Step 1: look, from hPanel's browser terminal (no SSH needed)

hPanel → **VPS** → your server → **Browser terminal** (or **Terminal** in the Overview):

```bash
uptime; last reboot | head -3                 # did it reboot around 09:14 UTC?
systemctl status ssh --no-pager | head -5     # is sshd running? (ssh.socket on 24.04)
ss -tlnp | grep ':22 '                        # is anything listening on 22?
systemctl status wg-quick@wg0 --no-pager | head -5; wg show
ufw status verbose                            # must still say inactive
iptables -S INPUT | head -20                  # a DROP here that is not Docker's?
nft list ruleset | grep -iE "drop|reject" | head
journalctl -b -u ssh -u ssh.socket --no-pager | tail -20
```

Then **hPanel → VPS → Security → Firewall**: if a firewall exists and is **active**, it may drop
everything it has no rule for. Either deactivate it, or add inbound rules for
**TCP 22 (from anywhere, or from your own IPs)** and **UDP 51820 (from anywhere)**. Do not touch
80/443.

**Pass:** from the laptop, `ssh root@152.239.114.129 true` returns, and this prints WORKS:

```powershell
cd "D:\DESKTOP\OG System"
node tools\wg-test\handshake.mjs test _secrets\wg-till.key (Get-Content _secrets\wg-vps.pub)
```

## Step 2: what the day shift could not finish on the VPS

Once SSH works again:

```bash
# from the laptop, repository root: the till's PUBLIC certificate, never og-key.pem
ssh root@152.239.114.129 "mkdir -p /data/og && chmod 755 /data/og"
scp server/data/certs/og-cert.pem root@152.239.114.129:/data/og/till.pem
ssh root@152.239.114.129 "chmod 644 /data/og/till.pem; sha256sum /data/og/till.pem; dig +short shop.ogsports1.com A"
```

**Pass:**
- The VPS's sha256 is
  `9dd18412bc18cb78e25ebacb524ff65d55c904f89be109465fb34b2dddac5fe0`, the same as the laptop's
  `sha256sum server/data/certs/og-cert.pem`.
- The `dig` prints `152.239.114.129`.

After the laptop's tunnel service is installed (TONIGHT.md) and the shop is open, run this from
the VPS:

```bash
wg show                                   # "latest handshake: … seconds ago" for the till's key
curl -sk https://10.8.0.2:8443/api/health # the till's own {"ok":true,…}
```
