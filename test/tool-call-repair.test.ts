import { describe, expect, test } from 'bun:test';

import {
    buildConversationScopeFromHistory,
    extractFirstToolCallObject,
    hasObviouslyBrokenEditArguments,
    recoverSimpleToolCalls,
    recoverBrokenBashToolCall,
    recoverChineseStyleToolCall,
    recoverFencedShellToolCalls,
    recoverProseStyleToolCalls,
    recoverXmlStyleToolCall,
    parseToolCallJson,
    repairEditArguments,
    repairToolCallJsonKeys,
    toolsToPrompt
} from '../src/api/routes.ts';

describe('tool call JSON repair', () => {
    test('repairs whitespace inserted into known argument keys', () => {
        const broken = '{"tool_calls":[{"name":"edit","arguments":{"path":"/tmp/a.css","edit\n s":[{"oldText":"a","newText":"b"}]}}]}';
        const repaired = repairToolCallJsonKeys(broken);

        expect(JSON.parse(repaired).tool_calls[0].arguments.edits).toEqual([
            { oldText: 'a', newText: 'b' }
        ]);
    });

    test('does not alter whitespace inside argument values', () => {
        const source = '{"tool_calls":[{"name":"write","arguments":{"content":"edit s and old Text"}}]}';

        expect(repairToolCallJsonKeys(source)).toBe(source);
    });

    test('rejects missing JavaScript delimiters in edit replacements', () => {
        expect(hasObviouslyBrokenEditArguments({
            edits: [{
                newText: 'document.querySelector(.fighter-card[data-index="${index}"]);'
            }]
        })).toBeTrue();

        expect(hasObviouslyBrokenEditArguments({
            edits: [{
                newText: 'document.querySelector(`.fighter-card[data-index="${index}"]`);'
            }]
        })).toBeFalse();
    });

    test('advertises edit alongside safer writing tools', () => {
        const prompt = toolsToPrompt([
            { function: { name: 'edit', parameters: { type: 'object' } } },
            { function: { name: 'write', parameters: { type: 'object' } } }
        ]);

        expect(prompt).toContain('edit, write');
        expect(prompt).toContain('"name": "edit"');
    });

    test('advertises edit when it is the only supplied tool', () => {
        const prompt = toolsToPrompt([
            { function: { name: 'edit', parameters: { type: 'object' } } }
        ]);

        expect(prompt).toContain('Available tool names exactly:\nedit');
    });

    test('requires workspace inspection before codebase claims', () => {
        const prompt = toolsToPrompt([
            { function: { name: 'ls', parameters: { type: 'object' } } },
            { function: { name: 'read', parameters: { type: 'object' } } }
        ]);

        expect(prompt).toContain('For codebase tasks such as implement, fix, refactor');
        expect(prompt).toContain('Never claim that a file exists, was deleted, changed, tested, or listed');
        expect(prompt).toContain('Tool call: read (path)');
    });

    test('repairs common missing backticks in JavaScript edits', () => {
        const repaired = repairEditArguments({
            edits: [{
                oldText: 'toast.textContent = ${fighters[activeIndex].name} - FIGHT;',
                newText: [
                    'const activeCard = document.querySelector(.fighter-card[data-index="${index}"]);',
                    'toast.textContent = ${fighters[activeIndex].name} — ${phrase};'
                ].join('\n')
            }]
        });

        expect(repaired.edits[0].oldText).toBe(
            'toast.textContent = `${fighters[activeIndex].name} - FIGHT`;'
        );
        expect(repaired.edits[0].newText).toContain(
            'document.querySelector(`.fighter-card[data-index="${index}"]`)'
        );
        expect(repaired.edits[0].newText).toContain(
            'toast.textContent = `${fighters[activeIndex].name} — ${phrase}`;'
        );
    });

    test('recovers write JSON content with unescaped quotes and following reads', () => {
        const broken = '{"tool_calls":[{"name":"write","arguments":{"path":"/tmp/triden\n t.json","content":"{\\n  "id": "trident"\\n}\\n"}},{"name":"write","arguments":{"path":"/tmp/fist.json","content":"{\\n  "id": "fist"\\n}\\n"}},{"name":"read","arguments":{"path":"/tmp/arena.js"}}]},{"name":"read","arguments":{"path":"/tmp/arena.html"}}]}';
        const calls = recoverSimpleToolCalls(broken);

        expect(calls).toHaveLength(4);
        expect(calls[0]).toEqual({
            name: 'write',
            arguments: { path: '/tmp/trident.json', content: '{\n  "id": "trident"\n}\n' }
        });
        expect(calls[3]).toEqual({
            name: 'read',
            arguments: { path: '/tmp/arena.html' }
        });
    });

    test('keeps a stable scope while a pi tool-loop appends messages', () => {
        const initial = [
            { role: 'system', content: 'coding agent' },
            { role: 'user', content: 'build the feature' }
        ];
        const continued = [
            ...initial,
            { role: 'assistant', tool_calls: [{ function: { name: 'read' } }] },
            { role: 'tool', content: 'file contents' },
            { role: 'assistant', content: 'working' }
        ];

        expect(buildConversationScopeFromHistory(continued)).toBe(
            buildConversationScopeFromHistory(initial)
        );
    });

    test('recovers broken bash quoting but rejects conversational echo calls', () => {
        const broken = '{"tool_calls":[{"name":"bash","arguments":{"command":"echo "Привет!""}}]}';

        expect(recoverBrokenBashToolCall(broken)).toEqual({
            name: 'bash',
            arguments: { command: 'echo "Привет!"' }
        });
        expect(parseToolCallJson(broken)).toBeNull();
    });

    test('extracts the first tool call when prose and duplicate JSON surround it', () => {
        const content = 'Сначала изучу проект.\n{"tool_calls":[{"name":"ls","arguments":{"path":"."}}]}\n{"tool_calls":[{"name":"ls","arguments":{"path":"."}}]}';

        expect(JSON.parse(extractFirstToolCallObject(content)).tool_calls).toHaveLength(1);
        expect(parseToolCallJson(content)?.[0].function.name).toBe('ls');
    });

    test('converts simulated XML tools into real tool calls', () => {
        expect(recoverXmlStyleToolCall('Сначала проверю.\n<bash>\nread main.py --limit 300\n</bash>')).toEqual({
            name: 'read',
            arguments: { path: 'main.py' }
        });
        expect(parseToolCallJson('<bash>\nfind . -name "*.ts"\n</bash>')?.[0].function.name).toBe('bash');
    });

    test('converts simulated Chinese-style tools into real tool calls', () => {
        const content = 'Сначала посмотрю файл.\n[调用 read] [{"path": "/tmp/arena.html"}]\n[调用 bash] [{"command": "ls"}]';

        expect(recoverChineseStyleToolCall(content)).toEqual({
            name: 'read',
            arguments: { path: '/tmp/arena.html' }
        });
        expect(parseToolCallJson(content)?.[0].function.name).toBe('read');
    });

    test('converts prose-style tool calls into multiple real tool calls', () => {
        const content = [
            'Сначала проверим текущие файлы.',
            '',
            'Tool call: read (heintai/js/arena-main.js)',
            '',
            'Tool call: read (heintai/js/index.js)',
            '',
            'Tool call: read (heintai/js/three-bg.js)'
        ].join('\n');

        expect(recoverProseStyleToolCalls(content)).toEqual([
            { name: 'read', arguments: { path: 'heintai/js/arena-main.js' } },
            { name: 'read', arguments: { path: 'heintai/js/index.js' } },
            { name: 'read', arguments: { path: 'heintai/js/three-bg.js' } }
        ]);
        const calls = parseToolCallJson(content);
        expect(calls).toHaveLength(3);
        expect(calls?.map(call => JSON.parse(call.function.arguments).path)).toEqual([
            'heintai/js/arena-main.js',
            'heintai/js/index.js',
            'heintai/js/three-bg.js'
        ]);
    });

    test('converts prose-style JSON arguments and rejects malformed arguments', () => {
        expect(recoverProseStyleToolCalls('Tool call: read ({"path":"main.ts"})')).toEqual([
            { name: 'read', arguments: { path: 'main.ts' } }
        ]);
        expect(recoverProseStyleToolCalls('Tool call: read ({"path":})')).toBeNull();
        expect(recoverProseStyleToolCalls('Tool call: unknown (anything)')).toBeNull();
    });

    test('recovers multiline write content without damaging embedded markup', () => {
        const content = [
            'Полностью заменю файл.',
            '',
            'Tool call: write (heintai/arena.html)',
            'Content: <!DOCTYPE html>',
            '<html lang="ru">',
            '<body>',
            '```',
            '<script type="module">',
            'console.log("arena");',
            '</script>',
            '```',
            '</body>',
            '</html>'
        ].join('\n');

        const calls = recoverProseStyleToolCalls(content);
        expect(calls).toHaveLength(1);
        expect(calls?.[0].name).toBe('write');
        expect(calls?.[0].arguments.path).toBe('heintai/arena.html');
        expect(calls?.[0].arguments.content).toContain('<!DOCTYPE html>');
        expect(calls?.[0].arguments.content).toContain('console.log("arena");');
        expect(parseToolCallJson(content, [{ function: { name: 'write' } }])?.[0].function.name).toBe('write');
    });

    test('recovers intentional fenced shell checks but leaves command examples as text', () => {
        const inspection = [
            'Давайте проверим текущее состояние и исправим основательно.',
            '',
            '```bash',
            'cat heintai/index.html | grep -A5 "viewport"',
            '```',
            '',
            '```bash',
            'cat heintai/css/index.css | grep -A10 "@media"',
            '```'
        ].join('\n');
        const instructions = 'Запустите эту команду:\n```bash\nbun run ci\n```';

        expect(recoverFencedShellToolCalls(inspection)).toHaveLength(2);
        expect(parseToolCallJson(inspection, [{ function: { name: 'bash' } }])).toHaveLength(2);
        expect(recoverFencedShellToolCalls(instructions)).toBeNull();
    });

    test('only returns tool calls that the client actually supplied', () => {
        const write = 'Tool call: write (arena.html)\nContent: <html></html>';
        const shell = 'Сначала проверю проект.\n```bash\nls -la\n```';
        const json = '{"tool_calls":[{"name":"write","arguments":{"path":"arena.html","content":"ok"}}]}';

        expect(parseToolCallJson(write, [{ function: { name: 'read' } }])).toBeNull();
        expect(parseToolCallJson(shell, [{ function: { name: 'read' } }])).toBeNull();
        expect(parseToolCallJson(json, [{ function: { name: 'read' } }])).toBeNull();
        expect(parseToolCallJson(write, [{ function: { name: 'write' } }])?.[0].function.name).toBe('write');
    });
});
