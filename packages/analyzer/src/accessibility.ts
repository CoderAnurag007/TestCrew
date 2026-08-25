import type { SemanticPage } from '@auditor/shared';

export interface AccessibilityIssue {
  title: string;
  description: string;
  recommendation: string;
  url: string;
  component?: string;
  confidence: number;
}

export class AccessibilityAnalyzer {
  analyze(pages: Array<{ url: string; html?: string | null; semantic?: SemanticPage | null }>): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    for (const page of pages) {
      const html = page.html ?? '';
      const images = [...html.matchAll(/<img\b([^>]*)>/gi)];
      for (const match of images) {
        const attrs = match[1] ?? '';
        if (!/\balt\s*=/i.test(attrs)) {
          issues.push({
            title: 'Image missing alternative text',
            description: `An image on ${page.url} has no alt attribute.`,
            recommendation: 'Add a descriptive alt attribute, or alt="" if the image is decorative.',
            url: page.url,
            component: 'img',
            confidence: 0.9,
          });
        }
      }

      const inputs = [...html.matchAll(/<input\b([^>]*)>/gi)];
      for (const match of inputs) {
        const attrs = match[1] ?? '';
        const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1] ?? 'text';
        if (['hidden', 'submit', 'button', 'image'].includes(type.toLowerCase())) {
          continue;
        }
        const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
        const aria = /\baria-label=/i.test(attrs);
        const labelled = id ? new RegExp(`<label[^>]+for=["']${id}["']`, 'i').test(html) : false;
        if (!aria && !labelled && !/\baria-labelledby=/i.test(attrs)) {
          const name = attrs.match(/\bname=["']([^"']+)["']/i)?.[1];
          issues.push({
            title: 'Form control missing accessible name',
            description: `An input${name ? ` named ${name}` : ''} on ${page.url} has no associated label.`,
            recommendation: 'Associate a visible label with the control using for/id or wrap the input in a label.',
            url: page.url,
            component: name ?? 'input',
            confidence: 0.84,
          });
        }
      }

      const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
      for (const match of buttons) {
        const attrs = match[1] ?? '';
        const text = strip(match[2] ?? '');
        if (!text && !/\baria-label=/i.test(attrs)) {
          issues.push({
            title: 'Button missing accessible name',
            description: `A button on ${page.url} has no visible text or aria-label.`,
            recommendation: 'Give every button a text label or an aria-label that describes the action.',
            url: page.url,
            component: 'button',
            confidence: 0.88,
          });
        }
      }

      for (const element of page.semantic?.elements ?? []) {
        if ((element.role === 'button' || element.type === 'button') && !element.selectors.accessibleName && !element.text && !element.label) {
          issues.push({
            title: 'Interactive control missing accessible name',
            description: `A ${element.role ?? element.type} on ${page.url} has no accessible name.`,
            recommendation: 'Expose an accessible name through visible text, aria-label, or a labelled form control.',
            url: page.url,
            component: element.selectors.primary,
            confidence: 0.8,
          });
        }
      }
    }
    return uniqueIssues(issues);
  }
}

function strip(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function uniqueIssues(issues: AccessibilityIssue[]): AccessibilityIssue[] {
  const seen = new Set<string>();
  const out: AccessibilityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.title}|${issue.url}|${issue.component ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
}
