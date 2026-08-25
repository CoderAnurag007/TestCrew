export class ConfidenceCalculator {
  calculate(input: {
    deterministic: boolean;
    screenshot?: boolean;
    console?: boolean;
    network?: boolean;
    reproduced?: boolean;
    aiOnly?: boolean;
  }): number {
    let score = input.deterministic ? 0.62 : 0.4;
    if (input.screenshot) {
      score += 0.08;
    }
    if (input.console) {
      score += 0.1;
    }
    if (input.network) {
      score += 0.1;
    }
    if (input.reproduced) {
      score += 0.08;
    }
    if (input.aiOnly) {
      score = Math.min(score, 0.55);
    }
    return Number(Math.min(0.97, Math.max(0.2, score)).toFixed(2));
  }
}
