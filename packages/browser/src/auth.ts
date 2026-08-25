import { assertSafeNavigationTarget, UnsafeTargetError } from '@auditor/shared/ssrf';
import type { Frame, Locator, Page } from 'playwright';
import { withNavigationRetry } from './stable-page.js';

const IDENTITY_NAME = /email address|e-mail|email|username|user name/i;
const PASSWORD_NAME = /^password$/i;
const LOGIN_PATH = /\/login\b|\/signin\b|\/sign-in\b|\/auth\b/i;

export async function installNavigationGuard(
  page: Page,
  options: { allowPrivate: boolean },
): Promise<void> {
  await page.route('**/*', async (route) => {
    try {
      await assertSafeNavigationTarget(route.request().url(), { allowPrivate: options.allowPrivate });
      await route.continue();
    } catch (error) {
      if (error instanceof UnsafeTargetError) {
        await route.abort('blockedbyclient');
        return;
      }
      throw error;
    }
  });
}

export class UsernamePasswordAuthenticator {
  async authenticate(
    page: Page,
    input: { username: string; password: string; baseUrl: string },
  ): Promise<{ authenticated: boolean; reason?: string }> {
    const login = await this.detectLogin(page);
    if (!login.detected) {
      return { authenticated: true };
    }

    const fields = await resolveLoginFields(page);
    if (!fields) {
      return {
        authenticated: false,
        reason: 'Login page detected but username or password fields were not found',
      };
    }

    await fillFormControl(fields.identity, input.username);
    await fillFormControl(fields.password, input.password);
    await fields.password.press('Tab').catch(() => undefined);
    await fields.submit.click({ timeout: 5_000 });

    const leftLogin = await waitForLoginToClear(page, 20_000);
    if (leftLogin || (await isAuthenticatedUi(page))) {
      return { authenticated: true };
    }

    const feedback = await readLoginFeedback(page);
    if (feedback) {
      return { authenticated: false, reason: feedback };
    }

    return {
      authenticated: false,
      reason: 'Authentication did not leave the login page. Check the stored username and password.',
    };
  }

  async detectLogin(page: Page): Promise<{ detected: boolean; reason: string }> {
    return withNavigationRetry(page, async () => {
      const urlLooksLikeLogin = LOGIN_PATH.test(page.url());
      const fields = await resolveLoginFields(page);
      const loginButton = await firstVisibleLocator(page, [
        page.getByRole('button', { name: /^login$/i }),
        page.getByRole('button', { name: /log in|sign in/i }),
      ]);
      const detected = Boolean(fields) && (urlLooksLikeLogin || Boolean(loginButton));
      return {
        detected,
        reason: detected ? 'password field and login affordance present' : 'no login form detected',
      };
    });
  }
}

async function fillFormControl(locator: Locator, value: string): Promise<void> {
  await locator.click({ timeout: 5_000 });
  await locator.fill(value);
  await locator.dispatchEvent('input');
  await locator.dispatchEvent('change');
}

async function waitForLoginToClear(page: Page, timeoutMs: number): Promise<boolean> {
  const startedOnLoginPath = LOGIN_PATH.test(page.url());
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isAuthenticatedUi(page)) {
      return true;
    }
    const fields = await resolveLoginFields(page);
    if (!fields) {
      return true;
    }
    if (startedOnLoginPath && !LOGIN_PATH.test(page.url())) {
      return true;
    }
    await page.waitForTimeout(300);
  }
  return (await isAuthenticatedUi(page)) || !(await resolveLoginFields(page));
}

async function isAuthenticatedUi(page: Page): Promise<boolean> {
  const nav = page.getByTestId('app-nav').or(page.getByRole('navigation'));
  try {
    return (await nav.count()) > 0 && (await nav.first().isVisible());
  } catch {
    return false;
  }
}

async function readLoginFeedback(page: Page): Promise<string | null> {
  const recaptcha = page.locator('iframe[src*="recaptcha"], .g-recaptcha, textarea[name="g-recaptcha-response"]');
  if ((await recaptcha.count()) > 0) {
    const visibleChallenge = await page.locator('iframe[src*="recaptcha"][src*="bframe"]').count();
    if (visibleChallenge > 0 || (await recaptcha.first().isVisible().catch(() => false))) {
      return 'Login is blocked by CAPTCHA. Complete login in a browser or disable CAPTCHA for this environment.';
    }
  }
  const messages = await page
    .locator('[role="alert"], .mat-mdc-form-field-error, .mat-error, .invalid-feedback, .error, .toast-error')
    .allTextContents()
    .catch(() => []);
  const text = messages.map((item) => item.trim()).filter(Boolean)[0];
  return text ? `Login failed: ${text}` : null;
}

async function resolveLoginFields(
  page: Page,
): Promise<{ identity: Locator; password: Locator; submit: Locator } | null> {
  const contexts: Array<Page | Frame> = [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
  for (const context of contexts) {
    const identity = await firstVisibleLocator(context, identityCandidates(context));
    const password = await firstVisibleLocator(context, passwordCandidates(context));
    const submit = await firstVisibleLocator(context, submitCandidates(context));
    if (identity && password && submit) {
      return { identity, password, submit };
    }
  }
  return null;
}

function identityCandidates(context: Page | Frame): Locator[] {
  return [
    context.getByTestId('username'),
    context.getByTestId('email'),
    context.getByLabel(IDENTITY_NAME),
    context.getByPlaceholder(IDENTITY_NAME),
    context.getByRole('textbox', { name: IDENTITY_NAME }),
    context.locator(
      'input[type="email"], input[name="email" i], input[name="username" i], input[autocomplete="email" i], input[autocomplete="username" i]',
    ),
  ];
}

function passwordCandidates(context: Page | Frame): Locator[] {
  return [
    context.getByTestId('password'),
    context.locator('input[type="password"]'),
    context.getByLabel(PASSWORD_NAME),
    context.getByPlaceholder(PASSWORD_NAME),
    context.getByRole('textbox', { name: PASSWORD_NAME }),
  ];
}

function submitCandidates(context: Page | Frame): Locator[] {
  return [
    context.getByTestId('login-submit'),
    context.getByRole('button', { name: /^login$/i }),
    context.getByRole('button', { name: /log in|sign in/i }),
    context.locator('button[type="submit"], input[type="submit"]'),
  ];
}

async function firstVisibleLocator(_context: Page | Frame, locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first();
    try {
      if ((await candidate.count()) === 0) {
        continue;
      }
      if (await candidate.isVisible()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}
