import { describe, expect, it } from 'vitest';
import { botCheckReason } from '../src/bot-check.js';

describe('bot check detection', () => {
  it('recognises Cloudflare and similar walls', () => {
    expect(
      botCheckReason({
        title: 'onedirectbuy.com',
        text: 'Performing security verification This website uses a security service to protect against malicious bots. Ray ID: abc Performance and Security by Cloudflare',
      }),
    ).toMatch(/Cloudflare showed a bot check/);
    expect(botCheckReason({ title: 'Just a moment...', text: 'Checking your browser' })).toMatch(/bot check/);
    expect(botCheckReason({ title: 'Shop', text: 'x', hasChallengeFrame: true })).toMatch(/CAPTCHA/);
  });

  it('leaves normal pages alone, even ones that mention a captcha or Cloudflare', () => {
    expect(botCheckReason({ title: 'Login', text: 'Email Password Sign in' })).toBeNull();
    const article = `How we use Cloudflare to verify you are human. ${'Long article text. '.repeat(200)}`;
    expect(botCheckReason({ title: 'Blog', text: article })).toBeNull();
  });
});
