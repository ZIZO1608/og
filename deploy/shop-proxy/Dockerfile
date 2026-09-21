# syntax=docker/dockerfile:1.7

# =============================================================================
#  shop.ogsports1.com — the front door on the VPS
# -----------------------------------------------------------------------------
#  A reverse proxy and nothing else. It holds no database, no key and no state:
#  every request is answered by the shop's own server on the laptop in Aleppo,
#  reached over a private WireGuard link the VPS itself hosts.
#
#  WHY THIS EXISTS AT ALL. The shop must keep selling when the internet dies,
#  so the server has to be in the same room as the till: the price, the stock
#  check and the receipt all go through it on every sale. But the owner and the
#  print partner also need to reach it from outside, and a laptop on a shop's
#  wifi has no public address. This container is the public address.
#
#      docker build -f deploy/shop-proxy/Dockerfile -t og-shop-proxy .
#
#  In Coolify:
#      Dockerfile Location  /deploy/shop-proxy/Dockerfile
#      Base Directory       /
#      Ports Exposes        8080
#      Domains              https://shop.ogsports1.com
#      Environment          SHOP_UPSTREAM=https://10.8.0.2:8443
#                           SHOP_TLS_NAME=og-till
#                           BRIDGE_UPSTREAM=http://og-bridge:8787
#      Storage              directory mount /data/og → /etc/nginx/og-till
#                           (holds till.pem, the laptop's PUBLIC certificate)
#      Health check path    /__proxy_health
#
#  deploy/shop-proxy/README.md has the whole walkthrough, WireGuard included.
# =============================================================================

FROM nginx:alpine

#  openssl: to make the placeholder below, and for 15-og-till.sh to print the
#  pinned certificate's fingerprint in the log at every start.
RUN apk add --no-cache openssl

#  THE PLACEHOLDER TRUST ANCHOR (night shift 04). With no till certificate
#  mounted, nginx would refuse to start over a missing file and Coolify would
#  show a crash loop that names nothing. This is a certificate whose private
#  key is thrown away as it is made, so NOTHING can ever present it: the
#  proxy starts, and every request to the laptop is refused — honestly — until
#  the real one is copied in.
RUN mkdir -p /etc/nginx/og /etc/nginx/og-till \
 && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
      -keyout /dev/null -out /etc/nginx/og/placeholder.pem -days 3650 \
      -subj "/CN=og-no-certificate-mounted" 2>/dev/null

#  The nginx image renders anything in /etc/nginx/templates through envsubst at
#  start-up and writes the result into /etc/nginx/conf.d. That is how
#  ${SHOP_UPSTREAM} becomes the laptop's address without baking it into the
#  image — the same image works if the laptop is replaced tomorrow.
COPY deploy/shop-proxy/default.conf.template /etc/nginx/templates/default.conf.template

#  The block every laptop-bound location includes. NOT in templates/: that
#  step writes into conf.d, which is included at http level, and location
#  directives there stop nginx. 15-og-till.sh renders it, before the image's
#  own 20-envsubst step, and checks the certificate on the way.
COPY deploy/shop-proxy/to-till.conf.template /etc/nginx/og/to-till.conf.template
COPY deploy/shop-proxy/15-og-till.sh /docker-entrypoint.d/15-og-till.sh
#  .gitattributes pins *.sh to LF; stripped here as well, because a copy made
#  outside git (a zip, a paste) can still arrive with CRLF, and /bin/sh reads
#  the \r as part of every command.
RUN tr -d '\r' < /docker-entrypoint.d/15-og-till.sh > /tmp/og.sh \
 && mv /tmp/og.sh /docker-entrypoint.d/15-og-till.sh \
 && chmod 755 /docker-entrypoint.d/15-og-till.sh

#  envsubst replaces ONLY the variables named here. Without this list it would
#  also eat nginx's own $host, $remote_addr and $http_upgrade, and the config
#  would render with them blank — which fails in a way that looks like a
#  network problem rather than a typo.
ENV NGINX_ENVSUBST_FILTER=SHOP_UPSTREAM|SHOP_TLS_NAME|BRIDGE_UPSTREAM

#  A default that fails honestly. If SHOP_UPSTREAM is not set in Coolify, this
#  address answers nothing and every request lands on the "shop is not
#  connected" page, which is the truth — rather than nginx refusing to start
#  and Coolify showing a crash loop with no explanation.
ENV SHOP_UPSTREAM=https://127.0.0.1:9 \
    SHOP_TLS_NAME=og-till \
    BRIDGE_UPSTREAM=http://og-bridge:8787

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/__proxy_health >/dev/null || exit 1
