import { z } from 'zod';

export const AUDIT_QUEUE_NAME = 'audit';
export const EXPLORATION_QUEUE_NAME = 'exploration';

export const START_AUDIT_JOB = 'START_AUDIT';
export const DISCOVER_APPLICATION_JOB = 'DISCOVER_APPLICATION';
export const EXPLORE_STATE_JOB = 'EXPLORE_STATE';

export const auditJobDataSchema = z.object({
  runId: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
export type AuditJobData = z.infer<typeof auditJobDataSchema>;

export const discoverJobDataSchema = auditJobDataSchema.extend({
  storageStateKey: z.string().min(1).optional(),
});
export type DiscoverJobData = z.infer<typeof discoverJobDataSchema>;

export const exploreStateJobDataSchema = discoverJobDataSchema.extend({
  stateId: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
});
export type ExploreStateJobData = z.infer<typeof exploreStateJobDataSchema>;
