'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isLiveRunStatus } from '@auditor/shared';
import {
  Bug,
  Check,
  CircleX,
  Compass,
  Eye,
  FileText,
  FlaskConical,
  Flag,
  Globe,
  Hourglass,
  Info,
  Keyboard,
  Layers,
  ListChecks,
  Lock,
  MonitorPlay,
  MousePointerClick,
  Navigation,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, StatCard, StatStrip } from '@/components/ui/premium';
import { runApi, type LiveActionKind, type LivePhase, type LiveState, type RunDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  hostAndPath,
  isImageEvidence,
  phaseIndexFor,
  phasesFor,
  relativeTime,
  stoppedPhaseIndex,
} from './run-utils';

const POLL_MS = 700;

/* ------------------------------------------------------------------------------------------------
 * Data: live meta + newest frame
 * ---------------------------------------------------------------------------------------------- */

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

/**
 * Polls GET /runs/:id/live every 700 ms while the run is live and the page is visible, and only downloads a
 * new frame when the sequence number changes. For finished runs it fetches once, to show the last frame.
 */
function useLiveFeed(runId: string, live: boolean) {
  const [state, setState] = useState<LiveState | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const seqRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;

    const tick = async () => {
      if (inFlight || (live && document.visibilityState !== 'visible')) {
        return;
      }
      inFlight = true;
      try {
        const next = await runApi.live(runId);
        if (cancelled) return;
        setState(next);
        if (next.available && next.seq !== seqRef.current) {
          const blob = await runApi.liveFrame(runId, next.seq);
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          await preload(url);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          const previous = urlRef.current;
          urlRef.current = url;
          seqRef.current = next.seq;
          setFrameUrl(url);
          if (previous) {
            // Give React a moment to swap the <img> before the old frame is released.
            window.setTimeout(() => URL.revokeObjectURL(previous), 1500);
          }
        }
      } catch {
        // Keep showing the last good frame; the next tick tries again.
      } finally {
        inFlight = false;
        if (!cancelled) setChecked(true);
      }
    };

    const loop = () => {
      void tick().finally(() => {
        if (!cancelled && live) {
          timer = window.setTimeout(loop, POLL_MS);
        }
      });
    };
    loop();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runId, live]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { state, frameUrl, checked };
}

/** Older runs (and workers without frame capture) still have a last screenshot or image evidence. */
function useFallbackShot(runId: string, enabled: boolean, screenshotKey: string | null, lastImageId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || (!screenshotKey && !lastImageId)) {
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      let blob = screenshotKey ? await runApi.screenshot(runId) : null;
      if (!blob && lastImageId) {
        blob = await runApi.evidence(runId, lastImageId);
      }
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId, enabled, screenshotKey, lastImageId]);
  return enabled ? url : null;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ------------------------------------------------------------------------------------------------
 * Live view
 * ---------------------------------------------------------------------------------------------- */

export function LiveView({ runId, run }: { runId: string; run: RunDetail }) {
  const live = isLiveRunStatus(run.status);
  const { state, frameUrl, checked } = useLiveFeed(runId, live);
  const lastImageId = useMemo(
    () => [...(run.evidence ?? [])].reverse().find(isImageEvidence)?.id ?? null,
    [run.evidence],
  );
  const needFallback = checked && !frameUrl;
  const fallbackUrl = useFallbackShot(runId, needFallback, run.lastScreenshotKey ?? null, lastImageId);

  return (
    <div className="space-y-6">
      <PhaseStepper run={run} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <BrowserFrame
            run={run}
            live={live}
            state={state}
            frameUrl={frameUrl}
            fallbackUrl={fallbackUrl}
            checked={checked}
          />
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <Terminal className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Want to watch in a real browser window? Start the worker with{' '}
              <code className="mono rounded-[4px] bg-well px-1 py-px text-[12px] text-ink">AUDITOR_HEADFUL=1</code>.
            </span>
          </p>
        </div>
        <ActivityTimeline run={run} live={live} />
      </div>
      <LiveStats run={run} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Browser chrome + frame + overlays
 * ---------------------------------------------------------------------------------------------- */

const PHASE_LABEL: Record<LivePhase, string> = {
  starting: 'Starting',
  opening: 'Opening',
  authenticating: 'Signing in',
  exploring: 'Exploring',
  testing: 'Testing',
  probing: 'Trying every control',
  journeys: 'Running journeys',
  analyzing: 'Analyzing',
};

const ACTION_ICON: Record<LiveActionKind, LucideIcon> = {
  navigate: Navigation,
  click: MousePointerClick,
  type: Keyboard,
  select: ListChecks,
  assert: ShieldCheck,
  observe: Eye,
  wait: Hourglass,
  info: Info,
};

const POINTER_KINDS: LiveActionKind[] = ['click', 'type', 'select'];

function BrowserFrame({
  run,
  live,
  state,
  frameUrl,
  fallbackUrl,
  checked,
}: {
  run: RunDetail;
  live: boolean;
  state: LiveState | null;
  frameUrl: string | null;
  fallbackUrl: string | null;
  checked: boolean;
}) {
  const now = useNow(1000);
  const meta = state?.available ? state : null;
  const viewport = meta?.viewport && meta.viewport.width > 0 && meta.viewport.height > 0 ? meta.viewport : null;
  const ratio = viewport ? viewport.width / viewport.height : 16 / 10;
  const url = meta?.url ?? run.currentUrl ?? run.baseUrlOverride ?? run.project.baseUrl;
  const secure = url?.startsWith('https://');
  const action = meta?.action ?? null;
  const box = frameUrl && viewport && action?.box && action.box.width > 0 && action.box.height > 0 ? action.box : null;
  const idle = live && (run.status === 'GENERATING_TESTS' || run.status === 'ANALYZING');
  const imageUrl = frameUrl ?? fallbackUrl;

  // Cursor keeps its last position so it glides from target to target instead of jumping from a corner.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const boxKey = box ? `${box.x}:${box.y}:${box.width}:${box.height}` : null;
  useEffect(() => {
    if (box && viewport) {
      setCursor({
        x: ((box.x + box.width / 2) / viewport.width) * 100,
        y: ((box.y + box.height / 2) / viewport.height) * 100,
      });
    }
  }, [boxKey, viewport?.width, viewport?.height]);
  const showCursor = Boolean(box && action && POINTER_KINDS.includes(action.kind) && cursor);

  const phaseLabel = meta ? PHASE_LABEL[meta.phase] ?? meta.phase : null;
  const ActionIcon = action ? (ACTION_ICON[action.kind] ?? Info) : live ? Compass : MonitorPlay;
  const caption = action?.label
    ? action.label
    : !live
      ? frameUrl
        ? 'Last frame captured by the audit browser'
        : fallbackUrl
          ? 'Last screenshot captured during the run'
          : 'No live frames were recorded for this run'
      : idle
        ? 'The browser is paused while the results are prepared'
        : run.currentAction && run.currentAction !== 'authentication-required'
          ? run.currentAction
          : 'Waiting for the next action';

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Chrome */}
      <div className="flex h-10 items-center gap-3 border-b border-border bg-well px-3">
        <div className="flex shrink-0 items-center gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-[#cfd3d9]" />
          <span className="size-2 rounded-full bg-[#cfd3d9]" />
          <span className="size-2 rounded-full bg-[#cfd3d9]" />
        </div>
        <div
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5"
          title={url ?? undefined}
        >
          {secure ? (
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Secure connection" />
          ) : (
            <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="mono truncate text-[12px] text-ink">{url ? hostAndPath(url) : 'about:blank'}</span>
        </div>
        {live ? (
          <Badge variant="live" className="shrink-0 gap-1.5">
            <span className="live-dot" aria-hidden />
            {phaseLabel ?? 'Live'}
          </Badge>
        ) : (
          <Badge variant="muted" className="shrink-0">
            {frameUrl ? 'Last frame' : 'Replay'}
          </Badge>
        )}
      </div>

      {/* Viewport */}
      <div className="bg-well">
        <div
          className="relative mx-auto w-full overflow-hidden"
          style={{ aspectRatio: `${ratio}`, maxWidth: `calc(70vh * ${ratio})` }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={action?.label ? `Audit browser: ${action.label}` : 'Current view of the audit browser'}
              className="absolute inset-0 h-full w-full object-cover object-top"
              draggable={false}
            />
          ) : !checked ? (
            <div className="absolute inset-0 p-5">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="mt-4 h-40 w-full" />
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
              <p className="sr-only">Connecting to the audit browser…</p>
            </div>
          ) : (
            <FrameEmpty run={run} live={live} />
          )}

          {box && viewport ? (
            <div
              className="target-box"
              aria-hidden
              style={{
                left: `${(box.x / viewport.width) * 100}%`,
                top: `${(box.y / viewport.height) * 100}%`,
                width: `${(box.width / viewport.width) * 100}%`,
                height: `${(box.height / viewport.height) * 100}%`,
              }}
            />
          ) : null}

          {cursor ? (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute z-10 transition-[left,top,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                showCursor ? 'opacity-100' : 'opacity-0',
              )}
              style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" className="-translate-x-[3px] -translate-y-[2px]">
                <path
                  d="M4 2.5 19.5 11l-6.6 1.7L9.6 19 4 2.5Z"
                  fill="white"
                  stroke="#0a0a0b"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ) : null}

          {live && imageUrl && !idle ? <div className="scanline" aria-hidden /> : null}

          {idle && imageUrl ? (
            <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-float)]">
                <Hourglass className="size-3.5 text-muted-foreground" aria-hidden />
                {run.status === 'GENERATING_TESTS' ? 'Writing tests from what it explored' : 'Analyzing results'}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Caption */}
      <div className="flex items-center gap-3 border-t border-border bg-card px-3 py-2.5" aria-live="polite">
        <ActionIcon className={cn('size-4 shrink-0', live ? 'text-cobalt' : 'text-muted-foreground')} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={caption}>
          {caption}
        </p>
        {meta?.at ? (
          <span className="mono hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
            {relativeTime(meta.at, now)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FrameEmpty({ run, live }: { run: RunDetail; live: boolean }) {
  const queued = run.status === 'QUEUED' || run.status === 'INITIALIZING';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      {live ? <Compass className="size-5 text-muted-foreground" aria-hidden /> : <MonitorPlay className="size-5 text-muted-foreground" aria-hidden />}
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-ink">
          {live ? (queued ? 'Warming up the audit browser' : 'Waiting for the first frame') : 'No live frames for this run'}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {live
            ? queued
              ? 'The worker is picking up this audit. Frames appear as soon as the browser opens your app.'
              : 'Frames stream about twice a second while the browser explores and runs tests.'
            : 'This run was recorded before live view existed, or it ended before the browser opened. Findings and evidence are still available in the other tabs.'}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Phase stepper
 * ---------------------------------------------------------------------------------------------- */

export function PhaseStepper({ run }: { run: RunDetail }) {
  const stopped = run.status === 'FAILED' || run.status === 'CANCELLED';
  const phases = phasesFor(run);
  const current = stopped ? Math.min(stoppedPhaseIndex(run), phases.length - 2) : phaseIndexFor(run);
  const done = run.status === 'COMPLETED';
  const nowText =
    run.currentAction && run.currentAction !== 'authentication-required' && isLiveRunStatus(run.status)
      ? run.currentAction
      : null;
  return (
    <section className="rounded-lg border border-border bg-card" aria-label="Mission progress">
      <div className="flex flex-col gap-1 px-4 pt-3.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-ink">Mission progress</h2>
        <p className="min-w-0 truncate text-[13px] text-muted-foreground">
          {stopped
            ? `${run.status === 'FAILED' ? 'Stopped with an error' : 'Cancelled'} during ${phases[current]?.toLowerCase()}`
            : done
              ? run.bugAudit === false
                ? 'Design review complete'
                : 'Audit complete'
              : nowText
                ? <>Now: <span className="text-ink">{nowText}</span></>
                : 'In progress'}
        </p>
      </div>
      <ol className="flex gap-0 overflow-x-auto overflow-y-hidden px-2 pb-3.5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Audit phases">
        {phases.map((label, index) => {
          const isDone = done ? true : index < current;
          const isCurrent = !done && index === current;
          const isStopped = stopped && index === current;
          return (
            <li
              key={label}
              className="relative flex min-w-[88px] flex-1 flex-col items-center px-1 text-center"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1/2 top-2.5 h-px w-full',
                    isStopped ? 'bg-danger' : isDone || isCurrent ? 'bg-ink' : 'bg-border',
                  )}
                />
              ) : null}
              <span
                className={cn(
                  'tabular relative z-10 flex size-5 items-center justify-center rounded-full border text-[11px] font-medium',
                  isStopped
                    ? 'border-danger bg-card text-danger'
                    : isDone
                      ? 'border-ink bg-ink text-white'
                      : isCurrent
                        ? 'border-ink bg-card text-ink'
                        : 'border-[#cfd3d9] bg-card text-muted-foreground',
                )}
              >
                {isStopped ? <CircleX className="size-3" /> : isDone ? <Check className="size-3" /> : index + 1}
              </span>
              <span
                className={cn(
                  'mt-1.5 text-[12px] leading-tight',
                  isStopped
                    ? 'font-medium text-danger'
                    : isCurrent
                      ? 'font-medium text-ink'
                      : isDone
                        ? 'text-ink'
                        : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              <span className="sr-only">
                {isStopped ? ' (stopped here)' : isDone ? ' (done)' : isCurrent ? ' (in progress)' : ' (pending)'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Stats
 * ---------------------------------------------------------------------------------------------- */

function LiveStats({ run }: { run: RunDetail }) {
  const testRuns = run.testRuns ?? [];
  const passed = run.testsPassed ?? testRuns.filter((item) => item.status === 'PASSED').length;
  const failed = run.testsFailed ?? testRuns.filter((item) => item.status === 'FAILED' || item.status === 'ERROR').length;
  const findings = (run.findings ?? []).filter((item) => !item.suppressed);
  const serious = findings.filter((item) => item.severity === 'CRITICAL' || item.severity === 'HIGH').length;
  const testsTotal = run.testCases?.length ?? run.testsGenerated ?? 0;
  return (
    <StatStrip>
      <StatCard
        label="Screens found"
        value={run.pagesDiscovered ?? 0}
        hint={`${run.statesDiscovered ?? 0} distinct states`}
        icon={Layers}
      />
      <StatCard
        label="Actions taken"
        value={run.actionsExecuted ?? 0}
        hint={`${run.flowsDiscovered ?? run.flows?.length ?? 0} flows mapped`}
        icon={MousePointerClick}
      />
      <StatCard
        label="Tests passed / failed"
        value={
          <span>
            <span className={passed ? 'text-success' : 'text-ink'}>{passed}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className={failed ? 'text-danger' : 'text-ink'}>{failed}</span>
          </span>
        }
        hint={testsTotal ? `${testsTotal} tests generated` : 'Tests are written after exploring'}
        icon={FlaskConical}
        tone="default"
      />
      <StatCard
        label="Findings so far"
        value={findings.length}
        hint={serious ? `${serious} critical or high` : findings.length ? 'None critical or high' : 'Nothing found yet'}
        icon={Bug}
        tone={serious ? 'danger' : 'default'}
      />
    </StatStrip>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Activity timeline
 * ---------------------------------------------------------------------------------------------- */

const NEUTRAL_TONE = 'bg-well text-muted-foreground';

const EVENT_STYLE: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  stage: { icon: Flag, tone: 'bg-well text-ink', label: 'Stage' },
  action: { icon: MousePointerClick, tone: NEUTRAL_TONE, label: 'Action' },
  navigate: { icon: Navigation, tone: NEUTRAL_TONE, label: 'Navigate' },
  page: { icon: FileText, tone: NEUTRAL_TONE, label: 'Page' },
  test: { icon: FlaskConical, tone: NEUTRAL_TONE, label: 'Test' },
  info: { icon: Info, tone: NEUTRAL_TONE, label: 'Note' },
  warning: { icon: TriangleAlert, tone: 'bg-[#fdf6ec] text-warning', label: 'Warning' },
  error: { icon: CircleX, tone: 'bg-[#fdf1ef] text-danger', label: 'Error' },
};

export function eventStyle(kind: string) {
  return EVENT_STYLE[kind] ?? { icon: Info, tone: NEUTRAL_TONE, label: kind };
}

function ActivityTimeline({ run, live }: { run: RunDetail; live: boolean }) {
  const now = useNow(5000);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const events = useMemo(() => [...(run.events ?? [])].reverse().slice(0, 200), [run.events]);
  const nowAction =
    live && run.currentAction && run.currentAction !== 'authentication-required' ? run.currentAction : null;

  // Newest is on top: follow it unless the reader has scrolled down to look at something older.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && element.scrollTop < 80) {
      element.scrollTo({ top: 0 });
    }
  }, [events.length, nowAction]);

  return (
    <Card className="flex max-h-[640px] min-h-[320px] flex-col">
      <CardHeader className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Activity</CardTitle>
          {live ? (
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot" aria-hidden />
              Streaming
            </Badge>
          ) : (
            <Badge variant="muted">{run.events?.length ?? 0} events</Badge>
          )}
        </div>
        <CardDescription>What the worker did, newest first.</CardDescription>
      </CardHeader>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Run activity">
        {nowAction ? (
          <div className="flex gap-3 border-b border-border bg-[#f0f3fd] px-4 py-2.5">
            <span className="mt-1.5 shrink-0">
              <span className="live-dot" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-cobalt">Now</p>
              <p className="text-sm text-ink">{nowAction}</p>
              {run.currentUrl ? (
                <p className="mono mt-0.5 truncate text-[12px] text-muted-foreground">{hostAndPath(run.currentUrl)}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {events.length ? (
          <ol className="divide-y divide-border">
            {events.map((event) => {
              const style = eventStyle(event.kind);
              const Icon = style.icon;
              return (
                <li key={event.id} className="flex gap-3 px-4 py-2.5">
                  <span
                    className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', style.tone)}
                    aria-hidden
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-medium text-muted-foreground">{style.label}</span>
                      <time
                        className="tabular shrink-0 text-[12px] text-muted-foreground"
                        dateTime={new Date(event.createdAt).toISOString()}
                        title={new Date(event.createdAt).toLocaleString()}
                      >
                        {relativeTime(event.createdAt, now)}
                      </time>
                    </div>
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        event.kind === 'error' ? 'text-danger' : event.kind === 'warning' ? 'text-warning' : 'text-ink',
                      )}
                    >
                      {event.message}
                    </p>
                    {event.url ? (
                      <p className="mono mt-0.5 truncate text-[12px] text-muted-foreground" title={event.url}>
                        {hostAndPath(event.url)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Compass className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {run.status === 'QUEUED' ? 'Queued. The worker is picking up this audit…' : live ? 'Waiting for worker events.' : 'No activity was recorded.'}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
