# Contributing

## Development Setup

Requirements:

- Bun 1.3.14 or newer
- Chrome, Chromium, Edge, or Brave for authentication flows
- Docker Desktop or Docker Engine for container changes

```text
bun install --frozen-lockfile
bun run ci
```

Use the portable launcher to validate startup changes:

```text
bun run start:full -- --check-only
```

## Pull Request Requirements

Before opening a pull request:

1. Keep changes focused and preserve existing public API behavior.
2. Add tests for new routing, session, platform, or compatibility behavior.
3. Run `bun run ci`.
4. Run `docker compose config -q` after Compose changes.
5. Never commit `session/`, logs, cookies, tokens, or browser profiles.

CI validates analysis, tests, launcher behavior, and Bun builds on Linux,
macOS, and Windows. Docker images are validated on Linux.

## Project Conventions

- Prefer Bun and platform-neutral Node APIs over shell-specific logic.
- Keep entrypoints thin; put reusable behavior under `src/`.
- Treat provider web responses as unstable and cover parsers with fixtures or
  focused unit tests.
- Preserve Pi Agent tool-call and conversation-continuity behavior.
- Use descriptive commits that keep refactors, behavior changes, and docs
  separable.
