import crypto from 'crypto';

import { solveDeepSeekPow } from './pow.ts';

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://chat.deepseek.com';
const token = process.env.DEEPSEEK_TOKEN || '';
const sessions = new Map<string, string>();

function headers(extra: Record<string, string> = {}) {
    if (!token) throw new Error('DEEPSEEK_TOKEN is not configured');
    return {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
        ...extra
    };
}

export function conversationKey(messages: Array<Record<string, any>>) {
    const firstUser = messages.find(message => message?.role === 'user');
    if (!firstUser) return crypto.randomUUID();
    const content = typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 24);
}

async function createSession() {
    const response = await fetch(`${BASE_URL}/api/v0/chat_session/create`, {
        method: 'POST',
        headers: headers(),
        body: '{}'
    });
    if (!response.ok) throw new Error(`DeepSeek session create failed: ${response.status} ${await response.text()}`);
    const body = await response.json() as any;
    const id = body?.data?.biz_data?.chat_session?.id || body?.data?.biz_data?.id;
    if (!id) throw new Error('DeepSeek did not return a chat session id');
    return id as string;
}

async function getSession(key: string) {
    const existing = sessions.get(key);
    if (existing) return existing;
    const created = await createSession();
    sessions.set(key, created);
    return created;
}

async function getPow(sessionId: string) {
    const response = await fetch(`${BASE_URL}/api/v0/chat/create_pow_challenge`, {
        method: 'POST',
        headers: headers({ referer: `${BASE_URL}/a/chat/s/${sessionId}` }),
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' })
    });
    if (!response.ok) throw new Error(`DeepSeek PoW challenge failed: ${response.status} ${await response.text()}`);
    const body = await response.json() as any;
    const challenge = body?.data?.biz_data?.challenge;
    if (!challenge) throw new Error('DeepSeek did not return a PoW challenge');
    return solveDeepSeekPow(challenge);
}

export function messagesToPrompt(messages: Array<Record<string, any>>) {
    return messages.map(message => {
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
        if (message.role === 'tool') return `Tool result (${message.name || message.tool_call_id || 'tool'}): ${content}`;
        if (message.role === 'assistant' && message.tool_calls) {
            return `Assistant tool calls: ${JSON.stringify(message.tool_calls)}\n${content}`;
        }
        return `${message.role || 'user'}: ${content}`;
    }).join('\n\n');
}

export async function deepSeekCompletion(options: {
    messages: Array<Record<string, any>>;
    model?: string;
    conversationId?: string;
}) {
    const key = options.conversationId || conversationKey(options.messages);
    const sessionId = await getSession(key);
    const pow = await getPow(sessionId);
    const model = options.model || 'deepseek-default';
    const response = await fetch(`${BASE_URL}/api/v0/chat/completion`, {
        method: 'POST',
        headers: headers({
            referer: `${BASE_URL}/a/chat/s/${sessionId}`,
            'x-ds-pow-response': pow,
            ...(model.includes('reasoner') || model.includes('r1') ? { 'x-thinking-enabled': 'true' } : {})
        }),
        body: JSON.stringify({
            chat_session_id: sessionId,
            parent_message_id: null,
            prompt: messagesToPrompt(options.messages),
            ref_file_ids: [],
            thinking_enabled: model.includes('reasoner') || model.includes('r1'),
            search_enabled: model.includes('search'),
            model_type: model.includes('expert') ? 'expert' : 'default'
        })
    });
    if (!response.ok) throw new Error(`DeepSeek completion failed: ${response.status} ${await response.text()}`);
    return { response, sessionId, key };
}

export function parseDeepSeekEvent(line: string, state: { phase: 'content' | 'thinking'; fragment?: string }) {
    if (!line.startsWith('data:')) return null;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return { done: true };
    const event = JSON.parse(data);
    const path = event.p;
    const value = event.v;
    if (path === 'response/fragments/-1/type') state.fragment = value;
    if (path === 'response/thinking_content') state.phase = 'thinking';
    if (path === 'response/content') state.phase = 'content';
    if (path === 'response/fragments/-1/content') {
        state.phase = state.fragment === 'THINK' ? 'thinking' : 'content';
    }
    if (typeof value !== 'string' || path === 'response/fragments/-1/type') return null;
    return state.phase === 'thinking' ? { reasoning: value } : { content: value };
}
