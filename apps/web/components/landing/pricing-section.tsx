'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLAN_ORDER, PLANS, TRIAL_DAYS, type PlanId } from '@auditor/shared';
import { cn } from '@/lib/utils';
import { SectionIndex } from './section-index';

type Currency = 'USD' | 'INR';

/** Extra Agency sites in India, priced like the rupee plans (about 40% of the dollar price). */
const EXTRA_SITE_INR = 399;
type Billing = 'monthly' | 'yearly';

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Do I have to write any tests?',
    a: 'No. Give Snaghunt your site address and it clicks through every page, button and form on its own, then writes the tests it ran for you.',
  },
  {
    q: 'Is it safe to point at my live site?',
    a: 'Yes. Audits are read-only by default: anything that would change data is blocked. Orders and payments only ever run on a staging site you name, with test cards.',
  },
  {
    q: 'What happens after the free trial?',
    a: `You get every Pro feature for ${TRIAL_DAYS} days, no card needed. Afterwards you move to the Free plan unless you pick a paid one, and nothing is deleted.`,
  },
  {
    q: 'What counts as a site?',
    a: 'One website or web app, with its live and staging addresses. An agency with 20 client sites needs 20 sites, which the Agency plan covers.',
  },
  {
    q: 'Can I resell it to my clients?',
    a: 'Yes, that is what the Agency plan is for. Reports carry your name and logo, and you share them with clients through a link.',
  },
  {
    q: 'Can I pay in rupees?',
    a: 'Yes. Customers in India see prices in rupees and pay in rupees.',
  },
];

function guessCurrency(): Currency {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    return /Kolkata|Calcutta/.test(zone) ? 'INR' : 'USD';
  } catch {
    return 'USD';
  }
}

function price(id: PlanId, currency: Currency, billing: Billing): number {
  const plan = PLANS[id];
  if (currency === 'USD') return billing === 'yearly' ? plan.annualUsd : plan.priceUsd;
  if (billing === 'monthly') return plan.priceInr;
  // About 20% off for yearly, ending in 9 like the monthly prices.
  return plan.priceInr ? Math.round((plan.priceInr * 0.8) / 10) * 10 - 1 : 0;
}

function money(amount: number, currency: Currency): string {
  return currency === 'USD' ? `$${amount}` : `₹${amount.toLocaleString('en-IN')}`;
}

export function PricingSection({ signedIn }: { signedIn: boolean }) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [billing, setBilling] = useState<Billing>('monthly');
  useEffect(() => setCurrency(guessCurrency()), []);
  const start = signedIn ? '/plan' : '/register';

  return (
    <section id="pricing" className="scroll-mt-16 border-b border-[var(--night-line)]">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <div data-reveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionIndex number="0.05" label="Pricing" />
            <h2 className="display mt-6 text-[32px] sm:text-[44px]">Priced per site</h2>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-[var(--night-dim)]">
              Every plan starts with {TRIAL_DAYS} days of Pro, free and without a card. Less than one lost sale a month.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Toggle
              label="Billing"
              value={billing}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly · save 20%' },
              ]}
              onChange={(value) => setBilling(value as Billing)}
            />
            <Toggle
              label="Currency"
              value={currency}
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'INR', label: '₹ INR' },
              ]}
              onChange={(value) => setCurrency(value as Currency)}
            />
          </div>
        </div>

        <div data-reveal className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[var(--night-line)] bg-[var(--night-line)] md:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const amount = price(id, currency, billing);
            const featured = id === 'AGENCY';
            return (
              <div key={id} className={cn('flex flex-col p-7', featured ? 'bg-[#121316]' : 'bg-[var(--night)]')}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[15px] font-semibold text-[var(--night-ink)]">{plan.name}</p>
                  {featured ? (
                    <span className="mono rounded-full border border-[var(--lamp)]/40 px-2 py-0.5 text-[10.5px] uppercase tracking-[0.08em] text-[var(--lamp)]">
                      For agencies
                    </span>
                  ) : id === 'PRO' ? (
                    <span className="mono rounded-full border border-[var(--night-faint)] px-2 py-0.5 text-[10.5px] uppercase tracking-[0.08em] text-[var(--night-dim)]">
                      Most picked
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 min-h-[2.5em] text-[13px] leading-snug text-[var(--night-dim)]">{plan.tagline}</p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-[40px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-[var(--night-ink)]">
                    {money(amount, currency)}
                  </span>
                  <span className="text-[13px] text-[var(--night-dim)]">/month</span>
                </p>
                <p className="mt-2 h-4 text-[12px] text-[var(--night-dim)]">
                  {amount && billing === 'yearly' ? `billed yearly, ${money(amount * 12, currency)}` : amount ? 'billed monthly' : 'free forever'}
                </p>
                <ul className="mt-7 flex-1 space-y-2.5">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex gap-2.5 text-[14px] leading-snug text-[var(--night-ink)]">
                      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--pass)]" />
                      {currency === 'INR' ? item.replace('$10 per site', `₹${EXTRA_SITE_INR} per site`) : item}
                    </li>
                  ))}
                </ul>
                <Link
                  href={start}
                  className={cn(
                    'mt-8 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors',
                    featured || id === 'PRO'
                      ? 'bg-[var(--night-ink)] text-black hover:bg-white'
                      : 'border border-[var(--night-faint)] text-[var(--night-ink)] hover:border-[var(--night-dim)]',
                  )}
                >
                  {id === 'FREE' ? 'Start free' : `Try ${plan.name} free`}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-[13px] text-[var(--night-dim)]">
          Need more than 25 sites, single sign-on or an invoice? <a href="mailto:hello@snaghunt.com" className="text-[var(--night-ink)] underline-offset-4 hover:underline">Talk to us</a>.
        </p>

        <div data-reveal className="mt-20 grid gap-10 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:gap-16">
          <h3 className="display text-[24px] sm:text-[28px]">Questions</h3>
          <dl className="border-t border-[var(--night-line)]">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-[var(--night-line)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium text-[var(--night-ink)] [&::-webkit-details-marker]:hidden">
                  <dt>{item.q}</dt>
                  <span aria-hidden className="text-[18px] leading-none text-[var(--night-dim)] transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <dd className="max-w-[62ch] pb-5 text-sm leading-relaxed text-[var(--night-dim)]">{item.a}</dd>
              </details>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-[var(--night-line)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-8 rounded-full px-3.5 text-[13px] transition-colors',
            value === option.value ? 'bg-[var(--night-ink)] font-medium text-black' : 'text-[var(--night-dim)] hover:text-[var(--night-ink)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
