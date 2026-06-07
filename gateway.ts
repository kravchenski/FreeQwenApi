import express from 'express';
import bodyParser from 'body-parser';
import { extractConversationId, mergeModelLists, targetForModel } from './src/gateway/routing.ts';

const app = express();
const port = Number(process.env.GATEWAY_PORT || 3263);
const host = process.env.HOST || '0.0.0.0';
const qwenUrl = process.env.QWEN_URL || 'http://qwen-proxy:3264/api';
const deepSeekUrl = process.env.DEEPSEEK_URL || 'http://deepseek-proxy:3265/api';

app.use(bodyParser.raw({ type: '*/*', limit: process.env.REQUEST_BODY_LIMIT || '25mb' }));

app.get(['/api/models', '/api/v1/models'], async (_req, res) => {
    try {
        const responses = await Promise.all([qwenUrl, deepSeekUrl].map(url => fetch(`${url}/models`)));
        const payloads = await Promise.all(responses.map(response => response.json()));
        const data = mergeModelLists(payloads);
        res.json({ object: 'list', data });
    } catch (error) {
        res.status(502).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
});

app.all('/api/*', async (req, res) => {
    try {
        const body = req.body?.length ? Buffer.from(req.body) : undefined;
        const parsed = body ? JSON.parse(body.toString()) : {};
        const upstream = targetForModel(parsed.model, qwenUrl, deepSeekUrl);
        const path = req.originalUrl.replace(/^\/api/, '');
        const sessionId = extractConversationId(req.headers, parsed);
        const response = await fetch(`${upstream}${path}`, {
            method: req.method,
            headers: {
                'content-type': req.get('content-type') || 'application/json',
                accept: req.get('accept') || 'application/json',
                ...(sessionId ? { 'x-conversation-id': sessionId } : {})
            },
            body
        });
        res.status(response.status);
        response.headers.forEach((value, name) => res.setHeader(name, value));
        if (!response.body) return res.end();
        for await (const chunk of response.body) res.write(chunk);
        res.end();
    } catch (error) {
        res.status(502).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
});

app.listen(port, host, () => {
    console.log(`Unified Qwen + DeepSeek gateway listening on http://${host}:${port}/api`);
});
