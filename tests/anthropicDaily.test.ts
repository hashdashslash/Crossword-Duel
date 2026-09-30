/**
 * The daily clue requests go through the real Anthropic SDK (with a pretend
 * network), so SDK-side rules that would stop a request before it is sent
 * are caught here, not in production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sent: { stream: boolean; max_tokens: number }[] = [];

/** Answers every request with `json` as the model's reply, streamed or not, as the request asks. */
function fakeFetch(json: unknown): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { stream?: boolean; max_tokens: number; model: string };
    sent.push({ stream: !!body.stream, max_tokens: body.max_tokens });
    const text = JSON.stringify(json);
    const message = {
      id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    if (!body.stream) {
      return new Response(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const events = [
      ['message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    const sse = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
}

describe('daily clue requests through the Anthropic SDK', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
  afterAll(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  it('writes candidates (a big reply, so it streams)', async () => {
    globalThis.fetch = fakeFetch({ answers: [{ id: '0', candidates: [{ technique: 'I', clue: 'Where waves come from' }] }] });
    const { AnthropicClueAI } = await import('../server/ai/anthropic.js');
    const ai = new AnthropicClueAI();
    sent.length = 0;
    const out = await ai.writeCrosswordClues([{ id: '0', answer: 'SEA' }], { gridAnswers: ['SEA'] }, AbortSignal.timeout(10_000));
    expect(out).toEqual([{ id: '0', candidates: [{ technique: 'I', clue: 'Where waves come from' }] }]);
    expect(sent[0]).toMatchObject({ stream: true });
    expect(sent[0]!.max_tokens).toBeGreaterThan(16_000);
  });

  it('scores candidates with a critic', async () => {
    const score = { index: 0, accuracy: 3, fairness: 3, freshness: 2, surface: 3, delight: 2, facts: 'none' };
    globalThis.fetch = fakeFetch({ answers: [{ id: '0', scores: [score] }] });
    const { AnthropicClueAI } = await import('../server/ai/anthropic.js');
    const ai = new AnthropicClueAI();
    const out = await ai.reviewCrosswordClues([{ id: '0', answer: 'SEA', clues: ['Where waves come from'] }], 0, AbortSignal.timeout(10_000));
    expect(out).toEqual([{ id: '0', scores: [score] }]);
  });
});
