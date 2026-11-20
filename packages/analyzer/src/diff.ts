import type { FindingSeverity } from '@auditor/shared';

export type FindingChangeKind = 'NEW' | 'RECURRING' | 'REGRESSED';

export interface DiffFinding {
  signature: string;
  title: string;
  severity: FindingSeverity;
  category: string;
  url?: string | null;
}

export interface RunDiff {
  previousRunId: string | null;
  /** Signature -> how this finding relates to earlier runs. */
  changes: Map<string, FindingChangeKind>;
  newFindings: DiffFinding[];
  recurring: DiffFinding[];
  regressed: DiffFinding[];
  fixed: DiffFinding[];
}

/**
 * Compares the current run's findings with the previous completed run of the
 * same project, and with every older run for regression detection.
 *
 * - NEW: never seen in any earlier run.
 * - RECURRING: present in the previous run too.
 * - REGRESSED: absent from the previous run but seen in some older run, i.e. it
 *   was fixed and came back.
 * - fixed: present in the previous run, absent now.
 */
export function diffRuns(input: {
  current: DiffFinding[];
  previous: DiffFinding[];
  previousRunId: string | null;
  olderSignatures?: Iterable<string>;
}): RunDiff {
  const previousBySig = new Map(input.previous.map((item) => [item.signature, item]));
  const older = new Set(input.olderSignatures ?? []);
  const currentSigs = new Set(input.current.map((item) => item.signature));
  const changes = new Map<string, FindingChangeKind>();
  const newFindings: DiffFinding[] = [];
  const recurring: DiffFinding[] = [];
  const regressed: DiffFinding[] = [];

  for (const finding of input.current) {
    if (changes.has(finding.signature)) {
      continue;
    }
    if (previousBySig.has(finding.signature)) {
      changes.set(finding.signature, 'RECURRING');
      recurring.push(finding);
    } else if (older.has(finding.signature)) {
      changes.set(finding.signature, 'REGRESSED');
      regressed.push(finding);
    } else {
      changes.set(finding.signature, 'NEW');
      newFindings.push(finding);
    }
  }

  const fixed = input.previous.filter((item) => !currentSigs.has(item.signature));
  return {
    previousRunId: input.previousRunId,
    changes,
    newFindings,
    recurring,
    regressed,
    fixed: dedupe(fixed),
  };
}

function dedupe(items: DiffFinding[]): DiffFinding[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.signature)) return false;
    seen.add(item.signature);
    return true;
  });
}

export function serializeDiff(diff: RunDiff) {
  const strip = (items: DiffFinding[]) =>
    items.map((item) => ({
      signature: item.signature,
      title: item.title,
      severity: item.severity,
      category: item.category,
      url: item.url ?? null,
    }));
  return {
    previousRunId: diff.previousRunId,
    counts: {
      new: diff.newFindings.length,
      recurring: diff.recurring.length,
      regressed: diff.regressed.length,
      fixed: diff.fixed.length,
    },
    new: strip(diff.newFindings),
    regressed: strip(diff.regressed),
    fixed: strip(diff.fixed),
    recurring: strip(diff.recurring),
  };
}
export type SerializedRunDiff = ReturnType<typeof serializeDiff>;
