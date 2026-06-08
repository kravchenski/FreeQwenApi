import express from 'express';
import bodyParser from 'body-parser';
import { extractConversationId, mergeModelLists, targetForModel } from './src/gateway/routing.ts';
import { bearerToken, isForwardableResponseHeader, tokenMatches } from './src/gateway/security.ts';
import {
    chatResponseToResponses,
    responsesToChatRequest,
    writeResponsesSse
} from './src/gateway/responses.ts';

const app = express();
const port = Number(process.env.GATEWAY_PORT || 3263);
const host = process.env.GATEWAY_HOST || process.env.HOST || '127.0.0.1';
const apiKey = process.env.GATEWAY_API_KEY;
const configuredUpstreamTimeout = Number(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS || 180_000);
const upstreamTimeout = Number.isFinite(configuredUpstreamTimeout) && configuredUpstreamTimeout > 0
    ? configuredUpstreamTimeout
    : 180_000;
const qwenUrl = process.env.QWEN_URL || 'http://qwen-proxy:3264/api';
const deepSeekUrl = process.env.DEEPSEEK_URL || 'http://deepseek-proxy:3265/api';
const kimiUrl = process.env.KIMI_URL || 'http://kimi-proxy:3266/api';
const providerUrls = [qwenUrl, deepSeekUrl, kimiUrl];

app.disable('x-powered-by');
app.use(bodyParser.raw({ type: '*/*', limit: process.env.REQUEST_BODY_LIMIT || '25mb' }));
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

app.get('/ready', async (_req, res) => {
    const providers = await Promise.allSettled(providerUrls.map(url =>
        fetch(`${url}/models`, { signal: AbortSignal.timeout(10_000) })
    ));
    const ready = providers.every(result => result.status === 'fulfilled' && result.value.ok);
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'degraded',
        providers: providers.map(result => result.status === 'fulfilled' && result.value.ok)
    });
});

app.use('/api', (req, res, next) => {
    if (tokenMatches(bearerToken(req.get('authorization')), apiKey)) return next();
    return res.status(401).json({ error: { message: 'Invalid gateway bearer token' } });
});

app.get(['/api/models', '/api/v1/models'], async (_req, res) => {
    try {
        const responses = await Promise.all(providerUrls.map(url =>
            fetch(`${url}/models`, { signal: AbortSignal.timeout(10_000) })
        ));
        const failed = responses.find(response => !response.ok);
        if (failed) throw new Error(`Provider model list failed with HTTP ${failed.status}`);
        const payloads = await Promise.all(responses.map(response => response.json()));
        const data = mergeModelLists(payloads);
        res.json({ object: 'list', data });
    } catch (error) {
        res.status(502).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
});

app.post('/api/v1/responses', async (req, res) => {
    try {
        const body = req.body?.length ? JSON.parse(Buffer.from(req.body).toString('utf8')) : {};
        const upstream = targetForModel(body.model, qwenUrl, deepSeekUrl, kimiUrl);
        const { request, routes } = responsesToChatRequest(body);
        const response = await fetch(`${upstream}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(upstreamTimeout)
        });
        const payload = await response.json();
        if (!response.ok) return res.status(response.status).json(payload);
        const converted = chatResponseToResponses(payload, routes);
        if (body.stream) return writeResponsesSse(res, converted);
        return res.json(converted);
    } catch (error) {
        const message = error instanceof SyntaxError
            ? 'Request body must be valid JSON'
            : error instanceof Error ? error.message : String(error);
        return res.status(error instanceof SyntaxError ? 400 : 502).json({ error: { message } });
    }
});

app.all('/api/*', async (req, res) => {
    try {
        const body = req.body?.length ? Buffer.from(req.body) : undefined;
        const parsed = body ? JSON.parse(body.toString('utf8')) : {};
        const upstream = targetForModel(parsed.model, qwenUrl, deepSeekUrl, kimiUrl);
        const path = req.originalUrl.replace(/^\/api/, '');
        const sessionId = extractConversationId(req.headers, parsed);
        const response = await fetch(`${upstream}${path}`, {
            method: req.method,
            headers: {
                'content-type': req.get('content-type') || 'application/json',
                accept: req.get('accept') || 'application/json',
                ...(sessionId ? { 'x-conversation-id': sessionId } : {})
            },
            body,
            signal: AbortSignal.timeout(upstreamTimeout)
        });
        res.status(response.status);
        response.headers.forEach((value, name) => {
            if (isForwardableResponseHeader(name)) res.setHeader(name, value);
        });
        if (!response.body) return res.end();
        for await (const chunk of response.body) res.write(chunk);
        res.end();
    } catch (error) {
        const message = error instanceof SyntaxError
            ? 'Request body must be valid JSON'
            : error instanceof Error ? error.message : String(error);
        res.status(error instanceof SyntaxError ? 400 : 502).json({ error: { message } });
    }
});

app.listen(port, host, () => {
    console.log(`Unified Qwen + DeepSeek + Kimi gateway listening on http://${host}:${port}/api`);
});
