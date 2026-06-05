import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logWarn, logError } from '../logger/index.js';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSION_DIR = path.resolve(ROOT_DIR, process.env.DEEPSEEK_SESSION_DIR || 'session/deepseek');
const PROFILE_DIR = path.join(SESSION_DIR, 'profile');
const STATE_FILE = path.join(SESSION_DIR, 'state.json');

const BASE_URL = 'https://chat.deepseek.com';
const API_BASE = `${BASE_URL}/api/v0`;
const DEFAULT_MODEL = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat';
const USER_AGENT = process.env.DEEPSEEK_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

let browser = null;
let page = null;
let lastCapturedHeaders = {};
let lastChatSessionId = null;
let lastParentMessageId = null;

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (_) {
        return {};
    }
}

function writeState(patch) {
    ensureDir(SESSION_DIR);
    const state = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return state;
}

function extractBearerFromStorage(storageDump) {
    for (const store of Object.values(storageDump || {})) {
        for (const [key, value] of Object.entries(store || {})) {
            if (typeof value !== 'string') continue;
            if (/eyJ[a-zA-Z0-9_-]+\./.test(value) && /token|auth|user/i.test(key)) return value;
            try {
                const parsed = JSON.parse(value);
                const found = findJwt(parsed);
                if (found) return found;
            } catch (_) {}
        }
    }
    return null;
}

function findJwt(value) {
    if (!value || typeof value !== 'object') return null;
    for (const [key, val] of Object.entries(value)) {
        if (typeof val === 'string' && /^eyJ[a-zA-Z0-9_-]+\./.test(val) && /token|auth/i.test(key)) return val;
        if (val && typeof val === 'object') {
            const nested = findJwt(val);
            if (nested) return nested;
        }
    }
    return null;
}

async function captureStateFromPage() {
    if (!page) return readState();
    const cookies = await page.cookies(BASE_URL);
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const storageDump = await page.evaluate(() => {
        const dump = { localStorage: {}, sessionStorage: {} };
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            dump.localStorage[key] = localStorage.getItem(key);
        }
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            dump.sessionStorage[key] = sessionStorage.getItem(key);
        }
        return dump;
    }).catch(() => ({}));

    const bearerToken = extractBearerFromStorage(storageDump) || lastCapturedHeaders.authorization?.replace(/^Bearer\s+/i, '') || readState().bearerToken;
    const powResponse = lastCapturedHeaders['x-ds-pow-response'] || readState().powResponse || process.env.DEEPSEEK_POW_RESPONSE || '';
    return writeState({ cookieHeader, bearerToken, powResponse });
}

async function initBrowser({ visible = false } = {}) {
    if (browser && page) return page;
    ensureDir(SESSION_DIR);
    ensureDir(PROFILE_DIR);

    logInfo(`Инициализация DeepSeek browser (${visible ? 'visible' : 'headless'})...`);
    browser = await puppeteer.launch({
        headless: !visible,
        executablePath: process.env.CHROME_PATH || undefined,
        userDataDir: PROFILE_DIR,
        defaultViewport: { width: 1440, height: 1000 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1440,1000'
        ]
    });

    page = (await browser.pages())[0] || await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    page.on('request', req => {
        const url = req.url();
        if (!url.includes('chat.deepseek.com/api/')) return;
        const headers = req.headers();
        const captured = {};
        for (const key of ['authorization', 'x-ds-pow-response', 'x-app-version', 'x-client-version', 'x-client-platform', 'x-client-locale', 'cookie']) {
            if (headers[key]) captured[key] = headers[key];
        }
        if (Object.keys(captured).length) {
            lastCapturedHeaders = { ...lastCapturedHeaders, ...captured };
            writeState({
                bearerToken: captured.authorization?.replace(/^Bearer\s+/i, '') || readState().bearerToken,
                powResponse: captured['x-ds-pow-response'] || readState().powResponse,
                appVersion: captured['x-app-version'] || readState().appVersion,
                clientVersion: captured['x-client-version'] || readState().clientVersion
            });
        }
    });
    page.on('console', msg => logInfo(`[deepseek page] ${msg.text()}`));
    return page;
}

export async function closeDeepSeekBrowser() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
}

export async function authDeepSeekInteractive() {
    await initBrowser({ visible: true });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    console.log('\n=== DeepSeek авторизация ===');
    console.log('1. Войдите в официальный DeepSeek Chat в открытом браузере.');
    console.log('2. Отправьте один короткий тестовый prompt в веб-чате — это помогает поймать нужные web headers.');
    console.log('3. Вернитесь в терминал и нажмите ENTER.\n');
    await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
    });
    const state = await captureStateFromPage();
    logInfo(`DeepSeek session сохранена: ${STATE_FILE}`);
    logInfo(`Cookie: ${state.cookieHeader ? 'OK' : 'не найдено'}, token: ${state.bearerToken ? 'OK' : 'не найдено'}, pow: ${state.powResponse ? 'OK' : 'не найдено'}`);
    return state;
}

async function ensureRuntimePage() {
    await initBrowser({ visible: process.env.DEEPSEEK_VISIBLE === 'true' });
    if (!page.url().startsWith(BASE_URL)) {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    }
    return captureStateFromPage();
}

function requestHeaders(state = readState()) {
    const headers = {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9,ru;q=0.8',
        'content-type': 'application/json',
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
        'user-agent': USER_AGENT,
        'x-client-locale': 'en_US',
        'x-client-platform': 'web',
        'x-client-version': state.clientVersion || '1.0.0-always'
    };
    if (state.appVersion) headers['x-app-version'] = state.appVersion;
    if (state.bearerToken) headers.authorization = `Bearer ${state.bearerToken}`;
    if (state.powResponse) headers['x-ds-pow-response'] = state.powResponse;
    if (state.cookieHeader) headers.cookie = state.cookieHeader;
    return headers;
}

function browserSafeHeaders(headers) {
    // Browser fetch refuses/ignores forbidden headers such as cookie, origin,
    // referer and user-agent. Cookies are sent via credentials: 'include'.
    const forbidden = new Set(['cookie', 'origin', 'referer', 'user-agent', 'host', 'content-length']);
    return Object.fromEntries(Object.entries(headers).filter(([key, value]) => value && !forbidden.has(key.toLowerCase())));
}

async function browserFetch(pathname, { method = 'GET', body = null, headers = {} } = {}) {
    const state = await ensureRuntimePage();
    const mergedHeaders = browserSafeHeaders({ ...requestHeaders(state), ...headers });
    const response = await page.evaluate(async ({ url, method, body, headers }) => {
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'include'
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, text, headers: Object.fromEntries(res.headers.entries()) };
    }, { url: `${API_BASE}${pathname}`, method, body, headers: mergedHeaders });
    if (!response.ok) {
        throw new Error(`DeepSeek web API ${method} ${pathname} failed: HTTP ${response.status} ${response.text}`);
    }
    return response;
}

async function createChatSession() {
    const response = await browserFetch('/chat_session/create', {
        method: 'POST',
        body: { character_id: null }
    });
    const json = JSON.parse(response.text);
    const id = json?.data?.biz_data?.id || json?.data?.id || json?.id;
    if (!id) throw new Error(`DeepSeek chat_session/create returned no id: ${response.text}`);
    lastChatSessionId = id;
    lastParentMessageId = null;
    return id;
}

function messagesToPrompt(messages = []) {
    const parts = [];
    for (const msg of messages) {
        if (!msg || msg.role === 'assistant') continue;
        const content = Array.isArray(msg.content)
            ? msg.content.map(part => part.text || part.content || '').filter(Boolean).join('\n')
            : String(msg.content || '');
        if (!content.trim()) continue;
        if (msg.role === 'system') parts.push(`System instruction:\n${content}`);
        else parts.push(content);
    }
    return parts.join('\n\n').trim();
}

function parseDeepSeekSse(text) {
    const chunks = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { chunks.push(JSON.parse(payload)); } catch (_) {}
    }
    return chunks;
}

function extractContentAndParent(chunks) {
    let content = '';
    let reasoning = '';
    let parentId = null;
    for (const chunk of chunks) {
        const data = chunk?.data || chunk;
        const biz = data?.biz_data || data;
        const choices = chunk?.choices || data?.choices || biz?.choices;
        const deltaContent = choices?.[0]?.delta?.content || choices?.[0]?.message?.content;
        if (deltaContent) content += deltaContent;
        const dsContent = biz?.message || biz?.content || biz?.answer || biz?.text || data?.content;
        if (typeof dsContent === 'string') content += dsContent;
        const thinking = biz?.thinking_content || biz?.reasoning_content || data?.reasoning_content;
        if (typeof thinking === 'string') reasoning += thinking;
        parentId = biz?.message_id || biz?.id || data?.message_id || parentId;
    }
    return { content: content || reasoning, reasoning, parentId };
}

export async function deepSeekChatCompletion({ messages, model = DEFAULT_MODEL, stream = false, chatId = null, parentId = null, thinking = false, search = false }) {
    const prompt = messagesToPrompt(messages);
    if (!prompt) throw new Error('messages[] не содержит пользовательского текста');
    const sessionId = chatId || lastChatSessionId || await createChatSession();
    const response = await browserFetch('/chat/completion', {
        method: 'POST',
        body: {
            chat_session_id: sessionId,
            parent_message_id: parentId || lastParentMessageId || null,
            prompt,
            ref_file_ids: [],
            thinking_enabled: Boolean(thinking || model.includes('reasoner') || model.includes('r1')),
            search_enabled: Boolean(search),
            client_stream_id: `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
        }
    });
    const chunks = parseDeepSeekSse(response.text);
    const { content, reasoning, parentId: newParentId } = extractContentAndParent(chunks);
    if (newParentId) lastParentMessageId = newParentId;

    const id = `chatcmpl-deepseek-${Date.now()}`;
    const result = {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message: { role: 'assistant', content: content || '' },
            finish_reason: 'stop'
        }],
        chatId: sessionId,
        parentId: newParentId || lastParentMessageId || null,
        deepseek: { reasoning_content: reasoning || undefined }
    };

    if (!stream) return result;
    return toOpenAiSse(result);
}

function toOpenAiSse(result) {
    const content = result.choices[0].message.content || '';
    const id = result.id;
    const created = result.created;
    const model = result.model;
    const lines = [];
    lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}`);
    if (content) lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`);
    lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`);
    lines.push('data: [DONE]');
    return lines.join('\n\n') + '\n\n';
}

export async function deepSeekStatus() {
    const state = readState();
    return {
        ok: Boolean(state.cookieHeader || state.bearerToken),
        browser: Boolean(browser),
        sessionFile: STATE_FILE,
        hasCookie: Boolean(state.cookieHeader),
        hasBearerToken: Boolean(state.bearerToken),
        hasPowResponse: Boolean(state.powResponse),
        lastChatSessionId
    };
}
