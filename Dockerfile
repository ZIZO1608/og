# syntax=docker/dockerfile:1.7

# =============================================================================
#  OG SYSTEM — the shop's server, in a container
# -----------------------------------------------------------------------------
#  ONE PROCESS SERVES BOTH HALVES. There is no static build of this app and
#  there never was: `index.html` on its own draws the "server is not
#  answering" screen, because every screen is filled by DB.hydrate() from the
#  API. So the container runs `node server/index.js`, which serves the API
#  *and* index.html, css/, js/ and assets/ from one origin — the same command
#  the shop's laptop runs. Putting nginx in front of a folder of files would
#  produce a page that loads and then says the shop is unreachable.
#
#  THERE IS NOTHING TO BUILD AND NOTHING TO INSTALL. The frontend has no
#  bundler and the server has zero dependencies by design (`node:sqlite`,
#  `node:crypto`, `fetch` — all built in), so there is no `npm ci` step and no
#  node_modules in this image. The build stage below earns its keep by running
#  the one test and by assembling an allow-list of what actually gets served,
#  the way make-deploy.ps1 does for the published site.
#
#  NODE 24, AND WHY NOT 22. package.json says >=22.5, which is when
#  `node:sqlite` arrived — but it was behind --experimental-sqlite for most of
#  the 22 line, and this app starts with a bare `node index.js`. 24 is what
#  the shop's own machine runs.
#
#  WHAT THIS CONTAINER CANNOT DO, and it is not a fault in the image: it
#  cannot print. The receipt printer is a Windows share and the label printer
#  is either that or a box on the shop's LAN at :9100 — neither is reachable
#  from a VPS. Selling, stock, customers, money, the delivery office, the
#  partner portal, Telegram and the mirror all work. Printing wants a machine
#  in the shop. See DEPLOY.md.
# =============================================================================


# --------------------------------------------------------------- stage 1 ----
#  Check, then assemble. Nothing from this stage survives except /out.
FROM node:24-alpine AS build

WORKDIR /src
COPY . .

#  The one test in the repository: it reads the browser's own source for every
#  config key it sends through PUT /api/config and checks each against the
#  allow-list the route uses. It needs no server, no database and no network.
#  It is here because a key nobody is checking is how "Save changes never
#  saved" happened. Delete this line if you would rather a deploy never be
#  blocked by it.
RUN node --test "server/test/*.test.js"

#  An ALLOW-LIST, not a delete-list. A new folder at the repository root does
#  not silently end up on a public server by being forgotten about; it ends up
#  there by being named here.
RUN set -eux; \
    mkdir -p /out; \
    cp -r package.json index.html manifest.webmanifest sw.js robots.txt \
          css js assets server /out/; \
    rm -rf /out/server/data /out/server/data-sandbox /out/server/data-sandbox2 \
           /out/server/backups; \
    rm -f  /out/server/.env /out/server/.env.sandbox; \
    find /out -type f -name '_*' -delete

#  ONE CACHE NAME PER SET OF PAGES. sw.js is cache-first with ignoreSearch, so
#  a browser that already has the app keeps its copy until the worker's CACHE
#  name changes. On the laptop the panel's Full refresh bumps it by hand; the
#  shop on the VPS (deploy/og-shop, `npm run vps -- deploy`) has no panel, so
#  the image names its cache after the files it serves: the same pages, the
#  same name, and one byte different, a new one — every open till takes the
#  new files on its next check (js/update.js), and a deploy that changed only
#  the server does not make every phone download the app again.
RUN set -eu; \
    H=$(cd /out && find index.html manifest.webmanifest css js assets -type f -exec sha256sum {} + | sort | sha256sum | cut -c1-10); \
    sed -i -E "s/^var CACHE = '([^']*)';/var CACHE = '\1-$H';/" /out/sw.js; \
    grep -q "^var CACHE = '.*-$H';" /out/sw.js


# --------------------------------------------------------------- stage 2 ----
FROM node:24-alpine AS runtime

#  tini reaps orphans and forwards signals. index.js handles SIGTERM itself
#  (shutdown() closes the database, stops the reminder tick, the Telegram
#  long-poll and the mirror push), so what this buys is that the handler is
#  reached the same way whether the container is stopped by Coolify, by
#  `docker stop`, or by the host shutting down.
#  tzdata: the zone files TZ below points at. Receipts, the bell and the
#  Telegram messages format dates in the PROCESS's own zone (receipt.js,
#  alerts.js, telegram.js), and a VPS runs in UTC — a sale at 21:30 in Aleppo
#  would print 18:30 on its receipt. Reminders and the day close use the
#  shop's own setting (shop.tz_minutes) and are not affected either way.
RUN apk add --no-cache tini tzdata

#  Defaults for a proxied deployment. Every one can be overridden in Coolify.
#
#  OG_PORT        the port inside the container; Coolify's proxy talks to this.
#  OG_HTTPS=0     NO TLS IN HERE. The certificate machinery (server/lib/tls.js)
#                 exists for a laptop on a shop's wifi with no public name. On a
#                 VPS the proxy in front terminates TLS with a real Let's
#                 Encrypt certificate, and a second self-signed one inside would
#                 only redirect browsers to :8443 — a port the proxy does not
#                 carry, so every page would fail to open.
#  OG_SECURE=1    the public origin IS https, so session cookies get Secure.
#  OG_DATA_DIR    the database, the certificates AND THE BACKUPS in one folder,
#                 the one on the volume. Unset, the backups went to
#                 /app/server/backups — inside the container, gone at the next
#                 redeploy, while DEPLOY.md said they were on the volume.
#  TZ             the shop's day, for everything that prints a time.
#
#  OG_TRUST_PROXY is RETIRED (night shift 04): the server ignores it and prints
#  a notice while it is set. It believed any caller's X-Forwarded-For. Its
#  replacement is OG_PROXY_ADDR — the ONE address a proxy's requests arrive
#  from, whose X-OG-Client-IP is then believed (server/lib/proxy.js). Behind
#  the shop-proxy nginx that is the nginx container's address; see DEPLOY.md.
ENV NODE_ENV=production
ENV OG_PORT=8090
ENV OG_HTTPS=0
ENV OG_SECURE=1
ENV OG_DATA_DIR=/app/server/data
ENV TZ=Asia/Damascus

WORKDIR /app
COPY --from=build --chown=node:node /out /app

#  The database, the backups and anything the app writes. It is a MOUNT POINT,
#  not part of the image: see DEPLOY.md for the volume. Created and owned here
#  so the unprivileged user can write to it on the first boot, when DB.open()
#  creates og.db and applies every migration.
RUN mkdir -p /app/server/data/backups \
    && chown -R node:node /app/server/data

#  Not root. Nothing here needs a privileged port or a device.
USER node

EXPOSE 8090

#  The app's own answer about itself, which is also what the login screen
#  reads. A container that is up but whose database will not open is not
#  healthy, and this is the difference.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OG_PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
