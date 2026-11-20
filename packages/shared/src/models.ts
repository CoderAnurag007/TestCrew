import { z } from 'zod';
import {
  actionRiskSchema,
  credentialTypeSchema,
  evidenceTypeSchema,
  findingCategorySchema,
  findingSeveritySchema,
  findingStatusSchema,
  membershipRoleSchema,
  runStageStatusSchema,
  runStatusSchema,
  testCategorySchema,
  testPrioritySchema,
  safetyModeSchema,
  findingChangeSchema,
  failureClassSchema,
} from './enums.js';
import { intentListSchema } from './testing.js';
import { environmentKindSchema } from './test-plan.js';

const id = z.string().min(1);
const dateTime = z.coerce.date();
const url = z.string().url().max(2048);

export const userSchema = z.object({
  id,
  email: z.string().email().max(320),
  name: z.string().min(1).max(120),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type User = z.infer<typeof userSchema>;

export const organizationSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80),
  brandName: z.string().nullable().optional(),
  brandLogoUrl: z.string().nullable().optional(),
  brandColor: z.string().nullable().optional(),
  brandFooter: z.string().nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSchema = z.object({
  id,
  organizationId: id,
  userId: id,
  role: membershipRoleSchema,
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Membership = z.infer<typeof membershipSchema>;

export const projectSchema = z.object({
  id,
  organizationId: id,
  name: z.string().min(1).max(160),
  description: z.string().max(4000).nullable(),
  baseUrl: url,
  maxPages: z.number().int().positive(),
  maxActions: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  allowDestructive: z.boolean(),
  allowPrivateTargets: z.boolean(),
  recordVideo: z.boolean().optional().default(false),
  safetyMode: safetyModeSchema.optional().default('READ_ONLY'),
  verificationToken: z.string().nullable().optional(),
  verifiedHost: z.string().nullable().optional(),
  verifiedAt: dateTime.nullable().optional(),
  resetHookUrl: z.string().nullable().optional(),
  intents: intentListSchema.optional().default([]),
  blockedPathPatterns: z.array(z.string()).optional().default([]),
  testPlan: z.unknown().optional(),
  verifiedHosts: z.array(z.string()).optional().default([]),
  monitorCadence: z.string().nullable().optional(),
  monitorHourUtc: z.number().int().optional(),
  monitorWeekday: z.number().int().optional(),
  monitorEnvironmentId: z.string().nullable().optional(),
  monitorDevices: z.array(z.string()).optional(),
  nextMonitorAt: dateTime.nullable().optional(),
  alertSettings: z.unknown().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Project = z.infer<typeof projectSchema>;

export const environmentSchema = z.object({
  id,
  organizationId: id,
  projectId: id,
  name: z.string().min(1).max(80),
  baseUrl: url,
  kind: environmentKindSchema.optional().default('PRODUCTION'),
  /** null = use the project's safety mode. */
  safetyMode: safetyModeSchema.nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Environment = z.infer<typeof environmentSchema>;

export const credentialSchema = z.object({
  id,
  organizationId: id,
  projectId: id,
  name: z.string().min(1).max(120),
  type: credentialTypeSchema,
  username: z.string().min(1).max(320),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Credential = z.infer<typeof credentialSchema>;

export const runSchema = z.object({
  id,
  organizationId: id,
  projectId: id,
  environmentId: id.nullable(),
  status: runStatusSchema,
  errorMessage: z.string().nullable(),
  createdById: id,
  queueJobId: z.string().nullable().optional(),
  currentUrl: z.string().nullable(),
  currentAction: z.string().nullable(),
  pagesDiscovered: z.number().int().nonnegative(),
  statesDiscovered: z.number().int().nonnegative(),
  actionsExecuted: z.number().int().nonnegative(),
  flowsDiscovered: z.number().int().nonnegative(),
  lastScreenshotKey: z.string().nullable(),
  storageStateKey: z.string().nullable().optional(),
  aiCostUsd: z.number().nonnegative().optional(),
  browserDurationMs: z.number().int().nonnegative().optional(),
  storageBytesEstimate: z.number().int().nonnegative().optional(),
  qualityScore: z.number().min(0).max(100).nullable().optional(),
  testsGenerated: z.number().int().nonnegative().optional(),
  testsPassed: z.number().int().nonnegative().optional(),
  testsFailed: z.number().int().nonnegative().optional(),
  testsFlaky: z.number().int().nonnegative().optional(),
  baseUrlOverride: z.string().nullable().optional(),
  effectiveSafetyMode: safetyModeSchema.nullable().optional(),
  replayOfRunId: z.string().nullable().optional(),
  previousRunId: z.string().nullable().optional(),
  trigger: z.string().optional(),
  device: z.string().optional(),
  shareToken: z.string().nullable().optional(),
  sharedAt: dateTime.nullable().optional(),
  startedAt: dateTime.nullable(),
  completedAt: dateTime.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Run = z.infer<typeof runSchema>;

export const runStageSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  name: z.string().min(1).max(80),
  status: runStageStatusSchema,
  errorMessage: z.string().nullable(),
  startedAt: dateTime.nullable(),
  completedAt: dateTime.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type RunStage = z.infer<typeof runStageSchema>;

export const pageSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  projectId: id,
  url: url,
  title: z.string().max(500).nullable(),
  screenshotKey: z.string().max(512).nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Page = z.infer<typeof pageSchema>;

export const stateSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  pageId: id,
  name: z.string().min(1).max(160),
  fingerprint: z.string().min(1).max(128),
  url: z.string().max(2048).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  screenshotKey: z.string().max(512).nullable().optional(),
  visited: z.boolean().optional(),
  depth: z.number().int().nonnegative().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type State = z.infer<typeof stateSchema>;

export const stateEdgeSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  fromStateId: id,
  toStateId: id,
  actionId: id.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type StateEdge = z.infer<typeof stateEdgeSchema>;

export const actionSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  type: z.string().min(1).max(80),
  selector: z.string().max(1000).nullable(),
  value: z.string().max(4000).nullable(),
  target: z.string().max(1000).nullable().optional(),
  input: z.string().max(4000).nullable().optional(),
  sourceStateId: id.nullable().optional(),
  destinationStateId: id.nullable().optional(),
  success: z.boolean().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  riskLevel: actionRiskSchema.optional(),
  reason: z.string().max(2000).nullable().optional(),
  label: z.string().max(240).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  href: z.string().max(2048).nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Action = z.infer<typeof actionSchema>;

export const runEventSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  kind: z.string().min(1).max(80),
  message: z.string().min(1).max(2000),
  url: z.string().max(2048).nullable(),
  createdAt: dateTime,
});
export type RunEvent = z.infer<typeof runEventSchema>;

export const flowSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  projectId: id,
  name: z.string().min(1).max(160),
  description: z.string().max(4000).nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Flow = z.infer<typeof flowSchema>;

export const testCaseSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  projectId: id,
  flowId: id.nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable(),
  category: testCategorySchema.optional(),
  priority: testPrioritySchema.optional(),
  risk: actionRiskSchema.optional(),
  promptVersion: z.string().max(80).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  promptTokens: z.number().int().nullable().optional(),
  completionTokens: z.number().int().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
  estimatedCostUsd: z.number().nullable().optional(),
  preconditions: z.unknown().optional(),
  steps: z.unknown().optional(),
  expectedResults: z.unknown().optional(),
  testKey: z.string().nullable().optional(),
  source: z.string().optional(),
  intentId: z.string().nullable().optional(),
  quarantined: z.boolean().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type TestCase = z.infer<typeof testCaseSchema>;

export const testRunSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  testCaseId: id,
  status: z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'ERROR']),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nullable().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  failureClass: failureClassSchema.nullable().optional(),
  screenshotBeforeKey: z.string().nullable().optional(),
  screenshotFailureKey: z.string().nullable().optional(),
  screenshotAfterKey: z.string().nullable().optional(),
  traceKey: z.string().nullable().optional(),
  videoKey: z.string().nullable().optional(),
  consoleKey: z.string().nullable().optional(),
  networkKey: z.string().nullable().optional(),
  assertions: z.unknown().optional(),
  actualResults: z.unknown().optional(),
  startedAt: dateTime.nullable(),
  completedAt: dateTime.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type TestRun = z.infer<typeof testRunSchema>;

export const findingSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  projectId: id,
  testRunId: id.nullable(),
  pageId: id.nullable(),
  duplicateOfId: id.nullable().optional(),
  title: z.string().min(1).max(240),
  description: z.string().min(1),
  severity: findingSeveritySchema,
  status: findingStatusSchema,
  category: findingCategorySchema,
  confidence: z.number().min(0).max(1).optional(),
  expected: z.string().nullable().optional(),
  actual: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  rootCauseHypothesis: z.string().nullable().optional(),
  mergedCount: z.number().int().positive().optional(),
  change: findingChangeSchema.optional(),
  suppressed: z.boolean().optional(),
  ticketProvider: z.string().nullable().optional(),
  ticketUrl: z.string().nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Finding = z.infer<typeof findingSchema>;

export const evidenceSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  findingId: id.nullable(),
  testRunId: id.nullable().optional(),
  type: evidenceTypeSchema,
  storageKey: z.string().min(1).max(512),
  contentType: z.string().min(1).max(160),
  fileName: z.string().max(260).nullable(),
  byteLength: z.number().int().nonnegative().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const reportSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  projectId: id,
  qualityScore: z.number().min(0).max(100).nullable(),
  summary: z.string().nullable(),
  payload: z.unknown().optional(),
  promptVersion: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Report = z.infer<typeof reportSchema>;

export const aiUsageSchema = z.object({
  id,
  organizationId: id,
  runId: id,
  purpose: z.string().min(1).max(80),
  promptVersion: z.string().nullable().optional(),
  model: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  createdAt: dateTime,
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
