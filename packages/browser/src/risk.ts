import type { ActionRisk } from '@auditor/shared';

const DESTRUCTIVE =
  /\b(delete|remove|destroy|drop|purge|wipe|terminate|cancel subscription|unsubscribe)\b/i;
const PAYMENT = /\b(pay|payment|purchase|buy now|checkout|place order|charge|submit payment)\b/i;
const CAUTION =
  /\b(logout|log out|sign out|reset|disable|archive|revoke|leave|transfer|overwrite)\b/i;

export function classifyActionRisk(input: {
  text?: string | null;
  href?: string | null;
  name?: string | null;
  type?: string | null;
}): ActionRisk {
  const haystack = [input.text, input.href, input.name, input.type].filter(Boolean).join(' ');
  if (DESTRUCTIVE.test(haystack) || PAYMENT.test(haystack)) {
    return 'DESTRUCTIVE';
  }
  if (CAUTION.test(haystack)) {
    return 'CAUTION';
  }
  return 'SAFE';
}
