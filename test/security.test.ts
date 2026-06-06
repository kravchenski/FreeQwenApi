import { describe, expect, test } from 'bun:test';

import { isValidChatId } from '../src/api/chatHistory.ts';

describe('security boundaries', () => {
    test('rejects path traversal chat ids', () => {
        expect(isValidChatId('../../outside')).toBeFalse();
        expect(isValidChatId('..%2F..%2Foutside')).toBeFalse();
        expect(isValidChatId('valid_chat-id_123')).toBeTrue();
    });
});
