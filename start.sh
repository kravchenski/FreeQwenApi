#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_CHECKS=true
RUN_AUTH=true
FORCE_AUTH=false
SYNC_MODELS=true
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

Install, validate, authenticate, synchronize models, and start FreeQwenApi.

Options:
  --auth          Always open the Qwen account authentication flow
  --skip-auth     Do not check or configure Qwen accounts
  --skip-checks   Skip Bun tests and build validation
  --skip-sync     Skip Qwen model synchronization
  --check-only    Install dependencies and run checks, then exit
  -h, --help      Show this help

Environment variables are passed to the server. Common examples:
  PORT=3264 HOST=0.0.0.0 ./start.sh
  LOG_LEVEL=debug ./start.sh --skip-sync
EOF
}

log() {
  printf '\n==> %s\n' "$1"
}

warn() {
  printf '\nWarning: %s\n' "$1" >&2
}

for arg in "$@"; do
  case "$arg" in
    --auth)
      FORCE_AUTH=true
      ;;
    --skip-auth)
      RUN_AUTH=false
      ;;
    --skip-checks)
      RUN_CHECKS=false
      ;;
    --skip-sync)
      SYNC_MODELS=false
      ;;
    --check-only)
      CHECK_ONLY=true
      RUN_AUTH=false
      SYNC_MODELS=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v bun >/dev/null 2>&1; then
  printf 'Bun is required. Install it from https://bun.sh/\n' >&2
  exit 1
fi

log "Installing dependencies from bun.lock"
PUPPETEER_SKIP_DOWNLOAD=true bun install --frozen-lockfile

if [[ "$RUN_CHECKS" == true ]]; then
  log "Running offline tests and Bun build validation"
  bun run ci
fi

if [[ "$CHECK_ONLY" == true ]]; then
  log "Checks completed"
  exit 0
fi

if [[ "$RUN_AUTH" == true ]]; then
  has_valid_account=false
  if bun -e 'const { hasValidTokens } = await import("./src/api/tokenManager.js"); process.exit(hasValidTokens() ? 0 : 1);'; then
    has_valid_account=true
  fi

  if [[ "$FORCE_AUTH" == true || "$has_valid_account" == false ]]; then
    if [[ ! -t 0 ]]; then
      printf 'No active Qwen account found and no interactive terminal is available.\n' >&2
      printf 'Run "./start.sh --auth" in a terminal or provide an existing session/ directory.\n' >&2
      exit 1
    fi

    log "Opening Qwen account authentication"
    bun run auth -- --add

    if ! bun -e 'const { hasValidTokens } = await import("./src/api/tokenManager.js"); process.exit(hasValidTokens() ? 0 : 1);'; then
      printf 'Authentication finished without an active Qwen account.\n' >&2
      exit 1
    fi
  else
    log "Active Qwen account found"
  fi
fi

if [[ "$SYNC_MODELS" == true ]]; then
  log "Synchronizing Qwen model metadata"
  if ! bun run models:sync; then
    warn "Model synchronization failed; starting with src/AvailableModels.txt"
  fi
fi

log "Starting FreeQwenApi"
exec env SKIP_ACCOUNT_MENU=true bun start
