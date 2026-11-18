import { diagnosticOperations, type DiagnosticLevel, type DiagnosticRequestAction } from '#lib/diagnostics.js';

/** Only return fixed application labels. Route parameters and query values stay private. */
export function requestDiagnostics(url: URL): { operation: string; requestAction?: DiagnosticRequestAction; surface?: 'public-api' | 'share' } {
  const [, first, version, domain, id, action, resource] = url.pathname.split('/');
  if (first === '_app') return { operation: 'other', requestAction: 'asset' };
  if (first === 'api' && version === 'public' && domain === 'v1') {
    return { operation: id === 'me' ? 'auth' : diagnosticOperations.has(id) ? id : 'other', surface: 'public-api' };
  }
  if (first === 'api' && version === 'share') {
    const surface = 'share';
    if ((domain === 'playback' || domain === 'external') && (action === 'stream' || action === 'stream.m3u8'))
      return { operation: 'playback', requestAction: 'share-stream', surface };
    if (domain === 'playback') return { operation: 'playback', requestAction: playbackAction(id, action), surface };
    if (domain === 'reading') return { operation: 'reading', requestAction: id ? readerResource(action) : 'reader-open', surface };
    return { operation: 'sharing', requestAction: domain === 'claim' ? 'claim' : undefined, surface };
  }
  if (first === 'api' && version === 'v1') {
    const operation = diagnosticOperations.has(domain) ? domain : 'other';
    if (domain === 'health') return { operation, requestAction: 'health' };
    if (domain === 'artwork') return { operation, requestAction: 'asset' };
    if (domain === 'playback') return { operation, requestAction: playbackAction(id, action) };
    if (domain === 'reading' && id === 'sessions') return { operation, requestAction: readerResource(resource) };
    if (domain === 'reading' && action === 'session') return { operation, requestAction: 'reader-open' };
    if (domain === 'session' && id === 'heartbeat') return { operation, requestAction: 'heartbeat' };
    if (domain === 'admin' && id === 'backups') return { operation: 'backup' };
    if (domain === 'notifications' && id === 'feedback') return { operation, requestAction: 'feedback' };
    if (domain === 'media') {
      if (action === 'subtitles' || action === 'trailer') return { operation, requestAction: action };
      if (action === 'refresh') return { operation, requestAction: 'metadata-refresh' };
      if (id && !action) return { operation, requestAction: detailAction(url) };
    }
    return { operation };
  }
  if (first === 'media') return { operation: 'media', requestAction: 'details' };
  if (first === 'share') return { operation: 'sharing', surface: 'share' };
  if (diagnosticOperations.has(first)) return { operation: first };
  return { operation: ['login', 'setup', 'logout'].includes(first) ? 'auth' : 'other' };
}

function readerResource(action?: string): DiagnosticRequestAction | undefined {
  if (action === 'file') return 'reader-file';
  if (action === 'manifest') return 'reader-manifest';
  if (action === 'pages') return 'reader-page';
  if (action === 'heartbeat') return 'heartbeat';
}

function playbackAction(id?: string, action?: string): DiagnosticRequestAction | undefined {
  if (!id) return 'prepare';
  if (!action) return 'restore';
  if (action === 'stream' || action === 'subtitles' || action === 'progress') return action;
  if (action === 'error') return 'player-error';
}

function detailAction(url: URL) {
  return url.searchParams.get('enhance') === 'true' ? 'details-enhance' : 'details';
}

export function requestDiagnosticLevel(status: number, durationMs: number, action?: DiagnosticRequestAction): DiagnosticLevel {
  if (status === 499) return 'debug';
  if (status >= 500) return 'error';
  if ([400, 401, 403, 409, 422].includes(status) || status === 404 && action !== 'asset') return 'info';
  if (status >= 400) return 'warn';
  if (durationMs < 1000 && (action === 'stream' || action === 'share-stream' || action === 'progress' ||
    action === 'health' || action === 'asset' || action === 'reader-page' || action === 'reader-file' || action === 'heartbeat'))
    return 'debug';
  return 'info';
}
