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
