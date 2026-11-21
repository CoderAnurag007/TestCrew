import { DemoVideo } from './demo-video';
import { SectionIndex } from './section-index';

const STEPS = [
  {
    title: 'Explore',
    body: 'Signs in if you give it credentials, then maps your pages, forms and flows in a real browser.',
  },
  {
    title: 'Try everything',
    body: 'Clicks every control, opens and closes every popup, and runs journeys like checkout end to end.',
  },
  {
    title: 'Write and run tests',
    body: 'Turns what it found into Playwright tests, runs them, and retries flaky ones before blaming your app.',
  },
  {
    title: 'Report',
    body: 'Groups failures by cause, ranks them by severity, and attaches the screenshots and steps for each.',
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-b border-[var(--night-line)]">
      <div data-reveal className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
        <SectionIndex number="0.02" label="The shift" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="display mt-6 max-w-[16ch] text-[32px] sm:text-[44px]">How an audit runs</h2>
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-[var(--night-dim)]">
            From pasting an address to a bug report with evidence, in forty seconds.
          </p>
        </div>
        <div className="mt-12">
          <DemoVideo />
        </div>
        <ol data-reveal className="mt-10 grid gap-px overflow-hidden border border-[var(--night-line)] bg-[var(--night-line)] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-[var(--night)] p-6 lg:p-7">
              <span className="font-display block text-[44px] font-bold leading-none text-[#2a2d33] [font-stretch:125%]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-8 text-[17px] font-semibold text-[var(--night-ink)]">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--night-dim)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
