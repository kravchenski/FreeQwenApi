import { describe, expect, test } from 'bun:test';

import { conversationKey, messagesToPrompt, parseDeepSeekEvent } from '../src/providers/deepseek/client.ts';
import { validateDeepSeekPowSolver } from '../src/providers/deepseek/pow.ts';
import { hasValidDeepSeekAccounts } from '../src/providers/deepseek/accounts.ts';

describe('DeepSeek web provider', () => {
    test('keeps a stable conversation key during a pi tool loop', () => {
        const initial = [{ role: 'user', content: 'build a feature' }];
        const continued = [
            ...initial,
            { role: 'assistant', tool_calls: [{ function: { name: 'read' } }] },
            { role: 'tool', content: 'result' }
        ];

        expect(conversationKey(continued)).toBe(conversationKey(initial));
    });

    test('folds tool results into the DeepSeek prompt', () => {
        expect(messagesToPrompt([
            { role: 'user', content: 'inspect it' },
            { role: 'tool', name: 'read', content: 'file contents' }
        ])).toContain('Tool result (read): file contents');
    });

    test('parses current DeepSeek fragment events', () => {
        const state = { phase: 'content' as const, fragment: undefined as string | undefined };
        parseDeepSeekEvent('data: {"p":"response/fragments/-1/type","v":"THINK"}', state);
        expect(parseDeepSeekEvent('data: {"p":"response/fragments/-1/content","v":"reason"}', state))
            .toEqual({ reasoning: 'reason' });
        parseDeepSeekEvent('data: {"p":"response/fragments/-1/type","v":"RESPONSE"}', state);
        expect(parseDeepSeekEvent('data: {"p":"response/fragments/-1/content","v":"answer"}', state))
            .toEqual({ content: 'answer' });
    });

    test('loads the bundled DeepSeek PoW solver', async () => {
        expect(await validateDeepSeekPowSolver()).toBeTrue();
    });

    test('can inspect DeepSeek account availability without environment setup', () => {
        expect(typeof hasValidDeepSeekAccounts()).toBe('boolean');
    });
});
