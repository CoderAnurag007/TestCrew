import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/gemini.js';

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ok = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
});

describe('Gemini fallback model', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers with the fallback model when the main one is overloaded, then skips the busy model', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const model = /models\/([^:]+):/.exec(url)![1]!;
        calls.push(model);
        return model === 'main-flash' ? reply(503, { error: { message: 'high demand' } }) : reply(200, ok('OK'));
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', model: 'main-flash', fallbackModel: 'lite' });

    const first = await provider.generateText({ messages: [{ role: 'user', content: 'hi' }], retries: 0 });
    expect(first.content).toBe('OK');
    expect(first.model).toBe('lite');
    expect(first.promptTokens).toBe(12);
    expect(first.estimatedCostUsd).toBeGreaterThan(0);

    calls.length = 0;
    await provider.generateText({ messages: [{ role: 'user', content: 'again' }], retries: 0 });
    expect(calls).toEqual(['lite']);
  });

  it('does not hide real errors such as a bad request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: { message: 'bad request' } })));
    const provider = new GeminiProvider({ apiKey: 'k', model: 'other-flash', fallbackModel: 'lite' });
    await expect(provider.generateText({ messages: [{ role: 'user', content: 'hi' }], retries: 0 })).rejects.toThrow(/400/);
  });
});
