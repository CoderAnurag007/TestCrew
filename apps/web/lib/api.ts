const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { message?: string; error?: string } | undefined,
  ) {
    super(body?.message ?? body?.error ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => undefined)) as
    | ({ message?: string; error?: string } & T)
    | undefined;

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body as T;
}
