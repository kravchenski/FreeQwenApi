# pi agent

FreeQwenApi exposes Qwen and DeepSeek through one OpenAI-compatible gateway,
including streaming, tool calls, and persistent remote chat mappings.

```bash
bun run setup:pi
docker compose up -d
pi --provider freeai --model qwen3-coder-plus
```

Use `/model` inside Pi to switch between every configured Qwen and DeepSeek
model. Re-run `bun run setup:pi` after synchronizing new Qwen models.

## Reliable file rewrites

When asking pi to replace a complete file, tell it to use its `write` tool with
the final content. Avoid asking it to use `edit` with the complete previous file
as `oldText`: large escaped strings are more likely to be truncated or emitted
as invalid JSON.

For example, ask pi:

```text
Rewrite main.py as main.ts. Use the write tool with the complete final
TypeScript source, then run the TypeScript checker. Do not send the old file as
an edit oldText argument.
```

Valid tool-call output is one minified JSON object. Property names and paths
must never contain inserted whitespace or line breaks:

```json
{"tool_calls":[{"name":"write","arguments":{"path":"/absolute/path/main.ts","content":"console.log(\"ready\");\n"}}]}
```

## DeepSeek web

The repository also includes a separate OpenAI-compatible proxy for
`https://chat.deepseek.com/`. It uses DeepSeek's native web chat sessions and
solves the required Proof-of-Work challenge before each completion.

Start the proxy and use the account menu, matching the Qwen startup flow:

```bash
bun run start:deepseek:full
```

Choose `1` to register or add an account. Chromium opens the DeepSeek sign-in
page; complete registration or sign in, wait until the chat interface appears,
return to the terminal, and press Enter. The proxy captures the authenticated
request token and verifies the `ds_session_id` cookie before saving the account
under `session/deepseek/`. Authentication uses a persistent normal-browser
profile at `session/deepseek/browser-profile`, so Google login can be reused
between attempts. Set `DEEPSEEK_CHROME_PATH` to an installed Google Chrome
binary when Google rejects the system Chromium. The menu also supports relogin
and account removal.

Manage DeepSeek accounts without starting the proxy:

```bash
bun run auth:deepseek -- --list
bun run auth:deepseek -- --add
bun run auth:deepseek -- --relogin
bun run auth:deepseek -- --remove
```

For non-interactive startup, set `SKIP_ACCOUNT_MENU=true`. `DEEPSEEK_TOKEN`
remains available as an optional fallback for container deployments.

The DeepSeek proxy listens on `http://127.0.0.1:3265/api` internally. Pi should
normally use the unified gateway:

```bash
pi --provider freeai --model deepseek-default
```

Use `deepseek-reasoner` for thinking mode. Pi sessions are mapped to stable
native provider chats, and DeepSeek mappings persist under
`session/deepseek/chat-sessions.json`.
