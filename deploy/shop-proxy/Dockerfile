# syntax=docker/dockerfile:1.7

# =============================================================================
#  shop.ogsports1.com — the front door on the VPS
# -----------------------------------------------------------------------------
#  A reverse proxy and nothing else. It holds no database, no key and no state:
#  every request is answered by the shop's own server on the laptop in Aleppo,
#  reached over the private Tailscale network.
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
#      Environment          SHOP_UPSTREAM=http://100.x.y.z:8090
#      Health check path    /__proxy_health
#
#  deploy/shop-proxy/README.md has the whole walkthrough, Tailscale included.
# =============================================================================

FROM nginx:alpine

#  The nginx image renders anything in /etc/nginx/templates through envsubst at
#  start-up and writes the result into /etc/nginx/conf.d. That is how
#  ${SHOP_UPSTREAM} becomes the laptop's address without baking it into the
#  image — the same image works if the laptop is replaced tomorrow.
COPY deploy/shop-proxy/default.conf.template /etc/nginx/templates/default.conf.template

#  envsubst replaces ONLY the variables named here. Without this list it would
#  also eat nginx's own $host, $remote_addr and $http_upgrade, and the config
#  would render with them blank — which fails in a way that looks like a
#  network problem rather than a typo.
ENV NGINX_ENVSUBST_FILTER=SHOP_UPSTREAM

#  A default that fails honestly. If SHOP_UPSTREAM is not set in Coolify, this
#  address answers nothing and every request lands on the "shop is not
#  connected" page, which is the truth — rather than nginx refusing to start
#  and Coolify showing a crash loop with no explanation.
ENV SHOP_UPSTREAM=http://127.0.0.1:9

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/__proxy_health >/dev/null || exit 1
