# og-bridge — the VPS half of OG System (vps/og-bridge/README.md).
#
# In Coolify: a Dockerfile resource from this repository,
#   Base Directory      /vps/og-bridge
#   Dockerfile Location /Dockerfile
#   Ports Exposes       8787
#   Domains             (NONE — nginx reaches it on the coolify network)
#   Network alias       og-bridge
#   Health check path   /healthz
#   Storage             directory mount /data/og -> /etc/og-till  (till.pem)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# pg is og-bridge's one dependency; it stays inside this folder, never the
# shop's server (which has none by design).
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
