import { describe, expect, test } from 'bun:test';
import { extractConversationId, mergeModelLists, targetForModel } from '../src/gateway/routing.ts';

describe('unified gateway routing', () => {
    test('routes DeepSeek and Kimi models separately and defaults everything else to Qwen', () => {
        expect(targetForModel('deepseek-reasoner', 'qwen', 'deepseek', 'kimi')).toBe('deepseek');
        expect(targetForModel('kimi-k2.6-thinking', 'qwen', 'deepseek', 'kimi')).toBe('kimi');
        expect(targetForModel('qwen3.7-plus', 'qwen', 'deepseek', 'kimi')).toBe('qwen');
        expect(targetForModel(undefined, 'qwen', 'deepseek', 'kimi')).toBe('qwen');
    });

    test('prefers explicit conversation headers and accepts body fallbacks', () => {
        expect(extractConversationId({ 'x-conversation-id': ' pi-session ' }, { chat_id: 'body' })).toBe('pi-session');
        expect(extractConversationId({}, { conversation_id: 'body-session' })).toBe('body-session');
        expect(extractConversationId({}, {})).toBeUndefined();
    });

    test('merges and de-duplicates provider model lists', () => {
        expect(mergeModelLists([
            { data: [{ id: 'qwen' }, { id: 'shared' }] },
            { data: [{ id: 'deepseek' }, { id: 'shared' }] },
            { data: [{ id: 'kimi' }] }
        ]).map((model: any) => model.id)).toEqual(['qwen', 'shared', 'deepseek', 'kimi']);
    });
});
