import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const path = join(homedir(), '.pi', 'agent', 'models.json');
const baseUrl = process.env.FREEAI_URL || 'http://127.0.0.1:3263/api';
const freeModel = (id: string, name: string, reasoning = false) => ({
    id,
    name,
    reasoning,
    input: ['text'],
    contextWindow: 131072,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
});

async function loadModelIds() {
    try {
        const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const ids = payload?.data?.map((model: Record<string, unknown>) => model.id).filter(Boolean);
        if (ids?.length) return [...new Set<string>(ids)];
    } catch {
    }

    const qwen = (await readFile(new URL('../src/AvailableModels.txt', import.meta.url), 'utf8'))
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    return [...qwen, 'deepseek-default', 'deepseek-reasoner', 'deepseek-expert', 'deepseek-search'];
}

function displayName(id: string) {
    const label = id.split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(' ');
    return `Free ${label}`;
}

let config: Record<string, any> = { providers: {} };
try {
    config = JSON.parse(await readFile(path, 'utf8'));
} catch {
}

config.providers ||= {};
config.providers.freeai = {
    baseUrl,
    apiKey: 'dummy-key',
    authHeader: true,
    api: 'openai-completions',
    compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStore: false,
        supportsStrictMode: false,
        maxTokensField: 'max_tokens',
        requiresToolResultName: true
    },
    models: (await loadModelIds()).map(id => freeModel(id, displayName(id), id === 'deepseek-reasoner'))
};
delete config.providers.freedeepseek;

await mkdir(join(homedir(), '.pi', 'agent'), { recursive: true });
await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Pi provider "freeai" with ${config.providers.freeai.models.length} models written to ${path}`);
