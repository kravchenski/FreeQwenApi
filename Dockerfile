FROM oven/bun:1.3.14-slim AS builder

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim AS runtime

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
 && apt-get install -y --no-install-recommends chromium-headless-shell ca-certificates \
 && rm -f /usr/lib/chromium/libVkLayer_khronos_validation.so* /usr/lib/chromium/libVkICD_mock_icd.so* \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /usr/share/doc/* /usr/share/man/* /usr/share/info/*

ENV CHROME_PATH=/usr/bin/chromium-headless-shell \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock index.js ./
COPY --chown=bun:bun src ./src

RUN install -d -o bun -g bun /app/session /app/logs /app/uploads

USER bun

EXPOSE 3264

CMD ["bun", "run", "index.js"]
