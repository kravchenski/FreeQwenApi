# DeepSeek Official Web Chat Proxy

Экспериментальный OpenAI-compatible прокси к официальному веб-чату DeepSeek (`https://chat.deepseek.com`) по аналогии с FreeQwenApi.

> Это не официальный DeepSeek API и не замена платному `api.deepseek.com`. Скрипт использует ваш браузерный логин в официальном DeepSeek Chat. Возможны лимиты, Cloudflare/CloudFront/PoW-защита и изменения внутренних endpoints.

## Быстрый старт

```bash
npm install
npm run deepseek:auth
npm run deepseek:start
```

Во время `npm run deepseek:auth`:

1. Откроется браузер.
2. Войдите в `chat.deepseek.com`.
3. Отправьте один короткий тестовый prompt прямо в веб-чате — это помогает скрипту захватить нужные web headers (`x-ds-pow-response` и client headers).
4. Вернитесь в терминал и нажмите Enter.

Сессия сохраняется здесь:

```text
session/deepseek/
├── profile/      # browser profile/cookies
└── state.json    # cookie/token/header metadata
```

**Не коммитьте и не публикуйте:** `session/deepseek/`, cookies, токены, `state.json`, browser profile.

## Запуск сервера

```bash
npm run deepseek:start
```

По умолчанию:

```text
http://127.0.0.1:3265/api
```

Поменять порт:

```bash
DEEPSEEK_PORT=3270 npm run deepseek:start
```

## Endpoints

### Health

```bash
curl http://127.0.0.1:3265/api/health
```

### Models

```bash
curl http://127.0.0.1:3265/api/models
```

Возвращает совместимые имена:

- `deepseek-chat`
- `deepseek-reasoner`

### OpenAI-compatible chat completions

```bash
curl http://127.0.0.1:3265/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Привет! Ответь одним предложением."}
    ],
    "stream": false
  }'
```

### Reasoning / search flags

```bash
curl http://127.0.0.1:3265/api/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "thinking": true,
    "search": false,
    "messages": [{"role": "user", "content": "Реши задачу кратко."}]
  }'
```

### Упрощённый endpoint

```bash
curl http://127.0.0.1:3265/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Что такое локальный API endpoint?"}'
```

## Smoke test

В одном терминале:

```bash
npm run deepseek:start
```

В другом:

```bash
npm run deepseek:smoke
```

## Если ловите 401/403 или ошибку про `x-ds-pow-response`

1. Повторите авторизацию:

```bash
npm run deepseek:auth
```

2. В открытом браузере обязательно отправьте один тестовый prompt в самом DeepSeek Chat.
3. Нажмите Enter в терминале.
4. Перезапустите proxy.

Если не помогает, удалите DeepSeek session и авторизуйтесь заново:

```bash
rm -rf session/deepseek
npm run deepseek:auth
npm run deepseek:start
```

## Если не запускается браузер Puppeteer на macOS

Часто это битый Chrome for Testing в кэше Puppeteer:

```bash
rm -rf ~/.cache/puppeteer
npm install
npx puppeteer browsers install chrome
npm run deepseek:auth
```

Или используйте установленный Google Chrome:

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run deepseek:auth
```

## Важные ограничения

- DeepSeek web chat может менять внутренние API без предупреждения.
- Web chat может требовать PoW/header, который фронтенд генерирует перед запросом. Поэтому auth-скрипт просит отправить один prompt в браузере и захватывает актуальные headers.
- Для production лучше использовать официальный `https://api.deepseek.com` с API key.
- Tool calling пока не реализован; этот прокси рассчитан на обычный chat completions.
