import { z } from 'zod';
import { credentialTypeSchema, membershipRoleSchema, safetyModeSchema } from './enums.js';
import { intentListSchema } from './testing.js';
import { environmentKindSchema, testPlanSchema } from './test-plan.js';

/** Glob-ish path patterns (e.g. "/checkout*", "/api/orders") that the auditor must never send mutating requests to. */
const blockedPathPatternsSchema = z.array(z.string().min(1).max(200).regex(/^\//, 'Patterns must start with /')).max(50);

const email = z.string().email().max(320);
const name = z.string().min(1).max(120);
const password = z.string().min(10).max(200);
const url = z.string().url().max(2048);
const idParam = z.string().min(1);

export const registerBodySchema = z.object({
  email,
  name,
  password,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const membershipPublicSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  role: membershipRoleSchema,
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
});

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  memberships: z.array(membershipPublicSchema),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const createOrganizationBodySchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;

export const updateOrganizationBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
});
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;

export const organizationIdParamsSchema = z.object({
  id: idParam,
});

export const addMemberBodySchema = z.object({
  email,
  role: membershipRoleSchema,
});
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;

export const updateMemberBodySchema = z.object({
  role: membershipRoleSchema,
});
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;

export const memberParamsSchema = z.object({
  id: idParam,
  userId: idParam,
});

export const createProjectBodySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  baseUrl: url,
  environmentName: z.string().min(1).max(80).default('Production'),
  maxPages: z.number().int().positive().max(500).optional(),
  maxActions: z.number().int().positive().max(2000).optional(),
  maxDepth: z.number().int().positive().max(50).optional(),
  maxDurationMs: z.number().int().positive().max(3_600_000).optional(),
  allowDestructive: z.boolean().optional(),
  allowPrivateTargets: z.boolean().optional(),
  recordVideo: z.boolean().optional(),
  safetyMode: safetyModeSchema.optional(),
  resetHookUrl: url.nullable().optional(),
  intents: intentListSchema.optional(),
  blockedPathPatterns: blockedPathPatternsSchema.optional(),
  /** Optional staging copy of the app. Orders, bookings and payments only ever run there. */
  stagingUrl: url.optional(),
  stagingSafetyMode: safetyModeSchema.optional(),
  testPlan: testPlanSchema.optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  baseUrl: url.optional(),
  maxPages: z.number().int().positive().max(500).optional(),
  maxActions: z.number().int().positive().max(2000).optional(),
  maxDepth: z.number().int().positive().max(50).optional(),
  maxDurationMs: z.number().int().positive().max(3_600_000).optional(),
  allowDestructive: z.boolean().optional(),
  allowPrivateTargets: z.boolean().optional(),
  recordVideo: z.boolean().optional(),
  safetyMode: safetyModeSchema.optional(),
  resetHookUrl: url.nullable().optional(),
  intents: intentListSchema.optional(),
  blockedPathPatterns: blockedPathPatternsSchema.optional(),
  testPlan: testPlanSchema.optional(),
});
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

export const projectIdParamsSchema = z.object({
  id: idParam,
});

export const listProjectsQuerySchema = z.object({
  organizationId: z.string().min(1),
});

export const createEnvironmentBodySchema = z.object({
  name: z.string().min(1).max(80),
  baseUrl: url,
  kind: environmentKindSchema.optional(),
  safetyMode: safetyModeSchema.nullable().optional(),
});
export type CreateEnvironmentBody = z.infer<typeof createEnvironmentBodySchema>;

export const updateEnvironmentBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  baseUrl: url.optional(),
  kind: environmentKindSchema.optional(),
  safetyMode: safetyModeSchema.nullable().optional(),
});
export type UpdateEnvironmentBody = z.infer<typeof updateEnvironmentBodySchema>;

export const environmentParamsSchema = z.object({
  id: idParam,
  environmentId: idParam,
});

export const createCredentialBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    type: credentialTypeSchema.default('USERNAME_PASSWORD'),
    /** For STORAGE_STATE credentials this is a free-form label such as "SSO session". */
    username: z.string().min(1).max(320),
    /** A password, or for STORAGE_STATE the JSON from Playwright's `context.storageState()`. */
    secret: z.string().min(1).max(1_000_000),
  })
  .superRefine((body, ctx) => {
    if (body.type === 'USERNAME_PASSWORD' && body.secret.length > 500) {
      ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Password must be at most 500 characters' });
    }
    if (body.type === 'STORAGE_STATE') {
      try {
        const parsed = JSON.parse(body.secret) as { cookies?: unknown; origins?: unknown };
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cookies)) {
          throw new Error('missing cookies');
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['secret'],
          message: 'Storage state must be the JSON produced by Playwright context.storageState() (with a cookies array)',
        });
      }
    }
  });
export type CreateCredentialBody = z.infer<typeof createCredentialBodySchema>;

export const credentialParamsSchema = z.object({
  id: idParam,
  credentialId: idParam,
});

export const createRunBodySchema = z.object({
  environmentId: z.string().min(1).optional(),
  /** Audit a different URL for this run only, e.g. a pull-request preview deployment. */
  baseUrl: url.optional(),
  /** Re-use the recorded AI decisions of an earlier run so the run can be replayed exactly. */
  replayOfRunId: z.string().min(1).optional(),
  trigger: z.enum(['manual', 'ci', 'schedule', 'api']).optional(),
  /** Browser and screen to audit with; defaults to desktop Chrome. */
  device: z.enum(['desktop', 'phone', 'safari', 'iphone']).optional(),
});
export type CreateRunBody = z.infer<typeof createRunBodySchema>;

export const projectScopedParamsSchema = z.object({
  projectId: idParam,
});

export const runIdParamsSchema = z.object({
  runId: idParam,
});

export const findingParamsSchema = z.object({
  runId: idParam,
  findingId: idParam,
});

export const evidenceParamsSchema = z.object({
  runId: idParam,
  evidenceId: idParam,
});

export const updateFindingBodySchema = z.object({
  status: z.enum(['OPEN', 'CONFIRMED', 'IGNORED', 'RESOLVED', 'ACKNOWLEDGED', 'DISMISSED']),
  /** When true with DISMISSED or IGNORED, future runs of this project hide findings with the same signature. */
  remember: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export const createApiTokenBodySchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateApiTokenBody = z.infer<typeof createApiTokenBodySchema>;

export const apiTokenSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const suppressionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  signature: z.string(),
  title: z.string(),
  reason: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type UpdateFindingBody = z.infer<typeof updateFindingBodySchema>;

export const errorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

export const organizationStatsSchema = z.object({
  totalProjects: z.number().int().nonnegative(),
  totalRuns: z.number().int().nonnegative(),
  openFindings: z.number().int().nonnegative(),
  criticalFindings: z.number().int().nonnegative(),
  averageQualityScore: z.number().min(0).max(100).nullable(),
});
export type OrganizationStats = z.infer<typeof organizationStatsSchema>;
