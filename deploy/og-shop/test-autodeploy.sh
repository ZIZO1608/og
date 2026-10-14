#!/usr/bin/env bash
# The VPS's self-deploy (autodeploy.sh) against a local "GitHub" and a fake
# docker: a first deploy, nothing new, a commit that changes nothing the shop
# runs, a failed build (the shop stays), a commit that will not come up
# healthy (the old one is put back), the three-tries rule, and a newer commit
# after a failure. No network, no Docker, no VPS.
#   bash deploy/og-shop/test-autodeploy.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; failn=0
check() { if eval "$2"; then pass=$((pass+1)); echo "  ok   $1"; else failn=$((failn+1)); echo "  FAIL $1"; fi; }

# --- a fake docker and flock --------------------------------------------------
mkdir -p "$T/bin"
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
B=$(sed -n 's/^OG_BUILD=//p' "$OG_AD_DIR/.env" 2>/dev/null)
case "$1 $2" in
  "compose build") [ -f "$OG_AD_DIR/../badbuild-$OG_BUILD" ] && { echo "test failed: 1 failing"; exit 1; }
                   touch "$OG_AD_DIR/../image-$OG_BUILD"; echo "built"; exit 0 ;;
  "image inspect") [ -f "$OG_AD_DIR/../image-${3#og-shop:}" ] ;;
  "compose up")    echo "$B" >> "$OG_AD_DIR/../started"; exit 0 ;;
  "inspect -f")    [ -f "$OG_AD_DIR/../sick-$B" ] && echo unhealthy || echo healthy ;;
  "logs --tail")   echo "boom" ;;
esac
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/flock"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" OG_AD_HEALTH_TRIES=2 OG_AD_HEALTH_WAIT=0

# --- a "GitHub" with the shop's layout ----------------------------------------
W="$T/work"; mkdir -p "$W/deploy/og-shop" "$W/server" "$W/docs"
cp "$HERE/ship-paths.txt" "$W/deploy/og-shop/"
echo "services: {}" > "$W/deploy/og-shop/docker-compose.yml"
echo v1 > "$W/server/index.js"; echo FROM > "$W/Dockerfile"
G="git -C $W -c user.email=t@t -c user.name=t"
git init -q -b main "$W" && $G add -A && $G commit -qm one
git clone -q --bare "$W" "$T/github.git"
push() { $G add -A && $G commit -qm "$1" && git -C "$W" push -q "$T/github.git" main; git -C "$W" rev-parse --short=12 HEAD; }

D="$T/vps"; mkdir -p "$D/releases"
export OG_AD_DIR="$D"
echo "OG_REPO=$T/github.git" > "$D/autodeploy.conf"
run() { bash "$HERE/autodeploy.sh"; }
build() { sed -n 's/^OG_BUILD=//p' "$D/.env"; }

S1=$(git -C "$W" rev-parse --short=12 HEAD)
run
check "first run deploys main"                       '[ "$(build)" = "$S1" ] && grep -q "LIVE $S1" "$D/autodeploy.log"'
check "the release folder holds the shop's files"    '[ -f "$D/releases/$S1/server/index.js" ] && [ ! -e "$D/releases/$S1/docs" ]'
n=$(wc -l < "$T/started"); run
check "nothing new: nothing started"                 '[ "$(wc -l < "$T/started")" = "$n" ]'

echo note > "$W/docs/readme.md"; S2=$(push docs)
run
check "a commit outside the shop keeps it running"   '[ "$(build)" = "$S1" ] && grep -q "$S2 changes nothing the shop runs" "$D/autodeploy.log"'

echo v3 > "$W/server/index.js"; S3=$(push v3); touch "$T/badbuild-$S3"
run
check "a failed build leaves the shop on the old one" '[ "$(build)" = "$S1" ] && grep -q "FAILED $S3: the build failed" "$D/autodeploy.log"'
run; run
check "…and it is not retried within ten minutes"    '[ "$(grep -c "deploying $S3" "$D/autodeploy.log")" = "1" ]'

echo v4 > "$W/server/index.js"; S4=$(push v4); touch "$T/sick-$S4"
run
check "a commit that is not healthy is rolled back"  '[ "$(build)" = "$S1" ] && grep -q "put back $S1" "$D/autodeploy.log"'

sed -i "s/^failed=.*/failed=$S4 3 0/" "$D/.autodeploy.state"; run
check "three failures: the commit is left alone"     '[ "$(grep -c "deploying $S4" "$D/autodeploy.log")" = "1" ]'

echo v5 > "$W/server/index.js"; S5=$(push v5)
run
check "a newer commit goes at once after failures"   '[ "$(build)" = "$S5" ] && grep -q "LIVE $S5" "$D/autodeploy.log"'
check "the failure note is cleared when one is live" '! grep -q "^failed=" "$D/.autodeploy.state"'

echo
echo "$pass passed, $failn failed"
[ "$failn" -eq 0 ]
