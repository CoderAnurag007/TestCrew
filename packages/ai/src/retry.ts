/**
 * fetch with retries for AI providers. Rate limits (429) and temporary server
 * errors (500/502/503/504) are common and short-lived; without a retry, one busy
 * moment turns an AI-assisted run into a heuristic one without anyone noticing.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { retries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const baseDelay = options.baseDelayMs ?? 1_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
      if (!RETRYABLE.has(response.status) || attempt === retries) {
        return response;
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => undefined);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20_000) : backoff(baseDelay, attempt));
    } catch (error) {
      lastError = error;
      // A call that already used its whole time budget is not retried: retrying
      // multiplies the wait, which is worse than falling back to heuristics.
      if (attempt === retries || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
        throw error;
      }
      await sleep(backoff(baseDelay, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

function backoff(base: number, attempt: number): number {
  return Math.round(base * 3 ** attempt * (0.8 + Math.random() * 0.4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
