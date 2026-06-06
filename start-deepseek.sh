#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  printf 'Bun is required. Install it from https://bun.sh/\n' >&2
  exit 1
fi

printf '\n==> Installing dependencies\n'
PUPPETEER_SKIP_DOWNLOAD=true bun install --frozen-lockfile

printf '\n==> Running tests and build validation\n'
bun run ci

printf '\n==> Starting DeepSeek account menu and proxy\n'
exec bun run start:deepseek
