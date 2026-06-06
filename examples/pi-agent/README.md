# pi agent

FreeQwenApi already exposes the OpenAI Chat Completions contract used by pi,
including streaming and tool calls. The included `models.json` disables OpenAI
features that the browser-backed proxy does not implement.

```bash
mkdir -p ~/.pi/agent
cp examples/pi-agent/models.json ~/.pi/agent/models.json
export FREEQWEN_API_KEY=dummy-key
pi --provider freeqwen --model qwen3-coder-plus
```

When `src/Authorization.txt` contains a real API key, use that value for
`FREEQWEN_API_KEY`. If the proxy runs on another host, change `baseUrl`.

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
