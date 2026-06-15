ARG XRAY_IMAGE=ghcr.io/fedarisha/xray-core:latest

FROM ${XRAY_IMAGE} AS xray-source

FROM node:24.16-alpine AS build

WORKDIR /opt/app

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund --legacy-peer-deps

COPY . .

RUN npm run build \
    && npm run trace


FROM alpine:3.21 AS asn

ARG ASN_LMDB_URL=https://github.com/remnawave/asn-index/releases/latest/download/asn-prefixes-lmdb.tar.gz

RUN apk add --no-cache curl \
    && mkdir -p /usr/local/share/asn \
    && curl -L ${ASN_LMDB_URL} -o /tmp/asn-prefixes-lmdb.tar.gz \
    && tar -xzf /tmp/asn-prefixes-lmdb.tar.gz -C /usr/local/share/asn \
    && rm -f /tmp/asn-prefixes-lmdb.tar.gz


FROM node:24.16-alpine

LABEL org.opencontainers.image.title="Fedarisha Node"
LABEL org.opencontainers.image.description="Remnawave Node with Fedarisha-enabled Xray Core"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

WORKDIR /opt/app

COPY --from=build /opt/app/dist ./dist

COPY --from=xray-source /usr/local/bin/xray /usr/local/bin/xray
COPY --from=xray-source /usr/local/share/xray/geoip.dat /usr/local/share/xray/geoip.dat
COPY --from=xray-source /usr/local/share/xray/geosite.dat /usr/local/share/xray/geosite.dat
COPY --from=asn /usr/local/share/asn /usr/local/share/asn

COPY supervisord.conf /etc/supervisord.conf
COPY docker-entrypoint.sh /usr/local/bin/

RUN apk add --no-cache supervisor libnftnl libmnl \
    && mkdir -p /var/log/supervisor \
    && chmod +x /usr/local/bin/docker-entrypoint.sh /opt/app/dist/cli.js \
    && ln -s /usr/local/bin/xray /usr/local/bin/rw-core \
    && ln -s /opt/app/dist/cli.js /usr/local/bin/cli \
    && printf '#!/bin/sh\ntail -n +1 -f /var/log/supervisor/xray.out.log\n' > /usr/local/bin/xlogs \
    && printf '#!/bin/sh\ntail -n +1 -f /var/log/supervisor/xray.err.log\n' > /usr/local/bin/xerrors \
    && chmod +x /usr/local/bin/xlogs /usr/local/bin/xerrors

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-http-header-size=65536"
ENV UV_THREADPOOL_SIZE=24

ENV XTLS_API_PORT=61000
ENV XRAY_JSON_STRICT=true

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["node", "dist/main.js"]
