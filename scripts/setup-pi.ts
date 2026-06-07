import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const path = join(homedir(), '.pi', 'agent', 'models.json');
const freeModel = (id: string, name: string, reasoning = false) => ({
    id,
    name,
    reasoning,
    input: ['text'],
    contextWindow: 131072,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
});

let config: Record<string, any> = { providers: {} };
try {
    config = JSON.parse(await readFile(path, 'utf8'));
} catch {
}

config.providers ||= {};
config.providers.freeai = {
    baseUrl: process.env.FREEAI_URL || 'http://127.0.0.1:3263/api',
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
    models: [
        freeModel('qwen3.5-plus', 'Free Qwen 3.5 Plus'),
        freeModel('qwen3-coder-plus', 'Free Qwen Coder Plus'),
        freeModel('qwen-max', 'Free Qwen Max'),
        freeModel('deepseek-default', 'Free DeepSeek Web'),
        freeModel('deepseek-reasoner', 'Free DeepSeek Reasoner', true)
    ]
};
delete config.providers.freedeepseek;

await mkdir(join(homedir(), '.pi', 'agent'), { recursive: true });
await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Pi provider "freeai" written to ${path}`);
