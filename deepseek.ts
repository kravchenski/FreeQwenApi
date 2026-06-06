import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';

import { deepSeekCompletion, parseDeepSeekEvent } from './src/providers/deepseek/client.ts';
import { parseToolCallJson, toolsToPrompt } from './src/api/routes.ts';

const app = express();
const port = Number(process.env.DEEPSEEK_PORT || 3265);
const host = process.env.HOST || '0.0.0.0';
const models = ['deepseek-default', 'deepseek-reasoner', 'deepseek-expert', 'deepseek-search'];

app.use(bodyParser.json({ limit: process.env.REQUEST_BODY_LIMIT || '25mb' }));

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
        const state = { phase: 'content' as const, fragment: undefined as string | undefined };
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
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
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
                    if (stream && !captureToolCalls) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }] })}\n\n`);
                }
                if (event?.reasoning) {
                    reasoning += event.reasoning;
                    if (stream && !captureToolCalls) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { reasoning_content: event.reasoning }, finish_reason: null }] })}\n\n`);
                }
            }
            if (done) break;
        }

        const toolCalls = captureToolCalls ? parseToolCallJson(content) : null;
        if (stream && toolCalls?.length) {
            for (const call of toolCalls) {
                res.write(`data: ${JSON.stringify({
                    id,
                    object: 'chat.completion.chunk',
                    model,
                    choices: [{
                        index: 0,
                        delta: { tool_calls: [{ index: call.index, id: call.id, type: call.type, function: call.function }] },
                        finish_reason: null
                    }]
                })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
        }
        if (stream) {
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
        }
        return res.json({
            id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
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

app.listen(port, host, () => {
    console.log(`DeepSeek web proxy listening on http://${host}:${port}/api`);
});
