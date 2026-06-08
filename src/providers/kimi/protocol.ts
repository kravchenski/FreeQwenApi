export const KIMI_SCENARIO = 'SCENARIO_K2D5';
export const KIMI_CHAT_PATH = '/apiv2/kimi.gateway.chat.v1.ChatService/Chat';
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder();

export type KimiStreamEvent = Record<string, any>;
export type KimiParseState = { phase?: 'thinking' | 'answer' };

export function messagesToPrompt(messages: Array<Record<string, any>>) {
    return messages.map(message => {
        const content = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? '');

        if (message.role === 'tool') {
            return `Tool result (${message.name || message.tool_call_id || 'tool'}): ${content}`;
        }
        if (message.role === 'assistant' && message.tool_calls) {
            return `Assistant tool calls: ${JSON.stringify(message.tool_calls)}\n${content}`;
        }
        return `${message.role || 'user'}: ${content}`;
    }).join('\n\n');
}

export function isEmptyToolCallResponse(content: string) {
    return /^\s*(?:```json\s*)?\{\s*"tool_calls"\s*:\s*\[\s*\]\s*\}(?:\s*```)?\s*$/i.test(content);
}

export function encodeKimiRequest(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload));
    const frame = Buffer.allocUnsafe(body.length + 5);
    frame[0] = 0;
    frame.writeUInt32BE(body.length, 1);
    body.copy(frame, 5);
    return frame;
}

export function parseKimiFrames(buffer: Uint8Array) {
    const events: KimiStreamEvent[] = [];
    let offset = 0;

    while (offset + 5 <= buffer.length) {
        const flag = buffer[offset];
        const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0);
        if (length > MAX_FRAME_BYTES) throw new Error(`Kimi stream frame exceeds ${MAX_FRAME_BYTES} bytes`);
        const end = offset + 5 + length;
        if (end > buffer.length) break;

        if (!(flag & 0x80)) {
            try {
                events.push(JSON.parse(decoder.decode(buffer.slice(offset + 5, end))));
            } catch {
                // Ignore malformed upstream frames and continue parsing the stream.
            }
        }
        offset = end;
    }

    return { events, rest: buffer.slice(offset) };
}

export function parseKimiEvent(event: KimiStreamEvent, state: KimiParseState = {}) {
    if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));

    const stages = event?.block?.multiStage?.stages;
    if (Array.isArray(stages) && stages[0]?.name === 'STAGE_NAME_THINKING') {
        state.phase = stages[0].status === 'completed' ? 'answer' : 'thinking';
    }

    const flags = event?.block?.text?.flags;
    if (flags === 'thinking' || flags === 'answer') state.phase = flags;

    const mask = typeof event.mask === 'string' ? event.mask : '';
    if (mask.includes('block.think')) {
        return event?.block?.think?.content ? { reasoning: event.block.think.content } : null;
    }

    const content = event?.block?.text?.content;
    if (typeof content !== 'string' || !content) return event.done ? { done: true } : null;
    if (flags === 'thinking') return { reasoning: content };

    state.phase = 'answer';
    return { content };
}
