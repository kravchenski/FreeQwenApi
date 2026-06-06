<div align="center">

# FreeQwenApi

**Turn Qwen Chat into a local OpenAI-compatible API for agents, apps, and experiments.**

[![CI](https://github.com/kravchenski/FreeQwenApi/actions/workflows/ci.yml/badge.svg)](https://github.com/kravchenski/FreeQwenApi/actions/workflows/ci.yml)
[![Container](https://github.com/kravchenski/FreeQwenApi/actions/workflows/release.yml/badge.svg)](https://github.com/kravchenski/FreeQwenApi/actions/workflows/release.yml)
[![GitHub stars](https://img.shields.io/github/stars/kravchenski/FreeQwenApi?style=flat)](https://github.com/kravchenski/FreeQwenApi/stargazers)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000)](https://bun.sh)
[![OpenAI compatible](https://img.shields.io/badge/API-OpenAI%20compatible-412991)](#api-reference)

[Quick start](#quick-start) · [pi agent](#pi-agent) · [Open WebUI](#open-webui) · [API reference](#api-reference) · [Docker](#docker) · [Security](#security)

</div>

FreeQwenApi is an unofficial, browser-backed proxy for [Qwen Chat](https://chat.qwen.ai/).
It signs in with your Qwen Chat account, preserves the browser session, and exposes a
local API compatible with OpenAI Chat Completions.

Use it to connect Qwen Chat to **pi agent**, OpenAI SDKs, Open WebUI, LiteLLM,
Hermes Agent, custom scripts, and other OpenAI-compatible clients.

> [!IMPORTANT]
> This project is not an official Alibaba Cloud or Qwen API, and it does not run a
> model locally. Qwen Chat can change its internal API, rate limits, or account
> behavior at any time. Use the official provider API for production workloads.

## Highlights

- **OpenAI-compatible chat** with regular and streaming responses.
- **Agent tool calls** through an OpenAI-compatible adapter for pi agent and Hermes.
- **Multimodal input**, file upload, image generation, and video generation.
- **Multi-account rotation** with rate-limit and invalid-session tracking.
- **Conversation continuity** with chat IDs, parent IDs, and scoped sessions.
- **Current Qwen model discovery** from Qwen Chat metadata.
- **Bun-first runtime** with a reproducible `bun.lock`.
- **Docker image** based on Bun and system Chromium.
- **CI/CD** for tests, Bun build validation, Docker builds, and GHCR releases.

## How It Works

```text
OpenAI-compatible client
         |
         | POST /api/chat/completions
         v
  FreeQwenApi on Bun
         |
         | browser session + Qwen Chat web API
         v
      Qwen Chat
```

The proxy keeps authentication data locally under `session/`. Requests are mapped
to Qwen Chat models and translated back into OpenAI-compatible responses.

## Quick Start

### Requirements

- [Bun](https://bun.sh/) 1.2 or newer
- Chromium or Chrome
- A Qwen Chat account

### Install and authenticate

```bash
git clone https://github.com/kravchenski/FreeQwenApi.git
cd FreeQwenApi

./start.sh
```

The full startup script installs dependencies, runs offline checks, opens the
authentication flow when no active account exists, synchronizes models, and
starts the proxy. Sign in to Qwen Chat and return to the terminal when prompted.

To run each step manually:

```bash
bun install
bun run auth
bun run models:sync
SKIP_ACCOUNT_MENU=true bun start
```

The API is now available at:

```text
http://127.0.0.1:3264/api
```

Verify the installation from another terminal:

```bash
curl http://127.0.0.1:3264/api/health
bun run smoke
```

## First Request

```bash
curl http://127.0.0.1:3264/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.7-max",
    "messages": [
      {
        "role": "user",
        "content": "Explain what FreeQwenApi does in one sentence."
      }
    ],
    "stream": false
  }'
```

### OpenAI JavaScript SDK

```js
import OpenAI from "openai";

const qwen = new OpenAI({
  baseURL: "http://127.0.0.1:3264/api",
  apiKey: "dummy-key",
});

const response = await qwen.chat.completions.create({
  model: "qwen3.7-max",
  messages: [{ role: "user", content: "Hello from the OpenAI SDK." }],
});

console.log(response.choices[0].message.content);
```

### Streaming

```js
const stream = await qwen.chat.completions.create({
  model: "qwen3.7-plus",
  messages: [{ role: "user", content: "Write a short Bun example." }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

More examples are available in [`examples/`](examples/README.md).

## pi Agent

FreeQwenApi includes a ready-to-use custom provider for
[pi](https://github.com/badlogic/pi-mono). It enables streaming and agent tool
calls while disabling OpenAI fields unsupported by the browser-backed proxy.

```bash
mkdir -p ~/.pi/agent
cp examples/pi-agent/models.json ~/.pi/agent/models.json

export FREEQWEN_API_KEY=dummy-key
pi --provider freeqwen --model qwen3-coder-plus
```

Available presets:

| Model | Recommended use |
| --- | --- |
| `qwen3-coder-plus` | Coding agent and tool-heavy tasks |
| `qwen3.7-max` | General-purpose agent |
| `qwen3.7-plus` | Faster general chat |

See [`examples/pi-agent/README.md`](examples/pi-agent/README.md) for configuration
details.

## Open WebUI

Add an OpenAI-compatible connection:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:3264/api` |
| API key | `dummy-key` or your configured proxy key |
| Model | `qwen3.7-max` |

When Open WebUI runs in Docker, use `http://host.docker.internal:3264/api`.

See [`docs/OPENWEBUI_SETUP.md`](docs/OPENWEBUI_SETUP.md) for the complete setup.

## Other Integrations

### Hermes Agent

```yaml
custom_providers:
  - name: qwen-free
    base_url: http://127.0.0.1:3264/api
    model: qwen3.7-max
    api_key: dummy-key
```

### LiteLLM

```yaml
model_list:
  - model_name: qwen3.7-max
    litellm_params:
      model: openai/qwen3.7-max
      api_base: http://127.0.0.1:3264/api
      api_key: dummy-key
```

Ready-made configurations:

- [`examples/hermes/config-snippet.yaml`](examples/hermes/config-snippet.yaml)
- [`examples/litellm/qwen_litellm.yaml`](examples/litellm/qwen_litellm.yaml)

## Models

The default model list is stored in [`src/AvailableModels.txt`](src/AvailableModels.txt).
Refresh it from Qwen Chat metadata with:

```bash
bun run models:sync
```

Common choices:

| Use case | Model |
| --- | --- |
| General chat and agents | `qwen3.7-max` |
| Fast general chat | `qwen3.7-plus` |
| Coding | `qwen3-coder-plus` |
| Vision, image, and video workflows | `qwen3-vl-plus` |

Inspect the models exposed by your running proxy:

```bash
curl http://127.0.0.1:3264/api/models
```

## Image Generation

By default, image requests use Qwen Chat and do not require a DashScope API key:

```bash
curl http://127.0.0.1:3264/api/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-vl-plus",
    "prompt": "A cinematic robot walking through neon Warsaw",
    "size": "16:9"
  }'
```

Supported aspect ratios include `16:9`, `9:16`, `1:1`, and `4:3`. OpenAI-style
sizes such as `1024x1024` are converted automatically.

Set `"provider": "dashscope"` and configure `DASHSCOPE_API_KEY` to use the
legacy DashScope image provider.

## Video Generation

Wait for the result in the initial request:

```bash
curl http://127.0.0.1:3264/api/videos/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-vl-plus",
    "prompt": "A slow camera move through a futuristic city at night",
    "size": "16:9",
    "wait": true
  }'
```

For client-side polling, set `"wait": false` and query:

```bash
curl "http://127.0.0.1:3264/api/tasks/status/TASK_ID?wait=true"
```

See [`IMAGE_VIDEO_GENERATION_GUIDE.md`](IMAGE_VIDEO_GENERATION_GUIDE.md) for
the full media-generation guide.

## API Reference

All routes are mounted under `/api`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Lightweight service health |
| `GET` | `/status` | Browser authentication and account status |
| `GET` | `/models` | OpenAI-compatible model list |
| `POST` | `/chat` | Native simplified chat request |
| `POST` | `/chat/completions` | OpenAI-compatible Chat Completions |
| `POST` | `/v1/chat/completions` | Alternate OpenAI-compatible route |
| `POST` | `/chats` | Create a Qwen chat |
| `GET` | `/chats/:chatId/history` | Read locally stored chat history |
| `POST` | `/chats/:chatId/history` | Update locally stored chat history |
| `POST` | `/files/upload` | Upload an attachment |
| `POST` | `/files/getstsToken` | Request upload credentials |
| `POST` | `/images/generations` | Generate an image |
| `GET` | `/images/models` | List image models |
| `GET` | `/images/status` | Check image provider status |
| `POST` | `/videos/generations` | Generate a video |
| `GET` | `/videos/models` | List video models |
| `GET` | `/videos/status` | Check video provider status |
| `GET` | `/tasks/status/:taskId` | Poll an asynchronous media task |

### Tool Calls

`/chat/completions` accepts OpenAI-style `tools`, legacy `functions`, and tool
result messages. Qwen Chat does not expose native OpenAI tool schemas, so
FreeQwenApi translates tool definitions into a controlled prompt and converts
the model output back into `message.tool_calls`.

## Authentication and Accounts

Manage Qwen Chat accounts with:

```bash
bun run auth                 # interactive menu
bun run auth -- --add
bun run auth -- --list
bun run auth -- --relogin
bun run auth -- --remove
```

Multiple active accounts are selected in round-robin order. Rate-limited
accounts are temporarily skipped, while invalid accounts are marked for
reauthentication.

To protect the local proxy itself, add allowed bearer tokens to
`src/Authorization.txt`, one token per line. An empty or missing file disables
proxy-level authentication.

## Configuration

Create a local `.env` or export environment variables before starting the proxy.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `PORT` | `3264` | HTTP port |
| `DEFAULT_MODEL` | `qwen-max-latest` | Default chat model |
| `SKIP_ACCOUNT_MENU` | `false` | Start without the interactive account menu |
| `NON_INTERACTIVE` | `false` | Alias for non-interactive startup |
| `CHROME_PATH` | auto-detected | Chromium or Chrome executable |
| `SESSION_DIR` | `session` | Local authentication storage |
| `LOG_LEVEL` | `info` | Winston log level |
| `PAGE_POOL_SIZE` | `3` | Maximum reusable browser pages |
| `MAX_FILE_SIZE` | `10485760` | Upload limit in bytes |
| `PAGE_TIMEOUT` | `120000` | Browser page timeout in milliseconds |
| `MAX_RETRY_COUNT` | `3` | Qwen request retry limit |
| `STREAMING_CHUNK_DELAY` | `20` | Streaming chunk delay in milliseconds |
| `ALLOW_UNSCOPED_SESSION_CHAT_RESTORE` | `false` | Enable legacy IP/User-Agent chat restore |
| `REQUEST_BODY_LIMIT` | `25mb` | Maximum JSON and URL-encoded request body |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Per-client rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Maximum requests per window; `0` disables |
| `CORS_ALLOWED_ORIGINS` | unset | Comma-separated browser origins; use `*` explicitly for public CORS |
| `DASHSCOPE_API_KEY` | unset | Optional legacy image-generation provider |

Advanced endpoint, timeout, logging, and polling options are defined in
[`src/config.js`](src/config.js).

## Docker

Authenticate locally first because the production container has no interactive GUI:

```bash
bun run auth
docker compose up --build -d
```

The Compose configuration persists:

- `./session` for Qwen authentication
- `./logs` for application logs
- `./uploads` for temporary uploads

### Published Image

Tagged releases are published by GitHub Actions to GitHub Container Registry:

```bash
docker pull ghcr.io/kravchenski/freeqwenapi:latest
```

Run it with an existing session directory:

```bash
docker run --rm -p 3264:3264 \
  -e SKIP_ACCOUNT_MENU=true \
  -v "$PWD/session:/app/session" \
  ghcr.io/kravchenski/freeqwenapi:latest
```

## Development

```bash
bun install
bun run dev
```

Project checks:

```bash
bun run test
bun run check
bun run ci
```

Useful commands:

| Command | Description |
| --- | --- |
| `bun start` | Start the proxy |
| `bun run start:full` | Install, validate, authenticate, sync models, and start |
| `bun run dev` | Start with Bun watch mode |
| `bun run auth` | Manage Qwen accounts |
| `bun run models:sync` | Refresh Qwen model metadata |
| `bun run smoke` | Test a running authenticated proxy |
| `bun run test` | Run offline Bun tests |
| `bun run check` | Validate that the server bundles under Bun |
| `bun run ci` | Run all offline CI checks |

The smoke test is intentionally not part of CI because it requires a real Qwen
account and session.

The full startup script also supports:

```bash
./start.sh --help
./start.sh --check-only
./start.sh --skip-checks --skip-sync
./start.sh --auth
```

## CI/CD

GitHub Actions workflows live in [`.github/workflows/`](.github/workflows/):

- **CI** runs frozen dependency installation, Bun tests, Bun build validation,
  and a Docker build for pull requests and branch pushes.
- **Container release** publishes multi-platform images to GHCR for version tags
  such as `v1.2.3`, and can also be started manually.

Create a release image:

```bash
git tag v1.1.0
git push origin v1.1.0
```

## Security

Never commit or publish:

- `session/` or `session/tokens.json`
- `session/accounts/**/token.txt`
- `.env` files
- `Authorization.txt`
- cookies, browser profiles, or real bearer tokens

These paths are covered by [`.gitignore`](.gitignore), but always inspect staged
changes before pushing:

```bash
git diff --cached
```

If a token is exposed, revoke or refresh it immediately. Please report
security-sensitive issues privately instead of opening a public issue.

## Troubleshooting

### No valid accounts found

Run `bun run auth -- --list`, then add or relogin an account.

### Chromium does not start

Install Chromium and set its executable explicitly:

```bash
CHROME_PATH=/usr/bin/chromium bun run auth
```

### The proxy starts but requests fail

Check:

```bash
curl http://127.0.0.1:3264/api/status
curl http://127.0.0.1:3264/api/models
```

Then inspect `logs/` and relogin if the Qwen session expired.

### A model is missing

Refresh metadata with `bun run models:sync`, or add the model to
`src/AvailableModels.txt`.

## Documentation

- [`docs/FORK_DEMO_QUICKSTART.md`](docs/FORK_DEMO_QUICKSTART.md) - demo-oriented quick start
- [`docs/OPENWEBUI_SETUP.md`](docs/OPENWEBUI_SETUP.md) - Open WebUI setup
- [`docs/QWEN_CHAT_MODELS.md`](docs/QWEN_CHAT_MODELS.md) - model synchronization notes
- [`docs/IMAGE_GENERATION.md`](docs/IMAGE_GENERATION.md) - image-generation details
- [`IMAGE_VIDEO_GENERATION_GUIDE.md`](IMAGE_VIDEO_GENERATION_GUIDE.md) - image and video guide
- [`examples/README.md`](examples/README.md) - JavaScript and Python examples

## Disclaimer

FreeQwenApi is an independent community project. It is not affiliated with,
endorsed by, or supported by Alibaba Cloud or the Qwen team. You are responsible
for complying with Qwen's terms, applicable laws, and the policies of any
connected service.

## Community

Updates and practical AI tooling from the fork maintainers:
[t.me/forgetmeai](https://t.me/forgetmeai).
