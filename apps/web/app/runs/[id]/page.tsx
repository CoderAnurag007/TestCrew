'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isLiveRunStatus, type FindingStatus, type RunStatus } from '@auditor/shared';
import { AppShell } from '@/components/layout/app-shell';
import { FlowGraph } from '@/components/run/flow-graph';
import { AuthCredentialsForm, RetryLoginButton, canRetryLoginFailure, needsLoginCredentials } from '@/components/run/auth-credentials-form';
import { RunStatusDot, SeverityDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { runApi, type RunDetail } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const PIPELINE: RunStatus[] = [
  'QUEUED',
  'INITIALIZING',
  'AUTHENTICATING',
  'DISCOVERING',
  'EXPLORING',
  'FINALIZING',
  'GENERATING_TESTS',
  'EXECUTING_TESTS',
  'ANALYZING',
  'COMPLETED',
];

function progressPercent(status: RunStatus, pages: number, states: number, actions: number): number {
  const index = PIPELINE.indexOf(status);
  if (status === 'COMPLETED') {
    return 100;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return Math.min(95, Math.max(5, Math.max(index, 0) * 10));
  }
  const base = Math.max(index, 0) * 10;
  const discovered = Math.min(15, pages + states / 2 + actions / 4);
  return Math.min(95, Math.round(base + discovered));
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runApi.get(runId),
    staleTime: 0,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isLiveRunStatus(status) ? 1000 : false;
    },
  });

  const [tab, setTab] = useState('live');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const activityEndRef = useRef<HTMLDivElement | null>(null);
  const screenshotKey = run.data?.lastScreenshotKey ?? null;
  const lastImageId = [...(run.data?.evidence ?? [])].reverse().find(isImageEvidence)?.id ?? null;
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const load = async () => {
      let blob = screenshotKey ? await runApi.screenshot(runId) : null;
      if (!blob && lastImageId) {
        blob = await runApi.evidence(runId, lastImageId);
      }
      if (cancelled || !blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setScreenshotUrl(objectUrl);
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runId, screenshotKey, lastImageId]);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ block: 'end' });
  }, [run.data?.events?.length, run.data?.currentAction, run.data?.status]);

  const live = Boolean(run.data?.status && isLiveRunStatus(run.data.status));

  const cancel = useMutation({
    mutationFn: () => runApi.cancel(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Run cancelled');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not cancel run'),
  });

  const updateFinding = useMutation({
    mutationFn: ({ findingId, status }: { findingId: string; status: FindingStatus }) =>
      runApi.updateFinding(runId, findingId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('Finding updated');
    },
  });

  const currentIndex = PIPELINE.indexOf(run.data?.status ?? 'QUEUED');
  const percent = useMemo(
    () =>
      progressPercent(
        run.data?.status ?? 'QUEUED',
        run.data?.pagesDiscovered ?? 0,
        run.data?.statesDiscovered ?? 0,
        run.data?.actionsExecuted ?? 0,
      ),
    [run.data],
  );

  const finding = run.data?.findings.find((item) => item.id === selectedFinding) ?? run.data?.findings[0];
  const payload = asRecord(run.data?.reportPayload ?? run.data?.report?.payload);

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Run</p>
          <h1 className="mono text-2xl">{run.data?.id ?? runId}</h1>
          <p className="text-sm text-muted-foreground">
            {run.data?.project.name} · {run.data?.environment?.name ?? 'No environment'}
          </p>
        </div>
        <div className="flex gap-2">
          {run.data?.projectId ? (
            <Button variant="outline" asChild>
              <Link href={`/projects/${run.data.projectId}`}>Back to project</Link>
            </Button>
          ) : null}
          {run.data && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.data.status) ? (
            <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="live">Live Run</TabsTrigger>
          <TabsTrigger value="flows">Flows</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Quality score</CardTitle>
                <CardDescription>
                  <RunStatusDot status={run.data?.status ?? 'QUEUED'} />
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-semibold">{run.data?.qualityScore ?? run.data?.report?.qualityScore ?? '—'}</div>
                <p className="mt-2 text-sm text-muted-foreground">Deterministic score from findings, coverage, and test results.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Coverage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Discovered flows" value={run.data?.coverage?.discoveredFlows ?? run.data?.flows?.length ?? 0} />
                <Row label="Tested" value={run.data?.coverage?.testedFlows ?? 0} />
                <Row label="Successful" value={run.data?.coverage?.successfulFlows ?? 0} />
                <Row label="Failed" value={run.data?.coverage?.failedFlows ?? 0} />
                <Row label="Untested" value={run.data?.coverage?.untestedFlows ?? 0} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cost</CardTitle>
                <CardDescription>Provider secrets are never shown.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="AI cost" value={`$${(run.data?.cost?.aiCostUsd ?? 0).toFixed(4)}`} />
                <Row
                  label="Browser duration"
                  value={`${Math.round((run.data?.cost?.browserDurationMs ?? run.data?.elapsedMs ?? 0) / 1000)}s`}
                />
                <Row
                  label="Storage estimate"
                  value={formatBytes(run.data?.cost?.storageBytesEstimate ?? 0)}
                />
              </CardContent>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Findings snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(run.data?.findings ?? []).slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">{item.title}</span>
                  <SeverityDot severity={item.severity} />
                </div>
              ))}
              {!run.data?.findings.length && <p className="text-sm text-muted-foreground">No findings yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          {run.data && needsLoginCredentials(run.data) ? (
            <AuthCredentialsForm runId={runId} projectId={run.data.projectId} loginUrl={run.data.currentUrl} />
          ) : run.data && canRetryLoginFailure(run.data) ? (
            <RetryLoginButton runId={runId} />
          ) : null}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Live progress</CardTitle>
              <CardDescription>
                <RunStatusDot status={run.data?.status ?? 'QUEUED'} />
                {live ? <span className="ml-2 text-primary">Streaming worker activity</span> : null}
                {run.data?.errorMessage ? <span className="ml-2 text-destructive">{run.data.errorMessage}</span> : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <div className="flex flex-wrap gap-2">
                {PIPELINE.map((stage, index) => (
                  <div
                    key={stage}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[11px] uppercase tracking-wide',
                      index <= currentIndex ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {stage.replaceAll('_', ' ')}
                  </div>
                ))}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Current page</dt>
                  <dd className="mono truncate">{run.data?.currentUrl ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Current action</dt>
                  <dd>{run.data?.currentAction ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pages / states</dt>
                  <dd>
                    {run.data?.pagesDiscovered ?? 0} / {run.data?.statesDiscovered ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Actions / elapsed</dt>
                  <dd>
                    {run.data?.actionsExecuted ?? 0} · {Math.round((run.data?.elapsedMs ?? 0) / 1000)}s
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Live screenshot</CardTitle>
              </CardHeader>
              <CardContent>
                {screenshotUrl ? (
                  <img src={screenshotUrl} alt="Current page" className="w-full rounded-md border" />
                ) : (
                  <p className="text-sm text-muted-foreground">Waiting for the first captured screenshot.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Live log</CardTitle>
                <CardDescription>
                  {run.data?.currentAction ? `Now: ${run.data.currentAction}` : live ? 'Waiting for the next action' : 'Run is not active'}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-80 space-y-2 overflow-auto font-mono text-xs">
                {run.data?.status === 'QUEUED' && !run.data.events?.length ? (
                  <p className="font-sans text-sm text-muted-foreground">Queued. The worker is picking up this audit…</p>
                ) : null}
                {run.data?.events?.map((event) => (
                  <div key={event.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="uppercase tracking-wide text-[11px] text-muted-foreground">
                        {eventKindLabel(event.kind)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="font-sans">{event.message}</p>
                    {event.url ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{event.url}</p> : null}
                  </div>
                ))}
                {live && run.data?.currentAction ? (
                  <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
                    <span className="uppercase tracking-wide text-[11px] text-primary">now</span>
                    <p className="font-sans">{run.data.currentAction}</p>
                    {run.data.currentUrl ? (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{run.data.currentUrl}</p>
                    ) : null}
                  </div>
                ) : null}
                {!run.data?.events?.length && run.data?.status !== 'QUEUED' ? (
                  <p className="font-sans text-sm text-muted-foreground">Waiting for worker events.</p>
                ) : null}
                <div ref={activityEndRef} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="flows">
          <Card>
            <CardHeader>
              <CardTitle>Application graph</CardTitle>
              <CardDescription>Green is visited, gray is untested. Self-loops are counted on the node instead of overlapping arrows.</CardDescription>
            </CardHeader>
            <CardContent>
              <FlowGraph
                states={run.data?.states ?? []}
                edges={run.data?.edges ?? []}
                failedUrls={run.data?.findings.map((item) => item.url ?? '').filter(Boolean)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tests">
          <Card>
            <CardHeader>
              <CardTitle>Generated tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(run.data?.testCases ?? []).map((test) => {
                const execution = run.data?.testRuns?.find((item) => item.testCaseId === test.id);
                return (
                  <div key={test.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{test.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {test.category} · {test.priority}
                        </div>
                      </div>
                      <span className="text-xs uppercase text-muted-foreground">{execution?.status ?? 'PENDING'}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{test.description}</p>
                  </div>
                );
              })}
              {!run.data?.testCases?.length && <p className="text-sm text-muted-foreground">Tests appear after exploration.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings">
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Findings</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[640px] space-y-2 overflow-auto">
                {(run.data?.findings ?? []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left',
                      finding?.id === item.id ? 'border-primary bg-primary/5' : '',
                    )}
                    onClick={() => setSelectedFinding(item.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <SeverityDot severity={item.severity} />
                    </div>
                    <p className="text-[11px] uppercase text-muted-foreground">
                      {item.category} · {Math.round((item.confidence ?? 0.5) * 100)}%
                    </p>
                  </button>
                ))}
                {!run.data?.findings.length && <p className="text-sm text-muted-foreground">No findings captured.</p>}
              </CardContent>
            </Card>
            {finding ? <FindingDetail runId={runId} finding={finding} onStatus={(status) => updateFinding.mutate({ findingId: finding.id, status })} /> : (
              <Card>
                <CardContent className="p-5 text-sm text-muted-foreground">Select a finding to inspect evidence.</CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="evidence">
          <Card>
            <CardHeader>
              <CardTitle>Stored evidence</CardTitle>
              <CardDescription>Screenshots render inline. Other artifacts stay downloadable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {(() => {
                const items = run.data?.evidence ?? [];
                const images = items.filter(isImageEvidence);
                const files = items.filter((item) => !isImageEvidence(item));
                return (
                  <>
                    {images.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {images.slice(0, 80).map((item) => (
                          <figure key={item.id} className="overflow-hidden rounded-md border">
                            <EvidenceImage runId={runId} evidenceId={item.id} alt={item.fileName ?? 'Screenshot'} />
                            <figcaption className="truncate px-3 py-2 text-xs text-muted-foreground">
                              {item.fileName ?? item.type}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : null}
                    {files.length > 0 ? (
                      <div className="space-y-2">
                        {files.slice(0, 80).map((item) => (
                          <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                            <span>
                              {item.type} · {item.fileName ?? item.id}
                            </span>
                            <EvidenceLink runId={runId} evidenceId={item.id} contentType={item.contentType} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {!items.length && <p className="text-sm text-muted-foreground">No evidence stored yet.</p>}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="report">
          <Card>
            <CardHeader>
              <CardTitle>Audit report</CardTitle>
              <CardDescription>Numbers come from the database. AI may only summarize them.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>{String(payload.executiveSummary ?? run.data?.report?.summary ?? 'Report will appear after analysis.')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Row label="Score" value={String(payload.overallScore ?? run.data?.qualityScore ?? '—')} />
                <Row label="Critical" value={countOf(payload, 'CRITICAL')} />
                <Row label="High" value={countOf(payload, 'HIGH')} />
                <Row label="Medium" value={countOf(payload, 'MEDIUM')} />
              </div>
              <div>
                <h3 className="mb-2 font-medium">Recommendations</h3>
                <ul className="list-disc space-y-1 pl-5">
                  {(Array.isArray(payload.recommendations) ? payload.recommendations : []).map((item) => (
                    <li key={String(item)}>{String(item)}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

function FindingDetail({
  runId,
  finding,
  onStatus,
}: {
  runId: string;
  finding: NonNullable<RunDetail['findings']>[number];
  onStatus: (status: FindingStatus) => void;
}) {
  const screenshots = (finding.evidence ?? []).filter((item) => item.type === 'SCREENSHOT' || item.contentType.startsWith('image/'));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{finding.title}</CardTitle>
        <CardDescription>
          <SeverityDot severity={finding.severity} /> · {Math.round((finding.confidence ?? 0.5) * 100)}% confidence · {finding.status}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{finding.description}</p>
        <section>
          <h3 className="font-medium">Steps to reproduce</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {asSteps(finding.steps).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="font-medium">Expected</h3>
          <p className="text-muted-foreground">{finding.expected ?? '—'}</p>
        </section>
        <section>
          <h3 className="font-medium">Actual</h3>
          <p className="text-muted-foreground">{finding.actual ?? '—'}</p>
        </section>
        <section>
          <h3 className="font-medium">Recommendation</h3>
          <p className="text-muted-foreground">{finding.recommendation ?? '—'}</p>
        </section>
        <div className="grid gap-2 sm:grid-cols-2">
          {screenshots.map((item) => (
            <EvidenceImage key={item.id} runId={runId} evidenceId={item.id} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['OPEN', 'CONFIRMED', 'IGNORED', 'RESOLVED'] as FindingStatus[]).map((status) => (
            <Button key={status} size="sm" variant={finding.status === status ? 'default' : 'outline'} onClick={() => onStatus(status)}>
              {status}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceImage({ runId, evidenceId, alt = 'Evidence screenshot' }: { runId: string; evidenceId: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void runApi.evidence(runId, evidenceId).then((blob) => {
      if (cancelled || !blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runId, evidenceId]);
  if (!url) {
    return <div className="h-40 rounded-md bg-muted" />;
  }
  return <img src={url} alt={alt} className="w-full bg-background object-contain" />;
}

function EvidenceLink({ runId, evidenceId, contentType }: { runId: string; evidenceId: string; contentType: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    void runApi.evidence(runId, evidenceId).then((blob) => {
      if (!blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runId, evidenceId]);
  if (!url) {
    return <span className="text-xs text-muted-foreground">{contentType}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-xs underline">
      Open
    </a>
  );
}

function eventKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    action: 'Did',
    page: 'Opened',
    stage: 'Stage',
    test: 'Test',
    info: 'Note',
    error: 'Error',
  };
  return labels[kind] ?? kind;
}

function isImageEvidence(item: { type: string; contentType: string; fileName?: string | null }): boolean {
  return (
    item.type === 'SCREENSHOT' ||
    item.contentType.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp)$/i.test(item.fileName ?? '')
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function countOf(payload: Record<string, unknown>, key: string): string {
  const counts = asRecord(payload.counts);
  return String(counts[key] ?? 0);
}

function asSteps(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return value ? [String(value)] : ['No recorded steps'];
  }
  return value.map((item) => {
    if (item && typeof item === 'object' && 'description' in item) {
      return String((item as { description: string }).description);
    }
    return String(item);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
