import { DISCOVER_APPLICATION_JOB, EXPLORE_STATE_JOB, START_AUDIT_JOB, type AuditJobData } from '@auditor/shared';
import type { Job } from 'bullmq';
import { executeAuditRun, processDiscoverJob, processExploreStateJob, type AuditDependencies } from '../engine.js';

export async function handleAuditJob(deps: AuditDependencies, job: Job<AuditJobData>): Promise<void> {
  if (job.name !== START_AUDIT_JOB && job.name !== 'audit') {
    return;
  }
  await executeAuditRun(deps, job.data);
}

export async function handleExplorationJob(deps: AuditDependencies, job: Job<AuditJobData>): Promise<void> {
  if (job.name === DISCOVER_APPLICATION_JOB) {
    await processDiscoverJob(deps, job.data);
    return;
  }
  if (job.name === EXPLORE_STATE_JOB) {
    await processExploreStateJob(deps, job.data);
  }
}
