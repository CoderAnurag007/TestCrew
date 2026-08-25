import { z } from 'zod';

export const membershipRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const credentialTypeSchema = z.enum(['USERNAME_PASSWORD']);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

export const runStatusSchema = z.enum([
  'QUEUED',
  'INITIALIZING',
  'AUTHENTICATING',
  'DISCOVERING',
  'EXPLORING',
  'FINALIZING',
  'GENERATING_TESTS',
  'EXECUTING_TESTS',
  'ANALYZING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runStageStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
export type RunStageStatus = z.infer<typeof runStageStatusSchema>;

export const findingSeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingStatusSchema = z.enum([
  'OPEN',
  'CONFIRMED',
  'IGNORED',
  'RESOLVED',
  'ACKNOWLEDGED',
  'DISMISSED',
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingCategorySchema = z.enum([
  'BUG',
  'UX',
  'ACCESSIBILITY',
  'SECURITY',
  'PERFORMANCE',
  'VISUAL',
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

export const testCategorySchema = z.enum([
  'HAPPY_PATH',
  'NEGATIVE',
  'VALIDATION',
  'BOUNDARY',
  'NAVIGATION',
  'ERROR_HANDLING',
  'PERMISSION',
  'EMPTY_STATE',
  'LOADING_STATE',
  'RESPONSIVE',
  'ACCESSIBILITY',
  'REGRESSION',
]);
export type TestCategory = z.infer<typeof testCategorySchema>;

export const testPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type TestPriority = z.infer<typeof testPrioritySchema>;

export const evidenceTypeSchema = z.enum(['SCREENSHOT', 'HTML', 'HAR', 'LOG', 'VIDEO', 'JSON']);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const actionRiskSchema = z.enum(['SAFE', 'CAUTION', 'DESTRUCTIVE']);
export type ActionRisk = z.infer<typeof actionRiskSchema>;

export const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasMinRole(role: MembershipRole, minimum: MembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export const LIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'QUEUED',
  'INITIALIZING',
  'AUTHENTICATING',
  'DISCOVERING',
  'EXPLORING',
  'FINALIZING',
  'GENERATING_TESTS',
  'EXECUTING_TESTS',
  'ANALYZING',
]);

export function isLiveRunStatus(status: RunStatus): boolean {
  return LIVE_RUN_STATUSES.has(status);
}
