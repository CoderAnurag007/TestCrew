'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PAGE_H, PAGE_W, ProductPage, Shoe, TARGETS, Window } from '@/components/landing/inspection-scene';

/**
 * "How an audit runs" as a 40-second film. Everything on screen is a pure
 * function of the time `t` (seconds), so the renderer can step frame by frame
 * and every frame comes out the same: no CSS transitions or animations here.
 * Stage: 1920×1080.
 */

export const FILM_DURATION = 40;
export const FILM_W = 1920;
export const FILM_H = 1080;

/* ----------------------------------------------------------------- timing */

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x: number) => 1 - Math.pow(1 - x, 3);
const outBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
/** Eased progress of `t` between `a` and `b`. */
const p = (t: number, a: number, b: number, ease: (x: number) => number = inOut) => ease(clamp((t - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Span = [number, number];
const SCENES = {
  intro: [0, 3.7] as Span,
  add: [3.4, 10.2] as Span,
  explore: [9.9, 17.8] as Span,
  tests: [17.5, 22.8] as Span,
  evidence: [22.5, 30.3] as Span,
  design: [30, 35.5] as Span,
  end: [35.2, FILM_DURATION + 1] as Span,
};
const FADE = 0.45;

function presence(t: number, [a, b]: Span) {
  return Math.min(p(t, a, a + FADE, out), 1 - p(t, b - FADE, b, inOut));
}

const CHAPTERS = [
  { span: SCENES.add, n: '01', title: 'Add your site', sub: 'Paste the address. Audits are read-only unless you say otherwise.' },
  { span: SCENES.explore, n: '02', title: 'It tries everything', sub: 'Every page, button and form, in a real browser, like a QA crew on the night shift.' },
  { span: SCENES.tests, n: '03', title: 'Writes and runs tests', sub: 'What it finds becomes Playwright tests, run and re-run before blaming your app.' },
  { span: SCENES.evidence, n: '04', title: 'Every bug with evidence', sub: 'The screenshot, the exact steps, expected and actual. One click to a ticket.' },
  { span: SCENES.design, n: '05', title: 'And how it looks', sub: 'An optional design review: layout, readability, phone and accessibility.' },
];

/* ------------------------------------------------------------------ film */

export function DemoFilm({ t }: { t: number }) {
  const paper = presence(t, SCENES.evidence);
  return (
    <div
      className="film relative overflow-hidden text-[#edeef0]"
      style={{ width: FILM_W, height: FILM_H, background: mix('#060708', '#f4f2ed', paper) }}
    >
      <Glow t={t} paper={paper} />
      {presence(t, SCENES.intro) > 0 ? <Intro t={t} /> : null}
      {presence(t, SCENES.add) > 0 ? <AddSite t={t} /> : null}
      {presence(t, SCENES.explore) > 0 ? <Explore t={t} /> : null}
      {presence(t, SCENES.tests) > 0 ? <Tests t={t} /> : null}
      {presence(t, SCENES.evidence) > 0 ? <Evidence t={t} /> : null}
      {presence(t, SCENES.design) > 0 ? <Design t={t} /> : null}
      {presence(t, SCENES.end) > 0 ? <End t={t} /> : null}
      <Captions t={t} paper={paper} />
      <Cursor t={t} />
    </div>
  );
}

/** Blends two hex colours. */
function mix(a: string, b: string, k: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i]!, k))).join(' ')})`;
}

function Glow({ t, paper }: { t: number; paper: number }) {
  // The work lamp: a soft pool that drifts with the story.
  const x = lerp(1180, 820, p(t, 9, 18)) + Math.sin(t * 0.6) * 30;
  const y = lerp(380, 460, p(t, 0, 40)) + Math.cos(t * 0.5) * 20;
  return (
    <div
      aria-hidden
      className="absolute rounded-full"
      style={{
        left: x - 700,
        top: y - 700,
        width: 1400,
        height: 1400,
        opacity: 1 - paper,
        background: 'radial-gradient(closest-side, rgb(255 233 184 / 0.12), rgb(255 233 184 / 0.035) 55%, transparent)',
      }}
    />
  );
}

/* --------------------------------------------------------------- captions */

function Captions({ t, paper }: { t: number; paper: number }) {
  const active = CHAPTERS.find((chapter) => t >= chapter.span[0] && t < chapter.span[1]);
  const ink = mix('#edeef0', '#141414', paper);
  const dim = mix('#8a8f98', '#6e6b66', paper);
  const line = mix('#1a1c20', '#ddd9d0', paper);
  const show = active ? Math.min(p(t, active.span[0] + 0.25, active.span[0] + 0.9, out), 1 - p(t, active.span[1] - 0.5, active.span[1] - 0.1)) : 0;
  const overall = presence(t, [SCENES.add[0], SCENES.design[1]]);
  return (
    <>
      {active ? (
        <div className="absolute" style={{ left: 120, top: 900, width: 1100, opacity: show, transform: `translateY(${(1 - show) * 18}px)` }}>
          <div className="flex items-baseline gap-5">
            <span className="mono text-[20px] tracking-[0.08em]" style={{ color: dim }}>
              {active.n}
            </span>
            <span className="display text-[46px]" style={{ color: ink, lineHeight: 1 }}>
              {active.title}
            </span>
          </div>
          <p className="mt-3 pl-[52px] text-[21px] leading-snug" style={{ color: dim }}>
            {active.sub}
          </p>
        </div>
      ) : null}
      {/* Chapter rail */}
      <div className="absolute flex gap-3" style={{ left: 120, right: 120, top: 1038, opacity: overall }}>
        {CHAPTERS.map((chapter) => {
          const fill = p(t, chapter.span[0], chapter.span[1], (x) => x);
          return (
            <div key={chapter.n} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: line }}>
              <div className="h-full rounded-full bg-[#ffe9b8]" style={{ width: `${fill * 100}%`, opacity: paper > 0.5 && fill > 0 && fill < 1 ? 1 : 0.9, background: paper > 0.5 ? '#141414' : '#ffe9b8' }} />
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- intro */

function Intro({ t }: { t: number }) {
  const o = presence(t, SCENES.intro);
  const words = ['From', 'URL', 'to', 'evidence.'];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ opacity: o }}>
      <div className="flex items-center gap-3 text-[18px]" style={{ opacity: p(t, 0.2, 0.8) }}>
        <span className="mono border border-[#2a2d33] px-2 py-0.5 text-[#edeef0]">0.02</span>
        <span className="index-label !text-[16px] text-[#8a8f98]">How an audit runs</span>
      </div>
      <h1 className="display mt-8 flex gap-[0.28em] text-[104px]">
        {words.map((word, index) => {
          const k = p(t, 0.45 + index * 0.12, 1.35 + index * 0.12, out);
          return (
            <span key={word} className="inline-block overflow-hidden pb-[0.06em]">
              <span className={index === 3 ? 'inline-block text-[#3a3e45]' : 'inline-block'} style={{ transform: `translateY(${(1 - k) * 110}%)` }}>
                {word}
              </span>
            </span>
          );
        })}
      </h1>
      <p className="mt-8 text-[26px] text-[#8a8f98]" style={{ opacity: p(t, 1.4, 2.1), transform: `translateY(${(1 - p(t, 1.4, 2.1, out)) * 12}px)` }}>
        Forty seconds, one audit, start to finish.
      </p>
    </div>
  );
}

/* ---------------------------------------------------- shared app chrome */

/** A light browser window with the Snaghunt app inside. */
function AppWindow({ children, url, style }: { children: ReactNode; url: string; style?: CSSProperties }) {
  return (
    <div className="absolute overflow-hidden rounded-[18px] bg-[#f7f7f8] text-[#141414]" style={{ boxShadow: '0 50px 120px -30px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(255 255 255 / 0.06)', ...style }}>
      <div className="flex h-[52px] items-center gap-2.5 border-b border-[#e6e7e9] bg-[#fbfbfc] px-5">
        <i className="size-3.5 rounded-full bg-[#e4e5e8]" />
        <i className="size-3.5 rounded-full bg-[#e4e5e8]" />
        <i className="size-3.5 rounded-full bg-[#e4e5e8]" />
        <span className="mono ml-6 flex h-8 w-[560px] items-center rounded-[8px] bg-[#f0f1f3] px-4 text-[15px] text-[#6b7079]">{url}</span>
      </div>
      <div className="relative" style={{ height: 'calc(100% - 52px)' }}>
        {children}
      </div>
    </div>
  );
}

function Sidebar({ active }: { active: 'overview' | 'projects' }) {
  return (
    <div className="absolute inset-y-0 left-0 w-[260px] border-r border-[#e6e7e9] bg-[#f3f4f5] px-4 py-5">
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid size-8 place-items-center rounded-[8px] bg-[#141414]">
          <span className="size-3.5 border-2 border-white" />
        </span>
        <span className="text-[19px] font-semibold">Snaghunt</span>
      </div>
      <div className="mt-8 space-y-1 text-[17px]">
        <div className={active === 'overview' ? 'rounded-[8px] bg-white px-3 py-2.5 font-medium shadow-[0_0_0_1px_#e6e7e9]' : 'px-3 py-2.5 text-[#3d4148]'}>Overview</div>
        <div className={active === 'projects' ? 'rounded-[8px] bg-white px-3 py-2.5 font-medium shadow-[0_0_0_1px_#e6e7e9]' : 'px-3 py-2.5 text-[#3d4148]'}>Projects</div>
      </div>
      <div className="absolute inset-x-4 bottom-5 rounded-[8px] px-3 py-2.5 text-[15px] text-[#3d4148]">Pro trial · 14 days left</div>
    </div>
  );
}

function Toast({ text, o }: { text: string; o: number }) {
  return (
    <div
      className="absolute flex items-center gap-3 rounded-[12px] bg-white px-5 py-4 text-[17px] shadow-[0_18px_40px_-12px_rgb(0_0_0_/_0.25),0_0_0_1px_#e6e7e9]"
      style={{ right: 36, bottom: 36, opacity: o, transform: `translateY(${(1 - o) * 24}px)` }}
    >
      <span className="grid size-6 place-items-center rounded-full bg-[#127a3e] text-[13px] text-white">✓</span>
      {text}
    </div>
  );
}

/* ---------------------------------------------------------- 01 add site */

const URL_TEXT = 'northtrail.shop';
/** The add-site scene pushes in on the dialog; the cursor follows the same zoom. */
const ADD_ORIGIN = { x: 960, y: 532 };
function addZoom(t: number) {
  return 1 + 0.06 * p(t, 3.9, 5.2) - 0.06 * p(t, 7.3, 8.1);
}
const ADD_WIN = { x: 210, y: 70, w: 1500, h: 790 };
/** Where things are in the add-site scene, in stage pixels (for the cursor). */
const ADD_INPUT = { x: 830, y: 430 };
const ADD_BUTTON = { x: 1119, y: 689 };

function AddSite({ t }: { t: number }) {
  const o = presence(t, SCENES.add);
  const rise = p(t, SCENES.add[0], SCENES.add[0] + 0.9, out);
  const typed = URL_TEXT.slice(0, Math.floor(clamp((t - 4.5) / 1.5) * URL_TEXT.length));
  const pressed = t > 7.15 && t < 7.4;
  const dialog = 1 - p(t, 7.45, 7.85);
  const toast = Math.min(p(t, 7.9, 8.3, out), 1 - p(t, 9.5, 9.9));
  // Push in on the dialog while typing.
  const zoom = addZoom(t);
  const caret = Math.floor(t * 2.2) % 2 === 0 && t < 7.4;
  return (
    <div className="absolute inset-0" style={{ opacity: o, transform: `translateY(${(1 - rise) * 60}px) scale(${zoom})`, transformOrigin: `${ADD_ORIGIN.x}px ${ADD_ORIGIN.y}px` }}>
      <AppWindow url="app.snaghunt.com/dashboard" style={{ left: ADD_WIN.x, top: ADD_WIN.y, width: ADD_WIN.w, height: ADD_WIN.h }}>
        <Sidebar active="overview" />
        <div className="absolute left-[260px] right-0 top-0 px-14 py-10">
          <p className="text-[16px] text-[#6b7079]">Signed in as Sam</p>
          <h2 className="mt-1 text-[38px] font-semibold tracking-[-0.02em]">Sam’s workspace</h2>
          <div className="mt-8 rounded-[12px] border border-[#e6e7e9] bg-white">
            <div className="border-b border-[#e6e7e9] px-7 py-5">
              <p className="text-[20px] font-semibold">Get started with Snaghunt</p>
              <p className="mt-1 text-[16px] text-[#6b7079]">0 of 4 done · about 5 minutes of your time</p>
            </div>
            {['Add your website', 'Start your first audit', 'Read your first report', 'Get told when something breaks'].map((step, index) => (
              <div key={step} className="flex items-center gap-4 border-b border-[#f0f1f3] px-7 py-4 text-[18px] last:border-0">
                <span className="grid size-8 place-items-center rounded-full border border-[#d9dbde] text-[15px]">{index + 1}</span>
                {step}
              </div>
            ))}
          </div>
          {t > 7.85 ? (
            <div className="mt-6 flex items-center justify-between rounded-[12px] border border-[#e6e7e9] bg-white px-7 py-5 text-[18px]" style={{ opacity: p(t, 7.9, 8.3) }}>
              <span className="font-medium">northtrail.shop</span>
              <span className="flex items-center gap-2 text-[#1f6fd1]">
                <span className="size-2.5 rounded-full bg-[#1f6fd1]" /> Starting the audit…
              </span>
            </div>
          ) : null}
        </div>

        {/* Add a website */}
        {dialog > 0 ? (
          <div className="absolute inset-0 grid place-items-center bg-[rgb(20_20_20/0.28)]" style={{ opacity: dialog }}>
            <div className="w-[620px] rounded-[16px] bg-white p-9 shadow-[0_40px_80px_-20px_rgb(0_0_0/0.35)]" style={{ transform: `scale(${0.97 + 0.03 * dialog})` }}>
              <h3 className="text-[28px] font-semibold tracking-[-0.01em]">Add a website</h3>
              <p className="mt-1.5 text-[17px] text-[#6b7079]">We’ll audit it right away. Nothing on your site changes.</p>
              <label className="mt-7 block text-[16px] font-medium">Website address</label>
              <div className="mt-2 flex h-14 items-center rounded-[10px] border-2 px-4 text-[20px]" style={{ borderColor: t > 3.95 ? '#141414' : '#dcdee1' }}>
                <span className="text-[#9aa0a8]">https://</span>
                <span>{typed}</span>
                {caret && t > 3.95 ? <span className="ml-0.5 h-6 w-[2px] bg-[#141414]" /> : null}
                {!typed && t <= 3.95 ? <span className="text-[#b9bdc3]">your-site.com</span> : null}
              </div>
              <label className="mt-5 block text-[16px] font-medium">Name</label>
              <div className="mt-2 flex h-14 items-center rounded-[10px] border border-[#dcdee1] px-4 text-[20px] text-[#6b7079]">
                {typed.length > 9 ? 'Northtrail' : 'Optional'}
              </div>
              <div className="mt-6 flex items-center gap-3 rounded-[10px] bg-[#f3f4f5] px-4 py-3 text-[16px] text-[#3d4148]">
                <span className="grid size-5 place-items-center rounded-[5px] bg-[#127a3e] text-[12px] text-white">✓</span>
                Read-only: forms are filled in, never sent
              </div>
              <div className="mt-7 flex justify-end gap-3">
                <span className="rounded-full border border-[#dcdee1] px-6 py-3 text-[17px] font-medium">Cancel</span>
                <span
                  className="rounded-full px-6 py-3 text-[17px] font-medium text-white"
                  style={{ background: pressed ? '#000' : '#141414', transform: `scale(${pressed ? 0.96 : 1})` }}
                >
                  Add site and start audit
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <Toast text="Audit started · opening the live view" o={toast} />
      </AppWindow>
    </div>
  );
}

/* ------------------------------------------------------- 02 explore */

const SITE_SCALE = 1.62;
const SITE = { x: 130, y: 90 };
const STEP_START = 10.9;
const STEP_EVERY = 1.45;

function Explore({ t }: { t: number }) {
  const o = presence(t, SCENES.explore);
  const rise = p(t, SCENES.explore[0], SCENES.explore[0] + 1.1, out);
  const step = (t - STEP_START) / STEP_EVERY;
  const tried = clamp(Math.floor(step + 0.4), 0, TARGETS.length);
  const fromIndex = clamp(Math.floor(step), 0, TARGETS.length - 1);
  const toIndex = clamp(fromIndex + 1, 0, TARGETS.length - 1);
  const glide = step < 0 ? 0 : p(step - fromIndex, 0.55, 1);
  const from = TARGETS[fromIndex]!;
  const to = TARGETS[toIndex]!;
  const lx = lerp(from.box.x + from.box.w / 2, to.box.x + to.box.w / 2, glide);
  const ly = lerp(from.box.y + from.box.h / 2, to.box.y + to.box.h / 2, glide) - 30;
  const lit = p(t, SCENES.explore[0] + 0.6, SCENES.explore[0] + 1.4);
  const darkness = {
    background: `rgb(5 6 7 / ${0.8 * lit})`,
    WebkitMaskImage: `radial-gradient(circle 200px at ${lx}px ${ly}px, rgb(0 0 0 / 0.04) 0, rgb(0 0 0 / 0.1) 38%, #000 100%)`,
    maskImage: `radial-gradient(circle 200px at ${lx}px ${ly}px, rgb(0 0 0 / 0.04) 0, rgb(0 0 0 / 0.1) 38%, #000 100%)`,
  } as CSSProperties;
  const bugs = TARGETS.slice(0, tried).filter((target) => target.verdict === 'bug').length;
  const pages = Math.round(lerp(1, 14, p(t, 10.5, 17)));
  const controls = Math.round(lerp(0, 212, p(t, 10.5, 17.2, (x) => x)));

  return (
    <div className="absolute inset-0" style={{ opacity: o, transform: `translateY(${(1 - rise) * 50}px)` }}>
      <div className="absolute" style={{ left: SITE.x, top: SITE.y, width: PAGE_W, height: PAGE_H, transform: `scale(${SITE_SCALE})`, transformOrigin: '0 0' }}>
        <Window path="/products/trail-runner-gtx">
          <ProductPage sizeSelected={tried >= 1} cartCount={tried >= 2 ? 1 : 0} />
          <div className="absolute inset-0" style={darkness} />
        </Window>
        {/* Crosshairs and verdicts lie on the page */}
        <div className="pointer-events-none absolute inset-0">
          {TARGETS.map((target, index) => {
            const appear = clamp((step - index) * 3 + 1);
            if (appear <= 0) return null;
            const done = index < tried;
            const color = done ? (target.verdict === 'bug' ? '#ff5a4a' : '#ffe9b8') : '#ffe9b8';
            const pad = 4 + (1 - appear) * 10;
            return (
              <div key={target.id}>
                <span
                  className="absolute rounded-[3px] border-[1.5px]"
                  style={{ left: target.box.x - pad, top: target.box.y - pad, width: target.box.w + pad * 2, height: target.box.h + pad * 2, borderColor: color, opacity: appear }}
                />
                {done ? (
                  <span
                    className="mono absolute whitespace-nowrap border bg-black px-1.5 py-[3px] text-[10.5px] font-medium leading-[14px]"
                    style={{
                      top: target.tag.y,
                      right: PAGE_W - target.tag.x,
                      borderColor: target.verdict === 'bug' ? '#ff5a4a' : '#4a4536',
                      opacity: clamp((step - index - 0.6) * 4),
                    }}
                  >
                    <span className="text-[#8a8f98]">{target.id}</span> <span className="uppercase">{target.action}</span>{' '}
                    <span className="text-[#8a8f98]">→</span>{' '}
                    <span className="uppercase" style={{ color: target.verdict === 'bug' ? '#ff5a4a' : '#7bd88f' }}>
                      {target.result} {target.verdict === 'bug' ? '✕' : '✓'}
                    </span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live panel */}
      <div className="absolute rounded-[16px] border border-[#1a1c20] bg-[#0b0c0e] p-7" style={{ left: 1170, top: 90, width: 620, height: 700 }}>
        <div className="flex items-center justify-between">
          <span className="mono flex items-center gap-2.5 text-[15px] tracking-[0.08em] text-[#8a8f98]">
            <span className="size-2.5 rounded-full bg-[#ff5a4a]" style={{ opacity: 0.55 + 0.45 * Math.abs(Math.sin(t * 3)) }} /> LIVE · NORTHTRAIL.SHOP
          </span>
          <span className="mono text-[15px] text-[#8a8f98]">{formatClock(t - 10)}</span>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Pages" value={pages} />
          <Stat label="Controls tried" value={controls} />
          <Stat label="Bugs" value={bugs} bad={bugs > 0} />
        </div>
        <div className="mt-7 space-y-2">
          {LOG.map((row, index) => {
            const at = row.at;
            const k = p(t, at, at + 0.35, out);
            if (k <= 0) return null;
            return (
              <div key={row.text} className="flex items-start gap-3 rounded-[10px] bg-[#111215] px-4 py-3 text-[16.5px]" style={{ opacity: k, transform: `translateX(${(1 - k) * 16}px)` }}>
                <span className="mt-0.5" style={{ color: row.tone === 'bug' ? '#ff5a4a' : row.tone === 'pass' ? '#7bd88f' : '#8a8f98' }}>
                  {row.tone === 'bug' ? '✕' : row.tone === 'pass' ? '✓' : '•'}
                </span>
                <span className={row.tone === 'bug' ? 'text-[#edeef0]' : 'text-[#c9ccd1]'}>{row.text}</span>
                <span className="mono ml-auto shrink-0 text-[13px] text-[#5b6068]">{formatClock(at - 10)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const LOG = [
  { at: 10.3, text: 'Opened /products/trail-runner-gtx', tone: 'info' },
  { at: STEP_START + 0.9, text: 'Size 42 → selected', tone: 'pass' },
  { at: STEP_START + STEP_EVERY + 0.9, text: 'Add to cart → cart 0 → 1', tone: 'pass' },
  { at: STEP_START + 2 * STEP_EVERY + 0.9, text: 'Apply SAVE10 → nothing changed', tone: 'bug' },
  { at: STEP_START + 3 * STEP_EVERY + 0.9, text: 'Image 3 → returns 404', tone: 'bug' },
  { at: 16.6, text: 'Checkout reached on staging with a test card', tone: 'pass' },
];

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds * 9));
  return `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-[12px] border border-[#1a1c20] px-4 py-3.5">
      <p className="text-[14px] text-[#8a8f98]">{label}</p>
      <p className="font-display mt-1 text-[34px] font-bold leading-none [font-stretch:125%]" style={{ color: bad ? '#ff5a4a' : '#edeef0' }}>
        {value}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- 03 tests */

const TESTS = [
  { name: 'Home page loads and links work', source: 'Generated', ok: true },
  { name: 'Search finds “trail runner”', source: 'Journey', ok: true },
  { name: 'Choose a size and add to cart', source: 'Journey', ok: true },
  { name: 'Apply promo code SAVE10', source: 'Generated', ok: false },
  { name: 'Product image gallery loads', source: 'Generated', ok: false },
  { name: 'Cart total updates with quantity', source: 'Your rule', ok: true },
  { name: 'Checkout with a sandbox card', source: 'Journey', ok: true },
  { name: 'Sign-up form shows clear errors', source: 'Generated', ok: true },
];

function Tests({ t }: { t: number }) {
  const o = presence(t, SCENES.tests);
  const rise = p(t, SCENES.tests[0], SCENES.tests[0] + 0.9, out);
  const start = 18.2;
  const each = 0.42;
  const finished = TESTS.filter((_, index) => t > start + index * each + 0.6).length;
  const passed = TESTS.filter((test, index) => test.ok && t > start + index * each + 0.6).length;
  const failed = finished - passed;
  return (
    <div className="absolute inset-0" style={{ opacity: o, transform: `translateY(${(1 - rise) * 50}px)` }}>
      <div className="absolute rounded-[18px] bg-white text-[#141414]" style={{ left: 260, top: 80, width: 1400, height: 760, boxShadow: '0 50px 120px -30px rgb(0 0 0 / 0.75)' }}>
        <div className="flex items-center justify-between border-b border-[#e6e7e9] px-10 py-7">
          <div>
            <p className="text-[28px] font-semibold tracking-[-0.01em]">Tests</p>
            <p className="mt-1 text-[17px] text-[#6b7079]">Written from what it explored, run in the same browser</p>
          </div>
          <div className="flex gap-8 text-[18px]">
            <span>
              <b className="font-display text-[34px] text-[#127a3e] [font-stretch:125%]">{passed}</b> passed
            </span>
            <span>
              <b className="font-display text-[34px] text-[#c42b1c] [font-stretch:125%]">{failed}</b> failed
            </span>
          </div>
        </div>
        <div className="h-[3px] bg-[#f0f1f3]">
          <div className="h-full bg-[#141414]" style={{ width: `${(finished / TESTS.length) * 100}%` }} />
        </div>
        <div className="px-10 py-3">
          {TESTS.map((test, index) => {
            const at = start + index * each;
            const running = t > at && t <= at + 0.6;
            const done = t > at + 0.6;
            return (
              <div key={test.name} className="flex items-center gap-5 border-b border-[#f0f1f3] py-[17px] text-[19px] last:border-0">
                <span className="grid size-8 place-items-center">
                  {done ? (
                    <span className="grid size-7 place-items-center rounded-full text-[15px] text-white" style={{ background: test.ok ? '#127a3e' : '#c42b1c' }}>
                      {test.ok ? '✓' : '✕'}
                    </span>
                  ) : running ? (
                    <span className="size-6 rounded-full border-[3px] border-[#d9dbde] border-t-[#141414]" style={{ transform: `rotate(${t * 720}deg)` }} />
                  ) : (
                    <span className="size-3 rounded-full bg-[#d9dbde]" />
                  )}
                </span>
                <span className={done && !test.ok ? 'font-medium' : undefined}>{test.name}</span>
                <span className="ml-auto rounded-full bg-[#f3f4f5] px-3 py-1 text-[14px] text-[#5b6068]">{test.source}</span>
                <span className="mono w-[90px] text-right text-[15px] text-[#8a8f98]">{done ? `${(1.2 + ((index * 7) % 9) / 3).toFixed(1)} s` : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ 04 evidence */

function Evidence({ t }: { t: number }) {
  const o = presence(t, SCENES.evidence);
  const rise = p(t, SCENES.evidence[0], SCENES.evidence[0] + 1, out);
  const ring = p(t, 23.6, 24.5);
  const stamp = p(t, 24.6, 24.9, outBack);
  const zoom = 1 + 0.12 * p(t, 23.4, 24.6) - 0.12 * p(t, 26.1, 27);
  const steps = ['Open /products/trail-runner-gtx', 'Type SAVE10 in Promo code', 'Click Apply'];
  const pressed = t > 28.05 && t < 28.3;
  const ticket = Math.min(p(t, 28.4, 28.8, out), 1 - p(t, 29.9, 30.3));
  const shotScale = 1.3;
  return (
    <div className="absolute inset-0 text-[#141414]" style={{ opacity: o, transform: `translateY(${(1 - rise) * 50}px)` }}>
      {/* Finding */}
      <div className="absolute rounded-[16px] border border-[#e4e1da] bg-white p-9" style={{ left: 120, top: 80, width: 760, height: 770, boxShadow: '0 30px 70px -30px rgb(20 20 20 / 0.35)' }}>
        <div className="flex items-center gap-3 text-[16px]">
          <span className="flex items-center gap-2 rounded-full bg-[#fdf1ef] px-3 py-1 font-medium text-[#b4382c]">
            <span className="size-2 rounded-full bg-[#e0695d]" /> High
          </span>
          <span className="text-[#6e6b66]">Bug · seen on 1 page</span>
        </div>
        <h3 className="mt-5 text-[36px] font-semibold leading-tight tracking-[-0.02em]">Promo code SAVE10 does nothing</h3>
        <p className="mono mt-2 text-[16px] text-[#8a867f]">/products/trail-runner-gtx</p>
        <p className="mt-5 text-[19px] leading-relaxed text-[#3a3733]">Clicking Apply shows no message and the price stays $128.00, so customers can’t use the code.</p>
        <p className="mt-7 text-[15px] font-medium text-[#6e6b66]">How to reproduce</p>
        <ol className="mt-2 space-y-2 text-[18px]">
          {steps.map((step, index) => {
            const k = p(t, 24.2 + index * 0.3, 24.6 + index * 0.3, out);
            return (
              <li key={step} className="flex gap-3" style={{ opacity: k, transform: `translateX(${(1 - k) * 12}px)` }}>
                <span className="mono text-[#8a867f]">{index + 1}.</span>
                {step}
              </li>
            );
          })}
        </ol>
        <div className="mt-7 grid grid-cols-2 gap-3" style={{ opacity: p(t, 25.3, 25.8) }}>
          <div className="rounded-[10px] bg-[#f4f2ed] p-4">
            <p className="text-[14px] font-medium text-[#6e6b66]">Expected</p>
            <p className="mt-1 text-[17px]">10% off, total $115.20</p>
          </div>
          <div className="rounded-[10px] bg-[#fdf1ef] p-4">
            <p className="text-[14px] font-medium text-[#b4382c]">Actual</p>
            <p className="mt-1 text-[17px]">Nothing happens</p>
          </div>
        </div>
        <div className="absolute bottom-9 left-9 flex gap-3">
          <span className="rounded-full px-6 py-3 text-[17px] font-medium text-white" style={{ background: pressed ? '#000' : '#141414', transform: `scale(${pressed ? 0.96 : 1})` }}>
            Create GitHub issue
          </span>
          <span className="rounded-full border border-[#dcd8cf] px-6 py-3 text-[17px] font-medium">Share report</span>
        </div>
      </div>

      {/* Exhibit A */}
      <div className="absolute" style={{ left: 960, top: 110, width: 840, transform: `scale(${zoom})`, transformOrigin: '74% 62%' }}>
        <p className="mono mb-3 flex justify-between text-[15px] text-[#6e6b66]">
          <span>EXHIBIT A · /products/trail-runner-gtx</span>
          <span>21:14:07</span>
        </p>
        <div className="relative overflow-hidden rounded-[6px] border border-[#e4e1da] bg-white" style={{ height: 400 * shotScale + 4 }}>
          <div className="absolute" style={{ left: (840 - PAGE_W * shotScale) / 2, top: 0, width: PAGE_W, height: PAGE_H, transform: `scale(${shotScale})`, transformOrigin: '0 0' }}>
            <ProductPage sizeSelected cartCount={1} />
            <svg className="absolute inset-0 overflow-visible" width={PAGE_W} height={PAGE_H}>
              <ellipse
                cx={509}
                cy={269}
                rx={62}
                ry={30}
                fill="none"
                stroke="#d92d20"
                strokeWidth={2.6}
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - ring}
                transform="rotate(-4 509 269)"
              />
            </svg>
          </div>
          {stamp > 0 ? (
            <span
              className="display absolute border-[3px] border-[#d92d20] px-3 py-1 text-[30px] text-[#d92d20]"
              style={{ right: 36, top: 40, transform: `rotate(-8deg) scale(${2 - stamp})`, opacity: clamp(stamp * 1.4) }}
            >
              Bug
            </span>
          ) : null}
        </div>
        <div className="mono mt-4 grid grid-cols-2 gap-3 text-[14px]" style={{ opacity: p(t, 25.6, 26.1) }}>
          <span className="rounded-[6px] border border-[#e4e1da] bg-white px-3 py-2 text-[#6e6b66]">POST /api/cart/promo · 200</span>
          <span className="rounded-[6px] border border-[#e4e1da] bg-white px-3 py-2 text-[#b4382c]">TypeError: discount is undefined</span>
        </div>
      </div>

      {ticket > 0 ? (
        <div
          className="absolute flex items-center gap-4 rounded-[14px] bg-[#141414] px-6 py-5 text-[18px] text-white shadow-[0_24px_50px_-16px_rgb(0_0_0/0.45)]"
          style={{ left: 157, top: 650, opacity: ticket, transform: `translateY(${(1 - ticket) * 20}px)` }}
        >
          <span className="grid size-8 place-items-center rounded-full bg-white text-[15px] text-[#141414]">#</span>
          Issue #128 created in northtrail/web
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- 05 design */

const AREAS = [
  { label: 'Visual design', score: 96 },
  { label: 'Layout', score: 88 },
  { label: 'Readability', score: 92 },
  { label: 'Accessibility', score: 84 },
  { label: 'Phone', score: 90 },
  { label: 'Consistency', score: 96 },
];

function Design({ t }: { t: number }) {
  const o = presence(t, SCENES.design);
  const rise = p(t, SCENES.design[0], SCENES.design[0] + 0.9, out);
  const k = p(t, 30.6, 32.2);
  const score = Math.round(91 * k);
  const mark = p(t, 32.6, 33.1, out);
  return (
    <div className="absolute inset-0" style={{ opacity: o, transform: `translateY(${(1 - rise) * 50}px)` }}>
      <div className="absolute rounded-[18px] bg-white p-12 text-[#141414]" style={{ left: 200, top: 100, width: 980, height: 700, boxShadow: '0 50px 120px -30px rgb(0 0 0 / 0.75)' }}>
        <p className="text-[18px] font-medium text-[#6b7079]">Design score</p>
        <div className="mt-3 flex items-end gap-10">
          <div className="relative size-[200px]">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="#f0f1f3" strokeWidth="7" />
              <circle cx="50" cy="50" r="44" fill="none" stroke="#127a3e" strokeWidth="7" strokeLinecap="round" pathLength={100} strokeDasharray={`${91 * k} 100`} />
            </svg>
            <span className="font-display absolute inset-0 grid place-items-center text-[64px] font-bold [font-stretch:125%]">{score}</span>
          </div>
          <p className="max-w-[460px] pb-4 text-[21px] leading-relaxed text-[#3d4148]">
            Clear product page and checkout. Some tap targets are too small on phones.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-14 gap-y-7">
          {AREAS.map((area, index) => {
            const fill = p(t, 31 + index * 0.15, 32.2 + index * 0.15);
            const value = Math.round(area.score * fill);
            return (
              <div key={area.label}>
                <div className="flex justify-between text-[19px]">
                  <span className="text-[#5b6068]">{area.label}</span>
                  <span className="font-semibold" style={{ color: area.score >= 85 ? '#127a3e' : '#a85a00' }}>
                    {value}
                  </span>
                </div>
                <div className="mt-2.5 h-[6px] rounded-full bg-[#f0f1f3]">
                  <div className="h-full rounded-full" style={{ width: `${value}%`, background: area.score >= 85 ? '#127a3e' : '#a85a00' }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-10 border-t border-[#f0f1f3] pt-6 text-[17px] text-[#6b7079]" style={{ opacity: p(t, 32.4, 32.9) }}>
          6 pages on a computer and a phone · 5 things to improve, each marked on its screenshot
        </p>
      </div>

      {/* Phone */}
      <div className="absolute rounded-[46px] bg-[#16171a] p-3 shadow-[0_50px_100px_-30px_rgb(0_0_0/0.8)]" style={{ left: 1300, top: 70, width: 400, height: 790 }}>
        <div className="relative size-full overflow-hidden rounded-[36px] bg-white text-[#1a1a1a]">
          <div className="flex h-[64px] items-end justify-between border-b border-[#e3e0d8] px-6 pb-3">
            <span className="font-display text-[17px] font-extrabold tracking-[0.12em] [font-stretch:115%]">NORTHTRAIL</span>
            <span className="text-[14px]">Cart 1</span>
          </div>
          <div className="relative mx-6 mt-6 h-[230px] overflow-hidden rounded-[10px] bg-[#e9e6df]">
            <Shoe className="absolute left-[24px] top-[62px] w-[300px]" upper="#2f5d50" toe="#24483e" />
          </div>
          <p className="mx-6 mt-5 text-[24px] font-semibold">Trail Runner GTX</p>
          <p className="mx-6 mt-1 text-[19px] font-semibold">$128.00</p>
          <div className="relative mx-6 mt-5 flex gap-1.5">
            {[40, 41, 42, 43, 44].map((size) => (
              <span key={size} className="grid h-[28px] w-[34px] place-items-center rounded-[4px] border border-[#d6d2c9] text-[12px]">
                {size}
              </span>
            ))}
            <span
              className="absolute -inset-2 rounded-[8px]"
              style={{ opacity: mark, transform: `scale(${1.15 - 0.15 * mark})`, border: '3px solid #d92d20', background: 'rgb(217 45 32 / 0.08)' }}
            />
          </div>
          <div className="mx-6 mt-6 grid h-[52px] place-items-center rounded-[8px] bg-[#1f6f54] text-[17px] font-semibold text-white">Add to cart</div>
          <div
            className="absolute inset-x-4 bottom-5 rounded-[14px] bg-[#141414] p-4 text-[15px] leading-snug text-white"
            style={{ opacity: p(t, 33.2, 33.6), transform: `translateY(${(1 - p(t, 33.2, 33.6, out)) * 16}px)` }}
          >
            <b>Sizes are too small to tap.</b> 28px tall; make them at least 44px.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- end */

function End({ t }: { t: number }) {
  const o = presence(t, SCENES.end);
  const s = SCENES.end[0];
  const corner = p(t, s + 0.2, s + 0.8, out);
  const lamp = t > s + 0.75 ? (t > s + 1.25 ? 1 : [0.8, 0.15, 0.7, 0.25, 1][Math.floor((t - s - 0.75) * 10)] ?? 1) : 0;
  const words = ['Every', 'button', 'clicked.'];
  const words2 = ['Every', 'bug', 'on', 'record.'];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ opacity: o }}>
      <div className="relative size-[84px]">
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <i
            key={c}
            className="absolute size-[24px] border-[#edeef0]"
            style={{
              [c[0] === 't' ? 'top' : 'bottom']: 0,
              [c[1] === 'l' ? 'left' : 'right']: 0,
              borderTopWidth: c[0] === 't' ? 3 : 0,
              borderBottomWidth: c[0] === 'b' ? 3 : 0,
              borderLeftWidth: c[1] === 'l' ? 3 : 0,
              borderRightWidth: c[1] === 'r' ? 3 : 0,
              opacity: corner,
              transform: `translate(${(c[1] === 'l' ? -1 : 1) * (1 - corner) * 22}px, ${(c[0] === 't' ? -1 : 1) * (1 - corner) * 22}px)`,
            }}
          />
        ))}
        <i className="absolute inset-[24px] bg-[#ffe9b8]" style={{ opacity: lamp, boxShadow: lamp === 1 ? '0 0 50px 8px rgb(255 233 184 / 0.45)' : undefined }} />
      </div>
      <h2 className="display mt-14 text-center text-[96px]">
        <span className="flex justify-center gap-[0.26em]">
          {words.map((word, index) => (
            <Rise key={index} k={p(t, s + 1 + index * 0.1, s + 1.8 + index * 0.1, out)}>
              {word}
            </Rise>
          ))}
        </span>
        <span className="flex justify-center gap-[0.26em] text-[#3a3e45]">
          {words2.map((word, index) => (
            <Rise key={index} k={p(t, s + 1.3 + index * 0.1, s + 2.1 + index * 0.1, out)}>
              {word}
            </Rise>
          ))}
        </span>
      </h2>
      <div className="mt-14 flex items-center gap-6" style={{ opacity: p(t, s + 2.2, s + 2.8), transform: `translateY(${(1 - p(t, s + 2.2, s + 2.8, out)) * 14}px)` }}>
        <span className="rounded-full bg-[#ffe9b8] px-9 py-4 text-[24px] font-medium text-black">Start a free audit</span>
        <span className="mono text-[22px] tracking-[0.06em] text-[#8a8f98]">snaghunt.com</span>
      </div>
    </div>
  );
}

function Rise({ k, children }: { k: number; children: ReactNode }) {
  return (
    <span className="inline-block overflow-hidden pb-[0.06em]">
      <span className="inline-block" style={{ transform: `translateY(${(1 - k) * 110}%)` }}>
        {children}
      </span>
    </span>
  );
}

/* ----------------------------------------------------------- cursor */

type Key = { t: number; x: number; y: number; click?: boolean };
const CURSOR: Key[] = [
  { t: 3.6, x: 1500, y: 860 },
  { t: 4.25, x: ADD_INPUT.x, y: ADD_INPUT.y, click: true },
  { t: 6.2, x: ADD_INPUT.x + 90, y: ADD_INPUT.y + 90 },
  { t: 7.0, x: ADD_BUTTON.x, y: ADD_BUTTON.y, click: true },
  { t: 8.6, x: ADD_BUTTON.x + 130, y: ADD_BUTTON.y + 130 },
  { t: 26.6, x: 760, y: 980 },
  { t: 27.9, x: 258, y: 787, click: true },
  { t: 29.6, x: 470, y: 900 },
];

function Cursor({ t }: { t: number }) {
  const visible = (t > 3.6 && t < 9.4) || (t > 26.6 && t < 29.9);
  if (!visible) return null;
  let a = CURSOR[0]!;
  let b = CURSOR[0]!;
  for (let i = 0; i < CURSOR.length - 1; i += 1) {
    if (t >= CURSOR[i]!.t && t <= CURSOR[i + 1]!.t) {
      a = CURSOR[i]!;
      b = CURSOR[i + 1]!;
      break;
    }
    if (t > CURSOR[i + 1]!.t) {
      a = CURSOR[i + 1]!;
      b = CURSOR[i + 1]!;
    }
  }
  const k = a === b ? 1 : p(t, a.t, b.t - 0.15);
  let x = lerp(a.x, b.x, k);
  let y = lerp(a.y, b.y, k);
  if (t < 10) {
    const zoom = addZoom(t);
    x = ADD_ORIGIN.x + (x - ADD_ORIGIN.x) * zoom;
    y = ADD_ORIGIN.y + (y - ADD_ORIGIN.y) * zoom;
  }
  const clickAt = [a, b].find((key) => key.click && t >= key.t && t < key.t + 0.5);
  const ring = clickAt ? (t - clickAt.t) / 0.5 : 0;
  const fade = Math.min(p(t, 3.6, 3.9), 1 - p(t, 9.0, 9.4), 1) * (t > 26 ? 1 : 1);
  const fade2 = t > 26 ? Math.min(p(t, 26.6, 26.9), 1 - p(t, 29.5, 29.9)) : fade;
  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y, opacity: fade2 }}>
      {clickAt ? (
        <span
          className="absolute rounded-full border-2 border-[#ffe9b8]"
          style={{ left: -24 * ring - 6, top: -24 * ring - 6, width: 48 * ring + 12, height: 48 * ring + 12, opacity: 1 - ring }}
        />
      ) : null}
      <svg width="34" height="40" viewBox="0 0 17 20" style={{ filter: 'drop-shadow(0 4px 8px rgb(0 0 0 / 0.35))', transform: `scale(${clickAt && ring < 0.3 ? 0.9 : 1})` }}>
        <path d="M1 1 L1 16 L5 12.2 L8 19 L10.6 17.9 L7.7 11.3 L13 11.1 Z" fill="#141414" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
