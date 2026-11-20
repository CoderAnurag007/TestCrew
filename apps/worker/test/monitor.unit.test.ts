import { describe, expect, it } from 'vitest';
import { currentDevice, deviceContextOptions, runWithDevice } from '@auditor/browser';
import { alertSubject, alertText, monitorDevices, slackPayload, type AlertMessage } from '../src/monitor.js';

const message: AlertMessage = {
  kind: 'bugs',
  projectName: 'Shop',
  siteUrl: 'https://shop.example.com',
  runUrl: 'http://localhost:3000/runs/r1',
  device: 'desktop',
  score: 81.6,
  findings: [
    { title: 'Pay does nothing', severity: 'HIGH', change: 'NEW', url: 'https://shop.example.com/cart', description: 'Clicking Pay shows no response. More text.', steps: [] },
    { title: 'Menu <overlaps>', severity: 'MEDIUM', change: 'REGRESSED', url: null, description: 'The menu covers the search box.', steps: [] },
  ],
};

describe('alerts', () => {
  it('says how many bugs are new and how many came back', () => {
    expect(alertSubject(message)).toBe('TestCrew: 1 new bug, 1 came back on Shop');
    expect(alertSubject({ ...message, kind: 'failed', findings: [] })).toBe('TestCrew: the audit of Shop could not finish');
  });

  it('writes a plain-text alert with the score and a link', () => {
    const text = alertText(message);
    expect(text).toContain('Score: 82/100');
    expect(text).toContain('• [High] Pay does nothing — https://shop.example.com/cart');
    expect(text).toContain('(came back)');
    expect(text).toContain('Open the report: http://localhost:3000/runs/r1');
  });

  it('builds a Slack message with escaped text and a report button', () => {
    const payload = slackPayload(message) as { text: string; blocks: { type: string; text?: { text: string }; elements?: { url?: string }[] }[] };
    expect(payload.text).toContain('1 new bug');
    const sections = payload.blocks.filter((block) => block.type === 'section').map((block) => block.text!.text);
    expect(sections[1]).toContain('Menu &lt;overlaps&gt;');
    expect(sections[0]).toContain('Clicking Pay shows no response.');
    expect(sections[0]).not.toContain('More text');
    expect(payload.blocks.at(-1)!.elements![0]!.url).toBe('http://localhost:3000/runs/r1');
  });

  it('keeps only known devices', () => {
    expect(monitorDevices(['phone', 'tv', 'phone'])).toEqual(['phone']);
    expect(monitorDevices('nope')).toEqual(['desktop']);
  });
});

describe('devices', () => {
  it('uses a phone screen for phone runs even when a desktop viewport is asked for', async () => {
    const options = await runWithDevice('iphone', async () => {
      expect(currentDevice()).toBe('iphone');
      return deviceContextOptions({ viewport: { width: 1280, height: 720 } });
    });
    expect(options.viewport?.width).toBeLessThan(500);
    expect(options.isMobile).toBe(true);
    expect(options.userAgent).toContain('iPhone');
  });

  it('keeps the caller viewport on desktop and falls back to desktop for unknown devices', async () => {
    const options = await runWithDevice('fridge', async () => deviceContextOptions({ viewport: { width: 1024, height: 700 } }));
    expect(options.viewport).toEqual({ width: 1024, height: 700 });
    expect(currentDevice()).toBe('desktop');
  });
});
