#!/usr/bin/env bash
# =============================================================================
#  tools/wg-test/vps-side.sh — the VPS half of the WireGuard test (night shift 05)
# -----------------------------------------------------------------------------
#  Run as root ON THE VPS (152.239.114.129). Safe to run again: keys are made
#  once and kept, the config is rewritten from the same values, a running
#  tunnel is updated in place. Addresses are docs/go-live.md §2.2's:
#
#      VPS   10.8.0.1/24   listening on UDP 51820
#      till  10.8.0.2/32   (the shop laptop)
#
#  It NEVER touches Docker or Coolify's networks: no PostUp/iptables rules, no
#  forwarding changes, and AllowedIPs is the one laptop address, so nothing
#  but traffic for 10.8.0.2 ever enters the tunnel.
#
#    bash vps-side.sh                      # first run: keys, config, start; prints the VPS key
#    bash vps-side.sh <laptop-public-key>  # second run: adds the laptop as the peer
# =============================================================================
set -euo pipefail

LAPTOP_KEY="${1:-}"
DIR=/etc/wireguard
CONF="$DIR/wg0.conf"
PORT=51820
step() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo bash $0 ...)." >&2; exit 1; fi

step "1. WireGuard installed?"
if command -v wg >/dev/null 2>&1; then
  echo "   yes: $(wg --version 2>/dev/null || echo wg)"
else
  apt-get update -qq && apt-get install -y -qq wireguard
  echo "   installed."
fi

step "2. The VPS's keys (made once, kept)"
umask 077
mkdir -p "$DIR"
if [ ! -s "$DIR/server.key" ]; then
  wg genkey > "$DIR/server.key"
  echo "   made a new key pair."
else
  echo "   keeping the existing key pair."
fi
wg pubkey < "$DIR/server.key" > "$DIR/server.pub"
SERVER_PUB="$(cat "$DIR/server.pub")"

step "3. $CONF"
if [ -f "$CONF" ] && ! grep -q '^# written by tools/wg-test/vps-side.sh' "$CONF"; then
  echo "   $CONF exists and was NOT written by this script — left alone. Stop." >&2
  echo "   Move it aside yourself if it is safe to replace." >&2
  exit 2
fi
{
  echo "# written by tools/wg-test/vps-side.sh — OG System's tunnel to the shop laptop"
  echo "[Interface]"
  echo "Address    = 10.8.0.1/24"
  echo "ListenPort = $PORT"
  echo "PrivateKey = $(cat "$DIR/server.key")"
  if [ -n "$LAPTOP_KEY" ]; then
    echo ""
    echo "[Peer]"
    echo "# the shop laptop"
    echo "PublicKey  = $LAPTOP_KEY"
    echo "AllowedIPs = 10.8.0.2/32"
  fi
} > "$CONF.new"
chmod 600 "$CONF.new"
mv "$CONF.new" "$CONF"
if [ -n "$LAPTOP_KEY" ]; then echo "   written, with the laptop as the peer."; else echo "   written, no peer yet."; fi

step "4. UDP $PORT open in ufw (only if ufw is active)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT/udp" >/dev/null && echo "   allowed."
else
  echo "   ufw not active — nothing to do. CHECK hPanel's own firewall allows UDP $PORT too."
fi

step "5. The tunnel running (wg-quick@wg0)"
if systemctl is-active --quiet wg-quick@wg0; then
  wg syncconf wg0 <(wg-quick strip wg0)
  echo "   running — config reloaded in place."
else
  systemctl enable --now wg-quick@wg0
  echo "   enabled and started."
fi

step "6. State"
wg show wg0 || true

echo
echo "------------------------------------------------------------------------"
echo " VPS PUBLIC KEY (paste into the laptop's till-side.ps1 -ServerPublicKey):"
echo "   $SERVER_PUB"
if [ -z "$LAPTOP_KEY" ]; then
  echo " Next: run till-side.ps1 on the laptop, then run THIS again with the"
  echo " laptop's public key:   bash $0 <laptop-public-key>"
else
  echo " The laptop is the peer. Run till-side.ps1 on the laptop for the verdict."
fi
echo "------------------------------------------------------------------------"
