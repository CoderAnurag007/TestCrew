import { z } from 'zod';
import { actionRiskSchema, findingCategorySchema, findingSeveritySchema, testCategorySchema, testPrioritySchema } from './enums.js';
import { fieldConstraintsSchema, selectorMetaSchema } from './semantic.js';

export const testStepTypeSchema = z.enum([
  'navigate',
  'click',
  'type',
  'select',
  'upload',
  'wait',
  'assert',
  'reload',
  'back',
  'capture',
]);
export type TestStepType = z.infer<typeof testStepTypeSchema>;

export const assertionKindSchema = z.enum([
  'url',
  'text',
  'visibility',
  'existence',
  'attribute',
  'value',
  'count',
  'http',
  'console_error',
  'page_error',
  'element_text',
]);
export type AssertionKind = z.infer<typeof assertionKindSchema>;

export const assertionOperatorSchema = z.enum(['equals', 'contains', 'matches', 'gte', 'lte', 'exists', 'absent']);
export type AssertionOperator = z.infer<typeof assertionOperatorSchema>;

export const assertionSpecSchema = z.object({
  kind: assertionKindSchema,
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
  selector: z.string().optional(),
  selectors: selectorMetaSchema.optional(),
  attribute: z.string().optional(),
  operator: assertionOperatorSchema.optional(),
  statusCode: z.number().int().optional(),
});
export type AssertionSpec = z.infer<typeof assertionSpecSchema>;

export const testStepSchema = z.object({
  id: z.string().min(1),
  type: testStepTypeSchema,
  description: z.string().min(1).max(500),
  selectors: selectorMetaSchema.optional(),
  href: z.string().nullable().optional(),
  value: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  assertion: assertionSpecSchema.optional(),
  discoveredActionId: z.string().optional(),
  discoveredElementId: z.string().optional(),
  /** For `capture` steps: variable name later referenced as {{name}} or {{name+1}}. */
  captureAs: z
    .string()
    .regex(/^[a-zA-Z_]\w{0,39}$/)
    .optional(),
  captureMode: z.enum(['text', 'count', 'value']).optional(),
});
export type TestStep = z.infer<typeof testStepSchema>;

export const generatedTestCaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  category: testCategorySchema,
  priority: testPrioritySchema,
  risk: actionRiskSchema,
  preconditions: z.array(z.string()),
  steps: z.array(testStepSchema).min(1),
  expectedResults: z.array(z.string()).min(1),
  flowName: z.string().optional(),
  requiresAuth: z.boolean().optional(),
  viewport: z.enum(['desktop', 'tablet', 'mobile']).optional(),
  /** Where the test came from: planner, AI generation, a user intent, or a consistency check. */
  source: z.enum(['generated', 'ai', 'intent', 'consistency']).optional(),
  intentId: z.string().optional(),
  /** True when the test changes data in the target app (create/edit/submit). */
  mutates: z.boolean().optional(),
});
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;

export const generatedTestSuiteSchema = z.object({
  tests: z.array(generatedTestCaseSchema),
});
export type GeneratedTestSuite = z.infer<typeof generatedTestSuiteSchema>;

export const intentSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(3).max(1000),
  enabled: z.boolean().default(true),
});
export type Intent = z.infer<typeof intentSchema>;
export const intentListSchema = z.array(intentSchema).max(100);

export const discoveredElementSchema = z.object({
  id: z.string(),
  stateId: z.string().optional(),
  url: z.string(),
  title: z.string().optional(),
  type: z.string(),
  label: z.string(),
  href: z.string().nullable().optional(),
  category: z.string(),
  riskLevel: actionRiskSchema,
  inputType: z.string().nullable().optional(),
  selectors: selectorMetaSchema,
  constraints: fieldConstraintsSchema.optional(),
});
export type DiscoveredElement = z.infer<typeof discoveredElementSchema>;

export const failureAnalysisSchema = z.object({
  title: z.string().min(1).max(240),
  summary: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  confidence: z.number().min(0).max(1),
  rootCauseHypothesis: z.string().min(1),
  recommendation: z.string().min(1),
});
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

export const uxFindingSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  url: z.string().optional(),
  component: z.string().optional(),
});
export type UxFindingDraft = z.infer<typeof uxFindingSchema>;

export const uxAnalysisSchema = z.object({
  findings: z.array(uxFindingSchema),
});
export type UxAnalysis = z.infer<typeof uxAnalysisSchema>;

export const qualityScoreWeightsSchema = z.object({
  critical: z.number().default(25),
  high: z.number().default(12),
  medium: z.number().default(5),
  low: z.number().default(2),
  info: z.number().default(0),
  failedTest: z.number().default(4),
  uxIssue: z.number().default(3),
  accessibilityIssue: z.number().default(3),
  visualIssue: z.number().default(2),
  coverageBoost: z.number().default(15),
  successBoost: z.number().default(10),
});
export type QualityScoreWeights = z.infer<typeof qualityScoreWeightsSchema>;

export const coverageStatsSchema = z.object({
  discoveredFlows: z.number().int().nonnegative(),
  testedFlows: z.number().int().nonnegative(),
  successfulFlows: z.number().int().nonnegative(),
  failedFlows: z.number().int().nonnegative(),
  untestedFlows: z.number().int().nonnegative(),
});
export type CoverageStats = z.infer<typeof coverageStatsSchema>;

export const runCostSchema = z.object({
  aiCostUsd: z.number().nonnegative(),
  browserDurationMs: z.number().int().nonnegative(),
  storageBytesEstimate: z.number().int().nonnegative(),
});
export type RunCost = z.infer<typeof runCostSchema>;

export const DEFAULT_QUALITY_SCORE_WEIGHTS: QualityScoreWeights = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
  failedTest: 4,
  uxIssue: 3,
  accessibilityIssue: 3,
  visualIssue: 2,
  coverageBoost: 15,
  successBoost: 10,
};
