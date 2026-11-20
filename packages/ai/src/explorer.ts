import {
  explorerDecisionSchema,
  type CandidateAction,
  type ExplorerDecision,
  type SemanticPage,
} from '@auditor/shared';
import { prioritizeActions, priorityForAction } from '@auditor/flow-engine';
import { parseJsonContent } from './gemini.js';
import type { ModelRouter } from './router.js';

export class ExplorerAgent {
  constructor(private readonly router: ModelRouter) {}

  async choose(input: {
    page: SemanticPage;
    actions: CandidateAction[];
    blockedKeys?: Set<string>;
    preferKeys?: Set<string>;
  }): Promise<ExplorerDecision> {
    const available = input.actions.filter((action) => !input.blockedKeys?.has(action.stableKey));
    if (available.length === 0) {
      return {
        chosenActionId: null,
        reason: 'No remaining actions in the observation layer',
        priority: 0,
        riskLevel: 'SAFE',
      };
    }

    if (this.router.current().name === 'heuristic') {
      return this.heuristic(available, input.preferKeys);
    }

    try {
      const completion = await this.router.complete({
        messages: [
          {
            role: 'system',
            content:
              'You choose the next UI action for an application auditor that must cover every sidebar destination. Prefer newly revealed submenu items, then collapsed menu groups (expand parent before children), then nested leaves, and only then unrelated page buttons. Never invent ids. Never keep selecting Home/Dashboard if other menu nodes remain. Never return chosenActionId null while any menu or navigation action remains. Respond with JSON: { "chosenActionId": string|null, "reason": string, "priority": number, "riskLevel": "SAFE"|"CAUTION"|"DESTRUCTIVE" }',
          },
          {
            role: 'user',
            content: JSON.stringify({
              page: {
                url: input.page.url,
                title: input.page.title,
                route: input.page.route,
                modalOpen: input.page.modalOpen,
                // Large pages (stores, catalogs) have thousands of elements; the choice
                // only needs the visible ones, and a smaller prompt answers much faster.
                elements: input.page.elements.filter((element) => element.visible && element.enabled).slice(0, 120).map((element) => ({
                  id: element.id,
                  type: element.type,
                  role: element.role,
                  text: element.text,
                  label: element.label,
                  name: element.name,
                  visible: element.visible,
                  enabled: element.enabled,
                })),
              },
              actions: available.slice(0, 80).map((action) => ({
                id: action.id,
                type: action.type,
                label: action.label,
                category: action.category,
                href: action.href,
                preferred: Boolean(input.preferKeys?.has(action.stableKey)),
                riskLevel: action.riskLevel,
                target: action.target,
              })),
            }),
          },
        ],
        temperature: 0,
        maxTokens: 400,
        timeoutMs: 20_000,
        retries: 1,
      });
      const parsed = explorerDecisionSchema.parse(parseJsonContent(completion.content));
      if (!parsed.chosenActionId || !available.some((action) => action.id === parsed.chosenActionId)) {
        return this.heuristic(available, input.preferKeys);
      }
      return parsed;
    } catch {
      return this.heuristic(available, input.preferKeys);
    }
  }

  private heuristic(actions: CandidateAction[], preferKeys?: Set<string>): ExplorerDecision {
    const ranked = prioritizeActions(actions, { preferKeys });
    const chosen = ranked[0];
    if (!chosen) {
      return {
        chosenActionId: null,
        reason: 'No actions available',
        priority: 0,
        riskLevel: 'SAFE',
      };
    }
    return {
      chosenActionId: chosen.id,
      reason: `Deterministic exploration prioritized ${chosen.category} action "${chosen.label}"`,
      priority: priorityForAction(chosen),
      riskLevel: chosen.riskLevel,
    };
  }
}
