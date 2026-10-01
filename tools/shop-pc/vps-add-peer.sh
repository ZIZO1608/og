#!/usr/bin/env bash
# =============================================================================
#  tools/shop-pc/vps-add-peer.sh - give the SHOP PC its own place on the tunnel
# -----------------------------------------------------------------------------
#  Run as root ON THE VPS. make-kit.mjs writes a copy of this file into the
#  kit with the shop PC's public key and address filled in (for-the-vps/), so
#  from this laptop it is one line:
#
#    ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1 'bash -s' < for-the-vps/add-shop-pc-peer.sh
#
#  It ADDS one peer and touches nothing else. tools/wg-test/vps-side.sh writes
#  the whole wg0.conf with ONE peer - run with the shop PC's key it would
#  replace the laptop's, and the laptop would lose the tunnel (and SSH over
#  it) in the middle of the job. This keeps every peer already there.
#
#  Safe to run again: the same key at the same address changes nothing; the
#  same key at another address, or another key at this address, is refused.
#  NOTE: running vps-side.sh again later rewrites wg0.conf with only the first
#  peer. If that is ever needed, run this again afterwards.
# =============================================================================
set -euo pipefail

PEER_KEY="${PEER_KEY:-__PEER_KEY__}"
PEER_ADDR="${PEER_ADDR:-__PEER_ADDR__}"
PEER_NAME="${PEER_NAME:-__PEER_NAME__}"
CONF=/etc/wireguard/wg0.conf

if [ "$(id -u)" -ne 0 ]; then echo "Run as root." >&2; exit 1; fi
case "$PEER_KEY" in __*|'') echo "No peer key filled in. Use the copy in the kit's for-the-vps folder." >&2; exit 1;; esac
[ -f "$CONF" ] || { echo "$CONF not found - the tunnel was never set up here." >&2; exit 2; }

echo "==> peers before:"
wg show wg0 allowed-ips || true

if grep -qF "$PEER_KEY" "$CONF"; then
  if wg show wg0 allowed-ips | grep -F "$PEER_KEY" | grep -qF "$PEER_ADDR/32"; then
    echo "==> $PEER_NAME is already a peer at $PEER_ADDR - nothing to do."
    exit 0
  fi
  echo "This key is already in $CONF at another address. Stop - look at it by hand." >&2
  exit 3
fi
if grep -qF "AllowedIPs = $PEER_ADDR/32" "$CONF"; then
  echo "$PEER_ADDR is already given to another peer in $CONF. Stop - choose another address." >&2
  exit 3
fi

cp -p "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
{
  echo ""
  echo "[Peer]"
  echo "# $PEER_NAME (tools/shop-pc/vps-add-peer.sh, $(date -u +%F))"
  echo "PublicKey  = $PEER_KEY"
  echo "AllowedIPs = $PEER_ADDR/32"
} >> "$CONF"

# Live, without restarting the interface (the laptop's tunnel stays up).
wg set wg0 peer "$PEER_KEY" allowed-ips "$PEER_ADDR/32"

echo "==> added $PEER_NAME at $PEER_ADDR. Peers now:"
wg show wg0 allowed-ips
echo "==> VPS public key (the shop PC's config already has it):"
wg show wg0 public-key
