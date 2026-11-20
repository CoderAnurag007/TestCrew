import Link from 'next/link';
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

export function HeroSection({ primaryHref, primaryLabel, signedIn }: HeroSectionProps) {
  return (
    <section className="border-b border-[var(--night-line)]">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-4 pb-14 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 lg:px-10 lg:pb-20 lg:pt-20">
        <div className="relative z-10">
          <SectionIndex number="0.01" label="Live audit · staging.shop.example" />
          <h1 className="display mt-6 text-[38px] sm:text-[52px] lg:text-[46px] xl:text-[56px]">
            Every button clicked.
            <span className="block text-[#3a3e45]">Every bug on record.</span>
          </h1>
          <p className="mt-7 max-w-[44ch] text-[17px] leading-relaxed text-[var(--night-dim)]">
            Snaghunt works through your web app like a QA crew on the night shift. It tries every control, walks every
            journey, and leaves you the evidence for each thing it finds.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={primaryHref}
              className="inline-flex h-11 items-center rounded-full bg-[var(--night-ink)] px-5 text-[15px] font-medium text-black transition-colors hover:bg-white"
            >
              {primaryLabel}
            </Link>
            <Link
              href={signedIn ? '#evidence' : '/login'}
              className="inline-flex h-11 items-center rounded-full border border-[var(--night-faint)] px-5 text-[15px] font-medium text-[var(--night-ink)] transition-colors hover:border-[var(--night-dim)]"
            >
              {signedIn ? 'See the evidence' : 'Sign in'}
            </Link>
          </div>
          <p className="mt-6 max-w-[50ch] text-[13px] leading-relaxed text-[#6b7079]">
            Orders are only ever placed on a staging site you name, with sandbox test cards.
          </p>
        </div>
        <InspectionScene />
      </div>

      <dl className="mx-auto grid max-w-[1280px] grid-cols-2 border-t border-[var(--night-line)] lg:grid-cols-4">
        {STATS.map((stat, index) => (
          <div
            key={stat.label}
            className={[
              'px-4 py-6 sm:px-6 lg:px-10',
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
