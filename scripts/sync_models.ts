import fs from 'fs';
import path from 'path';

const QWEN_CHAT_URL = process.env.QWEN_CHAT_URL || 'https://chat.qwen.ai/';
const OUTPUT_FILE = process.env.QWEN_MODELS_FILE || path.join(process.cwd(), 'src', 'AvailableModels.txt');
const DOC_FILE = process.env.QWEN_MODELS_DOC || path.join(process.cwd(), 'docs', 'QWEN_CHAT_MODELS.md');

function uniq(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readExistingModels(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function extractPrerenderedJson(html) {
  const match = html.match(/window\.__prerendered_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!match) {
    throw new Error('Не удалось найти window.__prerendered_data в HTML Qwen Chat');
  }
  return JSON.parse(match[1]);
}

function capabilitiesOf(model) {
  const caps = model?.info?.meta?.capabilities || {};
  const labels = {
    audio: 'аудио',
    document: 'документы',
    search: 'поиск',
    thinking: 'thinking-режим',
    video: 'видео',
    vision: 'зрение'
  };
  return Object.entries(caps)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => labels[name] || name)
    .sort();
}

async function fetchQwenChatModels() {
  const response = await fetch(QWEN_CHAT_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Запрос к Qwen Chat не удался: HTTP ${response.status}`);
  }

  const html = await response.text();
  const data = extractPrerenderedJson(html);
  const models = Array.isArray(data.models) ? data.models : [];
  return models
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      capabilities: capabilitiesOf(model),
      description: model?.info?.meta?.short_description || model?.info?.meta?.description || ''
    }))
    .filter(model => model.id);
}

function writeModelsFile(file, models) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${models.join('\n')}\n`, 'utf8');
}

function writeDocFile(file, discoveredModels, mergedIds, previousIds) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = new Date().toISOString();
  const discoveredIds = discoveredModels.map(model => model.id);
  const added = discoveredIds.filter(id => !previousIds.includes(id));
  const missingFromChat = previousIds.filter(id => !discoveredIds.includes(id));

  const lines = [];
  lines.push('# Синхронизация моделей Qwen Chat');
  lines.push('');
  lines.push(`Сгенерировано: ${now}`);
  lines.push('');
  lines.push('Источник: prerendered-метаданные моделей с https://chat.qwen.ai/.');
  lines.push('');
  lines.push('## Модели, которые сейчас видны в Qwen Chat');
  lines.push('');
  for (const model of discoveredModels) {
    const caps = model.capabilities.length ? ` — ${model.capabilities.join(', ')}` : '';
    lines.push(`- \`${model.id}\`${caps}`);
  }
  lines.push('');
  lines.push('## Добавлено последней синхронизацией');
  lines.push('');
  if (added.length) {
    for (const id of added) lines.push(`- \`${id}\``);
  } else {
    lines.push('- Новых моделей нет.');
  }
  lines.push('');
  lines.push('## Модели эндпоинта, которых нет в текущих landing-метаданных Qwen Chat');
  lines.push('');
  if (missingFromChat.length) {
    for (const id of missingFromChat) lines.push(`- \`${id}\``);
  } else {
    lines.push('- Таких моделей нет.');
  }
  lines.push('');
  lines.push('## Итоговый объединённый список моделей эндпоинта');
  lines.push('');
  for (const id of mergedIds) lines.push(`- \`${id}\``);
  lines.push('');

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

async function main() {
  const existing = uniq(readExistingModels(OUTPUT_FILE));
  const discovered = await fetchQwenChatModels();
  const discoveredIds = uniq(discovered.map(model => model.id));
  const merged = uniq([...discoveredIds, ...existing]);

  writeModelsFile(OUTPUT_FILE, merged);
  writeDocFile(DOC_FILE, discovered, merged, existing);

  console.log(`Найдено моделей Qwen Chat: ${discoveredIds.length}`);
  console.log(`Список моделей эндпоинта записан: ${merged.length} моделей -> ${OUTPUT_FILE}`);
  console.log(`Отчёт синхронизации записан: ${DOC_FILE}`);
  const added = discoveredIds.filter(id => !existing.includes(id));
  if (added.length) console.log(`Новые модели: ${added.join(', ')}`);
}

main().catch(error => {
  console.error(`Синхронизация моделей не удалась: ${error.message}`);
  process.exit(1);
});
