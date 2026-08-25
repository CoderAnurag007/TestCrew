import type { ActionRisk, DiscoveredElement, GeneratedTestCase } from '@auditor/shared';

export class RiskAnalyzer {
  assessElement(element: DiscoveredElement): ActionRisk {
    return element.riskLevel;
  }

  assessTest(test: GeneratedTestCase): ActionRisk {
    if (test.steps.some((step) => /delete|pay|purchase|destroy/i.test(`${step.description} ${step.value ?? ''}`))) {
      return 'DESTRUCTIVE';
    }
    if (test.risk === 'DESTRUCTIVE' || test.risk === 'CAUTION') {
      return test.risk;
    }
    return 'SAFE';
  }

  shouldSkip(test: GeneratedTestCase, allowDestructive: boolean): boolean {
    return this.assessTest(test) === 'DESTRUCTIVE' && !allowDestructive;
  }
}
