#!/usr/bin/env bash
# =============================================================================
#  OG SYSTEM — the VPS deploys itself from GitHub          [deploy/og-shop]
# -----------------------------------------------------------------------------
#  Run every minute by og-autodeploy.timer (installed by
#  `npm run vps -- autodeploy`). A push to `main` on GitHub is all it takes:
#
#    1. fetch main into a bare copy of the repository (/data/og-shop/repo.git);
#    2. nothing new, or the new commit changes nothing the image is built from
#       (ship-paths.txt) → nothing happens;
#    3. otherwise the commit is unpacked into releases/<commit>, built (the
#       tests run inside the build — a red test is a failed build), and the
#       container is swapped onto it;
#    4. if it is not healthy within two and a half minutes, the previous
#       commit is put back and started again.
#
#  WHY THE VPS PULLS, rather than a laptop pushing over SSH: the route from
#  the shop's line to this VPS breaks for hours at a time (Arelion, 27 Sep and
#  15 Oct 2026) while GitHub stays reachable from both ends. A deploy that
#  needs a laptop to reach the VPS is a deploy that waits for the route.
#
#  A failed commit is tried at most three times, ten minutes apart; a newer
#  commit is tried at once. One run at a time (flock) — `npm run vps --
#  deploy` and the launcher start THIS script rather than building beside it.
#
#  Files here (all in /data/og-shop): repo.git · autodeploy.conf (OG_REPO,
#  OG_BRANCH) · autodeploy.log (the last 1,000 lines) · .autodeploy.state ·
#  .env (OG_BUILD=<commit>, the release that is running).
#
#  OG_AD_DIR moves everything and OG_AD_HEALTH_TRIES / _WAIT shorten the
#  health wait (tests only). OG_AD_FORCE=1 deploys the head even when it
#  changes nothing the image is built from.
# =============================================================================
set -u
DIR="${OG_AD_DIR:-/data/og-shop}"
cd "$DIR" || exit 1
[ -f autodeploy.conf ] && . ./autodeploy.conf
REPO_URL="${OG_REPO:-https://github.com/ZIZO1608/og.git}"
BRANCH="${OG_BRANCH:-main}"
LOG="$DIR/autodeploy.log"
STATE="$DIR/.autodeploy.state"
GIT="git -C $DIR/repo.git"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }
trim_log() { [ -f "$LOG" ] && tail -n 1000 "$LOG" > "$LOG.t" && mv "$LOG.t" "$LOG"; }

exec 9> "$DIR/.deploy.lock"
flock -n 9 || exit 0

if [ ! -d "$DIR/repo.git" ]; then
  git clone --quiet --bare "$REPO_URL" "$DIR/repo.git" || { log "cannot clone $REPO_URL"; exit 1; }
fi
if ! $GIT fetch --quiet "$REPO_URL" "+refs/heads/$BRANCH:refs/heads/$BRANCH" 2>/dev/null; then
  # GitHub out of reach: say it once an hour, not once a minute.
  last=$(sed -n 's/^fetch_fail=//p' "$STATE" 2>/dev/null)
  now=$(date +%s)
  if [ -z "$last" ] || [ $((now - last)) -gt 3600 ]; then log "cannot fetch $BRANCH from GitHub"; fi
  grep -v '^fetch_fail=' "$STATE" 2>/dev/null > "$STATE.t"; echo "fetch_fail=$now" >> "$STATE.t"; mv "$STATE.t" "$STATE"
  exit 1
fi
sed -i '/^fetch_fail=/d' "$STATE" 2>/dev/null

NEW=$($GIT rev-parse --short=12 "refs/heads/$BRANCH")
CUR=$(sed -n 's/^OG_BUILD=//p' "$DIR/.env" 2>/dev/null | tr -d '[:space:]')
[ -n "$NEW" ] || exit 1
[ "$NEW" = "$CUR" ] && exit 0

mapfile -t LISTED < <($GIT show "$NEW:deploy/og-shop/ship-paths.txt" 2>/dev/null | tr -d '\r' | sed '/^\s*$/d')
# Only what this commit has: `git archive` refuses the whole commit over one
# listed path that is not in it (a robots.txt taken out one day).
SHIP=()
for p in "${LISTED[@]}"; do $GIT cat-file -e "$NEW:$p" 2>/dev/null && SHIP+=("$p"); done
if [ "${#SHIP[@]}" -eq 0 ]; then
  log "$NEW has no deploy/og-shop/ship-paths.txt — not deployed"; exit 1
fi

# Nothing the image is built from changed: the shop keeps running.
if [ -n "$CUR" ] && [ "${OG_AD_FORCE:-0}" != "1" ] && $GIT cat-file -e "$CUR^{commit}" 2>/dev/null \
   && $GIT diff --quiet "$CUR" "$NEW" -- "${SHIP[@]}"; then
  seen=$(sed -n 's/^same=//p' "$STATE" 2>/dev/null)
  if [ "$seen" != "$NEW" ]; then
    log "$NEW changes nothing the shop runs — $CUR keeps running"
    grep -v '^same=' "$STATE" 2>/dev/null > "$STATE.t"; echo "same=$NEW" >> "$STATE.t"; mv "$STATE.t" "$STATE"
  fi
  exit 0
fi

# A commit that failed: at most three tries, ten minutes apart.
read -r F_SHA F_N F_AT <<< "$(sed -n 's/^failed=//p' "$STATE" 2>/dev/null) "
if [ "${F_SHA:-}" = "$NEW" ]; then
  [ "${F_N:-0}" -ge 3 ] && exit 0
  [ $(( $(date +%s) - ${F_AT:-0} )) -lt 600 ] && exit 0
else
  F_N=0
fi
fail() {
  log "FAILED $NEW: $*"
  grep -v '^failed=' "$STATE" 2>/dev/null > "$STATE.t"; echo "failed=$NEW $((F_N + 1)) $(date +%s)" >> "$STATE.t"; mv "$STATE.t" "$STATE"
  trim_log; exit 1
}

SUBJECT=$($GIT log -1 --format=%s "$NEW" | cut -c1-120)
log "deploying $NEW — $SUBJECT (running: ${CUR:-nothing})"

R="$DIR/releases/$NEW"
rm -rf "$R.part" && mkdir -p "$R.part" || fail "cannot make $R"
$GIT archive --format=tar "$NEW" -- "${SHIP[@]}" | tar -x -C "$R.part" || fail "cannot unpack the code"
rm -rf "$R" && mv "$R.part" "$R"
cp "$R/deploy/og-shop/docker-compose.yml" "$DIR/docker-compose.yml"

if ! OG_BUILD="$NEW" docker compose build > "$DIR/.autodeploy.build" 2>&1; then
  tail -n 15 "$DIR/.autodeploy.build" | sed 's/^/    /' >> "$LOG"
  [ -n "$CUR" ] && [ -f "$DIR/releases/$CUR/deploy/og-shop/docker-compose.yml" ] && \
    cp "$DIR/releases/$CUR/deploy/og-shop/docker-compose.yml" "$DIR/docker-compose.yml"
  fail "the build failed (a test, or the Dockerfile) — the shop stays on ${CUR:-what it had}"
fi
docker image inspect "og-shop:$NEW" > /dev/null 2>&1 || fail "the build made no og-shop:$NEW image"

healthy() {
  for _ in $(seq 1 "${OG_AD_HEALTH_TRIES:-30}"); do
    s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' og-shop 2>/dev/null)
    [ "$s" = "healthy" ] && return 0
    sleep "${OG_AD_HEALTH_WAIT:-5}"
  done
  return 1
}

echo "OG_BUILD=$NEW" > "$DIR/.env"
docker compose up -d --force-recreate >> "$LOG" 2>&1
if healthy; then
  log "LIVE $NEW"
  sed -i '/^failed=/d' "$STATE" 2>/dev/null
  # keep the last six releases, never the one running
  (cd "$DIR/releases" && ls -1t | grep -v "^$NEW\$" | tail -n +6 | xargs -r rm -rf)
  trim_log; exit 0
fi

docker logs --tail 20 og-shop 2>&1 | sed 's/^/    /' >> "$LOG"
if [ -n "$CUR" ]; then
  echo "OG_BUILD=$CUR" > "$DIR/.env"
  [ -f "$DIR/releases/$CUR/deploy/og-shop/docker-compose.yml" ] && \
    cp "$DIR/releases/$CUR/deploy/og-shop/docker-compose.yml" "$DIR/docker-compose.yml"
  docker compose up -d --force-recreate >> "$LOG" 2>&1
  if healthy; then fail "not healthy on $NEW — put back $CUR, which is running"; fi
  fail "not healthy on $NEW, and $CUR did not come back healthy either — LOOK AT THE VPS"
fi
fail "not healthy on $NEW and there was nothing to go back to"
