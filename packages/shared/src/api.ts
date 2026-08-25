import { z } from 'zod';
import { credentialTypeSchema, membershipRoleSchema } from './enums.js';

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
});
export type CreateEnvironmentBody = z.infer<typeof createEnvironmentBodySchema>;

export const updateEnvironmentBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  baseUrl: url.optional(),
});
export type UpdateEnvironmentBody = z.infer<typeof updateEnvironmentBodySchema>;

export const environmentParamsSchema = z.object({
  id: idParam,
  environmentId: idParam,
});

export const createCredentialBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: credentialTypeSchema.default('USERNAME_PASSWORD'),
  username: z.string().min(1).max(320),
  secret: z.string().min(1).max(500),
});
export type CreateCredentialBody = z.infer<typeof createCredentialBodySchema>;

export const credentialParamsSchema = z.object({
  id: idParam,
  credentialId: idParam,
});

export const createRunBodySchema = z.object({
  environmentId: z.string().min(1).optional(),
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
