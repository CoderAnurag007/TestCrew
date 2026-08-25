import { organizationIdParamsSchema, organizationStatsSchema } from '@auditor/shared';
import type { FastifyInstance } from 'fastify';
import { requireOrgRole } from '../../middleware/auth.js';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/organizations/:id/stats',
    {
      schema: {
        tags: ['Dashboard'],
        security: [{ cookieAuth: [] }],
        params: organizationIdParamsSchema,
        response: { 200: organizationStatsSchema },
      },
    },
    async (request) => {
      const { id } = organizationIdParamsSchema.parse(request.params);
      await requireOrgRole(request, id, 'VIEWER');

      const [totalProjects, totalRuns, openFindings, criticalFindings, quality] = await Promise.all([
        app.prisma.project.count({ where: { organizationId: id } }),
        app.prisma.run.count({ where: { organizationId: id } }),
        app.prisma.finding.count({
          where: { organizationId: id, status: 'OPEN' },
        }),
        app.prisma.finding.count({
          where: { organizationId: id, status: 'OPEN', severity: 'CRITICAL' },
        }),
        app.prisma.report.aggregate({
          where: { organizationId: id, qualityScore: { not: null } },
          _avg: { qualityScore: true },
        }),
      ]);

      return {
        totalProjects,
        totalRuns,
        openFindings,
        criticalFindings,
        averageQualityScore: quality._avg.qualityScore,
      };
    },
  );
}
