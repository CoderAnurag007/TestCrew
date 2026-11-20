import type { FindingSeverity, RunStatus } from '@auditor/shared';
import type { RunDetail } from '@/lib/queries';

/* Small, dependency-free helpers shared by the run page components. */

export type RunFinding = RunDetail['findings'][number];

export const SEVERITY_ORDER: FindingSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info',
};

export function severityVariant(severity: FindingSeverity): 'critical' | 'high' | 'medium' | 'low' | 'muted' {
  switch (severity) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'muted';
  }
}

export const FAILURE_CLASS_LABELS: Record<string, string> = {
  APP_BUG: 'App bug',
  TEST_BUG: 'Needs repair',
  ENVIRONMENT: 'Environment',
  FLAKY: 'Flaky',
};

export const FINISHED_STATUSES: RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isFinished(status: RunStatus | undefined): boolean {
  return Boolean(status && FINISHED_STATUSES.includes(status));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function countOf(payload: Record<string, unknown>, key: string): number {
  const value = asRecord(payload.counts)[key];
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

export function isImageEvidence(item: { type: string; contentType: string; fileName?: string | null }): boolean {
  return (
    item.type === 'SCREENSHOT' || item.contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(item.fileName ?? '')
  );
}

export function asSteps(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return value ? [String(value)] : [];
  }
  return value.map((item) => {
    if (item && typeof item === 'object' && 'description' in item) {
      return String((item as { description: string }).description);
    }
    return String(item);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) {
    return '0s';
  }
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function relativeTime(value: string | Date, now: number): string {
  const diff = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(value).toLocaleDateString();
}

export function hostAndPath(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Download a blob under a file name without leaving an object URL behind. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Phase stepper: the user-facing journey of an audit. */

export const PHASES = ['Opening', 'Signing in', 'Exploring', 'Generating tests', 'Testing', 'Analyzing', 'Done'] as const;

export function phaseIndexForStatus(status: RunStatus): number {
  switch (status) {
    case 'QUEUED':
    case 'INITIALIZING':
      return 0;
    case 'AUTHENTICATING':
      return 1;
    case 'DISCOVERING':
    case 'EXPLORING':
    case 'FINALIZING':
      return 2;
    case 'GENERATING_TESTS':
      return 3;
    case 'EXECUTING_TESTS':
      return 4;
    case 'ANALYZING':
      return 5;
    case 'COMPLETED':
      return 6;
    default:
      return -1;
  }
}

/** For a failed or cancelled run, the phase it most likely stopped in, from what it left behind. */
export function stoppedPhaseIndex(run: Pick<RunDetail, 'stages' | 'testCases' | 'testRuns' | 'report'>): number {
  if (run.report) return 5;
  if (run.testRuns?.length) return 4;
  if (run.testCases?.length) return 3;
  const names = (run.stages ?? []).map((stage) => stage.name);
  if (names.some((name) => ['discover', 'explore', 'finalize'].includes(name))) return 2;
  if (names.includes('authenticate')) return 1;
  return 0;
}
