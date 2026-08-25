import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createModelRouter, ExplorerAgent } from '@auditor/ai';
import { LocalFileStorage } from '@auditor/analyzer';
import { loadWorkerEnv } from '@auditor/config';
import { createPrismaClient, LocalAesGcmSecretStore } from '@auditor/database';
import { FIXTURE_PASSWORD, FIXTURE_USER, startFixture, type FixtureServer } from '@auditor/fixture';
import { DISCOVER_APPLICATION_JOB, EXPLORE_STATE_JOB, START_AUDIT_JOB } from '@auditor/shared';
import { executeAuditRun, type QueuePort } from '../src/engine.js';
import { handleAuditJob, handleExplorationJob } from '../src/processors/jobs.js';

config({ path: resolve(import.meta.dirname, '../../../.env') });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '../../../.playwright');

describe('audit job handlers', () => {
  it('routes START_AUDIT, DISCOVER_APPLICATION, and EXPLORE_STATE', async () => {
    const calls: string[] = [];
    const deps = {
      prisma: { run: { findUnique: async () => null } },
      secrets: { encrypt: async (v: string) => v, decrypt: async (v: string) => v },
      storage: { put: async () => ({ key: 'x' }), get: async () => Buffer.from('') },
      explorer: new ExplorerAgent(createModelRouter({ model: 'heuristic' })),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    };
    await handleAuditJob(deps as never, {
      name: START_AUDIT_JOB,
      data: { runId: 'missing', organizationId: 'o', projectId: 'p' },
    } as never);
    await handleExplorationJob(
      {
        ...deps,
        prisma: {
          run: {
            findUnique: async () => {
              calls.push('discover');
              return null;
            },
          },
        },
      } as never,
      {
        name: DISCOVER_APPLICATION_JOB,
        data: { runId: 'missing', organizationId: 'o', projectId: 'p' },
      } as never,
    );
    await handleExplorationJob(
      {
        ...deps,
        prisma: {
          run: {
            findUnique: async () => {
              calls.push('explore');
              return null;
            },
          },
        },
      } as never,
      {
        name: EXPLORE_STATE_JOB,
        data: { runId: 'missing', organizationId: 'o', projectId: 'p' },
      } as never,
    );
    expect(calls).toEqual(['discover', 'explore']);
  });
});

describe('end-to-end exploration against the fixture app', () => {
  let fixture: FixtureServer;
  let artifactDir: string;

  beforeAll(async () => {
    fixture = await startFixture();
    artifactDir = await mkdtemp(join(tmpdir(), 'auditor-run-'));
  });

  afterAll(async () => {
    await fixture.close();
    await rm(artifactDir, { recursive: true, force: true });
  });

  it('authenticates, discovers states, and respects exploration limits', async () => {
    const env = loadWorkerEnv({
      ...process.env,
      ARTIFACT_DIR: artifactDir,
    });
    const prisma = createPrismaClient(env.DATABASE_URL);
    const secrets = LocalAesGcmSecretStore.fromHexKey(env.CREDENTIAL_ENCRYPTION_KEY);
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `worker-${suffix}@example.com`,
        name: 'Worker',
        passwordHash: 'not-used',
      },
    });
    const org = await prisma.organization.create({
      data: { name: `Org ${suffix}`, slug: `org-${suffix}` },
    });
    await prisma.membership.create({
      data: { organizationId: org.id, userId: user.id, role: 'OWNER' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Fixture',
        baseUrl: fixture.url,
        allowPrivateTargets: true,
        maxPages: 6,
        maxActions: 12,
        maxDepth: 4,
        maxDurationMs: 90_000,
        allowDestructive: false,
      },
    });
    const ciphertext = await secrets.encrypt(FIXTURE_PASSWORD);
    await prisma.credential.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Demo',
        type: 'USERNAME_PASSWORD',
        username: FIXTURE_USER,
        secretCiphertext: ciphertext,
      },
    });
    const run = await prisma.run.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        status: 'QUEUED',
        createdById: user.id,
      },
    });

    const jobs: Array<{ name: string }> = [];
    const explorationQueue: QueuePort = {
      add: async (name) => {
        jobs.push({ name });
        return { id: name };
      },
    };

    await executeAuditRun(
      {
        prisma,
        secrets,
        storage: new LocalFileStorage(artifactDir),
        explorer: new ExplorerAgent(createModelRouter({ model: 'heuristic' })),
        ai: createModelRouter({ model: 'heuristic' }),
        explorationQueue,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      { runId: run.id, organizationId: org.id, projectId: project.id },
    );

    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(['COMPLETED', 'AUTHENTICATING']).toContain(finished.status);
    expect(finished.pagesDiscovered).toBeGreaterThan(0);
    expect(finished.statesDiscovered).toBeGreaterThan(0);
    const states = await prisma.state.findMany({ where: { runId: run.id } });
    const fingerprints = states.map((state) => state.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    const actions = await prisma.action.findMany({ where: { runId: run.id } });
    expect(actions.every((action) => action.riskLevel !== 'DESTRUCTIVE')).toBe(true);
    expect(jobs.map((job) => job.name)).toEqual(
      expect.arrayContaining([DISCOVER_APPLICATION_JOB, EXPLORE_STATE_JOB]),
    );
    expect(JSON.stringify(finished)).not.toContain(FIXTURE_PASSWORD);

    if (finished.status === 'COMPLETED') {
      const tests = await prisma.testCase.findMany({ where: { runId: run.id } });
      const findings = await prisma.finding.findMany({ where: { runId: run.id } });
      const report = await prisma.report.findUnique({ where: { runId: run.id } });
      expect(tests.length).toBeGreaterThan(0);
      expect(findings.length).toBeGreaterThan(0);
      expect(report?.qualityScore).toEqual(expect.any(Number));
      expect(
        findings.some(
          (finding) =>
            finding.category === 'ACCESSIBILITY' ||
            finding.category === 'BUG' ||
            finding.category === 'UX' ||
            finding.category === 'VISUAL',
        ),
      ).toBe(true);
    }

    await prisma.$disconnect();
  });
});
