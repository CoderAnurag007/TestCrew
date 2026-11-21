import { designAiIssueSchema, designAiReviewSchema, type DesignAiIssue } from '@auditor/shared';
import { describeAiError } from './errors.js';
import { parseJsonContent } from './gemini.js';
import type { ModelRouter } from './router.js';

export const DESIGN_REVIEW_PROMPT_VERSION = 'design-review.v1';

export function designReviewPrompt(input: { url: string; title?: string | null; alreadyReported: string[]; measured: string[] }): string {
  return `You are a senior product designer reviewing one page of a live website for its owner.
Page: ${input.url}${input.title ? ` ("${input.title}")` : ''}

Screenshots, in order:
1. Desktop, first screen (1280 px wide)
2. Phone, first screen (390 px wide)
3. Desktop, whole page (scaled down)

Review what a visitor sees, using these principles:
- Visual hierarchy: is it obvious what the page is about and what to do next? Is the main call to action easy to spot?
- Layout: spacing, alignment, crowding, empty gaps, things that overlap or look broken.
- Readability: text size, line length, contrast against its background, walls of text.
- Consistency: buttons, colours, fonts and corners that look alike when they do the same thing.
- Phone: does the phone layout work, can things be tapped, is anything cut off or squeezed?
- Trust: does it look finished and credible (no placeholder text, broken images, odd stock leftovers)?

Rules:
- Only report problems you can clearly see in the screenshots. Never guess about things that are not visible.
- Each issue needs "evidence": where it is and what exactly you see (e.g. "Phone screenshot, top: the menu button overlaps the logo").
- "image" is the screenshot number the issue is in, and "box" is where, as [ymin, xmin, ymax, xmax] on a 0–1000 scale of that screenshot.
- Severity: HIGH only when it will likely stop visitors (main action hard to find, text unreadable, layout broken). MEDIUM for clear problems that look unprofessional or slow people down. LOW for polish.
- Be specific and practical in "fix": say what to change, not "improve the design".
- Report at most 6 issues, most important first. It is fine to report none.
- Judge the design, not the content: never comment on dates, prices, facts or spelling of names. Today is ${new Date().toISOString().slice(0, 10)}.
- A cookie or consent banner is a site-wide thing: mention it only if it badly covers the page, and only once for the whole site.
- Do not report these again; they are already known: ${input.alreadyReported.length ? input.alreadyReported.map((item) => `"${item}"`).join(', ') : 'none'}.
- Measured checks already cover: ${input.measured.length ? input.measured.join('; ') : 'nothing on this page'}. Do not repeat them.
- "strengths": up to 3 short things this page does well (plain words).

Respond with JSON only, exactly in this shape:
{ "summary": string (one or two sentences on the overall impression),
  "strengths": string[],
  "issues": [ {
    "area": "visual" | "layout" | "readability" | "accessibility" | "phone" | "consistency",
    "severity": "HIGH" | "MEDIUM" | "LOW",
    "title": string (short, plain language),
    "problem": string (what is wrong and why it matters to a visitor),
    "fix": string (what to change),
    "evidence": string,
    "image": 1 | 2 | 3,
    "box": [ymin, xmin, ymax, xmax],
    "confidence": number between 0 and 1
  } ] }`;
}

export type DesignPageReview = {
  summary: string;
  strengths: string[];
  issues: DesignAiIssue[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  error?: string;
};

/** Looks at a page's screenshots and reports what a designer would point out, with evidence. */
export class DesignReviewAgent {
  constructor(private readonly router: ModelRouter) {}

  available(): boolean {
    return this.router.current().name !== 'heuristic';
  }

  async reviewPage(input: {
    url: string;
    title?: string | null;
    screenshots: [Buffer, Buffer, Buffer];
    alreadyReported: string[];
    measured: string[];
  }): Promise<DesignPageReview> {
    const empty = { summary: '', strengths: [], issues: [], promptTokens: 0, completionTokens: 0, latencyMs: 0, estimatedCostUsd: 0 };
    if (!this.available()) return { ...empty, model: 'heuristic' };
    try {
      const [first, ...rest] = input.screenshots;
      const result = await this.router.analyzeImage({
        prompt: designReviewPrompt(input),
        imageBase64: first.toString('base64'),
        mimeType: 'image/jpeg',
        extraImages: rest.map((image) => ({ imageBase64: image.toString('base64'), mimeType: 'image/jpeg' })),
        json: true,
        maxTokens: 2400,
        timeoutMs: 60_000,
      });
      const parsed = designAiReviewSchema.parse(parseJsonContent(result.content));
      const issues = parsed.issues
        .map((item) => designAiIssueSchema.safeParse(item))
        .filter((item) => item.success)
        .map((item) => item.data)
        // A finding nobody can point at, or that the model doubts, is left out.
        .filter((item) => item.confidence >= 0.6 && item.evidence.trim().length >= 8)
        .slice(0, 6);
      return {
        summary: parsed.summary.trim(),
        strengths: parsed.strengths.map((item) => item.trim()).filter(Boolean).slice(0, 3),
        issues,
        model: result.model,
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        latencyMs: result.latencyMs ?? 0,
        estimatedCostUsd: result.estimatedCostUsd ?? 0,
      };
    } catch (error) {
      return { ...empty, model: `${this.router.current().name}:failed`, error: describeAiError(error) };
    }
  }
}
