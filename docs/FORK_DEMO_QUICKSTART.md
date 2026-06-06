# Быстрый старт для демо обновлённого fork FreeQwenApi

Этот fork подготовлен под практичный сценарий для видео и демонстраций:

- синхронизация актуального списка моделей Qwen Chat (`qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`);
- локальный OpenAI-совместимый эндпоинт для SDK, Hermes Agent, Open WebUI и LiteLLM;
- быстрая smoke-проверка, чтобы перед записью не гадать, жив ли прокси.

## 1. Один раз авторизуйтесь

```bash
bun install
bun run auth
```

Не публикуйте `session/`, cookies и файлы с токенами.

## 2. Синхронизируйте актуальные модели Qwen Chat

```bash
bun run models:sync
```

Команда читает публичные prerendered-метаданные моделей с `https://chat.qwen.ai/`, объединяет их с `src/AvailableModels.txt` и записывает отчёт сюда:

```text
docs/QWEN_CHAT_MODELS.md
```

## 3. Запустите эндпоинт

```bash
SKIP_ACCOUNT_MENU=true bun start
```

Эндпоинт:

```text
http://localhost:3264/api
```

## 4. Запустите smoke-проверку

В другом терминале:

```bash
bun run smoke
```

Модель для проверки по умолчанию:

```text
qwen3.7-max
```

Можно заменить:

```bash
QWEN_PROXY_SMOKE_MODEL=qwen3.7-plus bun run smoke
```

## 5. Проверка через OpenAI SDK / curl

```bash
curl http://localhost:3264/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.7-max",
    "messages": [
      {"role": "user", "content": "Ответь одним предложением: что такое локальный endpoint?"}
    ],
    "stream": false
  }'
```

## 6. Пример провайдера для Hermes Agent

```yaml
custom_providers:
  - name: qwen-free
    base_url: http://localhost:3264/api
    model: qwen3.7-max
    api_key: dummy-key
```

Запуск:

```bash
hermes chat --provider custom:qwen-free --model qwen3.7-max
```

## 7. Claude Code через мост LiteLLM

Claude Code ожидает Anthropic Messages API, а этот прокси отдаёт OpenAI Chat Completions. Используйте LiteLLM как мост:

```yaml
model_list:
  - model_name: qwen3.7-max
    litellm_params:
      model: openai/qwen3.7-max
      api_base: http://localhost:3264/api
      api_key: dummy-key

general_settings:
  master_key: ***
```

Запустите LiteLLM:

```bash
litellm --config qwen_litellm.yaml --host 127.0.0.1 --port 4000
```

Запустите Claude Code:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:4000"
export ANTHROPIC_AUTH_TOKEN="***"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
claude --model qwen3.7-max
```

## Важное уточнение

Можно говорить так:

> Это не локальная модель, которая работает на вашей видеокарте. Это локальный OpenAI-совместимый прокси к Qwen Chat — удобно для экспериментов с AI-агентами и локальными инструментами.

Не обещайте production-стабильность: лимиты Qwen Chat, срок жизни токенов, состояние аккаунта и совместимость API могут меняться.
