import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';

import { deepSeekCompletion, parseDeepSeekEvent } from './src/providers/deepseek/client.ts';
import { conversationalShellText, parseToolCallJson, recoverBrokenBashToolCall, toolsToPrompt } from './src/api/routes.ts';
import { hasValidDeepSeekAccounts } from './src/providers/deepseek/accounts.ts';
import { runDeepSeekAccountMenu } from './src/providers/deepseek/auth.ts';

const app = express();
const port = Number(process.env.DEEPSEEK_PORT || 3265);
const host = process.env.HOST || '0.0.0.0';
const models = ['deepseek-default', 'deepseek-reasoner', 'deepseek-expert', 'deepseek-search'];

app.use(bodyParser.json({ limit: process.env.REQUEST_BODY_LIMIT || '25mb' }));

app.get('/health', (_req, res) => {
    const ready = hasValidDeepSeekAccounts() || Boolean(process.env.DEEPSEEK_TOKEN);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unauthenticated', service: 'deepseek' });
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

app.get(['/api/models', '/api/v1/models'], (_req, res) => {
    res.json({
        object: 'list',
        data: models.map(id => ({ id, object: 'model', created: 0, owned_by: 'deepseek-web' }))
    });
});

app.post(['/api/chat/completions', '/api/v1/chat/completions'], async (req, res) => {
    try {
        const { messages, model = 'deepseek-default', stream = false, tools, functions } = req.body || {};
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
        const { response, sessionId } = await deepSeekCompletion({ messages: upstreamMessages, model, conversationId });
        const id = `chatcmpl-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
        const created = Math.floor(Date.now() / 1000);
        const state = {
            phase: 'content' as const,
            fragment: undefined as string | undefined,
            contentSnapshot: '',
            thinkingSnapshot: ''
        };
        const reader = response.body?.getReader();
        if (!reader) throw new Error('DeepSeek returned an empty response body');
        const decoder = new TextDecoder();
        let pending = '';
        let content = '';
        let reasoning = '';

        const captureToolCalls = Array.isArray(combinedTools) && combinedTools.length > 0;
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
        }

        while (true) {
            const { value, done } = await reader.read();
            pending += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = pending.split('\n');
            pending = lines.pop() || '';
            for (const line of lines) {
                const event = parseDeepSeekEvent(line.trim(), state);
                if (event?.content) {
                    content += event.content;
                    if (stream && !captureToolCalls) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }] })}\n\n`);
                }
                if (event?.reasoning) {
                    reasoning += event.reasoning;
                    if (stream && !captureToolCalls) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: event.reasoning }, finish_reason: null }] })}\n\n`);
                }
            }
            if (done) break;
        }

        const recoveredShell = captureToolCalls ? recoverBrokenBashToolCall(content) : null;
        const conversationalText = recoveredShell
            ? conversationalShellText(recoveredShell.name, recoveredShell.arguments)
            : null;
        if (conversationalText) content = conversationalText;
        let toolCalls = captureToolCalls && !conversationalText ? parseToolCallJson(content) : null;
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
                res.write(`data: ${JSON.stringify({
                    id,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [{
                        index: 0,
                        delta: { tool_calls: [{ index: call.index, id: call.id, type: call.type, function: call.function }] },
                        finish_reason: null
                    }]
                })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
        }
        if (stream) {
            if (captureToolCalls && reasoning) {
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }] })}\n\n`);
            }
            if (captureToolCalls && content) {
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
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
            x_deepseek_chat_id: sessionId
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) return res.status(502).json({ error: { message, type: 'upstream_error' } });
        res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

function enabled(value: string | undefined) {
    return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

async function start() {
    console.log(`
======================================================
   FREE DEEPSEEK WEB API
   Browser-backed proxy for https://chat.deepseek.com/
======================================================
`);
    const skipMenu = enabled(process.env.SKIP_ACCOUNT_MENU) || enabled(process.env.NON_INTERACTIVE);
    if (skipMenu) {
        if (!hasValidDeepSeekAccounts() && !process.env.DEEPSEEK_TOKEN) {
            throw new Error('Нет активных аккаунтов DeepSeek. Запустите bun run auth:deepseek -- --add');
        }
    } else {
        await runDeepSeekAccountMenu();
    }

    app.listen(port, host, () => {
        console.log(`DeepSeek web proxy listening on http://${host}:${port}/api`);
        console.log('Models: deepseek-default, deepseek-reasoner, deepseek-expert, deepseek-search');
    });
}

start().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
