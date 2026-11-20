import { createHash } from 'node:crypto';
import type { CandidateAction, ExplorerDecision, SemanticPage } from '@auditor/shared';

export interface ExplorerLike {
  choose(input: {
    page: SemanticPage;
    actions: CandidateAction[];
    blockedKeys?: Set<string>;
    preferKeys?: Set<string>;
  }): Promise<ExplorerDecision>;
}

export interface RecordedDecision {
  key: string;
  chosenStableKey: string | null;
  reason: string;
}

/**
 * Records every exploration decision so a run can be replayed exactly, and
 * replays a recording when one is supplied. A decision is keyed by the screen
 * and the set of actions available on it; when the same situation comes up
 * again during replay, the recorded choice is reused without calling the model.
 * Unknown situations fall through to the wrapped explorer.
 */
export class RecordingExplorer implements ExplorerLike {
  readonly recorded: RecordedDecision[] = [];
  private readonly replay: Map<string, RecordedDecision[]>;
  replayHits = 0;
  replayMisses = 0;

  constructor(
    private readonly inner: ExplorerLike,
    replay: RecordedDecision[] = [],
  ) {
    this.replay = new Map();
    for (const item of replay) {
      const list = this.replay.get(item.key) ?? [];
      list.push(item);
      this.replay.set(item.key, list);
    }
  }

  async choose(input: Parameters<ExplorerLike['choose']>[0]): Promise<ExplorerDecision> {
    const key = decisionKey(input.page, input.actions);
    const queued = this.replay.get(key);
    const recorded = queued?.shift();
    if (recorded) {
      const action = input.actions.find((item) => item.stableKey === recorded.chosenStableKey);
      if (action || recorded.chosenStableKey === null) {
        this.replayHits += 1;
        const decision: ExplorerDecision = {
          chosenActionId: action?.id ?? null,
          reason: `Replayed: ${recorded.reason}`.slice(0, 500),
          priority: 0,
          riskLevel: action?.riskLevel ?? 'SAFE',
        };
        this.recorded.push({ key, chosenStableKey: recorded.chosenStableKey, reason: recorded.reason });
        return decision;
      }
    }
    if (this.replay.size > 0) {
      this.replayMisses += 1;
    }
    const decision = await this.inner.choose(input);
    const chosen = input.actions.find((item) => item.id === decision.chosenActionId);
    this.recorded.push({ key, chosenStableKey: chosen?.stableKey ?? null, reason: decision.reason });
    return decision;
  }
}

export function decisionKey(page: SemanticPage, actions: CandidateAction[]): string {
  let route = page.route;
  try {
    route = route || new URL(page.url).pathname;
  } catch {
    /* keep route */
  }
  const keys = actions.map((action) => action.stableKey).sort().join('\n');
  return createHash('sha256').update(`${route}\n${keys}`).digest('hex').slice(0, 32);
}
