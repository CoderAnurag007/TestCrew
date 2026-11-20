import type { Page } from 'playwright';

/**
 * Bot-protection pages (Cloudflare, Akamai, CAPTCHA walls) stand in front of
 * the real page. When one appears, the auditor reports that it was blocked and
 * moves on: it never tries to solve or get around the check.
 */
const TITLE_MARKERS = /^(just a moment|attention required|access denied|checking your browser|please wait|security check|ddos-guard|human verification)/i;
const BODY_MARKERS =
  /performing security verification|checking (if the site connection is secure|your browser before accessing)|verify you are (a )?human|this website uses a security service to protect against malicious bots|enable javascript and cookies to continue|press (&|and) hold to confirm|are you a robot|unusual traffic from your (computer )?network/i;

export function botCheckReason(input: { title: string; text: string; hasChallengeFrame?: boolean }): string | null {
  const text = input.text.replace(/\s+/g, ' ').slice(0, 3000);
  // A short page is a wall; a long page that merely mentions a CAPTCHA is not.
  const shortPage = text.length < 1500;
  if (TITLE_MARKERS.test(input.title.trim()) && shortPage) return `the page "${input.title.trim().slice(0, 60)}" is a bot check`;
  if (BODY_MARKERS.test(text) && shortPage) {
    const vendor = /cloudflare/i.test(text) ? 'Cloudflare' : /akamai/i.test(text) ? 'Akamai' : /perimeterx|human security/i.test(text) ? 'HUMAN' : 'the site';
    return `${vendor} showed a bot check instead of the page`;
  }
  if (input.hasChallengeFrame && shortPage) return 'a CAPTCHA covers the page';
  return null;
}

/** Null when the page is a normal page; otherwise why it is a bot check. */
export async function detectBotCheck(page: Page): Promise<string | null> {
  try {
    const snapshot = (await page.evaluate(`(() => ({
      title: document.title || '',
      text: (document.body && document.body.innerText) || '',
      hasChallengeFrame: Boolean(
        document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com/captcha"], iframe[title*="challenge" i], #challenge-form, #cf-challenge-running'),
      ),
    }))()`)) as { title: string; text: string; hasChallengeFrame: boolean };
    return botCheckReason(snapshot);
  } catch {
    return null;
  }
}
