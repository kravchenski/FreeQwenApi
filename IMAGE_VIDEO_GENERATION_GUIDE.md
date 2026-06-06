# Руководство по генерации изображений и видео

## Обзор

Qwen API Proxy поддерживает три типа генерации контента через параметр `chatType`:

- **Текстовый чат (t2t)** — обычный диалоговый AI, потоковый ответ (по умолчанию)
- **Генерация изображений (t2i)** — text-to-image, потоковый ответ (~10–30 сек.)
- **Генерация видео (t2v)** — text-to-video, система задач с polling (~30–120 сек.)

## Ключевые отличия

| Функция | Текст (t2t) | Изображение (t2i) | Видео (t2v) |
| -------------------- | ------------------- | ---------------------------- | ------------------------------- |
| **Тип запроса** | `stream: true` | `stream: true` | `stream: false` |
| **Способ ответа** | Streaming SSE | Streaming SSE | Polling задачи |
| **Время выполнения** | ~2–5 сек. | ~10–30 сек. | ~30–120 сек. |
| **Где лежит URL** | N/A (текст) | `choices[0].message.content` | `video_url` / `content` |
| **Polling на сервере** | Нет | Нет | Да (автоматически) |
| **Task ID** | Нет | Нет | Да |

---

## Генерация изображений (t2i)

### Как это работает

1. Клиент отправляет POST-запрос с `chatType: "t2i"`
2. Сервер создаёт чат с `stream: true`
3. Сервер получает потоковый SSE-ответ с URL изображения
4. URL изображения приходит в поле `content` потоковых chunks
5. Сервер возвращает клиенту готовый URL

### Формат запроса

```
POST /api/chat
Content-Type: application/json

{
  "message": "Описание изображения, которое нужно сгенерировать",
  "model": "qwen3-vl-plus",
  "chatType": "t2i",
  "size": "16:9"
}
```

### Параметры

| Параметр | Обязательный | Описание | Примеры значений |
| ---------- | -------- | ---------------------------------------- | --------------------------------------------- |
| `message` | Да | Текстовое описание изображения | `"Закат над океаном с фиолетовыми облаками"` |
| `model` | Нет | Модель для генерации (по умолчанию qwen-max-latest) | `qwen-max-latest`, `qwen3-vl-plus` |
| `chatType` | Да | Должно быть `"t2i"` | `"t2i"` |
| `size` | Нет | Соотношение сторон | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"` |
| `chatId` | Нет | ID существующего чата для продолжения контекста | UUID из предыдущего ответа |
| `parentId` | Нет | ID родительского сообщения | UUID из предыдущего ответа |

### Ожидаемый ответ

```json
{
  "id": "response-uuid-here",
  "object": "chat.completion",
  "created": 1771318618,
  "model": "qwen3-vl-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "https://cdn.qwenlm.ai/output/.../t2i/.../image.png?key=***"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "characters": 0,
    "width": 2688,
    "image_count": 1,
    "height": 1536
  },
  "response_id": "response-uuid-here",
  "chatId": "chat-uuid-here",
  "parentId": "parent-uuid-here"
}
```

Поле `content` содержит прямой URL на сгенерированное изображение. Обычно такие URL размещаются на `cdn.qwenlm.ai`.

### Примеры

**JavaScript (fetch):**

```javascript
const response = await fetch("http://localhost:3264/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Красивый пейзаж: горы и озеро на рассвете",
    model: "qwen3-vl-plus",
    chatType: "t2i",
    size: "16:9"
  }),
});

const data = await response.json();
const imageUrl = data.choices[0].message.content;
console.log("Сгенерированное изображение:", imageUrl);
```

**cURL:**

```bash
curl -X POST http://localhost:3264/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Футуристический город ночью с неоновыми огнями",
    "model": "qwen3-vl-plus",
    "chatType": "t2i",
    "size": "16:9"
  }'
```

**PowerShell:**

```powershell
$body = @{
    message = "Милый кот сидит на книжной полке"
    model = "qwen3-vl-plus"
    chatType = "t2i"
    size = "1:1"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:3264/api/chat" `
    -Method Post -Body $body -ContentType "application/json"

$imageUrl = $response.choices[0].message.content
Write-Host "URL изображения: $imageUrl"
```

---

## Генерация видео (t2v)

### Как это работает

Генерация видео поддерживает два режима polling:

#### Режим 1: polling на стороне сервера (по умолчанию)

Лучше для простых интеграций и коротких видео (<2 мин.).

1. Клиент отправляет запрос с `chatType: "t2v"` и `waitForCompletion: true` (по умолчанию)
2. Сервер создаёт задачу — Qwen API возвращает `task_id`
3. Сервер автоматически проверяет статус каждые 2 секунды (до 90 попыток = 3 мин.)
4. Когда задача завершена, сервер возвращает клиенту URL видео

**Плюсы:** просто, один запрос, логика polling на клиенте не нужна.  
**Минусы:** длинное HTTP-соединение, фиксированный таймаут 3 минуты.

#### Режим 2: polling на стороне клиента (ручной)

Лучше для длинных видео (>2 мин.), кастомных таймаутов и отображения прогресса в UI.

1. Клиент отправляет запрос с `chatType: "t2v"` и `waitForCompletion: false`
2. Сервер сразу возвращает `task_id` (~1–2 сек.)
3. Клиент проверяет `GET /api/tasks/status/:taskId` каждые 2–5 секунд
4. Когда задача завершена, клиент получает URL видео

**Плюсы:** гибкий таймаут, отслеживание прогресса, лучше для долгих операций.  
**Минусы:** нужна логика polling на клиенте.

### Формат запроса

```
POST /api/chat
Content-Type: application/json

{
  "message": "Описание видео, которое нужно сгенерировать",
  "model": "qwen3-vl-plus",
  "chatType": "t2v",
  "size": "16:9"
}
```

### Параметры

| Параметр | Обязательный | Описание | Примеры значений |
| ------------------- | -------- | ----------------------------------------------------- | --------------------------------------------- |
| `message` | Да | Текстовое описание видео | `"Волны океана на песчаном пляже на закате"` |
| `model` | Да | Модель для генерации | `qwen3-vl-plus`, `qwen-max-latest` |
| `chatType` | Да | Должно быть `"t2v"` | `"t2v"` |
| `size` | Нет | Соотношение сторон (по умолчанию `"16:9"`) | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"` |
| `waitForCompletion` | Нет | Сервер ждёт завершения задачи (по умолчанию `true`) | `true` / `false` |
| `chatId` | Нет | ID существующего чата | UUID из предыдущего ответа |
| `parentId` | Нет | ID родительского сообщения | UUID из предыдущего ответа |

**Важно:** размер видео указывается как соотношение сторон (например, `"16:9"`), а не как разрешение в пикселях.

### Ожидаемый ответ

```json
{
  "id": "task-uuid-here",
  "object": "chat.completion",
  "created": 1771318618,
  "model": "qwen3-vl-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "https://cdn.qwenlm.ai/output/.../t2v/.../video.mp4?key=***"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  },
  "task_id": "task-uuid-here",
  "video_url": "https://cdn.qwenlm.ai/output/.../t2v/.../video.mp4?key=***",
  "chatId": "chat-uuid-here",
  "parentId": "task-uuid-here"
}
```

### Примеры

**Polling на стороне сервера (по умолчанию):**

```javascript
const response = await fetch("http://localhost:3264/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Спокойный океан с мягкими волнами на закате",
    model: "qwen3-vl-plus",
    chatType: "t2v",
    size: "16:9"
  }),
});

const data = await response.json();
if (data.error) {
  console.error("Не удалось сгенерировать видео:", data.error);
} else {
  const videoUrl = data.video_url || data.choices[0].message.content;
  console.log("Сгенерированное видео:", videoUrl);
}
```

**Polling на стороне клиента:**

```javascript
// Шаг 1: создаём задачу (ответ приходит сразу)
const taskResponse = await fetch("http://localhost:3264/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Тихий лес, солнечные лучи проходят сквозь деревья",
    model: "qwen3-vl-plus",
    chatType: "t2v",
    size: "16:9",
    waitForCompletion: false
  }),
});

const taskData = await taskResponse.json();
console.log("Задача создана:", taskData.task_id);

// Шаг 2: проверяем статус до завершения
const taskId = taskData.task_id;
let videoUrl = null;
let attempts = 0;
const maxAttempts = 90; // максимум 3 минуты

while (attempts < maxAttempts && !videoUrl) {
  attempts++;
  await new Promise(resolve => setTimeout(resolve, 2000));

  const statusResponse = await fetch(`http://localhost:3264/api/tasks/status/${taskId}`);
  const statusData = await statusResponse.json();
  const status = statusData.task_status || statusData.status;

  console.log(`Попытка ${attempts}: ${status}`);

  if (status === 'completed' || status === 'succeeded') {
    videoUrl = statusData.content || statusData.data?.content;
    console.log("Видео готово:", videoUrl);
  } else if (status === 'failed' || status === 'error') {
    console.error("Задача завершилась ошибкой");
    break;
  }
}
```

**cURL (polling на стороне сервера):**

```bash
curl -X POST http://localhost:3264/api/chat \
  --max-time 200 \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Птица летит над лесом",
    "model": "qwen3-vl-plus",
    "chatType": "t2v",
    "size": "16:9"
  }'
```

**cURL (polling на стороне клиента):**

```bash
# Шаг 1: создаём задачу
TASK_ID=$(curl -s -X POST http://localhost:3264/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Волны океана на закате",
    "model": "qwen3-vl-plus",
    "chatType": "t2v",
    "size": "16:9",
    "waitForCompletion": false
  }' | jq -r '.task_id')

echo "Task ID: $TASK_ID"

# Шаг 2: проверяем статус
while true; do
  STATUS=$(curl -s "http://localhost:3264/api/tasks/status/$TASK_ID" | jq -r '.task_status')
  echo "Статус: $STATUS"
  [ "$STATUS" = "completed" ] && break
  sleep 2
done
```

---

## Сравнение: изображения и видео

| Функция | Изображение (t2i) | Видео (t2v) |
| ------------------- | ---------------------------- | ----------------------------------- |
| **Тип чата** | `"t2i"` | `"t2v"` |
| **Способ ответа** | Streaming | Polling задачи |
| **Обычная длительность** | 10–30 секунд | 30–120 секунд |
| **Поле ответа** | `choices[0].message.content` | `video_url` или `content` |
| **Формат файла** | `.jpg` / `.png` | `.mp4` |
| **Stream** | `true` (автоматически) | `false` (автоматически) |
| **Polling** | N/A | 90 попыток × 2 сек. = максимум 3 мин. |
| **Таймаут клиента** | 30–60 секунд | 120–200 секунд |

---

## Рекомендации

### Генерация изображений

1. **Подробные prompts** — указывайте стиль, цвета, настроение и композицию
2. **Рекомендованные модели** — `qwen3-vl-plus` (быстро, хорошее качество), `qwen-max-latest`
3. **Соотношения сторон** — `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:4"`
4. **Таймаут клиента** — минимум 60 секунд

### Генерация видео

1. **Описывайте движение** — пишите про движение и изменения, а не только статичную сцену
2. **Не усложняйте** — фокусируйтесь на одном главном действии/движении
3. **Соотношения сторон** — `"16:9"` (по умолчанию), `"9:16"`, `"1:1"`, `"4:3"`
4. **Таймаут клиента** — минимум 200 секунд
5. **Терпение** — обычно генерация занимает 1–2 минуты

---

## Обработка ошибок

### Таймаут

```json
{ "error": "Task polling timeout exceeded", "status": "timeout", "task_id": "..." }
```

Повторите запрос или переключитесь на polling на стороне клиента с большим числом попыток.

### Task ID не найден

```json
{ "error": "Task ID not found in response" }
```

Проверьте статус Qwen API — это может быть временная проблема.

### Rate limit

```json
{ "error": "RateLimited", "detail": "You've reached the upper limit for today's usage." }
```

Дождитесь сброса дневного лимита или добавьте больше аккаунтов.

---

## Тестирование

Запустите встроенные тестовые скрипты:

```bash
# Проверить все три типа генерации (чат, изображение, видео)
bun run test:features

# Сравнить server-side и client-side polling для видео
bun run test:video-polling
```

---

## Примечания

1. Сгенерированные URL временные — скачивайте файлы, если они нужны надолго
2. Более высокие разрешения генерируются дольше
3. Несколько параллельных запросов работают через систему нескольких аккаунтов
4. Используйте `chatId` и `parentId`, чтобы генерировать связанные изображения/видео в контексте

## Связанные эндпоинты

- `POST /api/chat` — текстовый чат (`chatType: "t2t"`, по умолчанию), изображение (`"t2i"`), видео (`"t2v"`)
- `GET /api/tasks/status/:taskId` — проверить статус задачи генерации видео
- `GET /api/models` — получить список доступных моделей
- `POST /api/files/upload` — загрузить файлы для анализа
