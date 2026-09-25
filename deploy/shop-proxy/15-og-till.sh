#!/bin/sh
# Runs from /docker-entrypoint.d/ before nginx starts (the official image runs
# every *.sh there in order; the image's own template step is 20-).
#
# 1. The till's certificate. Mounted by Coolify at /etc/nginx/og-till/till.pem
#    (its own folder, so a directory mount cannot hide the files below) and
#    copied to /etc/nginx/og/till.pem, where to-till.conf reads it.
#    Missing, it falls back to a placeholder that matches NOTHING, so nginx
#    still starts and every request lands on "the shop's internet is down" —
#    true from where a visitor stands — instead of a crash loop with no reason.
# 2. The shared upstream block, rendered here because the image's template
#    step would put it in conf.d at http level.
set -eu

OG=/etc/nginx/og
MOUNTED=/etc/nginx/og-till/till.pem
if [ -s "$MOUNTED" ] && openssl x509 -in "$MOUNTED" -noout 2>/dev/null; then
  cp "$MOUNTED" "$OG/till.pem"
  echo "og-till: pinned certificate:"
  openssl x509 -in "$OG/till.pem" -noout -subject -ext subjectAltName -enddate -fingerprint -sha256 || true
else
  echo "og-till: *** NO USABLE CERTIFICATE AT $MOUNTED — every request will be refused." >&2
  echo "og-till: *** Copy the laptop's server/data/certs/og-cert.pem there (see docs/vps/MORNING.md)." >&2
  cp "$OG/placeholder.pem" "$OG/till.pem"
fi

envsubst '${SHOP_UPSTREAM} ${SHOP_TLS_NAME}' < "$OG/to-till.conf.template" > "$OG/to-till.conf"
