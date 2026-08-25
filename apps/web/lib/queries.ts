import { api } from './api';
import type {
  Credential,
  Environment,
  Organization,
  OrganizationStats,
  Project,
  Run,
  RunStage,
  Finding,
  SessionUser,
} from '@auditor/shared';

export const authApi = {
  register: (payload: { email: string; name: string; password: string }) =>
    api<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    api<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<SessionUser>('/auth/me'),
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
  }) => api<ProjectDetail>('/projects', { method: 'POST', body: JSON.stringify(payload) }),
  update: (
    id: string,
    payload: Partial<
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
      >
    >,
  ) => api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  environments: (id: string) => api<Environment[]>(`/projects/${id}/environments`),
  createEnvironment: (id: string, payload: { name: string; baseUrl: string }) =>
    api<Environment>(`/projects/${id}/environments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  credentials: (id: string) => api<Credential[]>(`/projects/${id}/credentials`),
  createCredential: (
    id: string,
    payload: { name: string; username: string; secret: string; type?: 'USERNAME_PASSWORD' },
  ) =>
    api<Credential>(`/projects/${id}/credentials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteCredential: (id: string, credentialId: string) =>
    api<void>(`/projects/${id}/credentials/${credentialId}`, { method: 'DELETE' }),
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
  pages?: Array<{ id: string; url: string; title: string | null }>;
  states?: Array<{
    id: string;
    name: string;
    fingerprint: string;
    url?: string | null;
    title?: string | null;
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
  }>;
  testRuns?: Array<{
    id: string;
    testCaseId: string;
    status: string;
    errorMessage: string | null;
    durationMs?: number | null;
    screenshotFailureKey?: string | null;
    videoKey?: string | null;
    traceKey?: string | null;
    consoleKey?: string | null;
    networkKey?: string | null;
  }>;
  evidence?: Array<{ id: string; type: string; contentType: string; fileName?: string | null; findingId?: string | null }>;
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
  environment: { id: string; name: string; baseUrl: string } | null;
};

export const runApi = {
  list: (projectId: string) => api<Run[]>(`/projects/${projectId}/runs`),
  get: (runId: string) => api<RunDetail>(`/runs/${runId}`),
  create: (projectId: string, payload?: { environmentId?: string }) =>
    api<Run>(`/projects/${projectId}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  cancel: (runId: string) => api<Run>(`/runs/${runId}/cancel`, { method: 'POST' }),
  retry: (runId: string) => api<Run>(`/runs/${runId}/retry`, { method: 'POST' }),
  updateFinding: (runId: string, findingId: string, status: string) =>
    api<Finding>(`/runs/${runId}/findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
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
};
