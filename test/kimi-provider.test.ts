import { describe, expect, test } from 'bun:test';

import {
    conversationKey,
    encodeKimiRequest,
    isEmptyToolCallResponse,
    messagesToPrompt,
    parseKimiEvent,
    parseKimiFrames
} from '../src/providers/kimi/client.ts';
import { hasValidKimiAccounts } from '../src/providers/kimi/accounts.ts';

describe('Kimi web provider', () => {
    test('keeps a stable conversation key during a tool loop', () => {
        const initial = [{ role: 'user', content: 'build a feature' }];
        const continued = [
            ...initial,
            { role: 'assistant', tool_calls: [{ function: { name: 'read' } }] },
            { role: 'tool', content: 'result' }
        ];
        expect(conversationKey(continued)).toBe(conversationKey(initial));
    });

    test('folds tool results into the Kimi prompt', () => {
        expect(messagesToPrompt([
            { role: 'user', content: 'inspect it' },
            { role: 'tool', name: 'read', content: 'file contents' }
        ])).toContain('Tool result (read): file contents');
    });

    test('encodes and parses Connect JSON frames, preserving partial frames', () => {
        const first = encodeKimiRequest({ block: { text: { content: 'answer' } } });
        const second = encodeKimiRequest({ done: true });
        const combined = Buffer.concat([first, second]);
        const partial = parseKimiFrames(combined.subarray(0, first.length + 3));

        expect(partial.events).toHaveLength(1);
        expect(partial.rest).toHaveLength(3);
        expect(parseKimiFrames(Buffer.concat([partial.rest, combined.subarray(first.length + 3)])).events)
            .toEqual([{ done: true }]);
    });

    test('rejects oversized Kimi stream frames', () => {
        const frame = Buffer.alloc(5);
        frame.writeUInt32BE(32 * 1024 * 1024 + 1, 1);
        expect(() => parseKimiFrames(frame)).toThrow('Kimi stream frame exceeds');
    });

    test('separates Kimi thinking and answer events', () => {
        const state = {};
        expect(parseKimiEvent({ mask: 'block.think', block: { think: { content: 'reason' } } }, state))
            .toEqual({ reasoning: 'reason' });
        expect(parseKimiEvent({ block: { text: { flags: 'thinking', content: 'more reason' } } }, state))
            .toEqual({ reasoning: 'more reason' });
        expect(parseKimiEvent({ mask: 'block.text', block: { text: { content: 'answer' } } }, state))
            .toEqual({ content: 'answer' });
        expect(parseKimiEvent({ block: { text: { flags: 'answer', content: 'answer' } } }, state))
            .toEqual({ content: 'answer' });
    });

    test('detects empty simulated tool-call responses', () => {
        expect(isEmptyToolCallResponse('{"tool_calls":[]}')).toBeTrue();
        expect(isEmptyToolCallResponse('{"tool_calls":[{"name":"read"}]}')).toBeFalse();
    });

    test('can inspect Kimi account availability without environment setup', () => {
        expect(typeof hasValidKimiAccounts()).toBe('boolean');
    });
});
