import type { BoundingBox, SemanticPage } from '@auditor/shared';

export const VIEWPORT_PROFILES = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export interface VisualIssue {
  title: string;
  description: string;
  recommendation: string;
  url: string;
  confidence: number;
  viewport?: keyof typeof VIEWPORT_PROFILES;
}

export class VisualAnalyzer {
  analyze(
    pages: SemanticPage[],
    options: { viewport?: keyof typeof VIEWPORT_PROFILES } = {},
  ): VisualIssue[] {
    const viewport = VIEWPORT_PROFILES[options.viewport ?? 'desktop'];
    const issues: VisualIssue[] = [];
    for (const page of pages) {
      const boxes = page.elements
        .map((element) => ({ element, box: element.boundingBox }))
        .filter((item): item is { element: SemanticPage['elements'][number]; box: BoundingBox } => Boolean(item.box));

      for (const { element, box } of boxes) {
        if (box.width <= 1 || box.height <= 1) {
          continue;
        }
        if (box.x + box.width > viewport.width + 8 && element.visible) {
          issues.push({
            title: 'Horizontal overflow',
            description: `${element.label ?? element.type} extends past the ${options.viewport ?? 'desktop'} viewport on ${page.url}.`,
            recommendation: 'Constrain width or allow wrapping so content stays within the viewport.',
            url: page.url,
            confidence: 0.7,
            viewport: options.viewport ?? 'desktop',
          });
        }
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const left = boxes[i];
          const right = boxes[j];
          if (!left || !right || !left.element.visible || !right.element.visible) {
            continue;
          }
          if (!isInteractive(left.element.type) || !isInteractive(right.element.type)) {
            continue;
          }
          if (overlaps(left.box, right.box)) {
            issues.push({
              title: 'Overlapping interactive elements',
              description: `${left.element.label ?? left.element.type} overlaps ${right.element.label ?? right.element.type} on ${page.url}.`,
              recommendation: 'Separate the controls so click targets do not collide.',
              url: page.url,
              confidence: 0.66,
              viewport: options.viewport ?? 'desktop',
            });
          }
        }
      }
    }
    return uniqueVisual(issues);
  }
}

function isInteractive(type: string): boolean {
  return ['button', 'link', 'input', 'select'].includes(type);
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const overlapX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const area = overlapX * overlapY;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return area > 24 && minArea > 0 && area / minArea > 0.35;
}

function uniqueVisual(issues: VisualIssue[]): VisualIssue[] {
  const seen = new Set<string>();
  const out: VisualIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.title}|${issue.url}|${issue.viewport ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
}
