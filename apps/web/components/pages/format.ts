import { isLiveRunStatus, type RunStatus } from '@auditor/shared';

/** React Query refetchInterval for run lists: poll every 5 s while any run is still going. */
export function refetchWhileRunning(query: { state: { data?: Array<{ status: RunStatus }> } }): number | false {
  return (query.state.data ?? []).some((run) => isLiveRunStatus(run.status)) ? 5_000 : false;
}

/** "3m ago", "2h ago", "Mar 4" style timestamps. */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) {
    return '–';
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return '–';
  }
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}

export function fullDate(value: string | Date | null | undefined): string {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString();
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function durationLabel(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  if (!start || !end) {
    return '–';
  }
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '–';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Newest first. */
export function byNewest<T extends { createdAt: string | Date }>(a: T, b: T): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
