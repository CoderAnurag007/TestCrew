import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from '../src/html-report.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';

describe('HTML report', () => {
  const html = renderHtmlReport({
    generatedAt: new Date('2026-11-19T00:00:00Z'),
    project: { name: 'Shop <b>', baseUrl: 'https://shop.example.com' },
    run: { id: 'run1', mode: 'READ_ONLY', requestedMode: 'FULL' },
    score: 72.4,
    screensExplored: 5,
    summary: 'Summary text',
    diff: { previousRunId: 'r0', counts: { new: 1, recurring: 2, regressed: 0, fixed: 3 }, fixed: [{ title: 'Old bug', severity: 'HIGH' }] },
    findings: [
      {
        title: '<script>alert(1)</script>',
        severity: 'HIGH',
        category: 'BUG',
        change: 'NEW',
        description: 'desc',
        images: [png, 'javascript:alert(1)'],
        steps: ['Open page'],
      },
    ],
    screens: [{ title: 'Home', url: 'https://shop.example.com/', image: png }],
    tests: [{ name: 'Open home', source: 'generated', status: 'PASSED' }],
    safety: { blockedCount: 1, sample: [{ method: 'POST', url: 'https://shop.example.com/cart', reason: 'Read-only' }] },
  });

  it('escapes everything that came from the audited site', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Shop &lt;b&gt;');
    expect(html).not.toContain('javascript:alert');
  });

  it('embeds screenshots and needs nothing external', () => {
    expect(html).toContain(png);
    expect(html).not.toMatch(/<script|<link|https:\/\/fonts/);
  });

  it('explains a safety downgrade and shows the diff', () => {
    expect(html).toContain('domain is not verified');
    expect(html).toContain('Old bug');
    expect(html).toMatch(/Health score 72.4 out of 100/);
  });
});
