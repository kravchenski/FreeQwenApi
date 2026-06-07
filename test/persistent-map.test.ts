import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentStringMap } from '../src/utils/persistentMap.ts';

describe('PersistentStringMap', () => {
    test('persists values across instances', () => {
        const file = join(mkdtempSync(join(tmpdir(), 'free-ai-map-')), 'sessions.json');
        new PersistentStringMap(file).set('pi-session', 'remote-chat');
        expect(new PersistentStringMap(file).get('pi-session')).toBe('remote-chat');
    });
});
