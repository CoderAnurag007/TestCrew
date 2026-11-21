import { renderHtmlReport, type HtmlReportFinding } from '@auditor/analyzer';
import { DESIGN_AREA_LABELS, DESIGN_AREAS, type DesignReport, type InteractionMap, type JourneyResult } from '@auditor/shared';
import { BrowserManager } from '@auditor/browser';
import type { AuditDependencies } from './engine.js';

const MAX_SCREENS = 24;
const MAX_FINDING_IMAGES = 2;

/**
 * Builds the self-contained HTML report for a finished run and stores it at
 * runs/<id>/report.html. Screenshots are shrunk to ~768px JPEGs (using the
 * browser we already ship) so a report with dozens of images stays a few MB.
 */
export async function buildHtmlReport(deps: Pick<AuditDependencies, 'prisma' | 'storage' | 'logger'>, runId: string): Promise<string | null> {
  const run = await deps.prisma.run.findUnique({
    where: { id: runId },
    include: {
      project: { select: { name: true, baseUrl: true, safetyMode: true } },
      report: true,
      findings: { include: { evidence: { where: { type: 'SCREENSHOT' }, take: MAX_FINDING_IMAGES } }, orderBy: { createdAt: 'asc' } },
      testCases: { include: { testRuns: true }, orderBy: { createdAt: 'asc' } },
      states: { select: { name: true, url: true, screenshotKey: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  const design = run?.designReport as DesignReport | null | undefined;
  const designOnly = Boolean(run && !run.bugAudit && design);
  if (!run || (!run.report && !designOnly)) {
    return null;
  }
  const report = run.report;
  const payload = (report?.payload ?? {}) as Record<string, unknown>;
  const breakdown = (payload.scoreBreakdown ?? {}) as { formula?: string; density?: number };
  const diff = payload.diff as
    | { previousRunId: string | null; counts: { new: number; recurring: number; regressed: number; fixed: number }; fixed: Array<{ title: string; severity: string }> }
    | undefined;
  const safety = payload.safety as { blockedCount: number; blockedSample?: Array<{ method: string; url: string; reason: string }> } | undefined;

  const seenScreens = new Set<string>();
  const screens = run.states.filter((state) => {
    const key = state.screenshotKey ?? state.url ?? '';
    if (!state.screenshotKey || seenScreens.has(key)) return false;
    seenScreens.add(key);
    return true;
  }).slice(0, MAX_SCREENS);
  const visible = run.findings.filter((finding) => !finding.suppressed);

  const journeys = (Array.isArray(payload.journeys) ? payload.journeys : []) as JourneyResult[];
  const journeyShotKeys = journeys
    .filter((journey) => journey.status !== 'passed')
    .flatMap((journey) => journey.steps.map((step) => step.screenshotKey).filter((key): key is string => Boolean(key)))
    .slice(0, 16);
  const keys = [
    ...journeyShotKeys,
    ...screens.map((screen) => screen.screenshotKey as string),
    ...visible.flatMap((finding) => finding.evidence.map((item) => item.storageKey)),
  ];
  const images = await shrinkImages(deps, [...new Set(keys)]);

  const findings: HtmlReportFinding[] = visible.map((finding) => ({
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    change: finding.change,
    description: finding.description,
    expected: finding.expected,
    actual: finding.actual,
    recommendation: finding.recommendation,
    url: finding.url,
    confidence: finding.confidence,
    steps: Array.isArray(finding.steps)
      ? (finding.steps as Array<{ description?: unknown }>).map((step) => String(step?.description ?? '')).filter(Boolean)
      : [],
    images: finding.evidence.map((item) => images.get(item.storageKey)).filter((item): item is string => Boolean(item)),
  }));

  const html = renderHtmlReport({
    generatedAt: new Date(),
    project: { name: run.project.name, baseUrl: run.baseUrlOverride ?? run.project.baseUrl },
    run: {
      id: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? new Date(),
      durationMs: run.startedAt ? Date.now() - run.startedAt.getTime() : null,
      mode: run.effectiveSafetyMode ?? 'READ_ONLY',
      requestedMode: run.project.safetyMode,
      trigger: run.trigger,
    },
    score: designOnly ? (run.designScore ?? 0) : (report?.qualityScore ?? 0),
    scoreFormula: breakdown.formula,
    density: breakdown.density,
    screensExplored: run.states.length,
    summary: report?.summary ?? design?.summary ?? '',
    diff: diff ?? null,
    findings,
    hiddenCount: run.findings.length - visible.length,
    screens: screens.map((screen) => ({ title: screen.name, url: screen.url ?? '', image: images.get(screen.screenshotKey as string) ?? null })),
    tests: run.testCases.map((test) => {
      const result = test.testRuns.at(-1);
      return {
        name: test.name,
        source: test.source,
        status: result?.status ?? 'PENDING',
        failureClass: result?.failureClass ?? null,
        error: result?.errorMessage ?? null,
        durationMs: result?.durationMs ?? null,
      };
    }),
    intents: Array.isArray(payload.intents)
      ? (payload.intents as Array<{ text: string; status: string; result?: string | null; reason?: string | null }>)
      : [],
    safety: safety ? { blockedCount: safety.blockedCount, sample: safety.blockedSample ?? [] } : null,
    links: (payload.links as { checked: number; broken: number; skippedUnsafe: number } | undefined) ?? null,
    aiCostUsd: run.aiCostUsd,
    model: report?.model && report.model !== 'heuristic' ? report.model : (design?.ai.model ?? null),
    design: design
      ? {
          score: design.score,
          areas: DESIGN_AREAS.map((area) => ({ label: DESIGN_AREA_LABELS[area], ...design.areas[area] })),
          summary: design.summary,
          strengths: design.strengths,
          pages: design.metrics.pagesReviewed,
          aiUsed: design.ai.used,
          only: designOnly,
        }
      : null,
    context: (() => {
      const category = payload.category as { used?: string; detected?: string } | undefined;
      const environment = payload.environment as { kind?: string; transactionsReason?: string; paymentReason?: string } | undefined;
      return category && environment
        ? {
            category: category.used ?? 'generic',
            detectedCategory: category.detected,
            environmentKind: environment.kind ?? 'PRODUCTION',
            transactionsReason: environment.transactionsReason ?? '',
            paymentReason: environment.paymentReason ?? '',
          }
        : null;
    })(),
    journeys: journeys.map((journey) => ({
      name: journey.name,
      category: journey.category,
      requires: journey.requires,
      status: journey.status,
      reason: journey.reason,
      steps: journey.steps.map((step) => ({
        goal: step.goal,
        status: step.status,
        detail: step.detail,
        checks: step.checks,
        image: step.screenshotKey ? (images.get(step.screenshotKey) ?? null) : null,
      })),
    })),
    interactions: (payload.interactions as InteractionMap | null | undefined) ?? null,
  });
  const key = `runs/${runId}/report.html`;
  await deps.storage.put({ key, body: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8' });
  return key;
}

async function shrinkImages(deps: Pick<AuditDependencies, 'storage' | 'logger'>, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const manager = new BrowserManager();
  try {
    const context = await manager.createContext({ viewport: { width: 768, height: 432 } });
    const page = await context.newPage();
    for (const key of keys) {
      try {
        const original = await deps.storage.get(key);
        const type = key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
        await page.setContent(
          `<html><body style="margin:0;background:#fff"><img id="i" style="display:block;width:768px;height:auto" src="data:${type};base64,${original.toString('base64')}"></body></html>`,
        );
        const image = page.locator('#i');
        await image.evaluate((element) => (element as unknown as { decode: () => Promise<void> }).decode().catch(() => undefined));
        const box = await image.boundingBox();
        const height = Math.max(1, Math.min(Math.round(box?.height ?? 432), 1600));
        await page.setViewportSize({ width: 768, height });
        const jpeg = await image.screenshot({ type: 'jpeg', quality: 70 });
        out.set(key, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
      } catch (error) {
        deps.logger.warn({ key, err: error }, 'could not embed screenshot in report');
      }
    }
  } finally {
    await manager.close().catch(() => undefined);
  }
  return out;
}
