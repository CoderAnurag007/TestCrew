/** A short, readable reason for a failed AI call, for logs (never includes keys). */
export function describeAiError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues.slice(0, 3);
    return `The AI answer did not match the expected format: ${issues
      .map((issue) => `${(issue.path ?? []).join('.') || 'root'} ${issue.message ?? ''}`.trim())
      .join('; ')}`;
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 400);
}
