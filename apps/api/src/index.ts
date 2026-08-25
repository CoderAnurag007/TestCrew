import { loadApiEnv } from '@auditor/config';
import { buildApp } from './app.js';

const env = loadApiEnv();
const app = await buildApp(env);

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ err: error }, 'failed to start API');
  process.exit(1);
}
