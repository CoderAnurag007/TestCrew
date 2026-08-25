import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
});

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        response: { 200: healthSchema },
      },
    },
    async () => ({ status: 'ok' as const, service: 'api' }),
  );
}
