export function estimateCostUsd(model: string, promptTokens = 0, completionTokens = 0): number {
  const rates: Record<string, { input: number; output: number }> = {
    heuristic: { input: 0, output: 0 },
    'gpt-4.1': { input: 2.5, output: 10 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    'gemini-1.5-pro': { input: 1.25, output: 5 },
  };
  const rate = rates[model] ?? { input: 2.5, output: 10 };
  return Number(((promptTokens * rate.input + completionTokens * rate.output) / 1_000_000).toFixed(6));
}
