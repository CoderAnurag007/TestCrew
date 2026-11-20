import { describe, expect, it } from 'vitest';
import { monitoringBodySchema, nextMonitorRun, severityAtLeast, ticketMarkdown } from '../src/launch.js';

describe('nextMonitorRun', () => {
  const at = (iso: string) => new Date(iso);

  it('is off without a cadence', () => {
    expect(nextMonitorRun(null, 6, 1, at('2026-11-20T05:00:00Z'))).toBeNull();
  });

  it('runs hourly on the next full hour', () => {
    expect(nextMonitorRun('hourly', 6, 1, at('2026-11-20T05:17:42Z'))?.toISOString()).toBe('2026-11-20T06:00:00.000Z');
  });

  it('runs daily later today, or tomorrow once the hour has passed', () => {
    expect(nextMonitorRun('daily', 6, 1, at('2026-11-20T05:00:00Z'))?.toISOString()).toBe('2026-11-20T06:00:00.000Z');
    expect(nextMonitorRun('daily', 6, 1, at('2026-11-20T06:00:00Z'))?.toISOString()).toBe('2026-11-21T06:00:00.000Z');
  });

  it('runs weekly on the chosen weekday', () => {
    // 2026-11-20 is a Friday; Monday = 1.
    expect(nextMonitorRun('weekly', 9, 1, at('2026-11-20T12:00:00Z'))?.toISOString()).toBe('2026-11-23T09:00:00.000Z');
  });
});

describe('alerts and tickets', () => {
  it('compares severities', () => {
    expect(severityAtLeast('HIGH', 'MEDIUM')).toBe(true);
    expect(severityAtLeast('LOW', 'MEDIUM')).toBe(false);
  });

  it('fills monitoring defaults', () => {
    expect(monitoringBodySchema.parse({ cadence: 'daily' })).toMatchObject({
      hourUtc: 6,
      devices: ['desktop'],
      alerts: { emails: [], minSeverity: 'MEDIUM', onFailure: true, scheduledOnly: false },
    });
  });

  it('writes a readable ticket', () => {
    const text = ticketMarkdown(
      {
        title: 'Pay does nothing',
        severity: 'HIGH',
        description: 'Clicking Pay shows no response.',
        url: 'https://shop.example.com/cart',
        steps: [{ description: 'Open the cart' }, 'Click Pay'],
        expected: 'Payment form opens.',
        actual: 'Nothing.',
      },
      { app: 'https://app/runs/1' },
    );
    expect(text).toContain('**Severity:** High');
    expect(text).toContain('1. Open the cart\n2. Click Pay');
    expect(text).toContain('### What actually happened\nNothing.');
    expect(text).toContain('[Open in TestCrew](https://app/runs/1)');
  });
});
