import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getAvailableKimiAccount, markKimiAccountInvalid, type KimiAccount } from './accounts.ts';
import {
    encodeKimiRequest,
    isEmptyToolCallResponse,
    KIMI_CHAT_PATH,
    KIMI_SCENARIO,
    messagesToPrompt,
    parseKimiEvent,
    parseKimiFrames
} from './protocol.ts';

const BASE_URL = process.env.KIMI_BASE_URL || 'https://www.kimi.com';
const SESSION_FILE = process.env.KIMI_SESSION_MAP_FILE ||
    path.join(process.cwd(), 'session', 'kimi', 'chat-sessions.json');
const DEVICE_FILE = process.env.KIMI_DEVICE_FILE ||
    path.join(process.cwd(), 'session', 'kimi', 'device-id.txt');

type KimiContext = { chatId?: string; parentId?: string };
function envAccount(): KimiAccount | null {
    const token = process.env.KIMI_TOKEN;
    return token ? { id: 'env', token } : null;
}

function getAccount() {
    const account = getAvailableKimiAccount() || envAccount();
    if (!account) throw new Error('Нет активных аккаунтов Kimi. Добавьте аккаунт через меню.');
    return account;
}

function randomNumericId(prefix: string) {
    const hash = crypto.createHash('sha256').update(`${prefix}:${crypto.randomUUID()}`).digest('hex');
    return `${7 + (parseInt(hash.slice(0, 2), 16) % 2)}${BigInt(`0x${hash.slice(2, 17)}`).toString().padStart(18, '0').slice(0, 18)}`;
}

function deviceId() {
    try {
        const saved = fs.readFileSync(DEVICE_FILE, 'utf8').trim();
        if (/^\d{16,}$/.test(saved)) return saved;
    } catch {
    }
    const created = randomNumericId('device');
    fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
    fs.writeFileSync(DEVICE_FILE, `${created}\n`, { mode: 0o600 });
    return created;
}

const processSessionId = randomNumericId('session');
const processDeviceId = deviceId();

function loadContexts(): Record<string, KimiContext> {
    try {
        return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {
        return {};
    }
}

const contexts = loadContexts();

function saveContexts() {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    const temporary = `${SESSION_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(contexts, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, SESSION_FILE);
    fs.chmodSync(SESSION_FILE, 0o600);
}

function headers(account: KimiAccount) {
    return {
        accept: '*/*',
        'accept-language': process.env.KIMI_ACCEPT_LANGUAGE || 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        authorization: `Bearer ${account.token}`,
        'cache-control': 'no-cache',
        'content-type': 'application/connect+json',
        'connect-protocol-version': '1',
        origin: BASE_URL,
        pragma: 'no-cache',
        referer: `${BASE_URL}/`,
        'r-timezone': process.env.KIMI_TIMEZONE || 'Europe/Warsaw',
        'user-agent': process.env.USER_AGENT ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'x-msh-device-id': processDeviceId,
        'x-msh-platform': 'web',
        'x-msh-session-id': processSessionId
    };
}

export function conversationKey(messages: Array<Record<string, any>>) {
    const firstUser = messages.find(message => message?.role === 'user');
    if (!firstUser) return crypto.randomUUID();
    const content = typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 24);
}

export async function kimiCompletion(options: {
    messages: Array<Record<string, any>>;
    model?: string;
    conversationId?: string;
}) {
    const account = getAccount();
    const key = options.conversationId || conversationKey(options.messages);
    const scopedKey = `${account.id}:${key}`;
    const context = contexts[scopedKey] || {};
    const model = options.model || 'kimi-k2.6';
    const thinking = model.includes('thinking') || model.includes('reasoner');
    const search = model.includes('search');
    const message: Record<string, unknown> = {
        role: 'user',
        blocks: [{ message_id: '', text: { content: messagesToPrompt(options.messages) } }],
        scenario: KIMI_SCENARIO
    };
    if (context.parentId) message.parent_id = context.parentId;
    const payload: Record<string, unknown> = {
        scenario: KIMI_SCENARIO,
        tools: search ? [{ type: 'TOOL_TYPE_SEARCH', search: {} }] : [],
        message,
        options: { thinking }
    };
    if (context.chatId) payload.chat_id = context.chatId;

    const response = await fetch(`${BASE_URL}${KIMI_CHAT_PATH}`, {
        method: 'POST',
        headers: headers(account),
        body: encodeKimiRequest(payload)
    });
    if ((response.status === 401 || response.status === 403) && account.id !== 'env') {
        markKimiAccountInvalid(account.id);
    }
    if (!response.ok) throw new Error(`Kimi completion failed: ${response.status} ${await response.text()}`);
    return {
        response,
        getSessionId: () => context.chatId || key,
        updateContext(event: Record<string, any>) {
            let changed = false;
            if (event?.chat?.id && event.chat.id !== context.chatId) {
                context.chatId = event.chat.id;
                changed = true;
            }
            if (event?.message?.role === 'assistant' && event?.message?.id && event.message.id !== context.parentId) {
                context.parentId = event.message.id;
                changed = true;
            }
            if (!changed) return;
            contexts[scopedKey] = context;
            saveContexts();
        }
    };
}

export {
    encodeKimiRequest,
    isEmptyToolCallResponse,
    messagesToPrompt,
    parseKimiEvent,
    parseKimiFrames
};
