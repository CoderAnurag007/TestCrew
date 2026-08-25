import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, FIXTURE_USER, startFixture, type FixtureServer } from '@auditor/fixture';
import { BrowserManager, PageObserver, UsernamePasswordAuthenticator } from '../src/index.js';

describe('Playwright observation against fixture app', () => {
  let fixture: FixtureServer;
  const manager = new BrowserManager();

  beforeAll(async () => {
    fixture = await startFixture();
  });

  afterAll(async () => {
    await manager.close();
    await fixture.close();
  });

  it('logs in, observes semantic UI, and distinguishes application states', async () => {
    const context = await manager.createContext();
    const page = await manager.createPage(context);
    const observer = new PageObserver();
    observer.attach(page);

    await page.goto(`${fixture.url}/login`, { waitUntil: 'domcontentloaded' });
    const login = await observer.observe(page);
    expect(login.semantic.title).toMatch(/sign in/i);
    expect(login.semantic.elements.some((element) => element.inputType === 'password')).toBe(true);
    expect(login.screenshot.length).toBeGreaterThan(100);
    expect(login.dom.includes('password')).toBe(true);

    const auth = new UsernamePasswordAuthenticator();
    const result = await auth.authenticate(page, {
      username: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      baseUrl: `${fixture.url}/login`,
    });
    expect(result.authenticated).toBe(true);

    const dashboard = await observer.observe(page);
    expect(dashboard.semantic.route).toBe('/dashboard');
    expect(dashboard.semantic.elements.some((element) => element.selectors.testId === 'nav-users')).toBe(true);
    expect(dashboard.semantic.url).not.toBe(login.semantic.url);

    await page.click('[data-testid="nav-users"]');
    const users = await observer.observe(page);
    expect(users.semantic.route).toBe('/users');
    expect(users.semantic.elements.some((element) => /delete/i.test(element.text ?? ''))).toBe(true);

    await context.close();
  });
});
