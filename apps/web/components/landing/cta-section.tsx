import Link from 'next/link';

type CtaSectionProps = {
  primaryHref: string;
  primaryLabel: string;
};

export function CtaSection({ primaryHref, primaryLabel }: CtaSectionProps) {
  return (
    <section className="border-b border-[var(--night-line)]">
      <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-10 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-28">
        <h2 className="display max-w-[14ch] text-[36px] sm:text-[52px] xl:text-[60px]">
          Find the bugs before your users do.
        </h2>
        <div className="max-w-[36ch]">
          <p className="text-[15px] leading-relaxed text-[var(--night-dim)]">
            Add your app’s URL and start an audit tonight. It runs read-only until you say otherwise.
          </p>
          <Link
            href={primaryHref}
            className="mt-6 inline-flex h-11 items-center rounded-full bg-[var(--lamp)] px-5 text-[15px] font-medium text-black transition-colors hover:bg-white"
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
