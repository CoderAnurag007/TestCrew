import { SectionIndex } from './section-index';

/*
 * Customer story. Every number and finding comes from Snaghunt's own runs on
 * filesprocess.com (full audit 20 Nov 2026, design review 21 Nov 2026).
 * Only change it with results from a real run.
 *
 * QUOTE stays null until someone at filesprocess.com gives a real quote; then
 * the card shows it in their words with their name. Never invent one.
 */
const QUOTE: { text: string; name: string; role: string } | null = null;

const STATS = [
  { value: '40', label: 'Pages explored' },
  { value: '25', label: 'Tests written' },
  { value: '22 min', label: 'Start to report' },
  { value: '<1¢', label: 'AI cost' },
];

const FOUND = [
  { severity: 'High', title: 'JEE Main photo and signature size stops working after you use another tool', where: '/image/jee-main-photo-signature-size' },
  { severity: 'High', title: 'Enhance audio stops working after you use another tool', where: '/audio/enhance-audio' },
];

/** The FilesProcess logo, as their site draws it. */
function FilesProcessLogo() {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.6)]">
      <svg viewBox="0 0 40 40" className="size-7" aria-hidden>
        <path d="M9 3h15l9 9v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#16a34a" />
        <path d="M24 3v7a2 2 0 0 0 2 2h7z" fill="#bbf7d0" />
        <rect x="11" y="18" width="16" height="3" rx="1.5" fill="#fff" />
        <rect x="11" y="24" width="16" height="3" rx="1.5" fill="#fff" />
        <rect x="11" y="30" width="10" height="3" rx="1.5" fill="#fff" />
      </svg>
      <span className="text-[19px] font-bold tracking-tight">
        <span className="text-[#0f172a]">Files</span>
        <span className="text-[#16a34a]">Process</span>
      </span>
    </span>
  );
}

export function CaseStudySection() {
  return (
    <section id="case-study" className="scroll-mt-16 border-b border-[var(--night-line)]">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <div data-reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionIndex number="0.04" label="Customer story" />
            <h2 className="display mt-6 text-[32px] sm:text-[44px]">Real site. Real bugs.</h2>
          </div>
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-[var(--night-dim)]">
            What one audit found on a live site with dozens of tools, shown as it came out.
          </p>
        </div>

        <figure
          data-reveal
          className="relative mt-12 overflow-hidden rounded-2xl border border-[var(--night-line)] bg-[linear-gradient(160deg,#101114_0%,#0a0b0d_60%)]"
        >
          {/* Warm lamp light from the top corner, like the rest of the page. */}
          <div aria-hidden className="pointer-events-none absolute -left-32 -top-40 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(255_233_184/0.10),transparent)]" />

          <div className="relative grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="p-7 sm:p-10 lg:p-12">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <FilesProcessLogo />
                <span className="text-[13.5px] text-[var(--night-dim)]">Free PDF, image and audio tools</span>
              </div>

              {QUOTE ? (
                <blockquote className="mt-10">
                  <span aria-hidden className="font-display block text-[64px] leading-[0.6] text-[var(--lamp)]">“</span>
                  <p className="mt-2 text-[22px] font-medium leading-snug text-[var(--night-ink)] sm:text-[27px]">{QUOTE.text}</p>
                </blockquote>
              ) : (
                <p className="mt-10 text-[23px] font-medium leading-snug text-[var(--night-ink)] sm:text-[29px]">
                  Two bugs that only appear when a visitor moves{' '}
                  <span className="text-[var(--lamp)]">from one tool to the next</span>. A page-by-page check would have passed
                  both.
                </p>
              )}

              <figcaption className="mt-8 flex items-center gap-3 text-[14px]">
                {QUOTE ? (
                  <>
                    <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-[#16a34a] text-[15px] font-semibold text-white">
                      {QUOTE.name.charAt(0)}
                    </span>
                    <span>
                      <span className="block font-medium text-[var(--night-ink)]">{QUOTE.name}</span>
                      <span className="block text-[var(--night-dim)]">{QUOTE.role}, FilesProcess</span>
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--night-dim)]">
                    Snaghunt audit of <span className="text-[var(--night-ink)]">filesprocess.com</span> · results shown unedited
                  </span>
                )}
              </figcaption>

              <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-[var(--night-line)] pt-8 xl:grid-cols-4">
                {STATS.map((stat) => (
                  <div key={stat.label}>
                    <dt className="sr-only">{stat.label}</dt>
                    <dd>
                      <span className="font-display block whitespace-nowrap text-[30px] font-bold leading-none [font-stretch:125%]">{stat.value}</span>
                      <span className="index-label mt-2 block text-[var(--night-dim)]">{stat.label}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="border-t border-[var(--night-line)] bg-black/20 p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
              <p className="index-label text-[var(--night-dim)]">What it found</p>
              <ul className="mt-5 space-y-3">
                {FOUND.map((item) => (
                  <li key={item.title} className="rounded-xl border border-[var(--night-line)] bg-[var(--night-raised)] p-4">
                    <span className="mono inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[#f0a49b]">
                      <span aria-hidden className="size-1.5 rounded-full bg-[#e0695d]" />
                      {item.severity}
                    </span>
                    <p className="mt-2 text-[15px] font-medium leading-snug">{item.title}</p>
                    <p className="mono mt-1.5 truncate text-[11.5px] text-[#6b7079]">{item.where}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-[var(--night-line)] p-4">
                <div>
                  <p className="text-[15px] font-medium">Design review</p>
                  <p className="mt-0.5 text-[13px] text-[var(--night-dim)]">Strong design, 6 things to polish, in under 3 minutes</p>
                </div>
                <p className="flex shrink-0 items-baseline gap-1">
                  <span className="font-display text-[30px] font-bold leading-none [font-stretch:125%] text-[#7fd1a0]">94</span>
                  <span className="text-[13px] text-[var(--night-dim)]">/100</span>
                </p>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
