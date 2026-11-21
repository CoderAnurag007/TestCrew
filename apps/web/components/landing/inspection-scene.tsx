'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * The landing hero: a real-looking store page under inspection at night.
 * The page sits in darkness; a work lamp lights the control being tried, a
 * crosshair frames it exactly, and a verdict tag is pinned beside it. The click
 * has its real effect on the page (size selected, cart count goes up) or, for
 * the bug, none at all. Pages for the cart and checkout float behind in depth.
 * Pure CSS 3D, no WebGL, so every label stays sharp.
 */

export const PAGE_W = 600;
export const PAGE_H = 430;
const STEP_MS = 1800;

type Verdict = 'pass' | 'bug';
export type Target = {
  id: string;
  /** Exact box of the control on the page. */
  box: { x: number; y: number; w: number; h: number };
  action: string;
  result: string;
  verdict: Verdict;
  /** Where the tag sits: `x` is its right edge when align is "right". */
  tag: { x: number; y: number; align: 'left' | 'right' };
  /** Leader line from the tag to the crosshair. */
  lead: [number, number, number, number];
};

const PAD = 4;

export const TARGETS: Target[] = [
  {
    id: '#031',
    box: { x: 376, y: 172, w: 34, h: 28 },
    action: 'Size 42',
    result: 'Selected',
    verdict: 'pass',
    tag: { x: 360, y: 176, align: 'right' },
    lead: [360, 186, 372, 186],
  },
  {
    id: '#032',
    box: { x: 296, y: 214, w: 254, h: 40 },
    action: 'Add to cart',
    result: 'Cart 0 → 1',
    verdict: 'pass',
    tag: { x: 282, y: 224, align: 'right' },
    lead: [282, 234, 292, 234],
  },
  {
    id: '#033',
    box: { x: 468, y: 284, w: 82, h: 30 },
    action: 'Apply SAVE10',
    result: 'No effect',
    verdict: 'bug',
    tag: { x: 554, y: 326, align: 'right' },
    lead: [509, 318, 509, 326],
  },
  {
    id: '#034',
    box: { x: 308, y: 352, w: 128, h: 62 },
    action: 'Image 3',
    result: 'Returns 404',
    verdict: 'bug',
    tag: { x: 296, y: 373, align: 'right' },
    lead: [296, 383, 304, 383],
  },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function InspectionScene({ className, compact = false }: { className?: string; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [step, setStep] = useState(0);
  const reduced = usePrefersReducedMotion();

  // Fit the fixed-size stage to the available width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1.05, entry.contentRect.width / (PAGE_W + 70)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Walk through the controls, hold on the finished page, then start over.
  useEffect(() => {
    if (reduced) return;
    // Start once the page has set up (and the opening, if any, has played), so the first click is seen.
    const startIn = /^play/.test(document.documentElement.getAttribute('data-intro') ?? '') ? 3600 : 1400;
    let timer = 0;
    const start = window.setTimeout(() => {
      setStep((current) => current + 1);
      timer = window.setInterval(() => {
        setStep((current) => (current >= TARGETS.length + 2 ? 0 : current + 1));
      }, STEP_MS);
    }, startIn);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [reduced]);

  // `tried` controls have a verdict; `active` is the one under the lamp.
  const tried = reduced ? TARGETS.length : Math.min(step, TARGETS.length);
  const activeIndex = reduced ? 2 : Math.min(step, TARGETS.length - 1);
  const active = TARGETS[activeIndex] ?? TARGETS[0]!;
  const bugs = TARGETS.slice(0, tried).filter((t) => t.verdict === 'bug').length;

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({
      x: (event.clientX - rect.left) / rect.width - 0.5,
      y: (event.clientY - rect.top) / rect.height - 0.5,
    });
  };

  const lampStyle = {
    '--lx': `${active.box.x + active.box.w / 2}px`,
    '--ly': `${active.box.y + active.box.h / 2 - 30}px`,
  } as CSSProperties;

  const stageHeight = (PAGE_H + (compact ? 80 : 110)) * scale;

  return (
    <div
      ref={wrapRef}
      className={cn('relative w-full select-none', className)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <p className="sr-only">
        An example audit of a store’s product page: Snaghunt tries each control in turn. Choosing size 42 and Add to
        cart work; applying the code SAVE10 has no effect, and one product image returns 404.
      </p>
      <div aria-hidden style={{ height: stageHeight, perspective: 1900 * scale }} className="relative">
        <div
          className="absolute left-1/2 top-0 origin-top"
          style={{ width: PAGE_W, height: PAGE_H, transform: `translateX(-50%) scale(${scale})` }}
        >
          <div
            className="scene-stage relative size-full"
            style={{
              transform: `rotateX(${14 - tilt.y * 6}deg) rotateY(${-18 + tilt.x * 10}deg) rotateZ(2.5deg) translate3d(-28px, 16px, 0)`,
            }}
          >
            <BackWindow depth={-260} offset={52} path="/checkout/pay" dim={0.93}>
              <CheckoutPage />
            </BackWindow>
            <BackWindow depth={-130} offset={26} path="/cart" dim={0.88}>
              <CartPage />
            </BackWindow>

            {/* The page under inspection */}
            <Window path="/products/trail-runner-gtx">
              <ProductPage sizeSelected={tried >= 1} cartCount={tried >= 2 ? 1 : 0} />
              <div className="night-darkness" style={lampStyle} />
              <div className="lamp-tint" style={lampStyle} />
            </Window>

            {/* Annotations lie on the page plane, so they stay exactly on their controls. */}
            <div className="pointer-events-none absolute inset-0" style={{ transform: 'translateZ(1px)' }}>
              <svg className="absolute inset-0 overflow-visible" width={PAGE_W} height={PAGE_H}>
                {TARGETS.slice(0, tried).map((target) => {
                  const [x1, y1, x2, y2] = target.lead;
                  return (
                    <line
                      key={target.id}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={target.verdict === 'bug' ? 'var(--bug)' : 'var(--lamp)'}
                      strokeWidth={1.25}
                    />
                  );
                })}
              </svg>
              {TARGETS.map((target, index) => {
                const isActive = !reduced && index === step && step < TARGETS.length;
                const done = index < tried;
                return (
                  <div
                    key={target.id}
                    className="crosshair"
                    data-verdict={done ? target.verdict : undefined}
                    style={{
                      left: target.box.x - PAD,
                      top: target.box.y - PAD,
                      width: target.box.w + PAD * 2,
                      height: target.box.h + PAD * 2,
                      opacity: isActive || done ? 1 : 0,
                    }}
                  />
                );
              })}
              {TARGETS.slice(0, tried).map((target) => (
                <VerdictTag key={target.id} target={target} />
              ))}
            </div>
          </div>
        </div>

        {/* Heads-up line under the stage */}
        <div className="mono absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-[var(--night-line)] pt-3 text-[11px] tracking-[0.06em] text-[var(--night-dim)]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--lamp)]" />
            <span className="truncate">INSPECTING /PRODUCTS/TRAIL-RUNNER-GTX</span>
          </span>
          <span className="shrink-0 tabular">
            {String(tried).padStart(2, '0')}/{String(TARGETS.length).padStart(2, '0')} TRIED ·{' '}
            <span className={bugs ? 'text-[var(--bug)]' : undefined}>{bugs} {bugs === 1 ? 'BUG' : 'BUGS'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

function VerdictTag({ target }: { target: Target }) {
  const bug = target.verdict === 'bug';
  return (
    <div
      className={cn(
        'verdict-tag mono absolute whitespace-nowrap border bg-black px-1.5 py-[3px] text-[10.5px] font-medium leading-[14px] tracking-[0.02em]',
        bug ? 'border-[var(--bug)]' : 'border-[#4a4536]',
      )}
      style={{
        top: target.tag.y,
        ...(target.tag.align === 'right' ? { right: PAGE_W - target.tag.x } : { left: target.tag.x }),
      }}
    >
      <span className="text-[var(--night-dim)]">{target.id}</span>{' '}
      <span className="uppercase text-[var(--night-ink)]">{target.action}</span>{' '}
      <span className="text-[var(--night-dim)]">→</span>{' '}
      <span className={cn('uppercase', bug ? 'text-[var(--bug)]' : 'text-[var(--pass)]')}>
        {target.result} {bug ? '✕' : '✓'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Browser windows                                                     */
/* ------------------------------------------------------------------ */

export function Window({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <div className="clay-window">
      <div className="clay-shell" />
      <div className="clay-screen">
        <UrlBar path={path} />
        <div className="absolute inset-x-0 bottom-0 top-[30px]">{children}</div>
      </div>
      <div className="clay-lip" />
    </div>
  );
}

function BackWindow({
  depth,
  offset,
  path,
  dim,
  children,
}: {
  depth: number;
  offset: number;
  path: string;
  dim: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="clay-window"
      data-back=""
      style={{ transform: `translate3d(${offset}px, ${-offset}px, ${depth}px)` }}
    >
      <div className="clay-shell" />
      <div className="clay-screen">
        <UrlBar path={path} />
        <div className="absolute inset-x-0 bottom-0 top-[30px]">{children}</div>
        <div className="absolute inset-0" style={{ background: `rgb(6 7 8 / ${dim})` }} />
      </div>
      <div className="clay-lip" />
    </div>
  );
}

function UrlBar({ path }: { path: string }) {
  return (
    <div className="relative z-10 flex h-[30px] items-center gap-1.5 border-b border-[#24221f] bg-[#181715] px-3">
      <i className="size-2 rounded-full bg-[#2e3138]" />
      <i className="size-2 rounded-full bg-[#2e3138]" />
      <i className="size-2 rounded-full bg-[#2e3138]" />
      <span className="mono ml-3 flex h-[18px] min-w-0 flex-1 items-center rounded-[4px] bg-[#1b1d21] px-2 text-[10px] text-[#8a8f98]">
        <span className="truncate">
          staging.northtrail.shop<span className="text-[#c9ccd1]">{path}</span>
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* Coordinates below are page coordinates minus the 30px URL bar.      */
/* ------------------------------------------------------------------ */

const Y = (pageY: number) => pageY - 30;

function StoreHeader({ cartCount }: { cartCount: number }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-[36px] items-center border-b border-[#e3e0d8] bg-white px-6 text-[#1a1a1a]">
      <span className="font-display text-[13px] font-extrabold tracking-[0.12em] [font-stretch:115%]">NORTHTRAIL</span>
      <nav className="ml-8 flex gap-4 text-[10.5px] text-[#55524c]">
        <span>Men</span>
        <span>Women</span>
        <span className="text-[#1a1a1a] underline underline-offset-4">Trail</span>
        <span>Sale</span>
      </nav>
      <span className="ml-auto flex items-center gap-1.5 text-[10.5px] font-medium">
        <BagIcon />
        Cart
        <span
          className={cn(
            'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold transition-colors',
            cartCount ? 'bg-[#1f6f54] text-white' : 'bg-[#e9e6df] text-[#55524c]',
          )}
        >
          {cartCount}
        </span>
      </span>
    </div>
  );
}

export function ProductPage({ sizeSelected, cartCount }: { sizeSelected: boolean; cartCount: number }) {
  return (
    <div className="absolute inset-0 font-sans text-[#1a1a1a]">
      <StoreHeader cartCount={cartCount} />
      <p className="absolute left-6 text-[9.5px] text-[#8a867f]" style={{ top: Y(74) }}>
        Shoes / Trail / <span className="text-[#55524c]">Trail Runner GTX</span>
      </p>

      {/* Gallery */}
      <div className="absolute left-6 overflow-hidden rounded-[6px] bg-[#e9e6df]" style={{ top: Y(94), width: 250, height: 236 }}>
        <Shoe className="absolute left-[14px] top-[62px] w-[222px]" upper="#2f5d50" toe="#24483e" />
        <span className="absolute left-2.5 top-2.5 rounded-[3px] bg-white px-1.5 py-0.5 text-[8.5px] font-semibold">New</span>
      </div>

      {/* Buy box */}
      <div className="absolute" style={{ left: 296, top: Y(88), width: 254 }}>
        <h3 className="text-[19px] font-semibold leading-6 tracking-[-0.01em]">Trail Runner GTX</h3>
        <div className="mt-1.5 flex items-baseline gap-3">
          <span className="text-[15px] font-semibold">$128.00</span>
          <span className="text-[9.5px] text-[#8a867f]">
            <span className="tracking-[0.1em] text-[#c47f12]">★★★★</span>
            <span className="tracking-[0.1em] text-[#d8d3c8]">★</span> 212 reviews
          </span>
        </div>
      </div>
      <p className="absolute text-[9.5px] font-medium text-[#55524c]" style={{ left: 296, top: Y(155) }}>
        Size (EU)
      </p>
      {[40, 41, 42, 43, 44].map((size, index) => {
        const selected = size === 42 && sizeSelected;
        return (
          <span
            key={size}
            className={cn(
              'absolute grid place-items-center rounded-[4px] border text-[10.5px] font-medium transition-colors duration-300',
              selected ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white' : 'border-[#d6d2c9] bg-white text-[#1a1a1a]',
            )}
            style={{ left: 296 + index * 40, top: Y(172), width: 34, height: 28 }}
          >
            {size}
          </span>
        );
      })}
      <span
        className="absolute grid place-items-center rounded-[5px] bg-[#1f6f54] text-[12px] font-semibold text-white"
        style={{ left: 296, top: Y(214), width: 254, height: 40 }}
      >
        Add to cart
      </span>

      <p className="absolute text-[9.5px] font-medium text-[#55524c]" style={{ left: 296, top: Y(266) }}>
        Promo code
      </p>
      <span
        className="mono absolute flex items-center rounded-[4px] border border-[#d6d2c9] bg-white px-2 text-[11px] tracking-[0.04em]"
        style={{ left: 296, top: Y(284), width: 164, height: 30 }}
      >
        SAVE10
        <span className="ml-px h-3.5 w-px bg-[#1a1a1a]" />
      </span>
      <span
        className="absolute grid place-items-center rounded-[4px] border border-[#1a1a1a] bg-white text-[11px] font-semibold"
        style={{ left: 468, top: Y(284), width: 82, height: 30 }}
      >
        Apply
      </span>

      {/* Recommendations */}
      <p className="absolute left-6 text-[10px] font-semibold" style={{ top: Y(332) }}>
        You may also like
      </p>
      <Thumb x={24} upper="#8a3b2b" toe="#6e2d20" name="Ridge Mid" />
      <Thumb x={166} upper="#3b4f7a" toe="#2c3c5e" name="Scree Lite" />
      <BrokenThumb x={308} />
      <Thumb x={450} upper="#5b5b5b" toe="#404040" name="Fell Pro" w={126} />
    </div>
  );
}

function Thumb({ x, upper, toe, name, w = 130 }: { x: number; upper: string; toe: string; name: string; w?: number }) {
  return (
    <div className="absolute overflow-hidden rounded-[5px] bg-[#e9e6df]" style={{ left: x, top: Y(352), width: w, height: 62 }}>
      <Shoe className="absolute left-2 top-[9px] w-[74px]" upper={upper} toe={toe} />
      <span className="absolute right-2 top-2 text-right text-[8.5px] font-medium leading-tight">
        {name}
        <br />
        <span className="text-[#8a867f]">$118</span>
      </span>
    </div>
  );
}

function BrokenThumb({ x }: { x: number }) {
  return (
    <div
      className="absolute flex items-center gap-2 rounded-[5px] border border-dashed border-[#c9c4ba] bg-white px-3"
      style={{ left: x, top: Y(352), width: 128, height: 62 }}
    >
      <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-[#a8a39a]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 5h12m4 0h2v14H3V5" />
        <path d="m3 16 5-5 4 4" />
        <path d="M2 2l20 20" />
      </svg>
      <span className="mono text-[8.5px] leading-tight text-[#8a867f]">
        trail-bottle
        <br />
        .jpg
      </span>
    </div>
  );
}

/** Side view of a trail running shoe. */
export function Shoe({ className, upper, toe }: { className?: string; upper: string; toe: string }) {
  return (
    <svg viewBox="0 0 200 104" className={className} fill="none">
      {/* outsole lugs */}
      <g fill="#2a2a2a">
        {[16, 34, 52, 70, 88, 106, 124, 142, 160, 176].map((x) => (
          <rect key={x} x={x} y={84} width={10} height={6} rx={1.5} />
        ))}
      </g>
      {/* outsole */}
      <path d="M8 76 L192 76 Q197 76 196 82 Q194 87 188 87 L16 87 Q8 87 7 81 Z" fill="#2f2f2f" />
      {/* midsole */}
      <path d="M10 64 L190 64 Q198 66 196 76 L8 76 Q5 69 10 64 Z" fill="#f4f1ea" stroke="#d3cec4" strokeWidth="1" />
      <path d="M40 70 L150 70" stroke="#d3cec4" strokeWidth="1" />
      {/* upper */}
      <path
        d="M12 64 C10 50 18 40 34 38 L72 32 C84 18 104 12 122 16 L134 36 C154 42 176 50 190 58 L194 64 Z"
        fill={upper}
      />
      {/* toe cap */}
      <path d="M150 44 C168 48 184 54 192 60 L194 64 L150 64 Q144 54 150 44 Z" fill={toe} />
      {/* heel counter */}
      <path d="M12 64 C10 50 18 40 34 38 L44 64 Z" fill={toe} />
      {/* collar and tongue */}
      <path d="M72 32 C82 26 96 24 108 28" stroke="#f4f1ea" strokeWidth="2.5" strokeLinecap="round" />
      {/* laces */}
      <g stroke="#f4f1ea" strokeWidth="2" strokeLinecap="round">
        <path d="M110 22 L122 30" />
        <path d="M116 30 L128 38" />
        <path d="M122 38 L136 44" />
        <path d="M130 45 L144 49" />
      </g>
      {/* side panel stripes */}
      <g stroke="#f4f1ea" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round">
        <path d="M70 58 L96 36" />
        <path d="M82 58 L106 40" />
      </g>
      {/* pull tab */}
      <path d="M18 40 L14 30 L22 31 Z" fill={toe} />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function CartPage() {
  return (
    <div className="absolute inset-0 text-[#1a1a1a]">
      <StoreHeader cartCount={1} />
      <h3 className="absolute left-6 text-[18px] font-semibold" style={{ top: Y(84) }}>
        Your cart
      </h3>
      <div className="absolute left-6 flex items-center gap-4 border-y border-[#e3e0d8] py-3" style={{ top: Y(124), width: 340 }}>
        <div className="h-[58px] w-[80px] shrink-0 rounded-[5px] bg-[#e9e6df]" />
        <div className="text-[11px]">
          <p className="font-semibold">Trail Runner GTX</p>
          <p className="text-[#8a867f]">EU 42 · Qty 1</p>
        </div>
        <span className="ml-auto text-[11px] font-semibold">$128.00</span>
      </div>
      <div className="absolute rounded-[6px] bg-white p-4 text-[11px]" style={{ left: 388, top: Y(124), width: 188 }}>
        <p className="flex justify-between">
          <span>Subtotal</span>
          <span>$128.00</span>
        </p>
        <span className="mt-4 grid h-9 place-items-center rounded-[5px] bg-[#1f6f54] font-semibold text-white">Checkout</span>
      </div>
    </div>
  );
}

function CheckoutPage() {
  return (
    <div className="absolute inset-0 text-[#1a1a1a]">
      <StoreHeader cartCount={1} />
      <h3 className="absolute left-6 text-[18px] font-semibold" style={{ top: Y(84) }}>
        Payment
      </h3>
      <div className="absolute left-6 space-y-2.5" style={{ top: Y(124), width: 300 }}>
        <span className="mono flex h-8 items-center rounded-[4px] border border-[#d6d2c9] bg-white px-2 text-[11px]">
          4242 4242 4242 4242
        </span>
        <div className="flex gap-2.5">
          <span className="mono flex h-8 flex-1 items-center rounded-[4px] border border-[#d6d2c9] bg-white px-2 text-[11px]">12 / 34</span>
          <span className="mono flex h-8 flex-1 items-center rounded-[4px] border border-[#d6d2c9] bg-white px-2 text-[11px]">123</span>
        </div>
        <span className="grid h-9 place-items-center rounded-[5px] bg-[#1f6f54] text-[12px] font-semibold text-white">Pay $128.00</span>
      </div>
    </div>
  );
}
