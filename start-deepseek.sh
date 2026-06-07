#!/usr/bin/env sh
set -eu
ROOT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"
exec bun run scripts/start.ts --service deepseek "$@"
