import pino, { type Logger } from 'pino';

const REDACT_PATHS = [
  'password',
  'passwordHash',
  'secret',
  'secretCiphertext',
  '*.password',
  '*.secret',
  'req.headers.cookie',
  'req.headers.authorization',
];

export function createLogger(options: { name: string; level?: string }): Logger {
  return pino({
    name: options.name,
    level: options.level ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
  });
}

export interface ErrorReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

export function createErrorReporter(
  logger: Logger,
  sentryDsn: string | undefined,
): ErrorReporter {
  const dsn = sentryDsn?.trim();

  return {
    captureException(error, context) {
      logger.error({ err: error, sentryReady: Boolean(dsn), ...context }, 'captured exception');
    },
  };
}
