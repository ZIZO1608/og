# syntax=docker/dockerfile:1.7

# =============================================================================
#  ogsports1.com — the public shop page
# -----------------------------------------------------------------------------
#  Two pages, one stylesheet, the shop's own mark and vendored fonts. No
#  framework, no bundler, no JavaScript on the page at all — the same rule the
#  app one directory up lives by.
#
#  THE BUILD CONTEXT IS THE REPOSITORY ROOT, not site/, because the page wears
#  the shop's own mark and fonts out of assets/. One copy of those files, not
#  two that drift:
#
#      docker build -f site/Dockerfile -t og-site .
#      docker build -f site/Dockerfile --build-arg SITE_URL=https://example.com -t og-site .
#
#  The build stage does the one real job there is: it points every absolute
#  link at SITE_URL and stamps the sitemap with today. site/build.mjs says why
#  both of those are done here rather than kept by hand.
#
#  The runtime stage holds nginx, five static files and the fonts. No node, no
#  database, no key — nothing in this container is worth stealing, which is
#  the whole reason it is a separate container from the till.
# =============================================================================

# --------------------------------------------------------------- stage 1 ----
FROM node:24-alpine AS build

ARG SITE_URL=https://ogsports1.com
ENV SITE_URL=${SITE_URL}
ENV OUT_DIR=/out

WORKDIR /src
COPY site/ ./site/
COPY assets/ ./assets/

RUN node site/build.mjs

# --------------------------------------------------------------- stage 2 ----
FROM nginx:alpine AS runtime

#  Replaces the image's own default server block, which listens on 80 and
#  serves nginx's welcome page.
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
