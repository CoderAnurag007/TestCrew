import { chromium } from 'playwright';
import { contrastRatio, normalizeDesignArea, scoreDesign } from '@auditor/shared';
import { describe, expect, it } from 'vitest';
import { MEASURE_SCRIPT, type PageMeasurements } from '../src/design-measure.js';
import { aiBoxToMark, aiIssue, measuredIssues, toMark } from '../src/design-review.js';

function measure(overrides: Partial<PageMeasurements> = {}): PageMeasurements {
  return {
    docWidth: 1280,
    docHeight: 2000,
    viewportWidth: 1280,
    viewportHeight: 800,
    dpr: 1,
    contrast: [],
    smallText: [],
    tapTargets: [],
    overflow: [],
    blurryImages: [],
    stretchedImages: [],
    missingAlt: [],
    unlabeledFields: [],
    h1Count: 1,
    fonts: [{ family: 'Inter', count: 40 }],
    fontSizes: 6,
    buttonStyles: 2,
    ...overrides,
  };
}

function capture(overrides: Partial<PageMeasurements> = {}, fullHeight = 2000) {
  return { measure: measure(overrides), layoutShift: 0, firstScreen: Buffer.alloc(0), full: Buffer.alloc(0), fullHeight };
}

describe('design review scoring', () => {
  it('scores a clean site 100 and takes points off per area', () => {
    expect(scoreDesign([]).score).toBe(100);
    const scored = scoreDesign([
      { area: 'accessibility', severity: 'MEDIUM' },
      { area: 'accessibility', severity: 'LOW' },
      { area: 'phone', severity: 'HIGH' },
    ]);
    expect(scored.areas.accessibility).toEqual({ score: 87, issues: 2 });
    expect(scored.areas.phone.score).toBe(82);
    expect(scored.score).toBe(Math.round((87 + 82 + 400) / 6));
  });

  it('works out WCAG contrast', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([153, 153, 153], [255, 255, 255])).toBeCloseTo(2.85, 1);
  });

  it('maps loose area names', () => {
    expect(normalizeDesignArea('Mobile layout')).toBe('phone');
    expect(normalizeDesignArea('Visual hierarchy')).toBe('layout');
    expect(normalizeDesignArea('colour contrast')).toBe('accessibility');
    expect(normalizeDesignArea('Typography')).toBe('readability');
  });
});

describe('design review marks', () => {
  it('turns page pixels into fractions of the screenshot and drops boxes below it', () => {
    expect(toMark([128, 200, 256, 100], 1280, 2000)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.05 });
    expect(toMark([0, 2500, 100, 100], 1280, 2000)).toBeNull();
  });

  it('moves a first-screen AI box onto the full-page screenshot', () => {
    // Top half of an 800px first screen on a 4000px tall page = top tenth.
    expect(aiBoxToMark([0, 0, 500, 1000], 800, 4000, false)).toEqual({ x: 0, y: 0, w: 1, h: 0.1 });
    expect(aiBoxToMark([500, 0, 1000, 500], 800, 4000, true)).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(aiBoxToMark([600, 0, 500, 100], 800, 4000, false)).toBeNull();
  });

  it('keeps the AI issue on the phone screenshot it came from', () => {
    const issue = aiIssue(
      { url: 'https://shop.test/pricing', desktop: capture(), phone: capture({ viewportWidth: 412, viewportHeight: 839 }, 4195) },
      {
        area: 'Mobile',
        severity: 'MEDIUM',
        title: 'Menu button overlaps the logo',
        problem: 'The menu button sits on top of the logo.',
        fix: 'Give the header more room.',
        evidence: 'Phone screenshot, top: menu over logo',
        image: 2,
        box: [0, 0, 100, 1000],
        confidence: 0.8,
      },
    );
    expect(issue.area).toBe('phone');
    expect(issue.key).toBe('ai|phone|/pricing|menu-button-overlaps-the-logo');
    expect(issue.marks[0]).toMatchObject({ url: 'https://shop.test/pricing', shot: 'phone' });
    expect(issue.marks[0]!.boxes[0]!.h).toBeCloseTo(0.02, 2);
  });
});

describe('measured design issues', () => {
  it('reports nothing for a tidy site', () => {
    expect(measuredIssues([{ url: 'https://shop.test/', desktop: capture(), phone: capture({ viewportWidth: 412, docWidth: 412 }) }])).toEqual([]);
  });

  it('groups each kind of problem across pages into one issue', () => {
    const lowContrast = { text: 'Sign up', ratio: 2.1, need: 4.5, fg: '#aaaaaa', bg: '#ffffff', size: 14, box: [10, 10, 80, 20] as [number, number, number, number] };
    const tiny = { label: 'x', width: 16, height: 16, box: [0, 0, 16, 16] as [number, number, number, number] };
    const issues = measuredIssues([
      {
        url: 'https://shop.test/',
        desktop: capture({ contrast: [lowContrast], h1Count: 0 }),
        phone: capture({ viewportWidth: 412, docWidth: 600, tapTargets: [tiny, tiny, tiny] }),
      },
      { url: 'https://shop.test/about', desktop: capture({ contrast: [lowContrast] }), phone: capture({ viewportWidth: 412, docWidth: 412 }) },
    ]);
    const byKey = Object.fromEntries(issues.map((issue) => [issue.key, issue]));
    expect(Object.keys(byKey).sort()).toEqual(['contrast', 'no-heading', 'overflow', 'tap-targets']);
    expect(byKey.contrast!.description).toContain('on 2 pages');
    expect(byKey.contrast!.severity).toBe('MEDIUM');
    expect(byKey.contrast!.marks).toHaveLength(2);
    expect(byKey.overflow!.area).toBe('phone');
  });
});

describe('measure script', () => {
  it('finds low contrast, unlabeled fields, small tap targets and missing alt text in a real page', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent(`<!doctype html><html><body style="background:#fff;font-family:Arial">
        <h1>Shop</h1>
        <p style="color:#bbbbbb">Faint words here</p>
        <p style="color:#111">Clear words here</p>
        <input placeholder="Email">
        <label>Name <input name="name"></label>
        <div style="margin:40px 0"><a href="/a" style="display:inline-block;width:10px;height:10px;font-size:8px">a</a><a href="/b" style="display:inline-block;width:10px;height:10px;font-size:8px">b</a></div>
        <div style="margin:40px 0"><a href="/lone" style="display:inline-block;width:10px;height:10px;font-size:8px">lone</a></div>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" style="width:40px;height:40px">
      </body></html>`);
      const result = (await page.evaluate(MEASURE_SCRIPT)) as PageMeasurements;
      expect(result.contrast.map((item) => item.text)).toContain('Faint words here');
      expect(result.contrast.map((item) => item.text)).not.toContain('Clear words here');
      expect(result.unlabeledFields.map((item) => item.label)).toEqual(['Email']);
      // Two tiny links side by side are too close; a tiny link with space around it is fine (WCAG 2.5.8).
      expect(result.tapTargets.map((item) => item.label).sort()).toEqual(['a', 'b']);
      expect(result.missingAlt).toHaveLength(1);
      expect(result.h1Count).toBe(1);
      expect(result.fonts[0]!.family).toBe('Arial');
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe('site-wide AI issues', () => {
  it('reports a cookie banner or a measured topic only once', async () => {
    const { repeatsKnownIssue } = await import('../src/design-review.js');
    const known = ['Cookie consent box overlaps tool cards', 'Some text is hard to read against its background'];
    expect(repeatsKnownIssue('Floating cookie banner obstructs content', known)).toBe(true);
    expect(repeatsKnownIssue('Low contrast badge text', ['Text has low contrast'])).toBe(true);
    expect(repeatsKnownIssue('Awkward category filter button wrapping', known)).toBe(false);
    expect(repeatsKnownIssue('Category filter buttons wrap awkwardly', ['Awkward category filter button wrapping'])).toBe(true);
  });
});
