# syntax=docker/dockerfile:1.6
FROM oven/bun:1.3.14-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation libatk-bridge2.0-0 libatk1.0-0 \
      libcups2 libdrm2 libgbm1 libnss3 libxcomposite1 \
      libxdamage1 libxrandr2 xdg-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

RUN mkdir -p /app/session /app/logs /app/uploads \
 && chown -R bun:bun /app

USER bun

EXPOSE 3264

CMD ["bun", "run", "index.js"]
