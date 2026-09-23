# If the shop's line drops UDP — the two fallbacks

Written in night shift 05. **Nothing here is built.** This page is only for the case where
`till-side.ps1` says **UDP BLOCKED**: no handshake within 60 s, while the VPS still answers on
TCP 22/443. Syrian ISPs have throttled or dropped UDP before. WireGuard is UDP only and has no
TCP mode of its own.

Both fallbacks do the same job: carry `https://10.8.0.2:8443` (or its equivalent) from the VPS
to the till over TCP. **Neither changes the nginx config** except `SHOP_UPSTREAM`. The pinned
certificate and the `og-till` name still apply end to end, because the till's TLS runs *inside*
whichever pipe is used.

---

## A. WireGuard inside TCP 443 (wstunnel)

Keep WireGuard exactly as tested. Wrap its UDP packets in a WebSocket over TCP 443, so the ISP
only sees an ordinary HTTPS-looking connection to the VPS. udp2raw fakes TCP headers with raw
sockets; it needs a kernel-level driver on Windows (WinDivert) and a stateful middlebox often
breaks it. **wstunnel** is the realistic one of the two.

**Setup**
1. VPS: run `wstunnel server wss://0.0.0.0:<port>` as a systemd unit, restricted to forwarding
   `127.0.0.1:51820`. Port 443 belongs to Coolify's Traefik, so either give wstunnel a Traefik
   route (a path on a subdomain) or use another TCP port the ISP lets through.
2. Till: run `wstunnel client -L udp://127.0.0.1:51820:127.0.0.1:51820 wss://<vps>:<port>` as a
   Windows service (NSSM, or wstunnel's own service wrapper).
3. Point the WireGuard config's `Endpoint` at `127.0.0.1:51820`. Add a route that keeps the
   VPS's public IP *off* the tunnel. WireGuard for Windows does this for you when `AllowedIPs`
   is only `10.8.0.1/32`, as `till-side.ps1` already sets it.

**What breaks**
- One more service on each side. If wstunnel on the till dies, WireGuard keeps retrying into
  nothing, so the watchdog has to cover two processes.
- TCP-over-TCP: a lossy line gets meltdown-style stalls, because both layers retransmit. Short
  bursts are fine; a bad hour is worse than with plain WireGuard.
- Traefik routing for the WebSocket is one more thing in Coolify, and a Coolify update can
  quietly change it.
- A DPI box that fingerprints wstunnel's TLS can still block it. It is less likely than a UDP
  block, but not impossible.

**Latency:** roughly the plain round trip plus a few ms. Under loss it is much worse than
WireGuard alone.

## B. A reverse SSH tunnel as a Windows service (autossh-style)

The till dials *out* to the VPS on TCP 22 (or 443) and asks the VPS's sshd to listen on
`10.8.0.2`-equivalent (say `127.0.0.1:18443` on the VPS). Everything sent there comes back down
the same connection to `localhost:8443` on the till.

**Setup**
1. VPS: a dedicated user `ogtill` with no shell (`command="/bin/false"`, `permitlisten="127.0.0.1:18443"`,
   `no-pty` in `authorized_keys`) and `GatewayPorts no`. The listening port is then only reachable from the
   VPS itself. nginx runs in a container, so it needs to reach the host: bind to the docker bridge
   address instead of 127.0.0.1, or run the proxy with `host.docker.internal`.
2. Till: Windows' built-in OpenSSH client (`ssh.exe`, already on Windows 11) with a key file, run
   by a service wrapper that restarts it:
   `ssh -N -R 127.0.0.1:18443:127.0.0.1:8443 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ogtill@<vps>`.
   NSSM, or a scheduled task with "restart on failure", plays autossh's role.
3. `SHOP_UPSTREAM=https://<bridge-ip>:18443`. `proxy_ssl_name og-till` and the pin are unchanged.
4. og-bridge's calls to the till's `/api/vps/` go the same way.

**What breaks**
- The till's source address is no longer a tunnel address. Every request reaches the till from
  `127.0.0.1` (sshd's forward), so `OG_PROXY_ADDR` would be `127.0.0.1`. That is exactly the
  address local scripts and the panel also use, so the `X-OG-Client-IP` rule would believe any
  local process. You could live with that on the till, but it is weaker than a dedicated
  `10.8.0.x` hop, and the §2.2 design would need a written exception.
- Plain SSH to port 22 is the first thing a hostile network blocks. Port 443 is taken by Traefik
  on the VPS, so a second IP or an sslh-style multiplexer would be needed.
- One TCP connection carries everything. The SSE streams and uploads share it, with head-of-line
  blocking.
- The key on the till is a login to the VPS. `permitlisten`, the lack of a shell and a no-pty
  restriction are mandatory, or a stolen laptop becomes a way into the server.

**Latency:** the plain TCP round trip. No extra layer on the till, and under loss it behaves
like one TCP connection rather than two stacked.

---

## Recommendation: A (wstunnel), with B as the quick stopgap

Go with **A**. It keeps everything already built and tested: the `10.8.0.x` addresses, the
`OG_PROXY_ADDR=10.8.0.1` rule that only believes the proxy's own socket, `extraSans`, go-live
§2.2 and `till-side.ps1`. The only change is where WireGuard's packets travel. B changes the
security model (the proxy's hop becomes `127.0.0.1`, which the till cannot tell apart from its
own scripts), and it puts a VPS login key on a shop laptop.

B is worth knowing as a **ten-minute stopgap**: Windows already ships `ssh.exe`. If the shop
needs the outside door on the day the UDP test fails, B works that afternoon. It needs one
written exception for `OG_PROXY_ADDR=127.0.0.1`, and it should be replaced by A.

Either way, **the first thing to try is another UDP port.** Some ISPs drop 51820 specifically
but not 443/udp (unless Traefik holds it for HTTP/3 — check `ss -ulpn` on the VPS) or 53/udp. `vps-side.sh` takes its port from one line (`PORT=`) and
`till-side.ps1` from `-Endpoint`, so retrying on `443/udp` costs five minutes.
