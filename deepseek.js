import express from 'express';
import bodyParser from 'body-parser';
import { authDeepSeekInteractive, closeDeepSeekBrowser, deepSeekChatCompletion, deepSeekStatus } from './src/deepseek/officialWebClient.js';
import { logHttpRequest, logInfo, logError, logWarn } from './src/logger/index.js';

const app = express();
const port = Number.parseInt(process.env.DEEPSEEK_PORT || process.env.PORT || '3265', 10);
const host = process.env.HOST || '127.0.0.1';

app.use(logHttpRequest);
app.use(bodyParser.json({ limit: '25mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/api/health', async (req, res) => {
    const status = await deepSeekStatus();
    res.json({
        ok: status.ok,
        service: 'DeepSeek Official Web Chat Proxy',
        baseUrl: '/api',
        model: process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat',
        ...status
    });
});

app.get('/api/status', async (req, res) => {
    res.json(await deepSeekStatus());
});

app.get('/api/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek-web' },
            { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek-web' }
        ]
    });
});

app.post('/api/chat/completions', async (req, res, next) => {
    try {
        const result = await deepSeekChatCompletion({
            messages: req.body.messages,
            model: req.body.model,
            stream: Boolean(req.body.stream),
            chatId: req.body.chatId || req.body.chat_id,
            parentId: req.body.parentId || req.body.parent_message_id,
            thinking: req.body.thinking_enabled ?? req.body.thinking,
            search: req.body.search_enabled ?? req.body.search
        });

        if (req.body.stream) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            return res.send(result);
        }
        return res.json(result);
    } catch (error) {
        return next(error);
    }
});

app.post('/api/chat', async (req, res, next) => {
    try {
        const messages = req.body.messages || [{ role: 'user', content: req.body.message || req.body.prompt || '' }];
        const result = await deepSeekChatCompletion({
            messages,
            model: req.body.model,
            stream: false,
            chatId: req.body.chatId,
            parentId: req.body.parentId,
            thinking: req.body.thinking_enabled ?? req.body.thinking,
            search: req.body.search_enabled ?? req.body.search
        });
        res.json({
            message: result.choices[0].message.content,
            chatId: result.chatId,
            parentId: result.parentId,
            raw: result
        });
    } catch (error) {
        next(error);
    }
});

app.use((req, res) => {
    logWarn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: 'Эндпоинт не найден' });
});

app.use((err, req, res, next) => {
    logError('DeepSeek proxy error', err);
    const status = /401|403|unauthorized|forbidden/i.test(err.message) ? 401 : 500;
    res.status(status).json({
        error: 'DeepSeek web proxy error',
        message: err.message,
        hint: 'Если ошибка про x-ds-pow-response/cookie/token — запустите npm run deepseek:auth и отправьте один тестовый prompt в браузере DeepSeek.'
    });
});

async function shutdown() {
    logInfo('Завершение DeepSeek proxy...');
    await closeDeepSeekBrowser();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function start() {
    if (process.env.DEEPSEEK_AUTH_ON_START === 'true') {
        await authDeepSeekInteractive();
    }
    app.listen(port, host, () => {
        const displayHost = host === '0.0.0.0' ? 'localhost' : host;
        logInfo(`DeepSeek web proxy запущен: http://${displayHost}:${port}/api`);
        logInfo('Health: GET /api/health');
        logInfo('OpenAI-compatible: POST /api/chat/completions');
    });
}

start().catch(error => {
    logError('Не удалось запустить DeepSeek proxy', error);
    process.exit(1);
});
