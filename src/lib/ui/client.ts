import { browserDiagnostic, diagnosticHeaders, receiveDiagnosticLevel } from './diagnostics';
import { invalidate, refreshAll } from '$app/navigation';
import { page } from '$app/state';
import { invalidateContentRevision, type ContentDomain } from './content-revision.svelte';
import { detailPanelHref, panelAddress } from '#lib/media/detail-target.js';

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
export const coastConnectionMessage='Could not reach Coast. Check your connection and try again.';

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
function waitForReconnect(signal?:AbortSignal|null) {
  return new Promise<void>(resolve=>{
    const timer=setTimeout(finish,navigator.onLine?350:1200);
    function finish() {
      clearTimeout(timer);
      window.removeEventListener('online',finish);
      signal?.removeEventListener('abort',finish);
      resolve();
    }
    window.addEventListener('online',finish,{once:true});
    signal?.addEventListener('abort',finish,{once:true});
  });
}
async function requestApi<T>(transport: ApiTransport, path: string, body: unknown, method: string, options: Pick<RequestInit, 'signal'>, playbackBase = playbackApi): Promise<T> {
  options.signal?.throwIfAborted();
  const sharedPlayback = playbackBase === '/api/share/' && (path === 'playback' || path.startsWith('playback/'));
  const init = {
    ...options,
    method,
    headers: { ...diagnosticHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const send=()=>transport(`${sharedPlayback ? '/api/share/' : '/api/v1/'}${path}`,init);
  const response = await send().catch(async cause=>{
    options.signal?.throwIfAborted();
    if(method==='GET'&&body===undefined&&cause instanceof TypeError&&typeof window!=='undefined'&&typeof navigator!=='undefined'){
      await waitForReconnect(options.signal);
      options.signal?.throwIfAborted();
      if(navigator.onLine)return send();
    }
    throw cause;
  }).catch(cause => {
    options.signal?.throwIfAborted();
    if (cause?.name !== 'AbortError') browserDiagnostic('browser.request-failed', {
      operation: path.split('/', 1)[0], method, failure: cause instanceof TypeError ? 'network' : 'unexpected',
      surface: sharedPlayback ? 'share' : undefined,
    });
    throw cause instanceof TypeError?new ApiError(coastConnectionMessage,0):cause;
  });
  options.signal?.throwIfAborted();
  receiveDiagnosticLevel(response);
  const payload = await response
    .json()
    .catch((cause) => {
      if (cause?.name === 'AbortError') throw cause;
      options.signal?.throwIfAborted();
      if (response.ok) {
        browserDiagnostic('browser.request-failed', {
          operation: path.split('/', 1)[0], method, failure: 'validation', stage: 'response-body',
          status: response.status, relatedRequestId: response.headers.get('x-coast-request-id'),
          surface: sharedPlayback ? 'share' : undefined,
        });
        throw new ApiError('The server returned an invalid response. Please try again.', 502);
      }
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
  catch (cause) {
    if((cause as {name?:string})?.name!=='AbortError')
      browserDiagnostic('browser.request-failed',{stage:'after-change-refresh',failure:cause instanceof TypeError?'network':'unexpected'});
  }
}
export async function refreshAfterChange(path: string) {
  const domain = path.split('/')[0];
  const dependencies = domain === 'planning' ? ['planning'] : domain === 'social' ? ['social', 'notifications']
    : domain === 'notifications' ? ['notifications']
    : domain === 'sharing' ? ['sharing']
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
  const { state } = page;
  const url = panelAddress(page);
  if (detailPanelHref(url, state)
    || (state.friendsPopover ?? url.searchParams.get('friends') === 'true')
    || (state.notificationPopover ?? url.searchParams.get('notifications') === 'true')
    || (state.streamsPopover ?? url.searchParams.get('streams') === 'true'))
    await refreshAll();
  else if (dependencies === 'all') await refreshAll();
  else await Promise.all(dependencies.map(key => invalidate(`coast:${key}`)));
}
