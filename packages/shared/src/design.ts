import { z } from 'zod';

/**
 * Design review: an optional part of an audit that looks at how the site looks
 * and reads, from screenshots and measurements, instead of whether it works.
 */

export const DESIGN_AREAS = ['visual', 'layout', 'readability', 'accessibility', 'phone', 'consistency'] as const;
export type DesignArea = (typeof DESIGN_AREAS)[number];

export const DESIGN_AREA_LABELS: Record<DesignArea, string> = {
  visual: 'Visual design',
  layout: 'Layout',
  readability: 'Readability',
  accessibility: 'Accessibility',
  phone: 'Phone',
  consistency: 'Consistency',
};

/** Prefix of every design review finding's signature. */
export const DESIGN_SIGNATURE_PREFIX = 'design|';
/** Design review findings keep their area in `component` as `design:<area>`. */
export const DESIGN_COMPONENT_PREFIX = 'design:';

export function isDesignFinding(finding: { signature?: string | null; component?: string | null }): boolean {
  return Boolean(finding.signature?.startsWith(DESIGN_SIGNATURE_PREFIX) || finding.component?.startsWith(DESIGN_COMPONENT_PREFIX));
}

export function designAreaOf(finding: { component?: string | null }): DesignArea | null {
  const area = finding.component?.startsWith(DESIGN_COMPONENT_PREFIX) ? finding.component.slice(DESIGN_COMPONENT_PREFIX.length) : '';
  return (DESIGN_AREAS as readonly string[]).includes(area) ? (area as DesignArea) : null;
}

/** Maps the words a model uses for an area onto one of ours. */
export function normalizeDesignArea(value: string): DesignArea {
  const text = value.toLowerCase();
  if (/access|contrast|a11y|label|alt/.test(text)) return 'accessibility';
  if (/phone|mobile|responsive|touch/.test(text)) return 'phone';
  if (/read|typo|font|copy|text|content/.test(text)) return 'readability';
  if (/consist|brand|style/.test(text)) return 'consistency';
  if (/layout|spac|align|hierarch|structure|whitespace|grid/.test(text)) return 'layout';
  return 'visual';
}

const severity = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(['HIGH', 'MEDIUM', 'LOW']))
  .catch('LOW');

export const designAiIssueSchema = z.object({
  area: z.string().default('visual'),
  severity,
  title: z.string().min(3).max(200),
  problem: z.string().min(3).max(1200),
  fix: z.string().min(3).max(1200),
  evidence: z.string().min(3).max(600),
  /** Which screenshot the issue is in: 1 desktop first screen, 2 phone first screen, 3 desktop full page. */
  image: z.coerce.number().int().min(1).max(3).catch(1),
  /** Where in that screenshot, as [ymin, xmin, ymax, xmax] on a 0–1000 scale. */
  box: z.array(z.coerce.number()).length(4).optional().catch(undefined),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});
export type DesignAiIssue = z.infer<typeof designAiIssueSchema>;

export const designAiReviewSchema = z.object({
  summary: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  issues: z.array(z.unknown()).default([]),
});

/** A highlighted spot on a stored screenshot, as fractions (0–1) of its width and height. */
export type DesignMark = { x: number; y: number; w: number; h: number };

export type DesignPageShot = {
  url: string;
  title: string | null;
  /** Evidence ids of the stored full-page screenshots. */
  desktop: string | null;
  phone: string | null;
};

export type DesignReport = {
  version: 1;
  score: number;
  areas: Record<DesignArea, { score: number; issues: number }>;
  summary: string | null;
  strengths: string[];
  pages: DesignPageShot[];
  /** Per finding: where it shows on which page's screenshot. */
  marks: Record<string, Array<{ url: string; shot: 'desktop' | 'phone'; boxes: DesignMark[] }>>;
  metrics: {
    pagesReviewed: number;
    layoutShift: number | null;
    typefaces: string[];
    fontSizes: number;
    buttonStyles: number;
  };
  ai: { used: boolean; model: string | null; error: string | null };
};

const PENALTY: Record<string, number> = { CRITICAL: 25, HIGH: 18, MEDIUM: 9, LOW: 4, INFO: 0 };

/** Scores each area from its issues (100 = nothing found) and the whole design as their average. */
export function scoreDesign(issues: Array<{ area: DesignArea; severity: string }>): Pick<DesignReport, 'score' | 'areas'> {
  const areas = Object.fromEntries(DESIGN_AREAS.map((area) => [area, { score: 100, issues: 0 }])) as DesignReport['areas'];
  for (const issue of issues) {
    const entry = areas[issue.area];
    entry.issues += 1;
    entry.score = Math.max(0, entry.score - (PENALTY[issue.severity] ?? 4));
  }
  const score = Math.round(DESIGN_AREAS.reduce((sum, area) => sum + areas[area].score, 0) / DESIGN_AREAS.length);
  return { score, areas };
}

/** WCAG contrast ratio between two sRGB colours given as [r, g, b] (0–255). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, bl] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}
