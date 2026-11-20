import { describe, expect, it } from 'vitest';
import { evaluateGate, markdownSummary, parseArgs } from '../testcrew.mjs';

const base = {
  status: 'COMPLETED',
  baseUrl: 'https://pr-1.example.com',
  safetyMode: 'READ_ONLY',
  qualityScore: 82,
  previousRunId: 'prev',
  changeCounts: { new: 1, regressed: 0, recurring: 1, fixed: 2 },
  tests: { generated: 10, passed: 9, failed: 1, flaky: 0 },
  findings: [
    { title: 'Checkout total wrong', severity: 'HIGH', change: 'NEW' },
    { title: 'Old low issue', severity: 'LOW', change: 'RECURRING' },
    { title: 'Old high issue', severity: 'HIGH', change: 'RECURRING' },
  ],
};

describe('CI gate', () => {
  it('fails on a new high finding by default and ignores recurring ones', () => {
    const gate = evaluateGate(base, parseArgs(['run', '--project', 'p']));
    expect(gate.passed).toBe(false);
    expect(gate.blocking.map((f) => f.title)).toEqual(['Checkout total wrong']);
  });

  it('passes when only recurring findings exist', () => {
    const summary = { ...base, findings: base.findings.filter((f) => f.change === 'RECURRING') };
    expect(evaluateGate(summary, parseArgs(['run', '--project', 'p'])).passed).toBe(true);
  });

  it('can fail on any high finding or on a minimum score', () => {
    const recurringOnly = { ...base, findings: base.findings.filter((f) => f.change === 'RECURRING') };
    expect(evaluateGate(recurringOnly, parseArgs(['run', '--project', 'p', '--fail-on', 'high'])).passed).toBe(false);
    expect(evaluateGate(recurringOnly, parseArgs(['run', '--project', 'p', '--min-score', '90'])).passed).toBe(false);
    expect(evaluateGate(recurringOnly, parseArgs(['run', '--project', 'p', '--fail-on', 'none'])).passed).toBe(true);
  });

  it('reports a failed run as an error, not a gate failure', () => {
    const gate = evaluateGate({ ...base, status: 'FAILED', errorMessage: 'boom' }, parseArgs(['run', '--project', 'p']));
    expect(gate.error).toBe(true);
  });

  it('rejects bad options', () => {
    expect(() => parseArgs(['run', '--fail-on', 'sometimes'])).toThrow();
    expect(() => parseArgs(['run', '--min-score', '120'])).toThrow();
  });

  it('writes a readable markdown summary', () => {
    const gate = evaluateGate(base, parseArgs(['run', '--project', 'p']));
    const md = markdownSummary(base, gate, 'https://auditor/runs/1');
    expect(md).toContain('TestCrew audit: failed');
    expect(md).toContain('1 new');
    expect(md).toContain('Checkout total wrong');
  });
});
