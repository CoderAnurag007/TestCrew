import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/http-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function originGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }
  if (request.apiToken) {
    // Bearer tokens are not sent automatically by browsers, so CSRF does not apply.
    return;
  }

  const allowed = request.server.env.WEB_ORIGIN;
  const origin = request.headers.origin;

  if (!origin) {
    if (request.server.env.NODE_ENV === 'production') {
      throw new HttpError(403, 'Missing Origin header');
    }
    return;
  }

  if (origin !== allowed) {
    throw new HttpError(403, 'Origin is not allowed');
  }
}
