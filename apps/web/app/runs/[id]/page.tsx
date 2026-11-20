'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isLiveRunStatus, type FindingSeverity, type FindingStatus } from '@auditor/shared';
import {
  Bug,
  CircleAlert,
  FlaskConical,
  ImageIcon,
  LayoutDashboard,
  MonitorPlay,
  MousePointerClick,
  Route,
  ScrollText,
  Workflow,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthCredentialsForm, RetryLoginButton, canRetryLoginFailure, needsLoginCredentials } from '@/components/run/auth-credentials-form';
import { EventLog } from '@/components/run/event-log';
import { FindingsPanel, TopFindings } from '@/components/run/findings-list';
import { FlowGraph } from '@/components/run/flow-graph';
import { InteractionsView } from '@/components/run/interactions-view';
import { JourneysView } from '@/components/run/journeys-view';
import { LiveView } from '@/components/run/live-view';
import { PageEvidence } from '@/components/run/page-evidence';
import {
  CoverageCostCard,
  HealthScoreCard,
  IntentResultsCard,
  RecommendationsCard,
  ReportHero,
  SafetySummaryCard,
  SinceLastRunCard,
  TestsSummaryCard,
} from '@/components/run/report-sections';
import { RunContextStrip } from '@/components/run/run-context-strip';
import { RunHeader } from '@/components/run/run-header';
import { asRecord, countOf, formatBytes, formatDuration, SEVERITY_ORDER } from '@/components/run/run-utils';
import { TestsList } from '@/components/run/tests-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/premium';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { runApi } from '@/lib/queries';

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runApi.get(runId),
    staleTime: 0,
    // The full run payload is heavy; the live frame view polls its own small
    // endpoint, so refreshing the whole run every 2 s (and not at all in a
    // hidden tab) is plenty.
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isLiveRunStatus(status) ? 2000 : false;
    },
  });

  const data = run.data;
  const live = Boolean(data?.status && isLiveRunStatus(data.status));
  // Until the user picks a tab, follow the run: Live while it runs, Overview once it is done.
  const [chosen, setChosen] = useState<{ runId: string; tab: string } | null>(null);
  const chosenTab = chosen?.runId === runId ? chosen.tab : null;
  const setChosenTab = (next: string) => setChosen({ runId, tab: next });
  const tab = chosenTab ?? (!data || live ? 'live' : 'overview');

  const updateFinding = useMutation({
    mutationFn: ({
      findingId,
      status,
      remember,
      reason,
    }: {
      findingId: string;
      status: FindingStatus;
      remember?: boolean;
      reason?: string;
    }) => runApi.updateFinding(runId, findingId, status, remember ? { remember, reason } : undefined),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success(variables.remember ? 'Marked as not a bug. Hidden in future runs.' : 'Finding updated');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not update finding'),
  });

  const allFindings = useMemo(() => data?.findings ?? [], [data?.findings]);
  const openFindings = allFindings.filter((item) => !item.suppressed);
  const payload = asRecord(data?.reportPayload ?? data?.report?.payload);

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const fromPayload = Object.keys(asRecord(payload.counts)).length > 0;
    if (fromPayload) {
      for (const severity of SEVERITY_ORDER) counts[severity] = countOf(payload, severity);
    } else {
      for (const item of allFindings) if (!item.suppressed) counts[item.severity] += 1;
    }
    return counts;
  }, [payload, allFindings]);

  const scoreValue = payload.overallScore ?? data?.qualityScore ?? data?.report?.qualityScore ?? null;
  const score = typeof scoreValue === 'number' ? scoreValue : scoreValue != null && !Number.isNaN(Number(scoreValue)) ? Number(scoreValue) : null;
  const summaryValue = payload.executiveSummary ?? data?.report?.summary ?? null;
  const summary = typeof summaryValue === 'string' && summaryValue.trim() ? summaryValue : null;

  const showAuthForm = Boolean(data && needsLoginCredentials(data));
  const showRetryLogin = Boolean(data && !showAuthForm && canRetryLoginFailure(data));
  const showError = Boolean(
    data?.errorMessage && (data.status === 'FAILED' || data.status === 'CANCELLED') && !showAuthForm && !showRetryLogin,
  );

  return (
    <AppShell>
      <RunHeader runId={runId} run={data} />

      {run.isError && !data ? (
        <EmptyState
          icon={CircleAlert}
          title="This run could not be loaded"
          description={run.error instanceof ApiError ? run.error.message : 'Check your connection and try again.'}
          action={
            <Button variant="outline" onClick={() => void run.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {data && showAuthForm ? (
        <AuthCredentialsForm runId={runId} projectId={data.projectId} loginUrl={data.currentUrl} />
      ) : null}
      {showRetryLogin ? <RetryLoginButton runId={runId} /> : null}
      {showError ? (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-lg border border-[#f2c4bf] bg-[#fdf1ef] px-4 py-3 text-sm text-ink"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-danger">{data?.status === 'CANCELLED' ? 'Run cancelled' : 'Run stopped with an error'}</p>
            <p className="mt-0.5 break-words text-ink">{data?.errorMessage}</p>
          </div>
        </div>
      ) : null}

      {live && openFindings.length > 0 && tab !== 'findings' ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-ink">
            <span className="font-medium">
              {openFindings.length} snag{openFindings.length === 1 ? '' : 's'} found so far.
            </span>{' '}
            <span className="text-muted-foreground">The full audit is still running and may find more.</span>
          </p>
          <Button size="sm" variant="outline" onClick={() => setChosenTab('findings')}>
            See them now
          </Button>
        </div>
      ) : null}

      {data || !run.isError ? (
        <Tabs value={tab} onValueChange={setChosenTab}>
          <TabsList className="w-full justify-start sm:w-auto">
            <TabsTrigger value="live">
              {live ? <span className="live-dot" aria-hidden /> : <MonitorPlay />}
              Live
            </TabsTrigger>
            <TabsTrigger value="overview">
              <LayoutDashboard />
              Overview
            </TabsTrigger>
            <TabsTrigger value="findings">
              <Bug />
              Findings
              <TabCount value={openFindings.length} />
            </TabsTrigger>
            <TabsTrigger value="tests">
              <FlaskConical />
              Tests
              <TabCount value={data?.testCases?.length ?? 0} />
            </TabsTrigger>
            <TabsTrigger value="journeys">
              <Route />
              Journeys
              <TabCount value={Array.isArray(payload.journeys) ? payload.journeys.length : 0} />
            </TabsTrigger>
            <TabsTrigger value="interactions">
              <MousePointerClick />
              Interactions
            </TabsTrigger>
            <TabsTrigger value="flows">
              <Workflow />
              Flows
            </TabsTrigger>
            <TabsTrigger value="evidence">
              <ImageIcon />
              Evidence
            </TabsTrigger>
            <TabsTrigger value="log">
              <ScrollText />
              Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live">
            {data ? <LiveView key={runId} runId={runId} run={data} /> : <LiveSkeleton />}
          </TabsContent>

          <TabsContent value="overview" className="space-y-6">
            {data ? (
              <>
                <RunContextStrip payload={payload} />
                <ReportHero
                  score={score}
                  summary={summary}
                  severityCounts={severityCounts}
                  payload={payload}
                  status={data.status}
                  actions={
                    // The report buttons already sit in the page header; one action here.
                    <Button variant="outline" onClick={() => setChosenTab('findings')}>
                      View findings
                    </Button>
                  }
                />
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <TopFindings findings={allFindings} onOpen={() => setChosenTab('findings')} />
                  <SinceLastRunCard payload={payload} previousRunId={data.previousRunId} />
                  <HealthScoreCard payload={payload} />
                  <SafetySummaryCard payload={payload} effectiveMode={data.effectiveSafetyMode} />
                  <TestsSummaryCard payload={payload} />
                  <IntentResultsCard payload={payload} />
                  <RecommendationsCard payload={payload} />
                  <CoverageCostCard
                    coverage={{
                      discoveredFlows: data.coverage?.discoveredFlows ?? data.flows?.length ?? 0,
                      testedFlows: data.coverage?.testedFlows ?? 0,
                      successfulFlows: data.coverage?.successfulFlows ?? 0,
                      failedFlows: data.coverage?.failedFlows ?? 0,
                      untestedFlows: data.coverage?.untestedFlows ?? 0,
                    }}
                    cost={{
                      aiCostUsd: data.cost?.aiCostUsd ?? 0,
                      browserDurationLabel: formatDuration(data.cost?.browserDurationMs ?? data.elapsedMs ?? 0),
                      storageLabel: formatBytes(data.cost?.storageBytesEstimate ?? 0),
                    }}
                  />
                </div>
              </>
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}
          </TabsContent>

          <TabsContent value="findings">
            {data ? (
              <FindingsPanel
                runId={runId}
                findings={allFindings}
                pending={updateFinding.isPending}
                onStatus={(findingId, status) => updateFinding.mutate({ findingId, status })}
                onNotABug={(findingId, reason) =>
                  updateFinding.mutate({ findingId, status: 'DISMISSED', remember: true, reason })
                }
              />
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}
          </TabsContent>

          <TabsContent value="tests">
            {data ? (
              <TestsList testCases={data.testCases ?? []} testRuns={data.testRuns ?? []} live={live} />
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}
          </TabsContent>

          <TabsContent value="journeys" className="space-y-6">
            {data ? (
              <>
                <RunContextStrip payload={payload} />
                <JourneysView runId={runId} payload={payload} />
              </>
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}
          </TabsContent>

          <TabsContent value="interactions">
            {data ? <InteractionsView payload={payload} /> : <Skeleton className="h-64 w-full rounded-lg" />}
          </TabsContent>

          <TabsContent value="flows">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Application graph</CardTitle>
                    <CardDescription>
                      Every screen the audit reached and the actions between them. Self-loops are counted on the node.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-4 text-[13px] text-muted-foreground" aria-label="Legend">
                    <Legend dot="bg-success" label="Visited" />
                    <Legend dot="bg-danger" label="Has findings" />
                    <Legend dot="bg-[#cfd3d9]" label="Untested" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <FlowGraph
                  states={data?.states ?? []}
                  edges={data?.edges ?? []}
                  failedUrls={allFindings.map((item) => item.url ?? '').filter(Boolean)}
                />
                {data?.flows?.length ? (
                  <div>
                    <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">
                      Discovered flows ({data.flows.length})
                    </h3>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {data.flows.map((flow) => (
                        <li key={flow.id} className="px-4 py-2.5">
                          <p className="text-sm font-medium text-ink">{flow.name}</p>
                          {flow.description ? (
                            <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{flow.description}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evidence">
            {data ? (
              <PageEvidence runId={runId} run={data} payload={payload} />
            ) : (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}
          </TabsContent>

          <TabsContent value="log">
            <EventLog events={data?.events ?? []} />
          </TabsContent>
        </Tabs>
      ) : null}
    </AppShell>
  );
}

function TabCount({ value }: { value: number }) {
  if (!value) {
    return null;
  }
  return (
    <span className="tabular rounded-[4px] bg-well px-1.5 py-px text-[12px] font-medium text-muted-foreground">
      {value}
    </span>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function LiveSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="aspect-[16/10] w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}
