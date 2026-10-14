#!/usr/bin/env bash
# =============================================================================
#  OG SYSTEM — install the VPS's self-deploy          [deploy/og-shop]
# -----------------------------------------------------------------------------
#  Run ON THE VPS, as root, once. Two ways in:
#
#    Hostinger -> VPS -> Browser terminal, paste:
#      curl -fsSL https://raw.githubusercontent.com/ZIZO1608/og/main/deploy/og-shop/install-autodeploy.sh | bash
#
#    or from the laptop:  cd server && npm run vps -- autodeploy
#
#  It puts autodeploy.sh in /data/og-shop, writes autodeploy.conf (the
#  repository and branch) unless one is there, installs og-autodeploy.service
#  and og-autodeploy.timer (every minute; three minutes after a boot), and
#  starts a first run, which takes GitHub's main now. Running it again only
#  refreshes the script and the units. Undo: systemctl disable --now
#  og-autodeploy.timer.
#
#  OG_AD_DIR / OG_UNIT_DIR / OG_RAW move things (tests only); OG_NO_WAIT=1
#  returns straight after starting the first run (the laptop waits itself).
# =============================================================================
set -euo pipefail
DIR="${OG_AD_DIR:-/data/og-shop}"
UNITS="${OG_UNIT_DIR:-/etc/systemd/system}"
REPO="${OG_REPO:-https://github.com/ZIZO1608/og.git}"
RAW="${OG_RAW:-https://raw.githubusercontent.com/ZIZO1608/og/main}"

say() { echo "  $*"; }
[ -s "$DIR/og-shop.env" ] || { say "No $DIR/og-shop.env here — this is not the shop's VPS. Nothing done."; exit 1; }
command -v git > /dev/null || { say "installing git ..."; apt-get update -qq && apt-get install -y -qq git; }
command -v flock > /dev/null || { say "flock is missing (util-linux) — nothing done."; exit 1; }

curl -fsSL "$RAW/deploy/og-shop/autodeploy.sh" -o "$DIR/autodeploy.sh.new"
head -1 "$DIR/autodeploy.sh.new" | grep -q '^#!/usr/bin/env bash' || { say "That download is not the script. Nothing done."; exit 1; }
chmod 755 "$DIR/autodeploy.sh.new" && mv "$DIR/autodeploy.sh.new" "$DIR/autodeploy.sh"
[ -f "$DIR/autodeploy.conf" ] || printf '%s\n' \
  '# the repository and branch the VPS deploys from (deploy/og-shop/install-autodeploy.sh)' \
  "OG_REPO=$REPO" 'OG_BRANCH=main' > "$DIR/autodeploy.conf"

cat > "$UNITS/og-autodeploy.service" <<UNIT
[Unit]
Description=OG System: put GitHub main live on the shop (deploy/og-shop/autodeploy.sh)
After=docker.service network-online.target wg-quick@wg0.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=$DIR/autodeploy.sh
TimeoutStartSec=40min
Nice=5
UNIT
cat > "$UNITS/og-autodeploy.timer" <<'UNIT'
[Unit]
Description=OG System: look at GitHub main every minute
[Timer]
OnBootSec=3min
OnUnitInactiveSec=60s
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now og-autodeploy.timer > /dev/null 2>&1
[ "$(systemctl is-active og-autodeploy.timer)" = "active" ] || { say "The timer did not start."; exit 1; }
say "✓ installed: every minute the VPS takes GitHub's main by itself"

from=0; [ -f "$DIR/autodeploy.log" ] && from=$(wc -l < "$DIR/autodeploy.log")
systemctl start --no-block og-autodeploy.service
[ "${OG_NO_WAIT:-0}" = "1" ] && exit 0

say "taking main now (a build takes a few minutes) ..."
for _ in $(seq 1 180); do
  sleep 5
  new=$(tail -n +$((from + 1)) "$DIR/autodeploy.log" 2>/dev/null || true)
  if [ -n "$new" ]; then echo "$new" | sed 's/^/    /'; from=$((from + $(echo "$new" | wc -l))); fi
  echo "$new" | grep -q 'LIVE \|FAILED \|changes nothing the shop runs' && break
  # A oneshot that is still running is "activating", not "active" — reading
  # is-active alone took a running build for a finished one (15 Oct 2026).
  st=$(systemctl show -p ActiveState --value og-autodeploy.service 2>/dev/null)
  if [ "$st" != "activating" ] && [ "$st" != "active" ] && [ -z "$new" ]; then
    b=$(sed -n 's/^OG_BUILD=//p' "$DIR/.env" 2>/dev/null)
    say "nothing new to deploy — the shop runs $b"; break
  fi
done
say "the shop runs: $(sed -n 's/^OG_BUILD=//p' "$DIR/.env" 2>/dev/null)"
