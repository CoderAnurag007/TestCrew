import { afterAll, describe, expect, it } from 'vitest';
import { BrowserManager, UsernamePasswordAuthenticator } from '../src/index.js';

describe('username/password authentication', () => {
  const manager = new BrowserManager();

  afterAll(async () => {
    await manager.close();
  });

  it('fills email-address and password textboxes that are type=text', async () => {
    const context = await manager.createContext();
    const page = await manager.createPage(context);
    await page.setContent(`<!doctype html>
      <h2>Sign in</h2>
      <label>Email address <input type="text" /></label>
      <label>Password <input type="text" /></label>
      <button type="button" id="login">Login</button>
      <script>
        document.getElementById('login').addEventListener('click', () => {
          setTimeout(() => {
            document.body.innerHTML = '<nav data-testid="app-nav">Dashboard</nav>';
          }, 800);
        });
      </script>`);

    const auth = new UsernamePasswordAuthenticator();
    const detected = await auth.detectLogin(page);
    expect(detected.detected).toBe(true);

    const result = await auth.authenticate(page, {
      username: 'user@example.com',
      password: 'secret',
      baseUrl: page.url(),
    });
    expect(result.authenticated).toBe(true);
    expect(await page.getByTestId('app-nav').count()).toBe(1);
    await context.close();
  });
});
