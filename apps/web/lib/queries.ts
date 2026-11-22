import { ApiError, api } from './api';
import type {
  Credential,
  CredentialType,
  Environment,
  FailureClass,
  Organization,
  OrganizationStats,
  Project,
  Run,
  RunStage,
  Finding,
  SafetyMode,
  SessionUser,
  EnvironmentKind,
  TestPlan,
  AlertSettings,
  BrandingBody,
  Device,
  Integration,
  IntegrationBody,
  IntegrationProvider,
  MonitorCadence,
  MonitoringBody,
  PublicReport,
  TicketProvider,
  PlanId,
  Usage,
  FreeScanView,
} from '@auditor/shared';

export const authApi = {
  register: (payload: { email: string; name: string; password: string }) =>
    api<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    api<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<SessionUser>('/auth/me'),
  forgotPassword: (email: string) =>
    api<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (payload: { token: string; password: string }) =>
    api<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) }),
  verifyEmail: (token: string) => api<{ ok: true }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: () => api<{ ok: true; alreadyVerified: boolean }>('/auth/resend-verification', { method: 'POST' }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    api<void>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAccount: (payload: { password: string; confirmEmail: string }) =>
    api<{ workspacesDeleted: number; workspacesKept: number }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }),
};

export const orgApi = {
  list: () => api<Organization[]>('/organizations'),
  create: (payload: { name: string }) =>
    api<Organization>('/organizations', { method: 'POST', body: JSON.stringify(payload) }),
  get: (id: string) => api<Organization>(`/organizations/${id}`),
  stats: (id: string) => api<OrganizationStats>(`/organizations/${id}/stats`),
};

export type ProjectDetail = Project & { environments: Environment[] };

export const projectApi = {
  list: (organizationId: string) => api<Project[]>(`/projects?organizationId=${organizationId}`),
  get: (id: string) => api<ProjectDetail>(`/projects/${id}`),
  create: (payload: {
    organizationId: string;
    name: string;
    description?: string;
    baseUrl: string;
    environmentName?: string;
    safetyMode?: SafetyMode;
    stagingUrl?: string;
    stagingSafetyMode?: SafetyMode;
    designReview?: boolean;
  }) => api<ProjectDetail>('/projects', { method: 'POST', body: JSON.stringify(payload) }),
  update: (
    id: string,
    payload: { testPlan?: TestPlan } & Partial<
      Pick<
        Project,
        | 'name'
        | 'description'
        | 'baseUrl'
        | 'maxPages'
        | 'maxActions'
        | 'maxDepth'
        | 'maxDurationMs'
        | 'allowDestructive'
        | 'allowPrivateTargets'
        | 'recordVideo'
        | 'designReview'
        | 'safetyMode'
        | 'resetHookUrl'
        | 'intents'
        | 'blockedPathPatterns'
      >
    >,
  ) => api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  environments: (id: string) => api<Environment[]>(`/projects/${id}/environments`),
  createEnvironment: (id: string, payload: EnvironmentPayload) =>
    api<Environment>(`/projects/${id}/environments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEnvironment: (id: string, environmentId: string, payload: Partial<EnvironmentPayload>) =>
    api<Environment>(`/projects/${id}/environments/${environmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  credentials: (id: string) => api<Credential[]>(`/projects/${id}/credentials`),
  createCredential: (
    id: string,
    payload: { name: string; username: string; secret: string; type?: CredentialType },
  ) =>
    api<Credential>(`/projects/${id}/credentials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteCredential: (id: string, credentialId: string) =>
    api<void>(`/projects/${id}/credentials/${credentialId}`, { method: 'DELETE' }),
  /** Verification for the project URL, or for one environment's host when environmentId is given. */
  requestVerification: (id: string, environmentId?: string) =>
    api<VerificationInstructions>(`/projects/${id}/verification${envQuery(environmentId)}`, { method: 'POST' }),
  checkVerification: (id: string, environmentId?: string) =>
    api<VerificationCheck>(`/projects/${id}/verification/check${envQuery(environmentId)}`, { method: 'POST' }),
  tokens: (id: string) => api<ApiTokenItem[]>(`/projects/${id}/tokens`),
  createToken: (id: string, payload: { name: string }) =>
    api<ApiTokenItem & { token: string }>(`/projects/${id}/tokens`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeToken: (id: string, tokenId: string) =>
    api<void>(`/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' }),
  suppressions: (id: string) => api<Suppression[]>(`/projects/${id}/suppressions`),
  deleteSuppression: (id: string, suppressionId: string) =>
    api<void>(`/projects/${id}/suppressions/${suppressionId}`, { method: 'DELETE' }),
};

function envQuery(environmentId: string | undefined): string {
  return environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : '';
}

export type EnvironmentPayload = {
  name: string;
  baseUrl: string;
  kind?: EnvironmentKind;
  /** null = inherit the project's safety mode. */
  safetyMode?: SafetyMode | null;
};

export type VerificationInstructions = {
  host: string;
  token: string;
  verified: boolean;
  verifiedAt: string | null;
  dnsRecordName: string;
  dnsRecordValue: string;
  fileUrl: string;
  fileContents: string;
};

export type VerificationCheck = VerificationInstructions & { detail: string };

export type ApiTokenItem = {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type Suppression = {
  id: string;
  projectId: string;
  signature: string;
  title: string;
  reason: string | null;
  createdAt: string;
};

export type RunDetail = Run & {
  stages: RunStage[];
  findings: Array<
    Finding & {
      confidence?: number;
      expected?: string | null;
      actual?: string | null;
      recommendation?: string | null;
      steps?: unknown;
      url?: string | null;
      evidence?: Array<{
        id: string;
        type: string;
        storageKey: string;
        contentType: string;
        fileName?: string | null;
      }>;
    }
  >;
  pages?: Array<{ id: string; url: string; title: string | null; screenshotKey?: string | null }>;
  states?: Array<{
    id: string;
    name: string;
    fingerprint: string;
    url?: string | null;
    title?: string | null;
    screenshotKey?: string | null;
    visited?: boolean;
  }>;
  edges?: Array<{ id: string; fromStateId: string; toStateId: string; actionId: string | null }>;
  flows?: Array<{ id: string; name: string; description: string | null }>;
  testCases?: Array<{
    id: string;
    name: string;
    description: string | null;
    category?: string;
    priority?: string;
    flowId?: string | null;
    steps?: unknown;
    expectedResults?: unknown;
    source?: string;
    quarantined?: boolean;
    intentId?: string | null;
  }>;
  testRuns?: Array<{
    id: string;
    testCaseId: string;
    status: string;
    errorMessage: string | null;
    durationMs?: number | null;
    failureClass?: FailureClass | null;
    screenshotFailureKey?: string | null;
    videoKey?: string | null;
    traceKey?: string | null;
    consoleKey?: string | null;
    networkKey?: string | null;
  }>;
  evidence?: Array<{
    id: string;
    type: string;
    contentType: string;
    storageKey?: string;
    fileName?: string | null;
    findingId?: string | null;
    testRunId?: string | null;
  }>;
  report?: { id: string; qualityScore: number | null; summary: string | null; payload?: unknown } | null;
  reportPayload?: unknown;
  coverage?: {
    discoveredFlows: number;
    testedFlows: number;
    successfulFlows: number;
    failedFlows: number;
    untestedFlows: number;
  };
  cost?: { aiCostUsd: number; browserDurationMs: number; storageBytesEstimate: number };
  events?: Array<{ id: string; kind: string; message: string; url: string | null; createdAt: string | Date }>;
  elapsedMs?: number;
  currentUrl?: string | null;
  currentAction?: string | null;
  pagesDiscovered?: number;
  statesDiscovered?: number;
  actionsExecuted?: number;
  flowsDiscovered?: number;
  lastScreenshotKey?: string | null;
  qualityScore?: number | null;
  project: { id: string; name: string; baseUrl: string };
  environment: {
    id: string;
    name: string;
    baseUrl: string;
    kind?: EnvironmentKind;
    safetyMode?: SafetyMode | null;
  } | null;
};

export const runApi = {
  list: (projectId: string) => api<Run[]>(`/projects/${projectId}/runs`),
  get: (runId: string) => api<RunDetail>(`/runs/${runId}`),
  create: (
    projectId: string,
    payload?: {
      environmentId?: string;
      replayOfRunId?: string;
      baseUrl?: string;
      trigger?: 'manual';
      device?: Device;
      bugAudit?: boolean;
      designReview?: boolean;
    },
  ) =>
    api<Run>(`/projects/${projectId}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  cancel: (runId: string) => api<Run>(`/runs/${runId}/cancel`, { method: 'POST' }),
  retry: (runId: string) => api<Run>(`/runs/${runId}/retry`, { method: 'POST' }),
  updateFinding: (
    runId: string,
    findingId: string,
    status: string,
    options?: { remember?: boolean; reason?: string },
  ) =>
    api<Finding>(`/runs/${runId}/findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...options }),
    }),
  exportPlaywright: async (runId: string): Promise<Blob> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/export/playwright`, { credentials: 'include' });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as { message?: string; error?: string } | undefined;
      throw new ApiError(response.status, body);
    }
    return response.blob();
  },
  screenshot: async (runId: string): Promise<Blob | null> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/screenshot`, { credentials: 'include' });
    if (!response.ok) {
      return null;
    }
    return response.blob();
  },
  evidence: async (runId: string, evidenceId: string): Promise<Blob | null> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/evidence/${evidenceId}`, { credentials: 'include' });
    if (!response.ok) {
      return null;
    }
    return response.blob();
  },
  /** What the audit browser is doing right now: action, element box and frame sequence. */
  live: async (runId: string): Promise<LiveState> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/live`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      throw new ApiError(response.status, undefined);
    }
    return (await response.json()) as LiveState;
  },
  /** Newest JPEG frame of the audit browser, or null when none exists yet. */
  liveFrame: async (runId: string, seq: number): Promise<Blob | null> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/live/frame?seq=${seq}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return response.blob();
  },
  /** Absolute URL of the self-contained HTML report (served inline, 404 until the run completes). */
  reportHtmlUrl: (runId: string, download = false): string => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    return `${API_URL}/runs/${runId}/report.html${download ? '?download=1' : ''}`;
  },
  reportHtml: async (runId: string): Promise<Blob> => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${API_URL}/runs/${runId}/report.html?download=1`, { credentials: 'include' });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as { message?: string; error?: string } | undefined;
      throw new ApiError(response.status, body);
    }
    return response.blob();
  },
};

export type LiveActionKind = 'navigate' | 'click' | 'type' | 'select' | 'assert' | 'observe' | 'wait' | 'info';

export type LivePhase = 'starting' | 'opening' | 'authenticating' | 'exploring' | 'testing' | 'probing' | 'journeys' | 'analyzing';

export type LiveBox = { x: number; y: number; width: number; height: number };

export type LiveState =
  | { available: false; status: Run['status'] }
  | {
      available: true;
      status: Run['status'];
      seq: number;
      at: string;
      url: string;
      viewport: { width: number; height: number };
      action: { label: string; kind: LiveActionKind; box?: LiveBox | null } | null;
      phase: LivePhase;
    };

/* ---------------------------------------------- monitoring, alerts, tickets */

export type MonitoringSettings = {
  cadence: MonitorCadence | null;
  hourUtc: number;
  weekday: number;
  environmentId: string | null;
  devices: Device[];
  nextRunAt: string | null;
  alerts: Partial<AlertSettings>;
};

export type ShareLink = { token: string; url: string; sharedAt: string };

export const launchApi = {
  monitoring: (projectId: string) => api<MonitoringSettings>(`/projects/${projectId}/monitoring`),
  saveMonitoring: (projectId: string, payload: MonitoringBody) =>
    api<MonitoringSettings>(`/projects/${projectId}/monitoring`, { method: 'PUT', body: JSON.stringify(payload) }),
  integrations: (projectId: string) => api<Integration[]>(`/projects/${projectId}/integrations`),
  saveIntegration: (projectId: string, payload: IntegrationBody) =>
    api<Integration>(`/projects/${projectId}/integrations`, { method: 'PUT', body: JSON.stringify(payload) }),
  removeIntegration: (projectId: string, provider: IntegrationProvider) =>
    api<void>(`/projects/${projectId}/integrations/${provider}`, { method: 'DELETE' }),
  testIntegration: (projectId: string, provider: 'slack' | 'webhook') =>
    api<{ ok: true }>(`/projects/${projectId}/integrations/${provider}/test`, { method: 'POST' }),
  createTicket: (runId: string, findingId: string, provider: TicketProvider) =>
    api<{ provider: TicketProvider; url: string; existing: boolean }>(`/runs/${runId}/findings/${findingId}/ticket`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  share: (runId: string) => api<ShareLink>(`/runs/${runId}/share`, { method: 'POST' }),
  unshare: (runId: string) => api<void>(`/runs/${runId}/share`, { method: 'DELETE' }),
  saveBranding: (organizationId: string, payload: BrandingBody) =>
    api<PublicReport['brand']>(`/organizations/${organizationId}/branding`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  publicReport: (token: string) => api<PublicReport>(`/public/reports/${token}`),
  publicEvidenceUrl: (token: string, evidenceId: string) =>
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/public/reports/${token}/evidence/${evidenceId}`,
};

/* ---------------------------------------------------------- plan and usage */

export type UsageView = Omit<Usage, 'trialEndsAt' | 'periodStart'> & { trialEndsAt: string | null; periodStart: string };

export const planApi = {
  usage: (organizationId: string) => api<UsageView>(`/organizations/${organizationId}/usage`),
  /** Only available outside production, until checkout is connected. */
  setPlan: (organizationId: string, plan: PlanId) =>
    api<UsageView>(`/organizations/${organizationId}/plan`, { method: 'POST', body: JSON.stringify({ plan }) }),
};

export type Onboarding = {
  project: { id: string; name: string } | null;
  firstRun: { id: string; status: string } | null;
  firstReport: { id: string; findings: number } | null;
  monitoring: boolean;
  connected: boolean;
};

export const onboardingApi = {
  get: (organizationId: string) => api<Onboarding>(`/organizations/${organizationId}/onboarding`),
};

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Free checks from the landing page: no account needed to start one or see its teaser. */
export const freeScanApi = {
  start: (url: string) =>
    api<{ token: string; reused: boolean }>('/public/free-scans', { method: 'POST', body: JSON.stringify({ url }) }),
  get: (token: string) => api<FreeScanView>(`/public/free-scans/${token}`),
  screenshotUrl: (token: string) => `${API_ORIGIN}/public/free-scans/${token}/screenshot`,
  claim: (token: string, organizationId: string) =>
    api<{ projectId: string; runId: string; alreadyClaimed: boolean }>(`/free-scans/${token}/claim`, {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    }),
};
