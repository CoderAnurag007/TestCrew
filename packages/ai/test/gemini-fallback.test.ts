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
    const provider = new GeminiProvider({ apiKey: 'k', model: 'main-flash', fallbackModels: ['lite'] });

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
    const provider = new GeminiProvider({ apiKey: 'k', model: 'other-flash', fallbackModels: ['lite'] });
    await expect(provider.generateText({ messages: [{ role: 'user', content: 'hi' }], retries: 0 })).rejects.toThrow(/400/);
  });

  it('tries the next backup model when the first backup is busy too', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const model = /models\/([^:]+):/.exec(url)![1]!;
        calls.push(model);
        return model === 'lite-b' ? reply(200, ok('OK')) : reply(503, { error: { message: 'high demand' } });
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', model: 'main-2', fallbackModels: ['lite-a', 'lite-b'] });
    const result = await provider.generateText({ messages: [{ role: 'user', content: 'hi' }], retries: 0 });
    expect(result.model).toBe('lite-b');
    expect(calls).toEqual(['main-2', 'lite-a', 'lite-b']);
  });

  it('asks once for corrected JSON when the shape is wrong', async () => {
    const { z } = await import('zod');
    const answers = ['{"findings":[{"title":"X","evidence":"one"}]}', '{"findings":[{"title":"X","evidence":["one"]}]}'];
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return reply(200, ok(answers.shift()!));
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', model: 'main-3', fallbackModels: [] });
    const result = await provider.generateStructured(
      { messages: [{ role: 'user', content: 'find issues' }], retries: 0 },
      z.object({ findings: z.array(z.object({ title: z.string(), evidence: z.array(z.string()) })) }),
    );
    expect(result.data.findings[0]!.evidence).toEqual(['one']);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('does not match the required format');
    expect(result.promptTokens).toBe(24);
  });
});

