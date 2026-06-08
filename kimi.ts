import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';

import {
    isEmptyToolCallResponse,
    kimiCompletion,
    parseKimiEvent,
    parseKimiFrames
} from './src/providers/kimi/client.ts';
import {
    conversationalShellText,
    parseToolCallJson,
    recoverBrokenBashToolCall,
    toolsToPrompt
} from './src/api/routes.ts';
import { hasValidKimiAccounts } from './src/providers/kimi/accounts.ts';
import { runKimiAccountMenu } from './src/providers/kimi/auth.ts';

const app = express();
const port = Number(process.env.KIMI_PORT || 3266);
const host = process.env.HOST || '0.0.0.0';
const models = ['kimi-k2.6', 'kimi-k2.6-thinking', 'kimi-k2.6-search', 'kimi-k2.6-thinking-search'];

app.use(bodyParser.json({ limit: process.env.REQUEST_BODY_LIMIT || '25mb' }));

app.get('/health', (_req, res) => {
    const ready = hasValidKimiAccounts() || Boolean(process.env.KIMI_TOKEN);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unauthenticated', service: 'kimi' });
});

function isCodebaseActionRequest(messages: Array<Record<string, any>>) {
    const lastUser = [...messages].reverse().find(message => message?.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content.toLowerCase() : '';
    return /рефактор|исправ|измени|добав|удал|проверь|тест|review|refactor|implement|fix|change|inspect|test/.test(text);
}

function fallbackInspectionToolCall(tools: Array<Record<string, any>> | null) {
    if (!Array.isArray(tools)) return null;
    const names = new Set(tools.map(tool => (tool?.function || tool)?.name));
    if (names.has('ls')) return { name: 'ls', arguments: { path: '.' } };
    if (names.has('bash')) return { name: 'bash', arguments: { command: 'ls -la' } };
    if (names.has('find')) return { name: 'find', arguments: { path: '.', pattern: '*' } };
    return null;
}

function appendBytes(left: Uint8Array, right: Uint8Array) {
    const combined = new Uint8Array(left.length + right.length);
    combined.set(left);
    combined.set(right, left.length);
    return combined;
}

async function collectResponse(
    response: Response,
    updateContext: (event: Record<string, any>) => void,
    onEvent?: (event: Record<string, any>) => void
) {
    const state = {};
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Kimi returned an empty response body');
    let pending = new Uint8Array();
    let content = '';
    let reasoning = '';

    while (true) {
        const { value, done } = await reader.read();
        if (value?.length) {
            const parsed = parseKimiFrames(appendBytes(pending, value));
            pending = parsed.rest;
            for (const raw of parsed.events) {
                updateContext(raw);
                const event = parseKimiEvent(raw, state);
                if (event?.content) content += event.content;
                if (event?.reasoning) reasoning += event.reasoning;
                if (event) onEvent?.(event);
            }
        }
        if (done) break;
    }
    return { content, reasoning };
}

function streamChunk(
    id: string,
    created: number,
    model: string,
    delta: Record<string, unknown>,
    finishReason: string | null = null
) {
    return `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`;
}

function finishStream(res: express.Response) {
    res.write('data: [DONE]\n\n');
    return res.end();
}

app.get(['/api/models', '/api/v1/models'], (_req, res) => {
    res.json({
        object: 'list',
        data: models.map(id => ({ id, object: 'model', created: 0, owned_by: 'kimi-web' }))
    });
});

app.post(['/api/chat/completions', '/api/v1/chat/completions'], async (req, res) => {
    try {
        const { messages, model = 'kimi-k2.6', stream = false, tools, functions } = req.body || {};
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: { message: 'messages must be a non-empty array' } });
        }
        const conversationId = req.body.conversation_id || req.body.chat_id || req.get('x-conversation-id') || undefined;
        const combinedTools = tools || (Array.isArray(functions)
            ? functions.map((fn: Record<string, unknown>) => ({ type: 'function', function: fn }))
            : null);
        const toolPrompt = toolsToPrompt(combinedTools);
        const upstreamMessages = toolPrompt
            ? [{ role: 'system', content: toolPrompt }, ...messages]
            : messages;
        const { response, getSessionId, updateContext } = await kimiCompletion({ messages: upstreamMessages, model, conversationId });
        const id = `chatcmpl-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
        const created = Math.floor(Date.now() / 1000);
        const captureToolCalls = Array.isArray(combinedTools) && combinedTools.length > 0;
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.write(streamChunk(id, created, model, { role: 'assistant' }));
        }

        let { content, reasoning } = await collectResponse(response, updateContext, event => {
            if (stream && !captureToolCalls && event.content) {
                res.write(streamChunk(id, created, model, { content: event.content }));
            }
            if (stream && !captureToolCalls && event.reasoning) {
                res.write(streamChunk(id, created, model, { reasoning_content: event.reasoning }));
            }
        });

        if (captureToolCalls && isEmptyToolCallResponse(content) && !isCodebaseActionRequest(messages)) {
            const retry = await kimiCompletion({ messages, model, conversationId });
            ({ content, reasoning } = await collectResponse(retry.response, retry.updateContext));
        }

        const recoveredShell = captureToolCalls ? recoverBrokenBashToolCall(content) : null;
        const conversationalText = recoveredShell
            ? conversationalShellText(recoveredShell.name, recoveredShell.arguments)
            : null;
        if (conversationalText) content = conversationalText;
        let toolCalls = captureToolCalls && !conversationalText ? parseToolCallJson(content, combinedTools) : null;
        if (!toolCalls?.length && captureToolCalls && isCodebaseActionRequest(messages)) {
            const fallback = fallbackInspectionToolCall(combinedTools);
            if (fallback) {
                toolCalls = [{
                    id: `call_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
                    type: 'function',
                    function: { name: fallback.name, arguments: JSON.stringify(fallback.arguments) },
                    index: 0
                }];
            }
        }
        if (stream && toolCalls?.length) {
            for (const call of toolCalls) {
                res.write(streamChunk(id, created, model, {
                    tool_calls: [{ index: call.index, id: call.id, type: call.type, function: call.function }]
                }));
            }
            res.write(streamChunk(id, created, model, {}, 'tool_calls'));
            return finishStream(res);
        }
        if (stream) {
            if (captureToolCalls && reasoning) {
                res.write(streamChunk(id, created, model, { reasoning_content: reasoning }));
            }
            if (captureToolCalls && content) {
                res.write(streamChunk(id, created, model, { content }));
            }
            res.write(streamChunk(id, created, model, {}, 'stop'));
            return finishStream(res);
        }
        return res.json({
            id,
            object: 'chat.completion',
            created,
            model,
            choices: [{
                index: 0,
                message: toolCalls?.length
                    ? { role: 'assistant', content: null, tool_calls: toolCalls.map(({ index: _index, ...call }) => call) }
                    : { role: 'assistant', content, reasoning_content: reasoning || undefined },
                finish_reason: toolCalls?.length ? 'tool_calls' : 'stop'
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            x_kimi_chat_id: getSessionId()
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) return res.status(502).json({ error: { message, type: 'upstream_error' } });
        res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`);
        finishStream(res);
    }
});

function enabled(value: string | undefined) {
    return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

async function start() {
    console.log(`
======================================================
   FREE KIMI WEB API
   Browser-backed proxy for https://www.kimi.com/
======================================================
`);
    const skipMenu = enabled(process.env.SKIP_ACCOUNT_MENU) || enabled(process.env.NON_INTERACTIVE);
    if (skipMenu) {
        if (!hasValidKimiAccounts() && !process.env.KIMI_TOKEN) {
            throw new Error('Нет активных аккаунтов Kimi. Запустите bun run auth:kimi -- --add');
        }
    } else {
        await runKimiAccountMenu();
    }

    app.listen(port, host, () => {
        console.log(`Kimi web proxy listening on http://${host}:${port}/api`);
        console.log(`Models: ${models.join(', ')}`);
    });
}

start().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
