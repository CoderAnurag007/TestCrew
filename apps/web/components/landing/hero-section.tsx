import Link from 'next/link';
import type { CSSProperties } from 'react';
import { FreeCheckForm } from './free-check-form';
import { InspectionScene } from './inspection-scene';
import { SectionIndex } from './section-index';

type HeroSectionProps = {
  primaryHref: string;
  primaryLabel: string;
  signedIn: boolean;
};

const STATS = [
  { value: '18', label: 'Journey types, from search to checkout' },
  { value: '100%', label: 'Planted bugs caught in our benchmark' },
  { value: '0', label: 'False positives in that benchmark' },
  { value: 'Read-only', label: 'Unless you allow changes' },
];

/** Delay for the page-setup animations, after the opening (see motion.css). */
function at(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties;
}

/** Each word rises out of its own line, one after another. */
function Words({ text, from }: { text: string; from: number }) {
  return text.split(' ').map((word, index) => (
    <span key={index}>
      {index ? ' ' : null}
      <span className="word-mask">
        <span className="word-rise" style={at(from + index * 0.07)}>
          {word}
        </span>
      </span>
    </span>
  ));
}

export function HeroSection({ primaryHref, primaryLabel, signedIn }: HeroSectionProps) {
  return (
    <section className="border-b border-[var(--night-line)]">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-4 pb-14 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 lg:px-10 lg:pb-20 lg:pt-20">
        <div className="relative z-10">
          <div className="enter" style={at(0.05)}>
            <SectionIndex number="0.01" label="Live audit · staging.shop.example" />
          </div>
          <h1 className="display mt-6 text-[38px] sm:text-[52px] lg:text-[46px] xl:text-[56px]">
            <Words text="Every button clicked." from={0.12} />
            <span className="block text-[#3a3e45]">
              <Words text="Every bug on record." from={0.36} />
            </span>
          </h1>
          <p className="enter mt-7 max-w-[44ch] text-[17px] leading-relaxed text-[var(--night-dim)]" style={at(0.62)}>
            Snaghunt works through your web app like a QA crew on the night shift. It tries every control, walks every
            journey, and leaves you the evidence for each thing it finds.
          </p>
          {signedIn ? (
            <div className="enter mt-9 flex flex-wrap items-center gap-3" style={at(0.74)}>
              <Link
                href={primaryHref}
                className="inline-flex h-11 items-center rounded-full bg-[var(--night-ink)] px-5 text-[15px] font-medium text-black transition-colors hover:bg-white"
              >
                {primaryLabel}
              </Link>
              <Link
                href="#evidence"
                className="inline-flex h-11 items-center rounded-full border border-[var(--night-faint)] px-5 text-[15px] font-medium text-[var(--night-ink)] transition-colors hover:border-[var(--night-dim)]"
              >
                See the evidence
              </Link>
            </div>
          ) : (
            <div className="enter mt-9" style={at(0.74)}>
              <FreeCheckForm source="hero" />
              <p className="mt-2 pl-1 text-[13px] text-[#6b7079]">
                Want the full audit?{' '}
                <Link href={primaryHref} className="text-[var(--night-dim)] underline-offset-4 hover:text-[var(--night-ink)] hover:underline">
                  Create a free account
                </Link>{' '}
                or{' '}
                <Link href="/login" className="text-[var(--night-dim)] underline-offset-4 hover:text-[var(--night-ink)] hover:underline">
                  sign in
                </Link>
                .
              </p>
            </div>
          )}
        </div>
        <div className="scene-enter" style={at(0.2)}>
          <InspectionScene />
        </div>
      </div>

      <dl className="line-draw mx-auto grid max-w-[1280px] grid-cols-2 border-t border-[var(--night-line)] lg:grid-cols-4" style={at(0.8)}>
        {STATS.map((stat, index) => (
          <div
            key={stat.label}
            style={at(0.92 + index * 0.08)}
            className={[
              'enter px-4 py-6 sm:px-6 lg:px-10',
              index % 2 === 0 ? 'border-r border-[var(--night-line)]' : '',
              index < 2 ? 'border-b border-[var(--night-line)] lg:border-b-0' : '',
              index === 1 ? 'lg:border-r' : '',
            ].join(' ')}
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd>
              <span className="font-display block text-[26px] font-bold leading-none [font-stretch:125%] sm:text-[30px]">
                {stat.value}
              </span>
              <span className="index-label mt-3 block text-[var(--night-dim)]">{stat.label}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
