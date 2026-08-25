import type { Prisma, PrismaClient } from '@auditor/database';
import type { FastifyRequest } from 'fastify';

export async function writeAuditLog(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    organizationId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      organizationId: input.organizationId,
      userId: request.currentUser?.id,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      requestId: request.id,
      ipAddress: request.ip,
    },
  });
}
