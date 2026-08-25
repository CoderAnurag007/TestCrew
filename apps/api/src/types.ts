import type { ApiEnv } from '@auditor/config';
import type { ObjectStorage } from '@auditor/analyzer';
import type { PrismaClient, SecretStore } from '@auditor/database';
import type { MembershipRole } from '@auditor/shared';
import type { RunQueuePort, SessionStore } from './lib/runtime.js';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  memberships: Array<{
    id: string;
    organizationId: string;
    role: MembershipRole;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: ApiEnv;
    prisma: PrismaClient;
    redis: SessionStore;
    secrets: SecretStore;
    runQueue: RunQueuePort;
    storage: ObjectStorage;
  }

  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
