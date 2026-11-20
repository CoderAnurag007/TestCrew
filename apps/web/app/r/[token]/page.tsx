'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DEVICES, type Device, type PublicReport } from '@auditor/shared';
import { ExternalLink, Printer } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { launchApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

type ReportFinding = PublicReport['findings'][number];

const SEVERITY: Record<string, { label: string; dot: string; text: string }> = {
  CRITICAL: { label: 'Critical', dot: 'bg-[#c42b1c]', text: 'text-[#a3241a]' },
  HIGH: { label: 'High', dot: 'bg-[#e0695d]', text: 'text-[#b4382c]' },
  MEDIUM: { label: 'Medium', dot: 'bg-[#a85a00]', text: 'text-[#8a4a00]' },
  LOW: { label: 'Low', dot: 'bg-[#8a8f97]', text: 'text-[#5b6068]' },
  INFO: { label: 'Info', dot: 'bg-[#cfd3d9]', text: 'text-[#5b6068]' },
};

function pagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function caption(fileName: string): string {
  const name = fileName.replace(/\.(png|jpe?g|webp)$/i, '');
  if (/^[a-f0-9]{24,}$/i.test(name)) return 'The page';
  const step = /step-(\d+)/i.exec(name);
  if (step) return `Step ${step[1]}`;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]+/g, ' ');
}

export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const report = useQuery({
    queryKey: ['public-report', token],
    queryFn: () => launchApi.publicReport(token),
    retry: false,
  });

  if (report.isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <div className="shimmer h-10 w-64 rounded-md" />
        <div className="shimmer mt-6 h-40 rounded-lg" />
      </main>
    );
  }
  if (report.isError || !report.data) {
    const gone = report.error instanceof ApiError && report.error.status === 404;
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-xl font-semibold text-ink">{gone ? 'This report is no longer shared' : 'Could not load the report'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gone ? 'Ask the person who sent the link for a new one.' : 'Check your connection and reload the page.'}
        </p>
      </main>
    );
  }
  return <Report token={token} data={report.data} />;
}

function Report({ token, data }: { token: string; data: PublicReport }) {
  const accent = data.brand.color ?? '#111318';
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of data.findings) map[item.severity] = (map[item.severity] ?? 0) + 1;
    return map;
  }, [data.findings]);
  const serious = (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0);
  const date = data.run.completedAt ?? data.run.startedAt;
  const device = DEVICES[data.run.device as Device]?.label ?? 'Desktop Chrome';

  return (
    <div className="min-h-screen bg-[#f6f6f7] print:bg-white">
      <div className="h-1" style={{ background: accent }} />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {data.brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.brand.logoUrl} alt="" className="h-8 w-auto max-w-[140px] object-contain" referrerPolicy="no-referrer" />
            ) : null}
            <span className="truncate text-[15px] font-semibold text-ink">{data.brand.name}</span>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-ink hover:bg-well print:hidden"
          >
            <Printer className="size-3.5" aria-hidden /> Save as PDF
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Website audit</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
          {data.project.name}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
          <a href={data.project.baseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
            {host(data.project.baseUrl)} <ExternalLink className="size-3" aria-hidden />
          </a>
          <span>{device}</span>
          {date ? <span>{new Date(date).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</span> : null}
        </p>

        <section className="mt-8 grid gap-3 sm:grid-cols-4">
          <Stat label="Score" value={data.run.qualityScore != null ? `${Math.round(data.run.qualityScore)}` : '—'} suffix="/100" accent={accent} />
          <Stat label="Problems found" value={String(data.findings.length)} />
          <Stat label="Serious" value={String(serious)} tone={serious ? 'bad' : undefined} />
          <Stat label="Pages checked" value={String(data.run.pagesDiscovered)} />
        </section>

        {data.summary ? (
          <section className="mt-8 rounded-lg border border-border bg-card p-5">
            <h2 className="text-[13px] font-medium text-muted-foreground">Summary</h2>
            <p className="mt-2 max-w-[70ch] whitespace-pre-line text-[15px] leading-7 text-ink">{data.summary}</p>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-[18px] font-semibold text-ink">What we found</h2>
          {data.findings.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-card p-5 text-[15px] text-ink">
              No problems found in this audit.
            </p>
          ) : (
            <ol className="mt-4 space-y-4">
              {data.findings.map((finding, index) => (
                <FindingCard key={finding.id} token={token} finding={finding} index={index + 1} />
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-14 border-t border-border pt-6 text-[13px] text-muted-foreground">
          {data.brand.footer ? <p className="text-ink">{data.brand.footer}</p> : null}
          <p className="mt-1">Tested with real browsers by Snaghunt. Every finding includes the steps to reproduce it.</p>
        </footer>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  accent,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: string;
  tone?: 'bad';
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[26px] font-semibold tabular-nums leading-none', tone === 'bad' ? 'text-[#b4382c]' : 'text-ink')} style={accent ? { color: accent } : undefined}>
        {value}
        {suffix ? <span className="ml-0.5 text-[14px] font-normal text-muted-foreground">{suffix}</span> : null}
      </p>
    </div>
  );
}

function FindingCard({ token, finding, index }: { token: string; finding: ReportFinding; index: number }) {
  const [open, setOpen] = useState(index <= 3);
  const severity = SEVERITY[finding.severity] ?? SEVERITY.INFO!;
  const path = pagePath(finding.url);
  return (
    <li id={finding.id} className="break-inside-avoid rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
      >
        <span className="tabular-nums mt-0.5 text-[13px] text-muted-foreground">{String(index).padStart(2, '0')}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{finding.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className={cn('inline-flex items-center gap-1.5 font-medium', severity.text)}>
              <span aria-hidden className={cn('size-1.5 rounded-full', severity.dot)} /> {severity.label}
            </span>
            {path ? <span className="truncate text-muted-foreground">{path}</span> : null}
            {finding.change === 'REGRESSED' ? <span className="text-muted-foreground">Came back after a fix</span> : null}
          </span>
        </span>
      </button>
      <div className={cn('space-y-5 border-t border-border px-5 py-5', !open && 'hidden print:block')}>
        <p className="max-w-[68ch] text-[15px] leading-7 text-ink [overflow-wrap:anywhere]">{finding.description}</p>
        {finding.steps.length ? (
          <div>
            <h3 className="text-[13px] font-medium text-muted-foreground">How to reproduce</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-6 text-ink marker:text-muted-foreground">
              {finding.steps.map((step, stepIndex) => (
                <li key={`${stepIndex}-${step}`} className="[overflow-wrap:anywhere]">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {finding.expected || finding.actual ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-well p-3.5">
              <h3 className="text-[13px] font-medium text-muted-foreground">What should happen</h3>
              <p className="mt-1 text-[14px] leading-6 text-ink">{finding.expected || '—'}</p>
            </div>
            <div className="rounded-md bg-[#fdf6f5] p-3.5">
              <h3 className="text-[13px] font-medium text-[#b4382c]">What actually happened</h3>
              <p className="mt-1 text-[14px] leading-6 text-ink [overflow-wrap:anywhere]">{finding.actual || '—'}</p>
            </div>
          </div>
        ) : null}
        {finding.recommendation ? (
          <div>
            <h3 className="text-[13px] font-medium text-muted-foreground">How to fix</h3>
            <p className="mt-1 max-w-[68ch] text-[15px] leading-7 text-ink">{finding.recommendation}</p>
          </div>
        ) : null}
        {finding.screenshots.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {finding.screenshots.map((shot) => (
              <figure key={shot.id} className="overflow-hidden rounded-md border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={launchApi.publicEvidenceUrl(token, shot.id)} alt={caption(shot.caption)} loading="lazy" className="w-full bg-well" />
                <figcaption className="border-t border-border px-3 py-1.5 text-[12px] text-muted-foreground">{caption(shot.caption)}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
