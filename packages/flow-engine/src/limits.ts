import type { ExplorationLimits } from '@auditor/shared';

export interface ExplorationProgress {
  pagesVisited: number;
  actionsExecuted: number;
  depth: number;
  startedAt: number;
}

export function shouldStopExploration(
  progress: ExplorationProgress,
  limits: ExplorationLimits,
): { stop: boolean; reason?: string } {
  if (progress.pagesVisited >= limits.maxPages) {
    return { stop: true, reason: 'max pages reached' };
  }
  if (progress.actionsExecuted >= limits.maxActions) {
    return { stop: true, reason: 'max actions reached' };
  }
  if (progress.depth >= limits.maxDepth) {
    return { stop: true, reason: 'max depth reached' };
  }
  if (Date.now() - progress.startedAt >= limits.maxDurationMs) {
    return { stop: true, reason: 'max duration reached' };
  }
  return { stop: false };
}
