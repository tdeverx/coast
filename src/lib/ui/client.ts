import { diagnosticHeaders, receiveDiagnosticLevel } from './diagnostics';
import { invalidate } from '$app/navigation';

export type ApiTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
  return requestApi<T>(fetch, path, body, method, options);
}
async function requestApi<T>(transport: ApiTransport, path: string, body: unknown, method: string, options: Pick<RequestInit, 'signal'>): Promise<T> {
  const response = await transport(`/api/v1/${path}`, {
    ...options,
    method,
    headers: { ...diagnosticHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  receiveDiagnosticLevel(response);
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
export function createApiClient(transport: ApiTransport, afterChange: (path: string) => Promise<void>) {
  const api = <T = unknown>(path: string, body?: unknown, method = 'POST', options: Pick<RequestInit, 'signal'> = {}) => requestApi<T>(transport, path, body, method, options);
  const change = async <T = unknown>(path: string, body?: unknown, method = 'POST') => {
    const result = await api<T>(path, body, method);
    await afterChange(path);
    return result;
  };
  return { api, change };
}
export async function change<T = unknown>(path: string, body?: unknown, method = 'POST') {
  const result = await api<T>(path, body, method);
  await refreshAfterChange(path);
  return result;
}
export async function refreshAfterChange(path: string) {
  const domain = path.split('/')[0];
  const dependencies = domain === 'social' ? ['social', 'notifications']
    : domain === 'notifications' ? ['notifications']
    : ['providers', 'queue', 'conflicts', 'requests'].includes(domain) ? ['providers', 'tracking', 'notifications']
    : ['settings', 'profile', 'admin'].includes(domain) ? ['session', 'settings', 'tracking', 'social']
    : ['tracking', 'ratings', 'collection', 'music', 'games', 'game-playthroughs', 'lists', 'up-next', 'continue', 'rewatch', 'media'].includes(domain) ? ['tracking', 'social']
    : [];
  await Promise.all(dependencies.map(key => invalidate(`coast:${key}`)));
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
