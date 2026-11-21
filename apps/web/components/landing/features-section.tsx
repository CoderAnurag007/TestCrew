import { SectionIndex } from './section-index';

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Safe by default',
    body: 'Read-only mode blocks every request that changes data. Full mode only runs on domains you have verified, never touches live payment keys, and skips paths you block.',
  },
  {
    title: 'Real orders, on staging only',
    body: 'Give it a staging URL and it places orders and bookings end to end with published sandbox cards, then checks the order shows up where it should.',
  },
  {
    title: 'Every control, accounted for',
    body: 'A map of what each button and link does on every screen, including popups that will not close and buttons that do nothing.',
  },
  {
    title: 'Rules in plain English',
    body: 'Write “adding an item increases the cart count by one” and it becomes a test that runs on every audit.',
  },
  {
    title: 'Watch it work',
    body: 'A live view of the browser shows the page, the element it is about to click, and each step as it happens.',
  },
  {
    title: 'Fits your pipeline',
    body: 'Start audits from CI with a project token, fail the build on new bugs, and export the tests as a Playwright spec.',
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-16 border-b border-[var(--night-line)]">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:gap-16 lg:px-10 lg:py-28">
        <div data-reveal>
          <SectionIndex number="0.04" label="Built for real apps" />
          <h2 className="display mt-6 text-[32px] sm:text-[40px]">Safe on the night shift</h2>
          <p className="mt-5 max-w-[38ch] text-[15px] leading-relaxed text-[var(--night-dim)]">
            It works unsupervised, so the guardrails are built in rather than bolted on.
          </p>
        </div>
        <dl data-reveal className="grid border-t border-[var(--night-line)] sm:grid-cols-2 sm:gap-x-10">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="border-b border-[var(--night-line)] py-6">
              <dt className="text-[15px] font-semibold text-[var(--night-ink)]">{feature.title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-[var(--night-dim)]">{feature.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
