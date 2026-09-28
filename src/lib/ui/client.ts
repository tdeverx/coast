import { invalidateAll } from '$app/navigation';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = 'POST',
  options: Pick<RequestInit, 'signal'> = {}
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...options,
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response
    .json()
    .catch(() => ({ error: 'The server could not complete this request.' }));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent('coast:auth-expired'));
    throw new ApiError(
      payload.error ?? 'Something went wrong. Please try again.',
      response.status,
      payload
    );
  }
  return payload as T;
}
export async function change<T = unknown>(path: string, body?: unknown, method = 'POST') {
  const result = await api<T>(path, body, method);
  await invalidateAll();
  return result;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
