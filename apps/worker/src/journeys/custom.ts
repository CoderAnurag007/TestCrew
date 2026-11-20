import type { CustomJourney, CustomStep } from '@auditor/shared';
import { BlockedError, type JourneyContext, NotFoundError } from './toolkit.js';

/**
 * Runs a person-written journey. Targets are visible labels, placeholders or
 * names; they are resolved on the live page at run time, so the steps survive
 * markup changes as long as the wording stays the same.
 */
export async function runCustomJourney(ctx: JourneyContext, journey: CustomJourney): Promise<void> {
  for (const [index, step] of journey.steps.entries()) {
    const ok = await ctx.step(describe(step, index), async () => {
      if (journey.transactional) ctx.requireTransactions();
      else if (journey.mutates && ['click', 'fill', 'select', 'press'].includes(step.action)) ctx.requireFull();
      await perform(ctx, step);
    });
    if (!ok) {
      const last = ctx.steps.at(-1);
      if (last && last.status !== 'passed') break;
    }
  }
}

async function perform(ctx: JourneyContext, step: CustomStep): Promise<void> {
  const page = ctx.page;
  const target = step.target.trim();
  switch (step.action) {
    case 'goto':
      await ctx.goto(target || '/');
      return;
    case 'wait':
      await page.waitForTimeout(Math.min(Number(step.value) || 1_000, 10_000));
      return;
    case 'expect_url':
      ctx.check(`URL contains "${target}"`, page.url().includes(target), target, page.url());
      return;
    case 'expect_text':
    case 'expect_no_text': {
      const text = await page.locator('body').innerText().catch(() => '');
      const present = text.toLowerCase().includes(target.toLowerCase());
      if (step.action === 'expect_text') ctx.check(`Page shows "${target}"`, present, target, present ? 'shown' : 'not shown');
      else ctx.check(`Page does not show "${target}"`, !present, 'absent', present ? 'shown' : 'absent');
      return;
    }
    case 'press':
      await page.keyboard.press(step.value || target || 'Enter');
      await ctx.settle();
      return;
    default:
      break;
  }
  const locator = await resolveByLabel(ctx, target, step.action);
  if (!locator) throw new NotFoundError(`Could not find "${target}" on the page.`);
  if (step.action === 'click') {
    await locator.click({ timeout: 8_000 });
    await ctx.settle();
  } else if (step.action === 'fill') {
    await locator.fill(resolveValue(ctx, step.value), { timeout: 5_000 });
  } else if (step.action === 'select') {
    await locator.selectOption({ label: step.value }).catch(async () => locator.selectOption(step.value));
  }
}

async function resolveByLabel(ctx: JourneyContext, target: string, action: CustomStep['action']) {
  const page = ctx.page;
  const exact = { name: target, exact: true };
  const candidates =
    action === 'click'
      ? [
          page.getByRole('button', exact),
          page.getByRole('link', exact),
          page.getByRole('button', { name: target }),
          page.getByRole('link', { name: target }),
          page.getByRole('menuitem', { name: target }),
          page.getByRole('tab', { name: target }),
          page.getByText(target, { exact: true }),
        ]
      : [page.getByLabel(target, { exact: true }), page.getByLabel(target), page.getByPlaceholder(target), page.locator(`[name="${target.replace(/"/g, '\\"')}"]`)];
  for (const candidate of candidates) {
    const first = candidate.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

/** {{email}}, {{firstName}}, {{token}} etc. come from the test plan's data. */
function resolveValue(ctx: JourneyContext, value: string): string {
  if (/\b(card|cvv|cvc)\b/i.test(value) && /\d{12,}/.test(value.replace(/\s/g, ''))) {
    throw new BlockedError('Card numbers cannot be typed by custom steps; use the sandbox payment settings.');
  }
  const data = ctx.plan.testData as unknown as Record<string, unknown>;
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
    if (key === 'token') return ctx.token;
    if (key === 'email') return (data.email as string) || `snaghunt+${ctx.token}@example.com`;
    const found = data[key];
    return typeof found === 'string' ? found : whole;
  });
}

function describe(step: CustomStep, index: number): string {
  const names: Record<CustomStep['action'], string> = {
    goto: 'Go to',
    click: 'Click',
    fill: 'Fill',
    select: 'Select',
    press: 'Press',
    expect_text: 'Expect text',
    expect_no_text: 'Expect no text',
    expect_url: 'Expect URL contains',
    wait: 'Wait',
  };
  const value = step.value && step.action !== 'click' ? ` = "${step.value}"` : '';
  return `${index + 1}. ${names[step.action]} "${step.target}"${value}`.slice(0, 160);
}
