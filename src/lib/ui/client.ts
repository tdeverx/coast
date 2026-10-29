import { diagnosticHeaders, receiveDiagnosticLevel } from './diagnostics';
import { invalidate, refreshAll } from '$app/navigation';
import { page } from '$app/state';
import { invalidateContentRevision, type ContentDomain } from './content-revision.svelte';
import { notifyAction } from './action-feedback.svelte';

let playbackApi = '/api/v1/';
let playbackApiRevision = 0;
export function setPlaybackApi(shared:boolean){
  const revision=++playbackApiRevision;
  playbackApi=shared?'/api/share/':'/api/v1/';
  return ()=>{if(revision===playbackApiRevision)playbackApi='/api/v1/';};
}
/** Preparation and its late cleanup must keep the same authority across route teardown. */
export function capturePlaybackApi() {
  const base = playbackApi;
  return <T = unknown>(path: string, body?: unknown, method = 'POST', options: Pick<RequestInit, 'signal'> = {}) => requestApi<T>(fetch, path, body, method, options, base);
}

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
/** A feature withdrawal is a terminal resource boundary, not a transient network failure. */
export function isFeatureDisabled(cause:unknown) {
  return cause instanceof ApiError && !!cause.details && typeof cause.details==='object' &&
    'code' in cause.details && ['feature_disabled','experimental_disabled'].includes(String(cause.details.code));
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = 'POST',
  options: Pick<RequestInit, 'signal'> = {}
): Promise<T> {
  return requestApi<T>(fetch, path, body, method, options);
}
async function requestApi<T>(transport: ApiTransport, path: string, body: unknown, method: string, options: Pick<RequestInit, 'signal'>, playbackBase = playbackApi): Promise<T> {
  options.signal?.throwIfAborted();
  const sharedPlayback = playbackBase === '/api/share/' && (path === 'playback' || path.startsWith('playback/'));
  const response = await transport(`${sharedPlayback ? '/api/share/' : '/api/v1/'}${path}`, {
    ...options,
    method,
    headers: { ...diagnosticHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  options.signal?.throwIfAborted();
  receiveDiagnosticLevel(response);
  const payload = await response
    .json()
    .catch((cause) => {
      if (cause?.name === 'AbortError') throw cause;
      options.signal?.throwIfAborted();
      if (response.ok) throw new ApiError('The server returned an invalid response. Please try again.', 502);
      return { error: 'The server could not complete this request.' };
    });
  options.signal?.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401 && !sharedPlayback) window.dispatchEvent(new CustomEvent('coast:auth-expired'));
    throw new ApiError(
      payload?.error ?? 'Something went wrong. Please try again.',
      response.status,
      payload
    );
  }
  return payload as T;
}
export function createApiClient(transport: ApiTransport, afterChange: (path: string) => Promise<void>) {
  const api = <T = unknown>(path: string, body?: unknown, method = 'POST', options: Pick<RequestInit, 'signal'> = {}) => requestApi<T>(transport, path, body, method, options);
  const change = async <T = unknown>(path: string, body?: unknown, method = 'POST', options:Pick<RequestInit,'signal'> = {}) => {
    const result = await api<T>(path, body, method,options);
    await acknowledgeRefresh(() => afterChange(path));
    return result;
  };
  const changeMany = <T = unknown>(paths: readonly string[], body?: unknown, method = 'POST') => orderedChanges<T>(api, afterChange, paths, body, method);
  return { api, change, changeMany };
}
export async function change<T = unknown>(path: string, body?: unknown, method = 'POST', options:Pick<RequestInit,'signal'> = {}) {
  const result = await api<T>(path, body, method,options);
  await acknowledgeRefresh(() => refreshAfterChange(path));
  return result;
}
/** Keep each command acknowledgement, with one completion refresh for a same-domain action. */
export function changeMany<T = unknown>(paths: readonly string[], body?: unknown, method = 'POST') {
  return orderedChanges<T>(api, refreshAfterChange, paths, body, method);
}
async function orderedChanges<T>(
  deliver: typeof api,
  afterChange: (path: string) => Promise<void>,
  paths: readonly string[],
  body: unknown,
  method: string
): Promise<T[]> {
  const commands = [...paths];
  if (!commands.length) return [];
  const domain = commands[0].split('/')[0];
  if (commands.some(path => path.split('/')[0] !== domain))
    throw new Error('A grouped action must use one command domain.');
  const results: T[] = [];
  try {
    for (const path of commands) results.push(await deliver<T>(path, body, method));
    return results;
  } finally {
    // A failed later command still leaves acknowledged earlier commands visible.
    if (results.length) await acknowledgeRefresh(() => afterChange(commands[0]));
  }
}
/** A failed page refresh cannot turn an acknowledged command into a failed write. */
async function acknowledgeRefresh(refresh: () => Promise<void>) {
  try { await refresh(); }
  catch { notifyAction('Saved. The page could not refresh; reload to see the latest data.'); }
}
export async function refreshAfterChange(path: string) {
  const domain = path.split('/')[0];
  const dependencies = domain === 'planning' ? ['planning'] : domain === 'social' ? ['social', 'notifications']
    : domain === 'notifications' ? ['notifications']
    : ['providers', 'queue', 'conflicts', 'requests'].includes(domain) ? ['providers', 'tracking', 'notifications']
    : ['settings', 'profile', 'admin'].includes(domain) ? ['session', 'settings', 'tracking', 'social']
    : ['tracking', 'ratings', 'collection', 'music', 'games', 'game-playthroughs', 'reading', 'lists', 'up-next', 'continue', 'rewatch', 'media'].includes(domain) ? ['tracking', 'social']
    : [];
  invalidateContentRevision(dependencies.filter((key): key is ContentDomain => ['tracking','social','planning'].includes(key)));
  await refreshRouteDependencies(dependencies);
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

/** Kit invalidate resets shallow page state. Use its state-preserving refresh while
 * an overlay is open, so a write/session refresh cannot close the user's panel. */
export async function refreshRouteDependencies(dependencies: readonly string[] | 'all') {
  if (dependencies !== 'all' && !dependencies.length) return;
  if (page.state.mediaDetailHref || page.state.friendsPopover || page.state.notificationPopover || page.state.streamsPopover)
    await refreshAll();
  else if (dependencies === 'all') await refreshAll();
  else await Promise.all(dependencies.map(key => invalidate(`coast:${key}`)));
}
