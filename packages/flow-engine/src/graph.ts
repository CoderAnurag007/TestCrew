import type { ActionRisk, CandidateAction } from '@auditor/shared';

export interface GraphState {
  id: string;
  fingerprint: string;
  url: string;
  title: string;
  screenshotKey?: string | null;
  metadata?: Record<string, unknown>;
  visited: boolean;
  depth: number;
  availableActionKeys: string[];
}

export interface GraphAction {
  id: string;
  type: string;
  target: string;
  input?: string | null;
  sourceStateId: string;
  destinationStateId?: string | null;
  success?: boolean;
  durationMs?: number | null;
  riskLevel: ActionRisk;
  reason?: string | null;
  stableKey: string;
}

export interface GraphEdge {
  sourceStateId: string;
  destinationStateId: string;
  actionId: string;
}

export interface CoverageReport {
  statesDiscovered: number;
  statesVisited: number;
  actionsDiscovered: number;
  actionsExecuted: number;
  coverage: number;
}

let nextId = 0;
function id(prefix: string): string {
  nextId += 1;
  return `${prefix}_${nextId}`;
}

export class StateGraph {
  private readonly states = new Map<string, GraphState>();
  private readonly statesById = new Map<string, GraphState>();
  private readonly actions: GraphAction[] = [];
  private readonly edges: GraphEdge[] = [];

  addState(input: Omit<GraphState, 'id' | 'visited' | 'availableActionKeys'> & Partial<Pick<GraphState, 'visited' | 'availableActionKeys' | 'id'>>): GraphState {
    const existing = this.states.get(input.fingerprint);
    if (existing) {
      if (input.depth < existing.depth) {
        existing.depth = input.depth;
      }
      return existing;
    }
    const state: GraphState = {
      id: input.id ?? id('state'),
      fingerprint: input.fingerprint,
      url: input.url,
      title: input.title,
      screenshotKey: input.screenshotKey,
      metadata: input.metadata,
      visited: input.visited ?? false,
      depth: input.depth,
      availableActionKeys: input.availableActionKeys ?? [],
    };
    this.states.set(state.fingerprint, state);
    this.statesById.set(state.id, state);
    return state;
  }

  addTransition(input: {
    sourceState: GraphState;
    destinationState: GraphState;
    action: Omit<GraphAction, 'id' | 'sourceStateId' | 'destinationStateId'> & Partial<Pick<GraphAction, 'id'>>;
  }): { action: GraphAction; edge: GraphEdge } {
    const action: GraphAction = {
      id: input.action.id ?? id('action'),
      type: input.action.type,
      target: input.action.target,
      input: input.action.input,
      sourceStateId: input.sourceState.id,
      destinationStateId: input.destinationState.id,
      success: input.action.success,
      durationMs: input.action.durationMs,
      riskLevel: input.action.riskLevel,
      reason: input.action.reason,
      stableKey: input.action.stableKey,
    };
    this.actions.push(action);
    const edge: GraphEdge = {
      sourceStateId: input.sourceState.id,
      destinationStateId: input.destinationState.id,
      actionId: action.id,
    };
    this.edges.push(edge);
    input.sourceState.visited = true;
    return { action, edge };
  }

  hasState(fingerprint: string): boolean {
    return this.states.has(fingerprint);
  }

  getState(fingerprint: string): GraphState | undefined {
    return this.states.get(fingerprint);
  }

  getStateById(idValue: string): GraphState | undefined {
    return this.statesById.get(idValue);
  }

  markVisited(fingerprint: string, availableActionKeys: string[] = []): GraphState | undefined {
    const state = this.states.get(fingerprint);
    if (!state) {
      return undefined;
    }
    state.visited = true;
    if (availableActionKeys.length > 0) {
      state.availableActionKeys = availableActionKeys;
    }
    return state;
  }

  getUnvisitedStates(): GraphState[] {
    return [...this.states.values()].filter((state) => !state.visited);
  }

  getAvailableActions(stateId: string, catalog: CandidateAction[]): CandidateAction[] {
    const state = this.statesById.get(stateId);
    if (!state) {
      return [];
    }
    if (state.availableActionKeys.length === 0) {
      return catalog;
    }
    const allowed = new Set(state.availableActionKeys);
    return catalog.filter((action) => allowed.has(action.stableKey));
  }

  calculateCoverage(): CoverageReport {
    const statesDiscovered = this.states.size;
    const statesVisited = [...this.states.values()].filter((state) => state.visited).length;
    const actionsDiscovered = [...this.states.values()].reduce(
      (sum, state) => sum + state.availableActionKeys.length,
      0,
    );
    const actionsExecuted = this.actions.filter((action) => action.success).length;
    const coverage = statesDiscovered === 0 ? 0 : statesVisited / statesDiscovered;
    return {
      statesDiscovered,
      statesVisited,
      actionsDiscovered,
      actionsExecuted,
      coverage,
    };
  }

  listStates(): GraphState[] {
    return [...this.states.values()];
  }

  listEdges(): GraphEdge[] {
    return [...this.edges];
  }

  listActions(): GraphAction[] {
    return [...this.actions];
  }
}

export class GraphBuilder {
  constructor(private readonly graph = new StateGraph()) {}

  getGraph(): StateGraph {
    return this.graph;
  }
}

export class CoverageCalculator {
  calculate(graph: StateGraph): CoverageReport {
    return graph.calculateCoverage();
  }
}
