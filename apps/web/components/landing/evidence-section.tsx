import { SectionIndex } from './section-index';

const CONTENTS = [
  { title: 'The screenshot, marked', body: 'The control it clicked, circled on the page as it looked at that moment.' },
  { title: 'The exact steps', body: 'Every click and keystroke, in order, so anyone can reproduce it.' },
  { title: 'Expected and actual', body: 'What should have happened, next to what did.' },
  { title: 'The errors behind it', body: 'Console errors and failed requests from the same moment.' },
];

/** The morning after the night shift: what an audit hands you, as a case file. */
export function EvidenceSection() {
  return (
    <section id="evidence" className="scroll-mt-16 bg-[#faf9f6] text-[#141414]">
      <div data-reveal className="mx-auto grid max-w-[1280px] gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] lg:gap-16 lg:px-10 lg:py-28">
        <div data-reveal>
          <SectionIndex number="0.03" label="The case file" tone="paper" />
          <h2 className="display mt-6 text-[32px] text-[#141414] sm:text-[44px]">Every bug comes with evidence</h2>
          <p className="mt-6 max-w-[42ch] text-[16px] leading-relaxed text-[#4a4743]">
            In the morning you get a case file, not a hunch. Each finding is an exhibit you can check yourself in under a
            minute.
          </p>
          <dl className="mt-10 border-t border-[#141414]">
            {CONTENTS.map((item, index) => (
              <div key={item.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-b border-[#e4e1da] py-4">
                <span className="mono pt-0.5 text-[12px] text-[#8a867f]">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <dt className="text-[15px] font-semibold">{item.title}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-[#6e6b66]">{item.body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <Exhibit />
      </div>
    </section>
  );
}

function Exhibit() {
  return (
    <figure className="relative lg:pt-6" aria-label="Example finding: the Apply coupon button does nothing">
      {/* Screenshot */}
      <div className="relative border border-[#e4e1da] bg-white shadow-[0_1px_0_#e4e1da,0_24px_48px_-28px_rgb(20_20_20/0.35)] lg:rotate-[1deg]">
        <figcaption className="mono flex justify-between gap-4 border-b border-[#e4e1da] px-3 py-2.5 text-[11px] text-[#6e6b66]">
          <span>EXHIBIT A · /checkout/pay</span>
          <span>REPRODUCED 3 OF 3</span>
        </figcaption>
        <div className="relative aspect-[16/10] overflow-hidden bg-[#f1efea]" aria-hidden>
          <Shape x={4} y={5} w={16} h={3.5} />
          <Shape x={4} y={14} w={42} h={70} tone="#e6e2da" />
          <Shape x={51} y={15} w={38} h={6} tone="#cfcac0" />
          <Shape x={51} y={25} w={15} h={4.5} />
          <Shape x={51} y={35} w={44} h={2.5} />
          <Shape x={51} y={40} w={36} h={2.5} />
          <Shape x={51} y={52} w={27} h={8.5} tone="#ffffff" border />
          <Shape x={79.5} y={52} w={14} h={8.5} tone="#141414" />
          <Shape x={51} y={65} w={42.5} h={11} tone="#141414" />
          {/* The hand-drawn mark around the control that failed */}
          <svg className="absolute" style={{ left: '76%', top: '46.5%', width: '21%', height: '19.5%' }} viewBox="0 0 120 70" fill="none" preserveAspectRatio="none">
            <path
              d="M9 38 C7 15 50 6 82 9 C108 12 116 25 112 41 C107 58 63 64 36 60 C16 57 5 46 12 31 C16 23 26 17 37 14"
              stroke="#d92d20"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="mono absolute text-[10px] text-[#d92d20] sm:text-[11px]" style={{ left: '74%', top: '40%' }}>
            clicked 06:41:12
          </span>
        </div>
      </div>

      {/* Evidence slip */}
      <div className="relative mt-4 border border-[#e4e1da] bg-white p-5 text-[14px] leading-relaxed sm:mx-8 lg:-mt-14 lg:ml-[-2rem] lg:mr-24 lg:-rotate-[1.2deg]">
        <p className="mono text-[11px] tracking-[0.06em] text-[#6e6b66]">EVIDENCE · #033</p>
        <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-[#6e6b66]">We clicked</dt>
          <dd>“Apply” next to the coupon field</dd>
          <dt className="text-[#6e6b66]">Expected</dt>
          <dd>The total drops by 10%</dd>
          <dt className="text-[#6e6b66]">Happened</dt>
          <dd className="text-[#d92d20]">Nothing. The total stayed $128.00</dd>
          <dt className="text-[#6e6b66]">Console</dt>
          <dd className="mono text-[12.5px]">TypeError: promo is undefined</dd>
        </dl>
      </div>

      {/* Stamp */}
      <span
        className="mono absolute right-2 top-0 -rotate-6 border-2 border-[#d92d20] px-2.5 py-1 text-[12px] font-medium tracking-[0.1em] text-[#d92d20] sm:right-6 lg:-top-1"
        aria-hidden
      >
        HIGH · BUG
      </span>
    </figure>
  );
}

function Shape({ x, y, w, h, tone = '#dedad2', border = false }: { x: number; y: number; w: number; h: number; tone?: string; border?: boolean }) {
  return (
    <span
      className="absolute rounded-[3px]"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        background: tone,
        border: border ? '1px solid #c9c4ba' : undefined,
      }}
    />
  );
}
