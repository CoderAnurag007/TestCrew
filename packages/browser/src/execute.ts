import type { Locator, Page } from 'playwright';
import type { CandidateAction, SelectorMeta } from '@auditor/shared';

export function locatorFromSelectors(page: Page, selectors: SelectorMeta): Locator {
  if (selectors.testId) {
    return page.getByTestId(selectors.testId);
  }
  if (selectors.id) {
    return page.locator(`#${cssId(selectors.id)}`);
  }
  if (selectors.role && selectors.accessibleName) {
    return page.getByRole(selectors.role as Parameters<Page['getByRole']>[0], {
      name: selectors.accessibleName,
    });
  }
  if (selectors.label) {
    return page.getByLabel(selectors.label);
  }
  if (selectors.name) {
    return page.locator(`[name="${selectors.name.replace(/"/g, '\\"')}"]`);
  }
  if (selectors.text) {
    return page.getByText(selectors.text, { exact: selectors.text.length <= 48 });
  }
  return page.locator(selectors.css ?? selectors.primary);
}

function cssId(id: string): string {
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

export async function executeCandidateAction(page: Page, action: CandidateAction): Promise<void> {
  if (action.type === 'goto' && action.href) {
    await page.goto(action.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return;
  }
  if (action.type === 'dismiss') {
    await page.keyboard.press('Escape');
    return;
  }
  const locator = locatorFromSelectors(page, action.selectors).first();
  await locator.waitFor({ state: 'visible', timeout: 5_000 });
  if (action.type === 'fill') {
    await locator.fill(action.input ?? 'sample');
    return;
  }
  if (action.type === 'select') {
    await locator.selectOption(action.input ?? { index: 0 });
    return;
  }
  if (action.type === 'press') {
    await locator.press(action.input ?? 'Enter');
    return;
  }
  await locator.click({ timeout: 5_000 });
}
